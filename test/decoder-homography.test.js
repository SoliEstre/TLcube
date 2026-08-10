/**
 * decoder-homography.test.js — 4점 H, 역변환, 퇴화와 결정성 검증.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateHomography4,
  invertHomography,
  projectPoint,
  refineHomographyPhotometric,
} from '../src/decoder/homography.js';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { axialToPixel } from '../src/hexgrid.js';
import { anchorCells } from '../src/placement.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';

const EPSILON = 1e-8;

function assertPointNear(actual, expected, message) {
  assert.ok(actual !== null, (message || '투영 실패') + ': null');
  assert.ok(Math.abs(actual.x - expected.x) <= EPSILON, (message || 'x') + ': ' + actual.x);
  assert.ok(Math.abs(actual.y - expected.y) <= EPSILON, (message || 'y') + ': ' + actual.y);
}

function paletteOf(name) {
  const preset = getPreset(name);
  return {
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

const KNOWN_H = new Float64Array([
  1.31, -0.34, 250,
  0.28, 1.12, 140,
  0.0011, -0.0007, 1,
]);

const CANONICAL_POINTS = [
  { x: -4, y: -3 },
  { x: 6, y: -2 },
  { x: 5, y: 4 },
  { x: -3, y: 6 },
];

function knownImagePoints() {
  return CANONICAL_POINTS.map((point) => {
    const projected = projectPoint(KNOWN_H, point);
    assert.ok(projected !== null);
    return projected;
  });
}

test('회전·스케일·원근이 섞인 알려진 H를 4점으로 복원한다', () => {
  const imagePoints = knownImagePoints();
  const estimated = estimateHomography4(CANONICAL_POINTS, imagePoints);
  assert.ok(estimated instanceof Float64Array);

  for (const point of [
    ...CANONICAL_POINTS,
    { x: 1.5, y: -0.75 },
    { x: -1.25, y: 2.5 },
  ]) {
    const expected = projectPoint(KNOWN_H, point);
    const actual = projectPoint(estimated, point);
    assertPointNear(actual, expected, '알려진 H 재투영');
  }
});

test('H -> inverseH 왕복 오차는 수치오차 수준이다', () => {
  const estimated = estimateHomography4(CANONICAL_POINTS, knownImagePoints());
  assert.ok(estimated !== null);
  const inverse = invertHomography(estimated);
  assert.ok(inverse instanceof Float64Array);

  for (const canonical of [
    ...CANONICAL_POINTS,
    { x: 0.25, y: 1.5 },
    { x: -2.25, y: -0.5 },
  ]) {
    const image = projectPoint(estimated, canonical);
    const roundTrip = projectPoint(inverse, image);
    assertPointNear(roundTrip, canonical, 'H 역변환 왕복');
  }
});

test('공선·중복 대응점은 조용히 null로 퇴화 처리한다', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const collinear = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ];
  const duplicate = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  assert.equal(estimateHomography4(collinear, square), null);
  assert.equal(estimateHomography4(square, collinear), null);
  assert.equal(estimateHomography4(duplicate, square), null);
});

test('w가 0인 투영과 특이 H 역행렬은 null을 반환한다', () => {
  const horizon = new Float64Array([
    1, 0, 0,
    0, 1, 0,
    1, 0, -1,
  ]);
  const singular = new Float64Array([
    1, 0, 0,
    0, 0, 0,
    0, 0, 1,
  ]);

  assert.equal(projectPoint(horizon, { x: 1, y: 0 }), null);
  assert.equal(invertHomography(singular), null);
});

test('실제 encode -> buildScene -> rasterize 기하의 중심과 3 앵커를 복원한다', () => {
  const encoded = encode('H fixture', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, {
    palette: paletteOf(DEFAULT_PRESET),
    cellSize: 3,
    margin: 7,
  });
  const raster = rasterize(scene, { pixelsPerUnit: 6, supersample: 2 });
  const canonicalLayout = { size: 1, originX: 0, originY: 0 };
  const anchorCoordinates = anchorCells(encoded.k).map(({ q, r }) => ({ q, r }));
  const axialCoordinates = [{ q: 0, r: 0 }, ...anchorCoordinates];

  const canonical = axialCoordinates.map(({ q, r }) => axialToPixel(q, r, canonicalLayout));
  const image = axialCoordinates.map(({ q, r }) => {
    const point = axialToPixel(q, r, scene.layout);
    return {
      x: point.x * raster.pixelsPerUnit,
      y: point.y * raster.pixelsPerUnit,
    };
  });

  const estimated = estimateHomography4(canonical, image);
  assert.ok(estimated !== null);

  const probeCanonical = axialToPixel(2, -1, canonicalLayout);
  const probeImage = axialToPixel(2, -1, scene.layout);
  const expected = {
    x: probeImage.x * raster.pixelsPerUnit,
    y: probeImage.y * raster.pixelsPerUnit,
  };
  const actual = projectPoint(estimated, probeCanonical);
  assertPointNear(actual, expected, '렌더 기하 probe');
  assert.ok(actual.x >= 0 && actual.x < raster.width);
  assert.ok(actual.y >= 0 && actual.y < raster.height);
});

test('4점 추정과 score 주입 photometric 보정은 결정적이며 입력 H를 바꾸지 않는다', () => {
  const first = estimateHomography4(CANONICAL_POINTS, knownImagePoints());
  const second = estimateHomography4(CANONICAL_POINTS, knownImagePoints());
  assert.ok(first !== null && second !== null);
  assert.deepEqual(Array.from(first), Array.from(second));

  const initialH = new Float64Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);
  const luma = {
    width: 2,
    height: 2,
    data: new Float32Array([0, 0.25, 0.75, 1]),
    alpha: null,
  };
  const score = (_luma, H) => -Math.abs(H[2] - 0.003);
  const options = { score, iterations: 3, step: 0.001 };

  const refinedA = refineHomographyPhotometric(luma, { family: 'hex', H: initialH }, options);
  const refinedB = refineHomographyPhotometric(luma, { family: 'hex', H: initialH }, options);
  assert.ok(refinedA !== null && refinedB !== null);
  assert.deepEqual(Array.from(refinedA.H), Array.from(refinedB.H));
  assert.equal(initialH[2], 0, '보정이 caller의 H를 제자리 변경하면 안 된다');
  assert.equal(refinedA.H[2], 0.003);
});
