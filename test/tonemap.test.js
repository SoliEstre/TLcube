// tonemap.test.js — Type Y 2톤 배정표·분류기·분리 계약 검증
// (SPEC §14, ADR 0003 v3.1 §4b D9·U14·U17)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  TONE_PATTERNS,
  RHO_MIN,
  digitToPattern,
  patternToDigit,
  thetaFromAnchors,
  classifyTriple,
  assertToneSeparation,
} from '../src/tonemap.js';

// ─────────────────────────────────────────────────────────────────────────────
// D9 배정표
// ─────────────────────────────────────────────────────────────────────────────

describe('TONE_PATTERNS — D9 배정표', () => {
  test('digit 0..5 → (T,L,R) 비트, ADR 0003 v3.1 §4b 그대로', () => {
    assert.deepEqual(TONE_PATTERNS.map((p) => [...p]), [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ]);
  });

  test('전부-밝음·전부-어두움은 표에 없다', () => {
    for (const pattern of TONE_PATTERNS) {
      const sum = pattern[0] + pattern[1] + pattern[2];
      assert.ok(sum !== 0 && sum !== 3, `불법 패턴이 표에 있다: ${pattern}`);
    }
  });

  test('보수쌍 d <-> d+3', () => {
    for (let d = 0; d < 3; d += 1) {
      const a = TONE_PATTERNS[d];
      const b = TONE_PATTERNS[d + 3];
      for (let k = 0; k < 3; k += 1) assert.equal(a[k], 1 - b[k], `d=${d}, bit ${k}`);
    }
  });

  test('d<3 은 단독 밝음 면, d>=3 은 단독 어두움 면(=d-3)', () => {
    for (let d = 0; d < 3; d += 1) {
      const bright = TONE_PATTERNS[d].filter((b) => b === 1).length;
      assert.equal(bright, 1, `d=${d} 단독 밝음 위반`);
    }
    for (let d = 3; d < 6; d += 1) {
      const dark = TONE_PATTERNS[d].filter((b) => b === 0).length;
      assert.equal(dark, 1, `d=${d} 단독 어두움 위반`);
    }
  });

  test('6개 패턴이 서로 전부 다르다', () => {
    const keys = new Set(TONE_PATTERNS.map((p) => p.join('')));
    assert.equal(keys.size, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// digitToPattern / patternToDigit 왕복
// ─────────────────────────────────────────────────────────────────────────────

describe('digitToPattern / patternToDigit', () => {
  test('digit 0..5 전부 왕복', () => {
    for (let d = 0; d < 6; d += 1) {
      const pattern = digitToPattern(d);
      assert.deepEqual(pattern, { T: TONE_PATTERNS[d][0], L: TONE_PATTERNS[d][1], R: TONE_PATTERNS[d][2] });
      assert.equal(patternToDigit(pattern.T, pattern.L, pattern.R), d);
    }
  });

  test('digitToPattern — 범위 밖 digit 은 RangeError', () => {
    assert.throws(() => digitToPattern(-1), RangeError);
    assert.throws(() => digitToPattern(6), RangeError);
    assert.throws(() => digitToPattern(1.5), RangeError);
  });

  test('patternToDigit — 전부-밝음(1,1,1)·전부-어두움(0,0,0) 은 null (불법 트리플)', () => {
    assert.equal(patternToDigit(1, 1, 1), null);
    assert.equal(patternToDigit(0, 0, 0), null);
  });

  test('patternToDigit — 비트가 아닌 값은 RangeError', () => {
    assert.throws(() => patternToDigit(2, 0, 0), RangeError);
    assert.throws(() => patternToDigit(0, -1, 0), RangeError);
    assert.throws(() => patternToDigit(0, 0, 0.5), RangeError);
  });

  test('6개 합법 트리플 전수 — 나머지 2개(불법)를 뺀 8-6=2 와 정확히 일치', () => {
    const legal = new Set();
    for (let t = 0; t <= 1; t += 1) {
      for (let l = 0; l <= 1; l += 1) {
        for (let r = 0; r <= 1; r += 1) {
          const d = patternToDigit(t, l, r);
          if (d !== null) legal.add(`${t}${l}${r}`);
        }
      }
    }
    assert.equal(legal.size, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// thetaFromAnchors (U14 — 등급 iii 로그 중점)
// ─────────────────────────────────────────────────────────────────────────────

describe('thetaFromAnchors', () => {
  test('로그 중점 = sqrt(obsLo * obsHi)', () => {
    assert.ok(Math.abs(thetaFromAnchors(0.04, 1) - 0.2) < 1e-12);
    assert.ok(Math.abs(thetaFromAnchors(2, 8) - 4) < 1e-12);
  });

  test('산술 중점과 다르다 (모델 상수 임계는 금지 — 회귀로 구분해 둔다)', () => {
    const geo = thetaFromAnchors(0.04, 1);
    const arithmetic = (0.04 + 1) / 2;
    assert.notEqual(geo, arithmetic);
  });

  test('obsLo·obsHi 가 대칭이지 않아도(순서 무관) 같은 값', () => {
    assert.equal(thetaFromAnchors(2, 8), thetaFromAnchors(8, 2));
  });

  test('0 이하 인자는 RangeError', () => {
    assert.throws(() => thetaFromAnchors(0, 1), RangeError);
    assert.throws(() => thetaFromAnchors(1, 0), RangeError);
    assert.throws(() => thetaFromAnchors(-1, 1), RangeError);
    assert.throws(() => thetaFromAnchors(1, -1), RangeError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyTriple
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyTriple', () => {
  const theta = { T: 0.2, L: 0.2, R: 0.2 };

  test('digit 0..5 전부: 이상적 관측(패턴대로 극값)이면 정확히 복원', () => {
    for (let d = 0; d < 6; d += 1) {
      const pattern = digitToPattern(d);
      const values = {
        T: pattern.T ? 0.8 : 0.05,
        L: pattern.L ? 0.8 : 0.05,
        R: pattern.R ? 0.8 : 0.05,
      };
      const { digit, illegal } = classifyTriple(values, theta);
      assert.equal(illegal, false, `d=${d}`);
      assert.equal(digit, d, `d=${d}`);
    }
  });

  test('전부 임계 이상(전부-밝음 관측) → illegal:true, digit:null', () => {
    const values = { T: 0.9, L: 0.9, R: 0.9 };
    const { digit, illegal } = classifyTriple(values, theta);
    assert.equal(illegal, true);
    assert.equal(digit, null);
  });

  test('전부 임계 이하(전부-어두움 관측) → illegal:true, digit:null', () => {
    const values = { T: 0.01, L: 0.01, R: 0.01 };
    const { digit, illegal } = classifyTriple(values, theta);
    assert.equal(illegal, true);
    assert.equal(digit, null);
  });

  test('경계값(정확히 theta) 은 어두움(0)으로 판정 — 강한 부등호 계약', () => {
    const values = { T: 0.2, L: 0.05, R: 0.05 };
    const { digit } = classifyTriple(values, theta);
    // T 가 theta 와 같으므로 밝음이 아니다 → (0,0,0) → illegal
    assert.equal(digit, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RHO_MIN / assertToneSeparation (U17)
// ─────────────────────────────────────────────────────────────────────────────

describe('RHO_MIN / assertToneSeparation (U17)', () => {
  test('RHO_MIN = 10', () => {
    assert.equal(RHO_MIN, 10);
  });

  test('slate 프리셋 실측 ρ ≈ 12.59 — 통과', () => {
    // luminance.js PRESETS.slate.levels[0]/[2] 실측값(모듈 헤더 주석 근거) 재현.
    const yLo = 0.06116494639496135;
    const yHi = 0.7699371947544522;
    assert.doesNotThrow(() => assertToneSeparation(yLo, yHi));
    assert.ok(Math.abs(yHi / yLo - 12.587883095371733) < 1e-9);
  });

  test('ρ < RHO_MIN 이면 RangeError', () => {
    assert.throws(() => assertToneSeparation(1, 9.999), RangeError);
  });

  test('ρ = RHO_MIN(경계, 정확히 10)는 통과 (>= 계약)', () => {
    assert.doesNotThrow(() => assertToneSeparation(1, 10));
  });

  test('0 이하 인자는 RangeError', () => {
    assert.throws(() => assertToneSeparation(0, 10), RangeError);
    assert.throws(() => assertToneSeparation(1, 0), RangeError);
    assert.throws(() => assertToneSeparation(-1, 10), RangeError);
  });
});
