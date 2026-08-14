/**
 * decoder-frontend.test.js — oracle 기하 없이 닫는 첫 decoder end-to-end.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeY } from '../src/encodeY.js';
import {
  FRONTEND_FAILURE,
  HOMOGRAPHY_CANONICAL_SPACE,
} from '../src/decoder/contracts.js';
import {
  directAnchorHypotheses,
  enumerateGridHypotheses,
  selectGridHypothesis,
} from '../src/decoder/bootstrap.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectBullseyes, refineBullseye } from '../src/decoder/bullseye-detect.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY } from '../src/sceneY.js';
import {
  applyJpegApproximation,
  distortImage,
  scaleImage,
} from './harness/distort.mjs';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../tools/read-luma.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });

function render(text, version, eccLevel, options = {}) {
  const encoded = encode(text, { version, eccLevel });
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: options.margin,
  });
  const raster = rasterize(scene, {
    pixelsPerUnit: options.pixelsPerUnit === undefined ? 12 : options.pixelsPerUnit,
    supersample: options.supersample === undefined ? 1 : options.supersample,
  });
  return { encoded, scene, raster };
}

function gradientRaster(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(255 * (x + y) / (width + height - 2));
      const offset = (y * width + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return { width, height, pixels };
}

function cropRaster(raster, x, y, width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let targetY = 0; targetY < height; targetY += 1) {
    for (let targetX = 0; targetX < width; targetX += 1) {
      const sourceOffset = ((y + targetY) * raster.width + x + targetX) * 4;
      const targetOffset = (targetY * width + targetX) * 4;
      pixels.set(raster.pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return { width, height, pixels };
}

function padRaster(raster, factor, fill) {
  const width = Math.round(raster.width * factor);
  const height = Math.round(raster.height * factor);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    pixels[offset] = fill.r;
    pixels[offset + 1] = fill.g;
    pixels[offset + 2] = fill.b;
    pixels[offset + 3] = fill.a;
  }

  const offsetX = Math.floor((width - raster.width) / 2);
  const offsetY = Math.floor((height - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    const sourceStart = y * raster.width * 4;
    const targetStart = ((y + offsetY) * width + offsetX) * 4;
    pixels.set(
      raster.pixels.subarray(sourceStart, sourceStart + raster.width * 4),
      targetStart,
    );
  }
  return { width, height, pixels };
}

function solidRaster(width, height, fill = { r: 255, g: 255, b: 255, a: 255 }) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    pixels[offset] = fill.r;
    pixels[offset + 1] = fill.g;
    pixels[offset + 2] = fill.b;
    pixels[offset + 3] = fill.a;
  }
  return { width, height, pixels };
}

function fillRectRaster(raster, x, y, width, height, rgba) {
  for (let targetY = Math.max(0, y);
    targetY < Math.min(raster.height, y + height);
    targetY += 1) {
    for (let targetX = Math.max(0, x);
      targetX < Math.min(raster.width, x + width);
      targetX += 1) {
      const offset = (targetY * raster.width + targetX) * 4;
      raster.pixels[offset] = rgba[0];
      raster.pixels[offset + 1] = rgba[1];
      raster.pixels[offset + 2] = rgba[2];
      raster.pixels[offset + 3] = rgba[3] === undefined ? 255 : rgba[3];
    }
  }
}

function blitRaster(target, source, offsetX, offsetY) {
  assert.ok(offsetX >= 0 && offsetY >= 0);
  assert.ok(offsetX + source.width <= target.width);
  assert.ok(offsetY + source.height <= target.height);
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = ((y + offsetY) * target.width + offsetX) * 4;
    target.pixels.set(
      source.pixels.subarray(sourceStart, sourceStart + source.width * 4),
      targetStart,
    );
  }
}

function placementOffset(frame, code, position) {
  if (position === 'top-left') {
    return {
      x: Math.min(12, frame.width - code.width),
      y: Math.min(12, frame.height - code.height),
    };
  }
  if (position === 'bottom-right') {
    return {
      x: Math.max(0, frame.width - code.width - 12),
      y: Math.max(0, frame.height - code.height - 12),
    };
  }
  return {
    x: Math.floor((frame.width - code.width) / 2),
    y: Math.floor((frame.height - code.height) / 2),
  };
}

function clutterFrame(code, {
  width,
  height,
  kind = 'clean',
  position = 'center',
} = {}) {
  const frame = solidRaster(width, height);
  if (kind === 'texture') {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const noise = ((x * 73 + y * 151 + (x * y) % 251) % 41) - 20;
        const value = 235 + noise;
        const offset = (y * width + x) * 4;
        frame.pixels[offset] = value;
        frame.pixels[offset + 1] = value;
        frame.pixels[offset + 2] = value;
      }
    }
  } else if (kind === 'border') {
    fillRectRaster(frame, 0, 0, width, 10, [0, 0, 0, 255]);
    fillRectRaster(frame, 0, height - 10, width, 10, [0, 0, 0, 255]);
    fillRectRaster(frame, 0, 0, 10, height, [0, 0, 0, 255]);
    fillRectRaster(frame, width - 10, 0, 10, height, [0, 0, 0, 255]);
  } else if (kind === 'ui') {
    for (let line = 0; line < 6; line += 1) {
      fillRectRaster(
        frame,
        Math.floor(width * 0.12),
        Math.max(6, Math.floor(height * 0.045) + line * Math.max(12, Math.floor(height * 0.021))),
        Math.floor(width * (0.48 + 0.04 * (line % 3))),
        Math.max(4, Math.floor(height * 0.007)),
        [38, 45, 54, 255],
      );
    }
    fillRectRaster(
      frame,
      Math.floor(width * 0.32),
      Math.floor(height * 0.84),
      Math.floor(width * 0.36),
      Math.max(16, Math.floor(height * 0.055)),
      [32, 112, 226, 255],
    );
  }

  const offset = placementOffset(frame, code, position);
  blitRaster(frame, code, offset.x, offset.y);
  return { ...frame, codeBounds: { ...offset, width: code.width, height: code.height } };
}

function gaussianKernel(sigma) {
  const radius = Math.ceil(3 * sigma);
  const weights = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset + radius] = weight;
    sum += weight;
  }
  for (let index = 0; index < weights.length; index += 1) weights[index] /= sum;
  return { radius, weights };
}

function gaussianBlurRaster(raster, sigma) {
  assert.ok(Number.isFinite(sigma) && sigma > 0, 'sigma는 양의 유한수여야 한다');
  const { radius, weights } = gaussianKernel(sigma);
  const { width, height } = raster;
  const horizontal = new Float32Array(width * height * 3);
  const pixels = new Uint8ClampedArray(raster.pixels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const sourceX = Math.max(0, Math.min(width - 1, x + offset));
          sum += raster.pixels[(y * width + sourceX) * 4 + channel]
            * weights[offset + radius];
        }
        horizontal[target + channel] = sum;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const sourceY = Math.max(0, Math.min(height - 1, y + offset));
          sum += horizontal[(sourceY * width + x) * 3 + channel]
            * weights[offset + radius];
        }
        pixels[target + channel] = Math.round(sum);
      }
    }
  }
  return { ...raster, pixels };
}

// bootstrap finder의 240px box-downsample/lift 경로를 실덤프에서 그대로 재현한다.
function multiplyTestHomographies(left, right) {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        out[row * 3 + column] += left[row * 3 + inner] * right[inner * 3 + column];
      }
    }
  }
  return out;
}

function downsampleFinderInput(luma, maxDimension = 240) {
  const factor = Math.max(1, Math.ceil(Math.max(luma.width, luma.height) / maxDimension));
  if (factor === 1) return { luma, factor };
  const width = Math.ceil(luma.width / factor);
  const height = Math.ceil(luma.height / factor);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let sourceY = y * factor;
        sourceY < Math.min(luma.height, (y + 1) * factor);
        sourceY += 1) {
        for (let sourceX = x * factor;
          sourceX < Math.min(luma.width, (x + 1) * factor);
          sourceX += 1) {
          sum += luma.data[sourceY * luma.width + sourceX];
          count += 1;
        }
      }
      data[y * width + x] = sum / count;
    }
  }
  return { luma: { width, height, data, alpha: null }, factor };
}

function liftTestFinder(finder, factor) {
  if (factor === 1) return finder;
  const sourceH = finder.H || finder.transform || finder.B;
  const scale = new Float64Array([
    factor, 0, (factor - 1) / 2,
    0, factor, (factor - 1) / 2,
    0, 0, 1,
  ]);
  const H = multiplyTestHomographies(scale, sourceH);
  return {
    ...finder,
    center: { x: H[2] / H[8], y: H[5] / H[8] },
    cellSize: finder.cellSize * factor,
    H,
    transform: H,
    B: H,
  };
}

function detectRealFrameFinder(luma) {
  const reduced = downsampleFinderInput(luma);
  const detected = detectBullseyes(reduced.luma, {
    maxPyramidLevels: 2,
    maxRefinedProposals: 1,
    refineIterations: 1,
    projectiveSeeds: false,
  });
  assert.equal(detected.ok, true, JSON.stringify(detected));
  let finder = liftTestFinder(detected.candidates[0], reduced.factor);
  const refined = refineBullseye(luma, finder, {
    refineIterations: 0,
    projectiveSeeds: false,
  });
  if (refined.ok) finder = refined.candidate;
  return finder;
}

test('실기기 Type O luma: 가려진 앵커에서도 V2 기본 기하 후보를 보존', {
  timeout: 240_000,
}, (t) => {
  const dumps = listLumaDumps().filter((dump) => dump.name.startsWith('typeO-fold-'));
  if (dumps.length === 0) {
    t.skip('휘도 덤프 없음');
    return;
  }

  for (const dump of dumps) {
    const luma = readLumaDump(dump.path);
    const finder = detectRealFrameFinder(luma);
    const direct = directAnchorHypotheses(luma, finder, 'hex', {
      allowWeakAnchorFallback: true,
    });
    assert.ok(
      direct.hypotheses.some((hypothesis) =>
        hypothesis.k === 8
        && hypothesis.orientation === 0
        && hypothesis.source === 'anchor-fallback'),
      JSON.stringify({
        dump: dump.name,
        directCount: direct.hypotheses.length,
        failure: direct.failure,
      }),
    );
  }
});

const CLEAN_CASES = Object.freeze([
  { version: 1, eccLevel: 'L', text: 'TLcube' },
  { version: 1, eccLevel: 'M', text: '안녕' },
  { version: 1, eccLevel: 'H', text: 'https://x.co/a' },
  { version: 2, eccLevel: 'L', text: '안녕' },
  { version: 2, eccLevel: 'M', text: 'https://x.co/a' },
  { version: 2, eccLevel: 'H', text: 'TLcube' },
  { version: 3, eccLevel: 'L', text: 'https://x.co/a' },
  { version: 3, eccLevel: 'M', text: 'TLcube' },
  { version: 3, eccLevel: 'H', text: '안녕' },
]);

test('encode → buildScene → rasterize → decodeFrontend: V1/V2/V3 × ECC L/M/H', {
  timeout: 120_000,
}, () => {
  for (const entry of CLEAN_CASES) {
    const fixture = render(entry.text, entry.version, entry.eccLevel);
    const result = decodeFrontend(fixture.raster);
    assert.equal(result.ok, true, JSON.stringify({ entry, result }));
    assert.equal(result.text, entry.text);
    assert.equal(result.version, entry.version);
    assert.equal(result.eccLevel, entry.eccLevel);
    assert.equal(result.crsDistance, 2 * result.corrected);
  }
});

const ROTATION_SWEEP = Object.freeze(
  Array.from({ length: 12 }, (_, index) => index * 30),
);
const PERSPECTIVE_SWEEP = Object.freeze([-30, -20, -10, 0, 10, 20, 30]);
const SCALE_SWEEP = Object.freeze([0.5, 0.6, 0.75, 1, 1.25, 1.5, 2]);
const RESAMPLE_SWEEP = Object.freeze([0.9, 0.8, 0.7, 0.6, 0.5]);
const BLUR_SIGMA_SWEEP = Object.freeze([0.5, 1, 1.5, 2, 2.5]);
const JPEG_BLUR_SIGMA_SWEEP = Object.freeze([1, 2, 3]);
const SWEEP_TEXT = 'https://tl.estre.so/x';

function failureMessage(axis, value, result) {
  const detail = result && result.detail;
  const cause = detail && detail.cause;
  return JSON.stringify({
    axis,
    value,
    reason: result && result.reason,
    stage: detail && (detail.pipelineStage || detail.stage),
    pipelineCode: detail && detail.pipelineCode,
    cause: cause && (cause.cause || cause.message || cause.stage),
  });
}

function assertSweepDecoded(axis, value, result) {
  assert.equal(result.ok, true, failureMessage(axis, value, result));
  assert.equal(result.text, SWEEP_TEXT, failureMessage(axis, value, result));
  assert.equal(result.version, 2, failureMessage(axis, value, result));
  assert.equal(result.eccLevel, 'M', failureMessage(axis, value, result));
  assert.equal(result.hypothesis.canonicalSpace, HOMOGRAPHY_CANONICAL_SPACE);
}

test('회전 sweep 12점: 0~330도 전 구간 복호', {
  timeout: 120_000,
}, () => {
  const fixture = render(SWEEP_TEXT, 2, 'M', {
    pixelsPerUnit: 12,
    supersample: 2,
    margin: 8,
  });
  for (const degrees of ROTATION_SWEEP) {
    const distorted = distortImage(fixture.raster, {
      rotation: degrees,
      fill: FILL,
    });
    assertSweepDecoded('rotation', degrees, decodeFrontend(distorted));
  }
});

test('원근 sweep 7점 × 양축: -30~30도 전 구간 복호', {
  timeout: 180_000,
}, () => {
  // 고정 캔버스 원근이 심볼을 자르지 않도록 M1 기하 시험용 여백을 둔다.
  const fixture = render(SWEEP_TEXT, 2, 'M', {
    pixelsPerUnit: 12,
    supersample: 2,
    margin: 18,
  });
  for (const axis of ['horizontal', 'vertical']) {
    for (const degrees of PERSPECTIVE_SWEEP) {
      const distorted = distortImage(fixture.raster, {
        perspective: { degrees, axis },
        fill: FILL,
      });
      assertSweepDecoded('perspective-' + axis, degrees, decodeFrontend(distorted));
    }
  }
});

test('full-frame scale sweep 7점: 0.5~2.0배 전 구간 복호', {
  timeout: 180_000,
}, () => {
  // distortImage의 scale은 고정 캔버스 zoom이다. 확대에서는 전체 심볼이 시야에
  // 남도록 margin을 확보한다. 기본 margin crop은 아래 SYMBOL_CLIPPED 회귀가 맡는다.
  for (const scale of SCALE_SWEEP) {
    const fixture = render(SWEEP_TEXT, 2, 'M', {
      pixelsPerUnit: 20,
      supersample: 2,
      margin: scale > 1 ? 18 : undefined,
    });
    const distorted = distortImage(fixture.raster, { scale, fill: FILL });
    assertSweepDecoded('scale', scale, decodeFrontend(distorted));
  }
});

test('1.8배 패딩 뒤 bilinear resample sweep 5점: 0.5–0.9배 전 구간 복호', {
  timeout: 180_000,
}, () => {
  const fixture = render(SWEEP_TEXT, 2, 'M', {
    pixelsPerUnit: 24,
    supersample: 2,
  });
  assert.deepEqual([fixture.raster.width, fixture.raster.height], [803, 720]);
  const padded = padRaster(fixture.raster, 1.8, FILL);
  assert.deepEqual([padded.width, padded.height], [1445, 1296]);
  assertSweepDecoded('resample-clean', 1, decodeFrontend(padded));

  for (const scale of RESAMPLE_SWEEP) {
    const resampled = scaleImage(padded, scale, { fill: FILL });
    assertSweepDecoded(
      'resample',
      { scale, effectiveWidth: Math.round(padded.width * scale) },
      decodeFrontend(resampled),
    );
  }
});

test('0.5배 resample 뒤 Gaussian blur sigma sweep 5점 복호', {
  timeout: 180_000,
}, () => {
  const fixture = render(SWEEP_TEXT, 2, 'M', {
    pixelsPerUnit: 24,
    supersample: 2,
  });
  const padded = padRaster(fixture.raster, 1.8, FILL);
  const resampled = scaleImage(padded, 0.5, { fill: FILL });

  for (const sigma of BLUR_SIGMA_SWEEP) {
    const blurred = gaussianBlurRaster(resampled, sigma);
    assertSweepDecoded('gaussian-blur', sigma, decodeFrontend(blurred));
  }
});

test('0.5배 resample + Gaussian blur sigma sweep + JPEG 근사 q=60 3점 복호', {
  timeout: 180_000,
}, () => {
  const fixture = render(SWEEP_TEXT, 2, 'M', {
    pixelsPerUnit: 24,
    supersample: 2,
  });
  const padded = padRaster(fixture.raster, 1.8, FILL);
  const resampled = scaleImage(padded, 0.5, { fill: FILL });

  for (const sigma of JPEG_BLUR_SIGMA_SWEEP) {
    const blurred = gaussianBlurRaster(resampled, sigma);
    const compressed = applyJpegApproximation(blurred, 60);
    assertSweepDecoded('jpeg-q60+gaussian-blur', sigma, decodeFrontend(compressed));
  }
});

const CLUTTER_TEXT = 'https://tl.estre.so/';
const CLUTTER_KINDS = Object.freeze(['clean', 'ui', 'border', 'texture']);
const FRAME_LINEAR_RATIOS = Object.freeze([0.20, 0.35, 0.50, 0.65, 0.80]);
const FRAME_POSITIONS = Object.freeze(['center', 'top-left', 'bottom-right']);

function assertClutterDecoded(axis, value, result, expectedText = CLUTTER_TEXT) {
  const message = failureMessage(axis, value, result);
  assert.equal(result.ok, true, message);
  assert.equal(result.text, expectedText, message);
  assert.equal(result.version, 2, message);
  assert.equal(result.eccLevel, 'M', message);
}

test('코드 1.7w × 1.9h 프레임: clean/UI/검은 테두리/결정적 질감 4종 복호', {
  timeout: 180_000,
}, () => {
  const fixture = render(CLUTTER_TEXT, 2, 'M', {
    pixelsPerUnit: 20,
    supersample: 2,
  });
  const width = Math.round(fixture.raster.width * 1.7);
  const height = Math.round(fixture.raster.height * 1.9);

  for (const kind of CLUTTER_KINDS) {
    const frame = clutterFrame(fixture.raster, { width, height, kind });
    assertClutterDecoded('clutter-kind', kind, decodeFrontend(frame));
  }
});

test('코드 선형 점유 20~80% × 중앙/좌상단/우하단 위치 sweep 복호', {
  timeout: 240_000,
}, () => {
  const fixture = render(CLUTTER_TEXT, 2, 'M', {
    pixelsPerUnit: 9,
    supersample: 2,
  });

  for (const ratio of FRAME_LINEAR_RATIOS) {
    const width = Math.ceil(fixture.raster.width / ratio);
    const height = Math.ceil(fixture.raster.height / ratio);
    for (const position of FRAME_POSITIONS) {
      const frame = clutterFrame(fixture.raster, {
        width,
        height,
        kind: 'texture',
        position,
      });
      const actualWidthRatio = fixture.raster.width / width;
      const actualHeightRatio = fixture.raster.height / height;
      assert.ok(Math.abs(actualWidthRatio - ratio) < 0.005);
      assert.ok(Math.abs(actualHeightRatio - ratio) < 0.005);
      assertClutterDecoded(
        'clutter-ratio-position',
        { ratio, position, width, height },
        decodeFrontend(frame),
      );
    }
  }
});

test('프레임에 코드가 둘이면 결정적 후보 하나를 복호', {
  timeout: 120_000,
}, () => {
  const first = render('first-code', 2, 'M', {
    pixelsPerUnit: 12,
    supersample: 2,
  }).raster;
  const second = render('second-code', 2, 'M', {
    pixelsPerUnit: 12,
    supersample: 2,
  }).raster;
  const frame = clutterFrame(first, {
    width: 960,
    height: 600,
    kind: 'texture',
    position: 'top-left',
  });
  blitRaster(frame, second, frame.width - second.width - 12, frame.height - second.height - 12);

  const result = decodeFrontend(frame);
  const repeated = decodeFrontend(frame);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(repeated, result, '복수 코드 선택이 동일 프레임에서 달라졌다');
  assert.ok(['first-code', 'second-code'].includes(result.text), JSON.stringify(result));
  assert.equal(result.version, 2);
  assert.equal(result.eccLevel, 'M');
});

test('코드가 없는 비퇴화 영상은 NO_FINDER', {
  timeout: 20_000,
}, () => {
  const result = decodeFrontend(gradientRaster(128, 128));
  assert.equal(result.ok, false);
  assert.equal(result.reason, FRONTEND_FAILURE.NO_FINDER);
});

test('외곽이 잘린 코드는 성공으로 오인하지 않고 앞단 실패 코드로 닫힘', {
  timeout: 30_000,
}, () => {
  const fixture = render('clipped', 2, 'M', {
    pixelsPerUnit: 16,
    margin: 4,
  });
  const clippedWidth = Math.floor(fixture.raster.width * 0.63);
  const clipped = cropRaster(
    fixture.raster,
    0,
    0,
    clippedWidth,
    fixture.raster.height,
  );
  const result = decodeFrontend(clipped);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, FRONTEND_FAILURE.SYMBOL_CLIPPED);
  assert.equal(result.detail.pipelineStage, 'bootstrap-geometry');

  const zoomFixture = render('zoom-clipped', 2, 'M', {
    pixelsPerUnit: 20,
    supersample: 2,
  });
  const zoomed = distortImage(zoomFixture.raster, { scale: 2, fill: FILL });
  const zoomResult = decodeFrontend(zoomed);
  assert.equal(zoomResult.ok, false, JSON.stringify(zoomResult));
  assert.equal(zoomResult.reason, FRONTEND_FAILURE.SYMBOL_CLIPPED);
  assert.equal(zoomResult.detail.pipelineStage, 'bootstrap-finder');
});

test('동일 입력 두 번은 성공 결과와 진단까지 동일', {
  timeout: 30_000,
}, () => {
  const fixture = render('deterministic', 1, 'M');
  const first = decodeFrontend(fixture.raster);
  const second = decodeFrontend(fixture.raster);
  assert.deepEqual(second, first);
});

test('복수 body-valid 후보는 hard reject하지 않고 점수와 고정 총순서로 선택', () => {
  const base = {
    text: 'winner',
    corrected: 0,
    crsDistance: 0,
    formatAgreement: 1,
    referenceAgreement: 1,
    rH: 0,
    rK: 0,
  };
  const result = selectGridHypothesis([
    { ...base, hypothesisId: 'b', crsDistance: 2 },
    { ...base, hypothesisId: 'a' },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.candidate.hypothesisId, 'a');
  assert.equal(result.diagnostics.bodyValidCount, 2);
});

test('Type Y body-valid 방향에서 서로 다른 복호 결과가 나오면 거부', () => {
  const base = {
    family: 'cube',
    tones: 3,
    formatIndex: 10,
    eccLevel: 'M',
    text: 'ambiguous',
    corrected: 0,
    crsDistance: 0,
    formatAgreement: 1,
    referenceAgreement: 1,
    rH: 0,
    rK: 0,
  };
  const result = selectGridHypothesis([
    { ...base, hypothesisId: 'o0', hypothesis: { orientation: 0, tones: 3 } },
    {
      ...base,
      hypothesisId: 'o1',
      text: 'different',
      hypothesis: { orientation: 1, tones: 3 },
    },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.detail.pipelineCode, 'CUBE_DIRECTION_AMBIGUOUS');
  assert.deepEqual(
    result.detail.solutions.map((entry) => entry.orientations),
    [[0], [1]],
  );
});

// ── 패밀리 재배치 (CRC 유효 out-of-family → 재시도) ──────────────────────────
//
// 실기기 Type A 사진이 죽던 경로다: 분류기가 실패해 hex 로 폴백하면, 포맷 셀은
// 불스아이 근방이라 패밀리와 거의 무관하게 **정확히 읽히는데**(복제 3/3 합의 + CRC 통과)
// 그 인덱스가 hex 의 허용 집합 밖이라 `versionOutsideFamily` 로 폐기됐다.
// 상세 = 문서 repo `.agent/decoder/004_real_photo_findings.md`.

function renderA(text, version, eccLevel, options = {}) {
  const encoded = encodeA(text, { version, eccLevel });
  const scene = buildScene(encoded, { palette: PALETTE, margin: options.margin });
  return rasterize(scene, {
    pixelsPerUnit: options.pixelsPerUnit === undefined ? 12 : options.pixelsPerUnit,
    supersample: options.supersample === undefined ? 1 : options.supersample,
  });
}

test('재배치: tri 코드를 hex 로 오분류해도 복호된다 (실사진 실패 경로)', () => {
  const raster = renderA('relocate-me', 0, 'M', { margin: 20 });

  // 전제 — 강제 hex 는 "정답을 읽고도 버리는" 그 상태여야 한다.
  const forcedNoRelocation = decodeFrontend(raster, {
    familyEvidence: { family: 'hex' },
    bootstrap: { _familyRelocation: false },
  });
  assert.equal(forcedNoRelocation.ok, false,
    '전제 위반: 재배치 없이도 hex 로 복호된다 — 이 테스트는 결함 영역을 못 건드린다');

  /*
   * 재배치가 켜지면 같은 입력이 복호돼야 한다.
   *
   * ⚠ `_formatRecast: false` 로 **포맷 재라벨을 끈다.** 재라벨은 재배치보다 먼저 시도되고
   *   같은 입력을 같은 결과로 구제하므로(2026-08-13 도입), 켜 두면 이 테스트가 재배치가
   *   아니라 재라벨을 재게 된다 — 재배치 경로의 보증이 조용히 사라진다.
   *   두 경로를 각각 검증하려면 여기서 하나를 꺼야 한다.
   */
  const relocated = decodeFrontend(raster, {
    familyEvidence: { family: 'hex' },
    bootstrap: { _formatRecast: false },
  });
  assert.equal(relocated.ok, true,
    `재배치 실패: ${relocated.reason} ${JSON.stringify(relocated.detail && relocated.detail.relocation)}`);
  assert.equal(relocated.text, 'relocate-me');

  const relocation = relocated.diagnostics.bootstrap.relocation;
  assert.ok(relocation, '재배치 진단이 없다 — 다른 경로로 우연히 성공했을 수 있다');
  assert.equal(relocation.to, 'tri');
  assert.ok(relocation.evidence.length > 0 && relocation.evidence[0].formatIndex === 1,
    `A0 의 포맷 인덱스 1 이 근거로 남아야 한다: ${JSON.stringify(relocation.evidence)}`);
});

test('재배치: 정상 hex 코드의 결과를 바꾸지 않는다 (회귀)', () => {
  for (const version of [1, 2, 3]) {
    const { raster } = render('hex-unchanged', version, 'M');
    const withRelocation = decodeFrontend(raster);
    const without = decodeFrontend(raster, { bootstrap: { _familyRelocation: false } });
    assert.equal(withRelocation.ok, true, `V${version} 복호 실패`);
    assert.equal(withRelocation.text, without.text, `V${version} 텍스트가 달라졌다`);
    assert.equal(withRelocation.version, without.version, `V${version} 버전이 달라졌다`);
    // 정상 경로에서는 재배치가 **아예 발동하지 않아야** 한다 (비용 0).
    assert.equal(withRelocation.diagnostics.bootstrap.relocation, undefined,
      `V${version}: 정상 경로에서 재배치가 발동했다 — 비용이 새고 있다`);
  }
});

test('재배치: CRC 가 틀린 포맷은 재배치를 트리거하지 않는다', () => {
  // 코드가 전혀 없는 프레임 — 포맷 읽기가 나오더라도 CRC 가 맞을 리 없다.
  const noise = gradientRaster(320, 320);
  const result = decodeFrontend(noise);
  assert.equal(result.ok, false);
  const relocation = result.detail && result.detail.relocation;
  if (relocation) {
    assert.equal(relocation.targets.length, 0,
      `CRC 불일치인데 재배치 대상이 잡혔다: ${JSON.stringify(relocation.evidence)}`);
  }
});


const CENTER_QR_TEXT = 'HTTPS://TL.ESTRE.SO/';

function renderCenterQr(type, text) {
  let encoded;
  let scene;
  if (type === 'O') {
    encoded = encode(text, { version: 2, eccLevel: 'M', centerQr: true });
    scene = buildScene(encoded, {
      palette: PALETTE,
      centerQr: true,
      qrText: CENTER_QR_TEXT,
      margin: 20,
    });
  } else if (type === 'A') {
    encoded = encodeA(text, { version: 1, eccLevel: 'M', centerQr: true });
    scene = buildScene(encoded, {
      palette: PALETTE,
      centerQr: true,
      qrText: CENTER_QR_TEXT,
      margin: 20,
    });
  } else if (type === 'Y') {
    // Type Y 의 "안쪽 QR"은 O/A의 centerQr 포맷 축이 아니라 Y2 윈도 β다.
    encoded = encodeY(text, { version: 2, eccLevel: 'M', tones: 2, window: true });
    scene = buildSceneY(encoded, {
      palette: PALETTE,
      qrText: CENTER_QR_TEXT,
      cornerQr: false,
      margin: 4,
    });
  } else {
    throw new RangeError('알 수 없는 타입: ' + type);
  }
  return {
    encoded,
    raster: rasterize(scene, { pixelsPerUnit: 12, supersample: 1 }),
  };
}

test('중앙 QR 축: Type O/A 중앙 슬롯과 Type Y 윈도 β를 앞단이 복호', {
  timeout: 180_000,
}, () => {
  for (const type of ['O', 'A', 'Y']) {
    const text = 'center-qr-' + type;
    const fixture = renderCenterQr(type, text);
    assert.equal(
      type === 'Y' ? fixture.encoded.window : fixture.encoded.centerQr,
      true,
      type + ': 픽스처가 중앙 QR 결함 영역을 실제로 건드리지 않는다',
    );

    const result = decodeFrontend(fixture.raster);
    assert.equal(result.ok, true, failureMessage('center-qr', type, result));
    assert.equal(result.text, text, failureMessage('center-qr', type, result));
    assert.equal(result.family, type === 'O' ? 'hex' : type === 'A' ? 'tri' : 'cube');
    if (type !== 'Y') {
      assert.equal(result.hypothesis.centerQr, true);
    }
  }
});


function renderCornerQr(type, text) {
  let encoded;
  let scene;
  if (type === 'O') {
    encoded = encode(text, { version: 2, eccLevel: 'M' });
    scene = buildScene(encoded, {
      palette: PALETTE,
      qrText: CENTER_QR_TEXT,
      qrCorner: 'TL',
      margin: 20,
    });
  } else if (type === 'A') {
    encoded = encodeA(text, { version: 1, eccLevel: 'M' });
    scene = buildScene(encoded, {
      palette: PALETTE,
      qrText: CENTER_QR_TEXT,
      qrCorner: 'TL',
      margin: 20,
    });
  } else {
    encoded = encodeY(text, { version: 2, eccLevel: 'M', tones: 2 });
    scene = buildSceneY(encoded, {
      palette: PALETTE,
      qrText: CENTER_QR_TEXT,
      qrCorner: 'TL',
      cornerQr: true,
      margin: 20,
    });
  }
  return rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
}

test('코너 QR은 중앙 QR로 승격하지 않는다', {
  timeout: 180_000,
}, () => {
  for (const type of ['O', 'A', 'Y']) {
    const text = 'corner-qr-' + type;
    const result = decodeFrontend(renderCornerQr(type, text), {
      // QR 후보를 의도적으로 함께 평가해도 정상 포맷/본문 후보가 이겨야 한다.
      bootstrap: { _forceQrFinder: true },
    });
    assert.equal(result.ok, true, failureMessage('corner-qr', type, result));
    assert.equal(result.text, text, failureMessage('corner-qr', type, result));
    assert.equal(result.family, type === 'O' ? 'hex' : type === 'A' ? 'tri' : 'cube');
    assert.notEqual(result.hypothesis.centerQr, true);
    assert.notEqual(result.hypothesis.window, true);
  }
});


const CENTER_QR_PHOTO_DUMPS = listLumaDumps()
  .filter((entry) =>
    entry.name.startsWith('centerqr-') && entry.name.endsWith('.1440.luma'));

test('중앙 QR 16비트 실사진: 세 타입 8/9 복호 성적을 유지', {
  timeout: 240_000,
  skip: CENTER_QR_PHOTO_DUMPS.length === 0
    ? '중앙 QR TLL2 휘도 덤프가 없어 실사진 가드를 건너뜀'
    : false,
}, () => {
  const expectedFamily = (name) => {
    if (name.includes('080805616')) return 'hex';
    if (name.includes('080809884')) return 'tri';
    if (name.includes('080813540')) return 'cube';
    throw new Error('알 수 없는 중앙 QR 실사진 덤프: ' + name);
  };
  const results = CENTER_QR_PHOTO_DUMPS.map((entry) => {
    const luma = readLumaDump(entry.path);
    assert.equal(luma.bitDepth, 16, entry.name + ': 구형 8비트 덤프는 가드에 쓰지 않는다');
    const enumerated = enumerateGridHypotheses(luma);
    const selected = enumerated.ok
      ? selectGridHypothesis(enumerated.candidates)
      : enumerated;
    return { entry, selected };
  });

  const successes = results.filter(({ selected }) => selected.ok);
  assert.equal(successes.length, 8, results.map(({ entry, selected }) => ({
    name: entry.name,
    ok: selected.ok,
    reason: selected.reason,
  })));

  const counts = { hex: 0, tri: 0, cube: 0 };
  for (const { entry, selected } of successes) {
    assert.equal(selected.candidate.text, 'https://tl.estre.so', entry.name);
    const family = expectedFamily(entry.name);
    assert.equal(selected.candidate.family, family, entry.name);
    counts[family] += 1;
    if (family === 'cube') {
      assert.equal(selected.candidate.hypothesis.window, true, entry.name);
    } else {
      assert.equal(selected.candidate.hypothesis.centerQr, true, entry.name);
    }
  }
  assert.deepEqual(counts, { hex: 3, tri: 2, cube: 3 });

  const failures = results.filter(({ selected }) => !selected.ok);
  assert.deepEqual(
    failures.map(({ entry }) => entry.name),
    ['centerqr-080809884_01.1440.luma'],
  );
});


const CELL_FINDER_REAL_PHOTO_CASES = Object.freeze([
  { name: 'cellfinder-20260812-07.960.luma', patternId: 'gap-ring-01-2-1-solid' },
  { name: 'cellfinder-20260812-09.960.luma', patternId: 'gap-ring-01-2-1-open' },
  { name: 'cellfinder-20260812-14.1440.luma', patternId: 'flower-7-1020-coprime-offset' },
]);
const CELL_FINDER_REAL_PHOTO_DUMPS = new Map(
  listLumaDumps().map((entry) => [entry.name, entry]),
);

test('19셀 파인더 16비트 실사진: 검출 성공 3장을 본문까지 복호', {
  timeout: 300_000,
  skip: CELL_FINDER_REAL_PHOTO_CASES.every(({ name }) =>
    CELL_FINDER_REAL_PHOTO_DUMPS.has(name))
    ? false
    : '19셀 파인더 TLL2 휘도 덤프 3장이 없어 실사진 가드를 건너뜀',
}, () => {
  for (const expected of CELL_FINDER_REAL_PHOTO_CASES) {
    const entry = CELL_FINDER_REAL_PHOTO_DUMPS.get(expected.name);
    const luma = readLumaDump(entry.path);
    assert.equal(luma.bitDepth, 16, entry.name);
    const result = decodeFrontend(lumaToRaster(luma));
    assert.equal(result.ok, true, JSON.stringify({
      name: entry.name,
      reason: result.reason,
      detail: result.detail,
    }));
    assert.equal(result.text, 'https://tl.estre.so', entry.name);
    assert.equal(result.family, 'tri', entry.name);
    assert.equal(result.hypothesis.source, 'cell-finder', entry.name);
    assert.match(result.hypothesis.id, new RegExp(expected.patternId), entry.name);
  }
});

const BULLSEYE_REAL_PHOTO_DUMPS = listLumaDumps().filter((entry) =>
  entry.name.endsWith('.1440.luma')
  && (
    entry.name.startsWith('015529194')
    || entry.name.startsWith('KakaoTalk_20260811_014930219')
    || entry.name.startsWith('KakaoTalk_20260811_015525403')
    || entry.name.startsWith('typeO-fold-')
    || entry.name.startsWith('video-')
  ));

test('기존 불스아이 실사진: 1440 기준 12/17 복호 성적을 유지', {
  timeout: 600_000,
  skip: BULLSEYE_REAL_PHOTO_DUMPS.length === 17
    ? false
    : '기존 불스아이 TLL2 휘도 덤프 17장이 없어 실사진 가드를 건너뜀',
}, () => {
  const results = BULLSEYE_REAL_PHOTO_DUMPS.map((entry) => {
    const luma = readLumaDump(entry.path);
    assert.equal(luma.bitDepth, 16, entry.name);
    return { entry, result: decodeFrontend(lumaToRaster(luma)) };
  });
  const successes = results.filter(({ result }) => result.ok);
  /*
   * 9 → 12. «포맷 재라벨» 로 3장이 새로 복호됐고 **죽은 장은 0** 이다
   * (2026-08-13, `.agent/decoder/008`). 신규 3장은 텍스트·패밀리·버전·ECC 가 전부
   * 정답이라 오탐이 아니다. 개수를 못박은 이 단언 덕에 «집합이 바뀌었나» 를 확인하게 됐다 —
   * 숫자를 올릴 때는 **어느 장이 늘었는지** 를 확인하고 올린다.
   */
  assert.equal(successes.length, 12, results.map(({ entry, result }) => ({
    name: entry.name,
    ok: result.ok,
    reason: result.reason,
    stage: result.detail?.pipelineStage,
    code: result.detail?.pipelineCode,
  })));
  for (const { entry, result } of successes) {
    assert.equal(result.text, 'https://tl.estre.so', entry.name);
  }
});

test('onStage 훅이 없어도 반환 계약은 같다', () => {
  const raster = {
    width: 8,
    height: 8,
    pixels: new Uint8ClampedArray(8 * 8 * 4),
  };
  const plain = decodeFrontend(raster);
  const hooked = decodeFrontend(raster, { onStage() {} });
  assert.equal(plain.ok, hooked.ok);
  assert.equal(plain.reason, hooked.reason);
});
