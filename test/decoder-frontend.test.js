/**
 * decoder-frontend.test.js — oracle 기하 없이 닫는 첫 decoder end-to-end.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import {
  FRONTEND_FAILURE,
  HOMOGRAPHY_CANONICAL_SPACE,
} from '../src/decoder/contracts.js';
import {
  selectGridHypothesis,
} from '../src/decoder/bootstrap.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import {
  applyJpegApproximation,
  distortImage,
  scaleImage,
} from './harness/distort.mjs';

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
