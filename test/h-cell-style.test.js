/**
 * H 셀 꾸미기(hCellStyle · hCellGround) 생산자 배선의 «성질» 자 — DESIGN_001 §7.5 h-cell-style 행.
 *
 * 재는 것(대표 H0 · H2 · H5 · H8, frame 과 corners 둘 다):
 *   ① frame 검출 셀(경계 · 레일 · 링 · 태그 · 포맷 · 루트 · 레퍼런스)의 polygon 이 꾸미기 전과 같다.
 *      검출 셀 목록은 h-layout 의 역할에서 **따로** 유도한다(생산자의 판정 함수를 쓰지 않는다).
 *   ② 꾸밈 조각은 자기 셀 밖으로 나가지 않고, 어느 조각도 검출 셀 위에 있지 않다.
 *   ③ 바탕은 면마다 한 장, 그 면의 모든 셀 도형보다 먼저 오고 noSeam 이다(꾸밈 조각도 noSeam).
 *   ④ 바탕 gain·색 = 같은 면 데이터가 받는 조명 — 기준은 «꾸미기 전» 장면의 레벨 1 데이터 셀
 *      (3톤에서 colors[5] = levels[1]) 과 레벨 4 경계 셀(white 바탕). 구현 식을 다시 쓰지 않는다.
 *   ⑤ 래스터(2.5D PNG 경로)에서 꾸밈 데이터 셀 중심의 bilinear 표본 = 꾸미기 전 그 셀 색(±1).
 *   ⑥ GPU 면 텍스처: alpha 가 이진이고, 검출 셀 alpha 는 꾸미기 전(4px) 텍스처와 같다. level5 바탕은
 *      꾸밈 셀 전부 0, white 바탕은 셀 중심(데이터) 0 · 덮이지 않은 모서리(바탕) 255.
 *   ⑦ 스타일 켬 GPU 텍스처(셰이더 식 적용) 셀 중심 색 = 같은 옵션 2.5D PNG 의 셀 중심 색(±2).
 *   ⑧ 캐시 키: 스타일·바탕·QR deco 가 텍스처를 가르고, 기본값(키 없음 · 'square')은 다시 올리지 않는다.
 *   ⑨ 해석기: 빈 허용표(스텁 모양 주입 — 기본 모듈은 2026-09-27 부터 L6 생성본)는 전부 잠금, fixture 행만 열고,
 *      2톤 · corners 는 행이 있어도 잠금, 상태 불변. 생성본의 H 행 성질은 cell-shape-allow-generated.test.js.
 *      hPreviewOptions 는 기본값에서 새 키를 만들지 않는다.
 *   ⑩ 코너 QR deco: 기능 모듈은 모듈 사각 그대로, 눈은 deco.eye, 조각마다 {qr, selfQuiet, noSeam}; deco 를 끈 뒤의
 *      출력은 처음 기본 출력과 같다(단일 칸 캐시 이력).
 * 못 재는 것: 실제 카메라·디코더 판독(§7.3 H 판독 격자 — L6 영수증 몫), WebGL 드라이버의 실제 샘플링.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeH } from '../src/h-codec.js';
import { buildHScene, hProjection } from '../src/h-render.js';
import { hLayout, hFacePoint } from '../src/h-layout.js';
import { H_FACE_IDS } from '../src/h-profile.js';
import { hDisplayMap } from '../src/h-face-arrangement.js';
import { resolveHLighting } from '../src/h-lighting.js';
import { rasterize } from '../src/raster.js';
import { createHPreviewRenderer } from '../src/h-preview-renderer.js';
import { withHCornerQr, hStyledQrPieces } from '../src/generator-h-qr.js';
import { qrMatrix } from '../src/qr.js';
import { qrFunctionMapV1 } from '../src/qr-function-map.js';
import { SQUARE_CELL_STYLES, STYLE_CENTER_CLEARANCE } from '../src/square-cell-style.js';
import { resolveHCellStyleSpec, hPreviewOptions, hCellStyleCtx, H_CELL_STYLE_LOCK_REASONS } from '../src/generator-h.js';
import { createGeneratorState } from '../src/generator-state.js';

const PALETTE = { levels: [{ r: 30, g: 55, b: 80 }, { r: 120, g: 140, b: 160 }, { r: 220, g: 230, b: 240 }], background: { r: 255, g: 255, b: 255 } };
const STYLED = SQUARE_CELL_STYLES.filter(style => style !== 'square');
// 세 면이 모두 넉넉히 보이는 정위치 근처 자세(원근 켬) — 조명 gain·회전 fill 은 면마다 달라요.
const POSE = { rotateX: .06, rotateY: .1, rotateZ: .03, perspective: .18, margin: 2 };
const LIGHT = { profile: 'screen', shading: 'off', rotationFill: true };
const encodedCache = new Map();
function encoded(version, finder = 'frame', tones = 3) {
  const key = `${version}|${finder}|${tones}`;
  if (!encodedCache.has(key)) encodedCache.set(key, encodeH(version === 0 ? 'TL' : 'TL cell style', { version, mode: 3, tones, finder, ecc: 'M' }));
  return encodedCache.get(key);
}
/** 검출 셀(사각 고정) 집합 — 역할에서 직접: data · filler 가 아닌 모든 역할. */
function detectionCells(version, finder) {
  const out = new Set();
  for (const c of hLayout(version, finder).roles.values()) if (c.role !== 'data' && c.role !== 'filler') out.add(`${c.i},${c.j}`);
  return out;
}
const cellShapes = (scene, face) => scene.shapes.filter(s => s.face === face && Number.isInteger(s.i));
const isGround = s => s.hCellGround !== undefined;
/** 명시적 빈 표 — «전부 잠금» 스텁 모양(행 0 · 영수증 없음). */
const STUB = Object.freeze({ ROWS: Object.freeze([]), RECEIPT_SHA256: null, MEASURED_AT: null, FINGERPRINT: null });

// ── ⑨ 해석기 · hPreviewOptions ─────────────────────────────────────────────────
test('해석기: 빈 표(스텁 주입)는 전부 잠그고 fixture 행만 열며, 2톤 · corners 는 행이 있어도 잠그고 상태를 고치지 않아요', () => {
  const state = Object.freeze({ preset: 'slate', hCellStyle: 'dots', hCellGround: 'level5' });
  const ctx = hCellStyleCtx(encoded(2), state);
  assert.deepEqual(ctx, { version: 2, finder: 'frame', tones: 3, paletteGrade: 'slate' });
  assert.deepEqual(resolveHCellStyleSpec({ preset: 'slate' }, ctx), { spec: null }, 'square(키 없음)는 사유 없는 null');
  assert.deepEqual(resolveHCellStyleSpec({ ...state, hCellStyle: 'square' }, ctx), { spec: null });
  assert.equal(resolveHCellStyleSpec(state, ctx, STUB).lockReason, H_CELL_STYLE_LOCK_REASONS.UNMEASURED, '빈 허용표는 잠가요');
  const row = { table: 'h', version: 2, finder: 'frame', tones: 3, ground: 'level5', paletteGrade: 'slate', hCellStyle: 'dots' };
  const allow = { ROWS: [row] };
  assert.deepEqual(resolveHCellStyleSpec(state, ctx, allow).spec, { style: 'dots', ground: 'level5' });
  // 행의 키 하나만 달라도(스타일 · 바탕 · 등급 · 버전) 열지 않아요 — 와일드카드 없음.
  for (const [k, v] of [['hCellStyle', 'rounded'], ['ground', 'white'], ['paletteGrade', 'ember'], ['version', 0]]) {
    assert.equal(resolveHCellStyleSpec(state, ctx, { ROWS: [{ ...row, [k]: v }] }).spec, null, k);
  }
  const { paletteGrade, ...missingKey } = row;
  assert.equal(resolveHCellStyleSpec(state, ctx, { ROWS: [missingKey] }).spec, null, '키가 빠진 행은 아무것도 허가하지 않아요');
  assert.equal(resolveHCellStyleSpec(state, null, allow).lockReason, H_CELL_STYLE_LOCK_REASONS.CTX_INCOMPLETE);
  assert.equal(resolveHCellStyleSpec({ ...state, preset: 'nope' }, hCellStyleCtx(encoded(2), { preset: 'nope' }), allow).lockReason, H_CELL_STYLE_LOCK_REASONS.CTX_INCOMPLETE);
  assert.equal(resolveHCellStyleSpec({ ...state, hCellStyle: 'bubble' }, ctx, allow).lockReason, H_CELL_STYLE_LOCK_REASONS.UNKNOWN_STYLE);
  assert.equal(resolveHCellStyleSpec({ ...state, hCellGround: 'black' }, ctx, allow).lockReason, H_CELL_STYLE_LOCK_REASONS.UNKNOWN_GROUND);
  const two = hCellStyleCtx(encoded(2, 'frame', 2), state), corners = hCellStyleCtx(encoded(5, 'corners'), state);
  assert.equal(resolveHCellStyleSpec(state, two, { ROWS: [{ ...row, tones: 2 }] }).lockReason, H_CELL_STYLE_LOCK_REASONS.TWO_TONE);
  assert.equal(resolveHCellStyleSpec(state, corners, { ROWS: [{ ...row, version: 5, finder: 'corners' }] }).lockReason, H_CELL_STYLE_LOCK_REASONS.CORNERS_FINDER);
  assert.equal(hCellStyleCtx(encoded(2), { preset: 'custom' }).paletteGrade, 'custom');
});

test('hPreviewOptions: 기본값·잠금·문맥 없음은 키를 만들지 않고, 연 값만 hCellStyle · hCellGround 로 실어요', () => {
  const base = createGeneratorState({ type: 'Y' });
  const e = encoded(2), allow = { ROWS: [{ table: 'h', version: 2, finder: 'frame', tones: 3, ground: 'white', paletteGrade: base.preset, hCellStyle: 'rounded' }] };
  const plain = hPreviewOptions(base);
  assert.deepEqual(hPreviewOptions({ ...base, hCellStyle: 'square', hCellGround: 'white' }, { encoded: e, allow }), plain, 'square 는 바이트 동일');
  assert.deepEqual(hPreviewOptions(base, { encoded: e, allow }), plain, '키 없음도 같아요');
  const on = { ...base, hCellStyle: 'rounded', hCellGround: 'white' };
  assert.deepEqual(hPreviewOptions(on, { encoded: e, allow: STUB }), plain, '빈 허용표 = 잠금 → 키 없음');
  assert.deepEqual(hPreviewOptions(on, { allow }), plain, 'encoded 가 없으면 잴 문맥이 없어 잠가요');
  const opened = hPreviewOptions(on, { encoded: e, allow });
  assert.equal(opened.hCellStyle, 'rounded'); assert.equal(opened.hCellGround, 'white');
  const { hCellStyle, hCellGround, ...rest } = opened;
  assert.deepEqual(rest, plain, '다른 옵션은 그대로예요');
});

// ── ①–④ 장면 성질 ─────────────────────────────────────────────────────────────
for (const [version, finder] of [[0, 'frame'], [2, 'frame'], [5, 'frame'], [8, 'frame']]) {
  test(`H${version} ${finder}: 검출 셀 불변 · 조각은 자기 꾸밈 셀 안 · 바탕은 먼저 · noSeam · 바탕 조명 = 데이터 조명`, () => {
    const e = encoded(version, finder), n = e.n, detect = detectionCells(version, finder);
    const styles = version <= 2 ? STYLED : ['dots', 'liquid'];
    for (const lighting of [undefined, LIGHT]) {
      const options = { ...POSE, palette: PALETTE, outline: true, ...(lighting ? { lighting } : {}) };
      const before = buildHScene(e, options);
      for (const style of styles) for (const ground of ['level5', 'white']) {
        const scene = buildHScene(e, { ...options, hCellStyle: style, hCellGround: ground });
        assert.deepEqual(scene.hModel.cellStyle, { style, ground });
        for (const face of scene.hModel.visible) {
          const old = new Map(cellShapes(before, face).map(s => [`${s.i},${s.j}`, s]));
          const kept = cellShapes(scene, face);
          // ① 사각으로 남은 셀 = 역할에서 유도한 검출 셀 전부(더도 덜도 아님), 도형은 꾸미기 전과 같다.
          assert.deepEqual(new Set(kept.map(s => `${s.i},${s.j}`)), detect, `${style} ${face} 검출 셀 집합`);
          for (const s of kept) assert.deepEqual(s, old.get(`${s.i},${s.j}`), `${style} ${face} ${s.i},${s.j} 불변`);
          // ③ 바탕: 한 장 · 그 면의 첫 도형 · noSeam.
          const faceShapes = scene.shapes.filter(s => s.face === face);
          const grounds = faceShapes.filter(isGround);
          assert.equal(grounds.length, 1); assert.equal(faceShapes[0], grounds[0], '바탕이 그 면의 모든 도형보다 먼저');
          assert.equal(grounds[0].noSeam, true);
          const pieces = faceShapes.filter(s => !isGround(s) && !Number.isInteger(s.i));
          assert.ok(pieces.length > 0);
          for (const p of pieces) assert.equal(p.noSeam, true);
          // ④ 바탕 조명 = 같은 면 데이터 조명 — 꾸미기 전 장면의 레벨 1 데이터 셀(= colors[5]) · 레벨 4 경계 셀.
          const logical = hDisplayMap(e, {}).physicalToLogical[face];
          assert.ok(logical, face);
          const ref = ground === 'level5'
            ? [...old.values()].find(s => !detect.has(`${s.i},${s.j}`) && e.faces[logical][s.i * n + s.j] === 1)
            : [...old.values()].find(s => s.i === 0 && s.j === 0);
          assert.ok(ref, `${face} 기준 셀`);
          assert.deepEqual(grounds[0].color, ref.color, `${style}/${ground} ${face} 바탕 색`);
          assert.equal(grounds[0].gain, ref.gain, `${style}/${ground} ${face} 바탕 gain`);
        }
      }
    }
  });
}

test('꾸밈 조각은 자기 셀 [c,c+1]×[r,r+1] 안이고, 그 셀은 검출 셀이 아니에요(면 로컬 투영 0)', () => {
  for (const version of [0, 2, 5]) {
    const e = encoded(version), n = e.n, detect = detectionCells(version, 'frame');
    for (const style of STYLED) {
      // perspective 0 · 정위치에서 ZM 면은 hFacePoint 가 [i, j, 0] → 투영이 아핀이라 면 로컬 좌표를 되돌릴 수 있어요.
      const scene = buildHScene(e, { perspective: 0, margin: 0, hCellStyle: style, hCellGround: 'level5' });
      const face = 'ZM', o = scene.shapes.find(s => s.face === face && isGround(s)).points;
      // 바탕 꼭짓점 = (0,0) (0,n) (n,n) (n,0) 의 투영 → 아핀 기저.
      const [p00, p0n, , pn0] = o, ex = { x: (p0n.x - p00.x) / n, y: (p0n.y - p00.y) / n }, ey = { x: (pn0.x - p00.x) / n, y: (pn0.y - p00.y) / n };
      const det = ex.x * ey.y - ex.y * ey.x;
      const local = p => { const dx = p.x - p00.x, dy = p.y - p00.y; return { col: (dx * ey.y - dy * ey.x) / det, row: (ex.x * dy - ex.y * dx) / det }; };
      const pieces = scene.shapes.filter(s => s.face === face && !isGround(s) && !Number.isInteger(s.i));
      for (const piece of pieces) {
        const pts = piece.points.map(local);
        const r = Math.floor(pts.reduce((a, p) => a + p.row, 0) / pts.length), c = Math.floor(pts.reduce((a, p) => a + p.col, 0) / pts.length);
        assert.ok(!detect.has(`${r},${c}`), `${style} 조각이 검출 셀 ${r},${c} 위에 있어요`);
        for (const p of pts) assert.ok(p.row >= r - 1e-6 && p.row <= r + 1 + 1e-6 && p.col >= c - 1e-6 && p.col <= c + 1 + 1e-6, `${style} 조각이 셀 밖`);
      }
    }
  }
});

test('2톤 · corners 파인더(H5 · H8)와 알 수 없는 값: 생산자는 열지 않거나 던져요(fail-closed)', () => {
  for (const e of [encoded(2, 'frame', 2), encoded(5, 'corners'), encoded(8, 'corners')]) {
    const plain = buildHScene(e, { ...POSE, palette: PALETTE });
    const styled = buildHScene(e, { ...POSE, palette: PALETTE, hCellStyle: 'dots', hCellGround: 'level5' });
    assert.deepEqual(styled.shapes, plain.shapes, `${e.version}/${e.finder}/${e.tones} 는 사각 그대로`);
    assert.equal(styled.hModel.cellStyle, undefined);
  }
  assert.throws(() => buildHScene(encoded(0), { hCellStyle: 'bubble' }), RangeError);
  assert.throws(() => buildHScene(encoded(0), { hCellStyle: 'dots', hCellGround: 'black' }), RangeError);
});

// ── ⑤ ⑦ 래스터 · GPU 텍스처 ────────────────────────────────────────────────────
function bilinear(raster, x, y) {
  const u = x * raster.pixelsPerUnit - .5, v = y * raster.pixelsPerUnit - .5, x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  const at = (px, py, ch) => raster.pixels[(py * raster.width + px) * 4 + ch];
  return [0, 1, 2].map(ch => at(x0, y0, ch) * (1 - fx) * (1 - fy) + at(x0 + 1, y0, ch) * fx * (1 - fy) + at(x0, y0 + 1, ch) * (1 - fx) * fy + at(x0 + 1, y0 + 1, ch) * fx * fy);
}
function gpuHarness() {
  const uploads = [];
  const gl = new Proxy({
    NO_ERROR: 0, TEXTURE_2D: 9, RGBA: 20, UNSIGNED_BYTE: 21, LINEAR: 18, NEAREST: 19,
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createTexture: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0, getUniformLocation: () => ({}), getError: () => 0,
    texImage2D: (...args) => { if (args.length === 9) uploads.push({ width: args[3], height: args[4], pixels: args[8] }); else uploads.push({ canvas: true }); },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const canvas = { width: 320, height: 320, getContext: () => gl, addEventListener() {}, removeEventListener() {} };
  return { uploads, renderer: createHPreviewRenderer(canvas) };
}
/** 업로드 순서 = H_FACE_IDS 중 코드가 실린 물리면(노드에는 캔버스가 없어 빈 면은 올리지 않아요). */
function faceTextures(e, uploads, from) {
  const map = hDisplayMap(e, {}), faces = H_FACE_IDS.filter(face => map.physicalToLogical[face] && e.faces[map.physicalToLogical[face]]);
  const list = uploads.slice(from, from + faces.length);
  assert.equal(list.length, faces.length);
  return Object.fromEntries(faces.map((face, k) => [face, { ...list[k], logical: map.physicalToLogical[face] }]));
}
const shade = (rgb, marker, gain, fill) => rgb.map(v => { const c = v / 255; return marker ? v : (c + fill * c * (1 - c)) * gain * 255; });

for (const [version, styles] of [[0, STYLED], [2, STYLED], [5, ['dots', 'liquid']], [8, ['diamond']]]) {
  test(`H${version}: PNG 셀 중심 = 꾸미기 전 색 · GPU 텍스처 alpha 이진 · 텍스처 셀 중심(셰이더 식) = PNG 셀 중심`, () => {
    const e = encoded(version), n = e.n, detect = detectionCells(version, 'frame');
    const options = { ...POSE, palette: PALETTE, lighting: LIGHT };
    const ppu = version >= 8 ? 14 : version >= 5 ? 10 : 16;
    const before = buildHScene(e, options);
    const light = resolveHLighting(LIGHT, POSE);
    const { uploads, renderer } = gpuHarness();
    assert.equal(renderer.draw(e, options), true);
    const plainTex = faceTextures(e, uploads, 0);
    for (const style of styles) for (const ground of ['level5', 'white']) {
      const opts = { ...options, hCellStyle: style, hCellGround: ground };
      const scene = buildHScene(e, opts), raster = rasterize(scene, { pixelsPerUnit: ppu });
      const from = uploads.length;
      assert.equal(renderer.draw(e, opts), true);
      const tex = faceTextures(e, uploads, from);
      for (const [face, t] of Object.entries(tex)) {
        const side = n * 16; assert.equal(t.width, side, '꾸밈 텍스처는 셀당 16px');
        const plain = plainTex[face], levels = e.faces[t.logical];
        // ⑥ alpha 이진 · 검출 셀은 4px 텍스처와 같은 alpha.
        for (let k = 3; k < t.pixels.length; k += 4) assert.ok(t.pixels[k] === 0 || t.pixels[k] === 255, 'alpha 이진');
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const a = t.pixels[((i * 16 + 8) * side + j * 16 + 8) * 4 + 3], a0 = plain.pixels[((i * 4 + 2) * n * 4 + j * 4 + 2) * 4 + 3];
          if (detect.has(`${i},${j}`)) assert.equal(a, a0, `검출 ${i},${j} alpha`);
          else assert.equal(a, 0, '꾸밈 셀 중심(데이터)은 음영 대상');
          if (!detect.has(`${i},${j}`) && ground === 'level5') {
            for (const [y, x] of [[0, 0], [15, 15], [0, 15]]) assert.equal(t.pixels[((i * 16 + y) * side + j * 16 + x) * 4 + 3], 0, 'level5 바탕은 음영 대상');
          }
        }
        if (ground === 'white' && ['dots', 'diamond'].includes(style)) {
          const [i, j] = [...Array(n * n).keys()].map(k => [Math.floor(k / n), k % n]).find(([i, j]) => !detect.has(`${i},${j}`));
          assert.equal(t.pixels[((i * 16) * side + j * 16) * 4 + 3], 255, 'white 바탕(레벨 4)은 무음영 비트');
        }
        if (!scene.hModel.visible.includes(face)) continue;
        const gain = light.faceReadGains?.[face] ?? light.faceGains[face], fill = light.faceFills?.[face] ?? 0;
        const oldColors = new Map(cellShapes(before, face).map(s => [`${s.i},${s.j}`, s.color]));
        const view = hProjection(n, POSE);
        let measured = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          // 잴 수 있는 셀만: 투영된 셀의 가장 짧은 변 × 스타일 중심 여유 c 가 3px 이상(bilinear 1px + AA 1px + 여유).
          // 그 밖은 해상도 문제라 이 자의 축이 아니에요 — 대신 아래에서 면마다 90% 이상을 쟀는지 단언해요.
          const corners = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]].map(([a, b]) => view.project(hFacePoint(face, a, b, n)));
          const edge = Math.min(...corners.map((c, k) => { const d = corners[(k + 1) % 4]; return Math.sqrt((c.x - d.x) ** 2 + (c.y - d.y) ** 2); }));
          const c = detect.has(`${i},${j}`) ? .5 : STYLE_CENTER_CLEARANCE[style];
          if (c * edge * ppu < 3) continue;
          measured++;
          const p = hFacePoint(face, i + .5, j + .5, n), q = hPointToScene(scene, p, n, POSE);
          const png = bilinear(raster, q.x, q.y);
          // ⑤ 꾸밈 데이터 셀 중심 = 꾸미기 전 그 셀 색.
          const want = oldColors.get(`${i},${j}`);
          if (!detect.has(`${i},${j}`)) png.forEach((v, ch) => assert.ok(Math.abs(v - [want.r, want.g, want.b][ch]) <= 1, `${style}/${ground} ${face} ${i},${j} PNG ${png} vs ${JSON.stringify(want)}`));
          // ⑦ 텍스처 셀 중심에 셰이더 식(marker 면 gain 1 · fill 0)을 적용한 색 = PNG 셀 중심.
          const o = ((i * 16 + 8) * side + j * 16 + 8) * 4, marker = t.pixels[o + 3] >= 128;
          const gpu = shade([t.pixels[o], t.pixels[o + 1], t.pixels[o + 2]], marker, gain, fill);
          gpu.forEach((v, ch) => assert.ok(Math.abs(v - png[ch]) <= 2, `${style}/${ground} ${face} ${i},${j} GPU ${gpu} vs PNG ${png}`));
          assert.ok(levels.length === n * n);
        }
        assert.ok(measured >= .9 * n * n, `${style} ${face} 잰 셀 ${measured}/${n * n}`);
      }
    }
  });
}
/** 장면 좌표 — buildHScene 과 같은 투영(hProjection)을 거쳐요. */
function hPointToScene(scene, point, n, pose) { return hProjection(n, pose).project(point); }

// ── ⑧ 캐시 키 ────────────────────────────────────────────────────────────────
test('GPU 캐시 키: 스타일·바탕이 텍스처를 가르고, 기본값(키 없음 · square)은 다시 올리지 않아요', () => {
  const e = encoded(2), { uploads, renderer } = gpuHarness(), options = { ...POSE, palette: PALETTE };
  assert.equal(renderer.draw(e, options), true);
  const first = uploads.length; assert.ok(first > 0);
  assert.ok(uploads.every(u => u.width === e.n * 4), '기본은 셀당 4px');
  assert.equal(renderer.draw(e, { ...options, hCellStyle: 'square', hCellGround: 'white' }), true);
  assert.equal(uploads.length, first, 'square 는 기본값과 같은 키');
  assert.equal(renderer.draw(e, { ...options, hCellStyle: 'dots' }), true);
  const dots = uploads.length; assert.ok(dots > first);
  assert.equal(renderer.draw(e, { ...options, hCellStyle: 'dots', hCellGround: 'level5' }), true);
  assert.equal(uploads.length, dots, 'hCellGround 생략 = level5');
  assert.equal(renderer.draw(e, { ...options, hCellStyle: 'dots', hCellGround: 'white' }), true);
  const white = uploads.length; assert.ok(white > dots, '바탕이 키를 가려요');
  assert.equal(renderer.draw(e, { ...options, hCellStyle: 'diamond', hCellGround: 'white' }), true);
  assert.ok(uploads.length > white, '스타일이 키를 가려요');
  const beforeOff = uploads.length;
  assert.equal(renderer.draw(e, options), true);
  const back = uploads.slice(beforeOff);
  assert.ok(back.length > 0 && back.every(u => u.width === e.n * 4), '끄면 4px 텍스처로 돌아가요');
  back.forEach((u, k) => assert.deepEqual(u.pixels, uploads[k].pixels, '끈 뒤 텍스처 = 처음 기본 텍스처'));
  assert.equal(renderer.draw(e, { ...options, hCellStyle: 'dots', hCellGround: 'white' }), true);
  assert.equal(renderer.draw(e, { ...options, hCellStyle: 'dots', hCellGround: 'white', rotateY: 1.1 }), true);
  const posed = uploads.length;
  assert.equal(renderer.draw(e, { ...options, hCellStyle: 'dots', hCellGround: 'white', rotateY: 1.3 }), true);
  assert.equal(uploads.length, posed, '자세만 바뀌면 다시 올리지 않아요');
});

// ── ⑩ 코너 QR deco ────────────────────────────────────────────────────────────
const DECO = Object.freeze({ dark: Object.freeze({ r: 20, g: 40, b: 90 }), light: Object.freeze({ r: 255, g: 255, b: 255 }), eye: Object.freeze({ r: 5, g: 10, b: 30 }), cellStyle: 'dots' });
test('코너 QR deco: 기능 모듈은 모듈 사각 · 눈은 deco.eye · 조각마다 {qr, selfQuiet, noSeam} · 이력 뒤 기본 출력 불변', () => {
  const text = 'HTTPS://TL.ESTRE.SO', base = buildHScene(encoded(2), { ...POSE, palette: PALETTE, outline: true });
  const cold = JSON.stringify(withHCornerQr(base, { text, corner: 'BR' }));
  const scene = withHCornerQr(base, { text, corner: 'BR', deco: DECO });
  const added = scene.shapes.slice(base.shapes.length), meta = scene.hCornerQr, qr = qrMatrix(text), fn = qrFunctionMapV1();
  assert.equal(meta.cellStyle, 'dots');
  for (const s of added) { assert.equal(s.qr, true); assert.equal(s.selfQuiet, true); assert.equal(s.noSeam, true); }
  assert.deepEqual(added[0].color, DECO.light, '밝은 판이 먼저');
  // 모듈 사각 = 기본 경로의 rect 와 같은 4 꼭짓점.
  const sq = (row, col) => { const x = meta.x + (meta.quiet + col) * meta.module, y = meta.y + (meta.quiet + row) * meta.module; return [[x, y], [x + meta.module, y], [x + meta.module, y + meta.module], [x, y + meta.module]]; };
  const near = (a, b) => a.length === b.length && a.every((p, k) => Math.abs(p.x - b[k][0]) < 1e-9 && Math.abs(p.y - b[k][1]) < 1e-9);
  let fixed = 0, data = 0;
  for (let row = 0; row < qr.size; row++) for (let col = 0; col < qr.size; col++) {
    if (qr.modules[row * qr.size + col] !== 1) continue;
    const hit = added.filter(s => near(s.points, sq(row, col)));
    if (fn.isFunctionModule(col, row)) {
      fixed++; assert.equal(hit.length, 1, `기능 ${row},${col} 사각`);
      assert.deepEqual(hit[0].color, fn.isEyeModule(col, row) ? DECO.eye : DECO.dark);
    } else { data++; assert.equal(hit.length, 0, `데이터 ${row},${col} 는 dots 라 사각이 아니에요`); }
  }
  assert.ok(fixed > 0 && data > 0);
  // 조각 수 = 판 1 + 어두운 모듈 수(dots · 기능 사각 모두 모듈당 1 조각).
  const darkCount = [...qr.modules].filter(v => v === 1).length;
  assert.equal(added.length, 1 + darkCount);
  // 이력: deco 켬 → 다른 deco → 끔. 끈 출력은 처음 기본 출력과 같아요(단일 칸 캐시 키에 deco).
  const other = withHCornerQr(base, { text, corner: 'BR', deco: { ...DECO, cellStyle: 'diamond' } });
  assert.notDeepEqual(other.shapes.slice(base.shapes.length).map(s => s.points), added.map(s => s.points), 'deco 가 캐시를 가려요');
  assert.equal(JSON.stringify(withHCornerQr(base, { text, corner: 'BR' })), cold);
  assert.deepEqual(withHCornerQr(base, { text, corner: 'BR', deco: DECO }), scene, '같은 deco 는 같은 출력');
  assert.throws(() => withHCornerQr(base, { text, corner: 'BR', deco: { style: 'dots' } }), TypeError, '모양이 틀린 deco');
  // liquid 오목 필렛은 밝은 **데이터** 모듈 모서리에만 — 밝은 기능 모듈(분리자 · 흰 고리 · 타이밍)은 건드리지 않아요.
  // ⚠ 정정(2026-09-26 단계 F): 여기 적혀 있던 «v1 기하에서는 밝은 기능 모듈이 직교 두 데이터 이웃을 가진 자리가 없다»
  // 는 **반박됐어요** — 포맷 모듈 (8,8) · (8,13) 은 이웃 데이터 셋이 어두우면 닿아요(3000 문구 중 206, 외부 검토
  // grok · agy 가 O/A/K · Y 경로에서 짚음). 이 문구 하나는 우연히 안 닿는 입력이라 여기 단언은 가드일 뿐이고, 판별력
  // 있는 자는 test/qr-function-module-intrusion.test.js(세 호스트 × 9 스타일 × 닿는 문구 포함, 다각형 교집합)예요.
  // (H 면 쪽 같은 결함은 위 «자기 셀 안» 자가 레퍼런스 셀 5,5 에서 실제로 잡았어요.)
  const liquid = hStyledQrPieces(qr, { ...DECO, cellStyle: 'liquid' }, (x, y) => ({ x, y }));
  let concave = 0;
  for (const piece of liquid) {
    const r = Math.floor(piece.points.reduce((a, p) => a + p.y, 0) / piece.points.length), c = Math.floor(piece.points.reduce((a, p) => a + p.x, 0) / piece.points.length);
    const isDark = qr.modules[r * qr.size + c] === 1;
    assert.ok(isDark || !fn.isFunctionModule(c, r), `liquid 조각이 밝은 기능 모듈 ${r},${c} 위에 있어요`);
    if (!isDark) concave++;
  }
  assert.ok(concave > 0, '이 문구에서 오목 필렛이 하나는 생겨야 자가 판별력이 있어요');
  assert.throws(() => hStyledQrPieces({ size: 25, modules: new Uint8Array(625) }, DECO, (x, y) => ({ x, y })), RangeError, 'v1 전용');
});

test('GPU QR 텍스처: deco 가 있을 때만 모듈당 16px 원시 픽셀로 올리고 deco 가 키를 가려요', () => {
  const e = encoded(2), { uploads, renderer } = gpuHarness(), options = { ...POSE, palette: PALETTE }, text = 'HTTPS://TL.ESTRE.SO';
  assert.equal(renderer.draw(e, { ...options, qr: { text, corner: 'TL' } }), true);
  const plain = uploads.length;
  assert.ok(uploads.every(u => !u.width || u.width === e.n * 4), '기본 QR 은 캔버스 경로(노드에선 올리지 않음)');
  assert.equal(renderer.draw(e, { ...options, qr: { text, corner: 'TL', deco: DECO } }), true);
  assert.equal(uploads.length, plain + 1);
  const t = uploads.at(-1), side = (21 + 8) * 16;
  assert.equal(t.width, side);
  for (let k = 3; k < t.pixels.length; k += 4) assert.equal(t.pixels[k], 255, 'QR 텍스처는 불투명');
  // 모듈 중심 색 = 어두운 모듈이면 eye/dark, 밝은 모듈이면 light.
  const fn = qrFunctionMapV1(), qr = qrMatrix(text);
  for (let row = 0; row < 21; row++) for (let col = 0; col < 21; col++) {
    const o = (((row + 4) * 16 + 8) * side + (col + 4) * 16 + 8) * 4, got = { r: t.pixels[o], g: t.pixels[o + 1], b: t.pixels[o + 2] };
    const want = qr.modules[row * 21 + col] !== 1 ? DECO.light : fn.isEyeModule(col, row) ? DECO.eye : DECO.dark;
    assert.deepEqual(got, want, `${row},${col}`);
  }
  assert.equal(renderer.draw(e, { ...options, qr: { text, corner: 'TL', deco: DECO } }), true);
  assert.equal(uploads.length, plain + 1, '같은 deco 는 다시 올리지 않아요');
  assert.equal(renderer.draw(e, { ...options, qr: { text, corner: 'TL', deco: { ...DECO, eye: { r: 0, g: 0, b: 0 } } } }), true);
  assert.equal(uploads.length, plain + 2, '눈 색이 키를 가려요');
});
