/**
 * probe-steady-tolerance.mjs — 「안정 유지」 시각 톨러런스의 근거 실측.
 *
 * `src/scan-steady.js` 의 `STEADY_VISUAL_TOLERANCE` 는 0 이 아니어야 한다 — 사람 손은
 * 완전히 멈추지 않는다. 그렇다고 크면 「움직였는데 안정」 이 되어 가이드-사전 포즈가
 * 전부 게이트에서 죽는다. 그래서 두 지대 사이를 재서 고른다:
 *
 *   ① 손떨림 정지 (부화소\~0.3 셀 이동, ≲0.5° 회전, 노출 ±5%) → **안정으로 인정**해야 함
 *   ② 사전 포즈가 못 따라가는 이동 (≳0.6 셀 — probe-guide-prior 의 포획 봉투 밖)
 *      → **불안정으로 거부**해야 함
 *
 * 실행: node tools/probes/probe-steady-tolerance.mjs
 */

import { encode } from '../../src/encode.js';
import { buildScene } from '../../src/scene.js';
import { rasterize } from '../../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../../src/luminance.js';
import { layoutCellPx, PRIOR_LAYOUTS } from '../../src/scan-guide-prior.js';
import {
  lumaSignature,
  signatureDistance,
  STEADY_ANCHOR_TOLERANCE,
  STEADY_VISUAL_TOLERANCE,
} from '../../src/scan-steady.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const FRAME_SIDE = 960;

const LAYOUT = PRIOR_LAYOUTS[0]; // O-k6 — 가이드 기준 셀 12.96px
const CELL_PX = layoutCellPx(LAYOUT, FRAME_SIDE);
const encoded = encode('tlcube steady', { version: 1, eccLevel: 'M' });
const scene = buildScene(encoded, { palette: PALETTE, margin: 1 });
const raster = rasterize(scene, { pixelsPerUnit: CELL_PX, supersample: 2 });

/** 렌더를 프레임에 놓는다 — 이동(px) · 회전(deg) · 노출 배율. */
function place({ dx = 0, dy = 0, degrees = 0, exposure = 1, noise = 0, seed = 1 } = {}) {
  const pixels = new Uint8ClampedArray(FRAME_SIDE * FRAME_SIDE * 4);
  const ppu = raster.pixelsPerUnit;
  const originX = scene.layout.originX * ppu;
  const originY = scene.layout.originY * ppu;
  const cx = FRAME_SIDE / 2 + dx;
  const cy = FRAME_SIDE / 2 + dy;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // 결정적 잡음 (xorshift)
  let state = (seed >>> 0) || 1;
  const nextNoise = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return ((state / 4294967296) - 0.5) * 2 * noise;
  };

  for (let y = 0; y < FRAME_SIDE; y += 1) {
    for (let x = 0; x < FRAME_SIDE; x += 1) {
      const rx = x - cx;
      const ry = y - cy;
      const sx = cos * rx + sin * ry + originX;
      const sy = -sin * rx + cos * ry + originY;
      const offset = (y * FRAME_SIDE + x) * 4;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const jitter = noise > 0 ? nextNoise() : 0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= raster.width || y0 + 1 >= raster.height) {
        pixels[offset] = Math.max(0, Math.min(255, FILL.r * exposure + jitter));
        pixels[offset + 1] = Math.max(0, Math.min(255, FILL.g * exposure + jitter));
        pixels[offset + 2] = Math.max(0, Math.min(255, FILL.b * exposure + jitter));
        pixels[offset + 3] = 255;
        continue;
      }
      const tx = sx - x0;
      const ty = sy - y0;
      for (let channel = 0; channel < 3; channel += 1) {
        const p00 = raster.pixels[(y0 * raster.width + x0) * 4 + channel];
        const p10 = raster.pixels[(y0 * raster.width + x0 + 1) * 4 + channel];
        const p01 = raster.pixels[((y0 + 1) * raster.width + x0) * 4 + channel];
        const p11 = raster.pixels[((y0 + 1) * raster.width + x0 + 1) * 4 + channel];
        const value = p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty)
          + p01 * (1 - tx) * ty + p11 * tx * ty;
        pixels[offset + channel] = Math.max(0, Math.min(255, value * exposure + jitter));
      }
      pixels[offset + 3] = 255;
    }
  }
  return { width: FRAME_SIDE, height: FRAME_SIDE, data: pixels };
}

const reference = lumaSignature(place({}));
function deltaFor(options) {
  return signatureDistance(reference, lumaSignature(place(options)));
}

const rows = [];
const push = (axis, label, cells, value) => rows.push({
  axis,
  label,
  cells: cells === null ? null : Number(cells.toFixed(3)),
  delta: Number(value.toFixed(5)),
  /** 프레임 간 판정 */
  frameVerdict: value <= STEADY_VISUAL_TOLERANCE ? 'stable' : 'moving',
  /** anchor(유지 시작 시점) 대비 누적 판정 */
  anchorVerdict: value <= STEADY_ANCHOR_TOLERANCE ? 'held' : 'broken',
});

push('identity', 'same frame', 0, deltaFor({}));
for (const noise of [1, 2, 4]) {
  push('noise', '±' + noise + '/255 센서 잡음', 0, deltaFor({ noise, seed: 7 }));
}
for (const exposure of [1.02, 1.05, 1.1]) {
  push('exposure', '노출 ×' + exposure, 0, deltaFor({ exposure }));
}
for (const dx of [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24]) {
  push('translate', dx + 'px', dx / CELL_PX, deltaFor({ dx }));
}
for (const degrees of [0.1, 0.25, 0.5, 1, 2, 4]) {
  push('rotate', degrees + '°', null, deltaFor({ degrees }));
}

console.log(JSON.stringify({
  frameSide: FRAME_SIDE,
  layout: LAYOUT.id,
  cellPx: Number(CELL_PX.toFixed(2)),
  tolerance: STEADY_VISUAL_TOLERANCE,
  anchorTolerance: STEADY_ANCHOR_TOLERANCE,
  rows,
}, null, 2));
