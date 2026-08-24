/**
 * homography.js — canonical 격자 평면에서 image 픽셀 평면으로의 3x3 변환.
 *
 * 모든 H는 row-major이며 canonical -> image 방향이다. 4점 해는 canonical 격자
 * 단위와 픽셀 단위가 수십~수천 배 차이날 수 있으므로 Hartley 정규화 뒤에 푼다.
 * 정규화를 생략하면 정상적인 원근 입력도 pivot 크기 차이만으로 퇴화처럼 보일 수
 * 있다.
 *
 * @module decoder/homography
 */

import { assertHomography, assertLumaField } from './contracts.js';

// [미검증] M1 calibration 에서 확정: 설계 §8.2가 제안한 정규화 선형계 pivot 하한이다.
export const MIN_NORMALIZED_PIVOT_RATIO = 1e-10;

// [미검증] M1 calibration 에서 확정: 설계 §8.2가 제안한 homogeneous denominator 하한이다.
export const PROJECTIVE_DENOMINATOR_MIN_RATIO = 1e-8;

// [미검증] M1 calibration 에서 확정: 중복 대응점으로 볼 상대 거리 하한이다.
export const MIN_POINT_SEPARATION_RATIO = 1e-10;

// [미검증] M1 calibration 에서 확정: 세 점 공선 판정의 상대 면적 하한이다.
export const MIN_TRIANGLE_AREA_RATIO = 1e-10;

// [미검증] M1 calibration 에서 확정: 4점 해의 재투영 잔차 상대 상한이다.
export const MAX_FOUR_POINT_REPROJECTION_ERROR_RATIO = 1e-8;

// [미검증] M1 calibration 에서 확정: 3x3 역행렬 determinant 상대 하한이다.
export const MIN_INVERSE_DETERMINANT_RATIO = 1e-12;

// [미검증] M1 calibration 에서 확정: H[8] gauge로 재정규화할 수 있는 하한이다.
export const HOMOGRAPHY_GAUGE_MIN_RATIO = 1e-12;

// [미검증] M1 calibration 에서 확정: photometric coordinate descent의 고정 반복 횟수다.
export const PHOTOMETRIC_REFINEMENT_ITERATIONS = 3;

// [미검증] M1 calibration 에서 확정: 8개 H 파라미터를 흔드는 초기 상대 보폭이다.
export const PHOTOMETRIC_REFINEMENT_STEP = 1e-3;

/**
 * @param {unknown} points
 * @returns {{x:number, y:number}[] | null}
 */
function readFourPoints(points) {
  if (!points || typeof points.length !== 'number' || points.length !== 4) return null;
  const output = [];
  for (let i = 0; i < 4; i += 1) {
    const point = points[i];
    if (
      !point
      || typeof point !== 'object'
      || !Number.isFinite(point.x)
      || !Number.isFinite(point.y)
    ) {
      return null;
    }
    output.push({ x: point.x, y: point.y });
  }
  return output;
}

/**
 * @param {{x:number, y:number}[]} points
 * @returns {number}
 */
function pointExtent(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

/**
 * 4점 homography의 유일성 조건은 각 점 집합에 중복이 없고 어떤 세 점도
 * 공선이 아닌 것이다. 전체 네 점만 검사하면 세 점 공선인 약한 퇴화를 놓친다.
 * @param {{x:number, y:number}[]} points
 * @returns {boolean}
 */
function isGeneralPosition(points) {
  const extent = pointExtent(points);
  if (!Number.isFinite(extent) || extent <= 0) return false;

  const minSeparation = MIN_POINT_SEPARATION_RATIO * extent;
  const minSeparationSquared = minSeparation * minSeparation;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (dx * dx + dy * dy <= minSeparationSquared) return false;
    }
  }

  const minDoubleArea = MIN_TRIANGLE_AREA_RATIO * extent * extent;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      for (let k = j + 1; k < points.length; k += 1) {
        const abx = points[j].x - points[i].x;
        const aby = points[j].y - points[i].y;
        const acx = points[k].x - points[i].x;
        const acy = points[k].y - points[i].y;
        const doubleArea = Math.abs(abx * acy - aby * acx);
        if (doubleArea <= minDoubleArea) return false;
      }
    }
  }
  return true;
}

/**
 * Hartley normalization: centroid를 원점으로 옮기고 평균 거리를 sqrt(2)로 만든다.
 * source와 destination을 각각 정규화해 DLT의 계수 크기를 같은 차수로 맞춘다.
 * @param {{x:number, y:number}[]} points
 * @returns {{points:{x:number,y:number}[], transform:Float64Array, inverse:Float64Array} | null}
 */
function hartleyNormalize(points) {
  let centerX = 0;
  let centerY = 0;
  for (const point of points) {
    centerX += point.x;
    centerY += point.y;
  }
  centerX /= points.length;
  centerY /= points.length;

  let distanceSum = 0;
  for (const point of points) {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    distanceSum += Math.sqrt(dx * dx + dy * dy);
  }
  const meanDistance = distanceSum / points.length;
  if (!Number.isFinite(meanDistance) || meanDistance <= 0) return null;

  const scale = Math.SQRT2 / meanDistance;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  return {
    points: points.map((point) => ({
      x: scale * (point.x - centerX),
      y: scale * (point.y - centerY),
    })),
    transform: new Float64Array([
      scale, 0, -scale * centerX,
      0, scale, -scale * centerY,
      0, 0, 1,
    ]),
    inverse: new Float64Array([
      1 / scale, 0, centerX,
      0, 1 / scale, centerY,
      0, 0, 1,
    ]),
  };
}

/**
 * row-major 3x3 행렬 곱.
 * @param {Float64Array} left
 * @param {Float64Array} right
 * @returns {Float64Array}
 */
function multiply3(left, right) {
  const output = new Float64Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let value = 0;
      for (let inner = 0; inner < 3; inner += 1) {
        value += left[row * 3 + inner] * right[inner * 3 + column];
      }
      output[row * 3 + column] = value;
    }
  }
  return output;
}

/**
 * DLT의 h33=1 gauge로 만든 8x8 선형계를 deterministic partial pivot
 * Gauss-Jordan elimination으로 푼다. 동률에서 먼저 만난 행을 유지하므로
 * 브라우저마다 pivot 선택이 달라지지 않는다.
 * @param {number[][]} rows
 * @param {number[]} rhs
 * @returns {Float64Array | null}
 */
function solveLinearSystem8(rows, rhs) {
  const augmented = rows.map((row, index) => {
    const output = new Float64Array(9);
    for (let column = 0; column < 8; column += 1) output[column] = row[column];
    output[8] = rhs[index];
    return output;
  });

  let coefficientScale = 0;
  for (const row of augmented) {
    for (let column = 0; column < 8; column += 1) {
      coefficientScale = Math.max(coefficientScale, Math.abs(row[column]));
    }
  }
  if (!Number.isFinite(coefficientScale) || coefficientScale === 0) return null;
  const minPivot = MIN_NORMALIZED_PIVOT_RATIO * coefficientScale;

  for (let column = 0; column < 8; column += 1) {
    let pivotRow = column;
    let pivotAbs = Math.abs(augmented[column][column]);
    for (let row = column + 1; row < 8; row += 1) {
      const candidateAbs = Math.abs(augmented[row][column]);
      if (candidateAbs > pivotAbs) {
        pivotAbs = candidateAbs;
        pivotRow = row;
      }
    }
    if (!Number.isFinite(pivotAbs) || pivotAbs <= minPivot) return null;

    if (pivotRow !== column) {
      const temporary = augmented[column];
      augmented[column] = augmented[pivotRow];
      augmented[pivotRow] = temporary;
    }

    const pivot = augmented[column][column];
    for (let index = column; index <= 8; index += 1) augmented[column][index] /= pivot;

    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let index = column; index <= 8; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }

  const solution = new Float64Array(8);
  for (let index = 0; index < 8; index += 1) {
    if (!Number.isFinite(augmented[index][8])) return null;
    solution[index] = augmented[index][8];
  }
  return solution;
}

/**
 * @param {Float64Array} H
 * @returns {number}
 */
function matrixMaxAbs(H) {
  let maximum = 0;
  for (let i = 0; i < H.length; i += 1) maximum = Math.max(maximum, Math.abs(H[i]));
  return maximum;
}

/**
 * H[8]=1 gauge로 통일한다. 4점 함수의 canonical 원점은 유한 image 점으로
 * 가므로 정상 Type O 가설은 이 gauge를 사용할 수 있다.
 * @param {Float64Array} H
 * @returns {Float64Array | null}
 */
function normalizeHomographyGauge(H) {
  const scale = matrixMaxAbs(H);
  if (!Number.isFinite(scale) || scale === 0) return null;
  if (Math.abs(H[8]) <= HOMOGRAPHY_GAUGE_MIN_RATIO * scale) return null;

  const output = new Float64Array(9);
  for (let i = 0; i < 9; i += 1) {
    output[i] = H[i] / H[8];
    if (!Number.isFinite(output[i])) return null;
  }
  return output;
}

/**
 * @param {unknown} H
 * @returns {H is Float64Array}
 */
function isFiniteHomography(H) {
  if (!(H instanceof Float64Array) || H.length !== 9) return false;
  for (let i = 0; i < 9; i += 1) {
    if (!Number.isFinite(H[i])) return false;
  }
  return true;
}

/**
 * w를 나누기 전에 검사하는 내부 투영. denominator의 세 항 합을 기준으로
 * 상대 판정해, 큰 projective 항의 상쇄로 생기는 사실상 무한대 투영을 막는다.
 * @param {Float64Array} H
 * @param {{x:number,y:number}} point
 * @returns {{x:number,y:number} | null}
 */
function projectPointSafely(H, point) {
  const { x, y } = point;
  const denominator = H[6] * x + H[7] * y + H[8];
  const denominatorScale = Math.abs(H[6] * x) + Math.abs(H[7] * y) + Math.abs(H[8]);
  if (
    !Number.isFinite(denominator)
    || Math.abs(denominator) <= PROJECTIVE_DENOMINATOR_MIN_RATIO * denominatorScale
  ) {
    return null;
  }

  const imageX = (H[0] * x + H[1] * y + H[2]) / denominator;
  const imageY = (H[3] * x + H[4] * y + H[5]) / denominator;
  if (!Number.isFinite(imageX) || !Number.isFinite(imageY)) return null;
  return { x: imageX, y: imageY };
}

/**
 * canonical -> image 4점 대응의 정확 homography를 구한다.
 *
 * @param {{x:number,y:number}[]} canonicalPoints
 * @param {{x:number,y:number}[]} imagePoints
 * @returns {Float64Array | null}
 */
export function estimateHomography4(canonicalPoints, imagePoints) {
  const canonical = readFourPoints(canonicalPoints);
  const image = readFourPoints(imagePoints);
  if (canonical === null || image === null) return null;
  if (!isGeneralPosition(canonical) || !isGeneralPosition(image)) return null;

  const canonicalNormalized = hartleyNormalize(canonical);
  const imageNormalized = hartleyNormalize(image);
  if (canonicalNormalized === null || imageNormalized === null) return null;

  const rows = [];
  const rhs = [];
  for (let i = 0; i < 4; i += 1) {
    const source = canonicalNormalized.points[i];
    const destination = imageNormalized.points[i];
    rows.push([
      source.x, source.y, 1,
      0, 0, 0,
      -destination.x * source.x, -destination.x * source.y,
    ]);
    rhs.push(destination.x);
    rows.push([
      0, 0, 0,
      source.x, source.y, 1,
      -destination.y * source.x, -destination.y * source.y,
    ]);
    rhs.push(destination.y);
  }

  const solved = solveLinearSystem8(rows, rhs);
  if (solved === null) return null;

  const normalizedH = new Float64Array([
    solved[0], solved[1], solved[2],
    solved[3], solved[4], solved[5],
    solved[6], solved[7], 1,
  ]);
  const unnormalized = multiply3(
    multiply3(imageNormalized.inverse, normalizedH),
    canonicalNormalized.transform,
  );
  const H = normalizeHomographyGauge(unnormalized);
  if (H === null) return null;

  const imageScale = pointExtent(image);
  let maxResidual = 0;
  for (let i = 0; i < canonical.length; i += 1) {
    const projected = projectPointSafely(H, canonical[i]);
    if (projected === null) return null;
    const dx = projected.x - image[i].x;
    const dy = projected.y - image[i].y;
    maxResidual = Math.max(maxResidual, Math.sqrt(dx * dx + dy * dy));
  }
  if (maxResidual / imageScale > MAX_FOUR_POINT_REPROJECTION_ERROR_RATIO) return null;

  // contracts.js의 자료형 단언을 실제 생성 경로에도 적용한다.
  assertHomography(H);
  return H;
}

/**
 * canonical -> image **N점(≥4) 대응**의 homography — Wave 3 Type K(육각별) 6점
 * (별 꼭짓점) 확장 (레인 K 브리프 §2 «readFourPoints 4점 전용 → 6점 확장 또는
 * 일반화 — 기존 4점 경로 바이트 동일 보존»).
 *
 * 보존 방식: `estimateHomography4`/`readFourPoints` 는 **한 줄도 안 바꿨다** —
 * 이 함수는 별도 진입점이고, N=4 는 기존 정확해 함수로 그대로 위임하므로 기존
 * 호출부(호출 무변경)와 4점 결과가 비트 동일하다. N>4 는 h33=1 gauge 의 DLT
 * 정규방정식(AᵀA h = Aᵀb, 8×8)을 같은 결정적 solver 로 푸는 **최소제곱** 해다.
 *
 * 퇴화 검사가 4점판과 다른 이유: N>4 에서는 「어떤 세 점도 공선 금지」가 과잉이다
 * — 별 꼭짓점 6점 + 중심은 마주보는 꼭짓점 쌍이 중심과 정확히 공선이지만 전체
 * 계는 잘 결정된다. 중복점만 거르고, 랭크 부족은 solver 의 pivot 하한이 잡는다.
 *
 * @param {{x:number,y:number}[]} canonicalPoints
 * @param {{x:number,y:number}[]} imagePoints 같은 길이
 * @returns {Float64Array | null}
 */
export function estimateHomographyN(canonicalPoints, imagePoints) {
  if (!canonicalPoints || !imagePoints
    || typeof canonicalPoints.length !== 'number'
    || canonicalPoints.length !== imagePoints.length
    || canonicalPoints.length < 4) return null;
  if (canonicalPoints.length === 4) {
    return estimateHomography4(canonicalPoints, imagePoints);
  }
  const canonical = [];
  const image = [];
  for (let i = 0; i < canonicalPoints.length; i += 1) {
    const c = canonicalPoints[i];
    const p = imagePoints[i];
    if (!c || !p || !Number.isFinite(c.x) || !Number.isFinite(c.y)
      || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    canonical.push({ x: c.x, y: c.y });
    image.push({ x: p.x, y: p.y });
  }
  // 중복점 거르기 (양쪽 각각) — 공선 3점은 허용한다 (헤더 근거).
  for (const points of [canonical, image]) {
    const extent = pointExtent(points);
    if (!Number.isFinite(extent) || extent <= 0) return null;
    const minSeparation = MIN_POINT_SEPARATION_RATIO * extent;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        if (dx * dx + dy * dy <= minSeparation * minSeparation) return null;
      }
    }
  }

  const canonicalNormalized = hartleyNormalize(canonical);
  const imageNormalized = hartleyNormalize(image);
  if (canonicalNormalized === null || imageNormalized === null) return null;

  // 정규방정식 누적: M(8×8) = ΣrowᵀA·row, v(8) = Σrowᵀ·rhs.
  const M = Array.from({ length: 8 }, () => new Float64Array(8));
  const v = new Float64Array(8);
  const accumulate = (row, rhs) => {
    for (let a = 0; a < 8; a += 1) {
      if (row[a] === 0) continue;
      v[a] += row[a] * rhs;
      for (let b = 0; b < 8; b += 1) M[a][b] += row[a] * row[b];
    }
  };
  for (let i = 0; i < canonical.length; i += 1) {
    const source = canonicalNormalized.points[i];
    const destination = imageNormalized.points[i];
    accumulate([
      source.x, source.y, 1,
      0, 0, 0,
      -destination.x * source.x, -destination.x * source.y,
    ], destination.x);
    accumulate([
      0, 0, 0,
      source.x, source.y, 1,
      -destination.y * source.x, -destination.y * source.y,
    ], destination.y);
  }

  const solved = solveLinearSystem8(M.map((row) => Array.from(row)), Array.from(v));
  if (solved === null) return null;

  const normalizedH = new Float64Array([
    solved[0], solved[1], solved[2],
    solved[3], solved[4], solved[5],
    solved[6], solved[7], 1,
  ]);
  const unnormalized = multiply3(
    multiply3(imageNormalized.inverse, normalizedH),
    canonicalNormalized.transform,
  );
  const H = normalizeHomographyGauge(unnormalized);
  if (H === null) return null;
  // 최소제곱이라 정확해의 잔차 상한(1e-8)은 적용하지 않는다 — 잔차의 수용 여부는
  // 호출자(예: 별 꼭짓점 앵커 6/6 검증)가 자기 증거로 판단한다. 유한성만 단언.
  for (const point of canonical) {
    if (projectPointSafely(H, point) === null) return null;
  }
  assertHomography(H);
  return H;
}

/**
 * H를 역방향 image -> canonical 변환으로 뒤집는다.
 * @param {Float64Array} H
 * @returns {Float64Array | null}
 */
export function invertHomography(H) {
  if (!isFiniteHomography(H)) return null;

  const [a, b, c, d, e, f, g, h, i] = H;
  const inverseNumerators = new Float64Array([
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ]);
  const determinant = a * inverseNumerators[0]
    + b * inverseNumerators[3]
    + c * inverseNumerators[6];
  const determinantScale = Math.max(
    Math.abs(a * inverseNumerators[0]),
    Math.abs(b * inverseNumerators[3]),
    Math.abs(c * inverseNumerators[6]),
  );
  if (
    !Number.isFinite(determinant)
    || determinantScale === 0
    || Math.abs(determinant) <= MIN_INVERSE_DETERMINANT_RATIO * determinantScale
  ) {
    return null;
  }

  const inverse = new Float64Array(9);
  for (let index = 0; index < 9; index += 1) {
    inverse[index] = inverseNumerators[index] / determinant;
    if (!Number.isFinite(inverse[index])) return null;
  }

  // 역행렬의 H[8]가 0에 가까운 유효 projective 경우도 수학적으로는 존재한다.
  // 그 경우에는 scale을 강제하지 않고, 가능할 때만 일반적인 H[8]=1 gauge로 돌린다.
  const normalized = normalizeHomographyGauge(inverse);
  const result = normalized === null ? inverse : normalized;
  assertHomography(result);
  return result;
}

/**
 * canonical 점 하나를 image로 투영한다. w가 0 또는 상대적으로 너무 작으면
 * 무한대 근처의 숫자를 만들어 내지 않고 null을 반환한다.
 * @param {Float64Array} H
 * @param {{x:number,y:number}} point
 * @returns {{x:number,y:number} | null}
 */
export function projectPoint(H, point) {
  if (
    !isFiniteHomography(H)
    || !point
    || typeof point !== 'object'
    || !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
  ) {
    return null;
  }
  return projectPointSafely(H, point);
}

/**
 * score callback 반환을 숫자로 정규화한다. callback 오류는 한 후보의 무효 점수로
 * 취급해 앞단이 예외로 탈출하지 않게 한다.
 * @param {Function} score
 * @param {object} luma
 * @param {Float64Array} H
 * @param {object} hypothesis
 * @returns {number}
 */
function evaluatePhotometricScore(score, luma, H, hypothesis) {
  try {
    const value = score(luma, H, hypothesis);
    const numeric = typeof value === 'number' ? value : value && value.score;
    return Number.isFinite(numeric) ? numeric : Number.NEGATIVE_INFINITY;
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

/**
 * 불스아이 6-band와 앵커 측정은 검출/앵커 레인이 소유한다. 이 함수는 그들이
 * 제공하는 score(luma, H, hypothesis)로만 H를 보정해, 서로 다른 파인더 템플릿을
 * 이 모듈에 다시 구현하지 않는다.
 *
 * 각 반복에서 현재 H와 8개 자유 파라미터의 +/- 후보를 모두 채점한 뒤 최고점을
 * 고른다. score 동률은 현재 H -> 낮은 parameter index -> 음수 방향 순서로
 * 고정되며, 첫 성공을 채택하지 않는다.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {object & {H: Float64Array}} hypothesis
 * @param {{score?:(luma:object,H:Float64Array,hypothesis:object)=>number|{score:number}, iterations?:number, step?:number}} [options]
 * @returns {object | null}
 */
export function refineHomographyPhotometric(luma, hypothesis, options = {}) {
  if (!hypothesis || typeof hypothesis !== 'object' || !isFiniteHomography(hypothesis.H)) {
    return null;
  }
  if (options === null || typeof options !== 'object') return null;

  const initial = normalizeHomographyGauge(hypothesis.H);
  if (initial === null) return null;
  const score = options.score;
  if (score === undefined) {
    // 아직 검출기가 score 계약을 공급하지 않은 통합 순서에서도 H를 바꾸지 않는다.
    return { ...hypothesis, H: initial };
  }
  if (typeof score !== 'function') return null;

  try {
    assertLumaField(luma);
  } catch {
    return null;
  }

  const iterations = options.iterations === undefined
    ? PHOTOMETRIC_REFINEMENT_ITERATIONS
    : options.iterations;
  const step = options.step === undefined ? PHOTOMETRIC_REFINEMENT_STEP : options.step;
  if (!Number.isInteger(iterations) || iterations < 0 || !Number.isFinite(step) || step <= 0) {
    return null;
  }

  let bestH = initial;
  let bestScore = evaluatePhotometricScore(score, luma, bestH, hypothesis);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const candidates = [{ H: bestH, order: 0 }];
    let order = 1;
    for (let parameter = 0; parameter < 8; parameter += 1) {
      const magnitude = Math.max(1, Math.abs(bestH[parameter]));
      for (const direction of [-1, 1]) {
        const candidate = new Float64Array(bestH);
        candidate[parameter] += direction * step * magnitude;
        const normalized = normalizeHomographyGauge(candidate);
        if (normalized !== null) candidates.push({ H: normalized, order });
        order += 1;
      }
    }

    let chosenH = bestH;
    let chosenScore = bestScore;
    for (const candidate of candidates) {
      const candidateScore = evaluatePhotometricScore(score, luma, candidate.H, hypothesis);
      if (candidateScore > chosenScore) {
        chosenH = candidate.H;
        chosenScore = candidateScore;
      }
    }
    bestH = chosenH;
    bestScore = chosenScore;
  }

  return {
    ...hypothesis,
    H: bestH,
    photometricScore: bestScore,
  };
}
