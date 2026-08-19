/**
 * claude-v0try-poseprobe.mjs — **어느 프레임에서 v0try 포즈가 서는가** (스위치 회귀의
 * 계측 기준을 고르기 위한 탐침).
 *
 * 조건을 `cellSurface-block-locator.test.js` 와 **문자 그대로 같게** 맞춘다
 * (ppu 15 · margin 4 · supersample 2 · 960 캔버스 중앙 배치 · rot 0).
 * 레인 하네스(`claude-v0try-detect.mjs`)는 embed960 을 안 쓰므로 값이 다르다 —
 * 그 차이가 첫 스위치 회귀를 빨갛게 만들었다.
 */
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { finalLayoutIdsForN, hasCenterQrSlot } from '../../../src/cellSurfaceFinal.js';
import { TL_READER_URL } from '../../../src/qr.js';
import { distortImage } from '../../harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PAYLOAD = 'https://tl.estre.so';

function renderFinal(layout, pixelsPerUnit = 15) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (hasCenterQrSlot(layout)) opts.qrText = TL_READER_URL;
  const scene = buildSceneY(encoded, opts);
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

function embed960(raster) {
  const W = 960;
  const H = 960;
  const out = { width: W, height: H, pixels: new Uint8ClampedArray(W * H * 4) };
  for (let index = 0; index < W * H; index += 1) {
    out.pixels[index * 4] = FILL.r;
    out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b;
    out.pixels[index * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((H - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

const LAYOUTS = [...finalLayoutIdsForN(21)];
const TONES = [
  ['clean', {}], ['sCurve0.6', { sCurve: 0.6 }],
  ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
];

console.log('조건: ppu 15 · margin 4 · supersample 2 · embed960 (블록 로케이터 회귀와 동일)');
console.log('\n=== poseCount — 프레임 × 톤 × 회전 (v0try 가 서는 칸을 찾는다) ===');
const standsIn = [];
for (const id of LAYOUTS) {
  const frame = embed960(renderFinal(id));
  for (const [label, tone] of TONES) {
    for (const rotation of [0, 120, 240]) {
      const luma = toRelativeLuminance(distortImage(frame, { ...tone, rotation, fill: FILL }));
      const pc = detectCellSurfaceBlockShapes(luma, { }).diagnostics.poseCount;
      const nonzero = Object.entries(pc).filter(([, v]) => v > 0)
        .map(([k, v]) => k + '=' + v).join(' · ');
      const mark = pc.v0try > 0 ? '  ★ v0try 선다' : '';
      console.log('  [%s %s rot%d] %s%s', id.padEnd(6), label.padEnd(9), rotation,
        nonzero || '(전부 0)', mark);
      if (pc.v0try > 0) standsIn.push({ id, label, rotation, count: pc.v0try });
    }
  }
}
console.log('\n=== v0try 포즈가 서는 칸 ===');
if (standsIn.length === 0) {
  console.log('  없음 — 스위치 회귀는 «끄면 0» 을 다른 방식으로 재야 한다.');
} else {
  for (const row of standsIn) {
    console.log('  %s · %s · rot%d → v0try=%d', row.id, row.label, row.rotation, row.count);
  }
}
