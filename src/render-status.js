// render-status.js — 생성기 렌더 결과와 에러 표시의 단일 경계

/**
 * ── 자체검증 3태 판정 (운영자 지시 2026-08-16) ─────────────────────────────
 *
 * 라벨(사용가능 / 인식곤란 / 사용불가)은 새로 만든 등급이 아니라 **자체검증이 이미
 * 쓰고 있는 게이트의 여유**에서 기계적으로 나온다. 게이트마다 «한계 대비 관측» 비율
 * h 를 만든다 — h ≤ 1 이 통과이고, h 가 1 에 가까울수록 아슬아슬하다:
 *
 *   Δ 게이트 (O/A · Y 3톤)   h = deltaMinContract / minDelta(Y)   (계약 0.12)
 *   잔차 게이트 (Y)           h = maxResidual / ε_fit              (계약 0.01)
 *   θ 마진 (Y 2톤)            h = 1 − logMargin / idealLogMargin
 *       idealLogMargin = ½·ln(y_hi / y_lo). θ_f = √(y_lo·y_hi) 이므로 두 앵커는
 *       로그 도메인에서 정확히 그만큼 θ 에서 떨어져 있다 — 관측 마진이 그 절반으로
 *       줄면 h = 0.5. 2톤의 ok 게이트에는 마진 하한이 아예 없어서, 이 항이 없으면
 *       «성공이지만 경계» 를 잴 자가 하나도 없다.
 *
 * 판정: 실패면 'unusable', 성공이지만 max(h) > tightRatio 면 'marginal', 아니면 'usable'.
 *
 * ⚠ 이 라벨은 «렌더가 자기 계약을 얼마나 여유 있게 지켰는가» 다. **라이브 인식률
 *   예측이 아니다** — 그 주장에는 실측 근거가 없다 (파인더 점수판 g492 와 같은 규율).
 */
export const SELFCHECK_TIGHT_RATIO = 0.8;

/**
 * 화면에 적는 «문턱 %» — 띠 폭에서 **유도한다**. 사전 문자열에 20 을 손으로 박으면
 * 띠 폭을 옮기는 날 문구만 옛 숫자로 남는다.
 */
export function selfCheckTightPercent(tight = SELFCHECK_TIGHT_RATIO) {
  return Math.round((1 - tight) * 100);
}

/**
 * 여유 %. 두 가지를 같이 지킨다.
 *
 * ① **내림**이어야 한다. 반올림이면 h = 0.801~0.805 구간에서 화면이 «게이트 여유 20%
 *    — 20% 미만이면 «인식곤란»» 이라 써 놓고 뱃지는 «인식곤란» 을 띄운다. 폭은 0.5pt
 *    지만 문구가 자기 자신과 어긋난다 (2026-08-16 적대 검증 nit 1).
 * ② 그렇다고 순수 `Math.floor` 는 못 쓴다. 이진부동소수 때문에 «정확히 19%» 인 입력이
 *    18.999999999999996 으로 떨어져 18 로 내려간다 (잔차 0.0081 / ε 0.01 이 실제로 그렇다).
 *    그래서 1e-9 만큼 들어 올린 뒤 내린다.
 *
 * 마지막으로 표시값을 판정과 같은 쪽에 **붙인다**. 위 두 보정을 하고도 경계에서 어긋날
 * 여지를 남기지 않는다 — «뱃지와 문구가 서로 다른 말을 하지 않는다» 가 계약이다.
 */
function headroomPercentFor(ratio, tight, marginal) {
  const tightPercent = selfCheckTightPercent(tight);
  const raw = Math.max(0, Math.min(100, Math.floor((1 - ratio) * 100 + 1e-9)));
  return marginal ? Math.min(raw, tightPercent - 1) : Math.max(raw, tightPercent);
}

/**
 * 게이트별 «한계 대비 관측» 비율의 최댓값. 0 = 여유 만점, 1 = 게이트 위.
 * @param {object} check verifyRaster / verifyRasterY 산출물
 * @param {{deltaMinContract:number, idealLogMargin?:number}} contract
 * @returns {number} 0..1
 */
export function selfCheckGateRatio(check, contract) {
  const { deltaMinContract, idealLogMargin } = contract;
  if (!(deltaMinContract > 0)) throw new RangeError('deltaMinContract 는 양수여야 한다');
  const ratios = [];
  if (Number.isFinite(check.minDelta) && check.minDelta > 0) {
    ratios.push(deltaMinContract / check.minDelta);
  }
  if (Number.isFinite(check.minDeltaY) && check.minDeltaY > 0) {
    ratios.push(deltaMinContract / check.minDeltaY);
  }
  const gate = check.residualGate;
  if (gate && Number.isFinite(gate.maxResidual) && gate.epsilon > 0) {
    ratios.push(gate.maxResidual / gate.epsilon);
  }
  if (Number.isFinite(check.logMargin) && check.logMargin >= 0
      && Number.isFinite(idealLogMargin) && idealLogMargin > 0) {
    ratios.push(1 - check.logMargin / idealLogMargin);
  }
  if (ratios.length === 0) return 0;
  return Math.max(0, Math.min(1, Math.max(...ratios)));
}

/**
 * 3태 판정.
 * @returns {{state:'usable'|'marginal'|'unusable', ratio:number|null, headroomPercent:number|null, tightPercent:number}}
 */
export function selfCheckVerdict(check, contract) {
  const tight = contract.tightRatio === undefined ? SELFCHECK_TIGHT_RATIO : contract.tightRatio;
  const tightPercent = selfCheckTightPercent(tight);
  if (!check || check.ok !== true) {
    return { state: 'unusable', ratio: null, headroomPercent: null, tightPercent };
  }
  const ratio = selfCheckGateRatio(check, contract);
  const marginal = ratio > tight;
  return {
    state: marginal ? 'marginal' : 'usable',
    ratio,
    headroomPercent: headroomPercentFor(ratio, tight, marginal),
    tightPercent,
  };
}

function errorMessage(error) {
  return String(error && error.message ? error.message : error);
}

/**
 * 동기 렌더 작업을 실행하고 표시를 그 결과로 완전히 교체한다.
 * 성공 콜백이 빈 문자열을 반환하면 이전 경로에서 남긴 어떤 에러도 비워진다.
 */
export function renderWithErrorDisplay(errorOutput, renderOperation, onError = () => {}) {
  if (!errorOutput || typeof errorOutput !== 'object') {
    throw new TypeError('errorOutput 객체가 필요하다');
  }
  if (typeof renderOperation !== 'function' || typeof onError !== 'function') {
    throw new TypeError('renderOperation 과 onError 콜백이 필요하다');
  }

  try {
    const successMessage = renderOperation();
    errorOutput.textContent =
      successMessage === undefined || successMessage === null ? '' : String(successMessage);
    return true;
  } catch (error) {
    errorOutput.textContent = errorMessage(error);
    onError(error);
    return false;
  }
}
