/**
 * reference-validate.js — Type O digit-3 레퍼런스의 순서 검증과 선택적 국소 보정
 *
 * 레퍼런스는 절대 휘도를 맞추는 캘리브레이션 패치가 아니다. T < R < L이라는
 * 순서와 원판 내부 MAD 대비의 분리폭만 이용해, 잘못된 기하 가설을 거르고
 * 필요할 때만 작은 canonical 잔차장을 제안한다.
 */

import {
  FACES,
  axialToPixel,
  cellSampleDiscs,
  hexDistance,
  normalizeLayout,
} from '../hexgrid.js';
import { REFERENCE_DIGIT, referenceCellsAll } from '../placement.js';
import {
  FRONTEND_FAILURE,
  assertHomography,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import { rankConfidence, sampleProjectedDisc } from './grid-sample.js';

// [미검증] M1 calibration 에서 확정
export const MIN_VALID_REFERENCES_PER_RING = 1;

// [미검증] M1 calibration 에서 확정
export const MIN_REFERENCE_ORDER_FRACTION = 0.75;

// [미검증] M1 calibration 에서 확정
export const LOCAL_WARP_SEARCH_RADIUS_CELLS = 0.20;

// [미검증] M1 calibration 에서 확정
export const LOCAL_WARP_SEARCH_STEP_CELLS = 0.025;

// [미검증] M1 calibration 에서 확정
export const MAX_LOCAL_WARP_CELLS = 0.25;

// [미검증] M1 calibration 에서 확정
export const MIN_LOCAL_WARP_MARGIN_IMPROVEMENT = 0.10;

// [미검증] M1 calibration 에서 확정
export const LOCAL_WARP_HUBER_DELTA_CELLS = 0.05;

// 고정 반복 수는 wall-clock이 아니라 입력 크기에만 의존하도록 한다. 이 값 역시
// 강건성 보장이 아니라 처음부터 재현 가능한 보정 경로를 만들기 위한 초기 설정이다.
// [미검증] M1 calibration 에서 확정
export const LOCAL_WARP_IRLS_ITERATIONS = 4;

const AFFINE_PIVOT_EPSILON = 1e-12;

function median(values) {
  if (values.length === 0) throw new RangeError('median: 빈 표본');
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function firstDefined(options, names, fallback) {
  for (const name of names) {
    if (options[name] !== undefined) return options[name];
  }
  return fallback;
}

function finiteInRange(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(label + '는 [' + minimum + ', ' + maximum + '] 범위의 유한수여야 한다: ' + value);
  }
  return value;
}

function positiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(label + '는 양의 유한수여야 한다: ' + value);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(label + '는 0 이상의 정수여야 한다: ' + value);
  }
  return value;
}

function gridSamplesMap(gridSamples) {
  if (gridSamples instanceof Map) return gridSamples;
  if (gridSamples && typeof gridSamples === 'object') {
    if (gridSamples.ok === false) return null;
    if (gridSamples.cells instanceof Map) return gridSamples.cells;
    if (gridSamples.samples instanceof Map) return gridSamples.samples;
  }
  throw new TypeError('gridSamples 는 Map 또는 cells: Map을 가진 성공 결과여야 한다');
}

function cellSampleFrom(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.ok === false) return null;
  if (value.sample && typeof value.sample === 'object') return value.sample;
  if (value.cell && typeof value.cell === 'object') return value.cell;
  return value;
}

function geometryH(geometry) {
  if (geometry instanceof Float64Array) return geometry;
  if (!geometry || typeof geometry !== 'object') {
    throw new TypeError('geometry 는 H를 가진 객체 또는 Homography 여야 한다');
  }
  return geometry.H || geometry.homography;
}

function geometryLayout(geometry, options = {}) {
  const layout = options.layout !== undefined
    ? options.layout
    : geometry && typeof geometry === 'object'
      ? geometry.layout || geometry.canonicalLayout
      : undefined;
  return normalizeLayout(layout);
}

function configuredReferences(options = {}) {
  const minValidPerRing = firstDefined(
    options,
    ['minValidReferencesPerRing', 'minimumValidReferencesPerRing'],
    MIN_VALID_REFERENCES_PER_RING,
  );
  const minOrderFraction = firstDefined(
    options,
    ['minReferenceOrderFraction', 'minimumReferenceOrderFraction', 'minOrderFraction'],
    MIN_REFERENCE_ORDER_FRACTION,
  );
  nonNegativeInteger(minValidPerRing, 'minValidReferencesPerRing');
  finiteInRange(minOrderFraction, 'minReferenceOrderFraction', 0, 1);
  return { minValidPerRing, minOrderFraction };
}

function referenceMeasurement(reference, sample, confidenceOptions) {
  const rank = rankConfidence(sample, confidenceOptions);
  const orderValid =
    sample.T.median < sample.R.median
    && sample.R.median < sample.L.median;
  const darkGap = sample.R.median - sample.T.median;
  const lightGap = sample.L.median - sample.R.median;
  const delta = Math.min(darkGap, lightGap);

  return {
    q: reference.q,
    r: reference.r,
    ring: hexDistance(reference.q, reference.r),
    expectedDigit: REFERENCE_DIGIT,
    order: rank.order,
    orderValid,
    confident: orderValid && rank.confident,
    darkGap,
    lightGap,
    delta,
    noise: rank.noise,
    confidence: rank.confidence,
    tie: rank.tie,
    sample: {
      T: sample.T,
      L: sample.L,
      R: sample.R,
      separation: sample.separation,
      tie: sample.tie,
    },
  };
}

function localScaleEntries(referenceRows) {
  // localScaleField는 함수가 아니라 명시적 표본장으로 둔다. 함수 객체를 결과에
  // 넣으면 같은 입력 두 번의 deep equality와 직렬 진단이 불필요하게 깨진다.
  return referenceRows
    .filter((row) => row.orderValid && Number.isFinite(row.delta) && row.delta > 0)
    .map((row) => ({
      q: row.q,
      r: row.r,
      ring: row.ring,
      delta: row.delta,
      noise: row.noise,
    }));
}

/**
 * Type O의 알려진 digit-3 reference를 모두 평가한다. 한 reference가 실패했다고
 * 바로 끝내지 않아야 링별 coverage와 전체 실패 원인을 함께 진단할 수 있다.
 *
 * @param {Map<string, object>|{cells:Map<string, object>}} gridSamples
 * @param {number} k
 * @param {object} [options]
 * @returns {{ok:true,...object}|{ok:false,reason:string,detail:object}}
 */
export function validateOReferences(gridSamples, k, options = {}) {
  if (!Number.isInteger(k) || k < 3) {
    throw new RangeError('Type O k 는 3 이상의 정수여야 한다: ' + k);
  }
  const samples = gridSamplesMap(gridSamples);
  if (samples === null) {
    return fail(FRONTEND_FAILURE.REFERENCE_MISMATCH, {
      stage: 'validate-o-references',
      cause: 'grid-sampling-failed',
    });
  }

  const config = configuredReferences(options);
  const expected = referenceCellsAll(k);
  const rings = new Map();
  for (let ring = 3; ring <= k; ring += 1) {
    rings.set(ring, {
      ring,
      total: 0,
      validOrder: 0,
      confident: 0,
      missing: 0,
      ok: false,
      references: [],
    });
  }

  const rows = [];
  const violations = [];
  for (const reference of expected) {
    const key = reference.q + ',' + reference.r;
    const bucket = rings.get(hexDistance(reference.q, reference.r));
    bucket.total += 1;

    const sample = cellSampleFrom(samples.get(key));
    if (sample === null) {
      const row = {
        q: reference.q,
        r: reference.r,
        ring: bucket.ring,
        expectedDigit: REFERENCE_DIGIT,
        missing: true,
        orderValid: false,
        confident: false,
      };
      rows.push(row);
      bucket.references.push(row);
      bucket.missing += 1;
      violations.push({ type: 'missing-reference-sample', key, ring: bucket.ring });
      continue;
    }

    let row;
    try {
      row = referenceMeasurement(reference, sample, options);
    } catch (error) {
      row = {
        q: reference.q,
        r: reference.r,
        ring: bucket.ring,
        expectedDigit: REFERENCE_DIGIT,
        invalidSample: true,
        orderValid: false,
        confident: false,
        diagnostic: String(error.message || error),
      };
      violations.push({ type: 'invalid-reference-sample', key, ring: bucket.ring });
    }

    rows.push(row);
    bucket.references.push(row);
    if (row.orderValid) bucket.validOrder += 1;
    if (row.confident) bucket.confident += 1;
  }

  for (const bucket of rings.values()) {
    bucket.ok = bucket.confident >= config.minValidPerRing;
    if (!bucket.ok) {
      violations.push({
        type: 'ring-coverage',
        ring: bucket.ring,
        confident: bucket.confident,
        required: config.minValidPerRing,
      });
    }
  }

  const validOrder = rows.filter((row) => row.orderValid).length;
  const confident = rows.filter((row) => row.confident).length;
  const orderedRows = rows.filter((row) => row.orderValid && Number.isFinite(row.delta));
  const orderFraction = expected.length === 0 ? 0 : validOrder / expected.length;
  if (orderFraction < config.minOrderFraction) {
    violations.push({
      type: 'global-order-fraction',
      orderFraction,
      required: config.minOrderFraction,
    });
  }

  const report = {
    total: expected.length,
    validOrder,
    confident,
    perRing: rings,
    globalDeltaMedian: orderedRows.length === 0 ? null : median(orderedRows.map((row) => row.delta)),
    globalNoiseMedian: orderedRows.length === 0 ? null : median(orderedRows.map((row) => row.noise)),
    localScaleField: localScaleEntries(rows),
    offsets: [],
    correctionAccepted: false,
    references: rows,
    orderFraction,
    thresholds: config,
    ok: violations.length === 0,
  };

  if (!report.ok) {
    return fail(FRONTEND_FAILURE.REFERENCE_MISMATCH, {
      stage: 'validate-o-references',
      report,
      violations,
    });
  }
  return ok(report);
}

function localWarpConfig(options = {}) {
  const searchRadiusCells = firstDefined(
    options,
    ['searchRadiusCells', 'searchRadius'],
    LOCAL_WARP_SEARCH_RADIUS_CELLS,
  );
  const searchStepCells = firstDefined(
    options,
    ['searchStepCells', 'searchStep'],
    LOCAL_WARP_SEARCH_STEP_CELLS,
  );
  const maxWarpCells = firstDefined(
    options,
    ['maxWarpCells', 'maxWarp'],
    MAX_LOCAL_WARP_CELLS,
  );
  const minImprovement = firstDefined(
    options,
    ['minMarginImprovement', 'minimumMarginImprovement'],
    MIN_LOCAL_WARP_MARGIN_IMPROVEMENT,
  );
  const huberDeltaCells = firstDefined(
    options,
    ['huberDeltaCells', 'huberDelta'],
    LOCAL_WARP_HUBER_DELTA_CELLS,
  );
  const iterations = firstDefined(
    options,
    ['irlsIterations', 'iterations'],
    LOCAL_WARP_IRLS_ITERATIONS,
  );

  finiteInRange(searchRadiusCells, 'searchRadiusCells', 0, Infinity);
  positiveFinite(searchStepCells, 'searchStepCells');
  positiveFinite(maxWarpCells, 'maxWarpCells');
  finiteInRange(minImprovement, 'minMarginImprovement', 0, Infinity);
  positiveFinite(huberDeltaCells, 'huberDeltaCells');
  nonNegativeInteger(iterations, 'irlsIterations');

  const steps = Math.round(searchRadiusCells / searchStepCells);
  if (Math.abs(steps * searchStepCells - searchRadiusCells) > 1e-12) {
    throw new RangeError('searchRadiusCells 는 searchStepCells의 정수배여야 한다');
  }

  return {
    searchRadiusCells,
    searchStepCells,
    maxWarpCells,
    minImprovement,
    huberDeltaCells,
    iterations,
    steps,
  };
}

function nestedSampleOptions(options) {
  if (options.sampleOptions === undefined) return options;
  if (!options.sampleOptions || typeof options.sampleOptions !== 'object') {
    throw new TypeError('sampleOptions 는 객체여야 한다');
  }
  return { ...options, ...options.sampleOptions };
}

function nestedDiscOptions(options) {
  if (options.discOptions === undefined) return options;
  if (!options.discOptions || typeof options.discOptions !== 'object') {
    throw new TypeError('discOptions 는 객체여야 한다');
  }
  return options.discOptions;
}

function sampledCellAtOffset(luma, H, layout, q, r, dx, dy, options) {
  const discs = cellSampleDiscs(q, r, layout, nestedDiscOptions(options));
  const samples = {};
  const failures = [];
  const optionsForDisc = nestedSampleOptions(options);

  for (const face of FACES) {
    const disc = discs[face];
    const result = sampleProjectedDisc(
      luma,
      H,
      { x: disc.x + dx, y: disc.y + dy, radius: disc.radius },
      optionsForDisc,
    );
    if (!result.ok) {
      failures.push({ face, reason: result.reason, detail: result.detail });
      continue;
    }
    samples[face] = {
      median: result.median,
      mad: result.mad,
      count: result.count,
    };
  }

  if (failures.length > 0) {
    return fail(FRONTEND_FAILURE.SAMPLE_STARVED, {
      stage: 'local-warp-offset-sample',
      q,
      r,
      dx,
      dy,
      failures,
    });
  }

  const rank = rankConfidence(samples, options);
  const margin = Math.min(
    samples.R.median - samples.T.median,
    samples.L.median - samples.R.median,
  );
  return ok({
    cell: {
      T: samples.T,
      L: samples.L,
      R: samples.R,
      separation: rank.separation,
      tie: rank.tie,
    },
    margin,
    confidence: rank.confidence,
    tie: rank.tie,
  });
}

function offsetIsBetter(candidate, current) {
  if (current === null) return true;
  if (candidate.margin !== current.margin) return candidate.margin > current.margin;
  if (candidate.normSquared !== current.normSquared) return candidate.normSquared < current.normSquared;
  if (candidate.dy !== current.dy) return candidate.dy < current.dy;
  return candidate.dx < current.dx;
}

function bestOffsetForReference(luma, H, layout, reference, config, options) {
  const unit = layout.size;
  let best = null;
  let evaluated = 0;
  let starved = 0;

  // 정수 격자 인덱스로 좌표를 만들면 0.025의 이진 부동소수 오차가 순회 순서를
  // 흔드는 일을 막는다. 모든 후보를 끝까지 평가한 뒤에만 best를 고른다.
  for (let iy = -config.steps; iy <= config.steps; iy += 1) {
    const dy = iy * config.searchStepCells * unit;
    for (let ix = -config.steps; ix <= config.steps; ix += 1) {
      const dx = ix * config.searchStepCells * unit;
      const result = sampledCellAtOffset(luma, H, layout, reference.q, reference.r, dx, dy, options);
      evaluated += 1;
      if (!result.ok) {
        starved += 1;
        continue;
      }

      const candidate = {
        q: reference.q,
        r: reference.r,
        dx,
        dy,
        margin: result.margin,
        confidence: result.confidence,
        normSquared: dx * dx + dy * dy,
      };
      if (offsetIsBetter(candidate, best)) best = candidate;
    }
  }

  return { best, evaluated, starved };
}

function solveThreeByThree(matrix, vector) {
  const a = matrix.map((row) => row.slice());
  const b = vector.slice();

  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) <= AFFINE_PIVOT_EPSILON) return null;
    if (pivot !== column) {
      [a[pivot], a[column]] = [a[column], a[pivot]];
      [b[pivot], b[column]] = [b[column], b[pivot]];
    }

    const divisor = a[column][column];
    for (let j = column; j < 3; j += 1) a[column][j] /= divisor;
    b[column] /= divisor;

    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      if (factor === 0) continue;
      for (let j = column; j < 3; j += 1) a[row][j] -= factor * a[column][j];
      b[row] -= factor * b[column];
    }
  }

  return b;
}

function fitAffineResidual(points, config) {
  if (points.length < 3) return null;
  let weights = new Array(points.length).fill(1);
  let coefficients = null;

  for (let iteration = 0; iteration <= config.iterations; iteration += 1) {
    const normal = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const targetX = [0, 0, 0];
    const targetY = [0, 0, 0];

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const basis = [1, point.u, point.v];
      const weight = weights[index];
      for (let row = 0; row < 3; row += 1) {
        targetX[row] += weight * basis[row] * point.dx;
        targetY[row] += weight * basis[row] * point.dy;
        for (let column = 0; column < 3; column += 1) {
          normal[row][column] += weight * basis[row] * basis[column];
        }
      }
    }

    const dx = solveThreeByThree(normal, targetX);
    const dy = solveThreeByThree(normal, targetY);
    if (dx === null || dy === null) return null;
    coefficients = { dx, dy };
    if (iteration === config.iterations) break;

    const huberDelta = config.huberDeltaCells;
    weights = points.map((point) => {
      const predicted = displacementAt(coefficients, point.u, point.v);
      const ex = point.dx - predicted.dx;
      const ey = point.dy - predicted.dy;
      const residual = Math.sqrt(ex * ex + ey * ey);
      return residual <= huberDelta || residual === 0 ? 1 : huberDelta / residual;
    });
  }

  return coefficients;
}

function displacementAt(coefficients, u, v) {
  return {
    dx: coefficients.dx[0] + coefficients.dx[1] * u + coefficients.dx[2] * v,
    dy: coefficients.dy[0] + coefficients.dy[1] * u + coefficients.dy[2] * v,
  };
}

function referenceRows(references) {
  if (Array.isArray(references)) return references;
  if (!references || typeof references !== 'object') {
    throw new TypeError('references 는 ReferenceReport 또는 reference 배열이어야 한다');
  }
  if (references.ok === false) return null;
  if (Array.isArray(references.references)) return references.references;
  if (references.report && Array.isArray(references.report.references)) return references.report.references;
  throw new TypeError('references 에 references 배열이 없다');
}

function marginValues(input) {
  const source = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray(input.references)
      ? input.references
      : input && typeof input === 'object' && Array.isArray(input.margins)
        ? input.margins
        : [input];

  const values = [];
  for (const item of source) {
    const value = typeof item === 'number'
      ? item
      : item && typeof item === 'object'
        ? item.margin !== undefined
          ? item.margin
          : item.delta
        : undefined;
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

/**
 * leave-one-out 전후 margin의 중앙값만으로 국소 보정 채택 여부를 판단한다.
 * 보정 거부는 레퍼런스 순서 실패가 아니라 "보정 없이 계속"해야 하는 정상 진단이다.
 */
export function validateLocalWarp(before, after, options = {}) {
  const beforeValues = marginValues(before);
  const afterValues = marginValues(after);
  const minImprovement = firstDefined(
    options,
    ['minMarginImprovement', 'minimumMarginImprovement'],
    MIN_LOCAL_WARP_MARGIN_IMPROVEMENT,
  );
  finiteInRange(minImprovement, 'minMarginImprovement', 0, Infinity);

  if (beforeValues.length === 0 || afterValues.length === 0) {
    return {
      accepted: false,
      beforeMedian: null,
      afterMedian: null,
      improvement: null,
      requiredImprovement: null,
      compared: 0,
      cause: 'no-comparable-margins',
    };
  }

  const beforeMedian = median(beforeValues);
  const afterMedian = median(afterValues);
  const improvement = afterMedian - beforeMedian;
  const requiredImprovement = minImprovement * Math.max(Math.abs(beforeMedian), 1 / 255);
  return {
    accepted: improvement >= requiredImprovement,
    beforeMedian,
    afterMedian,
    improvement,
    requiredImprovement,
    compared: Math.min(beforeValues.length, afterValues.length),
  };
}

/**
 * 레퍼런스 주변의 모든 고정 offset 후보를 평가하고, affine residual 후보를
 * leave-one-out로 검증한다. 이 함수는 H를 교체하지 않는다. 성공 correction은
 * canonical p에 D(p)를 더한 뒤 기존 H로 투영해야 한다.
 */
export function estimateLocalWarp(luma, geometry, references, options = {}) {
  assertLumaField(luma);
  const H = geometryH(geometry);
  assertHomography(H);
  const layout = geometryLayout(geometry, options);
  const config = localWarpConfig(options);
  const rows = referenceRows(references);
  if (rows === null) {
    return fail(FRONTEND_FAILURE.REFERENCE_MISMATCH, {
      stage: 'estimate-local-warp',
      cause: 'reference-validation-failed',
    });
  }

  // 이미 expected order와 confidence를 잃은 reference의 offset은 기하가 아니라
  // 텍스처/노이즈를 학습할 위험이 크다. 검증된 제어 셀만 fit 증거로 쓴다.
  const usable = rows.filter((row) =>
    Number.isInteger(row.q)
    && Number.isInteger(row.r)
    && row.orderValid !== false
    && row.confident !== false,
  );

  const selected = [];
  const searchDiagnostics = [];
  for (const reference of usable) {
    const searched = bestOffsetForReference(luma, H, layout, reference, config, options);
    searchDiagnostics.push({
      q: reference.q,
      r: reference.r,
      evaluated: searched.evaluated,
      starved: searched.starved,
      found: searched.best !== null,
    });
    if (searched.best !== null) selected.push(searched.best);
  }

  if (selected.length === 0) {
    return fail(FRONTEND_FAILURE.SAMPLE_STARVED, {
      stage: 'estimate-local-warp',
      cause: 'no-reference-offset-sample',
      searchDiagnostics,
    });
  }

  const points = selected.map((offset) => {
    const center = axialToPixel(offset.q, offset.r, layout);
    return {
      ...offset,
      u: center.x,
      v: center.y,
    };
  });
  const coefficients = fitAffineResidual(points, {
    ...config,
    huberDeltaCells: config.huberDeltaCells * layout.size,
  });

  if (coefficients === null) {
    return ok({
      correction: null,
      correctionAccepted: false,
      offsets: selected,
      searchDiagnostics,
      validation: {
        accepted: false,
        cause: 'insufficient-or-degenerate-affine-points',
      },
    });
  }

  const jacobianDeterminant =
    (1 + coefficients.dx[1]) * (1 + coefficients.dy[2])
    - coefficients.dx[2] * coefficients.dy[1];
  const predictedOffsets = points.map((point) => {
    const displacement = displacementAt(coefficients, point.u, point.v);
    return { q: point.q, r: point.r, ...displacement };
  });
  const maxDisplacement = predictedOffsets.reduce((maximum, offset) => {
    const magnitude = Math.sqrt(offset.dx * offset.dx + offset.dy * offset.dy);
    return Math.max(maximum, magnitude);
  }, 0);

  const before = [];
  const after = [];
  const validationFailures = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const beforeSample = sampledCellAtOffset(luma, H, layout, point.q, point.r, 0, 0, options);
    if (beforeSample.ok) {
      before.push({ q: point.q, r: point.r, margin: beforeSample.margin });
    } else {
      validationFailures.push({ q: point.q, r: point.r, phase: 'before', detail: beforeSample.detail });
    }

    const leaveOneOut = fitAffineResidual(
      points.filter((_, candidateIndex) => candidateIndex !== index),
      {
        ...config,
        huberDeltaCells: config.huberDeltaCells * layout.size,
      },
    );
    if (leaveOneOut === null) {
      validationFailures.push({ q: point.q, r: point.r, phase: 'leave-one-out-fit' });
      continue;
    }

    const displacement = displacementAt(leaveOneOut, point.u, point.v);
    const afterSample = sampledCellAtOffset(
      luma,
      H,
      layout,
      point.q,
      point.r,
      displacement.dx,
      displacement.dy,
      options,
    );
    if (afterSample.ok) {
      after.push({ q: point.q, r: point.r, margin: afterSample.margin });
    } else {
      validationFailures.push({ q: point.q, r: point.r, phase: 'after', detail: afterSample.detail });
    }
  }

  const marginValidation = validateLocalWarp(before, after, {
    minMarginImprovement: config.minImprovement,
  });
  const maxDisplacementAllowed = config.maxWarpCells * layout.size;
  const geometricSafe = jacobianDeterminant > 0 && maxDisplacement <= maxDisplacementAllowed;
  const correctionAccepted = marginValidation.accepted && geometricSafe;

  const candidate = {
    type: 'affine-residual',
    coefficients,
    jacobianDeterminant,
    maxDisplacement,
    maxDisplacementAllowed,
  };
  return ok({
    correction: correctionAccepted ? candidate : null,
    correctionCandidate: candidate,
    correctionAccepted,
    offsets: selected,
    predictedOffsets,
    searchDiagnostics,
    before,
    after,
    validation: {
      ...marginValidation,
      geometricSafe,
      validationFailures,
    },
  });
}
