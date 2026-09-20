import assert from 'node:assert/strict';
import test from 'node:test';
import { xSiteCoord } from '../src/x-layout.js';
import { X_CAMERA_MODEL, xCameraLookAt, xProjectSites, xRotation, mat3Mul, mat3Apply } from '../src/x-project.js';
import {
  xP3P, xP3PSelectCandidates, xBearingsFromPixels, xPoseLM, xRotationAngleDeg, xIsRotation, xExpSO3, xOrthonormalizeRotation,
  xPolyRealRoots,
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
  // 잡음 사다리 · 무작위 삼중(seed 777, 200 케이스/σ, dOW 2~4) — 해없음 / 중앙 deg / p90 deg / 평균 해 개수 / 오답 해 비율
  // σ=1.4(단계 ① 실측 p95)·2.62(① max) 칸은 2026-09-20 2차 수정본에서 추가(반박자 a4: 옛 사다리는 p95 의 1/3 에서 멈췄어요)
  randomTriples: {
    0: { noSol: 0, med: 3.901e-13, p90: 4.766e-12, meanSols: 2.085, wrongFrac: 0.5156 },
    0.05: { noSol: 0, med: 1.232e-1, p90: 4.897e-1, meanSols: 2.085, wrongFrac: 0.5180 },
    0.2: { noSol: 0, med: 4.888e-1, p90: 2.027e+0, meanSols: 2.055, wrongFrac: 0.5304 },
    0.5: { noSol: 0, med: 1.212e+0, p90: 5.275e+0, meanSols: 2.065, wrongFrac: 0.5690 },
    1.4: { noSol: 0, med: 3.482e+0, p90: 1.448e+1, meanSols: 2.025, wrongFrac: 0.6691 },
    2.62: { noSol: 0, med: 6.379e+0, p90: 2.203e+1, meanSols: 1.985, wrongFrac: 0.8035 },
  },
  // 잡음 사다리 · 캠페인 조건 팔(distanceOverWidth 3 고정 — 단계 ② 조건, seed 777, 200 케이스/σ, in-frame)
  campaignTriples: {
    0: { noSol: 0, med: 4.014e-13, p90: 2.150e-12, meanSols: 2.050, wrongFrac: 0.5073 },
    0.05: { noSol: 0, med: 1.089e-1, p90: 4.223e-1, meanSols: 2.040, wrongFrac: 0.5098 },
    0.2: { noSol: 0, med: 4.366e-1, p90: 1.694e+0, meanSols: 2.040, wrongFrac: 0.5172 },
    0.5: { noSol: 0, med: 1.088e+0, p90: 4.254e+0, meanSols: 2.040, wrongFrac: 0.5466 },
    1.4: { noSol: 0, med: 3.086e+0, p90: 1.070e+1, meanSols: 2.000, wrongFrac: 0.6325 },
    2.62: { noSol: 1, med: 5.620e+0, p90: 1.840e+1, meanSols: 1.990, wrongFrac: 0.7889 },
  },
  // 잡음 사다리 · 저 면적비 「격자 최악」 삼중(seed 3342109001, 600 케이스/σ, requireInFrame=false)
  worstTriples: {
    0: { noSol: 0, med: 1.272e-10, p90: 1.104e-9, meanSols: 1.992, wrongFrac: 0.4828 },
    0.05: { noSol: 34, med: 1.431e+0, p90: 5.550e+0, meanSols: 1.878, wrongFrac: 0.5501 },
    0.2: { noSol: 78, med: 5.179e+0, p90: 1.693e+1, meanSols: 1.732, wrongFrac: 0.7594 },
    0.5: { noSol: 117, med: 1.210e+1, p90: 3.350e+1, meanSols: 1.600, wrongFrac: 0.8979 },
  },
  // 잡음 사다리 · N=10(registry X1) 최악 삼중 [0,111,899] = [[-4.5,-4.5,-4.5],[-3.5,-3.5,-3.5],[3.5,4.5,4.5]] (면적비 6.2576e-3),
  // seed 3342109001 × 600, requireInFrame=false — 2026-09-20 3차 수정(반박자 b1 실측과 일치: 59/2.674/8.603 · 108/9.658/26.64 ·
  // 156/21.67/51.40 · wrongFrac 0.9368). N=8 최악삼중 대비 해없음 1.3~1.7×(59/34 · 108/78 · 156/117) · 중앙 1.8~1.9× 나쁨 —
  // «N=10 은 6.2576e-3 > 붕괴 문턱 1.5e-3» (σ=0 논거) 만으로는 안 덮이는 축이에요.
  worstTriples10: {
    0: { noSol: 0, med: 4.287e-10, p90: 4.059e-9, meanSols: 1.997, wrongFrac: 0.4808 },
    0.05: { noSol: 59, med: 2.674e+0, p90: 8.603e+0, meanSols: 1.800, wrongFrac: 0.6296 },
    0.2: { noSol: 108, med: 9.658e+0, p90: 2.664e+1, meanSols: 1.637, wrongFrac: 0.8574 },
    0.5: { noSol: 156, med: 2.167e+1, p90: 5.140e+1, meanSols: 1.477, wrongFrac: 0.9368 },
  },
  // 격자 최소 양수 면적비(|e12×e13|/최장변²) — N=8 은 이 파일의 자가 삼중 전수(22,238,720)로 매번 다시 유도해 단언해요.
  // N=10 은 전수(1.66e8)가 무거워 알려진 최악 삼중으로만 재요(반박자 probe-i 전수 2026-09-20: 6.2575821e-3).
  // 옛 주석의 1.1498e-2 는 어디서도 안 나오는 틀린 숫자였어요(반박자 a3·probe-i, 2026-09-20).
  gridMinAreaRatio: { 8: 1.05538e-2, 10: 6.2576e-3, collinearTriples8: 36992, triples8: 22238720 },
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
  // selfConsistency 는 잡음 축엔 무반응(무작위 삼중 σ 별 최대 rad; 같은 코퍼스 회전오차는 최대 ~1.8e+2 deg)이지만
  // **조건수 축에서는 움직여요** — 코퍼스별 상한을 갈라 잠가요(2026-09-20 2차 수정, 반박자 a7):
  //   무작위 삼중 < 1e-12 · 격자 최악 삼중 < 1e-11(관측 최대 3.470e-12 @σ=0.2) · 붕괴 대역 h=1e-8 > 1e-9(관측 2.089e-7)
  selfConsistencyMaxRad: { 0: 1.688e-14, 0.5: 2.193e-14, 1.4: 4.926e-14, 5: 3.167e-14 },
  selfConsistencyWorstTriplesMaxRad: { 0: 1.806e-12, 0.05: 1.200e-12, 0.2: 3.470e-12, 0.5: 5.681e-13 },
  selfConsistencyCollapseBand: { h: 1e-8, maxRad: 2.089e-7, bestRotDeg: 7.140e+1 },
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
  assert.equal(r3.demoted, 1);
  assert.deepEqual(r3.roots.map(v => Math.round(v * 1e12) / 1e12), [1, 2, 3]);
  assert.equal(xPolyRealRoots([1, NaN, 1]).degree, -1);
  assert.equal(xPolyRealRoots([1, NaN, 1]).converged, false);
  assert.equal(xPolyRealRoots([]).degree, -1);
  assert.equal(xPolyRealRoots([0, 0, 0]).degree, -1);
});

/** 복소 근 목록 → 실계수 다항(낮은 차수부터). 켤레쌍을 같이 넣어야 허수부가 상쇄돼요. */
function polyFromRoots(rs) {
  let p = [[1, 0]];
  for (const r of rs) {
    const q = new Array(p.length + 1).fill(0).map(() => [0, 0]);
    for (let i = 0; i < p.length; i += 1) {
      q[i + 1][0] += p[i][0]; q[i + 1][1] += p[i][1];
      q[i][0] += -(p[i][0] * r[0] - p[i][1] * r[1]); q[i][1] += -(p[i][0] * r[1] + p[i][1] * r[0]);
    }
    p = q;
  }
  return p.map(c => c[0]);
}
/** 근 목록이 기대 목록과 상대 1e-9 안에서 같은지(개수·순서 포함) */
function assertRootsClose(actual, expected, msg, rel = 1e-9) {
  assert.equal(actual.length, expected.length, `${msg}: 근 개수 ${actual.length} ≠ ${expected.length} (${JSON.stringify(actual)})`);
  for (let i = 0; i < expected.length; i += 1) assert.ok(Math.abs(actual[i] - expected[i]) <= rel * Math.max(1, Math.abs(expected[i])), `${msg}: 근[${i}] ${actual[i]} ≠ ${expected[i]}`);
}

/**
 * ★ 잔차 게이트의 스케일 자(2026-09-20 2차 수정, 반박자 a5·probe-d) — 「큰 근에서도 복소는 복소로 남는다」.
 * 옛 정규화 |p(x)| / (Σ|c_i|·max(1,|x|)ⁿ) 은 |x| 가 크면 분모가 |x|ⁿ 만큼 부풀어 근 1000±0.5i 의 복소 쌍을 «실근 1000»
 * 으로 받았어요(p(1000) = 2.4875e+5, converged=true). 기존 단위자는 근 크기가 전부 |r| ≤ 3 이라 이 축을 못 지났어요.
 * 여기서 재는 성질: ① |r| ≈ 1e2·1e3·1e4 복소 쌍이 실근으로 새지 않는다(반환 = 참 실근만, droppedComplex = 2)
 * ② 실근 0 인 큰 복소 4차식이 roots [] · droppedComplex 4 ③ 반환된 «실근» 은 전부 후방 오차 ≤ rootTol 인 진짜 근.
 */
test('★ xPolyRealRoots — 큰 근(|r| ≈ 1e2·1e3·1e4)에서도 복소는 복소로 남아요(잔차 게이트 스케일 자)', () => {
  const backErr = (c, x) => { let p = 0, den = 0, xi = 1; for (let i = 0; i < c.length; i += 1) { p += c[i] * xi; den += Math.abs(c[i]) * Math.abs(xi); xi *= x; } return Math.abs(p) / den; };
  // ⚠ 후방 오차 자의 지평: 켤레쌍 re±im·i 는 (im/re)² 급 상대 섭동으로 실축에 붙으니 (im/re)² ≲ rootTol(1e-10), 즉
  //    |Im|/|Re| ≲ 1e-5 인 쌍은 «수치적으로 실근» 이라 통과하는 게 맞아요(실측: 100±0.001i 는 통과). 여기 칸은 전부 그 위예요.
  for (const [re, im] of [[1e2, 0.05], [1e3, 0.5], [1e4, 1], [1e2, 1e-2], [1e3, 1e-1]]) {
    const coeffs = polyFromRoots([[re, im], [re, -im], [2, 0], [3, 0]]);
    const r = xPolyRealRoots(coeffs);
    assertRootsClose(r.roots, [2, 3], `근 ${re}±${im}i`);
    assert.equal(r.droppedComplex, 2, `근 ${re}±${im}i: droppedComplex ${r.droppedComplex}`);
    assert.ok(r.droppedComplexImag > im * 0.5, `근 ${re}±${im}i: 버린 |Im| ${r.droppedComplexImag}`);
    assert.equal(r.converged, true);
    for (const x of r.roots) assert.ok(backErr(coeffs, x) < 1e-12, `근 ${re}±${im}i: 반환 근 ${x} 의 후방 오차 ${backErr(coeffs, x)}`);
  }
  // 실근 0 인 큰 복소 4차식(반박자 probe-d 의 증인): 옛 자는 roots [1000, 2000] · converged true 를 냈어요
  const none = xPolyRealRoots(polyFromRoots([[1000, 100], [1000, -100], [2000, 200], [2000, -200]]));
  assert.deepEqual(none.roots, []);
  assert.equal(none.droppedComplex, 4);
  assert.equal(none.converged, true);
  assert.deepEqual(xPolyRealRoots(polyFromRoots([[0, 1000], [0, -1000], [0, 1], [0, -1]])).roots, []);
  // 대조군(작은 스케일): 옛 자도 맞게 버리던 케이스가 그대로 맞아요
  assertRootsClose(xPolyRealRoots(polyFromRoots([[1, 0.5], [1, -0.5], [2, 0], [3, 0]])).roots, [2, 3], '대조군 1±0.5i');
});

/**
 * ★ 차수 강등·균형화의 스케일 불변 자(2026-09-20 2차 수정, 반박자 probe-i) — 옛 «정규화 선행 계수 < 1e-14 면 pop» 은
 * v⁴ − 1e16(실근 ±1e4) 을 degree 0 · roots [] · converged **true** 로 조용히 뭉갰어요. 수학이 아니라 스케일이 답을
 * 바꿨어요(v⁴ − 1 은 정상). 여기서 재는 성질: 근 스케일 1e-9…1e8 에서 같은 모양의 다항식이 같은 근(스케일만 다른)을 내고,
 * 진짜 «무한대 근»(P3P a4→0)은 강등돼 `demoted` 로 보고돼요.
 * 2026-09-20 3차 수정(반박자 r1): **혼합 스케일** 칸을 더해요 — 2차 수정본의 균형화는 상한만 보고 v = s_hi·w 로 옮겨
 * O(1) 근 셋 + 큰 근 하나에서 참근을 잃었어요({0.5,1,2,1e8} 근 1.0 유실 · {0.5,1,2,1e9…1e12} [1e9] 만 반환 · converged false).
 * 이제 s_hi/s_lo ≤ 1e4 일 때만 균형화하니 이 칸은 rootScale 1(비균형 경로)로 4 근 전부 · converged true 여야 해요(옛 구현 통과).
 */
test('★ xPolyRealRoots — 강등·균형화는 스케일 불변(v⁴−1e16 · 근 1e-9…1e8 · a4→0 강등) + 혼합 스케일은 균형화하지 않아요', () => {
  const big = xPolyRealRoots([-1e16, 0, 0, 0, 1]);
  assertRootsClose(big.roots, [-1e4, 1e4], `v⁴−1e16 ${JSON.stringify(big)}`);
  assert.equal(big.degree, 4); assert.equal(big.demoted, 0); assert.equal(big.converged, true);
  assert.ok(big.rootScale > 1e3 && big.rootScale < 1e5, `rootScale ${big.rootScale}`);
  const one = xPolyRealRoots([-1, 0, 0, 0, 1]);
  assert.deepEqual(one.roots, [-1, 1]);
  assert.equal(one.rootScale, 1, '근이 O(1) 이면 균형화하지 않아요(DK 경로 바이트 동일)');
  for (const s of [1e-9, 1e-4, 1e-3, 1, 1e2, 1e3, 1e4, 1e8]) {
    const r = xPolyRealRoots(polyFromRoots([[s, 0], [2 * s, 0], [-3 * s, 0], [0.5 * s, 0]]));
    assert.equal(r.degree, 4, `스케일 ${s}: degree ${r.degree}`);
    assert.equal(r.converged, true, `스케일 ${s}: converged false`);
    assert.equal(r.roots.length, 4, `스케일 ${s}: 근 ${JSON.stringify(r.roots)}`);
    const rel = r.roots.map((v, i) => Math.abs(v / s - [-3, 0.5, 1, 2][i]));
    assert.ok(Math.max(...rel) < 1e-8, `스케일 ${s}: 상대 오차 ${JSON.stringify(rel)}`);
  }
  // 혼합 스케일(O(1) 근 셋 + 큰 근 하나 = P3P 의 A4→0 가지 모양): 균형화하지 않고 4 근 전부 · converged true (r1 회귀 칸)
  for (const big of [1e6, 1e8, 1e10, 1e12]) {
    const r = xPolyRealRoots(polyFromRoots([[0.5, 0], [1, 0], [2, 0], [big, 0]]));
    assert.equal(r.rootScale, 1, `혼합 {0.5,1,2,${big}}: 균형화가 발동했어요(rootScale ${r.rootScale}) — 혼합 스케일은 균형화하면 안 돼요`);
    assert.equal(r.converged, true, `혼합 {0.5,1,2,${big}}: converged false (${JSON.stringify(r)})`);
    assert.equal(r.droppedComplex, 0, `혼합 {0.5,1,2,${big}}: 실근이 복소로 버려졌어요 ${r.droppedComplex}`);
    assertRootsClose(r.roots, [0.5, 1, 2, big], `혼합 {0.5,1,2,${big}}`);
  }
  // 진짜 무한대 근: 선행항이 다른 근들의 스케일에서 기여하지 않으면 강등하고 demoted 로 보고해요(P3P a4→0 의 s1→0 가지)
  const inf = xPolyRealRoots([-6, 11, -6, 1, 1e-17]);
  assertRootsClose(inf.roots, [1, 2, 3], 'a4→0 강등');
  assert.equal(inf.degree, 3); assert.equal(inf.demoted, 1); assert.equal(inf.converged, true);
  // 정확한 0 근은 대수적으로 분리돼요(후방 오차 자는 0 근에서 0/0 이라 자로는 못 받아요)
  assert.deepEqual(xPolyRealRoots([0, -2, 1, 1]).roots, [-2, 0, 1]);
  assert.deepEqual(xPolyRealRoots([0, 0, 0, 1]).roots, [0]);
  const zeroAndHuge = xPolyRealRoots([0, 0, 0, 1, 1e-17]);
  assertRootsClose(zeroAndHuge.roots, [-1e17, 0], `0 근 + 무한대 근 ${JSON.stringify(zeroAndHuge)}`);
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
 * ★ 상쇄 대역 회귀 증인(2026-09-20 4차 수정, 반박자 m6·m6b·m5b) — denomEps **1e-6 이 모자랐던** 3 건을 상수로 박아요.
 * 3차 수정본의 기본 1e-6 은 정규화 minDenom(|D(v)| / (|2cosγ| + |2cosα·v| + 1)) 이 1e-6 위인 상쇄 대역을 유리식 가지만으로
 * 처리해, 캠페인 σ=0(seed 5150 · dOW 3 · in-frame) 300,000 호출 중 3 건에서 **reason 'ok' 인 채로** 참 pose 를 잃었어요
 * (10 ppm — 무작위 코퍼스로는 다음 리팩터링이 기본값을 되돌려도 안 빨개져요). 셋 다 {denomEps: 1e-4} 면 1e-10…1e-9 deg 로
 * 회복했고, 접선 대역(삼중 [309,485,441] az ±3e-4 rad 창 601 점)의 기본 상실 188 → 1e-4 에서 0 이었어요. 상수는 m6 캠페인
 * seed 5150 재생(f1-extract-witnesses) 으로 뽑았고 아래 자가 투영을 재확인해요.
 * 여기서 재는 성질(값·배치가 아니라 성질): ① 기본 opts 에서 reason 'ok' 이고 참 pose 회전오차 < 1e-6 deg
 * ② 같은 입력이 **{denomEps: 1e-6} 팔에서는 상실**(최량 ≥ 1e-2 deg, reason 은 그대로 'ok') — 이 양성 반례가 없으면
 * 「기본값이 1e-6 로 되돌아가도 ①이 다른 이유로 초록」인 상태를 못 가려요 ③ minDenom 이 (1e-6, 1e-4) 사이(이 증인이 그 대역의
 * 증인이라는 자기 검증) ④ 두 팔 모두 droppedOverflow 0.
 */
const DENOM_BAND_WITNESSES = [
  { // 캠페인 trial 7488 · minDenom 1.198e-5 · nearDoubleRoot 9.579e-3 · 기본(1e-6) 최량 1.027e+1 deg → 1e-4 에서 1.591e-10
    name: 'ids [89,384,103] (minDenom 1.198e-5)',
    P: [[-2.5, -0.5, -2.5], [2.5, -3.5, -3.5], [-2.5, 0.5, 3.5]],
    uv: [[211.97869994329267, 77.31299676632639], [253.3534881007452, 190.314932921496], [97.29295279827193, 90.63786571126982]],
    R: [-0.044450469095591694, -0.36810143043056437, -0.92872250576378,
      0.7806024725836489, -0.5929516191250325, 0.1976566648845829,
      -0.6234452145886403, -0.7161771528692988, 0.3136978643767749],
    t: [-8.881784197001252e-16, -1.9984014443252818e-15, 21.000000000000007],
    oldBestDeg: 1.027e+1,
  },
  { // 캠페인 trial 77310 · minDenom 4.803e-6 · nearDoubleRoot 1.702e-3 · 기본(1e-6) 최량 6.698e+0 deg → 1e-4 에서 3.429e-11
    name: 'ids [297,302,280] (minDenom 4.803e-6)',
    P: [[0.5, 1.5, -2.5], [0.5, 1.5, 2.5], [0.5, -0.5, -3.5]],
    uv: [[200.45627624432572, 78.36752003527496], [180.2966149173168, 178.26528600615984], [164.96730685755054, 51.54621493565817]],
    R: [0.037995917647585656, 0.9779700993523331, -0.2052578744284993,
      0.1411253280469904, 0.19809581352113, 0.9699699430647482,
      0.9892623272043403, -0.06582198294027145, -0.13048951887436547],
    t: [1.1102230246251565e-16, 4.440892098500626e-16, 21],
    oldBestDeg: 6.698e+0,
  },
  { // 캠페인 trial 293259 · minDenom 3.723e-5 · nearDoubleRoot 4.865e-7 · 기본(1e-6) 최량 1.572e-1 deg → 1e-4 에서 2.195e-9
    name: 'ids [365,479,287] (minDenom 3.723e-5)',
    P: [[1.5, 1.5, 1.5], [3.5, -0.5, 3.5], [0.5, -0.5, 3.5]],
    uv: [[195.2104000483019, 125.28184040846745], [249.32177571713066, 83.79628637188463], [192.51541332222254, 67.2331036312417]],
    R: [0.9403807440216401, -0.0568794028084642, 0.3353338482907134,
      0.2975265296142009, 0.6152985945685807, -0.7299901394523486,
      -0.16480904237643254, 0.7862393866107712, 0.595538081480002],
    t: [-8.881784197001252e-16, 0, 21],
    oldBestDeg: 1.572e-1,
  },
];

test('★ xP3P 상쇄 대역 회귀 증인 — minDenom (1e-6, 1e-4) 3 건: 기본 opts 는 참 pose(< 1e-6 deg) · {denomEps: 1e-6} 팔은 상실(≥ 1e-2 deg, 양성 반례)', () => {
  for (const w of DENOM_BAND_WITNESSES) {
    // 상수가 진짜 그 pose 의 투영인지부터 — 상수를 잘못 옮겼으면 여기서 빨개져요
    for (let i = 0; i < 3; i += 1) {
      const [u, v, Z] = reprojectPx(w.R, w.t, w.P[i]);
      assert.ok(Z > 0, `${w.name} 점 ${i} 가 카메라 앞`);
      assert.ok(Math.hypot(u - w.uv[i][0], v - w.uv[i][1]) < 1e-9, `${w.name} 점 ${i} 상수 불일치`);
    }
    const J = xBearingsFromPixels(w.uv, CAM);
    const bestOf = sols => { let b = Infinity; for (const s of sols) b = Math.min(b, xRotationAngleDeg(s.R, w.R)); return b; };
    // ① 기본 opts: ok + 참 pose 포함
    const base = xP3P({ points: w.P, bearings: J });
    assert.equal(base.diagnostics.reason, 'ok', `${w.name} 기본 ${JSON.stringify(base.diagnostics)}`);
    assert.ok(base.length >= 1 && base.length <= 4, `${w.name} 기본 해 ${base.length}`);
    const bestBase = bestOf(base);
    assert.ok(bestBase < 1e-6, `${w.name} 기본 최량 ${bestBase} deg ≥ 1e-6 (denomEps 1e-6 기본값은 ${w.oldBestDeg} deg 였어요)`);
    // ③ 이 증인이 그 대역의 증인인가 — minDenom 이 옛 문턱 위·새 문턱 아래
    assert.ok(base.diagnostics.minDenom > 1e-6 && base.diagnostics.minDenom < 1e-4, `${w.name} minDenom ${base.diagnostics.minDenom} 이 (1e-6, 1e-4) 밖 — 상쇄 대역 증인이 아니에요`);
    // ② 양성 반례: 옛 기본값 팔은 같은 입력에서 reason 'ok' 인 채로 참 pose 를 잃어요
    const old = xP3P({ points: w.P, bearings: J }, { denomEps: 1e-6 });
    assert.equal(old.diagnostics.reason, 'ok', `${w.name} {denomEps:1e-6} ${JSON.stringify(old.diagnostics)}`);
    const bestOld = bestOf(old);
    assert.ok(bestOld >= 1e-2, `${w.name} {denomEps:1e-6} 최량 ${bestOld} deg < 1e-2 — 양성 반례가 사라졌어요(이 증인은 더 이상 상쇄 대역을 재지 않아요)`);
    assert.ok(old.diagnostics.droppedResidual >= 1, `${w.name} {denomEps:1e-6} 은 잔차 게이트 탈락이 있어야 해요(유리식 가지만으로는 참 가지가 안 맞아요)`);
    // ④ 회계: 두 팔 모두 상한 넘침 없음
    assert.equal(base.diagnostics.droppedOverflow, 0, `${w.name} 기본 droppedOverflow`);
    assert.equal(old.diagnostics.droppedOverflow, 0, `${w.name} {denomEps:1e-6} droppedOverflow`);
  }
});

/**
 * ★ A4→0 대역 회귀 자(2026-09-20 3차 수정, 반박자 r3·r3c) — 격자 삼중 [0,54,10] 의 Grunert 선행계수 A4 = (K−1)² − 4cos²α·c²/b²
 * 는 카메라 방향을 따라 **연속으로 0 을 지나요**(cos α = |cos∠P1| 일 때). 2차 수정본의 균형화는 |A4|norm ≲ 1e-4 부터 발동했고
 * |A4|norm ≲ 4e-7 대역에서는 옛 구현이 참 pose 를 회복하던 입력을 'root-solver-not-converged' 로 0 개 거절했어요
 * (Δaz=5e-9 · 5e-10 · ±1e-10 · 0 — 단조도 아니라 2e-9·1e-9 는 통과, 5e-9·5e-10 은 실패). 무작위 코퍼스(r2 60,000 · r6 300,000)
 * 는 이 대역을 안 지나서 못 봤어요 — 연속 pose 경로는 반드시 지나요. 여기서 재는 성질: 그 대역 전부에서 reason 'ok' 이고
 * 참 pose 회전오차 < 1e-6 deg 이며(옛 구현 전부 통과) 근 solver 가 균형화 없이 수렴해요.
 */
test('★ xP3P A4→0 대역 — 삼중 [0,54,10] 의 선행계수 부호 변화 근방 Δaz ∈ {±1e-8, ±1e-9, ±1e-10, 0} 전부 ok · 회전오차 < 1e-6 deg', () => {
  const A4_ZERO_AZIMUTH = -2.285894124391; // 반박자 r3 이분법(el 0.2 · dOW 3 · roll 0.3) — 60 회 이분 뒤 값
  const TRI = [0, 54, 10], P = TRI.map(worldOf);
  // 코드와 같은 방식으로 4차식 선행계수를 재요(정규화 |A4| / max|c_i|) — «대역 안에 있다» 를 자 스스로 확인
  const polyMul = (p, q) => { const out = new Array(p.length + q.length - 1).fill(0); for (let i = 0; i < p.length; i += 1) for (let j = 0; j < q.length; j += 1) out[i + j] += p[i] * q[j]; return out; };
  const polyAdd = (p, q, kq = 1) => { const out = new Array(Math.max(p.length, q.length)).fill(0); for (let i = 0; i < p.length; i += 1) out[i] += p[i]; for (let i = 0; i < q.length; i += 1) out[i] += kq * q[i]; return out; };
  const normA4 = J => {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const a = Math.hypot(...sub(P[2], P[1])), b = Math.hypot(...sub(P[2], P[0])), c = Math.hypot(...sub(P[1], P[0]));
    const ca = dot(J[1], J[2]), cb = dot(J[0], J[2]), cg = dot(J[0], J[1]);
    const K = (a * a - c * c) / (b * b);
    const Nu = [K + 1, -2 * K * cb, K - 1], D = [2 * cg, -2 * ca], Q = [1, -2 * cb, 1], D2 = polyMul(D, D);
    let poly = polyAdd(D2, polyMul(Nu, Nu)); poly = polyAdd(poly, polyMul(Nu, D), -2 * cg); poly = polyAdd(poly, polyMul(Q, D2), -(c * c) / (b * b));
    return Math.abs(poly[4]) / Math.max(...poly.map(Math.abs));
  };
  let minA4 = Infinity, maxA4 = 0, worst = 0;
  for (const daz of [1e-8, -1e-8, 1e-9, -1e-9, 1e-10, -1e-10, 0]) {
    const pose = xCameraLookAt({ N, distanceOverWidth: 3, azimuth: A4_ZERO_AZIMUTH + daz, elevation: 0.2, roll: 0.3 });
    const px = P.map(p => reprojectPx(pose.R, pose.t, p));
    assert.ok(px.every(q => q[2] > 0), `Δaz=${daz} 카메라 앞`);
    const J = xBearingsFromPixels(px.map(q => [q[0], q[1]]), CAM);
    const a4 = normA4(J);
    minA4 = Math.min(minA4, a4); maxA4 = Math.max(maxA4, a4);
    const sols = xP3P({ points: P, bearings: J });
    const d = sols.diagnostics;
    assert.equal(d.reason, 'ok', `Δaz=${daz} |A4|norm=${a4.toExponential(3)} reason=${d.reason} (${JSON.stringify(d)})`);
    assert.equal(d.rootSolverConverged, true, `Δaz=${daz} 근 solver 미수렴`);
    assert.ok(sols.length >= 1, `Δaz=${daz} 해 ${sols.length}`);
    let best = Infinity;
    for (const s of sols) best = Math.min(best, xRotationAngleDeg(s.R, pose.R));
    worst = Math.max(worst, best);
    assert.ok(best < 1e-6, `Δaz=${daz} |A4|norm=${a4.toExponential(3)} 최량 회전오차 ${best} deg ≥ 1e-6 (옛 구현 ≤ 1.35e-11)`);
  }
  // «대역 안» 확인: 전 칸이 2차 수정본의 발동 문턱(≲1e-4) 밑이고 최소 칸은 실패 대역(≲4e-7) 안이에요(관측 3.848e-7 … 8.5e-14)
  assert.ok(maxA4 < 1e-5, `|A4|norm 최대 ${maxA4} — A4→0 대역이 아니에요(azimuth 상수를 확인하세요)`);
  assert.ok(minA4 < 4e-7, `|A4|norm 최소 ${minA4} — 실패 대역(≲4e-7)에 안 들어갔어요`);
  assert.ok(worst < 1e-9, `대역 전체 최악 회전오차 ${worst} deg (관측 ≤ 1.35e-11)`);
});

/**
 * ★ dedup 회귀 자(2026-09-20 3차 수정, 반박자 b4·b5) — DESIGN_006 §6.1-3(R5-14·15) «상대 1e-6 동치 dedup» 은 어느 자도 안 쟀어요:
 * dedup 을 통째로 꺼도(`if (rel <= 1e-6)` → `if (false)`) 26/26 초록이었어요. 죽은 코드가 아니라 기본 opts 에서도 발동하는
 * 경로예요(b5: σ=0 seed 4242 ×3000 중 해 개수가 달라지는 2 건 · denomEps 1 이면 2000 중 1923 건). 여기서 재는 성질:
 *   ① 반환 해 사이 depths 상대 거리 > 1e-6(중복 없음) ② {denomEps: 1}(두 가지를 항상 합집합) 팔의 해 집합(R·t 6 자리 키)이
 *   기본 opts 와 같음 ③ 길이 ≤ maxSolutions 이고 회계 candidates − droppedBehind − dedupMerged − droppedOverflow = 반환 해
 *   (4차 수정에서 뒤 필터가 dedup 앞으로 갔어요 — 옛 항등식 candidates − dedupMerged − droppedOverflow = 반환 해 + droppedBehind 는
 *   뒤 후보끼리의 병합을 dedupMerged 로 셌지만 지금은 droppedBehind 로 세요)
 *   ④ 고정 증인 2 건에서 dedupMerged ≥ 1(발동 증거) · 코퍼스에서 발동 건수 ≥ 2(관측 3).
 * ⚠ «같은 무리에서 대수 잔차가 작은 쪽이 대표로 남는다» 는 규칙 자체는 **미측정**이에요 — 후보 두 사본에 인위 섭동을 넣을
 *   외부 손잡이가 없어요. 이 자는 발동·무중복·집합 불변·회계까지만 잠가요.
 */
const DEDUP_WITNESSES = [
  { // σ=0 seed 4242 trial 453 — 유리식+2 차식 가지가 같이 들어와 후보 7 · 병합 5 (minDenom 7.63e-8, nearDoubleRoot 3.89e-7)
    name: 'trial 453 (후보 7 · 병합 5)',
    P: [[3.5, 1.5, -2.5], [0.5, 1.5, 2.5], [-3.5, 0.5, 3.5]],
    uv: [[77.01275288267549, 96.38142894102577], [180.68518420818305, 132.05787596224542], [258.4659133570433, 128.18152695695431]],
    R: [-0.8130313634855408, 0.0505251916321025, 0.5800234538356028, 0.38651543684806955, -0.6981920543073251, 0.6026057354359176, 0.4354145370414133, 0.7141253813670653, 0.5481232713727409],
    t: [0, 0, 21.12853481899947],
  },
  { // σ=0 seed 4242 trial 1883 — near-double root(1.32e-9)가 같은 해를 둘로 냈던 모양, 후보 3 · 병합 1
    name: 'trial 1883 (후보 3 · 병합 1)',
    P: [[3.5, 3.5, -0.5], [3.5, -0.5, 3.5], [2.5, 2.5, -0.5]],
    uv: [[254.90885007473184, 72.99345285260863], [150.83354446103942, 17.676156184231687], [228.24331833667395, 88.7169282913226]],
    R: [0.3118912402493866, 0.8979785897007488, -0.31041634411666175, -0.7444541122641074, 0.027967047728240248, -0.6670876396504631, -0.5903489891485877, 0.4391495151772579, 0.6772265310299207],
    t: [1.7763568394002505e-15, 0, 21.20015526376665],
  },
];

test('★ dedup — 고정 증인 2 건 + {denomEps 1} 팔: 무중복(상대 1e-6) · 해 집합 불변 · 회계(candidates − droppedBehind − dedupMerged − droppedOverflow) · 발동 ≥ 1', () => {
  // 6 자리 키 — |v| < 5e-7 은 0 으로 접어요(toFixed 가 −0.000000 을 내 같은 해가 다른 키로 갈리던 것)
  const keyOf = sols => sols.map(s => [...s.R, ...s.t].map(v => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6)).join(',')).sort().join('|');
  const checkNoDup = (sols, label) => {
    for (let i = 0; i < sols.length; i += 1) for (let k = i + 1; k < sols.length; k += 1) {
      const rel = Math.max(...[0, 1, 2].map(j => Math.abs(sols[i].depths[j] - sols[k].depths[j]) / Math.max(1e-300, Math.abs(sols[k].depths[j]))));
      assert.ok(rel > 1e-6, `${label} 해 ${i}·${k} depths 상대 거리 ${rel} ≤ 1e-6 — 중복이 남았어요`);
    }
  };
  const checkAccounting = (sols, label) => {
    const d = sols.diagnostics;
    assert.ok(Number.isInteger(d.candidates) && Number.isInteger(d.dedupMerged) && d.dedupMerged >= 0 && d.candidates >= d.dedupMerged, `${label} 회계 필드 ${JSON.stringify(d)}`);
    assert.ok(sols.length <= 4, `${label} 해 ${sols.length} > maxSolutions 4`);
    assert.equal(d.candidates - d.droppedBehind - d.dedupMerged - d.droppedOverflow, sols.length, `${label} 회계 불일치 ${JSON.stringify(d)}`);
  };
  for (const w of DEDUP_WITNESSES) {
    for (let i = 0; i < 3; i += 1) {
      const [u, v, Z] = reprojectPx(w.R, w.t, w.P[i]);
      assert.ok(Z > 0 && Math.hypot(u - w.uv[i][0], v - w.uv[i][1]) < 1e-9, `${w.name} 점 ${i} 상수 불일치`);
    }
    const J = xBearingsFromPixels(w.uv, CAM);
    const base = xP3P({ points: w.P, bearings: J });
    const union = xP3P({ points: w.P, bearings: J }, { denomEps: 1 });
    assert.equal(base.diagnostics.reason, 'ok', `${w.name} ${JSON.stringify(base.diagnostics)}`);
    assert.equal(union.diagnostics.reason, 'ok', `${w.name} denomEps 1 ${JSON.stringify(union.diagnostics)}`);
    // ④ 발동 증거: 기본 opts 에서도 병합이 실제로 일어나요(dedup 을 끄면 여기서 빨개져요)
    assert.ok(base.diagnostics.dedupMerged >= 1, `${w.name} 기본 opts 에서 dedupMerged ${base.diagnostics.dedupMerged} — dedup 이 발동하지 않았어요`);
    assert.ok(union.diagnostics.dedupMerged >= base.diagnostics.dedupMerged, `${w.name} denomEps 1 이 병합을 줄였어요`);
    // ① 무중복 ② 집합 불변 ③ 회계
    checkNoDup(base, w.name); checkNoDup(union, `${w.name} denomEps 1`);
    assert.equal(keyOf(union), keyOf(base), `${w.name} denomEps 1 팔의 해 집합이 기본과 달라요`);
    checkAccounting(base, w.name); checkAccounting(union, `${w.name} denomEps 1`);
    // 참 pose 가 두 팔 모두에 있어요
    assert.ok(Math.min(...base.map(s => xRotationAngleDeg(s.R, w.R))) < 1e-7, `${w.name} 기본 팔에 참 pose 없음`);
    assert.ok(Math.min(...union.map(s => xRotationAngleDeg(s.R, w.R))) < 1e-7, `${w.name} denomEps 1 팔에 참 pose 없음`);
  }
  // 코퍼스(★ 대표본 자와 같은 궤적, σ=0 seed 4242 ×3000): 기본 opts 발동 건수 ≥ 2(관측 3) · {denomEps 1} 은 전 건 무중복·집합 불변·회계
  const rnd = mulberry32(4242);
  let n = 0, fired = 0, unionFired = 0;
  while (n < 3000) {
    const pose = randomPose(rnd);
    const ids = new Set(); while (ids.size < 3) ids.add(Math.floor(rnd() * N ** 3));
    const P = [...ids].map(worldOf);
    const px = P.map(p => reprojectPx(pose.R, pose.t, p));
    if (!px.every(q => q[2] > 0)) continue;
    const J = xBearingsFromPixels(px.map(q => [q[0], q[1]]), CAM);
    const base = xP3P({ points: P, bearings: J });
    n += 1;
    if (base.diagnostics.reason !== 'ok') continue;
    if (base.diagnostics.dedupMerged > 0) fired += 1;
    checkNoDup(base, `코퍼스 #${n}`); checkAccounting(base, `코퍼스 #${n}`);
    if (n % 10 === 0) { // {denomEps 1} 팔은 10 건에 1 번(300 건) — 매 건 돌리면 시간만 2 배예요
      const union = xP3P({ points: P, bearings: J }, { denomEps: 1 });
      if (union.diagnostics.dedupMerged > 0) unionFired += 1;
      checkNoDup(union, `코퍼스 #${n} denomEps 1`); checkAccounting(union, `코퍼스 #${n} denomEps 1`);
      assert.equal(keyOf(union), keyOf(base), `코퍼스 #${n} denomEps 1 팔의 해 집합이 기본과 달라요`);
    }
  }
  assert.ok(fired >= 2, `기본 opts 에서 dedup 발동 ${fired}/${n} 건 — 관측 3 건(반박자 b5 는 해 개수가 달라지는 2 건)`);
  assert.ok(unionFired >= 250, `denomEps 1 팔에서 dedup 발동 ${unionFired}/300 — 두 가지 합집합이면 거의 매 건 병합돼야 해요(b5: 2000 중 1923)`);
});

/**
 * ★ 후처리 순서 회귀 자(2026-09-20 4차 수정, 외부 검토 agy C-1 blocking) — 옛 순서 «dedup → maxSolutions 절단(잔차 큰 쪽부터) → 뒤 필터»
 * 는 카메라 뒤 후보가 잔차가 작아 슬롯을 먼저 차지하면 **유효 실근을 droppedOverflow 로** 버렸어요(«유한 실근 전부 반환» 계약 위반).
 * 새 순서는 «뒤 필터(droppedBehind) → dedup(dedupMerged) → 절단(droppedOverflow)» 이고 정본은 xP3PSelectCandidates 예요.
 * 실측(f2, 작업 트리 vs 옛 순서 스냅샷): 기본 maxSolutions 4 에서는 두 순서의 해 집합·회계 필드가 캠페인 σ=0 100k · 무작위 σ=0 100k ·
 * σ 0.5/1.4 각 50k · seed 4242 3k 전 건 동일(droppedOverflow 0) — 그래서 어느 자도 못 봤어요. {maxSolutions: 1} 에서는 옛 순서가 기본에서
 * 해 ≥ 1 인 건 중 320/100k · 350/100k · 144/50k · 170/50k · 7/3000 을 빈 배열('all-behind-camera' + droppedOverflow 1) 로 냈고 새 순서는 0.
 * 여기서 재는 성질:
 *   (a) 인공 후보 목록(뒤 2 + 유효 4, 뒤 후보의 fn 이 더 작음)을 xP3PSelectCandidates 에 직접 넣으면 유효 4 전부 반환 · droppedBehind 2 ·
 *       droppedOverflow 0 · 회계 항등식. 실입력으로 «뒤 2 + 유효 4» 를 만들려면 상쇄 대역이 두 근에서 동시에 열려야 해 export 로 재요.
 *       자기 검증: 이 목록이 정말 옛 순서를 갈랐는가 — 뒤 후보 fn < 유효 후보 fn 전부 이고 유효 수 = maxSolutions 라 «절단이 뒤 필터보다
 *       먼저» 였다면 유효 ≥ 2 가 반드시 탈락해요.
 *   (b) 양성 반례(실입력 증인 2 건, seed 4242 재생 f3): 기본에서 해 1(참 pose) + 뒤 후보 1 인 입력에 {maxSolutions: 1} — 옛 순서는 빈 배열
 *       ('all-behind-camera' · droppedOverflow 1, f3 실측), 새 순서는 그 참 pose 1 개 · droppedOverflow 0.
 *   (c) 코퍼스 성질(seed 4242 ×3000, ★ dedup 자와 같은 궤적): 기본에서 해 ≥ 1 이면 {maxSolutions: 1} 은 정확히 1 · droppedBehind 불변 ·
 *       droppedOverflow = 기본 해 수 − 1. 정족수: 뒤 후보 ≥ 1 인 건 ≥ 5(관측 7) — 아니면 이 자는 그 경로를 안 지나요.
 *   (d) 뒤 후보끼리 근사 중복이면 dedupMerged 가 아니라 droppedBehind 로 2 세요(뒤 필터가 dedup 보다 먼저라는 회계).
 */
const ORDER_WITNESSES = [
  { // seed 4242 trial 1026 — 기본 해 1(5.794e-13 deg) · candidates 2 · droppedBehind 1 · 옛 순서 {maxSolutions:1} → 빈 배열
    name: 'ids [6,28,56]',
    P: [[-3.5, -3.5, 2.5], [-3.5, -0.5, 0.5], [-3.5, 3.5, -3.5]],
    uv: [[242.66061416694836, 115.31907254118693], [248.69853358084788, 132.46715758667887], [254.9115877487169, 215.23154690111159]],
    R: [-0.9732025075083124, 0.012898514575193126, 0.22958769065715776,
      -0.21838130567857347, -0.364537136533668, -0.9052194658854589,
      0.07201725286106571, -0.9310995136985023, 0.3575852498087105],
    t: [0, 0, 17.026100234594196],
  },
  { // seed 4242 trial 1435 — 기본 해 1(3.014e-13 deg) · candidates 2 · droppedBehind 1 · 옛 순서 {maxSolutions:1} → 빈 배열
    name: 'ids [463,405,313]',
    P: [[3.5, -2.5, 3.5], [2.5, -1.5, 1.5], [0.5, 3.5, -2.5]],
    uv: [[189.6717993628466, 9.89421584894258], [191.5570928076535, 63.86498925429098], [182.5432771743551, 143.23016583681715]],
    R: [0.8096396681612109, -0.15309707671687073, -0.566608235768377,
      -0.5839129353365076, -0.11239158848257913, -0.8039986410343403,
      0.05940784196137461, 0.9817990710624609, -0.18039205186033325],
    t: [4.440892098500626e-16, 0, 21.150423517916348],
  },
];

test('★ xP3P 후처리 순서 — 뒤 필터 → dedup → 절단: 인공 후보(뒤 2 + 유효 4) 전부 반환 · 실입력 증인 2 건 {maxSolutions:1} 이 참 pose · 코퍼스 «해 ≥1 ⇒ 정확히 1»', () => {
  const identity = (d, len, label) => assert.equal(d.candidates - d.droppedBehind - d.dedupMerged - d.droppedOverflow, len, `${label} 회계 불일치 ${JSON.stringify(d)}`);
  // (a) 인공 후보 목록 — J 는 카메라 앞(Z > 0) 방향 3
  const J = xBearingsFromPixels([[100, 100], [200, 120], [150, 200]], CAM);
  const valid = [
    { s: [10, 11, 12], fn: 1e-12 }, { s: [10, 12, 13], fn: 2e-12 }, { s: [11, 11, 12], fn: 3e-12 }, { s: [12, 13, 14], fn: 4e-12 },
  ];
  const behind = [{ s: [10, -11, 12], fn: 1e-16 }, { s: [10, 11, -12], fn: 2e-16 }];
  const maxValidFn = Math.max(...valid.map(c => c.fn));
  assert.ok(behind.every(c => c.fn < Math.min(...valid.map(v => v.fn))), '자기 검증: 뒤 후보의 fn 이 유효 후보 전부보다 작아야 옛 순서를 갈라요');
  assert.equal(valid.length, 4, '자기 검증: 유효 수 = maxSolutions 4 — 절단이 먼저였다면 유효 2 가 반드시 탈락해요');
  const diag = () => ({ candidates: 6, droppedBehind: 0, dedupMerged: 0, droppedOverflow: 0 });
  for (const order of [[...behind, ...valid], [...valid, ...behind], [valid[3], behind[0], valid[0], behind[1], valid[2], valid[1]]]) { // 입력 순서 무관
    const d = diag();
    const kept = xP3PSelectCandidates(order.map(c => ({ s: [...c.s], fn: c.fn })), J, 4, d);
    assert.equal(kept.length, 4, `유효 4 전부 반환이어야 해요: ${kept.length} ${JSON.stringify(d)}`);
    assert.equal(d.droppedBehind, 2); assert.equal(d.droppedOverflow, 0); assert.equal(d.dedupMerged, 0);
    identity(d, kept.length, '인공(뒤 2 + 유효 4)');
    assert.deepEqual(kept.map(c => c.s), [...valid].sort((x, y) => (x.s[0] - y.s[0]) || (x.s[1] - y.s[1]) || (x.s[2] - y.s[2])).map(c => c.s), 'depths 사전순으로 유효 4 그대로');
    assert.ok(kept.every(c => c.fn <= maxValidFn && c.s.every(v => v > 0)), '뒤 후보가 섞여 나오면 안 돼요');
  }
  { // 유효 5 + 뒤 2, maxSolutions 4 — 절단은 유효끼리만(잔차 큰 유효 1 이 overflow), 뒤 2 는 여전히 droppedBehind
    const d = diag(); d.candidates = 7;
    const extra = { s: [13, 14, 15], fn: 9e-12 };
    const kept = xP3PSelectCandidates([...behind, ...valid, extra].map(c => ({ s: [...c.s], fn: c.fn })), J, 4, d);
    assert.equal(kept.length, 4); assert.equal(d.droppedBehind, 2); assert.equal(d.droppedOverflow, 1); assert.equal(d.dedupMerged, 0);
    identity(d, kept.length, '인공(뒤 2 + 유효 5)');
    assert.ok(!kept.some(c => c.s[0] === 13), '잔차가 가장 큰 유효 후보가 overflow 로 빠져야 해요');
  }
  { // (d) 뒤 후보끼리 근사 중복(상대 1e-9) — dedupMerged 0 · droppedBehind 2 (뒤 필터가 dedup 앞)
    const d = diag(); d.candidates = 6;
    const dup = { s: [10 * (1 + 1e-9), -11, 12], fn: 5e-17 };
    const kept = xP3PSelectCandidates([behind[0], dup, ...valid].map(c => ({ s: [...c.s], fn: c.fn })), J, 4, d);
    assert.equal(kept.length, 4); assert.equal(d.droppedBehind, 2); assert.equal(d.dedupMerged, 0); assert.equal(d.droppedOverflow, 0);
    identity(d, kept.length, '인공(뒤 중복 2 + 유효 4)');
  }
  { // Z ≤ 0 축: 깊이는 양수인데 bearing z 가 음수면 뒤 — s > 0 만 보는 자는 이걸 놓쳐요
    const Jback = [J[0], J[1], [J[2][0], J[2][1], -J[2][2]]];
    const d = diag(); d.candidates = 4;
    const kept = xP3PSelectCandidates(valid.map(c => ({ s: [...c.s], fn: c.fn })), Jback, 4, d);
    assert.equal(kept.length, 0); assert.equal(d.droppedBehind, 4); identity(d, 0, '인공(Z ≤ 0)');
  }
  // (b) 실입력 증인 2 건 — 상수 투영 재확인 → 기본: 해 1(참 pose) + 뒤 1 → {maxSolutions:1}: 그 참 pose 1 개
  for (const w of ORDER_WITNESSES) {
    for (let i = 0; i < 3; i += 1) {
      const [u, v, Z] = reprojectPx(w.R, w.t, w.P[i]);
      assert.ok(Z > 0 && Math.hypot(u - w.uv[i][0], v - w.uv[i][1]) < 1e-9, `${w.name} 점 ${i} 상수 불일치`);
    }
    const Jw = xBearingsFromPixels(w.uv, CAM);
    const full = xP3P({ points: w.P, bearings: Jw });
    assert.equal(full.diagnostics.reason, 'ok', `${w.name} 기본 ${JSON.stringify(full.diagnostics)}`);
    assert.equal(full.length, 1, `${w.name} 기본 해 수 ${full.length} — 이 증인은 «앞 1 + 뒤 1» 이어야 해요`);
    assert.equal(full.diagnostics.droppedBehind, 1, `${w.name} ${JSON.stringify(full.diagnostics)}`);
    assert.ok(xRotationAngleDeg(full[0].R, w.R) < 1e-9, `${w.name} 기본 해가 참 pose 가 아니에요`);
    const one = xP3P({ points: w.P, bearings: Jw }, { maxSolutions: 1 });
    assert.equal(one.diagnostics.reason, 'ok', `${w.name} {maxSolutions:1} ${JSON.stringify(one.diagnostics)} — 옛 순서는 'all-behind-camera' + 빈 배열이었어요`);
    assert.equal(one.length, 1, `${w.name} {maxSolutions:1} 해 수 ${one.length}`);
    assert.equal(one.diagnostics.droppedOverflow, 0, `${w.name} {maxSolutions:1} overflow — 옛 순서는 1(뒤 후보가 슬롯을 차지)`);
    assert.equal(one.diagnostics.droppedBehind, 1);
    assert.ok(xRotationAngleDeg(one[0].R, w.R) < 1e-9, `${w.name} {maxSolutions:1} 이 참 pose 가 아니에요`);
    identity(one.diagnostics, 1, `${w.name} {maxSolutions:1}`);
  }
  // (c) 코퍼스 — ★ dedup 자와 같은 궤적(seed 4242 ×3000)
  const rnd = mulberry32(4242);
  let n = 0, behindCases = 0;
  while (n < 3000) {
    const pose = randomPose(rnd);
    const ids = new Set(); while (ids.size < 3) ids.add(Math.floor(rnd() * N ** 3));
    const P = [...ids].map(worldOf);
    const px = P.map(p => reprojectPx(pose.R, pose.t, p));
    if (!px.every(q => q[2] > 0)) continue;
    const Jc = xBearingsFromPixels(px.map(q => [q[0], q[1]]), CAM);
    const base = xP3P({ points: P, bearings: Jc });
    n += 1;
    if (base.diagnostics.reason !== 'ok' || base.length < 1) continue;
    identity(base.diagnostics, base.length, `코퍼스 #${n} 기본`);
    if (base.diagnostics.droppedBehind > 0) behindCases += 1;
    const one = xP3P({ points: P, bearings: Jc }, { maxSolutions: 1 });
    assert.equal(one.length, 1, `코퍼스 #${n} ids ${JSON.stringify([...ids])} {maxSolutions:1} 해 수 ${one.length} ${JSON.stringify(one.diagnostics)}`);
    assert.equal(one.diagnostics.reason, 'ok', `코퍼스 #${n}`);
    assert.equal(one.diagnostics.droppedBehind, base.diagnostics.droppedBehind, `코퍼스 #${n} 뒤 후보 수가 상한에 따라 달라졌어요`);
    assert.equal(one.diagnostics.droppedOverflow, base.length - 1, `코퍼스 #${n} overflow ${JSON.stringify(one.diagnostics)} vs 기본 해 ${base.length}`);
    identity(one.diagnostics, 1, `코퍼스 #${n} {maxSolutions:1}`);
  }
  assert.ok(behindCases >= 5, `뒤 후보 ≥ 1 인 건 ${behindCases}/${n} — 5 미만이면 이 자는 옛 순서의 경로를 안 지나요(관측 7)`);
});

/**
 * ★ 결함 ⑦ 의 자 — selfConsistency 는 **적합도가 아니에요**(잡음 축 무반응) 그러나 **조건수 축에서는 움직여요**.
 * 잡음을 0 → 5 px 로 올려도 값이 안 움직이는데 같은 코퍼스의 실제 회전오차는 100 deg 넘게 벌어져요 — 그러니 적합도로
 * 못 써요. 반면 조건수가 나빠지면 1e-14 → 1e-7 rad 까지 움직여요(반박자 a7, 2026-09-20): 옛 자는 무작위 삼중만 돌려
 * 「항등」을 확인했고 같은 파일의 WORST_TRIPLES 가 그 상한(1e-12)을 넘는 걸(3.470e-12 @σ=0.2) 못 봤어요. 그래서 상한을
 * **코퍼스별로** 갈라 잠가요: 무작위 1e-12 · 최악삼중 1e-11 · 붕괴대역(★사다리① h=1e-8) «1e-9 초과» 양성 단언.
 * 소비자 안내: 적합도는 rmsPx, 조건수 경보는 selfConsistency + bearingSolidAngle.
 */
test('★ selfConsistency — 잡음 축엔 무반응(σ 0…5 px), 조건수 축에서는 1e-14→1e-7 rad: 코퍼스별 상한', () => {
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
    // 성질 ①(무작위 삼중 팔): σ 와 무관하게 1e-12 rad 밑 (관측 최대 4.926e-14 @σ=1.4)
    assert.ok(worstSelf < 1e-12, `σ=${sigma} selfConsistency 최대 ${worstSelf} rad`);
    assert.ok(worstSelf < OBSERVED.selfConsistencyMaxRad[sigma] * 10, `σ=${sigma} 관측(${OBSERVED.selfConsistencyMaxRad[sigma]}) 대비 ${worstSelf}`);
  }
  // 성질 ②: 회전오차는 σ 를 따라 커지는데(적어도 σ=0 대비 σ=5 에서), selfConsistency 는 같은 자리에 있어요
  assert.ok(summary[5].worstRot > 10, `σ=5 회전오차 최대 ${summary[5].worstRot} deg`);
  const selfSpread = Math.max(...[0, 0.5, 1.4, 5].map(s => summary[s].worstSelf)) / Math.min(...[0, 0.5, 1.4, 5].map(s => summary[s].worstSelf));
  assert.ok(selfSpread < 100, `selfConsistency 가 σ 에 따라 ${selfSpread}× 움직였어요 — 이 자의 전제가 깨졌어요`);
  // 성질 ③(격자 최악 삼중 팔): 무작위 상한(1e-12)은 넘지만 1e-11 밑 — 「1e-12 는 함수의 성질이 아니라 코퍼스의 성질」
  let worstOverRandomBound = 0;
  for (const sigma of [0, 0.05, 0.2, 0.5]) {
    const rnd = mulberry32(3342109001);
    const gauss = gaussOf(rnd);
    let n = 0, worstSelf = 0;
    while (n < 600) {
      const pose = randomPose(rnd);
      for (const tri of WORST_TRIPLES) {
        if (n >= 600) break;
        const P = tri.map(worldOf);
        const px = P.map(p => reprojectPx(pose.R, pose.t, p));
        if (!px.every(q => q[2] > 0)) continue;
        const pixels = px.map(q => [q[0] + sigma * gauss(), q[1] + sigma * gauss()]);
        const sols = xP3P({ points: P, bearings: xBearingsFromPixels(pixels, CAM) });
        if (sols.diagnostics.reason === 'collinear-points') continue;
        n += 1;
        for (const s of sols) worstSelf = Math.max(worstSelf, s.selfConsistency);
      }
    }
    assert.ok(worstSelf < 1e-11, `최악삼중 σ=${sigma} selfConsistency 최대 ${worstSelf} rad ≥ 1e-11`);
    const o = OBSERVED.selfConsistencyWorstTriplesMaxRad[sigma];
    assert.ok(worstSelf < o * 10 && worstSelf > o / 10, `최악삼중 σ=${sigma} 관측(${o}) 대비 ${worstSelf}`);
    worstOverRandomBound = Math.max(worstOverRandomBound, worstSelf);
  }
  assert.ok(worstOverRandomBound > 1e-12, `최악삼중 코퍼스 최대 ${worstOverRandomBound} rad — 무작위 상한 1e-12 를 넘어야 «코퍼스별 상한» 이 뜻이 있어요`);
  // 성질 ④(붕괴 대역, ★사다리① 과 같은 기하): h=1e-8 의 「ok 인데 7.140e+1 deg 틀린」 해는 selfConsistency 가 1e-9 rad
  //   **위**예요 — 정상 대비 7 decade 위라 그 케이스를 가르는 신호예요(양성 단언). 사용 대역(h ≥ 1.5e-3)은 1e-12 밑.
  const pose = xCameraLookAt({ N, azimuth: 0.4, elevation: 0.3 });
  const selfAt = h => {
    const P = [[-0.5, 0, 0], [0.5, 0, 0], [0, h, 0]];
    const px = P.map(p => reprojectPx(pose.R, pose.t, p));
    const sols = xP3P({ points: P, bearings: xBearingsFromPixels(px.map(q => [q[0], q[1]]), CAM) });
    let best = Infinity;
    for (const s of sols) best = Math.min(best, xRotationAngleDeg(s.R, pose.R));
    return { sols, d: sols.diagnostics, best, maxSelf: Math.max(0, ...sols.map(s => s.selfConsistency)) };
  };
  for (const h of [1e-1, 1e-2, 1.5e-3]) {
    const r = selfAt(h);
    assert.equal(r.d.reason, 'ok');
    assert.ok(r.maxSelf < 1e-12, `h=${h} selfConsistency ${r.maxSelf}`);
  }
  const cb = OBSERVED.selfConsistencyCollapseBand;
  const collapse = selfAt(cb.h);
  assert.equal(collapse.d.reason, 'ok', `h=${cb.h} 는 «ok 인데 틀린» 칸이어야 해요: ${collapse.d.reason}`);
  assert.ok(collapse.best > 1e-2, `h=${cb.h} 최량 회전오차 ${collapse.best} deg — 붕괴 대역인데 정확해요(관측 ${cb.bestRotDeg})`);
  assert.ok(collapse.maxSelf > 1e-9, `h=${cb.h} selfConsistency ${collapse.maxSelf} rad ≤ 1e-9 — 조건수 경보가 안 떠요(관측 ${cb.maxRad})`);
  assert.ok(collapse.maxSelf < cb.maxRad * 10 && collapse.maxSelf > cb.maxRad / 10, `h=${cb.h} 관측(${cb.maxRad}) 대비 ${collapse.maxSelf}`);
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

/**
 * (h) 결정성(2026-09-20 2차 수정, 반박자 a2) — 옛 자는 같은 인자 객체로 순수 함수를 두 번 불러 JSON 동일을 봤고(어떤
 * 구현으로도 실패 불가), 정렬 단언은 해 2 개 fixture 라 1 회만 돌았어요. 이제 ① 해 **4 개** fixture(캠페인 조건 dOW 3 ·
 * σ=0 코퍼스에서 결정적으로 찾음)로 정렬 단언이 3 회 돌고, ② 대응 **라벨 순열 6 종**에 대해 해 집합이 같음을 단언하며,
 * ③ 인자 객체를 **새로 만들어** 호출해요(같은 객체면 캐싱 결함도 못 봐요).
 */
test('(h) 결정성 — 해 4 개 fixture 의 depths 사전순(3 회) · 라벨 순열 6 종 해 집합 동일 · 새 인자 객체 재호출 동일', () => {
  const rnd = mulberry32(99);
  // ① 해 4 개가 나오는 fixture 를 결정적으로 찾아요(a8: dOW 3 · σ=0 코퍼스의 100/3000 이 4 해)
  let fixture = null, tries = 0;
  while (!fixture && tries < 5000) {
    tries += 1;
    const pose = xCameraLookAt({ N, distanceOverWidth: 3, azimuth: (rnd() * 2 - 1) * Math.PI, elevation: (rnd() * 2 - 1) * 1.4, roll: (rnd() * 2 - 1) * Math.PI });
    const { points } = xProjectSites({ N, pose, camera: CAM });
    const { ids, P } = pick3(rnd);
    if (!ids.every(id => points[id].inFrame)) continue;
    const sols = xP3P({ points: P, bearings: xBearingsFromPixels(pixelsOf(points, ids), CAM) });
    if (sols.length === 4 && sols.diagnostics.reason === 'ok') fixture = { pose, points, ids, P };
  }
  assert.ok(fixture, `해 4 개 fixture 를 ${tries} 회 안에 못 찾았어요`);
  const { pose, points, ids, P } = fixture;
  const freshArgs = () => ({ points: P.map(p => [...p]), bearings: xBearingsFromPixels(pixelsOf(points, ids).map(q => [...q]), CAM) });
  const a = xP3P(freshArgs()), b = xP3P(freshArgs());
  assert.equal(a.length, 4);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a.diagnostics), JSON.stringify(b.diagnostics));
  let comparisons = 0;
  for (let i = 1; i < a.length; i += 1) { comparisons += 1; assert.ok(a[i - 1].depths[0] < a[i].depths[0], `depths 사전순 위반 ${i - 1}→${i}: ${a[i - 1].depths[0]} vs ${a[i].depths[0]}`); }
  assert.equal(comparisons, 3, '정렬 단언이 3 회 돌아야 해요');
  // ② 라벨 순열 6 종: 해 **집합**(R·t)이 같아요 — 순서는 depths 사전순이라 순열마다 달라도 돼요
  const keyOf = sols => sols.map(s => [...s.R, ...s.t].map(v => v.toFixed(6)).join(',')).sort().join('|');
  const baseKey = keyOf(a);
  for (const pm of [[0, 1, 2], [1, 0, 2], [2, 1, 0], [0, 2, 1], [1, 2, 0], [2, 0, 1]]) {
    const r = xP3P({ points: pm.map(i => [...P[i]]), bearings: xBearingsFromPixels(pm.map(i => [points[ids[i]].u, points[ids[i]].v]), CAM) });
    assert.equal(r.length, 4, `순열 ${pm} 해 ${r.length} 개`);
    assert.equal(keyOf(r), baseKey, `순열 ${pm} 해 집합이 달라요`);
    for (let i = 1; i < r.length; i += 1) assert.ok(r[i - 1].depths[0] <= r[i].depths[0], `순열 ${pm} depths 사전순`);
  }
  // 참 pose 가 4 해 중 하나
  assert.ok(Math.min(...a.map(s => xRotationAngleDeg(s.R, pose.R))) < 1e-7);
  // ③ LM 도 새 인자 객체로 두 번
  const many = [0, 7, 56, 63, 448, 455, 504, 511, 219, 300];
  const lmArgs = () => ({ points: many.map(worldOf), pixels: pixelsOf(points, many).map(q => [...q]), camera: { ...CAM }, R0: mat3Mul(xExpSO3([0.05, 0.03, 0.02]), pose.R), t0: pose.t.map(v => v + 0.3) });
  assert.equal(JSON.stringify(xPoseLM(lmArgs())), JSON.stringify(xPoseLM(lmArgs())));
});

/**
 * ★ opts 검증 자(2026-09-20 2차 수정, 반박자 a8) — 옛 구현은 maxSolutions −1 이 RangeError 로 호출자에게 샜고, 0 은
 * «no-valid-solution + droppedOverflow 2» 라는 오도하는 회계, NaN 은 상한이 조용히 꺼졌어요. 실패는 **던지지 않고**
 * 다른 거절과 같은 통로(빈 배열 + diagnostics.reason 'invalid-options')로 나가요.
 * 2026-09-20 3차 수정(반박자 b6): 비객체 opts('garbage' · 42 · 배열)와 비불리언 requireRootSolverConvergence 도 invalid-options 예요 —
 * 옛 구현은 조용히 기본값으로 삼켰어요. 그리고 **xPoseLM 도 같은 통로**로 검증해요(옛 구현은 무검증이라 {lambda:-1} 이 converged:true,
 * {tol:NaN} 이 'max-iterations', {maxStep:{rotRad:0}} 이 'diverged(…)' 로 오귀속됐어요). 통로 규칙은 src 파일 머리 §오류 통로.
 */
test('★ opts 검증 — xP3P·xPoseLM 같은 통로: 값 범위 밖은 던지지 않고 reason invalid-options, 형식(camera·컨테이너)은 throw', () => {
  const pose = xCameraLookAt({ N, azimuth: 0.4, elevation: 0.3 });
  const { points } = xProjectSites({ N, pose, camera: CAM });
  const ids = [0, 7, 511], P = ids.map(worldOf);
  const J = xBearingsFromPixels(pixelsOf(points, ids), CAM);
  const bad = [
    { maxSolutions: 0 }, { maxSolutions: -1 }, { maxSolutions: 1.5 }, { maxSolutions: NaN }, { maxSolutions: Infinity }, { maxSolutions: '4' },
    { eps: 0 }, { eps: -1e-12 }, { eps: NaN }, { eps: Infinity }, { imagTol: 0 }, { imagTol: 'x' }, { residualTol: -1 },
    { denomEps: NaN }, { rootTol: 0 }, { rootTol: null },
    'garbage', 42, [], { requireRootSolverConvergence: 'yes' }, { requireRootSolverConvergence: 1 },
  ];
  for (const opts of bad) {
    let r;
    assert.doesNotThrow(() => { r = xP3P({ points: P, bearings: J }, opts); }, `${JSON.stringify(opts)} 가 던졌어요`);
    assert.equal(r.length, 0, `${JSON.stringify(opts)} 해 ${r.length}`);
    assert.equal(r.diagnostics.reason, 'invalid-options', `${JSON.stringify(opts)} reason=${r.diagnostics.reason}`);
    assert.equal(r.diagnostics.droppedOverflow, 0);
    assert.equal(r.diagnostics.quarticDegree, -1, '검증 실패는 근 solver 에 닿기 전이에요');
  }
  // 유효한 경계값: maxSolutions 1 은 상한으로 실제로 작동해요 — 카메라 앞 후보 중에서만(4차 수정 순서: 뒤 필터 → dedup → 절단).
  // 옛 자는 droppedOverflow = full.length + droppedBehind − 1 을 기대했는데 그게 바로 «뒤 후보가 슬롯을 차지하는» 옛 순서의 회계였어요.
  const full = xP3P({ points: P, bearings: J });
  const one = xP3P({ points: P, bearings: J }, { maxSolutions: 1 });
  assert.equal(one.diagnostics.reason, 'ok');
  assert.equal(one.length, Math.min(1, full.length), JSON.stringify(one.diagnostics));
  assert.equal(one.diagnostics.droppedBehind, full.diagnostics.droppedBehind, '뒤 후보 수는 상한과 무관해요');
  assert.equal(one.diagnostics.droppedOverflow, Math.max(0, full.length - 1), JSON.stringify(one.diagnostics));
  assert.equal(xP3P({ points: P, bearings: J }, undefined).diagnostics.reason, 'ok');
  assert.equal(xP3P({ points: P, bearings: J }, null).diagnostics.reason, 'ok');
  assert.equal(xP3P({ points: P, bearings: J }, { eps: 1e-12, imagTol: 1e-6, residualTol: 1e-9, denomEps: 1e-6, rootTol: 1e-10, maxSolutions: 4 }).diagnostics.reason, 'ok');
  assert.equal(xP3P({ points: P, bearings: J }, { requireRootSolverConvergence: false }).diagnostics.reason, 'ok');
  // ── xPoseLM: 같은 통로(reason 'invalid-options' · R0/t0 그대로 · rmsPx NaN · converged false · iterations 0), 던지지 않아요
  const many = [0, 7, 56, 63, 448, 455, 504, 511, 219, 300];
  const lmIn = () => ({ points: many.map(worldOf), pixels: pixelsOf(points, many), camera: CAM, R0: pose.R, t0: pose.t.map(v => v + 0.3) });
  const badLM = [
    { maxIter: -1 }, { maxIter: 0 }, { maxIter: 1.5 }, { maxIter: NaN }, { maxIter: '20' }, { lambda: NaN }, { lambda: -1 }, { lambda: 0 }, { lambda: Infinity },
    { lambdaMax: NaN }, { lambdaMax: 0 }, { tol: NaN }, { tol: -1 }, { tol: 0 }, { rankTol: NaN }, { rankTol: -1e-10 },
    { maxStep: { rotRad: NaN } }, { maxStep: { rotRad: 0 } }, { maxStep: { trans: -1 } }, { maxStep: { trans: Infinity } }, { maxStep: 0.5 }, { maxStep: [0.5, 1] },
    'garbage', 42, [],
  ];
  for (const opts of badLM) {
    let r;
    assert.doesNotThrow(() => { r = xPoseLM(lmIn(), opts); }, `xPoseLM ${JSON.stringify(opts)} 가 던졌어요`);
    assert.equal(r.reason, 'invalid-options', `xPoseLM ${JSON.stringify(opts)} reason=${r.reason}`);
    assert.equal(r.converged, false, `xPoseLM ${JSON.stringify(opts)} converged=${r.converged}`);
    assert.equal(r.iterations, 0);
    assert.ok(Number.isNaN(r.rmsPx) && Number.isNaN(r.cost), `xPoseLM ${JSON.stringify(opts)} rmsPx=${r.rmsPx}`);
    assert.deepEqual(r.R, pose.R, '초기값 R0 그대로'); assert.deepEqual(r.t, pose.t.map(v => v + 0.3), '초기값 t0 그대로');
  }
  // 유효한 경계·부분 지정은 그대로 돌아요(undefined 는 기본값, null/undefined opts 도 기본값)
  for (const opts of [undefined, null, {}, { maxIter: 1 }, { lambda: 1e-12 }, { maxStep: {} }, { maxStep: { rotRad: 0.5 } }, { maxStep: { trans: 1 } }, { maxIter: undefined, tol: undefined }]) {
    const r = xPoseLM(lmIn(), opts);
    assert.notEqual(r.reason, 'invalid-options', `xPoseLM ${JSON.stringify(opts)} 가 유효한데 invalid-options`);
    assert.ok(['converged', 'step-below-tol', 'max-iterations', 'cost-zero'].includes(r.reason), `xPoseLM ${JSON.stringify(opts)} reason=${r.reason}`);
  }
  // 통로 규칙의 다른 쪽: 형식(camera · 컨테이너)은 여전히 throw — 프로그래머 오류 통로(파일 머리 §오류 통로)
  assert.throws(() => xPoseLM({ ...lmIn(), camera: { ...CAM, fx: 0 } }), RangeError);
  assert.throws(() => xPoseLM({ ...lmIn(), pixels: pixelsOf(points, many).slice(1) }), TypeError);
  assert.throws(() => xBearingsFromPixels([[1, 2]], { ...CAM, model: 'x' }), RangeError);
});

/**
 * ★ (a′) 규약 왕복 자(2026-09-20 2차 수정, 반박자 a1) — 이 파일의 다른 자는 손수 만든 reprojectPx 로 재투영해서 「같은
 * 부호 오류를 공유하는 자」 위험이 있었고, registry 유효 쌍 N10/X1 과 pitch ≠ 1 은 한 번도 안 나왔어요. 여기서는
 * **x-project 의 xProjectSites 로만** 왕복해요: 정투영 → P3P → 복원 pose 를 xProjectSites 에 그대로 먹여 in-frame
 * 전 사이트를 비교. 대조군으로 Rᵀ 를 넣으면 전 케이스에서 더 나빠야 해요(규약이 실제로 구별되는가).
 * 관측(반박자 a1, 200 케이스/팔): N=8/1 최악 5.382e-11 deg · 2.209e-10 px, N=10/1 1.094e-10 · 3.112e-10, N=8/2.5 9.352e-11 · 3.587e-10.
 * N=10/2.5 팔은 2026-09-20 3차 수정에서 추가(반박자 b1: seed 20260920 최악 2.893e-11 deg · 7.779e-11 px · Rᵀ 열세 200/200) —
 * 여기서는 N=10/1 과 같은 seed 라 «pitch 만 바꾼 같은 궤적» 이에요.
 */
test('★ (a′) xProjectSites 로만 왕복 — N=8 pitch 1 · N=10 pitch 1 (X1) · N=8 pitch 2.5 · N=10 pitch 2.5, 전 사이트 재투영 + Rᵀ 대조군', () => {
  for (const [Nn, pitch] of [[8, 1], [10, 1], [8, 2.5], [10, 2.5]]) {
    const rnd = mulberry32(12345 + Nn);
    const half = (Nn - 1) / 2;
    let cases = 0, worstRot = 0, worstReproj = 0, transposeWorse = 0;
    while (cases < 200) {
      const pose = xCameraLookAt({ N: Nn, pitch, distanceOverWidth: 2 + 2 * rnd(), azimuth: (rnd() * 2 - 1) * Math.PI, elevation: (rnd() * 2 - 1) * 1.4, roll: (rnd() * 2 - 1) * Math.PI });
      const truth = xProjectSites({ N: Nn, pitch, pose, camera: CAM });
      const ids = [];
      let guard = 0;
      while (ids.length < 3 && guard < 500) { guard += 1; const id = Math.floor(rnd() * Nn ** 3); if (!ids.includes(id) && truth.points[id].inFrame) ids.push(id); }
      if (ids.length < 3) continue;
      const P = ids.map(id => xSiteCoord(Nn, id).map(s => pitch * (s - half)));
      if (collinear(P)) continue;
      const sols = xP3P({ points: P, bearings: xBearingsFromPixels(ids.map(id => [truth.points[id].u, truth.points[id].v]), CAM) });
      if (sols.diagnostics.reason !== 'ok') continue;
      cases += 1;
      let bestRot = Infinity, best = null;
      for (const s of sols) { const r = xRotationAngleDeg(s.R, pose.R); if (r < bestRot) { bestRot = r; best = s; } }
      worstRot = Math.max(worstRot, bestRot);
      const rec = xProjectSites({ N: Nn, pitch, pose: { R: best.R, t: best.t }, camera: CAM });
      let m = 0;
      for (let id = 0; id < Nn ** 3; id += 1) if (truth.points[id].inFrame) m = Math.max(m, Math.hypot(rec.points[id].u - truth.points[id].u, rec.points[id].v - truth.points[id].v));
      worstReproj = Math.max(worstReproj, m);
      const Rt = [best.R[0], best.R[3], best.R[6], best.R[1], best.R[4], best.R[7], best.R[2], best.R[5], best.R[8]];
      const recT = xProjectSites({ N: Nn, pitch, pose: { R: Rt, t: best.t }, camera: CAM });
      let mT = 0;
      for (let id = 0; id < Nn ** 3; id += 1) if (truth.points[id].inFrame && Number.isFinite(recT.points[id].u)) mT = Math.max(mT, Math.hypot(recT.points[id].u - truth.points[id].u, recT.points[id].v - truth.points[id].v));
      if (mT > m) transposeWorse += 1;
    }
    assert.equal(cases, 200);
    assert.ok(worstRot < 1e-8, `N=${Nn} pitch=${pitch} 최악 회전오차 ${worstRot} deg`);
    assert.ok(worstReproj < 1e-7, `N=${Nn} pitch=${pitch} 전 사이트 재투영 최악 ${worstReproj} px`);
    assert.equal(transposeWorse, 200, `N=${Nn} pitch=${pitch} Rᵀ 대조군이 더 나쁜 경우 ${transposeWorse}/200 — 규약이 구별되지 않아요`);
  }
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
 * distanceOverWidth 를 주면 그 값 고정(단계 ② 캠페인 조건 팔), 아니면 randomPose(dOW 2~4).
 * gridN(기본 8)으로 격자를 바꿔요(N=10 팔, 2026-09-20 3차 수정 — 반박자 b1: 옛 사다리 3 종은 전부 N=8 고정이었어요). 세계 좌표는
 * pitch 1 의 xSiteCoord(gridN) − (gridN−1)/2, pose 는 같은 gridN 의 xCameraLookAt — rnd 소비 순서는 randomPose 와 같아요.
 * 해 개수 회계(2026-09-20 2차 수정, 반박자 a8): 최량 해만 보지 않고 **호출당 해 개수 합·분포**와 「참 pose 가 아닌 해」
 * (회전오차 > 5 deg) 수를 같이 돌려줘요 — 단계 ② 예산식의 «호출당 후속 검증 건수» 입력이에요.
 * @returns {{n:number, noSol:number, med:number, p90:number, worst:number, reasons:Map,
 *   solCount:number, meanSols:number, wrongSols:number, wrongFrac:number, solHist:number[]}}
 */
function noiseLadderRung({ sigma, seed, cases, triples = null, requireInFrame = true, opts = {}, distanceOverWidth = null, gridN = N }) {
  const gridHalf = (gridN - 1) / 2, siteOf = id => xSiteCoord(gridN, id).map(s => s - gridHalf);
  const rnd = mulberry32(seed);
  const gauss = gaussOf(rnd);
  const rots = []; const reasons = new Map();
  let noSol = 0, n = 0, solCount = 0, wrongSols = 0;
  const solHist = [0, 0, 0, 0, 0];
  while (n < cases) {
    const pose = xCameraLookAt({
      N: gridN, distanceOverWidth: distanceOverWidth ?? (2 + 2 * rnd()), azimuth: (rnd() * 2 - 1) * Math.PI, elevation: (rnd() * 2 - 1) * 1.4, roll: (rnd() * 2 - 1) * Math.PI,
    });
    const tris = triples ?? [(() => { const s = new Set(); while (s.size < 3) s.add(Math.floor(rnd() * gridN ** 3)); return [...s]; })()];
    for (const tri of tris) {
      if (n >= cases) break;
      const P = tri.map(siteOf);
      const px = P.map(p => reprojectPx(pose.R, pose.t, p));
      if (!px.every(q => q[2] > 0)) continue;
      if (requireInFrame && !px.every(q => q[0] >= 0 && q[0] < CAM.width && q[1] >= 0 && q[1] < CAM.height)) continue;
      const pixels = px.map(q => [q[0] + sigma * gauss(), q[1] + sigma * gauss()]);
      const sols = xP3P({ points: P, bearings: xBearingsFromPixels(pixels, CAM) }, opts);
      if (sols.diagnostics.reason === 'collinear-points') continue; // 잡음 축이 아니라 퇴화 — 사다리에서 제외
      n += 1;
      reasons.set(sols.diagnostics.reason, (reasons.get(sols.diagnostics.reason) || 0) + 1);
      solCount += sols.length; solHist[Math.min(4, sols.length)] += 1;
      if (!sols.length) { noSol += 1; continue; }
      let best = Infinity;
      for (const s of sols) {
        const rot = xRotationAngleDeg(s.R, pose.R);
        if (rot > 5) wrongSols += 1;
        best = Math.min(best, rot);
      }
      rots.push(best);
    }
  }
  return {
    n, noSol, med: quant(rots, 0.5), p90: quant(rots, 0.9), worst: Math.max(...rots), reasons,
    solCount, meanSols: solCount / n, wrongSols, wrongFrac: wrongSols / Math.max(1, solCount), solHist,
  };
}

/** 사다리 칸의 해 개수 회계 성질(반박자 a8) — 평균 ≈2 해/호출, 그 40 % 이상이 참 pose 가 아님 → 단계 ② 의 후속 검증 부담 */
function assertSolutionAccounting(r, o, label) {
  // 분포(0/1/2/3/4)의 가중합 = 해 개수 합 (보존 상한 4 라 «4 이상» 칸은 정확히 4)
  assert.equal(r.solCount, r.solHist.reduce((acc, c, k) => acc + c * k, 0), `${label} 해 개수 합·분포 불일치`);
  assert.equal(r.solHist.reduce((acc, c) => acc + c, 0), r.n, `${label} 분포 합 ≠ 호출 수`);
  assert.ok(r.meanSols > 1.5 && r.meanSols < 2.5, `${label} 평균 해 개수 ${r.meanSols.toFixed(3)} — ≈2 가 아니에요(분포 ${r.solHist.join('/')})`);
  assert.ok(r.wrongFrac > 0.4 && r.wrongFrac <= 0.9, `${label} 오답 해 비율 ${(100 * r.wrongFrac).toFixed(1)} % — 절반 안팎이어야 해요(${r.wrongSols}/${r.solCount})`);
  assert.ok(Math.abs(r.meanSols / o.meanSols - 1) < 0.05, `${label} 평균 해 ${r.meanSols} vs 정본 ${o.meanSols}`);
  assert.ok(Math.abs(r.wrongFrac / o.wrongFrac - 1) < 0.05, `${label} 오답 비율 ${r.wrongFrac} vs 정본 ${o.wrongFrac}`);
}

/**
 * ★ 잡음 체제 사다리 — 이 파일에서 **유일하게 solver 정확도를 주장하는 자**예요.
 * (a)(b)(i) 의 1e-7 deg 는 σ=0 기계 정밀도라 정확도 주장이 아니에요.
 * 단일 최악값이 아니라 중앙·p90 + 정족수 하한으로 재요(「한 점은 계약이 아니다」).
 * 임계값은 전부 2026-09-20 실측에서 여유를 두고 정했어요(아래 관측표) — 지어낸 수치 없음.
 * 2026-09-20 2차 수정(반박자 a4): 옛 사다리는 σ ≤ 0.5 px 에서 멈춰 단계 ① 실측 검출 오차(median .097 · p95 1.40 ·
 * max 2.62 px)의 1/3 까지만 덮었어요. σ=1.4(p95)·2.62(max) 칸과 **캠페인 조건 팔**(distanceOverWidth 3 고정 —
 * randomPose 는 dOW 2~4 라 단계 ② 조건과 다른 분포)을 더해요. 칸마다 해 개수 회계(평균 ≈2 · 오답 ≥40 %)도 단언해요.
 */
test('★ P3P 잡음 사다리 — σ ∈ {0, 0.05, 0.2, 0.5, 1.4, 2.62} px × 200: 무작위(dOW 2~4)·캠페인(dOW 3) 두 팔', () => {
  // 관측 정본은 OBSERVED.randomTriples · campaignTriples (이 파일 상단) — 여기 표를 또 적지 않아요.
  const SIGMAS = [0, 0.05, 0.2, 0.5, 1.4, 2.62];
  const bounds = {
    random: {
      0: { noSol: 0, med: 1e-9, p90: 1e-8 },      // σ=0 은 기계 정밀도 칸(사다리의 「아무것도 안 함」 끝)
      0.05: { noSol: 0, med: 0.3, p90: 1.0 },
      0.2: { noSol: 2, med: 1.0, p90: 4.0 },
      0.5: { noSol: 4, med: 2.5, p90: 10.0 },
      1.4: { noSol: 6, med: 6.0, p90: 25.0 },     // 관측 0 / 3.482e+0 / 1.448e+1
      2.62: { noSol: 10, med: 11.0, p90: 40.0 },  // 관측 0 / 6.379e+0 / 2.203e+1
    },
    campaign: {
      0: { noSol: 0, med: 1e-9, p90: 1e-8 },
      0.05: { noSol: 0, med: 0.3, p90: 1.0 },
      0.2: { noSol: 2, med: 1.0, p90: 4.0 },
      0.5: { noSol: 4, med: 2.5, p90: 10.0 },
      1.4: { noSol: 6, med: 6.0, p90: 20.0 },     // 관측 0 / 3.086e+0 / 1.070e+1
      2.62: { noSol: 10, med: 11.0, p90: 35.0 },  // 관측 1 / 5.620e+0 / 1.840e+1
    },
  };
  const got = { random: {}, campaign: {} };
  for (const arm of ['random', 'campaign']) {
    for (const sigma of SIGMAS) {
      const r = noiseLadderRung({ sigma, seed: 777, cases: 200, distanceOverWidth: arm === 'campaign' ? 3 : null });
      got[arm][sigma] = r;
      const b = bounds[arm][sigma];
      assert.equal(r.n, 200);
      assert.ok(r.noSol <= b.noSol, `${arm} σ=${sigma} 해없음 ${r.noSol} > 정족수 ${b.noSol} (${JSON.stringify([...r.reasons])})`);
      assert.ok(r.med < b.med, `${arm} σ=${sigma} 중앙 ${r.med} deg ≥ ${b.med}`);
      assert.ok(r.p90 < b.p90, `${arm} σ=${sigma} p90 ${r.p90} deg ≥ ${b.p90}`);
      // 정본 상수와의 대조 — OBSERVED 가 썩으면 여기가 빨개져요(머리 주석이 이 상수를 가리켜요)
      const o = (arm === 'random' ? OBSERVED.randomTriples : OBSERVED.campaignTriples)[sigma];
      assert.equal(r.noSol, o.noSol, `${arm} σ=${sigma} 해없음 ${r.noSol} ≠ 정본 ${o.noSol}`);
      assert.ok(Math.abs(r.med / o.med - 1) < 0.05, `${arm} σ=${sigma} 중앙 ${r.med} vs 정본 ${o.med}`);
      assert.ok(Math.abs(r.p90 / o.p90 - 1) < 0.05, `${arm} σ=${sigma} p90 ${r.p90} vs 정본 ${o.p90}`);
      assertSolutionAccounting(r, o, `${arm} σ=${sigma}`);
    }
    // 성질(값이 아니라): 잡음이 커지면 오차도 커져요 — 단조성이 깨지면 자가 엉뚱한 축을 재고 있는 거예요
    for (let i = 1; i < SIGMAS.length; i += 1) {
      assert.ok(got[arm][SIGMAS[i]].med > got[arm][SIGMAS[i - 1]].med, `${arm} 중앙값이 σ 에 단조가 아니에요: ${SIGMAS[i - 1]}→${SIGMAS[i]}`);
      assert.ok(got[arm][SIGMAS[i]].p90 > got[arm][SIGMAS[i - 1]].p90, `${arm} p90 가 σ 에 단조가 아니에요: ${SIGMAS[i - 1]}→${SIGMAS[i]}`);
    }
    // 성질: 오답 해 비율도 σ 를 따라 커져요(참 해까지 5 deg 밖으로 밀리니) — 단계 ② 의 검증 부담이 잡음과 같이 늘어요
    assert.ok(got[arm][2.62].wrongFrac > got[arm][0].wrongFrac, `${arm} 오답 비율이 σ 를 안 따라가요`);
  }
  // 두 팔의 관계: 캠페인 조건(dOW 3)은 무작위(dOW 2~4)와 같은 자릿수 — 사다리 분포가 캠페인 조건을 대표한다는 뜻
  for (const sigma of [1.4, 2.62]) assert.ok(got.campaign[sigma].med > got.random[sigma].med * 0.5 && got.campaign[sigma].med < got.random[sigma].med * 2, `σ=${sigma} 캠페인 중앙 ${got.campaign[sigma].med} vs 무작위 ${got.random[sigma].med}`);
});

const WORST_TRIPLES = [[0, 73, 510], [6, 77, 504], [7, 78, 496]];
/** N=10(registry X1) 격자의 최소 양수 면적비 삼중(반박자 probe-i 전수) — site id = x·100 + y·10 + z */
const WORST_TRIPLES_10 = [[0, 111, 899]];

/**
 * ★ 면적비 상수의 자(2026-09-20 2차 수정, 반박자 a3·probe-i) — 옛 주석의 「격자 최소 양수 면적비 1.1498e-2」는 틀린 숫자였고
 * 같은 줄이 1.0554e-2(WORST_TRIPLES) 를 그 «근처» 라고 적어 최소값보다 작은 값을 최소값 근처라 했어요. 손 사본이 되지
 * 않게 N=8 은 **격자 전수(22,238,720 삼중)** 로 매번 다시 유도하고, N=10 은 알려진 최악 삼중으로 재요.
 * 정의도 잠가요: areaRatio = |e12×e13| / 최장변² = **2·면적/최장변²** (옛 머리의 «면적/최장변²» 은 2× 틀림).
 */
test('★ areaRatio — 정의(2·면적/최장변²)와 격자 최소 양수 면적비(N=8 전수 유도 1.05538e-2 · N=10 6.2576e-3)', () => {
  const pose = xCameraLookAt({ N, azimuth: 0.4, elevation: 0.3 });
  const { points } = xProjectSites({ N, pose, camera: CAM });
  const ratioOf = P => {
    const e12 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e13 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]], e23 = [P[2][0] - P[1][0], P[2][1] - P[1][1], P[2][2] - P[1][2]];
    const cr = Math.hypot(e12[1] * e13[2] - e12[2] * e13[1], e12[2] * e13[0] - e12[0] * e13[2], e12[0] * e13[1] - e12[1] * e13[0]);
    const longest = Math.max(Math.hypot(...e12), Math.hypot(...e13), Math.hypot(...e23));
    return { ratio: cr / (longest * longest), area: cr / 2, longest };
  };
  // ① 정의: diagnostics.areaRatio == |e12×e13|/최장변² == 2·면적/최장변² (면적/최장변² 이 아님)
  for (const tri of WORST_TRIPLES) {
    const P = tri.map(worldOf);
    const d = xP3P({ points: P, bearings: xBearingsFromPixels(pixelsOf(points, tri), CAM) }).diagnostics;
    const { ratio, area, longest } = ratioOf(P);
    assert.ok(Math.abs(d.areaRatio - ratio) < 1e-15, `${tri} areaRatio ${d.areaRatio} ≠ ${ratio}`);
    assert.ok(Math.abs(d.areaRatio - 2 * area / (longest * longest)) < 1e-15, '정의는 2·면적/최장변²');
    assert.ok(Math.abs(d.areaRatio - area / (longest * longest)) > 1e-3, '면적/최장변² 이 아니에요(옛 머리 정의는 2× 틀림)');
    assert.ok(Math.abs(d.areaRatio - OBSERVED.gridMinAreaRatio[8]) < 1e-6, `${tri} 면적비 ${d.areaRatio} ≠ 격자 최소 ${OBSERVED.gridMinAreaRatio[8]}`);
  }
  // ② N=8 격자 전수 유도 — 최소 «양수» 면적비와 완전 공선 삼중 수(정수 격자라 외적이 정확히 0)
  {
    const pts = [];
    for (let id = 0; id < N ** 3; id += 1) pts.push(worldOf(id));
    let minPos = Infinity, zero = 0, total = 0;
    for (let i = 0; i < pts.length; i += 1) for (let j = i + 1; j < pts.length; j += 1) {
      const ex = pts[j][0] - pts[i][0], ey = pts[j][1] - pts[i][1], ez = pts[j][2] - pts[i][2];
      const c2 = ex * ex + ey * ey + ez * ez;
      for (let k = j + 1; k < pts.length; k += 1) {
        const fx = pts[k][0] - pts[i][0], fy = pts[k][1] - pts[i][1], fz = pts[k][2] - pts[i][2];
        const cx = ey * fz - ez * fy, cy = ez * fx - ex * fz, cz = ex * fy - ey * fx;
        const A2 = cx * cx + cy * cy + cz * cz;
        total += 1;
        if (A2 === 0) { zero += 1; continue; }
        const gx = pts[k][0] - pts[j][0], gy = pts[k][1] - pts[j][1], gz = pts[k][2] - pts[j][2];
        const longest2 = Math.max(c2, fx * fx + fy * fy + fz * fz, gx * gx + gy * gy + gz * gz);
        const ratio = Math.sqrt(A2) / longest2;
        if (ratio < minPos) minPos = ratio;
      }
    }
    assert.equal(total, OBSERVED.gridMinAreaRatio.triples8);
    assert.equal(zero, OBSERVED.gridMinAreaRatio.collinearTriples8);
    assert.ok(Math.abs(minPos / OBSERVED.gridMinAreaRatio[8] - 1) < 1e-5, `N=8 격자 최소 양수 면적비 ${minPos} ≠ 정본 ${OBSERVED.gridMinAreaRatio[8]}`);
    assert.ok(minPos > 1.5e-3, `격자 최소 ${minPos} 가 붕괴 문턱 ≈1.5e-3 밑이에요`);
    assert.ok(Math.abs(minPos / 1.1498e-2 - 1) > 0.05, `옛 주석의 1.1498e-2 는 격자 최소가 아니에요(실제 ${minPos})`);
  }
  // ③ N=10(registry X1): 알려진 최악 삼중이 정본값을 내고 붕괴 문턱 위(전수 1.66e8 은 반박자 probe-i 가 했어요)
  {
    const P10 = [[-4.5, -4.5, -4.5], [-3.5, -3.5, -3.5], [3.5, 4.5, 4.5]];
    const { ratio } = ratioOf(P10);
    assert.ok(Math.abs(ratio / OBSERVED.gridMinAreaRatio[10] - 1) < 1e-4, `N=10 최악 삼중 면적비 ${ratio} ≠ 정본 ${OBSERVED.gridMinAreaRatio[10]}`);
    assert.ok(ratio > 1.5e-3 && ratio < OBSERVED.gridMinAreaRatio[8], 'N=10 최소는 N=8 보다 작지만 붕괴 문턱 위');
  }
});

test('★ P3P 잡음 사다리 — 저 면적비 «최악» 삼중: 실근 상실(no-real-root)에 실패가 몰려요', () => {
  // 고정 삼중 3 개의 면적비는 1.05538e-2 = N=8 격자 최소 양수 면적비(위 ★ areaRatio 자가 전수로 유도) — 격자에서 제일 나쁜 삼각형
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
    // 해 개수 회계 — 해없음이 늘수록 평균 해 개수가 2 에서 내려가고(1.992→1.600) 오답 비율은 올라가요(0.48→0.90)
    assert.equal(r.solCount, r.solHist.reduce((acc, c, k) => acc + c * k, 0));
    assert.ok(Math.abs(r.meanSols / o.meanSols - 1) < 0.05, `σ=${sigma} 평균 해 ${r.meanSols} vs 정본 ${o.meanSols}`);
    assert.ok(Math.abs(r.wrongFrac / o.wrongFrac - 1) < 0.05, `σ=${sigma} 오답 비율 ${r.wrongFrac} vs 정본 ${o.wrongFrac}`);
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
 * ★ N=10(registry X1) 최악 삼중 사다리(2026-09-20 3차 수정, 반박자 b1) — 옛 사다리 3 종은 전부 N=8·pitch 1 고정이라 registry 의
 * 다른 유효 프로파일 N=10 이 잡음 체제에서 어떤지 어느 자도 안 쟀어요. «N=10 최소 면적비 6.2576e-3 > 붕괴 문턱 1.5e-3» 은
 * σ=0 논거라 이 축을 못 덮어요 — 실측은 N=8 최악삼중 대비 해없음 1.3~1.7× · 중앙 1.8~1.9× 나빠요(OBSERVED.worstTriples10).
 * 무작위 삼중 팔은 N=10 도 N=8 과 같은 자릿수(반박자 b1: σ=1.4 중앙 3.415 vs 3.482 deg)라 문제는 최악삼중 축이에요.
 * pitch 2.5 팔은 pitch 1 과 바이트 동일(b1 실측)이라 따로 두지 않아요 — 규약 왕복은 (a′) 자가 N=10·pitch 2.5 로 재요.
 */
test('★ P3P 잡음 사다리 — N=10(X1) 최악 삼중 [0,111,899]: N=8 최악삼중보다 해없음 1.3~1.7× · 중앙 1.8~1.9× 나빠요', () => {
  const bounds = { 0: { noSol: 0, med: 1e-8 }, 0.05: { noSol: 90, med: 5.0 }, 0.2: { noSol: 160, med: 18.0 }, 0.5: { noSol: 230, med: 40.0 } };
  const got10 = {}, got8 = {};
  for (const sigma of [0, 0.05, 0.2, 0.5]) {
    const r = noiseLadderRung({ sigma, seed: 3342109001, cases: 600, triples: WORST_TRIPLES_10, requireInFrame: false, gridN: 10 });
    got10[sigma] = r;
    got8[sigma] = noiseLadderRung({ sigma, seed: 3342109001, cases: 600, triples: WORST_TRIPLES, requireInFrame: false });
    assert.equal(r.n, 600);
    assert.ok(r.noSol <= bounds[sigma].noSol, `N=10 σ=${sigma} 해없음 ${r.noSol} > 정족수 ${bounds[sigma].noSol}`);
    assert.ok(r.med < bounds[sigma].med, `N=10 σ=${sigma} 중앙 ${r.med} deg ≥ ${bounds[sigma].med}`);
    const o = OBSERVED.worstTriples10[sigma];
    assert.equal(r.noSol, o.noSol, `N=10 σ=${sigma} 해없음 ${r.noSol} ≠ 정본 ${o.noSol}`);
    assert.ok(Math.abs(r.med / o.med - 1) < 0.05, `N=10 σ=${sigma} 중앙 ${r.med} vs 정본 ${o.med}`);
    assert.ok(Math.abs(r.p90 / o.p90 - 1) < 0.05, `N=10 σ=${sigma} p90 ${r.p90} vs 정본 ${o.p90}`);
    assert.equal(r.solCount, r.solHist.reduce((acc, c, k) => acc + c * k, 0));
    assert.ok(Math.abs(r.meanSols / o.meanSols - 1) < 0.05, `N=10 σ=${sigma} 평균 해 ${r.meanSols} vs 정본 ${o.meanSols}`);
    assert.ok(Math.abs(r.wrongFrac / o.wrongFrac - 1) < 0.05, `N=10 σ=${sigma} 오답 비율 ${r.wrongFrac} vs 정본 ${o.wrongFrac}`);
    if (sigma > 0) assert.ok((r.reasons.get('no-real-root') ?? 0) === r.noSol, `N=10 σ=${sigma} 해없음 사유 ${JSON.stringify([...r.reasons])}`);
    else assert.deepEqual([...r.reasons], [['ok', 600]]);
  }
  // 성질: 잡음 체제에서 N=10 최악삼중은 N=8 최악삼중보다 뚜렷이 나빠요 — 해없음 1.2× 이상 · 중앙 1.5× 이상(관측 1.33~1.74× · 1.79~1.87×)
  for (const sigma of [0.05, 0.2, 0.5]) {
    assert.ok(got10[sigma].noSol > got8[sigma].noSol * 1.2, `σ=${sigma} 해없음 N=10 ${got10[sigma].noSol} vs N=8 ${got8[sigma].noSol}`);
    assert.ok(got10[sigma].noSol < got8[sigma].noSol * 2.0, `σ=${sigma} 해없음 비 ${got10[sigma].noSol / got8[sigma].noSol} — 관측 범위(1.3~1.7×) 밖`);
    assert.ok(got10[sigma].med > got8[sigma].med * 1.5, `σ=${sigma} 중앙 N=10 ${got10[sigma].med} vs N=8 ${got8[sigma].med}`);
  }
  // σ=0 은 N=8 과 같은 기계 정밀도 칸(정확도 주장 아님)
  assert.ok(got10[0].med < 1e-8 && got10[0].noSol === 0);
  // 단조: 해없음이 σ 를 따라 커져요
  const sigmas = [0, 0.05, 0.2, 0.5];
  for (let i = 1; i < sigmas.length; i += 1) assert.ok(got10[sigmas[i]].noSol > got10[sigmas[i - 1]].noSol, `N=10 해없음이 σ 에 단조가 아니에요: ${sigmas[i - 1]}→${sigmas[i]}`);
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

/**
 * ★ xPoseLM 단위 일관성 자(2026-09-20 2차 수정, 반박자 probe-e) — 옛 종료 판정은 |δω|(rad) 와 |δt|(세계 단위) 를 한 max 에
 * 섞어 tol·(1+max(|t|,1)) 하나와 비교했어요. |t| 는 pitch 에 비례하니 **세계 단위만 바꿔도** 같은 기하에서 reason 이
 * 달라졌어요(pitch 1e-4: converged/step-below-tol 145/55 · pitch 1: 100/100 — 정확도 피해 0, 라벨만 달랐어요). 이제
 * 둘 다 «점의 변위 ≤ tol·L»(L = max(|t|, 점 반경))로 재요 — 이동은 |δt|, 회전은 점 반경·|δω|. 반박자 제안 tol·(1+|t|) 는 |t| ≪ 1 에서
 * «1 +» 가 다시 절대항이라 pitch 1e-4 에서 diverged(step-underflow) 를 새로 만들었고, 회전을 라디안 절대 tol 로 재면 잡음 바닥에서
 * 같은 라벨이 2/200 났어요(둘 다 실측) — 변위 등가로 재면 0 이에요. 여기서 재는 성질: 같은 seed·같은 기하를 pitch 만 바꿔 넣으면
 * reason 분포와 회전오차 분포가 같아요.
 */
test('★ xPoseLM — 같은 기하를 pitch 만 1e-4…1e6 으로 바꿔도 reason 분포·회전오차가 같아요(스텝 종료의 단위 일관성)', () => {
  const PITCHES = [1e-4, 1e-2, 1, 1e2, 1e4, 1e6];
  const perPitch = {};
  for (const pitch of PITCHES) {
    const rnd = mulberry32(5150);
    const gauss = gaussOf(rnd);
    const reasons = new Map();
    const rots = [];
    let runs = 0;
    while (runs < 200) {
      const pose = xCameraLookAt({ N, pitch, distanceOverWidth: 2 + 2 * rnd(), azimuth: (rnd() * 2 - 1) * Math.PI, elevation: (rnd() * 2 - 1) * 1.4, roll: (rnd() * 2 - 1) * Math.PI });
      const { points } = xProjectSites({ N, pitch, pose, camera: CAM });
      const ids = new Set(); while (ids.size < 8) ids.add(Math.floor(rnd() * N ** 3));
      const all = [...ids];
      if (!all.every(id => points[id].inFront)) continue; // inFront 는 pitch 불변이라 rnd 궤적도 pitch 무관하게 같아요
      const P = all.map(id => xSiteCoord(N, id).map(s => pitch * (s - HALF)));
      const pixels = all.map(id => [points[id].u + 0.05 * gauss(), points[id].v + 0.05 * gauss()]);
      const ax = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], an = Math.hypot(...ax);
      const R0 = mat3Mul(xExpSO3(ax.map(v => (v / an) * (5 * Math.PI / 180))), pose.R);
      const dt = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], dn = Math.hypot(...dt);
      const t0 = pose.t.map((v, i) => v + (dt[i] / dn) * 0.5 * pitch);
      const res = xPoseLM({ points: P, pixels, camera: CAM, R0, t0 });
      runs += 1;
      reasons.set(res.reason, (reasons.get(res.reason) || 0) + 1);
      rots.push(xRotationAngleDeg(res.R, pose.R));
    }
    perPitch[pitch] = { reasons, med: quant(rots, 0.5), p90: quant(rots, 0.9), max: Math.max(...rots) };
  }
  const ref = perPitch[1];
  for (const pitch of PITCHES) {
    const r = perPitch[pitch];
    // 정확도 분포는 스케일 불변(상대 1e-6 — 재투영 오차가 픽셀이라 pitch 와 무관)
    assert.ok(Math.abs(r.med / ref.med - 1) < 1e-6 && Math.abs(r.p90 / ref.p90 - 1) < 1e-6, `pitch=${pitch} 회전오차 중앙 ${r.med} / p90 ${r.p90} vs pitch 1 ${ref.med} / ${ref.p90}`);
    // reason 분포: pitch 1 대비 각 사유의 건수 차이가 ±3 안(부동소수 반올림 근처 동률 몇 건은 허용, 45 건급 이탈은 불허)
    for (const key of new Set([...ref.reasons.keys(), ...r.reasons.keys()])) {
      const d = Math.abs((r.reasons.get(key) ?? 0) - (ref.reasons.get(key) ?? 0));
      assert.ok(d <= 3, `pitch=${pitch} reason '${key}' ${r.reasons.get(key) ?? 0} vs pitch 1 ${ref.reasons.get(key) ?? 0} (분포 ${JSON.stringify([...r.reasons])})`);
    }
    for (const key of r.reasons.keys()) assert.ok(['converged', 'step-below-tol'].includes(key), `pitch=${pitch} 예상 밖 reason ${key}`);
  }
});

function det(R) { return R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]); }
