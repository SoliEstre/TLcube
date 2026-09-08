import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotCubeYObservation, compareCubeYObservations } from '../src/r2/cube-y-identity.js';
import { observeCubeYCandidates } from '../src/r2/cube-y-acquisition.js';
import { createCubeYCandidateRuntime } from '../src/r2/cube-y-runtime.js';
import { encodeY } from '../src/encodeY.js';
import { buildOrbitMesh } from '../src/y3d-viewer.js';
import { layoutForCube } from '../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';

function rawCell(digit, margin = 30) {
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const values = [0, 0, 0];
  values[orders[digit][0]] = 128 + margin;
  values[orders[digit][1]] = 128;
  values[orders[digit][2]] = 128 - margin;
  return values;
}
function observation(digits, margin = 30) {
  const faces = new Uint8Array(digits.length * 3);
  digits.forEach((digit, cell) => faces.set(rawCell(digit, margin), cell * 3));
  return snapshotCubeYObservation(faces, new Uint8Array(digits.length).fill(1));
}
function render(text) {
  const encoded = encodeY(text, { cellSurfaceLayout: 'v0tr', version: 2, tones: 3, eccLevel: 'H', maskIndex: 0 });
  const layout = layoutForCube(encoded.n, { size: 1, margin: 4 });
  const preset = getPreset(DEFAULT_PRESET);
  const mesh = buildOrbitMesh({ n: encoded.n, tones: encoded.tones, levels: preset.levels, layout,
    digitAt: (i, j) => encoded.cellDigits.get(`${i},${j}`)?.digit ?? null,
    levelAt: (i, j, face) => encoded.cellDigits.get(`${i},${j}`)?.tones?.[face] ?? null,
    yaw: 0, pitch: -20 * Math.PI / 180, roll: 0, faces: 3, perspective: 0.15 });
  const raster = rasterize({ width: layout.width, height: layout.height, background: preset.background,
    shapes: mesh.quads.map((quad) => ({ kind: 'polygon', points: quad.points2d, color: quad.color })) },
  { pixelsPerUnit: 17, supersample: 2 });
  return toRelativeLuminance({ width: raster.width, height: raster.height, pixels: raster.pixels }, {});
}

test('원시 3면 순위는 미확정 셀까지 비교하고 부족·모순을 fail-closed 한다', () => {
  const baseDigits = Array.from({ length: 100 }, (_, index) => index % 6);
  const same = compareCubeYObservations(observation(baseDigits), observation(baseDigits));
  assert.equal(same.ok, true); assert.equal(same.reliable, 100); assert.equal(same.contradictions, 0);
  const changed = baseDigits.map((digit, index) => index < 9 ? (digit + 1) % 6 : digit);
  const contradiction = compareCubeYObservations(observation(baseDigits), observation(changed));
  assert.equal(contradiction.ok, false); assert.equal(contradiction.reason, 'raw-rank-contradiction');
  const weak = compareCubeYObservations(observation(baseDigits, 2), observation(baseDigits, 2));
  assert.equal(weak.ok, false); assert.equal(weak.reason, 'insufficient-reliable-overlap');
});

test('blind 3D Y 획득은 n/pose 주입 없이 후보 소유 face-H와 실제 레이아웃을 만든다', () => {
  const field = render('https://tl.estre.so/a');
  const result = observeCubeYCandidates(field, { maxCandidates: 3 });
  assert.ok(result.observed > 0); assert.ok(result.descriptorCount > 0);
  assert.ok(result.candidates.length > 0 && result.candidates.length <= 3);
  for (const candidate of result.candidates) {
    assert.equal(candidate.faceHs.length, 3);
    assert.ok(candidate.faceHs.every((H) => H instanceof Float64Array && H.length === 9));
    assert.equal(candidate.bound.cellCount, candidate.scan.length);
    assert.equal(candidate.key.dimension, candidate.n);
  }
});

test('3D Y 런타임은 프레임당 한 번 누적하고 DONE snapshot을 후보 제거 뒤에도 소유한다', () => {
  const field = render('https://tl.estre.so/a');
  const runtime = createCubeYCandidateRuntime({ maxIdleFrames: 30 });
  runtime.setCapacity(4);
  let hit = null;
  for (let frame = 0; frame < 16 && !hit; frame++) {
    hit = runtime.pushFrame(field, frame * 100, { frameId: frame, runDetect: frame === 0, maxCandidates: 4 });
    if (frame === 0) {
      const revisions = runtime.hudCandidates.map((row) => row.revision);
      runtime.pushFrame(field, 0, { frameId: 0, runDetect: false, maxCandidates: 4 });
      assert.deepEqual(runtime.hudCandidates.map((row) => row.revision), revisions, '같은 프레임이 두 번 누적됐다');
    }
  }
  assert.ok(hit, '실제 R2/RS가 정지 합성 Y를 풀지 못했다');
  assert.equal(hit.text, 'https://tl.estre.so/a');
  assert.equal(hit.actualRS.used, true);
  assert.ok(runtime.accepted?.snapshot);
  assert.equal(runtime.accepted.snapshot.alive, false);
  assert.equal(runtime.accepted.snapshot.retained, true);
  const saved = runtime.accepted.snapshot.cellMap[0];
  const acceptedRow = runtime.hudCandidates.find((row) => row.id === hit.candidateId);
  assert.ok(acceptedRow);
  acceptedRow.cellMap[0] ^= 3;
  assert.equal(runtime.accepted.snapshot.cellMap[0], saved, '외부 HUD 변경이 accepted snapshot을 오염했다');
});

test('deferFrame과 cap 0은 세션 증거를 만들지 않고 HUD 보존만 개정한다', () => {
  const field = render('https://tl.estre.so/a');
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: 1000 });
  assert.ok(runtime.stats.candidateCount > 0 && runtime.stats.candidateCount <= 8);
  const pushes = runtime.stats.sessionPushes;
  const before = runtime.hudCandidates.map((row) => ({ id: row.id, revision: row.revision }));
  runtime.deferFrame();
  assert.equal(runtime.stats.sessionPushes, pushes);
  assert.deepEqual(runtime.hudCandidates.map((row) => ({ id: row.id, revision: row.revision })),
    before.map((row) => ({ ...row, revision: row.revision + 1 })));
  assert.ok(runtime.hudCandidates.every((row) => row.tracking === false && row.retained === true));
  runtime.setCapacity(0);
  assert.equal(runtime.stats.candidateCount, 0);
  runtime.pushFrame(field, 100, { frameId: 1, runDetect: true, maxCandidates: 0, budgetMs: 1000 });
  assert.equal(runtime.stats.candidateCount, 0);
  assert.equal(runtime.stats.sessionPushes, pushes);
  runtime.pushFrame(field, 200, { frameId: 2, runDetect: true, maxCandidates: 8, budgetMs: 1000 });
  assert.ok(runtime.stats.candidateCount > 0 && runtime.stats.candidateCount <= 8,
    'setCapacity(0)이 뒤 프레임의 새 8좌석을 영구 잠갔다');
});

test('다른 유효 Y로 바뀐 프레임은 old epoch에 한 번도 push하지 않는다', () => {
  const A = render('https://tl.estre.so/a');
  const B = render('https://tl.estre.so/b');
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(A, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: 1000 });
  assert.ok(runtime.stats.candidateCount > 0);
  const pushes = runtime.stats.sessionPushes;
  runtime.pushFrame(B, 100, { frameId: 1, runDetect: false, maxCandidates: 8, budgetMs: 1000 });
  assert.equal(runtime.stats.sessionPushes, pushes, '교체 프레임이 old epoch 증거에 들어갔다');
  assert.equal(runtime.stats.candidateCount, 0);
});
