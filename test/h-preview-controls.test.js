import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {hRotationSpaceKey,hPreviewSquareSide,hBrightestPaletteHex,hControlIcon} from '../src/h-preview-controls.js';

const keyEvent = (overrides = {}) => ({
  code: 'Space', key: ' ', repeat: false, defaultPrevented: false,
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  target: null, ...overrides,
});

test('실제 3D 휠 handler는 Ctrl 없으면 스크롤을 소비하지 않고 Ctrl일 때만 줌/롤해요',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf("els.view3d.addEventListener('wheel', (ev) => {"),end=html.indexOf('}, { passive: false });',start)+23;
  assert.ok(start>=0&&end>start);
  let handler;const view={on:true,pad:24,roll:0},calls={paint:0,prevent:0,stop:0};
  vm.runInNewContext(html.slice(start,end),{els:{view3d:{addEventListener(kind,fn){handler=fn;}}},y3dPreview:view,Y3D_ROLL_STEP:.05,paintY3dPreview(){calls.paint++;}});
  const event=options=>({ctrlKey:false,shiftKey:false,deltaY:10,deltaX:0,preventDefault(){calls.prevent++;},stopPropagation(){calls.stop++;},...options});
  handler(event({}));assert.deepEqual(view,{on:true,pad:24,roll:0});assert.deepEqual(calls,{paint:0,prevent:0,stop:0});
  handler(event({ctrlKey:true}));assert.equal(view.pad,30);assert.deepEqual(calls,{paint:1,prevent:1,stop:1});
  handler(event({ctrlKey:true,deltaY:-10}));assert.equal(view.pad,24);
  handler(event({ctrlKey:true,shiftKey:true,deltaY:0,deltaX:10}));assert.equal(view.roll,.05);assert.equal(view.pad,24);
  view.on=false;handler(event({ctrlKey:true}));assert.deepEqual(calls,{paint:3,prevent:3,stop:3});
});

test('Space 회전 단축키는 활성 3D 미리보기의 비편집 대상에서만 허용해요', () => {
  assert.equal(hRotationSpaceKey(keyEvent(), {active: true, preview3d: true}), true);
  assert.equal(hRotationSpaceKey(keyEvent({code: 'KeyA', key: 'a'}), {active: true, preview3d: true}), false);
  for (const flags of [{active: false, preview3d: true}, {active: true, preview3d: false}]) {
    assert.equal(hRotationSpaceKey(keyEvent(), flags), false);
  }
  for (const field of ['repeat', 'defaultPrevented', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    assert.equal(hRotationSpaceKey(keyEvent({[field]: true}), {active: true, preview3d: true}), false, field);
  }
  const editable = {isContentEditable: true, closest() { return null; }};
  const input = {isContentEditable: false, closest(selector) { return selector === 'input,textarea,select,button,a,[role="textbox"],[contenteditable="true"]' ? {} : null; }};
  assert.equal(hRotationSpaceKey(keyEvent({target: editable}), {active: true, preview3d: true}), false);
  assert.equal(hRotationSpaceKey(keyEvent({target: input}), {active: true, preview3d: true}), false);
});

test('H preview square는 toolbar·padding·gap 경계에서 음수 없이 내림해요', () => {
  assert.equal(hPreviewSquareSide({width: 500, height: 400, toolbarHeight: 100, padding: 24, gap: 12}), 264);
  assert.equal(hPreviewSquareSide({width: 60, height: 60, toolbarHeight: 24, padding: 24, gap: 12}), 0);
  assert.equal(hPreviewSquareSide({width: 300.9, height: 260.9, toolbarHeight: 20, padding: 10.2, gap: 5.2}), 225);
  for (const bad of [NaN, Infinity, '300', null]) {
    assert.equal(hPreviewSquareSide({width: bad, height: 300}), 0);
  }
});

test('삽입 이미지 기본 배경은 sRGB 상대 휘도 최대 palette level을 canonical hex로 골라요', () => {
  assert.equal(hBrightestPaletteHex(['#0099ff', '#00ff00', '#ffffff']), '#ffffff');
  assert.equal(hBrightestPaletteHex([{r: 0, g: 153, b: 255}, {r: 0, g: 255, b: 0}]), '#00ff00');
  assert.equal(hBrightestPaletteHex([{r: 12.2, g: 34.7, b: 56.4}, 'bad', {r: -1, g: 0, b: 0}]), '#0c2338');
  assert.equal(hBrightestPaletteHex([]), '#ffffff');
});

test('control icon은 고정 trusted SVG fragment만 넣고 알 수 없는 종류는 cube로 fallback해요', () => {
  const cube = hControlIcon('cube');
  for (const kind of ['play', 'pause', 'cube', 'plane', 'home', 'zoom', 'rotate', 'x', 'y', 'gyro', 'image', 'copy', 'down', 'up']) {
    const icon = hControlIcon(kind);
    assert.match(icon, /^<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"/);
    assert.match(icon, /aria-hidden="true"><(?:path|circle|rect|ellipse)/);
    assert.match(icon, /<\/svg>$/);
    assert.doesNotMatch(icon, /<script|on[a-z]+\s*=|javascript:|<use\b|href=/i);
  }
  assert.equal(hControlIcon('untrusted-user-value'), cube);
});
