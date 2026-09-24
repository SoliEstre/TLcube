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
import {
  paperPlan, paperMethodOptions, buildPaperSheet, PAPER_SIZES, THICKNESS_PRESETS, PAPER_MARGIN_MM, CUT_LINE_MM,
  PRINT_SCALE_MIN, PRINT_SCALE_MAX,
} from '../src/paper-net.js';
import {
  printSvgSheet, clearPrintHost, printSheetSvg, printSheetCss,
  PRINT_HOST_ID, PRINT_STYLE_ID, PRINT_HEIGHT_TRIM_MM, PRINT_MARGIN_MM, CSS_PAGE_SIZES_MM,
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

const M = PRINT_MARGIN_MM;
/** 인쇄 SVG 가 기대하는 루트 치수: 가장자리 M 을 잘라 낸 영역(높이는 0.5 mm 더). */
const cropOf = ({widthMm, heightMm}) => ({x: M, y: M, w: widthMm - 2 * M, h: heightMm - 2 * M - PRINT_HEIGHT_TRIM_MM});
/**
 * 인쇄 SVG 루트가 1:1(사용자 단위 1 = 1 mm)인지 재는 자. viewBox 원점은 (M, M), 크기 = mm 크기 =
 * (W − 2M) × (H − 2M − 0.5) — 다운로드 SVG 좌표를 그대로 두고 용지 가장자리 M 만 잘라요.
 */
function oneToOne(svgText, paper) {
  const root = /^<svg\b([^>]*)>/.exec(svgText);
  if (!root) return {ok: false, why: 'root'};
  const attr = (name) => new RegExp(`\\s${name}="([^"]*)"`).exec(root[1])?.[1];
  const w = attr('width'), h = attr('height'), vb = (attr('viewBox') ?? '').split(/\s+/).map(Number);
  const wmm = w?.endsWith('mm') ? Number(w.slice(0, -2)) : NaN, hmm = h?.endsWith('mm') ? Number(h.slice(0, -2)) : NaN;
  const c = cropOf(paper), near = (a, b) => Math.abs(a - b) < 1e-9;
  const ok = vb.length === 4 && near(vb[0], c.x) && near(vb[1], c.y) && wmm === vb[2] && hmm === vb[3]
    && near(wmm, c.w) && near(hmm, c.h);
  return {ok, wmm, hmm, vb};
}
const croppedRoot = ([w, h]) => {
  const c = cropOf({widthMm: w, heightMm: h});
  return `<svg width="${c.w}mm" height="${c.h}mm" viewBox="${c.x} ${c.y} ${c.w} ${c.h}"></svg>`;
};

test('§6-22 자 검증: 1:1 자는 viewBox 원점·크기·mm 크기 중 하나만 어긋나도 거부해요(용지 전체 · 여백 0 옛 꼴 포함)', () => {
  const c = cropOf(A4);
  assert.equal(oneToOne(croppedRoot([210, 297]), A4).ok, true);
  // 옛 꼴(용지 전체 폭 · 원점 0 · 높이 −0.5)은 이제 빨개요 — 여백 «최소» 에서 비율 축소되는 꼴이에요.
  assert.equal(oneToOne(mmRoot(210, 296.5), A4).ok, false);
  assert.equal(oneToOne(`<svg width="${c.w}mm" height="${c.h}mm" viewBox="0 0 ${c.w} ${c.h}"></svg>`, A4).ok, false); // 원점 0
  assert.equal(oneToOne(`<svg width="${c.w}mm" height="${c.h}mm" viewBox="${M} ${M} ${c.w} ${c.h + 0.5}"></svg>`, A4).ok, false); // viewBox 높이
  assert.equal(oneToOne(`<svg width="${c.w}mm" height="${c.h + PRINT_HEIGHT_TRIM_MM}mm" viewBox="${M} ${M} ${c.w} ${c.h + PRINT_HEIGHT_TRIM_MM}"></svg>`, A4).ok, false); // 높이 안 줄임
  assert.equal(oneToOne(`<svg width="${c.w}" height="${c.h}" viewBox="${M} ${M} ${c.w} ${c.h}"></svg>`, A4).ok, false); // 단위 없음
});

test('§6-22 인쇄 여백 M: 도안 여백 안쪽이고(재단선 잉크 · 하단 띠를 자르지 않게) CSS px 정수배예요', () => {
  // 도안은 모든 도형을 용지 가장자리에서 PAPER_MARGIN_MM 안에 두고, 재단선 잉크만 CUT_LINE_MM 더 바깥까지 가요(paper-net 자체 검사, 네 변 같은 허용).
  // 왼쪽·오른쪽·위 크롭(M)은 아래 첫 단언으로 재단선 잉크까지 안전해요. 아래 크롭(M + 0.5 = 6.85)은 재단선 허용(6.8)보다 안쪽이라
  // 두 번째 단언은 재단선 아닌 도형만 지켜요 — 아래 재단선은 하단 띠(PAPER_BAND_MM) 배치가 떼어 놓고, 그건 아래 «크롭» 격자만 재요.
  // (M + 0.5 ≤ 7 − 0.2 를 계약으로 걸려면 M 을 23 px(6.09 mm) 이하로 내려야 해요 — 6.35 mm(= 1/4 in, 24 px) 선택을 바꾸는 설계 결정이라 여기서 걸지 않아요.)
  assert.ok(M <= PAPER_MARGIN_MM - CUT_LINE_MM, `M ${M} > 재단선 잉크 ${PAPER_MARGIN_MM - CUT_LINE_MM}`);
  assert.ok(M + PRINT_HEIGHT_TRIM_MM <= PAPER_MARGIN_MM, `아래 크롭 ${M + PRINT_HEIGHT_TRIM_MM} > 도안 여백 ${PAPER_MARGIN_MM}`);
  // 흔한 레이저 비인쇄 여백(4.23 mm = 1/6 in)보다 넓어야 «여백: 최소» 에서 쪽 영역이 SVG 보다 좁아지지 않아요.
  assert.ok(M >= 6, `M ${M} 이 좁으면 «최소» 여백에서 Chromium 이 가로 넘침을 비율로 줄여요`);
  // Chromium 은 @page 여백을 CSS px 로 맞춰서, 정수 px 가 아니면 종이 위 위치가 0.085 mm(6 mm → 23 px) 밀려요(헤드리스 실측).
  const px = M * 96 / 25.4;
  assert.ok(Math.abs(px - Math.round(px)) < 1e-9, `M ${M} mm = ${px} px`);
});

/** 도형 잉크 상자(qr 아닌 polygon 은 svg.js 이음 stroke 0.03 의 절반을 더해요)가 크롭 밖으로 나간 도형 목록이에요. */
function outsideCrop(scene) {
  const c = cropOf({widthMm: scene.width, heightMm: scene.height}), out = [];
  scene.shapes.forEach((s, k) => {
    const pad = s.kind === 'polygon' && !s.qr ? 0.015 : 0;
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    if (Math.min(...xs) - pad < c.x - 1e-9 || Math.max(...xs) + pad > c.x + c.w + 1e-9
      || Math.min(...ys) - pad < c.y - 1e-9 || Math.max(...ys) + pad > c.y + c.h + 1e-9) out.push(`${k}:${s.role}`);
  });
  return out;
}

test('§6-22 크롭: 용지 8종 × 두께 프리셋 × 방식 × 한 변(자동 · 직접)에서 그린 도형이 인쇄 크롭 밖으로 나가지 않아요 — 자 검증 포함', () => {
  const cubes = [
    physicalHCube(buildHCubeModel(encodeH(Uint8Array.of(1, 2, 3), {version: 0, mode: 3, tones: 3, ecc: 'M', mask: 0, finder: 'frame'}), {renderFaces: 3})),
    physicalHCube(buildHCubeModel(encodeH(Uint8Array.of(1), {version: 8, mode: 3, tones: 2, ecc: 'M', mask: 0, finder: 'frame'}), {renderFaces: 6})),
  ];
  let built = 0;
  const problems = [];
  for (const phys of cubes) for (const p of PAPER_SIZES) for (const t of THICKNESS_PRESETS) for (const sideMm of [undefined, 13.4, 30]) {
    for (const o of paperMethodOptions(phys, {paper: p.id, thicknessMm: t.thicknessMm, sideMm})) {
      if (!o.enabled) continue;
      const scene = buildPaperSheet(phys, paperPlan(phys, {paper: p.id, thicknessMm: t.thicknessMm, sideMm, method: o.method}));
      const bad = outsideCrop(scene);
      if (bad.length) problems.push(`n=${phys.n} ${p.id} ${t.id} ${o.method} s=${sideMm ?? 'auto'}: ${bad.slice(0, 3).join(', ')}`);
      built += 1;
    }
  }
  assert.deepEqual(problems.slice(0, 5), []);
  assert.ok(built >= 200, `만든 도안 ${built} — 격자가 대부분 계획에서 떨어지면 자가 아무것도 안 재요`);
  // 자 검증: 크롭 경계 바로 밖(왼쪽 · 오른쪽 · 위 · 아래)에 심은 도형마다 빨개져요.
  const base = {width: 210, height: 297, shapes: []}, sq = (x, y, extra = {}) => ({kind: 'polygon', qr: true, role: 'planted', ...extra,
    points: [{x, y}, {x: x + 1, y}, {x: x + 1, y: y + 1}, {x, y: y + 1}]});
  const c = cropOf(A4);
  for (const shape of [sq(c.x - 0.01, 100), sq(c.x + c.w - 0.99, 100), sq(100, c.y - 0.01), sq(100, c.y + c.h - 0.99),
    sq(c.x + 0.005, 100, {qr: false})]) { // 마지막: 이음 stroke 절반(0.015)만큼 넘는 모듈
    assert.deepEqual(outsideCrop({...base, shapes: [shape]}), ['0:planted'], JSON.stringify(shape.points[0]));
  }
  assert.deepEqual(outsideCrop({...base, shapes: [sq(c.x + 0.02, c.y + 0.02, {qr: false})]}), []);
});

test('§6-22 크롭 × 인쇄 배율 보정: s 끝값(0.9 · 1.02)과 실측값 0.966 에서도 그린 도형이 인쇄 크롭 밖으로 나가지 않고, 상한 1.02 는 크롭이 정한 값이에요', () => {
  // 보정은 가상 여백 7 mm(재단선 잉크 6.8)를 실제 좌표에서 7/s(6.8/s)로 줄여요. 아래 크롭 M + 0.5 가 가장 빡빡해요.
  // 상한 근거(구성 주장이라 반례 쪽도 적어요): 7/1.02 ≥ 6.85 이고 7/1.03 < 6.85 — 한 칸(0.01) 더 올리면 아래 띠 잉크가 잘려요.
  assert.ok(PAPER_MARGIN_MM / PRINT_SCALE_MAX >= M + PRINT_HEIGHT_TRIM_MM, `${PAPER_MARGIN_MM / PRINT_SCALE_MAX}`);
  assert.ok(PAPER_MARGIN_MM / (PRINT_SCALE_MAX + 0.01) < M + PRINT_HEIGHT_TRIM_MM, '상한이 크롭보다 넉넉하면 이 주석의 근거가 틀려요');
  assert.ok((PAPER_MARGIN_MM - CUT_LINE_MM) / PRINT_SCALE_MAX >= M, '옆 · 위 재단선 잉크');
  const cubes = [
    physicalHCube(buildHCubeModel(encodeH(Uint8Array.of(1, 2, 3), {version: 0, mode: 3, tones: 3, ecc: 'M', mask: 0, finder: 'frame'}), {renderFaces: 3})),
    physicalHCube(buildHCubeModel(encodeH(Uint8Array.of(1), {version: 8, mode: 3, tones: 2, ecc: 'M', mask: 0, finder: 'frame'}), {renderFaces: 6})),
  ];
  let built = 0, minBottom = Infinity;
  const problems = [];
  for (const printScale of [PRINT_SCALE_MIN, 0.966, PRINT_SCALE_MAX]) for (const phys of cubes) for (const p of PAPER_SIZES) for (const t of THICKNESS_PRESETS) for (const sideMm of [undefined, 13.4, 30]) {
    for (const o of paperMethodOptions(phys, {paper: p.id, thicknessMm: t.thicknessMm, sideMm, printScale})) {
      if (!o.enabled) continue;
      const scene = buildPaperSheet(phys, paperPlan(phys, {paper: p.id, thicknessMm: t.thicknessMm, sideMm, method: o.method, printScale}));
      assert.deepEqual([scene.width, scene.height], [p.widthMm, p.heightMm], '장면은 실제 용지 크기예요');
      const bad = outsideCrop(scene);
      if (bad.length) problems.push(`s=${printScale} n=${phys.n} ${p.id} ${t.id} ${o.method} s=${sideMm ?? 'auto'}: ${bad.slice(0, 3).join(', ')}`);
      if (printScale === PRINT_SCALE_MAX) minBottom = Math.min(minBottom, ...scene.shapes.flatMap((s) => s.points.map((q) => scene.height - q.y)));
      built += 1;
    }
  }
  assert.deepEqual(problems.slice(0, 5), []);
  assert.ok(built >= 600, `만든 도안 ${built}`);
  // s = 1.02 에서 아래 끝 잉크가 크롭(6.85)에 가장 가까워요 — 여유가 실제로 작다는 것(0.1 mm 미만)도 재요.
  assert.ok(minBottom >= M + PRINT_HEIGHT_TRIM_MM && minBottom < M + PRINT_HEIGHT_TRIM_MM + 0.1, `s=1.02 아래 끝 ${minBottom}`);
});

test('§6-22 인쇄 SVG: 루트만 바뀌어 1:1(가장자리 M 크롭) 이고, 본문 바이트는 그대로예요', () => {
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

test('§6-22 스타일: @page 키워드 · 여백 M · 화면 숨김 · 인쇄에서 호스트만 · 쪽 영역 가운데 · print-color-adjust exact · SVG mm 크기', () => {
  const css = printSheetCss(A4);
  assert.match(css, /@media screen \{ #tlPrintHost \{ display:none \} \}/);
  assert.match(css, /@media print \{[\s\S]*@page \{ size: A4 portrait; margin: 6\.35mm \}/);
  assert.match(css, /body > \*:not\(#tlPrintHost\) \{ display:none !important \}/);
  assert.match(css, /[^-]print-color-adjust:exact/);
  assert.match(css, /-webkit-print-color-adjust:exact/);
  // 가운데 맞춤은 초기 포함 블록 퍼센트로 해요 — Firefox 149 인쇄에서 100vh 는 쪽 영역이 아니어서(«여백: 없음» 에서 6.4 mm 위로 밀림, 실측).
  assert.match(css, /html, body \{ margin:0; padding:0; background:#fff; height:100% \}/);
  assert.match(css, /body \{ display:block; min-height:0 \}/); // 앱 body { display:flex; min-height:100vh; align-items:center } 무력화
  assert.match(css, /#tlPrintHost \{ display:flex; min-height:calc\(100% - 0\.5mm\);/);
  assert.doesNotMatch(css, /\dvh\b/);
  assert.match(css, /#tlPrintHost svg \{ display:block; flex:none; margin:auto; width:197\.3mm; height:283\.8mm \}/);
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
