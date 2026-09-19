import assert from 'node:assert/strict';
import test from 'node:test';
import { createXScanRuntime } from '../src/x-scan-runtime.js';

function clockAt(value = 0) { let now = value; return { clock: () => now, set: (next) => { now = next; } }; }
function input(overrides = {}) {
  const out = {
    schemaVersion: 1, frameId: 0, generation: 0, timestamp: 0, sessionId: 's',
    field: { width: 1, height: 1, data: new Float32Array([0.5]) },
    calibration: { model: 'pinhole-rectified', width: 1, height: 1, fx: 1, fy: 1, cx: 0, cy: 0 },
    observationProfile: { id: 'off', tones: 2, lowLevel: 0, highLevel: 1, contrastMin: 0.1, localGainMin: 1, localGainMax: 1 },
    profiles: [{ profileId: 'X0', layoutId: 'lee-fo-v1', N: 8, c: 0, tones: 2 }], budget: { maxMs: 10, maxCandidates: 1 },
  };
  return { ...out, ...overrides };
}
function assertBlank(result, status, reason) {
  assert.deepEqual(result, { status, reason, hit: null, observations: [] });
}

test('기본 disabled fast-path는 malformed input도 읽지 않고 항상 빈 결과예요', () => {
  const runtime = createXScanRuntime();
  const explosive = new Proxy({}, { get() { throw new Error('input inspected'); }, ownKeys() { throw new Error('input inspected'); } });
  assertBlank(runtime.pushFrame(explosive), 'disabled', 'disabled');
  assert.equal(runtime.stats.disabled, 1);
  assert.equal(runtime.stats.frames, 0);
  assert.equal(runtime.due(0), false);
});

test('enabled에서는 unimplemented만 반환하며 due/backoff와 중복 frame을 구분해요', () => {
  const t = clockAt(0);
  const runtime = createXScanRuntime({ enabled: true, minIntervalMs: 10, maxBackoffMs: 40, clock: t.clock });
  assert.equal(runtime.due(), true);
  assertBlank(runtime.pushFrame(input()), 'rejected', 'unimplemented');
  assert.equal(runtime.stats.attempted, 1);
  t.set(5);
  assertBlank(runtime.pushFrame(input({ frameId: 1, timestamp: 5 })), 'backoff', 'backoff-active');
  t.set(10);
  assertBlank(runtime.pushFrame(input()), 'rejected', 'duplicate-frame');
  assert.equal(runtime.stats.duplicateFrames, 1);
  t.set(10);
  assertBlank(runtime.pushFrame(input({ frameId: 2, timestamp: 10 })), 'rejected', 'unimplemented');
  assert.equal(runtime.stats.unimplemented, 2);
});

test('generation reset, stale, timestamp/size rejection과 stats 경계가 동작해요', () => {
  const t = clockAt(0);
  const runtime = createXScanRuntime({ enabled: true, minIntervalMs: 0, clock: t.clock });
  assertBlank(runtime.pushFrame(input()), 'rejected', 'unimplemented');
  runtime.reset();
  assert.equal(runtime.generation, 1);
  assertBlank(runtime.pushFrame(input({ frameId: 1, generation: 0 })), 'stale', 'stale-generation');
  t.set(2);
  assertBlank(runtime.pushFrame(input({ frameId: 1, generation: 1, timestamp: 2 })), 'rejected', 'unimplemented');
  assertBlank(runtime.pushFrame(input({ frameId: 2, generation: 1, timestamp: 1 })), 'rejected', 'timestamp-regression');
  t.set(3);
  assertBlank(runtime.pushFrame(input({ frameId: 3, generation: 1, timestamp: 3, field: { width: 2, height: 1, data: new Float32Array([0, 1]) }, calibration: { model: 'pinhole-rectified', width: 2, height: 1, fx: 1, fy: 1, cx: 0, cy: 0 } })), 'rejected', 'frame-size-changed');
  assert.equal(Object.keys(runtime.stats).every((key) => Number.isFinite(runtime.stats[key])), true);
});

test('validation budget와 stale age는 detector 없이 별도 결과로 노출돼요', () => {
  let calls = 0;
  const clock = () => { calls += 1; return calls === 1 ? 0 : 20; };
  const budgeted = createXScanRuntime({ enabled: true, clock, minIntervalMs: 0 });
  assertBlank(budgeted.pushFrame(input({ budget: { maxMs: 1, maxCandidates: 1 } })), 'budget-aborted', 'validation-budget-exceeded');
  const t = clockAt(300);
  const stale = createXScanRuntime({ enabled: true, clock: t.clock, maxResultAgeMs: 100 });
  assertBlank(stale.pushFrame(input({ timestamp: 0 })), 'stale', 'stale-result');
  assertBlank(stale.pushFrame({}), 'rejected', 'invalid-input');
});

test('backoff scheduling skip은 hostile getter와 malformed DTO를 검사하지 않아요', () => {
  const t = clockAt(0);
  const runtime = createXScanRuntime({ enabled: true, minIntervalMs: 10, clock: t.clock });
  assertBlank(runtime.pushFrame(input()), 'rejected', 'unimplemented');
  t.set(5);
  const hostile = {};
  Object.defineProperty(hostile, 'field', { enumerable: true, get() { throw new Error('backoff must not inspect'); } });
  assertBlank(runtime.pushFrame(hostile), 'backoff', 'backoff-active');
});

test('clock 역행은 호출 사이와 validation 중 모두 거절하고 option type도 좁혀요', () => {
  assert.throws(() => createXScanRuntime({ enabled: 'true' }), /boolean/);
  const t = clockAt(10);
  const runtime = createXScanRuntime({ enabled: true, minIntervalMs: 0, clock: t.clock });
  assertBlank(runtime.pushFrame(input({ timestamp: 10 })), 'rejected', 'unimplemented');
  t.set(9);
  assertBlank(runtime.pushFrame(input({ frameId: 1, timestamp: 9 })), 'rejected', 'clock-regression');
  let calls = 0;
  const backwardsDuringValidation = createXScanRuntime({ enabled: true, minIntervalMs: 0, clock: () => (++calls === 1 ? 10 : 9) });
  assertBlank(backwardsDuringValidation.pushFrame(input({ timestamp: 10 })), 'rejected', 'clock-regression');
});

test('세션은 최초 수용 뒤 고정되고 reset/setEnabled가 generation과 history를 끊어요', () => {
  const t = clockAt(0);
  const runtime = createXScanRuntime({ enabled: true, minIntervalMs: 0, clock: t.clock });
  assertBlank(runtime.pushFrame(input({ sessionId: 'a' })), 'rejected', 'unimplemented');
  t.set(1);
  assertBlank(runtime.pushFrame(input({ frameId: 1, timestamp: 1, sessionId: 'b' })), 'rejected', 'session-changed');
  runtime.reset();
  assert.equal(runtime.generation, 1);
  t.set(0);
  assertBlank(runtime.pushFrame(input({ generation: 1, sessionId: 'b', timestamp: 0 })), 'rejected', 'unimplemented');
  runtime.setEnabled(false);
  assert.equal(runtime.generation, 2);
  assertBlank(runtime.pushFrame({}), 'disabled', 'disabled');
  runtime.setEnabled(true);
  assert.equal(runtime.generation, 3);
});

test('64-frame history/TTL와 backoff cap, rejected 총계의 부분 분류가 보존돼요', () => {
  const t = clockAt(0);
  const history = createXScanRuntime({ enabled: true, minIntervalMs: 0, clock: t.clock });
  for (let frameId = 0; frameId <= 64; frameId += 1) {
    t.set(frameId);
    assertBlank(history.pushFrame(input({ frameId, timestamp: frameId })), 'rejected', 'unimplemented');
  }
  t.set(65);
  assertBlank(history.pushFrame(input({ frameId: 0, timestamp: 65 })), 'rejected', 'unimplemented');
  t.set(4_000);
  assertBlank(history.pushFrame(input({ frameId: 1, timestamp: 4_000 })), 'rejected', 'unimplemented');

  const backoffClock = clockAt(0);
  const backoff = createXScanRuntime({ enabled: true, minIntervalMs: 10, maxBackoffMs: 40, clock: backoffClock.clock });
  assertBlank(backoff.pushFrame(input()), 'rejected', 'unimplemented');
  backoffClock.set(10); assert.equal(backoff.due(), true);
  assertBlank(backoff.pushFrame(input({ frameId: 1, timestamp: 10 })), 'rejected', 'unimplemented');
  backoffClock.set(29); assert.equal(backoff.due(), false);
  backoffClock.set(30); assert.equal(backoff.due(), true);
  assertBlank(backoff.pushFrame(input({ frameId: 2, timestamp: 30 })), 'rejected', 'unimplemented');
  backoffClock.set(69); assert.equal(backoff.due(), false);
  backoffClock.set(70); assert.equal(backoff.due(), true);

  const counted = createXScanRuntime({ enabled: true, minIntervalMs: 0, clock: t.clock });
  t.set(5_000); assertBlank(counted.pushFrame(input({ timestamp: 5_000 })), 'rejected', 'unimplemented');
  assertBlank(counted.pushFrame({}), 'rejected', 'invalid-input');
  assertBlank(counted.pushFrame(input({ timestamp: 5_000 })), 'rejected', 'duplicate-frame');
  assert.equal(counted.stats.rejected, counted.stats.unimplemented + counted.stats.invalidInputs + counted.stats.duplicateFrames);
});
