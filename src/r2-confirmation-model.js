/**
 * r2-confirmation-model.js — **R2 좌 패널 «확정/변동» 행 모델** (순수 함수 · DOM 없음 · 디코더 import 없음).
 *
 * 스캐너 좌 패널이 R2 위치에서 보여 줄 네 행(타입 · 버전 · 레이아웃 · 진행)을
 * `r2-scan-runtime` 의 `stats`/`view` 와 DONE 스냅샷(래치)에서 **유도**한다.
 * 렌더 층은 이 행 배열을 받아 색·라벨만 붙인다 — 규칙은 전부 여기 한 곳에 있다.
 *
 * ## 운영자 결정 (PM/029B §27 · 2026-09-05 · 잠긴 결론)
 *   ⑦ 표기 규약 = «Type X» 다음 «X<버전>». R2 는 Type Y 만 누적하므로
 *      «Type Y» → «Y2 (n25)» (버전 = `versionForFinalN(n)`: 13→0 · 21→1 · 25→2).
 *   ⑧ **확정 = 락 시점.** 락(`candidateCount > 0 ∧ lockedN > 0`)에서 타입·버전은 확정.
 *      레이아웃 변종(v0T/v0TR/…)은 락이 오인한 실측(`v0tr` 코드에 `v0t` 30/30 —
 *      `r2-scan-runtime.js` 머리말)이 있어 DONE 까지 변동, DONE(래치)에서 확정.
 *      래치의 layoutId 가 직전 선두와 다르면 «정정» — 그 판별(`latched.layoutId !== leadingId`)과
 *      강조색 전이는 렌더 층의 몫이다. 이 모델은 래치가 선두를 **이긴다**는 것만 보장한다.
 *
 * ## 락 상태의 원천 — `view.n`(묶인 n) 우선, 없으면 `stats.lockedN` (적대 검토 F5 · 2026-09-05 · 통합자 해석, 1줄 announce)
 * `stats.lockedN` 은 어댑터의 «이 프레임» 검출 n 이다. 어댑터는 F 게이트가 LOCK_MISS_LIMIT(3) 프레임 연속 미달이면 락을
 * 걷어 lockedN 을 0 으로 내리지만, 런타임은 후보를 CANDIDATE_PATIENCE_FRAMES 까지 살려 **계속 누적한다**(코스팅). 그 동안
 * lockedN 만 보면 칩은 전부 사라지고 막대·메모는 차 있어 같은 패널이 두 이야기를 하고, 재락마다 «확정» 칩이 깜빡인다.
 * 그래서 락 판정(`lockState`)은 후보가 묶인 n(`view.n` = boundN, dispose 때만 0) 을 먼저 보고 없으면 lockedN 으로 떨어진다.
 * ⑧ 의 «확정 = 락 시점» 은 그대로다 — 확정은 락에서 시작하고, 묶인 후보가 살아 있는 동안 유지된다. 칩·막대 메모(`progressNote`)
 * 가 **같은 판정**을 쓰므로 세 표면은 구조적으로 한 이야기를 한다.
 *
 * ## ⚠ `versionForFinalN` 은 라인업 밖 n 에서 throw 한다
 * 락 직후 어댑터가 `n=99` 같은 값을 낼 수 있고 그때 `bind` 가 후보를 0개 만든다 —
 * 그래서 `candidateCount > 0` 이 «n 이 라인업 안» 의 보증이고, 이 가드 없이 부르지 않는다.
 * 그 위에 한 겹 더, 호출을 `safeVersion` 으로 감싸 어떤 입력에도 예외를 내지 않는다
 * (잘못된 입력은 NONE 행). 순수 함수 — 입력을 바꾸지 않고, 호출마다 새 배열을 돌려준다.
 *
 * ## 같은 파일의 나머지 순수 규칙 (DOM 없음 — 스캐너는 값만 받아 setStatus / return 한다)
 *   · `r2StatusStep` · `r2StatusOnReject` — R2 위치 상태줄의 전이(락 진입 → r2Collecting · 락 해제 → aim)와 거부 뒤 유예 (F1).
 *   · `lateResultAdmitted` — 비행 중이던 복호가 끝났을 때 그 결과를 결과 문에 넣어도 되는가 (F2 · QR 콜백과 같은 규약).
 *   · `progressNote` — 막대 행 메모 «n25·5» (F5 · 칩과 같은 락 판정).
 */

import { versionForFinalN } from './cellSurfaceFinal.js';
import { R2_INDICATOR } from './r2/session.js';
import { R2_CAPABILITIES } from './r2-scan-runtime.js';

export const CONFIRM_STATE = Object.freeze({
  NONE: 'none',
  TENTATIVE: 'tentative',
  CONFIRMED: 'confirmed',
});

/** 행 키 — 렌더가 이 순서로 칩을 놓는다 (type → version → layout → progress). */
const ROW_KEYS = Object.freeze(['type', 'version', 'layout', 'progress']);

/** 히스테리시스 기본 폭 — 선두가 바뀌려면 D 가 이만큼은 앞서야 한다 (칩 깜빡임 억제). */
const DEFAULT_HYSTERESIS_DELTA = 0.1;

/*
 * R2_INDICATOR 값 → 이름 소문자. 원본 객체에서 **유도**한다 (사본 목록 금지 —
 * 인디케이터가 추가되면 여기가 따라온다). 모르는 값은 SEARCHING 의 이름으로 떨어진다.
 */
const INDICATOR_KEY_BY_VALUE = new Map(
  Object.entries(R2_INDICATOR).map(([name, value]) => [value, name.toLowerCase()]),
);
const FALLBACK_INDICATOR_KEY = INDICATOR_KEY_BY_VALUE.get(R2_INDICATOR.SEARCHING);

/**
 * R2_INDICATOR 값 → 이름 소문자 ('searching' … 'failed'). 렌더가 `t('r2.state.' + key)` 로 붙인다.
 * 모르는 값(undefined · 음수 · 문자열)은 'searching'.
 */
export function indicatorStateKey(indicator) {
  const key = INDICATOR_KEY_BY_VALUE.get(indicator);
  return key === undefined ? FALLBACK_INDICATOR_KEY : key;
}

/**
 * 레이아웃 id 표시형 — 소스 id 는 소문자(`'v0tr'`), 표시 이름은 «v0TR» (cellSurfaceFinal.js 의
 * 각 상수 주석 «표시 이름은 …» 규약). 규칙: **앞 2글자 그대로 + 나머지 대문자.**
 * 문자열이 아니면 ''.
 */
export function layoutDisplayId(id) {
  if (typeof id !== 'string') return '';
  return id.slice(0, 2) + id.slice(2).toUpperCase();
}

/**
 * 살아 있는 후보 중 D 최대를 선두로 고르되, 직전 선두(`prevId`)가 살아 있고
 * `(maxD − D(prev)) < delta` 면 직전 선두를 유지한다 — 근소한 역전마다 칩이 바뀌면 사람이 못 읽는다.
 *
 * @param {string} prevId 직전 선두 layoutId ('' 이면 없음)
 * @param {Array<{layoutId:string, D:number, alive:boolean}>} candidates `stats.candidates` 모양
 * @param {number} [delta] 히스테리시스 폭
 * @returns {string} 선두 layoutId. 살아 있는 후보가 없으면 ''.
 *
 * 동률은 먼저 나온 후보가 이긴다(strict >) — `r2-scan-runtime` 의 선두 규칙과 같다.
 */
export function leadingWithHysteresis(prevId, candidates, delta = DEFAULT_HYSTERESIS_DELTA) {
  if (!Array.isArray(candidates)) return '';
  const gap = Number.isFinite(delta) ? delta : DEFAULT_HYSTERESIS_DELTA;
  let best = null;
  let bestD = -Infinity;
  let prev = null;
  for (const candidate of candidates) {
    if (!candidate || !candidate.alive) continue;
    if (typeof candidate.layoutId !== 'string' || candidate.layoutId === '') continue;
    const d = Number.isFinite(candidate.D) ? candidate.D : 0;
    if (d > bestD) {
      bestD = d;
      best = candidate;
    }
    if (prev === null && prevId !== '' && candidate.layoutId === prevId) prev = candidate;
  }
  if (best === null) return '';
  if (prev !== null) {
    const prevD = Number.isFinite(prev.D) ? prev.D : 0;
    if (bestD - prevD < gap) return prev.layoutId;
  }
  return best.layoutId;
}

/**
 * 락 판정 — 칩(`confirmationRows`)과 막대 메모(`progressNote`)가 **같이** 쓴다 (머리말 «락 상태의 원천»).
 *   n      = view.n > 0 ? view.n : lockedN        (묶인 n 우선 — 코스팅 중 lockedN 은 0 이어도 후보는 그 n 위에 누적 중)
 *   locked = candidateCount > 0 ∧ n > 0
 * @returns {{candidateCount:number, n:number, locked:boolean}}
 */
function lockState(stats, view) {
  const candidateCount = stats && Number.isFinite(stats.candidateCount) ? stats.candidateCount : 0;
  const lockedN = stats && Number.isFinite(stats.lockedN) ? stats.lockedN : 0;
  const boundN = view && Number.isInteger(view.n) && view.n > 0 ? view.n : 0;
  const n = boundN > 0 ? boundN : lockedN;
  return { candidateCount, n, locked: candidateCount > 0 && n > 0 };
}

/** `versionForFinalN` 을 예외 없이 — 라인업 밖 n 은 -1. */
function safeVersion(n) {
  if (!Number.isInteger(n)) return -1;
  try {
    return versionForFinalN(n);
  } catch {
    return -1;
  }
}

function row(key, state, text) {
  return { key, text, state };
}

function noneRow(key) {
  return row(key, CONFIRM_STATE.NONE, '');
}

function versionText(family, version, n) {
  return family + version + ' (n' + n + ')';
}

/**
 * 좌 패널 네 행을 만든다. 고정 순서 `type → version → layout → progress`.
 *
 * @param {object} input
 * @param {object} input.stats `r2-scan-runtime` 의 stats (lockedN · candidateCount · indicator · progressD · candidates)
 * @param {{layoutId:string, n?:number}} [input.view] `r2-scan-runtime` 의 view — 묶인 n(`n`)의 원천, 선두 id 가 없을 때의 대체 원천
 * @param {null|{layoutId:string, n:number}} [input.latched] DONE 스냅샷. 있으면 전 행 확정.
 * @param {string} [input.leadingId] `leadingWithHysteresis` 결과
 * @param {string} [input.family] 누적 계열 문자. 기본 `R2_CAPABILITIES.accumulatesFamilies[0]` ('Y')
 * @returns {Array<{key:string, text:string, state:string, stateKey?:string}>}
 *   progress 행만 `stateKey` 를 추가로 갖는다 (NONE 이면 '') — 렌더가 `t('r2.state.' + stateKey)` 로 붙인다.
 *
 * 규칙 (운영자 ⑦·⑧ · `lockState`):
 *   n        = view.n > 0 ? view.n : lockedN
 *   locked   = candidateCount > 0 ∧ n > 0
 *   type     : 래치 ∨ locked → CONFIRMED 'Type Y' · 아니면 NONE
 *   version  : 래치 → CONFIRMED 'Y<v> (n<latched.n>)' · locked → CONFIRMED 'Y<v> (n<n>)' · 아니면 NONE
 *   layout   : 래치 → CONFIRMED (래치가 선두를 이긴다) · locked → TENTATIVE (leadingId, 없으면 **살아 있는 후보가 있을 때만** view.layoutId)
 *              · 아니면 NONE
 *   progress : 래치 → CONFIRMED 'DONE' (stateKey 'done') · locked → TENTATIVE 'D 0.62' (stateKey = indicator 이름) · 아니면 NONE
 * 예외 없음 — 잘못된 입력은 NONE 행.
 */
export function confirmationRows(input) {
  const arg = input && typeof input === 'object' ? input : {};
  const stats = arg.stats && typeof arg.stats === 'object' ? arg.stats : null;
  const view = arg.view && typeof arg.view === 'object' ? arg.view : null;
  const family = typeof arg.family === 'string' && arg.family !== ''
    ? arg.family
    : R2_CAPABILITIES.accumulatesFamilies[0];

  // ⚠ `locked` 의 candidateCount > 0 이 곧 «n 이 라인업 안» 의 보증이다 (머리말). 가드 없이 versionForFinalN 을 부르지 마라.
  const lock = lockState(stats, view);
  const locked = lock.locked;
  const lockedN = lock.n;

  const latched = arg.latched && typeof arg.latched === 'object'
    && typeof arg.latched.layoutId === 'string' && arg.latched.layoutId !== ''
    && Number.isInteger(arg.latched.n) && arg.latched.n > 0
    ? arg.latched
    : null;

  const leadingId = typeof arg.leadingId === 'string' ? arg.leadingId : '';
  const viewId = view && typeof view.layoutId === 'string' ? view.layoutId : '';

  const rows = [];
  for (const key of ROW_KEYS) {
    if (key === 'type') {
      rows.push(latched !== null || locked
        ? row(key, CONFIRM_STATE.CONFIRMED, 'Type ' + family)
        : noneRow(key));
      continue;
    }
    if (key === 'version') {
      const n = latched !== null ? latched.n : (locked ? lockedN : 0);
      const version = n > 0 ? safeVersion(n) : -1;
      rows.push(version >= 0
        ? row(key, CONFIRM_STATE.CONFIRMED, versionText(family, version, n))
        : noneRow(key));
      continue;
    }
    if (key === 'layout') {
      if (latched !== null) {
        rows.push(row(key, CONFIRM_STATE.CONFIRMED, layoutDisplayId(latched.layoutId)));
      } else if (locked) {
        // 선두가 없으면 뷰의 선두 id 로 — 단 **살아 있는 후보가 하나라도 있을 때만**. 런타임은 view.layoutId 를 선두가 있을 때만
        // 덧쓰고 disposeCandidates 때만 비우므로, 후보 전멸(전부 alive=false — pushFrame 예외 경로) 프레임엔 죽은 선두를 그대로
        // 들고 있다 (F6). 그때 뷰를 믿으면 «D 0.00 · 탐색중» 옆에 죽은 변종이 변동색으로 남는다. 후보 배열이 없으면(옛 호출 모양) 뷰를 믿는다.
        const anyAlive = stats && Array.isArray(stats.candidates)
          ? stats.candidates.some((candidate) => candidate !== null && typeof candidate === 'object' && candidate.alive === true)
          : true;
        const tentativeId = leadingId !== '' ? leadingId : (anyAlive ? viewId : '');
        rows.push(tentativeId !== ''
          ? row(key, CONFIRM_STATE.TENTATIVE, layoutDisplayId(tentativeId))
          : noneRow(key));
      } else {
        rows.push(noneRow(key));
      }
      continue;
    }
    // progress
    if (latched !== null) {
      rows.push({ ...row(key, CONFIRM_STATE.CONFIRMED, 'DONE'), stateKey: indicatorStateKey(R2_INDICATOR.DONE) });
    } else if (locked) {
      const d = stats && Number.isFinite(stats.progressD) ? stats.progressD : 0;
      rows.push({
        ...row(key, CONFIRM_STATE.TENTATIVE, 'D ' + d.toFixed(2)),
        stateKey: indicatorStateKey(stats ? stats.indicator : undefined),
      });
    } else {
      rows.push({ ...noneRow(key), stateKey: '' });
    }
  }
  return rows;
}

/**
 * 막대 행 메모 «n25·5» — 누적 중인 n 과 후보 수. 칩과 **같은 락 판정**(`lockState`) 을 쓴다: 칩이 있으면 메모도 있고,
 * 칩이 없으면 메모도 없다 (F5 — 옛 렌더는 `stats.lockedN` 을 직접 써서 코스팅 중 «칩 없음 · n0·5» 를 냈다). 락이 없으면 ''.
 * @param {{stats?:object, view?:{n?:number}}} input
 */
export function progressNote(input) {
  const arg = input && typeof input === 'object' ? input : {};
  const stats = arg.stats && typeof arg.stats === 'object' ? arg.stats : null;
  const view = arg.view && typeof arg.view === 'object' ? arg.view : null;
  const lock = lockState(stats, view);
  return lock.locked ? 'n' + lock.n + '·' + lock.candidateCount : '';
}

/*
 * ── R2 위치 상태줄 전이 (F1) ──────────────────────────────────────────────────────────────────────
 * R2 위치에선 R1 상태 기계(status.aim/closer/clipped…)가 멈추므로 인디케이터 **전이** 때만 한 번 문구를 바꾼다
 * (매 프레임 쓰면 낭독기가 매 틱 다시 읽는다). 스캐너는 `r2StatusStep` 의 action 대로 setStatus 하고 collecting 을 되쓴다.
 *
 * 거부된 적중(비컨만 · 빈 페이로드)은 결과 문(handleDecodeResult)이 처방 문구(status.beaconOnly 등)를 쓴 뒤 런타임을 비운다 —
 * 그 다음 프레임은 후보 0 이라 «락 해제» 전이가 status.aim 으로 처방을 한 프레임(≈16~33 ms) 만에 덮었고, 재락은 다시
 * status.r2Collecting 을 썼다. PM/029B §27.1.1 실측(R2 가 K 비컨에 n=13 락 6/6)이 정확히 이 경로라 K 코드를 겨누면
 * «그대로 잡고 있으라 ↔ 조준» 만 번갈아 보이고 정반대 처방인 beaconOnly 는 사실상 안 보였다.
 * 그래서 거부 직후(`r2StatusOnReject`) 위상을 내리고(release 전이가 aim 을 쓸 이유가 없다) `R2_REJECT_HINT_HOLD_MS` 동안 두
 * 전이 모두 **침묵**한다(collecting 위상은 따라가되 setStatus 는 안 한다). R1 모드에서 같은 처방이 다음 복호(1.4~2.8 s)까지
 * 남는 것과 같은 수명이다. 유예가 끝나면 다음 전이부터 정상 — 유예 중 재락은 문구를 안 쓰므로 처방이 그대로 살아 있다.
 */
export const R2_STATUS_ACTION = Object.freeze({ NONE: 'none', COLLECTING: 'collecting', AIM: 'aim' });
/** 거부 뒤 처방 문구 유예 — R1 의 «다음 복호까지»(1.4~2.8 s)와 같은 자릿수. */
export const R2_REJECT_HINT_HOLD_MS = 2000;

/* 원본 객체에서 유도한 전이 집합 — 락 진입 = LOCKED | COLLECTING | FINALIZING · 락 해제 = 후보 0 ∨ DROPPED | FAILED. */
const ENGAGED_INDICATORS = new Set([R2_INDICATOR.LOCKED, R2_INDICATOR.COLLECTING, R2_INDICATOR.FINALIZING]);
const RELEASED_INDICATORS = new Set([R2_INDICATOR.DROPPED, R2_INDICATOR.FAILED]);

/**
 * 한 프레임의 상태줄 전이.
 * @param {{collecting:boolean, holdUntil?:number}} state 직전 위상 (`collecting` = «모으는 중» 을 이미 말했는가 · `holdUntil` = 유예 시각)
 * @param {{candidateCount:number, indicator:number}} stats `r2-scan-runtime` 의 stats
 * @param {number} now 현재 시각(ms · `holdUntil` 과 같은 시계)
 * @returns {{collecting:boolean, holdUntil:number, action:string}} action ∈ R2_STATUS_ACTION —
 *   COLLECTING = status.r2Collecting 1회 · AIM = status.aim 1회 · NONE = 문구 그대로. 유예 중(now < holdUntil)엔 항상 NONE.
 * 순수 함수 — 입력을 바꾸지 않는다. 잘못된 입력은 «전이 없음».
 */
export function r2StatusStep(state, stats, now) {
  const collecting = Boolean(state && state.collecting);
  const holdUntil = state && Number.isFinite(state.holdUntil) ? state.holdUntil : -Infinity;
  const candidateCount = stats && Number.isFinite(stats.candidateCount) ? stats.candidateCount : 0;
  const indicator = stats && typeof stats === 'object' ? stats.indicator : undefined;
  const released = candidateCount === 0 || RELEASED_INDICATORS.has(indicator);
  const engaged = !released && ENGAGED_INDICATORS.has(indicator);
  const held = Number.isFinite(now) && now < holdUntil;
  if (!collecting && engaged) {
    return { collecting: true, holdUntil, action: held ? R2_STATUS_ACTION.NONE : R2_STATUS_ACTION.COLLECTING };
  }
  if (collecting && released) {
    return { collecting: false, holdUntil, action: held ? R2_STATUS_ACTION.NONE : R2_STATUS_ACTION.AIM };
  }
  return { collecting, holdUntil, action: R2_STATUS_ACTION.NONE };
}

/**
 * 거부된 적중 직후의 위상 — «모으는 중» 위상을 내리고(거부 = 락 해제의 다른 이름, 그러나 문구는 문이 이미 잡았다)
 * `now + R2_REJECT_HINT_HOLD_MS` 까지 전이를 유예한다.
 * @param {number} now
 * @returns {{collecting:boolean, holdUntil:number}}
 */
export function r2StatusOnReject(now) {
  const at = Number.isFinite(now) ? now : 0;
  return { collecting: false, holdUntil: at + R2_REJECT_HINT_HOLD_MS };
}

/**
 * 늦은 결과 문 (F2) — 비행 중이던 복호가 끝났을 때 그 결과(와 그 실패가 만드는 상태 문구)를 결과 문에 넣어도 되는가.
 * 스위치 위치가 곧 엔진이다(운영자 결정 ② · 2026-09-05: R2 위치 = R2 누적 + QR 만, R1 위치 = R1 단발만). 스위치 핸들러는
 * scanSession 을 올리지 않으므로 클릭 직전에 시작된 R1 복호(1.4~2.8 s)는 완주한다 — 세션 비교만으로는 못 버린다.
 *   · 세션이 바뀌었으면 어느 엔진이든 거부.
 *   · 'r1' 은 R2 가 꺼져 있을 때만 · 'qr'·'r2' 는 R2 가 켜져 있을 때만 (QR 콜백의 `session !== scanSession || !r2Runtime.enabled` 와 같은 표).
 *   · 모르는 엔진은 거부.
 * 정식(/)은 R2 가 항상 꺼져 있어 'r1' 은 «세션이 같으면 통과» 로 환원된다 — 정식 제어 흐름 불변.
 * @param {'r1'|'qr'|'r2'} engine
 * @param {{sameSession:boolean, r2Enabled:boolean}} ctx
 */
export function lateResultAdmitted(engine, ctx) {
  const sameSession = Boolean(ctx && ctx.sameSession);
  const r2Enabled = Boolean(ctx && ctx.r2Enabled);
  if (!sameSession) return false;
  if (engine === 'r1') return !r2Enabled;
  if (engine === 'qr' || engine === 'r2') return r2Enabled;
  return false;
}
