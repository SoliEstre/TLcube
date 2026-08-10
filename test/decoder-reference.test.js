/**
 * decoder-reference.test.js — Type O digit-3 reference의 순서·coverage 검증
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
  relativeLuminance,
} from '../src/luminance.js';
import { layoutMap } from '../src/layout.js';
import { referenceCells } from '../src/placement.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { FRONTEND_FAILURE } from '../src/decoder/contracts.js';
import { sampleHexGrid } from '../src/decoder/grid-sample.js';
import {
  estimateLocalWarp,
  validateLocalWarp,
  validateOReferences,
} from '../src/decoder/reference-validate.js';

function paletteOf(name) {
  const preset = getPreset(name);
  return {
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

function lumaFromRaster(raster) {
  const data = new Float32Array(raster.width * raster.height);
  for (let index = 0; index < data.length; index += 1) {
    const pixel = index * 4;
    data[index] = relativeLuminance({
      r: raster.pixels[pixel],
      g: raster.pixels[pixel + 1],
      b: raster.pixels[pixel + 2],
    });
  }
  return { width: raster.width, height: raster.height, data, alpha: null };
}

function fixture() {
  const encoded = encode('decoder reference', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: paletteOf(DEFAULT_PRESET) });
  const raster = rasterize(scene, { pixelsPerUnit: 24, supersample: 1 });
  const geometry = {
    H: new Float64Array([
      raster.pixelsPerUnit, 0, scene.layout.originX * raster.pixelsPerUnit,
      0, raster.pixelsPerUnit, scene.layout.originY * raster.pixelsPerUnit,
      0, 0, 1,
    ]),
  };
  const grid = sampleHexGrid(lumaFromRaster(raster), geometry, layoutMap(encoded.k));
  assert.equal(grid.ok, true);
  return { encoded, geometry, luma: lumaFromRaster(raster), grid };
}

function brokenSample() {
  return {
    T: { median: 0.90, mad: 0, count: 30 },
    L: { median: 0.10, mad: 0, count: 30 },
    R: { median: 0.20, mad: 0, count: 30 },
    separation: 0.10,
    tie: false,
  };
}

function lowConfidenceSample() {
  return {
    T: { median: 0.200, mad: 0.01, count: 30 },
    R: { median: 0.201, mad: 0.01, count: 30 },
    L: { median: 0.202, mad: 0.01, count: 30 },
    separation: 0.001,
    tie: true,
  };
}

test('실제 렌더의 모든 Type O reference는 digit 3 순서 T < R < L을 통과한다', () => {
  const input = fixture();
  const first = validateOReferences(input.grid, input.encoded.k);
  const second = validateOReferences(input.grid, input.encoded.k);

  assert.equal(first.ok, true);
  assert.equal(first.total, 8);
  assert.equal(first.validOrder, first.total);
  assert.equal(first.confident, first.total);
  assert.equal(first.orderFraction, 1);
  assert.ok(first.references.every((row) =>
    row.sample.T.median < row.sample.R.median && row.sample.R.median < row.sample.L.median,
  ));
  assert.deepEqual(first, second, '같은 grid sample의 reference 보고서는 결정적이어야 한다');
});

test('한 링의 두 reference가 모두 틀리면 coverage 실패를 REFERENCE_MISMATCH로 반환한다', () => {
  const input = fixture();
  const broken = new Map(input.grid.cells);
  for (const cell of referenceCells(input.encoded.k, 3)) {
    broken.set(cell.q + ',' + cell.r, brokenSample());
  }

  const result = validateOReferences(broken, input.encoded.k);
  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.REFERENCE_MISMATCH);
  assert.equal(result.detail.report.perRing.get(3).confident, 0);
  assert.ok(result.detail.violations.some((entry) => entry.type === 'ring-coverage'));
});

test('전체 expected-order 비율이 미검증 초기값 75% 아래면 mismatch다', () => {
  const input = fixture();
  const broken = new Map(input.grid.cells);
  for (const ring of [3, 4, 5]) {
    const cell = referenceCells(input.encoded.k, ring)[0];
    broken.set(cell.q + ',' + cell.r, brokenSample());
  }

  const result = validateOReferences(broken, input.encoded.k);
  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.REFERENCE_MISMATCH);
  assert.ok(result.detail.report.orderFraction < 0.75);
  assert.ok(result.detail.violations.some((entry) => entry.type === 'global-order-fraction'));
});

test('순서가 맞아도 한 링의 confidence가 모두 무너지면 coverage 실패다', () => {
  const input = fixture();
  const weak = new Map(input.grid.cells);
  for (const cell of referenceCells(input.encoded.k, 3)) {
    weak.set(cell.q + ',' + cell.r, lowConfidenceSample());
  }

  const result = validateOReferences(weak, input.encoded.k);
  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.REFERENCE_MISMATCH);
  assert.equal(result.detail.report.validOrder, result.detail.report.total);
  assert.equal(result.detail.report.perRing.get(3).confident, 0);
});

test('국소 보정 채택 판정과 0-offset 보정 경로는 결정적이다', () => {
  const accepted = validateLocalWarp(
    [{ margin: 0.10 }, { margin: 0.10 }, { margin: 0.10 }],
    [{ margin: 0.12 }, { margin: 0.12 }, { margin: 0.12 }],
  );
  assert.equal(accepted.accepted, true);

  const input = fixture();
  const references = validateOReferences(input.grid, input.encoded.k);
  assert.equal(references.ok, true);

  const options = { searchRadiusCells: 0, searchStepCells: 0.025 };
  const first = estimateLocalWarp(input.luma, input.geometry, references, options);
  const second = estimateLocalWarp(input.luma, input.geometry, references, options);

  assert.equal(first.ok, true);
  assert.equal(first.correctionAccepted, false, '무왜곡 입력은 보정 개선이 없어야 한다');
  assert.deepEqual(first, second, '국소 보정 탐색은 RNG 없이 결정적이어야 한다');
});
