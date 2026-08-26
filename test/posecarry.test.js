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
import { encodeA } from '../src/encodeA.js';
import { encodeY } from '../src/encodeY.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { axialToPixel } from '../src/hexgrid.js';
import { anchorCells, dataCellsInScanOrder } from '../src/layout.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { HOMOGRAPHY_CANONICAL_SPACE } from '../src/decoder/contracts.js';
import {
  consumeFramePoseCarry,
  FRAME_POSE_MAX_AGE_MS,
  FRAME_POSE_MAX_ATTEMPTS,
  framePoseCarryFromResult,
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

function render(text = TEXT, version = 2, options = {}) {
  const encoded = encode(text, { version, eccLevel: 'M' });
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: options.margin === undefined ? 20 : options.margin,
  });
  return rasterize(scene, {
    pixelsPerUnit: options.pixelsPerUnit === undefined ? 12 : options.pixelsPerUnit,
    supersample: 1,
  });
}

function renderFamily(family, text) {
  if (family === 'hex') return render(text, 2);
  if (family === 'tri') {
    const encoded = encodeA(text, { version: 1, eccLevel: 'M' });
    const scene = buildScene(encoded, { palette: PALETTE, margin: 26 });
    return rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
  }
  const encoded = encodeY(text, { version: 1, eccLevel: 'M', tones: 3 });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 20 });
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

function damageDataCells(raster, hypothesis, count) {
  const pixels = new Uint8ClampedArray(raster.pixels);
  const H = hypothesis.H;
  const radius = Math.max(2, Math.floor(hypothesis.cellSizePx * 0.42));
  const project = (point) => {
    const denominator = H[6] * point.x + H[7] * point.y + H[8];
    return {
      x: (H[0] * point.x + H[1] * point.y + H[2]) / denominator,
      y: (H[3] * point.x + H[4] * point.y + H[5]) / denominator,
    };
  };
  for (const cell of dataCellsInScanOrder(hypothesis.k).slice(0, count)) {
    const center = project(axialToPixel(cell.q, cell.r));
    for (let y = Math.floor(center.y - radius); y <= Math.ceil(center.y + radius); y += 1) {
      if (y < 0 || y >= raster.height) continue;
      for (let x = Math.floor(center.x - radius); x <= Math.ceil(center.x + radius); x += 1) {
        if (x < 0 || x >= raster.width) continue;
        if (Math.hypot(x - center.x, y - center.y) > radius) continue;
        const target = (y * raster.width + x) * 4;
        pixels[target] = FILL.r;
        pixels[target + 1] = FILL.g;
        pixels[target + 2] = FILL.b;
        pixels[target + 3] = 255;
      }
    }
  }
  return { width: raster.width, height: raster.height, pixels };
}

function hideDiscoveryGeometry(raster, hypothesis) {
  const pixels = new Uint8ClampedArray(raster.pixels);
  const H = hypothesis.H;
  const cellPx = hypothesis.cellSizePx;
  const project = (point) => {
    const denominator = H[6] * point.x + H[7] * point.y + H[8];
    return {
      x: (H[0] * point.x + H[1] * point.y + H[2]) / denominator,
      y: (H[3] * point.x + H[4] * point.y + H[5]) / denominator,
    };
  };
  const eraseDisc = (center, radius) => {
    for (let y = Math.floor(center.y - radius); y <= Math.ceil(center.y + radius); y += 1) {
      if (y < 0 || y >= raster.height) continue;
      for (let x = Math.floor(center.x - radius); x <= Math.ceil(center.x + radius); x += 1) {
        if (x < 0 || x >= raster.width) continue;
        if (Math.hypot(x - center.x, y - center.y) > radius) continue;
        const target = (y * raster.width + x) * 4;
        pixels[target] = FILL.r;
        pixels[target + 1] = FILL.g;
        pixels[target + 2] = FILL.b;
        pixels[target + 3] = 255;
      }
    }
  };
  // 중심 파인더와 세 앵커만 지운다. format/data 셀은 건드리지 않아 prior 경로는
  // 같은 H 로 본문을 읽을 수 있고, 일반 탐색만 기하 원천을 잃는다.
  eraseDisc(project({ x: 0, y: 0 }), cellPx * 1.6);
  for (const cell of anchorCells(hypothesis.k)) {
    eraseDisc(project(axialToPixel(cell.q, cell.r)), cellPx * 0.58);
  }
  return { width: raster.width, height: raster.height, pixels };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function timingSummary(values) {
  assert.ok(values.length > 0, '비용 표본이 0개다');
  return {
    samples: values.length,
    medianMs: Number(median(values).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
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
let failureFixture = null;
let liveFixture = null;

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

test('회전 라벨 없는 성공 H 도 세 패밀리에서 포즈 이월 후 원문까지 왕복한다', {
  timeout: 180_000,
}, () => {
  assert.ok(fixture && fixture.normal, 'hex 왕복 양성 앵커가 먼저 만들어지지 않았다');
  const cases = [
    { family: 'hex', text: TEXT, raster: fixture.raster, normal: fixture.normal.result },
    { family: 'tri', text: 'poserot synthetic tri' },
    { family: 'cube', text: 'poserot synthetic cube' },
  ];
  const results = [];

  for (const entry of cases) {
    const raster = entry.raster || renderFamily(entry.family, entry.text);
    const normal = entry.normal || decodeFrontend(raster);
    assert.equal(normal.ok, true, `${entry.family}: 일반 탐색 실패 ${normal.reason}`);
    assert.equal(normal.text, entry.text, `${entry.family}: 일반 탐색 오독`);
    assert.ok(Array.isArray(normal.hypothesis.H), `${entry.family}: 성공 H 가 없다`);
    assert.ok(normal.hypothesis.H.every(Number.isFinite), `${entry.family}: 성공 H 가 유한하지 않다`);

    const withoutRotation = JSON.parse(JSON.stringify(normal.hypothesis));
    delete withoutRotation.rotationDegrees;
    assert.equal(Object.hasOwn(withoutRotation, 'rotationDegrees'), false,
      `${entry.family}: 결손 자에 rotationDegrees 가 남았다`);
    const pose = poseFromHypothesis(withoutRotation, {
      id: 'poserot-' + entry.family,
      sourceWidth: raster.width,
      sourceHeight: raster.height,
      targetWidth: raster.width,
      targetHeight: raster.height,
    });
    assert.ok(pose, `${entry.family}: H 에서 포즈를 복원하지 못했다`);
    assert.ok(Number.isFinite(pose.rotationDegrees), `${entry.family}: 복원 회전이 유한하지 않다`);

    const carried = decodeFrontend(raster, { priorPoses: [pose] });
    assert.equal(carried.ok, true, `${entry.family}: 이월 복호 실패 ${carried.reason}`);
    assert.equal(carried.text, entry.text, `${entry.family}: 이월 원문 불일치`);
    results.push({
      family: entry.family,
      source: normal.hypothesis.source,
      rotationDegrees: pose.rotationDegrees,
      roundtrip: true,
    });
  }

  console.log('POSEROT_ROUNDTRIP ' + JSON.stringify({
    total: results.length,
    matched: results.filter((entry) => entry.roundtrip).length,
    results,
  }));
});

test('실패 진단 — 형태가 남고 본문이 가려진 프레임은 이월할 H 를 값으로 싣는다', {
  timeout: 60_000,
}, () => {
  assert.ok(fixture && fixture.raster, '왕복 양성 앵커가 먼저 만들어지지 않았다');
  const damaged = damageDataCells(fixture.raster, fixture.normal.result.hypothesis, 90);
  const measured = timedDecode(damaged);
  const failed = measured.result;
  const validation = failed.detail && failed.detail.diagnostics;
  console.log('POSECARRY_FAILURE_SOURCE ' + JSON.stringify({
    ok: failed.ok,
    reason: failed.reason,
    pipelineCode: failed.detail && failed.detail.pipelineCode,
    hypothesisCount: validation && validation.hypothesisCount,
    formatCandidateCount: validation && validation.formatCandidateCount,
    formatFailures: validation && validation.formatFailures && validation.formatFailures.length,
    bodyFailures: validation && validation.bodyFailures && validation.bodyFailures.length,
    hasCarryHypothesis: Boolean(failed.detail && failed.detail.carryHypothesis),
    carryQuality: failed.detail && failed.detail.carryEvidence
      && failed.detail.carryEvidence.quality,
  }));

  assert.equal(failed.ok, false, '가린 프레임이 성공해 실패 후보 자가 공허하다');
  assert.ok(validation && validation.hypothesisCount > 0,
    '가린 프레임에 기하 가설이 0개라 실패 포즈 원천이 아니다');
  assert.ok(failed.detail && failed.detail.carryHypothesis,
    '일반 탐색 실패 결과에 이월 후보 H 가 실리지 않았다');
  assert.ok(Array.isArray(failed.detail.carryHypothesis.H)
    && failed.detail.carryHypothesis.H.length === 9
    && failed.detail.carryHypothesis.H.every(Number.isFinite),
  '실패 이월 H 가 유한한 JSON 숫자 배열이 아니다');
  assert.equal(failed.detail.carryEvidence.eligible, true);
  assert.equal(failed.detail.carryEvidence.quality, 'format-admitted-body-failed');
  assert.equal(failed.detail.carryEvidence.formatCandidateCount, 1);
  assert.equal(failed.detail.carryEvidence.bodyFailureCount, 1);
  failureFixture = { raster: damaged, failed };
});

test('약한 실패 진단 — symbol-clipped H 는 보이되 라이브 이월에는 쓰지 않는다', {
  timeout: 60_000,
}, () => {
  const tight = render(TEXT, 2, { margin: 4, pixelsPerUnit: 16 });
  const clipped = decodeFrontend(distortImage(tight, { scale: 2, fill: FILL }));
  assert.equal(clipped.ok, false, '2× 줌 잘림 자가 실패하지 않았다');
  assert.equal(clipped.reason, 'frontend:symbol-clipped');
  assert.ok(clipped.detail.geometryDiagnostics.geometryHypothesisCount > 0,
    '기하 가설이 0개라 약한 후보 자가 공허하다');
  assert.ok(clipped.detail.failureHypothesis,
    'symbol-clipped 최선 기하가 진단에 실리지 않았다');
  assert.equal(clipped.detail.carryHypothesis, undefined,
    '포맷 미확정 잘림 H 가 라이브 이월 대상으로 승격됐다');
  assert.equal(clipped.detail.carryEvidence.eligible, false);
  assert.equal(clipped.detail.carryEvidence.quality, 'format-clipped');
  console.log('POSECARRY_WEAK_CLIPPED ' + JSON.stringify({
    reason: clipped.reason,
    geometryHypothesisCount: clipped.detail.geometryDiagnostics.geometryHypothesisCount,
    formatFailureSummary: clipped.detail.formatFailureSummary,
    hasFailureHypothesis: Boolean(clipped.detail.failureHypothesis),
    eligible: clipped.detail.carryEvidence.eligible,
    quality: clipped.detail.carryEvidence.quality,
  }));
});

test('연속 프레임 — 본문 실패 H 이월은 2프레임, 없으면 3프레임 만에 성공한다', {
  timeout: 60_000,
}, () => {
  assert.ok(failureFixture && failureFixture.failed, '강한 실패 후보가 먼저 만들어지지 않았다');
  assert.equal(FRAME_POSE_MAX_ATTEMPTS, 1);
  assert.equal(FRAME_POSE_MAX_AGE_MS, 2000);
  const shellFailure = {
    ok: false,
    carryHypothesis: failureFixture.failed.detail.carryHypothesis,
    carryEvidence: failureFixture.failed.detail.carryEvidence,
  };
  const state = framePoseCarryFromResult(shellFailure, {
    nowMs: 1000,
    sourceWidth: failureFixture.raster.width,
    sourceHeight: failureFixture.raster.height,
  });
  assert.ok(state && state.pose, 'eligible 실패가 이월 상태를 만들지 않았다');
  assert.equal(state.remainingAttempts, 1);

  const expired = consumeFramePoseCarry(state, {
    nowMs: 1000 + FRAME_POSE_MAX_AGE_MS + 1,
    targetWidth: fixture.raster.width,
    targetHeight: fixture.raster.height,
  });
  assert.equal(expired.pose, null);
  assert.equal(expired.reason, 'expired');

  const consumed = consumeFramePoseCarry(state, {
    nowMs: 1100,
    targetWidth: fixture.raster.width,
    targetHeight: fixture.raster.height,
  });
  assert.ok(consumed.pose, '다음 프레임에서 이월 포즈를 꺼내지 못했다');
  assert.equal(consumed.next, null, '1회 소비 뒤 포즈가 남았다');
  assert.equal(consumeFramePoseCarry(consumed.next, {
    nowMs: 1200,
    targetWidth: fixture.raster.width,
    targetHeight: fixture.raster.height,
  }).pose, null, '같은 실패 H 가 두 프레임째 살아 있다');

  const hidden = hideDiscoveryGeometry(fixture.raster, fixture.normal.result.hypothesis);
  const withoutCarry = timedDecode(hidden);
  assert.equal(withoutCarry.result.ok, false,
    '파인더·앵커 은닉 프레임도 전수 탐색이 성공해 프레임 비교가 공허하다');
  assert.ok(withoutCarry.result.detail.failureHypothesis,
    'no-format-candidate 최선 기하가 진단에 실리지 않았다');
  assert.equal(withoutCarry.result.detail.carryHypothesis, undefined,
    '포맷 CRC 실패 H 가 라이브 이월 대상으로 승격됐다');
  assert.equal(withoutCarry.result.detail.carryEvidence.eligible, false);
  assert.equal(withoutCarry.result.detail.carryEvidence.quality, 'format-rejected');
  const poses = carryCandidates(consumed.pose, Math.min(hidden.width, hidden.height));
  const withCarry = timedDecode(hidden, { priorPoses: poses });
  assert.equal(withCarry.result.ok, true, JSON.stringify(withCarry.result));
  assert.equal(withCarry.result.text, TEXT);
  assert.equal(withCarry.result.diagnostics.bootstrap.geometry.source, 'guide-prior');

  // frame 1 = 본문 실패. frame 2 에서 이월은 성공한다. 이월이 없으면 같은 frame 2 가
  // no-anchors 로 실패하고, 양성 앵커인 clean frame 3 에서야 성공한다.
  const withCarryFrames = 2;
  const withoutCarryFrames = 3;
  assert.equal(fixture.normal.result.ok, true, 'frame 3 clean 양성 앵커가 사라졌다');
  assert.ok(withCarryFrames < withoutCarryFrames);
  liveFixture = { hidden, withCarry, withoutCarry, shellFailure };
  console.log('POSECARRY_SEQUENCE ' + JSON.stringify({
    samples: 1,
    withCarryFrames,
    withoutCarryFrames,
    savedFrames: withoutCarryFrames - withCarryFrames,
    frame2WithoutCarryReason: withoutCarry.result.reason,
    frame2WithoutCarryQuality: withoutCarry.result.detail.carryEvidence.quality,
    frame2WithoutCarryHypotheses: withoutCarry.result.detail.diagnostics.hypothesisCount,
    frame2WithoutCarryFormatCandidates:
      withoutCarry.result.detail.diagnostics.formatCandidateCount,
    frame2CarryMs: Number(withCarry.ms.toFixed(3)),
    frame2LegacyMs: Number(withoutCarry.ms.toFixed(3)),
  }));
});

test('비용 — 이월 실패는 한 프레임만 쓰고 다음 전수 폴백까지 종전 두 프레임보다 싸다', {
  timeout: 60_000,
}, () => {
  assert.ok(failureFixture && liveFixture, '비용 양성·실패 앵커가 먼저 만들어지지 않았다');
  const state = framePoseCarryFromResult(liveFixture.shellFailure, {
    nowMs: 2000,
    sourceWidth: failureFixture.raster.width,
    sourceHeight: failureFixture.raster.height,
  });
  const consumed = consumeFramePoseCarry(state, {
    nowMs: 2100,
    targetWidth: failureFixture.raster.width,
    targetHeight: failureFixture.raster.height,
  });
  const poses = carryCandidates(
    consumed.pose,
    Math.min(failureFixture.raster.width, failureFixture.raster.height),
  );
  const missRaster = translateRaster(liveFixture.hidden, 30, 0);
  const carryMiss = timedDecode(missRaster, { priorPoses: poses });
  assert.equal(carryMiss.result.ok, false, '본문 훼손 프레임의 이월 실패 자가 성공했다');
  const legacyFirst = timedDecode(missRaster);
  assert.equal(legacyFirst.result.ok, false, '종전 첫 프레임 실패 자가 성공했다');
  const fallback = timedDecode(missRaster);
  assert.equal(fallback.result.ok, false, '다음 프레임 전수 폴백 실패 자가 성공했다');

  const carryMissThenFallback = carryMiss.ms + fallback.ms;
  const legacyTwoFrames = legacyFirst.ms + fallback.ms;
  assert.ok(carryMissThenFallback <= legacyTwoFrames,
    `이월 실패+다음 폴백 ${carryMissThenFallback.toFixed(3)}ms > 종전 두 프레임 ${legacyTwoFrames.toFixed(3)}ms`);

  console.log('POSECARRY_COST ' + JSON.stringify({
    carryHitFrame: timingSummary([liveFixture.withCarry.ms]),
    carryMissFrame: timingSummary([carryMiss.ms]),
    fallbackFrame: timingSummary([fallback.ms]),
    carryMissThenFallback: timingSummary([carryMissThenFallback]),
    legacyTwoFrames: timingSummary([legacyTwoFrames]),
  }));

  // 변이 증인 — miss 표식을 지우면 같은 실패 후보가 다시 살아날 수 있다.
  assert.equal(framePoseCarryFromResult({
    ...liveFixture.shellFailure,
    carryMiss: true,
  }, {
    nowMs: 2200,
    sourceWidth: failureFixture.raster.width,
    sourceHeight: failureFixture.raster.height,
  }), null, 'carryMiss 뒤 포즈가 다시 살아났다');
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
    { ...base, rotationDegrees: 'invalid' },
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

test('스캐너 배선 — 실패 포즈 1회·다음 프레임 폴백·시도 경계 리셋', () => {
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
  const missAt = carry.indexOf('carryMiss: true');
  assert.ok(priorAt >= 0 && missAt > priorAt,
    '직전 포즈 실패가 소비 표식을 남기지 않는다');
  assert.doesNotMatch(carry, /const fallback = await decodeFrame/,
    '이월 실패 프레임에 전수 탐색을 덧붙여 비용을 키운다');
  assert.match(carry, /if \(useGuidePrior\) return attemptGuidePriorScan/,
    '예약된 가이드-사전 프레임보다 이월을 우선해 비용을 더한다');

  const loop = SCANNER_JS.slice(
    SCANNER_JS.indexOf('function startFrameLoop'),
    SCANNER_JS.indexOf('async function startCamera'),
  );
  assert.match(loop, /lastFramePose\s*\?\s*attemptCarriedPoseScan/,
    '프레임 루프가 직전 포즈를 우선하지 않는다');
  assert.match(loop, /rememberFramePose\(result, imageData\)/,
    '실패 결과에서 이번 프레임 포즈를 갱신하지 않는다');
  assert.match(loop, /\.catch\([\s\S]*?lastFramePose\s*=\s*null/,
    '예외 프레임이 이전 포즈를 남긴다');
});

test('라이브 생명주기 — 성공은 세션을 끝내므로 실패 프레임이 다음 포즈를 남긴다', () => {
  const remember = SCANNER_JS.slice(
    SCANNER_JS.indexOf('function rememberFramePose'),
    SCANNER_JS.indexOf('async function attemptCarriedPoseScan'),
  );
  const handle = SCANNER_JS.slice(
    SCANNER_JS.indexOf('function handleDecodeResult'),
    SCANNER_JS.indexOf('function startFrameLoop'),
  );
  const loop = SCANNER_JS.slice(
    SCANNER_JS.indexOf('function startFrameLoop'),
    SCANNER_JS.indexOf('async function startCamera'),
  );

  assert.match(handle, /if \(!payload\)[\s\S]*?return;[\s\S]*?stopCamera\(\)/,
    '성공 뒤 stopCamera 로 세션이 끝난다는 양성 앵커가 사라졌다');
  assert.match(loop, /rememberFramePose\(result, imageData\)[\s\S]*?handleDecodeResult/,
    '이번 프레임 상태 확정이 성공 종료 판정보다 먼저가 아니다');
  assert.match(remember, /framePoseCarryFromResult/,
    '실패 결과의 기하를 읽지 않는다 — 성공 때만 생긴 포즈에는 다음 프레임이 없다');
  assert.doesNotMatch(remember, /lastFramePose\s*=\s*result && result\.ok === true/,
    '성공 전용 이월 배선으로 되돌아갔다');
});
