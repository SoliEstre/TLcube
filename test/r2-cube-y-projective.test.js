import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enumerateCubeFaceGeometry,
  iterateCubeProjectiveFaceGeometry,
} from '../src/decoder/cube-face-geometry.js';
import { iterateCubeProjectiveFaceGeometry as adapterProjective } from '../src/r2/adapter-cube-y.js';
import { observeCubeYCandidates } from '../src/r2/cube-y-acquisition.js';
import { createCubeYCandidateRuntime } from '../src/r2/cube-y-runtime.js';
import { cubeCenter, orbitPoint, perspectiveInvDist, projectPoint } from '../src/y3d-viewer.js';
import { PROJECTIVE_TEXT, renderProjectiveCubeY } from './helpers/r2-cube-y-projective-fixture.js';

const OBSERVED_SIX = [
  { x: 258.15788145424267, y: 929.4111419129426 },
  { x: 223.3452857972168, y: 595.9698970957319 },
  { x: 529.6898636203766, y: 448.65012179851294 },
  { x: 839.2856297883197, y: 591.6683790688137 },
  { x: 805.7189356224283, y: 930.0185180291508 },
  { x: 533.1478343862708, y: 1116.3189233745675 },
];
const D6_IDS = [
  'forward-r0', 'forward-r1', 'forward-r2', 'forward-r3', 'forward-r4', 'forward-r5',
  'reverse-r0', 'reverse-r1', 'reverse-r2', 'reverse-r3', 'reverse-r4', 'reverse-r5',
];

function projectiveList(vertices) {
  return Array.from(iterateCubeProjectiveFaceGeometry(vertices));
}
function projectH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}
function canonicalXY(face, a, b) {
  const eiX = [Math.sqrt(3) / 2, -Math.sqrt(3) / 2, 0];
  const eiY = [-0.5, -0.5, 1];
  const ejX = [-Math.sqrt(3) / 2, 0, Math.sqrt(3) / 2];
  const ejY = [-0.5, 1, -0.5];
  return { x: a * eiX[face] + b * ejX[face], y: a * eiY[face] + b * ejY[face] };
}
const FACE_QUAD = [
  [['near', 0, 0], [1, 1, 0], [0, 1, 1], [5, 0, 1]],
  [['near', 0, 0], [5, 1, 0], [4, 1, 1], [3, 0, 1]],
  [['near', 0, 0], [3, 1, 0], [2, 1, 1], [1, 0, 1]],
];

test('기존 D6×2 24계약과 새 사영 12의 상한·소유권을 유지해요', () => {
  const legacy = enumerateCubeFaceGeometry(OBSERVED_SIX);
  assert.equal(legacy.length, 24);
  assert.equal(legacy.filter((row) => row.ok).length, 24);
  assert.deepEqual(legacy.filter((_, index) => index % 2 === 0).map((row) => row.direction.id), D6_IDS);
  for (let direction = 0; direction < 12; direction += 1) {
    const [pose, near] = legacy.slice(direction * 2, direction * 2 + 2);
    assert.equal(pose.method, 'pose-faceH');
    assert.equal(near.method, 'sil3-nearpoint');
    assert.equal(pose.direction.id, near.direction.id);
  }

  const input = OBSERVED_SIX.map((point) => ({ ...point }));
  const projective = projectiveList(input);
  assert.equal(adapterProjective, iterateCubeProjectiveFaceGeometry);
  assert.equal(Array.from(adapterProjective(input)).length, 12);
  assert.equal(projective.length, 12);
  assert.deepEqual(projective.map((row) => row.direction.id), D6_IDS);
  assert.ok(projective.every((row) => row.method === 'sil3-projective'));
  assert.ok(projective.every((row) => row.unitPoseResidual === null));
  const ok = projective.filter((row) => row.ok);
  assert.ok(ok.length >= 1);
  for (const row of ok) {
    assert.equal(row.faceHs.length, 3);
    assert.ok(row.faceHs.every((H) => H instanceof Float64Array && H.length === 9));
    assert.ok(Number.isFinite(row.projective.residual));
    assert.ok(Number.isFinite(row.projective.near.x));
  }

  const snapshot = OBSERVED_SIX.map((point) => ({ ...point }));
  ok[0].faceHs[0][0] = -123;
  ok[0].direction.vertices[0].x = -456;
  ok[0].projective.near.x = -789;
  input[0].x = -1;
  assert.deepEqual(OBSERVED_SIX, snapshot);
  const again = projectiveList(OBSERVED_SIX);
  const fresh = again.find((row) => row.ok);
  assert.ok(fresh);
  assert.notEqual(fresh.faceHs[0][0], -123);
  assert.notEqual(fresh.direction.vertices[0].x, -456);
  assert.notEqual(fresh.projective.near.x, -789);
});

test('유한·퇴화 입력은 TypeError 또는 12개 fail-closed이고 평행 소실점을 허용해요', () => {
  assert.throws(() => projectiveList([{ x: 0, y: 0 }]), TypeError);
  const collapsed = projectiveList(Array.from({ length: 6 }, () => ({ x: 1, y: 1 })));
  assert.equal(collapsed.length, 12);
  assert.ok(collapsed.every((row) => row.ok === false && row.faceHs === null));
  const hex = Array.from({ length: 6 }, (_, index) => {
    const angle = index * Math.PI / 3;
    return { x: 200 + 80 * Math.cos(angle), y: 180 + 80 * Math.sin(angle) };
  });
  const parallel = projectiveList(hex);
  assert.equal(parallel.length, 12);
  const hit = parallel.find((row) => row.ok);
  assert.ok(hit, '정육각형(무한 소실점) 사영 near가 없어요');
  assert.ok(Math.hypot(hit.projective.near.x - 200, hit.projective.near.y - 180) < 1e-6);
});

test('독립 사영한 정확 6점에서 near와 면 H 투영이 맞아요', () => {
  const layout = { size: 1, originX: 0, originY: 0 };
  const center = cubeCenter(1);
  const params = {
    yaw: 0.12, pitch: -0.08, roll: 0,
    invDist: perspectiveInvDist(2 / 60, 0.5 * Math.sqrt(3)),
    ppu: 90, offX: 220, offY: 190,
  };
  const corners3d = [
    { x: 1, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: 0 },
  ];
  const sil6 = corners3d.map((point) => {
    const rotated = orbitPoint(point, params.yaw, params.pitch, center, params.roll);
    const projected = projectPoint(rotated, layout, center, params.invDist);
    return { x: params.offX + projected.x * params.ppu, y: params.offY + projected.y * params.ppu };
  });
  const origin = orbitPoint({ x: 0, y: 0, z: 0 }, params.yaw, params.pitch, center, params.roll);
  const originP = projectPoint(origin, layout, center, params.invDist);
  const truthNear = { x: params.offX + originP.x * params.ppu, y: params.offY + originP.y * params.ppu };
  const rows = projectiveList(sil6).filter((row) => row.ok);
  assert.ok(rows.length >= 1);
  const matched = rows.find((row) => Math.hypot(row.projective.near.x - truthNear.x, row.projective.near.y - truthNear.y) < 1e-4);
  assert.ok(matched, '정답 사영 near를 복원하지 못했어요');
  const sil = matched.direction.vertices;
  for (let face = 0; face < 3; face += 1) {
    for (const [corner, a, b] of FACE_QUAD[face]) {
      const source = canonicalXY(face, a, b);
      const projected = projectH(matched.faceHs[face], source.x, source.y);
      const expected = corner === 'near' ? matched.projective.near : sil[corner];
      assert.ok(
        Math.hypot(projected.x - expected.x, projected.y - expected.y) < 1e-3,
        `face ${face} corner ${corner} H 투영이 어긋나요`,
      );
    }
  }
});

function decodeHintless(field) {
  const runtime = createCubeYCandidateRuntime();
  let hit = null;
  for (let frame = 0; frame < 12 && !hit; frame += 1) {
    hit = runtime.pushFrame(field, frame * 100, {
      frameId: frame, runDetect: frame === 0, maxCandidates: 8, budgetMs: Infinity,
    });
  }
  return hit;
}

test('카메라 yaw35/50 × pitch0/20 원근2 네 조건은 힌트 없이 actual RS 원문을 읽어요', () => {
  const cameras = [
    { cameraYaw: 35, cameraPitch: 0 },
    { cameraYaw: 35, cameraPitch: 20 },
    { cameraYaw: 50, cameraPitch: 0 },
    { cameraYaw: 50, cameraPitch: 20 },
  ];
  for (const camera of cameras) {
    const rendered = renderProjectiveCubeY({ yaw: 10, pitch: 0, perspective: 2, ppu: 17, ...camera });
    const hit = decodeHintless(rendered.field);
    assert.ok(hit, `camera${camera.cameraYaw}-${camera.cameraPitch} DONE이 없어요`);
    assert.equal(hit.text, PROJECTIVE_TEXT);
    assert.equal(hit.actualRS.used, true);
  }
});

test('blank/상수 필드는 오수용 0이고 기존 정지 대조는 살아 있어요', () => {
  const still = renderProjectiveCubeY({ pitch: -20, perspective: 9 });
  const blank = {
    width: still.field.width,
    height: still.field.height,
    data: new Float32Array(still.field.width * still.field.height).fill(0.5),
  };
  assert.equal(decodeHintless(blank), null);
  const found = observeCubeYCandidates(still.field, { maxCandidates: 8 });
  assert.ok(found.candidates.length > 0, '정지 획득 descriptor가 없어요');
  assert.ok(found.candidates.every((row) => row.geometryOrdinal < 24));
  assert.ok(found.candidates.every((row) => row.geometryMethod !== 'sil3-projective'));
  const hit = decodeHintless(still.field);
  assert.ok(hit, '정지 대조가 죽었어요');
  assert.equal(hit.text, PROJECTIVE_TEXT);
  assert.equal(hit.actualRS.used, true);
});
