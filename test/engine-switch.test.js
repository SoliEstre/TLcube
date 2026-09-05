/**
 * engine-switch.test.js — 엔진 스위치(제품 컴포넌트)와 «R2 가용» 게이트의 계약 (PM/029B §27.4 1단계).
 *
 *   ⓐ 진리표 — engineSwitchAvailable 은 시험판 ∨ 승격. 승격 전 핀(false)은 승격 커밋에서 빨개져 사람이 본다.
 *   ⓑ 저장 선택 — 새 키 우선, 옛 키 1회 이관, 둘 다 없으면 켬.
 *   ⓒ 마크업 — 상단 행이 카메라 스테이지 안에 있고 [좌 진행 | 스위치 | 우 셀맵] 순서, 스위치는 authored hidden ·
 *      role=switch · aria-checked. 옛 lab-r2-toggle 은 0건. 8언어 키는 scanner-i18n 자가 자동으로 잰다.
 *   ⓓ 소비자 스윕 — scanner.js 에서 R2/QR 관련 줄이 isLabPath() 를 따로 보지 않는다(r2Available 하나).
 *   ⓔ 핸들러(⚠ 철자 자) — 켜든 끄든 런타임·브리지·힌트·패널·문구를 함께 움직이고 새 키에 저장한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ENGINE_SWITCH_PRODUCT_ENABLED, engineSwitchAvailable, resolveEngineChoice,
  ENGINE_STORAGE_KEY, ENGINE_STORAGE_KEY_LEGACY,
} from '../src/scanner-scan-assist.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HTML = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
const JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');

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
  // 상단 행 트랙의 «성질»: 좌는 0 까지 줄고(minmax(0,…)), 중앙은 상한이 있고(fit-content), 우는 clamp 로 갇힌다.
  // 고정 폭 3열은 320px 폰에서 넘치고, 상한 없는 auto 는 긴 언어 라벨이 좌 열을 밀어낸다 (반박자 실측).
  const cssBlock = (sel) => { const a = HTML.indexOf(sel + ' {'); assert.ok(a > 0, sel + ' 블록이 없다'); return HTML.slice(a, HTML.indexOf('}', a)); };
  const cols = (cssBlock('.stage-top-row').match(/grid-template-columns:([^;]+);/) || [])[1] || '';
  assert.ok(cols.startsWith(' minmax(0, 1fr)'), '좌 열이 0 까지 못 줄어든다: ' + cols);
  assert.ok(cols.includes('fit-content('), '중앙 열에 상한이 없다 — 긴 라벨이 좌 열을 밀어낸다: ' + cols);
  assert.ok(cols.includes('clamp('), '우 열이 갇히지 않았다: ' + cols);
  assert.ok(!/\s\d+px\s/.test(cols + ' '), '고정 px 트랙이 있다: ' + cols);
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
