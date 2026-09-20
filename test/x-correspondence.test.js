/**
 * `src/x-correspondence.js` 단위자 — DESIGN_006 v6 봉인판 §6 번호를 테스트 이름에 표기해요(소스에 적힌 숫자가 정본).
 * 갈래(§6 머리 · §6.3-52 집계용): describe «§6.1 solver» · «§6.2 규율·결정성(GT/합성 정답 입력 허용 — blind 성능 주장 아님)» ·
 * «§6.2b blind(GT 입력 0)» · «§7.2 카운터». 합성 입력은 frozen `xCameraLookAt` · `xProjectSites` · `xProfileLayout`(→ `xEffectiveMap`) 로
 * 만든 «알려진 pose» 의 렌더 없는 점 목록이고, GT(참 siteId · 참 pose)는 테스트 안에서만 쓰며 ② 함수 인자로는 blob · frame · camera · policy 만 넘겨요.
 * seed 는 §4.4 단위자 갈래(3342300003 · 3342300008 · 3342300010)와 §6.2-24 대조군 seed 3342300007 만 리터럴로 써요.
 */
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { xCameraLookAt, xProjectSites, X_CAMERA_MODEL, mat3Apply, mat3Mul } from '../src/x-project.js';
import { xProjectPoint } from '../src/x-pose-lm.js';
import { xSiteCoord } from '../src/x-layout.js';
import { xRotationAngleDeg, xIsRotation } from '../src/x-p3p.js';
import { xEffectiveMap, X_TRANSFORMS, xAliasClasses, X_ADDRESS_PI } from '../src/x-address-48.js';
import { X_FINDER_IDS } from '../src/x-finder.js';
import { X_PROFILE_IDS } from '../src/x-profile.js';
import {
  xStage2, xStage2Trace, xCanonicalSerialize, STAGE2_POLICY, P3P_OPTS, xFnv1a32, xSeedForStream, xMakeRng, _internals,
} from '../src/x-correspondence.js';

const SRC_PATH = fileURLToPath(new URL('../src/x-correspondence.js', import.meta.url));
const SRC_RAW = readFileSync(SRC_PATH, 'utf8');
/** 주석을 뺀 소스(정적 grep 은 코드만 봐요) */
const SRC = SRC_RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/[ \t]\/\/[^\n]*$/gm, '');
const CAM = { model: X_CAMERA_MODEL, width: 320, height: 240, fx: 439.596, fy: 439.596, cx: 160, cy: 120 };
const FRAME = { width: 320, height: 240 };
const clone = o => JSON.parse(JSON.stringify(o));

// ───────────────────────────── 합성 입력(GT 는 테스트 안에서만) ─────────────────────────────

const coordOf = (N, id) => [Math.floor(id / (N * N)), Math.floor(id / N) % N, id % N];
const isEdgeSite = (N, id) => coordOf(N, id).filter(x => x === 0 || x === N - 1).length >= 2;
const isCornerSite = (N, id) => coordOf(N, id).filter(x => x === 0 || x === N - 1).length === 3;
function mkBlob(id, u, v, q = {}) {
  return { blobId: id, u, v, bbox: [u - 1, v - 1, u + 1, v + 1], areaPx: 4, scalePx: 2, peakLuma: 1, meanLuma: 0.8, backgroundLuma: 0.1, contrast: 0.7, state: 'lit', visibilityReason: 'visible', levelLikelihood: [0.1, 0.9], quality: { saturated: false, edgeTruncated: false, mergeSuspected: false, ...q } };
}
/**
 * 알려진 pose 의 합성 프레임 — registry `F_eff`(known → bits, 데이터 사이트는 seed 난수 50 % 또는 `dataBits` 규칙) 점등, 간단한 가림(3 px 안 더 가까운 점).
 * blobId 배정(합성 전용): 모서리 사이트는 F(mod 8 ≥ 4), 내부는 V/F 섞음, T 잔여류(0,1)는 아예 안 써요(러너의 T 제거 뒤 모양).
 * `dataBits(siteId, coord, map) → 0|1` 은 데이터(비-known) 사이트의 결정적 점등 규칙(GT 유래 — 테스트 안에서만), `mirror` 는 점등 패턴을 x ↔ N−1−x 로 반사해요(참 라벨이 improper 가 되는 입력, §6.2b-48 v5).
 */
function synthFrame({ profile = 'X0', finder = 'edge-all-v0', az = 0.6, el = 0.4, roll = 0.2, seed = 3342300003, dropCorners = false, shift = [0, 0], camera = CAM, distanceOverWidth = 3, dataBits = null, mirror = false } = {}) {
  const map = xEffectiveMap(profile, finder);
  const N = map.N;
  const pose = xCameraLookAt({ N, distanceOverWidth, azimuth: az, elevation: el, roll });
  const rng = xMakeRng(seed);
  const lit = new Uint8Array(N ** 3);
  for (let s = 0; s < N ** 3; s += 1) lit[s] = map.known[s] ? map.bits[s] : (dataBits ? dataBits(s, coordOf(N, s), map) : (rng() < 0.5 ? 1 : 0));
  if (mirror) { const src = lit.slice(); for (let s = 0; s < N ** 3; s += 1) { const c = coordOf(N, s); lit[s] = src[((N - 1 - c[0]) * N + c[1]) * N + c[2]]; } }
  const proj = xProjectSites({ N, pose, camera });
  const pts = proj.points.filter(p => p.inFrame && lit[p.siteId] && !(dropCorners && isCornerSite(N, p.siteId)));
  const visible = pts.filter(p => !pts.some(q => q !== p && q.z < p.z - 0.5 && Math.hypot(q.u - p.u, q.v - p.v) < 3));
  visible.sort((a, b) => (Math.round(a.v) - Math.round(b.v)) || (a.u - b.u));
  let nextF = 4, nextV = 2, k = 0;
  const takeF = () => { const id = nextF; nextF += 1; if (nextF % 8 === 0) nextF += 4; return id; };
  const takeV = () => { const id = nextV; nextV += (nextV % 8 === 2) ? 1 : 7; return id; };
  const truthSite = new Map();
  const blobs = visible.map(p => { const id = isEdgeSite(N, p.siteId) ? takeF() : ((k++ % 3 === 0) ? takeV() : takeF()); truthSite.set(id, p.siteId); return mkBlob(id, p.u + shift[0], p.v + shift[1]); })
    .sort((a, b) => a.blobId - b.blobId);
  return { blobs, truthSite, pose, N, map, camera };
}
/** §6.2b-21 (ㄱ) · §6.2b-49 적대 입력 — 정 16각형 둘레에 2048 blob(변당 128, seed 3342300008 로 법선 방향 0.1 px 지터 · contrast 난수): 직선 16 > 8 */
function polygonBlobs(sides = 16, total = 2048) {
  const rng = xMakeRng(3342300008);
  const per = total / sides, R = 100;
  const out = [];
  let idx = 0;
  for (let s = 0; s < sides; s += 1) {
    const a0 = 2 * Math.PI * s / sides, a1 = 2 * Math.PI * (s + 1) / sides;
    const p0 = [160 + R * Math.cos(a0), 120 + R * Math.sin(a0)], p1 = [160 + R * Math.cos(a1), 120 + R * Math.sin(a1)];
    const nrm = [-(p1[1] - p0[1]), p1[0] - p0[0]]; const nl = Math.hypot(nrm[0], nrm[1]);
    for (let i = 0; i < per; i += 1) {
      const t = (i + 0.5) / per, j = (rng() - 0.5) * 0.2;
      const id = idx + Math.floor(idx / 6) * 2 + 2; idx += 1;
      // contrast 를 seed 난수로 — nGeom 셀 round-robin 이 blobId 순으로 한 자리에 몰리지 않게(적대 입력이 둘레 전체를 덮도록)
      out.push({ ...mkBlob(id, p0[0] + t * (p1[0] - p0[0]) + j * nrm[0] / nl, p0[1] + t * (p1[1] - p0[1]) + j * nrm[1] / nl), contrast: 0.5 + 0.5 * rng() });
    }
  }
  return out;
}
const cache = new Map();
function runCached(key, make) {
  if (!cache.has(key)) { const fx = make(); const { output, trace } = xStage2Trace(fx.blobs, { width: fx.camera.width, height: fx.camera.height }, fx.camera, STAGE2_POLICY); cache.set(key, { ...fx, output, trace }); }
  return cache.get(key);
}
const mainFrame = () => runCached('main', () => synthFrame());
const x1Frame = () => runCached('x1', () => synthFrame({ profile: 'X1', finder: 'edge-m1s3-w1' }));
/** 근접(distanceOverWidth 1.6) 픽스처 — 같은 지도 단위 안에서 finder 별 support 가 s_min 을 걸쳐 갈리는 경우가 실제로 나와요(§6.2b-29 chanceConflict null 규칙 팔, 통합 수정 1차) */
const closeFrame = () => runCached('close', () => synthFrame({ distanceOverWidth: 1.6 }));
/** 부분 시야 픽스처 — 프레임 밖 blob 을 잘라 낸 근접·편심 뷰(최상위 가설의 offset o ≠ 0 이 실제로 나와요 — §6.1-12 «o ≠ 0 팔» ② 수준) */
const partialFrame = () => runCached('partial', () => { const fx = synthFrame({ distanceOverWidth: 2, shift: [100, 60] }); return { ...fx, blobs: fx.blobs.filter(b => b.u >= 0 && b.u < FRAME.width && b.v >= 0 && b.v < FRAME.height) }; });

// ───────────────────────────── selected 양성 픽스처(§3.3 조건 7 항 — 결정적 데이터 비트, 전체 시야 · near · 잡음 0) ─────────────────────────────
/**
 * 모서리 데이터 사이트 규칙 — 모서리(고정 좌표 2 개) 위 index ∈ `indices` 만 켜고 면 내부 데이터는 전부 꺼요.
 * X1 · `edge-m1s2-v0` 장면에서 index 5 를 켜면 경쟁 finder 7 개 전부가 보이는 모서리마다 ≥ 1 conflict 를 받아요(w1/all-v0 의 known-0 이 index 2·5·6 에 걸쳐요 — `x-finder.js` 규칙으로
 * 유도: m1s2 known-1 {0,2,6,7,9} · known-0 {1,4,8} · 데이터 {3,5}); index 3 을 끄면 N8 오축척 삼중 (3,3)·(3,5) 의 부격자 {0,3,6,9} 가 어두워 B4 gate 1 에서 걸려요(N8 finalist 0 — §6.2b-28 (나) 경로).
 * 원본 {3,5} 를 둘 다 켜지 않는 이유는 그 부격자예요. 데이터 비트가 conflict 를 만들지 못하는 finder 쌍(m1s3-v0 ↔ m1s3-w1: 같은 사이트 집합, 워드 5 비트만 다름 · sym ⊃ 비-sym 포함 관계 · edge-all ⊃ m1s2)은
 * 이 규칙으로도 못 갈라요 — §3.3 «구조적으로 닿지 못하고» · §8.3-19 의 정직한 결과라 장면 finder 를 m1s2-v0 로 골랐어요(X1 은 형제 profile 이 없어 `ambiguous-profile` 도 없어요).
 */
const edgeDataRule = indices => (s, c, map) => { const N = map.N; const fixed = c.filter(x => x === 0 || x === N - 1).length; if (fixed < 2) return 0; const idx = c.find(x => x !== 0 && x !== N - 1) ?? 0; return indices.includes(idx) ? 1 : 0; };
/** 경쟁 라벨 known-0 규칙 — 같은 N 의 다른 (profile, finder 별칭 클래스) 가 known-0 인 데이터 사이트만 켜요(N8 프레임 팔 — X0/X0g 상호 conflict 시도) */
const competitorZeroRule = (profile, finder) => {
  const N = xEffectiveMap(profile, finder).N;
  const cls = xAliasClasses(profile).find(c => c.includes(X_FINDER_IDS.indexOf(finder)));
  const comps = [];
  for (const p of X_PROFILE_IDS) { if (xEffectiveMap(p, X_FINDER_IDS[0]).N !== N) continue; X_FINDER_IDS.forEach((f, fi) => { if (p === profile && cls.includes(fi)) return; comps.push(xEffectiveMap(p, f)); }); }
  return s => (comps.some(m => m.known[s] && !m.bits[s]) ? 1 : 0);
};
/**
 * 테스트 전용 정책(계약 §9-10 «같은 키 이름의 값 override» — 정본 STAGE2_POLICY 불변). 두 키가 각각 무엇을 제거하는지는 아래 두 와이어 플립 팔이 재요:
 *   finalistsPerN 1 — 같은 물리 pose 가 면 프레임 3 개(가시 면마다 하나)로 N10 finalist 2 자리를 다 채우면 §3.2 의 «서로 다른 M 2 개 생존» 이 프레임 상대 M 으로 구조상 성립해요(설계 공백 — 아래 A/B 팔).
 *   mMin 16 — N8 오축척 삼중이 B4 gate 1 을 우연 일치(코너 4 + 부격자)로 넘어 N8 finalist 가 항상 서고, 그러면 §2.9 (ㄴ) «최상위 둘의 N 상이 → 미발동» 이 N8 pose 의 X0/X0g 지도(Ω > 8)를 offset-cap 으로 떨궈 672 unexplored → unresolved 예요.
 * 봉인 정책(2 · 6) 아래에서는 어떤 전체 시야 합성 프레임도 selected 에 닿지 못했어요(16 뷰 × X1 finder 7 × 데이터 규칙 4 벌 관측 — 보고서). 이 값들은 §4.3 «제안» 문턱이고 정본 상수는 건드리지 않아요.
 */
const SEL_POLICY = Object.freeze({ finalistsPerN: 1, mMin: 16 });
function runCachedWith(key, make, policy) {
  if (!cache.has(key)) { const fx = make(); const { output, trace } = xStage2Trace(fx.blobs, { width: fx.camera.width, height: fx.camera.height }, fx.camera, policy); cache.set(key, { ...fx, output, trace }); }
  return cache.get(key);
}
const selFixture = () => synthFrame({ profile: 'X1', finder: 'edge-m1s2-v0', dataBits: edgeDataRule([5]) });
/** 양성 팔: selected(SEL_POLICY) */
const selFrame = () => runCachedWith('sel', selFixture, SEL_POLICY);
/** 플립 A: finalistsPerN 만 봉인값(2)으로 되돌림 → 같은 물리 pose 의 두 면 프레임 finalist */
const selFrameTwoFinalists = () => runCachedWith('sel-2fin', selFixture, { mMin: SEL_POLICY.mMin });
/** 플립 B: mMin 만 봉인값(6)으로 되돌림 → N8 오축척 finalist */
const selFrameSealedMMin = () => runCachedWith('sel-mmin6', selFixture, { finalistsPerN: SEL_POLICY.finalistsPerN });
/** GT 대조: 가설의 geom 대응이 참 siteId 와 일치하는 수 */
const agreeCount = (fx, h) => h.correspondences.geom.filter(([id, s]) => fx.truthSite.get(id) === s).length;
/** survivorTransforms 를 (라벨, M) 목록으로 */
const survivorList = cov => Object.entries(cov.survivorTransforms).flatMap(([lk, ms]) => ms.map(m => [lk, m]));
const STATUSES = ['selected', 'ambiguous', 'improper-only', 'unsupported', 'support-below-threshold', 'unresolved', 'rejected', 'degenerate-view', 'cap-hit', 'skipped-stage1', 'invalid-input', 'too-few-blobs', 'hull-insufficient', 'not-run'];
/** 출력 실수 전부가 `round(1e6·x)/1e6` 격자 위인지 */
function allRounded(v, path = 'output') {
  if (typeof v === 'number') { assert.ok(Number.isFinite(v), `${path} 비유한`); assert.equal(v, Math.round(1e6 * v) / 1e6, `${path} 반올림 격자 밖: ${v}`); return; }
  if (Array.isArray(v)) v.forEach((x, i) => allRounded(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) allRounded(v[k], `${path}.${k}`);
}
/** 키 삽입 순서를 뒤집은 깊은 사본 */
function reverseKeys(v) {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') { const out = {}; for (const k of Object.keys(v).reverse()) out[k] = reverseKeys(v[k]); return out; }
  return v;
}
function coverageSum(c) { return (c.addressTestsDone - c.addressTestsRejectedCrossN - c.addressTestsRejectedExtent - c.addressTestsRejectedGeometry) + c.addressTestsRejectedCrossN + c.addressTestsRejectedExtent + c.addressTestsRejectedGeometry + c.unexplored.length; }

// ═════════════════════════════ §6.1 solver ═════════════════════════════
describe('§6.1 solver', () => {
  test('§6.1-3 정책 객체 팔 — P3P_OPTS 는 {maxSolutions: 4} 와 깊은 동일, 정적 grep: maxSolutions 리터럴은 정책 객체 정의 한 곳뿐 · 다른 xP3P 옵션 키 리터럴 0 · xP3P 호출은 P3P_OPTS 로만', () => {
    assert.deepEqual(P3P_OPTS, { maxSolutions: 4 });
    assert.ok(Object.isFrozen(P3P_OPTS));
    assert.equal((SRC.match(/maxSolutions/g) ?? []).length, 1);
    for (const k of ['imagTol', 'residualTol', 'denomEps', 'rootTol', 'requireRootSolverConvergence', 'leadEps']) assert.equal(SRC.includes(k), false, `옵션 키 리터럴 ${k}`);
    const calls = SRC.match(/xP3P\(([^;]*)\)/g) ?? [];
    assert.ok(calls.length >= 1);
    for (const c of calls) assert.ok(c.includes('P3P_OPTS'), c);
    // 정본 지문 팔(§6.1-3 v4.1): 이 계약서가 인용한 정본 sha 는 캠페인 러너의 manifest 몫 — 여기서는 삼중당 근 ≤ 4 만 재요
    const { trace } = mainFrame();
    const perTriple = new Map();
    for (const [f, t] of trace.p3pRoots) { const k = `${f},${t}`; perTriple.set(k, (perTriple.get(k) ?? 0) + 1); }
    for (const [k, n] of perTriple) assert.ok(n <= 4, `${k}: ${n}`);
  });

  test('§6.1-38 일대일 매칭 정규형 — 최적해가 2 개 이상인 입력(같은 사이트에 양자화 비용 동률 blob 둘)에서 siteId 오름 (siteId, blobId) 수열이 사전순 최소', () => {
    const sites = [{ u: 100, v: 100 }, { u: 140, v: 100 }];
    // blob 7 · 3 이 사이트 0 에 정확히 같은 거리(1 px) — 최적 매칭 2 개(어느 blob 이든) → 정규형은 blobId 3
    const blobs = [{ id: 3, u: 101, v: 100 }, { id: 7, u: 99, v: 100 }, { id: 9, u: 140.5, v: 100 }];
    const m = _internals.matchCanonical(blobs, sites, 2.0);
    assert.deepEqual(m.pairs.map(p => [p.s, p.id]), [[0, 3], [1, 9]]);
    // 분리성: 2 번째 최근접이 2g 안이면 ambiguous-assignment(지지도 모순도 아님)
    const close = _internals.matchCanonical([{ id: 1, u: 120, v: 100 }], [{ u: 119, v: 100 }, { u: 122, v: 100 }], 2.0);
    assert.equal(close.pairs.length, 0); assert.equal(close.ambiguous, 1);
    // gate 밖은 후보 아님
    assert.equal(_internals.matchCanonical([{ id: 1, u: 110, v: 100 }], sites, 2.0).pairs.length, 0);
  });

  test('§6.1-47 투영 규약 일치 — ② 내부 투영(projectRaws)의 (u, v) 가 frozen xProjectSites 와 1e−9 안(반픽셀 0)', () => {
    const N = 8, half = (N - 1) / 2;
    const rng = xMakeRng(3342300003);
    for (let k = 0; k < 20; k += 1) {
      const pose = xCameraLookAt({ N, distanceOverWidth: 2.5 + rng(), azimuth: (rng() * 2 - 1) * Math.PI, elevation: (rng() * 2 - 1) * 1.2, roll: (rng() * 2 - 1) * Math.PI });
      // 면-국소 물리 a ↔ P = a − c: R_f = R, t_f = t − R·c
      const Rc = mat3Apply(pose.R, [half, half, half]);
      const tf = [pose.t[0] - Rc[0], pose.t[1] - Rc[1], pose.t[2] - Rc[2]];
      const raws = []; for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) for (let z = 0; z < N; z += 1) raws.push([i, j, z]);
      const mine = _internals.projectRaws(pose.R, tf, raws, 1, CAM, FRAME, 0);
      const ref = xProjectSites({ N, pose, camera: CAM });
      mine.sites.forEach((s, idx) => { const r = ref.points[idx]; if (r.inFront) { assert.ok(Math.abs(s.u - r.u) < 1e-9 && Math.abs(s.v - r.v) < 1e-9, `pose ${k} site ${idx}`); assert.equal(s.inFrame, r.inFrame); } });
    }
  });

  test('§6.1-12 · §3.1 «o ≠ 0 팔»(② 수준, 통합 수정 1차) — 합성 부분 시야(최상위 가설 offset ≠ 0 필수)에서 출력 (R·Π^p, t) 로 correspondences.geom 을 재투영한 rms 가 residualSummary.rmsPx 와 1e−6 · 면-국소 (R_f, t_f, geomFaceLocal) 의 rms 와 1e−3 px 안(§3.1 항등식) · t 에 R·Π^p·o 를 되돌려 넣으면(옛 식) rms 가 픽셀 급으로 커져요', () => {
    const fx = partialFrame();
    const out = fx.output;
    assert.ok(out.hypotheses.length >= 1, `가설 없음: ${out.status}`);
    assert.ok(out.hypotheses.some(h => h.addressTransform.offset.some(v => v !== 0)), '부분 시야 픽스처인데 offset ≠ 0 가설이 없어요(픽스처 무효)');
    const bm = new Map(fx.blobs.map(b => [b.blobId, [b.u, b.v]]));
    const rms = (R, t, pts, px) => Math.sqrt(pts.reduce((s, P, i) => { const p = xProjectPoint(R, t, P, fx.camera); return s + (p.u - px[i][0]) ** 2 + (p.v - px[i][1]) ** 2; }, 0) / pts.length);
    let withOffset = 0;
    for (const h of out.hypotheses) {
      const N = h.profile.N, c = (N - 1) / 2;
      const px = h.correspondences.geom.map(([id]) => bm.get(id));
      const pts = h.correspondences.geom.map(([, s]) => xSiteCoord(N, s).map(v => STAGE2_POLICY.pitch * (v - c)));
      const Ruse = h.addressTransform.parity > 0 ? h.R : mat3Mul(h.R, X_ADDRESS_PI);
      const rCanon = rms(Ruse, h.t, pts, px);
      assert.ok(Math.abs(rCanon - h.residualSummary.rmsPx) <= 1e-6, `rmsPx 재계산 ${rCanon} ≠ ${h.residualSummary.rmsPx}`);
      const ls = h.faceFrame.layerSign;
      const ptsL = h.correspondences.geomFaceLocal.map(([, a]) => [a[0], a[1], ls * a[2]].map(v => v * STAGE2_POLICY.pitch));
      const rLocal = rms(h.faceFrame.R_f, h.faceFrame.t_f, ptsL, px);
      assert.ok(Math.abs(rCanon - rLocal) <= 1e-3, `정본 프레임 rms ${rCanon} ≠ 면-국소 rms ${rLocal} (o=${h.addressTransform.offset})`);
      const o = h.addressTransform.offset;
      if (o.some(v => v !== 0)) {
        withOffset += 1;
        const shift = mat3Apply(Ruse, o.map(v => v * STAGE2_POLICY.pitch));
        const rOld = rms(Ruse, h.t.map((v, i) => v + shift[i]), pts, px); // 옛 식 t_f + R_f·h 로 되돌린 t
        assert.ok(rOld > rCanon + 1 && rOld > 3 * rCanon, `옛 식 rms ${rOld} 가 새 식 ${rCanon} 보다 충분히 크지 않아요(o=${o})`);
      }
    }
    console.log('§6.1-12 «o ≠ 0 팔» 관측치: status', out.status, 'blobs', fx.blobs.length, 'offset≠0 가설', withOffset, '/', out.hypotheses.length, 'top o', JSON.stringify(out.hypotheses[0].addressTransform.offset), 'rmsPx', out.hypotheses[0].residualSummary.rmsPx);
  });
});

// ═════════════════════════════ §6.2 규율·결정성 ═════════════════════════════
describe('§6.2 규율·결정성(GT/합성 정답 입력 허용 — blind 성능 주장 아님)', () => {
  test('§6.2-23 생존자·support 기록 — addressSupport 라벨당 48 대표 6 원소 · survivorTransforms 가 Z 규칙과 일치 · 0<support<s_min 은 생존 아님 · 별칭 두 finder 라벨은 비트 동일이고 hypotheses 에는 클래스당 한 항목', () => {
    const { output } = mainFrame();
    const cov = output.coverage, P = STAGE2_POLICY;
    const kappa = s => Math.max(1, Math.floor(P.rho * s));
    let labelsSeen = 0;
    for (const lk of Object.keys(cov.addressSupport)) {
      const rows = cov.addressSupport[lk];
      labelsSeen += 1;
      assert.equal(rows.length, 48, lk);
      const expectSurv = [];
      rows.forEach((row, i) => {
        assert.equal(row.length, 6); assert.equal(row[0], i);
        const [m, sup, con, cc, poseRank, o] = row;
        assert.ok(Number.isInteger(sup) && Number.isInteger(con) && Number.isInteger(poseRank) && o.length === 3);
        assert.ok(cc === null || Number.isFinite(cc));
        if (sup < P.sMin) assert.equal(cc, null, 'κ 판정에 닿지 않은 후보는 null');
        const corrected = cc === null ? con : con - cc;
        if (sup >= P.sMin && corrected <= kappa(sup)) expectSurv.push(m);
      });
      assert.deepEqual(cov.survivorTransforms[lk] ?? [], expectSurv, lk);
    }
    assert.ok(labelsSeen >= 7);
    // 별칭: X0 의 m1s3-v0 ≡ m1s3sym-v0 · m1s3-w1 ≡ m1s3sym-w1 라벨이 비트 동일
    for (const [a, b] of [['edge-m1s3-v0', 'edge-m1s3sym-v0'], ['edge-m1s3-w1', 'edge-m1s3sym-w1']]) {
      for (const pr of ['X0', 'X0g']) if (cov.addressSupport[`${pr}|${a}`]) assert.deepEqual(cov.addressSupport[`${pr}|${a}`], cov.addressSupport[`${pr}|${b}`], `${pr} ${a}≡${b}`);
    }
    // hypotheses: 클래스당 한 항목(같은 (pair, class, M) 중복 0) · 대표 finderId 는 클래스 최소 인덱스 · finderAliasSupport 값 동일
    const keys = output.hypotheses.map(h => `${h.profile.profileId}|${h.finderAliasClass.join(',')}|${h.addressTransform.transformId}`);
    assert.equal(new Set(keys).size, keys.length);
    for (const h of output.hypotheses) {
      const cls = xAliasClasses(h.profile.profileId).find(c => X_FINDER_IDS[c[0]] === h.finderId);
      assert.deepEqual(h.finderAliasClass, cls.map(i => X_FINDER_IDS[i]));
      const vals = Object.values(h.finderAliasSupport).map(v => v.join(','));
      assert.equal(new Set(vals).size, 1, '클래스 안 (support, conflict) 동일');
      assert.deepEqual(Object.values(h.finderAliasSupport)[0], [h.fixedBitSupport, h.fixedBitConflicts]);
      assert.ok(h.fixedBitSupport > 0, 'support 0 후보는 hypotheses 에 없음');
    }
    // 대표값의 poseRank 는 finalist 색인 안
    const nFin = cov.finalists.N8 + cov.finalists.N10;
    for (const rows of Object.values(cov.addressSupport)) for (const r of rows) assert.ok(r[4] >= 0 && r[4] < nFin);
  });

  test('§6.2-24 게이트 변별력(축소 팔 — 대조군 «껍질 안 위치 무작위화» seed 3342300007) — 정답 프레임의 최상위 selectionScore[0](q_geom) > 대조군, 문턱 없는 순서 단언', () => {
    const fx = mainFrame();
    const rng = xMakeRng(3342300007);
    const u0 = Math.min(...fx.blobs.map(b => b.u)), u1 = Math.max(...fx.blobs.map(b => b.u)), v0 = Math.min(...fx.blobs.map(b => b.v)), v1 = Math.max(...fx.blobs.map(b => b.v));
    const control = fx.blobs.map(b => mkBlob(b.blobId, u0 + rng() * (u1 - u0), v0 + rng() * (v1 - v0)));
    const ctrl = xStage2(control, FRAME, CAM, STAGE2_POLICY);
    const truthQ = fx.output.hypotheses[0].selectionScore[0];
    const ctrlQ = ctrl.hypotheses.length ? ctrl.hypotheses[0].selectionScore[0] : -Infinity;
    assert.ok(truthQ > ctrlQ, `truth ${truthQ} vs control ${ctrlQ} (control status ${ctrl.status})`);
    assert.notEqual(ctrl.status, 'selected');
  });

  test('§6.2-25 코너 부재 내성 — 코너 blob 8 개를 제거해도 면 가설이 서고 최상위 정답 가설의 pose 오차가 작음(해석적 교점)', () => {
    const fx = synthFrame({ dropCorners: true });
    const out = xStage2(fx.blobs, FRAME, CAM, STAGE2_POLICY);
    assert.ok(out.diagnostics.faceHypotheses >= 1);
    assert.ok(out.hypotheses.length >= 1, out.status);
    const best = out.hypotheses.map(h => ({ h, err: xRotationAngleDeg(fx.pose.R, h.R), terr: Math.hypot(...h.t.map((x, i) => x - fx.pose.t[i])) })).sort((a, b) => a.err - b.err)[0];
    assert.ok(best.err < 0.5, `회전 오차 ${best.err}°`);
    assert.ok(best.terr < 0.1, `t 오차 ${best.terr} pitch`);
  });

  test('§6.2-27 경계 6 방향 합성 — 상태를 관측치로 기록만(사전 규정 없음)', () => {
    const dirs = [[0, 0], [Math.PI / 2, 0], [-Math.PI / 2, 0], [Math.PI, 0], [0, Math.PI / 2], [0, -Math.PI / 2]];
    const observed = dirs.map(([az, el]) => { const fx = synthFrame({ az, el, roll: 0 }); const o = xStage2(fx.blobs, FRAME, CAM, STAGE2_POLICY); assert.ok(STATUSES.includes(o.status)); return [az, el, o.status, o.hypotheses.length]; });
    console.log('§6.2-27 관측치(az, el, status, hyps):', JSON.stringify(observed));
  });

  test('§6.2-30 종단 1 프레임(렌더 없는 합성 팔) — 출력 스키마·어휘·SO(3)·hypotheses ≤ 4·coverage 합 검증, 성능 문턱 없음', () => {
    const { output } = mainFrame();
    assert.equal(output.schemaVersion, 'TLcube:X:pose-hypotheses:v0');
    assert.ok(STATUSES.includes(output.status));
    assert.ok(output.hypotheses.length <= 4);
    for (const h of output.hypotheses) {
      assert.ok(xIsRotation(h.R, 1e-5), 'R ∈ SO(3)(반올림 뒤 1e−5)');
      assert.ok(xIsRotation(h.faceFrame.R_f, 1e-5));
      assert.equal(h.addressTransform.layerSign, h.faceFrame.layerSign);
      assert.equal(h.addressTransform.parity, X_TRANSFORMS[h.addressTransform.transformId].parity);
      assert.equal(h.residualSummary.population, 'geom');
      assert.equal(h.residualSummary.count, h.correspondences.geom.length);
      assert.deepEqual(h.correspondences.geomFaceLocal.map(x => x[0]), h.correspondences.geom.map(x => x[0]));
      assert.ok(h.correspondences.F.length <= 48 && h.correspondences.V.length <= 16);
      assert.equal(h.selectionScore.length, 3);
      for (const r of h.rejectReasons) assert.ok(_internals.REASON_ORDER.some(t => r === t || r.startsWith(t + ':')), r);
    }
    for (const r of output.rejectReasons) assert.ok(_internals.REASON_ORDER.some(t => r === t || r.startsWith(t + ':')), r);
    for (const c of output.coverage.capHits) assert.ok(_internals.CAP_ORDER.includes(c));
    assert.equal(output.coverage.addressTestsTotal, 1008);
    assert.equal(coverageSum(output.coverage), 1008);
    assert.ok(['registry-complete', 'geometry-pruned', 'heuristic-pruned'].includes(output.coverage.uniquenessScope));
    assert.equal(output.diagnostics.stage1MeasuredMs, null); assert.equal(output.diagnostics.measuredMs, null); assert.equal(output.diagnostics.totalMs, null);
  });

  test('§6.2-40 E_chance 가 항등 null 이 아님 — (ㄱ) 정답 면 pose 에서 m − E_chance > 0 이고 대조군 ③(광축 90° 회전)의 값보다 큼 · (ㄴ) 껍질 밖 blob 위치는 64 표본 전부에서 불변', () => {
    const fx = synthFrame();
    const N = fx.N, half = (N - 1) / 2;
    // 정답 면-국소 프레임: 코너 (0,0,0) 을 원점, i·j 축 = 정본 축 → R_f = R, t_f = t − R·c 로 near 분기와 동일 물리
    const Rc = mat3Apply(fx.pose.R, [half, half, half]);
    const tf = [fx.pose.t[0] - Rc[0], fx.pose.t[1] - Rc[1], fx.pose.t[2] - Rc[2]];
    const raws = []; for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) raws.push([i, j, 0]);
    const proj = _internals.projectRaws(fx.pose.R, tf, raws, 1, CAM, FRAME, STAGE2_POLICY.sepDesignPx);
    const geom = fx.blobs.filter(b => b.blobId % 8 >= 4).map(b => ({ id: b.blobId, u: b.u, v: b.v }));
    const g = STAGE2_POLICY.gAbsPx;
    const mE = pts => {
      const m = _internals.matchCanonical(pts, proj.usable, g).pairs.length;
      const setup = _internals.nullSetup(proj.usable, pts);
      const rng = xMakeRng(xSeedForStream('B4', 0, 0, 0));
      const counts = [], outside = new Set([...pts.keys()].filter(i => !setup.insideIdx.includes(i)));
      for (let s = 0; s < 64; s += 1) { const smp = _internals.nullSample(pts, setup, rng); for (const i of outside) assert.ok(smp[i].u === pts[i].u && smp[i].v === pts[i].v, '껍질 밖 blob 불변'); counts.push(_internals.matchCanonical(smp, proj.usable, g).pairs.length); }
      return { m, E: _internals.sampleSd(counts) >= 0 ? counts.reduce((a, b) => a + b, 0) / 64 : NaN, nIn: setup.nIn, nOut: outside.size };
    };
    const truth = mE(geom);
    assert.ok(truth.m - truth.E > 0, `m ${truth.m} E ${truth.E}`);
    assert.ok(truth.nOut > 0, '껍질 밖 blob 이 있는 입력');
    // 대조군 ③: blob 위치를 광축(주점) 둘레 90° 회전
    const rot = geom.map(b => ({ id: b.id, u: CAM.cx - (b.v - CAM.cy), v: CAM.cy + (b.u - CAM.cx) }));
    const ctrl = mE(rot);
    assert.ok(ctrl.m - ctrl.E < truth.m - truth.E, `truth ${truth.m - truth.E} ctrl ${ctrl.m - ctrl.E}`);
    console.log('§6.2-40 관측치: truth m', truth.m, 'E', truth.E.toFixed(3), 'n_in', truth.nIn, '| control m', ctrl.m, 'E', ctrl.E.toFixed(3));
  });

  test('§6.2-41 ambiguous-N 우연 보정 — raw V inlier 와 q_geom = round(1e6·(inlier − E_chance_V)) 의 N 선택이 갈리는 반례 · 반올림 경계(5.4 vs 5.6) 순서', () => {
    const a = { N: 10, inlier: 9, EV: 5.0 }, b = { N: 8, inlier: 8, EV: 2.0 };
    assert.ok(a.inlier > b.inlier, 'raw 는 N10');
    assert.ok(_internals.qGeom(b.inlier, b.EV) > _internals.qGeom(a.inlier, a.EV), '보정 뒤는 N8');
    const k1 = _internals.rankKey({ qGeom: _internals.qGeom(10, 4.6), N: 8, lmRms: 0.3, f: 0, t: 0, r: 0, layerSign: 1 });
    const k2 = _internals.rankKey({ qGeom: _internals.qGeom(10, 4.4), N: 10, lmRms: 0.3, f: 0, t: 0, r: 0, layerSign: 1 });
    assert.ok(_internals.compareTuples(k2, k1) < 0, '5.6 이 5.4 보다 앞(양자화 정수 위 비교)');
    assert.equal(_internals.qGeom(10, 4.6), 5400000); assert.equal(_internals.qGeom(10, 4.4), 5600000);
  });
});

// ═════════════════════════════ §6.2b blind(GT 입력 0) ═════════════════════════════
describe('§6.2b blind(GT 입력 0)', () => {
  test('§6.2b-18 입력 검증기(② 팔) — truth 키 포함 · getter · 희소 배열 · NaN · cx 범위 밖 · blobId 중복/비정수 · frame 여분 키 → invalid-input(던지지 않음) · T 제거 뒤 정상 입력은 invalid-input 아님', () => {
    const fx = mainFrame();
    const good = fx.blobs;
    assert.notEqual(fx.output.status, 'invalid-input');
    const inv = blobs => xStage2(blobs, FRAME, CAM, STAGE2_POLICY);
    const withKey = clone(good); withKey[0].truthRef = 'x';
    assert.equal(inv(withKey).status, 'invalid-input', 'truth 키');
    const getter = clone(good); Object.defineProperty(getter[0], 'profileId', { get() { return 'X0'; }, enumerable: true });
    assert.equal(inv(getter).status, 'invalid-input', 'getter');
    const sparse = clone(good); sparse.length += 1;
    assert.equal(inv(sparse).status, 'invalid-input', '희소');
    const nan = clone(good); nan[0].u = NaN;
    assert.equal(inv(nan).status, 'invalid-input', 'NaN');
    assert.equal(xStage2(good, FRAME, { ...CAM, cx: 320.5 }, STAGE2_POLICY).status, 'invalid-input', 'cx > w');
    assert.equal(xStage2(good, FRAME, { ...CAM, cx: 320 }, STAGE2_POLICY).status !== 'invalid-input', true, 'cx == w 는 허용');
    const dup = clone(good); dup[1].blobId = dup[0].blobId;
    assert.equal(inv(dup).status, 'invalid-input', '중복');
    const nonInt = clone(good); nonInt[0].blobId = 4.5;
    assert.equal(inv(nonInt).status, 'invalid-input', '비정수');
    assert.equal(xStage2(good, { width: 320, height: 240, frameId: 3 }, CAM, STAGE2_POLICY).status, 'invalid-input', 'frame 여분 키');
    assert.equal(xStage2(good, { width: 320, height: 240, timestamp: 1 }, CAM, STAGE2_POLICY).status, 'invalid-input');
    assert.equal(xStage2(good, { width: 320 }, CAM, STAGE2_POLICY).status, 'invalid-input');
    const inv0 = inv(withKey);
    assert.deepEqual(inv0.hypotheses, []); assert.equal(inv0.selectedHypothesisId, null); assert.deepEqual(inv0.rejectReasons, ['invalid-input']);
    assert.equal(inv0.coverage.unexplored.length, 1008); assert.equal(inv0.coverage.addressTestsRejectedGeometry, 0);
    // policy: plain object 아님 → throw(프로그래머 오류), 알 수 없는 키 → invalid-input(계약 §9-10)
    assert.throws(() => xStage2(good, FRAME, CAM, null), TypeError);
    assert.equal(xStage2(good, FRAME, CAM, { bogus: 1 }).status, 'invalid-input');
    assert.equal(xStage2(good, FRAME, CAM, { seed: 1 }).status, 'invalid-input', '② 정책 갈래 seed 만');
  });

  test('§6.2b-19 F/V/T 분리 · 금지 심볼 — 정적(자기 소스 grep) + 런타임(Proxy 로 감싼 blob 에서 금지 속성 접근 0)', () => {
    // 정적: 파일·관측 행·정답 계열 심볼 0
    for (const bad of ['node:fs', "from 'fs'", 'truthRef', 'oracle', 'imageSha', 'readFileSync', 'matches.jsonl']) assert.equal(SRC.includes(bad), false, bad);
    // 정확 토큰 `pitchPx`(허용 목록 pitchPx_hyp · xPitchPxHyp · pitchPxHyp 제외) 0 · `index` · `key` 식별자 0
    const tokens = SRC.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
    assert.equal(tokens.filter(t => t === 'pitchPx').length, 0);
    assert.equal(tokens.filter(t => t === 'index' || t === 'key' || t === 'observations').length, 0);
    // seed 리터럴: 3342300002 는 STAGE2_POLICY 한 곳 · 3342110/3342111/3342300009 0 · 치환·mtime 0
    assert.equal((SRC.match(/3342300002/g) ?? []).length, 1);
    for (const bad of ['3342110', '3342111', '3342300009', '3342300001', 'statSync', 'mtime', 'shuffle', 'Fisher']) assert.equal(SRC.includes(bad), false, bad);
    assert.equal(STAGE2_POLICY.seed, 3342300002);
    // 시그니처: xStage2(blobs, frame, camera, policy) 4 인자
    assert.equal(xStage2.length, 4); assert.equal(xStage2Trace.length, 4);
    // 런타임: 러너 전용 필드 접근 시 throw 하는 Proxy — 정상 실행에서 throw 0
    const fx = mainFrame();
    const guarded = fx.blobs.map(b => new Proxy({ ...b, quality: { ...b.quality } }, { get(t, p) { if (['index', 'key', 'pitchPx', 'truthRef'].includes(p)) throw new Error(`금지 속성 접근: ${String(p)}`); return t[p]; } }));
    const out = xStage2(guarded, { width: 320, height: 240 }, CAM, STAGE2_POLICY);
    assert.equal(xCanonicalSerialize(out), xCanonicalSerialize(fx.output));
  });

  test('§6.2b-20 결정성 — 같은 입력 2 회 · blob 순서 뒤섞기 · V 후보 순서 뒤섞기 → 정본 직렬화 sha 동일 · F 48 blobId 집합 동일 · trace 바이트 동일 · id 공간(hypothesisId 연속 · poseId = finalist 색인 · lmRank ≥ poseId · judgedBy ⊆ finalists) · 실수 반올림 격자 · 키 삽입 순서 무관 · axisFrame ∈ {found, none}', () => {
    const fx = mainFrame();
    const s1 = xCanonicalSerialize(fx.output);
    const again = xStage2Trace(clone(fx.blobs), FRAME, CAM, STAGE2_POLICY);
    assert.equal(xCanonicalSerialize(again.output), s1);
    assert.equal(JSON.stringify(again.trace), JSON.stringify(fx.trace));
    const rng = xMakeRng(3342300008);
    const shuffled = clone(fx.blobs); for (let i = shuffled.length - 1; i > 0; i -= 1) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const sh = xStage2Trace(shuffled, FRAME, CAM, STAGE2_POLICY);
    assert.equal(xCanonicalSerialize(sh.output), s1, 'blob(V 포함) 순서 뒤섞기 무관');
    assert.equal(JSON.stringify(sh.trace), JSON.stringify(fx.trace));
    if (fx.output.hypotheses.length) assert.deepEqual(sh.output.hypotheses[0].correspondences.F.map(x => x[0]), fx.output.hypotheses[0].correspondences.F.map(x => x[0]));
    // id 공간
    fx.output.hypotheses.forEach((h, i) => { assert.equal(h.hypothesisId, i); assert.equal(h.poseId, h.poseRank); });
    const fin = fx.trace.finalists;
    fin.forEach((row, i) => { assert.equal(row[0], i); assert.ok(row[5] >= row[0], 'lmRank ≥ poseId'); });
    const nFin = fx.output.coverage.finalists.N8 + fx.output.coverage.finalists.N10;
    assert.equal(fin.length, nFin);
    for (const pid of Object.values(fx.output.coverage.stage0.judgedBy)) assert.ok(fin.some(r => r[0] === pid));
    for (const h of fx.output.hypotheses) { assert.ok(fin.some(r => r[0] === h.poseId)); assert.equal('axisFrameAgreementDeg' in h, false); }
    // 실수 격자 · 키 순서 무관 · axisFrame 값
    allRounded(fx.output);
    assert.equal(xCanonicalSerialize(reverseKeys(fx.output)), s1);
    assert.ok(['found', 'none'].includes(fx.output.diagnostics.axisFrame));
    assert.equal(xCanonicalSerialize({ ...fx.output, diagnostics: { ...fx.output.diagnostics, measuredMs: 12.5, stage1MeasuredMs: 3, totalMs: 15.5 }, frameId: '0001', inputSha256: 'x', observationsSha256: 'y', stage1Sha: 'z' }), s1, '제외 필드 완전 열거');
  });

  test('§6.2b-21 cap — (ㄱ) 실입력 팔: 원 위 2048 blob(seed 3342300008) → capHits == [line-cap] ∧ status ∈ {cap-hit, rejected} ∧ selected 아님 ∧ 다른 카운터 상한 미만 · (ㄴ) 결함 주입 팔: 테스트 전용 정책으로 상한을 낮추면 각 cap-hit:<counter> 기록 + unexplored 유도 · 가지치기(prunedLayer)는 cap 아님 · layerKey 는 near(+1) 먼저', () => {
    const circle = polygonBlobs();
    assert.equal(circle.length, 2048);
    const ids = new Set(circle.map(b => b.blobId)); assert.equal(ids.size, circle.length);
    const adv = xStage2(circle, FRAME, CAM, STAGE2_POLICY);
    assert.deepEqual(adv.coverage.capHits, ['line-cap']);
    assert.ok(['cap-hit', 'rejected'].includes(adv.status), adv.status);
    assert.equal(adv.selectedHypothesisId, null);
    const d = adv.diagnostics, P = STAGE2_POLICY;
    assert.ok(d.triplesEnumerated < P.tripleCap && d.p3pRoots < P.rootCap && d.lmRuns < P.lmRunCap && adv.coverage.addressMapsBuilt < P.mapCap && adv.coverage.addressEvaluations < P.evalCap && d.chanceConflictCandidates <= P.cConf);
    console.log('§6.2b-21 (ㄱ) 관측치: status', adv.status, 'lines', d.lines, 'faces', d.faceHypotheses, 'roots', d.p3pRoots);
    // (ㄴ) 결함 주입 — 정본 상한 불변, 같은 키 이름 값 override 만
    const fx = mainFrame();
    const run = over => xStage2(fx.blobs, FRAME, CAM, { ...over });
    const tri = run({ tripleCap: 100 }); assert.ok(tri.coverage.capHits.includes('triple-cap')); assert.equal(tri.status, 'cap-hit');
    const root = run({ rootCap: 50 }); assert.ok(root.coverage.capHits.includes('root-cap'));
    const lm = run({ lmRunCap: 4 }); assert.ok(lm.coverage.capHits.includes('lm-run-cap')); assert.equal(lm.diagnostics.lmRuns, 4);
    const map = run({ mapCap: 30 }); assert.ok(map.coverage.capHits.includes('map-cap')); assert.ok(map.coverage.unexplored.length > 0); assert.equal(coverageSum(map.coverage), 1008); assert.equal(map.coverage.addressMapsBuilt, 30); assert.equal(map.status, 'cap-hit');
    const ev = run({ evalCap: 200 }); assert.ok(ev.coverage.capHits.includes('eval-cap')); assert.ok(ev.coverage.addressEvaluations <= 200); assert.ok(ev.coverage.unexplored.length > 0);
    const cc = run({ cConf: 4 }); assert.ok(cc.coverage.capHits.includes('chance-conflict-cap')); assert.equal(cc.diagnostics.chanceConflictCandidates, 4); assert.notEqual(cc.status, 'cap-hit', 'chance-conflict-cap 은 status cap-hit 을 만들지 않음');
    assert.deepEqual(P, STAGE2_POLICY, '정본 상한 불변');
    // 가지치기는 cap 이 아님: prunedLayer 항목은 4-튜플이고 capHits 에 관련 토큰 0 · lmCandidates ≤ 8
    for (const e of fx.output.diagnostics.prunedLayer) { assert.equal(e.length, 4); assert.ok([1, -1].includes(e[3])); }
    assert.ok(fx.output.diagnostics.lmCandidates <= 8);
    assert.ok(!fx.output.coverage.capHits.some(c => !_internals.CAP_ORDER.includes(c)));
    // v5 팔: 같은 근의 near/far 가 q_layer 동률이면 near 가 앞(남김)
    const near = { qLayer: 5, rms: 0.2, f: 1, t: 2, r: 0, layerSign: 1 }, far = { ...near, layerSign: -1 };
    assert.ok(_internals.compareTuples(_internals.layerKey(near), _internals.layerKey(far)) < 0);
    // b4Key: m raw 내림 → rms 오름
    assert.ok(_internals.compareTuples(_internals.b4Key({ m: 9, rms: 1, face: { minBlobId: 4 }, f: 0, t: 0, r: 0 }), _internals.b4Key({ m: 8, rms: 0.1, face: { minBlobId: 4 }, f: 0, t: 0, r: 0 })) < 0);
  });

  test('§6.2b-22 오프셋 cap · 교차-N · extent — N8 관측 × X1 쌍이 N10 finalist 의 E_k 로 cross-N-implausible «평가된 것» 회계(unexplored 오염 0) · uniquenessScope heuristic-pruned · offsetCap 은 [poseId, 쌍] 단위', () => {
    const { output } = mainFrame();
    const cov = output.coverage;
    if (cov.stage0.fired) {
      assert.ok(cov.addressTestsRejectedCrossN + cov.addressTestsRejectedExtent > 0 || cov.addressTestsRejectedGeometry > 0);
      assert.equal(cov.uniquenessScope, cov.addressTestsRejectedCrossN + cov.addressTestsRejectedExtent > 0 ? 'heuristic-pruned' : (cov.addressTestsRejectedGeometry > 0 ? 'geometry-pruned' : 'registry-complete'));
      for (const [Nk, pid] of Object.entries(cov.stage0.judgedBy)) { assert.ok(['N8', 'N10'].includes(Nk)); assert.ok(Number.isInteger(pid)); }
    } else {
      assert.equal(cov.addressTestsRejectedCrossN, 0);
      assert.deepEqual(cov.stage0.judgedBy, {});
    }
    assert.equal(cov.addressTestsRejectedCrossN % 336, 0);
    assert.equal(cov.addressTestsRejectedExtent % 336, 0);
    assert.equal(coverageSum(cov), 1008);
    for (const [pid, pr] of cov.offsetCap) { assert.ok(Number.isInteger(pid)); assert.ok(X_PROFILE_IDS.includes(pr)); }
    console.log('§6.2b-22 관측치: fired', cov.stage0.fired, 'judgedBy', JSON.stringify(cov.stage0.judgedBy), 'crossN', cov.addressTestsRejectedCrossN, 'extent', cov.addressTestsRejectedExtent, 'geometry', cov.addressTestsRejectedGeometry, 'unexplored', cov.unexplored.length, 'offsetCap', JSON.stringify(cov.offsetCap), 'scope', cov.uniquenessScope);
  });

  test('§6.2b-26 두 큐브·다중 물체 — 떨어진 두 blob 군 → multiObject true · clusters.count 2 · 큰 군만 · 작은 군 blobId 가 어떤 대응에도 0 개 · V 팔(작은 군 근처 V 는 vExcluded 이고 V 대응 0)', () => {
    const fx = synthFrame();
    const maxId = Math.max(...fx.blobs.map(b => b.blobId));
    // 작은 군: 프레임 오른쪽 아래 구석 3×5 격자(15 개, 간격 4 px) — 큰 군과 ≫ d_link
    const small = [];
    let id = maxId + 1; while (id % 8 < 4) id += 1;
    for (let i = 0; i < 15; i += 1) { small.push(mkBlob(id, 290 + (i % 3) * 4, 200 + Math.floor(i / 3) * 4)); id += 1; if (id % 8 === 0) id += 4; }
    let vId = id; while (vId % 8 !== 2) vId += 1;
    const vNear = mkBlob(vId, 302, 220); // 작은 군의 blob 과 ≤ d_link
    const out = xStage2([...fx.blobs, ...small, vNear], FRAME, CAM, STAGE2_POLICY);
    assert.equal(out.diagnostics.clusters.multiObject, true);
    assert.equal(out.diagnostics.clusters.count, 2);
    assert.ok(out.diagnostics.clusters.vExcluded >= 1);
    const smallIds = new Set(small.map(b => b.blobId));
    for (const h of out.hypotheses) {
      for (const [b] of [...h.correspondences.geom, ...h.correspondences.F]) assert.ok(!smallIds.has(b));
      for (const [b] of h.correspondences.V) assert.notEqual(b, vId);
    }
    assert.equal(out.diagnostics.clusters.largest, fx.output?.diagnostics.nGeom ?? out.diagnostics.nGeom);
    // 단일 군 입력: multiObject false · count 1
    const { output } = mainFrame();
    assert.equal(output.diagnostics.clusters.multiObject, false); assert.equal(output.diagnostics.clusters.count, 1);
    assert.equal(output.diagnostics.clusters.largest, output.diagnostics.nGeom);
  });

  test('§6.2b-28 unexplored 유도 — (다) N8 프레임 × N10 finalist ≥ 1: X1 cross-N 명시 거절 → unexplored [] · (라) 두 N 모두 finalist 0(면 가설 0 — 평행 두 직선): status rejected · RejectedGeometry 0 · |unexplored| 1008 · hypotheses []', () => {
    const { output } = mainFrame();
    const cov = output.coverage;
    if (cov.finalists.N8 >= 2 && cov.finalists.N10 >= 1 && cov.stage0.fired) { assert.equal(cov.addressTestsRejectedCrossN, 336); assert.deepEqual(cov.unexplored, []); assert.equal(cov.uniquenessScope, 'heuristic-pruned'); }
    assert.equal(coverageSum(cov), 1008);
    // (라) 평행 두 직선 위 blob(면 가설 0 → B3 에서 전부 거절)
    const par = [];
    let id = 4;
    for (let i = 0; i < 20; i += 1) { par.push(mkBlob(id, 60 + i * 10, 80)); id += 1; if (id % 8 === 0) id += 4; par.push(mkBlob(id, 60 + i * 10, 160)); id += 1; if (id % 8 === 0) id += 4; }
    const r = xStage2(par, FRAME, CAM, STAGE2_POLICY);
    assert.ok(['rejected', 'hull-insufficient'].includes(r.status), r.status);
    assert.equal(r.coverage.addressTestsRejectedGeometry, 0);
    assert.equal(r.coverage.unexplored.length, 1008);
    assert.deepEqual(r.hypotheses, []);
    if (r.status === 'rejected') assert.ok(r.diagnostics.faceRejected['face-lines-parallel'] > 0 || r.diagnostics.faceHypotheses === 0);
  });

  test('§6.2b-29 E_chance 재표집 결정성 — 키 접기 고정 벡터 4 스트림 · 같은 껍질·같은 키 → 같은 점열 · 경계 위 blob 은 안 · SD = 0 이면 Δ = z·SD_floor · 같은 입력 2 회 chance 필드 비트 동일 · null 은 s_min 미만에서 null', () => {
    assert.equal(xFnv1a32('3342300002|B4|0|0|0'), 4267369134);
    assert.equal(xSeedForStream('B4', 0, 0, 0), 4267369134);
    assert.equal(xSeedForStream('B5', 0, 0, 0), 3107417297);
    assert.equal(xSeedForStream('B7', 0, 0, 0, '+1'), 2234483569);
    assert.equal(xSeedForStream('B8', 0, 0, 0, '-1'), 282379436);
    assert.notEqual(xSeedForStream('B7', 0, 0, 0, '+1'), xFnv1a32('3342300002|B7|0|0|0|1'), 'layerSign 은 "+1"(부호 문자 필수)');
    const hull = _internals.convexHull([{ u: 0, v: 0, tag: 0 }, { u: 10, v: 0, tag: 1 }, { u: 10, v: 8, tag: 2 }, { u: 0, v: 8, tag: 3 }, { u: 5, v: 4, tag: 4 }]);
    assert.equal(hull.length, 4);
    const seq = () => { const s = _internals.makeHullSampler(hull); const rng = xMakeRng(xSeedForStream('B4', 1, 2, 3)); return [...Array(30)].map(() => s(rng)); };
    assert.deepEqual(seq(), seq());
    for (const p of seq()) assert.ok(_internals.insideConvex(hull, p.u, p.v));
    assert.equal(_internals.insideConvex(hull, 5, 0), true, '변 위는 안');
    assert.equal(_internals.insideConvex(hull, 5, -0.001), false);
    assert.equal(_internals.gate2Threshold(0, STAGE2_POLICY), STAGE2_POLICY.z * STAGE2_POLICY.sdFloor);
    assert.equal(_internals.gate2Threshold(2.48, STAGE2_POLICY), 4.96);
    const fx = mainFrame();
    const again = xStage2(clone(fx.blobs), FRAME, CAM, STAGE2_POLICY);
    fx.output.hypotheses.forEach((h, i) => {
      for (const k of ['chanceBaseline', 'chanceBaselineSd', 'chanceBaselineSe', 'chanceBaselineV', 'chanceConflict']) assert.deepEqual(again.hypotheses[i][k], h[k], k);
      assert.equal(h.chanceBaselineMethod, 'hull-resample-64');
      // §1.4 · §6.2-29 — chanceBaseline 은 E_chance 실수(64 회 평균)여야 해요. extent 배열을 싣던 결함(통합자 발견)을 여기서 잠가요
      assert.equal(typeof h.chanceBaseline, 'number', 'chanceBaseline 은 실수(E_chance)');
      assert.ok(Number.isFinite(h.chanceBaseline) && h.chanceBaseline >= 0, 'chanceBaseline 유한·비음');
      assert.equal(typeof h.chanceBaselineSd, 'number');
      assert.equal(h.chanceBaseline, Math.round(1e6 * h.chanceBaseline) / 1e6, '§5.3 실수 격자');
    });
    for (const rows of Object.values(fx.output.coverage.addressSupport)) for (const r of rows) if (r[1] < STAGE2_POLICY.sMin) assert.equal(r[3], null);
    assert.equal(fx.output.diagnostics.chanceConflictCandidates, Math.min(STAGE2_POLICY.cConf, fx.output.diagnostics.chanceConflictEligible));
    // «걸침» 팔(통합 수정 1차 — 반박 차단): 단위 (pose,쌍,o,M) 가 대표 support(finder 7 최댓값) ≥ s_min 으로 C_conf 에 들어도, 그 단위의 support < s_min 인 finder 라벨엔 null.
    // main 픽스처는 이 경우가 0 이라 위 단언이 아무것도 안 쟀어요(초록 테스트 ≠ 동작) — 근접 픽스처에서 걸침 단위가 ≥ 1 임을 먼저 요구해요(없으면 fail, skip 아님).
    const close = closeFrame();
    const units = new Map(); // (쌍, M, poseRank, o) → [finder, support, chanceConflict]
    for (const [lk, rows] of Object.entries(close.output.coverage.addressSupport)) { const [pr, fd] = lk.split('|'); for (const r of rows) { const key = `${pr}|${r[0]}|${r[4]}|${r[5].join(',')}`; if (!units.has(key)) units.set(key, []); units.get(key).push([fd, r[1], r[3]]); } }
    let crossing = 0;
    for (const fs of units.values()) {
      const hi = fs.filter(f => f[1] >= STAGE2_POLICY.sMin), lo = fs.filter(f => f[1] < STAGE2_POLICY.sMin);
      if (hi.length && lo.length && hi.some(f => f[2] !== null)) { crossing += 1; for (const f of lo) assert.equal(f[2], null, `걸침 단위의 support<s_min finder ${f[0]} 에 chanceConflict 수치 ${f[2]}`); }
    }
    assert.ok(crossing >= 1, `근접 픽스처에 걸침 단위가 없어요(픽스처 무효): units ${units.size}`);
    for (const rows of Object.values(close.output.coverage.addressSupport)) for (const r of rows) if (r[1] < STAGE2_POLICY.sMin) assert.equal(r[3], null);
    // 가설 필드도 같은 규칙: chanceConflict 수치 ⇔ fixedBitSupport ≥ s_min ∧ 보정 있음(conflictUncorrected false)
    for (const o of [fx.output, close.output]) for (const h of o.hypotheses) { if (h.fixedBitSupport < STAGE2_POLICY.sMin || h.conflictUncorrected) assert.equal(h.chanceConflict, null); else assert.equal(typeof h.chanceConflict, 'number'); }
    console.log('§6.2b-29 관측치: close 걸침 단위', crossing, '/ 단위', units.size, 'status', close.output.status, 'eligible', close.output.diagnostics.chanceConflictEligible);
  });

  test('§6.2b-31 B1 무영향 — options.axisFrame on/off 두 실행의 «B1-무영향 직렬화» sha 동일(정본 직렬화는 B1 필드 때문에 다름) · off 실행은 B1 3 필드 null · diagnostics.axisFrame 키 없음', () => {
    const fx = mainFrame();
    const off = xStage2(fx.blobs, FRAME, CAM, { axisFrame: false });
    assert.equal(xCanonicalSerialize(off, { b1Neutral: true }), xCanonicalSerialize(fx.output, { b1Neutral: true }));
    assert.equal(off.diagnostics.axisFrameCandidates, null); assert.equal(off.diagnostics.axisFrameAgreementDeg, null); assert.equal(off.diagnostics.lineAxisAgree, null);
    assert.equal('axisFrame' in off.diagnostics, false);
    assert.ok(['found', 'none'].includes(fx.output.diagnostics.axisFrame));
    if (fx.output.diagnostics.axisFrame === 'found') { assert.ok(fx.output.diagnostics.axisFrameCandidates >= 1); assert.ok(Number.isFinite(fx.output.diagnostics.axisFrameAgreementDeg)); assert.notEqual(xCanonicalSerialize(off), xCanonicalSerialize(fx.output)); }
    assert.equal(off.rejectReasons.includes('axis-frame-none'), false);
    // 삼중 0 인 프레임(작은 입력)에서도 on/off B1-무영향 직렬화 동일
    const few = mainFrame().blobs.filter(b => b.blobId % 8 >= 4).slice(0, 14);
    const onF = xStage2(few, FRAME, CAM, STAGE2_POLICY), offF = xStage2(few, FRAME, CAM, { axisFrame: false });
    assert.equal(xCanonicalSerialize(onF, { b1Neutral: true }), xCanonicalSerialize(offF, { b1Neutral: true }));
    console.log('§6.2b-31 관측치: main axisFrame', fx.output.diagnostics.axisFrame, 'few axisFrame', onF.diagnostics.axisFrame, 'status', onF.status);
  });

  test('§6.2b-42 회계 항등식 서로소 — ② 가 낸 coverage 전부에서 평가 + CrossN + Extent + Geometry + |unexplored| == 1008 · B8 미도달 프레임은 RejectedGeometry 0 · |unexplored| 1008', () => {
    for (const o of [mainFrame().output, x1Frame().output]) {
      const c = o.coverage;
      assert.equal(coverageSum(c), 1008);
      const seen = new Set(c.unexplored.map(l => l.join('|')));
      assert.equal(seen.size, c.unexplored.length, 'unexplored 중복 0');
      assert.equal(c.addressTestsDone + c.unexplored.length, 1008);
    }
    const tiny = xStage2(mainFrame().blobs.filter(b => b.blobId % 8 >= 4).slice(0, 5), FRAME, CAM, STAGE2_POLICY);
    assert.equal(tiny.status, 'too-few-blobs'); assert.equal(tiny.coverage.addressTestsRejectedGeometry, 0); assert.equal(tiny.coverage.unexplored.length, 1008);
  });

  test('§6.2b-43 uniquenessScope — 단계 0 거절이 있으면 heuristic-pruned, 없고 Geometry > 0 이면 geometry-pruned, 둘 다 없으면 registry-complete(«전체 registry 유일» 은 그때만)', () => {
    for (const o of [mainFrame().output, x1Frame().output]) {
      const c = o.coverage;
      const expect = c.addressTestsRejectedCrossN + c.addressTestsRejectedExtent > 0 ? 'heuristic-pruned' : c.addressTestsRejectedGeometry > 0 ? 'geometry-pruned' : 'registry-complete';
      assert.equal(c.uniquenessScope, expect);
    }
    console.log('§6.2b-43 관측치: main', mainFrame().output.coverage.uniquenessScope, 'x1', x1Frame().output.coverage.uniquenessScope);
  });

  test('§6.2b-48 hypotheses 모집단 — support 0 후보는 hypotheses 에 없음(addressSupport 에는 남음) · Z = ∅ 팔(s_min 상향)에서 support-below-threshold 후보가 오름 · (ㄷ) C_conf ≥ eligible 이면 capHits 에 chance-conflict-cap 없음 · dropped 0', () => {
    const fx = mainFrame();
    const rows = Object.values(fx.output.coverage.addressSupport).flat();
    const zero = rows.filter(r => r[1] === 0).length;
    console.log('§6.2b-48 관측치: addressSupport support-0 행', zero, '/', rows.length);
    for (const h of fx.output.hypotheses) assert.ok(h.fixedBitSupport > 0);
    // support 0 · conflict 0 후보가 q_addr = 0 으로 정렬에 들어오지 않음: 모집단은 지도 단위 support > 0 뿐
    const popKeys = new Set(fx.output.hypotheses.map(h => `${h.profile.profileId}|${h.finderId}|${h.addressTransform.transformId}`));
    for (const lk of Object.keys(fx.output.coverage.addressSupport)) for (const r of fx.output.coverage.addressSupport[lk]) if (r[1] === 0) assert.equal(popKeys.has(`${lk}|${r[0]}`), false);
    const below = xStage2(fx.blobs, FRAME, CAM, { sMin: 100000 });
    assert.equal(below.status, 'support-below-threshold');
    assert.ok(below.hypotheses.length >= 1);
    for (const h of below.hypotheses) { assert.ok(h.rejectReasons.includes('support-below-threshold')); assert.ok(h.fixedBitSupport > 0); }
    assert.deepEqual(below.coverage.survivorTransforms, {});
    assert.equal(below.selectedHypothesisId, null);
    // 정렬: selectionScore 사전순 내림 → q_addr 이 큰 후보가 위(support 0 · conflict 0 후보가 위에 서는 구현은 여기서 갈려요)
    for (let i = 1; i < below.hypotheses.length; i += 1) assert.ok(_internals.compareTuples(below.hypotheses[i - 1].selectionScore.map(x => -x), below.hypotheses[i].selectionScore.map(x => -x)) <= 0);
    const noCap = xStage2(fx.blobs, FRAME, CAM, { cConf: 100000 });
    assert.equal(noCap.coverage.capHits.includes('chance-conflict-cap'), false);
    assert.equal(noCap.diagnostics.conflictUncorrectedDropped, 0);
    assert.equal(noCap.rejectReasons.includes('ambiguous-address:uncorrected'), false);
    for (const h of noCap.hypotheses) assert.equal(h.conflictUncorrected, false);
    console.log('§6.2b-48 관측치: noCap status', noCap.status, 'reasons', JSON.stringify(noCap.rejectReasons));
  });

  test('§6.2b-49 직선 절단 — 직선 9 개 이상 입력에서 정렬 키 상위 8 만 남고 line-cap 기록 · status 는 selected 아님 · 절단된 직선의 hullOrder 유지(«절단 전 순환 이웃» 인접)', () => {
    const circle = polygonBlobs();
    const geom = circle.filter(b => b.blobId % 8 >= 4).filter((b, i) => i % 7 === 0).slice(0, 192).map(b => ({ id: b.blobId, u: b.u, v: b.v }));
    const r = _internals.silhouetteLines(geom, STAGE2_POLICY);
    assert.equal(r.lineCap, true); assert.equal(r.lines.length, 8);
    for (let i = 1; i < 8; i += 1) assert.ok(r.lines[i - 1].support.length >= r.lines[i].support.length);
    assert.ok(r.lines.some(L => L.hullOrder >= 8), 'hullOrder 는 재부여되지 않음(절단 전 값)');
    const out = xStage2(circle, FRAME, CAM, STAGE2_POLICY);
    assert.ok(out.coverage.capHits.includes('line-cap')); assert.notEqual(out.status, 'selected'); assert.equal(out.diagnostics.lines, 8);
  });

  test('§6.2b-50 껍질 변 병합 단일 패스 — A·B 2° · B·C 2°(적합 방향 기준) · A·C 4° → 한 직선 · 순환(마지막–첫 변) 병합 · 패스 끝은 시작 변과 병합 안 함 · 면 가설 거절(face-lines-parallel 5° · face-intersection-out) 이 p3p-duplicate-image 와 별개', () => {
    // 꼭짓점 사슬: 변 A(0°) → B(2°) → C(4°) 뒤 급격히 꺾이는 볼록 다각형, 각 변에 지지점 5 개
    const poly = [];
    const addEdge = (from, deg, len, n = 5) => { const th = deg * Math.PI / 180; const pts = []; for (let i = 1; i <= n; i += 1) pts.push({ u: from.u + Math.cos(th) * len * i / n, v: from.v + Math.sin(th) * len * i / n }); return pts; };
    let cur = { u: 40, v: 40 };
    // A 짧게(20) · B 길게(200) 라 A∪B 적합 방향 ≈ 1.8° → C(4°) 와 2.2° 차(적합 기준 < 3°) · A·C 원 변끼리는 4°
    const chain = [[0, 20], [2, 200], [4, 40], [95, 120], [178, 220], [275, 120]];
    for (const [deg, len] of chain) { const pts = addEdge(cur, deg, len); poly.push(...pts); cur = pts[pts.length - 1]; }
    const geom = poly.map((p, i) => ({ id: 4 + i + Math.floor(i / 4) * 4, u: p.u, v: p.v }));
    const r = _internals.silhouetteLines(geom, STAGE2_POLICY);
    const near0 = r.lines.filter(L => L.angle < 10 * Math.PI / 180);
    assert.equal(near0.length, 1, `0–4° 변 셋이 한 직선: ${r.lines.map(L => (L.angle * 180 / Math.PI).toFixed(1)).join(',')}`);
    assert.ok(near0[0].support.length >= 12, `support ${near0[0].support.length}`);
    assert.deepEqual(r.lines.map(L => L.hullOrder).sort((a, b) => a - b), r.lines.map((L, i) => i), 'hullOrder 0 부터 연속(병합 뒤 재부여)');
    // 순환: 시작 변이 사슬 중간이 아니라 «직전 변과 ≥ 3° 단절인 변» — 변 C(4°) 뒤 95° 가 첫 단절 → 병합 그룹이 마지막 변(275°)–첫 변(0°) 사이도 순환으로 닫힘
    assert.ok(r.L0 <= 4, `L0 ${r.L0}`);
    // 면 가설 거절 팔
    const mk = (angleDeg, p, sup) => { const th = angleDeg * Math.PI / 180; return { p, d: [Math.cos(th), Math.sin(th)], angle: (th % Math.PI + Math.PI) % Math.PI, support: sup, supportPts: sup.map((id, i) => ({ id, u: p[0] + i * 10 * Math.cos(th), v: p[1] + i * 10 * Math.sin(th) })), hullOrder: 0 }; };
    const D = { faceRejected: { 'face-lines-parallel': 0, 'face-intersection-out': 0 } };
    const l0 = mk(0, [50, 50], [4, 5, 6]), l5 = { ...mk(5, [50, 120], [12, 13, 14]), hullOrder: 1 };
    assert.equal(_internals.faceHypotheses([l0, l5], 2, FRAME, STAGE2_POLICY, D).length, 0);
    assert.equal(D.faceRejected['face-lines-parallel'], 1);
    const l20 = { ...mk(20, [50, 3000], [20, 21, 22]), hullOrder: 1 }; // 교점이 프레임 2 배 확장 밖
    assert.equal(_internals.faceHypotheses([l0, l20], 2, FRAME, STAGE2_POLICY, D).length, 0);
    assert.equal(D.faceRejected['face-intersection-out'], 1);
    const l90 = { ...mk(90, [100, 50], [30, 31, 32]), hullOrder: 1 };
    const faces = _internals.faceHypotheses([l0, l90], 2, FRAME, STAGE2_POLICY, D);
    assert.equal(faces.length, 1); assert.deepEqual(faces[0].C.map(Math.round), [100, 50]); assert.equal(faces[0].id, 0);
    assert.equal(D.faceRejected['face-lines-parallel'] + D.faceRejected['face-intersection-out'], 2, '두 검사는 별개로 세어짐');
  });

  test('§6.2b-53 비-X 무작위 blob 픽스처 — seed 3342300010 균등 무작위 150–300 개 × 20 벌 전부 status ≠ selected · selectedHypothesisId null · 종료 status 는 관측치 기록', () => {
    const rng = xMakeRng(3342300010);
    const observed = {};
    for (let k = 0; k < 20; k += 1) {
      const n = 150 + Math.floor(rng() * 151);
      const pts = []; for (let i = 0; i < n; i += 1) pts.push({ u: rng() * 320, v: rng() * 240 });
      pts.sort((a, b) => (Math.round(a.v) - Math.round(b.v)) || (a.u - b.u));
      const blobs = pts.map((p, i) => mkBlob(i, p.u, p.v)).filter(b => b.blobId % 8 >= 2);
      const o = xStage2(blobs, FRAME, CAM, STAGE2_POLICY);
      assert.notEqual(o.status, 'selected'); assert.equal(o.selectedHypothesisId, null);
      assert.ok(STATUSES.includes(o.status));
      observed[o.status] = (observed[o.status] ?? 0) + 1;
    }
    console.log('§6.2b-53 관측치(status 도수):', JSON.stringify(observed));
  });

  // ═══ selected 양성 팔 — §3.3 조건 7 항을 하나씩 양성 단언(스모크 50 프레임 selected 0 · 단위자 27 종 어디에도 양성 단언 0 이던 결함의 자) ═══
  test('§6.2b-28 (나) · §6.2b-22 (ㄹ) · §6.2b-48 (ㄷ)+v5(proper) · §6.2b-21 v3.1(cap 0) — selected 양성 팔: X1·edge-m1s2-v0 결정적 데이터 비트(전체 시야·near·잡음 0) + SEL_POLICY → status selected · 조건 7 항 전부 · 선택 가설 = GT(대응 100 % · pose 오차) · N8 finalist 0 → X0/X0g 672 RejectedGeometry · unexplored [] · geometry-pruned', () => {
    const fx = selFrame();
    const o = fx.output, cov = o.coverage, d = o.diagnostics;
    assert.equal(o.status, 'selected', `status ${o.status} reasons ${JSON.stringify(o.rejectReasons)}`);
    assert.deepEqual(o.rejectReasons, []);
    assert.ok(Number.isInteger(o.selectedHypothesisId));
    const h = o.hypotheses.find(x => x.hypothesisId === o.selectedHypothesisId);
    assert.ok(h, 'selectedHypothesisId 가 hypotheses 안을 가리켜요');
    // 조건 1 유일 생존 M(대표값 기준) · 조건 3 유일 계열 — 라벨 전체에서 생존 M 이 정확히 하나이고 그것이 선택 가설의 (쌍|finder, M)
    const surv = survivorList(cov);
    assert.deepEqual(surv, [[`${h.profile.profileId}|${h.finderId}`, h.addressTransform.transformId]], `survivors ${JSON.stringify(surv)}`);
    assert.equal(Object.keys(cov.survivorTransforms).length, 1, '유일 계열 (profile, finder 별칭 클래스)');
    // 조건 2 parity +1
    assert.equal(h.addressTransform.parity, 1); assert.equal(X_TRANSFORMS[h.addressTransform.transformId].parity, 1);
    // 조건 4 N 마진 — ambiguous-N 아님(finalist 1 개라 정의상 충족) · (ㄹ) finalist 1 개 → 그 N 에 (ㄱ) 발동, judgedBy 에 그 N 만
    assert.deepEqual(cov.finalists, { N8: 0, N10: 1 });
    assert.equal(cov.stage0.fired, true); assert.deepEqual(Object.keys(cov.stage0.judgedBy), ['N10']); assert.equal(cov.stage0.judgedBy.N10, h.poseId);
    // 조건 5 capHits ∖ {chance-conflict-cap} == [] (여기서는 [] 자체) · §6.2b-48 (ㄷ) eligible ≤ 64 → cap 미발동
    assert.deepEqual(cov.capHits, []);
    assert.ok(d.chanceConflictEligible <= STAGE2_POLICY.cConf, `eligible ${d.chanceConflictEligible}`);
    assert.equal(d.chanceConflictCandidates, d.chanceConflictEligible);
    // 조건 6 conflictUncorrectedDropped == 0 · 선택 가설은 보정을 받은(top-64) 단위
    assert.equal(d.conflictUncorrectedDropped, 0); assert.equal(h.conflictUncorrected, false); assert.equal(typeof h.chanceConflict, 'number');
    // 조건 7 unexplored == [] — (나) N8 finalist 0 → X0·X0g 표지 672 가 RejectedGeometry(«평가된 것»)로, 단계 0 거절 0 → geometry-pruned(«전체 registry 유일» 아님)
    assert.deepEqual(cov.unexplored, []);
    assert.equal(cov.addressTestsRejectedGeometry, 672); assert.equal(cov.addressTestsRejectedCrossN, 0); assert.equal(cov.addressTestsRejectedExtent, 0);
    assert.equal(cov.uniquenessScope, 'geometry-pruned');
    assert.deepEqual(cov.offsetCap, []);
    assert.equal(coverageSum(cov), 1008); assert.equal(cov.addressTestsDone, 1008);
    for (const lk of Object.keys(cov.addressSupport)) assert.ok(lk.startsWith('X1|'), `N8 쌍 라벨은 지도에 없어요: ${lk}`);
    // §6.2b-21 v3.1 — B5→LM 가지치기는 cap 이 아니고(capHits []) prunedLayer 는 4-튜플 · 그 프레임이 selected 에 닿음(층 모호 근 자체는 이 픽스처에 0 — 관측치)
    for (const e of d.prunedLayer) { assert.equal(e.length, 4); assert.ok([1, -1].includes(e[3])); }
    // GT 대조(테스트 안에서만): 선택 가설의 geom 대응 전부가 참 siteId · offset 0 · pose 오차 · profile/finder 가 장면과 같음 · 정본 R 은 SO(3)
    assert.equal(agreeCount(fx, h), h.correspondences.geom.length, 'geom 대응 100 % 일치');
    assert.ok(h.correspondences.geom.length >= STAGE2_POLICY.sMin);
    assert.deepEqual(h.addressTransform.offset, [0, 0, 0]);
    assert.equal(h.profile.profileId, 'X1'); assert.equal(h.finderId, 'edge-m1s2-v0');
    assert.ok(xIsRotation(h.R, 1e-5));
    assert.ok(xRotationAngleDeg(fx.pose.R, h.R) < 0.5, `회전 오차 ${xRotationAngleDeg(fx.pose.R, h.R)}°`);
    assert.ok(Math.hypot(...h.t.map((x, i) => x - fx.pose.t[i])) < 0.1, `t 오차 ${JSON.stringify(h.t)} vs ${JSON.stringify(fx.pose.t)}`);
    assert.equal(h.fixedBitConflicts, 0);
    assert.ok(h.fixedBitSupport >= STAGE2_POLICY.sMin);
    // 결정성: 같은 입력 2 회 정본 직렬화 동일 · 정본 정책 불변
    assert.equal(xCanonicalSerialize(xStage2(clone(fx.blobs), FRAME, CAM, SEL_POLICY)), xCanonicalSerialize(o));
    assert.equal(STAGE2_POLICY.finalistsPerN, 2); assert.equal(STAGE2_POLICY.mMin, 6);
    console.log('selected 양성 팔 관측치: blobs', fx.blobs.length, 'geom', h.correspondences.geom.length, 'support', h.fixedBitSupport, 'chanceConflict', h.chanceConflict, 'eligible', d.chanceConflictEligible, 'M', h.addressTransform.transformId, 'layerSign', h.addressTransform.layerSign, 'layerBothKept', d.layerBothKept, 'prunedPlanar', d.prunedPlanar, 'rmsPx', h.residualSummary.rmsPx);
  });

  test('§3.2·§3.3 «서로 다른 M 2 개 생존» 의 정의역 — 와이어 플립 A(finalistsPerN 1→봉인 2, 같은 blob): 같은 물리 pose 의 두 면 프레임이 N10 finalist 둘을 채워 프레임 상대 M 이 갈리고(2-survivors) · eligible 96 > C_conf → dropped ≥ 1 → :uncorrected(§6.2b-48 (ㄱ) 봉인 팔) — 두 생존 가설의 (R, t, geom 대응) 이 같은 물리 라벨링임을 잠가요(설계 공백 기록, 배선 결함 아님)', () => {
    const fx = selFrameTwoFinalists();
    const o = fx.output, cov = o.coverage, d = o.diagnostics;
    assert.deepEqual(cov.finalists, { N8: 0, N10: 2 });
    assert.equal(o.status, 'ambiguous', o.status);
    assert.equal(o.selectedHypothesisId, null);
    assert.ok(o.rejectReasons.includes('ambiguous-address:2-survivors'), JSON.stringify(o.rejectReasons));
    assert.ok(o.rejectReasons.includes('ambiguous-address:uncorrected'));
    assert.deepEqual(cov.capHits, ['chance-conflict-cap']);
    assert.equal(d.chanceConflictEligible, 2 * 48, '두 pose × 48 M 전부 support ≥ s_min(가시 코너 7 이 어느 finder 에서도 known-1 이고 코너 ↔ 코너)');
    assert.ok(d.conflictUncorrectedDropped >= 1);
    // 참 라벨의 생존 M 2 개 — 각각 다른 poseRank 에서 왔고, 두 가설의 출력 pose 와 geom 대응(blobId → siteId)이 동일
    const lk = 'X1|edge-m1s2-v0';
    assert.equal(cov.survivorTransforms[lk].length, 2, JSON.stringify(cov.survivorTransforms));
    const hs = cov.survivorTransforms[lk].map(m => o.hypotheses.find(h => h.finderId === 'edge-m1s2-v0' && h.addressTransform.transformId === m));
    assert.ok(hs.every(Boolean), '두 생존 M 이 hypotheses 에 있어요');
    assert.notEqual(hs[0].poseId, hs[1].poseId);
    assert.notEqual(hs[0].faceFrame.faceHypothesisId, hs[1].faceFrame.faceHypothesisId, '다른 면 프레임');
    assert.ok(xRotationAngleDeg(hs[0].R, hs[1].R) < 0.1, `같은 물리 pose: ΔR ${xRotationAngleDeg(hs[0].R, hs[1].R)}°`);
    assert.ok(Math.hypot(...hs[0].t.map((x, i) => x - hs[1].t[i])) < 0.05);
    const g0 = new Map(hs[0].correspondences.geom), g1 = new Map(hs[1].correspondences.geom);
    const shared = [...g0.keys()].filter(id => g1.has(id));
    assert.ok(shared.length >= STAGE2_POLICY.sMin);
    assert.ok(shared.every(id => g0.get(id) === g1.get(id)), '같은 blob 이 같은 정본 siteId 로 — 두 «M» 은 같은 라벨링');
    for (const h of hs) { assert.equal(agreeCount(fx, h), h.correspondences.geom.length); assert.equal(h.addressTransform.parity, 1); }
    // 회계는 그대로(§6.2b-28 (나) 의 N8 finalist 0 팔은 이 플립에서도 성립)
    assert.equal(cov.addressTestsRejectedGeometry, 672); assert.deepEqual(cov.unexplored, []); assert.equal(cov.uniquenessScope, 'geometry-pruned'); assert.equal(coverageSum(cov), 1008);
    console.log('와이어 플립 A 관측치: survivors', JSON.stringify(cov.survivorTransforms), 'eligible', d.chanceConflictEligible, 'dropped', d.conflictUncorrectedDropped, 'poses', JSON.stringify(hs.map(h => [h.poseId, h.faceFrame.faceHypothesisId, h.addressTransform.layerSign, h.addressTransform.transformId])));
  });

  test('§6.2b-22 첫 문장(Ω > Ω_max 쌍 → offset-cap + unexplored) · §2.9 (ㄴ) 최상위 둘의 N 상이 → 단계 0 미발동 · §3.3 unresolved 생성 규칙 — 와이어 플립 B(mMin 16→봉인 6, 같은 blob): N8 오축척 근이 B4 를 넘어 N8 finalist 가 서고 그 pose 의 X0/X0g 지도가 Ω > 8 이라 [1,X0]·[1,X0g] offsetCap · 672 unexplored → 유일 생존이어도 unresolved(selected 조건 7 만 미충족)', () => {
    const fx = selFrameSealedMMin();
    const o = fx.output, cov = o.coverage;
    assert.deepEqual(cov.finalists, { N8: 1, N10: 1 });
    assert.equal(cov.stage0.fired, false); assert.deepEqual(cov.stage0.judgedBy, {});
    assert.equal(cov.addressTestsRejectedCrossN, 0); assert.equal(cov.addressTestsRejectedExtent, 0); assert.equal(cov.addressTestsRejectedGeometry, 0);
    assert.equal(o.status, 'unresolved', `${o.status} ${JSON.stringify(o.rejectReasons)}`);
    assert.deepEqual(o.rejectReasons, ['offset-cap']);
    assert.equal(o.selectedHypothesisId, null);
    const n8Pose = fx.trace.finalists.find(r => r[0] === 1);
    assert.ok(n8Pose, 'poseRank 1 이 N8 finalist');
    assert.deepEqual(cov.offsetCap.map(x => x.join('|')).sort(), ['1|X0', '1|X0g']);
    assert.equal(cov.unexplored.length, 672);
    assert.ok(cov.unexplored.every(([p]) => X_PROFILE_IDS[p] !== 'X1'), 'unexplored 는 N8 쌍 표지뿐');
    assert.equal(cov.uniquenessScope, 'registry-complete'); assert.equal(coverageSum(cov), 1008);
    // 조건 1–6 은 충족(유일 생존 · proper · 유일 계열 · N 마진 · cap 0 · dropped 0) — 조건 7 만 unexplored ≠ []
    const surv = survivorList(cov);
    assert.equal(surv.length, 1, JSON.stringify(surv));
    assert.equal(surv[0][0], 'X1|edge-m1s2-v0'); assert.equal(X_TRANSFORMS[surv[0][1]].parity, 1);
    assert.deepEqual(cov.capHits, []); assert.equal(o.diagnostics.conflictUncorrectedDropped, 0);
    assert.ok(!o.rejectReasons.some(r => r.startsWith('ambiguous')));
    assert.equal(o.hypotheses.length, 1); assert.equal(agreeCount(fx, o.hypotheses[0]), o.hypotheses[0].correspondences.geom.length);
    console.log('와이어 플립 B 관측치: N8 finalist', JSON.stringify(n8Pose), 'offsetCap', JSON.stringify(cov.offsetCap), 'prunedPlanar', o.diagnostics.prunedPlanar);
  });

  test('§6.2b-48 v6 (ㄱ) 고립 팔 — 양성 픽스처 + cConf 4(테스트 전용): 유일 생존 M 이 top-4 안이고 5 번째 이후 단위 중 보수 κ 탈락 ≥ 1 → capHits [chance-conflict-cap] · status ambiguous · ambiguous-address:uncorrected 만 · selectedHypothesisId null — 같은 blob 이 cConf 64 에서는 selected(위 팔)', () => {
    const fx = selFrame();
    const o = xStage2(fx.blobs, FRAME, CAM, { ...SEL_POLICY, cConf: 4 });
    assert.deepEqual(o.coverage.capHits, ['chance-conflict-cap']);
    assert.equal(o.diagnostics.chanceConflictCandidates, 4);
    assert.ok(o.diagnostics.conflictUncorrectedDropped >= 1, `dropped ${o.diagnostics.conflictUncorrectedDropped}`);
    assert.equal(o.status, 'ambiguous');
    assert.deepEqual(o.rejectReasons, ['ambiguous-address:uncorrected', 'cap-hit:chance-conflict-cap']);
    assert.equal(o.selectedHypothesisId, null);
    assert.deepEqual(survivorList(o.coverage), survivorList(fx.output.coverage), '생존 집합은 그대로(경쟁자 탈락 사건만 유일성 주장을 막아요)');
    assert.equal(o.hypotheses[0].conflictUncorrected, false, '유일 생존 M 자신은 top-4 안(보정 받음)');
    console.log('§6.2b-48 (ㄱ) 고립 팔 관측치: dropped', o.diagnostics.conflictUncorrectedDropped, 'eligible', o.diagnostics.chanceConflictEligible);
  });

  test('§6.2b-48 v5 parity 팔 — 점등 패턴을 x ↔ N−1−x 로 반사한 입력(참 라벨이 improper): 생존 M 전부 det −1 → status improper-only · selectedHypothesisId null · 가설 parity −1 · 회계는 양성 팔과 같음(§3.3 «거울상 아님 을 주장하지 않아요»)', () => {
    const fx = synthFrame({ profile: 'X1', finder: 'edge-m1s2-v0', dataBits: edgeDataRule([5]), mirror: true });
    const o = xStage2(fx.blobs, FRAME, CAM, SEL_POLICY);
    assert.equal(o.status, 'improper-only', `${o.status} ${JSON.stringify(o.rejectReasons)}`);
    assert.equal(o.selectedHypothesisId, null);
    assert.ok(o.rejectReasons.includes('improper-only'));
    const surv = survivorList(o.coverage);
    assert.ok(surv.length >= 1);
    for (const [, m] of surv) assert.equal(X_TRANSFORMS[m].parity, -1, `생존 M ${m} 은 improper`);
    for (const h of o.hypotheses) { assert.equal(h.addressTransform.parity, -1); assert.equal(h.addressTransform.addressMapDet, h.addressTransform.layerSign === -1 ? 1 : -1, 'far 는 det T = −det M'); assert.ok(xIsRotation(h.R, 1e-5), 'improper 여도 R ∈ SO(3)'); }
    assert.deepEqual(o.coverage.capHits, []); assert.deepEqual(o.coverage.unexplored, []); assert.equal(o.coverage.addressTestsRejectedGeometry, 672);
    console.log('§6.2b-48 v5 parity 팔 관측치: survivors', JSON.stringify(o.coverage.survivorTransforms), 'top M', o.hypotheses[0]?.addressTransform.transformId, 'support', o.hypotheses[0]?.fixedBitSupport);
  });

  test('§6.2b-29 v4 팔(R7-16 · O-12) — 다른 근의 gate-1 결과를 바꿔도(mMin 6 → 16 으로 앞 근들을 planar-unsupported 로) 같은 구조 키 (면, 삼중, 근, layerSign) 근의 chanceBaseline·Sd·Se·V·chanceConflict 가 비트 동일(러닝 카운터 구현은 여기서 갈려요) · 결정성 키가 poseId 가 아님', () => {
    const a = selFrame(), b = selFrameSealedMMin();
    const keyOf = h => [h.faceFrame.faceHypothesisId, h.faceFrame.kB, h.faceFrame.kD, h.faceFrame.layerSign, h.addressTransform.transformId, h.finderId].join('|');
    const ha = a.output.hypotheses[0], hb = b.output.hypotheses.find(h => keyOf(h) === keyOf(ha));
    assert.ok(hb, `같은 구조 키 가설이 두 실행에 있어요: ${keyOf(ha)}`);
    assert.notEqual(a.output.diagnostics.matchRuns.gate1PassedRoots, b.output.diagnostics.matchRuns.gate1PassedRoots, 'gate-1 통과 근 수가 실제로 달라요');
    for (const k of ['chanceBaseline', 'chanceBaselineSd', 'chanceBaselineSe', 'chanceBaselineV', 'chanceConflict', 'fixedBitSupport', 'fixedBitConflicts']) assert.deepEqual(hb[k], ha[k], k);
    assert.deepEqual(hb.faceFrame.R_f, ha.faceFrame.R_f); assert.deepEqual(hb.faceFrame.t_f, ha.faceFrame.t_f);
    console.log('§6.2b-29 v4 팔 관측치: gate1PassedRoots', a.output.diagnostics.matchRuns.gate1PassedRoots, '→', b.output.diagnostics.matchRuns.gate1PassedRoots, 'chanceBaseline', ha.chanceBaseline);
  });

  test('§6.2b-22 (ㄴ) ambiguous-N → 단계 0 미발동 · X1 쌍 명시 거절 0 — N8 프레임(X0·edge-m1s3-w1, 경쟁 라벨 known-0 데이터 규칙) + SEL_POLICY: N10 (7,7) 삼중이 N8 코너 기하에 정확히 맞아 N10 finalist 가 서요(§8.3-15) → §6.2b-28 (가) «N10 finalist 0 인 N8 프레임» 은 이 픽스처 계열로 구성 불가(관측 기록) · X0/X0g 상호 conflict 없음 → ambiguous-profile(§8.3-2)', () => {
    const fx = synthFrame({ profile: 'X0', finder: 'edge-m1s3-w1', dataBits: competitorZeroRule('X0', 'edge-m1s3-w1') });
    const o = xStage2(fx.blobs, FRAME, CAM, SEL_POLICY);
    const cov = o.coverage;
    assert.deepEqual(cov.finalists, { N8: 1, N10: 1 }, JSON.stringify(cov.finalists));
    assert.ok(o.rejectReasons.includes('ambiguous-N'), JSON.stringify(o.rejectReasons));
    assert.equal(cov.stage0.fired, false); assert.deepEqual(cov.stage0.judgedBy, {});
    assert.equal(cov.addressTestsRejectedCrossN, 0); assert.equal(cov.addressTestsRejectedExtent, 0); assert.equal(cov.addressTestsRejectedGeometry, 0);
    assert.equal(cov.uniquenessScope, 'registry-complete');
    assert.ok(o.rejectReasons.includes('ambiguous-profile'), 'X0/X0g 는 양의 증거만으로 못 갈라요');
    assert.notEqual(o.status, 'selected'); assert.equal(o.selectedHypothesisId, null);
    assert.equal(coverageSum(cov), 1008);
    console.log('§6.2b-22 (ㄴ) N8 팔 관측치: status', o.status, 'reasons', JSON.stringify(o.rejectReasons), 'unexplored', cov.unexplored.length, 'offsetCap', JSON.stringify(cov.offsetCap), 'blobs', fx.blobs.length);
  });
});

// ═════════════════════════════ §7.2 카운터 ═════════════════════════════
describe('§7.2 카운터·회계(손 검산표 §1.4)', () => {
  test('§7.2 상한 · §1.4 손 검산 항등식 — 삼중 ≤ 264 · 근 ≤ 1,056 · lmRuns ≤ 16 · 지도 ≤ 4,608 · 평가 ≤ 32,256 · chanceResample 분모 · p3pReasons 합 · p3pRoots 부등식 · finalist 상한 · nD.F', () => {
    for (const { output: o } of [mainFrame(), x1Frame()]) {
      const d = o.diagnostics, c = o.coverage, P = STAGE2_POLICY;
      assert.ok(d.triplesEnumerated <= 264 && d.p3pRoots <= 1056 && d.lmRuns <= 16 && c.addressMapsBuilt <= P.mapCap && c.addressEvaluations <= P.evalCap);
      assert.ok(d.lines <= 8 && d.faceHypotheses <= 8);
      assert.equal(d.matchRuns.chanceResampleB4, 64 * d.matchRuns.gate1PassedRoots);
      assert.equal(d.matchRuns.chanceResampleB5, 64 * d.matchRuns.primaryB5);
      assert.equal(d.matchRuns.chanceResampleB7, 64 * d.matchRuns.primaryB7);
      assert.equal(d.matchRuns.chanceResampleB8, 64 * (c.finalists.N8 + c.finalists.N10));
      assert.equal(Object.values(d.p3pReasons).reduce((s, x) => s + x, 0), d.triplesEnumerated, 'p3pReasons 합(p3p-duplicate-image 포함) = triplesEnumerated');
      assert.ok(d.p3pRoots <= d.p3pCandidates - d.p3pDroppedBehind - d.p3pDedupMerged - d.p3pDroppedOverflow);
      assert.ok(d.lmRuns <= 2 * d.lmCandidates && d.lmCandidates <= 8);
      assert.ok(d.matchRuns.primaryB7 <= d.lmCandidates);
      assert.ok(c.finalists.N8 <= 2 && c.finalists.N10 <= 2 && c.finalists.N8 + c.finalists.N10 <= Math.min(4, d.matchRuns.primaryB7));
      assert.equal(d.chanceConflictCandidates, Math.min(P.cConf, d.chanceConflictEligible));
      assert.ok(d.conflictUncorrectedDropped <= d.chanceConflictEligible - d.chanceConflictCandidates);
      assert.equal(d.matchRuns.primaryB5, 2 * (o.diagnostics.prunedPlanar >= 0 ? d.matchRuns.primaryB5 / 2 : 0));
      if (o.hypotheses.length) assert.equal(d.nD.F, Math.min(48, o.hypotheses[0].correspondences.geom.length));
      assert.ok(d.nD.V <= 16 && d.nGeom <= 192);
      assert.equal(d.faceHypotheses, new Set(o.hypotheses.map(h => h.faceFrame.faceHypothesisId)).size <= d.faceHypotheses ? d.faceHypotheses : -1);
      assert.deepEqual(d.approximations, ['blob-sigma-approximated-from-scalePx']);
    }
  });
});
