import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createR2WorkerRuntime } from '../src/r2-worker-runtime.js';

const field = () => ({ width: 8, height: 8, data: new Float32Array(64).fill(.5) });
function setup(extra = {}) {
  const workers = [];
  const runtime = createR2WorkerRuntime({ enabled: true, createWorker() {
    const worker = { messages: [], postMessage(message, transfer = []) {
      this.messages.push(structuredClone(message, { transfer }));
    }, terminate() {}, emit(message) { this.onmessage({ data: message }); } };
    workers.push(worker); return worker;
  }, ...extra });
  return { runtime, workers };
}
function result(worker, request, snapshot = { stats: {}, view: {}, hudCandidates: [{ tracking: true, retained: false }] }) {
  worker.emit({ type: 'result', generation: request.generation, requestId: request.requestId,
    frameId: request.frameId, timestamp: request.timestamp, serviceMs: 1, snapshot, hit: null });
}

test('수요 API는 busy에서 false이고 완료 뒤 새 캡처를 받으며, 기회 timestamp가 stale tracking을 막아요', () => {
  const { runtime, workers } = setup();
  assert.equal(runtime.canAcceptFrame(1), true);
  runtime.pushFrame(field(), 1, { ownedInput: true });
  assert.equal(runtime.canAcceptFrame(2), false, 'in-flight 중 새 luma 준비를 시작하면 안 돼요');
  result(workers[0], workers[0].messages[0]);
  assert.equal(runtime.hudCandidates[0].tracking, false, '캡처 생략 중 새 카메라 기회가 있었는데 과거 결과를 current로 보인다');
  assert.equal(runtime.canAcceptFrame(3), true, '완료 후 다음 최신 캡처는 즉시 허용한다');
  runtime.dispose();
});

test('pending hit, fallback, disabled와 시간 역행은 demand 수명 계약을 지켜요', () => {
  const { runtime, workers } = setup();
  runtime.pushFrame(field(), 10, { ownedInput: true });
  const request = workers[0].messages[0];
  workers[0].emit({ type: 'result', generation: request.generation, requestId: request.requestId,
    frameId: 10, timestamp: 10, serviceMs: 1, snapshot: { stats: {}, view: {}, hudCandidates: [] }, hit: { text: 'done' } });
  assert.equal(runtime.canAcceptFrame(11), true, 'pending hit을 꺼낼 입력은 막히면 안 된다');
  assert.deepEqual(runtime.pushFrame(field(), 11, { ownedInput: true }), { text: 'done' });
  assert.equal(runtime.canAcceptFrame(9), true, 'timestamp 역행은 새 세대로 안전하게 시작한다');
  runtime.setEnabled(false); assert.equal(runtime.canAcceptFrame(12), false);
  runtime.dispose();

  const fallback = createR2WorkerRuntime({ enabled: true, createWorker() { throw Error('blocked'); },
    createFallback: () => ({ pushFrame() { return null; }, reset() {}, setEnabled() {}, stats: {}, view: {}, hudCandidates: [] }) });
  fallback.pushFrame(field(), 1); assert.equal(fallback.canAcceptFrame(2), true, 'main fallback은 준비를 막지 않는다');
  fallback.dispose();
});

test('readiness가 true여도 유효하지 않은 push 입력은 worker로 우회하지 못해요', () => {
  const { runtime, workers } = setup();
  assert.equal(runtime.canAcceptFrame(1), true);
  assert.throws(() => runtime.pushFrame({ width: 8, height: 8, data: new Float32Array(63) }, 1), TypeError);
  assert.equal(workers.length, 0, '수요 게이트가 입력 검증을 대체하면 안 된다');
  runtime.dispose();
});

test('H 소유권은 독립 입력만 transfer하고 기본·alias 입력은 안전하게 사본을 쓴다', () => {
  const { runtime, workers } = setup();
  const y = field(), h = { width: 8, height: 8, data: new Float32Array(64) };
  runtime.pushFrame(y, 1, { ownedInput: true, hField: h, ownedHInput: true });
  assert.equal(y.data.byteLength, 0); assert.equal(h.data.byteLength, 0, '독립 H owned input은 실제 transfer에서 detach된다');
  runtime.dispose();

  const next = setup(), shared = field();
  next.runtime.pushFrame(shared, 1, { hField: shared, ownedHInput: true });
  assert.equal(shared.data.byteLength, 256, 'default Y와 shared H는 호출자 버퍼를 보존한다');
  assert.notEqual(next.workers[0].messages[0].field.data.buffer, next.workers[0].messages[0].hField.data.buffer,
    'shared H/Y buffer를 두 번 transfer하지 않는다');
  next.runtime.dispose();
});

test('scanner는 R2 busy 수요 확인을 grab/Y/H 준비보다 먼저 하고 fresh H만 소유권을 넘겨요', () => {
  const source = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');
  const start = source.indexOf('if (r2Runtime.enabled) {', source.indexOf('복호가 1.4'));
  const block = source.slice(start, source.indexOf('if (!r2Runtime.enabled) {', start));
  const demand = block.indexOf('r2Runtime.canAcceptFrame(timestamp)');
  assert.ok(demand >= 0 && demand < block.indexOf('grabVideoFrame(r2FrameStartedAt)'), '수요 확인이 grab 앞에 없다');
  assert.ok(demand < block.indexOf('toRelativeLuminance({'), 'Y/H luma 앞에서 게이트해야 한다');
  assert.match(block, /hField,ownedHInput:true/, 'scanner의 막 만든 H luma만 owned로 넘긴다');
});
