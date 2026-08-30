import {
  Q8_ONE,
  Q15_ONE,
  createR2Params,
} from './params.js';

export const IDENTITY_STATE = Object.freeze({
  ACTIVE: 0,
  COAST: 1,
  DROPPED: 2,
});

export const IDENTITY_DROP_REASON = Object.freeze({
  NONE: 0,
  SPRT: 1,
  COAST_EXPIRED: 2,
  EXPLICIT: 3,
});

export const IDENTITY_STATUS = Object.freeze({
  OK: 0,
  INVALID_ARGUMENT: 1,
});

function probabilityFromQ15(value) {
  return Math.max(1 / Q15_ONE, Math.min(1 - (1 / Q15_ONE), value / Q15_ONE));
}

/**
 * The session starts after a candidate target exists, so its public initial
 * state is ACTIVE. Candidate M-of-N initiation remains a detector adapter job.
 */
export function createIdentity(paramsOverride = undefined) {
  const params = createR2Params(paramsOverride);
  const pError = probabilityFromQ15(params.pErrorQ15);
  const pDifferentMismatch = probabilityFromQ15(params.pDifferentMismatchQ15);

  return {
    state: IDENTITY_STATE.ACTIVE,
    dropReason: IDENTITY_DROP_REASON.NONE,
    coastFrames: 0,
    sprtQ8: 0,
    mismatchIncrementQ8: Math.round(
      Math.log(pDifferentMismatch / pError) * Q8_ONE,
    ),
    matchIncrementQ8: Math.round(
      Math.log((1 - pDifferentMismatch) / (1 - pError)) * Q8_ONE,
    ),
    params,
  };
}

export function resetIdentity(identity, initialState = IDENTITY_STATE.ACTIVE) {
  if (identity === null || identity === undefined) return IDENTITY_STATUS.INVALID_ARGUMENT;
  identity.state = initialState;
  identity.dropReason = IDENTITY_DROP_REASON.NONE;
  identity.coastFrames = 0;
  identity.sprtQ8 = 0;
  return IDENTITY_STATUS.OK;
}

export function dropIdentity(identity, reason = IDENTITY_DROP_REASON.EXPLICIT) {
  if (identity === null || identity === undefined) return IDENTITY_STATUS.INVALID_ARGUMENT;
  identity.state = IDENTITY_STATE.DROPPED;
  identity.dropReason = reason;
  return IDENTITY_STATUS.OK;
}

function advanceCoast(identity) {
  identity.state = IDENTITY_STATE.COAST;
  identity.coastFrames += 1;
  if (identity.coastFrames >= Math.max(1, Math.trunc(identity.params.nCoast))) {
    identity.state = IDENTITY_STATE.DROPPED;
    identity.dropReason = IDENTITY_DROP_REASON.COAST_EXPIRED;
  }
  return identity.state;
}

/**
 * Update one frame with no temporary objects.
 *
 * detected && gatePassed is the only path allowed to update the SPRT. During
 * ACTIVE, a one-sided max(0, Λ) detector avoids unlimited inertia from old
 * matches. During COAST, the two-sided score must cross -B before resuming.
 */
export function observeIdentity(
  identity,
  detected,
  gatePassed,
  mismatchCount = 0,
  matchCount = 0,
) {
  if (identity === null || identity === undefined) return IDENTITY_STATE.DROPPED;
  if (identity.state === IDENTITY_STATE.DROPPED) return identity.state;

  if (!detected || !gatePassed) return advanceCoast(identity);

  const mismatches = Math.max(0, Math.trunc(mismatchCount));
  const matches = Math.max(0, Math.trunc(matchCount));
  const delta = (mismatches * identity.mismatchIncrementQ8)
    + (matches * identity.matchIncrementQ8);
  const dropThreshold = Math.max(1, Math.trunc(identity.params.sprtDropThresholdQ8));

  if (identity.state === IDENTITY_STATE.COAST) {
    identity.sprtQ8 += delta;
    if (identity.sprtQ8 >= dropThreshold) {
      identity.state = IDENTITY_STATE.DROPPED;
      identity.dropReason = IDENTITY_DROP_REASON.SPRT;
      return identity.state;
    }

    const releaseThreshold = Math.max(1, Math.trunc(identity.params.sprtReleaseThresholdQ8));
    if (identity.sprtQ8 <= -releaseThreshold) {
      identity.state = IDENTITY_STATE.ACTIVE;
      identity.coastFrames = 0;
      identity.sprtQ8 = 0;
      return identity.state;
    }

    // A gated but inconclusive frame does not silently verify the old track.
    return advanceCoast(identity);
  }

  identity.sprtQ8 = Math.max(0, identity.sprtQ8 + delta);
  if (identity.sprtQ8 >= dropThreshold) {
    identity.state = IDENTITY_STATE.DROPPED;
    identity.dropReason = IDENTITY_DROP_REASON.SPRT;
  }
  return identity.state;
}

