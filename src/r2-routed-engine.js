import { createR2ExpansionEngine } from './r2-expansion-engine.js';
import { createSharedCentralN7Pool } from './r2/shared-central-n7.js';
import { confirmedN7EngineFamily, protectsYHEngine } from './scanner-engine-route.js';

function routeField(field, width, height) {
  if (width === field.width && height === field.height) return field;
  const data = new Float32Array(width * height);
  const alpha = field.alpha ? new Uint8Array(data.length) : null;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = Math.min(field.height - 1, Math.floor((y + .5) * field.height / height)) * field.width
      + Math.min(field.width - 1, Math.floor((x + .5) * field.width / width));
    data[y * width + x] = field.data[index];
    if (alpha) alpha[y * width + x] = field.alpha[index];
  }
  return { width, height, data, alpha };
}

/** R2/Y/H 결과 수용은 그대로 두고, 검증된 비Y/H 표식만 별도 신호로 올려요. */
export function createR2RoutedEngine(options = {}, dependencies = {}) {
  const engine = (dependencies.createEngine ?? createR2ExpansionEngine)(options);
  if (options.autoRouteR1 !== true) return engine;
  let pool = null, lease = null, ordinal = 0, epoch = 1, previous = null;
  let evidence = null, nextProbeAt = -Infinity, lastYConfirmedAt = null;
  const makePool = dependencies.createPool ?? createSharedCentralN7Pool;
  function clearRoute() {
    lease?.release(); lease = null; pool?.reset(); pool = null;
    evidence = null; previous = null; ordinal = 0; epoch++; nextProbeAt = -Infinity;
  }
  function observe(field, timestamp, frameId) {
    if (!Number.isFinite(timestamp) || !(field?.data instanceof Float32Array)
      || !Number.isSafeInteger(field.width) || !Number.isSafeInteger(field.height)
      || field.width < 8 || field.height < 8 || field.width * field.height > 4_000_000) return;
    if (previous && (previous.sourceWidth !== field.width || previous.sourceHeight !== field.height || timestamp < previous.timestamp)) clearRoute();
    const scale = Math.min(1, 640 / Math.max(field.width, field.height));
    const width = Math.round(field.width * scale), height = Math.round(field.height * scale);
    previous = { width, height, sourceWidth: field.width, sourceHeight: field.height, timestamp };
    const current = { ...previous, frameId, generation: epoch, ordinal: ++ordinal };
    if (lease && (timestamp - lease.origin.timestamp > 3000 || ordinal - lease.origin.ordinal > 64)) {
      lease.release(); lease = null; evidence = null;
    }
    if (!lease && timestamp < nextProbeAt) return;
    if (!pool) pool = makePool({ maxAgeFrames: 64, maxAgeMs: 3000, acquisitionPolicy: 'age' });
    // 새 획득 원본만 축소해요. Y/H 입력과 누적 원본은 변경하지 않아요.
    if (!lease) lease = pool.acquire(routeField(field, width, height), current);
    const step = lease.resumeBatch(current, { budgetMs: 6, maxSteps: 1024 });
    if (step.state === 'done') {
      const read = lease.readOrigin();
      const family = confirmedN7EngineFamily(read?.finders);
      evidence = family ? { source: 'central-n7', family, timestamp: read.origin.timestamp } : null;
      lease.release(); lease = null; nextProbeAt = timestamp + 500;
    } else if (['invalidated', 'stale', 'released'].includes(step.state)) {
      lease.release(); lease = null; nextProbeAt = timestamp + 500;
    }
  }
  return Object.freeze({
    pushFrame(field, timestamp, frameOptions = {}) {
      if (!engine.enabled) return null;
      const previousFrames = Number(engine.stats.frames) || 0;
      const hit = engine.pushFrame(field, timestamp, frameOptions);
      const stats = engine.stats;
      if (Number(stats.frames) > previousFrames && Number(stats.locked) === 1 && Number(stats.progressD) > 0) lastYConfirmedAt = timestamp;
      if (hit || protectsYHEngine({ ...stats, engineRouteYConfirmedAt: lastYConfirmedAt }, timestamp)) { clearRoute(); return hit; }
      evidence = null;
      try { observe(field, timestamp, frameOptions.frameId ?? (Number.isSafeInteger(timestamp) ? timestamp : String(timestamp))); }
      catch { clearRoute(); nextProbeAt = timestamp + 500; }
      return hit;
    },
    reset() { lastYConfirmedAt = null; clearRoute(); engine.reset(); },
    invalidateLock() { lastYConfirmedAt = null; clearRoute(); engine.invalidateLock(); },
    setEnabled(value) { lastYConfirmedAt = null; clearRoute(); engine.setEnabled(value); },
    get enabled() { return engine.enabled; },
    get stats() { return { ...engine.stats, engineRoute: evidence ? { ...evidence } : null, engineRouteYConfirmedAt: lastYConfirmedAt }; },
    get view() { return engine.view; },
    get hudCandidates() { return engine.hudCandidates; },
    get accepted() { return engine.accepted; },
  });
}
