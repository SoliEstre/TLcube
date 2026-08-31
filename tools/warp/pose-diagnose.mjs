// 원근 0.75 에서 (a) 면별 호모그래피만 무너지는 이유 — 면별로 열어 본다.
// 비단조(0.5 ok · 0.75 붕괴 · 1.0 ok)라 「원근이 세서」로는 설명이 안 된다.
//
// 🔴 핵심 질문: 뷰어가 **안 그리는 면**을 내가 솔버에 먹이고 있었나?
//    뷰어에는 원근 보정이 붙은 면 컬링(`outwardFacing`)이 이미 있다. 컬링되는 면을
//    관측점으로 넣었다면 그 비교는 무효다 — 「라벨은 주장이다, 기하를 확인하라」.
import { cubePoint, orbitPoint, cubeCenter, projectPoint, perspectiveInvDist, buildOrbitMesh } from '../../src/y3d-viewer.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);

const N = 13;
const CENTER = cubeCenter(N);
const RADIUS3D = Math.sqrt(3) * (N / 2);
const D = Math.PI / 180;
const LAYOUT = { size: 17, originX: 320, originY: 240 };

function project(a, b, face, prm) {
  const p = cubePoint(face, a, b);
  const r = orbitPoint(p, prm.yaw, prm.pitch, CENTER, prm.roll);
  return projectPoint(r, { size: prm.size, originX: prm.originX, originY: prm.originY }, CENTER, prm.invDist, undefined);
}

// 부호 있는 넓이 — 부호가 뒤집히면 사각형이 «뒤집힌» 것이다 (뒷면이 됐거나 나비넥타이).
function signedArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    s += q[i].x * q[j].y - q[j].x * q[i].y;
  }
  return s / 2;
}

console.log('원근  면  부호넓이px²  최장변   찌그러짐   카메라를 마주 보나');
for (const p of [0, 0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0]) {
  const invDist = perspectiveInvDist(p, RADIUS3D);
  const prm = { yaw: 15 * D, pitch: 10 * D, roll: 0, invDist, ...LAYOUT };
  // 뷰어가 실제로 어느 면의 칸을 내놓는지 — 컬링 결과를 뷰어 자신에게 묻는다
  const mesh = buildOrbitMesh({
    n: N, layout: LAYOUT, levels: PRESET.levels, yaw: 15 * D, pitch: 10 * D, roll: 0,
    perspective: p, faces: 3, digitAt: () => 0, tones: 3,
  });
  // ⚠ buildOrbitMesh 는 **컬링하지 않는다** — 모든 quad 를 내놓고 `facing` 으로 표시만
  //    한다 (정렬용, 401행). `facing < 0` 이 「카메라를 마주 본다」. 3면 모드에는 덮을
  //    뒷면이 없으므로, 등 돌린 면도 **그대로 그려진다**.
  const faceFacing = new Map();
  for (const q of mesh.quads) {
    if (!q.face) continue;
    const cur = faceFacing.get(q.face);
    if (cur === undefined || q.facing < cur) faceFacing.set(q.face, q.facing);
  }
  for (const f of ['T', 'L', 'R']) {
    const q = [
      project(0, 0, f, prm), project(N, 0, f, prm),
      project(N, N, f, prm), project(0, N, f, prm),
    ];
    const area = signedArea(q);
    let maxEdge = 0;
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      maxEdge = Math.max(maxEdge, Math.hypot(q[j].x - q[i].x, q[j].y - q[i].y));
    }
    const shape = maxEdge > 0 ? area / (maxEdge * maxEdge) : 0;
    const fc = faceFacing.get(f);
    const vis = fc < 0 ? '보인다' : '⛔ 등돌림(그런데도 그려짐)';
    console.log(`${String(p).padEnd(5)} ${f}   ${area.toFixed(0).padStart(9)} ${maxEdge.toFixed(1).padStart(8)}   ${shape.toFixed(4).padStart(8)}   ${vis}`);
  }
}
