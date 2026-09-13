/** 관측 소켓과 후보별 실제 누적을 잇는 선택적 공용 런타임이에요. 기본 등록은 하지 않아요. */
import { createBoundCandidateSession } from './bound-candidate-session.js';
import { R2_INDICATOR } from './session.js';
import { correctedCellsForHit } from './corrections.js';
import { unframe } from '../header.js';

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name}는 필수 양의 정수예요`);
  return value;
}

export function createObservedCandidateRuntime(options = {}) {
  const family = positiveInteger(options.family, 'family');
  const maxIdleFrames = positiveInteger(options.maxIdleFrames, 'maxIdleFrames');
  const adapters = options.adapters;
  if (typeof adapters?.detectInto !== 'function' || typeof adapters?.bindCandidate !== 'function') {
    throw new TypeError('관측 소켓이 필요해요');
  }
  let nodes = [], seen = new WeakSet(), frameOrdinal = 0, lastFrame = null;
  let nextHudId = 1, acceptedHud = null;
  let serviceDeadline = Infinity, serviceSequence = 0;
  let detectionDeferred = false, pendingAcquisitionStreak = 0;
  const preferPendingAcquisition = options.preferPendingAcquisition === true;
  const preferInitialService = options.preferInitialService === true;
  let initialServiceStreak = 0;
  const hudRows = [];
  const output = {};
  const stats = { frames: 0, detectCalls: 0, observations: 0, binds: 0, retired: 0,
    capacitySkips: 0, candidateCount: 0, progressD: 0, indicator: R2_INDICATOR.SEARCHING,
    leadingLayoutId: '', decodeAttempts: 0, decodeFailures: 0, done: 0,
    lastDetectMs: 0, lastAccumulateMs: 0, lastServiceMs: 0, maxServiceUnitMs: 0,
    deferredCandidates: 0, acquisitionLoans: 0, pendingAcquisitionLoans: 0, pendingAcquisitionYields: 0, initialServiceLoans: 0, initialServiceYields: 0, initialServicePromotions: 0, serviceOverrunMs: 0, lastError: null, candidates: [] };
  let leading = null;

  function createHud(node) {
    const { key, bound } = node.candidate;
    const profile = key.profile;
    const cProfile = profile === 'C';
    return {
      id: `${cProfile ? 'r2-c-' : `r2-${profile.toLowerCase()}-`}${nextHudId++}`,
      type: profile, geometryMode: cProfile ? 'c-hex' : 'planar-hex', revision: 0,
      n: key.dimension, k: key.dimension, dimensionKind: key.dimensionKind,
      layoutId: key.layoutId, formatWire: key.wire, ecc: key.ecc, maskIndex: key.maskIndex,
      sourceKind: node.token.sourceKind, finder: node.token.sourceKind,
      cellCount: bound.cellCount, cellCoord: Int32Array.from(bound.cellCoord),
      cellMap: new Uint8Array(bound.cellCount), faceLuma: new Uint16Array(bound.cellCount * 3),
      visibleCells: new Uint8Array(bound.cellCount), H: node.candidate.H,
      frameWidth: 0, frameHeight: 0, D: 0, indicator: R2_INDICATOR.LOCKED,
      tracking: false, retained: true, alive: true,
    };
  }
  function updateHud(node, result, field) {
    const hardDrops = node.runtime.session.counters.hardDrops;
    if (hardDrops > node.hudHardDrops) node.hudNeedsGeneration = true;
    node.hudHardDrops = hardDrops;
    if (node.hudNeedsGeneration && result.indicator !== R2_INDICATOR.DROPPED) {
      node.hud = createHud(node); node.hudNeedsGeneration = false;
    }
    const row = node.hud, buffers = node.runtime.session.buffers;
    row.cellMap.set(result.progress.cellMap);
    row.faceLuma.set(buffers.faceLuma); row.visibleCells.set(buffers.visibleCells);
    row.D = Number.isFinite(result.progress.D) ? result.progress.D : 0;
    row.indicator = result.indicator;
    row.tracking = buffers.alignmentOutput.gatePassed === 1
      && buffers.alignmentOutput.visibleCount > 0 && !node.candidate.invalidated;
    row.retained = !row.tracking;
    if (row.tracking) {
      row.H = node.candidate.H;
      row.frameWidth = field.width; row.frameHeight = field.height;
    }
    row.revision++;
  }
  function snapshotHud(row) {
    return Object.freeze({ ...row, H: row.H?.slice() ?? null,
      cellCoord: row.cellCoord.slice(), cellMap: row.cellMap.slice(),
      faceLuma: row.faceLuma.slice(), visibleCells: row.visibleCells.slice() });
  }
  function hudCandidates() {
    let count = 0;
    for (const node of nodes) if (node.hud?.alive) hudRows[count++] = snapshotHud(node.hud);
    // DONE가 세션을 retire해도 수용 프레임의 소유 사본은 렌더/150ms 유예에 남아요.
    if (acceptedHud) hudRows[count++] = snapshotHud(acceptedHud);
    hudRows.length = count;
    return hudRows.slice();
  }
  function deferFrame() {
    for (const node of nodes) {
      if (!node.hud.tracking) continue;
      node.hud.tracking = false; node.hud.retained = true; node.hud.revision++;
    }
  }

  function retire(node, reason) {
    if (node.hud && reason !== 'done-consumed') node.hud.alive = false;
    node.runtime.dispose(); node.reason = reason; stats.retired++;
  }
  function reset() {
    for (const node of nodes) retire(node, 'reset');
    nodes = []; seen = new WeakSet(); lastFrame = null; frameOrdinal = 0; leading = null;
    detectionDeferred = false; pendingAcquisitionStreak = 0; initialServiceStreak = 0;
    acceptedHud = null; hudRows.length = 0;
    adapters.reset?.();
    Object.assign(stats, { frames: 0, detectCalls: 0, observations: 0, binds: 0, retired: 0,
      capacitySkips: 0, candidateCount: 0, progressD: 0, indicator: R2_INDICATOR.SEARCHING,
      leadingLayoutId: '', decodeAttempts: 0, decodeFailures: 0, done: 0,
      lastDetectMs: 0, lastAccumulateMs: 0, lastServiceMs: 0, maxServiceUnitMs: 0,
      deferredCandidates: 0, acquisitionLoans: 0, pendingAcquisitionLoans: 0, pendingAcquisitionYields: 0, initialServiceLoans: 0, initialServiceYields: 0, initialServicePromotions: 0, serviceOverrunMs: 0, lastError: null, candidates: [] });
  }
  function syncLiveStats() {
    stats.candidateCount = nodes.length;
    stats.candidates = nodes.flatMap(node => node.statsRow ? [node.statsRow] : []);
    leading = null;
    for (const node of nodes) {
      if (!node.lastResult || (leading && node.lastD <= leading.D)) continue;
      leading = { node, D: node.lastD, result: node.lastResult };
    }
    stats.progressD = leading?.D ?? 0;
    stats.indicator = leading?.result.indicator ?? R2_INDICATOR.SEARCHING;
    stats.leadingLayoutId = leading?.node.candidate.key.layoutId ?? '';
  }
  function setCapacity(maxCandidates) {
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 0) {
      throw new TypeError('현재 후보 가용 수가 필요해요');
    }
    if (nodes.length <= maxCandidates) return;
    // 최신 후보부터 내린다. 검출·누적·frame/age 진행 없이 기존 세션만 폐기한다.
    while (nodes.length > maxCandidates) retire(nodes.pop(), 'combined-capacity');
    syncLiveStats();
  }
  function pushFrameImpl(field, timestamp, { frameId = timestamp, runDetect = false, maxCandidates, budgetMs } = {}) {
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 0) throw new TypeError('현재 후보 가용 수가 필요해요');
    if (!Number.isFinite(timestamp) || !(typeof frameId === 'string' || Number.isSafeInteger(frameId))) throw new TypeError('유효한 프레임 identity가 필요해요');
    setCapacity(maxCandidates);
    if (lastFrame && lastFrame.frameId === frameId && lastFrame.timestamp === timestamp) {
      // 같은 프레임을 두 번 누적하지 않되 버퍼 내용만 바꾼 호출은 관측기에게 검증시켜요.
      // 빈 출력 배열은 표본의 캐시/수명 검증만 수행하며 세션 증거에는 닿지 않아요.
      const empty = new Uint8Array(0);
      for (const node of nodes) {
        node.candidate.alignInto(field, field.width, field.height, timestamp, { frameId, alpha: field.alpha },
          node.candidate, {}, empty, empty);
      }
      const beforeCount = nodes.length;
      nodes = nodes.filter(node => {
        if (!node.candidate.invalidated) return true;
        retire(node, 'same-frame-invalidated'); return false;
      });
      if (nodes.length !== beforeCount) syncLiveStats();
      return null;
    }
    if (lastFrame && (timestamp < lastFrame.timestamp || field.width !== lastFrame.width || field.height !== lastFrame.height)) reset();
    acceptedHud = null;
    lastFrame = { frameId, timestamp, width: field.width, height: field.height };
    frameOrdinal++; stats.frames++; stats.lastError = null; stats.lastDetectMs = 0;
    const hadLiveNodes = nodes.length > 0;
    let detectionPerformed = false;
    function detectAndBind() {
      if (!runDetect || performance.now() >= serviceDeadline) return;
      const started = performance.now();
      // 끝난 획득을 재시작할 때는 살아 있는 누적이 없어야 해요.
      if (nodes.length === 0 && adapters.stats?.scanComplete && !adapters.managesAcquisitionLifetime) adapters.invalidateLock?.();
      output.found = 0; output.observation = null;
      stats.detectCalls++;
      detectionPerformed = true;
      try {
        // 기존 후보는 먼저 서비스한다. 검출에는 실제 남은 예산만 한 번 넘긴다.
        const remaining = Math.max(0, serviceDeadline - performance.now());
        const detectBudget = serviceDeadline === Infinity ? budgetMs
          : Math.min(budgetMs ?? Infinity, remaining);
        adapters.detectInto(field, field.width, field.height, timestamp, { frameId, budgetMs: detectBudget }, output);
        if (output.found && output.observation) {
          stats.observations++;
          if (!seen.has(output.observation) && output.format?.kind === 'read') {
            if (nodes.length === maxCandidates) stats.capacitySkips++;
            else {
              const candidate = adapters.bindCandidate(output.observation, output.format);
              if (candidate) {
                let runtime;
                try { runtime = createBoundCandidateSession(candidate, { family }); }
                catch (error) { candidate.dispose?.(); throw error; }
                seen.add(output.observation);
                const node = { candidate, runtime, idleFrames: 0, bestD: 0, lastD: 0, lastResult: null, statsRow: null,
                  lastAttempts: 0, lastFailures: 0,
                  hudHardDrops: 0, hudNeedsGeneration: false,
                  // 새 후보도 현재 대기열에 들어가 이미 기다리는 후보를 매번 앞지르지 않아요.
                  originFrame: frameOrdinal, servicedAt: serviceSequence, hasServiced: false, token: output.observation };
                node.hud = createHud(node);
                nodes.push(node);
                stats.binds++;
              }
            }
          }
        }
      } catch (error) { stats.lastError = `detect: ${error.message}`; }
      stats.lastDetectMs = performance.now() - started;
    }
    // 빈 풀은 초기 획득과 첫 누적을 같은 호출에서 유지한다.
    // 보통은 기성 후보를 먼저 서비스해요. 그 표본 단위가 예산보다 길어
    // 직전 탐색이 밀렸다면 이번에는 탐색부터 해 두 작업의 영구 기아를 막아요.
    // C가 선택한 검증대기만 두 차례 앞세우고, 다음 차례는 기성 후보에 돌려줘요.
    // 실제 후보 호출이 없으면 양보를 소비하지 않아요. 새 탐색/평면 기본값은 불변이에요.
    const pendingPhase = () => ['hypotheses', 'cq-refine'].includes(adapters.stats?.resumeCursor?.phase);
    const pendingAcquisition = preferPendingAcquisition && pendingPhase() && serviceDeadline !== Infinity;
    if (!pendingAcquisition || !hadLiveNodes || !runDetect || nodes.length >= maxCandidates) pendingAcquisitionStreak = 0;
    const yieldPendingAcquisition = pendingAcquisition && pendingAcquisitionStreak >= 2;
    const acquireFirst = hadLiveNodes && runDetect && nodes.length < maxCandidates && serviceDeadline !== Infinity
      && !yieldPendingAcquisition && (pendingAcquisition || detectionDeferred);
    if (acquireFirst) stats.acquisitionLoans++;
    if (!hadLiveNodes || acquireFirst) detectAndBind();
    if (acquireFirst && pendingAcquisition && detectionPerformed) {
      pendingAcquisitionStreak++; stats.pendingAcquisitionLoans++;
    }
    const started = performance.now(), survivors = [];
    let hit = null; leading = null;
    stats.candidates = [];
    const ordered = serviceDeadline === Infinity ? [...nodes] : [...nodes].sort((a, b) => a.servicedAt - b.servicedAt);
    while (ordered.length) {
      // 새 후보의 첫 시도는 최대 두 번 앞세워요. 그 다음 실제 호출은
      // 기존 후보의 FIFO에 돌려줘요. 기한 소진/무효 후보는 차례를 쓰지 않아요.
      let selected = 0;
      if (preferInitialService && serviceDeadline !== Infinity) {
        const preferred = ordered.findIndex(node => !node.candidate.invalidated && !node.runtime.disposed
          && (initialServiceStreak >= 2 ? node.hasServiced : !node.hasServiced));
        if (preferred >= 0) selected = preferred;
      }
      const node = ordered.splice(selected, 1)[0];
      if (node.candidate.invalidated || node.runtime.disposed) { retire(node, 'observation-invalidated'); continue; }
      if (performance.now() >= serviceDeadline) {
        if (node.hud.tracking) { node.hud.tracking = false; node.hud.retained = true; node.hud.revision++; }
        stats.deferredCandidates++; survivors.push(node); continue;
      }
      const unitAt = performance.now();
      node.servicedAt = ++serviceSequence;
      if (preferInitialService && serviceDeadline !== Infinity) {
        if (!node.hasServiced) {
          if (selected > 0) stats.initialServicePromotions++;
          initialServiceStreak = Math.min(2, initialServiceStreak + 1); stats.initialServiceLoans++;
        } else {
          if (initialServiceStreak >= 2) stats.initialServiceYields++;
          initialServiceStreak = 0;
        }
      }
      node.hasServiced = true;
      if (yieldPendingAcquisition && pendingAcquisitionStreak >= 2) {
        pendingAcquisitionStreak = 0; stats.pendingAcquisitionYields++;
      }
      let result;
      try { result = node.runtime.pushFrame(field, timestamp, { frameId, alpha: field.alpha }); }
      catch (error) { stats.lastError = `candidate: ${error.message}`; retire(node, 'candidate-error'); continue; }
      finally { stats.maxServiceUnitMs = Math.max(stats.maxServiceUnitMs, performance.now() - unitAt); }
      if (!result || node.candidate.invalidated) { retire(node, 'observation-invalidated'); continue; }
      const counters = node.runtime.session.counters;
      stats.decodeAttempts += Math.max(0, counters.decodeAttempts - node.lastAttempts);
      stats.decodeFailures += Math.max(0, counters.decodeFailures - node.lastFailures);
      node.lastAttempts = counters.decodeAttempts; node.lastFailures = counters.decodeFailures;
      const D = Number.isFinite(result.progress?.D) ? result.progress.D : 0;
      node.lastD = D; node.lastResult = result;
      updateHud(node, result, field);
      if (D > node.bestD) { node.bestD = D; node.idleFrames = 0; } else node.idleFrames++;
      if (!leading || D > leading.D) leading = { node, D, result };
      node.statsRow = { key: node.candidate.key, D, indicator: result.indicator,
        idleFrames: node.idleFrames, sourceKind: node.token.sourceKind };
      stats.candidates.push(node.statsRow);
      if (result.indicator === R2_INDICATOR.DONE) {
        let text;
        try { text = unframe(result.payload.subarray(0, result.payloadLength)).text; }
        catch {
          node.runtime.session.rejectPayload();
          updateHud(node, node.runtime.session.result, field);
          survivors.push(node); continue;
        }
        const holder = { scratch: new Uint16Array(0), count: 0, cells: new Uint16Array(0) };
        correctedCellsForHit(result, node.runtime.bound, holder);
        if (!hit) {
          acceptedHud = snapshotHud(node.hud);
          hit = { text, profile: node.candidate.key.profile, layoutId: node.candidate.key.layoutId,
            candidateId: node.hud.id, revision: node.hud.revision, hudSnapshot: snapshotHud(acceptedHud),
            n: node.candidate.key.dimension, dimensionKind: node.candidate.key.dimensionKind,
            frame: frameOrdinal - 1, formatWire: node.candidate.key.wire,
            correctedCount: holder.count, correctedCells: holder.cells.slice() };
        }
        stats.done++; retire(node, 'done-consumed');
      } else if (node.idleFrames >= maxIdleFrames) retire(node, 'no-progress');
      else survivors.push(node);
    }
    // 첫 서비스 순서가 새 후보부터 내리는 capacity 정책까지 바꾸지 않아요.
    // C opt-in만 원래 입장 순서를 보존하고 실제 서비스 순번은 별도로 유지해요.
    nodes = preferInitialService ? nodes.filter(node => survivors.includes(node)) : survivors;
    stats.lastAccumulateMs = performance.now() - started;
    if (hadLiveNodes && !hit && !detectionPerformed) detectAndBind();
    if (runDetect && nodes.length < maxCandidates) detectionDeferred = !detectionPerformed && !hit;
    stats.candidateCount = nodes.length;
    stats.progressD = leading?.D ?? 0;
    stats.indicator = hit ? R2_INDICATOR.DONE : leading?.result.indicator ?? R2_INDICATOR.SEARCHING;
    stats.leadingLayoutId = hit?.layoutId ?? leading?.node.candidate.key.layoutId ?? '';
    if (leading?.node.runtime.disposed) leading = null;
    if (!nodes.length || !pendingPhase()) pendingAcquisitionStreak = 0;
    if (!nodes.length) initialServiceStreak = 0;
    return hit;
  }
  function pushFrame(field, timestamp, control = {}) {
    const budget = control.serviceBudgetMs ?? Infinity;
    if (!(budget === Infinity || Number.isFinite(budget) && budget >= 0)) throw new TypeError('유효한 전체 서비스 예산이 필요해요');
    const started = performance.now();
    serviceDeadline = budget === Infinity ? Infinity : started + budget;
    try {
      if (budget === 0) { setCapacity(control.maxCandidates); deferFrame(); return null; }
      return pushFrameImpl(field, timestamp, control);
    } finally {
      stats.lastServiceMs = performance.now() - started;
      if (Number.isFinite(budget)) stats.serviceOverrunMs += Math.max(0, stats.lastServiceMs - budget);
      serviceDeadline = Infinity;
    }
  }
  return Object.freeze({ pushFrame, reset, setCapacity, deferFrame, stats, adapters,
    get leading() { return leading; }, get hudCandidates() { return hudCandidates(); } });
}
