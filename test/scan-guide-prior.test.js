/**
 * scan-guide-prior.test.js — 가이드-사전 포즈 KAT.
 *
 * 두 방향을 **실측으로** 고정한다.
 *   ① 가이드에 정확히 정렬된 합성 렌더는 **사전 포즈만으로** 복호된다 (탐색 0회).
 *   ② 의도적 오정렬(가이드 밖 오프셋 · 틀린 배율)은 **게이트가 거부**한다 —
 *      사전 포즈는 후보 추가지 검증 면제가 아니다.
 *
 * ②가 이 파일의 핵심이다. 「탐색을 건너뛴다」 는 변경은 검증까지 건너뛰는 실수와
 * 한 글자 차이라, 거부가 실제로 일어나는지를 **소스 grep 이 아니라 실행**으로 본다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeY } from '../src/encodeY.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { SQRT3 } from '../src/hexgrid.js';
import {
  GUIDE_OUTER_FRACTION,
  kaApexRadiusCells,
  silhouetteRadiusCells,
} from '../src/scanner-zoom.js';
import {
  crossOffsets,
  guidePriorPoses,
  guideRingRadii,
  jitterPoses,
  layoutCellPx,
  PRIOR_COARSE_OFFSET_CELLS,
  PRIOR_COARSE_SCALES,
  PRIOR_LAYOUTS,
  PRIOR_MAX_REFINE_SEEDS,
  PRIOR_REFINE_OFFSET_CELLS,
  PRIOR_REFINE_SCALES,
  PRIOR_ROTATIONS,
  poseFromHypothesis,
  priorPoseBudget,
  refineSeedsFrom,
  similarityHomography,
} from '../src/scan-guide-prior.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { HOMOGRAPHY_CANONICAL_SPACE } from '../src/decoder/contracts.js';
import { PRIOR_POSE_BATCH } from '../src/decoder/bootstrap.js';
import { steadyLine } from '../src/scanner-debug-overlay.js';
import { BEACON_MAGIC } from '../src/centralBeacon.js';
import { tryReadBeaconFromText } from '../src/decoder/central-beacon-adapt.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from '../src/finder-selection.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCANNER_JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const FRAME_SIDE = 960;
const TEXT = 'tlcube guide prior';

/** 레이아웃 id → 렌더. margin 은 형상별로 다르다(A 삼각 패치가 육각 기본을 넘는다). */
function renderLayout(layoutId, cellPx) {
  if (layoutId.startsWith('O-')) {
    const version = { 'O-k6': 1, 'O-k8': 2, 'O-k10': 3 }[layoutId];
    const encoded = encode(TEXT, { version, eccLevel: 'M' });
    const scene = buildScene(encoded, { palette: PALETTE, margin: 1 });
    return { scene, raster: rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }) };
  }
  if (layoutId.startsWith('A-')) {
    const version = { 'A-k6': 0, 'A-k8': 1, 'A-k10': 2 }[layoutId];
    const encoded = encodeA(TEXT, { version, eccLevel: 'M' });
    const scene = buildScene(encoded, { palette: PALETTE, margin: 26 });
    return { scene, raster: rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }) };
  }
  const version = { 'Y-n21': 1, 'Y-n25': 2 }[layoutId];
  const encoded = encodeY(TEXT, { version, eccLevel: 'M', tones: 3 });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 1 });
  return { scene, raster: rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }) };
}

/**
 * 렌더를 분석 정사각 프레임에 놓는다 — 코드 중심이 (S/2 + dx, S/2 + dy) 에 오고
 * 배율이 factor 배. 역매핑 + 이중선형이라 리샘플은 한 번뿐이다.
 */
function placeInFrame(raster, scene, { dx = 0, dy = 0, factor = 1 } = {}) {
  const pixels = new Uint8ClampedArray(FRAME_SIDE * FRAME_SIDE * 4);
  const ppu = raster.pixelsPerUnit;
  const originX = scene.layout.originX * ppu;
  const originY = scene.layout.originY * ppu;
  const cx = FRAME_SIDE / 2 + dx;
  const cy = FRAME_SIDE / 2 + dy;

  for (let y = 0; y < FRAME_SIDE; y += 1) {
    for (let x = 0; x < FRAME_SIDE; x += 1) {
      const sx = (x - cx) / factor + originX;
      const sy = (y - cy) / factor + originY;
      const offset = (y * FRAME_SIDE + x) * 4;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= raster.width || y0 + 1 >= raster.height) {
        pixels[offset] = FILL.r;
        pixels[offset + 1] = FILL.g;
        pixels[offset + 2] = FILL.b;
        pixels[offset + 3] = 255;
        continue;
      }
      const tx = sx - x0;
      const ty = sy - y0;
      for (let channel = 0; channel < 3; channel += 1) {
        const p00 = raster.pixels[(y0 * raster.width + x0) * 4 + channel];
        const p10 = raster.pixels[(y0 * raster.width + x0 + 1) * 4 + channel];
        const p01 = raster.pixels[((y0 + 1) * raster.width + x0) * 4 + channel];
        const p11 = raster.pixels[((y0 + 1) * raster.width + x0 + 1) * 4 + channel];
        pixels[offset + channel] = Math.round(
          p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty)
          + p01 * (1 - tx) * ty + p11 * tx * ty,
        );
      }
      pixels[offset + 3] = 255;
    }
  }
  return { width: FRAME_SIDE, height: FRAME_SIDE, pixels };
}

function decodeWithPoses(frame, poses) {
  return decodeFrontend(
    { width: frame.width, height: frame.height, pixels: frame.pixels },
    { priorPoses: poses },
  );
}

function admittedOf(result) {
  const prior = result.ok
    ? (result.diagnostics && result.diagnostics.bootstrap && result.diagnostics.bootstrap.prior)
    : (result.detail && (result.detail.prior
      || (result.detail.cause && result.detail.cause.prior)));
  return (prior && prior.admittedPoses) || [];
}

/** 2단계까지 포함한 「사전만으로 시도」 — scanner.js attemptGuidePriorScan 과 같은 순서. */
function priorScan(frame) {
  const coarse = guidePriorPoses({ frameSide: FRAME_SIDE });
  const first = decodeWithPoses(frame, coarse);
  if (first.ok) return { result: first, stage: 'coarse', coarse };
  const refine = refineSeedsFrom(coarse, admittedOf(first), { frameSide: FRAME_SIDE });
  if (refine.length === 0) return { result: first, stage: 'coarse', coarse, refineCount: 0 };
  return {
    result: decodeWithPoses(frame, refine),
    stage: 'refine',
    coarse,
    refineCount: refine.length,
  };
}

// ── 기하 유도 ────────────────────────────────────────────────────────────────

test('셀 크기는 가이드 상수에서만 나온다 — O 중간 링 = K/A 바깥 링 (같은 k)', () => {
  const radii = guideRingRadii(FRAME_SIDE);
  assert.ok(Math.abs(radii.outer - (GUIDE_OUTER_FRACTION * FRAME_SIDE) / 2) < 1e-12);
  assert.ok(Math.abs(radii.outer / radii.middle - SQRT3) < 1e-12);

  for (const k of [6, 8, 10]) {
    const hex = layoutCellPx({ family: 'hex', k }, FRAME_SIDE);
    const tri = layoutCellPx({ family: 'tri', k }, FRAME_SIDE);
    // 운영자 불변식: 같은 k 면 셀 크기가 같다 (silhouetteRadiusCells = kaApex/√3).
    assert.ok(Math.abs(hex - tri) < 1e-12, 'k=' + k);
    assert.ok(Math.abs(hex - radii.middle / silhouetteRadiusCells(k)) < 1e-12);
    assert.ok(Math.abs(tri - radii.outer / kaApexRadiusCells(k)) < 1e-12);
  }
  // Y 는 canonical 육각 꼭짓점 반경이 n 이다 (cube-detect vertexSetResidual 규약).
  for (const n of [21, 25]) {
    assert.ok(Math.abs(layoutCellPx({ family: 'cube', n }, FRAME_SIDE) - radii.outer / n) < 1e-12);
  }
});

test('포즈 H 는 순수 닮음변환이고 회전은 60° 격자 6개다', () => {
  assert.deepEqual([...PRIOR_ROTATIONS], [0, 60, 120, 180, 240, 300]);
  const H = similarityHomography(4, 90, 100, 200);
  // canonical (1,0) → 90° 회전 → (0, 4) 만큼 이동한 자리.
  assert.ok(Math.abs(H[0] - 0) < 1e-12);
  assert.ok(Math.abs(H[1] + 4) < 1e-12);
  assert.equal(H[2], 100);
  assert.ok(Math.abs(H[3] - 4) < 1e-12);
  assert.equal(H[5], 200);
  assert.deepEqual([H[6], H[7], H[8]], [0, 0, 1], '원근 항이 있으면 닮음이 아니다');
  assert.equal(similarityHomography(0, 0, 0, 0), null);
});

test('rotationDegrees 부재 시 H 국소 x축에서 복원하며 명시값과 1e-9° 안에서 같다', () => {
  const toleranceDegrees = 1e-9;
  const counts = { hex: 0, tri: 0, cube: 0 };
  let maximumErrorDegrees = 0;
  const poses = guidePriorPoses({ frameSide: FRAME_SIDE });
  assert.ok(poses.length > 0, '가이드-사전 대조군이 0개라 회전 검산이 공허하다');

  for (const source of poses) {
    const hypothesis = {
      family: source.family,
      k: source.k,
      n: source.n,
      canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
      H: [...source.H],
    };
    assert.equal(Object.hasOwn(hypothesis, 'rotationDegrees'), false,
      '복원 대조군에 rotationDegrees 가 섞였다');
    const derived = poseFromHypothesis(hypothesis);
    const explicit = poseFromHypothesis({
      ...hypothesis,
      rotationDegrees: source.rotationDegrees,
    });
    assert.ok(derived, `${source.id}: H 회전 복원 실패`);
    assert.ok(explicit, `${source.id}: 명시 회전 대조군 실패`);

    const rawError = Math.abs(derived.rotationDegrees - explicit.rotationDegrees) % 360;
    const errorDegrees = Math.min(rawError, 360 - rawError);
    maximumErrorDegrees = Math.max(maximumErrorDegrees, errorDegrees);
    counts[source.family] += 1;
    assert.ok(errorDegrees <= toleranceDegrees,
      `${source.id}: H 복원 오차 ${errorDegrees}° > ${toleranceDegrees}°`);
  }

  assert.deepEqual(counts, { hex: 270, tri: 270, cube: 180 });
  console.log('POSEROT_DERIVATION ' + JSON.stringify({
    samples: poses.length,
    counts,
    maximumErrorDegrees,
    toleranceDegrees,
  }));
});

test('포즈 목록은 결정적이고 예산 안이다 — 8 레이아웃 × 6 회전 × 3 배율 × 5 오프셋', () => {
  const poses = guidePriorPoses({ frameSide: FRAME_SIDE });
  const expected = PRIOR_LAYOUTS.length * PRIOR_ROTATIONS.length
    * PRIOR_COARSE_SCALES.length * crossOffsets(PRIOR_COARSE_OFFSET_CELLS).length;
  assert.equal(poses.length, expected);
  assert.equal(poses.length, 720);
  // 첫 포즈는 「가이드에 정확히 맞았다」 그 자체여야 한다 (배치 조기 종료의 전제).
  assert.equal(poses[0].scale, 1);
  assert.deepEqual(poses[0].offsetCells, { dx: 0, dy: 0 });
  assert.equal(poses[0].rotationDegrees, 0);
  /*
   * 첫 배치(48) = 오차 0 가정 전체 (8×6). `PRIOR_POSE_BATCH`(bootstrap.js)와
   * `PRIOR_LAYOUTS × PRIOR_ROTATIONS`(scan-guide-prior.js)는 **다른 파일의 중복 상수**라
   * 이 항등을 여기서 못박는다 — 레이아웃이나 회전을 추가하는 순간 「첫 배치 = 오차 0
   * 가정 전체」 성질이 조용히 깨지고 조기 종료의 전제가 사라진다.
   */
  assert.equal(PRIOR_POSE_BATCH, PRIOR_LAYOUTS.length * PRIOR_ROTATIONS.length,
    'PRIOR_POSE_BATCH 와 (레이아웃 × 회전) 이 어긋났다 — 배치 조기 종료 전제가 깨진다');
  for (let index = 0; index < PRIOR_POSE_BATCH; index += 1) {
    assert.equal(poses[index].scale, 1, 'index=' + index);
    assert.deepEqual(poses[index].offsetCells, { dx: 0, dy: 0 }, 'index=' + index);
  }
  // 결정성 — 같은 입력이면 id 열이 같다.
  assert.deepEqual(
    guidePriorPoses({ frameSide: FRAME_SIDE }).map((pose) => pose.id),
    poses.map((pose) => pose.id),
  );
  // id 중복 없음 (중복은 예산만 먹는다).
  assert.equal(new Set(poses.map((pose) => pose.id)).size, poses.length);
  assert.deepEqual(guidePriorPoses({ frameSide: 0 }), []);
});

test('2단계는 **배율만** 정제하고 씨앗은 통과한 포즈에서만 나온다', () => {
  assert.deepEqual([...PRIOR_REFINE_OFFSET_CELLS], [0],
    '2단계 오프셋은 실측상 회수 0 이라 비웠다 — 되살리려면 근거를 다시 재라');
  const poses = guidePriorPoses({ frameSide: FRAME_SIDE });
  const jitter = jitterPoses(poses[0], { frameSide: FRAME_SIDE });
  assert.equal(jitter.length, PRIOR_REFINE_SCALES.length - 1, '(배율 1 · 오프셋 0)은 재평가 안 함');
  for (const pose of jitter) {
    assert.deepEqual(pose.offsetCells, { dx: 0, dy: 0 });
    assert.equal(pose.rotationDegrees, poses[0].rotationDegrees);
    assert.equal(pose.refinedFrom, poses[0].id);
  }

  // 통과하지 않은 포즈는 씨앗이 아니다.
  assert.deepEqual(refineSeedsFrom(poses, [], { frameSide: FRAME_SIDE }), []);
  const seeded = refineSeedsFrom(poses, [poses[3].id], { frameSide: FRAME_SIDE });
  assert.equal(seeded.length, PRIOR_REFINE_SCALES.length - 1);
  assert.ok(seeded.every((pose) => pose.refinedFrom === poses[3].id));

  // 씨앗 수 상한 — 예산 가드.
  const many = poses.slice(0, 10).map((pose) => pose.id);
  const capped = refineSeedsFrom(poses, many, { frameSide: FRAME_SIDE });
  assert.equal(
    new Set(capped.map((pose) => pose.refinedFrom)).size,
    PRIOR_MAX_REFINE_SEEDS,
  );

  const budget = priorPoseBudget({ frameSide: FRAME_SIDE });
  assert.equal(budget.coarseCount, 720);
  assert.equal(budget.refinePerAdmitted, PRIOR_REFINE_SCALES.length - 1);
});

// ── ① 정렬된 렌더는 사전만으로 복호된다 ─────────────────────────────────────

for (const layout of PRIOR_LAYOUTS) {
  test(`정렬 KAT — ${layout.id}: 가이드에 맞춘 렌더가 사전 포즈만으로 복호된다`, () => {
    const cellPx = layoutCellPx(layout, FRAME_SIDE);
    const { scene, raster } = renderLayout(layout.id, cellPx);
    const frame = placeInFrame(raster, scene);
    const poses = guidePriorPoses({ frameSide: FRAME_SIDE, layouts: [layout.id] });
    const result = decodeWithPoses(frame, poses);
    assert.equal(result.ok, true,
      layout.id + ' 사전 복호 실패: ' + (result.reason || '') );
    assert.equal(result.text, TEXT);
    // 「탐색을 안 돌았다」 의 증거 — 기하 출처가 guide-prior 다.
    assert.equal(result.diagnostics.bootstrap.geometry.source, 'guide-prior');
    assert.match(result.hypothesis.source, /^guide-prior$/);
  });
}

test('정렬 KAT — 여덟 레이아웃 후보를 **동시에** 던져도 정답 하나로 닫힌다', () => {
  const layout = PRIOR_LAYOUTS[0];
  const cellPx = layoutCellPx(layout, FRAME_SIDE);
  const { scene, raster } = renderLayout(layout.id, cellPx);
  const frame = placeInFrame(raster, scene);
  const { result, stage } = priorScan(frame);
  assert.equal(result.ok, true, '전 레이아웃 동시 후보에서 실패: ' + (result.reason || ''));
  assert.equal(result.text, TEXT);
  assert.equal(stage, 'coarse', '정확 정렬인데 2단계까지 갔다 — 배치 조기 종료가 안 먹는다');
  assert.equal(result.hypothesis.family, 'hex');
  assert.equal(result.hypothesis.k, 6);
});

// ── ①′ 비컨 억제 계약 — 사전 경로도 비컨 바이트를 내보내지 않는다 (F-79) ──────

function startsWithBeaconMagic(text) {
  if (typeof text !== 'string' || text.length < BEACON_MAGIC.length) return false;
  for (let i = 0; i < BEACON_MAGIC.length; i += 1) {
    if (text.charCodeAt(i) !== BEACON_MAGIC[i]) return false;
  }
  return true;
}

test('비컨 계약 — 비컨 품은 O-k8 을 사전이 읽으면 바깥 텍스트다, 매직은 절대 아니다', () => {
  /*
   * F-79: enumeratePriorGridHypotheses 에 일반 경로의 중앙 비컨 recast 훅이 없었다.
   *
   * 무엇을 재서 무엇이 나오는가 (실측 2026-08-23, 수리 시점):
   *   - 오늘의 포즈 빌더는 cellSurface 가설을 만들지 않아 (n=13 v0 포즈 부재 +
   *     cube base 의 cellSurface:false) 매직 «자체가» 이 경로로 복호될 수 없다.
   *   - 그래서 이 테스트의 양성 앵커는 「비컨 품은 프레임의 **바깥 텍스트**가
   *     사전 coarse 만으로 나온다」 이고 (공허 통과 아님),
   *   - 매직 부재 단언은 계약의 tripwire 다 — 사전 레이아웃에 cell-surface 가
   *     추가되는 날, 훅이 사라져 있으면 이 파일이 먼저 빨개진다.
   */
  const layout = PRIOR_LAYOUTS.find((entry) => entry.id === 'O-k8');
  const cellPx = layoutCellPx(layout, FRAME_SIDE);
  const encoded = encode(TEXT, { version: 2, eccLevel: 'M', centralV0: true });
  const scene = buildScene(encoded, {
    palette: PALETTE, margin: 1, finderPatternId: CENTRAL_V0_FINDER_PATTERN_ID,
  });
  const raster = rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 });
  const frame = placeInFrame(raster, scene);
  const { result, stage } = priorScan(frame);
  assert.equal(result.ok, true,
    '비컨 품은 프레임의 사전 복호가 죽었다 — 양성 앵커 소실: ' + (result.reason || ''));
  assert.equal(stage, 'coarse', '정확 정렬인데 2단계까지 갔다');
  assert.equal(result.text, TEXT);
  assert.equal(result.diagnostics.bootstrap.geometry.source, 'guide-prior');
  assert.equal(startsWithBeaconMagic(result.text), false,
    '비컨 바이트가 사전 경로로 새고 있다 — enumeratePriorGridHypotheses 의 recast 훅을 확인하라');
  assert.equal(tryReadBeaconFromText(result.text), null);
});

// ── ② 오정렬은 게이트가 거부한다 (완화 0 의 실측) ─────────────────────────────

test('오정렬 거부 — 가이드 밖 오프셋은 사전 포즈로도 복호되지 않는다', () => {
  const layout = PRIOR_LAYOUTS[0];
  const cellPx = layoutCellPx(layout, FRAME_SIDE);
  const { scene, raster } = renderLayout(layout.id, cellPx);
  // 3.5 셀(45px) 이탈 — 1단계 십자 격자(±0.3 셀)의 열 배 밖이다.
  const frame = placeInFrame(raster, scene, { dx: 45, dy: -30 });
  const { result } = priorScan(frame);
  assert.equal(result.ok, false, '가이드 밖 코드를 사전이 «읽었다» — 게이트가 뚫렸다');
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
});

test('오정렬 거부 — 틀린 배율(±25%)은 사전 포즈로도 복호되지 않는다', () => {
  const layout = PRIOR_LAYOUTS[0];
  const cellPx = layoutCellPx(layout, FRAME_SIDE);
  const { scene, raster } = renderLayout(layout.id, cellPx);
  for (const factor of [0.75, 1.25]) {
    const frame = placeInFrame(raster, scene, { factor });
    const { result } = priorScan(frame);
    assert.equal(result.ok, false, 'factor=' + factor + ' 를 사전이 «읽었다»');
  }
});

test('오정렬 거부 — 코드가 없는 프레임에서 사전이 아무 후보도 만들어 내지 않는다', () => {
  const pixels = new Uint8ClampedArray(FRAME_SIDE * FRAME_SIDE * 4);
  for (let index = 0; index < FRAME_SIDE * FRAME_SIDE; index += 1) {
    pixels[index * 4] = FILL.r;
    pixels[index * 4 + 1] = FILL.g;
    pixels[index * 4 + 2] = FILL.b;
    pixels[index * 4 + 3] = 255;
  }
  const { result } = priorScan({ width: FRAME_SIDE, height: FRAME_SIDE, pixels });
  assert.equal(result.ok, false);
});

test('오정렬 거부 — 사전 경로가 잘못된 텍스트를 만들어 내지 않는다 (오독 0)', () => {
  /*
   * 배율·중심 오차를 사다리 안팎으로 흔들며, **성공했다면 반드시 원문**이어야 한다.
   * 「대충 맞으면 아무 글자나 나온다」 가 이 변경의 최악 실패 모드다.
   *
   * ⚠ 정정 (2026-08-16 적대 검증 B): 예전 형태는 `if (result.ok) assert…` 뿐이라
   *   **공허 통과**였다 — 사전 경로가 통째로 죽어 아무것도 복호되지 않아도 초록이었다.
   *   게다가 O-k6 하나만 봤다. 양성 앵커(실제로 N건 이상 복호됐다)와 계열 커버리지를
   *   함께 못박는다. 「이 변경의 최악 실패 모드를 직접 잰다」 는 주장이 사실이 되려면
   *   테스트가 스스로 살아 있음을 증명해야 한다.
   */
  const cases = [
    { id: 'O-k6', factors: [0.95, 1.05, 1.12], offsets: [5, 10, 20] },
    { id: 'A-k8', factors: [0.98, 1.05], offsets: [4, 12] },
    { id: 'Y-n21', factors: [0.99, 1.05], offsets: [4, 12] },
  ];
  let decoded = 0;
  let attempts = 0;
  for (const entry of cases) {
    const layout = PRIOR_LAYOUTS.find((item) => item.id === entry.id);
    const cellPx = layoutCellPx(layout, FRAME_SIDE);
    const { scene, raster } = renderLayout(layout.id, cellPx);
    for (const factor of entry.factors) {
      const { result } = priorScan(placeInFrame(raster, scene, { factor }));
      attempts += 1;
      if (result.ok) {
        decoded += 1;
        assert.equal(result.text, TEXT, entry.id + ' factor=' + factor + ' 에서 오독');
      }
    }
    for (const dx of entry.offsets) {
      const { result } = priorScan(placeInFrame(raster, scene, { dx }));
      attempts += 1;
      if (result.ok) {
        decoded += 1;
        assert.equal(result.text, TEXT, entry.id + ' dx=' + dx + ' 에서 오독');
      }
    }
  }
  // 양성 앵커 — 스윕이 실제로 복호에 도달했다는 증거. 이게 없으면 위 단언이 공허해진다.
  assert.equal(attempts, 14);
  assert.ok(decoded >= 6,
    '스윕에서 복호된 건이 ' + decoded + '건뿐이다 — 오독 0 단언이 공허 통과일 수 있다');
});

// ── 배선 계약 ────────────────────────────────────────────────────────────────

test('연속 스캔 경로 무회귀 — priorPoses 가 없으면 decodeFrontend 는 종전 그대로다', () => {
  const layout = PRIOR_LAYOUTS[0];
  const cellPx = layoutCellPx(layout, FRAME_SIDE);
  const { scene, raster } = renderLayout(layout.id, cellPx);
  const frame = placeInFrame(raster, scene);
  const normal = decodeFrontend(
    { width: frame.width, height: frame.height, pixels: frame.pixels },
    {},
  );
  assert.equal(normal.ok, true, '탐색 경로가 이 렌더를 못 읽으면 대조가 성립하지 않는다');
  assert.equal(normal.text, TEXT);
  // 탐색 경로의 기하 출처는 사전이 아니다 — 두 경로가 섞이지 않았다는 증거.
  assert.notEqual(normal.diagnostics.bootstrap.geometry.source, 'guide-prior');
  assert.notEqual(normal.hypothesis.source, 'guide-prior');
});

test('배선 — 트리거는 프레임 루프에 있고, 정식 화면은 게이지 하나뿐이다', () => {
  // 트리거가 프레임 루프 안에서 «복호보다 먼저» 재는가 (복호 시간 오염 방지).
  assert.match(SCANNER_JS, /steady\.observeFrame\(\{ frame: imageData, timeMs: timestamp \}\)/);
  assert.match(SCANNER_JS, /const usePrior = steadyState\.trigger && !priorInFlight;/);
  assert.match(SCANNER_JS, /steady\.markTriggered\(timestamp\)/);
  // 사전 시도는 그 프레임 슬롯을 «대체» 한다 — 연속 경로와 겹쳐 돌지 않는다.
  assert.match(SCANNER_JS, /usePrior\s*\?\s*attemptGuidePriorScan\(imageData\)\s*:\s*decodeFrame\(imageData\)/);
  // 카메라 수명주기에서 리셋.
  assert.match(SCANNER_JS, /steady\.reset\(\)/);
  assert.match(SCANNER_JS, /requestMotionPermission\(window\)/);
  // 게이트 완화 금지 — 스캐너가 수용 문턱을 넘겨주는 코드가 없어야 한다.
  assert.doesNotMatch(SCANNER_JS, /minimumAgreement/);
  assert.doesNotMatch(SCANNER_JS, /minimumOrientationMargin/);
  assert.doesNotMatch(SCANNER_JS, /minOrientationMargin/);
});

test('배선 — 센서 부착이 **정식 주 경로**(자동 시작)에도 걸려 있다', () => {
  /*
   * 회귀 고정 (2026-08-16 적대 검증 F2): 예전에는 `attachMotionAssist()` 호출처가
   * 시작 버튼 클릭 **한 곳뿐**이었다. 주 동선(카메라 권한 허용된 아이폰 → 자동 시작)은
   * 그 버튼을 거치지 않으므로 센서가 영원히 off 였다. 「어디서 부르는가」 는 상수가
   * 아니라 배선이라 소스로 못박는다.
   */
  // 모든 시작 경로가 지나는 자리(startCamera)에서, **await 이전에** 부른다.
  assert.match(
    SCANNER_JS,
    /async function startCamera\(options\) \{[\s\S]{0,600}?void attachMotionAssist\(\{ userGesture: !automatic \}\)/,
    'startCamera 가 센서 부착을 부르지 않는다 — 자동 시작 경로가 다시 비었다',
  );
  const startCameraSrc = SCANNER_JS.slice(SCANNER_JS.indexOf('async function startCamera(options)'));
  const attachAt = startCameraSrc.indexOf('void attachMotionAssist({ userGesture: !automatic })');
  const awaitAt = startCameraSrc.indexOf('await ');
  assert.ok(attachAt > 0 && awaitAt > attachAt,
    '부착 호출이 startCamera 의 첫 await 뒤에 있으면 iOS 가 제스처를 잃는다');

  // 제스처가 있는 세 경로 — 시작 버튼 · 재스캔 · 렌즈 변경.
  assert.match(SCANNER_JS,
    /startCameraButton\.addEventListener\('click', \(\) => \{\s*\n[^}]*attachMotionAssist\(\{ userGesture: true \}\)/);
  assert.match(SCANNER_JS,
    /rescanButton\.addEventListener\('click', \(\) => \{[\s\S]{0,400}?attachMotionAssist\(\{ userGesture: true \}\)/);
  assert.match(SCANNER_JS,
    /cameraPicker\.addEventListener\('change', \(\) => \{[\s\S]{0,400}?attachMotionAssist\(\{ userGesture: true \}\)/);

  // 제스처 밖에서는 requestPermission 을 부르지 않는다 — 판정이 순수 함수를 거친다.
  assert.match(SCANNER_JS, /motionAttachPlan\(\{ scope: window, userGesture: Boolean\(options\.userGesture\) \}\)/);
  assert.match(SCANNER_JS, /if \(plan\.action === 'defer'\)/);
  assert.match(SCANNER_JS, /armMotionGestureRetry\(\)/);
  // in-flight 가드 — 연타로 리스너가 두 개 붙지 않는다.
  assert.match(SCANNER_JS, /if \(motionRequestInFlight\) return;/);
  // 부착 상태는 오버레이로 정직하게 나간다 (화면이 「켜져 있다」 를 스스로 말하게).
  assert.match(SCANNER_JS, /attach: motionAttachState/);
});

test('lab 게이지는 lab 에서만 — 정식 화면의 추가 UI 는 2px 게이지 하나다', () => {
  const html = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
  assert.match(html, /id="steady-meter"/);
  assert.match(html, /class="steady-meter"[^>]*aria-hidden="true"/);
  // 정식 화면 게이지는 높이 2px — 「미세 인디케이터 이하」 계약.
  assert.match(html, /\.steady-meter \{[^}]*height: 2px/);
  // 게이지는 인라인 width 만 받는다 — 외부 자원·전송 없음.
  assert.match(SCANNER_JS, /steadyMeterFill\.style\.width = \(progress \* 100\)/);
  assert.doesNotMatch(html, /\.steady-meter[^{]*\{[^}]*url\(/);
  // lab 오버레이에 게이지·트리거 상태가 있고, 스캐너가 그 값을 넘긴다.
  assert.match(SCANNER_JS, /steady: \{\s*\n\s*\.\.\.steady\.snapshot\(nowMs\(\)\),/);
  /*
   * holdMs 는 **추적기가 실제로 쓰는 값**이어야 한다 (2026-08-16 F10). 모듈 상수를
   * 넘기면 추적기를 옵션으로 만드는 날 게이지가 조용히 거짓말을 한다.
   */
  assert.match(SCANNER_JS, /holdMs: steady\.holdMs/);
  assert.doesNotMatch(SCANNER_JS, /holdMs: STEADY_HOLD_MS/);
  /*
   * 사전 예산은 **지연 생성**이다 (F11) — 모듈 로드 시 만들면 lab 표시용 숫자 하나
   * 때문에 정식 `/` 에서도 720 포즈를 전량 만든다.
   */
  assert.doesNotMatch(SCANNER_JS, /^const PRIOR_BUDGET = /m);
  assert.match(SCANNER_JS, /function priorBudget\(\) \{/);
});

test('lab 오버레이 steadyLine — 게이지·상한·센서·사전 요약을 한 줄로 낸다', () => {
  const line = steadyLine({
    progress: 0.8,
    heldMs: 1200,
    holdMs: 1500,
    holdSamples: 4,
    delta: 0.008,
    tolerance: 0.02,
    anchorDelta: 0.014,
    anchorTolerance: 0.028,
    stable: true,
    armed: false,
    sensorActive: true,
    motionVetoed: false,
    attach: 'on:no-gate',
  }, { stage: 'coarse', ok: true, poses: 720, admitted: 3, ms: 61 });

  assert.match(line, /^steady \[########··\]/, '게이지 막대가 진행률을 반영하지 않는다');
  // 표본 수를 함께 찍는다 — 「1.5초」 가 표본 몇 장으로 만들어졌는지가 실기기 판단거리다.
  assert.match(line, /1200\/1500ms\(n4\)/);
  // **원값과 상한을 함께** 찍는다 — 실기기에서 톨러런스를 다시 재려면 둘 다 필요하다.
  assert.match(line, /d 0\.008\/0\.02/);
  assert.match(line, /a 0\.014\/0\.028/);
  assert.match(line, /hold/);
  assert.match(line, /sensor:on\(on:no-gate\)/);
  assert.match(line, /prior coarse:OK n720 adm3 61ms/);

  /*
   * 부착 상태 정직 표기 (2026-08-16 F2). 「표본이 오는가」 와 「왜 안 오는가」 는 다른
   * 사실이다 — 정식 주 경로에서 센서가 한 번도 안 붙던 것을 아무도 못 본 이유가
   * 화면이 그 구분을 안 했기 때문이다.
   */
  const iosAuto = steadyLine({ sensorActive: false, attach: 'off:wait-gesture' }, {});
  assert.match(iosAuto, /sensor:off\(off:wait-gesture\)/);
  assert.match(steadyLine({ sensorActive: false, attach: 'off:unsupported' }, {}),
    /sensor:off\(off:unsupported\)/);
  assert.match(steadyLine({ sensorActive: false, attach: 'off:denied' }, {}),
    /sensor:off\(off:denied\)/);

  // 센서 없음 / 거부 / armed 상태가 서로 구분된다.
  const noSensor = steadyLine({ progress: 1, armed: true, sensorActive: false }, {});
  assert.match(noSensor, /ARMED/);
  assert.match(noSensor, /sensor:off/);
  const vetoed = steadyLine({ sensorActive: true, motionVetoed: true }, {});
  assert.match(vetoed, /sensor:VETO/);
  assert.match(vetoed, /move/);
  // 아직 시도 전이면 예산만 알린다.
  assert.match(steadyLine({}, { budget: 720 }), /prior budget 720/);

  /*
   * 회귀 고정 (2026-08-16 발견): 표시 포맷이 **정수의 꼬리 0** 을 먹고 있었다 —
   * `toFixed(0).replace(/\.?0+$/, '')` 가 소수점 없는 문자열에도 걸려서
   * 1200 → '12', 340 → '34', 0 → '' 이 됐다. 기존 프레임 요약 테스트 표본(342.4)에
   * 꼬리 0 이 없어 통과하고 있었고, 실기기 오버레이에서는 340ms 가 «34ms» 로 찍혔다.
   */
  assert.match(steadyLine({ heldMs: 340, holdMs: 1500 }, {}), /340\/1500ms/);
  assert.match(steadyLine({ heldMs: 0, holdMs: 1500 }, {}), /\b0\/1500ms/);
  assert.match(steadyLine({ progress: 0.5, tolerance: 0.02, delta: 0.02 }, {}), /d 0\.02\/0\.02/);
});
