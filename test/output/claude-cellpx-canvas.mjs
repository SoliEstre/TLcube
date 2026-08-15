/**
 * claude-cellpx-canvas.mjs — 보조 arm: «캔버스 px» 가 로케이터 탐색 해상도를
 * 좌우하는지 분리한다 (읽기 전용 벤치, 커밋 대상 아님).
 *
 * cellsurface-block-detect 는 luma 를 searchMaxSide(=480) 로 **정수배 다운샘플**
 * 한 뒤 코어를 찾는다. 따라서 같은 cell_px 라도 캔버스가 크면(=n 이 크거나
 * 회전 여유를 준 정사각 캔버스면) 로케이터가 보는 유효 셀 px 이 정수배로 떨어진다.
 *
 * arm-raw     : 렌더 그대로(정사각 심기 없음), 회전 0
 * arm-embed   : 회전 여유 정사각 캔버스, 회전 0  (본 스윕과 같은 프레이밍)
 * 두 arm 의 차이는 오직 배경 여백 = 캔버스 px 이다.
 */
import { writeFileSync } from 'node:fs';
import { encodeY } from '../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { toRelativeLuminance } from '../../src/decoder/luma.js';
import { detectCellSurfaceBlockShapes } from '../../src/decoder/cellsurface-block-detect.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../src/luminance.js';

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
const MARGIN_CELLS = 4;
const CELL_PX = [7, 8, 9, 10, 12, 15];
const TONES = [2, 3];
const TARGETS = [
  { layout: 'v0', version: 0, n: 13 },
  { layout: 'v1r2', version: 1, n: 21 },
  { layout: 'v2r2', version: 1, n: 21 },
];

function gaussianBlur(raster, sigma) {
  const radius = Math.ceil(3 * sigma);
  const weights = new Float64Array(radius * 2 + 1);
  let weightSum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset + radius] = weight;
    weightSum += weight;
  }
  for (let i = 0; i < weights.length; i += 1) weights[i] /= weightSum;
  const { width, height } = raster;
  const horizontal = new Float32Array(width * height * 3);
  const pixels = new Uint8ClampedArray(raster.pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        let sum = 0;
        for (let o = -radius; o <= radius; o += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + o));
          sum += raster.pixels[(y * width + sx) * 4 + ch] * weights[o + radius];
        }
        horizontal[(y * width + x) * 3 + ch] = sum;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        let sum = 0;
        for (let o = -radius; o <= radius; o += 1) {
          const sy = Math.max(0, Math.min(height - 1, y + o));
          sum += horizontal[(sy * width + x) * 3 + ch] * weights[o + radius];
        }
        const v = Math.round(sum);
        pixels[(y * width + x) * 4 + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return { ...raster, pixels };
}

function embedSquare(raster) {
  const side = 2 * Math.ceil(Math.hypot(raster.width, raster.height) / 2);
  const out = {
    width: side, height: side, pixels: new Uint8ClampedArray(side * side * 4),
  };
  for (let k = 0; k < side * side; k += 1) {
    out.pixels[k * 4] = FILL.r;
    out.pixels[k * 4 + 1] = FILL.g;
    out.pixels[k * 4 + 2] = FILL.b;
    out.pixels[k * 4 + 3] = 255;
  }
  const ox = Math.floor((side - raster.width) / 2);
  const oy = Math.floor((side - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * side + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

function render(target, tones, cellPx) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: target.layout, version: target.version, tones, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: MARGIN_CELLS });
  return rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 });
}

function loc(image) {
  const det = detectCellSurfaceBlockShapes(toRelativeLuminance(image));
  const top = det.shapes && det.shapes.length ? det.shapes[0] : null;
  return {
    shapes: det.diagnostics.shapeCount,
    verified: det.diagnostics.verified.length,
    ds: det.diagnostics.downsampleFactor,
    topLayout: top && top.blockLocator ? (top.blockLocator.layoutId || null) : null,
  };
}

function dec(image) {
  const t0 = process.hrtime.bigint();
  const result = decodeFrontend(
    { width: image.width, height: image.height, pixels: image.pixels },
    { bootstrap: { family: { cube: { enableCellSurfaceY: true, enableLocatorY: true } } } },
  );
  return {
    ok: result.ok === true && result.text === PAYLOAD,
    reason: result.ok ? null : (result.reason || '(empty)'),
    ms: Number((Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)),
  };
}

const rows = [];
for (const cellPx of CELL_PX) {
  for (const target of TARGETS) {
    for (const tones of TONES) {
      const raw = render(target, tones, cellPx);
      const emb = embedSquare(raw);
      for (const arm of [{ id: 'raw', image: raw }, { id: 'embed', image: emb }]) {
        for (const ch of [{ id: 'clean', f: (i) => i }, { id: 'blur1.0', f: (i) => gaussianBlur(i, 1.0) }]) {
          const image = ch.f(arm.image);
          const l = loc(image);
          const d = dec(image);
          const row = {
            cellPx, layout: target.layout, tones, arm: arm.id, channel: ch.id,
            canvas: Math.max(image.width, image.height),
            ds: l.ds,
            effectiveCellPx: Number((cellPx / l.ds).toFixed(2)),
            locShapes: l.shapes, locVerified: l.verified, locTopLayout: l.topLayout,
            ok: d.ok, reason: d.reason, ms: d.ms,
          };
          rows.push(row);
          process.stderr.write(
            `c=${cellPx} ${target.layout} t=${tones} ${arm.id} ${ch.id} `
            + `canvas=${row.canvas} ds=${row.ds} eff=${row.effectiveCellPx} `
            + `loc=${row.locShapes} ok=${row.ok ? 'Y' : 'N'} ${row.reason || ''}\n`,
          );
        }
      }
    }
  }
}

writeFileSync(
  new URL('./claude-cellpx-canvas.json', import.meta.url),
  JSON.stringify({
    note: '캔버스 px ↔ 로케이터 다운샘플 결합 분리 arm. 회전 0 고정. 합성.',
    searchMaxSideDefault: 480,
    rows,
  }, null, 2) + '\n',
);
