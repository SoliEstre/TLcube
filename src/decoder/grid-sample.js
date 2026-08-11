/**
 * grid-sample.js — projective canonical 원판 기반의 격자 면 휘도 표본화
 *
 * 화면에서 원을 다시 그리지 않는다. 중심 원점·unit-cell canonical Euclidean
 * 면 원판을 H(canonical Euclidean → image pixel)로 보낸 뒤, image pixel center를
 * 역투영해 원판 포함 여부를 판정한다. axial 좌표나 canvas-origin scene 좌표를
 * H에 직접 넣지 않는다. 그래야
 * 원근 왜곡에서도 SPEC §7.2의 "면 내접원 50% 영역 median" 계약을 보존한다.
 */

import { FACES, cellSampleDiscs } from '../hexgrid.js';
import {
  FRONTEND_FAILURE,
  HOMOGRAPHY_CANONICAL_SPACE,
  assertHomography,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';

// [미검증] M1 calibration 에서 확정
export const MIN_DISC_SAMPLE_COUNT = 9;

// [미검증] M1 calibration 에서 확정
export const MIN_PROJECTED_MINOR_DIAMETER_PX = 3;

// [미검증] M1 calibration 에서 확정
export const MIN_OPAQUE_RATIO = 0.95;

// [미검증] M1 calibration 에서 확정
export const MIN_RANK_CONFIDENCE = 4;

// [미검증] M1 calibration 에서 확정
// 상대휘도에서 한 8-bit 단계보다 작은 간격은 현 단계에서 근접 동률로 취급한다.
// 실제 임계는 M1에서 camera pipeline의 노이즈와 함께 다시 정한다.
export const NEAR_TIE_EPSILON = 1 / 255;

// projective 분모의 0 근방은 수치 보정으로 숨기지 않는다. H가 샘플 원판을
// vanishing line과 교차시키면 그 가설은 사진상 표본을 정의할 수 없다.
const HOMOGENEOUS_EPSILON = 1e-12;

/*
 * 같은 LumaField 안에서는 H가 새 Float64Array로 재구성돼도 계수가 같으면 같은
 * 투영이다. 그래서 객체 정체성이 아니라 9개 계수와 원판/표본 설정으로 성공값을
 * 캐시한다. LumaField 자체가 WeakMap 경계라 서로 다른 프레임은 섞이지 않는다.
 */
const successfulDiscSamplesByLuma = new WeakMap();
const homographyCacheKeys = new WeakMap();

function cacheNumberKey(value) {
  return Object.is(value, -0) ? '-0' : String(value);
}

function homographyCacheKey(H) {
  const cached = homographyCacheKeys.get(H);
  if (cached !== undefined) return cached;
  let key = '';
  for (let i = 0; i < 9; i += 1) key += cacheNumberKey(H[i]) + '|';
  homographyCacheKeys.set(H, key);
  return key;
}

/*
 * config 세 값은 한 복호 안에서 거의 항상 같은데 `samplingConfig` 가 매번 새 객체를
 * 돌려주므로 객체 정체성으로는 캐시가 안 된다. 값 세 개를 `Object.is` 로 비교해
 * (NaN·-0 까지 정확히) 접미사 문자열만 재사용한다 — 키당 `String()` 6번이 3번이 된다.
 */
let lastConfigMinSampleCount = null;
let lastConfigMinProjectedMinorDiameter = null;
let lastConfigMinOpaqueRatio = null;
let lastConfigKeySuffix = null;

function configCacheKeySuffix(config) {
  const a = config.minSampleCount;
  const b = config.minProjectedMinorDiameter;
  const c = config.minOpaqueRatio;
  if (lastConfigKeySuffix !== null
    && Object.is(a, lastConfigMinSampleCount)
    && Object.is(b, lastConfigMinProjectedMinorDiameter)
    && Object.is(c, lastConfigMinOpaqueRatio)) {
    return lastConfigKeySuffix;
  }
  lastConfigMinSampleCount = a;
  lastConfigMinProjectedMinorDiameter = b;
  lastConfigMinOpaqueRatio = c;
  lastConfigKeySuffix = cacheNumberKey(a) + '|' + cacheNumberKey(b) + '|'
    + cacheNumberKey(c);
  return lastConfigKeySuffix;
}

function discCacheKey(disc, config) {
  return cacheNumberKey(disc.x) + '|' + cacheNumberKey(disc.y) + '|'
    + cacheNumberKey(disc.radius) + '|' + configCacheKeySuffix(config);
}

function successfulDiscCacheFor(luma, H) {
  let byHomography = successfulDiscSamplesByLuma.get(luma);
  if (byHomography === undefined) {
    byHomography = new Map();
    successfulDiscSamplesByLuma.set(luma, byHomography);
  }
  const hKey = homographyCacheKey(H);
  let samples = byHomography.get(hKey);
  if (samples === undefined) {
    samples = new Map();
    byHomography.set(hKey, samples);
  }
  return samples;
}

function cacheSuccessfulDiscSample(samples, key, result) {
  samples.set(key, {
    median: result.median,
    mad: result.mad,
    count: result.count,
    opaqueCount: result.opaqueCount,
    opaqueRatio: result.opaqueRatio,
    projectedMinorDiameter: result.projectedMinorDiameter,
    geometricCount: result.geometricCount,
  });
}

/*
 * 원판 표본은 셀마다 median과 MAD를 구한다. Float64Array scratch와 stable 순번을
 * 재사용해 전체 정렬과 임시 deviations 배열을 없앤다.
 */
let discValuesScratch = new Float64Array(0);
let medianValuesScratch = new Float64Array(0);
let medianOrderScratch = new Uint32Array(0);
let medianUseStableOrder = false;

function ensureDiscValuesScratch(length) {
  if (discValuesScratch.length >= length) return discValuesScratch;
  discValuesScratch = new Float64Array(length);
  return discValuesScratch;
}

function ensureMedianScratch(length) {
  if (medianValuesScratch.length >= length) return;
  medianValuesScratch = new Float64Array(length);
  medianOrderScratch = new Uint32Array(length);
}

function swapMedianScratch(left, right) {
  const value = medianValuesScratch[left];
  medianValuesScratch[left] = medianValuesScratch[right];
  medianValuesScratch[right] = value;
  const order = medianOrderScratch[left];
  medianOrderScratch[left] = medianOrderScratch[right];
  medianOrderScratch[right] = order;
}

function compareMedianScratch(left, right) {
  const leftValue = medianValuesScratch[left];
  const rightValue = medianValuesScratch[right];
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return medianOrderScratch[left] - medianOrderScratch[right];
}

function swapMedianValues(left, right) {
  const value = medianValuesScratch[left];
  medianValuesScratch[left] = medianValuesScratch[right];
  medianValuesScratch[right] = value;
}

function numericMedianMedianOfThree(left, middle, right) {
  const a = medianValuesScratch[left];
  const b = medianValuesScratch[middle];
  const c = medianValuesScratch[right];
  if (a < b) {
    if (b < c) return b;
    return a < c ? c : a;
  }
  if (a < c) return a;
  return b < c ? c : b;
}

function selectNumericMedianKth(length, rank) {
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    const pivot = numericMedianMedianOfThree(left, middle, right);
    let less = left;
    let scan = left;
    let greater = right;
    while (scan <= greater) {
      const value = medianValuesScratch[scan];
      if (value < pivot) {
        swapMedianValues(less, scan);
        less += 1;
        scan += 1;
      } else if (value > pivot) {
        swapMedianValues(scan, greater);
        greater -= 1;
      } else {
        scan += 1;
      }
    }
    if (rank < less) right = less - 1;
    else if (rank > greater) left = greater + 1;
    else return medianValuesScratch[rank];
  }
  return medianValuesScratch[left];
}

function selectMedianKth(length, rank) {
  return medianUseStableOrder
    ? selectStableMedianKth(length, rank)
    : selectNumericMedianKth(length, rank);
}
function selectStableMedianKth(length, rank) {
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (compareMedianScratch(left, middle) > 0) swapMedianScratch(left, middle);
    if (compareMedianScratch(left, right) > 0) swapMedianScratch(left, right);
    if (compareMedianScratch(middle, right) > 0) swapMedianScratch(middle, right);

    const pivotValue = medianValuesScratch[middle];
    const pivotOrder = medianOrderScratch[middle];
    let i = left;
    let j = right;
    while (i <= j) {
      while (
        medianValuesScratch[i] < pivotValue
        || (!(medianValuesScratch[i] > pivotValue) && medianOrderScratch[i] < pivotOrder)
      ) i += 1;
      while (
        medianValuesScratch[j] > pivotValue
        || (!(medianValuesScratch[j] < pivotValue) && medianOrderScratch[j] > pivotOrder)
      ) j -= 1;
      if (i <= j) {
        swapMedianScratch(i, j);
        i += 1;
        j -= 1;
      }
    }
    if (rank <= j) right = j;
    else if (rank >= i) left = i;
    else return medianValuesScratch[rank];
  }
  return medianValuesScratch[left];
}

function medianFromPreparedValues(length) {
  if (length === 0) throw new RangeError('median: 빈 표본');
  const middle = Math.floor(length / 2);
  const upper = selectMedianKth(length, middle);
  return length % 2 === 0
    ? (selectMedianKth(length, middle - 1) + upper) / 2
    : upper;
}

function median(values, length = values.length) {
  if (length === 0) throw new RangeError('median: 빈 표본');
  ensureMedianScratch(length);
  let stableOrder = false;
  for (let i = 0; i < length; i += 1) {
    const value = values[i];
    medianValuesScratch[i] = value;
    if (Number.isNaN(value) || (value === 0 && 1 / value === -Infinity)) stableOrder = true;
  }
  medianUseStableOrder = stableOrder;
  if (stableOrder) {
    for (let i = 0; i < length; i += 1) medianOrderScratch[i] = i;
  }
  return medianFromPreparedValues(length);
}

function mad(values, length, center) {
  ensureMedianScratch(length);
  medianUseStableOrder = false;
  for (let i = 0; i < length; i += 1) {
    medianValuesScratch[i] = Math.abs(values[i] - center);
  }
  return medianFromPreparedValues(length);
}

function assertOptionalAlpha(luma) {
  if (luma.alpha === null || luma.alpha === undefined) return;
  if (!(luma.alpha instanceof Uint8Array) || luma.alpha.length !== luma.width * luma.height) {
    throw new TypeError('LumaField.alpha 는 null 또는 width*height 길이 Uint8Array 여야 한다');
  }
}

function finitePositive(value, label, allowZero = false) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(label + '는 ' + (allowZero ? '0 이상의 유한수' : '양의 유한수') + '여야 한다: ' + value);
  }
  return value;
}

function integerAtLeast(value, label, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(label + '는 ' + minimum + ' 이상의 정수여야 한다: ' + value);
  }
  return value;
}

function firstDefined(options, names, fallback) {
  for (const name of names) {
    if (options[name] !== undefined) return options[name];
  }
  return fallback;
}

function samplingConfig(options = {}) {
  const minSampleCount = firstDefined(
    options,
    ['minSampleCount', 'minimumSampleCount', 'minCount'],
    MIN_DISC_SAMPLE_COUNT,
  );
  const minProjectedMinorDiameter = firstDefined(
    options,
    ['minProjectedMinorDiameter', 'minProjectedMinorDiameterPx', 'minMinorDiameter'],
    MIN_PROJECTED_MINOR_DIAMETER_PX,
  );
  const minOpaqueRatio = firstDefined(
    options,
    ['minOpaqueRatio', 'minimumOpaqueRatio'],
    MIN_OPAQUE_RATIO,
  );

  integerAtLeast(minSampleCount, 'minSampleCount', 1);
  finitePositive(minProjectedMinorDiameter, 'minProjectedMinorDiameter', true);
  if (!Number.isFinite(minOpaqueRatio) || minOpaqueRatio <= 0 || minOpaqueRatio > 1) {
    throw new RangeError('minOpaqueRatio 는 (0, 1] 범위여야 한다: ' + minOpaqueRatio);
  }

  return { minSampleCount, minProjectedMinorDiameter, minOpaqueRatio };
}

/**
 * 호모그래피의 전체 배율은 투영 결과에 영향을 주지 않는다. 역행렬 판정 전에
 * 가장 큰 계수를 1로 맞춰, 정상 H가 단순한 스케일 선택 때문에 0으로 보이는
 * 일을 막는다.
 */
function normalizeHomographyScale(H) {
  let scale = 0;
  for (let i = 0; i < H.length; i += 1) scale = Math.max(scale, Math.abs(H[i]));
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const normalized = new Float64Array(9);
  for (let i = 0; i < H.length; i += 1) normalized[i] = H[i] / scale;
  return normalized;
}

function invertHomographyInternal(H) {
  const a = H[0];
  const b = H[1];
  const c = H[2];
  const d = H[3];
  const e = H[4];
  const f = H[5];
  const g = H[6];
  const h = H[7];
  const i = H[8];

  const c00 = e * i - f * h;
  const c01 = c * h - b * i;
  const c02 = b * f - c * e;
  const c10 = f * g - d * i;
  const c11 = a * i - c * g;
  const c12 = c * d - a * f;
  const c20 = d * h - e * g;
  const c21 = b * g - a * h;
  const c22 = a * e - b * d;
  const determinant = a * c00 + b * c10 + c * c20;

  if (!Number.isFinite(determinant) || Math.abs(determinant) <= HOMOGENEOUS_EPSILON) {
    return null;
  }

  return new Float64Array([
    c00 / determinant, c01 / determinant, c02 / determinant,
    c10 / determinant, c11 / determinant, c12 / determinant,
    c20 / determinant, c21 / determinant, c22 / determinant,
  ]);
}

function projectPoint(H, x, y) {
  const numeratorX = H[0] * x + H[1] * y + H[2];
  const numeratorY = H[3] * x + H[4] * y + H[5];
  const denominator = H[6] * x + H[7] * y + H[8];
  const denominatorScale = Math.max(
    1,
    Math.abs(H[6] * x) + Math.abs(H[7] * y) + Math.abs(H[8]),
  );

  if (!Number.isFinite(denominator) || Math.abs(denominator) <= HOMOGENEOUS_EPSILON * denominatorScale) {
    return null;
  }

  const imageX = numeratorX / denominator;
  const imageY = numeratorY / denominator;
  if (!Number.isFinite(imageX) || !Number.isFinite(imageY)) return null;
  return { x: imageX, y: imageY };
}

/**
 * canonical 원판 중심의 local Jacobian으로 투영된 짧은 축 지름을 근사한다.
 * 이 값은 "얇아져 실제 픽셀 표본이 불안정한가"를 판정하는 진단이며, 원판 경계를
 * 화면 원으로 근사하는 용도가 아니다.
 */
function projectedMinorDiameter(H, disc) {
  const x = disc.x;
  const y = disc.y;
  const numeratorX = H[0] * x + H[1] * y + H[2];
  const numeratorY = H[3] * x + H[4] * y + H[5];
  const denominator = H[6] * x + H[7] * y + H[8];
  const denominatorScale = Math.max(
    1,
    Math.abs(H[6] * x) + Math.abs(H[7] * y) + Math.abs(H[8]),
  );
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= HOMOGENEOUS_EPSILON * denominatorScale) {
    return 0;
  }

  const denominatorSquared = denominator * denominator;
  const j00 = (H[0] * denominator - H[6] * numeratorX) / denominatorSquared;
  const j01 = (H[1] * denominator - H[7] * numeratorX) / denominatorSquared;
  const j10 = (H[3] * denominator - H[6] * numeratorY) / denominatorSquared;
  const j11 = (H[4] * denominator - H[7] * numeratorY) / denominatorSquared;

  const trace = j00 * j00 + j01 * j01 + j10 * j10 + j11 * j11;
  const determinant = j00 * j11 - j01 * j10;
  const discriminant = Math.max(0, trace * trace - 4 * determinant * determinant);
  const smallestEigenvalue = Math.max(0, (trace - Math.sqrt(discriminant)) / 2);
  return 2 * disc.radius * Math.sqrt(smallestEigenvalue);
}

function validateDisc(disc) {
  if (!disc || typeof disc !== 'object') throw new TypeError('disc 는 {x, y, radius} 객체여야 한다');
  finitePositive(disc.radius, 'disc.radius');
  if (!Number.isFinite(disc.x) || !Number.isFinite(disc.y)) {
    throw new RangeError('disc 중심은 유한해야 한다');
  }
  return disc;
}

function homographyForGeometry(geometry) {
  if (geometry instanceof Float64Array) return geometry;
  if (!geometry || typeof geometry !== 'object') {
    throw new TypeError('geometry 는 H를 가진 객체 또는 Homography 여야 한다');
  }
  if (geometry.canonicalSpace !== undefined
    && geometry.canonicalSpace !== HOMOGRAPHY_CANONICAL_SPACE) {
    throw new TypeError(
      'geometry.canonicalSpace 계약 불일치: '
      + geometry.canonicalSpace + ' !== ' + HOMOGRAPHY_CANONICAL_SPACE,
    );
  }
  return geometry.H || geometry.homography;
}

function assertNoCanonicalLayoutOverride(geometry, options) {
  const geometryHasLayout = geometry
    && typeof geometry === 'object'
    && !(geometry instanceof Float64Array)
    && (geometry.layout !== undefined || geometry.canonicalLayout !== undefined);
  if (geometryHasLayout || options.layout !== undefined) {
    throw new TypeError(
      'canonical layout override는 금지다. H는 중심 원점·셀 외접반지름 1인 '
      + HOMOGRAPHY_CANONICAL_SPACE + '에서 image pixel로 가야 한다',
    );
  }
}

function discOptions(options) {
  const nested = options.discOptions;
  if (nested !== undefined && (nested === null || typeof nested !== 'object')) {
    throw new TypeError('discOptions 는 객체여야 한다');
  }
  return nested || options;
}

function sampleOptions(options) {
  const nested = options.sampleOptions;
  if (nested !== undefined && (nested === null || typeof nested !== 'object')) {
    throw new TypeError('sampleOptions 는 객체여야 한다');
  }
  return nested ? { ...options, ...nested } : options;
}

function faceStats(face) {
  if (!face || typeof face !== 'object') throw new TypeError('FaceSample 이 아니다');
  if (!Number.isFinite(face.median) || !Number.isFinite(face.mad)) {
    throw new TypeError('FaceSample.median 과 mad 는 유한수여야 한다');
  }
  integerAtLeast(face.count, 'FaceSample.count', 0);
  return face;
}

/**
 * 투영된 canonical 원판의 pixel-center 전수 표본.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {Float64Array} H canonical → image
 * @param {{x:number,y:number,radius:number}} disc canonical 원판
 * @param {object} [options]
 * @returns {{ok:true,median:number,mad:number,count:number,opaqueCount:number,opaqueRatio:number,projectedMinorDiameter:number}|{ok:false,reason:string,detail:object}}
 */
export function sampleProjectedDisc(luma, H, disc, options = {}) {
  assertLumaField(luma);
  assertOptionalAlpha(luma);
  assertHomography(H);
  validateDisc(disc);
  const config = samplingConfig(options);
  // 조회와 저장이 같은 키·같은 Map 을 쓰도록 한 번만 만든다 (예전엔 두 번 만들었다).
  const discSamples = successfulDiscCacheFor(luma, H);
  const discKey = discCacheKey(disc, config);
  const cached = discSamples.get(discKey);
  if (cached !== undefined) return ok(cached);

  const normalizedH = normalizeHomographyScale(H);
  if (normalizedH === null) {
    return fail(FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE, {
      stage: 'sample-projected-disc',
      cause: 'zero-scale-homography',
    });
  }
  const inverseH = invertHomographyInternal(normalizedH);
  if (inverseH === null) {
    return fail(FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE, {
      stage: 'sample-projected-disc',
      cause: 'non-invertible-homography',
    });
  }

  const corners = [
    { x: disc.x - disc.radius, y: disc.y - disc.radius },
    { x: disc.x + disc.radius, y: disc.y - disc.radius },
    { x: disc.x + disc.radius, y: disc.y + disc.radius },
    { x: disc.x - disc.radius, y: disc.y + disc.radius },
  ];
  const projectedCorners = [];
  for (const corner of corners) {
    const projected = projectPoint(normalizedH, corner.x, corner.y);
    if (projected === null) {
      return fail(FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE, {
        stage: 'sample-projected-disc',
        cause: 'disc-crosses-projective-horizon',
      });
    }
    projectedCorners.push(projected);
  }

  let minX = projectedCorners[0].x;
  let maxX = projectedCorners[0].x;
  let minY = projectedCorners[0].y;
  let maxY = projectedCorners[0].y;
  for (let index = 1; index < projectedCorners.length; index += 1) {
    const point = projectedCorners[index];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  // 설계 §9.2의 1px 확장. 포함 여부는 역투영 원판 검사만 결정하므로 여기의
  // 여유는 bbox 경계 반올림 누락을 막을 뿐 표본 영역을 넓히지 않는다.
  const projectedIntersectsImage = !(
    maxX < 0 || maxY < 0 || minX > luma.width || minY > luma.height
  );
  if (!projectedIntersectsImage) {
    return fail(FRONTEND_FAILURE.SYMBOL_CLIPPED, {
      stage: 'sample-projected-disc',
      cause: 'projected-disc-outside-image',
      projectedBounds: { minX, minY, maxX, maxY },
      imageBounds: { width: luma.width, height: luma.height },
    });
  }
  const x0 = Math.max(0, Math.floor(minX) - 1);
  const x1 = Math.min(luma.width - 1, Math.ceil(maxX) + 1);
  const y0 = Math.max(0, Math.floor(minY) - 1);
  const y1 = Math.min(luma.height - 1, Math.ceil(maxY) + 1);
  const radiusSquared = disc.radius * disc.radius;
  const values = ensureDiscValuesScratch((x1 - x0 + 1) * (y1 - y0 + 1));
  let valueCount = 0;
  let geometricCount = 0;
  let opaqueCount = 0;

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const canonical = projectPoint(inverseH, x + 0.5, y + 0.5);
      if (canonical === null) continue;
      const dx = canonical.x - disc.x;
      const dy = canonical.y - disc.y;
      if (dx * dx + dy * dy > radiusSquared) continue;

      geometricCount += 1;
      const dataIndex = y * luma.width + x;
      const alphaIsOpaque = luma.alpha === null || luma.alpha === undefined || luma.alpha[dataIndex] === 255;
      if (!alphaIsOpaque) continue;

      const value = luma.data[dataIndex];
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError('LumaField.data 는 0..1 유한 상대휘도여야 한다');
      }
      opaqueCount += 1;
      values[valueCount] = value;
      valueCount += 1;
    }
  }

  const minorDiameter = projectedMinorDiameter(normalizedH, disc);
  const opaqueRatio = geometricCount === 0 ? 0 : opaqueCount / geometricCount;
  const constraintsFailed = [];
  if (minorDiameter < config.minProjectedMinorDiameter) {
    constraintsFailed.push('projected-disc-too-small');
  }
  if (opaqueCount < config.minSampleCount) {
    constraintsFailed.push('insufficient-pixel-samples');
  }
  if (opaqueRatio < config.minOpaqueRatio) {
    constraintsFailed.push('insufficient-opaque-coverage');
  }
  if (constraintsFailed.length > 0) {
    return fail(FRONTEND_FAILURE.SAMPLE_STARVED, {
      stage: 'sample-projected-disc',
      cause: constraintsFailed[0],
      constraintsFailed,
      count: opaqueCount,
      geometricCount,
      opaqueCount,
      opaqueRatio,
      projectedMinorDiameter: minorDiameter,
      required: {
        minSampleCount: config.minSampleCount,
        minProjectedMinorDiameter: config.minProjectedMinorDiameter,
        minOpaqueRatio: config.minOpaqueRatio,
      },
    });
  }

  const sampleMedian = median(values, valueCount);
  const result = ok({
    median: sampleMedian,
    mad: mad(values, valueCount, sampleMedian),
    count: opaqueCount,
    opaqueCount,
    opaqueRatio,
    projectedMinorDiameter: minorDiameter,
    geometricCount,
  });
  cacheSuccessfulDiscSample(discSamples, discKey, result);
  return result;
}

/**
 * 세 면 통계로 rank confidence를 계산한다. tie와 confidence는 구분한다:
 * tie는 순서 자체가 충분히 분리됐는지, confidence는 원판 내부 변동(MAD)을
 * 고려해 그 순서를 신뢰할 수 있는지다.
 */
export function rankConfidence(faceSamples, options = {}) {
  if (!faceSamples || typeof faceSamples !== 'object') {
    throw new TypeError('faceSamples 는 T/L/R FaceSample 을 가진 객체여야 한다');
  }
  const rows = FACES.map((face, index) => {
    const value = faceStats(faceSamples[face]);
    return { face, index, median: value.median, mad: value.mad };
  });
  rows.sort((a, b) => a.median - b.median || a.index - b.index);

  const separation = Math.min(
    rows[1].median - rows[0].median,
    rows[2].median - rows[1].median,
  );
  const maxMad = Math.max(...rows.map((row) => row.mad), 1 / 255);
  const noise = 1.4826 * maxMad;
  const tieEpsilon = firstDefined(options, ['tieEpsilon', 'nearTieEpsilon'], NEAR_TIE_EPSILON);
  const minimumConfidence = firstDefined(
    options,
    ['minConfidence', 'minimumConfidence'],
    MIN_RANK_CONFIDENCE,
  );
  finitePositive(tieEpsilon, 'tieEpsilon', true);
  finitePositive(minimumConfidence, 'minConfidence', true);

  const ranks = {};
  rows.forEach((row, rank) => {
    ranks[row.face] = rank;
  });
  const tie = !(separation > tieEpsilon);
  const confidence = noise === 0 ? Infinity : separation / noise;

  return {
    order: rows.map((row) => row.face),
    ranks,
    separation,
    noise,
    confidence,
    tie,
    confident: !tie && confidence >= minimumConfidence,
  };
}

/**
 * 한 hex cell의 T/L/R canonical sample discs를 측정한다.
 *
 * geometry는 {H, canonicalSpace?} 또는 H를 받는다. canonical 평면은 항상
 * 중심 원점·s=1이며 layout override는 좌표 계약을 다시 갈라놓으므로 거부한다.
 */
export function sampleHexCell(luma, geometry, q, r, options = {}) {
  if (!Number.isInteger(q) || !Number.isInteger(r)) {
    throw new TypeError('q, r 은 정수 axial 좌표여야 한다');
  }
  assertLumaField(luma);
  assertNoCanonicalLayoutOverride(geometry, options);
  const H = homographyForGeometry(geometry);
  assertHomography(H);

  const discs = cellSampleDiscs(q, r, undefined, discOptions(options));
  const optionsForDisc = sampleOptions(options);
  const measured = {};
  const failures = [];

  // 세 면을 모두 시도한 뒤 종합 실패한다. 한 면의 결과만으로 나머지 표본을
  // 생략하면 진단이 입력 순서에 의존하고, 레퍼런스 보정의 원인을 잃는다.
  for (const face of FACES) {
    const result = sampleProjectedDisc(luma, H, discs[face], optionsForDisc);
    if (!result.ok) {
      failures.push({ face, reason: result.reason, detail: result.detail });
      continue;
    }
    measured[face] = {
      median: result.median,
      mad: result.mad,
      count: result.count,
    };
  }

  if (failures.length > 0) {
    const homographyOnly = failures.every(
      (entry) => entry.reason === FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE,
    );
    const clipped = failures.some(
      (entry) => entry.reason === FRONTEND_FAILURE.SYMBOL_CLIPPED,
    );
    return fail(
      homographyOnly
        ? FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE
        : clipped
          ? FRONTEND_FAILURE.SYMBOL_CLIPPED
          : FRONTEND_FAILURE.SAMPLE_STARVED,
      { stage: 'sample-hex-cell', q, r, failures },
    );
  }

  const rank = rankConfidence(measured, options);
  return ok({
    T: measured.T,
    L: measured.L,
    R: measured.R,
    separation: rank.separation,
    tie: rank.tie,
  });
}

function parseLayoutEntry(entry) {
  const key = entry[0];
  const metadata = entry[1];
  if (typeof key === 'string') {
    const match = /^(-?\d+),(-?\d+)$/.exec(key);
    if (!match) throw new TypeError('layoutMap 키는 "q,r" 정수 형식이어야 한다: ' + key);
    return { q: Number(match[1]) + 0, r: Number(match[2]) + 0, metadata };
  }
  if (key && typeof key === 'object' && Number.isInteger(key.q) && Number.isInteger(key.r)) {
    return { q: key.q + 0, r: key.r + 0, metadata };
  }
  throw new TypeError('layoutMap 키는 "q,r" 또는 {q,r}여야 한다');
}

function layoutEntries(layoutMap) {
  if (layoutMap instanceof Map) return [...layoutMap.entries()];
  if (Array.isArray(layoutMap)) return layoutMap.slice();
  if (layoutMap && typeof layoutMap === 'object') {
    // 일반 객체 입력도 허용하되, 객체 열거 순서에 결과가 흔들리지 않게 좌표 순서로
    // 정렬한다. 규범 layoutMap(Map)의 원래 삽입 순서는 그대로 보존한다.
    return Object.entries(layoutMap).sort((a, b) => {
      const left = parseLayoutEntry(a);
      const right = parseLayoutEntry(b);
      return left.q - right.q || left.r - right.r;
    });
  }
  throw new TypeError('layoutMap 은 Map, entry 배열, 또는 "q,r" 키 객체여야 한다');
}

/**
 * 레이아웃 맵의 모든 비-불스아이 셀을 결정적 순서로 표본화한다.
 * 성공 시 cells는 Map<"q,r", CellSample> 이다. 역할 정보는 입력 layoutMap이
 * 이미 소유하므로 CellSample 계약에 임의 필드를 섞지 않는다.
 */
export function sampleHexGrid(luma, geometry, layoutMap, options = {}) {
  assertLumaField(luma);
  const cells = new Map();
  const failures = [];
  let skippedBullseyes = 0;

  for (const entry of layoutEntries(layoutMap)) {
    const parsed = parseLayoutEntry(entry);
    if (parsed.metadata && parsed.metadata.role === 'bullseye') {
      skippedBullseyes += 1;
      continue;
    }

    const result = sampleHexCell(luma, geometry, parsed.q, parsed.r, options);
    const key = parsed.q + ',' + parsed.r;
    if (!result.ok) {
      failures.push({ key, q: parsed.q, r: parsed.r, reason: result.reason, detail: result.detail });
      continue;
    }
    cells.set(key, {
      T: result.T,
      L: result.L,
      R: result.R,
      separation: result.separation,
      tie: result.tie,
    });
  }

  if (failures.length > 0) {
    const homographyOnly = failures.every(
      (entry) => entry.reason === FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE,
    );
    const clipped = failures.some(
      (entry) => entry.reason === FRONTEND_FAILURE.SYMBOL_CLIPPED,
    );
    return fail(
      homographyOnly
        ? FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE
        : clipped
          ? FRONTEND_FAILURE.SYMBOL_CLIPPED
          : FRONTEND_FAILURE.SAMPLE_STARVED,
      {
        stage: 'sample-hex-grid',
        sampledCount: cells.size,
        skippedBullseyes,
        failures,
      },
    );
  }

  return ok({
    cells,
    sampledCount: cells.size,
    skippedBullseyes,
  });
}
