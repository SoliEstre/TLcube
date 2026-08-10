
/**
 * family.js — finder + tiling 증거를 이용한 포맷 패밀리 전단 판별
 *
 * 패밀리는 포맷 인덱스를 읽기 전에 확정한다. 같은 인덱스가 Type O/Type
 * A/Type Y에서 서로 다른 의미를 가지므로 외곽 모양이나 포맷 CRC를 지름길로
 * 쓰지 않는다.
 *
 * 이 모듈의 점수는 M1 calibration 전의 거친 기하 점수다. 분류 결과에는
 * 모든 경로 가설과 hard-check 진단을 함께 싣고, 한 경로가 먼저 통과했다고
 * 다른 경로 평가를 중단하지 않는다.
 *
 * Type Y는 현재 영상 검출 계약이 없으므로 scoreCubeTiling은 의도적으로
 * 미구현 실패를 반환한다. 불스아이 실패를 Y 폴백으로 취급하지 않는다.
 *
 * @module decoder/family
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
  hexDistance,
  regionCells,
} from '../hexgrid.js';
import { regionCellsA } from '../placementA.js';

/*
 * 패밀리 점수의 임계값·가중치는 설계에서 M1 calibration 전 [미검증]이다.
 * 모두 이름을 붙이고 options 로 대체 가능하게 해 calibration 이전의 임시값이
 * 규범 상수처럼 굳지 않게 한다.
 */
// [미검증] M1 calibration 에서 확정: 면 원판의 최소 유효 표본 수.
const DEFAULT_MIN_SAMPLE_COUNT = 3;
// [미검증] M1 calibration 에서 확정: strict rank 로 인정할 최소 간격.
const DEFAULT_MIN_SEPARATION = 0.08;
// [미검증] M1 calibration 에서 확정: Type O 격자 hard-check 최소 지지율.
const DEFAULT_HEX_MIN_STRICT_RATE = 0.45;
// [미검증] M1 calibration 에서 확정: Type O 외곽 링 hard-check 최소 지지율.
const DEFAULT_HEX_MIN_OUTER_RATE = 0.25;
// [미검증] M1 calibration 에서 확정: Type A 패치 hard-check 최소 지지율.
const DEFAULT_TRI_MIN_PATCH_RATE = 0.20;
// [미검증] M1 calibration 에서 확정: Type A 육각 코어 hard-check 최소 지지율.
const DEFAULT_TRI_MIN_CORE_RATE = 0.45;
// [미검증] M1 calibration 에서 확정: 면 표본 원판 반경 비율.
const DEFAULT_SAMPLE_RADIUS_FRACTION = 0.5;
// [미검증] M1 calibration 에서 확정: 거친 점수 항의 상대 가중치.
const HEX_SCORE_WEIGHTS = Object.freeze({ grid: 0.55, separation: 0.25, outer: 0.20 });
const TRI_SCORE_WEIGHTS = Object.freeze({ patch: 0.55, core: 0.30, finder: 0.15 });
const DEFAULT_KS = Object.freeze([6, 8, 10]);
const ORIENTATIONS = Object.freeze([0, 1, 2]);
const LUMA_RANGE_EPSILON = 1e-9;
const FACE_NAMES = Object.freeze(['T', 'L', 'R']);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
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
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || max - min <= LUMA_RANGE_EPSILON) {
    return fail(FRONTEND_FAILURE.LUMA_DEGENERATE, {
      message: '휘도 범위가 없어 타일링 점수를 계산할 수 없다',
      min,
      max,
    });
  }
  return { min, max, span: max - min };
}

function unwrapFinder(finder) {
  if (finder && finder.ok === true) {
    return finder.finder || finder.bullseye || finder;
  }
  return finder;
}

function normalizeFinder(finder) {
  const source = unwrapFinder(finder);
  if (!source || typeof source !== 'object') return null;
  const center = source.center || source.origin;
  const cellSize = source.cellSize === undefined
    ? source.cellSizePxAtCenter
    : source.cellSize;
  if (!finitePoint(center) || !Number.isFinite(cellSize) || cellSize <= 0) return null;
  const kind = source.finderKind || source.kind
    || (source.centerQr ? 'center-qr' : 'bullseye');
  return {
    source,
    center: { x: center.x, y: center.y },
    cellSize,
    kind,
    score: Number.isFinite(source.score) ? clamp01(source.score) : 0.5,
    hardChecksPassed: source.hardChecksPassed !== false,
    centerQr: Boolean(source.centerQr || kind === 'center-qr'),
    H: source.H || source.homography,
  };
}

function normalizeKs(options, finder) {
  const source = options.ks || (finder && finder.source && finder.source.ks) || DEFAULT_KS;
  const values = Array.isArray(source) ? source : [source];
  const output = new Set();
  for (const value of values) {
    if (Number.isInteger(value) && value >= 4) output.add(value);
  }
  return Array.from(output).sort((a, b) => a - b);
}

function normalizeOrientation(options) {
  if (Number.isInteger(options.orientation) && ORIENTATIONS.includes(options.orientation)) {
    return [options.orientation];
  }
  return ORIENTATIONS.slice();
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
  if (!(H instanceof Float64Array) || H.length !== 9) return null;
  const denominator = H[6] * q + H[7] * r + H[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= LUMA_RANGE_EPSILON) return null;
  const point = {
    x: (H[0] * q + H[1] * r + H[2]) / denominator,
    y: (H[3] * q + H[4] * r + H[5]) / denominator,
  };
  return finitePoint(point) ? point : null;
}

function projectCell(finder, q, r, orientation, options) {
  const sign = options.orientationSign === -1 ? -1 : 1;
  const angle = sign * orientation * (2 * Math.PI / 3);
  if (typeof options.project === 'function') {
    const custom = options.project({ q, r, orientation, angle, finder });
    return finitePoint(custom) ? { x: custom.x, y: custom.y } : null;
  }
  const local = axialPixel(q, r, finder.cellSize);
  const rotated = rotateVector(local.x, local.y, angle);
  return { x: finder.center.x + rotated.x, y: finder.center.y + rotated.y };
}

function projectFace(finder, q, r, face, orientation, options) {
  const cell = projectCell(finder, q, r, orientation, options);
  if (!cell) return null;
  const unit = CORNER_UNIT_OFFSETS[FACE_SPINE_CORNER[face]];
  const sign = options.orientationSign === -1 ? -1 : 1;
  const offset = rotateVector(
    unit.x * finder.cellSize / 2,
    unit.y * finder.cellSize / 2,
    sign * orientation * (2 * Math.PI / 3),
  );
  return { x: cell.x + offset.x, y: cell.y + offset.y };
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
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function faceStat(luma, point, radius, grid) {
  if (!point) return { median: NaN, mad: NaN, count: 0 };
  const values = [];
  const denominator = Math.max(1, grid - 1);
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const ox = ((gx / denominator) * 2 - 1) * radius;
      const oy = ((gy / denominator) * 2 - 1) * radius;
      if (ox * ox + oy * oy > radius * radius + LUMA_RANGE_EPSILON) continue;
      const value = bilinear(luma, point.x + ox, point.y + oy);
      if (value !== null) values.push(value);
    }
  }
  if (values.length === 0) return { median: NaN, mad: NaN, count: 0 };
  const value = median(values);
  return {
    median: value,
    mad: median(values.map((item) => Math.abs(item - value))),
    count: values.length,
  };
}

function cellSignal(luma, finder, q, r, orientation, options) {
  const grid = Number.isInteger(options.sampleGrid) && options.sampleGrid >= 3
    ? options.sampleGrid
    : 5;
  const fraction = Number.isFinite(options.sampleRadiusFraction)
    && options.sampleRadiusFraction > 0
    && options.sampleRadiusFraction <= 1
    ? options.sampleRadiusFraction
    : DEFAULT_SAMPLE_RADIUS_FRACTION;
  const radius = finder.cellSize * (SQRT3 / 4) * fraction;
  const faces = {};
  for (const face of FACES) {
    faces[face] = faceStat(
      luma,
      projectFace(finder, q, r, face, orientation, options),
      radius,
      grid,
    );
  }
  const ordered = FACE_NAMES.map((face) => faces[face]);
  const medians = ordered.map((face) => face.median);
  const valid = ordered.every((face) => face.count >= (
    Number.isInteger(options.minSampleCount) ? Math.max(1, options.minSampleCount) : DEFAULT_MIN_SAMPLE_COUNT
  ));
  if (!valid || medians.some((value) => !Number.isFinite(value))) {
    return { valid: false, strict: false, separation: 0, faces };
  }
  const order = [0, 1, 2].sort((a, b) => {
    const difference = medians[a] - medians[b];
    return difference === 0 ? a - b : difference;
  });
  const sorted = order.map((index) => medians[index]);
  const separation = Math.min(sorted[1] - sorted[0], sorted[2] - sorted[1]);
  const minSeparation = Number.isFinite(options.minSeparation)
    ? Math.max(0, options.minSeparation)
    : DEFAULT_MIN_SEPARATION;
  return {
    valid: true,
    strict: separation >= minSeparation,
    separation: Math.max(0, separation),
    faces,
  };
}

function listCells(k, options) {
  if (Array.isArray(options.sampleCells)) {
    return options.sampleCells
      .filter((cell) => cell && Number.isInteger(cell.q) && Number.isInteger(cell.r))
      .map((cell) => ({ q: cell.q, r: cell.r }));
  }
  try {
    return regionCells(k)
      .filter((cell) => hexDistance(cell.q, cell.r) > 2)
      .map((cell) => ({ q: cell.q, r: cell.r }));
  } catch (error) {
    return [];
  }
}

function patchCells(k, options) {
  if (Array.isArray(options.patchCells)) {
    return options.patchCells
      .filter((cell) => cell && Number.isInteger(cell.q) && Number.isInteger(cell.r))
      .map((cell) => ({ q: cell.q, r: cell.r }));
  }
  try {
    return regionCellsA(k)
      .filter((cell) => hexDistance(cell.q, cell.r) > k)
      .map((cell) => ({ q: cell.q, r: cell.r }));
  } catch (error) {
    return [];
  }
}

function measureCells(luma, finder, k, orientation, cells, options) {
  let strict = 0;
  let valid = 0;
  let separationSum = 0;
  let outerStrict = 0;
  let outerTotal = 0;
  for (const cell of cells) {
    const signal = cellSignal(luma, finder, cell.q, cell.r, orientation, options);
    if (signal.valid) valid += 1;
    if (signal.strict) strict += 1;
    separationSum += signal.separation;
    if (hexDistance(cell.q, cell.r) >= Math.max(3, k - 1)) {
      outerTotal += 1;
      if (signal.strict) outerStrict += 1;
    }
  }
  const total = cells.length;
  return {
    k,
    orientation,
    total,
    valid,
    strict,
    strictRate: total === 0 ? 0 : strict / total,
    validRate: total === 0 ? 0 : valid / total,
    meanSeparation: total === 0 ? 0 : separationSum / total,
    outerTotal,
    outerStrict,
    outerRate: outerTotal === 0 ? 0 : outerStrict / outerTotal,
  };
}

function measurePatch(luma, finder, k, orientation, cells, options) {
  let strict = 0;
  let valid = 0;
  let separationSum = 0;
  for (const cell of cells) {
    const signal = cellSignal(luma, finder, cell.q, cell.r, orientation, options);
    if (signal.valid) valid += 1;
    if (signal.strict) strict += 1;
    separationSum += signal.separation;
  }
  return {
    k,
    orientation,
    total: cells.length,
    valid,
    strict,
    strictRate: cells.length === 0 ? 0 : strict / cells.length,
    validRate: cells.length === 0 ? 0 : valid / cells.length,
    meanSeparation: cells.length === 0 ? 0 : separationSum / cells.length,
  };
}

function explicitTiling(finder, family) {
  const source = finder && finder.source;
  if (!source || typeof source !== 'object') return null;
  const key = family === 'hex' ? 'hexTiling' : 'triTiling';
  const nested = source.tiling && source.tiling[family];
  return source[key] || nested || null;
}

function scoreFromExplicit(raw, finder, family) {
  if (!raw || typeof raw !== 'object') return null;
  const hard = raw.hardChecks || {};
  const all = (hard.all === undefined
    ? raw.hardChecksPassed !== false
      && (raw.strictRate === undefined || raw.strictRate >= (
        family === 'hex' ? DEFAULT_HEX_MIN_STRICT_RATE : DEFAULT_TRI_MIN_PATCH_RATE
      ))
    : Boolean(hard.all)) && finder.hardChecksPassed;
  return {
    family,
    finderKind: finder.kind,
    gridKind: family === 'hex' ? 'axial-rhombille' : 'hex-core-tri-patch',
    k: Number.isInteger(raw.k) ? raw.k : undefined,
    orientation: Number.isInteger(raw.orientation) ? raw.orientation : undefined,
    score: Number.isFinite(raw.score) ? clamp01(raw.score) : 0,
    hardChecks: {
      ...hard,
      finder: hard.finder === undefined ? finder.hardChecksPassed : Boolean(hard.finder),
      all,
    },
    diagnostics: { source: 'supplied-evidence', raw },
    hypothesisId: family + '-supplied',
  };
}

function sortMeasurements(measurements) {
  return measurements.slice().sort((a, b) => {
    const scoreDifference = b.score - a.score;
    if (scoreDifference !== 0) return scoreDifference;
    return a.k - b.k || a.orientation - b.orientation;
  });
}

function scoreHexInternal(luma, finderInput, options = {}) {
  const stats = validateLuma(luma);
  if (stats && stats.ok === false) return stats;
  const finder = normalizeFinder(finderInput);
  if (!finder) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { family: 'hex', message: '불스아이 증거가 없다' });
  }
  const supplied = explicitTiling(finder, 'hex');
  if (supplied) {
    const explicit = scoreFromExplicit(supplied, finder, 'hex');
    return ok(explicit);
  }
  const ks = normalizeKs(options, finder);
  if (ks.length === 0) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, { family: 'hex', message: 'k 목록이 없다' });
  }
  const orientations = normalizeOrientation(options);
  const measurements = [];
  for (const k of ks) {
    const cells = listCells(k, options);
    for (const orientation of orientations) {
      const measured = measureCells(luma, finder, k, orientation, cells, options);
      const separation = clamp01(measured.meanSeparation / Math.max(stats.span, LUMA_RANGE_EPSILON));
      const score = HEX_SCORE_WEIGHTS.grid * measured.strictRate
        + HEX_SCORE_WEIGHTS.separation * separation
        + HEX_SCORE_WEIGHTS.outer * measured.outerRate;
      measurements.push({ ...measured, score });
    }
  }
  const ordered = sortMeasurements(measurements);
  const best = ordered[0] || {
    k: undefined,
    orientation: undefined,
    score: 0,
    strictRate: 0,
    outerRate: 0,
    validRate: 0,
  };
  const finderCheck = finder.hardChecksPassed;
  const tilingCheck = best.strictRate >= (
    Number.isFinite(options.minHexStrictRate)
      ? options.minHexStrictRate
      : DEFAULT_HEX_MIN_STRICT_RATE
  );
  const outerCheck = best.outerRate >= (
    Number.isFinite(options.minHexOuterRate)
      ? options.minHexOuterRate
      : DEFAULT_HEX_MIN_OUTER_RATE
  );
  return ok({
    family: 'hex',
    finderKind: finder.kind,
    gridKind: 'axial-rhombille',
    k: best.k,
    orientation: best.orientation,
    score: clamp01((best.score || 0) * (0.5 + 0.5 * finder.score)),
    hardChecks: {
      finder: finderCheck,
      tiling: tilingCheck,
      boundary: outerCheck,
      all: finderCheck && tilingCheck && outerCheck,
    },
    diagnostics: {
      finder: {
        center: finder.center,
        cellSize: finder.cellSize,
        score: finder.score,
        hardChecksPassed: finder.hardChecksPassed,
      },
      lumaSpan: stats.span,
      sizeScores: ordered,
      selectedSize: { k: best.k, orientation: best.orientation },
    },
    hypothesisId: 'hex-' + best.k + '-' + best.orientation,
  });
}

/**
 * Type O/hex의 단일 axial rhombille 타일링 지지 점수를 계산한다.
 *
 * @returns {object} ok 결과에는 family/finderKind/gridKind/score/hardChecks와
 * 진단용 sizeScores가 있다.
 */
export function scoreHexTiling(luma, finder, options = {}) {
  return scoreHexInternal(luma, finder, options);
}

function scoreTriInternal(luma, finderInput, options = {}) {
  const stats = validateLuma(luma);
  if (stats && stats.ok === false) return stats;
  const finder = normalizeFinder(finderInput);
  if (!finder) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { family: 'tri', message: '불스아이 증거가 없다' });
  }
  const supplied = explicitTiling(finder, 'tri');
  if (supplied) {
    const explicit = scoreFromExplicit(supplied, finder, 'tri');
    return ok(explicit);
  }
  const ks = normalizeKs(options, finder);
  if (ks.length === 0) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, { family: 'tri', message: 'k 목록이 없다' });
  }
  const orientations = normalizeOrientation(options);
  const measurements = [];
  for (const k of ks) {
    const core = listCells(k, options);
    const patches = patchCells(k, options);
    for (const orientation of orientations) {
      const coreMeasured = measureCells(luma, finder, k, orientation, core, options);
      const patchMeasured = measurePatch(luma, finder, k, orientation, patches, options);
      const coreRate = coreMeasured.strictRate;
      const patchRate = patchMeasured.strictRate;
      const score = TRI_SCORE_WEIGHTS.patch * patchRate
        + TRI_SCORE_WEIGHTS.core * coreRate
        + TRI_SCORE_WEIGHTS.finder * finder.score;
      measurements.push({
        k,
        orientation,
        score,
        coreRate,
        patchRate,
        core: coreMeasured,
        patch: patchMeasured,
      });
    }
  }
  const ordered = sortMeasurements(measurements);
  const best = ordered[0] || {
    k: undefined,
    orientation: undefined,
    score: 0,
    coreRate: 0,
    patchRate: 0,
  };
  const finderCheck = finder.hardChecksPassed;
  const coreCheck = best.coreRate >= (
    Number.isFinite(options.minTriCoreRate)
      ? options.minTriCoreRate
      : DEFAULT_TRI_MIN_CORE_RATE
  );
  const patchCheck = best.patchRate >= (
    Number.isFinite(options.minTriPatchRate)
      ? options.minTriPatchRate
      : DEFAULT_TRI_MIN_PATCH_RATE
  );
  return ok({
    family: 'tri',
    finderKind: finder.kind,
    gridKind: 'hex-core-tri-patch',
    k: best.k,
    orientation: best.orientation,
    score: clamp01(best.score),
    hardChecks: {
      finder: finderCheck,
      coreTiling: coreCheck,
      patchTiling: patchCheck,
      all: finderCheck && coreCheck && patchCheck,
    },
    diagnostics: {
      finder: {
        center: finder.center,
        cellSize: finder.cellSize,
        score: finder.score,
        hardChecksPassed: finder.hardChecksPassed,
      },
      lumaSpan: stats.span,
      sizeScores: ordered,
      selectedSize: { k: best.k, orientation: best.orientation },
    },
    hypothesisId: 'tri-' + best.k + '-' + best.orientation,
  });
}

/**
 * Type A/tri의 육각 코어 + 코어 밖 세 삼각 패치 연속성 점수.
 */
export function scoreTriTiling(luma, finder, options = {}) {
  return scoreTriInternal(luma, finder, options);
}

/**
 * Type Y에는 현재 영상 검출 계약이 없다. 불스아이 실패를 Y로 승격하는
 * 폴백은 ADR/설계에서 금지하므로, 입력과 무관하게 명시적 실패를 반환한다.
 */
export function scoreCubeTiling(luma, yJunction, options = {}) {
  return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
    family: 'cube',
    gridKind: 'y-junction',
    unimplemented: true,
    message: 'Type Y Y-junction 영상 검출 계약이 아직 확정되지 않았다',
    yJunctionProvided: yJunction !== undefined && yJunction !== null,
  });
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return {};
  if (evidence.ok === true && evidence.evidence) return evidence.evidence;
  return evidence;
}

function finderList(evidence) {
  const raw = evidence.finder || evidence.finderEvidence || evidence.bullseye
    || evidence.bullseyeEvidence;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return [raw];
  if (finitePoint(evidence.center)) return [evidence];
  return [];
}

function suppliedHypotheses(evidence) {
  const raw = evidence.hypotheses || evidence.familyHypotheses || evidence.candidates;
  if (!Array.isArray(raw)) return [];
  return raw.filter((candidate) => candidate
    && (candidate.family === 'hex' || candidate.family === 'tri')
    && candidate.hardChecks
    && typeof candidate.hardChecks === 'object')
    .map((candidate, index) => ({
      ...candidate,
      hypothesisId: candidate.hypothesisId || candidate.family + '-supplied-' + index,
      score: Number.isFinite(candidate.score) ? clamp01(candidate.score) : 0,
      hardChecks: {
        ...candidate.hardChecks,
        all: Boolean(candidate.hardChecks.all),
      },
      diagnostics: {
        ...(candidate.diagnostics || {}),
        source: 'supplied-family-evidence',
      },
    }));
}

function copyWithPatchExclusion(candidate) {
  return {
    ...candidate,
    hardChecks: {
      ...candidate.hardChecks,
      patchExclusion: false,
      all: false,
    },
    diagnostics: {
      ...(candidate.diagnostics || {}),
      patchExclusion: 'tri 경로의 패치 양성 증거가 있어 O 코어 단독 선택을 금지했다',
    },
  };
}

/**
 * 패밀리별 rough hypothesis 전체와 hard-check 진단을 반환한다.
 *
 * 성공 시 family는 유일하게 hard-check를 통과한 패밀리의 편의 필드지만,
 * hypotheses에는 soft/hard 전 가설이 그대로 남는다. 서로 다른 패밀리의
 * 양성 기하 경로가 둘 이상이면 포맷으로 타이브레이크하지 않고
 * FAMILY_AMBIGUOUS를 반환한다.
 */
export function classifyFamily(luma, evidence, options = {}) {
  const lumaFailure = validateLuma(luma);
  if (lumaFailure && lumaFailure.ok === false) {
    return lumaFailure;
  }
  const normalizedEvidence = normalizeEvidence(evidence);
  const finders = finderList(normalizedEvidence);
  const hypotheses = suppliedHypotheses(normalizedEvidence);
  const reports = [];
  const finderReports = [];

  for (let i = 0; i < finders.length; i += 1) {
    const finder = finders[i];
    const finderInput = {
      ...(finder && typeof finder === 'object' ? finder : {}),
    };
    if (normalizedEvidence.hexTiling !== undefined) finderInput.hexTiling = normalizedEvidence.hexTiling;
    if (normalizedEvidence.triTiling !== undefined) finderInput.triTiling = normalizedEvidence.triTiling;
    const hex = scoreHexInternal(luma, finderInput, options);
    const tri = scoreTriInternal(luma, finderInput, options);
    finderReports.push({
      finderIndex: i,
      hex,
      tri,
    });
    if (hex.ok === true) hypotheses.push({ ...hex, finderIndex: i });
    else reports.push({ finderIndex: i, family: 'hex', result: hex });
    if (tri.ok === true) hypotheses.push({ ...tri, finderIndex: i });
    else reports.push({ finderIndex: i, family: 'tri', result: tri });
  }

  const cube = scoreCubeTiling(luma, normalizedEvidence.yJunction, options);
  reports.push({ family: 'cube', result: cube });

  /*
   * A 패치가 양성인 같은 finder에서 hex 코어만 통과시키면 A0 도플갱어를
   * O로 강등하는 오류가 재발한다. 따라서 tri hard evidence가 있을 때 그
   * finder의 hex 후보는 진단에 남기되 hard 선택에서 제외한다.
   */
  const triPositive = hypotheses.some((candidate) => candidate.family === 'tri'
    && candidate.finderIndex !== undefined
    && candidate.hardChecks && candidate.hardChecks.all);
  if (triPositive) {
    for (let i = 0; i < hypotheses.length; i += 1) {
      const candidate = hypotheses[i];
      if (candidate.family !== 'hex') continue;
      const sameFinder = candidate.finderIndex === undefined
        || hypotheses.some((other) => other.family === 'tri'
          && other.finderIndex === candidate.finderIndex
          && other.hardChecks && other.hardChecks.all);
      if (sameFinder) hypotheses[i] = copyWithPatchExclusion(candidate);
    }
  }

  const hard = hypotheses.filter((candidate) => candidate.hardChecks && candidate.hardChecks.all);
  const familySet = Array.from(new Set(hard.map((candidate) => candidate.family))).sort();
  const diagnostics = {
    finderCount: finders.length,
    finderReports,
    reports,
    cube,
    hypothesisCount: hypotheses.length,
    hardHypothesisCount: hard.length,
    hardFamilies: familySet,
  };

  if (familySet.length === 0) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      hypotheses,
      diagnostics,
      message: 'hard-check를 통과한 패밀리 가설이 없다',
    });
  }
  if (familySet.length > 1) {
    return fail(FRONTEND_FAILURE.FAMILY_AMBIGUOUS, {
      hypotheses,
      diagnostics,
      message: '서로 다른 패밀리의 양성 기하 경로가 동시에 남았다',
    });
  }

  return ok({
    family: familySet[0],
    hypotheses,
    diagnostics,
  });
}
