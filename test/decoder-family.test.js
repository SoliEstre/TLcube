
/**
 * decoder-family.test.js — 패밀리 점수와 hard-check 진단 검증
 *
 * Type O/A는 실제 인코더와 렌더러를 거친 상대휘도 합성 입력으로 검사하고,
 * Type Y와 패밀리 충돌은 명시적인 실패/가설 입력으로 경계를 고정한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  getPreset,
  relativeLuminance,
} from '../src/luminance.js';
import { regionCells, hexDistance } from '../src/hexgrid.js';
import { regionCellsA } from '../src/placementA.js';
import {
  classifyFamily,
  scoreCubeTiling,
  scoreHexTiling,
  scoreTriTiling,
} from '../src/decoder/family.js';
import { FRONTEND_FAILURE } from '../src/decoder/contracts.js';

const PRESET = getPreset('slate');
const PALETTE = {
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
};

function renderLuma(encoded, options = {}) {
  const cellSize = options.cellSize === undefined ? 20 : options.cellSize;
  const scene = buildScene(encoded, {
    palette: PALETTE,
    cellSize,
    margin: options.margin,
  });
  const raster = rasterize(scene, {
    pixelsPerUnit: 1,
    supersample: options.supersample === undefined ? 2 : options.supersample,
  });
  const data = new Float32Array(raster.width * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const offset = (y * raster.width + x) * 4;
      data[y * raster.width + x] = relativeLuminance({
        r: raster.pixels[offset],
        g: raster.pixels[offset + 1],
        b: raster.pixels[offset + 2],
      });
    }
  }
  return {
    luma: {
      width: raster.width,
      height: raster.height,
      data,
      alpha: null,
    },
    finder: {
      center: { x: scene.layout.originX, y: scene.layout.originY },
      cellSize,
      score: 1,
      hardChecksPassed: true,
    },
  };
}

test('Type O: hex 점수는 axial tiling hard-check, tri는 패치 부재로 탈락', () => {
  const encoded = encode('family hex', { version: 1, eccLevel: 'M' });
  const rendered = renderLuma(encoded);
  const hex = scoreHexTiling(rendered.luma, rendered.finder, {
    ks: [encoded.k],
    minSeparation: 0.04,
  });
  const tri = scoreTriTiling(rendered.luma, rendered.finder, {
    ks: [encoded.k],
    minSeparation: 0.04,
  });

  assert.equal(hex.ok, true);
  assert.equal(hex.family, 'hex');
  assert.equal(hex.k, encoded.k);
  assert.equal(hex.hardChecks.all, true);
  assert.equal(tri.ok, true);
  assert.equal(tri.family, 'tri');
  assert.equal(tri.hardChecks.patchTiling, false);
  assert.equal(tri.hardChecks.all, false);
});

test('Type O: classifyFamily는 전 가설·진단을 보존하고 hex만 선택', () => {
  const encoded = encode('classify hex', { version: 1, eccLevel: 'M' });
  const rendered = renderLuma(encoded);
  const options = { ks: [encoded.k], minSeparation: 0.04 };
  const first = classifyFamily(rendered.luma, { finder: rendered.finder }, options);
  const second = classifyFamily(rendered.luma, { finder: rendered.finder }, options);

  assert.equal(first.ok, true);
  assert.equal(first.family, 'hex');
  assert.deepEqual(first, second, '동일 입력의 패밀리 진단이 달라졌다');
  assert.ok(first.hypotheses.some((candidate) => candidate.family === 'hex'));
  assert.ok(first.hypotheses.some((candidate) => candidate.family === 'tri'));
  assert.equal(first.diagnostics.cube.ok, false);
  assert.equal(first.diagnostics.cube.detail.unimplemented, true);
});

test('Type A: 육각 코어가 hex로 보이더라도 tri 패치가 있으면 O를 hard 선택하지 않음', () => {
  const encoded = encodeA('family tri', { version: 1, eccLevel: 'M' });
  const rendered = renderLuma(encoded, {
    cellSize: 10,
    margin: 240,
    supersample: 2,
  });
  const core = regionCells(encoded.k)
    .filter((cell) => hexDistance(cell.q, cell.r) > 2)
    .slice(0, 24);
  const patches = regionCellsA(encoded.k)
    .filter((cell) => hexDistance(cell.q, cell.r) > encoded.k)
    .slice(0, 24);
  const options = {
    ks: [encoded.k],
    sampleCells: core,
    patchCells: patches,
    minSeparation: 0.04,
  };
  const tri = scoreTriTiling(rendered.luma, rendered.finder, options);
  const classified = classifyFamily(rendered.luma, { finder: rendered.finder }, options);

  assert.equal(tri.ok, true);
  assert.equal(tri.hardChecks.patchTiling, true);
  assert.equal(tri.hardChecks.all, true);
  assert.equal(classified.ok, true);
  assert.equal(classified.family, 'tri');
  const hex = classified.hypotheses.find((candidate) => candidate.family === 'hex');
  assert.ok(hex);
  assert.equal(hex.hardChecks.patchExclusion, false);
  assert.equal(hex.hardChecks.all, false);
});

test('Type Y: 검출 계약이 없으므로 scoreCubeTiling은 명시적 fail', () => {
  const luma = {
    width: 2,
    height: 2,
    data: new Float32Array([0, 0.2, 0.6, 1]),
    alpha: null,
  };
  const result = scoreCubeTiling(luma, { center: { x: 1, y: 1 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.NO_GRID_HYPOTHESIS);
  assert.equal(result.detail.family, 'cube');
  assert.equal(result.detail.unimplemented, true);
});

test('패밀리 충돌은 포맷으로 타이브레이크하지 않고 FAMILY_AMBIGUOUS', () => {
  const luma = {
    width: 2,
    height: 2,
    data: new Float32Array([0, 0.2, 0.6, 1]),
    alpha: null,
  };
  const evidence = {
    hypotheses: [
      {
        family: 'hex',
        score: 0.8,
        hardChecks: { all: true },
      },
      {
        family: 'tri',
        score: 0.7,
        hardChecks: { all: true },
      },
    ],
  };
  const result = classifyFamily(luma, evidence);
  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.FAMILY_AMBIGUOUS);
  assert.deepEqual(
    result.detail.diagnostics.hardFamilies,
    ['hex', 'tri'],
  );
  assert.equal(result.detail.hypotheses.length, 2);
});

test('패밀리 입력 경계와 결정성', () => {
  const empty = classifyFamily(null, {});
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, FRONTEND_FAILURE.EMPTY_INPUT);

  const constant = {
    width: 4,
    height: 4,
    data: new Float32Array(16).fill(0.5),
    alpha: null,
  };
  const degenerate = scoreHexTiling(constant, {
    center: { x: 2, y: 2 },
    cellSize: 4,
  });
  assert.equal(degenerate.ok, false);
  assert.equal(degenerate.reason, FRONTEND_FAILURE.LUMA_DEGENERATE);

  const encoded = encode('no finder', { version: 1, eccLevel: 'M' });
  const rendered = renderLuma(encoded);
  const noFinder = classifyFamily(rendered.luma, {});
  assert.equal(noFinder.ok, false);
  assert.equal(noFinder.reason, FRONTEND_FAILURE.NO_GRID_HYPOTHESIS);

  const first = scoreHexTiling(rendered.luma, rendered.finder, {
    ks: [encoded.k],
    minSeparation: 0.04,
  });
  const second = scoreHexTiling(rendered.luma, rendered.finder, {
    ks: [encoded.k],
    minSeparation: 0.04,
  });
  assert.deepEqual(first, second);
});
