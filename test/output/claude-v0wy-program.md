# v0WY 프로그램 — 과업 1: v0X 드랍 (차단·비삭제)

> 레인: claude-v0wy · 워크트리 `wt-v0wy` (HEAD 36c14f1) · 2026-08-17
> 배경: 실기기 판정 3라운드 (운영자 2026-08-17) — v0X 드랍 확정
> («파인더 인식 다 해놓고도 잘 못 읽음 + v0 과 혼선 자주»)
> 전례: v1r2·v2r2 (2026-08-16) · v0XQ (2026-08-17 2라운드) — 같은 «차단이지 삭제가 아니다» 규약

---

## §1. 한 줄 결론

v0X 를 **검출 라인업·생성기 카드·스캐너 lab 기대 버튼**에서 내렸다. 와이어·정본·판독·
복원 스위치는 전부 살아 있다. n=21 라인업 기본은 **v0X → v0W 로 승계**됐고 (앞선 세
드랍과 달리 «기본 자체» 가 빠진 첫 사례), 성능 회수는 활성 프레임에서
**v0W −14.6 % · v0W2 −12.1 % · v0WQ −6.4 %** (49-매트릭스 인접 교대 짝비교, 부호
일치 49/49 · 48/49 · 45/49). 스위트 **2047 / fail 0 / skip 6** (기준선 2041 에서 신규 6).

부수적으로 **직전 드랍이 남긴 라이브 결함 하나를 찾아 고쳤다** — 「면」 QR 위치 카드
클릭이 `ReferenceError` 로 죽고 있었다 (§7).

---

## §2. 손댄 것 — 파일별

### 정본·라인업
| 파일 | 변경 |
|---|---|
| `src/cellSurfaceFinal.js` | `CELL_SURFACE_FINAL_DROPPED_IDS += CELL_SURFACE_FINAL_V0X` · 드랍 근거·보존 항목·기본 승계 문서화 |
| `src/decoder/cellsurface-block-detect.js` | `v0xFamily: true → false` (기본 off) + 근거·독립성·정본 의존성 경고 |
| `src/decoder/cellSurfaceY-detect.js` | 복원 스위치 문서에 `v0xFamily` 추가 · 라인업 서술 갱신 |
| `src/decoder/cube-detect.js` | 라인업 주석 갱신 (n=21 은 v0w·v0wq·v0w2) |

### 생성기 UI
| 파일 | 변경 |
|---|---|
| `src/generator-state.js` | `locatorProfileY` 허용값에서 `LOCATOR_PROFILE_CELL_SURFACE_V0X` 제거 (import 포함) |
| `src/generator-render-config.js` | **분기 보존** — 주석만 갱신 (발행분 재생성 경로) |
| `src/locatorY.js` | 상수 보존 — 「드랍됨」 주석 추가 |
| `index.html` | v0X 카드 제거 · 카드 클릭 분기 · `syncYLocatorUi` 프로파일/힌트 체인 · `syncResTierUi` · `versionY` 체인 · import · **「면」 QR 분기 결함 제거** |

### 스캐너
| 파일 | 변경 |
|---|---|
| `sites/tlscan/index.html` | lab 「기대 레이아웃」 v0X 버튼 제거 (i18n 키는 8언어 보존) |
| `sites/tlscan/scanner.js` | `expectedLocatorLayout` 허용값에서 `v0x` 제거. **`SCANNER_BUILD` 무변경** (`2026-08-17.04`) |

### 파생 번들 (재빌드)
`dist/trilume.html` · `dist/tlscan.html` · `sites/_shared/{gen-finder,lab-gen,lab-scan,scan-new,cell-editor}.html`

### 테스트
`cellSurfaceFinal.test.js` · `cellSurface-block-locator.test.js` · `cellSurface-clip-partial.test.js` ·
`cellSurfaceFinal-decode.test.js` · `generator-help-ui.test.js` · `generator-help-capacity.test.js` ·
`locatorY-lab.test.js` · `y-cell-editor-refformat.test.js`

---

## §3. 함정 1 — 정본은 한 줄도 못 내린다 (v0W2 의존성)

브리프가 경고한 그대로이고, **회귀로 못 박았다** (`cellSurface-block-locator.test.js`
§«v0X 드랍 ④»). 측정한 의존 관계:

```
v0X SE (15..20)² 36셀
   └─ (i−15, j) 평행이동 → V0XQ_CORNER_CELLS 36셀
        ├─ v0W   NE   36/36 좌표·톤 일치
        ├─ v0WQ  CORNER 36/36
        ├─ v0W2  NE   36/36
        └─ v0XQ  CORNER 36/36
   └─ 같은 좌표 T·L 면 그대로 → v0W2 SE 대형 마커 36셀 (R 면만 v0W2 독자 표)
```

즉 **활성 레이아웃 셋이 전부 v0X 정본에서 유도된다.** 「드랍」은 라인업에서 내리는
행위이지 정본을 지우는 행위가 아니라는 규약이, 여기서는 표어가 아니라 **의존성**이다.
회귀 ④ 는 (a) v0x 정본 65셀·전 면 0/2 (b) 네 레이아웃의 NE 36셀이 v0X SE 유도값과
일치 (c) v0W2 SE 36셀의 T·L 이 v0X 와 동일 — 셋을 값으로 확인한다.

> 첫 판본은 `V0W_BLOCKS.NE === V0XQ_BLOCKS.CORNER` 로 **참조 동일성**을 재려다 실패했다.
> 그 이름들은 셀 배열이 아니라 경계 서술자(`{iMax, jMin}`)이고, 참조 동일성 자기검증은
> 모듈 **안**에서 `V0XQ_CORNER_CELLS`(비-export) 로 돌고 있다. 밖에서는 값으로 잰다.

---

## §4. 함정 2 — n=21 기본 승계 (v0X → v0W)

`finalLayoutIdsForN` 는 선언 순서를 그대로 쓰고 드랍만 걸러 낸다. 그래서 코드 변경 없이
자동으로 승계된다:

| | 드랍 전 | 드랍 후 |
|---|---|---|
| `finalLayoutIdsForN(21)` | `[v0x, v0w, v0wq, v0w2]` | **`[v0w, v0wq, v0w2]`** |
| `finalLayoutIdForN(21)` | `v0x` | **`v0w`** |
| `wirePreferredFinalLayoutIdForN(21)` | `v2r2` | `v2r2` (**불변**) |
| `allFinalLayoutIdsForN(21)` | 일곱 | 일곱 (**불변**) |

**앞선 세 드랍과 다른 점이 이것 하나다** — v2r2·v1r2·v0xq 는 «기본이 아닌 후보» 를
뺐지만, v0x 는 n=21 의 기본이었다. 운영자 순위·생성기 #22 연동의 «중 = v0W» 와 이제
같은 값을 가리킨다 (전에는 라인업 기본만 v0X 였다).

### 4.1 부작용 하나 — 타이브레이크의 결정 근거가 옮겨 갔다

`pickBetterLayout` 은 accepted·agreement 동률이면 «그 n 의 기본» 을 고른다. 기본이
`v0x` 이던 시절 v0W↔v0WQ 별칭 쌍(§6)에는 기본이 없어 **후보 목록 순서**가 결정했고,
지금은 기본이 `v0w` 라 **순서와 무관하게** v0w 가 이긴다.

실측 (`claude-v0wy-crossmatrix.mjs` 계열 · 이상 표본기, v0WQ 프레임):

| 후보 순서 | 뽑힘 |
|---|---|
| `[v0w, v0wq, v0w2]` | v0w |
| `[v0wq, v0w, v0w2]` | v0w |
| `[v0w2, v0wq, v0w]` | v0w |

실제 라인업 순서에서는 **결과가 같다** (v0w 가 앞). 바뀐 것은 «왜 그렇게 되는가» 이고,
재정렬에 흔들리지 않게 된 만큼 결정성은 좋아졌다. 회귀로 고정했다
(`cellSurfaceFinal.test.js` §④).

---

## §5. 함정 3 — 「v0 과 혼선」의 기전 (실측)

운영자의 두 관측이 **하나의 기전**으로 설명된다. 실물 래스터 로케이터 층 실측
(`test/output/lanes/claude-v0wy-crossreal.mjs` · `.out.txt`, 2톤 rot0):

```
프레임          드랍 후 poseCount                드랍 전(v0x 복원) poseCount
v0  clean       {v0:2, v0x:0, v0w:0, v0w2:0}     {v0:2, v0x:0, v0w:0, v0w2:0}
v0  gamma0.7    {v0:2, v0x:0, v0w:0, v0w2:0}     {v0:2, v0x:0, v0w:0, v0w2:0}
v0  sCurve0.6   {v0:2, v0x:0, v0w:0, v0w2:0}     {v0:2, v0x:0, v0w:0, v0w2:0}
v0x clean       {v0:0, v0x:0, v0w:6, v0w2:6}     {v0:0, v0x:6, v0w:6, v0w2:6}
v0x gamma0.7    {v0:0, v0x:0, v0w:6, v0w2:6}     {v0:0, v0x:6, v0w:6, v0w2:6}
v0x sCurve0.6   {v0:1, v0x:0, v0w:6, v0w2:6}     {v0:1, v0x:6, v0w:6, v0w2:6}
```

읽는 법:

1. **방향이 한쪽이다.** v0(n=13) 프레임은 v0x 포즈를 **한 번도** 안 낸다 (0/3).
   반대로 **v0X 프레임은 v0(n=13) 포즈를 낸다** (sCurve0.6 에서 1). 즉 혼선의 축은
   «v0 를 v0X 로 읽는다» 가 아니라 **«v0X 를 v0 로 읽는다»** 다.
2. 그리고 그것이 첫 관측(「파인더 인식 다 해놓고도 잘 못 읽음」)과 **같은 기전**이다 —
   v0X 프레임에서 포즈는 잔뜩 서는데(v0w 6 · v0w2 6 · v0x 6) 정작 자기 포즈의 CS
   수용이 실기기에서 흔들리면, 살아남은 v0(n=13) 가설이 이긴다. 「인식은 다 됐는데
   못 읽음」 + 「v0 과 혼선」은 한 문장의 앞뒤다.
3. 드랍 후 v0X 프레임은 **깨끗하게 거부**된다 (`frontend:no-format-candidate`) —
   v0W/v0W2 로 조용히 오독되지 않는다. 9/9 칸 전부 그렇다.

### 5.1 합성으로는 재현되지 않는 부분 — 정직하게

「v0 과 혼선」의 **복호 결과** 수준 재현은 **0/9 칸**이다 (v0 프레임은 드랍 전후 모두
`v0@13` 로 정확히 풀린다). 합성 정지 프레임(clean·gamma 0.7·sCurve 0.6 × rot 0/120/240)
에는 라이브 스캔의 흔들림·초점·노출 추적이 없다. 위 §5 의 포즈 표는 «기질이 있다» 를
보이지만 «그 기질이 실기기에서 얼마나 자주 이긴다» 는 **이 레인이 못 잰다**.
그래서 드랍의 근거는 실기기 판정 그대로 두고, 여기서는 기전만 기록한다.

### 5.2 드랍 후 남은 라인업 교차 오수용 전수 재확인

실물 래스터 45칸 (프레임 5종 × 톤 3종 × 회전 3종), 같은 프레임을 두 팔에 넣어 비교:

| 프레임 | 자기 레이아웃으로 복호 (드랍 후) |
|---|---|
| v0 (n=13) | 9/9 |
| v0W | 9/9 |
| v0WQ | 9/9 |
| v0W2 | 8/9 (`gamma0.7/rot0` — **기존 약점 핀** 그대로, 드랍 전후 동일) |
| v0X | 0/9 → 전부 `no-format-candidate` (설계된 거부) |

**활성 라인업 36칸에서 교차 오수용 0.** v0W2 의 1칸 실패는 v0W2 편입 때 이미 핀된
약점이고 (`cellSurface-block-locator.test.js` §«v0W2 자기 복호 … rot0 × 강한 감마 2칸»),
드랍 전후 값이 같다.

---

## §6. 발견 — 이상 표본기의 별칭 (드랍이 만든 것이 아니다)

새 회귀를 쓰다 걸린 것이고, **드랍과 무관하게 HEAD 에도 있다.**

`cellSurfaceFinal.test.js` 의 `idealSampleCellForEncoded` 는 슬롯 셀을 «관측 없음»
으로 돌린다. 그런데:

```
locator(v0wq) 45셀  ⊂  locator(v0w) 70셀   — 좌표 45/45 · 톤까지 45/45 일치
남는 25셀 (v0W NW K3)  ⊂  v0wq 슬롯 64셀   — 25/25
```

→ v0W 프레임을 v0WQ 로 채점하면 45셀이 전부 맞아 agreement 1.0,
   v0WQ 프레임을 v0W 로 채점하면 어긋날 25셀이 분모에서 빠져 역시 1.0.
   **양방향 별칭 2칸.** 드랍 전 7후보 전수에서도 같은 2칸이고 그 2칸이 전부다
   (`claude-v0wy-crossmatrix.out.txt`).

회전 축에서도 한 칸: **v0WQ 프레임을 면 순환 L→R→T 로 돌리면 v0W2 가 agreement
0.8241 (관측 72셀) 로 수용되고 뽑히기까지 한다.** 원인은 같다 — v0w2 로케이터 97셀 중
25셀이 v0wq 슬롯 안이라 분모에서 빠진다.

**실물 래스터에서는 셋 다 재현되지 않는다** (§5.2 — 슬롯 자리에 진짜 QR 모듈·필러
픽셀이 있어 v0W 의 NW 기대가 실제로 어긋난다). 그래서:

- 게이트는 **한 값도 안 건드렸다.**
- 새 회귀는 «교차 0» 이라고 **주장하지 않는다** — 그러면 거짓말이 된다. 대신
  ① 별칭의 **기전**(부분집합 + 슬롯 포함 관계)을 값으로 못 박고
  ② 별칭 집합을 실측 그대로 핀했다 (정방향 2칸 · 회전 1칸).
  새 레이아웃이 또 하나의 부분집합 별칭을 만들면 여기가 빨개진다.
- 판정기는 실물 래스터 표 (`cellSurface-block-locator.test.js` §«v0WQ/v0W2 교차 오수용 0»)
  라고 테스트 주석에 명시했다.

**남기는 권고 (이 레인 범위 밖):** 이상 표본기의 슬롯 처리를 «관측 없음» 이 아니라
«모델 불가 → 그 레이아웃 채점에서 제외» 로 바꾸면 별칭 셋이 함께 사라질 가능성이 크다.
드랍 작업 중에 표본기를 재설계하는 것은 두 변경을 섞는 일이라 하지 않았다.

---

## §7. 발견 — 직전 드랍이 남긴 라이브 결함 (`ReferenceError`)

**증상.** 생성기(lab)에서 Type Y · QR 위치 「면」 카드를 누르면 핸들러가 통째로 죽는다.
카드 활성 표시도, 렌더도, 그 클릭에 딸린 모든 동작이 안 돈다.

**기전.** v0XQ 드랍(2라운드)이 `index.html` 의 import 목록에서
`LOCATOR_PROFILE_CELL_SURFACE_V0XQ` 를 뺐는데, 「면」 카드 핸들러의 비교식은 남았다:

```js
if (generatorState.locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0WQ) {
  …
} else if (generatorState.locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0XQ) {  // ← 바인딩 없음
```

상태가 v0WQ 면 첫 분기에서 끝나 **살아난다** (그래서 눈에 안 띈다). 그 외 모든 상태
(off · v0 · v0W · v0X …)에서 둘째 비교식이 평가되며 `ReferenceError` 다.
재현: `test/output/lanes/claude-v0wy-refbug.mjs` (`.out.txt`)

```
상태=v0wq : ok
상태=off              : ReferenceError: LOCATOR_PROFILE_CELL_SURFACE_V0XQ is not defined
상태=cell-surface-v0  : ReferenceError: …
상태=cell-surface-v0w : ReferenceError: …
상태=cell-surface-v0x : ReferenceError: …
```

**왜 테스트가 못 봤나.** 회귀가 `assert.match(INDEX, /…V0XQ\) \{\s*generatorState…/)`
였다 — **소스에 그 문자열이 있는가**만 봤고, 그 식별자에 바인딩이 있는지는 안 봤다.
「이 배선이 있다」를 재는 자가 「이 배선이 돈다」를 재는 것처럼 이름 붙어 있었다.

**고친 것.** 두 끝점(v0xq·v0x)이 모두 드랍된 지금 그 분기는 무의미하므로 통째로
걷어냈다. 그리고 회귀를 **부재 단언으로 뒤집었다** — 「index.html 코드에 바인딩 없는
`LOCATOR_PROFILE_CELL_SURFACE_V0X(Q)` 식별자를 두지 않는다」. 주석은 제외하고
(설명 문장에 이름이 계속 나온다) 자 검증으로 «살아 있는 형제 이름은 잡힌다» 를 함께 건다.

---

## §8. 회수 실측 — 49-매트릭스 인접 교대 짝비교

하네스: `test/output/lanes/claude-v0wy-bench.mjs` (직전 레인 `claude-v0w2-bench.mjs`
승계, 가르는 항목만 v0xq → v0x). 결과: `claude-v0wy-bench.out.json`.

규율 두 가지를 그대로 지켰다 — ① calibration 은 `bootstrap.family.cube.calibration`
**중첩 경로**만 (최상위 키는 조용히 버려진다) ② **인접 교대 + 짝 차이**만 신뢰
(순환 치환 + 반전으로 순열 편향 제거, 결론은 칸별 중앙값).

팔: `lineup3` = 드랍 후 `[v0w, v0wq, v0w2]` · `lineup4` = 드랍 전
`[v0x, v0w, v0wq, v0w2]` + `v0xFamily: true`. `shipped` = 스위치 없는 기본 라인업.

| 타깃 프레임 | 중앙값 회수 | 짝 차이 중앙값 | 부호 일치 | 총량 회수 |
|---|---|---|---|---|
| **v0W** | **−14.6 %** | 104.6 ms | 49/49 | −13.5 % |
| **v0W2** | **−12.1 %** | 128.1 ms | 48/49 | −12.3 % |
| **v0WQ** | **−6.4 %** | 38.7 ms | 45/49 | −5.1 % |
| v0X (드랍된 프레임) | **+60.8 %** | −449 ms | 0/49 | +56.3 % |

**v0X 프레임이 느려지는 것은 결함이 아니라 회계다.** 그 프레임은 이제 어떤 가설로도
성립하지 않으므로 파이프라인이 **조기 종료 없이 전 가설을 소진**한다 (726 ms → 1168 ms).
«읽히던 것이 안 읽히면서 더 오래 걸린다» 는 드랍의 정직한 비용이고, 실기기에서는 그
프레임 자체가 더 이상 발행되지 않는다는 전제 위에서 받아들인 값이다.

정확도 무회귀: `shipped === lineup3` 이 네 타깃 전부 문자열까지 동일.
`lineup3 === lineup4` 는 활성 셋에서 동일, v0X 에서만 다르다 (그것이 곧 드랍이다).

로케이터 단독 (같은 프레임 11회 교대 중앙값): v0W 프레임 164.24 → 142.35 ms,
v0W2 167.19 → 144.03 ms, v0X 143.16 → 112.00 ms. v0WQ 는 74.80 → 76.89 ms 로 역전인데
이 크기(2 ms)는 이 머신의 스윙 안이라 결론에 쓰지 않는다.

---

## §9. 보존 확인 — 「차단이지 삭제가 아니다」

| 항목 | 상태 | 증거 |
|---|---|---|
| `CELL_SURFACE_FINAL_IDS` (여덟) | 불변 | `cellSurfaceFinal.test.js` |
| `CELL_SURFACE_FINAL_NS.v0x` · `_PROFILE.v0x` | 불변 | 〃 |
| `cellSurfaceFinal(21,'v0x')` | 생성됨 | 〃 (신규 단언) |
| `V0X_CELLS` · `V0X_BLOCKS` · `V0XQ_CORNER_CELLS` | 무접촉 | 블록 로케이터 §«v0X 드랍 ④» |
| v0X 회계·구조·왕복·렌더 자체검증 | 그대로 초록 | `cellSurfaceFinal.test.js` |
| 구 인쇄물(정규화 전 mid 4면) 호환 | 복원 스위치 위에서 초록 | 블록 로케이터 §구 인쇄물 |
| `encodeOptionsForY` v0X 분기 | 보존 | `generator-render-config-y.test.js` |
| i18n 키 g602/g603/g944 | 8언어 보존 | `locatorY-lab.test.js` (신규 순회) |
| lab 사전 키 `lab.expectedLayout.v0x` | 8언어 보존 | 스캐너 i18n 키 집합 동일성 |
| 로케이터 복원 (`v0xFamily: true`) | 포즈·복호 완전 복구 | 블록 로케이터 §«v0X 드랍 ②» |
| CS 후보 복원 (`includeDroppedCellSurfaceLayouts`) | 왕복 2·3톤 초록 | `cellSurfaceFinal-decode.test.js` §드랍 n=21 왕복 |

---

## §10. 「중 = v0X 규칙」 참조 정리

`index.html` `syncResTierUi` 에서 v0X 가 쓰던 «중 한 단 잠금 · #22 연동 없음» 규칙은
이제 **v0W2 혼자** 쓴다 (`cellSurfaceV0x` 지역 변수 제거, `cellSurfaceV0w2` 로 일원화).
#22 연동 매핑(저 ↔ 중 = v0 ↔ v0W/v0WQ)은 운영자 지시대로 **무변경**이다.
같은 자리에 「라인업 기본(v0w)과 #22 의 «중 = v0W» 가 처음으로 같은 값을 가리킨다」를
주석으로 남겼다 — 다음에 승자가 바뀔 때 두 곳을 함께 봐야 하는 자리다.

`versionY` 강제 체인·`syncYLocatorUi` 프로파일/힌트 체인·카드 클릭 dispatcher 에서도
v0X 분기를 걷었다 (허용값에서 빠져 `next` 가 그 값이 될 수 없다).

---

## §11. 스위트·기준선

| | 기준선 (HEAD 36c14f1) | 이 레인 |
|---|---|---|
| tests | 2041 | **2047** (+6) |
| suites | 255 | 255 |
| fail | 0 | **0** |
| skip | 6 | 6 |

신규 6건:
- `cellSurfaceFinal.test.js` — n=21 활성 라인업 교차 수용 (별칭 기전 핀)
- `cellSurface-block-locator.test.js` — v0X 드랍 ①②③④
- `cellSurfaceFinal-decode.test.js` — 드랍 n=21 왕복 (복원 스위치)

러너: `node --test "test/*.test.js" "test/harness/*.test.js" "relay/*.test.js"`
로그: `test/output/lanes/claude-v0wy-suite2.txt` (기준선 `claude-v0wy-baseline.txt`)

게이트 무접촉 확인: `agreement 0.78` · `orientationMargin 0.035` · CRC · RS ·
인코더 정합 ⑤ · 봉합 문턱 `0.075R` / `0.60` — 이 레인의 diff 에 이 값들이 한 번도
나오지 않는다. `SCANNER_BUILD` 는 `2026-08-17.04` 그대로.

---

## §12. 기존 테스트 변경 — 「의도적 갱신」 목록

전부 주석 + 근거 실측을 동반했다. 대조군은 **하나도 폐기하지 않았다** — 드랍된 축은
전부 복원 스위치 위로 이관됐다.

| 테스트 | 갱신 | 근거 |
|---|---|---|
| `cellSurfaceFinal.test.js` 라인업 핀 | DROPPED +v0x · ACTIVE −v0x · 기본 v0w | §4 |
| 〃 방향 margin 전수 | **값 무변경**, v0x 행을 드랍 보존 팔로 이관 + 두 팔이 실제 라인업과 어긋나면 빨개지는 자기검증 추가 | §4 |
| 〃 n=21 4-way 교차 | 제목만 «드랍 4후보» 로 — 표는 그대로 (법의학 대조군) | §6 |
| `cellSurface-block-locator.test.js` v0X 절 | 복호 → `RESTORE_DROPPED` · 검출 → `RESTORE_V0X_LOCATOR` | §9 |
| 〃 v0W/v0WQ/v0W2 교차 표 | v0x 행에 복원 스위치 (행 **유지** — 「v0 과 혼선」의 유일한 계측기) | §5 |
| 〃 봉합 무회귀 | v0x 행을 **두 팔 모두** 복원 위로 — 안 그러면 `if (pre.ok)` 가 조용히 건너뛰어 «아무것도 안 재는 행» 이 된다 | — |
| 〃 봉합 ② QR 다움 | v0x 행 복원 + «자기 패밀리 셰이프를 찾았는가» 자기검증 (폴백이 남의 포즈로 재던 자리) | — |
| `cellSurface-clip-partial.test.js` | 파일 전역 복원 스위치에 `v0xFamily: true` | 픽스처 절반이 v0X |
| `cellSurfaceFinal-decode.test.js` | ACTIVE_LINEUP 에서 v0x 분리 → `DROPPED_N21_LINEUP` (복원 팔) | §9 |
| `generator-help-ui.test.js` | 카드 7 → 6 · subKeys −g944 · 「면」 회귀를 부재 단언으로 반전 | §7 |
| `generator-help-capacity.test.js` | `finalLayoutIdForN(21)` v0x → v0w + 「두 값이 다르다」 전제 자기검증 추가 | §4 |
| `locatorY-lab.test.js` | 허용값 −v0X · 카드 부재 단언 (닫는 따옴표 필수 — 접두사 함정) · g602/g603/g944 8언어 보존 순회 | §9 |
| `y-cell-editor-refformat.test.js` | `LOCATOR_CARD_ORDER` −v0x | §2 |

**용량 회귀(g906 툴팁)는 손대지 않았다** — v2r2·v1r2·v0XQ 가 드랍된 뒤에도 그 행이
남아 있는 것이 이 표의 전례다 (용량은 라인업 소속이 아니라 레이아웃의 성질).

---

## §13. 막힌 지점

없음. 우회한 것도 없다. 다만 두 가지를 **범위 밖으로 남긴다**:

1. **§6 이상 표본기 재설계** — 별칭 셋의 근본 원인이지만, 드랍 작업 중에 채점기 모델을
   바꾸면 두 변경이 섞여 어느 쪽이 무엇을 바꿨는지 못 읽게 된다. 지금은 실측 그대로
   핀했고, 판정기가 실물 래스터라는 것을 테스트 주석에 명시했다.
2. **§5.1 라이브 재현** — 「v0 과 혼선」의 복호 수준 재현은 합성 프레임 0/9 다.
   포즈 층 기질은 잡았지만 빈도는 못 쟀다. 실기기 계측 없이 그 이상 말하지 않는다.

---

## §14. 산출물

| 파일 | 내용 |
|---|---|
| `test/output/lanes/claude-v0wy-baseline.txt` | 기준선 스위트 (2041/0/6) |
| `test/output/lanes/claude-v0wy-suite2.txt` | 최종 스위트 (2047/0/6) |
| `test/output/lanes/claude-v0wy-bench.mjs` · `.out.json` | 49-매트릭스 회수 벤치 |
| `test/output/lanes/claude-v0wy-crossmatrix.mjs` · `.out.txt` | 이상 표본기 교차 수용 행렬 (§6) |
| `test/output/lanes/claude-v0wy-crossreal.mjs` · `.out.txt` | 실물 래스터 교차 전수 + 포즈 층 (§5) |
| `test/output/lanes/claude-v0wy-refbug.mjs` · `.out.txt` | 「면」 카드 ReferenceError 재현 (§7) |
| `test/output/lanes/claude-v0wy-blocklocator.txt` · `claude-v0wy-clip.txt` | 중간 확인 로그 |
