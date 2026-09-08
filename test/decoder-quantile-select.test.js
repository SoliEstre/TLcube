import assert from 'node:assert/strict';
import test from 'node:test';

import { selectThreeQuantilesInPlace } from '../src/decoder/quantile-select.js';

function nativeOracle(input) {
  const sorted = ArrayBuffer.isView(input) ? new input.constructor(input) : [...input];
  if (Array.isArray(sorted)) sorted.sort((left, right) => left - right);
  else sorted.sort();
  const at = fraction => sorted[Math.floor(fraction * (sorted.length - 1))];
  return { p1: at(0.01), p50: at(0.5), p99: at(0.99), count: sorted.length };
}

function token(value) {
  if (Number.isNaN(value)) return 'nan';
  if (Object.is(value, -0)) return '-0';
  if (value === 0) return '+0';
  if (value === Infinity) return '+inf';
  if (value === -Infinity) return '-inf';
  return `n:${value}`;
}

function multiset(values) {
  const counts = new Map();
  for (const value of values) counts.set(token(value), (counts.get(token(value)) ?? 0) + 1);
  return [...counts].sort(([left], [right]) => left.localeCompare(right));
}

function check(input, label = '') {
  const expected = nativeOracle(input);
  const before = multiset(input);
  const actual = selectThreeQuantilesInPlace(input);
  assert.deepEqual(actual, expected, label);
  assert.deepEqual(multiset(input), before, `${label}: multiset`);
}

test('빈 값, 한 값, 작은 중복 배열에서 legacy index를 그대로 쓴다', () => {
  for (const values of [[], [7], [2, 1], [3, 1, 2], [4, 4, 1, 4],
    new Float32Array(), new Float32Array([3]), new Float64Array([2, 2, 1])]) {
    check(values, `${values.constructor.name}:${values.length}`);
  }
});

test('유한 정상 경로는 전체 배열 native sort 없이 패턴들을 처리한다', () => {
  const patterns = [
    Array.from({ length: 257 }, (_, index) => index),
    Array.from({ length: 257 }, (_, index) => 256 - index),
    Array.from({ length: 513 }, (_, index) => index <= 256 ? index : 512 - index),
    Array.from({ length: 1024 }, (_, index) => index % 7),
    Array(1024).fill(11),
  ];
  const originalSort = Array.prototype.sort;
  let forbiddenLength = -1;
  try {
    Array.prototype.sort = function forbiddenFullSort() {
      if (this.length === forbiddenLength) {
        throw new Error('유한 정상 경로에서 전체 Array.sort를 호출했다');
      }
      return originalSort.apply(this, arguments);
    };
    for (const pattern of patterns) {
      const expected = nativeOracleWithSort(pattern, originalSort);
      const before = multisetWithSort(pattern, originalSort);
      forbiddenLength = pattern.length;
      const actual = selectThreeQuantilesInPlace(pattern);
      assert.deepEqual(actual, expected);
      assert.deepEqual(multisetWithSort(pattern, originalSort), before);
    }
  } finally {
    Array.prototype.sort = originalSort;
  }
});

function nativeOracleWithSort(input, sort) {
  const sorted = [...input];
  sort.call(sorted, (left, right) => left - right);
  const at = fraction => sorted[Math.floor(fraction * (sorted.length - 1))];
  return { p1: at(0.01), p50: at(0.5), p99: at(0.99), count: sorted.length };
}

function multisetWithSort(values, sort) {
  const counts = new Map();
  for (const value of values) counts.set(token(value), (counts.get(token(value)) ?? 0) + 1);
  const entries = [...counts];
  sort.call(entries, ([left], [right]) => left.localeCompare(right));
  return entries;
}

test('NaN, infinity, negative zero는 컨테이너별 native legacy sort fallback과 exact 일치한다', () => {
  const specials = [NaN, Infinity, -Infinity, -0, 0, 9, -3, NaN, 4];
  check([...specials], 'Array special');
  check(new Float32Array(specials), 'Float32 special');
  check(new Float64Array(specials), 'Float64 special');
});

test('seeded 1000개 소형 배열과 큰 배열이 native sorted copy oracle과 exact 일치한다', () => {
  let state = 0x6d2b79f5;
  const random = () => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
  for (let caseIndex = 0; caseIndex < 1000; caseIndex += 1) {
    const length = Math.floor(random() * 129);
    const raw = Array.from({ length }, () => Math.floor(random() * 31) - 15);
    const kind = caseIndex % 3;
    check(kind === 0 ? raw : kind === 1 ? new Float32Array(raw) : new Float64Array(raw),
      `seeded-${caseIndex}`);
  }
  const large = Array.from({ length: 100_003 }, (_, index) =>
    ((Math.imul(index ^ 0x9e37, 2654435761) >>> 0) % 2001) - 1000);
  check([...large], 'large Array');
  check(new Float32Array(large), 'large Float32Array');
  check(new Float64Array(large), 'large Float64Array');
});

test('지원 타입과 dense number[] 계약을 검증한다', () => {
  for (const invalid of [null, {}, '123', new Uint8Array([1, 2]), [1, '2'], [1, undefined]]) {
    assert.throws(() => selectThreeQuantilesInPlace(invalid), TypeError);
  }
  const sparse = new Array(3);
  sparse[2] = 1;
  assert.throws(() => selectThreeQuantilesInPlace(sparse), TypeError);
});

test('별도 작업 배열의 원본과 typed subarray 바깥 sentinel을 변경하지 않는다', () => {
  const pixels = [0.9, 0.1, 0.7, 0.3, 0.5];
  const pixelsBefore = [...pixels];
  const pool = [...pixels];
  check(pool, 'independent pool');
  assert.deepEqual(pixels, pixelsBefore, '호출자가 복사한 원 pixel 배열');

  for (const Type of [Float32Array, Float64Array]) {
    const backing = new Type([12345, 9, 1, 7, 3, 5, -12345]);
    const view = backing.subarray(1, -1);
    check(view, `${Type.name} subarray`);
    assert.ok(Object.is(backing[0], 12345), `${Type.name}: left sentinel`);
    assert.ok(Object.is(backing.at(-1), -12345), `${Type.name}: right sentinel`);
  }
});
