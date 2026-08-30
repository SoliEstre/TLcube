/**
 * R2 calibration parameters.
 *
 * All tunable values remain hypotheses until the live-camera corpus replaces
 * them. Fixed-point scales are wire-independent implementation constants and
 * therefore live outside DEFAULT_R2_PARAMS.
 */

export const Q8_SHIFT = 8;
export const Q8_ONE = 1 << Q8_SHIFT;
export const Q15_ONE = 1 << 15;
export const Q16_ONE = 1 << 16;

export const DEFAULT_R2_PARAMS = Object.freeze({
  // 가설: 8-bit luma에서 pair-flip logistic 곡선의 초기 scale이다.
  rankMarginScaleLuma: 12,

  // 가설: 수치적으로 0인 rank likelihood를 막는 Q8.8 log floor다.
  rankLogFloorQ8: -32 * Q8_ONE,

  // 가설: 비정상 조명과 자세 변화를 잊는 λ=0.9 초기값이다.
  lambdaQ15: Math.round(0.9 * Q15_ONE),

  // 가설: 프레임 자기상관을 누르는 β=0.3 임시값이다.
  betaQ15: Math.round(0.3 * Q15_ONE),

  // 가설: max-minus-next가 3 nats를 넘으면 셀을 확정한다.
  tauCellQ8: 3 * Q8_ONE,

  // 가설: 심볼 합성에서 이 값 미만의 셀 gap은 erasure로 올린다.
  erasureMarginQ8: 3 * Q8_ONE,

  // 가설: 같은 대상의 확정 셀 재관측 오류율 p_e=5%다.
  pErrorQ15: Math.round(0.05 * Q15_ONE),

  // 가설: 다른 코드의 셀 불일치 확률은 mask 균등성에 기대어 5/6이다.
  pDifferentMismatchQ15: Math.round((5 / 6) * Q15_ONE),

  // 가설: false-drop 1e-3, false-keep 1e-2의 Wald drop 경계다.
  sprtDropThresholdQ8: Math.round(6.8977 * Q8_ONE),

  // 가설: same-target 의심 해제용 Wald 경계 B다.
  sprtReleaseThresholdQ8: Math.round(4.6042 * Q8_ONE),

  // 가설: 30 fps에서 0.4초에 해당하는 coast 만료 프레임 수다.
  nCoast: 12,

  // 예약 가설군: 아래 기하/track/정족수 값은 후속 detector·identity
  // calibration inventory이며 이번 R2 core scaffold는 아직 소비하지 않는다.
  // 가설: 기하 불연속 후보는 코드 폭의 0.5배 이동부터다.
  tauJumpQ16: Math.round(0.5 * Q16_ONE),

  // 가설: COAST 중 누적 회전 37.5도에서 조기 drop 후보가 된다.
  tauOmegaDegreesQ16: Math.round(37.5 * Q16_ONE),

  // 가설: 마지막 유효 누적 뒤 1.75초가 지나면 시간 만료 후보가 된다.
  maxContributionGapMs: 1750,

  // 가설: format/class 불일치는 2회 연속일 때 강한 모순으로 본다.
  classMismatchFrames: 2,

  // 가설: 새 track은 3개 gated frame으로 확인한다.
  newTrackConfirmFrames: 3,

  // 가설: 일반 M-of-N 확인 창은 문헌 전형인 M=3을 임시 사용한다.
  confirmM: 3,

  // 가설: 일반 M-of-N 확인 창은 문헌 전형인 N=5를 임시 사용한다.
  confirmN: 5,

  // 가설: SPRT 정족수 폴백을 허용할 최소 겹침 셀 수다.
  identityQuorumCells: 12,

  // 가설: 정족수 폴백의 mismatch 비율은 1/3이다.
  identityQuorumMismatchQ15: Math.round((1 / 3) * Q15_ONE),

  // 가설: layout이 m을 주지 않을 때 쓸 symbol-equivalent 안전분이다.
  progressSafetySymbols: 4,

  // 예약 가설군: 아래 decoder/UI 값은 후속 Chase·GMD·coaching wave의
  // calibration inventory이며 이번 R2 core scaffold는 아직 소비하지 않는다.
  // 가설: 소거 뒤에도 남겨 둘 최소 RS correction radius다.
  minResidualCorrections: 4,

  // 가설: 후속 symbol-Chase 후보 수 상한은 η=8이다.
  chaseEtaMax: 8,

  // 가설: one-pass GMD의 초기 소거 계단 깊이는 4다.
  gmdDepth: 4,

  // 가설: 진행 정체 코칭을 시작하는 시간은 1.75초다.
  progressStagnationMs: 1750,

  // 가설: 셀 상태 전이의 1회 fade-in 시간은 160 ms다.
  cellFadeMs: 160,
});

/**
 * Resolve per-session parameters once. This allocation is outside pushFrame.
 * Unknown keys are retained so injected detector/alignment adapters can share
 * the same calibration object without another side channel.
 */
export function createR2Params(overrides = undefined) {
  if (overrides === undefined || overrides === null) {
    return DEFAULT_R2_PARAMS;
  }
  return Object.freeze({ ...DEFAULT_R2_PARAMS, ...overrides });
}
