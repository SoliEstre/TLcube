export const PROGRESS_STATUS = Object.freeze({
  OK: 0,
  INVALID_ARGUMENT: 1,
});

// Proposed compact state texture vocabulary for the renderer adapter.
export const CELL_MAP_STATE = Object.freeze({
  UNOBSERVED: 0,
  CANDIDATE: 1,
  CONFIRMED: 2,
  ERASURE: 3,
});

export function createProgress(cellCount) {
  const count = Math.max(0, Math.trunc(Number(cellCount)));
  const cellMap = new Uint8Array(count);
  const view = {
    status: PROGRESS_STATUS.OK,
    D: 0,
    internalD: 0,
    hold: 0,
    cellMap,
  };
  return {
    cellCount: count,
    cellMap,
    view,
  };
}

/**
 * C_eff, requiredUnits, and marginUnits must use the same unit. The session
 * supplies symbol-equivalents so SPEC byte K cannot be confused with this K.
 */
export function updateProgress(progress, cEff, requiredUnits, marginUnits) {
  if (
    progress === null
    || progress === undefined
    || !Number.isFinite(cEff)
    || !Number.isFinite(requiredUnits)
    || !Number.isFinite(marginUnits)
    || cEff < 0
    || requiredUnits < 0
    || marginUnits < 0
    || requiredUnits + marginUnits <= 0
  ) {
    if (progress !== null && progress !== undefined) {
      progress.view.status = PROGRESS_STATUS.INVALID_ARGUMENT;
      return progress.view;
    }
    return undefined;
  }

  const internal = Math.min(1, cEff / (requiredUnits + marginUnits));
  const previous = progress.view.D;
  progress.view.status = PROGRESS_STATUS.OK;
  progress.view.internalD = internal;
  if (internal < previous) {
    progress.view.hold = 1;
  } else {
    progress.view.D = internal;
    progress.view.hold = 0;
  }
  return progress.view;
}

export function holdProgress(progress) {
  if (progress === null || progress === undefined) return undefined;
  progress.view.hold = 1;
  return progress.view;
}

export function resetProgress(progress) {
  if (progress === null || progress === undefined) return undefined;
  progress.cellMap.fill(CELL_MAP_STATE.UNOBSERVED);
  progress.view.status = PROGRESS_STATUS.OK;
  progress.view.D = 0;
  progress.view.internalD = 0;
  progress.view.hold = 0;
  return progress.view;
}

export function setCellMapState(progress, cell, state) {
  if (
    progress === null
    || progress === undefined
    || cell < 0
    || cell >= progress.cellCount
    || state < CELL_MAP_STATE.UNOBSERVED
    || state > CELL_MAP_STATE.ERASURE
  ) {
    return PROGRESS_STATUS.INVALID_ARGUMENT;
  }
  progress.cellMap[cell] = state;
  return PROGRESS_STATUS.OK;
}

