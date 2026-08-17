/** v0t 프레임 자기 검출 디버그 — 어느 단계에서 앵커드 시드가 죽는지 규명. */
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

for (const layout of ['v0t', 'v0ty', 'v0w']) {
  const luma = toRelativeLuminance(distortImage(frameFor(layout), { rotation: 0, fill: FILL }));
  const d = detectCellSurfaceBlockShapes(luma).diagnostics;
  const kinds = {};
  for (const hit of d.verified) kinds[hit.kind] = (kinds[hit.kind] || 0) + 1;
  console.log('[' + layout + ' 프레임]');
  console.log('  verified kinds: ' + JSON.stringify(kinds)
    + ' · cores=' + d.coreCandidates + ' clusters=' + d.clusterCount);
  console.log('  earlyBranch: ' + JSON.stringify(d.earlyBranch)
    + ' · squareRing.companionPairs=' + d.squareRing.companionPairs);
  console.log('  centerQr.corners(느슨한 코너)=' + d.centerQr.corners
    + ' · bullseyeConfirmed=' + JSON.stringify(d.bullseyeConfirmed));
  console.log('  poseCount: ' + JSON.stringify(d.poseCount));
  console.log('  slotQr: ' + JSON.stringify(d.slotQr));
}
