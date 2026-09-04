import {
  P,
  add,
  alphaPow,
  div,
  mul,
  sub,
} from '../gfp.js';
import {
  DEFAULT_FCR,
  MAX_CODEWORD_LEN,
} from '../rs211.js';
import {
  Q8_ONE,
  Q15_ONE,
  createR2Params,
} from './params.js';

// The contract fixes delta >= 2. Use the smallest permitted deterministic default.
const DEFAULT_DETECTION_MARGIN = 2;
const MIN_RESIDUAL_CORRECTIONS = 3;
const CRC_NOT_CHECKED = -1;

// symbolConfidenceQ8 is a non-negative log-likelihood gap. Convert it once to
// a Q15 error-probability table so selection itself stays fixed-point and does
// not call libm in the hot path.
const ERROR_PROBABILITY_Q15 = new Uint16Array(32768);
for (let confidence = 0; confidence < ERROR_PROBABILITY_Q15.length; confidence += 1) {
  ERROR_PROBABILITY_Q15[confidence] = Math.round(
    Q15_ONE / (1 + Math.exp(confidence / Q8_ONE)),
  );
}

export const RS_SOFT_STATUS = Object.freeze({
  OK: 0,
  INVALID_ARGUMENT: 1,
  DECODE_FAILED: 2,
  POLICY_INELIGIBLE: 3,
  NOT_READY: 4,
  REJECTED: 5,
});

export const RS_SOFT_FAILURE = Object.freeze({
  NONE: 0,
  INVALID_ARGUMENT: 1,
  TOO_MANY_ERASURES: 2,
  BM_OVER_CAPACITY: 3,
  LOCATOR_DEGREE: 4,
  ROOT_COUNT: 5,
  FORNEY_DENOMINATOR: 6,
  POSTCHECK: 7,
  NO_ACCEPTED_CANDIDATE: 8,
});

function boundedCapacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return MAX_CODEWORD_LEN;
  return Math.max(1, Math.min(MAX_CODEWORD_LEN, Math.trunc(number)));
}

/**
 * Allocate the caller-owned result and scratch storage once, outside the frame
 * loop. The four decoding entry points below never replace these buffers.
 */
export function createRsSoftOut(
  codewordCapacity = MAX_CODEWORD_LEN,
  paramsOverride = undefined,
) {
  const capacity = boundedCapacity(codewordCapacity);
  const polynomialCapacity = capacity + 1;
  return {
    capacity,
    params: createR2Params(paramsOverride),
    delta: DEFAULT_DETECTION_MARGIN,
    crcStatus: CRC_NOT_CHECKED,

    status: RS_SOFT_STATUS.OK,
    failure: RS_SOFT_FAILURE.NONE,
    ok: 0,
    accepted: 0,
    clean: 0,
    eligible: 0,
    codewordLength: 0,
    messageLength: 0,
    nsym: 0,
    erasureCount: 0,
    selectedErasureCount: 0,
    maxAdmissibleErasureCount: 0,
    errorCount: 0,
    correctedCount: 0,
    errataCount: 0,
    tResidual: 0,
    parityMargin: 0,
    attemptCount: 0,
    acceptedRung: -1,
    syndromeComputations: 0,
    postcheckComputations: 0,
    acceptFailure: RS_SOFT_FAILURE.NONE,

    source: new Uint8Array(capacity),
    codeword: new Uint8Array(capacity),
    syndromes: new Uint8Array(capacity),
    forneySyndromes: new Uint8Array(capacity),
    omega: new Uint8Array(capacity),
    gamma: new Uint8Array(polynomialCapacity),
    lambda: new Uint8Array(polynomialCapacity),
    bmPrevious: new Uint8Array(polynomialCapacity),
    bmBackup: new Uint8Array(polynomialCapacity),
    locator: new Uint8Array(polynomialCapacity),
    seen: new Uint8Array(capacity),
    erasureFlags: new Uint8Array(capacity),
    rankPositions: new Uint16Array(capacity),
    erasurePositions: new Uint16Array(capacity),
    errataPositions: new Uint16Array(capacity),
    correctedPositions: new Uint16Array(capacity),
  };
}

function isIndexable(value) {
  return value !== null
    && value !== undefined
    && Number.isInteger(value.length)
    && value.length >= 0;
}

function validWorkspace(out) {
  if (out === null || out === undefined) return false;
  const capacity = out.capacity;
  return Number.isInteger(capacity)
    && capacity > 0
    && capacity <= MAX_CODEWORD_LEN
    && out.source?.length >= capacity
    && out.codeword?.length >= capacity
    && out.syndromes?.length >= capacity
    && out.forneySyndromes?.length >= capacity
    && out.omega?.length >= capacity
    && out.gamma?.length >= capacity + 1
    && out.lambda?.length >= capacity + 1
    && out.bmPrevious?.length >= capacity + 1
    && out.bmBackup?.length >= capacity + 1
    && out.locator?.length >= capacity + 1
    && out.seen?.length >= capacity
    && out.erasureFlags?.length >= capacity
    && out.rankPositions?.length >= capacity
    && out.erasurePositions?.length >= capacity
    && out.errataPositions?.length >= capacity
    && out.correctedPositions?.length >= capacity;
}

function setFailure(out, status, failure) {
  out.status = status;
  out.failure = failure;
  out.ok = 0;
  out.accepted = 0;
  return status;
}

function resetDecodeMetadata(out, n, nsym) {
  out.status = RS_SOFT_STATUS.OK;
  out.failure = RS_SOFT_FAILURE.NONE;
  out.ok = 0;
  out.accepted = 0;
  out.clean = 0;
  out.codewordLength = n;
  out.messageLength = n - nsym;
  out.nsym = nsym;
  out.erasureCount = 0;
  out.errorCount = 0;
  out.correctedCount = 0;
  out.errataCount = 0;
  out.tResidual = Math.floor(nsym / 2);
  out.parityMargin = nsym;
  out.acceptFailure = RS_SOFT_FAILURE.NONE;
}

function validNsym(nsym) {
  return Number.isInteger(nsym) && nsym > 0 && nsym <= MAX_CODEWORD_LEN;
}

function prepareSource(received, nsym, out) {
  if (
    !validWorkspace(out)
    || !isIndexable(received)
    || !validNsym(nsym)
    || received.length <= nsym
    || received.length > out.capacity
  ) {
    if (out !== null && out !== undefined) {
      setFailure(out, RS_SOFT_STATUS.INVALID_ARGUMENT, RS_SOFT_FAILURE.INVALID_ARGUMENT);
    }
    return RS_SOFT_STATUS.INVALID_ARGUMENT;
  }

  const n = received.length;
  for (let i = 0; i < n; i += 1) {
    const value = received[i];
    if (!Number.isInteger(value) || value < 0 || value >= P) {
      return setFailure(
        out,
        RS_SOFT_STATUS.INVALID_ARGUMENT,
        RS_SOFT_FAILURE.INVALID_ARGUMENT,
      );
    }
    // source protects the received word when it aliases out.codeword.
    out.source[i] = value;
  }
  for (let i = 0; i < n; i += 1) out.codeword[i] = out.source[i];
  // Public-call metadata must not leak from a prior frame. Internal GMD rungs
  // intentionally keep these selection fields after this one reset.
  out.eligible = 0;
  out.selectedErasureCount = 0;
  out.maxAdmissibleErasureCount = 0;
  out.crcStatus = CRC_NOT_CHECKED;
  resetDecodeMetadata(out, n, nsym);
  return RS_SOFT_STATUS.OK;
}

function computeSyndromes(source, n, nsym, syndromes) {
  let clean = 1;
  for (let syndrome = 0; syndrome < nsym; syndrome += 1) {
    const x = alphaPow(DEFAULT_FCR + syndrome);
    let value = source[0];
    for (let i = 1; i < n; i += 1) value = add(mul(value, x), source[i]);
    syndromes[syndrome] = value;
    if (value !== 0) clean = 0;
  }
  return clean;
}

function postcheckCodeword(codeword, n, nsym) {
  for (let syndrome = 0; syndrome < nsym; syndrome += 1) {
    const x = alphaPow(DEFAULT_FCR + syndrome);
    let value = codeword[0];
    for (let i = 1; i < n; i += 1) value = add(mul(value, x), codeword[i]);
    if (value !== 0) return 0;
  }
  return 1;
}

function evaluateLittleEndian(polynomial, degree, x) {
  let value = polynomial[degree];
  for (let i = degree - 1; i >= 0; i -= 1) {
    value = add(mul(value, x), polynomial[i]);
  }
  return value;
}

function loadErasurePositions(positions, positionCount, n, nsym, out) {
  if (!isIndexable(positions) || positionCount < 0 || positionCount > positions.length) {
    return -1;
  }
  out.seen.fill(0, 0, n);
  let uniqueCount = 0;
  for (let i = 0; i < positionCount; i += 1) {
    const position = positions[i];
    if (!Number.isInteger(position) || position < 0 || position >= n) return -1;
    if (out.seen[position] === 0) {
      out.seen[position] = 1;
      uniqueCount += 1;
    }
  }
  if (uniqueCount > nsym) return -2;

  let write = 0;
  for (let position = 0; position < n; position += 1) {
    if (out.seen[position] !== 0) {
      out.erasurePositions[write] = position;
      write += 1;
    }
  }
  out.erasureCount = uniqueCount;
  return uniqueCount;
}

/**
 * Fixed-buffer Berlekamp-Massey over the supplied syndrome window.
 * Returns the locator degree, or -1 when its materialized degree is invalid.
 */
function berlekampMasseyInto(syndromes, syndromeCount, out) {
  const lambda = out.lambda;
  const backup = out.bmBackup;
  const previous = out.bmPrevious;
  lambda.fill(0);
  backup.fill(0);
  previous.fill(0);
  lambda[0] = 1;
  backup[0] = 1;

  let locatorDegree = 0;
  let backupDegree = 0;
  let span = 0;
  let shift = 1;
  let lastDiscrepancy = 1;

  for (let index = 0; index < syndromeCount; index += 1) {
    let discrepancy = syndromes[index];
    for (let i = 1; i <= span; i += 1) {
      discrepancy = add(discrepancy, mul(lambda[i], syndromes[index - i]));
    }
    if (discrepancy === 0) {
      shift += 1;
      continue;
    }

    const scale = div(discrepancy, lastDiscrepancy);
    const oldDegree = locatorDegree;
    for (let i = 0; i <= oldDegree; i += 1) previous[i] = lambda[i];

    const newExtent = Math.max(locatorDegree, backupDegree + shift);
    for (let i = locatorDegree + 1; i <= newExtent; i += 1) lambda[i] = 0;
    for (let i = 0; i <= backupDegree; i += 1) {
      lambda[i + shift] = sub(lambda[i + shift], mul(scale, backup[i]));
    }
    locatorDegree = newExtent;
    while (locatorDegree > 0 && lambda[locatorDegree] === 0) locatorDegree -= 1;

    if (2 * span <= index) {
      span = index + 1 - span;
      for (let i = 0; i <= oldDegree; i += 1) backup[i] = previous[i];
      backupDegree = oldDegree;
      lastDiscrepancy = discrepancy;
      shift = 1;
    } else {
      shift += 1;
    }
  }

  if (locatorDegree !== span) return -1;
  return span;
}

function buildErasureLocator(n, erasureCount, out) {
  const gamma = out.gamma;
  gamma.fill(0);
  gamma[0] = 1;
  let degree = 0;
  for (let i = 0; i < erasureCount; i += 1) {
    const position = out.erasurePositions[i];
    const location = alphaPow(n - 1 - position);
    for (let coefficient = degree; coefficient >= 0; coefficient -= 1) {
      gamma[coefficient + 1] = sub(
        gamma[coefficient + 1],
        mul(gamma[coefficient], location),
      );
    }
    degree += 1;
  }
  return degree;
}

function buildForneySyndromes(nsym, erasureCount, out) {
  const count = nsym - erasureCount;
  for (let outputIndex = 0; outputIndex < count; outputIndex += 1) {
    const productIndex = outputIndex + erasureCount;
    let value = 0;
    const maxGamma = Math.min(erasureCount, productIndex);
    for (let gammaIndex = 0; gammaIndex <= maxGamma; gammaIndex += 1) {
      value = add(
        value,
        mul(out.gamma[gammaIndex], out.syndromes[productIndex - gammaIndex]),
      );
    }
    out.forneySyndromes[outputIndex] = value;
  }
  return count;
}

function combineLocators(errorDegree, erasureDegree, out) {
  const totalDegree = errorDegree + erasureDegree;
  out.locator.fill(0);
  for (let errorIndex = 0; errorIndex <= errorDegree; errorIndex += 1) {
    const errorCoefficient = out.lambda[errorIndex];
    if (errorCoefficient === 0) continue;
    for (let erasureIndex = 0; erasureIndex <= erasureDegree; erasureIndex += 1) {
      out.locator[errorIndex + erasureIndex] = add(
        out.locator[errorIndex + erasureIndex],
        mul(errorCoefficient, out.gamma[erasureIndex]),
      );
    }
  }
  let materializedDegree = totalDegree;
  while (materializedDegree > 0 && out.locator[materializedDegree] === 0) {
    materializedDegree -= 1;
  }
  return materializedDegree;
}

function findErrataPositions(n, locatorDegree, out) {
  let count = 0;
  for (let position = 0; position < n; position += 1) {
    const exponent = n - 1 - position;
    const x = alphaPow(-exponent);
    if (evaluateLittleEndian(out.locator, locatorDegree, x) === 0) {
      out.errataPositions[count] = position;
      count += 1;
    }
  }
  out.errataCount = count;
  return count;
}

function buildOmega(nsym, locatorDegree, out) {
  for (let coefficient = 0; coefficient < nsym; coefficient += 1) {
    let value = 0;
    const maxLocator = Math.min(locatorDegree, coefficient);
    for (let locatorIndex = 0; locatorIndex <= maxLocator; locatorIndex += 1) {
      value = add(
        value,
        mul(out.locator[locatorIndex], out.syndromes[coefficient - locatorIndex]),
      );
    }
    out.omega[coefficient] = value;
  }
}

function applyForney(source, n, nsym, locatorDegree, out) {
  let correctedCount = 0;
  for (let root = 0; root < out.errataCount; root += 1) {
    const position = out.errataPositions[root];
    const exponent = n - 1 - position;
    const x = alphaPow(-exponent);

    let denominator = 0;
    for (let coefficient = locatorDegree; coefficient >= 1; coefficient -= 1) {
      denominator = add(
        mul(denominator, x),
        mul(coefficient % P, out.locator[coefficient]),
      );
    }
    if (denominator === 0) return -1;

    let numerator = out.omega[nsym - 1];
    for (let coefficient = nsym - 2; coefficient >= 0; coefficient -= 1) {
      numerator = add(mul(numerator, x), out.omega[coefficient]);
    }

    const scaleExponent = exponent * (1 - DEFAULT_FCR);
    const rawMagnitude = mul(alphaPow(scaleExponent), div(numerator, denominator));
    const errorValue = sub(0, rawMagnitude);
    const corrected = sub(source[position], errorValue);
    out.codeword[position] = corrected;
    if (corrected !== source[position]) {
      out.correctedPositions[correctedCount] = position;
      correctedCount += 1;
    }
  }
  out.correctedCount = correctedCount;
  return correctedCount;
}

function succeedAttempt(out, errorCount, erasureCount, clean) {
  out.status = RS_SOFT_STATUS.OK;
  out.failure = RS_SOFT_FAILURE.NONE;
  out.ok = 1;
  out.clean = clean;
  out.errorCount = errorCount;
  out.erasureCount = erasureCount;
  out.tResidual = Math.floor((out.nsym - erasureCount) / 2);
  out.parityMargin = out.nsym - erasureCount - (2 * errorCount);
  return RS_SOFT_STATUS.OK;
}

function attemptFromSharedSyndromes(
  source,
  n,
  nsym,
  positions,
  positionCount,
  syndromesClean,
  out,
) {
  resetDecodeMetadata(out, n, nsym);
  for (let i = 0; i < n; i += 1) out.codeword[i] = source[i];

  const erasureCount = loadErasurePositions(
    positions,
    positionCount,
    n,
    nsym,
    out,
  );
  if (erasureCount === -1) {
    return setFailure(out, RS_SOFT_STATUS.INVALID_ARGUMENT, RS_SOFT_FAILURE.INVALID_ARGUMENT);
  }
  if (erasureCount === -2) {
    return setFailure(out, RS_SOFT_STATUS.DECODE_FAILED, RS_SOFT_FAILURE.TOO_MANY_ERASURES);
  }

  if (syndromesClean) {
    out.correctedCount = 0;
    out.errataCount = 0;
    return succeedAttempt(out, 0, erasureCount, 1);
  }

  const erasureDegree = buildErasureLocator(n, erasureCount, out);
  const forneySyndromeCount = buildForneySyndromes(nsym, erasureCount, out);
  const errorDegree = berlekampMasseyInto(
    out.forneySyndromes,
    forneySyndromeCount,
    out,
  );
  const tResidual = Math.floor((nsym - erasureCount) / 2);
  if (errorDegree < 0 || errorDegree > tResidual) {
    return setFailure(out, RS_SOFT_STATUS.DECODE_FAILED, RS_SOFT_FAILURE.BM_OVER_CAPACITY);
  }

  const locatorDegree = combineLocators(errorDegree, erasureDegree, out);
  if (locatorDegree !== errorDegree + erasureDegree) {
    return setFailure(out, RS_SOFT_STATUS.DECODE_FAILED, RS_SOFT_FAILURE.LOCATOR_DEGREE);
  }
  if (findErrataPositions(n, locatorDegree, out) !== locatorDegree) {
    return setFailure(out, RS_SOFT_STATUS.DECODE_FAILED, RS_SOFT_FAILURE.ROOT_COUNT);
  }

  buildOmega(nsym, locatorDegree, out);
  if (applyForney(source, n, nsym, locatorDegree, out) < 0) {
    return setFailure(
      out,
      RS_SOFT_STATUS.DECODE_FAILED,
      RS_SOFT_FAILURE.FORNEY_DENOMINATOR,
    );
  }

  out.postcheckComputations += 1;
  if (!postcheckCodeword(out.codeword, n, nsym)) {
    return setFailure(out, RS_SOFT_STATUS.DECODE_FAILED, RS_SOFT_FAILURE.POSTCHECK);
  }
  return succeedAttempt(out, errorDegree, erasureCount, 0);
}

function confidenceErrorProbabilityQ15(confidenceQ8, forcedErasure) {
  if (forcedErasure) return Q15_ONE;
  return ERROR_PROBABILITY_Q15[confidenceQ8];
}

function rankComesBefore(left, right, confidence, erasureFlags) {
  const leftForced = erasureFlags[left] !== 0;
  const rightForced = erasureFlags[right] !== 0;
  if (leftForced !== rightForced) return leftForced;
  if (confidence[left] !== confidence[right]) return confidence[left] < confidence[right];
  return left < right;
}

function buildConfidenceOrder(confidence, erasures, count, out) {
  for (let i = 0; i < count; i += 1) {
    const confidenceValue = confidence[i];
    if (
      !Number.isInteger(confidenceValue)
      || confidenceValue < 0
      || confidenceValue >= ERROR_PROBABILITY_Q15.length
    ) {
      return 0;
    }
    const forced = erasures !== null && erasures !== undefined && erasures[i] !== 0;
    out.erasureFlags[i] = forced ? 1 : 0;
    let insertion = i;
    while (
      insertion > 0
      && rankComesBefore(i, out.rankPositions[insertion - 1], confidence, out.erasureFlags)
    ) {
      out.rankPositions[insertion] = out.rankPositions[insertion - 1];
      insertion -= 1;
    }
    out.rankPositions[insertion] = i;
  }
  return 1;
}

function normalizedDelta(out) {
  const proposed = Number(out.delta);
  if (!Number.isFinite(proposed)) return DEFAULT_DETECTION_MARGIN;
  return Math.max(DEFAULT_DETECTION_MARGIN, Math.trunc(proposed));
}

function prefixMeetsExpectedBound(confidence, count, nsym, erasureCount, out) {
  let expectedErrorsQ15 = 0;
  for (let rank = erasureCount; rank < count; rank += 1) {
    const position = out.rankPositions[rank];
    expectedErrorsQ15 += confidenceErrorProbabilityQ15(
      confidence[position],
      out.erasureFlags[position] !== 0,
    );
  }
  return (2 * expectedErrorsQ15) + (erasureCount * Q15_ONE)
    <= (nsym - normalizedDelta(out)) * Q15_ONE;
}

/**
 * Pick the longest low-confidence prefix that satisfies the expected-error
 * gate and never reduces the remaining algebraic radius below three.
 */
export function selectErasures(symbolConfidenceQ8, erasures, nsym, out) {
  if (
    !validWorkspace(out)
    || !isIndexable(symbolConfidenceQ8)
    || symbolConfidenceQ8.length === 0
    || symbolConfidenceQ8.length > out.capacity
    || !validNsym(nsym)
    || nsym >= symbolConfidenceQ8.length
    || (erasures !== null
      && erasures !== undefined
      && (!isIndexable(erasures) || erasures.length < symbolConfidenceQ8.length))
  ) {
    if (out !== null && out !== undefined) {
      out.eligible = 0;
      out.erasureCount = 0;
      out.selectedErasureCount = 0;
      setFailure(out, RS_SOFT_STATUS.INVALID_ARGUMENT, RS_SOFT_FAILURE.INVALID_ARGUMENT);
    }
    return RS_SOFT_STATUS.INVALID_ARGUMENT;
  }

  const count = symbolConfidenceQ8.length;
  if (!buildConfidenceOrder(symbolConfidenceQ8, erasures, count, out)) {
    out.eligible = 0;
    out.erasureCount = 0;
    out.selectedErasureCount = 0;
    return setFailure(out, RS_SOFT_STATUS.INVALID_ARGUMENT, RS_SOFT_FAILURE.INVALID_ARGUMENT);
  }

  out.nsym = nsym;
  out.codewordLength = count;
  out.messageLength = count - nsym;
  out.maxAdmissibleErasureCount = 0;
  out.erasureCount = 0;
  out.selectedErasureCount = 0;
  out.tResidual = Math.floor(nsym / 2);
  out.eligible = 0;

  const maximumByResidual = Math.min(count, nsym - (2 * MIN_RESIDUAL_CORRECTIONS));
  if (maximumByResidual < 0) {
    out.status = RS_SOFT_STATUS.POLICY_INELIGIBLE;
    out.failure = RS_SOFT_FAILURE.NONE;
    return RS_SOFT_STATUS.POLICY_INELIGIBLE;
  }

  let forcedErasureCount = 0;
  for (let i = 0; i < count; i += 1) forcedErasureCount += out.erasureFlags[i];
  if (forcedErasureCount > maximumByResidual) {
    out.status = RS_SOFT_STATUS.POLICY_INELIGIBLE;
    out.failure = RS_SOFT_FAILURE.NONE;
    return RS_SOFT_STATUS.POLICY_INELIGIBLE;
  }

  let bestCount = -1;
  for (let candidateCount = 0; candidateCount <= maximumByResidual; candidateCount += 1) {
    if (prefixMeetsExpectedBound(
      symbolConfidenceQ8,
      count,
      nsym,
      candidateCount,
      out,
    )) {
      bestCount = candidateCount;
    }
  }

  if (bestCount < forcedErasureCount) {
    out.status = RS_SOFT_STATUS.NOT_READY;
    out.failure = RS_SOFT_FAILURE.NONE;
    return RS_SOFT_STATUS.NOT_READY;
  }

  for (let i = 0; i < bestCount; i += 1) {
    out.erasurePositions[i] = out.rankPositions[i];
  }
  out.status = RS_SOFT_STATUS.OK;
  out.failure = RS_SOFT_FAILURE.NONE;
  out.eligible = 1;
  out.erasureCount = bestCount;
  out.selectedErasureCount = bestCount;
  out.maxAdmissibleErasureCount = bestCount;
  out.tResidual = Math.floor((nsym - bestCount) / 2);
  return RS_SOFT_STATUS.OK;
}

/**
 * Standard errors-and-erasures BM/Chien/Forney decode over GF(211).
 * The algebraic candidate is written into out; final trust acceptance remains
 * a separate operation because this entry point has no confidence input.
 */
export function decodeErrorsAndErasures(received, nsym, erasurePositions, out) {
  const prepared = prepareSource(received, nsym, out);
  if (prepared !== RS_SOFT_STATUS.OK) return prepared;
  if (!isIndexable(erasurePositions)) {
    return setFailure(out, RS_SOFT_STATUS.INVALID_ARGUMENT, RS_SOFT_FAILURE.INVALID_ARGUMENT);
  }

  out.attemptCount = 1;
  out.acceptedRung = -1;
  out.syndromeComputations = 1;
  out.postcheckComputations = 0;
  const clean = computeSyndromes(
    out.source,
    out.codewordLength,
    nsym,
    out.syndromes,
  );
  return attemptFromSharedSyndromes(
    out.source,
    out.codewordLength,
    nsym,
    erasurePositions,
    erasurePositions.length,
    clean,
    out,
  );
}

function normalizedGmdDepth(out) {
  const proposed = Number(out.params?.gmdDepth);
  if (!Number.isFinite(proposed)) return 1;
  return Math.max(1, Math.min(MAX_CODEWORD_LEN, Math.trunc(proposed)));
}

function tryGmdRung(receivedLength, nsym, confidence, erasureCount, clean, out) {
  out.attemptCount += 1;
  const status = attemptFromSharedSyndromes(
    out.source,
    receivedLength,
    nsym,
    out.rankPositions,
    erasureCount,
    clean,
    out,
  );
  if (status !== RS_SOFT_STATUS.OK) return 0;
  if (!acceptDecode(out, confidence, out.tResidual)) return 0;
  out.accepted = 1;
  out.acceptedRung = erasureCount;
  return 1;
}

/**
 * Shallow deterministic GMD ladder. Every rung shares the initial syndrome;
 * increasing gmdDepth only appends attempts to the same fixed prefix.
 */
export function decodeGmdLadder(received, symbolConfidenceQ8, nsym, out) {
  const prepared = prepareSource(received, nsym, out);
  if (prepared !== RS_SOFT_STATUS.OK) return prepared;
  const n = out.codewordLength;
  if (!isIndexable(symbolConfidenceQ8) || symbolConfidenceQ8.length !== n) {
    return setFailure(out, RS_SOFT_STATUS.INVALID_ARGUMENT, RS_SOFT_FAILURE.INVALID_ARGUMENT);
  }

  out.attemptCount = 0;
  out.acceptedRung = -1;
  out.syndromeComputations = 1;
  out.postcheckComputations = 0;
  const clean = computeSyndromes(out.source, n, nsym, out.syndromes);
  const depth = normalizedGmdDepth(out);

  // T2: errors-only first. rankPositions is initialized to identity so the
  // zero-length position prefix is valid without a temporary array.
  for (let position = 0; position < n; position += 1) out.rankPositions[position] = position;
  if (tryGmdRung(n, nsym, symbolConfidenceQ8, 0, clean, out)) {
    return RS_SOFT_STATUS.OK;
  }
  if (depth === 1) {
    return setFailure(
      out,
      RS_SOFT_STATUS.REJECTED,
      RS_SOFT_FAILURE.NO_ACCEPTED_CANDIDATE,
    );
  }

  // T3: adaptive single trial. This public signature has no erasure-flag input,
  // so it ranks only the explicit confidence vector. Call selectErasures
  // separately when an adapter also has upstream C2 flags.
  //
  // ⚠ **2026-09-04 실측 — 위 안내는 이 경로에서 효과가 없다.** 바로 아래가
  // `selectErasures(symbolConfidenceQ8, null, …)` 를 **무조건** 불러 같은 `out` 의
  // `erasureFlags`·`rankPositions`·`selectedErasureCount`·`maxAdmissibleErasureCount`
  // 를 전부 덮어쓴다. 어댑터가 미리 부른 결과는 조용히 지워진다.
  // ⇒ C2 소거를 실제로 쓰려면 «따로 부르기» 가 아니라 **사다리에 소거 슬롯을 내는**
  //   변경이 필요하다 (PM/029B §18.5 ③). 그때까지 `decode-rs.js` 의 입력 소거는
  //   셀맵 전용이다.
  const selectionStatus = selectErasures(
    symbolConfidenceQ8,
    null,
    nsym,
    out,
  );
  const adaptiveCount = selectionStatus === RS_SOFT_STATUS.OK
    ? out.selectedErasureCount
    : 0;
  const maximumCount = selectionStatus === RS_SOFT_STATUS.OK
    ? out.maxAdmissibleErasureCount
    : 0;

  let attempted = 1;
  let adaptiveAttempted = 0;
  if (adaptiveCount > 0 && attempted < depth) {
    adaptiveAttempted = adaptiveCount;
    if (tryGmdRung(n, nsym, symbolConfidenceQ8, adaptiveCount, clean, out)) {
      return RS_SOFT_STATUS.OK;
    }
    attempted += 1;
  }

  // T4: classical even prefixes, skipping the adaptive duplicate. Because the
  // order and rung sequence do not depend on depth, D+1 is a strict extension
  // of D and the success set cannot shrink.
  for (
    let erasureCount = 2;
    attempted < depth && erasureCount <= maximumCount;
    erasureCount += 2
  ) {
    if (erasureCount === adaptiveAttempted) continue;
    if (!prefixMeetsExpectedBound(
      symbolConfidenceQ8,
      n,
      nsym,
      erasureCount,
      out,
    )) {
      continue;
    }
    if (tryGmdRung(n, nsym, symbolConfidenceQ8, erasureCount, clean, out)) {
      return RS_SOFT_STATUS.OK;
    }
    attempted += 1;
  }

  return setFailure(
    out,
    RS_SOFT_STATUS.REJECTED,
    RS_SOFT_FAILURE.NO_ACCEPTED_CANDIDATE,
  );
}

/**
 * Candidate acceptance without CRC logic. crcStatus is a reserved tri-state
 * hook: -1 means not checked by this layer, 0 lets a future format layer veto,
 * and 1 records an external pass.
 *
 * 배선 완료 · 급전 없음. 프레이밍 v2 가 열릴 때 여기에 값이 온다.
 * 트리거는 SPEC §3.3 예약절 (공개 SPEC) / 문서 repo SPEC §4.5 예약절.
 */
export function acceptDecode(candidate, symbolConfidenceQ8, tResidual) {
  if (
    candidate === null
    || candidate === undefined
    || candidate.ok !== 1
    || !isIndexable(symbolConfidenceQ8)
    || !Number.isInteger(candidate.codewordLength)
    || candidate.codewordLength <= 0
    || symbolConfidenceQ8.length < candidate.codewordLength
    || !Number.isInteger(tResidual)
    || tResidual < MIN_RESIDUAL_CORRECTIONS
    || !Number.isInteger(candidate.nsym)
    || candidate.nsym <= 0
    || candidate.nsym >= candidate.codewordLength
    || !Number.isInteger(candidate.erasureCount)
    || candidate.erasureCount < 0
    || candidate.erasureCount > candidate.nsym
    || !Number.isInteger(candidate.errorCount)
    || candidate.errorCount < 0
    || !Number.isInteger(candidate.correctedCount)
    || candidate.correctedCount < 0
    || !isIndexable(candidate.correctedPositions)
    || candidate.correctedCount > candidate.correctedPositions.length
    || candidate.correctedCount > candidate.codewordLength
    || (candidate.crcStatus !== -1
      && candidate.crcStatus !== 0
      && candidate.crcStatus !== 1)
  ) {
    return false;
  }

  const parityMargin = candidate.nsym
    - candidate.erasureCount
    - (2 * candidate.errorCount);
  const derivedResidual = Math.floor(
    (candidate.nsym - candidate.erasureCount) / 2,
  );
  if (derivedResidual !== candidate.tResidual || derivedResidual !== tResidual) {
    return false;
  }
  const delta = normalizedDelta(candidate);
  if (parityMargin < delta) return false;
  // crcStatus === 0 은 포맷 계층 veto. 프레이밍 v2 가 열릴 때 값이 온다
  // (SPEC §3.3 예약절). 지금은 항상 -1 (미검사) 이라 이 분기는 죽지 않는다.
  if (candidate.crcStatus === 0) return false;

  const thresholdRaw = Number(candidate.params?.erasureMarginQ8);
  const highConfidenceThreshold = Number.isFinite(thresholdRaw)
    ? Math.max(0, Math.trunc(thresholdRaw))
    : 3 * Q8_ONE;
  let highConfidenceCorrections = 0;
  for (let i = 0; i < candidate.correctedCount; i += 1) {
    const position = candidate.correctedPositions[i];
    if (
      !Number.isInteger(position)
      || position < 0
      || position >= symbolConfidenceQ8.length
    ) {
      return false;
    }
    for (let previous = 0; previous < i; previous += 1) {
      if (candidate.correctedPositions[previous] === position) return false;
    }
    if (symbolConfidenceQ8[position] >= highConfidenceThreshold) {
      highConfidenceCorrections += 1;
    }
  }

  // The exact threshold is a calibration hypothesis. The locked behavior is
  // that a strict majority of high-confidence flips cannot be accepted.
  return highConfidenceCorrections * 2 <= candidate.correctedCount;
}
