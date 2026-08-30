import {
  Q8_ONE,
  Q15_ONE,
  createR2Params,
} from './params.js';

export const RANK_LIKELIHOOD_STATUS = Object.freeze({
  OK: 0,
  INVALID_ARGUMENT: 1,
});

// Brightest -> middle -> darkest face index for SPEC digits 0..5.
// Face indices are T=0, L=1, R=2.
export const DIGIT_FACE_ORDER = new Uint8Array([
  0, 1, 2,
  0, 2, 1,
  1, 0, 2,
  1, 2, 0,
  2, 0, 1,
  2, 1, 0,
]);

const MAX_LUMA_MARGIN = 255;

function clampInt16(value) {
  if (value < -32768) return -32768;
  if (value > 32767) return 32767;
  return value;
}

function digitForFaceOrder(first, second) {
  if (first === 0) return second === 1 ? 0 : 1;
  if (first === 1) return second === 0 ? 2 : 3;
  return second === 0 ? 4 : 5;
}

function stableDescendingOrder(t, l, r, order) {
  let first = 0;
  let second = 1;
  let third = 2;

  if (t < l) {
    first = 1;
    second = 0;
  }

  const firstValue = first === 0 ? t : l;
  if (firstValue < r) {
    third = second;
    second = first;
    first = 2;
  } else {
    const secondValue = second === 0 ? t : l;
    if (secondValue < r) {
      third = second;
      second = 2;
    }
  }

  order[0] = first;
  order[1] = second;
  order[2] = third;
}

/**
 * Build the two-lookup Bradley-Terry pseudo-likelihood kernel once.
 *
 * For observed order a>b>c, q1=P(a>b) and q2=P(b>c) come from the
 * sigmoid LUT. q3=P(a>c) is recovered without a third lookup by multiplying
 * odds. The six products are normalized before conversion to int16 Q8.8.
 * The exact six-state factorization is an R2 scaffold proposal and remains a
 * corpus A/B target against a Plackett-Luce oracle.
 */
export function createRankLikelihood(paramsOverride = undefined) {
  const params = createR2Params(paramsOverride);
  const scale = Math.max(1e-6, Number(params.rankMarginScaleLuma));
  const logFloor = Number(params.rankLogFloorQ8) / Q8_ONE;
  const probabilityFloor = Math.exp(logFloor);
  const correctProbabilityLutQ15 = new Uint16Array(MAX_LUMA_MARGIN + 1);

  for (let margin = 0; margin <= MAX_LUMA_MARGIN; margin += 1) {
    const q = 1 / (1 + Math.exp(-margin / scale));
    const quantized = Math.round(q * Q15_ONE);
    // Keep both q and (1-q) representable so every log-likelihood is finite.
    correctProbabilityLutQ15[margin] = Math.max(
      1,
      Math.min(Q15_ONE - 1, quantized),
    );
  }

  const order = new Uint8Array(3);
  const weights = new Float64Array(6);

  function evaluate(faceLuma, faceOffset, output, outputOffset = 0) {
    if (
      faceLuma === null
      || faceLuma === undefined
      || output === null
      || output === undefined
      || faceOffset < 0
      || outputOffset < 0
      || faceOffset + 2 >= faceLuma.length
      || outputOffset + 5 >= output.length
    ) {
      return RANK_LIKELIHOOD_STATUS.INVALID_ARGUMENT;
    }

    const t = Number(faceLuma[faceOffset]);
    const l = Number(faceLuma[faceOffset + 1]);
    const r = Number(faceLuma[faceOffset + 2]);
    stableDescendingOrder(t, l, r, order);

    const a = order[0];
    const b = order[1];
    const c = order[2];
    const values0 = a === 0 ? t : (a === 1 ? l : r);
    const values1 = b === 0 ? t : (b === 1 ? l : r);
    const values2 = c === 0 ? t : (c === 1 ? l : r);
    const margin1 = Math.min(MAX_LUMA_MARGIN, Math.max(0, Math.round(values0 - values1)));
    const margin2 = Math.min(MAX_LUMA_MARGIN, Math.max(0, Math.round(values1 - values2)));

    // Exactly two sigmoid LUT reads per cell.
    const q1 = correctProbabilityLutQ15[margin1] / Q15_ONE;
    const q2 = correctProbabilityLutQ15[margin2] / Q15_ONE;
    const p1 = 1 - q1;
    const p2 = 1 - q2;
    const oddsDenominator = (q1 * q2) + (p1 * p2);
    const q3 = (q1 * q2) / oddsDenominator;
    const p3 = 1 - q3;

    const observed = digitForFaceOrder(a, b);
    const topSwap = digitForFaceOrder(b, a);
    const bottomSwap = digitForFaceOrder(a, c);
    const cycleLeft = digitForFaceOrder(b, c);
    const cycleRight = digitForFaceOrder(c, a);
    const reversed = digitForFaceOrder(c, b);

    weights[observed] = q1 * q2 * q3;
    weights[topSwap] = p1 * q2 * q3;
    weights[bottomSwap] = q1 * p2 * q3;
    weights[cycleLeft] = p1 * q2 * p3;
    weights[cycleRight] = q1 * p2 * p3;
    weights[reversed] = p1 * p2 * p3;

    let total = 0;
    for (let digit = 0; digit < 6; digit += 1) {
      total += weights[digit];
    }

    let flooredTotal = 0;
    for (let digit = 0; digit < 6; digit += 1) {
      const probability = Math.max(probabilityFloor, weights[digit] / total);
      weights[digit] = probability;
      flooredTotal += probability;
    }

    for (let digit = 0; digit < 6; digit += 1) {
      const normalized = weights[digit] / flooredTotal;
      output[outputOffset + digit] = clampInt16(
        Math.round(Math.log(normalized) * Q8_ONE),
      );
    }
    return RANK_LIKELIHOOD_STATUS.OK;
  }

  return Object.freeze({
    evaluate,
    correctProbabilityLutQ15,
    params,
  });
}

