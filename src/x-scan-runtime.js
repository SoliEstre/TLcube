/**
 * Type X 스캔 스케줄러 골격이에요. detector를 주입하거나 호출하지 않으며 hit은 항상 null이에요.
 * input.timestamp와 clock()은 반드시 같은 단조 시계 원점의 ms여야 해요.
 */
import { X_OBSERVER_LIMITS, validateXBlindInput } from './x-observer.js';

const MAX_RESULT_AGE_MS = 3_000;
const OPTION_KEYS = Object.freeze(['enabled', 'minIntervalMs', 'maxBackoffMs', 'maxResultAgeMs', 'clock']);

function fail(Type, message) { throw new Type(message); }
function ownOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) fail(TypeError, 'options 객체가 필요해요');
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) fail(TypeError, 'options은 plain object여야 해요');
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !OPTION_KEYS.includes(key)) fail(TypeError, `options.${String(key)}는 허용되지 않아요`);
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) fail(TypeError, `options.${key}는 own data property여야 해요`);
  }
}
function finite(value, name, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail(RangeError, `${name} 범위가 잘못됐어요`);
  return value;
}
function blank(status, reason) { return Object.freeze({ status, reason, hit: null, observations: Object.freeze([]) }); }
function saturatedIncrement(value) { return value >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : value + 1; }

/**
 * Detector/collector 없이 X blind 입력의 경계, cadence, cancellation만 실행해요.
 * `due(now)`의 true는 시도 가능 여부일 뿐 검출·수용·성공 신호가 아니에요.
 *
 * `rejected`는 모든 rejected 결과의 총계예요. `invalidInputs`, `unimplemented`,
 * `duplicateFrames`는 그 총계의 부분 분류이며, disabled/backoff/stale/budget-aborted와는 겹치지 않아요.
 * backoff scheduling skip은 의도적으로 input을 읽거나 유효성 검사를 하지 않아요.
 */
export function createXScanRuntime(options = {}) {
  ownOptions(options);
  if (Object.prototype.hasOwnProperty.call(options, 'enabled') && typeof options.enabled !== 'boolean') fail(TypeError, 'enabled는 boolean이어야 해요');
  const clock = options.clock ?? (() => performance.now());
  if (typeof clock !== 'function') fail(TypeError, 'clock은 함수여야 해요');
  const minIntervalMs = finite(options.minIntervalMs ?? 100, 'minIntervalMs', 0, MAX_RESULT_AGE_MS);
  const maxBackoffMs = finite(options.maxBackoffMs ?? 1_000, 'maxBackoffMs', minIntervalMs, MAX_RESULT_AGE_MS);
  const maxResultAgeMs = finite(options.maxResultAgeMs ?? 250, 'maxResultAgeMs', 1, MAX_RESULT_AGE_MS);
  let enabled = options.enabled ?? false;
  let generation = 0;
  let lastAttemptAt = null;
  let lastInputTimestamp = null;
  let lastClockAt = null;
  let sessionId = null;
  let lastSize = null;
  let failures = 0;
  const frameHistory = new Map();
  const counters = {
    frames: 0, attempted: 0, disabled: 0, backoff: 0, rejected: 0, invalidInputs: 0,
    unimplemented: 0, budgetAborted: 0, staleResults: 0, duplicateFrames: 0,
    serviceMs: 0, resultAgeMs: 0,
  };

  function count(name) { counters[name] = saturatedIncrement(counters[name]); }
  function boundedScalar(value) { return Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, value) : 0; }
  function readClock(value) {
    const now = finite(value, 'clock()', 0, Number.MAX_VALUE);
    if (lastClockAt !== null && now < lastClockAt) fail(RangeError, 'clock-regression');
    lastClockAt = now;
    return now;
  }
  function fromClock() { return readClock(clock()); }
  function failureInterval() {
    if (failures === 0) return minIntervalMs;
    return Math.min(maxBackoffMs, minIntervalMs * (2 ** Math.min(failures - 1, 52)));
  }
  function dueAt(at) { return lastAttemptAt === null || at - lastAttemptAt >= failureInterval(); }
  function clearScheduling() {
    lastAttemptAt = null;
    lastInputTimestamp = null;
    lastClockAt = null;
    sessionId = null;
    lastSize = null;
    failures = 0;
    frameHistory.clear();
  }
  function failResult(status, reason, subtype) {
    if (status === 'rejected') count('rejected');
    if (subtype) count(subtype);
    return blank(status, reason);
  }
  function noteFailure() { failures = Math.min(53, failures + 1); }
  function prune(at) {
    for (const [id, timestamp] of frameHistory) if (at - timestamp > X_OBSERVER_LIMITS.FRAME_TTL_MS) frameHistory.delete(id);
  }
  function due(at) {
    if (!enabled) return false;
    const checkedAt = at === undefined ? fromClock() : readClock(at);
    return dueAt(checkedAt);
  }
  function statsSnapshot() {
    return Object.freeze({
      frames: counters.frames, attempted: counters.attempted, disabled: counters.disabled, backoff: counters.backoff,
      rejected: counters.rejected, invalidInputs: counters.invalidInputs, unimplemented: counters.unimplemented,
      budgetAborted: counters.budgetAborted, staleResults: counters.staleResults, duplicateFrames: counters.duplicateFrames,
      serviceMs: boundedScalar(counters.serviceMs), resultAgeMs: boundedScalar(counters.resultAgeMs), generation,
    });
  }
  function reset() { generation = saturatedIncrement(generation); clearScheduling(); }
  function setEnabled(flag) {
    if (typeof flag !== 'boolean') fail(TypeError, 'setEnabled에는 boolean이 필요해요');
    if (flag === enabled) return;
    enabled = flag;
    reset();
  }
  function pushFrame(input) {
    // 비활성 fast-path: input의 키·field·픽셀과 clock조차 읽지 않아요.
    if (!enabled) return failResult('disabled', 'disabled', 'disabled');
    count('frames');
    let startedAt;
    try { startedAt = fromClock(); }
    catch { return failResult('rejected', 'clock-regression'); }
    // scheduling skip은 malformed DTO도 보지 않아요. 특히 4Mpx sample scan을 피하기 위한 경계예요.
    if (!dueAt(startedAt)) return failResult('backoff', 'backoff-active', 'backoff');
    try { validateXBlindInput(input); }
    catch { return failResult('rejected', 'invalid-input', 'invalidInputs'); }
    let validatedAt;
    try { validatedAt = fromClock(); }
    catch { return failResult('rejected', 'clock-regression'); }
    const validationMs = validatedAt - startedAt;
    counters.serviceMs = boundedScalar(validationMs);
    if (validationMs > input.budget.maxMs) {
      count('budgetAborted'); noteFailure(); lastAttemptAt = validatedAt;
      return blank('budget-aborted', 'validation-budget-exceeded');
    }
    if (input.generation !== generation) return failResult('stale', 'stale-generation', 'staleResults');
    if (sessionId !== null && input.sessionId !== sessionId) return failResult('rejected', 'session-changed');
    if (lastInputTimestamp !== null && input.timestamp < lastInputTimestamp) return failResult('rejected', 'timestamp-regression');
    const age = validatedAt - input.timestamp;
    if (age < 0) return failResult('rejected', 'timestamp-ahead-of-clock');
    counters.resultAgeMs = boundedScalar(age);
    if (age > maxResultAgeMs) return failResult('stale', 'stale-result', 'staleResults');
    prune(input.timestamp);
    if (frameHistory.has(input.frameId)) return failResult('rejected', 'duplicate-frame', 'duplicateFrames');
    if (lastSize && (lastSize.width !== input.field.width || lastSize.height !== input.field.height)) return failResult('rejected', 'frame-size-changed');
    frameHistory.set(input.frameId, input.timestamp);
    while (frameHistory.size > X_OBSERVER_LIMITS.MAX_FRAME_HISTORY) frameHistory.delete(frameHistory.keys().next().value);
    sessionId = input.sessionId;
    lastInputTimestamp = input.timestamp;
    lastSize = { width: input.field.width, height: input.field.height };
    lastAttemptAt = validatedAt;
    count('attempted'); noteFailure();
    return failResult('rejected', 'unimplemented', 'unimplemented');
  }
  return Object.freeze({
    pushFrame,
    due,
    reset,
    setEnabled,
    get enabled() { return enabled; },
    get generation() { return generation; },
    get stats() { return statsSnapshot(); },
  });
}
