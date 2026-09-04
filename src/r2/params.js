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

  // 가설: glyph 적분 버퍼가 수용할 최대 luma 폭이다(자원 상한, px).
  glyphMaxFrameWidth: 1280,

  // 가설: glyph 적분 버퍼가 수용할 최대 luma 높이다(자원 상한, px).
  glyphMaxFrameHeight: 720,

  // 가설: 한 프레임에서 보존할 중앙 glyph 후보 상한이다.
  glyphMaxCandidates: 64,

  // 가설: scale·phase 커널 하나당 refinement에 넘길 coarse peak 상한은 16이다.
  glyphMaxKernelProposals: 16,

  // 가설: 정본 폴리곤을 소형 상관 커널로 내릴 때 셀 피치당 표본 수다.
  glyphKernelSamplesPerPitch: 3,

  // 가설: coarse scan도 모든 unique row-run을 읽어 noise/grid 우연 상관을 과대평가하지 않는다.
  glyphCoarseFeatureStep: 1,

  // 가설: 멀티스케일 탐색의 최소 바깥 셀 중심 피치는 8 px다(Q16.16).
  glyphMinCellPitchQ16: 8 * Q16_ONE,

  // 가설: 멀티스케일 탐색의 최대 바깥 셀 중심 피치는 128 px다(Q16.16).
  glyphMaxCellPitchQ16: 128 * Q16_ONE,

  // 가설: 인접 scale 비 1.04는 최근접 rung 양자화 오차를 약 2% 안에 둔다(Q1.15).
  glyphScaleStepQ15: Math.round(1.04 * Q15_ONE),

  // 가설: coarse scan 간격은 셀 피치의 0.50배이고 계층적으로 1 px까지 재탐색한다(Q1.15).
  glyphScanStrideQ15: Math.round(0.50 * Q15_ONE),

  // 가설: sub-pixel finder peak가 좁은 QR은 셀 피치의 0.15배로 훑는다(Q1.15).
  glyphQrScanStrideQ15: Math.round(0.15 * Q15_ONE),

  // 가설: unique-pixel glyph NCC의 정식 후보 수용 하한은 0.52다(Q1.15).
  glyphScoreThresholdQ15: Math.round(0.52 * Q15_ONE),

  // 가설: coarse 위치에서 0.28 이상이면 계층적 위치 refinement를 수행한다(Q1.15).
  glyphCoarseScoreThresholdQ15: Math.round(0.28 * Q15_ONE),

  // 가설: 방사형 bullseye는 coarse 격자 위상 손실을 감안해 0.12부터 보정한다(Q1.15).
  glyphBullseyeCoarseScoreThresholdQ15: Math.round(0.12 * Q15_ONE),

  // 가설: sub-pixel 충돌이 큰 5 px 미만 QR은 3-finder Haar NCC 0.42를 요구한다(Q1.15).
  glyphQrCoarseScoreThresholdQ15: Math.round(0.42 * Q15_ONE),

  // 가설: 5 px 이상 QR은 finder/separator NCC 0.60을 요구한다(Q1.15).
  glyphQrFineScoreThresholdQ15: Math.round(0.60 * Q15_ONE),

  // 가설: QR finder module이 안정적으로 분리되는 바깥 셀 피치는 5 px다(Q16.16).
  glyphQrFineCellPitchQ16: 5 * Q16_ONE,

  // 가설: 16 px 이하 피치는 area-aware unique-pixel kernel로 내린다(Q16.16).
  glyphDenseKernelMaxCellPitchQ16: 16 * Q16_ONE,

  // 가설: 한 pixel의 정본 support가 15% 미만이면 경계 잡음으로 버린다(Q1.15).
  glyphKernelMinCoverageQ15: Math.round(0.15 * Q15_ONE),

  // 가설: patch 표준편차가 luma 5 미만이면 상관 분모가 불안정하다고 본다(Q8.8).
  glyphMinStddevLumaQ8: 5 * Q8_ONE,

  // 가설: 같은 어휘의 중심이 셀 피치 0.12 안이면 같은 sub-pixel peak로 합친다(Q1.15).
  glyphNmsRadiusQ15: Math.round(0.12 * Q15_ONE),

  // 가설: 1.04 ladder의 이웃 scale은 pose 검증 전 보존하고 1.015 안만 합친다(Q1.15).
  glyphNmsScaleRatioQ15: Math.round(1.015 * Q15_ONE),

  // 가설: 중앙 QR 보호 사각을 슬롯 접촉점에서 0.5% 줄인다(Q1.15).
  glyphQrSlotSafetyQ15: Math.round(0.995 * Q15_ONE),

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
  // calibration inventory다.
  // ⚠ **「아직 소비하지 않는다」가 이 블록 전체에 대해 참이 아니다** (2026-09-04 실측):
  // 바로 아래 `gmdDepth` 는 `rs-soft.js` 가 읽어 **오늘 실제로 T3·T4 rung 을 돌린다.**
  // 즉 이 블록은 폭발 반경이 0 이 아니다 — 값을 바꾸기 전에 소비처를 grep 해라.
  //
  // 🔴 `minResidualCorrections: 4` 는 여기서 **지웠다** (2026-09-04). 저장소 전체에서
  // 참조가 0 이었고, 살아 있는 값은 `rs-soft.js` 의 상수 `MIN_RESIDUAL_CORRECTIONS = 3`
  // 이라 **값도 달랐다.** 배선했다면 F = min(4, ⌊nsym/2⌋) 가 되어 라인업의 nsym ≥ 8
  // 전 조합에서 소거 예산이 줄었을 것이다 (nsym 8 → 0칸, 10 → 2칸, 14 → 6칸).
  // ⚠ 「3 이 맞고 4 가 오타」인지 「4 가 목표고 3 이 잠정」인지는 git 으로 안 갈린다.
  //    다시 넣을 거면 그 답을 먼저 정해라 — 지금은 rs-soft.js 가 상수로 갖는다.

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
