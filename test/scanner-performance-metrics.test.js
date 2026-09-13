import test from 'node:test';
import assert from 'node:assert/strict';
import { createScannerPerformanceMetrics } from '../src/scanner-performance-metrics.js';

const stats = (processed, detect, frames) => ({ worker: { mode: 'worker', generation: 2, processed, dropped: 0, staleResults: 0, errors: 0, inFlight: 1, lastError: 'secret' }, h: { state: 'EMPTY', count: 0, required: 0, detectCalls: detect, lastDetectMs: 7, lastDetection: { components: 3, capReasons: ['pruned128', 'evil'] } }, frames, lastYMs: 4, hSkippedY: 2, view: { H: [1, 2] } });

test('window Hz와 timing p50/p95는 scalar만 반환해요', () => {
  const m = createScannerPerformanceMetrics();
  m.noteRaf(0); m.noteVideo(0, 10); m.notePrepare(100, 10, { ySide: 960, hSide: 1080 });
  m.noteResult(100, { serviceMs: 20, queueMs: 3, roundTripMs: 25, transportMs: 1 }, stats(10, 4, 8));
  m.notePrepare(200, 30); m.noteRaf(1000); m.noteVideo(1000, 40);
  m.noteResult(1100, { serviceMs: 40, queueMs: 5, roundTripMs: 48, transportMs: 2 }, stats(12, 5, 9));
  const out = m.snapshot(1100);
  assert.equal(out.hz.raf, 1); assert.equal(out.hz.video, 30); assert.equal(out.hz.processed, 1); assert.equal(out.hz.hDetect, 1); assert.equal(out.hz.yFrames, 1);
  assert.deepEqual(out.timings.serviceMs, { p50: 30, p95: 40, count: 2 });
  assert.equal(out.latest.worker.lastError, undefined); assert.equal(out.latest.worker.queueDepth, null); assert.equal(out.latest.view, undefined); assert.deepEqual(out.latest.capture, { ySide: 960, hSide: 1080 }); assert.deepEqual(out.latest.h.lastDetection.capReasons, ['pruned128']);
});
test('첫 counter는 baseline이고, counter 역행은 새 baseline이며 due skip은 0Hz예요', () => {
  const m = createScannerPerformanceMetrics();
  m.noteResult(0, {}, stats(10, 5, 9)); assert.equal(m.snapshot(0).hz.hDetect, null);
  m.noteResult(1000, {}, stats(10, 5, 9)); assert.equal(m.snapshot(1000).hz.hDetect, 0);
  m.noteResult(2000, {}, stats(1, 1, 1)); assert.equal(m.snapshot(2000).hz.hDetect, null);
});
test('reset, closed snapshot and invalid/rollback timestamps do not retain or grow old data', () => {
  const m = createScannerPerformanceMetrics({ windowMs: 100, maxSamples: 2 });
  m.noteRaf(10); m.noteRaf(20); m.noteRaf(20); m.noteRaf(15); assert.equal(m.snapshot(20).hz.raf, 100);
  m.snapshot(200); assert.equal(m.snapshot(200).hz.raf, null); m.reset(0); assert.equal(m.snapshot(0).latest, null);
  assert.throws(() => createScannerPerformanceMetrics({ maxSamples: 1 }), TypeError);
});
