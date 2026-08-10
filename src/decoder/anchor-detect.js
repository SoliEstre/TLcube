
/**
 * anchor-detect.js — Type O/A 앵커 3점과 120도 방향 가설
 *
 * 앵커는 포맷을 읽기 전에 격자 크기와 방향을 좁히는 기하 증거다. 이 모듈은
 * 불스아이 중심과 셀 피치로 유한한 (k, orientation) 전체를 평가하고, 첫
 * 일치에서 멈추지 않는다. 후단 bootstrap 이 포맷·본문 검증으로 선택한다.
 *
 * 좌표 규약:
 *   - 입력 bullseye.center 는 image 픽셀이다.
 *   - 내부 q/r 은 인코더와 같은 canonical axial 좌표다.
 *   - 출력 H 는 canonical -> image 이다.
 *
 * @module decoder/anchor-detect
 */

import {
  FRONTEND_FAILURE,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import {
  CORNER_UNIT_OFFSETS,
  FACE_SPINE_CORNER,
  FACES,
  SQRT3,
} from '../hexgrid.js';
import { ranksToDigit } from '../lehmer.js';
import { anchorCells } from '../placement.js';
import { vertexAnchors } from '../placementA.js';

/*
 * 아래 값 중 separation/tie/sample count 는 설계에서 아직 M1 calibration 전
 * [미검증] 상태다. 이름을 붙여 옵션으로 덮어쓸 수 있게 두고, 측정 전에는
 * 포맷 규범처럼 숨기지 않는다.
 */
// [미검증] M1 calibration 에서 확정: 앵커 면 순위의 최소 상대휘도 간격.
const DEFAULT_ANCHOR_MIN_SEPARATION = 0.08;
// [미검증] M1 calibration 에서 확정: 근접동률로 취급할 간격.
const DEFAULT_ANCHOR_TIE_EPSILON = 0.02;
// [미검증] M1 calibration 에서 확정: 앵커 면 원판의 최소 유효 표본 수.
const DEFAULT_ANCHOR_MIN_SAMPLE_COUNT = 3;
// [미검증] M1 calibration 에서 확정: 원판 내 고정 표본 격자 해상도.
const DEFAULT_ANCHOR_SAMPLE_GRID = 5;
// [미검증] M1 calibration 에서 확정: 내접원 반지름 대비 표본 원판 반경.
const DEFAULT_ANCHOR_SAMPLE_RADIUS_FRACTION = 0.5;
const LUMA_RANGE_EPSILON = 1e-9;
const ORIENTATIONS = Object.freeze([0, 1, 2]);
const FACE_NAMES = Object.freeze(['T', 'L', 'R']);
const IDENTITY_SIGMA = Object.freeze([0, 1, 2, 3, 4, 5]);
const SIGMA_CW = Object.freeze([4, 5, 1, 0, 3, 2]);
const SIGMA_CCW = Object.freeze([3, 2, 5, 4, 0, 1]);

function finitePoint(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeDirection(direction) {
  if (direction === undefined || direction === null
    || direction === 0 || direction === 'identity' || direction === 'id') return 0;
  if (direction === 1 || direction === 'cw' || direction === 'clockwise') return 1;
  if (direction === 2 || direction === 'ccw' || direction === 'counterclockwise') return 2;
  throw new RangeError('direction 은 0 | 1 | 2 | identity | cw | ccw 여야 한다: ' + direction);
}

function validateLuma(luma) {
  if (luma === null || luma === undefined) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { message: 'luma 가 없다' });
  }
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { message: error.message });
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < luma.data.length; i += 1) {
    const value = luma.data[i];
    if (!Number.isFinite(value) || value < -LUMA_RANGE_EPSILON || value > 1 + LUMA_RANGE_EPSILON) {
      return fail(FRONTEND_FAILURE.LUMA_DEGENERATE, {
        message: '상대휘도 범위를 벗어난 표본이 있다',
        index: i,
        value,
      });
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || max - min <= LUMA_RANGE_EPSILON) {
    return fail(FRONTEND_FAILURE.LUMA_DEGENERATE, {
      message: '휘도 범위가 없어 앵커 순위를 만들 수 없다',
      min,
      max,
    });
  }
  return null;
}

function normalizeKs(ks, options) {
  const source = ks === undefined ? options.ks : ks;
  const values = Array.isArray(source) ? source : [source];
  const unique = new Set();
  for (const value of values) {
    if (Number.isInteger(value) && value >= 4) unique.add(value);
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function normalizeBullseye(bullseye, options) {
  const source = bullseye && bullseye.ok === true
    ? (bullseye.finder || bullseye.bullseye || bullseye)
    : (bullseye || {});
  const center = source.center || options.center;
  const cellSize = source.cellSize === undefined
    ? source.cellSizePxAtCenter
    : source.cellSize;
  if (!finitePoint(center) || !Number.isFinite(cellSize) || cellSize <= 0) return null;
  return {
    center: { x: center.x, y: center.y },
    cellSize,
    centerQr: Boolean(source.centerQr || options.centerQr),
    baseHomography: source.H || source.homography || options.H,
  };
}

function rotateVector(x, y, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * x - s * y, y: s * x + c * y };
}

function axialPixel(q, r, cellSize) {
  return {
    x: cellSize * SQRT3 * (q + r / 2),
    y: cellSize * 1.5 * r,
  };
}

function applyHomography(H, q, r) {
  const h = H;
  const denominator = h[6] * q + h[7] * r + h[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= LUMA_RANGE_EPSILON) return null;
  const x = (h[0] * q + h[1] * r + h[2]) / denominator;
  const y = (h[3] * q + h[4] * r + h[5]) / denominator;
  return finitePoint({ x, y }) ? { x, y } : null;
}

function makeAffineHomography(center, cellSize, orientation, sign) {
  const angle = sign * orientation * (2 * Math.PI / 3);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const qx = cellSize * SQRT3;
  const rx = cellSize * SQRT3 / 2;
  const ry = cellSize * 1.5;
  return new Float64Array([
    c * qx,
    c * rx - s * ry,
    center.x,
    s * qx,
    s * rx + c * ry,
    center.y,
    0,
    0,
    1,
  ]);
}

function projectCell(center, cellSize, q, r, orientation, options) {
  const sign = options.orientationSign === -1 ? -1 : 1;
  const angle = sign * orientation * (2 * Math.PI / 3);
  if (typeof options.project === 'function') {
    const point = options.project({ q, r, orientation, angle, center, cellSize });
    return finitePoint(point) ? { x: point.x, y: point.y } : null;
  }

  const local = axialPixel(q, r, cellSize);
  const rotated = rotateVector(local.x, local.y, angle);
  return { x: center.x + rotated.x, y: center.y + rotated.y };
}

function projectFace(center, cellSize, q, r, face, orientation, options) {
  const cellCenter = projectCell(center, cellSize, q, r, orientation, options);
  if (!cellCenter) return null;
  const spine = FACE_SPINE_CORNER[face];
  const unit = CORNER_UNIT_OFFSETS[spine];
  const sign = options.orientationSign === -1 ? -1 : 1;
  const local = rotateVector(unit.x * cellSize / 2, unit.y * cellSize / 2,
    sign * orientation * (2 * Math.PI / 3));
  return { x: cellCenter.x + local.x, y: cellCenter.y + local.y };
}

function projectWithHomography(center, cellSize, q, r, orientation, options) {
  const candidate = options.H;
  if (!(candidate instanceof Float64Array) || candidate.length !== 9) {
    return makeAffineHomography(center, cellSize, orientation,
      options.orientationSign === -1 ? -1 : 1);
  }
  /*
   * H 가 제공되면 q/r 셀 중심은 H 로 투영한다. H 는 이미 중심·스케일을
   * 담은 canonical -> image 변환이라는 계약이므로, 방향 가설은 canonical
   * axial 120도 회전으로 먼저 반영한다.
   */
  const turns = orientation;
  let cq = q;
  let cr = r;
  for (let i = 0; i < turns; i += 1) {
    if (options.orientationSign === -1) {
      const nextQ = cr;
      const nextR = -cq - cr;
      cq = nextQ;
      cr = nextR;
    } else {
      const nextQ = -cq - cr;
      const nextR = cq;
      cq = nextQ;
      cr = nextR;
    }
  }
  return applyHomography(candidate, cq, cr);
}

function bilinear(luma, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || y < 0 || x > luma.width - 1 || y > luma.height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(luma.width - 1, x0 + 1);
  const y1 = Math.min(luma.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = luma.data[y0 * luma.width + x0];
  const b = luma.data[y0 * luma.width + x1];
  const c = luma.data[y1 * luma.width + x0];
  const d = luma.data[y1 * luma.width + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sampleDisc(luma, center, radius, grid) {
  const values = [];
  const denominator = Math.max(1, grid - 1);
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const ox = ((gx / denominator) * 2 - 1) * radius;
      const oy = ((gy / denominator) * 2 - 1) * radius;
      if (ox * ox + oy * oy > radius * radius + LUMA_RANGE_EPSILON) continue;
      const value = bilinear(luma, center.x + ox, center.y + oy);
      if (value !== null) values.push(value);
    }
  }
  return values;
}

function faceStat(luma, point, radius, grid) {
  const values = sampleDisc(luma, point, radius, grid);
  if (values.length === 0) return { median: NaN, mad: NaN, count: 0 };
  const value = median(values);
  const deviations = values.map((item) => Math.abs(item - value));
  return { median: value, mad: median(deviations), count: values.length };
}

function rankStat(faces, tieEpsilon) {
  if (faces.some((face) => !Number.isFinite(face.median))) {
    return { digit: null, separation: NaN, tie: true, order: [] };
  }
  const order = [0, 1, 2].sort((a, b) => {
    const difference = faces[a].median - faces[b].median;
    return difference === 0 ? a - b : difference;
  });
  const sorted = order.map((index) => faces[index].median);
  const separation = Math.min(sorted[1] - sorted[0], sorted[2] - sorted[1]);
  const tie = separation < tieEpsilon;
  if (tie) return { digit: null, separation, tie, order };
  const ranks = {};
  for (let i = 0; i < order.length; i += 1) ranks[FACE_NAMES[order[i]]] = i;
  return {
    digit: ranksToDigit(ranks),
    separation,
    tie,
    order,
  };
}

function geometryResidual(points, center, cellSize) {
  const radii = points
    .filter((point) => finitePoint(point))
    .map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  if (radii.length === 0) return Infinity;
  const target = median(radii);
  let sum = 0;
  for (const radius of radii) sum += (radius - target) ** 2;
  return Math.sqrt(sum / radii.length);
}

function evaluate(luma, bullseye, canonicalAnchors, family, k, orientation, options) {
  const sampleGrid = Number.isInteger(options.sampleGrid) && options.sampleGrid >= 3
    ? options.sampleGrid
    : DEFAULT_ANCHOR_SAMPLE_GRID;
  const sampleFraction = Number.isFinite(options.sampleRadiusFraction)
    && options.sampleRadiusFraction > 0
    && options.sampleRadiusFraction <= 1
    ? options.sampleRadiusFraction
    : DEFAULT_ANCHOR_SAMPLE_RADIUS_FRACTION;
  const minSeparation = Number.isFinite(options.minSeparation)
    ? Math.max(0, options.minSeparation)
    : DEFAULT_ANCHOR_MIN_SEPARATION;
  const tieEpsilon = Number.isFinite(options.tieEpsilon)
    ? Math.max(0, options.tieEpsilon)
    : DEFAULT_ANCHOR_TIE_EPSILON;
  const minSampleCount = Number.isInteger(options.minSampleCount)
    ? Math.max(1, options.minSampleCount)
    : DEFAULT_ANCHOR_MIN_SAMPLE_COUNT;
  const pointList = [];
  const measurements = [];
  const sampleRadius = bullseye.cellSize * (SQRT3 / 4) * sampleFraction;
  let allSamples = true;
  let allRanks = true;
  let allExpected = true;
  let minCount = Infinity;

  for (let i = 0; i < canonicalAnchors.length; i += 1) {
    const anchor = canonicalAnchors[i];
    const point = projectCell(
      bullseye.center,
      bullseye.cellSize,
      anchor.q,
      anchor.r,
      orientation,
      options,
    );
    pointList.push(point || { x: NaN, y: NaN });
    const faces = {};
    for (const face of FACES) {
      const facePoint = point
        ? projectFace(bullseye.center, bullseye.cellSize, anchor.q, anchor.r, face, orientation, options)
        : null;
      faces[face] = facePoint
        ? faceStat(luma, facePoint, sampleRadius, sampleGrid)
        : { median: NaN, mad: NaN, count: 0 };
      minCount = Math.min(minCount, faces[face].count);
    }
    const orderedFaces = FACE_NAMES.map((face) => faces[face]);
    const rank = rankStat(orderedFaces, tieEpsilon);
    const expected = anchor.digit;
    const sampleCheck = orderedFaces.every((face) => face.count >= minSampleCount);
    const rankCheck = !rank.tie && Number.isFinite(rank.separation)
      && rank.separation >= minSeparation;
    const expectedCheck = rank.digit === expected;
    allSamples = allSamples && sampleCheck;
    allRanks = allRanks && rankCheck;
    allExpected = allExpected && expectedCheck;
    measurements.push({
      canonical: { q: anchor.q, r: anchor.r },
      expectedDigit: expected,
      observedDigit: rank.digit,
      separation: rank.separation,
      tie: rank.tie,
      faces,
      sampleCheck,
      rankCheck,
      expectedCheck,
    });
  }

  const separations = measurements
    .map((measurement) => measurement.separation)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const meanSeparation = separations.length === 0
    ? 0
    : separations.reduce((sum, value) => sum + value, 0) / separations.length;
  const score = clamp01(meanSeparation / Math.max(minSeparation, LUMA_RANGE_EPSILON));
  const residual = geometryResidual(pointList, bullseye.center, bullseye.cellSize);
  const H = makeAffineHomography(
    bullseye.center,
    bullseye.cellSize,
    orientation,
    options.orientationSign === -1 ? -1 : 1,
  );

  return {
    family,
    k,
    orientation,
    centerQr: bullseye.centerQr,
    anchors: pointList,
    canonicalAnchors: canonicalAnchors.map((anchor) => ({ q: anchor.q, r: anchor.r })),
    H,
    geometryResidual: residual,
    anchorMargin: separations.length === 0 ? 0 : Math.min(...separations),
    score,
    hardChecks: {
      sampleCount: allSamples,
      rankSeparation: allRanks,
      expectedPattern: allExpected,
      all: allSamples && allRanks && allExpected,
    },
    measurements,
    hypothesisId: family + '-' + k + '-' + orientation,
    _minCount: Number.isFinite(minCount) ? minCount : 0,
  };
}

function findHypotheses(luma, bullseye, ks, options, family, anchorFactory) {
  const inputFailure = validateLuma(luma);
  if (inputFailure) return inputFailure;
  const normalizedBullseye = normalizeBullseye(bullseye, options);
  if (!normalizedBullseye) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      family,
      message: '불스아이 중심 또는 cellSize 가 없다',
    });
  }
  const normalizedKs = normalizeKs(ks, options);
  if (normalizedKs.length === 0) {
    return fail(FRONTEND_FAILURE.NO_ANCHORS, {
      family,
      message: '검사할 양의 k 목록이 없다',
    });
  }

  const hypotheses = [];
  const rejected = [];
  for (const k of normalizedKs) {
    let anchors;
    try {
      anchors = anchorFactory(k);
    } catch (error) {
      rejected.push({ k, reason: error.message });
      continue;
    }
    for (const orientation of ORIENTATIONS) {
      const evaluated = evaluate(
        luma,
        normalizedBullseye,
        anchors,
        family,
        k,
        orientation,
        options,
      );
      if (evaluated.hardChecks.all) hypotheses.push(evaluated);
      else rejected.push({
        hypothesisId: evaluated.hypothesisId,
        k,
        orientation,
        hardChecks: evaluated.hardChecks,
        anchorMargin: evaluated.anchorMargin,
      });
    }
  }

  hypotheses.sort((a, b) => a.k - b.k || a.orientation - b.orientation);
  const detail = {
    family,
    testedKs: normalizedKs,
    testedOrientations: ORIENTATIONS.slice(),
    evaluatedCount: normalizedKs.length * ORIENTATIONS.length,
    rejected,
  };
  if (hypotheses.length === 0) {
    return fail(FRONTEND_FAILURE.NO_ANCHORS, {
      ...detail,
      hypotheses: [],
    });
  }
  return ok({
    hypotheses,
    diagnostics: detail,
  });
}

/**
 * Type O의 교대 코너 앵커를 전수 평가한다.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {import('./contracts.js').BullseyeCandidate} bullseye
 * @param {number[]|number} ks 지원 k 목록
 * @param {object} [options]
 * @returns {{ok:true, hypotheses: object[], diagnostics: object}|{ok:false, reason:string, detail?:object}}
 */
export function findOAnchorHypotheses(luma, bullseye, ks, options = {}) {
  return findHypotheses(luma, bullseye, ks, options, 'hex', (k) => anchorCells(k));
}

/**
 * Type A의 주 꼭짓점 앵커를 전수 평가한다. Type O의 육각 코어 앵커는
 * placementA.js 규약상 보조 앵커이므로 여기서는 주 앵커 3점만 쓴다.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {import('./contracts.js').BullseyeCandidate} bullseye
 * @param {number[]|number} ks 지원 k 목록
 * @param {object} [options]
 */
export function findAAnchorHypotheses(luma, bullseye, ks, options = {}) {
  return findHypotheses(luma, bullseye, ks, options, 'tri', (k) => vertexAnchors(k));
}

/**
 * 화면 고정 T/L/R 이름으로 관측한 digit을 canonical digit으로 바꾸는
 * 물리 회전 전단사. 0=항등, 1=cw, 2=ccw 는 SPEC §5.2의 σ 표를 그대로
 * 반환하며, 매 호출마다 새 배열을 내어 호출자 변형이 전역 상수를 오염시키지 않게 한다.
 *
 * @param {0|1|2|'identity'|'cw'|'ccw'} direction
 * @returns {number[]} digit -> rotated digit
 */
export function physicalRotationSigma(direction) {
  const normalized = normalizeDirection(direction);
  const table = normalized === 0
    ? IDENTITY_SIGMA
    : normalized === 1
      ? SIGMA_CW
      : SIGMA_CCW;
  return table.slice();
}
