import test from 'node:test';
import assert from 'node:assert/strict';
import { createCubeYCandidateRuntime } from '../src/r2/cube-y-runtime.js';
import { trackCubeYFaces } from '../src/r2/cube-y-motion.js';
import { DEFAULT_CUBE_Y_CONTINUITY } from '../src/r2/cube-y-identity.js';
import { renderCubeY } from './helpers/r2-cube-y-fixture.js';

const TEXT = 'https://tl.estre.so/a';
const OTHER = 'https://tl.estre.so/b';

function translateField(field, dx, dy) {
  const data = new Float32Array(field.data.length);
  for (let y = 0; y < field.height; y++) {
    for (let x = 0; x < field.width; x++) {
      const sx = x - dx, sy = y - dy;
      if (sx >= 0 && sy >= 0 && sx < field.width && sy < field.height) {
        data[y * field.width + x] = field.data[sy * field.width + sx];
      }
    }
  }
  return { width: field.width, height: field.height, data };
}

test('면별 추적은 전역 motion을 허위로 반환하지 않고 면마다 H를 합성해요', () => {
  const field = renderCubeY(TEXT).field;
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  const live = runtime.hudCandidates.find(row => row.alive && row.faceHs?.length === 3);
  assert.ok(live, 'blind acquire가 face-H를 만들지 못했어요');
  const tracking = trackCubeYFaces(field, field, live.faceHs);
  assert.equal(tracking.ok, true);
  assert.equal(tracking.motion, null);
  assert.equal(tracking.faceMotions.length, 3);
  assert.ok(tracking.faceMotions.every(H => H instanceof Float64Array && H.length === 9));
  assert.equal(tracking.perFace.length, 3);
  assert.ok(tracking.perFace.every(row => row.after.count >= 20 && row.gain > 0
    && Number.isFinite(row.after.ncc)));
  assert.equal(tracking.after.ncc, Math.min(...tracking.perFace.map(row => row.after.ncc)));
  assert.equal(tracking.gain, Math.min(...tracking.perFace.map(row => row.gain)));
  assert.equal(tracking.after.count, tracking.perFace.reduce((sum, row) => sum + row.after.count, 0));
  assert.equal(tracking.iterations, tracking.perFace.reduce((sum, row) => sum + row.iterations, 0));
});

test('정지 동일 프레임은 detect 첫 프레임만으로 12프레임 안에 실제 RS DONE이에요', () => {
  const origin = renderCubeY(TEXT);
  const runtime = createCubeYCandidateRuntime();
  let hit = null;
  for (let frame = 0; frame < 12 && !hit; frame++) {
    hit = runtime.pushFrame(origin.field, frame * 100, {
      frameId: frame, runDetect: frame === 0, maxCandidates: 8, budgetMs: Infinity,
    });
  }
  assert.ok(hit, '정지 합성 Y가 12프레임 안에 DONE이 아니에요');
  assert.equal(hit.text, TEXT);
  assert.equal(hit.actualRS.used, true);
});

test('yaw 0.5°씩 증가하는 프레임은 detect 첫 프레임만으로 12프레임 안에 실제 RS DONE이에요', () => {
  const runtime = createCubeYCandidateRuntime();
  let hit = null;
  for (let frame = 0; frame < 12 && !hit; frame++) {
    const rendered = renderCubeY(TEXT, { yawDeg: frame * 0.5 });
    hit = runtime.pushFrame(rendered.field, frame * 100, {
      frameId: frame, runDetect: frame === 0, maxCandidates: 8, budgetMs: Infinity,
    });
  }
  assert.ok(hit, 'yaw 0.5° 재현이 12프레임 안에 DONE이 아니에요');
  assert.equal(hit.text, TEXT);
  assert.equal(hit.actualRS.used, true);
});

test('평행이동이 지속돼도 첫 프레임 획득의 실제 RS DONE을 유지해요', () => {
  const origin = renderCubeY(TEXT);
  const runtime = createCubeYCandidateRuntime();
  let hit = runtime.pushFrame(origin.field, 0, {
    frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity,
  });
  for (let frame = 1; frame < 12 && !hit; frame++) {
    hit = runtime.pushFrame(translateField(origin.field, frame, 0), frame * 100, {
      frameId: frame, runDetect: false, maxCandidates: 8, budgetMs: Infinity,
    });
  }
  assert.ok(hit, '1px 평행이동 지속이 12프레임 안에 DONE이 아니에요');
  assert.equal(hit.text, TEXT);
  assert.equal(hit.actualRS.used, true);
});

test('payload 교체와 blank 가림은 old epoch에 누적하지 않아요', () => {
  const A = renderCubeY(TEXT);
  const B = renderCubeY(OTHER);
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(A.field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  assert.ok(runtime.stats.candidateCount > 0);
  const pushes = runtime.stats.sessionPushes;
  runtime.pushFrame(B.field, 100, { frameId: 1, runDetect: false, maxCandidates: 8, budgetMs: Infinity });
  assert.equal(runtime.stats.sessionPushes, pushes, '교체 프레임이 old epoch 증거에 들어갔어요');
  assert.equal(runtime.stats.candidateCount, 0);

  runtime.reset();
  runtime.pushFrame(A.field, 0, { frameId: 'cover-0', runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  const afterBind = runtime.stats.sessionPushes;
  const covered = { width: A.field.width, height: A.field.height, data: new A.field.data.constructor(A.field.data.length) };
  covered.data.fill(0.5);
  runtime.pushFrame(covered, 100, { frameId: 'cover-1', runDetect: false, maxCandidates: 8, budgetMs: Infinity });
  assert.equal(runtime.stats.sessionPushes, afterBind, '가림 프레임이 old epoch 증거에 들어갔어요');
  assert.equal(runtime.stats.candidateCount, 0);
});

const POSE_TEXT = 'https://tl.cu/y-pose';

function hsCopy(faceHs) {
  return faceHs.map((H) => Float64Array.from(H));
}
function hsUnchanged(actual, expected) {
  return actual.length === expected.length && actual.every((H, face) =>
    H.length === expected[face].length && H.every((value, i) => value === expected[face][i]));
}

function sweepPose(text, optionsForFrame, label) {
  const runtime = createCubeYCandidateRuntime();
  let hit = null;
  for (let frame = 0; frame < 12 && !hit; frame++) {
    const rendered = renderCubeY(text, optionsForFrame(frame));
    hit = runtime.pushFrame(rendered.field, frame * 100, {
      frameId: frame, runDetect: frame === 0, maxCandidates: 8, budgetMs: Infinity,
    });
  }
  assert.ok(hit, label);
  assert.equal(hit.text, text);
  assert.equal(hit.actualRS.used, true);
}

test('roll 2° 증가 holdout은 12프레임 안에 실제 RS DONE이에요', () => {
  sweepPose(POSE_TEXT, (frame) => ({ rollDeg: frame * 2 }),
    'rollDeg=frame*2 holdout이 12프레임 안에 DONE이 아니에요');
});

test('yaw 2°씩 증가하는 프레임은 12프레임 안에 실제 RS DONE이에요', () => {
  sweepPose(TEXT, (frame) => ({ yawDeg: frame * 2 }),
    'yawDeg=frame*2가 12프레임 안에 DONE이 아니에요');
});

test('pitch -20+2°씩 증가하는 프레임은 12프레임 안에 실제 RS DONE이에요', () => {
  sweepPose(TEXT, (frame) => ({ pitchDeg: -20 + frame * 2 }),
    'pitchDeg=-20+frame*2가 12프레임 안에 DONE이 아니에요');
});

test('roll 4°씩 증가하는 프레임은 12프레임 안에 실제 RS DONE이에요', () => {
  sweepPose(TEXT, (frame) => ({ rollDeg: frame * 4 }),
    'rollDeg=frame*4가 12프레임 안에 DONE이 아니에요');
});

test('perspective 9+4°씩 증가하는 프레임은 12프레임 안에 실제 RS DONE이에요', () => {
  sweepPose(TEXT, (frame) => ({ perspectiveDeg: 9 + frame * 4 }),
    'perspectiveDeg=9+frame*4가 12프레임 안에 DONE이 아니에요');
});

test('정지 필드와 yaw 0.5는 direct가 성공하면 fallback을 쓰지 않고 입력을 변경하지 않아요', () => {
  const still = renderCubeY(TEXT);
  const yaw = renderCubeY(TEXT, { yawDeg: 0.5 });
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(still.field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  const live = runtime.hudCandidates.find(row => row.alive && row.faceHs?.length === 3);
  assert.ok(live, 'blind acquire가 face-H를 만들지 못했어요');
  const stillLuma = still.field.data.slice();
  const yawLuma = yaw.field.data.slice();
  const faces = hsCopy(live.faceHs);
  const identity = trackCubeYFaces(still.field, still.field, live.faceHs);
  assert.equal(identity.ok, true);
  assert.ok(identity.perFace.every(row => row.fallbackUsed === false), '정지 추적에 fallback이 실행됐어요');
  const moved = trackCubeYFaces(still.field, yaw.field, live.faceHs);
  assert.equal(moved.ok, true, 'yaw 0.5 direct 추적이 실패했어요');
  assert.ok(moved.perFace.every(row => row.after.ncc >= 0.96), 'yaw 0.5 면별 NCC가 0.96 미만이에요');
  assert.ok(moved.perFace.every(row => row.fallbackUsed === false), 'yaw 0.5 direct 성공인데 fallback이 실행됐어요');
  assert.deepEqual(still.field.data, stillLuma);
  assert.deepEqual(yaw.field.data, yawLuma);
  assert.equal(hsUnchanged(live.faceHs, faces), true);
});

function cropRightBottom(field) {
  const width = field.width - 1, height = field.height - 1;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    data.set(field.data.subarray(y * field.width, y * field.width + width), y * width);
  }
  return { width, height, data };
}

test('blind origin H의 roll4 pair는 공유 seed를 쓰고 원해상도 NCC 기본값을 넘어요', () => {
  const origin = renderCubeY(TEXT);
  const moved = renderCubeY(TEXT, { rollDeg: 4 });
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(origin.field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  const live = runtime.hudCandidates.find(row => row.alive && row.faceHs?.length === 3);
  assert.ok(live, 'blind acquire가 face-H를 만들지 못했어요');
  const originLuma = origin.field.data.slice();
  const movedLuma = moved.field.data.slice();
  const faces = hsCopy(live.faceHs);
  const tracking = trackCubeYFaces(origin.field, moved.field, live.faceHs);
  assert.equal(tracking.ok, true, 'roll4 pair 추적이 실패했어요');
  assert.ok(tracking.perFace.some(row => row.fallbackUsed === true), 'roll4 pair에서 fallback이 없어요');
  assert.equal(tracking.globalSeedUsed, true, 'roll4 pair가 공유 seed를 쓰지 않았어요');
  assert.ok(tracking.perFace.some(row => row.seedKind === 'global-seed'));
  assert.ok(tracking.perFace.every(row => row.after.ncc >= DEFAULT_CUBE_Y_CONTINUITY.minTrackedNcc));
  assert.equal(tracking.iterations, tracking.perFace.reduce((sum, row) => sum + row.iterations, 0));
  assert.deepEqual(origin.field.data, originLuma);
  assert.deepEqual(moved.field.data, movedLuma);
  assert.equal(hsUnchanged(live.faceHs, faces), true);
});

test('오른쪽·아래 1px를 자른 odd crop에서도 roll4 pair는 fallback과 NCC 기본값을 지켜요', () => {
  const origin = renderCubeY(TEXT);
  const moved = renderCubeY(TEXT, { rollDeg: 4 });
  const originCrop = cropRightBottom(origin.field);
  const movedCrop = cropRightBottom(moved.field);
  assert.equal(originCrop.width, origin.field.width - 1);
  assert.equal(originCrop.height, origin.field.height - 1);
  const originUncropped = origin.field.data.slice();
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(originCrop, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  const live = runtime.hudCandidates.find(row => row.alive && row.faceHs?.length === 3);
  assert.ok(live, 'crop origin에서 blind acquire가 face-H를 만들지 못했어요');
  const cropLuma = originCrop.data.slice();
  const faces = hsCopy(live.faceHs);
  const tracking = trackCubeYFaces(originCrop, movedCrop, live.faceHs);
  assert.equal(tracking.ok, true, 'odd crop roll4 pair 추적이 실패했어요');
  assert.ok(tracking.perFace.some(row => row.fallbackUsed === true));
  assert.ok(tracking.perFace.every(row => row.after.ncc >= DEFAULT_CUBE_Y_CONTINUITY.minTrackedNcc));
  assert.deepEqual(originCrop.data, cropLuma);
  assert.deepEqual(origin.field.data, originUncropped);
  assert.equal(hsUnchanged(live.faceHs, faces), true);
});

test('minTrackedNcc는 정본 default를 쓰고 잘못된 값은 거부해요', () => {
  const origin = renderCubeY(TEXT);
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(origin.field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  const live = runtime.hudCandidates.find(row => row.alive && row.faceHs?.length === 3);
  assert.ok(live, 'blind acquire가 face-H를 만들지 못했어요');
  assert.throws(() => trackCubeYFaces(origin.field, origin.field, live.faceHs, { minTrackedNcc: 1.1 }), TypeError);
  assert.throws(() => trackCubeYFaces(origin.field, origin.field, live.faceHs, { minTrackedNcc: Number.NaN }), TypeError);
  assert.throws(() => trackCubeYFaces(origin.field, origin.field, live.faceHs, { minTrackedNcc: -0.01 }), TypeError);
  const strict = trackCubeYFaces(origin.field, origin.field, live.faceHs, { minTrackedNcc: 0.99 });
  assert.equal(strict.ok, true);
  assert.ok(strict.perFace.every(row => row.after.ncc >= 0.99));
  assert.ok(strict.perFace.every(row => row.fallbackUsed === false));
});
