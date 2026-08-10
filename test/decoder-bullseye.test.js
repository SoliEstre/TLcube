/**
 * decoder-bullseye.test.js — Type O 불스아이 앞단의 합성 known-answer 검증.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maxSafeRadius, profileAt } from '../src/bullseye.js';
import { FRONTEND_FAILURE } from '../src/decoder/contracts.js';
import {
  detectBullseyes,
  refineBullseye,
  scoreBullseye,
} from '../src/decoder/bullseye-detect.js';
import { encode } from '../src/encode.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
  relativeLuminance,
} from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { distortImage } from './harness/distort.mjs';

// [미검증] M1 calibration 에서 확정 — 중심 허용치는 절대 px가 아니라 cellSize 비율이다.
const MAX_CENTER_ERROR_CELL_RATIO = 0.15;
// [미검증] M1 calibration 에서 확정 — 무왜곡·합성 왜곡의 국소 cellSize 목표 오차.
const MAX_CELL_SIZE_ERROR_RATIO = 0.05;
const RESOLUTION_SWEEP_PPUS = Object.freeze([6, 10, 16, 20, 24, 32]);

function palette() {
  const preset = getPreset(DEFAULT_PRESET);
  return {
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

function rasterToLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  const alpha = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const offset = i * 4;
    data[i] = relativeLuminance({
      r: raster.pixels[offset],
      g: raster.pixels[offset + 1],
      b: raster.pixels[offset + 2],
    });
    alpha[i] = raster.pixels[offset + 3];
  }
  return { width: raster.width, height: raster.height, data, alpha };
}

function renderedFixture(pixelsPerUnit = 8) {
  const encoded = encode('gt', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: palette() });
  const raster = rasterize(scene, { pixelsPerUnit, supersample: 2 });
  return {
    scene,
    raster,
    luma: rasterToLuma(raster),
    center: {
      x: scene.layout.originX * pixelsPerUnit,
      y: scene.layout.originY * pixelsPerUnit,
    },
    cellSize: pixelsPerUnit,
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearest(candidates, expected) {
  return candidates.reduce((best, candidate) => (
    distance(candidate.center, expected) < distance(best.center, expected) ? candidate : best
  ));
}

test('실제 encode → buildScene → rasterize 영상에서 중심을 서브픽셀로 찾고 결정적이다', () => {
  const fixture = renderedFixture(8);
  const options = { maxRefinedProposals: 2 };
  const first = detectBullseyes(fixture.luma, options);
  const second = detectBullseyes(fixture.luma, options);

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(second, first);
  assert.ok(first.candidates.length >= 1);

  const candidate = nearest(first.candidates, fixture.center);
  assert.ok(
    distance(candidate.center, fixture.center) / fixture.cellSize <= MAX_CENTER_ERROR_CELL_RATIO,
    '중심 오차가 cellSize 상대 허용치를 벗어났다: ' + JSON.stringify(candidate.center),
  );
  assert.ok(
    Math.abs(candidate.cellSize - fixture.cellSize) / fixture.cellSize
      <= MAX_CELL_SIZE_ERROR_RATIO,
    '밴드 폭에서 역산한 cellSize가 상대 허용치를 벗어났다: ' + candidate.cellSize,
  );
  assert.equal(candidate.hardChecksPassed, true);
  assert.ok(candidate.score >= 0 && candidate.score <= 1);
  assert.ok(candidate.transform instanceof Float64Array);
  assert.deepEqual(candidate.bands.values.map((band) => band.expected), [0, 1, 0, 1, 0, 1]);
});

test('ppu 6·10·16·20·24·32 실해상도 스윕에서 중심·cellSize 상대 오차를 지킨다', () => {
  for (const pixelsPerUnit of RESOLUTION_SWEEP_PPUS) {
    const fixture = renderedFixture(pixelsPerUnit);
    const result = detectBullseyes(fixture.luma);
    assert.equal(result.ok, true, JSON.stringify({ pixelsPerUnit, result }));

    const candidate = nearest(result.candidates, fixture.center);
    const centerErrorRatio = distance(candidate.center, fixture.center) / fixture.cellSize;
    const cellSizeErrorRatio = Math.abs(candidate.cellSize - fixture.cellSize) / fixture.cellSize;
    assert.ok(
      centerErrorRatio <= MAX_CENTER_ERROR_CELL_RATIO,
      'ppu ' + pixelsPerUnit + ' 중심 상대 오차: ' + centerErrorRatio,
    );
    assert.ok(
      cellSizeErrorRatio <= MAX_CELL_SIZE_ERROR_RATIO,
      'ppu ' + pixelsPerUnit + ' cellSize 상대 오차: ' + cellSizeErrorRatio,
    );
    assert.equal(candidate.hardChecksPassed, true);
  }
});

test('score/refine은 §6.4 hard check와 닫힌 투영 실패를 드러낸다', () => {
  const fixture = renderedFixture(8);
  const exact = scoreBullseye(fixture.luma, {
    center: fixture.center,
    cellSize: fixture.cellSize,
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.hardChecksPassed, true);
  assert.equal(exact.bands.hardChecks.outerBandLight, true);
  assert.equal(exact.bands.hardChecks.boundarySignsPass, true);

  const clipped = scoreBullseye(fixture.luma, {
    center: { x: 1, y: 1 },
    cellSize: fixture.cellSize,
  });
  assert.equal(clipped.ok, true);
  assert.equal(clipped.hardChecksPassed, false);
  assert.equal(clipped.bands.hardChecks.projectedClosed, false);

  const refined = refineBullseye(fixture.luma, {
    center: { x: fixture.center.x + 1.5, y: fixture.center.y - 1.5 },
    cellSize: 7.6,
  }, {
    projectiveSeeds: false,
    refineIterations: 5,
  });
  assert.equal(refined.ok, true, JSON.stringify(refined));
  assert.equal(refined.candidate.hardChecksPassed, true);
  assert.ok(
    distance(refined.candidate.center, fixture.center) / fixture.cellSize
      <= MAX_CENTER_ERROR_CELL_RATIO,
  );
});

test('회전·원근·스케일 불변성을 저해상도와 높은 ppu에서 지킨다', () => {
  const background = getPreset(DEFAULT_PRESET).background;
  const cases = [
    {
      pixelsPerUnit: 8,
      options: {
        rotation: 37,
        perspective: { degrees: 30, axis: 'both' },
        scale: 0.5,
        fill: { ...background, a: 255 },
      },
      expectedCellSize: 4,
    },
    {
      pixelsPerUnit: 8,
      options: {
        rotation: 123,
        perspective: { degrees: -30, axis: 'horizontal' },
        scale: 2,
        fill: { ...background, a: 255 },
      },
      expectedCellSize: 16,
    },
    {
      pixelsPerUnit: 20,
      options: {
        rotation: 73,
        perspective: { degrees: 30, axis: 'both' },
        scale: 0.75,
        fill: { ...background, a: 255 },
      },
      expectedCellSize: 15,
    },
  ];

  for (const entry of cases) {
    const fixture = renderedFixture(entry.pixelsPerUnit);
    const distorted = distortImage(fixture.raster, entry.options);
    const luma = rasterToLuma(distorted);
    const expectedCenter = {
      x: (distorted.width - 1) / 2,
      y: (distorted.height - 1) / 2,
    };
    const result = detectBullseyes(luma, { maxRefinedProposals: 3 });
    assert.equal(result.ok, true, JSON.stringify({ options: entry.options, result }));
    const candidate = nearest(result.candidates, expectedCenter);
    assert.ok(
      distance(candidate.center, expectedCenter) / entry.expectedCellSize
        <= MAX_CENTER_ERROR_CELL_RATIO,
      '왜곡 후 중심 상대 오차가 너무 크다: ' + JSON.stringify(candidate.center),
    );
    assert.ok(
      Math.abs(candidate.cellSize - entry.expectedCellSize) / entry.expectedCellSize
        <= MAX_CELL_SIZE_ERROR_RATIO,
      '왜곡 후 cellSize 상대 오차가 너무 크다: ' + candidate.cellSize,
    );
    assert.equal(candidate.hardChecksPassed, true);
  }
});

test('서로 떨어진 불스아이 둘을 첫 발견에서 멈추지 않고 모두 반환한다', () => {
  const width = 150;
  const height = 80;
  const cellSize = 5;
  const centers = [{ x: 35, y: 40 }, { x: 115, y: 40 }];
  const data = new Float32Array(width * height);
  data.fill(0.2);
  const outerRadius = maxSafeRadius(cellSize);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (const center of centers) {
        const d = distance({ x, y }, center);
        if (d <= outerRadius) {
          data[y * width + x] = profileAt(d, cellSize);
          break;
        }
      }
    }
  }

  const result = detectBullseyes(
    { width, height, data, alpha: null },
    { maxRefinedProposals: 4 },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.candidates.length >= 2);
  for (const center of centers) {
    assert.ok(distance(nearest(result.candidates, center).center, center) < 1.5);
  }
});

test('코드가 없는 비퇴화 영상은 NO_FINDER로 실패한다', () => {
  const width = 64;
  const height = 64;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[y * width + x] = (x + y) / (width + height);
  }
  const result = detectBullseyes(
    { width, height, data, alpha: null },
    { maxRefinedProposals: 2 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.NO_FINDER);
});
