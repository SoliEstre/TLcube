/**
 * R2 중앙 글리프 검출기의 성질 자.
 *
 * 픽스처는 좌표나 도형을 옮겨 그리지 않는다. 네 어휘 모두 정식
 * encode -> buildScene -> rasterize 경로로 만든 뒤, 위치·회전 같은 프레임
 * 왜곡만 이 파일에서 적용한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
  relativeLuminance8,
} from '../src/luminance.js';
import { CENTER_SPACING_COEFF, axialToPixel } from '../src/hexgrid.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';
import { TL_READER_URL } from '../src/qr.js';
import {
  GLYPH_STATUS,
  createGlyphDetector,
} from '../src/r2/glyph.js';
import { Q16_ONE } from '../src/r2/params.js';
import { rotateImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

const OUTPUT_CAPACITY = 128;
const DETECTOR_OPTIONS = Object.freeze({
  params: Object.freeze({
    glyphMaxFrameWidth: 640,
    glyphMaxFrameHeight: 384,
    glyphMaxCandidates: OUTPUT_CAPACITY,
    // 이 자의 정답은 2x/4x(피치 3.46/6.93px)다. 128px까지 훑는 것은
    // 검출 성질을 더 재지 않고 테스트 시간만 늘리므로 바로 위 rung까지만 연다.
    glyphMaxCellPitchQ16: 9 * Q16_ONE,
  }),
});

const GLYPH_CASES = Object.freeze([
  Object.freeze({
    kind: 'bullseye',
    encodeOptions: Object.freeze({ version: 1 }),
    sceneOptions: Object.freeze({ finderPatternId: 'bullseye' }),
  }),
  Object.freeze({
    kind: 'mini-tl',
    encodeOptions: Object.freeze({ version: 1, centralN7: true }),
    sceneOptions: Object.freeze({
      finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
      centralN7Family: 'hex',
    }),
  }),
  Object.freeze({
    kind: 'qr',
    encodeOptions: Object.freeze({ version: 1, centerQr: true }),
    sceneOptions: Object.freeze({
      finderPatternId: 'center-qr',
      centerQr: true,
      qrText: TL_READER_URL,
    }),
  }),
  Object.freeze({
    kind: 'daehan',
    encodeOptions: Object.freeze({ version: 1 }),
    sceneOptions: Object.freeze({ finderPatternId: 'oak-taegeuk-solo' }),
  }),
]);

const CASE_BY_KIND = new Map(GLYPH_CASES.map((entry) => [entry.kind, entry]));
const RENDER_CACHE = new Map();
const INSET_DETECTION_CACHE = new Map();

function lumaByte(r, g, b) {
  return Math.round(relativeLuminance8(r, g, b) * 255);
}

function rgbaToLuma(image) {
  const luma = new Uint8Array(image.width * image.height);
  for (let i = 0; i < luma.length; i += 1) {
    const offset = i * 4;
    luma[i] = lumaByte(
      image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2],
    );
  }
  return luma;
}

/** 네 글리프를 오직 정식 생성기 경로로 만든다. */
function renderGlyph(kind, pixelsPerUnit) {
  const cacheKey = `${kind}:${pixelsPerUnit}`;
  const cached = RENDER_CACHE.get(cacheKey);
  if (cached) return cached;

  const spec = CASE_BY_KIND.get(kind);
  assert.ok(spec, `알 수 없는 테스트 글리프: ${kind}`);
  const encoded = encode(`r2-glyph-${kind}`, spec.encodeOptions);
  const scene = buildScene(encoded, { palette: PALETTE, ...spec.sceneOptions });
  const image = rasterize(scene, { pixelsPerUnit, supersample: 3 });
  const center = axialToPixel(0, 0, scene.layout);
  const rendered = Object.freeze({
    kind,
    scene,
    image,
    luma: rgbaToLuma(image),
    cx: center.x * image.pixelsPerUnit,
    cy: center.y * image.pixelsPerUnit,
    // detector.scale의 공개 단위: 인접 axial 셀 중심 피치(px).
    scale: CENTER_SPACING_COEFF * scene.layout.size * image.pixelsPerUnit,
  });
  RENDER_CACHE.set(cacheKey, rendered);
  return rendered;
}

function renderQrPayload(qrText, pixelsPerUnit) {
  const encoded = encode('r2qr', {
    version: 1,
    centerQr: true,
  });
  const scene = buildScene(encoded, {
    palette: PALETTE,
    finderPatternId: 'center-qr',
    centerQr: true,
    qrText,
  });
  const image = rasterize(scene, { pixelsPerUnit, supersample: 3 });
  const center = axialToPixel(0, 0, scene.layout);
  return {
    kind: 'qr',
    scene,
    image,
    luma: rgbaToLuma(image),
    cx: center.x * image.pixelsPerUnit,
    cy: center.y * image.pixelsPerUnit,
    scale: CENTER_SPACING_COEFF * scene.layout.size * image.pixelsPerUnit,
  };
}

function createOutput(capacity = OUTPUT_CAPACITY) {
  return {
    count: 0,
    truncated: 0,
    candidates: Array.from({ length: capacity }, () => ({
      kind: '', cx: 0, cy: 0, scale: 0, score: 0,
    })),
  };
}

function detect(detector, frame, output = createOutput()) {
  const status = detector.detectInto(frame.luma, frame.width, frame.height, output);
  assert.equal(status, GLYPH_STATUS.OK);
  assert.ok(output.count >= 0 && output.count <= output.candidates.length);
  return output;
}

function nearestCandidate(output, kind, expected) {
  let matching = null;
  let fallback = null;
  let fallbackCost = Infinity;
  for (let index = 0; index < output.count; index += 1) {
    const candidate = output.candidates[index];
    if (candidate.kind !== kind) continue;
    const xError = Math.abs(candidate.cx - expected.cx);
    const yError = Math.abs(candidate.cy - expected.cy);
    const scaleError = Math.abs(candidate.scale - expected.scale) / expected.scale;
    if (
      xError <= 1 && yError <= 1 && scaleError <= 0.03
      && (matching === null || candidate.score > matching.score)
    ) {
      matching = candidate;
    }
    // 실패 메시지에는 중심만 가까운 rung가 아니라 pose 전체가 가장 가까운 후보를 싣는다.
    const cost = Math.max(xError, yError) + scaleError * expected.scale;
    if (cost < fallbackCost) {
      fallback = candidate;
      fallbackCost = cost;
    }
  }
  assert.ok(
    matching || fallback,
    `${kind} 후보가 없다: ${JSON.stringify(summarizeOutput(output))}`,
  );
  return matching || fallback;
}

function assertPose(candidate, expected, label) {
  const detail = JSON.stringify(candidate);
  assert.ok(
    Math.abs(candidate.cx - expected.cx) <= 1,
    `${label}: cx ${candidate.cx} vs ${expected.cx}; candidate=${detail}`,
  );
  assert.ok(
    Math.abs(candidate.cy - expected.cy) <= 1,
    `${label}: cy ${candidate.cy} vs ${expected.cy}; candidate=${detail}`,
  );
  const relativeScaleError = Math.abs(candidate.scale - expected.scale) / expected.scale;
  assert.ok(
    relativeScaleError <= 0.03,
    `${label}: scale ${candidate.scale} vs ${expected.scale} (${relativeScaleError}); candidate=${detail}`,
  );
  assert.ok(Number.isFinite(candidate.score));
  assert.ok(candidate.score >= -1 && candidate.score <= 1);
}

function backgroundLuma() {
  return lumaByte(PALETTE.background.r, PALETTE.background.g, PALETTE.background.b);
}

/** 생성된 전체 래스터를 배경 프레임의 알려진 위치에 옮긴다. */
function insetFrame(rendered, left, top, right = 11, bottom = 13) {
  const width = left + rendered.image.width + right;
  const height = top + rendered.image.height + bottom;
  const luma = new Uint8Array(width * height);
  luma.fill(backgroundLuma());
  for (let y = 0; y < rendered.image.height; y += 1) {
    const source = rendered.luma.subarray(
      y * rendered.image.width, (y + 1) * rendered.image.width,
    );
    luma.set(source, ((top + y) * width) + left);
  }
  return {
    width,
    height,
    luma,
    cx: rendered.cx + left,
    cy: rendered.cy + top,
    scale: rendered.scale,
  };
}

function insetDetection(kind, pixelsPerUnit) {
  const cacheKey = `${kind}:${pixelsPerUnit}`;
  const cached = INSET_DETECTION_CACHE.get(cacheKey);
  if (cached) return cached;

  const frame = insetFrame(renderGlyph(kind, pixelsPerUnit), 7, 9);
  const result = { frame, output: detect(createGlyphDetector(DETECTOR_OPTIONS), frame) };
  INSET_DETECTION_CACHE.set(cacheKey, result);
  return result;
}

function rotatedFrame(rendered, degrees) {
  const image = rotateImage(rendered.image, degrees, {
    fill: { ...PALETTE.background, a: 255 },
  });
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerX = (image.width - 1) / 2;
  const centerY = (image.height - 1) / 2;
  const dx = rendered.cx - centerX;
  const dy = rendered.cy - centerY;
  return {
    width: image.width,
    height: image.height,
    luma: rgbaToLuma(image),
    cx: centerX + (cos * dx) - (sin * dy),
    cy: centerY + (sin * dx) + (cos * dy),
    scale: rendered.scale,
  };
}

function composeFrames(renderedItems, gap = 13) {
  const width = renderedItems.reduce((sum, item) => sum + item.image.width, 0)
    + gap * (renderedItems.length + 1);
  const height = Math.max(...renderedItems.map((item) => item.image.height)) + 2 * gap;
  const luma = new Uint8Array(width * height);
  luma.fill(backgroundLuma());
  const expected = [];
  let left = gap;
  for (const item of renderedItems) {
    const top = gap + Math.floor((height - (2 * gap) - item.image.height) / 2);
    for (let y = 0; y < item.image.height; y += 1) {
      luma.set(
        item.luma.subarray(y * item.image.width, (y + 1) * item.image.width),
        ((top + y) * width) + left,
      );
    }
    expected.push({
      kind: item.kind,
      cx: item.cx + left,
      cy: item.cy + top,
      scale: item.scale,
    });
    left += item.image.width + gap;
  }
  return { width, height, luma, expected };
}

function snapshotOutput(output) {
  return {
    count: output.count,
    truncated: output.truncated,
    candidates: output.candidates.slice(0, output.count).map((candidate) => ({
      kind: candidate.kind,
      cx: candidate.cx,
      cy: candidate.cy,
      scale: candidate.scale,
      score: candidate.score,
    })),
  };
}

function summarizeOutput(output, limit = 12) {
  const snapshot = snapshotOutput(output);
  return {
    count: snapshot.count,
    truncated: snapshot.truncated,
    top: snapshot.candidates
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, limit),
  };
}

for (const { kind } of GLYPH_CASES) {
  test(`합성 오라클: ${kind} 위치 ±1px, scale ±3%`, { timeout: 60_000 }, (t) => {
    const { frame, output } = insetDetection(kind, 4);
    const candidate = nearestCandidate(output, kind, frame);
    assertPose(candidate, frame, kind);
    t.diagnostic(`candidate=${JSON.stringify(candidate)}`);
  });
}

test('QR 어휘: 서로 다른 payload에서도 2x finder 기하를 되찾는다', {
  timeout: 60_000,
}, (t) => {
  const detector = createGlyphDetector(DETECTOR_OPTIONS);
  const payloads = ['HELLO WORLD', '0123456789ABCDEFG'];
  for (let index = 0; index < payloads.length; index += 1) {
    const frame = insetFrame(renderQrPayload(payloads[index], 2), 7 + index, 9 + index);
    const candidate = nearestCandidate(detect(detector, frame), 'qr', frame);
    assertPose(candidate, frame, `qr-payload-${index}`);
    t.diagnostic(`payload${index}=${JSON.stringify(candidate)}`);
  }
});

for (const { kind } of GLYPH_CASES) {
  test(`스케일 불변: ${kind} 2x·4x`, { timeout: 60_000 }, (t) => {
    const found = [];
    for (const pixelsPerUnit of [2, 4]) {
      const { frame, output } = insetDetection(kind, pixelsPerUnit);
      const candidate = nearestCandidate(output, kind, frame);
      t.diagnostic(`${pixelsPerUnit}x candidate=${JSON.stringify(candidate)}`);
      assertPose(candidate, frame, `${kind}@${pixelsPerUnit}x`);
      found.push(candidate.scale);
    }
    const ratio = found[1] / found[0];
    const ratioError = Math.abs(ratio - 2) / 2;
    // 두 독립 scale이 각각 ±3% 경계에 있으면 비율 오차는 최대 약 6%다.
    assert.ok(ratioError <= 0.06, `${kind}: scale ratio=${ratio}`);
    t.diagnostic(`scale2=${found[0]} scale4=${found[1]} ratio=${ratio}`);
  });
}

for (const kind of ['mini-tl', 'daehan']) {
  for (const degrees of [0, 120, 240]) {
    test(`회전 위상: ${kind} ${degrees}°`, { timeout: 60_000 }, (t) => {
      const detector = createGlyphDetector(DETECTOR_OPTIONS);
      const rendered = renderGlyph(kind, 4);
      const frame = rotatedFrame(rendered, degrees);
      const candidate = nearestCandidate(detect(detector, frame), kind, frame);
      assertPose(candidate, frame, `${kind}@${degrees}deg`);
      t.diagnostic(`candidate=${JSON.stringify(candidate)}`);
    });
  }
}

function falsePositiveFrame(label) {
  const width = 127;
  const height = 95;
  const luma = new Uint8Array(width * height);
  if (label === 'uniform') {
    luma.fill(128);
    return { width, height, luma };
  }

  if (label === 'noise') {
    let state = 0x6d2b79f5;
    for (let i = 0; i < luma.length; i += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      luma[i] = 64 + (state & 127);
    }
    return { width, height, luma };
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      luma[(y * width) + x] = ((Math.floor(x / 5) + Math.floor(y / 5)) & 1) ? 192 : 64;
    }
  }
  return { width, height, luma };
}

for (const label of ['uniform', 'noise', 'grid']) {
  test(`거짓 양성 하한: ${label}`, (t) => {
    const detector = createGlyphDetector(DETECTOR_OPTIONS);
    const output = detect(detector, falsePositiveFrame(label));
    assert.equal(output.count, 0, `${label}: ${JSON.stringify(summarizeOutput(output))}`);
    t.diagnostic('candidate count=0');
  });
}

test('무할당 관찰 계약: 반복 호출이 out·candidate 객체·입력 버퍼를 교체하지 않는다', () => {
  const detector = createGlyphDetector(DETECTOR_OPTIONS);
  const rendered = renderGlyph('bullseye', 2);
  const frame = insetFrame(rendered, 7, 9);
  const output = createOutput();
  const outputIdentity = output;
  const candidateIdentities = output.candidates.slice();
  const inputBefore = frame.luma.slice();

  detect(detector, frame, output);
  const expected = snapshotOutput(output);
  for (let repeat = 0; repeat < 2; repeat += 1) {
    assert.equal(
      detector.detectInto(frame.luma, frame.width, frame.height, output),
      GLYPH_STATUS.OK,
    );
    assert.strictEqual(output, outputIdentity);
    assert.strictEqual(output.candidates, outputIdentity.candidates);
    for (let index = 0; index < candidateIdentities.length; index += 1) {
      assert.strictEqual(output.candidates[index], candidateIdentities[index]);
    }
    assert.deepEqual(snapshotOutput(output), expected);
  }
  assert.deepEqual(frame.luma, inputBefore);
});

test('결정성: 독립 detector 인스턴스가 같은 입력에 바이트 동등한 후보를 낸다', () => {
  const frame = insetFrame(renderGlyph('mini-tl', 2), 7, 9);
  const first = detect(createGlyphDetector(DETECTOR_OPTIONS), frame);
  const second = detect(createGlyphDetector(DETECTOR_OPTIONS), frame);
  assert.deepEqual(snapshotOutput(first), snapshotOutput(second));
});

test('비배타: 한 프레임의 서로 다른 4어휘 후보를 동시에 보존한다', {
  timeout: 60_000,
}, (t) => {
  const rendered = GLYPH_CASES.map(({ kind }) => renderGlyph(kind, 2));
  const frame = composeFrames(rendered);
  const output = detect(createGlyphDetector(DETECTOR_OPTIONS), frame);
  for (const expected of frame.expected) {
    const candidate = nearestCandidate(output, expected.kind, expected);
    assertPose(candidate, expected, `multi:${expected.kind}`);
    t.diagnostic(`${expected.kind}=${JSON.stringify(candidate)}`);
  }
});
