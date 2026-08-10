
/**
 * anchor-detect.js — Type O/A 앵커 3점과 120도 방향 가설
 *
 * 앵커는 포맷을 읽기 전에 격자 크기와 방향을 좁히는 기하 증거다. 이 모듈은
 * 불스아이 중심과 셀 피치로 유한한 (k, orientation) 전체를 평가하고, 첫
 * 일치에서 멈추지 않는다. 후단 bootstrap 이 포맷·본문 검증으로 선택한다.
 *
 * 좌표 규약:
 *   - 입력 bullseye.center 는 image pixel이다.
 *   - q/r은 셀 식별용 axial 좌표이며 H에 직접 넣지 않는다.
 *   - 모든 투영점은 unit-cell canonical Euclidean으로 변환한다.
 *   - 출력 H는 canonical Euclidean -> image pixel이다.
 *
 * @module decoder/anchor-detect
 */

import {
  FRONTEND_FAILURE,
  HOMOGRAPHY_CANONICAL_SPACE,
  assertHomography,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import {
  FACES,
  axialToPixel,
} from '../hexgrid.js';
import { ranksToDigit } from '../lehmer.js';
import { anchorCells } from '../placement.js';
import { vertexAnchors } from '../placementA.js';
import { sampleHexCell } from './grid-sample.js';

/*
 * 아래 값 중 separation/tie/sample count 는 설계에서 아직 M1 calibration 전
 * [미검증] 상태다. 이름을 붙여 옵션으로 덮어쓸 수 있게 두고, 측정 전에는
 * 포맷 규범처럼 숨기지 않는다.
 */
// [미검증] M1 calibration 에서 확정: 앵커 면 순위의 최소 상대휘도 간격.
const DEFAULT_ANCHOR_MIN_SEPARATION = 0.04;
// [미검증] M1 calibration 에서 확정: 근접동률로 취급할 간격.
const DEFAULT_ANCHOR_TIE_EPSILON = 0.02;
// [미검증] M1 calibration 에서 확정: 앵커 면 원판의 최소 유효 표본 수.
const DEFAULT_ANCHOR_MIN_SAMPLE_COUNT = 3;
// [미검증] M1 calibration 에서 확정: 내접원 반지름 대비 표본 원판 반경.
const DEFAULT_ANCHOR_SAMPLE_RADIUS_FRACTION = 0.5;
// [미검증] M1 calibration 에서 확정: projective 원판의 최소 짧은축 지름.
const DEFAULT_ANCHOR_MIN_PROJECTED_MINOR_DIAMETER_PX = 1;
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
    baseHomography: source.H || source.homography || source.transform || source.B || options.H,
  };
}

function applyHomography(H, point) {
  const denominator = H[6] * point.x + H[7] * point.y + H[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= LUMA_RANGE_EPSILON) return null;
  const x = (H[0] * point.x + H[1] * point.y + H[2]) / denominator;
  const y = (H[3] * point.x + H[4] * point.y + H[5]) / denominator;
  return finitePoint({ x, y }) ? { x, y } : null;
}

function multiplyHomographies(left, right) {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        out[row * 3 + column] += left[row * 3 + inner] * right[inner * 3 + column];
      }
    }
  }
  return out;
}

function rotationHomography(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float64Array([
    cosine, -sine, 0,
    sine, cosine, 0,
    0, 0, 1,
  ]);
}

function makeAffineHomography(center, cellSize) {
  return new Float64Array([
    cellSize, 0, center.x,
    0, cellSize, center.y,
    0, 0, 1,
  ]);
}

function homographyForOrientation(bullseye, orientation, options) {
  const supplied = options.H || bullseye.baseHomography;
  const base = supplied === undefined
    ? makeAffineHomography(bullseye.center, bullseye.cellSize)
    : assertHomography(supplied);
  const sign = options.orientationSign === -1 ? -1 : 1;
  return multiplyHomographies(
    base,
    rotationHomography(sign * orientation * (2 * Math.PI / 3)),
  );
}

function projectCell(H, q, r) {
  return applyHomography(H, axialToPixel(q, r));
}

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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
  const minProjectedMinorDiameter = Number.isFinite(options.minProjectedMinorDiameter)
    ? Math.max(0, options.minProjectedMinorDiameter)
    : DEFAULT_ANCHOR_MIN_PROJECTED_MINOR_DIAMETER_PX;
  const H = homographyForOrientation(bullseye, orientation, options);
  const pointList = [];
  const measurements = [];
  let allSamples = true;
  let allRanks = true;
  let allExpected = true;
  let minCount = Infinity;

  for (let i = 0; i < canonicalAnchors.length; i += 1) {
    const anchor = canonicalAnchors[i];
    const point = projectCell(H, anchor.q, anchor.r);
    pointList.push(point || { x: NaN, y: NaN });
    const sampled = point
      ? sampleHexCell(
        luma,
        { H, canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE },
        anchor.q,
        anchor.r,
        {
          discOptions: { fraction: sampleFraction, fractionOf: 'radius' },
          minSampleCount,
          minProjectedMinorDiameter,
          tieEpsilon,
        },
      )
      : fail(FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE, {
        stage: 'anchor-project',
        cause: 'anchor-crosses-projective-horizon',
      });
    const faces = sampled.ok
      ? { T: sampled.T, L: sampled.L, R: sampled.R }
      : {
        T: { median: NaN, mad: NaN, count: 0 },
        L: { median: NaN, mad: NaN, count: 0 },
        R: { median: NaN, mad: NaN, count: 0 },
      };
    const orderedFaces = FACE_NAMES.map((face) => faces[face]);
    const rank = rankStat(orderedFaces, tieEpsilon);
    const expected = anchor.digit;
    const sampleCheck = sampled.ok
      && orderedFaces.every((face) => face.count >= minSampleCount);
    const rankCheck = sampled.ok
      && !rank.tie
      && Number.isFinite(rank.separation)
      && rank.separation >= minSeparation;
    const expectedCheck = sampled.ok && rank.digit === expected;
    allSamples = allSamples && sampleCheck;
    allRanks = allRanks && rankCheck;
    allExpected = allExpected && expectedCheck;
    for (const face of orderedFaces) minCount = Math.min(minCount, face.count);
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
      samplingFailure: sampled.ok ? null : {
        reason: sampled.reason,
        detail: sampled.detail,
      },
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

  return {
    family,
    k,
    orientation,
    centerQr: bullseye.centerQr,
    anchors: pointList,
    canonicalAnchors: canonicalAnchors.map((anchor) => ({ q: anchor.q, r: anchor.r })),
    H,
    canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
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
