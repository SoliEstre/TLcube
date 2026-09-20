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
 *          때만 채택) → **다듬은 잔차**로 실근 판정(**크기 상대 후방 오차** |p(x)| ≤ rootTol·Σ|c_i·xⁱ|, 또는
 *          |Im| ≤ imagTol·max(1,|Re|)) → 근사 중복 제거(|Δv| ≤ 1e-9·max(1,|v|)) → v 오름차순 정렬(결정적 순서).
 *          ⚠ 고정 |Im| 컷을 **먼저** 걸지 않는 게 핵심이에요 — 자세한 근거는 xPolyRealRoots 의 주석.
 *          ⚠ 잔차의 분모는 **항별 절대합** Σ|c_i|·|x|ⁱ 이어야 해요(2026-09-20 2차 수정). 옛 분모 Σ|c_i|·max(1,|x|)ⁿ 은
 *          근 크기에 맹목이라 |x| 가 크면 rootTol 이 무력해졌어요 — 실측(a5): 근 1000±0.5i 의 복소 쌍이 «실근 1000» 으로
 *          새고 converged=true 를 달았어요(p(1000) = 2.4875e+5). 후방 오차는 스케일 불변이라 이 구멍이 없어요.
 *   단계 ⑤ 각 v 에 대해 u = Nu(v)/D(v) 를 **항상** 후보로 넣고, 분모 |D(v)| 가 상대 denomEps 밑이면 ③ 의 u 2차식
 *          두 근을 **더해** 넣어요(둘 중 하나를 고르는 게 아니라 합집합 — 참 가지를 잃지 않으려는 것이에요).
 *          denomEps 기본 **1e-4**(2026-09-20 4차 수정, 반박자 m5b·m6): 옛 기본 1e-6 은 정규화 minDenom 1.1e-6…3.7e-5 에서
 *          참 가지 상실을 실측했어요 — 캠페인 σ=0 300k 중 3 건(minDenom 1.198e-5 · 4.803e-6 · 3.723e-5, 최량 10.27 · 6.698 ·
 *          0.1572 deg, 셋 다 reason 'ok'), 접선 대역(삼중 [309,485,441], az ±3e-4 rad 창 601 점)의 31 %(188 점) → 1e-4 에서
 *          둘 다 0. 대가: 두 가지 합집합이 더 자주 들어와 후보 수가 늘 뿐, 해 집합은 A/B(σ=0 100k ×2 · σ 0.5/1.4 각 50k)
 *          에서 무작위 팔 1 건 외 동일·droppedOverflow 0 이에요(★ 자가 3 건을 상수 증인으로 잠가요).
 *          s1 = b/√(1+v²−2v·cosβ), s2 = u·s1, s3 = v·s1. 그 뒤 원래 3식(단계 ①)에 대한 3×3 Newton 다듬기 ≤ 3회
 *          (잔차가 줄 때만 채택). ⚠ 이 다듬기는 **잘 조건화된 입력에서만** 깊이를 기계 정밀도까지 끌어요. 면적비
 *          ≲1e-3 대역에서는 3 회 상한이 p99·max 를 남기고(반박자 probe-h, h=1e-5: p99 8.4e-2 → 백트래킹×20 이면
 *          1.1e-3 deg), h=1e-4 는 반복을 늘려도 5.222e+1 deg 그대로이며, h=1e-3 은 백트래킹이 오히려 악화(1.636e+0 →
 *          2.735e+0 deg)예요 — **반복을 늘려도 단조 회복이 아니에요**. 캠페인 조건(N=8 격자·dOW 3)에서는 이 축이
 *          안 보여요(probe-b 「10× 손실」 0 건). 상한을 바꾸려면 h 사다리 4 칸 전부의 p99·max 를 같이 보고 정하세요 —
 *          한 칸만 보면 뒤집혀요. 이 A/B 는 자로 잠그지 않아요(정답이 거부돼요) — 기록으로만 남겨요.
 *   단계 ⑥ 3식 잔차(상대 residualTol) 로 검증(탈락 = droppedResidual, 통과 = candidates) → **이 순서로** 후처리(정본
 *          xP3PSelectCandidates): 깊이 s_i ≤ 0 또는 Z_i = s_i·j_i[2] ≤ 0 이면 카메라 뒤(제외 + droppedBehind) → 상대 1e-6
 *          dedup(dedupMerged) → maxSolutions 절단(droppedOverflow, 대수 잔차 큰 쪽부터). ⚠ 뒤 필터가 **먼저**예요(4차 수정,
 *          외부 검토 agy C-1): 옛 순서(dedup → 절단 → 뒤 필터)는 잔차 작은 뒤 후보가 슬롯을 차지해 유효 실근을 overflow 로
 *          버리는 경로가 있었어요. 회계: candidates − droppedBehind − dedupMerged − droppedOverflow = 반환 해 수. →
 *          절대 방향: 세계·카메라 삼각형에 같은 정규직교 프레임(e1 = P2−P1 방향, e3 = e1×(P3−P1) 방향, e2 = e3×e1)을 세워
 *          R = F·Eᵀ, t = mean(Q) − R·mean(P) → selfConsistency = 3 점의 재투영 각오차(라디안, 최대값).
 *   퇴화 거절(명시): 비유한 입력 · 공선 세계점 · 일치/반대 방향 bearing(|j_i×j_j| < eps) · **근 solver 미수렴**
 *          ('root-solver-not-converged'; requireRootSolverConvergence 로 끌 수 있어요).
 *
 * ── ⚠ selfConsistency 는 **적합도가 아니에요** — 잡음 축엔 무반응, 조건수 축에서는 움직여요 ──────────────────
 *   R·t 는 Q_i = s_i·J_i 를 정확히 맞추도록 «구성» 되므로 이 값은 **잡음 축에 무반응**이에요(σ 0→5 px 에서 불변).
 *   실측(250 pose × 무작위 삼중, 2026-09-20 수정본): σ=0 최대 1.688e-14 · σ=0.5 2.193e-14 · σ=1.4 4.926e-14 ·
 *   σ=5 px 3.167e-14 rad — 같은 코퍼스의 실제 회전오차는 최대 ~1.8e+2 deg 예요. 그러니 **적합도(관측과 맞는가)로는
 *   쓸 수 없어요**. 적합도가 필요하면 **xPoseLM 의 rmsPx** 를 쓰세요. (옛 이름 `residual` 은 제거했어요 — 이름이
 *   그대로면 다음 소비자가 또 점수로 써요. stage2-context 스키마의 residual 자리에는 rmsPx 를 넣으세요.)
 *   그러나 **조건수 축에서는 1e-14 → 1e-7 rad 까지 움직여요**(반박자 a7 실측, 2026-09-20): 무작위 삼중 ≤ 5e-14 ·
 *   격자 최악 삼중(WORST_TRIPLES) 최대 3.470e-12(σ=0.2) · ★사다리① h=1e-8 의 「ok 인데 7.140e+1 deg 틀린」 해에서
 *   3.427e-10, 2.089e-7 rad — 정상 대비 7 decade 위라 **그 케이스를 가르는 신호**예요. 옛 머리는 «항등적으로 1e-14,
 *   순위에 쓰지 마라» 로 못 박았는데 그건 잡음 축만 본 문장이었어요.
 *   ⇒ 소비자 안내: **적합도는 rmsPx, 조건수 경보는 selfConsistency + bearingSolidAngle**. 이 값이 1e-9 rad 위면
 *      닫힌 해 자체가 자기 3 점을 못 맞추는 붕괴 대역이에요(★ 자가 코퍼스별 상한으로 잠가요: 무작위 1e-12 ·
 *      최악삼중 1e-11 · 붕괴대역 1e-9 초과 양성 단언).
 *
 * ── ⚠ 「선언된 거절선」과 「실측 사용 하한」은 9 decade 떨어져 있어요 — 섞어 읽으면 안 돼요 ─────────────────────
 *   면적비 ≡ |e12 × e13| / (최장 변)² = **2·삼각형 면적 / (최장 변)²**  (diagnostics.areaRatio 로 반환해요 — 코드
 *   src 의 norm(cross(e12,e13))/longest² 그대로. 옛 머리의 «면적/(최장 변)²» 은 2× 틀린 정의였어요).
 *   · 면적비 < eps(기본 1e-12) → 'collinear-points' 로 **거절**. 이게 선언된 퇴화선이에요.
 *   · 면적비 1e-12 … ≈1.5e-3 → 거절선엔 안 걸리지만 조건수 때문에 후보가 잔차 게이트(residualTol)에서 전부 탈락해
 *     **빈 배열 + reason 'ill-conditioned'** 로 나와요. 「퇴화라 거절」이 아니라 「이 자로는 못 푼다」예요.
 *     ⚠ **이 대역은 단조롭지도 않고 안전하지도 않아요**: 실측(고정 pose·정확 투영, 2026-09-20 수정본) 면적비
 *     1e-8 칸에서는 해 2 개가 reason 'ok' 로 나오는데 최량 회전오차가 7.140e+1 deg 예요. 즉 붕괴 대역에서는
 *     「해가 없음」도 「해가 있음」도 신뢰 신호가 아니에요 — diagnostics.bearingSolidAngle 를 같이 보세요.
 *   · ⚠ **붕괴를 정하는 건 세계 공간 면적비가 아니라 화면 부분각이에요.** 아래 §부분각 참조. 옛 주석은 「N=8 격자
 *     삼중은 면적비 ≥ 1.1498e-2 라 이 붕괴 대역이 구조적으로 안 생겨요」라고 조건 없이 적었는데, 그건 **단계 ②
 *     캠페인 조건(distanceOverWidth 3, 320×240, fov 40°) 한정**으로만 맞아요. 같은 격자·같은 면적비라도 카메라를
 *     멀리 밀면 같은 붕괴가 그대로 나요. 덤으로 그 숫자도 틀렸어요 — N=8 격자 최소 양수 면적비는 **1.05538e-2**
 *     (삼중 전수 22,238,720 · 완전 공선 36,992, 반박자 a3 실측 2026-09-20; test 의 WORST_TRIPLES 가 정확히 이 값)이고
 *     registry 의 다른 유효 프로파일 **N=10 은 6.2576e-3**(반박자 probe-i 전수, N=8 의 59 %)이에요. 둘 다 붕괴 문턱
 *     ≈1.5e-3 위예요. test 가 N=8 값은 격자에서 다시 유도해 단언하고, N=10 은 알려진 최악 삼중으로 재요.
 *     ⚠ 그건 σ=0 논거예요 — **잡음 체제에서는 N=10 최악삼중이 N=8 최악삼중 대비 해없음 1.3~1.7× · 중앙 1.8~1.9× 나빠요**
 *     (반박자 b1 실측 2026-09-20, seed 3342109001 × 600: σ=0.05 해없음 59 vs 34 · 중앙 2.674 vs 1.431 deg, σ=0.2 108 vs 78 ·
 *     9.658 vs 5.179, σ=0.5 156 vs 117 · 21.67 vs 12.10; 정본은 test 의 OBSERVED.worstTriples10). 무작위 삼중 팔은 N=10 도
 *     N=8 과 같은 자릿수라 문제는 최악삼중 축이에요. pitch 2.5 는 pitch 1 과 바이트 동일(b1).
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
 *   **호출당 후속 검증 건수** — 단계 ② 예산식의 두 번째 입력이에요. P3P 는 호출마다 해를 **평균 ≈2 개** 내고 그
 *   절반 이상이 참 pose 가 아니에요(반박자 a8 실측, 캠페인 dOW=3 · in-frame · 3000 호출/σ, 2026-09-20):
 *     σ=0     평균 2.060 해/호출 · 5 deg 초과 해 51.0 % · 해 개수 분포 0/1/2/3/4 = 7/8/2883/2/100
 *     σ=0.097 2.041 · 51.7 %   σ=0.5 2.021 · 54.5 %   σ=1.4 2.007 · 64.3 %
 *   즉 호출 1 회 = 후속 검증(LM·RS) **≈2 건**이고 그중 ≈1 건은 버려질 가설이에요. selfConsistency 로는 이 둘을
 *   못 가르니(§selfConsistency) 판별 부담은 그대로 단계 ② 로 넘어가요 — 예산식에 «호출 수 × 2» 로 적으세요.
 *   test 의 잡음 사다리가 칸마다 평균 해 개수·오답 해 비율을 성질로 단언해요(OBSERVED.randomTriples 의 meanSols·wrongFrac).
 *
 * ── 오류 통로 규칙(2026-09-20 3차 수정, 반박자 b6 — 옛 파일은 throw / reason / 무검증 셋이 섞여 있었어요) ──────────
 *   **throw = 호출 형식 위반(프로그래머 오류)**: camera 객체(assertXCamera, 형제 x-project 와 같은 통로) · 컨테이너 형식
 *     (배열이 아님 · 길이 불일치 · R0(9)/t0(3) 아님). xBearingsFromPixels · xPoseLM 이 여기 해당해요.
 *   **reason = 값 오류(데이터·정책)**: 비유한 값 · 퇴화 기하 · **opts 값 범위**('invalid-options'). 단계 ② 는 정책 객체를
 *     프레임당 1008 회 먹이니 잘못된 옵션 하나가 프레임 전체를 죽이지 않게 두 함수 모두 던지지 않고 reason 으로 내요.
 *     xP3P 는 입력 전부를 데이터로 취급해 **reason 한 통로만** 써요(던지는 건 xBearingsFromPixels 의 camera 뿐).
 *   opts 검증 자는 둘이 같아요(finitePositive · isPlainObject): xP3P — maxSolutions 1 이상 정수 · eps/imagTol/residualTol/
 *   denomEps/rootTol 유한 양수 · requireRootSolverConvergence 불리언 · opts 는 객체(문자열·숫자·배열 거절, null/undefined 는
 *   기본값). xPoseLM — maxIter 1 이상 정수 · lambda/lambdaMax/tol/rankTol 유한 양수 · maxStep 은 객체이고 rotRad/trans 유한 양수.
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
 *   ⚠ 「스텝 < tol」은 **회전(rad)과 이동(세계 단위)을 따로** 재요 — 둘 다 «점의 변위 ≤ tol·L»(L = max(|t|, 점 반경),
 *   세계 길이): |δt|∞ ≤ tol·L **그리고** 점 반경·|δω|∞ ≤ tol·L. 옛 구현은 둘을 한 max 에 섞어 tol·(1+max(|t|,1)) 하나와 비교했는데 |t| 는
 *   pitch 에 비례하니 세계 단위만 바꿔도 같은 기하에서 reason 이 달라졌어요(반박자 probe-e: pitch 1e-4 에서
 *   converged/step-below-tol = 145/55, pitch 1 에서 100/100 — 정확도 피해는 0, 라벨만 달랐어요). 반박자가 제안한
 *   tol·(1+|t|) 도 «1 +» 절대항 탓에 |t| ≪ 1 에서 같은 병이 남아요(실측: pitch 1e-4 에서 diverged(step-underflow) 신설)
 *   — 그래서 절대항 없이 세계 길이만으로 재요. 회전을 라디안 절대 tol 로 재면 옛 실효 문턱(≈22·tol @pitch 1)보다 22× 엄격해져
 *   잡음 바닥에서 diverged(step-underflow) 를 새로 만들어요(실측 2/200) — 변위 등가로 재면 0 이에요. 이제 reason·converged 가
 *   세계 단위에 불변이에요(실측 pitch 1e-4…1e6: converged/step-below-tol = 166/34 전 구간, pitch 1 만 165/35 반올림 동률;
 *   test 가 잠가요).
 *   오차 0('cost-zero') · maxIter('max-iterations') · 초기 Z ≤ 0('behind-camera-initial') · 정규화 JᵀJ 랭크 결손
 *   ('degenerate-jacobian', 예: 공선 점) · 정규방정식 해 실패('singular-normal-equations') ·
 *   'diverged(lambda-max:…)' · 'diverged(step-underflow:…)' · opts 값 검증 실패('invalid-options', R0·t0 그대로 · rmsPx NaN ·
 *   converged false — 파일 머리 §오류 통로).
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
/** opts 값 검증 공용 자(xP3P · xPoseLM 이 같은 자를 써요 — 파일 머리 §오류 통로) */
const finitePositive = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

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
 * 균형화가 허용되는 근 크기 비 s_hi/s_lo 의 상한 — 이 안이면 «근이 전부 같은 자릿수» 라 v = s·w 로 옮겨도 뭉치지 않아요.
 * 혼합 스케일(비 > 1e4, 예: O(1) 근 셋 + 1e6 근 하나)은 균형화하면 참근을 잃어요(r1·r3 실측) — xPolyRealRoots 참조.
 * Fujiwara 상한은 참값의 ≲ 2n 배까지 느슨하니 균일 4 근의 비는 실측 ≲ 10 이고, 1e4 는 그 위에 넉넉히 둔 값이에요.
 */
const BALANCE_MAX_SPREAD = 1e4;

/** Fujiwara 류 근 크기 상한: s = max_i |c_i/c_n|^(1/(n−i)). c_n ≠ 0 인 p(낮은 차수부터). 다른 계수가 전부 0 이면 0. */
function rootScaleOf(p) {
  const n = p.length - 1;
  let s = 0;
  for (let i = 0; i < n; i += 1) if (p[i] !== 0) s = Math.max(s, Math.pow(Math.abs(p[i] / p[n]), 1 / (n - i)));
  return s;
}

/**
 * 실계수 다항식(낮은 차수부터, 차수 ≤ 4 를 상정하지만 일반)의 실근 전부 — 단계 ④ 그대로예요.
 *
 * 복소근 제외 규칙(2026-09-20 개정, 결함 ①-②): **고정 |Im| 컷을 먼저 걸지 않아요.** 모든 DK 근의 Re(z) 를 씨앗으로
 * 실수 Newton 을 돌린 뒤 **다듬은 잔차**로 판정해요 — 받아들이는 조건은
 *   (ㄱ) 크기 상대 **후방 오차** |p(x)| / Σ|c_i|·|x|ⁱ ≤ rootTol  **또는**  (ㄴ) |Im| ≤ imagTol·max(1,|Re|).
 * (ㄴ) 는 옛 규칙의 보존(잔차가 커도 «거의 실수» 면 씨앗으로 통과시켜 상위의 3×3 Newton 에 맡겨요)이고,
 * (ㄱ) 이 새로 열린 문이에요. 옛 구현은 near-tangent 쌍의 |Im| 이 1e-6 바로 위면 **참근을 Newton 에 닿기도 전에**
 * 버렸어요(증인 trial 11750: |Im| ∈ (1e-6, 1e-5), 정규화 다항식값 −8.878e-16 = 진짜 근).
 * ⚠ (ㄱ) 의 분모(2026-09-20 2차 수정): 옛 Σ|c_i|·max(1,|x|)ⁿ 은 |x| 가 크면 |x|ⁿ 만큼 부풀어 근이 아닌 점을 실근으로
 *   받았어요(a5: 근 1000±0.5i 쌍 → «실근 1000», p(1000)=2.4875e+5, converged=true). Σ|c_i|·|x|ⁱ 는 |p(x)| 의 자연
 *   상한이라 비 ≤ 1 이고 스케일 불변이에요 — «큰 근에서도 복소는 복소로 남는다» 를 test 가 |r| ≈ 1e2·1e3·1e4 로 잠가요.
 *   0 근 특례: c_0 = … = c_{m−1} = 0 이면 vᵐ 인수를 **대수적으로** 떼어 근 0 을 넣어요(후방 오차 자는 정확한 0 근에서
 *   0/0 이라 자로는 못 받아요).
 *
 * 차수 강등(2026-09-20 2차 수정, 반박자 probe-i): 옛 규칙 «정규화 선행 계수 < leadEps 면 pop» 은 스케일 의존이라
 * v⁴ − 1e16(실근 ±1e4) 을 degree 0 · roots [] · converged **true** 로 조용히 뭉갰어요. 이제
 *   · 정확히 0 인 선행 계수만 무조건 강등하고,
 *   · 0 이 아닌데 작으면 «강등한 다항식의 근 스케일 sd 에서 선행항 |c_n|·sdⁿ 이 나머지 항 대비 leadEps 밑인가» 로 갈라요
 *     — 밑이면 그 근은 «무한대 근»(P3P 4차식의 a4→0 = s1→0 퇴화 가지)이라 강등(`demoted` 에 세요), 아니면 근이
 *     전부 큰 것이라 v = s·w 로 **균형화**해서 풀고 근에 s 를 다시 곱해요(`rootScale`). 판정이 스케일 불변이라
 *     v⁴−1 과 v⁴−1e16 이 같은 답(±1, ±1e4)을 내요.
 *   · ⚠ 균형화는 **균일 스케일(s_hi/s_lo ≤ 1e4)에서만**(2026-09-20 3차 수정, 반박자 r1·r3). 2차 수정본은 상한만 보고
 *     균형화해 혼합 스케일 — O(1) 근 셋 + 큰 근 하나, 곧 P3P 의 A4→0 가지 — 에서 참근을 잃고 converged=false 를 냈어요.
 *     P3P 에서 실제로 났어요: 격자 삼중 [0,54,10] 의 Grunert 선행계수 A4 는 카메라 방향을 따라 연속으로 0 을 지나고,
 *     |A4|norm ≲ 1e-4 부터 2차 수정본의 균형화가 발동했으며(캠페인 dOW3·in-frame 300,000 호출 중 1, r6), |A4|norm ≲ 4e-7
 *     대역에서는 옛 구현이 참 pose 를 회복하던 입력을 'root-solver-not-converged' 로 0 개 거절했어요(r3c: Δaz=5e-9·5e-10·
 *     ±1e-10·0 전부). 옛 «P3P 4차식에서는 발동하지 않는다» 는 틀린 문장이었어요 — 무작위 코퍼스가 그 대역을 안 지났을 뿐
 *     연속 pose 경로는 반드시 지나요. 이제 그 대역은 혼합 스케일이라 균형화 없이 비균형 DK 경로를 타요(test 가 Δaz ∈
 *     {±1e-8, ±1e-9, ±1e-10, 0} 로 잠가요).
 *
 * 수렴 판정(결함 ②): 옛 종료 문턱 「상대 스텝 < 1e-16」은 배정도에서 사실상 도달 불가라 호출의 98.33 % 가 500 회를
 * 끝까지 돌았고(probe-o, 4000 시행) `converged` 는 98.43 % 오탐이었어요. 이제
 *   · 종료 = 상대 스텝 < stepTol(1e-14) · **정체**(스텝이 1e-6 밑인데 직전의 절반 밑으로 안 줄어든 것이 2 회 연속) · maxIter(기본 100)
 *   · `converged` = **모든 근의 후방 오차가 rootTol 이하**(스텝이 아니라 잔차로 정의)
 * 로 바꿨어요.
 *
 * @returns {{roots:number[], degree:number, droppedComplex:number, droppedComplexImag:number,
 *   converged:boolean, iterations:number, maxRootResidual:number, rootScale:number, demoted:number}}
 *   roots 는 오름차순 · degree 는 실제로 푼 차수(0 근 인수 포함, 강등분 제외) · rootScale 은 균형화 배율(보통 1)
 */
export function xPolyRealRoots(coeffs, { imagTol = 1e-6, leadEps = 1e-14, rootTol = 1e-10, maxIter = 100, stepTol = 1e-14 } = {}) {
  const bail = degree => ({ roots: [], degree, droppedComplex: 0, droppedComplexImag: 0, converged: false, iterations: 0, maxRootResidual: Infinity, rootScale: 1, demoted: 0 });
  if (!Array.isArray(coeffs) || !coeffs.length) return bail(-1);
  let p = coeffs.slice();
  for (const c of p) if (!Number.isFinite(c)) return bail(-1);
  const amax = Math.max(...p.map(Math.abs));
  if (!(amax > 0)) return bail(-1);
  p = p.map(c => c / amax);
  // 정확한 0 근(vᵐ 인수)은 대수적으로 떼어내요
  let zeroMult = 0;
  while (p.length > 1 && p[0] === 0) { p.shift(); zeroMult += 1; }
  // 선행 계수: 정확한 0 은 강등, 작은 값은 «무한대 근인가 / 근이 전부 큰가» 를 스케일 불변으로 갈라요
  let demoted = 0, rootScale = 1;
  for (;;) {
    while (p.length > 1 && p[p.length - 1] === 0) { p.pop(); demoted += 1; }
    const deg = p.length - 1;
    if (deg < 1 || Math.abs(p[deg]) >= leadEps) break;
    const q = p.slice(0, deg);
    let m = q.length - 1; while (m >= 0 && q[m] === 0) m -= 1;
    const sd = m >= 1 ? rootScaleOf(q.slice(0, m + 1)) : 0;
    if (m >= 1 && sd > 0) {
      let others = 0;
      for (let i = 0; i <= m; i += 1) others = Math.max(others, Math.abs(q[i]) * Math.pow(sd, i));
      if (Math.abs(p[deg]) * Math.pow(sd, deg) < leadEps * others) { p.pop(); demoted += 1; continue; }
    }
    break;
  }
  // 균형화 v = s·w — s 는 Fujiwara 근 상한을 2 의 거듭제곱으로 반올림한 값(정확한 스케일링: 계수에 반올림 오차를 안
  // 넣어요). 근 스케일이 sⁿ > 1/leadEps(전부 큼 — 선행 계수 미소인데 강등 불가) 또는 sⁿ < leadEps(전부 작음 — DK 의
  // 스텝·정체 판정이 |z| < 1 에서 절대치라 1e-9 급 근을 5 자리에서 멈춰요) 일 때만 O(1) 로 옮겨요. 문턱을 강등 규칙과
  // 같은 leadEps 에서 유도해 새 상수를 안 두어요.
  // ⚠ **혼합 스케일에서는 균형화하지 않아요**(2026-09-20 3차 수정, 반박자 r1·r3): 상한 s_hi 만 보고 v = s_hi·w 로 옮기면
  //   O(1) 근 셋 + 큰 근 하나(= P3P 의 A4→0 가지 모양)에서 O(1) 근들이 w ≈ 1e-9 무리로 뭉쳐 DK·Newton 이 못 가르고
  //   후방 오차 분모(Σ|c_i||w|ⁱ ≈ 1e-27)도 무너져 «복소» 로 버려졌어요 — r1: {0.5,1,2,1e8} 근 1.0 유실, {0.5,1,2,1e9…1e12}
  //   [1e9] 만 반환 · droppedComplex 3 · converged false. 옛 비균형 경로는 같은 입력을 1e12 까지 전부 맞게 풀었어요.
  //   그래서 근 **하한** s_lo(= 1/Fujiwara(계수 역순) — 역순 다항의 근이 1/근이라)를 같이 구해 s_hi/s_lo ≤ BALANCE_MAX_SPREAD
  //   (1e4, 균일 스케일)일 때만 균형화하고, 아니면 비균형 DK 경로를 그대로 타요. v⁴−1e16(±1e4, 비 1)은 여전히 균형화되고,
  //   균일 스케일 1e-9…1e8 도 그대로예요(test 가 둘 다 잠가요). P3P 의 A4→0 대역은 혼합 스케일이라 이 문으로 안 들어와요.
  if (p.length > 1) {
    const deg = p.length - 1;
    const s = rootScaleOf(p);
    const span = Math.pow(s, deg);
    // 역순 계수(p[0] ≠ 0 — 정확한 0 근은 위에서 뗐어요)의 Fujiwara 상한 = 1/min|근| 의 상한 → s_lo = 그 역수
    const sRevInv = rootScaleOf(p.slice().reverse());
    const sLo = sRevInv > 0 && Number.isFinite(sRevInv) ? 1 / sRevInv : 0;
    const uniform = sLo > 0 && s / sLo <= BALANCE_MAX_SPREAD;
    const s2 = uniform && s > 0 && Number.isFinite(s) && (span > 1 / leadEps || span < leadEps) ? Math.pow(2, Math.round(Math.log2(s))) : 1;
    if (s2 !== 1) {
      const balanced = p.map((c, i) => c * Math.pow(s2, i));
      if (!balanced.every(Number.isFinite)) return bail(p.length - 1 + zeroMult);
      const bmax = Math.max(...balanced.map(Math.abs));
      p = balanced.map(c => c / bmax);
      rootScale = s2;
    }
  }
  const n = p.length - 1;
  if (n < 1) {
    return { roots: zeroMult ? [0] : [], degree: n + zeroMult, droppedComplex: 0, droppedComplexImag: 0, converged: true, iterations: 0, maxRootResidual: 0, rootScale, demoted };
  }
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
  // 잔차 자 = 크기 상대 후방 오차 |p(x)| / Σ|c_i|·|x|ⁱ (분모는 |p(x)| 의 자연 상한 → 비 ≤ 1, 스케일 불변).
  const backwardError = (mag, ax) => {
    let den = 0, xi = 1;
    for (let i = 0; i <= n; i += 1) { den += Math.abs(p[i]) * xi; xi *= ax; }
    if (den > 0) return Number.isFinite(den) ? mag / den : (Number.isFinite(mag) ? 0 : Infinity);
    return mag === 0 ? 0 : Infinity;
  };
  let maxRootResidual = 0;
  for (const zk of z) {
    const [fr, fi] = cev(zk);
    const r = backwardError(Math.hypot(fr, fi), Math.hypot(zk[0], zk[1]));
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
    // (ㄴ) 는 균형화 전 v 단위로 재요(옛 규칙 보존)
    const nearReal = Math.abs(im) * rootScale <= imagTol * Math.max(1, Math.abs(re) * rootScale);
    if (Number.isFinite(x) && (backwardError(fx, Math.abs(x)) <= rootTol || nearReal)) reals.push(x);
    else { droppedComplex += 1; droppedComplexImag = Math.max(droppedComplexImag, Math.abs(im) * rootScale); }
  }
  if (zeroMult) reals.push(0);
  reals.sort((a, b) => a - b);
  // 근사 중복 제거는 균형화된 w 공간(근이 O(1))에서 — v 공간의 절대 1e-9 는 작은 근을 서로 삼켜요
  const roots = [];
  for (const r of reals) if (!roots.length || Math.abs(r - roots[roots.length - 1]) > 1e-9 * Math.max(1, Math.abs(r))) roots.push(r);
  return { roots: roots.map(r => r * rootScale), degree: n + zeroMult, droppedComplex, droppedComplexImag, converged, iterations, maxRootResidual, rootScale, demoted };
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
 * 단계 ⑥ 후처리 — 잔차 게이트를 통과한 후보 {s:[s1,s2,s3], fn} 목록을 **이 순서로** 걸러요:
 *   ① 카메라 뒤 필터: s_i ≤ 0 또는 Z_i = s_i·j_i[2] ≤ 0 이면 제외(droppedBehind)
 *   ② 상대 1e-6 dedup(dedupMerged) — 같은 무리에서 대수 잔차 fn 이 작은 쪽을 남겨요(동률이면 depths 사전순 앞쪽)
 *   ③ maxSolutions 절단(droppedOverflow) — fn 이 작은 쪽부터 남기고, 반환은 depths 사전순
 * 회계 항등식: candidates − droppedBehind − dedupMerged − droppedOverflow = 반환 해 수 (★ 자가 잠가요).
 * ⚠ 순서가 계약이에요(2026-09-20 4차 수정, 외부 검토 agy C-1 blocking): 옛 순서는 «dedup → 절단 → 뒤 필터» 라서 카메라 뒤
 *   후보가 잔차가 작아 maxSolutions 슬롯을 먼저 차지하면 **유효한 실근이 droppedOverflow 로 탈락**했어요 — «유한 실근 전부
 *   반환» 계약 위반 경로. 기본 maxSolutions 4 에서는 «앞 후보 5 이상 + 뒤 후보» 동시가 안 나와(두 순서의 해 집합·회계 필드가
 *   캠페인 σ=0 100k · 무작위 σ=0 100k · σ 0.5/1.4 각 50k · seed 4242 3k 전 건 동일, droppedOverflow 0) 안 보였지만 maxSolutions 1
 *   에서는 한눈에 보여요 — 옛 순서는 기본에서 해 ≥ 1 인 건 중 빈 배열('all-behind-camera' + droppedOverflow 1) 이 캠페인 σ=0
 *   320/100k · 무작위 σ=0 350/100k · σ=0.5 144/50k · σ=1.4 170/50k · seed 4242 7/3000 이었고(2026-09-20 f2 실측), 새 순서는 0.
 *   ★ 자가 «maxSolutions 1 이고 기본에서 해 ≥ 1 이면 정확히 1 반환» 을 실입력 증인 2 건 + 코퍼스로, 「뒤 2 + 유효 4 전부 반환」
 *   을 인공 후보 목록으로 잠가요. 뒤 필터를 먼저 하면 dedup·절단은 카메라 앞 후보끼리만 겨루므로 이 경로가 구조적으로 없어요.
 * 이 함수를 export 하는 이유는 하나예요 — 실제 입력으로는 «뒤 후보 2 + 유효 4» 를 만들기 어려워(두 가지가 함께 잔차 게이트를
 * 통과하는 상쇄 대역이 두 근에서 동시에 열려야 해요) 자가 **인공 후보 목록**으로 순서 계약을 직접 재요. xP3P 밖에서 쓸 일은 없어요.
 * @param {Array<{s:number[], fn:number}>} candidates 잔차 게이트 통과 후보(순서 무관)
 * @param {number[][]} J 카메라 단위 방향 3(Z 부호 판정에 [2] 만 써요)
 * @param {number} maxSolutions 1 이상 정수
 * @param {{droppedBehind:number, dedupMerged:number, droppedOverflow:number}} diagnostics 세 필드를 **더해서** 갱신해요
 * @returns {Array<{s:number[], fn:number}>} 유지 후보, depths 사전순
 */
export function xP3PSelectCandidates(candidates, J, maxSolutions, diagnostics) {
  // ① 카메라 뒤 필터 — dedup·절단보다 먼저(위 주석).
  const front = [];
  for (const cand of candidates) {
    const s = cand.s;
    if (!(s[0] > 0 && s[1] > 0 && s[2] > 0 && s[0] * J[0][2] > 0 && s[1] * J[1][2] > 0 && s[2] * J[2][2] > 0)) { diagnostics.droppedBehind += 1; continue; }
    front.push(cand);
  }
  front.sort((x, y) => (x.s[0] - y.s[0]) || (x.s[1] - y.s[1]) || (x.s[2] - y.s[2]) || (x.fn - y.fn));
  // ② 중복 제거는 **상대** 허용오차로 해요(옛 절대 1e-9·longest 는 near-double root 에서 같은 해를 둘로 셌어요).
  // 같은 무리 안에서는 대수 잔차가 작은 쪽을 남겨요(결정적: 잔차 동률이면 depths 사전순 앞쪽).
  // 기본 opts 에서도 실제로 발동해요(3차 수정 반박자 b5: σ=0 seed 4242 ×3000 중 2 건 — dedup 을 통째로 꺼도 초록이던 축) — test 가 잠가요.
  const kept = [];
  for (const cand of front) {
    let merged = false;
    for (let i = 0; i < kept.length; i += 1) {
      const q0 = kept[i].s;
      const rel = Math.max(
        Math.abs(cand.s[0] - q0[0]) / Math.max(1e-300, Math.abs(q0[0])),
        Math.abs(cand.s[1] - q0[1]) / Math.max(1e-300, Math.abs(q0[1])),
        Math.abs(cand.s[2] - q0[2]) / Math.max(1e-300, Math.abs(q0[2])),
      );
      if (rel <= 1e-6) { merged = true; diagnostics.dedupMerged += 1; if (cand.fn < kept[i].fn) kept[i] = cand; break; }
    }
    if (!merged) kept.push(cand);
  }
  // ③ 보존 상한: P3P 는 최대 4 해예요. 가지 두 개(유리식·2 차식)를 함께 넣으면 수치적으로 5 개가 될 수 있어
  // 대수 잔차가 작은 maxSolutions 개만 남기고 나머지는 droppedOverflow 로 세요.
  if (kept.length > maxSolutions) {
    kept.sort((x, y) => (x.fn - y.fn) || (x.s[0] - y.s[0]) || (x.s[1] - y.s[1]) || (x.s[2] - y.s[2]));
    diagnostics.droppedOverflow += kept.length - maxSolutions;
    kept.length = maxSolutions;
    kept.sort((x, y) => (x.s[0] - y.s[0]) || (x.s[1] - y.s[1]) || (x.s[2] - y.s[2]));
  }
  return kept;
}

/**
 * Grunert P3P — 유한 실근 전부(최대 4).
 * @param {{points:number[][], bearings:number[][]}} in 세계점 3 · 카메라 좌표계 방향 3(단위가 아니면 정규화)
 * @param {{eps?:number, imagTol?:number, residualTol?:number, denomEps?:number, rootTol?:number,
 *   requireRootSolverConvergence?:boolean, maxSolutions?:number}} opts
 * @returns {Array<{R:number[], t:number[], depths:number[], selfConsistency:number}> & {diagnostics:object}}
 *   ⚠ 옛 이름 `residual` 은 **없어졌어요** — `selfConsistency` 로 바뀌었고, 그 값은 **적합도가 아니에요**(아래 참조).
 *   배열에 `diagnostics` 속성(reason · droppedBehind(카메라 뒤 후보 수 — dedup·절단보다 **먼저** 세요) · droppedComplex ·
 *   droppedComplexImag · droppedResidual · droppedOverflow(카메라 앞 후보 중 maxSolutions 초과분) · candidates(잔차 게이트를
 *   통과한 후보 수) · dedupMerged(카메라 앞 후보 중 상대 1e-6 동치로 병합된 수) · quarticDegree · realRoots ·
 *   rootSolverConverged · rootSolverIterations · nearDoubleRoot · minDenom · areaRatio · minBearingSin · bearingSolidAngle)
 *   을 붙여요. 회계 항등식: candidates − droppedBehind − dedupMerged − droppedOverflow = 반환 해 수(xP3PSelectCandidates).
 *   퇴화·비유한은 빈 배열 + diagnostics.reason.
 *   정렬은 depths 사전순(결정적).
 *   reason 값: 'ok' · 'invalid-options'(opts 검증 실패 — 아래) · 'need-3-points-and-3-bearings' · 'non-finite-input' ·
 *   'collinear-points'(면적비 < eps 거절) · 'coincident-bearings' · 'root-solver-not-converged'(단계 ④ 미수렴 —
 *   stage2-context §잠긴 것의 «미수렴은 명시 거절») · 'no-real-root'(4차식 실근 0) · 'ill-conditioned'(실근은 있었는데
 *   잔차 게이트에서 전부 탈락 — 파일 머리 §하한) · 'no-valid-solution' · 'all-behind-camera'.
 *   opts 검증(2026-09-20 2차 수정, 반박자 a8): maxSolutions 는 1 이상 정수, eps·imagTol·residualTol·denomEps·rootTol 은
 *   유한 양수. 아니면 **던지지 않고** 빈 배열 + reason 'invalid-options' 로 다른 거절과 같은 통로로 나가요 — 옛 구현은
 *   maxSolutions −1 이 `kept.length = −1` 의 RangeError 로 호출자에게 그대로 샜고(단계 ② 는 고정 정책 객체를 프레임당
 *   1008 회 먹이니 한 번의 잘못된 옵션이 프레임 전체를 죽여요), 0 은 «no-valid-solution + droppedOverflow 2» 라는 오도하는
 *   회계를, NaN 은 비교가 false 라 상한이 조용히 꺼지는 결과를 냈어요.
 */
export function xP3P({ points, bearings } = {}, opts = {}) {
  const optsObj = opts ?? {};
  const optsIsObject = isPlainObject(optsObj);
  const {
    eps = 1e-12, imagTol = 1e-6, residualTol = 1e-9, denomEps = 1e-4, rootTol = 1e-10,
    requireRootSolverConvergence = true, maxSolutions = 4,
  } = optsIsObject ? optsObj : {};
  // areaRatio · minBearingSin · bearingSolidAngle 은 조건수 지표예요 — 소비자가 「퇴화(collinear-points)」와
  // 「조건수 탓 해 없음(ill-conditioned)」과 「기하가 진짜로 해를 안 주는 경우(no-real-root/no-valid-solution)」를
  // 가를 때 써요. ⚠ **붕괴를 정하는 건 세계 공간 areaRatio 가 아니라 화면 부분각**이에요(파일 머리 §부분각) —
  // 그 축의 지표가 bearingSolidAngle(세 bearing 이 만드는 입체각, sr) 이에요.
  const diagnostics = {
    reason: 'ok', droppedBehind: 0, droppedComplex: 0, droppedComplexImag: 0, droppedResidual: 0, droppedOverflow: 0,
    candidates: 0, dedupMerged: 0,
    quarticDegree: -1, realRoots: 0, rootSolverConverged: null, rootSolverIterations: 0,
    nearDoubleRoot: null, minDenom: null, areaRatio: null, minBearingSin: null, bearingSolidAngle: null,
  };
  const out = [];
  out.diagnostics = diagnostics;
  const fail = reason => { diagnostics.reason = reason; return out; };
  // opts 검증 — 실패도 던지지 않고 다른 거절과 같은 통로(빈 배열 + reason)로 나가요(파일 머리 §오류 통로).
  // 비객체 opts(문자열·숫자·배열)와 비불리언 requireRootSolverConvergence 도 invalid-options 예요(2026-09-20 3차, 반박자 b6:
  // 옛 구현은 'garbage'·42·{requireRootSolverConvergence:'yes'} 를 조용히 기본값으로 삼켰어요).
  if (!optsIsObject || typeof requireRootSolverConvergence !== 'boolean') return fail('invalid-options');
  if (!(Number.isInteger(maxSolutions) && maxSolutions >= 1) || ![eps, imagTol, residualTol, denomEps, rootTol].every(finitePositive)) return fail('invalid-options');
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
    //   옛 구현은 둘 중 하나만 골랐고 문턱이 1e-12 라 상쇄 대역을 전부 유리식 가지로 처리해 참 가지를 잔차 게이트에서
    //   잃었어요(증인 trial 25619: |D(v*)| = 5.523e-6 → 최량 5.330e+0 deg). 문턱 1e-6 도 모자랐어요(4차 수정, 반박자 m6):
    //   정규화 minDenom 1.1e-6…3.7e-5 에서 참 가지 상실 실측(캠페인 σ=0 300k 중 3, 접선 대역 az ±3e-4 rad 창의 31 %)
    //   → 기본 1e-4. 아래 문턱은 minDenom 과 같은 정규화(|2cg| + |2ca·v| + 1)라 diagnostics.minDenom 으로 바로 읽혀요.
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
  diagnostics.candidates = candidates.length;
  // 후처리 순서(카메라 뒤 필터 → dedup → maxSolutions 절단)는 xP3PSelectCandidates 가 정본이에요 — 순서 근거는 그 함수 주석.
  const kept = xP3PSelectCandidates(candidates, J, maxSolutions, diagnostics);
  const Ew = frame(P[0], P[1], P[2]);
  for (const { s } of kept) {
    const Qc = [scale(J[0], s[0]), scale(J[1], s[1]), scale(J[2], s[2])];
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
    //   **관측 적합도가 아니에요** — R·t 를 그 Q_i 에 맞추도록 구성하니 잡음 축엔 무반응이에요(σ=5 px 에서도 ~1e-14 rad).
    //   하지만 조건수 축에서는 1e-14 → 1e-7 rad 까지 움직여요(붕괴 대역 h=1e-8 의 «ok 인데 틀린» 해가 2.089e-7 rad).
    //   적합도는 xPoseLM 의 rmsPx, 조건수 경보는 이 값 + bearingSolidAngle 로(파일 머리 §selfConsistency).
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
 *   opts 값이 범위 밖(maxIter 1 이상 정수 아님 · lambda/lambdaMax/tol/rankTol 유한 양수 아님 · maxStep 비객체 또는 rotRad/trans
 *   유한 양수 아님 · opts 자체가 비객체)이면 던지지 않고 reason 'invalid-options' 로 나가요 — xP3P 와 같은 통로예요.
 * @returns {{R:number[], t:number[], rmsPx:number, maxPx:number, iterations:number, converged:boolean, reason:string,
 *   lambda:number, cost:number, rejectedSteps:number, maxConsecutiveRejects:number}}
 *   ⚠ converged:true 는 「극소에 도달」이지 「참 pose」가 아니에요 — 참·거짓은 rmsPx 로 가르세요.
 */
export function xPoseLM({ points, pixels, camera, R0, t0 } = {}, opts = {}) {
  // 호출 형식(camera · 컨테이너) 위반은 throw — 프로그래머 오류(파일 머리 §오류 통로)
  assertXCamera(camera);
  if (!Array.isArray(points) || !Array.isArray(pixels) || points.length !== pixels.length) throw new TypeError('points·pixels 는 같은 길이의 배열이어야 해요');
  if (!Array.isArray(R0) || R0.length !== 9 || !Array.isArray(t0) || t0.length !== 3) throw new TypeError('R0(9)·t0(3) 이어야 해요');
  const n = points.length;
  let rejectedSteps = 0, maxConsecutiveRejects = 0;
  const done = (R, t, cost, maxPx, iterations, converged, reason, lambda) => ({
    R, t, rmsPx: Number.isFinite(cost) && n > 0 ? Math.sqrt(cost / n) : NaN, maxPx, iterations, converged, reason, lambda, cost,
    rejectedSteps, maxConsecutiveRejects,
  });
  // opts 값 검증은 xP3P 와 같은 통로(reason 'invalid-options', 던지지 않음) — 2026-09-20 3차 수정, 반박자 b6: 옛 구현은
  // 검증이 없어 {lambda:-1} 이 converged:true 로, {tol:NaN} 이 'max-iterations' 로, {maxStep:{rotRad:0}} 이 'diverged(…)' 로
  // 오귀속된 reason 을 달고 나갔어요. 단계 ② 가 LM 도 정책 객체로 먹이니(DESIGN_006 H-5) 잘못된 옵션이 프레임을 죽이지 않게 해요.
  const optsObj = opts ?? {};
  const optsOk = isPlainObject(optsObj)
    && (optsObj.maxIter === undefined || (Number.isInteger(optsObj.maxIter) && optsObj.maxIter >= 1))
    && ['lambda', 'lambdaMax', 'tol', 'rankTol'].every(k => optsObj[k] === undefined || finitePositive(optsObj[k]))
    && (optsObj.maxStep === undefined || (isPlainObject(optsObj.maxStep)
      && ['rotRad', 'trans'].every(k => optsObj.maxStep[k] === undefined || finitePositive(optsObj.maxStep[k]))));
  if (!optsOk) return done(R0, t0, NaN, NaN, 0, false, 'invalid-options', NaN);
  const { maxIter = 20, lambda: lambda0 = 1e-3, lambdaMax = 1e12, tol = 1e-10, rankTol = 1e-10 } = optsObj;
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
  const rotRad = optsObj.maxStep?.rotRad ?? 0.5;
  const trans = optsObj.maxStep?.trans ?? Math.max(norm(t0), radius, 1e-300);
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
      // 회전(rad)과 이동(세계 단위)은 따로 재요 — 한 max 에 섞으면 pitch 만 바꿔도 reason 이 달라져요(파일 머리 «LM»).
      //   둘 다 «점의 변위 ≤ tol·L» 로 읽어요(L = max(|t|, 점 반경), 세계 길이): 이동은 |δt| 그대로, 회전은 점 반경 × |δω|.
      //   «1 +» 같은 절대항을 넣으면 |t| ≪ 1(작은 pitch)에서 다시 단위 의존이 돼요.
      const lengthScale = Math.max(norm(t), radius, 1e-300);
      const tinyRot = Math.max(Math.abs(delta[0]), Math.abs(delta[1]), Math.abs(delta[2])) * Math.max(radius, 1e-300) <= tol * lengthScale;
      const tinyTrans = Math.max(Math.abs(delta[3]), Math.abs(delta[4]), Math.abs(delta[5])) <= tol * lengthScale;
      const tiny = tinyRot && tinyTrans;
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
