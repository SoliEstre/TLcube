import test from 'node:test';
import assert from 'node:assert/strict';

import { createCAdapters } from '../src/r2/adapter-c.js';
import { syntheticC, callDetect } from './r2-c-fixtures.js';

function firstRead(options) {
  const field = syntheticC(0).field;
  const adapter = createCAdapters(options);
  for (let frameId = 0; frameId < 100_000; frameId += 1) {
    const output = {};
    callDetect(adapter, field, frameId, output);
    if (output.found) return { output, frameId, stats: adapter.stats };
  }
  assert.fail('C0 최초 read가 제한 안에 나와야 해요');
}

function identity(result) {
  return {
    H: Array.from(result.output.H),
    format: result.output.format,
    coreCandidates: result.stats.coreCandidates,
    clusterCount: result.stats.clusterCount,
  };
}

test('Infinity 기본 경로는 동기 n7을 유지하고 finite만 n7 cursor를 쓴다', {
  timeout: 20_000,
}, () => {
  const baseline = firstRead();
  const finite = firstRead({ budget: { detectMs: 32 }, maxHypotheses: 1 });
  assert.deepStrictEqual(identity(finite), identity(baseline));
  assert.equal(baseline.stats.n7CursorSteps, 0);
  assert.equal(baseline.stats.n7SnapshotBytes, 0);
  assert.equal(baseline.stats.snapshotCopies, 2);
  assert.ok(finite.stats.n7CursorSteps > 0);
  assert.ok(finite.stats.n7MaxUnitMs > 0);
  assert.equal(typeof finite.stats.n7MaxUnit, 'string');
  assert.ok(finite.stats.n7SnapshotCopyMs >= 0);
  assert.ok(finite.stats.n7SnapshotBytes > 0);
  assert.equal(finite.stats.snapshotCopies, 3);
  assert.equal(finite.stats.snapshotRetainedBytes, finite.stats.n7SnapshotBytes);
});
