/**
 * decoder-three-tone-finder.test.js — 중앙 3톤 큐브의 Type Y 경로 재사용 회귀.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectCentralCubeFinders } from '../src/decoder/cube-detect.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { encode } from '../src/encode.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
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

function render(text, pixelsPerUnit = 12) {
  const encoded = encode(text, { version: 2, eccLevel: 'M' });
  const scene = buildScene(encoded, {
    palette: PALETTE,
    finderPatternId: 'central-cube-3tone',
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

function boxBlur3(image) {
  const pixels = new Uint8ClampedArray(image.pixels.length);
  const kernel = [1, 2, 1];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        let sum = 0;
        let weight = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const sourceX = Math.max(0, Math.min(image.width - 1, x + dx));
            const sourceY = Math.max(0, Math.min(image.height - 1, y + dy));
            const sampleWeight = kernel[dx + 1] * kernel[dy + 1];
            sum += image.pixels[(sourceY * image.width + sourceX) * 4 + channel]
              * sampleWeight;
            weight += sampleWeight;
          }
        }
        pixels[(y * image.width + x) * 4 + channel] = Math.round(sum / weight);
      }
    }
  }
  return { ...image, pixels };
}

test('고정 T/L/R 순위는 0/120/240도에서 방향을 유일하게 푼다', () => {
  const source = render('three-tone-orientation');
  for (const [degrees, expected] of [[0, 0], [120, 1], [240, 2]]) {
    const raster = degrees === 0 ? source
      : distortImage(source, { rotation: degrees, fill: FILL });
    const detected = detectCentralCubeFinders(toRelativeLuminance(raster));
    assert.equal(detected.ok, true, degrees + '도');
    assert.equal(detected.candidates[0].orientation, expected, degrees + '도');
    assert.equal(
      detected.candidates[0].source,
      'cube-silhouette-y-junction-three-tone-rank',
    );
    assert.ok(detected.candidates[0].orientationMargin > 0);
  }
});

test('중앙 3톤 큐브는 합성 Type O를 0/120/240도 모두 왕복한다', {
  timeout: 30_000,
}, () => {
  const text = 'three-tone-roundtrip';
  const source = render(text);
  for (const degrees of [0, 120, 240]) {
    const raster = degrees === 0 ? source
      : distortImage(source, { rotation: degrees, fill: FILL });
    const decoded = decodeFrontend(raster);
    assert.equal(decoded.ok, true, degrees + '도: ' + decoded.reason);
    assert.equal(decoded.text, text);
    assert.equal(decoded.hypothesis.source, 'central-cube-finder');
  }
});

test('촬영 열화 합성 — 블러·9px/cell 저해상도·5도 투시를 각각 왕복한다', {
  timeout: 30_000,
}, () => {
  const text = 'three-tone-degraded';
  const source = render(text);
  const cases = [
    ['blur', boxBlur3(source)],
    ['low-resolution', render(text, 9)],
    ['perspective', distortImage(source, {
      perspective: { degrees: 5, axis: 'horizontal' },
      fill: FILL,
    })],
  ];
  for (const [name, raster] of cases) {
    const decoded = decodeFrontend(raster);
    assert.equal(decoded.ok, true, name + ': ' + decoded.reason);
    assert.equal(decoded.text, text, name);
    assert.equal(decoded.hypothesis.source, 'central-cube-finder', name);
  }
});
