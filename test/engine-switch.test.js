/**
 * engine-switch.test.js — 엔진 스위치(제품 컴포넌트)와 «R2 가용» 게이트의 계약 (PM/029B §27.4 1단계).
 *
 *   ⓐ 진리표 — engineSwitchAvailable 은 시험판 ∨ 승격. 승격 전 핀(false)은 승격 커밋에서 빨개져 사람이 본다.
 *   ⓑ 저장 선택 — 새 키 우선, 옛 키 1회 이관, 둘 다 없으면 켬.
 *   ⓒ 마크업 — 상단 행이 카메라 스테이지 안에 있고 [좌 진행 | 스위치 | 우 셀맵] 순서, 스위치는 authored hidden ·
 *      role=switch · aria-checked. 옛 lab-r2-toggle 은 0건. 8언어 키는 scanner-i18n 자가 자동으로 잰다.
 *   ⓓ 소비자 스윕 — scanner.js 에서 R2/QR 관련 줄이 isLabPath() 를 따로 보지 않는다(r2Available 하나).
 *   ⓔ 핸들러(⚠ 철자 자) — 켜든 끄든 런타임·브리지·힌트·패널·문구를 함께 움직이고 새 키에 저장한다.
 *   ⓕ R1 off 모드(⚠ 철자 자, 2b · 운영자 결정 ②) — R1 게이트가 `if (!r2Runtime.enabled) {` 안, R2 블록이 가이드 점·fps 를 맡는다.
 *   ⓖ 칩 색 유도(2b) — --r2-fixed/--r2-live/--r2-fix 가 R2_CELL_COLOR[CELL_MAP_STATE.X] 에서 심기고 CSS 는 변수만 본다.
 *      ⓒ 의 그리드 단언도 2b 에서 «좌·우 트랙 동일(정중앙) + 우 칸 위젯 자기 상한» 으로 바뀌었다
 *      (3a: 그 상한을 재는 자리가 .r2-cellmap → .r2-hud-mini 로 옮겨갔다 — HUD 는 test/r2-hud.test.js 가 맡는다).
 *      + setProperty 3줄이 r2Available 게이트 **안** (적대 검토 F4 — 정식 DOM 불변은 <html> 인라인 스타일까지다).
 *   ⓗ 칩 넘침(적대 검토 F7·F9) — 칩은 열 폭을 못 넘고 넘치면 말줄임, progress 칩은 줄바꿈 허용. 결과 카드에 확정 요약 컨테이너(F8).
 *   ⓘ 늦은 결과 문(적대 검토 F2) — R1 .then/.catch 가 QR 콜백과 같은 «세션·스위치 재확인» 을 lateResultAdmitted 로 한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ENGINE_SWITCH_PRODUCT_ENABLED, engineSwitchAvailable, resolveEngineChoice,
  ENGINE_STORAGE_KEY, ENGINE_STORAGE_KEY_LEGACY,
} from '../src/scanner-scan-assist.js';
import { lateResultAdmitted } from '../src/r2-confirmation-model.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HTML = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
const JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');

/** `sel {` 로 시작하는 첫 CSS 블록의 본문 (중첩 없는 규칙용). */
const cssBlock = (sel) => { const a = HTML.indexOf(sel + ' {'); assert.ok(a > 0, sel + ' 블록이 없다'); return HTML.slice(a, HTML.indexOf('}', a)); };
/** grid-template-columns 값을 괄호 깊이 0 의 공백으로 나눈다 — `minmax(0, 1fr)` 안의 공백은 트랙 경계가 아니다. */
function splitTracks(value) {
  const tracks = [];
  let depth = 0;
  let current = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) { if (current) tracks.push(current); current = ''; continue; }
    current += ch;
  }
  if (current) tracks.push(current);
  return tracks;
}
/** `open` 위치의 `{` 와 짝인 `}` 의 인덱스 — 프레임 루프엔 정규식·템플릿 리터럴이 없어 순수 중괄호 짝으로 충분하다. */
function braceEnd(source, open) {
  assert.equal(source[open], '{');
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  assert.fail('닫는 중괄호를 못 찾았다');
}

test('ⓐ «R2 가용» 진리표 — 시험판 ∨ 승격; 승격 전 핀', () => {
  assert.equal(engineSwitchAvailable({ labPath: false, productEnabled: false }), false);
  assert.equal(engineSwitchAvailable({ labPath: true, productEnabled: false }), true);
  assert.equal(engineSwitchAvailable({ labPath: false, productEnabled: true }), true);
  assert.equal(engineSwitchAvailable({ labPath: true, productEnabled: true }), true);
  assert.equal(engineSwitchAvailable({}), false, '모름은 닫힘');
  assert.equal(engineSwitchAvailable(null), false);
  // ⚠ 승격 전 핀 — 정식(/)엔 스위치도 R2 도 없다. 승격 커밋이 이 줄을 바꾸며, 그때 사람이 정식 화면을 본다.
  assert.equal(ENGINE_SWITCH_PRODUCT_ENABLED, false, '승격 플래그가 켜졌다 — 정식 화면·정식 불변 자를 사람이 확인했는가');
});

test('ⓑ 저장 선택 — 새 키 우선 · 옛 키 1회 이관 · 기본 켬', () => {
  assert.equal(resolveEngineChoice('1', null), true);
  assert.equal(resolveEngineChoice('0', null), false);
  assert.equal(resolveEngineChoice('0', '1'), false, '새 키가 있으면 옛 키를 보면 안 된다');
  assert.equal(resolveEngineChoice(null, '0'), false, '옛 키 이관이 안 된다');
  assert.equal(resolveEngineChoice(null, '1'), true);
  assert.equal(resolveEngineChoice(null, null), true, '기본은 켬(시험판의 존재 이유)');
  assert.equal(resolveEngineChoice(undefined, undefined), true);
  assert.notEqual(ENGINE_STORAGE_KEY, ENGINE_STORAGE_KEY_LEGACY);
  assert.ok(!ENGINE_STORAGE_KEY.includes('lab'), '새 키 이름에 lab 이 남았다 — 제품 컴포넌트다');
});

test('ⓒ 마크업 — 상단 행이 스테이지 안, 순서 [진행|스위치|셀맵], 스위치 hidden·role=switch·aria-checked, 옛 토글 0건', () => {
  const stageAt = HTML.indexOf('id="camera-stage"');
  const stageEnd = HTML.indexOf('</section>', stageAt);
  assert.ok(stageAt > 0 && stageEnd > stageAt);
  const stage = HTML.slice(stageAt, stageEnd);
  const rowAt = stage.indexOf('id="stage-top-row"');
  const progressAt = stage.indexOf('id="r2-progress"');
  const switchAt = stage.indexOf('id="engine-switch"');
  const controlAt = stage.indexOf('id="engine-switch-control"');
  const cellmapAt = stage.indexOf('id="r2-cellmap"');
  assert.ok(rowAt > 0, '상단 행이 스테이지 안에 없다');
  assert.ok(rowAt < progressAt && progressAt < switchAt && switchAt < controlAt && controlAt < cellmapAt,
    '상단 행 순서가 [좌 진행 | 중앙 스위치 | 우 셀맵] 이 아니다');
  assert.match(stage, /id="engine-switch"[^>]*hidden/, '스위치가 authored hidden 이 아니다 — 정식 렌더가 바뀐다');
  assert.match(stage, /id="engine-switch-control"[^>]*role="switch"/, 'role=switch 가 없다');
  assert.match(stage, /id="engine-switch-control"[^>]*aria-checked=/, 'aria-checked 가 없다');
  assert.match(stage, /id="engine-switch-control"[^>]*aria-labelledby="engine-switch-label"/, '시각 라벨이 접근성 이름이 아니다');
  assert.match(stage, /id="engine-switch-control"[^>]*aria-describedby="engine-switch-desc"/, '설명이 describedby 가 아니다');
  assert.match(stage, /id="engine-switch-desc"[^>]*data-i18n="engine\.aria"/, '설명 문구가 i18n 밖이다');
  assert.match(stage, /id="r2-progress"[^>]*hidden/); assert.match(stage, /id="r2-cellmap"[^>]*hidden/);
  assert.equal(HTML.split('lab-r2-toggle').length - 1, 0, '옛 lab-r2-toggle 이 남았다 — 두 토글이 한 상태를 두 번 말한다');
  assert.equal(JS.split('lab-r2-toggle').length - 1, 0);
  // 상단 행 트랙의 «성질» (2b 갱신): 좌·우 트랙이 **같은 문자열**(대칭 → 스위치 정중앙), 중앙은 fit-content 상한,
  // 좌는 0 까지 줄고, 고정 px 트랙 없음. 고정 폭 3열은 320px 폰에서 넘치고, 상한 없는 auto 는 긴 언어 라벨이
  // 좌 열을 밀어낸다 (반박자 실측). 옛 «우 열 clamp()» 단언은 뺐다 — HUD 상한(140px)은 트랙이 아니라 우 칸 위젯의
  // `width: min(100%, <px>)` 가 진다(우 트랙이 좌와 같아야 정중앙이 성립하므로 위젯이 스스로 갇힌다). 아래에서 잰다.
  // ⚠ [3a] 그 상한이 **.r2-cellmap → .r2-hud-mini 로 옮겨갔다**: 캔버스는 이제 상자 안을 100% 채우고,
  //   크기·배경·모서리·스캔선 잘라내기는 상자가 맡는다. 재는 것은 여전히 «우 칸 위젯이 스스로 갇히는가» 하나다.
  const cols = (cssBlock('.stage-top-row').match(/grid-template-columns:([^;]+);/) || [])[1] || '';
  const tracks = splitTracks(cols);
  assert.equal(tracks.length, 3, '상단 행이 3열이 아니다: ' + cols);
  assert.equal(tracks[0], tracks[2], '좌·우 트랙이 다르다 — 스위치가 정중앙에서 벗어난다: ' + cols);
  assert.ok(tracks[0].startsWith('minmax(0,'), '좌 열이 0 까지 못 줄어든다: ' + cols);
  assert.ok(tracks[1].startsWith('fit-content('), '중앙 열에 상한이 없다 — 긴 라벨이 좌 열을 밀어낸다: ' + cols);
  assert.ok(!/\s\d+px\s/.test(cols + ' '), '고정 px 트랙이 있다: ' + cols);
  const miniWidth = (cssBlock('.r2-hud-mini').match(/(?:^|[\s;])width:([^;]+);/) || [])[1] || '';
  assert.ok(/min\(/.test(miniWidth) && /\d+px/.test(miniWidth),
    '미니 HUD 가 «열 폭 이하 · px 상한» 으로 갇히지 않았다 (트랙이 1fr 이라 위젯이 스스로 갇혀야 한다): ' + miniWidth);
  // 좌 알약은 실제로 접혀야 한다 — 상자만 줄고 내용물이 새면 스위치 아래로 비친다.
  assert.match(cssBlock('.r2-progress'), /overflow: hidden/, '좌 알약 내용물이 열 밖으로 샌다');
  assert.match(cssBlock('.r2-progress-note'), /min-width: 0/, 'note 가 줄어들지 못한다');
  assert.match(cssBlock('.engine-switch-label'), /text-overflow: ellipsis/, '긴 라벨이 말줄임되지 않는다');
  // 정식에서 «아무것도 안 그린다» 는 CSS 의 부재에 기댄다 — 그 부재를 성질로 잠근다.
  for (const sel of ['.stage-top-row', '.stage-top-left', '.stage-top-right']) {
    assert.ok(!/background|border|padding|box-shadow|min-height|height:/.test(cssBlock(sel)), sel + ' 이 정식 뷰파인더에 무언가를 그린다');
  }
  // 스테이지는 자기 스태킹 컨텍스트 — 안의 z6 행이 카메라 게이트(z2) 위로 새지 않는다.
  assert.match(cssBlock('.square-stage'), /isolation: isolate/, '상단 행이 카메라 게이트 위에 뜬다 (스태킹 컨텍스트 없음)');
  assert.match(HTML, /prefers-reduced-motion: reduce\) \{[^}]*\.engine-switch-knob/, 'knob 트랜지션이 reduced-motion 밖이다');
});

test('ⓓ 소비자 스윕 — R2/QR 관련 줄이 isLabPath() 를 따로 보지 않는다 (게이트는 r2Available 하나)', () => {
  const offenders = JS.split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    // r2Available 의 정의 줄은 isLabPath 를 «유도 입력» 으로 읽는 유일한 자리 — 스윕에서 뺀다.
    .filter(({ line }) => !line.includes('engineSwitchAvailable({'))
    .filter(({ line }) => line.includes('isLabPath()') && /r2Runtime|qrBridge|renderR2|R2_|engineSwitch|r2Progress|r2CellMap/.test(line));
  assert.deepEqual(offenders.map((o) => o.no + ': ' + o.line.trim()), [],
    '승격 날 «켰는데 안 먹는» 상태를 만드는 줄 — 전부 r2Available 로');
  assert.ok(JS.includes('const r2Available = engineSwitchAvailable({ labPath: isLabPath(), productEnabled: ENGINE_SWITCH_PRODUCT_ENABLED })'),
    'r2Available 이 진리표에서 유도되지 않는다');
  assert.ok(JS.includes('createR2ScanRuntime({ enabled: r2Available && r2Wanted })'), '런타임이 r2Available 을 안 본다');
});

test('ⓔ 핸들러 — 켜든 끄든 런타임·브리지·힌트·패널·문구를 함께 움직이고 새 키에 저장한다 (⚠ 철자 자)', () => {
  const at = JS.indexOf("engineSwitchControl.addEventListener('click'");
  assert.ok(at > 0, '핸들러가 없다');
  const body = JS.slice(at, JS.indexOf('\n  });', at));
  for (const needle of ['r2Runtime.setEnabled(!r2Runtime.enabled)', 'qrBridge.reset()', 'runtimeFamilyHint = null',
    'localStorage.setItem(ENGINE_STORAGE_KEY', 'paintEngineSwitch()', 'renderR2Progress()', 'renderR2CellMap()', 'refreshScanGuideCopy()']) {
    assert.ok(body.includes(needle), '핸들러에 ' + needle + ' 가 없다');
  }
  assert.ok(JS.includes("engineSwitchControl.setAttribute('aria-checked', String(r2Runtime.enabled))"), 'aria-checked 가 상태를 안 따른다');
  assert.ok(JS.includes('resolveEngineChoice(') && JS.includes('ENGINE_STORAGE_KEY_LEGACY'), '부트가 옛 키를 이관하지 않는다');
  assert.ok(JS.includes('if (engineSwitch && engineSwitchControl && r2Available) {'), '스위치 표시가 r2Available 게이트 밖이다');
});

/*
 * 2b (PM/029B §27.4 · 운영자 결정 ② ⑧, 2026-09-05) — R1 off 모드 · 좌 패널 칩 색 유도.
 */

test('ⓕ R1 off 모드(②) — R1 게이트가 `if (!r2Runtime.enabled) {` 안에 있고, R2 블록이 가이드 점·fps 부수 효과를 맡는다 (⚠ 철자 자)', () => {
  const loopAt = JS.indexOf('function startFrameLoop(');
  const loop = JS.slice(loopAt, JS.indexOf('async function startCamera(', loopAt));
  assert.ok(loop.length > 0, '프레임 루프를 못 찾았다');
  const r2At = loop.indexOf('if (r2Runtime.enabled) {');
  const wrapAt = loop.indexOf('if (!r2Runtime.enabled) {');
  // ⚠ 게이트 리터럴은 r2-scan-runtime.test ⓑ 도 indexOf 로 찍는다 — 글자 하나도 바꾸지 마라.
  const r1At = loop.indexOf('if (!isDecoding && timestamp - lastDecodeAt >= intervalMs) {');
  assert.ok(r2At > 0, 'R2 블록이 없다');
  assert.ok(wrapAt > r2At, 'R1-off 감싸기가 없거나 R2 블록보다 앞이다 — R2 위치에서 R1 동기 복호가 같이 돈다(②·⑫ 위반)');
  assert.ok(r1At > wrapAt, 'R1 게이트가 감싸기보다 앞이다');
  const wrapEnd = braceEnd(loop, loop.indexOf('{', wrapAt));
  assert.ok(r1At < wrapEnd, 'R1 게이트가 `if (!r2Runtime.enabled) {` 블록 밖이다 — 정식은 불변이지만 R2 위치에서 R1 이 돈다');
  // 정식 불변: R1 블록 안의 부수 효과 셋은 그대로다.
  const r1Block = loop.slice(wrapAt, wrapEnd);
  for (const needle of ['noteProductFrame()', 'renderGuideDots()', 'noteFrameProcessed()']) {
    assert.ok(r1Block.includes(needle), 'R1 블록에서 ' + needle + ' 가 사라졌다 — 정식 제어 흐름이 바뀌었다');
  }
  // R2 위치에서 R1 이 안 도니 R2 블록이 (a) 첫 grab 가이드 재렌더 (b) fps 줄을 맡는다. (c) 시도 회계는 안 부른다.
  const r2Block = loop.slice(r2At, braceEnd(loop, loop.indexOf('{', r2At)));
  assert.ok(r2Block.includes('renderGuideDots()'), 'R2 블록이 첫 grab 뒤 가이드 점을 안 그린다 — R2 위치에서 조준 가이드가 사라진다');
  assert.ok(r2Block.includes('noteFrameProcessed()'), 'R2 블록이 fps 줄을 안 올린다 — R2 위치에서 시험판 fps 가 «—» 로 멈춘다');
  assert.ok(!r2Block.includes('noteProductFrame()'), 'R2 블록이 R1 «복호 시도 회계» 를 부른다 — 시도 수의 뜻이 정식과 갈린다');
  assert.ok(r2Block.includes('yieldForQr ? null : grabVideoFrame('), 'R2 grab 이 QR 유예를 안 본다');
});

test('ⓖ 좌 패널 칩 색은 셀맵 색표에서 **유도**된다 — setProperty 인자가 리터럴이 아니라 R2_CELL_COLOR[CELL_MAP_STATE.X], CSS 는 변수만 본다 · setProperty 는 r2Available 게이트 안 (⚠ 철자 자)', () => {
  // 변수 ↔ 셀맵 상태의 짝 — 확정 = 확정 셀, 변동 = 후보 셀, 정정 강조 = 소거 셀. 이 셋이 계약이다(사본 목록이 아니다).
  const pairs = { '--r2-fixed': 'CONFIRMED', '--r2-live': 'CANDIDATE', '--r2-fix': 'ERASURE' };
  const defAt = JS.indexOf('const R2_CELL_COLOR = Object.freeze({');
  assert.ok(defAt > 0, 'R2_CELL_COLOR 정의가 없다');
  let lastSetAt = -1;
  for (const [variable, state] of Object.entries(pairs)) {
    const re = new RegExp("setProperty\\('" + variable + "',\\s*R2_CELL_COLOR\\[CELL_MAP_STATE\\." + state + "\\]\\)");
    const at = JS.search(re);
    assert.ok(at > defAt, variable + ' 가 R2_CELL_COLOR[CELL_MAP_STATE.' + state + '] 에서 유도되지 않거나 정의보다 앞에서 읽힌다');
    lastSetAt = Math.max(lastSetAt, at);
  }
  assert.equal((JS.match(/setProperty\('--r2-/g) || []).length, Object.keys(pairs).length, '--r2-* 변수 수가 짝 표와 다르다');
  // F4 — 세 줄이 전부 `if (r2Available) {` 블록 안: 정식(/) 의 <html> 인라인 스타일에 변수를 심지 않는다 (렌더는 같아도 DOM 이 달라진다).
  const firstSetAt = JS.search(/setProperty\('--r2-/);
  const gateAt = JS.lastIndexOf('if (r2Available) {', firstSetAt);
  assert.ok(gateAt > defAt, 'setProperty 앞에 r2Available 게이트가 없다 — 정식 DOM 에 --r2-* 변수가 심긴다');
  assert.ok(braceEnd(JS, JS.indexOf('{', gateAt)) > lastSetAt, 'setProperty 셋이 r2Available 게이트 블록 밖으로 새 있다');
  // CSS: 확정·변동 칩은 변수만, 정정 키프레임은 --r2-fix 에서 시작하고 `to` 가 없다(끝 값 = 요소 자신의 색).
  assert.match(HTML, /\.r2-chip\[data-state="confirmed"\]\s*\{[^}]*color:\s*var\(--r2-fixed\)/, '확정 칩 색이 --r2-fixed 가 아니다');
  assert.match(HTML, /\.r2-chip\[data-state="tentative"\]\s*\{[^}]*color:\s*var\(--r2-live\)/, '변동 칩 색이 --r2-live 가 아니다');
  const keyframes = HTML.match(/@keyframes r2-correct\s*\{([\s\S]*?)\}\s*\}/);
  assert.ok(keyframes, '정정 키프레임이 없다');
  assert.match(keyframes[1], /from\s*\{[^}]*color:\s*var\(--r2-fix\)/, '정정 강조가 --r2-fix 에서 시작하지 않는다');
  assert.doesNotMatch(keyframes[1], /\bto\b|100%/, '키프레임에 끝 값이 있다 — 확정·변동 각자의 색으로 돌아가지 못한다');
  const chipRules = HTML.match(/\.r2-chip[^{]*\{[^}]*\}/g) || [];
  assert.ok(chipRules.length >= 3, '칩 규칙이 ' + chipRules.length + '개뿐');
  for (const rule of chipRules) assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(rule), '칩 규칙에 색 리터럴 사본이 있다: ' + rule);
  assert.match(HTML, /\.r2-chip\.is-corrected\s*\{[^}]*animation:\s*r2-correct/, '정정 클래스가 키프레임을 안 쓴다');
  // reduced-motion 블록 안에서 정정 애니메이션이 꺼진다.
  const mediaAt = HTML.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(mediaAt > 0);
  const media = HTML.slice(mediaAt, braceEnd(HTML, HTML.indexOf('{', mediaAt)));
  assert.match(media, /\.r2-chip\.is-corrected\s*\{[^}]*animation:\s*none/, '정정 애니메이션이 reduced-motion 밖이다');
  // 마크업: 칩 행 컨테이너가 패널 안에 있고 막대 행보다 앞이다 (id 는 scanner.js 가 찍는다).
  const panelAt = HTML.indexOf('id="r2-progress"');
  const rowsAt = HTML.indexOf('id="r2-rows"');
  const barAt = HTML.indexOf('id="r2-progress-bar"');
  assert.ok(panelAt > 0 && rowsAt > panelAt && barAt > rowsAt, '좌 패널 안 [칩 행 | 막대 행] 순서가 아니다');
  assert.match(HTML, /@media \(max-width: 320px\)\s*\{[^}]*\.r2-rows\s*\{[^}]*flex-direction:\s*column/, '≤320px 에서 칩이 세로로 쌓이지 않는다 (운영자 답 ④)');
});

/*
 * 적대 검토 (2026-09-05) F7·F8·F9 — 좌 트랙 내용 폭은 320px 폰에서 59~69px 라 progress 칩 «D 0.62 · <상태>» 가 8언어 전부
 * 17~60px 넘쳤고 390px 에서도 6/8 언어가 넘쳤다(브라우저 실측). 문자열 폭은 브라우저 밖에서 못 재니 **성질**을 잰다: 칩은 열 폭을
 * 못 넘고(max-width) 넘치면 말줄임으로 드러내며, progress 칩은 줄바꿈이 허용돼 상태 라벨이 다음 줄에 온전히 온다.
 */
test('ⓗ 칩 넘침 — 칩은 max-width 100% · overflow hidden · ellipsis, progress 칩만 white-space normal · 결과 카드에 확정 요약 컨테이너 (F7·F8·F9)', () => {
  const chip = cssBlock('.r2-chip');
  assert.match(chip, /max-width:\s*100%/, '칩이 열 폭을 넘는다');
  assert.match(chip, /overflow:\s*hidden/, '넘친 칩이 그대로 샌다');
  assert.match(chip, /text-overflow:\s*ellipsis/, '잘림이 드러나지 않는다 — 상태 라벨이 잘렸는지 사용자가 모른다');
  assert.match(chip, /white-space:\s*nowrap/, '기본 칩(Type Y · Y2 (n25) · v0TRQ)은 한 줄이어야 한다 — 값 안에서 접히면 «Y2» 와 «(n25)» 가 갈린다');
  const progress = cssBlock('.r2-chip[data-key="progress"]');
  assert.match(progress, /white-space:\s*normal/, 'progress 칩이 줄바꿈을 못 한다 — «D 0.62 · » 뒤의 상태 라벨이 대부분의 폰에서 안 보인다');
  // 렌더가 progress 칩에 data-key 를 실제로 찍는다 — 셀렉터가 가리키는 속성이 실재해야 한다.
  assert.ok(JS.includes('chip.dataset.key = key'), '칩에 data-key 가 없다 — progress 셀렉터가 아무것도 못 고른다');
  // F9 — 세로 쌓기 규칙이 뷰포트 기준이라는 사실과 «같은 스테이지 폭인 360×640 은 가로 흐름» 이 다음 사람에게 적혀 있다.
  const mediaAt = HTML.indexOf('@media (max-width: 320px)');
  const note = HTML.slice(Math.max(0, mediaAt - 900), mediaAt);
  assert.ok(/뷰포트/.test(note) && /360×640/.test(note), '≤320px 규칙 주석에 «뷰포트 기준 · 360×640 은 같은 스테이지 폭에서 가로 모드» 가 없다');
  // F8 — 결과 카드 안에 확정 요약 컨테이너: authored hidden, 제목 뒤 · 본문 앞. 칩 규칙(.r2-rows)을 그대로 쓴다.
  const cardAt = HTML.indexOf('class="result-card"');
  const summaryAt = HTML.indexOf('id="result-r2-rows"');
  const contentAt = HTML.indexOf('id="result-content"');
  const titleAt = HTML.indexOf('id="result-title"');
  assert.ok(cardAt > 0 && summaryAt > cardAt && titleAt < summaryAt && summaryAt < contentAt, '결과 카드 안 [제목 | 확정 요약 | 본문] 순서가 아니다');
  assert.match(HTML, /id="result-r2-rows"[^>]*hidden/, '확정 요약 컨테이너가 authored hidden 이 아니다 — 정식 렌더가 바뀐다');
  assert.match(HTML, /class="r2-rows result-r2-rows"/, '확정 요약이 칩 행 규칙(.r2-rows)을 안 쓴다 — 두 표면이 다른 어휘로 그려진다');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(cssBlock('.result-r2-rows')), '결과 카드 요약 규칙에 색 리터럴이 있다 — 확정색은 변수(ⓖ)');
});

test('ⓘ 늦은 결과 문 — R1 .then/.catch 첫 줄이 lateResultAdmitted(\'r1\', …) 이고, 그 술어는 QR 콜백의 인라인 규칙과 같은 표다 (F2 · ⚠ 철자 자 + 값)', () => {
  // 값: 스위치가 R2 로 넘어간 뒤 완주한 R1 은 버리고, R1 위치에서는 세션만 같으면 통과(정식 환원).
  assert.equal(lateResultAdmitted('r1', { sameSession: true, r2Enabled: true }), false, 'R2 위치에서 늦은 R1 결과가 문을 지난다');
  assert.equal(lateResultAdmitted('r1', { sameSession: true, r2Enabled: false }), true, '정식(R2 항상 꺼짐)에서 R1 이 막힌다 — 정식 제어 흐름이 바뀐다');
  assert.equal(lateResultAdmitted('r1', { sameSession: false, r2Enabled: false }), false);
  assert.equal(lateResultAdmitted('qr', { sameSession: true, r2Enabled: false }), false, 'R1 위치에서 늦은 QR 결과가 문을 지난다');
  // 철자: R1 블록의 .then 과 .catch 가 첫 문장으로 그 술어를 부른다 (QR 콜백은 qr-bridge.test 가 인라인 철자를 핀).
  const loopAt = JS.indexOf('function startFrameLoop(');
  const loop = JS.slice(loopAt, JS.indexOf('async function startCamera(', loopAt));
  const thenAt = loop.indexOf('.then((result) => {');
  const catchAt = loop.indexOf('.catch(() => {', thenAt);
  assert.ok(thenAt > 0 && catchAt > thenAt, 'R1 attempt 의 then/catch 를 못 찾았다');
  const guard = "if (!lateResultAdmitted('r1', { sameSession: session === scanSession, r2Enabled: r2Runtime.enabled })) return;";
  const firstStatement = (from) => loop.slice(from).split('\n').slice(1).map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('//'));
  assert.equal(firstStatement(thenAt), guard, 'R1 .then 의 첫 문장이 늦은 결과 문이 아니다 — R2 위치에 R1 결과·힌트가 샌다');
  assert.equal(firstStatement(catchAt), guard, 'R1 .catch 의 첫 문장이 늦은 결과 문이 아니다 — R2 위치에서 R1 예외가 카메라를 끈다');
  // .finally 는 그대로 — 비용 회계(isDecoding · lastFrameCostMs)는 버린 결과에도 닫혀야 한다.
  const finallyAt = loop.indexOf('.finally(() => {', catchAt);
  assert.ok(finallyAt > catchAt, 'finally 가 없다');
  const fin = loop.slice(finallyAt, braceEnd(loop, loop.indexOf('{', finallyAt)));
  assert.ok(fin.includes('isDecoding = false') && !fin.includes('lateResultAdmitted'), 'finally 가 회계를 안 닫거나 늦은 결과 문을 본다');
});
