/**
 * 본문 인쇄 호스트(설계 §3.9 · §6-22)를 가짜 document·window 로 실제로 구동해요.
 *
 * 가짜 환경이 브라우저와 맞춰야 하는 지점은 넷이에요:
 *   ① getElementById 는 body 에 붙어 있는 노드만 찾아요(remove 뒤에는 null).
 *   ② requestAnimationFrame·setTimeout 은 테스트가 직접 흘려보낼 때만 돌아요(양보가 실제로 일어나는지 재려고).
 *   ③ afterprint 는 window 리스너, 인쇄 끝은 matchMedia('print') 의 change(matches=false) 로도 와요.
 *   ④ print() 는 호출 시점의 DOM 을 기록해요(인쇄되는 것은 그 순간의 문서예요).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneToSvg} from '../src/svg.js';
import {rasterToPng} from '../src/png.js';
import {encodeH} from '../src/h-codec.js';
import {buildHCubeModel} from '../src/cube-export.js';
import {physicalHCube} from '../src/cube-physical.js';
import {paperPlan, buildPaperSheet, PAPER_SIZES} from '../src/paper-net.js';
import {
  printSvgSheet, clearPrintHost, printSheetSvg, printSheetCss,
  PRINT_HOST_ID, PRINT_STYLE_ID, PRINT_HEIGHT_TRIM_MM, CSS_PAGE_SIZES_MM,
} from '../src/print-sheet.js';

function makeEnv() {
  const body = {
    children: [],
    appendChild(node) {
      node.parentNode = body;
      body.children.push(node);
      return node;
    },
    removeChild(node) {
      const k = body.children.indexOf(node);
      if (k >= 0) body.children.splice(k, 1);
      node.parentNode = null;
      return node;
    },
  };
  const doc = {
    body,
    createElement(tag) {
      const el = {tagName: tag.toUpperCase(), id: '', textContent: '', innerHTML: '', parentNode: null};
      el.remove = () => {
        if (el.parentNode) el.parentNode.removeChild(el);
      };
      return el;
    },
    getElementById: (id) => body.children.find((n) => n.id === id) ?? null,
  };
  const listeners = new Map();
  const mqlListeners = new Set();
  const frames = [], timers = [];
  const mql = {
    matches: false,
    addEventListener(type, fn) {
      assert.equal(type, 'change');
      mqlListeners.add(fn);
    },
    removeEventListener(type, fn) {
      mqlListeners.delete(fn);
    },
    fire(matches) {
      mql.matches = matches;
      for (const fn of [...mqlListeners]) fn({matches});
    },
  };
  const win = {
    printCalls: [],
    onPrint: null,
    print() {
      win.printCalls.push({
        host: doc.getElementById(PRINT_HOST_ID), style: doc.getElementById(PRINT_STYLE_ID),
        hosts: body.children.filter((n) => n.id === PRINT_HOST_ID).length,
        styles: body.children.filter((n) => n.id === PRINT_STYLE_ID).length,
      });
      if (win.onPrint) win.onPrint();
    },
    requestAnimationFrame(fn) {
      frames.push(fn);
      return frames.length;
    },
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    matchMedia(query) {
      assert.equal(query, 'print');
      return mql;
    },
    dispatch(type) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({type});
    },
  };
  /** 쌓인 프레임·타이머를 비우고 마이크로태스크를 돌려요. */
  const flush = async () => {
    for (let k = 0; k < 8; k += 1) {
      while (frames.length) frames.shift()();
      while (timers.length) timers.shift()();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const listenerCount = () => (listeners.get('afterprint')?.size ?? 0) + mqlListeners.size;
  return {doc, win, mql, frames, timers, flush, listenerCount};
}

const A4 = {pageKeyword: 'A4', widthMm: 210, heightMm: 297};
const WHITE = {r: 255, g: 255, b: 255};
/** 다운로드 SVG 와 같은 꼴: viewBox = 용지(mm), 모든 도형은 여백 7 mm 안. 내장 PNG 이미지 하나 포함. */
function sheetSvg([w, h] = [210, 297]) {
  const pixels = new Uint8ClampedArray(2 * 2 * 4).fill(200);
  const href = `data:image/png;base64,${Buffer.from(rasterToPng({width: 2, height: 2, pixels})).toString('base64')}`;
  const scene = {
    width: w, height: h, background: WHITE, shapes: [
      {kind: 'polygon', color: {r: 0, g: 0, b: 0}, points: [{x: 7, y: 7}, {x: 57, y: 7}, {x: 57, y: 7.3}, {x: 7, y: 7.3}]},
      {kind: 'image', color: WHITE, image: {width: 2, height: 2, pixels, href},
        points: [{x: 20, y: 20}, {x: 40, y: 20}, {x: 40, y: 40}, {x: 20, y: 40}]},
    ],
  };
  return sceneToSvg(scene, {pixelsPerUnit: 1});
}
const mmRoot = (w, h, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${extra}<rect x="7" y="7" width="10" height="10" fill="#000"/></svg>\n`;

/** 인쇄 SVG 루트가 1:1(사용자 단위 1 = 1 mm)이고 높이 = 용지 − 0.5 인지 재는 자. */
function oneToOne(svgText, {widthMm, heightMm}) {
  const root = /^<svg\b([^>]*)>/.exec(svgText);
  if (!root) return {ok: false, why: 'root'};
  const attr = (name) => new RegExp(`\\s${name}="([^"]*)"`).exec(root[1])?.[1];
  const w = attr('width'), h = attr('height'), vb = (attr('viewBox') ?? '').split(/\s+/).map(Number);
  const wmm = w?.endsWith('mm') ? Number(w.slice(0, -2)) : NaN, hmm = h?.endsWith('mm') ? Number(h.slice(0, -2)) : NaN;
  const ok = vb.length === 4 && vb[0] === 0 && vb[1] === 0 && wmm === vb[2] && hmm === vb[3]
    && Math.abs(wmm - widthMm) < 1e-9 && Math.abs(hmm - (heightMm - PRINT_HEIGHT_TRIM_MM)) < 1e-9;
  return {ok, wmm, hmm, vb};
}

test('§6-22 자 검증: 1:1 자는 viewBox 와 mm 크기가 어긋난 SVG · 높이를 안 줄인 SVG 를 거부해요', () => {
  assert.equal(oneToOne(mmRoot(210, 296.5), A4).ok, true);
  assert.equal(oneToOne('<svg width="210mm" height="296.5mm" viewBox="0 0 210 297"></svg>', A4).ok, false);
  assert.equal(oneToOne(mmRoot(210, 297), A4).ok, false);
  assert.equal(oneToOne('<svg width="210" height="296.5" viewBox="0 0 210 296.5"></svg>', A4).ok, false);
});

test('§6-22 인쇄 SVG: 루트만 바뀌어 1:1 · 높이 = 용지 − 0.5 이고, 본문 바이트는 그대로예요', () => {
  for (const [name, [w, h]] of Object.entries(CSS_PAGE_SIZES_MM)) {
    const src = sheetSvg([w, h]);
    const out = printSheetSvg(src, {widthMm: w, heightMm: h});
    assert.ok(oneToOne(out, {widthMm: w, heightMm: h}).ok, name);
    const body = (s) => s.slice(s.indexOf('>') + 1);
    assert.equal(body(out), body(src), name);
    const rootOut = /^<svg\b[^>]*>/.exec(out)[0];
    assert.equal((rootOut.match(/\swidth=/g) ?? []).length, 1);
    assert.equal((rootOut.match(/\sviewBox=/g) ?? []).length, 1);
  }
  // mm 루트(sceneToSvg unit:'mm' 꼴)도 같아요.
  assert.ok(oneToOne(printSheetSvg(mmRoot(210, 297), A4), A4).ok);
});

test('§6-22 스타일: @page 키워드 · 여백 0 · 화면 숨김 · 인쇄에서 호스트만 · print-color-adjust exact · SVG mm 크기', () => {
  const css = printSheetCss(A4);
  assert.match(css, /@media screen \{ #tlPrintHost \{ display:none \} \}/);
  assert.match(css, /@media print \{[\s\S]*@page \{ size: A4 portrait; margin: 0 \}/);
  assert.match(css, /body > \*:not\(#tlPrintHost\) \{ display:none !important \}/);
  assert.match(css, /[^-]print-color-adjust:exact/);
  assert.match(css, /-webkit-print-color-adjust:exact/);
  assert.match(css, /#tlPrintHost svg \{ display:block; width:210mm; height:296.5mm \}/);
  // 키워드는 대소문자 무관하게 받아 규격 표기로 적어요.
  for (const [name, [w, h]] of Object.entries(CSS_PAGE_SIZES_MM)) {
    assert.match(printSheetCss({pageKeyword: name.toLowerCase(), widthMm: w, heightMm: h}), new RegExp(`size: ${name} portrait;`));
  }
  // 키워드가 없으면 mm 치수로 적어요.
  assert.match(printSheetCss({widthMm: 100, heightMm: 150}), /size: 100mm 150mm;/);
  // 키워드와 치수가 어긋나면 거부해요(용지 표 짝 오류).
  assert.throws(() => printSheetCss({pageKeyword: 'A4', widthMm: 215.9, heightMm: 279.4}), RangeError);
  assert.throws(() => printSheetCss({pageKeyword: 'A4; } body { color:red', widthMm: 210, heightMm: 297}), RangeError);
});

test('§6-22 흐름: 주입 → 한 프레임 양보 뒤 print() 1회 → afterprint 에서 호스트·스타일·리스너 제거', async () => {
  const env = makeEnv();
  const done = printSvgSheet(sheetSvg(), A4, env);
  // 주입은 즉시, print() 는 양보 뒤예요.
  assert.equal(env.win.printCalls.length, 0);
  const host = env.doc.getElementById(PRINT_HOST_ID), style = env.doc.getElementById(PRINT_STYLE_ID);
  assert.ok(host && style);
  assert.equal(host.tagName, 'DIV');
  assert.equal(style.tagName, 'STYLE');
  assert.equal(style.textContent, printSheetCss(A4));
  assert.ok(oneToOne(host.innerHTML, A4).ok);
  assert.equal(env.frames.length, 1);
  await env.flush();
  await done;
  assert.equal(env.win.printCalls.length, 1);
  const call = env.win.printCalls[0];
  assert.deepEqual([call.hosts, call.styles], [1, 1]);
  assert.equal(call.host, host);
  // 타이머로 지우지 않아요: 인쇄 뒤 대기 중인 프레임·타이머가 없고, 호스트는 afterprint 전까지 남아요.
  assert.deepEqual([env.frames.length, env.timers.length], [0, 0]);
  await env.flush();
  assert.equal(env.doc.getElementById(PRINT_HOST_ID), host);
  assert.equal(env.listenerCount(), 2);
  env.win.dispatch('afterprint');
  assert.equal(env.doc.getElementById(PRINT_HOST_ID), null);
  assert.equal(env.doc.getElementById(PRINT_STYLE_ID), null);
  assert.equal(env.listenerCount(), 0);
  assert.equal(env.doc.body.children.length, 0);
});

test('§6-22 인쇄 끝 신호: matchMedia(print) change(false) 에서 지우고, change(true) 에서는 그대로예요', async () => {
  const env = makeEnv();
  const done = printSvgSheet(sheetSvg(), A4, env);
  await env.flush();
  await done;
  env.mql.fire(true);
  assert.ok(env.doc.getElementById(PRINT_HOST_ID));
  env.mql.fire(false);
  assert.equal(env.doc.getElementById(PRINT_HOST_ID), null);
  assert.equal(env.doc.getElementById(PRINT_STYLE_ID), null);
  assert.equal(env.listenerCount(), 0);
  // 늦게 온 afterprint 는 아무것도 하지 않아요(이미 해제).
  env.win.dispatch('afterprint');
  assert.equal(env.doc.body.children.length, 0);
});

test('§6-22 재호출: 끝 신호가 오지 않은 잔여 호스트는 다음 인쇄 직전에 지워져 호스트가 늘 하나예요', async () => {
  const env = makeEnv();
  for (let k = 0; k < 3; k += 1) {
    const done = printSvgSheet(sheetSvg(), A4, env);
    await env.flush();
    await done;
    assert.equal(env.win.printCalls.at(-1).hosts, 1);
    assert.equal(env.win.printCalls.at(-1).styles, 1);
    assert.equal(env.listenerCount(), 2, '이전 호출의 리스너가 남으면 안 돼요');
  }
  assert.equal(env.doc.body.children.length, 2);
  assert.equal(clearPrintHost(env.doc), true);
  assert.equal(clearPrintHost(env.doc), false);
  assert.equal(env.listenerCount(), 0);
});

test('§6-22 앞지르기: 양보 중에 다음 인쇄가 오면 print() 는 한 번(늦은 쪽)만 불려요', async () => {
  const env = makeEnv();
  const first = printSvgSheet(mmRoot(210, 297, '<g id="first"/>'), A4, env);
  const second = printSvgSheet(mmRoot(210, 297, '<g id="second"/>'), A4, env);
  await env.flush();
  await Promise.all([first, second]);
  assert.equal(env.win.printCalls.length, 1);
  assert.match(env.win.printCalls[0].host.innerHTML, /id="second"/);
  assert.equal(env.win.printCalls[0].hosts, 1);
});

test('§6-22 print() 가 던지면 호스트를 지우고 같은 오류로 거부해요', async () => {
  const env = makeEnv();
  const boom = new Error('print 차단');
  env.win.onPrint = () => {
    throw boom;
  };
  const rejected = assert.rejects(printSvgSheet(sheetSvg(), A4, env), (err) => err === boom);
  await env.flush();
  await rejected;
  assert.equal(env.doc.body.children.length, 0);
  assert.equal(env.listenerCount(), 0);
});

test('§6-22 입력 거부: DOM 을 건드리기 전에 거부해요(1:1 불가 · 스크립트 · 이벤트 속성 · 외부 href · 키워드 오류)', async () => {
  const bad = [
    [sheetSvg([210, 297]), {pageKeyword: 'letter', widthMm: 215.9, heightMm: 279.4}],
    [mmRoot(210, 297, '<script>alert(1)</script>'), A4],
    [mmRoot(210, 297, '<rect onload="x()"/>'), A4],
    [mmRoot(210, 297, '<image href="https://example.invalid/a.png"/>'), A4],
    [mmRoot(210, 297, '<foreignObject></foreignObject>'), A4],
    [mmRoot(210, 297), {pageKeyword: 'A3', widthMm: 210, heightMm: 297}],
    [mmRoot(210, 297), {pageKeyword: 'tabloid', widthMm: 210, heightMm: 297}],
    ['<div>not svg</div>', A4],
  ];
  for (const [svg, paper] of bad) {
    const env = makeEnv();
    // 이전 인쇄 잔여가 있어도 거부된 호출은 건드리지 않아요.
    const keep = printSvgSheet(mmRoot(210, 297), A4, env);
    await env.flush();
    await keep;
    // 프레임을 흘려보낸 뒤에 판정해요. 거부하지 않는 결함이면 print() 까지 가서 resolve 하므로 매달리지 않고 빨개져요.
    const rejected = assert.rejects(printSvgSheet(svg, paper, env), (err) => err instanceof RangeError || err instanceof TypeError);
    await env.flush();
    await rejected;
    assert.equal(env.doc.body.children.length, 2);
    assert.equal(env.win.printCalls.length, 1);
    assert.equal(env.frames.length + env.timers.length, 0);
  }
  await assert.rejects(printSvgSheet(mmRoot(210, 297), A4, {doc: makeEnv().doc, win: {}}), TypeError);
});

test('§6-22 계약: 종이 도안 용지 8종의 @page 키워드·치수가 CSS 규격과 맞고, 실제 도안 SVG 가 1:1 인쇄 SVG 가 돼요', () => {
  for (const p of PAPER_SIZES) {
    assert.match(printSheetCss(p), new RegExp(`size: ${p.pageKeyword} portrait;`), p.id);
  }
  const encoded = encodeH(Uint8Array.of(7, 1, 9), {version: 0, mode: 3, tones: 3, ecc: 'M', mask: 2, finder: 'frame'});
  const phys = physicalHCube(buildHCubeModel(encoded, {renderFaces: 3}));
  for (const id of ['A4', 'Letter', 'JISB5']) {
    const scene = buildPaperSheet(phys, paperPlan(phys, {paper: id, thicknessMm: 0.1}));
    const paper = {widthMm: scene.width, heightMm: scene.height};
    const printable = printSheetSvg(sceneToSvg(scene, {unit: 'mm'}), paper);
    assert.ok(oneToOne(printable, paper).ok, id);
  }
});

test('숨은 창: 프레임이 끝내 오지 않아도 타이머 폴백으로 print() 를 한 번 불러요', async () => {
  const env = makeEnv();
  const done = printSvgSheet(mmRoot(210, 297), A4, env);
  // 프레임은 흘리지 않고 타이머만 흘려요(숨은 탭·창의 rAF 정지 재현).
  for (let k = 0; k < 6; k += 1) {
    while (env.timers.length) env.timers.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await done;
  assert.equal(env.win.printCalls.length, 1);
  assert.equal(env.frames.length, 1, '프레임은 여전히 대기 중이어야 폴백 경로로 끝난 것이 확인돼요');
  // 뒤늦게 온 프레임은 아무것도 다시 하지 않아요.
  while (env.frames.length) env.frames.shift()();
  while (env.timers.length) env.timers.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.win.printCalls.length, 1);
});
