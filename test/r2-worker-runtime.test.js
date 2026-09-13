import test from 'node:test';
import assert from 'node:assert/strict';
import { createR2WorkerRuntime } from '../src/r2-worker-runtime.js';
import { createR2WorkerEndpoint } from '../src/r2-worker-entry.js';

const field = () => ({ width: 8, height: 8, data: new Float32Array(64).fill(.5) });
const display = () => ({ stats: { frames: 1 }, view: {}, hudCandidates: [
  { id: 'test', H: new Float64Array(9).fill(1), tracking: true, retained: false },
] });
function setup(extra = {}) {
  const workers = [];
  const runtime = createR2WorkerRuntime({ enabled: true, createWorker() {
    const instance = { messages: [], terminated: false,
      postMessage(message, transfer = []) { this.messages.push(structuredClone(message, { transfer })); },
      terminate() { this.terminated = true; },
      emit(message) { this.onmessage({ data: message }); } };
    workers.push(instance); return instance;
  }, ...extra });
  return { runtime, workers };
}
function answer(worker, request, extra = {}) {
  worker.emit({ type: 'result', generation: request.generation, requestId: request.requestId,
    frameId: request.frameId, timestamp: request.timestamp, serviceMs: 3, hit: null, snapshot: display(), ...extra });
}

test('Worker 카메라 기본 호출은 소수점 timestamp를 보존한 ID로 보내요', () => {
  const {runtime,workers}=setup();
  runtime.pushFrame(field(),123.456,{ownedInput:true});
  assert.equal(workers[0].messages[0].timestamp,123.456);
  assert.equal(workers[0].messages[0].frameId,'123.456');
  runtime.pushFrame(field(),123.456); assert.equal(runtime.stats.worker.pending,0);
  answer(workers[0],workers[0].messages[0]);
  assert.equal(runtime.stats.worker.processed,1); runtime.dispose();
});

test('H 확장 프레임은 Y 입력과 별개로 전달되고 호출자 버퍼를 보존한다',()=>{
  const {runtime,workers}=setup(),y=field(),h={width:10,height:10,data:new Float32Array(100).fill(.7)};
  runtime.pushFrame(y,1,{ownedInput:true,hField:h});
  assert.equal(y.data.byteLength,0);assert.equal(h.data.byteLength,400);
  const request=workers[0].messages[0];assert.equal(request.field.width,8);assert.equal(request.hField.width,10);
  let options,seen;
  const receive=createR2WorkerEndpoint(()=>{}, {createEngine:()=>({pushFrame(f,t,o){seen=f;options=o;return null;},stats:{},view:{},hudCandidates:[]})});
  receive(request);assert.equal(seen.width,8);assert.equal(options.hField.width,10);
  runtime.dispose();
});

test('Worker 처리1+최신대기1만 남고 기본 호출자의 입력 버퍼는 detach하지 않아요', () => {
  const { runtime, workers } = setup(), input = field();
  runtime.pushFrame(input, 1); runtime.pushFrame(field(), 2); runtime.pushFrame(field(), 3);
  assert.equal(input.data.byteLength, 256);
  const worker = workers[0]; assert.equal(worker.messages.length, 1);
  assert.equal(runtime.stats.worker.pending, 1); assert.equal(runtime.stats.worker.dropped, 1);
  answer(worker, worker.messages[0]);
  assert.equal(worker.messages.length, 2); assert.equal(worker.messages[1].timestamp, 3);
  assert.equal(runtime.stats.worker.pending, 0);
  runtime.dispose(); assert.equal(worker.terminated, true);
});

test('FPS 완료 콜백은 처리 답마다 한 번이며 제출·교체·중복·옛 세대 답에는 호출하지 않아요', () => {
  const processed = [], { runtime, workers } = setup({ onProcessed: event => processed.push(event) });
  runtime.pushFrame(field(), 1); runtime.pushFrame(field(), 2); runtime.pushFrame(field(), 3);
  assert.deepEqual(processed, [], '입력 제출과 최신 대기 교체는 처리 완료가 아니에요');
  const worker = workers[0], first = worker.messages[0];
  answer(worker, first);
  assert.deepEqual(processed, [{ frameId: 1, timestamp: 1, serviceMs: 3 }]);
  answer(worker, first);
  assert.equal(processed.length, 1, '중복 답은 계수하지 않아요');
  const second = worker.messages.at(-1);
  assert.equal(second.timestamp, 3);
  answer(worker, second);
  assert.deepEqual(processed.map(event => event.timestamp), [1, 3]);
  runtime.pushFrame(field(), 4); const stale = worker.messages.at(-1);
  runtime.reset(); answer(worker, stale);
  assert.equal(processed.length, 2, '이전 세대 답은 계수하지 않아요');
  runtime.setEnabled(false); runtime.pushFrame(field(), 5);
  assert.equal(processed.length, 2); runtime.dispose();
});

test('owned input은 전송되고 처리 결과 표시 사본은 runtime input을 되떼지 않아요', () => {
  const { runtime, workers } = setup(), input = field();
  runtime.pushFrame(input, 1, { ownedInput: true });
  assert.equal(input.data.byteLength, 0);
  assert.equal(workers[0].messages[0].field.data.byteLength, 256);
  let retained, response;
  const receive = createR2WorkerEndpoint(message => response = structuredClone(message), { createEngine: () => ({
    pushFrame(value) { retained = value; return { text: 'actual-endpoint' }; },
    get stats() { return { frames: 1 }; }, get view() { return {}; }, get hudCandidates() { return []; },
  }) });
  receive(workers[0].messages[0]);
  assert.equal(response.hit.text, 'actual-endpoint'); assert.equal(retained.data.byteLength, 256);
});

test('reset/토글은 이전 Worker를 종료하고 늦은 성공을 새 세대에 받지 않아요', () => {
  const { runtime, workers } = setup(); runtime.pushFrame(field(), 1);
  const old = workers[0], request = old.messages[0];
  runtime.reset(); assert.equal(old.terminated, true);
  answer(old, request, { hit: { text: 'stale' } });
  assert.equal(runtime.stats.worker.staleResults, 1);
  assert.equal(runtime.pushFrame(field(), 2), null);
  assert.equal(workers.length, 2);
  runtime.setEnabled(false); assert.equal(workers[1].terminated, true);
  assert.equal(runtime.pushFrame(field(), 3), null);
});

test('종료된 옛 Worker의 error와 messageerror는 새 세션을 fallback으로 내리지 않아요', () => {
  const { runtime, workers } = setup();
  runtime.pushFrame(field(), 1);
  const old = workers[0];
  runtime.reset();
  runtime.pushFrame(field(), 2);
  const current = workers[1];
  old.onerror({ message: 'old error', preventDefault() {} });
  old.onmessageerror();
  assert.equal(runtime.stats.worker.mode, 'worker');
  assert.equal(current.terminated, false);
});

test('현재 Worker 오류는 fallback으로 전환해요', () => {
  const { runtime, workers } = setup();
  runtime.pushFrame(field(), 1);
  workers[0].onerror({ message: 'current error', preventDefault() {} });
  assert.equal(runtime.stats.worker.mode, 'main-fallback');
  assert.equal(workers[0].terminated, true);
});

test('invalidate 뒤 같은 Worker의 오류는 fallback으로 전환해요', () => {
  const { runtime, workers } = setup();
  runtime.pushFrame(field(), 1);
  const current = workers[0];
  runtime.invalidateLock();
  current.onerror({ message: 'invalidate current error', preventDefault() {} });
  assert.equal(runtime.stats.worker.mode, 'main-fallback');
  assert.equal(current.terminated, true);
});

test('줌 invalidate는 Worker/누적을 종료하지 않고 이전 결과를 거른 뒤 순서대로 재개해요', () => {
  const { runtime, workers } = setup(); runtime.pushFrame(field(), 1);
  const worker = workers[0], old = worker.messages[0]; runtime.invalidateLock();
  assert.equal(worker.terminated, false); assert.equal(worker.messages[1].type, 'invalidate');
  runtime.pushFrame(field(), 2);
  answer(worker, old, { hit: { text: 'old-zoom' } });
  assert.equal(runtime.stats.worker.staleResults, 1);
  const command = worker.messages[1];
  worker.emit({ type: 'invalidated', ...command, type: 'invalidated', snapshot: display() });
  assert.equal(worker.messages.at(-1).type, 'frame'); assert.equal(worker.messages.at(-1).timestamp, 2);
});

test('수용 답은 한 번 반환되고 대기 입력이 그 답을 덮지 않아요', () => {
  const { runtime, workers } = setup(); runtime.pushFrame(field(), 1); runtime.pushFrame(field(), 2);
  const worker = workers[0]; answer(worker, worker.messages[0], { hit: { text: 'done', profile: 'O' } });
  assert.equal(worker.messages.length, 1);
  assert.deepEqual(runtime.pushFrame(field(), 3), { text: 'done', profile: 'O' });
  assert.equal(runtime.pushFrame(field(), 4), null);
  assert.equal(worker.messages.length, 2);
});

test('실제 endpoint invalidate는 엔진 reset/재생성 없이 락만 풀어요', () => {
  let created = 0, resets = 0, invalidations = 0, pushes = 0;
  const responses = [], receive = createR2WorkerEndpoint(message => responses.push(message), { createEngine: () => {
    created++; return { reset() { resets++; }, invalidateLock() { invalidations++; },
      pushFrame() { pushes++; return null; }, stats: {}, view: {}, hudCandidates: [] };
  } });
  receive({ type: 'frame', generation: 1, requestId: 1, frameId: 1, timestamp: 1, field: field() });
  receive({ type: 'invalidate', generation: 2, requestId: 2 });
  receive({ type: 'frame', generation: 2, requestId: 3, frameId: 3, timestamp: 3, field: field() });
  assert.equal(created, 1); assert.equal(resets, 0); assert.equal(invalidations, 1); assert.equal(pushes, 2);
  assert.equal(responses[1].type, 'invalidated');
});

test('candidateScope는 Worker init과 fallback에 동일하게 전달돼요', () => {
  let fallbackOptions = null;
  const { runtime, workers } = setup({
    engineOptions: { candidateScope: 'y' },
    createFallback(options) {
      fallbackOptions = options;
      return { pushFrame() { return null; }, reset() {}, setEnabled() {},
        stats: {}, view: {}, hudCandidates: [] };
    },
  });
  runtime.pushFrame(field(), 1, { ownedInput: true });
  assert.equal(workers[0].messages[0].options.candidateScope, 'y');
  workers[0].onerror({ message: 'worker fail', preventDefault() {} });
  assert.equal(runtime.stats.worker.mode, 'main-fallback');
  assert.equal(fallbackOptions.candidateScope, 'y');
  assert.equal(fallbackOptions.enabled, true);
  runtime.dispose();
});

test('Worker 초기화 실패는 관측 가능한 fallback 상태이고 off일 때 일하지 않아요', () => {
  let pushes = 0;
  const runtime = createR2WorkerRuntime({ enabled: true,
    createWorker() { throw new Error('CSP denied'); }, createFallback: () => ({
      pushFrame() { pushes++; return null; }, reset() {}, setEnabled() {},
      stats: {}, view: {}, hudCandidates: [],
    }) });
  runtime.pushFrame(field(), 1); assert.equal(runtime.stats.worker.mode, 'main-fallback');
  assert.match(runtime.stats.worker.lastError, /CSP denied/);
  runtime.setEnabled(false); runtime.pushFrame(field(), 2); assert.equal(pushes, 1);
});
