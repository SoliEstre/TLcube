/**
 * cellSurfaceY-decode.test.js — 합성 왕복·회전·열화·음성.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeY } from '../src/encodeY.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectCubeHypotheses } from '../src/decoder/cube-detect.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset, relativeLuminance,
} from '../src/luminance.js';
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
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PAYLOAD = 'https://tl.estre.so';

function renderSurface(text, {
  eccLevel = 'M',
  tones = 2,
  pixelsPerUnit = 10,
  supersample = 2,
  margin = 16,
} = {}) {
  const encoded = encodeY(text, {
    version: 1, tones, eccLevel, cellSurface: true,
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE,
    margin,
    locatorProfile: 'cell-surface-v1',
  });
  const raster = rasterize(scene, { pixelsPerUnit, supersample });
  return { encoded, scene, raster };
}

function renderLegacyY(text, { version = 1, tones = 3, locatorProfile = 'off' } = {}) {
  const encoded = encodeY(text, { version, tones, eccLevel: 'M' });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16, locatorProfile });
  const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
  return { encoded, scene, raster };
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

function toGray(raster) {
  const pixels = new Uint8ClampedArray(raster.pixels);
  for (let i = 0; i < pixels.length; i += 4) {
    const y = Math.round(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
    pixels[i] = y;
    pixels[i + 1] = y;
    pixels[i + 2] = y;
  }
  return { ...raster, pixels };
}

function contrastScale(raster, amount) {
  const pixels = new Uint8ClampedArray(raster.pixels);
  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const v = 128 + (pixels[i + c] - 128) * amount;
      pixels[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
  return { ...raster, pixels };
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
  for (let i = 0; i < weights.length; i += 1) weights[i] /= weightSum;
  const { width, height } = raster;
  const horizontal = new Float32Array(width * height * 3);
  const pixels = new Uint8ClampedArray(raster.pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        let sum = 0;
        for (let o = -radius; o <= radius; o += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + o));
          sum += raster.pixels[(y * width + sx) * 4 + ch] * weights[o + radius];
        }
        horizontal[(y * width + x) * 3 + ch] = sum;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        let sum = 0;
        for (let o = -radius; o <= radius; o += 1) {
          const sy = Math.max(0, Math.min(height - 1, y + o));
          sum += horizontal[(sy * width + x) * 3 + ch] * weights[o + radius];
        }
        pixels[(y * width + x) * 4 + ch] = Math.round(sum);
      }
    }
  }
  return { ...raster, pixels };
}

function decodeLab(raster) {
  return decodeFrontend(raster, {
    bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
  });
}

function decodeOfficial(raster) {
  return decodeFrontend(raster, {});
}

test('Y1-CS / Y1T-CS cell-surface-v1 가 https://tl.estre.so 를 각자 왕복한다', {
  timeout: 90_000,
}, () => {
  for (const tones of [2, 3]) {
    const fixture = renderSurface(PAYLOAD, { tones });
    const result = decodeLab(fixture.raster);
    assert.equal(result.ok, true, JSON.stringify({
      tones,
      reason: result.reason,
      detail: result.detail && { stage: result.detail.stage, pipelineCode: result.detail.pipelineCode },
    }));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.family, 'cube');
    assert.equal(result.tones, tones);
    assert.equal(result.versionName, tones === 3 ? 'Y1T-CS' : 'Y1-CS');
    assert.equal(result.hypothesis.cellSurface, true);
    assert.equal(result.hypothesis.locatorProfile, 'cell-surface-v1');
    assert.equal(result.hypothesis.tones, tones);
    assert.equal(result.diagnostics.format.formatIndex, tones === 3 ? 14 : 12);

    const official = decodeOfficial(fixture.raster);
    assert.notEqual(official.ok && official.hypothesis && official.hypothesis.cellSurface, true);
  }

  const disabled = detectCubeHypotheses(rasterToLuma(renderSurface(PAYLOAD, { tones: 2 }).raster));
  const locator = disabled.ok
    ? disabled.diagnostics.locator
    : disabled.detail && disabled.detail.diagnostics && disabled.detail.diagnostics.locator;
  if (locator) assert.equal(locator.enabled, false);
});

test('cell-surface 회전 0/90/180/270 및 기존 14각 — 2톤·3톤', {
  timeout: 480_000,
}, () => {
  const angles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 15, 45];
  for (const tones of [2, 3]) {
    const fixture = renderSurface(PAYLOAD, { tones, margin: 20, pixelsPerUnit: 10 });
    const rows = [];
    for (const degrees of angles) {
      const rotated = distortImage(fixture.raster, { rotation: degrees, fill: FILL });
      const result = decodeLab(rotated);
      rows.push({
        tones,
        degrees,
        ok: result.ok === true && result.text === PAYLOAD,
        resultTones: result.tones,
        formatIndex: result.diagnostics && result.diagnostics.format
          && result.diagnostics.format.formatIndex,
        source: result.hypothesis && result.hypothesis.source,
        cellSurface: result.hypothesis && result.hypothesis.cellSurface,
      });
    }
    const cardinal = [0, 90, 180, 270].map((deg) => rows.find((row) => row.degrees === deg));
    for (const row of cardinal) {
      assert.equal(row.ok, true, '직각 회전 실패: ' + JSON.stringify(row));
      assert.equal(row.resultTones, tones);
      assert.equal(row.formatIndex, tones === 3 ? 14 : 12);
    }
    const passed = rows.filter((row) => row.ok).length;
    assert.ok(
      passed >= 10,
      '회전 왕복이 부족하다: ' + JSON.stringify(rows),
    );
  }
});

test('cell-surface 열화 행렬 — 2톤·3톤', {
  timeout: 480_000,
}, () => {
  const rows = [];
  for (const tones of [2, 3]) {
    for (const ppu of [8, 10, 12]) {
      const fixture = renderSurface(PAYLOAD, { tones, pixelsPerUnit: ppu, margin: 16 });
      const cases = [
        { name: 'clean', raster: fixture.raster, expect: 'pass' },
        { name: 'grayscale', raster: toGray(fixture.raster), expect: 'pass' },
        { name: 'contrast-0.70', raster: contrastScale(fixture.raster, 0.70), expect: 'pass' },
        { name: 'blur-0.55', raster: gaussianBlur(fixture.raster, 0.55), expect: 'pass' },
        {
          name: 'down2-up',
          raster: scaleImage(scaleImage(fixture.raster, 0.5, { fill: FILL }), 2, { fill: FILL }),
          expect: 'pass',
        },
        { name: 'jpeg-q30', raster: applyJpegApproximation(fixture.raster, 30), expect: 'pass' },
        {
          name: 'perspective-8',
          raster: distortImage(fixture.raster, {
            perspective: { degrees: 8, axis: 'horizontal' },
            fill: FILL,
          }),
          expect: 'pass',
        },
      ];
      for (const item of cases) {
        const result = decodeLab(item.raster);
        const ok = result.ok === true
          && result.text === PAYLOAD
          && result.tones === tones
          && result.diagnostics.format.formatIndex === (tones === 3 ? 14 : 12);
        rows.push({
          tones, ppu, name: item.name, ok, expect: item.expect, reason: result.reason,
          resultTones: result.tones,
          formatIndex: result.diagnostics && result.diagnostics.format
            && result.diagnostics.format.formatIndex,
        });
      }
    }
  }
  const unexpected = rows.filter((row) => row.expect === 'pass' && !row.ok);
  assert.equal(
    unexpected.length,
    0,
    '열화 왕복 실패: ' + JSON.stringify(unexpected),
  );
});

test('2톤·3톤 cell-surface 는 서로를 오수용하지 않는다', {
  timeout: 60_000,
}, () => {
  const two = decodeLab(renderSurface(PAYLOAD, { tones: 2 }).raster);
  const three = decodeLab(renderSurface(PAYLOAD, { tones: 3 }).raster);
  assert.equal(two.ok, true, two.reason);
  assert.equal(three.ok, true, three.reason);
  assert.equal(two.tones, 2);
  assert.equal(three.tones, 3);
  assert.equal(two.diagnostics.format.formatIndex, 12);
  assert.equal(three.diagnostics.format.formatIndex, 14);
  assert.notEqual(two.tones, three.tones);
});

test('legacy Y · hex-frame · O · A 는 cell-surface 로 오수용되지 않는다', {
  timeout: 120_000,
}, () => {
  const cases = [
    { name: 'legacy-Y1', raster: renderLegacyY(PAYLOAD, { version: 1, tones: 2 }).raster },
    { name: 'legacy-Y1T', raster: renderLegacyY(PAYLOAD).raster },
    { name: 'legacy-Y0T-hex', raster: renderLegacyY(PAYLOAD, { version: 0, locatorProfile: 'hex-frame-v1' }).raster },
    {
      name: 'type-O',
      raster: rasterize(buildScene(encode('legacy-o', { version: 1, eccLevel: 'M' }), {
        palette: PALETTE,
      }), { pixelsPerUnit: 10, supersample: 2 }),
    },
    {
      name: 'type-A',
      raster: rasterize(buildScene(encodeA('legacy-a', { version: 0, eccLevel: 'M' }), {
        palette: PALETTE,
        margin: 20,
      }), { pixelsPerUnit: 10, supersample: 2 }),
    },
  ];
  for (const item of cases) {
    const result = decodeLab(item.raster);
    assert.notEqual(
      result.ok && result.hypothesis && result.hypothesis.cellSurface,
      true,
      item.name + ' 가 cell-surface 로 오수용됐다',
    );
  }
});

test('빈 입력은 cell-surface 로 오수용되지 않는다', () => {
  const pixels = new Uint8ClampedArray(64 * 64 * 4);
  const empty = decodeLab({ width: 64, height: 64, pixels });
  assert.notEqual(empty.ok && empty.hypothesis && empty.hypothesis.cellSurface, true);
});
