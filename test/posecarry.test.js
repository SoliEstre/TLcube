/**
 * posecarry.test.js — 성공 가설 H 의 직렬화·재주입·프레임 이월 자.
 *
 * 값이 없으면 즉시 실패한 뒤 값의 내용과 복호 결과를 본다. 성공 조건 안쪽에서만
 * 비교하는 공허 단언을 두지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { HOMOGRAPHY_CANONICAL_SPACE } from '../src/decoder/contracts.js';
import {
  jitterPoses,
  poseFromHypothesis,
  PRIOR_COARSE_OFFSET_CELLS,
  PRIOR_MAX_REFINE_POSES,
} from '../src/scan-guide-prior.js';
import { distortImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const TEXT = 'posecarry synthetic roundtrip';
const SCANNER_JS = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');

function render(text = TEXT, version = 2) {
  const encoded = encode(text, { version, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: PALETTE, margin: 20 });
  return rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
}

function timedDecode(raster, options) {
  const started = performance.now();
  const result = decodeFrontend(raster, options);
  return { result, ms: performance.now() - started };
}

function carryCandidates(pose, frameSide) {
  return [
    pose,
    ...jitterPoses(pose, {
      frameSide,
      offsetCells: PRIOR_COARSE_OFFSET_CELLS,
      maxPoses: PRIOR_MAX_REFINE_POSES - 1,
    }),
  ].slice(0, PRIOR_MAX_REFINE_POSES);
}

function translateRaster(raster, dx, dy) {
  const pixels = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const target = (y * raster.width + x) * 4;
      const sourceX = x - dx;
      const sourceY = y - dy;
      if (sourceX < 0 || sourceY < 0 || sourceX >= raster.width || sourceY >= raster.height) {
        pixels[target] = FILL.r;
        pixels[target + 1] = FILL.g;
        pixels[target + 2] = FILL.b;
        pixels[target + 3] = 255;
      } else {
        const source = (sourceY * raster.width + sourceX) * 4;
        pixels.set(raster.pixels.subarray(source, source + 4), target);
      }
    }
  }
  return { width: raster.width, height: raster.height, pixels };
}

function scanSweep(values, makeRaster, poses) {
  const successes = [];
  for (const value of values) {
    const result = decodeFrontend(makeRaster(value), { priorPoses: poses });
    if (!result.ok) continue;
    assert.equal(result.text, TEXT, '오독: ' + value);
    successes.push(value);
  }
  assert.ok(successes.length > 0, '스윕 성공 표본이 0 이다');
  assert.ok(successes.includes(0), '기준점 0 이 복호되지 않아 범위 자가 공허하다');
  return successes;
}

let fixture = null;

test('왕복 핵심 — 성공 H 가 JSON 을 지나 같은 원문을 사전 경로로 복호하고 더 빠르다', {
  timeout: 60_000,
}, () => {
  const raster = render();
  const normal = timedDecode(raster);
  assert.equal(normal.result.ok, true, JSON.stringify(normal.result));
  assert.equal(normal.result.text, TEXT);

  // «값이 있나»를 먼저 본다. 아래 유한성·복호 비교는 그 다음이다.
  assert.ok(normal.result.hypothesis, '성공 결과에 hypothesis 가 없다');
  assert.ok(Object.hasOwn(normal.result.hypothesis, 'H'), '성공 가설에 H 키가 없다');
  assert.ok(Array.isArray(normal.result.hypothesis.H), 'H 가 JSON 숫자 배열이 아니다');
  assert.equal(normal.result.hypothesis.H.length, 9);
  assert.ok(normal.result.hypothesis.H.every(Number.isFinite));
  assert.equal(normal.result.hypothesis.canonicalSpace, HOMOGRAPHY_CANONICAL_SPACE);

  const serialized = JSON.parse(JSON.stringify(normal.result.hypothesis));
  const pose = poseFromHypothesis(serialized, {
    id: 'roundtrip',
    sourceWidth: raster.width,
    sourceHeight: raster.height,
    targetWidth: raster.width,
    targetHeight: raster.height,
  });
  assert.ok(pose, '직렬화한 성공 가설이 포즈로 변환되지 않았다');
  assert.ok(pose.H instanceof Float64Array);
  assert.equal(pose.H.length, 9);

  const prior = timedDecode(raster, { priorPoses: [pose] });
  assert.equal(prior.result.ok, true, JSON.stringify(prior.result));
  assert.equal(prior.result.text, TEXT);
  assert.equal(prior.result.diagnostics.bootstrap.geometry.source, 'guide-prior');
  assert.ok(prior.ms < normal.ms,
    `사전 경로 ${prior.ms.toFixed(3)}ms 가 탐색 ${normal.ms.toFixed(3)}ms 보다 빠르지 않다`);

  fixture = { raster, normal, prior, pose };
  console.log('POSECARRY_CORE ' + JSON.stringify({
    width: raster.width,
    height: raster.height,
    normalMs: Number(normal.ms.toFixed(3)),
    priorMs: Number(prior.ms.toFixed(3)),
    speedup: Number((normal.ms / prior.ms).toFixed(2)),
    hCount: normal.result.hypothesis.H.length,
    textBytes: new TextEncoder().encode(TEXT).length,
  }));
});

test('변이 증인 — H 를 제거한 변환 결과는 null 이고 사전 복호는 실패한다', () => {
  assert.ok(fixture && fixture.pose, '왕복 양성 앵커가 먼저 만들어지지 않았다');
  const brokenHypothesis = { ...fixture.normal.result.hypothesis };
  delete brokenHypothesis.H;
  assert.equal(poseFromHypothesis(brokenHypothesis), null);

  const brokenPose = { ...fixture.pose, H: undefined };
  const broken = decodeFrontend(fixture.raster, { priorPoses: [brokenPose] });
  assert.equal(broken.ok, false, 'H 없는 포즈가 사전 복호에 성공했다');
  console.log('POSECARRY_MUTATION ' + JSON.stringify({
    missingHConverter: 'null',
    priorOk: broken.ok,
    reason: broken.reason,
  }));
});

test('변환기 — 불완전 입력은 throw 없이 null, 해상도 변경은 영상 좌표 행만 재배율', () => {
  const base = {
    id: 'projective',
    family: 'hex',
    k: 8,
    rotationDegrees: 7,
    canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
    H: [12, 1, 100, 0.5, 11, 80, 0.001, -0.0007, 1],
  };
  for (const incomplete of [
    null,
    {},
    { ...base, H: undefined },
    { ...base, H: [1, 0, 0] },
    { ...base, family: 'star' },
    { ...base, k: undefined },
    { ...base, rotationDegrees: undefined },
    { ...base, canonicalSpace: '다른-좌표계' },
  ]) {
    assert.doesNotThrow(() => poseFromHypothesis(incomplete));
    assert.equal(poseFromHypothesis(incomplete), null);
  }

  const pose = poseFromHypothesis(base, {
    sourceWidth: 200,
    sourceHeight: 100,
    targetWidth: 300,
    targetHeight: 200,
  });
  assert.ok(pose);
  assert.deepEqual([...pose.H.slice(0, 3)], base.H.slice(0, 3).map((value) => value * 1.5));
  assert.deepEqual([...pose.H.slice(3, 6)], base.H.slice(3, 6).map((value) => value * 2));
  assert.deepEqual([...pose.H.slice(6)], base.H.slice(6));
  assert.equal(pose.frameWidth, 300);
  assert.equal(pose.frameHeight, 200);

  const jitter = jitterPoses(pose, {
    frameSide: 200,
    scales: [1, 0.98, 1.02],
    offsetCells: [0, -0.3, 0.3],
  });
  assert.equal(jitter.length, 14);
  assert.ok(jitter.every((entry) => entry.H instanceof Float64Array && entry.H.length === 9));
  assert.ok(jitter.every((entry) => entry.H[6] === pose.H[6]
    && entry.H[7] === pose.H[7] && entry.H[8] === pose.H[8]),
  '영상 쪽 지터가 원근 행을 바꿨다');
});

test('무회귀 — priorPoses 를 주지 않은 결과 JSON 과 원문 바이트가 3개 코드에서 같다', {
  timeout: 60_000,
}, () => {
  const cases = [
    { text: 'posecarry-v1', version: 1 },
    { text: '포즈 이월 V2', version: 2 },
    { text: 'https://tl.estre.so/posecarry-v3', version: 3 },
  ];
  let matched = 0;
  for (const entry of cases) {
    const raster = render(entry.text, entry.version);
    const bare = decodeFrontend(raster);
    const omitted = decodeFrontend(raster, { priorPoses: undefined });
    assert.equal(bare.ok, true, JSON.stringify({ entry, bare }));
    assert.equal(omitted.ok, true, JSON.stringify({ entry, omitted }));
    assert.deepEqual(
      new Uint8Array(Buffer.from(JSON.stringify(omitted))),
      new Uint8Array(Buffer.from(JSON.stringify(bare))),
      'priorPoses 생략 경로의 결과 JSON 바이트가 달라졌다: ' + entry.text,
    );
    assert.deepEqual(
      new TextEncoder().encode(bare.text),
      new TextEncoder().encode(entry.text),
      '복호 원문 바이트가 달라졌다: ' + entry.text,
    );
    matched += 1;
  }
  console.log('POSECARRY_NOREGRESSION ' + JSON.stringify({ cases: matched, mismatches: 0 }));
});

test('유효 봉투 — 직전 포즈 24개 후보의 평행이동·배율·회전 생존 범위를 잰다', {
  timeout: 60_000,
}, () => {
  assert.ok(fixture && fixture.pose, '왕복 양성 앵커가 먼저 만들어지지 않았다');
  const { raster, pose } = fixture;
  const poses = carryCandidates(pose, Math.min(raster.width, raster.height));
  assert.equal(poses.length, 24, '스캐너와 같은 후보 예산이 아니다');
  assert.equal(poses[0], pose, '직전 정확 포즈가 첫 후보가 아니다');

  const translations = Array.from({ length: 17 }, (_, index) => index * 2 - 16);
  const scales = Array.from({ length: 21 }, (_, index) => index - 10);
  const rotations = Array.from({ length: 21 }, (_, index) => (index - 10) * 0.5);
  const xPx = scanSweep(translations, (value) => translateRaster(raster, value, 0), poses);
  const yPx = scanSweep(translations, (value) => translateRaster(raster, 0, value), poses);
  const scalePct = scanSweep(scales, (value) => distortImage(raster, {
    scale: 1 + value / 100,
    fill: FILL,
  }), poses);
  const rotationDeg = scanSweep(rotations, (value) => distortImage(raster, {
    rotation: value < 0 ? 360 + value : value,
    fill: FILL,
  }), poses);

  const range = (values) => ({ min: Math.min(...values), max: Math.max(...values) });
  console.log('POSECARRY_ENVELOPE ' + JSON.stringify({
    poseCount: poses.length,
    translationXPx: range(xPx),
    translationYPx: range(yPx),
    scalePct: range(scalePct),
    rotationDeg: range(rotationDeg),
    successes: {
      translationX: xPx.length,
      translationY: yPx.length,
      scale: scalePct.length,
      rotation: rotationDeg.length,
    },
  }));
});

test('스캐너 배선 — 직전 포즈 우선·종전 폴백·시도 경계 리셋·매 프레임 갱신', () => {
  const begin = SCANNER_JS.slice(
    SCANNER_JS.indexOf('function beginScanAttempt'),
    SCANNER_JS.indexOf('function activeVideoTrack'),
  );
  assert.match(begin, /lastFramePose\s*=\s*null/,
    'beginScanAttempt 에 포즈 리셋이 없다');

  const carry = SCANNER_JS.slice(
    SCANNER_JS.indexOf('async function attemptCarriedPoseScan'),
    SCANNER_JS.indexOf('function renderSteadyMeter'),
  );
  const priorAt = carry.indexOf('decodeFrame(imageData, { priorPoses: poses, deferReport: true })');
  const normalFallbackAt = carry.indexOf('decodeFrame(imageData, { deferReport: true })');
  assert.ok(priorAt >= 0 && normalFallbackAt > priorAt,
    '직전 포즈 시도가 종전 탐색 폴백보다 앞이 아니다');
  assert.match(carry, /if \(useGuidePrior\) return attemptGuidePriorScan/,
    '종전 가이드-사전 폴백이 사라졌다');

  const loop = SCANNER_JS.slice(
    SCANNER_JS.indexOf('function startFrameLoop'),
    SCANNER_JS.indexOf('async function startCamera'),
  );
  assert.match(loop, /lastFramePose\s*\?\s*attemptCarriedPoseScan/,
    '프레임 루프가 직전 포즈를 우선하지 않는다');
  assert.match(loop, /rememberFramePose\(result, imageData\)/,
    '성공·실패 결과에서 이번 프레임 포즈를 갱신하지 않는다');
  assert.match(loop, /\.catch\([\s\S]*?lastFramePose\s*=\s*null/,
    '예외 프레임이 이전 포즈를 남긴다');
});
