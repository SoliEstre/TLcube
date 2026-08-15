/**
 * cellSurfaceFinal-decode.test.js — 최종 라인업 합성 왕복 (lab 경로) + 정식 경로 음성.
 *
 * v0(n=13) · v2r2(n=21/25) × 2톤/3톤. 정식 `/` 는 enableCellSurfaceY 없이는 이
 * 심볼들을 수용하지 않는다 (안정판 불변식 — scanner-i18n.test.js 의 isLabPath 게이트).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { distortImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PAYLOAD = 'https://tl.estre.so';
const LINEUP = Object.freeze([
  { layout: 'v0', version: 0, n: 13 },
  { layout: 'v2r2', version: 1, n: 21 },
  { layout: 'v2r2', version: 2, n: 25 },
]);

function renderFinal(text, {
  layout, version, tones = 2, pixelsPerUnit = 10, supersample = 2, margin = 16,
} = {}) {
  const encoded = encodeY(text, {
    cellSurfaceLayout: layout, version, tones, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin });
  const raster = rasterize(scene, { pixelsPerUnit, supersample });
  return { encoded, scene, raster };
}

function decodeLab(raster) {
  return decodeFrontend(raster, {
    bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
  });
}

test('최종 라인업 왕복 — v0(n=13)·v2r2(n=21/25) × 2톤/3톤', { timeout: 300_000 }, () => {
  for (const { layout, version, n } of LINEUP) {
    for (const tones of [2, 3]) {
      const fixture = renderFinal(PAYLOAD, { layout, version, tones });
      const result = decodeLab(fixture.raster);
      assert.equal(result.ok, true, JSON.stringify({
        layout, n, tones, reason: result.reason,
      }));
      assert.equal(result.text, PAYLOAD);
      assert.equal(result.family, 'cube');
      assert.equal(result.tones, tones);
      assert.equal(result.hypothesis.cellSurface, true);
      assert.equal(result.hypothesis.cellSurfaceLayout, layout);
      assert.equal(result.hypothesis.locatorProfile, 'cell-surface-' + layout);
      assert.equal(result.hypothesis.n, n);
      assert.equal(result.diagnostics.format.formatIndex, tones === 3 ? 3 : 1);
      assert.equal(
        result.versionName,
        'Y' + version + (tones === 3 ? 'T' : '') + '-CS-' + layout.toUpperCase(),
      );
    }
  }
});

test('직각 회전 왕복 — v0@13 · v2r2@21 (2톤)', { timeout: 300_000 }, () => {
  for (const { layout, version } of [LINEUP[0], LINEUP[1]]) {
    const fixture = renderFinal(PAYLOAD, {
      layout, version, tones: 2, margin: 20,
    });
    for (const degrees of [0, 90, 180, 270]) {
      const rotated = distortImage(fixture.raster, { rotation: degrees, fill: FILL });
      const result = decodeLab(rotated);
      assert.equal(
        result.ok === true && result.text === PAYLOAD,
        true,
        JSON.stringify({ layout, degrees, reason: result.reason }),
      );
      assert.equal(result.hypothesis.cellSurfaceLayout, layout);
    }
  }
});

test('정식 경로(enableCellSurfaceY 없음)는 최종 라인업을 수용하지 않는다', {
  timeout: 120_000,
}, () => {
  for (const { layout, version } of LINEUP) {
    const fixture = renderFinal(PAYLOAD, { layout, version, tones: 2 });
    const official = decodeFrontend(fixture.raster, {});
    assert.notEqual(
      official.ok === true && official.hypothesis && official.hypothesis.cellSurface === true,
      true,
      layout + ' 가 정식 경로에서 수용됐다',
    );
  }
});

test('2톤·3톤은 서로를 오수용하지 않는다 (v0 · v2r2)', { timeout: 120_000 }, () => {
  for (const { layout, version } of [LINEUP[0], LINEUP[1]]) {
    const two = decodeLab(renderFinal(PAYLOAD, { layout, version, tones: 2 }).raster);
    const three = decodeLab(renderFinal(PAYLOAD, { layout, version, tones: 3 }).raster);
    assert.equal(two.ok, true, two.reason);
    assert.equal(three.ok, true, three.reason);
    assert.equal(two.tones, 2);
    assert.equal(three.tones, 3);
    assert.equal(two.diagnostics.format.formatIndex, 1);
    assert.equal(three.diagnostics.format.formatIndex, 3);
  }
});

test('기존 일반 Y 는 최종 셀 표면으로 오수용되지 않는다', { timeout: 120_000 }, () => {
  for (const version of [0, 1, 2]) {
    const encoded = encodeY(PAYLOAD, { version, tones: 2, eccLevel: 'M' });
    const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
    const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
    const result = decodeLab(raster);
    assert.notEqual(
      result.ok === true && result.hypothesis && result.hypothesis.cellSurface === true,
      true,
      'Y' + version + ' 일반 심볼이 셀 표면으로 오수용됐다',
    );
    // lab 경로에서도 일반 Y 복호 자체는 그대로 살아 있어야 한다.
    assert.equal(result.ok, true, 'Y' + version + ' lab 경로 일반 복호: ' + result.reason);
    assert.equal(result.text, PAYLOAD);
  }
});
