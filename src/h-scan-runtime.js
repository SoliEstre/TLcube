/**
 * H 검출과 부분면 수집을 카메라 프레임에 연결해요.
 * route 8bit는 분류 힌트이고, 본문 수용은 collector의 RS/CRC DONE만 믿어요.
 */
import { detectH } from './h-detect.js';
import { createHCollector, hObservationProfile } from './h-collector.js';

const clone = (value) => structuredClone(value);
const RECENT_H_MS = 500;
// 완료 변환기가 만든 객체만 인정해요. worker 메시지나 문자열 source만으로 권한을 넓히지 않아요.
const verifiedHDecodeResults = new WeakSet();
export function isVerifiedHDecodeResult(result) { return verifiedHDecodeResults.has(result); }

function assertInterval(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 5000) {
    throw new RangeError(`${name} 은 0..5000 ms여야 해요`);
  }
  return value;
}

function assertFrame(field, timestamp, frameId) {
  if (!field || !Number.isInteger(field.width) || !Number.isInteger(field.height)
    || field.width < 1 || field.height < 1 || field.width * field.height > 4_000_000
    || !(field.data instanceof Float32Array)
    || field.data.length !== field.width * field.height) {
    throw new TypeError('H 입력 field가 필요해요');
  }
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError('유효한 timestamp가 필요해요');
  if (!(typeof frameId === 'string' || Number.isSafeInteger(frameId))) {
    throw new TypeError('유효한 frameId가 필요해요');
  }
}

function poseOf(obs) {
  return {
    face: obs.face,
    quad: obs.quad ? obs.quad.map((p) => ({ x: p.x, y: p.y })) : null,
    H: obs.H ? Float64Array.from(obs.H) : null,
    rotation: obs.rotation,
    quality: obs.quality ? { ...obs.quality } : null,
    version: obs.version,
    n: obs.n,
    mode: obs.mode,
    finder:obs.finder??'frame',
    tones: obs.tones,
    ecc: obs.ecc,
    mask: obs.mask,
    routeId: obs.routeId,
  };
}

function stripAssembly(row) {
  const copy = {
    id: row.id,
    state: row.state,
    profile: row.profile ? { ...row.profile } : null,
    trackId: row.trackId,
    count: row.count,
    present: row.present ? row.present.slice() : [],
    missing: row.missing ? row.missing.slice() : [],
    lastValidAt: row.lastValidAt,
    expiresAt: row.expiresAt,
    faceExpiresAt: { ...row.faceExpiresAt },
  };
  if (row.variants) copy.variants = { ...row.variants };
  if (row.lastDecodeFailure) copy.lastDecodeFailure = row.lastDecodeFailure;
  return copy;
}

function layoutIdFor(mode,finder) {
  if(mode===1)return `h-${finder==='corners'?'v2sc':'v2s'}-1f`;
  const legacy=mode===3||mode===6;
  return `h-${legacy?(finder==='corners'?'v2c':'v2'):(finder==='corners'?'v2fc':'v2f')}-${mode}f`;
}

function hitFromSnapshot(snapshot, frame) {
  if (snapshot.state !== 'DONE' || !snapshot.result || snapshot.result.ok !== true) return null;
  const result = snapshot.result;
  const lead = snapshot.assemblies?.find((row) => row.id === snapshot.leadingId) ?? snapshot.assemblies?.[0];
  const profile = lead?.profile ?? {};
  return {
    kind: 'h',
    profile: 'H',
    type: 'H',
    ok: true,
    text: result.text ?? null,
    bytes: result.bytes instanceof Uint8Array ? result.bytes.slice() : new Uint8Array(),
    version: profile.version,
    n: profile.n,
    mode: profile.mode,
    finder:profile.finder??'frame',
    tones: profile.tones,
    ecc: profile.ecc,
    mask: profile.mask,
    routeId: profile.routeId,
    crc: result.crc,
    correctedCount: result.corrected ?? 0,
    candidateId: snapshot.leadingId,
    layoutId: layoutIdFor(profile.mode,profile.finder),
    frame: {
      width: frame.width,
      height: frame.height,
      timestamp: frame.timestamp,
      frameId: frame.frameId,
    },
  };
}

export function createHScanRuntime(options = {}) {
  const detect = options.detect ?? detectH;
  const collector = options.collector ?? createHCollector();
  const coldIntervalMs = assertInterval('coldIntervalMs', options.coldIntervalMs ?? 200);
  const activeIntervalMs = assertInterval('activeIntervalMs', options.activeIntervalMs ?? 100);
  const sessionId = options.sessionId ?? 'camera';
  if (typeof detect !== 'function') throw new TypeError('detect 가 필요해요');
  if (!collector || typeof collector.addFrame !== 'function' || typeof collector.advance !== 'function') {
    throw new TypeError('collector.addFrame/advance 가 필요해요');
  }
  if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId 가 필요해요');
  let enabled = options.enabled !== false;
  let lastFrame = null;
  let lastDetectAt = -Infinity;
  let lastDetectMs = 0;
  let detectCalls = 0;
  let lastError = null;
  let lastDetection = null;
  let observedFaces = [];
  let observedAt = null;
  let frameWidth = 0;
  let frameHeight = 0;
  let snapshot = collector.snapshot(sessionId);
  let retryId = 0;
  const recentFrames = new Set();

  function intervalMs() {
    return snapshot.state === 'EMPTY' ? coldIntervalMs : activeIntervalMs;
  }

  function due(timestamp, force) {
    if (force === true) return true;
    if (lastDetectAt === -Infinity) return true;
    return timestamp - lastDetectAt >= intervalMs();
  }

  function publicStats() {
    const lead = snapshot.assemblies?.find((row) => row.id === snapshot.leadingId) ?? snapshot.assemblies?.[0];
    return {
      state: snapshot.state,
      count: snapshot.count,
      required: snapshot.required,
      missing: snapshot.missing ? snapshot.missing.slice() : [],
      present: lead?.present ? lead.present.slice() : [],
      profile: lead?.profile ? { ...lead.profile } : null,
      leadingId: snapshot.leadingId ?? null,
      assemblies: (snapshot.assemblies ?? []).map(stripAssembly),
      boundedObservedFaces: observedFaces.length,
      observedFaces: clone(observedFaces),
      observedAt,
      frameWidth,
      frameHeight,
      detectCalls,
      lastDetectMs,
      lastError,
      lastDetection: lastDetection ? clone(lastDetection) : null,
      stats: snapshot.stats ? { ...snapshot.stats } : null,
    };
  }

  function resetInternal() {
    collector.reset();
    lastFrame = null;
    lastDetectAt = -Infinity;
    lastDetectMs = 0;
    detectCalls = 0;
    lastError = null;
    lastDetection = null;
    observedFaces = [];
    observedAt = null;
    frameWidth = 0;
    frameHeight = 0;
    snapshot = collector.snapshot(sessionId);
    recentFrames.clear();
  }

  function pushFrame(field, timestamp, { frameId = String(timestamp), force = false } = {}) {
    if (!enabled) return null;
    assertFrame(field, timestamp, frameId);
    if (lastFrame && timestamp < lastFrame.timestamp) resetInternal();
    if (recentFrames.has(frameId)) {
      lastFrame = { timestamp, frameId, width: field.width, height: field.height };
      try { snapshot = collector.advance(timestamp); } catch { snapshot = collector.snapshot(sessionId); }
      return snapshot.state === 'DONE' ? clone(hitFromSnapshot(snapshot, lastFrame)) : null;
    }
    lastFrame = { timestamp, frameId, width: field.width, height: field.height };
    recentFrames.add(frameId);
    if (recentFrames.size > 128) recentFrames.delete(recentFrames.values().next().value);
    try { snapshot = collector.advance(timestamp); } catch { snapshot = collector.snapshot(sessionId); }
    if (!due(timestamp, force)) {
      return snapshot.state === 'DONE' ? clone(hitFromSnapshot(snapshot, lastFrame)) : null;
    }
    const detectAt = performance.now();
    let detected;
    try {
      detected = detect(field, { maxComponents: 128 });
      lastDetection = detected?.stats ? clone(detected.stats) : null;
      lastError = null;
    } catch (error) {
      lastError = String(error?.message ?? error);
      observedFaces = []; observedAt = null;
      lastDetectAt = timestamp;
      lastDetectMs = performance.now() - detectAt;
      detectCalls += 1;
      return null;
    }
    lastDetectAt = timestamp;
    lastDetectMs = performance.now() - detectAt;
    detectCalls += 1;
    const observations = Array.isArray(detected?.faces)
      ? detected.faces.slice(0, 24).filter((row) => hObservationProfile(row) !== null)
      : [];
    observedFaces = observations.map(poseOf);
    observedAt = timestamp;
    frameWidth = field.width;
    frameHeight = field.height;
    try {
      snapshot = observations.length
        ? collector.addFrame({ observations, timestamp, frameId, sessionId })
        : collector.advance(timestamp);
    } catch (error) {
      lastError = String(error?.message ?? error);
      return null;
    }
    return snapshot.state === 'DONE' ? clone(hitFromSnapshot(snapshot, lastFrame)) : null;
  }

  function reset() { resetInternal(); }

  // 이미 확보한 면 후보만 재검사해요. 새 영상 검출이나 관측 수명 연장은 없어요.
  function retryPending() {
    if (!enabled || !lastFrame || snapshot.state !== 'COLLECTING') return null;
    snapshot = collector.addFrame({ observations: [], timestamp: lastFrame.timestamp,
      frameId: `retry:${++retryId}`, sessionId });
    return snapshot.state === 'DONE' ? clone(hitFromSnapshot(snapshot, lastFrame)) : null;
  }

  function setEnabled(flag) {
    const next = flag === true;
    if (next === enabled) return;
    enabled = next;
    resetInternal();
  }

  function invalidateLock() {
    observedFaces = [];
    observedAt = null;
    lastDetectAt = -Infinity;
    snapshot = collector.snapshot(sessionId);
  }

  return Object.freeze({
    pushFrame,
    retryPending,
    reset,
    setEnabled,
    invalidateLock,
    get enabled() { return enabled; },
    get stats() { return clone(publicStats()); },
  });
}

export function hHitToDecodeResult(hit) {
  if (!hit || hit.kind !== 'h' || hit.ok !== true || hit.profile !== 'H') return null;
  if (typeof hit.text !== 'string' || !(hit.bytes instanceof Uint8Array)) return null;
  if (![1,2,3,4,5,6].includes(hit.mode)) return null;
  if (!Number.isInteger(hit.crc) || hit.crc < 0 || hit.crc > 0xffffffff) return null;
  const result = {
    ok: true,
    payload: hit.text,
    source: 'h',
    hSummary: {
      profile: 'H',
      version: hit.version,
      n: hit.n,
      mode: hit.mode,
      finder:hit.finder??'frame',
      tones: hit.tones,
      ecc: hit.ecc,
      mask: hit.mask,
      correctedCount: hit.correctedCount,
    },
  };
  verifiedHDecodeResults.add(result);
  return result;
}

export function createHCompositeEngine({
  yEngine,
  hRuntime = createHScanRuntime(),
  enabled = true,
} = {}) {
  if (!yEngine || typeof yEngine.pushFrame !== 'function') throw new TypeError('yEngine 이 필요해요');
  if (!hRuntime || typeof hRuntime.pushFrame !== 'function') throw new TypeError('hRuntime 이 필요해요');
  let on = enabled === true;
  let accepted = null;
  let compositeLastMs = 0;
  let hSkippedY = 0;
  let lastHObservedAt = -Infinity;

  function syncEnabled() {
    hRuntime.setEnabled?.(on);
    yEngine.setEnabled?.(on);
  }
  if ((yEngine.enabled === true) !== on || (hRuntime.enabled === true) !== on) syncEnabled();

  function pushFrame(field, timestamp, options = {}) {
    if (!on) return null;
    const at = performance.now();
    let hHit = null;
    let definiteH = false;
    let collectingH = false;
    try {
      const before = hRuntime.stats.detectCalls ?? 0;
      hHit = hRuntime.pushFrame(options.hField ?? field, timestamp, options);
      const after = hRuntime.stats;
      // 실제 collector가 검증한 부분면이 살아 있는 동안은 Y 누적을 멈춰요.
      // pushFrame이 먼저 만료를 정리하므로 TTL 만료·reset 뒤에는 자동으로 풀려요.
      collectingH = after.state === 'COLLECTING' && Number.isInteger(after.count)
        && after.count > 0 && [1,2,3,4,5,6].includes(after.required)
        && after.count <= after.required;
      if ((after.detectCalls ?? 0) > before && after.observedAt === timestamp
        && !after.lastError && (after.observedFaces?.length ?? 0) > 0) {
        definiteH = true;
        lastHObservedAt = timestamp;
      }
    } catch (error) {
      definiteH = false;
    }
    const recentH = Number.isFinite(lastHObservedAt) && timestamp - lastHObservedAt >= 0
      && timestamp - lastHObservedAt <= RECENT_H_MS;
    const skipY = collectingH || definiteH || recentH;
    let yHit = null;
    if (skipY) hSkippedY += 1;
    else yHit = yEngine.pushFrame(field, timestamp, options);
    compositeLastMs = performance.now() - at;
    let hit = null;
    if (definiteH || recentH) hit = hHit ?? yHit;
    else hit = yHit ?? hHit;
    if (hit) accepted = clone(hit);
    return hit ? clone(hit) : null;
  }

  function reset() {
    hRuntime.reset();
    yEngine.reset();
    accepted = null;
    lastHObservedAt = -Infinity;
    compositeLastMs = 0; hSkippedY = 0;
  }

  function setEnabled(flag) {
    const next = flag === true;
    if (next === on) return;
    on = next;
    syncEnabled();
    accepted = null;
    lastHObservedAt = -Infinity;
  }

  function invalidateLock() {
    hRuntime.invalidateLock();
    yEngine.invalidateLock();
    lastHObservedAt = -Infinity;
  }

  return Object.freeze({
    pushFrame,
    reset,
    setEnabled,
    invalidateLock,
    get enabled() { return on; },
    get stats() {
      const yStats = clone(yEngine.stats);
      return {
        ...yStats,
        h: { ...clone(hRuntime.stats), lastConfirmedAt: Number.isFinite(lastHObservedAt) ? lastHObservedAt : null },
        compositeLastMs,
        hSkippedY,
      };
    },
    get view() { return clone(yEngine.view); },
    get hudCandidates() { return clone(yEngine.hudCandidates); },
    get accepted() { return clone(accepted); },
  });
}
