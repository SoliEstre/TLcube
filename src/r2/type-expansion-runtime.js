/** Y의 기존 실행을 먼저 보존한 뒤 C 관측/유지를 배치하는 명시적 조합기예요. */
import { createR2Router } from './router.js';
import { createCCandidateRuntime } from './c-candidate-runtime.js';

export function createR2TypeExpansionRuntime({ yRuntime, cRuntime, maxCandidates,
  maxTrustedFrames, maxStalledFrames, cOptions } = {}) {
  if (!yRuntime || typeof yRuntime.pushFrame !== 'function'
    || typeof yRuntime.setCandidateReservation !== 'function'
    || !Number.isSafeInteger(maxCandidates) || maxCandidates < 1) throw new TypeError('Y 런타임과 합산 후보 상한이 필요해요');
  const router = createR2Router({ maxTrustedFrames, maxStalledFrames });
  const c = cRuntime ?? createCCandidateRuntime(cOptions);
  if (typeof c.setCapacity !== 'function') throw new TypeError('C 후보 용량 조절 소켓이 필요해요');
  let lastFrameId = null;
  let reservationMs = 0;
  const stats = { frames: 0, cTries: 0, framesSinceCTry: 0, cObservedFrames: 0,
    cBudgetHits: 0, routerReason: null, yCandidateCount: 0, cCandidateCount: 0,
    totalCandidateCount: 0, maxActiveCandidates: 0, lastYMs: 0, lastCMs: 0,
    lastReservationMs: 0, lastWinner: null };
  function noteCandidateCounts(yCount) {
    const cCount = c.stats.candidateCount;
    if (!Number.isSafeInteger(yCount) || yCount < 0 || yCount > maxCandidates
      || !Number.isSafeInteger(cCount) || cCount < 0 || yCount + cCount > maxCandidates) {
      throw new RangeError('활성 Y+C 후보가 합산 상한을 넘었어요');
    }
    stats.yCandidateCount = yCount; stats.cCandidateCount = cCount;
    stats.totalCandidateCount = yCount + cCount;
    stats.maxActiveCandidates = Math.max(stats.maxActiveCandidates, stats.totalCandidateCount);
  }
  function reserveY(nextCount) {
    if (!Number.isSafeInteger(nextCount) || nextCount < 0 || nextCount > maxCandidates) {
      throw new RangeError('새 Y 후보가 합산 상한을 넘었어요');
    }
    const at = performance.now();
    // 새 Y 후보가 만들어지기 전 C 최신 후보를 내려요. 검출/누적/나이는 진행하지 않아요.
    // 이 상한은 활성 실행 후보이며 기존 Y의 얼린 shelf 메모리와는 별개예요.
    c.setCapacity(maxCandidates - nextCount);
    reservationMs += performance.now() - at;
    noteCandidateCounts(nextCount);
  }
  function reset() {
    yRuntime.reset(); c.reset(); router.reset(); lastFrameId = null; reservationMs = 0;
    Object.assign(stats, { frames: 0, cTries: 0, framesSinceCTry: 0, cObservedFrames: 0,
      cBudgetHits: 0, routerReason: null, yCandidateCount: 0, cCandidateCount: 0,
      totalCandidateCount: 0, maxActiveCandidates: 0, lastYMs: 0, lastCMs: 0,
      lastReservationMs: 0, lastWinner: null });
  }
  function pushFrame(field, timestamp) {
    if (!yRuntime.enabled || !field) return null;
    reservationMs = 0;
    // Y 실행 횟수와 같은 프레임의 DONE 우선순위를 바꾸지 않아요.
    const before = yRuntime.stats.frames, yAt = performance.now();
    const yHit = yRuntime.pushFrame(field, timestamp);
    const elapsedYMs = performance.now() - yAt;
    // intervalMs 때문에 Y가 받지 않은 프레임을 C만 세지 않아요.
    if (yRuntime.stats.frames === before) return yHit;
    const frameId = yRuntime.stats.frames;
    if (lastFrameId === frameId) return yHit;
    lastFrameId = frameId; stats.frames++;
    stats.lastYMs = elapsedYMs;
    // 이 진단은 마지막으로 받아들인 Y 프레임 기준이에요(interval skip은 새 프레임이 아니에요).
    stats.lastCMs = 0; stats.lastWinner = null; stats.routerReason = null;
    stats.lastReservationMs = reservationMs; // lastYMs 안에 포함된 C 폐기 비용, 합산 금지
    const yCount = yRuntime.stats.candidateCount ?? 0;
    noteCandidateCounts(yCount);
    if (yHit) { stats.lastWinner = 'Y'; stats.routerReason = 'y-done'; return yHit; }
    const decision = router.next({ frameId,
      yTrusted: yRuntime.stats.locked === 1 && yRuntime.stats.lockDistrusted === false && yRuntime.stats.format?.source === 'locator',
      progressD: yRuntime.stats.progressD, allowC: true });
    stats.routerReason = decision.reason;
    const at = performance.now();
    const hit = c.pushFrame(field, timestamp, { frameId, runDetect: decision.runC, maxCandidates: maxCandidates - yCount });
    stats.lastCMs = performance.now() - at;
    const committed = router.commit({ frameId, ranC: decision.runC });
    stats.cTries = committed.cTries; stats.framesSinceCTry = committed.framesSinceCTry;
    stats.cObservedFrames = c.stats.observations;
    stats.cBudgetHits = c.adapters?.stats?.budgetHits ?? 0;
    noteCandidateCounts(yCount);
    if (hit) { stats.lastWinner = 'C'; return { ...hit, frame: frameId - 1 }; }
    return null;
  }
  function setEnabled(enabled) {
    if ((enabled === true) === yRuntime.enabled) return;
    yRuntime.setEnabled(enabled); c.reset(); router.reset(); lastFrameId = null;
    Object.assign(stats, { cTries: 0, framesSinceCTry: 0, cObservedFrames: 0,
      cBudgetHits: 0, routerReason: null, cCandidateCount: 0,
      totalCandidateCount: yRuntime.stats.candidateCount ?? 0, lastCMs: 0,
      lastReservationMs: 0, lastWinner: null });
  }
  function invalidateLock() {
    const result = yRuntime.invalidateLock(); c.reset(); router.reset(); lastFrameId = null;
    Object.assign(stats, { cTries: 0, framesSinceCTry: 0, cObservedFrames: 0,
      cBudgetHits: 0, routerReason: null, cCandidateCount: 0,
      totalCandidateCount: yRuntime.stats.candidateCount ?? 0, lastCMs: 0,
      lastReservationMs: 0, lastWinner: null });
    return result;
  }
  yRuntime.setCandidateReservation(reserveY);
  return Object.freeze({ pushFrame, reset, setEnabled, invalidateLock,
    get enabled() { return yRuntime.enabled; },
    // C가 없을 때 기존 Y stats/view는 같은 객체 그대로 유지해요.
    stats: yRuntime.stats, view: yRuntime.view, expansionStats: stats, cStats: c.stats,
    get cLeading() { return c.leading; } });
}
