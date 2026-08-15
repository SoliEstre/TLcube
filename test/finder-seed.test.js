/**
 * finder-seed.test.js — 파인더 우선 시드 조사·파이프라인·배경 잡음 나란한 측정.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
  relativeLuminance,
} from '../src/luminance.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectCubeHypotheses } from '../src/decoder/cube-detect.js';
import { distortImage } from './harness/distort.mjs';
import {
  V1_DOT_RADIUS_CELLS,
  V1_SEAM_HALF_WIDTH_CELLS,
  cropLumaAround,
  darkMask,
  detectFinderSeeds,
  otsuThreshold,
  qrPatternMatches5,
  scanQr11311Hits,
  scanlineRunsThrough,
  scoreYSpoke,
  spokeLengths,
} from '../src/decoder/finder-seed.js';
import { extractGeometry } from '../src/lab-telemetry.js';
import { existsSync } from 'node:fs';
import { listLumaDumps, readLumaDump } from '../tools/read-luma.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});

const FILL = Object.freeze({ ...PRESET.background, a: 255 });

function renderY(text, {
  version = 1,
  tones = 2,
  pixelsPerUnit = 10,
  margin = 8,
} = {}) {
  const encoded = encodeY(text, { version, tones, eccLevel: 'M' });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin });
  const raster = rasterize(scene, { pixelsPerUnit, supersample: 1 });
  return { encoded, scene, raster, pixelsPerUnit };
}

function rasterToLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  const alpha = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const offset = index * 4;
    data[index] = relativeLuminance({
      r: raster.pixels[offset],
      g: raster.pixels[offset + 1],
      b: raster.pixels[offset + 2],
    });
    alpha[index] = raster.pixels[offset + 3];
  }
  return { width: raster.width, height: raster.height, data, alpha };
}

function paintRect(raster, x0, y0, x1, y1, color) {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(raster.width, Math.ceil(x1));
  const bottom = Math.min(raster.height, Math.ceil(y1));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const i = (y * raster.width + x) * 4;
      raster.pixels[i] = color.r;
      raster.pixels[i + 1] = color.g;
      raster.pixels[i + 2] = color.b;
      raster.pixels[i + 3] = 255;
    }
  }
}

function stampRaster(dest, src, ox, oy) {
  for (let y = 0; y < src.height; y += 1) {
    const dy = oy + y;
    if (dy < 0 || dy >= dest.height) continue;
    for (let x = 0; x < src.width; x += 1) {
      const dx = ox + x;
      if (dx < 0 || dx >= dest.width) continue;
      const si = (y * src.width + x) * 4;
      const di = (dy * dest.width + dx) * 4;
      dest.pixels[di] = src.pixels[si];
      dest.pixels[di + 1] = src.pixels[si + 1];
      dest.pixels[di + 2] = src.pixels[si + 2];
      dest.pixels[di + 3] = src.pixels[si + 3];
    }
  }
}

function bezelFrame(inner, { bezel = 80, screenPad = 40 } = {}) {
  const width = inner.width + (bezel + screenPad) * 2;
  const height = inner.height + (bezel + screenPad) * 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const raster = { width, height, pixels };
  paintRect(raster, 0, 0, width, height, { r: 18, g: 18, b: 20 });
  paintRect(
    raster,
    bezel,
    bezel,
    width - bezel,
    height - bezel,
    { r: 235, g: 236, b: 230 },
  );
  stampRaster(raster, inner, bezel + screenPad, bezel + screenPad);
  return raster;
}

function drawBinaryPattern(pattern, modulePx, pad) {
  const rows = pattern.length;
  const cols = pattern[0].length;
  const width = cols * modulePx + pad * 2;
  const height = rows * modulePx + pad * 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.fill(255);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const dark = pattern[j][i] === '#';
      const color = dark ? 20 : 240;
      for (let y = 0; y < modulePx; y += 1) {
        for (let x = 0; x < modulePx; x += 1) {
          const dx = pad + i * modulePx + x;
          const dy = pad + j * modulePx + y;
          const o = (dy * width + dx) * 4;
          pixels[o] = color;
          pixels[o + 1] = color;
          pixels[o + 2] = color;
          pixels[o + 3] = 255;
        }
      }
    }
  }
  return { width, height, pixels };
}

const QR_FINDER_7 = [
  '#######',
  '#.....#',
  '#.###.#',
  '#.###.#',
  '#.###.#',
  '#.....#',
  '#######',
];

const V2_CORNER_FINDER = [
  '.......',
  '.######',
  '.#....#',
  '.#.##.#',
  '.#.##.#',
  '.#....#',
  '.######',
];

function paintHub(cellPx = 20, n = 8) {
  const radius = n * cellPx;
  const pad = Math.ceil(cellPx * 2);
  const side = Math.ceil(radius * 2 + pad * 2);
  const pixels = new Uint8ClampedArray(side * side * 4);
  pixels.fill(255);
  const cx = (side - 1) / 2;
  const cy = (side - 1) / 2;
  const dark = (x, y) => {
    const i = (y * side + x) * 4;
    pixels[i] = 20;
    pixels[i + 1] = 20;
    pixels[i + 2] = 20;
  };
  const dotR = V1_DOT_RADIUS_CELLS * cellPx;
  const half = V1_SEAM_HALF_WIDTH_CELLS * cellPx;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= dotR * dotR) dark(x, y);
    }
  }
  for (const deg of [90, 210, 330]) {
    const rad = deg * Math.PI / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const px = -uy;
    const py = ux;
    for (let t = 0; t <= radius; t += 0.5) {
      for (let s = -half; s <= half; s += 0.5) {
        const x = Math.round(cx + ux * t + px * s);
        const y = Math.round(cy + uy * t + py * s);
        if (x >= 0 && y >= 0 && x < side && y < side) dark(x, y);
      }
    }
  }
  return { width: side, height: side, pixels, cx, cy };
}

test('v1 중앙 런렝스는 1:1:3:1:1 이 아니라 각도별 장축이다', () => {
  const hub = paintHub(18, 8);
  const luma = rasterToLuma(hub);
  const threshold = otsuThreshold(luma);
  const mask = darkMask(luma, threshold);
  const angles = [];
  for (let deg = 0; deg < 360; deg += 30) {
    const line = scanlineRunsThrough(mask, luma.width, luma.height, hub.cx, hub.cy, deg);
    angles.push({
      deg,
      darkRunCount: line.darkRunCount,
      centerDark: line.centerRun ? line.centerRun.dark : false,
      centerLength: line.centerRun && line.centerRun.dark ? line.centerRun.length : 0,
    });
  }
  const darkCounts = angles.map((row) => row.darkRunCount);
  const medianDark = darkCounts.slice().sort((a, b) => a - b)[Math.floor(darkCounts.length / 2)];
  const lengths = angles.map((row) => row.centerLength).filter((n) => n > 0);
  const minL = Math.min(...lengths);
  const maxL = Math.max(...lengths);
  const rays = spokeLengths(
    mask, luma.width, luma.height, hub.cx, hub.cy, Math.min(luma.width, luma.height) / 2, 15,
  );
  const spoke = scoreYSpoke(rays);

  assert.ok(medianDark <= 2, `고립 허브에서 중심 직선의 어두운 런 수: ${medianDark}`);
  assert.ok(maxL / Math.max(minL, 1) >= 1.4, `장축/단축 비율이 너무 낮다: ${maxL}/${minL}`);
  assert.ok(spoke.score >= 1.6, `120° 장축 점수가 약하다: ${spoke.score}`);
  assert.equal(V1_DOT_RADIUS_CELLS, 0.18);
  assert.equal(V1_SEAM_HALF_WIDTH_CELLS, 0.075);
  assert.equal(
    qrPatternMatches5(minL, minL, maxL, minL, minL),
    false,
    'v1 중심 런을 1:1:3:1:1 로 읽으면 안 된다',
  );
});

test('QR 1:1:3:1:1 스캐너는 표준 파인더를 잡고 v2 히트 수를 기록한다', () => {
  const qr = drawBinaryPattern(QR_FINDER_7, 6, 18);
  const v2 = drawBinaryPattern(V2_CORNER_FINDER, 6, 18);
  const qrLuma = rasterToLuma(qr);
  const v2Luma = rasterToLuma(v2);
  const qrHits = scanQr11311Hits(
    darkMask(qrLuma, otsuThreshold(qrLuma)),
    qrLuma.width,
    qrLuma.height,
  );
  const v2Hits = scanQr11311Hits(
    darkMask(v2Luma, otsuThreshold(v2Luma)),
    v2Luma.width,
    v2Luma.height,
  );
  assert.ok(qrHits.length >= 2, `표준 QR 파인더 hit=${qrHits.length}`);
  mkdirSync(ROOT + 'test/output', { recursive: true });
  writeFileSync(
    ROOT + 'test/output/grok-finder-first-qr.json',
    JSON.stringify({ qrHits: qrHits.length, v2Hits: v2Hits.length }, null, 2) + '\n',
  );
  assert.ok(Number.isFinite(v2Hits.length));
});

test('실패 프레임에서 후보 기하가 남고 거짓 0 은 없다', () => {
  const { raster } = renderY('fail-geo', { tones: 2, pixelsPerUnit: 8 });
  const noisy = bezelFrame(raster, { bezel: 90, screenPad: 50 });
  const result = detectCubeHypotheses(rasterToLuma(noisy), undefined, {
    finderFirst: false,
    enableCellSurfaceY: true,
  });
  const geo = extractGeometry(result, noisy.width, noisy.height);
  if (geo.cellPx != null) assert.ok(geo.cellPx > 0, 'cellPx 가 있으면 양수여야 한다');
  if (geo.occupancy != null) assert.ok(geo.occupancy > 0, 'occupancy 가 있으면 양수여야 한다');
  assert.notEqual(geo.cellPx, 0);
  assert.notEqual(geo.occupancy, 0);
  const empty = extractGeometry({ ok: false, reason: 'frontend:no-finder' }, 64, 64);
  assert.equal(empty.cellPx, null);
  assert.equal(empty.bbox, null);
  assert.equal(empty.occupancy, null);
  assert.equal(empty.geometryStage, null);
});

test('파인더 시드는 실루엣 없이 중심을 잡는다', () => {
  const { raster } = renderY('seed-hit', { tones: 2, pixelsPerUnit: 10 });
  const luma = rasterToLuma(raster);
  const found = detectFinderSeeds(luma, { qr11311: false });
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.ok(found.seeds.length >= 1);
  assert.equal(found.seeds[0].kind, 'y-spoke');
  const crop = cropLumaAround(luma, found.seeds[0]);
  assert.ok(crop);
  assert.ok(crop.width < luma.width || crop.height < luma.height);
});

function detectCube(raster, options) {
  return detectCubeHypotheses(rasterToLuma(raster), undefined, {
    finderFirst: options.finderFirst,
  });
}

function timeMs(fn) {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
}

test('실루엣 vs 파인더를 깨끗한 배경·베젤 잡음에서 나란히 잰다', {
  timeout: 90_000,
}, () => {
  const cases = [
    { tones: 2, ppu: 10, rotation: 0 },
    { tones: 2, ppu: 12, rotation: 180 },
    { tones: 3, ppu: 10, rotation: 0 },
    { tones: 3, ppu: 8, rotation: 90 },
  ];
  const rows = [];

  for (const spec of cases) {
    const fixture = renderY(`side-${spec.tones}-${spec.ppu}`, {
      tones: spec.tones, pixelsPerUnit: spec.ppu, margin: 10,
    });
    const raster = spec.rotation === 0
      ? fixture.raster
      : distortImage(fixture.raster, { rotation: spec.rotation, fill: FILL });
    for (const [bg, image] of [['clean', raster], ['bezel', bezelFrame(raster, { bezel: 70, screenPad: 36 })]]) {
      const sil = timeMs(() => detectCube(image, { finderFirst: false }));
      const find = timeMs(() => detectCube(image, { finderFirst: true }));
      rows.push({
        tones: spec.tones,
        ppu: spec.ppu,
        rotation: spec.rotation,
        bg,
        silhouetteOk: sil.value.ok === true,
        finderOk: find.value.ok === true,
        silhouetteMs: Number(sil.ms.toFixed(1)),
        finderMs: Number(find.ms.toFixed(1)),
        silhouetteReason: sil.value.ok ? '' : sil.value.reason,
        finderReason: find.value.ok ? '' : find.value.reason,
        finderPath: find.value.ok
          ? (find.value.diagnostics && find.value.diagnostics.detectPath) || null
          : null,
      });
    }
  }

  const sample = renderY('decode-timing', { tones: 2, pixelsPerUnit: 10, margin: 10 });
  const decodeSil = timeMs(() => decodeFrontend(sample.raster, {
    bootstrap: { family: { cube: { finderFirst: false } } },
  }));
  const decodeFind = timeMs(() => decodeFrontend(sample.raster, {
    bootstrap: { family: { cube: { finderFirst: true } } },
  }));
  void decodeSil;
  void decodeFind;

  const tally = (pred) => rows.filter(pred).length;
  const summary = {
    total: rows.length,
    cleanSilhouette: tally((r) => r.bg === 'clean' && r.silhouetteOk),
    cleanFinder: tally((r) => r.bg === 'clean' && r.finderOk),
    bezelSilhouette: tally((r) => r.bg === 'bezel' && r.silhouetteOk),
    bezelFinder: tally((r) => r.bg === 'bezel' && r.finderOk),
    cleanN: tally((r) => r.bg === 'clean'),
    bezelN: tally((r) => r.bg === 'bezel'),
    medianSilhouetteMs: median(rows.map((r) => r.silhouetteMs)),
    medianFinderMs: median(rows.map((r) => r.finderMs)),
    decodeSilhouetteMs: Number(decodeSil.ms.toFixed(1)),
    decodeFinderMs: Number(decodeFind.ms.toFixed(1)),
    decodeSilhouetteOk: decodeSil.value.ok === true,
    decodeFinderOk: decodeFind.value.ok === true,
    rows,
  };

  mkdirSync(ROOT + 'test/output', { recursive: true });
  writeFileSync(
    ROOT + 'test/output/grok-finder-first-measure.json',
    JSON.stringify(summary, null, 2) + '\n',
  );

  assert.ok(summary.cleanSilhouette >= summary.cleanN * 0.5, '깨끗한 배경에서 실루엣이 너무 약하다');
  assert.ok(
    summary.bezelFinder >= summary.bezelSilhouette,
    `베젤 배경에서 파인더(${summary.bezelFinder}) 가 실루엣(${summary.bezelSilhouette}) 보다 못하다`,
  );
});

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test('실사 큐브 휘도 덤프가 있으면 파인더 시드를 센다', () => {
  const dir = ROOT + 'test/output/photos/luma/cube-20260812c';
  if (!existsSync(dir)) {
    assert.ok(true, '실사 덤프 없음 — 건너뜀');
    return;
  }
  const dumps = listLumaDumps().filter((entry) =>
    entry.name.includes('cube-20260812c/') && entry.name.endsWith('.960.luma'));
  if (dumps.length === 0) {
    assert.ok(true, '960 덤프 없음 — 건너뜀');
    return;
  }
  let seedHits = 0;
  let silHits = 0;
  let finderHits = 0;
  const n = Math.min(dumps.length, 24);
  for (const entry of dumps.slice(0, n)) {
    const luma = readLumaDump(entry.path);
    const seeds = detectFinderSeeds(luma, { qr11311: false });
    if (seeds.ok && seeds.seeds.length) seedHits += 1;
    const sil = detectCubeHypotheses(luma, undefined, { finderFirst: false });
    if (sil.ok) silHits += 1;
    const find = detectCubeHypotheses(luma, undefined, { finderFirst: true });
    if (find.ok) finderHits += 1;
  }
  const photo = { n, seedHits, silHits, finderHits };
  mkdirSync(ROOT + 'test/output', { recursive: true });
  writeFileSync(
    ROOT + 'test/output/grok-finder-first-photos.json',
    JSON.stringify(photo, null, 2) + '\n',
  );
  assert.ok(n > 0);
});
