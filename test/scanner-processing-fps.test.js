import test from 'node:test';
import assert from 'node:assert/strict';

import { createProcessingFpsTracker } from '../src/scanner-processing-fps.js';

test('완료 표본 둘 전에는 warming이고, 두 완료부터 현재 창 FPS를 계산해요', () => {
  const tracker = createProcessingFpsTracker();
  assert.deepEqual(tracker.sample(0, 'r2:g1:s1'), {
    state: 'warming', fps: null, count: 0, lastCompletedAt: null, staleAfterMs: 2_000,
  });
  assert.equal(tracker.note(100, 'r2:g1:s1').state, 'warming');
  const live = tracker.note(600, 'r2:g1:s1');
  assert.equal(live.state, 'live');
  assert.equal(live.count, 2);
  assert.equal(live.fps, 2);
  assert.equal(live.lastCompletedAt, 600);
  assert.equal(live.staleAfterMs, 2_000);
});

test('같은 완료 시각은 중복 계산하지 않고, idle sample은 배열을 늘리지 않아요', () => {
  const tracker = createProcessingFpsTracker();
  tracker.note(100, 'r2');
  tracker.note(600, 'r2');
  assert.equal(tracker.note(600, 'r2').count, 2);
  assert.equal(tracker.sample(1_000, 'r2').count, 2);
  assert.equal(tracker.sample(1_500, 'r2').count, 2);
});

test('5초 창 밖 표본은 빼고, 마지막 완료 뒤 stale 기준을 넘으면 마지막 FPS만 유지해요', () => {
  const tracker = createProcessingFpsTracker({ windowMs: 5_000 });
  tracker.note(0, 'r2');
  const live = tracker.note(1_000, 'r2');
  assert.equal(live.fps, 1);
  const stale = tracker.sample(4_001, 'r2');
  assert.deepEqual(stale, {
    state: 'stale', fps: 1, count: 2, lastCompletedAt: 1_000, staleAfterMs: 3_000,
  });
  const expired = tracker.sample(7_000, 'r2');
  assert.equal(expired.state, 'stale');
  assert.equal(expired.fps, 1);
  assert.equal(expired.count, 0);
  assert.equal(expired.staleAfterMs, 3_000);
});

test('최근 완료 간격의 conventional median은 stale 기준을 세 배로 만들되 2초 아래로 내리지 않아요', () => {
  const tracker = createProcessingFpsTracker({ windowMs: 100_000 });
  tracker.note(0, 'r2');
  tracker.note(1_000, 'r2');
  tracker.note(4_000, 'r2');
  // intervals 1000, 3000의 conventional median은 2000이고 stale은 6000이에요.
  const live = tracker.sample(9_999, 'r2');
  assert.equal(live.state, 'live');
  assert.equal(live.staleAfterMs, 6_000);
  assert.equal(tracker.sample(10_001, 'r2').state, 'stale');
});

test('key 변경과 reset은 이전 generation/session의 FPS와 stale 상태를 완전히 버려요', () => {
  const tracker = createProcessingFpsTracker();
  tracker.note(0, 'worker:g1:s1');
  tracker.note(500, 'worker:g1:s1');
  assert.equal(tracker.sample(3_000, 'worker:g1:s1').state, 'stale');
  const changed = tracker.sample(3_001, 'worker:g2:s2');
  assert.deepEqual(changed, {
    state: 'warming', fps: null, count: 0, lastCompletedAt: null, staleAfterMs: 2_000,
  });
  tracker.note(3_100, 'worker:g2:s2');
  tracker.reset();
  assert.deepEqual(tracker.sample(3_200, 'worker:g2:s2'), {
    state: 'warming', fps: null, count: 0, lastCompletedAt: null, staleAfterMs: 2_000,
  });
});

test('invalid/rollback timestamp는 state나 key를 되감지 않아요', () => {
  const tracker = createProcessingFpsTracker();
  tracker.note(100, 'r2:g1');
  tracker.note(600, 'r2:g1');
  const before = tracker.sample(700, 'r2:g1');
  assert.equal(tracker.note(Number.NaN, 'other').fps, before.fps);
  assert.equal(tracker.sample(650, 'other').fps, before.fps);
  const after = tracker.sample(700, 'r2:g1');
  assert.equal(after.state, 'live');
  assert.equal(after.count, 2);
  assert.equal(after.fps, before.fps);
});

test('maxSamples는 최근 완료만 보관해 무한 증가를 막아요', () => {
  const tracker = createProcessingFpsTracker({ windowMs: 100_000, maxSamples: 3 });
  for (const now of [0, 100, 200, 300, 400]) tracker.note(now, 'r2');
  const sample = tracker.sample(400, 'r2');
  assert.equal(sample.count, 3);
  assert.equal(sample.fps, 10);
});

test('잘못된 구성은 처음부터 거부해 표본 수명 계약을 모호하게 만들지 않아요', () => {
  assert.throws(() => createProcessingFpsTracker({ windowMs: 0 }), TypeError);
  assert.throws(() => createProcessingFpsTracker({ maxSamples: 1 }), TypeError);
});
