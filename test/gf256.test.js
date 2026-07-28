/**
 * gf256.test.js — GF(2^8) 산술의 **정의적 성질** 검증
 *
 * 원칙: 외부 테스트 벡터를 베끼지 않는다. 체 공리와 다항식 정의로부터
 * 검증하고, 곱셈만은 log/antilog 경로와 **완전히 독립인 두 번째 구현**
 * (carry-less 곱 + 다항식 축약) 으로 전수 교차검증한다.
 * 테이블 오프바이원(길이 255 vs 512, log(0) 처리, mod-255 wrap)은
 * 이 교차검증과 경계 테스트가 아니면 대부분 조용히 통과한다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRIMITIVE_POLY,
  GENERATOR,
  FIELD_SIZE,
  MULTIPLICATIVE_ORDER,
  EXP,
  LOG,
  add,
  sub,
  mul,
  div,
  inverse,
  log,
  pow,
  alphaPow,
  polyScale,
  polyAdd,
  polyMul,
  polyDiv,
  polyEval,
  polyTrim,
  createField,
  defaultField,
} from '../src/gf256.js';

// ── 테스트 전용 도구 ────────────────────────────────────────────────────

/** 결정적 PRNG (mulberry32) — 고정 시드로 재현 가능한 표본을 뽑는다. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * **독립 구현**: log/exp 테이블을 전혀 쓰지 않는 GF(2^8) 곱.
 * 비트별 carry-less 곱 후 원시 다항식으로 축약한다.
 * 소스의 clmulReduce 와 논리가 같지만 여기서 다시 작성한 것이 요점이다 —
 * 소스는 이 결과로 테이블을 만들고, 런타임 mul 은 테이블 색인이라
 * 두 경로는 실제로 다른 계산이다.
 */
function refMul(a, b, poly = PRIMITIVE_POLY) {
  let acc = 0;
  for (let i = 0; i < 8; i++) {
    if (((b >> i) & 1) !== 0) acc ^= (a & 0xff) << i;
  }
  for (let bit = 14; bit >= 8; bit--) {
    if (((acc >> bit) & 1) !== 0) acc ^= poly << (bit - 8);
  }
  return acc & 0xff;
}

/** 반복 곱으로 계산한 거듭제곱 (pow 의 독립 기준) */
function refPow(a, n) {
  let acc = 1;
  for (let i = 0; i < n; i++) acc = refMul(acc, a);
  return acc;
}

/** big-endian 다항식의 순진한 평가 (Horner 의 독립 기준) */
function refPolyEval(p, x) {
  let acc = 0;
  const deg = p.length - 1;
  for (let i = 0; i < p.length; i++) {
    acc ^= refMul(p[i] & 0xff, refPow(x, deg - i));
  }
  return acc;
}

function randPoly(rand, len) {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

// ── 테이블 구조와 경계 ──────────────────────────────────────────────────

describe('log/antilog 테이블 — 구조와 경계', () => {
  test('테이블 크기: EXP 는 512, LOG 는 256', () => {
    // EXP 가 255 길이면 mul 의 LOG[a]+LOG[b] (최대 508) 가 범위를 벗어난다.
    assert.equal(LOG.length, FIELD_SIZE);
    assert.ok(EXP.length >= 2 * MULTIPLICATIVE_ORDER - 1, `EXP.length=${EXP.length}`);
  });

  test('log(0) 은 정의되지 않는다 — 센티넬 -1, 함수는 예외', () => {
    assert.equal(LOG[0], -1);
    assert.throws(() => log(0), RangeError);
  });

  test('EXP[0] = 1, LOG[1] = 0, EXP[255] = 1 (wrap 경계)', () => {
    assert.equal(EXP[0], 1);
    assert.equal(LOG[1], 0);
    assert.equal(EXP[MULTIPLICATIVE_ORDER], 1);
  });

  test('순환 복제: EXP[i] === EXP[i + 255] (색인 범위 전체)', () => {
    for (let i = 0; i + MULTIPLICATIVE_ORDER < EXP.length; i++) {
      assert.equal(EXP[i], EXP[i + MULTIPLICATIVE_ORDER], `i=${i}`);
    }
  });

  test('EXP[0..254] 는 1..255 의 순열 (0 은 나오지 않는다)', () => {
    const seen = new Set();
    for (let i = 0; i < MULTIPLICATIVE_ORDER; i++) {
      assert.notEqual(EXP[i], 0, `EXP[${i}] 가 0`);
      seen.add(EXP[i]);
    }
    assert.equal(seen.size, MULTIPLICATIVE_ORDER);
  });

  test('exp / log 는 서로 역함수', () => {
    for (let a = 1; a < FIELD_SIZE; a++) assert.equal(EXP[LOG[a]], a, `a=${a}`);
    for (let i = 0; i < MULTIPLICATIVE_ORDER; i++) assert.equal(LOG[EXP[i]], i, `i=${i}`);
  });

  test('α 의 위수는 정확히 255 (원시원소)', () => {
    assert.equal(alphaPow(MULTIPLICATIVE_ORDER), 1);
    for (let k = 1; k < MULTIPLICATIVE_ORDER; k++) {
      assert.notEqual(alphaPow(k), 1, `α^${k} = 1 — 위수가 255 미만`);
    }
  });

  test('alphaPow 는 음수·255 이상 지수를 mod 255 로 감싼다', () => {
    assert.equal(alphaPow(-1), inverse(GENERATOR));
    assert.equal(alphaPow(-255), 1);
    assert.equal(alphaPow(256), GENERATOR);
    assert.equal(alphaPow(1000), alphaPow(1000 % 255));
    assert.throws(() => alphaPow(1.5), TypeError);
  });
});

// ── 곱셈: 독립 구현과 전수 교차검증 ─────────────────────────────────────

describe('곱셈 — 독립 구현 교차검증', () => {
  test('mul(a,b) === carry-less 곱 후 다항식 축약 (전수 256×256)', () => {
    for (let a = 0; a < FIELD_SIZE; a++) {
      for (let b = 0; b < FIELD_SIZE; b++) {
        assert.equal(mul(a, b), refMul(a, b), `a=${a}, b=${b}`);
      }
    }
  });

  test('EXP 테이블 자체가 α 의 거듭제곱과 일치 (전수)', () => {
    let x = 1;
    for (let i = 0; i < MULTIPLICATIVE_ORDER; i++) {
      assert.equal(EXP[i], x, `i=${i}`);
      x = refMul(x, GENERATOR);
    }
    assert.equal(x, 1);
  });
});

// ── 체 공리 ─────────────────────────────────────────────────────────────

describe('체 공리', () => {
  test('덧셈은 XOR, 뺄셈은 덧셈과 동일, a+a = 0', () => {
    const rand = rng(0xa11ce);
    for (let i = 0; i < 5000; i++) {
      const a = Math.floor(rand() * 256);
      const b = Math.floor(rand() * 256);
      assert.equal(add(a, b), a ^ b);
      assert.equal(sub(a, b), add(a, b));
      assert.equal(add(a, a), 0);
      assert.equal(add(a, 0), a);
    }
  });

  test('곱셈 교환법칙 (전수)', () => {
    for (let a = 0; a < FIELD_SIZE; a++) {
      for (let b = a; b < FIELD_SIZE; b++) {
        assert.equal(mul(a, b), mul(b, a), `a=${a}, b=${b}`);
      }
    }
  });

  test('곱셈 항등원·영원 (전수)', () => {
    for (let a = 0; a < FIELD_SIZE; a++) {
      assert.equal(mul(a, 1), a);
      assert.equal(mul(a, 0), 0);
    }
  });

  test('곱셈 결합법칙 (표본 20000 삼중)', () => {
    const rand = rng(0xbeef);
    for (let i = 0; i < 20000; i++) {
      const a = Math.floor(rand() * 256);
      const b = Math.floor(rand() * 256);
      const c = Math.floor(rand() * 256);
      assert.equal(mul(mul(a, b), c), mul(a, mul(b, c)), `${a},${b},${c}`);
    }
  });

  test('분배법칙 a(b+c) = ab + ac (표본 20000 삼중)', () => {
    const rand = rng(0xf00d);
    for (let i = 0; i < 20000; i++) {
      const a = Math.floor(rand() * 256);
      const b = Math.floor(rand() * 256);
      const c = Math.floor(rand() * 256);
      assert.equal(mul(a, add(b, c)), add(mul(a, b), mul(a, c)), `${a},${b},${c}`);
    }
  });

  test('모든 a != 0 에 대해 mul(a, inverse(a)) === 1 (전수)', () => {
    for (let a = 1; a < FIELD_SIZE; a++) {
      assert.equal(mul(a, inverse(a)), 1, `a=${a}`);
      assert.equal(inverse(inverse(a)), a, `a=${a}`);
    }
  });

  test('inverse(0) / div(a, 0) 은 예외', () => {
    assert.throws(() => inverse(0), RangeError);
    assert.throws(() => div(1, 0), RangeError);
    assert.throws(() => div(0, 0), RangeError);
  });

  test('나눗셈은 곱셈의 역: mul(div(a,b), b) === a (전수 a × 표본 b)', () => {
    for (let a = 0; a < FIELD_SIZE; a++) {
      for (let b = 1; b < FIELD_SIZE; b++) {
        assert.equal(mul(div(a, b), b), a, `a=${a}, b=${b}`);
      }
    }
  });

  test('div(0, b) === 0, div(a, 1) === a', () => {
    for (let b = 1; b < FIELD_SIZE; b++) assert.equal(div(0, b), 0);
    for (let a = 0; a < FIELD_SIZE; a++) assert.equal(div(a, 1), a);
  });
});

// ── 거듭제곱 ────────────────────────────────────────────────────────────

describe('pow', () => {
  test('pow(a, n) === 반복 곱 (모든 a, n = 0..20)', () => {
    for (let a = 0; a < FIELD_SIZE; a++) {
      for (let n = 0; n <= 20; n++) {
        assert.equal(pow(a, n), a === 0 && n > 0 ? 0 : refPow(a, n), `a=${a}, n=${n}`);
      }
    }
  });

  test('페르마: a^255 = 1 (a != 0), a^256 = a', () => {
    for (let a = 1; a < FIELD_SIZE; a++) {
      assert.equal(pow(a, MULTIPLICATIVE_ORDER), 1, `a=${a}`);
      assert.equal(pow(a, MULTIPLICATIVE_ORDER + 1), a, `a=${a}`);
    }
  });

  test('음수 지수 = 역원의 거듭제곱', () => {
    for (let a = 1; a < FIELD_SIZE; a++) {
      for (let n = 1; n <= 5; n++) {
        assert.equal(pow(a, -n), inverse(pow(a, n)), `a=${a}, n=${n}`);
      }
    }
  });

  test('0 의 거듭제곱 경계: 0^0 = 1, 0^n = 0 (n>0), 0^-1 은 예외', () => {
    assert.equal(pow(0, 0), 1);
    assert.equal(pow(0, 1), 0);
    assert.equal(pow(0, 7), 0);
    assert.throws(() => pow(0, -1), RangeError);
  });

  test('정수가 아닌 지수는 예외', () => {
    assert.throws(() => pow(2, 1.5), TypeError);
    assert.throws(() => pow(2, NaN), TypeError);
  });
});

// ── 다항식 연산 ─────────────────────────────────────────────────────────

describe('다항식 연산 (big-endian)', () => {
  test('polyEval(Horner) === 순진한 Σ c_i x^(deg-i)', () => {
    const rand = rng(0x1234);
    for (let trial = 0; trial < 400; trial++) {
      const p = randPoly(rand, 1 + Math.floor(rand() * 12));
      const x = Math.floor(rand() * 256);
      assert.equal(polyEval(p, x), refPolyEval(p, x), `p=[${p}] x=${x}`);
    }
  });

  test('polyEval 경계: 빈 다항식 = 0, 상수항만 = 그 값', () => {
    assert.equal(polyEval(new Uint8Array(0), 7), 0);
    assert.equal(polyEval(Uint8Array.of(0xab), 0), 0xab);
    assert.equal(polyEval(Uint8Array.of(0xab), 0xff), 0xab);
  });

  test('평가 준동형: (p·q)(x) === p(x)·q(x)', () => {
    const rand = rng(0x5678);
    for (let trial = 0; trial < 500; trial++) {
      const p = randPoly(rand, 1 + Math.floor(rand() * 8));
      const q = randPoly(rand, 1 + Math.floor(rand() * 8));
      const x = Math.floor(rand() * 256);
      assert.equal(polyEval(polyMul(p, q), x), mul(polyEval(p, x), polyEval(q, x)));
    }
  });

  test('평가 준동형: (p+q)(x) === p(x) ^ q(x) (길이 달라도)', () => {
    const rand = rng(0x9abc);
    for (let trial = 0; trial < 500; trial++) {
      const p = randPoly(rand, 1 + Math.floor(rand() * 10));
      const q = randPoly(rand, 1 + Math.floor(rand() * 10));
      const x = Math.floor(rand() * 256);
      assert.equal(polyEval(polyAdd(p, q), x), polyEval(p, x) ^ polyEval(q, x));
    }
  });

  test('polyMul 차수 = deg p + deg q (선행계수 != 0 일 때)', () => {
    const rand = rng(0xdef0);
    for (let trial = 0; trial < 200; trial++) {
      const p = randPoly(rand, 1 + Math.floor(rand() * 8));
      const q = randPoly(rand, 1 + Math.floor(rand() * 8));
      p[0] = 1 + Math.floor(rand() * 255);
      q[0] = 1 + Math.floor(rand() * 255);
      const r = polyMul(p, q);
      assert.equal(r.length, p.length + q.length - 1);
      assert.equal(r[0], mul(p[0], q[0]));
      assert.notEqual(r[0], 0);
    }
  });

  test('polyScale: (c·p)(x) === c·p(x)', () => {
    const rand = rng(0x2468);
    for (let trial = 0; trial < 300; trial++) {
      const p = randPoly(rand, 1 + Math.floor(rand() * 10));
      const c = Math.floor(rand() * 256);
      const x = Math.floor(rand() * 256);
      assert.equal(polyEval(polyScale(p, c), x), mul(c, polyEval(p, x)));
    }
  });

  test('polyDiv: dividend === quotient·divisor + remainder (배열 단위 복원)', () => {
    const rand = rng(0x13579);
    for (let trial = 0; trial < 400; trial++) {
      const dLen = 2 + Math.floor(rand() * 8);
      const nLen = dLen + Math.floor(rand() * 12);
      const divisor = randPoly(rand, dLen);
      divisor[0] = 1 + Math.floor(rand() * 255); // 선행계수 != 0
      const dividend = randPoly(rand, nLen);
      const { quotient, remainder } = polyDiv(dividend, divisor);

      assert.equal(remainder.length, dLen - 1, '나머지 길이 = deg(divisor)');
      const back = polyAdd(polyMul(quotient, divisor), remainder);
      assert.deepEqual(Array.from(back), Array.from(dividend));
    }
  });

  test('polyDiv: 나머지 차수 < 제수 차수 + 평가로도 항등식 성립', () => {
    const rand = rng(0x2468ace);
    for (let trial = 0; trial < 200; trial++) {
      const divisor = randPoly(rand, 3 + Math.floor(rand() * 5));
      divisor[0] = 1 + Math.floor(rand() * 255);
      const dividend = randPoly(rand, divisor.length + 5);
      const { quotient, remainder } = polyDiv(dividend, divisor);
      assert.ok(remainder.length < divisor.length, '나머지 차수가 제수 차수 이상');
      const x = 1 + Math.floor(rand() * 255);
      assert.equal(
        polyEval(dividend, x),
        mul(polyEval(quotient, x), polyEval(divisor, x)) ^ polyEval(remainder, x),
        `x=${x}`,
      );
    }
  });

  test('polyDiv 경계: 피제수가 제수보다 짧으면 몫 0, 나머지 = 피제수', () => {
    const dividend = Uint8Array.of(3, 4);
    const divisor = Uint8Array.of(1, 2, 3, 4);
    const { quotient, remainder } = polyDiv(dividend, divisor);
    assert.deepEqual(Array.from(quotient), [0]);
    assert.deepEqual(Array.from(remainder), [0, 3, 4]);
  });

  test('polyDiv: 0 다항식으로 나누면 예외', () => {
    assert.throws(() => polyDiv(Uint8Array.of(1, 2, 3), Uint8Array.of(0)), RangeError);
    assert.throws(() => polyDiv(Uint8Array.of(1, 2, 3), Uint8Array.of(0, 0, 0)), RangeError);
  });

  test('polyDiv: 비모닉 제수도 정확 (선행계수로 나눠야 함)', () => {
    // (x^2 + 1) 을 (3x + 5) 로 나눈 뒤 복원되는지
    const dividend = Uint8Array.of(1, 0, 1);
    const divisor = Uint8Array.of(3, 5);
    const { quotient, remainder } = polyDiv(dividend, divisor);
    const back = polyAdd(polyMul(quotient, divisor), remainder);
    assert.deepEqual(Array.from(back), [1, 0, 1]);
  });

  test('polyTrim: 선행 0 제거, 전부 0 이면 [0]', () => {
    assert.deepEqual(Array.from(polyTrim(Uint8Array.of(0, 0, 5, 6))), [5, 6]);
    assert.deepEqual(Array.from(polyTrim(Uint8Array.of(0, 0, 0))), [0]);
    assert.deepEqual(Array.from(polyTrim(Uint8Array.of(7))), [7]);
    assert.deepEqual(Array.from(polyTrim(new Uint8Array(0))), [0]);
  });
});

// ── 체 교체 가능성 ──────────────────────────────────────────────────────

describe('createField — 원시 다항식 교체', () => {
  test('기본 체는 PRIMITIVE_POLY / GENERATOR 를 쓴다', () => {
    assert.equal(defaultField.primitivePoly, PRIMITIVE_POLY);
    assert.equal(defaultField.generator, GENERATOR);
    assert.equal(PRIMITIVE_POLY, 0x11d);
  });

  test('AES 다항식 0x11B 에서 2 는 원시원소가 아니다 → 예외', () => {
    // 0x11B 는 기약이지만 x(=2) 의 위수가 51 이라 RS 에 쓸 수 없다.
    // 이 예외가 없으면 절반쯤 채워진 테이블로 조용히 오동작한다.
    assert.throws(() => createField(0x11b, 2), /원시원소가 아니다/);
  });

  test('0x11B + 생성원 3 은 정상 체를 만든다 (다항식 교체 가능성 증명)', () => {
    const f = createField(0x11b, 3);
    for (let a = 1; a < FIELD_SIZE; a++) {
      assert.equal(f.mul(a, f.inverse(a)), 1, `a=${a}`);
      assert.equal(f.EXP[f.LOG[a]], a, `a=${a}`);
    }
    assert.equal(f.alphaPow(MULTIPLICATIVE_ORDER), 1);
    // 다른 체이므로 곱셈 결과 자체는 기본 체와 달라야 정상
    let differs = false;
    for (let a = 2; a < 64 && !differs; a++) {
      for (let b = 2; b < 64; b++) {
        if (f.mul(a, b) !== mul(a, b)) {
          differs = true;
          break;
        }
      }
    }
    assert.ok(differs, '다른 원시 다항식인데 곱셈표가 완전히 같다 — poly 가 무시되고 있다');
  });

  test('교체 체의 곱도 그 체의 다항식으로 한 독립 계산과 일치 (전수)', () => {
    const f = createField(0x11b, 3);
    for (let a = 0; a < FIELD_SIZE; a++) {
      for (let b = 0; b < FIELD_SIZE; b++) {
        assert.equal(f.mul(a, b), refMul(a, b, 0x11b), `a=${a}, b=${b}`);
      }
    }
  });

  test('잘못된 인자는 예외', () => {
    assert.throws(() => createField(0xff, 2), RangeError); // 8비트 이하
    assert.throws(() => createField(0x200, 2), RangeError); // 10비트
    assert.throws(() => createField(0x11d, 1), RangeError); // 생성원 1
    assert.throws(() => createField(0x11d, 0), RangeError);
  });
});
