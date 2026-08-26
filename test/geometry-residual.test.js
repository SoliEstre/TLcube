import test from 'node:test';
import assert from 'node:assert/strict';

import { compareOptionalMetricAscending } from '../src/decoder/contracts.js';
import { extractGeometry } from '../src/lab-telemetry.js';

test('F-95: 미실측 값은 리터럴 0처럼 실측값을 이기지 않는다', () => {
  assert.ok(compareOptionalMetricAscending(undefined, 0.8) > 0);
  assert.ok(compareOptionalMetricAscending(0.8, undefined) < 0);
  assert.equal(compareOptionalMetricAscending(undefined, undefined), 0);
  assert.ok(compareOptionalMetricAscending(0.2, 0.8) < 0);
});

test('F-95: telemetry는 서로 다른 물리량을 이름으로 분리한다', () => {
  const geometry = extractGeometry({
    ok: true,
    hypothesis: {
      reprojectionResidualPx: 0.7,
      vertexResidualPx: 1.1,
      anchorRadiusSpreadPx: 1.3,
      finderFitPenaltyPx: 1.5,
      referenceAdjustmentPx: 1.7,
      qrGeometryScore: 0.2,
    },
  }, 100, 100);
  assert.equal(geometry.residualPx, 0.7, '호환 필드는 재투영 오차만 싣는다');
  assert.equal(geometry.reprojectionResidualPx, 0.7);
  assert.equal(geometry.vertexResidualPx, 1.1);
  assert.equal(geometry.anchorRadiusSpreadPx, 1.3);
  assert.equal(geometry.finderFitPenaltyPx, 1.5);
  assert.equal(geometry.referenceAdjustmentPx, 1.7);
  assert.equal(geometry.qrGeometryScore, 0.2);
});

test('F-95: 재투영 오차가 없으면 다른 측정값을 residualPx로 위장하지 않는다', () => {
  const geometry = extractGeometry({
    ok: true,
    hypothesis: { vertexResidualPx: 1.1, finderFitPenaltyPx: 1.5 },
  }, 100, 100);
  assert.equal(geometry.residualPx, null);
  assert.equal(geometry.reprojectionResidualPx, null);
  assert.equal(geometry.vertexResidualPx, 1.1);
  assert.equal(geometry.finderFitPenaltyPx, 1.5);
});
