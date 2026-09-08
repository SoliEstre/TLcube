/** C 관측 소켓과 후보별 실제 누적을 잇는 선택적 런타임이에요. 기본 등록은 하지 않아요. */
import { createCAdapters, FAMILY_C } from './adapter-c.js';
import { createBoundCandidateSession } from './bound-candidate-session.js';
import { R2_INDICATOR } from './session.js';
import { correctedCellsForHit } from './corrections.js';
import { unframe } from '../header.js';

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name}는 필수 양의 정수예요`);
  return value;
}

export function createCCandidateRuntime(options = {}) {
  const maxIdleFrames = positiveInteger(options.maxIdleFrames, 'maxIdleFrames');
  const adapters = options.adapters ?? createCAdapters(options.observation);
  if (typeof adapters?.detectInto !== 'function' || typeof adapters?.bindCandidate !== 'function') {
    throw new TypeError('C 관측 소켓이 필요해요');
  }
  let nodes = [], seen = new WeakSet(), frameOrdinal = 0, lastFrame = null;
  let nextHudId = 1, acceptedHud = null;
  const hudRows = [];
  const output = {};
  const stats = { frames: 0, detectCalls: 0, observations: 0, binds: 0, retired: 0,
    capacitySkips: 0, candidateCount: 0, progressD: 0, indicator: R2_INDICATOR.SEARCHING,
    leadingLayoutId: '', decodeAttempts: 0, decodeFailures: 0, done: 0,
    lastDetectMs: 0, lastAccumulateMs: 0, lastError: null, candidates: [] };
  let leading = null;

  function createHud(node) {
    const { key, bound } = node.candidate;
    return {
      id: `r2-c-${nextHudId++}`, type: 'C', geometryMode: 'c-hex', revision: 0,
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
    for (const node of nodes) if (node.hud?.alive) hudRows[count++] = node.hud;
    // DONE가 세션을 retire해도 수용 프레임의 소유 사본은 렌더/150ms 유예에 남아요.
    if (acceptedHud) hudRows[count++] = acceptedHud;
    hudRows.length = count;
    return hudRows;
  }

  function retire(node, reason) {
    if (node.hud && reason !== 'done-consumed') node.hud.alive = false;
    node.runtime.dispose(); node.reason = reason; stats.retired++;
  }
  function reset() {
    for (const node of nodes) retire(node, 'reset');
    nodes = []; seen = new WeakSet(); lastFrame = null; frameOrdinal = 0; leading = null;
    acceptedHud = null; hudRows.length = 0;
    adapters.reset?.();
    Object.assign(stats, { frames: 0, detectCalls: 0, observations: 0, binds: 0, retired: 0,
      capacitySkips: 0, candidateCount: 0, progressD: 0, indicator: R2_INDICATOR.SEARCHING,
      leadingLayoutId: '', decodeAttempts: 0, decodeFailures: 0, done: 0,
      lastDetectMs: 0, lastAccumulateMs: 0, lastError: null, candidates: [] });
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
      throw new TypeError('현재 C 후보 가용 수가 필요해요');
    }
    if (nodes.length <= maxCandidates) return;
    // 최신 후보부터 내린다. 검출·누적·frame/age 진행 없이 기존 세션만 폐기한다.
    while (nodes.length > maxCandidates) retire(nodes.pop(), 'combined-capacity');
    syncLiveStats();
  }
  function pushFrame(field, timestamp, { frameId = timestamp, runDetect = false, maxCandidates } = {}) {
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 0) throw new TypeError('현재 C 후보 가용 수가 필요해요');
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
    if (runDetect) {
      const started = performance.now();
      // 끝난 획득을 재시작할 때는 살아 있는 C 누적이 없어야 해요.
      if (nodes.length === 0 && adapters.stats?.scanComplete) adapters.invalidateLock?.();
      output.found = 0; output.observation = null;
      stats.detectCalls++;
      try {
        adapters.detectInto(field, field.width, field.height, timestamp, { frameId }, output);
        if (output.found && output.observation) {
          stats.observations++;
          if (!seen.has(output.observation) && output.format?.kind === 'read') {
            if (nodes.length === maxCandidates) stats.capacitySkips++;
            else {
              const candidate = adapters.bindCandidate(output.observation, output.format);
              if (candidate) {
                let runtime;
                try { runtime = createBoundCandidateSession(candidate, { family: FAMILY_C }); }
                catch (error) { candidate.dispose?.(); throw error; }
                seen.add(output.observation);
                const node = { candidate, runtime, idleFrames: 0, bestD: 0, lastD: 0, lastResult: null, statsRow: null,
                  lastAttempts: 0, lastFailures: 0,
                  hudHardDrops: 0, hudNeedsGeneration: false,
                  originFrame: frameOrdinal, token: output.observation };
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
    const started = performance.now(), survivors = [];
    let hit = null; leading = null;
    stats.candidates = [];
    for (const node of nodes) {
      if (node.candidate.invalidated || node.runtime.disposed) { retire(node, 'observation-invalidated'); continue; }
      let result;
      try { result = node.runtime.pushFrame(field, timestamp, { frameId, alpha: field.alpha }); }
      catch (error) { stats.lastError = `candidate: ${error.message}`; retire(node, 'candidate-error'); continue; }
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
          hit = { text, profile: 'C', layoutId: node.candidate.key.layoutId,
            candidateId: node.hud.id, revision: node.hud.revision, hudSnapshot: acceptedHud,
            n: node.candidate.key.dimension, dimensionKind: node.candidate.key.dimensionKind,
            frame: frameOrdinal - 1, formatWire: node.candidate.key.wire,
            correctedCount: holder.count, correctedCells: holder.cells.slice() };
        }
        stats.done++; retire(node, 'done-consumed');
      } else if (node.idleFrames >= maxIdleFrames) retire(node, 'no-progress');
      else survivors.push(node);
    }
    nodes = survivors;
    stats.lastAccumulateMs = performance.now() - started;
    stats.candidateCount = nodes.length;
    stats.progressD = leading?.D ?? 0;
    stats.indicator = hit ? R2_INDICATOR.DONE : leading?.result.indicator ?? R2_INDICATOR.SEARCHING;
    stats.leadingLayoutId = hit?.layoutId ?? leading?.node.candidate.key.layoutId ?? '';
    if (leading?.node.runtime.disposed) leading = null;
    return hit;
  }
  return Object.freeze({ pushFrame, reset, setCapacity, stats, adapters,
    get leading() { return leading; }, get hudCandidates() { return hudCandidates(); } });
}
