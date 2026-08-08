// luminance.test.js — src/luminance.js 계약 검증 (SPEC §4.4, §5.1, §7.2)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DELTA_MIN_CONTRACT,
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  srgbChannelToLinear,
  relativeLuminance,
  PRESETS,
  DEFAULT_PRESET,
  getPreset,
  presetLuminances,
  presetDeltaMin,
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
