/**
 * claude-v0t-toneladder.mjs — v0T·v0TY 톤 사다리 × 회전 전수 (v0W 계열 자기 복호
 * 회귀와 같은 조건: ppu 15 · margin 4 · embed 960 · 톤 4종 × rot 0/120/240).
 *
 * 배경: 블록 로케이터가 v0t 프레임 rot0 에서 자기 포즈 0 이다 (W 블록의 3면
 * 불스아이 유사 서명이 중앙 상위 3 슬라이스를 밀어낸다 — `claude-v0t-detect-debug`).
 * 복호는 실루엣 경로로 성립하지만, 블록 로케이터의 존재 이유가 톤 열화 구간이므로
 * **끝-대-끝**으로 그 구간을 재야 편입의 실제 강건성을 말할 수 있다.
 */
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { TL_READER_URL } from '../../../src/qr.js';
import { hasCenterQrSlot } from '../../../src/cellSurfaceFinal.js';
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

const TONES = [
  ['clean', {}], ['sCurve0.6', { sCurve: 0.6 }],
  ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
];
for (const layout of ['v0t', 'v0ty']) {
  const frame = frameFor(layout);
  console.log('=== ' + layout + ' — 톤 4 × 회전 3 (끝-대-끝) ===');
  let pass = 0;
  for (const [label, tone] of TONES) {
    const row = [];
    for (const rotation of [0, 120, 240]) {
      const distorted = distortImage(frame, { ...tone, rotation, fill: FILL });
      const decoded = decodeFrontend({
        width: distorted.width, height: distorted.height, pixels: distorted.pixels,
      }, {
        bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
      });
      const ok = decoded.ok && decoded.text === PAYLOAD
        && decoded.hypothesis.cellSurfaceLayout === layout;
      if (ok) pass += 1;
      row.push('rot' + rotation + '=' + (ok ? 'ok' : ('★' + (decoded.ok
        ? ('layout ' + decoded.hypothesis.cellSurfaceLayout) : decoded.reason))));
    }
    console.log('  ' + label.padEnd(10) + row.join(' · '));
  }
  console.log('  합계 ' + pass + '/12');
}
