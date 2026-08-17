/**
 * claude-slotqr-probe.mjs — 슬롯 QR 수리 레인 §3.5 · 결함 B 원인 규명.
 *
 * 확증 OFF 세계에서 선 v0wy 포즈(팔 A·B·C2 각 3개)의 **셰이프에서 H 를 복원**하고
 * (중심 + 꼭짓점 6 = 7 대응 DLT — shapeFromPose 의 역), 그 H 위에서 게이트가 하는
 * 계산을 **문자 그대로** 재연한다 (INTERNALS.registerPatch + centreQrFinderContrast,
 * range 0.5셀 · step 0.25셀 · 문턱 0.6 — 출고값 그대로).
 *
 * 각 포즈에 대해 적는 것:
 *   · H 복원 잔차 (자 검증 — 1e-6 px 넘으면 이 표 전체 무효)
 *   · 포즈가 주장하는 슬롯 중심(slotQr.anchor 투영) vs 실제 슬롯 중심 (렌더 기하)
 *   · contrast @offset(0,0) · registerPatch 의 probe(offset·corr) · contrast @probe
 *   · quiet·finder 평균과 span (@probe) — 무엇이 밝고 무엇이 어두워서 통과했나
 *
 * src 무수정 · 문턱 무수정 (재연이지 완화가 아니다).
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import {
  detectCellSurfaceBlockShapes, CS_BLOCK_LOCATOR_INTERNALS,
} from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { faceBasis } from '../../../src/ygrid.js';
import { CORNER_UNIT_OFFSETS } from '../../../src/hexgrid.js';
import {
  centerQrSlotCellsFor, centerQrSlotOriginFor,
} from '../../../src/cellSurfaceFinal.js';
import { TL_READER_URL } from '../../../src/qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { embed960 } from './claude-v0w2-leak.mjs';

const { registerPatch, centreQrFinderContrast, patchesFor } = CS_BLOCK_LOCATOR_INTERNALS;

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PAYLOAD = 'https://tl.estre.so';
const N = 21;
const PPU = 15;
const cal = (o) => ({ calibration: { csBlockLocator: o } });

const enc = encodeY(PAYLOAD, {
  cellSurfaceLayout: 'v0wy', version: 1, tones: 2, eccLevel: 'M',
});
const sceneY = buildSceneY(enc, { palette: PALETTE, margin: 4, qrText: TL_READER_URL });
const m = centerQrSlotCellsFor('v0wy');
const og = centerQrSlotOriginFor('v0wy', N);
const { ei, ej } = faceBasis('T');
const fp = (a, b) => ({
  x: sceneY.layout.originX + (a * ei.x + b * ej.x) * sceneY.layout.size,
  y: sceneY.layout.originY + (a * ei.y + b * ej.y) * sceneY.layout.size,
});
const quad = [fp(og.i, og.j), fp(og.i + m, og.j), fp(og.i + m, og.j + m), fp(og.i, og.j + m)];
const centroidOf = (s) => {
  if (s.kind === 'disc') return { x: s.cx, y: s.cy };
  let sx = 0; let sy = 0;
  for (const p of s.points) { sx += p.x; sy += p.y; }
  return { x: sx / s.points.length, y: sy / s.points.length };
};
const inQuad = (pt) => {
  let sign = 0;
  for (let k = 0; k < 4; k += 1) {
    const p = quad[k]; const q = quad[(k + 1) % 4];
    const cross = (q.x - p.x) * (pt.y - p.y) - (q.y - p.y) * (pt.x - p.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s; else if (sign !== s) return false;
  }
  return true;
};
let first = -1; let last = -1;
for (let k = 0; k < sceneY.shapes.length; k += 1) {
  const s = sceneY.shapes[k];
  if (s.kind !== 'polygon' || s.points.length !== 4) continue;
  if (!inQuad(centroidOf(s))) continue;
  if (first < 0) first = k;
  last = k;
}
const gain = DEFAULT_FACE_GAINS.T;
const dark = { r: BULLSEYE_DARK.r * gain, g: BULLSEYE_DARK.g * gain, b: BULLSEYE_DARK.b * gain };
const quadAt = (a, b, w) => [fp(a, b), fp(a + w, b), fp(a + w, b + w), fp(a, b + w)];

const baseRaster = rasterize(sceneY, { pixelsPerUnit: PPU, supersample: 2 });
const OX = Math.floor((960 - baseRaster.width) / 2);
const OY = Math.floor((960 - baseRaster.height) / 2);
// 실제 T 슬롯 중심의 이미지 좌표 (렌더 기하 닫힌 형태 — ruler R2 와 같은 사상).
const slotCentreWorld = fp(og.i + m / 2, og.j + m / 2);
const TRUE_SLOT = { x: slotCentreWorld.x * PPU + OX, y: slotCentreWorld.y * PPU + OY };

const ARMS = [
  ['A 진짜 QR', sceneY.shapes],
  ['B 슬롯 구멍', [...sceneY.shapes.slice(0, first), ...sceneY.shapes.slice(last + 1)]],
  ['C2 단색 어두움', [...sceneY.shapes.slice(0, first),
    { kind: 'polygon', points: quadAt(og.i, og.j, m), color: dark },
    ...sceneY.shapes.slice(last + 1)]],
];

// ── H 복원 (7 대응 DLT · H[8]=1) ─────────────────────────────────────────
function solveH(correspondences) {
  // 정규방정식 (A^T A) h = A^T b — 8 미지수. 대응이 정확 투영이라 조건은 온화하다.
  const AtA = Array.from({ length: 8 }, () => new Float64Array(8));
  const Atb = new Float64Array(8);
  const addRow = (row, rhs) => {
    for (let i = 0; i < 8; i += 1) {
      Atb[i] += row[i] * rhs;
      for (let j = 0; j < 8; j += 1) AtA[i][j] += row[i] * row[j];
    }
  };
  for (const [p, q] of correspondences) {
    addRow([p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y], q.x);
    addRow([0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y], q.y);
  }
  // 가우스 소거 (부분 피벗).
  const M = AtA.map((r, i) => [...r, Atb[i]]);
  for (let c = 0; c < 8; c += 1) {
    let piv = c;
    for (let r = c + 1; r < 8; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 8; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 9; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  const H = new Float64Array(9);
  for (let i = 0; i < 8; i += 1) H[i] = M[i][8] / M[i][i];
  H[8] = 1;
  return H;
}
const project = (H, p) => {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  if (!(Math.abs(w) > 1e-12)) return null;
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
};

const patches = patchesFor(N, 'v0wy');
const slotPatch = patches.slotQr;

function bilinearAt(luma, x, y) {
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= luma.width || y0 + 1 >= luma.height) return null;
  const fx = x - x0; const fy = y - y0;
  const base = y0 * luma.width + x0;
  const top = luma.data[base] * (1 - fx) + luma.data[base + 1] * fx;
  const bot = luma.data[base + luma.width] * (1 - fx) + luma.data[base + luma.width + 1] * fx;
  return top * (1 - fy) + bot * fy;
}

function roleMeans(luma, H, offsetX, offsetY) {
  const quiet = []; const finder = []; const values = [];
  for (const point of slotPatch.points) {
    const image = project(H, point);
    if (!image) continue;
    const v = bilinearAt(luma, image.x + offsetX, image.y + offsetY);
    if (v === null) continue;
    values.push(v);
    if (point.role === 'quiet') quiet.push(v);
    else if (point.role === 'finder') finder.push(v);
  }
  const mean = (l) => (l.length ? l.reduce((s, v) => s + v, 0) / l.length : null);
  values.sort((a, b) => a - b);
  const pick = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  return {
    quiet: mean(quiet), finder: mean(finder),
    span: values.length ? pick(0.95) - pick(0.05) : null,
  };
}

console.log('# 슬롯 QR 수리 §3.5 — 확증 OFF 세계의 v0wy 포즈 해부');
console.log('');
console.log('실제 T 슬롯 중심 (이미지 px) = ('
  + TRUE_SLOT.x.toFixed(1) + ', ' + TRUE_SLOT.y.toFixed(1) + ')');
console.log('');
for (const [label, shapes] of ARMS) {
  const frame = embed960(rasterize({ ...sceneY, shapes }, { pixelsPerUnit: PPU, supersample: 2 }));
  const luma = toRelativeLuminance(frame);
  const det = detectCellSurfaceBlockShapes(luma, cal({ v0wyRequireSlotQr: false }));
  const wyShapes = det.shapes.filter((s) => s.blockLocator && s.blockLocator.layoutId === 'v0wy');
  console.log('## ' + label + ' — OFF 세계 v0wy 포즈 ' + det.diagnostics.poseCount.v0wy
    + ' · v0wy 셰이프 ' + wyShapes.length);
  console.log('| # | H잔차px | 주장 슬롯중심 | 실슬롯거리px | corr(probe) | offset(px) | c@(0,0) | c@probe | quiet | finder | span | 판정0.6 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  let idx = 0;
  for (const shape of wyShapes) {
    idx += 1;
    const corr = [];
    for (let k = 0; k < 6; k += 1) {
      corr.push([{ x: CORNER_UNIT_OFFSETS[k].x * N, y: CORNER_UNIT_OFFSETS[k].y * N },
        shape.vertices[k]]);
    }
    corr.push([{ x: 0, y: 0 }, shape.center]);
    const H = solveH(corr);
    if (!H) { console.log('| ' + idx + ' | DLT 실패 |'); continue; }
    let residual = 0;
    for (const [p, q] of corr) {
      const r = project(H, p);
      residual = Math.max(residual, Math.hypot(r.x - q.x, r.y - q.y));
    }
    const claimed = project(H, slotPatch.anchor);
    const dTrue = Math.hypot(claimed.x - TRUE_SLOT.x, claimed.y - TRUE_SLOT.y);
    const e = project(H, { x: 1, y: 0 });
    const s0 = project(H, { x: 0, y: 1 });
    const o0 = project(H, { x: 0, y: 0 });
    const cellPx = (Math.hypot(e.x - o0.x, e.y - o0.y) + Math.hypot(s0.x - o0.x, s0.y - o0.y)) / 2;
    // 게이트와 같은 호출 (출고 cfg: range2 0.5셀 · step 0.25셀).
    const probe = registerPatch(luma, H, slotPatch, 0.5 * cellPx, Math.max(0.5, 0.25 * cellPx));
    const c00 = centreQrFinderContrast(luma, H, slotPatch, 0, 0);
    const cPr = probe ? centreQrFinderContrast(luma, H, slotPatch, probe.offsetX, probe.offsetY) : null;
    const rm = probe ? roleMeans(luma, H, probe.offsetX, probe.offsetY) : null;
    const fmt = (v, d = 4) => (v === null || v === undefined ? 'null' : v.toFixed(d));
    console.log('| ' + idx + ' | ' + residual.toExponential(1) + ' | ('
      + claimed.x.toFixed(1) + ',' + claimed.y.toFixed(1) + ') | ' + dTrue.toFixed(1)
      + ' | ' + (probe ? probe.correlation.toFixed(4) : 'null') + ' | '
      + (probe ? probe.offsetX.toFixed(2) + ',' + probe.offsetY.toFixed(2) : '—')
      + ' | ' + fmt(c00) + ' | **' + fmt(cPr) + '** | ' + (rm ? fmt(rm.quiet) : '—')
      + ' | ' + (rm ? fmt(rm.finder) : '—') + ' | ' + (rm ? fmt(rm.span) : '—')
      + ' | ' + (cPr !== null && cPr >= 0.6 ? '**통과**' : '거절') + ' |');
  }
  console.log('');
}
