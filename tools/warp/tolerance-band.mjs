// pitch 허용치를 넓히면 «설 수 있는 자리» 가 얼마나 넓어지나.
// 시나리오 B (땅에 놓인 1 m 블록, 서 있는 관측자) 가 pitch·원근에 동시에 걸리는
// 유일한 케이스라 여기서 재는 게 의미가 있다.
const DEG = 180 / Math.PI;
const CANON = Math.atan(1 / Math.SQRT2) * DEG;
const SIDE = 1;           // 블록 한 변 (m)
const CENTER_H = SIDE / 2;
const EYE_H = 1.62;
const DY = EYE_H - CENTER_H;
const R = (Math.sqrt(3) / 2) * SIDE;
const tAt = (d) => Math.asin(Math.min(R / Math.hypot(d, DY), 1)) * DEG / 60;
// |pitch| ≤ P  ⇔  고도 ∈ [CANON−P, CANON+P]  ⇔  d = DY / tan(고도)
const bandFor = (P) => [DY / Math.tan((CANON + P) / DEG), DY / Math.tan((CANON - P) / DEG)];

console.log(`시나리오 B — 땅에 놓인 ${SIDE} m 블록 · 눈높이 ${EYE_H} m · 높이차 ${DY} m`);
console.log('pitch 허용   설 수 있는 수평거리      그 구간의 원근 t      필요한 원근 상한');
for (const P of [5, 10, 15, 20, 25, 30]) {
  const [near, far] = bandFor(P);
  const tNear = tAt(near);
  const tFar = tAt(far);
  const need = Math.max(tNear, tFar);
  const width = far - near;
  const mark = need <= 0.5 ? '✓ 0.5 상한 안' : `✗ ${need.toFixed(2)} 필요`;
  console.log(`  ±${String(P).padStart(2)}°     ${near.toFixed(2)} ~ ${far.toFixed(2)} m (폭 ${width.toFixed(2)} m)`
    + `   ${tFar.toFixed(2)} ~ ${tNear.toFixed(2)}      ${mark}`);
}
console.log('\n(가까울수록 원근이 커지므로 «가장 가까운 자리» 가 원근 상한을 정한다.)');

console.log('\n── 시나리오 A′ — 13 m 큐브를 정준 고도에서 (pitch 0, 원근만 문제) ──');
const RA = (Math.sqrt(3) / 2) * 13;
console.log('원근 상한   설 수 있는 최소 경사거리   그때 화면차지각');
for (const cap of [0.1, 0.2, 0.3, 0.4, 0.5]) {
  const d = RA / Math.sin((cap * 60) / DEG);
  console.log(`  ${cap.toFixed(1)}        ${d.toFixed(1).padStart(6)} m               ${(cap * 120).toFixed(0)}°`);
}
