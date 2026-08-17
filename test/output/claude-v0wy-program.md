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
로그: `test/output/lanes/claude-v0wy-suite3.txt` (최종 · 재빌드 후) ·
`claude-v0wy-suite2.txt` (중간) · 기준선 `claude-v0wy-baseline.txt`

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
| `test/output/lanes/claude-v0wy-suite2.txt` · `claude-v0wy-suite3.txt` | 스위트 (2047/0/6) |
| `test/output/lanes/claude-v0wy-bench.mjs` · `.out.json` | 49-매트릭스 회수 벤치 |
| `test/output/lanes/claude-v0wy-crossmatrix.mjs` · `.out.txt` | 이상 표본기 교차 수용 행렬 (§6) |
| `test/output/lanes/claude-v0wy-crossreal.mjs` · `.out.txt` | 실물 래스터 교차 전수 + 포즈 층 (§5) |
| `test/output/lanes/claude-v0wy-refbug.mjs` · `.out.txt` | 「면」 카드 ReferenceError 재현 (§7) |
| `test/output/lanes/claude-v0wy-blocklocator.txt` · `claude-v0wy-clip.txt` | 중간 확인 로그 |

> ⚠ **`test/output/` 는 `.gitignore` 51행에 걸려 있다.** 위 산출물과 이 보고서는
> 통합자가 `git add -f` 로 넣어야 유실되지 않는다 (직전 레인이 같은 자리에서
> 렌즈 경고를 받았다).

---
---

# v0WY 프로그램 — 과업 2: v0WY 신설 (운영자 재설계)

> 레인: claude-v0wy · 워크트리 `wt-v0wy` · 2026-08-17 (과업 1 커밋 `5ee9bfc` 위)
> 운영자 스펙: **「허공 면-평면 QR」 폐기 → 윈도 β 식 안쪽 배치 (T면 먼 코너 C0) +
> QR 할당 영역 = v0WQ 슬롯과 동일 크기 (8×8 = 64셀)**

---

## §15. 한 줄 결론

v0WY 를 **진짜 와이어 레이아웃으로 신설**했다 — 파인더 67셀 (K3 중앙 25 + 동심 사각 36
+ **SW 위상 마커 6**) + 먼 코너 QR 슬롯 64셀, 데이터 **280** · S=93 · 잔여 1.
겹침 해소는 **후보 (c) 「SE 마커를 SW 로 이전」** 이고, 다른 둘은 각각 **손대지 않은
게이트**와 **운영자 스펙**이 탈락시켰다 (§16).

구 「허공 마름모」 렌더러는 **제거**했고 (`renderOuterFaceQr` · `PLANE_QR_*`),
`opts.outerFaceQr` 는 조용히 무시하지 않고 **던진다**.
교차 오수용 **양방향 전수 0** (7프레임 × 3회전 21칸 + O/A 4칸) · 자기 복호 **12/12**.
방향 margin **0.0796** (게이트 0.035 의 2.27배). 게이트는 한 값도 안 건드렸다.

---

## §16. ★ 1차 설계 결정 — 겹침 해소 (실측으로 골랐다)

먼 코너 슬롯 `[13,20]²` 는 v0W 의 SE 위상 마커 `(18..20)²` 와 **9셀 전부 겹친다**.
세 후보를 `test/output/lanes/claude-v0wy-design.mjs` 로 나란히 쟀다.

| 후보 | 파인더 | 슬롯 | data | S | 방향 margin | 인코더 정합 ⑤ | 먼 코너 C0 | v0W 와의 셀 차이 |
|---|---|---|---|---|---|---|---|---|
| (a) SE 를 슬롯에 내주고 NW 비대칭에만 의존 | 61 | [13,20]² | 286 | 95 | 0.0437 (1.25×) | **거부** | 닿음 | **0 / 9** (진부분집합) |
| (b) 브리프 문안 「[12,19]² 로 한 칸 안쪽」 | 70 | [12,19]² | — | — | — | — | 안 닿음 | **겹침 4셀 잔존** |
| (b′) 겹침이 실제로 풀리는 최소 후퇴 [10,17]² | 70 | [10,17]² | 277 | 92 | 0.0952 (2.72×) | ok | **안 닿음** | **0 / 0** (완전 동일) |
| **(c) SE 마커를 SW 로 이전** ✅ | **67** | **[13,20]²** | **280** | **93** | **0.0796 (2.27×)** | **ok** | **닿음** | **6 / 9** (양방향) |

### 16.1 (a) 는 **손대지 않은 게이트가 죽인다**

data 286 → S=**95** → ECC-H 예산 57심볼인데 base-211 청크 패커에 57심볼에 정확히
맞는 바이트 수가 없다 (54 B → 56심볼). **v0WQ 슬롯을 9 → 8 로 내린 자기검증 ⑤ 와
같은 자, 같은 S 값**이다. 즉 이 탈락은 레인의 취향이 아니라 인코더 정합이 낸 판정이다.

덧붙여 (a) 는 파인더가 v0W 의 **진부분집합**이다 (내 셀 중 v0W 에 없는 것 **0** · 톤
충돌 **0**) — 브리프가 경고한 「최대 지뢰」 가 설계로 들어온다. margin 0.0437 도 게이트
0.035 의 1.25배뿐이라 열화 한 번에 무너질 자리다.

### 16.2 (b) 는 **문안대로는 겹침이 안 풀리고**, 푸는 순간 스펙을 어긴다

`[12,19]²` 는 (18,18)·(18,19)·(19,18)·(19,19) **4셀이 그대로 겹친다**.
실제로 푸는 최소 후퇴는 `[10,17]²` 인데 그러면 슬롯이 먼 꼭짓점 (20,20) 에 안 닿아
운영자 스펙 「T면 먼 코너 C0 에 묻힘」 을 어긴다. 그리고 파인더가 v0W 와 **셀·톤까지
완전히 같아져** (「내 셀 중 상대에 없음 0 · 상대 셀 중 내게 없음 0」) 판별 근거가
슬롯 QR 하나로 줄어든다 — 브리프의 지뢰가 문자 그대로 실현된다.

### 16.3 (c) 가 산 이유 — 「형제 블록 선택」이지 새 도안이 아니다

SW 위상 마커는 손으로 그린 것이 **아니다**. `V0XQ_MARKER_CELLS`(= v0X SW 6셀)를
**같은 배열 참조**로 쓰는데, 그 배열은 실측으로 **v0 정본 SW 3×2 블록의 (+8, 0)
평행이동**이다 (6/6 완전 일치, `claude-v0wy-design.mjs` §계보).
v0W 의 SE 마커가 v0 SE 3×3 의 (+8,+8) 인 것과 **같은 규칙의 형제 블록**이다.

| 블록 | 셀 | 출처 (같은 배열 / 평행이동) |
|---|---|---|
| NW (0..4)² | 25 | `K3_CENTRE_CELLS` **같은 배열** (v0W 중앙과 동일) |
| NE (0..5)×(15..20) | 36 | `V0XQ_CORNER_CELLS` **같은 배열** |
| SW (18..20)×(0..1) | 6 | `V0XQ_MARKER_CELLS` **같은 배열** = v0 SW (+8, 0) |
| SLOT [13,20]² | 64 | `CENTER_QR_SLOT_CELLS_V0WY` = `CENTER_QR_SLOT_CELLS_V0WQ` 참조 |

**손 좌표표 0줄.** 슬롯 크기도 숫자 8 을 다시 적지 않고 v0WQ 값을 참조한다 —
자기검증 ①-g 가 두 값의 동일성과 「자리는 달라야 한다」 를 함께 못 박는다.

**대가**: margin 0.0952 → 0.0796 (−16.4 %, 마커가 9셀 → 6셀). 그래도 게이트의 2.27배이고
편입 이력이 있는 v0XQ(0.0635 = 1.81배)보다 두껍다.

---

## §17. 방향 margin 전수 (활성 5 + 드랍 4)

| 레이아웃 | n | 파인더 셀 | 면 비대칭 | margin | 게이트 0.035 배수 |
|---|---|---|---|---|---|
| v0 | 13 | 30 | 14 | 0.3111 | 8.89× |
| v0w | 21 | 70 | 10 | 0.0952 | 2.72× |
| v0wq | 21 | 45 | 6 | 0.0889 | 2.54× |
| v0w2 | 21 | 97 | 22 | **0.1512** | 4.32× |
| **v0wy** | 21 | **67** | **8** | **0.0796** | **2.27×** |
| v2r2 (드랍) | 21 | 74 | 26 | 0.2342 | 6.69× |
| v1r2 (드랍) | 21 | 80 | 18 | 0.1500 | 4.29× |
| v0x (드랍) | 21 | 65 | 12 | 0.1231 | 3.52× |
| v0xq (드랍) | 21 | 42 | 4 | 0.0635 | 1.81× |

**활성 최소가 v0wq 0.0889 에서 v0wy 0.0796 으로 내려간다.** 값은 해석식
`2·A / (3·C)` (A = 면 비대칭 셀, C = 파인더 셀) 로 떨어지고, 기존 회귀값
(v0w 20/210 · v0w2 44/291 · v0wq 12/135 · v0xq 8/126) 과 자 검증이 맞는다.
게이트는 **무접촉**이다 — 바뀐 것은 문턱이 아니라 정본의 비대칭 셀 수다.

---

## §18. ★ 최대 지뢰의 처리 — 슬롯 QR 확증 (봉합 ② 재사용)

브리프 경고: 「v0W 와 파인더+중앙 불스아이가 완전 동일 — 판별 = 코너 슬롯 QR 존재 +
포맷 필드뿐」. **(c) 를 고르면서 「완전 동일」 은 깨졌지만** (SW 6 ↔ SE 9), 시드 기하는
여전히 문자 그대로 같다 — 중앙 K3 도 NE 동심 사각도 **같은 배열·같은 자리**라
코어 반경 √279 · 사각 링 동반자 조건 · 앵커 방향 −141.1° 가 전부 일치한다.
v0W2 는 최소한 「중앙이 3면 대칭」 이라는 차이라도 있었지만 v0WY 는 그것조차 없다.

그래서 직전 레인의 **봉합 ② (QR 다움 판별)** 인프라를 그대로 재사용했다 —
`centreQrFinderContrast` 를 **한 줄도 안 고치고**, 부르는 자리만 바꿨다.

| | 봉합 ② (직전 레인) | v0WY 슬롯 확증 (이 레인) |
|---|---|---|
| 대상 패치 | Y-심 중앙 슬롯 | **먼 코너 슬롯** |
| 부르는 시점 | 시드 H (refinePose **전**) | refinePose **통과 후** |
| 왜 | 가짜 삼중점을 미리 자른다 | 시드 기하가 v0W 와 같아 「미리 자르면 v0W 도 죽는다」 |
| 문턱 키 | `centreQrMinFinderContrast` 0.6 (**무접촉**) | `v0wySlotQrMinContrast` 0.6 (**신설**) |

### 18.1 문턱의 근거 — 실측 스윕 (`claude-v0wy-probe.mjs` §③)

포즈 수는 회전 3방향 합. 실제 `decodeFrontend` 경로를 그대로 탄다 (판별기만 따로 잰
값이 아니다). ⚠ calibration 은 `bootstrap.family.cube.calibration` **중첩 경로**로만
넘긴다 — 첫 실행에서 최상위 키로 넘겨 「문턱 −2 부터 1.2 까지 전부 같은 수치」 라는
거짓 결론을 한 번 밟았고, 스윕이 한 자리도 안 움직이면 빨개지는 자 검증을 하네스에 넣었다.

| 문턱 | v0WY 자기 포즈 | v0W 프레임 가짜 | v0W2 프레임 가짜 | v0WQ 프레임 가짜 |
|---|---|---|---|---|
| −2 (사실상 off) | 10 | **16** | **22** | 0 |
| 0 | 10 | 7 | 22 | 0 |
| 0.2 | 2 | 2 | 13 | 0 |
| 0.3 | 2 | 0 | 4 | 0 |
| **0.4** | **2** | **0** | **0** | 0 |
| **0.6 (채택)** | **2** | **0** | **0** | **0** |
| 1.0 | 2 | 0 | 0 | 0 |
| 1.05 | **0** | 0 | 0 | 0 |

**가짜 천장 0.4 · 진짜 바닥 1.0.** 채택 0.6 은 가짜 천장의 1.5배 위, 진짜 바닥의
1.67배 아래이고 두 값의 기하평균(0.632) 근처다. 봉합 ②의 0.60 과 **우연히 같은 값**인데
근거는 이 레인의 자체 실측이다 — 그 키를 건드리지 않으려고 새 키를 뒀다.

열화 축에서도 진짜가 먼저 죽지 않는다 (자기 포즈 수):

| 톤 | 문턱 −2 | 0.4 | 0.6 | 0.9 | 1.0 | 1.05 |
|---|---|---|---|---|---|---|
| clean | 10 | 2 | 2 | 2 | 2 | 0 |
| sCurve0.6 | 11 | 1 | 1 | 1 | 1 | 0 |
| gamma0.7 | 11 | 1 | 1 | 1 | 1 | 0 |
| gamma0.6 | 11 | 1 | 1 | 1 | 1 | 0 |

### 18.2 포즈 회계 — 확증이 실제로 하는 일 (rot0 clean)

| 프레임 | 팔 | poseCount | slotQr 거절 |
|---|---|---|---|
| v0W | 편입 후 | v0w:8 v0w2:8 v0:2 | **8** |
| v0W | v0wy off | v0w:8 v0w2:8 v0:2 | 0 |
| v0W | **슬롯확증 off** | v0w:8 v0w2:8 **v0wy:8** v0:2 | 0 |
| v0W2 | 편입 후 | v0w:8 v0w2:8 v0:2 | **8** |
| v0W2 | 슬롯확증 off | v0w:8 v0w2:8 **v0wy:8** v0:2 | 0 |
| v0WQ | 세 팔 전부 | v0wq:1 v0:2 | 0 |
| v0WY | 편입 후 | v0w:3 v0w2:3 **v0wy:1** v0:2 | 0 |
| v0WY | 슬롯확증 off | v0w:3 v0w2:3 v0wy:3 v0:2 | 0 |

읽는 법:

- **확증을 끄면 v0W·v0W2 프레임에 v0wy 포즈가 각각 8개 선다.** 켜면 **0** 이다.
  가짜 16개가 CS 평가(3방향 × n² 표본) 앞에서 잘린다.
- **비침습성** — v0w:8 · v0w2:8 · v0:2 가 세 팔 전부 **한 자리도 안 움직인다**.
  v0WQ 는 아예 무영향이다 (중앙에 불스아이가 없어 앵커드 경로를 안 탄다).
- 거절 수 8 = 「확증 없이 섰을 포즈 수」 8 과 정확히 같다 — 두 값이 같은 것을
  세는지까지 회귀가 잰다 (`cellSurface-block-locator.test.js`).

---

## §19. 자기 복호 · 교차 오수용 (실물 래스터)

### 19.1 자기 복호 (톤 4 × 회전 3 = 12칸)

| 레이아웃 | clean | sCurve0.6 | gamma0.7 | gamma0.6 | 합 |
|---|---|---|---|---|---|
| **v0wy** | ○○○ | ○○○ | ○○○ | ○○○ | **12/12** |
| v0w | ○○○ | ○○○ | ○○○ | ○○○ | 12/12 |
| v0wq | ○○○ | ○○○ | ○○○ | ○○○ | 12/12 |
| v0w2 | ○○○ | ○○○ | ✗○○ | ✗○○ | 10/12 (**기존 약점 핀** — 무변화) |

v0W2 의 2칸 실패는 편입 전부터 있던 「rot0 × 강한 감마」 자리이고
(`claude-v0w2-program.md` §18 M1), 이 레인은 그 값을 안 건드렸다.

### 19.2 교차 오수용 — 양방향 전수 0

프레임 7종 × 회전 3방향 = 21칸. 드랍 둘은 복원 스위치 위에서 잰다.

```
v0    → v0 · v0 · v0        ✓
v0w   → v0w · v0w · v0w     ✓
v0wq  → v0wq · v0wq · v0wq  ✓
v0w2  → v0w2 · v0w2 · v0w2  ✓
v0wy  → v0wy · v0wy · v0wy  ✓
v0x   → v0x · v0x · v0x     ✓   (복원)
v0xq  → v0xq · v0xq · v0xq  ✓   (복원)
```

Type O · A 프레임(cube 축 밖) × rot 0/120 = 4칸에서 v0wy shape **0** (v0 shape 만 선다).

### 19.3 이상 표본기 별칭 — **한 방향만** 샌다 (설계의 영수증)

`claude-v0wy-crossmatrix.mjs` (3후보 대조군을 함께 돌려 기존 두 칸이 그대로임을 확인).

| 방향 | agreement | 기전 |
|---|---|---|
| `v0w \| v0wq` | 1.0000 | (기존) v0wq 파인더 45 ⊂ v0w 70 |
| `v0wq \| v0w` | 1.0000 | (기존) v0w 의 나머지 25셀이 v0wq 슬롯 안 |
| **`v0wy \| v0w`** | **1.0000** | **신규** — v0W 의 SE 9셀이 v0WY 슬롯 안이라 분모에서 빠진다 |
| `v0w \| v0wy` | — | **없다** — v0WY 의 SW 6셀이 v0W 프레임에서는 데이터라 실제로 어긋난다 |

회전 별칭은 **안 늘었다** — 3후보 때와 같은 `v0wq|LRT|v0w2` 한 칸(agreement 0.8194)뿐.

후보 (b′) 를 골랐다면 파인더가 v0W 와 셀·톤까지 같아 **양방향 전부** 별칭이 됐을
것이다. 실물 래스터에서는 셋 다 재현되지 않는다 (§19.2 가 판정기다).

---

## §20. 벤치 — v0WY **편입 비용** (49-매트릭스 · 인접 교대 · 같은 프로세스)

`claude-v0wy-cost-bench.mjs`. 팔 = `lineup3`(편입 전: 후보 3 + `v0wyFamily: false`) ·
`lineup4`(편입 후) · `shipped`(스위치 없는 기본 라인업).
⚠ 이 머신 ±77 % 스윙 — **결론은 팔별 중앙값이 아니라 같은 칸의 짝 차이 중앙값**이다.

| 타깃 프레임 | lineup3 | lineup4 | 짝 차이 중앙값 | 부호 일치 | 비용 (중앙값) | 총량 |
|---|---|---|---|---|---|---|
| **v0W** | 689.9 ms | 806.5 ms | **+96.8 ms** | 46/49 | **+16.9 %** | +12.8 % |
| **v0W2** | 956.3 ms | 1057.0 ms | **+107.1 ms** | 47/49 | **+10.5 %** | +11.2 % |
| **v0WQ** | 805.9 ms | 814.7 ms | +31.0 ms | 34/49 | +1.1 % | +3.7 % |
| **v0WY** (새 프레임) | 1314.5 ms | 821.9 ms | **−497.7 ms** | **0/49** | **−37.5 %** | −36.4 % |

읽는 법:

- **불스아이 중앙 프레임(v0W·v0W2)이 편입 비용을 낸다** — v0WY 가 같은 앵커드 경로를
  한 번 더 타기 때문이다. 부호 일치 46/49 · 47/49 로 신호가 실재한다.
- **v0WQ 의 +1.1 % 는 결론으로 쓰지 않는다** — 부호가 34/49 로 절반 가까이 뒤집힌다
  (v0WQ 는 중앙에 불스아이가 없어 v0WY 브랜치가 구조적으로 안 돈다 — 기전상 0 이 맞다).
- **v0WY 프레임의 −37.5 % 는 「편입의 정의」 다.** 편입 전에는 어떤 가설로도 성립하지
  않아 파이프라인이 전 가설을 소진하고(1314 ms), 편입 후에는 자기 가설이 조기에
  끝난다(822 ms). 부호 일치 **0/49** — 49칸 전부 같은 방향이다.
- 로케이터 단독 (같은 프레임 11회 교대 중앙값): v0W 156.45 → 207.32 ms ·
  v0W2 151.76 → 191.58 ms · v0WY 117.87 → 130.84 ms · v0WQ 80.63 → 87.38 ms.

**정확도 무회귀**: `shipped === lineup4` 가 네 타깃 전부 문자열까지 동일.
`lineup3 === lineup4` 는 v0W·v0WQ·v0W2 에서 동일하고 **v0WY 에서만 다르다** —
그 갈림이 곧 편입이다. 복호 49/49 (v0W·v0WQ·v0WY) · 44/49 (v0W2, 기존 약점).

---

## §21. v0WQ ↔ v0WY 대조표 — 슬롯 「중앙 vs 코너」

| | v0WQ (Y-심 중앙) | v0WY (먼 코너) |
|---|---|---|
| 슬롯 한 변 · 셀 | 8 · 64 | 8 · 64 (**같다** — 운영자 스펙) |
| 슬롯 원점 | (0, 0) | **(13, 13)** |
| QR 모듈 피치 (셀) | 0.2759 | 0.2759 (**같다**) |
| 뒤집기 규약 | 없음 (파인더가 Y-심 쪽) | **있음** (윈도 β 식 — 정렬 패턴이 안쪽) |
| 파인더 셀 | 45 | **67** (K3 중앙이 살아 있다) |
| 데이터 셀 | 302 | **280** (−22) |
| payload L/M/H (B) | 83 / 71 / 56 | **78 / 66 / 53** |
| 방향 margin | 0.0889 | 0.0796 |
| 시딩 경로 | 코너 삼중점 (중앙 QR) | **앵커드 (중앙 K3 × 원거리)** |
| 49-매트릭스 복호 | 49/49 | 49/49 |
| 프레임 중앙값 (shipped) | 936.1 ms | 871.8 ms |

**교환의 요지**: v0WQ 는 중앙을 QR 에 내주고 위상 마커를 지켰고, v0WY 는 **중앙(=앵커드
시딩의 근거)을 지키고 위상 마커를 옮겼다.** 그 대가로 데이터가 22셀 적고 payload 가
5 B 작다. 대신 v0WY 는 K3 불스아이가 살아 있어 「중앙 불스아이 확증 조립」(봉합 ③)의
구제 대상이 되고, 실기기에서 v0W 계열이 받는 이득을 같이 받는다.

⚠ 프레임 중앙값 936.1 vs 871.8 은 **다른 프레임**의 값이라 짝 비교가 아니다 —
「v0WY 가 더 빠르다」 로 읽으면 안 된다. 짝 비교가 성립하는 것은 §20 의 팔 사이 차이뿐이다.

---

## §22. 손댄 것 — 파일별

### 정본·와이어
| 파일 | 변경 |
|---|---|
| `src/cellSurfaceFinal.js` | `CELL_SURFACE_FINAL_V0WY` 신설 (IDS/PROFILE/NS/DECLARED_DATA 280) · `V0WY_CELLS`(전부 유도) · `V0WY_BLOCKS` · `CENTER_QR_SLOT_CELLS_V0WY`(= V0WQ 참조) · **`CENTER_QR_SLOT_PLACEMENT`**(앵커·뒤집기 정본) · `centerQrSlotOriginFor` · `centerQrFinderCoreCells` · `slotCellsFor(id, **n**)` · 자기검증 ①-g |
| `src/locatorY.js` | `LOCATOR_PROFILE_CELL_SURFACE_V0WY` 신설 + 프로파일 목록·판정 |
| `src/decode.js` | `profileHintId` 에 v0wy (의도적 갱신 — 「프로파일은 없다」 뒤집기) |

### 렌더러
| 파일 | 변경 |
|---|---|
| `src/sceneY.js` | `renderCenterQr` → **`renderSlotQr(…, origin, flip)`** · 구 `renderOuterFaceQr` · `PLANE_QR_*` **제거** · `opts.outerFaceQr` **throw** · 코너 QR 억제 규칙 정리 |

### 디코더
| 파일 | 변경 |
|---|---|
| `src/decoder/cellsurface-block-detect.js` | `buildCenterQrPatch(slot, **origin, flip**)` · `patchesForV0wy`(slotQr 별도 노출) · `V0WY_CORE_RADIUS_CELLS`/`V0WY_N` · **`slotQrConfirmsPose`** (봉합 ② 재사용) · 앵커드·확증 조립 두 곳에 v0wy 브랜치 · cfg 4키 (`v0wyFamily` · `v0wyRequireSquareRing` · `v0wyRequireSlotQr` · `v0wySlotQrMinContrast`) · 진단 `poseCount.v0wy` · `slotQr.rejected` |

### 생성기·UI
| 파일 | 변경 |
|---|---|
| `src/generator-render-config.js` | `encodeOptionsForY` v0WY 분기 |
| `src/generator-state.js` | `locatorProfileY` 허용값 +v0wy · `qrPosition: 'plane'` 문서 갱신 |
| `index.html` | v0WY 검출기 카드 신설 (아이콘: v0W 문법 + 좌하 L + 우하 점선 사각) · QR 위치 「면」 ↔ v0WY **양방향 연동** · 「면」 카드 아이콘·부제 갱신 · `syncYLocatorUi` 프로파일/힌트 체인 · `syncResTierUi` · `versionY` 체인 · `outerFaceQr` 배선 제거 · 슬롯 qrText 가드를 `hasCenterQrSlot` **정본 질의**로 · i18n |

### 파생 번들 (재빌드)
`dist/trilume.html` · `dist/tlscan.html` ·
`sites/_shared/{gen-finder,lab-gen,lab-scan,scan-new,cell-editor}.html`
(`SCANNER_BUILD` = `2026-08-17.04` **무변경**.)

### 테스트
`cellSurfaceFinal.test.js` · `cellSurface-block-locator.test.js` ·
`generator-help-ui.test.js` · `generator-render-config-y.test.js` ·
`locatorY.test.js` · `locatorY-lab.test.js` · `y-cell-editor-refformat.test.js`

---

## §23. 신규 i18n 키 (8언어 전부) + 의도적 갱신 1건

| 키 | 자리 | ko |
|---|---|---|
| **g966** (신규) | 검출기 카드 라벨 | 셀 표면 v0WY · 먼 코너 QR (Y1) |
| **g967** (신규) | 검출기 카드 부제 | 중앙 + 먼 코너 QR |
| **g968** (신규) | 검출기 힌트 | v0WY. v0W 파생 ③ — QR 을 큐브 안쪽 먼 코너… (완문) |
| **g965** (갱신) | QR 위치 「면」 카드 부제 | 「면-평면 (v0WY)」 → **「먼 코너 (v0WY)」** |

용어집 준수: 번역 금지 목록(`v0WY`·`QR`·`Y1`) 유지 · 존대 규약 (fr `vous` ·
de `Sie` · es `usted` · it `tu` · pt 3인칭 «Se escolher…») · 리터럴 `**` 없음 ·
치환 토큰 없음 · pt-PT 어휘(`ranhura`·`padrão`·`detetor`).
g965 는 **갱신이 필수**였다 — 허공 마름모가 사라졌으므로 「면-평면」 이 남으면 화면이
거짓말을 한다. 회귀가 새 값과 옛 값 부재를 함께 건다.

---

## §24. 의도적 갱신 목록 — 「v0WY 는 …이 아니다」 계열 뒤집기

이 편입의 성격상, **부재를 재던 회귀**들이 전부 뒤집혔다. 전부 근거 실측을 동반했고
대조군은 하나도 폐기하지 않았다 (팔이 늘었지 줄지 않았다).

| 자리 | 옛 명제 (허공 마름모 설계) | 새 명제 |
|---|---|---|
| `cellSurfaceFinal.test.js` §「v0WY 는 와이어 id 가 아니다」 | id·프로파일 **부재** + v0W 와 회계 비트 동일 | **진짜 와이어 id** — 67/64/280 · 슬롯 원점 (13,13) · 배치 규약 far+flip |
| 〃 라인업 핀 | IDS 여덟 · ACTIVE 넷 | IDS **아홉** · ACTIVE **다섯** · n=21 후보 **넷** (기본 v0w 불변) |
| 〃 mid 금지 전수 | 아홉 인스턴스 | **열** 인스턴스 (면 합 +67×3) |
| 〃 n=21 교차 수용 | 별칭 2칸 | 별칭 **3칸** — 새 칸은 `v0wy\|v0w` **한 방향뿐** (기전 등식 동반) |
| 〃 방향 margin 전수 | 활성 4행 | 활성 **5행** (기존 넷 값 **무변화**) |
| `cellSurface-block-locator.test.js` §「v0WY 는 렌더 선택이다」 | 복호가 v0w · `poseCount.v0wy` **없음** | 자기 복호 12/12 · 패밀리 실재 · **v0W 프레임 가짜 0 (대조군 8)** |
| 〃 교차 표 | v0WQ 5프레임 | **v0WY 7프레임** 신설 (v0w2·v0wy 행 추가) |
| 〃 poseCount 핀 3자리 | 8키 | **9키** (`v0wy: 0` — 값이 0 이라는 사실까지 고정) |
| 〃 Type O/A 교차 | v0w·v0wq | + **v0wy** |
| 〃 봉합 무회귀 | v0wq·v0w2·v0x | + **v0wy** (네 번째 조건이 봉합 3처방과 안 싸우는가) |
| 〃 (신설) | — | **구 `outerFaceQr` 는 던진다** (조용한 무시 금지) |
| `generator-help-ui.test.js` | 카드 6 · 「면 → v0wq→v0w 전환」 | 카드 **7** · **양방향 연동 3단언** · `outerFaceQr` 배선 **부재** · `hasCenterQrSlot` 질의 |
| `locatorY.test.js` | `'cell-surface-v0wy'` **없음** | 목록 끝에 **있음** |
| `locatorY-lab.test.js` | 허용값 6 · 카드 **부재** 단언 | 허용값 **7** · 카드 **존재** · g966/g967/g968 **8언어** · g965 값 갱신 |
| `y-cell-editor-refformat.test.js` | 카드 순서 6 | **7** (…→ v0W2 → **v0WY**) |
| `generator-render-config-y.test.js` | 「인코더 옵션에 흔적 없음」 | 「Y1 고정 · 데이터 280」 (v0W 의 QR-위치 무관 등식은 **살아 있다**) |

---

## §25. 게이트 무접촉 확인 (매 항목 실측)

| 항목 | 값 | 확인 |
|---|---|---|
| `minimumAgreement` | `0.78` | **무접촉** (diff 에 없음) |
| `minimumOrientationMargin` | `0.035` | **무접촉** |
| CRC · 본문 RS | — | **무접촉** |
| 인코더 정합 (자기검증 ⑤) | — | **무접촉** — 오히려 후보 (a) 를 **이 게이트가 죽였다** |
| 봉합 ① `centreQrBullseyeVetoRadiusRatio` | `0.075` | **무접촉** |
| 봉합 ② `centreQrMinFinderContrast` | `0.6` | **무접촉** (v0WY 는 **새 키** `v0wySlotQrMinContrast` 를 쓴다) |
| `SCANNER_BUILD` | `2026-08-17.04` | **무접촉** |

---

## §26. 막힌 지점 / 남긴 것

우회한 것은 없다. 범위 밖으로 **남기는 것**이 셋이다.

1. **v0WY 의 실기기 실효** — 이 레인이 잰 것은 「구별이 서는가」(합성 21칸 교차 0) 와
   「비용」(§20) 이다. 「먼 코너 QR 이 중앙 QR 보다 잘 읽히는가」 는 QR 리더(ML Kit·Vision)
   쪽 문제이고 합성 축이 **원리적으로 못 잰다**. 다음 실기기 라운드의 항목이다.
2. **활성 최소 margin 이 0.0796 으로 내려갔다** — 게이트의 2.27배라 이 레인은 통과로
   본다. 더 두껍게 하려면 SW 마커를 키워야 하는데, 그러면 v0 정본에 없는 무늬를
   새로 그리게 된다 (손 표 0줄 규약과 교환). 운영자 판단 항목.
3. **§19.3 이상 표본기 별칭** — 새 칸 `v0wy|v0w` 은 「슬롯 셀을 관측 없음으로 돌린다」 는
   표본기 모델의 산물이고 실물 래스터에서는 재현되지 않는다. 직전 레인이 남긴
   「표본기 재설계」 권고가 그대로 유효하다 (여기서 고치면 편입과 채점기 변경이 섞인다).

---

---

## §28. 스위트 (정본 러너)

```
node --test "test/*.test.js" "test/harness/*.test.js" "relay/*.test.js"
```

| | 기준선 (HEAD 36c14f1) | 과업 1 후 | **과업 2 후** |
|---|---|---|---|
| tests | 2041 | 2047 | **2049** |
| suites | 255 | 255 | **255** |
| fail | 0 | 0 | **0** |
| skip | 6 | 6 | **6** |

로그: `test/output/lanes/claude-v0wy-suite5.txt` (duration 476.9 s).
신규 2건은 둘 다 `cellSurface-block-locator.test.js` —
「구 v0WY(허공 면-평면 QR)는 폐기됐다 — outerFaceQr 는 조용히 무시되지 않고 던진다」 ·
「v0WY 교차 오수용 0 — 양방향 전수」. 나머지는 기존 회귀의 **의도적 갱신**이다 (§24).

⚠ **하네스 관측 하나** — 첫 전수 실행에서 `relay/ws.test.js` 가 50분 벽시계에 걸려
실패로 찍혔다. 이 파일만 따로 돌리면 **초록**이고(수 초), 당시 머신에 다른 레인의
node 프로세스가 50개 이상 떠 있었다. 즉 **CPU 기아이지 회귀가 아니다** — 최종
전수(위 표)에서 정상 통과했다. 벤치 수치를 짝 차이로만 읽는 이유도 같은 사정이다.

---

## §29. ★ 실제 UI 확인 (초록 테스트 ≠ 동작하는 UI)

스위트의 카드 단언은 **소스 정규식**이다 — index.html 에서 import 를 지웠을 때 남은
참조가 있으면 런타임 `ReferenceError` 가 나는데 정규식은 그것을 못 본다
(과업 1 §7 이 정확히 그 결함을 잡았다). 그래서 워크트리를 서빙해
(`node tools/dev-server.mjs 8931`) 브라우저로 직접 눌렀다.

**검출기 카드 7개** — `auto · off · v0 · v0W · v0WQ · v0W2 · **v0WY**`.
**QR 위치 카드 7개** — `TL · TR · BL · BR · inner · plane · none`.

### 29.1 양방향 연동 — 네 단계를 순서대로 눌렀다

| # | 조작 | 검출기 (active) | QR 위치 (active) | 해상도 단 | 힌트 |
|---|---|---|---|---|---|
| 1 | v0W 카드 클릭 | `cell-surface-v0w` | TL | auto·low·**mid\***·high(잠금) | g607 (v0W …) |
| 2 | **「면」 클릭** | **`cell-surface-v0wy`** | **plane** | auto·low(잠금)·**mid\***·high(잠금) | **g968 (v0WY …)** |
| 3 | 「좌상」 클릭 | **`cell-surface-v0w`** (복귀) | TL | auto·low·**mid\***·high(잠금) | g607 |
| 4 | **v0WY 카드 클릭** | `cell-surface-v0wy` | **plane** (따라옴) | auto·low(잠금)·**mid\***·high(잠금) | g968 |

②③ 이 QR 위치 → 로케이터 방향, ④ 가 그 반대 방향이다. 어느 한쪽만 있으면 사용자가
상태에 갇힌다 (「면을 골랐는데 검출기가 v0W」 또는 그 반대).

### 29.2 렌더 실물

용량 표시 **19 B / 53 B (Y1T)** — v0WY ECC-H 3톤 payload 53 B 와 일치
(§21 대조표의 계산값). 미리보기에서 **QR 이 큐브 실루엣 안, T 면 먼 꼭짓점(상단 C0)에
마름모로 기울어 박혀 있다** — 운영자 스펙 「윈도 β 식 안쪽 배치 · T면 먼 코너 C0 에
묻힘」 그대로다. L/R 면의 같은 자리는 필러 톤으로 차 있어 실루엣이 안 깨진다.
정렬 패턴 코너가 큐브 안쪽(Y-심 쪽)을 향해 파인더 셋이 바깥 꼭짓점 쪽에 모인다
(윈도 β 와 같은 뒤집기).

콘솔 오류: dev 서버 라이브리로드 WebSocket 실패 **3건뿐** (dev 서버 고유, `scanner.js`
주석이 이미 적어 둔 것). `ReferenceError` 류 **0건**.

## §30. 산출물 (과업 2)

| 파일 | 내용 |
|---|---|
| `test/output/lanes/claude-v0wy-design.mjs` · `.out.txt` | **겹침 해소 3후보 실측** (§16) — margin·회계·인코더 정합 ⑤ |
| `test/output/lanes/claude-v0wy-probe.mjs` · `.out.txt` | margin 전수 · 자기 복호 · **슬롯 QR 문턱 스윕** · 교차 전수 · 포즈 회계 |
| `test/output/lanes/claude-v0wy-crossmatrix.mjs` · `.out.txt` | 이상 표본기 별칭 행렬 (3후보 대조군 포함) |
| `test/output/lanes/claude-v0wy-cost-bench.mjs` · `.out.json` | 49-매트릭스 편입 비용 + v0WQ 대조표 (⚠ 과업 1 의 `claude-v0wy-bench.mjs`(드랍 회수)와 **다른 파일**이다) |
| `test/output/lanes/claude-v0wy-plane-removed.txt` | **지운 구 v0WY 렌더러 전문** (89줄) |
| `test/output/lanes/claude-v0wy-suite5.txt` | 최종 스위트 (2049 / fail 0 / skip 6) |

> ⚠ `test/output/` 는 `.gitignore` 51행에 걸린다 — 통합자가 `git add -f` 로 넣어야
> 유실되지 않는다.
