
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
 * Type Y는 전용 cube-detect 경로에서 육각 실루엣 + Y 심 + 세 면 격자 +
 * referenceAnchors 네 조를 모두 확인한다. 불스아이 실패는 Y 증거로 쓰지 않는다.
 *
 * @module decoder/family
 */

import {
  FRONTEND_FAILURE,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import { detectCubeHypotheses, normalizeCubeSurfaceDefault } from './cube-detect.js';
import {
  CORNER_UNIT_OFFSETS,
  FACE_SPINE_CORNER,
  FACES,
  SQRT3,
  hexDistance,
  regionCells,
} from '../hexgrid.js';
import { regionCellsA, regionCellsTurnA } from '../placementA.js';
import { patchOfK } from '../placementK.js';
import { VERSIONS } from '../capacity.js';
import { VERSIONS_K } from '../capacityK.js';
import { cSpecFromFormatIndex } from '../formatC.js';
import { notchCellsC } from '../notchC.js';

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
// Type C는 3시 노치 8셀이 의도적으로 배경이다. 전경 격자 점수에서 뺀 뒤 별도
// 배경 지지율을 넣어야 한다. 그렇지 않으면 정상 C가 outer strict-rate에서 부당하게
// 감점되고, 반대로 단순 제외만 하면 노치가 채워진 잘못된 프레임도 통과할 수 있다.
const TYPE_C_HEX_SCORE_WEIGHTS = Object.freeze({
  grid: 0.45,
  separation: 0.20,
  outer: 0.15,
  notchBackground: 0.20,
});
const DEFAULT_TYPE_C_MIN_NOTCH_BACKGROUND_RATE = 0.75;
const TRI_SCORE_WEIGHTS = Object.freeze({ patch: 0.55, core: 0.30, finder: 0.15 });
// [미검증] star(Type K) 채점 — tri 와 같은 가중치·문턱을 승계하되 패치가 두 계열
// (A 계열 3 + 반전 계열 3)이라 **둘 다** 문턱을 넘어야 hard 다. 균형비까지 요구하는
// 이유: A 프레임의 반전 자리(배경 클러터)가 우연히 문턱을 넘으면 star 오양성이
// 기존 tri 프레임을 강등시킨다 — 실코드에서는 두 계열이 같은 톤 통계의 데이터라
// 비슷하게 재이고, 클러터는 실코드 쪽 계열과 균형이 맞기 어렵다.
const STAR_SCORE_WEIGHTS = Object.freeze({ patch: 0.55, core: 0.30, finder: 0.15 });
const DEFAULT_STAR_MIN_PATCH_RATE = DEFAULT_TRI_MIN_PATCH_RATE;
const DEFAULT_STAR_MIN_CORE_RATE = DEFAULT_TRI_MIN_CORE_RATE;
const DEFAULT_STAR_PATCH_BALANCE = 0.5;
/**
 * hex 격자 가설의 **기본** k 후보 — `capacity.VERSIONS` 에서 유도한다.
 *
 * 부하를 지는 경로는 이게 아니다: 실제 복호는 `bootstrap.classificationDimensions`
 * 가 `uniqueDimensions('hex')`(역시 VERSIONS 유도)로 만든 `options.ks` 를 넘겨준다.
 * 여기는 **ks 를 안 준 호출자용 폴백**이라 뒤처져도 실기가 안 죽고, 그래서 더
 * 위험하다 — V4(k=12) 편입 2026-08-30 시점에 이 상수는 리터럴 `[6, 8, 10]` 이었고,
 * 그 사본이 틀렸다는 사실을 어떤 왕복 테스트도 못 보고 있었다. 유도로 바꾼다.
 */
const DEFAULT_KS = Object.freeze(
  Array.from(new Set(VERSIONS.map((spec) => spec.k))).sort((a, b) => a - b),
);
const ORIENTATIONS = Object.freeze([0, 1, 2]);
const LUMA_RANGE_EPSILON = 1e-9;
const FACE_NAMES = Object.freeze(['T', 'L', 'R']);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/*
 * 성공 결과만 캐시한다. `validateLuma` 는 전체 픽셀을 훑어 min/max 를 구하는데
 * 한 복호에서 세 번 불린다(실측 Type O/A). 입력은 luma 하나뿐이고 반환된
 * `{min,max,span}` 은 호출부가 읽기만 한다. 실패 경로는 위반 표본을 만나는 즉시
 * 빠져나오는 데다, 반환한 fail 객체가 상위에서 확장될 수 있어 공유하지 않는다.
 */
const validateLumaCache = new WeakMap();

function validateLuma(luma) {
  if (luma !== null && typeof luma === 'object') {
    const cached = validateLumaCache.get(luma);
    if (cached !== undefined) return cached;
    const computed = computeValidateLuma(luma);
    if (computed && computed.ok !== false) validateLumaCache.set(luma, computed);
    return computed;
  }
  return computeValidateLuma(luma);
}

function computeValidateLuma(luma) {
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
  // 버퍼·상한을 루프 밖으로 빼고 Math.min/max 를 비교로 바꿨다. 값은 같다 —
  // 위 가드가 유한값만 통과시키므로 NaN 전파 차이가 생길 여지가 없다.
  const data = luma.data;
  const length = data.length;
  const upperBound = 1 + LUMA_RANGE_EPSILON;
  const lowerBound = -LUMA_RANGE_EPSILON;
  for (let i = 0; i < length; i += 1) {
    const value = data[i];
    if (!Number.isFinite(value) || value < lowerBound || value > upperBound) {
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

function isTypeCDimension(k) {
  return cSpecFromFormatIndex(0, k) !== null;
}

function typeCScoringCells(k, options) {
  const cells = listCells(k, options);
  if (!isTypeCDimension(k)) return cells;
  const notch = new Set(notchCellsC(k).map((cell) => cell.q + ',' + cell.r));
  return cells.filter((cell) => !notch.has(cell.q + ',' + cell.r));
}

function measureTypeCNotchBackground(luma, finder, k, orientation, options) {
  const cells = notchCellsC(k);
  let valid = 0;
  let background = 0;
  let foreground = 0;
  for (const cell of cells) {
    const signal = cellSignal(luma, finder, cell.q, cell.r, orientation, options);
    if (!signal.valid) continue;
    valid += 1;
    // 배경은 같은 바탕색으로 세 면 순위가 갈리지 않는다. 유효한데 strict인 경우만
    // 데이터 전경 증거이며, 표본 부재는 배경 지지로 세지 않는다.
    if (signal.strict) foreground += 1;
    else background += 1;
  }
  return {
    total: cells.length,
    valid,
    background,
    foreground,
    backgroundRate: cells.length === 0 ? 0 : background / cells.length,
    validRate: cells.length === 0 ? 0 : valid / cells.length,
  };
}

/**
 * 코어 밖 패치 셀 — 실루엣 **방향**별로 낸다 (2026-08-18 턴A 편입).
 *
 * `turn: false` = 정삼각(기존 A) · `turn: true` = 역삼각(턴A). 육각 코어는 180°
 * 대칭이라 두 방향이 공유하고, **패치만 배타적**이다 (k=6 에서 각 63셀).
 * 그래서 방향 판별의 근거가 전부 이 함수의 산출에 있다.
 *
 * ⚠ 기본값이 정삼각이라 **기존 호출은 한 비트도 안 바뀐다.**
 * `options.patchCells` 명시 경로도 종전 그대로다 (방향을 무시한다 — 호출자가
 * 이미 좌표를 정한 것이므로).
 */
function patchCells(k, options, turn = false) {
  if (Array.isArray(options.patchCells)) {
    return options.patchCells
      .filter((cell) => cell && Number.isInteger(cell.q) && Number.isInteger(cell.r))
      .map((cell) => ({ q: cell.q, r: cell.r }));
  }
  try {
    const region = turn ? regionCellsTurnA(k) : regionCellsA(k);
    return region
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
    const typeC = isTypeCDimension(k);
    const cells = typeC ? typeCScoringCells(k, options) : listCells(k, options);
    for (const orientation of orientations) {
      const measured = measureCells(luma, finder, k, orientation, cells, options);
      const separation = clamp01(measured.meanSeparation / Math.max(stats.span, LUMA_RANGE_EPSILON));
      if (typeC) {
        const notch = measureTypeCNotchBackground(luma, finder, k, orientation, options);
        const score = TYPE_C_HEX_SCORE_WEIGHTS.grid * measured.strictRate
          + TYPE_C_HEX_SCORE_WEIGHTS.separation * separation
          + TYPE_C_HEX_SCORE_WEIGHTS.outer * measured.outerRate
          + TYPE_C_HEX_SCORE_WEIGHTS.notchBackground * notch.backgroundRate;
        measurements.push({ ...measured, notch, typeC: true, score });
      } else {
        const score = HEX_SCORE_WEIGHTS.grid * measured.strictRate
          + HEX_SCORE_WEIGHTS.separation * separation
          + HEX_SCORE_WEIGHTS.outer * measured.outerRate;
        measurements.push({ ...measured, score });
      }
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
    notch: null,
    typeC: false,
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
  const notchCheck = best.typeC !== true || best.notch.backgroundRate >= (
    Number.isFinite(options.minTypeCNotchBackgroundRate)
      ? options.minTypeCNotchBackgroundRate
      : DEFAULT_TYPE_C_MIN_NOTCH_BACKGROUND_RATE
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
      ...(best.typeC === true ? { notchBackground: notchCheck } : {}),
      all: finderCheck && tilingCheck && outerCheck && notchCheck,
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
      ...(best.typeC === true ? { typeCNotch: best.notch } : {}),
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
  /*
   * 실루엣 방향 가설 (2026-08-18 턴A 편입) — 정삼각(false) · 역삼각(true).
   *
   * 육각 코어는 180° 대칭이라 두 방향이 공유하고 **패치만 배타적**이다
   * (k=6 에서 각 63셀 · placementA 자기검증이 확인). 그래서 코어 측정은 방향당
   * 재계산할 필요가 없고, **패치만** 두 벌 잰다 — 비용은 패치 측정 한 벌 추가다.
   *
   * ⚠ 기존 A 프레임에서는 정삼각이 이겨야 한다 (역삼각 패치는 코드 밖 배경을
   * 읽으므로 strictRate 가 낮다). 그 사실이 «동작 무변경» 의 근거이고
   * `test/turnA-detect.test.js` 가 그것을 잰다.
   *
   * `options.patchCells` 를 명시한 호출자는 방향 열거를 끄고 종전 그대로 간다 —
   * 좌표를 이미 정한 것이므로 방향을 추측하지 않는다.
   */
  const turnCandidates = Array.isArray(options.patchCells) ? [false] : [false, true];
  for (const k of ks) {
    const core = listCells(k, options);
    const patchesByTurn = turnCandidates.map((turn) => patchCells(k, options, turn));
    for (const orientation of orientations) {
      const coreMeasured = measureCells(luma, finder, k, orientation, core, options);
      const coreRate = coreMeasured.strictRate;
      for (let t = 0; t < turnCandidates.length; t += 1) {
        const turn = turnCandidates[t];
        const patchMeasured = measurePatch(
          luma, finder, k, orientation, patchesByTurn[t], options,
        );
        const patchRate = patchMeasured.strictRate;
        const score = TRI_SCORE_WEIGHTS.patch * patchRate
          + TRI_SCORE_WEIGHTS.core * coreRate
          + TRI_SCORE_WEIGHTS.finder * finder.score;
        measurements.push({
          k,
          orientation,
          turn,
          score,
          coreRate,
          patchRate,
          core: coreMeasured,
          patch: patchMeasured,
        });
      }
    }
  }
  const ordered = sortMeasurements(measurements);
  const best = ordered[0] || {
    k: undefined,
    orientation: undefined,
    turn: false,
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
    /** 실루엣 방향 — false = 정삼각(기존 A) · true = 역삼각(턴A). */
    turn: best.turn === true,
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
      selectedSize: { k: best.k, orientation: best.orientation, turn: best.turn === true },
    },
    hypothesisId: 'tri-' + best.k + '-' + best.orientation
      + (best.turn === true ? '-turn' : ''),
  });
}

/**
 * Type A/tri의 육각 코어 + 코어 밖 세 삼각 패치 연속성 점수.
 */
export function scoreTriTiling(luma, finder, options = {}) {
  return scoreTriInternal(luma, finder, options);
}

/**
 * star(Type K, 육각별) 패치 두 계열 — A 계열(top·BR·BL) = 정삼각 A 의 패치 그대로,
 * 반전 계열(bottom·TL·TR) = 그 180° 상. 합치면 hexagram 의 코어 밖 전부다.
 */
function starPatchSeries(k) {
  const aSeries = regionCellsA(k)
    .filter((cell) => hexDistance(cell.q, cell.r) > k)
    .map((cell) => ({ q: cell.q, r: cell.r }));
  return {
    aSeries,
    invSeries: aSeries.map((cell) => ({ q: -cell.q, r: -cell.r })),
  };
}

/**
 * star 채점의 k 목록 — **명시 opt-in 이다. 기본값은 «없음»(빈 배열)**.
 *
 * 왜 DEFAULT_KS 로 떨어지지 않는가 (2026-08-24 실측으로 고침):
 * K ⊃ A ⊃ O 포함 사슬 때문에 **교차-k 도플갱어**가 있다 — star k6 의 영역이
 * A k8 영역 안에 거의 전부 들어가서, A1 합성 프레임을 star k6 로 재면 코어·A 계열·
 * 반전 계열이 **전부 진짜 셀**이라 균형까지 통과하고 star 가 hard 로 선다
 * (`test/decoder-family.test.js` «tri 패치가 있으면 O를 hard 선택하지 않음» 이
 * 이것으로 tri → star 로 뒤집혔다). 즉 star 는 «자기 k 를 못 받으면 남의 k 로
 * 아무 프레임이나 양성» 이 되는 채점이다.
 *
 * hex 면적 모델의 `options.ks` 를 물려 쓰는 것도 안 된다 — K 총 셀이 같은 k 의
 * hex 의 약 2배라 체계적으로 어긋난다. 그래서 **호출자가 star 면적 모델로 고른
 * k 를 `starKs` 로 직접 줘야** 한다 (bootstrap.starClassificationDimensions).
 * 안 주면 star 가설 자체가 서지 않고 NO_GRID_HYPOTHESIS 로 남는다 —
 * 이 레인 이전의 classifyFamily 동작(= star 부재)과 바이트 동일하다.
 */
function normalizeStarKs(options) {
  if (!Array.isArray(options.starKs)) return [];
  const output = new Set();
  for (const value of options.starKs) {
    if (Number.isInteger(value) && value >= 4) output.add(value);
  }
  return Array.from(output).sort((a, b) => a - b);
}

function scoreStarInternal(luma, finderInput, options = {}) {
  const stats = validateLuma(luma);
  if (stats && stats.ok === false) return stats;
  const finder = normalizeFinder(finderInput);
  if (!finder) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { family: 'star', message: '불스아이 증거가 없다' });
  }
  // ⚠ k 목록은 hex 면적 모델의 options.ks 가 아니라 **starKs**(육각별 면적 모델 —
  // bootstrap.starClassificationDimensions)를 쓰고, **없으면 채점하지 않는다**
  // (normalizeStarKs 헤더 — 교차-k 도플갱어 때문에 기본 sweep 이 오양성이다).
  const ks = normalizeStarKs(options);
  if (ks.length === 0) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, { family: 'star', message: 'k 목록이 없다' });
  }
  const orientations = normalizeOrientation(options);
  const minPatchRate = Number.isFinite(options.minStarPatchRate)
    ? options.minStarPatchRate
    : DEFAULT_STAR_MIN_PATCH_RATE;
  const minCoreRate = Number.isFinite(options.minStarCoreRate)
    ? options.minStarCoreRate
    : DEFAULT_STAR_MIN_CORE_RATE;
  const balance = Number.isFinite(options.starPatchBalance)
    ? clamp01(options.starPatchBalance)
    : DEFAULT_STAR_PATCH_BALANCE;
  const measurements = [];
  for (const k of ks) {
    const core = listCells(k, {}); // 코어는 hex 와 같은 셀 — sampleCells 재정의 없이
    const { aSeries, invSeries } = starPatchSeries(k);
    for (const orientation of orientations) {
      const coreMeasured = measureCells(luma, finder, k, orientation, core, options);
      const aMeasured = measurePatch(luma, finder, k, orientation, aSeries, options);
      const invMeasured = measurePatch(luma, finder, k, orientation, invSeries, options);
      const coreRate = coreMeasured.strictRate;
      const aRate = aMeasured.strictRate;
      const invRate = invMeasured.strictRate;
      const score = STAR_SCORE_WEIGHTS.patch * ((aRate + invRate) / 2)
        + STAR_SCORE_WEIGHTS.core * coreRate
        + STAR_SCORE_WEIGHTS.finder * finder.score;
      measurements.push({
        k,
        orientation,
        score,
        coreRate,
        aRate,
        invRate,
        core: coreMeasured,
        aPatch: aMeasured,
        invPatch: invMeasured,
      });
    }
  }
  const ordered = sortMeasurements(measurements);
  const best = ordered[0] || {
    k: undefined, orientation: undefined, score: 0, coreRate: 0, aRate: 0, invRate: 0,
  };
  const finderCheck = finder.hardChecksPassed;
  const coreCheck = best.coreRate >= minCoreRate;
  const patchCheck = best.aRate >= minPatchRate && best.invRate >= minPatchRate;
  // 균형 — 두 계열이 서로의 balance 배 이상. 한쪽만 실코드(A 프레임 + 클러터)면
  // 여기서 떨어진다 (상수 주석의 오양성 방어 근거).
  const balanceCheck = best.invRate >= balance * best.aRate
    && best.aRate >= balance * best.invRate;
  return ok({
    family: 'star',
    finderKind: finder.kind,
    gridKind: 'hex-core-hexagram-patch',
    k: best.k,
    orientation: best.orientation,
    score: clamp01(best.score),
    hardChecks: {
      finder: finderCheck,
      coreTiling: coreCheck,
      patchTiling: patchCheck,
      patchBalance: balanceCheck,
      all: finderCheck && coreCheck && patchCheck && balanceCheck,
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
    hypothesisId: 'star-' + best.k + '-' + best.orientation,
  });
}

/**
 * Type K/star(육각별)의 육각 코어 + 코어 밖 여섯 삼각 패치(두 계열) 연속성 점수.
 * 검증 셀 좌표의 정본은 placementK(patchOfK)다 — 아래 로드 자기검증이 A 계열/반전
 * 계열 분해가 patchOfK 와 일치함을 잰다.
 */
export function scoreStarTiling(luma, finder, options = {}) {
  return scoreStarInternal(luma, finder, options);
}

// starPatchSeries 의 «A 계열 + 180° 상 = hexagram 코어 밖 전부» 주장을 로드 시점에
// 못 박는다 — 유도가 깨지면 star 채점이 조용히 다른 도형을 잰다.
{
  // ⚠ 이 검사의 k 는 **star 표(VERSIONS_K)** 에서 온다 — hex 의 DEFAULT_KS 가 아니다.
  //   원판은 DEFAULT_KS 를 빌려 썼는데 두 축의 k 계열이 같았기 때문에 안 보였을 뿐이고,
  //   V4(hex k=12) 편입으로 갈렸다. star 기하 주장을 hex 의 k 로 재면 그 순간부터
  //   «재는 대상이 그것이 아니다».
  for (const k of Array.from(new Set(VERSIONS_K.map((spec) => spec.k)))) {
    const { aSeries, invSeries } = starPatchSeries(k);
    const seen = new Set();
    for (const [series, wanted] of [[aSeries, ['top', 'BL', 'BR']], [invSeries, ['bottom', 'TL', 'TR']]]) {
      for (const cell of series) {
        const patch = patchOfK(cell.q, cell.r, k);
        if (!wanted.includes(patch)) {
          throw new Error('family: star 패치 분해가 patchOfK 와 다르다 — ('
            + cell.q + ',' + cell.r + ') → ' + patch);
        }
        seen.add(cell.q + ',' + cell.r);
      }
    }
    if (seen.size !== 6 * (k * (k + 1) / 2)) {
      throw new Error('family: star 패치 셀 수가 6·k(k+1)/2 이 아니다 — k=' + k + ' → ' + seen.size);
    }
  }
}

/**
 * Type Y의 육각 실루엣 + 중앙 Y 심 + 세 면 공변 격자 + 레퍼런스 네 조 점수.
 * 검출 실패를 불스아이 경로와 연결하지 않으며, tone/n/orientation 전 가설을 보존한다.
 */
export function scoreCubeTiling(luma, yJunction, options = {}) {
  // ⚠ **캐시 키를 만들기 전에** 정규화한다. `cubeTilingKeyMatches` 가 옵션을
  //   `Object.is` 로 비교하므로, 여기서 접지 않으면 «켜짐» 을 뜻하는 값이
  //   `undefined` 와 `true` 둘이 되어 같은 계산인데 캐시가 매번 빗나간다.
  const cubeOptions = normalizeCubeSurfaceDefault(options.cube && typeof options.cube === 'object'
    ? options.cube
    : options);
  const cacheLimit = cubeTilingCacheLimit(cubeOptions);
  const cached = cachedCubeTiling(luma, yJunction, cubeOptions);
  if (cached !== undefined) return cached;
  const computed = computeCubeTiling(luma, yJunction, cubeOptions);
  storeCubeTiling(luma, yJunction, cubeOptions, computed, cacheLimit);
  return computed;
}

/*
 * cube 타일링 결과 재사용 캐시.
 *
 * `detectCubeHypotheses` 는 Type Y 검출 전체(실루엣·심·레퍼런스 보정·호모그래피
 * 정제)를 돌린다. 실측상 **Type O 복호 시간의 46%** 가 여기인데, 한 복호에서
 * 같은 계산이 서너 번 돈다:
 *   · `enumerateGeometryHypotheses` 의 독립 평가
 *   · 같은 함수 안의 `classifyFamily` (여기 아래 `scoreCubeTiling` 호출)
 *   · 재배치 재시도 / finder 해상도 재시도가 그 둘을 다시 부른다
 *
 * 캐시가 안전한 이유: 결과는 (`luma`, `yJunction`, cube 경로가 실제로 읽는 옵션)의
 * 순수 함수다. `cube-detect.js` 가 options 에서 읽는 키는 `calibration` ·
 * `sample` · `disc` · `tones` · `exhaustiveBlockRecovery` · `enableLocatorY` ·
 * `enableCellSurfaceY`이고(중첩 호출의
 * `samplingConfig`도 여기서 파생된다), 나머지 bootstrap 전용 플래그는 이 경로에
 * 도달하지 않는다. 위 값들과 yJunction 은 `Object.is` 로 비교한다 — 객체면 동일성,
 * 원시값이면 값.
 * 다르면 그냥 다시 계산한다.
 *
 * 한 프레임에는 보통 기본 탐색과 `exhaustiveBlockRecovery` 탐색 두 키가 교대로
 * 등장한다. 한 칸만 두면 기본 → 전수 → 기본 순서에서 첫 기본 결과가 밀려나 같은
 * 전수 검출을 다시 한다. 두 칸 FIFO는 두 결과를 함께 보존하며, 프레임 객체가
 * 사라지면 WeakMap 항목도 함께 사라진다. `_cubeTilingCacheEntries: 1`은 FAILFAST
 * 전수 A/B에서 이전 한 칸 동작을 재현하는 계측 전용 스위치다.
 */
const cubeTilingCache = new WeakMap();

function cubeTilingCacheLimit(cubeOptions) {
  return cubeOptions._cubeTilingCacheEntries === 1 ? 1 : 2;
}

function cubeTilingKeyMatches(entry, yJunction, cubeOptions) {
  return Object.is(entry.yJunction, yJunction)
    && Object.is(entry.calibration, cubeOptions.calibration)
    && Object.is(entry.sample, cubeOptions.sample)
    && Object.is(entry.disc, cubeOptions.disc)
    && Object.is(entry.tones, cubeOptions.tones)
    && Object.is(entry.enableLocatorY, cubeOptions.enableLocatorY)
    && Object.is(entry.enableCellSurfaceY, cubeOptions.enableCellSurfaceY)
    && Object.is(entry.enableLegacyCellSurfaceV1, cubeOptions.enableLegacyCellSurfaceV1)
    && Object.is(entry.cellSurfaceLayout, cubeOptions.cellSurfaceLayout)
    && Object.is(entry.exhaustiveBlockRecovery, cubeOptions.exhaustiveBlockRecovery)
    && Object.is(entry.finderFirst, cubeOptions.finderFirst);
}

function cachedCubeTiling(luma, yJunction, cubeOptions) {
  if (luma === null || typeof luma !== 'object') return undefined;
  const entries = cubeTilingCache.get(luma);
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    if (cubeTilingKeyMatches(entry, yJunction, cubeOptions)) return entry.value;
  }
  return undefined;
}

function storeCubeTiling(luma, yJunction, cubeOptions, value, limit = 2) {
  if (luma === null || typeof luma !== 'object') return;
  const previous = cubeTilingCache.get(luma);
  const entries = Array.isArray(previous) ? previous.slice() : [];
  entries.push({
    yJunction,
    calibration: cubeOptions.calibration,
    sample: cubeOptions.sample,
    disc: cubeOptions.disc,
    tones: cubeOptions.tones,
    enableLocatorY: cubeOptions.enableLocatorY,
    enableCellSurfaceY: cubeOptions.enableCellSurfaceY,
    enableLegacyCellSurfaceV1: cubeOptions.enableLegacyCellSurfaceV1,
    cellSurfaceLayout: cubeOptions.cellSurfaceLayout,
    exhaustiveBlockRecovery: cubeOptions.exhaustiveBlockRecovery,
    finderFirst: cubeOptions.finderFirst,
    value,
  });
  while (entries.length > limit) entries.shift();
  cubeTilingCache.set(luma, entries);
}

/** FAILFAST 캐시 변이 자 전용. 복호 경로에서는 사용하지 않는다. */
export const FAILFAST_CACHE_TEST_ONLY = Object.freeze({
  cachedCubeTiling,
  cubeTilingCacheLimit,
  storeCubeTiling,
});

function computeCubeTiling(luma, yJunction, cubeOptions) {
  const detected = detectCubeHypotheses(luma, yJunction, cubeOptions);
  if (!detected.ok) return detected;

  const best = detected.hypotheses[0];
  const referenceCheck = best.referenceCalibration
    && best.referenceCalibration.hardChecks
    && best.referenceCalibration.hardChecks.all;
  const silhouetteCheck = best.shapeDiagnostics
    ? best.shapeDiagnostics.hardChecks.hexSilhouette
    : true;
  const junctionCheck = best.shapeDiagnostics
    ? best.shapeDiagnostics.hardChecks.yJunction
    : true;
  const geometryCheck = best.sizeGeometry
    && Number.isFinite(best.sizeGeometry.relativeVertexResidual);
  const all = Boolean(silhouetteCheck && junctionCheck && geometryCheck && referenceCheck);

  return ok({
    family: 'cube',
    finderKind: 'y-junction',
    gridKind: 'three-face-nxn',
    n: best.n,
    tones: best.tones,
    orientation: best.orientation,
    score: clamp01(
      0.35 * (Number.isFinite(best.shapeScore) ? best.shapeScore : 0.5)
      + 0.45 * best.referenceAgreement
      + 0.20 * (1 - clamp01(best.sizeGeometry.relativeVertexResidual)),
    ),
    hardChecks: {
      silhouette: Boolean(silhouetteCheck),
      yJunction: Boolean(junctionCheck),
      threeFaceGrid: Boolean(geometryCheck),
      referenceAnchors: Boolean(referenceCheck),
      all,
    },
    geometryHypotheses: detected.hypotheses,
    diagnostics: detected.diagnostics,
    hypothesisId: 'cube-' + best.n + '-' + best.orientation + '-t' + best.tones,
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
    && (candidate.family === 'hex' || candidate.family === 'tri' || candidate.family === 'cube')
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

function copyWithStarExclusion(candidate) {
  return {
    ...candidate,
    hardChecks: {
      ...candidate.hardChecks,
      starExclusion: false,
      all: false,
    },
    diagnostics: {
      ...(candidate.diagnostics || {}),
      starExclusion: 'star 경로의 두 계열 패치 양성 증거가 있어 부분 실루엣(hex/tri) 선택을 금지했다',
    },
  };
}

/**
 * star 를 빼고 tri>hex 배제만 적용했을 때 hard 로 남는 패밀리 **집합**(정렬).
 * 입력은 **배제 적용 전** 스냅샷이고, 여기서는 복사본만 만든다 (호출부의 배열·
 * 항목을 건드리지 않는다).
 */
function familiesWithoutStar(preStarHypotheses) {
  const candidates = preStarHypotheses.filter((candidate) => candidate.family !== 'star');
  const triPositive = candidates.some((candidate) => candidate.family === 'tri'
    && candidate.finderIndex !== undefined
    && candidate.hardChecks && candidate.hardChecks.all);
  const resolved = candidates.map((candidate) => {
    if (!triPositive || candidate.family !== 'hex') return candidate;
    const sameFinder = candidate.finderIndex === undefined
      || candidates.some((other) => other.family === 'tri'
        && other.finderIndex === candidate.finderIndex
        && other.hardChecks && other.hardChecks.all);
    return sameFinder ? copyWithPatchExclusion(candidate) : candidate;
  });
  return Array.from(new Set(resolved
    .filter((candidate) => candidate.hardChecks && candidate.hardChecks.all)
    .map((candidate) => candidate.family))).sort();
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
    // star(Type K) — K ⊃ A ⊃ O 포함 사슬이라 K 프레임에서는 hex·tri 도 양성이
    // 된다 (K 의 코어·A 계열 패치가 진짜 셀이므로). 그래서 star 를 같은 finder 에서
    // 독립 채점하고, 아래 배제 규칙이 포함 사슬을 위에서 아래로 정리한다.
    const star = scoreStarInternal(luma, finderInput, options);
    finderReports.push({
      finderIndex: i,
      hex,
      tri,
      star,
    });
    if (hex.ok === true) hypotheses.push({ ...hex, finderIndex: i });
    else reports.push({ finderIndex: i, family: 'hex', result: hex });
    if (tri.ok === true) hypotheses.push({ ...tri, finderIndex: i });
    else reports.push({ finderIndex: i, family: 'tri', result: tri });
    if (star.ok === true) hypotheses.push({ ...star, finderIndex: i });
    else reports.push({ finderIndex: i, family: 'star', result: star });
  }

  const cube = scoreCubeTiling(luma, normalizedEvidence.yJunction, options);
  if (cube.ok === true) hypotheses.push(cube);
  else reports.push({ family: 'cube', result: cube });

  // 배제 적용 **전** 스냅샷 — familyWithoutStar 가 읽는다 (copyWith* 는 항목을
  // 교체하지 실제로 바꾸지 않으므로 얕은 복사로 충분하다).
  const preStarHypotheses = hypotheses.slice();

  /*
   * star(K) 두 계열 패치가 양성인 같은 finder 에서 hex/tri 를 통과시키면 K 프레임이
   * FAMILY_AMBIGUOUS 로 죽거나 부분 실루엣(A) 도플갱어로 읽힌다 — tri>hex 배제와
   * 같은 포함-사슬 정리를 한 단 위(star>tri·hex)에서 반복한다. star 하드체크는
   * 반전 계열 + 균형까지 요구하므로 A/O 프레임에서는 서지 않는다 (배경/클러터가
   * 두 계열 균형 문턱을 동시에 넘어야 오발한다 — scoreStarInternal 상수 주석).
   */
  const starPositive = hypotheses.some((candidate) => candidate.family === 'star'
    && candidate.finderIndex !== undefined
    && candidate.hardChecks && candidate.hardChecks.all);
  if (starPositive) {
    for (let i = 0; i < hypotheses.length; i += 1) {
      const candidate = hypotheses[i];
      if (candidate.family !== 'hex' && candidate.family !== 'tri') continue;
      const sameFinder = candidate.finderIndex === undefined
        || hypotheses.some((other) => other.family === 'star'
          && other.finderIndex === candidate.finderIndex
          && other.hardChecks && other.hardChecks.all);
      if (sameFinder) hypotheses[i] = copyWithStarExclusion(candidate);
    }
  }

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
  const withoutStar = familiesWithoutStar(preStarHypotheses);
  const diagnostics = {
    finderCount: finders.length,
    finderReports,
    reports,
    cube,
    hypothesisCount: hypotheses.length,
    hardHypothesisCount: hard.length,
    hardFamilies: familySet,
    /**
     * star 가설이 **아예 없었다면** 이 프레임에 남았을 hard 패밀리 집합.
     * star 오양성이 기존 프레임의 평가 집합을 넓히지 못하게 하는 값이다 —
     * bootstrap 이 «star + 이 집합»(비면 base 의 body-validated-hex 폴백)만
     * 평가한다. 이게 없으면 star 가 서는 순간 hex·tri 가 **둘 다** 평가돼 base 가
     * 못 읽던 프레임이 우연히 살아난다 (실측: 투명 O trim 이 링 없이 읽혔다 —
     * 2026-08-24).
     */
    familiesWithoutStar: withoutStar,
    /** 위 집합이 유일할 때 그 이름, 아니면 null (진단·테스트 편의). */
    familyWithoutStar: withoutStar.length === 1 ? withoutStar[0] : null,
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
