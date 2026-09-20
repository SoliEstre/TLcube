/**
 * Type X 소형 pose solver — P3P 닫힌 해(유한 실근 전부) + bounded Levenberg–Marquardt 다듬기. 외부 의존성 0.
 *
 * 투영 규약은 `x-project.js` 가 정본이에요: 카메라 좌표 c = R·P + t (R 은 world→camera, 행 우선 9), u = fx·X/Z + cx,
 * v = fy·Y/Z + cy, 픽셀 모서리 원점, 카메라 앞 = Z > 0. 세계 P 는 호출자가 이미 pitch·(s − (N−1)/2) 로 만든 값이고,
 * 이 모듈은 단위를 모른 채 그대로 써요(t 도 같은 단위).
 *
 * ── P3P: Grunert 1841 (Haralick·Lee·Ottenberg·Nölle 1994 «Review and analysis of solutions of the three point
 *    perspective pose estimation problem», IEEE TPAMI 16(3), §3.1 의 정리) ─────────────────────────────────────
 *   기호: 세계점 P1,P2,P3 · 카메라 단위 방향 j1,j2,j3 · 변 a=|P2−P3|, b=|P1−P3|, c=|P1−P2| ·
 *         cos α = j2·j3, cos β = j1·j3, cos γ = j1·j2 · 미지수 = 방향 따라 잰 거리 s1,s2,s3 (Q_i = s_i·j_i).
 *   단계 ① 코사인 법칙 3식:  s2²+s3²−2·s2·s3·cosα = a² · s1²+s3²−2·s1·s3·cosβ = b² · s1²+s2²−2·s1·s2·cosγ = c²
 *   단계 ② u = s2/s1, v = s3/s1 로 치환하고 (①−③)/s1² 에서 u 를 v 의 유리식으로:
 *          u = [ (K−1)·v² − 2K·cosβ·v + (K+1) ] / [ 2·(cosγ − v·cosα) ],  K = (a²−c²)/b²
 *   단계 ③ 이 u 를 (③/②) = c²/b² 관계 1+u²−2u·cosγ = (c²/b²)(1+v²−2v·cosβ) 에 넣고 분모를 곱하면 v 의 4차 다항
 *          A4·v⁴+…+A0 = 0 이 나와요. 계수는 Haralick 표를 옮겨 적지 않고 아래 polyMul/polyAdd 로 그 치환을 그대로 전개해요
 *          (옮겨 적기 오타를 없애려는 선택 — 결과는 같은 Grunert 4차식이에요).
 *   단계 ④ 4차 다항의 실근: Durand–Kerner(Weierstrass) 동시 반복(복소, 고정 초기값 (0.4+0.9i)^k · 최대 100회,
 *          스텝 < 1e-14 또는 **정체** 시 조기 종료) → 각 근의 Re(z) 를 씨앗으로 실수 Newton 다듬기(≤ 16회, |p| 감소할
 *          때만 채택) → **다듬은 잔차**로 실근 판정(정규화 |p(x)| ≤ rootTol, 또는 |Im| ≤ imagTol·max(1,|Re|)) →
 *          근사 중복 제거(|Δv| ≤ 1e-9·max(1,|v|)) → v 오름차순 정렬(결정적 순서).
 *          ⚠ 고정 |Im| 컷을 **먼저** 걸지 않는 게 핵심이에요 — 자세한 근거는 xPolyRealRoots 의 주석.
 *   단계 ⑤ 각 v 에 대해 u = Nu(v)/D(v) 를 **항상** 후보로 넣고, 분모 |D(v)| 가 상대 denomEps 밑이면 ③ 의 u 2차식
 *          두 근을 **더해** 넣어요(둘 중 하나를 고르는 게 아니라 합집합 — 참 가지를 잃지 않으려는 것이에요).
 *          s1 = b/√(1+v²−2v·cosβ), s2 = u·s1, s3 = v·s1. 그 뒤 원래 3식(단계 ①)에 대한 3×3 Newton 다듬기 ≤ 3회
 *          (잔차가 줄 때만 채택) — 4차식의 조건수와 무관하게 깊이를 기계 정밀도까지 끌어요.
 *   단계 ⑥ 3식 잔차(상대 residualTol) 로 검증 → 깊이 s_i ≤ 0 또는 Z_i = s_i·j_i[2] ≤ 0 이면 카메라 뒤(제외 + droppedBehind) →
 *          절대 방향: 세계·카메라 삼각형에 같은 정규직교 프레임(e1 = P2−P1 방향, e3 = e1×(P3−P1) 방향, e2 = e3×e1)을 세워
 *          R = F·Eᵀ, t = mean(Q) − R·mean(P) → selfConsistency = 3 점의 재투영 각오차(라디안, 최대값).
 *   퇴화 거절(명시): 비유한 입력 · 공선 세계점 · 일치/반대 방향 bearing(|j_i×j_j| < eps) · **근 solver 미수렴**
 *          ('root-solver-not-converged'; requireRootSolverConvergence 로 끌 수 있어요).
 *
 * ── ⚠ selfConsistency 는 **적합도가 아니에요** ────────────────────────────────────────────────────────────────
 *   R·t 는 Q_i = s_i·J_i 를 정확히 맞추도록 «구성» 되므로 이 값은 항등적으로 ~1e-14 rad 이고, **잡음과 무관**해요.
 *   실측(250 pose × 무작위 삼중, 2026-09-20 수정본): σ=0 최대 1.688e-14 · σ=0.5 2.193e-14 · σ=1.4 4.926e-14 ·
 *   σ=5 px 3.167e-14 rad — 같은 코퍼스의 실제 회전오차는 최대 ~1.8e+2 deg 예요. 후보 순위·필터링에 쓰면 필터링
 *   능력이 0 이에요. 적합도가 필요하면 **xPoseLM 의 rmsPx** 를 쓰세요. (옛 이름 `residual` 은 제거했어요 —
 *   이름이 그대로면 다음 소비자가 또 점수로 써요. stage2-context 스키마의 residual 자리에는 rmsPx 를 넣으세요.)
 *
 * ── ⚠ 「선언된 거절선」과 「실측 사용 하한」은 9 decade 떨어져 있어요 — 섞어 읽으면 안 돼요 ─────────────────────
 *   면적비 ≡ 삼각형 면적 / (최장 변)²  (diagnostics.areaRatio 로 반환해요).
 *   · 면적비 < eps(기본 1e-12) → 'collinear-points' 로 **거절**. 이게 선언된 퇴화선이에요.
 *   · 면적비 1e-12 … ≈1.5e-3 → 거절선엔 안 걸리지만 조건수 때문에 후보가 잔차 게이트(residualTol)에서 전부 탈락해
 *     **빈 배열 + reason 'ill-conditioned'** 로 나와요. 「퇴화라 거절」이 아니라 「이 자로는 못 푼다」예요.
 *     ⚠ **이 대역은 단조롭지도 않고 안전하지도 않아요**: 실측(고정 pose·정확 투영, 2026-09-20 수정본) 면적비
 *     1e-8 칸에서는 해 2 개가 reason 'ok' 로 나오는데 최량 회전오차가 7.140e+1 deg 예요. 즉 붕괴 대역에서는
 *     「해가 없음」도 「해가 있음」도 신뢰 신호가 아니에요 — diagnostics.bearingSolidAngle 를 같이 보세요.
 *   · ⚠ **붕괴를 정하는 건 세계 공간 면적비가 아니라 화면 부분각이에요.** 아래 §부분각 참조. 옛 주석은 「N=8 격자
 *     삼중은 면적비 ≥ 1.1498e-2 라 이 붕괴 대역이 구조적으로 안 생겨요」라고 조건 없이 적었는데, 그건 **단계 ②
 *     캠페인 조건(distanceOverWidth 3, 320×240, fov 40°) 한정**으로만 맞아요. 같은 격자·같은 면적비라도 카메라를
 *     멀리 밀면 같은 붕괴가 그대로 나요.
 *
 * ── ⚠ 화면 부분각(§부분각) — areaRatio 를 한 글자도 안 바꾸고도 붕괴해요 ────────────────────────────────────
 *   실측(삼중 [0,73,510] 고정 · areaRatio 전 구간 1.055e-2 상수 · distanceOverWidth 만 흔듦, 2026-09-20 수정본):
 *     dOW=3    입체각 7.377e-5 sr · 화면 최장변 130.46 px → ok · 2.386e-12 deg
 *     dOW=300  입체각 8.655e-9 sr · 화면 최장변   1.24 px → ok · 2.149e-8 deg
 *     dOW=500  입체각 3.118e-9 sr · 화면 최장변   0.74 px → **ill-conditioned · 해 0**
 *     dOW=1e4  입체각 7.806e-12 sr · 화면 최장변  0.04 px → ill-conditioned · 해 0
 *   실측 경첩은 «화면 삼각형 최장변 ≈ 1 px» 근처예요. 이 축의 지표로 diagnostics.bearingSolidAngle(세 bearing 의
 *   입체각, sr) 을 반환해요. minBearingSin 하나로는 못 갈라요 — 「두 점이 같은 시선에 앞뒤로」면 minBearingSin
 *   1e-11 에서도 멀쩡히 풀려요(probe-b).
 *
 * ── ⚠ 잡음 체제(위 수치는 전부 「정확 투영」) ─────────────────────────────────────────────────────────────────
 *   픽셀 잡음이 들어가면 4차식이 **실근을 실제로 잃어요**(reason 'no-real-root').
 *   · `residualTol` 만으로는 그 건수를 **원리적으로** 못 줄여요 — 코드가 `if (!roots.length) return fail('no-real-root')`
 *     로 잔차 게이트보다 **위에서** 반환하기 때문이에요(구성상 참이지 실험 결과가 아니에요). 실측도 그대로:
 *     σ=0.2 격자 최악 삼중 600 회에서 해없음 78 → residualTol 1e-5 로도 78.
 *   · 그 컷을 실제로 지배하는 건 `imagTol` 이에요. **{imagTol 1e-1, residualTol 1e-5} 2 팔 실측(2026-09-20 수정본)**:
 *     σ=0.05 해없음 34→1 · σ=0.2 78→38 · σ=0.5 117→86. 회복분의 품질은 base 분포 안에 머물러요
 *     (중앙 1.431e+0→1.512e+0 · p90 5.550e+0→6.682e+0 deg @σ=0.05).
 *   · ⇒ 기본값(imagTol 1e-6)은 「덜 정확한 가설을 내보내느니 해없음으로 버린다」쪽이에요. 「버리기 vs 내보내고
 *     LM·RS 검증에 맡기기」는 **캠페인 목적이 정할 문제**라 여기서 봉인하지 않아요(단계 ② 설계의 몫).
 *   · 관측 수치의 정본은 **test/x-p3p.test.js 의 OBSERVED 상수**예요 — 테스트가 매번 재측정해서 단언해요.
 *     여기에 표를 옮겨 적지 않아요(손으로 유지하는 사본 목록은 반드시 어긋나요 — 옛 주석의 0/28/76 은 실측
 *     34/78/117 과 2.8× 어긋나 있었어요).
 *   ⇒ 잡음 정확도는 단일 최악값이 아니라 **중앙·p90 + 정족수**로 읽어요(test 의 잡음 사다리).
 *   ⇒ σ=0 에서 나오는 1e-7 deg 급 수치는 **기계 정밀도**이지 solver 정확도 주장이 아니에요.
 *
 * ── 비용(단계 ② 예산 회계에 바로 들어가는 상수) ──────────────────────────────────────────────────────────────
 *   **같은 스크립트를 수정 전/후 2 회**(probe-o, 4000-삼중 코퍼스 × 10 회 = 40000 호출, 2026-09-20):
 *     수정 전 **2.387e-1 ms/호출**(DK 가 호출의 98.33 % 에서 500 회를 끝까지 돌았어요)
 *     → 수정 후 **1.881e-2 ms/호출**. 약 12.7× 감소.
 *   다른 자(59906 코퍼스, m1 스크립트)로는 수정 후 1.474e-2 ms/호출 · DK 반복 중앙 19 · p99 27 이에요 —
 *   **코퍼스가 다르니 이 둘을 섞어서 «배수» 를 만들지 마세요.**
 *   프레임당 예산 = (프레임당 P3P 호출 수) × (호출당 ms). 단계 ② 는 주소 후보 1008 개를 도는 계획이라
 *   이 곱을 예산 회계식에 **명시**해야 해요(예: 호출 1000 회/frame → 1.5\~1.9e+1 ms/frame).
 *
 * ── LM: 재투영 픽셀 오차 Σ(du²+dv²) 최소화 ────────────────────────────────────────────────────────────────────
 *   매개화: R = exp([δω]×)·R_k (Rodrigues), t = t_k + δt. 6×6 정규방정식 (JᵀJ + λ·diag(JᵀJ))·δ = Jᵀr 을 부분 피벗
 *   가우스 소거로 풀어요. λ 는 **Marquardt 상대 감쇠**(diag(JᵀJ) 에 곱해요)라 그 자체로 문제 스케일에서 유도된
 *   값이에요 — 별도의 mean(diag(JᵀJ)) 스케일링을 또 걸지 않아요(이중 스케일링).
 *   감쇠 규칙(표준 LM): 채택 시 λ ← max(λ/10, 1e-12) 로 내리고 **바깥 반복을 1 소비**해요. 거부 시에는 바깥 반복을
 *   소비하지 않고 **안쪽 λ-상승 고리**에서 λ ← λ·10 을 반복해요 — 스텝이 받아들여질 때까지. 종료는 λ > lambdaMax
 *   (기본 1e12) 이거나 λ ≥ 1 인데도 경계 축소 후 스텝이 tol 밑으로 언더플로할 때뿐이에요.
 *   ⚠ 예전 구현은 「거부 3회 연속 → diverged」라 λ 를 1e-3·10³ = 1 까지밖에 못 올리고 포기했어요. 그게 회복 가능한
 *   하강을 죽였어요 — 실측(1.4 px 잡음·8 점·P3P 초기값 1215 회, 2026-09-20): diverged 23 건 중 13 건이 λ0 만
 *   1e-3→1e3 으로 바꾸면 더 낮은 cost 에 도달했고 그중 12 건은 참 pose 회전오차까지 좋아졌어요(예: rms 4.881e+1 px ·
 *   회전 1.487e+1 deg → 2.078e+0 px · 1.059e+0 deg). consecutiveFail 은 이제 종료 조건이 아니라
 *   diagnostics(rejectedSteps · maxConsecutiveRejects) 로만 남아요.
 *   스텝 경계: |δω| ≤ maxStep.rotRad, |δt| ≤ maxStep.trans(기본 = max(|t0|, 점 반경)) — 넘치면 방향을 유지한 채
 *   전체를 축소해요. 거부 사유 = 오차 증가 · 어느 점이라도 Z ≤ 0 · 비유한. R 은 매 스텝 재직교화(행 Gram–Schmidt +
 *   세 번째 행 외적 = det +1). 종료: 상대 오차 감소 < tol('converged') · 스텝 < tol(λ<1 일 때, 'step-below-tol') ·
 *   오차 0('cost-zero') · maxIter('max-iterations') · 초기 Z ≤ 0('behind-camera-initial') · 정규화 JᵀJ 랭크 결손
 *   ('degenerate-jacobian', 예: 공선 점) · 정규방정식 해 실패('singular-normal-equations') ·
 *   'diverged(lambda-max:…)' · 'diverged(step-underflow:…)'.
 *   ⚠ 표준 LM 이 된 결과, 예전에 diverged 로 끝나던 **진짜 지역 극소**(예: 180° 뒤집힌 초기값)는 이제 그 지역 극소로
 *   'converged' 해요 — converged:true 는 「참 pose」가 아니라 「극소에 도달」이에요. 참·거짓은 rmsPx 로 가르세요.
 */
import { assertXCamera, mat3Mul, mat3Apply } from './x-project.js';

// ───────────────────────────── 벡터·행렬 소도구 ─────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const unit = a => { const n = norm(a); return n > 0 ? scale(a, 1 / n) : null; };
const transpose = R => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
const det3 = R => R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
const finite3 = p => Array.isArray(p) && p.length === 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);

/** R 이 회전(직교 + det +1)인지 — 원소 유한성부터 봐요. */
export function xIsRotation(R, tol = 1e-9) {
  if (!Array.isArray(R) || R.length !== 9) return false;
  for (let i = 0; i < 9; i += 1) if (!Number.isFinite(R[i])) return false;
  const I = mat3Mul(R, transpose(R));
  for (let i = 0; i < 9; i += 1) if (Math.abs(I[i] - (i % 4 === 0 ? 1 : 0)) > tol) return false;
  return Math.abs(det3(R) - 1) <= tol;
}

/** 두 회전의 상대각(deg). sin 부분(비대각)과 cos 부분(대각합)을 atan2 로 합쳐 작은 각도 1e-16 rad 수준까지 분해돼요. */
export function xRotationAngleDeg(Ra, Rb) {
  const Rrel = mat3Mul(Ra, transpose(Rb));
  const s = 0.5 * Math.hypot(Rrel[7] - Rrel[5], Rrel[2] - Rrel[6], Rrel[3] - Rrel[1]);
  const c = (Rrel[0] + Rrel[4] + Rrel[8] - 1) / 2;
  return Math.atan2(s, c) * 180 / Math.PI;
}

/** 축-각 ω(라디안 벡터) → 회전 exp([ω]×) (Rodrigues, 작은 각은 급수). */
export function xExpSO3(w) {
  const th2 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
  const th = Math.sqrt(th2);
  let A, B; // sinθ/θ, (1−cosθ)/θ²
  if (th < 1e-4) { A = 1 - th2 / 6; B = 0.5 - th2 / 24; } else { A = Math.sin(th) / th; B = (1 - Math.cos(th)) / th2; }
  const [x, y, z] = w;
  // I + A·[w]× + B·[w]×²
  return [
    1 + B * (-(y * y) - z * z), -A * z + B * (x * y), A * y + B * (x * z),
    A * z + B * (x * y), 1 + B * (-(x * x) - z * z), -A * x + B * (y * z),
    -A * y + B * (x * z), A * x + B * (y * z), 1 + B * (-(x * x) - y * y),
  ];
}

/** 행 Gram–Schmidt + 세 번째 행 = 외적 → SO(3)(det +1). 첫 두 행이 평행하면 null. */
export function xOrthonormalizeRotation(R) {
  const r0 = unit([R[0], R[1], R[2]]);
  if (!r0) return null;
  let r1 = [R[3], R[4], R[5]];
  const d = dot(r1, r0);
  r1 = unit([r1[0] - d * r0[0], r1[1] - d * r0[1], r1[2] - d * r0[2]]);
  if (!r1) return null;
  const r2 = cross(r0, r1);
  return [r0[0], r0[1], r0[2], r1[0], r1[1], r1[2], r2[0], r2[1], r2[2]];
}

/**
 * 부분 피벗 가우스 소거 A(n×n, 행 우선 평탄 배열)·x = b. 해 실패(0 피벗·비유한)면 null.
 * @returns {number[]|null}
 */
function solveLinear(A, b, n) {
  const M = A.slice(), y = b.slice();
  for (let col = 0; col < n; col += 1) {
    let piv = col, best = Math.abs(M[col * n + col]);
    for (let r = col + 1; r < n; r += 1) { const v = Math.abs(M[r * n + col]); if (v > best) { best = v; piv = r; } }
    if (!(best > 0) || !Number.isFinite(best)) return null;
    if (piv !== col) {
      for (let k = 0; k < n; k += 1) { const tmp = M[col * n + k]; M[col * n + k] = M[piv * n + k]; M[piv * n + k] = tmp; }
      const tb = y[col]; y[col] = y[piv]; y[piv] = tb;
    }
    const p = M[col * n + col];
    for (let r = col + 1; r < n; r += 1) {
      const f = M[r * n + col] / p;
      if (f === 0) continue;
      for (let k = col; k < n; k += 1) M[r * n + k] -= f * M[col * n + k];
      y[r] -= f * y[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = y[r];
    for (let k = r + 1; k < n; k += 1) s -= M[r * n + k] * x[k];
    x[r] = s / M[r * n + r];
    if (!Number.isFinite(x[r])) return null;
  }
  return x;
}

/** 대칭 양반정치 행렬의 «정규화 피벗 비» — Jacobi 스케일링 뒤 피벗 없는 소거의 min|pivot|/max|pivot| (랭크 결손 탐지용). */
function normalizedPivotRatio(A, n) {
  const d = new Array(n);
  for (let i = 0; i < n; i += 1) { const v = A[i * n + i]; if (!(v > 0)) return 0; d[i] = 1 / Math.sqrt(v); }
  const M = new Array(n * n);
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) M[i * n + j] = A[i * n + j] * d[i] * d[j];
  let minP = Infinity, maxP = 0;
  for (let col = 0; col < n; col += 1) {
    let piv = col, best = Math.abs(M[col * n + col]);
    for (let r = col + 1; r < n; r += 1) { const v = Math.abs(M[r * n + col]); if (v > best) { best = v; piv = r; } }
    if (piv !== col) for (let k = 0; k < n; k += 1) { const tmp = M[col * n + k]; M[col * n + k] = M[piv * n + k]; M[piv * n + k] = tmp; }
    const p = M[col * n + col];
    if (!Number.isFinite(p)) return 0;
    const ap = Math.abs(p);
    if (ap < minP) minP = ap; if (ap > maxP) maxP = ap;
    if (ap === 0) return 0;
    for (let r = col + 1; r < n; r += 1) {
      const f = M[r * n + col] / p;
      for (let k = col; k < n; k += 1) M[r * n + k] -= f * M[col * n + k];
    }
  }
  return maxP > 0 ? minP / maxP : 0;
}

// ───────────────────────────── 다항식 소도구(계수는 낮은 차수부터) ─────────────────────────────
function polyMul(p, q) {
  const out = new Array(p.length + q.length - 1).fill(0);
  for (let i = 0; i < p.length; i += 1) for (let j = 0; j < q.length; j += 1) out[i + j] += p[i] * q[j];
  return out;
}
function polyAdd(p, q, kq = 1) {
  const out = new Array(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i += 1) out[i] += p[i];
  for (let i = 0; i < q.length; i += 1) out[i] += kq * q[i];
  return out;
}
function polyEval(p, x) { let s = 0; for (let i = p.length - 1; i >= 0; i -= 1) s = s * x + p[i]; return s; }
function polyDeriv(p) { const d = new Array(Math.max(p.length - 1, 1)).fill(0); for (let i = 1; i < p.length; i += 1) d[i - 1] = i * p[i]; return d; }

/**
 * 실계수 다항식(낮은 차수부터, 차수 ≤ 4 를 상정하지만 일반)의 실근 전부 — 단계 ④ 그대로예요.
 *
 * 복소근 제외 규칙(2026-09-20 개정, 결함 ①-②): **고정 |Im| 컷을 먼저 걸지 않아요.** 모든 DK 근의 Re(z) 를 씨앗으로
 * 실수 Newton 을 돌린 뒤 **다듬은 잔차**로 판정해요 — 받아들이는 조건은
 *   (ㄱ) 정규화 잔차 |p(x)| / (Σ|c_i| · max(1,|x|)ⁿ) ≤ rootTol  **또는**  (ㄴ) |Im| ≤ imagTol·max(1,|Re|).
 * (ㄴ) 는 옛 규칙의 보존(잔차가 커도 «거의 실수» 면 씨앗으로 통과시켜 상위의 3×3 Newton 에 맡겨요)이고,
 * (ㄱ) 이 새로 열린 문이에요. 옛 구현은 near-tangent 쌍의 |Im| 이 1e-6 바로 위면 **참근을 Newton 에 닿기도 전에**
 * 버렸어요(증인 trial 11750: |Im| ∈ (1e-6, 1e-5), 정규화 다항식값 −8.878e-16 = 진짜 근).
 *
 * 수렴 판정(결함 ②): 옛 종료 문턱 「상대 스텝 < 1e-16」은 배정도에서 사실상 도달 불가라 호출의 98.33 % 가 500 회를
 * 끝까지 돌았고(probe-o, 4000 시행) `converged` 는 98.43 % 오탐이었어요. 이제
 *   · 종료 = 상대 스텝 < stepTol(1e-14) · **정체**(스텝이 1e-6 밑인데 직전의 절반 밑으로 안 줄어든 것이 2 회 연속) · maxIter(기본 100)
 *   · `converged` = **모든 근의 정규화 잔차가 rootTol 이하**(스텝이 아니라 잔차로 정의)
 * 로 바꿨어요.
 *
 * @returns {{roots:number[], degree:number, droppedComplex:number, droppedComplexImag:number,
 *   converged:boolean, iterations:number, maxRootResidual:number}} roots 는 오름차순
 */
export function xPolyRealRoots(coeffs, { imagTol = 1e-6, leadEps = 1e-14, rootTol = 1e-10, maxIter = 100, stepTol = 1e-14 } = {}) {
  const bail = degree => ({ roots: [], degree, droppedComplex: 0, droppedComplexImag: 0, converged: false, iterations: 0, maxRootResidual: Infinity });
  let p = coeffs.slice();
  for (const c of p) if (!Number.isFinite(c)) return bail(-1);
  const amax = Math.max(...p.map(Math.abs));
  if (!(amax > 0)) return bail(-1);
  p = p.map(c => c / amax);
  while (p.length > 1 && Math.abs(p[p.length - 1]) < leadEps) p.pop();
  const n = p.length - 1;
  if (n < 1) return { roots: [], degree: n, droppedComplex: 0, droppedComplexImag: 0, converged: true, iterations: 0, maxRootResidual: 0 };
  // Durand–Kerner: 복소수는 [re, im]
  const lead = p[n];
  const bound = 1 + Math.max(...p.slice(0, n).map(c => Math.abs(c / lead)));
  const z = new Array(n);
  { let re = 1, im = 0; // (0.4+0.9i)^k · bound
    for (let k = 0; k < n; k += 1) { z[k] = [re * bound, im * bound]; const nre = re * 0.4 - im * 0.9, nim = re * 0.9 + im * 0.4; re = nre; im = nim; } }
  const cev = ([re, im]) => { let sr = 0, si = 0; for (let i = n; i >= 0; i -= 1) { const tr = sr * re - si * im + p[i]; si = sr * im + si * re; sr = tr; } return [sr, si]; };
  let iterations = 0, prevStep = Infinity, stall = 0;
  for (let it = 0; it < maxIter; it += 1) {
    iterations = it + 1;
    let maxStep = 0;
    for (let k = 0; k < n; k += 1) {
      let [dr, di] = [lead, 0];
      for (let j = 0; j < n; j += 1) {
        if (j === k) continue;
        const ar = z[k][0] - z[j][0], ai = z[k][1] - z[j][1];
        const nr = dr * ar - di * ai, ni = dr * ai + di * ar; dr = nr; di = ni;
      }
      const [fr, fi] = cev(z[k]);
      const den = dr * dr + di * di;
      if (!(den > 0)) { z[k] = [z[k][0] + 1e-8 * (k + 1), z[k][1] + 1e-8]; maxStep = Infinity; continue; } // 근 충돌 시 결정적 미세 이동
      const qr = (fr * dr + fi * di) / den, qi = (fi * dr - fr * di) / den;
      z[k] = [z[k][0] - qr, z[k][1] - qi];
      const step = Math.hypot(qr, qi) / Math.max(1, Math.hypot(z[k][0], z[k][1]));
      if (step > maxStep) maxStep = step;
    }
    if (maxStep < stepTol) break;
    // 정체: 기계 정밀도 근처에서 스텝이 더 안 줄면 남은 반복은 순수 낭비예요(결함 ③ 의 비용이 여기서 났어요).
    if (maxStep < 1e-6 && !(maxStep < prevStep * 0.5)) { stall += 1; if (stall >= 2) break; } else stall = 0;
    prevStep = maxStep;
  }
  // converged = 「모든 근이 잔차로 근이다」 — 스텝 문턱이 아니라 잔차로 정의해요.
  let coefSum = 0; for (const c of p) coefSum += Math.abs(c);
  if (!(coefSum > 0)) coefSum = 1;
  const scaledResidual = (mag, x) => mag / (coefSum * Math.pow(Math.max(1, Math.abs(x)), n));
  let maxRootResidual = 0;
  for (const zk of z) {
    const [fr, fi] = cev(zk);
    const r = scaledResidual(Math.hypot(fr, fi), Math.hypot(zk[0], zk[1]));
    if (!(r <= maxRootResidual)) maxRootResidual = Number.isFinite(r) ? r : Infinity;
  }
  const converged = maxRootResidual <= rootTol;
  const dp = polyDeriv(p);
  const reals = [];
  let droppedComplex = 0, droppedComplexImag = 0;
  for (const [re, im] of z) {
    // ⚠ |Im| 컷을 **먼저** 걸지 않아요 — Re(z) 를 씨앗으로 Newton 을 돌려 본 뒤 잔차로 판정해요.
    let x = re, fx = Math.abs(polyEval(p, x));
    for (let it = 0; it < 16; it += 1) { // 실수 Newton 다듬기 — |p| 가 줄 때만 채택
      const d = polyEval(dp, x);
      if (!(Math.abs(d) > 0)) break;
      const nx = x - polyEval(p, x) / d;
      const nf = Math.abs(polyEval(p, nx));
      if (!(nf < fx)) break;
      x = nx; fx = nf;
    }
    const nearReal = Math.abs(im) <= imagTol * Math.max(1, Math.abs(re));
    if (Number.isFinite(x) && (scaledResidual(fx, x) <= rootTol || nearReal)) reals.push(x);
    else { droppedComplex += 1; droppedComplexImag = Math.max(droppedComplexImag, Math.abs(im)); }
  }
  reals.sort((a, b) => a - b);
  const roots = [];
  for (const r of reals) if (!roots.length || Math.abs(r - roots[roots.length - 1]) > 1e-9 * Math.max(1, Math.abs(r))) roots.push(r);
  return { roots, degree: n, droppedComplex, droppedComplexImag, converged, iterations, maxRootResidual };
}

// ───────────────────────────── bearing ─────────────────────────────
/** 픽셀 → 카메라 단위 방향 [(u−cx)/fx, (v−cy)/fy, 1] 정규화. camera 는 assertXCamera 통과 형태. */
export function xBearingsFromPixels(pixels, camera) {
  assertXCamera(camera);
  if (!Array.isArray(pixels)) throw new TypeError('pixels 는 [[u,v],…] 배열이어야 해요');
  return pixels.map((px, i) => {
    if (!Array.isArray(px) || px.length < 2 || !Number.isFinite(px[0]) || !Number.isFinite(px[1])) throw new RangeError(`pixels[${i}] 가 유한 [u,v] 가 아니에요`);
    return unit([(px[0] - camera.cx) / camera.fx, (px[1] - camera.cy) / camera.fy, 1]);
  });
}

// ───────────────────────────── P3P ─────────────────────────────
/**
 * Grunert P3P — 유한 실근 전부(최대 4).
 * @param {{points:number[][], bearings:number[][]}} in 세계점 3 · 카메라 좌표계 방향 3(단위가 아니면 정규화)
 * @param {{eps?:number, imagTol?:number, residualTol?:number, denomEps?:number, rootTol?:number,
 *   requireRootSolverConvergence?:boolean, maxSolutions?:number}} opts
 * @returns {Array<{R:number[], t:number[], depths:number[], selfConsistency:number}> & {diagnostics:object}}
 *   ⚠ 옛 이름 `residual` 은 **없어졌어요** — `selfConsistency` 로 바뀌었고, 그 값은 **적합도가 아니에요**(아래 참조).
 *   배열에 `diagnostics` 속성(reason · droppedBehind · droppedComplex · droppedComplexImag · droppedResidual ·
 *   droppedOverflow · quarticDegree · realRoots · rootSolverConverged · rootSolverIterations · nearDoubleRoot ·
 *   minDenom · areaRatio · minBearingSin · bearingSolidAngle) 을 붙여요. 퇴화·비유한은 빈 배열 + diagnostics.reason.
 *   정렬은 depths 사전순(결정적).
 *   reason 값: 'ok' · 'need-3-points-and-3-bearings' · 'non-finite-input' · 'collinear-points'(면적비 < eps 거절) ·
 *   'coincident-bearings' · 'root-solver-not-converged'(단계 ④ 미수렴 — stage2-context §잠긴 것의 «미수렴은 명시
 *   거절») · 'no-real-root'(4차식 실근 0) · 'ill-conditioned'(실근은 있었는데 잔차 게이트에서 전부 탈락 — 파일 머리
 *   §하한) · 'no-valid-solution' · 'all-behind-camera'.
 */
export function xP3P({ points, bearings } = {}, opts = {}) {
  const {
    eps = 1e-12, imagTol = 1e-6, residualTol = 1e-9, denomEps = 1e-6, rootTol = 1e-10,
    requireRootSolverConvergence = true, maxSolutions = 4,
  } = opts;
  // areaRatio · minBearingSin · bearingSolidAngle 은 조건수 지표예요 — 소비자가 「퇴화(collinear-points)」와
  // 「조건수 탓 해 없음(ill-conditioned)」과 「기하가 진짜로 해를 안 주는 경우(no-real-root/no-valid-solution)」를
  // 가를 때 써요. ⚠ **붕괴를 정하는 건 세계 공간 areaRatio 가 아니라 화면 부분각**이에요(파일 머리 §부분각) —
  // 그 축의 지표가 bearingSolidAngle(세 bearing 이 만드는 입체각, sr) 이에요.
  const diagnostics = {
    reason: 'ok', droppedBehind: 0, droppedComplex: 0, droppedComplexImag: 0, droppedResidual: 0, droppedOverflow: 0,
    quarticDegree: -1, realRoots: 0, rootSolverConverged: null, rootSolverIterations: 0,
    nearDoubleRoot: null, minDenom: null, areaRatio: null, minBearingSin: null, bearingSolidAngle: null,
  };
  const out = [];
  out.diagnostics = diagnostics;
  const fail = reason => { diagnostics.reason = reason; return out; };
  if (!Array.isArray(points) || points.length !== 3 || !Array.isArray(bearings) || bearings.length !== 3) return fail('need-3-points-and-3-bearings');
  for (let i = 0; i < 3; i += 1) if (!finite3(points[i]) || !finite3(bearings[i])) return fail('non-finite-input');
  const P = points.map(p => [p[0], p[1], p[2]]);
  const J = [];
  for (let i = 0; i < 3; i += 1) { const j = unit(bearings[i]); if (!j || !finite3(j)) return fail('non-finite-input'); J.push(j); }
  // 퇴화: 공선 세계점 — 면적 / (최장 변)²
  const e12 = sub(P[1], P[0]), e13 = sub(P[2], P[0]), e23 = sub(P[2], P[1]);
  const a = norm(e23), b = norm(e13), c = norm(e12);
  const longest = Math.max(a, b, c);
  const areaRatio = longest > 0 ? norm(cross(e12, e13)) / (longest * longest) : 0;
  diagnostics.areaRatio = areaRatio;
  if (!(longest > 0) || areaRatio < eps) return fail('collinear-points');
  // 퇴화: 일치·반대 방향 bearing
  let minBearingSin = Infinity;
  for (const [i, k] of [[0, 1], [0, 2], [1, 2]]) minBearingSin = Math.min(minBearingSin, norm(cross(J[i], J[k])));
  diagnostics.minBearingSin = minBearingSin;
  if (minBearingSin < eps) return fail('coincident-bearings');
  // 화면 부분각 지표: 세 bearing 이 만드는 입체각(Van Oosterom–Strackee 1983). 세계 공간 areaRatio 와 달리
  // 카메라 거리를 따라 움직여요 — 실측 붕괴 경첩이 이 축에 있어요(파일 머리 §부분각).
  {
    const num = Math.abs(dot(J[0], cross(J[1], J[2])));
    const den = 1 + dot(J[0], J[1]) + dot(J[1], J[2]) + dot(J[2], J[0]);
    diagnostics.bearingSolidAngle = 2 * Math.atan2(num, den);
  }
  const ca = dot(J[1], J[2]), cb = dot(J[0], J[2]), cg = dot(J[0], J[1]);
  const a2 = a * a, b2 = b * b, c2 = c * c;
  const K = (a2 - c2) / b2;
  // 단계 ②③: u = Nu(v)/D(v), 4차식 P(v) = D² + Nu² − 2cosγ·Nu·D − (c²/b²)·(1 − 2cosβ·v + v²)·D²
  const Nu = [K + 1, -2 * K * cb, K - 1];
  const D = [2 * cg, -2 * ca];
  const Q = [1, -2 * cb, 1];
  const D2 = polyMul(D, D);
  let poly = polyAdd(D2, polyMul(Nu, Nu));
  poly = polyAdd(poly, polyMul(Nu, D), -2 * cg);
  poly = polyAdd(poly, polyMul(Q, D2), -(c2 / b2));
  const {
    roots, degree, droppedComplex, droppedComplexImag, converged: rootSolverConverged, iterations: rootIterations,
  } = xPolyRealRoots(poly, { imagTol, rootTol });
  diagnostics.quarticDegree = degree; diagnostics.droppedComplex = droppedComplex;
  diagnostics.droppedComplexImag = droppedComplexImag; diagnostics.realRoots = roots.length;
  diagnostics.rootSolverConverged = rootSolverConverged; diagnostics.rootSolverIterations = rootIterations;
  // 근 간 최소 간격(스케일 정규화) · 분모 |D(v)| 최소값 — 「이 'ok' 는 불완전할 수 있다」를 소비자가 볼 수 있게.
  let nearDoubleRoot = Infinity, minDenom = Infinity;
  for (let i = 0; i < roots.length; i += 1) {
    const denScale = Math.abs(2 * cg) + Math.abs(2 * ca * roots[i]) + 1;
    minDenom = Math.min(minDenom, Math.abs(polyEval(D, roots[i])) / denScale);
    for (let k = i + 1; k < roots.length; k += 1) {
      nearDoubleRoot = Math.min(nearDoubleRoot, Math.abs(roots[i] - roots[k]) / Math.max(1, Math.abs(roots[i]), Math.abs(roots[k])));
    }
  }
  diagnostics.nearDoubleRoot = Number.isFinite(nearDoubleRoot) ? nearDoubleRoot : null;
  diagnostics.minDenom = Number.isFinite(minDenom) ? minDenom : null;
  // stage2-context §잠긴 것: 「공선·중복 대응·비양의 깊이·비유한 근·**미수렴**은 명시 거절」
  if (requireRootSolverConvergence && !rootSolverConverged) return fail('root-solver-not-converged');
  if (!roots.length) return fail('no-real-root');
  // 단계 ⑤⑥
  const F = ([s1, s2, s3]) => [
    s2 * s2 + s3 * s3 - 2 * s2 * s3 * ca - a2,
    s1 * s1 + s3 * s3 - 2 * s1 * s3 * cb - b2,
    s1 * s1 + s2 * s2 - 2 * s1 * s2 * cg - c2,
  ];
  const resNorm = f => Math.max(Math.abs(f[0]), Math.abs(f[1]), Math.abs(f[2]));
  const sumSq = a2 + b2 + c2;
  const candidates = [];
  for (const v of roots) {
    const q = 1 + v * v - 2 * v * cb;
    if (!(q > 0)) continue;
    const s1 = b / Math.sqrt(q);
    const den = polyEval(D, v);
    const us = [];
    // ⚠ 유리식 가지는 **항상** 넣어요(유한하면). 분모 상쇄 대역에서는 여기에 **더해** 2 차식 가지도 넣어요 —
    //   옛 구현은 둘 중 하나만 골랐고 문턱이 1e-12 라 상쇄 대역(실측 ≈7e-6 까지)을 전부 유리식 가지로 처리해
    //   참 가지를 잔차 게이트에서 잃었어요(증인 trial 25619: |D(v*)| = 5.523e-6 → 최량 5.330e+0 deg).
    const ratio = polyEval(Nu, v) / den;
    if (Number.isFinite(ratio)) us.push(ratio);
    if (Math.abs(den) < denomEps * (Math.abs(2 * cg) + Math.abs(2 * ca * v) + 1)) {
      const disc = cg * cg - 1 + (c2 / b2) * q;
      if (disc >= 0) { us.push(cg + Math.sqrt(disc)); if (disc > 0) us.push(cg - Math.sqrt(disc)); }
    }
    for (const u of us) {
      let s = [s1, u * s1, v * s1];
      if (!s.every(Number.isFinite)) continue;
      let f = F(s), fn = resNorm(f);
      for (let it = 0; it < 3; it += 1) { // 3×3 Newton 다듬기(잔차가 줄 때만 채택)
        const [S1, S2, S3] = s;
        const Jm = [0, 2 * S2 - 2 * S3 * ca, 2 * S3 - 2 * S2 * ca, 2 * S1 - 2 * S3 * cb, 0, 2 * S3 - 2 * S1 * cb, 2 * S1 - 2 * S2 * cg, 2 * S2 - 2 * S1 * cg, 0];
        const dx = solveLinear(Jm, f, 3);
        if (!dx) break;
        const ns = [S1 - dx[0], S2 - dx[1], S3 - dx[2]];
        const nf = F(ns), nn = resNorm(nf);
        if (!(nn < fn)) break;
        s = ns; f = nf; fn = nn;
      }
      if (!(fn <= residualTol * sumSq)) { diagnostics.droppedResidual += 1; continue; }
      candidates.push({ s, fn });
    }
  }
  candidates.sort((x, y) => (x.s[0] - y.s[0]) || (x.s[1] - y.s[1]) || (x.s[2] - y.s[2]) || (x.fn - y.fn));
  // 중복 제거는 **상대** 허용오차로 해요(옛 절대 1e-9·longest 는 near-double root 에서 같은 해를 둘로 셌어요).
  // 같은 무리 안에서는 대수 잔차가 작은 쪽을 남겨요(결정적: 잔차 동률이면 depths 사전순 앞쪽).
  const kept = [];
  for (const cand of candidates) {
    let merged = false;
    for (let i = 0; i < kept.length; i += 1) {
      const q0 = kept[i].s;
      const rel = Math.max(
        Math.abs(cand.s[0] - q0[0]) / Math.max(1e-300, Math.abs(q0[0])),
        Math.abs(cand.s[1] - q0[1]) / Math.max(1e-300, Math.abs(q0[1])),
        Math.abs(cand.s[2] - q0[2]) / Math.max(1e-300, Math.abs(q0[2])),
      );
      if (rel <= 1e-6) { merged = true; if (cand.fn < kept[i].fn) kept[i] = cand; break; }
    }
    if (!merged) kept.push(cand);
  }
  // 보존 상한: P3P 는 최대 4 해예요. 가지 두 개(유리식·2 차식)를 함께 넣으면 수치적으로 5 개가 될 수 있어
  // 대수 잔차가 작은 4 개만 남기고 나머지는 droppedOverflow 로 세요.
  if (kept.length > maxSolutions) {
    kept.sort((x, y) => (x.fn - y.fn) || (x.s[0] - y.s[0]) || (x.s[1] - y.s[1]) || (x.s[2] - y.s[2]));
    diagnostics.droppedOverflow = kept.length - maxSolutions;
    kept.length = maxSolutions;
    kept.sort((x, y) => (x.s[0] - y.s[0]) || (x.s[1] - y.s[1]) || (x.s[2] - y.s[2]));
  }
  const Ew = frame(P[0], P[1], P[2]);
  for (const { s } of kept) {
    const Qc = [scale(J[0], s[0]), scale(J[1], s[1]), scale(J[2], s[2])];
    if (!(s[0] > 0 && s[1] > 0 && s[2] > 0 && Qc[0][2] > 0 && Qc[1][2] > 0 && Qc[2][2] > 0)) { diagnostics.droppedBehind += 1; continue; }
    const Fc = frame(Qc[0], Qc[1], Qc[2]);
    if (!Ew || !Fc) continue;
    // R = F·Eᵀ (열 = 프레임 벡터)
    const Fm = [Fc[0][0], Fc[1][0], Fc[2][0], Fc[0][1], Fc[1][1], Fc[2][1], Fc[0][2], Fc[1][2], Fc[2][2]];
    const Et = [Ew[0][0], Ew[0][1], Ew[0][2], Ew[1][0], Ew[1][1], Ew[1][2], Ew[2][0], Ew[2][1], Ew[2][2]];
    const R = mat3Mul(Fm, Et);
    const mP = scale([P[0][0] + P[1][0] + P[2][0], P[0][1] + P[1][1] + P[2][1], P[0][2] + P[1][2] + P[2][2]], 1 / 3);
    const mQ = scale([Qc[0][0] + Qc[1][0] + Qc[2][0], Qc[0][1] + Qc[1][1] + Qc[2][1], Qc[0][2] + Qc[1][2] + Qc[2][2]], 1 / 3);
    const t = sub(mQ, mat3Apply(R, mP));
    // ⚠ selfConsistency = 「닫힌 해가 자기 자신과 모순이 없는가」(R·t 가 Q_i = s_i·J_i 를 재현하는가)예요.
    //   **관측 적합도가 아니에요** — R·t 를 그 Q_i 에 맞추도록 구성하니 항등적으로 ~1e-14 rad 이고, σ=5 px 잡음에서도
    //   같은 값이 나와요(실측, 파일 머리 §selfConsistency). 후보 순위·필터링에 쓰면 안 돼요. 적합도가 필요하면
    //   xPoseLM 의 rmsPx 를 쓰세요.
    let selfConsistency = 0;
    for (let i = 0; i < 3; i += 1) {
      const cpt = sub(mat3Apply(R, P[i]), scale(t, -1));
      const dir = unit(cpt);
      if (!dir) { selfConsistency = Infinity; break; }
      const sn = norm(cross(dir, J[i])), cs = dot(dir, J[i]);
      selfConsistency = Math.max(selfConsistency, Math.atan2(sn, cs));
    }
    if (!Number.isFinite(selfConsistency)) continue;
    out.push({ R, t, depths: s, selfConsistency });
  }
  if (!out.length && diagnostics.reason === 'ok') {
    // 실근은 있었는데 후보가 전부 잔차 게이트에서 탈락 = 조건수 문제('ill-conditioned').
    // 「퇴화라 거절」(collinear-points) 도 「기하가 실근을 안 준다」(no-real-root) 도 아니에요 — 파일 머리 §하한 참조.
    if (diagnostics.droppedBehind) diagnostics.reason = 'all-behind-camera';
    else if (diagnostics.droppedResidual > 0 && diagnostics.realRoots > 0) diagnostics.reason = 'ill-conditioned';
    else diagnostics.reason = 'no-valid-solution';
  }
  return out;
}

/** 3 점의 정규직교 프레임 [e1,e2,e3] — e1 = P2−P1 방향, e3 = e1×(P3−P1) 방향, e2 = e3×e1. 공선이면 null. */
function frame(p1, p2, p3) {
  const e1 = unit(sub(p2, p1));
  if (!e1) return null;
  const e3 = unit(cross(e1, sub(p3, p1)));
  if (!e3) return null;
  return [e1, cross(e3, e1), e3];
}

// ───────────────────────────── LM ─────────────────────────────
/**
 * bounded Levenberg–Marquardt pose 다듬기(파일 머리 «LM» 절).
 * @param {{points:number[][], pixels:number[][], camera:object, R0:number[], t0:number[]}} in
 * @param {{maxIter?:number, lambda?:number, lambdaMax?:number, tol?:number, maxStep?:{rotRad?:number, trans?:number}, rankTol?:number}} opts
 *   `lambda` 는 Marquardt 상대 감쇠의 **초기값**이고 `lambdaMax`(기본 1e12) 를 넘을 때까지 거부마다 ×10 올려요.
 *   `maxIter` 는 **채택된 스텝** 수예요 — 거부는 바깥 반복을 소비하지 않아요(표준 LM).
 * @returns {{R:number[], t:number[], rmsPx:number, maxPx:number, iterations:number, converged:boolean, reason:string,
 *   lambda:number, cost:number, rejectedSteps:number, maxConsecutiveRejects:number}}
 *   ⚠ converged:true 는 「극소에 도달」이지 「참 pose」가 아니에요 — 참·거짓은 rmsPx 로 가르세요.
 */
export function xPoseLM({ points, pixels, camera, R0, t0 } = {}, opts = {}) {
  const { maxIter = 20, lambda: lambda0 = 1e-3, lambdaMax = 1e12, tol = 1e-10, rankTol = 1e-10 } = opts;
  assertXCamera(camera);
  if (!Array.isArray(points) || !Array.isArray(pixels) || points.length !== pixels.length) throw new TypeError('points·pixels 는 같은 길이의 배열이어야 해요');
  if (!Array.isArray(R0) || R0.length !== 9 || !Array.isArray(t0) || t0.length !== 3) throw new TypeError('R0(9)·t0(3) 이어야 해요');
  const n = points.length;
  let rejectedSteps = 0, maxConsecutiveRejects = 0;
  const done = (R, t, cost, maxPx, iterations, converged, reason, lambda) => ({
    R, t, rmsPx: Number.isFinite(cost) && n > 0 ? Math.sqrt(cost / n) : NaN, maxPx, iterations, converged, reason, lambda, cost,
    rejectedSteps, maxConsecutiveRejects,
  });
  if (n < 3) return done(R0, t0, NaN, NaN, 0, false, 'need-at-least-3-points', lambda0);
  for (let i = 0; i < n; i += 1) {
    if (!finite3(points[i])) return done(R0, t0, NaN, NaN, 0, false, 'non-finite-input', lambda0);
    if (!Array.isArray(pixels[i]) || pixels[i].length < 2 || !Number.isFinite(pixels[i][0]) || !Number.isFinite(pixels[i][1])) return done(R0, t0, NaN, NaN, 0, false, 'non-finite-input', lambda0);
  }
  for (let i = 0; i < 9; i += 1) if (!Number.isFinite(R0[i])) return done(R0, t0, NaN, NaN, 0, false, 'non-finite-input', lambda0);
  if (!finite3(t0)) return done(R0, t0, NaN, NaN, 0, false, 'non-finite-input', lambda0);
  let R = xOrthonormalizeRotation(R0);
  if (!R || !xIsRotation(R0, 1e-6)) return done(R0, t0, NaN, NaN, 0, false, 'R0-not-a-rotation', lambda0);
  let t = [t0[0], t0[1], t0[2]];
  // 스텝 경계 기본값: 회전 0.5 rad, 이동 = max(|t0|, 점 반경)
  const centre = [0, 0, 0];
  for (const p of points) { centre[0] += p[0] / n; centre[1] += p[1] / n; centre[2] += p[2] / n; }
  let radius = 0;
  for (const p of points) radius = Math.max(radius, norm(sub(p, centre)));
  const rotRad = opts.maxStep?.rotRad ?? 0.5;
  const trans = opts.maxStep?.trans ?? Math.max(norm(t0), radius, 1e-300);
  const { fx, fy, cx, cy } = camera;
  // 오차 평가: Z ≤ 0 인 점이 있으면 null
  const evaluate = (Rm, tv) => {
    let cost = 0, maxPx = 0;
    const cams = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const cpt = mat3Apply(Rm, points[i]);
      const X = cpt[0] + tv[0], Y = cpt[1] + tv[1], Z = cpt[2] + tv[2];
      if (!(Z > 0)) return null;
      const du = pixels[i][0] - (fx * X / Z + cx), dv = pixels[i][1] - (fy * Y / Z + cy);
      const e2 = du * du + dv * dv;
      if (!Number.isFinite(e2)) return null;
      cost += e2; if (e2 > maxPx) maxPx = e2;
      cams[i] = [X, Y, Z, du, dv];
    }
    return { cost, maxPx: Math.sqrt(maxPx), cams };
  };
  let cur = evaluate(R, t);
  if (!cur) return done(R, t, NaN, NaN, 0, false, 'behind-camera-initial', lambda0);
  let lambda = lambda0, iterations = 0;
  // 정규방정식 조립: δ = [δω(3), δt(3)], c' ≈ c + δω×(R·P) + δt → ∂c/∂δω = −[R·P]×
  const assemble = () => {
    const A = new Array(36).fill(0), g = new Array(6).fill(0);
    for (let i = 0; i < n; i += 1) {
      const [X, Y, Z, du, dv] = cur.cams[i];
      const q = [X - t[0], Y - t[1], Z - t[2]]; // R·P
      // ∂c/∂δ (3×6): 열 0..2 = −[q]×, 열 3..5 = I
      const dc = [
        [0, q[2], -q[1], 1, 0, 0],
        [-q[2], 0, q[0], 0, 1, 0],
        [q[1], -q[0], 0, 0, 0, 1],
      ];
      const iz = 1 / Z;
      const ju = new Array(6), jv = new Array(6);
      for (let k = 0; k < 6; k += 1) {
        ju[k] = fx * (dc[0][k] * iz - X * iz * iz * dc[2][k]);
        jv[k] = fy * (dc[1][k] * iz - Y * iz * iz * dc[2][k]);
      }
      for (let r = 0; r < 6; r += 1) {
        g[r] += ju[r] * du + jv[r] * dv;
        for (let k = 0; k < 6; k += 1) A[r * 6 + k] += ju[r] * ju[k] + jv[r] * jv[k];
      }
    }
    return { A, g };
  };
  let { A, g } = assemble();
  if (normalizedPivotRatio(A, 6) < rankTol) return done(R, t, cur.cost, cur.maxPx, 0, false, 'degenerate-jacobian', lambda);
  let needAssemble = false;
  for (; iterations < maxIter;) {
    iterations += 1;
    if (needAssemble) { ({ A, g } = assemble()); needAssemble = false; }
    // ── 안쪽 λ-상승 고리(표준 LM): 스텝이 받아들여질 때까지 λ ← λ·10. 거부는 바깥 반복을 소비하지 않아요.
    //    예전의 「거부 3회 연속 → diverged」는 λ 를 1e-3·10³ = 1 까지밖에 못 올려 회복 가능한 하강을 죽였어요.
    let accepted = null, consecutiveFail = 0;
    for (;;) {
      const Ad = A.slice();
      for (let i = 0; i < 6; i += 1) Ad[i * 6 + i] += lambda * A[i * 6 + i];
      const delta = solveLinear(Ad, g, 6);
      if (!delta) return done(R, t, cur.cost, cur.maxPx, iterations, false, 'singular-normal-equations', lambda);
      const stepInf = Math.max(...delta.map(Math.abs));
      const tiny = stepInf <= tol * (1 + Math.max(norm(t), 1));
      // λ < 1 (Gauss–Newton 체제) 에서 스텝이 tol 밑 = 정상 수렴. λ ≥ 1 인데도 tol 밑이면 감쇠에 눌려 멈춘 것.
      if (lambda < 1 && tiny) return done(R, t, cur.cost, cur.maxPx, iterations, true, 'step-below-tol', lambda);
      // 경계: 방향 유지 축소
      const wn = Math.hypot(delta[0], delta[1], delta[2]), tn = Math.hypot(delta[3], delta[4], delta[5]);
      const k = Math.min(1, wn > 0 ? rotRad / wn : 1, tn > 0 ? trans / tn : 1);
      const dw = [delta[0] * k, delta[1] * k, delta[2] * k], dt = [delta[3] * k, delta[4] * k, delta[5] * k];
      const Rn = xOrthonormalizeRotation(mat3Mul(xExpSO3(dw), R));
      const tn2 = [t[0] + dt[0], t[1] + dt[1], t[2] + dt[2]];
      const nxt = Rn ? evaluate(Rn, tn2) : null;
      if (nxt && nxt.cost <= cur.cost) { accepted = { Rn, tn2, nxt }; break; }
      // 거부: 카메라 뒤 · 비유한 · 오차 증가 → λ 를 올려 다시 시도
      const tag = nxt ? 'cost-increase' : 'behind-camera-or-non-finite';
      rejectedSteps += 1; consecutiveFail += 1;
      if (consecutiveFail > maxConsecutiveRejects) maxConsecutiveRejects = consecutiveFail;
      // 감쇠가 이미 지배적인데(λ ≥ 1) 경계 축소 후 스텝이 언더플로하면 더 올려도 소용없어요.
      if (lambda >= 1 && tiny) return done(R, t, cur.cost, cur.maxPx, iterations, false, `diverged(step-underflow:${tag})`, lambda);
      lambda *= 10;
      if (!(lambda <= lambdaMax)) return done(R, t, cur.cost, cur.maxPx, iterations, false, `diverged(lambda-max:${tag})`, lambda);
    }
    const prevCost = cur.cost;
    R = accepted.Rn; t = accepted.tn2; cur = accepted.nxt; needAssemble = true;
    lambda = Math.max(lambda / 10, 1e-12);
    if (cur.cost < 1e-30) return done(R, t, cur.cost, cur.maxPx, iterations, true, 'cost-zero', lambda);
    if ((prevCost - cur.cost) <= tol * prevCost) return done(R, t, cur.cost, cur.maxPx, iterations, true, 'converged', lambda);
  }
  return done(R, t, cur.cost, cur.maxPx, iterations, false, 'max-iterations', lambda);
}
