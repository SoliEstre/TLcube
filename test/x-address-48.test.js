/**
 * x-address-48 단위자 — 설계 DESIGN_006 v6(sha 5aefa00b…) + v6.1 개정(sha 7f9251b7…, «o ≠ 0 팔») §6.1-9 · 10 · 11 · 12 · 13 · 14 · 15 · 16 · 17 · 39 · §6.2-22 · 23 · 42 · 43.
 * 테스트 이름 앞의 «§6.x-NN» 이 설계 §6 의 단위자 번호예요. 기대값은 손 수치가 아니라 설계 표(§2.4 U · §2.5 면 구성 · §2.10 별칭)와
 * 프로젝트 데이터 `rd3/finder-structure-recount-20260920.json`(환경변수 `TL_X_RECOUNT_JSON` — 없으면 그 팔은 **fail**, skip 아님)이에요.
 * 단위자 전용 seed(§4.4): §6.2-42 의 무작위 coverage 100 벌은 3342300003(단위자 갈래) 를 써요.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  X_TRANSFORMS, X_ADDRESS_Q, X_ADDRESS_PI, X_ADDRESS_S, xTransformById, xTransformInverse, xTransformCompose,
  xAddressMap, xOutputRotation, xOutputTranslation, xPitchPxHyp, xSiteFromFaceLocal, xEffectiveMap, xEffectiveMaps,
  xAliasClasses, xStabilizer, xUniversalLitIndices, xTripleIndexTable, xFacePlaneComposition, xExtent, xStage0Filter,
  xOffsetRange, xCountSupport, xUndeterminedCount, X_ADDRESS_TESTS_TOTAL, xCoverageIdentity, xUnexploredDerive, xLabelKey,
  xLabelIndex, xLabelFromIndex, xUniquenessScope, X_UNIQUENESS_PHRASES, xTransformSite, xPairsOfN,
} from '../src/x-address-48.js';
import { X_PROFILE_IDS, xProfile, xProfileLayout } from '../src/x-profile.js';
import { X_FINDER_IDS } from '../src/x-finder.js';
import { xSiteCoord, xSiteId } from '../src/x-layout.js';
import { X_CAMERA_MODEL, xRotation, mat3Mul, mat3Apply, xCameraLookAt, xProjectSites } from '../src/x-project.js';
import { xIsRotation, xRotationAngleDeg } from '../src/x-p3p.js';

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mat3T = a => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
const det3 = M => M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const vecNear = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => near(v, b[i], eps));
const label = t => `p${t.perm.join('')}s${t.sign.map(v => (v > 0 ? '+' : '-')).join('')}`;
const CAM = { model: X_CAMERA_MODEL, width: 320, height: 240, fx: 439.596, fy: 439.596, cx: 160, cy: 120 };
/** 임의(고정) 회전 — 결정적 · 축 정렬 아님 */
const R_ARB = xRotation({ yaw: 0.61, pitch: -0.37, roll: 0.23 });

/** 프로젝트 데이터 recount(사설 레인) — 환경변수로 받고, 없으면 fail(메모리 «워크트리엔 휘도 덤프가 없다») */
function loadRecount() {
  const path = process.env.TL_X_RECOUNT_JSON;
  assert.ok(path, 'TL_X_RECOUNT_JSON 환경변수(rd3/finder-structure-recount-20260920.json 경로)가 필요해요 — 없으면 fail(skip 아님)');
  return JSON.parse(readFileSync(path, 'utf8'));
}
/** recount 와 같은 정의의 48 descriptor — J = K ∩ gK 위 support(양쪽 known) · contradictions(0↔1), gP(s) = P(g⁻¹ s) */
function recountDescriptor(map, t) {
  const inv = X_TRANSFORMS[xTransformInverse(t.transformId)].M;
  let support = 0, contradictions = 0;
  for (let s = 0; s < map.known.length; s += 1) {
    const src = xTransformSite(map.N, inv, s);
    if (map.known[s] && map.known[src]) { support += 1; if (map.bits[s] !== map.bits[src]) contradictions += 1; }
  }
  return { support, contradictions };
}
/** 면-국소 raw 주소 a 의 물리 좌표 `pitch·Π^[far]·(a − c)`(큐브 중심 기준) */
function faceLocalPhysical(a, N, layerSign, pitch = 1) {
  const c = (N - 1) / 2;
  return [pitch * (a[0] - c), pitch * (a[1] - c), pitch * layerSign * (a[2] - c)];
}
/** truth pose (R, t) 와 (M, layerSign) 에서 면-국소 pose (R_f, t_f) 를 역유도 — `R_f = R·M_p·S^[far]`(S⁻¹ = S), `t_f = t − R_f·h` */
function faceLocalPose(R, t, M, layerSign, N, pitch = 1) {
  const tr = xTransformById(M);
  const Mp = tr.parity > 0 ? tr.M : mat3Mul(X_ADDRESS_PI, tr.M);
  const R_f = layerSign === -1 ? mat3Mul(mat3Mul(R, Mp), X_ADDRESS_S) : mat3Mul(R, Mp);
  const c = pitch * (N - 1) / 2;
  const Rh = mat3Apply(R_f, [c, c, c * layerSign]);
  return { R_f, t_f: [t[0] - Rh[0], t[1] - Rh[1], t[2] - Rh[2]] };
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ───────────────────────────── §6.1-9 ─────────────────────────────

test('§6.1-9 48 변환군 — proper 24 / improper 24 · 군 닫힘·역원 · 고정 벡터 id0=I · id7=−I · id8=perm(0,2,1)·(+,+,+) · transformId = permIndex·8 + signIndex', () => {
  assert.equal(X_TRANSFORMS.length, 48);
  assert.equal(X_TRANSFORMS.filter(t => t.parity === 1).length, 24);
  assert.equal(X_TRANSFORMS.filter(t => t.parity === -1).length, 24);
  X_TRANSFORMS.forEach((t, i) => {
    assert.equal(t.transformId, i);
    assert.equal(t.transformId, t.permIndex * 8 + t.signIndex);
    assert.equal(det3(t.M), t.parity);
    for (let r = 0; r < 3; r += 1) assert.equal(t.M[r * 3 + t.perm[r]], t.sign[r]);
  });
  assert.deepEqual([...X_TRANSFORMS[0].M], I3);
  assert.deepEqual([...X_TRANSFORMS[7].M], [-1, 0, 0, 0, -1, 0, 0, 0, -1]);
  assert.equal(X_TRANSFORMS[7].parity, -1);
  assert.deepEqual([...X_TRANSFORMS[8].perm], [0, 2, 1]);
  assert.deepEqual([...X_TRANSFORMS[8].sign], [1, 1, 1]);
  // 수치 사전순(−1 < +1)으로 늘어놓은 구현은 id 0 = −I 라 위에서 갈려요. 유일성:
  assert.equal(new Set(X_TRANSFORMS.map(t => t.M.join(','))).size, 48);
  // 군 닫힘·역원(48 × 48)
  for (let a = 0; a < 48; a += 1) {
    const inv = xTransformInverse(a);
    assert.ok(Number.isInteger(inv) && inv >= 0 && inv < 48);
    assert.equal(xTransformCompose(a, inv), 0);
    assert.equal(xTransformCompose(inv, a), 0);
    for (let b = 0; b < 48; b += 1) {
      const c = xTransformCompose(a, b);
      assert.ok(Number.isInteger(c) && c >= 0 && c < 48);
      assert.deepEqual(mat3Mul(X_TRANSFORMS[a].M, X_TRANSFORMS[b].M), [...X_TRANSFORMS[c].M]);
    }
  }
  assert.equal(xTransformById(47).transformId, 47);
  assert.throws(() => xTransformById(48), RangeError);
  assert.throws(() => xTransformById(-1), RangeError);
  assert.throws(() => xTransformById(1.5), RangeError);
  assert.throws(() => xTransformById('0'), RangeError);
});

test('§6.1-9 N8/N10 전 사이트 왕복 — 48 변환 전부가 격자의 전단사이고 역원으로 되돌아와요', () => {
  for (const N of [8, 10]) {
    for (const t of X_TRANSFORMS) {
      const inv = X_TRANSFORMS[xTransformInverse(t.transformId)].M;
      const seen = new Uint8Array(N ** 3);
      for (let s = 0; s < N ** 3; s += 1) {
        const img = xTransformSite(N, t.M, s);
        assert.equal(seen[img], 0); seen[img] = 1;
        assert.equal(xTransformSite(N, inv, img), s);
      }
    }
  }
});

test('§6.1-9 · §6.1-17 far 두 행렬 — det Q = −1 · Π = diag(1,1,−1) · S = Π·Qᵀ · det S = +1 · far 에서 det T = −det M(48 전부)', () => {
  assert.deepEqual([...X_ADDRESS_Q], [0, 1, 0, 1, 0, 0, 0, 0, 1]);
  assert.deepEqual([...X_ADDRESS_PI], [1, 0, 0, 0, 1, 0, 0, 0, -1]);
  assert.equal(det3(X_ADDRESS_Q), -1);
  assert.equal(det3(X_ADDRESS_PI), -1);
  assert.deepEqual([...X_ADDRESS_S], mat3Mul(X_ADDRESS_PI, mat3T(X_ADDRESS_Q)));
  assert.deepEqual([...X_ADDRESS_S], [0, 1, 0, 1, 0, 0, 0, 0, -1]);
  assert.equal(det3(X_ADDRESS_S), 1);
  for (const t of X_TRANSFORMS) {
    const nearMap = xAddressMap(t.transformId, 1), farMap = xAddressMap(t.transformId, -1);
    assert.deepEqual(nearMap.T, [...t.M]);
    assert.equal(nearMap.det, t.parity);
    assert.deepEqual(farMap.T, mat3Mul(t.M, X_ADDRESS_Q));
    assert.equal(farMap.det, -t.parity);
    assert.deepEqual(xAddressMap([...t.M], -1).T, farMap.T); // 9 배열 인자도 같음
  }
  assert.throws(() => xAddressMap(0, 0), RangeError);
  assert.throws(() => xAddressMap(0, '+1'), RangeError);
  assert.throws(() => xAddressMap([1, 1, 0, 0, 1, 0, 0, 0, 1], 1), RangeError); // 부호 순열 아님
});

// ───────────────────────────── §6.1-10 ─────────────────────────────

test('§6.1-10 M ↔ Mᵀ 방향 잠금 — 우리 v_s = M·v_f 와 감사 자의 preimage w = Mᵀ·v 는 서로 역방향(합성이 항등)이고, 비대칭 M 에서는 서로 달라요', () => {
  const N = 8;
  const preimage = (M, siteId) => { // 감사 자(recount) 의 w = Mᵀ v 표기 그대로
    const p = xSiteCoord(N, siteId);
    const v = [2 * p[0] - (N - 1), 2 * p[1] - (N - 1), 2 * p[2] - (N - 1)];
    const w = [0, 1, 2].map(r => M[r] * v[0] + M[3 + r] * v[1] + M[6 + r] * v[2]);
    return xSiteId(N, w.map(x => (x + (N - 1)) / 2));
  };
  let asymmetric = 0, differs = 0;
  for (const t of X_TRANSFORMS) {
    let anyDiff = false;
    for (let s = 0; s < N ** 3; s += 1) {
      assert.equal(xTransformSite(N, t.M, preimage(t.M, s)), s);
      assert.equal(preimage(t.M, xTransformSite(N, t.M, s)), s);
      if (xTransformSite(N, t.M, s) !== preimage(t.M, s)) anyDiff = true;
    }
    const symmetric = t.M.every((v, i) => v === mat3T(t.M)[i]);
    if (!symmetric) { asymmetric += 1; assert.ok(anyDiff, `비대칭 M ${label(t)} 에서 정방향과 preimage 가 같으면 방향이 잠기지 않아요`); if (anyDiff) differs += 1; }
    else assert.ok(!anyDiff);
  }
  assert.ok(asymmetric > 0 && differs === asymmetric);
});

// ───────────────────────────── §6.1-11 · §6.1-17 ─────────────────────────────

test('§6.1-11 improper 인코딩 · far 두 분기 항등식 — 48 × near/far × N8 512 사이트: R ∈ SO(3) · X_c = R·Π^p·P_s + t == R_f·pitch·Π^[far]·(a−c) + t (1e−9) · far det T = −det M', () => {
  const N = 8, pitch = 1;
  const R_f = R_ARB, t_f = [0.7, -0.4, 30.5];
  let checked = 0, maxErr = 0;
  for (const layerSign of [1, -1]) {
    const far = layerSign === -1 ? 1 : 0;
    const t = xOutputTranslation(R_f, t_f, N, layerSign, pitch);
    for (const tr of X_TRANSFORMS) {
      const R = xOutputRotation(R_f, tr.transformId, layerSign);
      assert.ok(xIsRotation(R, 1e-9), `R ∉ SO(3): ${label(tr)} layerSign ${layerSign}`);
      const { T, det } = xAddressMap(tr.transformId, layerSign);
      assert.equal(det, far ? -tr.parity : tr.parity);
      const RPp = tr.parity > 0 ? R : mat3Mul(R, X_ADDRESS_PI);
      for (let ai = 0; ai < N; ai += 1) for (let aj = 0; aj < N; aj += 1) for (let ak = 0; ak < N; ak += 1) {
        const a = [ai, aj, ak];
        const s = xSiteFromFaceLocal(a, T, N, [0, 0, 0]);
        assert.ok(s !== null && s.every(v => Number.isInteger(v) && v >= 0 && v < N));
        const Ps = [pitch * (s[0] - (N - 1) / 2), pitch * (s[1] - (N - 1) / 2), pitch * (s[2] - (N - 1) / 2)];
        const lhs = mat3Apply(RPp, Ps).map((v, i) => v + t[i]);
        const rhs = mat3Apply(R_f, faceLocalPhysical(a, N, layerSign, pitch)).map((v, i) => v + t[i]);
        for (let i = 0; i < 3; i += 1) maxErr = Math.max(maxErr, Math.abs(lhs[i] - rhs[i]));
        assert.ok(vecNear(lhs, rhs, 1e-9), `항등식 실패 ${label(tr)} layerSign ${layerSign} a=${a}`);
        checked += 1;
      }
    }
  }
  assert.equal(checked, 48 * 2 * 512);
  assert.ok(maxErr <= 1e-9);
});

test('§6.1-11 반례 (ㄱ) M_p = M·Π 는 improper 24 중 16 에서 항등식이 깨져요(Π 와 가환인 8 개만 통과)', () => {
  const N = 8, R_f = R_ARB, t_f = [0.2, 0.1, 25];
  const failing = [];
  for (const layerSign of [1, -1]) {
    const t = xOutputTranslation(R_f, t_f, N, layerSign);
    for (const tr of X_TRANSFORMS.filter(x => x.parity < 0)) {
      const MpWrong = mat3Mul(tr.M, X_ADDRESS_PI); // 틀린 M_p = M·Π
      const base = layerSign === -1 ? mat3Mul(R_f, X_ADDRESS_S) : R_f;
      const Rwrong = mat3Mul(base, mat3T(MpWrong));
      const RPp = mat3Mul(Rwrong, X_ADDRESS_PI);
      const { T } = xAddressMap(tr.transformId, layerSign);
      let ok = true;
      for (let s = 0; s < N ** 3 && ok; s += 1) {
        const a = xSiteCoord(N, s);
        const sc = xSiteFromFaceLocal(a, T, N, [0, 0, 0]);
        const Ps = sc.map(v => v - (N - 1) / 2);
        const lhs = mat3Apply(RPp, Ps).map((v, i) => v + t[i]);
        const rhs = mat3Apply(R_f, faceLocalPhysical(a, N, layerSign)).map((v, i) => v + t[i]);
        if (!vecNear(lhs, rhs, 1e-9)) ok = false;
      }
      if (!ok && layerSign === 1) failing.push(tr.transformId);
      if (layerSign === -1) assert.equal(ok, failing.includes(tr.transformId) === false, `near/far 에서 같은 집합이 실패해야 해요: ${label(tr)}`);
    }
  }
  assert.equal(failing.length, 16, `improper 24 중 실패 수: ${failing.length}`);
  // 통과하는 8 개 = perm 이 축 2 를 고정하는 것(Π 와 가환)
  const passing = X_TRANSFORMS.filter(x => x.parity < 0 && !failing.includes(x.transformId));
  assert.equal(passing.length, 8);
  assert.ok(passing.every(x => x.perm[2] === 2));
});

test('§6.1-11 반례 (ㄴ) far 에서 S 를 빼면(R = R_f·M_pᵀ) 항등식이 pitch 급으로 깨져요 — L2 최대 7·√3 ≈ 12.12 pitch(N8, R_f 무관)', () => {
  const N = 8, t_f = [0, 0, 30];
  for (const R_f of [R_ARB, I3, xRotation({ yaw: -1.2, pitch: 0.8, roll: -0.5 })]) {
    const t = xOutputTranslation(R_f, t_f, N, -1);
    for (const tr of X_TRANSFORMS) {
      const Mp = tr.parity > 0 ? tr.M : mat3Mul(X_ADDRESS_PI, tr.M);
      const Rwrong = mat3Mul(R_f, mat3T(Mp)); // S 누락
      const RPp = tr.parity > 0 ? Rwrong : mat3Mul(Rwrong, X_ADDRESS_PI);
      const { T } = xAddressMap(tr.transformId, -1);
      let maxL2 = 0;
      for (let s = 0; s < N ** 3; s += 1) {
        const a = xSiteCoord(N, s);
        const sc = xSiteFromFaceLocal(a, T, N, [0, 0, 0]);
        const Ps = sc.map(v => v - (N - 1) / 2);
        const lhs = mat3Apply(RPp, Ps).map((v, i) => v + t[i]);
        const rhs = mat3Apply(R_f, faceLocalPhysical(a, N, -1)).map((v, i) => v + t[i]);
        maxL2 = Math.max(maxL2, Math.hypot(lhs[0] - rhs[0], lhs[1] - rhs[1], lhs[2] - rhs[2]));
      }
      assert.ok(near(maxL2, 7 * Math.sqrt(3), 1e-9), `L2 최대 ${maxL2} ≠ 7√3 (${label(tr)})`);
    }
  }
});

test('§6.1-11 반례 (ㄷ) 주소에 Q 대신 S 를 쓰면(T = M·S) det T = +det M 으로 요구 −det M 을 어기고 k 라벨이 반전돼요', () => {
  const N = 8;
  for (const tr of X_TRANSFORMS) {
    const Twrong = mat3Mul(tr.M, X_ADDRESS_S);
    const { T, det } = xAddressMap(tr.transformId, -1);
    assert.equal(det3(Twrong), tr.parity);
    assert.notEqual(det3(Twrong), det);
    for (let s = 0; s < N ** 3; s += 1) {
      const a = xSiteCoord(N, s);
      const good = xSiteFromFaceLocal(a, T, N, [0, 0, 0]);
      const bad = xSiteFromFaceLocal(a, Twrong, N, [0, 0, 0]);
      // 정본 축 r 중 면-국소 k(=2) 축을 받는 행에서 라벨이 N−1−x 로 반전
      const r = tr.perm.indexOf(2);
      assert.equal(bad[r], N - 1 - good[r]);
      for (let q = 0; q < 3; q += 1) if (q !== r) assert.equal(bad[q], good[q]);
    }
  }
});

// ───────────────────────────── §6.1-12 · §6.1-17 ─────────────────────────────

test('§6.1-12 t 변환 · pitchPx_hyp 항등식 — near·far 두 분기 각각 · 48 M: t_out == truth 큐브 중심 t(1e−9) · pitchPx_hyp == frozen xProjectSites().pitchPx · 투영 픽셀 일치', () => {
  const N = 8, pitch = 1;
  const truths = [
    xCameraLookAt({ N, pitch, distanceOverWidth: 3, azimuth: 0.4, elevation: 0.3, roll: 0.1 }),
    xCameraLookAt({ N, pitch, distanceOverWidth: 2.5, azimuth: -1.1, elevation: -0.6, roll: -0.7 }),
  ];
  for (const truth of truths) {
    const proj = xProjectSites({ N, pitch, pose: { R: truth.R, t: truth.t }, camera: CAM });
    for (const layerSign of [1, -1]) {
      for (const tr of X_TRANSFORMS) {
        const { R_f, t_f } = faceLocalPose(truth.R, truth.t, tr.transformId, layerSign, N, pitch);
        const tOut = xOutputTranslation(R_f, t_f, N, layerSign, pitch);
        assert.ok(vecNear(tOut, truth.t, 1e-9), `t 항등식 실패 ${label(tr)} layerSign ${layerSign}`);
        const R = xOutputRotation(R_f, tr.transformId, layerSign);
        assert.ok(xIsRotation(R, 1e-9));
        assert.ok(xRotationAngleDeg(R, truth.R) < 1e-7, `출력 R 이 truth R 과 달라요: ${label(tr)}`);
        const pp = xPitchPxHyp(R_f, t_f, N, layerSign, CAM.fx, pitch);
        assert.ok(near(pp, proj.pitchPx, 1e-9), `pitchPx_hyp ${pp} ≠ frozen pitchPx ${proj.pitchPx}`);
        // 면-국소 주소 a 를 정본 s 로 옮겨 frozen 투영과 같은 픽셀인지(반픽셀 없음, 같은 식) — improper 는 §1.4 소비 규약대로 pose R·Π^p 로 재투영
        const projP = tr.parity > 0 ? proj : xProjectSites({ N, pitch, pose: { R: mat3Mul(R, X_ADDRESS_PI), t: tOut }, camera: CAM });
        const { T } = xAddressMap(tr.transformId, layerSign);
        for (const a of [[0, 0, 0], [N - 1, 0, 0], [0, N - 1, 0], [3, 5, N - 1], [7, 7, 7]]) {
          const s = xSiteFromFaceLocal(a, T, N, [0, 0, 0]);
          const Xc = mat3Apply(R_f, [pitch * a[0], pitch * a[1], pitch * layerSign * a[2]]).map((v, i) => v + t_f[i]);
          const u = CAM.fx * Xc[0] / Xc[2] + CAM.cx, v = CAM.fy * Xc[1] / Xc[2] + CAM.cy;
          const p = projP.points[xSiteId(N, s)];
          assert.ok(near(u, p.u, 1e-9) && near(v, p.v, 1e-9), `픽셀 불일치 ${label(tr)} ls ${layerSign} a=${a}`);
        }
      }
    }
  }
  // 분모 ≤ 0 → NaN(값 거절), 형식 위반 → throw
  assert.ok(Number.isNaN(xPitchPxHyp(I3, [0, 0, -40], N, 1, CAM.fx)));
  assert.throws(() => xPitchPxHyp(I3, [0, 0, 30], N, 0, CAM.fx), RangeError);
  assert.throws(() => xOutputTranslation(I3, [0, 0], N, 1), TypeError);
  assert.throws(() => xOutputTranslation([1, 2], [0, 0, 0], N, 1), TypeError);
  assert.throws(() => xOutputRotation(I3, 0, 2), RangeError);
});

test('§6.1-17 층 부호 반례 자 — far 분기에 h(+1) 을 쓰면 |Δt|/pitch = N−1(N8 → 7), 올바른 h(−1) 은 1e−9 통과, 같은 입력의 far R·주소 항등식도 1e−9', () => {
  const N = 8, pitch = 1;
  const truth = xCameraLookAt({ N, pitch, distanceOverWidth: 3, azimuth: 0.9, elevation: -0.2, roll: 0.4 });
  for (const tr of X_TRANSFORMS) {
    const { R_f, t_f } = faceLocalPose(truth.R, truth.t, tr.transformId, -1, N, pitch);
    const good = xOutputTranslation(R_f, t_f, N, -1, pitch);
    assert.ok(vecNear(good, truth.t, 1e-9));
    const wrong = xOutputTranslation(R_f, t_f, N, 1, pitch); // far 에 +1
    const d = Math.hypot(wrong[0] - truth.t[0], wrong[1] - truth.t[1], wrong[2] - truth.t[2]) / pitch;
    assert.ok(near(d, N - 1, 1e-9), `|Δt|/pitch = ${d} ≠ ${N - 1} (${label(tr)})`);
    // §6.1-11 far 팔: R = R_f·S·M_pᵀ, T = M·Q 에서 X_c 항등식
    const R = xOutputRotation(R_f, tr.transformId, -1);
    const RPp = tr.parity > 0 ? R : mat3Mul(R, X_ADDRESS_PI);
    const { T, det } = xAddressMap(tr.transformId, -1);
    assert.equal(det, -tr.parity);
    for (const a of [[0, 0, 0], [N - 1, N - 1, N - 1], [2, 5, 1], [6, 0, 3]]) {
      const s = xSiteFromFaceLocal(a, T, N, [0, 0, 0]);
      const lhs = mat3Apply(RPp, s.map(v => pitch * (v - (N - 1) / 2))).map((v, i) => v + good[i]);
      const rhs = mat3Apply(R_f, faceLocalPhysical(a, N, -1, pitch)).map((v, i) => v + good[i]);
      assert.ok(vecNear(lhs, rhs, 1e-9));
    }
  }
});

test('§6.1-12 · §6.1-11 «o ≠ 0 팔»(통합 수정 1차) — 부분 시야 오프셋 o 에서 t = t_f + R_f·(h − Π^[far]·Tᵀ·o) 만이 §3.1 항등식 X_c = R·Π^p·P_s + t == R_f·phys(a) + t_f 를 세워요(48 × near/far × o 5 × a 격자, 1e−9) · 카메라 표기 (t_f + R_f·h) − R·Π^p·o 와 1e−12 동치 · 옛 식(o 항 없음)은 |Δt|/pitch = |o| · truth 팔: 사이트 항등으로 유도한 t_f 에서 t_out == truth t · o ≠ 0 인데 M 없으면 TypeError', () => {
  const N = 8, pitch = 1;
  const R_f = R_ARB, t_f = [0.7, -0.4, 30.5];
  const offsets = [[2, 0, 0], [0, -1, 0], [0, 0, -2], [1, 2, 0], [-3, 0, 1]];
  const c = pitch * (N - 1) / 2;
  let checked = 0, maxErr = 0;
  for (const layerSign of [1, -1]) for (const tr of X_TRANSFORMS) {
    const R = xOutputRotation(R_f, tr.transformId, layerSign);
    const RPp = tr.parity > 0 ? R : mat3Mul(R, X_ADDRESS_PI);
    const { T } = xAddressMap(tr.transformId, layerSign);
    const t0 = xOutputTranslation(R_f, t_f, N, layerSign, pitch);
    assert.ok(vecNear(t0, xOutputTranslation(R_f, t_f, N, layerSign, pitch, [0, 0, 0], tr.transformId), 0), 'o = 0 은 옛 식과 비트 동일');
    for (const o of offsets) {
      const t = xOutputTranslation(R_f, t_f, N, layerSign, pitch, o, tr.transformId);
      // 카메라 프레임 표기 t = (t_f + R_f·h) − R·Π^p·o 와 동치
      const shift = mat3Apply(RPp, o.map(v => v * pitch));
      assert.ok(vecNear(t, t0.map((v, i) => v - shift[i]), 1e-12), `카메라 표기 불일치 ${label(tr)} ls ${layerSign} o=${o}`);
      // 옛 식(o 항 없음)은 정확히 |o|·pitch 어긋나요(R·Π^p 가 직교라 노름 보존)
      assert.ok(near(Math.hypot(...t0.map((v, i) => v - t[i])) / pitch, Math.hypot(...o), 1e-9), `|Δt|/pitch ≠ |o| ${label(tr)}`);
      let n = 0;
      for (let ai = 0; ai < N; ai += 1) for (let aj = 0; aj < N; aj += 1) for (let ak = 0; ak < N; ak += 1) {
        const a = [ai, aj, ak];
        const s = xSiteFromFaceLocal(a, T, N, o);
        if (s === null) continue; // 오프셋 때문에 [0, N)³ 밖으로 밀린 a — 값 거절
        const lhs = mat3Apply(RPp, [pitch * (s[0] - c), pitch * (s[1] - c), pitch * (s[2] - c)]).map((v, i) => v + t[i]);
        const rhs = mat3Apply(R_f, [pitch * a[0], pitch * a[1], pitch * layerSign * a[2]]).map((v, i) => v + t_f[i]);
        for (let i = 0; i < 3; i += 1) maxErr = Math.max(maxErr, Math.abs(lhs[i] - rhs[i]));
        assert.ok(vecNear(lhs, rhs, 1e-9), `o ≠ 0 항등식 실패 ${label(tr)} ls ${layerSign} o=${o} a=${a}`);
        n += 1;
      }
      assert.equal(n, o.reduce((p, v) => p * (N - Math.abs(v)), 1), `범위 안 a 수 ≠ ∏(N − |o_k|): ${n}`); // 축마다 |o_k| 행이 밖으로 밀려요
      checked += n;
    }
  }
  const perOffset = offsets.reduce((s, o) => s + o.reduce((p, v) => p * (N - Math.abs(v)), 1), 0);
  assert.equal(checked, 48 * 2 * perOffset);
  assert.ok(maxErr <= 1e-9, `maxErr ${maxErr}`);
  // truth 팔 — t_f 를 «사이트 항등식» 으로 유도(h/o 식을 쓰지 않음): X_c(a) = R_true·Π^p·(s − c) + t_true = R_f·phys(a) + t_f
  const truth = xCameraLookAt({ N, pitch, distanceOverWidth: 2, azimuth: 0.5, elevation: -0.3, roll: 0.2 });
  let truthChecked = 0;
  for (const layerSign of [1, -1]) for (const tr of X_TRANSFORMS) for (const o of offsets) {
    const { R_f: Rf } = faceLocalPose(truth.R, truth.t, tr.transformId, layerSign, N, pitch);
    const RPpTrue = tr.parity > 0 ? truth.R : mat3Mul(truth.R, X_ADDRESS_PI);
    const { T } = xAddressMap(tr.transformId, layerSign);
    const a = [3, 4, 3]; // 어느 부호 순열에서도 성분이 {3, 4} 라 |o_k| ≤ 3 이면 s ∈ [0, 8) 안
    const s = xSiteFromFaceLocal(a, T, N, o);
    assert.ok(s !== null);
    const Xc = mat3Apply(RPpTrue, [pitch * (s[0] - c), pitch * (s[1] - c), pitch * (s[2] - c)]).map((v, i) => v + truth.t[i]);
    const RfA = mat3Apply(Rf, [pitch * a[0], pitch * a[1], pitch * layerSign * a[2]]);
    const tf = Xc.map((v, i) => v - RfA[i]);
    const tOut = xOutputTranslation(Rf, tf, N, layerSign, pitch, o, tr.transformId);
    assert.ok(vecNear(tOut, truth.t, 1e-9), `truth 팔 실패 ${label(tr)} ls ${layerSign} o=${o}: ${tOut} ≠ ${truth.t}`);
    const tOld = xOutputTranslation(Rf, tf, N, layerSign, pitch);
    assert.ok(near(Math.hypot(...tOld.map((v, i) => v - truth.t[i])) / pitch, Math.hypot(...o), 1e-9));
    truthChecked += 1;
  }
  assert.equal(truthChecked, 48 * 2 * offsets.length);
  // 형식 위반
  assert.throws(() => xOutputTranslation(R_f, t_f, N, 1, pitch, [1, 0, 0]), TypeError, 'o ≠ 0 인데 M 없음');
  assert.throws(() => xOutputTranslation(R_f, t_f, N, 1, pitch, [0.5, 0, 0], 0), TypeError, 'o 비정수');
  assert.throws(() => xOutputTranslation(R_f, t_f, N, 1, pitch, [1, 0], 0), TypeError, 'o 길이');
  assert.throws(() => xOutputTranslation(R_f, t_f, N, 1, pitch, [1, 0, 0], 48), RangeError, 'M 범위 밖');
});

// ───────────────────────────── §6.1-13 ─────────────────────────────

test('§6.1-13 고정 비트 지도 — 21 행 F_eff 를 자기 자신에 항등으로 대면 conflict 0 · support = 점등 수 · 구성상 항상 0 사이트는 known 밖 · fingerprint 형식', () => {
  const maps = xEffectiveMaps();
  assert.equal(maps.length, 21);
  maps.forEach((m, i) => {
    assert.equal(m.profile, X_PROFILE_IDS[Math.floor(i / 7)]);
    assert.equal(m.finderId, X_FINDER_IDS[i % 7]);
    assert.equal(m.N, xProfile(m.profile).N);
    assert.equal(m.known.length, m.N ** 3);
    assert.match(m.fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(xEffectiveMap(m.profile, m.finderId), m); // 캐시 동일 객체
    const lit = [];
    let on = 0;
    for (let s = 0; s < m.known.length; s += 1) { if (m.known[s] && m.bits[s]) { lit.push(s); on += 1; } if (!m.known[s]) assert.equal(m.bits[s], 0); }
    const { support, conflict } = xCountSupport({ map: m, siteIds: lit.map(s => xTransformSite(m.N, I3, s)) });
    assert.equal(conflict, 0);
    assert.equal(support, on);
    // F_eff = 중심 ∪ finderSpecEffective.levels — 그 밖(잔여·탈락 트리플 비구조·데이터)은 known 0
    const L = xProfileLayout(m.profile, { finderId: m.finderId });
    const expectKnown = new Set([...L.raw.cells.map(c => c.centre), ...L.finderSpecEffective.levels.keys()]);
    for (let s = 0; s < m.known.length; s += 1) assert.equal(m.known[s] === 1, expectKnown.has(s));
    for (const c of L.raw.cells) assert.equal(m.bits[c.centre], 1);
    for (const [s, lv] of L.finderSpecEffective.levels) assert.equal(m.bits[s], lv ? 1 : 0);
  });
  assert.throws(() => xEffectiveMap('X9', 'edge-all-v0'), RangeError);
  assert.throws(() => xEffectiveMap('X0', 'edge-none'), RangeError);
});

test('§6.1-13 (ㄱ) 별칭 분할 유도 — {X0: m1s3-v0 ≡ m1s3sym-v0 · m1s3-w1 ≡ m1s3sym-w1 · X0g: 같은 두 쌍 · X1: 없음}, known 만 같은 edge-all-v0/-w1 은 별칭 아님', () => {
  const idx = id => X_FINDER_IDS.indexOf(id);
  const expectPairs = [[idx('edge-m1s3-v0'), idx('edge-m1s3sym-v0')], [idx('edge-m1s3-w1'), idx('edge-m1s3sym-w1')]];
  for (const p of ['X0', 'X0g']) {
    const classes = xAliasClasses(p);
    assert.deepEqual(classes, [[0], [1], expectPairs[0], expectPairs[1], [6]]);
  }
  assert.deepEqual(xAliasClasses('X1'), [[0], [1], [2], [3], [4], [5], [6]]);
  // known 동일 · bits 상이 쌍(edge-all-v0 / edge-all-w1)은 별칭이 아니에요
  for (const p of X_PROFILE_IDS) {
    const a = xEffectiveMap(p, 'edge-all-v0'), b = xEffectiveMap(p, 'edge-all-w1');
    let knownSame = true, bitsDiffer = false;
    for (let s = 0; s < a.known.length; s += 1) { if (a.known[s] !== b.known[s]) knownSame = false; if (a.known[s] && a.bits[s] !== b.bits[s]) bitsDiffer = true; }
    assert.ok(knownSame && bitsDiffer, `${p}: known 동일(${knownSame}) · bits 상이(${bitsDiffer})`);
  }
});

test('§6.1-13 (ㄴ) 별칭 두 finder 의 (support, conflict) 는 임의 (pose, o) 격자 · 48 M · near/far 전부에서 비트 동일', () => {
  const rng = mulberry32(3342300003);
  for (const p of ['X0', 'X0g']) for (const [fa, fb] of [['edge-m1s3-v0', 'edge-m1s3sym-v0'], ['edge-m1s3-w1', 'edge-m1s3sym-w1']]) {
    const A = xEffectiveMap(p, fa), B = xEffectiveMap(p, fb);
    const N = A.N;
    // «관측» = A 의 점등 사이트 중 결정적 부분집합 + 데이터 사이트 몇 개(면-국소 주소로 씀)
    const obs = [];
    for (let s = 0; s < N ** 3; s += 1) if ((A.known[s] && A.bits[s] && rng() < 0.6) || (!A.known[s] && rng() < 0.05)) obs.push(xSiteCoord(N, s));
    let checked = 0;
    for (const layerSign of [1, -1]) for (const tr of X_TRANSFORMS) {
      const { T } = xAddressMap(tr.transformId, layerSign);
      for (const o of [[0, 0, 0], [1, 0, 0], [0, -1, 0], [-1, 1, 1], [2, 2, -2]]) {
        const siteIds = obs.map(a => { const s = xSiteFromFaceLocal(a, T, N, o); return s === null ? null : xSiteId(N, s); });
        assert.deepEqual(xCountSupport({ map: A, siteIds }), xCountSupport({ map: B, siteIds }));
        checked += 1;
      }
    }
    assert.equal(checked, 2 * 48 * 5);
  }
});

// ───────────────────────────── §6.1-14 · §6.1-15 ─────────────────────────────

test('§6.1-14 보편 점등 인덱스 — U(profile, finder) 가 §2.4 표 13 행과 일치 · N−2 는 어느 U 에도 없음 · 유일 (N,kB,kD) N8 14 · N10 19 · 합 33', () => {
  const U_TABLE = {
    X0: { 'edge-all-v0': [0, 2, 3, 5, 7], 'edge-m1s2-v0': [0, 2, 7], 'edge-m1s3-v0': [0, 2, 7], 'edge-m1s3sym-v0': [0, 2, 7], 'edge-m1s3-w1': [0, 7], 'edge-m1s3sym-w1': [0, 7], 'edge-all-w1': [0, 2, 5, 7] },
    X0g: { 'edge-all-v0': [0, 2, 3, 5, 7], 'edge-m1s2-v0': [0, 2, 7], 'edge-m1s3-v0': [0, 2, 7], 'edge-m1s3sym-v0': [0, 2, 7], 'edge-m1s3-w1': [0, 7], 'edge-m1s3sym-w1': [0, 7], 'edge-all-w1': [0, 2, 5, 7] },
    X1: { 'edge-all-v0': [0, 2, 3, 5, 7, 9], 'edge-m1s2-v0': [0, 2, 6, 9], 'edge-m1s3-v0': [0, 2, 9], 'edge-m1s3sym-v0': [0, 2, 7, 9], 'edge-all-w1': [0, 2, 7, 9], 'edge-m1s3-w1': [0, 9], 'edge-m1s3sym-w1': [0, 9] },
  };
  let rows = 0;
  for (const p of X_PROFILE_IDS) for (const f of X_FINDER_IDS) {
    const U = xUniversalLitIndices(p, f);
    assert.deepEqual(U, U_TABLE[p][f], `${p} × ${f}`);
    assert.ok(!U.includes(xProfile(p).N - 2), `${p} × ${f}: N−2 가 U 에 있어요`);
    rows += 1;
  }
  assert.equal(rows, 21);
  const tt = xTripleIndexTable();
  assert.equal(tt.length, 33);
  assert.equal(tt.filter(r => r.N === 8).length, 14);
  assert.equal(tt.filter(r => r.N === 10).length, 19);
  tt.forEach((r, i) => {
    assert.equal(r.tripleIndex, i);
    if (i > 0) { const q = tt[i - 1]; assert.ok(q.N < r.N || (q.N === r.N && (q.kB < r.kB || (q.kB === r.kB && q.kD < r.kD))), '(N, kB, kD) 오름'); }
    assert.ok(r.kB !== 0 && r.kD !== 0 && r.kB !== r.N - 2 && r.kD !== r.N - 2);
  });
  // §2.4 의 명시 순서쌍 몇 개(N8 (2,2)·(2,7)·(7,2)·(2,5)·(5,2) · N10 (2,6)·(6,9)·(2,7)·(9,9))가 표에 있어요
  const has = (N, kB, kD) => tt.some(r => r.N === N && r.kB === kB && r.kD === kD);
  for (const [N, kB, kD] of [[8, 2, 2], [8, 2, 7], [8, 7, 2], [8, 2, 5], [8, 5, 2], [8, 7, 7], [10, 2, 6], [10, 6, 9], [10, 2, 7], [10, 9, 9], [10, 5, 7]]) assert.ok(has(N, kB, kD), `(${N},${kB},${kD})`);
  assert.ok(!has(8, 3, 2) && !has(10, 5, 2), '집합을 넘는 순서쌍은 없어요');
  assert.equal(xTripleIndexTable(), tt); // 동결·캐시
  assert.ok(Object.isFrozen(tt));
});

test('§6.1-15 면 평면 구성 — 6 면 각각의 (고정1/고정0/데이터) 가 §2.5 표(범위)와 일치', () => {
  const TABLE = [
    ['X0', 'edge-all-v0', [22, 22], [12, 12], [30, 30]],
    ['X0', 'edge-m1s3-v0', [14, 14], [12, 12], [38, 38]],
    ['X0', 'edge-m1s3-w1', [13, 15], [11, 13], [38, 38]],
    ['X0g', 'edge-all-v0', [25, 27], [10, 12], [27, 27]],
    ['X0g', 'edge-m1s3-v0', [19, 21], [10, 12], [32, 33]],
    ['X1', 'edge-all-v0', [30, 33], [12, 15], [54, 55]],
    ['X1', 'edge-m1s3-v0', [21, 22], [9, 12], [67, 69]],
  ];
  for (const [p, f, f1, f0, d] of TABLE) {
    const faces = xFacePlaneComposition(p, f);
    assert.equal(faces.length, 6);
    const N = xProfile(p).N;
    faces.forEach((face, i) => {
      assert.equal(face.axis, Math.floor(i / 2)); assert.equal(face.value, i % 2 === 0 ? 0 : N - 1);
      assert.equal(face.fixed1 + face.fixed0 + face.data, N * N);
      assert.ok(face.fixed1 >= f1[0] && face.fixed1 <= f1[1], `${p} × ${f} 면 ${i} 고정1 ${face.fixed1} ∉ [${f1}]`);
      assert.ok(face.fixed0 >= f0[0] && face.fixed0 <= f0[1], `${p} × ${f} 면 ${i} 고정0 ${face.fixed0} ∉ [${f0}]`);
      assert.ok(face.data >= d[0] && face.data <= d[1], `${p} × ${f} 면 ${i} 데이터 ${face.data} ∉ [${d}]`);
    });
    // 표의 «범위» 양끝이 실제로 어느 면에선가 나오는지(범위를 넓게 잡아 통과시키는 구현 방지)
    assert.equal(Math.min(...faces.map(x => x.fixed1)), f1[0]);
    assert.equal(Math.max(...faces.map(x => x.fixed1)), f1[1]);
  }
});

// ───────────────────────────── §6.1-16 ─────────────────────────────

test('§6.1-16 음의 증거 불사용 — 관측을 진부분집합으로 줄여도(support 사이트 제거) conflict 불변 · 어떤 축소도 conflict 를 늘리지 않음 · 구성상 항상 0 인 사이트는 어느 셈에도 안 듦', () => {
  const map = xEffectiveMap('X0', 'edge-m1s3-v0');
  const N = map.N;
  // 관측: 점등 사이트 전부 + known-0 사이트 몇 개(모순) + known 밖(구성상 0) 사이트 몇 개
  const lit = [], off = [], unknown = [];
  for (let s = 0; s < N ** 3; s += 1) { if (map.known[s]) (map.bits[s] ? lit : off).push(s); else unknown.push(s); }
  const conflictSites = off.filter((_, i) => i % 5 === 0);
  const darkAlwaysZero = unknown.filter((_, i) => i % 7 === 0);
  const full = [...lit, ...conflictSites, ...darkAlwaysZero];
  const base = xCountSupport({ map, siteIds: full });
  assert.equal(base.support, lit.length);
  assert.equal(base.conflict, conflictSites.length);
  // (ㄱ) support 사이트만 빼면 conflict 불변
  for (const keepEvery of [2, 3, 5]) {
    const reduced = [...lit.filter((_, i) => i % keepEvery === 0), ...conflictSites, ...darkAlwaysZero];
    const r = xCountSupport({ map, siteIds: reduced });
    assert.equal(r.conflict, base.conflict);
    assert.ok(r.support < base.support);
  }
  // (ㄴ) 어떤 진부분집합도 conflict 를 늘리지 않음(단조)
  const rng = mulberry32(3342300003);
  for (let trial = 0; trial < 50; trial += 1) {
    const sub = full.filter(() => rng() < 0.5);
    const r = xCountSupport({ map, siteIds: sub });
    assert.ok(r.conflict <= base.conflict && r.support <= base.support);
  }
  // (ㄷ) 구성상 항상 0 인 사이트: known 밖이라 그 위의 blob 도, 그 사이트가 어둡다는 사실도 어느 셈에도 안 들어가요
  const onlyUnknown = xCountSupport({ map, siteIds: darkAlwaysZero });
  assert.deepEqual(onlyUnknown, { support: 0, conflict: 0 });
  assert.deepEqual(xCountSupport({ map, siteIds: [] }), { support: 0, conflict: 0 }); // 전부 어두움 = 증거 0
  assert.deepEqual(xCountSupport({ map, siteIds: [null, lit[0], null] }), { support: 1, conflict: 0 }); // null = 미매칭 건너뜀
  assert.throws(() => xCountSupport({ map, siteIds: [N ** 3] }), RangeError);
  assert.throws(() => xCountSupport({ map: { known: [1] }, siteIds: [] }), TypeError);
  // fixedBitUndetermined — inFrame ∧ known ∧ 제외(모호/겹침)만, 어두운 사이트(제외 목록에 없음)는 0
  const inFrame = [...lit.slice(0, 20), ...off.slice(0, 5), ...unknown.slice(0, 5)];
  assert.equal(xUndeterminedCount({ map, predictedInFrame: inFrame, excludedSiteIds: [] }), 0);
  assert.equal(xUndeterminedCount({ map, predictedInFrame: inFrame, excludedSiteIds: [lit[0], lit[1], off[0], unknown[0], unknown[1]] }), 3);
  assert.equal(xUndeterminedCount({ map, predictedInFrame: inFrame, excludedSiteIds: [lit[0], lit[0]] }), 1); // 중복 1 회
  assert.equal(xUndeterminedCount({ map, predictedInFrame: inFrame, excludedSiteIds: [lit[30]] }), 0); // inFrame 밖
});

// ───────────────────────────── §6.1-39 ─────────────────────────────

test('§6.1-39 (ㄱ) Stab(F_eff) 유도 — 21 행 전부 |Stab| = 1 · |Stab ∩ SO(3)| = 1, rd3 recount CF exactStabilizer · 48 descriptor 와 일치(TL_X_RECOUNT_JSON 필수)', () => {
  for (const p of X_PROFILE_IDS) for (const f of X_FINDER_IDS) {
    const st = xStabilizer(p, f);
    assert.deepEqual(st, { ids: [0], proper: [0] }, `${p} × ${f}: Stab = ${JSON.stringify(st)}`);
  }
  const recount = loadRecount();
  // recount 의 transformIds 순서 == 우리 인코딩(perm 사전순 × sign + 먼저)
  assert.deepEqual(recount.transformIds, X_TRANSFORMS.map(label));
  assert.equal(recount.results.length, 12);
  for (const row of recount.results) {
    const map = xEffectiveMap(row.profileId, row.finderId);
    assert.equal(map.N, row.N);
    let known = 0, on = 0;
    for (let s = 0; s < map.known.length; s += 1) if (map.known[s]) { known += 1; if (map.bits[s]) on += 1; }
    assert.equal(known, row.counts.CF.known, `${row.profileId} × ${row.finderId} CF known`);
    assert.equal(on, row.counts.CF.on, `${row.profileId} × ${row.finderId} CF on`);
    const cf = row.structure.CF;
    assert.deepEqual(cf.properNonIdentity.exactStabilizerIds, []);
    assert.deepEqual(cf.improper.exactStabilizerIds, []);
    assert.deepEqual(cf.transforms.filter(t => t.exactStabilizer).map(t => t.id), ['p012s+++']);
    const st = xStabilizer(row.profileId, row.finderId);
    assert.deepEqual(st.ids.map(i => label(X_TRANSFORMS[i])), cf.transforms.filter(t => t.exactStabilizer).map(t => t.id));
    // 48 descriptor 다중집합(recount 정의: J = K ∩ gK 위 support · 0↔1 contradictions) 일치
    assert.equal(cf.transforms.length, 48);
    cf.transforms.forEach((t, i) => {
      assert.equal(t.id, label(X_TRANSFORMS[i]));
      assert.equal(t.det, X_TRANSFORMS[i].parity);
      assert.deepEqual(recountDescriptor(map, X_TRANSFORMS[i]), { support: t.support, contradictions: t.contradictions }, `${row.profileId} × ${row.finderId} ${t.id}`);
    });
  }
});

test('§6.1-39 (ㄴ) 합성 팔(finder-only 지도) — X0 × edge-all-v0 |Stab| = 6 · proper 3 · 잉여류 Stab·M*(proper 24 전부 일치) vs M*·Stab(48 중 36 · proper 24 중 18 불일치) · improper M 팔', () => {
  const N = 8;
  const L = xProfileLayout('X0', { finderId: 'edge-all-v0' });
  const known = new Uint8Array(N ** 3), bits = new Uint8Array(N ** 3);
  for (const [s, lv] of L.finderSpecEffective.levels) { known[s] = 1; bits[s] = lv ? 1 : 0; } // 중심 제외 = finder-only
  const st = xStabilizer({ N, known, bits });
  assert.equal(st.ids.length, 6);
  assert.equal(st.proper.length, 3);
  assert.ok(st.ids.includes(0) && st.proper.includes(0));
  const recount = loadRecount();
  const rowF = recount.results.find(r => r.profileId === 'X0' && r.finderId === 'edge-all-v0').structure.F;
  const expectIds = ['p012s+++', ...rowF.properNonIdentity.exactStabilizerIds, ...rowF.improper.exactStabilizerIds].sort();
  assert.deepEqual(st.ids.map(i => label(X_TRANSFORMS[i])).sort(), expectIds);
  // §5.1-2 몫: min over g ∈ Stab∩SO(3) angle(R_M, R_{g·M*}) — proper M · proper M*
  const R_f = R_ARB;
  const Rof = id => xOutputRotation(R_f, id, 1);
  const quotient = (M, Mstar) => Math.min(...st.proper.map(g => xRotationAngleDeg(Rof(M), Rof(xTransformCompose(g, Mstar)))));
  const proper = X_TRANSFORMS.filter(t => t.parity > 0).map(t => t.transformId);
  let mismatchRight24 = 0, mismatchRight48 = 0;
  for (let ms = 0; ms < 48; ms += 1) {
    const left = new Set(st.ids.map(g => xTransformCompose(g, ms)));   // Stab·M*
    const right = new Set(st.ids.map(g => xTransformCompose(ms, g)));  // M*·Stab
    const same = left.size === right.size && [...left].every(x => right.has(x));
    if (!same) { mismatchRight48 += 1; if (X_TRANSFORMS[ms].parity > 0) mismatchRight24 += 1; }
    if (X_TRANSFORMS[ms].parity > 0) {
      const A = proper.filter(M => quotient(M, ms) < 1e-7);
      const B = proper.filter(M => left.has(M));
      assert.deepEqual(A, B, `M* ${label(X_TRANSFORMS[ms])}: 몫 0 집합 ≠ Stab·M*`);
      const Bp = proper.filter(M => right.has(M));
      if (!same) assert.notDeepEqual(A, Bp, `M* ${label(X_TRANSFORMS[ms])}: M*·Stab 이 같으면 방향 검산이 아니에요`);
    }
  }
  assert.equal(mismatchRight48, 36);
  assert.equal(mismatchRight24, 18);
  // improper M 팔: M = g·M*(g improper stab) 는 §5.1-3 정답이지만 §5.1-2 몫은 0 이 아니라 angle(Π·g·g') — 전치 g 는 180°
  const improperStab = st.ids.filter(g => X_TRANSFORMS[g].parity < 0);
  assert.equal(improperStab.length, 3);
  let pairs = 0;
  for (const ms of proper) for (const g of improperStab) {
    const M = xTransformCompose(g, ms);
    assert.equal(X_TRANSFORMS[M].parity, -1);
    assert.ok(new Set(st.ids.map(h => xTransformCompose(h, ms))).has(M)); // §5.1-3 정답(잉여류 원소)
    const q = quotient(M, ms);
    assert.ok(q > 1, `improper M 의 몫이 0 근처(${q}) 면 두 지표가 갈리지 않아요`);
    pairs += 1;
  }
  assert.equal(pairs, 72);
  // g = i ↔ j 전치(perm (1,0,2) · 전부 +, id 16) 에서 Π·g = S 는 (1,1,0) 둘레 180° 회전
  const g16 = 16;
  assert.ok(improperStab.includes(g16));
  assert.deepEqual([...X_TRANSFORMS[g16].perm], [1, 0, 2]);
  assert.deepEqual(mat3Mul(X_ADDRESS_PI, X_TRANSFORMS[g16].M), [...X_ADDRESS_S]);
  assert.ok(near(xRotationAngleDeg(mat3Mul(X_ADDRESS_PI, X_TRANSFORMS[g16].M), I3), 180, 1e-9));
});

// ───────────────────────────── §6.2-22 ─────────────────────────────

test('§6.2-22 단계 0 판정 — extent-exceeds-N(우선) · cross-N-implausible(N8 관측 × X1 쌍을 N10 finalist E_k 로) · evaluate · 그 N 의 쌍만', () => {
  assert.deepEqual(xPairsOfN(8), ['X0', 'X0g']);
  assert.deepEqual(xPairsOfN(10), ['X1']);
  // N8 관측을 N10 finalist(삼중 축척)로 재면 E_k ≤ 8 = 10 − 2 → X1 쌍 cross-N
  assert.deepEqual(xStage0Filter({ finalistsByN: { 10: [8, 8, 8] }, N: 10 }), [{ pair: 'X1', verdict: 'cross-N-implausible' }]);
  assert.deepEqual(xStage0Filter({ finalistsByN: { 8: [8, 8, 8], 10: [8, 8, 8] }, N: 8 }), [{ pair: 'X0', verdict: 'evaluate' }, { pair: 'X0g', verdict: 'evaluate' }]);
  assert.deepEqual(xStage0Filter({ finalistsByN: { 10: [10, 9, 10] }, N: 10 }), [{ pair: 'X1', verdict: 'evaluate' }]);
  assert.deepEqual(xStage0Filter({ finalistsByN: { 8: [9, 8, 8] }, N: 8 }).map(x => x.verdict), ['extent-exceeds-N', 'extent-exceeds-N']);
  assert.deepEqual(xStage0Filter({ finalistsByN: { 8: [9, 5, 8] }, N: 8 }).map(x => x.verdict), ['extent-exceeds-N', 'extent-exceeds-N']); // 둘 다 걸리면 extent 우선(한 번만)
  assert.deepEqual(xStage0Filter({ finalistsByN: { 8: [7, 6, 8] }, N: 8 }).map(x => x.verdict), ['cross-N-implausible', 'cross-N-implausible']);
  assert.deepEqual(xStage0Filter({ finalistsByN: { 8: [7, 7, 8] }, N: 8 }).map(x => x.verdict), ['evaluate', 'evaluate']); // E_k = N−1 은 통과
  assert.deepEqual(xStage0Filter({ finalistsByN: { 8: [8, 8, 8] }, N: 8, pairs: ['X0g'] }), [{ pair: 'X0g', verdict: 'evaluate' }]);
  assert.throws(() => xStage0Filter({ finalistsByN: {}, N: 8 }), TypeError); // 그 N 의 finalist 없음 = 판정 불가(호출자가 (ㄴ′)/N′ 규칙 적용)
  assert.throws(() => xStage0Filter({ finalistsByN: { 8: [8, 8, 8] }, N: 9.5 }), RangeError);
  // extent
  assert.deepEqual(xExtent([]), [0, 0, 0]);
  assert.deepEqual(xExtent([[0, 0, 0], [7, 4, 0], [3, 7, 0]]), [8, 8, 1]);
  assert.deepEqual(xExtent([[2, 3, 1]]), [1, 1, 1]);
  assert.throws(() => xExtent([[0.5, 0, 0]]), TypeError);
});

test('§6.2-22 오프셋 정의역 — 전체 시야 Ω 1 · o = (0,0,0) · E=(5,8,8) → Ω 4 · E=(5,5,8) → Ω 16 > Ω_max 8 · sign −1 은 음수 먼저 · 축 짝짓기(순열 M) · far Q · s ∈ [0,N)³', () => {
  const N = 8;
  const full = xOffsetRange(I3, [8, 8, 8], N);
  assert.deepEqual(full, { omega: 1, offsets: [[0, 0, 0]] });
  const r4 = xOffsetRange(I3, [5, 8, 8], N);
  assert.equal(r4.omega, 4);
  assert.deepEqual(r4.offsets, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
  const r16 = xOffsetRange(I3, [5, 5, 8], N);
  assert.equal(r16.omega, 16);
  assert.ok(r16.omega > 8);
  assert.equal(r16.offsets.length, 16);
  // 사전순(각 축 오름)
  for (let i = 1; i < r16.offsets.length; i += 1) {
    const a = r16.offsets[i - 1], b = r16.offsets[i];
    assert.ok(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))));
  }
  // sign −1 축: {−(N−E), …, 0}
  const neg = xOffsetRange([-1, 0, 0, 0, 1, 0, 0, 0, 1], [5, 8, 8], N);
  assert.deepEqual(neg.offsets, [[-3, 0, 0], [-2, 0, 0], [-1, 0, 0], [0, 0, 0]]);
  // 축 짝짓기(R7-31): T 의 r 행이 가리키는 면-국소 축의 E_k — perm (1,0,2) 면 정본 축 1 이 면-국소 축 0 의 E 를 받아요
  const P = X_TRANSFORMS.find(t => t.perm.join('') === '102' && t.sign.every(v => v === 1)).M;
  const sw = xOffsetRange(P, [5, 8, 8], N);
  assert.deepEqual(sw.offsets, [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0]]);
  // N10 × X1 쌍의 부분 시야
  assert.equal(xOffsetRange(I3, [8, 10, 10], 10).omega, 3);
  // E_k > N 이면 그 축 0 개 → Ω 0(빈 열거, throw 아님)
  assert.deepEqual(xOffsetRange(I3, [9, 8, 8], N), { omega: 0, offsets: [] });
  assert.throws(() => xOffsetRange([1, 1, 0, 0, 1, 0, 0, 0, 1], [8, 8, 8], N), RangeError);
  assert.throws(() => xOffsetRange(I3, [8, 8], N), TypeError);
  // §6.3-44 성질(A 팔): 부분 시야 + 축 순열 M + far Q + 오프셋 전 열거에서 재구성 s ∈ [0,N)³ 이고 오프셋마다 서로 다른 위치로 떨어져요
  const E = [5, 6, 8];
  const pts = [];
  for (let i = 0; i < E[0]; i += 1) for (let j = 0; j < E[1]; j += 1) for (let k = 0; k < E[2]; k += 1) pts.push([i, j, k]);
  assert.deepEqual(xExtent(pts), E);
  for (const layerSign of [1, -1]) for (const tr of X_TRANSFORMS) {
    const { T } = xAddressMap(tr.transformId, layerSign);
    const { omega, offsets } = xOffsetRange(T, E, N);
    assert.equal(omega, 4 * 3 * 1);
    const images = new Set();
    for (const o of offsets) {
      const key = [];
      for (const p of pts) {
        const s = xSiteFromFaceLocal(p, T, N, o);
        assert.ok(s !== null && s.every(v => Number.isInteger(v) && v >= 0 && v < N), `${label(tr)} ls ${layerSign} o=${o} p=${p} → ${s}`);
        key.push(xSiteId(N, s));
      }
      images.add(key.join(','));
    }
    assert.equal(images.size, omega);
    // 정의역 밖 오프셋은 null(값 거절)
    assert.equal(xSiteFromFaceLocal([0, 0, 0], T, N, [N, 0, 0]), null);
  }
  assert.equal(xSiteFromFaceLocal([0, 0, 0], I3, N, [-1, 0, 0]), null);
  assert.throws(() => xSiteFromFaceLocal([0, 0], I3, N, [0, 0, 0]), TypeError);
  assert.throws(() => xSiteFromFaceLocal([0, 0, 0], I3, N, [0.5, 0, 0]), TypeError);
});

// ───────────────────────────── §6.2-23 ─────────────────────────────

test('§6.2-23 별칭 클래스 단위 · 라벨 키 — 클래스 대표 = X_FINDER_IDS 인덱스 최소 · 두 별칭 finder 는 한 클래스(슬롯 1 개의 근거) · xLabelKey', () => {
  const classes = xAliasClasses('X0');
  const idx = id => X_FINDER_IDS.indexOf(id);
  const cls = classes.find(c => c.includes(idx('edge-m1s3-v0')));
  assert.deepEqual(cls, [idx('edge-m1s3-v0'), idx('edge-m1s3sym-v0')]);
  assert.equal(X_FINDER_IDS[Math.min(...cls)], 'edge-m1s3-v0'); // 대표
  assert.equal(classes.flat().length, 7);
  assert.deepEqual([...classes.flat()].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]); // 분할
  classes.forEach((c, i) => { if (i > 0) assert.ok(c[0] > classes[i - 1][0]); for (let j = 1; j < c.length; j += 1) assert.ok(c[j] > c[j - 1]); });
  assert.equal(xLabelKey('X0', 'edge-m1s3-v0'), 'X0|edge-m1s3-v0');
  assert.equal(xLabelKey(X_PROFILE_IDS[2], X_FINDER_IDS[6]), 'X1|edge-all-w1');
  // 별칭 두 finder 의 지도가 완전 동일하므로 (support, conflict) 는 구성상 같아요(37/35 같은 입력은 이 registry 에서 불가능)
  const A = xEffectiveMap('X0', 'edge-m1s3-v0'), B = xEffectiveMap('X0', 'edge-m1s3sym-v0');
  assert.deepEqual([...A.known], [...B.known]);
  assert.deepEqual([...A.bits], [...B.bits]);
  assert.notEqual(A.fingerprint, B.fingerprint); // 구조 지문(finderId 포함)은 달라요 — 별칭은 F_eff 동일성으로만 유도
});

// ───────────────────────────── §6.2-42 · §6.2-43 ─────────────────────────────

test('§6.2-42 회계 항등식 서로소 — 무작위 coverage 100 벌(seed 3342300003)에서 합 1,008 · 다섯 집합 서로소 · 중복/누락 검출 · extent 우선 1 회 · N′ finalist 0 · v6 B8 미도달 팔', () => {
  assert.equal(X_ADDRESS_TESTS_TOTAL, 1008);
  const all = [];
  for (let i = 0; i < 1008; i += 1) all.push(xLabelFromIndex(i));
  all.forEach((l, i) => assert.equal(xLabelIndex(...l), i));
  const rng = mulberry32(3342300003);
  for (let trial = 0; trial < 100; trial += 1) {
    const buckets = [[], [], [], [], []];
    for (const l of all) buckets[Math.floor(rng() * 5)].push(l);
    const cov = { evaluatedLabels: buckets[0], rejectedCrossNLabels: buckets[1], rejectedExtentLabels: buckets[2], rejectedGeometryLabels: buckets[3], unexplored: buckets[4] };
    const r = xCoverageIdentity(cov);
    assert.ok(r.ok && r.disjoint && r.sum === 1008, JSON.stringify(r));
    assert.equal(r.evaluated + r.rejectedCrossN + r.rejectedExtent + r.rejectedGeometry + r.unexplored, 1008);
    // 유도한 unexplored 가 4 집합의 여집합과 같아요(사전순)
    const derived = xUnexploredDerive({ evaluatedLabels: buckets[0], rejectedLabels: [...buckets[1], ...buckets[2], ...buckets[3]] });
    const expect = [...buckets[4]].sort((a, b) => xLabelIndex(...a) - xLabelIndex(...b));
    assert.deepEqual(derived, expect);
    // 한 표지를 두 집합에 넣으면 서로소 위반
    if (buckets[0].length && buckets[1].length) {
      const dup = xCoverageIdentity({ ...cov, rejectedCrossNLabels: [...buckets[1], buckets[0][0]] });
      assert.equal(dup.ok, false); assert.equal(dup.disjoint, false);
    }
    // 하나 빠지면 합 1,007
    const missing = xCoverageIdentity({ ...cov, unexplored: buckets[4].slice(1) });
    assert.equal(missing.ok, buckets[4].length === 0 ? true : false);
  }
  // extent 우선 — 한 쌍이 extent 와 cross-N 에 동시에 걸리는 입력(E = (9, 5, 8), N8): 단계 0 판정은 extent 하나이고 표지 336 은 한 번만
  const verdicts = xStage0Filter({ finalistsByN: { 8: [9, 5, 8] }, N: 8, pairs: ['X0'] });
  assert.deepEqual(verdicts, [{ pair: 'X0', verdict: 'extent-exceeds-N' }]);
  const pairLabels = pi => all.filter(l => l[0] === pi);
  const extentOnly = xCoverageIdentity({ evaluatedLabels: [...pairLabels(1), ...pairLabels(2)], rejectedExtentLabels: pairLabels(0), rejectedCrossNLabels: [] });
  assert.ok(extentOnly.ok); assert.equal(extentOnly.rejectedExtent, 336); assert.equal(extentOnly.rejectedCrossN, 0);
  // N′ finalist 0 (N8 프레임, N10 finalist 0): X1 336 → RejectedGeometry, X0/X0g 672 평가 → unexplored [] · 합 1,008
  const geom = xCoverageIdentity({ evaluatedLabels: [...pairLabels(0), ...pairLabels(1)], rejectedGeometryLabels: pairLabels(2), unexplored: xUnexploredDerive({ evaluatedLabels: [...pairLabels(0), ...pairLabels(1)], rejectedLabels: pairLabels(2) }) });
  assert.ok(geom.ok); assert.equal(geom.rejectedGeometry, 336); assert.equal(geom.unexplored, 0); assert.equal(geom.evaluated, 672);
  // v6 팔(결정 1): 두 N 모두 finalist 0(B8 미도달) → RejectedGeometry 0 · |unexplored| 1,008(다른 세 항 0)
  const unreached = xCoverageIdentity({ unexplored: xUnexploredDerive({}) });
  assert.deepEqual(unreached, { ok: true, evaluated: 0, rejectedCrossN: 0, rejectedExtent: 0, rejectedGeometry: 0, unexplored: 1008, sum: 1008, disjoint: true });
  assert.throws(() => xCoverageIdentity({ evaluatedLabels: [[3, 0, 0]] }), RangeError);
  assert.throws(() => xCoverageIdentity({ evaluatedLabels: [[0, 0]] }), TypeError);
  assert.throws(() => xCoverageIdentity(null), TypeError);
});

test('§6.2-43 uniquenessScope — 단계 0 거절 > 0 → heuristic-pruned(«탐색 범위 내 유일») · 거절 0 ∧ RejectedGeometry > 0 → geometry-pruned(«탐색된 N 안에서 registry 유일») · 둘 다 → heuristic · 아무것도 없을 때만 registry-complete(«전체 registry 유일»)', () => {
  assert.equal(xUniquenessScope({ rejectedCrossN: 336, rejectedExtent: 0, rejectedGeometry: 0 }), 'heuristic-pruned');
  assert.equal(xUniquenessScope({ rejectedCrossN: 0, rejectedExtent: 336, rejectedGeometry: 0 }), 'heuristic-pruned');
  assert.equal(xUniquenessScope({ rejectedCrossN: 0, rejectedExtent: 0, rejectedGeometry: 336 }), 'geometry-pruned');
  assert.equal(xUniquenessScope({ rejectedCrossN: 336, rejectedExtent: 0, rejectedGeometry: 672 }), 'heuristic-pruned');
  assert.equal(xUniquenessScope({ rejectedCrossN: 0, rejectedExtent: 0, rejectedGeometry: 0 }), 'registry-complete');
  assert.equal(xUniquenessScope({}), 'registry-complete');
  assert.equal(X_UNIQUENESS_PHRASES['registry-complete'], '전체 registry 유일');
  assert.equal(X_UNIQUENESS_PHRASES['geometry-pruned'], '탐색된 N 안에서 registry 유일');
  assert.equal(X_UNIQUENESS_PHRASES['heuristic-pruned'], '탐색 범위 내 유일');
  assert.notEqual(X_UNIQUENESS_PHRASES[xUniquenessScope({ rejectedGeometry: 1 })], '전체 registry 유일'); // «전체 registry 유일» 0 회
  assert.throws(() => xUniquenessScope({ rejectedGeometry: -1 }), TypeError);
});
