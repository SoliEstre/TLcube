import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAcquisitionPolicy, createAcquisitionJournal } from '../src/r2/acquisition-lifetime.js';
import { createSharedCentralN7Pool } from '../src/r2/shared-central-n7.js';
import { createPlanarAdapters } from '../src/r2/adapter-planar.js';
import { createCAdapters } from '../src/r2/adapter-c.js';
import { createR2ExpansionEngine } from '../src/r2-expansion-engine.js';

const field = () => ({ width: 8, height: 8, data: new Float32Array(64).fill(.5), alpha: new Uint8Array(64).fill(255) });
const current = (ordinal = 1, timestamp = ordinal * 100, generation = 'camera') =>
  ({ frameId: ordinal, ordinal, timestamp, generation, width: 8, height: 8 });

test('획득 작업 정책은 유한 상한만 받고 zero/NaN/Infinity/unknown을 거절해요', () => {
  for (const input of [null, [], 'other', {}, { mode: 'work', maxServiceMs: Infinity },
    { mode: 'work', maxWorkUnits: 0 }, { mode: 'work', maxWorkUnits: 1.5 },
    { mode: 'work', maxServiceMs: NaN }, { mode: 'work', extra: true }]) {
    assert.throws(() => normalizeAcquisitionPolicy(input), TypeError);
  }
  assert.equal(normalizeAcquisitionPolicy('work').mode, 'work');
});

test('저널은 실제 작업과 원본 나이를 분리하고 마지막 원자 비용·최근8건만 보유해요', () => {
  const policy = normalizeAcquisitionPolicy({ mode: 'work', maxServiceMs: 5, maxWorkUnits: 3 });
  const journal = createAcquisitionJournal(policy);
  for (let i = 0; i < 12; i++) {
    const row = journal.begin(current(i), 'verified', 1);
    journal.observe(row, current(i + 1000));
    assert.equal(journal.reason(row), null, 'raw 나이만으로 만료되면 안 돼요');
    journal.charge(row, 2, 2, 'n7');
    assert.equal(journal.reason(row), null);
    journal.close(row, 'complete');
    journal.charge(row, 3, 1, 'done');
  }
  const view = journal.snapshot();
  assert.equal(view.active, null);
  assert.equal(view.closed.length, 8);
  assert.equal(view.closed[0].id, 5);
  assert.equal(view.closed.at(-1).units, 3);
  assert.equal(view.closed.at(-1).serviceMs, 6);
  assert.equal(view.closed.at(-1).ageFrames, 1000);
  view.closed.at(-1).origin.frameId = -1;
  assert.equal(journal.snapshot().closed.at(-1).origin.frameId, 11);
});

test('work pool은 미세 변화와 오래된 timestamp에도 원본을 보존하지만 current proof를 만들지 않아요', () => {
  const input = field(), pool = createSharedCentralN7Pool({ acquisitionPolicy: 'work' });
  const lease = pool.acquire(input, current());
  input.data[0] += .001;
  pool.observeFrame(input, current(1001, 100000));
  const state = lease.resume(current(1001, 100000));
  assert.notEqual(state.state, 'invalidated');
  assert.equal(state.currentFrameUsable, false);
  assert.equal(lease.origin.frameId, 1);
  assert.equal(lease.fresh.frameId, 1, '원본 나이를 갱신한 것처럼 보이면 안 돼요');
  assert.equal(pool.stats.exactFrameRefreshes, 0);
  assert.equal(pool.stats.acquisition.active.ageFrames, 1000);
  lease.release(); assert.equal(pool.stats.retainedBytes, 0);
});

test('work pool도 시간 역행·generation·resize·reset에서 모두 폐기해요', () => {
  for (const change of ['reverse', 'generation', 'resize', 'reset']) {
    const input = field(), pool = createSharedCentralN7Pool({ acquisitionPolicy: 'work' });
    const lease = pool.acquire(input, current());
    pool.observeFrame(input, current(2, 200));
    if (change === 'reset') pool.reset();
    else {
      const next = current(3, change === 'reverse' ? 150 : 300, change === 'generation' ? 'new' : 'camera');
      if (change === 'resize') next.width = 9;
      assert.equal(lease.resume(next).state, 'invalidated', change);
    }
    assert.equal(lease.snapshot, null, change);
    lease.release(); assert.equal(pool.stats.retainedBytes, 0, change);
  }
});

test('유한 작업 상한은 batch 안에서도 멈추고 완료한 원본 재가입은 남은 lease를 방해하지 않아요', () => {
  const input = field();
  const limited = createSharedCentralN7Pool({ acquisitionPolicy: { mode: 'work', maxWorkUnits: 1 } });
  const old = limited.acquire(input, current());
  const state = old.resumeBatch(current(), { budgetMs: Infinity });
  assert.equal(state.state, 'invalidated');
  assert.equal(state.reason, 'work-unit-limit');
  assert.equal(limited.stats.steps, 1);
  assert.equal(limited.stats.acquisition.closed.at(-1).closeReason, 'work-unit-limit');
  old.release(); assert.equal(limited.stats.retainedBytes, 0);

  const pool = createSharedCentralN7Pool({ acquisitionPolicy: 'work' });
  const first = pool.acquire(input, current()), keeper = pool.acquire(input, current());
  const origin = first.origin;
  first.release();
  for (let frame = 2; frame < 10; frame++) assert.equal(pool.acquire(input, current(frame), { afterOrigin: origin }), null);
  assert.equal(pool.stats.jobs, 1);
  assert.ok(keeper.snapshot);
  keeper.release(); assert.equal(pool.stats.retainedBytes, 0);
  const next = pool.acquire(input, current(10), { afterOrigin: origin });
  assert.equal(next.origin.frameId, 10);
  next.release();
});

test('평면 work cap은 후속 작업까지 세고 reset에서 공유 snapshot을 놓아요', () => {
  const input = field(), policy = { mode: 'work', maxWorkUnits: 2 };
  let now = current();
  const pool = createSharedCentralN7Pool({ acquisitionPolicy: 'work' });
  const adapter = createPlanarAdapters({ sources: ['n7'], maxWorkUnits: 1,
    sharedCentralN7: pool, sharedFrame: () => now, acquisitionPolicy: policy });
  for (let i = 1; i <= 5; i++) {
    now = current(i);
    adapter.detectInto(input, 8, 8, now.timestamp, { frameId: i, budgetMs: Infinity }, {});
  }
  assert.ok(adapter.stats.acquisition.closed.some(row => row.closeReason === 'work-unit-limit'));
  assert.ok(adapter.stats.acquisition.closed.every(row => row.units === 2));
  adapter.reset(); assert.equal(pool.stats.retainedBytes, 0);
});

test('C의 work 정책은 checkpoint/shared raw-age 두 경로를 끄고 만료 뒤 같은 origin에 재가입하지 않아요', () => {
  const input = field();
  let now = current();
  const pool = createSharedCentralN7Pool({ acquisitionPolicy: 'work' });
  const keeper = pool.acquire(input, now);
  const adapter = createCAdapters({ sharedCentralN7: pool, sharedFrame: () => now,
    acquisitionPolicy: 'work', tracking: { minNcc: .96 }, refineN7: true });
  adapter.detectInto(input, 8, 8, now.timestamp, { frameId: 1, budgetMs: .01 }, {});
  input.data[0] += .001; now = current(1001, 100000);
  pool.observeFrame(input, now);
  adapter.detectInto(input, 8, 8, now.timestamp, { frameId: now.frameId, budgetMs: .01 }, {});
  assert.equal(adapter.stats.acquisition.started, 1);
  assert.equal(adapter.stats.acquisitionExpirations, 0);
  assert.equal(adapter.stats.acquisition.active.ageFrames, 1000);
  adapter.reset(); keeper.release();

  now = current(1002, 100100);
  const retained = pool.acquire(input, now);
  const limited = createCAdapters({ sharedCentralN7: pool, sharedFrame: () => now,
    acquisitionPolicy: { mode: 'work', maxWorkUnits: 1 } });
  limited.detectInto(input, 8, 8, now.timestamp, { frameId: now.frameId, budgetMs: .01 }, {});
  for (let i = 1003; i < 1010; i++) {
    now = current(i, i * 100);
    limited.detectInto(input, 8, 8, now.timestamp, { frameId: i, budgetMs: .01 }, {});
  }
  assert.equal(limited.stats.acquisition.started, 1);
  assert.equal(limited.stats.acquisition.closed[0].closeReason, 'work-unit-limit');
  assert.ok(retained.snapshot);
  retained.release();
  now = current(1010, 101000);
  limited.detectInto(input, 8, 8, now.timestamp, { frameId: now.frameId, budgetMs: .01 }, {});
  assert.equal(limited.stats.acquisition.started, 2);
  assert.equal(limited.stats.acquisition.active.origin.frameId, 1010);
  limited.reset(); assert.equal(pool.stats.retainedBytes, 0);
});

test('engine이 age/work 정책을 pool·C·planar 모두에 전달해요', () => {
  for (const acquisitionPolicy of ['age', 'work']) {
    const engine = createR2ExpansionEngine({ enabled: true, candidateScope: 'all', acquisitionPolicy });
    const stats = engine.stats;
    assert.equal(stats.acquisitionPolicy.mode, acquisitionPolicy);
    assert.equal(stats.sharedCentralN7.acquisition.policy.mode, acquisitionPolicy);
    for (const id of ['C', 'planar']) assert.equal(stats.lanes.find(row => row.id === id).observation.acquisition.policy.mode, acquisitionPolicy);
    engine.reset(); assert.equal(engine.stats.sharedCentralN7.retainedBytes, 0);
  }
});
