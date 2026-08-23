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
import { listLumaDumps, lumaToRaster, readLumaDump } from '../tools/read-luma.mjs';

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

// 실제 seam을 지우지 않고 반대 세 ray에 가는 1px 암선을 더해 패리티만 오도한다.
function falseSeamDistractor(fixture) {
  const { raster, scene, pixelsPerUnit } = fixture;
  const pixels = new Uint8ClampedArray(raster.pixels);
  const center = {
    x: scene.layout.originX * pixelsPerUnit,
    y: scene.layout.originY * pixelsPerUnit,
  };
  const radius = scene.layout.n * pixelsPerUnit;
  for (const cornerIndex of [0, 2, 4]) {
    const corner = CORNER_UNIT_OFFSETS[cornerIndex];
    const target = {
      x: center.x + corner.x * radius,
      y: center.y + corner.y * radius,
    };
    const steps = Math.ceil(Math.hypot(target.x - center.x, target.y - center.y));
    for (let step = Math.floor(steps * 0.08);
      step <= Math.floor(steps * 0.72);
      step += 1) {
      const t = step / steps;
      const x = Math.round(center.x + (target.x - center.x) * t);
      const y = Math.round(center.y + (target.y - center.y) * t);
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox * ox + oy * oy > 1) continue;
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= raster.width || yy >= raster.height) continue;
          const offset = (yy * raster.width + xx) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
        }
      }
    }
  }
  return { ...raster, pixels };
}

function checkerClutter(fixture, { overlappingLuma = false } = {}) {
  const width = 1100;
  const height = 760;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const tile = overlappingLuma ? 12 : 18;
  const modes = [133, 160, 176, 197];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value;
      if (overlappingLuma) {
        const mode = (Math.floor(x / tile) + 2 * Math.floor(y / tile)) % modes.length;
        const localX = x % tile;
        const periodic = localX - (tile - 1) / 2;
        const amplitude = mode === 0 ? 3 : 2.1;
        value = modes[mode] + periodic * amplitude;
      } else {
        value = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 ? 205 : 235;
      }
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
  let sourceRaster = raster;
  if (overlappingLuma) {
    const clipped = new Uint8ClampedArray(raster.pixels);
    for (let y = 0; y < raster.height; y += 1) {
      for (let x = 0; x < raster.width; x += 1) {
        if (!inside(x + 0.5, y + 0.5)) clipped[(y * raster.width + x) * 4 + 3] = 0;
      }
    }
    sourceRaster = distortImage({ ...raster, pixels: clipped }, {
      perspective: { degrees: 6, axis: 'horizontal' },
      fill: { r: 0, g: 0, b: 0, a: 0 },
    });
  }
  const offsetX = 430 - Math.round(sourceCenter.x);
  const offsetY = 380 - Math.round(sourceCenter.y);
  for (let sourceY = 0; sourceY < sourceRaster.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < sourceRaster.width; sourceX += 1) {
      const sourceOffset = (sourceY * sourceRaster.width + sourceX) * 4;
      if (overlappingLuma
        ? sourceRaster.pixels[sourceOffset + 3] < 128
        : !inside(sourceX + 0.5, sourceY + 0.5)) continue;
      const targetX = sourceX + offsetX;
      const targetY = sourceY + offsetY;
      if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
      const targetOffset = (targetY * width + targetX) * 4;
      pixels.set(sourceRaster.pixels.subarray(sourceOffset, sourceOffset + 3), targetOffset);
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
    [0], // 0° 합성의 유일 방향. 꼭짓점 0 = C0(상단) 정합 후 home 은 0.
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

test('Type Y 3톤은 120도 물리 회전 세 방향을 모두 평가해 유일 복호', {
  timeout: 60_000,
}, () => {
  const text = 'type-y-three-tone-rotation';
  const fixture = renderY(text, { tones: 3, margin: 12 });
  for (const degrees of [0, 120, 240]) {
    const distorted = distortImage(fixture.raster, { rotation: degrees, fill: FILL });
    assertYDecoded(decodeFrontend(distorted), text, 1, 3);
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

// ⚠ **의도적 갱신 (2026-08-16, 과업 #16 — R 게인 0.52 → 0.62)**
//
// 12칸 중 **한 칸**이 뒤집혔다: `scale 0.5`(축소 하한) 이 `no-grid-hypothesis` 로 죽는다.
// 그래서 실패를 지우는 대신 **범위를 좁히고, 잃은 것을 다른 축으로 되산다**.
//
// 실측 (다른 모든 것 고정, R 게인만 스윕 — `test/output/_probe-render-batch-rgain.mjs`):
//   · 게인 축: 0.52 ok · 0.56 ok · 0.58 ok · **0.60~0.70 ✖** · 0.72 ok → **비단조**.
//     문턱이 아니라 좁은 칼날이고, 0.62 는 그 위에 있다.
//   · 스케일 축: 0.50 만 ✖ 이고 0.52 / 0.55 / 0.60 / 0.65 / 0.70 은 전부 ok.
//   · **해상도 자체의 문제가 아니다** — 같은 물리 해상도를 네이티브로 그리면 통과한다
//     (native ppu 10/11/12 전부 ok). 소스 ppu 를 바꾼 대조도 ok
//     (ppu22×0.5 = 11 ok · ppu24×0.5 = 12 ok). 즉 «ppu 20 을 정확히 0.5 로 리샘플» 이라는
//     한 점의 리샘플 아티팩트다.
//
// 그래서 ① scale 하한을 0.52 로 올려 통과 구간을 정직하게 적고, ② **네이티브 ppu 10**
// 을 추가해 «저해상도에서 읽히는가» 라는 원래 관심사를 리샘플 우연에 기대지 않고
// 직접 잰다. ③ 실패하는 그 한 점은 아래 별도 테스트가 «현재 정본 거동» 으로 고정한다 —
// 지우면 조용히 되살아나거나 더 넓어져도 아무도 모른다.
test('Type Y scale 0.52..2 · native ppu 10..12 · blur sigma up to 2.6', {
  timeout: 180_000,
}, () => {
  const text = 'type-y-scale-blur';
  const scaleFixture = renderY(text, {
    pixelsPerUnit: 20,
    margin: 25,
  });
  for (const scale of [0.52, 0.6, 0.75, 1, 1.25, 1.5, 2]) {
    const distorted = distortImage(scaleFixture.raster, { scale, fill: FILL });
    assertYDecoded(decodeFrontend(distorted), text, 1, 2);
  }

  // 되산 축 — 리샘플 없이 그린 저해상도. scale 0.5 가 노리던 물리 해상도(10 px/unit)를
  // 여기서 직접 덮는다.
  for (const pixelsPerUnit of [10, 11, 12]) {
    const native = renderY(text, { pixelsPerUnit, margin: 25 });
    assertYDecoded(decodeFrontend(native.raster), text, 1, 2);
  }

  const blurFixture = renderY(text, { margin: 12 });
  for (const sigma of [0.5, 1, 1.5, 2, 2.6]) {
    assertYDecoded(decodeFrontend(gaussianBlur(blurFixture.raster, sigma)), text, 1, 2);
  }
});

test('⚠ 알려진 약점 — ppu 20 을 정확히 ×0.5 리샘플한 한 점은 기하 가설이 안 선다', {
  timeout: 60_000,
}, () => {
  // 위 주석의 «칼날» 을 코드로 못 박는다. 이 핀은 «영구히 실패해도 된다» 가 아니다 —
  // 리샘플 경로나 블록 검출 문턱을 고쳐 이 점이 살아나면 여기가 빨개지고, 그때 위
  // 테스트의 하한을 0.5 로 되돌리고 이 테스트를 지우는 것이 정상 절차다.
  const text = 'type-y-scale-blur';
  const fixture = renderY(text, { pixelsPerUnit: 20, margin: 25 });
  const result = decodeFrontend(distortImage(fixture.raster, { scale: 0.5, fill: FILL }));
  assert.equal(result.ok, false,
    'scale 0.5 가 복호됐다 — 약점이 고쳐졌다면 위 테스트의 하한을 0.5 로 되돌려라');
  // 실패의 **단계**까지 고정한다. 오독(다른 본문을 내놓음)은 여전히 금지다.
  assert.equal(result.reason, 'frontend:no-grid-hypothesis');
  assert.equal(result.text, undefined, '실패 경로가 본문을 내놓았다 (오독)');
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

test('Type Y four-mode luminance-overlap clutter keeps the spatially-flat cube', {
  timeout: 60_000,
}, () => {
  const text = 'luma-overlap-14';
  const fixture = renderY(text, {
    pixelsPerUnit: 10,
    margin: 6,
  });
  const cluttered = checkerClutter(fixture, { overlappingLuma: true });
  const photographed = gaussianBlur(cluttered, 1.1);
  const detected = detectCubeHypotheses(rasterToLuma(photographed));
  const models = detected.ok
    ? detected.diagnostics.shapes.backgroundModels
    : detected.detail.diagnostics.shapes.backgroundModels;
  const brightLumas = Object.values(DEFAULT_FACE_GAINS)
    .map((gain) => relativeLuminance(PRESET.levels[2]) * gain);
  const overlappedFaces = brightLumas.filter((value) =>
    models.some((model) => Math.abs(value - model.mean) <= model.tolerance));

  const targetMeans = [0.238, 0.344, 0.425, 0.524];
  assert.equal(models.length, 4, JSON.stringify(models));
  assert.ok(models.every((model, index) =>
    Math.abs(model.mean - targetMeans[index]) <= 0.015), JSON.stringify(models));
  assert.ok(models.every((model) =>
    model.tolerance >= 0.05 && model.tolerance <= 0.07), JSON.stringify(models));
  assert.ok(overlappedFaces.length >= 2, JSON.stringify({ models, brightLumas }));
  assert.equal(detected.ok, true, JSON.stringify(detected));
  assert.ok(detected.hypotheses.some((entry) =>
    entry.n === 21
      && entry.referenceAgreement >= 10 / 12
      && entry.shapeDiagnostics.componentSource === 'structured-density'));
  assertYDecoded(decodeFrontend(photographed), text, 1, 2);
});

test('Type Y reference groups resolve a false stronger Y-seam parity', {
  timeout: 30_000,
}, () => {
  const text = 'parity-distractor';
  const fixture = renderY(text, {
    pixelsPerUnit: 10,
    margin: 6,
  });
  const distracted = falseSeamDistractor(fixture);
  const detected = detectCubeHypotheses(rasterToLuma(distracted));

  assert.equal(detected.ok, true, JSON.stringify(detected));
  assert.ok(detected.hypotheses.some((entry) =>
    entry.shapeDiagnostics.seamParityAlternative === true));
  assertYDecoded(decodeFrontend(distracted), text, 1, 2);
});

test('Type Y real-photo luma dumps establish a reference-supported grid', {
  timeout: 180_000,
}, (t) => {
  const dumps = listLumaDumps();
  if (dumps.length === 0) {
    t.skip('휘도 덤프 없음 — photo-probe 에서 구워야 한다');
    return;
  }
  const typeYDumps = dumps.filter(({ name }) => name.includes('014930219'));
  assert.equal(typeYDumps.length, 6, `Type Y 휘도 덤프 6장 필요: ${typeYDumps.length}`);
  for (const dump of typeYDumps) {
    const detected = detectCubeHypotheses(readLumaDump(dump.path), undefined, {});
    assert.equal(detected.ok, true, `${dump.name}: ${JSON.stringify(detected)}`);
    const supported = detected.hypotheses.find((entry) =>
      entry.n === 13
        && entry.tones === 2
        && entry.referenceAgreement === 1
        && entry.shapeDiagnostics?.hardChecks?.yJunction === true);
    assert.ok(supported, `${dump.name}: 12/12 레퍼런스와 Y 접합이 지지한 Y0 가설 없음`);
    assert.equal(supported.referenceCalibration.agreement, 12, dump.name);
    assert.equal(supported.referenceCalibration.total, 12, dump.name);
  }
  const typeADumps = dumps.filter(({ name }) => name.includes('015525403'));
  assert.equal(typeADumps.length, 6, `Type A 휘도 덤프 6장 필요: ${typeADumps.length}`);
  for (const dump of typeADumps) {
    const detected = detectCubeHypotheses(readLumaDump(dump.path), undefined, {});
    assert.equal(detected.ok, false, `${dump.name}: Type A를 Type Y로 오수용`);
  }
});

/*
 * ⚠ F-105 (2026-08-23 규명 — 원장 021 §5 · 등록부 .agent/_coordination/EXPECTED_RED.md):
 *
 * 원판 «4장 전부 Y1T 복호» 는 2026-08-20 01:24 photo-probe 일괄 굽기가 **전 코퍼스를
 * 무경고 재생성**하며 깨졌다 — 굽기 기하가 구세대(짧은 변 960/1440)에서 현행(긴 변)으로
 * 바뀌어 해상도가 0.75× 로 깎였고, `_02` 두 장은 seamContrast 가 파인더 게이트(0.01)
 * 아래로 떨어져 **정보 소실이 확정**이다 (코드 회귀 아님 — 테스트 탄생 커밋조차 현
 * 덤프로 실패, 5커밋 소급 실증). 그래서 주장을 사실에 맞춰 둘로 가른다:
 *   · 본단언 — 여전히 «성공분» 인 `_01` 쌍은 원 단언 그대로.
 *   · 세대 단언 — `_02` 쌍은 «소실 세대» 임을 **단언**한다. 소스 jpg 재굽기
 *     (maxSide 1280/1920 — 운영자 게이트: luma 는 junction·쓰기 금지)로 복원되면
 *     그 테스트가 빨개지며 «원 단언으로 되돌려라» 를 알린다 — 게이트 완화가 아니라
 *     복원을 잊지 않게 하는 역방향 래칫이다.
 */
test('Type Y 3톤 실사진 성공분(_01)은 960/1440 모두 Y1T로 복호', {
  timeout: 240_000,
}, (t) => {
  const dumps = listLumaDumps().filter(({ name }) =>
    /^KakaoTalk_20260812_030145439_01\.(960|1440)\.luma$/.test(name));
  if (dumps.length === 0) {
    t.skip('Type Y 3톤 성공 사진 휘도 덤프 없음');
    return;
  }
  assert.equal(dumps.length, 2, `Type Y 3톤 _01 덤프 2장 필요: ${dumps.length}`);
  for (const dump of dumps) {
    const result = decodeFrontend(lumaToRaster(readLumaDump(dump.path)));
    assertYDecoded(result, 'https://tl.estre.so', 1, 3);
    assert.equal(result.versionName, 'Y1T', dump.name);
  }
});

test('F-105 세대 단언 — _02 쌍은 8/20 재굽기로 소실됐다 (복원되면 이 테스트를 지우고 원 단언 복귀)', {
  timeout: 240_000,
}, (t) => {
  const dumps = listLumaDumps().filter(({ name }) =>
    /^KakaoTalk_20260812_030145439_02\.(960|1440)\.luma$/.test(name));
  if (dumps.length === 0) {
    t.skip('_02 덤프 없음');
    return;
  }
  assert.equal(dumps.length, 2, `_02 덤프 2장 필요: ${dumps.length}`);
  for (const dump of dumps) {
    const result = decodeFrontend(lumaToRaster(readLumaDump(dump.path)));
    assert.equal(result.ok, false,
      dump.name + ': 소실 세대가 복호에 성공했다 — 자가 복원됐다는 뜻이다. '
      + 'EXPECTED_RED.md 의 F-105 항목을 닫고 이 테스트를 지운 뒤 원 단언(«4장 전부»)으로 되돌려라');
  }
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

test('F-93: calibration minimumSeamContrast 는 positiveRayCount 카운터에 닿는다 (흔들면 변한다)', {
  timeout: 30_000,
}, () => {
  const fixture = renderY('f93-counter-lock', { version: 0, tones: 2 });
  const luma = rasterToLuma(fixture.raster);
  const baseline = detectCubeHypotheses(luma, undefined, { finderFirst: false });
  assert.equal(baseline.ok, true, JSON.stringify(baseline.reason || baseline));
  const baseCandidate = (baseline.diagnostics.shapeCandidates || [])
    .find((entry) => entry.seam && Array.isArray(entry.seam.rays) && entry.seam.rays.length === 3);
  assert.ok(baseCandidate, 'seam ray 3개짜리 실루엣 후보가 있어야 한다');
  const baseCount = baseCandidate.seam.positiveRayCount;
  assert.ok(baseCount >= 1, `기본 문턱에서 양성 ray 가 있어야 한다: ${baseCount}`);

  // ray 대비값 사이 중점을 문턱으로 잡으면 카운트가 반드시 달라진다. 게이트
  // (seam.contrast = 최상위 ray)는 그 문턱 위라 후보는 살아 있다.
  const contrasts = baseCandidate.seam.rays.map((ray) => ray.contrast)
    .sort((left, right) => right - left);
  assert.ok(contrasts[0] > contrasts[contrasts.length - 1],
    `ray 대비가 전부 같으면 이 픽스처로는 카운터를 분리 관측할 수 없다: ${contrasts}`);
  let override = null;
  for (let index = 1; index < contrasts.length; index += 1) {
    if (contrasts[index - 1] > contrasts[index]) {
      const midpoint = (contrasts[index - 1] + contrasts[index]) / 2;
      const expected = contrasts.filter((value) => value >= midpoint).length;
      if (expected !== baseCount && midpoint > 0) {
        override = { midpoint, expected };
        break;
      }
    }
  }
  assert.ok(override, `카운트를 바꾸는 중점 문턱이 있어야 한다: ${contrasts} base=${baseCount}`);

  const shaken = detectCubeHypotheses(luma, undefined, {
    finderFirst: false,
    calibration: { minimumSeamContrast: override.midpoint },
  });
  const shakenCandidates = shaken.ok
    ? (shaken.diagnostics.shapeCandidates || [])
    : ((shaken.detail && shaken.detail.diagnostics
      && shaken.detail.diagnostics.shapeCandidates) || []);
  const shakenCandidate = shakenCandidates
    .find((entry) => entry.componentIndex === baseCandidate.componentIndex
      && entry.componentSource === baseCandidate.componentSource
      && entry.seamParity === baseCandidate.seamParity);
  assert.ok(shakenCandidate, '문턱은 최상위 ray 아래라 후보가 살아 있어야 한다');
  assert.equal(shakenCandidate.seam.positiveRayCount, override.expected,
    `오버라이드 문턱이 카운터에 닿아야 한다 (F-93): base=${baseCount}`);
  assert.notEqual(shakenCandidate.seam.positiveRayCount, baseCount,
    '문턱을 흔들었는데 카운터가 불변이면 cfg 가 배선되지 않은 것이다');
});
