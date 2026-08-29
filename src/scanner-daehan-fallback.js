/**
 * scanner-daehan-fallback.js — «이 프레임에서 daehan 2차 패스를 돌릴 것인가» 판정.
 *
 * DOM·카메라·디코더를 모르는 순수 모듈이다 (`scanner-camera-lifecycle.js` 전례).
 * scanner.js 는 배선만 하고 판정은 전부 여기서 한다 — 분기 규칙이 두 곳에 적히면
 * 반드시 어긋나고, 폴백은 «디코더 기본 경로를 우회하는 것이 존재 이유» 라
 * 파이프라인 왕복 테스트가 구조적으로 못 지키는 축이다. 그래서 규칙 자체를 재는
 * 자(test/scanner-daehan-fallback.test.js)가 이 모듈에 붙는다.
 *
 * ── 설계 (2026-08-30, 레인 scanread) ────────────────────────────────────────
 * 1차 패스는 현행 그대로다(비트 동일). 실패한 프레임만 daehan 라인업으로 2차
 * 패스를 돌린다. 성공하던 레거시 프레임은 구조상 결과·비용이 안 변하고, 비용은
 * 실패 프레임에만 붙는다. 라이브는 그 비용에 스로틀로 상한을 건다.
 */

/**
 * 라이브 카메라에서 **연속 실패 몇 번마다 한 번** 2차 패스를 돌리는가.
 *
 * 근거 — daehan 라인업의 지배 비용은 «후보 하나 더» 가 아니라 «발자국 하나 더» 다
 * (bootstrap.js 헤더: 레거시 프레임 14 → 17 라인업이 16.1 ms → 267.4 ms, ×16.6).
 * 라이브에서 사용자가 조준 중인 «코드 없는 장면» 은 매 프레임이 실패이므로, 스로틀이
 * 없으면 그 ×16.6 을 **매 프레임** 낸다. 4 로 나누면 상한이 실패 프레임 기준 평균
 * 1/4 로 내려가고, daehan 코드를 겨눈 사용자는 4프레임(≈0.4\~1 s) 안에 반드시 한 번은
 * 2차 패스를 받는다 — 사람이 «안 읽힌다» 고 판단하기 전이다.
 *
 * ⚠ 이 값은 «싸다» 가 아니라 «비싼 줄 알지만 상한을 건다» 는 뜻이다. 합성 렌더에서
 *   잰 +6\~10% 는 daehan **코드가 있는** 장면의 수치라 이 상수의 근거가 아니다
 *   (코드 없는 장면의 실기기 비용은 좌석 코퍼스 몫).
 */
export const DAEHAN_FALLBACK_LIVE_STRIDE = 4;

/** 연속 실패 카운터의 초기 상태. */
export const DAEHAN_FALLBACK_INITIAL_STATE = Object.freeze({ consecutiveFailures: 0 });

/** 2차 패스를 안 돌린 이유 (lab 분석이 «안 돈 것» 과 «돌았는데 실패» 를 가른다). */
export const DAEHAN_FALLBACK_SKIP = Object.freeze({
  /** 1차 패스가 성공했다. */
  FIRST_PASS_OK: 'first-pass-ok',
  /** /lab/ 토글이 1차 패스부터 daehan 을 강제했다 — 얹을 것이 없다. */
  ALREADY_DAEHAN: 'already-daehan',
  /** 사전 포즈 패스라 라인업 자체를 안 본다 (아래 주석 참조). */
  PRIOR_POSES: 'prior-poses',
  /** 라이브 스로틀에 걸렸다. */
  THROTTLED: 'throttled',
});

function boolOf(value) {
  return value === true;
}

/**
 * 프레임 한 번의 폴백 판정 + 연속 실패 카운터 갱신.
 *
 * @param {{consecutiveFailures?: number}} state 직전 상태 (초기값 `DAEHAN_FALLBACK_INITIAL_STATE`)
 * @param {{
 *   source?: 'live'|'still',
 *   firstPassOk?: boolean,
 *   daehanForced?: boolean,
 *   usedPriorPoses?: boolean,
 *   stride?: number,
 * }} frame 1차 패스가 끝난 시점의 관측값
 * @returns {{state: {consecutiveFailures: number}, escalate: boolean, skip: string}}
 */
export function daehanFallbackDecision(state = {}, frame = {}) {
  const previous = Number.isInteger(state.consecutiveFailures) && state.consecutiveFailures >= 0
    ? state.consecutiveFailures
    : 0;
  const stride = Number.isInteger(frame.stride) && frame.stride > 0
    ? frame.stride
    : DAEHAN_FALLBACK_LIVE_STRIDE;

  // 성공·비-실패 프레임은 카운터를 리셋한다. 「연속」 실패가 스로틀의 단위이므로
  // 한 번이라도 읽히면 다음 실패는 다시 1번째다 (= 즉시 2차 패스를 받는다).
  if (boolOf(frame.firstPassOk)) {
    return {
      state: { consecutiveFailures: 0 },
      escalate: false,
      skip: DAEHAN_FALLBACK_SKIP.FIRST_PASS_OK,
    };
  }

  // /lab/ 토글이 켜져 있으면 1차 패스가 **이미** daehan 라인업이다. 2차 패스는
  // 같은 입력에 같은 라인업을 한 번 더 도는 것이라 결과가 정의상 같고 비용만 두 배다.
  // 토글의 의미는 «1차 패스부터 daehan 강제» 이고, 폴백은 그와 직교인 정식 기본 동작이다.
  if (boolOf(frame.daehanForced)) {
    return {
      state: { consecutiveFailures: 0 },
      escalate: false,
      skip: DAEHAN_FALLBACK_SKIP.ALREADY_DAEHAN,
    };
  }

  /*
   * 사전 포즈 패스는 **라인업을 아예 안 본다.** frontend.js:220 이 `priorPoses` 가
   * 있으면 `enumeratePriorGridHypotheses` 로 갈라져 탐색 단계(=`enumerateGeometry
   * HypothesesImpl` → `discoverFinders` → `discoverCellFinders` → `cellFinderLineupFor`)를
   * 통째로 건너뛴다. 즉 여기서 daehan 을 켜면 **결과가 바이트 그대로이고 비용만 는다**
   * (프로브 실측 2026-08-30: 같은 daehan 렌더 × 12 포즈에서 ok·reason·text·가설수 전부
   * 동일). 「실패했으니 켜 보자」 가 통하지 않는 유일한 경로라 판정에 이름을 붙여 둔다.
   *
   * 카운터는 리셋도 증가도 안 한다 — 실패이므로 리셋하면 스로틀이 무의미해지고,
   * 증가시키면 «2차 패스를 받을 수 없는 프레임» 이 다른 프레임의 차례를 먹는다.
   */
  if (boolOf(frame.usedPriorPoses)) {
    return {
      state: { consecutiveFailures: previous },
      escalate: false,
      skip: DAEHAN_FALLBACK_SKIP.PRIOR_POSES,
    };
  }

  // 정지 입력(업로드·파일)은 프레임이 한 장뿐이라 스로틀할 대상이 없다. 여기서
  // 아끼면 사용자에게 남는 건 «안 읽힌다» 뿐이므로 실패 시 항상 2차 패스를 돈다.
  if (frame.source === 'still') {
    return {
      state: { consecutiveFailures: 0 },
      escalate: true,
      skip: '',
    };
  }

  // 라이브: 연속 실패 1·(1+stride)·(1+2·stride)… 번째에만 2차 패스.
  // 첫 실패에서 바로 도는 이유 — 조준 직후가 사용자가 가장 기다리는 순간이고,
  // 여기서 미루면 stride 만큼의 프레임 동안 «될 수도 있는데 안 해 본» 상태가 된다.
  const consecutiveFailures = previous + 1;
  const escalate = (consecutiveFailures - 1) % stride === 0;
  return {
    state: { consecutiveFailures },
    escalate,
    skip: escalate ? '' : DAEHAN_FALLBACK_SKIP.THROTTLED,
  };
}
