import test from 'node:test';
import assert from 'node:assert/strict';
import { createR2WorkerRuntime } from '../src/r2-worker-runtime.js';

const field = (value = .5) => ({ width: 8, height: 8, data: new Float32Array(64).fill(value) });
function setup(extra = {}) {
  const workers = [];
  const runtime = createR2WorkerRuntime({ enabled: true, createWorker() {
    const worker = {
      messages: [], terminated: false,
      postMessage(message, transfer = []) { this.messages.push(structuredClone(message, { transfer })); },
      terminate() { this.terminated = true; },
      emit(message) { this.onmessage({ data: message }); }
    };
    workers.push(worker); return worker;
  }, ...extra });
  return { runtime, workers };
}
function answer(worker, request, { hit = null, serviceMs = 1 } = {}) {
  worker.emit({ type: 'result', generation: request.generation, requestId: request.requestId,
    frameId: request.frameId, timestamp: request.timestamp, serviceMs,
    snapshot: { stats: {}, view: {}, hudCandidates: [] }, hit });
}

test('기본 depth 1은 busy capture를 막고 opt-in depth 2만 한 장을 보관해요', () => {
  const regular = setup();
  assert.equal(regular.runtime.processingKey, '1:worker');
  regular.runtime.pushFrame(field(), 1, { ownedInput: true });
  assert.equal(regular.runtime.canAcceptFrame(2), false);
  assert.equal(regular.runtime.stats.worker.queueDepth, 1);
  regular.runtime.dispose();

  const { runtime, workers } = setup({ workerQueueDepth: 2 });
  const first = field(.1), second = field(.2);
  runtime.pushFrame(first, 1, { frameId: 'N', ownedInput: true });
  assert.equal(first.data.byteLength, 0, 'in-flight N은 즉시 worker로 transfer된다');
  assert.equal(runtime.canAcceptFrame(2), true, 'opt-in만 N+1 준비를 허용한다');
  runtime.pushFrame(second, 2, { frameId: 'N+1', ownedInput: true });
  assert.equal(second.data.byteLength, 256, 'queued N+1은 완료 전 transfer/detach하지 않는다');
  assert.equal(runtime.canAcceptFrame(3), false, 'pending 한 장 뒤에는 다시 수요를 닫는다');
  assert.equal(runtime.stats.worker.pending, 1);
  answer(workers[0], workers[0].messages[0]);
  assert.equal(workers[0].messages.length, 2, 'N 완료 뒤에만 N+1을 worker로 보낸다');
  assert.equal(workers[0].messages[1].frameId, 'N+1');
  assert.equal(second.data.byteLength, 0, '실제 dispatch에서만 queued owned input을 detach한다');
  assert.equal(runtime.stats.worker.pending, 0);
  assert.equal(runtime.processingKey, '1:worker', 'payload 없이 generation/mode만 badge에 준다');
  runtime.dispose();
});

test('hit은 queued frame을 계수해 폐기하고 다음 push에서만 전달해요', () => {
  const { runtime, workers } = setup({ workerQueueDepth: 2 });
  runtime.pushFrame(field(), 1, { ownedInput: true });
  const queued = field();
  runtime.pushFrame(queued, 2, { ownedInput: true });
  const request = workers[0].messages[0];
  answer(workers[0], request, { hit: { text: 'done' } });
  assert.equal(workers[0].messages.length, 1, 'hit 뒤에는 stale queued frame을 dispatch하지 않는다');
  assert.equal(queued.data.byteLength, 256, '폐기된 queued owned input은 transfer되지 않는다');
  assert.equal(runtime.stats.worker.pendingDiscardedForHit, 1);
  assert.equal(runtime.canAcceptFrame(3), true, 'pending hit 전달은 막히면 안 된다');
  assert.deepEqual(runtime.pushFrame(field(), 3, { ownedInput: true }), { text: 'done' });
  assert.equal(workers[0].messages.length, 1, 'hit을 꺼내는 push는 새 frame을 만들지 않는다');
  runtime.dispose();
});

test('reset, invalidate와 worker failure는 queued frame을 session 밖으로 보내지 않고 fallback으로 격리해요', () => {
  const { runtime, workers } = setup({ workerQueueDepth: 2, createFallback: () => ({
    pushFrame() { return null; }, reset() {}, setEnabled() {}, stats: {}, view: {}, hudCandidates: []
  }) });
  runtime.pushFrame(field(), 1, { ownedInput: true });
  runtime.pushFrame(field(), 2, { ownedInput: true });
  const old = workers[0].messages[0];
  runtime.invalidateLock();
  assert.equal(runtime.processingKey, '2:worker', 'invalidate는 UI 처리창을 새 generation으로 구분한다');
  assert.equal(runtime.stats.worker.pendingDiscardedForReset, 1);
  answer(workers[0], old);
  assert.equal(runtime.stats.worker.staleResults, 1, '구 session 결과는 새 invalidate request에 섞이지 않는다');
  assert.equal(workers[0].messages.filter(message => message.type === 'frame').length, 1);

  runtime.pushFrame(field(), 3, { ownedInput: true });
  runtime.pushFrame(field(), 4, { ownedInput: true });
  const current = workers[0];
  current.onerror({ message: 'worker down', preventDefault() {} });
  assert.equal(runtime.stats.worker.mode, 'main-fallback');
  assert.equal(runtime.processingKey, '3:main-fallback');
  assert.equal(runtime.stats.worker.pendingDiscardedForReset, 2, 'failure도 queued frame을 reset 폐기로 따로 기록한다');
  assert.equal(runtime.canAcceptFrame(5), true, 'fallback은 synchronous demand를 유지한다');
  runtime.dispose();
});

test('주입 clock은 queue, worker round-trip/transport와 fallback 동기 시간을 단조로 기록해요', () => {
  const ticks = [100, 101, 110, 125, 130, 150];
  const seen = [];
  const { runtime, workers } = setup({ workerQueueDepth: 2, now: () => ticks.shift(), onProcessed: value => seen.push(value) });
  runtime.pushFrame(field(), 1, { frameId: 'N', ownedInput: true });
  runtime.pushFrame(field(), 2, { frameId: 'N+1', ownedInput: true });
  answer(workers[0], workers[0].messages[0], { serviceMs: 5 });
  assert.deepEqual(seen[0], { frameId: 'N', timestamp: 1, serviceMs: 5 });
  assert.deepEqual({ queueMs: seen[0].queueMs, roundTripMs: seen[0].roundTripMs, transportMs: seen[0].transportMs }, { queueMs: 1, roundTripMs: 24, transportMs: 19 });
  answer(workers[0], workers[0].messages[1], { serviceMs: 3 });
  assert.deepEqual(seen[1], { frameId: 'N+1', timestamp: 2, serviceMs: 3 });
  assert.deepEqual({ queueMs: seen[1].queueMs, roundTripMs: seen[1].roundTripMs, transportMs: seen[1].transportMs }, { queueMs: 20, roundTripMs: 20, transportMs: 17 });
  assert.equal(runtime.stats.worker.lastQueueMs, 20);
  runtime.dispose();

  const fallbackTicks = [5, 12];
  const fallbackSeen = [];
  const fallback = createR2WorkerRuntime({ enabled: true, now: () => fallbackTicks.shift(),
    createWorker() { throw Error('blocked'); },
    createFallback: () => ({ pushFrame() { return null; }, reset() {}, setEnabled() {}, stats: {}, view: {}, hudCandidates: [] }),
    onProcessed: value => fallbackSeen.push(value) });
  fallback.pushFrame(field(), 1);
  assert.deepEqual(fallbackSeen, [{ frameId: 1, timestamp: 1, serviceMs: 7 }]);
  assert.deepEqual({ queueMs: fallbackSeen[0].queueMs, roundTripMs: fallbackSeen[0].roundTripMs, transportMs: fallbackSeen[0].transportMs }, { queueMs: 0, roundTripMs: 7, transportMs: 0 });
  assert.equal(fallback.stats.worker.mode, 'main-fallback');
  fallback.dispose();
});
