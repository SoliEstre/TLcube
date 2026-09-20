/**
 * Type X 단계 ② — Huber IRLS bounded LM 2 라운드 pose 정련. 외부 의존성 0.
 *
 * 정본: `.agent/lanes/type-x-core-20260919/DESIGN_006_stage2-correspondence-pose.md` v6 봉인판(sha 5aefa00b…),
 * 계약: `stage2-api-contract.md` §2(구현자 B). 이 파일은 계약 §2.1 의 export 표를 그대로 구현하고 값·어휘는 설계를 인용해요.
 *
 * ── 설계 인용 ─────────────────────────────────────────────────────────────────────────────────────────────────
 *   §2.7 B6 — 라운드 1 = 면 사이트 대응만(평면 pose 정련), 라운드 2 = 재매칭 뒤 전 층 `geom` 대응 전체(≤ 192).
 *        강건 손실 필수: Huber(`δ_huber = 1`, gate 단위) + IRLS. 라운드 1 수렴 후 잔차 상위 `trim = 0.10` 트리밍 1 회
 *        (결정적 — 잔차 `round(1e6·d)` 내림, 동률 blobId 내림 순으로 `⌊trim·n⌋` 개 제거) → 라운드 2.
 *        라운드 1 에서 수치 거절된 후보는 라운드 2 를 실행하지 않아요(`runs:1`).
 *        `residualSummary` 의 계산 시점(v6 결정 6): `rmsPx` · `p95Px` · `maxPx` 는 §5.3 직렬화 반올림(`round(1e6·x)/1e6`)을
 *        거친 `R`·`t` 로 `geom` 대응을 다시 투영해 잰 값이고, 그 값도 다시 `round(1e6·x)/1e6` 로 실어요.
 *   §4.2 bounded LM — 상태 `(ω ∈ so(3), t)` 6, 갱신 `R ← exp([ω]×)·R`(Rodrigues, frozen `xExpSO3`). 잔차
 *        `(u_pred − u_obs, v_pred − v_obs)/g`, Huber(δ = 1) IRLS, 해석적 Jacobian `∂π/∂X_c · [−[X_c]×, I]`.
 *        6×6 정규방정식 Cholesky(피벗), `λ0 = 1e−3`, 실패 ×10 / 성공 ÷3. 종료: `iter ≥ 20` ∨ `|δ| < 1e−9` ∨ 비용 감소 < `1e−12·비용`.
 *        거절: 어떤 대응의 `Z ≤ 1e−6` · 비유한 · Cholesky 피벗비 > `1e12` · 20 iter 뒤 `|δ| > 1e−3` · SO(3) 검사 실패.
 *        대응 < 6 → `lm-underdetermined`. 출력 직전 `R` 재정규화는 Gram–Schmidt(frozen `xOrthonormalizeRotation`),
 *        det 부호 검사 후 음수면 «고치지 않고» 거절.
 *   §4.3 문턱 — `δ_huber 1` · `trim 0.10` · cond 상한 `1e12` · 깊이 하한 `1e−6` · SO(3) 허용 `1e−6`(② 내부 배정밀도 `R`).
 *   §3.3 사유 어휘 — `lm-underdetermined` · `lm-nonconverged` · `lm-ill-conditioned` · `lm-nonpositive-depth` · `rotation-not-so3`.
 *        비유한 잔차·갱신은 설계 어휘에 전용 토큰이 없어 `lm-ill-conditioned` 로 접어요(계약 결정 §9-6).
 *   §5.3 실수 포맷 — `round(1e6·x)/1e6`(계약 결정 §9-2: `Math.round(1e6·x)/1e6`, `−0` 은 `+0` 으로).
 *   §6.1-47 투영 규약 — `xProjectPoint` 는 frozen `xProjectSites` 와 같은 식(`X_c = R·P + t`, `u = fx·X/Z + cx`, 반픽셀 없음).
 *
 * ── 오류 통로(계약 결정 §9-1) ──────────────────────────────────────────────────────────────────────────────────
 *   형식 위반(camera · 배열 길이 불일치 · R0/t0 길이 · opts 의 알 수 없는 키)만 throw(TypeError/RangeError) — 내부 API 라
 *   잘못된 호출이 곧 버그예요. 수치 거절은 `{ok:false, reason}` 으로 나가요.
 *
 * ── 이 파일이 정하지 않은 자리(설계·계약이 침묵한 것 — 보고서 designDeviations/limitations 참조) ───────────────────
 *   · σ_i 와 g 의 결합: 잔차 벡터는 설계대로 gate 단위 `Δ/g` 이고, Huber 폭 δ 도 gate 단위로 재요. blob 별 `σ_i` 는
 *     IRLS 가중에 `1/σ_i²` 로 곱해요(σ 가 전부 같으면 상수배라 해·수렴 판정에 영향 없음).
 *   · «Cholesky 피벗비» = 대칭 피벗 Cholesky(LDLᵀ 꼴)의 대각 피벗 `d_k` 의 max/min — Jacobi 스케일링(`D^−½·A·D^−½`)한
 *     **감쇠 전** 정규행렬에 대해 재요(감쇠 λ·diag 를 더한 뒤에는 특이 행렬도 피벗비가 작아져 화면 공선 대응을 못 잡아요).
 *   · «iter» = 시도한 스텝 수(채택·거부 모두 셈) — `maxIter 20` 이 곧 정규방정식 풀이 횟수 상한이라 유계예요.
 *   · Gram–Schmidt: frozen `xOrthonormalizeRotation` 은 «행» 기준 3 벡터 GS 예요(설계 §4.2 «3열» 표기와 다름 — 재구현 금지
 *     계약 §2.3 이 우선). det 부호 검사는 GS 앞의 누적 `R` 에 대해 해요(GS 뒤엔 구성상 항상 +1 이라 검사가 무의미해요).
 */
import { assertXCamera, mat3Mul, mat3Apply } from './x-project.js';
import { xExpSO3, xIsRotation, xOrthonormalizeRotation } from './x-p3p.js';

/** 계약 §2.1 · 설계 §4.2 · §4.3 의 LM 기본값(동결) */
export const X_LM_DEFAULTS = Object.freeze({
  maxIter: 20, lambda0: 1e-3, lambdaUp: 10, lambdaDown: 3, stepTol: 1e-9, costRelTol: 1e-12,
  depthMin: 1e-6, condMax: 1e12, finalStepMax: 1e-3, so3Tol: 1e-6, huberDelta: 1, trim: 0.10, minCorrespondences: 6,
});

const det3 = R => R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
const isArr = (a, n) => Array.isArray(a) && a.length === n;
const finiteArr = a => { for (let i = 0; i < a.length; i += 1) if (!Number.isFinite(a[i])) return false; return true; };

/** §5.3 실수 포맷 — `round(1e6·x)/1e6`, `−0` 은 `+0`(계약 §9-2). 비유한은 그대로 돌려요(직렬화 `null` 처리는 C 의 몫). */
export function xRoundSerial(x) {
  if (!Number.isFinite(x)) return x;
  return Math.round(1e6 * x) / 1e6 + 0;
}
export function xRoundSerialArray(a) {
  if (!Array.isArray(a)) throw new TypeError('xRoundSerialArray: 배열이어야 해요');
  return a.map(xRoundSerial);
}

/**
 * 한 점 투영 — frozen `xProjectSites` 와 같은 식(§6.1-47): `X_c = R·P + t`, `u = fx·X/Z + cx`, `v = fy·Y/Z + cy`,
 * `inFront = Z > 1e−9`(정본과 같은 문턱), 뒤면 `u`·`v` 는 `NaN`. 반픽셀 없음.
 * @returns {{u:number, v:number, z:number, inFront:boolean}}
 */
export function xProjectPoint(R, t, P, camera) {
  assertXCamera(camera);
  if (!isArr(R, 9) || !isArr(t, 3) || !isArr(P, 3)) throw new TypeError('xProjectPoint: R(9)·t(3)·P(3) 이어야 해요');
  const c = mat3Apply(R, P);
  const X = c[0] + t[0], Y = c[1] + t[1], Z = c[2] + t[2];
  const inFront = Z > 1e-9;
  return { u: inFront ? camera.fx * X / Z + camera.cx : NaN, v: inFront ? camera.fy * Y / Z + camera.cy : NaN, z: Z, inFront };
}

/** 형식 검사 공용 — points/pixels(/sigmas) 길이 일치 · R(9) · t(3) · camera. 위반은 throw(계약 §9-1). */
function assertCorrespondences(points, pixels, sigmas, where) {
  if (!Array.isArray(points) || !Array.isArray(pixels) || points.length !== pixels.length) throw new TypeError(`${where}: points·pixels 는 같은 길이의 배열이어야 해요`);
  if (sigmas !== undefined && (!Array.isArray(sigmas) || sigmas.length !== points.length)) throw new TypeError(`${where}: sigmas 는 points 와 같은 길이의 배열이어야 해요`);
  for (let i = 0; i < points.length; i += 1) {
    if (!isArr(points[i], 3)) throw new TypeError(`${where}: points[${i}] 는 길이 3 배열이어야 해요`);
    if (!Array.isArray(pixels[i]) || pixels[i].length < 2) throw new TypeError(`${where}: pixels[${i}] 는 [u, v] 여야 해요`);
  }
}
function assertPose(R, t, where) {
  if (!isArr(R, 9) || !isArr(t, 3)) throw new TypeError(`${where}: R(9)·t(3) 이어야 해요`);
}

/**
 * 잔차 통계(§1.4 `residualSummary`) — 반올림 여부는 호출자 몫. `p95Px` = 정렬 뒤 index `max(0, ⌈0.95·n⌉ − 1)`(계약 §9-4, 보간 없음).
 * 어떤 대응이 카메라 뒤(비유한 잔차)면 세 값은 `NaN`. `count` 는 대응 수.
 * @returns {{count:number, rmsPx:number, p95Px:number, maxPx:number}}
 */
export function xResidualStats({ R, t, points, pixels, camera } = {}) {
  assertXCamera(camera);
  assertPose(R, t, 'xResidualStats');
  assertCorrespondences(points, pixels, undefined, 'xResidualStats');
  const n = points.length;
  if (n === 0) return { count: 0, rmsPx: NaN, p95Px: NaN, maxPx: NaN };
  const d = new Array(n);
  let sumSq = 0, allFinite = true;
  for (let i = 0; i < n; i += 1) {
    const p = xProjectPoint(R, t, points[i], camera);
    const du = p.u - pixels[i][0], dv = p.v - pixels[i][1];
    d[i] = Math.hypot(du, dv);
    if (!Number.isFinite(d[i])) allFinite = false;
    sumSq += d[i] * d[i];
  }
  if (!allFinite) return { count: n, rmsPx: NaN, p95Px: NaN, maxPx: NaN };
  const sorted = d.slice().sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(0.95 * n) - 1);
  return { count: n, rmsPx: Math.sqrt(sumSq / n), p95Px: sorted[p95Index], maxPx: sorted[n - 1] };
}

/** opts 병합 — 알 수 없는 키·비유한 값은 형식 위반(throw). */
function mergeOpts(opts) {
  if (opts === undefined || opts === null) return { ...X_LM_DEFAULTS };
  if (typeof opts !== 'object' || Array.isArray(opts)) throw new TypeError('opts 는 plain object 여야 해요');
  const out = { ...X_LM_DEFAULTS };
  for (const k of Object.keys(opts)) {
    if (!(k in X_LM_DEFAULTS)) throw new TypeError(`opts 에 알 수 없는 키: ${k}`);
    const v = opts[k];
    // huberDelta 는 +Infinity 허용(순수 최소제곱 대조군 — §6.1-8), 나머지는 유한
    if (typeof v !== 'number' || Number.isNaN(v) || (k !== 'huberDelta' && !Number.isFinite(v))) throw new TypeError(`opts.${k} 는 수여야 해요`);
    out[k] = v;
  }
  if (!(Number.isInteger(out.maxIter) && out.maxIter >= 1)) throw new TypeError('opts.maxIter 는 1 이상 정수여야 해요');
  if (!(Number.isInteger(out.minCorrespondences) && out.minCorrespondences >= 1)) throw new TypeError('opts.minCorrespondences 는 1 이상 정수여야 해요');
  if (!(out.trim >= 0 && out.trim < 1)) throw new TypeError('opts.trim 은 [0, 1) 이어야 해요');
  for (const k of ['lambda0', 'lambdaUp', 'lambdaDown', 'stepTol', 'costRelTol', 'depthMin', 'condMax', 'finalStepMax', 'so3Tol', 'huberDelta']) {
    if (!(out[k] > 0)) throw new TypeError(`opts.${k} 는 양수여야 해요`);
  }
  return out;
}

/**
 * 대칭 피벗 Cholesky(LDLᵀ 꼴) — 각 단계에서 남은 대각 최대를 피벗으로 골라요. 피벗 `d_k ≤ 0` 또는 비유한이면 null.
 * @returns {{d:number[], L:number[], perm:number[]}|null} `L` 은 단위 하삼각(행 우선 n×n, 치환된 순서), `d` 는 피벗.
 */
function choleskyPivoted(A, n) {
  const M = A.slice();
  const perm = [...Array(n).keys()];
  const L = new Array(n * n).fill(0);
  const d = new Array(n).fill(0);
  for (let k = 0; k < n; k += 1) {
    // 피벗 선택: 남은 대각 최대
    let best = k;
    for (let j = k + 1; j < n; j += 1) if (M[j * n + j] > M[best * n + best]) best = j;
    if (best !== k) {
      for (let j = 0; j < n; j += 1) { const tmp = M[k * n + j]; M[k * n + j] = M[best * n + j]; M[best * n + j] = tmp; }
      for (let i = 0; i < n; i += 1) { const tmp = M[i * n + k]; M[i * n + k] = M[i * n + best]; M[i * n + best] = tmp; }
      for (let j = 0; j < n; j += 1) { const tmp = L[k * n + j]; L[k * n + j] = L[best * n + j]; L[best * n + j] = tmp; }
      const tp = perm[k]; perm[k] = perm[best]; perm[best] = tp;
    }
    const piv = M[k * n + k];
    if (!(piv > 0) || !Number.isFinite(piv)) return null;
    d[k] = piv;
    L[k * n + k] = 1;
    for (let i = k + 1; i < n; i += 1) {
      const l = M[i * n + k] / piv;
      L[i * n + k] = l;
      for (let j = k + 1; j < n; j += 1) M[i * n + j] -= l * M[k * n + j];
    }
  }
  return { d, L, perm };
}

/** 위 분해로 A·x = b 풀기(치환 포함). */
function choleskySolve(fac, b, n) {
  const { d, L, perm } = fac;
  const y = new Array(n);
  for (let i = 0; i < n; i += 1) {
    let s = b[perm[i]];
    for (let j = 0; j < i; j += 1) s -= L[i * n + j] * y[j];
    y[i] = s;
  }
  for (let i = 0; i < n; i += 1) y[i] /= d[i];
  const z = new Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = y[i];
    for (let j = i + 1; j < n; j += 1) s -= L[j * n + i] * z[j];
    z[i] = s;
  }
  const x = new Array(n);
  for (let i = 0; i < n; i += 1) x[perm[i]] = z[i];
  return x;
}

/**
 * Huber IRLS bounded LM — 한 라운드(수렴까지). 설계 §4.2 · §2.7 · 계약 §2.1.
 * @param {{points:number[][], pixels:number[][], sigmas:number[], camera:object, R0:number[], t0:number[], gate:number}} input
 *   `points` 는 pitch 단위 세계점(면-국소 또는 중심 기준 — 이 모듈은 단위를 모른 채 그대로 써요), `sigmas` 는 blob 별 `σ_loc`(px),
 *   `gate` 는 잔차를 나누는 `g`(px).
 * @param {object} [opts] `X_LM_DEFAULTS` 의 부분 override(알 수 없는 키는 throw)
 * @returns {{ok:boolean, reason:string, R:number[], t:number[], iterations:number, cost:number, converged:boolean, weights:number[], lambda:number}}
 *   `weights` 는 최종 pose 에서의 대응별 Huber 인자(`1` 또는 `δ/|r|`, σ 가중 제외). `cost` 는 `Σ ρ_δ(|Δ_i|/g)/σ_i²`(Huber 손실).
 */
export function xHuberIrlsLM({ points, pixels, sigmas, camera, R0, t0, gate } = {}, opts = undefined) {
  assertXCamera(camera);
  if (!Array.isArray(sigmas)) throw new TypeError('xHuberIrlsLM: sigmas 배열이 필요해요');
  assertCorrespondences(points, pixels, sigmas, 'xHuberIrlsLM');
  assertPose(R0, t0, 'xHuberIrlsLM');
  if (typeof gate !== 'number' || !(gate > 0) || !Number.isFinite(gate)) throw new RangeError('xHuberIrlsLM: gate 는 유한 양수여야 해요');
  const o = mergeOpts(opts);
  const n = points.length;
  const done = (ok, reason, R, t, iterations, cost, converged, weights, lambda) => ({ ok, reason, R, t, iterations, cost, converged, weights, lambda });
  if (n < o.minCorrespondences) return done(false, 'lm-underdetermined', R0.slice(), t0.slice(), 0, NaN, false, [], o.lambda0);
  // 비유한 입력 → lm-ill-conditioned(계약 §9-6)
  if (!finiteArr(R0) || !finiteArr(t0) || !finiteArr(sigmas)) return done(false, 'lm-ill-conditioned', R0.slice(), t0.slice(), 0, NaN, false, [], o.lambda0);
  for (let i = 0; i < n; i += 1) {
    if (!finiteArr(points[i]) || !Number.isFinite(pixels[i][0]) || !Number.isFinite(pixels[i][1]) || !(sigmas[i] > 0)) return done(false, 'lm-ill-conditioned', R0.slice(), t0.slice(), 0, NaN, false, [], o.lambda0);
  }
  // 초기 R0 는 SO(3) 여야 해요 — det < 0 은 고치지 않고 거절(§4.2)
  if (det3(R0) < 0 || !xIsRotation(R0, o.so3Tol)) return done(false, 'rotation-not-so3', R0.slice(), t0.slice(), 0, NaN, false, [], o.lambda0);

  const { fx, fy, cx, cy } = camera;
  const invG = 1 / gate;
  const wSigma = sigmas.map(s => 1 / (s * s));
  const delta = o.huberDelta;
  /** 현재 pose 평가 — 어떤 Z ≤ depthMin 이면 {fail:'depth'}, 비유한이면 {fail:'nonfinite'} */
  const evaluate = (R, t) => {
    let cost = 0;
    const rows = new Array(n), wh = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const c = mat3Apply(R, points[i]);
      const X = c[0] + t[0], Y = c[1] + t[1], Z = c[2] + t[2];
      if (!(Z > o.depthMin)) return { fail: Number.isFinite(Z) ? 'depth' : 'nonfinite' };
      const ru = (fx * X / Z + cx - pixels[i][0]) * invG, rv = (fy * Y / Z + cy - pixels[i][1]) * invG;
      const r = Math.hypot(ru, rv);
      if (!Number.isFinite(r)) return { fail: 'nonfinite' };
      const w = r <= delta ? 1 : delta / r;
      const rho = r <= delta ? 0.5 * r * r : delta * (r - 0.5 * delta);
      cost += wSigma[i] * rho;
      rows[i] = [X, Y, Z, ru, rv];
      wh[i] = w;
    }
    if (!Number.isFinite(cost)) return { fail: 'nonfinite' };
    return { cost, rows, wh };
  };
  let R = R0.slice(), t = t0.slice();
  let cur = evaluate(R, t);
  if (cur.fail) return done(false, cur.fail === 'depth' ? 'lm-nonpositive-depth' : 'lm-ill-conditioned', R, t, 0, NaN, false, [], o.lambda0);

  /** 정규방정식 조립: A = Σ w Jᵀ J, g = Σ w Jᵀ r (r = 잔차 gate 단위, J = ∂r/∂[δω, δt]) */
  const assemble = () => {
    const A = new Array(36).fill(0), g = new Array(6).fill(0);
    for (let i = 0; i < n; i += 1) {
      const [X, Y, Z, ru, rv] = cur.rows[i];
      const w = cur.wh[i] * wSigma[i];
      const q = [X - t[0], Y - t[1], Z - t[2]]; // R·P
      // ∂X_c/∂[δω, δt] (3×6): 열 0..2 = −[q]×, 열 3..5 = I  (X_c' ≈ X_c + δω × q + δt)
      const dc = [
        [0, q[2], -q[1], 1, 0, 0],
        [-q[2], 0, q[0], 0, 1, 0],
        [q[1], -q[0], 0, 0, 0, 1],
      ];
      const iz = 1 / Z;
      const ju = new Array(6), jv = new Array(6);
      for (let k = 0; k < 6; k += 1) {
        ju[k] = fx * invG * (dc[0][k] * iz - X * iz * iz * dc[2][k]);
        jv[k] = fy * invG * (dc[1][k] * iz - Y * iz * iz * dc[2][k]);
      }
      for (let r = 0; r < 6; r += 1) {
        g[r] += w * (ju[r] * ru + jv[r] * rv);
        for (let k = 0; k < 6; k += 1) A[r * 6 + k] += w * (ju[r] * ju[k] + jv[r] * jv[k]);
      }
    }
    return { A, g };
  };

  let lambda = o.lambda0, iterations = 0, lastStep = Infinity, converged = false;
  while (iterations < o.maxIter) {
    iterations += 1;
    const { A, g } = assemble();
    // 조건수 검사 — Jacobi 스케일링한 감쇠 전 A 의 피벗비(파일 머리 §정하지 않은 자리)
    const sc = new Array(6);
    for (let i = 0; i < 6; i += 1) {
      if (!(A[i * 6 + i] > 0) || !Number.isFinite(A[i * 6 + i])) return done(false, 'lm-ill-conditioned', R, t, iterations, cur.cost, false, cur.wh, lambda);
      sc[i] = 1 / Math.sqrt(A[i * 6 + i]);
    }
    const As = new Array(36);
    for (let i = 0; i < 6; i += 1) for (let j = 0; j < 6; j += 1) As[i * 6 + j] = A[i * 6 + j] * sc[i] * sc[j];
    const fac0 = choleskyPivoted(As, 6);
    if (!fac0) return done(false, 'lm-ill-conditioned', R, t, iterations, cur.cost, false, cur.wh, lambda);
    let dMax = -Infinity, dMin = Infinity;
    for (const dk of fac0.d) { if (dk > dMax) dMax = dk; if (dk < dMin) dMin = dk; }
    if (!(dMax / dMin <= o.condMax)) return done(false, 'lm-ill-conditioned', R, t, iterations, cur.cost, false, cur.wh, lambda);
    // 감쇠(Marquardt: λ·diag) 뒤 스케일 공간에서 풀고 되돌려요
    const Ad = As.slice();
    for (let i = 0; i < 6; i += 1) Ad[i * 6 + i] += lambda;
    const gs = new Array(6);
    for (let i = 0; i < 6; i += 1) gs[i] = -g[i] * sc[i];
    const fac = choleskyPivoted(Ad, 6);
    if (!fac) return done(false, 'lm-ill-conditioned', R, t, iterations, cur.cost, false, cur.wh, lambda);
    const ds = choleskySolve(fac, gs, 6);
    const step = new Array(6);
    for (let i = 0; i < 6; i += 1) step[i] = ds[i] * sc[i];
    if (!finiteArr(step)) return done(false, 'lm-ill-conditioned', R, t, iterations, cur.cost, false, cur.wh, lambda);
    const stepNorm = Math.hypot(...step);
    lastStep = stepNorm;
    const Rn = mat3Mul(xExpSO3([step[0], step[1], step[2]]), R);
    const tn = [t[0] + step[3], t[1] + step[4], t[2] + step[5]];
    const nxt = evaluate(Rn, tn);
    if (!nxt.fail && nxt.cost <= cur.cost) {
      const prev = cur.cost;
      R = Rn; t = tn; cur = nxt;
      lambda /= o.lambdaDown;
      if (stepNorm < o.stepTol || prev - cur.cost < o.costRelTol * prev) { converged = true; break; }
    } else {
      // 거부: Z ≤ depthMin · 비유한 · 비용 증가 → λ 상승(스텝 거부, 반복은 소비)
      if (nxt.fail === 'nonfinite') return done(false, 'lm-ill-conditioned', R, t, iterations, cur.cost, false, cur.wh, lambda);
      lambda *= o.lambdaUp;
      if (!Number.isFinite(lambda)) return done(false, 'lm-ill-conditioned', R, t, iterations, cur.cost, false, cur.wh, lambda);
      if (stepNorm < o.stepTol) { converged = true; break; } // 감쇠 스텝이 stepTol 밑인데도 개선 없음 = 수치 극소
    }
  }
  if (!converged && !(lastStep <= o.finalStepMax)) return done(false, 'lm-nonconverged', R, t, iterations, cur.cost, false, cur.wh, lambda);
  // 출력 직전: det 부호 검사(음수는 고치지 않고 거절) → Gram–Schmidt(frozen) → SO(3) 검사
  if (det3(R) < 0) return done(false, 'rotation-not-so3', R, t, iterations, cur.cost, converged, cur.wh, lambda);
  const Rg = xOrthonormalizeRotation(R);
  if (!Rg || !xIsRotation(Rg, o.so3Tol)) return done(false, 'rotation-not-so3', R, t, iterations, cur.cost, converged, cur.wh, lambda);
  return done(true, 'ok', Rg, t, iterations, cur.cost, converged, cur.wh, lambda);
}

/**
 * 라운드 1 뒤 잔차 트리밍(§2.7) — 제거 = 잔차 `round(1e6·d)`(px) 내림, 동률 `ids` 내림 순 앞 `⌊trim·n⌋` 개. 비유한 잔차는 +∞ 로 셈.
 * @returns {number[]} 남는 index(오름). `ids` 를 안 주면 index 를 id 로 써요.
 */
export function xTrimByResidual({ points, pixels, sigmas, ids, R, t, camera, trim = X_LM_DEFAULTS.trim } = {}) {
  assertXCamera(camera);
  assertPose(R, t, 'xTrimByResidual');
  assertCorrespondences(points, pixels, sigmas, 'xTrimByResidual');
  if (ids !== undefined && (!Array.isArray(ids) || ids.length !== points.length)) throw new TypeError('xTrimByResidual: ids 는 points 와 같은 길이여야 해요');
  if (!(trim >= 0 && trim < 1)) throw new RangeError('xTrimByResidual: trim 은 [0, 1) 이어야 해요');
  const n = points.length;
  const k = Math.floor(trim * n);
  const idOf = i => (ids ? ids[i] : i);
  const keyed = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = xProjectPoint(R, t, points[i], camera);
    const d = Math.hypot(p.u - pixels[i][0], p.v - pixels[i][1]);
    keyed[i] = { i, q: Number.isFinite(d) ? Math.round(1e6 * d) : Infinity, id: idOf(i) };
  }
  keyed.sort((a, b) => (b.q - a.q) || (b.id - a.id) || (a.i - b.i));
  const removed = new Set(keyed.slice(0, k).map(e => e.i));
  const kept = [];
  for (let i = 0; i < n; i += 1) if (!removed.has(i)) kept.push(i);
  return kept;
}

/**
 * 2 라운드 정련(§2.7 · 계약 §2.4): 라운드 1(면 대응) → 트리밍 → 라운드 2(전 층 `geom` 대응) → 반올림 `R`·`t` 로 `residualSummary` 재계산.
 * @param {{round1:{points,pixels,sigmas,ids}, round2:object|function, camera, R0, t0, gate}} input
 *   `round2` 는 대응 객체이거나 **함수** `({R, t, trimmedIds, keptIndices}) => {points, pixels, sigmas, ids}` — C 가 트리밍된 id 를
 *   빼고 재매칭한 뒤 넘길 수 있게 한 통로(계약 §9-5 «C 가 trimmedIds 를 받아 재매칭 전에 뺌» 을 한 호출 안에서 가능하게).
 * @returns {{ok, reason, runs:1|2, R, t, RRounded, tRounded, residualSummary, trimmedIds, round1, round2}}
 */
export function xPoseRefine2Rounds({ round1, round2, camera, R0, t0, gate } = {}, opts = undefined) {
  if (!round1 || typeof round1 !== 'object') throw new TypeError('xPoseRefine2Rounds: round1 은 {points, pixels, sigmas, ids} 여야 해요');
  if (!(round2 && (typeof round2 === 'object' || typeof round2 === 'function'))) throw new TypeError('xPoseRefine2Rounds: round2 는 대응 객체 또는 함수여야 해요');
  const o = mergeOpts(opts);
  const brief = r => ({ iterations: r.iterations, converged: r.converged, cost: r.cost, reason: r.reason });
  const r1 = xHuberIrlsLM({ points: round1.points, pixels: round1.pixels, sigmas: round1.sigmas, camera, R0, t0, gate }, o);
  if (!r1.ok) {
    return { ok: false, reason: r1.reason, runs: 1, R: r1.R, t: r1.t, RRounded: null, tRounded: null, residualSummary: null, trimmedIds: [], round1: brief(r1), round2: null };
  }
  const kept = xTrimByResidual({ points: round1.points, pixels: round1.pixels, sigmas: round1.sigmas, ids: round1.ids, R: r1.R, t: r1.t, camera, trim: o.trim });
  const keptSet = new Set(kept);
  const trimmedIds = [];
  for (let i = 0; i < round1.points.length; i += 1) if (!keptSet.has(i)) trimmedIds.push(round1.ids ? round1.ids[i] : i);
  trimmedIds.sort((a, b) => a - b);
  const r2in = typeof round2 === 'function' ? round2({ R: r1.R.slice(), t: r1.t.slice(), trimmedIds: trimmedIds.slice(), keptIndices: kept.slice() }) : round2;
  if (!r2in || typeof r2in !== 'object') throw new TypeError('xPoseRefine2Rounds: round2 대응 객체가 아니에요');
  const r2 = xHuberIrlsLM({ points: r2in.points, pixels: r2in.pixels, sigmas: r2in.sigmas, camera, R0: r1.R, t0: r1.t, gate }, o);
  if (!r2.ok) {
    return { ok: false, reason: r2.reason, runs: 2, R: r2.R, t: r2.t, RRounded: null, tRounded: null, residualSummary: null, trimmedIds, round1: brief(r1), round2: brief(r2) };
  }
  const RRounded = xRoundSerialArray(r2.R), tRounded = xRoundSerialArray(r2.t);
  const s = xResidualStats({ R: RRounded, t: tRounded, points: r2in.points, pixels: r2in.pixels, camera });
  const residualSummary = { count: s.count, rmsPx: xRoundSerial(s.rmsPx), p95Px: xRoundSerial(s.p95Px), maxPx: xRoundSerial(s.maxPx) };
  return { ok: true, reason: 'ok', runs: 2, R: r2.R, t: r2.t, RRounded, tRounded, residualSummary, trimmedIds, round1: brief(r1), round2: brief(r2) };
}
