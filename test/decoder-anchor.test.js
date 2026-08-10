
/**
 * decoder-anchor.test.js — Type O/A 앵커 합성 검증
 *
 * 인코더 -> scene -> 결정적 rasterizer -> 상대휘도 필드의 실제 경로를 거친다.
 * 회전 래스터 세 장을 모두 평가해 방향 후보를 첫 통과로 잘라내지 않는지
 * 확인한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  getPreset,
  relativeLuminance,
} from '../src/luminance.js';
import {
  findAAnchorHypotheses,
  findOAnchorHypotheses,
  physicalRotationSigma,
} from '../src/decoder/anchor-detect.js';
import {
  FRONTEND_FAILURE,
  HOMOGRAPHY_CANONICAL_SPACE,
} from '../src/decoder/contracts.js';

const PRESET = getPreset('slate');
const PALETTE = {
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
};

function rasterToLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const offset = (y * raster.width + x) * 4;
      data[y * raster.width + x] = relativeLuminance({
        r: raster.pixels[offset],
        g: raster.pixels[offset + 1],
        b: raster.pixels[offset + 2],
      });
    }
  }
  return {
    width: raster.width,
    height: raster.height,
    data,
    alpha: null,
  };
}

function renderEncoded(encoded, options = {}) {
  const scene = buildScene(encoded, {
    palette: PALETTE,
    cellSize: options.cellSize === undefined ? 20 : options.cellSize,
    margin: options.margin,
  });
  const raster = rasterize(scene, {
    pixelsPerUnit: 1,
    supersample: options.supersample === undefined ? 4 : options.supersample,
  });
  return {
    luma: rasterToLuma(raster),
    bullseye: {
      center: { x: scene.layout.originX, y: scene.layout.originY },
      cellSize: options.cellSize === undefined ? 20 : options.cellSize,
      score: 1,
      hardChecksPassed: true,
    },
  };
}

function rotateLuma(source, center, turns, background) {
  const data = new Float32Array(source.data.length);
  const angle = turns * (2 * Math.PI / 3);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cx = center.x;
  const cy = center.y;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      // 출력 픽셀을 원본으로 역회전한다. nearest는 고정된 결정적 규칙이다.
      const sourceX = Math.round(c * dx + s * dy + cx);
      const sourceY = Math.round(-s * dx + c * dy + cy);
      data[y * source.width + x] =
        sourceX >= 0 && sourceY >= 0
          && sourceX < source.width && sourceY < source.height
          ? source.data[sourceY * source.width + sourceX]
          : background;
    }
  }
  return {
    width: source.width,
    height: source.height,
    data,
    alpha: null,
  };
}

test('physicalRotationSigma: 규범 σ와 3-순환·0/5 비역전 성질', () => {
  assert.deepEqual(physicalRotationSigma(0), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(physicalRotationSigma('cw'), [4, 5, 1, 0, 3, 2]);
  assert.deepEqual(physicalRotationSigma('ccw'), [3, 2, 5, 4, 0, 1]);

  const cw = physicalRotationSigma(1);
  const apply = (table, digit) => table[digit];
  for (let digit = 0; digit < 6; digit += 1) {
    assert.equal(apply(cw, apply(cw, apply(cw, digit))), digit);
  }
  assert.notEqual(cw[0], 5);
  assert.notEqual(cw[5], 0);
  const ccw = physicalRotationSigma(2);
  assert.notEqual(ccw[0], 5);
  assert.notEqual(ccw[5], 0);
});

test('Type O: 0/120/240도 전체 평가에서 정답 방향 가설은 정확히 하나', () => {
  const encoded = encode('anchor', { version: 1, eccLevel: 'M' });
  const rendered = renderEncoded(encoded);
  const background = relativeLuminance(PRESET.background);
  const results = [];

  for (let turn = 0; turn < 3; turn += 1) {
    const rotated = rotateLuma(rendered.luma, rendered.bullseye.center, turn, background);
    const first = findOAnchorHypotheses(
      rotated,
      rendered.bullseye,
      [6, 8, 10],
      { minSeparation: 0.04 },
    );
    const second = findOAnchorHypotheses(
      rotated,
      rendered.bullseye,
      [6, 8, 10],
      { minSeparation: 0.04 },
    );
    assert.equal(first.ok, true);
    assert.deepEqual(first, second, '같은 입력의 방향 결과가 달라졌다');
    assert.equal(first.hypotheses.length, 1);
    assert.equal(first.hypotheses[0].k, encoded.k);
    assert.equal(first.hypotheses[0].orientation, turn);
    assert.equal(first.hypotheses[0].hardChecks.all, true);
    assert.equal(first.hypotheses[0].canonicalSpace, HOMOGRAPHY_CANONICAL_SPACE);
    if (turn === 0) {
      const H = first.hypotheses[0].H;
      // unit-cell Euclidean H는 선형부가 cellSize·I다. axial H라면 √3/1.5 기저가
      // 여기에 섞여 이 단언을 통과하지 못한다.
      assert.equal(H[0], rendered.bullseye.cellSize);
      assert.equal(H[1], 0);
      assert.equal(H[3], 0);
      assert.equal(H[4], rendered.bullseye.cellSize);
    }
    results.push(first.hypotheses.map((item) => [item.k, item.orientation]));
  }

  assert.deepEqual(results, [[[6, 0]], [[6, 1]], [[6, 2]]]);
});

test('Type O: 입력·불스아이·k 목록의 실패는 예외가 아닌 fail 결과', () => {
  const encoded = encode('failure path', { version: 1, eccLevel: 'M' });
  const rendered = renderEncoded(encoded);
  const empty = findOAnchorHypotheses(null, rendered.bullseye, [6]);
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, FRONTEND_FAILURE.EMPTY_INPUT);

  const constant = {
    width: 16,
    height: 16,
    data: new Float32Array(16 * 16).fill(0.4),
    alpha: null,
  };
  const degenerate = findOAnchorHypotheses(constant, rendered.bullseye, [6]);
  assert.equal(degenerate.ok, false);
  assert.equal(degenerate.reason, FRONTEND_FAILURE.LUMA_DEGENERATE);

  const noFinder = findOAnchorHypotheses(rendered.luma, null, [6]);
  assert.equal(noFinder.ok, false);
  assert.equal(noFinder.reason, FRONTEND_FAILURE.NO_FINDER);

  const noK = findOAnchorHypotheses(rendered.luma, rendered.bullseye, []);
  assert.equal(noK.ok, false);
  assert.equal(noK.reason, FRONTEND_FAILURE.NO_ANCHORS);
});

test('Type A: placementA 주 꼭짓점 앵커도 실제 렌더에서 복원', () => {
  const encoded = encodeA('A anchor', { version: 1, eccLevel: 'M' });
  const rendered = renderEncoded(encoded, {
    cellSize: 10,
    margin: 240,
    supersample: 2,
  });
  const result = findAAnchorHypotheses(
    rendered.luma,
    rendered.bullseye,
    [encoded.k, encoded.k + 2],
    { minSeparation: 0.04 },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.hypotheses.map((item) => [item.k, item.orientation]),
    [[encoded.k, 0]],
  );
  assert.deepEqual(result.hypotheses[0].canonicalAnchors, [
    { q: encoded.k, r: -2 * encoded.k },
    { q: encoded.k, r: encoded.k },
    { q: -2 * encoded.k, r: encoded.k },
  ]);
});
