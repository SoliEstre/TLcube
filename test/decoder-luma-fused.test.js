/**
 * 카메라의 선택적 백분위 지연·opaque count 통합을 이전 세 번 순회와 대조해요.
 * 참조 함수는 885edc6의 luma.js에서 가져오며 제품 변환기를 호출하지 않아요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { robustPercentiles, toRelativeLuminance, DEFAULT_ROBUST_QUANTILES, LOW_DYNAMIC_RANGE_MIN } from '../src/decoder/luma.js';
import { relativeLuminance8 } from '../src/luminance.js';
import { FRONTEND_FAILURE, assertLumaField, fail } from '../src/decoder/contracts.js';

function invalidRaster(issue, detail = {}) {
  return fail(FRONTEND_FAILURE.EMPTY_INPUT, { issue, ...detail });
}

function opaqueSampleCount(luma) {
  if (luma.alpha === null || luma.alpha === undefined) return luma.data.length;
  let count = 0;
  for (let i = 0; i < luma.alpha.length; i += 1) {
    if (luma.alpha[i] !== 0) count += 1;
  }
  return count;
}

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

function legacyToRelativeLuminance(raster, options = {}) {
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

function bytes(view) { return new Uint8Array(view.buffer, view.byteOffset, view.byteLength); }
function compare(raster, options) {
  const expected = legacyToRelativeLuminance(raster, options);
  const actual = toRelativeLuminance(raster, options);
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  if (expected.ok === false) assert.deepEqual(actual, expected);
  else {
    assert.equal(actual.width, expected.width);
    assert.equal(actual.height, expected.height);
    assert.ok(actual.data instanceof Float32Array);
    assert.ok(actual.alpha instanceof Uint8Array);
    assert.deepEqual(bytes(actual.data), bytes(expected.data));
    assert.deepEqual(bytes(actual.alpha), bytes(expected.alpha));
    assert.notEqual(actual.data.buffer, raster.pixels.buffer);
    assert.notEqual(actual.alpha.buffer, raster.pixels.buffer);
  }
  return actual;
}
function randomRaster(count, alphaValues) {
  const pixels = new Uint8ClampedArray(count * 4);
  let seed = 0x5a17c9;
  for (let i = 0; i < count; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels.set([seed >>> 24, seed >>> 16 & 255, seed >>> 8 & 255, alphaValues[i % alphaValues.length]], i * 4);
  }
  return { width: count, height: 1, pixels };
}
function fresh(field) {
  return { width: field.width, height: field.height, data: field.data.slice(), alpha: field.alpha?.slice() ?? null };
}

test('불투명·부분 알파·투명 RGB를 포함한 RGBA 입력은 구 3-pass와 바이트 동일해요', () => {
  for (const alphas of [[255], [1], [127], [254], [0, 1, 127, 254, 255]]) {
    const raster = randomRaster(4096, alphas);
    const before = raster.pixels.slice();
    for (const options of [undefined, { rejectLowDynamicRange: false }]) compare(raster, options);
    assert.deepEqual(raster.pixels, before, '입력 RGBA를 수정하면 안 돼요');
  }
});

test('histogram은 Float64 대입식 반환값이 아니라 Float32 저장 후 bin을 사용해요', () => {
  const rgb = [193, 125, 238];
  const raw = relativeLuminance8(...rgb);
  assert.equal(Math.floor(raw * 4096), 1317);
  assert.equal(Math.floor(Math.fround(raw) * 4096), 1318);
  const raster = { width: 3, height: 1, pixels: new Uint8ClampedArray([...rgb, 1, 0, 0, 0, 0, 255, 255, 255, 0]) };
  const result = compare(raster, { rejectLowDynamicRange: false });
  assert.deepEqual(robustPercentiles(result, [0, 0.01, 0.5, 0.99, 1]), Array(5).fill(1318 / 4095));
  assert.deepEqual(robustPercentiles(result), robustPercentiles(fresh(result)));
});

test('EMPTY_INPUT의 입력 검증 순서·모든 alpha=0과 오류 detail이 그대로예요', () => {
  const valid = randomRaster(2, [255]);
  const cases = [
    [undefined], [null], [false], [{}],
    [{ width: 0, height: 1, pixels: new Uint8ClampedArray() }],
    [{ width: 1.5, height: 1, pixels: new Uint8ClampedArray() }],
    [{ width: Number.MAX_SAFE_INTEGER, height: 2, pixels: new Uint8ClampedArray() }],
    [{ width: 1, height: 1, pixels: new Uint8Array(4) }],
    [{ width: 1, height: 1, pixels: new Uint8ClampedArray(3) }],
    [valid, null], [valid, 3], [valid, { lowDynamicRangeThreshold: NaN }],
    [valid, { lowDynamicRangeThreshold: Infinity }], [valid, { lowDynamicRangeThreshold: -0.1 }],
    [valid, { lowDynamicRangeThreshold: 1.1 }],
    [valid, { rejectLowDynamicRange: false, lowDynamicRangeThreshold: NaN }],
    [valid, { rejectLowDynamicRange: false, lowDynamicRangeThreshold: -0.1 }],
    [valid, { rejectLowDynamicRange: false, lowDynamicRangeThreshold: 1.1 }],
    [randomRaster(11, [0])], [randomRaster(11, [0]), { rejectLowDynamicRange: false }],
  ];
  for (const [raster, options] of cases) {
    const actual = compare(raster, options);
    assert.equal(actual.reason, FRONTEND_FAILURE.EMPTY_INPUT);
  }
  assert.deepEqual(compare(randomRaster(11, [0])), {
    ok: false, reason: FRONTEND_FAILURE.EMPTY_INPUT, detail: { stage: 'luma', opaquePixels: 0 },
  });
});

test('LUMA_DEGENERATE의 전체 detail과 정확한 span 경계·reject 옵션을 보존해요', () => {
  const raster = { width: 5, height: 1, pixels: new Uint8ClampedArray([
    127,127,127,1, 140,140,140,254, 127,127,127,255, 140,140,140,127, 0,0,0,0,
  ]) };
  const field = compare(raster, { rejectLowDynamicRange: false });
  const [lo, , hi] = robustPercentiles(field);
  const span = hi - lo;
  for (const threshold of [0, span - Number.EPSILON, span, span + Number.EPSILON, 1]) {
    for (const rejectLowDynamicRange of [undefined, true, false, 1, null]) {
      const result = compare(raster, { lowDynamicRangeThreshold: threshold, rejectLowDynamicRange });
      const reject = (rejectLowDynamicRange === undefined || rejectLowDynamicRange === true) && span < threshold;
      assert.equal(result.ok === false, reject);
      if (reject) assert.equal(result.detail.opaquePixels, 4);
    }
  }
  const uniform = { width: 1, height: 1, pixels: new Uint8ClampedArray([128,128,128,255]) };
  assert.equal(compare(uniform).reason, FRONTEND_FAILURE.LUMA_DEGENERATE);
  assert.ok(compare(uniform, { lowDynamicRangeThreshold: 0 }).data instanceof Float32Array);
});

test('즉시·지연 histogram과 새 LumaField의 임의 quantile·캐시 재사용이 동일해요', () => {
  for (const options of [undefined, { rejectLowDynamicRange: false }]) {
    // LumaField는 기존 계약대로 불변으로 취급해요. 외부 변경은 캐시 계약 밖이에요.
    const field = compare(randomRaster(4096, [0,1,254,255]), options);
    const untouched = fresh(field);
    const requests = [undefined, [0,1], [1,0,0.99,0.005,0.995,0.5,0.5], new Float32Array([1,0.5,0]), new Float64Array([0.005,0.995])];
    for (let pass = 0; pass < 3; pass += 1) {
      for (const q of requests) assert.deepEqual(robustPercentiles(field, q), robustPercentiles(untouched, q));
    }
    for (const q of [null, [], [NaN], [-1], [1.01], '0.5', new DataView(new ArrayBuffer(8))]) {
      assert.equal(robustPercentiles(field, q), null);
      assert.equal(robustPercentiles(untouched, q), null);
    }
    // 공개 함수가 돌려준 배열을 호출자가 바꿔도 캐시 내부를 바꾸지는 못해요.
    const values = robustPercentiles(field, [0,1]);
    values.fill(-7);
    assert.deepEqual(robustPercentiles(field, [0,1]), robustPercentiles(untouched, [0,1]));
  }
});

test('외부 LumaField의 alpha-null·invalid 표본·투명 제외 계약은 그대로예요', () => {
  const field = { width: 3, height: 1, data: new Float32Array([NaN, 0, 1]), alpha: new Uint8Array([0, 1, 254]) };
  assert.deepEqual(robustPercentiles(field, [0,1]), [0,1]);
  assert.equal(robustPercentiles({ ...field, alpha: null }), null);
  assert.equal(robustPercentiles({ ...field, alpha: new Uint8Array(2) }), null);
  assert.equal(robustPercentiles({ ...field, alpha: new Uint8Array(3) }), null);
  for (const value of [NaN, Infinity, -0.01, 1.01]) {
    assert.equal(robustPercentiles({ width: 1, height: 1, data: new Float32Array([value]), alpha: null }), null);
  }
  for (const alpha of [null, undefined]) {
    assert.deepEqual(robustPercentiles({ width: 2, height: 1, data: new Float32Array([0,1]), alpha }, [0,1]), [0,1]);
  }
});
