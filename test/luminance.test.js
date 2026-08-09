// luminance.test.js — src/luminance.js 계약 검증 (SPEC §4.4, §5.1, §7.2)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DELTA_MIN_CONTRACT,
  PRESET_DELTA_MIN,
  RHO_MIN_CONTRACT,
  PRESET_BG_SEPARATION_MIN,
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  srgbChannelToLinear,
  relativeLuminance,
  PRESETS,
  DEFAULT_PRESET,
  getPreset,
  presetLuminances,
  presetDeltaMin,
  presetRho,
  presetBackgroundSeparation,
  assertPresetContract,
  faceColors,
} from '../src/luminance.js';
import { digitToRanks } from '../src/lehmer.js';

test('srgbChannelToLinear 경계값', () => {
  assert.equal(srgbChannelToLinear(0), 0);
  assert.equal(srgbChannelToLinear(255), 1);
  // 8/255 ≈ 0.03137 <= 0.04045 → 선형 구간(단순 나눗셈)
  const expected = 8 / 255 / 12.92;
  assert.ok(Math.abs(srgbChannelToLinear(8) - expected) < 1e-12);
});

test('relativeLuminance 백/흑 극단값', () => {
  assert.equal(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
});

test('BULLSEYE 상수의 Y 는 정확히 0.0 / 1.0 (SPEC §5.1)', () => {
  assert.equal(relativeLuminance(BULLSEYE_DARK), 0);
  assert.equal(relativeLuminance(BULLSEYE_LIGHT), 1);
});

test('DELTA_MIN_CONTRACT 는 SPEC §4.4 계약값 0.12', () => {
  assert.equal(DELTA_MIN_CONTRACT, 0.12);
});

test('DEFAULT_PRESET 은 등록된 프리셋을 가리킨다', () => {
  assert.ok(Object.prototype.hasOwnProperty.call(PRESETS, DEFAULT_PRESET));
  assert.equal(DEFAULT_PRESET, 'slate');
});

test('getPreset: 미등록 이름은 RangeError', () => {
  assert.throws(() => getPreset('nope'), RangeError);
});

test('getPreset: 등록된 이름은 프리셋 객체를 반환', () => {
  const preset = getPreset('slate');
  assert.equal(preset.name, 'slate');
  assert.equal(typeof preset.label, 'string');
  assert.equal(preset.levels.length, 3);
});

test('presetLuminances(slate): 실측 Y 오름차순', () => {
  const [y0, y1, y2] = presetLuminances('slate');
  assert.ok(y0 < y1);
  assert.ok(y1 < y2);
});

test('presetDeltaMin(slate) >= 0.15 (계약 0.12 + 여유)', () => {
  const deltaMin = presetDeltaMin('slate');
  assert.ok(deltaMin >= 0.15, `presetDeltaMin=${deltaMin}`);
  assert.ok(deltaMin >= DELTA_MIN_CONTRACT);
});

test('slate background 는 어두운 슬레이트: Y <= 0.08', () => {
  const preset = getPreset('slate');
  const bgY = relativeLuminance(preset.background);
  assert.ok(bgY <= 0.08, `bgY=${bgY}`);
});

test('slate background 는 각 레벨과 >= 0.05 분리', () => {
  const preset = getPreset('slate');
  const bgY = relativeLuminance(preset.background);
  const [y0, y1, y2] = presetLuminances('slate');
  assert.ok(y0 - bgY >= 0.05, `y0-bgY=${y0 - bgY}`);
  assert.ok(y1 - bgY >= 0.05, `y1-bgY=${y1 - bgY}`);
  assert.ok(y2 - bgY >= 0.05, `y2-bgY=${y2 - bgY}`);
});

test('faceColors: 전 6 digit 에서 digitToRanks 와 일치', () => {
  const preset = getPreset('slate');
  for (let digit = 0; digit < 6; digit += 1) {
    const ranks = digitToRanks(digit);
    const colors = faceColors(digit, 'slate');
    assert.deepEqual(colors.T, preset.levels[ranks.T]);
    assert.deepEqual(colors.L, preset.levels[ranks.L]);
    assert.deepEqual(colors.R, preset.levels[ranks.R]);
  }
});

test('faceColors: 미등록 프리셋 이름은 RangeError', () => {
  assert.throws(() => faceColors(0, 'nope'), RangeError);
});

// ── 팔레트 프리셋 확장 (ember·mono) ────────────────────────────────────────

test('PRESETS 에 slate·ember·mono 3종이 등록되어 있다', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), ['ember', 'mono', 'slate']);
});

test('PRESET_DELTA_MIN / RHO_MIN_CONTRACT / PRESET_BG_SEPARATION_MIN 계약 상수', () => {
  assert.equal(PRESET_DELTA_MIN, 0.15);
  assert.ok(PRESET_DELTA_MIN >= DELTA_MIN_CONTRACT);
  assert.equal(RHO_MIN_CONTRACT, 10);
  assert.equal(PRESET_BG_SEPARATION_MIN, 0.05);
});

for (const name of ['slate', 'ember', 'mono']) {
  test(`프리셋 '${name}': 모듈 로드 시 이미 통과한 계약을 재확인 — Δmin >= ${'PRESET_DELTA_MIN'}`, () => {
    const deltaMin = presetDeltaMin(name);
    assert.ok(deltaMin >= PRESET_DELTA_MIN, `${name} Δmin=${deltaMin}`);
  });

  test(`프리셋 '${name}': ρ (2톤 대비비) >= RHO_MIN_CONTRACT (SPEC §14 U17)`, () => {
    const rho = presetRho(name);
    assert.ok(rho >= RHO_MIN_CONTRACT, `${name} ρ=${rho}`);
  });

  test(`프리셋 '${name}': 배경 분리 >= PRESET_BG_SEPARATION_MIN`, () => {
    const bgSep = presetBackgroundSeparation(name);
    assert.ok(bgSep >= PRESET_BG_SEPARATION_MIN, `${name} bgSep=${bgSep}`);
  });

  test(`프리셋 '${name}': assertPresetContract 가 조용히 통과한다`, () => {
    assert.doesNotThrow(() => assertPresetContract(name));
  });

  test(`프리셋 '${name}': 실측 Y 오름차순`, () => {
    const [y0, y1, y2] = presetLuminances(name);
    assert.ok(y0 < y1);
    assert.ok(y1 < y2);
  });
}

test('assertPresetContract: 미등록 이름은 (getPreset 경유) RangeError', () => {
  // PRESETS 는 Object.freeze 되어 있어(strict mode ESM) 계약 위반 프리셋을 런타임에
  // 주입해 테스트할 수 없다 — 대신 등록되지 않은 이름 경로(assertPresetContract →
  // presetDeltaMin → getPreset)가 그대로 전파되는지만 확인한다.
  assert.throws(() => assertPresetContract('nope'), RangeError);
});

test('presetRho(ember): ember 실측 Y 로 직접 재계산한 값과 일치한다', () => {
  // 골든 케이스 — ember 프리셋 모듈 주석에 적어 둔 실측 Y(레벨0≈0.0568, 레벨2≈0.6925)로
  // 독립 재계산해 presetRho 산식(levels[2]/levels[0])이 맞는지 교차검증한다.
  const preset = getPreset('ember');
  const y0 = relativeLuminance(preset.levels[0]);
  const y2 = relativeLuminance(preset.levels[2]);
  assert.ok(Math.abs(presetRho('ember') - y2 / y0) < 1e-12);
});
