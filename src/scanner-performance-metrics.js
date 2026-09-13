const METRICS = ['prepareMs', 'serviceMs', 'queueMs', 'roundTripMs', 'transportMs'];
const RATE_KEYS = ['processed', 'hDetect', 'yFrames'];
const CAP_REASONS = new Set(['candidates512', 'pruned128', 'faces24', 'work65536']);
const finite = value => Number.isFinite(value) && value >= 0;
const scalar = value => finite(value) ? value : null;
const quantile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  if (fraction === .5) {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[Math.ceil((sorted.length - 1) * fraction)];
};
function series() { return []; }
function trim(rows, now, windowMs, maxSamples) {
  const cutoff = now - windowMs;
  while (rows.length && rows[0].now < cutoff) rows.shift();
  if (rows.length > maxSamples) rows.splice(0, rows.length - maxSamples);
}
function rate(rows) {
  if (rows.length < 2) return null;
  const first = rows[0], last = rows.at(-1), span = last.now - first.now;
  return span > 0 ? (last.value - first.value) * 1000 / span : 0;
}
function enumValue(value, allowed) { return allowed.includes(value) ? value : null; }
function capReasons(value) {
  // cap reason은 작은 내부 enum 목록만 남긴다. payload/임의 문자열은 절대 복사하지 않아요.
  return Array.isArray(value) ? value.filter(item => CAP_REASONS.has(item)).slice(0, 4) : [];
}

/** 진단 패널용 bounded scalar telemetry. 프레임/기하/payload를 보관하지 않아요. */
export function createScannerPerformanceMetrics({ windowMs = 5_000, maxSamples = 256 } = {}) {
  if (!finite(windowMs) || windowMs === 0) throw new TypeError('windowMs는 양의 유한 수여야 해요');
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 2) throw new TypeError('maxSamples는 2 이상의 안전한 정수여야 해요');
  let lastNow = null, raf = series(), video = series(), result = series();
  let counters = Object.fromEntries(RATE_KEYS.map(key => [key, series()]));
  let timing = Object.fromEntries(METRICS.map(key => [key, series()]));
  let latest = null, capture = { ySide: null, hSide: null };
  const accept = now => finite(now) && (lastNow === null || now >= lastNow) && (lastNow = now, true);
  const add = (rows, now, value) => { if (!finite(value) || rows.at(-1)?.now === now) return; rows.push({ now, value }); trim(rows, now, windowMs, maxSamples); };
  function counter(key, now, value) {
    if (!finite(value)) return;
    const rows = counters[key];
    if (rows.length && value < rows.at(-1).value) rows.length = 0;
    if (!rows.length || value !== rows.at(-1).value || now !== rows.at(-1).now) add(rows, now, value);
  }
  function pick(stats) {
    const worker = stats?.worker ?? {}, h = stats?.h ?? {}, y = stats?.y ?? stats ?? {}, detect = h.lastDetection ?? {};
    latest = { capture: { ...capture }, worker: { mode: enumValue(worker.mode, ['worker', 'main-fallback']), generation: scalar(worker.generation), processed: scalar(worker.processed), dropped: scalar(worker.dropped), staleResults: scalar(worker.staleResults), errors: scalar(worker.errors), queueDepth: scalar(worker.queueDepth), pendingDiscardedForHit: scalar(worker.pendingDiscardedForHit), pendingDiscardedForReset: scalar(worker.pendingDiscardedForReset) }, h: { state: enumValue(h.state, ['EMPTY', 'COLLECTING', 'DONE']), count: scalar(h.count), required: scalar(h.required), detectCalls: scalar(h.detectCalls), lastDetectMs: scalar(h.lastDetectMs), lastDetection: { components: scalar(detect.components), capReasons: capReasons(detect.capReasons) } }, y: { frames: scalar(y.frames), lastYMs: scalar(y.lastYMs) }, hSkippedY: scalar(stats?.hSkippedY) };
    counter('processed', nowForPick, worker.processed); counter('hDetect', nowForPick, h.detectCalls); counter('yFrames', nowForPick, y.frames);
  }
  let nowForPick = 0;
  function snapshot(now) {
    if (finite(now) && (lastNow === null || now >= lastNow)) { lastNow = now; for (const rows of [raf, video, result, ...Object.values(counters), ...Object.values(timing)]) trim(rows, now, windowMs, maxSamples); }
    const outTiming = {};
    for (const key of METRICS) { const values = timing[key].map(row => row.value); outTiming[key] = { p50: quantile(values, .5), p95: quantile(values, .95), count: values.length }; }
    return { windowMs, hz: { raf: rate(raf), video: rate(video), processed: rate(result), hDetect: rate(counters.hDetect), yFrames: rate(counters.yFrames) }, timings: outTiming, latest: latest ? structuredClone(latest) : null };
  }
  return Object.freeze({
    reset(now = 0) { lastNow = finite(now) ? now : 0; raf = series(); video = series(); result = series(); counters = Object.fromEntries(RATE_KEYS.map(key => [key, series()])); timing = Object.fromEntries(METRICS.map(key => [key, series()])); latest = null; capture = { ySide: null, hSide: null }; },
    noteRaf(now) { if (accept(now)) add(raf, now, raf.length ? raf.at(-1).value + 1 : 0); },
    noteVideo(now, presentedFrames) { if (accept(now)) { if (video.length && presentedFrames < video.at(-1).value) video = series(); add(video, now, presentedFrames); } },
    notePrepare(now, ms, { ySide, hSide } = {}) { if (accept(now)) { capture = { ySide: ySide === undefined ? capture.ySide : scalar(ySide), hSide: hSide === undefined ? capture.hSide : scalar(hSide) }; add(timing.prepareMs, now, ms); } },
    noteResult(now, values = {}, stats = {}) { if (!accept(now)) return; add(result, now, result.length ? result.at(-1).value + 1 : 0); for (const key of METRICS.slice(1)) add(timing[key], now, values[key]); nowForPick = now; pick(stats); },
    snapshot,
  });
}
