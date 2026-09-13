/**
 * shared-central-n7.js — 한 원본 프레임에서 중앙 n=7 획득을 소비자끼리 공유한다.
 *
 * 이 모듈은 R2 소비자 사이의 수명/소유 경계만 맡는다. Y locator의 옵션·결과를
 * 섞지 않고, 실제 관측은 기존 verified cursor → n7 block cursor → tone/payload
 * 경로를 그대로 사용한다.
 */
import { createVerifiedCursorPrototypeV3 } from '../decoder/cs-verified-cursor-v3-prototype.js';
import { createCentralN7BlockCursor } from '../decoder/cellsurface-block-detect.js';
import {
  centralN7CenterPriorSeeds,
  centralN7FindersFromShapes,
} from '../decoder/central-n7-observe.js';
import { BEACON_CS_BLOCK_LOCATOR } from '../decoder/central-beacon-observation-shared.js';
import { normalizeAcquisitionPolicy, createAcquisitionJournal } from './acquisition-lifetime.js';

function clone(value) {
  return structuredClone(value);
}

function assertCurrent(current) {
  if (!current || !Number.isInteger(current.width) || !Number.isInteger(current.height)
    || current.width <= 0 || current.height <= 0 || current.generation == null
    || !Number.isFinite(current.timestamp)
    || !(typeof current.frameId === 'string' || Number.isSafeInteger(current.frameId))
    || !(typeof current.generation === 'string' || Number.isSafeInteger(current.generation))
    || !Number.isSafeInteger(current.ordinal) || current.ordinal < 0) {
    throw new TypeError('frameId·timestamp·generation·width·height가 있는 current가 필요해요');
  }
}

function assertField(field, current) {
  if (!field || field.width !== current.width || field.height !== current.height
    || !(field.data instanceof Float32Array)
    || field.data.length !== current.width * current.height
    || (field.alpha && (!(field.alpha instanceof Uint8Array) || field.alpha.length !== field.data.length))) {
    throw new TypeError('current와 같은 크기의 Float32 LumaField가 필요해요');
  }
}

function identityOf(current) {
  return Object.freeze({
    frameId: current.frameId,
    timestamp: current.timestamp,
    generation: current.generation,
    width: current.width,
    height: current.height,
    ordinal: current.ordinal,
  });
}

function sameEpoch(origin, current) {
  return origin.width === current.width && origin.height === current.height
    && origin.generation === current.generation;
}

function ageReason(origin, current, maxAgeFrames, maxAgeMs, lastTimestamp) {
  if (!sameEpoch(origin, current)) return 'resize-or-generation';
  if (current.timestamp < origin.timestamp || current.timestamp < lastTimestamp) return 'time-reversal';
  if (current.ordinal < origin.ordinal || current.ordinal - origin.ordinal > maxAgeFrames) return 'age-frames';
  if (current.timestamp - origin.timestamp > maxAgeMs) return 'age-ms';
  return null;
}

function cursorOptions(timing) {
  return {
    timing,
    calibration: { csBlockLocator: BEACON_CS_BLOCK_LOCATOR },
  };
}

/**
 * @param {{maxAgeFrames?:number,maxAgeMs?:number}} options
 */
export function createSharedCentralN7Pool({ maxAgeFrames = 64, maxAgeMs = 10_000, acquisitionPolicy } = {}) {
  if (!Number.isSafeInteger(maxAgeFrames) || maxAgeFrames < 0
    || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new TypeError('maxAgeFrames/maxAgeMs는 음이 아닌 유한 수명이어야 해요');
  }

  const policy = normalizeAcquisitionPolicy(acquisitionPolicy);
  const journal = createAcquisitionJournal(policy);
  let job = null;
  const metrics = {
    copies: 0,
    copyBytes: 0,
    cursorCopyBytes: 0,
    steps: 0,
    joins: 0,
    jobs: 0,
    maxUnitMs: 0,
    copyMs: 0,
    serviceMs: 0,
    exactFrameRefreshes: 0,
  };

  function updateMax(ms) {
    if (Number.isFinite(ms)) metrics.maxUnitMs = Math.max(metrics.maxUnitMs, ms);
  }

  function retainedBytes() {
    if (!job || job.invalidated) return 0;
    let bytes = job.snapshot.data.byteLength + (job.snapshot.alpha?.byteLength || 0);
    if (job.n7Cursor) bytes += job.n7Cursor.status.snapshotRetainedBytes || 0;
    // verified cursor는 done 전 snapshot을 보유한다. status의 snapshotBytes는 원래
    // 크기이므로 phase가 done/discarded인 뒤에는 더하지 않는다.
    if (job.verifiedCursor && !['done', 'discarded'].includes(job.verifiedCursor.status.phase)) {
      bytes += job.verifiedCursor.status.snapshotBytes || 0;
    }
    return bytes;
  }

  function invalidate(target, reason) {
    if (!target || target.invalidated) return;
    journal.close(target.work, reason);
    target.invalidated = reason;
    target.verifiedCursor?.discard(reason);
    target.n7Cursor?.discard(reason);
    target.snapshot = target.finders = target.verifiedCursor = target.n7Cursor = null;
  }

  function makeJob(field, current) {
    const copyAt = performance.now();
    const origin = identityOf(current);
    const snapshot = {
      width: field.width,
      height: field.height,
      data: field.data.slice(),
      alpha: field.alpha?.slice() || null,
    };
    const copyBytes = snapshot.data.byteLength + (snapshot.alpha?.byteLength || 0);
    metrics.copyMs += performance.now() - copyAt;
    const target = {
      origin,
      fresh: origin,
      snapshot,
      verifiedCursor: null,
      n7Cursor: null,
      finders: null,
      leases: 0,
      lastTimestamp: origin.timestamp,
      invalidated: null,
      work: journal.begin(origin, 'verified'),
    };
    const timing = ({ ms }) => updateMax(ms);
    target.verifiedCursor = createVerifiedCursorPrototypeV3(snapshot, origin, cursorOptions(timing));
    metrics.copies += 1;
    metrics.copyBytes += copyBytes;
    metrics.cursorCopyBytes += target.verifiedCursor.status.snapshotBytes;
    metrics.jobs += 1;
    journal.charge(target.work, performance.now() - copyAt, 0);
    return target;
  }

  function lifetimeReason(target, current) {
    const reason = ageReason(target.fresh, current,
      policy.mode === 'age' ? maxAgeFrames : Infinity,
      policy.mode === 'age' ? maxAgeMs : Infinity, target.lastTimestamp);
    if (reason) return reason;
    return target.finders ? null : journal.reason(target.work);
  }

  function measuredAdvance(target, current) {
    const at = performance.now();
    let state;
    try { return state = advance(target, current); }
    finally {
      journal.charge(target.work, performance.now() - at, state?.state === 'invalidated' ? 0 : 1,
        target.finders ? 'done' : target.n7Cursor ? 'n7' : 'verified');
    }
  }

  function advance(target, current) {
    const reason = lifetimeReason(target, current);
    if (reason) {
      invalidate(target, reason);
      return { state: 'invalidated', reason };
    }
    target.lastTimestamp = current.timestamp;
    if (target.finders) {
      return { state: 'done', originFrameId: target.origin.frameId, currentFrameUsable: false };
    }
    if (target.verifiedCursor.status.phase !== 'done') {
      const state = target.verifiedCursor.resume(current);
      metrics.steps += 1;
      updateMax(state.ms);
      return state;
    }
    if (!target.n7Cursor) {
      const verified = target.verifiedCursor.takeForFrame(target.origin);
      const seeds = centralN7CenterPriorSeeds(target.snapshot, verified?.verified || []);
      const timing = ({ ms }) => updateMax(ms);
      target.n7Cursor = createCentralN7BlockCursor(target.snapshot, seeds, target.origin, cursorOptions(timing));
      metrics.cursorCopyBytes += target.n7Cursor.status.snapshotBytes;
    }
    if (target.n7Cursor.status.phase !== 'done') {
      const state = target.n7Cursor.resume(current);
      metrics.steps += 1;
      updateMax(state.ms);
      return state;
    }
    const observed = target.n7Cursor.takeForFrame(target.origin);
    target.finders = Object.freeze(centralN7FindersFromShapes(target.snapshot, observed?.shapes || []));
    return { state: 'done', originFrameId: target.origin.frameId, currentFrameUsable: false };
  }

  function makeLease(target) {
    let released = false;
    let stale = null;
    target.leases += 1;
    return Object.freeze({
      get snapshot() { return released || target.invalidated ? null : target.snapshot; },
      get origin() { return clone(target.origin); },
      get fresh() { return clone(target.fresh); },
      get status() {
        return {
          state: stale || target.invalidated || (target.finders ? 'done' : 'active'),
          origin: clone(target.origin),
          released,
          currentFrameUsable: false,
        };
      },
      resume(current) {
        if (released) return { state: 'released', reason: 'lease-released' };
        if (stale || target.invalidated) return { state: 'stale', reason: stale || target.invalidated };
        assertCurrent(current);
        journal.observe(target.work, current);
        const at = performance.now();
        try {
          const state = measuredAdvance(target, current);
          if (state.state === 'invalidated') stale = state.reason;
          // verified 또는 n7 하위 cursor의 done은 전체 획득의 done이 아니에요.
          return { ...state, stage: state.state, state: target.finders ? 'done'
            : stale ? 'invalidated' : 'active', currentFrameUsable: false };
        } finally { const ms = performance.now() - at; metrics.serviceMs += ms; updateMax(ms); }
      },
      resumeBatch(current, { budgetMs, maxSteps = Infinity } = {}) {
        if (!(budgetMs === Infinity || Number.isFinite(budgetMs) && budgetMs >= 0)
          || !(maxSteps === Infinity || Number.isSafeInteger(maxSteps) && maxSteps >= 0)) {
          throw new TypeError('batch에는 음이 아닌 예산/원자 수가 필요해요');
        }
        const empty = state => ({ state, stage: null, steps: 0, batchMs: 0,
          maxUnitMs: 0, maxUnitStage: null, lastProgress: null, currentFrameUsable: false });
        if (released) return empty('released');
        if (stale || target.invalidated) return { ...empty('stale'), reason: stale || target.invalidated };
        assertCurrent(current);
        journal.observe(target.work, current);
        const at = performance.now(), deadline = at + budgetMs;
        let steps = 0, maxUnitMs = 0, maxUnitStage = null, lastProgress = null, batchMs = 0;
        try {
          // 같은 current의 원자 호출을 묶어 소비자별 재검사/객체 복사/진단 갱신을
          // 매번 왕복하지 않아요. 중단 경계와 snapshot/age 검사는 그대로예요.
          while (steps < maxSteps && performance.now() < deadline) {
            const unitAt = performance.now();
            lastProgress = measuredAdvance(target, current);
            const unitMs = performance.now() - unitAt;
            if (unitMs > maxUnitMs) { maxUnitMs = unitMs; maxUnitStage = lastProgress.unit ?? lastProgress.state; }
            updateMax(unitMs); steps++;
            if (lastProgress.state === 'invalidated') stale = lastProgress.reason;
            if (stale || target.finders) break;
          }
        } finally {
          batchMs = performance.now() - at;
          metrics.serviceMs += batchMs;
        }
        return { state: target.finders ? 'done' : stale ? 'invalidated' : 'active',
          stage: lastProgress?.state ?? null, reason: stale, steps, batchMs, maxUnitMs, maxUnitStage,
          lastProgress, currentFrameUsable: false };
      },
      readOrigin() {
        if (released || stale || target.invalidated || !target.finders) return null;
        return { origin: clone(target.origin), finders: clone(target.finders) };
      },
      release() {
        if (released) return false;
        released = true;
        target.leases -= 1;
        if (target.leases < 0) throw new Error('shared n7 lease refcount underflow');
        if (target.leases === 0 && job === target) {
          invalidate(target, 'all-leases-released');
          job = null;
        }
        return true;
      },
    });
  }

  return Object.freeze({
    acquire(field, current, { afterOrigin = null } = {}) {
      assertCurrent(current);
      assertField(field, current);
      if (job) {
        const reason = lifetimeReason(job, current);
        if (reason || job.invalidated) {
          invalidate(job, reason || job.invalidated);
          job = null;
        } else {
          // 완료한 소비자는 같은 원본에 재가입해 수명을 영구 연장하지 않아요.
          // 남은 소비자의 유한 작업은 취소하지 않고 마지막 release를 기다려요.
          if (afterOrigin && Object.keys(job.origin).every(key => Object.is(job.origin[key], afterOrigin[key]))) return null;
          // join 자체도 시간 순서가 있는 관측이다. 뒤 consumer가 본 더 새 frame보다
          // 과거 current를 다음 resume에서 받아들이면 원본 continuity가 거꾸로 흐른다.
          job.lastTimestamp = current.timestamp;
          journal.observe(job.work, current);
          metrics.joins += 1;
          return makeLease(job);
        }
      }
      const at = performance.now();
      job = makeJob(field, current);
      updateMax(performance.now() - at);
      return makeLease(job);
    },
    observeFrame(field, current) {
      assertCurrent(current); assertField(field, current);
      if (!job || job.invalidated) return;
      journal.observe(job.work, current);
      const reason = lifetimeReason(job, current);
      job.lastTimestamp = current.timestamp;
      if (!reason) return;
      const at = performance.now();
      try {
        let same = ['age-frames', 'age-ms'].includes(reason) && sameEpoch(job.origin, current)
          && !!job.snapshot.alpha === !!field.alpha;
        if (same) for (let i = 0; i < field.data.length; i++) {
          if (!Object.is(field.data[i], job.snapshot.data[i])
            || field.alpha && field.alpha[i] !== job.snapshot.alpha[i]) { same = false; break; }
        }
        if (same) { job.fresh = identityOf(current); job.lastTimestamp = current.timestamp; metrics.exactFrameRefreshes++; }
        else invalidate(job, reason);
      } finally { const ms = performance.now() - at; metrics.serviceMs += ms; updateMax(ms); }
    },
    reset() {
      if (job) invalidate(job, 'reset');
      job = null;
    },
    get acquisitionPending() { return !!job && !job.invalidated && !job.finders; },
    get stats() {
      return Object.freeze({ ...metrics, retainedBytes: retainedBytes(), acquisition: journal.snapshot() });
    },
  });
}
