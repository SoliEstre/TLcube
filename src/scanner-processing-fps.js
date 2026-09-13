/**
 * 처리 완료 시각만으로 표시할 FPS를 관리해요.
 *
 * 프레임 루프/rAF 자체는 표본이 아니에요. Worker 결과, main fallback 완료, R1
 * finally처럼 실제 처리 완료에서만 note()를 불러야 해요. key가 바뀌면 서로 다른
 * engine/mode/generation/session의 완료율을 같은 이동 창에 섞지 않아요.
 */

const MIN_STALE_MS = 2_000;

function median(values) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validNow(now) {
  return Number.isFinite(now) && now >= 0;
}

/**
 * @param {{windowMs?: number, maxSamples?: number}} options
 */
export function createProcessingFpsTracker({ windowMs = 5_000, maxSamples = 512 } = {}) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new TypeError('windowMs는 양의 유한 수여야 해요');
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 2) throw new TypeError('maxSamples는 2 이상의 안전한 정수여야 해요');

  let keySet = false;
  let activeKey;
  let samples = [];
  let intervals = [];
  let lastCompletedAt = null;
  let lastObservedAt = null;
  let lastFps = null;

  function clear(nextKey, hasKey) {
    keySet = hasKey;
    activeKey = nextKey;
    samples = [];
    intervals = [];
    lastCompletedAt = null;
    lastObservedAt = null;
    lastFps = null;
  }

  function prune(now) {
    const cutoff = now - windowMs;
    while (samples.length > 0 && samples[0] < cutoff) samples.shift();
  }

  function staleAfter() {
    return Math.max(MIN_STALE_MS, median(intervals) * 3);
  }

  function snapshot(now) {
    const safeNow = validNow(now) ? now : lastObservedAt;
    if (validNow(safeNow)) prune(safeNow);
    const staleAfterMs = staleAfter();
    const stale = lastCompletedAt !== null && validNow(safeNow) && safeNow - lastCompletedAt > staleAfterMs;
    if (stale) {
      return { state: 'stale', fps: lastFps, count: samples.length, lastCompletedAt, staleAfterMs };
    }
    if (samples.length < 2) {
      return { state: 'warming', fps: null, count: samples.length, lastCompletedAt, staleAfterMs };
    }
    const span = samples.at(-1) - samples[0];
    // note()는 같은 timestamp를 중복 추가하지 않으므로 span은 항상 양수예요.
    const fps = span > 0 ? (samples.length - 1) / (span / 1_000) : null;
    if (fps !== null) lastFps = fps;
    return { state: 'live', fps, count: samples.length, lastCompletedAt, staleAfterMs };
  }

  function acceptClock(now, key) {
    if (!validNow(now)) return false;
    // 역행 입력은 key 전환보다 먼저 거절한다. 그렇지 않으면 늦은 옛 session의
    // sample() 하나가 현재 session의 표본을 비워 버릴 수 있어요.
    if (lastObservedAt !== null && now < lastObservedAt) return false;
    if (keySet && !Object.is(activeKey, key)) clear(key, true);
    else if (!keySet) { keySet = true; activeKey = key; }
    lastObservedAt = now;
    return true;
  }

  return Object.freeze({
    reset() {
      clear(undefined, false);
    },
    note(now, key) {
      if (!acceptClock(now, key)) return snapshot(lastObservedAt);
      if (lastCompletedAt !== now) {
        if (lastCompletedAt !== null) {
          intervals.push(now - lastCompletedAt);
          if (intervals.length > maxSamples - 1) intervals.splice(0, intervals.length - (maxSamples - 1));
        }
        samples.push(now);
        lastCompletedAt = now;
        if (samples.length > maxSamples) samples.splice(0, samples.length - maxSamples);
      }
      return snapshot(now);
    },
    sample(now, key) {
      if (!acceptClock(now, key)) return snapshot(lastObservedAt);
      return snapshot(now);
    },
  });
}
