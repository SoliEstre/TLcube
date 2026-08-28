import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CORNER_QR_PLACEMENTS,
  enumerateCornerQrSeeds,
  invertCornerQrPlacement,
  qrRightAngleAxes,
} from '../src/decoder/corner-qr-seed.js';

function translated(candidate, dx, dy) {
  const move = (p) => ({ x: p.x + dx, y: p.y + dy });
  return { shared: move(candidate.shared), axisA: move(candidate.axisA), axisB: move(candidate.axisB) };
}

const QR = Object.freeze({
  shared: Object.freeze({ x: 30, y: 40 }),
  axisA: Object.freeze({ x: 72, y: 40 }),
  axisB: Object.freeze({ x: 30, y: 82 }),
});

test('F-76: 직각 꼭짓점에서 4코너 모두를 열고 QR-BR 방향 하나로 접지 않는다', () => {
  const silhouettes = [
    { id: 'hex', centerOffsetModules: 35, cellSizePerQrModule: 2 },
    { id: 'tri', centerOffsetModules: 39, cellSizePerQrModule: 2.5 },
    { id: 'star', centerOffsetModules: 43, cellSizePerQrModule: 3 },
  ];
  const seeds = enumerateCornerQrSeeds([QR], silhouettes);
  assert.equal(seeds.length, 12);
  assert.deepEqual(new Set(seeds.map((seed) => seed.placement)), new Set(CORNER_QR_PLACEMENTS));
  assert.equal(seeds.every((seed) => seed.coarseOnly === true), true);
  assert.equal(seeds.every((seed) => seed.source === 'corner-qr-seed'), true);
  for (const silhouette of silhouettes) {
    assert.equal(seeds.filter((seed) => seed.silhouette === silhouette.id).length, 4);
  }
});

test('역산은 평행이동 등변성 및 셀 스케일 비례를 지킨다', () => {
  const origin = invertCornerQrPlacement(QR, 'BR', 35, 2.5);
  const moved = invertCornerQrPlacement(translated(QR, 101, -17), 'BR', 35, 2.5);
  assert.deepEqual(moved.center, { x: origin.center.x + 101, y: origin.center.y - 17 });
  assert.equal(moved.cellSize, origin.cellSize);

  const doubled = invertCornerQrPlacement({
    shared: { x: 60, y: 80 }, axisA: { x: 144, y: 80 }, axisB: { x: 60, y: 164 },
  }, 'BR', 35, 2.5);
  assert.equal(doubled.cellSize, origin.cellSize * 2);
});

test('직각 꼭짓점/축은 후보의 shared를 보존하며 공선 삼중점은 거부한다', () => {
  const axes = qrRightAngleAxes(QR);
  assert.deepEqual(axes.origin, QR.shared);
  assert.equal(axes.module, 3);
  assert.throws(() => qrRightAngleAxes({
    shared: { x: 0, y: 0 }, axisA: { x: 14, y: 0 }, axisB: { x: 28, y: 0 },
  }), /공선/);
});
