/** O/A/V/K 광학 획득과 현재 표본의 소유권을 관리해요. 누적과 RS는 공용 코어 몫이에요. */
import { PLANAR_PROFILES, PLANAR_FINDER_SOURCES, planarGeometrySteps,
  readPlanarFormats, planarReservationProven } from './planar-observe.js';
import { createCBodyTracker } from '../decoder/c-body-track.js';
import { sampleHexCell } from '../decoder/grid-sample.js';
import { snapshotCubeYObservation, compareCubeYObservations, DEFAULT_CUBE_Y_CONTINUITY } from './cube-y-identity.js';
import { r2FormatAllowsCandidate } from './candidate-key.js';
import { Q15_ONE } from './params.js';
import { createCqStructuralRefineCursor } from '../decoder/cq-structural-refine.js';
import { refineSagoaeGeometrySteps } from '../decoder/sagoae-refine.js';
import { createPlanarWorkAccounting } from './planar-work-accounting.js';
import { normalizeAcquisitionPolicy, createAcquisitionJournal } from './acquisition-lifetime.js';

export const FAMILY_PLANAR = 8;
const FACES = Object.freeze(['T', 'L', 'R']);
const UNKNOWN = Object.freeze({ kind: 'unknown' });
const ownField = f => ({ width: f.width, height: f.height, data: f.data.slice(), alpha: f.alpha?.slice() ?? null });
function samePixels(a, b) {
  if (a.width !== b.width || a.height !== b.height || !!a.alpha !== !!b.alpha) return false;
  for (let i = 0; i < a.data.length; i++) if (!Object.is(a.data[i], b.data[i])
    || (a.alpha && !Object.is(a.alpha[i], b.alpha[i]))) return false;
  return true;
}
const equalFrame = (a, b) => a && b && a.frameId === b.frameId && a.timestamp === b.timestamp;
const clearOutput = out => Object.assign(out, { found: 0, family: 0, n: 0, H: null, observation: null, format: UNKNOWN });
const clearAlignment = (out, samples, visible) => {
  samples.fill(0); visible.fill(0);
  Object.assign(out, { gatePassed: 0, weightQ15: 0, visibleCount: 0, matchCount: 0, mismatchCount: 0, distrusted: 0 });
};

export function samplePlanarLayoutInto(field, H, bound, faceLuma, visibleCells) {
  faceLuma.fill(0); visibleCells.fill(0);
  const count = Math.min(bound.cellCount, visibleCells.length, Math.floor(faceLuma.length / 3));
  let visibleCount = 0;
  for (let index = 0; index < count; index++) {
    const sample = sampleHexCell(field, { H }, bound.cellCoord[2 * index], bound.cellCoord[2 * index + 1]);
    if (!sample.ok) continue;
    for (let face = 0; face < 3; face++) {
      faceLuma[3 * index + face] = Math.max(0, Math.min(255, Math.round(sample[FACES[face]].median * 255)));
    }
    visibleCells[index] = 1; visibleCount++;
  }
  return visibleCount;
}

export function createPlanarAdapters(options = {}) {
  if (options.sharedCentralN7 && (typeof options.sharedCentralN7.acquire !== 'function'
    || typeof options.sharedFrame !== 'function')) throw new TypeError('공유 획득에는 공통 frame 공급자가 필요해요');
  const sources = options.sources ?? PLANAR_FINDER_SOURCES;
  if (!Array.isArray(sources) || sources.length === 0 || new Set(sources).size !== sources.length
    || sources.some(source => !PLANAR_FINDER_SOURCES.includes(source))) throw new TypeError('유효한 평면 광학 소스가 필요해요');
  const limits = { maxAgeFrames: 64, maxAgeMs: 10000, ...(options.acquisitionLimits ?? {}) };
  const policy = normalizeAcquisitionPolicy(options.acquisitionPolicy);
  const journal = createAcquisitionJournal(policy);
  if (!Number.isSafeInteger(limits.maxAgeFrames) || limits.maxAgeFrames < 1
    || !Number.isFinite(limits.maxAgeMs) || limits.maxAgeMs <= 0) throw new TypeError('유한 획득 수명이 필요해요');
  let generation = 1, acquisition = 0, frame = null, frameOrdinal = 0, externalGeneration;
  let job = null, lastDetection = null, lastPublished = null, afterSharedOrigin = null;
  const observations = new WeakMap(), states = new Set();
  const stats = { frames: 0, finders: 0, geometry: 0, formatReads: 0, formatRejects: 0,
    reservationRejects: 0, published: 0, binds: 0, rebaseRejects: 0,
    candidateRejects: 0, sampleComputations: 0, sampleCacheHits: 0,
    scanComplete: false, source: null, lastDetectMs: 0, maxUnitMs: 0,
    units: 0, budgetOverrunMs: 0, expirations: 0, trackingMs: 0, sampleMs: 0, snapshotMs: 0, snapshotBytes: 0,
    refinements: 0, refineUnits: 0, refineMs: 0, exactFrameRefreshes: 0, sourceOuterWorkMs: 0 };
  Object.defineProperty(stats, 'acquisition', { enumerable: true, get: () => journal.snapshot() });
  function disposeState(state, reason) {
    if (state.invalidated) return;
    state.invalidated = reason; state.tracker.discard(reason); state.cache = null; state.previous = null;
    states.delete(state);
  }
  function closeJob(reason) {
    journal.close(job?.work, reason);
    if (policy.mode === 'work' && job?.shared) afterSharedOrigin = job.shared.lease.origin;
    job?.iterator.return?.();
    job?.shared?.lease.release();
    job = null; stats.snapshotBytes = 0;
    if (lastPublished) {
      const own = observations.get(lastPublished);
      if (own && !own.leased) own.candidate.dispose();
    }
    lastPublished = null;
    if (reason === 'reset' || policy.mode === 'work') stats.scanComplete = false;
  }
  function reset() {
    closeJob('reset');
    for (const state of [...states]) disposeState(state, 'reset');
    generation++; frame = lastDetection = null; frameOrdinal = 0; externalGeneration = undefined;
    afterSharedOrigin = null;
  }
  function beginFrame(luma, width, height, timestamp, pose) {
    const field = { width, height, data: luma?.data ?? luma, alpha: luma?.alpha ?? pose?.alpha ?? null };
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
      || !(field.data instanceof Float32Array) || field.data.length !== width * height
      || !Number.isFinite(timestamp) || (field.alpha && (!(field.alpha instanceof Uint8Array) || field.alpha.length !== field.data.length))) {
      throw new TypeError('정규화된 현재 휘도 프레임이 필요해요');
    }
    const current = { width, height, timestamp, frameId: pose?.frameId ?? timestamp, generation };
    if (!(typeof current.frameId === 'string' || Number.isSafeInteger(current.frameId))) throw new TypeError('프레임 identity가 필요해요');
    if (frame && (width !== frame.width || height !== frame.height || timestamp < frame.timestamp
      || (pose?.generation !== undefined && externalGeneration !== undefined && pose.generation !== externalGeneration))) reset();
    if (pose?.generation !== undefined) externalGeneration = pose.generation;
    current.generation = generation;
    if (!equalFrame(frame, current)) { frameOrdinal++; stats.frames++; }
    frame = current;
    return field;
  }
  function measure(field, H, bound) {
    const start = performance.now();
    const samples = new Uint8Array(bound.cellCount * 3), visible = new Uint8Array(bound.cellCount);
    const visibleCount = samplePlanarLayoutInto(field, H, bound, samples, visible);
    stats.sampleComputations++; stats.sampleMs += performance.now() - start;
    return { samples, visible, visibleCount, raw: snapshotCubeYObservation(samples, visible, 3) };
  }
  function makeCandidate(hypothesis, bound, format, origin, snapshot, initial = measure(snapshot, hypothesis.H, bound)) {
    const state = { H: hypothesis.H.slice(), generation, invalidated: null, revision: 0,
      tracker: createCBodyTracker(snapshot, hypothesis.H, hypothesis.k,
        { minNcc: DEFAULT_CUBE_Y_CONTINUITY.minTrackedNcc, origin }),
      previous: initial.raw, last: { ...origin }, cache: { ...initial, frame: { ...origin } },
      hypothesis: { profile: hypothesis.profile, k: hypothesis.k }, format, bound };
    states.add(state);
    const candidate = Object.freeze({ key: bound.key, bound, generation,
      get H() { return state.H?.slice() ?? null; }, get revision() { return state.revision; },
      get invalidated() { return state.invalidated; }, get format() { return state.format; },
      dispose() { disposeState(state, 'disposed'); },
      alignInto(luma, width, height, timestamp, pose, _detection, output, faceLuma, visibleCells) {
        clearAlignment(output, faceLuma, visibleCells);
        const field = beginFrame(luma, width, height, timestamp, pose);
        if (state.invalidated || state.generation !== generation) return;
        const started = performance.now();
        const tracked = state.tracker.observe(field, frame);
        stats.trackingMs += performance.now() - started;
        if (!tracked.ok) { stats.candidateRejects++; disposeState(state, tracked.reason); return; }
        // 추적기가 소유한 이전 영상과 현재 전체 픽셀/alpha의 항등을 확인한 경우에만
        // 그 H의 포맷·예약·표본 증명을 재사용한다. timestamp나 버퍼 참조 동일성은 근거가 아니다.
        if (tracked.samePixels && state.cache) {
          state.cache.frame = { ...frame }; state.last = { ...frame };
        }
        if (!state.cache || !equalFrame(state.cache.frame, frame)) {
          state.H = tracked.H; state.revision++;
          const currentHypothesis = { ...state.hypothesis, H: state.H };
          const read = readPlanarFormats(field, currentHypothesis); stats.formatReads++;
          // 못 읽은 포맷은 모순이 아니에요. 그 프레임의 누적만 보류해요.
          if (!read.ok) { stats.formatRejects++; state.cache = null; return; }
          if (!read.formats.some(next => r2FormatAllowsCandidate(bound.key, next))) {
            disposeState(state, 'format-contradiction'); return;
          }
          if (!planarReservationProven(field, currentHypothesis, format)) {
            stats.reservationRejects++; state.cache = null; return;
          }
          const current = measure(field, state.H, bound);
          if (!tracked.samePixels) {
            const continuity = compareCubeYObservations(state.previous, current.raw);
            if (!continuity.ok) { stats.candidateRejects++; disposeState(state, continuity.reason); return; }
            current.continuity = continuity;
          }
          state.cache = { ...current, frame: { ...frame } }; state.previous = current.raw; state.last = { ...frame };
        } else stats.sampleCacheHits++;
        const count = Math.min(bound.cellCount, visibleCells.length, Math.floor(faceLuma.length / 3));
        faceLuma.set(state.cache.samples.subarray(0, count * 3)); visibleCells.set(state.cache.visible.subarray(0, count));
        let visibleCount = 0; for (let index = 0; index < count; index++) visibleCount += visibleCells[index];
        Object.assign(output, { visibleCount, gatePassed: visibleCount > 0 ? 1 : 0,
          weightQ15: visibleCount > 0 ? Q15_ONE : 0,
          matchCount: state.cache.continuity?.matches ?? visibleCount,
          mismatchCount: state.cache.continuity?.contradictions ?? 0 });
      },
    });
    return candidate;
  }
  function* boundSteps(snapshot, origin, shared = null, accounting = null, work = null) {
    for (const hypothesis of planarGeometrySteps(snapshot, origin, stats, sources, shared, accounting)) {
      if (!hypothesis) { yield null; continue; }
      stats.geometry++;
      journal.event(work, 'hypotheses'); journal.event(work, 'formatReads');
      const read = readPlanarFormats(snapshot, hypothesis); stats.formatReads++;
      if (!read.ok) { stats.formatRejects++; yield null; continue; }
      yield null;
      for (const { profile, format } of read.bindings) {
        const bound = profile.bind({ ...format, dimension: hypothesis.k, tones: 3,
          orientation: hypothesis.orientation, sourceIdentity: hypothesis.sourceIdentity });
        if (!bound) continue;
        let geometry = hypothesis, initial = measure(snapshot, hypothesis.H, bound);
        let reservation = planarReservationProven(snapshot, geometry, format);
        yield null;
        if (!reservation) {
          const refined = yield* refineSagoaeGeometrySteps(snapshot, geometry.H, hypothesis.k);
          if (refined) {
            geometry = { ...hypothesis, H: refined.H, sourceKind: `${hypothesis.sourceKind}-sagoae` };
            const checked = readPlanarFormats(snapshot, geometry); stats.formatReads++;
            if (!checked.formats.some(next => r2FormatAllowsCandidate(bound.key, next))) {
              stats.formatRejects++; yield null; continue;
            }
            initial = measure(snapshot, geometry.H, bound); reservation = true; stats.refinements++;
            yield null;
          }
        }
        // 중앙 블록의 몇 % 척도 오차는 바깥 본문에서 크게 벌어져요. 포맷/원문으로
        // 보정하지 않고 기존 CQ와 같은 영상 구조 점수만 최적화한 뒤 모두 재검증해요.
        if (['n7', 'qr'].includes(hypothesis.sourceKind) && (!reservation
          || initial.raw.margins.some((margin, index) => initial.visible[index]
            && margin < DEFAULT_CUBE_Y_CONTINUITY.minImmediateMargin))) {
          const cursor = createCqStructuralRefineCursor(snapshot, geometry.H, bound.cellCoord, origin);
          try {
            while (cursor.status.phase !== 'done') {
              const at = performance.now(); cursor.resume(origin);
              stats.refineUnits++; stats.refineMs += performance.now() - at;
              yield null;
            }
            const refined = cursor.takeForFrame(origin);
            if (refined) {
              const proposed = { ...geometry, H: refined.H, sourceKind: `${geometry.sourceKind}-structural` };
              const checked = readPlanarFormats(snapshot, proposed); stats.formatReads++;
              if (!checked.formats.some(next => r2FormatAllowsCandidate(bound.key, next))) {
                stats.formatRejects++; yield null; continue;
              }
              // 고리 정합을 통과한 H를 본문 점수만 좋은 미검증 H로 교체하지 않아요.
              const proposedReservation = planarReservationProven(snapshot, proposed, format);
              if (proposedReservation || !reservation) {
                geometry = proposed; reservation = proposedReservation;
                initial = measure(snapshot, geometry.H, bound); stats.refinements++;
              }
              yield null;
            }
          } finally { cursor.discard('planar-refine-closed'); }
        }
        if (!reservation) { stats.reservationRejects++; yield null; continue; }
        yield { hypothesis: geometry, bound, format, origin, snapshot, initial };
      }
    }
  }
  function detectInto(luma, width, height, timestamp, pose, output) {
    const started = performance.now(), field = beginFrame(luma, width, height, timestamp, pose);
    clearOutput(output);
    const budgetMs = pose?.budgetMs ?? options.budgetMs ?? Infinity;
    const maxUnits = options.maxWorkUnits ?? Infinity;
    if (!(budgetMs === Infinity || (Number.isFinite(budgetMs) && budgetMs >= 0))
      || !(maxUnits === Infinity || (Number.isSafeInteger(maxUnits) && maxUnits >= 0))) throw new TypeError('유효한 관측 예산이 필요해요');
    if (equalFrame(lastDetection, frame) || budgetMs === 0 || maxUnits === 0) return;
    lastDetection = { ...frame };
    if (lastPublished) {
      const own = observations.get(lastPublished);
      if (own && !own.leased) own.candidate.dispose();
      lastPublished = null;
    }
    if (job) journal.observe(job.work, job.shared ? options.sharedFrame() : { ...frame, ordinal: frameOrdinal });
    if (job && journal.reason(job.work)) { stats.expirations++; closeJob(journal.reason(job.work)); }
    if (policy.mode === 'age' && job && (frameOrdinal - job.fresh.ordinal > limits.maxAgeFrames || timestamp - job.fresh.timestamp > limits.maxAgeMs)) {
      // 옛 포즈를 새 영상으로 간주하지 않아요. 전체 픽셀·alpha가 실제로 같은 경우만
      // 현재에도 동일한 원본임을 재확인해요. 공개 provenance의 origin은 바꾸지 않아요.
      if (samePixels(field, job.snapshot)) {
        job.fresh = { ordinal: frameOrdinal, timestamp }; stats.exactFrameRefreshes++;
      } else { stats.expirations++; closeJob('expired'); }
    }
    if (!job) {
      if (stats.scanComplete) return;
      const snapshotAt = performance.now();
      const shared = options.sharedCentralN7 && sources.includes('n7')
        ? { lease: options.sharedCentralN7.acquire(field, options.sharedFrame(), { afterOrigin: afterSharedOrigin }), current: options.sharedFrame } : null;
      if (shared && !shared.lease) return;
      const snapshot = shared?.lease.snapshot ?? ownField(field);
      stats.snapshotMs += performance.now() - snapshotAt;
      const origin = Object.freeze({ ...(shared?.lease.origin ?? frame), generation,
        acquisition: ++acquisition, ordinal: shared?.lease.origin.ordinal ?? frameOrdinal });
      const accounting = createPlanarWorkAccounting();
      job = { snapshot, origin, shared, accounting, fresh: { ordinal: frameOrdinal, timestamp },
        work: journal.begin(origin, 'geometry', performance.now() - snapshotAt),
        iterator: null };
      job.iterator = boundSteps(snapshot, origin, shared, accounting, job.work);
      stats.snapshotBytes = snapshot.data.byteLength + (snapshot.alpha?.byteLength ?? 0);
    }
    let units = 0;
    try {
      while (units < maxUnits && performance.now() - started < budgetMs) {
        const unitAt = performance.now();
        const activeJob = job, accounting = activeJob.accounting;
        if (journal.reason(activeJob.work)) { stats.expirations++; closeJob(journal.reason(activeJob.work)); break; }
        accounting.beginUnit();
        try {
        const next = job.iterator.next();
        if (next.done) { stats.scanComplete = true; closeJob('complete'); break; }
        if (!next.value) continue;
        const row = next.value, candidate = makeCandidate(row.hypothesis, row.bound, row.format, row.origin, row.snapshot, row.initial);
        journal.event(activeJob.work, 'candidateReady');
        const samples = new Uint8Array(row.bound.cellCount * 3), visible = new Uint8Array(row.bound.cellCount), aligned = {};
        candidate.alignInto(field, width, height, timestamp, { ...pose, frameId: frame.frameId }, candidate, aligned, samples, visible);
        if (candidate.invalidated || aligned.gatePassed !== 1) {
          stats.rebaseRejects++; journal.event(activeJob.work, 'currentRejected'); candidate.dispose(); continue;
        }
        journal.event(activeJob.work, 'currentAccepted');
        const observation = Object.freeze({ sourceKind: row.hypothesis.sourceKind,
          sourceIdentity: row.bound.key.sourceIdentity, profile: row.bound.key.profile, k: row.bound.dimension,
          originFrameId: row.origin.frameId, originTimestamp: row.origin.timestamp,
          get H() { return candidate.H; } });
        observations.set(observation, { candidate, format: row.format, leased: false });
        lastPublished = observation; stats.published++;
        Object.assign(output, { found: 1, family: FAMILY_PLANAR, n: row.bound.dimension, H: candidate.H,
          observation, format: row.format, layoutId: row.bound.layoutId });
        break;
        } finally {
          // next()뿐 아니라 후보 표본·추적기 복사·현재-frame priming까지 같은 원자예요.
          const elapsed = Math.max(0, performance.now() - unitAt);
          stats.sourceOuterWorkMs += accounting.finishUnit(elapsed);
          stats.maxUnitMs = Math.max(stats.maxUnitMs, elapsed);
          stats.units++; units++;
          journal.charge(activeJob.work, elapsed, 1, stats.source ?? 'geometry');
        }
      }
    } finally {
      stats.lastDetectMs = performance.now() - started;
      if (Number.isFinite(budgetMs)) stats.budgetOverrunMs += Math.max(0, stats.lastDetectMs - budgetMs);
    }
  }
  function bindCandidate(observation, format) {
    const own = observations.get(observation);
    if (!own || own.leased || own.candidate.invalidated || !r2FormatAllowsCandidate(own.candidate.key, format)) return null;
    own.leased = true; stats.binds++; return own.candidate;
  }
  function invalidateLock() { closeJob('invalidate'); stats.scanComplete = false; lastDetection = null; afterSharedOrigin = null; }
  return Object.freeze({ detectInto, bindCandidate, reset, invalidateLock, stats,
    managesAcquisitionLifetime: policy.mode === 'work' });
}
