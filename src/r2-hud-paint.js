/**
 * r2-hud-paint.js — **R2 HUD 의 «무엇을 어떤 알파로 칠하는가»** (순수 · DOM 없음).
 *
 * ## 왜 이 파일이 생겼나 (3b 빚 2)
 * 3b 검토 F7 이 잡은 구멍: `paintR2Correction` 호출 두 줄을 통째로 지워도 R2 자 전부가
 * 초록이었다. 그래서 3b 는 «그려지는 표면» 에 자를 하나 놓았는데, 그것이 «corrFresh 라고
 * 썼는가» 를 정규식으로 재는 **철자 자**(r2-hud.test ⓞ)였다 — 정상 개명(`corrFresh` →
 * `corrLive`)을 거부하는 자다 (M7 · memory: 철자를 재는 자는 썩는다).
 *
 * 고치는 길은 «자를 더 촘촘히» 가 아니라 **재는 축을 바꾸는 것**이다: 칠할지 말지의 판정과
 * 붓질 자체를 캔버스에서 떼어 내면, 자가 철자가 아니라 **값과 행동**을 잰다.
 *   · `hudPaintPlan` — 한 프레임의 «어느 층이 열리는가 · 어떤 α 인가» (순수 값).
 *   · `paintCorrectionLayer` — 정정 강조 한 표면의 붓질. `ctx` 를 받으므로 **가짜 ctx** 로
 *     「몇 번 칠하는가 · 어떤 색·α 로」를 셀 수 있다 (캔버스 API 표면은 fill/stroke 뿐).
 *   · `applyHudSurfaces` — 표시 판정을 «`hidden` 속성» 으로 옮기는 이음새. 대상에 쓰는 것이
 *     `hidden` 한 칸뿐이라 **평범한 객체 셋**으로 「판정 → 실제 표시」를 값으로 잰다
 *     (3b 검토 F1: 계획의 필드는 잠겼는데 그 값이 캔버스에 닿는지는 아무 자도 안 봤다 —
 *     오버레이를 `hidden = true` 로 못박아도 표적 134/134 가 초록이었다).
 *
 * ## 여기 없는 것
 * 2D 컨텍스트·Path2D·좌표 변환·색표. 전부 호출자(`sites/tlscan/scanner.js`)의 몫이다 —
 * 색은 «값» 으로 들어오고(스캐너 팔레트가 정본), 경로는 이미 만들어진 것을 받는다.
 * `applyHudSurfaces` 만이 «DOM 모양의 것» 을 만지는데, 그 표면도 `hidden` 한 칸뿐이라
 * 노드에서 `{}` 세 개로 그대로 잰다.
 *
 * ⚠ **«어떤 입력에도 예외를 내지 않는다» 는 이 파일 전체의 계약이 아니다** (3b 검토 rulers F9):
 * 예외 계약은 함수마다 자기 주석에 적었고, `paintCorrectionLayer` 는 «2D 컨텍스트 **모양**» 을
 * 받았을 때만 안 던진다(부분 ctx 는 던진다). 계획 함수 둘은 어떤 입력에도 안 던진다.
 */

import { HUD_PHASE, hudCorrectionAlpha, hudSurfaceVisibility } from './r2-hud-model.js';

/**
 * 표시 판정 필드의 접미 — `hudSurfaceVisibility` 의 출력 키(`overlayHidden` …)가 이 규칙으로
 * 대상 이름(`overlay` …)을 낸다. **손 목록을 안 쓴다**: 표면이 늘면 짝도 자동으로 따라온다.
 */
const HIDDEN_SUFFIX = 'Hidden';

/** 객체가 아니면 빈 객체 — 어떤 입력에도 예외를 내지 않는다. */
function asObject(value) {
  return (value !== null && typeof value === 'object') ? value : {};
}

/** 유한한 0..1 로 물린다. 비유한은 0 («모르면 안 그린다»). */
function clamp01(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v > 1 ? 1 : v;
}

/**
 * **정정 강조 채움의 세기 배율** (3b). 채움은 외곽선보다 옅다: 「여기가 그 셀이다」를 외곽이
 * 말하고 채움은 그 안을 알아보게만 한다. «색» 이 아니라 «세기» 라 붓과 같은 파일에 산다.
 */
export const R2_HUD_CORRECTION_FILL_RATIO = 0.45;

/** 정정 강조 외곽선의 굵기 (화면 CSS px). 선폭 단위는 호출자가 변환 역수로 준다. */
export const R2_HUD_CORRECTION_OUTLINE_PX = 2;

/**
 * **«격자 불신» 의 채움 배율** (3d). 선은 색·점선으로 갈리고 채움은 α 로 갈린다 —
 * 두 표면(오버레이·미니)이 **같은 수**를 써야 「같은 상태의 두 그림」이 같은 말을 한다.
 */
export const R2_HUD_DISTRUST_FILL_RATIO = 0.45;

/** 실선 — `setLineDash` 의 «점선 아님». 배열을 매 프레임 만들지 않게 모듈이 하나 들고 있는다. */
export const R2_HUD_SOLID_DASH = Object.freeze([]);

/** 세 표면이 다 닫힌 프레임 — «그릴 근거가 없다». `hideR2Hud` 가 그리는 상태와 같다. */
const ALL_HIDDEN = Object.freeze({ overlayHidden: true, miniHidden: true, cellMapHidden: true });

/** 아무것도 안 그리는 계획 — 카메라가 꺼진 프레임(유예 만료 뒤)이 여기로 떨어진다. */
function darkPlan() {
  return {
    live: false,
    corrFresh: false,
    lockAlpha: 0,
    paintAlpha: 0,
    correctionAlpha: 0,
    surfaces: ALL_HIDDEN,
    overlayOpen: false,
    overlayFills: false,
    overlayGrid: false,
    overlayCorrection: false,
    miniIdle: true,
    miniFills: false,
    miniGrid: false,
    miniCorrection: false,
  };
}

/**
 * 🔴 **한 프레임의 칠 계획** — 캔버스 없이 「무엇이 보이고 · 어느 층이 열리고 · 어떤 α 인가」를
 * 한 번에 낸다. 시계(`nowMs`)를 **주입**받으므로 자가 프레임을 여러 장 밀어 넣어 «유예 창에
 * 오버레이가 몇 프레임 살아 있었나» 를 값으로 셀 수 있다 (빚 1).
 *
 * 입력은 렌더러가 이미 들고 있는 값뿐이다 (지금 시각 · 정정 래치 · 위상 · 락 n · 기하 유무 ·
 * 락 페이드인 α · 불신 · 그릴 근거 셋). 규칙:
 *
 *   · **그릴 근거가 없으면**(스트림 없음 · 런타임 꺼짐 · 뷰 없음) 세 표면이 다 닫히고 아무 층도
 *     안 연다. ⑯(i) 의 유예가 끝나 `stopCamera` 가 돈 프레임이 정확히 이것이다.
 *   · `corrFresh` = 정정 α 가 살아 있고 **그릴 셀이 있다**. 둘 중 하나만이면 열지 않는다 —
 *     빈 강조는 「어느 셀이 틀렸나」에 거짓말을 한다. α 는 래치 시각에서만 나온다(위상 밖의 층).
 *   · 오버레이는 «그릴 H 가 있는 위상»(`hudSurfaceVisibility`) ∨ **정정 강조**. 후자가 ⑯(i) 의
 *     표면이다: 위상이 DONE(그리기를 멈추는 위상)인데 그리라고 말하는 유일한 입력이다.
 *   · 채움·격자는 정정 프레임에서도 **열린다** (3b 검토 F6). 안 열면 강조가 «맥락 없는 흰
 *     마름모» 로만 뜬다 — 「어느 셀이 틀렸나」는 주변 셀과 격자가 있어야 읽힌다.
 *   · 미니는 점진 표시(실루엣 → 격자 → 역할색 → 데이터)라 위상 규칙이 오버레이와 **다르다**.
 *   · `paintAlpha` 는 두 표면이 **공유**한다 — 한쪽만 눕히면 두 그림이 다른 말을 한다.
 *
 * @param {{
 *   nowMs?: number, correction?: {at?: number, count?: number}|null, durationMs?: number,
 *   hasStream?: boolean, runtimeEnabled?: boolean, hasView?: boolean,
 *   phase?: string, n?: number,
 *   overlayGeom?: boolean, isoGeom?: boolean, corrGridOk?: boolean,
 *   lockAlpha?: number, distrusted?: boolean,
 * }} input
 * @returns {{
 *   live: boolean, corrFresh: boolean, lockAlpha: number, paintAlpha: number, correctionAlpha: number,
 *   surfaces: {overlayHidden: boolean, miniHidden: boolean, cellMapHidden: boolean},
 *   overlayOpen: boolean, overlayFills: boolean, overlayGrid: boolean, overlayCorrection: boolean,
 *   miniIdle: boolean, miniFills: boolean, miniGrid: boolean, miniCorrection: boolean,
 * }}
 */
export function hudPaintPlan(input) {
  const src = asObject(input);
  const live = src.hasStream === true && src.runtimeEnabled === true && src.hasView === true;
  if (!live) return darkPlan();

  const phase = src.phase;
  const n = Number.isInteger(src.n) && src.n > 0 ? src.n : 0;

  /*
   * 정정 강조 α — 규칙은 순수 모듈(`hudCorrectionAlpha`)이고 시계는 **여기로 주입**된다.
   * 래치 전(now < at)은 0, 수명이 지나도 0 — 즉 이 한 줄이 「강조가 몇 프레임 사는가」를 정한다.
   */
  const latch = asObject(src.correction);
  const corrCells = Number(latch.count);
  const correctionAlpha = src.correction === null || src.correction === undefined
    ? 0
    : clamp01(hudCorrectionAlpha(src.nowMs, latch.at, src.durationMs));
  const corrFresh = correctionAlpha > 0 && Number.isFinite(corrCells) && corrCells > 0;

  /*
   * 표시 판정은 표면 함수 하나에서 읽는다 — 여기서 위상 셋을 다시 적으면 규칙이 두 곳에 살고,
   * 한쪽만 바뀌는 날 「캔버스는 열렸는데 아무것도 안 그린」 프레임이 생긴다 (그 반대도).
   */
  const liveInput = { hasStream: true, runtimeEnabled: true, hasView: true };
  const surfaces = hudSurfaceVisibility({ ...liveInput, phase, corrFresh });
  const overlayOpen = !surfaces.overlayHidden;

  const overlayGeom = src.overlayGeom === true;
  const isoGeom = src.isoGeom === true;
  const corrGridOk = src.corrGridOk === true && corrFresh;

  const overlayFills = overlayGeom && overlayOpen;
  const miniFills = n > 0
    && (phase === HUD_PHASE.DATA || phase === HUD_PHASE.FINALIZING || corrFresh);

  const lockAlpha = clamp01(src.lockAlpha);
  const distrusted = src.distrusted === true;

  return {
    live,
    corrFresh,
    /** 락 페이드인 α 그대로 — 선(격자·실루엣)이 쓴다. 불신은 **채움만** 눕히므로 여기 안 탄다. */
    lockAlpha,
    paintAlpha: distrusted ? lockAlpha * R2_HUD_DISTRUST_FILL_RATIO : lockAlpha,
    correctionAlpha,
    surfaces,
    overlayOpen,
    overlayFills,
    // 격자선은 채움과 **같은 조건**이다 — 채움 없는 격자는 「무엇을 보고 있는지」를 못 만든다.
    overlayGrid: overlayFills,
    overlayCorrection: corrGridOk && overlayGeom,
    // 락 전(n 미상)·DROPPED 엔 실루엣만 옅게 — «찾는 중» 의 자리만 알린다.
    miniIdle: n <= 0 || phase === HUD_PHASE.SEARCHING || phase === HUD_PHASE.DROPPED,
    miniFills,
    miniGrid: miniFills || (n > 0 && phase === HUD_PHASE.GRID),
    miniCorrection: corrGridOk && isoGeom,
  };
}

/**
 * 🔴 **표시 판정 → `hidden` 속성** (3b 검토 F1). 계획이 낸 `surfaces` 를 실제 표면 셋에 옮긴다.
 *
 * 왜 함수인가: 옛 자리는 렌더러의 세 대입이었고, 그래서 「⑯(i) 가 산 600 ms 동안 오버레이가
 * **실제로** 열리는가」를 재는 자가 소스 훑기 두 줄뿐이었다 — 그 두 줄이 ⓞ 퇴역과 함께
 * 사라지자 `r2HudCanvas.hidden = true` 로 못박아도 표적 전부가 초록이었다. 여기서 쓰는 것이
 * `hidden` 한 칸뿐이므로, 자는 캔버스 대신 `{}` 셋을 넘겨 **값으로** 잰다.
 *
 * 짝짓기는 **판정의 출력에서 유도**한다 (`overlayHidden` → `overlay`). 손 목록을 안 쓰므로
 * 표면이 늘어도 이 함수는 그대로다 — 늘어난 칸을 한쪽만 잊는 사고가 구조적으로 안 난다.
 * 값이 `true` 가 아니면 전부 «보임» 이다: «모르는 표면» 을 숨기면 화면이 조용히 빈다.
 *
 * @param {object} targets `{overlay, mini, cellMap}` — `hidden` 을 쓸 수 있는 것 (없으면 건너뛴다)
 * @param {object} surfaces `hudSurfaceVisibility` / `hudPaintPlan().surfaces` 의 출력
 * @returns {number} 실제로 대입한 표면 수. 예외 없음.
 */
export function applyHudSurfaces(targets, surfaces) {
  const els = asObject(targets);
  const src = asObject(surfaces);
  let applied = 0;
  for (const key of Object.keys(src)) {
    if (!key.endsWith(HIDDEN_SUFFIX) || key.length === HIDDEN_SUFFIX.length) continue;
    const el = els[key.slice(0, -HIDDEN_SUFFIX.length)];
    if (el === null || typeof el !== 'object') continue;
    el.hidden = src[key] === true;
    applied += 1;
  }
  return applied;
}

/**
 * 🔴 **정정 강조 한 표면의 붓질** — 채움(α × 배율) + 실선 외곽. 오버레이와 미니가 **같은
 * 함수**를 쓴다: 한쪽만 고치면 「같은 상태의 두 그림」이 다른 말을 한다.
 *
 * DOM 이 아니라 `ctx` 를 받는다 — 그래서 가짜 ctx 로 「몇 번 칠하는가」를 셀 수 있다
 * (3b 가 못 덮었던 축: `paintR2Correction` 호출을 지워도 자 전부가 초록이었다).
 *
 * 색은 **호출자가 준다** (`style.color`). 팔레트는 스캐너에 있고 지금 이 파일에 색 리터럴은
 * 하나도 없다. ⚠ 그것이 «구조적으로 불가» 는 아니다 (3b 검토 rulers F4): `ctx.shadowColor`
 * 같은 다른 칸에 사본을 앉힐 수 있고 ⓑ① 은 fill/stroke 색만 본다. 그래서 **파일 전체를 훑는
 * 금지 어휘 자**를 따로 뒀다 — `test/r2-hud-paint.test.js` ⓑ③ (퇴역한 ⓞ② 의 명제를 옮긴 것).
 *
 * @param {object} ctx 2D 컨텍스트 (또는 **같은 모양**의 가짜: fill·stroke 필수, setLineDash 선택)
 * @param {object} path 이미 만들어진 경로 (Path2D)
 * @param {number} alpha 정정 강조 α (0 이면 아무것도 안 칠한다)
 * @param {number} unitPx 선폭 1 CSS px 에 해당하는 변환 단위 (호출자가 변환 역수로 준다)
 * @param {{color?: string}} style 붓 색 — 스캐너 팔레트의 «rsfix» 항목
 * @returns {number} 실제로 칠한 횟수 (채움 + 외곽 = 2, 안 칠했으면 0).
 *   ⚠ 예외 계약은 «그릴 근거가 없으면 안 던지고 0» 까지다 — 그릴 근거가 **있는데** ctx 가
 *   2D 컨텍스트 모양이 아니면(fill/stroke 없음) 던진다. 조용히 안 그리면 「붓이 죽었다」가
 *   화면에서만 보이므로, 모양이 틀린 것은 소리를 내는 편이 옳다.
 */
export function paintCorrectionLayer(ctx, path, alpha, unitPx, style) {
  if (ctx === null || typeof ctx !== 'object') return 0;
  if (path === null || path === undefined) return 0;
  const a = clamp01(alpha);
  if (a <= 0) return 0;
  const color = asObject(style).color;
  if (typeof color !== 'string' || color === '') return 0;
  const unit = Number(unitPx);
  if (!Number.isFinite(unit) || unit <= 0) return 0;

  if (typeof ctx.setLineDash === 'function') ctx.setLineDash(R2_HUD_SOLID_DASH);
  ctx.globalAlpha = a * R2_HUD_CORRECTION_FILL_RATIO;
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.globalAlpha = a;
  ctx.strokeStyle = color;
  ctx.lineWidth = R2_HUD_CORRECTION_OUTLINE_PX * unit;
  ctx.stroke(path);
  // 다음 층이 자기 α 를 세우기 전에 이 값을 물려받지 않게 되돌린다.
  ctx.globalAlpha = 1;
  return 2;
}
