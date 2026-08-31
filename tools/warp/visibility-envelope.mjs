// 어느 자세까지 3면이 모두 카메라를 마주 보나 — 왜곡 사다리의 **유효 범위**.
// 이 밖에서는 「디코더가 못 읽는다」와 「그런 사진은 존재할 수 없다」가 구분되지 않는다.
import { cubePoint, orbitPoint, cubeCenter, projectPoint, perspectiveInvDist } from '../../src/y3d-viewer.js';
const N = 13;
const CENTER = cubeCenter(N);
const R3 = Math.sqrt(3) * (N / 2);
const D = Math.PI / 180;
const L = { size: 17, originX: 320, originY: 240 };
const project = (a, b, f, p) => projectPoint(
  orbitPoint(cubePoint(f, a, b), p.yaw, p.pitch, CENTER, p.roll), L, CENTER, p.invDist, undefined);
function visible(f, p) {
  const q = [project(0, 0, f, p), project(N, 0, f, p), project(N, N, f, p), project(0, N, f, p)];
  let s = 0;
  for (let i = 0; i < 4; i += 1) { const j = (i + 1) % 4; s += q[i].x * q[j].y - q[j].x * q[i].y; }
  return s < 0;
}
const count = (p) => ['T', 'L', 'R'].filter((f) => visible(f, p)).length;
function envelope(label, mk) {
  let lo = null;
  let hi = null;
  for (let d = -60; d <= 60; d += 1) {
    if (count(mk(d)) === 3) { if (lo === null) lo = d; hi = d; }
  }
  console.log(`${label.padEnd(28)} 3면 유지 구간: ${lo === null ? '없음' : `${lo}° ~ ${hi}°`}`);
}
for (const persp of [0, 0.25, 0.5]) {
  const e = perspectiveInvDist(persp, R3);
  console.log(`\n── 원근 ${persp} ──`);
  envelope('yaw (pitch=0,roll=0)', (d) => ({ yaw: d * D, pitch: 0, roll: 0, invDist: e }));
  envelope('pitch (yaw=0,roll=0)', (d) => ({ yaw: 0, pitch: d * D, roll: 0, invDist: e }));
  envelope('roll (yaw=0,pitch=0)', (d) => ({ yaw: 0, pitch: 0, roll: d * D, invDist: e }));
  envelope('yaw=pitch 동시', (d) => ({ yaw: d * D, pitch: d * D, roll: 0, invDist: e }));
}
console.log('\n── 원근 축 (yaw=15° pitch=10°) ──');
for (let p = 0; p <= 1.0001; p += 0.05) {
  const c = count({ yaw: 15 * D, pitch: 10 * D, roll: 0, invDist: perspectiveInvDist(p, R3) });
  if (c < 3) { console.log(`3면이 무너지는 첫 지점: 원근 ${p.toFixed(2)} (보이는 면 ${c})`); break; }
}
