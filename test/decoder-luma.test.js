/**
 * decoder-luma.test.js — decoder/luma.js의 상대휘도·알파·실패 계약.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  robustPercentiles,
  toRelativeLuminance,
} from '../src/decoder/luma.js';
import { FRONTEND_FAILURE } from '../src/decoder/contracts.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
  relativeLuminance,
} from '../src/luminance.js';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';

function assertLumaField(result) {
  assert.equal(result.ok, undefined, '성공 경로가 fail 객체를 반환했다');
  assert.ok(result.data instanceof Float32Array);
  assert.ok(result.alpha instanceof Uint8Array);
}

function paletteOf(name) {
  const preset = getPreset(name);
  return {
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

test('알려진 sRGB 색은 luminance.js 상대휘도와 Float32까지 일치한다', () => {
  const colors = [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
    { r: 255, g: 0, b: 0 },
    { r: 12, g: 128, b: 240 },
  ];
  const pixels = new Uint8ClampedArray(colors.flatMap((color) => [
    color.r, color.g, color.b, 255,
  ]));

  const luma = toRelativeLuminance({ width: 2, height: 2, pixels });
  assertLumaField(luma);

  for (let index = 0; index < colors.length; index += 1) {
    assert.equal(
      luma.data[index],
      Math.fround(relativeLuminance(colors[index])),
      '상대휘도 정의가 렌더러와 다르다: index=' + index,
    );
    assert.equal(luma.alpha[index], 255);
  }
});

test('투명 픽셀은 alpha에 보존되고 robust percentile의 배경 표본에서는 제외된다', () => {
  const raster = {
    width: 3,
    height: 1,
    pixels: new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      120, 0, 0, 0,
    ]),
  };

  const luma = toRelativeLuminance(raster);
  assertLumaField(luma);
  assert.deepEqual(Array.from(luma.alpha), [255, 255, 0]);

  const [p01, p99] = robustPercentiles(luma, [0.01, 0.99]);
  assert.equal(p01, 0, '투명 배경색이 저백분위에 섞이면 안 된다');
  assert.equal(p99, 1, '투명 배경색이 고백분위에 섞이면 안 된다');
});

test('전 픽셀이 투명이면 EMPTY_INPUT 실패를 반환한다', () => {
  const result = toRelativeLuminance({
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray([255, 0, 0, 0]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.EMPTY_INPUT);
  assert.equal(result.detail.opaquePixels, 0);
});

test('저동적범위 불투명 입력은 LUMA_DEGENERATE 실패를 반환한다', () => {
  const result = toRelativeLuminance({
    width: 2,
    height: 1,
    pixels: new Uint8ClampedArray([
      128, 128, 128, 255,
      128, 128, 128, 255,
    ]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.LUMA_DEGENERATE);
  assert.ok(result.detail.robustSpan < result.detail.threshold);
});

test('잘못된 RGBA 길이는 예외 대신 EMPTY_INPUT 실패를 반환한다', () => {
  const result = toRelativeLuminance({
    width: 2,
    height: 1,
    pixels: new Uint8ClampedArray([0, 0, 0, 255]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.EMPTY_INPUT);
  assert.equal(result.detail.issue, 'pixel-length-mismatch');
});

test('실제 인코더 렌더 래스터도 같은 luminance.js 정의로 변환한다', () => {
  const encoded = encode('luma fixture', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: paletteOf(DEFAULT_PRESET), cellSize: 2 });
  const raster = rasterize(scene, { pixelsPerUnit: 8, supersample: 2 });

  const luma = toRelativeLuminance(raster);
  assertLumaField(luma);
  assert.equal(luma.width, raster.width);
  assert.equal(luma.height, raster.height);

  // 좌상단은 scene margin 안의 불투명 배경이다. 생성기 산출물의 실제 픽셀을
  // luma.js 함수로 직접 재계산해 앞단이 별도 공식을 쓰지 않음을 고정한다.
  const expected = Math.fround(relativeLuminance({
    r: raster.pixels[0],
    g: raster.pixels[1],
    b: raster.pixels[2],
  }));
  assert.equal(luma.data[0], expected);
  assert.equal(luma.alpha[0], raster.pixels[3]);
});

test('같은 입력의 LumaField와 robust percentile은 완전히 결정적이다', () => {
  const raster = {
    width: 2,
    height: 2,
    pixels: new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]),
  };
  const first = toRelativeLuminance(raster);
  const second = toRelativeLuminance(raster);
  assertLumaField(first);
  assertLumaField(second);

  assert.deepEqual(Array.from(first.data), Array.from(second.data));
  assert.deepEqual(Array.from(first.alpha), Array.from(second.alpha));
  assert.deepEqual(
    robustPercentiles(first, [0.01, 0.5, 0.99]),
    robustPercentiles(second, [0.01, 0.5, 0.99]),
  );
});
