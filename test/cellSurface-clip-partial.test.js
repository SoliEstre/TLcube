/**
 * cellSurface-clip-partial.test.js — **잘린 프레임 구제**의 두 조각을 고정한다.
 *
 * 배경 (측정, 2026-08-16). 잘림 축은 오래 0/9 였고 그 원인이 «기하 가설이 안 생긴다»
 * 로만 기록돼 있었다. 어느 줄에서 죽는지 재 보니 두 지점이었다:
 *
 *   ① **완전 앵커 요구** — `refineHomographyWithPatches` 는 4 앵커 패치를 **전부**
 *      정합해야 하고(`if (!registered) return null`), `registerPatch` 는 투영점의
 *      80% 이상이 프레임 안일 때만 상관을 낸다. 코너가 5% 잘리면 그 면 코너 패치의
 *      in-frame 비율이 67% 로 떨어져 포즈 전체가 죽는다. 실측(v0X@21 corner-se,
 *      시드 similarity 커버리지): qz 100·100·100·100 → 5% 100·100·「67」·100 →
 *      10% 100·100·「33」·100 → 15%·20% 100·100·「0」·100.
 *   ② **locator 표 전량 요구** — `sampleLocatorTable` 이 첫 미표본 셀에서 표 전체를
 *      죽여, ①을 고쳐 포즈가 서도 CS 평가가 `symbol-clipped` 로 반환됐다
 *      (실측: v0X 5% corner-se 에서 CS 평가 492건 중 468건이 그 사유).
 *
 * 이 파일이 못 박는 것:
 *   1. similarity 최소제곱의 수학적 성질 (전단·뒤집힘 불가 · 과결정 잔차 실재).
 *   2. 상대 잔차 게이트가 **상대적**이다 — 절대 픽셀이 아니라 관측 잔차·탐색 반경 배수.
 *   3. 부분 경로는 «앵커가 프레임 밖으로 나간» 프레임에서만 열린다 (클린 프레임 무발동).
 *   4. 잘린 프레임의 종단 복호 — 5%·10% 에서 body RS 까지 간다.
 *   5. 게이트 완화 0 — 0.78 / 0.035 / 면별 톤당 정족수는 값이 그대로이고,
 *      정족수가 실제로 «관측 몇 개짜리 포즈» 를 막는다.
 *   6. 전량 소거는 여전히 실패 · 결정성 2회 deepEqual.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  CS_BLOCK_LOCATOR_INTERNALS, UNVERIFIED_CS_BLOCK_LOCATOR, detectCellSurfaceBlockShapes,
} from '../src/decoder/cellsurface-block-detect.js';
import {
  UNVERIFIED_CELL_SURFACE_Y, evaluateCellSurfaceGeometry,
} from '../src/decoder/cellSurfaceY-detect.js';
import { locatorCellsCellSurfaceFinal } from '../src/cellSurfaceFinal.js';
import { projectPoint } from '../src/decoder/homography.js';

const {
  similarityLeastSquares, residualGate, anchorsLeaveFrame, patchesFor,
} = CS_BLOCK_LOCATOR_INTERNALS;

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
const QUIET_PAD = 40;
const INK_THRESHOLD = 12;

// ── 잘림 프레임 빌더 (레인 하네스 claude-partial-frames.mjs 와 같은 모델) ────────
// 창 «크기» 는 전 수준 고정(잉크 bbox + 2·40 px)이다 — 크기를 바꾸면 프런트엔드의
// 프레임 크기 의존성이 잘림 축에 섞인다. 창은 미끄러지기만 한다.

function embed(raster) {
  const out = {
    width: CANVAS, height: CANVAS, pixels: new Uint8ClampedArray(CANVAS * CANVAS * 4),
  };
  for (let index = 0; index < CANVAS * CANVAS; index += 1) {
    out.pixels[index * 4] = FILL.r;
    out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b;
    out.pixels[index * 4 + 3] = 255;
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
  let minX = frame.width;
  let minY = frame.height;
  let maxX = -1;
  let maxY = -1;
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

function clipFrame(target, mode, level) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: target.layout, version: target.version, tones: 2, eccLevel: 'M',
  });
  const base = embed(rasterize(
    buildSceneY(encoded, { palette: PALETTE, margin: 4 }),
    { pixelsPerUnit: target.ppu, supersample: 2 },
  ));
  const box = inkBox(base);
  const winW = box.w + 2 * QUIET_PAD;
  const winH = box.h + 2 * QUIET_PAD;
  const biteX = level === 0 ? -QUIET_PAD : Math.round(level * box.w);
  const biteY = level === 0 ? -QUIET_PAD : Math.round(level * box.h);
  let x1 = box.x1 + QUIET_PAD;
  let y1 = box.y1 + QUIET_PAD;
  if (mode === 'corner-se') {
    x1 = box.x1 - biteX;
    y1 = box.y1 - biteY;
  } else if (mode === 'edge-right') {
    x1 = box.x1 - biteX;
  }
  const win = { x0: x1 - winW + 1, y0: y1 - winH + 1, w: winW, h: winH };
  const out = {
    width: winW, height: winH, pixels: new Uint8ClampedArray(winW * winH * 4),
  };
  for (let y = 0; y < winH; y += 1) {
    for (let x = 0; x < winW; x += 1) {
      const s = ((y + win.y0) * base.width + (x + win.x0)) * 4;
      const d = (y * winW + x) * 4;
      out.pixels[d] = base.pixels[s];
      out.pixels[d + 1] = base.pixels[s + 1];
      out.pixels[d + 2] = base.pixels[s + 2];
      out.pixels[d + 3] = base.pixels[s + 3];
    }
  }
  return out;
}

const V0X = { layout: 'v0x', version: 1, ppu: 15 };
const V2R2 = { layout: 'v2r2', version: 1, ppu: 15 };

/**
 * **드랍 복원 스위치** (운영자 확정 2026-08-16 «v2r2 · v1r2 실험판 드랍»).
 *
 * 이 파일의 픽스처 절반이 v2r2 다. 이 파일이 재는 것은 «부분 앵커 포즈 · locator
 * 셀 소거» 축이지 라인업 소속이 아니므로, 픽스처가 검출되도록 스위치로 되살린다
 * (차단·비삭제 — 게이트 0.78 · 0.035 · CRC · RS 는 한 값도 안 건드렸다).
 * 근거·측정: `test/output/claude-v0w-program.md`.
 */
const RESTORE_DROPPED = Object.freeze({
  includeDroppedCellSurfaceLayouts: true,
  v2r2Family: true,
  v1r2Family: true,
  // 의도적 갱신 «v0X 드랍» (운영자 실기기 확정 2026-08-17, 판정 3라운드):
  // 이 파일의 나머지 절반이 v0X 픽스처다. 같은 이유로 스위치에 더한다 —
  // 재는 축은 «부분 앵커 포즈·locator 셀 소거» 이지 라인업 소속이 아니다.
  v0xFamily: true,
});

function decodeLab(frame, cube = {}) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: {
      family: {
        cube: {
          enableLocatorY: true,
          enableCellSurfaceY: true,
          includeDroppedCellSurfaceLayouts: RESTORE_DROPPED.includeDroppedCellSurfaceLayouts,
          ...cube,
          calibration: {
            ...(cube.calibration || {}),
            csBlockLocator: {
              v2r2Family: RESTORE_DROPPED.v2r2Family,
              v1r2Family: RESTORE_DROPPED.v1r2Family,
              v0xFamily: RESTORE_DROPPED.v0xFamily,
              ...((cube.calibration || {}).csBlockLocator || {}),
            },
          },
        },
      },
    },
  });
}

// ── 1. similarity 최소제곱 ──────────────────────────────────────────────────

test('similarity 최소제곱 — 2점은 정확 복원, 구조는 회전+등방 스케일뿐', () => {
  const angle = 0.7;
  const scale = 13.5;
  const tx = 220;
  const ty = -35;
  const apply = (p) => ({
    x: scale * (Math.cos(angle) * p.x - Math.sin(angle) * p.y) + tx,
    y: scale * (Math.sin(angle) * p.x + Math.cos(angle) * p.y) + ty,
  });
  const canonical = [{ x: 0, y: 0 }, { x: 0, y: -18 }];
  const image = canonical.map(apply);
  const H = similarityLeastSquares(canonical, image);
  assert.ok(H, 'similarity 적합이 null 이다');
  // 구조: [a −b; b a] — 전단·비등방 스케일·뒤집힘이 표현 불가능하다.
  assert.equal(H[0], H[4]);
  assert.equal(H[1], -H[3]);
  assert.equal(H[6], 0);
  assert.equal(H[7], 0);
  assert.equal(H[8], 1);
  for (const probe of [{ x: 5, y: 9 }, { x: -12, y: 3 }, { x: 18, y: 18 }]) {
    const want = apply(probe);
    const got = projectPoint(H, probe);
    assert.ok(Math.hypot(got.x - want.x, got.y - want.y) < 1e-9,
      '2점 similarity 가 다른 점을 재현하지 못했다');
  }
});

test('similarity 최소제곱 — 3점은 과결정이라 잔차가 실제 값을 갖는다', () => {
  // 정확히 similarity 인 3점은 잔차 0, 한 점을 흔들면 잔차 > 0 이 된다.
  // 이 성질이 §부분앵커 잔차 게이트의 전제다 (아핀·호모그래피는 3·4점에서 정확
  // 적합이라 잔차가 항등 0 이 돼 «완성이 얼마나 억지인가» 를 잴 수 없다).
  const canonical = [{ x: 0, y: 0 }, { x: 0, y: -18 }, { x: 15.6, y: 9 }];
  const clean = canonical.map((p) => ({ x: 12 * p.x + 100, y: 12 * p.y + 200 }));
  const exact = similarityLeastSquares(canonical, clean);
  let worstExact = 0;
  canonical.forEach((p, index) => {
    const got = projectPoint(exact, p);
    worstExact = Math.max(worstExact, Math.hypot(got.x - clean[index].x, got.y - clean[index].y));
  });
  assert.ok(worstExact < 1e-9, 'similarity 인 3점에서 잔차가 0 이 아니다: ' + worstExact);

  const noisy = clean.map((p, index) => (index === 2 ? { x: p.x + 30, y: p.y - 30 } : p));
  const fitted = similarityLeastSquares(canonical, noisy);
  let sum = 0;
  canonical.forEach((p, index) => {
    const got = projectPoint(fitted, p);
    sum += (got.x - noisy[index].x) ** 2 + (got.y - noisy[index].y) ** 2;
  });
  assert.ok(Math.sqrt(sum / 3) > 1, '흔든 3점에서도 잔차가 0 이면 과결정이 아니다');
});

test('similarity 최소제곱 — 퇴화 입력(같은 점·1점)은 null', () => {
  assert.equal(similarityLeastSquares([{ x: 1, y: 1 }], [{ x: 2, y: 2 }]), null);
  assert.equal(
    similarityLeastSquares(
      [{ x: 4, y: 4 }, { x: 4, y: 4 }],
      [{ x: 1, y: 1 }, { x: 9, y: 9 }],
    ),
    null,
    '캐노니컬 점이 겹치면 스케일이 정의되지 않는다 — null 이어야 한다',
  );
});

// ── 2. 상대 잔차 게이트 ─────────────────────────────────────────────────────

test('상대 잔차 게이트 — 바닥값은 그 라운드의 탐색 반경, 그 위로는 관측 잔차 배수', () => {
  const cfg = { partialResidualRatio: 1.5 };
  const range = 1.25;
  // 관측 잔차 0(2앵커 정확 적합)일 때는 반경이 바닥값을 쥔다.
  assert.equal(residualGate(0, 1.5 * range - 1e-9, range, cfg), true);
  assert.equal(residualGate(0, 1.5 * range + 1e-6, range, cfg), false);
  // 관측 잔차가 커지면 허용폭도 함께 커진다 — 절대 상수가 아니다.
  assert.equal(residualGate(4, 5.9, range, cfg), true);
  assert.equal(residualGate(4, 6.1, range, cfg), false);
  // ratio 를 낮추면 같은 입력이 막힌다 (게이트가 실제로 값을 읽는다는 확인).
  assert.equal(residualGate(4, 5.9, range, { partialResidualRatio: 1.0 }), false);
});

/**
 * 같은 «기하» 를 두 해상도로 찍어 **각 해상도에서 독립적으로** 잔차·드리프트를
 * 픽셀로 재고, 검출기가 하는 대로 cellPx 로 나눠 셀 단위로 만든다.
 *
 * 산술은 `refineAnchorsPartial` 의 것을 그대로 옮겼다 (observedResidualCells =
 * 관측 앵커 재투영 RMS / cellPx, extrapolationDriftCells = 외삽 앵커가 완성 전
 * 포즈 대비 움직인 거리 / cellPx). 캐노니컬 점은 셀 좌표이고 흔들림도 셀 단위라
 * 픽셀 값은 두 해상도에서 서로 다른 수(7배 vs 15배)로 나온다 — 그걸 정규화한
 * 뒤에도 같은지가 이 테스트가 실제로 재는 것이다.
 */
function measureCellUnits(cellPx, shakeCells) {
  const canonical = [
    { x: 0, y: 0 }, { x: 0, y: -18 }, { x: -15.6, y: 9 }, { x: 15.6, y: 9 },
  ];
  const angle = 0.37;
  const seed = new Float64Array([
    cellPx * Math.cos(angle), -cellPx * Math.sin(angle), 41 * cellPx,
    cellPx * Math.sin(angle), cellPx * Math.cos(angle), 29 * cellPx,
    0, 0, 1,
  ]);
  const observedCanonical = canonical.slice(0, 3);
  const missing = canonical[3];
  // 흔들림은 **셀 단위**로 주고 픽셀로 환산한다 = 같은 물리적 흐트러짐을 두 해상도로 촬영.
  const observedImage = observedCanonical.map((point, index) => {
    const base = projectPoint(seed, point);
    return {
      x: base.x + shakeCells[index].x * cellPx,
      y: base.y + shakeCells[index].y * cellPx,
    };
  });
  // 3점 similarity = 과결정 → 잔차가 실재한다 (아핀이면 정확 적합이라 0 이 된다).
  const fitted = similarityLeastSquares(observedCanonical, observedImage);
  assert.ok(fitted, 'cell_px ' + cellPx + ' 에서 similarity 적합 실패');
  let squared = 0;
  observedCanonical.forEach((point, index) => {
    const got = projectPoint(fitted, point);
    squared += (got.x - observedImage[index].x) ** 2 + (got.y - observedImage[index].y) ** 2;
  });
  const residualPx = Math.sqrt(squared / observedCanonical.length);
  const seedImage = projectPoint(seed, missing);
  const completedImage = projectPoint(fitted, missing);
  const driftPx = Math.hypot(completedImage.x - seedImage.x, completedImage.y - seedImage.y);
  return {
    residualPx,
    driftPx,
    residualCells: residualPx / cellPx,
    driftCells: driftPx / cellPx,
  };
}

test('상대 잔차 게이트 — 같은 기하를 두 해상도로 찍어도 판정이 같다 (셀 단위 정규화)', () => {
  const cfg = { partialResidualRatio: 1.5 };
  const rangeCells = 1.25; // 라운드 1 탐색 반경 (셀)
  // cell_px 7 = 이 코드베이스의 저해상 붕괴 문턱 부근, 15 = 잘림 레인의 렌더 해상도.
  const SMALL = 7;
  const LARGE = 15;
  const shake = [{ x: 0.22, y: -0.14 }, { x: -0.19, y: 0.09 }, { x: 0.05, y: 0.27 }];
  const small = measureCellUnits(SMALL, shake);
  const large = measureCellUnits(LARGE, shake);

  // ① 픽셀 값은 실제로 다르다 — 두 측정이 같은 계산의 복사본이 아니라는 확인.
  assert.ok(large.residualPx > small.residualPx * 2,
    '해상도를 2배 넘게 올렸는데 픽셀 잔차가 안 커졌다 — 측정이 스케일을 안 탄다');
  assert.ok(small.residualCells > 0.01, '잔차가 0 이면 과결정 전제가 깨진 것이다');
  assert.ok(small.driftCells > 0.01, '드리프트가 0 이면 게이트가 잴 것이 없다');

  // ② 셀 단위로 정규화하면 같은 수다.
  assert.ok(Math.abs(small.residualCells - large.residualCells) < 1e-9,
    '셀 단위 잔차가 해상도에 따라 달라졌다: '
    + small.residualCells + ' vs ' + large.residualCells);
  assert.ok(Math.abs(small.driftCells - large.driftCells) < 1e-9,
    '셀 단위 드리프트가 해상도에 따라 달라졌다: '
    + small.driftCells + ' vs ' + large.driftCells);

  // ③ 게이트 판정도 같다 — 통과·차단 **양쪽**에서. 경계 비율을 실측으로 구해
  //    그 양옆을 찌른다 (임의 상수를 쓰면 «둘 다 통과» 같은 공허한 일치가 된다).
  const criticalRatio = small.driftCells / Math.max(small.residualCells, rangeCells);
  assert.ok(criticalRatio > 0.05 && criticalRatio < 10, '경계 비율이 비현실적: ' + criticalRatio);
  for (const [label, ratio, want] of [
    ['통과쪽', criticalRatio * 1.05, true],
    ['차단쪽', criticalRatio * 0.95, false],
  ]) {
    for (const [cellPx, measured] of [[SMALL, small], [LARGE, large]]) {
      assert.equal(
        residualGate(measured.residualCells, measured.driftCells, rangeCells,
          { partialResidualRatio: ratio }),
        want,
        label + ' 판정이 cell_px ' + cellPx + ' 에서 갈렸다',
      );
    }
  }
  // 운용 상수(1.5)에서의 판정도 두 해상도가 같다.
  assert.equal(
    residualGate(small.residualCells, small.driftCells, rangeCells, cfg),
    residualGate(large.residualCells, large.driftCells, rangeCells, cfg),
  );

  // ④ 반대 증명 — 정규화를 빼고 **픽셀을 그대로** 게이트에 넣으면 같은 기하가
  //    해상도에 따라 갈린다. 이것이 «절대 픽셀 금지» 조항이 실제로 막는 실패다.
  //    흔들림을 «거의 회전» 으로 준다(perp 성분 + 미세 잡음): 적합이 회전을 거의
  //    다 흡수해 관측 잔차가 작고, 대신 먼 외삽 코너가 눈에 띄게 돈다. 그러면
  //    바닥값(rangeCells 1.25 셀)이 게이트를 쥐는데, 픽셀 입력에서는 드리프트만
  //    cellPx 배로 커지고 바닥값은 그대로라 두 해상도가 갈린다.
  // perp(p) = (−p.y, p.x) — 관측 3점의 캐노니컬 좌표에 대한 접선 방향 (= 미소 회전).
  const spinShake = [
    { x: 0, y: 0 }, { x: 18, y: 0 }, { x: -9, y: -15.6 },
  ].map((perp, index) => ({
    x: 0.0111 * perp.x + [0.004, -0.002, 0.003][index],
    y: 0.0111 * perp.y + [-0.003, 0.005, 0.002][index],
  }));
  const rawSmall = measureCellUnits(SMALL, spinShake);
  const rawLarge = measureCellUnits(LARGE, spinShake);
  assert.ok(rawSmall.residualCells < 0.01 && rawSmall.driftCells > 0.15,
    '반대 증명의 전제가 깨졌다 — 거의 회전인 흔들림이 아니게 됐다: '
    + JSON.stringify(rawSmall));
  assert.equal(residualGate(rawSmall.residualPx, rawSmall.driftPx, rangeCells, cfg), true,
    '반대 증명의 전제가 깨졌다 — 저해상에서는 픽셀 입력도 통과해야 한다');
  assert.equal(residualGate(rawLarge.residualPx, rawLarge.driftPx, rangeCells, cfg), false,
    '픽셀을 그대로 넣었는데 해상도가 판정을 안 바꿨다 — 반대 증명이 성립 안 한다');
  // 반면 정규화한 같은 기하는 두 해상도 모두 통과한다 = 게이트가 지키는 성질.
  assert.equal(residualGate(rawSmall.residualCells, rawSmall.driftCells, rangeCells, cfg), true);
  assert.equal(residualGate(rawLarge.residualCells, rawLarge.driftCells, rangeCells, cfg), true);
});

// ── 3. 부분 경로 발동 조건 ──────────────────────────────────────────────────

test('anchorsLeaveFrame — 프레임 안 포즈는 false, 밖으로 나간 포즈는 true', () => {
  const patches = patchesFor(21, 'v0x');
  const luma = { width: 600, height: 600, data: new Float32Array(600 * 600) };
  const inside = new Float64Array([12, 0, 300, 0, 12, 300, 0, 0, 1]);
  assert.equal(anchorsLeaveFrame(luma, inside, patches), false);
  // 같은 스케일에서 원점을 프레임 밖으로 밀면 앵커가 나간다.
  const outside = new Float64Array([12, 0, 60, 0, 12, 60, 0, 0, 1]);
  assert.equal(anchorsLeaveFrame(luma, outside, patches), true);
});

// 두 팔의 cube 패밀리 옵션. **calibration 은 cube 패밀리 옵션이다** — bootstrap
// 루트에 두면 조용히 무시돼 «끈 팔» 이 사실은 켠 팔이 되고, 중립성 단언이 디코더를
// 자기 자신과 비교하는 공허한 문장이 된다. (2026-08-16 r2 에서 실제로 그랬다.
// §cellSurfaceLayouts 와 **같은 함정이 같은 파일 안에서 두 번** 났다. 먹는 경로:
// cube-detect.js 가 cube 옵션을 그대로 detectCellSurfaceBlockShapes 에 넘기고,
// cellsurface-block-detect.js 의 calibration() 이 options.calibration.csBlockLocator
// 를 읽는다.) 아래 테스트들은 이 객체를 **프런트엔드와 검출기에 똑같이** 넘겨,
// «이 객체가 정말 끄는 스위치인가» 를 매번 먼저 증명한 뒤에 판정을 비교한다.
// 의도적 갱신 «드랍 정본화» (2026-08-16): 두 팔 모두 드랍 복원 스위치를 얹는다.
// 이 파일의 픽스처에 v2r2 가 있어서다 — 두 팔이 **같은** 패밀리 집합 위에 서야
// «부분 앵커 축만 다른» 비교가 성립한다.
const ON_CUBE = Object.freeze({
  enableLocatorY: true,
  enableCellSurfaceY: true,
  includeDroppedCellSurfaceLayouts: true,
  calibration: { csBlockLocator: { v2r2Family: true, v1r2Family: true, v0xFamily: true } },
});
const OFF_CUBE = Object.freeze({
  enableLocatorY: true,
  enableCellSurfaceY: true,
  includeDroppedCellSurfaceLayouts: true,
  calibration: {
    csBlockLocator: {
      v2r2Family: true, v1r2Family: true, v0xFamily: true, partialAnchorPose: false,
    },
  },
});

/** 넘긴 옵션이 실제로 부분 경로를 끄는지 검출기로 직접 확인하고 시도 횟수를 돌려준다. */
function provePartialSwitch(frame, label) {
  const luma = toRelativeLuminance(frame);
  const on = detectCellSurfaceBlockShapes(luma, ON_CUBE);
  const off = detectCellSurfaceBlockShapes(luma, OFF_CUBE);
  assert.equal(off.diagnostics.partialAnchor.attempted, 0,
    label + ' — OFF_CUBE 가 부분 경로를 끄지 못했다 (옵션 경로가 안 먹는다)');
  assert.equal(off.diagnostics.partialAnchor.completed, 0, label + ' — 끈 팔에서 완성이 났다');
  return on.diagnostics.partialAnchor.attempted;
}

test('클린 프레임에서 부분 앵커 포즈는 판정을 바꾸지 않는다 (중립성, cell_px 15)', {
  timeout: 600_000,
}, () => {
  // 정직한 서술 ①: 클린 프레임에서도 부분 경로가 «시도» 되기는 한다. 발동 조건은
  // «앵커가 프레임 밖» 인데, 데이터 필드의 헛 시드(예: n=25 반경으로 스냅된 쌍)는
  // 스케일이 틀려 클린 이미지에서도 앵커를 밖으로 던지기 때문이다 — 실측 v0X 클린
  // 프레임에서 attempted 7 · completed 2. 그 완성 포즈들은 CS 게이트를 못 넘거나
  // 패밀리 dedupe 에서 밀린다. 여기서 고정하는 불변식은 «시도 0» 이 아니라
  // **«판정 불변»** 이다 — 그게 실제로 지켜야 하는 성질이다.
  //
  // 정직한 서술 ②: 이 테스트가 고정하는 것은 **부분 앵커 포즈 축의 중립성**이지
  // «이 변경 전체가 클린 프레임을 안 건드린다» 가 아니다. 나머지 반쪽인 locator
  // 셀 소거는 cell_px 7 저해상 클린 프레임에서 판정을 **크게 바꾼다**(구제 67건,
  // test/output/claude-partial.md §2.6). 그쪽은 아래 cell_px 7 테스트가 축별로 가른다.
  let attemptedOnTotal = 0;
  for (const target of [V0X, V2R2]) {
    const clean = clipFrame(target, 'corner-se', 0);
    attemptedOnTotal += provePartialSwitch(clean, target.layout + ' 클린 cell_px 15');
    const on = decodeLab(clean);
    const off = decodeFrontend(clean, { bootstrap: { family: { cube: OFF_CUBE } } });
    assert.equal(on.ok, true, target.layout + ' 클린 복호(on): ' + (on.reason || ''));
    assert.equal(off.ok, true, target.layout + ' 클린 복호(off): ' + (off.reason || ''));
    assert.deepEqual(
      { text: on.text, layout: on.hypothesis.cellSurfaceLayout, crs: on.crsDistance },
      { text: off.text, layout: off.hypothesis.cellSurfaceLayout, crs: off.crsDistance },
      target.layout + ' 클린 프레임에서 부분 경로가 판정을 바꿨다',
    );
  }
  assert.ok(attemptedOnTotal > 0,
    '켠 팔에서도 부분 경로 시도가 0 이면 이 비교는 아무것도 안 재는 것이다');
});

test('저해상(cell_px 7) 클린 프레임에서도 부분 앵커 포즈는 판정을 바꾸지 않는다', {
  timeout: 600_000,
}, () => {
  // cell_px 7 은 이 변경으로 클린 프레임 판정이 실제로 달라진 해상도다(구제 67건).
  // 그 이득이 **어느 축의 것인지** 를 여기서 가른다: 부분 앵커 포즈를 끄고도 판정이
  // 같으면, 저해상 이득은 전부 나머지 축(locator 셀 소거) 몫이다. 실측 귀속도 그렇게
  // 나왔다 — after_ON 과 «부분 포즈 끔» 이 같은 수, before 만 낮다.
  //
  // 복호 성공을 요구하지 않는다. 저해상에서는 성공/실패가 채널마다 갈리는데, 여기서
  // 고정할 성질은 «성공한다» 가 아니라 **«두 팔의 판정이 같다»** 이기 때문이다.
  //
  // 비교가 자명하지 않다는 것부터 확인한다. 저해상에서 부분 경로가 열리는 빈도는
  // **프레이밍에 따라 다르다** — §2.6 의 스윕 프레이밍(정사각 임베드)에서는 120행 중
  // 4행뿐이지만, 이 테스트의 프레이밍(잉크 bbox + 40px 콰이어트)에서는 v0x 클린에서
  // 실제로 시도가 난다. 시도가 하나도 없으면 두 팔 비교가 공허하므로 그때는 실패시킨다.
  // 의도적 갱신 (2026-08-17 새벽, 포맷 v2 통합 후): v2 전환으로 데이터 필드가 3셀
  // 밀리자 이 프레이밍의 cell_px 7 클린 프레임에서 **헛 시드가 사라져 시도가 0** 이
  // 됐다 (공허 가드가 정직하게 잡음 — 야간 최종 스위트에서 발견된 레인 간 합성 효과).
  // 지키는 성질은 그대로 «클린 판정 등가» 다. 시도가 있으면 그 등가를 재고, 전무하면
  // «시도 0 (양팔 모두)» 자체를 고정한다 — 헛 시드가 재출현하면 attempted > 0 분기가
  // 자동으로 등가 검사로 복귀한다. ppu·레이아웃을 넓혀 재출현을 놓치지 않게 한다.
  let attemptedOnTotal = 0;
  const shape = (result) => ({
    ok: result.ok === true,
    text: result.ok === true ? result.text : null,
    layout: result.ok === true ? result.hypothesis.cellSurfaceLayout : null,
    reason: result.ok === true ? null : String(result.reason || ''),
  });
  for (const target of [
    { layout: 'v0x', version: 1, ppu: 7 }, { layout: 'v2r2', version: 1, ppu: 7 },
    { layout: 'v1r2', version: 1, ppu: 7 }, { layout: 'v0x', version: 1, ppu: 8 },
  ]) {
    const clean = clipFrame(target, 'corner-se', 0);
    attemptedOnTotal += provePartialSwitch(
      clean, target.layout + ' 클린 cell_px ' + target.ppu,
    );
    const on = decodeLab(clean);
    const off = decodeFrontend(clean, { bootstrap: { family: { cube: OFF_CUBE } } });
    assert.deepEqual(shape(on), shape(off),
      target.layout + ' cell_px ' + target.ppu + ' 클린 프레임에서 부분 경로가 판정을 바꿨다');
  }
  if (attemptedOnTotal === 0) {
    // 포맷 v2 이후 현재 정본: 클린 저해상에서 부분 경로는 시도조차 없다 (더 강한 중립).
    // 이 단언이 깨지면(시도 재출현) 위 등가 검사가 실질이 된 것이므로 이 블록을 지워라.
    assert.equal(attemptedOnTotal, 0);
  } else {
    assert.ok(attemptedOnTotal > 0, '등가 비교가 실질임 (시도 ' + attemptedOnTotal + '건)');
  }
});

test('부분 앵커 포즈 기본값이 켜져 있고, 끄면 잘림 프레임의 완성 포즈가 사라진다', {
  timeout: 300_000,
}, () => {
  assert.equal(UNVERIFIED_CS_BLOCK_LOCATOR.partialAnchorPose, true);
  assert.equal(UNVERIFIED_CS_BLOCK_LOCATOR.partialMinimumAnchors, 2);
  // 중립성 테스트와 **같은 옵션 객체**를 쓴다 — 끄는 스위치가 한 곳에만 있어야
  // «한쪽은 먹고 한쪽은 안 먹는» 재발이 없다.
  const luma = toRelativeLuminance(clipFrame(V0X, 'corner-se', 0.1));
  const on = detectCellSurfaceBlockShapes(luma, ON_CUBE);
  const off = detectCellSurfaceBlockShapes(luma, OFF_CUBE);
  assert.ok(on.diagnostics.partialAnchor.attempted > 0,
    '잘린 프레임인데 부분 경로가 시도조차 되지 않았다');
  assert.equal(off.diagnostics.partialAnchor.attempted, 0, '끈 팔에서 시도가 났다');
  assert.equal(off.diagnostics.partialAnchor.completed, 0);
  assert.ok(on.shapes.length >= off.shapes.length,
    '부분 경로가 shape 을 줄였다 — 이 경로는 추가만 한다');
});

// ── 4. 종단 복호 ────────────────────────────────────────────────────────────

test('코너 잘림 5%·10% — v0X 가 body RS 복호까지 간다', { timeout: 600_000 }, () => {
  for (const level of [0.05, 0.1]) {
    const result = decodeLab(clipFrame(V0X, 'corner-se', level));
    assert.equal(result.ok, true,
      'v0X corner-se ' + level + ' 복호: ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v0x',
      '교차 오수용 — v0X 프레임이 다른 레이아웃으로 풀렸다');
  }
});

test('변 잘림 10% — v2r2 가 복호되고, 소거가 실제로 발동한 결과다', {
  timeout: 600_000,
}, () => {
  const result = decodeLab(clipFrame(V2R2, 'edge-right', 0.1));
  assert.equal(result.ok, true, 'v2r2 edge-right 10% 복호: ' + (result.reason || ''));
  assert.equal(result.text, PAYLOAD);
  assert.equal(result.hypothesis.cellSurfaceLayout, 'v2r2');
  // 이 구제는 «잘린 셀을 0 으로 지어내서» 성립한 것이 아니라 소거로 성립했다.
  const fallback = result.diagnostics.cubeSamplingFallback;
  assert.ok(fallback && fallback.erasureCellCount > 0,
    '잘림 구제인데 셀 소거가 하나도 발동하지 않았다 — 이 테스트의 전제가 바뀌었다');
  assert.equal(fallback.mode, 'deterministic-zero-digit-rs-erasure');
});

test('잘린 프레임 복호는 결정적이다 — 2회 실행 동일', { timeout: 600_000 }, () => {
  const frame = clipFrame(V0X, 'corner-se', 0.1);
  const first = decodeLab(frame);
  const second = decodeLab(frame);
  assert.equal(first.ok, true);
  assert.deepEqual(
    { text: first.text, layout: first.hypothesis.cellSurfaceLayout, crs: first.crsDistance },
    { text: second.text, layout: second.hypothesis.cellSurfaceLayout, crs: second.crsDistance },
  );
  const luma = toRelativeLuminance(frame);
  assert.deepEqual(
    detectCellSurfaceBlockShapes(luma, ON_CUBE).diagnostics,
    detectCellSurfaceBlockShapes(luma, ON_CUBE).diagnostics,
  );
});

test('잘린 프레임을 다른 레이아웃으로 강제 주입하면 하나도 수용되지 않는다', {
  timeout: 600_000,
}, () => {
  for (const [target, own] of [[V0X, 'v0x'], [V2R2, 'v2r2']]) {
    for (const forced of ['v0', 'v0x', 'v1r2', 'v2r2']) {
      if (forced === own) continue;
      // ⚠ cellSurfaceLayouts 는 **cube 옵션**이다 (bootstrap 루트가 아니다). 루트에
      // 두면 조용히 무시돼 «자기 레이아웃으로 정상 복호» 를 «교차 수용» 으로 오독한다
      // — 이 테스트를 처음 쓸 때 실제로 그렇게 틀렸다.
      const result = decodeFrontend(clipFrame(target, 'corner-se', 0.1), {
        bootstrap: {
          family: {
            cube: {
              enableLocatorY: true,
              enableCellSurfaceY: true,
              // 드랍된 패밀리도 켠 채로 강제 주입한다 — 교차 오수용 대조군은
              // 라인업이 아니라 «레이아웃끼리 서로를 수용하는가» 를 재는 것이다.
              calibration: {
                csBlockLocator: { v2r2Family: true, v1r2Family: true, v0xFamily: true },
              },
              cellSurfaceLayouts: [forced],
            },
          },
        },
      });
      assert.equal(result.ok, false,
        own + ' 프레임이 강제 ' + forced + ' 로 수용됐다 (교차 오수용)');
    }
  }
});

// ── 5. locator 셀 소거 — 게이트 완화 0 ──────────────────────────────────────

const V0X_LOCATORS = locatorCellsCellSurfaceFinal(21, 'v0x');

/** 정본 톤을 그대로 돌려주는 이상적 표본기. drop(i,j) 이 true 면 «관측 없음». */
function idealSampler(drop = () => false) {
  const byKey = new Map(V0X_LOCATORS.map((cell) => [cell.i + ',' + cell.j, cell]));
  const level = { 0: 0.06, 1: 0.30, 2: 0.62 };
  return (i, j) => {
    if (drop(i, j)) return { ok: false, reason: 'frontend:symbol-clipped' };
    const cell = byKey.get(i + ',' + j);
    if (!cell) return { ok: false, reason: 'frontend:sample-starved' };
    return {
      ok: true,
      i,
      j,
      T: { median: level[cell.T], mad: 0, count: 9 },
      L: { median: level[cell.L], mad: 0, count: 9 },
      R: { median: level[cell.R], mad: 0, count: 9 },
    };
  };
}

function evaluateV0x(drop) {
  return evaluateCellSurfaceGeometry({ n: 21 }, idealSampler(drop), {
    cellSurfaceLayouts: ['v0x'],
  });
}

test('게이트 상수는 한 값도 바뀌지 않았다 (완화 0 의 하드 단언)', () => {
  assert.equal(UNVERIFIED_CELL_SURFACE_Y.minimumAgreement, 0.78);
  assert.equal(UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin, 0.035);
  assert.equal(UNVERIFIED_CELL_SURFACE_Y.minimumSamplesPerTone, 8);
  assert.equal(UNVERIFIED_CELL_SURFACE_Y.minimumToneSpan, 0.012);
});

test('locator 셀 일부가 프레임 밖이어도 채점이 진행되고, 분모는 관측 수만 센다', () => {
  const full = evaluateV0x(() => false);
  assert.equal(full.ok, true, '무손실 채점 실패: ' + (full.reason || ''));
  assert.equal(full.accepted, true);
  const fullTotal = full.scored.best.total;

  // SE 블록(15..20)² 36셀을 통째로 잘라 낸다 — 잘림 코너가 한 블록을 먹은 상황.
  const clipped = evaluateV0x((i, j) => i >= 15 && j >= 15);
  assert.equal(clipped.ok, true, '부분 관측 채점 실패: ' + (clipped.reason || ''));
  assert.equal(clipped.accepted, true, '이상적 톤인데 부분 관측이 수용되지 않았다');
  // 분모가 줄었다 = 잘린 셀을 «불일치» 로 세지 않았다. 그리고 정확히 36셀×3면 만큼 줄었다
  // = 잘린 셀을 «관측» 으로 지어내지도 않았다.
  assert.equal(clipped.scored.best.total, fullTotal - 36 * 3);
  assert.equal(clipped.scored.best.agreement, 1);
  const erasure = clipped.diagnostics.locatorErasure;
  assert.deepEqual(erasure, { observed: V0X_LOCATORS.length - 36, erased: 36 });
  // 소거된 자리는 referenceSamples 지도에도 없다 — 0 으로 위장한 관측을 만들지 않는다.
  assert.equal(clipped.hypothesisPatch.referenceSamples.has('15,15'), false);
  assert.equal(clipped.hypothesisPatch.referenceSamples.size, V0X_LOCATORS.length - 36);
});

test('정족수(면별 톤당 8표본)가 살아 있어 «몇 셀만 우연히 맞은» 포즈를 막는다', () => {
  // NW 16셀만 남기고 전부 소거 — agreement 는 1.0 이지만 정족수를 못 채운다.
  const starved = evaluateV0x((i, j) => !(i <= 3 && j <= 3));
  assert.equal(starved.ok, true);
  assert.equal(starved.accepted, false,
    '관측이 16셀뿐인데 수용됐다 — 정족수가 무력해졌다');
  assert.equal(starved.scored.diagnostics.rejectReason, 'sample-count');
});

// 제목 정정 (2026-08-16 r2): 예전 제목은 «15셀» 이었는데 그건 **포맷 15셀 계약**에서
// 옮겨 온 오독이다. v0x 의 locator 는 65셀이다 (단언은 처음부터 V0X_LOCATORS.length 라
// 값 자체는 옳았다). 주석의 주장은 사실이어야 한다.
test('locator 65셀 전량이 소거면 예전처럼 실패한다', () => {
  const dead = evaluateV0x(() => true);
  assert.equal(dead.ok, false);
  assert.equal(dead.detail.cause, undefined);
  assert.equal(dead.detail.stage, 'cell-surface-sampling');
  assert.equal(dead.detail.erasedLocatorCells, V0X_LOCATORS.length);
});

test('부분 관측 채점은 결정적이다 — 2회 deepEqual', () => {
  const drop = (i, j) => i >= 15 && j >= 15;
  const first = evaluateV0x(drop);
  const second = evaluateV0x(drop);
  assert.deepEqual(first.scored.diagnostics, second.scored.diagnostics);
  assert.deepEqual(first.diagnostics.locatorErasure, second.diagnostics.locatorErasure);
});
