# 오버레이 + 가이드 3링 + 자가진단 — 작업 보고

- 시작: 2026-08-16
- 워크트리: `wt-overlay` (acaeb0c detached)
- 브리프: brief-overlay-guide3.md

> **r3 재개 (2026-08-16, 새 레인)**: 직전 레인은 §1(3링 기하 유도)과 스위트 기준선 실측,
> `src/scanner-zoom.js` 주석 블록 교체까지 하고 중단됐다 (git diff: scanner-zoom.js 주석만
> +17/−5). 이 레인은 그 상태를 그대로 승계하고, **r3 정사각 뷰 아키텍처** 기준으로 이어서
> 구현한다 — r1 의 «분석 영역 역투영(analysisSquareOnScreen) 위에 가이드» 구조는 폐기하고
> «프리뷰 = 정사각 컨테이너 ≡ 분석 정사각» 구조로 간다. §1 의 유도·짝 판정은 r3 에서도
> 그대로 유효하다 (링 비율은 뷰 구조와 무관한 코드 기하).

## 진행 로그

- [x] 코드 탐색 (guide dots · decodeFrame · isLabPath · cell-editor-core K · placementA · 번들 3종 구조)
- [x] 작업 2: 3링 기하 유도 (버전 짝 판정 + 좌표 검산 — §1 유도, §3 구현·테스트 고정)
- [x] 작업 3 (r3 핵심): 정사각 뷰 아키텍처 — §2
- [x] 작업 1: 디버그 오버레이 (lab 전용) — §4
- [x] 작업 4: 점 렌더 자가진단 — §5
- [x] 기기 매트릭스 수치 테스트 — §6
- [x] 번들 재빌드 (스캐너 3종 + 생성기 4종 — lab-telemetry 공유로 생성기도 재임베드 필요)
- [x] 스위트 기준선 실측 (`test/output/claude-suite-baseline.txt`):
  **tests 1491 · pass 1485 · fail 0 · skipped 6** (suites 227).
  브리프의 «1434 중 1433 (실패 1 = Type Y 3톤 실사진)» 과 다른 이유: 이 워크트리에는
  실사진 휘도 덤프(gitignore 산출물)가 없어 그 테스트가 **fail 이 아니라 skip** 으로
  잡힌다 (`﹣ Type Y 3톤 실사진 … # Type Y 3톤 성공 사진 휘도 덤프 없음` 포함 skip 6).
  총 개수 차이(1491 vs 1434)도 같은 환경 차이(덤프 유무에 따른 하위 테스트 수) + 브리프
  집계 시점 차이로 보이며, 이 보고서는 **이 트리에서의 실측 숫자 그대로**를 기준선으로
  삼는다. 변경 후 판정 기준: fail 0 유지 · skipped 6 유지 · 추가 테스트만큼 증가.

## 1. 3링 기하 유도 (작업 2 — 수식, 좌표 검산은 테스트로 고정)

전부 코드 기하(`hexgrid.js` 좌표 규약: pointy-top, size s = 셀 외접반지름,
`axialToPixel`: x = √3·s·(q+r/2), y = 1.5·s·r)에서 유도했다. 감으로 정한 수치 없음.

### 1.1 K 첨두 반경 — (3k+2)·s

Type A 영역(`placementA.isInRegionA`: cube x,y,z ≤ k)의 실루엣 삼각형:
- 우변: q=k 열 셀들의 우상(UR) 꼭짓점이 정확히 한 직선(기울기 √3) 위 —
  UR(k,r) = (√3s(k+r/2)+√3s/2, 1.5rs−0.5s), r 소거 시 선형.
- 하변: r=k 행 셀들의 하단 꼭짓점 y = (1.5k+1)s (수평선). 좌변은 우변의 거울상.
- 세 직선의 교점(= 단순화 hull 꼭짓점): 상단 첨두 (0, −(3k+2)s) → **반경 (3k+2)s, 방향 C0**.
  하변∩우변 = (√3(1.5k+1)s, (1.5k+1)s) → 반경 2(1.5k+1)s = (3k+2)s ✓ 정삼각형.

Type K = A ∪ 반전A (`cell-editor-core.isInRegionK`). 반전A(cube x,y,z ≥ −k)는 A 의
x↦−x 거울 + 점대칭이라 첨두 6개가 **C0…C5 전 방향, 반경 (3k+2)s** — 기존 12점
가이드의 바깥 링 방향 정본(C0=상단)과 일치.

### 1.2 K 중앙 육각(두 삼각 교집합) = O 실루엣 — 정확 항등

두 실루엣 삼각형 변 직선의 교점: △ 변(C0→C2)과 ▽ 변(C1→C3)의 교점 =
(R/√3, 0) (R = (3k+2)s) → **중앙 육각 외접반경 = (3k+2)s/√3, 방향은 변-중점(E) 방향
(C 링에서 30° 회전)**.

O 실루엣(반경 k 육각 영역 단순화 hull, 기존 유도) = √3(k+2/3)·s. 항등:

    (3k+2)/√3 = √3(k+2/3)   — 모든 k 에서 **정확히 같다** (유리수 항등, 근사 아님).

게다가 직선 자체가 같다: O 영역 상단 행(r=−k)의 상단 꼭짓점들이 놓이는 수평선
y = −(1.5k+1)s 는 ▽ 의 상변과 동일 직선이고, O 의 q=k 열 UR 꼭짓점 직선은 △ 의
우변(C0→C2)과 동일 직선이다(같은 셀 좌표 부분집합). 즉 **같은 k·같은 s 이면 O 실루엣
육각 = K 중앙 육각, 변·꼭짓점 단위로 일치**.

### 1.3 3링 비율

- r_outer / r_middle = (3k+2)s ÷ (3k+2)s/√3 = **√3 (k 무관, 정확)**.
  → `GUIDE_MIDDLE_FRACTION = GUIDE_OUTER_FRACTION / √3 = 0.54/√3 ≈ 0.311769`.
- 중간 링 방향 = 변-중점(E_i = (C_i+C_{i+1})/√3) — 바깥 링(C)에서 30° 회전.
  이는 장식이 아니라 기하의 결과다(1.2 의 교점 방향).
- 셀 크기 불변: K 를 바깥 링에 채우면 s = R_out/(3k+2), O 를 중간 링에 채우면
  s = R_mid/(√3(k+2/3)) = R_out/(3k+2) — **동일**. «O 를 그대로 K 로 바꾸면 첨두가
  바깥 점에 맞는다»는 운영자 불변식이 성립하는 이유.

### 1.4 버전 짝 판정 (코드 판정)

`capacity.VERSIONS`: O V1=k6 · V2=k8 · V3=k10. `capacityA.VERSIONS_A`: A0=k6 ·
A1=k8 · A2=k10 (K 는 별도 버전표 없음 — 편집기 k ∈ {4,6,8,10}, A 와 같은 k 기하).
불변식 ①·② 는 **k 가 같을 때만** 성립(1.2 는 같은 k 전제) → 성립 짝:

| O (코드 명명) | K(A) (코드 명명) | k | 운영자 표기 대응 |
|---|---|---|---|
| **O V1** | **K@k6 = A0 기하** | 6 | «O1 - K1(A1)» — A 를 1-베이스로 읽은 것 |
| O V2 | K@k8 = A1 기하 | 8 | |
| O V3 | K@k10 = A2 기하 | 10 | |

운영자 표기 «O1 - K1(A1)» 의 코드 명명 정정: **O V1(k=6) ↔ A0(k=6) 기하의 K**.
(A1 은 코드 명명으로 k=8 이라 O1(k=6)과 짝이 아니다 — 좌표 검산 테스트가 같은 k 에서만
반경 일치함을 고정한다.) 안쪽 링 짝은 운영자 지정 «O1» = **k=6** 을 쓴다.

### 1.5 안쪽 링 (V3 비율 0.1023 폐기)

안쪽 링 = 짝 k=6 의 O 코드가 **중간 링**에 앉을 때의 중앙 파인더 큐브
(`finder-patterns` central-cube-3tone, radiusCells 3.5) 꼭짓점 (pointy-top → C 방향):

    GUIDE_INNER_FRACTION = GUIDE_MIDDLE_FRACTION × 3.5/(√3(6+2/3))
                        = GUIDE_OUTER_FRACTION × 3.5/(3·6+2) = 0.54×3.5/20 = **0.0945**

(구 0.102299 는 «O V3 가 바깥 링에 앉을 때» 기준 — 단일 타입 기준이라 폐기.
k=6 짝은 세 짝 중 안쪽 링이 가장 크다: k8 → 0.0727, k10 → 0.0591.)

### 1.6 O 가 중간 링에 앉을 때 — 버전별 점유율·cell_px (960px 분석 프레임, R_mid=149.65px)

셀 px = R_out/(3k+2) = 259.2/(3k+2) (K 바깥 링 채움과 동일 값 — 1.3 셀 크기 불변).
bbox = 2√3s(k+1/2) × 2s(1.5k+1) (`hexgrid.codeBounds`).

| 버전 | k | cell_px (960) | cell_px (승격 1440) | bbox 점유율 |
|---|---|---|---|---|
| O V1 | 6 | **12.96** | 19.44 | 0.0821 |
| O V2 | 8 | **9.969** | 14.95 | 0.0825 |
| O V3 | 10 | **8.100 (< 9 하한)** | 12.15 | 0.0829 |

- 점유율 ≈ 0.082 로 Y 실측 성공 지대(0.15-0.3) **밖**이다 — 브리프 지시대로 O 에
  강제하지 않고 수치만 보고한다 (지대는 Y 실측 기반, 바깥 링 f=0.54 는 그대로 유지).
- O V3 는 중간 링 기준 960 프레임에서 셀 8.1px 로 하한(9px) 미달 — 연속 실패 시
  1440 승격(기존 경로)이 12.15px 로 받친다(스트림 min side ≥ 1067 조건부).

## 2. r3 정사각 뷰 아키텍처 (작업 3 — 이번 개정의 핵심)

### 2.1 구조

- **프리뷰 = 정사각 컨테이너** (`.square-stage`, `sites/tlscan/index.html`): 카메라를
  화면 전체에 cover 로 깔던 구조를 폐기하고, 화면 중앙의 정사각 안에만 video 를
  `object-fit: cover` 로 넣었다. 정사각 컨테이너 + cover(중심 정렬)가 보여주는 것은
  정확히 **센서 중앙 정사각**이고, 분석 크롭(`cropWindow` crop=1)도 같은 중앙
  정사각이다 → **프리뷰 ≡ 분석이 구조적으로 동일**.
- 크롭 폴백(zoom 미지원 기기)의 CSS `scale(crop)` 도 동일성을 유지한다:
  보이는 소스 창 변 = side ÷ (side·crop/min(vW,vH)) = min(vW,vH)/crop
  = `cropWindow(...).sourceSide`. 실행형 증명 `previewSourceWindow()`
  (`src/scanner-zoom.js`)를 만들어 테스트가 cropWindow 와 좌표 단위로 대조한다
  (센서 5종 × crop {1,2,3.5} × 컨테이너 3종 전부 일치 — 컨테이너 크기 무관이 핵심).
- **역투영 전면 폐기**: `analysisSquareOnScreen()` 함수 삭제. 가이드·오버레이는 정사각
  컨테이너 rect 하나로 그린다 (`renderGuideDots`: `cameraStage.getBoundingClientRect()`).
  테스트가 import·호출·정의 부재를 부정 단언한다.

### 2.2 정사각 뷰 변 산정 근거

`SQUARE_VIEW_FRACTION = 0.92` — 변 = 0.92 × 뷰포트 짧은 변 (`squareViewSide()`,
CSS `min(92vw, 92dvh)` 와 같은 식, 실브라우저 1280×720 에서 662.4px 로 일치 확인).
- 상한 근거: 가이드 최대 반경이 0.54/2 = 27% 라 어떤 비율 < 1 에서도 점 이탈은 구조적으로
  불가능 — 8% 는 순수 시각·safe-area 마진이다 (셸 패딩 max(10px, inset) ≤ 짧은 변 4%,
  지원 최소 320px 에서 12.8px).
- 하한 근거: 분석 해상도(grab)는 뷰 크기와 무관하므로(센서 중앙 정사각 그대로) 뷰를
  키우는 쪽에 손해가 없다 → 마진 제외 최대 0.92.
- 잔여 영역은 문서 흐름 UI 로 재배치: 세로 = 상단 헤더 / 정사각 / 문구·상태·버튼 / 푸터,
  가로(≤620px 높이) = 좌측 정사각 + 우측 UI 열 그리드. `.camera-backdrop`(inset:0)
  전체화면 전제 폐기.

### 2.3 화질 결정 (실측 근거)

- **스트림 요청 ideal 1920×1080 → 2560×1440 상향**: 승격 프레임(1440)은
  `min(1440, round(sourceSide))` 캡이라 1080p 스트림에선 1080² 가 상한 — «1440 승격»
  이 이름뿐이었다. 1440p 스트림이면 승격이 실제 1440² (A2 기준 셀 8.36→12.5px 급).
  ideal 이라 미지원 기기는 종전대로 1080p/720p 폴백.
- **«target ≤ 960 사전 축소» 유지**: Node 실측 (`claude-square-view-timing.json`,
  V3 프레임 절반 점유 구도, 7회 중앙값) — 960² **306.5ms** vs 네이티브 1440² **546.7ms**
  = **1.78×**. 실기기가 이미 1.5\~2초대이므로 상시 1440 은 주기를 \~2.7\~3.6초로 민다.
  셀 픽셀은 이미 하한(9px) 위(Y1 12.3px)라 이득이 없고, 해상도가 필요한 경우는 연속
  실패 5회마다의 1440 승격(기존 경로)이 담당한다. **이중 열화 아님**: grab 은 네이티브
  중앙 정사각을 한 번만 축소한다 (크롭 → 960 직행, 재축소 단계 없음).
- 텔레메트리 zoom/crop/w/h 정직성: 분석 경로(cropWindow·zoomTelemetry)는 손대지 않았다
  — w/h = `cropWindow.target` (없는 픽셀을 만들지 않음), crop 상쇄가 아니라 **크롭
  자체가 프리뷰에 그대로 보이는** 구조라 필드 의미가 종전과 동일하다. 기존
  normalizeFrameBody/eventRow 테스트 + 매트릭스 테스트의 target 검산이 고정한다.

## 3. 3링 18점 구현 (작업 2 — §1 유도의 코드화)

- `src/scanner-zoom.js`:
  - `EDGE_UNIT_OFFSETS` = (C_i+C_{i+1})/√3 — 삼각함수 재계산 없이 CORNER 상수에서 유도
    (30° 회전이 구성상 보장).
  - `GUIDE_MIDDLE_FRACTION = 0.54/√3 ≈ 0.31177` (비율 ① r_outer/r_middle = √3, k 무관).
  - `GUIDE_PAIR_K = 6` (운영자 «O1 - K1(A1)» = 코드 명명 O V1 ↔ A0 기하, §1.4).
  - `GUIDE_INNER_FRACTION = MIDDLE × 3.5/(√3(6+2/3)) = 0.54×3.5/20 = 0.0945`
    (비율 ③ — V3 단일 타입 기준 0.102299 폐기).
  - `kaApexRadiusCells(k)=3k+2` · `silhouetteRadiusCells(k)=√3(k+2/3)` 노출.
- 좌표 검산 테스트 (`test/scanner-zoom.test.js`): 공식이 아니라 **실제 영역 코드**
  (placementA.isInRegionA · cell-editor-core.isInRegionK/InvertedA · hexgrid.hexCorners)
  에서 k∈{6,8,10} 전부 — q=k 열 UR 꼭짓점 공선(기울기 √3) → 첨두 (0,−(3k+2)s) →
  하변 교점 반경 (3k+2)s·방향 C2 → ▽상변∩△우변 = (3k+2)/√3·s = √3(k+2/3)s·방향 E0,
  O 영역 경계가 같은 직선의 부분집합임을 확인. **같은 k 한정** 성립도 부정 검산
  (k 교차 시 반경 불일치 > 1). 버전 짝은 capacity.VERSIONS / capacityA.VERSIONS_A 의
  k 값으로 판정 고정.
- 시각 구분: 바깥=밝은 실점 · 중간=고리(스트로크만, E 방향) · 안쪽=반투명 실점.
- i18n `guide.dots` ko/en/ja 갱신 (O 실루엣 = 중간 고리 문구 추가), `lab.debug.toggle`
  3언어 신설. scanner-i18n·i18n-coverage 테스트 통과.

## 4. 디버그 오버레이 (작업 1 — lab 전용, 기본 켬)

- `src/scanner-debug-overlay.js` (신규): `createDebugOverlay({enabled: isLabPath(), …})`.
  표시 항목 — 전부 decodeFrame 경로의 기존 로컬 추출값 재사용, **새 전송 경로 0바이트**:
  1. **분석 정사각 외곽선** — r3 에선 뷰 경계 그 자체다 (뷰 ≡ 분석이라 «화면 밖으로
     이어질» 것이 존재하지 않는다 — r1 의 clamp 문제가 구조적으로 소멸).
  2. 잘림 상태: 외곽선 stroke 색 = clipSide (none=초록 · 단면=노랑 · multi=빨강 · 미상=회청).
  3. 파이프라인 도달: geo 단계(geometryStage) → cs attempted/accepted → stage
     (proposal/verify/format/decode) + 실패 사유 문자열 (summarizeFrameDebug 4줄).
  4. cs 평가: layoutId·agreement(score)·수용·사유 + **로케이터 앵커 마커** —
     `extractCsAnchors()` (lab-telemetry.js 신규, csBlockLocator.verified 순회)를
     프레임→뷰 순수 배율로 투영 (`projectFramePoint`, 실브라우저 480/960→331.2/662.4 확인).
  5. 추정 cell_px · zoom/crop/effectiveZoom(+오류코드) · 분석 프레임 w×h · ms.
- 토글 버튼 (lab notice 안, 기본 켬, aria-pressed) — 실브라우저에서 클릭 토글 확인.
- **안정판 `/` 불활성 — 기능적 부정 단언**: enabled=false 면 동결 no-op API 를 돌려주고
  DOM 을 일절 만지지 않는다. `test/scanner-debug-overlay.test.js` 가 기록형 스텁으로
  «mutation 0 · authored hidden 유지 · 생성 요소 0 · 리스너 0» 을 실행으로 증명 +
  scanner-zoom.test 가 활성화 지점이 `enabled: isLabPath()` 하나뿐임을 소스 단언.
- **실브라우저에서 잡은 결함 1건**: SVG 요소에는 `hidden` IDL 프로퍼티가 없어
  (`svg.hidden === undefined`) 프로퍼티 대입이 무효 expando 가 된다 — 첫 구현이 그
  경로였고 dev 서버 실측으로 발각. `setAttribute/removeAttribute('hidden')` +
  스타일시트 `[hidden]{display:none!important}` 조합으로 교체, 실브라우저 재확인
  (표시 block ↔ 숨김 none) + 테스트가 프로퍼티 경로 회귀를 부정 단언.

## 5. 점 렌더 자가진단 (작업 4)

- S ≤ 0 / rect 0 → `scheduleGuideRetry()` (rAF, 상한 40회) — 조용한 포기 금지.
- **첫 프레임 grab 성공 시 재렌더** (`startFrameLoop` 세션 플래그) — grab 성공은
  videoWidth/H·레이아웃 실재의 가장 강한 증거라 loadedmetadata 보다 늦고 확실하다.
- `assertDotLayerStacking()`: video·점 레이어가 같은 스테이지 + DOM 순서(video 선행) +
  점 레이어 z-index ≥ 2 (video 는 auto) 를 런타임 단언, 위반 시 console.warn.
  CSS z-index 값은 테스트가 마크업에서 고정. 실브라우저 확인: dotZ=2, videoZ=auto.
- r3 불변식 «점은 뷰 밖으로 나갈 수 없다» (최대 반경 27% < 50%): `dotsOutOfBounds()`
  가 매 렌더 검사 — 위반 시 console.warn + 오버레이 `DOT-OOB ring#i` 표기.
  세로/가로 화면 어긋남(직전 검증 렌즈 지적 ②)은 뷰 자체가 정사각이라 원천 소멸 —
  매트릭스 테스트가 4뷰포트 전부 18점 포함을 단언.

## 6. 기기 매트릭스 수치 (`claude-square-view-matrix.json`, 테스트가 재생성)

ⓐ **시각 여백 상한** `viewSideCap` (0.92 × 짧은 변, 방향 무관 — w/h 스왑 동일성 단언):

> ⚠ [정정 2026-08-16, r5] 이 표를 원래 «정사각 뷰 변» 이라 적었고 JSON 필드명도
> `squareSide` 였다. r4 부터 실제 한 변은 여기에 **배치 적합 상한**을 더 min 한 값이라
> (`scanLayout().squareSide` 가 정본), 아래 수치를 «뷰 변» 으로 읽으면 틀린다 — 예컨대
> 태블릿 1024×768 의 실제 변은 **690** 이지 706.56 이 아니다. 필드명을 `viewSideCap`
> 으로 좁히고 이 표의 뜻을 «상한» 으로 되돌렸다.

| 뷰포트 | 시각 여백 상한 (px) | 실제 뷰 변 (r4 `scanLayout`) |
|---|---|---|
| 폰 390×844 | 358.8 | **358.8** (상한이 결정항) |
| 태블릿 1024×768 | 706.56 | **690** (옆배치 적합 상한이 결정항) |
| 폴드 접힘 344×882 | 316.48 | **316.48** (상한이 결정항) |
| 폴드 펼침 1812×2176 | 1667.04 | **1667.04** (상한이 결정항) |

ⓑ 18점 전부 뷰 안 — 4뷰포트 모두 `dotsOutOfBounds = []` ✓.
ⓒ 프리뷰≡분석 — 센서 1280×720 · 720×1280 × crop{1,2}: preview 창 = cropWindow 소스
  (720/360px) 완전 일치 ✓. 분석 프레임 변 = target (720² — 이 센서들은 960 캡 미달이라
  **원본 그대로**, 축소 없음) ✓.
ⓓ cell_px 표 (바깥 링 채움 = Y/K·A, O 는 중간 링 안착 — 같은 k 의 K 바깥 채움과 동일
  값임을 테스트가 검산; K/A 반경 규약은 §1 의 (3k+2)s 변-직선 교점 기준):

| 프레임 | Y1 | Y2 | O V1/K@6 | O V2/K@8 | O V3/K@10 |
|---|---|---|---|---|---|
| 960² (1080p+ 스트림) | 12.34 | 10.37 | 12.96 | 9.97 | **8.10 (<9)** |
| 720² (720p 스트림) | 9.26 | **7.78 (<9)** | 9.72 | **7.48 (<9)** | **6.08 (<9)** |

- 960 프레임: O V3(중간 링)·A2 급만 하한 미달 — 1440 승격이 받친다 (이제 스트림
  ideal 1440p 라 승격이 실제 1440² → 12.15px).
- 720p 스트림 기기는 Y2·O V2+ 가 하한 아래고 승격도 720² 캡 — **해상도 한계 기기**로
  수치만 보고 (게이트·강제 없음).
- O 중간 링 bbox 점유율: k6 0.0821 · k8 0.0826 · k10 0.0829 — Y 실측 성공 지대
  (0.15-0.3) **밖**. 브리프 지시대로 O 에 강제하지 않고 수치만 보고한다 (지대 단언은
  바깥 링 채움 형상 Y/K 0.253 · A 0.189 에만).

## 7. 빌드·스위트

- 재빌드 (전부 현재 트리, 임베드 LF 정규화 경로 `readSourceLf` 경유):
  `dist/tlscan.html` · `sites/_shared/lab-scan.html` · `sites/_shared/scan-new.html`
  (스캐너 3종) + `dist/trilume.html` · `gen-finder.html` · `gen-finder-editor.html` ·
  `lab-gen.html` (생성기 — **lab-telemetry.js 가 생성기 번들에도 임베드**되어 있어
  extractCsAnchors 추가만으로 재빌드 필요, 동기화 테스트가 잡아줬다).
  `scan-old.html` 은 고정 커밋(09596a3) 빌드라 바이트 불변.
- **스위트 (전체, `test/output/claude-suite-after-overlay.txt` 숫자 그대로)**:
  **tests 1505 · suites 227 · pass 1499 · fail 0 · cancelled 0 · skipped 6**.
  기준선(1491/1485/0/6) 대비 **+14 테스트 전부 통과**, fail 0 · skipped 6 유지 —
  기준선 판정 기준 충족. skip 6 은 전부 실사진 휘도 덤프 부재(이 트리에 gitignore
  산출물 없음) — 기준선과 동일 항목이다. 브리프의 «1434 중 1433» 는 덤프가 있는
  환경의 숫자로, 유일 실패였던 `Type Y 3톤 실사진` 테스트는 이 트리에선 skip 이며
  **건드리지 않았다**. 게이트(0.78/0.035)·디코더 내부 로직 무수정 (src/decoder/ diff 0,
  전체 diff 는 scanner 셸·기하 모듈·오버레이 모듈·전략 없는 순수 추출 1개
  (lab-telemetry.extractCsAnchors)·테스트·번들 뿐).
  중간 이력: 1차 전체 실행에서 fail 2 (dist/trilume.html 등 **생성기 번들 스테일** —
  lab-telemetry 가 생성기에도 임베드되는 걸 놓침) → build-gen-variants 재빌드로 해소.
  이는 N-way sync 등록부가 예고한 유형의 실패를 동기화 테스트가 정확히 잡은 것이다.

## 8. 실브라우저 검증 (dev 서버, 카메라 없는 범위)

- 1280×720 뷰포트: `.square-stage` 662.4×662.4 = 0.92×720 — JS 모델과 CSS 일치,
  정사각 확인. 점 레이어 z-index 2 / video auto. 빌드 태그 2026-08-16.01.
- 안정판 경로(`/sites/tlscan/index.html`): 디버그 요소 3종 authored hidden 유지.
- 오버레이 모듈을 실제 DOM 에 주입해 기능 확인: 표시(block)·multi 빨강 외곽선·앵커
  (480,480)→(331.2,331.2) 투영·패널 4줄·버튼 클릭 토글 on/off — §4 의 SVG hidden
  결함 발견·수정이 이 경로에서 나왔다 (초록 테스트만으론 못 봤을 결함).
- 카메라 스트림·실기기 검증은 원격 불가 — 배포 후 lab 오버레이가 §6 후보 ①/②/③ 판별을
  맡는 구조다 (그것이 이 의뢰의 목적).

## 9. 못 한 것 · 한계

1. **실기기 검증 불가** — 카메라·폴드 포스처·iOS Safari 의 2560×1440 ideal 협상 결과는
   배포 후 lab 텔레메트리/오버레이로 확인해야 한다. 특히 iOS 가 1440p 를 거부하고
   1080p 로 떨어지면 승격은 종전처럼 1080² 캡이다 (동작 저하는 아님 — 종전과 동일).
2. **`/lab/` 스캐너 라우트가 dev 서버에 없어** 오버레이의 isLabPath 활성 경로는
   실브라우저에서 모듈 주입으로만 확인했다 (배포 nginx 는 /lab/ alias 실재).
3. 가로모드(≤620px 높이) 그리드 재배치는 CSS 로직·매트릭스 수치로만 검증 — 실기기
   가로 화면 캡처 없음.
4. 720p 스트림 기기의 Y2·O V2+ 하한 미달(§6)은 이 의뢰 범위에서 해소 불가(센서 한계)
   — 수치 보고만.
5. photo-probe.html 등 다른 소비처가 lab-telemetry 를 쓰지만 extractCsAnchors 는
   추가 전용이라 영향 없음(전 스위트 green 으로 확인).
