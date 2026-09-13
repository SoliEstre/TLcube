/** 한 장 처리 + 최신 한 장 대기. 카메라 재기동/토글은 Worker 세대도 즉시 끊어요. */
import { R2_WORKER_ENTRY_URL } from './r2-worker-entry.js';
import { createR2RoutedEngine } from './r2-routed-engine.js';
import { createR2ScanRuntime } from './r2-scan-runtime.js';

const clone = value => structuredClone(value);
export function createR2WorkerRuntime(options = {}) {
  let enabled = options.enabled === true, generation = 1, requestId = 0, worker = null, fallback = null;
  let inFlight = null, pending = null, pendingHit = null, lastInput = null, lastCameraTimestamp = null;
  // 기본은 한 장만 처리한다. depth 2는 scanner의 명시적 lab opt-in에서만 열린다.
  const workerQueueDepth = options.workerQueueDepth === 2 ? 2 : 1;
  const rawNow = typeof options.now === 'function' ? options.now
    : (typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now());
  let lastNow = 0;
  // Date.now fallback과 test hook도 runtime 관측값을 역행시키지 못하게 한다.
  const now = () => {
    const value = Number(rawNow());
    if (Number.isFinite(value)) lastNow = Math.max(lastNow, value);
    return lastNow;
  };
  const empty = createR2ScanRuntime();
  let snapshot = { stats: clone(empty.stats), view: clone(empty.view), hudCandidates: [] };
  const metrics = { mode: 'worker', submitted: 0, processed: 0, dropped: 0, staleResults: 0,
    pendingDiscardedForHit: 0, pendingDiscardedForReset: 0,
    invalidated: 0, errors: 0, lastError: null, lastServiceMs: 0, maxServiceMs: 0, lastResultAgeMs: 0,
    lastQueueMs: 0, lastRoundTripMs: 0, lastTransportMs: 0 };
  const createWorker = options.createWorker ?? (url => new Worker(url, { type: 'module', name: 'tlscan-r2' }));
  const engineOptions = options.engineOptions ?? {};
  function clearSnapshot() { snapshot = { stats: clone(empty.stats), view: clone(empty.view), hudCandidates: [] }; }
  function discardPendingForReset() {
    if (pending) metrics.pendingDiscardedForReset++;
    pending = pendingHit = null;
  }
  function discardPendingForHit() {
    if (!pending) return;
    pending = null; metrics.pendingDiscardedForHit++;
  }
  function terminate() { worker?.terminate(); worker = null; inFlight = null; discardPendingForReset(); }
  function reset() {
    generation++; terminate(); fallback?.reset(); lastInput = lastCameraTimestamp = null; clearSnapshot();
  }
  function setEnabled(flag) {
    const next = flag === true; if (next === enabled) return;
    enabled = next; reset(); fallback?.setEnabled(enabled);
  }
  function invalidateLock() {
    generation++; discardPendingForReset(); lastInput = lastCameraTimestamp = null;
    for (const row of snapshot.hudCandidates) { row.tracking = false; row.retained = true; }
    if (fallback) { fallback.invalidateLock(); return; }
    if (!worker) return;
    // 메시지 순서상 이전 frame 뒤에서 락만 푼다. Y 누적 증거/선반은 보존해요.
    inFlight = { requestId: ++requestId };
    try { worker.postMessage({ type: 'invalidate', generation, requestId }); }
    catch (error) { fail(error); }
  }
  function fail(error) {
    metrics.errors++; metrics.lastError = String(error?.message ?? error);
    generation++; terminate(); clearSnapshot();
    metrics.mode = 'main-fallback';
    fallback = (options.createFallback ?? createR2RoutedEngine)({ ...engineOptions, enabled });
  }
  function timingFor(request, completedAt = now()) {
    const queueMs = Math.max(0, (request.dispatchedAt ?? completedAt) - request.queuedAt);
    const roundTripMs = Math.max(0, completedAt - (request.dispatchedAt ?? completedAt));
    const serviceMs = Number.isFinite(request.serviceMs) ? Math.max(0, request.serviceMs) : 0;
    return { queueMs, roundTripMs, transportMs: Math.max(0, roundTripMs - serviceMs) };
  }
  function recordTiming(timing) {
    metrics.lastQueueMs = timing.queueMs; metrics.lastRoundTripMs = timing.roundTripMs;
    metrics.lastTransportMs = timing.transportMs;
  }
  function processedEvent(base, timing) {
    const event = { ...base };
    // 기존 callback payload의 열거 키 계약은 보존하되 새 진단값은 같은 이벤트에서 읽을 수 있다.
    Object.defineProperties(event, {
      queueMs: { value: timing.queueMs, enumerable: false },
      roundTripMs: { value: timing.roundTripMs, enumerable: false },
      transportMs: { value: timing.transportMs, enumerable: false }
    });
    return event;
  }
  function onMessage(message) {
    if (!message || message.generation !== generation || message.requestId !== inFlight?.requestId) {
      metrics.staleResults++; return;
    }
    if (message.type === 'error') { fail(message.message); return; }
    if (message.type === 'invalidated') {
      inFlight = null; metrics.invalidated++; if (message.snapshot) snapshot = clone(message.snapshot);
      if (pending) { const next = pending; pending = null; dispatch(next); }
      return;
    }
    if (message.type !== 'result') return;
    const completed = inFlight;
    completed.serviceMs = message.serviceMs;
    const timing = timingFor(completed);
    inFlight = null; metrics.processed++; recordTiming(timing);
    metrics.lastServiceMs = message.serviceMs; metrics.maxServiceMs = Math.max(metrics.maxServiceMs, message.serviceMs);
    metrics.lastResultAgeMs = Math.max(0, (lastCameraTimestamp ?? message.timestamp) - message.timestamp);
    // Worker가 바쁠 때 캡처를 생략해도 카메라 기회는 계속 전진한다. 마지막으로 실제
    // 전송한 입력만 비교하면 오래된 관측을 현재 tracking으로 잘못 보이게 해요.
    snapshot = clone(message.snapshot);
    if (message.timestamp !== lastCameraTimestamp || message.frameId !== lastInput?.frameId) {
      for (const row of snapshot.hudCandidates) { row.tracking = false; row.retained = true; }
    }
    if (message.hit) {
      pendingHit = { hit: clone(message.hit), timestamp: message.timestamp, requestId: message.requestId };
      // 완료 hit는 다음 push에서 즉시 돌려줘야 한다. 이미 보관한 다음 frame을 여기서
      // 계수해 폐기하지 않으면 pushFrame이 그 frame을 조용히 지우고 새 캡처도 낭비한다.
      discardPendingForHit();
    }
    options.onProcessed?.(processedEvent({ frameId: message.frameId, timestamp: message.timestamp, serviceMs: message.serviceMs }, timing));
    if (!pendingHit && pending) { const next = pending; pending = null; dispatch(next); }
  }
  function ensureWorker() {
    if (worker || fallback) return;
    try {
      const currentWorker = createWorker(R2_WORKER_ENTRY_URL);
      worker = currentWorker;
      currentWorker.onmessage = event => onMessage(event.data);
      // terminate 뒤 늦게 도착한 옛 Worker 오류는 새 세션을 fallback으로 내릴 권한이 없어요.
      // invalidate는 같은 인스턴스를 계속 쓰므로 세대가 아니라 인스턴스 소유권만 확인해요.
      currentWorker.onerror = event => {
        if (worker !== currentWorker) return;
        event.preventDefault?.(); fail(event.message ?? 'R2 worker 오류');
      };
      currentWorker.onmessageerror = () => {
        if (worker !== currentWorker) return;
        fail('R2 worker 메시지를 읽지 못했어요');
      };
    } catch (error) { fail(error); }
  }
  function dispatch(request) {
    request.dispatchedAt = now(); inFlight = request; metrics.submitted++;
    const transfer = [];
    // 동일 ArrayBuffer를 transfer list에 두 번 넣으면 DataCloneError가 난다. H/Y alias는
    // request 생성에서 H를 사본으로 분리하고, 여기서는 alpha view까지 중복을 막는다.
    const addTransfer = buffer => {
      if (buffer instanceof ArrayBuffer && !transfer.includes(buffer)) transfer.push(buffer);
    };
    addTransfer(request.field.data.buffer);
    if (request.field.alpha) addTransfer(request.field.alpha.buffer);
    if (request.hField) addTransfer(request.hField.data.buffer);
    try { worker.postMessage({ type: 'frame', ...request, generation, options: engineOptions }, transfer); }
    catch (error) { fail(error); }
  }
  function noteCameraOpportunity(timestamp) {
    if (!Number.isFinite(timestamp)) return false;
    if (lastCameraTimestamp !== null && timestamp < lastCameraTimestamp) reset();
    lastCameraTimestamp = timestamp;
    return true;
  }
  function canAcceptFrame(timestamp) {
    if (!enabled || !noteCameraOpportunity(timestamp)) return false;
    // fallback은 동기 처리라 준비한 프레임을 바로 받을 수 있다. 완료 답은 다음 pushFrame에서
    // 꺼내야 하므로 pendingHit도 허용한다; 그렇지 않으면 완료 hit가 영구히 전달되지 않는다.
    return Boolean(fallback || pendingHit || !inFlight || (workerQueueDepth === 2 && !pending));
  }
  function pushFrame(field, timestamp, { frameId = Number.isSafeInteger(timestamp) ? timestamp : String(timestamp), ownedInput = false, hField = null, ownedHInput = false } = {}) {
    if (!enabled) return null;
    if (!field || !(field.data instanceof Float32Array) || field.data.length !== field.width * field.height
      || !Number.isFinite(timestamp) || !(typeof frameId === 'string' || Number.isSafeInteger(frameId))) throw new TypeError('유효한 Worker 입력이 필요해요');
    if(hField&&(!(hField.data instanceof Float32Array)||!Number.isSafeInteger(hField.width)||!Number.isSafeInteger(hField.height)
      ||hField.width<1||hField.height<1||hField.width*hField.height>4_000_000||hField.data.length!==hField.width*hField.height))throw new TypeError('유효한 H overscan 입력이 필요해요');
    if (lastInput && (lastInput.width !== field.width || lastInput.height !== field.height || timestamp < lastInput.timestamp)) reset();
    noteCameraOpportunity(timestamp);
    if (lastInput && lastInput.timestamp === timestamp && lastInput.frameId === frameId) return null;
    lastInput = { frameId, timestamp, width: field.width, height: field.height };
    if (pendingHit) {
      const accepted = pendingHit; pendingHit = null;
      // onMessage가 먼저 비워야 하는 상태지만, 외부 mock/향후 경로가 순서를 깨도
      // next frame을 무계수로 잃지 않도록 hit 우선 폐기를 유지한다.
      discardPendingForHit();
      // 획득과 같은 유한 수명. generation은 위 receive/reset에서 별도로 검사해요.
      if (timestamp - accepted.timestamp <= 10_000 && requestId - accepted.requestId <= 64) return clone(accepted.hit);
      metrics.staleResults++;
    }
    ensureWorker();
    if (fallback) {
      const startedAt = now();
      const hit = fallback.pushFrame(field, timestamp, { frameId, ...(hField?{hField}:{}) });
      const serviceMs = Math.max(0, now() - startedAt);
      const timing = { queueMs: 0, roundTripMs: serviceMs, transportMs: 0 };
      snapshot = { stats: fallback.stats, view: fallback.view, hudCandidates: fallback.hudCandidates };
      metrics.processed++; metrics.lastServiceMs = serviceMs; metrics.maxServiceMs = Math.max(metrics.maxServiceMs, serviceMs);
      recordTiming(timing); options.onProcessed?.(processedEvent({ frameId, timestamp, serviceMs }, timing));
      return hit;
    }
    const request = { requestId: ++requestId, frameId, timestamp,
      field: ownedInput ? field : { width: field.width, height: field.height,
        data: field.data.slice(), alpha: field.alpha?.slice() ?? null } };
    Object.defineProperties(request, {
      queuedAt: { value: now(), enumerable: false },
      dispatchedAt: { value: null, writable: true, enumerable: false },
      serviceMs: { value: 0, writable: true, enumerable: false }
    });
    if (hField) {
      const fieldBuffers = [request.field.data.buffer, request.field.alpha?.buffer,
        field.data.buffer, field.alpha?.buffer];
      // H의 소유권 bypass는 scanner가 막 만든 독립 luma에만 쓴다. Y/alpha와 buffer를
      // 공유하면 H도 전송될 수 없으므로 명시 소유권이어도 사본으로 분리한다.
      const aliasesField = fieldBuffers.includes(hField.data.buffer);
      request.hField = { width: hField.width, height: hField.height,
        data: ownedHInput && !aliasesField ? hField.data : hField.data.slice() };
    }
    for (const row of snapshot.hudCandidates) { row.tracking = false; row.retained = true; }
    if (inFlight) { if (pending) metrics.dropped++; pending = request; }
    else dispatch(request);
    return null;
  }
  return Object.freeze({ pushFrame, canAcceptFrame, reset, setEnabled, invalidateLock,
    get enabled() { return enabled; },
    get processingKey() { return `${generation}:${metrics.mode}`; },
    get stats() { return { ...snapshot.stats, worker: { ...metrics, generation,
      queueDepth: workerQueueDepth, inFlight: inFlight ? 1 : 0, pending: pending ? 1 : 0 } }; },
    get view() { return snapshot.view; }, get hudCandidates() { return snapshot.hudCandidates; },
    dispose() { enabled = false; reset(); fallback = null; } });
}
