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
import { CORNER_UNIT_OFFSETS, SQRT3, hexCorners, hexDistance } from '../src/hexgrid.js';
import { getFinderPattern } from '../src/finder-patterns.js';
import { isInRegionA } from '../src/placementA.js';
import { isInRegionInvertedA, isInRegionK } from '../src/cell-editor-core.js';
import { VERSIONS } from '../src/capacity.js';
import { VERSIONS_A } from '../src/capacityA.js';
import {
  CELL_PX_FLOOR,
  AUTO_CROP_LADDER,
  AUTO_CROP_STEP_MS,
  autoCropRung,
  autoCropZoomFor,
  DEFAULT_USER_ZOOM,
  EDGE_UNIT_OFFSETS,
  FRAME_MAX_SIDE,
  GUIDE_CELLS_V3,
  GUIDE_CELLS_Y2,
  GUIDE_FINDER_RADIUS_CELLS,
  GUIDE_INNER_FRACTION,
  GUIDE_MIDDLE_FRACTION,
  ACTION_CONTROLS_HEIGHT,
  BOTTOM_STACK_CHROME,
  GUIDE_OUTER_FRACTION,
  GUIDE_PAIR_K,
  PANEL_CHROME_HEIGHT,
  SHELL_GAP,
  SHELL_PAD_MIN,
  SPLIT_COLUMN_GAP,
  SPLIT_MIN_ASPECT,
  SPLIT_PANEL_CAP_FRACTION,
  SPLIT_PANEL_MIN_WIDTH,
  SQUARE_MIN_SIDE,
  SQUARE_VIEW_FRACTION,
  UI_BUDGET_CAP_FRACTION,
  UI_STACK_BUDGET,
  UI_STACK_BUDGET_PARTS,
  aimGuideMinFractions,
  applyTrackZoom,
  buttonStep,
  cropWindow,
  dotsOutOfBounds,
  effectiveMagnification,
  guideDotPositions,
  guideOccupancyEstimates,
  kaApexRadiusCells,
  layoutModeFor,
  parseZoomCapability,
  previewSourceWindow,
  resolveZoomPlan,
  scanLayout,
  silhouetteRadiusCells,
  snapZoom,
  squareViewSide,
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
 * [의도적 갱신 2026-08-16] 12점(2링) 검증을 3링 18점 검증으로 교체했다 — 링 비율을
 * 단일 타입 기준에서 **타입 간 관계**(K 첨두/중앙육각 = O 실루엣)로 바꾸는 것이
 * 이번 의뢰(작업 2)의 목적이다.
 */
test('3링 18점 가이드 — 방향 정본(바깥·안쪽 C, 중간 E)과 비율(√3 · 파인더/실루엣)이 코드 기하다', () => {
  const dots = guideDotPositions(1000, 0, 0);
  assert.equal(dots.outer.length, 6);
  assert.equal(dots.middle.length, 6);
  assert.equal(dots.inner.length, 6);
  for (let i = 0; i < 6; i += 1) {
    // 바깥: CORNER_UNIT_OFFSETS 그대로 — 꼭짓점 0 = 상단(0,-1), 이후 시계방향.
    const rOut = GUIDE_OUTER_FRACTION * 500;
    assert.ok(Math.abs(dots.outer[i].x - CORNER_UNIT_OFFSETS[i].x * rOut) < 1e-9);
    assert.ok(Math.abs(dots.outer[i].y - CORNER_UNIT_OFFSETS[i].y * rOut) < 1e-9);
    // 중간: 변-중점 E_i = (C_i+C_{i+1})/√3 — C 에서 30° 회전이 구성상 보장된다.
    const c1 = CORNER_UNIT_OFFSETS[i];
    const c2 = CORNER_UNIT_OFFSETS[(i + 1) % 6];
    assert.ok(Math.abs(EDGE_UNIT_OFFSETS[i].x - (c1.x + c2.x) / SQRT3) < 1e-12);
    assert.ok(Math.abs(EDGE_UNIT_OFFSETS[i].y - (c1.y + c2.y) / SQRT3) < 1e-12);
    assert.ok(Math.abs(Math.hypot(EDGE_UNIT_OFFSETS[i].x, EDGE_UNIT_OFFSETS[i].y) - 1) < 1e-12);
    const rMid = GUIDE_MIDDLE_FRACTION * 500;
    assert.ok(Math.abs(dots.middle[i].x - EDGE_UNIT_OFFSETS[i].x * rMid) < 1e-9);
    assert.ok(Math.abs(dots.middle[i].y - EDGE_UNIT_OFFSETS[i].y * rMid) < 1e-9);
    // 안쪽: 중앙 파인더 큐브(pointy-top) — C 방향.
    const rIn = GUIDE_INNER_FRACTION * 500;
    assert.ok(Math.abs(dots.inner[i].x - CORNER_UNIT_OFFSETS[i].x * rIn) < 1e-9);
    assert.ok(Math.abs(dots.inner[i].y - CORNER_UNIT_OFFSETS[i].y * rIn) < 1e-9);
  }
  assert.equal(dots.outer[0].x, 0);
  assert.ok(dots.outer[0].y < 0, '꼭짓점 0 이 상단이 아니다');
  // 비율 ① 바깥/중간 = √3 (K 첨두 / K 중앙육각, k 무관 정확).
  assert.ok(Math.abs(GUIDE_OUTER_FRACTION / GUIDE_MIDDLE_FRACTION - SQRT3) < 1e-12);
  // 비율 ③ 안쪽 = 짝 k=6 의 O 가 중간 링에 앉을 때의 중앙 파인더.
  assert.equal(GUIDE_FINDER_RADIUS_CELLS, getFinderPattern('central-cube-3tone').radiusCells);
  assert.ok(Math.abs(
    GUIDE_INNER_FRACTION
    - GUIDE_MIDDLE_FRACTION * (GUIDE_FINDER_RADIUS_CELLS / silhouetteRadiusCells(GUIDE_PAIR_K)),
  ) < 1e-12);
  // 닫힌 형태 검산: OUTER × 3.5/(3k+2) — V3 기준 구값 0.1023 은 폐기됐다.
  assert.ok(Math.abs(GUIDE_INNER_FRACTION - (0.54 * 3.5) / 20) < 1e-12);
  assert.ok(Math.abs(GUIDE_INNER_FRACTION - 0.0945) < 1e-12);
  // HTML 배선: 점 레이어 + 세 링의 시각 구분 스타일. 구 사각 가이드 마크업 부재.
  assert.match(SCANNER_HTML, /id="scan-dot-layer"/);
  assert.match(SCANNER_HTML, /data-i18n="guide\.dots"/);
  assert.match(SCANNER_HTML, /\.dot-outer|dot-outer/);
  assert.match(SCANNER_HTML, /dot-middle/);
  assert.match(SCANNER_HTML, /dot-inner/);
  assert.doesNotMatch(SCANNER_HTML, /class="scan-aim-fill"|class="scan-corner|class="scan-guide"/);
  assert.match(SCANNER_JS, /renderGuideDots/);
  assert.match(SCANNER_JS, /guideDotPositions\(/);
  assert.match(SCANNER_JS, /dots\.middle, 'dot-middle'/);
});

/*
 * 작업 2 불변식 ①·② 의 좌표 검산 — 공식이 아니라 **실제 영역 코드**(placementA ·
 * cell-editor-core · hexgrid 꼭짓점)에서 첨두/중앙육각/실루엣 반경을 다시 유도한다.
 */
test('3링 기하 좌표 검산 — K 첨두 (3k+2)s · K 중앙육각 = O 실루엣 (같은 k 한정)', () => {
  const S = 1; // hexgrid 기본 레이아웃 size=1
  for (const k of [6, 8, 10]) {
    // ── 영역 소속: q=k 열이 A 의 경계다 (k+1 열은 밖).
    for (let r = -2 * k; r <= k; r += 1) {
      assert.equal(isInRegionA(k, r, k), true, `A(k=${k}) 에 (${k},${r}) 이 없다`);
      assert.equal(isInRegionK(k, r, k), true);
    }
    assert.equal(isInRegionA(k + 1, 0, k), false);

    // ── 우변 직선: q=k 열 셀들의 UR 꼭짓점(인덱스 1)이 한 직선 위 (기울기 √3).
    const ur = (r) => hexCorners(k, r, { size: S })[1];
    const p0 = ur(-2 * k);
    const p1 = ur(k);
    const slope = (p1.y - p0.y) / (p1.x - p0.x);
    assert.ok(Math.abs(slope - SQRT3) < 1e-9, `k=${k} 우변 기울기 ${slope}`);
    for (let r = -2 * k; r <= k; r += 1) {
      const p = ur(r);
      const expectY = p0.y + (p.x - p0.x) * slope;
      assert.ok(Math.abs(p.y - expectY) < 1e-9, `k=${k} r=${r} UR 이 직선을 벗어난다`);
    }
    // 우변 ∩ 좌변(거울상, x=0): 상단 첨두 y = −(3k+2)s.
    const apexY = p0.y + (0 - p0.x) * slope;
    assert.ok(Math.abs(apexY - (-(3 * k + 2) * S)) < 1e-9, `k=${k} 첨두 ${apexY}`);
    assert.equal(kaApexRadiusCells(k), 3 * k + 2);

    // ── 하변: r=k 행 셀들의 하단 꼭짓점(인덱스 3) y = (1.5k+1)s 수평선.
    for (let q = -2 * k; q <= k; q += 1) {
      const bottom = hexCorners(q, k, { size: S })[3];
      assert.ok(Math.abs(bottom.y - (1.5 * k + 1) * S) < 1e-9);
    }
    // 하변 ∩ 우변: 반경 (3k+2)s, 방향 C2 — 정삼각형 확인.
    const yBottom = (1.5 * k + 1) * S;
    const xCross = p0.x + (yBottom - p0.y) / slope;
    const radius = Math.hypot(xCross, yBottom);
    assert.ok(Math.abs(radius - (3 * k + 2) * S) < 1e-9);
    assert.ok(Math.abs(xCross / radius - CORNER_UNIT_OFFSETS[2].x) < 1e-9);
    assert.ok(Math.abs(yBottom / radius - CORNER_UNIT_OFFSETS[2].y) < 1e-9);

    // ── 반전 A(cell-editor-core): 상변 = r=−k 행 상단 꼭짓점(인덱스 0) 수평선
    //    y = −(1.5k+1)s. O 영역(hexDistance ≤ k)의 상단 행도 **같은 직선**이다.
    for (let q = 0; q <= 2 * k; q += 1) {
      assert.equal(isInRegionInvertedA(q, -k, k), true);
    }
    for (let q = 0; q <= k; q += 1) {
      assert.ok(hexDistance(q, -k) <= k, `O(k=${k}) 상단 행 (${q},${-k})`);
      const top = hexCorners(q, -k, { size: S })[0];
      assert.ok(Math.abs(top.y - (-(1.5 * k + 1) * S)) < 1e-9);
    }
    // O 영역 q=k 열(r ∈ [−k, 0])의 UR 꼭짓점도 △ 우변과 같은 직선(부분집합).
    for (let r = -k; r <= 0; r += 1) {
      assert.ok(hexDistance(k, r) <= k);
      const p = ur(r);
      const expectY = p0.y + (p.x - p0.x) * slope;
      assert.ok(Math.abs(p.y - expectY) < 1e-9);
    }

    // ── 불변식 ①·②: ▽ 상변(수평선) ∩ △ 우변 = K 중앙육각 꼭짓점.
    //    반경 = (3k+2)s/√3 = √3(k+2/3)s (O 실루엣), 방향 = E0 (변-중점).
    const yTop = -(1.5 * k + 1) * S;
    const xMid = p0.x + (yTop - p0.y) / slope;
    const rMid = Math.hypot(xMid, yTop);
    assert.ok(Math.abs(rMid - (3 * k + 2) * S / SQRT3) < 1e-9);
    assert.ok(Math.abs(rMid - silhouetteRadiusCells(k) * S) < 1e-9);
    assert.ok(Math.abs(xMid / rMid - EDGE_UNIT_OFFSETS[0].x) < 1e-9);
    assert.ok(Math.abs(yTop / rMid - EDGE_UNIT_OFFSETS[0].y) < 1e-9);
    // 유리수 항등: (3k+2)/√3 = √3(k+2/3).
    assert.ok(Math.abs(kaApexRadiusCells(k) / SQRT3 - silhouetteRadiusCells(k)) < 1e-12);
    // 셀 크기 불변: K 를 바깥 링에, O 를 중간 링에 — 같은 s.
    const rOut = 100;
    assert.ok(Math.abs(
      rOut / kaApexRadiusCells(k) - (rOut / SQRT3) / silhouetteRadiusCells(k),
    ) < 1e-12);
  }
  // «같은 k 만 성립» — k 가 다르면 중앙육각 ≠ 실루엣 (짝이 아니다).
  assert.ok(Math.abs(kaApexRadiusCells(8) / SQRT3 - silhouetteRadiusCells(6)) > 1);
  assert.ok(Math.abs(kaApexRadiusCells(6) / SQRT3 - silhouetteRadiusCells(8)) > 1);
});

test('버전 짝 판정 — O V1↔A0 · V2↔A1 · V3↔A2 (같은 k), 안쪽 링 짝은 k=6', () => {
  const oByVersion = Object.fromEntries(VERSIONS.map((v) => [v.version, v.k]));
  const aByName = Object.fromEntries(VERSIONS_A.map((v) => [v.name, v.k]));
  assert.deepEqual(oByVersion, { 1: 6, 2: 8, 3: 10 });
  assert.deepEqual(aByName, { A0: 6, A1: 8, A2: 10 });
  // 운영자 표기 «O1 - K1(A1)» = 코드 명명 O V1 ↔ A0 기하 (A 1-베이스 읽기).
  assert.equal(GUIDE_PAIR_K, 6);
  assert.equal(oByVersion[1], GUIDE_PAIR_K);
  assert.equal(aByName.A0, GUIDE_PAIR_K);
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

/*
 * [의도적 갱신 2026-08-16, r3] 구 «cover 화면 투영(analysisSquareOnScreen) 정합» 검증을
 * **정사각 뷰 구조 동일성** 검증으로 교체했다. r3 에선 프리뷰 컨테이너 자체가 분석
 * 정사각이라 역투영이 존재하지 않는다 — 폐기가 지시 사항이다.
 */
test('r3 정사각 뷰 — 프리뷰(cover+scale) ≡ 분석(cropWindow) 이 모든 크롭에서 동일하다', () => {
  for (const [vW, vH] of [[1920, 1080], [1080, 1920], [1280, 720], [720, 1280], [2560, 1440]]) {
    for (const crop of [1, 2, 3.5]) {
      for (const side of [316.48, 358.8, 706.56]) {
        const preview = previewSourceWindow({
          videoWidth: vW, videoHeight: vH, containerSide: side, cropZoom: crop,
        });
        const analysis = cropWindow(vW, vH, crop);
        assert.ok(Math.abs(preview.sourceSide - analysis.sourceSide) < 1e-9,
          `${vW}x${vH} crop ${crop}: 프리뷰 창 ≠ 분석 크롭`);
        assert.ok(Math.abs(preview.sourceX - analysis.sourceX) < 1e-9);
        assert.ok(Math.abs(preview.sourceY - analysis.sourceY) < 1e-9);
        // 컨테이너 크기는 동일성에 아무 영향이 없다 — 구조 증명의 핵심.
      }
    }
  }
  assert.equal(previewSourceWindow({}), null);
  // 역투영 폐기 — import·호출·정의 어디에도 없다 (주석의 폐기 이력 언급만 허용).
  assert.doesNotMatch(SCANNER_JS, /analysisSquareOnScreen\s*\(|import[^;]*analysisSquareOnScreen/);
  const ZOOM_SRC = readFileSync(ROOT + 'src/scanner-zoom.js', 'utf8');
  assert.doesNotMatch(ZOOM_SRC, /function analysisSquareOnScreen/);
  // 셸 배선: 정사각 스테이지 rect 기반 렌더 + 기하 트리거 + CSS scale 동기화.
  assert.match(SCANNER_JS, /cameraStage\.getBoundingClientRect\(\)/);
  assert.match(SCANNER_JS, /addEventListener\('loadedmetadata', renderGuideDots\)/);
  assert.match(SCANNER_JS, /syncPreviewTransform/);
  assert.match(SCANNER_HTML, /class="square-stage" id="camera-stage"/);
  // r4 에서도 «0.92 × 뷰포트 짧은 변» 항은 그대로 살아 있다 — 다만 이제 --tl-vmin-cap
  // 이라는 이름을 갖고, 배치 적합 상한과 min 된다 (아래 r4 CSS 동기화 테스트가 정본).
  assert.match(SCANNER_HTML, /min\(92vw, 92dvh\)/);
  assert.match(SCANNER_HTML, /--tl-vmin-cap: min\(92vw, 92dvh\);/);
  assert.match(SCANNER_HTML, /aspect-ratio: 1 \/ 1/);
});

/*
 * r3 기기 매트릭스 수치 테스트 (작업 3): 뷰포트 폰 390×844 · 태블릿 1024×768 ·
 * 폴드 접힘 344×882 · 폴드 펼침 1812×2176 × 센서 1280×720 / 720×1280.
 * ⓐ **시각 여백 상한**(뷰 변의 상한 항) ⓑ 18점 전부 뷰 안 ⓒ 프리뷰≡분석
 * ⓓ 점유율·cell_px 표(JSON 산출).
 *
 * [정정 2026-08-16, r5] ⓐ 를 «정사각 뷰 변» 이라 부르던 것을 «시각 여백 상한» 으로
 * 되돌렸다 — r4 의 squareViewSide() 의미 축소와 같은 정정이다. 정본은 scanLayout().
 */
test('r3 기기 매트릭스 — 시각 여백 상한·18점 포함·프리뷰≡분석·cell_px 표', () => {
  const VIEWPORTS = [
    { name: 'phone', w: 390, h: 844 },
    { name: 'tablet', w: 1024, h: 768 },
    { name: 'fold-closed', w: 344, h: 882 },
    { name: 'fold-open', w: 1812, h: 2176 },
  ];
  const SENSORS = [
    { name: 'sensor-landscape', w: 1280, h: 720 },
    { name: 'sensor-portrait', w: 720, h: 1280 },
  ];
  assert.equal(SQUARE_VIEW_FRACTION, 0.92);
  const matrix = {
    fraction: SQUARE_VIEW_FRACTION,
    // 산출물이 스스로를 설명하게 둔다 — 이 표를 읽는 사람이 «뷰 변» 으로 오독한 것이
    // r5 에서 고친 결함이다.
    viewSideCapMeaning:
      'viewSideCap = 0.92 × 뷰포트 짧은 변 — 시각 여백 상한이지 실제 뷰 한 변이 아니다. '
      + '실제 한 변은 scanLayout().squareSide (= 이 상한 ∧ 배치 적합 상한).',
    viewports: [],
    sensors: [],
    cellPx: {},
  };

  for (const vp of VIEWPORTS) {
    /*
     * ⓐ **시각 여백 상한** = 0.92 × 짧은 변 — 방향을 타지 않는다 (w/h 스왑 동일).
     *
     * [정정 2026-08-16, r5] 이 필드 이름이 `squareSide` 였다. r4 부터 실제 뷰 한 변은
     * 이 값에 **배치 적합 상한**을 더 min 한 것(`scanLayout().squareSide`)이라,
     * 구 이름은 산출 JSON 에서 «뷰 변» 을 공표하는 거짓말이 돼 있었다 — 예컨대
     * 태블릿 1024×768 의 실제 변은 690 인데 이 표는 706.56 을 실었다.
     * 이름을 `viewSideCap` 으로 좁히고 의미를 «상한» 으로 되돌린다.
     */
    const side = squareViewSide(vp.w, vp.h);
    assert.ok(Math.abs(side - 0.92 * Math.min(vp.w, vp.h)) < 1e-9);
    assert.equal(squareViewSide(vp.h, vp.w), side, vp.name + ': 방향 의존');
    // 상한은 정본 산식의 결과 이상이어야 한다 — 이름이 뜻하는 관계를 여기서 고정한다.
    assert.ok(scanLayout({ viewportWidth: vp.w, viewportHeight: vp.h }).squareSide <= side + 1e-9,
      vp.name + ': viewSideCap 이 상한이 아니다');
    // ⓑ 18점 전부 뷰 안 (구조 불변식: 최대 반경 27% < 50%).
    const dots = guideDotPositions(side, side / 2, side / 2);
    assert.equal(dots.outer.length + dots.middle.length + dots.inner.length, 18);
    assert.deepEqual(dotsOutOfBounds(dots, side), [], vp.name + ': 점이 뷰를 벗어난다');
    matrix.viewports.push({ ...vp, viewSideCap: Number(side.toFixed(2)) });
  }

  for (const sensor of SENSORS) {
    for (const crop of [1, 2]) {
      // ⓒ 프리뷰 ≡ 분석 (모든 뷰포트에서 — 컨테이너 크기 무관이 위 테스트, 여기선 값 기록).
      const analysis = cropWindow(sensor.w, sensor.h, crop);
      const preview = previewSourceWindow({
        videoWidth: sensor.w, videoHeight: sensor.h, containerSide: 358.8, cropZoom: crop,
      });
      assert.ok(Math.abs(preview.sourceSide - analysis.sourceSide) < 1e-9);
      // 텔레메트리 w/h 정직성: 분석 프레임 변 = cropWindow.target (없는 픽셀을 만들지 않는다).
      assert.equal(analysis.target, Math.min(960, Math.round(analysis.sourceSide)));
      matrix.sensors.push({
        sensor: sensor.name, crop,
        sourceSide: Number(analysis.sourceSide.toFixed(1)),
        frameSide: analysis.target,
      });
    }
  }

  // ⓓ cell_px 표 — 바깥 링 채움(Y/K/A)과 O 중간 링 안착, 프레임 720²(이 센서들) · 960².
  for (const frameSide of [720, 960]) {
    const rOut = (GUIDE_OUTER_FRACTION * frameSide) / 2;
    const rMid = rOut / SQRT3;
    const table = {
      Y1_outer: rOut / GUIDE_CELLS_V3,
      Y2_outer: rOut / GUIDE_CELLS_Y2,
      O_V1_middle: rMid / silhouetteRadiusCells(6),
      O_V2_middle: rMid / silhouetteRadiusCells(8),
      O_V3_middle: rMid / silhouetteRadiusCells(10),
      K_A0_outer: rOut / kaApexRadiusCells(6),
      K_A1_outer: rOut / kaApexRadiusCells(8),
      K_A2_outer: rOut / kaApexRadiusCells(10),
    };
    // 셀 크기 불변식: O 중간 = K 바깥 (같은 k) — 표 안에서 검산.
    assert.ok(Math.abs(table.O_V1_middle - table.K_A0_outer) < 1e-12);
    assert.ok(Math.abs(table.O_V2_middle - table.K_A1_outer) < 1e-12);
    assert.ok(Math.abs(table.O_V3_middle - table.K_A2_outer) < 1e-12);
    matrix.cellPx[frameSide] = Object.fromEntries(
      Object.entries(table).map(([key, value]) => [key, Number(value.toFixed(2))]),
    );
  }
  // 점유율 지대(0.15-0.3)는 Y 실측 기반 — 바깥 링 채움 형상(Y/K/A)에만 단언한다.
  const occ = guideOccupancyEstimates();
  assert.ok(occ.hexagon >= 0.15 && occ.hexagon <= 0.3);
  assert.ok(occ.triangle >= 0.15 && occ.triangle <= 0.3);
  // O 가 중간 링에 앉을 때의 bbox 점유율 — 지대에 강제하지 않고 수치만 남긴다.
  matrix.oMiddleOccupancy = Object.fromEntries([6, 8, 10].map((k) => {
    const s = 1 / kaApexRadiusCells(k); // rOut=1 정규화 셀 크기
    const bboxW = 2 * SQRT3 * s * (k + 0.5);
    const bboxH = 2 * s * (1.5 * k + 1);
    const frame = 2 / GUIDE_OUTER_FRACTION; // rOut=1 → 프레임 변
    return ['k' + k, Number(((bboxW * bboxH) / (frame * frame)).toFixed(4))];
  }));

  mkdirSync(ROOT + 'test/output', { recursive: true });
  writeFileSync(
    ROOT + 'test/output/claude-square-view-matrix.json',
    JSON.stringify(matrix, null, 2) + '\n',
  );
});

test('점 렌더 자가진단 (작업 4) — 재시도·첫 grab 재렌더·스태킹 단언·이탈 경고가 배선돼 있다', () => {
  // S ≤ 0 / rect 0 → 조용한 포기 대신 재시도 예약.
  assert.match(SCANNER_JS, /scheduleGuideRetry\(\)/);
  assert.match(SCANNER_JS, /GUIDE_RETRY_LIMIT/);
  // 첫 프레임 grab 성공 시 재렌더 (loadedmetadata 만으로는 기기에 따라 이르다).
  assert.match(SCANNER_JS, /firstGrabRendered = true;\s*\n\s*renderGuideDots\(\)/);
  // z-index/스태킹 코드 단언 — video 가 점 레이어를 못 덮는다.
  assert.match(SCANNER_JS, /assertDotLayerStacking/);
  assert.match(SCANNER_JS, /DOCUMENT_POSITION_FOLLOWING/);
  assert.match(SCANNER_HTML, /\.scan-dot-layer \{[^}]*z-index: 2/);
  // r3 불변식: 점이 뷰 밖이면 콘솔 경고 + 오버레이 표기.
  assert.match(SCANNER_JS, /dotsOutOfBounds\(dots, side\)/);
  assert.match(SCANNER_JS, /console\.warn\('\[tlscan\] guide dots out of square view:'/);
  assert.match(SCANNER_JS, /debugOverlay\.flagDotIssue\(outOfBounds\)/);
  // dotsOutOfBounds 자체: 뷰 안이면 빈 배열, 밖이면 링·인덱스를 짚는다.
  const dots = guideDotPositions(100, 50, 50);
  assert.deepEqual(dotsOutOfBounds(dots, 100), []);
  const shifted = guideDotPositions(100, 95, 50); // 중심을 우측 경계로 밀면 이탈해야 한다
  assert.ok(dotsOutOfBounds(shifted, 100).length > 0);
});

test('r3 화질 — 스트림 ideal 2560×1440 요청 + 960 grab 유지 결정이 수치와 함께 박혀 있다', () => {
  assert.match(SCANNER_JS, /width: \{ ideal: 2560 \}/);
  assert.match(SCANNER_JS, /height: \{ ideal: 1440 \}/);
  // 결정 근거(실측 프로브)와 승격 경로 관계가 주석으로 남는다 — 주장의 출처 고정.
  // 의도적 갱신(retire, 2026-08-16): 구 단언은 test/output 의 JSON 스냅샷을 고정했는데,
  // 그 파일은 스위트가 매번 프로브를 재실행하며 덮어써 부패했다(검증 렌즈 판정).
  // 프로브를 tools/probes/ 로 격리하고 인용을 관측 범위(1.33~2.09×)로 바꿨다.
  assert.match(SCANNER_JS, /tools\/probes\/probe-square-timing\.mjs/);
  assert.match(SCANNER_JS, /1\.33\\?~2\.09×/);
  assert.match(SCANNER_JS, /FRAME_ESCALATED_SIDE = 1440/);
  assert.match(SCANNER_JS, /const FRAME_MAX_SIDE = 960/);
});

test('디버그 오버레이는 isLabPath() 로만 활성화된다 (안정판 `/` 불활성 계약)', () => {
  // 셸에서 활성화 지점은 createDebugOverlay 하나뿐이고 enabled 가 isLabPath() 다.
  const calls = [...SCANNER_JS.matchAll(/createDebugOverlay\(/g)];
  assert.equal(calls.length, 1);
  assert.match(SCANNER_JS, /createDebugOverlay\(\{\s*\n?\s*enabled: isLabPath\(\)/);
  assert.doesNotMatch(SCANNER_JS, /enabled:\s*true/);
  // 마크업은 authored hidden — 팩토리가 불활성이면 그대로 남는다.
  assert.match(SCANNER_HTML, /id="lab-debug-layer"[^>]*hidden/);
  assert.match(SCANNER_HTML, /id="lab-debug-panel"[^>]*hidden/);
  assert.match(SCANNER_HTML, /id="lab-debug-toggle"[^>]*hidden/);
  // 오버레이 값은 전부 기존 로컬 추출 재사용 — lab 소켓 전송 함수와 무관.
  assert.match(SCANNER_JS, /function updateDebugOverlay/);
  assert.doesNotMatch(SCANNER_JS, /debugOverlay\.(frame|flagDotIssue|setViewSide)\([^)]*lab\./);
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

/*
 * ══ r4 화면비 적응 무스크롤 배치 (운영자 지시 2026-08-16) ═════════════════════
 *
 * 불변식: **페이지 스크롤 0**. 아래 세 층으로 나눠 고정한다.
 *   ① 구조 — html/body/app/shell 이 뷰포트 높이에 묶여 있고 넘침 흡수 지점이 하나뿐.
 *   ② 산식 — CSS 커스텀 속성이 scanner-zoom.js 상수에서 문자 그대로 재구성된다.
 *   ③ 수치 — 기기 매트릭스에서 콘텐츠 폭·높이가 뷰포트 이하임을 계산으로 증명.
 * 브라우저 실측은 통합자(retire)의 몫이다 — 여기서는 소스 단언 + 산식 대조만 한다.
 */

/** `--name: value;` 선언을 등장 순서대로 모은다 (미디어쿼리 재정의까지 전부). */
function cssVarDeclarations(name) {
  const re = new RegExp('--' + name + ':\\s*([^;]+);', 'g');
  return [...SCANNER_HTML.matchAll(re)].map((m) => m[1].trim());
}

test('r4 ① 구조 — 페이지 스크롤이 생길 수 있는 경로가 소스에서 닫혀 있다', () => {
  // html/body 가 뷰포트보다 커질 수 없다.
  assert.match(SCANNER_HTML, /html,\s*\n\s*body \{[^}]*height: 100%;[^}]*overflow: hidden;/);
  // app·shell 은 min-height 가 아니라 height 다. min-height 는 상한이 아니라서
  // 자식 합이 넘치면 셸이 그냥 길어졌고(→ flex-shrink 미발동) 페이지가 스크롤됐다.
  assert.match(SCANNER_HTML, /\.scanner-app \{[^}]*height: 100vh;\s*height: 100dvh;[^}]*overflow: hidden;/);
  assert.match(SCANNER_HTML, /\.scanner-shell \{[^}]*height: 100vh;\s*height: 100dvh;[^}]*overflow: hidden;/);
  assert.doesNotMatch(SCANNER_HTML, /min-height: 100dvh/,
    'min-height 100dvh 가 남아 있다 — r3 스크롤 결함의 원인 그 자체다');
  // 넘침 흡수 지점: 패널 상자 하나. 내부 스크롤 + 자식은 눌리지 않고 스크롤한다.
  // [의도적 갱신 2026-08-16, r5] 이 상자에 id 가 붙었다 — scanner.js 가 내부 오버플로
  // 힌트(하단 페이드)를 켜고 끄려면 이 요소를 잡아야 한다. 구조는 그대로다.
  assert.match(SCANNER_HTML, /<div class="scanner-panels" id="scanner-panels">/);
  assert.match(SCANNER_HTML, /\.scanner-panels \{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(SCANNER_HTML, /\.scanner-panels > \* \{\s*flex: 0 0 auto;\s*\}/);
  // 정사각·머리·꼬리는 줄어들지 않는다 — 줄어들 곳이 패널뿐이어야 배치가 결정적이다.
  assert.match(SCANNER_HTML, /\.square-stage-wrap \{[^}]*flex: 1 0 auto;/);
  assert.match(SCANNER_HTML, /\.scanner-top,\s*\n\s*\.site-footer \{\s*flex: 0 0 auto;\s*\}/);
  // 게이트 카드·lab 안내도 자기 안에서 스크롤한다 (페이지가 못 스크롤하므로).
  assert.match(SCANNER_HTML, /\.camera-gate \{[^}]*overflow-y: auto;/);
  assert.match(SCANNER_HTML, /\.lab-notice \{[^}]*overflow-y: auto;/);
  // 뷰포트 기준 max-width 는 옆배치에서 열을 넘긴다 — 부모 기준으로 바뀌었는지.
  assert.doesNotMatch(SCANNER_HTML, /max-width: calc\(100vw - 40px\)/);
  assert.doesNotMatch(SCANNER_HTML, /max-width: calc\(100vw - 48px\)/);
  assert.doesNotMatch(SCANNER_HTML, /max-width: min\(320px, 80vw\)/);
});

test('r4 ② 산식 — CSS 커스텀 속성이 scanner-zoom.js 상수와 문자 그대로 같다', () => {
  const px = (n) => `${n}px`;
  // 패딩·간격
  for (const [suffix, side] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) {
    assert.deepEqual(cssVarDeclarations('tl-pad-' + suffix),
      [`max(${px(SHELL_PAD_MIN)}, env(safe-area-inset-${side}))`]);
  }
  assert.deepEqual(cssVarDeclarations('tl-shell-gap'), [px(SHELL_GAP)]);
  assert.deepEqual(cssVarDeclarations('tl-split-gap'), [px(SPLIT_COLUMN_GAP)]);

  // 가용 영역 (dvh 판 + @supports vh 폴백)
  assert.deepEqual(cssVarDeclarations('tl-avail-w'),
    ['calc(100vw - var(--tl-pad-l) - var(--tl-pad-r))']);
  assert.deepEqual(cssVarDeclarations('tl-avail-h'), [
    'calc(100dvh - var(--tl-pad-t) - var(--tl-pad-b))',
    'calc(100vh - var(--tl-pad-t) - var(--tl-pad-b))',
  ]);

  // 시각 여백 상한 = squareViewSide() 의 0.92 × 짧은 변
  const vminPct = Math.round(SQUARE_VIEW_FRACTION * 100);
  assert.equal(vminPct, 92);
  assert.deepEqual(cssVarDeclarations('tl-vmin-cap'),
    [`min(${vminPct}vw, ${vminPct}dvh)`, `min(${vminPct}vw, ${vminPct}vh)`]);

  // UI 예산 — calc 항이 UI_STACK_BUDGET_PARTS 의 선언 순서·값과 문자까지 같아야 한다.
  const parts = Object.values(UI_STACK_BUDGET_PARTS).map(px).join(' + ');
  assert.deepEqual(cssVarDeclarations('tl-ui-stack-h'), [`calc(${parts})`]);
  assert.equal(UI_STACK_BUDGET, 416);
  assert.equal(
    Object.values(UI_STACK_BUDGET_PARTS).reduce((a, b) => a + b, 0),
    UI_STACK_BUDGET,
  );
  const capPct = Math.round(UI_BUDGET_CAP_FRACTION * 100);
  assert.deepEqual(cssVarDeclarations('tl-ui-min-h'), [
    `min(var(--tl-ui-stack-h), ${capPct}dvh)`,
    `min(var(--tl-ui-stack-h), ${capPct}vh)`,
  ]);
  const splitCapPct = Math.round(SPLIT_PANEL_CAP_FRACTION * 100);
  assert.deepEqual(cssVarDeclarations('tl-ui-min-w'),
    [`min(${px(SPLIT_PANEL_MIN_WIDTH)}, ${splitCapPct}vw)`]);

  // 정사각 한 변 — 스택판(기본) + 옆배치판(미디어쿼리). 항의 순서까지 scanLayout() 과 같다.
  assert.deepEqual(cssVarDeclarations('tl-square-side'), [
    `max(${px(SQUARE_MIN_SIDE)}, min(var(--tl-vmin-cap), var(--tl-avail-w), ` +
      'calc(var(--tl-avail-h) - var(--tl-ui-min-h))))',
    `max(${px(SQUARE_MIN_SIDE)}, min(var(--tl-vmin-cap), var(--tl-avail-h), ` +
      'calc(var(--tl-avail-w) - var(--tl-ui-min-w) - var(--tl-split-gap))))',
  ]);
  assert.match(SCANNER_HTML, /\.square-stage \{[^}]*width: var\(--tl-square-side\);/);

  // 배치 모드 경계 — CSS 미디어쿼리와 SPLIT_MIN_ASPECT 가 같은 유리수여야 한다.
  const num = Math.round(SPLIT_MIN_ASPECT * 10);
  assert.equal(num / 10, SPLIT_MIN_ASPECT);
  assert.ok(SCANNER_HTML.includes(`@media (min-aspect-ratio: ${num}/10)`));
  // 구 가로 조건(높이 620 이하 + landscape)은 배치 조건에서 사라져야 한다 —
  // 태블릿 가로·폴드 가로가 그 조건에 안 걸려 세로 스택으로 렌더된 것이 결함이었다.
  assert.doesNotMatch(SCANNER_HTML, /max-height: 620px\) and \(orientation: landscape/);
  assert.match(SCANNER_HTML, /@media \(max-height: 620px\) \{\s*\n\s*\.camera-gate-card/);
});

test('r4 ② 산식 — layoutModeFor 경계는 W/H = 0.9 에서 정확히 갈린다', () => {
  assert.equal(SPLIT_MIN_ASPECT, 0.9);
  assert.equal(layoutModeFor(900, 1000), 'split'); // 정확히 0.9 → 옆배치 (min-aspect-ratio 는 ≥)
  assert.equal(layoutModeFor(899, 1000), 'stack');
  assert.equal(layoutModeFor(1000, 900), 'split');
  assert.equal(layoutModeFor(0, 100), null);
  assert.equal(layoutModeFor(100, 0), null);
  assert.equal(scanLayout({ viewportWidth: 0, viewportHeight: 100 }), null);
});

/*
 * 기기 매트릭스 (브리프 작업 4). 무스크롤 증명은 «콘텐츠 폭·높이 ≤ 뷰포트» 이고,
 * 여기서 콘텐츠는 **예산 기준**(정사각 + UI 예산)이다 — 실제 콘텐츠가 예산보다 크면
 * 패널이 내부 스크롤을 갖고, 작으면 정사각이 커진다. 어느 쪽도 페이지를 못 늘린다.
 *
 * 내부 스크롤 여부는 별도로 «UI 실제 높이 모델»과 비교해 여유(px)를 기록한다.
 * 이 모델은 CSS 선언값 산술이지 브라우저 실측이 아니다 — 가정은 modelStackUiHeight
 * 주석에 명시돼 있고, 판정(assert)에는 쓰지 않는다.
 */
const R4_VIEWPORTS = [
  { name: 'phone-390x844', w: 390, h: 844, mode: 'stack' },
  { name: 'fold-closed-344x882', w: 344, h: 882, mode: 'stack' },
  { name: 'tall-320x980', w: 320, h: 980, mode: 'stack' },
  /*
   * [추가 2026-08-16, r5] 짧은 폰 2종. 예산 캡(52dvh)이 실제로 걸리는 구간이라
   * r4 표본(전부 h ≥ 844)에는 **이 구간이 없었다** — 그래서 「사진에서 스캔이 패널
   * 가시 영역 밖으로 밀린다」 는 회귀를 매트릭스가 못 봤다. 표본이 없으면 단언도 없다.
   */
  { name: 'phone-short-375x667', w: 375, h: 667, mode: 'stack' },
  { name: 'phone-short-360x640', w: 360, h: 640, mode: 'stack' },
  { name: 'tablet-portrait-768x1024', w: 768, h: 1024, mode: 'stack' },
  { name: 'tablet-landscape-1024x768', w: 1024, h: 768, mode: 'split' },
  { name: 'fold-open-1812x2176', w: 1812, h: 2176, mode: 'stack' },
  { name: 'fold-open-2176x1812', w: 2176, h: 1812, mode: 'split' },
  // 브리프 표기(1812×2176)는 디바이스 픽셀로 보인다. DPR 2.625 환산 CSS 뷰포트도 함께 건다.
  { name: 'fold-open-css-690x829', w: 690, h: 829, mode: 'stack' },
  { name: 'phone-landscape-844x390', w: 844, h: 390, mode: 'split' },
];

/**
 * 세로 스택에서 UI 가 실제로 차지하는 높이(px) — CSS 선언값 산술.
 * 가정(브라우저 실측 아님): line-height normal = 1.2, 줄 수는 인자로 받는다.
 *   .brand-logo 32 · .scan-guide-message 16 + n×lh · .scan-scope-note 4 + n×16.2
 *   .scan-guide-wrap gap 8×2 · 패널 gap 10 · .scanner-bottom padding 12 + gap 12×n
 *   .scan-status 14 + n×18.2 · .zoom-controls 62 · .photo-button 52
 *   .site-footer 8 + n×14.85 · 셸 gap 10×3 + padding 10×2
 */
function modelStackUiHeight(width, {
  messageLines = 1, noteLines = [1, 1], statusLines = 1, footerLines = 1, zoom = true,
} = {}) {
  const messageFont = Math.min(16, Math.max(14, 0.038 * width));
  const center = (16 + messageLines * messageFont * 1.35) +
    noteLines.reduce((sum, n) => sum + 4 + n * 12 * 1.35, 0) + 16;
  const bottom = 12 + (14 + statusLines * 13 * 1.4) +
    (zoom ? 12 + 62 : 0) + 12 + 52;
  return 32 + center + SHELL_GAP + bottom + (8 + footerLines * 11 * 1.35) +
    SHELL_GAP * 3 + SHELL_PAD_MIN * 2;
}

test('r4 ③ 수치 — 기기 매트릭스에서 콘텐츠 폭·높이가 뷰포트를 넘지 않는다 (무스크롤)', () => {
  const rows = [];
  for (const vp of R4_VIEWPORTS) {
    const L = scanLayout({ viewportWidth: vp.w, viewportHeight: vp.h });
    assert.equal(L.mode, vp.mode, vp.name + ': 배치 모드 판정');

    // ⓒ 무스크롤 불변식 — 예산 기준 콘텐츠가 뷰포트 이하.
    assert.ok(L.contentHeight <= vp.h + 1e-9,
      `${vp.name}: 세로 초과 ${(L.contentHeight - vp.h).toFixed(2)}px`);
    assert.ok(L.contentWidth <= vp.w + 1e-9,
      `${vp.name}: 가로 초과 ${(L.contentWidth - vp.w).toFixed(2)}px`);
    assert.equal(L.fits, true, vp.name + ': 하한(96px)이 걸려 예산이 성립하지 않는다');
    assert.notEqual(L.binding, 'floor', vp.name + ': 정사각이 절대 하한까지 밀렸다');

    // ⓐⓑ 정사각 변 — CSS min/max 체인과 같은 값인지 항별로 재계산해 대조.
    const expected = Math.max(SQUARE_MIN_SIDE, Math.min(
      SQUARE_VIEW_FRACTION * Math.min(vp.w, vp.h),
      vp.mode === 'stack' ? L.availWidth : L.availHeight,
      vp.mode === 'stack'
        ? L.availHeight - Math.min(UI_STACK_BUDGET, UI_BUDGET_CAP_FRACTION * vp.h)
        : L.availWidth - Math.min(SPLIT_PANEL_MIN_WIDTH, SPLIT_PANEL_CAP_FRACTION * vp.w)
          - SPLIT_COLUMN_GAP,
    ));
    assert.ok(Math.abs(L.squareSide - expected) < 1e-9, vp.name + ': 정사각 변 산식 불일치');
    // 정사각은 언제나 시각 여백 상한 이하 — squareViewSide() 와의 관계가 깨지지 않는다.
    assert.ok(L.squareSide <= squareViewSide(vp.w, vp.h) + 1e-9);

    // ⓓ 가이드 18점 — 뷰가 어떤 크기가 되든 전부 뷰 안 (구조 불변식: 최대 반경 27%).
    const dots = guideDotPositions(L.squareSide, L.squareSide / 2, L.squareSide / 2);
    assert.equal(dots.outer.length + dots.middle.length + dots.inner.length, 18);
    assert.deepEqual(dotsOutOfBounds(dots, L.squareSide), [], vp.name + ': 점이 뷰를 벗어난다');

    // 내부 스크롤 여유 — 판정이 아니라 기록. 스택만 모델이 있다.
    const uiModel = vp.mode === 'stack' ? modelStackUiHeight(vp.w) : null;
    rows.push({
      viewport: vp.name,
      w: vp.w,
      h: vp.h,
      aspect: Number(L.aspect.toFixed(3)),
      mode: L.mode,
      binding: L.binding,
      squareSide: Number(L.squareSide.toFixed(2)),
      uiBudget: Number(L.uiBudget.toFixed(2)),
      panelExtent: Number(L.panelExtent.toFixed(2)),
      // r5: 도달성 축. 가시 높이와, 행동 컨트롤 3종을 담고 남는 여유.
      panelVisibleHeight: Number(L.panelVisibleHeight.toFixed(2)),
      actionControlsHeadroom: Number((L.panelVisibleHeight - ACTION_CONTROLS_HEIGHT).toFixed(2)),
      // 재배열 전 순서(안내 문구 선행)에서 사진 버튼 아래끝이 놓였던 자리.
      legacyPhotoBottom: UI_STACK_BUDGET_PARTS.guide + SHELL_GAP + ACTION_CONTROLS_HEIGHT,
      contentWidth: Number(L.contentWidth.toFixed(2)),
      contentHeight: Number(L.contentHeight.toFixed(2)),
      spareWidth: Number((vp.w - L.contentWidth).toFixed(2)),
      spareHeight: Number((vp.h - L.contentHeight).toFixed(2)),
      uiModelHeight: uiModel === null ? null : Number(uiModel.toFixed(2)),
      panelHeadroom: uiModel === null ? null : Number((L.panelExtent - uiModel).toFixed(2)),
      legacySquare: Number(squareViewSide(vp.w, vp.h).toFixed(2)),
      legacyOverflow: Number(
        (squareViewSide(vp.w, vp.h) + UI_STACK_BUDGET - vp.h).toFixed(2),
      ),
    });
  }

  mkdirSync(ROOT + 'test/output', { recursive: true });
  writeFileSync(
    ROOT + 'test/output/claude-scanui-responsive-matrix.json',
    JSON.stringify({
      constants: {
        SQUARE_VIEW_FRACTION,
        SQUARE_MIN_SIDE,
        SPLIT_MIN_ASPECT,
        SHELL_PAD_MIN,
        SHELL_GAP,
        SPLIT_COLUMN_GAP,
        SPLIT_PANEL_MIN_WIDTH,
        SPLIT_PANEL_CAP_FRACTION,
        UI_STACK_BUDGET,
        UI_STACK_BUDGET_PARTS,
        UI_BUDGET_CAP_FRACTION,
      },
      viewports: rows,
    }, null, 2) + '\n',
  );
});

test('r4 ③ 수치 — 구 산식(0.92 × 짧은 변 단일항)이 실제로 넘쳤음을 회귀 증인으로 고정한다', () => {
  // 구 배치는 정사각 아래에 스택을 그대로 쌓았고, 스택 높이(≈ UI_STACK_BUDGET)를
  // 산식에 넣지 않았다. 아래 네 건이 진단표의 초과 케이스다.
  for (const [w, h] of [[768, 1024], [1024, 768], [2176, 1812], [690, 829]]) {
    const legacy = squareViewSide(w, h) + UI_STACK_BUDGET;
    assert.ok(legacy > h, `${w}×${h}: 구 산식이 넘치지 않는다 — 회귀 증인이 무의미해졌다`);
    const now = scanLayout({ viewportWidth: w, viewportHeight: h });
    assert.ok(now.contentHeight <= h, `${w}×${h}: 새 산식이 여전히 넘친다`);
  }
  // 반대로 가늘고 긴 폰은 구 산식에서도 넘치지 않았다 — 결함이 «세로 전부» 가 아니라
  // «비율» 의 문제였다는 진단을 고정한다.
  for (const [w, h] of [[390, 844], [344, 882], [320, 980]]) {
    assert.ok(squareViewSide(w, h) + UI_STACK_BUDGET <= h, `${w}×${h}: 진단 전제가 틀렸다`);
  }
});

test('r4 ③ 수치 — safe-area 인셋이 있어도, 회전해도 무스크롤이 유지된다', () => {
  const insets = { safeAreaTop: 59, safeAreaRight: 0, safeAreaBottom: 34, safeAreaLeft: 0 };
  for (const vp of R4_VIEWPORTS) {
    const L = scanLayout({ viewportWidth: vp.w, viewportHeight: vp.h, ...insets });
    assert.ok(L.contentHeight <= vp.h + 1e-9, vp.name + ' (safe-area): 세로 초과');
    assert.ok(L.contentWidth <= vp.w + 1e-9, vp.name + ' (safe-area): 가로 초과');
    // 인셋은 정사각을 키우지 못한다 (가용 영역이 줄어드니까).
    const bare = scanLayout({ viewportWidth: vp.w, viewportHeight: vp.h });
    assert.ok(L.squareSide <= bare.squareSide + 1e-9);
    // 회전 — 스왑해도 여전히 무스크롤이다.
    const R = scanLayout({ viewportWidth: vp.h, viewportHeight: vp.w });
    assert.ok(R.contentHeight <= vp.w + 1e-9, vp.name + ' (회전): 세로 초과');
    assert.ok(R.contentWidth <= vp.h + 1e-9, vp.name + ' (회전): 가로 초과');
  }
});

test('r4 ③ 수치 — 무스크롤 보증 범위와 하한(96px)이 걸리는 경계를 고정한다', () => {
  // 스택: 세로 242px 이상 · 가로 116px 이상이면 하한이 안 걸리고 예산이 성립한다.
  for (const [w, h] of [[320, 568], [320, 400], [320, 360], [116, 400]]) {
    const L = scanLayout({ viewportWidth: w, viewportHeight: h });
    if (L.mode !== 'stack') continue;
    assert.equal(L.fits, true, `${w}×${h}: 스택 보증 범위인데 예산이 안 맞는다`);
  }
  // 옆배치: 가로 225px 이상 — fitCap = 0.58W − 34 ≥ 96. 패널 폭 캡(42vw) 덕에
  // 고정 300px 이었다면 생겼을 «가로 430px 절벽» 이 없다.
  for (const [w, h] of [[568, 320], [844, 390], [480, 320], [240, 240]]) {
    const L = scanLayout({ viewportWidth: w, viewportHeight: h });
    if (L.mode !== 'split') continue;
    assert.equal(L.fits, true, `${w}×${h}: 옆배치 보증 범위인데 예산이 안 맞는다`);
  }
  // 보증 범위 밖(비현실적으로 작은 뷰포트)에서는 하한이 걸리고 fits=false 로 **드러난다** —
  // 조용히 넘치지 않는다. body{min-width:320px} 이므로 실기기에는 없는 영역이다.
  const tiny = scanLayout({ viewportWidth: 150, viewportHeight: 220 });
  assert.equal(tiny.mode, 'stack');
  assert.equal(tiny.binding, 'floor');
  assert.equal(tiny.fits, false);
});

/*
 * ══ r5 도달성 — 잘리는 것이 «행동» 이 아니라 «설명» 이어야 한다 ══════════════════
 *
 * r4 는 페이지 스크롤 0 을 구조로 만들었지만, 그 대가로 **패널 내부**에 잘림을 몰았다.
 * 그런데 r4 의 패널 순서는 «안내 문구 → 상태·줌·사진 버튼» 이라, 예산 캡(52dvh)이
 * 걸리는 짧은 폰에서 잘리는 쪽이 **사진에서 스캔 버튼**이었다. 페이지는 안 스크롤됐고
 * 매트릭스도 초록이었다 — 재는 자(무스크롤)에 그 축이 없었기 때문이다.
 *
 * 그래서 여기서는 다른 축을 잰다: `panelVisibleHeight`(패널 가시 높이) 대비
 * `ACTION_CONTROLS_HEIGHT`(상태+줌+사진). 그리고 DOM 순서 자체를 고정한다 —
 * 수치만으로는 순서를 되돌린 회귀를 못 잡는다.
 */

/** `.scanner-panels` 안에서 요소가 나타나는 문자 위치. 못 찾으면 −1. */
function panelOrderIndex(needle) {
  const open = SCANNER_HTML.indexOf('<div class="scanner-panels"');
  const close = SCANNER_HTML.indexOf('<footer class="site-footer">', open);
  assert.ok(open > 0 && close > open, '.scanner-panels 블록을 못 찾았다');
  const block = SCANNER_HTML.slice(open, close);
  const at = block.indexOf(needle);
  return at === -1 ? -1 : at;
}

test('r5 ① 순서 — 패널 안이 상태 → 줌 → 사진 버튼 → 안내 문구 → 기타 다', () => {
  const status = panelOrderIndex('id="scan-status"');
  const zoom = panelOrderIndex('id="zoom-controls"');
  const photo = panelOrderIndex('id="choose-image"');
  const guide = panelOrderIndex('class="scan-center"');
  const picker = panelOrderIndex('id="camera-picker"');
  for (const [name, at] of [['상태', status], ['줌', zoom], ['사진 버튼', photo],
    ['안내 문구', guide], ['렌즈 선택', picker]]) {
    assert.ok(at >= 0, name + ' 가 .scanner-panels 안에 없다');
  }
  assert.ok(status < zoom, '상태가 줌보다 뒤에 있다');
  assert.ok(zoom < photo, '줌이 사진 버튼보다 뒤에 있다');
  assert.ok(photo < guide,
    '사진 버튼이 안내 문구보다 뒤에 있다 — 내부 오버플로가 행동 컨트롤을 자른다(r5 회귀)');
  assert.ok(guide < picker, '기타(렌즈 선택)가 안내 문구보다 앞에 있다');

  // 시각 순서는 DOM 순서로만 바꾼다. CSS order 는 초점·낭독 순서와 갈라진다.
  assert.doesNotMatch(SCANNER_HTML, /\.scan(?:ner-bottom|-center)[^{]*\{[^}]*\border:\s*-?\d/,
    'CSS order 로 순서를 흉내 냈다 — 접근성 순서가 시각 순서와 갈라진다');
  // i18n 속성과 id 는 이동 중에 보존됐다.
  assert.match(SCANNER_HTML, /id="choose-image" type="button" data-i18n="button\.photo"/);
  assert.match(SCANNER_HTML, /id="scan-status"[^>]*data-i18n="status\.preparing"/);
  assert.match(SCANNER_HTML, /id="camera-picker" data-i18n-attr="aria-label:picker\.label"/);
});

test('r5 ② 수치 — 평상 상태(줌 노출)의 상태+줌+사진이 패널 가시 영역 안에 들어간다', () => {
  // 상수의 분해가 CSS 선언과 같은지부터 — 값이 갈리면 아래 판정이 의미를 잃는다.
  assert.equal(PANEL_CHROME_HEIGHT, 90);   // 로고 36 + 푸터 24 + 셸 gap 10×3
  assert.equal(BOTTOM_STACK_CHROME, 36);   // .scanner-bottom padding-top 12 + gap 12×2
  assert.equal(ACTION_CONTROLS_HEIGHT, 184); // 36 + 34 + 62 + 52
  assert.match(SCANNER_HTML, /\.scanner-bottom \{[^}]*gap: 12px;\s*padding-top: 12px;/);

  for (const vp of R4_VIEWPORTS) {
    const L = scanLayout({ viewportWidth: vp.w, viewportHeight: vp.h });
    assert.ok(L.panelVisibleHeight >= ACTION_CONTROLS_HEIGHT,
      `${vp.name}: 사진 버튼이 패널 가시 영역 밖 — 가시 ${L.panelVisibleHeight.toFixed(2)}px < `
      + `필요 ${ACTION_CONTROLS_HEIGHT}px`);
  }
});

test('r5 ② 수치 — 재배열 전 순서가 짧은 폰에서 실제로 밀렸음을 회귀 증인으로 고정한다', () => {
  // 구 순서에서 사진 버튼 아래끝 = 안내 예산 132 + 패널 gap 10 + 컨트롤 184 = 326.
  const legacyPhotoBottom = UI_STACK_BUDGET_PARTS.guide + SHELL_GAP + ACTION_CONTROLS_HEIGHT;
  assert.equal(legacyPhotoBottom, 326);

  // 브리프가 짚은 두 뷰포트: 구 순서면 밀렸고, 새 순서면 안 밀린다.
  for (const [w, h] of [[375, 667], [360, 640]]) {
    const L = scanLayout({ viewportWidth: w, viewportHeight: h });
    assert.equal(L.binding, 'fit', `${w}×${h}: 예산 캡 구간이 아니다 — 증인 전제가 틀렸다`);
    assert.ok(L.uiBudget < UI_STACK_BUDGET,
      `${w}×${h}: 52dvh 캡이 안 걸린다 — 이 회귀가 나는 구간이 아니다`);
    assert.ok(legacyPhotoBottom > L.panelVisibleHeight,
      `${w}×${h}: 구 순서가 안 밀린다 — 회귀 증인이 무의미해졌다`);
    assert.ok(ACTION_CONTROLS_HEIGHT <= L.panelVisibleHeight,
      `${w}×${h}: 새 순서도 밀린다`);
  }
  // 반대로 긴 폰에서는 구 순서에서도 안 밀렸다 — 결함이 «세로 전부» 가 아니라
  // «짧은 세로»(예산 캡이 걸리는 구간) 였다는 진단을 고정한다.
  for (const [w, h] of [[390, 844], [344, 882], [320, 980]]) {
    const L = scanLayout({ viewportWidth: w, viewportHeight: h });
    assert.ok(legacyPhotoBottom <= L.panelVisibleHeight, `${w}×${h}: 진단 전제가 틀렸다`);
  }
});

test('r5 ③ 힌트 — 패널이 내부 오버플로일 때만 하단 페이드가 켜진다', () => {
  // 그리는 쪽 — 클래스가 붙었을 때만 마스크가 걸린다. 전송 바이트 0(외부 자원 없음).
  assert.match(SCANNER_HTML,
    /\.scanner-panels\.has-more \{[^}]*mask-image: linear-gradient\(to bottom, #000 calc\(100% - 28px\), transparent\);/);
  // iOS 구버전용 접두사판도 함께 — 없으면 정작 대상 기기에서 안 걸린다.
  assert.match(SCANNER_HTML, /-webkit-mask-image: linear-gradient\(to bottom, #000 calc\(100% - 28px\), transparent\);/);
  assert.doesNotMatch(SCANNER_HTML, /\.scanner-panels\.has-more \{[^}]*url\(/,
    '힌트가 외부 자원을 부른다 — 전송 0바이트 제약 위반');

  // 판정하는 쪽 — «아래에 더 있나». 맨 위(평상 상태)에서는 곧 scrollHeight > clientHeight 고,
  // 끝까지 내리면 꺼진다(끝에서 남는 페이드는 «더 있다» 는 거짓말이다).
  assert.match(SCANNER_JS,
    /scannerPanels\.scrollTop \+ scannerPanels\.clientHeight < scannerPanels\.scrollHeight - 1/);
  assert.match(SCANNER_JS, /scannerPanels\.classList\.toggle\('has-more', more\)/);
  // 재평가 트리거: 스크롤·리사이즈·회전 + 콘텐츠 변화(자식까지 관찰).
  assert.match(SCANNER_JS, /scannerPanels\.addEventListener\('scroll', syncPanelScrollHint/);
  assert.match(SCANNER_JS, /window\.addEventListener\('resize', syncPanelScrollHint\)/);
  assert.match(SCANNER_JS, /window\.addEventListener\('orientationchange', syncPanelScrollHint\)/);
  assert.match(SCANNER_JS, /for \(const panelChild of scannerPanels\.children\) panelResizeObserver\.observe\(panelChild\)/);
  // ResizeObserver 미지원 환경에서도 죽지 않는다 (구형 WebView).
  assert.match(SCANNER_JS, /if \(typeof ResizeObserver === 'function'\)/);
  // 마크업이 없으면 조용히 지나가지 않고 즉시 터진다 — 나머지 요소와 같은 계약.
  // (2026-08-16: 안정 게이지가 뒤에 붙어 조건이 한 줄 늘었다. 꼬리를 통째로 못박는 대신
  //  «scannerPanels 가 필수 목록에 있다» + «조건이 throw 로 닫힌다» 를 따로 단언한다 —
  //  요소가 늘 때마다 깨지되 검사가 약해지지는 않는 형태.)
  assert.match(SCANNER_JS, /!zoomErrorBox \|\| !dotLayer \|\| !scannerPanels\b/);
  assert.match(SCANNER_JS,
    /!steadyMeter \|\| !steadyMeterFill\) \{\n  throw new Error\('TLcube scanner markup is incomplete\.'\);/);
});

/*
 * ── 연속 실패 자동 크롭 사다리 (2026-08-18) ───────────────────────────────
 *
 * 근거 (실사진 역산 `test/output/lanes/claude-scanner-cellpx.out.txt`):
 * 운영자의 실패 거리가 셀당 3.7\~5.9px, 「되기 시작하는」 경계가 6.1\~6.3px 로
 * 합성 벽(ppu 7 본문 RS · ≤6 포맷 불가)과 같은 자리였다. 그 구간은 속도가 아니라
 * **셀 픽셀**이 모자란 것이라 어떤 알고리즘도 못 읽는다.
 *
 * ⚠ 기본 확대(DEFAULT_USER_ZOOM=1, 운영자 지시)는 **건드리지 않는다** — 위 핀이
 * 그대로 살아 있다. 실패가 쌓인 구간만 친다.
 */
test('자동 크롭 사다리 — 실패가 쌓이면 오르고, 잘림·수동·성공이면 개입하지 않는다', () => {
  assert.deepEqual([...AUTO_CROP_LADDER], [1, 1.5, 2.2]);
  // 성공(0) 과 문턱 미만은 개입 없음.
  assert.equal(autoCropRung(0), 0);
  assert.equal(autoCropRung(AUTO_CROP_STEP_MS - 1), 0);
  // 한 단씩 오르고 상한에서 멈춘다.
  assert.equal(autoCropRung(AUTO_CROP_STEP_MS), 1);
  assert.equal(autoCropRung(AUTO_CROP_STEP_MS * 2), 2);
  assert.equal(autoCropRung(AUTO_CROP_STEP_MS * 99), AUTO_CROP_LADDER.length - 1);
  // 잘림은 «너무 가깝다» — 확대는 정반대 처방이라 개입 금지.
  assert.equal(autoCropRung(AUTO_CROP_STEP_MS * 3, { clipped: true }), 0);
  // 사용자가 확대를 직접 건드렸으면 자동은 물러난다.
  assert.equal(autoCropRung(AUTO_CROP_STEP_MS * 3, { manual: true }), 0);
  // ⚠ 문턱은 **시간**이다 — 프레임 수로 잡으면 fps 가 낮을 때 체감이 무너진다
  //   (2026-08-18 실기기: 0.5fps 에서 8프레임 = 16초).
  assert.ok(AUTO_CROP_STEP_MS <= 3000, '한 단 오르는 데 3초를 넘기면 사용자가 먼저 포기한다');
  assert.match(SCANNER_JS, /failStreakSince/);
  assert.match(SCANNER_JS, /Date\.now\(\) - failStreakSince/);
  // 배율 조회는 범위 밖을 양끝으로 물린다.
  assert.equal(autoCropZoomFor(-5), 1);
  assert.equal(autoCropZoomFor(99), 2.2);
  // 상한 2.2 의 근거 — 실패 세트 3.7~5.9px 를 벽(6~7) 위로 올린다.
  assert.ok(3.7 * AUTO_CROP_LADDER[AUTO_CROP_LADDER.length - 1] > 7);
  // 스캐너가 실제로 이 사다리를 쓰고, 분석·프리뷰가 **같은 출처**를 쓴다
  // (어긋나면 2026-08-15 «가이드 ≠ 분석» 사고 재현 — 성공 0%/274).
  assert.match(SCANNER_JS, /function effectiveCropZoom\(\)/);
  assert.match(SCANNER_JS, /maxSide,\s*\n\s*effectiveCropZoom\(\),/);
  assert.match(SCANNER_JS, /const scale = effectiveCropZoom\(\);/);
  assert.match(SCANNER_JS, /autoCropRung\(failStreakSince/);
});
