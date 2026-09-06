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

/**
 * 🔴 **단조 유지(hold)를 푼다** — `view.D` 를 지금의 `internalD` 로 되돌린다 (2026-09-06 검토 R3c, 결함 5).
 *
 * `updateProgress` 의 D 는 단조다(내려가면 옛 값을 붙든다). 「모으는 중에는 막대가 뒷걸음질하지
 * 않는다」가 그 이유이고, **같은 코드를 계속 보는 동안**에는 옳다. 옳지 않은 자리가 둘 있다:
 *   · 드랍(신원을 잃음) — 「같은 코드다」의 근거가 사라졌는데 막대는 그대로다.
 *   · 오염(같은 n·layout·ecc·mask 의 **다른** 코드로 갈아탐) — 실측(review-R-out-swap/contam)에서
 *     교체 첫 프레임에 `internalD ≥ 1` 이 나와 D 가 **1.00 으로 뛴 뒤 영구 고정**됐다. 화면은
 *     「다 찼는데 안 풀림」인데, 그 뒤 수십 프레임의 RS 는 전부 실패다.
 * 여기서 되돌리면 그 뒤의 D 는 다시 **지금 증거의 이야기**를 한다. 되돌린 값이 곧바로 다시 오르면
 * 그건 증거가 실제로 있는 것이다 — 잃는 것이 없다.
 */
export function releaseProgressHold(progress) {
  if (progress === null || progress === undefined) return undefined;
  progress.view.D = progress.view.internalD;
  progress.view.hold = 0;
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

