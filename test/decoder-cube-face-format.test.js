import assert from 'node:assert/strict';
import test from 'node:test';

import { finalLayoutIdsForN } from '../src/cellSurfaceFinal.js';
import { sampleCubeCell } from '../src/decoder/cube-detect.js';
import { readFormatFromLocator } from '../src/decoder/locator-format.js';

function field() {
  const width = 512;
  const height = 512;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = 0.12 + 0.7 * x / width + 0.1 * Math.sin(y * 0.11);
    }
  }
  return { width, height, data };
}

function HAt(x, y = 256) {
  return new Float64Array([12, 0, x, 0, 12, y, 0, 0, 1]);
}

test('같은 H 세 장은 기존 single-H 셀 표본과 포맷 결과가 같다', () => {
  const luma = field();
  const H = HAt(256);
  const faceHs = [Float64Array.from(H), Float64Array.from(H), Float64Array.from(H)];
  assert.deepEqual(
    sampleCubeCell(luma, { H }, 1, 1),
    sampleCubeCell(luma, { H, faceHs }, 1, 1),
  );
  const n = 13;
  const layoutId = finalLayoutIdsForN(n)[0];
  assert.deepEqual(
    readFormatFromLocator(luma, { H, n, layoutId }),
    readFormatFromLocator(luma, { H, faceHs, n, layoutId }),
  );
});

test('서로 다른 세 H는 T/L/R 표본에 각각 따로 쓰인다', () => {
  const luma = field();
  const faceHs = [HAt(190), HAt(256), HAt(322)];
  const mixed = sampleCubeCell(luma, { H: faceHs[0], faceHs }, 1, 1);
  assert.equal(mixed.ok, true);
  const repeated = faceHs.map((H) => sampleCubeCell(
    luma, { H, faceHs: [H, H, H] }, 1, 1,
  ));
  assert.equal(repeated.every((result) => result.ok), true);
  assert.deepEqual(mixed.T, repeated[0].T);
  assert.deepEqual(mixed.L, repeated[1].L);
  assert.deepEqual(mixed.R, repeated[2].R);
  assert.notEqual(mixed.T.median, mixed.L.median);
  assert.notEqual(mixed.L.median, mixed.R.median);
});

test('명시한 malformed faceHs는 sample과 locator에서 조용히 single-H로 fallback하지 않는다', () => {
  const luma = field();
  const H = HAt(256);
  const invalids = [
    null,
    [H, H],
    [H, new Float32Array(H), H],
    [H, Float64Array.from(H, (value, index) => index === 4 ? NaN : value), H],
  ];
  const n = 13;
  const layoutId = finalLayoutIdsForN(n)[0];
  for (const faceHs of invalids) {
    const sampled = sampleCubeCell(luma, { H, faceHs }, 1, 1);
    assert.equal(sampled.ok, false);
    assert.equal(sampled.reason, 'frontend:homography-degenerate');
    assert.equal(sampled.detail.cause, 'invalid-face-homographies');

    const read = readFormatFromLocator(luma, { H, faceHs, n, layoutId });
    assert.equal(read.ok, false);
    assert.equal(read.reason, 'frontend:homography-degenerate');
    assert.equal(read.detail.cause, 'locator-face-homographies-invalid');
  }
});

test('faceHs가 없으면 기존 H 필수 계약을 그대로 유지한다', () => {
  const luma = field();
  const n = 13;
  const layoutId = finalLayoutIdsForN(n)[0];
  const sampled = sampleCubeCell(luma, {}, 1, 1);
  assert.equal(sampled.ok, false);
  assert.equal(sampled.detail.cause, 'missing-homography');
  const read = readFormatFromLocator(luma, { n, layoutId });
  assert.equal(read.ok, false);
  assert.equal(read.detail.cause, 'locator-pose-invalid');
});
