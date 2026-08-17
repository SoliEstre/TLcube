/**
 * claude-slotqr-instrument.mjs — 슬롯 QR 수리 레인 §3 · 고친 계기로 재측정.
 *
 * 결함 A 수리(구제 경로 거절 계수 + 경로별 분리) 후, 여섯 프레임에서
 *   · 확증 ON: poseCount.v0wy · slotQr { rejected, rejectedAnchored, rejectedBullseye }
 *   · 확증 OFF: poseCount.v0wy  (거절 총수의 대조 분모)
 * 를 잰다. 불변식 둘을 표에서 바로 검산한다:
 *   ① rejected === rejectedAnchored + rejectedBullseye
 *   ② rejected === (OFF 포즈 수 − ON 포즈 수)   — 잘린 후보가 전부 계수됐다는 뜻
 *      (ON/OFF 세계의 anchoredCentres 가 갈리면 ② 는 깨질 수 있다 — 그것도 관측이다)
 *
 * 팔 구성은 claude-slotqr-ruler.mjs 와 같다. cfg 는 반드시
 * options.calibration.csBlockLocator 로 넣는다 (평평한 키는 조용히 버려진다).
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { faceBasis } from '../../../src/ygrid.js';
import {
  centerQrSlotCellsFor, centerQrSlotOriginFor,
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
const NEEDS_QR = new Set(['v0wq', 'v0wy']);
const cal = (o) => ({ calibration: { csBlockLocator: o } });

function renderScene(layout, margin) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin };
  if (NEEDS_QR.has(layout)) opts.qrText = TL_READER_URL;
  return buildSceneY(encoded, opts);
}
const frameOf = (scene) => embed960(rasterize(scene, { pixelsPerUnit: 15, supersample: 2 }));

// ── v0WY 팔 (ruler 와 같은 방법) ─────────────────────────────────────────
const sceneY = renderScene('v0wy', 4);
const m = centerQrSlotCellsFor('v0wy');
const og = centerQrSlotOriginFor('v0wy', N);
const { ei, ej } = faceBasis('T');
const fp = (a, b) => ({
  x: sceneY.layout.originX + (a * ei.x + b * ej.x) * sceneY.layout.size,
  y: sceneY.layout.originY + (a * ei.y + b * ej.y) * sceneY.layout.size,
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
let first = -1; let last = -1;
for (let k = 0; k < sceneY.shapes.length; k += 1) {
  const s = sceneY.shapes[k];
  if (s.kind !== 'polygon' || s.points.length !== 4) continue;
  if (!inQuad(centroid(s))) continue;
  if (first < 0) first = k;
  last = k;
}
const gain = DEFAULT_FACE_GAINS.T;
const dark = { r: BULLSEYE_DARK.r * gain, g: BULLSEYE_DARK.g * gain, b: BULLSEYE_DARK.b * gain };
const quadAt = (a, b, w) => [fp(a, b), fp(a + w, b), fp(a + w, b + w), fp(a, b + w)];

const FRAMES = [
  ['A 진짜 QR (v0wy)', frameOf(sceneY)],
  ['B 슬롯 구멍', frameOf({ ...sceneY, shapes: [...sceneY.shapes.slice(0, first), ...sceneY.shapes.slice(last + 1)] })],
  ['C2 단색 어두움', frameOf({ ...sceneY, shapes: [...sceneY.shapes.slice(0, first),
    { kind: 'polygon', points: quadAt(og.i, og.j, m), color: dark },
    ...sceneY.shapes.slice(last + 1)] })],
  ['v0w 프레임', frameOf(renderScene('v0w', 4))],
  ['v0w2 프레임', frameOf(renderScene('v0w2', 4))],
  ['v0wq 프레임', frameOf(renderScene('v0wq', 4))],
];

console.log('# 슬롯 QR 수리 §3 — 고친 계기 (경로별 거절 계수)');
console.log('');
console.log('| 프레임 | ON v0wy | rejected | rejAnchored | rejBullseye | ①합일치 | OFF v0wy | ②전수계수 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [label, frame] of FRAMES) {
  const luma = toRelativeLuminance(frame);
  const on = detectCellSurfaceBlockShapes(luma, {}).diagnostics;
  const off = detectCellSurfaceBlockShapes(luma, cal({ v0wyRequireSlotQr: false })).diagnostics;
  const sq = on.slotQr;
  const sumOk = sq.rejected === sq.rejectedAnchored + sq.rejectedBullseye;
  const cut = off.poseCount.v0wy - on.poseCount.v0wy;
  console.log('| ' + label + ' | ' + on.poseCount.v0wy + ' | **' + sq.rejected + '** | '
    + sq.rejectedAnchored + ' | ' + sq.rejectedBullseye + ' | ' + (sumOk ? '○' : '✗')
    + ' | ' + off.poseCount.v0wy + ' | '
    + (sq.rejected === cut ? '○' : '✗ ' + sq.rejected + '≠' + cut) + ' |');
}
console.log('');
console.log('회귀 대조군 비침습 검산 — 포즈 회계 (ON, 출고 cfg):');
for (const [label, frame] of FRAMES) {
  const pc = detectCellSurfaceBlockShapes(toRelativeLuminance(frame), {}).diagnostics.poseCount;
  const nz = Object.entries(pc).filter(([, v]) => v > 0).map(([k, v]) => k + ':' + v).join(' ');
  console.log('- ' + label + ' → ' + nz);
}
