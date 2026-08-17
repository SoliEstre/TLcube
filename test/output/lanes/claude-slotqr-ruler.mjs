/**
 * claude-slotqr-ruler.mjs — 슬롯 QR 수리 레인 §1 자 검증.
 *
 * 손대지 않은 127d055 에서 브리프의 세 기준선을 직접 잰다:
 *   B1  진짜 QR 프레임(팔 A)의 v0wy 포즈 수 + 전체 포즈 회계 (v0w·v0w2·v0 …)
 *   B2  그때 diagnostics.slotQr 의 각 계수
 *   B3  결함 B 재현 — 슬롯에 QR 이 없는 팔(구멍 B · 단색 어두움 C2)의 v0wy 포즈 수
 *
 * 참고로 각 팔의 «정답 H 위 contrast» (검출기 미사용, 닫힌 형태 유도)도 같이 적는다
 * — 결함 B 의 서술(정답 H 에서 0.0000)과 대조하기 위해서다.
 *
 * 팔 구성은 claude-vy-refute-main.mjs 의 build() 와 같은 방법이다 (T 면 슬롯 구간만
 * 치환 · L/R 필러 무접촉). src 무수정 · 문턱 무수정.
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { faceBasis } from '../../../src/ygrid.js';
import {
  centerQrSlotCellsFor, centerQrSlotOriginFor, centerQrSlotPlacementFor,
  centerQrFinderCoreCells, centerQrQuietFrameCells,
} from '../../../src/cellSurfaceFinal.js';
import { TL_READER_URL } from '../../../src/qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { embed960 } from './claude-v0w2-leak.mjs';

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
const LAYOUT = 'v0wy';
const PPU = 15;

const applyFaceGain = (rgb, gain) => ({ r: rgb.r * gain, g: rgb.g * gain, b: rgb.b * gain });
const enc = encodeY(PAYLOAD, {
  cellSurfaceLayout: LAYOUT, version: 1, tones: 2, eccLevel: 'M',
});

const m = centerQrSlotCellsFor(LAYOUT);
const og = centerQrSlotOriginFor(LAYOUT, N);
const FLIP = centerQrSlotPlacementFor(LAYOUT).flip;

// ── 팔 만들기 (refute-main §build 과 같은 방법 · margin 4) ────────────────
const scene = buildSceneY(enc, { palette: PALETTE, margin: 4, qrText: TL_READER_URL });
const { ei, ej } = faceBasis('T');
const fp = (a, b) => ({
  x: scene.layout.originX + (a * ei.x + b * ej.x) * scene.layout.size,
  y: scene.layout.originY + (a * ei.y + b * ej.y) * scene.layout.size,
});
const quad = [fp(og.i, og.j), fp(og.i + m, og.j), fp(og.i + m, og.j + m), fp(og.i, og.j + m)];
const centroid = (s) => {
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
let first = -1; let last = -1; let count = 0;
for (let k = 0; k < scene.shapes.length; k += 1) {
  const s = scene.shapes[k];
  if (s.kind !== 'polygon' || s.points.length !== 4) continue;
  if (!inQuad(centroid(s))) continue;
  if (first < 0) first = k;
  last = k; count += 1;
}
if (count !== last - first + 1) throw new Error('슬롯 구간 불연속 — 치환 무효');

const gain = DEFAULT_FACE_GAINS.T;
const dark = applyFaceGain(BULLSEYE_DARK, gain);
const quadAt = (a, b, w) => [fp(a, b), fp(a + w, b), fp(a + w, b + w), fp(a, b + w)];
const ARMS = [
  ['A  기준선 (T 면 진짜 QR)', scene.shapes],
  ['B  T 슬롯 구멍 (도형 제거)', [...scene.shapes.slice(0, first), ...scene.shapes.slice(last + 1)]],
  ['C2 커스텀 전면 어두움', [...scene.shapes.slice(0, first),
    { kind: 'polygon', points: quadAt(og.i, og.j, m), color: dark },
    ...scene.shapes.slice(last + 1)]],
];

// ── 정답 H 위 contrast (검출기 미사용 · refute-ruler R2 와 같은 식) ───────
function correctHContrast(shapes) {
  const raster = rasterize({ ...scene, shapes }, { pixelsPerUnit: PPU, supersample: 2 });
  const frame = embed960(raster);
  const luma = toRelativeLuminance(frame);
  const ox = Math.floor((960 - raster.width) / 2);
  const oy = Math.floor((960 - raster.height) / 2);
  const facePixel = (face, a, b) => {
    const { ei: fi, ej: fj } = faceBasis(face);
    const wx = scene.layout.originX + ((og.i + a) * fi.x + (og.j + b) * fj.x) * scene.layout.size;
    const wy = scene.layout.originY + ((og.i + a) * fi.y + (og.j + b) * fj.y) * scene.layout.size;
    return { x: Math.round(wx * PPU + ox), y: Math.round(wy * PPU + oy) };
  };
  const at = (pt) => {
    if (pt.x < 0 || pt.y < 0 || pt.x >= luma.width || pt.y >= luma.height) return null;
    return luma.data[pt.y * luma.width + pt.x];
  };
  const quiet = []; const finder = []; const all = [];
  for (const cell of centerQrQuietFrameCells(m)) {
    const v = at(facePixel('T', cell.i + 0.5, cell.j + 0.5));
    if (v !== null) { quiet.push(v); all.push(v); }
  }
  for (const face of ['L', 'R']) {
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < m; j += 1) {
        const v = at(facePixel(face, i + 0.5, j + 0.5));
        if (v !== null) all.push(v);
      }
    }
  }
  for (const core of centerQrFinderCoreCells(m, FLIP)) {
    const v = at(facePixel('T', core.a, core.b));
    if (v !== null) { finder.push(v); all.push(v); }
  }
  const mean = (l) => l.reduce((s, v) => s + v, 0) / l.length;
  all.sort((a, b) => a - b);
  const pick = (q) => all[Math.min(all.length - 1, Math.floor(q * all.length))];
  const span = pick(0.95) - pick(0.05);
  return {
    luma,
    contrast: span > 1e-9 ? (mean(quiet) - mean(finder)) / span : null,
  };
}

console.log('# 슬롯 QR 수리 §1 — 자 검증 (127d055 무수정)');
console.log('치환 도형 ' + count + '개 (씬 인덱스 ' + first + '~' + last + ') · L/R 필러 무접촉');
console.log('');
console.log('| 팔 | 정답H contrast | v0wy | v0w | v0w2 | v0 | v0wq | slotQr 진단 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [label, shapes] of ARMS) {
  const c = correctHContrast(shapes);
  const det = detectCellSurfaceBlockShapes(c.luma, {});
  const pc = det.diagnostics.poseCount;
  console.log('| ' + label + ' | ' + (c.contrast === null ? 'null' : c.contrast.toFixed(4))
    + ' | **' + pc.v0wy + '** | ' + pc.v0w + ' | ' + pc.v0w2 + ' | ' + pc.v0 + ' | ' + pc.v0wq
    + ' | ' + JSON.stringify(det.diagnostics.slotQr) + ' |');
}
console.log('');
const detA = detectCellSurfaceBlockShapes(correctHContrast(ARMS[0][1]).luma, {});
console.log('팔 A 전체 poseCount = ' + JSON.stringify(detA.diagnostics.poseCount));
console.log('팔 A bullseyeConfirmed = ' + JSON.stringify(detA.diagnostics.bullseyeConfirmed));
