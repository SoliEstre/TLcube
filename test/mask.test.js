/**
 * mask.test.js — 고정 마스크 m(q,r) 검증 (SPEC §4.3, T4)
 *
 * ①③ 선정 규칙을 확정 공식(CHOSEN='hash')에 대해 재측정해 고정한다. 대조군인
 * affine 은 ③(짧은 주기)에서 의도적으로 FAIL 함을 함께 고정해, "이게 왜
 * 대조군인가"가 테스트만 봐도 드러나게 한다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { regionCells, hexDistance } from '../src/hexgrid.js';
import { CANDIDATES, CHOSEN, maskValue, maskAdd, maskSub } from '../src/mask.js';

const VERSIONS = [
  { version: 1, k: 6 },
  { version: 2, k: 8 },
  { version: 3, k: 10 },
];

const CHI2_CRIT_DF5_ALPHA01 = 15.086;

function dataCells(k) {
  return regionCells(k).filter((c) => hexDistance(c.q, c.r) > 2);
}

function chiSquareUniform(values) {
  const counts = new Array(6).fill(0);
  for (const v of values) counts[v]++;
  const n = values.length;
  const exp = n / 6;
  let chi2 = 0;
  for (let i = 0; i < 6; i++) chi2 += (counts[i] - exp) ** 2 / exp;
  return { chi2, counts, n };
}

function hasShortPeriod(maskFn) {
  const dirs = [
    { dq: 1, dr: 0 },
    { dq: 0, dr: 1 },
    { dq: 1, dr: -1 },
  ];
  for (const dir of dirs) {
    const seq = [];
    for (let t = -100; t <= 100; t++) seq.push(maskFn(t * dir.dq, t * dir.dr));
    for (let p = 1; p <= 6; p++) {
      let ok = true;
      for (let i = 0; i + p < seq.length; i++) {
        if (seq[i] !== seq[i + p]) {
          ok = false;
          break;
        }
      }
      if (ok) return true; // 이 방향에서 주기 p<=6 발견
    }
  }
  return false;
}

describe('mask — 기본 계약', () => {
  test('CHOSEN 은 hash', () => {
    assert.equal(CHOSEN, 'hash');
  });

  test('maskValue 는 항상 0..5 정수', () => {
    for (let q = -20; q <= 20; q++) {
      for (let r = -20; r <= 20; r++) {
        const v = maskValue(q, r);
        assert.ok(Number.isInteger(v) && v >= 0 && v <= 5, `m(${q},${r})=${v}`);
      }
    }
  });

  test('결정성: 같은 (q,r) → 같은 값 (재호출)', () => {
    for (const [q, r] of [[0, 0], [7, -3], [-15, 20], [20, -20], [-20, -20]]) {
      assert.equal(maskValue(q, r), maskValue(q, r));
    }
  });
});

describe('mask — maskAdd ↔ maskSub 왕복 항등', () => {
  const sampleCells = [];
  for (const { k } of VERSIONS) sampleCells.push(...dataCells(k));

  test('전 digit(0..5) × 표본 셀에서 왕복이 항등', () => {
    for (const { q, r } of sampleCells) {
      for (let digit = 0; digit <= 5; digit++) {
        const masked = maskAdd(digit, q, r);
        assert.ok(masked >= 0 && masked <= 5);
        assert.equal(maskSub(masked, q, r), digit, `round-trip 실패 at (${q},${r}) digit=${digit}`);
      }
    }
  });

  test('음수 좌표에서도 왕복 항등', () => {
    for (const [q, r] of [[-20, -20], [-11, 17], [-1, -1], [0, -5]]) {
      for (let digit = 0; digit <= 5; digit++) {
        assert.equal(maskSub(maskAdd(digit, q, r), q, r), digit);
      }
    }
  });
});

describe('mask — 선정 규칙 ①③ 재확인 (확정 공식)', () => {
  for (const { version, k } of VERSIONS) {
    test(`① 카이제곱 균등성 통과 — V${version}(k=${k})`, () => {
      const cells = dataCells(k);
      const values = cells.map((c) => maskValue(c.q, c.r));
      const { chi2 } = chiSquareUniform(values);
      assert.ok(
        chi2 <= CHI2_CRIT_DF5_ALPHA01,
        `chi2=${chi2} > 임계 ${CHI2_CRIT_DF5_ALPHA01} (V${version})`,
      );
    });
  }

  test('③ 세 격자축 방향에 주기<=6 없음', () => {
    assert.equal(hasShortPeriod(maskValue), false);
  });
});

describe('mask — 대조군 (affine) 은 의도대로 ③에서 FAIL', () => {
  test('아핀 후보는 축 방향 짧은 주기를 가진다 (선형 mod-6 필연)', () => {
    assert.equal(hasShortPeriod(CANDIDATES.affine), true);
  });
});

describe('mask — CANDIDATES 노출', () => {
  test('affine · quadratic · hash 세 후보가 재측정 가능하게 export', () => {
    assert.ok(typeof CANDIDATES.affine === 'function');
    assert.ok(typeof CANDIDATES.quadratic === 'function');
    assert.ok(typeof CANDIDATES.hash === 'function');
    // CHOSEN='hash' 는 maskValue 와 동일 결과를 내야 한다 (별개 함수 객체여도 됨).
    for (const [q, r] of [[0, 0], [7, -3], [-15, 20]]) {
      assert.equal(CANDIDATES.hash(q, r), maskValue(q, r));
    }
  });
});
