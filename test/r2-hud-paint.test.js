/**
 * r2-hud-paint.test.js — **«무엇을 어떤 알파로 칠하는가»** 의 자 (3b 빚 2).
 *
 * 이 파일이 대체하는 것: `test/r2-hud.test.js` 의 ⓞ — «corrFresh 라고 썼는가» 를 정규식으로
 * 재던 **철자 자**다. 그 자는 정상 개명(`corrFresh` → `corrLive`)을 거부했고(3b 검토 M7),
 * 「채움이 열리는가」를 아무도 값으로 재지 않았다. 여기서는 축을 바꾼다:
 *   ⓐ **계획(값)** — 한 프레임의 층 열림·α 가 위상·정정 α·셀 수·기하에서 유도된다.
 *      이름이 무엇이든 통과하고, 규칙이 바뀌면 빨개진다.
 *   ⓑ **붓(행동)** — 가짜 ctx 에 «몇 번·어떤 색·어떤 α 로» 칠했는지 센다. 캔버스 API 표면은
 *      fill/stroke 뿐이라 브라우저 없이 정확히 그 축을 잰다 (3b 가 못 덮은 축).
 *      ⓑ③ 만은 **금지 어휘 훑기**다 — 퇴역한 ⓞ② 의 명제(붓 파일에 색 리터럴 0)를 옮긴 것으로,
 *      대상이 순수 모듈 한 파일이라 «철자» 가 아니라 «어휘» 를 잰다 (3b 검토 rulers F4).
 *   ⓒ **두 표면의 동일성** — 오버레이와 미니가 «같은 α 를 받으면 같은 붓질을 낸다» (붓의 결정성).
 *      ⚠ 이 자는 계획이 두 표면에 같은 α 를 **싣는가** 를 재지 않는다 — α 를 자기가 두 번
 *      똑같이 넘기기 때문이다(그 명제엔 동어반복이다 · 3b 검토 rulers F6). 그 축은 ⓐ⑤ 와
 *      `r2-hud.test.js` ⓠ① 이 나눠 갖는다.
 *   ⓓ **표시 판정 → `hidden`** — 이음새(`applyHudSurfaces`)에 평범한 객체 셋을 넘겨 「계획이
 *      «열림» 이라고 한 프레임에서 표면이 실제로 열리는가」를 **값**으로 잰다 (3b 검토 F1).
 *
 * ⚠ 이 파일이 **못** 재는 축 (이름을 붙여 둔다):
 *   · 화면 픽셀. 진짜 캔버스가 흰 마름모를 실제로 합성했는가는 브라우저 밖이다.
 *   · 렌더러가 이 계획을 **어느 조건에** 쓰는가. 표시 판정의 소비는 ⓓ 가 값으로 잠갔고,
 *     「계획이 낸 필드를 렌더러가 하나도 안 흘리는가」는 `test/r2-hud.test.js` ⓠ 가 계획의
 *     **키 집합에서 유도한 훑기**로 잠근다. 그러나 «`plan.overlayFills` 가 채움 게이트 자리에
 *     쓰였는가»(다른 조건으로 바꿔치기)는 여전히 무자다 — 브라우저 없이는 안 내려온다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { HUD_PHASE, R2_HUD_CORRECTION_MS, hudSurfaceVisibility } from '../src/r2-hud-model.js';
import {
  R2_HUD_CORRECTION_FILL_RATIO,
  R2_HUD_CORRECTION_OUTLINE_PX,
  R2_HUD_DISTRUST_FILL_RATIO,
  R2_HUD_SOLID_DASH,
  applyHudSurfaces,
  hudPaintPlan,
  paintCorrectionLayer,
} from '../src/r2-hud-paint.js';

/** 붓 모듈의 소스 — ⓑ③ 의 금지 어휘 훑기가 읽는다 (색 리터럴이 다른 칸으로 되돌아오는 축). */
const PAINT_SRC = readFileSync(fileURLToPath(new URL('../src/r2-hud-paint.js', import.meta.url)), 'utf8');

/** 정정 강조 래치 하나 — 시각 0 에 셀 3칸. 자는 `nowMs` 를 밀어 α 를 값으로 만든다. */
const LATCH_AT = 0;

/** 그릴 기하가 다 있는 살아 있는 프레임 — 각 자가 **한 축만** 흔들어 재게 하는 바닥 입력. */
const READY = Object.freeze({
  hasStream: true,
  runtimeEnabled: true,
  hasView: true,
  nowMs: 0,
  correction: null,
  n: 13,
  overlayGeom: true,
  isoGeom: true,
  corrGridOk: true,
  lockAlpha: 1,
  distrusted: false,
});

/** «지금 정정 강조가 살아 있는» 프레임 입력. dt 를 주면 그만큼 지난 프레임이다. */
function withCorrection(base, count = 3, dt = 0) {
  return { ...base, nowMs: LATCH_AT + dt, correction: { at: LATCH_AT, count } };
}

/** 캔버스 API 표면만 흉내 낸 가짜 ctx — 붓질을 순서대로 기록한다. */
function fakeCtx() {
  const calls = [];
  return {
    calls,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    dash: null,
    setLineDash(d) { this.dash = d; },
    fill(path) {
      calls.push({
        op: 'fill', path, alpha: this.globalAlpha, color: this.fillStyle, dash: this.dash,
      });
    },
    stroke(path) {
      calls.push({
        op: 'stroke', path, alpha: this.globalAlpha, color: this.strokeStyle, width: this.lineWidth, dash: this.dash,
      });
    },
  };
}

/*
 * ── ⓐ 계획 ────────────────────────────────────────────────────────────────────
 */

test('ⓐ① 정정 강조는 «α 가 살아 있고 그릴 셀이 있을 때만» 열린다 (한 축씩)', () => {
  const done = { ...READY, phase: HUD_PHASE.DONE };
  // 둘 다 있으면 열린다 (래치 순간 α = 1).
  assert.equal(hudPaintPlan(withCorrection(done, 3, 0)).corrFresh, true);
  assert.equal(hudPaintPlan(withCorrection(done, 3, 0)).correctionAlpha, 1);
  // α 만 (셀 0) — 빈 강조는 「어느 셀이 틀렸나」에 거짓말을 한다.
  assert.equal(hudPaintPlan(withCorrection(done, 0, 0)).corrFresh, false);
  // 셀만 (수명이 지나 α 0) — **이것이 M2b(α 항상 0) 가 지나가던 자리다.**
  assert.equal(hudPaintPlan(withCorrection(done, 3, R2_HUD_CORRECTION_MS)).corrFresh, false);
  assert.equal(hudPaintPlan(withCorrection(done, 3, R2_HUD_CORRECTION_MS + 5000)).corrFresh, false);
  // 래치 **전** 프레임도 0 — DONE 도 아닌데 셀이 지목되면 안 된다.
  assert.equal(hudPaintPlan(withCorrection(done, 3, -1)).corrFresh, false);
  // 래치가 없으면(정정 0 인 DONE) 아무 일도 없다.
  assert.equal(hudPaintPlan({ ...done, correction: null }).corrFresh, false);
  // 비유한 시각·셀 수는 «모른다» → 안 그린다.
  for (const bad of [Number.NaN, undefined, 'x']) {
    assert.equal(hudPaintPlan({ ...done, nowMs: bad, correction: { at: 0, count: 3 } }).corrFresh, false, String(bad));
    assert.equal(hudPaintPlan({ ...done, nowMs: 0, correction: { at: 0, count: bad } }).corrFresh, false, String(bad));
  }
  // 잘못된 입력 전체도 예외 없이 «아무것도 안 그린다» — 그리고 세 표면이 닫힌다.
  for (const bad of [undefined, null, 0, 'x', []]) {
    const plan = hudPaintPlan(bad);
    assert.equal(plan.live, false, String(bad));
    assert.equal(plan.corrFresh, false, String(bad));
    assert.equal(plan.overlayFills, false, String(bad));
    assert.equal(plan.miniFills, false, String(bad));
    assert.deepEqual(plan.surfaces, { overlayHidden: true, miniHidden: true, cellMapHidden: true }, String(bad));
  }
});

test('ⓐ①-b 그릴 근거 셋 중 하나만 빠져도 세 표면이 다 닫힌다 (`hideR2Hud` 와 같은 상태)', () => {
  const live = withCorrection({ ...READY, phase: HUD_PHASE.DONE });
  assert.equal(hudPaintPlan(live).surfaces.overlayHidden, false, '살아 있는 정정 프레임이 닫혀 있다');
  for (const key of ['hasStream', 'runtimeEnabled', 'hasView']) {
    const plan = hudPaintPlan({ ...live, [key]: false });
    assert.equal(plan.live, false, key + ' 가 거짓인데 살아 있다고 답했다');
    assert.deepEqual(plan.surfaces, { overlayHidden: true, miniHidden: true, cellMapHidden: true },
      key + ' 가 거짓인데 표면이 열려 있다');
    assert.equal(plan.overlayCorrection, false, key + ' 가 거짓인데 강조를 그린다');
    assert.equal(plan.miniCorrection, false, key + ' 가 거짓인데 미니 강조를 그린다');
  }
});

test('ⓐ② 🔴 정정 프레임은 DONE 위상에서도 오버레이·채움·격자를 연다 (⑯(i) · 3b 검토 F6)', () => {
  const done = { ...READY, phase: HUD_PHASE.DONE };
  // 정정이 없으면 DONE 에서 전부 닫힌다 — 결과 시트 아래에 빈 그림이 남으면 안 된다.
  const quiet = hudPaintPlan(done);
  assert.equal(quiet.overlayOpen, false, '정정 없는 DONE 에서 오버레이가 열린다');
  assert.equal(quiet.overlayFills, false);
  assert.equal(quiet.overlayGrid, false);
  assert.equal(quiet.miniFills, false);

  // 정정 강조 하나가 셋을 다 연다. 안 열면 강조가 «맥락 없는 흰 마름모» 로만 뜬다.
  const live = hudPaintPlan(withCorrection(done));
  assert.equal(live.overlayOpen, true, '⑯(i) 가 산 600 ms 가 빈 화면이 된다');
  assert.equal(live.overlayFills, true, '오버레이 채움이 정정 프레임에서 안 열린다');
  assert.equal(live.overlayGrid, true, '격자가 정정 프레임에서 안 열린다');
  assert.equal(live.miniFills, true, '미니 채움이 정정 프레임에서 안 열린다');
  assert.equal(live.miniGrid, true);
  assert.equal(live.overlayCorrection, true);
  assert.equal(live.miniCorrection, true);
});

test('ⓐ③ 위상 규칙 — 오버레이는 «그릴 H 가 있는 위상», 미니는 점진 표시(다른 규칙)', () => {
  const closed = [HUD_PHASE.SEARCHING, HUD_PHASE.DROPPED, HUD_PHASE.DONE];
  for (const phase of Object.values(HUD_PHASE)) {
    const plan = hudPaintPlan({ ...READY, phase });
    assert.equal(plan.overlayOpen, !closed.includes(phase), phase + ' 의 오버레이 열림이 뒤집혔다');
    // 미니 채움은 «데이터가 차는 위상» 둘뿐이다 (점진 표시의 마지막 두 칸).
    const wantMiniFills = phase === HUD_PHASE.DATA || phase === HUD_PHASE.FINALIZING;
    assert.equal(plan.miniFills, wantMiniFills, phase + ' 의 미니 채움이 뒤집혔다');
    // 미니 격자는 채움 + GRID 위상.
    assert.equal(plan.miniGrid, wantMiniFills || phase === HUD_PHASE.GRID, phase + ' 의 미니 격자가 뒤집혔다');
    // 실루엣만 그리는 위상 — 락 전·놓친 뒤.
    assert.equal(plan.miniIdle, phase === HUD_PHASE.SEARCHING || phase === HUD_PHASE.DROPPED, phase + ' 의 미니 idle');
  }
  // n 을 모르면 미니는 언제나 실루엣이다 (단위 육각).
  assert.equal(hudPaintPlan({ ...READY, n: 0, phase: HUD_PHASE.DATA }).miniIdle, true);
  assert.equal(hudPaintPlan({ ...READY, n: 0, phase: HUD_PHASE.DATA }).miniFills, false);
});

test('ⓐ④ 기하가 없으면 그 표면만 닫힌다 — 오버레이 사영과 미니 항등은 다른 축', () => {
  const live = withCorrection({ ...READY, phase: HUD_PHASE.DONE });
  const noOverlay = hudPaintPlan({ ...live, overlayGeom: false });
  assert.equal(noOverlay.overlayFills, false, '사영 기하 없이 채움을 연다');
  assert.equal(noOverlay.overlayCorrection, false, '사영 기하 없이 강조를 그린다');
  assert.equal(noOverlay.miniCorrection, true, '오버레이 기하가 없다고 미니까지 닫혔다 — 미니는 항등 H 다');
  const noIso = hudPaintPlan({ ...live, isoGeom: false });
  assert.equal(noIso.miniCorrection, false, '항등 기하 없이 미니 강조를 그린다');
  assert.equal(noIso.overlayCorrection, true);
  // 격자·역표·세대가 안 맞으면 «수는 맞고 자리는 모른다» — 강조만 닫히고 채움은 그대로다.
  const noGrid = hudPaintPlan({ ...live, corrGridOk: false });
  assert.equal(noGrid.overlayCorrection, false);
  assert.equal(noGrid.miniCorrection, false);
  assert.equal(noGrid.overlayFills, true, '강조를 못 그린다고 채움까지 닫혔다 — 화면이 통째로 빈다');
});

test('ⓐ⑤ α — 두 표면이 **같은 수**를 쓰고, 불신이면 채움만 눕는다', () => {
  // 수명의 3/4 이 지난 프레임 — 정정 α 는 0.25 다 (1 - 0.75).
  const live = withCorrection({ ...READY, phase: HUD_PHASE.DATA }, 3, R2_HUD_CORRECTION_MS * 0.75);
  const trusted = hudPaintPlan(live);
  assert.equal(trusted.paintAlpha, 1, '락 페이드인 α 가 그대로 안 실린다');
  assert.equal(trusted.correctionAlpha, 0.25, '정정 α 가 계획에 안 실린다');

  const distrusted = hudPaintPlan({ ...live, distrusted: true });
  assert.equal(distrusted.paintAlpha, R2_HUD_DISTRUST_FILL_RATIO,
    '불신 채움이 안 눕는다 — 「확정처럼 보이지 않는다」가 사라진다');
  /*
   * 🔴 **불신은 채움만 눕힌다** — 선(격자·실루엣)은 색·점선으로 갈리므로 락 α 를 그대로 쓴다.
   * 두 값이 한 이름으로 합쳐지면 불신 프레임의 선까지 옅어져 「지금 다시 확인하는 중」이 안 읽힌다.
   */
  assert.equal(distrusted.lockAlpha, 1, '불신이 선의 α 까지 눕힌다 — 채움만 눕는 것이 3d 의 계약이다');
  assert.equal(trusted.lockAlpha, trusted.paintAlpha, '믿는 프레임에서 두 α 가 다르다');
  // 🔴 불신은 **채움만** 눕힌다 — 정정 강조 α 는 그대로다 (다른 축).
  assert.equal(distrusted.correctionAlpha, 0.25,
    '불신이 정정 강조 α 까지 눕힌다 — 「RS 가 고쳤다」와 「격자를 못 믿는다」는 다른 축이다');
  // 페이드인 중에는 두 표면이 같은 중간값을 쓴다.
  assert.equal(hudPaintPlan({ ...live, lockAlpha: 0.4 }).paintAlpha, 0.4);
  assert.equal(hudPaintPlan({ ...live, lockAlpha: 0.4, distrusted: true }).paintAlpha, 0.4 * R2_HUD_DISTRUST_FILL_RATIO);
  // 배율 자체가 공허하면 이 자가 아무것도 안 잰다.
  assert.ok(R2_HUD_DISTRUST_FILL_RATIO > 0 && R2_HUD_DISTRUST_FILL_RATIO < 1,
    '불신 배율이 0 이나 1 이면 「눕힌다」가 뜻이 없다');
});

/*
 * ── ⓑ 붓 (행동 — 가짜 ctx) ────────────────────────────────────────────────────
 */

test('ⓑ① 붓 — 채움 한 번 + 외곽 한 번, 채움이 더 옅고, 색은 둘 다 호출자가 준 값', () => {
  const ctx = fakeCtx();
  const path = { id: 'overlay' };
  const painted = paintCorrectionLayer(ctx, path, 0.5, 2, { color: 'rgb(9,8,7)' });
  assert.equal(painted, 2, '칠한 횟수가 2(채움+외곽) 가 아니다');
  assert.equal(ctx.calls.length, 2);

  const [fill, stroke] = ctx.calls;
  assert.equal(fill.op, 'fill', '채움이 먼저가 아니다 — 외곽이 채움에 덮인다');
  assert.equal(fill.path, path, '채움이 다른 경로를 그린다');
  assert.equal(fill.color, 'rgb(9,8,7)', '채움 색이 호출자가 준 색이 아니다');
  assert.equal(fill.alpha, 0.5 * R2_HUD_CORRECTION_FILL_RATIO, '채움 α 가 배율을 안 탄다');
  assert.equal(stroke.op, 'stroke');
  assert.equal(stroke.path, path);
  assert.equal(stroke.color, 'rgb(9,8,7)', '외곽 색이 채움과 다르다 — 한 어휘가 아니다');
  assert.equal(stroke.alpha, 0.5, '외곽이 채움만큼 옅다 — 「여기가 그 셀이다」를 말하는 선이다');
  assert.ok(fill.alpha < stroke.alpha, '채움이 외곽보다 옅지 않다');
  assert.equal(stroke.width, R2_HUD_CORRECTION_OUTLINE_PX * 2, '선폭이 변환 단위를 안 탄다');
  // 실선이다 — 점선은 «불신» 의 어휘라 여기 오면 두 축이 섞인다.
  assert.equal(stroke.dash, R2_HUD_SOLID_DASH, '정정 강조가 점선으로 그려진다');
  // 다음 층이 α 를 물려받지 않게 되돌린다.
  assert.equal(ctx.globalAlpha, 1, '붓이 globalAlpha 를 되돌리지 않는다 — 다음 층이 옅어진다');
  /*
   * 🔴 **공허 가드** (3b 검토 rulers F5). 위의 두 기대값은 상수 자체를 import 하므로, 상수가
   * 0 이 되면 「채움이 안 보인다 · 외곽이 없다」인데 자는 초록이다 — 자가 아무것도 안 재는
   * 상태다. 형제 상수(`R2_HUD_DISTRUST_FILL_RATIO`, ⓐ⑤)는 이 가드를 이미 갖고 있었다.
   */
  assert.ok(R2_HUD_CORRECTION_FILL_RATIO > 0 && R2_HUD_CORRECTION_FILL_RATIO < 1,
    '정정 채움 배율이 0 이나 1 이면 「외곽보다 옅다」가 뜻이 없다 (0 이면 채움이 안 보인다)');
  assert.ok(R2_HUD_CORRECTION_OUTLINE_PX >= 1,
    '정정 외곽 굵기가 1 px 미만이면 「여기가 그 셀이다」를 말하는 선이 화면에서 사라진다');
});

test('ⓑ③ ⚠ 금지 어휘 훑기 — 붓 모듈에 색 리터럴이 하나도 없다 (퇴역한 ⓞ② 의 명제)', () => {
  /*
   * 3b 검토 rulers F4: 보고서·주석은 «색이 입력이라 리터럴이 **구조적으로** 불가» 라고 적었지만
   * 그것은 거짓이었다 — `ctx.shadowColor = 'rgba(255,0,255,.8)'` 를 붓 본문에 넣어도 전부
   * 초록이었다. ⓑ① 은 fill/stroke 색만 보고, 저장소의 어느 자도 이 파일의 **소스**를 안 읽었다.
   * 그래서 ⓞ② 의 훑기를 여기로 옮긴다. 이것이 «철자 자» 가 아닌 이유: 대상이 순수 모듈 한
   * 파일이고, 재는 것이 배치·이름이 아니라 **금지 어휘의 부재**라 리팩터링에 안 썩는다.
   */
  const code = PAINT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), '붓 모듈에 16진 색 리터럴이 있다: ' + code.match(/#[0-9a-fA-F]{3,8}\b/));
  assert.ok(!/\b(rgba?|hsla?)\s*\(/i.test(code), '붓 모듈에 rgb/hsl 색 리터럴이 있다: ' + code.match(/\b(rgba?|hsla?)\s*\([^)]*\)/i));
  // 색이 실제로 «입력» 이라는 것도 같이 — 붓 밖에서 색 이름을 만드는 자리가 없다.
  assert.ok(!/(fillStyle|strokeStyle|shadowColor)\s*=\s*['"`]/.test(code),
    '붓 모듈이 캔버스 색 칸에 문자열 리터럴을 대입한다');
  // 자 자신이 공허하지 않은지 — 훑기가 볼 코드가 실제로 있어야 한다.
  assert.ok(code.includes('ctx.fillStyle = color'), '훑기 대상이 사라졌다 (붓이 다른 파일로 갔나?)');
});

test('ⓑ② 붓 — 그릴 근거가 없으면 **한 번도** 안 칠한다 (예외 없음)', () => {
  const path = { id: 'p' };
  const style = { color: 'rgb(1,2,3)' };
  const cases = [
    ['α 0', [fakeCtx(), path, 0, 2, style]],
    ['α 음수', [fakeCtx(), path, -1, 2, style]],
    ['α NaN', [fakeCtx(), path, Number.NaN, 2, style]],
    ['경로 없음', [fakeCtx(), null, 1, 2, style]],
    ['색 없음', [fakeCtx(), path, 1, 2, {}]],
    ['스타일 없음', [fakeCtx(), path, 1, 2, null]],
    ['선폭 0', [fakeCtx(), path, 1, 0, style]],
    ['선폭 NaN', [fakeCtx(), path, 1, Number.NaN, style]],
    ['ctx 없음', [null, path, 1, 2, style]],
  ];
  for (const [name, args] of cases) {
    assert.equal(paintCorrectionLayer(...args), 0, name + ': 그릴 근거가 없는데 칠했다');
    if (args[0]) assert.equal(args[0].calls.length, 0, name + ': ctx 를 건드렸다');
  }
  // α 는 1 을 넘지 않는다 (계획이 주는 값의 상한).
  const ctx = fakeCtx();
  paintCorrectionLayer(ctx, path, 9, 1, style);
  assert.equal(ctx.calls[1].alpha, 1, 'α 가 1 을 넘어 실린다');
});

/*
 * ── ⓒ 두 표면 ────────────────────────────────────────────────────────────────
 */

test('ⓒ 붓의 결정성 — 같은 α·같은 색을 받으면 두 표면이 같은 붓질을 낸다 (경로만 다르다)', () => {
  // 수명의 1/4 이 지난 프레임 — 정정 α 는 0.75 다.
  const plan = hudPaintPlan(withCorrection({ ...READY, phase: HUD_PHASE.DONE }, 6, R2_HUD_CORRECTION_MS * 0.25));
  assert.equal(plan.overlayCorrection, true);
  assert.equal(plan.miniCorrection, true);

  const style = { color: 'rgb(255,255,255)' };
  const overlay = fakeCtx();
  const mini = fakeCtx();
  const overlayPath = { id: 'lockH' };
  const miniPath = { id: 'identityH' };
  // 계획이 주는 **하나의** α 를 두 표면이 그대로 쓴다.
  assert.equal(paintCorrectionLayer(overlay, overlayPath, plan.correctionAlpha, 1, style), 2);
  assert.equal(paintCorrectionLayer(mini, miniPath, plan.correctionAlpha, 1, style), 2);

  assert.deepEqual(overlay.calls.map((c) => c.alpha), mini.calls.map((c) => c.alpha),
    '두 표면이 다른 α 로 그렸다 — 같은 상태의 두 그림이 다른 말을 한다');
  assert.deepEqual(overlay.calls.map((c) => c.color), mini.calls.map((c) => c.color),
    '두 표면이 다른 색으로 그렸다');
  // 경로는 달라야 한다 — 오버레이는 락 H, 미니는 항등 H 다 (사영이 하나면 미니가 카메라를 따라간다).
  assert.notEqual(overlay.calls[0].path, mini.calls[0].path);
  /*
   * ⚠ **이 자가 재지 않는 것** (3b 검토 rulers F6): 「계획이 두 표면에 같은 α 를 싣는가」.
   * 여기서는 자가 `plan.correctionAlpha` 를 두 번 **똑같이** 넘기므로 그 명제엔 동어반복이다.
   * 계획이 α 를 하나만 낸다는 것은 ⓐ⑤ 가, 렌더러가 그 하나를 두 자리에 넘긴다는 것은
   * `r2-hud.test.js` ⓠ① 이 잰다(철자). 여기가 잡는 실패는 «α 가 0 이 되면 둘 다 안 칠한다» 다.
   */
  const dark = hudPaintPlan({ ...READY, phase: HUD_PHASE.DONE, correction: null });
  assert.equal(paintCorrectionLayer(fakeCtx(), overlayPath, dark.correctionAlpha, 1, style), 0,
    '정정이 없는 프레임의 α 로도 칠했다');
});

/*
 * ── ⓓ 표시 판정 → `hidden` (이음새의 값) ──────────────────────────────────────
 */

test('ⓓ 🔴 표시 판정이 실제 표면의 `hidden` 이 된다 — 계획의 필드가 아니라 «표시» 를 잰다 (3b 검토 F1)', () => {
  /*
   * 🔴 **빚 1 의 마지막 칸.** ⓘ(scanner-accept-delay)가 세던 값은 `plan.surfaces.overlayHidden`
   * 이라는 **계획의 반환 필드**였고, 그 필드가 캔버스 속성에 닿는지는 어느 자에도 없었다 —
   * 오버레이를 `hidden = true` 로 못박아도(= ⑯(i) 가 막으려던 결함 그 자체) 표적 134/134 가
   * 초록이었다. 이음새가 쓰는 것이 `hidden` 한 칸뿐이라, 캔버스 없이 평범한 객체로 잰다.
   */
  const surface = () => ({ hidden: null });
  const els = { overlay: surface(), mini: surface(), cellMap: surface() };

  // 정정 강조가 살아 있는 DONE 프레임 — ⑯(i) 가 여는 바로 그 표면이다.
  const live = hudPaintPlan(withCorrection({ ...READY, phase: HUD_PHASE.DONE }));
  assert.equal(applyHudSurfaces(els, live.surfaces), 3, '세 표면에 다 대입하지 않았다');
  assert.equal(els.overlay.hidden, false, '⑯(i) 가 산 프레임에서 오버레이가 안 열린다 — 600 ms 가 빈 화면이다');
  assert.equal(els.mini.hidden, false);
  assert.equal(els.cellMap.hidden, false);

  // 정정이 없는 DONE — 오버레이만 닫힌다(결과 시트 아래 빈 그림 금지), 미니·셀맵은 그대로.
  const quiet = hudPaintPlan({ ...READY, phase: HUD_PHASE.DONE });
  applyHudSurfaces(els, quiet.surfaces);
  assert.equal(els.overlay.hidden, true, '정정 없는 DONE 에서 오버레이가 열려 있다');
  assert.equal(els.mini.hidden, false, '미니가 위상 때문에 닫혔다 — 점진 표시가 끊긴다');

  // 그릴 근거가 없는 프레임(카메라 정지 = 유예 만료 뒤) — 셋 다 닫힌다.
  applyHudSurfaces(els, hudPaintPlan({ ...READY, hasStream: false }).surfaces);
  for (const name of Object.keys(els)) assert.equal(els[name].hidden, true, name + ' 이 안 닫혔다');
  // `hideR2Hud` 가 쓰는 값도 **같은 이음새**로 같은 상태를 낸다.
  applyHudSurfaces(els, hudSurfaceVisibility({ hasStream: false }));
  for (const name of Object.keys(els)) assert.equal(els[name].hidden, true, name + ' (hideR2Hud 경로)');

  /*
   * 🔴 **판정의 모든 표면이 짝을 찾는다** — 짝짓기를 손 목록으로 두면 표면이 늘어난 날 한 칸이
   * 조용히 안 옮겨진다. 기대 목록을 판정의 **출력 키에서 유도**한다 (사본 목록 금지).
   */
  const verdict = hudSurfaceVisibility({ hasStream: true, runtimeEnabled: true, hasView: true, phase: HUD_PHASE.DATA });
  const names = Object.keys(verdict).map((k) => k.replace(/Hidden$/, ''));
  assert.ok(names.length >= 3, '표시 판정이 내는 표면이 셋 미만이다 — 자가 공허해졌다');
  for (const name of names) {
    const one = { [name]: surface() };
    assert.equal(applyHudSurfaces(one, verdict), 1, name + ' 표면이 짝을 못 찾는다 (이름 규칙이 갈렸다)');
    assert.equal(one[name].hidden, verdict[name + 'Hidden'], name + ' 의 표시가 판정과 다르다');
  }

  // 없는 표면은 건너뛴다 (hideR2Hud 의 옛 null 가드와 같은 행동) · 잘못된 입력에 안 던진다.
  assert.equal(applyHudSurfaces({ overlay: null, mini: undefined }, live.surfaces), 0);
  for (const bad of [undefined, null, 0, 'x', []]) {
    assert.equal(applyHudSurfaces(bad, live.surfaces), 0, String(bad));
    assert.equal(applyHudSurfaces(els, bad), 0, String(bad));
  }
  // 판정이 아닌 키는 건드리지 않는다 — `hidden` 접미 규칙 밖의 필드가 표면을 여닫으면 안 된다.
  const stray = { overlay: surface() };
  assert.equal(applyHudSurfaces(stray, { overlay: true, Hidden: true, overlayHiddenish: true }), 0,
    '표시 판정이 아닌 키가 표면을 건드렸다');
});
