# v1r2 부활 — n=21 A/B 후보 등록 + 블록 로케이터 v1r2 패밀리

작업 루트: `C:\Dev\TrilLuminanceCube\TLcube` · 기준 커밋 `f2dbb2b` · **커밋/push/배포 없음**
(워킹 트리 변경만). 작성 2026-08-15 밤.

## 0. 한눈에

| 작업 | 상태 | 핵심 수치 |
|---|---|---|
| ① 레이아웃 등록 (autoplace 유도 + 왕복) | 완료 | 파인더 80셀 · data 334 · S 111 · 잔여 1 |
| ② n=21 병행 평가 + 교차 오수용 시험 | 완료 | 자기 agreement 1.000 / 상대 0.18\~0.20, 상대 수용 **false** |
| ③ 생성기 UI 슬롯 교체 (β → v1r2, i18n ko/en/ja) | 완료 | g547·g548 신규, hex-frame-v1 은 차단·비삭제 |
| ④ 블록 로케이터 v1r2 패밀리 | 완료 | 회전 스윕 없음 · 4앵커 DLT · 12 서브앵커 |
| ⑤ 벤치 (자 검증 → v1r2) | 완료 | v2r2@21 **49/49**(자 검증 일치) · v1r2@21 **49/49** |
| ⑥ 번들 재빌드 + 전 스위트 | 완료 | **1431 / 1430 pass / 1 fail**(기존 실사진 1건) |

미완: **실사 A/B 는 미실시** — 이 레인은 «공정한 A/B 조건» 을 만든 것이지 우열 판정이 아니다.
합성 매트릭스에서는 v2r2·v1r2 가 **둘 다 49/49** 라 차이가 드러나지 않는다.
브리프의 «4코너 블록 검출» 가정은 정본 톤에서 성립하지 않아 조립 구조를 정정했다(§4).

---

## 1. 레이아웃 등록 — v1r2 를 최종 라인업에 (완료)

### 정본 유도

- 입력: `.agent/decoder/data/cellsurface-v1r2-editor.json` (n=21).
- **파인더 점유 = toneOverrides 가 닿는 (i,j) 전체 = 80셀.** `userNonData` 62 만 세면
  안 된다 — 편집기 자신의 고정 배치(format 15 + reference 12) 중 **18셀이 칠한 블록
  안**에 들어 있어서 userNonData 목록에서 빠져 있다. 실제로 그 18셀은
  `placementY` 레거시 좌표와 정확히 일치함을 확인했다:
  legacy format 8셀 `(1,2)(1,3)(1,4)(2,1)(3,1)(4,1)(16,19)(17,19)` +
  legacy reference 10셀 `(2,2)(2,3)(3,2)(2,18)(2,19)(18,2)(19,2)(18,18)(18,19)(19,18)`.
  JSON 의 `counts.data = 352 = 441 − 62 − 27` 은 «편집기 고정 배치» 기준이고,
  autoplace 계약에서는 27 이 파인더 밖으로 재유도되므로 **441 − 80 − 27 = 334** 다
  (기존 `src/cellSurfaceLayouts.js` 초안 선언값과 동일 → 교차 검증됨).
- 네 코너 블록: **NW 5×5(25) · NE 계단(15) · SW 계단(15) · SE 5×5(25)** — 코너별 비대칭.
  렌더 기준으로 NW 는 세 면의 원점이 모이는 **중심**, SE 는 면별 **먼 꼭짓점**이다.

### autoplace 산출 (손 좌표표 없음 — `placeReservedCells(21, painted80)`)

```
format(15) : 5,1 6,1 7,1 8,1 9,1 | 1,5 1,6 1,7 1,8 1,9 | 11,19 12,19 13,19 14,19 15,19
reference(12): 2,5 3,5 2,6 | 17,3 18,3 17,4 | 3,17 4,17 3,18 | 15,15 16,15 15,16
metrics    : dRef 145 (하한 64) · sFmtMax 360 (하한 289) · sFmtMin 72 · occupied 80
```

회계: `441 − 80(painted) − 12(ref) − 15(fmt) = 334` · S = 111 · 잔여 1 · nsym(M) = 29 ·
maxPayload 78 B (v2r2@21 은 349 / 116 / 82 B — v1r2 가 4 B 작다).

### 계약·배선

- `src/cellSurfaceFinal.js` — `v1r2` 를 세 번째 최종 레이아웃으로 등록.
  `CELL_SURFACE_FINAL_NS.v1r2 = [21]`, 프로파일 `cell-surface-v1r2`,
  **formatIndex 신설 없음** (2톤 1 · 3톤 3 을 v0·v2r2 와 공유).
  `finalLayoutIdForN(n)` 은 **기본값**으로 유지(21→v2r2, 기존 동작 불변) 하고,
  새 `finalLayoutIdsForN(n)` 이 후보 전부(21→`['v2r2','v1r2']`)를 준다.
  모든 접근자에 선택적 `id` 인자를 붙였다 (생략 시 종전과 동일한 기본 레이아웃).
- **id 충돌 처리 (중요)**: 같은 기하가 `src/cellSurfaceLayouts.js` 에 초안 `'v1r2'`
  (formatIndex 4/6) 로 이미 살아 있었다. 두 경로가 서로를 가리지 않도록 **초안 id 값을
  `'v1r2d'` 로 분리**했다 — 상수 이름(`CELL_SURFACE_LAYOUT_V1R2`)·프로파일 문자열·
  formatIndex 4/6 소각 기록·기존 테스트는 그대로다 (테스트의 리터럴 `'v1r2'` 2줄만
  상수 참조로 바꿨고 단언 내용은 불변). `decode.js` 는 와이어 formatIndex 가 초안
  슬롯(4/5/6/7)이면 프로파일 힌트를 무시하고 초안 경로로 내려보낸다 — 배포된 초안
  출력물의 법의학 복호가 죽지 않는다.
- 배선한 소비자: `encodeY.js`(용량·scan·filler·locator), `decode.js`(힌트·용량·scan),
  `verifyY.js`, `sceneY.js`(로케이터 톤), `decoder/bootstrap.js`(layout map·format 셀·이름),
  `decoder/cellSurfaceY-detect.js`(locator 표).

### 왕복

`test/cellSurfaceFinal.test.js` 에 추가 (전부 통과):

- `v1r2 회계` — 80/334/111/1, 코너 25/15/15/25, autoplace 하한, 기본 경로 불변(21→v2r2).
- `v1r2 인코더 왕복` — 2톤·3톤 digit 레벨 `decodeCells` 왕복 ✔ (레이아웃 id / locatorProfile
  힌트 둘 다). **n+formatIndex 만 주면 풀리지 않는다**는 반증면도 고정했다 —
  «레이아웃 판별은 와이어가 아니라 로케이터·평가 게이트» 라는 계약의 시험.
- `v1r2 렌더 자체 검증` — `verifyRasterY` mismatch 0 · erasure 0 (2톤·3톤).
- `encodeY 버전 가드` — v1r2 는 Y1(n=21) 전용, 용량 초과 시 조용히 v2r2 로 안 넘어간다.

## 2. n=21 병행 평가 (완료)

- `decoder/cellSurfaceY-detect.js` `resolveLayoutIds()` 가 이제 `finalLayoutIdsForN(n)`
  를 돌려준다 — n=13 `[v0]` · **n=21 `[v2r2, v1r2]`** · n=25 `[v2r2]`. n=25 는 손대지 않았다.
- 수용 판정은 **기존 게이트 그대로**: agreement ≥ 0.78 · orientation margin ≥ 0.035 ·
  tone separation ≥ 0.012 · 면당 표본 ≥ 8. 게이트를 건드리지 않았다.
- 둘 다 통과하면 `ambiguous: true` 로 남기고 agreement 높은 쪽을 고른다. 동률 tie-break 을
  결정적으로 만들었다(`pickBetterLayout(left, right, preferredId)` — n 의 기본 레이아웃 우선).
  종전 tie-break 은 초안 기본값(`DEFAULT_CELL_SURFACE_LAYOUT`)을 봤는데, 후보가 둘이 된
  뒤로는 그 값이 어느 쪽도 아니게 되어 순서 의존이 생겼다.
- 후보 하나의 표본 실패가 다른 후보를 죽이지 않도록 바꿨다 (전부 실패할 때만 첫 실패를
  그대로 반환 — 후보가 하나인 n 에서는 종전과 완전히 동일).
- **lab 전용**: 이 경로 전체가 `enableCellSurfaceY` 아래에 있고 스캐너는
  `enableCellSurfaceY: isLabPath()` 로만 켠다 (`sites/tlscan/scanner.js:517`). 안정판은
  CS 평가 자체를 돌지 않는다 — 별도 게이트를 새로 만들지 않았다.
- `formatIndex` **신설 없음** (2톤=1 · 3톤=3 유지).

### 교차 오수용 시험 (필수 항목) — 통과

완전한 심볼 하나를 n² 전 셀 표본기로 바꿔(파인더=레이아웃 톤, 나머지=실제 digit 의 2톤
패턴) **두 후보가 모두 표본을 얻는 조건**에서 채점했다. 결과:

| 프레임 | 뽑힌 레이아웃 | 자기 agreement | 상대 agreement | 상대 수용 | 상대 거부 사유 | margin |
|---|---|---|---|---|---|---|
| v2r2@21 | v2r2 | 1.0000 | 0.2000 | **false** | tone-separation | 0.2462 |
| v1r2@21 | v1r2 | 1.0000 | 0.1795 | **false** | tone-separation | 0.1500 |

- 상대 레이아웃은 agreement 0.18\~0.20 (게이트 0.78 의 1/4)이고, 그 전에 **톤 분리**에서
  먼저 죽는다 — 상대 파인더 좌표에서 dark/bright 앵커 중앙값이 붙어 버리기 때문.
- `ambiguous` 는 두 프레임 모두 false.
- 회전 오방향(±120°)도 두 프레임 모두 거부.
- v2r2 margin 0.2462 는 기존 정본 수치와 일치 — **하네스 자 검증**이 같이 성립한다.

## 3. 생성기 UI 슬롯 교체 (완료)

- `index.html` §`yLocatorSection` 에서 **「실험 프레임 β」 카드(`data-locator="hex-frame-v1"`,
  i18n g517)를 빼고 그 자리에 「셀 표면 v1r2 (Y1)」 카드**(`data-locator="cell-surface-v1r2"`)를
  넣었다. 카드 순서: 끔 · **v1r2** · v0 · v2r2.
- **hex-frame-v1 은 차단이지 삭제가 아니다** — `locatorY.js` 의 렌더(`locatorShapesY`)·
  마진(`locatorOuterPaddingCells`)·프로파일 상수·`GENERATOR_STATE_SCHEMA` 허용값·
  `index.html` 의 카드 클릭 분기와 마진 로직이 전부 그대로다. UI 진입점만 없앴다.
  i18n g517/g520 도 남겼다(테스트가 3언어 존재를 계속 확인한다).
- 새 i18n **g547**(라벨) · **g548**(힌트)을 **ko/en/ja 3개 언어 전부** 추가 —
  기존 g542/g543(라벨) · g541/g546(힌트) 형식을 그대로 따랐다.
  ko: 「셀 표면 v1r2 (Y1)」 / en: "Cell surface v1r2 (Y1)" / ja: 「セル表面 v1r2 (Y1)」.
- 배선: `generator-state.js` 허용값에 `cell-surface-v1r2` 추가 ·
  `generator-render-config.js` 가 `cellSurfaceLayout: 'v1r2'` + `version: 1` 을 만든다 ·
  해상도 티어는 **중(中) 한 단만** 열린다(n=21 뿐) · `versionY` 유효값 1 고정 ·
  `syncYLocatorUi()` 힌트 분기 추가. **2톤·3톤 모두 지원**(tone 3 → tones 3).
- 스캐너 기대 패널: `sites/tlscan/index.html` 에 `data-expected-layout="v1r2"` 버튼 +
  `strings.js` 3언어 · `scanner.js` 화이트리스트에 `v1r2` 추가.
- 텔레메트리: `cs_layout` 은 관측 `layoutId` 를, `expected_layout` 은 기대 패널 값을
  그대로 싣는다 — 둘 다 자유 문자열 통과 경로라 코드 변경 없이 `v1r2` 가 실린다.
  ClickHouse 컬럼은 `LowCardinality(String)` 이라 **ALTER 불필요** (주석만 갱신).
- 테스트 갱신(`test/locatorY-lab.test.js`): 카드 존재/부재 단언을 운영자 지시대로 뒤집고
  (`cell-surface-v1r2` 존재 · `hex-frame-v1` 부재), 「차단이지 삭제가 아니다」를
  `LOCATOR_PROFILE_HEX_FRAME_V1` 소스 잔존 단언으로 새로 고정. i18n 키 목록에 g547/g548 추가.

## 4. 블록 로케이터 v1r2 패밀리 (완료)

### 검출 서명 — 정본에서 실측으로 유도

`src/decoder/cellsurface-block-detect.js` 는 실루엣·마스크를 안 쓰고 «면별 톤이 알려진
블록» 의 **동심 코어**를 직접 찾는다. v1r2 정본에서 실제로 닫힌 코어를 내는 자리는 둘이다:

| 자리 | 3면 합집합 구조 | 중심 통과 런렝스 | 기존 검증기 |
|---|---|---|---|
| 중앙 (세 면 NW 5×5) | 어두운 육각 r<2 + 밝은 링 2 + 어두운 링 3 + 밝은 링 4 | `[B1 D4 B1]` = **K3** | `verifyV0Cluster` → `v0-center` |
| 먼 꼭짓점 (**면 T** SE 5×5) | 어두운 2×2 (17..18)² 를 밝은 테두리가 감쌈 | `[B1 D2 B1]` = **K5** (행·열·대각·반대각 4방향 전부) | `verifyV2r2Cluster` → `v2r2-corner` |

- 중앙 서명은 **v0 중앙과 같다** (교차거리 비 t2/t1 = 1.5). v1r2 는 그 바깥에 링이 더
  있어 t3/t1 = 2.0 · t4/t1 = 2.5 지만, 이를 판별에 쓰지 않고 **기존 프리미티브를 그대로
  재사용**했다 — 새 코어 종류를 추가하지 않았다.
- **면 L·R 의 SE 블록은 코어가 1셀(D1)** 이라 K5 문턱(d ≥ 1.35·unit)을 넘지 못한다.
  그래서 세 먼 꼭짓점 중 **면 T 하나만** 코어를 내고, 그 사실이 곧 120° 회전 위상을
  확정한다 — **v0 의 360° 회전 스윕이 필요 없다**(브리프의 요구).

### 조립

```
시드   : 중앙(v0-center) × 먼코너(v2r2-corner) 쌍 → similarity
         canonical 거리 = 18.0·u  (면 T SE 코어 중심 = 셀 (17.5,17.5),
         셀 (c,c) 중심의 원점 거리 = (c+0.5)·u — v2r2 의 (n−3.5) 와 같은 규칙)
         스냅 허용폭 ±3.2셀 (v2r2 와 동일 근거: 마스크 침식이 u 를 부풀린다)
라운드1·2: **4앵커 직접 DLT** — [중앙(3면 합집합), 먼코너 T, L, R] 4점을
         estimateHomography4 로 (기존 refineHomographyWithPatches 그대로)
라운드3 : **12 서브앵커** 최소제곱 DLT — 네 코너 블록 × 3면
         (중앙 3 + 먼코너 3 + NE 팔 3 + SW 팔 3). v2r2 는 6, v0 는 12.
```

- 정직한 정정 한 가지: 브리프는 «4코너 블록 **검출** → 4앵커 직접 DLT» 를 그렸지만,
  정본 톤에서 닫힌 코어를 내는 코너는 **둘뿐**이다(중앙·면T 먼꼭짓점). NE/SW 팔은
  동심 구조가 아니라 계단이라 코어 스캔으로 잡히지 않는다. 그래서 **시드는 2앵커
  similarity** 이고, **4앵커 직접 DLT 는 패치 정합 라운드에서** 돈다(네 코너 블록 전부가
  라운드3의 12 서브앵커로 들어간다). 회전 스윕이 없다는 요구는 그대로 충족된다.
- 재사용한 프리미티브: 회문 코어 라인 스캔(K3/K5) · 레이 비율 검증 · Pearson 패치 정합 ·
  서브앵커 재적합 — **새로 만든 것은 조립 함수 하나**(`assembleV1r2Poses`)와
  레이아웃별 블록 경계표(`blockLimitsFor`)뿐이다.
- 패치 캐시 키를 `n` → `layoutId@n` 으로 바꿨다 (`patchesFor(n, layoutId)`;
  기존 `patchesForN(n)` 은 기본 레이아웃용 래퍼로 유지).
- 진단: `poseCount` 에 `v1r2` 추가 · shape 의 `blockLocator.layoutId` 에 패밀리 id.
  **레이아웃을 여기서 못박지 않는다** — shape 는 `cellSurfaceOnly` 라 수용은 CS 평가
  게이트가 판정한다(§2).
- 끄는 스위치: `calibration.csBlockLocator.v1r2Family = false` (기본 true).
- **결정성**: RNG 없음 · 전 순회 고정 순서 · 같은 프레임 2회 deepEqual 회귀로 고정.

### 로케이터 회귀 (`test/cellSurface-block-locator.test.js`, 12/12 통과)

- v1r2 S-커브 0.6 → **body RS 복호**까지 ✔ · 감마 0.7/0.6 ✔
- 회전 슬롯 0/120/240 전수 ✔ (셋 다 가설 슬롯 0 — 회전을 H 가 흡수)
- 결정성 2회 deepEqual ✔ · shape 의 family 에 `v1r2` 존재 ✔
- 패밀리 격리: `v1r2Family:false` 면 v1r2 포즈 0 ✔
- **교차 회귀: v0·v2r2 프레임에서 v1r2 포즈 0** ✔ (기존 6개 v0/v2r2 테스트 전부 불변)

## 5. 벤치 (자 검증 → v1r2)

하네스: 960² 합성 · ppu 15(n=21) · margin 4 · 배경 채움 불투명 · `test/harness/distort.mjs` ·
`decodeFrontend` lab 옵션(`enableLocatorY`·`enableCellSurfaceY`). 스크립트는
`test/output/_bench-v1r2.mjs` (임시 하네스 — 커밋 대상 아님).
매트릭스 = 톤 7종 × 물리 회전 7종 = 49.
톤: 무왜곡 · S-커브 0.6/0.75/0.9 · 감마 0.7/0.6 · 감마0.7+S0.6.
회전: 0 / 90 / 105 / 120 / 135 / 150 / 240°.

### ① 자 검증 — v2r2@21 재현 (하네스가 자로 쓸 수 있는가)

| | 결과 |
|---|---|
| v2r2@21 톤 7 × 회전 7 | **49/49 복호** |
| 정본(`claude-cs-locator.md`) 의 v2r2@21 해당 분 | 49/49 |

→ 일치. 하네스가 정본 수치를 재현한다. (98/98 = v0@13 49 + v2r2@21 49.)
톤별 전부 7/7, 뽑힌 레이아웃 전부 `v2r2`, 가설 슬롯 전부 0.

### ② v1r2@21 본 측정

| 톤 | 회전 7종 |
|---|---|
| 무왜곡 | 7/7 |
| S-커브 0.6 | 7/7 |
| S-커브 0.75 | 7/7 |
| S-커브 0.9 | 7/7 |
| 감마 0.7 | 7/7 |
| 감마 0.6 | 7/7 |
| 감마 0.7 + S-커브 0.6 | 7/7 |
| **합계** | **49/49** |

- **S-커브에서 body RS 복호까지** 도달 — 합격선 충족 (`result.text` 가 페이로드와 일치).
  단순 CS 수용이 아니라 전체 복호다.
- **회전 슬롯 0/120/240 전수 21/21** (전체 49 의 부분집합). 뽑힌 레이아웃 전부 `v1r2`,
  **가설 슬롯 전부 0** — 물리 회전을 H 가 흡수한다(회전 스윕 없이).
- 교차 오식별 0: v1r2 프레임이 v2r2 로 복호된 경우 없음, v2r2 프레임이 v1r2 로 복호된
  경우 없음 (49+49 전부 자기 레이아웃).

### ③ 시간

| | 프레임 전체 복호 (ms) | 로케이터 단독 (ms) |
|---|---|---|
| v2r2@21 (49프레임) | 중앙값 674 · 최소 400 · **최대 3055** | 중앙값 92 · 69\~129 |
| v1r2@21 (49프레임) | 중앙값 522 · 최소 394 · **최대 810** | 중앙값 81 · 69\~114 |

- v2r2 의 최대 3055 ms 는 알려진 flat-block recovery 부채(감마0.6 rot105) — **범위 밖**.
  v1r2 매트릭스에는 1.6\~3.0 s 구간이 나타나지 않았다(최대 810 ms). 다만 v2r2 를 먼저
  돌렸으므로 첫 프레임(1672 ms)에는 JIT 워밍업이 섞여 있다 — **중앙값 비교는 참고치로만
  읽어야 한다.** 「v1r2 가 더 빠르다」는 이 측정만으로 결론 내리지 않는다.
- v1r2 패밀리 추가 비용 (같은 프레임 7회 반복 중앙값, `v1r2Family` on/off 대조):

| 프레임 | 패밀리 ON | 패밀리 OFF | 차이 |
|---|---|---|---|
| v0@13 (감마0.7) | 107.2 ms | 94.7 ms | +12.5 (반복 편차 범위) |
| v2r2@21 (감마0.7) | 123.2 ms | 130.0 ms | −6.8 (편차 — 유의미하지 않음) |
| v1r2@21 (감마0.7) | 138.1 ms | 115.6 ms | +22.5 (포즈를 실제로 만드는 프레임) |

  → v0·v2r2 프레임에서는 **추가 비용이 반복 편차 안**이다. 포즈를 만들지 않는 프레임에서
  v1r2 조립은 거리 스냅(±3.2셀)에서 즉시 탈락하기 때문.
- 관측된 부작용 하나: v1r2 중앙은 v0 중앙과 **같은 K3 서명**이라 v1r2 프레임에서
  `assembleV0Poses` 의 360° 회전 스윕이 헛돈다(v0 포즈 4\~6개 생성 → CS 게이트가 기각).
  이것이 v1r2 로케이터 시간의 상당분이다. 판별자를 넣어 걷어낼 수 있으나
  (v1r2 중앙만 t3/t1≈2.0 · t4/t1≈2.5 의 바깥 링 쌍을 갖는다) **v0 조립 개선 금지**
  범위와 맞닿아 이번엔 손대지 않았다 — 「다음 레인 제안」에 적는다.

## 다음 레인 제안 (이번 범위 밖 — 보고서에만)

1. **v1r2 중앙 판별자로 v0 헛스윕 제거.** v1r2 중앙은 v0 중앙과 K3 서명이 같아,
   v1r2 프레임에서 `assembleV0Poses` 의 360° × 4스케일 스윕이 항상 헛돈다.
   v1r2 중앙만 갖는 바깥 링 쌍(레이 교차거리 t3/t1 ≈ 2.0 · t4/t1 ≈ 2.5)을 세어
   `v0-center` 힛에 플래그를 달면, v0 조립은 그대로 두고 **스윕 진입만 건너뛸 수** 있다
   (v0 조립 개선 금지에 저촉되지 않는 형태). 기대 절감 = v1r2 프레임 로케이터 시간의 상당분.
2. **4앵커 DLT 가 v0 회전 스윕보다 나은가 — 아직 증거 없음.** 이번 매트릭스에서 v1r2 는
   49/49 이지만 v0 도 정본 벤치에서 49/49 였다. 합성 범위 안에서는 두 방식의 우열을
   가를 실패 지점이 없다 — 판정은 **실사 A/B** 로만 가능하다. (그래서 이 레인의 산출물은
   «공정한 A/B 조건» 이지 «우열 결론» 이 아니다.)
3. **면 L·R 먼꼭짓점의 D1 코어**를 잡을 수 있으면 시드 단계에서 진짜 3앵커 이상이 되어
   원근이 큰 실사에서 초기 H 가 좋아진다. 다만 «밝은 이웃 속 어두운 1셀» 은 데이터 영역에
   흔해 후보 폭증 위험이 크다 — 도입한다면 «먼꼭짓점 반경대» 로 탐색을 제한해야 한다.
4. **v1r2 용량 손실 정량화**: v2r2@21 349 셀 → v1r2@21 334 셀 (−15 셀 = −5 심볼,
   ECC-M 기준 maxPayload 82 B → 78 B). 실사 인식률 이득이 이 4 B 를 정당화하는지는
   A/B 결과와 함께 판단해야 한다.
### 텔레메트리 실측 (추정 아님)

감마 0.7 v1r2@21 프레임을 lab 옵션으로 실제 복호한 뒤 `extractCellSurfaceProbe` →
`normalizeFrameBody` 를 통과시킨 결과:

```
decode ok true  layout v1r2
probe  {"attempted":true,"accepted":true,"score":1,"profile":"cell-surface-v1r2",
        "layoutId":"v1r2","orientationGate":"applied","ambiguous":false}
frame  cellSurface.layoutId = "v1r2"   → relay/protocol.mjs  cs_layout
       cellSurface.expectedLayout = "v1r2" → relay/protocol.mjs  cs_expected_layout
```

두 컬럼 다 `LowCardinality(String)` — **ALTER 없이** 새 값이 실린다.

## 6. 번들 재빌드 · 스위트

재빌드 (이 순서로 실행):

```
node tools/build-scan-variants.mjs   → sites/_shared/scan-new.html · lab-scan.html
node tools/build-gen-variants.mjs    → dist/trilume.html · sites/_shared/gen-finder.html
                                       · gen-finder-editor.html · lab-gen.html
node tools/build-scanner.mjs         → dist/tlscan.html (1,270,564 B)
```

스캐너 빌드 스탬프 `2026-08-15.03` (변동 없음) · `dist/trilume.html` 940,315 B.

### 스위트 (숫자 그대로) — `node --test test/*.test.js`

```
ℹ tests 1431
ℹ pass  1430
ℹ fail  1
ℹ skipped 0 · todo 0 · cancelled 0
```

산출 파일: `test/output/claude-v1r2-suite.txt`.

유일한 실패는 **기존 그대로**:
`test/decoder-cube.test.js:453 — Type Y 3톤 실사진 성공분은 960/1440 모두 Y1T로 복호`
(브리프가 «건드리지 마라» 로 지정한 기존 실패, 원인 `frontend:symbol-clipped`).
번들 동기화 3종은 재빌드 후 전부 통과한다.

### 기준선 대조 (브리프 수치와의 차이 — 정정)

브리프는 f2dbb2b 정본 스위트를 «1416 중 1415» 로 적었으나, **실측은 1419** 다.

| 측정 | tests | pass | fail | 비고 |
|---|---|---|---|---|
| f2dbb2b pristine 워크트리 | 1419 | 1409 | 4 | skipped 6 (실사진 fixture 부재) · 실패 4 = 번들 동기화 3(CRLF, `claude-bundle-repro-f2dbb2b.md` 기록) + 편집기 우클릭 1 |
| 메인 트리 작업 전 (역산) | 1419 | 1418 | 1 | 1431 − 신규 12 |
| 메인 트리 작업 후 | **1431** | **1430** | **1** | 신규 테스트 12개, 실패는 기존 실사진 1건 |

→ 브리프의 «1416» 은 stale 수치로 보인다 (pristine f2dbb2b 도 1419 를 낸다).
**회귀는 0** — 실패 집합이 「기존 실사진 1건」으로 동일하다.

### 신규 테스트 12개

`test/cellSurfaceFinal.test.js` (5): v1r2 회계 · v1r2 인코더 왕복 · v1r2 렌더 자체 검증 ·
encodeY 버전 가드 · **n=21 병행 평가 + 교차 오수용**.
`test/cellSurface-block-locator.test.js` (6): v1r2 S-커브 · 감마 0.7/0.6 · 회전 슬롯 전수 ·
결정성 · 패밀리 격리 대조군 · **v0·v2r2 프레임에서 v1r2 포즈 0 회귀**.
`test/generator-render-config-y.test.js` (1): v1r2 는 버전 선택과 무관하게 Y1(n=21) 고정 ·
2톤·3톤 보존 · 윈도보다 앞선다 · data 334.

갱신한 기존 테스트 4개 (전부 운영자 지시로 기대값이 뒤집힌 것 — 게이트 완화 아님):
`cellSurfaceFinal.test.js` 라인업 id 목록 · `locatorY-lab.test.js` 카드 존재/부재 + i18n 키 ·
`cellSurfaceLayouts.test.js` 리터럴 2줄 → 상수 참조(단언 내용 불변).

### hex-frame-v1 차단 확인 (삭제 아님)

`locatorShapesY(13, …, 'hex-frame-v1')` 이 여전히 **65 shape** 을 만들고
`locatorMarginCells('hex-frame-v1') = 2.12` 셀. 검출기(`src/decoder/locatorY-detect.js`)도
그대로다. 없앤 것은 **생성기 카드 한 장**뿐이다.

### 회귀 불변 확인 (브리프 §5 요구)

- v0 · v2r2 로케이터 테스트 6종 전부 불변 통과 (`cellSurface-block-locator.test.js`).
- 무검출기 Y0 · 일반 Y · Type O · A · K(파인더) 회귀는 전체 스위트가 덮으며 실패 0.
- 기존 게이트 수치(agreement 0.78 · margin 0.035 · tone span 0.012) 불변, 완화 없음.
- 안정판 불변식: `enableCellSurfaceY` 미설정 경로 테스트 통과(로케이터 미가동),
  텔레메트리는 `isLabPath()` 게이트 그대로.

## 못 한 것 · 남긴 것

1. **실사 A/B 미실시** — 이 레인은 «공정한 A/B 조건» 을 만든 것이지 우열을 판정한 것이
   아니다. 합성 매트릭스에서는 v2r2 49/49 · v1r2 49/49 로 **차이가 나타나지 않는다**.
   판정은 실기기 스캔으로만 가능하다.
2. **브리프의 «4코너 블록 검출» 은 정본상 성립하지 않는다** — 닫힌 동심 코어는 중앙과
   면 T 먼꼭짓점 둘뿐이다(§4). 시드는 2앵커 similarity, 4앵커 직접 DLT 는 패치 정합
   라운드에서 돈다. 회전 스윕 제거 요구는 충족.
3. **v1r2 프레임에서 v0 회전 스윕이 헛돈다** — 중앙 서명이 같아서다. 판별자 도입은
   v0 조립 개선 금지 범위와 맞닿아 보류(«다음 레인 제안» 1번).
4. **커밋·push·배포 없음** — 워킹 트리 변경만 남겼다. `git status` 변경 파일 26개 +
   미추적 `.claude/`(내가 만든 것 아님).
5. 임시 하네스 `test/output/_bench-v1r2.mjs` · `_bench-locator-cost.mjs` ·
   `_probe-telemetry.mjs` 는 재현용으로 남겼다 — **커밋 대상 아님**.
6. n=25 는 손대지 않았다 (v2r2 유지). ClickHouse ALTER 없음 (주석만 갱신).
