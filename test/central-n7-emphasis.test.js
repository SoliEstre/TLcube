import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CENTRAL_N7_EMPHASIS_MODES,
  DEFAULT_CENTRAL_N7_EMPHASIS,
  GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS,
  assertCentralN7Emphasis,
  centralN7EmphasisLevels,
  centralN7LevelPalettes,
} from '../src/centralN7Emphasis.js';
import { PRESETS, relativeLuminance } from '../src/luminance.js';

test('중앙 TL 강조 팔레트는 sRGB 채널 중점과 0<1<2 방향을 보존한다', () => {
  const levels = PRESETS.ember.levels;
  const emphasized = centralN7EmphasisLevels(levels);
  assert.deepEqual(emphasized, [
    { r: 0, g: 0, b: 0 },
    { r: 128, g: 105, b: 70 },
    levels[2],
  ]);
  assert.strictEqual(emphasized[2], levels[2], '밝은 레벨은 현재 팔레트 객체 그대로여야 한다');
  const luminances = emphasized.map(relativeLuminance);
  assert.ok(luminances[0] < luminances[1] && luminances[1] < luminances[2]);
});

test('기본/로케이터/전체는 30셀·19셀 소비 팔레트를 정확히 나눈다', () => {
  const levels = PRESETS.slate.levels;
  const normal = centralN7LevelPalettes(levels);
  assert.equal(DEFAULT_CENTRAL_N7_EMPHASIS, 'default');
  assert.deepEqual(CENTRAL_N7_EMPHASIS_MODES, ['default', 'locator', 'all']);
  assert.strictEqual(normal.locator, levels);
  assert.strictEqual(normal.data, levels);

  const locator = centralN7LevelPalettes(levels, 'locator');
  assert.notStrictEqual(locator.locator, levels);
  assert.strictEqual(locator.data, levels);

  const all = centralN7LevelPalettes(levels, 'all');
  assert.notStrictEqual(all.locator, levels);
  assert.strictEqual(all.locator, all.data);
  assert.throws(() => assertCentralN7Emphasis('unknown'), RangeError);
});

test('생성기 기본값은 «전체 강조», 라이브러리 기본값은 «기본» — 두 축은 별개다', () => {
  // 운영자 실기 A2 (2026-08-29 §3): UI 기본 = 'all'. 라이브러리 기본('default')은
  // emphasis 를 안 준 buildScene 임베더의 계약이라 바뀌면 기존 출력 재생성이 달라진다.
  assert.equal(GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS, 'all');
  assert.equal(DEFAULT_CENTRAL_N7_EMPHASIS, 'default');
  assert.ok(CENTRAL_N7_EMPHASIS_MODES.includes(GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS));
});

test('강조 팔레트는 전 프리셋에서 순위 0<1<2 를 보존한다 — 디코더가 읽는 유일한 축', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    const y = centralN7EmphasisLevels(preset.levels).map(relativeLuminance);
    assert.ok(y[0] < y[1] && y[1] < y[2], name + ': 강조 팔레트 순위가 깨졌다');
  }
});

test('어두운 프리셋 배경과 강조 순검정 사이의 절대 휘도 분리를 계측한다', (t) => {
  const separation = Object.fromEntries(Object.entries(PRESETS).map(([name, preset]) => [
    name, relativeLuminance(preset.background),
  ]));
  t.diagnostic('black-background separation: ' + JSON.stringify(separation));
  assert.ok(Object.values(separation).every((value) => value > 0));
});
