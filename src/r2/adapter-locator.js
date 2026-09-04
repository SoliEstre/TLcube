/**
 * adapter-locator.js — R2 정합(A3) 어댑터. **양쪽을 아는 유일한 파일.**
 *
 * 클린룸 조건 (운영자 2026-09-03): `src/r2/**` 기존 파일은 `src/decoder/**` 를
 * import 하지 않는다. 세션은 이 파일이 만든 detectInto/alignInto 를 **주입**으로만
 * 받는다. 이 파일 외의 r2 모듈은 이 어댑터를 import 하지 않는다.
 *
 * 잠긴 설계 (PM/029B §13):
 *   L1 로케이터 shape → 호모그래피 H 한 장으로 셀을 찍는다
 *   L2 estimateCubePose 금지
 *   L3 detectRectifyAnchors 금지
 *   L4 가시성 = 투영 모듈 quad 의 2D 부호넓이 부호
 *   L5 면 라벨(T/L/R)은 검출기가 실어 보낸다
 *   L6 채택 판정은 격자잠김비 F = 셀간분산/셀내분산
 */

import { CORNER_UNIT_OFFSETS } from '../hexgrid.js';
import {
  dataCellsInScanOrderCellSurfaceFinal,
} from '../cellSurfaceFinal.js';
import {
  UNVERIFIED_CS_BLOCK_LOCATOR,
  detectCellSurfaceBlockShapes,
} from '../decoder/cellsurface-block-detect.js';
import { estimateHomography4, estimateHomographyN } from '../decoder/homography.js';
import { Q15_ONE } from './params.js';
import { R2_SESSION_STATUS } from './session.js';

/** session.detectionOutput.family 에 싣는 Type Y 값. hex 팩 1..5 다음. */
export const A3_FAMILY_Y = 6;

/** faceLuma 슬롯 순서. 누적기 T=0, L=1, R=2 와 동일. */
export const FACE_LABELS = Object.freeze(['T', 'L', 'R']);

/** F 가 이 값 이상이면 align 게이트 통과. 붕괴 참조 2.6 의 위. */
export const GRID_LOCK_GATE_F = 10;

/** 봉우리로 세는 F 하한. 정지사진 양성 참조 2684 vs 중앙 8.7. */
export const GRID_LOCK_PEAK_F = 100;

/**
 * 로케이터에 선언하는 **중앙 창**. R2 는 라이브 스캐너이고 화면이 「코드를 프레임 안에
 * 맞춰 주세요」를 이미 요구하므로, 「찾는 블록이 중앙에 있다」는 계약을 선언할 수 있다.
 * 로케이터는 이 창 밖의 v0-center 후보를 **상위 컷을 다투기 전에** 뺀다
 * (`cellsurface-block-detect.js` 의 `inCentreWindow`). 미선언이면 그 필터가 항등이다.
 *
 * 🔴 **왜 필요한가** (2026-09-03 실측): 화면 촬영 프레임의 **모서리 QR 코드가 v0 불스아이
 * 점수를 1.000 으로 포화**시켜 `centres.slice(0,3)` 예산을 점거한다. 진짜 Type Y 중앙은
 * 0.81\~0.94 라 컷에서 잘리고, 그러면 **어댑터에는 큐브 후보가 도착조차 하지 않아**
 * `pickShape` 의 F 재정렬로도 못 고친다. 실측 (전수 438프레임, 조준 aim ≤ 0.25):
 *   y0 0/108 → 108/108 (aimError 2.332 → 0.040 · F 14.8 → 597.3)
 *   y2 45/110 → 97/110 · y1 84/111 → 110/111
 *
 * ⚠ **이 값은 성질이 아니라 «그 QR 이 어디 있었나» 로 정해졌다.** 사다리는
 * 1.0 / 0.95 / 0.90 에서 y0 이 **전부 0** 이고 0.75 에서만 산다 — y0 의 QR 이 (90, 81)
 * 이라 960 프레임에서 `960·cw/2 < 390`, 즉 **cw < 0.81** 이 경계이기 때문이다.
 * QR 이 더 안쪽에 있는 촬영에서는 이 창이 안 듣는다. 근본 처방은 **후보 순위가 위치가
 * 아니라 «그것이 코드인가» 를 재는 것**이고 그건 검출 축의 별도 과업이다 (PM/029B §15).
 *
 * ⚠ **못 덮는 축**: 로케이터 테스트는 `embed960` 으로 코드를 정중앙에 놓아
 * **「코드가 프레임 가장자리에 있을 때」를 구조적으로 시험하지 않는다.** 이 값에서는
 * 코드 중심이 프레임 중앙 75% 밖이면 R2 가 못 잡는다 (960 기준 x·y ∈ [120, 840]).
 *
 * ⚠ **이 값은 로케이터 기본값에서 «유도»한다 — 손으로 적은 사본이 아니다** (2026-09-04).
 * 잠깐 `0.75` 를 여기 직접 적어 뒀는데, 그 순간 같은 숫자가 두 곳에 살아 **어느 쪽도
 * 다른 쪽에서 유도하지 않는** 상태가 됐다. 나란히 유지하는 값은 반드시 어긋난다.
 * 계약을 바꿀 거면 `UNVERIFIED_CS_BLOCK_LOCATOR` 한 곳만 바꿔라.
 */
export const CENTRE_WINDOW_FRACTION = UNVERIFIED_CS_BLOCK_LOCATOR.centreWindowFraction;

/**
 * relocateEveryFrame=false 에서 F 가 게이트 미만인 프레임이 이 횟수 연속이면
 * 어댑터가 스스로 락을 푼다. 1 은 한 프레임 블러에 락을 버리고, 세션
 * hardDrop 보다 긴 N 은 조준 실수(QR 미끼)에 들러붙는다. 3 ≈ 100ms@30fps.
 * 세션 API 는 그대로다 — reset() 호출처는 없고 hardDrop 이 어댑터에 닿지 않는다.
 */
export const LOCK_MISS_LIMIT = 3;

const MAX_N = 25;
const MAX_CELLS = MAX_N * MAX_N;
const SQRT3_HALF = Math.sqrt(3) / 2;
const F_WITHIN_FLOOR = 1e-32;
const AREA_EPS = 1;
const TAP_FRAC = 0.18;
const HOMOG_W_MIN = 1e-12;

// T, L, R 순 — ygrid FACE_BASIS 와 동일 (C1/C5, C5/C3, C3/C1).
const EI_X = new Float64Array([SQRT3_HALF, -SQRT3_HALF, 0]);
const EI_Y = new Float64Array([-0.5, -0.5, 1]);
const EJ_X = new Float64Array([-SQRT3_HALF, 0, SQRT3_HALF]);
const EJ_Y = new Float64Array([-0.5, 1, -0.5]);

const DLT_TUPLES = Object.freeze([
  Object.freeze([0, 2, 4]),
  Object.freeze([0, 2, 3, 5]),
  Object.freeze([0, 1, 3, 4]),
  Object.freeze([1, 2, 4, 5]),
]);

function copy9(src, dst) {
  for (let i = 0; i < 9; i += 1) dst[i] = src[i];
}

function canonicalCorner(index, n) {
  const c = CORNER_UNIT_OFFSETS[index];
  return { x: c.x * n, y: c.y * n };
}

/**
 * shape 계약(center + vertices[6])에서 H 를 복원한다. 생산 경로는 원점+6꼭짓점
 * 최소제곱. 4점 DLT(원점+세 spine T=C0, R=C2, L=C4) 는 N점이 퇴화할 때의 폴백.
 * @param {object} shape
 * @returns {Float64Array | null}
 */
export function homographyFromShape(shape) {
  if (!shape || !shape.center || !shape.vertices || shape.vertices.length !== 6) {
    return null;
  }
  const n = Number(shape.estimatedN);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  const verts = shape.vertices;
  for (let i = 0; i < 6; i += 1) {
    const v = verts[i];
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  }
  if (!Number.isFinite(shape.center.x) || !Number.isFinite(shape.center.y)) return null;

  // 생산 경로: pose.H 를 7점(원점+꼭짓점 6)으로 왕복 복원할 뿐이다.
  // shape.vertices 는 검출기가 pose.H 를 캐노니컬 코너에 투영해 만든 점이라
  // 흡수할 꼭짓점 잡음이 구조적으로 없다. H 품질 판정 채널은 F 단독이다.
  // 4점 DLT 는 가설1 의 존재 증명·N점 퇴화 폴백이다.
  const canonicalN = [{ x: 0, y: 0 }];
  const imageN = [{ x: shape.center.x, y: shape.center.y }];
  for (let k = 0; k < 6; k += 1) {
    canonicalN.push(canonicalCorner(k, n));
    imageN.push({ x: verts[k].x, y: verts[k].y });
  }
  const Hn = estimateHomographyN(canonicalN, imageN);
  if (Hn) return Hn;

  const spine = DLT_TUPLES[0];
  const Hspine = estimateHomography4(
    [
      { x: 0, y: 0 },
      canonicalCorner(spine[0], n),
      canonicalCorner(spine[1], n),
      canonicalCorner(spine[2], n),
    ],
    [shape.center, verts[spine[0]], verts[spine[1]], verts[spine[2]]],
  );
  if (Hspine) return Hspine;

  for (let t = 1; t < DLT_TUPLES.length; t += 1) {
    const idx = DLT_TUPLES[t];
    const canonical = [];
    const image = [];
    for (let k = 0; k < idx.length; k += 1) {
      canonical.push(canonicalCorner(idx[k], n));
      image.push(verts[idx[k]]);
    }
    const H = estimateHomography4(canonical, image);
    if (H) return H;
  }
  return null;
}

function hexSpan(shape) {
  const verts = shape.vertices;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 6; i += 1) {
    const v = verts[i];
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

function geometryOk(shape, width, height) {
  if (!shape || !shape.center || !shape.vertices || shape.vertices.length !== 6) {
    return false;
  }
  if (!Number.isFinite(shape.center.x) || !Number.isFinite(shape.center.y)) {
    return false;
  }
  for (let i = 0; i < 6; i += 1) {
    const v = shape.vertices[i];
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return false;
  }
  const span = hexSpan(shape);
  const limit = Math.min(width, height);
  if (!(span > 0) || !Number.isFinite(span) || span > limit) return false;
  return true;
}

/**
 * 후보 선택. preferN 일치는 동점 처리일 뿐 필터가 아니다 — 미끼가 그 라벨을
 * 자기신고한다. 1순위는 fOf(보통 격자잠김 F). score 하한은 y0 QR 미끼
 * (pickedScore 중앙 0.84) 를 못 가른다.
 */
function pickShape(shapes, preferN, width, height, fOf) {
  let best = null;
  let bestF = -Infinity;
  let bestPrefer = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < shapes.length; i += 1) {
    const shape = shapes[i];
    if (!geometryOk(shape, width, height)) continue;
    const f = fOf ? fOf(shape) : (shape.score || 0);
    const prefer = preferN > 0 && Number(shape.estimatedN) === preferN ? 1 : 0;
    const score = shape.score || 0;
    if (
      best === null
      || f > bestF
      || (f === bestF && prefer > bestPrefer)
      || (f === bestF && prefer === bestPrefer && score > bestScore)
    ) {
      best = shape;
      bestF = f;
      bestPrefer = prefer;
      bestScore = score;
    }
  }
  return best;
}

function layoutIdOf(shape) {
  const block = shape && shape.blockLocator;
  if (!block) return '';
  if (typeof block.layoutId === 'string' && block.layoutId) return block.layoutId;
  if (typeof block.family === 'string' && block.family) return block.family;
  return '';
}

function projectInto(H, x, y, out, offset) {
  const w = H[6] * x + H[7] * y + H[8];
  const scale = Math.max(1, Math.abs(H[8]));
  if (!Number.isFinite(w) || Math.abs(w) < HOMOG_W_MIN * scale) return 0;
  const inv = 1 / w;
  const px = (H[0] * x + H[1] * y + H[2]) * inv;
  const py = (H[3] * x + H[4] * y + H[5]) * inv;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return 0;
  out[offset] = px;
  out[offset + 1] = py;
  return 1;
}

function doubleArea(p) {
  return p[0] * p[3] - p[2] * p[1]
    + p[2] * p[5] - p[4] * p[3]
    + p[4] * p[7] - p[6] * p[5]
    + p[6] * p[1] - p[0] * p[7];
}

function canonicalXY(face, a, b, xy) {
  xy[0] = a * EI_X[face] + b * EJ_X[face];
  xy[1] = a * EI_Y[face] + b * EJ_Y[face];
}

function lumaScaleOf(luma) {
  if (luma instanceof Uint8Array) return 1 / 255;
  if (luma instanceof Uint16Array) return 1 / 65535;
  return 1;
}

function sample01(data, width, height, x, y, scale) {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return NaN;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const row0 = y0 * width;
  const row1 = y1 * width;
  const v00 = data[row0 + x0] * scale;
  const v10 = data[row0 + x1] * scale;
  const v01 = data[row1 + x0] * scale;
  const v11 = data[row1 + x1] * scale;
  const v0 = v00 + (v10 - v00) * fx;
  const v1 = v01 + (v11 - v01) * fx;
  return v0 + (v1 - v0) * fy;
}

function clearAlignOutput(output) {
  output.gatePassed = 0;
  output.weightQ15 = 0;
  output.mismatchCount = 0;
  output.matchCount = 0;
  output.visibleCount = 0;
}

/**
 * 세션에 주입할 detectInto / alignInto 쌍을 만든다.
 * 락 프레임에서만 로케이터를 돌리고, alignInto 핫 루프는 무할당이다.
 *
 * @param {object} [options]
 * @param {number} [options.n] 알려진 n. 로케이터 n 과 맞을 때 우선.
 * @param {boolean} [options.relocateEveryFrame] 측정용. true 면 매 프레임 로케이터.
 * @param {object} [options.locatorOptions] detectCellSurfaceBlockShapes 로 전달.
 *   `calibration.csBlockLocator` 를 주면 아래 중앙 창 기본값보다 우선한다.
 * @param {number|null} [options.centreWindow] 중앙 창 비율. 생략하면
 *   `CENTRE_WINDOW_FRACTION`, **`null` 이면 선언하지 않는다**(로케이터 항등).
 * @param {number} [options.gateF]
 * @param {number} [options.peakF]
 */
export function createA3Adapters(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const preferN = Number(opts.n) > 0 ? Number(opts.n) : 0;
  const relocateEveryFrame = opts.relocateEveryFrame === true;
  // 중앙 창을 **기본으로 선언**한다. 호출자가 `locatorOptions.calibration.csBlockLocator`
  // 로 직접 주면 그쪽이 이긴다 (`centreWindow: null` 로 끌 수도 있다).
  // ⚠ 중첩이 깊은 데엔 이유가 있다 — 로케이터의 `calibration(options)` 이
  // `options.calibration.csBlockLocator` 를 읽는다. 한 층 얕게 넣으면 **조용히 무시된다**
  // (통합자가 이 함정을 한 번 밟아 A/B 두 팔이 비트 동일로 나왔다).
  const suppliedLocator = opts.locatorOptions && typeof opts.locatorOptions === 'object'
    ? opts.locatorOptions
    : {};
  const suppliedCalibration = suppliedLocator.calibration && typeof suppliedLocator.calibration === 'object'
    ? suppliedLocator.calibration
    : {};
  const suppliedCsBlock = suppliedCalibration.csBlockLocator
    && typeof suppliedCalibration.csBlockLocator === 'object'
    ? suppliedCalibration.csBlockLocator
    : {};
  const centreWindow = opts.centreWindow === null ? null
    : (Number(opts.centreWindow) > 0 && Number(opts.centreWindow) <= 1
      ? Number(opts.centreWindow)
      : CENTRE_WINDOW_FRACTION);
  const locatorOptions = {
    ...suppliedLocator,
    calibration: {
      ...suppliedCalibration,
      csBlockLocator: {
        ...(centreWindow === null ? {} : { centreWindowFraction: centreWindow }),
        ...suppliedCsBlock,
      },
    },
  };
  const gateF = Number(opts.gateF) > 0 ? Number(opts.gateF) : GRID_LOCK_GATE_F;
  const peakF = Number(opts.peakF) > 0 ? Number(opts.peakF) : GRID_LOCK_PEAK_F;

  const H = new Float64Array(9);
  const scanI = new Int16Array(MAX_CELLS);
  const scanJ = new Int16Array(MAX_CELLS);
  const quad = new Float64Array(8);
  const xy = new Float64Array(2);
  const fieldView = { width: 0, height: 0, data: null, alpha: null };

  const stats = {
    gridLockF: 0,
    lastAlignMs: 0,
    lastDetectMs: 0,
    n: 0,
    locked: 0,
    layoutId: '',
    shapeCount: 0,
    homographyOk: 0,
    scanMapped: 0,
  };

  let locked = 0;
  let gridN = 0;
  let scanCount = 0;
  let lockMisses = 0;
  let floatScratch = null;

  function rebuildScanMaps(n, layoutId) {
    scanCount = 0;
    gridN = n;
    if (!(n > 0) || n > MAX_N) return;
    try {
      const id = layoutId || undefined;
      const scan = dataCellsInScanOrderCellSurfaceFinal(n, id);
      const limit = Math.min(scan.length, MAX_CELLS);
      for (let k = 0; k < limit; k += 1) {
        scanI[k] = scan[k].i;
        scanJ[k] = scan[k].j;
      }
      scanCount = limit;
    } catch {
      scanCount = 0;
    }
  }

  function bindLuma(luma, width, height) {
    if (luma && luma.data instanceof Float32Array && luma.width === width) {
      return luma;
    }
    if (luma instanceof Float32Array) {
      fieldView.width = width;
      fieldView.height = height;
      fieldView.data = luma;
      fieldView.alpha = null;
      return fieldView;
    }
    const count = width * height;
    if (floatScratch === null || floatScratch.length !== count) {
      floatScratch = new Float32Array(count);
    }
    const scale = lumaScaleOf(luma);
    for (let i = 0; i < count; i += 1) floatScratch[i] = luma[i] * scale;
    fieldView.width = width;
    fieldView.height = height;
    fieldView.data = floatScratch;
    fieldView.alpha = null;
    return fieldView;
  }

  function installLock(nextH, n, layoutId) {
    copy9(nextH, H);
    stats.n = n;
    stats.layoutId = layoutId || '';
    stats.homographyOk = 1;
    locked = 1;
    stats.locked = 1;
    lockMisses = 0;
    rebuildScanMaps(n, layoutId);
  }

  function clearLock() {
    locked = 0;
    gridN = 0;
    scanCount = 0;
    lockMisses = 0;
    stats.locked = 0;
    stats.n = 0;
    stats.layoutId = '';
    stats.homographyOk = 0;
    stats.scanMapped = 0;
    H.fill(0);
  }

  /**
   * 현재 H·n 으로 격자잠김비 F 만 잰다. 후보 선택(detect) 과 align 게이트가
   * 같은 식이다. 할당 없음.
   */
  function computeGridLockF(data, width, height, n) {
    const scale = lumaScaleOf(data);
    let frontSign = 0;
    if (projectQuad(0, 0, 0)) {
      const area = doubleArea(quad);
      if (Math.abs(area) > AREA_EPS) frontSign = area > 0 ? 1 : -1;
    }
    let groupCount = 0;
    let sumMean = 0;
    let sumMean2 = 0;
    let sumVar = 0;
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        for (let face = 0; face < 3; face += 1) {
          if (!projectQuad(face, i, j)) continue;
          const area = doubleArea(quad);
          if (Math.abs(area) <= AREA_EPS) continue;
          const sign = area > 0 ? 1 : -1;
          if (frontSign !== 0 && sign !== frontSign) continue;

          canonicalXY(face, i + 0.5, j + 0.5, xy);
          const cx = xy[0];
          const cy = xy[1];
          let tapN = 0;
          let tapSum = 0;
          let tapSum2 = 0;
          for (let t = 0; t < 4; t += 1) {
            let ax = cx;
            let ay = cy;
            if (t === 1) {
              ax += TAP_FRAC * EI_X[face];
              ay += TAP_FRAC * EI_Y[face];
            } else if (t === 2) {
              ax += TAP_FRAC * EJ_X[face];
              ay += TAP_FRAC * EJ_Y[face];
            } else if (t === 3) {
              ax -= TAP_FRAC * 0.5 * (EI_X[face] + EJ_X[face]);
              ay -= TAP_FRAC * 0.5 * (EI_Y[face] + EJ_Y[face]);
            }
            if (!projectInto(H, ax, ay, quad, 0)) continue;
            const sample = sample01(data, width, height, quad[0], quad[1], scale);
            if (!Number.isFinite(sample)) continue;
            tapN += 1;
            tapSum += sample;
            tapSum2 += sample * sample;
          }
          if (tapN < 2) continue;
          const mean = tapSum / tapN;
          const varr = tapSum2 / tapN - mean * mean;
          groupCount += 1;
          sumMean += mean;
          sumMean2 += mean * mean;
          sumVar += varr < 0 ? 0 : varr;
        }
      }
    }
    if (groupCount < 2) return 0;
    const invK = 1 / groupCount;
    const meanOfMeans = sumMean * invK;
    const varBetween = sumMean2 * invK - meanOfMeans * meanOfMeans;
    const varWithin = sumVar * invK;
    return (varBetween < 0 ? 0 : varBetween) / Math.max(varWithin, F_WITHIN_FLOOR);
  }

  function detectInto(luma, width, height, timestamp, pose, output) {
    const t0 = performance.now();
    output.found = 0;
    output.family = 0;
    output.n = 0;
    output.faceLabels = FACE_LABELS;
    stats.shapeCount = 0;
    stats.homographyOk = locked ? 1 : 0;
    stats.lastDetectMs = 0;

    if (locked && !relocateEveryFrame) {
      output.found = 1;
      output.family = A3_FAMILY_Y;
      output.n = stats.n;
      output.H = H;
      output.layoutId = stats.layoutId;
      stats.lastDetectMs = performance.now() - t0;
      return R2_SESSION_STATUS.OK;
    }

    try {
      const field = bindLuma(luma, width, height);
      const detected = detectCellSurfaceBlockShapes(field, locatorOptions);
      const shapes = detected && detected.shapes ? detected.shapes : [];
      stats.shapeCount = shapes.length;
      const lumaData = field.data;
      const shape = pickShape(shapes, preferN, width, height, (candidate) => {
        const recoveredH = homographyFromShape(candidate);
        if (!recoveredH) return -1;
        copy9(recoveredH, H);
        const candN = Number(candidate.estimatedN);
        if (!(candN > 0) || candN > MAX_N) return -1;
        return computeGridLockF(lumaData, width, height, candN);
      });
      if (!shape) {
        if (relocateEveryFrame) clearLock();
        stats.lastDetectMs = performance.now() - t0;
        return R2_SESSION_STATUS.OK;
      }
      const recovered = homographyFromShape(shape);
      if (!recovered) {
        if (relocateEveryFrame) clearLock();
        stats.lastDetectMs = performance.now() - t0;
        return R2_SESSION_STATUS.OK;
      }
      const n = Number(shape.estimatedN) > 0 ? Number(shape.estimatedN) : preferN;
      installLock(recovered, n, layoutIdOf(shape));
      output.found = 1;
      output.family = A3_FAMILY_Y;
      output.n = stats.n;
      output.H = H;
      output.layoutId = stats.layoutId;
      output.faceLabels = FACE_LABELS;
    } catch {
      output.found = 0;
      output.family = 0;
    }
    stats.lastDetectMs = performance.now() - t0;
    return R2_SESSION_STATUS.OK;
  }

  function cellCoord(cell, cellCount, ij) {
    if (scanCount > 0 && scanCount === cellCount) {
      ij[0] = scanI[cell];
      ij[1] = scanJ[cell];
      return 1;
    }
    if (gridN > 0 && cell < gridN * gridN) {
      ij[0] = cell % gridN;
      ij[1] = (cell / gridN) | 0;
      return 1;
    }
    return 0;
  }

  function projectQuad(face, i, j) {
    for (let c = 0; c < 4; c += 1) {
      const a = i + (c === 1 || c === 2 ? 1 : 0);
      const b = j + (c === 2 || c === 3 ? 1 : 0);
      canonicalXY(face, a, b, xy);
      if (!projectInto(H, xy[0], xy[1], quad, c * 2)) return 0;
    }
    return 1;
  }

  function alignInto(
    luma,
    width,
    height,
    timestamp,
    pose,
    detection,
    output,
    faceLuma,
    visibleCells,
  ) {
    const t0 = performance.now();
    const cellCount = visibleCells && faceLuma
      ? Math.min(visibleCells.length, (faceLuma.length / 3) | 0)
      : 0;
    if (faceLuma) faceLuma.fill(0);
    if (visibleCells) visibleCells.fill(0);
    clearAlignOutput(output);
    stats.gridLockF = 0;
    stats.scanMapped = 0;

    if (!locked || gridN <= 0 || !luma || !(width > 0) || !(height > 0)) {
      stats.lastAlignMs = performance.now() - t0;
      return R2_SESSION_STATUS.OK;
    }

    const data = luma.data instanceof Float32Array ? luma.data : luma;
    const scale = lumaScaleOf(data);
    const n = gridN;
    const ij = xy;
    stats.scanMapped = (scanCount > 0 && scanCount === cellCount) ? 1 : 0;

    // L4 가시성: 투영 quad 부호넓이. 평면 H 아래에서는 세 면 감김이 같아서
    // 실물 436프레임 부호불일치 탈락은 0 이다. visibleCells 를 실제로 정하는
    // 것은 «표본이 화면 안인가»(sample01 이 유한한가) 하나다.
    let frontSign = 0;
    if (projectQuad(0, 0, 0)) {
      const area = doubleArea(quad);
      if (Math.abs(area) > AREA_EPS) frontSign = area > 0 ? 1 : -1;
    }

    stats.gridLockF = computeGridLockF(data, width, height, n);
    let visibleCount = 0;

    for (let cell = 0; cell < cellCount; cell += 1) {
      if (!cellCoord(cell, cellCount, ij)) continue;
      const i = ij[0];
      const j = ij[1];
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      let facesOk = 0;
      for (let face = 0; face < 3; face += 1) {
        if (!projectQuad(face, i, j)) continue;
        const area = doubleArea(quad);
        if (Math.abs(area) <= AREA_EPS) continue;
        const sign = area > 0 ? 1 : -1;
        if (frontSign !== 0 && sign !== frontSign) continue;
        canonicalXY(face, i + 0.5, j + 0.5, xy);
        if (!projectInto(H, xy[0], xy[1], quad, 0)) continue;
        const sample = sample01(data, width, height, quad[0], quad[1], scale);
        if (!Number.isFinite(sample)) continue;
        const byte = sample * 255;
        faceLuma[cell * 3 + face] = byte < 0 ? 0 : byte > 255 ? 255 : byte + 0.5 | 0;
        facesOk += 1;
      }
      if (facesOk === 3) {
        visibleCells[cell] = 1;
        visibleCount += 1;
      } else {
        faceLuma[cell * 3] = 0;
        faceLuma[cell * 3 + 1] = 0;
        faceLuma[cell * 3 + 2] = 0;
      }
    }

    output.visibleCount = visibleCount;
    // A4 몫: mismatchCount/matchCount 를 여기 안 채운다. 0 고정이라
    // 세션 SPRT 신원 가드는 영구 불활성이다. 채우면 가드가 켜지므로 이 레인이 손대지 않는다.
    output.mismatchCount = 0;
    output.matchCount = 0;
    const f = stats.gridLockF;
    if (f >= gateF) {
      output.gatePassed = 1;
      lockMisses = 0;
      let weight = Q15_ONE;
      if (f < peakF) {
        weight = Math.round(Q15_ONE * (f / peakF));
        if (weight < 1) weight = 1;
        if (weight > Q15_ONE) weight = Q15_ONE;
      }
      output.weightQ15 = weight;
    } else {
      lockMisses += 1;
      if (lockMisses >= LOCK_MISS_LIMIT) clearLock();
    }
    stats.lastAlignMs = performance.now() - t0;
    return R2_SESSION_STATUS.OK;
  }

  /**
   * 셀 중심의 **사영 픽셀 좌표**를 채운다 — 표시용 (PM/029 §18\~19 우하단 셀맵 렌더).
   *
   * `alignInto` 와 **같은 사슬**(`cellCoord` → `canonicalXY` → `projectInto(H)`)을 탄다.
   * 셀 중심 = 세 면 중심의 사영 평균. 정확한 육각 중심은 아니지만(사영은 비선형) 표시에는
   * 충분하고, 무엇보다 **정합이 실제로 표본한 자리**와 같은 H·같은 격자를 쓴다 —
   * 그래서 화면의 점이 「정합이 보는 곳」이다. 따로 계산하면 두 그림이 어긋난다.
   *
   * @param {Float32Array} out  길이 ≥ cellCount×2. 못 사영한 셀은 NaN.
   * @returns {number} 사영된 셀 수. 락이 없으면 0.
   */
  function projectCellCentres(out, cellCount) {
    if (!locked || gridN <= 0 || !out) return 0;
    const n = gridN;
    const limit = Math.min(cellCount, (out.length / 2) | 0);
    let mapped = 0;
    for (let cell = 0; cell < limit; cell += 1) {
      out[cell * 2] = NaN;
      out[cell * 2 + 1] = NaN;
      if (!cellCoord(cell, cellCount, xy)) continue;
      const i = xy[0];
      const j = xy[1];
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      let sx = 0;
      let sy = 0;
      let faces = 0;
      for (let face = 0; face < 3; face += 1) {
        canonicalXY(face, i + 0.5, j + 0.5, xy);
        if (!projectInto(H, xy[0], xy[1], quad, 0)) continue;
        sx += quad[0];
        sy += quad[1];
        faces += 1;
      }
      if (faces === 0) continue;
      out[cell * 2] = sx / faces;
      out[cell * 2 + 1] = sy / faces;
      mapped += 1;
    }
    return mapped;
  }

  function reset() {
    clearLock();
    stats.gridLockF = 0;
    stats.lastAlignMs = 0;
    stats.lastDetectMs = 0;
    stats.shapeCount = 0;
  }

  function installHomography(nextH, n, layoutId) {
    const size = Number(n);
    if (!(nextH && nextH.length >= 9) || !(size > 0)) return;
    installLock(nextH, size, layoutId || '');
  }

  return {
    detectInto,
    alignInto,
    reset,
    installHomography,
    projectCellCentres,
    H,
    stats,
    faceLabels: FACE_LABELS,
  };
}
