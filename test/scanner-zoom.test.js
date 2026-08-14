/**
 * scanner-zoom.test.js — 트랙 확대 · 원본 크롭 · 실효 배율 · 조준 가이드 수치.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { eventRow, parseEnvelope } from '../relay/protocol.mjs';
import { encode } from '../src/encode.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import {
  makeEnvelope,
  normalizeFrameBody,
} from '../src/lab-telemetry.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import {
  AIM_RECOMMEND,
  AIM_RECOMMEND_MAX,
  AIM_RECOMMEND_MIN,
  CELL_PX_FLOOR,
  FRAME_MAX_SIDE,
  GUIDE_CELLS_V3,
  GUIDE_CELLS_Y2,
  aimGuideFractions,
  applyTrackZoom,
  buttonStep,
  cropWindow,
  effectiveMagnification,
  parseZoomCapability,
  resolveZoomPlan,
  snapZoom,
  zoomConstraint,
  zoomMismatch,
  zoomTelemetry,
} from '../src/scanner-zoom.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCANNER_JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
const SCANNER_HTML = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

test('하드웨어 zoom 능력은 min<max 일 때만 인정한다', () => {
  assert.equal(parseZoomCapability(null), null);
  assert.equal(parseZoomCapability({}), null);
  assert.equal(parseZoomCapability({ zoom: { min: 1, max: 1 } }), null);
  assert.deepEqual(parseZoomCapability({ zoom: { min: 1, max: 8, step: 0.1 } }), {
    min: 1, max: 8, step: 0.1,
  });
});

test('applyTrackZoom 은 advanced[{zoom}] 을 쓰고 거부를 숨기지 않는다', async () => {
  const calls = [];
  const okTrack = {
    applyConstraints: async (c) => { calls.push(c); },
    getSettings: () => ({ zoom: 2.5 }),
  };
  const ok = await applyTrackZoom(okTrack, 2.5);
  assert.deepEqual(calls[0], zoomConstraint(2.5));
  assert.equal(ok.ok, true);
  assert.equal(ok.applied, 2.5);
  assert.equal(ok.error, '');

  const rejected = await applyTrackZoom({
    applyConstraints: async () => { throw new Error('OverconstrainedError'); },
    getSettings: () => ({ zoom: 1 }),
  }, 4);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /OverconstrainedError/);
  assert.equal(rejected.applied, 1);

  const missing = await applyTrackZoom({
    applyConstraints: async () => {},
    getSettings: () => ({}),
  }, 3);
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'settings-unreported');
});

test('요청값과 적용값이 스텝을 넘으면 불일치다', () => {
  assert.equal(zoomMismatch(3, 3, 0.1), false);
  assert.equal(zoomMismatch(3, 2.95, 0.1), false);
  assert.equal(zoomMismatch(3, 1, 0.1), true);
});

test('크롭은 원본 해상도에서 중앙을 자르고 그 다음에만 줄인다', () => {
  const tall = cropWindow(1080, 2520, 1, 960);
  assert.ok(tall);
  assert.equal(tall.sourceSide, 1080);
  assert.equal(tall.sourceX, 0);
  assert.equal(tall.sourceY, (2520 - 1080) / 2);
  assert.equal(tall.target, 960);

  const zoom2 = cropWindow(1920, 1080, 2, 960);
  assert.equal(zoom2.sourceSide, 540);
  assert.equal(zoom2.sourceX, (1920 - 540) / 2);
  assert.equal(zoom2.sourceY, (1080 - 540) / 2);
  assert.equal(zoom2.target, 540);

  const huge = cropWindow(4000, 3000, 2, 960);
  assert.equal(huge.sourceSide, 1500);
  assert.equal(huge.sourceX, (4000 - 1500) / 2);
  assert.equal(huge.sourceY, (3000 - 1500) / 2);
  assert.equal(huge.target, 960);
  assert.ok(huge.sourceSide > huge.target);
});

test('실효 배율은 적용 트랙 zoom × 적용 크롭이다', () => {
  assert.equal(effectiveMagnification({ trackZoom: 3, cropZoom: 1 }), 3);
  assert.equal(effectiveMagnification({ trackZoom: 1, cropZoom: 2 }), 2);
  assert.equal(effectiveMagnification({ trackZoom: 2, cropZoom: 2 }), 4);
  const failed = zoomTelemetry({
    trackRequested: 4,
    trackApplied: 1,
    cropRequested: 4,
    cropApplied: 4,
    error: 'mismatch',
  });
  assert.equal(failed.zoom, 1);
  assert.equal(failed.zoomRequested, 4);
  assert.equal(failed.crop, 4);
  assert.equal(failed.effectiveZoom, 4);
  assert.equal(failed.zoomError, 'mismatch');
  assert.notEqual(failed.zoom, failed.zoomRequested);
});

test('트랙 실패 시 같은 배율을 크롭으로 돌리고 오류 코드를 남긴다', () => {
  const cap = { min: 1, max: 8, step: 0.1 };
  const track = resolveZoomPlan({
    userZoom: 3,
    capability: cap,
    trackApplied: 3,
  });
  assert.equal(track.mode, 'track');
  assert.equal(track.cropApplied, 1);
  assert.equal(track.error, '');

  const fallback = resolveZoomPlan({
    userZoom: 3,
    capability: cap,
    trackApplied: 1,
    applyError: 'OverconstrainedError:zoom',
  });
  assert.equal(fallback.mode, 'crop-fallback');
  assert.equal(fallback.trackRequested, 3);
  assert.equal(fallback.cropApplied, 3);
  assert.equal(fallback.error, 'OverconstrainedError:zoom');

  const cropOnly = resolveZoomPlan({ userZoom: 2.4, capability: null });
  assert.equal(cropOnly.mode, 'crop');
  assert.equal(cropOnly.cropApplied, snapZoom(2.4, null));
  assert.equal(cropOnly.trackRequested, 1);
});

test('조준 가이드 수치는 셀당 9px · 21셀 기준으로 다시 계산한다', () => {
  const guide = aimGuideFractions();
  assert.equal(guide.floorPx, CELL_PX_FLOOR);
  assert.equal(guide.frameSide, FRAME_MAX_SIDE);
  assert.equal(GUIDE_CELLS_V3 * CELL_PX_FLOOR, 189);
  assert.equal(guide.minV3, 189 / 960);
  assert.ok(Math.abs(guide.minV3 - 0.196875) < 1e-12);
  assert.equal(guide.minY2, (GUIDE_CELLS_Y2 * CELL_PX_FLOOR) / 960);
  assert.ok(guide.minY2 > guide.minV3);
  assert.equal(guide.recommendMin, AIM_RECOMMEND_MIN);
  assert.equal(guide.recommendMax, AIM_RECOMMEND_MAX);
  assert.equal(guide.recommend, AIM_RECOMMEND);
  assert.ok(guide.recommendMin > guide.minY2);
  assert.equal(guide.innerInset, 0.3);
  assert.match(SCANNER_HTML, /class="scan-aim-fill"/);
  assert.match(SCANNER_HTML, /inset: 30%/);
  assert.match(SCANNER_HTML, /data-i18n="guide\.fill"/);
});

test('스캐너는 트랙 zoom 을 적용하고 실패를 토스트로 보여 준다', () => {
  assert.match(SCANNER_JS, /from '\/src\/scanner-zoom\.js'/);
  assert.match(SCANNER_JS, /applyTrackZoom\(/);
  assert.match(SCANNER_JS, /showScanToast\(t\('zoom\.failed'\)\)/);
  assert.match(SCANNER_JS, /zoomPlan\.cropApplied/);
  assert.match(SCANNER_JS, /cameraVideo\.videoWidth/);
  assert.match(SCANNER_JS, /id="zoom-controls"|zoomControls/);
  assert.match(SCANNER_HTML, /id="zoom-controls"/);
  assert.match(SCANNER_HTML, /id="zoom-slider"/);
  assert.match(SCANNER_HTML, /id="zoom-in"/);
  assert.match(SCANNER_HTML, /id="zoom-out"/);
  assert.equal(buttonStep({ min: 1, max: 8, step: 0.1 }), 0.5);
});

test('텔레메트리 신규 필드가 봉투·행에 남고 요청/적용이 갈린다', () => {
  const body = normalizeFrameBody({
    seq: 1, w: 960, h: 960, ok: false, reason: 'frontend:no-finder',
    zoom: 1, zoomRequested: 4, crop: 4, cropRequested: 4,
    effectiveZoom: 4, zoomError: 'mismatch',
  });
  assert.equal(body.zoom, 1);
  assert.equal(body.zoomRequested, 4);
  assert.equal(body.crop, 4);
  assert.equal(body.effectiveZoom, 4);
  assert.equal(body.zoomError, 'mismatch');
  const parsed = parseEnvelope(JSON.stringify(makeEnvelope('s', 'scan', 'frame', body)));
  assert.equal(parsed.ok, true, parsed.error);
  const row = eventRow(parsed.event);
  assert.equal(row.zoom, 1);
  assert.equal(row.zoom_requested, 4);
  assert.equal(row.crop, 4);
  assert.equal(row.effective_zoom, 4);
  assert.equal(row.zoom_error, 'mismatch');

  const old = normalizeFrameBody({
    seq: 1, w: 10, h: 10, zoom: 1.5, ok: false, reason: 'x',
  });
  assert.equal(old.zoomRequested, 1.5);
  assert.equal(old.crop, 1);
  assert.equal(old.effectiveZoom, 1.5);
  assert.equal(old.zoomError, '');
});

function padRaster(raster, width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = PRESET.background.r;
    pixels[i + 1] = PRESET.background.g;
    pixels[i + 2] = PRESET.background.b;
    pixels[i + 3] = 255;
  }
  const ox = Math.floor((width - raster.width) / 2);
  const oy = Math.floor((height - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const si = (y * raster.width + x) * 4;
      const di = ((y + oy) * width + (x + ox)) * 4;
      pixels[di] = raster.pixels[si];
      pixels[di + 1] = raster.pixels[si + 1];
      pixels[di + 2] = raster.pixels[si + 2];
      pixels[di + 3] = raster.pixels[si + 3];
    }
  }
  return { width, height, pixels };
}

function applyCrop(raster, crop) {
  const pixels = new Uint8ClampedArray(crop.target * crop.target * 4);
  const scale = crop.sourceSide / crop.target;
  for (let y = 0; y < crop.target; y += 1) {
    const sy = Math.min(raster.height - 1, Math.floor(crop.sourceY + (y + 0.5) * scale));
    for (let x = 0; x < crop.target; x += 1) {
      const sx = Math.min(raster.width - 1, Math.floor(crop.sourceX + (x + 0.5) * scale));
      const si = (sy * raster.width + sx) * 4;
      const di = (y * crop.target + x) * 4;
      pixels[di] = raster.pixels[si];
      pixels[di + 1] = raster.pixels[si + 1];
      pixels[di + 2] = raster.pixels[si + 2];
      pixels[di + 3] = raster.pixels[si + 3];
    }
  }
  return { width: crop.target, height: crop.target, pixels };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test('확대·크롭이 복호 시간에 주는 영향을 잰다', () => {
  const encoded = encode('zoom-timing', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: PALETTE, margin: 2 });
  const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 1 });
  const wide = padRaster(raster, 1920, 1080);
  const uncrop = applyCrop(wide, cropWindow(1920, 1080, 1, 960));
  const crop2 = applyCrop(wide, cropWindow(1920, 1080, 2, 960));

  assert.equal(uncrop.width, 960);
  assert.equal(crop2.width, 540);

  const warmup = decodeFrontend(uncrop);
  assert.equal(typeof warmup.ok, 'boolean');

  const times = { uncrop: [], crop2: [] };
  for (let i = 0; i < 5; i += 1) {
    let t0 = performance.now();
    decodeFrontend(uncrop);
    times.uncrop.push(performance.now() - t0);
    t0 = performance.now();
    decodeFrontend(crop2);
    times.crop2.push(performance.now() - t0);
  }

  const report = {
    uncrop: {
      w: uncrop.width,
      medianMs: Number(median(times.uncrop).toFixed(2)),
      samples: times.uncrop.map((n) => Number(n.toFixed(2))),
    },
    crop2: {
      w: crop2.width,
      medianMs: Number(median(times.crop2).toFixed(2)),
      samples: times.crop2.map((n) => Number(n.toFixed(2))),
    },
  };
  report.cropOverUncrop = Number((report.crop2.medianMs / report.uncrop.medianMs).toFixed(3));
  mkdirSync(ROOT + 'test/output', { recursive: true });
  writeFileSync(
    ROOT + 'test/output/grok-zoom-timing.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  assert.ok(report.uncrop.medianMs > 0);
  assert.ok(report.crop2.medianMs > 0);
});
