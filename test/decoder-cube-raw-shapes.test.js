/**
 * decoder-cube-raw-shapes.test.js — n/format/body 전의 contour 6점 export 계약.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
  relativeLuminance,
} from '../src/luminance.js';
import {
  detectCubeHypotheses,
  detectRawCubeShapes,
} from '../src/decoder/cube-detect.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});

function rasterToLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  const alpha = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const offset = index * 4;
    data[index] = relativeLuminance({
      r: raster.pixels[offset],
      g: raster.pixels[offset + 1],
      b: raster.pixels[offset + 2],
    });
    alpha[index] = raster.pixels[offset + 3];
  }
  return { width: raster.width, height: raster.height, data, alpha };
}

function fixtureLuma() {
  const encoded = encodeY('raw-shape-contract', {
    version: 0,
    tones: 2,
    eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE });
  return rasterToLuma(rasterize(scene, { pixelsPerUnit: 12, supersample: 2 }));
}

function polygonArea(points) {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    twice += points[index].x * next.y - next.x * points[index].y;
  }
  return twice / 2;
}

function legacyRawCandidates(luma, extraOptions = {}) {
  const result = detectCubeHypotheses(luma, undefined, {
    finderFirst: false,
    enableCellSurfaceY: false,
    enableLocatorY: false,
    ...extraOptions,
  });
  const diagnostics = result.ok
    ? result.diagnostics
    : result.detail && result.detail.diagnostics;
  return diagnostics && Array.isArray(diagnostics.shapeCandidates)
    ? diagnostics.shapeCandidates
    : [];
}

test('raw shape export는 기존 contour 후보를 n/format/body 전에 복사한다', () => {
  const luma = fixtureLuma();
  const result = detectRawCubeShapes(luma, { maxCandidates: 16 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.source, {
    kind: 'observed-contour-y-junction',
    contour: 'component-boundary',
    support: 'pixel-seam-evidence',
    regeneratedFromHomography: false,
  });
  assert.ok(result.candidates.length > 0, '합성 Type Y에서 contour 후보가 있어야 한다');

  const legacy = legacyRawCandidates(luma);
  assert.equal(result.diagnostics.downsampleFactor, 1, 'fixture는 좌표 lift 없는 대조군이어야 한다');
  assert.equal(result.candidates.length, legacy.length);
  for (let index = 0; index < result.candidates.length; index += 1) {
    const candidate = result.candidates[index];
    assert.deepEqual(candidate.vertices, legacy[index].vertices);
    assert.deepEqual(candidate.center, legacy[index].center);
    assert.deepEqual(candidate.seamVertices, legacy[index].seamVertices);
    assert.equal(candidate.componentSource, legacy[index].componentSource);
    assert.equal(candidate.seamParity, legacy[index].seamParity);
    assert.deepEqual(Object.keys(candidate).sort(), [
      'center', 'componentIndex', 'componentSource', 'concurrencyResidual',
      'maskFill', 'radius', 'score', 'seamParity', 'seamVertices', 'vertices',
    ]);
    assert.equal(candidate.vertices.length, 6);
    assert.ok(Math.abs(polygonArea(candidate.vertices)) > 0);
    for (const point of [candidate.center, ...candidate.vertices, ...candidate.seamVertices]) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(point.x >= 0 && point.x <= luma.width - 1);
      assert.ok(point.y >= 0 && point.y <= luma.height - 1);
    }
  }
  assert.equal('rejections' in result.diagnostics, false);
  assert.equal('backgroundModels' in result.diagnostics, false);
  assert.equal(JSON.stringify(result).includes('estimatedN'), false);
  assert.equal(JSON.stringify(result).includes('homography'), false);
});

test('downsample 후보를 원본 frame 좌표로 복사한다', () => {
  const luma = fixtureLuma();
  const calibration = { maxDimension: 500 };
  const result = detectRawCubeShapes(luma, { maxCandidates: 16, calibration });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.downsampleFactor, 2);
  const legacy = legacyRawCandidates(luma, { calibration });
  assert.equal(result.candidates.length, legacy.length);
  assert.ok(result.candidates.length > 0);
  const lift = (point) => ({ x: point.x * 2 + 0.5, y: point.y * 2 + 0.5 });
  for (let index = 0; index < legacy.length; index += 1) {
    assert.deepEqual(result.candidates[index].vertices, legacy[index].vertices.map(lift));
    assert.deepEqual(result.candidates[index].center, lift(legacy[index].center));
    assert.deepEqual(result.candidates[index].seamVertices,
      legacy[index].seamVertices.map(lift));
  }
});

test('maxCandidates는 필수 양정수이고 기존 maximumComponents 자원 경계를 넘지 않는다', () => {
  const luma = fixtureLuma();
  for (const maxCandidates of [undefined, 0, -1, 1.5]) {
    assert.throws(
      () => detectRawCubeShapes(luma, { maxCandidates }),
      { name: 'RangeError' },
    );
  }
  assert.throws(
    () => detectRawCubeShapes(luma, {
      maxCandidates: 3,
      calibration: { maximumComponents: 2 },
    }),
    { name: 'RangeError' },
  );

  const all = detectRawCubeShapes(luma, { maxCandidates: 16 });
  const one = detectRawCubeShapes(luma, { maxCandidates: 1 });
  assert.equal(one.ok, true);
  assert.ok(one.candidates.length <= 1);
  assert.equal(one.diagnostics.truncated,
    all.diagnostics.validCandidateCount > one.candidates.length);
  assert.equal(one.diagnostics.emittedCandidateCount, one.candidates.length);
});

test('반환 후보는 독립 복사이고 expected n/body/format 옵션을 소비하지 않는다', () => {
  const luma = fixtureLuma();
  const options = { maxCandidates: 16 };
  for (const key of ['n', 'expectedN', 'expectedBody', 'expectedText', 'layout', 'format']) {
    Object.defineProperty(options, key, {
      get() { throw new Error(key + ' getter를 읽으면 안 된다'); },
    });
  }
  const first = detectRawCubeShapes(luma, options);
  assert.equal(first.ok, true);
  assert.ok(first.candidates.length > 0);
  const originalX = first.candidates[0].vertices[0].x;
  first.candidates[0].vertices[0].x = -12345;
  const second = detectRawCubeShapes(luma, options);
  assert.equal(second.candidates[0].vertices[0].x, originalX);

  const invalid = detectRawCubeShapes({ width: 1, height: 1, data: new Float32Array(0) }, {
    maxCandidates: 1,
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.detail.stage, 'cube-raw-shape');
});
