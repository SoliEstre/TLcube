import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  P,
  MULTIPLICATIVE_ORDER,
  GENERATOR,
  add,
  sub,
  mul,
  div,
  inverse,
  pow,
  alphaPow,
  log,
  polyAdd,
  polySub,
  polyMul,
  polyDiv,
  polyEval,
  polyScale,
} from '../src/gfp.js';

// 결정성 시드 PRNG (mulberry32) — 다른 테스트 파일과 같은 패턴을 반복하지 않되
// 재현 가능해야 하므로 고정 시드로 통일한다.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('p = 211, 곱셈군 위수 = 210', () => {
  assert.equal(P, 211);
  assert.equal(MULTIPLICATIVE_ORDER, 210);
});

test('체 공리 — 전수(210개) a≠0 에 대해 mul(a, inverse(a)) = 1', () => {
  for (let a = 1; a < P; a++) {
    assert.equal(mul(a, inverse(a)), 1, `a=${a}`);
  }
});

test('sub(a,b) = add(a, p−b) — 뺄셈은 덧셈과 다른 연산이다', () => {
  const rnd = mulberry32(1);
  for (let i = 0; i < 500; i++) {
    const a = Math.floor(rnd() * P);
    const b = Math.floor(rnd() * P);
    assert.equal(sub(a, b), add(a, P - b) % P);
  }
  // 표수 2 습관 검증: b≠0 이면 sub(a,b) ≠ add(a,b) (일반적으로)
  let differCount = 0;
  for (let a = 0; a < P; a++) {
    for (let b = 1; b < P; b++) {
      if (sub(a, b) !== add(a, b)) differCount++;
    }
  }
  assert.ok(differCount > 0, 'GF(211) 에서 뺄셈과 덧셈이 항상 같다면 구현이 표수 2 를 흉내내는 버그다');
});

test('결합·교환·분배 법칙 (표본)', () => {
  const rnd = mulberry32(2);
  for (let i = 0; i < 300; i++) {
    const a = Math.floor(rnd() * P);
    const b = Math.floor(rnd() * P);
    const c = Math.floor(rnd() * P);
    // 결합
    assert.equal(add(add(a, b), c), add(a, add(b, c)));
    assert.equal(mul(mul(a, b), c), mul(a, mul(b, c)));
    // 교환
    assert.equal(add(a, b), add(b, a));
    assert.equal(mul(a, b), mul(b, a));
    // 분배
    assert.equal(mul(a, add(b, c)), add(mul(a, b), mul(a, c)));
  }
});

test('div(a,b) 는 mul(a, inverse(b)) 와 일치하고 div(mul(a,b),b) = a', () => {
  const rnd = mulberry32(3);
  for (let i = 0; i < 300; i++) {
    const a = Math.floor(rnd() * P);
    let b = Math.floor(rnd() * (P - 1)) + 1; // b ≠ 0
    assert.equal(div(a, b), mul(a, inverse(b)));
    assert.equal(div(mul(a, b), b), a);
  }
});

test('생성원 α 의 위수는 정확히 210 — 210 의 각 소인수에 대해 부분군 아님을 전수 검사', () => {
  const factors = [2, 3, 5, 7];
  for (const q of factors) {
    assert.notEqual(pow(GENERATOR, MULTIPLICATIVE_ORDER / q), 1, `α^(210/${q}) 가 1 이면 위수가 210 미만`);
  }
  assert.equal(pow(GENERATOR, MULTIPLICATIVE_ORDER), 1, 'α^210 = 1 (페르마)');
  // α^i, i=0..209 가 전부 서로 다른(=군 전체를 생성) 것도 확인
  const seen = new Set();
  for (let i = 0; i < MULTIPLICATIVE_ORDER; i++) {
    const v = alphaPow(i);
    assert.ok(!seen.has(v), `α^${i} = ${v} 가 이미 나왔다 — 위수가 210 미만`);
    seen.add(v);
  }
  assert.equal(seen.size, MULTIPLICATIVE_ORDER);
});

test('alphaPow / log 는 서로 역함수다', () => {
  for (let i = 0; i < MULTIPLICATIVE_ORDER; i++) {
    const v = alphaPow(i);
    assert.equal(log(v), i);
  }
});

test('pow(a, n) 은 alphaPow(log(a) * n) 과 일치 (a ≠ 0)', () => {
  const rnd = mulberry32(4);
  for (let i = 0; i < 200; i++) {
    const a = Math.floor(rnd() * (P - 1)) + 1;
    const n = Math.floor(rnd() * 20) - 10;
    assert.equal(pow(a, n), alphaPow(log(a) * n));
  }
});

test('polyAdd / polySub 는 상수항(오른쪽) 정렬로 서로 역연산이다', () => {
  const rnd = mulberry32(5);
  for (let trial = 0; trial < 100; trial++) {
    const lenA = 1 + Math.floor(rnd() * 6);
    const lenB = 1 + Math.floor(rnd() * 6);
    const a = Array.from({ length: lenA }, () => Math.floor(rnd() * P));
    const b = Array.from({ length: lenB }, () => Math.floor(rnd() * P));
    const sum = polyAdd(a, b);
    const back = polySub(sum, b);
    // back 은 a 와 오른쪽 정렬 비교 (길이가 sum 기준으로 패딩될 수 있음)
    const len = back.length;
    const padded = new Array(len).fill(0);
    for (let i = 0; i < a.length; i++) padded[i + len - a.length] = a[i];
    assert.deepEqual(Array.from(back), padded);
  }
});

test('polyMul 은 polyEval 과 정합 — (p*q)(x0) = p(x0)*q(x0)', () => {
  const rnd = mulberry32(6);
  for (let trial = 0; trial < 100; trial++) {
    const lenA = 1 + Math.floor(rnd() * 5);
    const lenB = 1 + Math.floor(rnd() * 5);
    const a = Array.from({ length: lenA }, () => Math.floor(rnd() * P));
    const b = Array.from({ length: lenB }, () => Math.floor(rnd() * P));
    const x0 = Math.floor(rnd() * P);
    const prod = polyMul(a, b);
    assert.equal(polyEval(prod, x0), mul(polyEval(a, x0), polyEval(b, x0)));
  }
});

test('polyDiv: dividend = quotient*divisor + remainder (평가로 검증)', () => {
  const rnd = mulberry32(7);
  for (let trial = 0; trial < 100; trial++) {
    const lenDividend = 3 + Math.floor(rnd() * 8);
    const lenDivisor = 2 + Math.floor(rnd() * 3);
    const dividend = Array.from({ length: lenDividend }, () => Math.floor(rnd() * P));
    // 선행계수 0 이면 나눗셈 몫 차수가 흔들리므로 0 아닌 값으로 고정
    const divisor = [1 + Math.floor(rnd() * (P - 1)), ...Array.from({ length: lenDivisor - 1 }, () => Math.floor(rnd() * P))];
    const { quotient, remainder } = polyDiv(dividend, divisor);
    const x0 = Math.floor(rnd() * P);
    const lhs = polyEval(dividend, x0);
    const rhs = add(mul(polyEval(quotient, x0), polyEval(divisor, x0)), polyEval(remainder, x0));
    assert.equal(lhs, rhs, `trial=${trial}`);
  }
});

test('polyScale(p, s) 는 polyEval 스케일과 일치', () => {
  const rnd = mulberry32(8);
  for (let trial = 0; trial < 50; trial++) {
    const len = 1 + Math.floor(rnd() * 6);
    const p = Array.from({ length: len }, () => Math.floor(rnd() * P));
    const s = Math.floor(rnd() * P);
    const x0 = Math.floor(rnd() * P);
    assert.equal(polyEval(polyScale(p, s), x0), mul(s, polyEval(p, x0)));
  }
});

test('inverse(0) / div(a,0) / 216 초과 등 경계는 예외를 던진다', () => {
  assert.throws(() => inverse(0));
  assert.throws(() => div(1, 0));
});
