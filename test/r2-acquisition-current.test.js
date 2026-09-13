import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanarAdapters } from '../src/r2/adapter-planar.js';
import { createR2ExpansionEngine } from '../src/r2-expansion-engine.js';
import { renderPlanar } from './helpers/r2-planar-fixture.js';

const first = renderPlanar('A', { style: 'n7', version: 0, text: 'R2-A0-PILOT' });
const other = renderPlanar('A', { style: 'n7', version: 0, text: 'OTHER-BODY' });
function acquire() {
  const adapter = createPlanarAdapters({ acquisitionPolicy: 'work', sources: ['n7'] });
  let candidate = null, frame = 0;
  for (; frame < 40 && !candidate; frame++) {
    const out = {};
    adapter.detectInto(first.field, first.field.width, first.field.height, frame * 100,
      { frameId: frame, generation: 1, budgetMs: Infinity }, out);
    if (out.format?.layoutId === 'A0') candidate = adapter.bindCandidate(out.observation, out.format);
  }
  assert.ok(candidate, '실제 광학 관측의 올바른 A0 후보가 필요해요');
  const samples = new Uint8Array(candidate.bound.cellCount * 3), visible = new Uint8Array(candidate.bound.cellCount);
  return { adapter, candidate, samples, visible, frame };
}

test('오래된 획득 결과도 현재 미세 변화에서는 검증하고 본문 교체·가림·세대 변경은 거절해요', () => {
  for (const change of ['background', 'payload', 'blank', 'generation', 'same-frame-content']) {
    const { adapter, candidate, samples, visible, frame } = acquire();
    const base = change === 'payload' ? other.field : first.field;
    const field = { ...base, data: base.data.slice(), alpha: base.alpha?.slice() };
    const timestamp = frame * 100 + 20000, out = {};
    if (change === 'same-frame-content') {
      candidate.alignInto(base, base.width, base.height, timestamp,
        { frameId: 'later', generation: 1 }, candidate, out, samples, visible);
      assert.equal(out.gatePassed, 1);
    }
    field.data[0] += 1e-5;
    if (change === 'blank') field.data.fill(.5);
    candidate.alignInto(field, field.width, field.height, timestamp,
      { frameId: 'later', generation: change === 'generation' ? 2 : 1 }, candidate, out, samples, visible);
    if (change === 'background') {
      assert.equal(out.gatePassed, 1);
      assert.ok(samples.some(Boolean));
    } else {
      assert.equal(out.gatePassed, 0, change);
      assert.ok(samples.every(value => value === 0), change);
      assert.ok(visible.every(value => value === 0), change);
      assert.ok(candidate.invalidated, change);
    }
    adapter.reset(); assert.equal(adapter.stats.snapshotBytes, 0);
  }
});

test('기본 전체 엔진은 A0/n7 cold-start 미세변화에서 원문을 읽고 나이를 새 원본으로 위장하지 않아요', {
  timeout: 60000,
}, () => {
  const engine = createR2ExpansionEngine({ enabled: true, candidateScope: 'all' });
  let hit = null;
  for (let frame = 0; frame < 360 && !hit; frame++) {
    const field = { ...first.field, data: first.field.data.slice(), alpha: first.field.alpha?.slice() };
    field.data[0] += frame * 1e-7;
    hit = engine.pushFrame(field, frame * 300, { frameId: frame });
  }
  assert.equal(hit?.text, first.text);
  assert.equal(hit?.layoutId, 'A0');
  const stats = engine.stats;
  assert.equal(stats.acquisitionPolicy.mode, 'work');
  assert.equal(stats.sharedCentralN7.exactFrameRefreshes, 0);
  const planar = stats.lanes.find(row => row.id === 'planar').observation;
  const records = [...planar.acquisition.closed, planar.acquisition.active].filter(Boolean);
  assert.ok(records.some(row => row.candidateReady > 0 && row.currentAccepted > 0));
  assert.ok(records.some(row => row.ageMs > 10000));
  engine.reset(); assert.equal(engine.stats.sharedCentralN7.retainedBytes, 0);
});

test('획득 도중 코드를 제거하면 옛 origin의 후보가 준비돼도 현재 검증을 건너뛰지 않아요', {
  timeout: 60000,
}, () => {
  const engine = createR2ExpansionEngine({ enabled: true, candidateScope: 'all' });
  for (let frame = 0; frame < 220; frame++) {
    const field = { ...first.field, data: first.field.data.slice(), alpha: first.field.alpha?.slice() };
    if (frame >= 16) field.data.fill(.5);
    field.data[0] += frame * 1e-7;
    assert.equal(engine.pushFrame(field, frame * 300, { frameId: frame }), null,
      `코드 제거 뒤 옛 원문을 수용했어요: ${frame}`);
  }
  const planar = engine.stats.lanes.find(row => row.id === 'planar').observation;
  const records = [...planar.acquisition.closed, planar.acquisition.active].filter(Boolean);
  assert.ok(records.some(row => row.candidateReady > 0 && row.currentRejected > 0),
    '현재 검증 실패가 실제로 일어난 음성이어야 해요');
  engine.reset(); assert.equal(engine.stats.sharedCentralN7.retainedBytes, 0);
});
