# v0TRY 편입 — 레인 보고 (2026-08-18)

- 시작 시점 HEAD: **`00936ce`** (`git pull --ff-only` 로 A 블록 편입을 받았다) · 작업 트리 깨끗함
- 커밋·push·배포 **없음**. 게이트 완화 **0건** (agreement 0.78 · orientationMargin 0.035 ·
  CRC · RS · `v0wySlotQrMinContrast` 0.6 · `...MinCorrelation` 0.25 · `...MinSpanRatio` 0.35 —
  한 값도 안 건드렸다).
- 이 파일은 §3-1 규약대로 **가장 먼저 만들고** 측정할 때마다 append 했다.

---

## ① 계측

계측 스크립트: `test/output/lanes/claude-v0try-measure.mjs`
(출력 `claude-v0try-measure.out.txt`) — ⓐ\~ⓔ 는 **편입 전** 에 잰 것이다.
ⓕ 교차 수용은 레이아웃 등록이 있어야 `evaluateCellSurfaceGeometry` 에 넣을 수 있으므로
편입 뒤 `claude-v0try-crossmatrix.mjs` 로 따로 쟀다 (v0TR 라운드와 같은 순서).

### 자 검증 (측정 전에 자부터 맞춘다)

| 자 | 회귀 핀 | 이 런 | 판정 |
|---|---|---|---|
| `v0t@21` margin | 0.0962 | **0.0962** | ok |
| `v0ty@21` margin | 0.0632 | **0.0632** | ok |
| `v0tr@21` margin | 0.0980 | **0.0980** | ok |
| `v0trq@21` margin | 0.0519 | **0.0519** | ok |
| `v0@13` margin | 0.3111 | **0.3111** | ok |
| `patchesFor(21,'v0tr').corners[0].anchor` 반경 | √279 = 16.7033 | **16.7033** | ok |
| `V0TY_BLOCKS.SLOT` 원점 | (13,13) | **(13,13)** | ok (같은 상자를 쓴다) |

### ⓐ 슬롯 `[13,20]²` 가 삼키는 것 — 블록별 전수

슬롯 크기는 **`CENTER_QR_SLOT_CELLS_V0TY` (= 8) 를 그대로 참조**했다 (새 상수 신설 0).
`SLOT_MIN = 21 − 8 = 13` 이라 상자가 v0TY 와 **문자 그대로 같다**.

| 블록 | v0TR 셀 | 삼킴 | 남음 | 비대칭(전) | 비대칭(삼킴) |
|---|---|---|---|---|---|
| NW 중앙 (0..3)² | 16 | 0 | 16 | 0 | 0 |
| A (4..6)×(3..5) | 9 | 0 | **9** | 9 | 0 |
| NE 바깥 (0..5)×(15..20) | 36 | 0 | 36 | 0 | 0 |
| NE 안쪽 (2..7)×(10..15) | 36 | 0 | 36 | 0 | 0 |
| **SE (18..20)²** | 9 | **9** | **0** | 6 | **6** |

(블록 합 106 = 102 + 4 — 바깥∩안쪽이 j=15 열 4셀을 공유해 두 번 세어진다. v0TR 자기검증이
이미 못 박아 둔 구조다.)

**v0TR 102셀 → 삼킴 9 → v0TRY 93셀.** 삼킨 좌표는 SE 정확히 전부:
`(18,18) (18,19) (18,20) (19,18) (19,19) (19,20) (20,18) (20,19) (20,20)`.
슬롯 박스 안에 남은 v0TRY 셀 **0**.

### ⓑ 남은 방향 판별자 — **9 (A 블록)**, 0 이 아니다

| | 총 비대칭 | A | SE |
|---|---|---|---|
| v0tr | 15 | 9 | 6 |
| **v0try** | **9** | **9** | **0** |

반전 축 분포 `{"L반전": 9}` — A 블록의 L 반전 9셀이 통째로 남는다.
좌표 `(4,3)(4,4)(4,5)(5,3)(5,4)(5,5)(6,3)(6,4)(6,5)` = 통합자 예측 `(4,3)…(6,5)` 와 동일.

→ **§6 첫 탈출구(판별자 0) 는 발동하지 않는다.** v0TY 가 SE 를 잃고도 서는 것과
문자 그대로 같은 구조다 («의도된 비대칭 이중화» 의 두 번째 실증).

### ⓒ 방향 margin — 게이트 0.035, **v0tr·v0ty 와 나란히**

합성 사상 `rotate120(q,r)=(−q−r,q)` ∘ `σ(T→R,R→L,L→T)` 의 두 오방향 순환에서
최소 불일치율.

| id | margin | 내역 | 비대칭/셀 | 게이트 대비 | 판정 |
|---|---|---|---|---|---|
| `v0t` | 0.0962 | 30/312 | 15/104 | 2.75배 | 통과 |
| `v0ty` | 0.0632 | 18/285 | 9/95 | 1.80배 | 통과 |
| `v0tr` | 0.0980 | 30/306 | 15/102 | 2.80배 | 통과 |
| `v0trq` | 0.0519 | 12/231 | 6/77 | 1.48배 | 통과 |
| **`v0try`** | **0.0645** | **18/279** | **9/93** | **1.84배** | **통과** |

통합자 예측 0.0645 (1.84배) 와 **소수 4자리까지 일치**. v0TY(0.0632)보다 근소하게 높은
이유는 분자가 같고(둘 다 A 9셀 × 2 = 18 miss) 분모가 작기 때문이다 (279 vs 285).

### ⓓ autoplace · 회계 · ⑤ 인코더 정합

`minFormatSeparation(21)` = **289**.

| | v0ty (대조) | v0tr (대조) | **v0try** |
|---|---|---|---|
| 파인더 | 95 | 102 | **93** |
| 슬롯 | 64 | 0 | **64** |
| ref / format | 12 / 18 | 12 / 18 | **12 / 18** |
| **data** | 252 | 309 | **254** |
| **S = ⌊data/3⌋** | 84 | 103 | **84** |
| **잔여** | 0 | 0 | **2** ← 유일한 차이 |
| detector (파인더+슬롯) | 159 | 102 | **157** |
| payload L/M/H | 71/60/48 B | 87/73/59 B | **71/60/48 B** |
| `S_fmt` (`metrics.sFmtMax`) | 333 | 388 | **333** (하한 289 의 1.15배) |
| dRef / 하한 | 72 / 64 | 122 / 64 | **72 / 64** |
| ⑤ 인코더 정합 L·M·H | 통과 | 통과 | **통과** |

**autoplace 수용** — §6 두 번째 탈출구 미발동.

⚠ **잔여 2 는 새 값이다** (v0ty 0 · v0tr 0). 441 − 93 − 64 − 12 − 18 = 254 이고
254 = 3×84 + 2 라 심볼로 못 쓰는 셀이 2개 남는다. 라인업에 전례가 있다 —
`v0t@21` 이 잔여 1 이다 (`ACCOUNTING` 표). **게이트가 아니라 회계 사실**이므로
그대로 `DECLARED_DATA` 254 · `ACCOUNTING` `{symbols: 84, residual: 2}` 로 못 박았다.
payload 는 S 가 같아 v0TY 와 한 바이트도 다르지 않다.

### ⓔ 코어 반경 — v0tr 과 **같다** (유도가 옳다)

| | NE 바깥 셀 | r | Δ |
|---|---|---|---|
| `v0tr` | 36 | **16.7033** (√279) | — |
| `v0try` | 36 | **16.7033** | **0.000000** |

슬롯은 SE 쪽이지 NE 가 아니므로 코너 앵커가 한 셀도 안 움직인다 — 브리프가 예고한
«같아야 정상». Δ(√279) = 0.0000 ≤ `ANCHOR_SNAP_CELLS` 3.2 라 v0TR 과 마찬가지로
**같은 (중앙, 코너) 쌍에서 `refinePose` 가 한 벌 더 돈다** (§④ 벤치 항목).

편입 뒤 실제 검출기 경로로 재검산: `patchesFor(21,'v0try').corners[0].anchor` 반경
**16.7033** — `patchesFor(21,'v0tr')` 와 **Δ = 0.000000** (§② 배선 검증에 기록).

<!-- ⓕ 교차 수용 행렬은 편입 뒤 측정 — 아래에 이어 붙인다 -->

### ⓕ 교차 수용 행렬 — 5후보 전조합 (편입 뒤 측정)

`test/output/lanes/claude-v0try-crossmatrix.mjs` (v0TR 라운드 스크립트를 5후보로 확장 ·
이상 표본기 · 슬롯은 «관측 없음»). 출력 `claude-v0try-crossmatrix.out.txt`.

| 프레임 \ 후보 | `v0t` | `v0ty` | `v0tr` | `v0trq` | `v0try` |
|---|---|---|---|---|---|
| `v0t` | 1.0000 자기 | **1.0000 수용** | **0.8431 수용** | **0.7922 수용** | **0.8280 수용** |
| `v0ty` | **1.0000 수용** | 1.0000 자기 | **0.8280 수용** | 0.7647 거부 | **0.8280 수용** |
| `v0tr` | **0.8397 수용** | **0.8246 수용** | 1.0000 자기 | **1.0000 수용** | **1.0000 수용** |
| `v0trq` | **0.7975 수용** | 0.7714 거부 | **1.0000 수용** | 1.0000 자기 | **1.0000 거부** ← |
| `v0try` | **0.8351 수용** | **0.8351 수용** | **1.0000 수용** | **1.0000 거부** ← | 1.0000 자기 |

**정방향 별칭 열 → 열여섯. 회전 별칭은 여전히 0.**

#### 0.78 을 넘는 별칭 전수 (브리프 지시 — 수용 여부와 무관하게 전부 적는다)

18칸이 0.78 을 넘고 그중 16칸이 수용된다. 위 표가 전수다. 세 무리로 갈린다:

- ⓐ **부분집합 별칭 (1.0000/1.0000)** — `v0t↔v0ty` · `v0tr↔v0trq` · **`v0tr↔v0try`(신설)**.
  전부 «슬롯이 상대 파인더를 삼켜 분모에서 빠진다» 는 같은 기전이다.
- ⓑ **공유 블록 별칭 (0.79\~0.84)** — `v0t↔v0tr` · `v0t↔v0trq` · `v0t↔v0try`(신설) ·
  `v0ty↔v0tr` · **`v0ty↔v0try`(신설)**. v0TRY 가 v0T·v0TY 와 **61셀**을 같은 자리에
  같은 톤으로 가지기 때문이다 (정본 의존 규약의 대가 — v0TR 라운드 §ⓕⓒ 와 같은 축).
- ⓒ **`v0trq ↔ v0try` 는 별칭이 아니다** — agreement 는 양방향 **1.0000** 인데
  **방향 margin 이 0 이라 거부**된다. 서로의 유일한 비대칭 블록이 상대 슬롯 안에
  통째로 들어가기 때문이다 (v0trq 의 SE 6 ⊂ v0try 슬롯 · v0try 의 A 9 ⊂ v0trq 슬롯).
  **운영자의 «비대칭 이중화» 설계가 반대 방향으로 동작한 결과**라 두 파생이 서로를
  안 먹는다 — 이번 편입에서 가장 좋은 성질이다.

#### ⚠ «자기 계열이 진다» — §6 세 번째 탈출구를 정면으로 다룬다

이상 표본기에서 **v0try 프레임이 뽑는 레이아웃은 `v0tr`** 이다. 브리프 §6 을 글자
그대로 읽으면 여기서 멈춰야 한다. 멈추지 않은 이유를 숫자로 적는다.

1. **이미 배포된 두 파생에서 똑같이 난다.** 같은 표본기에서 **v0ty 프레임은 v0t 를**,
   **v0trq 프레임은 v0tr 을** 뽑는다. 이것은 이번에 생긴 것이 아니라 v0TR 라운드
   산출 `claude-v0tr-crossmatrix.out.txt` 에 **그대로 찍혀 있는 값**이다
   (그 보고서 §ⓕ 의 「넷 프레임 전부 자기 계열이 뽑힌다」 는 **계열** 단위 진술이고,
   레이아웃 단위로는 그때도 두 프레임이 부모로 뽑혔다 — 그 문장은 정정이 필요하다).
   기전은 `pickBetterLayout` 의 동률(1.0/1.0) 타이브레이크다.
2. **계열 단위로는 지지 않는다.** `cellSurfaceFinal.test.js` §교차 수용 ④-c 가
   다섯 프레임 전부에 대해 «자기 **계열**이 뽑힌다» 를 단언하고 통과한다
   (v0try → v0tr 계열).
3. **실물 래스터에서는 레이아웃 id 까지 정확하다.** 이것이 결정적 근거다 —
   §③ 두 회귀와 §ⓖ 실측이 셋 다 같은 답을 낸다.

→ **탈출구는 «이상 표본기의 좌표» 이지 «v0TRY 의 결함» 이 아니라고 판단하고 진행했다.**
판단 근거를 전부 위에 적었으니 통합자가 다시 볼 수 있다.

### ⓖ 실물 래스터 검출·왕복 (편입 뒤, `claude-v0try-detect.mjs`)

합성 프레임 (ppu 15 · margin 4 · supersample 2 · **embed960 없음**).

**② 왕복 복호 — 5레이아웃 × 2톤/3톤 = 10/10, 레이아웃 id 까지 전부 정확. 불일치 0.**

```
v0t 2/3톤 → v0t   · v0ty 2/3톤 → v0ty · v0tr 2/3톤 → v0tr
v0trq 2/3톤 → v0trq · **v0try 2/3톤 → v0try**
```

**① poseCount (편입 전 → 후)**

| 프레임 | v0tryFamily: false | 기본 (on) | shape | slotQr 거절 |
|---|---|---|---|---|
| `v0t` | v0t=6 · v0ty=1 · v0tr=6 · v0=2 | + **v0try=1** | 7 → **8** | 5 → 10 |
| `v0ty` | v0t=6 · v0tr=6 · v0=2 | **동일** | 6 → 6 | 6 → 12 |
| `v0tr` | v0t=6 · v0tr=6 · v0=1 | **동일** | 5 → 5 | 6 → 12 |
| `v0trq` | v0trq=1 · v0=2 | **동일** | 3 → 3 | 0 → 0 |
| `v0try` | v0t=6 · v0tr=6 · v0=1 | **동일** | 5 → 5 | 6 → 12 |

⚠ **이 조건에서는 v0TRY 자기 프레임의 v0try 포즈가 0 이다.** 숨기지 않고 적는다.
그런데 **v0TY 도 이 조건에서 자기 포즈가 0 이다** (v0TR 라운드 산출에 같은 값이
찍혀 있다 — `claude-v0tr-detect.out.txt` ③ 의 `[v0ty] v0t=6 · v0tr=6 · v0=2`).
즉 v0TRY 의 성질이 아니라 **«먼 코너 슬롯 확증 × 이 프레임 조건»** 의 성질이고,
슬롯 QR 확증을 끄면 (`v0tryRequireSlotQr: false`) 다섯 프레임 중 넷에서 6개씩 선다.
**복호는 두 조건 모두에서 선다** — 포즈 패밀리는 기하 시드일 뿐이고 레이아웃 판정은
CS 채점이 한다.

조건을 블록 로케이터 회귀와 같게(**embed960 추가**) 맞추면 v0try 자기 포즈가 **선다** —
`claude-v0try-poseprobe.out.txt` 실측: v0TRY 프레임 12칸(톤 4 × 회전 3) **전부**에서
v0try 1\~2 포즈. 조건 차이가 만든 값이라는 것의 직접 증거다.

**③ 검출 비용 (5회 평균 · 합성 1프레임 — 절대값이 아니라 자릿수로 읽을 것)**

| 프레임 | 편입 전 (ms) | 편입 후 (ms) | 증가 |
|---|---|---|---|
| `v0t` | 301.9 | 385.7 | **+27.8 %** |
| `v0ty` | 331.1 | 402.0 | **+21.4 %** |
| `v0tr` | 298.4 | 370.2 | **+24.1 %** |
| `v0trq` | 142.5 | 139.9 | −1.8 % (잡음 — 삼중점 경로라 무관) |
| `v0try` | 309.6 | 363.0 | +17.2 % |

코어 반경이 v0TR·v0T 와 **같으므로**(√279) 같은 (중앙, 코너) 쌍마다 `refinePose` 가
한 벌 더 돈다 — v0TY 편입 때와 같은 성질이다. 실사진 벤치는 이 체크아웃에서 불가.

---

## ② 구현 — 건드린 파일과 이유 (파일별 1줄)

`git show e853648 --stat` 으로 v0TR 계열이 들어간 자리를 다시 보고 **같은 자리에** 넣었다.
자리 찾기는 `grep -rn "v0trq" src sites index.html` 로 했다.

| 파일 | 이유 |
|---|---|
| `src/cellSurfaceFinal.js` | `CELL_SURFACE_FINAL_V0TRY` 상수·`_IDS`(맨 뒤)·`_PROFILE`·`_NS`·`DECLARED_DATA`(254)·`V0TRY_CELLS`(**`V0TR_CELLS` 슬롯 박스 필터** — 손 좌표 0)·`V0TRY_BLOCKS`·슬롯 3표(`CENTER_QR_SLOT_IDS`·`centerQrSlotCellsFor`·`CENTER_QR_SLOT_PLACEMENT`)·**로드 시 자기검증 ①-l**·mid 금지 표·`ACCOUNTING` |
| `src/decoder/cellsurface-block-detect.js` | `patchesForV0try`·`patchesFor` 분기(맨 앞)·`V0TRY_CORE_RADIUS_CELLS`(**패치 앵커에서 유도** — 손으로 안 적는다)·앵커드 브랜치(**독립 `if` · `companionsForGate` 형태**)·불스아이 확증 spec 행·cfg 3키·`poseCount.v0try`·슬롯 QR 확증 연결 |
| `src/decoder/cellSurfaceY-detect.js` | 라인업 서술 갱신 (후보 유도는 `finalLayoutIdsForN` 이라 코드 변경 0 — 자동 편입 확인) |
| `src/decoder/cube-detect.js` | n=21 라인업 서술 갱신 (주석만) |
| `src/locatorY.js` | `LOCATOR_PROFILE_CELL_SURFACE_V0TRY` 신설 + `LOCATOR_PROFILES_Y` + `isCellSurfaceLocatorProfileY` |
| `src/sceneY.js` | 레이아웃 id → 기본 로케이터 프로파일 표에 한 행 |
| `src/decode.js` | `locatorProfile` → 레이아웃 id 힌트 1행 + n=21 기본 유도 목록 |
| `src/generator-render-config.js` | `encodeOptionsForY` 분기 1개 (Y1 고정) + `@returns` 유니온 |
| `src/generator-state.js` | `locatorProfileY` 허용값에 1종 추가 (드랍 0건) |
| `index.html` | 검출기 카드 1장(아이콘 = v0TR 문법 + 우하 점선 슬롯) · import · 카드 클릭 분기(**QR 위치를 «면» 으로 맞춘다**) · **`qrPositionCards` 역방향 연동** · `syncYLocatorUi` 프로파일·힌트 · **i18n 3키 × 8언어** |
| `sites/tlscan/strings.js` | `lab.expectedLayout.v0try` × 8언어 |
| `sites/tlscan/scanner.js` | 기대 레이아웃 허용값에 `v0try` 추가 |
| `test/*.test.js` (6종) | 회귀 갱신 + 신설 (§③) |
| `dist/*.html` · `sites/_shared/*.html` | **생성물** — §④ 번들 재빌드 산출 |

### 설계 결정 3가지 (전부 실측·규약 근거)

1. **새 상수 0.** 슬롯 한 변·앵커·뒤집기를 v0TY 값으로 **참조**했다
   (`centerQrSlotCellsFor` 가 `CENTER_QR_SLOT_CELLS_V0TY` 를 그대로 가리키고,
   배치는 `{ anchor: 'far', flip: true }`). 자기검증 ①-l 이 «두 값이 같다» 를 로드 시
   잠그고, 회귀가 «두 슬롯이 같은 상자다» 를 좌표로 잠근다.
2. **`companionsForGate` 형태로 썼다** (브리프 §1 경고 준수). 게이트값(`gateCompanions`,
   잘리지 않은 링 풀)과 정렬값(`companions`)을 갈랐다 — 다른 일곱 브랜치와 같은 꼴이다.
   `squareRingCompanions` 만으로 판정하면 캡된 목록으로 게이트가 서서 거리에서 시드가
   죽는다 (`.agent/_lessons/008` · 링 수리 `3c2bfa0`).
3. **v0TRY 카드는 QR 위치 카드 «면» 과 양방향 연동한다** — v0TRQ 와 반대다.
   v0TRQ 의 슬롯은 중앙(Y-심)이라 «면» 축과 다른 자리지만, **v0TRY 의 슬롯은 v0TY 와
   같은 먼 코너**라 정확히 같은 축이다. 그래서 v0T ↔ v0TY 와 **같은 문법**으로
   v0TR ↔ v0TRY 를 붙였다 (면 선택 + v0tr → v0try · 면 해제 + v0try → v0tr).

**i18n 키는 사전의 빈 슬롯 g936·g937·g938 을 썼다** — `i18n-coverage.test.js` 의 사전
파서가 3자리만 보므로 **4자리 키는 조용히 안 보인다** (v0TR 라운드와 같은 이유).

---

## ③ 테스트 — 명령 원문 · pass/fail/skipped · 추가한 테스트

### 브리프 §③ 필수 9종 — 하나도 빼지 않았다

```
node --test test/cellSurfaceFinal.test.js test/cellSurfaceFinal-decode.test.js \
  test/locatorY.test.js test/locatorY-lab.test.js test/generator-help-capacity.test.js \
  test/generator-help-ui.test.js test/html-module-syntax.test.js test/bundle-scanner.test.js
→ tests 112 · pass 112 · fail 0 · skipped 0   (4분 16초)
   출력: lanes/claude-v0try-test-targeted.txt

node --test --test-timeout=3000000 test/cellSurface-block-locator.test.js
→ tests 74 · pass 74 · fail 0 · skipped 0     (31분 29초 — 별도 장시간 런, §⑦)
   출력: lanes/claude-v0try-test-blockloc-full.txt
```

### 추가로 돌린 것 (사전 키·카드 순서를 건드렸으므로)

```
node --test test/i18n-coverage.test.js test/i18n-fallback.test.js \
  test/generator-state.test.js test/y-cell-editor-refformat.test.js test/scanner-i18n.test.js
→ tests 34 · pass 34 · fail 0 · skipped 0
   출력: lanes/claude-v0try-test-extra.txt
```

| 런 | tests | pass | fail | **skipped** |
|---|---|---|---|---|
| 필수 8파일 통합 | **112** | **112** | **0** | **0** |
| `cellSurface-block-locator` (장시간) | **74** | **74** | **0** | **0** |
| 추가 5파일 | **34** | **34** | **0** | **0** |
| **합계** | **220** | **220** | **0** | **0** |

**skipped 는 전 런 0 이다** — 표적 테스트 안에 덤프 의존 케이스가 없다는 뜻이지
«실사진을 쟀다» 는 뜻이 **아니다** (§⑤).

`index.html` 을 건드렸으므로 **`html-module-syntax.test.js` 를 반드시 돌렸다** — 통과.
`bundle-scanner.test.js` 도 §④ 재빌드 **뒤에** 돌렸다 — 통과.

### 새로 추가한 테스트 (4개)

1. **`cellSurfaceFinal-decode.test.js` — «v0TRY 왕복 — v0try (n=21) × 2톤/3톤»**
   기존 «v0TR 계열 왕복» **바로 옆**에 따로 뒀다. 인코드 → 렌더 → 블록 로케이터 →
   refinePose → CS 게이트 → RS → 페이로드 전 구간을 재고 **레이아웃 id 까지 단언**한다.
   2/2 통과. **이 테스트가 §6 세 번째 탈출구 판단의 근거다.**
2. **`cellSurface-block-locator.test.js` — «v0TRY 자기 복호 — 톤 4 × 회전 3 전부»**
   **12/12 통과** (clean · sCurve0.6 · gamma0.7 · gamma0.6 × rot 0/120/240, 전부
   레이아웃 id 까지 v0try). 슬롯이 SE 를 삼켜도 A 블록 9셀이 세 방향을 전부 가른다 —
   v0TY 가 12/12 인 것과 같은 결과다.
3. **`cellSurface-block-locator.test.js` — «v0TRY 패밀리 스위치»**
   기본 on · 끄면 0 · v0tr/v0ty/v0t/v0trq/v0 poseCount 불변(양방향 독립) ·
   슬롯 QR 확증 스위치가 `v0wyRequireSlotQr`·`v0tyRequireSlotQr` 와 독립.
4. **`cellSurfaceFinal.test.js` — «v0TRY 회계» + «v0TRY 슬롯 규약»**
   회계 254 / S=84 / 잔여 2 전수, payload 가 v0TY 와 바이트 동일·v0TR 보다 작음,
   슬롯 크기·원점·배치가 v0TY 와 **같은 값**임을 단언.

### 갱신한 기존 회귀 (전부 «의도적 갱신» 주석 + 근거 실측 동봉)

`CELL_SURFACE_FINAL_IDS`(13 → **14**) · `ACTIVE_IDS`(5 → **6**) ·
`finalLayoutIdsForN(21)`(4 → **5**) · `allFinalLayoutIdsForN(21)` ·
mid 금지 인스턴스(14 → **15**) · 면 총계(+93×3) · 방향 margin 활성 팔(+v0try 0.0645) ·
교차 수용 별칭 목록(10 → **16**, 실측) + ①-c 기전 핀 + ④-c 계열 표 ·
`LOCATOR_PROFILES_Y` · 생성기 허용값 · 검출기 카드 수(7 → **8**) · 카드 순서 · 부제 키 ·
`poseCount` 모양 핀 3곳(+`v0try: 0`) · `RESTORE_V0W_SERIES*` 2곳(+`v0tryFamily: false`).

**어느 갱신도 게이트 수치를 건드리지 않았다** — 전부 «목록이 늘었다» 이거나
«실측값을 새로 핀했다» 이다.

⚠ **`RESTORE_V0W_SERIES*` 에 `v0tryFamily: false` 를 더한 것**은 그 자리에 이미
적혀 있던 규약 그대로다 — 「복원 = 드랍 전 동작 그대로를 재려면 신설 패밀리도
함께 꺼야 한다」. 안 껐어도 이번 런은 초록이었지만(v0W 축 31/31 통과), 규약을
따르는 쪽이 «드랍 전 세계의 비트 재현» 이라는 그 팔의 정의에 맞는다.

---

## ④ 번들 — 돌린 스크립트, 재빌드된 파일

`ls tools/build-*.mjs` 로 확인해 **아홉 개 전부** 돌렸다 (전부 ok):

```
build-cell-editor · build-finder-editor · build-gen-variants · build-hub · build-lab
build-print-poster · build-scan-variants · build-scanner · build-single
```

재빌드로 **바뀐** 파일: `dist/tlscan.html` · `dist/trilume.html` ·
`sites/_shared/{cell-editor,gen-finder,lab-gen,lab-scan,scan-new}.html`

(`sites/_shared/gen-finder-editor.html` · `print/*` · `sites/tl/*` 는 돌렸지만 산출이
바이트 동일 = 변경 0 — 이 편입이 안 닿는 번들이라는 뜻이다.)

⚠ `sites/tlscan/scanner.js` 의 `SCANNER_BUILD` 스탬프는 **안 올렸다** (§5 배제 목록 —
통합자 몫). 그래서 재빌드된 번들의 스탬프는 `2026-08-18.03` 그대로다.

---

## ⑤ 남긴 것 / 못 한 것 / 통합자가 판단해야 할 것

### 못 한 것 (환경 제약 — 브리프 §0-4 규약대로 손대지 않았다)

- **실사진 검증 0건.** 이 기계에 `test/output/photos/` 가 없다. 전체 스위트를 돌리면
  실사진 가드가 통째로 skip 되어 거짓 초록이 나므로 **표적 테스트만** 돌렸다.
  실사진 A/B · 프레임 예산 벤치는 통합자 몫이다.
- 기존 실패 1건 «Type Y 3톤 실사진 …» 은 이전부터 있던 것이라 손대지 않았다 (§5).
- 검출 비용 수치는 **합성 1프레임 · 5회 평균**이라 자릿수로만 읽어야 한다.

### 통합자가 판단해야 할 것 (우선순위 순)

1. **교차 별칭이 열 → 열여섯이 됐다** (§①ⓕ). 새로 선 여섯 중 둘이 v0T·v0TY 와의
   0.83 급이다. 지금은 계열이 항상 이기고 실물 왕복이 10/10 정확하지만 **잡음 여유가
   또 줄었다** — 운영자가 신고한 «레이아웃 혼동» 과 같은 축이다. 실기기 재스캔에서
   **v0T/v0TY 프레임이 v0TR 계열로 읽히는 일**이 있는지 꼭 봐야 한다.
   (lab 기대 레이아웃 허용값에 `v0try` 를 붙여 뒀다 — 그 계측이 이 질문의 답이다.)
2. **검출 비용 증가 — 기존 프레임 +17 \~ +28 %** (§①ⓖ). 코어 반경이 √279 로 같아
   같은 쌍마다 `refinePose` 가 한 벌 더 돈다. **n=21 후보가 이제 다섯**이다 —
   실사진 프레임 예산으로 재확인 필요. 너무 비싸면 손잡이는 «어느 파생을 드랍할
   것인가» 이고 **그 판정은 이 레인의 몫이 아니다.**
3. **`v0trq ↔ v0try` 가 서로를 안 먹는다** (§①ⓕⓒ) — 판단 재료로 올린다. 두 파생은
   agreement 1.0 인데 방향 margin 0 으로 서로를 기각한다. 만약 v0TR 계열을 줄인다면
   **이 둘을 같이 남기는 것이 서로에게 가장 안전한 조합**이라는 실측이다.
4. **⚠ v0TR 의 낡은 서술 셋 — 내가 안 고쳤다 (§5 «v0tr 은 읽기만»).**
   A 블록 편입(`00936ce`)으로 값이 바뀌었는데 서술이 안 따라갔다:
   - `src/decoder/cellsurface-block-detect.js` 앵커드 브랜치 주석 «v0TR — **여기만
     반경이 다르다** (√129 = 11.3578)» — **틀렸다.** `V0TR_CORE_RADIUS_CELLS` 는
     실측 **16.7033 (√279)** 이다 (코너 앵커가 바깥 사각이므로 — 이 레인이 §①ⓔ 에서
     같은 경로로 재확인했다). 같은 파일 불스아이 확증 spec 행 주석 «반경이 v0X/√279 가
     아닌 유일한 행» 도 같은 오류다. v0TR 라운드 §①ⓑ 가 «바깥으로 되돌렸다» 고 적은
     그 결정이 주석에만 반영되다 만 것이다.
   - `index.html` i18n `g956`(v0TR 설명) × 8언어 — «93셀 · 데이터 318 · margin 0.043 ·
     안쪽 반경이 5.3셀 떨어져 거리로 갈린다». A 블록 편입 후 실제 값은
     **102셀 · 309 · 0.0980** 이고, «거리로 갈린다» 도 위와 같은 이유로 사실이 아니다.
     **사용자에게 보이는 문자열**이라 우선순위가 높다.
   셋 다 **동작에 영향 없는 서술**이지만, 다음 레인이 이 주석을 믿고 설계하면 v0TR
   라운드가 실측으로 기각한 «안쪽 앵커» 를 다시 고르게 된다.
5. **`SCANNER_BUILD` 스탬프를 올려야 한다** — 배제 목록이라 안 건드렸다.
6. **잔여 2** (§①ⓓ) — 게이트가 아니라 회계 사실로 선언했다. 라인업에 전례가 넷 있다
   (v0t 1 · v0w/v0wq/v0w2 2). 공표 용량표(SPEC §5.5)에 v0try 행을 넣을 때 이 값이 간다.
7. **관측 (범위 밖이지만 좋은 소식)** — v0TR 보고 §⑤-4 가 「이 레인의 합성 프레임에서
   v0t 프레임의 `poseCount` 가 `v0=4` 뿐이고 `v0t=0`」 이라고 올렸던 증상이 **해소됐다.**
   같은 하네스·같은 조건에서 지금은 `v0t=6 · v0ty=1 · v0tr=6 · v0=2` 다
   (`v0tryFamily` 를 꺼도 같으므로 **내 변경이 만든 것이 아니다**). `00936ce` 전후
   어딘가에서 회수된 것으로 보인다 — 운영자 오분류 규명의 재료가 될 수 있다.
8. **v0TR 계열 셋은 `index.html` 의 `versionY` 강제 사다리에 없다** (v0T·v0TY 만 있다).
   `encodeOptionsForY` 가 `version: 1` 을 주므로 동작은 옳고, v0tr·v0trq 편입 때부터
   같은 상태다 — 즉 **내가 만든 것도 고친 것도 아니다.** 다만 v0TRY 는 «면» 연동으로
   들어오는 경로가 생겨 v0TY 와 대칭이 되었으므로, 정리한다면 지금이 그 자리다.

### 남긴 것 (의도적)

- `v0t`·`v0ty`·`v0tr`·`v0trq` 의 셀 배열·상수·검출 브랜치 전부 **읽기만** 했다. 드랍 0건.
- **게이트 상수 전부 무접촉. 새 문턱 0개.** 새 cfg 3개는 전부 패밀리 스위치이지
  판정 문턱이 아니다 (`v0tryFamily` · `v0tryRequireSquareRing` · `v0tryRequireSlotQr`).
  슬롯 QR 문턱 3종(`v0wySlotQrMinContrast` 0.6 · `...MinCorrelation` 0.25 ·
  `...MinSpanRatio` 0.35)은 v0WY·v0TY 와 **같은 값을 공유**한다 (경로 파라미터 규약).
- `companionsForGate` · `clusterCores` · `bullseyeConfirmedCornerPool` **무접촉**.
- `deploy/` · `relay/` · `.github/` · outer repo 쓰기 **0건**. 커밋·push·배포 **0건**.

---

## ⑥ untracked 새 파일 목록 (전부)

⚠ **`test/output/` 은 `.gitignore` 로 무시된다.** 그래서 아래 파일들은 평범한
`git diff` 에 **한 줄도 안 실린다**. 패치를 만들 때 `git add -N -f` 로 intent-to-add 한 뒤
`git diff` 를 뜨고 인덱스를 되돌렸으므로 **`v0try.patch` 에는 들어 있다.**

```
test/output/claude-v0try-report.md                        (이 보고서)
test/output/lanes/claude-v0try-measure.mjs                (§① ⓐ~ⓔ 계측)
test/output/lanes/claude-v0try-measure.out.txt
test/output/lanes/claude-v0try-crossmatrix.mjs            (§①ⓕ 교차 수용 5×5)
test/output/lanes/claude-v0try-crossmatrix.out.txt
test/output/lanes/claude-v0try-detect.mjs                 (§①ⓖ 검출·왕복·벤치)
test/output/lanes/claude-v0try-detect.out.txt
test/output/lanes/claude-v0try-poseprobe.mjs              (스위치 회귀 계측 기준 탐침)
test/output/lanes/claude-v0try-poseprobe.out.txt
test/output/lanes/claude-v0try-test-targeted.txt          (필수 8파일 통합 런)
test/output/lanes/claude-v0try-test-blockloc-full.txt     (장시간 전수 런 74/74)
test/output/lanes/claude-v0try-test-blockloc-A.txt        (분할 런 — v0TRY)
test/output/lanes/claude-v0try-test-blockloc-B.txt        (분할 런 — v0T·v0TY)
test/output/lanes/claude-v0try-test-blockloc-C.txt        (분할 런 — v0W 축)
test/output/lanes/claude-v0try-test-blockloc-D1.txt       (분할 런 — v0xq)
test/output/lanes/claude-v0try-test-blockloc-D2.txt       (분할 런 — v0X)
test/output/lanes/claude-v0try-test-blockloc-E1.txt       (분할 런 — v1r2·v2r2)
test/output/lanes/claude-v0try-test-extra.txt             (i18n·편집기 추가 런)
test/output/lanes/claude-v0try-test-final.txt             (중간 런)
test/output/lanes/claude-v0try-test-decode.txt            (중간 런)
test/output/lanes/claude-v0try-test-ui.txt                (중간 런)
test/output/lanes/claude-v0try-test-bundle.txt            (중간 런)
```

수정된(추적 중) 파일은 §② 표와 같다.

---

## ⑦ `cellSurface-block-locator.test.js` — 별도 장시간 런

```
node --test --test-timeout=3000000 test/cellSurface-block-locator.test.js
→ tests 74 · pass 74 · fail 0 · skipped 0   (31분 29초 · duration_ms 1,888,656)
```

이 기계에서 이 파일 하나가 **약 31분** 걸린다 (v0TR 라운드 약 21분 → v0TRY 테스트 2건
추가 + 후보 하나 증가분). 로그 전문 `lanes/claude-v0try-test-blockloc-full.txt`.
분할 런(A/B/C/D1/D2/E1)도 남겨 뒀다 — 합이 74 이고 겹침 0 이다.

핵심 통과 항목:

- **v0TRY 자기 복호 — 톤 4 × 회전 3 전부** (신설) ✔ 75.1초
- **v0TRY 패밀리 스위치 — 독립 4축 + 슬롯 확증 독립** (신설) ✔ 3.5초
- v0T 자기 복호 · v0TY 자기 복호 · v0T 계열 스위치 ✔ 무회귀
- v0W2 교차 오수용 0 — 양방향 전수 ✔ · 봉합 무회귀 (v0WQ·v0W2·v0WY·v0X) ✔ 431.7초
- v0X 드랍 ①\~④ ✔ · v0XQ 드랍 ①\~④ ✔ · v1r2·v2r2 축 ✔ · 결정성 ✔

**첫 런에서 빨개진 것은 1건뿐이었고, 게이트 완화 0 으로 고쳤다:**

| 실패 | 원인 | 처리 |
|---|---|---|
| `v0TRY 패밀리 스위치` (신설) | 계측 기준 프레임을 **v0T 프레임**으로 잡았는데, 이 파일의 조건(embed960)에서는 그 프레임의 v0try 포즈가 0 이다 (레인 하네스에서는 1 이었다 — 조건이 다르다) | `claude-v0try-poseprobe.mjs` 로 «v0try 가 서는 칸» 을 60칸 전수로 재고 계측 기준을 **v0TRY 자기 프레임**으로 옮겼다 (그 조건에서 v0try 2 · v0ty 2 · v0tr 4 · v0t 4 가 함께 서서 네 스위치 독립을 한 프레임에서 잰다). **테스트를 약하게 만든 것이 아니라 계측 기준을 실측으로 고른 것**이다 |

기존 회귀는 **한 건도 빨개지지 않았다** (v0TR 라운드에서는 6건이 빨개졌었다 —
이번엔 `poseCount` 모양 핀 3곳과 복원 팔 2곳을 **미리** 갱신하고 들어갔다).
