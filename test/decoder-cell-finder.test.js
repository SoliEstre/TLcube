/**
 * decoder-cell-finder.test.js — 19셀 마스크 공용 검출기와 방향 증거 회귀.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { detectCellFinders } from '../src/decoder/cell-finder-detect.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { encode } from '../src/encode.js';
import { FINDER_CELL_MASK_PATTERNS, FINDER_PATTERNS } from '../src/finder-patterns.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { distortImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });

function render(patternId, text = 'cell-finder') {
  const encoded = encode(text, { version: 2, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: PALETTE, finderPatternId: patternId });
  return rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
}

function detect(raster, patternInput = FINDER_PATTERNS) {
  return detectCellFinders(toRelativeLuminance(raster), patternInput, {
    cellSizeSeeds: [12],
  });
}

test('cellMasks 공용 정합기가 11종을 같은 경로로 식별한다', () => {
  for (const pattern of FINDER_CELL_MASK_PATTERNS) {
    const result = detect(render(pattern.id));
    assert.equal(result.ok, true, pattern.id);
    assert.equal(result.candidates[0].patternId, pattern.id, pattern.id);
    assert.equal(result.candidates[0].orientationSource, 'finder-pattern', pattern.id);
  }
});

test('원시 19개 cellMasks 배열도 같은 검출 API를 쓴다', () => {
  const pattern = FINDER_PATTERNS[0];
  const result = detect(render(pattern.id), pattern.cellMasks);
  assert.equal(result.ok, true);
  assert.equal(result.candidates[0].patternId, 'cell-mask');
});

test('파인더가 0/120/240도 방향을 직접 구분한다', () => {
  const pattern = FINDER_PATTERNS[0];
  const source = render(pattern.id);
  for (const [degrees, expectedTurn] of [[0, 0], [120, 1], [240, 2]]) {
    const raster = degrees === 0 ? source
      : distortImage(source, { rotation: degrees, fill: FILL });
    const result = detect(raster);
    assert.equal(result.ok, true, degrees + '도');
    assert.equal(result.candidates[0].orientation, expectedTurn, degrees + '도');
    assert.equal(result.candidates[0].orientationSource, 'finder-pattern', degrees + '도');
  }
});

test('대표 셀 파인더는 전체 frontend와 투시 후보까지 왕복한다', {
  timeout: 30_000,
}, () => {
  const pattern = FINDER_PATTERNS[0];
  const text = 'cell-finder-perspective';
  const source = render(pattern.id, text);
  const distorted = distortImage(source, {
    perspective: { degrees: 6, axis: 'horizontal' },
    fill: FILL,
  });
  const result = decodeFrontend(distorted);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.text, text);
  assert.equal(
    result.diagnostics.bootstrap.geometry.classification.fallback,
    'cell-mask-body-validated',
  );
});
