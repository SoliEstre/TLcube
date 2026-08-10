/**
 * decoder-grid-sample.test.js — projective 원판 샘플링의 렌더 기반 계약 테스트
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
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  discMedianLuminance,
  measureCellFaceMedians,
  recoverDigit,
} from '../src/verify.js';
import { faceSampleDisc } from '../src/hexgrid.js';
import {
  FRONTEND_FAILURE,
} from '../src/decoder/contracts.js';
import {
  rankConfidence,
  sampleHexCell,
  sampleHexGrid,
  sampleProjectedDisc,
} from '../src/decoder/grid-sample.js';

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

function mediansOf(cell) {
  return { T: cell.T.median, L: cell.L.median, R: cell.R.median };
}

function renderedFixture() {
  const encoded = encode('grid sampler', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: paletteOf(DEFAULT_PRESET) });
  const raster = rasterize(scene, { pixelsPerUnit: 24, supersample: 1 });
  return {
    encoded,
    scene,
    raster,
    luma: lumaFromRaster(raster),
    geometry: {
      layout: scene.layout,
      H: new Float64Array([24, 0, 0, 0, 24, 0, 0, 0, 1]),
    },
  };
}

test('실제 렌더: canonical 원판 표본은 verify.js와 같은 digit을 복원한다', () => {
  const fixture = renderedFixture();
  const q = 2;
  const r = 1; // V1의 알려진 digit-3 reference 위치

  const sampled = sampleHexCell(fixture.luma, fixture.geometry, q, r);
  assert.equal(sampled.ok, true);

  const measured = measureCellFaceMedians(fixture.raster, fixture.scene, q, r);
  for (const face of ['T', 'L', 'R']) {
    assert.ok(
      Math.abs(sampled[face].median - measured[face]) < 1e-6,
      face + ' median이 verify.js 기준과 다르다',
    );
  }

  const expected = fixture.encoded.cellDigits.get(q + ',' + r).digit;
  assert.equal(recoverDigit(mediansOf(sampled)), expected);
  assert.equal(recoverDigit(measured), expected);
  assert.equal(sampled.tie, false);

  const disc = faceSampleDisc(q, r, 'T', fixture.scene.layout);
  const projected = sampleProjectedDisc(fixture.luma, fixture.geometry.H, disc);
  assert.equal(projected.ok, true);
  const verifyMedian = discMedianLuminance(
    fixture.raster,
    disc.x * fixture.raster.pixelsPerUnit,
    disc.y * fixture.raster.pixelsPerUnit,
    disc.radius * fixture.raster.pixelsPerUnit,
  );
  assert.ok(Math.abs(projected.median - verifyMedian) < 1e-6);
});

test('전 격자 표본은 불스아이를 제외하고 layoutMap의 모든 셀을 결정적으로 담는다', () => {
  const fixture = renderedFixture();
  const first = sampleHexGrid(fixture.luma, fixture.geometry, layoutMap(fixture.encoded.k));
  const second = sampleHexGrid(fixture.luma, fixture.geometry, layoutMap(fixture.encoded.k));

  assert.equal(first.ok, true);
  assert.equal(first.cells.size, fixture.encoded.cellDigits.size);
  assert.equal(first.cells.has('0,0'), false, '불스아이 중심은 frontend cells에 섞이면 안 된다');
  assert.deepEqual(first, second, '같은 입력의 격자 표본은 결정적이어야 한다');

  for (const [key, cell] of first.cells) {
    const expected = fixture.encoded.cellDigits.get(key);
    assert.ok(expected, key + '가 인코더 cell map에 없다');
    assert.equal(recoverDigit(mediansOf(cell)), expected.digit, key + ' digit이 다르다');
  }
});

test('표본 부족과 반투명 표본은 SAMPLE_STARVED로 구조화해 실패한다', () => {
  const luma = {
    width: 20,
    height: 20,
    data: new Float32Array(400).fill(0.5),
    alpha: null,
  };
  const H = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  const tooSmall = sampleProjectedDisc(luma, H, { x: 10, y: 10, radius: 0.5 });
  assert.deepEqual(tooSmall.ok, false);
  assert.equal(tooSmall.reason, FRONTEND_FAILURE.SAMPLE_STARVED);

  const transparent = {
    ...luma,
    alpha: new Uint8Array(400),
  };
  const alphaFailure = sampleProjectedDisc(transparent, H, { x: 10, y: 10, radius: 3 });
  assert.equal(alphaFailure.ok, false);
  assert.equal(alphaFailure.reason, FRONTEND_FAILURE.SAMPLE_STARVED);
  assert.equal(alphaFailure.detail.opaqueCount, 0);
});

test('근접 동률은 stable rank를 만들더라도 유효한 신뢰도로 위장하지 않는다', () => {
  const stats = {
    T: { median: 0.2, mad: 0, count: 20 },
    L: { median: 0.202, mad: 0, count: 20 },
    R: { median: 0.201, mad: 0, count: 20 },
  };
  const result = rankConfidence(stats);
  assert.deepEqual(result.order, ['T', 'R', 'L']);
  assert.equal(result.tie, true);
  assert.equal(result.confident, false);
});


function invert3(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const c00 = e * i - f * h;
  const c01 = c * h - b * i;
  const c02 = b * f - c * e;
  const c10 = f * g - d * i;
  const c11 = a * i - c * g;
  const c12 = c * d - a * f;
  const c20 = d * h - e * g;
  const c21 = b * g - a * h;
  const c22 = a * e - b * d;
  const determinant = a * c00 + b * c10 + c * c20;
  return [c00 / determinant, c01 / determinant, c02 / determinant,
    c10 / determinant, c11 / determinant, c12 / determinant,
    c20 / determinant, c21 / determinant, c22 / determinant];
}

function project(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

test('원근 H에서도 화면 원이 아닌 역투영 canonical 원판만 표본화한다', () => {
  const H = new Float64Array([14, 0, 25, 0, 14, 20, 0.35, 0.15, 1]);
  const inverse = invert3(H);
  const width = 64;
  const height = 64;
  const data = new Float32Array(width * height);
  const radius = 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const canonical = project(inverse, x + 0.5, y + 0.5);
      const inside = canonical.x * canonical.x + canonical.y * canonical.y <= radius * radius;
      data[y * width + x] = inside ? 0.75 : 0.25;
    }
  }

  const result = sampleProjectedDisc({ width, height, data, alpha: null }, H, {
    x: 0,
    y: 0,
    radius,
  });
  assert.equal(result.ok, true);
  assert.equal(result.median, 0.75);
  assert.equal(result.mad, 0);
});
