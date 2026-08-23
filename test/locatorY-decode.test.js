/**
 * locatorY-decode.test.js — 로케이터 왕복·회전·열화·음성·레거시.
 *
 * 생성은 페이로드를 회전하지 않는다. 회전은 렌더된 래스터에만 적용한다.
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
import { detectLocatorY, shrinkSilhouetteToCubeCandidates } from '../src/decoder/locatorY-detect.js';
import { detectCubeHypotheses } from '../src/decoder/cube-detect.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset, relativeLuminance,
} from '../src/luminance.js';
import { qrMatrix } from '../src/qr.js';
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

function renderY(text, {
  version = 0,
  tones = 3,
  eccLevel = 'M',
  pixelsPerUnit = 10,
  supersample = 2,
  margin = 16,
  locatorProfile = 'hex-frame-v1',
} = {}) {
  const encoded = encodeY(text, { version, tones, eccLevel });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin, locatorProfile });
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

function decodeOk(raster, text, version, tones, context = '') {
  const result = decodeFrontend(raster, {
    bootstrap: { family: { cube: { enableLocatorY: true } } },
  });
  assert.equal(result.ok, true, JSON.stringify({
    context,
    reason: result.reason,
    detail: result.detail && {
      stage: result.detail.stage,
      pipelineCode: result.detail.pipelineCode,
    },
  }));
  assert.equal(result.text, text);
  assert.equal(result.family, 'cube');
  assert.equal(result.version, version);
  assert.equal(result.tones, tones);
  return result;
}

test('Y0T + hex-frame-v1 가 https://tl.estre.so 를 왕복한다', {
  timeout: 60_000,
}, () => {
  const fixture = renderY(PAYLOAD, { version: 0, tones: 3, eccLevel: 'M' });
  const result = decodeOk(fixture.raster, PAYLOAD, 0, 3);
  assert.ok(
    result.hypothesis.source === 'locator-hex-frame-v1'
    || result.hypothesis.source === 'cube-silhouette-y-junction',
  );
  if (result.hypothesis.source === 'locator-hex-frame-v1') {
    assert.equal(result.hypothesis.locatorProfile, 'hex-frame-v1');
    assert.equal(result.hypothesis.locatorRoute, 'hex-frame');
  }
  const stable = detectCubeHypotheses(rasterToLuma(fixture.raster));
  const stableLocator = stable.ok
    ? stable.diagnostics.locator
    : stable.detail?.diagnostics?.locator;
  assert.ok(stableLocator, '기본 비활성 로케이터 진단이 있어야 한다');
  assert.equal(stableLocator.enabled, false);
  assert.equal(stableLocator.source, 'disabled');
  const detected = detectCubeHypotheses(rasterToLuma(fixture.raster), null, {
    enableLocatorY: true,
  });
  assert.equal(detected.ok, true, JSON.stringify(detected.reason));
  assert.ok(detected.diagnostics.locator, 'locator 진단이 있어야 한다');
  assert.equal(detected.diagnostics.locator.enabled, true);
});

test('로케이터 래스터를 0/30/60/90/120/180/270 도 회전해도 Y0T 가 복호된다', {
  timeout: 180_000,
}, () => {
  const fixture = renderY(PAYLOAD, { version: 0, tones: 3, margin: 18, pixelsPerUnit: 10 });
  let phaseGuidedAngles = 0;
  let fallbackAngles = 0;
  for (const degrees of [0, 30, 60, 90, 120, 180, 270]) {
    const rotated = distortImage(fixture.raster, { rotation: degrees, fill: FILL });
    const result = decodeOk(rotated, PAYLOAD, 0, 3, `rotation=${degrees}`);
    if (result.hypothesis.source === 'locator-hex-frame-v1') {
      assert.ok(result.hypothesis.locatorPhase, `rotation=${degrees} C형 위상 진단이 없다`);
      assert.equal(typeof result.hypothesis.locatorPhase.reliable, 'boolean');
    }
    const detected = detectCubeHypotheses(rasterToLuma(rotated), null, {
      enableLocatorY: true,
    });
    assert.equal(detected.ok, true, `rotation=${degrees} 기하 후보가 없다`);
    if (detected.hypotheses.some((hypothesis) => hypothesis.locatorPhase?.used === true)) {
      phaseGuidedAngles += 1;
    } else if (detected.hypotheses.some((hypothesis) => hypothesis.locatorPhase?.fallback === true)) {
      fallbackAngles += 1;
    }
  }
  assert.ok(phaseGuidedAngles >= 4, `C형 갭이 회전 위상에 쓰인 각도가 적다: ${phaseGuidedAngles}`);
  assert.ok(fallbackAngles >= 1, '갭이 불명확한 각도에서 기존 방향 탐색 폴백이 없다');
});

test('로케이터 열화 행렬 — 통과 봉투와 실패 경계를 기록한다', {
  timeout: 240_000,
}, () => {
  const scales = [8, 10, 12];
  const rows = [];
  for (const ppu of scales) {
    const fixture = renderY(PAYLOAD, {
      version: 0, tones: 3, pixelsPerUnit: ppu, margin: 16,
    });
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
      {
        name: 'jpeg-q30',
        raster: applyJpegApproximation(fixture.raster, 30),
        expect: 'pass',
      },
      {
        name: 'perspective-8',
        raster: distortImage(fixture.raster, {
          perspective: { degrees: 8, axis: 'horizontal' },
          fill: FILL,
        }),
        expect: 'pass',
      },
      // 실패 경계 — 주장을 약하게 만들지 않는다.
      { name: 'blur-2.4', raster: gaussianBlur(fixture.raster, 2.4), expect: 'fail' },
      { name: 'contrast-0.22', raster: contrastScale(fixture.raster, 0.22), expect: 'fail' },
      {
        name: 'jpeg-q18',
        raster: applyJpegApproximation(fixture.raster, 18),
        expect: 'fail',
      },
    ];
    for (const item of cases) {
      const result = decodeFrontend(item.raster, {
        bootstrap: { family: { cube: { enableLocatorY: true } } },
      });
      const ok = result.ok === true && result.text === PAYLOAD;
      rows.push({ ppu, name: item.name, expect: item.expect, ok });
      if (item.expect === 'pass') {
        assert.equal(ok, true, `ppu=${ppu} ${item.name} 는 통과 봉투다: ${result.reason}`);
      }
    }
  }
  const boundary = rows.filter((row) => row.expect === 'fail');
  assert.ok(boundary.length >= 3, '실패 경계 사례가 있어야 한다');
  // 극단은 통과를 강제하지 않는다. 다만 전부 우연히 통과하면 경계가 거짓이다.
  const failed = boundary.filter((row) => !row.ok);
  assert.ok(failed.length >= 1,
    `실패 경계(blur-2.4 / contrast-0.22)가 한 건도 안 죽었다 — 경계를 다시 재야 한다: ${
      JSON.stringify(boundary)}`);
});

test('무표시 Type Y 와 Type O/A 는 로케이터 없이도 그대로 복호된다', {
  timeout: 90_000,
}, () => {
  const unmarked = renderY('legacy-y', {
    version: 0, tones: 3, locatorProfile: 'off', pixelsPerUnit: 10,
  });
  decodeOk(unmarked.raster, 'legacy-y', 0, 3);

  const o = encode('legacy-o', { version: 1, eccLevel: 'M' });
  const sceneO = buildScene(o, { palette: PALETTE });
  const rasterO = rasterize(sceneO, { pixelsPerUnit: 10, supersample: 2 });
  const decodedO = decodeFrontend(rasterO);
  assert.equal(decodedO.ok, true, JSON.stringify(decodedO.reason));
  assert.equal(decodedO.text, 'legacy-o');
  assert.equal(decodedO.family, 'hex');

  const a = encodeA('legacy-a', { version: 0, eccLevel: 'M' });
  const sceneA = buildScene(a, { palette: PALETTE, margin: 20 });
  const rasterA = rasterize(sceneA, { pixelsPerUnit: 10, supersample: 2 });
  const decodedA = decodeFrontend(rasterA);
  assert.equal(decodedA.ok, true, JSON.stringify(decodedA.reason));
  assert.equal(decodedA.text, 'legacy-a');
  assert.equal(decodedA.family, 'tri');
});

test('QR·그라데이션·선화는 Type Y 로 오인되지 않는다', {
  timeout: 30_000,
}, () => {
  const qr = qrMatrix('HTTPS://TL.ESTRE.SO');
  const module = 4;
  const width = qr.size * module;
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      const dark = qr.modules[y * qr.size + x] === 1;
      const v = dark ? 0 : 255;
      for (let oy = 0; oy < module; oy += 1) {
        for (let ox = 0; ox < module; ox += 1) {
          const o = ((y * module + oy) * width + (x * module + ox)) * 4;
          pixels[o] = v;
          pixels[o + 1] = v;
          pixels[o + 2] = v;
          pixels[o + 3] = 255;
        }
      }
    }
  }
  const qrRaster = { width, height: width, pixels };
  const qrResult = decodeFrontend(qrRaster);
  assert.equal(qrResult.ok, false, 'QR 이 TLcube 로 복호되면 안 된다');

  const locatorOnQr = detectLocatorY(rasterToLuma(qrRaster));
  assert.equal(locatorOnQr.ok, true);
  assert.equal(locatorOnQr.candidates.length, 0, 'QR 에서 로케이터 후보가 나오면 안 된다');

  const gW = 64;
  const gPixels = new Uint8ClampedArray(gW * gW * 4);
  for (let y = 0; y < gW; y += 1) {
    for (let x = 0; x < gW; x += 1) {
      const v = Math.round(255 * (x + y) / (2 * gW - 2));
      const o = (y * gW + x) * 4;
      gPixels[o] = v;
      gPixels[o + 1] = v;
      gPixels[o + 2] = v;
      gPixels[o + 3] = 255;
    }
  }
  const grad = decodeFrontend({ width: gW, height: gW, pixels: gPixels });
  assert.equal(grad.ok, false);

  const lineW = 120;
  const linePixels = new Uint8ClampedArray(lineW * lineW * 4);
  linePixels.fill(255);
  for (let i = 0; i < lineW * lineW; i += 1) linePixels[i * 4 + 3] = 255;
  for (let x = 10; x < 110; x += 1) {
    for (const y of [20, 60, 100]) {
      const o = (y * lineW + x) * 4;
      linePixels[o] = 0;
      linePixels[o + 1] = 0;
      linePixels[o + 2] = 0;
    }
  }
  const lines = decodeFrontend({ width: lineW, height: lineW, pixels: linePixels });
  assert.equal(lines.ok, false);
});

test('F-94: calibration.locatorY minimumHubContrast 는 hub support 카운터에 닿는다 (흔들면 변한다)', {
  timeout: 30_000,
}, () => {
  const fixture = renderY(PAYLOAD, { version: 0, tones: 3 });
  const luma = rasterToLuma(fixture.raster);
  const detected = detectCubeHypotheses(luma, null, { finderFirst: false, enableLocatorY: true });
  assert.equal(detected.ok, true, JSON.stringify(detected.reason || detected));
  const emitted = (detected.diagnostics.shapeCandidates || [])
    .find((entry) => entry.locatorRoute === 'hex-frame' && Array.isArray(entry.ringVertices));
  assert.ok(emitted, 'hex-frame 로케이터 경유 후보가 있어야 한다');
  const shape = { center: emitted.center, vertices: emitted.ringVertices };

  const baseline = shrinkSilhouetteToCubeCandidates(luma, shape, {});
  assert.ok(baseline.length > 0, '기본 문턱에서 shrink 후보가 나와야 한다');
  const baseSupport = baseline[0].seam.positiveRayCount; // = hub.support
  const baseContrast = baseline[0].seam.contrast; // = hub.contrast (3-ray 평균)
  assert.equal(baseSupport, 3, `클린 픽스처는 3 ray 전부 양성이어야 한다: ${baseSupport}`);

  // 문턱을 평균 대비의 1.05배로 올리면 최소 1개 ray 는 반드시 그 아래다 (평균의 정의).
  // 게이트(hub.contrast < 문턱)는 후보를 거부하지만, reject trace 의 support 로
  // «카운터 자체» 가 문턱을 봤는지 관측한다 — 언 상수 버그라면 support 가 3 그대로다.
  const trace = [];
  const shaken = shrinkSilhouetteToCubeCandidates(luma, shape, {
    locatorYDiagnostics: trace,
    calibration: { locatorY: { minimumHubContrast: baseContrast * 1.05 } },
  });
  assert.equal(shaken.length, 0, '올린 문턱은 hub 게이트에서 거부돼야 한다');
  const hubReject = trace.find((entry) => entry.stage === 'hub');
  assert.ok(hubReject, `hub 단계 reject 가 기록돼야 한다: ${JSON.stringify(trace)}`);
  assert.ok(hubReject.support < baseSupport,
    `오버라이드 문턱이 support 카운터에 닿아야 한다 (F-94): ${hubReject.support} vs ${baseSupport}`);
});
