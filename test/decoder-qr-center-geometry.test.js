import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPoint } from '../src/decoder/homography.js';
import {
  CENTER_QR_MODULE_TO_CELL,
  affineHomographyFromThree,
  qrCenterHomographies,
} from '../src/decoder/qr-center-geometry.js';

test('중앙 QR 기하는 세 파인더에서 두 축의 affine H를 결정적으로 만든다', () => {
  const canonical = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  const observed = [{ x: 10, y: 20 }, { x: 14, y: 20 }, { x: 10, y: 23 }];
  const affine = affineHomographyFromThree(canonical, observed);
  assert.ok(affine instanceof Float64Array);
  assert.deepEqual(projectPoint(affine, canonical[0]), observed[0]);
  assert.deepEqual(projectPoint(affine, canonical[1]), observed[1]);
  assert.deepEqual(projectPoint(affine, canonical[2]), observed[2]);
  assert.equal(affineHomographyFromThree([canonical[0], canonical[1], canonical[1]], observed), null);

  const candidate = {
    shared: { x: 100, y: 100 },
    axisA: { x: 140, y: 100 },
    axisB: { x: 100, y: 140 },
  };
  const homographies = qrCenterHomographies(candidate);
  assert.equal(homographies.length, 2);
  const offset = 7 * CENTER_QR_MODULE_TO_CELL;
  assert.deepEqual(projectPoint(homographies[0], { x: -offset, y: -offset }), candidate.shared);
  assert.deepEqual(projectPoint(homographies[1], { x: -offset, y: -offset }), candidate.shared);
});
