/**
 * claude-finish-clip-probe.mjs — 잘린 프레임에서 **결정하는 단계**를 찾는 탐침.
 * 하나의 프레임만 만들어 bootstrap 진단을 통째로 덤프한다.
 *
 * 사용: node claude-finish-clip-probe.mjs [target] [mode] [level]
 */
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';

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
const CANVAS = 1280;
const QUIET_PAD = Number(process.argv[5] ?? 40);
const INK_THRESHOLD = 12;

const TARGETS = {
  'v0@13': { layout: 'v0', version: 0, ppu: 17 },
  'v0X@21': { layout: 'v0x', version: 1, ppu: 15 },
  'v1r2@21': { layout: 'v1r2', version: 1, ppu: 15 },
  'v2r2@21': { layout: 'v2r2', version: 1, ppu: 15 },
};

function embed(raster) {
  const out = {
    width: CANVAS, height: CANVAS, pixels: new Uint8ClampedArray(CANVAS * CANVAS * 4),
  };
  for (let i = 0; i < CANVAS * CANVAS; i += 1) {
    out.pixels[i * 4] = FILL.r;
    out.pixels[i * 4 + 1] = FILL.g;
    out.pixels[i * 4 + 2] = FILL.b;
    out.pixels[i * 4 + 3] = 255;
  }
  const ox = Math.floor((CANVAS - raster.width) / 2);
  const oy = Math.floor((CANVAS - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * CANVAS + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

function isInk(pixels, index) {
  return Math.abs(pixels[index] - FILL.r) > INK_THRESHOLD
    || Math.abs(pixels[index + 1] - FILL.g) > INK_THRESHOLD
    || Math.abs(pixels[index + 2] - FILL.b) > INK_THRESHOLD;
}

function inkBox(frame) {
  let minX = frame.width; let minY = frame.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (!isInk(frame.pixels, (y * frame.width + x) * 4)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { x0: minX, y0: minY, x1: maxX, y1: maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function windowFor(box, mode, fraction) {
  const winW = box.w + 2 * QUIET_PAD;
  const winH = box.h + 2 * QUIET_PAD;
  const biteX = fraction === 0 ? -QUIET_PAD : Math.round(fraction * box.w);
  const biteY = fraction === 0 ? -QUIET_PAD : Math.round(fraction * box.h);
  let x1 = box.x1 - biteX;
  let y1 = box.y1 - biteY;
  if (mode === 'corner-nw') { x1 = box.x0 + biteX + winW - 1; y1 = box.y0 + biteY + winH - 1; }
  else if (mode === 'edge-right') { y1 = box.y1 + QUIET_PAD; }
  return { x0: x1 - winW + 1, y0: y1 - winH + 1, x1, y1, w: winW, h: winH };
}

function crop(frame, win) {
  const out = { width: win.w, height: win.h, pixels: new Uint8ClampedArray(win.w * win.h * 4) };
  for (let y = 0; y < win.h; y += 1) {
    for (let x = 0; x < win.w; x += 1) {
      const s = ((y + win.y0) * frame.width + (x + win.x0)) * 4;
      const d = (y * win.w + x) * 4;
      out.pixels[d] = frame.pixels[s];
      out.pixels[d + 1] = frame.pixels[s + 1];
      out.pixels[d + 2] = frame.pixels[s + 2];
      out.pixels[d + 3] = frame.pixels[s + 3];
    }
  }
  return out;
}

const targetKey = process.argv[2] || 'v0@13';
const mode = process.argv[3] || 'edge-right';
const level = Number(process.argv[4] ?? 0.05);
const target = TARGETS[targetKey];

const encoded = encodeY(PAYLOAD, {
  cellSurfaceLayout: target.layout, version: target.version, tones: 2, eccLevel: 'M',
});
const base = embed(rasterize(
  buildSceneY(encoded, { palette: PALETTE, margin: 4 }),
  { pixelsPerUnit: target.ppu, supersample: 2 },
));
const box = inkBox(base);
const win = windowFor(box, mode, level);
const frame = crop(base, win);

const stages = [];
const result = decodeFrontend(frame, {
  bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
  onStage: (name, payload) => stages.push([name, payload && payload.ok]),
});

console.log('=== ' + targetKey + ' ' + mode + ' L' + level + ' window ' + win.w + 'x' + win.h);
console.log('ok:', result.ok, 'reason:', result.reason);
const seen = new Set();
console.log(JSON.stringify(result.detail ?? result.diagnostics ?? null, (key, value) => {
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
  }
  if (value instanceof Float64Array || value instanceof Uint8Array) return '[typed]';
  return value;
}, 1).slice(0, 6000));
