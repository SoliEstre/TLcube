// qr-v2-byte.test.js — QR v2(25×25) ECC-L 바이트 모드 인코더
//
// 인코더와 그 역을 같이 틀리는 위험을 줄이기 위해 ISO 기능 패턴,
// 기존 formatInfoBits KAT, 독립 구성한 비트스트림 접두, 기존 rs.js 신드롬,
// 행렬 sha256 을 함께 고정한다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { formatInfoBits } from '../src/qr.js';
import { rsEncode, rsSyndromes } from '../src/rs.js';
import {
  QR_MODE_BYTE,
  QR_V2_ALIGNMENT_CENTER,
  QR_V2_SIZE,
  QR_V2L_BYTE_CAPACITY,
  QR_V2L_DATA_CODEWORDS,
  QR_V2L_EC_CODEWORDS,
  qrV2ByteMatrix,
} from '../src/qr-v2-byte.js';
import {
  decodeQrV2Byte,
  extractCodewords,
  readFormatBits,
  v2FunctionMask,
} from './harness/qr-v2-byte-decode.mjs';

const SIZE = QR_V2_SIZE;
const POSTER_URL = 'https://tl.estre.so';

function at(matrix, x, y) {
  return matrix.modules[y * matrix.size + x];
}

const FINDER_7x7 = [
  '1111111',
  '1000001',
  '1011101',
  '1011101',
  '1011101',
  '1000001',
  '1111111',
];

const ALIGN_5x5 = [
  '11111',
  '10001',
  '10101',
  '10001',
  '11111',
];

function readBlock(matrix, x0, y0, n) {
  const rows = [];
  for (let dy = 0; dy < n; dy++) {
    let row = '';
    for (let dx = 0; dx < n; dx++) row += at(matrix, x0 + dx, y0 + dy);
    rows.push(row);
  }
  return rows;
}

function expectedDataPrefix(text) {
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(QR_MODE_BYTE, 4);
  push(text.length, 8);
  for (let i = 0; i < text.length; i++) push(text.charCodeAt(i), 8);
  return bits;
}

describe('상수', () => {
  test('v2-L 바이트 용량·격자·정렬 중심이 ISO 표와 같다', () => {
    assert.equal(QR_V2_SIZE, 25);
    assert.equal(QR_V2L_BYTE_CAPACITY, 32);
    assert.equal(QR_V2L_DATA_CODEWORDS, 34);
    assert.equal(QR_V2L_EC_CODEWORDS, 10);
    assert.equal(QR_V2_ALIGNMENT_CENTER, 18);
    assert.equal(QR_MODE_BYTE, 0b0100);
  });
});

describe('구조 (ISO/IEC 18004 기능 패턴)', () => {
  const matrix = qrV2ByteMatrix(POSTER_URL);

  test('행렬 크기 = 25×25 = 625', () => {
    assert.equal(matrix.size, SIZE);
    assert.equal(matrix.modules.length, SIZE * SIZE);
  });

  test('파인더 3코너 7×7 패턴이 정확히 일치', () => {
    assert.deepEqual(readBlock(matrix, 0, 0, 7), FINDER_7x7, '좌상단');
    assert.deepEqual(readBlock(matrix, SIZE - 7, 0, 7), FINDER_7x7, '우상단');
    assert.deepEqual(readBlock(matrix, 0, SIZE - 7, 7), FINDER_7x7, '좌하단');
  });

  test('정렬 패턴 5×5 가 (18,18) 중심에 있다', () => {
    assert.deepEqual(readBlock(matrix, 16, 16, 5), ALIGN_5x5);
  });

  test('타이밍 패턴(행6·열6)이 파인더 밖 구간에서 교대', () => {
    for (let x = 8; x <= 16; x++) {
      assert.equal(at(matrix, x, 6), x % 2 === 0 ? 1 : 0, `행6, 열${x}`);
    }
    for (let y = 8; y <= 16; y++) {
      assert.equal(at(matrix, 6, y), y % 2 === 0 ? 1 : 0, `열6, 행${y}`);
    }
  });

  test('다크 모듈 (열8, 행17 = 4·v2+9) 은 항상 어둡다', () => {
    assert.equal(at(matrix, 8, 17), 1);
  });
});

describe('포맷 정보 (기존 formatInfoBits)', () => {
  test('행렬의 포맷 15bit 가 qr.js formatInfoBits(mask) 와 같다', () => {
    const matrix = qrV2ByteMatrix(POSTER_URL);
    const packed = readFormatBits(matrix.modules);
    const mask = ((packed ^ 0x5412) >> 10) & 7;
    assert.equal(packed, formatInfoBits(mask));
    assert.equal((packed ^ 0x5412) >> 13, 0b01);
  });
});

describe('비트스트림·RS (독립 구성 + 기존 rs.js)', () => {
  test('언마스크 선두 비트가 모드 0100 + 길이 19 + 소문자 URL 바이트다', () => {
    const matrix = qrV2ByteMatrix(POSTER_URL);
    const { unmasked, positions } = extractCodewords(matrix.modules);
    const expected = expectedDataPrefix(POSTER_URL);
    for (let i = 0; i < expected.length; i++) {
      const { x, y } = positions[i];
      assert.equal(unmasked[y * SIZE + x], expected[i], `bit ${i} @${x},${y}`);
    }
    assert.equal(POSTER_URL.length, 19);
    assert.equal(POSTER_URL, 'https://tl.estre.so');
  });

  test('추출 코드워드 신드롬이 0 이고 rsEncode(data,10) 과 일치한다', () => {
    const matrix = qrV2ByteMatrix(POSTER_URL);
    const { codewords } = extractCodewords(matrix.modules);
    const syndromes = rsSyndromes(codewords, QR_V2L_EC_CODEWORDS);
    assert.deepEqual(Array.from(syndromes), Array(QR_V2L_EC_CODEWORDS).fill(0));
    const data = codewords.subarray(0, QR_V2L_DATA_CODEWORDS);
    const encoded = rsEncode(data, QR_V2L_EC_CODEWORDS);
    assert.deepEqual(Array.from(encoded), Array.from(codewords));
  });

  test('데이터 모듈 1비트 뒤집어도 RS 가 소문자 URL 을 복원한다', () => {
    const matrix = qrV2ByteMatrix(POSTER_URL);
    const flipped = Uint8Array.from(matrix.modules);
    const fn = v2FunctionMask();
    const dataIdx = fn.findIndex((v) => v === 0);
    flipped[dataIdx] ^= 1;
    const decoded = decodeQrV2Byte(flipped);
    assert.equal(decoded.text, POSTER_URL);
  });
});

describe('결정성', () => {
  test('동일 입력 → 동일 행렬 (2회)', () => {
    const a = qrV2ByteMatrix(POSTER_URL);
    const b = qrV2ByteMatrix(POSTER_URL);
    assert.deepEqual(Array.from(a.modules), Array.from(b.modules));
  });
});

describe('와이어 스냅샷 (sha256)', () => {
  const SNAPSHOT_SHA256 =
    'eb291689f046fcbf2ff5cfdb8e26f6e8eb1058d8518add3c829cea35e2bd6405';

  test('"https://tl.estre.so" 행렬 sha256 고정', () => {
    const matrix = qrV2ByteMatrix(POSTER_URL);
    const hash = createHash('sha256').update(Buffer.from(matrix.modules)).digest('hex');
    assert.equal(hash, SNAPSHOT_SHA256);
  });
});

describe('입력 검증', () => {
  test('33바이트 이상 → RangeError', () => {
    assert.throws(() => qrV2ByteMatrix('a'.repeat(33)), RangeError);
  });

  test('32바이트는 허용', () => {
    assert.doesNotThrow(() => qrV2ByteMatrix('a'.repeat(32)));
  });

  test('U+0100 이상 → RangeError', () => {
    assert.throws(() => qrV2ByteMatrix('ā'), RangeError);
    assert.throws(() => qrV2ByteMatrix('한'), RangeError);
  });

  test('문자열이 아닌 입력 → TypeError', () => {
    assert.throws(() => qrV2ByteMatrix(123), TypeError);
  });
});

describe('왕복', () => {
  test('소문자 URL 이 대문자로 바뀌지 않는다', () => {
    const matrix = qrV2ByteMatrix(POSTER_URL);
    const decoded = decodeQrV2Byte(matrix.modules);
    assert.equal(decoded.text, POSTER_URL);
    assert.notEqual(decoded.text, POSTER_URL.toUpperCase());
  });
});
