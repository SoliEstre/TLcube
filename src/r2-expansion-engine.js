/** 공통 frame 수명·총 서비스 회계·후보 입장을 소유하는 R2 스캐너 엔진이에요. */
import { createR2ScanRuntime } from './r2-scan-runtime.js';
import { createCCandidateRuntime } from './r2/c-candidate-runtime.js';
import { createPlanarCandidateRuntime } from './r2/planar-candidate-runtime.js';
import { createCubeYCandidateRuntime } from './r2/cube-y-runtime.js';
import { createSharedCentralN7Pool } from './r2/shared-central-n7.js';
import { DEFAULT_CUBE_Y_CONTINUITY } from './r2/cube-y-identity.js';
import { R2_INDICATOR } from './r2/session.js';
import { normalizeAcquisitionPolicy } from './r2/acquisition-lifetime.js';
import { createHCompositeEngine } from './h-scan-runtime.js';

const clone = value => structuredClone(value);
function extraServiceOrder(lanes, nextLane, ordinal, pendingN7) {
  const roundRobin = lanes.map((_, index) => lanes[(nextLane + index) % lanes.length]);
  const central = lanes.find(lane => lane.id === 'C');
  const phase = central?.runtime.adapters?.stats.resumeCursor?.phase;
  const pendingCentral = phase === 'shared-n7' ? pendingN7
    : ['hypotheses', 'cq-refine', 'extra'].includes(phase);
  if (!pendingCentral || !central
    || lanes.some(lane => lane !== central && lane.runtime.stats.candidateCount > 0)) return roundRobin;
  // 공유 획득과 그 결과의 유한 관측 검증은 한 수명의 작업이에요. 아직 소비할
  // 다른 lane 후보가 없을 때 먼저 끝내되 다른 소스에도16입력 안에 기회를 줘요.
  // C 자신의 후보 서비스는 같은 runtime 안에서 탐색과 번갈아 기회를 받아요.
  const overdue = lanes.filter(lane => lane !== central && ordinal - lane.lastService >= 16)
    .sort((a, b) => a.lastService - b.lastService)[0];
  return [...new Set([...(overdue ? [overdue] : []), central, ...roundRobin])];
}
export const R2_ENGINE_SCHEDULING_INTERNALS = Object.freeze({ extraServiceOrder });
function ownedField(field) {
  if (!field || !Number.isSafeInteger(field.width) || !Number.isSafeInteger(field.height)
    || field.width < 1 || field.height < 1 || !(field.data instanceof Float32Array)
    || field.data.length !== field.width * field.height
    || field.alpha && (!(field.alpha instanceof Uint8Array) || field.alpha.length !== field.data.length)) {
    throw new TypeError('정규화된 입력 frame이 필요해요');
  }
  return { width: field.width, height: field.height, data: field.data.slice(), alpha: field.alpha?.slice() ?? null };
}

export function createR2ExpansionEngine(options = {}) {
  if (options.enableH === true) return createHCompositeEngine({
    yEngine: createR2ExpansionEngine({ ...options, enableH: false }), enabled: options.enabled === true,
  });
  // 정밀 탐색은11ms soft 목표, 실제 C 관측 이후의 검증/추적은24ms 목표예요.
  // 명시적 budgetMs는 두 단계 모두 고정하며 기하·포맷·RS 수용 조건은 같아요.
  const candidateScope = options.candidateScope ?? 'y';
  if (candidateScope !== 'y' && candidateScope !== 'all') {
    throw new TypeError("candidateScope는 'y' 또는 'all'이어야 해요");
  }
  const allTypes = candidateScope === 'all';
  const budgetMs = options.budgetMs ?? 11, observedBudgetMs = options.budgetMs ?? 24;
  const cubeWorkBudgetMs = options.budgetMs ?? 16;
  const maxCandidates = options.maxCandidates ?? 12;
  if (!(Number.isFinite(budgetMs) && budgetMs > 0) || !Number.isSafeInteger(maxCandidates) || maxCandidates < 6) {
    throw new TypeError('유한 양의 전체 예산과 Y 여섯 후보를 보존하는 좌석 수가 필요해요');
  }
  let enabled = options.enabled === true, generation = 1, ordinal = 0, current = null, latest = null;
  let nextLane = 0, accepted = null, lastYAdvanceOrdinal = -Infinity;
  let displayRows = [], displayLeading = null;
  const acquisitionPolicy = normalizeAcquisitionPolicy(options.acquisitionPolicy ?? 'work');
  // y 기본은 C/planar/sharedN7 pool을 만들지 않아요. all일 때만 기존 생성·공유 정책을 그대로 씁니다.
  const pool = allTypes ? createSharedCentralN7Pool({ acquisitionPolicy }) : null;
  const sharedFrame = () => current;
  const y = options.yRuntime ?? createR2ScanRuntime({ ...options.y, enabled });
  const observation = allTypes ? { sharedCentralN7: pool, sharedFrame, acquisitionPolicy } : null;
  const extraLanes = allTypes ? [
    { id: 'C', runtime: options.cRuntime ?? createCCandidateRuntime({ maxIdleFrames: 60,
      observation: { tracking: { minNcc: DEFAULT_CUBE_Y_CONTINUITY.minTrackedNcc }, maxHypotheses: 8,
        refineN7: true, refineCq: true, geometrySources: ['n7', 'cq', 'daehan'], ...observation } }) },
    { id: 'planar', runtime: options.planarRuntime ?? createPlanarCandidateRuntime({ maxIdleFrames: 60, observation }) },
  ] : [];
  const lanes = [
    ...extraLanes,
    { id: 'y-faces', runtime: options.cubeRuntime ?? createCubeYCandidateRuntime() },
  ].map(lane => ({ ...lane, lastService: 0, serviceMs: 0, calls: 0 }));
  const absentPoolStats = Object.freeze({
    retainedBytes: 0, copies: 0, copyBytes: 0, cursorCopyBytes: 0, steps: 0, joins: 0, jobs: 0,
    maxUnitMs: 0, copyMs: 0, serviceMs: 0, exactFrameRefreshes: 0,
    acquisition: Object.freeze({ policy: acquisitionPolicy }),
  });
  const stats = { frames: 0, totalMs: 0, lastTotalMs: 0, lastCopyMs: 0, lastYMs: 0, lastExtraMs: 0, lastBudgetMs: 0,
    deadlineMisses: 0, overrunMs: 0, maxTotalMs: 0, fairnessLoans: 0, maxServiceDelayFrames: 0,
    cubeYColdProbeServices: 0, cubeYPriorityServices: 0, cubeYMaxServiceGapFrames: 0,
    generation, candidateCount: 0, retainedYCount: 0, source: null, progressD: 0,
    indicator: R2_INDICATOR.SEARCHING, lastError: null, inputFrameId: null, acquisitionPolicy, candidateScope };
  const initialStats = { ...stats };
  function extraCount() { return lanes.reduce((sum, lane) => sum + lane.runtime.stats.candidateCount, 0); }
  const capacityFor = lane => Math.max(0,
    maxCandidates - y.stats.candidateCount - extraCount() + lane.runtime.stats.candidateCount);
  function reserveY(yCount) {
    let remaining = Math.max(0, maxCandidates - yCount);
    for (const lane of lanes) {
      const count = Math.min(remaining, lane.runtime.stats.candidateCount);
      if (count < lane.runtime.stats.candidateCount) lane.runtime.setCapacity(count);
      remaining -= count;
    }
  }
  y.setCandidateReservation?.(reserveY);
  function reset() {
    generation++; ordinal = 0; current = latest = accepted = null; nextLane = 0;
    displayRows = []; displayLeading = null; lastYAdvanceOrdinal = -Infinity;
    y.reset(); for (const lane of lanes) { lane.runtime.reset(); lane.lastService = 0; lane.serviceMs = lane.calls = 0; }
    pool?.reset(); Object.assign(stats, initialStats, { generation });
  }
  function setEnabled(flag) {
    const next = flag === true; if (next === enabled) return;
    enabled = next; reset(); y.setEnabled(next);
  }
  function invalidateLock() {
    generation++; current = latest = accepted = null; pool?.reset();
    displayLeading = null; lastYAdvanceOrdinal = -Infinity;
    for (const lane of lanes) { lane.runtime.reset(); lane.lastService = ordinal; }
    const cleared = y.invalidateLock();
    // Y의 보존된 증거/HUD는 retained로 즉시 남겨요. 새 좌표를 기다리는 다른 광학 job만 폐기해요.
    displayRows = y.hudCandidates.map(row => ({ ...row, geometryMode: 'y-grid' }));
    stats.generation = generation; stats.candidateCount = y.stats.candidateCount;
    stats.retainedYCount = Math.max(0, displayRows.length - y.stats.candidateCount);
    stats.progressD = y.stats.progressD; stats.indicator = y.stats.indicator;
    stats.source = y.stats.candidateCount > 0 ? 'Y' : null;
    return cleared;
  }
  function pushFrame(field, timestamp, { frameId = Number.isSafeInteger(timestamp) ? timestamp : String(timestamp), ownedInput = false } = {}) {
    if (!enabled) return null;
    if (!Number.isFinite(timestamp) || !(typeof frameId === 'string' || Number.isSafeInteger(frameId))) throw new TypeError('유효한 frame identity가 필요해요');
    if (current && (timestamp < current.timestamp || field.width !== current.width || field.height !== current.height)) reset();
    if (current && timestamp === current.timestamp && frameId === current.frameId) return null;
    const cLane = lanes.find(lane => lane.id === 'C');
    const cCursor = cLane?.runtime.adapters?.stats.resumeCursor;
    const hasCObservation = Boolean(cLane) && (cLane.runtime.stats.candidateCount > 0
      || cCursor?.phase === 'cq-refine'
      || cCursor?.phase === 'hypotheses' && cCursor.total > cCursor.index);
    const cube = lanes.find(lane => lane.id === 'y-faces');
    const cubePhase = cube.runtime.stats.acquisitionPhase;
    const hasCubeWork = cube.runtime.stats.candidateCount > 0 || typeof cubePhase === 'string' && cubePhase !== 'idle';
    const yStalledBeforeInput = !y.stats.locked || ordinal + 1 - lastYAdvanceOrdinal >= 4;
    // Y 전용에서 이미 진행 중인 큐브 작업에는16ms soft 목표를 줘요. 11ms에서는
    // 획득/재정렬 한 단위 뒤에 실제 누적 기회가 남지 않는 경우가 있었어요.
    // 진전 중인 기존 Y-grid·cold 시작·개발용 all·명시적 budget은 그대로예요.
    const frameBudgetMs = hasCObservation ? observedBudgetMs
      : !allTypes && hasCubeWork && yStalledBeforeInput ? cubeWorkBudgetMs : budgetMs;
    const at = performance.now(), deadline = at + frameBudgetMs, copyAt = performance.now();
    // ownedInput은 Worker가 transfer받아 독점 소유한 새 배열에만 써요.
    latest = ownedInput ? field : ownedField(field);
    stats.lastCopyMs = performance.now() - copyAt;
    current = Object.freeze({ frameId, timestamp, width: field.width, height: field.height, generation, ordinal: ++ordinal });
    stats.frames++; stats.inputFrameId = frameId; stats.lastError = null; stats.lastExtraMs = 0;
    stats.lastBudgetMs = frameBudgetMs;
    pool?.observeFrame(latest, current);
    let hit = null;
    try {
      const serviced = new Set();
      function service(lane, available, healthyY = false) {
        const cap = capacityFor(lane);
        // 진전 중인 Y의 짧은 첫 복호를 새 전면 획득으로 지연하지 않아요.
        // 이미 살아 있는 다른 타입은 유지하고, 긴 단일가족 편향은16입력 상한으로 끊어요.
        const canAcquire = !healthyY || ordinal - lane.lastService >= 16;
        if (available <= 0 || cap === 0 || !canAcquire && lane.runtime.stats.candidateCount === 0) {
          lane.runtime.deferFrame(); return null;
        }
        const laneAt = performance.now();
        const result = lane.runtime.pushFrame(latest, timestamp, { frameId,
          maxCandidates: cap, runDetect: canAcquire && lane.runtime.stats.candidateCount < cap,
          budgetMs: available, serviceBudgetMs: available, ownedFrame: true });
        const elapsed = performance.now() - laneAt;
        if (lane.id === 'y-faces') stats.cubeYMaxServiceGapFrames = Math.max(
          stats.cubeYMaxServiceGapFrames, ordinal - lane.lastService);
        lane.serviceMs += elapsed; lane.calls++; lane.lastService = ordinal; stats.lastExtraMs += elapsed;
        serviced.add(lane);
        return result;
      }
      // Y 미획득이 이어질 때는 가장 오래 기다린 광학 lane을 먼저 서비스해요.
      // Y 입력 자체는 생략하지 않으며 두 답이 같은 frame에서 나오면 기존 Y가 우선이에요.
      let preHit = null;
      if (!allTypes) {
        const cube = lanes[0];
        const phase = cube.runtime.stats.acquisitionPhase;
        const active = cube.runtime.stats.candidateCount > 0 || typeof phase === 'string' && phase !== 'idle';
        // Y-grid가 미획득/정체일 때 진행 중인 큐브는 매 입력을 먼저 받아요.
        // 건강한 Y가 진전하면 기존 복호를 먼저 마치고 큐브는 남는 시간에 일해요.
        // 정체 중 cold 탐색도 네 입력 안에 시작하며 Y 입력/광학 gate는 유지해요.
        if (yStalledBeforeInput && (active || ordinal - cube.lastService >= 4)) {
          preHit = service(cube, Math.max(0, deadline - performance.now()));
          if (serviced.has(cube)) {
            if (active) stats.cubeYPriorityServices++;
            else stats.cubeYColdProbeServices++;
          }
        }
      }
      // 좌석이 가득 찼을 때 빈 lane은 실행할 수 없어요. 그 lane을 매번 고르면
      // 실제 후보를 소유한 lane조차 Y의 긴 검출 뒤에 갇혀 영원히 누적하지 못해요.
      const stalledY = !y.stats.locked || ordinal - lastYAdvanceOrdinal >= 4;
      const eligible = lanes.filter(lane => capacityFor(lane) > 0);
      const oldest = rows => rows.sort((a, b) => a.lastService - b.lastService)[0];
      const overdue = oldest(eligible.filter(lane => ordinal - lane.lastService >= 16))
        ?? oldest(eligible.filter(lane => !y.stats.locked || lane.runtime.stats.candidateCount > 0
        || (lane.id === 'C' && hasCObservation)));
      if (allTypes && stalledY && overdue && ordinal - overdue.lastService >= (y.stats.locked ? 1 : 4)) {
        // 보통 기존 live 후보를 서비스하되16입력 이상 대기한 빈 lane도 기회를 받아요. lane 내부의
        // 유한 탐색/관측 교대는 유지해 기존 후보가 후속 후보를 영구 막지 않아요.
        stats.fairnessLoans++; preHit = service(overdue, Math.max(0, deadline - performance.now()));
      }
      const yAt = performance.now();
      const previousD = y.stats.progressD;
      hit = y.pushFrame(latest, timestamp) ?? preHit;
      stats.lastYMs = performance.now() - yAt;
      if (y.stats.progressD > previousD) lastYAdvanceOrdinal = ordinal;
      const healthyY = y.stats.locked && y.stats.candidateCount > 0 && ordinal - lastYAdvanceOrdinal < 4;
      // Y는 기존과 같은 모든 입력을 받는다. 선반은 기존 의미를 보존하는 별도 유한 보관함이에요.
      const yCount = y.stats.candidateCount;
      reserveY(yCount);
      if (!hit) for (const lane of extraServiceOrder(lanes, nextLane, ordinal, pool?.acquisitionPending)) {
        if (serviced.has(lane)) continue;
        const delay = ordinal - lane.lastService;
        stats.maxServiceDelayFrames = Math.max(stats.maxServiceDelayFrames, delay);
        const available = Math.max(0, deadline - performance.now());
        const result = service(lane, available, healthyY);
        if (result) { hit = result; break; }
      }
      nextLane = (nextLane + 1) % lanes.length;
      if (hit) { accepted = clone({ ...hit, profile: hit.profile ?? 'Y' }); stats.source = accepted.profile; }
      else {
        let D = y.stats.progressD ?? 0, indicator = y.stats.indicator, source = 'Y';
        for (const lane of lanes) if (lane.runtime.stats.progressD > D) {
          D = lane.runtime.stats.progressD; indicator = lane.runtime.stats.indicator; source = lane.id;
        }
        stats.progressD = D; stats.indicator = indicator; stats.source = source;
      }
      if (hit) { stats.progressD = 1; stats.indicator = R2_INDICATOR.DONE; }
      stats.candidateCount = y.stats.candidateCount + extraCount();
      stats.retainedYCount = Math.max(0, y.hudCandidates.length - y.stats.candidateCount);
      displayRows = [...y.hudCandidates.map(row => ({ ...row, geometryMode: 'y-grid' })),
        ...lanes.flatMap(lane => lane.runtime.hudCandidates)];
      displayLeading = hit ? displayRows.find(row => row.id === hit.candidateId) ?? hit.hudSnapshot ?? null : null;
      if (!displayLeading) for (const row of displayRows) {
        if (row.alive && (!displayLeading || row.D > displayLeading.D)) displayLeading = row;
      }
      return hit ? clone(accepted) : null;
    } catch (error) { stats.lastError = error.message; throw error; }
    finally {
      stats.lastTotalMs = performance.now() - at; stats.totalMs += stats.lastTotalMs;
      stats.maxTotalMs = Math.max(stats.maxTotalMs, stats.lastTotalMs);
      if (stats.lastTotalMs > frameBudgetMs) { stats.deadlineMisses++; stats.overrunMs += stats.lastTotalMs - frameBudgetMs; }
    }
  }
  function hudCandidates() {
    return clone(displayRows);
  }
  function view() {
    const row = displayLeading;
    if (!row || row.geometryMode === 'y-grid') return clone(y.view);
    return { profile: row.type, dimensionKind: row.dimensionKind ?? 'side-n',
      n: row.n, k: row.k, layoutId: row.layoutId, geometryMode: row.geometryMode,
      H: row.H?.slice() ?? null, faceHs: row.faceHs?.map(H => H.slice()) ?? null,
      cellMap: row.cellMap?.slice() ?? null, cellCount: row.cellCount ?? row.cellMap?.length ?? 0,
      frameWidth: row.frameWidth, frameHeight: row.frameHeight,
      formatWire: row.formatWire, lockRevision: row.revision, bindRevision: row.id,
      lockKey: `${row.id}:${row.revision}`, cellFaceCentres: null };
  }
  return Object.freeze({ pushFrame, reset, setEnabled, invalidateLock,
    get enabled() { return enabled; }, get stats() { return { ...clone(y.stats), ...stats,
      lockedN: displayLeading?.n ?? y.stats.lockedN,
      locked: displayLeading ? Number(displayLeading.tracking) : y.stats.locked,
      leadingLayoutId: displayLeading?.layoutId ?? y.stats.leadingLayoutId,
      candidates: displayRows.filter(row => row.alive).map(row => ({ layoutId: row.layoutId,
        profile: row.type, D: row.D, indicator: row.indicator, alive: true })),
      phaseMs: { ...y.stats.phaseMs, extra: stats.lastExtraMs, copy: stats.lastCopyMs },
      y: clone(y.stats), lanes: lanes.map(lane => ({ id: lane.id, calls: lane.calls,
        serviceMs: lane.serviceMs, stats: clone(lane.runtime.stats), observation: clone(lane.runtime.adapters?.stats ?? null) })),
      sharedCentralN7: pool ? pool.stats : absentPoolStats }; },
    get view() { return view(); }, get hudCandidates() { return hudCandidates(); },
    get accepted() { return clone(accepted); } });
}
