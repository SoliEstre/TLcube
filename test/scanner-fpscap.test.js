/**
 * scanner-fpscap.test.js — 호출 주기와 프레임 수 소비자의 시간화 계약.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  adaptiveFrameIntervalMs,
  CLIP_HINT_MS,
  CLOSER_HINT_MS,
  elapsedSinceMs,
  ESCALATE_INTERVAL_MS,
  escalationDue,
  FRAME_MIN_INTERVAL_MS,
  scheduleNextEscalationAt,
} from '../src/scanner-frame-rate.js';

const SCANNER_JS = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');

function sliceOf(name, nextName) {
  const start = SCANNER_JS.indexOf('function ' + name);
  assert.ok(start >= 0, 'scanner.js 에 function ' + name + ' 이 없다');
  const end = SCANNER_JS.indexOf('function ' + nextName, start + 1);
  assert.ok(end > start, 'scanner.js 에 function ' + nextName + ' 이 없다');
  return SCANNER_JS.slice(start, end);
}

test('기존 320ms 환산 체감은 시간 상수로 보존된다', () => {
  assert.equal(CLOSER_HINT_MS, 24 * 320);
  assert.equal(CLIP_HINT_MS, 3 * 320);
  assert.equal(ESCALATE_INTERVAL_MS, 5 * 320);

  assert.equal(elapsedSinceMs(1000, 1000 + CLOSER_HINT_MS - 1), CLOSER_HINT_MS - 1);
  assert.equal(elapsedSinceMs(1000, 1000 + CLOSER_HINT_MS), CLOSER_HINT_MS);
  assert.equal(elapsedSinceMs(null, 999999), 0, '스트릭이 없는데 임의 시각으로 문턱을 넘는다');
});

test('적응형 간격 — 빠른 프레임은 10fps로 묶고 느린 프레임은 실측 비용만큼 물러난다', () => {
  assert.equal(FRAME_MIN_INTERVAL_MS, 100);
  assert.equal(adaptiveFrameIntervalMs(53), 100);
  assert.equal(adaptiveFrameIntervalMs(92), 100);
  assert.equal(adaptiveFrameIntervalMs(147), 147);
  assert.equal(adaptiveFrameIntervalMs(2170), 2170);
  assert.equal(adaptiveFrameIntervalMs(undefined), 100);
  assert.equal(adaptiveFrameIntervalMs(Number.NaN), 100);
});

test('승격은 프레임 수가 아니라 직전 승격에서 1600ms 뒤에 한 번만 도래한다', () => {
  const next = scheduleNextEscalationAt(5000);
  assert.equal(next, 6600);
  assert.equal(escalationDue(6599, next), false);
  assert.equal(escalationDue(6600, next), true);
  assert.equal(escalationDue(999999, null), false, '실패 스트릭이 없는데 승격한다');
  assert.equal(scheduleNextEscalationAt(6600), 8200);
});

test('scanner.js 배선 — 구 프레임 카운터 없이 시간과 직전 전체 비용을 소비한다', () => {
  assert.doesNotMatch(SCANNER_JS,
    /HINT_AFTER_FAILED_FRAMES|CLIP_HINT_AFTER_FRAMES|ESCALATE_EVERY|consecutiveFailedFrames|clippedFrames/);

  const grab = sliceOf('grabVideoFrame', 'normalizePayload');
  assert.match(grab, /escalationDue\(atMs, nextEscalationAt\)/);
  assert.match(grab, /scheduleNextEscalationAt\(atMs\)/);

  const result = sliceOf('handleDecodeResult', 'startFrameLoop');
  assert.match(result, /elapsedSinceMs\(failStreakSince, handledAt\)/);
  assert.match(result, /failedMs\s*>=\s*CLOSER_HINT_MS/);
  assert.match(result, /elapsedSinceMs\(clipStreakSince, handledAt\)\s*>=\s*CLIP_HINT_MS/);

  const loop = sliceOf('startFrameLoop', 'startCamera');
  assert.match(loop, /adaptiveFrameIntervalMs\(lastFrameCostMs\)/);
  assert.match(loop, /lastFrameCostMs\s*=\s*Math\.max\(0, nowMs\(\) - frameStartedAt\)/);
});
