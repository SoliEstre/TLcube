// qr.test.js — QR v1(21×21) ECC-L 알파뉴메릭 전용 인코더 계약 테스트 (SPEC §14 코너 QR fallback)
//
// 판독성(실제 스캐너 복호)은 이 스위트가 아니라 repo 밖 별도 검증(jsQR)으로
// 확인했다 — 스코프 규약상 이 repo 에는 QR 검증용 의존성을 남기지 않는다.
// 여기서는 구조·KAT·결정성·와이어 스냅샷·입력 검증만 고정한다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { qrMatrix, formatInfoBits, QR_ALNUM_CHARSET, QR_V1L_CAPACITY } from '../src/qr.js';

const SIZE = 21;

function at(matrix, x, y) {
  return matrix.modules[y * matrix.size + x];
}

// 표준 QR 파인더 패턴 (7×7, 1=어두움) — 세 모서리 모두 동일하다.
const FINDER_7x7 = [
  '1111111',
  '1000001',
  '1011101',
  '1011101',
  '1011101',
  '1000001',
  '1111111',
];

function readBlock(matrix, x0, y0) {
  const rows = [];
  for (let dy = 0; dy < 7; dy++) {
    let row = '';
    for (let dx = 0; dx < 7; dx++) row += at(matrix, x0 + dx, y0 + dy);
    rows.push(row);
  }
  return rows;
}

describe('상수', () => {
  test('QR_V1L_CAPACITY = 25', () => {
    assert.equal(QR_V1L_CAPACITY, 25);
  });

  test('QR_ALNUM_CHARSET 길이 45, 인덱스가 45진 인코딩 값과 일치', () => {
    assert.equal(QR_ALNUM_CHARSET.length, 45);
    assert.equal(QR_ALNUM_CHARSET.indexOf('0'), 0);
    assert.equal(QR_ALNUM_CHARSET.indexOf('9'), 9);
    assert.equal(QR_ALNUM_CHARSET.indexOf('A'), 10);
    assert.equal(QR_ALNUM_CHARSET.indexOf('Z'), 35);
    assert.equal(QR_ALNUM_CHARSET.indexOf(' '), 36);
    assert.equal(QR_ALNUM_CHARSET.indexOf(':'), 44);
  });
});

describe('구조 (ISO/IEC 18004 기능 패턴)', () => {
  const matrix = qrMatrix('HTTPS://TLCUBE.APP/S');

  test('행렬 크기 = 21×21 = 441', () => {
    assert.equal(matrix.size, SIZE);
    assert.equal(matrix.modules.length, SIZE * SIZE);
  });

  test('파인더 3코너 7×7 패턴이 정확히 일치', () => {
    assert.deepEqual(readBlock(matrix, 0, 0), FINDER_7x7, '좌상단');
    assert.deepEqual(readBlock(matrix, SIZE - 7, 0), FINDER_7x7, '우상단');
    assert.deepEqual(readBlock(matrix, 0, SIZE - 7), FINDER_7x7, '좌하단');
  });

  test('좌상단 분리자(파인더 둘레 1모듈)는 전부 밝다', () => {
    for (let i = 0; i < 8; i++) {
      assert.equal(at(matrix, i, 7), 0, `열${i}, 행7`);
      assert.equal(at(matrix, 7, i), 0, `열7, 행${i}`);
    }
  });

  test('타이밍 패턴(행6·열6)이 파인더 밖 구간에서 교대(짝수 열/행=어두움)', () => {
    for (let x = 8; x <= 12; x++) {
      assert.equal(at(matrix, x, 6), x % 2 === 0 ? 1 : 0, `행6, 열${x}`);
    }
    for (let y = 8; y <= 12; y++) {
      assert.equal(at(matrix, 6, y), y % 2 === 0 ? 1 : 0, `열6, 행${y}`);
    }
  });

  test('다크 모듈 (열8, 행13 = 4·v1+9) 은 항상 어둡다', () => {
    assert.equal(at(matrix, 8, 13), 1);
  });
});

describe('포맷 정보 BCH(15,5) KAT', () => {
  test('ECC-L, 마스크 0 → 0b111011111000100 = 0x77C4 (ISO/IEC 18004 부속서 C 공지 예시)', () => {
    assert.equal(formatInfoBits(0), 0b111011111000100);
    assert.equal(formatInfoBits(0), 0x77c4);
  });

  test('마스크 인자 범위 밖 → RangeError', () => {
    assert.throws(() => formatInfoBits(8), RangeError);
    assert.throws(() => formatInfoBits(-1), RangeError);
    assert.throws(() => formatInfoBits(1.5), RangeError);
  });
});

describe('결정성', () => {
  test('동일 입력 → 동일 행렬 (2회)', () => {
    const a = qrMatrix('HTTPS://TLCUBE.APP/S');
    const b = qrMatrix('HTTPS://TLCUBE.APP/S');
    assert.deepEqual(Array.from(a.modules), Array.from(b.modules));
    assert.equal(a.size, b.size);
  });

  test('빈 문자열도 결정적으로 인코딩된다', () => {
    const a = qrMatrix('');
    const b = qrMatrix('');
    assert.deepEqual(Array.from(a.modules), Array.from(b.modules));
  });
});

describe('와이어 스냅샷 (sha256)', () => {
  // "HTTPS://TLCUBE.APP/S" (20자) 행렬 전체를 sha256 으로 고정한다.
  // 값이 바뀌면 비트스트림·RS·배치·마스크 선택 중 하나가 회귀한 것이다.
  const SNAPSHOT_SHA256 =
    'adac418cc63a558b3050216e1b398351969e30697a24d64cbe6b9c88cb6613e4';

  test('"HTTPS://TLCUBE.APP/S" 행렬 sha256 고정', () => {
    const matrix = qrMatrix('HTTPS://TLCUBE.APP/S');
    const hash = createHash('sha256').update(Buffer.from(matrix.modules)).digest('hex');
    assert.equal(hash, SNAPSHOT_SHA256);
  });
});

describe('입력 검증', () => {
  test('26자 이상 → RangeError', () => {
    assert.throws(() => qrMatrix('0'.repeat(26)), RangeError);
  });

  test('25자는 허용 (v1-L 알파뉴메릭 용량 경계)', () => {
    assert.doesNotThrow(() => qrMatrix('0'.repeat(25)));
  });

  test('문자셋 밖 문자(소문자) → RangeError', () => {
    assert.throws(() => qrMatrix('lowercase'), RangeError);
  });

  test('문자셋 밖 문자(허용되지 않는 기호) → RangeError', () => {
    assert.throws(() => qrMatrix('A#B'), RangeError);
  });

  test('문자열이 아닌 입력 → TypeError', () => {
    assert.throws(() => qrMatrix(123), TypeError);
  });
});
