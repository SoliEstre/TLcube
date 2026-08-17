/**
 * claude-slotqr-phase.mjs — 슬롯 QR 수리 레인 §3.6 · 위상별 해부.
 *
 * 구제 경로의 v0wy 후보 3개는 같은 삼중점의 세 코너에서 시드된 **세 120° 위상**이다.
 * 셰이프 dedupe 가 위상을 지우므로(육각 발자국이 같다), 복원한 H 에 canonical 120°
 * 회전을 합성해 세 위상 H 를 전부 만들고, 각 위상에서 게이트 계산을 재연한다:
 *   probe = registerPatch(…)  →  corr 하한 0.25  →  contrast @probe  →  문턱 0.6.
 *
 * src 무수정 · 문턱 무수정 (수리 후 게이트의 판정을 위상별로 보는 것이다).
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
import { distortImage } from '../../harness/distort.mjs';
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

const ARMS = [
  ['A 진짜 QR', sceneY.shapes],
  ['B 슬롯 구멍', [...sceneY.shapes.slice(0, first), ...sceneY.shapes.slice(last + 1)]],
  ['C2 단색 어두움', [...sceneY.shapes.slice(0, first),
    { kind: 'polygon', points: quadAt(og.i, og.j, m), color: dark },
    ...sceneY.shapes.slice(last + 1)]],
];

function solveH(correspondences) {
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
/** H · R(θ) — canonical 좌표를 θ 회전한 뒤 H 로 투영 (포즈의 120° 위상 형제). */
function composeRotation(H, theta) {
  const c = Math.cos(theta); const s = Math.sin(theta);
  const out = new Float64Array(9);
  // 열 연산: R 의 열 = [c,s,0] · [−s,c,0] · [0,0,1]
  out[0] = H[0] * c + H[1] * s; out[1] = -H[0] * s + H[1] * c; out[2] = H[2];
  out[3] = H[3] * c + H[4] * s; out[4] = -H[3] * s + H[4] * c; out[5] = H[5];
  out[6] = H[6] * c + H[7] * s; out[7] = -H[6] * s + H[7] * c; out[8] = H[8];
  return out;
}

const patches = patchesFor(N, 'v0wy');
const slotPatch = patches.slotQr;
const centrePatch = patches.centre;

/** 패치 p95−p5 (동적 범위) — 게이트 후보 조건 ③(span 상응성)의 재료. */
function patchSpanOf(luma, H, patch, offsetX, offsetY) {
  const bilinearAt = (lu, x, y) => {
    const x0 = Math.floor(x); const y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= lu.width || y0 + 1 >= lu.height) return null;
    const fx = x - x0; const fy = y - y0;
    const base = y0 * lu.width + x0;
    const top = lu.data[base] * (1 - fx) + lu.data[base + 1] * fx;
    const bot = lu.data[base + lu.width] * (1 - fx) + lu.data[base + lu.width + 1] * fx;
    return top * (1 - fy) + bot * fy;
  };
  const values = [];
  for (const point of patch.points) {
    const image = project(H, point);
    if (!image) continue;
    const v = bilinearAt(luma, image.x + offsetX, image.y + offsetY);
    if (v === null) continue;
    values.push(v);
  }
  if (values.length < 20) return null;
  values.sort((a, b) => a - b);
  const pick = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  return pick(0.95) - pick(0.05);
}
const baseRaster = rasterize(sceneY, { pixelsPerUnit: PPU, supersample: 2 });
const OX = Math.floor((960 - baseRaster.width) / 2);
const OY = Math.floor((960 - baseRaster.height) / 2);
const slotCentreWorld = fp(og.i + m / 2, og.j + m / 2);
const TRUE_SLOT = { x: slotCentreWorld.x * PPU + OX, y: slotCentreWorld.y * PPU + OY };
// canonical T 슬롯 중심 (패치와 같은 좌표계 — CANONICAL size 1, origin 0).
const CANON_SLOT = {
  x: (og.i + m / 2) * ei.x + (og.j + m / 2) * ej.x,
  y: (og.i + m / 2) * ei.y + (og.j + m / 2) * ej.y,
};

function roleMeans(luma, H, offsetX, offsetY) {
  const bilinearAt = (lu, x, y) => {
    const x0 = Math.floor(x); const y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= lu.width || y0 + 1 >= lu.height) return null;
    const fx = x - x0; const fy = y - y0;
    const base = y0 * lu.width + x0;
    const top = lu.data[base] * (1 - fx) + lu.data[base + 1] * fx;
    const bot = lu.data[base + lu.width] * (1 - fx) + lu.data[base + lu.width + 1] * fx;
    return top * (1 - fy) + bot * fy;
  };
  const quiet = []; const finder = []; const slot = []; const values = [];
  for (const point of slotPatch.points) {
    const image = project(H, point);
    if (!image) continue;
    const v = bilinearAt(luma, image.x + offsetX, image.y + offsetY);
    if (v === null) continue;
    values.push(v);
    if (point.role === 'quiet') quiet.push(v);
    else if (point.role === 'finder') finder.push(v);
    else slot.push(v);
  }
  const mean = (l) => (l.length ? l.reduce((s, v) => s + v, 0) / l.length : null);
  values.sort((a, b) => a - b);
  const pick = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  return {
    quiet: mean(quiet), finder: mean(finder), slot: mean(slot),
    span: values.length ? pick(0.95) - pick(0.05) : null,
  };
}

console.log('# 슬롯 QR 수리 §3.6 — 세 120° 위상 각각의 게이트 판정 (수리 후 소스)');
console.log('');
console.log('실제 T 슬롯 중심 (이미지 px) = (' + TRUE_SLOT.x.toFixed(1) + ', ' + TRUE_SLOT.y.toFixed(1) + ')');
console.log('');
for (const [label, shapes] of ARMS) {
  const frame = embed960(rasterize({ ...sceneY, shapes }, { pixelsPerUnit: PPU, supersample: 2 }));
  const luma = toRelativeLuminance(frame);
  const det = detectCellSurfaceBlockShapes(luma, cal({ v0wyRequireSlotQr: false }));
  const wyShapes = det.shapes.filter((s) => s.blockLocator && s.blockLocator.layoutId === 'v0wy');
  console.log('## ' + label + ' — OFF 포즈 ' + det.diagnostics.poseCount.v0wy
    + ' · 셰이프 ' + wyShapes.length);
  console.log('| 셰이프 | 위상 | 실슬롯거리px | corr | corr≥0.25 | offset | 경계? | c@probe | quiet | slot | finder | span | centreSpan | **비 span/centre** | 판정 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  let si = 0;
  for (const shape of wyShapes) {
    si += 1;
    const corr = [];
    for (let k = 0; k < 6; k += 1) {
      corr.push([{ x: CORNER_UNIT_OFFSETS[k].x * N, y: CORNER_UNIT_OFFSETS[k].y * N },
        shape.vertices[k]]);
    }
    corr.push([{ x: 0, y: 0 }, shape.center]);
    const H0 = solveH(corr);
    if (!H0) continue;
    for (const [pName, theta] of [['0°', 0], ['120°', (2 * Math.PI) / 3], ['240°', (4 * Math.PI) / 3]]) {
      const H = composeRotation(H0, theta);
      const claimed = project(H, CANON_SLOT);
      const dTrue = Math.hypot(claimed.x - TRUE_SLOT.x, claimed.y - TRUE_SLOT.y);
      const e = project(H, { x: 1, y: 0 });
      const s0 = project(H, { x: 0, y: 1 });
      const o0 = project(H, { x: 0, y: 0 });
      const cellPx = (Math.hypot(e.x - o0.x, e.y - o0.y) + Math.hypot(s0.x - o0.x, s0.y - o0.y)) / 2;
      const rangePx = 0.5 * cellPx;
      const probe = registerPatch(luma, H, slotPatch, rangePx, Math.max(0.5, 0.25 * cellPx));
      const okCorr = probe !== null && probe.correlation >= 0.25;
      const cPr = probe ? centreQrFinderContrast(luma, H, slotPatch, probe.offsetX, probe.offsetY) : null;
      const rm = probe ? roleMeans(luma, H, probe.offsetX, probe.offsetY) : null;
      // 경계 히트 — 오프셋 그리드의 가장자리 셀에서 최대가 났다는 뜻 (수렴 아님).
      const atEdge = probe !== null
        && (Math.abs(Math.abs(probe.offsetX) - rangePx) < 1e-6
          || Math.abs(Math.abs(probe.offsetY) - rangePx) < 1e-6);
      const centreSpan = probe ? patchSpanOf(luma, H, centrePatch, 0, 0) : null;
      const ratio = rm && rm.span !== null && centreSpan !== null && centreSpan > 1e-9
        ? rm.span / centreSpan : null;
      // 수리 후 게이트 전체 재연: ① corr ≥ 0.25 · ③ span 비 ≥ 0.35 · ② contrast ≥ 0.6.
      const okRatio = ratio !== null && ratio >= 0.35;
      const pass = okCorr && okRatio && cPr !== null && cPr >= 0.6;
      const f4 = (v) => (v === null || v === undefined ? 'null' : v.toFixed(4));
      console.log('| ' + si + ' | ' + pName + ' | ' + dTrue.toFixed(1)
        + ' | ' + (probe ? probe.correlation.toFixed(4) : 'null')
        + ' | ' + (okCorr ? '○' : '✗') + ' | '
        + (probe ? probe.offsetX.toFixed(2) + ',' + probe.offsetY.toFixed(2) : '—')
        + ' | ' + (atEdge ? '**경계**' : '내부') + ' | ' + f4(cPr)
        + ' | ' + (rm ? f4(rm.quiet) : '—') + ' | ' + (rm ? f4(rm.slot) : '—')
        + ' | ' + (rm ? f4(rm.finder) : '—') + ' | ' + (rm ? f4(rm.span) : '—')
        + ' | ' + f4(centreSpan) + ' | **' + f4(ratio) + '**'
        + ' | ' + (pass ? '**통과**' : '거절') + ' |');
    }
  }
  console.log('');
}

// ── 톤 사다리 위의 진짜 포즈 — 조건 ①(corr)·③(span 비) 의 열화 봉투 ──────
console.log('## 톤 사다리 — 진짜 QR 프레임, 진짜 위상의 게이트 재료 열화');
console.log('| 톤 | v0wy 셰이프 | corr | c@probe | span | centreSpan | **비** |');
console.log('|---|---|---|---|---|---|---|');
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const baseFrame = embed960(rasterize(sceneY, { pixelsPerUnit: PPU, supersample: 2 }));
for (const [tName, tone] of [
  ['clean', null], ['sCurve0.6', { sCurve: 0.6 }],
  ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
]) {
  const frame = tone ? distortImage(baseFrame, { ...tone, fill: FILL }) : baseFrame;
  const luma = toRelativeLuminance(frame);
  const det = detectCellSurfaceBlockShapes(luma, cal({ v0wyRequireSlotQr: false }));
  const wyShapes = det.shapes.filter((s) => s.blockLocator && s.blockLocator.layoutId === 'v0wy');
  let best = null;
  for (const shape of wyShapes) {
    const corr = [];
    for (let k = 0; k < 6; k += 1) {
      corr.push([{ x: CORNER_UNIT_OFFSETS[k].x * N, y: CORNER_UNIT_OFFSETS[k].y * N },
        shape.vertices[k]]);
    }
    corr.push([{ x: 0, y: 0 }, shape.center]);
    const H0 = solveH(corr);
    if (!H0) continue;
    for (const theta of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
      const H = composeRotation(H0, theta);
      const claimed = project(H, CANON_SLOT);
      const dTrue = Math.hypot(claimed.x - TRUE_SLOT.x, claimed.y - TRUE_SLOT.y);
      if (dTrue > 20) continue; // 진짜 위상만
      const e = project(H, { x: 1, y: 0 });
      const s0 = project(H, { x: 0, y: 1 });
      const o0 = project(H, { x: 0, y: 0 });
      const cellPx = (Math.hypot(e.x - o0.x, e.y - o0.y) + Math.hypot(s0.x - o0.x, s0.y - o0.y)) / 2;
      const probe = registerPatch(luma, H, slotPatch, 0.5 * cellPx, Math.max(0.5, 0.25 * cellPx));
      if (!probe) continue;
      const cPr = centreQrFinderContrast(luma, H, slotPatch, probe.offsetX, probe.offsetY);
      const rm = roleMeans(luma, H, probe.offsetX, probe.offsetY);
      const cSpan = patchSpanOf(luma, H, centrePatch, 0, 0);
      const ratio = rm.span !== null && cSpan !== null && cSpan > 1e-9 ? rm.span / cSpan : null;
      if (best === null || probe.correlation > best.corr) {
        best = { corr: probe.correlation, cPr, span: rm.span, cSpan, ratio };
      }
    }
  }
  const f4 = (v) => (v === null || v === undefined ? 'null' : v.toFixed(4));
  console.log('| ' + tName + ' | ' + wyShapes.length + ' | '
    + (best ? f4(best.corr) : '—') + ' | ' + (best ? f4(best.cPr) : '—')
    + ' | ' + (best ? f4(best.span) : '—') + ' | ' + (best ? f4(best.cSpan) : '—')
    + ' | **' + (best ? f4(best.ratio) : '—') + '** |');
}
