/** Y의 기존 실행을 먼저 보존한 뒤 C 관측/유지를 배치하는 명시적 조합기예요. */
import { createR2Router } from './router.js';
import { createCCandidateRuntime } from './c-candidate-runtime.js';

export function createR2TypeExpansionRuntime({ yRuntime, cRuntime, cubeYRuntime = null, maxCandidates,
  maxTrustedFrames, maxStalledFrames, cOptions, maxAdditionalMs = Infinity,
  now = () => performance.now() } = {}) {
  if (!yRuntime || typeof yRuntime.pushFrame !== 'function'
    || typeof yRuntime.setCandidateReservation !== 'function'
    || !Number.isSafeInteger(maxCandidates) || maxCandidates < 1) throw new TypeError('Y 런타임과 합산 후보 상한이 필요해요');
  const router = createR2Router({ maxTrustedFrames, maxStalledFrames });
  const cubeRouter = cubeYRuntime ? createR2Router({ maxTrustedFrames, maxStalledFrames }) : null;
  const c = cRuntime ?? createCCandidateRuntime(cOptions);
  if (typeof c.setCapacity !== 'function') throw new TypeError('C 후보 용량 조절 소켓이 필요해요');
  if (cubeYRuntime && (typeof cubeYRuntime.pushFrame !== 'function'
    || typeof cubeYRuntime.setCapacity !== 'function' || typeof cubeYRuntime.reset !== 'function')) {
    throw new TypeError('3D Y 실행/용량/리셋 소켓이 필요해요');
  }
  if (!(maxAdditionalMs > 0) || typeof now !== 'function') throw new TypeError('추가 서비스 예산/시계가 필요해요');
  let lastFrameId = null;
  let reservationMs = 0, nextService = 0;
  const hudRows = [];
  const stats = { frames: 0, cTries: 0, framesSinceCTry: 0, cObservedFrames: 0,
    cBudgetHits: 0, routerReason: null, yCandidateCount: 0, cCandidateCount: 0,
    totalCandidateCount: 0, maxActiveCandidates: 0, lastYMs: 0, lastCMs: 0,
    cubeYCandidateCount: 0, cubeYTries: 0, framesSinceCubeYTry: 0, cubeYRouterReason: null,
    lastCubeYMs: 0, lastAdditionalMs: 0, maxAdditionalUnitMs: 0,
    additionalBudgetHits: 0, additionalBudgetOverrunMs: 0, cDeferredFrames: 0, cubeYDeferredFrames: 0,
    lastReservationMs: 0, lastWinner: null };
  function cubeCount() { return cubeYRuntime?.stats.candidateCount ?? 0; }
  function noteCandidateCounts(yCount) {
    const cCount = c.stats.candidateCount, cube = cubeCount();
    if (!Number.isSafeInteger(yCount) || yCount < 0 || yCount > maxCandidates
      || !Number.isSafeInteger(cCount) || cCount < 0 || !Number.isSafeInteger(cube) || cube < 0
      || yCount + cCount + cube > maxCandidates) {
      throw new RangeError('활성 Y+C+3D Y 후보가 합산 상한을 넘었어요');
    }
    stats.yCandidateCount = yCount; stats.cCandidateCount = cCount;
    stats.cubeYCandidateCount = cube;
    stats.totalCandidateCount = yCount + cCount + cube;
    stats.maxActiveCandidates = Math.max(stats.maxActiveCandidates, stats.totalCandidateCount);
  }
  function reserveY(nextCount) {
    if (!Number.isSafeInteger(nextCount) || nextCount < 0 || nextCount > maxCandidates) {
      throw new RangeError('새 Y 후보가 합산 상한을 넘었어요');
    }
    const at = now();
    // 새 Y 후보가 만들어지기 전 C 최신 후보를 내려요. 검출/누적/나이는 진행하지 않아요.
    // 이 상한은 활성 실행 후보이며 기존 Y의 얼린 shelf 메모리와는 별개예요.
    const available = maxCandidates - nextCount;
    // 이미 존재하는 확장 후보가 많으면 큰 풀부터 줄여요. Y 자체 실행과 shelf는 보존해요.
    if (cubeYRuntime) {
      let cTarget = c.stats.candidateCount, cubeTarget = cubeCount();
      while (cTarget + cubeTarget > available) {
        if (cubeTarget > cTarget) cubeTarget--; else cTarget--;
      }
      cubeYRuntime.setCapacity(cubeTarget);
      c.setCapacity(cTarget);
    } else c.setCapacity(available);
    reservationMs += now() - at;
    noteCandidateCounts(nextCount);
  }
  function reset() {
    yRuntime.reset(); c.reset(); cubeYRuntime?.reset(); router.reset(); cubeRouter?.reset();
    lastFrameId = null; reservationMs = 0; nextService = 0; hudRows.length = 0;
    Object.assign(stats, { frames: 0, cTries: 0, framesSinceCTry: 0, cObservedFrames: 0,
      cBudgetHits: 0, routerReason: null, yCandidateCount: 0, cCandidateCount: 0,
      totalCandidateCount: 0, maxActiveCandidates: 0, lastYMs: 0, lastCMs: 0,
      cubeYCandidateCount: 0, cubeYTries: 0, framesSinceCubeYTry: 0, cubeYRouterReason: null,
      lastCubeYMs: 0, lastAdditionalMs: 0, maxAdditionalUnitMs: 0,
      additionalBudgetHits: 0, additionalBudgetOverrunMs: 0, cDeferredFrames: 0, cubeYDeferredFrames: 0,
      lastReservationMs: 0, lastWinner: null });
  }
  function pushFrame(field, timestamp) {
    if (!yRuntime.enabled || !field) return null;
    reservationMs = 0;
    // Y 실행 횟수와 같은 프레임의 DONE 우선순위를 바꾸지 않아요.
    const before = yRuntime.stats.frames, yAt = now();
    const yHit = yRuntime.pushFrame(field, timestamp);
    const elapsedYMs = now() - yAt;
    // intervalMs 때문에 Y가 받지 않은 프레임을 C만 세지 않아요.
    if (yRuntime.stats.frames === before) return yHit;
    const frameId = yRuntime.stats.frames;
    if (lastFrameId === frameId) return yHit;
    lastFrameId = frameId; stats.frames++;
    stats.lastYMs = elapsedYMs;
    // 이 진단은 마지막으로 받아들인 Y 프레임 기준이에요(interval skip은 새 프레임이 아니에요).
    stats.lastCMs = 0; stats.lastWinner = null; stats.routerReason = null;
    stats.lastCubeYMs = 0; stats.lastAdditionalMs = 0; stats.cubeYRouterReason = null;
    stats.lastReservationMs = reservationMs; // lastYMs 안에 포함된 C 폐기 비용, 합산 금지
    const yCount = yRuntime.stats.candidateCount ?? 0;
    noteCandidateCounts(yCount);
    if (yHit) { stats.lastWinner = 'Y'; stats.routerReason = 'y-done'; return yHit; }
    const routeInput = { frameId,
      yTrusted: yRuntime.stats.locked === 1 && yRuntime.stats.lockDistrusted === false && yRuntime.stats.format?.source === 'locator',
      progressD: yRuntime.stats.progressD, allowC: true };
    const decision = router.next(routeInput);
    const cubeDecision = cubeRouter?.next(routeInput);
    stats.routerReason = decision.reason;
    stats.cubeYRouterReason = cubeDecision?.reason ?? null;
    const services = cubeYRuntime ? (nextService === 0 ? ['C', 'Y3D'] : ['Y3D', 'C']) : ['C'];
    if (cubeYRuntime) nextService = 1 - nextService;
    const extraAt = now();
    let hit = null;
    for (const service of services) {
      const isC = service === 'C', runtime = isC ? c : cubeYRuntime;
      const serviceRouter = isC ? router : cubeRouter;
      const due = isC ? decision : cubeDecision;
      const elapsed = now() - extraAt;
      const deferred = hit !== null || elapsed >= maxAdditionalMs;
      if (deferred) {
        const committed = serviceRouter.commit({ frameId, ranC: false });
        if (isC) {
          stats.cTries = committed.cTries; stats.framesSinceCTry = committed.framesSinceCTry;
        } else {
          stats.cubeYTries = committed.cTries; stats.framesSinceCubeYTry = committed.framesSinceCTry;
        }
        if (!hit) {
          if (isC) stats.cDeferredFrames++; else stats.cubeYDeferredFrames++;
          runtime.deferFrame?.();
        }
        continue;
      }
      const otherCount = isC ? cubeCount() : c.stats.candidateCount;
      const at = now();
      const result = runtime.pushFrame(field, timestamp, { frameId, runDetect: due.runC,
        maxCandidates: maxCandidates - yCount - otherCount,
        budgetMs: Math.max(0, maxAdditionalMs - elapsed) });
      const elapsedMs = now() - at;
      if (isC) stats.lastCMs = elapsedMs; else stats.lastCubeYMs = elapsedMs;
      stats.maxAdditionalUnitMs = Math.max(stats.maxAdditionalUnitMs, elapsedMs);
      const committed = serviceRouter.commit({ frameId, ranC: due.runC });
      if (isC) {
        stats.cTries = committed.cTries; stats.framesSinceCTry = committed.framesSinceCTry;
      } else {
        stats.cubeYTries = committed.cTries; stats.framesSinceCubeYTry = committed.framesSinceCTry;
      }
      noteCandidateCounts(yCount);
      if (result) { hit = { ...result, frame: frameId - 1 }; stats.lastWinner = service; }
    }
    stats.lastAdditionalMs = now() - extraAt;
    if (stats.lastAdditionalMs > maxAdditionalMs) {
      stats.additionalBudgetHits++;
      stats.additionalBudgetOverrunMs += stats.lastAdditionalMs - maxAdditionalMs;
    }
    stats.cObservedFrames = c.stats.observations;
    stats.cBudgetHits = c.adapters?.stats?.budgetHits ?? 0;
    noteCandidateCounts(yCount);
    return hit;
  }
  function setEnabled(enabled) {
    if ((enabled === true) === yRuntime.enabled) return;
    yRuntime.setEnabled(enabled); c.reset(); cubeYRuntime?.reset(); router.reset(); cubeRouter?.reset();
    lastFrameId = null; nextService = 0; hudRows.length = 0;
    Object.assign(stats, { cTries: 0, framesSinceCTry: 0, cObservedFrames: 0,
      cBudgetHits: 0, routerReason: null, cCandidateCount: 0,
      totalCandidateCount: yRuntime.stats.candidateCount ?? 0, lastCMs: 0,
      cubeYCandidateCount: 0, cubeYTries: 0, framesSinceCubeYTry: 0, cubeYRouterReason: null,
      lastCubeYMs: 0, lastAdditionalMs: 0,
      lastReservationMs: 0, lastWinner: null });
  }
  function invalidateLock() {
    const result = yRuntime.invalidateLock(); c.reset(); cubeYRuntime?.reset(); router.reset(); cubeRouter?.reset();
    lastFrameId = null; nextService = 0; hudRows.length = 0;
    Object.assign(stats, { cTries: 0, framesSinceCTry: 0, cObservedFrames: 0,
      cBudgetHits: 0, routerReason: null, cCandidateCount: 0,
      totalCandidateCount: yRuntime.stats.candidateCount ?? 0, lastCMs: 0,
      cubeYCandidateCount: 0, cubeYTries: 0, framesSinceCubeYTry: 0, cubeYRouterReason: null,
      lastCubeYMs: 0, lastAdditionalMs: 0,
      lastReservationMs: 0, lastWinner: null });
    return result;
  }
  yRuntime.setCandidateReservation(reserveY);
  function hudCandidates() {
    let count = 0;
    for (const runtime of [yRuntime, c, cubeYRuntime]) {
      for (const row of runtime?.hudCandidates ?? []) hudRows[count++] = row;
    }
    hudRows.length = count;
    return hudRows;
  }
  return Object.freeze({ pushFrame, reset, setEnabled, invalidateLock,
    get enabled() { return yRuntime.enabled; },
    // C가 없을 때 기존 Y stats/view는 같은 객체 그대로 유지해요.
    stats: yRuntime.stats, view: yRuntime.view, expansionStats: stats, cStats: c.stats,
    cubeYStats: cubeYRuntime?.stats ?? null,
    get hudCandidates() { return hudCandidates(); },
    get cLeading() { return c.leading; } });
}
