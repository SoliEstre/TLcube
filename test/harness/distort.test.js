/**
 * distort.test.js — M1 왜곡 하네스의 결정성·경계·H1 단조성 검증.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  addGaussianNoise,
  applyGamma,
  applyJpegApproximation,
  applySCurve,
  applyVignette,
  createSeededRandom,
  distortImage,
  gammaCurve,
  perspectiveImage,
  rotateImage,
  sCurveValue,
  scaleImage,
} from './distort.mjs';

function makeImage(width = 17, height = 13) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      // 색상보다 순위 비교가 목적이므로 fixture 는 RGB 동일한 회색 ramp 로 둔다.
      const value = (x * 17 + y * 11 + 23) % 256;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return { width, height, pixels };
}

function equalPixels(a, b) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  assert.deepEqual(Array.from(a.pixels), Array.from(b.pixels));
}

function channelAt(image, x, y, channel = 0) {
  return image.pixels[(y * image.width + x) * 4 + channel];
}

describe('기하 왜곡 — RGBA 계약과 경계값', () => {
  test('rotation=0, perspective=0, scale=1 은 byte-identical clone 이다', () => {
    const source = makeImage();
    const result = distortImage(source, { rotation: 0, perspective: 0, scale: 1 });
    equalPixels(source, result);
    assert.notEqual(result.pixels, source.pixels, '순수 함수는 새 픽셀 버퍼를 반환해야 한다');
  });

  test('회전 0..360, 원근 ±30, 스케일 0.5..2 가 모두 같은 크기의 RGBA 를 반환한다', () => {
    const source = makeImage();
    for (const degrees of [0, 90, 180, 270, 360]) {
      const result = rotateImage(source, degrees);
      assert.equal(result.width, source.width);
      assert.equal(result.height, source.height);
      assert.ok(result.pixels instanceof Uint8ClampedArray);
      assert.equal(result.pixels.length, source.pixels.length);
    }
    for (const degrees of [-30, 0, 30]) {
      equalPixels(perspectiveImage(source, degrees), perspectiveImage(source, degrees));
    }
    for (const factor of [0.5, 1, 2]) {
      const result = scaleImage(source, factor);
      assert.equal(result.pixels.length, source.pixels.length);
    }
  });

  test('기하 경계 밖은 RangeError 로 거부한다', () => {
    const source = makeImage();
    assert.throws(() => rotateImage(source, -1), RangeError);
    assert.throws(() => rotateImage(source, 360.1), RangeError);
    assert.throws(() => perspectiveImage(source, 30.001), RangeError);
    assert.throws(() => perspectiveImage(source, -30.001), RangeError);
    assert.throws(() => scaleImage(source, 0.499), RangeError);
    assert.throws(() => scaleImage(source, 2.001), RangeError);
  });

  test('bilinear 기하 변환도 alpha 를 포함한 4채널을 만들고 입력은 보존한다', () => {
    const source = makeImage();
    const before = Array.from(source.pixels);
    const result = distortImage(source, {
      rotation: 37,
      perspective: { degrees: 18, axis: 'both' },
      scale: 1.25,
    });
    assert.equal(result.pixels.length, source.width * source.height * 4);
    assert.deepEqual(Array.from(source.pixels), before);
    for (let i = 3; i < result.pixels.length; i += 4) {
      assert.ok(result.pixels[i] >= 0 && result.pixels[i] <= 255);
    }
  });
});

describe('시드 기반 Gaussian 노이즈 — 결정성', () => {
  test('같은 입력 + 같은 seed 는 byte-identical 이다', () => {
    const source = makeImage();
    const a = addGaussianNoise(source, 12, { seed: 'm1-seed' });
    const b = addGaussianNoise(source, 12, { seed: 'm1-seed' });
    equalPixels(a, b);
  });

  test('다른 seed 는 실제 픽셀열을 바꾼다', () => {
    const source = makeImage();
    const a = addGaussianNoise(source, 12, { seed: 1 });
    const b = addGaussianNoise(source, 12, { seed: 2 });
    assert.notDeepEqual(Array.from(a.pixels), Array.from(b.pixels));
  });

  test('PRNG 자체도 [0,1) 결정적 수열이며 seed=0 에서 정지하지 않는다', () => {
    const a = createSeededRandom(0);
    const b = createSeededRandom(0);
    const sequenceA = Array.from({ length: 8 }, () => a());
    const sequenceB = Array.from({ length: 8 }, () => b());
    assert.deepEqual(sequenceA, sequenceB);
    assert.ok(sequenceA.every((value) => value >= 0 && value < 1));
    assert.ok(new Set(sequenceA).size > 1);
  });

  test('sigma=0 은 noise 없는 clone 이며 sigma<0/255 초과는 거부한다', () => {
    const source = makeImage();
    equalPixels(source, addGaussianNoise(source, 0, { seed: 1 }));
    assert.throws(() => addGaussianNoise(source, -0.1, { seed: 1 }), RangeError);
    assert.throws(() => addGaussianNoise(source, 255.1, { seed: 1 }), RangeError);
  });
});

describe('감마·S-커브 — H1 단조성', () => {
  test('감마 0.6, 1.0, 1.8 곡선은 0..1 전체에서 단조 증가한다', () => {
    for (const gamma of [0.6, 1, 1.8]) {
      let previous = gammaCurve(0, gamma);
      for (let step = 1; step <= 1000; step += 1) {
        const current = gammaCurve(step / 1000, gamma);
        assert.ok(current >= previous, 'gamma=' + gamma + ', step=' + step);
        previous = current;
      }
      assert.equal(gammaCurve(0, gamma), 0);
      assert.equal(gammaCurve(1, gamma), 1);
    }
  });

  test('S-커브 amount=-1, 0, 1 도 단조 증가하며 끝점을 보존한다', () => {
    for (const amount of [-1, 0, 1]) {
      let previous = sCurveValue(0, amount);
      for (let step = 1; step <= 1000; step += 1) {
        const current = sCurveValue(step / 1000, amount);
        assert.ok(current >= previous, 'amount=' + amount + ', step=' + step);
        previous = current;
      }
      assert.equal(sCurveValue(0, amount), 0);
      assert.equal(sCurveValue(1, amount), 1);
    }
  });

  test('감마·S-커브 범위 밖 파라미터는 H1 검증 전에 거부한다', () => {
    assert.throws(() => gammaCurve(0.5, 0.599), RangeError);
    assert.throws(() => gammaCurve(0.5, 1.801), RangeError);
    assert.throws(() => sCurveValue(0.5, -1.001), RangeError);
    assert.throws(() => sCurveValue(0.5, 1.001), RangeError);
  });

  test('같은 RGB 순위의 회색 세 면은 감마·S-커브 후에도 순위를 유지한다', () => {
    const source = {
      width: 3,
      height: 1,
      pixels: new Uint8ClampedArray([
        40, 40, 40, 255,
        120, 120, 120, 255,
        220, 220, 220, 255,
      ]),
    };
    const gammaResult = applyGamma(source, 1.8);
    const sCurveResult = applySCurve(source, 1);
    for (const result of [gammaResult, sCurveResult]) {
      assert.ok(channelAt(result, 0, 0) < channelAt(result, 1, 0));
      assert.ok(channelAt(result, 1, 0) < channelAt(result, 2, 0));
    }
  });
});

describe('비네팅 — 공간 파라미터와 알파', () => {
  test('amount=0 은 byte-identical 이고, amount=1 은 중앙보다 모서리가 어둡다', () => {
    const source = {
      width: 9,
      height: 9,
      pixels: new Uint8ClampedArray(9 * 9 * 4).fill(200),
    };
    for (let i = 3; i < source.pixels.length; i += 4) source.pixels[i] = 123;
    equalPixels(source, applyVignette(source, 0));
    const result = applyVignette(source, 1, { power: 1 });
    assert.ok(channelAt(result, 4, 4) > channelAt(result, 0, 0));
    assert.equal(result.pixels[4 * 9 * 4 + 4 * 4 + 3], 123, 'alpha 는 보존해야 한다');
  });

  test('비네팅 범위와 power 경계값을 검증한다', () => {
    const source = makeImage();
    assert.throws(() => applyVignette(source, -0.001), RangeError);
    assert.throws(() => applyVignette(source, 1.001), RangeError);
    assert.throws(() => applyVignette(source, 0.5, { power: 0 }), RangeError);
  });
});

describe('JPEG 근사 — q=60 DCT 결정성', () => {
  test('q=60 은 반복 호출 결과가 같고 alpha 를 보존한다', () => {
    const source = makeImage(19, 15);
    const a = applyJpegApproximation(source, 60);
    const b = applyJpegApproximation(source, 60);
    equalPixels(a, b);
    for (let i = 3; i < source.pixels.length; i += 4) assert.equal(a.pixels[i], source.pixels[i]);
  });

  test('JPEG 품질 1..100 경계는 허용하고 밖은 거부한다', () => {
    const source = makeImage(8, 8);
    for (const quality of [1, 60, 100]) {
      const result = applyJpegApproximation(source, quality);
      assert.equal(result.pixels.length, source.pixels.length);
    }
    assert.throws(() => applyJpegApproximation(source, 0), RangeError);
    assert.throws(() => applyJpegApproximation(source, 100.1), RangeError);
  });
});

describe('distortImage 전체 파이프라인', () => {
  test('전체 M1 옵션을 같은 seed 로 두 번 적용하면 바이트가 같다', () => {
    const source = makeImage(17, 13);
    const options = {
      rotation: 13,
      perspective: { degrees: 12, axis: 'both' },
      scale: 0.8,
      gamma: 0.6,
      sCurve: { amount: 0.7 },
      vignette: { amount: 0.35, power: 1.4 },
      noise: { sigma: 3, seed: 987654 },
      jpegQuality: 60,
    };
    equalPixels(distortImage(source, options), distortImage(source, options));
  });

  test('기본 pipeline 은 입력과 옵션을 바꾸지 않고 noise seed 를 상속한다', () => {
    const source = makeImage();
    const before = Array.from(source.pixels);
    const options = { noise: { sigma: 2 }, seed: 'inherited-seed' };
    const optionsBefore = { noise: { ...options.noise }, seed: options.seed };
    const result = distortImage(source, options);
    assert.deepEqual(Array.from(source.pixels), before);
    assert.deepEqual(options, optionsBefore);
    assert.notDeepEqual(Array.from(source.pixels), Array.from(result.pixels));
  });
});
