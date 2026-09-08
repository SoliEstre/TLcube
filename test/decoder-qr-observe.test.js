import assert from 'node:assert/strict';
import test from 'node:test';
import { detectQrFinderTriples as detectFromBootstrap } from '../src/decoder/bootstrap.js';
import { detectQrFinderTriples as detectObserved } from '../src/decoder/qr-finder-observe.js';
import {
  FILL,
  embed960,
  renderV0xq,
  toRelativeLuminance,
} from './cellSurface-block-locator.helpers.mjs';

function luma(width, height, fill) {
  return {
    width,
    height,
    data: new Float32Array(width * height).fill(fill),
    alpha: new Uint8Array(width * height).fill(255),
  };
}

function deterministicNoise(width, height) {
  const out = luma(width, height, 0);
  let state = 0x6d2b79f5;
  for (let index = 0; index < out.data.length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out.data[index] = (state & 255) / 255;
  }
  return out;
}

test('QR 관찰 모듈은 bootstrap 재수출과 빈 입력·노이즈·광학 QR에서 같은 결과를 낸다', () => {
  const opticalQr = toRelativeLuminance(embed960(renderV0xq(15)));
  const inputs = [
    ['빈 유효 luma', luma(32, 24, 0.95)],
    ['결정적 노이즈', deterministicNoise(96, 72)],
    ['sceneY 광학 중앙 QR', opticalQr],
  ];
  const options = [
    undefined,
    {},
    { maxCandidatesPerKind: 1 },
    { minimumSpacingModules: 6, maximumSpacingModules: 30, maxCandidatesPerKind: 3 },
  ];

  for (const [label, input] of inputs) {
    for (const option of options) {
      assert.deepEqual(
        detectFromBootstrap(input, option),
        detectObserved(input, option),
        `${label} ${JSON.stringify(option)}`,
      );
    }
  }

  const positive = detectObserved(opticalQr, {});
  assert.equal(positive.ok, true, JSON.stringify(positive));
  assert.ok(positive.candidates.length > 0, '광학 QR은 후보를 하나 이상 내야 한다');
  assert.equal(FILL.a, 255, '광학 픽스처의 불투명 배경 전제가 바뀌었다');
});
