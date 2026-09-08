import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotCubeYObservation, compareCubeYObservations } from '../src/r2/cube-y-identity.js';
import { createCubeYAcquisition, observeCubeYCandidates } from '../src/r2/cube-y-acquisition.js';
import { createCubeYCandidateRuntime } from '../src/r2/cube-y-runtime.js';
import { cubeYFaceTrackingPoints } from '../src/r2/cube-y-motion.js';
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
function render(text, tones = 3) {
  const encoded = encodeY(text, { cellSurfaceLayout: 'v0tr', version: 2, tones, eccLevel: 'H', maskIndex: 0 });
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
    assert.equal(candidate.key.profile, 'Y');
    assert.equal(candidate.key.dimensionKind, 'side-n');
    assert.match(candidate.key.sourceIdentity, /^y-faces:e/);
  }
});

test('motion 추적점은 sample과 같은 face basis의 각 사영 마름모 안에 있다', () => {
  const field = render('https://tl.estre.so/a');
  const candidate = observeCubeYCandidates(field, { maxCandidates: 1 }).candidates[0];
  const points = cubeYFaceTrackingPoints(candidate.faceHs, field.width, field.height, { gridSide: 8 });
  assert.ok(points.length > 20);
  const basis = (face, a, b) => ({
    x: a * [Math.sqrt(3) / 2, -Math.sqrt(3) / 2, 0][face]
      + b * [-Math.sqrt(3) / 2, 0, Math.sqrt(3) / 2][face],
    y: a * [-0.5, -0.5, 1][face] + b * [-0.5, 1, -0.5][face],
  });
  const project = (H, point) => { const w = H[6] * point.x + H[7] * point.y + H[8];
    return { x: (H[0] * point.x + H[1] * point.y + H[2]) / w,
      y: (H[3] * point.x + H[4] * point.y + H[5]) / w }; };
  const inside = (point, polygon) => {
    let sign = 0;
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
      if (Math.abs(cross) < 1e-7) continue;
      const current = Math.sign(cross); if (sign && current !== sign) return false; sign = current;
    }
    return true;
  };
  for (const point of points) {
    const H = candidate.faceHs[point.face];
    const polygon = [[0, 0], [1, 0], [1, 1], [0, 1]]
      .map(([a, b]) => project(H, basis(point.face, a, b)));
    assert.equal(inside(point, polygon), true, `face ${point.face} 추적점이 면 밖이다`);
    const expected = project(H, basis(point.face, point.a, point.b));
    assert.ok(Math.abs(point.x - expected.x) < 1e-9 && Math.abs(point.y - expected.y) < 1e-9);
  }
});

test('2톤 단독 odd-face 정본은 동률 gap이 아니라 odd gap으로 연속성을 세운다', () => {
  const field = render('https://tl.estre.so/a', 2);
  const found = observeCubeYCandidates(field, { maxCandidates: 8 });
  const candidate = found.candidates.find((row) => row.format.tones === 2);
  assert.ok(candidate);
  const before = snapshotCubeYObservation(candidate.faceLuma, candidate.visibleCells, 2);
  const after = snapshotCubeYObservation(candidate.faceLuma, candidate.visibleCells, 2);
  const compared = compareCubeYObservations(before, after);
  assert.equal(compared.ok, true);
  assert.ok(compared.reliable >= compared.requiredReliable);
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  const pushes = runtime.stats.sessionPushes;
  runtime.pushFrame(field, 100, { frameId: 1, runDetect: false, maxCandidates: 8, budgetMs: Infinity });
  assert.ok(runtime.stats.sessionPushes > pushes, '2톤 안정 프레임이 연속성 gate에서 전량 닫혔다');
});

test('획득 cursor는 origin snapshot/epoch를 보존하고 1-unit 재개가 동기 결과와 같다', () => {
  const field = render('https://tl.estre.so/a');
  const baseline = observeCubeYCandidates(field, { maxCandidates: 8 });
  const acquisition = createCubeYAcquisition();
  const firstPixel = field.data[0];
  acquisition.start(field, { frameId: 'origin', timestamp: 123, epoch: 7 });
  field.data[0] = firstPixel === 0 ? 1 : 0;
  let view;
  do { view = acquisition.resume({ maxAdditionalMs: Infinity, maxWorkUnits: 1 }); } while (!view.complete);
  const resumed = acquisition.takeCompleted({ maxCandidates: 8 });
  assert.equal(resumed.origin.frameId, 'origin'); assert.equal(resumed.origin.timestamp, 123);
  assert.equal(resumed.origin.epoch, 7); assert.equal(resumed.origin.field.data[0], firstPixel);
  const signature = (result) => result.candidates.map((candidate) => ({ n: candidate.n,
    layoutId: candidate.layoutId, format: candidate.format, F: candidate.F, margin: candidate.margin,
    faceHs: candidate.faceHs.map((H) => Array.from(H)), faceLuma: Array.from(candidate.faceLuma),
    visibleCells: Array.from(candidate.visibleCells) }));
  assert.deepEqual(signature(resumed), signature(baseline));
  assert.ok(acquisition.stats.maxUnitMs > 0 && acquisition.stats.maxUnitKind);
});

test('같은 영상·기하도 획득 epoch가 다르면 후보 sourceIdentity가 충돌하지 않는다', () => {
  const field = render('https://tl.estre.so/a');
  const acquisition = createCubeYAcquisition();
  const acquire = (epoch) => {
    acquisition.start(field, { frameId: epoch, timestamp: epoch * 100, epoch });
    acquisition.resume({ maxAdditionalMs: Infinity, maxWorkUnits: Infinity });
    return acquisition.takeCompleted({ maxCandidates: 8 });
  };
  const first = acquire(41);
  const second = acquire(42);
  assert.ok(first.candidates.length > 0 && second.candidates.length > 0);
  const firstKeys = new Set(first.candidates.map((candidate) => candidate.key.sourceIdentity));
  const secondKeys = new Set(second.candidates.map((candidate) => candidate.key.sourceIdentity));
  assert.equal([...firstKeys].some((key) => secondKeys.has(key)), false);
  assert.ok([...firstKeys].every((key) => key.startsWith('y-faces:e41:')));
  assert.ok([...secondKeys].every((key) => key.startsWith('y-faces:e42:')));
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
  assert.equal(runtime.accepted.hit.candidateId, hit.candidateId,
    '같은 프레임의 뒤 DONE 후보가 첫 반환 hit 정본을 덮었다');
  assert.equal(runtime.accepted.snapshot.alive, true);
  assert.equal(runtime.accepted.snapshot.retained, true);
  assert.equal(hit.hudSnapshot.id, hit.candidateId);
  assert.equal(hit.hudSnapshot.indicator, 4);
  assert.equal(hit.hudSnapshot.alive, true);
  const saved = runtime.accepted.snapshot.cellMap[0];
  const acceptedRow = runtime.hudCandidates.find((row) => row.id === hit.candidateId);
  assert.ok(acceptedRow);
  acceptedRow.cellMap[0] ^= 3;
  assert.equal(runtime.accepted.snapshot.cellMap[0], saved, '외부 HUD 변경이 accepted snapshot을 오염했다');
  hit.hudSnapshot.cellMap[0] ^= 3;
  assert.equal(runtime.accepted.snapshot.cellMap[0], saved, '반환 hit snapshot이 accepted 정본을 오염했다');
  const firstAcceptedId = runtime.accepted.hit.candidateId;
  let duplicate = null;
  for (let frame = 16; frame < 32; frame++) {
    duplicate = runtime.pushFrame(field, frame * 100,
      { frameId: frame, runDetect: true, maxCandidates: 4, budgetMs: Infinity }) ?? duplicate;
  }
  assert.equal(duplicate, null, '수용 뒤 새 DONE이 런타임의 첫 hit를 다시 반환했다');
  assert.equal(runtime.accepted.hit.candidateId, firstAcceptedId, '수용 뒤 accepted 정본이 덮였다');
});

test('deferFrame과 cap 0은 세션 증거를 만들지 않고 HUD 보존만 개정한다', () => {
  const field = render('https://tl.estre.so/a');
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
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
  assert.equal(runtime.hudCandidates.length, 0, '직접 capacity 축소 뒤 retired HUD 행이 남았다');
  runtime.pushFrame(field, 100, { frameId: 1, runDetect: true, maxCandidates: 0, budgetMs: Infinity });
  assert.equal(runtime.stats.candidateCount, 0);
  assert.equal(runtime.stats.sessionPushes, pushes);
  runtime.pushFrame(field, 200, { frameId: 2, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  assert.ok(runtime.stats.candidateCount > 0 && runtime.stats.candidateCount <= 8,
    'setCapacity(0)이 뒤 프레임의 새 8좌석을 영구 잠갔다');
});

test('다른 유효 Y로 바뀐 프레임은 old epoch에 한 번도 push하지 않는다', () => {
  const A = render('https://tl.estre.so/a');
  const B = render('https://tl.estre.so/b');
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(A, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  assert.ok(runtime.stats.candidateCount > 0);
  const pushes = runtime.stats.sessionPushes;
  runtime.pushFrame(B, 100, { frameId: 1, runDetect: false, maxCandidates: 8, budgetMs: Infinity });
  assert.equal(runtime.stats.sessionPushes, pushes, '교체 프레임이 old epoch 증거에 들어갔다');
  assert.equal(runtime.stats.candidateCount, 0);
});

test('오래 재개된 A origin H는 현재 B에 직접 적용하지 않고 current raw identity에서 bind 0이다', () => {
  const A = render('https://tl.estre.so/a');
  const B = render('https://tl.estre.so/b');
  const runtime = createCubeYCandidateRuntime({ maxAcquisitionWorkUnits: 1 });
  runtime.pushFrame(A, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  let frame = 1;
  while (frame < 1000 && runtime.stats.observations === 0) {
    runtime.pushFrame(B, frame * 100, { frameId: frame, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
    frame++;
  }
  assert.ok(runtime.stats.observations > 0, 'origin cursor가 완료되기 전에 안전 상한에 닿았다');
  assert.equal(runtime.stats.acquisitionPhase, 'idle', 'cursor 미완료를 bind 0으로 잘못 셌다');
  assert.ok(runtime.stats.acquisitionRebaseRejects > 0,
    `origin/current 재검증 분기가 실행되지 않았다: ${JSON.stringify(runtime.stats)}`);
  assert.equal(runtime.stats.binds, 0);
  assert.equal(runtime.stats.sessionPushes, 0, 'current identity 실패 전 origin 후보가 누적됐다');
});
