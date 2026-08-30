import {
  Q15_ONE,
  createR2Params,
} from './params.js';

export const ACCUMULATE_STATUS = Object.freeze({
  OK: 0,
  INVALID_ARGUMENT: 1,
});

function clampInt16(value) {
  if (value < -32768) return -32768;
  if (value > 32767) return 32767;
  return value;
}

function multiplyQ15Signed(value, factorQ15) {
  const product = value * factorQ15;
  if (product >= 0) return Math.floor((product + (Q15_ONE / 2)) / Q15_ONE);
  return -Math.floor(((-product) + (Q15_ONE / 2)) / Q15_ONE);
}

/**
 * Allocate the per-cell six-state accumulator once.
 * scores uses true SoA indexing: scores[state * cellCount + cell].
 */
export function createAccumulator(cellCount, paramsOverride = undefined) {
  const count = Math.max(0, Math.trunc(Number(cellCount)));
  const params = createR2Params(paramsOverride);
  return {
    cellCount: count,
    scores: new Int16Array(count * 6),
    observations: new Uint32Array(count),
    scratch: new Int32Array(6),
    // Read the six evidence terms into their own buffer before writing results.
    // Without it a caller may legally pass `accumulator.scratch` as the evidence
    // array (accumulateFrame does), and any nonzero shift would then read a slot
    // this same loop already overwrote.
    evidenceScratch: new Int32Array(6),
    params,
  };
}

export function resetAccumulator(accumulator) {
  if (accumulator === null || accumulator === undefined) {
    return ACCUMULATE_STATUS.INVALID_ARGUMENT;
  }
  accumulator.scores.fill(0);
  accumulator.observations.fill(0);
  accumulator.scratch.fill(0);
  accumulator.evidenceScratch.fill(0);
  return ACCUMULATE_STATUS.OK;
}

/**
 * Accumulate one cell without allocating. observedDigitShift removes a
 * per-cell mod-6 mask: unmasked state d reads observed state d+shift.
 */
export function accumulateCell(
  accumulator,
  cell,
  logLikelihoodQ8,
  logOffset,
  weightQ15,
  observedDigitShift = 0,
) {
  if (
    accumulator === null
    || accumulator === undefined
    || logLikelihoodQ8 === null
    || logLikelihoodQ8 === undefined
    || cell < 0
    || cell >= accumulator.cellCount
    || logOffset < 0
    || logOffset + 5 >= logLikelihoodQ8.length
  ) {
    return ACCUMULATE_STATUS.INVALID_ARGUMENT;
  }

  // A rejected alignment frame is excluded, including λ decay.
  if (weightQ15 <= 0) return ACCUMULATE_STATUS.OK;

  const weight = Math.min(Q15_ONE, Math.trunc(weightQ15));
  const lambda = Math.max(0, Math.min(Q15_ONE, Math.trunc(accumulator.params.lambdaQ15)));
  const beta = Math.max(0, Math.min(Q15_ONE, Math.trunc(accumulator.params.betaQ15)));
  const temperedWeight = Math.floor(((weight * beta) + (Q15_ONE / 2)) / Q15_ONE);
  const shift = ((Math.trunc(observedDigitShift) % 6) + 6) % 6;
  const {
    cellCount, scores, scratch, evidenceScratch,
  } = accumulator;

  // Snapshot the evidence first: the caller's array may alias `scratch`.
  for (let state = 0; state < 6; state += 1) {
    evidenceScratch[state] = logLikelihoodQ8[logOffset + state];
  }

  let maximum = -2147483648;
  for (let state = 0; state < 6; state += 1) {
    const oldValue = scores[(state * cellCount) + cell];
    const observedState = (state + shift) % 6;
    const next = multiplyQ15Signed(oldValue, lambda)
      + multiplyQ15Signed(evidenceScratch[observedState], temperedWeight);
    scratch[state] = next;
    if (next > maximum) maximum = next;
  }

  // Common-offset recentering preserves every argmax/gap and prevents drift.
  for (let state = 0; state < 6; state += 1) {
    scores[(state * cellCount) + cell] = clampInt16(scratch[state] - maximum);
  }
  accumulator.observations[cell] += 1;
  return ACCUMULATE_STATUS.OK;
}

/**
 * frameLogLikelihoodQ8 is SoA, matching the accumulator layout.
 */
export function accumulateFrame(
  accumulator,
  frameLogLikelihoodQ8,
  weightQ15,
  observedMask = undefined,
) {
  if (
    accumulator === null
    || accumulator === undefined
    || frameLogLikelihoodQ8 === null
    || frameLogLikelihoodQ8 === undefined
    || frameLogLikelihoodQ8.length < accumulator.cellCount * 6
    || (observedMask !== undefined && observedMask.length < accumulator.cellCount)
  ) {
    return ACCUMULATE_STATUS.INVALID_ARGUMENT;
  }
  if (weightQ15 <= 0) return ACCUMULATE_STATUS.OK;

  const { cellCount } = accumulator;
  const scratchLog = accumulator.scratch;
  for (let cell = 0; cell < cellCount; cell += 1) {
    if (observedMask !== undefined && observedMask[cell] === 0) continue;
    for (let state = 0; state < 6; state += 1) {
      scratchLog[state] = frameLogLikelihoodQ8[(state * cellCount) + cell];
    }
    const status = accumulateCell(
      accumulator,
      cell,
      scratchLog,
      0,
      weightQ15,
      0,
    );
    if (status !== ACCUMULATE_STATUS.OK) return status;
  }
  return ACCUMULATE_STATUS.OK;
}

export function cellArgmax(accumulator, cell) {
  if (cell < 0 || cell >= accumulator.cellCount) return -1;
  let bestState = 0;
  let bestValue = accumulator.scores[cell];
  for (let state = 1; state < 6; state += 1) {
    const value = accumulator.scores[(state * accumulator.cellCount) + cell];
    if (value > bestValue) {
      bestValue = value;
      bestState = state;
    }
  }
  return bestState;
}

export function cellMarginQ8(accumulator, cell) {
  if (cell < 0 || cell >= accumulator.cellCount) return -1;
  let best = -32769;
  let second = -32769;
  for (let state = 0; state < 6; state += 1) {
    const value = accumulator.scores[(state * accumulator.cellCount) + cell];
    if (value > best) {
      second = best;
      best = value;
    } else if (value > second) {
      second = value;
    }
  }
  return best - second;
}

/**
 * Materialize the C2 contract only when a decode attempt is due.
 * layout.symbolCells may override the default consecutive 3-cell grouping.
 */
export function materializeSymbolsInto(
  accumulator,
  layout,
  symbolValues,
  symbolConfidenceQ8,
  erasures,
) {
  const symbolCount = Math.floor(accumulator.cellCount / 3);
  if (
    symbolValues.length < symbolCount
    || symbolConfidenceQ8.length < symbolCount
    || erasures.length < symbolCount
    || (layout.symbolCells !== undefined && layout.symbolCells.length < symbolCount * 3)
  ) {
    return ACCUMULATE_STATUS.INVALID_ARGUMENT;
  }

  const threshold = Math.max(0, Math.trunc(accumulator.params.erasureMarginQ8));
  for (let symbol = 0; symbol < symbolCount; symbol += 1) {
    const base = symbol * 3;
    const cell0 = layout.symbolCells === undefined ? base : layout.symbolCells[base];
    const cell1 = layout.symbolCells === undefined ? base + 1 : layout.symbolCells[base + 1];
    const cell2 = layout.symbolCells === undefined ? base + 2 : layout.symbolCells[base + 2];
    if (
      cell0 >= accumulator.cellCount
      || cell1 >= accumulator.cellCount
      || cell2 >= accumulator.cellCount
    ) {
      return ACCUMULATE_STATUS.INVALID_ARGUMENT;
    }

    let bestOverallValue = 0;
    let bestOverallScore = -2147483648;
    let bestLegalValue = 0;
    let bestLegalScore = -2147483648;
    let secondLegalScore = -2147483648;

    for (let value = 0; value < 216; value += 1) {
      const digit0 = Math.floor(value / 36);
      const digit1 = Math.floor(value / 6) % 6;
      const digit2 = value % 6;
      const score = accumulator.scores[(digit0 * accumulator.cellCount) + cell0]
        + accumulator.scores[(digit1 * accumulator.cellCount) + cell1]
        + accumulator.scores[(digit2 * accumulator.cellCount) + cell2];

      if (score > bestOverallScore) {
        bestOverallScore = score;
        bestOverallValue = value;
      }
      if (value <= 210) {
        if (score > bestLegalScore) {
          secondLegalScore = bestLegalScore;
          bestLegalScore = score;
          bestLegalValue = value;
        } else if (score > secondLegalScore) {
          secondLegalScore = score;
        }
      }
    }

    const confidence = bestLegalScore - secondLegalScore;
    symbolValues[symbol] = bestLegalValue;
    symbolConfidenceQ8[symbol] = clampInt16(confidence);
    erasures[symbol] = (
      bestOverallValue > 210
      || confidence < threshold
      || accumulator.observations[cell0] === 0
      || accumulator.observations[cell1] === 0
      || accumulator.observations[cell2] === 0
    ) ? 1 : 0;
  }
  return ACCUMULATE_STATUS.OK;
}

