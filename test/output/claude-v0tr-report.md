# v0TR 계열 편입 — 레인 보고 (2026-08-17)

- 시작 시점 HEAD: `fd37c9c` · 작업 트리 깨끗함 (stash 불필요)
- 정본: `E:\WorkBase\TrilLuminanceCube\.agent\decoder\data\cellsurface-v0trq-editor.json`
  (파인더 77셀 = NE 68 + SE 9, 슬롯 64셀 톤 override 0개)
- 커밋·push·배포 **없음**. 게이트 완화 **0건** (agreement 0.78 · orientationMargin 0.035 ·
  CRC · RS · 봉합 0.075R/0.60 · `v0wySlotQrMin*` 3종 — 한 값도 안 건드렸다).

---

## ① 계측

계측 스크립트: `test/output/lanes/claude-v0tr-measure.mjs`
(출력 `claude-v0tr-measure.out.txt`) · 검출 실측 `claude-v0tr-detect.mjs` ·
기전 해부 `claude-v0tr-detect-debug.mjs` · 교차 수용 `claude-v0tr-crossmatrix.mjs`

### 종합표

| 항목 | `v0tr` | `v0trq` | 게이트/기준 | 판정 |
|---|---|---|---|---|
| 파인더 셀 | 93 | 77 | 브리프 표 | 일치 |
| 슬롯 | 0 | 64 (중앙 (0..7)²) | — | — |
| **detector** | **93** | **141** | 브리프 93 / 141 | **일치** |
| 코어 반경 (채택) | **16.7033** (√279) | 16.7033 | `V0W_CORE_RADIUS_CELLS` √279 | **Δ = 0.0000** |
| Δ vs `ANCHOR_SNAP_CELLS` 3.2 | 0.0 ≤ 3.2 | 0.0 ≤ 3.2 | — | **쌍당 refinePose 추가** → §④ 벤치 |
| **방향 margin** | **0.0430** (12/279) | **0.0519** (12/231) | 게이트 0.035 | 1.23배 / **1.48배** |
| autoplace | 수용 | 수용 | — | ok |
| `S_fmt` (sFmtMax) | **388** | **340** | `minFormatSeparation(21)` = 289 | 1.34배 / 1.18배 |
| data | **318** | **270** | 브리프 270 (v0trq) | 일치 |
| S = ⌊data/3⌋ | **106** (잔여 0) | **90** (잔여 0) | — | — |
| payload L/M/H | **89 / 76 / 61 B** | **76 / 64 / 52 B** | — | — |
| ⑤ 인코더 정합 | L·M·H 전부 정합 | L·M·H 전부 정합 | 전 레벨 | **통과** |
| 코너 삼중점 (v0TRQ) | — | **선다** (실측 포즈 1) | §6 구조적 부재? | **아니다** |

### ⓐ 정본 자기검증 + 블록 분해 — 전사 0줄

팩 주장과 실측이 전 항목 일치 (파인더 77 · mid 0 · 비대칭 6 · 슬롯 64 · 톤 override 0 ·
detector 141 = 77 + 64).

**NE 68셀은 «동심 사각 하나» 가 아니라 둘의 합집합이다** — 이번 계측의 첫 발견:

| 블록 | 범위 | 셀 | 유도 |
|---|---|---|---|
| NE 바깥 동심 사각 | (0..5)×(15..20) | 36 | **v0T NE 와 톤까지 36/36 일치** = `V0XQ_CORNER_CELLS` 같은 배열 |
| NE 안쪽 동심 사각 | (2..7)×(10..15) | 36 | **바깥 사각의 (i+2, j−5) 평행이동 36/36 일치** |
| SE 마커 | (18..20)² | 9 | **v0T SE 와 톤까지 9/9 일치** = `V0W_PHASE_CELLS` 같은 배열 |
| (겹침) | i∈2..5, j=15 | −4 | 두 사각이 j=15 열을 공유 (톤도 같다) |

36 + 36 + 9 − 4 = **77**, 미분류 0셀. `v0tr` 의 중앙 16은 `V0T_CENTRE_CELLS` **행 참조 그대로**.
즉 이 계열의 정본은 **유도 77 · 전사 0** 이다 (v0T 는 유도 61 + 전사 43 이었다).

### ⓑ 코어 반경 — 「같은 경로」로 유도, 그리고 **판단이 한 번 뒤집혔다**

자 검증: `patchesFor(21,'v0t').corners[0].anchor` 반경 = **16.7033** = √279 ✔

| NE 후보 앵커 | 무게중심 (a,b) | r = √(a²+b²−ab) | Δ(√279) | snap 3.2 |
|---|---|---|---|---|
| 합집합 68셀 | (4.0, 15.5) | 13.9374 | −2.7659 | ≤ 3.2 |
| **바깥 사각 36셀 (채택)** | (3, 18) | **16.7033** | **0.0000** | ≤ 3.2 |
| 안쪽 사각 36셀 (기각) | (5, 13) | 11.3578 | −5.3455 | **> 3.2** |

**처음에 «안쪽» 을 골랐고, 실측이 그것을 기각했다. 경위를 그대로 적는다.**

1. **합집합은 먼저 탈락했다.** 검출기가 실제로 찾는 코너는 «동심 사각 암 2×2 코어
   중심» 이다. 바깥의 무게중심은 코어 중심 (3,18) 과, 안쪽은 (5,13) 과 각각 **일치**하는데
   합집합의 (4.0,15.5) 는 **어느 코어와도 일치하지 않는다** → `anchoredSimilaritySeedTo` 가
   정준 앵커를 검출 코어에 맞추는 순간 스케일이 16.7033/13.9374 = **1.20배** 틀어진다.
2. **안쪽을 골랐다** — Δ 5.35 > 3.2 라 «최종 라인업에서 처음으로 거리로 갈리는 계열» 이
   되고, 순수 v0T·v0TY 프레임에서는 v0TR 브랜치가 아예 안 떠 비용 증가 0 이 될 터였다.
   정준 삼중점도 완벽했다 (반경 3개 동일 · 각 −127.6°/112.4°/−7.6° · 이웃 각차 120.0°).
3. **합성 프레임 실측이 그것을 죽였다** (`claude-v0tr-detect-debug.mjs`):
   v0TR 프레임에서 **엄격 코너(`verifyV2r2Cluster`)로 검증되는 것은 바깥 셋뿐**이다
   (3/3, 추정 반경 18.55). 안쪽 코어는 바깥 사각과 j=15 열을 맞대고 있어 링 스캔이
   «배경으로 열린다» 를 못 만든다. 앵커드 경로는 **엄격** 목록만 보므로 시드가 아예
   생기지 않았고 — **v0tr 자기 포즈가 0 이었다.**
   (느슨한 검증기 `verifyV0xqCornerCluster` 는 안쪽도 잡는다 — 느슨 코너 7개.)
4. **바깥으로 되돌렸다.** 그 즉시 v0tr 자기 포즈가 **6** 으로 선다. 안쪽 36셀은
   **서브앵커 패치**로 쓴다 — v0T 프레임의 그 자리는 데이터라 두 계열을 가르는
   Pearson 신호가 바로 거기다.

**결과적으로 §4-①(a) 의 「|Δ| ≤ 3.2」 가지다** → §④ 에 벤치를 실었다.
브리프가 기대했을 법한 「거리로 깔끔히 갈린다」 는 **정준 기하로는 참이지만 실물
검출기에서는 거짓**이었다. 이 사실이 이번 레인의 가장 중요한 발견이다.

### ⓒ 방향 margin (게이트 0.035)

자 검증 — 기존 회귀 재현: v0t **0.0962** ✔ · v0ty **0.0632** ✔ · v0@13 **0.3111** ✔

| id | margin | 내역 | 비대칭 | 게이트 대비 |
|---|---|---|---|---|
| `v0tr` | **0.0430** | 12/279 | 6/93 | **1.23배** |
| `v0trq` | **0.0519** | 12/231 | 6/77 | **1.48배** |

⚠ **숨기지 않고 적는다 — `v0tr` 0.0430 은 현행·드랍 통틀어 최저다.**
비교: v0ty 0.0632(1.80배) · v0xq 0.0635(1.81배) · v0wy 0.0796 · v0t 0.0962(2.75배).
원인은 브리프 §4-①(b) 가 예고한 그대로다 — **v0TR 에는 v0T 의 A 블록(L 반전 9셀)이
없다.** v0T 의 «의도된 이중화 2개» 중 안쪽 판별자가 통째로 빠지고 SE 6셀만 남았다.
`v0trq` 가 조금 높은 것은 분모(파인더 77)가 작아서일 뿐 **비대칭 셀 수는 똑같이 6** 이다.

두 가지를 덧붙인다 (판단 재료로):
- `v0trq` 는 슬롯 QR 파인더 패턴이 방향 정보를 더 주지만 이 자는 그것을 못 센다
  (v0TY 에서 운영자가 확정한 사실) → 0.0519 는 **과소평가값**이다.
- **`v0tr` 에는 그 보정 요인이 없다.** 슬롯이 없으므로 0.0430 이 액면 그대로다.
- 다만 **회전 별칭은 실측 0 이다** (§ⓕ) — 얇은 margin 과 별개로, 이상 표본기에서
  세 방향이 전부 갈린다. 「얇다」 와 「못 가른다」 는 다른 말이고, 지금은 앞쪽만 참이다.

보강용 보충 블록은 만들지 않았다 (v0T 편입 때 확정된 「먹힌 비대칭을 되찾는 보충
블록·마커 이전 금지」 규약 그대로). 그 금지를 회귀로 못 박아 두었다 —
`cellSurfaceFinal.test.js` §교차 수용 ①-b 가 «v0TR 계열 비대칭은 SE 6셀뿐» 을 단언한다.

### ⓓ autoplace · 회계 · ⑤ 인코더 정합

`minFormatSeparation(21)` = **289**. 두 레이아웃 다 수용:

- `v0tr`: 441 − 93 − 12 − 18 = **318** · S=106 · 잔여 0 · L/M/H 89/76/61 B ·
  S_fmt 388 (하한의 1.34배) · dRef 122 (하한 64)
- `v0trq`: 441 − 77 − 64 − 12 − 18 = **270** · S=90 · 잔여 0 · L/M/H 76/64/52 B ·
  S_fmt 340 (1.18배) · dRef 116

**v0TQ 를 막던 `S_fmt < 289` 가 실제로 풀렸다.** 브리프 §1 의 «SW 를 비운 것이 포맷
복제 이격을 만든다» 는 실측으로 확인됐다 (v0TQ 는 m=5..9 에서 S_fmt 260 급으로 거부).

### ⓔ v0TRQ 코너 삼중점 — **선다** (§6 「구조적 부재」 해당 없음)

정준 기하: 바깥·안쪽 **둘 다** 삼중점이 성립 (반경 3개 동일 · 이웃 각차 120.0/120.0/120.0 ·
세 앵커 합 (0,0)).

합성 프레임 실측 (`claude-v0tr-detect.mjs` ②) — **코너 후보 예산이 실제 변수였다**:

| `v0trqCornerBudget` | v0t 프레임 | v0ty | v0tr | **v0trq** (삼중점/포즈) |
|---|---|---|---|---|
| 3 | 1/0 | 1/0 | 0/0 | **0 / 0** |
| 4 (기존 소비자와 같은 값) | 1/0 | 1/0 | 0/0 | **0 / 0** ← 못 선다 |
| 5 | 3/0 | 3/0 | 1/0 | **1 / 1** |
| **6 (채택)** | 5/0 | 5/0 | 2/0 | **2 / 1** |
| 8 | 7/0 | 5/0 | 2/0 | 2 / 1 |

v0TR 계열은 면당 동심 사각이 **둘**이라 참 코너가 최대 6개 뜬다. 기존 소비자
(v0xq·v0wq·불스아이 확증)가 쓰는 `slice(0, 4)` 는 «면당 하나» 전제 위의 값이라,
그대로 쓰면 상위 4개가 두 반경으로 섞여 **삼중점이 구조적으로 0** 이 된다.
그래서 **이 패밀리 호출부에만** 예산 6을 준다 (`cfg.v0trqCornerBudget`).
**게이트가 아니라 후보 수**이고, 다른 패밀리의 슬라이스는 한 자리도 안 건드렸다.

### ⓕ 교차 수용 — 새 별칭 두 종류가 생겼다 (실측)

`claude-v0tr-crossmatrix.mjs` (이상 표본기 · 슬롯은 «관측 없음»):

| 프레임 | 자기 | v0t | v0ty | v0tr | v0trq |
|---|---|---|---|---|---|
| v0t | 1.0000 | — | **1.0000 수용** | **0.8280 수용** | **0.7922 수용** |
| v0ty | 1.0000 | **1.0000 수용** | — | 0.8095 거부 | 0.7647 거부 |
| v0tr | 1.0000 | **0.8077 수용** | 0.7895 거부 | — | **1.0000 수용** |
| v0trq | 1.0000 | **0.7975 수용** | 0.7714 거부 | **1.0000 수용** | — |

정방향 별칭 **둘 → 여덟**. 세 종류로 갈린다:
- ⓐ `v0t↔v0ty` (1.0/1.0) — 기존 구조적 별칭 (부분집합).
- ⓑ `v0tr↔v0trq` (1.0/1.0) — **같은 기전의 새 쌍**. v0trq 77셀 ⊂ v0tr 93셀 이고 나머지
  16셀(K3 중앙)이 전부 v0trq 슬롯 안이다 (v0t↔v0ty 와 문자 그대로 같은 구조).
- ⓒ `v0t↔v0tr` (0.8280/0.8077) · `v0t↔v0trq` (0.7922/0.7975) — **새 종류다.**
  부분집합이 아니고 (톤까지 같은 셀 61/104 · 45/104), agreement 가 게이트 0.78 을
  **간발의 차로** 넘어 생긴다. 원인은 v0TR 이 v0T 의 세 블록(NW 중앙 16 + NE 바깥
  사각 36 + SE 9 = 61셀)을 **같은 자리에 그대로 가진다**는 설계 사실이다 —
  「정본 의존」 규약의 대가이기도 하다.

⚠ **그래도 넷 프레임 전부 자기 계열이 뽑힌다** (agreement 1.0 이 0.79\~0.83 을 이긴다).
회전 별칭은 **여전히 0** 이다. 그리고 실물 래스터에서는 왕복이 **레이아웃 id 까지 정확히**
맞는다 (§③ 새 테스트). 그러나 ⓒ 는 **잡음 여유가 줄었다는 뜻**이므로 §⑤ 에 판단 항목으로
올린다 — 특히 운영자가 신고한 v0T 의 실기기 오분류와 같은 축이다.

---

## ② 구현 — 건드린 파일과 이유 (파일별 1줄)

| 파일 | 이유 |
|---|---|
| `src/cellSurfaceFinal.js` | `v0tr`/`v0trq` 상수·`_IDS`(맨 뒤)·`_PROFILE`·`_NS`·`DECLARED_DATA`(318/270)·정본 셀 유도(전사 0)·`V0TR_BLOCKS`/`V0TRQ_BLOCKS`·슬롯 상수/배치·**로드 시 자기검증 ①-j/①-k**·회계 전수 |
| `src/decoder/cellsurface-block-detect.js` | `patchesForV0tr`/`patchesForV0trq`·`patchesFor` 분기·`V0TR_CORE_RADIUS_CELLS`(패치 앵커에서 유도)·앵커드 브랜치(**독립 `if`**)·불스아이 확증 spec 행·`assembleV0trqPoses`·cfg 4키·`poseCount` 2키·`centerQr` 진단 5키 |
| `src/decoder/cellSurfaceY-detect.js` | 라인업 서술 갱신 (후보 유도는 `finalLayoutIdsForN` 이라 코드 변경 0 — 자동 편입 확인) |
| `src/decoder/cube-detect.js` | n=21 라인업 서술 갱신 (주석만) |
| `src/locatorY.js` | `LOCATOR_PROFILE_CELL_SURFACE_V0TR`/`_V0TRQ` 신설 + `LOCATOR_PROFILES_Y` + `isCellSurfaceLocatorProfileY` |
| `src/sceneY.js` | 레이아웃 id → 기본 로케이터 프로파일 표에 두 행 |
| `src/decode.js` | `locatorProfile` → 레이아웃 id 힌트 2행 + n=21 기본 유도 목록 |
| `src/generator-render-config.js` | `encodeOptionsForY` 분기 2개 (Y1 고정) |
| `src/generator-state.js` | `locatorProfileY` 허용값에 2종 추가 (드랍 0건) |
| `index.html` | 검출기 카드 2장(아이콘 = 겹사각 둘 + 마커 / 점선 중앙 슬롯) · import · 카드 클릭 분기 · `syncYLocatorUi` 프로파일·힌트 · **i18n 6키 × 8언어** |
| `sites/_shared/lab-scan.html` | 기대 레이아웃 버튼 2개 (`v0tr` · `v0trq`) |
| `sites/tlscan/strings.js` | `lab.expectedLayout.v0tr` / `.v0trq` × 8언어 |
| `sites/tlscan/scanner.js` | 기대 레이아웃 허용값에 2종 추가 |
| `dist/*.html` · `sites/_shared/*.html` | **생성물** — §④ 번들 재빌드 산출 |

**설계 결정 3가지 (전부 실측 근거):**
1. 코너 앵커 = NE **바깥** 사각 (§①ⓑ — 안쪽 안은 실측으로 기각).
2. `v0trqCornerBudget = 6` — 이 호출부만. 게이트가 아니라 후보 수 (§①ⓔ).
3. v0TRQ 카드는 QR 위치 카드를 **안 건드린다** — 슬롯이 중앙(Y-심)이라 «면»(먼 코너)
   축과 같은 자리가 아니고, 두 QR 동시 렌더는 `hasCenterQrSlot` 정본 질의가 이미 막는다.

**i18n 키는 사전의 빈 슬롯을 썼다** (g955·g956·g957·g958·g959·g969, 3자리).
이유: `i18n-coverage.test.js` 의 사전 파서가 `"(g\d{3})"` 라 **4자리 키(g999 다음)는
조용히 안 보인다** — 새 키가 커버리지 밖으로 새는 쪽이 더 나쁘다.

---

## ③ 테스트 — 명령 원문 · 결과

**필수 8종 (하나도 빼지 않았다).** 실행이 길어 파일별로 나눠 돌리고 출력을 파일로 받았다.

```
node --test test/cellSurfaceFinal.test.js
node --test test/cellSurfaceFinal-decode.test.js
node --test test/cellSurface-block-locator.test.js
node --test test/locatorY.test.js
node --test test/locatorY-lab.test.js
node --test test/generator-help-capacity.test.js
node --test test/generator-help-ui.test.js
node --test test/html-module-syntax.test.js
```

| 파일 | tests | pass | fail | **skipped** |
|---|---|---|---|---|
| **필수 7종 통합 런** (`cellSurfaceFinal` · `cellSurfaceFinal-decode` · `locatorY` · `locatorY-lab` · `generator-help-capacity` · `generator-help-ui` · `html-module-syntax`) | **104** | **104** | **0** | **0** |
| **`cellSurface-block-locator.test.js`** (별도 장시간 런, 약 21분) | **72** | **72** | **0** | **0** |
| (추가) `y-cell-editor-refformat` + `generator-state` | 13 | 13 | 0 | **0** |
| (추가) `i18n-coverage` | 8 | 8 | 0 | **0** |

출력 원문: `lanes/claude-v0tr-test-targeted.txt` · `lanes/claude-v0tr-test-blockloc.txt` ·
`lanes/claude-v0tr-test-editor.txt` · (중간 런) `-final` `-decode` `-light1` `-ui` `-bundle`

**skipped 는 전 런 0 이다** — 표적 테스트 안에 덤프 의존 케이스가 없다는 뜻이지
«실사진을 쟀다» 는 뜻이 **아니다** (§⑤ 참조).

`index.html` 을 건드렸으므로 **`html-module-syntax.test.js` 를 반드시 돌렸다** — 통과.
(사전 값에 `**` 를 쓴 초안이 `generator-help-ui` 의 «마크다운 강조 금지» 회귀에 걸려
전 언어에서 걷어냈다. 팝오버가 textContent 렌더라 별표가 화면에 그대로 보였을 것이다.)

### 새로 추가한 테스트

1. **`cellSurfaceFinal-decode.test.js` — «v0TR 계열 왕복 — v0tr · v0trq (n=21) × 2톤/3톤»**
   기존 «활성 라인업 왕복» **바로 옆**에 별도 테스트로 뒀다 (기존 핀 안에 넣으면 실패 시
   어느 쪽이 깨졌는지 못 읽는다). 인코드 → 렌더 → 블록 로케이터 → refinePose → CS 게이트
   → RS → 페이로드 전 구간을 재고, **레이아웃 id 까지 단언**한다. 4/4 통과.
2. `cellSurfaceFinal.test.js` §교차 수용 — **①-b 기전 핀** (v0trq ⊂ v0tr · 남은 16셀이
   슬롯 안 · **v0TR 계열 비대칭은 SE 6셀뿐**) + **④-c 계열 귀속 핀** (넷 프레임 전부
   자기 계열로 뽑힌다).
3. `cellSurfaceFinal.test.js` §방향 margin — 활성 팔에 v0tr 0.0430 · v0trq 0.0519 추가.

### 갱신한 기존 회귀 (전부 «의도적 갱신» 주석 + 근거 실측 동봉)

`CELL_SURFACE_FINAL_IDS`(13종) · `ACTIVE_IDS`(5종) · `finalLayoutIdsForN(21)`(4종) ·
`allFinalLayoutIdsForN(21)` · mid 금지 인스턴스(12 → **14**) · 면 총계 · 방향 margin 활성 팔 ·
교차 수용 별칭 목록(2 → **8**, 실측) · `LOCATOR_PROFILES_Y` · 생성기 허용값 ·
검출기 카드 수(5 → **7**) · 카드 순서 · 부제 키.
**어느 갱신도 게이트 수치를 건드리지 않았다** — 전부 «목록이 늘었다» 이거나 «실측값을
새로 핀했다» 이다.

---

## ④ 번들 — 돌린 스크립트, 재빌드된 파일

`ls tools/` 로 확인해 **`build-*.mjs` 아홉 개 전부** 돌렸다 (전부 ok):

```
build-gen-variants · build-lab · build-scan-variants · build-scanner · build-single
build-hub · build-cell-editor · build-finder-editor · build-print-poster
```

재빌드로 바뀐 파일: `dist/tlscan.html` · `dist/trilume.html` ·
`sites/_shared/{cell-editor,gen-finder,lab-gen,lab-scan,scan-new}.html`

### 검출 벤치 (§4-①a 가 |Δ| ≤ 3.2 였으므로 필수)

`claude-v0tr-detect.mjs` ④ — 같은 프레임에서 `v0trFamily`·`v0trqFamily` off ↔ on.
합성 프레임 (ppu 15 · margin 4 · 2톤) · 5회 평균:

| 프레임 | 편입 전 (ms) | 편입 후 (ms) | 증가 | shape 전 → 후 |
|---|---|---|---|---|
| `v0t` | 159.1 | 168.5 | **+5.9 %** | 2 → 2 |
| `v0ty` | 303.8 | 400.2 | **+31.7 %** | 4 → 6 |
| `v0tr` | 332.1 | 356.0 | +7.2 % | 2 → 4 |
| `v0trq` | 148.6 | 233.1 | **+56.9 %** | 2 → 3 |

읽는 법:
- **기존 라인업 프레임의 비용이 늘었다** — v0t +5.9 % · v0ty +31.7 %. 반경이 같아
  (Δ = 0) 같은 (중앙, 코너) 쌍마다 `refinePose` 가 한 벌 더 돌고, 거기에 v0trq 삼중점
  경로(코너 6개 → 최대 C(6,3)=20 삼중점 × 3 위상 가설)가 얹힌다.
- v0ty 프레임의 shape 가 4 → 6 으로 는 것은 **v0tr 포즈가 6개 서기 때문**이다
  (v0T 계열과 v0TR 계열의 NE 바깥 사각이 같은 자리라 서로의 프레임에서 서로 시드된다 —
  v0X ↔ v0W 이래의 익숙한 구조). 가르는 것은 Pearson 과 CS 게이트이고, 실제로
  §③ 왕복이 레이아웃 id 까지 정확히 맞는다.
- 이 수치는 **합성 1프레임·5회 평균**이라 절대값이 아니라 **자릿수**로 읽어야 한다.
  실사진 덤프 벤치는 이 체크아웃에서 불가 — §⑤ 통합자 항목.

---

## ⑤ 남긴 것 / 못 한 것 / 통합자가 판단해야 할 것

### 못 한 것 (환경 제약 — 브리프 §0-4 규약대로 손대지 않았다)

- **실사진 검증 0건.** 이 기계에 `test/output/photos/` (373 MB, gitignore) 가 없다.
  전체 스위트를 돌리면 실사진 가드가 통째로 skip 되어 거짓 초록이 나므로 표적 테스트만
  돌렸다. 실사진 정션은 통합자 몫이다.
- 기존 실패 1건 «Type Y 3톤 실사진 …» 은 이전부터 있던 것이라 손대지 않았다 (§5).
- `test/cellSurface-block-locator.test.js` — 이 기계에서 **900 초 안에 끝나지 않는다**
  (편입 전에도 같다). 별도 장시간 런으로 돌렸고 결과는 이 보고서 말미 §⑦ 에 적었다.

### 통합자가 판단해야 할 것 (우선순위 순)

1. **`v0tr` 방향 margin 0.0430 — 라인업 최저 (게이트의 1.23배).**
   게이트를 넘으므로 편입을 막지 않았지만, **회전 오분류가 나면 가장 먼저 의심할 자리**다.
   보강용 보충 블록은 규약대로 만들지 않았다 (금지 규약). 운영자 결정 사항:
   그대로 갈 것인가, A 블록에 상응하는 비대칭을 정본에 넣을 것인가 (= 새 정본 필요).
2. **새 교차 별칭 `v0t ↔ v0tr` (agreement 0.83/0.81) · `v0t ↔ v0trq` (0.79/0.80).**
   이상 표본기에서 게이트 0.78 을 간발로 넘는다. 지금은 자기 계열이 항상 이기지만
   **잡음 여유가 줄었다**. 운영자가 신고한 v0T 의 실기기 오분류(→ v0)와 같은 축이므로,
   실기기 재스캔에서 **v0T 프레임이 v0TR 로 읽히는 일**이 있는지 꼭 봐야 한다.
   (기대 레이아웃 버튼 4종을 lab 에 붙여 뒀다 — 그 계측이 이 질문의 답이다.)
3. **검출 비용 증가 — 기존 프레임 +6 \~ +32 %** (§④). 실사진 벤치로 재확인 필요.
   너무 비싸면 조정 손잡이는 둘이다: ⓐ `v0trqCornerBudget` 을 낮춘다(단 6 미만이면
   v0TRQ 가 아예 안 선다 — 실측) ⓑ 실기기 판정 후 v0T 계열/v0TR 계열 중 한쪽을
   드랍한다. **드랍 판정은 이 레인의 몫이 아니다.**
4. **관측 (범위 밖이지만 재보고할 가치가 있다):** 이 레인의 합성 프레임(ppu 15 · margin 4)
   에서 **v0t 프레임의 `poseCount` 가 `v0=4` 뿐이고 `v0t=0` 이다** — v0T 포즈가 아예
   안 서고 n=13 v0 스윕만 선다. 편입 전/후가 **같은 값**이라 이번 변경이 만든 것이
   아니고, 브리프 §1 의 실기기 관측 「v0T 가 다수 v0(n=13)로 분류되며 실패」와
   **같은 증상**이다. 통합자가 병행 중인 오분류 규명의 재현 케이스가 될 수 있다.
5. `v0try`(먼 코너 슬롯 파생)는 브리프대로 **만들지 않았다**.

### 남긴 것 (의도적)

- `v0t`·`v0ty` 는 셀 배열·상수·검출 브랜치 전부 **읽기만** 했다. 드랍 0건.
- 게이트 상수 전부 무접촉. 새 문턱 0개. 새 cfg 키 4개는 전부 **패밀리 스위치 또는
  후보 예산**이지 판정 문턱이 아니다 (`v0trFamily` · `v0trRequireSquareRing` ·
  `v0trqFamily` · `v0trqCornerBudget`).
- `deploy/` · `relay/` · `.github/` · outer repo 쓰기 0건.

---

## ⑥ untracked 새 파일 목록 (전부)

⚠ **`test/output/` 은 `.gitignore:51` 로 무시된다.** 그래서 아래 파일들은 평범한
`git diff` 에 **한 줄도 안 실린다** — 브리프가 경고한 그 함정이다. 패치를 만들 때
`git add -N -f` 로 intent-to-add 한 뒤 `git diff` 를 뜨고 인덱스를 되돌렸으므로
**`v0tr.patch` 에는 들어 있다.** 그래도 목록을 여기 남긴다:

```
test/output/claude-v0tr-report.md                     (이 보고서)
test/output/lanes/claude-v0tr-measure.mjs             (§① 계측 스크립트)
test/output/lanes/claude-v0tr-measure.out.txt
test/output/lanes/claude-v0tr-crossmatrix.mjs         (§①ⓕ 교차 수용 실측)
test/output/lanes/claude-v0tr-crossmatrix.out.txt
test/output/lanes/claude-v0tr-detect.mjs              (§①ⓔ·§④ 검출·벤치)
test/output/lanes/claude-v0tr-detect.out.txt
test/output/lanes/claude-v0tr-detect-debug.mjs        (§①ⓑ 기전 해부 — 코너 앵커 기각 근거)
test/output/lanes/claude-v0tr-detect-debug.out.txt
test/output/lanes/claude-v0tr-test-final.txt          (테스트 출력)
test/output/lanes/claude-v0tr-test-decode.txt
test/output/lanes/claude-v0tr-test-light1.txt
test/output/lanes/claude-v0tr-test-ui.txt
test/output/lanes/claude-v0tr-test-bundle.txt
test/output/lanes/claude-v0tr-test-editor.txt
test/output/lanes/claude-v0tr-test-blockloc.txt
```

수정된(추적 중) 파일은 §② 표와 같다.

---

## ⑦ `cellSurface-block-locator.test.js` — 별도 장시간 런

이 기계에서 이 파일 하나가 **약 21분** 걸린다 (편입 전에도 같다). 최종 결과:

```
node --test --test-timeout=3000000 test/cellSurface-block-locator.test.js
→ tests 72 · pass 72 · fail 0 · skipped 0
```

핵심 통과 항목 (복호까지 가는 축):

- **v0T 자기 복호 — 톤 4 × 회전 3** (약점 핀 포함) ✔ 무회귀
- **v0TY 자기 복호 — 톤 4 × 회전 3 전부** ✔ 무회귀
- v0T 계열 패밀리 스위치 — 기본 on · 끄면 0 · 서로 독립 ✔
- v0W2 교차 오수용 0 — 양방향 전수 ✔ · 봉합 무회귀 (v0WQ·v0W2·v0WY·v0X) ✔
- v0X 드랍 ①\~④ ✔ · 봉합 ①②③ ✔ · 결정성 ✔

### 첫 런에서 빨개진 6건과 그 처리 (전부 실측 후 핀 갱신 — 게이트 완화 0)

| 실패 | 원인 | 처리 |
|---|---|---|
| `v1r2 결정성` · `v1r2 격리 대조군` · `구 v2r2 소각 차단` (3건) | `poseCount` **모양** 핀에 새 키 둘이 늘었다 (`v0tr:0` · `v0trq:0`) | 기대 리터럴에 두 키 추가. **값은 전부 0 — 어느 수치도 안 움직였다** |
| `v0xq 편입 비침습성` | 느슨한 코너 순회의 소비자가 **셋 → 넷**이 됐다 (v0trq 삼중점 추가). 셋만 꺼서는 순회가 안 멈춘다 | 「다 껐는데 코너 검증이 돌았다」 대조군에 `v0trqFamily: false` 추가 (`offAllThree` → `offAllFour`). 비침습성 명제 자체(verified·poseCount 동일)는 그대로 통과 |
| `v0W2 자기 복호 (드랍 복원)` | **약점 핀이 초록으로 뒤집혔다** — v0tr 포즈 다양성이 v0W2 의 `gamma0.7 rot0` 을 구제했다 | 복원 팔 `RESTORE_V0W_SERIES` 에 `v0trFamily/v0trqFamily: false` 추가 |
| `v0W2 rot0 슬롯 위반 (F6)` | 같은 기전 — v0W 의 위반 수가 3 → 4 로 움직였다 | 같은 처리 (`RESTORE_V0W_SERIES_ISOLATED_LOCATOR`) |

뒤 둘의 처리는 **이 파일이 이미 세워 둔 규약 그대로**다. `RESTORE_V0W_SERIES*` 는
v0T 편입 라운드에 `v0tFamily: false, v0tyFamily: false` 를 넣어 두었고, 그 주석이
「v0t 를 켠 채 복원하면 v0W 계열 세계가 좋아지는 쪽으로도 변한다 — 복원 = 드랍 전
동작 그대로를 재려면 신설 패밀리도 함께 꺼야 한다」 라고 적어 두었다.
**v0TR 이 그 문장을 그대로 재현했으므로 같은 자리에 두 스위치를 더했다.**

⚠ 그래서 이 두 핀은 **여전히 «약점이 있다» 를 말한다** — 약점이 사라진 것이 아니라,
드랍된 계열의 대조군을 드랍 전 세계로 되돌린 것이다. 다만 **부수 관측 하나는 남긴다:
v0TR 포즈가 라인업에 있으면 v0W2 의 `gamma0.7 rot0` 이 실제로 복호된다.** v0W 계열이
언젠가 복원된다면 이것이 재료가 된다 (통합자 판단 항목이지 이 레인의 주장이 아니다).
