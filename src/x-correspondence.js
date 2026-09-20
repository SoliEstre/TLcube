/**
 * x-correspondence — Type X 단계 ② 본체(구현자 C 소유): blob 목록 + 보정 카메라 → pose 가설 ≤ 4 · 주소 가설 · coverage 회계.
 *
 * 정본: `.agent/lanes/type-x-core-20260919/DESIGN_006_stage2-correspondence-pose.md` v6 봉인판(sha 5aefa00b…) + v6.1 통합 수정 1차 개정(sha 7f9251b7…, `d9-design-amendment-001.json`),
 * 계약: `stage2-api-contract.md` §3–§6 · §9(계약 결정). 값·규칙·어휘는 설계를 인용하고, 계약과 설계가 다르면 설계가 이겨요.
 *
 * ── 설계 인용(이 파일이 구현하는 절) ──────────────────────────────────────────────────────────────────────────
 *   §1.2 입력 allowlist — 시그니처 `(blobs[], frame{width,height}, camera, policy)`. ② 는 던지지 않고 형식 위반을
 *        `status:'invalid-input'` 로 내요(계약 §9-1; 예외는 `policy` 가 plain object 가 아닌 프로그래머 오류뿐).
 *        `frame` 의 own enumerable key 집합이 정확히 두 키가 아니면 `invalid-input`(v5.1 R10-01). 카메라 `cx ∈ [0,w]` · `cy ∈ [0,h]`.
 *   §1.3 F/V/T — `blobId mod 8` → {0,1} T(러너가 원소째 제거, ② 는 연속을 요구하지 않음) · {2,3} V · {4–7} F.
 *   §1.4 출력 스키마 — `output` 객체(래퍼 없음), 시간 3 필드는 `null`(러너가 덧붙여요).
 *   §2.1 B0 — 제외(`mergeSuspected ∨ edgeTruncated`) 먼저 → `nGeom = min(|F∖제외|, 192)` 를 4×4 셀 행우선 round-robin 으로 ·
 *        V 표본 16(같은 격자, 큰 성분 귀속) · `|F∖제외| < 12 → too-few-blobs`.
 *   §2.1b B0.5 — `d_link = 3 × median(kNN k=3)`(nGeom 안), 단일 연결 성분, 크기 ≥ 12 성분 2 개 이상 → `multiObject`, 가장 큰 성분만.
 *   §2.2 B1 — 축 프레임(진단 전용): 반구 큐브맵 6×24×24 대원 투표 → NMS 16 → 직교 삼중 ≤ 2. 순위·절단 어디에도 안 들어가요.
 *   §2.3 B2 — Andrew 껍질(엄격) · 꼭짓점 ≤ 32 · 고립 외톨이 · 순환 단일 패스 병합(3°) · 로버스트 직선(τ_line 2.0 px, 지지 ≥ 3) ·
 *        정렬 `(지지 내림, 각도 오름 round(1e9), 최소 blobId, 목록 사전순)` · `L ≤ 8`(line-cap) · `L < 2 → hull-insufficient`.
 *   §2.4 B3 — 순환 인접 쌍만 면 가설, 거절 `face-lines-parallel`(θ_min 10°) · `face-intersection-out`(2 배 확장 사각형) ·
 *        원점 C = 해석적 교점 · B/D = 가장 먼 지지 blob · 삼중 33 `(N,k_B,k_D)` · `p3p-duplicate-image`(< 2 px) · `xP3P(…, P3P_OPTS)`.
 *   §2.5 B4 — 면 사이트 N² 투영 · gate `g = min(γ·pitchPx_hyp(+1), g_abs)` · 분리성(최근접 ≤ g ∧ 2번째 > 2g) · 정규형 매칭 ·
 *        gate 1 `m ≥ m_min` → `E_chance` 64 회(껍질 안 `n_in` 재표집, 키 `("B4", f, t, r)`) → gate 2 `m − E ≥ z·max(SD, SD_floor)` →
 *        N 별 `K1 = 4` 보존(`prunedPlanar`).
 *   §2.6 B5 — `layerSign ∈ {+1,−1}` 두 분기 N³ 투영 · 합집합 껍질 null(키 `("B5", f, t, r)`) · `D` · `Δ_layer` · N 층화 가지치기(`prunedLayer`).
 *   §2.7 B6 — `xPoseRefine2Rounds`(라운드 1 면 대응 → 트리밍 → 재매칭 전 층 geom → 라운드 2).
 *   §2.8 B7 — V 재매칭 inlier · `E_chance_V`(키 `("B7", f, t, r, layerSign)`) · `q_geom` · N 별 상위 2 → finalist ≤ 4 · `poseRank` · `ambiguous-N`.
 *   §2.9 B8 — 단계 0(N 별 판정) · Ω 열거 · 지도 `(pose, 쌍, o, M)` · support/conflict · `E_conflict_chance`(키 `("B8", f, t, r, layerSign)`) ·
 *        `C_conf = 64` 절단 · `Z` · 회계 항등식 · `uniquenessScope`.
 *   §2.10 B9 — 별칭 클래스 한 항목 · 라벨 대표값 · `selectionScore = [q_geom, q_addr, q_fit]` · 정렬 말단 키 · 상위 4 · `hypothesisId`.
 *   §3.2 · §3.3 어휘 · status 결정 순서(전순서) · `selected` 조건 · §3.5 겹침(`sep_design 3.0 px`) · `degenerate-view`.
 *   §4.3 문턱 표 → `STAGE2_POLICY` · §4.4 seed `3342300002` 네 스트림(FNV-1a 32 접기) · §5.3 직렬화 둘 · §7.2 카운터.
 *
 * ── 규율 ──────────────────────────────────────────────────────────────────────────────────────────────────────
 *   외부 의존성 0 · ESM · 결정적(RNG 는 §4.4 키 접기만 · Map 순회 대신 정렬 배열 · 정수 전순서 키) · 유계(카운터 · cap) ·
 *   GT 계열(정답 · 신탁 · 관측 행 파일과 러너 전용 필드)을 import/open/인자로 받지 않아요(§6.2b-19 정적 팔).
 *   정렬 키는 전부 정수 튜플 + `compareTuples`(계약 §9-3), 실수는 `round(1e6·x)` 로 양자화해 넣어요.
 *
 * ── 이 파일이 정하지 않은 자리(설계가 침묵한 것 — 보고서 designDeviations/limitations 참조) ─────────────────────
 *   · 정규형 매칭은 분리성 조건 아래 blob 차수 ≤ 1 이라 «사이트별 최소 (양자화 비용, blobId)» 의 닫힌 형태로 구현해요 —
 *     그 구조에서는 최대 cardinality · 최소 비용 · 사전순 최소 매칭과 동일해요(§2.5 정규형).
 *   · 로버스트 직선 재적합은 지지 집합 PCA → 하위 중앙값 이하 잔차 부분집합 PCA → 재지지(설계 «median-of-residuals 1 라운드»).
 *   · B1 큐브맵 면 경계 8-이웃은 (면·행) 을 한 축으로 편 144×24 격자의 8-이웃(«전순서상 인접 셀»).
 */
import { X_PROFILE_IDS, xProfile } from './x-profile.js';
import { X_FINDER_IDS } from './x-finder.js';
import { xSiteId, xSiteCoord } from './x-layout.js';
import { mat3Mul, mat3Apply, X_CAMERA_MODEL } from './x-project.js';
import { xP3P, xBearingsFromPixels, xExpSO3, xRotationAngleDeg } from './x-p3p.js';
import { xProjectPoint, xResidualStats, xRoundSerial, xRoundSerialArray, xPoseRefine2Rounds } from './x-pose-lm.js';
import {
  X_TRANSFORMS, X_ADDRESS_PI, X_ADDRESS_S, xAddressMap, xOutputRotation, xOutputTranslation, xPitchPxHyp, xSiteFromFaceLocal, xExtent,
  xStage0Filter, xOffsetRange, xEffectiveMap, xAliasClasses, xCountSupport, xUndeterminedCount, X_ADDRESS_TESTS_TOTAL,
  xCoverageIdentity, xUnexploredDerive, xLabelKey, xTripleIndexTable, xUniquenessScope, xPairsOfN,
} from './x-address-48.js';

// ───────────────────────────── §4.3 정책 · §4.1 P3P_OPTS ─────────────────────────────

/** §4.3 문턱 표(계약 §4 키 철자) — 동결. `seed` 는 §4.4 ② 정책 갈래 `3342300002` 뿐이에요. */
export const STAGE2_POLICY = Object.freeze({
  nD: Object.freeze({ F: 48, V: 16 }), nGeom: 192,
  lineCap: 8, tauLinePx: 2.0, gAbsPx: 2.0, gammaPitch: 0.40,
  nChance: 64, z: 2, sdFloor: 1,
  huberDelta: 1, trim: 0.10,
  tripleCap: 384, rootCap: 1536, lmRunCap: 16, mapCap: 4608, evalCap: 32256, cConf: 64,
  omegaMax: 8, dupPixelPx: 2,
  so3Tol: 1e-6, condMax: 1e12, depthMin: 1e-6,
  tauSepDeg: 0.3, tauDirDeg: 8, sepDesignPx: 3.0,
  mMin: 6, sMin: 6, rho: 0.05, deltaN: 3.0,
  thetaMinDeg: 10,
  dLinkFactor: 3, dLinkK: 3, clusterMin: 12,
  hullMaxVertices: 32, mergeDeg: 3, outlierFactor: 3,
  K1: 4, finalistsPerN: 2,
  seed: 3342300002,
  axisFrame: true,
  pitch: 1,
});
/** §4.1 · §4.3 — 정본 `xP3P` 에 넘기는 유일한 옵션 객체(`maxSolutions` 봉인값 4, 그 밖의 키 0 → 정본 기본값 상속) */
export const P3P_OPTS = Object.freeze({ maxSolutions: 4 });
export const X_STAGE2_SCHEMA = 'TLcube:X:pose-hypotheses:v0';

// ───────────────────────────── §4.4 seed 접기 · RNG ─────────────────────────────

/** FNV-1a 32 비트(offset 0x811c9dc5 · prime 0x01000193, 바이트마다 XOR 뒤 곱, 32 비트 wrap) — UTF-8 바이트열 */
export function xFnv1a32(str) {
  const bytes = new TextEncoder().encode(String(str));
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** §4.4 키 접기: `"3342300002|" + tag + "|" + ints.join("|")` — `layerSign` 은 `"+1"`/`"-1"`(부호 문자 필수) */
export function xSeedForStream(tag, ...ints) {
  const parts = ints.map(v => {
    if (typeof v === 'string') return v;
    if (!Number.isInteger(v)) throw new TypeError('xSeedForStream: 정수 또는 부호 문자열이어야 해요');
    return String(v);
  });
  return xFnv1a32(`${STAGE2_POLICY.seed}|${tag}|${parts.join('|')}`);
}
const layerSignStr = s => (s === -1 ? '-1' : '+1');
/** mulberry32 — 32 비트 seed 생성기(`() => [0,1)`) */
export function xMakeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────── 공용 소도구 ─────────────────────────────

const q6 = x => Math.round(1e6 * x) + 0; // 계약 §9-2 정수 양자화(−0 → +0)
const q9 = x => Math.round(1e9 * x) + 0;
/** 정수/문자열 튜플 전순서 비교(계약 §9-3) */
function compareTuples(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i], y = b[i];
    if (Array.isArray(x) && Array.isArray(y)) { const c = compareTuples(x, y); if (c !== 0) return c; continue; }
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}
const sortBy = (arr, keyOf) => arr.map(v => ({ v, k: keyOf(v) })).sort((p, q) => compareTuples(p.k, q.k)).map(p => p.v);
const isPlainObject = o => o !== null && typeof o === 'object' && !Array.isArray(o) && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
const isFin = v => typeof v === 'number' && Number.isFinite(v);
/** 하위 중앙값(정렬 뒤 `⌊(n−1)/2⌋` 번째, §2.3 · §2.1b) */
function lowerMedian(arr) { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; }
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
/** 표본 표준편차(n−1, 계약 §9-4) */
function sampleSd(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }
/** gate 2 · Δ_layer 문턱 `z·max(SD, SD_floor)`(§2.5 · §2.6 · §4.3) */
const gate2Threshold = (Sd, P) => P.z * Math.max(Sd, P.sdFloor);
const det3 = R => R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
const mat3T = a => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = a => Math.hypot(a[0], a[1], a[2]);
const unit3 = a => { const n = norm3(a); return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : null; };
const DEG = Math.PI / 180;
/** 방향 각도를 `[0, π)` 로 접기(§2.3) */
const foldAngle = th => { let a = th % Math.PI; if (a < 0) a += Math.PI; if (a >= Math.PI) a -= Math.PI; return a; };
/** 두 방향 사잇각을 `[0, π/2]` 로 접기 */
const foldedDiff = (a, b) => { let d = Math.abs(foldAngle(a) - foldAngle(b)); if (d > Math.PI / 2) d = Math.PI - d; return d; };

// ───────────────────────────── 기하: 껍질 · 다각형 · 재표집 ─────────────────────────────

/** Andrew monotone chain — 엄격 좌회전만(공선 제외), 정렬 키 `(u, v, tag)`. 반환 순서 = 수치 (u,v) 반시계 = 화면(v 아래) 시계 방향, 시작 = 최소 */
function convexHull(pts) {
  const s = pts.slice().sort((a, b) => (a.u - b.u) || (a.v - b.v) || (a.tag - b.tag));
  const uniq = [];
  for (const p of s) if (!uniq.length || uniq[uniq.length - 1].u !== p.u || uniq[uniq.length - 1].v !== p.v) uniq.push(p);
  if (uniq.length < 3) return uniq;
  const cross = (o, a, b) => (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
  const lower = [];
  for (const p of uniq) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i -= 1) { const p = uniq[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}
function polygonArea2(h) { let a = 0; for (let i = 0; i < h.length; i += 1) { const p = h[i], q = h[(i + 1) % h.length]; a += p.u * q.v - q.u * p.v; } return a; }
/** 볼록 다각형 안/경계(부호 면적 ≥ 0 — 변 위는 «안», §2.5 (ㄹ)) */
function insideConvex(h, u, v) {
  if (h.length < 3) return false;
  const orient = polygonArea2(h) >= 0 ? 1 : -1;
  for (let i = 0; i < h.length; i += 1) {
    const p = h[i], q = h[(i + 1) % h.length];
    if (orient * ((q.u - p.u) * (v - p.v) - (q.v - p.v) * (u - p.u)) < 0) return false;
  }
  return true;
}
/** §2.5 (ㄱ)(ㄴ)(ㄷ) — 삼각형 팬 · 면적 가중 선택 · barycentric 반사 표집기. 면적 0 이면 null. */
function makeHullSampler(hull) {
  if (hull.length < 3) return null;
  const tris = [], cum = [];
  let total = 0;
  for (let i = 1; i + 1 < hull.length; i += 1) {
    const a = hull[0], b = hull[i], c = hull[i + 1];
    const area = Math.abs((b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u)) / 2;
    tris.push([a, b, c]); total += area; cum.push(total);
  }
  if (!(total > 0)) return null;
  return rng => {
    const x = rng() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] <= x) lo = mid + 1; else hi = mid; }
    const [a, b, c] = tris[lo];
    let u2 = rng(), u3 = rng();
    if (u2 + u3 > 1) { u2 = 1 - u2; u3 = 1 - u3; }
    return { u: a.u + u2 * (b.u - a.u) + u3 * (c.u - a.u), v: a.v + u2 * (b.v - a.v) + u3 * (c.v - a.v) };
  };
}

// ───────────────────────────── 매칭(§2.5 정규형 · 분리성) ─────────────────────────────

/** 예측 사이트 격자(셀 = 2g) */
function siteGrid(sites, g) {
  const cell = Math.max(2 * g, 1e-6);
  const map = new Map();
  for (let i = 0; i < sites.length; i += 1) {
    const s = sites[i];
    const k = `${Math.floor(s.u / cell)},${Math.floor(s.v / cell)}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  }
  return { cell, map };
}
function nearestTwo(grid, sites, u, v) {
  const gu = Math.floor(u / grid.cell), gv = Math.floor(v / grid.cell);
  let i1 = -1, d1 = Infinity, i2 = -1, d2 = Infinity;
  for (let du = -1; du <= 1; du += 1) for (let dv = -1; dv <= 1; dv += 1) {
    const bucket = grid.map.get(`${gu + du},${gv + dv}`);
    if (!bucket) continue;
    for (const i of bucket) {
      const d = Math.hypot(sites[i].u - u, sites[i].v - v);
      if (d < d1 || (d === d1 && i < i1)) { i2 = i1; d2 = d1; i1 = i; d1 = d; } else if (d < d2 || (d === d2 && i < i2)) { i2 = i; d2 = d; }
    }
  }
  return { i1, d1, i2, d2 };
}
/**
 * 정규형 일대일 매칭 — blob 마다 최근접 ≤ g ∧ 2번째 > 2g 인 것만 후보(그 외 최근접 ≤ g 는 `ambiguous-assignment`),
 * 사이트별로 `(round(1e6·d) 오름, blobId 오름)` 최소를 채택(차수 ≤ 1 구조라 최대 cardinality · 최소 양자화 비용 · 사전순 최소).
 * @param {{id:number,u:number,v:number}[]} blobs blobId 오름
 * @param {{u:number,v:number}[]} sites 후보 사이트(inFrame · 비겹침)
 */
function matchCanonical(blobs, sites, g) {
  const grid = siteGrid(sites, g);
  const bySite = new Map();
  let ambiguous = 0;
  const ambiguousSites = [];
  for (let b = 0; b < blobs.length; b += 1) {
    const { i1, d1, d2 } = nearestTwo(grid, sites, blobs[b].u, blobs[b].v);
    if (i1 < 0 || !(d1 <= g)) continue;
    if (!(d2 > 2 * g)) { ambiguous += 1; ambiguousSites.push(i1); continue; }
    const cand = { b, s: i1, d: d1, q: q6(d1), id: blobs[b].id };
    const cur = bySite.get(i1);
    if (!cur || cand.q < cur.q || (cand.q === cur.q && cand.id < cur.id)) bySite.set(i1, cand);
  }
  const pairs = [...bySite.values()].sort((x, y) => x.id - y.id);
  return { pairs, ambiguous, ambiguousSites };
}

// ───────────────────────────── 투영 · 겹침(§3.5) ─────────────────────────────

/** 면-국소 raw 주소 `a` 의 물리 좌표(코너 원점): near `a`, far `(i, j, −k)` (§2.6 · §3.1) */
const physOf = (a, layerSign) => [a[0], a[1], layerSign * a[2]];
/**
 * 사이트 집합 투영 + inFrame + 겹침(`sep_design`) 마스크. `raws` = 면-국소 raw 주소 목록.
 * @returns {{sites:object[], inFrame:number, overlap:number, usable:object[], projections:number}}
 */
function projectRaws(Rf, tf, raws, layerSign, camera, frame, sepDesign) {
  const sites = raws.map(a => {
    const P = physOf(a, layerSign);
    const p = xProjectPoint(Rf, tf, P, camera);
    const inFrame = p.inFront && p.u >= 0 && p.u < frame.width && p.v >= 0 && p.v < frame.height;
    return { a, P, u: p.u, v: p.v, inFrame, overlap: false };
  });
  const inF = sites.filter(s => s.inFrame);
  // 겹침: 화면 거리 < sep_design 인 쌍은 둘 다 overlap-predicted
  const grid = siteGrid(inF, sepDesign / 2);
  for (let i = 0; i < inF.length; i += 1) {
    const s = inF[i];
    const gu = Math.floor(s.u / grid.cell), gv = Math.floor(s.v / grid.cell);
    for (let du = -1; du <= 1; du += 1) for (let dv = -1; dv <= 1; dv += 1) {
      const bucket = grid.map.get(`${gu + du},${gv + dv}`);
      if (!bucket) continue;
      for (const j of bucket) if (j !== i && Math.hypot(inF[j].u - s.u, inF[j].v - s.v) < sepDesign) { s.overlap = true; inF[j].overlap = true; }
    }
  }
  const usable = inF.filter(s => !s.overlap);
  return { sites, inFrame: inF.length, overlap: inF.filter(s => s.overlap).length, usable, projections: raws.length };
}
function faceRaws(N) { const out = []; for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) out.push([i, j, 0]); return out; }
function cubeRaws(N) { const out = []; for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) for (let k = 0; k < N; k += 1) out.push([i, j, k]); return out; }

/**
 * null 재표집 준비(§2.5 H-11 · R6-12): 예측 사이트 껍질(정렬 키 `(u, v, siteTag)`) 안에 실제로 놓인 blob 만 껍질 안 균등 재표집.
 * @returns {{sampler:function|null, insideIdx:number[], nIn:number, hull:object[]}}
 */
function nullSetup(usableSites, blobs) {
  const hull = convexHull(usableSites.map((s, i) => ({ u: s.u, v: s.v, tag: i })));
  const sampler = makeHullSampler(hull);
  const insideIdx = [];
  if (sampler) for (let b = 0; b < blobs.length; b += 1) if (insideConvex(hull, blobs[b].u, blobs[b].v)) insideIdx.push(b);
  return { sampler, insideIdx, nIn: insideIdx.length, hull };
}
/** 한 null 표본(RNG 순서: blob 마다 (u1,u2,u3), blobId 오름 — `blobs` 가 이미 id 오름) */
function nullSample(blobs, setup, rng) {
  const out = blobs.map(b => ({ id: b.id, u: b.u, v: b.v }));
  for (const b of setup.insideIdx) { const p = setup.sampler(rng); out[b].u = p.u; out[b].v = p.v; }
  return out;
}

// ───────────────────────────── 직렬화(§5.3) ─────────────────────────────

const CANON_EXCLUDE_DIAG = ['stage1MeasuredMs', 'measuredMs', 'totalMs'];
const B1_FIELDS = ['axisFrameCandidates', 'axisFrameAgreementDeg', 'lineAxisAgree', 'axisFrame'];
function canonValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') { if (!Number.isFinite(v)) return null; return Number.isInteger(v) ? v : xRoundSerial(v); }
  if (Array.isArray(v)) return v.map(canonValue);
  if (typeof v === 'object') { const out = {}; for (const k of Object.keys(v).sort()) out[k] = canonValue(v[k]); return out; }
  return v;
}
/** 정본 직렬화(제외 필드 완전 열거 · 키 코드포인트 재귀 정렬 · 공백 0) · `b1Neutral` 이면 B1 3 필드 + `diagnostics.axisFrame` 도 뺌 */
export function xCanonicalSerialize(output, { b1Neutral = false } = {}) {
  if (!output || typeof output !== 'object') throw new TypeError('xCanonicalSerialize: output 객체가 필요해요');
  const copy = { ...output };
  for (const k of ['frameId', 'inputSha256', 'observationsSha256', 'stage1Sha']) delete copy[k];
  if (copy.diagnostics && typeof copy.diagnostics === 'object') {
    const d = { ...copy.diagnostics };
    for (const k of CANON_EXCLUDE_DIAG) delete d[k];
    if (b1Neutral) for (const k of B1_FIELDS) delete d[k];
    copy.diagnostics = d;
  }
  return JSON.stringify(canonValue(copy));
}

// ───────────────────────────── 어휘 순서(§3.3 · 계약 §5.4) ─────────────────────────────

const REASON_ORDER = [
  'invalid-input', 'skipped-stage1', 'too-few-blobs', 'hull-insufficient', 'face-lines-parallel', 'face-intersection-out', 'p3p-duplicate-image',
  'p3p:collinear-points', 'p3p:coincident-bearings', 'p3p:non-finite-input', 'p3p:root-solver-not-converged', 'p3p:no-real-root', 'p3p:ill-conditioned',
  'p3p:all-behind-camera', 'p3p:no-valid-solution', 'p3p:invalid-options',
  'lm-underdetermined', 'lm-nonconverged', 'lm-ill-conditioned', 'lm-nonpositive-depth', 'rotation-not-so3', 'planar-unsupported',
  'unsupported-address', 'support-below-threshold', 'ambiguous-address', 'ambiguous-finder', 'ambiguous-profile', 'ambiguous-N', 'ambiguous-geometry',
  'improper-only', 'degenerate-view', 'unresolved', 'extent-exceeds-N', 'cross-N-implausible', 'geometry-rejected', 'offset-cap',
  'cap-hit:line-cap', 'cap-hit:triple-cap', 'cap-hit:root-cap', 'cap-hit:lm-run-cap', 'cap-hit:map-cap', 'cap-hit:eval-cap', 'cap-hit:chance-conflict-cap',
];
const CAP_ORDER = ['line-cap', 'triple-cap', 'root-cap', 'lm-run-cap', 'map-cap', 'eval-cap', 'chance-conflict-cap'];
const reasonRank = tok => { const base = tok.split(':').slice(0, tok.startsWith('p3p:') || tok.startsWith('cap-hit:') ? 2 : 1).join(':'); const i = REASON_ORDER.indexOf(base); return i < 0 ? REASON_ORDER.length : i; };
const orderReasons = toks => [...new Set(toks)].sort((a, b) => (reasonRank(a) - reasonRank(b)) || (a < b ? -1 : a > b ? 1 : 0));
const orderCaps = caps => CAP_ORDER.filter(c => caps.includes(c));
const P3P_REASONS = ['ok', 'collinear-points', 'coincident-bearings', 'non-finite-input', 'root-solver-not-converged', 'no-real-root', 'ill-conditioned', 'all-behind-camera', 'no-valid-solution', 'invalid-options', 'need-3-points-and-3-bearings'];

// ───────────────────────────── 입력 검증(§1.2) ─────────────────────────────

const BLOB_NUM_FIELDS = ['u', 'v', 'scalePx', 'contrast'];
/** 어댑터 blob 스키마의 키 전부 — 이 밖의 키(정답 계열 포함)가 있으면 `invalid-input`(§6.2b-18 «truth 키 포함 객체») */
const BLOB_KEYS = new Set(['blobId', 'u', 'v', 'bbox', 'areaPx', 'scalePx', 'peakLuma', 'meanLuma', 'backgroundLuma', 'contrast', 'state', 'visibilityReason', 'levelLikelihood', 'quality']);
function mergePolicy(policy) {
  if (!isPlainObject(policy)) throw new TypeError('xStage2: policy 는 plain object 여야 해요(프로그래머 오류)');
  const out = { ...STAGE2_POLICY, nD: { ...STAGE2_POLICY.nD } };
  for (const k of Object.keys(policy)) {
    if (!Object.hasOwn(STAGE2_POLICY, k)) return { error: `policy 에 알 수 없는 키: ${k}` };
    if (k === 'nD') {
      if (!isPlainObject(policy.nD)) return { error: 'policy.nD 는 객체여야 해요' };
      for (const kk of Object.keys(policy.nD)) { if (!Object.hasOwn(STAGE2_POLICY.nD, kk)) return { error: `policy.nD 에 알 수 없는 키: ${kk}` }; out.nD[kk] = policy.nD[kk]; }
    } else out[k] = policy[k];
  }
  for (const k of Object.keys(out)) {
    if (k === 'nD') { if (!(Number.isInteger(out.nD.F) && out.nD.F >= 1 && Number.isInteger(out.nD.V) && out.nD.V >= 0)) return { error: 'policy.nD.F/V 범위' }; continue; }
    if (k === 'axisFrame') { if (typeof out[k] !== 'boolean') return { error: 'policy.axisFrame 은 boolean' }; continue; }
    if (!isFin(out[k])) return { error: `policy.${k} 는 유한수여야 해요` };
  }
  if (out.seed !== STAGE2_POLICY.seed) return { error: 'policy.seed 는 ② 정책 갈래 값만 허용해요' };
  return { policy: out };
}
function validateInputs(blobs, frame, camera) {
  if (!Array.isArray(blobs)) return 'blobs 는 배열이어야 해요';
  for (let i = 0; i < blobs.length; i += 1) if (!(i in blobs)) return 'blobs 는 dense 배열이어야 해요';
  if (!isPlainObject(frame)) return 'frame 은 plain object 여야 해요';
  const fk = Object.keys(frame).sort();
  if (fk.length !== 2 || fk[0] !== 'height' || fk[1] !== 'width') return 'frame 의 own enumerable 키 집합은 정확히 {width, height} 여야 해요';
  if (!(Number.isInteger(frame.width) && frame.width > 0 && Number.isInteger(frame.height) && frame.height > 0)) return 'frame.width/height 는 양의 정수';
  if (!isPlainObject(camera) || camera.model !== X_CAMERA_MODEL) return 'camera.model';
  for (const k of ['width', 'height', 'fx', 'fy', 'cx', 'cy']) if (!isFin(camera[k])) return `camera.${k}`;
  if (!(camera.fx > 0 && camera.fy > 0)) return 'camera.fx/fy > 0';
  if (!(camera.cx >= 0 && camera.cx <= frame.width && camera.cy >= 0 && camera.cy <= frame.height)) return 'camera.cx/cy 범위';
  const ids = new Set();
  for (let i = 0; i < blobs.length; i += 1) {
    const b = blobs[i];
    if (!isPlainObject(b)) return `blobs[${i}] 는 plain object`;
    for (const k of Object.keys(b)) {
      if (!BLOB_KEYS.has(k)) return `blobs[${i}] 에 허용되지 않는 키: ${k}`;
      const dk = Object.getOwnPropertyDescriptor(b, k);
      if (!dk || !('value' in dk)) return `blobs[${i}].${k} 는 데이터 속성이어야 해요(getter 금지)`;
    }
    const d = Object.getOwnPropertyDescriptor(b, 'blobId');
    if (!d || !('value' in d)) return `blobs[${i}].blobId`;
    if (!Number.isInteger(b.blobId) || b.blobId < 0 || ids.has(b.blobId)) return `blobs[${i}].blobId 정수·유한·유일`;
    ids.add(b.blobId);
    for (const k of BLOB_NUM_FIELDS) {
      const dk = Object.getOwnPropertyDescriptor(b, k);
      if (!dk || !('value' in dk) || !isFin(b[k])) return `blobs[${i}].${k} 유한수`;
    }
    if (!Array.isArray(b.bbox) || b.bbox.length !== 4 || !b.bbox.every(isFin)) return `blobs[${i}].bbox`;
    if (!isPlainObject(b.quality)) return `blobs[${i}].quality`;
    for (const k of ['saturated', 'edgeTruncated', 'mergeSuspected']) if (typeof b.quality[k] !== 'boolean') return `blobs[${i}].quality.${k}`;
  }
  return null;
}

// ───────────────────────────── 출력 골격 ─────────────────────────────

function allLabels() { return xUnexploredDerive({ evaluatedLabels: [], rejectedLabels: [] }); }
function baseCoverage() {
  return {
    cycleDefinition: 'frame', finalists: { N8: 0, N10: 0 }, stage0: { fired: false, judgedBy: {} }, mapBuildOrder: [['X0', 'X0g'], ['X1']],
    findersTested: X_FINDER_IDS.length, addressTestsTotal: X_ADDRESS_TESTS_TOTAL, addressTestsDone: 0,
    addressTestsRejectedCrossN: 0, addressTestsRejectedExtent: 0, addressTestsRejectedGeometry: 0, uniquenessScope: 'registry-complete',
    addressMapsBuilt: 0, addressEvaluations: 0, addressSupport: {}, survivorTransforms: {}, truncatedCandidates: 0, capHits: [], offsetCap: [], unexplored: allLabels(),
  };
}
function baseDiagnostics(axisFrameOn) {
  const d = {
    nD: { F: 0, V: 0 }, nGeom: 0, clusters: { count: 0, largest: 0, multiObject: false, vExcluded: 0 }, hullVertices: 0, hullOutliersExcluded: 0, lines: 0,
    faceHypotheses: 0, faceRejected: { 'face-lines-parallel': 0, 'face-intersection-out': 0 }, triplesEnumerated: 0,
    p3pCandidates: 0, p3pDedupMerged: 0, p3pRoots: 0, p3pDroppedOverflow: 0, p3pDroppedBehind: 0, p3pDroppedResidual: 0, p3pReasons: {},
    prunedPlanar: 0, layerBothKept: 0, prunedLayer: [], lmCandidates: 0, lmRuns: 0, lmIterations: 0, projections: 0,
    chanceConflictEligible: 0, chanceConflictCandidates: 0, conflictUncorrectedDropped: 0,
    matchRuns: { primaryB4: 0, primaryB5: 0, primaryB7: 0, gate1PassedRoots: 0, chanceResampleB4: 0, chanceResampleB5: 0, chanceResampleB7: 0, chanceResampleB8: 0 },
    axisFrameCandidates: null, axisFrameAgreementDeg: null, lineAxisAgree: null,
    excluded: { beforeGeom: { mergeSuspected: 0, edgeTruncated: 0 }, fAfterExclusion: 0 },
    approximations: ['blob-sigma-approximated-from-scalePx'], stage1MeasuredMs: null, measuredMs: null, totalMs: null,
  };
  if (axisFrameOn) d.axisFrame = 'none';
  return d;
}
function finish(ctx, status, frameReasons) {
  const { output } = ctx;
  output.status = status;
  output.rejectReasons = orderReasons(frameReasons);
  output.coverage.capHits = orderCaps(ctx.caps);
  if (output.status !== 'selected') output.selectedHypothesisId = null;
  return { output, trace: ctx.trace };
}
const emptyTrace = () => ({ faceHypotheses: [], p3pRoots: [], b4Top4: { N8: [], N10: [] }, finalists: [] });

// ───────────────────────────── 본체 ─────────────────────────────

export function xStage2(blobs, frame, camera, policy) { return run(blobs, frame, camera, policy).output; }
export function xStage2Trace(blobs, frame, camera, policy) { return run(blobs, frame, camera, policy); }

function run(blobsIn, frame, camera, policyIn) {
  const merged = mergePolicy(policyIn);
  const P = merged.policy ?? STAGE2_POLICY;
  const axisOn = P.axisFrame === true;
  const output = { schemaVersion: X_STAGE2_SCHEMA, status: 'invalid-input', hypotheses: [], selectedHypothesisId: null, rejectReasons: [], coverage: baseCoverage(), diagnostics: baseDiagnostics(axisOn) };
  const ctx = { output, trace: emptyTrace(), caps: [], P, camera, frame };
  const D = output.diagnostics;
  if (merged.error) return finish(ctx, 'invalid-input', ['invalid-input']);
  const err = validateInputs(blobsIn, frame, camera);
  if (err) return finish(ctx, 'invalid-input', ['invalid-input']);

  // ── B0 검증 · 분할 · 부분집합(§2.1)
  const all = blobsIn.map(b => ({ id: b.blobId, u: b.u, v: b.v, scalePx: b.scalePx, contrast: b.contrast, sigma: Math.max(0.5, 0.25 * b.scalePx), q: b.quality, qCount: (b.quality.saturated ? 1 : 0) + (b.quality.edgeTruncated ? 1 : 0) + (b.quality.mergeSuspected ? 1 : 0), excl: b.quality.mergeSuspected || b.quality.edgeTruncated }))
    .sort((a, b) => a.id - b.id);
  const F = all.filter(b => b.id % 8 >= 4), V = all.filter(b => b.id % 8 === 2 || b.id % 8 === 3);
  D.excluded.beforeGeom.mergeSuspected = F.filter(b => b.q.mergeSuspected).length;
  D.excluded.beforeGeom.edgeTruncated = F.filter(b => b.q.edgeTruncated && !b.q.mergeSuspected).length;
  const Fc = F.filter(b => !b.excl);
  D.excluded.fAfterExclusion = Fc.length;
  if (Fc.length < 12) return finish(ctx, 'too-few-blobs', ['too-few-blobs']);
  const bbox = { u0: Math.min(...Fc.map(b => b.u)), u1: Math.max(...Fc.map(b => b.u)), v0: Math.min(...Fc.map(b => b.v)), v1: Math.max(...Fc.map(b => b.v)) };
  const cellOf = b => {
    const cu = Math.min(3, Math.max(0, Math.floor(4 * (b.u - bbox.u0) / (bbox.u1 - bbox.u0 + 1e-9))));
    const cv = Math.min(3, Math.max(0, Math.floor(4 * (b.v - bbox.v0) / (bbox.v1 - bbox.v0 + 1e-9))));
    return cv * 4 + cu; // 행우선
  };
  /** 셀당 1 개씩 행우선 round-robin, 빈 셀 건너뜀 */
  const roundRobin = (cands, keyOf, target) => {
    const cells = Array.from({ length: 16 }, () => []);
    for (const b of cands) cells[cellOf(b)].push(b);
    for (const c of cells) c.sort((a, b) => compareTuples(keyOf(a), keyOf(b)));
    const out = [];
    let progress = true;
    while (out.length < target && progress) { progress = false; for (const c of cells) { if (out.length >= target) break; if (c.length) { out.push(c.shift()); progress = true; } } }
    return out.sort((a, b) => a.id - b.id);
  };
  let geom = roundRobin(Fc, b => [b.qCount, -q6(b.contrast), b.id], P.nGeom);

  // ── B0.5 군집(§2.1b)
  const kNN = (pts, k) => pts.map(p => { const ds = pts.filter(q => q !== p).map(q => Math.hypot(q.u - p.u, q.v - p.v)).sort((a, b) => a - b); return ds[Math.min(k, ds.length) - 1] ?? Infinity; });
  const dLink = P.dLinkFactor * lowerMedian(kNN(geom, P.dLinkK).filter(Number.isFinite));
  const comp = new Array(geom.length).fill(-1);
  const comps = [];
  for (let i = 0; i < geom.length; i += 1) {
    if (comp[i] >= 0) continue;
    const stack = [i], members = []; comp[i] = comps.length;
    while (stack.length) { const a = stack.pop(); members.push(a); for (let j = 0; j < geom.length; j += 1) if (comp[j] < 0 && Math.hypot(geom[j].u - geom[a].u, geom[j].v - geom[a].v) <= dLink) { comp[j] = comps.length; stack.push(j); } }
    comps.push(members.sort((a, b) => a - b));
  }
  const bigComps = comps.filter(c => c.length >= P.clusterMin);
  D.clusters.count = comps.length;
  D.clusters.multiObject = bigComps.length >= 2;
  const largest = comps.slice().sort((a, b) => (b.length - a.length) || (geom[a[0]].id - geom[b[0]].id))[0];
  D.clusters.largest = largest.length;
  const geomAll = geom;
  geom = largest.map(i => geomAll[i]).sort((a, b) => a.id - b.id);
  D.nGeom = geom.length;
  // V 귀속(큰 성분의 nGeom blob 과 최근접 ≤ d_link)
  const Vc = V.filter(b => !b.excl);
  const Vin = Vc.filter(b => geom.some(g => Math.hypot(g.u - b.u, g.v - b.v) <= dLink));
  D.clusters.vExcluded = Vc.length - Vin.length;
  const Vs = roundRobin(Vin, b => [b.id], P.nD.V);
  D.nD.V = Vs.length;

  // ── B1 축 프레임(§2.2, 진단 전용)
  let axisFrames = [];
  if (axisOn) { axisFrames = axisFrameCandidates(geom, camera, P); D.axisFrameCandidates = axisFrames.length; D.axisFrame = axisFrames.length ? 'found' : 'none'; }

  // ── B2 실루엣 직선(§2.3)
  const hullRes = silhouetteLines(geom, P);
  D.hullVertices = hullRes.hullVertices; D.hullOutliersExcluded = hullRes.outliers;
  if (hullRes.lineCap) ctx.caps.push('line-cap');
  D.lines = hullRes.lines.length;
  if (axisOn) D.lineAxisAgree = hullRes.lines.map(L => axisFrames.length ? lineAgrees(L, axisFrames[0], camera, P) : false);
  if (hullRes.insufficient) return finish(ctx, 'hull-insufficient', ['hull-insufficient']);
  const lines = hullRes.lines; // 정렬 순(보고·동률 키) · 각 line.hullOrder 보존

  // ── B3 면 가설 · P3P(§2.4)
  const frameReasons = [];
  const faces = faceHypotheses(lines, hullRes.L0, frame, P, D);
  D.faceHypotheses = faces.length;
  for (const f of faces) ctx.trace.faceHypotheses.push({ id: f.id, lineIds: f.lineIds, C: xRoundSerialArray(f.C) });
  const triples = xTripleIndexTable();
  const roots = []; // {f, t, r, N, kB, kD, Rf, tf, face}
  let tripleList = [];
  for (const f of faces) for (const tr of triples) tripleList.push({ f: f.id, t: tr.tripleIndex, face: f, tr });
  D.triplesEnumerated = tripleList.length;
  if (tripleList.length > P.tripleCap) { // 절단: (면 index 내림, 삼중 index 내림) 앞쪽부터
    ctx.caps.push('triple-cap');
    tripleList = sortBy(tripleList, x => [-x.f, -x.t]).slice(tripleList.length - P.tripleCap);
  }
  const bump = (obj, k) => { obj[k] = (obj[k] ?? 0) + 1; };
  let dupCount = 0;
  for (const x of tripleList) {
    const { face, tr } = x;
    const pix = [face.C, face.Bpx, face.Dpx];
    if (Math.hypot(pix[0][0] - pix[1][0], pix[0][1] - pix[1][1]) < P.dupPixelPx || Math.hypot(pix[0][0] - pix[2][0], pix[0][1] - pix[2][1]) < P.dupPixelPx || Math.hypot(pix[1][0] - pix[2][0], pix[1][1] - pix[2][1]) < P.dupPixelPx) { dupCount += 1; continue; }
    const pts = [[0, 0, 0], [tr.kB, 0, 0], [0, tr.kD, 0]];
    const sols = xP3P({ points: pts, bearings: xBearingsFromPixels(pix, camera) }, P3P_OPTS);
    const dg = sols.diagnostics;
    bump(D.p3pReasons, dg.reason);
    D.p3pCandidates += dg.candidates; D.p3pDedupMerged += dg.dedupMerged; D.p3pDroppedOverflow += dg.droppedOverflow; D.p3pDroppedBehind += dg.droppedBehind; D.p3pDroppedResidual += dg.droppedResidual;
    sols.forEach((s, r) => roots.push({ f: x.f, t: x.t, r, N: tr.N, kB: tr.kB, kD: tr.kD, Rf: s.R, tf: s.t, face }));
  }
  if (dupCount) D.p3pReasons['p3p-duplicate-image'] = dupCount;
  D.p3pRoots = roots.length;
  let rootList = roots;
  if (rootList.length > P.rootCap) { ctx.caps.push('root-cap'); rootList = sortBy(rootList, x => [-x.f, -x.t, -x.r]).slice(rootList.length - P.rootCap); }
  for (const rt of rootList) ctx.trace.p3pRoots.push([rt.f, rt.t, rt.r, xRoundSerialArray(rt.Rf), xRoundSerialArray(rt.tf)]);
  for (const k of Object.keys(D.p3pReasons)) if (k !== 'ok' && P3P_REASONS.includes(k) && D.p3pReasons[k] > 0) frameReasons.push(`p3p:${k}`);
  if (dupCount) frameReasons.push('p3p-duplicate-image');
  if (D.faceRejected['face-lines-parallel']) frameReasons.push('face-lines-parallel');
  if (D.faceRejected['face-intersection-out']) frameReasons.push('face-intersection-out');
  if (!rootList.length) return finish(ctx, 'rejected', frameReasons);

  // ── B4 면 평면 지지(§2.5)
  const geomPts = geom.map(b => ({ id: b.id, u: b.u, v: b.v }));
  const b4 = [];
  for (const rt of rootList) {
    const pitchPxHypB4 = xPitchPxHyp(rt.Rf, rt.tf, rt.N, 1, camera.fx, P.pitch);
    if (!(pitchPxHypB4 > 0)) { rt.reason = 'planar-unsupported'; continue; }
    const gRel = P.gammaPitch * pitchPxHypB4;
    const g = Math.min(gRel, P.gAbsPx), gateBinding = gRel < P.gAbsPx ? 'gamma_pitch' : 'g_abs';
    const proj = projectRaws(rt.Rf, rt.tf, faceRaws(rt.N), 1, camera, frame, P.sepDesignPx);
    D.projections += proj.projections;
    const m = matchCanonical(geomPts, proj.usable, g);
    D.matchRuns.primaryB4 += 1;
    if (m.pairs.length < P.mMin) { rt.reason = 'planar-unsupported'; continue; }
    D.matchRuns.gate1PassedRoots += 1;
    const setup = nullSetup(proj.usable, geomPts);
    if (!setup.sampler) { rt.reason = 'planar-unsupported'; continue; } // 면적 0 껍질(§2.5 (ㅁ))
    const rng = xMakeRng(xSeedForStream('B4', rt.f, rt.t, rt.r));
    const counts = [];
    for (let s = 0; s < P.nChance; s += 1) counts.push(matchCanonical(nullSample(geomPts, setup, rng), proj.usable, g).pairs.length);
    D.matchRuns.chanceResampleB4 += P.nChance;
    const E = mean(counts), Sd = sampleSd(counts), Se = Sd / Math.sqrt(P.nChance);
    if (!(m.pairs.length - E >= gate2Threshold(Sd, P))) { rt.reason = 'planar-unsupported'; continue; }
    const rms = Math.sqrt(mean(m.pairs.map(p => p.d * p.d)));
    Object.assign(rt, { g, gateBinding, pitchPxHypB4, m: m.pairs.length, faceMatch: m.pairs.map(p => ({ id: geomPts[p.b].id, a: proj.usable[p.s].a, P: proj.usable[p.s].P, px: [geomPts[p.b].u, geomPts[p.b].v], sigma: geom[p.b].sigma })), rms, E, Sd, Se, nIn: setup.nIn });
    b4.push(rt);
  }
  const b4Kept = [];
  for (const N of [8, 10]) {
    const ofN = sortBy(b4.filter(x => x.N === N), b4Key);
    D.prunedPlanar += Math.max(0, ofN.length - P.K1);
    const keep = ofN.slice(0, P.K1);
    ctx.trace.b4Top4[`N${N}`] = keep.map(x => [x.f, x.t, x.r]);
    b4Kept.push(...keep);
  }
  if (!b4Kept.length) { frameReasons.push('planar-unsupported'); return finish(ctx, 'rejected', frameReasons); }

  // ── B5 층 확장(§2.6)
  const b5 = [];
  for (const rt of b4Kept) {
    const raws = cubeRaws(rt.N);
    const br = {};
    for (const ls of [1, -1]) {
      // 분기별 pitchPx_hyp 재계산(§2.5 · §2.6) — 중심 깊이 ≤ 0 이면 g_abs 로
      const pp = xPitchPxHyp(rt.Rf, rt.tf, rt.N, ls, camera.fx, P.pitch);
      const gRel = pp > 0 ? P.gammaPitch * pp : Infinity;
      const g = Math.min(gRel, P.gAbsPx), gateBinding = gRel < P.gAbsPx ? 'gamma_pitch' : 'g_abs';
      const proj = projectRaws(rt.Rf, rt.tf, raws, ls, camera, frame, P.sepDesignPx);
      D.projections += proj.projections;
      const m = matchCanonical(geomPts, proj.usable, g);
      D.matchRuns.primaryB5 += 1;
      br[ls] = { proj, m, support: m.pairs.length, g, gateBinding };
    }
    const unionSites = br[1].proj.usable.concat(br[-1].proj.usable);
    const setup = nullSetup(unionSites, geomPts);
    const rng = xMakeRng(xSeedForStream('B5', rt.f, rt.t, rt.r));
    const cn = [], cf = [];
    if (setup.sampler) {
      for (let s = 0; s < P.nChance; s += 1) {
        const smp = nullSample(geomPts, setup, rng);
        cn.push(matchCanonical(smp, br[1].proj.usable, br[1].g).pairs.length);
        cf.push(matchCanonical(smp, br[-1].proj.usable, br[-1].g).pairs.length);
      }
      D.matchRuns.chanceResampleB5 += 2 * P.nChance; // 같은 표본을 near·far 두 분기에 매칭(§1.4: 16 × 64)
    } else { for (let s = 0; s < P.nChance; s += 1) { cn.push(0); cf.push(0); } }
    const chanceN = mean(cn), chanceF = mean(cf);
    const Dval = (br[1].support - chanceN) - (br[-1].support - chanceF);
    const sdD = sampleSd(cn.map((x, i) => x - cf[i]));
    const dLayer = gate2Threshold(sdD, P);
    const keepSigns = Dval >= dLayer ? [1] : Dval <= -dLayer ? [-1] : [1, -1];
    if (keepSigns.length === 2) D.layerBothKept += 1;
    for (const ls of keepSigns) {
      const chance = ls === 1 ? chanceN : chanceF;
      b5.push({ ...rt, g: br[ls].g, gateBinding: br[ls].gateBinding, layerSign: ls, layerSupport: br[ls].support, layerChance: chance, qLayer: q6(br[ls].support - chance), b5Match: br[ls].m, b5Proj: br[ls].proj });
    }
  }
  const lmCands = [];
  for (const N of [8, 10]) {
    const ofN = sortBy(b5.filter(x => x.N === N), layerKey);
    for (const x of ofN.slice(P.K1)) D.prunedLayer.push([x.f, x.t, x.r, x.layerSign]);
    lmCands.push(...ofN.slice(0, P.K1));
  }
  D.lmCandidates = lmCands.length;

  // ── B6 LM 2 라운드(§2.7)
  const lmOk = [];
  for (const c of lmCands) {
    if (D.lmRuns >= P.lmRunCap) { ctx.caps.push('lm-run-cap'); break; }
    const raws = cubeRaws(c.N);
    const round1 = { points: c.faceMatch.map(x => x.P), pixels: c.faceMatch.map(x => x.px), sigmas: c.faceMatch.map(x => x.sigma), ids: c.faceMatch.map(x => x.id) };
    let round2Corr = null;
    const round2 = ({ R, t, trimmedIds }) => {
      const excl = new Set(trimmedIds);
      const proj = projectRaws(R, t, raws, c.layerSign, camera, frame, P.sepDesignPx);
      D.projections += proj.projections;
      const pts = geomPts.filter(b => !excl.has(b.id));
      const m = matchCanonical(pts, proj.usable, c.g);
      round2Corr = m.pairs.map(p => ({ id: pts[p.b].id, a: proj.usable[p.s].a, P: proj.usable[p.s].P, px: [pts[p.b].u, pts[p.b].v], sigma: geom.find(b => b.id === pts[p.b].id).sigma }));
      return { points: round2Corr.map(x => x.P), pixels: round2Corr.map(x => x.px), sigmas: round2Corr.map(x => x.sigma), ids: round2Corr.map(x => x.id) };
    };
    const res = xPoseRefine2Rounds({ round1, round2, camera, R0: c.Rf, t0: c.tf, gate: c.g }, { huberDelta: P.huberDelta, trim: P.trim, so3Tol: P.so3Tol, condMax: P.condMax, depthMin: P.depthMin });
    D.lmRuns += res.runs;
    D.lmIterations += (res.round1?.iterations ?? 0) + (res.round2?.iterations ?? 0);
    if (!res.ok) { frameReasons.push(res.reason); continue; }
    lmOk.push({ ...c, Rf: res.R, tf: res.t, lmRms: res.residualSummary.rmsPx, geom: round2Corr, trimmedIds: res.trimmedIds });
  }
  if (!lmOk.length) return finish(ctx, 'rejected', frameReasons);

  // ── B7 기하 순위 · finalist(§2.8)
  const Vpts = Vs.map(b => ({ id: b.id, u: b.u, v: b.v }));
  for (const c of lmOk) {
    // LM 후 pose 로 pitchPx_hyp · gate 재계산(그 가설의 gateBinding — §2.10 q_fit 의 g)
    c.pitchPxHyp = xPitchPxHyp(c.Rf, c.tf, c.N, c.layerSign, camera.fx, P.pitch);
    const gRel = c.pitchPxHyp > 0 ? P.gammaPitch * c.pitchPxHyp : Infinity;
    c.g = Math.min(gRel, P.gAbsPx); c.gateBinding = gRel < P.gAbsPx ? 'gamma_pitch' : 'g_abs';
    const proj = projectRaws(c.Rf, c.tf, cubeRaws(c.N), c.layerSign, camera, frame, P.sepDesignPx);
    D.projections += proj.projections;
    c.fullProj = proj;
    const m = matchCanonical(Vpts, proj.usable, c.g);
    D.matchRuns.primaryB7 += 1;
    c.vMatch = m.pairs.map(p => ({ id: Vpts[p.b].id, a: proj.usable[p.s].a }));
    c.inlier = m.pairs.length;
    const setup = nullSetup(proj.usable, Vpts);
    const rng = xMakeRng(xSeedForStream('B7', c.f, c.t, c.r, layerSignStr(c.layerSign)));
    const counts = [];
    if (setup.sampler) { for (let s = 0; s < P.nChance; s += 1) counts.push(matchCanonical(nullSample(Vpts, setup, rng), proj.usable, c.g).pairs.length); D.matchRuns.chanceResampleB7 += P.nChance; }
    else for (let s = 0; s < P.nChance; s += 1) counts.push(0);
    c.EV = mean(counts);
    c.qGeom = qGeom(c.inlier, c.EV);
  }
  const ranked = sortBy(lmOk, rankKey);
  ranked.forEach((x, i) => { x.lmRank = i; });
  const finalists = [];
  for (const N of [8, 10]) finalists.push(...ranked.filter(x => x.N === N).slice(0, P.finalistsPerN));
  const fin = sortBy(finalists, rankKey);
  fin.forEach((x, i) => { x.poseRank = i; });
  output.coverage.finalists = { N8: fin.filter(x => x.N === 8).length, N10: fin.filter(x => x.N === 10).length };
  ctx.trace.finalists = fin.map(x => [x.poseRank, x.f, x.t, x.r, x.layerSign, x.lmRank]);
  const ambiguousN = fin.length >= 2 && fin[0].N !== fin[1].N && Math.abs(fin[0].qGeom - fin[1].qGeom) < q6(P.deltaN);
  if (axisOn && axisFrames.length) {
    const R0 = fin[0].layerSign === -1 ? mat3Mul(fin[0].Rf, X_ADDRESS_S) : fin[0].Rf;
    let best = Infinity;
    for (const tr of X_TRANSFORMS) if (tr.parity > 0) best = Math.min(best, xRotationAngleDeg(axisFrames[0], mat3Mul(R0, tr.M)));
    D.axisFrameAgreementDeg = xRoundSerial(best);
  }
  // B8 null 표본(finalist 별 1 벌, §2.9 O-12)
  for (const c of fin) {
    const setup = nullSetup(c.fullProj.usable, geomPts);
    const rng = xMakeRng(xSeedForStream('B8', c.f, c.t, c.r, layerSignStr(c.layerSign)));
    c.nullMatches = [];
    if (setup.sampler) { for (let s = 0; s < P.nChance; s += 1) c.nullMatches.push(matchCanonical(nullSample(geomPts, setup, rng), c.fullProj.usable, c.g).pairs.map(p => c.fullProj.usable[p.s].a)); D.matchRuns.chanceResampleB8 += P.nChance; }
    else for (let s = 0; s < P.nChance; s += 1) c.nullMatches.push([]);
    c.extent = xExtent(c.geom.map(x => x.a)); // 정수 extent E_k — rt.E(E_chance 실수, B4 §2.5)와 이름을 갈라요(통합자 수정: 덮어쓰기 결함)
    c.overlapRatio = c.fullProj.inFrame ? c.fullProj.overlap / c.fullProj.inFrame : 0;
  }

  // ── B8 주소 판정(§2.9)
  const cov = output.coverage;
  const pairIdx = id => X_PROFILE_IDS.indexOf(id);
  const rejected = { crossN: [], extent: [], geometry: [] };
  const topOfN = N => fin.find(x => x.N === N) ?? null;
  const fired = fin.length === 1 || (fin.length >= 2 && fin[0].N === fin[1].N && !ambiguousN);
  cov.stage0 = { fired, judgedBy: {} };
  const pairVerdict = {}; // pairId → 'evaluate' | reason
  for (const N of [8, 10]) {
    const top = topOfN(N);
    if (!top) { for (const pr of xPairsOfN(N)) { pairVerdict[pr] = 'geometry-rejected'; for (let fi = 0; fi < X_FINDER_IDS.length; fi += 1) for (let m = 0; m < 48; m += 1) rejected.geometry.push([pairIdx(pr), fi, m]); } continue; }
    if (fired) {
      cov.stage0.judgedBy[`N${N}`] = top.poseRank;
      for (const { pair, verdict } of xStage0Filter({ finalistsByN: { [N]: top.extent }, N })) {
        pairVerdict[pair] = verdict;
        if (verdict === 'evaluate') continue;
        const list = verdict === 'extent-exceeds-N' ? rejected.extent : rejected.crossN;
        for (let fi = 0; fi < X_FINDER_IDS.length; fi += 1) for (let m = 0; m < 48; m += 1) list.push([pairIdx(pair), fi, m]);
      }
    } else for (const pr of xPairsOfN(N)) pairVerdict[pr] = 'evaluate';
  }
  cov.addressTestsRejectedCrossN = rejected.crossN.length; cov.addressTestsRejectedExtent = rejected.extent.length; cov.addressTestsRejectedGeometry = rejected.geometry.length;
  // 지도 계산 단위 열거: pose 순위 → 쌍(mapBuildOrder = X_PROFILE_IDS 순) → offset 사전순 → M → finder
  const units = []; // {pose, pairId, pairIndex, o, M, T, det, siteIds(per geom idx), sup[7], con[7]}
  const evaluatedLabels = new Set();
  const maps = {}; // pair → finder → F_eff
  for (const pr of X_PROFILE_IDS) { maps[pr] = X_FINDER_IDS.map(fi => xEffectiveMap(pr, fi)); }
  outer: for (const pose of fin) {
    for (const pr of X_PROFILE_IDS) {
      if (xProfile(pr).N !== pose.N || pairVerdict[pr] !== 'evaluate') continue;
      for (const tr of X_TRANSFORMS) {
        const { T, det } = xAddressMap(tr.transformId, pose.layerSign);
        const rng0 = xOffsetRange(T, pose.extent, pose.N);
        if (rng0.omega > P.omegaMax) { if (!cov.offsetCap.some(([p, q]) => p === pose.poseRank && q === pr)) cov.offsetCap.push([pose.poseRank, pr]); continue; }
        for (const o of rng0.offsets) {
          if (cov.addressMapsBuilt >= P.mapCap) { ctx.caps.push('map-cap'); break outer; }
          if (cov.addressEvaluations + X_FINDER_IDS.length > P.evalCap) { ctx.caps.push('eval-cap'); break outer; }
          const siteIds = pose.geom.map(x => { const s = xSiteFromFaceLocal(x.a, T, pose.N, o); return s ? xSiteId(pose.N, s) : null; });
          const sup = [], con = [];
          for (let fi = 0; fi < X_FINDER_IDS.length; fi += 1) { const c = xCountSupport({ map: maps[pr][fi], siteIds }); sup.push(c.support); con.push(c.conflict); evaluatedLabels.add(xLabelKey(pr, X_FINDER_IDS[fi]) + '|' + tr.transformId); }
          cov.addressMapsBuilt += 1; cov.addressEvaluations += X_FINDER_IDS.length;
          units.push({ pose, pairId: pr, pairIndex: pairIdx(pr), o, M: tr, T, det, siteIds, sup, con, chance: null, capped: false });
        }
      }
    }
  }
  // 표지 회계
  const evalLabels = [];
  for (const k of evaluatedLabels) { const [p, f, m] = k.split('|'); evalLabels.push([pairIdx(p), X_FINDER_IDS.indexOf(f), Number(m)]); }
  const rejectedAll = rejected.crossN.concat(rejected.extent, rejected.geometry);
  cov.unexplored = xUnexploredDerive({ evaluatedLabels: evalLabels, rejectedLabels: rejectedAll });
  cov.addressTestsDone = evalLabels.length + rejectedAll.length;
  cov.uniquenessScope = xUniquenessScope({ rejectedCrossN: cov.addressTestsRejectedCrossN, rejectedExtent: cov.addressTestsRejectedExtent, rejectedGeometry: cov.addressTestsRejectedGeometry });
  const identity = xCoverageIdentity({ evaluatedLabels: evalLabels, rejectedCrossNLabels: rejected.crossN, rejectedExtentLabels: rejected.extent, rejectedGeometryLabels: rejected.geometry, unexplored: cov.unexplored });
  if (!identity.ok) throw new Error('회계 항등식 위반(내부 결함)');
  // E_conflict_chance — 대표 support ≥ s_min 단위를 §2.9 단위 정렬 키로 늘어놓고 앞 C_conf 만 계산
  const eligible = units.filter(u => Math.max(...u.sup) >= P.sMin);
  const unitKey = u => [-Math.max(...u.sup), -Math.max(...u.sup.map((s, i) => s - u.con[i])), u.pose.poseRank, u.pairIndex, u.M.transformId, u.o];
  const eligSorted = sortBy(eligible, unitKey);
  D.chanceConflictEligible = eligible.length;
  D.chanceConflictCandidates = Math.min(P.cConf, eligible.length);
  if (eligible.length > P.cConf) ctx.caps.push('chance-conflict-cap');
  const kappa = s => Math.max(1, Math.floor(P.rho * s));
  eligSorted.forEach((u, i) => {
    if (i < P.cConf) {
      const sums = new Array(X_FINDER_IDS.length).fill(0);
      for (const smp of u.pose.nullMatches) {
        const ids = smp.map(a => { const s = xSiteFromFaceLocal(a, u.T, u.pose.N, u.o); return s ? xSiteId(u.pose.N, s) : null; });
        for (let fi = 0; fi < X_FINDER_IDS.length; fi += 1) sums[fi] += xCountSupport({ map: maps[u.pairId][fi], siteIds: ids }).conflict;
      }
      u.chance = sums.map(s => s / P.nChance);
    } else {
      u.capped = true;
      if (u.sup.some((s, fi) => s >= P.sMin && u.con[fi] > kappa(s))) D.conflictUncorrectedDropped += 1;
    }
  });
  // 라벨 대표(§2.10 축약 키) · addressSupport · Z
  const labels = {}; // labelKey → {pair, finderIdx, M, rep}
  for (const u of units) for (let fi = 0; fi < X_FINDER_IDS.length; fi += 1) {
    const k = xLabelKey(u.pairId, X_FINDER_IDS[fi]) + '|' + u.M.transformId;
    const cand = { u, fi, support: u.sup[fi], conflict: u.con[fi], sortKey: [-(u.sup[fi] - u.con[fi]), -u.sup[fi], u.pose.poseRank, u.o] };
    const cur = labels[k];
    if (!cur || compareTuples(cand.sortKey, cur.sortKey) < 0) labels[k] = cand;
  }
  const labelOrder = [];
  for (const pr of X_PROFILE_IDS) for (const fi of X_FINDER_IDS) labelOrder.push(xLabelKey(pr, fi));
  const survivors = {}; // labelKey → {M: transformId → rep}
  for (const lk of labelOrder) {
    const entries = [], surv = [];
    for (let m = 0; m < 48; m += 1) {
      const rep = labels[`${lk}|${m}`];
      if (!rep) continue;
      // §1.4 · §2.9 · §6.2b-29 — chanceConflict 는 «κ 판정에 닿는 후보(라벨 자신의 support ≥ s_min)» 에서만 수치, 나머지는 null.
      // 단위 (pose,쌍,o,M) 가 대표 support(finder 7 최댓값)로 C_conf 에 들어도 그 단위의 다른 finder 가 s_min 미만이면 그 라벨엔 null 이에요(통합 수정 1차).
      const cc = rep.u.chance && rep.support >= P.sMin ? rep.u.chance[rep.fi] : null;
      entries.push([m, rep.support, rep.conflict, cc === null ? null : xRoundSerial(cc), rep.u.pose.poseRank, rep.u.o]);
      const corrected = cc === null ? rep.conflict : rep.conflict - cc;
      rep.uncorrected = cc === null;
      rep.alive = rep.support >= P.sMin && corrected <= kappa(rep.support);
      if (rep.alive) surv.push(m);
    }
    if (entries.length) { cov.addressSupport[lk] = entries; if (surv.length) cov.survivorTransforms[lk] = surv; survivors[lk] = surv; }
  }

  // ── B9 조립(§2.10 · §3.3)
  const aliasByPair = {};
  for (const pr of X_PROFILE_IDS) aliasByPair[pr] = xAliasClasses(pr);
  const candidates = []; // (pair, class, M)
  for (const pr of X_PROFILE_IDS) for (const cls of aliasByPair[pr]) {
    const rep0 = X_FINDER_IDS[cls[0]];
    for (let m = 0; m < 48; m += 1) {
      const rep = labels[`${xLabelKey(pr, rep0)}|${m}`];
      if (!rep || rep.support === 0) continue;
      candidates.push({ pr, cls, m, rep });
    }
  }
  const alive = candidates.filter(c => c.rep.alive);
  const pool = alive.length ? alive : candidates;
  const belowThreshold = !alive.length;
  const classKey = c => `${c.pr}#${c.cls[0]}`;
  // 모호 토큰(대표값 · 클래스 단위)
  const aliveByClass = {};
  for (const c of alive) { (aliveByClass[classKey(c)] ??= new Set()).add(c.m); }
  const tokens = [];
  const nSurv = Math.max(0, ...Object.values(aliveByClass).map(s => s.size));
  if (nSurv >= 2) tokens.push(`ambiguous-address:${nSurv}-survivors`);
  if (alive.length && D.conflictUncorrectedDropped >= 1) tokens.push('ambiguous-address:uncorrected');
  const profilesAlive = new Set(alive.map(c => c.pr));
  for (const pr of profilesAlive) if (new Set(alive.filter(c => c.pr === pr).map(classKey)).size >= 2) { tokens.push('ambiguous-finder'); break; }
  if (profilesAlive.size >= 2) tokens.push('ambiguous-profile');
  if (ambiguousN) tokens.push('ambiguous-N');
  const allImproper = alive.length > 0 && alive.every(c => c.rep.u.M.parity < 0);
  const hyps = [];
  for (const c of pool) {
    const u = c.rep.u, pose = u.pose, N = pose.N;
    const R = xOutputRotation(pose.Rf, u.M.transformId, pose.layerSign);
    // §2.8 · §3.1 — o ≠ 0(부분 시야) 가설의 큐브 중심은 t_f + R_f·h 가 아니라 거기서 R·Π^p·o 를 뺀 자리예요(통합 수정 1차 «o ≠ 0 항»; §3.1 항등식 X_c = R·Π^p·P_s + t 유지)
    const t = xOutputTranslation(pose.Rf, pose.tf, N, pose.layerSign, P.pitch, u.o, u.M.transformId);
    const Rr = xRoundSerialArray(R), tr = xRoundSerialArray(t);
    const half = (N - 1) / 2;
    const geomRows = pose.geom.map((x, i) => ({ id: x.id, a: x.a, s: u.siteIds[i], px: x.px })).filter(x => x.s !== null).sort((a, b) => a.id - b.id);
    const Ruse = u.M.parity > 0 ? Rr : mat3Mul(Rr, X_ADDRESS_PI);
    const pts = geomRows.map(x => xSiteCoord(N, x.s).map(v => P.pitch * (v - half)));
    const stats = xResidualStats({ R: Ruse, t: tr, points: pts, pixels: geomRows.map(x => x.px), camera });
    const resid = geomRows.map((x, i) => { const p = xProjectPoint(Ruse, tr, pts[i], camera); return { id: x.id, d: Math.hypot(p.u - x.px[0], p.v - x.px[1]) }; });
    const F48 = sortBy(resid, x => [q6(x.d), x.id]).slice(0, P.nD.F).sort((a, b) => a.id - b.id);
    const sOf = new Map(geomRows.map(x => [x.id, x.s]));
    const vRows = pose.vMatch.map(x => { const s = xSiteFromFaceLocal(x.a, u.T, N, u.o); return s ? [x.id, xSiteId(N, s)] : null; }).filter(Boolean).sort((a, b) => a[0] - b[0]).slice(0, P.nD.V);
    const map = maps[c.pr][c.cls[0]];
    const predicted = pose.fullProj.sites.filter(s => s.inFrame).map(s => { const q = xSiteFromFaceLocal(s.a, u.T, N, u.o); return q ? xSiteId(N, q) : null; }).filter(x => x !== null);
    const excludedSites = pose.fullProj.sites.filter(s => s.inFrame && s.overlap).map(s => { const q = xSiteFromFaceLocal(s.a, u.T, N, u.o); return q ? xSiteId(N, q) : null; }).filter(x => x !== null);
    const qFit = q6(Math.max(0, 1 - stats.rmsPx / pose.g));
    const qAddr = c.rep.support - c.rep.conflict;
    const hypReasons = [];
    if (belowThreshold) hypReasons.push('support-below-threshold');
    if (!belowThreshold) { hypReasons.push(...tokens); if (allImproper) hypReasons.push('improper-only'); }
    hyps.push({
      sortKey: [-pose.qGeom, -qAddr, -qFit, N, u.M.transformId, u.o, c.rep.u.pairIndex, c.cls[0], pose.poseRank],
      cand: c,
      h: {
        hypothesisId: null, poseId: pose.poseRank, poseRank: pose.poseRank,
        profile: (() => { const p = xProfile(c.pr); return { profileId: p.profileId, layoutId: p.layoutId, N: p.N, c: p.c, tones: p.tones }; })(),
        finderId: X_FINDER_IDS[c.cls[0]], finderAliasClass: c.cls.map(i => X_FINDER_IDS[i]),
        finderAliasSupport: Object.fromEntries(c.cls.map(i => [X_FINDER_IDS[i], [u.sup[i], u.con[i]]])),
        effectiveStructureFingerprint: map.fingerprint,
        addressTransform: { perm: [...u.M.perm], sign: [...u.M.sign], parity: u.M.parity, transformId: u.M.transformId, layerSign: pose.layerSign, offset: [...u.o], addressMapDet: u.det },
        faceFrame: { faceHypothesisId: pose.f, lineIds: [...pose.face.lineIds], kB: pose.kB, kD: pose.kD, layerSign: pose.layerSign, R_f: xRoundSerialArray(pose.Rf), t_f: xRoundSerialArray(pose.tf) },
        R: Rr, t: tr,
        correspondences: { F: F48.map(x => [x.id, sOf.get(x.id)]), V: vRows, geom: geomRows.map(x => [x.id, x.s]), geomFaceLocal: geomRows.map(x => [x.id, [...x.a]]) },
        residualSummary: { count: stats.count, population: 'geom', rmsPx: xRoundSerial(stats.rmsPx), p95Px: xRoundSerial(stats.p95Px), maxPx: xRoundSerial(stats.maxPx) },
        fixedBitSupport: c.rep.support, fixedBitConflicts: c.rep.conflict,
        fixedBitUndetermined: xUndeterminedCount({ map, predictedInFrame: predicted, excludedSiteIds: excludedSites }),
        chanceBaseline: xRoundSerial(pose.E), chanceBaselineMethod: `hull-resample-${P.nChance}`, chanceBaselineSd: xRoundSerial(pose.Sd), chanceBaselineSe: xRoundSerial(pose.Se),
        chanceBaselineV: xRoundSerial(pose.EV), chanceConflict: u.chance && c.rep.support >= P.sMin ? xRoundSerial(u.chance[c.cls[0]]) : null, conflictUncorrected: u.capped,
        separableSitesConsidered: pose.fullProj.usable.length, gateBinding: pose.gateBinding,
        selectionScore: [pose.qGeom, qAddr, qFit], rejectReasons: orderReasons(hypReasons),
      },
    });
  }
  const sortedHyps = hyps.sort((a, b) => compareTuples(a.sortKey, b.sortKey));
  cov.truncatedCandidates = Math.max(0, sortedHyps.length - 4);
  output.hypotheses = sortedHyps.slice(0, 4).map((x, i) => ({ ...x.h, hypothesisId: i }));
  D.nD.F = output.hypotheses.length ? Math.min(P.nD.F, output.hypotheses[0].correspondences.geom.length) : Math.min(P.nD.F, fin[0].geom.length);

  // ── status(§3.3 전순서)
  const capsNoCC = ctx.caps.filter(c => c !== 'chance-conflict-cap');
  const frameToks = ctx.caps.map(c => `cap-hit:${c}`);
  if (capsNoCC.length) return finish(ctx, 'cap-hit', frameToks);
  if (fin[0].overlapRatio > 0.5) return finish(ctx, 'degenerate-view', frameToks.concat('degenerate-view'));
  if (!candidates.length) return finish(ctx, 'unsupported', frameToks.concat('unsupported-address'));
  if (belowThreshold) return finish(ctx, 'support-below-threshold', frameToks.concat('support-below-threshold'));
  if (allImproper) return finish(ctx, 'improper-only', frameToks.concat('improper-only'));
  // 유일 생존 M · 유일 계열 · parity +1 · N 마진(§3.3 selected 조건의 앞 네 항)
  const uniqueBase = alive.length === 1 && alive[0].rep.u.M.parity > 0 && !ambiguousN;
  if (uniqueBase && cov.unexplored.length) return finish(ctx, 'unresolved', frameToks.concat(cov.offsetCap.length ? ['offset-cap'] : []));
  if (!uniqueBase || tokens.length) return finish(ctx, 'ambiguous', frameToks.concat(tokens));
  output.selectedHypothesisId = output.hypotheses.find(h => h.addressTransform.transformId === alive[0].m && h.profile.profileId === alive[0].pr)?.hypothesisId ?? null;
  if (output.selectedHypothesisId === null) return finish(ctx, 'ambiguous', frameToks);
  return finish(ctx, 'selected', frameToks);
}

// ───────────────────────────── 순위·절단 키(§2.5 · §2.6 · §2.8 — 정수 튜플 전순서) ─────────────────────────────

/** B4 보존 키: `(m 내림 — raw, rms 오름, 두 직선 지지 최소 blobId 오름, 면 index, 삼중 index, 근 index)` */
const b4Key = x => [-x.m, q6(x.rms), x.face.minBlobId, x.f, x.t, x.r];
/** B5→LM 가지치기 키(N 안에서): `(q_layer 내림, rms 오름, 면, 삼중, 근, layerSign +1 먼저)` — 앞 4 남김 */
const layerKey = x => [-x.qLayer, q6(x.rms), x.f, x.t, x.r, x.layerSign === 1 ? 0 : 1];
/** `q_geom = round(1e6·(V inlier − E_chance_V))`(§2.8 · §2.10) */
const qGeom = (inlier, EV) => q6(inlier - EV);
/** B7 pose 순위 키: `(q_geom 내림, N 오름, rms 오름, 면, 삼중, 근, layerSign +1 먼저)` */
const rankKey = x => [-x.qGeom, x.N, q6(x.lmRms), x.f, x.t, x.r, x.layerSign === 1 ? 0 : 1];

// ───────────────────────────── B2 실루엣 직선(§2.3) ─────────────────────────────

/** 점-직선 수직 거리(직선 = 점 p0 + 방향 d(단위)) */
const perpDist = (L, u, v) => Math.abs((u - L.p[0]) * -L.d[1] + (v - L.p[1]) * L.d[0]);
/** PCA 직선(총최소제곱) — 점 ≥ 2, 퇴화면 null */
function pcaLine(pts) {
  if (pts.length < 2) return null;
  const mu = mean(pts.map(p => p.u)), mv = mean(pts.map(p => p.v));
  let suu = 0, suv = 0, svv = 0;
  for (const p of pts) { suu += (p.u - mu) ** 2; suv += (p.u - mu) * (p.v - mv); svv += (p.v - mv) ** 2; }
  const th = 0.5 * Math.atan2(2 * suv, suu - svv);
  const d = [Math.cos(th), Math.sin(th)];
  if (!(suu + svv > 0)) return null;
  return { p: [mu, mv], d, angle: foldAngle(Math.atan2(d[1], d[0])) };
}
function supportOf(L, geom, tau) { return geom.filter(b => perpDist(L, b.u, b.v) <= tau); }
/** 로버스트 직선(§2.3): 초기 직선 → 지지 → 지지 PCA → 하위 중앙값 이하 부분집합 PCA → 재지지 */
function robustLine(init, geom, tau) {
  let L = init;
  let S = supportOf(L, geom, tau);
  if (S.length >= 2) {
    const L1 = pcaLine(S) ?? L;
    const res = S.map(b => perpDist(L1, b.u, b.v));
    const med = lowerMedian(res);
    const sub = S.filter((b, i) => res[i] <= med);
    const L2 = (sub.length >= 2 ? pcaLine(sub) : null) ?? L1;
    L = L2;
    S = supportOf(L, geom, tau);
  }
  return { ...L, support: S.map(b => b.id).sort((a, b) => a - b), supportPts: S };
}
function silhouetteLines(geom, P) {
  const pts = geom.map(b => ({ u: b.u, v: b.v, tag: b.id, id: b.id }));
  let hull = convexHull(pts);
  const out = { hullVertices: hull.length, outliers: 0, lines: [], L0: 0, lineCap: false, insufficient: false };
  if (hull.length < 3) { out.insufficient = true; return out; }
  // 꼭짓점 > 32 → 외각 큰 순 32(동률 blobId)
  const extAngle = (h, i) => {
    const a = h[(i - 1 + h.length) % h.length], b = h[i], c = h[(i + 1) % h.length];
    const d1 = Math.atan2(b.v - a.v, b.u - a.u), d2 = Math.atan2(c.v - b.v, c.u - b.u);
    let d = d2 - d1; while (d <= -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI; return Math.abs(d);
  };
  if (hull.length > P.hullMaxVertices) {
    const keep = new Set(sortBy(hull.map((h, i) => ({ i, ang: extAngle(hull, i), id: h.id })), x => [-q9(x.ang), x.id]).slice(0, P.hullMaxVertices).map(x => x.i));
    hull = hull.filter((h, i) => keep.has(i));
  }
  // 고립 외톨이(§2.3): 인접 두 꼭짓점을 잇는 현에서 수직 거리 > 3·τ 이면서, 그 꼭짓점에 닿는 두 껍질 변 어느 쪽도
  // 양 끝점 밖의 지지 blob 이 없음(= 그 꼭짓점을 지지하는 blob 이 자기뿐) → 직선 초기화에서 제외
  const tau = P.tauLinePx;
  const isOutlier = (h, i) => {
    const a = h[(i - 1 + h.length) % h.length], b = h[i], c = h[(i + 1) % h.length];
    const L = pcaLine([a, c]); if (!L) return false;
    if (!(perpDist(L, b.u, b.v) > P.outlierFactor * tau)) return false;
    const edgeSupport = (p, q) => { const E1 = pcaLine([p, q]); return E1 ? supportOf(E1, geom, tau).length : 0; };
    return edgeSupport(a, b) <= 2 && edgeSupport(b, c) <= 2;
  };
  const flags = hull.map((h, i) => isOutlier(hull, i));
  out.outliers = flags.filter(Boolean).length;
  hull = hull.filter((h, i) => !flags[i]);
  if (hull.length < 3) { out.insufficient = true; return out; }
  // 원 변(순환)과 방향
  const E = hull.length;
  const edgeDir = i => { const a = hull[i], b = hull[(i + 1) % E]; return foldAngle(Math.atan2(b.v - a.v, b.u - a.u)); };
  const rawDirs = Array.from({ length: E }, (_, i) => edgeDir(i));
  const mergeRad = P.mergeDeg * DEG;
  // 시작 변 = 직전 원 변과 방향차 ≥ 3° 인 변 중 순회 최소
  let start = -1;
  for (let i = 0; i < E; i += 1) if (foldedDiff(rawDirs[i], rawDirs[(i - 1 + E) % E]) >= mergeRad) { start = i; break; }
  if (start < 0) { out.lines = []; out.L0 = 1; out.insufficient = true; return out; } // 전부 병합 가능 → L = 1
  // 순환 단일 패스 병합 — 비교는 직전 병합 결과의 적합 방향, 패스 끝은 시작 변과 비교하지 않음
  const groups = [];
  let cur = null;
  for (let s = 0; s < E; s += 1) {
    const i = (start + s) % E;
    const vs = [hull[i], hull[(i + 1) % E]];
    if (cur && foldedDiff(cur.fit.angle, rawDirs[i]) < mergeRad) { cur.edges.push(i); cur.pts.push(vs[1]); cur.fit = pcaLine(cur.pts) ?? cur.fit; }
    else { cur = { edges: [i], pts: vs.slice(), fit: pcaLine(vs) }; groups.push(cur); }
  }
  // 각 그룹 → 로버스트 직선(최소 지지 3 점 — 미달 그룹은 직선이 아니라 hullOrder 를 소비하지 않아요: 코너 blob 부재로 생기는
  // 짧은 «코너 절단 현» 이 두 실루엣 직선의 순환 인접을 끊지 않게 — §2.4 코너 부재 내성 · §6.2-25). hullOrder = 시작 변부터 순환 순서 0 부터.
  const lines = [];
  for (const g of groups) {
    const L = robustLine(g.fit, geom, tau);
    if (L.support.length < 3) continue;
    lines.push({ ...L, hullOrder: lines.length, angleQ: q9(L.angle) });
  }
  out.L0 = lines.length;
  let sorted = sortBy(lines, L => [-L.support.length, L.angleQ, L.support[0], L.support]);
  if (sorted.length > P.lineCap) { out.lineCap = true; sorted = sorted.slice(0, P.lineCap); }
  sorted.forEach((L, i) => { L.sortIndex = i; });
  out.lines = sorted;
  if (sorted.length < 2) out.insufficient = true;
  return out;
}

// ───────────────────────────── B3 면 가설(§2.4) ─────────────────────────────

function faceHypotheses(lines, L0, frame, P, D) {
  const byOrder = new Map(lines.map(L => [L.hullOrder, L]));
  const faces = [];
  const pairsSeen = new Set();
  const thetaMin = P.thetaMinDeg * DEG;
  for (let h = 0; h < L0; h += 1) {
    const h2 = (h + 1) % L0;
    if (h2 === h) continue;
    const k = h < h2 ? `${h},${h2}` : `${h2},${h}`;
    if (pairsSeen.has(k)) continue; pairsSeen.add(k);
    const La = byOrder.get(h), Lb = byOrder.get(h2);
    if (!La || !Lb) continue;
    if (foldedDiff(La.angle, Lb.angle) < thetaMin) { D.faceRejected['face-lines-parallel'] += 1; continue; }
    // 교점: p_a + s·d_a = p_b + t·d_b
    const den = La.d[0] * Lb.d[1] - La.d[1] * Lb.d[0];
    const dx = Lb.p[0] - La.p[0], dy = Lb.p[1] - La.p[1];
    const s = (dx * Lb.d[1] - dy * Lb.d[0]) / den;
    const C = [La.p[0] + s * La.d[0], La.p[1] + s * La.d[1]];
    const W = frame.width, H = frame.height;
    if (!isFin(C[0]) || !isFin(C[1]) || C[0] < -W / 2 || C[0] > 1.5 * W || C[1] < -H / 2 || C[1] > 1.5 * H) { D.faceRejected['face-intersection-out'] += 1; continue; }
    const farthest = L => L.supportPts.slice().sort((a, b) => (Math.hypot(b.u - C[0], b.v - C[1]) - Math.hypot(a.u - C[0], a.v - C[1])) || (a.id - b.id))[0];
    const B = farthest(La), Dd = farthest(Lb);
    faces.push({ id: faces.length, lineIds: [La.hullOrder, Lb.hullOrder], C, Bpx: [B.u, B.v], Dpx: [Dd.u, Dd.v], minBlobId: Math.min(La.support[0], Lb.support[0]) });
  }
  return faces;
}

// ───────────────────────────── B1 축 프레임(§2.2, 진단 전용) ─────────────────────────────

const CUBE_RES = 24;
/** 단위 방향 → 큐브맵 셀(면 0…5 · 행 · 열), 셀 전순서 index = (face·24 + row)·24 + col */
function cubeCell(d) {
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  let face, s, t, m;
  if (ax >= ay && ax >= az) { m = ax; face = d[0] > 0 ? 0 : 1; s = d[1]; t = d[2]; }
  else if (ay >= az) { m = ay; face = d[1] > 0 ? 2 : 3; s = d[0]; t = d[2]; }
  else { m = az; face = d[2] > 0 ? 4 : 5; s = d[0]; t = d[1]; }
  const row = Math.min(CUBE_RES - 1, Math.floor((s / m + 1) / 2 * CUBE_RES)), col = Math.min(CUBE_RES - 1, Math.floor((t / m + 1) / 2 * CUBE_RES));
  return (face * CUBE_RES + row) * CUBE_RES + col;
}
function cellCentre(idx) {
  const face = Math.floor(idx / (CUBE_RES * CUBE_RES)), row = Math.floor(idx / CUBE_RES) % CUBE_RES, col = idx % CUBE_RES;
  const s = (row + 0.5) / CUBE_RES * 2 - 1, t = (col + 0.5) / CUBE_RES * 2 - 1;
  const sign = face % 2 === 0 ? 1 : -1;
  const v = face < 2 ? [sign, s, t] : face < 4 ? [s, sign, t] : [s, t, sign];
  return unit3(v);
}
const foldHemi = n => { if (n[2] < 0 || (n[2] === 0 && (n[0] < 0 || (n[0] === 0 && n[1] < 0)))) return [-n[0], -n[1], -n[2]]; return n; };
function axisFrameCandidates(geom, camera, P) {
  const rays = geom.map(b => unit3([(b.u - camera.cx) / camera.fx, (b.v - camera.cy) / camera.fy, 1]));
  const votes = new Map();
  const seenPair = new Set();
  const tauSep = P.tauSepDeg * DEG;
  for (let i = 0; i < geom.length; i += 1) {
    const nn = geom.map((b, j) => ({ j, d: Math.hypot(b.u - geom[i].u, b.v - geom[i].v), id: b.id })).filter(x => x.j !== i).sort((a, b) => (a.d - b.d) || (a.id - b.id)).slice(0, 12);
    for (const { j } of nn) {
      const pairKey = i < j ? `${i},${j}` : `${j},${i}`;
      if (seenPair.has(pairKey)) continue; seenPair.add(pairKey);
      const c = cross3(rays[i], rays[j]);
      const sinA = norm3(c);
      if (sinA < Math.sin(tauSep)) continue;
      const n = foldHemi(unit3(c));
      let a = cross3(n, [0, 0, 1]); a = norm3(a) > 1e-9 ? unit3(a) : [1, 0, 0];
      const b = cross3(n, a);
      const cells = new Set();
      for (let th = 0; th < 2 * Math.PI; th += 0.02) {
        const d = foldHemi([Math.cos(th) * a[0] + Math.sin(th) * b[0], Math.cos(th) * a[1] + Math.sin(th) * b[1], Math.cos(th) * a[2] + Math.sin(th) * b[2]]);
        cells.add(cubeCell(d));
      }
      for (const cidx of cells) votes.set(cidx, (votes.get(cidx) ?? 0) + 1);
    }
  }
  if (!votes.size) return [];
  const rows = 6 * CUBE_RES;
  const vote = idx => votes.get(idx) ?? 0;
  const peaks = [];
  for (const [idx, v] of [...votes.entries()].sort((a, b) => a[0] - b[0])) {
    const r = Math.floor(idx / CUBE_RES), c = idx % CUBE_RES;
    let keep = true;
    for (let dr = -1; dr <= 1 && keep; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= CUBE_RES) continue;
      const nb = rr * CUBE_RES + cc;
      const nv = vote(nb);
      if (nv > v || (nv === v && nb < idx)) { keep = false; break; }
    }
    if (keep) peaks.push({ idx, v });
  }
  const top = sortBy(peaks, p => [-p.v, p.idx]).slice(0, 16);
  const dirs = top.map(p => ({ ...p, d: cellCentre(p.idx) }));
  const ortho = (x, y) => { const c = Math.abs(dot3(x.d, y.d)); return c <= Math.sin(6 * DEG); };
  const triples = [];
  for (let i = 0; i < dirs.length; i += 1) for (let j = i + 1; j < dirs.length; j += 1) for (let k = j + 1; k < dirs.length; k += 1) {
    if (ortho(dirs[i], dirs[j]) && ortho(dirs[i], dirs[k]) && ortho(dirs[j], dirs[k])) triples.push({ cells: [dirs[i], dirs[j], dirs[k]], score: dirs[i].v + dirs[j].v + dirs[k].v });
  }
  const best = sortBy(triples, t => [-t.score, t.cells.map(c => c.idx).sort((a, b) => a - b)]).slice(0, 2);
  return best.map(t => {
    const c = t.cells.slice().sort((a, b) => a.idx - b.idx);
    let R = [c[0].d[0], c[0].d[1], c[0].d[2], c[1].d[0], c[1].d[1], c[1].d[2], c[2].d[0], c[2].d[1], c[2].d[2]];
    // 극분해 8 회(X ← ½(X + X⁻ᵀ)) → det 부호 → so(3) Gauss–Newton 5 회(고정 횟수)
    for (let it = 0; it < 8; it += 1) { const inv = mat3InvT(R); if (!inv) break; R = R.map((x, i) => 0.5 * (x + inv[i])); }
    if (det3(R) < 0) { R[6] = -R[6]; R[7] = -R[7]; R[8] = -R[8]; }
    const target = [c[0].d, c[1].d, c[2].d];
    for (let it = 0; it < 5; it += 1) {
      // 행 i = R 의 i 번째 축(세계 → 카메라 방향); 목표 d_i 에 맞추는 회전 증분 ω = Σ (r_i × d_i) / 3
      let w = [0, 0, 0];
      for (let i = 0; i < 3; i += 1) { const ri = [R[i * 3], R[i * 3 + 1], R[i * 3 + 2]]; const cr = cross3(ri, target[i]); w = [w[0] + cr[0] / 3, w[1] + cr[1] / 3, w[2] + cr[2] / 3]; }
      R = mat3Mul(xExpSO3(w), R);
    }
    return R;
  });
}
function mat3InvT(M) {
  const d = det3(M);
  if (!(Math.abs(d) > 1e-12)) return null;
  const c = [
    M[4] * M[8] - M[5] * M[7], -(M[3] * M[8] - M[5] * M[6]), M[3] * M[7] - M[4] * M[6],
    -(M[1] * M[8] - M[2] * M[7]), M[0] * M[8] - M[2] * M[6], -(M[0] * M[7] - M[1] * M[6]),
    M[1] * M[5] - M[2] * M[4], -(M[0] * M[5] - M[2] * M[3]), M[0] * M[4] - M[1] * M[3],
  ];
  return c.map(x => x / d); // 여인수 행렬 / det = (M⁻¹)ᵀ
}
/** 직선 방향이 R̂ 의 세 축 화면 투영 방향 중 하나와 τ_dir 안인지(직선 지지 중점에서의 국소 투영 방향) */
function lineAgrees(L, Rhat, camera, P) {
  const mu = mean(L.supportPts.map(b => b.u)), mv = mean(L.supportPts.map(b => b.v));
  const xt = (mu - camera.cx) / camera.fx, yt = (mv - camera.cy) / camera.fy;
  for (let k = 0; k < 3; k += 1) {
    const a = [Rhat[k * 3], Rhat[k * 3 + 1], Rhat[k * 3 + 2]];
    const du = camera.fx * (a[0] - a[2] * xt), dv = camera.fy * (a[1] - a[2] * yt);
    if (!(Math.hypot(du, dv) > 1e-9)) continue;
    if (foldedDiff(Math.atan2(dv, du), L.angle) <= P.tauDirDeg * DEG) return true;
  }
  return false;
}

// ───────────────────────────── 테스트 전용 내부 노출(접두 `_`) ─────────────────────────────
export const _internals = Object.freeze({ matchCanonical, convexHull, makeHullSampler, insideConvex, silhouetteLines, faceHypotheses, compareTuples, mergePolicy, validateInputs, REASON_ORDER, CAP_ORDER, projectRaws, nullSetup, nullSample, physOf, gate2Threshold, b4Key, layerKey, rankKey, qGeom, sortBy, q6, sampleSd, lowerMedian });
