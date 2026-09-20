/**
 * x-address-48 — Type X 단계 ② 의 «주소/변환» 순수 함수 모음(구현자 A 소유).
 *
 * 정본: `.agent/lanes/type-x-core-20260919/DESIGN_006_stage2-correspondence-pose.md` v6 봉인판(sha 5aefa00b…) + v6.1 통합 수정 1차 개정(sha 7f9251b7…, `d9-design-amendment-001.json` — §2.8 t 의 o 항 · §2.9 chanceConflict 기록 게이트).
 * 이 파일이 구현하는 절:
 *   §3.1  48 변환 인코딩(`transformId = permIndex·8 + signIndex`, perm 사전순 6 · sign `+1` 먼저 8) · 작용 방향 `v_s = M·v_f` ·
 *         far 두 행렬(`Q` 주소 재라벨 · `S = Π·Qᵀ` 기하 인자) · `T = M·Q^[far]` · `R = R_f·S^[far]·M_pᵀ`(`M_p = M` 또는 `Π·M`) · `addressMapDet = det T`.
 *   §2.8  t 변환 `t = t_f + R_f·(h(layerSign) − pitch·Π^[far]·Tᵀ·o)`, `h = pitch·((N−1)/2)·(1,1,layerSign)`(o = 0 이면 `t_f + R_f·h`; 통합 수정 1차 «o ≠ 0 항»). §2.5 `pitchPx_hyp = fx·pitch / t_z`(o = 0 의 중심 깊이 — B4/B5 시점엔 o 가 없어요).
 *   §2.9  오프셋 재구성식 `s = T·(p_f − c) + c + o` · 단계 0(extent / cross-N) · 축 짝짓기 오프셋 범위(R7-31) · `Ω` · 지지/모순 셈 ·
 *         `fixedBitUndetermined` · `F_eff` = 중심 집합 ∪ `finderSpecEffective.levels`(«구성상 항상 0» 사이트는 known 에 넣지 않음 — 음의 증거 금지) ·
 *         회계 항등식(1,008 = 평가 + CrossN + Extent + Geometry + |unexplored|, 다섯 집합 서로소) · `unexplored` 여집합 유도 · `uniquenessScope` 세 값.
 *   §2.4  보편 점등 인덱스 `U(profile, finder)` · 유일 `(N, k_B, k_D)` 삼중 색인 33(N8 14 · N10 19).
 *   §2.5  면 평면 구성(6 면 × 고정1/고정0/데이터).
 *   §2.10 finder 별칭 클래스 — 같은 profile 에서 `F_eff`(known ∧ bits) 완전 동일한 finder 집합을 registry 로드 시 **유도**(손 목록 금지).
 *   §3.4  `Stab(F_eff)` — `F_eff∘g = F_eff` 를 known · bits 전부에서 요구하는 정확 안정자(21 행 전부 항등뿐 — 자로 재현).
 *
 * 규율: 외부 의존성 0 · ESM · 결정적(RNG 0) · 유계 · frozen registry(`x-profile.js` · `x-finder.js` · `x-layout.js`)에서 유도하고 손 목록 없음 ·
 * GT 계열(정답·신탁·관측 행 파일과 그 행의 러너 전용 필드 — 설계 §1.2 «러너 전용» 목록)을 import/open/인자로 받지 않음(§6.2b-19 정적 팔).
 * 오류 통로(계약 §9-1): 내부 API 라 **형식 위반은 throw(TypeError/RangeError)**, 값 거절은 `null`/`NaN`/빈 배열.
 */
import { createHash } from 'node:crypto';
import { xProfileLayout, xProfile, X_PROFILE_IDS } from './x-profile.js';
import { X_FINDER_IDS, xEdges } from './x-finder.js';
import { xSiteCoord, xSiteId } from './x-layout.js';

// ───────────────────────────── §3.1 48 변환 ─────────────────────────────

/** perm 사전순 6(`permIndex` 0…5) */
const PERMS = Object.freeze([[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map(p => Object.freeze(p)));
/** sign — `+1` 을 `−1` 앞에 두는 사전순 8(`signIndex` 0…7): (+,+,+) < (+,+,−) < … < (−,−,−) */
const SIGNS = Object.freeze([...Array(8)].map((_, i) => Object.freeze([1 - 2 * ((i >> 2) & 1), 1 - 2 * ((i >> 1) & 1), 1 - 2 * (i & 1)])));

/** 3×3 정수 행렬식(행 우선 9 배열) */
function det3(M) {
  return M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
}
function mat3Mul(a, b) {
  const out = new Array(9);
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return out;
}
function mat3T(a) { return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]; }
function mat3Apply(R, p) {
  return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
}
const isFiniteArray = (a, n) => Array.isArray(a) && a.length === n && a.every(v => typeof v === 'number' && Number.isFinite(v));
const isSignedPerm = M => {
  if (!isFiniteArray(M, 9)) return false;
  for (let r = 0; r < 3; r += 1) {
    const row = [M[r * 3], M[r * 3 + 1], M[r * 3 + 2]];
    if (row.filter(v => v === 1 || v === -1).length !== 1 || row.filter(v => v === 0).length !== 2) return false;
  }
  for (let c = 0; c < 3; c += 1) if ([M[c], M[3 + c], M[6 + c]].filter(v => v !== 0).length !== 1) return false;
  return true;
};

/** `X_TRANSFORMS[id]` — 배열 위치 == transformId, `M[r][perm[r]] = sign[r]`(행 우선 9), `parity = det M` */
export const X_TRANSFORMS = Object.freeze(PERMS.flatMap((perm, permIndex) => SIGNS.map((sign, signIndex) => {
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r += 1) M[r * 3 + perm[r]] = sign[r];
  return Object.freeze({ transformId: permIndex * 8 + signIndex, perm, sign, M: Object.freeze(M), parity: det3(M), permIndex, signIndex });
})));
const TRANSFORM_BY_KEY = new Map(X_TRANSFORMS.map(t => [t.M.join(','), t.transformId]));

/** far 두 행렬(§3.1): `Q` = i ↔ j 교환(det −1, 주소 재라벨) · `Π = diag(1,1,−1)` · `S = Π·Qᵀ`(det +1, 기하 인자) */
export const X_ADDRESS_Q = Object.freeze([0, 1, 0, 1, 0, 0, 0, 0, 1]);
export const X_ADDRESS_PI = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, -1]);
export const X_ADDRESS_S = Object.freeze(mat3Mul(X_ADDRESS_PI, mat3T(X_ADDRESS_Q)));

export function xTransformById(id) {
  if (!Number.isInteger(id) || id < 0 || id >= 48) throw new RangeError(`transformId 는 0…47 정수여야 해요: ${String(id)}`);
  return X_TRANSFORMS[id];
}
/** 9 배열 또는 id → 동결 변환 원소(부호 순열이 아니면 RangeError) */
function transformOf(M) {
  if (Number.isInteger(M)) return xTransformById(M);
  if (!isSignedPerm(M)) throw new RangeError('M 은 transformId 또는 부호 순열 3×3(행 우선 9 배열)이어야 해요');
  return X_TRANSFORMS[TRANSFORM_BY_KEY.get(M.join(','))];
}
/** 역원 id — 부호 순열은 직교라 `M⁻¹ = Mᵀ` */
export function xTransformInverse(id) { return TRANSFORM_BY_KEY.get(mat3T(xTransformById(id).M).join(',')); }
/** 합성 id — `M_a·M_b`(군 닫힘) */
export function xTransformCompose(a, b) { return TRANSFORM_BY_KEY.get(mat3Mul(xTransformById(a).M, xTransformById(b).M).join(',')); }

function assertLayerSign(layerSign) {
  if (layerSign !== 1 && layerSign !== -1) throw new RangeError(`layerSign 은 +1/−1 이어야 해요: ${String(layerSign)}`);
}
/** 주소 사상 `T = M·Q^[layerSign=−1]`(near 는 `T = M`) 과 `addressMapDet = det T`(far 에서 `−det M`) */
export function xAddressMap(M, layerSign) {
  assertLayerSign(layerSign);
  const t = transformOf(M);
  const T = layerSign === -1 ? mat3Mul(t.M, X_ADDRESS_Q) : [...t.M];
  return { T, det: det3(T) };
}
/** 출력 회전 `R = R_f·S^[far]·M_pᵀ`, `M_p = M`(proper) 또는 `Π·M`(improper) — `Π·M` 이지 `M·Π` 가 아니에요(§3.1, improper 16/24 에서 갈려요) */
export function xOutputRotation(R_f, M, layerSign) {
  assertLayerSign(layerSign);
  if (!isFiniteArray(R_f, 9)) throw new TypeError('R_f 는 유한수 9 배열이어야 해요');
  const t = transformOf(M);
  const Mp = t.parity > 0 ? t.M : mat3Mul(X_ADDRESS_PI, t.M);
  const base = layerSign === -1 ? mat3Mul(R_f, X_ADDRESS_S) : [...R_f];
  return mat3Mul(base, mat3T(Mp));
}
/** `h(layerSign) = pitch·((N−1)/2)·(1, 1, layerSign)` — 면-국소 원점(코너)→큐브 중심 (§2.8) */
function hOf(N, layerSign, pitch) { const c = pitch * (N - 1) / 2; return [c, c, c * layerSign]; }
function assertPoseArgs(R_f, t_f, N, layerSign, pitch) {
  assertLayerSign(layerSign);
  if (!isFiniteArray(R_f, 9)) throw new TypeError('R_f 는 유한수 9 배열이어야 해요');
  if (!isFiniteArray(t_f, 3)) throw new TypeError('t_f 는 유한수 3 배열이어야 해요');
  if (!Number.isInteger(N) || N < 2) throw new RangeError(`N 은 2 이상 정수여야 해요: ${String(N)}`);
  if (!(typeof pitch === 'number' && Number.isFinite(pitch) && pitch > 0)) throw new RangeError('pitch 는 유한 양수여야 해요');
}
/**
 * `t = t_f + R_f·(h(layerSign) − pitch·Π^[far]·Tᵀ·o)` — 큐브 중심 기준 출력 t(§2.8 · §3.1, 통합 수정 1차 «o ≠ 0 항»).
 * `h(layerSign)` 는 면-국소 원점(코너)→큐브 중심, `o` 는 §2.9 오프셋(정본 사이트 단위 정수 3 배열, 기본 `[0,0,0]`), `T = M·Q^[far]`(§3.1).
 * 유도: `s − c = T·(a − c) + o` 이고 `R·Π^p·T = R_f·Π^[far]` 이므로 `R·Π^p·(s − c) + t = R_f·Π^[far]·a + t_f` 가 모든 `a` 에서 서려면
 * `t = t_f + R_f·Π^[far]·c − R_f·Π^[far]·Tᵀ·o` — 카메라 프레임 표기로는 `t = (t_f + R_f·h) − R·Π^p·o`(pitch 단위) 와 같아요.
 * `o = 0` 이면 옛 식 `t_f + R_f·h` 그대로예요(far 에 `+1` 을 쓰면 `|Δt|/pitch = N−1`, `o` 를 빠뜨리면 `|Δt|/pitch = |o|`).
 * `o ≠ 0` 인데 `M` 이 없으면 TypeError(값을 조용히 틀리게 내지 않아요).
 */
export function xOutputTranslation(R_f, t_f, N, layerSign, pitch = 1, o = [0, 0, 0], M = undefined) {
  assertPoseArgs(R_f, t_f, N, layerSign, pitch);
  if (!isFiniteArray(o, 3) || !o.every(Number.isInteger)) throw new TypeError('o 는 정수 3 배열이어야 해요');
  const h = hOf(N, layerSign, pitch);
  if (o[0] !== 0 || o[1] !== 0 || o[2] !== 0) {
    if (M === undefined || M === null) throw new TypeError('o ≠ 0 이면 M(transformId 또는 부호 순열)이 필요해요');
    const { T } = xAddressMap(M, layerSign);
    // Π^[far]·Tᵀ·o — T 는 부호 순열(직교)이라 Tᵀ = T⁻¹
    const w = mat3Apply(mat3T(T), o);
    h[0] -= pitch * w[0]; h[1] -= pitch * w[1]; h[2] -= pitch * layerSign * w[2];
  }
  const Rh = mat3Apply(R_f, h);
  return [t_f[0] + Rh[0], t_f[1] + Rh[1], t_f[2] + Rh[2]];
}
/** `pitchPx_hyp = fx·pitch / (t_f + R_f·h(layerSign))[2]` — 큐브 중심 깊이 기준(§2.5 C12); 분모 ≤ 0 이면 NaN(값 거절) */
export function xPitchPxHyp(R_f, t_f, N, layerSign, fx, pitch = 1) {
  assertPoseArgs(R_f, t_f, N, layerSign, pitch);
  if (!(typeof fx === 'number' && Number.isFinite(fx) && fx > 0)) throw new RangeError('fx 는 유한 양수여야 해요');
  const tz = xOutputTranslation(R_f, t_f, N, layerSign, pitch)[2];
  return tz > 0 ? fx * pitch / tz : NaN;
}

// ───────────────────────────── §2.9 오프셋 재구성 ─────────────────────────────

/**
 * `s = T·(p_f − c) + c + o`, `c = (N−1)/2·(1,1,1)` — 면-국소 0-기반 정수 주소 → 정본 사이트 좌표(정수 3 배열).
 * 범위 `[0, N)³` 밖이거나 비정수면 `null`(값 거절, throw 아님).
 */
export function xSiteFromFaceLocal(pF, T, N, o) {
  if (!isFiniteArray(pF, 3) || !pF.every(Number.isInteger)) throw new TypeError('pF 는 정수 3 배열이어야 해요');
  if (!isSignedPerm(T)) throw new RangeError('T 는 부호 순열 3×3 이어야 해요');
  if (!Number.isInteger(N) || N < 2) throw new RangeError(`N 은 2 이상 정수여야 해요: ${String(N)}`);
  if (!isFiniteArray(o, 3) || !o.every(Number.isInteger)) throw new TypeError('o 는 정수 3 배열이어야 해요');
  // 2 배 정수 산술로 반정수 c 를 피해요: 2s = T·(2p − (N−1)) + (N−1) + 2o
  const v = [2 * pF[0] - (N - 1), 2 * pF[1] - (N - 1), 2 * pF[2] - (N - 1)];
  const w = mat3Apply(T, v);
  const s = [0, 0, 0];
  for (let r = 0; r < 3; r += 1) {
    const twice = w[r] + (N - 1) + 2 * o[r];
    if (twice % 2 !== 0) return null;
    s[r] = twice / 2;
    if (s[r] < 0 || s[r] >= N) return null;
  }
  return s;
}

/** 축별 «점등 인덱스 폭» `E_k = max − min + 1`(빈 배열이면 `[0,0,0]`) — §2.9 extent */
export function xExtent(faceLocalPoints) {
  if (!Array.isArray(faceLocalPoints)) throw new TypeError('faceLocalPoints 는 배열이어야 해요');
  if (faceLocalPoints.length === 0) return [0, 0, 0];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of faceLocalPoints) {
    if (!isFiniteArray(p, 3) || !p.every(Number.isInteger)) throw new TypeError('면-국소 점은 정수 3 배열이어야 해요');
    for (let k = 0; k < 3; k += 1) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  }
  return [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
}

/** registry 쌍(profileId) 중 N 이 같은 것 — 단계 0 의 «그 N 의 쌍» */
export function xPairsOfN(N) { return X_PROFILE_IDS.filter(id => xProfile(id).N === N); }

/**
 * 단계 0 — 한 finalist(그 N 의 최상위)의 `E_k` 로 그 N 의 쌍을 판정(§2.9 (ㄱ)). 발동 여부(ㄴ)(ㄴ′) 판단은 호출자(②) 몫.
 * `E_k > N` 인 축 → `extent-exceeds-N`(우선) · `E_k ≤ N−2` 인 축 → `cross-N-implausible` · 아니면 `evaluate`.
 * @param {{finalistsByN: Record<number, number[]>, N: number, pairs?: string[]}} arg — `finalistsByN[N]` = 그 N 최상위 finalist 의 `E[3]`
 */
export function xStage0Filter({ finalistsByN, pairs, N } = {}) {
  if (!Number.isInteger(N) || N < 2) throw new RangeError(`N 은 2 이상 정수여야 해요: ${String(N)}`);
  if (!finalistsByN || typeof finalistsByN !== 'object') throw new TypeError('finalistsByN 은 객체여야 해요');
  const E = finalistsByN[N];
  if (!isFiniteArray(E, 3)) throw new TypeError(`finalistsByN[${N}] 은 유한수 3 배열이어야 해요`);
  const list = pairs === undefined ? xPairsOfN(N) : pairs;
  if (!Array.isArray(list)) throw new TypeError('pairs 는 배열이어야 해요');
  return list.map(pair => {
    const nHyp = xProfile(pair).N;
    let verdict = 'evaluate';
    if (E.some(e => e > nHyp)) verdict = 'extent-exceeds-N';
    else if (E.some(e => e <= nHyp - 2)) verdict = 'cross-N-implausible';
    return { pair, verdict };
  });
}

/**
 * 오프셋 정의역(§2.9 축 짝짓기 R7-31): 정본 축 `r` 의 범위는 `T` 의 `r` 행이 가리키는 면-국소 축 `k(r)` 의 `E_k(r)` 와 `sign[r] = T[r][k(r)]` 로 —
 * sign +1 → `{0, …, N − E_k}`, sign −1 → `{−(N − E_k), …, 0}`. `Ω = Π_r (N − E_k(r) + 1)`(음수면 0). 열거는 `(o_0, o_1, o_2)` 사전순(각 축 오름, 음수 먼저).
 */
export function xOffsetRange(T, E, N) {
  if (!isSignedPerm(T)) throw new RangeError('T 는 부호 순열 3×3 이어야 해요');
  if (!isFiniteArray(E, 3) || !E.every(Number.isInteger)) throw new TypeError('E 는 정수 3 배열이어야 해요');
  if (!Number.isInteger(N) || N < 2) throw new RangeError(`N 은 2 이상 정수여야 해요: ${String(N)}`);
  const ranges = [];
  for (let r = 0; r < 3; r += 1) {
    const k = [0, 1, 2].find(c => T[r * 3 + c] !== 0);
    const sign = T[r * 3 + k];
    const count = Math.max(0, N - E[k] + 1);
    const vals = [];
    for (let i = 0; i < count; i += 1) vals.push(sign > 0 ? i : i - (count - 1));
    ranges.push(vals);
  }
  const offsets = [];
  for (const o0 of ranges[0]) for (const o1 of ranges[1]) for (const o2 of ranges[2]) offsets.push([o0, o1, o2]);
  return { omega: ranges[0].length * ranges[1].length * ranges[2].length, offsets };
}

// ───────────────────────────── §2.9 F_eff 지도 · §2.10 별칭 · §3.4 Stab ─────────────────────────────

const MAP_CACHE = new Map();
function keyOf(profileId, finderId) { return `${profileId}|${finderId}`; }
export function xLabelKey(pairId, finderId) { return `${pairId}|${finderId}`; }

function buildEffectiveMap(profileId, finderId) {
  // 미지 id 는 frozen xProfileLayout 이 던지는 것을 그대로 통과시켜요
  const L = xProfileLayout(profileId, { finderId });
  const N = L.raw.N;
  const known = new Uint8Array(N ** 3), bits = new Uint8Array(N ** 3);
  for (const cell of L.raw.cells) { known[cell.centre] = 1; bits[cell.centre] = 1; }
  for (const [siteId, level] of L.finderSpecEffective.levels) { known[siteId] = 1; bits[siteId] = level === 0 ? 0 : 1; }
  const fingerprint = `sha256:${createHash('sha256').update(L.structureCanonical, 'utf8').digest('hex')}`;
  return Object.freeze({ N, known, bits, profile: profileId, finderId, fingerprint });
}
/** `F_eff` 지도 — known/bits `Uint8Array(N³)`; «구성상 항상 0» 사이트(잔여·탈락 트리플 비구조)는 known 에 넣지 않아요 */
export function xEffectiveMap(profileId, finderId) {
  if (typeof profileId !== 'string' || typeof finderId !== 'string') return buildEffectiveMap(profileId, finderId); // frozen 이 거절하게
  const cacheKey = keyOf(profileId, finderId);
  if (!MAP_CACHE.has(cacheKey)) MAP_CACHE.set(cacheKey, buildEffectiveMap(profileId, finderId));
  return MAP_CACHE.get(cacheKey);
}
/** 21 행 전부(`X_PROFILE_IDS × X_FINDER_IDS` 순, 캐시) */
export function xEffectiveMaps() {
  return X_PROFILE_IDS.flatMap(p => X_FINDER_IDS.map(f => xEffectiveMap(p, f)));
}
const sameMap = (a, b) => {
  if (a.N !== b.N) return false;
  for (let s = 0; s < a.known.length; s += 1) if (a.known[s] !== b.known[s] || (a.known[s] && a.bits[s] !== b.bits[s])) return false;
  return true;
};
/** 별칭 클래스(§2.10 유도) — 같은 profile 에서 `F_eff`(known ∧ bits) 완전 동일한 finder 집합의 분할(클래스 안 인덱스 오름 · 클래스는 대표 인덱스 오름) */
export function xAliasClasses(profileId) {
  const maps = X_FINDER_IDS.map(f => xEffectiveMap(profileId, f));
  const classes = [];
  const assigned = new Array(maps.length).fill(false);
  for (let i = 0; i < maps.length; i += 1) {
    if (assigned[i]) continue;
    const cls = [i]; assigned[i] = true;
    for (let j = i + 1; j < maps.length; j += 1) if (!assigned[j] && sameMap(maps[i], maps[j])) { cls.push(j); assigned[j] = true; }
    classes.push(cls);
  }
  return classes;
}
/** 사이트 좌표에 `M` 을 작용(`v_s = M·v_f`, 중심화 `v = 2p − (N−1)`) — 정수 siteId → siteId(부호 순열이라 항상 격자 안) */
export function xTransformSite(N, M, siteId) {
  const p = xSiteCoord(N, siteId);
  const s = xSiteFromFaceLocal(p, M, N, [0, 0, 0]);
  return xSiteId(N, s);
}
/**
 * `Stab(F_eff)`(§3.4) — `F_eff∘g = F_eff` 를 known · bits 전부에서 요구하는 g 의 집합(작용 `v_s = M·v_f`). 항등 0 은 항상 포함.
 * 지도 인자를 직접 받을 수도 있어요(합성 팔 — §6.1-39 (ㄴ)): `xStabilizer(map)`.
 */
export function xStabilizer(profileId, finderId) {
  const map = typeof profileId === 'object' && profileId !== null && profileId.known ? profileId : xEffectiveMap(profileId, finderId);
  const { N, known, bits } = map;
  const ids = [], proper = [];
  for (const t of X_TRANSFORMS) {
    let fixed = true;
    for (let s = 0; s < known.length && fixed; s += 1) {
      const img = xTransformSite(N, t.M, s);
      if (known[img] !== known[s] || (known[s] && bits[img] !== bits[s])) fixed = false;
    }
    if (fixed) { ids.push(t.transformId); if (t.parity > 0) proper.push(t.transformId); }
  }
  return { ids, proper };
}

// ───────────────────────────── §2.4 U · 삼중 색인 · §2.5 면 구성 ─────────────────────────────

/** 보편 점등 인덱스 `U(profile, finder)` — 12 모서리 전부에서 실효 레벨 1 인 위치 인덱스의 교집합(정수 오름) */
export function xUniversalLitIndices(profileId, finderId) {
  const map = xEffectiveMap(profileId, finderId);
  const N = map.N;
  let U = null;
  for (const e of xEdges(N)) {
    const lit = new Set(e.sites.map((siteId, i) => (map.known[siteId] && map.bits[siteId] ? i : -1)).filter(i => i >= 0));
    U = U === null ? lit : new Set([...U].filter(i => lit.has(i)));
  }
  return [...U].sort((a, b) => a - b);
}
let TRIPLE_TABLE = null;
/** 유일 `(N, k_B, k_D)` 삼중 색인 표(§2.4) — 21 조합의 `U ∖ {0}` 큰 쪽 3 개에서 순서쌍(대각 포함)을 N 별 dedup, `(N 오름, k_B 오름, k_D 오름)` 열거 */
export function xTripleIndexTable() {
  if (TRIPLE_TABLE) return TRIPLE_TABLE;
  const seen = new Map();
  for (const p of X_PROFILE_IDS) for (const f of X_FINDER_IDS) {
    const N = xProfile(p).N;
    const cand = xUniversalLitIndices(p, f).filter(k => k !== 0).slice(-3);
    for (const kB of cand) for (const kD of cand) seen.set(`${N},${kB},${kD}`, [N, kB, kD]);
  }
  const rows = [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  TRIPLE_TABLE = Object.freeze(rows.map(([N, kB, kD], tripleIndex) => Object.freeze({ tripleIndex, N, kB, kD })));
  return TRIPLE_TABLE;
}
/** 면 평면 구성(§2.5 표) — 면 6 개(축 0,1,2 × 값 {0, N−1}) 각각 `{axis, value, fixed1, fixed0, data}` */
export function xFacePlaneComposition(profileId, finderId) {
  const map = xEffectiveMap(profileId, finderId);
  const N = map.N;
  const faces = [];
  for (const axis of [0, 1, 2]) for (const value of [0, N - 1]) {
    let fixed1 = 0, fixed0 = 0;
    for (let s = 0; s < N ** 3; s += 1) {
      if (xSiteCoord(N, s)[axis] !== value) continue;
      if (map.known[s]) { if (map.bits[s]) fixed1 += 1; else fixed0 += 1; }
    }
    faces.push({ axis, value, fixed1, fixed0, data: N * N - fixed1 - fixed0 });
  }
  return faces;
}

// ───────────────────────────── §2.9 지지/모순 · 미결정 ─────────────────────────────

function assertMap(map) {
  if (!map || !(map.known instanceof Uint8Array) || !(map.bits instanceof Uint8Array) || map.known.length !== map.bits.length) throw new TypeError('map 은 {N, known, bits} 지도여야 해요');
}
/** 매칭 blob 의 정본 siteId 배열(`null` 은 건너뜀)에서 `known=1 ∧ bits=1` → support · `known=1 ∧ bits=0` → conflict. 미매칭·어두운 사이트는 어느 셈에도 안 들어가요. */
export function xCountSupport({ map, siteIds } = {}) {
  assertMap(map);
  if (!Array.isArray(siteIds)) throw new TypeError('siteIds 는 배열이어야 해요');
  let support = 0, conflict = 0;
  for (const s of siteIds) {
    if (s === null) continue;
    if (!Number.isInteger(s) || s < 0 || s >= map.known.length) throw new RangeError(`siteId 범위 밖: ${String(s)}`);
    if (map.known[s]) { if (map.bits[s]) support += 1; else conflict += 1; }
  }
  return { support, conflict };
}
/** `fixedBitUndetermined` — `inFrame` 예측 사이트 중 known=1 인데 `ambiguous-assignment ∨ overlap-predicted` 로 빠진 사이트 수(어두운 사이트는 세지 않아요) */
export function xUndeterminedCount({ map, predictedInFrame, excludedSiteIds } = {}) {
  assertMap(map);
  if (!Array.isArray(predictedInFrame) || !Array.isArray(excludedSiteIds)) throw new TypeError('predictedInFrame · excludedSiteIds 는 배열이어야 해요');
  const inFrame = new Set(predictedInFrame);
  let n = 0;
  for (const s of new Set(excludedSiteIds)) {
    if (!Number.isInteger(s) || s < 0 || s >= map.known.length) throw new RangeError(`siteId 범위 밖: ${String(s)}`);
    if (inFrame.has(s) && map.known[s]) n += 1;
  }
  return n;
}

// ───────────────────────────── §2.9 회계(1,008 표지) ─────────────────────────────

export const X_ADDRESS_TESTS_TOTAL = X_PROFILE_IDS.length * X_FINDER_IDS.length * 48; // 3 × 7 × 48 = 1,008
/** 표지 `(pairIndex, finderIndex, transformId)` ↔ 0…1007 */
export function xLabelIndex(pairIndex, finderIndex, transformId) {
  if (!Number.isInteger(pairIndex) || pairIndex < 0 || pairIndex >= X_PROFILE_IDS.length) throw new RangeError(`pairIndex 범위 밖: ${String(pairIndex)}`);
  if (!Number.isInteger(finderIndex) || finderIndex < 0 || finderIndex >= X_FINDER_IDS.length) throw new RangeError(`finderIndex 범위 밖: ${String(finderIndex)}`);
  xTransformById(transformId);
  return (pairIndex * X_FINDER_IDS.length + finderIndex) * 48 + transformId;
}
export function xLabelFromIndex(i) {
  if (!Number.isInteger(i) || i < 0 || i >= X_ADDRESS_TESTS_TOTAL) throw new RangeError(`표지 색인 범위 밖: ${String(i)}`);
  return [Math.floor(i / (X_FINDER_IDS.length * 48)), Math.floor(i / 48) % X_FINDER_IDS.length, i % 48];
}
const labelSet = (labels, name) => {
  if (!Array.isArray(labels)) throw new TypeError(`${name} 은 표지 배열이어야 해요`);
  const set = new Set();
  for (const l of labels) { if (!Array.isArray(l) || l.length !== 3) throw new TypeError(`${name} 의 표지는 [pairIndex, finderIndex, transformId]`); set.add(xLabelIndex(l[0], l[1], l[2])); }
  return set;
};
/**
 * 회계 항등식(§2.9) — 다섯 집합(평가 · CrossN · Extent · Geometry · unexplored)이 서로소이고 합이 1,008 인지.
 * @param {{evaluatedLabels, rejectedCrossNLabels, rejectedExtentLabels, rejectedGeometryLabels, unexplored}} coverage — 각각 표지 배열
 */
export function xCoverageIdentity(coverage) {
  if (!coverage || typeof coverage !== 'object') throw new TypeError('coverage 객체가 필요해요');
  const sets = [
    ['evaluated', labelSet(coverage.evaluatedLabels ?? [], 'evaluatedLabels')],
    ['rejectedCrossN', labelSet(coverage.rejectedCrossNLabels ?? [], 'rejectedCrossNLabels')],
    ['rejectedExtent', labelSet(coverage.rejectedExtentLabels ?? [], 'rejectedExtentLabels')],
    ['rejectedGeometry', labelSet(coverage.rejectedGeometryLabels ?? [], 'rejectedGeometryLabels')],
    ['unexplored', labelSet(coverage.unexplored ?? [], 'unexplored')],
  ];
  const seen = new Set();
  let disjoint = true;
  for (const [, set] of sets) for (const i of set) { if (seen.has(i)) disjoint = false; seen.add(i); }
  const out = {};
  let sum = 0;
  for (const [name, set] of sets) { out[name] = set.size; sum += set.size; }
  return { ok: disjoint && sum === X_ADDRESS_TESTS_TOTAL, ...out, sum, disjoint };
}
/** `unexplored` 유도 — 평가·명시 거절 표지의 여집합(`[pairIndex, finderIndex, transformId]` 사전순) */
export function xUnexploredDerive({ evaluatedLabels, rejectedLabels } = {}) {
  const done = new Set([...labelSet(evaluatedLabels ?? [], 'evaluatedLabels'), ...labelSet(rejectedLabels ?? [], 'rejectedLabels')]);
  const out = [];
  for (let i = 0; i < X_ADDRESS_TESTS_TOTAL; i += 1) if (!done.has(i)) out.push(xLabelFromIndex(i));
  return out;
}
/** `uniquenessScope` 세 값(§2.9 결정 8) — heuristic-pruned > geometry-pruned > registry-complete, 보고 문구 동봉 */
export const X_UNIQUENESS_PHRASES = Object.freeze({
  'registry-complete': '전체 registry 유일', 'geometry-pruned': '탐색된 N 안에서 registry 유일', 'heuristic-pruned': '탐색 범위 내 유일',
});
export function xUniquenessScope({ rejectedCrossN = 0, rejectedExtent = 0, rejectedGeometry = 0 } = {}) {
  for (const v of [rejectedCrossN, rejectedExtent, rejectedGeometry]) if (!Number.isInteger(v) || v < 0) throw new TypeError('거절 카운터는 0 이상 정수여야 해요');
  if (rejectedCrossN + rejectedExtent > 0) return 'heuristic-pruned';
  if (rejectedGeometry > 0) return 'geometry-pruned';
  return 'registry-complete';
}
