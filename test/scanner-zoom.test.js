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
  DEFAULT_USER_ZOOM,
  EDGE_UNIT_OFFSETS,
  FRAME_MAX_SIDE,
  GUIDE_CELLS_V3,
  GUIDE_CELLS_Y2,
  GUIDE_FINDER_RADIUS_CELLS,
  GUIDE_INNER_FRACTION,
  GUIDE_MIDDLE_FRACTION,
  GUIDE_OUTER_FRACTION,
  GUIDE_PAIR_K,
  SQUARE_VIEW_FRACTION,
  aimGuideMinFractions,
  applyTrackZoom,
  buttonStep,
  cropWindow,
  dotsOutOfBounds,
  effectiveMagnification,
  guideDotPositions,
  guideOccupancyEstimates,
  kaApexRadiusCells,
  parseZoomCapability,
  previewSourceWindow,
  resolveZoomPlan,
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
  assert.match(SCANNER_HTML, /min\(92vw, 92dvh\)/);
  assert.match(SCANNER_HTML, /aspect-ratio: 1 \/ 1/);
});

/*
 * r3 기기 매트릭스 수치 테스트 (작업 3): 뷰포트 폰 390×844 · 태블릿 1024×768 ·
 * 폴드 접힘 344×882 · 폴드 펼침 1812×2176 × 센서 1280×720 / 720×1280.
 * ⓐ 정사각 뷰 변 ⓑ 18점 전부 뷰 안 ⓒ 프리뷰≡분석 ⓓ 점유율·cell_px 표(JSON 산출).
 */
test('r3 기기 매트릭스 — 뷰 변·18점 포함·프리뷰≡분석·cell_px 표', () => {
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
  const matrix = { fraction: SQUARE_VIEW_FRACTION, viewports: [], sensors: [], cellPx: {} };

  for (const vp of VIEWPORTS) {
    // ⓐ 뷰 변 = 0.92 × 짧은 변 — 방향을 타지 않는다 (w/h 스왑 동일).
    const side = squareViewSide(vp.w, vp.h);
    assert.ok(Math.abs(side - 0.92 * Math.min(vp.w, vp.h)) < 1e-9);
    assert.equal(squareViewSide(vp.h, vp.w), side, vp.name + ': 방향 의존');
    // ⓑ 18점 전부 뷰 안 (구조 불변식: 최대 반경 27% < 50%).
    const dots = guideDotPositions(side, side / 2, side / 2);
    assert.equal(dots.outer.length + dots.middle.length + dots.inner.length, 18);
    assert.deepEqual(dotsOutOfBounds(dots, side), [], vp.name + ': 점이 뷰를 벗어난다');
    matrix.viewports.push({ ...vp, squareSide: Number(side.toFixed(2)) });
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
