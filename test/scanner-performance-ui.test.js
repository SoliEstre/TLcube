import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const scannerSource = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');
const start = scannerSource.indexOf('const procFpsTracker = createProcessingFpsTracker();');
const end = scannerSource.indexOf('\nfunction showCameraGate', start);
assert.ok(start >= 0 && end > start, 'main scanner의 processing tracker slice를 찾지 못했어요');
const trackerSlice = scannerSource.slice(start, end);

test('준비 큐 depth 2는 명시 lab opt-in에서만 열고 정식·storage 실패는 depth 1이에요', () => {
  const expression = scannerSource.match(/workerQueueDepth:\s*(\(\(\) => \{[\s\S]*?\}\)\(\))/)?.[1];
  assert.ok(expression, '실제 scanner 큐 설정 함수를 찾지 못했어요');
  for (const lab of [false, true]) {
    for (const stored of [null, '1', '2', '3', 2, '']) {
      const context = { isLabPath: () => lab, window: { localStorage: { getItem(key) {
        assert.equal(key, 'tlscan.r2.pipelineDepth'); return stored;
      } } } };
      assert.equal(vm.runInNewContext(expression, context), lab && stored === '2' ? 2 : 1);
    }
  }
  assert.equal(vm.runInNewContext(expression, { isLabPath: () => true, window: {
    get localStorage() { throw new Error('storage unavailable'); }
  } }), 1);
});

function element({ open = false } = {}) {
  const listeners = new Map();
  return {
    open, hidden: false, textContent: '', dataset: {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    toggle() { listeners.get('toggle')?.(); }
  };
}

function createProcessingFpsTracker() {
  let lastCompletedAt = null, activeKey = null;
  return {
    reset() { lastCompletedAt = null; activeKey = null; },
    note(now, key) { activeKey = key; lastCompletedAt = now; return this.sample(now, key); },
    sample(now, key) {
      if (key !== activeKey) { activeKey = key; lastCompletedAt = null; }
      if (lastCompletedAt !== null && now - lastCompletedAt > 2_000) return { state: 'stale', fps: 1 };
      return { state: 'warming', fps: null };
    }
  };
}

function install({ now = 0, runtime = { enabled: true, processingKey: '1:worker', stats: { payload: 'never-render' } }, stream = {} } = {}) {
  const procFpsEl = element(), perfDetails = element(), perfOutput = element();
  const metricCalls = { reset: [], result: [], video: [] };
  let callback = null, requestId = 0, cancelled = [];
  const cameraVideo = {
    videoWidth: 1280, videoHeight: 720,
    requestVideoFrameCallback(next) { callback = next; return ++requestId; },
    cancelVideoFrameCallback(id) { cancelled.push(id); }
  };
  const perfMetrics = {
    reset(at) { metricCalls.reset.push(at); },
    noteResult(...args) { metricCalls.result.push(args); },
    noteVideo(...args) { metricCalls.video.push(args); },
    noteRaf() {}, notePrepare() {},
    snapshot() { return { resultCount: metricCalls.result.length, videoCount: metricCalls.video.length }; }
  };
  const context = {
    createProcessingFpsTracker, createScannerPerformanceMetrics: () => perfMetrics,
    procFpsEl, perfDetails, perfOutput, cameraVideo, cameraStream: stream, r2Runtime: runtime,
    scanSession: 1, lastFrameCostMs: 9, SCANNER_BUILD: 'test-build',
    nowMs: () => now,
    activeVideoTrack: () => ({ getSettings: () => ({ width: 1280, height: 720, frameRate: 30,
      deviceId: 'secret-device', groupId: 'secret-group', label: 'secret-label' }) }),
    console
  };
  vm.runInNewContext(`${trackerSlice}\nglobalThis.__perf = { syncProcessingKey, renderProcessingFps, noteFrameProcessed, startPerformanceVideoProbe, stopPerformanceVideoProbe, resetProcFps };`, context);
  return {
    context, procFpsEl, perfDetails, perfOutput, perfMetrics, metricCalls, cameraVideo,
    setNow(value) { now = value; }, callback: () => callback, cancelled: () => cancelled,
    api: context.__perf
  };
}

test('main tracker slice는 session/engine/generation 변경에서 window를 분리하고 stale을 표시해요', () => {
  const runtime = { enabled: true, processingKey: '1:worker', stats: {} };
  const harness = install({ runtime });
  assert.equal(harness.api.syncProcessingKey(0), '1:r2:1:worker');
  harness.api.noteFrameProcessed({ serviceMs: 1 });
  harness.setNow(2_001); harness.api.renderProcessingFps();
  assert.equal(harness.procFpsEl.dataset.state, 'stale');

  runtime.processingKey = '2:worker';
  assert.equal(harness.api.syncProcessingKey(2_002), '1:r2:2:worker');
  harness.api.renderProcessingFps();
  assert.equal(harness.procFpsEl.dataset.state, 'warming', 'generation 변경은 stale 표본을 새 창으로 넘기지 않는다');
  runtime.enabled = false;
  assert.equal(harness.api.syncProcessingKey(2_003), '1:r1');
  harness.context.scanSession = 2;
  assert.equal(harness.api.syncProcessingKey(2_004), '2:r1');
});

test('details가 닫혀 있으면 result metric을 만들지 않고, 열린 진단 출력은 track/payload 식별자를 숨겨요', () => {
  const runtime = { enabled: true, processingKey: '1:worker', stats: { payload: 'decode-secret', deviceId: 'runtime-device' } };
  const harness = install({ runtime });
  harness.api.noteFrameProcessed({ serviceMs: 3, queueMs: 1 });
  assert.equal(harness.metricCalls.result.length, 0, '닫힌 details에는 단계 metric을 축적하지 않는다');
  harness.perfDetails.open = true;
  harness.api.noteFrameProcessed({ serviceMs: 4, queueMs: 2 });
  assert.equal(harness.metricCalls.result.length, 1);
  harness.setNow(500);
  harness.api.renderProcessingFps();
  const text = harness.perfOutput.textContent;
  for (const secret of ['secret-device', 'secret-group', 'secret-label', 'decode-secret', 'runtime-device', 'deviceId', 'groupId', 'label', 'payload']) {
    assert.equal(text.includes(secret), false, `진단 출력에 ${secret}가 나오면 안 된다`);
  }
  assert.match(text, /"width": 1280/);
  assert.match(text, /"frameRate": 30/);
});

test('rVFC는 details close/stop 뒤 cancel하고 늦은 callback을 무시하며, 지원이 없어도 정상이에요', () => {
  const harness = install();
  harness.perfDetails.open = true;
  harness.api.startPerformanceVideoProbe();
  const late = harness.callback();
  assert.equal(typeof late, 'function');
  harness.perfDetails.open = false;
  harness.api.startPerformanceVideoProbe();
  assert.deepEqual(harness.cancelled(), [1]);
  late(999, { presentedFrames: 9 });
  assert.equal(harness.metricCalls.video.length, 0, '취소 후 늦은 rVFC callback은 기록하지 않는다');

  harness.perfDetails.open = true;
  harness.api.startPerformanceVideoProbe();
  const active = harness.callback();
  active(1_000, { presentedFrames: 10 });
  assert.deepEqual(harness.metricCalls.video, [[0, 10]], 'rVFC metadata clock 대신 scanner nowMs를 사용한다');
  harness.api.resetProcFps(false);
  assert.ok(harness.cancelled().length >= 2, 'stop 경로는 남은 rVFC를 취소한다');

  const unsupported = install();
  delete unsupported.cameraVideo.requestVideoFrameCallback;
  assert.doesNotThrow(() => unsupported.api.startPerformanceVideoProbe());
  unsupported.api.resetProcFps(false);
});
