/**
 * `src/x-pose-lm.js` 단위자 — DESIGN_006 v6 봉인판 §6.1-7(LM 수렴·유계) · §6.1-8(LM 강건성) · §6.1-12(t 변환 · pitchPx_hyp 항등식,
 * near/far) · §6.1-47(투영 규약 일치) + 계약 §2 의 함수 모양·기본값 픽스처. seed 는 §4.4 단위자 갈래(3342300004 · 3342300005)만 써요.
 * GT 입력 허용 소절(§6.1 solver)이라 알려진 pose 를 만들어 먹여요 — blind 성능 주장이 아니에요.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { xSiteCoord } from '../src/x-layout.js';
import { X_CAMERA_MODEL, xCameraLookAt, xProjectSites, mat3Mul, mat3Apply } from '../src/x-project.js';
import { xRotationAngleDeg, xExpSO3, xIsRotation } from '../src/x-p3p.js';
import {
  X_LM_DEFAULTS, xProjectPoint, xResidualStats, xRoundSerial, xRoundSerialArray, xHuberIrlsLM, xTrimByResidual, xPoseRefine2Rounds,
} from '../src/x-pose-lm.js';

// 합성 조건(stage2-context «합성 조건»): 320×240, fov 40° → fx ≈ 439.7 · 둘째 카메라는 비대칭 fx/fy·주점으로 규약 차이를 드러내요
const CAM = { model: X_CAMERA_MODEL, width: 320, height: 240, fx: 160 / Math.tan(Math.PI / 9), fy: 160 / Math.tan(Math.PI / 9), cx: 160, cy: 120 };
const CAM2 = { model: X_CAMERA_MODEL, width: 640, height: 480, fx: 800, fy: 780, cx: 331.5, cy: 228.25 };
const N = 8, HALF = (N - 1) / 2, PITCH = 1;
const GATE = 2.0; // §4.3 g_abs
const SIGMA = 0.5; // σ_loc = max(0.5, 0.25·scalePx) at scalePx ≤ 2

/** 고정 seed 의 mulberry32 — 테스트 결정성(§4.4 생성기) */
function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussOf = rnd => () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const unitVec = rnd => {
  const z = 2 * rnd() - 1, ph = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
  return [r * Math.cos(ph), r * Math.sin(ph), z];
};
const worldOf = id => xSiteCoord(N, id).map(s => PITCH * (s - HALF));
const randomPose = rnd => xCameraLookAt({
  N, pitch: PITCH, distanceOverWidth: 2.5 + rnd(), azimuth: (rnd() * 2 - 1) * Math.PI, elevation: (rnd() * 2 - 1) * 1.2, roll: (rnd() * 2 - 1) * Math.PI,
});
/** 서로 다른 사이트 k 개를 고정 seed 로 골라요 */
function pickSites(rnd, k) {
  const ids = new Set();
  while (ids.size < k) ids.add(Math.floor(rnd() * N ** 3));
  return [...ids].sort((a, b) => a - b);
}
/** truth pose 에서 5° · 0.5 pitch 흔든 초기값(§6.1-7) */
function perturb(rnd, pose, deg = 5, dist = 0.5) {
  const ax = unitVec(rnd), th = deg * Math.PI / 180;
  const R0 = mat3Mul(xExpSO3([ax[0] * th, ax[1] * th, ax[2] * th]), pose.R);
  const dv = unitVec(rnd);
  return { R0, t0: [pose.t[0] + dist * dv[0], pose.t[1] + dist * dv[1], pose.t[2] + dist * dv[2]] };
}
/** 알려진 pose 의 대응 묶음(무잡음) */
function correspondences(pose, ids, camera = CAM) {
  const proj = xProjectSites({ N, pitch: PITCH, pose, camera });
  const points = ids.map(worldOf), pixels = ids.map(id => [proj.points[id].u, proj.points[id].v]);
  return { points, pixels, sigmas: ids.map(() => SIGMA), ids: ids.slice() };
}
const tErr = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]); };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

test('계약 §2.1 — X_LM_DEFAULTS 는 설계 §4.2·§4.3 값과 깊은 동일(동결)', () => {
  assert.deepEqual(X_LM_DEFAULTS, {
    maxIter: 20, lambda0: 1e-3, lambdaUp: 10, lambdaDown: 3, stepTol: 1e-9, costRelTol: 1e-12,
    depthMin: 1e-6, condMax: 1e12, finalStepMax: 1e-3, so3Tol: 1e-6, huberDelta: 1, trim: 0.10, minCorrespondences: 6,
  });
  assert.ok(Object.isFrozen(X_LM_DEFAULTS));
});

test('§6.1-47 투영 규약 일치 — xProjectPoint 가 frozen xProjectSites 와 1e−9 안에서 일치, 반픽셀 더한 구현은 갈림', () => {
  const rnd = mulberry32(3342300004);
  let checked = 0, worst = 0;
  for (let c = 0; c < 12; c += 1) {
    const camera = c % 2 ? CAM2 : CAM;
    const pose = randomPose(rnd);
    const proj = xProjectSites({ N, pitch: PITCH, pose, camera });
    for (let id = 0; id < N ** 3; id += 7) {
      const P = worldOf(id), p = xProjectPoint(pose.R, pose.t, P, camera), q = proj.points[id];
      assert.equal(p.inFront, q.inFront);
      const du = Math.abs(p.u - q.u), dv = Math.abs(p.v - q.v), dz = Math.abs(p.z - q.z);
      worst = Math.max(worst, du, dv, dz);
      assert.ok(du <= 1e-9 && dv <= 1e-9 && dz <= 1e-9, `id ${id}: Δ=(${du}, ${dv}, ${dz})`);
      // 반픽셀을 일부러 더한 «구현» 은 이 자에서 갈려요(§8.3-12 — 0.5 px 는 g_abs 안에 숨어 잔차·게이트 어디에도 안 나타나요)
      assert.ok(Math.abs((p.u + 0.5) - q.u) > 1e-9);
      checked += 1;
    }
  }
  assert.ok(checked >= 12 * 73);
  console.log(`[§6.1-47] ${checked} 점 · 최대 편차 ${worst.toExponential(3)}`);
  // 카메라 뒤 점: 정본과 같은 문턱(Z > 1e−9)·NaN 규약
  const behind = xProjectPoint([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, -5], [0, 0, 1], CAM);
  assert.equal(behind.inFront, false);
  assert.ok(Number.isNaN(behind.u) && Number.isNaN(behind.v));
  assert.throws(() => xProjectPoint([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1], [0, 0, 0], { ...CAM, model: 'fisheye' }), RangeError);
  assert.throws(() => xProjectPoint([1, 0, 0], [0, 0, 1], [0, 0, 0], CAM), TypeError);
});

test('§6.1-7 LM 수렴·유계 — 5°·0.5 pitch 흔든 초기값(seed 3342300004) → 무잡음 rms < 1e−6 px, iter ≤ 20 절대', () => {
  const rnd = mulberry32(3342300004);
  const iters = [], rmss = [], rotErrs = [];
  for (let c = 0; c < 40; c += 1) {
    const camera = c % 3 === 2 ? CAM2 : CAM;
    const pose = randomPose(rnd);
    const ids = pickSites(rnd, 24 + Math.floor(rnd() * 40));
    const cor = correspondences(pose, ids, camera);
    const { R0, t0 } = perturb(rnd, pose);
    const r = xHuberIrlsLM({ ...cor, camera, R0, t0, gate: GATE });
    assert.equal(r.ok, true, `case ${c}: ${r.reason}`);
    assert.equal(r.reason, 'ok');
    assert.ok(r.iterations >= 1 && r.iterations <= 20, `iter ${r.iterations}`);
    assert.ok(xIsRotation(r.R, 1e-9));
    const stats = xResidualStats({ R: r.R, t: r.t, points: cor.points, pixels: cor.pixels, camera });
    assert.ok(stats.rmsPx < 1e-6, `case ${c}: rms ${stats.rmsPx}`);
    assert.equal(stats.count, ids.length);
    assert.ok(r.weights.length === ids.length && r.weights.every(w => w === 1)); // 무잡음이라 Huber 인자 전부 1
    iters.push(r.iterations); rmss.push(stats.rmsPx); rotErrs.push(xRotationAngleDeg(r.R, pose.R));
  }
  console.log(`[§6.1-7] 40 케이스 · iter max ${Math.max(...iters)} · rms max ${Math.max(...rmss).toExponential(3)} px · 회전오차 max ${Math.max(...rotErrs).toExponential(3)} deg`);
});

test('§6.1-7 대응 < 6 → lm-underdetermined(라운드 2 미실행 runs:1)', () => {
  const rnd = mulberry32(3342300004);
  const pose = randomPose(rnd);
  const cor = correspondences(pose, pickSites(rnd, 5));
  const { R0, t0 } = perturb(rnd, pose);
  const r = xHuberIrlsLM({ ...cor, camera: CAM, R0, t0, gate: GATE });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'lm-underdetermined');
  assert.equal(r.iterations, 0);
  const two = xPoseRefine2Rounds({ round1: cor, round2: cor, camera: CAM, R0, t0, gate: GATE });
  assert.equal(two.ok, false);
  assert.equal(two.reason, 'lm-underdetermined');
  assert.equal(two.runs, 1);
  assert.equal(two.residualSummary, null);
  // 6 개면 결정(6 DoF) — 통과
  const cor6 = correspondences(pose, pickSites(rnd, 6));
  const r6 = xHuberIrlsLM({ ...cor6, camera: CAM, R0, t0, gate: GATE });
  assert.equal(r6.ok, true, r6.reason);
});

test('§6.1-7 화면 공선 대응 → cond 거절(lm-ill-conditioned) — 회전 자유도 하나가 무관측', () => {
  const rnd = mulberry32(3342300004);
  const pose = randomPose(rnd);
  // 사이트 (i, 0, 0), i = 0…7 — 세계 공선 ⇒ 화면 공선. 직선 둘레 회전은 Jacobian 의 영공간.
  const points = [...Array(N).keys()].map(i => [PITCH * (i - HALF), -PITCH * HALF, -PITCH * HALF]);
  const pixels = points.map(P => { const p = xProjectPoint(pose.R, pose.t, P, CAM); return [p.u, p.v]; });
  const cor = { points, pixels, sigmas: points.map(() => SIGMA), ids: points.map((_, i) => i) };
  const { R0, t0 } = perturb(rnd, pose, 1, 0.1);
  const r = xHuberIrlsLM({ ...cor, camera: CAM, R0, t0, gate: GATE });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'lm-ill-conditioned');
  assert.ok(r.iterations <= 20);
});

test('§4.2 거절 통로 — Z ≤ 1e−6 초기 pose → lm-nonpositive-depth · det −1 R0 는 고치지 않고 rotation-not-so3 · 비유한 → lm-ill-conditioned', () => {
  const rnd = mulberry32(3342300004);
  const pose = randomPose(rnd);
  const cor = correspondences(pose, pickSites(rnd, 20));
  // 카메라 뒤: t0 의 깊이를 뒤집어요
  const behind = xHuberIrlsLM({ ...cor, camera: CAM, R0: pose.R, t0: [pose.t[0], pose.t[1], -pose.t[2]], gate: GATE });
  assert.equal(behind.ok, false);
  assert.equal(behind.reason, 'lm-nonpositive-depth');
  // det −1: 세 번째 행 부호 반전
  const Rimp = pose.R.slice(); Rimp[6] *= -1; Rimp[7] *= -1; Rimp[8] *= -1;
  const imp = xHuberIrlsLM({ ...cor, camera: CAM, R0: Rimp, t0: pose.t, gate: GATE });
  assert.equal(imp.ok, false);
  assert.equal(imp.reason, 'rotation-not-so3');
  assert.deepEqual(imp.R, Rimp); // «고치지 않고» 거절
  // 비유한 입력은 설계 어휘에 전용 토큰이 없어 lm-ill-conditioned 로 접어요(계약 §9-6)
  const badPix = cor.pixels.map(p => p.slice()); badPix[3][0] = NaN;
  const nf = xHuberIrlsLM({ ...cor, pixels: badPix, camera: CAM, R0: pose.R, t0: pose.t, gate: GATE });
  assert.equal(nf.ok, false);
  assert.equal(nf.reason, 'lm-ill-conditioned');
  // 형식 위반만 throw(계약 §9-1)
  assert.throws(() => xHuberIrlsLM({ ...cor, camera: { ...CAM, fx: 0 }, R0: pose.R, t0: pose.t, gate: GATE }), RangeError);
  assert.throws(() => xHuberIrlsLM({ ...cor, pixels: cor.pixels.slice(1), camera: CAM, R0: pose.R, t0: pose.t, gate: GATE }), TypeError);
  assert.throws(() => xHuberIrlsLM({ ...cor, camera: CAM, R0: pose.R.slice(0, 8), t0: pose.t, gate: GATE }), TypeError);
  assert.throws(() => xHuberIrlsLM({ ...cor, camera: CAM, R0: pose.R, t0: pose.t, gate: 0 }), RangeError);
  assert.throws(() => xHuberIrlsLM({ ...cor, camera: CAM, R0: pose.R, t0: pose.t, gate: GATE }, { lambda: 1 }), TypeError); // 알 수 없는 키
});

test('§4.2 20 iter 뒤 |δ| > 1e−3 → lm-nonconverged(maxIter 를 1 로 낮춰 같은 통로를 유계로 재요)', () => {
  const rnd = mulberry32(3342300004);
  const pose = randomPose(rnd);
  const cor = correspondences(pose, pickSites(rnd, 30));
  const { R0, t0 } = perturb(rnd, pose, 20, 2);
  const r = xHuberIrlsLM({ ...cor, camera: CAM, R0, t0, gate: GATE }, { maxIter: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'lm-nonconverged');
  assert.equal(r.iterations, 1);
  assert.equal(r.converged, false);
  // 같은 입력을 기본 20 iter 로 돌리면 수렴
  const full = xHuberIrlsLM({ ...cor, camera: CAM, R0, t0, gate: GATE });
  assert.equal(full.ok, true, full.reason);
  assert.ok(full.iterations <= 20);
});

test('§6.1-8 LM 강건성 — 10 % 를 200 px 이상점(seed 3342300005)으로 바꿔도 회전 오차가 무이상점 대비 2배 이내, 순수 LS 대조군은 실패', () => {
  const rnd = mulberry32(3342300005), gauss = gaussOf(rnd);
  const NOISE = 0.3; // 무이상점 팔에도 같은 잡음(비교 분모가 0 이 되지 않게 — 파일 머리 §6.1-8 해석)
  const n = 40, nOut = Math.floor(0.10 * n);
  const base = [], robust = [], robust1 = [], ls = [];
  for (let c = 0; c < 24; c += 1) {
    const pose = randomPose(rnd);
    const ids = pickSites(rnd, n);
    const clean = correspondences(pose, ids);
    const noisy = { ...clean, pixels: clean.pixels.map(p => [p[0] + NOISE * gauss(), p[1] + NOISE * gauss()]) };
    // 이상점: 결정적으로 고른 4 개 index 를 200 px 무작위 방향으로
    const outIdx = new Set();
    while (outIdx.size < nOut) outIdx.add(Math.floor(rnd() * n));
    const outPix = noisy.pixels.map((p, i) => {
      if (!outIdx.has(i)) return p.slice();
      const a = 2 * Math.PI * rnd();
      return [p[0] + 200 * Math.cos(a), p[1] + 200 * Math.sin(a)];
    });
    const dirty = { ...noisy, pixels: outPix };
    const { R0, t0 } = perturb(rnd, pose);
    // C 가 하는 «트리밍된 id 를 빼고 재매칭» 을 함수형 round2 로 흉내내요(재매칭 자체는 B 의 몫이 아니에요)
    const round2Of = set => ({ trimmedIds }) => {
      const keep = set.ids.map((id, i) => i).filter(i => !trimmedIds.includes(set.ids[i]));
      return { points: keep.map(i => set.points[i]), pixels: keep.map(i => set.pixels[i]), sigmas: keep.map(i => set.sigmas[i]), ids: keep.map(i => set.ids[i]) };
    };
    const rb = xPoseRefine2Rounds({ round1: noisy, round2: round2Of(noisy), camera: CAM, R0, t0, gate: GATE });
    const rr = xPoseRefine2Rounds({ round1: dirty, round2: round2Of(dirty), camera: CAM, R0, t0, gate: GATE });
    assert.equal(rb.ok, true, `base ${c}: ${rb.reason}`);
    assert.equal(rr.ok, true, `robust ${c}: ${rr.reason}`);
    assert.equal(rb.runs, 2); assert.equal(rr.runs, 2);
    // 트리밍 ⌊0.10·40⌋ = 4 개가 정확히 이상점 4 개
    assert.deepEqual(rr.trimmedIds, [...outIdx].map(i => ids[i]).sort((a, b) => a - b));
    assert.equal(rr.residualSummary.count, n - nOut);
    base.push(xRotationAngleDeg(rb.R, pose.R));
    robust.push(xRotationAngleDeg(rr.R, pose.R));
    // 참고: 트리밍 없는 한 라운드 Huber 만
    const r1 = xHuberIrlsLM({ ...dirty, camera: CAM, R0, t0, gate: GATE });
    assert.equal(r1.ok, true, r1.reason);
    robust1.push(xRotationAngleDeg(r1.R, pose.R));
    assert.ok([...outIdx].every(i => r1.weights[i] < 0.05), '이상점의 Huber 인자 < 0.05');
    // 순수 최소제곱 대조군(δ = ∞ · trim 0)
    const l = xHuberIrlsLM({ ...dirty, camera: CAM, R0, t0, gate: GATE }, { huberDelta: Infinity, trim: 0 });
    ls.push(l.ok ? xRotationAngleDeg(l.R, pose.R) : Infinity);
  }
  const ratioMed = median(robust) / median(base), ratioMean = mean(robust) / mean(base), lsMed = median(ls) / median(base);
  console.log(`[§6.1-8] 24 케이스 · 회전오차 deg — 무이상점 med ${median(base).toExponential(3)} · Huber+트리밍 med ${median(robust).toExponential(3)} (비 ${ratioMed.toFixed(3)}, 평균비 ${ratioMean.toFixed(3)}) · Huber 1 라운드 med ${median(robust1).toExponential(3)} · 순수 LS med ${median(ls).toExponential(3)} (비 ${lsMed.toFixed(1)})`);
  assert.ok(ratioMed <= 2, `Huber+트리밍 중앙값 비 ${ratioMed}`);
  assert.ok(ratioMean <= 2, `Huber+트리밍 평균 비 ${ratioMean}`);
  assert.ok(lsMed > 2, `순수 LS 대조군이 2배 안에 들면 자가 이상점을 못 재는 것: ${lsMed}`);
  for (let c = 0; c < base.length; c += 1) assert.ok(ls[c] > 2 * base[c], `case ${c}: LS ${ls[c]} vs base ${base[c]}`);
});

test('§6.1-12 t 변환·pitchPx_hyp 항등식 — near(+1)·far(−1) 각각에서 t = t_f + R_f·h(layerSign) 이 truth 와 1e−9 안, far 에 +1 을 쓰면 |Δt|/pitch ≈ N−1(§6.1-17)', () => {
  const rnd = mulberry32(3342300004);
  const h = layerSign => [PITCH * HALF, PITCH * HALF, PITCH * HALF * layerSign];
  let worstT = 0, worstPitch = 0;
  for (let c = 0; c < 10; c += 1) {
    const pose = randomPose(rnd);
    const ids = pickSites(rnd, 36);
    const truthProj = xProjectSites({ N, pitch: PITCH, pose, camera: CAM });
    for (const layerSign of [+1, -1]) {
      // 면-국소(코너 원점) 좌표: P_f = P + h(layerSign) — far 는 k 를 거울상으로 센 프레임(§2.8 t 변환의 전제)
      const hv = h(layerSign);
      const points = ids.map(id => { const P = worldOf(id); return [P[0] + hv[0], P[1] + hv[1], P[2] + hv[2]]; });
      const pixels = ids.map(id => [truthProj.points[id].u, truthProj.points[id].v]);
      const sigmas = ids.map(() => SIGMA);
      // 초기값: truth 의 면-국소 pose(t_f = t − R·h) 를 5°·0.5 pitch 흔든 것
      const tf = mat3Apply(pose.R, hv);
      const { R0, t0 } = perturb(rnd, { R: pose.R, t: [pose.t[0] - tf[0], pose.t[1] - tf[1], pose.t[2] - tf[2]] });
      const r = xHuberIrlsLM({ points, pixels, sigmas, camera: CAM, R0, t0, gate: GATE });
      assert.equal(r.ok, true, `layerSign ${layerSign} case ${c}: ${r.reason}`);
      const Rh = mat3Apply(r.R, hv);
      const tOut = [r.t[0] + Rh[0], r.t[1] + Rh[1], r.t[2] + Rh[2]];
      const e = tErr(tOut, pose.t);
      worstT = Math.max(worstT, e);
      assert.ok(e <= 1e-9, `layerSign ${layerSign} case ${c}: |t_out − t| = ${e}`);
      // pitchPx_hyp = fx·pitch / (t_f + R_f·h)[2] 가 frozen xProjectSites 의 pitchPx(= fx·pitch / t[2]) 와 같은 값
      const pitchPxHyp = CAM.fx * PITCH / tOut[2];
      const dp = Math.abs(pitchPxHyp - truthProj.pitchPx) / truthProj.pitchPx;
      worstPitch = Math.max(worstPitch, dp);
      assert.ok(dp <= 1e-9, `pitchPx_hyp 상대 편차 ${dp}`);
      // 반례(§6.1-17): far 에서 h 를 +1 로 두면 |Δt|/pitch ≈ N−1 = 7
      if (layerSign === -1) {
        const Rw = mat3Apply(r.R, h(+1));
        const wrong = [r.t[0] + Rw[0], r.t[1] + Rw[1], r.t[2] + Rw[2]];
        const bad = tErr(wrong, pose.t) / PITCH;
        assert.ok(Math.abs(bad - (N - 1)) <= 1e-6, `far 에 +1: |Δt|/pitch = ${bad}`);
      }
    }
  }
  console.log(`[§6.1-12] 10 pose × near/far · |t_out − t| max ${worstT.toExponential(3)} · pitchPx 상대편차 max ${worstPitch.toExponential(3)}`);
});

test('§2.7 트리밍 — 잔차 round(1e6·d) 내림, 동률 blobId 내림, ⌊trim·n⌋ 개 제거 · 남는 index 오름', () => {
  const rnd = mulberry32(3342300005);
  const pose = randomPose(rnd);
  const ids = pickSites(rnd, 20);
  const cor = correspondences(pose, ids);
  // 무잡음이라 잔차 전부 ≈ 0(양자화 뒤 0 으로 동률) → blobId 큰 것부터 ⌊0.1·20⌋ = 2 개 제거
  const kept = xTrimByResidual({ ...cor, R: pose.R, t: pose.t, camera: CAM, trim: 0.10 });
  assert.equal(kept.length, 18);
  const removedIds = ids.filter((_, i) => !kept.includes(i));
  assert.deepEqual(removedIds, ids.slice(-2));
  assert.deepEqual(kept, kept.slice().sort((a, b) => a - b));
  // 큰 잔차를 하나 심으면 그것이 먼저, 다음은 blobId 최대
  const pix = cor.pixels.map(p => p.slice()); pix[4][0] += 3;
  const kept2 = xTrimByResidual({ ...cor, pixels: pix, R: pose.R, t: pose.t, camera: CAM, trim: 0.10 });
  const removed2 = ids.map((_, i) => i).filter(i => !kept2.includes(i));
  assert.deepEqual(removed2, [4, 19]);
  // trim 0 → 전부 남음 · ids 생략 시 index 가 id
  assert.equal(xTrimByResidual({ ...cor, R: pose.R, t: pose.t, camera: CAM, trim: 0 }).length, 20);
  const noIds = xTrimByResidual({ points: cor.points, pixels: cor.pixels, R: pose.R, t: pose.t, camera: CAM, trim: 0.10 });
  assert.deepEqual(ids.map((_, i) => i).filter(i => !noIds.includes(i)), [18, 19]);
});

test('계약 §9-4 · §5.3 — xResidualStats p95 index ⌈0.95·n⌉−1 · xRoundSerial 격자·−0 정규화', () => {
  // 잔차를 직접 설계: 같은 세계점 P=(0,0,0)·R=I·t=(0,0,10) → u=cx, v=cy. 픽셀을 밀어 잔차 1…20 px 를 만들어요
  const n = 20;
  const points = Array.from({ length: n }, () => [0, 0, 0]);
  const pixels = Array.from({ length: n }, (_, i) => [CAM.cx + (i + 1), CAM.cy]);
  const s = xResidualStats({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 10], points, pixels, camera: CAM });
  assert.equal(s.count, 20);
  assert.equal(s.maxPx, 20);
  assert.equal(s.p95Px, 19); // ⌈19⌉ − 1 = 18 → 정렬값 19
  assert.ok(Math.abs(s.rmsPx - Math.sqrt(2870 / 20)) < 1e-12);
  const s10 = xResidualStats({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 10], points: points.slice(0, 10), pixels: pixels.slice(0, 10), camera: CAM });
  assert.equal(s10.p95Px, 10); // ⌈9.5⌉ − 1 = 9 → 최대
  assert.equal(xResidualStats({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 10], points: [], pixels: [], camera: CAM }).count, 0);
  // 카메라 뒤 대응이 있으면 NaN
  assert.ok(Number.isNaN(xResidualStats({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, -10], points: points.slice(0, 2), pixels: pixels.slice(0, 2), camera: CAM }).rmsPx));
  assert.equal(xRoundSerial(0.1234567), 0.123457);
  assert.equal(xRoundSerial(-0.0000004), 0);
  assert.ok(Object.is(xRoundSerial(-0.0000004), 0), '−0 는 +0 으로');
  assert.ok(Number.isNaN(xRoundSerial(NaN)));
  assert.deepEqual(xRoundSerialArray([1.00000049, -2.5000006]), [1, -2.500001]);
  assert.equal(xRoundSerial(-2.5000005), -2.5); // Math.round 는 .5 를 +∞ 쪽으로(계약 §9-2 «Math.round 로 통일»)
});

test('§2.7 2 라운드 — residualSummary 는 반올림 R·t 로 재계산(v6 결정 6) · 평가기 재계산과 1e−9 일치 · RRounded 는 1e−6 격자', () => {
  const rnd = mulberry32(3342300005), gauss = gaussOf(rnd);
  const pose = randomPose(rnd);
  const face = pickSites(rnd, 30), all = pickSites(rnd, 60);
  const c1 = correspondences(pose, face), c2 = correspondences(pose, all);
  const noise = c => ({ ...c, pixels: c.pixels.map(p => [p[0] + 0.3 * gauss(), p[1] + 0.3 * gauss()]) });
  const round1 = noise(c1), round2 = noise(c2);
  const { R0, t0 } = perturb(rnd, pose);
  const seen = [];
  const r = xPoseRefine2Rounds({ round1, round2: arg => { seen.push(arg); return round2; }, camera: CAM, R0, t0, gate: GATE });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.runs, 2);
  assert.equal(seen.length, 1);
  assert.deepEqual(Object.keys(seen[0]).sort(), ['R', 'keptIndices', 't', 'trimmedIds']);
  assert.equal(r.trimmedIds.length, Math.floor(0.10 * 30));
  assert.equal(seen[0].keptIndices.length, 27);
  // 격자
  for (const x of [...r.RRounded, ...r.tRounded]) assert.equal(x, Math.round(1e6 * x) / 1e6);
  assert.deepEqual(r.RRounded, xRoundSerialArray(r.R));
  // 평가기 규약(§5.1-5): 같은 반올림 R·t 로 frozen 식(xProjectPoint ≡ xProjectSites)으로 재계산 → 같은 격자로 양자화 뒤 1e−9 일치
  const re = xResidualStats({ R: r.RRounded, t: r.tRounded, points: round2.points, pixels: round2.pixels, camera: CAM });
  assert.equal(re.count, r.residualSummary.count);
  assert.equal(r.residualSummary.count, 60);
  assert.ok(Math.abs(xRoundSerial(re.rmsPx) - r.residualSummary.rmsPx) <= 1e-9);
  assert.ok(Math.abs(xRoundSerial(re.p95Px) - r.residualSummary.p95Px) <= 1e-9);
  assert.ok(Math.abs(xRoundSerial(re.maxPx) - r.residualSummary.maxPx) <= 1e-9);
  // 반올림 R 은 배정밀도 SO(3) 검사(1e−6)를 못 넘을 수 있어 평가기 허용은 1e−5(§4.3) — 여기서는 그 상한만 확인
  assert.ok(xIsRotation(r.RRounded, 1e-5));
  // 배정밀도 R·t 로 잰 rms 와 반올림 R·t 로 잰 rms 는 다를 수 있음(둘 다 유한) — 수치 인용용 출력
  const exact = xResidualStats({ R: r.R, t: r.t, points: round2.points, pixels: round2.pixels, camera: CAM });
  console.log(`[§2.7] round1 iter ${r.round1.iterations} · round2 iter ${r.round2.iterations} · rms(배정밀도) ${exact.rmsPx.toFixed(6)} · rms(반올림) ${r.residualSummary.rmsPx} · p95 ${r.residualSummary.p95Px} · max ${r.residualSummary.maxPx}`);
  assert.ok(Number.isFinite(r.residualSummary.rmsPx) && r.residualSummary.rmsPx < 1);
  // 라운드 2 수치 거절 → runs:2 · ok:false
  const bad = xPoseRefine2Rounds({ round1, round2: { ...round2, points: round2.points.slice(0, 5), pixels: round2.pixels.slice(0, 5), sigmas: round2.sigmas.slice(0, 5), ids: round2.ids.slice(0, 5) }, camera: CAM, R0, t0, gate: GATE });
  assert.equal(bad.ok, false); assert.equal(bad.runs, 2); assert.equal(bad.reason, 'lm-underdetermined');
  assert.throws(() => xPoseRefine2Rounds({ round1, round2: null, camera: CAM, R0, t0, gate: GATE }), TypeError);
});

test('결정성 — 같은 입력 두 번 → 비트 동일 출력(RNG 0)', () => {
  const rnd = mulberry32(3342300005), gauss = gaussOf(rnd);
  const pose = randomPose(rnd);
  const cor = correspondences(pose, pickSites(rnd, 40));
  const noisy = { ...cor, pixels: cor.pixels.map(p => [p[0] + 0.5 * gauss(), p[1] + 0.5 * gauss()]) };
  const { R0, t0 } = perturb(rnd, pose);
  const a = xPoseRefine2Rounds({ round1: noisy, round2: noisy, camera: CAM, R0, t0, gate: GATE });
  const b = xPoseRefine2Rounds({ round1: noisy, round2: noisy, camera: CAM, R0, t0, gate: GATE });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.ok, true, a.reason);
});
