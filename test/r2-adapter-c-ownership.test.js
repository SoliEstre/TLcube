import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticC, observeAll, callDetect, alignCandidate, copyField } from './r2-c-fixtures.js';

function setup(options) {
  const field = syntheticC().field, run = observeAll(field, options);
  const rows = run.rows.filter(row => row.format.kind === 'read' && row.n === 14);
  assert.ok(rows.length >= 2);
  return { ...run, allRows: run.rows, rows, a: run.adapter.bindCandidate(rows[0].observation, rows[0].format),
    b: run.adapter.bindCandidate(rows[1].observation, rows[1].format) };
}
test('C 후보별 H·bound·표본 소유권 및 외부 배열 별칭 차단', () => {
  const run = setup(), { a, b, field, calls } = run;
  assert.notEqual(a.bound, b.bound); assert.notEqual(a.bound.cellCoord, b.bound.cellCoord);
  assert.notDeepEqual(a.H, b.H);
  const oldH = a.H.slice(), sampleA = alignCandidate(a, field, calls);
  const sampleB = alignCandidate(b, field, calls);
  assert.notDeepEqual(sampleA.faceLuma, sampleB.faceLuma, '다른 H의 표본을 한 전역 결과로 합치지 않아요');
  assert.deepEqual(alignCandidate(a, field, calls).faceLuma, sampleA.faceLuma);
  assert.deepEqual(a.H, oldH);
  const exposed = a.H; exposed.fill(0);
  const exposedObservation = run.rows[0].observation.H; exposedObservation.fill(0);
  assert.deepEqual(a.H, oldH);
  assert.deepEqual(alignCandidate(a, field, calls).faceLuma, sampleA.faceLuma);
});

test('C 동일 timestamp·frameId 쌍 1회와 후보별 캐시·H 개정 키', () => {
  const run = setup(), { adapter, field, calls, a, b } = run;
  const start = adapter.stats.observedFrames;
  callDetect(adapter, field, calls, {}, 1000000);
  callDetect(adapter, field, calls, {}, 1000000);
  alignCandidate(a, field, calls, 1000000); alignCandidate(a, field, calls, 1000000);
  alignCandidate(b, field, calls, 1000000);
  assert.equal(adapter.stats.observedFrames, start + 1); assert.equal(a.age, 1); assert.equal(b.age, 1);
  assert.equal(adapter.stats.sampleComputations, 2); assert.equal(adapter.stats.sampleCacheHits, 1);
  callDetect(adapter, field, calls + 1, {}, 1000000);
  alignCandidate(a, field, calls + 1, 1000000);
  assert.equal(adapter.stats.sampleComputations, 3);
  assert.equal(adapter.stats.observedFrames, start + 2); assert.equal(a.age, 2);
  alignCandidate(a, field, calls + 1, 1000001);
  assert.equal(adapter.stats.sampleComputations, 4);
  assert.equal(adapter.stats.observedFrames, start + 3); assert.equal(a.age, 3);
  const before = adapter.stats.sampleComputations, revision = a.revision;
  const second = run.rows[1];
  assert.equal(a.reobserve(second.observation, second.format), true);
  assert.equal(a.revision, revision + 1); assert.equal(a.hud, null);
  const refreshed = alignCandidate(a, field, calls + 1, 1000001);
  assert.equal(adapter.stats.sampleComputations, before + 1);
  assert.deepEqual(refreshed.faceLuma, alignCandidate(b, field, calls + 1, 1000001).faceLuma);
});

test('C first bind read 전용·잘못된 포맷·외부 관측·key 변경 거부', () => {
  const run = setup(), row = run.rows[0];
  assert.equal(run.adapter.bindCandidate(row.observation, { kind: 'unknown' }), null);
  assert.equal(run.adapter.bindCandidate(row.observation, { ...row.format, ecc: 'H' }), null);
  assert.equal(run.adapter.bindCandidate({ ...row.observation }, row.format), null);
  const different = observeAll(run.field).rows[0];
  assert.equal(run.a.reobserve(different.observation, different.format), false, '다른 관측기의 토큰은 거부해요');
  const rowK16 = run.allRows.find(item => item.n === 16 && item.format.kind === 'read');
  assert.ok(rowK16);
  assert.equal(run.a.reobserve(rowK16.observation, rowK16.format), false);
  assert.equal(run.a.invalidated, 'candidate-key-changed'); assert.equal(run.a.H, null);
});

for (const trigger of ['resize', 'invalidateLock', 'reset', 'generation']) test(`C ${trigger} 뒤 후보·H·캐시·HUD 폐기`, () => {
  const run = setup(), { adapter, field, calls, a } = run;
  alignCandidate(a, field, calls, calls, { generation: 'old' });
  assert.ok(a.hud);
  if (trigger === 'invalidateLock' || trigger === 'reset') adapter[trigger]();
  else if (trigger === 'generation') callDetect(adapter, field, calls + 1, {}, calls + 1, { generation: 'new' });
  else callDetect(adapter, { width: 16, height: 16, data: new Float32Array(256) }, calls + 1);
  assert.ok(a.invalidated); assert.equal(a.H, null); assert.equal(a.hud, null);
  const sampled = alignCandidate(a, field, calls + 2);
  assert.equal(sampled.output.gatePassed, 0); assert.ok(sampled.visibleCells.every(value => value === 0));
});

test('C 동일 프레임 이름의 픽셀 교체도 낡은 결과·표본을 재사용하지 않는다', () => {
  const run = setup(), { adapter, calls, a } = run, field = copyField(run.field), out = {};
  callDetect(adapter, field, calls, out); assert.equal(out.found, 1);
  alignCandidate(a, field, calls); assert.ok(a.hud);
  field.data.fill(1);
  callDetect(adapter, field, calls, out);
  assert.equal(out.found, 0); assert.ok(a.invalidated); assert.equal(a.hud, null);
});

test('C 후보 dispose는 자기 상태만 반복 안전하게 폐기한다', () => {
  const run = setup(), { a, b, field, calls, adapter } = run;
  assert.equal(a.dispose(), true);
  assert.equal(a.dispose(), false);
  assert.equal(a.invalidated, 'disposed');
  assert.equal(a.H, null);
  assert.equal(b.invalidated, null);
  assert.ok(b.H);
  assert.equal(adapter.stats.discarded, 0);
  const disposed = alignCandidate(a, field, calls);
  assert.equal(disposed.output.gatePassed, 0);
  assert.ok(disposed.visibleCells.every(value => value === 0));
  const live = alignCandidate(b, field, calls);
  assert.equal(live.output.gatePassed, 1);
  const out = {};
  callDetect(adapter, field, calls + 1, out);
  assert.equal(adapter.stats.discarded, 0);
});
