// 뷰어의 (yaw, pitch) 파라미터 ↔ 「관측자가 실제로 어디에 서 있나」 의 대응.
//
// 왜 필요한가:
//   상정 시나리오는 «큐브를 손에 들고» 가 아니라 **고정 구조물을 특정 위치에서
//   본다** 이다 (① 1셀 1블록으로 크게 쌓고 멀리서 ② 블록 1개에 코드 텍스처).
//   그러면 질문이 「손각도 오차」가 아니라 **「그 자리가 뷰어 파라미터로 얼마인가」** 다.
//
// ⚠ 1차 시도에서 «위쪽 = −z» 로 놓았다가 정준 고도가 −35.264° 로 나왔다. 부호가
//   반대였고 역산 이분법도 방향이 뒤집혀 전 구간이 −80° 로 붕괴했다. 정준이
//   **+35.264°** 로 나오는지가 이 스크립트의 첫 게이트다 — 아니면 즉시 멈춘다.
import { orbitPoint, cubeCenter } from '../../src/y3d-viewer.js';

const N = 13;
const C = cubeCenter(N);
const DEG = 180 / Math.PI;
const SQ3 = Math.sqrt(3);
const CANON_ELEV = Math.atan(1 / Math.SQRT2) * DEG;   // 35.264°

// 회전 행렬을 orbitPoint 에서 **유도**한다 (수식 손 사본 금지).
function rotationCols(yaw, pitch, roll) {
  const col = (v) => {
    const q = orbitPoint({ x: C.x + v[0], y: C.y + v[1], z: C.z + v[2] }, yaw, pitch, C, roll);
    return [q.x - C.x, q.y - C.y, q.z - C.z];
  };
  return [col([1, 0, 0]), col([0, 1, 0]), col([0, 0, 1])];
}

// 물체를 R 로 돌리는 것 = 카메라를 Rᵀ 로 돌리는 것. 물체좌표계의 카메라 방향 = Rᵀ·n̂.
const NHAT = [1 / SQ3, 1 / SQ3, 1 / SQ3];
const cameraDir = (yaw, pitch, roll = 0) => rotationCols(yaw, pitch, roll)
  .map((c) => c[0] * NHAT[0] + c[1] * NHAT[1] + c[2] * NHAT[2]);

// 월드 위쪽 = +z (아래 게이트로 확인).
const elevation = (d) => Math.atan2(d[2], Math.hypot(d[0], d[1])) * DEG;
const azimuth = (d) => Math.atan2(d[1], d[0]) * DEG;

const canon = cameraDir(0, 0);
const e0 = elevation(canon);
console.log(`게이트 — 정준(yaw=pitch=0) 고도 ${e0.toFixed(3)}° · 방위 ${azimuth(canon).toFixed(3)}°`);
if (Math.abs(e0 - CANON_ELEV) > 1e-6) {
  console.log(`❌ ${CANON_ELEV.toFixed(3)}° 가 나와야 한다 — 좌표 전제가 틀렸다. 멈춘다.`);
  process.exit(1);
}
console.log('✓ «위쪽 = +z» 전제 확인. 정준은 몸대각선을 내려다보는 시선이다.\n');

function visibleFaces(yaw, pitch) {
  const R = rotationCols(yaw, pitch, 0);
  const corner = (face, a, b) => {
    const p = face === 'T' ? [a, b, 0] : face === 'R' ? [b, 0, a] : [0, a, b];
    const v = [p[0] - C.x, p[1] - C.y, p[2] - C.z];
    const w = [0, 1, 2].map((k) => R[0][k] * v[0] + R[1][k] * v[1] + R[2][k] * v[2]);
    return { x: (w[0] - w[1]) / Math.SQRT2, y: -((w[0] + w[1] - 2 * w[2]) / Math.sqrt(6)) };
  };
  const area = (face) => {
    const q = [corner(face, 0, 0), corner(face, N, 0), corner(face, N, N), corner(face, 0, N)];
    let s = 0;
    for (let i = 0; i < 4; i += 1) { const j = (i + 1) % 4; s += q[i].x * q[j].y - q[j].x * q[i].y; }
    return s;
  };
  const a = { T: area('T'), L: area('L'), R: area('R') };
  const ref = Math.sign(a.R);
  return Object.keys(a).filter((f) => Math.sign(a[f]) === ref);
}

console.log('── pitch 파라미터 ↔ 관측자 고도각 ──');
console.log('pitch    관측자 고도    보이는 면');
for (let pd = -60; pd <= 50; pd += 10) {
  const e = elevation(cameraDir(0, pd / DEG));
  const v = visibleFaces(0, pd / DEG);
  console.log(`${String(pd).padStart(4)}°   ${e.toFixed(1).padStart(8)}°     ${v.join('') || '없음'} (${v.length}면)`);
}
console.log('\n⇒ 관계는 1:1 이다: **관측자 고도 = 35.264° − pitch**.');
console.log('  현행 디코더가 사는 |pitch| ≤ 10° 는 곧 **관측자 고도 25.3° ~ 45.3°** 다.');
console.log('  3면이 보이는 pitch ∈ [−54°, +35°] 는 **고도 0.3° ~ 89.3°** 다 —');
console.log('  즉 큐브보다 **위에 있어야** 윗면이 보인다. 당연하지만 이게 제약의 핵심이다.\n');

// ── 시나리오: 관측자가 실제로 설 수 있는 자리의 고도 ──
const Rof = (s) => (Math.sqrt(3) / 2) * s;
const tOf = (s, d) => Math.asin(Math.min(Rof(s) / d, 1)) * DEG / 60;

function scenario(label, sideM, centerH, eyeH, dists) {
  console.log(`── ${label} · 한 변 ${sideM} m · 중심 높이 ${centerH} m · 눈높이 ${eyeH} m ──`);
  console.log('  수평거리   고도     pitch     원근 t    복호 가능?');
  for (const d of dists) {
    const elev = Math.atan2(eyeH - centerH, d) * DEG;
    const pitch = CANON_ELEV - elev;
    const slant = Math.hypot(d, eyeH - centerH);
    const t = tOf(sideM, slant);
    const okPitch = Math.abs(pitch) <= 10;
    const okT = t <= 0.1;                       // 현행 원근 한계
    const nvis = visibleFaces(0, pitch / DEG).length;
    const verdict = nvis < 3 ? `✗ ${nvis}면만 보임`
      : (okPitch && okT) ? '✓'
        : `✗ ${[okPitch ? null : `pitch ${pitch.toFixed(0)}°`, okT ? null : `원근 ${t.toFixed(2)}`].filter(Boolean).join(' · ')}`;
    console.log(`  ${String(d).padStart(7)} m ${elev.toFixed(1).padStart(7)}° ${pitch.toFixed(1).padStart(8)}° ${t.toFixed(3).padStart(8)}   ${verdict}`);
  }
  // 정준 고도에 서려면 얼마나 높아야 하나
  const need = (d) => centerH + d * Math.tan(CANON_ELEV / DEG);
  console.log(`  정준 고도(35.3°)에 서려면 — 수평 ${dists[0]} m 에서 눈높이 ${need(dists[0]).toFixed(1)} m,`
    + ` ${dists[dists.length - 1]} m 에서 ${need(dists[dists.length - 1]).toFixed(1)} m\n`);
}

// (A) 1셀 1블록: 13×13×13 블록이 땅에 놓임 → 중심 높이 6.5 m. 플레이어 눈높이 1.62 m.
scenario('시나리오 A · 1셀 1블록 (땅에 쌓고 서서 봄)', N, N / 2, 1.62, [20, 30, 40, 60, 110]);
// (A′) 같은 큐브를 **날아서** 정준 고도에서 봄
console.log('── 시나리오 A′ · 같은 큐브를 정준 고도(35.3°)에서 봄 (크리에이티브 비행) ──');
console.log('  경사거리   원근 t   복호 가능? (pitch 0 이므로 원근만 본다)');
for (const d of [30, 40, 60, 80, 110, 140]) {
  const t = tOf(N, d);
  console.log(`  ${String(d).padStart(7)} m ${t.toFixed(3).padStart(8)}   ${t <= 0.1 ? '✓' : `✗ 원근 ${t.toFixed(2)} > 0.1`}`);
}
console.log('');
// (B) 블록 1개에 코드 텍스처: 한 변 1 m. 땅에 놓이면 중심 높이 0.5 m.
scenario('시나리오 B · 블록 1개 (땅에 놓임)', 1, 0.5, 1.62, [1, 1.5, 2, 3, 5, 8]);
scenario('시나리오 B′ · 블록 1개 (눈높이에 설치)', 1, 1.5, 1.62, [1, 1.5, 2, 3, 5]);
