// lehmer.test.js — SPEC §4.1 매핑 계약 테스트
//
// 가장 중요한 테스트는 `SPEC §4.1 표와의 일치`다. src/lehmer.js 는 표를 하드코딩하지
// 않고 Lehmer 코드로부터 유도하므로, 여기 박아둔 SPEC 표가 SPEC ↔ 구현의 계약이 된다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FACES,
  FACE_COUNT,
  RADIX,
  MAX_RANK,
  toLehmerCode,
  fromLehmerCode,
  digitToBrightnessOrder,
  brightnessOrderToDigit,
  digitToRanks,
  ranksToDigit,
  ranksToArray,
  arrayToRanks,
  isValidRanks,
  mappingTable,
} from '../src/lehmer.js';

/**
 * SPEC.md §4.1 의 표를 그대로 옮긴 것. (T, L, R) 순위.
 * 이 값을 구현에 맞춰 고치는 것은 금지 — 어긋나면 SPEC 쪽 판단이 필요하다.
 */
const SPEC_TABLE = Object.freeze([
  /* digit 0 */ { T: 2, L: 1, R: 0 },
  /* digit 1 */ { T: 2, L: 0, R: 1 },
  /* digit 2 */ { T: 1, L: 2, R: 0 },
  /* digit 3 */ { T: 0, L: 2, R: 1 },
  /* digit 4 */ { T: 1, L: 0, R: 2 },
  /* digit 5 */ { T: 0, L: 1, R: 2 },
]);

describe('상수', () => {
  test('면 라벨은 SPEC §3.2 의 T/L/R 정준 순서', () => {
    assert.deepEqual([...FACES], ['T', 'L', 'R']);
    assert.equal(FACE_COUNT, 3);
  });

  test('알파벳 크기는 3! = 6 (SPEC §4.1)', () => {
    assert.equal(RADIX, 6);
    assert.equal(MAX_RANK, 2);
  });
});

describe('SPEC §4.1 표 일치', () => {
  test('유도된 매핑이 SPEC 표 6행 전부와 정확히 일치', () => {
    for (let d = 0; d < RADIX; d += 1) {
      assert.deepEqual(
        digitToRanks(d),
        SPEC_TABLE[d],
        `digit ${d}: 유도값이 SPEC §4.1 표와 다르다`,
      );
    }
  });

  test('SPEC 표의 역방향도 일치', () => {
    for (let d = 0; d < RADIX; d += 1) {
      assert.equal(ranksToDigit(SPEC_TABLE[d]), d, `SPEC §4.1 digit ${d} 역변환 실패`);
    }
  });

  test('mappingTable() 이 SPEC 표 전체를 재현', () => {
    const rows = mappingTable();
    assert.equal(rows.length, RADIX);
    assert.deepEqual(rows.map((r) => r.digit), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(rows.map((r) => r.ranks), [...SPEC_TABLE]);
  });
});

describe('전단사 (bijection)', () => {
  test('digit → ranks → digit 왕복 (6개 전부)', () => {
    for (let d = 0; d < RADIX; d += 1) {
      assert.equal(ranksToDigit(digitToRanks(d)), d);
    }
  });

  test('digitToRanks 의 상은 서로 다른 6개 (단사)', () => {
    const seen = new Set();
    for (let d = 0; d < RADIX; d += 1) {
      seen.add(ranksToArray(digitToRanks(d)).join(''));
    }
    assert.equal(seen.size, RADIX, '서로 다른 digit 이 같은 순위 배열로 갔다');
  });

  test('3! = 6 가지 순열 전부가 상에 나타난다 (전사)', () => {
    const all = [];
    for (const a of [0, 1, 2]) {
      for (const b of [0, 1, 2]) {
        for (const c of [0, 1, 2]) {
          if (new Set([a, b, c]).size === 3) all.push([a, b, c]);
        }
      }
    }
    assert.equal(all.length, 6);
    const image = new Set();
    for (let d = 0; d < RADIX; d += 1) image.add(ranksToArray(digitToRanks(d)).join(''));
    for (const perm of all) {
      assert.ok(image.has(perm.join('')), `순열 ${perm.join('')} 가 상에 없다`);
    }
  });

  test('ranks → digit → ranks 왕복 (6가지 순열 전부)', () => {
    for (let d = 0; d < RADIX; d += 1) {
      const ranks = digitToRanks(d);
      assert.deepEqual(digitToRanks(ranksToDigit(ranks)), ranks);
    }
  });
});

describe('순위 성질', () => {
  test('모든 digit 에서 3면의 순위가 {0,1,2} 의 순열', () => {
    for (let d = 0; d < RADIX; d += 1) {
      const arr = ranksToArray(digitToRanks(d));
      assert.equal(arr.length, 3);
      assert.deepEqual([...arr].sort(), [0, 1, 2], `digit ${d} 의 순위가 순열이 아니다`);
    }
  });

  test('각 면은 정확히 2개 digit 에서 최고 순위(2)를 갖는다', () => {
    const brightest = { T: 0, L: 0, R: 0 };
    for (let d = 0; d < RADIX; d += 1) {
      const ranks = digitToRanks(d);
      for (const f of FACES) if (ranks[f] === MAX_RANK) brightest[f] += 1;
    }
    assert.deepEqual(brightest, { T: 2, L: 2, R: 2 });
  });

  test('밝기순 나열의 위치 i 는 순위 MAX_RANK - i 에 대응', () => {
    for (let d = 0; d < RADIX; d += 1) {
      const order = digitToBrightnessOrder(d);
      const ranks = digitToRanks(d);
      order.forEach((faceIdx, i) => {
        assert.equal(ranks[FACES[faceIdx]], MAX_RANK - i, `digit ${d}, 위치 ${i}`);
      });
    }
  });
});

describe('Lehmer 코드 (factorial number system)', () => {
  test('digit → 코드 → digit 왕복', () => {
    for (let d = 0; d < RADIX; d += 1) {
      assert.equal(fromLehmerCode(toLehmerCode(d)), d);
    }
  });

  test('코드 자릿수 범위: L[i] ∈ [0, n-1-i], 마지막은 항상 0', () => {
    for (let d = 0; d < RADIX; d += 1) {
      const code = toLehmerCode(d);
      assert.equal(code.length, FACE_COUNT);
      code.forEach((v, i) => {
        assert.ok(Number.isInteger(v) && v >= 0 && v <= FACE_COUNT - 1 - i,
          `digit ${d} code[${i}]=${v} 범위 위반`);
      });
      assert.equal(code[FACE_COUNT - 1], 0);
    }
  });

  test('최상위 우선(MSD-first) 가중치: d = L0·2! + L1·1!', () => {
    for (let d = 0; d < RADIX; d += 1) {
      const [l0, l1] = toLehmerCode(d);
      assert.equal(l0 * 2 + l1 * 1, d);
    }
  });

  test('밝기순 나열은 사전순(lexicographic) 순열 열거와 일치', () => {
    // 표준 Lehmer 의 정의적 성질: digit 이 커지면 순열이 사전순으로 커진다
    const seq = [];
    for (let d = 0; d < RADIX; d += 1) seq.push(digitToBrightnessOrder(d).join(''));
    assert.deepEqual(seq, [...seq].sort(), '사전순 단조성이 깨졌다');
    assert.deepEqual(seq, ['012', '021', '102', '120', '201', '210']);
  });

  test('밝기순 나열 → digit 왕복', () => {
    for (let d = 0; d < RADIX; d += 1) {
      assert.equal(brightnessOrderToDigit(digitToBrightnessOrder(d)), d);
    }
  });
});

describe('배열 ↔ 객체 변환', () => {
  test('ranksToArray / arrayToRanks 왕복', () => {
    for (let d = 0; d < RADIX; d += 1) {
      const ranks = digitToRanks(d);
      assert.deepEqual(arrayToRanks(ranksToArray(ranks)), ranks);
    }
  });

  test('배열 순서는 [T, L, R]', () => {
    const ranks = digitToRanks(0); // SPEC: (2,1,0)
    assert.deepEqual(ranksToArray(ranks), [2, 1, 0]);
  });
});

describe('유효성 검사', () => {
  test('isValidRanks: 순열이면 true', () => {
    for (let d = 0; d < RADIX; d += 1) assert.equal(isValidRanks(digitToRanks(d)), true);
  });

  test('isValidRanks: 중복·범위 위반·결측이면 false', () => {
    assert.equal(isValidRanks({ T: 0, L: 0, R: 1 }), false, '중복');
    assert.equal(isValidRanks({ T: 3, L: 1, R: 0 }), false, '범위 초과');
    assert.equal(isValidRanks({ T: 0, L: 1 }), false, '면 결측');
    assert.equal(isValidRanks({ T: 0, L: 1, R: 1.5 }), false, '비정수');
    assert.equal(isValidRanks(null), false);
    assert.equal(isValidRanks('012'), false);
  });

  test('digitToRanks 는 범위 밖 digit 을 거부', () => {
    for (const bad of [-1, 6, 6.0001, 1.5, NaN, '2', null, undefined]) {
      assert.throws(() => digitToRanks(bad), RangeError, `${String(bad)} 이 통과했다`);
    }
  });

  test('ranksToDigit 은 순열이 아닌 입력을 거부', () => {
    assert.throws(() => ranksToDigit({ T: 0, L: 0, R: 2 }), RangeError);
    assert.throws(() => ranksToDigit({ T: 0, L: 1, R: 3 }), RangeError);
    assert.throws(() => ranksToDigit(null), TypeError);
  });

  test('fromLehmerCode 는 자릿수 범위 위반을 거부', () => {
    assert.throws(() => fromLehmerCode([3, 0, 0]), RangeError, 'L0 > 2');
    assert.throws(() => fromLehmerCode([0, 2, 0]), RangeError, 'L1 > 1');
    assert.throws(() => fromLehmerCode([0, 0, 1]), RangeError, 'L2 > 0');
  });
});

describe('결정성', () => {
  test('같은 digit 을 반복 호출하면 항상 같은 결과', () => {
    for (let round = 0; round < 3; round += 1) {
      for (let d = 0; d < RADIX; d += 1) {
        assert.deepEqual(digitToRanks(d), SPEC_TABLE[d]);
      }
    }
  });

  test('반환 객체는 매번 새 객체 (호출자가 변형해도 오염 없음)', () => {
    const a = digitToRanks(0);
    a.T = 99;
    assert.deepEqual(digitToRanks(0), SPEC_TABLE[0]);
  });
});

describe('결정적 출력 계약 — 키 삽입 순서', () => {
  // M0 완료 기준이 "동일 입력 → 결정적 출력"이다. 값이 맞아도 키 순서가 digit 마다
  // 달라지면 JSON.stringify / Object.values 소비자가 조용히 갈린다. 실제로 초기 구현이
  // 밝기 순서대로 키를 삽입해 이 함정에 빠져 있었다.
  test('digitToRanks 의 키 순서는 항상 정준 FACES 순서', () => {
    for (let d = 0; d < RADIX; d += 1) {
      assert.deepEqual(Object.keys(digitToRanks(d)), [...FACES],
        `digit ${d} 의 키 순서가 FACES 와 다르다`);
    }
  });

  test('Object.values 가 digit 마다 실제로 달라진다 (항상 [2,1,0] 이면 버그)', () => {
    const seen = new Set();
    for (let d = 0; d < RADIX; d += 1) seen.add(JSON.stringify(Object.values(digitToRanks(d))));
    assert.equal(seen.size, RADIX, 'digit 6개의 값 배열이 서로 구별되지 않는다');
  });

  test('JSON 직렬화가 digit 마다 유일하고 arrayToRanks 와 일치', () => {
    const seen = new Set();
    for (let d = 0; d < RADIX; d += 1) {
      const viaDigit = JSON.stringify(digitToRanks(d));
      const viaArray = JSON.stringify(arrayToRanks(ranksToArray(digitToRanks(d))));
      assert.equal(viaDigit, viaArray, `digit ${d}: 두 생성 경로의 직렬화가 다르다`);
      seen.add(viaDigit);
    }
    assert.equal(seen.size, RADIX);
  });
});

describe('앵커 셀 (SPEC §5.2 소비자 확인)', () => {
  test('digit 0 과 5 는 서로 다른 순열이고 각각 유효', () => {
    // SPEC §5.2 는 앵커에 순열 (0,0,5) 를 배정한다 — digit 0 둘 + digit 5 하나.
    // 여기서는 그 digit 들이 이 모듈에서 유효하고 서로 구분된다는 것만 확인한다.
    assert.notDeepEqual(digitToRanks(0), digitToRanks(5));
    assert.deepEqual(digitToRanks(0), { T: 2, L: 1, R: 0 });
    assert.deepEqual(digitToRanks(5), { T: 0, L: 1, R: 2 });
  });
});
