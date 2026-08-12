/**
 * y-tone-degradation-sweep.test.js — 2/3톤 열화 비교의 동조건 계약.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Y_TONE_SWEEP_LEVELS,
  createPairedSweepPlan,
  preparePairedCondition,
  runPairedCondition,
  validatePairedCondition,
} from '../tools/y-tone-degradation-sweep.mjs';

test('Y 2톤/3톤 열화 스윕은 네 축에서 tones 외 입력과 렌더 기하를 고정한다', () => {
  const plan = createPairedSweepPlan();
  const expectedCount = Object.values(Y_TONE_SWEEP_LEVELS)
    .reduce((total, levels) => total + levels.length, 0);
  assert.equal(plan.length, expectedCount);

  for (const condition of plan) {
    const pairing = validatePairedCondition(condition);
    assert.equal(pairing.controlled, true, condition.axis + '=' + condition.level);
    assert.equal(condition.two.text, condition.three.text);
    assert.equal(condition.two.version, condition.three.version);
    assert.equal(condition.two.eccLevel, condition.three.eccLevel);
    assert.equal(condition.two.margin, condition.three.margin);
    assert.equal(condition.two.sourcePixelsPerUnit, condition.three.sourcePixelsPerUnit);
    assert.equal(condition.two.transform, condition.three.transform);
  }

  const lowResolution = plan.find((condition) =>
    condition.axis === 'lowResolution' && condition.level === 6);
  const prepared = preparePairedCondition(lowResolution);
  assert.deepEqual(prepared.geometry, {
    n: 21,
    canvasWidth: prepared.geometry.canvasWidth,
    canvasHeight: prepared.geometry.canvasHeight,
    sceneWidth: prepared.geometry.sceneWidth,
    sceneHeight: prepared.geometry.sceneHeight,
  });
});

test('Y 2톤/3톤 열화 스윕의 기준 행은 같은 크기로 각각 정확히 복호한다', {
  timeout: 60_000,
}, () => {
  const baseline = createPairedSweepPlan({
    levels: {
      blur: [0],
      lowResolution: [16],
      perspective: [0],
      gamma: [1],
    },
  })[0];
  const result = runPairedCondition(baseline);
  assert.equal(result.pairing.controlled, true);
  assert.equal(result.two.decoded, true);
  assert.equal(result.three.decoded, true);
  assert.equal(result.two.width, result.three.width);
  assert.equal(result.two.height, result.three.height);
  assert.equal(result.split, false);
});
