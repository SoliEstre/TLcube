import assert from 'node:assert/strict';
import test from 'node:test';

import { PROPOSAL_CELL_CACHE_TEST_ONLY } from '../src/decoder/cube-detect.js';

function runCellSample(memoize) {
  const profile = { segment: 'mutation' };
  const luma = {
    width: 32,
    height: 32,
    data: new Float32Array(32 * 32).fill(0.5),
    alpha: null,
  };
  const H = new Float64Array([6, 0, 16, 0, 6, 16, 0, 0, 1]);
  const sample = PROPOSAL_CELL_CACHE_TEST_ONLY.cellSurfaceSampler(
    luma,
    { H },
    { _proposalProfile: profile },
    {
      minimumSampleCount: 1,
      minimumProjectedMinorDiameter: 0,
      sampleDiscFraction: 0.35,
    },
    memoize,
  );
  return {
    first: sample(0, 0),
    second: sample(0, 0),
    counters: profile.cellSurfaceSamples,
  };
}

test('proposal 셀 캐시는 동일 결과를 내고 두 번째 셀 평가를 재사용한다', () => {
  const before = runCellSample(false);
  const after = runCellSample(true);

  assert.deepEqual(after.first, before.first);
  assert.deepEqual(after.second, before.second);
  assert.deepEqual(before.counters, { calls: 2, hits: 0, misses: 2 });
  assert.deepEqual(after.counters, { calls: 2, hits: 1, misses: 1 });
  assert.equal(PROPOSAL_CELL_CACHE_TEST_ONLY.cellSurfaceMemoizationEnabled({}), true);
  assert.equal(PROPOSAL_CELL_CACHE_TEST_ONLY.cellSurfaceMemoizationEnabled({
    _memoizeCellSurfaceSamples: false,
  }), false);
});
