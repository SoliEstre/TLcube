/**
 * decoder-cube.test.js — Type Y 독립 영상 앞단의 합성 known-answer 검증.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeY } from '../src/encodeY.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
  relativeLuminance,
} from '../src/luminance.js';
import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectCubeHypotheses } from '../src/decoder/cube-detect.js';
import { distortImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const ECC_LEVELS = Object.freeze(['L', 'M', 'H']);

function renderY(text, {
  version = 1,
  tones = 2,
  eccLevel = 'M',
  pixelsPerUnit = 12,
  supersample = 2,
  margin,
} = {}) {
  const encoded = encodeY(text, { version, tones, eccLevel });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin });
  const raster = rasterize(scene, { pixelsPerUnit, supersample });
  return { encoded, scene, raster, pixelsPerUnit };
}

function rasterToLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  const alpha = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const offset = index * 4;
    data[index] = relativeLuminance({
      r: raster.pixels[offset],
      g: raster.pixels[offset + 1],
      b: raster.pixels[offset + 2],
    });
    alpha[index] = raster.pixels[offset + 3];
  }
  return { width: raster.width, height: raster.height, data, alpha };
}

function assertYDecoded(result, text, version, tones) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.text, text);
  assert.equal(result.family, 'cube');
  assert.equal(result.version, version);
  assert.equal(result.tones, tones);
  assert.equal(result.hypothesis.family, 'cube');
  assert.equal(result.hypothesis.n, [13, 21, 25][version]);
}

function gaussianBlur(raster, sigma) {
  const radius = Math.ceil(3 * sigma);
  const weights = new Float64Array(radius * 2 + 1);
  let weightSum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset + radius] = weight;
    weightSum += weight;
  }
  for (let index = 0; index < weights.length; index += 1) weights[index] /= weightSum;

  const { width, height } = raster;
  const horizontal = new Float32Array(width * height * 3);
  const pixels = new Uint8ClampedArray(raster.pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const sourceX = Math.max(0, Math.min(width - 1, x + offset));
          sum += raster.pixels[(y * width + sourceX) * 4 + channel]
            * weights[offset + radius];
        }
        horizontal[(y * width + x) * 3 + channel] = sum;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const sourceY = Math.max(0, Math.min(height - 1, y + offset));
          sum += horizontal[(sourceY * width + x) * 3 + channel]
            * weights[offset + radius];
        }
        pixels[(y * width + x) * 4 + channel] = Math.round(sum);
      }
    }
  }
  return { ...raster, pixels };
}

function checkerClutter(fixture) {
  const width = 1100;
  const height = 760;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const tile = 18;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 ? 205 : 235;
      const offset = (y * width + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }

  const rect = (x0, y0, rectWidth, rectHeight, color) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y0 + rectHeight); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(width, x0 + rectWidth); x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = 255;
      }
    }
  };

  // 우측 생성기 UI 모사.
  rect(850, 30, 220, 700, [246, 247, 250]);
  for (let line = 0; line < 12; line += 1) {
    rect(880, 70 + line * 42, 150 - (line % 3) * 20, 8, [70, 78, 92]);
  }
  rect(890, 630, 140, 48, [45, 110, 220]);

  // 좌상단 폴백 QR 모사. RNG 없이 고정 패턴만 사용한다.
  rect(22, 22, 142, 142, [255, 255, 255]);
  for (let qy = 0; qy < 21; qy += 1) {
    for (let qx = 0; qx < 21; qx += 1) {
      const finder = (qx < 7 && qy < 7)
        || (qx > 13 && qy < 7)
        || (qx < 7 && qy > 13);
      const dark = finder || (qx * 3 + qy * 5 + qx * qy) % 7 < 3;
      if (dark) rect(30 + qx * 6, 30 + qy * 6, 6, 6, [10, 10, 10]);
    }
  }

  // 생성기 래스터의 직사각형 배경은 버리고 정육각형 실루엣만 합성한다.
  const { raster, scene, pixelsPerUnit } = fixture;
  const sourceCenter = {
    x: scene.layout.originX * pixelsPerUnit,
    y: scene.layout.originY * pixelsPerUnit,
  };
  const polygon = CORNER_UNIT_OFFSETS.map((corner) => ({
    x: sourceCenter.x + corner.x * scene.layout.n * pixelsPerUnit,
    y: sourceCenter.y + corner.y * scene.layout.n * pixelsPerUnit,
  }));
  const inside = (px, py) => {
    let sign = 0;
    for (let edge = 0; edge < polygon.length; edge += 1) {
      const a = polygon[edge];
      const b = polygon[(edge + 1) % polygon.length];
      const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
      if (Math.abs(cross) < 1e-6) continue;
      const next = cross > 0 ? 1 : -1;
      if (sign === 0) sign = next;
      else if (sign !== next) return false;
    }
    return true;
  };
  const offsetX = 430 - Math.round(sourceCenter.x);
  const offsetY = 380 - Math.round(sourceCenter.y);
  for (let sourceY = 0; sourceY < raster.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < raster.width; sourceX += 1) {
      if (!inside(sourceX + 0.5, sourceY + 0.5)) continue;
      const targetX = sourceX + offsetX;
      const targetY = sourceY + offsetY;
      if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
      const sourceOffset = (sourceY * raster.width + sourceX) * 4;
      const targetOffset = (targetY * width + targetX) * 4;
      pixels.set(raster.pixels.subarray(sourceOffset, sourceOffset + 3), targetOffset);
      pixels[targetOffset + 3] = 255;
    }
  }
  return { width, height, pixels };
}

test('Type Y clean: n=13/21/25 x 2/3 tones x ECC L/M/H 18 combinations', {
  timeout: 180_000,
}, () => {
  for (const version of [0, 1, 2]) {
    for (const tones of [2, 3]) {
      for (const eccLevel of ECC_LEVELS) {
        const text = 'Y' + version + '-' + tones + 'T-' + eccLevel;
        const fixture = renderY(text, { version, tones, eccLevel });
        assertYDecoded(decodeFrontend(fixture.raster), text, version, tones);
      }
    }
  }
});

test('Type Y low resolution ppu=8 and asymmetric references leave one orientation', {
  timeout: 30_000,
}, () => {
  const fixture = renderY('orientation', {
    version: 0,
    tones: 2,
    eccLevel: 'M',
    pixelsPerUnit: 8,
  });
  const detected = detectCubeHypotheses(rasterToLuma(fixture.raster));
  assert.equal(detected.ok, true, JSON.stringify(detected));
  assert.ok(detected.hypotheses.length >= 1);
  assert.deepEqual(
    Array.from(new Set(detected.hypotheses.map((entry) => entry.orientation))),
    [1],
  );
  assert.ok(detected.hypotheses.every((entry) => entry.referenceAgreement === 1));
  assertYDecoded(decodeFrontend(fixture.raster), 'orientation', 0, 2);
});

test('Type Y rotation 0..330 degrees in 30-degree steps', {
  timeout: 120_000,
}, () => {
  const text = 'type-y-rotation';
  const fixture = renderY(text, { margin: 12 });
  for (let degrees = 0; degrees < 360; degrees += 30) {
    const distorted = distortImage(fixture.raster, { rotation: degrees, fill: FILL });
    assertYDecoded(decodeFrontend(distorted), text, 1, 2);
  }
});

test('Type Y perspective -30..30 degrees on both axes', {
  timeout: 180_000,
}, () => {
  const text = 'type-y-perspective';
  const fixture = renderY(text, { margin: 18 });
  for (const axis of ['horizontal', 'vertical']) {
    for (const degrees of [-30, -20, -10, 0, 10, 20, 30]) {
      const distorted = distortImage(fixture.raster, {
        perspective: { degrees, axis },
        fill: FILL,
      });
      assertYDecoded(decodeFrontend(distorted), text, 1, 2);
    }
  }
});

test('Type Y scale 0.5..2 and blur sigma up to 2.6', {
  timeout: 180_000,
}, () => {
  const text = 'type-y-scale-blur';
  const scaleFixture = renderY(text, {
    pixelsPerUnit: 20,
    margin: 25,
  });
  for (const scale of [0.5, 0.6, 0.75, 1, 1.25, 1.5, 2]) {
    const distorted = distortImage(scaleFixture.raster, { scale, fill: FILL });
    assertYDecoded(decodeFrontend(distorted), text, 1, 2);
  }

  const blurFixture = renderY(text, { margin: 12 });
  for (const sigma of [0.5, 1, 1.5, 2, 2.6]) {
    assertYDecoded(decodeFrontend(gaussianBlur(blurFixture.raster, sigma)), text, 1, 2);
  }
});

test('Type Y checkerboard + UI + fallback QR clutter, partial frame occupancy', {
  timeout: 30_000,
}, () => {
  const text = 'checker-ui-qr';
  const fixture = renderY(text, {
    pixelsPerUnit: 8,
    margin: 6,
  });
  assertYDecoded(decodeFrontend(checkerClutter(fixture)), text, 1, 2);
});

test('family split: clean Type O stays hex and Type Y stays cube', {
  timeout: 30_000,
}, () => {
  const oText = 'type-o-regression';
  const encodedO = encode(oText, { version: 1, eccLevel: 'M' });
  const sceneO = buildScene(encodedO, { palette: PALETTE });
  const rasterO = rasterize(sceneO, { pixelsPerUnit: 12, supersample: 1 });
  const decodedO = decodeFrontend(rasterO);
  assert.equal(decodedO.ok, true, JSON.stringify(decodedO));
  assert.equal(decodedO.text, oText);
  assert.equal(decodedO.family, 'hex');

  const y = renderY('type-y-family');
  assertYDecoded(decodeFrontend(y.raster), 'type-y-family', 1, 2);
});
