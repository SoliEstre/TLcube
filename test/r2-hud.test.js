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
 *   ⓔ ⚠ **철자 자** — 색표 유도: 역할색 키가 HUD_ROLE 에서 온다(리터럴 숫자 키 0건). 이름 목록은 손으로
 *      적지 않고 HUD_ROLE 에서 유도하지만, 표를 «소스 문자열로» 확인하는 부분이 있어 철자 자로 표기한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { HUD_BUCKETS, HUD_PHASE, HUD_ROLE, bucketKey } from '../src/r2-hud-model.js';
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
  assert.match(stage, authoredHiddenRe('r2-hud'), '전면 HUD 가 authored hidden 이 아니다 — 정식(/) 렌더가 바뀐다');
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

test('ⓓ ⚠ 철자 자 — 렌더러가 순수 모듈을 부르고, 재사영을 락 세대로 게이트하고, 좌 패널과 같은 선두를 쓴다', () => {
  const body = renderBody();
  for (const needle of ['hudPhase(', 'countObserved(', 'buildRoleGrids(', 'bucketKey(',
    'projectFaceQuadsInto(', 'projectGridLinesInto(', 'projectOutlineInto(', 'faceQuadSlot(', 'finiteBoundsInto(']) {
    assert.ok(body.includes(needle), 'renderR2CellMap 이 ' + needle + ' 를 안 부른다 — 그 규칙을 손으로 다시 적었다는 뜻이다');
  }
  // 재사영은 «락 세대가 바뀔 때만». 매 프레임 다시 풀면 n=25 에서 마름모 1875개를 헛사영한다.
  assert.ok(body.includes('lockRevision !== '),
    '재사영이 락 세대(lockRevision)로 게이트되지 않는다 — 매 프레임 전체를 다시 사영한다');
  // 선두는 좌 패널과 **같은 값**이어야 한다 (⑧) — 따로 고르면 역할색과 칩이 다른 레이아웃을 말한다.
  assert.ok(body.includes('r2LeadingId'),
    'HUD 가 좌 패널의 히스테리시스 선두(r2LeadingId)를 안 쓴다 — 두 표면이 다른 레이아웃을 말한다');
  // 그 «같은 값» 에 fallback 을 붙이면 안 된다 — 좌 패널이 NONE(선두 '')인 프레임에 HUD 만 옛 선두로 칠한다.
  assert.ok(!/r2LeadingId\s*\|\|/.test(body),
    'HUD 가 선두에 fallback 을 붙였다 — 히스테리시스를 우회해 좌 패널과 다른 레이아웃을 말한다');
  /*
   * 화면 변환의 분모는 **락 프레임 폭**(r2Hud.frameW)이다. view.frameWidth 는 매 프레임 현재 luma 폭으로
   * 덧써지는데(r2-scan-runtime.test ⓣ 가 값으로 잰다) H·사영 버퍼는 락 프레임 좌표계에 고정이라, 해상도
   * 승격 프레임(960↔1440)에서 그림이 2/3 크기로 좌상단에 붙는다.
   */
  assert.ok(/backing \/ r2Hud\.frameW/.test(body) && /backing \/ r2Hud\.frameH/.test(body),
    'HUD 변환이 락 프레임 폭(r2Hud.frameW/H)을 안 쓴다');
  assert.ok(!/backing \/ view\.frame/.test(body),
    'HUD 변환이 «현재 프레임» 폭(view.frameWidth/Height)을 쓴다 — 해상도 승격 프레임에서 그림이 어긋난다');
  // 그 락 폭은 **재사영과 같은 자리에서만** 심긴다 — 매 프레임 대입하면 위 자가 초록인 채로 같은 결함이 산다.
  const lockWidthAt = body.indexOf('r2Hud.frameW = view.frameWidth');
  assert.ok(lockWidthAt > body.indexOf('projectOutlineInto(') && lockWidthAt < body.indexOf('const leadingId'),
    '락 폭이 재사영 블록(사영 셋 ~ 선두 판정) 밖에서 심긴다 — 매 프레임 갱신이면 락 폭이 아니다');
  assert.equal((body.match(/r2Hud\.frameW = view\.frameWidth/g) || []).length, 1,
    '락 폭 대입이 두 곳이다 — 하나는 매 프레임 덧쓰기다');
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
