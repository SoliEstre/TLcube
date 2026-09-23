/**
 * 종이 도안 PDF·PNG 구조(설계 §6-18)예요.
 *
 * PDF 는 파서 없이 앞에서부터 객체를 걸어 xref·trailer·startxref 와 따로 대조해요(test/helpers/pdf-structure.mjs).
 * 콘텐츠는 연산자로 읽어서 «장면의 모든 도형이 제 색으로 정확히 한 번 칠해지나», «같은 면·같은 색 모듈이
 * 채움 하나에 모이나(이음선 없음)», «겹치는 다른 색 도형의 칠 순서가 장면 순서와 같나» 를 성질로 재요.
 * 자 자체는 심은 결함 fixture 로 결함마다 해당 필드가 빨개지는지 확인해요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {encodeH} from '../src/h-codec.js';
import {buildHCubeModel, cubeNetScene} from '../src/cube-export.js';
import {rasterToPng} from '../src/png.js';
import {renderExportPng} from '../src/export-render.js';
import {sceneToPdfSync, sceneToPdf, PT_PER_MM, PDF_CTM_SCALE} from '../src/pdf-writer.js';
import {CSS_PAGE_SIZES_MM} from '../src/print-sheet.js';
import {physicalHCube} from '../src/cube-physical.js';
import {paperPlan, buildPaperSheet, PAPER_SIZES} from '../src/paper-net.js';
import {fullOnly} from './helpers/scope.mjs';
import {
  inspectPdf, structureFailures, pageInfo, streamBytes, inflateStream, applyCtm, dictInt, dictName, dictRef,
  parsePdf, fillReport, cleanFillReport, pointsKey, subpathKey, colorKey, imageHasAlpha,
} from './helpers/pdf-structure.mjs';

const WHITE = {r: 255, g: 255, b: 255}, BLACK = {r: 0, g: 0, b: 0}, GRAY = {r: 128, g: 128, b: 128};
const RED = {r: 200, g: 30, b: 40}, BLUE = {r: 20, g: 60, b: 220};
const A4 = CSS_PAGE_SIZES_MM.A4;
const text = (bytes) => Buffer.from(bytes).toString('latin1');
const rect = (x, y, w, h, color, extra = {}) => ({
  kind: 'polygon', color, points: [{x, y}, {x: x + w, y}, {x: x + w, y: y + h}, {x, y: y + h}], ...extra,
});

/** RGBA 함수로 내장 PNG 면 이미지 자산을 만들어요(scene-image.js 의 자산 규약). */
function pngAsset(width, height, rgba) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) pixels.set(rgba(x, y), (y * width + x) * 4);
  const href = `data:image/png;base64,${Buffer.from(rasterToPng({width, height, pixels})).toString('base64')}`;
  return {width, height, pixels, href};
}

/**
 * 실제 H 모델의 전개도(cubeNetScene, 셀 단위)를 mm 로 옮기고, 종이 도안에 들어가는 면 밖 도형
 * (재단선 띠 · 접기 틱 · 비스듬한 글리프 획 · 스스로 교차하는 획 · 보정 막대 · 겹치는 다른 색 도형 줄)을 더해요.
 * paper-net 의 실제 출력 대신 쓰는 합성 입력이에요 — 이 파일은 PDF 작성기만 재요.
 */
function paperLikeScene({version = 0, mode = 6, tones = 3, paper = A4, margin = 7, images = true} = {}) {
  const encoded = encodeH(Uint8Array.of(7, 1, 9), {version, mode, tones, ecc: 'M', mask: 2, finder: 'frame'});
  const model = buildHCubeModel(encoded, {renderFaces: 6});
  const net = cubeNetScene(model, {margin: 0});
  const pitch = Math.min((paper[0] - 2 * margin) / 3, (paper[1] - 2 * margin - 30) / 4);
  const cell = pitch / model.n;
  const shapes = net.shapes.filter((s) => s.kind === 'polygon').map((s) => ({
    ...s, points: s.points.map((p) => ({x: margin + p.x * cell, y: margin + p.y * cell})),
  }));
  // 면 정사각형(mm)을 모듈 bbox 로 유도해요.
  const squares = new Map();
  for (const s of shapes) {
    const b = squares.get(s.face) ?? [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of s.points) b.splice(0, 4, Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y));
    squares.set(s.face, b);
  }
  const deco = [];
  // 재단선: 이웃 면과 공유하지 않는 변마다 0.2 mm 띠를 면 바깥으로 밀어 놓아요.
  const shared = (x0, y0, x1, y1) => [...squares.values()].filter((b) => b[0] <= x0 + 1e-9 && x1 <= b[2] + 1e-9
    && b[1] <= y0 + 1e-9 && y1 <= b[3] + 1e-9).length > 0;
  for (const [x0, y0, x1, y1] of squares.values()) {
    const eps = 1e-6;
    if (!shared(x0, y0 - eps, x1, y0 - eps)) deco.push(rect(x0, y0 - 0.2, x1 - x0, 0.2, GRAY, {qr: true}));
    if (!shared(x0, y1 + eps, x1, y1 + eps)) deco.push(rect(x0, y1, x1 - x0, 0.2, GRAY, {qr: true}));
    if (!shared(x0 - eps, y0, x0 - eps, y1)) deco.push(rect(x0 - 0.2, y0, 0.2, y1 - y0, GRAY, {qr: true}));
    if (!shared(x1 + eps, y0, x1 + eps, y1)) deco.push(rect(x1, y0, 0.2, y1 - y0, GRAY, {qr: true}));
  }
  const bottom = margin + 4 * pitch + 6;
  // 보정 막대 + 10 mm 틱(막대와 겹치는 같은 색).
  deco.push(rect(margin, bottom, 50, 0.3, BLACK, {qr: true}));
  for (let k = 0; k <= 5; k += 1) deco.push(rect(margin + k * 10 - 0.15, bottom - 1.5, 0.3, 1.8, BLACK, {qr: true}));
  // 비스듬한 글리프 획(단순 평행사변형)과 스스로 교차하는 획(나비넥타이)이에요.
  deco.push({kind: 'polygon', color: BLACK, qr: true, points: [{x: 60, y: bottom}, {x: 60.3, y: bottom}, {x: 62.3, y: bottom + 4}, {x: 62, y: bottom + 4}]});
  deco.push({kind: 'polygon', color: BLACK, qr: true, points: [{x: 64, y: bottom}, {x: 66, y: bottom + 3}, {x: 66, y: bottom}, {x: 64, y: bottom + 3}]});
  // 겹치는 다른 색 줄: A(검정) → B(빨강, A 와 겹침) → C(검정, B 와 겹침) → D(흰색, C 와 겹침) → E(흰색, 떨어져 있음).
  const x = 70;
  deco.push(rect(x, bottom, 6, 3, BLACK, {tag: 'A'}), rect(x + 4, bottom + 1, 6, 3, RED, {tag: 'B'}),
    rect(x + 8, bottom + 2, 6, 3, BLACK, {tag: 'C'}), rect(x + 12, bottom + 3, 6, 3, WHITE, {tag: 'D'}),
    rect(x + 22, bottom, 3, 3, WHITE, {tag: 'E'}), {kind: 'disc', color: BLUE, cx: x + 30, cy: bottom + 2, r: 1.5});
  // 겹치는 같은 색 삼각형 둘(입력 방향이 서로 반대). 한 채움으로 합쳐지면 방향을 맞춰야 겹친 곳이 구멍 나지 않아요.
  deco.push({kind: 'polygon', color: BLUE, tag: 'T1', points: [{x: 118, y: bottom}, {x: 124, y: bottom}, {x: 118, y: bottom + 5}]},
    {kind: 'polygon', color: BLUE, tag: 'T2', points: [{x: 119, y: bottom + 1}, {x: 119, y: bottom + 6}, {x: 125, y: bottom + 1}]});
  const out = {width: paper[0], height: paper[1], unit: 'mm', background: WHITE, shapes: [...shapes, ...deco]};
  if (images) {
    // 빈 면 위 이미지 둘: 알파 있는 것(회전된 사각형)과 불투명한 것. 같은 자산을 한 번 더 써서 중복 제거도 재요.
    const alphaAsset = pngAsset(8, 6, (px, py) => [px * 30, py * 40, 90, (px + py) % 3 === 0 ? 0 : 160 + px * 10]);
    const opaqueAsset = pngAsset(5, 7, (px, py) => [200 - px * 20, 40 + py * 20, 10 * px, 255]);
    const [zx0, zy0, zx1, zy1] = squares.get('ZP');
    // 90° 돌린 배치: TL 이 왼쪽 아래, TR 이 왼쪽 위예요.
    out.shapes.push({kind: 'image', face: 'ZP', image: alphaAsset, color: WHITE,
      points: [{x: zx0, y: zy1}, {x: zx0, y: zy0}, {x: zx1, y: zy0}, {x: zx1, y: zy1}]});
    const [yx0, yy0, yx1, yy1] = squares.get('YP');
    out.shapes.push({kind: 'image', face: 'YP', image: opaqueAsset, color: WHITE, gain: 0.8,
      points: [{x: yx0, y: yy0}, {x: yx1, y: yy0}, {x: yx1, y: yy1}, {x: yx0, y: yy1}]});
    out.shapes.push({kind: 'image', image: alphaAsset, color: WHITE,
      points: [{x: 106, y: bottom}, {x: 114, y: bottom}, {x: 114, y: bottom + 6}, {x: 106, y: bottom + 6}]});
  }
  return {scene: out, model};
}


// ─────────────────────────────────────────────────────────────────────────────
// 구조
// ─────────────────────────────────────────────────────────────────────────────

const REAL = paperLikeScene();

test('§6-18 PDF 구조: 헤더 이진 주석 · 객체 걷기 · /Length · xref 20 B 오프셋 · trailer · startxref 가 모두 맞아요', () => {
  const pdf = sceneToPdfSync(REAL.scene);
  const report = inspectPdf(pdf);
  assert.deepEqual(structureFailures(report), [], report.errors.join('\n'));
  assert.ok(text(pdf).startsWith('%PDF-1.4\n%'));
  const info = pageInfo(report);
  assert.equal(info.count, 1);
  assert.equal(info.parent, dictRef(info.catalog.dict, 'Pages'));
  assert.deepEqual(info.mediaBox, ['0', '0', '595.276', '841.890']);
  // xref 항목 수 = 걸은 객체 수 + 1, 모든 항목 20 B.
  assert.equal(report.xrefEntries.length, report.objects.size + 1);
  const xrefText = text(pdf).slice(report.startxref);
  const entryLines = xrefText.split('\n').slice(2, 2 + report.xrefEntries.length);
  assert.ok(entryLines.every((l) => `${l}\n`.length === 20));
});

test('§6-18 자 검증: 심은 결함마다 해당 구조 필드가 빨개져요', () => {
  const pdf = sceneToPdfSync({width: 30, height: 20, unit: 'mm', background: WHITE, shapes: [rect(2, 2, 5, 5, BLACK)]});
  const s = text(pdf);
  const base = inspectPdf(pdf);
  assert.deepEqual(structureFailures(base), []);
  const mutate = (fn) => inspectPdf(new Uint8Array(Buffer.from(fn(s), 'latin1')));
  const xrefAt = base.startxref;
  const entryAt = (num) => xrefAt + s.slice(xrefAt).indexOf('\n', 5) + 1 + num * 20;

  // (1) 객체 3 의 xref 오프셋 +1
  let r = mutate((t) => {
    const at = entryAt(3), off = Number(t.slice(at, at + 10)) + 1;
    return t.slice(0, at) + String(off).padStart(10, '0') + t.slice(at + 10);
  });
  assert.deepEqual(structureFailures(r), ['xrefOffsetsOk']);
  // (2) startxref 값 +1
  r = mutate((t) => t.replace(/startxref\n(\d+)\n/, (_, v) => `startxref\n${Number(v) + 1}\n`));
  assert.deepEqual(structureFailures(r), ['startxrefOk']);
  // (3) 콘텐츠 /Length 를 자릿수 그대로 1 어긋나게
  r = mutate((t) => t.replace(/\/Length (\d+)/, (_, v) => `/Length ${v.endsWith('9') ? Number(v) - 1 : Number(v) + 1}`));
  assert.deepEqual(structureFailures(r), ['lengthsOk']);
  // (4) 이진 표시 주석을 ASCII 로(길이 유지)
  r = mutate((t) => t.replace(/^(%PDF-1\.4\n%)..../, '$1abcd'));
  assert.deepEqual(structureFailures(r), ['binaryCommentOk']);
  // (5) xref 항목 하나를 19 B 로(«n \n» → «n\n»)
  r = mutate((t) => {
    const at = entryAt(2);
    return t.slice(0, at + 17) + 'n\n' + t.slice(at + 20);
  });
  assert.ok(structureFailures(r).includes('xrefEntryBytesOk'));
  assert.ok(r.walkOk && r.lengthsOk && r.headerOk && r.startxrefOk);
  // (6) xref 에 없는 객체를 끼우고 startxref 를 맞춰 줘요
  r = mutate((t) => {
    const extra = '99 0 obj\n<< >>\nendobj\n';
    const out = t.slice(0, xrefAt) + extra + t.slice(xrefAt);
    return out.replace(/startxref\n(\d+)\n/, `startxref\n${xrefAt + extra.length}\n`);
  });
  assert.deepEqual(r.unlistedObjects, [99]);
  assert.ok(structureFailures(r).includes('unlistedObjects'));
  // (7) trailer /Size +1
  r = mutate((t) => t.replace(/\/Size (\d+)/, (_, v) => `/Size ${Number(v) + 1}`));
  assert.deepEqual(structureFailures(r), ['trailerSizeOk']);
});

test('§6-18 MediaBox 는 pt = mm·72/25.4 (소수 3자리)이고, cm 은 mm · y 아래 1:1 이에요', () => {
  for (const [name, [w, h]] of Object.entries(CSS_PAGE_SIZES_MM)) {
    const pdf = sceneToPdfSync({width: w, height: h, unit: 'mm', background: WHITE, shapes: [rect(10, 10, 5, 5, BLACK)]});
    const {info, tokens} = parsePdf(pdf);
    const box = info.mediaBox;
    assert.ok(box.slice(2).every((v) => /^\d+\.\d{3}$/.test(v)), name);
    assert.ok(Math.abs(Number(box[2]) - w * PT_PER_MM) <= 5e-4 && Math.abs(Number(box[3]) - h * PT_PER_MM) <= 5e-4, name);
    const [q, cm] = tokens.ops;
    assert.equal(q.op, 'q');
    assert.equal(cm.op, 'cm');
    assert.deepEqual(cm.args, [Number(PDF_CTM_SCALE), 0, 0, -Number(PDF_CTM_SCALE), 0, Number(box[3])], name);
    // 장면 (0,0) → 쪽 왼쪽 위, (W,H) → 오른쪽 아래(0.01 pt 안).
    const topLeft = applyCtm(cm.args, 0, 0), bottomRight = applyCtm(cm.args, w, h);
    assert.ok(Math.abs(topLeft[0]) < 1e-9 && Math.abs(topLeft[1] - Number(box[3])) < 1e-9, name);
    assert.ok(Math.abs(bottomRight[0] - Number(box[2])) < 0.01 && Math.abs(bottomRight[1]) < 0.01, name);
  }
  const letter = inspectPdf(sceneToPdfSync({width: 215.9, height: 279.4, background: null, shapes: []}));
  assert.deepEqual(pageInfo(letter).mediaBox, ['0', '0', '612.000', '792.000']);
  // 쪽 크기를 따로 주면 장면은 왼쪽 위에 1:1 로 놓여요.
  const small = parsePdf(sceneToPdfSync({width: 100, height: 50, background: WHITE, shapes: []}, {widthMm: 210, heightMm: 297}));
  assert.deepEqual(small.info.mediaBox, ['0', '0', '595.276', '841.890']);
});

// ─────────────────────────────────────────────────────────────────────────────
// 콘텐츠
// ─────────────────────────────────────────────────────────────────────────────

test('§6-18 콘텐츠: 모든 도형이 제 색으로 한 번씩 · 같은 면 같은 색은 f 한 번 · 겹치는 다른 색은 장면 순서예요', () => {
  const {scene} = REAL;
  const parsed = parsePdf(sceneToPdfSync(scene));
  assert.deepEqual(parsed.unknownOps, []);
  assert.equal(parsed.qDepth, 0);
  assert.equal(parsed.danglingSubpaths, 0);
  const r = fillReport(scene, parsed.events);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.unmatched, []);
  assert.deepEqual(r.colorMismatch, []);
  assert.deepEqual(r.split, []);
  assert.deepEqual(r.orderViolations, []);
  assert.deepEqual(r.orientationMixed, []);
  assert.ok(r.imageCountOk);
  // 반대 방향으로 들어온 겹치는 같은 색 삼각형은 한 채움에 같은 방향으로 들어가요.
  const triFill = (tag) => {
    const s = scene.shapes.find((x) => x.tag === tag);
    return parsed.events.findIndex((ev) => ev.type === 'fill' && ev.subpaths.some((sp) => subpathKey(sp) === pointsKey(s.points)));
  };
  assert.equal(triFill('T1'), triFill('T2'));
  // 모듈 수보다 채움이 훨씬 적어요(색별 묶기가 실제로 일어나요).
  const modules = scene.shapes.filter((s) => s.face && s.kind === 'polygon').length;
  const faceColors = new Set(scene.shapes.filter((s) => s.face && s.kind === 'polygon').map((s) => `${s.face}|${colorKey(s.color)}`)).size;
  assert.ok(r.fills < modules / 20, `채움 ${r.fills} · 모듈 ${modules}`);
  assert.ok(r.fills <= faceColors + scene.shapes.filter((s) => !s.face).length + 2);
  // 겹치는 줄: C(검정)는 B(빨강) 뒤에, D(흰색)는 C 뒤에 따로 칠해져요.
  // 떨어진 E(흰색)는 새 채움을 열지 않고 가장 최근 흰 채움(D 의 채움)에 합류해요.
  const fillOf = (tag) => {
    const s = scene.shapes.find((x) => x.tag === tag);
    return parsed.events.findIndex((ev) => ev.type === 'fill' && ev.subpaths.some((sp) => subpathKey(sp) === pointsKey(s.points)));
  };
  assert.ok(fillOf('A') < fillOf('B') && fillOf('B') < fillOf('C') && fillOf('C') < fillOf('D'));
  assert.equal(fillOf('E'), fillOf('D'));
  assert.ok(fillOf('D') > 0, '흰 D 가 배경 채움으로 끌어올려지면 C 아래로 숨어요');
});

test('§6-18 자 검증: 채움 대조 자는 쪼개기 · 빠뜨리기 · 색 바꾸기 · 순서 뒤집기를 결함마다 잡아요', () => {
  const {scene} = REAL;
  const {events} = parsePdf(sceneToPdfSync(scene));
  const clone = () => events.map((e) => (e.type === 'fill' ? {...e, subpaths: [...e.subpaths]} : {...e}));
  assert.ok(cleanFillReport(fillReport(scene, events)));
  const moduleKeys = new Map(scene.shapes.filter((s) => s.face && s.kind === 'polygon').map((s) => [pointsKey(s.points), s]));
  const moduleFill = events.findIndex((e) => e.type === 'fill' && e.subpaths.filter((sp) => moduleKeys.has(subpathKey(sp))).length > 4);
  assert.ok(moduleFill >= 0);

  // (a) 같은 면·색 모듈 하나를 떼어 바로 뒤 채움으로 → split
  let ev = clone();
  const target = ev[moduleFill].subpaths.findLast((sp) => moduleKeys.has(subpathKey(sp)));
  ev[moduleFill].subpaths = ev[moduleFill].subpaths.filter((sp) => sp !== target);
  ev.splice(moduleFill + 1, 0, {...ev[moduleFill], subpaths: [target]});
  let r = fillReport(scene, ev);
  assert.equal(r.split.length, 1);
  assert.deepEqual([r.missing.length, r.unmatched.length, r.colorMismatch.length], [0, 0, 0]);
  // (b) 부분경로 하나 빠뜨리기 → missing
  ev = clone();
  ev[moduleFill].subpaths.pop();
  r = fillReport(scene, ev);
  assert.equal(r.missing.length, 1);
  assert.deepEqual([r.unmatched.length, r.colorMismatch.length, r.split.length], [0, 0, 0]);
  // (c) 모듈 채움 색 바꾸기 → colorMismatch
  ev = clone();
  ev[moduleFill] = {...ev[moduleFill], color: {r: 1, g: 2, b: 3, raw: [1 / 255, 2 / 255, 3 / 255]}};
  r = fillReport(scene, ev);
  assert.ok(r.colorMismatch.length > 4);
  // (d) 겹치는 B(빨강) 와 C(검정 둘째 묶음) 채움 순서 뒤집기 → orderViolations
  ev = clone();
  const idx = (tag) => {
    const s = scene.shapes.find((x) => x.tag === tag);
    return ev.findIndex((e) => e.type === 'fill' && e.subpaths.some((sp) => subpathKey(sp) === pointsKey(s.points)));
  };
  const b = idx('B'), c = idx('C');
  [ev[b], ev[c]] = [ev[c], ev[b]];
  r = fillReport(scene, ev);
  assert.ok(r.orderViolations.length >= 1);
  assert.deepEqual([r.missing.length, r.unmatched.length, r.colorMismatch.length], [0, 0, 0]);
  // (e) 합쳐진 삼각형 하나의 방향을 뒤집기 → orientationMixed
  ev = clone();
  const t = idx('T1');
  ev[t].subpaths = ev[t].subpaths.map((sp, k) => (k === 0 ? {...sp, pts: [...sp.pts].reverse()} : sp));
  r = fillReport(scene, ev);
  assert.deepEqual(r.orientationMixed, [t]);
  assert.deepEqual([r.missing.length, r.unmatched.length, r.orderViolations.length], [0, 0, 0]);
});

test('§6-18 색 표기: 0..255 전부가 rg 4자리에서 제 값으로 돌아와요', () => {
  const shapes = [];
  for (let v = 0; v < 256; v += 1) shapes.push(rect((v % 16) * 2, Math.floor(v / 16) * 2, 1, 1, {r: v, g: 255 - v, b: (v * 7) % 256}));
  const scene = {width: 40, height: 40, background: null, shapes};
  const {events} = parsePdf(sceneToPdfSync(scene));
  assert.equal(events.length, 256);
  const r = fillReport(scene, events);
  assert.deepEqual(r.colorMismatch, []);
  assert.deepEqual(r.missing, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// 면 이미지
// ─────────────────────────────────────────────────────────────────────────────

test('§6-18 면 이미지: 이미지가 있을 때만 XObject, 알파가 있을 때만 SMask · 풀면 원본 픽셀이에요', () => {
  const {scene} = REAL;
  const {report, info, events} = parsePdf(sceneToPdfSync(scene));
  const imageShapes = scene.shapes.filter((s) => s.kind === 'image');
  // 같은 자산·같은 gain 은 XObject 하나(3 도형 → 2 XObject).
  assert.equal(info.xobjects.size, 2);
  const doNames = events.filter((e) => e.type === 'image').map((e) => e.name);
  assert.equal(doNames.length, imageShapes.length);
  assert.deepEqual(doNames, ['Im0', 'Im1', 'Im0']);
  imageShapes.forEach((shape, k) => {
    const num = info.xobjects.get(doNames[k]);
    const obj = report.objects.get(num);
    assert.equal(dictName(obj.dict, 'Subtype'), 'Image');
    assert.equal(dictName(obj.dict, 'ColorSpace'), 'DeviceRGB');
    assert.equal(dictInt(obj.dict, 'Width'), shape.image.width);
    assert.equal(dictInt(obj.dict, 'Height'), shape.image.height);
    const gain = shape.gain ?? 1;
    const rgb = inflateStream(report, num);
    const want = new Uint8Array(shape.image.width * shape.image.height * 3);
    for (let p = 0; p < shape.image.width * shape.image.height; p += 1) {
      for (let c = 0; c < 3; c += 1) want[p * 3 + c] = Math.round(shape.image.pixels[p * 4 + c] * gain);
    }
    assert.deepEqual(rgb, want);
    const smask = dictRef(obj.dict, 'SMask');
    if (imageHasAlpha(shape.image)) {
      const m = report.objects.get(smask);
      assert.equal(dictName(m.dict, 'ColorSpace'), 'DeviceGray');
      assert.deepEqual([dictInt(m.dict, 'Width'), dictInt(m.dict, 'Height')], [shape.image.width, shape.image.height]);
      assert.deepEqual(inflateStream(report, smask), Uint8Array.from({length: shape.image.width * shape.image.height}, (_, p) => shape.image.pixels[p * 4 + 3]));
    } else {
      assert.equal(smask, null);
    }
  });
  // 이미지가 없으면 XObject·SMask·/Subtype /Image 가 아예 없어요.
  const plain = paperLikeScene({images: false}).scene;
  const pr = parsePdf(sceneToPdfSync(plain));
  assert.equal(pr.info.xobjects.size, 0);
  assert.ok(![...pr.report.objects.values()].some((o) => /\/Subtype \/Image|\/SMask/.test(o.dict)));
  assert.match(pr.info.page.dict, /\/Resources << >>/);
});

test('§6-18 면 이미지 배치: 단위 정사각형 네 모서리가 TL·TR·BR·BL 로 가요(뒤집힘 없음, 90° 돌린 배치 포함)', () => {
  const {scene} = REAL;
  const {info, events} = parsePdf(sceneToPdfSync(scene));
  const heightPt = Number(info.mediaBox[3]);
  const toPage = (p) => [p.x * PT_PER_MM, heightPt - p.y * PT_PER_MM];
  const imageEvents = events.filter((e) => e.type === 'image');
  scene.shapes.filter((s) => s.kind === 'image').forEach((shape, k) => {
    const m = imageEvents[k].ctm;
    // 이미지 공간: 첫 행(위)이 y=1 이에요. (0,1)=TL · (1,1)=TR · (1,0)=BR · (0,0)=BL.
    [[0, 1], [1, 1], [1, 0], [0, 0]].forEach(([u, v], c) => {
      const got = applyCtm(m, u, v), want = toPage(shape.points[c]);
      assert.ok(Math.abs(got[0] - want[0]) < 2e-3 && Math.abs(got[1] - want[1]) < 2e-3, `이미지 ${k} 모서리 ${c}: ${got} ≠ ${want}`);
    });
    // 뒤집히지 않았어요: 이미지 → 쪽 행렬식의 부호가 쪽의 y 위 좌표에서 «장면 사각형의 방향» 과 같아요.
    const det = m[0] * m[3] - m[1] * m[2];
    const [a, b, , d] = shape.points;
    const sceneDet = (b.x - a.x) * (a.y - d.y) - (b.y - a.y) * (a.x - d.x);
    assert.equal(Math.sign(det), -Math.sign(sceneDet));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 압축 · 결정성
// ─────────────────────────────────────────────────────────────────────────────

/** 생성자에서 던지는 스텁 · 스트림 도중 실패하는 스텁 · zlib 이 아닌 바이트를 내는 스텁이에요. */
class ThrowingStream {
  constructor() {
    throw new TypeError('deflate 미지원');
  }
}
class FailingStream {
  constructor() {
    const ts = new TransformStream({transform(_chunk, controller) {
      controller.error(new Error('스트림 도중 실패'));
    }});
    this.writable = ts.writable;
    this.readable = ts.readable;
  }
}
class GarbageStream {
  constructor() {
    const ts = new TransformStream({transform(_chunk, controller) {
      controller.enqueue(Uint8Array.of(1, 2, 3, 4, 5, 6, 7));
    }});
    this.writable = ts.writable;
    this.readable = ts.readable;
  }
}

test('§6-18 압축: 동기는 결정적이고, 비동기(CompressionStream)도 풀면 같은 원문 · 실패하면 동기와 바이트 동일해요', async () => {
  const {scene} = REAL;
  const sync = sceneToPdfSync(scene);
  assert.deepEqual(sceneToPdfSync(scene), sync);
  const native = await sceneToPdf(scene);
  const ns = inspectPdf(native), ss = inspectPdf(sync);
  assert.deepEqual(structureFailures(ns), [], ns.errors.join('\n'));
  assert.equal(ns.objects.size, ss.objects.size);
  for (const [num, o] of ss.objects) {
    if (!o.stream) {
      assert.equal(ns.objects.get(num).dict, o.dict);
      continue;
    }
    // 스트림 원문이 같아요(압축기만 달라요).
    assert.deepEqual(inflateStream(ns, num), inflateStream(ss, num), `객체 ${num}`);
  }
  assert.ok(native.length < sync.length, `네이티브 deflate 가 더 작아야 해요: ${native.length} vs ${sync.length}`);
  for (const stub of [null, ThrowingStream, FailingStream, GarbageStream]) {
    assert.deepEqual(await sceneToPdf(scene, {compressionStream: stub}), sync, String(stub?.name));
  }
  // 동기 경로의 zlib 스트림은 Node zlib 으로 풀려요(= FlateDecode 유효).
  const info = pageInfo(ss);
  assert.doesNotThrow(() => inflateSync(streamBytes(ss, info.contents)));
});

// ─────────────────────────────────────────────────────────────────────────────
// 입력 거부
// ─────────────────────────────────────────────────────────────────────────────

test('§6-18 입력 거부: mm 아닌 단위 · 음영 · 원근 이미지 · 쪽보다 큰 장면 · 모르는 도형 · 색 없음', async () => {
  const base = {width: 50, height: 50, background: WHITE, shapes: []};
  assert.throws(() => sceneToPdfSync({...base, unit: 'px'}), RangeError);
  assert.throws(() => sceneToPdfSync({...base, shading: [{}]}), RangeError);
  assert.throws(() => sceneToPdfSync(base, {widthMm: 40}), RangeError);
  assert.throws(() => sceneToPdfSync({...base, shapes: [{kind: 'text', color: BLACK}]}), RangeError);
  assert.throws(() => sceneToPdfSync({...base, shapes: [{kind: 'polygon', color: null, points: []}]}), TypeError);
  assert.throws(() => sceneToPdfSync({...base, shapes: [rect(1, 1, 2, 2, {r: 1.5, g: 0, b: 0})]}), TypeError);
  const asset = pngAsset(2, 2, () => [10, 20, 30, 255]);
  const perspective = {kind: 'image', image: asset, color: WHITE,
    points: [{x: 0, y: 0}, {x: 10, y: 0}, {x: 8, y: 10}, {x: 2, y: 10}]};
  assert.throws(() => sceneToPdfSync({...base, shapes: [perspective]}), RangeError);
  await assert.rejects(sceneToPdf({...base, unit: 'px'}), RangeError);
  // 점 두 개 이하 다각형은 칠할 넓이가 없어서 건너뛰어요(SVG 도 아무것도 안 그려요).
  const {events} = parsePdf(sceneToPdfSync({...base, shapes: [{kind: 'polygon', color: BLACK, points: [{x: 1, y: 1}, {x: 2, y: 2}]}]}));
  assert.equal(events.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// PNG (같은 mm 장면, 300 dpi)
// ─────────────────────────────────────────────────────────────────────────────

function pngChunks(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out = new Map();
  for (let p = 8; p < png.length;) {
    const len = view.getUint32(p), type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    out.set(type, png.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  return out;
}
function paperPng(widthMm, heightMm) {
  const ppu = 300 / 25.4;
  const scene = {width: widthMm, height: heightMm, unit: 'mm', background: WHITE, shapes: [rect(7, 7, 50, 0.3, BLACK)]};
  const png = renderExportPng(scene, {ppu, width: Math.round(widthMm * ppu), height: Math.round(heightMm * ppu), ppi: 300, supersample: 1});
  const chunks = pngChunks(png);
  const ihdr = new DataView(chunks.get('IHDR').buffer, chunks.get('IHDR').byteOffset);
  const phys = new DataView(chunks.get('pHYs').buffer, chunks.get('pHYs').byteOffset);
  return {width: ihdr.getUint32(0), height: ihdr.getUint32(4), ppmX: phys.getUint32(0), ppmY: phys.getUint32(4), unit: chunks.get('pHYs')[8]};
}
const pngPhysicalOk = ({width, height, ppmX, ppmY, unit}, widthMm, heightMm) => unit === 1
  && Math.abs((width / ppmX) * 1000 - widthMm) <= 0.5 / ppmX * 1000 + 1e-9
  && Math.abs((height / ppmY) * 1000 - heightMm) <= 0.5 / ppmY * 1000 + 1e-9;

test('§6-18 PNG: A4 300 dpi 는 2480 × 3508 이고 pHYs 11 811 ppm 로 실제 크기가 반 픽셀 안이에요', () => {
  const a4 = paperPng(...A4);
  assert.deepEqual(a4, {width: 2480, height: 3508, ppmX: 11811, ppmY: 11811, unit: 1});
  assert.ok(pngPhysicalOk(a4, ...A4));
  // 자 검증: 한 픽셀 모자란 폭은 실제 크기 자가 거부해요.
  assert.equal(pngPhysicalOk({...a4, width: a4.width - 1}, ...A4), false);
});

fullOnly(() => test('§6-18 PNG 배터리: CSS 용지 키워드 전부가 300 dpi 에서 실제 크기 반 픽셀 안이에요', () => {
  for (const [name, [w, h]] of Object.entries(CSS_PAGE_SIZES_MM)) {
    assert.ok(pngPhysicalOk(paperPng(w, h), w, h), name);
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// 배터리
// ─────────────────────────────────────────────────────────────────────────────

fullOnly(() => test('§6-18 배터리: H0·H2·H8 × 2·3톤 × 용지 셋에서 구조 · 채움 대조가 모두 깨끗해요', () => {
  for (const version of [0, 2, 8]) {
    for (const tones of [2, 3]) {
      for (const paper of [CSS_PAGE_SIZES_MM.A5, A4, CSS_PAGE_SIZES_MM.A3]) {
        const {scene} = paperLikeScene({version, tones, paper});
        const pdf = sceneToPdfSync(scene);
        const parsed = parsePdf(pdf);
        const label = `H${version} ${tones}톤 ${paper.join('×')}`;
        assert.deepEqual(structureFailures(parsed.report), [], label);
        const r = fillReport(scene, parsed.events);
        assert.ok(cleanFillReport(r), `${label}: ${JSON.stringify({...r, fills: undefined}).slice(0, 400)}`);
      }
    }
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// 실제 종이 도안(paper-net) 계약
// ─────────────────────────────────────────────────────────────────────────────

/** 빈 면 이미지(알파 있음)를 실은 실제 H 큐브 → 물리 큐브 → 종이 도안 장면. */
function realPaperScene({version = 0, mode = 3, tones = 3, method, thicknessMm, paper = 'A4'}) {
  const encoded = encodeH(Uint8Array.of(7, 1, 9), {version, mode, tones, ecc: 'M', mask: 2, finder: 'frame'});
  const image = pngAsset(12, 9, (x, y) => [x * 20, y * 25, 120, x < 3 ? 0 : 220]);
  const faceImages = Object.fromEntries(['ZM', 'XM', 'YM', 'ZP', 'XP', 'YP'].map((face) => [face, image]));
  const phys = physicalHCube(buildHCubeModel(encoded, {renderFaces: mode === 6 ? 6 : 3, faceImages}));
  const plan = paperPlan(phys, {paper, thicknessMm, method});
  return buildPaperSheet(phys, plan);
}

test('§6-18 계약: 실제 종이 도안(한 장 · 감싸기 · 판 조각)이 PDF 구조 · 채움 대조를 모두 통과해요', () => {
  for (const [method, thicknessMm] of [['sheet', 0.1], ['skin', 3.2], ['board', 1.0]]) {
    const scene = realPaperScene({method, thicknessMm});
    const images = scene.shapes.filter((s) => s.kind === 'image').length;
    assert.ok(images > 0, `${method}: 빈 면 이미지가 도안에 없어요`);
    const parsed = parsePdf(sceneToPdfSync(scene));
    assert.deepEqual(structureFailures(parsed.report), [], method);
    assert.deepEqual(pageInfo(parsed.report).mediaBox, ['0', '0', '595.276', '841.890'], method);
    const r = fillReport(scene, parsed.events);
    assert.ok(cleanFillReport(r), `${method}: ${JSON.stringify({...r, fills: undefined}).slice(0, 400)}`);
    assert.equal(parsed.events.filter((e) => e.type === 'image').length, images, method);
    assert.deepEqual(parsed.unknownOps, [], method);
  }
});

fullOnly(() => test('§6-18 계약 배터리: H0·H8 × 방식 셋 × 용지 8종 — 도안이 나오는 조합은 모두 깨끗해요', () => {
  let built = 0;
  for (const [version, mode] of [[0, 3], [8, 6]]) {
    for (const [method, thicknessMm] of [['sheet', 0.3], ['skin', 1.6], ['board', 1.0]]) {
      for (const {id} of PAPER_SIZES) {
        let scene;
        try {
          scene = realPaperScene({version, mode, method, thicknessMm, paper: id});
        } catch (error) {
          // 모듈 하한 등 설계상 거부는 TLP_ 코드로만 나와요.
          assert.match(String(error.code), /^TLP_/, `${version}/${method}/${id}: ${error.message}`);
          continue;
        }
        built += 1;
        const parsed = parsePdf(sceneToPdfSync(scene));
        assert.deepEqual(structureFailures(parsed.report), [], `${version}/${method}/${id}`);
        assert.ok(cleanFillReport(fillReport(scene, parsed.events)), `${version}/${method}/${id}`);
      }
    }
  }
  assert.ok(built >= 30, `도안이 나온 조합이 너무 적어요: ${built}`);
}));
