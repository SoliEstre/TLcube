/**
 * scanner-accept-delay.js — **수용 뒤 «닫기» 유예** (운영자 결정 ⑯ = (i) · 2026-09-06 실기 4차).
 *
 * ## 무엇을 푸는가
 * R2 가 읽어 낸 적중이 문을 통과하면 같은 태스크에서 `stopCamera()` 가 돌고, 그 안의
 * `renderR2CellMap()` 이 캔버스를 `hidden = true` 로 세운다 — 즉 «RS 가 이 셀들을 고쳤다» 는
 * 정정 강조가 브라우저에 **한 프레임도 합성되지 않는다** (3b 검토 F1). 결정 (i) 는 그 표면을
 * 「수용은 그대로 두고 **닫기만** R2_HUD_CORRECTION_MS 만큼 미룬다」로 연다.
 *
 * ## 여기 있는 것 / 없는 것
 * · 여기: 「얼마나 미루는가」(순수 함수)와 「미룬 상태를 어떻게 정확히 한 번 회수하는가」(문지기).
 * · 여기 없음: `stopCamera` · 결과 시트 · 캔버스. 전부 호출자(sites/tlscan/scanner.js)의 몫이다.
 *   그래야 타이밍을 **가짜 시계**로 값으로 잴 수 있다 (A6 의 시간 기반 효과 규약과 같다).
 *
 * ## 사본 금지
 * 유예 길이의 정본은 `R2_HUD_CORRECTION_MS`(src/r2-hud-model.js) 하나다 — 강조가 살아 있는 창과
 * 카메라가 살아 있는 창이 **같은 수**여야 「보이는 시간 = 유예」가 성립한다. 여기서 숫자를 다시
 * 적으면 한쪽을 바꾸는 날 강조가 끝난 뒤에도 카메라가 켜져 있거나 그 반대가 된다.
 */

import { R2_HUD_CORRECTION_MS } from './r2-hud-model.js';
import { R2_CANDIDATE_SUCCESS_MS } from './r2-candidate-hud-model.js';

/** 객체가 아니면 빈 객체 — 어떤 입력에도 예외를 내지 않는다. */
function asObject(value) {
  return (value !== null && typeof value === 'object') ? value : {};
}

/**
 * **유예 길이** — 0 이면 「미루지 않는다」(호출자가 종전처럼 즉시 닫는다).
 *
 * 규칙은 둘뿐이다:
 *   ① R2 엔진으로 **수용된** 적중일 것 (`engineR2`). R1·QR·사진 결과에는 그릴 강조가 없다.
 *   ② 정정 셀이 **실제로 있을 것** (`correctedCount > 0`). 0 이면 보여 줄 것이 없으므로 미루는 시간이
 *      그대로 「결과가 늦게 뜬다」가 된다 — 종전처럼 즉시 닫는 것이 옳다.
 *
 * @param {{engineR2?: boolean, correctedCount?: number, delayMs?: number}} input
 * @returns {number} 0 (즉시) 또는 delayMs (기본 R2_HUD_CORRECTION_MS)
 */
export function acceptStopDelayMs(input) {
  const src = asObject(input);
  if (src.engineR2 !== true) return 0;
  // 후보 HUD의 초록 성공 표시는 정정 유무와 무관하며 기존 유예에 더하지 않아요.
  if (src.candidateHud === true) return R2_CANDIDATE_SUCCESS_MS;
  const count = Number(src.correctedCount);
  if (!Number.isFinite(count) || count <= 0) return 0;
  const delay = src.delayMs === undefined ? R2_HUD_CORRECTION_MS : Number(src.delayMs);
  if (!Number.isFinite(delay) || delay <= 0) return 0;
  return delay;
}

/**
 * **유예 문지기** — 「지금 유예 중인가」와 「그 나머지 절반을 누가 가져가는가」만 안다.
 *
 * 불변식 (test/scanner-accept-delay.test.js 가 가짜 시계로 값으로 잰다):
 *   (b) 유예 중에는 두 번째 수용이 없다 — `arm()` 이 false 를 돌려주고 쥐고 있는 것을 안 바꾼다.
 *   (c) `take()` 는 타이머를 지우고 나머지 절반을 **한 번만** 내준다 — 두 번째 회수는 null 이고,
 *       회수된 뒤에는 만료 콜백이 돌지 않는다(늦은 타이머가 카메라를 두 번 끄지 않는다).
 *   (d) 만료는 `onExpire()` 한 번 — 호출자가 그 안에서 stopCamera 를 돌고, stopCamera 가 `take()` 로
 *       나머지 절반(결과 시트)을 이어 붙인다. 그래서 순서는 승격 전과 같다: 정지 → 결과 시트.
 *
 * @param {{setTimer?: Function, clearTimer?: Function}} [options] 시계 주입 (기본 전역 setTimeout/clearTimeout)
 */
export function createAcceptStopGate(options) {
  const opts = asObject(options);
  const setTimer = typeof opts.setTimer === 'function' ? opts.setTimer : setTimeout;
  const clearTimer = typeof opts.clearTimer === 'function' ? opts.clearTimer : clearTimeout;

  let timer = null;
  let pending = null;
  let readiness = null;
  let startTimer = null;

  function poll() {
    if (pending === null || startTimer === null) return false;
    if (readiness !== null && !readiness()) return false;
    const start = startTimer;
    startTimer = null;
    readiness = null;
    start();
    return true;
  }

  return {
    /** 유예 중인가 — 프레임 루프와 결과 문이 「두 번째 수용 금지」를 이 하나로 읽는다. */
    isPending() {
      return pending !== null;
    },

    /**
     * 유예를 건다. `delayMs <= 0` 이거나 이미 유예 중이면 **걸지 않고** false —
     * 호출자는 false 를 「종전처럼 즉시 닫아라」로 읽는다.
     *
     * @param {number} delayMs `acceptStopDelayMs` 의 출력
     * @param {Function} rest 닫기의 나머지 절반 (결과 시트). 보관만 하고 여기서 부르지 않는다.
     * @param {Function} onExpire 만료 시 호출자가 돌릴 것 (stopCamera).
     */
    arm(delayMs, rest, onExpire, ready = null) {
      if (pending !== null) return false;
      if (typeof rest !== 'function' || typeof onExpire !== 'function') return false;
      if (ready !== null && typeof ready !== 'function') return false;
      const ms = Number(delayMs);
      if (!Number.isFinite(ms) || ms <= 0) return false;
      pending = rest;
      readiness = ready;
      // 이미 수용된 결과만 기다려요. 카드를 축출하지 않고 빈자리가 날 때까지
      // pending을 유지하며, 초록이 실제로 켜진 때부터 표시 시간을 세어요.
      startTimer = () => {
        timer = setTimer(() => {
          timer = null;
          onExpire();
        }, ms);
      };
      poll();
      return true;
    },

    /** rAF 표시 뒤 재시도해요. 이미 시작했거나 회수된 타이머는 다시 걸지 않아요. */
    poll,

    /**
     * 유예를 회수한다 — 타이머를 지우고 나머지 절반을 돌려준다(없으면 null).
     * 회수는 **한 번**이다: 두 번째 호출은 null 이고 타이머는 이미 죽어 있다.
     */
    take() {
      const rest = pending;
      pending = null;
      readiness = null;
      startTimer = null;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      return rest;
    },
  };
}
