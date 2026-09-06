/**
 * r2-hud.test.js — R2 HUD 통합(§27.4 3a)의 자.
 *
 * HUD 는 **브라우저에서만** 진짜로 보인다 — 캔버스·getBoundingClientRect·Path2D 가 여기 없다. 그래서 이 파일이
 * 재는 것은 «그림이 예쁜가» 가 아니라 **그림이 도달할 수 있는 배선인가** 다:
 *   ⓐ 마크업 — 전면 캔버스가 스테이지 안·상단 행 앞·authored hidden, 미니 상자가 셀맵 캔버스를 감싼다.
 *      «authored hidden» 은 **독립 속성** `hidden` 이다 — `[^>]*hidden` 은 `aria-hidden` 에 걸려 통과하므로
 *      속성 경계를 요구하고, 그 자가 실제로 빨개지는지 돌연변이(hidden 제거)로 자 자신을 먼저 검증한다.
 *   ⓑ CSS 성질 — z 순서(점 레이어 < 디버그 < HUD < 상단 행)를 **숫자를 파싱해** 비교, 표시용 층은 클릭을
 *      안 먹고, 우 칸 위젯은 스스로 갇히며, 스캔선은 **위상 규칙 아래에서만** 움직이고 reduced-motion 에서
 *      아예 안 보인다. CSS 의 위상 문자열은 `HUD_PHASE.SEARCHING` 에서 유도해 맞춘다(사본 금지).
 *   ⓒ 묶음 전수 — `HUD_BUCKETS` 의 **모든** 키가 렌더러의 유도(역할×변동/확정 ∪ DATA×상태)로 나온다.
 *      하나라도 빠지면 그 묶음은 색이 없어 화면에서 조용히 사라진다.
 *   ⓓ ⚠ **철자 자** — 렌더러가 순수 모듈을 실제로 부르고, 재사영을 락 세대로 게이트하고, 좌 패널과 같은
 *      선두를 쓰고, 화면 변환에 **락 프레임 폭**을 쓰며, R2 위치가 시험판 패널을 갱신한다. 철자 자인 이유:
 *      이 층은 브라우저 밖에서 실행할 수 없다. 다음 리팩터링까지만 산다.
 *   ⓕ 수동 리셋(⑫)의 마크업·CSS 성질 — 스테이지 안 · authored hidden · 눌리는 층 · 상단 행/안정 게이지와
 *      **숫자로** 안 겹치는 자리.
 *   ⓖ 중앙 탭 판정의 진리표 — 순수 함수라 값으로 잰다 (경계 포함 · 원이지 정사각 아님 · 잘못된 입력은 거짓).
 *   ⓗⓘⓙⓚ ⚠ **철자 자** — 미니 = 아이소메트릭(⑪) · 디자인 톤(⑧) · 줌→락 무효화와 리셋 두 입구(H4·⑫) ·
 *      시험판 hud 줄의 덧붙임(H6). 전부 브라우저 밖에서 실행할 수 없는 층이다.
 *   ⓔ ⚠ **철자 자** — 색표 유도: 역할색 키가 HUD_ROLE 에서 온다(리터럴 숫자 키 0건). 이름 목록은 손으로
 *      적지 않고 HUD_ROLE 에서 유도하지만, 표를 «소스 문자열로» 확인하는 부분이 있어 철자 자로 표기한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { HUD_BUCKETS, HUD_PHASE, HUD_ROLE, bucketKey, hudSurfaceVisibility } from '../src/r2-hud-model.js';
// 중앙 탭 판정은 순수 함수라 여기서 **값으로** 잰다 (r2-hud*.test 가 이 레인의 자리다 — ⓖ).
import { STAGE_CENTRE_TAP_FRACTION, stageTapIsCentre, analysisScaleOf } from '../src/scanner-scan-assist.js';
// 줌 계획은 순수 모듈이 만든다 — ⓙ 가 «track 줌» 을 **값으로** 재려면 그 계획이 필요하다 (결함 15).
import { resolveZoomPlan } from '../src/scanner-zoom.js';
// hud 줄도 이제 순수 빌더다 — ⓚ 가 철자가 아니라 **출력 길이**를 잰다 (결함 16).
import { R2_HUD_DEBUG_LINE_BUDGET, counterAbbrev, r2HudDebugLine } from '../src/r2-hud-model.js';
// 불신 색의 «세기만 다른 자리» 도 순수 유도자를 거친다 — ⓛ ⑥ 가 **값으로** 잰다 (3d 검토 결함 6).
import { scaleColorAlpha } from '../src/r2-hud-model.js';
import { createR2ScanRuntime } from '../src/r2-scan-runtime.js';
import { CELL_MAP_STATE } from '../src/r2/progress.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HTML = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
const JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');

/** `sel {` 로 시작하는 첫 CSS 블록의 본문 (중첩 없는 규칙용). */
function cssBlock(sel) {
  const a = HTML.indexOf(sel + ' {');
  assert.ok(a > 0, sel + ' 블록이 없다');
  return HTML.slice(a, HTML.indexOf('}', a));
}

/** `open` 위치의 여는 괄호와 짝인 닫는 괄호의 인덱스. */
function braceEnd(source, open) {
  assert.equal(source[open], '{');
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  assert.fail('닫는 중괄호를 못 찾았다');
}

/*
 * ── CSS 커스텀 속성 평가기 (2026-09-06 검토 R3c, 결함 18) ─────────────────────
 * 옛 자는 `const MIN_STAGE_SIDE = 287` 을 **index.html 주석에서 옮겨 적었다.** 둘이 어긋나도
 * 아무 자도 안 빨개진다 — 사본 목록 규칙 위반이다. 그래서 실제 식(`--tl-square-side`)을
 * 뷰포트 하나에 놓고 **유도**한다.
 *
 * 다루는 문법은 이 파일이 실제로 쓰는 것뿐이다: `var()` · `calc()` · `min()` · `max()` ·
 * `env()`(안전영역 없음 = 0) · `px/vw/vh/dvh/dvw`. 그 밖의 것이 오면 `Function` 이 던지고
 * **자가 빨개진다** — 「조용히 옛 수를 계속 쓰는」 것보다 낫다(안전 쪽 실패).
 */
function rootVars() {
  const at = HTML.indexOf(':root {');
  assert.ok(at > 0, ':root 블록이 없다');
  const block = HTML.slice(at, HTML.indexOf('}', at));
  const vars = new Map();
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) vars.set(m[1], m[2].trim());
  assert.ok(vars.size >= 8, ':root 변수 훑기가 무너졌다 (' + vars.size + '개)');
  return vars;
}

function evalCssLength(expr, vars, viewport, depth = 0) {
  assert.ok(depth < 12, 'CSS 변수 참조가 순환한다: ' + expr);
  let text = String(expr);
  // var(--x) 를 안에서부터 펼친다. 폴백(`var(--x, y)`)은 이 파일에 없다 — 나오면 아래 Function 이 던진다.
  for (let guard = 0; guard < 20 && text.includes('var('); guard += 1) {
    text = text.replace(/var\((--[a-z0-9-]+)\)/g, (_, name) => {
      assert.ok(vars.has(name), '모르는 CSS 변수 ' + name);
      return '(' + vars.get(name) + ')';
    });
  }
  text = text.replace(/env\([^()]*\)/g, '0');
  text = text.replace(/\bcalc\(/g, '(').replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(');
  text = text.replace(/(\d*\.?\d+)(dvw|dvh|vw|vh|px)/g, (_, num, unit) => {
    const value = Number(num);
    if (unit === 'px') return String(value);
    if (unit === 'vw' || unit === 'dvw') return String((value / 100) * viewport.width);
    return String((value / 100) * viewport.height);
  });
  // 남은 글자가 수식뿐인지 먼저 본다 — 모르는 함수·키워드가 조용히 통과하지 않게.
  assert.match(text, /^[-+*/().,\s0-9]|Math\./, '평가할 수 없는 CSS 식: ' + expr);
  // eslint-disable-next-line no-new-func
  const value = Function('Math', 'return (' + text + ');')(Math);
  assert.ok(Number.isFinite(value), 'CSS 식이 수가 아니다: ' + expr + ' -> ' + text);
  return value;
}

/** 지원하는 **가장 짧은** 스테이지 한 변 — 320×640 세로 폰의 `--tl-square-side`. */
function minStageSide() {
  const vars = rootVars();
  const side = evalCssLength(vars.get('--tl-square-side'), vars, { width: 320, height: 640 });
  // 공허 방지 — 평가기가 0 이나 하한(96px)만 돌려주면 아래 겹침 산술이 아무것도 안 잰다.
  assert.ok(side > 200 && side < 320, '유도한 스테이지 한 변이 이상하다: ' + side);
  return side;
}

/** 선택자의 z-index 를 **수로** 읽는다 — 문자열 비교는 '10' < '2' 로 거짓말을 한다. */
function zIndexOf(sel) {
  const value = (cssBlock(sel).match(/z-index:\s*(-?\d+)/) || [])[1];
  assert.ok(value !== undefined, sel + ' 에 z-index 가 없다');
  return Number(value);
}

/** `function renderR2CellMap()` 의 본문. */
function renderBody() {
  const at = JS.indexOf('function renderR2CellMap()');
  assert.ok(at > 0, 'renderR2CellMap 이 없다');
  return JS.slice(at, braceEnd(JS, JS.indexOf('{', at)) + 1);
}

/** 프레임 루프의 R2 블록 본문 — 길이 짐작(slice(+1800))이 아니라 괄호 짝으로 자른다. */
function r2LoopBlock() {
  const at = JS.indexOf('if (r2Runtime.enabled) {');
  assert.ok(at > 0, '프레임 루프의 R2 블록이 없다');
  return JS.slice(at, braceEnd(JS, JS.indexOf('{', at)) + 1);
}

/**
 * «독립 속성 `hidden` 을 가진 태그» 정규식. `[^>]*hidden` 은 `aria-hidden` 에 걸려 통과한다 —
 * 그래서 id 뒤의 것을 **속성 단위로** 소비하고 경계 뒤의 `hidden` 만 인정한다.
 */
function authoredHiddenRe(id) {
  return new RegExp('id="' + id + '"(?:\\s+[\\w-]+(?:="[^"]*")?)*\\s+hidden(?=[\\s>/])');
}

test('ⓐ 마크업 — 전면 HUD 캔버스가 스테이지 안·상단 행 앞·authored hidden·aria-hidden, 미니 상자가 셀맵을 감싼다', () => {
  const stageAt = HTML.indexOf('id="camera-stage"');
  const stageEnd = HTML.indexOf('</section>', stageAt);
  assert.ok(stageAt > 0 && stageEnd > stageAt);
  const stage = HTML.slice(stageAt, stageEnd);

  const hudAt = stage.indexOf('id="r2-hud"');
  const meterAt = stage.indexOf('id="steady-meter"');
  const rowAt = stage.indexOf('id="stage-top-row"');
  assert.ok(hudAt > 0, '전면 HUD 캔버스가 스테이지 안에 없다 — 스테이지 밖이면 좌표계가 다르다');
  assert.ok(meterAt > 0 && meterAt < hudAt, 'HUD 가 안정 게이지보다 앞이다');
  assert.ok(hudAt < rowAt, 'HUD 가 상단 행 뒤다 — DOM 순서와 z 순서가 어긋난다');
  // 자 자신 먼저 (돌연변이 검증): `hidden` 을 뗀 마크업에 같은 자를 대면 **빨개져야** 한다.
  // 옛 자 `/id="r2-hud"[^>]*hidden/` 는 `aria-hidden` 에 걸려 이 돌연변이를 통과시켰다.
  const mutated = '<canvas class="r2-hud" id="r2-hud" aria-hidden="true"></canvas>';
  assert.ok(!authoredHiddenRe('r2-hud').test(mutated),
    'authored-hidden 자가 aria-hidden 에 걸려 통과한다 — 이 자는 hidden 제거를 못 잡는다');
  assert.match(stage, authoredHiddenRe('r2-hud'), '전면 HUD 가 authored hidden 이 아니다 — r2Available 이 거짓인 화면(승격 되돌림)에서도 뜬다');
  assert.match(stage, /id="r2-hud"[^>]*aria-hidden="true"/, '장식 캔버스가 낭독 대상이다');

  // 미니 상자 — 셀맵 캔버스와 스캔선을 **한 상자 안에** 담아야 상자가 둘을 같이 잘라낸다.
  const miniAt = stage.indexOf('<div class="r2-hud-mini"');
  assert.ok(miniAt > 0, '미니 HUD 상자가 없다');
  const miniEnd = stage.indexOf('</div>', miniAt);
  const mini = stage.slice(miniAt, miniEnd);
  assert.ok(mini.includes('id="r2-cellmap"'), '미니 상자가 셀맵 캔버스를 감싸지 않는다');
  assert.ok(mini.includes('r2-hud-scan'), '스캔선이 미니 상자 안에 없다 — 상자 밖이면 잘리지 않는다');
  assert.match(stage, authoredHiddenRe('r2-hud-mini'), '미니 상자가 authored hidden 이 아니다');
  // 상자도 장식이다 — 이름 없는 빈 div 라 낭독 소음은 0 이지만, «장식 층은 낭독 밖» 을 표면 셋에 같이 건다.
  assert.match(stage, /id="r2-hud-mini"[^>]*aria-hidden="true"/, '미니 HUD 상자가 낭독 대상이다');
  // 옛 «112 고정 backing» 은 폐기 — dpr 은 scanner.js 가 잡는다.
  assert.ok(!/id="r2-cellmap"[^>]*width="/.test(stage),
    '셀맵에 width 속성이 남았다 — backing 픽셀을 마크업이 고정하면 dpr 이 죽는다');
});

test('ⓑ CSS 성질 — z 순서(점 2 < 디버그 3·4 < HUD 5 < 상단 행 6)·표시용 층은 클릭을 안 먹음·우 칸 자기 상한·스캔선은 위상 아래에서만·reduced-motion 에서 안 보임', () => {
  const dotZ = zIndexOf('.scan-dot-layer');
  const hudZ = zIndexOf('.r2-hud');
  const rowZ = zIndexOf('.stage-top-row');
  assert.ok(hudZ > dotZ, 'HUD 가 조준 점 레이어 아래다 (' + hudZ + ' ≤ ' + dotZ + ')');
  assert.ok(hudZ < rowZ, 'HUD 가 상단 행 위다 — 진행 패널·스위치를 덮는다 (' + hudZ + ' ≥ ' + rowZ + ')');
  /*
   * 잠긴 층 순서 (운영자 결정 ⑨): 점 2 < 시험판 디버그 3·4 < HUD 5 < 상단 행 6.
   * ⚠ 즉 **HUD 채움이 하단 디버그 패널 위에 온다** — 코드가 스테이지 하단에 사영되면 역할색(α .55)이 패널의
   *   qr·hud 줄을 덮는다. 그 트레이드오프는 결정된 것이다(HUD 는 실제 자리에 그린다). 디버그 가독이 필요해지면
   *   패널 영역을 HUD 캔버스에서 clip 하는 것이 후속 방법이고, z 를 뒤집는 것이 아니다.
   */
  assert.ok(hudZ > zIndexOf('.lab-debug-layer') && hudZ > zIndexOf('.lab-debug-panel'),
    'HUD 가 시험판 디버그 층 아래다 — 잠긴 층 순서(디버그 < HUD)가 깨졌다');

  for (const sel of ['.r2-hud', '.r2-hud-mini']) {
    assert.match(cssBlock(sel), /pointer-events:\s*none/, sel + ' 이 클릭을 먹는다 — 표시용 층이 조작을 가로챈다');
  }
  assert.match(cssBlock('.r2-hud'), /inset:\s*0/, 'HUD 가 스테이지를 다 덮지 않는다');

  const miniWidth = (cssBlock('.r2-hud-mini').match(/(?:^|[\s;])width:([^;]+);/) || [])[1] || '';
  assert.ok(/min\(/.test(miniWidth) && /\d+px/.test(miniWidth),
    '미니 HUD 가 «열 폭 이하 · px 상한» 으로 안 갇힌다 (우 트랙이 1fr 이라 스스로 갇혀야 정중앙이 산다): ' + miniWidth);
  assert.match(cssBlock('.r2-hud-mini'), /overflow:\s*hidden/, '미니 상자가 스캔선을 안 잘라낸다');

  /*
   * 스캔선 — 두 성질을 잰다.
   *   (1) 기본 규칙은 **안 보이고 안 움직인다** (opacity:0 · animation:none). 애니메이션을 기본에 걸면
   *       보이지 않는 선의 top 이 모든 위상에서 60fps 로 갱신된다.
   *   (2) 키프레임을 켜는 곳은 **위상 규칙 하나뿐**이고, 그 위상 문자열은 HUD_PHASE.SEARCHING 에서 유도한다
   *       (CSS 가 모델 값의 사본을 손으로 들면 모델이 바뀌는 날 스캔선이 조용히 영원히 꺼진다).
   * ⚠ CSS 주석을 먼저 벗긴다 — 주석 안의 선택자 언급에 착지하면 자가 엉뚱한 텍스트를 잰다(옛 결함).
   */
  const CSS = HTML.replace(/\/\*[\s\S]*?\*\//g, '');
  const baseAt = CSS.indexOf('.r2-hud-scan {');
  assert.ok(baseAt > 0, '기본 .r2-hud-scan 규칙이 없다');
  const scanBase = CSS.slice(baseAt, CSS.indexOf('}', baseAt) + 1);
  assert.match(scanBase, /animation:\s*none/, '기본 규칙이 스캔선을 계속 돌린다 — 위상과 무관하게 매 프레임 top 이 바뀐다');
  assert.match(scanBase, /opacity:\s*0/, '기본 규칙에서 스캔선이 보인다 — SEARCHING 밖에서도 흐른다');

  const phaseSel = '.r2-hud-mini[data-phase="' + HUD_PHASE.SEARCHING + '"] .r2-hud-scan';
  assert.ok(CSS.includes(phaseSel),
    'CSS 의 위상 선택자가 HUD_PHASE.SEARCHING(' + HUD_PHASE.SEARCHING + ') 과 다르다 — 스캔선이 영원히 안 뜬다');
  // 키프레임 참조(`animation: r2-hud-scan …`)는 위상 규칙 아래에만. 선언 수를 세어 «기본으로 새지 않았음» 을 잰다.
  const animRefs = CSS.match(/animation:\s*r2-hud-scan/g) || [];
  assert.equal(animRefs.length, 1, '스캔선 애니메이션 선언이 ' + animRefs.length + '곳이다 — 위상 규칙 하나여야 한다');
  const animAt = CSS.indexOf('animation: r2-hud-scan');
  assert.ok(CSS.lastIndexOf(phaseSel, animAt) > CSS.lastIndexOf('}', animAt),
    '스캔선 애니메이션이 위상 규칙 밖에 있다');

  // reduced-motion — 스캔선이 «멈춘 채 보이는» 것도 거짓 신호다. 애니메이션과 가시성을 **둘 다** 끈다.
  let stopped = false;
  for (let at = CSS.indexOf('prefers-reduced-motion'); at > 0; at = CSS.indexOf('prefers-reduced-motion', at + 1)) {
    const body = CSS.slice(at, braceEnd(CSS, CSS.indexOf('{', at)) + 1);
    const selAt = body.indexOf('.r2-hud-scan');
    if (selAt < 0) continue;
    const rule = body.slice(selAt, body.indexOf('}', selAt) + 1);
    assert.match(rule, /animation:\s*none/, 'reduced-motion 에서 스캔선 애니메이션이 안 멈춘다');
    assert.match(rule, /opacity:\s*0/, 'reduced-motion 에서 스캔선이 멈춘 채 **보인다** — 거짓 신호다');
    // 미디어 쿼리는 특이도를 안 올린다 — 위상 규칙의 opacity:1 을 이기려면 그 선택자를 같이 적어야 한다.
    assert.ok(rule.includes(phaseSel), 'reduced-motion 규칙이 위상 선택자를 안 덮는다 — opacity:1 이 이긴다');
    stopped = true;
  }
  assert.ok(stopped, 'reduced-motion 블록에 .r2-hud-scan 이 없다 — 움직임을 끄지 않는 장식이다');
});

test('ⓒ 묶음 전수 — HUD_BUCKETS 의 모든 키가 렌더러의 유도(역할×변동/확정 ∪ DATA×상태)로 나온다', () => {
  // 렌더러(scanner.js)가 색을 심는 방식 그대로 다시 유도한다. 빠진 키가 있으면 그 묶음은 화면에서 색 없이 사라진다.
  const derived = new Set();
  for (const role of Object.values(HUD_ROLE)) {
    if (role === HUD_ROLE.EMPTY || role === HUD_ROLE.DATA) continue;
    for (const tentative of [true, false]) {
      const key = bucketKey(role, CELL_MAP_STATE.UNOBSERVED, tentative);
      assert.ok(key !== null, '역할 ' + role + ' 이 묶음 키를 못 만든다');
      derived.add(key);
    }
  }
  for (const state of Object.values(CELL_MAP_STATE)) {
    const key = bucketKey(HUD_ROLE.DATA, state, false);
    assert.ok(key !== null, '데이터 상태 ' + state + ' 가 묶음 키를 못 만든다');
    derived.add(key);
  }
  assert.deepEqual([...HUD_BUCKETS].sort(), [...derived].sort(),
    'HUD_BUCKETS 와 렌더러의 유도가 어긋난다 — 어느 한쪽이 색 없는 묶음을 만든다');
  // EMPTY 는 묶음이 없다 (그리지 않는다).
  assert.equal(bucketKey(HUD_ROLE.EMPTY, CELL_MAP_STATE.UNOBSERVED, true), null);
});

test('ⓓ ⚠ 철자 자 — 렌더러가 순수 모듈을 부르고, 재사영을 사영 입력 여섯으로 게이트하고, 좌 패널과 같은 선두를 쓴다', () => {
  const body = renderBody();
  for (const needle of ['hudPhase(', 'countObserved(', 'buildRoleGrids(', 'bucketKey(',
    'projectFaceQuadsInto(', 'projectGridLinesInto(', 'projectOutlineInto(', 'faceQuadSlot(', 'finiteBoundsInto(']) {
    assert.ok(body.includes(needle), 'renderR2CellMap 이 ' + needle + ' 를 안 부른다 — 그 규칙을 손으로 다시 적었다는 뜻이다');
  }
  /*
   * 재사영은 «사영 입력이 바뀔 때만» (H5). **의도적 갱신 2026-09-06**: 예전 자는 `lockRevision !== ` 라는
   * 철자를 요구했는데, 그 조건 하나로는 «후보 폐기 → 같은 락으로 재bind» 를 못 본다 (disposeCandidates 는
   * lockRevision 을 안 건드린다 — 운영자 실기 3차 ①의 「실루엣이 안 움직인다」). 이제 판정은 순수 모듈에
   * 있고(가짜 view 로 여섯 요소를 재는 자는 r2-hud-model.test), 여기서는 **배선**만 잰다.
   */
  assert.ok(/if \(hudProjectionChanged\(r2Hud, projection\)\)/.test(body),
    '재사영이 hudProjectionChanged 로 게이트되지 않는다 — 매 프레임 전체를 다시 사영하거나, 락 세대만 본다');
  // 여섯 요소가 실제로 넘어가야 한다 — 인자를 안 실으면 판정 함수는 있는데 재는 게 없다.
  for (const field of ['lockRevision: view.lockRevision', 'bindRevision: stats.bindRevision',
    'frameW: view.frameWidth', 'frameH: view.frameHeight', 'H: view.H']) {
    assert.ok(body.includes(field), '사영 입력에 ' + field + ' 가 없다 — 그 축의 변화는 HUD 가 못 본다');
  }
  // 선두는 좌 패널과 **같은 값**이어야 한다 (⑧) — 따로 고르면 역할색과 칩이 다른 레이아웃을 말한다.
  assert.ok(body.includes('r2LeadingId'),
    'HUD 가 좌 패널의 히스테리시스 선두(r2LeadingId)를 안 쓴다 — 두 표면이 다른 레이아웃을 말한다');
  // 그 «같은 값» 에 fallback 을 붙이면 안 된다 — 좌 패널이 NONE(선두 '')인 프레임에 HUD 만 옛 선두로 칠한다.
  assert.ok(!/r2LeadingId\s*\|\|/.test(body),
    'HUD 가 선두에 fallback 을 붙였다 — 히스테리시스를 우회해 좌 패널과 다른 레이아웃을 말한다');
  /*
   * 화면 변환의 분모는 **마지막으로 사영한 프레임의 폭**(r2Hud.frameW)이다. view.frameWidth 는 매 프레임
   * 현재 luma 폭으로 덧써지는데(r2-scan-runtime.test ⓣ 가 값으로 잰다) H·사영 버퍼는 사영한 그 프레임의
   * 좌표계에 고정이라, 다시 안 푼 프레임에서 현재 폭으로 나누면 그림이 다른 배율로 좌상단에 붙는다.
   */
  assert.ok(/backing \/ r2Hud\.frameW/.test(body) && /backing \/ r2Hud\.frameH/.test(body),
    'HUD 변환이 사영 프레임 폭(r2Hud.frameW/H)을 안 쓴다');
  assert.ok(!/backing \/ view\.frame/.test(body),
    'HUD 변환이 «현재 프레임» 폭(view.frameWidth/Height)을 쓴다 — 사영을 안 다시 푼 프레임에서 그림이 어긋난다');
  /*
   * 그 폭은 **사영과 같은 자리에서만** 심긴다. 이제 심는 곳은 hudCaptureProjection 한 곳이고, 렌더 본문엔
   * r2Hud.frameW 로의 대입이 **하나도 없어야** 한다 — 매 프레임 덧쓰기가 다시 생기면 위 자는 초록인 채로
   * 같은 결함이 산다.
   */
  assert.ok(!/r2Hud\.frameW\s*=/.test(body),
    '렌더 본문이 사영 프레임 폭을 직접 대입한다 — 기록은 hudCaptureProjection 한 곳이어야 한다');
  const captureAt = body.indexOf('hudCaptureProjection(');
  assert.ok(captureAt > body.indexOf('projectOutlineInto(') && captureAt < body.indexOf('const leadingId'),
    '사영 기록이 재사영 블록(사영 셋 ~ 선두 판정) 밖이다 — 조건은 참인데 기록이 없으면 매 프레임 재사영이다');
  assert.equal((body.match(/hudCaptureProjection\(/g) || []).length, 1,
    '사영 기록이 두 곳이다 — 하나는 조건 밖에서 스냅샷을 덮는다');
  /*
   * 페이드인(⑩ 사이버 효과)은 «새 락» 의 효과다. 재사영이 락보다 잦아졌으므로(재bind·프레임 크기 변화)
   * 시각을 재사영마다 새로 잡으면 CANDIDATE_PATIENCE_FRAMES 주기(≈42프레임)로 화면이 깜빡인다 —
   * A6 의 «플래시 금지» 를 재사영 조건이 조용히 어기는 자리다.
   */
  assert.ok(/if \(relocked\) r2Hud\.lockedAt = nowMs\(\);/.test(body),
    '페이드인 시각이 재사영마다 갱신된다 — 재bind 주기로 HUD 가 깜빡인다');
  // width/height 대입은 캔버스를 지운다 — 조건 없이 대입하면 매 프레임 깜빡인다.
  assert.ok(/if \(r2HudCanvas\.width !== /.test(body) && /if \(r2CellMapCanvas\.width !== /.test(body),
    'backing 대입이 «달라졌을 때만» 이 아니다 — 매 프레임 캔버스를 지운다');
  // 프레임 루프의 R2 블록이 여전히 매 프레임 그린다 (r2-scan-runtime ⓗ 와 중복이라도 여기서 같이 잠근다).
  const block = r2LoopBlock();
  assert.ok(block.includes('renderR2CellMap()'),
    '프레임 루프의 R2 블록이 HUD 를 안 그린다 — 스캔 중에 그림이 멈춰 있다');
  // 시험판 하단 패널의 hud 줄 — «있을 때만» 규약(qr 과 같음).
  assert.ok(JS.includes('hud: r2Available ? r2HudDebugLine() : \'\''),
    '하단 패널이 HUD 위상·비용 줄을 안 받는다');
  /*
   * …그리고 그 줄이 **도달할 수 있어야** 한다. 패널 갱신(updateDebugOverlay)은 R1 경로(decodeFrame ·
   * flushPriorReport)에만 있었는데 R2 위치에선 R1 이 안 돈다(결정 ②) — 그래서 hud·qr 줄이 화면에 닿은 적이
   * 없었다. R2 블록 안에 갱신 호출이 **있어야** 한다.
   */
  assert.ok(block.includes('updateDebugOverlay('),
    'R2 블록이 시험판 패널 프레임 요약을 갱신하지 않는다 — 이 위치에선 hud·qr 줄이 화면에 도달할 수 없다');
});

test('ⓔ ⚠ 철자 자 — 역할색 표는 HUD_ROLE 에서 유도된다 (리터럴 숫자 키 0건 · 이름 손 목록 0건)', () => {
  const at = JS.indexOf('const R2_HUD_ROLE_COLOR = Object.freeze({');
  assert.ok(at > 0, '역할색 표가 없다');
  const table = JS.slice(at, JS.indexOf('});', at));
  /*
   * 색을 갖는 역할 = HUD_ROLE − {EMPTY(안 그림), DATA(셀맵 상태색)}. **유도**한다 — 손 목록을 들면
   * HUD_ROLE 에 역할이 하나 늘어도 자가 초록인 채 그 역할만 색 없이 사라진다 (형제 ⓒ 와 같은 유도).
   */
  const colored = Object.entries(HUD_ROLE)
    .filter(([, value]) => value !== HUD_ROLE.EMPTY && value !== HUD_ROLE.DATA)
    .map(([name]) => name);
  assert.ok(colored.length >= 4, '색을 갖는 역할이 ' + colored.length + '개다 — 유도가 무너졌다');
  for (const name of colored) {
    assert.ok(table.includes('[HUD_ROLE.' + name + ']:'), '역할색 표에 HUD_ROLE.' + name + ' 이 없다');
  }
  assert.ok(!/^\s*\d+\s*:/m.test(table),
    '역할색 표에 리터럴 숫자 키가 있다 — HUD_ROLE 값이 바뀌는 날 조용히 어긋난다');
  // 데이터 셀 색은 새로 적지 않고 셀맵 색표를 그대로 쓴다 (사본 금지). 지역 변수 이름은 안 고정한다.
  assert.match(JS, /R2_CELL_COLOR\[\w+\]/,
    '데이터 셀 색이 셀맵 색표(R2_CELL_COLOR)에서 안 온다 — 두 그림이 다른 어휘로 읽힌다');
});

/*
 * ── 실기 3차(2026-09-06.02) 뒤 추가분 ─────────────────────────────────────────────────────
 * ⓕ 수동 리셋 버튼(⑫)의 마크업·CSS 성질 · ⓖ 중앙 탭 판정의 진리표(순수) · ⓗ 미니 = 아이소메트릭(⑪) ·
 * ⓘ 디자인 톤(⑧) · ⓙ 줌 → 락 무효화(H4)와 두 입구의 같은 함수 · ⓚ 시험판 hud 줄의 «있을 때만» 덧붙임.
 * ⓗⓘⓙⓚ 는 브라우저 밖에서 실행할 수 없는 층이라 ⚠ **철자 자**다 — 다음 리팩터링까지만 산다.
 */

test('ⓕ 수동 리셋 — 스테이지 안 · authored hidden · 눌리는 층 · 상단 행/안정 게이지와 안 겹치는 자리', () => {
  const stageAt = HTML.indexOf('id="camera-stage"');
  const stageEnd = HTML.indexOf('</section>', stageAt);
  const stage = HTML.slice(stageAt, stageEnd);

  assert.ok(stage.includes('id="scan-reset"'),
    '수동 리셋 버튼이 스테이지 안에 없다 — 밖이면 중앙 탭과 좌표계가 다르고 뷰파인더를 안 따라간다');
  assert.match(stage, authoredHiddenRe('scan-reset'),
    '리셋 버튼이 authored hidden 이 아니다 — r2Available 이 거짓인 화면(승격 되돌림)에서도 뜬다');
  assert.match(stage, /id="scan-reset"[^>]*type="button"|type="button"[^>]*id="scan-reset"/,
    '리셋 버튼에 type="button" 이 없다 — 폼 안에 들어가는 날 submit 이 된다');
  // 낭독은 아이콘(↺)이 아니라 문구가 맡는다 — 여덟 언어 값은 scanner-i18n.test 가 잰다.
  assert.match(stage, /id="scan-reset"[\s\S]{0,200}?data-i18n-attr="aria-label:reset\.label"/,
    '리셋 버튼의 aria-label 이 i18n 에 안 묶였다 — 한 언어에서만 낭독된다');

  const reset = cssBlock('.scan-reset');
  assert.match(reset, /position:\s*absolute/, '리셋 버튼이 스테이지 좌표계에 안 붙는다');
  // 표시용 층(.r2-hud·.r2-hud-mini)과 정반대 성질 — 이 층은 **눌려야** 한다.
  assert.match(reset, /pointer-events:\s*auto/,
    '리셋 버튼이 클릭을 안 먹는다 — 조상이 pointer-events:none 이면 버튼이 죽는다');
  assert.ok(zIndexOf('.scan-reset') > zIndexOf('.r2-hud'),
    '리셋 버튼이 HUD 캔버스 아래다 — 사영된 마름모가 버튼을 덮는다');

  /*
   * 자리 규칙 두 가지 — «겹치지 않는다» 를 숫자로 잰다 (그림을 못 보는 자리에서 재는 방법).
   *   ① 안정 게이지(bottom:6 · height:2)보다 위: reset.bottom ≥ 6 + 2.
   *   ② 상단 행(top 앵커)과 반대 모서리: reset 은 top 이 없고 bottom 앵커이며, 두 덩어리의 세로 합이
   *      **가장 짧은 지원 스테이지**(320px 폰의 정사각 ≈287px, index.html 상단 행 주석)보다 작다.
   */
  const px = (block, prop) => {
    const value = (block.match(new RegExp('(?:^|[\\s;{])' + prop + ':\\s*(-?\\d+)px')) || [])[1];
    assert.ok(value !== undefined, prop + ' 를 px 로 못 읽었다');
    return Number(value);
  };
  const vars = rootVars();
  const viewport = { width: 320, height: 640 };
  /** 버튼의 bottom 은 이제 `calc(var(--lab-panel-*) …)` 이라 px 파싱이 아니라 **평가**한다. */
  const resetBottom = evalCssLength(
    (reset.match(/(?:^|[\s;{])bottom:\s*([^;]+);/) || [])[1], vars, viewport,
  );
  const meter = cssBlock('.steady-meter');
  assert.ok(resetBottom >= px(meter, 'bottom') + px(meter, 'height'),
    '리셋 버튼이 안정 게이지와 겹친다 — 조준 중 유일하게 늘 떠 있는 인디케이터를 가린다');
  assert.ok(!/(?:^|[\s;{])top:/.test(reset),
    '리셋 버튼이 top 앵커다 — 상단 행과 같은 모서리를 잡으면 짧은 폰에서 겹친다');
  const miniMax = Number((cssBlock('.r2-hud-mini').match(/width:\s*min\([^,]+,\s*(\d+)px\)/) || [])[1]);
  assert.ok(miniMax > 0, '미니 HUD 의 px 상한을 못 읽었다 — 상단 행 높이를 유도할 수 없다');

  /*
   * 🔴 ③ **시험판 하단 패널과 안 겹친다** (2026-09-06 검토 R3c, 결함 14).
   * 버튼이 보이는 **유일한 표면이 시험판**인데 옛 값(bottom:14px · 36px = 14\~50px 띠)은 패널
   * (bottom:6px · 논리 4줄 ≈ 70px = 6\~76px 전폭 띠)의 마지막 줄을 z6 > z4 로 덮었다.
   * 두 수는 `--lab-panel-*` 에서 **유도**한다 — 여기 숫자를 적으면 그게 다음 사본이다.
   */
  const panelBottom = evalCssLength(vars.get('--lab-panel-bottom'), vars, viewport);
  const panelMinH = evalCssLength(vars.get('--lab-panel-min-h'), vars, viewport);
  assert.ok(panelMinH >= 60, '패널 최소높이 유도가 이상하다: ' + panelMinH + 'px (논리 4줄 ≈ 70px)');
  assert.ok(resetBottom >= panelBottom + panelMinH,
    '리셋 버튼(bottom ' + resetBottom + 'px)이 시험판 패널(bottom ' + panelBottom
    + 'px · 최소 ' + panelMinH + 'px)을 덮는다 — 그 마지막 줄이 hud 줄이다');
  assert.ok(zIndexOf('.scan-reset') > zIndexOf('.lab-debug-panel'),
    '전제가 바뀌었다 — 버튼이 패널 아래면 위 산술의 이유가 사라진다(그때는 이 자를 다시 써라)');

  /*
   * ④ 상단 행과 세로로 안 겹친다. `MIN_STAGE_SIDE` 는 **주석에서 옮겨 적지 않고**
   * `--tl-square-side` 식을 320×640 에 놓고 유도한다 (결함 18).
   */
  const stageSide = minStageSide();
  const topExtent = px(cssBlock('.stage-top-row'), 'top') + miniMax;
  const bottomExtent = resetBottom + px(reset, 'height');
  assert.ok(topExtent + bottomExtent < stageSide,
    '상단 행(' + topExtent + 'px)과 리셋 버튼(' + bottomExtent + 'px)이 가장 짧은 스테이지('
    + stageSide.toFixed(1) + 'px)에서 겹친다');
});

test('ⓖ 중앙 탭 판정 — 순수 함수 진리표 (경계 포함 · 잘못된 입력은 거짓)', () => {
  const side = 300;
  const c = side / 2;
  // 중심·중심 근처는 참.
  assert.equal(stageTapIsCentre(c, c, side), true, '정중앙이 거짓이다');
  assert.equal(stageTapIsCentre(c + 10, c - 10, side), true, '중심 부근이 거짓이다');
  // 경계는 **포함** — 반지름 = frac × side.
  assert.equal(stageTapIsCentre(c + side * STAGE_CENTRE_TAP_FRACTION, c, side), true, '경계가 거짓이다 (≤ 여야 한다)');
  assert.equal(stageTapIsCentre(c + side * STAGE_CENTRE_TAP_FRACTION + 0.5, c, side), false, '경계 밖이 참이다');
  // 네 모서리·네 변 중앙은 전부 거짓 — 조준을 방해하지 않아야 한다.
  for (const [x, y] of [[0, 0], [side, 0], [0, side], [side, side], [c, 0], [c, side], [0, c], [side, c]]) {
    assert.equal(stageTapIsCentre(x, y, side), false, '(' + x + ',' + y + ') 가 중앙으로 읽힌다');
  }
  // 원이지 정사각이 아니다 — 대각선은 반지름을 넘는다.
  const diag = side * STAGE_CENTRE_TAP_FRACTION * 0.75;
  assert.equal(stageTapIsCentre(c + diag, c + diag, side), false, '판정이 원이 아니라 정사각이다');
  // frac 은 바꿀 수 있다 — 크게 주면 같은 점이 참이 된다 (기본값이 유일한 진리가 아님을 잰다).
  assert.equal(stageTapIsCentre(c + diag, c + diag, side, 0.9), true, 'frac 인자가 무시된다');
  // 잘못된 입력 — 모르는 상태에서 리셋을 트리거하지 않는다.
  for (const args of [[NaN, c, side], [c, NaN, side], [c, c, 0], [c, c, -10], [c, c, NaN],
    [c, c, side, 0], [c, c, side, -1], [c, c, side, NaN]]) {
    assert.equal(stageTapIsCentre(...args), false, JSON.stringify(args) + ' 가 참이다');
  }
});

test('ⓗ ⚠ 철자 자 — 미니 HUD 는 **항등 H**(아이소메트릭)로 그린다 · 오버레이만 락 H (운영자 요구 ⑪)', () => {
  const body = renderBody();
  // 미니 기하는 항등 H 로 푼다 — 사영 셋 전부가 R2_HUD_IDENTITY_H 로 한 번씩 불린다.
  for (const fn of ['projectFaceQuadsInto', 'projectGridLinesInto', 'projectOutlineInto']) {
    assert.ok(body.includes(fn + '(R2_HUD_IDENTITY_H, isoN'),
      '미니 기하의 ' + fn + ' 가 항등 H 로 안 풀린다 — 미니가 카메라 자세를 따라간다');
    assert.ok(body.includes(fn + '(view.H, n'),
      '오버레이의 ' + fn + ' 가 락 H 로 안 풀린다 — 전면 HUD 가 실제 자리를 안 그린다(⑨)');
  }
  // 미니 캔버스 변환은 **미니 기하의 bbox** 로만 정해진다 — 락 H 의 bbox 를 쓰면 카메라가 기울 때 미니도 기운다.
  assert.ok(body.includes('finiteBoundsInto(r2HudIso.outline'),
    '미니 bbox 가 아이소메트릭 실루엣에서 안 나온다');
  assert.ok(!/finiteBoundsInto\(r2Hud\.outline/.test(body),
    '미니가 락 H 실루엣의 bbox 를 쓴다 — ⑪ 이전의 배선이 남았다');
  /*
   * 미니가 채우는 경로는 별도 벌이다 (같은 Path2D 를 쓰면 좌표가 락 H 의 것이다).
   * ⚠ **의도적 완화 (3d)** — 옛 자는 `paintR2HudBuckets(mctx, alpha, r2HudMiniPaths)` 를 **철자 그대로**
   *   요구해서, 알파 인자 이름이 바뀌자마자(불신 α 를 태우려 `paintAlpha` 로 승격) 빨개졌다. 이 줄이
   *   지키려는 명제는 «미니는 mctx 에 미니 경로를, 오버레이는 ctx 에 오버레이 경로를 칠한다» 이지
   *   «두 번째 인자의 이름» 이 아니다. 그래서 (컨텍스트, 경로) 짝만 잠근다.
   */
  assert.match(body, /paintR2HudBuckets\(mctx,\s*[A-Za-z0-9_.]+,\s*r2HudMiniPaths\)/,
    '미니가 자기 경로 벌을 안 칠한다 — 미니가 카메라 사영으로 그려진다');
  assert.match(body, /paintR2HudBuckets\(ctx,\s*[A-Za-z0-9_.]+,\s*r2HudPaths\)/,
    '오버레이가 자기 경로 벌을 안 칠한다');
  // 아이소 기하는 n 이 바뀔 때만 푼다 — 매 프레임 풀면 n=25 에서 마름모 1875개가 두 번 사영된다.
  assert.ok(/if \(r2HudIso\.n !== isoN/.test(body),
    '아이소 기하가 n 게이트 없이 매 프레임 다시 풀린다');
  // 락 전에도 실루엣이 있다 — n 을 모르면 단위 육각(1).
  assert.ok(/const isoN = n > 0 \? n : 1/.test(body),
    '락 전 미니 실루엣의 n 폴백이 없다 — SEARCHING 에 빈 상자가 된다');
});

test('ⓘ ⚠ 철자 자 — 디자인 톤(⑧): 톤 팔레트가 HUD_ROLE 에서 유도되고, 렌더가 toneGrid 를 인덱스 규약으로 읽는다', () => {
  const at = JS.indexOf('const R2_HUD_TONE_COLOR = Object.freeze({');
  assert.ok(at > 0, '톤 팔레트가 없다 — 로케이터가 단색이다');
  const table = JS.slice(at, JS.indexOf('});', at));
  for (const name of ['LOCATOR', 'REFERENCE']) {
    assert.ok(table.includes('[HUD_ROLE.' + name + ']:'), '톤 팔레트에 HUD_ROLE.' + name + ' 이 없다');
  }
  assert.ok(!/^\s*\d+\s*:/m.test(table),
    '톤 팔레트에 리터럴 숫자 키가 있다 — HUD_ROLE 값이 바뀌는 날 조용히 어긋난다');
  /*
   * 🔴 **개수가 아니라 순서** (2026-09-06 검토 R3c, 결함 17). 옛 자는 줄당 스와치 3개만 셌다 —
   * 세 색이 전부 같아도, 밝은 것이 먼저 와도 초록이다. 이 표가 약속하는 것은 「코드에 인쇄된
   * 밝기 순서를 보여 준다」이므로 **상대휘도 단조 증가**가 계약이다. 그래서 rgb 를 파싱해 잰다.
   */
  const relLum = (swatch) => {
    const rgb = (swatch.match(/rgb\((\d+)[\s,]+(\d+)[\s,]+(\d+)/) || []).slice(1).map(Number);
    assert.equal(rgb.length, 3, '톤 스와치를 rgb 로 못 읽었다: ' + swatch);
    const lin = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  let toneRows = 0;
  for (const line of table.split('\n')) {
    if (!line.includes('[HUD_ROLE.')) continue;
    toneRows += 1;
    const swatches = line.match(/'[^']+'/g) || [];
    assert.equal(swatches.length, 3, '톤이 3단이 아니다: ' + line.trim());
    const lums = swatches.map((sw) => relLum(sw));
    assert.ok(lums[0] < lums[1] && lums[1] < lums[2],
      '톤 명암이 단조 증가가 아니다 (0 어두움 → 2 밝음이어야 한다): ' + line.trim()
      + ' → ' + lums.map((v) => v.toFixed(3)).join(' < '));
  }
  assert.ok(toneRows >= 2, '톤 표 훑기가 무너졌다 — 행이 ' + toneRows + '개다');

  /*
   * 그리고 «톤을 모르는 면» 의 폴백은 톤 표의 **중간 톤에서 유도**한다 (사본 금지).
   * 손으로 적으면 톤을 바꾸는 날 폴백만 옛 색으로 남는다.
   */
  const roleAt = JS.indexOf('const R2_HUD_ROLE_COLOR = Object.freeze({');
  assert.ok(roleAt > at, '역할색 표가 톤 표보다 앞에 있다 — 유도가 성립하지 않는다');
  const roleTable = JS.slice(roleAt, JS.indexOf('});', roleAt));
  for (const name of ['LOCATOR', 'REFERENCE']) {
    assert.ok(roleTable.includes('R2_HUD_TONE_COLOR[HUD_ROLE.' + name + '][R2_HUD_TONE_MID]'),
      name + ' 의 폴백색이 톤 표에서 유도되지 않는다 — 같은 초록이 두 곳에 산다');
  }
  const body = renderBody();
  // 인덱스 규약은 손으로 다시 적지 않는다 — 순수 모듈의 hudToneSlot 을 부른다 (그 식이 faceQuadSlot/8 과
  // 같다는 것은 r2-hud-model.test 가 라인업 전수로 잰다).
  assert.ok(body.includes('hudToneSlot(n, f, i, j)'),
    '렌더가 toneGrid 인덱스를 직접 계산한다 — 사영 버퍼와 어긋나는 날 아무도 모른다');
  assert.ok(body.includes('HUD_TONE_NONE'),
    '톤 없음(HUD_TONE_NONE)을 안 가른다 — 톤이 없는 면이 «어두움 0» 으로 칠해진다');
});

test('ⓙ ⚠ 철자 자 — 줌 커밋은 락만 무효화(H4)하고, 리셋 버튼과 중앙 탭은 **같은 함수**를 부른다(⑫)', () => {
  const zoomAt = JS.indexOf('async function commitUserZoom()');
  assert.ok(zoomAt > 0, 'commitUserZoom 이 없다');
  const zoom = JS.slice(zoomAt, braceEnd(JS, JS.indexOf('{', zoomAt)) + 1);
  /*
   * 🔴 **크롭이 아니라 «분석 배율»** (2026-09-06 검토 R3c, 결함 15). 옛 자는
   * `effectiveCropZoom() !== cropBefore` 라는 **철자를 못박아** 틀린 축을 굳혔다:
   * `zoomCapability` 가 있는 기기에서 `resolveZoomPlan` 은 `mode:'track'` · `cropApplied:1` 을
   * 돌려주므로 1× → 2× 커밋이 전후 모두 크롭 1 이고, 그 게이트는 **한 번도 안 열렸다**.
   * 아래 세 단언은 순수 식을 **값으로** 재고(브라우저 없이 가능), 마지막 둘만 배선 철자다.
   */
  const capability = { min: 1, max: 8, step: 0.1 };
  const at1x = resolveZoomPlan({ userZoom: 1, capability, trackApplied: 1 });
  const at2x = resolveZoomPlan({ userZoom: 2, capability, trackApplied: 2 });
  assert.equal(at2x.mode, 'track', '전제: capability 가 있으면 track 모드다 (라인업이 바뀌었으면 이 자를 다시 봐라)');
  assert.equal(at1x.cropApplied, at2x.cropApplied,
    '전제: track 모드에서 크롭은 안 바뀐다 — 이것이 옛 게이트가 못 보던 바로 그 축이다');
  assert.notEqual(analysisScaleOf(at2x, 1), analysisScaleOf(at1x, 1),
    'track 줌 1×→2× 가 분석 배율로 안 보인다 — 실기 대다수 기기에서 락 무효화가 안 돈다');
  const cropFallback = resolveZoomPlan({ userZoom: 2, capability, trackApplied: 1, applyError: 'rejected' });
  assert.notEqual(analysisScaleOf(cropFallback, 1), analysisScaleOf(at1x, 1),
    '크롭 폴백 줌이 분석 배율로 안 보인다 — 한 축만 재는 자가 됐다');
  assert.notEqual(analysisScaleOf(at1x, 1.5), analysisScaleOf(at1x, 1),
    '자동 크롭 사다리가 분석 배율에 안 실린다');
  assert.equal(analysisScaleOf(null, undefined), 1, '모르는 입력이 1 이 아니다 — 모르는 값으로 락을 흔든다');

  assert.ok(/r2Runtime\.enabled && currentAnalysisScale\(\) !== scaleBefore/.test(zoom),
    '줌 커밋이 «분석 배율이 실제로 바뀌었을 때 · R2 켜짐» 을 안 가린다 — R1 위치가 흔들리거나 매 커밋마다 락이 풀린다');
  assert.ok(/function currentAnalysisScale\(\)[\s\S]{0,400}?analysisScaleOf\(zoomPlan, autoCropZoomFor\(autoCropIndex\)\)/.test(JS),
    '스캐너가 순수 식(analysisScaleOf)을 안 쓴다 — 배율 계산이 또 두 곳에 산다');
  assert.ok(zoom.includes('r2Runtime.invalidateLock()'),
    '줌 커밋이 락을 무효화하지 않는다 — 옛 크롭 좌표의 H 로 계속 그린다(실기 3차 ①)');
  assert.ok(!zoom.includes('r2Runtime.reset()'),
    '줌 커밋이 세션까지 버린다 — 배율만 바꿨는데 모은 증거가 사라진다');

  const resetAt = JS.indexOf('function manualRescan()');
  assert.ok(resetAt > 0, 'manualRescan 이 없다');
  const reset = JS.slice(resetAt, braceEnd(JS, JS.indexOf('{', resetAt)) + 1);
  // 「처음부터」 는 반쯤이 아니다 — R2 세션·QR 브리지·힌트·래치와 R1 시도 단위 상태를 같이 버린다.
  for (const needle of ['r2Runtime.reset()', 'qrBridge.reset()', 'runtimeFamilyHint = null', 'r2Latched = null',
    'lastFramePose = null', 'resetFailureTiming()', 'autoCropIndex = 0', 'steady.reset()',
    'hideR2Hud()', 'renderR2CellMap()']) {
    assert.ok(reset.includes(needle), 'manualRescan 이 ' + needle + ' 를 안 한다 — 리셋이 반쯤이다');
  }
  // 두 입구가 같은 함수를 부른다 — 갈리면 「버튼은 되는데 탭은 반쯤」 이 된다.
  assert.equal((JS.match(/manualRescan\(\)/g) || []).length, 3,
    '수동 리셋의 입구·정의 수가 셋(정의 1 + 버튼 1 + 탭 1)이 아니다 — 입구마다 다른 동작이 생겼다');
  assert.ok(JS.includes('stageTapIsCentre(x, y, stageSide)'),
    '중앙 탭이 순수 판정을 안 쓴다 — 기하가 브라우저 안에 갇힌다');
  assert.ok(/closest\('#stage-top-row, #scan-reset'\)/.test(JS),
    '중앙 탭이 상단 행·버튼 위를 안 가린다 — 스위치를 누르면 스캔이 리셋된다');
  // 표시는 카메라 수명에 묶이고, `r2Available` 이 거짓인 화면(승격 되돌림)에서는 열리지 않는다.
  assert.ok(/scanResetButton\.hidden = !\(active && r2Available\)/.test(JS),
    '리셋 버튼 표시가 «카메라 켜짐 ∧ r2Available» 이 아니다 — 게이트 없이 뜨거나 카메라 없이 뜬다');
});

test('ⓚ 시험판 hud 줄 — 순수 빌더의 **출력**을 값으로 잰다 (있을 때만 · 길이 예산 · 카운터 유도)', () => {
  /*
   * 🔴 옛 자는 `scanner.js` 안의 조립 코드를 **철자로** 읽었고, 길이는 `\n` 개수(논리 줄)만 쟀다.
   * 그래서 «한 줄 188자» 가 초록이었다 — 287px 스테이지에서 시각 4\~5줄이다(결함 16).
   * 이제 줄은 순수 빌더가 만들고 여기서는 **그 문자열**을 잰다.
   */
  const runtime = createR2ScanRuntime({ enabled: true });
  const stats = runtime.stats;

  // ① «있을 때만» — 위상이 없으면 빈 문자열이다 (4줄 핀이 이것에 기댄다).
  assert.equal(r2HudDebugLine({ phase: '', lastMs: 1, maxMs: 2, n: 0, layoutId: '' }, stats), '',
    'hud 줄이 «있을 때만» 규약을 깼다 — 패널 줄 수가 위상과 무관하게 는다');
  assert.equal(r2HudDebugLine(null, stats), '', 'hud 상태가 없는데 줄이 나온다');

  // ② 있으면 단계별 ms · 락 F · 포맷이 **값으로** 실린다.
  stats.phaseMs.detect = 123.4;
  stats.phaseMs.align = 2.3;
  stats.phaseMs.decode = 45.6;
  stats.lockF = 538;
  stats.format.source = 'locator';
  stats.format.eccName = 'H';
  stats.format.maskIndex = 2;
  stats.format.candidateCount = 1;
  const hud = { phase: 'data', lastMs: 12.3, maxMs: 45.6, n: 21, layoutId: 'v0TR' };
  const line = r2HudDebugLine(hud, stats);
  for (const needle of ['data', '123.4', '2.3', '45.6', '538', 'H/2']) {
    assert.ok(line.includes(needle), 'hud 줄에 ' + needle + ' 가 없다: ' + line);
  }
  // 포맷 출처는 «코드가 말했나» 가 관심사다 — default 면 표시가 달라야 한다.
  stats.format.source = 'default';
  assert.notEqual(r2HudDebugLine(hud, stats), line,
    '포맷 출처(locator/default)가 줄에서 안 갈린다 — 「코드가 말한 값」과 「기본값」이 같아 보인다');
  stats.format.source = 'locator';

  // ③ 카운터는 **손 목록이 아니다** — 런타임이 세는 것을 훑고, 0 은 안 적는다.
  for (const name of Object.keys(stats.counters)) stats.counters[name] = 0;
  const quiet = r2HudDebugLine(hud, stats);
  stats.counters.hardDrops = 7;
  const noisy = r2HudDebugLine(hud, stats);
  assert.notEqual(noisy, quiet, '카운터가 0 에서 7 로 갔는데 줄이 그대로다');
  assert.ok(noisy.includes(counterAbbrev('hardDrops') + '7'),
    '카운터가 유도한 약어로 안 실린다: ' + noisy);
  assert.ok(!quiet.includes(counterAbbrev('coastFrames') + '0'),
    '0 인 카운터를 적는다 — 줄 예산의 절반이 0 으로 찬다');
  // 약어는 서로 안 섞인다 (충돌하면 전체 이름으로 돌아가야 한다).
  const abbrevs = Object.keys(stats.counters).map(counterAbbrev);
  assert.equal(new Set(abbrevs).size, abbrevs.length,
    '카운터 약어가 충돌한다: ' + abbrevs.join(' ') + ' — 충돌 폴백이 안 듣는다');

  /*
   * ④ 🔴 **길이 예산.** 최악(카운터 전부 0 아님 · 위상 이름 최장 · n25 · 5글자 레이아웃 ·
   * 합성 프레임의 거대 F)을 런타임의 **진짜 카운터 집합**으로 만든다 — 카운터가 하나 늘면 빨개진다.
   */
  for (const name of Object.keys(stats.counters)) stats.counters[name] = 11;
  stats.lockF = 8.696711537253465e+30;
  /*
   * 3d — 최악에는 **불신 마진**도 실린다 (`!M1.4`). 이 줄은 «있을 때만» 이라 기본값(false)으로 재면
   * 예산이 5자 헐거워진다 — 그러면 이 자는 실제 최악을 안 재는 것이다.
   */
  stats.lockDistrusted = true;
  stats.lockMargin = 1.36;
  /*
   * 3b — 최악에는 **RS 정정 수**도 실린다 (` c=999`, 6자). 이 필드도 «있을 때만» 이라 기본값으로
   * 재면 예산이 6자 헐거워진다 — 3d 가 불신 마진에서 겪은 그 함정이다 (3b 검토 F9).
   * ⚠ 위상은 최장 이름(`finalizing`)으로 둔다: 정정 수는 래치에서 오고 위상은 **마지막 렌더**의
   * 것이라 둘이 어긋날 수 있다 — 「done 이 6자 짧아 우연히 상쇄된다」에 예산을 걸지 않는다.
   */
  const worstHud = { phase: 'finalizing', lastMs: 12.3, maxMs: 456.7, n: 25, layoutId: 'v0TRQ', corrected: 999 };
  const worst = r2HudDebugLine(worstHud, stats);
  assert.ok(worst.includes('!M'), '최악에 불신 마진이 안 실렸다 — 예산을 실제 최악으로 재고 있지 않다');
  assert.ok(worst.includes('c=999'), '최악에 RS 정정 수가 안 실렸다 — 예산이 6자만큼 거짓이다');
  // «있을 때만» — 0 은 안 적는다. 이 규약이 깨지면 위 최악이 **상시** 최악이 된다.
  assert.ok(!r2HudDebugLine({ ...worstHud, corrected: 0 }, stats).includes('c='),
    '정정 0 을 줄에 적는다 — «있을 때만» 규약이 깨졌다');
  assert.ok(worst.length <= R2_HUD_DEBUG_LINE_BUDGET,
    'hud 줄 최악이 ' + worst.length + '자다 (예산 ' + R2_HUD_DEBUG_LINE_BUDGET + ') — '
    + '287px 스테이지에서 ≈45자/시각 줄이라 패널이 스테이지를 먹는다:\n      ' + worst);
  // 공허 방지 — 예산이 너무 헐거우면 이 자가 아무것도 안 잰다.
  assert.ok(R2_HUD_DEBUG_LINE_BUDGET <= 135,
    '예산이 시각 3줄(≈135자)을 넘는다 — 그러면 이 자는 옛 188자도 통과시킨다');
});

/*
 * ── 3d «격자 불신» 의 그림 ────────────────────────────────────────────────────
 * ⚠ **철자 자** — 캔버스·Path2D·getBoundingClientRect 가 여기 없으니 그림 자체는 못 본다.
 * 잠그는 것은 「불신 신호가 그림까지 **도달할 수 있는 배선인가**」다: 판정이 순수 모듈에서
 * 오는가 · 색이 셀맵 색표에서 유도되는가 · 두 표면(오버레이·미니)이 같은 수를 쓰는가 ·
 * 좌 패널 상태 단어가 원본 상수에서 오는가. 다음 리팩터링까지만 산다.
 */
test('ⓛ ⚠ 철자 자 — 불신 판정은 순수 모델에서 오고, 색은 셀맵 «정정» 에서 유도되며, 두 표면이 같은 α 를 쓴다', () => {
  const body = renderBody();

  // ① 판정은 여기서 다시 쓰지 않는다 — hudPhase 와 **같은 입력**으로 순수 모듈이 낸다.
  assert.ok(body.includes('hudDistrusted('),
    '렌더러가 불신 판정을 순수 모듈에 안 묻는다 — 위상과 불신이 다른 프레임 상태를 볼 수 있다');
  assert.ok(/const hudInput = \{[\s\S]{0,400}?distrusted: stats\.lockDistrusted/.test(body),
    '불신이 위상과 같은 입력 객체에서 안 온다');
  assert.ok(!/stats\.lockMargin\s*[<>]/.test(JS),
    '스캐너가 마진 하한을 스스로 비교한다 — 문턱이 params 와 렌더 두 곳에 살면 어느 쪽도 유도가 아니다');

  // ② 색은 셀맵 «정정»(ERASURE) 에서 **유도**한다 — 분홍 rgba 를 다시 적으면 셀맵과 갈라진다.
  assert.match(JS, /const R2_HUD_DISTRUST_STROKE = R2_CELL_COLOR\[CELL_MAP_STATE\.ERASURE\]/,
    '불신 색이 셀맵 색표에서 안 온다 (사본 색)');

  // ③ 두 표면이 같은 α 를 쓴다 — 한쪽만 눕히면 같은 상태의 두 그림이 다른 말을 한다.
  assert.match(body, /const paintAlpha = distrusted \? alpha \* R2_HUD_DISTRUST_ALPHA : alpha/,
    '불신 α 를 두 표면이 공유하는 자리가 없다');
  assert.match(body, /paintR2HudBuckets\(ctx, paintAlpha, r2HudPaths\)/, '오버레이가 불신 α 를 안 쓴다');
  assert.match(body, /paintR2HudBuckets\(mctx, paintAlpha, r2HudMiniPaths\)/, '미니가 불신 α 를 안 쓴다');

  // ④ 선은 점선으로 갈린다 — 그리고 그 붓은 한 함수다 (색·점선을 두 곳에서 각자 세우면 어긋난다).
  assert.ok(/function setR2HudStroke\(ctx, distrusted, baseColor, unitPx\)/.test(JS),
    '선 붓이 한 함수가 아니다');
  assert.ok(/setLineDash\(r2HudDashScratch\)/.test(JS),
    '점선 배열을 매 프레임 새로 만든다 — 핫 경로 할당 금지');
  const strokeCalls = body.match(/setR2HudStroke\(/g) || [];
  assert.ok(strokeCalls.length >= 4,
    '격자·실루엣 × 두 표면(4자리) 중 일부가 옛 strokeStyle 대입으로 남았다 (' + strokeCalls.length + '자리)');
  assert.ok(!/ctx\.strokeStyle = R2_HUD_(GRID|OUTLINE)_STROKE/.test(body),
    '오버레이가 붓 함수를 안 거치고 색을 직접 세운다 — 그 선은 불신에도 실선이다');
  assert.ok(!/mctx\.strokeStyle = R2_HUD_(GRID|OUTLINE)_STROKE/.test(body),
    '미니가 붓 함수를 안 거치고 색을 직접 세운다');

  // ⑤ 점선은 컨텍스트에 남는다 — 되돌리지 않으면 다음 프레임의 실선이 점선으로 그려진다.
  assert.ok((body.match(/setLineDash\(R2_HUD_SOLID_DASH\)/g) || []).length >= 2,
    '점선을 되돌리는 자리가 두 캔버스에 다 있지 않다');

  // ⑥ 미니 상자는 CSS 로도 갈린다 (140px 상자에서 캔버스 안 점선만으론 안 보인다).
  assert.match(body, /r2HudMini\.dataset\.distrust/, '미니 상자에 불신 상태를 안 내린다');
  const css = cssBlock('.r2-hud-mini[data-distrust="1"]');
  assert.ok(/var\(--r2-fix\)/.test(css),
    '불신 테두리 색이 --r2-fix 에서 안 온다 — 셀맵 색을 바꾸는 날 이 테두리만 옛 색으로 남는다');
  /*
   * 🔴 **글로우도 사본이면 안 된다** (2026-09-06 검토 3d, 결함 6). 3c 는 테두리만 변수로 두고
   * 바깥 번짐과 `var()` 폴백에 `rgb(255 90 170 / …)` 를 옮겨 적었다 — 같은 블록 주석이 스스로
   * 금지한 그 사본이다. 규칙 안에 **색 리터럴이 하나도 없다**를 재고(사본이 어느 자리로 돌아와도
   * 빨개진다), 유도 자체는 아래에서 값으로 잰다.
   */
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css),
    '불신 테두리 규칙에 색 리터럴 사본이 있다: ' + css);
  assert.ok(/var\(--r2-fix-glow\)/.test(css),
    '글로우가 --r2-fix-glow 에서 안 온다');
  /*
   * ⑥′ **값** — 유도자는 «같은 rgb, 알파만 배율» 이다. 이것이 성질이고, 리터럴 알파 0.18 은
   * 그 배율의 **결과**다. 셀맵 소거색을 바꾸면 글로우 색상이 같이 움직인다는 뜻이다.
   */
  assert.equal(scaleColorAlpha('rgba(255,90,170,0.85)', 0.18 / 0.85), 'rgba(255,90,170,0.18)',
    '알파 배율이 rgb 를 안 보존하거나 세기를 안 맞춘다');
  assert.equal(scaleColorAlpha('rgba(1,2,3,0.5)', 0), 'rgba(1,2,3,0)', '배율 0 이 색을 안 지운다');
  assert.equal(scaleColorAlpha('rgba(1,2,3,0.5)', 4), 'rgba(1,2,3,1)', '알파가 1 을 넘는다');
  assert.equal(scaleColorAlpha('#ff5aaa', 0.2), '#ff5aaa',
    '파싱 못 하는 형식에서 색을 잃는다 — 세기를 잃는 편이 낫다');
  // 움직임이 아니라 색만 바뀐다 (A6 플래시 금지 · reduced-motion 과 무관해야 한다).
  assert.ok(!/animation/.test(css), '불신 표시가 애니메이션이다 — A6 플래시 금지');
});

test('ⓜ ⚠ 철자 자 — 좌 패널 progress 행의 «격자 재확인» 이 원본 상수에서 오고 불신일 때만 붙는다', () => {
  const at = JS.indexOf('function renderR2Progress()');
  assert.ok(at > 0, 'renderR2Progress 를 못 찾았다');
  const fn = JS.slice(at, JS.indexOf('function renderResultR2Summary('));
  assert.match(fn, /if \(stats\.lockDistrusted\)/, '좌 패널이 불신 상태 단어를 안 붙인다');
  assert.match(fn, /row\.stateKey = HUD_DISTRUST_STATE_KEY/,
    '상태 단어를 문자열로 다시 적는다 — 원본 상수와 어긋나는 날 빈 라벨이 된다');
  /*
   * progress **행에만** 붙는다. 다른 행(type·version·layout)은 「무엇을 읽고 있나」이고 불신은
   * 「그 격자를 믿나」라, 다른 행에 붙이면 「타입이 잘못됐다」로 읽힌다.
   */
  assert.match(fn, /row\.key === 'progress' && row\.stateKey/,
    '불신 단어가 progress 행 밖에도 붙는다');
});

/*
 * ── 3b «RS 정정 강조» 의 그림 ─────────────────────────────────────────────────
 * ⚠ **철자 자** — 3d ⓛ 와 같은 층·같은 한계다. 3b 검토 F7 이 잡은 구멍이 이것이었다:
 * `paintR2Correction` 호출 두 줄을 통째로 지워도 R2 자 전부가 초록이었다(82/82). 즉
 * «정정 위치 → 셀» 까지만 자가 있었고 **그리는 표면**엔 자가 하나도 없었다.
 * 여기서 잠그는 명제: 붓 색이 팔레트에서 유도되고 · 두 표면이 같은 함수·같은 α 를 쓰고 ·
 * 래치가 «그릴 게 있을 때만» 서고 · 래치를 비우는 자리마다 정정 래치도 같이 비고 ·
 * 정정 프레임에서 채움 게이트가 열린다(F6).
 */
test('ⓞ ⚠ 철자 자 — 정정 강조의 붓·α·두 표면·비우기가 전부 유도에서 온다 (3b)', () => {
  const body = renderBody();

  // ① 붓 색은 팔레트의 «rsfix» 항목에서 온다 — rgba 를 다시 적으면 좌 패널 칩(--r2-rsfix)과 갈라진다.
  assert.match(JS, /const R2_HUD_CORRECTION_COLOR = R2_CELL_COLOR\[HUD_RSFIX_STATE_KEY\]/,
    '정정 붓 색이 셀맵 색표에서 안 온다 (사본 색)');
  assert.match(JS, /setProperty\('--r2-rsfix', R2_CELL_COLOR\[HUD_RSFIX_STATE_KEY\]\)/,
    'CSS 변수 --r2-rsfix 가 같은 정본에서 안 심긴다 — 캔버스와 칩이 다른 색이 된다');

  // ② 그 붓 함수 안에 색 리터럴이 없다 (사본이 어느 자리로 돌아와도 빨개진다).
  const at = JS.indexOf('function paintR2Correction(');
  assert.ok(at > 0, 'paintR2Correction 이 없다 — 정정 강조를 그리는 함수가 사라졌다');
  const brush = JS.slice(at, braceEnd(JS, JS.indexOf('{', at)) + 1);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(brush),
    '정정 붓에 색 리터럴 사본이 있다: ' + brush);
  for (const prop of ['fillStyle', 'strokeStyle']) {
    assert.match(brush, new RegExp('ctx\.' + prop + ' = R2_HUD_CORRECTION_COLOR'),
      '정정 붓의 ' + prop + ' 이 정본 상수에서 안 온다');
  }

  // ③ α 는 순수 함수가 낸다 — 시계는 렌더러가 주입한다 (자가 시간을 넣어 값으로 잴 수 있게).
  assert.match(body, /const corrAlpha = r2Correction === null \? 0 : hudCorrectionAlpha\(nowMs\(\), r2Correction\.at\)/,
    '정정 α 가 순수 함수·주입 시계에서 안 온다');

  /*
   * ④ **두 표면이 같은 함수·같은 α 를 쓴다.** 이것이 F7 의 돌연변이가 지나간 자리다 —
   *    한쪽만 지워도(또는 α 를 따로 세워도) 「같은 상태의 두 그림」이 다른 말을 한다.
   */
  const calls = [...body.matchAll(/paintR2Correction\((\w+), (\w+), (\w+),/g)];
  assert.equal(calls.length, 2,
    '정정 강조를 그리는 자리가 둘(오버레이·미니)이 아니다 — ' + calls.length + '자리');
  assert.deepEqual(calls.map((m) => m[1]), ['ctx', 'mctx'], '오버레이·미니 두 컨텍스트가 아니다');
  assert.deepEqual(calls.map((m) => m[3]), ['corrAlpha', 'corrAlpha'], '두 표면이 다른 α 를 쓴다');
  assert.equal(new Set(calls.map((m) => m[2])).size, 2, '두 표면이 같은 경로 객체를 그린다 (사영이 하나뿐)');
  assert.match(body, /if \(corrOverlay\) paintR2Correction\(ctx,/, '오버레이 게이트가 corrOverlay 가 아니다');
  assert.match(body, /if \(corrMini\) paintR2Correction\(mctx,/, '미니 게이트가 corrMini 가 아니다');

  // ⑤ 래치는 «그릴 게 있을 때만» 선다 — 정정 0 이면 아무것도 안 그린다 (잠긴 설계 7).
  assert.match(JS, /r2Correction = \(r2Latched\.correctedCount > 0 && hit\.correctedCells && hit\.correctedCells\.length > 0\)/,
    '정정 래치가 «수 > 0 ∧ 셀 > 0» 을 안 본다 — 빈 강조가 선다');

  /*
   * ⑥ **비우는 자리는 손 목록이 아니다** (3b 검토 F11): DONE 래치를 비우는 **모든** 자리에서
   *    정정 래치도 같이 빈다. 목록을 여기 적지 않고 `r2Latched = null` 을 훑어 유도한다 —
   *    새 리셋 경로가 생기면 그 자리도 자동으로 이 규칙 아래 들어온다.
   */
  // 선언(`let r2Latched = null;`)은 «비우는 자리» 가 아니다 — 대입만 훑는다.
  const latchClears = [...JS.matchAll(/(?<!let )r2Latched = null;/g)];
  assert.ok(latchClears.length >= 4,
    'DONE 래치를 비우는 자리가 ' + latchClears.length + '곳뿐이다 — 훑기가 깨졌다');
  for (const m of latchClears) {
    const near = JS.slice(m.index, m.index + 600);
    assert.ok(near.includes('r2Correction = null;'),
      'r2Latched 를 비우면서 정정 강조를 안 비우는 자리가 있다 (offset ' + m.index + '): '
      + JS.slice(Math.max(0, m.index - 120), m.index + 120));
  }

  /*
   * ⑦ **정정 프레임에는 채움·격자도 열린다** (3b 검토 F6). 안 열면 위상이 DONE 이라 모든 채움
   *    게이트가 닫혀, 강조가 «맥락 없는 흰 마름모» 로만 뜬다 — 「어느 셀이 틀렸나」는 주변 셀과
   *    격자가 있어야 읽힌다.
   */
  assert.match(body, /const wantFills = overlayGeom && \(overlayOn \|\| corrFresh\)/,
    '오버레이 채움이 정정 프레임에서 안 열린다 — 강조가 맥락 없이 뜬다');
  assert.match(body, /const miniFills = [^;]*\|\| corrFresh\)/,
    '미니 채움이 정정 프레임에서 안 열린다');
  /*
   * ⚠ **의도적 갱신 (2026-09-06 승격 · ⑯(i))** — 옛 자는 `r2HudCanvas.hidden = !(overlayOn || corrFresh)`
   * 라는 **철자**를 요구했다. 결정 (i) 가 여는 표면이 정확히 이 한 프레임이라, 재는 축이 철자면
   * 「그 표면이 살아 있는가」를 아무도 모른다 (memory: 철자를 재는 자는 썩는다). 판정은 순수 함수로
   * 옮겼고 여기서는 **값**으로 잰다 — 정답을 다르게 써도 통과해야 한다.
   */
  const live = { hasStream: true, runtimeEnabled: true, hasView: true };
  // DONE 위상은 원래 오버레이가 닫히는 자리다 — 정정 강조 하나가 그것을 연다. 그게 이 표면의 전부다.
  assert.equal(hudSurfaceVisibility({ ...live, phase: HUD_PHASE.DONE, corrFresh: false }).overlayHidden, true,
    '정정 없는 DONE 에서 오버레이가 열린다 — 결과 시트 아래에 빈 그림이 남는다');
  assert.equal(hudSurfaceVisibility({ ...live, phase: HUD_PHASE.DONE, corrFresh: true }).overlayHidden, false,
    '정정 강조가 살아 있는 DONE 프레임에 오버레이가 안 열린다 — ⑯(i) 가 산 600 ms 가 빈 화면이 된다');
  // 그릴 H 가 없는 두 위상은 정정이 없으면 닫힌 채다.
  for (const phase of [HUD_PHASE.SEARCHING, HUD_PHASE.DROPPED]) {
    assert.equal(hudSurfaceVisibility({ ...live, phase, corrFresh: false }).overlayHidden, true, phase + ' 에서 오버레이가 열린다');
  }
  // 그리고 배선 — 렌더러가 그 판정을 **직접** 다시 쓰지 않고 순수 함수에서 읽는다.
  assert.ok(body.includes('hudSurfaceVisibility('),
    '렌더러가 표시 판정을 손으로 다시 적는다 — 규칙이 두 곳에 산다');
  assert.ok(body.includes('r2HudCanvas.hidden = surfaces.overlayHidden'),
    '오버레이 캔버스 표시가 순수 판정의 출력이 아니다');
  assert.ok(!/r2HudCanvas\.hidden\s*=\s*!?\(?(overlayOn|true|false)/.test(body),
    '오버레이 표시를 위상·리터럴에서 직접 복사한다 — 정정 프레임이 다시 닫힌다');

  /*
   * ⑧ **경로 객체는 그릴 게 있을 때만 만든다** (3b 검토 F16). 위 채움 경로가 세운 규율과 같다 —
   *    정정 없는 프레임(거의 전부)에서 Path2D 두 개를 헛만들면 그것이 매 프레임 할당이다.
   */
  const pathMake = body.indexOf('corrPath = new Path2D()');
  assert.ok(pathMake > 0, '정정 경로를 만드는 자리가 없다');
  assert.ok(body.slice(0, pathMake).lastIndexOf('if (corrGridOk) {') > body.slice(0, pathMake).lastIndexOf('}'),
    '정정 Path2D 를 corrGridOk 게이트 **밖**에서 만든다 — 정정 없는 프레임마다 두 개씩 헛만든다');
});

/*
 * 3b — 좌·결과 카드의 «RS 정정 k» 접미. 칩 렌더러는 브라우저 밖에서 못 돌지만, 접미가 **모델의
 * 값**(row.correctedCount)에서 오는지와 낱말·키가 상수에서 오는지는 여기서 잠글 수 있다.
 * F7 의 돌연변이 ②(접미 조건 무력화)가 지나간 자리다.
 */
test('ⓟ ⚠ 철자 자 — 결과 카드 칩의 «RS 정정 k» 가 모델 값에서 오고 게이트가 실재한다 (3b)', () => {
  const at = JS.indexOf('function renderConfirmationChips(');
  assert.ok(at > 0, 'renderConfirmationChips 가 없다');
  const chips = JS.slice(at, braceEnd(JS, JS.indexOf('{', at)) + 1);
  // 접미의 원천은 **모델의 행 값**이다 — 렌더가 스스로 세면 두 표면이 다른 수를 말한다.
  assert.match(chips, /row\.correctedCount/, '칩 접미가 모델의 correctedCount 를 안 읽는다');
  // 게이트는 «> 0 일 때만» 이다 (잠긴 설계 7 — 정정 0 이면 접미가 없다).
  assert.match(chips, /rsfix > 0/, '칩 접미가 «있을 때만» 게이트를 안 지난다');
  assert.match(chips, /if \(rsfix > 0\) text \+= /, '접미를 붙이는 자리가 게이트 뒤에 없다');
  // 낱말·키는 상수에서 — 사전 키를 다시 적으면 상수를 바꾸는 날 빈 라벨이 된다 (r2-corrections ⓕ 와 짝).
  assert.match(chips, /fillCount\(t\('r2\.state\.' \+ HUD_RSFIX_STATE_KEY\), rsfix\)/,
    '칩 접미가 사전 문구·개수 자리를 원본 상수에서 안 만든다');
  // CSS 도 그 게이트를 읽는다 — dataset 이 안 서면 색이 영영 안 바뀐다.
  assert.match(chips, /chip\.dataset\.rsfix/, '칩에 rsfix 상태를 안 내린다');
  const css = cssBlock('.r2-chip[data-state="confirmed"][data-rsfix="1"]');
  assert.ok(/var\(--r2-rsfix\)/.test(css), '칩 색이 --r2-rsfix 에서 안 온다');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), '칩 색 규칙에 리터럴 사본이 있다: ' + css);
});
