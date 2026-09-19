import assert from 'node:assert/strict';
import test from 'node:test';
import { xSiteId } from '../src/x-layout.js';
import {
  X_CAMERA_MODEL, xRotation, mat3Mul, mat3Apply, assertXCamera, xCameraLookAt, xProjectSites, xOverlapMask,
} from '../src/x-project.js';

const CAM = { model: X_CAMERA_MODEL, width: 640, height: 480, fx: 600, fy: 600, cx: 320, cy: 240 };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

function isRotation(R) {
  const Rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
  const I = mat3Mul(R, Rt);
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const orthonormal = I.every((v, i) => near(v, identity[i], 1e-9));
  const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
  return orthonormal && near(det, 1, 1e-9);
}

test('xRotation — 직교·det+1, 항등, 축 회전 방향', () => {
  assert.ok(isRotation(xRotation({})));
  assert.deepEqual(xRotation({}), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  for (const e of [{ yaw: 0.3 }, { pitch: -1.1 }, { roll: 2 }, { yaw: 0.7, pitch: 0.2, roll: -0.4 }]) assert.ok(isRotation(xRotation(e)), JSON.stringify(e));
  // yaw +90° (y 축 둘레): +z → +x
  const p = mat3Apply(xRotation({ yaw: Math.PI / 2 }), [0, 0, 1]);
  assert.ok(near(p[0], 1) && near(p[1], 0) && near(p[2], 0));
});

test('assertXCamera — 모델·유한수·양수 검사', () => {
  assert.equal(assertXCamera(CAM), CAM);
  assert.throws(() => assertXCamera({ ...CAM, model: 'fisheye' }), RangeError);
  assert.throws(() => assertXCamera({ ...CAM, fx: NaN }), RangeError);
  assert.throws(() => assertXCamera({ ...CAM, fy: 0 }), RangeError);
  assert.throws(() => assertXCamera(null), RangeError);
});

test('xCameraLookAt — 정면(az0, el0): +x 는 오른쪽, +y 는 위, 가까운 z 는 바깥으로', () => {
  const N = 8;
  const pose = xCameraLookAt({ N, pitch: 1, distanceOverWidth: 3, azimuth: 0, elevation: 0 });
  assert.ok(isRotation(pose.R));
  assert.equal(pose.width, 7);
  assert.equal(pose.distance, 21);
  // 카메라 중심(0,0,21) 이 카메라 좌표 원점 → R·c + t = 0
  const c = mat3Apply(pose.R, [0, 0, 21]);
  assert.ok(near(c[0] + pose.t[0], 0) && near(c[1] + pose.t[1], 0) && near(c[2] + pose.t[2], 0));
  const { points, pitchPx } = xProjectSites({ N, pitch: 1, pose, camera: CAM });
  assert.equal(points.length, 512);
  assert.ok(points.every(p => p.inFront));
  assert.ok(near(pitchPx, 600 / 21, 1e-9)); // 중심 깊이 = 거리
  const at = (x, y, z) => points[xSiteId(N, [x, y, z])];
  assert.ok(at(7, 3, 3).u > at(0, 3, 3).u, '+x → u 증가');
  assert.ok(at(3, 7, 3).v < at(3, 0, 3).v, '+y → v 감소(화면 위)');
  // 큐브 중심(3.5,3.5,3.5) 은 주점에 — «같은 깊이» 의 대칭 두 점 평균이 (cx, cy). (깊이가 다르면 원근 때문에 평균이 주점이 아니에요 —
  // (0,0,0) 과 (7,7,7) 은 Z 가 24.5 vs 17.5 라 대칭이 아니에요.)
  assert.ok(near((at(0, 0, 3).u + at(7, 7, 3).u) / 2, CAM.cx, 1e-6));
  assert.ok(near((at(0, 0, 3).v + at(7, 7, 3).v) / 2, CAM.cy, 1e-6));
  assert.ok(!near((at(0, 0, 0).u + at(7, 7, 7).u) / 2, CAM.cx, 1e-3), '다른 깊이의 대칭점 평균은 주점이 아니에요(원근)');
  // z 가 클수록(카메라에 가까움) 같은 (x,y) 가 주점에서 더 멀리
  assert.ok(Math.abs(at(7, 3, 7).u - CAM.cx) > Math.abs(at(7, 3, 0).u - CAM.cx));
  // 정면에서는 z 열 8 점이 한 직선에 정렬 — 가까운 순으로 깊이 단조
  for (let z = 1; z < N; z += 1) assert.ok(at(3, 3, z).z < at(3, 3, z - 1).z);
});

test('xCameraLookAt — 고도·방위·롤이 직교 회전을 유지하고 롤은 화면만 돌려요', () => {
  const N = 10;
  for (const [az, el] of [[0.4, 0.2], [-1.2, 0.9], [2.5, -0.3], [0, 1.5], [0, -1.5], [3.1, 0]]) {
    const pose = xCameraLookAt({ N, azimuth: az, elevation: el });
    assert.ok(isRotation(pose.R), `az ${az} el ${el}`);
    const { points } = xProjectSites({ N, pose, camera: CAM });
    assert.ok(points.every(p => p.inFront && p.inFrame), `az ${az} el ${el} 전부 화면 안(D/L=3)`);
  }
  const a = xProjectSites({ N, pose: xCameraLookAt({ N, azimuth: 0.5, elevation: 0.3 }), camera: CAM }).points;
  const b = xProjectSites({ N, pose: xCameraLookAt({ N, azimuth: 0.5, elevation: 0.3, roll: Math.PI / 2 }), camera: CAM }).points;
  // 롤 +90°(fx=fy): 주점 기준 (du, dv) ↦ (−dv, du) — 성분별 단언(codex REPORT_003 P2), 깊이 불변
  for (let i = 0; i < a.length; i += 37) {
    const du = a[i].u - CAM.cx, dv = a[i].v - CAM.cy;
    assert.ok(near(b[i].u - CAM.cx, -dv, 1e-6), `롤 u 성분 site ${i}`);
    assert.ok(near(b[i].v - CAM.cy, du, 1e-6), `롤 v 성분 site ${i}`);
    assert.ok(near(a[i].z, b[i].z, 1e-9));
  }
});

test('xCameraLookAt — 고도 sweep 에서 basis 가 연속(옛 up 전환 임계 ±asin .99 양쪽 내적 ≈ 1), 극점도 유한 회전', () => {
  const N = 8;
  const rowsDot = (Ra, Rb) => [0, 1, 2].map(r => Ra[r * 3] * Rb[r * 3] + Ra[r * 3 + 1] * Rb[r * 3 + 1] + Ra[r * 3 + 2] * Rb[r * 3 + 2]);
  for (const az of [0, 0.7, 2.4]) {
    const lo = xCameraLookAt({ N, azimuth: az, elevation: Math.asin(0.989) }).R;
    const hi = xCameraLookAt({ N, azimuth: az, elevation: Math.asin(0.991) }).R;
    for (const d of rowsDot(lo, hi)) assert.ok(d > 0.999, `az ${az} 임계 양쪽 basis 내적 ${d}`);
    // 잘게 나눈 고도 궤적 전체에서 인접 basis 내적 > .999
    let prev = null;
    for (let el = -Math.PI / 2; el <= Math.PI / 2 + 1e-12; el += Math.PI / 180) {
      const R = xCameraLookAt({ N, azimuth: az, elevation: el }).R;
      assert.ok(isRotation(R));
      if (prev) for (const d of rowsDot(prev, R)) assert.ok(d > 0.999, `az ${az} el ${el} 불연속`);
      prev = R;
    }
  }
  // 오른쪽 축은 방위각만의 함수 — 정면에서 +x
  assert.deepEqual(xCameraLookAt({ N }).R.slice(0, 3), [1, 0, -0]);
});

test('xCameraLookAt/xProjectSites — 비유한·비정수 입력 거절(NaN 투영으로 숨지 않게)', () => {
  const N = 8;
  assert.throws(() => xCameraLookAt({ N: 8.5 }), RangeError);
  assert.throws(() => xCameraLookAt({ N: 1 }), RangeError);
  assert.throws(() => xCameraLookAt({ N, pitch: 0 }), RangeError);
  assert.throws(() => xCameraLookAt({ N, azimuth: NaN }), RangeError);
  const ok = xCameraLookAt({ N });
  assert.throws(() => xProjectSites({ N, pose: { R: ok.R.map((v, i) => (i === 4 ? NaN : v)), t: ok.t }, camera: CAM }), RangeError);
  assert.throws(() => xProjectSites({ N, pose: { R: ok.R, t: [0, Infinity, 5] }, camera: CAM }), RangeError);
  assert.throws(() => xProjectSites({ N: 7.5, pose: ok, camera: CAM }), RangeError);
  assert.throws(() => xProjectSites({ N, pitch: -1, pose: ok, camera: CAM }), RangeError);
  assert.throws(() => xProjectSites({ N, pose: ok, camera: { ...CAM, width: 640.5 } }), RangeError);
  // codex REPORT_004: pitch Infinity · 희소 R(new Array(9)) 은 every 를 통과하던 구멍
  assert.throws(() => xCameraLookAt({ N, pitch: Infinity }), RangeError);
  assert.throws(() => xCameraLookAt({ N, distanceOverWidth: Infinity }), RangeError);
  assert.throws(() => xProjectSites({ N, pitch: Infinity, pose: ok, camera: CAM }), RangeError);
  assert.throws(() => xProjectSites({ N, pose: { R: new Array(9), t: [0, 0, 5] }, camera: CAM }), RangeError);
  const sparse = ok.R.slice(); delete sparse[4];
  assert.throws(() => xProjectSites({ N, pose: { R: sparse, t: ok.t }, camera: CAM }), RangeError);
  assert.throws(() => xProjectSites({ N, pose: { R: ok.R, t: new Array(3) }, camera: CAM }), RangeError);
});

test('xProjectSites — 뒤에 있는 점은 inFront=false, 프레임 밖은 inFrame=false, pose 형식 검사', () => {
  const N = 4;
  const behind = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, -10] };
  const { points } = xProjectSites({ N, pose: behind, camera: CAM });
  assert.ok(points.every(p => !p.inFront && Number.isNaN(p.u)));
  const tooClose = xCameraLookAt({ N, distanceOverWidth: 0.6 });
  const close = xProjectSites({ N, pose: tooClose, camera: CAM }).points;
  assert.ok(close.some(p => p.inFront && !p.inFrame));
  assert.throws(() => xProjectSites({ N, pose: { R: [1], t: [0, 0, 1] }, camera: CAM }), TypeError);
  assert.throws(() => xProjectSites({ N, pose: tooClose, camera: { ...CAM, model: 'x' } }), RangeError);
});

test('xOverlapMask — 정면 시선은 z 열 전체가 겹치고, 비스듬하면 겹침이 줄어요(양쪽 소거)', () => {
  const N = 8;
  const lit = new Uint8Array(N ** 3).fill(1);
  const front = xProjectSites({ N, pose: xCameraLookAt({ N }), camera: CAM });
  const sep = front.pitchPx * 0.5;
  const overlapFront = xOverlapMask(front.points, lit, sep);
  // 정면: 같은 (x,y) 열의 8 점은 원근으로만 벌어져 sep 보다 가까움 → 전부 overlap
  assert.equal([...overlapFront].filter(Boolean).length, 512);
  const oblique = xProjectSites({ N, pose: xCameraLookAt({ N, azimuth: 0.6, elevation: 0.45 }), camera: CAM });
  const overlapObl = xOverlapMask(oblique.points, lit, sep);
  const nObl = [...overlapObl].filter(Boolean).length;
  assert.ok(nObl < 512, `비스듬한 시선 겹침 ${nObl}`);
  // 점등 안 된 사이트는 겹침 판정에 안 들어가요
  const onlyOne = new Uint8Array(N ** 3); onlyOne[0] = 1;
  assert.equal([...xOverlapMask(front.points, onlyOne, sep)].filter(Boolean).length, 0);
  // 두 점만 켜고 거리로 판정: 둘 다 표시, 세 번째 먼 점은 아님
  const two = new Uint8Array(N ** 3); two[xSiteId(N, [3, 3, 0])] = 1; two[xSiteId(N, [3, 3, 7])] = 1; two[xSiteId(N, [0, 0, 0])] = 1;
  const m = xOverlapMask(front.points, two, sep);
  assert.equal(m[xSiteId(N, [3, 3, 0])], 1); assert.equal(m[xSiteId(N, [3, 3, 7])], 1); assert.equal(m[xSiteId(N, [0, 0, 0])], 0);
  assert.equal([...xOverlapMask(front.points, lit, 0)].filter(Boolean).length, 0);
});
