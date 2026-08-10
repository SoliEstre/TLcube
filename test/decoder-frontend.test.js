/**
 * decoder-frontend.test.js — oracle 기하 없이 닫는 첫 decoder end-to-end.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import {
  FRONTEND_FAILURE,
  HOMOGRAPHY_CANONICAL_SPACE,
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

const ROTATION_SWEEP = Object.freeze(
  Array.from({ length: 12 }, (_, index) => index * 30),
);
const PERSPECTIVE_SWEEP = Object.freeze([-30, -20, -10, 0, 10, 20, 30]);
const SCALE_SWEEP = Object.freeze([0.5, 0.6, 0.75, 1, 1.25, 1.5, 2]);
const SWEEP_TEXT = 'https://tl.estre.so/x';

function failureMessage(axis, value, result) {
  const detail = result && result.detail;
  const cause = detail && detail.cause;
  return JSON.stringify({
    axis,
    value,
    reason: result && result.reason,
    stage: detail && (detail.pipelineStage || detail.stage),
    pipelineCode: detail && detail.pipelineCode,
    cause: cause && (cause.cause || cause.message || cause.stage),
  });
}

function assertSweepDecoded(axis, value, result) {
  assert.equal(result.ok, true, failureMessage(axis, value, result));
  assert.equal(result.text, SWEEP_TEXT, failureMessage(axis, value, result));
  assert.equal(result.version, 2, failureMessage(axis, value, result));
  assert.equal(result.eccLevel, 'M', failureMessage(axis, value, result));
  assert.equal(result.hypothesis.canonicalSpace, HOMOGRAPHY_CANONICAL_SPACE);
}

test('회전 sweep 12점: 0~330도 전 구간 복호', {
  timeout: 120_000,
}, () => {
  const fixture = render(SWEEP_TEXT, 2, 'M', {
    pixelsPerUnit: 12,
    supersample: 2,
    margin: 8,
  });
  for (const degrees of ROTATION_SWEEP) {
    const distorted = distortImage(fixture.raster, {
      rotation: degrees,
      fill: FILL,
    });
    assertSweepDecoded('rotation', degrees, decodeFrontend(distorted));
  }
});

test('원근 sweep 7점 × 양축: -30~30도 전 구간 복호', {
  timeout: 180_000,
}, () => {
  // 고정 캔버스 원근이 심볼을 자르지 않도록 M1 기하 시험용 여백을 둔다.
  const fixture = render(SWEEP_TEXT, 2, 'M', {
    pixelsPerUnit: 12,
    supersample: 2,
    margin: 18,
  });
  for (const axis of ['horizontal', 'vertical']) {
    for (const degrees of PERSPECTIVE_SWEEP) {
      const distorted = distortImage(fixture.raster, {
        perspective: { degrees, axis },
        fill: FILL,
      });
      assertSweepDecoded('perspective-' + axis, degrees, decodeFrontend(distorted));
    }
  }
});

test('full-frame scale sweep 7점: 0.5~2.0배 전 구간 복호', {
  timeout: 180_000,
}, () => {
  // distortImage의 scale은 고정 캔버스 zoom이다. 확대에서는 전체 심볼이 시야에
  // 남도록 margin을 확보한다. 기본 margin crop은 아래 SYMBOL_CLIPPED 회귀가 맡는다.
  for (const scale of SCALE_SWEEP) {
    const fixture = render(SWEEP_TEXT, 2, 'M', {
      pixelsPerUnit: 20,
      supersample: 2,
      margin: scale > 1 ? 18 : undefined,
    });
    const distorted = distortImage(fixture.raster, { scale, fill: FILL });
    assertSweepDecoded('scale', scale, decodeFrontend(distorted));
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
  assert.equal(result.reason, FRONTEND_FAILURE.SYMBOL_CLIPPED);
  assert.equal(result.detail.pipelineStage, 'bootstrap-geometry');

  const zoomFixture = render('zoom-clipped', 2, 'M', {
    pixelsPerUnit: 20,
    supersample: 2,
  });
  const zoomed = distortImage(zoomFixture.raster, { scale: 2, fill: FILL });
  const zoomResult = decodeFrontend(zoomed);
  assert.equal(zoomResult.ok, false, JSON.stringify(zoomResult));
  assert.equal(zoomResult.reason, FRONTEND_FAILURE.SYMBOL_CLIPPED);
  assert.equal(zoomResult.detail.pipelineStage, 'bootstrap-finder');
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
