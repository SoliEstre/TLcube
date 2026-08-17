/**
 * claude-v0t-family-interplay.mjs — v0W 계열 프레임 위에서 신설 v0t·v0ty 패밀리가
 * 어떤 포즈를 세우는지 실측 (드랍 복원 스위치 대조 — 블록 로케이터 회귀 갱신 재료).
 *
 * 재는 것: 프레임 4종(v0w · v0wq · v0w2 · v0wy) × cfg 2팔(기본 / v0W 계열 복원)의
 * poseCount 전체와 슬롯 QR 거절 계수. «비침습성» 회귀가 갱신할 값의 원천이다.
 */
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { TL_READER_URL } from '../../../src/qr.js';
import { hasCenterQrSlot } from '../../../src/cellSurfaceFinal.js';
import { distortImage } from '../../harness/distort.mjs';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';

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

function frameFor(layout) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4,
    ...(hasCenterQrSlot(layout) ? { qrText: TL_READER_URL } : {}),
  });
  const raster = rasterize(scene, { pixelsPerUnit: 15, supersample: 2 });
  const W = 960;
  const out = { width: W, height: W, pixels: new Uint8ClampedArray(W * W * 4) };
  for (let index = 0; index < W * W; index += 1) {
    out.pixels[index * 4] = FILL.r;
    out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b;
    out.pixels[index * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((W - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = 255;
    }
  }
  return out;
}
// 휘도 변환은 스위트와 같은 정본 함수를 쓴다 (자체 재구현 금지 — 구조가 다르면 죽는다).
const toLuma = toRelativeLuminance;

const RESTORE = {
  calibration: {
    csBlockLocator: {
      v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true,
    },
  },
};

for (const layout of ['v0w', 'v0wq', 'v0w2', 'v0wy', 'v0t', 'v0ty']) {
  const luma = toLuma(distortImage(frameFor(layout), { rotation: 0, fill: FILL }));
  const base = detectCellSurfaceBlockShapes(luma);
  const restored = detectCellSurfaceBlockShapes(luma, RESTORE);
  const nonZero = (pc) => Object.entries(pc).filter(([, v]) => v > 0)
    .map(([k, v]) => k + ':' + v).join(' ') || '(전부 0)';
  console.log('[' + layout + ' 프레임]');
  console.log('  기본 cfg   poseCount: ' + nonZero(base.diagnostics.poseCount)
    + ' · slotQr.rejected=' + base.diagnostics.slotQr.rejected);
  console.log('  계열 복원  poseCount: ' + nonZero(restored.diagnostics.poseCount)
    + ' · slotQr.rejected=' + restored.diagnostics.slotQr.rejected);
}
