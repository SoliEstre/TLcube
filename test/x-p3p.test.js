import assert from 'node:assert/strict';
import test from 'node:test';
import { xSiteCoord } from '../src/x-layout.js';
import { X_CAMERA_MODEL, xCameraLookAt, xProjectSites, xRotation, mat3Mul, mat3Apply } from '../src/x-project.js';
import {
  xP3P, xBearingsFromPixels, xPoseLM, xRotationAngleDeg, xIsRotation, xExpSO3, xOrthonormalizeRotation, xPolyRealRoots,
} from '../src/x-p3p.js';

// 합성 조건(stage2-context «합성 조건»): 320×240, fov 40° → fx = 160/tan(20°) ≈ 439.7
const CAM = { model: X_CAMERA_MODEL, width: 320, height: 240, fx: 160 / Math.tan(Math.PI / 9), fy: 160 / Math.tan(Math.PI / 9), cx: 160, cy: 120 };
const N = 8, HALF = (N - 1) / 2;

/** 고정 seed 의 mulberry32 — 테스트 결정성 */
function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussOf = rnd => () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

/** 세계 좌표 P = pitch·(s − (N−1)/2), pitch 1 */
const worldOf = id => xSiteCoord(N, id).map(s => s - HALF);
const randomPose = rnd => xCameraLookAt({
  N, distanceOverWidth: 2 + 2 * rnd(), azimuth: (rnd() * 2 - 1) * Math.PI, elevation: (rnd() * 2 - 1) * 1.4, roll: (rnd() * 2 - 1) * Math.PI,
});
const collinear = (P, eps = 1e-9) => {
  const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
  const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return Math.hypot(...c) < eps;
};
/** 비공선 3 사이트를 고정 seed 로 골라요 */
function pick3(rnd) {
  for (;;) {
    const ids = [0, 0, 0].map(() => Math.floor(rnd() * N ** 3));
    if (new Set(ids).size < 3) continue;
    const P = ids.map(worldOf);
    if (!collinear(P)) return { ids, P };
  }
}
const pixelsOf = (points, ids) => ids.map(id => [points[id].u, points[id].v]);
const reprojectPx = (R, t, P) => {
  const c = mat3Apply(R, P);
  const X = c[0] + t[0], Y = c[1] + t[1], Z = c[2] + t[2];
  return [CAM.fx * X / Z + CAM.cx, CAM.fy * Y / Z + CAM.cy, Z];
};
const maxAbsDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/**
 * ★ 관측 수치의 **단일 정본**. src/x-p3p.js 파일 머리는 표를 옮겨 적지 않고 이 상수를 가리켜요
 * (옛 머리 표는 실측과 2.8× 어긋나 있었어요 — 「사본 목록은 썩는다」).
 * 전부 **이 파일의 자들이 매번 재측정해서 단언하는 값**이에요. 지어낸 수치 없음(2026-09-20 수정본 실측).
 */
const OBSERVED = {
  // 잡음 사다리 · 무작위 삼중(seed 777, 200 케이스/σ) — 해없음 / 중앙 deg / p90 deg
  randomTriples: {
    0: { noSol: 0, med: 3.901e-13, p90: 4.766e-12 },
    0.05: { noSol: 0, med: 1.232e-1, p90: 4.897e-1 },
    0.2: { noSol: 0, med: 4.888e-1, p90: 2.027e+0 },
    0.5: { noSol: 0, med: 1.212e+0, p90: 5.275e+0 },
  },
  // 잡음 사다리 · 저 면적비 「격자 최악」 삼중(seed 3342109001, 600 케이스/σ, requireInFrame=false)
  worstTriples: {
    0: { noSol: 0, med: 1.272e-10, p90: 1.104e-9 },
    0.05: { noSol: 34, med: 1.431e+0, p90: 5.550e+0 },
    0.2: { noSol: 78, med: 5.179e+0, p90: 1.693e+1 },
    0.5: { noSol: 117, med: 1.210e+1, p90: 3.350e+1 },
  },
  // 2 팔 회복 실험 — 같은 코퍼스를 {기본} vs {imagTol 1e-1, residualTol 1e-5} 로 (해없음 건수)
  twoArmNoSol: { 0.05: [34, 1], 0.2: [78, 38], 0.5: [117, 86] },
  // σ=0 대형 코퍼스(seed 4242, 무작위 pose × 무작위 격자 삼중) — 수정 전/후
  // ⚠ 아래 두 항목(sigma0Tail · msPerCall)은 **이 파일의 자가 재측정하지 않는 기록**이에요 — 59906 코퍼스와
  //    타이밍은 테스트에서 돌리기엔 비싸서 외부 스크립트(p3p-verify/probe-p · probe-o)로 잽니다. 「자가 지키는
  //    값」이 아니라 「그때 잰 값」이라는 뜻이라, 인용할 땐 날짜·스크립트를 같이 적으세요.
  sigma0Tail: {
    cases: 59906,
    before: { worstRotDeg: 2.796e+1, violations1e7: 2 },
    after: { worstRotDeg: 3.901e-4, violations1e7: 1, medRotDeg: 3.641e-13, p999RotDeg: 6.880e-10 },
  },
  // 비용은 **같은 스크립트를 수정 전/후 2 회**(probe-o, 4000-삼중 × 10 = 40000 호출). 코퍼스가 다른 자의 값과
  // 섞어서 배수를 만들면 안 돼요 — 59906 코퍼스에서는 수정 후 1.474e-2 ms/호출이에요.
  msPerCall: { before: 2.387e-1, after: 1.881e-2, corpus: 'probe-o 4000×10' },
  // selfConsistency 는 잡음을 안 재요 — σ 별 최대(rad). 같은 코퍼스 회전오차는 최대 ~1.8e+2 deg.
  selfConsistencyMaxRad: { 0: 1.688e-14, 0.5: 2.193e-14, 1.4: 4.926e-14, 5: 3.167e-14 },
};

test('xPolyRealRoots — 알려진 4차식의 실근 4·2·0 개, 차수 강등, 비유한 거절', () => {
  // (v−1)(v−2)(v+3)(v−0.5) = (v²−3v+2)(v²+2.5v−1.5) = v⁴ − 0.5v³ − 7v² + 9.5v − 3  (낮은 차수부터)
  const r4 = xPolyRealRoots([-3, 9.5, -7, -0.5, 1]);
  assert.equal(r4.degree, 4);
  assert.deepEqual(r4.roots.map(v => Math.round(v * 1e12) / 1e12), [-3, 0.5, 1, 2]);
  for (const v of r4.roots) assert.ok(Math.abs((v - 1) * (v - 2) * (v + 3) * (v - 0.5)) < 1e-12);
  assert.equal(r4.converged, true);
  assert.ok(r4.maxRootResidual < 1e-12, `maxRootResidual ${r4.maxRootResidual}`);
  // (v²+1)(v−2)(v+1) = v⁴ − v³ − v² − v − 2 → 실근 2 개, 복소 2 개 제외
  const r2 = xPolyRealRoots([-2, -1, -1, -1, 1]);
  assert.deepEqual(r2.roots.map(v => Math.round(v * 1e12) / 1e12), [-1, 2]);
  assert.equal(r2.droppedComplex, 2);
  assert.ok(r2.droppedComplexImag > 0.9, `버린 최대 |Im| ${r2.droppedComplexImag}`);
  // (v²+1)(v²+4) → 실근 0
  assert.deepEqual(xPolyRealRoots([4, 0, 5, 0, 1]).roots, []);
  // 선행 계수 0 → 3차로 강등
  const r3 = xPolyRealRoots([-6, 11, -6, 1, 0]);
  assert.equal(r3.degree, 3);
  assert.deepEqual(r3.roots.map(v => Math.round(v * 1e12) / 1e12), [1, 2, 3]);
  assert.equal(xPolyRealRoots([1, NaN, 1]).degree, -1);
  assert.equal(xPolyRealRoots([1, NaN, 1]).converged, false);
});

/**
 * ★ 결함 ② 의 자 — DK 종료·수렴 판정. 옛 구현은 종료 문턱이 「상대 스텝 < 1e-16」이라 호출의 98.33 % 가 500 회를
 * 끝까지 돌았고(probe-o, 4000 시행) `converged` 는 98.43 % 오탐이었어요. 이제 converged 는 **잔차**로 정의돼요.
 * 여기서 재는 건 값이 아니라 성질이에요: ① 잘 풀리는 입력에서 converged 가 참이고 ② 반복 수가 문턱에 눌려
 * 낭비되지 않으며 ③ 미수렴은 xP3P 에서 **명시 거절**로 올라와요.
 */
test('★ xPolyRealRoots — 수렴 판정은 스텝이 아니라 잔차로, 반복은 조기 종료(결함 ② 의 자)', () => {
  const rnd = mulberry32(4242);
  let n = 0, notConverged = 0, sumIt = 0, maxIt = 0, ranToCap = 0;
  const reasons = new Map();
  for (let k = 0; k < 2000; k += 1) {
    const pose = randomPose(rnd);
    const ids = new Set(); while (ids.size < 3) ids.add(Math.floor(rnd() * N ** 3));
    const P = [...ids].map(worldOf);
    const px = P.map(p => reprojectPx(pose.R, pose.t, p));
    if (!px.every(q => q[2] > 0)) continue;
    const sols = xP3P({ points: P, bearings: xBearingsFromPixels(px.map(q => [q[0], q[1]]), CAM) });
    const d = sols.diagnostics;
    reasons.set(d.reason, (reasons.get(d.reason) || 0) + 1);
    // 퇴화 거절은 근 solver 에 닿기도 전에 끝나요(rootSolverConverged = null) — 이 자의 코퍼스가 아니에요
    if (d.quarticDegree < 0) { assert.equal(d.rootSolverConverged, null, `근 solver 전 거절인데 ${d.rootSolverConverged}`); continue; }
    n += 1;
    assert.equal(typeof d.rootSolverConverged, 'boolean', 'rootSolverConverged 가 diagnostics 에 실려야 해요');
    if (!d.rootSolverConverged) notConverged += 1;
    // 미수렴이면 reason 은 절대 'ok' 가 아니에요(잠긴 계약: 미수렴은 명시 거절)
    if (!d.rootSolverConverged) assert.notEqual(d.reason, 'ok');
    sumIt += d.rootSolverIterations; maxIt = Math.max(maxIt, d.rootSolverIterations);
    if (d.rootSolverIterations >= 100) ranToCap += 1;
  }
  assert.ok(n > 1500, `코퍼스 ${n}`);
  // ① σ=0 코퍼스에서 미수렴은 사실상 0 — 옛 정의는 여기서 98 % 였어요
  assert.ok(notConverged / n < 0.005, `rootSolverConverged=false ${notConverged}/${n}`);
  // ② 반복이 상한에 눌리지 않아요: 평균 반복이 40 밑, 상한(100)까지 간 것이 5 % 밑
  assert.ok(sumIt / n < 40, `평균 DK 반복 ${(sumIt / n).toFixed(1)}`);
  assert.ok(ranToCap / n < 0.05, `상한까지 돈 비율 ${(100 * ranToCap / n).toFixed(2)} %`);
  assert.ok(maxIt <= 100, `maxIt ${maxIt}`);
  // ③ 미수렴 경로가 **닿을 수 있는** 경로인지 — rootTol 을 도달 불가하게 만들면 명시 거절로 나와야 해요
  const pose = xCameraLookAt({ N, azimuth: 0.4, elevation: 0.3 });
  const { points } = xProjectSites({ N, pose, camera: CAM });
  const ids = [0, 7, 511], P = ids.map(worldOf);
  const J = xBearingsFromPixels(pixelsOf(points, ids), CAM);
  const forced = xP3P({ points: P, bearings: J }, { rootTol: 1e-300 });
  assert.equal(forced.length, 0);
  assert.equal(forced.diagnostics.reason, 'root-solver-not-converged');
  assert.equal(forced.diagnostics.rootSolverConverged, false);
  // ④ 우회 플래그: 명시적으로 끄면 해가 돌아와요(거절이 정책이지 불능이 아니라는 것)
  const bypass = xP3P({ points: P, bearings: J }, { rootTol: 1e-300, requireRootSolverConvergence: false });
  assert.ok(bypass.length >= 1);
  assert.equal(bypass.diagnostics.rootSolverConverged, false);
  assert.notEqual(bypass.diagnostics.reason, 'root-solver-not-converged');
});

test('xBearingsFromPixels — 주점은 +z, 정규화, camera·픽셀 검사', () => {
  const [j] = xBearingsFromPixels([[CAM.cx, CAM.cy]], CAM);
  assert.deepEqual(j, [0, 0, 1]);
  const [k] = xBearingsFromPixels([[CAM.cx + CAM.fx, CAM.cy]], CAM);
  assert.ok(Math.abs(Math.hypot(...k) - 1) < 1e-15 && Math.abs(k[0] - Math.SQRT1_2) < 1e-15 && Math.abs(k[2] - Math.SQRT1_2) < 1e-15);
  assert.throws(() => xBearingsFromPixels([[1, 2]], { ...CAM, model: 'fisheye' }), RangeError);
  assert.throws(() => xBearingsFromPixels([[1, NaN]], CAM), RangeError);
  assert.throws(() => xBearingsFromPixels('x', CAM), TypeError);
});

test('xIsRotation · xRotationAngleDeg · xExpSO3 · xOrthonormalizeRotation', () => {
  assert.ok(xIsRotation([1, 0, 0, 0, 1, 0, 0, 0, 1]));
  assert.ok(!xIsRotation([1, 0, 0, 0, 1, 0, 0, 0, -1]), '반사는 회전이 아니에요');
  assert.ok(!xIsRotation([1, 0, 0, 0, 1, 0, 0, 0, NaN]));
  assert.ok(!xIsRotation([1, 0, 0, 0, 1, 0, 0, 0]));
  const Ra = xRotation({ yaw: 0.3, pitch: -0.2, roll: 1.1 });
  assert.ok(Math.abs(xRotationAngleDeg(Ra, Ra)) < 1e-12);
  // 축-각 ω(|ω| = 0.7 rad) 을 합성하면 상대각이 정확히 0.7 rad
  const Rb = mat3Mul(xExpSO3([0.7 * 0.6, 0.7 * 0.8, 0]), Ra);
  assert.ok(xIsRotation(Rb, 1e-12));
  assert.ok(Math.abs(xRotationAngleDeg(Rb, Ra) - 0.7 * 180 / Math.PI) < 1e-10);
  // 작은 각(1e-10 rad) 도 sin 경로로 분해돼요 — acos 이었으면 0 또는 ~1e-8 rad 로 뭉개져요
  const Rc = mat3Mul(xExpSO3([1e-10, 0, 0]), Ra);
  assert.ok(Math.abs(xRotationAngleDeg(Rc, Ra) - 1e-10 * 180 / Math.PI) < 1e-12);
  // 180°
  assert.ok(Math.abs(xRotationAngleDeg(xRotation({ yaw: Math.PI }), xRotation({})) - 180) < 1e-9);
  // 오염된 R 을 재직교화 → SO(3), det +1
  const dirty = Ra.map((v, i) => v + (i % 2 ? 1e-3 : -1e-3));
  assert.ok(!xIsRotation(dirty, 1e-6));
  assert.ok(xIsRotation(xOrthonormalizeRotation(dirty), 1e-14));
  assert.equal(xOrthonormalizeRotation([1, 0, 0, 2, 0, 0, 0, 0, 1]), null, '평행 행');
});

// ⚠ 이 테스트의 1e-7 deg · 1e-8 · 1e-9 px 는 전부 **σ=0(잡음 없는 정확 투영)의 기계 정밀도**예요 —
//    solver 의 정확도 주장이 아니에요. 「이 구현이 얼마나 정확한가」는 아래 «잡음 사다리» 테스트가 유일한 답이고,
//    거기 수치(σ=0.05 px 에서 중앙 ~0.12 deg)가 실제 품질 지표예요. 이 수치를 품질로 인용하면 안 돼요.
//    여기서 이 자가 지키는 성질은 「대수는 맞게 전개됐는가 · 모든 해가 자기 3 점을 정확히 맞추는가 · R ∈ SO(3)」예요.
test('(a)(b)(i) xP3P — 무작위 pose 30 (σ=0 기계정밀도, 정확도 주장 아님): 참 pose 재현 · 모든 해 재투영 일치 · 해 ≤ 4 · SO(3)', () => {
  const rnd = mulberry32(3342109001);
  let worstRot = 0, worstT = 0, worstReproj = 0, totalSolutions = 0;
  for (let k = 0; k < 30; k += 1) {
    const pose = randomPose(rnd);
    const { points } = xProjectSites({ N, pose, camera: CAM });
    const { ids, P } = pick3(rnd);
    assert.ok(ids.every(id => points[id].inFront), `case ${k} 전부 카메라 앞`);
    const bearings = xBearingsFromPixels(pixelsOf(points, ids), CAM);
    const sols = xP3P({ points: P, bearings });
    assert.equal(sols.diagnostics.reason, 'ok', `case ${k} ${JSON.stringify(sols.diagnostics)}`);
    assert.ok(sols.length >= 1 && sols.length <= 4, `case ${k} 해 수 ${sols.length}`);
    totalSolutions += sols.length;
    let best = Infinity, bestT = Infinity;
    for (const s of sols) {
      assert.ok(xIsRotation(s.R, 1e-12), `case ${k} R ∉ SO(3)`);
      assert.ok(s.depths.every(d => d > 0));
      // ⚠ selfConsistency 는 「닫힌 해의 자기무모순」이지 적합도가 아니에요 — 그 성질은 아래 ★ 자가 잠가요.
      assert.equal(s.residual, undefined, '옛 이름 residual 은 제거됐어요(적합도로 오용되던 이름)');
      assert.ok(s.selfConsistency < 1e-12, `case ${k} 자기무모순 ${s.selfConsistency}`);
      // (b) 모든 해가 3 점을 재투영 오차 < 1e-9 px 로 맞춤
      for (let i = 0; i < 3; i += 1) {
        const [u, v, Z] = reprojectPx(s.R, s.t, P[i]);
        assert.ok(Z > 0);
        const err = Math.hypot(u - points[ids[i]].u, v - points[ids[i]].v);
        worstReproj = Math.max(worstReproj, err);
        assert.ok(err < 1e-9, `case ${k} 해 재투영 ${err} px`);
      }
      const rot = xRotationAngleDeg(s.R, pose.R);
      if (rot < best) { best = rot; bestT = maxAbsDiff(s.t, pose.t); }
    }
    worstRot = Math.max(worstRot, best); worstT = Math.max(worstT, bestT);
    assert.ok(best < 1e-7, `case ${k} 최량 해 회전각 ${best} deg`);
    assert.ok(bestT < 1e-8, `case ${k} 최량 해 |Δt| ${bestT}`);
  }
  assert.ok(totalSolutions >= 30);
  // 실제로 잰 최악값 기록(지어낸 수치 금지). 다시: 이건 σ=0 기계 정밀도지 정확도 주장이 아니에요.
  assert.ok(worstRot < 1e-7 && worstT < 1e-8 && worstReproj < 1e-9, `worst rot ${worstRot} t ${worstT} reproj ${worstReproj}`);
});

/**
 * ★ 결함 ① 의 자 ①/② — **표본을 키운** σ=0 「참 pose 가 해집합에 있는가」 자.
 * 위 (a) 의 30 뽑기는 위반률 1.7e-5 를 0.05 % 확률로만 잡아요(잡을 수 없는 자예요). 여기선 3000 시행을
 * 정족수로 재고, 「최악값」에도 상한을 둬요 — 수정 전 최악은 2.796e+1 deg 였어요(OBSERVED.sigma0Tail).
 */
test('★ xP3P σ=0 대표본 — 참 pose 가 해집합에 있다(정족수 + 최악 상한)', () => {
  const rnd = mulberry32(4242);
  let n = 0, violations = 0, worst = 0, noSol = 0, overflow = 0, maxSol = 0;
  const reasons = new Map();
  while (n < 3000) {
    const pose = randomPose(rnd);
    const ids = new Set(); while (ids.size < 3) ids.add(Math.floor(rnd() * N ** 3));
    const P = [...ids].map(worldOf);
    const px = P.map(p => reprojectPx(pose.R, pose.t, p));
    if (!px.every(q => q[2] > 0)) continue;
    const sols = xP3P({ points: P, bearings: xBearingsFromPixels(px.map(q => [q[0], q[1]]), CAM) });
    n += 1;
    reasons.set(sols.diagnostics.reason, (reasons.get(sols.diagnostics.reason) || 0) + 1);
    overflow += sols.diagnostics.droppedOverflow;
    maxSol = Math.max(maxSol, sols.length);
    if (!sols.length) { noSol += 1; assert.notEqual(sols.diagnostics.reason, 'ok'); continue; }
    let best = Infinity;
    for (const s of sols) best = Math.min(best, xRotationAngleDeg(s.R, pose.R));
    worst = Math.max(worst, best);
    if (!(best < 1e-7)) violations += 1;
  }
  // 해 수 상한(보존 상한 4)과 overflow 회계
  assert.ok(maxSol <= 4, `해 ${maxSol} 개 — 보존 상한 4 위반`);
  assert.ok(Number.isInteger(overflow) && overflow >= 0);
  // 해없음은 전부 진짜 퇴화(격자의 완전 공선 삼중)여야 해요
  assert.equal(reasons.get('ok') + noSol, n, JSON.stringify([...reasons]));
  assert.ok((reasons.get('collinear-points') ?? 0) === noSol, `해없음 사유 ${JSON.stringify([...reasons])}`);
  // 정족수: 3000 중 위반 ≤ 2 (실측 59906 중 1 = 1.7e-5)
  assert.ok(violations <= 2, `1e-7 deg 위반 ${violations}/${n}`);
  // 최악 상한: 수정 전 2.796e+1 deg 가 여기서 걸려요. 지금 실측 최악은 3.901e-4 deg(59906 코퍼스).
  assert.ok(worst < 1e-2, `최악 최량-회전오차 ${worst} deg — 수정 전은 ${OBSERVED.sigma0Tail.before.worstRotDeg} deg 였어요`);
});

/**
 * ★ 결함 ① 의 회귀 증인 — 옛 기본값이 **reason 'ok' 인 채로 참 pose 를 통째로 빠뜨리던** 두 건을 상수로 박아요.
 * 무작위 코퍼스로는 3.3e-5 확률이라 다음 리팩터링이 기본값을 되돌려도 안 빨개져요.
 *   · trial 11750: near-tangent 쌍의 |Im| 이 옛 고정 컷 1e-6 바로 위 → 참근이 Newton 에 닿기도 전에 버려짐.
 *     옛 기본값 최량 2.796e+1 deg → 지금 3.902e-4 deg.
 *   · trial 25619: |D(v*)| = 5.523e-6 상쇄 대역인데 옛 denomEps 1e-12 라 유리식 가지만 썼음.
 *     옛 기본값 최량 5.330e+0 deg → 지금 6.871e-11 deg.
 */
const WITNESSES = [
  {
    name: 'trial 11750 (imagTol 컷이 참근을 버림)',
    P: [[-3.5, -2.5, 3.5], [-1.5, -2.5, -1.5], [-2.5, -2.5, 2.5]],
    uv: [[98.35255919786613, 30.224272851355806], [186.97370193339674, 77.19675890201266], [115.85518944435691, 51.21229917982973]],
    R: [-0.15307890066157875, 0.09223892512565868, -0.9838998073299463,
      0.881032763916165, 0.4637021850764842, -0.09360316480513403,
      0.4476026352452425, -0.8811766362352994, -0.1522485358699954],
    t: [0, 5.551115123125783e-16, 22.27638440579176],
    oldBestDeg: 2.796e+1, bound: 1e-3,
  },
  {
    name: 'trial 25619 (denomEps 상쇄로 참 가지 탈락)',
    P: [[-1.5, 0.5, -0.5], [-1.5, 1.5, -3.5], [-3.5, -3.5, -0.5]],
    uv: [[155.38300018435902, 105.20962316991302], [223.9640591043075, 19.196108539373313], [19.133507883223785, 48.41609625945736]],
    R: [0.4815947911810662, 0.7895628001675729, -0.3803380623850401,
      0.11181109330970915, 0.3750795527567106, 0.9202247597824748,
      0.8692322684531176, -0.48570146560965544, 0.09235447896274404],
    t: [-6.661338147750939e-16, 0, 14.679058217443526],
    oldBestDeg: 5.330e+0, bound: 1e-8,
  },
];

test('★ xP3P 회귀 증인 — 옛 기본값이 「ok 인데 참 pose 없음」이던 2 건이 이제 참 pose 를 담아요(결함 ①)', () => {
  for (const w of WITNESSES) {
    // 상수가 진짜 그 pose 의 투영인지부터 — 상수를 잘못 옮겼으면 여기서 빨개져요
    for (let i = 0; i < 3; i += 1) {
      const [u, v, Z] = reprojectPx(w.R, w.t, w.P[i]);
      assert.ok(Z > 0, `${w.name} 점 ${i} 가 카메라 앞`);
      assert.ok(Math.hypot(u - w.uv[i][0], v - w.uv[i][1]) < 1e-9, `${w.name} 점 ${i} 상수 불일치`);
    }
    const sols = xP3P({ points: w.P, bearings: xBearingsFromPixels(w.uv, CAM) });
    assert.equal(sols.diagnostics.reason, 'ok', `${w.name} ${JSON.stringify(sols.diagnostics)}`);
    assert.ok(sols.length >= 1 && sols.length <= 4, `${w.name} 해 ${sols.length}`);
    let best = Infinity;
    for (const s of sols) best = Math.min(best, xRotationAngleDeg(s.R, w.R));
    assert.ok(best < w.bound, `${w.name} 최량 ${best} deg ≥ ${w.bound} (옛 기본값은 ${w.oldBestDeg} deg 였어요)`);
    // 진단이 「이 ok 가 불완전할 수 있다」를 말할 수 있어야 해요(소비자용 신호)
    assert.ok(Number.isFinite(sols.diagnostics.nearDoubleRoot), 'nearDoubleRoot 가 실려야 해요');
    assert.ok(Number.isFinite(sols.diagnostics.minDenom), 'minDenom 이 실려야 해요');
    assert.ok(Number.isFinite(sols.diagnostics.droppedComplexImag), 'droppedComplexImag 가 실려야 해요');
  }
});

/**
 * ★ 결함 ⑦ 의 자 — selfConsistency 는 **적합도가 아니에요**. 잡음을 0 → 5 px 로 올려도 값이 안 움직이는데
 * 같은 코퍼스의 실제 회전오차는 100 deg 넘게 벌어져요. 이 자가 있어야 다음 사람이 이걸 점수로 못 써요.
 */
test('★ selfConsistency 는 잡음 지표가 아니에요 — σ 0…5 px 에서 값이 안 움직이고 회전오차만 벌어져요', () => {
  const summary = {};
  for (const sigma of [0, 0.5, 1.4, 5]) {
    const rnd = mulberry32(31337);
    const gauss = gaussOf(rnd);
    let worstSelf = 0, worstRot = 0, nSol = 0;
    for (let k = 0; k < 250; k += 1) {
      const pose = randomPose(rnd);
      const ids = new Set(); while (ids.size < 3) ids.add(Math.floor(rnd() * N ** 3));
      const P = [...ids].map(worldOf);
      const px = P.map(p => reprojectPx(pose.R, pose.t, p));
      if (!px.every(q => q[2] > 0)) continue;
      const pixels = px.map(q => [q[0] + sigma * gauss(), q[1] + sigma * gauss()]);
      const sols = xP3P({ points: P, bearings: xBearingsFromPixels(pixels, CAM) });
      for (const s of sols) {
        nSol += 1;
        worstSelf = Math.max(worstSelf, s.selfConsistency);
        worstRot = Math.max(worstRot, xRotationAngleDeg(s.R, pose.R));
      }
    }
    summary[sigma] = { worstSelf, worstRot, nSol };
    assert.ok(nSol > 400, `σ=${sigma} 해 ${nSol} 개 — 코퍼스가 너무 작아요`);
    // 성질 ①: σ 와 무관하게 1e-12 rad 밑 (관측 최대 4.926e-14 @σ=1.4)
    assert.ok(worstSelf < 1e-12, `σ=${sigma} selfConsistency 최대 ${worstSelf} rad`);
    assert.ok(worstSelf < OBSERVED.selfConsistencyMaxRad[sigma] * 10, `σ=${sigma} 관측(${OBSERVED.selfConsistencyMaxRad[sigma]}) 대비 ${worstSelf}`);
  }
  // 성질 ②: 회전오차는 σ 를 따라 커지는데(적어도 σ=0 대비 σ=5 에서), selfConsistency 는 같은 자리에 있어요
  assert.ok(summary[5].worstRot > 10, `σ=5 회전오차 최대 ${summary[5].worstRot} deg`);
  const selfSpread = Math.max(...[0, 0.5, 1.4, 5].map(s => summary[s].worstSelf)) / Math.min(...[0, 0.5, 1.4, 5].map(s => summary[s].worstSelf));
  assert.ok(selfSpread < 100, `selfConsistency 가 σ 에 따라 ${selfSpread}× 움직였어요 — 이 자의 전제가 깨졌어요`);
});

test('(c)(d) xP3P — 공선 세계점·일치 bearing·비유한·형식 오류는 [] + reason', () => {
  const pose = xCameraLookAt({ N, azimuth: 0.4, elevation: 0.3 });
  const { points } = xProjectSites({ N, pose, camera: CAM });
  const ids = [0, 7, 511];
  const P = ids.map(worldOf);
  const J = xBearingsFromPixels(pixelsOf(points, ids), CAM);
  const col = xP3P({ points: [[0, 0, 0], [1, 1, 1], [2, 2, 2]], bearings: J });
  assert.deepEqual([...col], []);
  assert.equal(col.diagnostics.reason, 'collinear-points');
  // 거의 공선(면적 비 < eps)
  const almost = xP3P({ points: [[0, 0, 0], [1, 0, 0], [2, 1e-14, 0]], bearings: J });
  assert.equal(almost.diagnostics.reason, 'collinear-points');
  const same = xP3P({ points: P, bearings: [J[0], J[0], J[2]] });
  assert.equal(same.length, 0); assert.equal(same.diagnostics.reason, 'coincident-bearings');
  const anti = xP3P({ points: P, bearings: [J[0], J[1].map(v => -v), J[1]] });
  assert.equal(anti.diagnostics.reason, 'coincident-bearings');
  assert.equal(xP3P({ points: P, bearings: [J[0], [NaN, 0, 1], J[2]] }).diagnostics.reason, 'non-finite-input');
  assert.equal(xP3P({ points: [P[0], [1, Infinity, 0], P[2]], bearings: J }).diagnostics.reason, 'non-finite-input');
  assert.equal(xP3P({ points: P, bearings: [J[0], [0, 0, 0], J[2]] }).diagnostics.reason, 'non-finite-input');
  assert.equal(xP3P({ points: P.slice(0, 2), bearings: J }).diagnostics.reason, 'need-3-points-and-3-bearings');
  assert.equal(xP3P().diagnostics.reason, 'need-3-points-and-3-bearings');
});

test('(e) xP3P — 카메라 뒤 해 필터링: bearing 하나를 뒤집으면 참 해가 음의 깊이로 옮겨가 droppedBehind 에 세어져요', () => {
  const pose = xCameraLookAt({ N, azimuth: 0.4, elevation: 0.3 });
  const { points } = xProjectSites({ N, pose, camera: CAM });
  const ids = [0, 7, 511];
  const P = ids.map(worldOf);
  const J = xBearingsFromPixels(pixelsOf(points, ids), CAM);
  const ok = xP3P({ points: P, bearings: J });
  assert.equal(ok.diagnostics.droppedBehind, 0);
  assert.ok(ok.length >= 1);
  // j2 → −j2: 코사인 법칙은 s2 → −s2 로 같은 계여서 원래 해가 «s2 < 0» 으로 나타나요
  const flipped = xP3P({ points: P, bearings: [J[0], J[1].map(v => -v), J[2]] });
  assert.ok(flipped.diagnostics.droppedBehind >= 1, JSON.stringify(flipped.diagnostics));
  for (const s of flipped) {
    assert.ok(s.depths.every(d => d > 0));
    for (const p of P) assert.ok(reprojectPx(s.R, s.t, p)[2] > 0, '남은 해는 전부 Z > 0');
  }
  if (!flipped.length) assert.equal(flipped.diagnostics.reason, 'all-behind-camera');
  // 전부 뒤(모든 bearing 반전): 남는 해 0, 사유 명시
  const allBack = xP3P({ points: P, bearings: J.map(j => j.map(v => -v)) });
  assert.equal(allBack.length, 0);
  assert.equal(allBack.diagnostics.reason, 'all-behind-camera');
  assert.ok(allBack.diagnostics.droppedBehind >= 1);
});

test('(h) 결정성 — 같은 입력 두 번 → JSON.stringify 동일(P3P·LM), 근 순서 고정', () => {
  const rnd = mulberry32(99);
  const pose = randomPose(rnd);
  const { points } = xProjectSites({ N, pose, camera: CAM });
  const { ids, P } = pick3(rnd);
  const J = xBearingsFromPixels(pixelsOf(points, ids), CAM);
  const a = xP3P({ points: P, bearings: J }), b = xP3P({ points: P, bearings: J });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a.diagnostics), JSON.stringify(b.diagnostics));
  for (let i = 1; i < a.length; i += 1) assert.ok(a[i - 1].depths[0] <= a[i].depths[0], 'depths 사전순');
  const many = [0, 7, 56, 63, 448, 455, 504, 511, 219, 300];
  const args = { points: many.map(worldOf), pixels: pixelsOf(points, many), camera: CAM, R0: mat3Mul(xExpSO3([0.05, 0.03, 0.02]), pose.R), t0: pose.t.map(v => v + 0.3) };
  assert.equal(JSON.stringify(xPoseLM(args)), JSON.stringify(xPoseLM(args)));
});

test('(f)(i) xPoseLM — 8–12 점 + 0.05 px 잡음, 초기값 = 참 pose 를 5°·0.5 pitch 흔든 것 → 수렴·rms < 0.15·회전 < 0.2 deg·SO(3)', () => {
  const rnd = mulberry32(3342109009);
  const gauss = gaussOf(rnd);
  let worstRot = 0, worstRms = 0, maxIt = 0;
  for (let k = 0; k < 20; k += 1) {
    const pose = randomPose(rnd);
    const { points } = xProjectSites({ N, pose, camera: CAM });
    const m = 8 + Math.floor(rnd() * 5);
    const ids = new Set();
    while (ids.size < m) ids.add(Math.floor(rnd() * N ** 3));
    const P = [...ids].map(worldOf);
    const pixels = [...ids].map(id => [points[id].u + 0.05 * gauss(), points[id].v + 0.05 * gauss()]);
    const ax = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], an = Math.hypot(...ax);
    const R0 = mat3Mul(xExpSO3(ax.map(v => (v / an) * (5 * Math.PI / 180))), pose.R);
    const dt = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], dn = Math.hypot(...dt);
    const t0 = pose.t.map((v, i) => v + (dt[i] / dn) * 0.5);
    assert.ok(Math.abs(xRotationAngleDeg(R0, pose.R) - 5) < 1e-9);
    const res = xPoseLM({ points: P, pixels, camera: CAM, R0, t0 });
    assert.equal(res.converged, true, `case ${k} ${res.reason}`);
    assert.ok(['converged', 'step-below-tol'].includes(res.reason), res.reason);
    assert.ok(xIsRotation(res.R, 1e-12), `case ${k} R ∉ SO(3)`);
    assert.ok(Math.abs(det(res.R) - 1) < 1e-12);
    assert.ok(res.rmsPx < 0.15, `case ${k} rms ${res.rmsPx}`);
    assert.ok(res.maxPx >= res.rmsPx && Number.isFinite(res.maxPx));
    const rot = xRotationAngleDeg(res.R, pose.R);
    assert.ok(rot < 0.2, `case ${k} 회전각 오차 ${rot} deg`);
    assert.ok(maxAbsDiff(res.t, pose.t) < 0.1, `case ${k} |Δt| ${maxAbsDiff(res.t, pose.t)}`);
    assert.ok(res.iterations >= 1 && res.iterations <= 20);
    worstRot = Math.max(worstRot, rot); worstRms = Math.max(worstRms, res.rmsPx); maxIt = Math.max(maxIt, res.iterations);
  }
  assert.ok(worstRot < 0.2 && worstRms < 0.15, `worst rot ${worstRot} rms ${worstRms} maxIt ${maxIt}`);
  // 잡음 없는 데이터: 참 pose 로 되돌아가요(회전 < 1e-6 deg — tol 1e-10 의 step-below-tol 스케일)
  const pose = xCameraLookAt({ N, azimuth: 0.4, elevation: 0.3, roll: 0.2 });
  const { points } = xProjectSites({ N, pose, camera: CAM });
  const many = [0, 7, 56, 63, 448, 455, 504, 511, 219, 300];
  const exact = xPoseLM({ points: many.map(worldOf), pixels: pixelsOf(points, many), camera: CAM, R0: mat3Mul(xExpSO3([0.05, 0.03, 0.02]), pose.R), t0: pose.t.map(v => v + 0.3) });
  assert.equal(exact.converged, true, exact.reason);
  assert.ok(exact.rmsPx < 1e-6 && xRotationAngleDeg(exact.R, pose.R) < 1e-6, `${exact.rmsPx} ${xRotationAngleDeg(exact.R, pose.R)}`);
});

test('(g) xPoseLM — 발산·퇴화는 converged:false + reason: 공선 3 점 · 초기 카메라 뒤 · λ 상한 · maxIter · 비유한 · R0 비회전', () => {
  const pose = xCameraLookAt({ N, azimuth: 0.4, elevation: 0.3 });
  const { points } = xProjectSites({ N, pose, camera: CAM });
  // 공선 3 점(z 열): 그 축 둘레 회전이 관측 불가 → 정규화 JᵀJ 랭크 결손
  const col = [0, 1, 2];
  const degenerate = xPoseLM({ points: col.map(worldOf), pixels: pixelsOf(points, col), camera: CAM, R0: pose.R, t0: pose.t });
  assert.equal(degenerate.converged, false);
  assert.equal(degenerate.reason, 'degenerate-jacobian');
  const many = [0, 7, 56, 63, 448, 455, 504, 511, 219, 300];
  const P = many.map(worldOf), pixels = pixelsOf(points, many);
  const behind = xPoseLM({ points: P, pixels, camera: CAM, R0: pose.R, t0: [0, 0, -21] });
  assert.equal(behind.converged, false); assert.equal(behind.reason, 'behind-camera-initial');
  // 180° 뒤집힌 초기값 — ⚠ 예전 구현은 여기서 diverged 로 끝났고 주석은 그걸 «진짜 지역 극소» 라고 적었는데,
  // 표준 LM(거부마다 λ ← λ·10, λmax 까지)으로 고친 뒤 실측하면 **참 pose 로 수렴**해요. 즉 그 diverged 는 오탐이었어요.
  // 관측(2026-09-20): it 32 · 거부 11 회 · reason 'step-below-tol' · rms 9.086e-9 px · 회전 5.292e-10 deg.
  const flipped = xPoseLM({ points: P, pixels, camera: CAM, R0: mat3Mul(xExpSO3([0, Math.PI, 0]), pose.R), t0: pose.t }, { maxIter: 50 });
  assert.equal(flipped.converged, true, flipped.reason);
  assert.ok(flipped.rmsPx < 1e-6, `rms ${flipped.rmsPx}`);
  assert.ok(xRotationAngleDeg(flipped.R, pose.R) < 1e-6, `회전 ${xRotationAngleDeg(flipped.R, pose.R)} deg`);
  assert.ok(flipped.iterations <= 50);
  assert.ok(xIsRotation(flipped.R, 1e-12), '반환 R 은 SO(3)');
  // ★ 회귀 잠금: 옛 상한(거부 3회 연속 → diverged)을 되살리면 이 하강이 다시 죽어요.
  assert.ok(flipped.maxConsecutiveRejects > 3, `λ 를 ${flipped.maxConsecutiveRejects} 번 연속 올려야 도달해요 — 상한 3 이면 오탐`);
  // diverged 경로는 λ 를 못 올리게 막아 결정적으로 재요(λmax 를 초기 λ 바로 위로)
  const capped2 = xPoseLM({ points: P, pixels, camera: CAM, R0: mat3Mul(xExpSO3([0, Math.PI, 0]), pose.R), t0: pose.t }, { maxIter: 50, lambdaMax: 1e-2 });
  assert.equal(capped2.converged, false);
  assert.match(capped2.reason, /^diverged\(lambda-max:/);
  assert.ok(capped2.rejectedSteps >= 1);
  assert.ok(xIsRotation(capped2.R, 1e-12), '실패해도 반환 R 은 SO(3)');
  // 반복 상한
  const capped = xPoseLM({ points: P, pixels, camera: CAM, R0: mat3Mul(xExpSO3([0.05, 0.03, 0]), pose.R), t0: pose.t }, { maxIter: 1 });
  assert.equal(capped.converged, false); assert.equal(capped.reason, 'max-iterations'); assert.equal(capped.iterations, 1);
  // 비유한 입력·R0 비회전·점 부족
  assert.equal(xPoseLM({ points: P, pixels: pixels.map((p, i) => (i === 2 ? [NaN, p[1]] : p)), camera: CAM, R0: pose.R, t0: pose.t }).reason, 'non-finite-input');
  assert.equal(xPoseLM({ points: P, pixels, camera: CAM, R0: pose.R, t0: [0, Infinity, 21] }).reason, 'non-finite-input');
  assert.equal(xPoseLM({ points: P, pixels, camera: CAM, R0: [1, 0, 0, 0, 1, 0, 0, 0, -1], t0: pose.t }).reason, 'R0-not-a-rotation');
  assert.equal(xPoseLM({ points: P.slice(0, 2), pixels: pixels.slice(0, 2), camera: CAM, R0: pose.R, t0: pose.t }).reason, 'need-at-least-3-points');
  assert.throws(() => xPoseLM({ points: P, pixels: pixels.slice(1), camera: CAM, R0: pose.R, t0: pose.t }), TypeError);
  assert.throws(() => xPoseLM({ points: P, pixels, camera: { ...CAM, fx: 0 }, R0: pose.R, t0: pose.t }), RangeError);
});

test('P3P → LM 연계 — P3P 해를 초기값으로 8 점 LM 이 잡음 없는 데이터에서 참 pose 로 수렴', () => {
  const rnd = mulberry32(2026);
  const pose = randomPose(rnd);
  const { points } = xProjectSites({ N, pose, camera: CAM });
  const { ids, P } = pick3(rnd);
  const sols = xP3P({ points: P, bearings: xBearingsFromPixels(pixelsOf(points, ids), CAM) });
  const more = new Set(ids);
  while (more.size < 8) more.add(Math.floor(rnd() * N ** 3));
  const all = [...more];
  const results = sols.map(s => xPoseLM({ points: all.map(worldOf), pixels: pixelsOf(points, all), camera: CAM, R0: s.R, t0: s.t }));
  // 참 해에서 출발한 LM 은 rms ≈ 0 · 회전 ≈ 0 — 나머지 해는 8 점을 못 맞추거나 같은 곳으로 와요
  const good = results.filter(r => r.converged && r.rmsPx < 1e-6 && xRotationAngleDeg(r.R, pose.R) < 1e-6);
  assert.ok(good.length >= 1, JSON.stringify(results.map(r => [r.converged, r.reason, r.rmsPx])));
});

const quant = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN; };

/**
 * P3P 잡음 사다리 한 칸 — σ 를 픽셀에 더하고 «최량 해의 참 pose 회전각 오차» 를 모아요.
 * triples 가 주어지면 그 고정 삼중(저 면적비 «최악» 코퍼스), 아니면 무작위 삼중.
 * @returns {{n:number, noSol:number, med:number, p90:number, worst:number, reasons:Map}}
 */
function noiseLadderRung({ sigma, seed, cases, triples = null, requireInFrame = true, opts = {} }) {
  const rnd = mulberry32(seed);
  const gauss = gaussOf(rnd);
  const rots = []; const reasons = new Map();
  let noSol = 0, n = 0;
  while (n < cases) {
    const pose = randomPose(rnd);
    const tris = triples ?? [(() => { const s = new Set(); while (s.size < 3) s.add(Math.floor(rnd() * N ** 3)); return [...s]; })()];
    for (const tri of tris) {
      if (n >= cases) break;
      const P = tri.map(worldOf);
      const px = P.map(p => reprojectPx(pose.R, pose.t, p));
      if (!px.every(q => q[2] > 0)) continue;
      if (requireInFrame && !px.every(q => q[0] >= 0 && q[0] < CAM.width && q[1] >= 0 && q[1] < CAM.height)) continue;
      const pixels = px.map(q => [q[0] + sigma * gauss(), q[1] + sigma * gauss()]);
      const sols = xP3P({ points: P, bearings: xBearingsFromPixels(pixels, CAM) }, opts);
      if (sols.diagnostics.reason === 'collinear-points') continue; // 잡음 축이 아니라 퇴화 — 사다리에서 제외
      n += 1;
      reasons.set(sols.diagnostics.reason, (reasons.get(sols.diagnostics.reason) || 0) + 1);
      if (!sols.length) { noSol += 1; continue; }
      let best = Infinity;
      for (const s of sols) best = Math.min(best, xRotationAngleDeg(s.R, pose.R));
      rots.push(best);
    }
  }
  return { n, noSol, med: quant(rots, 0.5), p90: quant(rots, 0.9), worst: Math.max(...rots), reasons };
}

/**
 * ★ 잡음 체제 사다리 — 이 파일에서 **유일하게 solver 정확도를 주장하는 자**예요.
 * (a)(b)(i) 의 1e-7 deg 는 σ=0 기계 정밀도라 정확도 주장이 아니에요.
 * 단일 최악값이 아니라 중앙·p90 + 정족수 하한으로 재요(「한 점은 계약이 아니다」).
 * 임계값은 전부 2026-09-20 실측에서 여유를 두고 정했어요(아래 관측표) — 지어낸 수치 없음.
 */
test('★ P3P 잡음 사다리 — σ ∈ {0, 0.05, 0.2, 0.5} px × 200 무작위 삼중: 중앙·p90·해없음 정족수', () => {
  // 관측 정본은 OBSERVED.randomTriples (이 파일 상단) — 여기 표를 또 적지 않아요.
  const bounds = {
    0: { noSol: 0, med: 1e-9, p90: 1e-8 },      // σ=0 은 기계 정밀도 칸(사다리의 「아무것도 안 함」 끝)
    0.05: { noSol: 0, med: 0.3, p90: 1.0 },
    0.2: { noSol: 2, med: 1.0, p90: 4.0 },
    0.5: { noSol: 4, med: 2.5, p90: 10.0 },
  };
  const got = {};
  for (const sigma of [0, 0.05, 0.2, 0.5]) {
    const r = noiseLadderRung({ sigma, seed: 777, cases: 200 });
    got[sigma] = r;
    const b = bounds[sigma];
    assert.equal(r.n, 200);
    assert.ok(r.noSol <= b.noSol, `σ=${sigma} 해없음 ${r.noSol} > 정족수 ${b.noSol} (${JSON.stringify([...r.reasons])})`);
    assert.ok(r.med < b.med, `σ=${sigma} 중앙 ${r.med} deg ≥ ${b.med}`);
    assert.ok(r.p90 < b.p90, `σ=${sigma} p90 ${r.p90} deg ≥ ${b.p90}`);
    // 정본 상수와의 대조 — OBSERVED 가 썩으면 여기가 빨개져요(머리 주석이 이 상수를 가리켜요)
    const o = OBSERVED.randomTriples[sigma];
    assert.equal(r.noSol, o.noSol, `σ=${sigma} 해없음 ${r.noSol} ≠ 정본 ${o.noSol}`);
    assert.ok(Math.abs(r.med / o.med - 1) < 0.05, `σ=${sigma} 중앙 ${r.med} vs 정본 ${o.med}`);
    assert.ok(Math.abs(r.p90 / o.p90 - 1) < 0.05, `σ=${sigma} p90 ${r.p90} vs 정본 ${o.p90}`);
  }
  // 성질(값이 아니라): 잡음이 커지면 오차도 커져요 — 단조성이 깨지면 자가 엉뚱한 축을 재고 있는 거예요
  const sigmas = [0, 0.05, 0.2, 0.5];
  for (let i = 1; i < sigmas.length; i += 1) {
    assert.ok(got[sigmas[i]].med > got[sigmas[i - 1]].med, `중앙값이 σ 에 단조가 아니에요: ${sigmas[i - 1]}→${sigmas[i]}`);
    assert.ok(got[sigmas[i]].p90 > got[sigmas[i - 1]].p90, `p90 가 σ 에 단조가 아니에요: ${sigmas[i - 1]}→${sigmas[i]}`);
  }
});

const WORST_TRIPLES = [[0, 73, 510], [6, 77, 504], [7, 78, 496]];

test('★ P3P 잡음 사다리 — 저 면적비 «최악» 삼중: 실근 상실(no-real-root)에 실패가 몰려요', () => {
  // 고정 삼중 3 개의 면적비는 1.0554e-2 (격자 최소 양수 면적비 1.1498e-2 근처 — 격자에서 제일 나쁜 삼각형)
  const TRIPLES = WORST_TRIPLES;
  // 관측 정본은 OBSERVED.worstTriples (이 파일 상단).
  const bounds = {
    0: { noSol: 0, med: 1e-8 },
    0.05: { noSol: 60, med: 3.0 },
    0.2: { noSol: 120, med: 10.0 },
    0.5: { noSol: 180, med: 20.0 },
  };
  const got = {};
  for (const sigma of [0, 0.05, 0.2, 0.5]) {
    const r = noiseLadderRung({ sigma, seed: 3342109001, cases: 600, triples: TRIPLES, requireInFrame: false });
    got[sigma] = r;
    assert.equal(r.n, 600);
    assert.ok(r.noSol <= bounds[sigma].noSol, `σ=${sigma} 해없음 ${r.noSol} > 정족수 ${bounds[sigma].noSol}`);
    assert.ok(r.med < bounds[sigma].med, `σ=${sigma} 중앙 ${r.med} deg ≥ ${bounds[sigma].med}`);
    const o = OBSERVED.worstTriples[sigma];
    assert.equal(r.noSol, o.noSol, `σ=${sigma} 해없음 ${r.noSol} ≠ 정본 ${o.noSol}`);
    assert.ok(Math.abs(r.med / o.med - 1) < 0.05, `σ=${sigma} 중앙 ${r.med} vs 정본 ${o.med}`);
    assert.ok(Math.abs(r.p90 / o.p90 - 1) < 0.05, `σ=${sigma} p90 ${r.p90} vs 정본 ${o.p90}`);
    // ⚠ 현황 기록일 뿐이에요: 「기본 팔에서 해없음의 사유는 전부 no-real-root」. 이 자는 **「옵션으로 못 덮는다」를
    //    반증할 수 없어요** — 코드가 실근 0 이면 잔차 게이트보다 위에서 반환하니 기본 팔만으로는 구성상 참이에요.
    //    그 주장을 실제로 재는 건 아래 ★ 2 팔 자예요.
    if (sigma > 0) assert.ok((r.reasons.get('no-real-root') ?? 0) === r.noSol, `σ=${sigma} 해없음 사유 ${JSON.stringify([...r.reasons])}`);
    else assert.deepEqual([...r.reasons], [['ok', 600]]);
  }
  // 성질 ①: σ 가 커지면 해없음도 커져요(실근 상실은 잡음을 따라가요)
  const sigmas = [0, 0.05, 0.2, 0.5];
  for (let i = 1; i < sigmas.length; i += 1) assert.ok(got[sigmas[i]].noSol > got[sigmas[i - 1]].noSol, `해없음이 σ 에 단조가 아니에요: ${sigmas[i - 1]}→${sigmas[i]}`);
  // 성질 ②: 실패는 「저 면적비 삼중」에 몰려요 — 무작위 삼중 같은 σ 에서는 해없음 0
  const random005 = noiseLadderRung({ sigma: 0.05, seed: 777, cases: 200 });
  assert.equal(random005.noSol, 0);
  assert.ok(got[0.05].noSol / got[0.05].n > random005.noSol / random005.n, '최악 삼중의 실패율이 무작위 삼중보다 높아야 해요');
  assert.ok(got[0.05].med > random005.med * 5, `최악 삼중 중앙 ${got[0.05].med} vs 무작위 ${random005.med} deg`);
});

/**
 * ★ 결함 ⑤ 의 자 — **팔이 둘인 자**. 위 사다리(기본 팔 하나)는 「옵션으로 못 덮는다」를 구조적으로 반증할 수
 * 없어요. 여기서는 같은 코퍼스를 {기본} 과 {imagTol 1e-1, residualTol 1e-5} 로 돌려
 *   ① residualTol 만으로는 no-real-root 건수가 **원리적으로** 안 줄고(코드가 그 위에서 반환),
 *   ② imagTol 을 함께 풀면 상당수가 회복되며,
 *   ③ 회복분의 품질이 base 자신의 분포 안에 머문다
 * 는 세 가지를 잽니다. 기본값을 어느 쪽으로 둘지는 **캠페인 목적이 정할 문제**라 여기서 봉인하지 않아요 —
 * 이 자는 「기본값이 무엇을 버리고 있는지」를 수치로 보이는 자예요.
 */
test('★ 2 팔 자 — {기본} vs {imagTol 1e-1, residualTol 1e-5}: residualTol 단독은 구조적으로 무력, 둘을 함께 풀면 회복', () => {
  for (const sigma of [0.05, 0.2, 0.5]) {
    const base = noiseLadderRung({ sigma, seed: 3342109001, cases: 600, triples: WORST_TRIPLES, requireInFrame: false });
    const rtOnly = noiseLadderRung({ sigma, seed: 3342109001, cases: 600, triples: WORST_TRIPLES, requireInFrame: false, opts: { residualTol: 1e-5 } });
    const both = noiseLadderRung({ sigma, seed: 3342109001, cases: 600, triples: WORST_TRIPLES, requireInFrame: false, opts: { imagTol: 1e-1, residualTol: 1e-5 } });
    const [oBase, oBoth] = OBSERVED.twoArmNoSol[sigma];
    // ① residualTol 단독: 건수 변화 0 — 「실험 결과」가 아니라 **구성상 참**이라는 걸 자로 굳혀요
    assert.equal(rtOnly.noSol, base.noSol, `σ=${sigma} residualTol 단독이 해없음을 바꿨어요 ${base.noSol}→${rtOnly.noSol} — 반환 순서가 바뀌었는지 확인하세요`);
    assert.equal(base.noSol, oBase, `σ=${sigma} 기본 해없음 ${base.noSol} ≠ 정본 ${oBase}`);
    // ② 둘을 함께: 실제로 회복돼요
    assert.ok(both.noSol < base.noSol, `σ=${sigma} 2 팔이 회복을 못 했어요 ${base.noSol}→${both.noSol}`);
    assert.equal(both.noSol, oBoth, `σ=${sigma} 2 팔 해없음 ${both.noSol} ≠ 정본 ${oBoth}`);
    // ③ 회복분의 품질이 base 분포 밖으로 안 나가요(중앙·p90 이 base 의 1.5 배 안)
    assert.ok(both.med < base.med * 1.5, `σ=${sigma} 2 팔 중앙 ${both.med} vs base ${base.med}`);
    assert.ok(both.p90 < base.p90 * 1.5, `σ=${sigma} 2 팔 p90 ${both.p90} vs base ${base.p90}`);
  }
});

/**
 * ★ 사다리 ① — **세계 형상 축**(면적비 h). 「선언된 퇴화 거절선(1e-12)」과 「실측 사용 하한(≈1.5e-3)」 사이
 * 9 decade 대역을 잠가요.
 * ⚠ 이 사다리는 h 를 흔들면 세계 형상과 **화면 부분각이 같이** 움직이는 교란 설계예요 — 그래서 여기 결과를
 *   「면적비 탓」으로 읽으면 안 돼요. 부분각 축은 아래 ★ 사다리 ②(dOW, areaRatio 상수)가 따로 재요.
 */
test('★ 사다리 ①(세계 형상) xP3P 면적비 — 1e-1…1e-15 구간별 reason: ok / 붕괴 / collinear-points 가 갈려요', () => {
  const pose = xCameraLookAt({ N, azimuth: 0.4, elevation: 0.3 });
  const run = h => {
    const P = [[-0.5, 0, 0], [0.5, 0, 0], [0, h, 0]];
    const px = P.map(p => reprojectPx(pose.R, pose.t, p));
    assert.ok(px.every(q => q[2] > 0), `h=${h} 카메라 앞`);
    const sols = xP3P({ points: P, bearings: xBearingsFromPixels(px.map(q => [q[0], q[1]]), CAM) });
    let best = Infinity;
    for (const s of sols) best = Math.min(best, xRotationAngleDeg(s.R, pose.R));
    return { sols, d: sols.diagnostics, best };
  };
  // ① 사용 가능 대역: 해가 나오고 정확해요. 관측 회전오차 1e-1→2.25e-10 · 3e-3→1.70e-7 · 1.5e-3→1.25e-7 deg
  for (const [h, tol] of [[1e-1, 1e-9], [3e-2, 1e-8], [1e-2, 1e-7], [3e-3, 1e-6], [2e-3, 1e-5], [1.5e-3, 1e-5]]) {
    const { sols, d, best } = run(h);
    assert.equal(d.reason, 'ok', `h=${h} reason=${d.reason}`);
    assert.ok(sols.length >= 1, `h=${h} sols=${sols.length}`);
    assert.ok(Math.abs(d.areaRatio - h) < 1e-12 * Math.max(1, h), `h=${h} areaRatio=${d.areaRatio}`);
    assert.ok(best < tol, `h=${h} 최량 회전오차 ${best} deg ≥ ${tol}`);
  }
  // ② 붕괴 대역(선언 거절선 1e-12 위인데 못 푸는 구간).
  //    ⚠ 「해 0」이 이 대역의 계약이 **아니에요**: 관측(2026-09-20 수정본) 1.2e-3…1e-6 · 1e-10 은 해 0
  //    (ill-conditioned) 인데, **1e-8 칸은 해 2 개를 reason 'ok' 로 돌려주고 그 해가 7.140e+1 deg 틀려요**.
  //    그래서 여기서 재는 성질은 「거절된다」가 아니라 「**조용히 정확하지 않다** + 부분각 지표가 경보를 준다」예요.
  let sawIll = 0, sawSilentWrong = 0;
  for (const h of [1.2e-3, 1e-3, 8e-4, 5e-4, 1e-4, 1e-6, 1e-8, 1e-10]) {
    const { sols, d, best } = run(h);
    assert.notEqual(d.reason, 'collinear-points', `h=${h} 는 선언된 퇴화선(1e-12) 위예요 — 「퇴화라 거절」로 읽히면 안 돼요`);
    assert.ok(d.areaRatio > 1e-12, `h=${h} areaRatio=${d.areaRatio}`);
    // 이 대역의 부분각은 사용 대역(h=1.5e-3 에서 1.496e-6 sr)보다 작아요 — 소비자가 볼 수 있는 경보
    assert.ok(d.bearingSolidAngle < 1.5e-6, `h=${h} 입체각 ${d.bearingSolidAngle} sr — 붕괴 대역인데 경보가 안 떠요`);
    if (sols.length === 0) {
      assert.ok(['ill-conditioned', 'no-real-root'].includes(d.reason), `h=${h} reason=${d.reason}`);
      if (d.reason === 'ill-conditioned') { sawIll += 1; assert.ok(d.realRoots > 0 && d.droppedResidual > 0, JSON.stringify(d)); }
    } else {
      // 해가 나왔다면 그건 **정확하지 않아요** — 「붕괴 대역인데 갑자기 정확해졌다」면 자가 엉뚱한 걸 재는 거예요
      sawSilentWrong += 1;
      assert.ok(best > 1e-2, `h=${h} 붕괴 대역에서 해가 정확해요(${best} deg) — 대역 경계가 옮겨졌는지 확인하세요`);
    }
  }
  assert.ok(sawIll >= 6, `ill-conditioned 를 ${sawIll} 칸에서만 봤어요 — 사유 승격이 배선됐는지 확인하세요`);
  assert.equal(sawSilentWrong, 1, `「ok 인데 틀린」 칸이 ${sawSilentWrong} 개 — 관측은 1 개(h=1e-8)예요`);
  // ③ 선언된 퇴화선 아래: collinear-points 로 거절
  for (const h of [1e-13, 1e-15, 0]) {
    const { sols, d } = run(h);
    assert.equal(sols.length, 0);
    assert.equal(d.reason, 'collinear-points', `h=${h} reason=${d.reason}`);
    assert.ok(d.areaRatio < 1e-12);
  }
  // ④ eps 를 올리면 거절선이 같이 올라가요(선언선이 진짜 옵션인지)
  const P = [[-0.5, 0, 0], [0.5, 0, 0], [0, 1e-4, 0]];
  const px = P.map(p => reprojectPx(pose.R, pose.t, p));
  const J = xBearingsFromPixels(px.map(q => [q[0], q[1]]), CAM);
  assert.equal(xP3P({ points: P, bearings: J }, { eps: 1e-3 }).diagnostics.reason, 'collinear-points');
  assert.equal(xP3P({ points: P, bearings: J }, { eps: 1e-12 }).diagnostics.reason, 'ill-conditioned');
});

/**
 * ★ 사다리 ②(화면 부분각) — **결함 ④ 의 자**. 세계 형상(areaRatio)을 한 글자도 안 바꾸고 카메라 거리만 밀어요.
 * 옛 파일 머리는 붕괴를 areaRatio 에 귀속시키고 「N=8 격자 삼중은 이 대역이 구조적으로 안 생겨요」라고 조건 없이
 * 적었는데, 이 사다리가 그 문장을 반증해요: **같은 격자 삼중 · 같은 areaRatio 1.055e-2 인데** dOW ≥ 500 에서
 * 그대로 붕괴해요. 실측 경첩은 «화면 삼각형 최장변 ≈ 1 px» 근처예요.
 */
test('★ 사다리 ②(화면 부분각) — areaRatio 상수인데 distanceOverWidth 만으로 붕괴해요', () => {
  const TRI = [0, 73, 510]; // 구현 보고가 「격자 최악」으로 고정한 삼중
  const P = TRI.map(worldOf);
  const run = dOW => {
    const pose = xCameraLookAt({ N, distanceOverWidth: dOW, azimuth: 0.4, elevation: 0.3 });
    const px = P.map(p => reprojectPx(pose.R, pose.t, p));
    assert.ok(px.every(q => q[2] > 0), `dOW=${dOW} 카메라 앞`);
    const sols = xP3P({ points: P, bearings: xBearingsFromPixels(px.map(q => [q[0], q[1]]), CAM) });
    let best = Infinity;
    for (const s of sols) best = Math.min(best, xRotationAngleDeg(s.R, pose.R));
    let longestPx = 0;
    for (const [i, k] of [[0, 1], [0, 2], [1, 2]]) longestPx = Math.max(longestPx, Math.hypot(px[i][0] - px[k][0], px[i][1] - px[k][1]));
    return { sols, d: sols.diagnostics, best, longestPx };
  };
  // ① areaRatio 가 dOW 에 **상수**라는 것부터 — 이게 이 자의 전제예요(축이 하나만 움직여요)
  const ratios = [3, 10, 30, 100, 200, 300, 500, 700, 1000, 3000, 10000].map(d => run(d).d.areaRatio);
  for (const r of ratios) assert.ok(Math.abs(r / ratios[0] - 1) < 1e-9, `areaRatio 가 dOW 에 움직였어요: ${ratios}`);
  // ② 사용 대역: 화면 최장변이 1 px 보다 크면 풀려요(관측 dOW=300 에서 1.2375 px · 2.149e-8 deg)
  for (const [dOW, tol] of [[3, 1e-9], [10, 1e-8], [30, 1e-7], [100, 1e-6], [200, 1e-5], [300, 1e-5]]) {
    const { sols, d, best, longestPx } = run(dOW);
    assert.equal(d.reason, 'ok', `dOW=${dOW} reason=${d.reason}`);
    assert.ok(sols.length >= 1);
    assert.ok(longestPx > 1, `dOW=${dOW} 화면 최장변 ${longestPx} px`);
    assert.ok(best < tol, `dOW=${dOW} 최량 ${best} deg ≥ ${tol}`);
  }
  // ③ 붕괴 대역: 같은 세계 형상인데 해 0. 「구조적으로 안 생긴다」가 아니에요.
  for (const dOW of [500, 700, 1000, 3000, 10000]) {
    const { sols, d, longestPx } = run(dOW);
    assert.equal(sols.length, 0, `dOW=${dOW} 붕괴 대역인데 해 ${sols.length} 개`);
    assert.ok(['ill-conditioned', 'no-real-root'].includes(d.reason), `dOW=${dOW} reason=${d.reason}`);
    assert.notEqual(d.reason, 'collinear-points', 'areaRatio 는 1.055e-2 라 퇴화선 근처도 아니에요');
    assert.ok(longestPx < 1, `dOW=${dOW} 화면 최장변 ${longestPx} px — 경첩이 1 px 근처라는 관측과 어긋나요`);
  }
  // ④ 붕괴를 가르는 건 부분각이에요 — 입체각이 단조 감소하고, 경첩이 사용/붕괴 사이에 있어요
  const okSA = run(300).d.bearingSolidAngle, badSA = run(500).d.bearingSolidAngle;
  assert.ok(badSA < okSA, `입체각이 단조가 아니에요 ${okSA} → ${badSA}`);
  assert.ok(okSA < 1e-8 && badSA < 1e-8, `관측: ok 쪽 8.655e-9 · 붕괴 쪽 3.118e-9 sr (${okSA} / ${badSA})`);
  // ⑤ minBearingSin 하나로는 못 갈라요(probe-b): 두 점이 같은 시선 앞뒤여도 잘 풀리는 경우가 있어요 —
  //    그래서 진단에 입체각을 따로 실어요. 여기선 최소한 두 지표가 **다른 값**이라는 것만 확인해요.
  assert.ok(run(300).d.minBearingSin > 0 && Math.abs(run(300).d.minBearingSin - okSA) > 1e-12);
});

/**
 * ★ LM 감쇠 정책 회귀 자(defect ① 의 자) — 「diverged 로 끝난 실행을 λ0 를 키워 재실행했을 때 더 낮은 cost 가
 * 나오면 실패」. 옛 구현(거부 3회 연속 상한)은 1215 회 중 13 회가 여기서 걸렸어요(λ0 1e-3→1e3 으로 rms 4.88e+1 →
 * 2.08e+0 px, 그중 12 회는 참 pose 회전오차까지 개선). 조건은 단계 ① 실측 p95 잡음 1.4 px · 8 점 · P3P 초기값이에요.
 */
test('★ xPoseLM 감쇠 회귀 자 — 1.4 px 잡음 + P3P 초기값 코퍼스에서 「λ0 를 키우면 회복되는 diverged」가 0 건', () => {
  const rnd = mulberry32(2718);
  const gauss = gaussOf(rnd);
  let runs = 0, diverged = 0, recoverable = 0;
  const witnesses = [];
  for (let k = 0; k < 250; k += 1) {
    const pose = randomPose(rnd);
    const ids = new Set(); while (ids.size < 8) ids.add(Math.floor(rnd() * N ** 3));
    const P = [...ids].map(worldOf);
    const px = P.map(p => reprojectPx(pose.R, pose.t, p));
    if (!px.every(q => q[2] > 0)) continue;
    const pixels = px.map(q => [q[0] + 1.4 * gauss(), q[1] + 1.4 * gauss()]);
    const sols = xP3P({ points: P.slice(0, 3), bearings: xBearingsFromPixels(pixels.slice(0, 3), CAM) });
    for (const s of sols) {
      runs += 1;
      const a = xPoseLM({ points: P, pixels, camera: CAM, R0: s.R, t0: s.t }, { maxIter: 100 });
      if (!a.reason.startsWith('diverged')) continue;
      diverged += 1;
      const b = xPoseLM({ points: P, pixels, camera: CAM, R0: s.R, t0: s.t }, { maxIter: 300, lambda: 1e3 });
      // cost 하한(1e-12)은 둘 다 기계 정밀도로 수렴한 경우를 「회복」으로 세지 않으려는 것이에요
      if (b.converged && b.cost < a.cost * 0.999 && a.cost > 1e-12) { recoverable += 1; witnesses.push({ rmsA: a.rmsPx, rmsB: b.rmsPx, reason: a.reason }); }
    }
  }
  assert.ok(runs > 400, `코퍼스가 너무 작아요(${runs} 회) — 자가 축을 못 지나요`);
  assert.equal(recoverable, 0, `λ0 를 키우면 회복되는 diverged ${recoverable}/${diverged} 건: ${JSON.stringify(witnesses.slice(0, 5))}`);
  // consecutiveFail 이 「종료 조건」이 아니라 「관측치」로만 남는지 — 4 회 이상 연속 거부하고도 수렴해야 해요
  const pose = xCameraLookAt({ N, azimuth: 0.4, elevation: 0.3 });
  const { points } = xProjectSites({ N, pose, camera: CAM });
  const many = [0, 7, 56, 63, 448, 455, 504, 511, 219, 300];
  const probe = xPoseLM({
    points: many.map(worldOf), pixels: pixelsOf(points, many), camera: CAM,
    R0: mat3Mul(xExpSO3([0, Math.PI, 0]), pose.R), t0: pose.t,
  }, { maxIter: 100 });
  assert.equal(probe.converged, true, probe.reason);
  assert.ok(Number.isInteger(probe.rejectedSteps) && probe.rejectedSteps > 3, `rejectedSteps=${probe.rejectedSteps}`);
  assert.ok(Number.isInteger(probe.maxConsecutiveRejects) && probe.maxConsecutiveRejects > 3, `maxConsecutiveRejects=${probe.maxConsecutiveRejects}`);
  assert.ok(probe.rmsPx < 1e-6, `rms ${probe.rmsPx}`);
});

function det(R) { return R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]); }
