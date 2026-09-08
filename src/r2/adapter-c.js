/** C 전용 관측 다리. 런타임이나 Y 관측기의 호출 순서를 바꾸지 않는다. */
import { TYPE_C_RADII, C_FORMAT_INDEX, cSpecFromFormatIndex } from '../formatC.js';
import { formatCells } from '../placement.js';
import { notchCellsC, notchCellCountC } from '../notchC.js';
import { DEFAULT_MASK_INDEX } from '../mask.js';
import { decodeSingle, ECC_NAME_BY_VALUE } from '../formatinfo.js';
import { R2_TYPE_C_PROFILE, TYPE_C_FORMAT_WIRE, TYPE_C_DATA_TONES } from './profiles/c.js';
import { r2FormatAllowsCandidate, sameR2CandidateKey } from './candidate-key.js';
import {
  centralN7CenterPriorSeeds,
  centralN7Finders,
  centralN7FindersFromShapes,
} from '../decoder/central-n7-observe.js';
import { BEACON_CS_BLOCK_LOCATOR } from '../decoder/central-beacon-observation-shared.js';
import { createCentralN7BlockCursor } from '../decoder/cellsurface-block-detect.js';
import { createVerifiedCursorPrototypeV3 } from '../decoder/cs-verified-cursor-v3-prototype.js';
import { findCAnchorHypotheses } from '../decoder/anchor-detect.js';
import { sampleHexCell } from '../decoder/grid-sample.js';
import { readFormatWithCells } from '../decoder/format-read.js';
import { createCBodyTracker } from '../decoder/c-body-track.js';
import { observeCqQrGeometry } from '../decoder/cq-observe.js';
import { observeCDaehanGeometry } from '../decoder/c-daehan-observe.js';
import { createCqStructuralRefineCursor } from '../decoder/cq-structural-refine.js';
import { resumeCursorWithinBudget } from './cursor-budget.js';

// 0=없음, hex 팩 1..5, Y=6. 후보 key의 profile과는 별도인 관측 태그다.
export const FAMILY_C = 7;
const FACES = Object.freeze(['T', 'L', 'R']);
const UNKNOWN = Object.freeze({ kind: 'unknown' });
const contradiction = reason => Object.freeze({ kind: 'contradiction', reason });
const equalFrame = (a, b) => !!a && !!b && a.frameId === b.frameId && a.timestamp === b.timestamp;
const validH = H => H instanceof Float64Array && H.length === 9 && H.every(Number.isFinite);
const byte = value => Math.max(0, Math.min(255, Math.round(value * 255)));
const copyField = field => ({ width: field.width, height: field.height,
  data: field.data.slice(), alpha: field.alpha?.slice() ?? null });

/** v1의 mask는 CRC로 읽힌 와이어의 고정 속성이에요. unknown에 mask를 주입하지 않아요. */
export function readFormatC(field, H, k, hint = null) {
  if (!validH(H) || !TYPE_C_RADII.includes(k)) return UNKNOWN;
  const read = readFormatWithCells(field, { family: 'hex', H, k }, {},
    [...new Set(C_FORMAT_INDEX.filter(row => row.k === k).map(row => row.formatIndex))],
    formatCells(k), TYPE_C_FORMAT_WIRE);
  if (!read.ok) return UNKNOWN;
  const formats = read.formatCandidates.map(proposal => {
    const spec = cSpecFromFormatIndex(proposal.versionIndex, k);
    const ecc = ECC_NAME_BY_VALUE[proposal.eccLevel];
    return spec && ecc ? { kind: 'read', ecc, maskIndex: DEFAULT_MASK_INDEX,
      wire: TYPE_C_FORMAT_WIRE, layoutId: spec.name } : null;
  }).filter(Boolean);
  const distinct = new Map(formats.map(format => [JSON.stringify(format), format]));
  if (distinct.size !== 1) return UNKNOWN;
  const format = [...distinct.values()][0];
  if (hint && ((hint.k !== undefined && hint.k !== k)
    || (Array.isArray(hint.layoutHint) && !hint.layoutHint.includes(format.layoutId))
    || (hint.generation !== undefined && hint.expectedGeneration !== undefined
      && hint.generation !== hint.expectedGeneration)
    || (hint.format?.kind === 'read' && !r2FormatAllowsCandidate(hint.format, format)))) {
    return contradiction('observed-format-mismatch');
  }
  return Object.freeze(format);
}

/** R1과 같은 전체 노치 표본 + 배경 동률 75% 술어예요. */
export function readCNotch(field, H, k) {
  if (!validH(H) || !TYPE_C_RADII.includes(k)) return null;
  let sampled = 0, background = 0, foreground = 0;
  const observations = [];
  for (const cell of notchCellsC(k)) {
    const sample = sampleHexCell(field, { family: 'hex', H, k }, cell.q, cell.r, {});
    if (!sample.ok) { observations.push({ q: cell.q, r: cell.r, reason: sample.reason }); continue; }
    sampled++;
    if (sample.tie === true) background++; else foreground++;
    observations.push({ q: cell.q, r: cell.r, tie: sample.tie === true, separation: sample.separation });
  }
  const backgroundRate = sampled === 0 ? 0 : background / sampled;
  return { ok: sampled === notchCellCountC(k) && backgroundRate >= 0.75,
    sampled, background, foreground, backgroundRate, minBackgroundRate: 0.75, observations };
}

function samePixels(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height
    || a.data.length !== b.data.length || !!a.alpha !== !!b.alpha) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (!Object.is(a.data[i], b.data[i]) || (a.alpha && !Object.is(a.alpha[i], b.alpha[i]))) return false;
  }
  return true;
}

function resetOutput(output) {
  output.found = 0; output.family = 0; output.n = 0; output.H = null;
  output.layoutId = ''; output.faceLabels = FACES; output.observation = null; output.format = UNKNOWN;
}
function resetAlignment(output, faceLuma, visibleCells) {
  faceLuma?.fill(0); visibleCells?.fill(0);
  Object.assign(output, { gatePassed: 0, weightQ15: 0, mismatchCount: 0,
    matchCount: 0, visibleCount: 0, distrusted: 0 });
}

/** 후보가 소유한 BoundLayout 순서로 canonical hex 원판의 median 바이트를 기록해요. */
export function sampleCLayoutInto(field, H, bound, faceLuma, visibleCells) {
  faceLuma.fill(0); visibleCells.fill(0);
  const count = Math.min(bound.cellCount, visibleCells.length, Math.floor(faceLuma.length / 3));
  let visibleCount = 0;
  for (let i = 0; i < count; i++) {
    const sample = sampleHexCell(field, { H }, bound.cellCoord[2 * i], bound.cellCoord[2 * i + 1], {});
    if (!sample.ok) continue;
    for (let face = 0; face < 3; face++) faceLuma[3 * i + face] = byte(sample[FACES[face]].median);
    visibleCells[i] = 1; visibleCount++;
  }
  return visibleCount;
}

/**
 * A3와 같은 호출 모양. pose.frameId가 있으면 쓰고, 생략하면 timestamp가 프레임 ID예요.
 * 기본값은 완전 픽셀 일치만 허용하는 정지영상 재검증이에요.
 * tracking.minNcc를 명시한 격리 평가만 광도 기하 추적을 사용하며, 값은 자동 잠금하지 않아요.
 */
export function createCAdapters(options = {}) {
  const detectMs = options.budget?.detectMs ?? Infinity;
  const maxHypotheses = options.maxHypotheses ?? 1;
  const formatEveryFrames = options.formatEveryFrames ?? 1;
  const tracking = options.tracking === undefined || options.tracking === false ? null : options.tracking;
  if (!(detectMs >= 0) || !Number.isSafeInteger(maxHypotheses) || maxHypotheses < 1
    || !Number.isSafeInteger(formatEveryFrames) || formatEveryFrames < 1) throw new TypeError('잘못된 C 관측 예산');
  if (options.tracking !== undefined && options.tracking !== false && (!tracking || !Number.isFinite(tracking.minNcc)
    || tracking.minNcc < 0 || tracking.minNcc > 1)) throw new TypeError('추적은 명시한 minNcc 평가값이 필요해요');
  const minNcc = tracking?.minNcc;
  const geometrySources = options.geometrySources ?? ['n7'];
  if (!Array.isArray(geometrySources) || geometrySources.length === 0
    || geometrySources.some(source => !['n7', 'cq', 'daehan'].includes(source))
    || new Set(geometrySources).size !== geometrySources.length) throw new TypeError('C 관측 출처 목록이 잘못됐어요');
  const includeN7 = geometrySources.includes('n7');
  const extraSources = geometrySources.filter(source => source !== 'n7');
  if (options.refineCq !== undefined && typeof options.refineCq !== 'boolean') throw new TypeError('CQ 보정은 명시적 boolean 옵션이에요');
  const refineCq = options.refineCq === true;
  let generation = 1, acquisition = 0, frame = null, frameOrdinal = 0, job = null, lastDetectionFrame = null;
  let lastOutput = null, lastExternalGeneration;
  const observations = new WeakMap(), observationRecords = new Set(), candidateStates = new WeakMap(), candidates = new Set();
  const stats = { n: 0, layoutHint: [], locked: 0, gridLockF: 0, lockMargin: 0,
    lockDistrusted: true, shapeCount: 0, lastDetectMs: 0, sourceKind: null,
    sourceIdentity: null, hypothesesTried: 0, coreCandidates: 0, clusterCount: 0, budgetHits: 0, budgetOverrunMs: 0,
    resumeCursor: null, cTries: 0, observedFrames: 0, snapshotCopyMs: 0,
    snapshotBytes: 0, snapshotCopies: 0, snapshotRetainedBytes: 0,
    n7CursorSteps: 0, n7MaxUnitMs: 0, n7MaxUnit: null,
    n7SeedMs: 0, n7SnapshotCopyMs: 0, n7SnapshotBytes: 0,
    formatRejects: 0, formatReads: 0, formatRereads: 0, notchRejects: 0, anchorSearches: 0,
    currentValidationMs: 0, sampleMs: 0, lastSampleMs: 0, sampleComputations: 0, sampleCacheHits: 0,
    trackingMs: 0, trackingCopyMs: 0, trackingSnapshotBytes: 0, trackingRetainedBytes: 0,
    trackingObservations: 0, trackingRejects: 0, acquisitionTrackingMs: 0,
    acquisitionTrackingCopyMs: 0, acquisitionTrackingRetainedBytes: 0, acquisitionTrackingRejects: 0,
    acquisitionCheckpointCopyMs: 0, acquisitionCheckpointBytes: 0,
    acquisitionCheckpointRetainedBytes: 0, acquisitionCheckpointUses: 0,
    cqRefineQueued: 0, cqRefineCompleted: 0, cqRefineEvaluations: 0, cqRefineMs: 0,
    cqRefineCopyMs: 0, cqRefineSnapshotBytes: 0, cqRefineRetainedBytes: 0,
    maxUnitMs: 0, maxUnit: null, lastUnit: null, lastHypothesesTried: 0,
    lastAnchorSearches: 0, scanComplete: false, discarded: 0 };

  function recordMaxUnit(ms, unit) {
    if (Number.isFinite(ms) && ms > stats.maxUnitMs) {
      stats.maxUnitMs = ms;
      stats.maxUnit = unit;
    }
  }

  function invalidateCandidate(state, reason) {
    if (state.tracker) {
      stats.trackingRetainedBytes -= state.trackerBytes;
      state.tracker.discard(reason); state.tracker = null; state.trackerBytes = 0;
    }
    state.invalidated = reason; state.cache = null; state.H = null; state.hud = null;
    state.snapshot = null; candidates.delete(state);
  }
  function installTracker(state, observationTracker = null) {
    if (state.tracker) {
      stats.trackingRetainedBytes -= state.trackerBytes;
      state.tracker.discard('reobserved');
    }
    state.tracker = observationTracker?.fork() ?? createCBodyTracker(state.snapshot, state.H, state.bound.dimension,
      { minNcc, origin: state.origin });
    state.trackerBytes = state.tracker.stats.snapshotBytes;
    stats.trackingCopyMs += state.tracker.stats.copyMs;
    stats.trackingSnapshotBytes += state.trackerBytes;
    stats.trackingRetainedBytes += state.trackerBytes;
    state.snapshot = null;
  }
  function discard(reason) {
    job?.refineCursor?.discard(reason); stats.cqRefineRetainedBytes = 0;
    job?.n7Cursor?.discard(reason);
    job?.cursor?.discard(reason); job = null;
    for (const state of candidates) invalidateCandidate(state, reason);
    // 호출자가 폐기된 관측 토큰을 보관해도 WeakMap 값이 큰 스냅샷을 붙잡지 않아요.
    for (const own of observationRecords) invalidateObservation(own, reason);
    observationRecords.clear();
    generation++; lastOutput = null; lastDetectionFrame = null;
    stats.snapshotRetainedBytes = 0; stats.acquisitionCheckpointRetainedBytes = 0;
    stats.resumeCursor = null; stats.scanComplete = false;
    stats.discarded++;
    clearObserved();
  }
  function clearObserved() {
    stats.n = 0; stats.layoutHint = []; stats.locked = 0; stats.gridLockF = 0;
    stats.lockMargin = 0; stats.lockDistrusted = true; stats.sourceKind = null; stats.sourceIdentity = null;
  }
  function beginFrame(luma, width, height, timestamp, pose) {
    const field = { width, height, data: luma?.data ?? luma, alpha: luma?.alpha ?? pose?.alpha ?? null };
    if (!(field.data instanceof Float32Array) || field.data.length !== width * height
      || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || !Number.isFinite(timestamp) || (field.alpha && (!(field.alpha instanceof Uint8Array) || field.alpha.length !== field.data.length))) {
      throw new TypeError('유효한 휘도 프레임이 필요해요');
    }
    const current = { timestamp, frameId: pose?.frameId ?? timestamp, width, height };
    if (!(typeof current.frameId === 'string' || Number.isSafeInteger(current.frameId))) throw new TypeError('프레임 ID는 문자열 또는 정수여야 해요');
    if (frame && (frame.width !== width || frame.height !== height)) discard('resize');
    if (pose?.generation !== undefined && lastExternalGeneration !== undefined
      && pose.generation !== lastExternalGeneration) discard('generation');
    if (pose?.generation !== undefined) lastExternalGeneration = pose.generation;
    if (frame && timestamp < frame.timestamp) discard('time-reversal');
    if (!equalFrame(frame, current)) { frameOrdinal++; stats.observedFrames++; }
    frame = current;
    return field;
  }
  function createJob(field) {
    acquisition++;
    const at = performance.now();
    const snapshot = { width: field.width, height: field.height, data: field.data.slice(), alpha: field.alpha?.slice() ?? null };
    const copyMs = performance.now() - at;
    const origin = Object.freeze({ ...frame, generation });
    // v3 자체 스냅샷과 후속 n7/anchor용 사본을 모두 시간·메모리로 계상해요.
    const cursor = createVerifiedCursorPrototypeV3(snapshot, origin, {
      calibration: { csBlockLocator: BEACON_CS_BLOCK_LOCATOR },
    });
    const bytes = snapshot.data.byteLength + (snapshot.alpha?.byteLength ?? 0);
    stats.snapshotCopyMs += copyMs + cursor.status.copyMs;
    stats.snapshotCopies += 2; stats.snapshotBytes += bytes + cursor.status.snapshotBytes;
    stats.snapshotRetainedBytes = bytes + cursor.status.snapshotBytes;
    recordMaxUnit(copyMs, 'snapshot-copy');
    recordMaxUnit(cursor.status.copyMs, 'cursor-snapshot-copy');
    stats.scanComplete = false;
    job = { acquisition, snapshot, origin, cursor, phase: includeN7 ? 'cursor' : 'extra', tasks: [], index: 0,
      extraIndex: 0, extraIterator: null, refinements: [], refineIndex: 0, refineCursor: null,
      outputs: [], replay: 0, bytes, checkpoint: null, restartNextFrame: false,
    };
  }
  function captureAcquisitionCheckpoint(field) {
    if (!tracking || !job || samePixels(field, job.snapshot)) return;
    const at = performance.now(), snapshot = copyField(field), copyMs = performance.now() - at;
    const bytes = snapshot.data.byteLength + (snapshot.alpha?.byteLength ?? 0);
    job.checkpoint = { field: snapshot, current: Object.freeze({ ...frame, generation }), bytes };
    stats.snapshotCopyMs += copyMs; stats.snapshotBytes += bytes; stats.snapshotCopies++;
    stats.acquisitionCheckpointCopyMs += copyMs; stats.acquisitionCheckpointBytes += bytes;
    stats.acquisitionCheckpointRetainedBytes = bytes;
    recordMaxUnit(copyMs, 'acquisition-checkpoint-copy');
  }
  function currentVerified(field, snapshot) {
    const at = performance.now(), pass = samePixels(field, snapshot);
    stats.currentValidationMs += performance.now() - at;
    return pass;
  }
  function invalidateObservation(own, reason) {
    if (own.tracker) {
      stats.acquisitionTrackingRetainedBytes -= own.trackerBytes;
      own.tracker.discard(reason); own.tracker = null; own.trackerBytes = 0;
    }
    own.invalidated = reason; own.snapshot = null; own.checkpoint = null;
    own.finder = null; own.H = null; own.notch = null;
  }
  function observeAcquisitionTracker(own, field, current) {
    const copyBefore = own.tracker.stats.copyMs, trackBefore = own.tracker.stats.trackMs;
    const proof = own.tracker.observe(field, current);
    stats.acquisitionTrackingCopyMs += own.tracker.stats.copyMs - copyBefore;
    stats.acquisitionTrackingMs += own.tracker.stats.trackMs - trackBefore;
    stats.acquisitionTrackingRetainedBytes += own.tracker.stats.snapshotBytes - own.trackerBytes;
    own.trackerBytes = own.tracker.stats.snapshotBytes;
    return proof;
  }
  function verifyObservation(own, field) {
    if (!own || own.invalidated || own.generation !== generation) return false;
    if (!tracking) return currentVerified(field, own.snapshot);
    if (!own.tracker && currentVerified(field, own.snapshot)) return true;
    if (!own.tracker) {
      own.tracker = createCBodyTracker(own.snapshot, own.H, own.k, { minNcc, origin: own.origin });
      own.trackerBytes = own.tracker.stats.snapshotBytes;
      stats.acquisitionTrackingCopyMs += own.tracker.stats.copyMs;
      stats.acquisitionTrackingRetainedBytes += own.trackerBytes;
    }
    if (own.checkpoint) {
      const bridge = observeAcquisitionTracker(own, own.checkpoint.field, own.checkpoint.current);
      own.checkpoint = null;
      if (!bridge.ok) {
        stats.acquisitionTrackingRejects++; invalidateObservation(own, bridge.reason); return false;
      }
      if (!bridge.samePixels) { own.H = bridge.H; own.revision++; }
      stats.acquisitionCheckpointUses++;
    }
    const proof = observeAcquisitionTracker(own, field, { ...frame, generation });
    if (!proof.ok) {
      stats.acquisitionTrackingRejects++; invalidateObservation(own, proof.reason); return false;
    }
    if (!proof.samePixels) { own.H = proof.H; own.revision++; }
    // 옛 CRC를 새 영상의 확정 포맷으로 승격하지 않아요. 현재 H에서 다시 읽어요.
    const currentFormat = readFormatC(field, own.H, own.k, { layoutHint: own.layoutHint.length ? own.layoutHint : undefined, format: own.format });
    stats.formatRereads++;
    if (currentFormat.kind === 'contradiction') {
      invalidateObservation(own, 'format-contradiction'); return false;
    }
    if (currentFormat.kind !== 'read') return false;
    own.format = currentFormat;
    return true;
  }
  function publish(observation, output) {
    const own = observations.get(observation);
    if (!own || own.invalidated || own.generation !== generation) return;
    Object.assign(output, { found: 1, family: FAMILY_C, n: own.k, H: own.H.slice(),
      faceLabels: FACES, observation, format: own.format,
      layoutId: own.format.kind === 'read' ? own.format.layoutId : '' });
    Object.assign(stats, { n: own.k, layoutHint: own.layoutHint.slice(), locked: 1,
      gridLockF: own.notch.backgroundRate, lockMargin: own.finder?.orientationMargin ?? 0,
      lockDistrusted: own.format.kind !== 'read', sourceKind: own.sourceKind, sourceIdentity: own.sourceIdentity });
  }
  function queueCqRefinement(task, format) {
    if (!refineCq || task.sourceKind !== 'c-cq' || task.refined === true || format.kind !== 'read') return;
    const bound = R2_TYPE_C_PROFILE.bind({ profile: 'C', layoutId: format.layoutId,
      dimensionKind: 'radius-k', dimension: task.k, ecc: format.ecc,
      maskIndex: format.maskIndex, wire: format.wire, tones: TYPE_C_DATA_TONES,
      orientation: task.orientation ?? 0, sourceIdentity: `c-acquisition-${job.acquisition}` });
    if (!bound) return;
    job.refinements.push({ task: { ...task, H: task.H.slice(), refined: true }, cellCoord: bound.cellCoord });
    stats.cqRefineQueued++;
  }
  function finishGeometrySources() {
    job.phase = job.refinements.length ? 'cq-refine' : 'complete';
    stats.scanComplete = job.phase === 'complete';
  }
  function releaseCompletedJob(reason) {
    if (!job || job.phase !== 'complete') return;
    job.refineCursor?.discard(reason);
    job.n7Cursor?.discard(reason);
    job.cursor?.discard(reason);
    for (const observation of job.outputs) {
      const own = observations.get(observation);
      if (!own) continue;
      invalidateObservation(own, reason);
      observationRecords.delete(own);
    }
    job = null;
    stats.snapshotRetainedBytes = 0;
    stats.acquisitionCheckpointRetainedBytes = 0;
    stats.cqRefineRetainedBytes = 0;
    stats.resumeCursor = null;
    stats.scanComplete = false;
  }
  function observeTask(task, field) {
    stats.hypothesesTried++;
    const H = task.H.slice(), notch = readCNotch(job.snapshot, H, task.k);
    if (!notch?.ok) { stats.notchRejects++; stats.formatRejects++; return null; }
    const decoded = task.finder?.centralN7 ? decodeSingle(task.finder.centralN7.outerFormat) : { ok: false };
    const layoutHint = decoded.ok ? C_FORMAT_INDEX.filter(row => row.formatIndex === decoded.version)
      .map(row => row.name) : [];
    const format = readFormatC(job.snapshot, H, task.k, { k: task.k, layoutHint: layoutHint.length ? layoutHint : undefined });
    if (format.kind === 'read') stats.formatReads++; else stats.formatRejects++;
    queueCqRefinement(task, format);
    const own = { H, k: task.k, finder: task.finder ?? null, orientation: task.orientation ?? task.finder?.orientation ?? 0, notch, format, layoutHint,
      sourceKind: task.sourceKind, sourceIdentity: `c-acquisition-${job.acquisition}`,
      generation, origin: job.origin, snapshot: job.snapshot, revision: job.outputs.length + 1,
      checkpoint: job.checkpoint,
      tracker: null, trackerBytes: 0, invalidated: null };
    if (!verifyObservation(own, field)) {
      invalidateObservation(own, 'acquisition-unproven');
      if (!tracking) discard('snapshot-content-changed');
      return null;
    }
    const observation = Object.freeze({ get H() { return own.H?.slice() ?? null; }, k: own.k,
      orientation: own.orientation, sourceKind: own.sourceKind, sourceIdentity: own.sourceIdentity,
      generation, originFrameId: own.origin.frameId, originTimestamp: own.origin.timestamp,
      ageFrames: frameOrdinal - own.origin.ordinal, ageMs: frame.timestamp - own.origin.timestamp,
      layoutHint: Object.freeze(layoutHint.slice()), format });
    observations.set(observation, own); observationRecords.add(own); job.outputs.push(observation);
    return observation;
  }
  function detectInto(luma, width, height, timestamp, pose, output) {
    const started = performance.now();
    const field = beginFrame(luma, width, height, timestamp, pose);
    const sharedBudgetMs = pose?.budgetMs;
    if (sharedBudgetMs !== undefined && (typeof sharedBudgetMs !== 'number'
      || Number.isNaN(sharedBudgetMs) || sharedBudgetMs < 0)) {
      throw new TypeError('공유 C 관측 예산은 0 이상 또는 Infinity여야 해요');
    }
    const frameDetectMs = sharedBudgetMs === undefined ? detectMs : Math.min(detectMs, sharedBudgetMs);
    resetOutput(output);
    if (equalFrame(lastDetectionFrame, frame)) {
      if (lastOutput?.found && !verifyObservation(observations.get(lastOutput.observation), field)) {
        if (!tracking) discard('same-frame-content-changed');
        lastOutput = null; return;
      }
      if (lastOutput) Object.assign(output, lastOutput, { H: lastOutput.H?.slice() ?? null });
      return;
    }
    lastDetectionFrame = { ...frame }; stats.cTries++; clearObserved();
    const beforeHypotheses = stats.hypothesesTried, beforeAnchors = stats.anchorSearches;
    let cursorBatchMeasured = false, budgetWorkStarted = false;
    try {
      // 공유 스케줄러가 좌석을 주지 않은 프레임은 snapshot도 만들지 않고 기존 작업도 그대로 둬요.
      if (sharedBudgetMs === 0) return;
      budgetWorkStarted = true;
      if (tracking && job?.phase === 'complete' && job.restartNextFrame) {
        releaseCompletedJob('continuous-acquisition');
      }
      if (!job) { createJob(field); job.origin = Object.freeze({ ...job.origin, ordinal: frameOrdinal }); }
      stats.lastUnit = job.phase;
      if (job.phase === 'cursor') {
        const current = { ...frame, generation };
        let progress;
        if (frameDetectMs === Infinity) {
          progress = job.cursor.resume(current);
          recordMaxUnit(progress.ms, progress.unit);
        } else {
          cursorBatchMeasured = true;
          const spentMs = performance.now() - started;
          const batch = resumeCursorWithinBudget(job.cursor, current, {
            budgetMs: Math.max(0, frameDetectMs - spentMs),
            now: () => performance.now(),
          });
          progress = batch.lastProgress ?? { state: batch.state };
          recordMaxUnit(batch.maxStepMs, batch.maxStepUnit);
        }
        stats.lastUnit = progress.unit ?? stats.lastUnit;
        stats.resumeCursor = { ...job.cursor.status, ageFrames: frameOrdinal - job.origin.ordinal,
          ageMs: timestamp - job.origin.timestamp };
        if (progress.state === 'done') {
          const result = job.cursor.takeForFrame(job.cursor.status.origin);
          job.verified = result?.verified ?? [];
          stats.coreCandidates = result?.coreCandidates ?? 0; stats.clusterCount = result?.clusterCount ?? 0;
          stats.shapeCount = job.verified.length; job.phase = 'n7';
          captureAcquisitionCheckpoint(field);
          stats.snapshotRetainedBytes = job.bytes + (job.checkpoint?.bytes ?? 0);
        }
      } else if (job.phase === 'n7') {
        if (frameDetectMs === Infinity) {
          const finders = centralN7Finders(job.snapshot, job.verified).filter(f => f.centralN7.family === 'hex');
          for (const finder of finders) for (const k of TYPE_C_RADII) {
            job.tasks.push({ kind: 'anchors', k, finder });
          }
          for (const finder of finders) for (const k of TYPE_C_RADII) {
            job.tasks.push({ kind: 'evaluate', H: finder.H, k, finder, sourceKind: 'c-central-n7-seed' });
          }
          job.phase = 'hypotheses';
        } else {
          stats.lastUnit = 'n7-seeds';
          const seedAt = performance.now();
          const seeds = centralN7CenterPriorSeeds(job.snapshot, job.verified);
          stats.n7SeedMs += performance.now() - seedAt;
          job.n7Cursor = createCentralN7BlockCursor(job.snapshot, seeds, job.origin);
          stats.n7SnapshotCopyMs += job.n7Cursor.status.copyMs;
          stats.n7SnapshotBytes += job.n7Cursor.status.snapshotBytes;
          stats.snapshotCopyMs += job.n7Cursor.status.copyMs;
          stats.snapshotBytes += job.n7Cursor.status.snapshotBytes;
          stats.snapshotCopies++;
          stats.snapshotRetainedBytes = job.bytes + (job.checkpoint?.bytes ?? 0)
            + job.n7Cursor.status.snapshotRetainedBytes;
          recordMaxUnit(job.n7Cursor.status.copyMs, 'n7-cursor-snapshot-copy');
          job.phase = 'n7-cursor';
        }
      } else if (job.phase === 'n7-cursor') {
        cursorBatchMeasured = true;
        const current = { ...frame, generation };
        const spentMs = performance.now() - started;
        const batch = resumeCursorWithinBudget(job.n7Cursor, current, {
          budgetMs: Math.max(0, frameDetectMs - spentMs),
          now: () => performance.now(),
        });
        const progress = batch.lastProgress ?? { state: batch.state };
        stats.lastUnit = progress.unit ?? stats.lastUnit;
        stats.n7CursorSteps = job.n7Cursor.status.steps;
        if (batch.maxStepMs > stats.n7MaxUnitMs) {
          stats.n7MaxUnitMs = batch.maxStepMs;
          stats.n7MaxUnit = batch.maxStepUnit;
        }
        recordMaxUnit(batch.maxStepMs, batch.maxStepUnit);
        stats.snapshotRetainedBytes = job.bytes + (job.checkpoint?.bytes ?? 0)
          + job.n7Cursor.status.snapshotRetainedBytes;
        if (progress.state === 'done') {
          const result = job.n7Cursor.takeForFrame(job.n7Cursor.status.origin);
          job.n7Shapes = result?.shapes ?? [];
          stats.snapshotRetainedBytes = job.bytes + (job.checkpoint?.bytes ?? 0);
          job.phase = 'n7-finalize';
        }
      } else if (job.phase === 'n7-finalize') {
        const finders = centralN7FindersFromShapes(job.snapshot, job.n7Shapes)
          .filter(f => f.centralN7.family === 'hex');
        for (const finder of finders) for (const k of TYPE_C_RADII) {
          job.tasks.push({ kind: 'anchors', k, finder });
        }
        for (const finder of finders) for (const k of TYPE_C_RADII) {
          job.tasks.push({ kind: 'evaluate', H: finder.H, k, finder, sourceKind: 'c-central-n7-seed' });
        }
        job.n7Shapes = null;
        job.phase = 'hypotheses';
      } else if (job.phase === 'hypotheses') {
        let evaluated = 0;
        while (job && job.index < job.tasks.length && evaluated < maxHypotheses) {
          const task = job.tasks[job.index++]; evaluated++;
          stats.lastUnit = task.kind;
          if (task.kind === 'anchors') {
            stats.anchorSearches++;
            const anchored = findCAnchorHypotheses(job.snapshot, task.finder, [task.k], {});
            const evaluations = (anchored.hypotheses ?? []).map(h => ({ kind: 'evaluate',
              H: h.H, k: task.k, finder: task.finder, orientation: (task.finder.orientation + h.orientation) % 3,
              sourceKind: 'c-central-n7-anchor' }));
            job.tasks.splice(job.index, 0, ...evaluations);
          } else {
            const observation = observeTask(task, field);
            if (observation) { publish(observation, output); break; }
          }
          if (performance.now() - started > frameDetectMs) break;
        }
        if (job && job.index === job.tasks.length) {
          if (extraSources.length) job.phase = 'extra'; else finishGeometrySources();
        }
      } else if (job.phase === 'extra') {
        let evaluated = 0;
        while (job && job.extraIndex < extraSources.length && evaluated < maxHypotheses) {
          const source = extraSources[job.extraIndex]; stats.lastUnit = `geometry-${source}`;
          if (!job.extraIterator) job.extraIterator = source === 'cq'
            ? observeCqQrGeometry(job.snapshot) : observeCDaehanGeometry(job.snapshot);
          const next = job.extraIterator.next(); evaluated++;
          if (next.done) { job.extraIterator = null; job.extraIndex++; }
          else {
            const observation = observeTask(next.value, field);
            if (observation) { publish(observation, output); break; }
          }
          if (performance.now() - started > frameDetectMs) break;
        }
        if (job && job.extraIndex === extraSources.length) finishGeometrySources();
      } else if (job.phase === 'cq-refine') {
        const queued = job.refinements[job.refineIndex];
        stats.lastUnit = 'cq-refine';
        if (!job.refineCursor) {
          job.refineCursor = createCqStructuralRefineCursor(job.snapshot, queued.task.H, queued.cellCoord, job.origin);
          stats.cqRefineCopyMs += job.refineCursor.status.copyMs;
          stats.cqRefineSnapshotBytes += job.refineCursor.status.snapshotBytes;
          stats.cqRefineRetainedBytes = job.refineCursor.status.snapshotRetainedBytes;
          recordMaxUnit(job.refineCursor.status.copyMs, 'cq-refine-snapshot-copy');
        }
        const beforeEvaluations = job.refineCursor.status.evaluations, refineAt = performance.now();
        if (frameDetectMs === Infinity) {
          const progress = job.refineCursor.resume({ ...frame, generation });
          recordMaxUnit(progress.ms, progress.unit);
        } else {
          cursorBatchMeasured = true;
          const batch = resumeCursorWithinBudget(job.refineCursor, { ...frame, generation }, {
            budgetMs: Math.max(0, frameDetectMs - (performance.now() - started)), now: () => performance.now() });
          recordMaxUnit(batch.maxStepMs, batch.maxStepUnit);
        }
        stats.cqRefineMs += performance.now() - refineAt;
        stats.cqRefineEvaluations += job.refineCursor.status.evaluations - beforeEvaluations;
        stats.cqRefineRetainedBytes = job.refineCursor.status.snapshotRetainedBytes;
        if (job.refineCursor.status.phase === 'done') {
          const result = job.refineCursor.takeForFrame(job.origin);
          stats.cqRefineCompleted++;
          job.refineCursor = null; job.refineIndex++;
          if (result) {
            const observation = observeTask({ ...queued.task, H: result.H }, field);
            if (observation) publish(observation, output);
          }
          if (job && job.refineIndex === job.refinements.length) { job.phase = 'complete'; stats.scanComplete = true; }
        }
      } else if (job.phase === 'complete') {
        if (!tracking && !currentVerified(field, job.snapshot)) discard('snapshot-content-changed');
        else if (job.outputs.length) {
          const observation = job.outputs[job.replay++ % job.outputs.length];
          if (verifyObservation(observations.get(observation), field)) publish(observation, output);
        }
        if (tracking) job.restartNextFrame = true;
      }
      if (job) stats.resumeCursor = { phase: job.phase, index: job.index, total: job.tasks.length,
        steps: job.phase === 'n7-cursor' ? job.n7Cursor.status.steps : job.cursor.status.steps,
        n7Steps: job.n7Cursor?.status.steps ?? stats.n7CursorSteps,
        originFrameId: job.origin.frameId,
        originTimestamp: job.origin.timestamp, ageFrames: frameOrdinal - job.origin.ordinal,
        ageMs: timestamp - job.origin.timestamp };
    } finally {
      stats.lastDetectMs = performance.now() - started;
      if (!cursorBatchMeasured) recordMaxUnit(stats.lastDetectMs, stats.lastUnit);
      stats.lastHypothesesTried = stats.hypothesesTried - beforeHypotheses;
      stats.lastAnchorSearches = stats.anchorSearches - beforeAnchors;
      if (budgetWorkStarted && stats.lastDetectMs > frameDetectMs) {
        stats.budgetHits++; stats.budgetOverrunMs += stats.lastDetectMs - frameDetectMs;
      }
      lastOutput = { ...output, H: output.H?.slice() ?? null };
      if (typeof options.timing === 'function') options.timing({ unit: stats.lastUnit, ms: stats.lastDetectMs,
        frameId: frame.frameId, hypotheses: stats.lastHypothesesTried, anchors: stats.lastAnchorSearches });
    }
  }

  function bindCandidate(observation, format) {
    const own = observations.get(observation);
    if (!own || own.invalidated || own.generation !== generation || format?.kind !== 'read'
      || own.format.kind !== 'read' || !r2FormatAllowsCandidate(own.format, format)) return null;
    const bound = R2_TYPE_C_PROFILE.bind({ profile: 'C', layoutId: format.layoutId,
      dimensionKind: 'radius-k', dimension: own.k, ecc: format.ecc,
      maskIndex: format.maskIndex, wire: format.wire, tones: TYPE_C_DATA_TONES,
      orientation: own.orientation, sourceIdentity: own.sourceIdentity });
    if (!bound) return null;
    const state = { bound, H: own.H.slice(), generation, revision: own.revision,
      snapshot: own.snapshot, format: Object.freeze({ ...format }), cache: null, hud: null,
      invalidated: null, formatOrdinal: -Infinity, sampleOrdinal: -1, lastFrame: null, age: 0,
      origin: own.origin, layoutHint: own.layoutHint.slice(), tracker: null, trackerBytes: 0 };
    if (tracking) installTracker(state, own.tracker);
    const candidate = Object.freeze({ key: bound.key, bound, get H() { return state.H?.slice() ?? null; },
      generation, get revision() { return state.revision; },
      get invalidated() { return state.invalidated; }, get age() { return state.age; },
      get format() { return state.format; }, get hud() { return state.hud; },
      dispose() {
        if (state.invalidated) return false;
        invalidateCandidate(state, 'disposed');
        return true;
      },
      // 새 관측이 같은 key임을 증명한 경우에만 H를 개정해요. key 변경은 폐기예요.
      reobserve(nextObservation, nextFormat) {
        const next = observations.get(nextObservation);
        if (state.invalidated || !next || next.invalidated || next.generation !== generation || nextFormat?.kind !== 'read'
          || next.format.kind !== 'read' || !r2FormatAllowsCandidate(next.format, nextFormat)) return false;
        const nextBound = R2_TYPE_C_PROFILE.bind({ ...bound.key, layoutId: nextFormat.layoutId,
          dimension: next.k, ecc: nextFormat.ecc, maskIndex: nextFormat.maskIndex, wire: nextFormat.wire,
          orientation: next.orientation, sourceIdentity: next.sourceIdentity });
        if (!nextBound || !sameR2CandidateKey(bound.key, nextBound.key)) {
          invalidateCandidate(state, 'candidate-key-changed'); return false;
        }
        state.H = next.H.slice(); state.revision++; state.snapshot = next.snapshot;
        state.origin = next.origin; state.format = Object.freeze({ ...nextFormat });
        state.layoutHint = next.layoutHint.slice(); state.formatOrdinal = -Infinity;
        state.cache = null; state.hud = null;
        if (tracking) installTracker(state, next.tracker);
        return true;
      },
      alignInto(luma, width, height, timestamp, pose, detection, output, faceLuma, visibleCells) {
        return alignInto(luma, width, height, timestamp, pose, candidate, output, faceLuma, visibleCells);
      } });
    candidateStates.set(candidate, state); candidates.add(state);
    return candidate;
  }

  function alignInto(luma, width, height, timestamp, pose, detection, output, faceLuma, visibleCells) {
    const started = performance.now();
    resetAlignment(output, faceLuma, visibleCells);
    try {
    const field = beginFrame(luma, width, height, timestamp, pose);
    const state = candidateStates.get(detection?.candidate ?? detection);
    if (!state || state.invalidated || state.generation !== generation) return;
    if (state.tracker) {
      const beforeCopy = state.tracker.stats.copyMs, beforeTrack = state.tracker.stats.trackMs;
      const beforeObservations = state.tracker.stats.observations;
      const proof = state.tracker.observe(field, { ...frame, generation });
      stats.trackingCopyMs += state.tracker.stats.copyMs - beforeCopy;
      stats.trackingMs += state.tracker.stats.trackMs - beforeTrack;
      stats.trackingObservations += state.tracker.stats.observations - beforeObservations;
      stats.trackingRetainedBytes += state.tracker.stats.snapshotBytes - state.trackerBytes;
      state.trackerBytes = state.tracker.stats.snapshotBytes;
      if (!proof.ok) { stats.trackingRejects++; invalidateCandidate(state, proof.reason); return; }
      if (!proof.samePixels) {
        state.H = proof.H; state.revision++; state.cache = null; state.hud = null;
        stats.trackingSnapshotBytes += state.trackerBytes;
      }
    } else if (!currentVerified(field, state.snapshot)) {
      invalidateCandidate(state, 'current-pixels-changed'); return;
    }
    if (!equalFrame(state.lastFrame, frame)) { state.age++; state.lastFrame = { ...frame }; }
    if (frameOrdinal - state.formatOrdinal >= formatEveryFrames || pose?.observationContradiction === true) {
      stats.formatRereads++;
      const format = readFormatC(field, state.H, state.bound.dimension, {
        layoutHint: state.layoutHint.length ? state.layoutHint : undefined, format: state.format,
        generation: state.generation, expectedGeneration: generation });
      state.formatOrdinal = frameOrdinal;
      if (format.kind === 'contradiction') { invalidateCandidate(state, 'format-contradiction'); return; }
      if (format.kind === 'read') state.format = format;
    }
    const cacheKey = JSON.stringify([frame.frameId, frame.timestamp, state.generation, state.revision]);
    if (state.cache?.key !== cacheKey) {
      const count = state.bound.cellCount;
      const samples = new Uint8Array(count * 3), visible = new Uint8Array(count);
      const visibleCount = sampleCLayoutInto(field, state.H, state.bound, samples, visible);
      state.cache = { key: cacheKey, samples, visible, visibleCount };
      state.hud = Object.freeze({ frameId: frame.frameId, generation: state.generation,
        revision: state.revision, visibleCount });
      stats.sampleComputations++;
    } else stats.sampleCacheHits++;
    const count = Math.min(state.bound.cellCount, visibleCells?.length ?? 0, Math.floor((faceLuma?.length ?? 0) / 3));
    faceLuma?.set(state.cache.samples.subarray(0, count * 3));
    visibleCells?.set(state.cache.visible.subarray(0, count));
    let visibleCount = 0;
    for (let i = 0; i < count; i++) visibleCount += state.cache.visible[i];
    output.visibleCount = visibleCount; output.matchCount = visibleCount;
    output.gatePassed = visibleCount > 0 ? 1 : 0; output.weightQ15 = visibleCount > 0 ? 32767 : 0;
    } finally {
      stats.lastSampleMs = performance.now() - started;
      stats.sampleMs += stats.lastSampleMs;
    }
  }
  function invalidateLock() { discard('invalidateLock'); }
  function reset() { discard('reset'); frame = null; lastExternalGeneration = undefined; }
  return Object.freeze({ detectInto, alignInto, stats, bindCandidate, invalidateLock, reset });
}
