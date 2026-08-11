/**
 * luma.js — 입력 RGBA를 디코더 공통 상대휘도 필드로 변환한다.
 *
 * 상대휘도는 이 단계에서 한 번만 계산한다. 이후 검출기와 샘플러가 서로 다른
 * 회색조 공식을 쓰면, 같은 셀을 두고도 서로 다른 순위 결론에 이를 수 있기
 * 때문이다. 따라서 계산은 반드시 ../luminance.js의 relativeLuminance 경유로
 * 한다. 그 함수가 같은 모듈의 srgbChannelToLinear를 호출하므로, sRGB 전이
 * 함수도 렌더러와 정확히 하나의 구현을 공유한다.
 *
 * @module decoder/luma
 */

import { relativeLuminance8 } from '../luminance.js';
import {
  FRONTEND_FAILURE,
  assertLumaField,
  fail,
} from './contracts.js';

/** 설계 §4.2: 전체 정렬 대신 고정 histogram으로 percentile을 근사한다. */
export const PERCENTILE_HISTOGRAM_BINS = 4096;

/** 설계 §4.1의 robust range 항목 순서. */
export const DEFAULT_ROBUST_QUANTILES = Object.freeze([0.01, 0.5, 0.99]);

// [미검증] M1 calibration 에서 확정: 설계 §4.3의 초기 저동적범위 조기 실패값이다.
export const LOW_DYNAMIC_RANGE_MIN = 0.08;

/**
 * RasterRGBA의 API 오류도 앞단 예외로 흘리지 않는다. contracts.js에 별도
 * INVALID_RASTER 코드가 아직 없으므로 EMPTY_INPUT의 detail에 정확한 원인을 남긴다.
 * @param {string} issue
 * @param {object} [detail]
 */
function invalidRaster(issue, detail = {}) {
  return fail(FRONTEND_FAILURE.EMPTY_INPUT, { issue, ...detail });
}

/**
 * LumaField는 alpha를 Uint8Array로 약속하지만 assertLumaField는 data 중심의
 * 최소 검사만 한다. percentile 계산 전에 alpha의 길이도 함께 확인해야 투명
 * 마스크가 한 픽셀씩 밀리는 조용한 오류를 막을 수 있다.
 * @param {object} luma
 * @returns {boolean}
 */
function hasValidLumaField(luma) {
  try {
    assertLumaField(luma);
  } catch {
    return false;
  }

  return (
    luma.alpha === null
    || luma.alpha === undefined
    || (luma.alpha instanceof Uint8Array && luma.alpha.length === luma.data.length)
  );
}

/**
 * 입력 quantile을 결정적으로 정규화한다.
 * @param {readonly number[] | ArrayLike<number> | undefined} quantiles
 * @returns {number[] | null}
 */
function normalizeQuantiles(quantiles) {
  const source = quantiles === undefined ? DEFAULT_ROBUST_QUANTILES : quantiles;
  if (
    !Array.isArray(source)
    && !(typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(source))
  ) {
    return null;
  }

  const normalized = Array.from(source);
  if (normalized.length === 0) return null;
  for (const quantile of normalized) {
    if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) return null;
  }
  return normalized;
}

/**
 * alpha=0은 배경 마스크다. RGB가 남아 있어도 합성 배경을 추측하지 않으므로
 * robust range의 표본으로 세지 않는다. alpha가 null이면 모든 표본이 유효하다.
 * @param {{data: Float32Array, alpha: Uint8Array | null | undefined}} luma
 * @returns {number}
 */
function opaqueSampleCount(luma) {
  if (luma.alpha === null || luma.alpha === undefined) return luma.data.length;
  let count = 0;
  for (let i = 0; i < luma.alpha.length; i += 1) {
    if (luma.alpha[i] !== 0) count += 1;
  }
  return count;
}

/*
 * histogram 은 quantile 과 무관하다 — 같은 LumaField 면 같은 표다.
 *
 * 한 복호에서 `robustPercentiles` 는 최소 두 번 불린다(`toRelativeLuminance` 의
 * 동적범위 검사, `outlineEvidence` 의 전경 임계값). 그때마다 전 픽셀을 다시 훑을
 * 이유가 없다. grid-sample 의 표본 캐시와 같은 «LumaField = 불변» 전제를 따른다.
 */
const percentileHistogramCache = new WeakMap();
const PERCENTILE_HISTOGRAM_INVALID = Object.freeze({ invalid: true });

function percentileHistogram(luma) {
  const cached = percentileHistogramCache.get(luma);
  if (cached !== undefined) return cached;

  const histogram = new Uint32Array(PERCENTILE_HISTOGRAM_BINS);
  const { data, alpha } = luma;
  const length = data.length;
  const hasAlpha = alpha !== null && alpha !== undefined;
  let validCount = 0;
  let computed = null;

  // 픽셀마다 `alpha !== null && alpha !== undefined` 를 재평가하지 않도록 밖으로 뺐다.
  // bin 은 `Math.min(BINS-1, Math.floor(value * BINS))` 와 같다 — 바로 위에서 value 가
  // 유한하고 0..1 임을 확인했으므로 `| 0` 이 곧 floor 다 (음수·2^31 초과가 없다).
  for (let i = 0; i < length; i += 1) {
    if (hasAlpha && alpha[i] === 0) continue;
    const value = data[i];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      computed = PERCENTILE_HISTOGRAM_INVALID;
      break;
    }

    const scaled = value * PERCENTILE_HISTOGRAM_BINS;
    const bin = scaled >= PERCENTILE_HISTOGRAM_BINS - 1
      ? PERCENTILE_HISTOGRAM_BINS - 1
      : scaled | 0;
    histogram[bin] += 1;
    validCount += 1;
  }

  if (computed === null) {
    computed = validCount === 0
      ? PERCENTILE_HISTOGRAM_INVALID
      : { histogram, validCount };
  }
  percentileHistogramCache.set(luma, computed);
  return computed;
}

/**
 * 고정 4096-bin histogram percentile. 반환 순서는 요청 quantile 순서와 같다.
 *
 * bin의 하한을 반환해 0과 1이라는 계약 경계값을 정확히 보존한다. 이 방식의
 * 최대 양자화 오차는 1 / (4096 - 1)이고, 정렬 구현·브라우저 sort 안정성에
 * 의존하지 않는다.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {readonly number[] | ArrayLike<number>} quantiles
 * @returns {number[] | null}
 */
export function robustPercentiles(luma, quantiles = DEFAULT_ROBUST_QUANTILES) {
  if (!hasValidLumaField(luma)) return null;
  const requested = normalizeQuantiles(quantiles);
  if (requested === null) return null;

  const prepared = percentileHistogram(luma);
  if (prepared === PERCENTILE_HISTOGRAM_INVALID) return null;
  const { histogram, validCount } = prepared;

  const ranks = requested.map((quantile) => Math.max(1, Math.ceil(quantile * validCount)));
  const results = new Array(requested.length);
  const unresolved = new Set(results.keys());
  let cumulative = 0;

  for (let bin = 0; bin < histogram.length && unresolved.size > 0; bin += 1) {
    cumulative += histogram[bin];
    for (const index of Array.from(unresolved)) {
      if (cumulative >= ranks[index]) {
        results[index] = bin / (PERCENTILE_HISTOGRAM_BINS - 1);
        unresolved.delete(index);
      }
    }
  }

  return results;
}

/**
 * 옵션의 미지/오류를 LumaField 생성 전 결정적으로 해석한다.
 * @param {object} options
 * @returns {{rejectLowDynamicRange:boolean, lowDynamicRangeThreshold:number} | null}
 */
function normalizeOptions(options) {
  if (options === null || typeof options !== 'object') return null;
  const rejectLowDynamicRange = options.rejectLowDynamicRange === undefined
    ? true
    : options.rejectLowDynamicRange === true;
  const lowDynamicRangeThreshold = options.lowDynamicRangeThreshold === undefined
    ? LOW_DYNAMIC_RANGE_MIN
    : options.lowDynamicRangeThreshold;

  if (
    !Number.isFinite(lowDynamicRangeThreshold)
    || lowDynamicRangeThreshold < 0
    || lowDynamicRangeThreshold > 1
  ) {
    return null;
  }

  return { rejectLowDynamicRange, lowDynamicRangeThreshold };
}

/**
 * RGBA 8-bit sRGB 래스터를 decoder/contracts.js의 LumaField로 바꾼다.
 *
 * 알파는 배경색으로 합성하지 않고 원값을 별도 버퍼에 보존한다. 후단의 면 표본은
 * alpha<255를 엄격히 거부할 수 있고, 탐색기는 alpha=0을 배경 마스크로 쓸 수 있다.
 *
 * @param {{width:number, height:number, pixels:Uint8ClampedArray}} raster
 * @param {{rejectLowDynamicRange?:boolean, lowDynamicRangeThreshold?:number}} [options]
 * @returns {import('./contracts.js').LumaField | {ok:false, reason:string, detail:object}}
 */
export function toRelativeLuminance(raster, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  if (normalizedOptions === null) return invalidRaster('invalid-options');
  if (!raster || typeof raster !== 'object') return invalidRaster('raster-not-object');

  const { width, height, pixels } = raster;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    return invalidRaster('invalid-dimensions', { width, height });
  }
  if (!Number.isSafeInteger(width * height)) {
    return invalidRaster('pixel-count-overflow', { width, height });
  }
  if (!(pixels instanceof Uint8ClampedArray)) {
    return invalidRaster('pixels-not-uint8clampedarray');
  }

  const pixelCount = width * height;
  if (pixels.length !== pixelCount * 4) {
    return invalidRaster('pixel-length-mismatch', {
      expected: pixelCount * 4,
      actual: pixels.length,
    });
  }

  const data = new Float32Array(pixelCount);
  const alpha = new Uint8Array(pixelCount);

  for (let pixelIndex = 0, offset = 0; pixelIndex < pixelCount; pixelIndex += 1, offset += 4) {
    // relativeLuminance8 은 relativeLuminance 와 같은 sRGB 표·계수·덧셈 순서를 쓴다.
    // 여기서 식을 다시 쓰지 않아 렌더러와 디코더의 sRGB 경계가 갈라질 가능성을 없앤다.
    // Uint8ClampedArray 원소는 항상 0..255 정수라 8비트 진입점의 전제가 성립한다.
    data[pixelIndex] = relativeLuminance8(
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
    );
    alpha[pixelIndex] = pixels[offset + 3];
  }

  const luma = { width, height, data, alpha };
  const percentiles = robustPercentiles(luma, DEFAULT_ROBUST_QUANTILES);
  const opaquePixels = opaqueSampleCount(luma);
  if (percentiles === null || opaquePixels === 0) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
      stage: 'luma',
      opaquePixels,
    });
  }

  const [p01, p50, p99] = percentiles;
  const robustSpan = p99 - p01;
  if (
    normalizedOptions.rejectLowDynamicRange
    && robustSpan < normalizedOptions.lowDynamicRangeThreshold
  ) {
    return fail(FRONTEND_FAILURE.LUMA_DEGENERATE, {
      stage: 'luma',
      p01,
      p50,
      p99,
      robustSpan,
      threshold: normalizedOptions.lowDynamicRangeThreshold,
      opaquePixels,
    });
  }

  // 반환 직전 계약 단언은 내부 변경이 alpha/data 정렬을 깨도 이 모듈 안에서
  // 드러나게 한다. 외부 입력 오류에는 위에서 이미 fail을 반환했다.
  assertLumaField(luma);
  return luma;
}
