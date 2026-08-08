// base211.test.js — ADR 0001 D3′ 계약 테스트: 3 digit ↔ 1 RS 심볼(GF(211)) + 바이트 ↔ 심볼 청커

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_DIGIT_BASE,
  DIGITS_PER_SYMBOL,
  CELL_TRIPLE_STATES,
  RS_SYMBOL_BASE,
  ILLEGAL_SYMBOL_MIN,
  ILLEGAL_SYMBOL_MAX,
  cellDigitsToSymbolValue,
  symbolValueToCellDigits,
  isLegalSymbolValue,
  packCellDigitsToSymbols,
  unpackSymbolsToCellDigits,
  CHUNK_BYTES,
  CHUNK_SYMBOLS,
  minSymbolsExact,
  symbolCountFormula,
  symbolCountForBytes,
  symbolCountForByteLength,
  byteLengthForSymbolCount,
  bytesToBigInt,
  bigIntToBytes,
  bigIntToSymbols,
  symbolsToBigInt,
  encodeChunkInto,
  decodeChunkInto,
  bytesToSymbols,
  symbolsToBytes,
  iterSymbols,
} from '../src/base211.js';

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

const ROUND_TRIP_LENGTHS = [0, 1, 26, 27, 28, 54, 66];

// ── [계층 A] digit ↔ 심볼 값 ────────────────────────────────────────────────────

describe('상수', () => {
  test('셀 3개 = RS 심볼 1개, 216 상태 중 211..215 는 불법', () => {
    assert.equal(CELL_DIGIT_BASE, 6);
    assert.equal(DIGITS_PER_SYMBOL, 3);
    assert.equal(CELL_TRIPLE_STATES, 216);
    assert.equal(RS_SYMBOL_BASE, 211);
    assert.equal(ILLEGAL_SYMBOL_MIN, 211);
    assert.equal(ILLEGAL_SYMBOL_MAX, 215);
  });
});

describe('digit ↔ 심볼 값 — 전단사 (216개 전수)', () => {
  test('모든 (d0,d1,d2) 조합이 0..215 에 유일하게 대응한다', () => {
    const seen = new Set();
    for (let d0 = 0; d0 < 6; d0 += 1) {
      for (let d1 = 0; d1 < 6; d1 += 1) {
        for (let d2 = 0; d2 < 6; d2 += 1) {
          const v = cellDigitsToSymbolValue(d0, d1, d2);
          assert.ok(v >= 0 && v < 216, `v=${v} 범위 밖`);
          assert.ok(!seen.has(v), `중복 값 v=${v}`);
          seen.add(v);
          assert.deepEqual(symbolValueToCellDigits(v), [d0, d1, d2], `역변환 불일치 v=${v}`);
        }
      }
    }
    assert.equal(seen.size, 216);
  });

  test('MSD-first 공식 검증: d0·36 + d1·6 + d2', () => {
    assert.equal(cellDigitsToSymbolValue(0, 0, 0), 0);
    assert.equal(cellDigitsToSymbolValue(5, 5, 5), 215);
    assert.equal(cellDigitsToSymbolValue(0, 0, 5), 5);
    assert.equal(cellDigitsToSymbolValue(0, 1, 0), 6);
    assert.equal(cellDigitsToSymbolValue(1, 0, 0), 36);
    assert.equal(cellDigitsToSymbolValue(5, 4, 4), 5 * 36 + 4 * 6 + 4);
  });

  test('불법 5개 값을 정확히 판별한다: 211..215', () => {
    const illegal = [];
    for (let v = 0; v < 216; v += 1) {
      if (!isLegalSymbolValue(v)) illegal.push(v);
    }
    assert.deepEqual(illegal, [211, 212, 213, 214, 215]);
    assert.equal(illegal.length, 5);
  });

  test('digit 범위 밖 입력은 거부', () => {
    for (const bad of [-1, 6, 1.5, NaN]) {
      assert.throws(() => cellDigitsToSymbolValue(bad, 0, 0), RangeError, `d0=${bad}`);
      assert.throws(() => cellDigitsToSymbolValue(0, bad, 0), RangeError, `d1=${bad}`);
      assert.throws(() => cellDigitsToSymbolValue(0, 0, bad), RangeError, `d2=${bad}`);
    }
  });

  test('심볼 값 범위 밖(< 0 또는 >= 216) 입력은 거부', () => {
    assert.throws(() => symbolValueToCellDigits(-1), RangeError);
    assert.throws(() => symbolValueToCellDigits(216), RangeError);
    assert.throws(() => symbolValueToCellDigits(1.5), RangeError);
  });
});

describe('packCellDigitsToSymbols / unpackSymbolsToCellDigits', () => {
  test('합법 심볼만 있으면 왕복이 성립한다', () => {
    const rng = mulberry32(0xf00d);
    for (let trial = 0; trial < 50; trial += 1) {
      const symbolCount = 1 + Math.floor(rng() * 30);
      const symbols = new Uint8Array(symbolCount);
      for (let i = 0; i < symbolCount; i += 1) symbols[i] = Math.floor(rng() * 211);
      const digits = unpackSymbolsToCellDigits(symbols);
      assert.equal(digits.length, symbolCount * 3);
      const { symbols: back, illegalIndices } = packCellDigitsToSymbols(digits);
      assert.deepEqual([...back], [...symbols]);
      assert.deepEqual(illegalIndices, []);
    }
  });

  test('불법값(211..215)을 만나면 위치를 보고하되 던지지 않는다', () => {
    // 심볼 인덱스 1, 3 을 불법값으로 만든다.
    const digits = [];
    const values = [10, 211, 50, 215, 0];
    for (const v of values) digits.push(...symbolValueToCellDigits(v));
    const { symbols, illegalIndices } = packCellDigitsToSymbols(digits);
    assert.deepEqual([...symbols], values);
    assert.deepEqual(illegalIndices, [1, 3]);
  });

  test('unpackSymbolsToCellDigits 는 불법 심볼에서 던진다 (인코더는 절대 불법 심볼을 만들면 안 됨)', () => {
    assert.throws(() => unpackSymbolsToCellDigits([0, 211, 0]), RangeError);
    assert.throws(() => unpackSymbolsToCellDigits([215]), RangeError);
  });

  test('digit 개수가 3의 배수가 아니면 거부', () => {
    assert.throws(() => packCellDigitsToSymbols([0, 1]), RangeError);
    assert.throws(() => packCellDigitsToSymbols([0, 1, 2, 3]), RangeError);
  });
});

describe('로컬리티 1 — 심볼 1개 오류는 같은 심볼 안의 digit 3개로만 국한된다', () => {
  test('한 심볼 값을 바꿔도 다른 심볼의 digit 은 전혀 변하지 않는다', () => {
    const rng = mulberry32(31337);
    const symbolCount = 20;
    const symbols = new Uint8Array(symbolCount);
    for (let i = 0; i < symbolCount; i += 1) symbols[i] = Math.floor(rng() * 211);
    const digitsBefore = unpackSymbolsToCellDigits(symbols);

    for (let target = 0; target < symbolCount; target += 1) {
      const corrupted = Uint8Array.from(symbols);
      let newValue = (corrupted[target] + 1 + Math.floor(rng() * 200)) % 211;
      if (newValue === corrupted[target]) newValue = (newValue + 1) % 211;
      corrupted[target] = newValue;
      const digitsAfter = unpackSymbolsToCellDigits(corrupted);

      for (let s = 0; s < symbolCount; s += 1) {
        const base = s * 3;
        const before = [digitsBefore[base], digitsBefore[base + 1], digitsBefore[base + 2]];
        const after = [digitsAfter[base], digitsAfter[base + 1], digitsAfter[base + 2]];
        if (s === target) {
          assert.notDeepEqual(after, before, `target=${target} 심볼의 digit 이 안 바뀜`);
        } else {
          assert.deepEqual(after, before, `target=${target} 오류가 심볼 ${s} 로 번짐`);
        }
      }
    }
  });
});

// ── [계층 B] 바이트 ↔ 심볼 청커 ─────────────────────────────────────────────────

describe('청크 상수 자기검증 (ADR §6.2 근거 5)', () => {
  test('27 바이트 ↔ 28 심볼', () => {
    assert.equal(CHUNK_BYTES, 27);
    assert.equal(CHUNK_SYMBOLS, 28);
  });

  test('211^28 >= 2^216 (충분성)', () => {
    assert.ok(211n ** 28n >= 2n ** 216n);
  });

  test('211^27 < 2^216 (28 이 최소값)', () => {
    assert.ok(211n ** 27n < 2n ** 216n);
  });
});

describe('symbolCountForBytes / minSymbolsExact — 최소성', () => {
  test('m = 0..27 에서 부동소수 공식과 일치', () => {
    for (let m = 0; m <= 27; m += 1) {
      assert.equal(symbolCountForBytes(m), symbolCountFormula(m), `m=${m}`);
    }
  });

  test('m = 1..26 에서 211^s >= 2^(8m) (충분성) 그리고 211^(s-1) < 2^(8m) (최소성)', () => {
    for (let m = 1; m <= 26; m += 1) {
      const s = minSymbolsExact(m);
      assert.ok(211n ** BigInt(s) >= 2n ** BigInt(8 * m), `m=${m}, s=${s} 부족`);
      assert.ok(211n ** BigInt(s - 1) < 2n ** BigInt(8 * m), `m=${m}, s=${s} 최소 아님`);
    }
  });

  test('m = 27 은 CHUNK_SYMBOLS(28)', () => {
    assert.equal(minSymbolsExact(27), CHUNK_SYMBOLS);
  });

  test('66 바이트는 69 심볼 (211^69 >= 2^528)', () => {
    const s = minSymbolsExact(66);
    assert.equal(s, 69);
    assert.ok(211n ** 69n >= 2n ** 528n);
    assert.ok(211n ** 68n < 2n ** 528n, '69 가 최소가 아니면 안 된다');
  });

  test('음수·비정수 거부', () => {
    for (const bad of [-1, 1.5, NaN, '3']) {
      assert.throws(() => minSymbolsExact(bad), RangeError);
      assert.throws(() => symbolCountForBytes(bad), RangeError);
    }
  });
});

describe('길이 ↔ 심볼 개수 대응', () => {
  test('symbolCountForByteLength: 완전 청크 + 꼬리', () => {
    assert.equal(symbolCountForByteLength(0), 0);
    assert.equal(symbolCountForByteLength(27), 28);
    assert.equal(symbolCountForByteLength(54), 56);
    assert.equal(symbolCountForByteLength(66), symbolCountForByteLength(54) + minSymbolsExact(12));
  });

  test('byteLengthForSymbolCount 는 symbolCountForByteLength 의 역', () => {
    for (let len = 0; len <= 200; len += 1) {
      assert.equal(byteLengthForSymbolCount(symbolCountForByteLength(len)), len, `len=${len}`);
    }
  });

  test('청크 분해가 불가능한 심볼 개수는 거부', () => {
    // 꼬리로 나올 수 없는 나머지 값(0과 28 사이에서 실제 표에 없는 것)을 하나 골라 확인.
    const validTails = new Set();
    for (let m = 0; m <= 27; m += 1) validTails.add(minSymbolsExact(m));
    let badRem = -1;
    for (let r = 0; r < 28; r += 1) {
      if (!validTails.has(r)) {
        badRem = r;
        break;
      }
    }
    assert.notEqual(badRem, -1, '테스트 전제 실패: 불가능한 나머지가 없다');
    assert.throws(() => byteLengthForSymbolCount(badRem), RangeError);
  });
});

describe('엔디안 / 심볼 순서 계약', () => {
  test('바이트는 빅엔디안', () => {
    assert.equal(bytesToBigInt(Uint8Array.from([0x00, 0x01])), 1n);
    assert.equal(bytesToBigInt(Uint8Array.from([0x01, 0x00])), 256n);
  });

  test('심볼은 MSD first: 값 1, 1바이트 → 심볼 2개(211 < 256 이라 1바이트도 2심볼 필요) [0,1]', () => {
    // ceil(8/log2(211)) = 2 — 1바이트로도 211^1(211) < 256 이라 심볼 1개로는 못 담는다.
    const symbols = bytesToSymbols(Uint8Array.from([0x01]));
    assert.deepEqual([...symbols], [0, 1]);
  });

  test('bigIntToSymbols / symbolsToBigInt 왕복', () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 300; i += 1) {
      const symbolCount = 1 + Math.floor(rng() * 28);
      const max = 211n ** BigInt(symbolCount);
      const v = BigInt(Math.floor(rng() * 1e9)) * BigInt(Math.floor(rng() * 1e9)) % max;
      const out = new Uint8Array(symbolCount);
      bigIntToSymbols(v, symbolCount, out, 0);
      assert.equal(symbolsToBigInt(out), v, `symbolCount=${symbolCount}`);
    }
  });

  test('bytesToBigInt / bigIntToBytes 왕복', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i += 1) {
      const len = 1 + Math.floor(rng() * 27);
      const bytes = randomBytes(rng, len);
      const v = bytesToBigInt(bytes);
      const back = new Uint8Array(len);
      bigIntToBytes(v, back, 0, len);
      assert.deepEqual([...back], [...bytes]);
    }
  });
});

describe('바이트 ↔ 심볼 왕복', () => {
  test(`고정 길이 ${ROUND_TRIP_LENGTHS.join(', ')} (패턴 바이트)`, () => {
    for (const len of ROUND_TRIP_LENGTHS) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) bytes[i] = (i * 37 + 11) & 0xff;
      const symbols = bytesToSymbols(bytes);
      assert.equal(symbols.length, symbolCountForByteLength(len), `len=${len} 심볼 개수`);
      for (const s of symbols) assert.ok(isLegalSymbolValue(s), `len=${len} 심볼 범위 밖: ${s}`);
      assert.deepEqual([...symbolsToBytes(symbols, len)], [...bytes], `len=${len} 왕복 실패`);
    }
  });

  test('고정 시드 랜덤 다수 (길이 0..200, 300회)', () => {
    const rng = mulberry32(0x5eed);
    for (let i = 0; i < 300; i += 1) {
      const len = Math.floor(rng() * 201);
      const bytes = randomBytes(rng, len);
      const symbols = bytesToSymbols(bytes);
      assert.deepEqual([...symbolsToBytes(symbols, len)], [...bytes], `i=${i}, len=${len}`);
    }
  });

  test('길이 0 은 심볼 0개', () => {
    const symbols = bytesToSymbols(new Uint8Array(0));
    assert.equal(symbols.length, 0);
    assert.equal(symbolsToBytes(symbols, 0).length, 0);
  });

  test('byteLength 생략 시 심볼 개수로 역산해도 같은 결과', () => {
    const rng = mulberry32(99);
    for (const len of ROUND_TRIP_LENGTHS) {
      const bytes = randomBytes(rng, len);
      const symbols = bytesToSymbols(bytes);
      assert.deepEqual([...symbolsToBytes(symbols)], [...bytes], `len=${len}`);
    }
  });

  test('66 B → 69 심볼 라운드트립 (V3 파이프라인의 청커 단계)', () => {
    const rng = mulberry32(660066);
    const bytes = randomBytes(rng, 66);
    const symbols = bytesToSymbols(bytes);
    assert.equal(symbols.length, 69);
    assert.deepEqual([...symbolsToBytes(symbols, 66)], [...bytes]);
  });
});

describe('경계값', () => {
  test('전부 0x00 → 전부 심볼 0, 왕복 성립', () => {
    for (const len of [1, 27, 28, 66]) {
      const bytes = new Uint8Array(len);
      const symbols = bytesToSymbols(bytes);
      assert.ok([...symbols].every((s) => s === 0), `len=${len} 에 0 아닌 심볼`);
      assert.deepEqual([...symbolsToBytes(symbols, len)], [...bytes]);
    }
  });

  test('전부 0xFF → 왕복 성립', () => {
    for (const len of [1, 27, 28, 66]) {
      const bytes = new Uint8Array(len).fill(0xff);
      const symbols = bytesToSymbols(bytes);
      assert.deepEqual([...symbolsToBytes(symbols, len)], [...bytes], `len=${len}`);
    }
  });

  test('27바이트 최대값이 28심볼에 들어간다', () => {
    const bytes = new Uint8Array(27).fill(0xff);
    const maxVal = bytesToBigInt(bytes);
    assert.equal(maxVal, 2n ** 216n - 1n);
    const symbols = bytesToSymbols(bytes);
    assert.equal(symbols.length, CHUNK_SYMBOLS);
    assert.equal(symbolsToBigInt(symbols), maxVal);
    assert.deepEqual([...symbolsToBytes(symbols, 27)], [...bytes]);
  });

  test('꼬리 m=1..26 각각의 최대값이 minSymbolsExact(m) 개에 들어간다', () => {
    for (let m = 1; m <= 26; m += 1) {
      const bytes = new Uint8Array(m).fill(0xff);
      const symbols = bytesToSymbols(bytes);
      assert.equal(symbols.length, minSymbolsExact(m), `m=${m}`);
      assert.equal(symbolsToBigInt(symbols), 2n ** BigInt(8 * m) - 1n, `m=${m} 최대값 손실`);
      assert.deepEqual([...symbolsToBytes(symbols, m)], [...bytes]);
    }
  });

  test('심볼 개수가 부족하면 인코딩이 실패한다 (조용히 잘리지 않는다, 출력도 오염되지 않는다)', () => {
    const out = new Uint8Array(CHUNK_SYMBOLS).fill(99);
    const before = [...out];
    assert.throws(() => bigIntToSymbols(2n ** 216n - 1n, 27, out, 0), RangeError);
    assert.deepEqual([...out], before, '실패 시 출력 버퍼가 오염됐다');

    const out2 = new Uint8Array(3).fill(77);
    const before2 = [...out2];
    assert.throws(() => bigIntToSymbols(211n ** 3n, 3, out2, 0), RangeError, '211^3 은 3심볼에 못 들어감');
    assert.deepEqual([...out2], before2, '실패 시 출력 버퍼가 오염됐다');
  });

  test('바이트 개수가 부족하면 디코딩이 실패하고 출력을 오염시키지 않는다', () => {
    const out = new Uint8Array(2).fill(55);
    const before = [...out];
    assert.throws(() => bigIntToBytes(65536n, out, 0, 2), RangeError, '2^16 은 2바이트에 못 들어감');
    assert.deepEqual([...out], before, '실패 시 출력 버퍼가 오염됐다');
  });
});

describe('심볼 값 범위', () => {
  test('모든 출력 심볼이 {0..210}', () => {
    const rng = mulberry32(0xabcdef);
    for (let i = 0; i < 100; i += 1) {
      const len = Math.floor(rng() * 60);
      const symbols = bytesToSymbols(randomBytes(rng, len));
      for (let j = 0; j < symbols.length; j += 1) {
        assert.ok(isLegalSymbolValue(symbols[j]), `symbol[${j}]=${symbols[j]}`);
      }
    }
  });

  test('범위 밖 심볼 입력은 거부 (211 이상)', () => {
    const symbols = [...bytesToSymbols(Uint8Array.from([1, 2]))];
    symbols[0] = 211;
    assert.throws(() => symbolsToBytes(symbols, 2), RangeError);
    symbols[0] = -1;
    assert.throws(() => symbolsToBytes(symbols, 2), RangeError);
    symbols[0] = 1.5;
    assert.throws(() => symbolsToBytes(symbols, 2), RangeError);
  });

  test('심볼 개수가 선언된 바이트 길이와 안 맞으면 거부', () => {
    const symbols = bytesToSymbols(Uint8Array.from([1, 2, 3]));
    assert.throws(() => symbolsToBytes(symbols, 2), RangeError);
    assert.throws(() => symbolsToBytes(symbols, 4), RangeError);
  });
});

describe('청크 독립성 / 스트리밍', () => {
  test('27배수 경계에서 잘라 붙여도 결과가 같다', () => {
    const rng = mulberry32(1234);
    const bytes = randomBytes(rng, 54);
    const head = bytes.subarray(0, 27);
    const tail = bytes.subarray(27);
    const joined = [...bytesToSymbols(head), ...bytesToSymbols(tail)];
    assert.deepEqual([...bytesToSymbols(bytes)], joined);
  });

  test('꼬리가 있는 지점에서 자르면 이어붙인 결과가 달라진다 (경계 규약 확인)', () => {
    const rng = mulberry32(4321);
    const bytes = randomBytes(rng, 9);
    const joined = [...bytesToSymbols(bytes.subarray(0, 3)), ...bytesToSymbols(bytes.subarray(3))];
    assert.notDeepEqual([...bytesToSymbols(bytes)], joined);
  });

  test('iterSymbols 는 bytesToSymbols 와 같은 열을 흘린다', () => {
    const rng = mulberry32(555);
    for (const len of ROUND_TRIP_LENGTHS) {
      const bytes = randomBytes(rng, len);
      assert.deepEqual([...iterSymbols(bytes)], [...bytesToSymbols(bytes)], `len=${len}`);
    }
  });

  test('encodeChunkInto / decodeChunkInto 단일 청크 왕복', () => {
    const rng = mulberry32(4242);
    const symbols = new Uint8Array(CHUNK_SYMBOLS);
    for (let trial = 0; trial < 200; trial += 1) {
      const m = 1 + Math.floor(rng() * 27);
      const bytes = randomBytes(rng, m);
      const n = encodeChunkInto(bytes, 0, m, symbols, 0);
      assert.equal(n, minSymbolsExact(m));
      const back = new Uint8Array(m);
      assert.equal(decodeChunkInto(symbols, 0, m, back, 0), n);
      assert.deepEqual([...back], [...bytes], `m=${m}`);
    }
  });

  test('청크 길이 범위 밖은 거부', () => {
    const out = new Uint8Array(CHUNK_SYMBOLS);
    const bytes = new Uint8Array(40);
    assert.throws(() => encodeChunkInto(bytes, 0, 0, out, 0), RangeError);
    assert.throws(() => encodeChunkInto(bytes, 0, 28, out, 0), RangeError);
  });
});

describe('결정성', () => {
  test('같은 입력을 반복 변환하면 항상 같은 출력', () => {
    const rng = mulberry32(2026);
    const bytes = randomBytes(rng, 137);
    const first = [...bytesToSymbols(bytes)];
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual([...bytesToSymbols(bytes)], first);
    }
    const back = [...symbolsToBytes(Uint8Array.from(first), 137)];
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual([...symbolsToBytes(Uint8Array.from(first), 137)], back);
    }
  });

  test('입력 배열을 변형하지 않는다', () => {
    const bytes = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const copy = [...bytes];
    bytesToSymbols(bytes);
    assert.deepEqual([...bytes], copy);
  });
});

describe('타입 검사', () => {
  test('bytesToSymbols 는 Uint8Array 만 받는다', () => {
    assert.throws(() => bytesToSymbols([1, 2, 3]), TypeError);
    assert.throws(() => bytesToSymbols('abc'), TypeError);
    assert.throws(() => bytesToSymbols(null), TypeError);
  });

  test('symbolsToBytes 는 일반 배열도 받는다 (디코더가 만든 배열)', () => {
    const symbols = [...bytesToSymbols(Uint8Array.from([0xde, 0xad]))];
    assert.deepEqual([...symbolsToBytes(symbols, 2)], [0xde, 0xad]);
  });
});

describe('구간 가드 — 조용한 절단·위장 실패 방지 (검증 라운드 지적 반영)', () => {
  test('쓰기: out 버퍼가 짧으면 쓰기 전에 던진다 (typed array 는 범위 밖 쓰기를 조용히 버린다)', () => {
    const short = new Uint8Array(3);
    assert.throws(() => bigIntToBytes(1n, short, 0, 5), /구간|배열 길이/);
    assert.throws(() => bigIntToSymbols(1n, 5, short, 0), /구간|배열 길이/);
    // 실패 후 버퍼가 오염되지 않았는가
    assert.deepEqual([...short], [0, 0, 0]);
  });

  test('읽기: offset 이 배열 길이를 넘으면 0n 위장 대신 던진다', () => {
    const arr = new Uint8Array([1, 2, 3]);
    assert.throws(() => bytesToBigInt(arr, 5), /개수|offset/);
    assert.throws(() => symbolsToBigInt(arr, 5), /개수|offset/);
  });

  test('경계 정확성: offset+count == length 는 허용, +1 은 거부', () => {
    const arr = new Uint8Array([1, 2, 3, 4]);
    assert.equal(bytesToBigInt(arr, 2, 2), (3n << 8n) | 4n);
    assert.throws(() => bytesToBigInt(arr, 2, 3), /구간/);
  });
});
