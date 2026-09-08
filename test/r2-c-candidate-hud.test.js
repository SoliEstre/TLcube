import test from 'node:test';
import assert from 'node:assert/strict';
import { createCCandidateRuntime } from '../src/r2/c-candidate-runtime.js';
import { syntheticC, copyField } from './r2-c-fixtures.js';
import { R2_INDICATOR } from '../src/r2/session.js';

const fixture = syntheticC(0, 'C HUD 실제 후보');
function create() {
  return createCCandidateRuntime({ maxIdleFrames: 40,
    observation: { budget: { detectMs: 32 }, maxHypotheses: 8 } });
}
function push(runtime, frame, field = fixture.field) {
  return runtime.pushFrame(field, frame * 33, { frameId: frame, runDetect: true, maxCandidates: 8 });
}
function acquire(runtime, start = 0) {
  for (let frame = start; frame < start + 180; frame++) {
    const hit = push(runtime, frame);
    if (runtime.leading) return { frame, hit, leading: runtime.leading };
  }
  assert.fail(`실제 C 후보 없음: ${JSON.stringify(runtime.stats)}`);
}

test('C HUD는 실제 bound 순서·현재 표본/H를 후보별 사본으로 제공해요', () => {
  const runtime = create();
  const { frame, leading } = acquire(runtime);
  const { node } = leading;
  const row = runtime.hudCandidates.find(r => r.id === node.hud.id);
  assert.ok(row);
  assert.equal(row.type, 'C'); assert.equal(row.geometryMode, 'c-hex');
  assert.equal(row.k, node.runtime.bound.dimension);
  assert.equal(row.dimensionKind, 'radius-k');
  assert.deepEqual(row.cellCoord, node.runtime.bound.cellCoord);
  assert.notEqual(row.cellCoord.buffer, node.runtime.bound.cellCoord.buffer);
  assert.deepEqual([...row.H], [...node.candidate.H]);
  assert.deepEqual(row.cellMap, node.runtime.session.result.progress.cellMap);
  assert.deepEqual(row.faceLuma, node.runtime.session.buffers.faceLuma);
  assert.deepEqual(row.visibleCells, node.runtime.session.buffers.visibleCells);
  for (const key of ['cellMap', 'faceLuma', 'visibleCells']) {
    const source = key === 'cellMap' ? node.runtime.session.result.progress.cellMap : node.runtime.session.buffers[key];
    assert.notEqual(row[key].buffer, source.buffer);
    const before = source.slice(); row[key].fill(0); assert.deepEqual(source, before);
  }
  const id = row.id, revision = row.revision;
  push(runtime, frame + 1);
  const next = runtime.hudCandidates.find(r => r.id === id);
  assert.ok(next); assert.ok(next.revision > revision);
  assert.equal(next.frameWidth, fixture.field.width); assert.equal(next.frameHeight, fixture.field.height);
  assert.equal(next.tracking, true); assert.equal(next.retained, false);
});

test('C DONE의 ID/revision/정정은 retire 뒤에도 같은 소유 snapshot을 가리켜요', () => {
  const runtime = create(); let hit = null;
  for (let frame = 0; frame < 180 && !hit; frame++) hit = push(runtime, frame);
  assert.ok(hit, JSON.stringify(runtime.stats)); assert.equal(hit.text, fixture.text);
  assert.equal(hit.profile, 'C'); assert.match(hit.candidateId, /^r2-c-\d+$/);
  assert.ok(Number.isSafeInteger(hit.revision) && hit.revision > 0);
  const row = runtime.hudCandidates.find(r => r.id === hit.candidateId);
  assert.equal(row, hit.hudSnapshot); assert.equal(row.revision, hit.revision);
  assert.equal(row.indicator, R2_INDICATOR.DONE);
  assert.ok(row.cellMap.some(v => v > 0));
  for (const index of hit.correctedCells) assert.ok(index < row.cellCount);
  const before = { H: row.H.slice(), cells: row.cellMap.slice(), samples: row.faceLuma.slice() };
  runtime.reset(); assert.equal(runtime.hudCandidates.length, 0);
  assert.deepEqual(row.H, before.H); assert.deepEqual(row.cellMap, before.cells);
  assert.deepEqual(row.faceLuma, before.samples);
  const oldId = row.id;
  acquire(runtime);
  assert.ok(runtime.hudCandidates.every(r => r.id !== oldId), 'reset 뒤 ID를 재사용했어요');
});

test('C 용량 폐기와 같은 프레임 내용 교체는 살아 있는 HUD를 남기지 않아요', () => {
  const runtime = create();
  const first = acquire(runtime);
  const oldRows = [...runtime.hudCandidates];
  runtime.setCapacity(0);
  assert.equal(runtime.hudCandidates.length, 0);
  assert.ok(oldRows.every(row => row.alive === false));
  runtime.reset();
  const next = acquire(runtime);
  const changed = copyField(fixture.field); changed.data[0] = changed.data[0] === 0 ? 1 : 0;
  push(runtime, next.frame, changed);
  assert.equal(runtime.hudCandidates.length, 0);
  assert.ok(first.frame >= 0);
});
