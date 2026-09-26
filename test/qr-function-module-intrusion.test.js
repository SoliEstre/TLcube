// qr-function-module-intrusion.test.js — 꾸민 코너 QR 의 어두운 조각이 밝은 기능 모듈을 침범하지 않는다
// (제품 원칙 2 «검출 요소는 꾸미지 않는다» · DESIGN_001 §4.1 «세 호스트가 같은 규칙», 2026-09-26 외부 검토
// grok·agy 공통 major).
//
// 결함 기전: 역할 콜백이 밝은 기능 모듈(분리자 · 파인더 흰 고리 · 타이밍 흰 칸 · 밝은 포맷 비트)을 null(빈 칸)로
// 넘기면 `styledGridShapes` 의 liquid 오목 필렛이 그 칸 모서리를 이웃 데이터 색으로 칠한다. v1 에서 실제로 닿는
// 자리는 포맷 (8,8)(직교 이웃 (8,9)·(9,8) + 대각 (9,9)가 데이터)과 포맷 (8,13)((8,12)·(9,13) + (9,12)) 이다.
// 수정 전 O/A/K(scene.js pushQrBlock) · Y(sceneY 코너)는 그 규칙이었고 H(hStyledQrPieces)만 막았다.
//
// 재는 성질(값이 아니라 기하):
//   ① 세 호스트(oak = A · y = Y 2.5D · h = H 코너) × 9 스타일 × 페이로드 8 개에서, deco 어두운 색(dark · eye)
//      조각 다각형과 **밝은 기능 모듈 정사각형의 교집합 면적이 0** 이다(중심 표본이 아니라 다각형 클리핑).
//   ② 자의 좌표틀 전제: 어두운 기능 모듈마다 그 모듈 정사각형과 꼭짓점이 같은 조각이 정확히 하나 있다
//      (방향 · 원점 · 모듈 크기가 틀리면 여기서 빨개진다 — 비대칭인 dark module (8,13) 포함).
//   ③ 판별력(심은 결함 — 영구): 같은 페이로드를 옛 규칙(밝은 모듈 null — `qrModuleRole`)으로 펴면 ①의 측정이
//      fixture 가 적은 모듈에서 양수다. 이게 0 이면 fixture 가 결함 자리에 못 닿은 것이라 ①의 초록은 무의미하다.
//   ④ liquid 가 실제로 오목 필렛을 만든다(밝은 데이터 모듈 위 조각 > 0) — «필렛이 아예 없어서 초록» 을 막는다.
// fixture 페이로드는 수정 전 코드에서 침범이 실제로 일어나는 입력을 3000 개 문구 탐색으로 찾은 것이다
// ((8,8): 144/3000, (8,13): 62/3000). 제품 문구(TL_READER_URL 계열)는 침범이 없지만 성질 대상으로 같이 잰다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { encodeY } from '../src/encodeY.js';
import { buildSceneY } from '../src/sceneY.js';
import { encodeH } from '../src/h-codec.js';
import { buildHScene } from '../src/h-render.js';
import { withHCornerQr, hStyledQrPieces } from '../src/generator-h-qr.js';
import { getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { qrMatrix, TL_READER_URL, tlReaderUrlWithHint } from '../src/qr.js';
import { resolveQrDeco, QR_COLOR_MODES, QR_EYE_MODES } from '../src/qr-colors.js';
import { SQUARE_CELL_STYLES, styledGridShapes } from '../src/square-cell-style.js';
import {
  qrFunctionMapV1, qrModuleRole, qrModuleColor, qrStyledModulePieces, qrStyledModuleRole,
} from '../src/qr-function-map.js';

const SIZE = 21;
const QUIET = 4;
const FN = qrFunctionMapV1();
const SLATE = getPreset('slate');
const PALETTE_OAK_Y = Object.freeze({
  background: null, levels: SLATE.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
});

/** 수정 전 코드에서 침범이 실제로 일어나는 페이로드와 그 모듈(row,col) — ③이 영구히 재확인한다. */
const INTRUDING = Object.freeze([
  { text: 'P5', at: [8, 8] },
  { text: 'P14', at: [8, 8] },
  { text: 'P20', at: [8, 8] },
  { text: 'P1024', at: [8, 13] },
  { text: 'P1062', at: [8, 13] },
  { text: 'P1067', at: [8, 13] },
]);
const PAYLOADS = Object.freeze([
  ...INTRUDING.map((f) => f.text), TL_READER_URL, tlReaderUrlWithHint('Y'),
]);

// ── 독립 기하 도구 ─────────────────────────────────────────────────────────────

function polygonArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return Math.abs(s) / 2;
}

/** Sutherland–Hodgman: 임의(오목 포함) 다각형을 축 정렬 사각(볼록)으로 자른다 — 면적은 정확하다. */
function clipToRect(pts, r) {
  const edges = [
    [(p) => p.x >= r.minX, (a, b) => ({ x: r.minX, y: a.y + ((b.y - a.y) * (r.minX - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= r.maxX, (a, b) => ({ x: r.maxX, y: a.y + ((b.y - a.y) * (r.maxX - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= r.minY, (a, b) => ({ x: a.x + ((b.x - a.x) * (r.minY - a.y)) / (b.y - a.y), y: r.minY })],
    [(p) => p.y <= r.maxY, (a, b) => ({ x: a.x + ((b.x - a.x) * (r.maxY - a.y)) / (b.y - a.y), y: r.maxY })],
  ];
  let out = pts;
  for (const [inside, cut] of edges) {
    if (out.length === 0) break;
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i += 1) {
      const cur = src[i];
      const prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
  }
  return out;
}

const sameRgb = (a, b) => !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
const centroid = (s) => s.points.reduce((a, q) => ({ x: a.x + q.x / s.points.length, y: a.y + q.y / s.points.length }), { x: 0, y: 0 });

/** 좌표틀 {ox, oy, m}(QR 좌상단 모듈 원점 · 모듈 한 변)에서 모듈 (row, col) 정사각형. */
const moduleRect = (g, row, col) => ({
  minX: g.ox + col * g.m, maxX: g.ox + (col + 1) * g.m, minY: g.oy + row * g.m, maxY: g.oy + (row + 1) * g.m,
});

/**
 * 어두운 조각이 밝은 기능 모듈과 겹치는 면적 — 모듈별 합(모듈 면적 비율).
 * @returns {Map<string, number>} 'row,col' → 겹침 면적 / m²  (허용오차 넘는 것만)
 */
function intrusions(qr, g, darkPieces) {
  const out = new Map();
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (!FN.isFunctionModule(col, row) || qr.modules[row * SIZE + col] === 1) continue;
      const rect = moduleRect(g, row, col);
      let a = 0;
      for (const s of darkPieces) {
        const xs = s.points.map((p) => p.x); const ys = s.points.map((p) => p.y);
        if (Math.max(...xs) <= rect.minX || Math.min(...xs) >= rect.maxX
          || Math.max(...ys) <= rect.minY || Math.min(...ys) >= rect.maxY) continue;
        const clipped = clipToRect(s.points, rect);
        if (clipped.length >= 3) a += polygonArea(clipped);
      }
      const ratio = a / (g.m * g.m);
      if (ratio > 1e-9) out.set(`${row},${col}`, ratio);
    }
  }
  return out;
}

/** ② 좌표틀 전제: 어두운 기능 모듈마다 그 정사각형과 꼭짓점이 같은 조각이 정확히 하나. */
function assertFrame(qr, g, darkPieces, label) {
  const tol = g.m * 1e-9;
  const isSquareOf = (s, r) => s.points.length === 4 && s.points.every((p) => (
    (Math.abs(p.x - r.minX) < tol || Math.abs(p.x - r.maxX) < tol)
    && (Math.abs(p.y - r.minY) < tol || Math.abs(p.y - r.maxY) < tol)))
    && Math.abs(polygonArea(s.points) - g.m * g.m) < tol * g.m;
  let n = 0;
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (!FN.isFunctionModule(col, row) || qr.modules[row * SIZE + col] !== 1) continue;
      const rect = moduleRect(g, row, col);
      const hits = darkPieces.filter((s) => isSquareOf(s, rect));
      assert.equal(hits.length, 1, `${label}: 어두운 기능 모듈 (${row},${col}) 사각이 ${hits.length}개 — 자의 좌표틀이 틀렸다`);
      n += 1;
    }
  }
  assert.ok(n > 100, `${label}: 어두운 기능 모듈 수 ${n}`);
}

/** 밝은 데이터 모듈 위(무게중심)의 어두운 조각 수 — liquid 오목 필렛. */
function filletsOnLightData(qr, g, darkPieces) {
  let n = 0;
  for (const s of darkPieces) {
    const c = centroid(s);
    const col = Math.floor((c.x - g.ox) / g.m); const row = Math.floor((c.y - g.oy) / g.m);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) continue;
    if (!FN.isFunctionModule(col, row) && qr.modules[row * SIZE + col] !== 1) n += 1;
  }
  return n;
}

// ── deco · 호스트 ─────────────────────────────────────────────────────────────

const ALLOW_ALL_QR = Object.freeze({
  ROWS: Object.freeze(SQUARE_CELL_STYLES.flatMap((qrCellStyle) => QR_COLOR_MODES.flatMap((qrColorMode) => (
    QR_EYE_MODES.map((eyeMode) => Object.freeze({ table: 'qr', host: 'oak', qrCellStyle, qrColorMode, eyeMode }))
  )))),
});

function decoOf(qrCellStyle) {
  const r = resolveQrDeco({ qrColorMode: 'custom', qrHue: 210, qrSat: 200, qrCellStyle, qrEyeMode: 'darker' },
    SLATE, 'oak', ALLOW_ALL_QR);
  assert.ok(r.deco, `전제: deco 가 안 열렸다 ${qrCellStyle} → ${r.lockReason}`);
  assert.ok(!sameRgb(r.deco.dark, r.deco.eye), '전제: 눈 색이 어두운 색과 달라야 두 색 경로를 모두 잰다');
  for (const lv of SLATE.levels) assert.ok(!sameRgb(lv, r.deco.dark) && !sameRgb(lv, r.deco.eye), '전제: deco 색이 셀 색과 겹친다');
  return r.deco;
}

/** 가장 큰 deco.light 축 정렬 사각 = 콰이어트 패치(태그가 아니라 색 · 기하로 찾는다) → 좌표틀. */
function frameFromPatch(scene, deco) {
  let best = null; let area = 0;
  for (const s of scene.shapes) {
    if (s.kind !== 'polygon' || s.points.length !== 4 || !sameRgb(s.color, deco.light)) continue;
    const xs = s.points.map((p) => p.x); const ys = s.points.map((p) => p.y);
    const r = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const a = (r.maxX - r.minX) * (r.maxY - r.minY);
    if (Math.abs(polygonArea(s.points) - a) > 1e-6 * a) continue; // 축 정렬 사각만
    if (a > area) { area = a; best = r; }
  }
  assert.ok(best, '전제: 코너 QR 콰이어트 패치를 못 찾았다');
  const side = best.maxX - best.minX;
  assert.ok(Math.abs(side - (best.maxY - best.minY)) < 1e-9 * side, '전제: 패치가 정사각이 아니다');
  const m = side / (SIZE + 2 * QUIET);
  return { ox: best.minX + QUIET * m, oy: best.minY + QUIET * m, m, block: best };
}

function darkPiecesIn(scene, deco, block) {
  const inBlock = (p) => p.x >= block.minX && p.x <= block.maxX && p.y >= block.minY && p.y <= block.maxY;
  return scene.shapes.filter((s) => s.kind === 'polygon' && (sameRgb(s.color, deco.dark) || sameRgb(s.color, deco.eye))
    && inBlock(centroid(s)));
}

const ENCODED_A = encodeA('intrusion', { version: 0 });
const ENCODED_Y = encodeY('https://tl.estre.so', { cellSurfaceLayout: 'v0', version: 0, tones: 3, eccLevel: 'M' });
const H_PALETTE = { levels: [{ r: 30, g: 55, b: 80 }, { r: 120, g: 140, b: 160 }, { r: 220, g: 230, b: 240 }], background: { r: 255, g: 255, b: 255 } };
const H_BASE = buildHScene(encodeH('TL', { version: 0, mode: 3, tones: 3, finder: 'frame', ecc: 'M' }),
  { rotateX: 0.06, rotateY: 0.1, rotateZ: 0.03, perspective: 0.18, margin: 2, palette: H_PALETTE, outline: true });

const HOSTS = Object.freeze({
  oak(text, deco) {
    const scene = buildScene(ENCODED_A, { palette: { ...PALETTE_OAK_Y, qrDeco: deco }, qrText: text, qrCorner: 'TL', finderPatternId: 'bullseye' });
    const g = frameFromPatch(scene, deco);
    return { g, dark: darkPiecesIn(scene, deco, g.block) };
  },
  y(text, deco) {
    const scene = buildSceneY(ENCODED_Y, { qrText: text, palette: { ...PALETTE_OAK_Y, qrDeco: deco } });
    const g = frameFromPatch(scene, deco);
    return { g, dark: darkPiecesIn(scene, deco, g.block) };
  },
  h(text, deco) {
    const scene = withHCornerQr(H_BASE, { text, corner: 'BR', deco });
    const g = frameFromPatch(scene, deco);
    // 호스트가 보고한 좌표틀과 색 · 기하로 찾은 좌표틀이 같다(자의 교차 확인).
    const meta = scene.hCornerQr;
    assert.ok(Math.abs(meta.module - g.m) < 1e-9 * g.m && Math.abs(meta.x + meta.quiet * meta.module - g.ox) < 1e-6
      && Math.abs(meta.y + meta.quiet * meta.module - g.oy) < 1e-6, 'H 좌표틀 불일치');
    return { g, dark: darkPiecesIn({ shapes: scene.shapes.slice(H_BASE.shapes.length) }, deco, g.block) };
  },
});

// ── ① ② ④ ────────────────────────────────────────────────────────────────────

describe('① 세 호스트 × 9 스타일 × 페이로드 8 — 어두운 조각 ∩ 밝은 기능 모듈 = 0', () => {
  for (const [host, build] of Object.entries(HOSTS)) {
    test(host, () => {
      let liquidFillets = 0;
      for (const style of SQUARE_CELL_STYLES) {
        const deco = decoOf(style);
        for (const text of PAYLOADS) {
          const qr = qrMatrix(text);
          assert.equal(qr.size, SIZE, `전제: v1 이어야 한다 ${text}`);
          const label = `${host}/${style}/${JSON.stringify(text)}`;
          const { g, dark } = build(text, deco);
          assertFrame(qr, g, dark, label);
          const bad = intrusions(qr, g, dark);
          assert.equal(bad.size, 0, `${label}: 밝은 기능 모듈 침범 ${JSON.stringify([...bad])}`);
          if (style === 'liquid') liquidFillets += filletsOnLightData(qr, g, dark);
        }
      }
      assert.ok(liquidFillets > 0, `${host}: liquid 가 오목 필렛을 하나도 안 만들었다 — «필렛이 없어서 초록» 이다`);
    });
  }
});

// ── ③ 판별력 ─────────────────────────────────────────────────────────────────

describe('③ 판별력 — 옛 규칙(밝은 모듈 null)은 같은 fixture 에서 침범한다', () => {
  const unit = { ox: 0, oy: 0, m: 1 };
  const deco = decoOf('liquid');
  for (const { text, at } of INTRUDING) {
    test(`${text} → (${at.join(',')})`, () => {
      const qr = qrMatrix(text);
      const old = styledGridShapes({
        rows: SIZE, cols: SIZE, style: 'liquid', host: 'qr', tags: { selfQuiet: true, noSeam: true },
        role: (r, c) => qrModuleRole(qr, r, c), color: (r, c) => qrModuleColor(deco, r, c), map: (x, y) => ({ x, y }),
      });
      const oldBad = intrusions(qr, unit, old);
      assert.ok(oldBad.has(at.join(',')), `옛 규칙이 ${at} 을 침범하지 않는다 — fixture 가 결함 자리에 못 닿는다 ${JSON.stringify([...oldBad])}`);
      const fixed = qrStyledModulePieces(qr, deco, { map: (x, y) => ({ x, y }), tags: { selfQuiet: true, noSeam: true } });
      assert.equal(intrusions(qr, unit, fixed).size, 0);
      // 새 규칙과 옛 규칙의 차이는 침범 필렛뿐이다(나머지 조각 · 순서 · 꼭짓점 불변).
      const oldKept = old.filter((s) => {
        const c = centroid(s);
        const row = Math.floor(c.y); const col = Math.floor(c.x);
        return !(FN.isFunctionModule(col, row) && qr.modules[row * SIZE + col] !== 1);
      });
      assert.deepEqual(fixed, oldKept);
    });
  }
});

// ── 공유 규칙의 단위 성질 ──────────────────────────────────────────────────────

test('qrStyledModuleRole: 기능 모듈은 밝든 어둡든 fixed · 어두운 데이터 data · 밝은 데이터 null', () => {
  for (const text of PAYLOADS) {
    const qr = qrMatrix(text);
    let lightFixed = 0;
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        const dark = qr.modules[row * SIZE + col] === 1;
        const want = FN.isFunctionModule(col, row) ? 'fixed' : dark ? 'data' : null;
        assert.equal(qrStyledModuleRole(qr, row, col), want, `${text} (${row},${col})`);
        if (want === 'fixed' && !dark) lightFixed += 1;
      }
    }
    assert.ok(lightFixed > 50, '밝은 기능 모듈이 있어야 이 단언이 뜻이 있다');
  }
  assert.throws(() => qrStyledModuleRole({ size: 25, modules: new Uint8Array(625) }, 0, 0), RangeError);
  assert.throws(() => qrStyledModulePieces({ size: 25, modules: new Uint8Array(625) }, decoOf('dots'), { map: (x, y) => ({ x, y }), tags: { selfQuiet: true, noSeam: true } }), RangeError);
});

test('H hStyledQrPieces 는 공유 함수와 같은 조각(태그 qr 만 더함)', () => {
  for (const style of SQUARE_CELL_STYLES) {
    const deco = decoOf(style);
    for (const text of PAYLOADS) {
      const qr = qrMatrix(text);
      const map = (x, y) => ({ x: 3 + 2 * x, y: 5 + 2 * y });
      assert.deepEqual(hStyledQrPieces(qr, deco, map),
        qrStyledModulePieces(qr, deco, { map, tags: { qr: true, selfQuiet: true, noSeam: true } }), `${style}/${text}`);
    }
  }
});
