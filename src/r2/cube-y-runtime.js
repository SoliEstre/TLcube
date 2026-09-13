/** 3D Y 후보별 unit-face H, 관측 연속성, 실제 R2/RS를 묶는 선택적 런타임이에요. */
import { createCubeYAcquisition } from './cube-y-acquisition.js';
import { trackCubeYFaces } from './cube-y-motion.js';
import { snapshotCubeYObservation, compareCubeYObservations,
  DEFAULT_CUBE_Y_CONTINUITY } from './cube-y-identity.js';
import { measureFaceGridConfidence, sampleUnitFaceHsInto, readFormatFromLocator } from './adapter-cube-y.js';
import { LINEUP_NS, GRID_LOCK_GATE_F, GRID_LOCK_PEAK_F, A3_FAMILY_Y } from './adapter-locator.js';
import { DEFAULT_R2_PARAMS, Q15_ONE } from './params.js';
import { createR2Session, R2_INDICATOR, R2_SESSION_STATUS } from './session.js';
import { createRsDecodeInto } from './decode-rs.js';
import { correctedCellsForHit } from './corrections.js';
import { unframe } from '../header.js';

function cloneField(field) {
  if (!field || !Number.isInteger(field.width) || !Number.isInteger(field.height)
    || !(field.data instanceof Float32Array || field.data instanceof Uint8Array || field.data instanceof Uint16Array)
    || field.data.length < field.width * field.height) throw new TypeError('유효한 luma field가 필요해요');
  return { width: field.width, height: field.height, data: new field.data.constructor(field.data) };
}
function ownHs(faceHs) { return faceHs.map((H) => Float64Array.from(H)); }
function formatKey(format) {
  return `${format.tones}|${format.versionIndex}|${format.eccName}|${format.maskIndex}|${format.formatWireVersion}`;
}
function cellHs(faceHs, n) {
  return faceHs.map((unit) => {
    const H = Float64Array.from(unit);
    for (const i of [0, 1, 3, 4, 6, 7]) H[i] /= n;
    return H;
  });
}
function copyScore(score) {
  return score ? { ...score } : null;
}
function copyPerFace(rows) {
  return Array.isArray(rows) ? rows.map((row) => ({
    face: row.face, pointCount: row.pointCount, gain: row.gain, bias: row.bias,
    iterations: row.iterations, ms: row.ms, before: copyScore(row.before), after: copyScore(row.after),
    fallbackUsed: row.fallbackUsed === true, fallbackStages: row.fallbackStages ?? 0,
    seedKind: row.seedKind ?? null,
  })) : null;
}
function copyFaceMotions(motions) {
  return Array.isArray(motions) ? motions.map((H) => Float64Array.from(H)) : null;
}
function copyTracking(tracking) {
  return tracking ? { ok: tracking.ok, reason: tracking.reason, pointCount: tracking.pointCount,
    before: copyScore(tracking.before), after: copyScore(tracking.after),
    gain: tracking.gain ?? null, bias: tracking.bias ?? null, iterations: tracking.iterations ?? null,
    ms: tracking.ms ?? null, pyramidBuildMs: tracking.pyramidBuildMs ?? 0,
    globalSeedMs: tracking.globalSeedMs ?? 0, globalSeedUsed: tracking.globalSeedUsed === true,
    motion: tracking.motion ? Float64Array.from(tracking.motion) : null,
    faceMotions: copyFaceMotions(tracking.faceMotions), perFace: copyPerFace(tracking.perFace) } : null;
}
function ownTracking(tracking) {
  if (!tracking) return null;
  if (!tracking.ok) {
    return { ok: false, reason: tracking.reason,
      detail: tracking.detail == null || typeof tracking.detail !== 'object'
        ? tracking.detail ?? null : structuredClone(tracking.detail),
      pointCount: tracking.pointCount, faceHs: null, motion: null, faceMotions: null, perFace: null };
  }
  return { ok: true, reason: null, pointCount: tracking.pointCount, faceHs: ownHs(tracking.faceHs),
    motion: tracking.motion ? Float64Array.from(tracking.motion) : null,
    faceMotions: copyFaceMotions(tracking.faceMotions), perFace: copyPerFace(tracking.perFace),
    before: copyScore(tracking.before), after: copyScore(tracking.after),
    gain: tracking.gain, bias: tracking.bias, iterations: tracking.iterations, ms: tracking.ms,
    pyramidBuildMs: tracking.pyramidBuildMs ?? 0, globalSeedMs: tracking.globalSeedMs ?? 0,
    globalSeedUsed: tracking.globalSeedUsed === true };
}
function exactHsMatch(left, right) {
  if (!left || !right || left.length !== 3 || right.length !== 3) return false;
  for (let face = 0; face < 3; face++) {
    const a = left[face], b = right[face];
    if (!a || !b || a.length !== 9 || b.length !== 9) return false;
    for (let i = 0; i < 9; i++) if (a[i] !== b[i]) return false;
  }
  return true;
}
function ownGrid(confidence) {
  return {
    measures: confidence.measures.map((row) => ({ n: row.n, F: row.F })),
    margin: confidence.diagnostics.margin,
  };
}

export function createCubeYCandidateRuntime(options = {}) {
  const continuity = { ...DEFAULT_CUBE_Y_CONTINUITY, ...(options.continuity ?? {}) };
  const maxIdleFrames = Number.isSafeInteger(options.maxIdleFrames) && options.maxIdleFrames > 0
    ? options.maxIdleFrames : 60;
  let nodes = [], capacity = 0, generation = 0, acquisitionEpoch = 0, nextId = 1, frameOrdinal = 0;
  let lastFrame = null, accepted = null;
  let serviceDeadline = Infinity, serviceSequence = 0;
  let shareTracks = [], shareGrids = [];
  const acquisition = createCubeYAcquisition();
  const emptyRuntimeStats = {
    frames: 0, detectCalls: 0, observations: 0, binds: 0, retired: 0,
    capacitySkips: 0, candidateCount: 0, progressD: 0, indicator: R2_INDICATOR.SEARCHING,
    decodeAttempts: 0, decodeFailures: 0, done: 0, deferredFrames: 0, sessionPushes: 0,
    lastDetectMs: 0, maxDetectMs: 0, detectBudgetOverrunMs: 0,
    lastTrackingMs: 0, maxTrackingMs: 0, lastSessionMs: 0, maxSessionMs: 0,
    lastRsMs: 0, maxRsMs: 0,
    acquisitionRebases: 0, acquisitionRebaseRejects: 0,
    acquisitionPhase: 'idle', maxAcquisitionUnitMs: 0, maxAcquisitionUnitKind: null,
    sharedTrackHits: 0, sharedTrackMisses: 0, sharedConfidenceHits: 0, sharedConfidenceMisses: 0,
    lastServiceMs: 0, serviceOverrunMs: 0, maxServiceUnitMs: 0, deferredCandidates: 0,
    lastError: null,
  };
  const stats = { ...emptyRuntimeStats };
  let hudCandidates = [];
  function clearShare() { shareTracks = []; shareGrids = []; }
  function frameTok(frameId, timestamp) { return `${generation}|${frameId}|${timestamp}`; }

  function retire(node, reason) {
    if (!node.alive) return;
    node.alive = false; node.retained = false; node.retireReason = reason;
    node.session.reset(); stats.retired++;
  }
  function clearNodes(reason) {
    for (const node of nodes) retire(node, reason);
    nodes = [];
  }
  function reset() {
    clearNodes('reset');
    generation++; frameOrdinal = 0; lastFrame = null; accepted = null; hudCandidates = []; acquisition.reset();
    clearShare();
    Object.assign(stats, emptyRuntimeStats);
  }
  function setCapacity(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('현재 3D Y 후보 가용 수가 필요해요');
    capacity = value;
    if (capacity === 0) acquisition.reset();
    while (nodes.length > capacity) retire(nodes.pop(), 'combined-capacity');
    stats.candidateCount = nodes.length;
    refreshHud();
  }
  function sharedTrack(previous, current, faceHs, previousTok, currentTok) {
    const hit = shareTracks.find((row) => row.previousTok === previousTok && row.currentTok === currentTok
      && exactHsMatch(row.faceHs, faceHs));
    if (hit) { stats.sharedTrackHits++; return ownTracking(hit.tracking); }
    stats.sharedTrackMisses++;
    const tracking = trackCubeYFaces(previous, current, faceHs,
      { ...options.motion, minTrackedNcc: continuity.minTrackedNcc });
    shareTracks.push({ previousTok, currentTok, faceHs: ownHs(faceHs), tracking: ownTracking(tracking) });
    return tracking;
  }
  function sharedGrid(field, faceHs, fieldTok) {
    const hit = shareGrids.find((row) => row.fieldTok === fieldTok && exactHsMatch(row.faceHs, faceHs));
    if (hit) {
      stats.sharedConfidenceHits++;
      return { measures: hit.grid.measures.map((row) => ({ ...row })), margin: hit.grid.margin };
    }
    stats.sharedConfidenceMisses++;
    const grid = ownGrid(measureFaceGridConfidence(field, faceHs, LINEUP_NS));
    shareGrids.push({ fieldTok, faceHs: ownHs(faceHs), grid: { measures: grid.measures.map((row) => ({ ...row })),
      margin: grid.margin } });
    return grid;
  }
  function measure(node, field, faceHs, fieldTok = null) {
    const faceLuma = new Uint8Array(node.scan.length * 3);
    const visibleCells = new Uint8Array(node.scan.length);
    const visibleCount = sampleUnitFaceHsInto(field, faceHs, node.n, node.scan, faceLuma, visibleCells);
    const grid = fieldTok ? sharedGrid(field, faceHs, fieldTok)
      : ownGrid(measureFaceGridConfidence(field, faceHs, LINEUP_NS));
    const F = grid.measures.find((row) => row.n === node.n)?.F ?? 0;
    const margin = grid.margin;
    const perCellHs = cellHs(faceHs, node.n);
    const read = readFormatFromLocator(field,
      { H: perCellHs[0], faceHs: perCellHs, n: node.n, layoutId: node.layoutId });
    const formatValid = Boolean(read.ok)
      && read.candidates.some((format) => formatKey(format) === (node.formatKey ?? formatKey(node.format)));
    return { faceLuma, visibleCells, visibleCount, F, margin, formatValid,
      observation: snapshotCubeYObservation(faceLuma, visibleCells, node.format.tones) };
  }
  function makeNode(candidate, frame, frameId, timestamp) {
    const node = { id: `y3d-${generation}-${nextId++}`, revision: 0, n: candidate.n,
      layoutId: candidate.layoutId, format: { ...candidate.format }, formatKey: formatKey(candidate.format),
      bound: candidate.bound, scan: candidate.scan.map((point) => ({ ...point })), key: candidate.key,
      faceHs: ownHs(candidate.faceHs), previousField: frame, previousTok: frameTok(frameId, timestamp),
      previousObservation: null,
      current: null, servicedAt: 0, tracking: false, trackingDetail: candidate.acquisitionTracking ?? null,
      comparison: candidate.acquisitionComparison ?? null, idleFrames: 0, bestD: 0,
      alive: true, retained: true, retireReason: null, lastResult: null,
      lastAttempts: 0, lastFailures: 0, correctionHolder: { scratch: new Uint16Array(0), count: 0, cells: new Uint16Array(0) } };
    const first = { faceLuma: new Uint8Array(candidate.faceLuma), visibleCells: new Uint8Array(candidate.visibleCells),
      visibleCount: candidate.visibleCount, F: candidate.F, margin: candidate.margin, formatValid: true };
    first.observation = snapshotCubeYObservation(first.faceLuma, first.visibleCells, node.format.tones);
    node.previousObservation = first.observation;
    node.current = first;
    const decode = createRsDecodeInto({ codewordCapacity: Math.floor(node.bound.cellCount / 3) });
    node.session = createR2Session({ layout: node.bound,
      detectInto(_data, _width, _height, _timestamp, _pose, output) {
        output.found = node.alive && node.current ? 1 : 0;
        output.family = output.found ? A3_FAMILY_Y : 0;
        output.n = node.n; output.layoutId = node.layoutId;
        return R2_SESSION_STATUS.OK;
      },
      alignInto(_data, _width, _height, _timestamp, _pose, _detection, output, faceLuma, visibleCells) {
        const current = node.current;
        if (!node.alive || !current || faceLuma.length < current.faceLuma.length
          || visibleCells.length < current.visibleCells.length) return R2_SESSION_STATUS.ALIGNMENT_ERROR;
        faceLuma.set(current.faceLuma); visibleCells.set(current.visibleCells);
        const passed = current.F >= GRID_LOCK_GATE_F && current.margin >= DEFAULT_R2_PARAMS.lockMarginMin
          && current.formatValid && current.visibleCount > 0;
        output.visibleCount = current.visibleCount; output.gatePassed = passed ? 1 : 0;
        output.distrusted = passed ? 0 : 1;
        output.matchCount = passed ? (node.comparison?.matches ?? 0) : 0;
        output.mismatchCount = passed ? (node.comparison?.contradictions ?? 0) : 0;
        output.weightQ15 = passed ? (current.F >= GRID_LOCK_PEAK_F ? Q15_ONE
          : Math.min(Q15_ONE, Math.max(1, DEFAULT_R2_PARAMS.alignWeightFloorQ15,
            Math.round(Q15_ONE * current.F / GRID_LOCK_PEAK_F)))) : 0;
        return R2_SESSION_STATUS.OK;
      }, decodeInto: decode });
    return node;
  }
  function rebaseAcquiredCandidate(candidate, origin, frame, frameId, timestamp) {
    if (origin.frameId === frameId && origin.timestamp === timestamp) return candidate;
    stats.acquisitionRebases++;
    const previousTok = `origin|${origin.epoch}|${origin.frameId}|${origin.timestamp}`;
    const currentTok = `current|${frameTok(frameId, timestamp)}`;
    const tracking = sharedTrack(origin.field, frame, candidate.faceHs, previousTok, currentTok);
    if (!tracking.ok || !(tracking.after.ncc >= continuity.minTrackedNcc) || !(tracking.gain > 0)) {
      stats.acquisitionRebaseRejects++; return null;
    }
    const current = measure(candidate, frame, tracking.faceHs, currentTok);
    if (!(current.F >= GRID_LOCK_GATE_F) || !(current.margin >= DEFAULT_R2_PARAMS.lockMarginMin)
      || !current.formatValid) { stats.acquisitionRebaseRejects++; return null; }
    const previous = snapshotCubeYObservation(candidate.faceLuma, candidate.visibleCells, candidate.format.tones);
    const comparison = compareCubeYObservations(previous, current.observation, continuity);
    if (!comparison.ok) { stats.acquisitionRebaseRejects++; return null; }
    return { ...candidate, faceHs: ownHs(tracking.faceHs), faceLuma: current.faceLuma,
      visibleCells: current.visibleCells, visibleCount: current.visibleCount, F: current.F, margin: current.margin,
      acquisitionTracking: ownTracking(tracking), acquisitionComparison: comparison };
  }
  function prepareExisting(node, frame, currentTok) {
    const tracking = sharedTrack(node.previousField, frame, node.faceHs, node.previousTok, currentTok);
    node.trackingDetail = ownTracking(tracking);
    if (!tracking.ok || !(tracking.after.ncc >= continuity.minTrackedNcc) || !(tracking.gain > 0)) {
      return 'tracking-unproven';
    }
    const current = measure(node, frame, tracking.faceHs, currentTok);
    if (!(current.F >= GRID_LOCK_GATE_F) || !(current.margin >= DEFAULT_R2_PARAMS.lockMarginMin)
      || !current.formatValid) return 'current-grid-or-format-unproven';
    const comparison = compareCubeYObservations(node.previousObservation, current.observation, continuity);
    node.comparison = comparison;
    if (!comparison.ok) return comparison.reason;
    node.faceHs = ownHs(tracking.faceHs); node.current = current;
    return null;
  }
  function ownHud(node, result = node.lastResult) {
    return { id: node.id, type: 'Y', n: node.n, layoutId: node.layoutId,
      formatWire: node.format.formatWireVersion, revision: node.revision,
      geometryMode: 'y-faces', faceHs: ownHs(node.faceHs),
      frameWidth: lastFrame?.width ?? 0, frameHeight: lastFrame?.height ?? 0,
      D: result?.progress?.D ?? 0, indicator: result?.indicator ?? R2_INDICATOR.SEARCHING,
      cellMap: result?.progress?.cellMap ? new Uint8Array(result.progress.cellMap) : new Uint8Array(node.bound.cellCount),
      tracking: node.tracking === true, trackingDetail: copyTracking(node.trackingDetail),
      retained: node.retained, alive: node.alive,
      continuity: node.comparison ? { ...node.comparison, policy: { ...node.comparison.policy } } : null };
  }
  function copyHud(row) {
    return { ...row, faceHs: ownHs(row.faceHs), cellMap: new Uint8Array(row.cellMap),
      tracking: row.tracking === true, trackingDetail: copyTracking(row.trackingDetail),
      continuity: row.continuity ? { ...row.continuity, policy: { ...row.continuity.policy } } : null };
  }
  function refreshHud(extra = null) {
    hudCandidates = nodes.map((node) => ownHud(node));
    // accepted 정본과 렌더러 feed는 서로 소유권을 공유하지 않아요.
    const retainedAccepted = extra ?? accepted?.snapshot ?? null;
    if (retainedAccepted) hudCandidates.push(copyHud(retainedAccepted));
  }
  function pushNode(node, frame, timestamp, frameId) {
    const beforeAttempts = node.session.counters.decodeAttempts;
    const beforeFailures = node.session.counters.decodeFailures;
    const started = performance.now();
    const result = node.session.pushFrame(frame.data, frame.width, frame.height, timestamp, { frameId });
    const elapsed = performance.now() - started;
    stats.lastSessionMs += elapsed; stats.maxSessionMs = Math.max(stats.maxSessionMs, elapsed); stats.sessionPushes++;
    const rsMs = Number(node.session.frameMs.decode) || 0;
    stats.lastRsMs += rsMs; stats.maxRsMs = Math.max(stats.maxRsMs, rsMs);
    stats.decodeAttempts += node.session.counters.decodeAttempts - beforeAttempts;
    stats.decodeFailures += node.session.counters.decodeFailures - beforeFailures;
    node.lastResult = result; node.revision++;
    // 실제 current 관측이 valid gate를 지나 세션에 들어간 프레임만 HUD active예요.
    node.tracking = true; node.retained = false;
    const D = Number.isFinite(result.progress?.D) ? result.progress.D : 0;
    if (D > node.bestD) { node.bestD = D; node.idleFrames = 0; } else node.idleFrames++;
    node.previousField = frame; node.previousObservation = node.current.observation;
    node.previousTok = frameTok(frameId, timestamp);
    return result;
  }
  function decodeHit(node, result) {
    let text;
    try { text = unframe(result.payload.subarray(0, result.payloadLength)).text; }
    catch { node.session.rejectPayload(); return null; }
    correctedCellsForHit(result, node.bound, node.correctionHolder);
    const snapshot = ownHud(node, result);
    // 세션은 바로 retire되지만 DONE 표시사본은 수용 surface에서 살아 있어요.
    snapshot.alive = true; snapshot.retained = true;
    const hit = { candidateId: node.id, revision: node.revision, text,
      profile: 'Y', n: node.n, layoutId: node.layoutId, formatWire: node.format.formatWireVersion,
      correctedCount: node.correctionHolder.count,
      correctedCells: new Uint16Array(node.correctionHolder.cells),
      cells: new Uint8Array(snapshot.cellMap), actualRS: { used: true,
        decodeAttempts: node.session.counters.decodeAttempts,
        decodeFailures: node.session.counters.decodeFailures,
        decodeMs: node.session.frameMs.decode } };
    hit.hudSnapshot = copyHud(snapshot);
    return { hit, snapshot };
  }
  function admitOriginCandidate(originCandidate, origin, frame, frameId, timestamp) {
    if (nodes.length >= capacity) { stats.capacitySkips++; return false; }
    const candidate = rebaseAcquiredCandidate(originCandidate, origin, frame, frameId, timestamp);
    if (!candidate) return false;
    nodes.push(makeNode(candidate, frame, frameId, timestamp));
    stats.binds++;
    return true;
  }
  function consumeReady(frame, frameId, timestamp) {
    // 발견 순서(raw/geometry/layout/format ordinal)로만 입장해요. 최종 F 정렬은
    // 동기 takeCompleted 집합에만 남고, 이 경로의 남은 후보는 좌석이 가득하면 닫아요.
    while (acquisition.active && acquisition.readyCount > 0 && nodes.length < capacity) {
      const remaining = capacity - nodes.length;
      const batch = acquisition.takeReady({ maxCandidates: remaining });
      if (!batch || batch.candidates.length === 0) break;
      for (const originCandidate of batch.candidates) {
        admitOriginCandidate(originCandidate, batch.origin, frame, frameId, timestamp);
      }
    }
  }
  function closeUnusedAcquisition() {
    if (!acquisition.active) return;
    const leftover = acquisition.takeReady({ maxCandidates: Number.MAX_SAFE_INTEGER });
    if (leftover) stats.capacitySkips += leftover.candidates.length;
    if (leftover?.complete || acquisition.phase === 'done') {
      const done = acquisition.takeCompleted({ maxCandidates: 0 });
      if (done) stats.observations += done.observed;
    } else {
      acquisition.reset();
    }
    stats.acquisitionPhase = 'idle';
  }
  function finishCompletedAcquisition() {
    if (!acquisition.active) return;
    if (acquisition.phase !== 'done') return;
    const leftover = acquisition.takeReady({ maxCandidates: Number.MAX_SAFE_INTEGER });
    if (leftover) {
      stats.capacitySkips += leftover.candidates.length;
    }
    const done = acquisition.takeCompleted({ maxCandidates: 0 });
    if (done) stats.observations += done.observed;
    stats.acquisitionPhase = 'idle';
  }
  function pushFrameImpl(input, timestamp, { frameId = timestamp, runDetect = false,
    maxCandidates = capacity, budgetMs = Infinity, ownedFrame = false } = {}) {
    if (!Number.isFinite(timestamp) || !(typeof frameId === 'string' || Number.isSafeInteger(frameId))) {
      throw new TypeError('유효한 timestamp와 frameId가 필요해요');
    }
    if (!(budgetMs === Infinity || (Number.isFinite(budgetMs) && budgetMs >= 0))) {
      throw new TypeError('budgetMs는 0 이상의 soft budget이어야 해요');
    }
    setCapacity(maxCandidates);
    if (lastFrame && lastFrame.frameId === frameId && lastFrame.timestamp === timestamp) return null;
    // ownedFrame은 엔진의 소유 사본만 빌려요. 일반 호출은 기존과 같이 복사해요.
    const frame = ownedFrame ? input : cloneField(input);
    if (lastFrame && (timestamp < lastFrame.timestamp || frame.width !== lastFrame.width || frame.height !== lastFrame.height)) reset();
    lastFrame = { frameId, timestamp, width: frame.width, height: frame.height };
    frameOrdinal++; stats.frames++; stats.lastError = null; stats.lastDetectMs = 0;
    stats.lastTrackingMs = 0; stats.lastSessionMs = 0; stats.lastRsMs = 0;
    clearShare();
    const currentTok = `current|${frameTok(frameId, timestamp)}`;

    const existing = new Set(nodes), prepared = [];
    for (const node of nodes) {
      if (serviceDeadline !== Infinity) { prepared.push(node); continue; }
      let reason;
      const trackingAt = performance.now();
      try { reason = prepareExisting(node, frame, currentTok); }
      catch (error) { reason = 'candidate-error'; stats.lastError = `candidate: ${error.message}`; }
      const trackingMs = performance.now() - trackingAt;
      stats.lastTrackingMs += trackingMs; stats.maxTrackingMs = Math.max(stats.maxTrackingMs, trackingMs);
      if (reason) retire(node, reason); else prepared.push(node);
    }
    nodes = prepared;
    const detectBudget = Math.min(budgetMs, Math.max(0, serviceDeadline - performance.now()) / (nodes.length ? 2 : 1));
    if (runDetect && capacity > 0 && detectBudget > 0) {
      try {
        if (!acquisition.active && nodes.length === 0) {
          acquisition.start(frame, { frameId, timestamp, epoch: `${generation}-${++acquisitionEpoch}` });
        }
        if (acquisition.active) {
          stats.detectCalls++;
          const detectAt = performance.now();
          const resumed = acquisition.resume({ maxAdditionalMs: detectBudget, maxWorkUnits: options.maxAcquisitionWorkUnits ?? Infinity });
          stats.acquisitionPhase = resumed.phase;
          stats.maxAcquisitionUnitMs = resumed.maxUnitMs;
          stats.maxAcquisitionUnitKind = resumed.maxUnitKind;
          consumeReady(frame, frameId, timestamp);
          if (nodes.length >= capacity) closeUnusedAcquisition();
          else finishCompletedAcquisition();
          stats.lastDetectMs = performance.now() - detectAt;
          stats.maxDetectMs = Math.max(stats.maxDetectMs, stats.lastDetectMs);
          if (budgetMs !== Infinity) stats.detectBudgetOverrunMs += Math.max(0, stats.lastDetectMs - budgetMs);
        }
      } catch (error) { stats.lastError = `detect: ${error.message}`; }
    }

    const survivors = []; let hit = null; let acceptedHud = null; let leading = null;
    const ordered = serviceDeadline === Infinity ? nodes : [...nodes].sort((a, b) => a.servicedAt - b.servicedAt);
    for (const node of ordered) {
      if (performance.now() >= serviceDeadline) {
        node.tracking = false; node.retained = true; node.revision++;
        stats.deferredCandidates++; survivors.push(node); continue;
      }
      const unitAt = performance.now();
      node.servicedAt = ++serviceSequence;
      let result;
      try {
        if (serviceDeadline !== Infinity && existing.has(node)) {
          const trackingAt = performance.now(), reason = prepareExisting(node, frame, currentTok);
          const trackingMs = performance.now() - trackingAt;
          stats.lastTrackingMs += trackingMs; stats.maxTrackingMs = Math.max(stats.maxTrackingMs, trackingMs);
          if (reason) { retire(node, reason); continue; }
        }
        result = pushNode(node, frame, timestamp, frameId);
      }
      catch (error) { stats.lastError = `session: ${error.message}`; retire(node, 'session-error'); continue; }
      finally { stats.maxServiceUnitMs = Math.max(stats.maxServiceUnitMs, performance.now() - unitAt); }
      const D = Number.isFinite(result.progress?.D) ? result.progress.D : 0;
      if (!leading || D > leading.D) leading = { D, result, node };
      if (result.indicator === R2_INDICATOR.DONE) {
        const decoded = decodeHit(node, result);
        if (decoded && !hit && !accepted) {
          hit = decoded.hit;
          accepted = { hit: { ...hit, correctedCells: new Uint16Array(hit.correctedCells),
            cells: new Uint8Array(hit.cells), actualRS: { ...hit.actualRS },
            hudSnapshot: copyHud(hit.hudSnapshot) }, snapshot: copyHud(decoded.snapshot) };
          acceptedHud = accepted.snapshot;
          stats.done++;
        }
        retire(node, decoded ? 'done-consumed' : 'unframe-rejected');
      } else if (node.idleFrames >= maxIdleFrames) retire(node, 'no-progress');
      else survivors.push(node);
    }
    nodes = survivors;
    stats.candidateCount = nodes.length; stats.progressD = hit ? 1 : leading?.D ?? 0;
    stats.indicator = hit ? R2_INDICATOR.DONE : leading?.result.indicator ?? R2_INDICATOR.SEARCHING;
    refreshHud(acceptedHud);
    return hit;
  }
  function pushFrame(input, timestamp, control = {}) {
    const budget = control.serviceBudgetMs ?? Infinity;
    if (!(budget === Infinity || Number.isFinite(budget) && budget >= 0)) throw new TypeError('유효한 전체 서비스 예산이 필요해요');
    const started = performance.now(); serviceDeadline = budget === Infinity ? Infinity : started + budget;
    try {
      if (budget === 0) { setCapacity(control.maxCandidates ?? capacity); deferFrame(); return null; }
      return pushFrameImpl(input, timestamp, control);
    } finally {
      stats.lastServiceMs = performance.now() - started;
      if (Number.isFinite(budget)) stats.serviceOverrunMs += Math.max(0, stats.lastServiceMs - budget);
      serviceDeadline = Infinity;
    }
  }
  function deferFrame() {
    stats.deferredFrames++;
    for (const node of nodes) {
      node.revision++;
      node.tracking = false;
      node.retained = true;
    }
    refreshHud();
  }
  return Object.freeze({ pushFrame, deferFrame, reset, setCapacity, stats,
    get hudCandidates() { return hudCandidates.map(copyHud); },
    get accepted() { return accepted; } });
}
