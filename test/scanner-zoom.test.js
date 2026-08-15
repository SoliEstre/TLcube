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
import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import { getFinderPattern } from '../src/finder-patterns.js';
import {
  CELL_PX_FLOOR,
  DEFAULT_USER_ZOOM,
  FRAME_MAX_SIDE,
  GUIDE_CELLS_V3,
  GUIDE_CELLS_Y2,
  GUIDE_FINDER_RADIUS_CELLS,
  GUIDE_INNER_FRACTION,
  GUIDE_OUTER_FRACTION,
  GUIDE_REFERENCE_K,
  GUIDE_SILHOUETTE_RADIUS_CELLS,
  aimGuideMinFractions,
  analysisSquareOnScreen,
  applyTrackZoom,
  buttonStep,
  cropWindow,
  effectiveMagnification,
  guideDotPositions,
  guideOccupancyEstimates,
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

/*
 * [의도적 갱신 2026-08-15] 구 사각 프레임(.scan-aim-fill · inset 30%) 검증을 12점
 * 가이드 검증으로 교체했다 — 사각 가이드 폐기가 이번 의뢰의 목적이다.
 */
test('12점 가이드 — 방향은 정본(꼭짓점 0 = 상단 C0)이고 크기는 파인더 비율에서 유도된다', () => {
  const dots = guideDotPositions(1000, 0, 0);
  assert.equal(dots.outer.length, 6);
  assert.equal(dots.inner.length, 6);
  // 방향: CORNER_UNIT_OFFSETS 를 그대로 재사용 — 꼭짓점 0 = 상단(0, -1), 이후 시계방향.
  for (let i = 0; i < 6; i += 1) {
    const r = GUIDE_OUTER_FRACTION * 500;
    assert.ok(Math.abs(dots.outer[i].x - CORNER_UNIT_OFFSETS[i].x * r) < 1e-9);
    assert.ok(Math.abs(dots.outer[i].y - CORNER_UNIT_OFFSETS[i].y * r) < 1e-9);
  }
  assert.equal(dots.outer[0].x, 0);
  assert.ok(dots.outer[0].y < 0, '꼭짓점 0 이 상단이 아니다');
  // 안쪽 육각 = 대표 버전(O V3, k=10) 중앙 파인더 비율. 상수 사본이 정본과 갈리면 잡는다.
  assert.equal(GUIDE_REFERENCE_K, 10);
  assert.equal(GUIDE_FINDER_RADIUS_CELLS, getFinderPattern('central-cube-3tone').radiusCells);
  assert.ok(Math.abs(GUIDE_SILHOUETTE_RADIUS_CELLS - Math.sqrt(3) * (10 + 2 / 3)) < 1e-12);
  assert.ok(Math.abs(
    GUIDE_INNER_FRACTION
    - GUIDE_OUTER_FRACTION * (GUIDE_FINDER_RADIUS_CELLS / GUIDE_SILHOUETTE_RADIUS_CELLS),
  ) < 1e-12);
  assert.ok(GUIDE_INNER_FRACTION > 0.08 && GUIDE_INNER_FRACTION < 0.13);
  // HTML 배선: 점 레이어가 있고, 구 사각 가이드 **마크업**은 남아 있지 않다
  // (주석은 폐기 이력 설명으로 옛 이름을 언급해도 된다 — class 속성만 본다).
  assert.match(SCANNER_HTML, /id="scan-dot-layer"/);
  assert.match(SCANNER_HTML, /data-i18n="guide\.dots"/);
  assert.doesNotMatch(SCANNER_HTML, /class="scan-aim-fill"|class="scan-corner|class="scan-guide"/);
  assert.match(SCANNER_JS, /renderGuideDots/);
  assert.match(SCANNER_JS, /guideDotPositions\(/);
});

test('바깥 점 크기 — 채우면 점유율이 실측 성공 지대(0.15-0.3)에 들고 복호 하한을 지킨다', () => {
  const occ = guideOccupancyEstimates();
  // Y 육각·K 육망성: bbox = √3R×2R → (√3/2)f² · A 정삼각: √3R×1.5R → (3√3/8)f²
  assert.ok(occ.hexagon >= 0.15 && occ.hexagon <= 0.3, 'Y/K 점유율 ' + occ.hexagon);
  assert.ok(occ.triangle >= 0.15 && occ.triangle <= 0.3, 'A 점유율 ' + occ.triangle);
  // 복호 하한: 바깥 점까지 채운 코드의 셀 px = (f·S/2)/n ≥ 9  ⇔  f ≥ 2·(n·9/S).
  const min = aimGuideMinFractions();
  assert.equal(min.floorPx, CELL_PX_FLOOR);
  assert.equal(min.frameSide, FRAME_MAX_SIDE);
  assert.equal(min.minV3, (GUIDE_CELLS_V3 * CELL_PX_FLOOR) / 960);
  assert.equal(min.minY2, (GUIDE_CELLS_Y2 * CELL_PX_FLOOR) / 960);
  assert.ok(GUIDE_OUTER_FRACTION >= 2 * min.minY2, 'Y2 가 하한 아래로 내려간다');
  assert.ok(GUIDE_OUTER_FRACTION >= 2 * min.minV3, 'Y1 이 하한 아래로 내려간다');
});

test('1× 프리뷰(cover) ↔ 분석 정사각 정합 — 크롭 배율은 화면 투영에서 상쇄된다', () => {
  // 세로 뷰포트 × 가로 센서: cover = eH/vH → S = vH·(eH/vH) = eH.
  assert.equal(analysisSquareOnScreen({
    videoWidth: 1920, videoHeight: 1080, elementWidth: 390, elementHeight: 844,
  }), 844);
  // 세로 뷰포트 × 세로 센서: cover = eH/vH → S = vW·cover.
  assert.ok(Math.abs(analysisSquareOnScreen({
    videoWidth: 1080, videoHeight: 1920, elementWidth: 390, elementHeight: 844,
  }) - 1080 * (844 / 1920)) < 1e-9);
  // 크롭 상쇄: 분석 변(min/crop) × 표시 배율(cover·crop) = min·cover — crop 무관.
  for (const crop of [1, 2, 3.5]) {
    const cover = Math.max(390 / 1920, 844 / 1080);
    const sourceSide = cropWindow(1920, 1080, crop).sourceSide;
    const projected = sourceSide * cover * crop;
    assert.ok(Math.abs(projected - analysisSquareOnScreen({
      videoWidth: 1920, videoHeight: 1080, elementWidth: 390, elementHeight: 844,
    })) < 1e-9, 'crop ' + crop + ' 에서 투영이 어긋난다');
  }
  assert.equal(analysisSquareOnScreen({}), null);
  // 셸 배선: 기하 트리거와 CSS scale 동기화가 실재한다.
  assert.match(SCANNER_JS, /analysisSquareOnScreen\(/);
  assert.match(SCANNER_JS, /addEventListener\('loadedmetadata', renderGuideDots\)/);
  assert.match(SCANNER_JS, /syncPreviewTransform/);
});

test('잘림 안내 — multi-clip 연속이면 «조금 뒤로» 를 띄우고 새 전송 경로는 만들지 않는다', () => {
  assert.match(SCANNER_JS, /CLIP_HINT_AFTER_FRAMES/);
  assert.match(SCANNER_JS, /clipSide === 'multi'/);
  assert.match(SCANNER_JS, /t\('status\.clipped'\)/);
  // 판정은 프레임마다 이미 계산 가능한 extractGeometry 를 재사용한다 — 반환 객체에
  // clipSide 를 동봉할 뿐, beacon/lab 호출을 새로 만들지 않는다(안정판 0바이트 불변식).
  assert.match(SCANNER_JS, /extractGeometry\(result, imageData\.width, imageData\.height\)\.clipSide/);
  assert.doesNotMatch(SCANNER_JS, /lab\.(frame|frameShot|env)\([^)]*clipSide/);
});

/*
 * [의도적 갱신 2026-08-15] 기본 확대 2 → 1 복귀가 이번 의뢰의 목적이다 (운영자 지시).
 * 실측(f2dbb2b 이후 340프레임): zoom 2 상시 크롭에서 가이드·분석 경계 불일치로
 * multi-clip 구간 성공 0%. 확대 대신 가이드를 분석 좌표에 정합시키는 설계로 바꿨다.
 */
test('기본 확대는 한 상수이고 1 이며 스캐너가 그 상수를 쓴다', () => {
  assert.equal(DEFAULT_USER_ZOOM, 1);
  assert.match(SCANNER_JS, /DEFAULT_USER_ZOOM/);
  assert.match(SCANNER_JS, /snapZoom\(DEFAULT_USER_ZOOM/);
  assert.match(SCANNER_JS, /userZoom: DEFAULT_USER_ZOOM/);
  assert.match(SCANNER_JS, /crop-failed|zoom\.failed/);
  const crop = resolveZoomPlan({ userZoom: DEFAULT_USER_ZOOM, capability: null });
  assert.equal(crop.cropApplied, 1);
  assert.equal(crop.error, '');
  const track = resolveZoomPlan({
    userZoom: DEFAULT_USER_ZOOM,
    capability: { min: 1, max: 8, step: 0.1 },
    trackApplied: 1,
  });
  assert.equal(track.mode, 'track');
  assert.equal(track.trackApplied, 1);
  assert.equal(track.error, '');
  // 수동 확대는 유지된다 — 컨트롤 상한은 여전히 8×.
  assert.match(SCANNER_HTML, /id="zoom-slider"[^>]*max="8"/);
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
