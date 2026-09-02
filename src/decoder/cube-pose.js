/**
 * cube-pose.js — 큐브 강체 포즈 7파라미터 Levenberg–Marquardt.
 *
 * 모델 (미지수 7): yaw · pitch · roll · invDist · ppu · offX · offY.
 * 전방식은 `y3d-viewer.js` 의 cubePoint · orbitPoint · projectPoint · cubeCenter
 * 그대로다. 사본을 두지 않는다. invDist 는 렌더러 노브 t 의
 * `perspectiveInvDist(t, (n/2)·√3)` 과 같은 양이다.
 *
 * 관측 n개 → 식 2n, 미지수 7, 중복도 2n−7.
 *   n ≤ 3  underdetermined (풀 수 없음)
 *   n  = 4  중복도 1. in-sample 만 낸다. LOO 는 3점 적합(중복도 −1)이라
 *           정의되지 않으므로 perObsCells 는 전부 null.
 *   n  = 5  LOO 는 4점 적합(중복도 1). 검출 6/6 pose-2deg 에서 하나를 빼면
 *           중앙 탈락 LOO 0.31~0.36셀, 외곽 탈락 LOO 2.81~3.16셀.
 *   n ≥ 6  LOO 중복도 ≥ 5. 정상 3D 행(t≤0.2 · 자세 ≤2°)에서 이 레인 실측
 *           LOO 0.017~0.078셀.
 *
 * **n≤5 에는 잔차 게이트가 없다.** n=6 in-sample 정상 최대 0.0413 vs 2셀
 * 대조군 최소 0.6178 (간격 +0.577) · 0.5셀 +0.122. n=5 간격 −0.036 ·
 * n=4 −0.0458 — 2셀 어긋난 집합이 정상보다 in-sample 이 240배 작은 경우가
 * 38건. n=5 는 LOO 도 간격 −3.752. 부분 결과는 거절하거나 시간적 prior 로
 * 다루고, 잔차로 판정하지 마라.
 *
 * 내보내는 invDist 는 항상 ≥ 0 이다. 렌더러 `projectPoint` 가 invDist ≤ 0 을
 * isoProject 로 접으므로, LM 이 그 평탄 구간으로 들어가도 대표값은 0.
 * **상한은 접지 않는다.** 렌더러 `buildOrbitMesh`(y3d-viewer.js:298)는
 * `[0, BETA_MAX/radius3d]` = `[0, 7.69e-2]`(n=13) 로 두 겹 클램프하는데
 * 이 모듈은 상한이 없어 `ok:true` 로 8.4e+2 를 내보낼 수 있다 (그 적합은
 * 잔차 2.3셀이라 residual 이 잡는다).
 *
 * `(roll, ppu) ≡ (roll+π, −ppu)` — 내보낸 `ppu` 는 **부호 정규화되지 않는다**.
 * 180° 뒤집힌 배치는 `roll≈0` · `ppu<0` 으로 «완벽 적합»(in-sample 6.16e-14)
 * 하고 잔차가 둘을 못 가른다. 면내 방향을 읽는 소비자는 `Math.sign(ppu)` 를
 * 함께 봐야 한다. 부호를 접으려면 offX/offY 도 투영중심 기준으로 반사해야
 * 해서 한 줄이 아니다 (실측: 반환 220/191 ↔ 정규화 221.22/191.00).
 *
 * 초기화는 blind 가 기본이다: 자세 0 · invDist 0, ppu/offX/offY 는 정면
 * 정준 투영 대비 유사변환 최소제곱. `options.initial` 이 있으면 덮는다.
 *
 * 이 모듈은 미배선이다. 스캐너·R2·rectify-anchors 를 import 하지 않는다.
 * 실패는 예외가 아니라 `{ok:false, reason}`. 난수 없음.
 *
 * `ok` 는 **수치 수렴만** 뜻한다. 앵커 하나를 100셀 옮겨도 `ok:true`·
 * `converged:true` 다 (LOO 100.03 · in-sample 28.90). 무작위 좌표도
 * `ok:true`(LOO 46.35). 완전 퇴화(6점 동일좌표)도 `ok:true`(ppu=0).
 * **채택 판정은 `residual` 로 하라 — `ok` 로 하지 마라.**
 *
 * @module decoder/cube-pose
 */

import {
  cubeCenter,
  cubePoint,
  orbitPoint,
  perspectiveInvDist,
  projectPoint,
} from '../y3d-viewer.js';

const FACES = Object.freeze({ T: true, L: true, R: true });

/** 7파라미터 순서. Jacobian 열 순서이기도 하다. */
const PARAM_KEYS = Object.freeze([
  'yaw', 'pitch', 'roll', 'invDist', 'ppu', 'offX', 'offY',
]);

/**
 * 중앙차분 보폭. 씨앗 `pose-lm-loo.mjs` 와 같다. 각도(rad)·invDist·픽셀
 * 스케일이 자릿수가 달라 한 보폭을 쓰면 Jacobian 열이 죽는다.
 */
const STEP = Object.freeze({
  yaw: 1e-5,
  pitch: 1e-5,
  roll: 1e-5,
  invDist: 1e-6,
  ppu: 1e-4,
  offX: 1e-3,
  offY: 1e-3,
});

/** 관측 4개 = 식 8, 미지수 7. 그 아래는 부족결정. */
const MIN_OBSERVATIONS = 4;

/** LOO 를 정의하는 최소 관측 수. n=4 의 LOO 는 3점이라 부족결정. */
const MIN_LOO_OBSERVATIONS = 5;

const MAX_ITER_DEFAULT = 200;
const LAMBDA0 = 1e-3;
const LAMBDA_MAX = 1e6;
/** 상대 개선량 (cost−c)/cost 하한. */
const REL_COST_STOP = 1e-12;
/** 절대 cost (px²) 하한. REL_COST_STOP 과 값은 같으나 비교 대상이 상대량이 아니다. */
const COST_ABS_STOP = 1e-12;
/** 절대 cost 를 0 으로 치는 하한. */
const COST_ZERO = 1e-20;
const PIVOT_MIN = 1e-18;
const DIAG_RIDGE = 1e-12;

/**
 * 기본 layout. size=1 이면 ppu 가 렌더러의 pixelsPerUnit 과 같은 단위다.
 * origin 은 0 — 카메라 프레임에는 렌더러 margin 이 없다. 합성 래스터의
 * 참값 회복을 할 때는 `options.layout` 에 `layoutForCube(n,{size:1,margin:4})`
 * 를 넘겨 렌더러와 같은 원점을 쓴다.
 */
const DEFAULT_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });

function emptyResidual(length) {
  return {
    perObsCells: Array.from({ length }, () => null),
    maxCells: null,
    rmsCells: null,
    inSampleMaxCells: null,
  };
}

function failResult(reason, length) {
  return {
    ok: false,
    reason,
    params: null,
    residual: emptyResidual(length),
    iterations: 0,
    converged: false,
  };
}

function cloneParams(params) {
  return {
    yaw: params.yaw,
    pitch: params.pitch,
    roll: params.roll,
    invDist: params.invDist,
    ppu: params.ppu,
    offX: params.offX,
    offY: params.offY,
  };
}

/**
 * 렌더러 `projectPoint` 는 invDist ≤ 0 을 isoProject 로 접는다.
 * 내부 LM 은 그 평탄 구간으로 살짝 들어갈 수 있으나, 내보내는 값은
 * 같은 전방식의 대표값 0 이다.
 */
function publicParams(params) {
  const out = cloneParams(params);
  if (!(out.invDist > 0)) out.invDist = 0;
  return out;
}

function paramsFinite(params) {
  if (!params) return false;
  for (let i = 0; i < PARAM_KEYS.length; i += 1) {
    if (!Number.isFinite(params[PARAM_KEYS[i]])) return false;
  }
  return true;
}

/**
 * 렌더러 `y3d-viewer.js:289` 와 같은 식 — 바뀌면 같이 바꾼다.
 * 바로 옆 290~291행 주석이 UI 가 이 식을 사본으로 갖지 않게 막으려 한다.
 * 여기서는 blindInit 의 t=0 씨앗에만 쓴다.
 */
function radius3d(n) {
  return (n / 2) * Math.sqrt(3);
}

/**
 * 부분 피벗 가우스 소거. n ≤ 7. 씨앗과 같은 구현 — 퇴화면 null.
 * @param {number[][]} A
 * @param {number[]} b
 * @returns {number[] | null}
 */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => {
    const copy = row.slice();
    copy.push(b[i]);
    return copy;
  });
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) {
      if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    }
    if (Math.abs(M[piv][c]) < PIVOT_MIN) return null;
    if (piv !== c) {
      const swap = M[c];
      M[c] = M[piv];
      M[piv] = swap;
    }
    const diag = M[c][c];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / diag;
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const v = M[i][n] / M[i][i];
    if (!Number.isFinite(v)) return null;
    x[i] = v;
  }
  return x;
}

/**
 * 한 관측의 전방투영. 렌더러 `poseForward` 와 같은 식:
 * cubePoint → orbitPoint → projectPoint → (off + ppu · ·).
 * cubePoint 가 면 라벨에 던지므로 호출 전에 face 를 검사한다.
 */
function projectOne(params, obs, ctx) {
  const source = cubePoint(obs.face, obs.a, obs.b);
  const rotated = orbitPoint(
    source, params.yaw, params.pitch, ctx.center, params.roll,
  );
  const point = projectPoint(rotated, ctx.layout, ctx.center, params.invDist);
  const x = params.offX + point.x * params.ppu;
  const y = params.offY + point.y * params.ppu;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function residualVector(params, obs, ctx) {
  const r = [];
  for (let i = 0; i < obs.length; i += 1) {
    const p = projectOne(params, obs[i], ctx);
    if (p === null) return null;
    r.push(p.x - obs[i].x, p.y - obs[i].y);
  }
  return r;
}

function ssq(r) {
  let s = 0;
  for (let i = 0; i < r.length; i += 1) s += r[i] * r[i];
  return s;
}

function cellResiduals(params, obs, ctx) {
  const cells = new Array(obs.length);
  for (let i = 0; i < obs.length; i += 1) {
    const p = projectOne(params, obs[i], ctx);
    if (p === null) return null;
    cells[i] = Math.hypot(p.x - obs[i].x, p.y - obs[i].y) / obs[i].cellPitch;
    if (!Number.isFinite(cells[i])) return null;
  }
  return cells;
}

function rmsOf(values) {
  if (values.length === 0) return null;
  let s = 0;
  for (let i = 0; i < values.length; i += 1) s += values[i] * values[i];
  return Math.sqrt(s / values.length);
}

function maxOf(values) {
  if (values.length === 0) return null;
  let m = values[0];
  for (let i = 1; i < values.length; i += 1) if (values[i] > m) m = values[i];
  return m;
}

/**
 * 정면 정준(자세 0 · invDist 0) 투영 대비 유사변환 최소제곱.
 * x = s·Px + ox, y = s·Py + oy. 씨앗 `blindInit` 과 같다.
 * @returns {object | null}
 */
function blindInit(obs, ctx) {
  const invDist = perspectiveInvDist(0, radius3d(ctx.n));
  const base = {
    yaw: 0, pitch: 0, roll: 0, invDist, ppu: 1, offX: 0, offY: 0,
  };
  const projected = [];
  for (let i = 0; i < obs.length; i += 1) {
    const p = projectOne(base, obs[i], ctx);
    if (p === null) return null;
    projected.push(p);
  }
  let spp = 0;
  let spq = 0;
  let spx = 0;
  let spy = 0;
  let sqx = 0;
  let sqy = 0;
  const k = obs.length;
  for (let i = 0; i < k; i += 1) {
    const px = projected[i].x;
    const py = projected[i].y;
    spp += px * px + py * py;
    spq += px * obs[i].x + py * obs[i].y;
    spx += px;
    spy += py;
    sqx += obs[i].x;
    sqy += obs[i].y;
  }
  const sol = solveLinear(
    [[spp, spx, spy], [spx, k, 0], [spy, 0, k]],
    [spq, sqx, sqy],
  );
  if (sol === null) return null;
  return {
    yaw: 0,
    pitch: 0,
    roll: 0,
    invDist,
    ppu: sol[0],
    offX: sol[1],
    offY: sol[2],
  };
}

function mergeInitial(base, overlay) {
  if (!overlay || typeof overlay !== 'object') return cloneParams(base);
  const out = cloneParams(base);
  for (let i = 0; i < PARAM_KEYS.length; i += 1) {
    const key = PARAM_KEYS[i];
    if (Number.isFinite(overlay[key])) out[key] = overlay[key];
  }
  return out;
}

function startingParams(obs, options, ctx) {
  const overlay = options.initial;
  const fullOracle = overlay && typeof overlay === 'object'
    && PARAM_KEYS.every((key) => Number.isFinite(overlay[key]));
  if (fullOracle) return cloneParams(overlay);
  const blind = blindInit(obs, ctx);
  if (blind === null) return null;
  return mergeInitial(blind, overlay);
}

/**
 * Levenberg–Marquardt. 씨앗 `fitPose` 를 계약만 씌워 옮긴 것.
 * 시작 cost 가 이미 0 이면 씨앗은 12회 실패 뒤 converged:false 를 냈다 —
 * 참값+oracle 이 그 함정에 빠지므로 여기서는 시작 cost < COST_ZERO 를
 * 수렴으로 친다.
 */
function fitPose(obs, init, ctx, maxIter) {
  let params = cloneParams(init);
  const rStart = residualVector(params, obs, ctx);
  if (rStart === null) {
    return { params: null, cost: Infinity, iterations: 0, converged: false };
  }
  let cost = ssq(rStart);
  let lambda = LAMBDA0;
  let iterations = 0;
  if (cost < COST_ZERO) {
    return { params, cost, iterations: 0, converged: true };
  }
  for (let iter = 0; iter < maxIter; iter += 1) {
    iterations = iter + 1;
    const r0 = residualVector(params, obs, ctx);
    if (r0 === null) {
      return { params, cost, iterations, converged: false };
    }
    const m = r0.length;
    const n = PARAM_KEYS.length;
    const J = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j += 1) {
      const key = PARAM_KEYS[j];
      const h = STEP[key];
      const plus = cloneParams(params);
      plus[key] += h;
      const minus = cloneParams(params);
      minus[key] -= h;
      const rp = residualVector(plus, obs, ctx);
      const rm = residualVector(minus, obs, ctx);
      if (rp === null || rm === null) {
        return { params, cost, iterations, converged: false };
      }
      const twoH = 2 * h;
      for (let i = 0; i < m; i += 1) J[i][j] = (rp[i] - rm[i]) / twoH;
    }
    const jtJ = Array.from({ length: n }, () => new Array(n).fill(0));
    const jtr = new Array(n).fill(0);
    for (let i = 0; i < m; i += 1) {
      for (let a = 0; a < n; a += 1) {
        jtr[a] += J[i][a] * r0[i];
        for (let b = 0; b < n; b += 1) jtJ[a][b] += J[i][a] * J[i][b];
      }
    }
    let improved = false;
    for (let tries = 0; tries < 12; tries += 1) {
      const A = jtJ.map((row, i) => row.map((v, j) => (
        i === j ? v * (1 + lambda) + DIAG_RIDGE : v
      )));
      const rhs = jtr.map((v) => -v);
      const delta = solveLinear(A, rhs);
      if (delta === null) {
        lambda *= 10;
        continue;
      }
      const cand = cloneParams(params);
      for (let j = 0; j < n; j += 1) cand[PARAM_KEYS[j]] += delta[j];
      const rCand = residualVector(cand, obs, ctx);
      if (rCand === null) {
        lambda *= 10;
        continue;
      }
      const c = ssq(rCand);
      if (c < cost) {
        const rel = (cost - c) / Math.max(cost, 1e-30);
        params = cand;
        cost = c;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (rel < REL_COST_STOP || cost < COST_ZERO) {
          return { params, cost, iterations, converged: true };
        }
        break;
      }
      lambda *= 10;
    }
    if (!improved) {
      return {
        params,
        cost,
        iterations,
        converged: lambda < LAMBDA_MAX || cost < COST_ABS_STOP,
      };
    }
  }
  return { params, cost, iterations, converged: false };
}

function readLayout(raw) {
  if (raw === undefined || raw === null) return DEFAULT_LAYOUT;
  if (typeof raw !== 'object') return null;
  const size = raw.size;
  const originX = raw.originX;
  const originY = raw.originY;
  if (![size, originX, originY].every(Number.isFinite) || !(size > 0)) return null;
  return { size, originX, originY };
}

function readObservation(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (FACES[entry.face] !== true) return null;
  const { a, b, x, y, cellPitch } = entry;
  if (![a, b, x, y, cellPitch].every(Number.isFinite)) return null;
  if (!(cellPitch > 0)) return null;
  return {
    id: entry.id,
    face: entry.face,
    a,
    b,
    x,
    y,
    cellPitch,
  };
}

function readInput(observations, options) {
  if (!Array.isArray(observations)) {
    return { ok: false, reason: 'invalid-input', length: 0 };
  }
  const obs = [];
  for (let i = 0; i < observations.length; i += 1) {
    const item = readObservation(observations[i]);
    if (item === null) {
      return { ok: false, reason: 'invalid-input', length: observations.length };
    }
    obs.push(item);
  }
  const opts = options && typeof options === 'object' ? options : {};
  const n = opts.n;
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, reason: 'invalid-input', length: obs.length };
  }
  const layout = readLayout(opts.layout);
  if (layout === null) {
    return { ok: false, reason: 'invalid-input', length: obs.length };
  }
  const maxIter = opts.maxIter === undefined ? MAX_ITER_DEFAULT : opts.maxIter;
  if (!Number.isInteger(maxIter) || maxIter <= 0) {
    return { ok: false, reason: 'invalid-input', length: obs.length };
  }
  if (obs.length < MIN_OBSERVATIONS) {
    return { ok: false, reason: 'underdetermined', length: obs.length, obs };
  }
  return {
    ok: true,
    obs,
    n,
    layout,
    maxIter,
    initial: opts.initial,
  };
}

function looCells(obs, options, ctx, maxIter) {
  const per = new Array(obs.length).fill(null);
  if (obs.length < MIN_LOO_OBSERVATIONS) return per;
  for (let i = 0; i < obs.length; i += 1) {
    const rest = [];
    for (let j = 0; j < obs.length; j += 1) if (j !== i) rest.push(obs[j]);
    const init = startingParams(rest, options, ctx);
    if (init === null || !paramsFinite(init)) continue;
    const fit = fitPose(rest, init, ctx, maxIter);
    if (!paramsFinite(fit.params)) continue;
    const pred = projectOne(fit.params, obs[i], ctx);
    if (pred === null) continue;
    const cells = Math.hypot(pred.x - obs[i].x, pred.y - obs[i].y) / obs[i].cellPitch;
    if (Number.isFinite(cells)) per[i] = cells;
  }
  return per;
}

/**
 * 큐브 강체 포즈 7파라미터를 관측 앵커에 맞춘다.
 *
 * `ok` 는 수치 수렴만 뜻한다. 채택 판정은 residual 로 하라.
 *
 * residual 세 필드의 모집단이 다르다 — 한 객체에 섞여 있고 소비자는
 * max/rms 를 한 짝으로 읽기 쉽다:
 *   maxCells         = **LOO** 최대
 *   rmsCells         = **in-sample** RMS
 *   inSampleMaxCells = in-sample 최대
 *
 * @param {{id?:*, face:'T'|'L'|'R', a:number, b:number, x:number, y:number, cellPitch:number}[]} observations
 * @param {{n:number, layout?:{size:number, originX:number, originY:number}, initial?:object, maxIter?:number}} [options]
 * @returns {{
 *   ok: boolean,
 *   reason: string | null,
 *   params: {yaw:number, pitch:number, roll:number, invDist:number, ppu:number, offX:number, offY:number} | null,
 *   residual: {
 *     perObsCells: (number|null)[],
 *     maxCells: number|null,
 *     rmsCells: number|null,
 *     inSampleMaxCells: number|null,
 *   },
 *   iterations: number,
 *   converged: boolean,
 * }}
 */
export function estimateCubePose(observations, options) {
  try {
    const input = readInput(observations, options);
    if (!input.ok) return failResult(input.reason, input.length);
    const { obs, n, layout, maxIter } = input;
    const ctx = { n, layout, center: cubeCenter(n) };
    const init = startingParams(obs, input, ctx);
    if (init === null || !paramsFinite(init)) {
      return failResult('init-failed', obs.length);
    }
    const fit = fitPose(obs, init, ctx, maxIter);
    if (!paramsFinite(fit.params)) {
      return failResult('non-finite', obs.length);
    }
    const inSample = cellResiduals(fit.params, obs, ctx);
    if (inSample === null) {
      return failResult('non-finite', obs.length);
    }
    const perObsCells = looCells(obs, input, ctx, maxIter);
    const looFinite = perObsCells.filter(Number.isFinite);
    const residual = {
      perObsCells,
      maxCells: looFinite.length ? maxOf(looFinite) : null,
      rmsCells: rmsOf(inSample),
      inSampleMaxCells: maxOf(inSample),
    };
    const params = publicParams(fit.params);
    if (!fit.converged) {
      return {
        ok: false,
        reason: 'did-not-converge',
        params,
        residual,
        iterations: fit.iterations,
        converged: false,
      };
    }
    return {
      ok: true,
      reason: null,
      params,
      residual,
      iterations: fit.iterations,
      converged: true,
    };
  } catch (_err) {
    const length = Array.isArray(observations) ? observations.length : 0;
    return failResult('internal-error', length);
  }
}
