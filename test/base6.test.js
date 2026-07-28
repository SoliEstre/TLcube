// base6.test.js — SPEC §4.2 비트스트림 ↔ base-6 변환 계약 테스트

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHUNK_BYTES,
  CHUNK_DIGITS,
  BASE,
  digitCountForBytes,
  digitCountFormula,
  digitCountForByteLength,
  byteLengthForDigitCount,
  bytesToBigInt,
  bigIntToBytes,
  bigIntToDigits,
  digitsToBigInt,
  encodeChunkInto,
  decodeChunkInto,
  bytesToDigits,
  digitsToBytes,
  iterDigits,
} from '../src/base6.js';

/** 고정 시드 PRNG (mulberry32) — 랜덤 테스트를 결정적으로 만든다. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(rng, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(rng() * 256);
  return out;
}

const ROUND_TRIP_LENGTHS = [0, 1, 2, 7, 8, 9, 15, 16, 17, 100, 1000];

describe('상수 (SPEC §4.2)', () => {
  test('청크는 8바이트 ↔ 25 digit', () => {
    assert.equal(CHUNK_BYTES, 8);
    assert.equal(CHUNK_DIGITS, 25);
    assert.equal(BASE, 6);
  });

  test('6^25 > 2^64 (청크가 손실 없이 담긴다)', () => {
    assert.ok(6n ** 25n > 2n ** 64n);
    assert.ok(6n ** 24n < 2n ** 64n, '25 는 최소값이어야 한다');
  });

  test('효율은 이론치의 99% 이상', () => {
    const efficiency = (CHUNK_BYTES * 8) / CHUNK_DIGITS / Math.log2(BASE);
    assert.ok(efficiency > 0.99, `효율 ${efficiency}`);
    assert.ok(efficiency <= 1);
  });
});

describe('digitCountForBytes — 최소성', () => {
  test('m = 0..8 에서 SPEC 공식 ceil(m·8 / log2 6) 과 일치', () => {
    for (let m = 0; m <= 8; m += 1) {
      assert.equal(digitCountForBytes(m), digitCountFormula(m), `m=${m}`);
    }
  });

  test('m = 0..64 까지도 부동소수 공식과 어긋나지 않는다', () => {
    for (let m = 0; m <= 64; m += 1) {
      assert.equal(digitCountForBytes(m), digitCountFormula(m), `m=${m}`);
    }
  });

  test('m = 1..7 에서 6^k >= 2^(8m) (충분성)', () => {
    for (let m = 1; m <= 7; m += 1) {
      const k = digitCountForBytes(m);
      assert.ok(6n ** BigInt(k) >= 2n ** BigInt(8 * m), `m=${m}, k=${k} 가 부족하다`);
    }
  });

  test('m = 1..7 에서 6^(k-1) < 2^(8m) (최소성)', () => {
    for (let m = 1; m <= 7; m += 1) {
      const k = digitCountForBytes(m);
      assert.ok(6n ** BigInt(k - 1) < 2n ** BigInt(8 * m), `m=${m}, k=${k} 가 최소가 아니다`);
    }
  });

  test('m = 8 은 SPEC 이 명시한 25', () => {
    assert.equal(digitCountForBytes(8), CHUNK_DIGITS);
  });

  test('꼬리 digit 수는 단조 증가하고 서로 다르다', () => {
    const counts = [];
    for (let m = 0; m <= 8; m += 1) counts.push(digitCountForBytes(m));
    assert.deepEqual(counts, [0, 4, 7, 10, 13, 16, 19, 22, 25]);
    for (let i = 1; i < counts.length; i += 1) assert.ok(counts[i] > counts[i - 1]);
  });

  test('음수·비정수를 거부', () => {
    for (const bad of [-1, 1.5, NaN, '3']) {
      assert.throws(() => digitCountForBytes(bad), RangeError, `${String(bad)} 통과`);
    }
  });
});

describe('길이 ↔ digit 개수 대응', () => {
  test('digitCountForByteLength: 완전 청크 + 꼬리', () => {
    assert.equal(digitCountForByteLength(0), 0);
    assert.equal(digitCountForByteLength(8), 25);
    assert.equal(digitCountForByteLength(16), 50);
    assert.equal(digitCountForByteLength(9), 25 + 4);
    assert.equal(digitCountForByteLength(15), 25 + 22);
  });

  test('byteLengthForDigitCount 는 digitCountForByteLength 의 역', () => {
    for (let len = 0; len <= 200; len += 1) {
      assert.equal(byteLengthForDigitCount(digitCountForByteLength(len)), len, `len=${len}`);
    }
  });

  test('청크 분해가 불가능한 digit 개수는 거부', () => {
    // 꼬리로 가능한 나머지는 {0,4,7,10,13,16,19,22} 뿐
    for (const rem of [1, 2, 3, 5, 6, 8, 9, 11, 12, 23, 24]) {
      assert.throws(() => byteLengthForDigitCount(rem), RangeError, `rem=${rem} 이 통과`);
      assert.throws(() => byteLengthForDigitCount(25 + rem), RangeError, `25+${rem} 이 통과`);
    }
  });
});

describe('엔디안 / digit 순서 계약 ([C2] [C3])', () => {
  test('바이트는 빅엔디안: [0x00,0x01] → 값 1', () => {
    assert.equal(bytesToBigInt(Uint8Array.from([0x00, 0x01])), 1n);
    assert.equal(bytesToBigInt(Uint8Array.from([0x01, 0x00])), 256n);
  });

  test('digit 은 MSD first: 값 1, 2바이트 → [0,0,0,0,0,0,1]', () => {
    const digits = bytesToDigits(Uint8Array.from([0x00, 0x01]));
    assert.deepEqual([...digits], [0, 0, 0, 0, 0, 0, 1]);
  });

  test('값 256, 2바이트 → base-6 1104 를 7자리로 좌측 0 패딩', () => {
    const digits = bytesToDigits(Uint8Array.from([0x01, 0x00]));
    assert.deepEqual([...digits], [0, 0, 0, 1, 1, 0, 4]);
    // 1·216 + 1·36 + 0·6 + 4 = 256
    assert.equal(digitsToBigInt(digits), 256n);
  });

  test('8바이트 [0x01,0,0,0,0,0,0,0] 은 2^56', () => {
    const bytes = new Uint8Array(8);
    bytes[0] = 1;
    assert.equal(bytesToBigInt(bytes), 2n ** 56n);
  });

  test('bigIntToDigits / digitsToBigInt 왕복', () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 500; i += 1) {
      const v = BigInt(Math.floor(rng() * 2 ** 32)) * (1n << 32n)
        + BigInt(Math.floor(rng() * 2 ** 32));
      const out = new Uint8Array(CHUNK_DIGITS);
      bigIntToDigits(v, CHUNK_DIGITS, out, 0);
      assert.equal(digitsToBigInt(out), v);
    }
  });

  test('bytesToBigInt / bigIntToBytes 왕복', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i += 1) {
      const len = 1 + Math.floor(rng() * 8);
      const bytes = randomBytes(rng, len);
      const v = bytesToBigInt(bytes);
      const back = new Uint8Array(len);
      bigIntToBytes(v, back, 0, len);
      assert.deepEqual([...back], [...bytes]);
    }
  });
});

describe('바이트 ↔ digit 왕복', () => {
  test(`고정 길이 ${ROUND_TRIP_LENGTHS.join(', ')} (패턴 바이트)`, () => {
    for (const len of ROUND_TRIP_LENGTHS) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) bytes[i] = (i * 37 + 11) & 0xff;
      const digits = bytesToDigits(bytes);
      assert.equal(digits.length, digitCountForByteLength(len), `len=${len} digit 개수`);
      assert.deepEqual([...digitsToBytes(digits, len)], [...bytes], `len=${len} 왕복 실패`);
    }
  });

  test('고정 시드 랜덤 다수 (길이 0..200, 300회)', () => {
    const rng = mulberry32(0x5eed);
    for (let i = 0; i < 300; i += 1) {
      const len = Math.floor(rng() * 201);
      const bytes = randomBytes(rng, len);
      const digits = bytesToDigits(bytes);
      assert.deepEqual([...digitsToBytes(digits, len)], [...bytes], `i=${i}, len=${len}`);
    }
  });

  test('길이 0 은 digit 0개', () => {
    const digits = bytesToDigits(new Uint8Array(0));
    assert.equal(digits.length, 0);
    assert.equal(digitsToBytes(digits, 0).length, 0);
  });

  test('byteLength 생략 시 digit 개수로 역산해도 같은 결과', () => {
    const rng = mulberry32(99);
    for (const len of ROUND_TRIP_LENGTHS) {
      const bytes = randomBytes(rng, len);
      const digits = bytesToDigits(bytes);
      assert.deepEqual([...digitsToBytes(digits)], [...bytes], `len=${len}`);
    }
  });
});

describe('경계값', () => {
  test('전부 0x00 → 전부 digit 0, 왕복 성립', () => {
    for (const len of [1, 8, 17, 100]) {
      const bytes = new Uint8Array(len); // 이미 0
      const digits = bytesToDigits(bytes);
      assert.ok([...digits].every((d) => d === 0), `len=${len} 에 0 아닌 digit`);
      assert.deepEqual([...digitsToBytes(digits, len)], [...bytes]);
    }
  });

  test('전부 0xFF → 왕복 성립', () => {
    for (const len of [1, 8, 17, 100]) {
      const bytes = new Uint8Array(len).fill(0xff);
      const digits = bytesToDigits(bytes);
      assert.deepEqual([...digitsToBytes(digits, len)], [...bytes], `len=${len}`);
    }
  });

  test('8바이트 최대값 2^64-1 이 25 digit 에 들어간다', () => {
    const bytes = new Uint8Array(8).fill(0xff);
    assert.equal(bytesToBigInt(bytes), 2n ** 64n - 1n);
    const digits = bytesToDigits(bytes);
    assert.equal(digits.length, CHUNK_DIGITS);
    assert.equal(digitsToBigInt(digits), 2n ** 64n - 1n);
    assert.deepEqual([...digitsToBytes(digits, 8)], [...bytes]);
  });

  test('꼬리 m=1..7 각각의 최대값이 digitCountForBytes(m) 에 들어간다', () => {
    for (let m = 1; m <= 7; m += 1) {
      const bytes = new Uint8Array(m).fill(0xff);
      const digits = bytesToDigits(bytes);
      assert.equal(digits.length, digitCountForBytes(m), `m=${m}`);
      assert.equal(digitsToBigInt(digits), 2n ** BigInt(8 * m) - 1n, `m=${m} 최대값 손실`);
      assert.deepEqual([...digitsToBytes(digits, m)], [...bytes]);
    }
  });

  test('digit 개수가 부족하면 인코딩이 실패한다 (조용히 잘리지 않는다)', () => {
    const out = new Uint8Array(CHUNK_DIGITS);
    assert.throws(() => bigIntToDigits(2n ** 64n - 1n, 24, out, 0), RangeError);
    assert.throws(() => bigIntToDigits(256n, 3, out, 0), RangeError, '2바이트 최대값 < 6^3');
  });
});

describe('digit 값 범위', () => {
  test('모든 출력 digit 이 {0..5}', () => {
    const rng = mulberry32(0xabcdef);
    for (let i = 0; i < 100; i += 1) {
      const len = Math.floor(rng() * 64);
      const digits = bytesToDigits(randomBytes(rng, len));
      for (let j = 0; j < digits.length; j += 1) {
        assert.ok(digits[j] >= 0 && digits[j] < BASE, `digit[${j}]=${digits[j]}`);
      }
    }
  });

  test('범위 밖 digit 입력은 거부', () => {
    const digits = [...bytesToDigits(Uint8Array.from([1, 2]))];
    digits[0] = 6;
    assert.throws(() => digitsToBytes(digits, 2), RangeError);
    digits[0] = -1;
    assert.throws(() => digitsToBytes(digits, 2), RangeError);
    digits[0] = 1.5;
    assert.throws(() => digitsToBytes(digits, 2), RangeError);
  });

  test('digit 개수가 선언된 바이트 길이와 안 맞으면 거부', () => {
    const digits = bytesToDigits(Uint8Array.from([1, 2, 3]));
    assert.equal(digits.length, 10);
    assert.throws(() => digitsToBytes(digits, 2), RangeError);
    assert.throws(() => digitsToBytes(digits, 4), RangeError);
  });
});

describe('청크 독립성 / 스트리밍 ([C4])', () => {
  test('8배수 경계에서 잘라 붙여도 결과가 같다', () => {
    const rng = mulberry32(1234);
    const bytes = randomBytes(rng, 64);
    const head = bytes.subarray(0, 24);
    const tail = bytes.subarray(24);
    const joined = [...bytesToDigits(head), ...bytesToDigits(tail)];
    assert.deepEqual([...bytesToDigits(bytes)], joined);
  });

  test('꼬리가 있는 앞부분은 이어붙일 수 없다 (경계 규약 확인)', () => {
    // 8배수가 아닌 지점에서 자르면 꼬리 패딩이 끼어들어 다른 결과가 나온다.
    // 이 성질이 깨지면 인코더가 임의 지점에서 청크를 나눠도 된다고 오해한다.
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const joined = [...bytesToDigits(bytes.subarray(0, 3)), ...bytesToDigits(bytes.subarray(3))];
    assert.notDeepEqual([...bytesToDigits(bytes)], joined);
  });

  test('iterDigits 는 bytesToDigits 와 같은 열을 흘린다', () => {
    const rng = mulberry32(555);
    for (const len of ROUND_TRIP_LENGTHS) {
      const bytes = randomBytes(rng, len);
      assert.deepEqual([...iterDigits(bytes)], [...bytesToDigits(bytes)], `len=${len}`);
    }
  });

  test('encodeChunkInto / decodeChunkInto 단일 청크 왕복', () => {
    const rng = mulberry32(4242);
    const digits = new Uint8Array(CHUNK_DIGITS);
    for (let trial = 0; trial < 200; trial += 1) {
      const m = 1 + Math.floor(rng() * 8);
      const bytes = randomBytes(rng, m);
      const n = encodeChunkInto(bytes, 0, m, digits, 0);
      assert.equal(n, digitCountForBytes(m));
      const back = new Uint8Array(m);
      assert.equal(decodeChunkInto(digits, 0, m, back, 0), n);
      assert.deepEqual([...back], [...bytes], `m=${m}`);
    }
  });

  test('청크 길이 범위 밖은 거부', () => {
    const out = new Uint8Array(CHUNK_DIGITS);
    const bytes = new Uint8Array(16);
    assert.throws(() => encodeChunkInto(bytes, 0, 0, out, 0), RangeError);
    assert.throws(() => encodeChunkInto(bytes, 0, 9, out, 0), RangeError);
  });
});

describe('결정성', () => {
  test('같은 입력을 반복 변환하면 항상 같은 출력', () => {
    const rng = mulberry32(2026);
    const bytes = randomBytes(rng, 137);
    const first = [...bytesToDigits(bytes)];
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual([...bytesToDigits(bytes)], first);
    }
    const back = [...digitsToBytes(Uint8Array.from(first), 137)];
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual([...digitsToBytes(Uint8Array.from(first), 137)], back);
    }
  });

  test('입력 배열을 변형하지 않는다', () => {
    const bytes = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const copy = [...bytes];
    bytesToDigits(bytes);
    assert.deepEqual([...bytes], copy);
  });
});

describe('타입 검사', () => {
  test('bytesToDigits 는 Uint8Array 만 받는다', () => {
    assert.throws(() => bytesToDigits([1, 2, 3]), TypeError);
    assert.throws(() => bytesToDigits('abc'), TypeError);
    assert.throws(() => bytesToDigits(null), TypeError);
  });

  test('digitsToBytes 는 일반 배열도 받는다 (디코더가 만든 배열)', () => {
    const digits = [...bytesToDigits(Uint8Array.from([0xde, 0xad]))];
    assert.deepEqual([...digitsToBytes(digits, 2)], [0xde, 0xad]);
  });
});
