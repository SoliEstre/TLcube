// 정합 계층 설계 실측 — 「면별 호모그래피 3개」 vs 「큐브 포즈 1개」.
//
// 왜 이렇게 재나:
//   설계 문서가 (b) 큐브 포즈를 «채택 방향» 으로 적고 실측 3건을 조건으로 걸었다.
//   그 3건 — (i) 비용 (ii) 부분 가림 (iii) LTC w_t 접점 — 은 독립 측정이 아니라
//   **(a)/(b) 를 가르는 세 축**이다. 따로 재면 대조군이 없어 셋 다 «(b) 가 좋아
//   보인다» 로 끝난다. 그래서 같은 입력에 둘 다 물린다.
//
//   A3 검출 계층이 아직 스텁이라 실기 대응점이 없다. 정답 기하는 아는 상태이므로
//   대응점을 **합성**한다 — 검출기 품질이라는 교란 변수를 뺀 채 기하만 재기 위함이고,
//   그래서 이 측정은 «기하가 풀리는가» 만 답한다. 검출기가 붙은 뒤의 수치가 아니다.
//
// 🔴 사전 가설 (측정 전에 적는다 — 맞았는지 보고서에 대조):
//   H1. 전체 관측(3면)에서는 (a)/(b) 가 비슷하다. (b) 는 중복도가 2배라 잡음에 조금 낫다.
//   H2. 부분 가림에서 (b) 가 이긴다 — 면 간 제약이 공짜로 들어오므로.
//   H3. 비용은 (a) 가 싸다 — 선형해 3번 vs 비선형 반복.
//   H4. (b) 의 잔차는 예측오차와 상관한다 ⇒ w_t 게이트의 근거가 된다. (a) 는 4점
//       정확결정이라 잔차가 0 이 나와 **게이트를 만들 수 없다**.
import { writeFileSync } from 'node:fs';
import { cubePoint, orbitPoint, cubeCenter, projectPoint, perspectiveInvDist } from '../../src/y3d-viewer.js';

const OUT = 'test/output/pose-6dof';
const N = 13;                 // 큐브 한 변 셀 수 (V1 코드 규모)
const CENTER = cubeCenter(N);
const RADIUS3D = Math.sqrt(3) * (N / 2);
const FACES = ['T', 'L', 'R'];
const LAYOUT_TRUE = { size: 17, originX: 320, originY: 240 };

// ── 결정적 난수 (Math.random 금지 — 재현 가능해야 회귀 자가 된다) ──
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function gauss(rnd) {
  const u = Math.max(rnd(), 1e-12);
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── 정방향 모델 ──
function project(a, b, face, prm) {
  const p = cubePoint(face, a, b);
  const r = orbitPoint(p, prm.yaw, prm.pitch, CENTER, prm.roll);
  const layout = { size: prm.size, originX: prm.originX, originY: prm.originY };
  return projectPoint(r, layout, CENTER, prm.invDist, undefined);
}

// 관측점: 각 면의 격자 교차점 k×k. k=2 는 면 네 꼭짓점 —
// 실루엣 육각형 + 중앙 접합만으로 얻을 수 있는 **최소집합**이다.
function observePoints(k) {
  const pts = [];
  for (let u = 0; u < k; u += 1) {
    for (let v = 0; v < k; v += 1) pts.push({ a: (u / (k - 1)) * N, b: (v / (k - 1)) * N });
  }
  return pts;
}

// 평가점: 모든 셀 중심
function cellCenters() {
  const pts = [];
  for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) pts.push({ a: i + 0.5, b: j + 0.5 });
  return pts;
}

// ── 선형해 (가우스 소거) ──
function solveLinear(A, rhs, n) {
  const M = [];
  for (let i = 0; i < n; i += 1) { M.push(A[i].slice()); M[i].push(rhs[i]); }
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    const tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}
function normalEq(rows, rhs, n) {
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let r = 0; r < rows.length; r += 1) {
    for (let i = 0; i < n; i += 1) {
      b[i] += rows[r][i] * rhs[r];
      for (let j = 0; j < n; j += 1) A[i][j] += rows[r][i] * rows[r][j];
    }
  }
  return solveLinear(A, b, n);
}

// ── 안 (a): 면별 호모그래피 ──
// ⚠ **Hartley 정규화는 선택이 아니다.** 고원근에서 한 면이 심하게 단축되면 8×8
//   정규방정식이 악조건이 되어 오차가 셀 단위로 튄다 — 그건 「면별 호모그래피의
//   성질」이 아니라 표준 조건화를 안 준 탓이다. 대조군에 불리한 자를 주면 비교가
//   아니라 연출이 된다 (실측 1차에서 원근 0.75 최악 3.6셀로 실제 관측됐다).
function normalizer(pts, keyU, keyV) {
  let mu = 0;
  let mv = 0;
  for (const p of pts) { mu += p[keyU]; mv += p[keyV]; }
  mu /= pts.length; mv /= pts.length;
  let d = 0;
  for (const p of pts) d += Math.hypot(p[keyU] - mu, p[keyV] - mv);
  d /= pts.length;
  const s = d > 1e-12 ? Math.SQRT2 / d : 1;
  return { s, mu, mv, apply: (u, v) => ({ u: s * (u - mu), v: s * (v - mv) }) };
}

function fitHomography(obs) {
  const S = normalizer(obs, 'a', 'b');
  const T = normalizer(obs, 'x', 'y');
  const rows = [];
  const rhs = [];
  for (const o of obs) {
    const src = S.apply(o.a, o.b);
    const dst = T.apply(o.x, o.y);
    rows.push([src.u, src.v, 1, 0, 0, 0, -dst.u * src.u, -dst.u * src.v]); rhs.push(dst.u);
    rows.push([0, 0, 0, src.u, src.v, 1, -dst.v * src.u, -dst.v * src.v]); rhs.push(dst.v);
  }
  const h = normalEq(rows, rhs, 8);
  return h ? { h, S, T } : null;
}

function applyH(fit, a, b) {
  const src = fit.S.apply(a, b);
  const h = fit.h;
  const w = h[6] * src.u + h[7] * src.v + 1;
  const u = (h[0] * src.u + h[1] * src.v + h[2]) / w;
  const v = (h[3] * src.u + h[4] * src.v + h[5]) / w;
  // 정규화 되돌리기: x = u/s + mu
  return { x: (u / fit.T.s) + fit.T.mu, y: (v / fit.T.s) + fit.T.mv };
}

// ── 안 (b): 큐브 포즈 LM ──
// 이 투영 모델의 실제 자유도는 6 이 아니라 **7** 이다: 회전 3 + 원근 1 + 스케일 1 +
// 화면이동 2. 깊이와 스케일이 독립이 아니라 (invDist, size) 로 묶여 있다.
const PKEYS = ['yaw', 'pitch', 'roll', 'invDist', 'size', 'originX', 'originY'];
const STEP = { yaw: 1e-5, pitch: 1e-5, roll: 1e-5, invDist: 1e-8, size: 1e-5, originX: 1e-4, originY: 1e-4 };
// ⚠ 뷰어 자신의 상한과 **같아야** 한다 (y3d-viewer: `BETA_MAX / radius3d`).
//   1차 실측에서 0.9× 로 잡았다가 원근 1 의 정답이 정확히 이 값이라 **정답이 배제**돼
//   (b) 가 24/24 불합으로 나왔다. 솔버가 못 푼 게 아니라 내가 못 가게 막은 것이었다.
const INVDIST_CAP = Math.sin(Math.PI / 3) / RADIUS3D;

function residuals(prm, all) {
  const r = [];
  for (const o of all) {
    const p = project(o.a, o.b, o.face, prm);
    r.push(p.x - o.x, p.y - o.y);
  }
  return r;
}

function fitPose(all, init) {
  let prm = { ...init };
  let lambda = 1e-3;
  let iters = 0;
  let r = residuals(prm, all);
  let cost = r.reduce((s, v) => s + v * v, 0);
  const n = PKEYS.length;
  for (let it = 0; it < 80; it += 1) {
    iters = it + 1;
    const J = [];
    for (const k of PKEYS) {
      const hp = { ...prm };
      const hm = { ...prm };
      hp[k] += STEP[k]; hm[k] -= STEP[k];
      const rp = residuals(hp, all);
      const rm = residuals(hm, all);
      J.push(rp.map((v, i) => (v - rm[i]) / (2 * STEP[k])));
    }
    const JtJ = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let m = 0; m < r.length; m += 1) Jtr[i] += J[i][m] * r[m];
      for (let j = 0; j < n; j += 1) {
        let s = 0;
        for (let m = 0; m < r.length; m += 1) s += J[i][m] * J[j][m];
        JtJ[i][j] = s;
      }
    }
    let applied = false;
    for (let tries = 0; tries < 6; tries += 1) {
      const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) : v)));
      const d = solveLinear(A, Jtr.map((v) => -v), n);
      if (!d) { lambda *= 10; continue; }
      const cand = { ...prm };
      PKEYS.forEach((k, i) => { cand[k] += d[i]; });
      cand.invDist = Math.min(Math.max(cand.invDist, 0), INVDIST_CAP);
      const rc = residuals(cand, all);
      const cc = rc.reduce((s, v) => s + v * v, 0);
      if (cc < cost) {
        prm = cand; r = rc; cost = cc;
        lambda = Math.max(lambda / 10, 1e-9);
        applied = true;
        break;
      }
      lambda *= 10;
    }
    if (!applied) break;
    if (Math.sqrt(cost / (r.length / 2)) < 1e-4) break;
  }
  return { prm, iters, rmsResidual: Math.sqrt(cost / (r.length / 2)) };
}

// ── 면이 카메라를 마주 보는가 ──
// 투영된 사각형의 **부호넓이**로 판정한다. 뷰어의 `outwardFacing` 을 베끼지 않는 이유는
// 손 사본이 원본과 어긋나기 때문이고, 대신 상(像)에서 직접 정의를 쓴다 — 앞을 향한 평면
// 사각형의 투영은 감기 방향이 보존되고 등을 돌리면 뒤집힌다. 이 판정이 뷰어의 `facing`
// 부호와 **원근 9점 × 3면 전부에서 일치**함을 diagnose.mjs 로 확인했다.
//
// 🔴 이 게이트가 없으면 «존재할 수 없는 면» 을 솔버에 먹인다. 1차 실측의 원근 0.9·1.0
//    행이 실제로 그랬다 (면 T·L 이 등을 돌린 상태였다).
function faceVisible(face, prm) {
  const q = [
    project(0, 0, face, prm), project(N, 0, face, prm),
    project(N, N, face, prm), project(0, N, face, prm),
  ];
  let s = 0;
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    s += q[i].x * q[j].y - q[j].x * q[i].y;
  }
  return s < 0;
}

// ── 한 시행 ──
function run(cfg) {
  const rnd = lcg(cfg.seed);
  const truth = {
    yaw: cfg.yaw, pitch: cfg.pitch, roll: cfg.roll,
    invDist: perspectiveInvDist(cfg.perspective, RADIUS3D),
    ...LAYOUT_TRUE,
  };
  // 가림(외부 요인으로 가려진 면) ∩ 기하적 가시성(카메라에 등 돌린 면 제외)
  const visible = FACES.slice(0, cfg.facesVisible).filter((f) => faceVisible(f, truth));
  if (visible.length === 0) return null;   // 잴 것이 없다 — 「0/N」 로 위장시키지 않는다

  // 셀 피치(px) — 합격 축의 분모. 「셀 크기 대비 얼마나 틀렸나」가 제품 목적의 축이다.
  let pitchSum = 0;
  for (const f of visible) {
    const c0 = project(0.5, 0.5, f, truth);
    const c1 = project(1.5, 0.5, f, truth);
    pitchSum += Math.hypot(c1.x - c0.x, c1.y - c0.y);
  }
  const pitch = pitchSum / visible.length;

  const obs = [];
  for (const f of visible) {
    for (const p of observePoints(cfg.k)) {
      const t = project(p.a, p.b, f, truth);
      obs.push({ face: f, a: p.a, b: p.b, x: t.x + gauss(rnd) * cfg.sigma, y: t.y + gauss(rnd) * cfg.sigma });
    }
  }

  // (a) 면별 호모그래피
  const tA0 = process.hrtime.bigint();
  const H = {};
  for (const f of visible) H[f] = fitHomography(obs.filter((o) => o.face === f));
  const tA = Number(process.hrtime.bigint() - tA0) / 1e6;
  // (a) 의 관측 잔차 — H4 검증용. 4점(k=2)이면 8식 8미지수라 0 이 나와야 한다.
  let sqA = 0;
  let nA = 0;
  for (const o of obs) {
    if (!H[o.face]) continue;
    const q = applyH(H[o.face], o.a, o.b);
    sqA += (q.x - o.x) ** 2 + (q.y - o.y) ** 2;
    nA += 1;
  }
  const rmsA = nA > 0 ? Math.sqrt(sqA / nA) : NaN;

  // (b) 큐브 포즈 — 초기값은 «아무것도 모른다» 에서: 정면·원근 0·관측 bbox 로 스케일
  const xs = obs.map((o) => o.x);
  const ys = obs.map((o) => o.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const init = {
    yaw: 0, pitch: 0, roll: 0, invDist: 0,
    size: span / (N * 1.8),
    originX: (Math.min(...xs) + Math.max(...xs)) / 2,
    originY: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  const tB0 = process.hrtime.bigint();
  const fit = fitPose(obs, init);
  const tB = Number(process.hrtime.bigint() - tB0) / 1e6;

  // 평가: 보이는 면의 모든 셀 중심 예측 오차 (셀 피치 단위)
  let errA = 0;
  let errB = 0;
  let maxA = 0;
  let maxB = 0;
  let cnt = 0;
  for (const f of visible) {
    for (const c of cellCenters()) {
      const t = project(c.a, c.b, f, truth);
      const pa = H[f] ? applyH(H[f], c.a, c.b) : { x: NaN, y: NaN };
      const pb = project(c.a, c.b, f, fit.prm);
      const ea = Math.hypot(pa.x - t.x, pa.y - t.y) / pitch;
      const eb = Math.hypot(pb.x - t.x, pb.y - t.y) / pitch;
      errA += ea; errB += eb;
      maxA = Math.max(maxA, ea); maxB = Math.max(maxB, eb);
      cnt += 1;
    }
  }
  return {
    meanA: errA / cnt, meanB: errB / cnt, maxA, maxB,
    msA: tA, msB: tB, iters: fit.iters, rms: fit.rmsResidual, rmsA,
    visFaces: visible.length,
  };
}

const TRIALS = 24;
const FAIL_AT = 0.33;   // 이웃 칸을 표본하기 시작하는 지점

function sweep(label, base) {
  const acc = { meanA: 0, meanB: 0, maxA: 0, maxB: 0, msA: 0, msB: 0, iters: 0, rms: 0, failA: 0, failB: 0, vis: 0, rmsA: 0 };
  const rowsRms = [];
  const rowsErr = [];
  let n = 0;
  for (let t = 0; t < TRIALS; t += 1) {
    const r = run({ ...base, seed: 1000 + t * 7919 });
    if (!r) continue;
    n += 1;
    acc.vis += r.visFaces;
    acc.meanA += r.meanA; acc.meanB += r.meanB;
    acc.maxA = Math.max(acc.maxA, r.maxA); acc.maxB = Math.max(acc.maxB, r.maxB);
    acc.msA += r.msA; acc.msB += r.msB; acc.iters += r.iters; acc.rms += r.rms; acc.rmsA += r.rmsA;
    if (!(r.maxA < FAIL_AT)) acc.failA += 1;
    if (!(r.maxB < FAIL_AT)) acc.failB += 1;
    rowsRms.push(r.rms); rowsErr.push(r.maxB);
  }
  // (iii) 잔차 ↔ 예측오차 상관 — w_t 게이트가 성립하는지
  const mr = rowsRms.reduce((a, b) => a + b, 0) / n;
  const me = rowsErr.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vr = 0;
  let ve = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (rowsRms[i] - mr) * (rowsErr[i] - me);
    vr += (rowsRms[i] - mr) ** 2;
    ve += (rowsErr[i] - me) ** 2;
  }
  const corr = (vr > 0 && ve > 0) ? cov / Math.sqrt(vr * ve) : NaN;
  return {
    label, ...base, n,
    visFaces: acc.vis / n,
    meanA: acc.meanA / n, meanB: acc.meanB / n, maxA: acc.maxA, maxB: acc.maxB,
    msA: acc.msA / n, msB: acc.msB / n, iters: acc.iters / n, rms: acc.rms / n, rmsA: acc.rmsA / n,
    failA: acc.failA, failB: acc.failB, corr,
  };
}

const D = Math.PI / 180;
const POSE = { yaw: 15 * D, pitch: 10 * D, roll: 0 };
const cases = [];
// 축 1 — 잡음 (전체 3면 · 면당 4점 = 실루엣+접합 최소집합)
for (const sigma of [0.25, 0.5, 1.0, 2.0]) {
  cases.push(sweep(`잡음 σ=${sigma}px`, { sigma, k: 2, facesVisible: 3, ...POSE, perspective: 0.4 }));
}
// 축 2 — 부분 가림
for (const fv of [3, 2, 1]) {
  cases.push(sweep(`가림 ${fv}면`, { sigma: 0.5, k: 2, facesVisible: fv, ...POSE, perspective: 0.4 }));
}
// 축 3 — 원근 세기
for (const p of [0, 0.25, 0.5, 0.75, 1.0]) {
  cases.push(sweep(`원근 ${p}`, { sigma: 0.5, k: 2, facesVisible: 3, ...POSE, perspective: p }));
}
// 축 4 — 관측점 밀도
for (const k of [2, 3, 4]) {
  cases.push(sweep(`면당 ${k * k}점`, { sigma: 1.0, k, facesVisible: 3, ...POSE, perspective: 0.4 }));
}

// ── (iii) LTC w_t 게이트 — 잔차가 «이 프레임을 얼마나 믿을까» 를 말해 주는가 ──
// ⚠ 1차 실측의 조건별 상관(≈ −0.02)은 **질문을 잘못 던진 것**이었다. 한 조건 안에서
//   σ 를 고정하면 잔차는 프레임마다 거의 같고, 그 잔여 변동은 잡음의 잡음이다.
//   실제 질문은 「σ 도 자세도 프레임마다 다른 시퀀스에서, 잔차로 가중치를 매길 수
//   있는가」이므로 **모집단 안에서 조건을 섞어야** 한다.
function gateExperiment() {
  const rnd = lcg(20260831);
  const rows = [];
  for (let t = 0; t < 240; t += 1) {
    const sigma = 0.1 + rnd() * 2.9;
    const r = run({
      sigma, k: 2, facesVisible: 3,
      yaw: (rnd() * 50 - 25) * D, pitch: (rnd() * 50 - 25) * D, roll: (rnd() * 30 - 15) * D,
      perspective: rnd(), seed: 5000 + t * 104729,
    });
    if (!r) continue;
    rows.push({ rms: r.rms, err: r.maxB, fail: !(r.maxB < FAIL_AT) });
  }
  const mr = rows.reduce((a, b) => a + b.rms, 0) / rows.length;
  const me = rows.reduce((a, b) => a + b.err, 0) / rows.length;
  let cov = 0;
  let vr = 0;
  let ve = 0;
  for (const r of rows) { cov += (r.rms - mr) * (r.err - me); vr += (r.rms - mr) ** 2; ve += (r.err - me) ** 2; }
  const corr = cov / Math.sqrt(vr * ve);

  // 게이트로 쓸 수 있나 — 잔차 문턱을 훑어 「버린 것 중 진짜 나쁜 비율」을 본다
  const fails = rows.filter((r) => r.fail).length;
  const sorted = rows.map((r) => r.rms).sort((a, b) => a - b);
  const gates = [];
  for (const q of [0.5, 0.7, 0.8, 0.9]) {
    const thr = sorted[Math.floor(q * (sorted.length - 1))];
    const kept = rows.filter((r) => r.rms <= thr);
    const keptFail = kept.filter((r) => r.fail).length;
    gates.push({ quantile: q, thr, kept: kept.length, keptFailRate: kept.length ? keptFail / kept.length : 0 });
  }
  return { n: rows.length, corr, baseFailRate: fails / rows.length, gates };
}
const gate = gateExperiment();

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');
console.log([pad('조건', 15), pad('보이는면', 9), pad('(a)평균', 9), pad('(a)최악', 9), pad('(a)불합', 8),
  pad('(b)평균', 9), pad('(b)최악', 9), pad('(b)불합', 8),
  pad('(a)ms', 8), pad('(b)ms', 8), pad('반복', 6), pad('(a)잔차', 9), '(b)잔차'].join(' '));
for (const c of cases) {
  console.log([pad(c.label, 15), pad(num(c.visFaces, 2), 9), pad(num(c.meanA), 9), pad(num(c.maxA), 9), pad(`${c.failA}/${c.n}`, 8),
    pad(num(c.meanB), 9), pad(num(c.maxB), 9), pad(`${c.failB}/${c.n}`, 8),
    pad(num(c.msA, 4), 8), pad(num(c.msB, 4), 8), pad(num(c.iters, 1), 6),
    pad(num(c.rmsA, 5), 9), num(c.rms, 3)].join(' '));
}
console.log(`\n합격 축: 셀 중심 예측 오차 < ${FAIL_AT} 셀피치 (그 위는 이웃 칸을 표본한다).`);
console.log(`「불합」 = ${TRIALS}회 중 최악오차가 그를 넘긴 횟수.`);

console.log(`\n── (iii) w_t 게이트 (σ·자세·원근을 프레임마다 섞은 ${gate.n}회) ──`);
console.log(`잔차 ↔ 최악오차 상관 r = ${num(gate.corr, 3)} · 전체 불합률 ${(gate.baseFailRate * 100).toFixed(1)}%`);
for (const g of gate.gates) {
  console.log(`  잔차 ≤ ${num(g.thr, 3)}px (하위 ${(g.quantile * 100).toFixed(0)}%) 만 채택 → ${g.kept}프레임 중 불합 ${(g.keptFailRate * 100).toFixed(1)}%`);
}

writeFileSync(`${OUT}/measure.json`, `${JSON.stringify({ trials: TRIALS, n: N, failAt: FAIL_AT, cases, gate }, null, 2)}\n`);
console.log(`\n→ ${OUT}/measure.json`);
