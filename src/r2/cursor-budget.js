const DEFAULT_MAX_STEPS = 50_000;
const MAX_STEPS = 1_000_000;
const TERMINAL_STATES = new Set(['done', 'discarded']);

function cursorState(cursor) {
  const status = cursor.status;
  return status?.phase ?? status?.state ?? 'unknown';
}

/**
 * 같은 current epoch에서 cursor.resume을 소프트 시간 예산 동안 반복한다.
 * 한 resume은 원자 단위라 예산을 넘길 수 있으며, 그 초과량을 반환한다.
 */
export function resumeCursorWithinBudget(cursor, current, options = {}) {
  if (!cursor || typeof cursor.resume !== 'function') {
    throw new TypeError('cursor.resume 함수가 필요해요');
  }
  const budgetMs = options.budgetMs;
  if (!Number.isFinite(budgetMs) || budgetMs < 0) {
    throw new RangeError('budgetMs는 0 이상의 유한수여야 해요');
  }
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0 || maxSteps > MAX_STEPS) {
    throw new RangeError(`maxSteps는 0 이상 ${MAX_STEPS} 이하의 안전한 정수여야 해요`);
  }
  const now = options.now ?? (() => performance.now());
  if (typeof now !== 'function') throw new TypeError('now는 함수여야 해요');

  const startedAt = now();
  if (!Number.isFinite(startedAt)) throw new TypeError('now는 유한수를 반환해야 해요');
  let elapsedMs = 0;
  let steps = 0;
  let state = cursorState(cursor);
  let lastSampledAt = startedAt;
  let lastProgress = null;
  let maxStepMs = 0;
  let maxStepUnit = null;

  while (budgetMs > elapsedMs && steps < maxSteps && !TERMINAL_STATES.has(state)) {
    const progress = cursor.resume(current);
    steps += 1;
    lastProgress = progress ?? null;
    state = progress?.state ?? cursorState(cursor);

    const sampledAt = now();
    if (!Number.isFinite(sampledAt) || sampledAt < lastSampledAt) {
      throw new TypeError('now는 단조 증가하는 유한수를 반환해야 해요');
    }
    const stepMs = sampledAt - lastSampledAt;
    if (stepMs > maxStepMs) {
      maxStepMs = stepMs;
      maxStepUnit = progress?.unit ?? progress?.state ?? null;
    }
    lastSampledAt = sampledAt;
    elapsedMs = sampledAt - startedAt;
  }

  return Object.freeze({
    steps,
    elapsedMs,
    overrunMs: Math.max(0, elapsedMs - budgetMs),
    state,
    lastProgress,
    maxStepMs,
    maxStepUnit,
  });
}
