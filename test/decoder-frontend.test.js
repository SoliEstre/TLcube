/**
 * decoder-frontend.test.js — oracle 기하 없이 닫는 첫 decoder end-to-end.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import {
  FRONTEND_FAILURE,
} from '../src/decoder/contracts.js';
import {
  selectGridHypothesis,
} from '../src/decoder/bootstrap.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
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

function render(text, version, eccLevel, options = {}) {
  const encoded = encode(text, { version, eccLevel });
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: options.margin,
  });
  const raster = rasterize(scene, {
    pixelsPerUnit: options.pixelsPerUnit === undefined ? 12 : options.pixelsPerUnit,
    supersample: options.supersample === undefined ? 1 : options.supersample,
  });
  return { encoded, scene, raster };
}

function gradientRaster(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(255 * (x + y) / (width + height - 2));
      const offset = (y * width + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return { width, height, pixels };
}

function cropRaster(raster, x, y, width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let targetY = 0; targetY < height; targetY += 1) {
    for (let targetX = 0; targetX < width; targetX += 1) {
      const sourceOffset = ((y + targetY) * raster.width + x + targetX) * 4;
      const targetOffset = (targetY * width + targetX) * 4;
      pixels.set(raster.pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return { width, height, pixels };
}

const CLEAN_CASES = Object.freeze([
  { version: 1, eccLevel: 'L', text: 'TLcube' },
  { version: 1, eccLevel: 'M', text: '안녕' },
  { version: 1, eccLevel: 'H', text: 'https://x.co/a' },
  { version: 2, eccLevel: 'L', text: '안녕' },
  { version: 2, eccLevel: 'M', text: 'https://x.co/a' },
  { version: 2, eccLevel: 'H', text: 'TLcube' },
  { version: 3, eccLevel: 'L', text: 'https://x.co/a' },
  { version: 3, eccLevel: 'M', text: 'TLcube' },
  { version: 3, eccLevel: 'H', text: '안녕' },
]);

test('encode → buildScene → rasterize → decodeFrontend: V1/V2/V3 × ECC L/M/H', {
  timeout: 120_000,
}, () => {
  for (const entry of CLEAN_CASES) {
    const fixture = render(entry.text, entry.version, entry.eccLevel);
    const result = decodeFrontend(fixture.raster);
    assert.equal(result.ok, true, JSON.stringify({ entry, result }));
    assert.equal(result.text, entry.text);
    assert.equal(result.version, entry.version);
    assert.equal(result.eccLevel, entry.eccLevel);
    assert.equal(result.crsDistance, 2 * result.corrected);
  }
});

const DISTORTIONS = Object.freeze([
  {
    name: 'rotation',
    options: { rotation: 37, fill: FILL },
  },
  {
    name: 'perspective',
    options: { perspective: { degrees: 20, axis: 'both' }, fill: FILL },
  },
  {
    name: 'scale',
    options: { scale: 0.75, fill: FILL },
  },
]);

test('oracle 없는 회전·원근·스케일 왜곡도 V1/V2/V3에서 복호', {
  timeout: 180_000,
}, () => {
  for (const distortion of DISTORTIONS) {
    for (const version of [1, 2, 3]) {
      const text = distortion.name + '-V' + version;
      const fixture = render(text, version, version === 1 ? 'L' : version === 2 ? 'M' : 'H', {
        pixelsPerUnit: 20,
        margin: 8,
      });
      const raster = distortImage(fixture.raster, distortion.options);
      const result = decodeFrontend(raster);
      assert.equal(result.ok, true, JSON.stringify({ distortion: distortion.name, version, result }));
      assert.equal(result.text, text);
      assert.equal(result.version, version);
    }
  }
});

test('코드가 없는 비퇴화 영상은 NO_FINDER', {
  timeout: 20_000,
}, () => {
  const result = decodeFrontend(gradientRaster(128, 128));
  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.NO_FINDER);
});

test('외곽이 잘린 코드는 성공으로 오인하지 않고 앞단 실패 코드로 닫힘', {
  timeout: 30_000,
}, () => {
  const fixture = render('clipped', 2, 'M', {
    pixelsPerUnit: 16,
    margin: 4,
  });
  const clippedWidth = Math.floor(fixture.raster.width * 0.63);
  const clipped = cropRaster(
    fixture.raster,
    0,
    0,
    clippedWidth,
    fixture.raster.height,
  );
  const result = decodeFrontend(clipped);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok([
    FRONTEND_FAILURE.NO_FINDER,
    FRONTEND_FAILURE.NO_ANCHORS,
    FRONTEND_FAILURE.SAMPLE_STARVED,
    FRONTEND_FAILURE.NO_FORMAT_CANDIDATE,
    FRONTEND_FAILURE.NO_GRID_HYPOTHESIS,
  ].includes(result.reason), result.reason);
});

test('동일 입력 두 번은 성공 결과와 진단까지 동일', {
  timeout: 30_000,
}, () => {
  const fixture = render('deterministic', 1, 'M');
  const first = decodeFrontend(fixture.raster);
  const second = decodeFrontend(fixture.raster);
  assert.deepEqual(second, first);
});

test('복수 body-valid 후보는 hard reject하지 않고 점수와 고정 총순서로 선택', () => {
  const base = {
    text: 'winner',
    corrected: 0,
    crsDistance: 0,
    formatAgreement: 1,
    referenceAgreement: 1,
    rH: 0,
    rK: 0,
  };
  const result = selectGridHypothesis([
    { ...base, hypothesisId: 'b', crsDistance: 2 },
    { ...base, hypothesisId: 'a' },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.candidate.hypothesisId, 'a');
  assert.equal(result.diagnostics.bodyValidCount, 2);
});
