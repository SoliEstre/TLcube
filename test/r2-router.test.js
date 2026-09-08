import test from 'node:test';
import assert from 'node:assert/strict';
import { createR2Router } from '../src/r2/router.js';

const frame = (frameId, overrides = {}) => ({
  yTrusted: true,
  progressD: frameId,
  allowC: true,
  frameId,
  ...overrides,
});

test('N/P는 caller가 넣는 유한 양의 정수이며 제품 기본값이 없다', () => {
  for (const options of [
    {},
    { maxTrustedFrames: Infinity, maxStalledFrames: 2 },
    { maxTrustedFrames: 2, maxStalledFrames: 0 },
    { maxTrustedFrames: 1.5, maxStalledFrames: 2 },
  ]) assert.throws(() => createR2Router(options), /유한 양의 정수/);
});

test('Y 불신은 첫 프레임에도 즉시 C를 예약하고 실제 commit만 계상한다', () => {
  const router = createR2Router({ maxTrustedFrames: 10, maxStalledFrames: 10 });
  const decision = router.next(frame(0, { yTrusted: false, progressD: 0 }));

  assert.deepEqual(decision, {
    runC: true,
    reason: 'y-untrusted',
    framesSinceCTry: 1,
    framesSinceProgress: 0,
    cTries: 0,
  });
  assert.deepEqual(router.commit({ frameId: 0, ranC: true }), {
    framesSinceCTry: 0,
    cTries: 1,
  });
  assert.equal(router.next(frame(0, { yTrusted: false })).reason, 'already-ran-this-frame');
});

test('신뢰 Y도 N번째 고유 프레임 경계 안에서 C를 예약한다', () => {
  const router = createR2Router({ maxTrustedFrames: 3, maxStalledFrames: 20 });

  assert.equal(router.next(frame(10)).runC, false);
  assert.equal(router.next(frame(11)).runC, false);
  const boundary = router.next(frame(12));
  assert.equal(boundary.runC, true);
  assert.equal(boundary.reason, 'trusted-cadence');
  assert.equal(boundary.framesSinceCTry, 3);
});

test('D가 P개 프레임 동안 진전하지 않으면 cadence보다 먼저 C를 예약한다', () => {
  const router = createR2Router({ maxTrustedFrames: 20, maxStalledFrames: 2 });

  assert.equal(router.next(frame(1, { progressD: 0.4 })).framesSinceProgress, 0);
  assert.equal(router.next(frame(2, { progressD: 0.4 })).framesSinceProgress, 1);
  const stalled = router.next(frame(3, { progressD: 0.3 }));
  assert.equal(stalled.framesSinceProgress, 2);
  assert.equal(stalled.runC, true);
  assert.equal(stalled.reason, 'y-stalled');
});

test('같은 frameId 중복 호출은 cadence와 stall 카운터를 올리지 않는다', () => {
  const router = createR2Router({ maxTrustedFrames: 3, maxStalledFrames: 2 });
  const first = router.next(frame('same', { progressD: 0.5, allowC: false }));
  const duplicate = router.next(frame('same', { progressD: 0.5, allowC: false }));

  assert.equal(first.framesSinceCTry, 1);
  assert.equal(duplicate.framesSinceCTry, 1);
  assert.equal(duplicate.framesSinceProgress, 0);
  assert.equal(duplicate.cTries, 0);
});

test('allowC=false는 실행을 계상하지 않고 기아 상태를 다음 프레임까지 유지한다', () => {
  const router = createR2Router({ maxTrustedFrames: 2, maxStalledFrames: 20 });
  router.next(frame(1));
  const blocked = router.next(frame(2, { allowC: false }));

  assert.equal(blocked.runC, false);
  assert.equal(blocked.reason, 'trusted-cadence-blocked');
  assert.equal(blocked.framesSinceCTry, 2);
  assert.equal(blocked.cTries, 0);
  assert.deepEqual(router.commit({ frameId: 2, ranC: false }), {
    framesSinceCTry: 2,
    cTries: 0,
  });

  const stillDue = router.next(frame(3, { allowC: true }));
  assert.equal(stillDue.runC, true);
  assert.equal(stillDue.framesSinceCTry, 3);
  assert.equal(stillDue.cTries, 0);
});

test('첫 progress NaN은 안전하게 기준을 보류하고 이후 무진전은 유한하게 센다', () => {
  const router = createR2Router({ maxTrustedFrames: 20, maxStalledFrames: 2 });

  const first = router.next(frame(100, { progressD: Number.NaN }));
  const second = router.next(frame(101, { progressD: Number.NaN }));
  const finite = router.next(frame(102, { progressD: 0.2 }));
  const missing = router.next(frame(103, { progressD: Number.NaN }));

  assert.equal(first.framesSinceProgress, 0);
  assert.equal(second.framesSinceProgress, 0);
  assert.equal(finite.framesSinceProgress, 0);
  assert.equal(missing.framesSinceProgress, 1);
  assert.ok([first, second, finite, missing].every((row) => Number.isFinite(row.framesSinceProgress)));
});

test('예약 없는 commit은 거부하고 reset은 모든 스케줄·계상 상태를 초기화한다', () => {
  const router = createR2Router({ maxTrustedFrames: 2, maxStalledFrames: 2 });
  assert.throws(() => router.commit({ frameId: 1, ranC: true }), /예약한 실제 C 실행/);

  router.next(frame(1, { yTrusted: false }));
  router.commit({ frameId: 1, ranC: true });
  router.next(frame(2, { progressD: 0 }));
  router.reset();

  const fresh = router.next(frame(1, { progressD: Number.NaN }));
  assert.deepEqual(fresh, {
    runC: false,
    reason: 'not-due',
    framesSinceCTry: 1,
    framesSinceProgress: 0,
    cTries: 0,
  });
});
