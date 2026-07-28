// lehmer.js — base-6 digit ↔ (T,L,R) 휘도 순위 매핑
//
// SPEC §4.1 계약:
//   셀당 3면(T=상단, L=좌측, R=우측)에 서로 다른 휘도 순위 {0=어두움, 1=중간, 2=밝음}을
//   배정한다. 3! = 6 가지 → 심볼 알파벳 = base-6 digit {0..5}.
//
// 이 모듈은 SPEC §4.1 의 표를 **하드코딩하지 않는다.** 표준 Lehmer 코드
// (factorial number system) 로부터 알고리즘적으로 유도한다. 유도 규약은 다음 셋의 조합이며,
// 이 조합만이 SPEC 표 6행 전부를 재현한다 (test/lehmer.test.js 가 이를 단언한다):
//
//   (1) factoradic 자릿수는 **최상위 우선**(MSD-first):
//         d = L[0]·2! + L[1]·1! + L[2]·0!,  L[i] ∈ [0, n-1-i]
//   (2) 알파벳은 면의 **정준 오름차순** [T, L, R] (인덱스 0,1,2)
//   (3) Lehmer 가 뽑아낸 순열은 "**밝은 면부터 어두운 면 순서**"로 읽는다.
//         → 위치 i 에 놓인 면의 순위 = (n-1) - i
//
// (3) 이 핵심이다. Lehmer 순열을 "면별 순위"로 곧이곧대로 읽으면 SPEC 표와 어긋난다
// (그 둘은 서로 역순열 관계). "순위별 면의 나열"로 읽고 내림차순 순위를 배정해야
// SPEC 표가 나온다.
//
// 유도 예 (d=3):
//   factoradic(3) = [1,1,0]
//   pool=[T,L,R] → L 선택 → pool=[T,R] → R 선택 → pool=[T] → T
//   밝기순 나열 = [L, R, T]  → L=2(밝음), R=1(중간), T=0(어두움)
//   → (T,L,R) = (0,2,1)   == SPEC §4.1 digit 3 ✓

/** 면 라벨 정준 순서. 인덱스가 곧 Lehmer 알파벳의 순서다 (SPEC §3.2). */
export const FACES = Object.freeze(['T', 'L', 'R']);

/** 면의 개수 n. 순열 개수 = n! = 6. */
export const FACE_COUNT = FACES.length;

/** 심볼 알파벳 크기 = 3! = 6 (SPEC §4.1). */
export const RADIX = factorial(FACE_COUNT);

/** 최대 순위 값 (2 = 가장 밝음). */
export const MAX_RANK = FACE_COUNT - 1;

/** 팩토리얼. n 이 3 이라 재귀 깊이 걱정 없음. */
function factorial(n) {
  let acc = 1;
  for (let i = 2; i <= n; i += 1) acc *= i;
  return acc;
}

/**
 * digit → factoradic (Lehmer) 자릿수 배열. 최상위 우선.
 * L[i] ∈ [0, n-1-i], 가중치 (n-1-i)!.
 * @param {number} digit 0..n!-1
 * @param {number} n 원소 개수
 * @returns {number[]} 길이 n 의 Lehmer 코드
 */
export function toLehmerCode(digit, n = FACE_COUNT) {
  assertDigit(digit);
  const code = new Array(n);
  let rest = digit;
  for (let i = 0; i < n; i += 1) {
    const weight = factorial(n - 1 - i);
    code[i] = Math.floor(rest / weight);
    rest -= code[i] * weight;
  }
  return code;
}

/**
 * factoradic (Lehmer) 자릿수 배열 → digit. `toLehmerCode` 의 역.
 * @param {number[]} code
 * @returns {number}
 */
export function fromLehmerCode(code) {
  const n = code.length;
  let digit = 0;
  for (let i = 0; i < n; i += 1) {
    const limit = n - 1 - i;
    if (!Number.isInteger(code[i]) || code[i] < 0 || code[i] > limit) {
      throw new RangeError(`Lehmer 코드 자릿수 범위 위반: code[${i}]=${code[i]}, 허용 0..${limit}`);
    }
    digit += code[i] * factorial(limit);
  }
  return digit;
}

/**
 * digit → 밝은 면부터 어두운 면 순서로 나열한 **면 인덱스 배열**.
 * 위 규약 (3) 의 중간 산출물이며, 렌더러 디버깅에 유용해 공개한다.
 * @param {number} digit 0..5
 * @returns {number[]} 예: digit 3 → [1, 2, 0]  (L, R, T 순으로 밝음)
 */
export function digitToBrightnessOrder(digit) {
  const code = toLehmerCode(digit, FACE_COUNT);
  // pool: 아직 배치되지 않은 면 인덱스 (정준 오름차순 유지)
  const pool = [];
  for (let i = 0; i < FACE_COUNT; i += 1) pool.push(i);
  const order = new Array(FACE_COUNT);
  for (let i = 0; i < FACE_COUNT; i += 1) {
    order[i] = pool.splice(code[i], 1)[0];
  }
  return order;
}

/**
 * 밝기순 면 인덱스 배열 → digit. `digitToBrightnessOrder` 의 역.
 * @param {number[]} order
 * @returns {number}
 */
export function brightnessOrderToDigit(order) {
  assertPermutation(order, FACE_COUNT, '밝기 순서');
  const pool = [];
  for (let i = 0; i < FACE_COUNT; i += 1) pool.push(i);
  const code = new Array(FACE_COUNT);
  for (let i = 0; i < FACE_COUNT; i += 1) {
    const at = pool.indexOf(order[i]);
    code[i] = at;
    pool.splice(at, 1);
  }
  return fromLehmerCode(code);
}

/**
 * SPEC §4.1: digit → 각 면의 휘도 순위.
 * @param {number} digit 0..5
 * @returns {{T: number, L: number, R: number}} 각 값은 {0,1,2} 의 순열
 */
export function digitToRanks(digit) {
  const order = digitToBrightnessOrder(digit);
  const byFace = new Array(FACE_COUNT);
  for (let i = 0; i < FACE_COUNT; i += 1) {
    // 위치 i 는 i 번째로 밝은 면 → 순위 = MAX_RANK - i
    byFace[order[i]] = MAX_RANK - i;
  }
  // 키 삽입 순서는 반드시 정준 FACES 순서 ['T','L','R'] 여야 한다.
  // 밝기 순서대로 삽입하면 digit 마다 키 순서가 달라져 (a) Object.values() 가
  // 어떤 digit 이든 항상 [2,1,0] 을 내고 (b) JSON.stringify 결과가 digit 별로
  // 갈린다. M0 완료 기준이 "동일 입력 → 결정적 출력" 이라 여기가 정확히 함정이다.
  const ranks = {};
  for (let i = 0; i < FACE_COUNT; i += 1) ranks[FACES[i]] = byFace[i];
  return ranks;
}

/**
 * SPEC §4.1 의 역: 각 면의 휘도 순위 → digit.
 * @param {{T: number, L: number, R: number}} ranks
 * @returns {number} 0..5
 */
export function ranksToDigit(ranks) {
  const arr = ranksToArray(ranks);
  assertPermutation(arr, FACE_COUNT, '면 순위');
  // 순위 배열의 역: 순위 r 을 가진 면이 (MAX_RANK - r) 번째로 밝다
  const order = new Array(FACE_COUNT);
  for (let f = 0; f < FACE_COUNT; f += 1) {
    order[MAX_RANK - arr[f]] = f;
  }
  return brightnessOrderToDigit(order);
}

/**
 * 순위 객체 → 정준 순서(T,L,R) 배열. 렌더러/디코더가 배열 형태를 선호할 때 사용.
 * @param {{T: number, L: number, R: number}} ranks
 * @returns {number[]}
 */
export function ranksToArray(ranks) {
  if (ranks === null || typeof ranks !== 'object') {
    throw new TypeError('순위는 {T,L,R} 객체여야 한다');
  }
  return FACES.map((face) => ranks[face]);
}

/**
 * 정준 순서(T,L,R) 배열 → 순위 객체.
 * @param {number[]} arr
 * @returns {{T: number, L: number, R: number}}
 */
export function arrayToRanks(arr) {
  assertPermutation(arr, FACE_COUNT, '면 순위');
  const ranks = {};
  FACES.forEach((face, i) => { ranks[face] = arr[i]; });
  return ranks;
}

/**
 * 순위 객체가 유효한가 ({0..2} 의 순열인가).
 * @param {unknown} ranks
 * @returns {boolean}
 */
export function isValidRanks(ranks) {
  try {
    assertPermutation(ranksToArray(/** @type {any} */ (ranks)), FACE_COUNT, '면 순위');
    return true;
  } catch {
    return false;
  }
}

/**
 * 유도된 매핑 표 전체 (digit 0..5). 테스트·문서·디버깅용.
 * @returns {{digit: number, ranks: {T: number, L: number, R: number}}[]}
 */
export function mappingTable() {
  const rows = [];
  for (let d = 0; d < RADIX; d += 1) rows.push({ digit: d, ranks: digitToRanks(d) });
  return rows;
}

function assertDigit(digit) {
  if (!Number.isInteger(digit) || digit < 0 || digit >= RADIX) {
    throw new RangeError(`digit 범위 위반: ${digit} (허용 0..${RADIX - 1})`);
  }
}

function assertPermutation(arr, n, what) {
  if (!Array.isArray(arr) || arr.length !== n) {
    throw new TypeError(`${what}는 길이 ${n} 배열이어야 한다`);
  }
  const seen = new Set();
  for (const v of arr) {
    if (!Number.isInteger(v) || v < 0 || v >= n) {
      throw new RangeError(`${what} 원소 범위 위반: ${v} (허용 0..${n - 1})`);
    }
    if (seen.has(v)) throw new RangeError(`${what}에 중복 값: ${v}`);
    seen.add(v);
  }
}
