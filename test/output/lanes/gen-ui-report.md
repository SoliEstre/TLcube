# 생성기 UI 구멍 메우기 — 실행 보고 (turnA · daehan · A-CM/O-CM · §6 두 건)

작성 2026-08-19 · 대상 `E:/WorkBase/TrilLuminanceCube/TLcube` (HEAD `63539fa`, `git pull` 시점 up to date)
산출물 `test/output/lanes/gen-ui.patch` (1163줄 · `git apply --check` **PASS**)

---

## 0. blocker — 먼저 읽을 것

**세 기능 중 둘은 「만들 수는 있는데 라이브 스캐너가 못 읽는」 상태다.** 브리프는 이 판정
기준을 §3.3(코너 마커)에만 걸어 뒀는데, **같은 자로 재 보니 turnA 도 같은 처지였다.**
브리프 §2 의 표가 `turnA: 인코더 ✅ 디코더 ✅ 테스트 ✅` 라고 적은 것은 **단위 층위**의
사실이고, 라이브 경로(`decodeFrontend`)에서는 성립하지 않는다.

같은 하네스(`test/decoder-frontend.test.js` 의 `render()` 규약 · pixelsPerUnit 12 ·
supersample 1)로 **대조군과 함께** 잰 결과:

| 축 | 대조군 | 실험군 | 실패 코드 |
|---|---|---|---|
| **turnA** (A V0/V1/V2, ECC M) | **3/3 복원** | **0/3** | `NO_FORMAT_CANDIDATE` |
| **daehan** 옵트인 **꺼짐** (O V1/V2/V3, ECC M) | 3/3 복원 | **0/3** | `NO_FORMAT_CANDIDATE` |
| **daehan** 옵트인 **켬** (`bootstrap.cellFinderDaehan`) | — | **3/3 복원** | — |
| **O-CM / A-CM** (O V1\~V3 · A V0\~V2, ECC M) | 6/6 복원 | **0/6** | `BODY_RS_FAILED` |

재현: `node test/output/lanes/scratch/turnA-daehan-roundtrip.mjs`
      `node test/output/lanes/scratch/cm-roundtrip.mjs`

**게이트는 한 개도 안 내렸다.** `minCorrelation 0.56` · `minContrastRatio 0.24` ·
`minOrientationMargin 0.035` · agreement 0.78 · CRC · RS 전부 기본값 그대로다.
통과시키려고 문턱을 만진 자리는 없다.

그래서 붙인 방식이 셋 다 다르다 — **읽히는 만큼만 노출한다**:

| | 붙였나 | 어디에 | 근거 |
|---|---|---|---|
| §6.1 편집기 동기화 | ✅ | 항상 | 왕복과 무관 (표시 문제) |
| §6.2 OAK 서랍 노출 | ✅ | **일반 모드** | 운영자 지시 · 라운드트립 회귀가 이미 증명 |
| §3.2 daehan | ✅ | **고급 모드** 전용 서랍 | 시험판 스캐너 옵트인 켜면 3/3 |
| §3.1 turnA | ⚠ | **`/lab/`** 전용 | 라이브 0/3 — 정식 화면에 못 내보낸다 |
| §3.3 A-CM / O-CM | ❌ **보류** | 없음 | 라이브 0/6 · 검출기가 파이프라인에 미배선 |

---

## 1. 세 건 각각 — 붙였나 / 못 붙였나 / 왜

### 3.1 turnA — 붙였다, 단 `isLabPath()` 게이트 뒤에

**실측으로 드러난 사실 (브리프가 몰랐던 것):**

- 🔴 **인코더가 역삼각 «기하» 를 안 낸다.** `turnA:true/false` 의 `cellDigits` **좌표 집합이
  완전히 동일**하고(A0 171셀 · A1 306셀 · A2 477셀, 좌표범위도 같다), 다른 것은
  `role='format'` 15셀 중 12\~15개의 digit 뿐이다. `dataDigits` 는 바이트 동일.
  `encodeA` 가 쓰는 `provider.scan/filler` 는 `layoutA.js → placementA.regionCellsA`(정삼각)
  만 탄다 (`src/encodeA.js:41-60` · `src/layoutA.js:30`).
- 역삼각 영역 함수 `regionCellsTurnA(k)` 는 존재하지만(`src/placementA.js:134`)
  **디코더 검출기에서만** 쓰인다 (`src/decoder/family.js:349`). 인코더·레이아웃·렌더에
  소비자가 0건.
- 🔴 **turn 신호가 디코더로 배선돼 있지 않다.** `family.js:629` 가 `turn` 을 결과에 싣지만
  `format.turn` 을 세우는 호출자가 `src/` 안에 하나도 없다. 읽는 곳은 `decode.js:366` 뿐.
- 귀결: turnA 코드는 정삼각으로 그려지고 검출기는 `turn=false` 로 판정 →
  기본 A 표로 읽는다. 대부분은 매칭 실패로 죽고, **A2TQ(formatIndex 3)는 A0(k=6)으로
  오판된다** (`decode.js:245` 의 `formatIndex + 2 === index` 가 A0 1+2=3 에 걸린다).
  즉 조용한 오독이 한 조합 있다. `test/turnA-wire-regression.test.js:168-180` 이 이
  A2TQ↔A0Q 공유를 이미 「미완」으로 못 박아 뒀다.

**그래서 어떻게 붙였나.** 정식 화면에 내보내면 「만들 수는 있는데 안 읽히는 코드」를 파는
일이 된다. 그러나 UI 경로가 아예 없으면 운영자가 실기기에서 켜 볼 방법도 없다 — 이건
하루 전 daehan 스캐너 토글(커밋 `9ae0fed`)이 겪은 것과 **같은 상황**이고, 그때 정한
관례가 `/lab/` 게이트다. 같은 관례를 따랐다:

- `#turnASection` — `hidden` + `syncTurnAUi()` 가 `isLabPath() && type === 'A'` 로만 연다.
- 힌트 문구(g575)가 **실측 사실을 그대로** 말한다: 「지금은 포맷 정보만 바뀌고 그림의
  실루엣은 그대로예요 — 이 상태로 만든 코드는 스캐너가 못 읽어요.」
- `generatorState.turnA` 는 `INTERNAL` 노출 (locatorProfileY 전례) — 정식 화면의
  `data-state-keys` 대조 대상 밖이라 마크업 속성을 안 건드린다.
- `cornerMarker` 와의 상호배제(`encodeA.js:113` throw)는 **실질 충돌이 없다** —
  `encodeOptsFor` 의 A 분기가 `cornerMarker` 를 아예 안 준다 (§3.3 이 보류이므로 앞으로도).
- **용량·버전은 안 건드렸다** — `capacityForA` 가 `turnA` 인자를 안 받고 결과 capacity
  전 필드가 동일함을 실측했다 (A0 31 · A1 62 · A2 101 B, turn 무관). 그래서
  `index.html` 의 버전 라벨(31/62/101 B)을 손댈 이유가 없었다.

**운영자 판단이 필요한 지점:** 안정판 노출은 (a) 인코더 기하 전환 + (b) `family.turn →
decode.format.turn` 배선이 끝나 왕복이 서는 날이다. 그날 `test/generator-ui-wiring.test.js`
의 §5 turnA 테스트가 **빨개져서** 알려 준다 (실패 메시지에 다음 할 일을 적어 뒀다).

### 3.2 daehan — 붙였다 (고급 모드 전용 서랍)

- **카드는 한 장**이다 (`oak-daehan-k10`). k 는 버전이 정한다 — V1↔k6 · V2↔k8 · V3↔k10 이
  `capacity.js VERSIONS` 와 `DAEHAN_RADII` 양쪽에서 같음을 실측했고, 회귀로 잠갔다.
  카드를 셋으로 쪼개면 사용자가 버전과 모순되는 k 를 고를 수 있게 된다.
- 그리는 템플릿은 `renderTypeO` 가 `daehanPatternId(encoded.k)` 로 재사상한다.
  **픽셀은 재사상 없이도 맞다** — `scene.js` 의 반경 가드가 k10 패턴을 k=6/8 로 자르면
  좌표·톤이 잘림본과 동일하다(레인 실측). 재사상하는 이유는 그 id 가 스캔·텔레메트리
  라벨로 기록되기 때문이다 — k=6 프레임을 「k10 템플릿」이라 적으면 나중 대조가 끊긴다.
- **서랍을 왜 OAK 와 분리했나** (브리프가 「이유를 적어라」 한 항목):
  1. **회계가 갈린다.** OAK 3장은 용량 불변인데 daehan 만 불스아이 밖으로 60셀을 더 먹어
     용량을 깎는다 (V3 65 → 46 B). 같은 줄에 두면 「같은 종류의 선택」이라는 거짓 함의가
     생긴다. OAK 표(`finder-oak-patterns.js`)가 daehan 을 일부러 뺀 것도 같은 이유다 —
     「19셀 안에 산다」는 불변식이 깨진다.
  2. **기계적 결정타**: daehan 은 Type O 전용(`encodeA` 에 `daehanFinder` 가 0건)이라 A 에서
     서랍째 숨겨야 하는데, `applyFinderExperimentVisibility` 는 컨테이너 id 단위로 동작해
     OAK 와 공유하면 **OAK 3장까지 같이 사라진다**.
- **고급 전용으로 둔 이유**: §0 표의 실측 — 안정판 스캐너 경로는 못 읽는다. 서랍 summary 와
  힌트가 그 사실을 말한다(「시험판 스캐너 전용」·「/lab/ 에서 'daehan 파인더'를 켰을 때만
  읽혀요」). 라벨이 사실이 아니면 회귀보다 먼저 사람을 속인다.
- **Type A 누출 가드**: O·A 가 파인더 프로필을 공유하므로(`finder-selection.js` `profileFamily`)
  O 에서 고른 daehan 이 A 로 넘어온다. 서랍을 숨기는 것으로는 「이미 고른 상태」를 못 막는다
  (모드·타입은 «노출만» 바꾼다는 이 파일의 규약). `renderTypeA` 가 기본 파인더로 대체한다.

### 3.3 A-CM / O-CM — **안 붙였다** (브리프 지시대로 보류)

왕복 실측이 먼저다(§0 표): 대조군 6/6, 실험군 **0/6** 전부 `BODY_RS_FAILED`.

**실패한 것은 기하가 아니라 본문이다.** 포즈도 서고 포맷 CRC 도 통과하는데 본문 RS 만
터진다 (`gridHypothesisCount=1 · formatCandidateCount=1 · bodyValidCount=0`,
`reason: "rs: 오류 개수가 정정 한계를 넘었다 (deg Λ = 4, t = 3)"`, `versionIndex 0` = 레거시 O V1).
스캔 순서가 레거시라서다.

부품은 살아 있다 — `node --test test/decoder-corner-marker.test.js` pass 9/0,
`test/markerO.test.js` pass 11/0. 라이브 규격 래스터에서 `findOCornerMarkerHypotheses` 는
정확히 1개 가설·정답 k(6/8/10)를 낸다. **문제는 알고리즘이 아니라 배선이다.**

- `src/decoder/` 전체에 `cornerMarker` 문자열 **0건**. `decode.js:298/341` 의 O-CM/A-CM
  프로파일 분기는 라이브에서 **원리적으로 도달 불가** — `format.cornerMarker` 를 true 로
  세우는 코드가 디코더 안에 없다.
- `layoutForFamily`(`bootstrap.js:1642`)의 hex 분기에는 `daehanFinder` 분기만 있고 tri 분기엔
  변형이 없다 — CM 프레임도 항상 레거시 scan order 로 읽힌다.
- 번들 실측: `dist/tlscan.html` · `dist/trilume.html` 어디에도 `corner-marker-detect` ·
  `findOCornerMarkerHypotheses` · `verifyCornerMarkers` 바이트가 **0건**.
- O-CM 은 레거시 O 와 formatIndex 가 같고 A-CM 도 레거시 A 를 승계한다
  (`markerO.js:356` · `markerA.js:346-350`). **포맷 비트만으로는 CM 여부를 구별할 수 없다.**
- 실사진 휘도 덤프 76개 항목에 코너마커 프레임이 **없다** (`ocm|acm|marker|corner` 매칭 0건).
  실기기 검증은 이 라운드에서 불가능했다.

**GO 가 되려면 무엇이 배선돼야 하나** (전부 위 실측이 지목한 자리):
① `bootstrap.js` 가 `corner-marker-detect` 를 불러 (k, orientation) 가설을 만들거나, 최소한
레거시 본문 RS 실패 뒤 CM scan order 로 재시도하는 경로를 연다.
② `layoutForFamily` 의 hex/tri 분기에 CM scan order + layoutMap 을 추가한다.
③ 후보 객체가 `cornerMarker` 를 실어 `decode.js:298/341` 프로파일이 선택되게 한다
(formatIndex 는 못 쓴다 — 레거시와 같다).
④ **스캐너 번들 등재는 불필요** — `tools/build-scanner.mjs` 는 수동 `MODULE_ORDER` 가 아니라
정적 import 폐포를 Kahn 위상 정렬로 자동 수집한다. ①을 하면 자동으로 들어간다.

비용 제약: 검출기를 무조건 선행 실행하면 프레임당 181\~308 ms 가 추가된다(합성 래스터·Node
기준이라 절대치가 아니라 상대 규모). 「레거시 본문 실패 뒤 폴백」 배치가 유력하다.

---

## 2. §6 두 건 (우선 처리)

### 6.1 셀 표면 파인더를 골라도 아래 편집기에 반영되지 않는다 — 고쳤다

**증상은 두 겹이었다.**

**겹 ①: 편집기 상태가 생성기 선택을 아예 안 받는다.**
`cellEditorHexState`(index.html)가 `createUniversalEditorState({ type, size })` 를 **파인더 인자
없이** 부른다. 그래서 편집기의 `finderStarter` 는 언제나 기본값 `'bullseye'` 였다.
`generatorState.finderPatternId` 는 index.html 안에 17곳 참조가 있는데 **cellEditor\* 블록
(6493\~7288) 안에는 0곳**이다 — 둘을 잇는 경로가 애초에 없었다.

**겹 ②: 코어가 OAK 를 못 찾고, 찾아도 3레벨을 못 든다.**
`resolveFinderStarter`(`cell-editor-core.js:207`)가 `getFinderPattern(id)` 만 본다. OAK 는
별도 모듈이라 거기서 `RangeError` 로 죽고 **try/catch 가 그것을 삼켜 조용히 불스아이로
되돌린다.** 실측: OAK 3개 · daehan 3개 전부 `finderStarter=bullseye`.
그리고 3레벨 문제는 브리프 추측보다 나빴다 — `cloneCellEditorFinderPattern` 은 `cellMasks`
를 요구해 **RangeError 로 던지고**, `getCellTone` 의 cell-mask 분기는 `cellMasks[i]` 를 읽어
**TypeError 로 죽는다**. 톤 0 으로 조용히 틀리는 게 아니라 **페인트가 통째로 죽는다.**

**고친 방식** — `scene.js:73-84` `resolveFinderRenderPattern` 이 이미 푼 문제라 그 해법을
그대로 옮겼다 (「OAK 후보는 별도 표라 PATTERN_BY_ID 에 없다. 여기서 먼저 풀고, 아니면 기존
조회가 «알 수 없는 id» 로 정확히 죽는다」):

- `src/cell-editor-core.js` — ① `finder-oak-patterns` import ② 조회 폴백
  `getOakFinderPattern(id) || getFinderPattern(id)` ③ clone 의 `cellLevels` 갈래(19 길이 단언 +
  삼중 깊은 복사 — 정본 표가 frozen 이다) ④ `getCellTone` 의 레벨 우선 갈래
  (`scene.js:512` «둘 다 있으면 레벨이 이긴다» 와 같은 우선순위) ⑤ `setCellToneDirect` ·
  `rotateFinderPattern120` 의 짝 갈래 (독립 편집기 `/celleditor/` 경로용).
- `index.html` — `syncCellEditorFinderFromGenerator(state, ctx)` 를 `syncTypeYCellEditorUi` 안에서
  부른다. **단방향**(생성기 → 편집기)이고, 중앙 QR 은 셀 표현이 없어 건너뛴다.
  삼켜지면 `console.warn` 을 남긴다 — 그 침묵이 이번 증상의 절반이었다.

**호출 자리를 왜 거기로 잡았나**: 파인더 카드 클릭이 `commitFinderQrUi → syncTypeUi →
syncTypeYCellEditorUi → paintCellEditor` 로 이미 이어진다 (repaint 훅이 **이미 있다**).
새 배선이 필요 없었고, 드래그 중 도는 `queueCellEditorRepaint` 경로에서는 안 돈다
(`state.finderStarter === wanted` 가드가 매 프레임 재적용을 막는다).

**덮어쓰기가 사용자 편집을 지우지 않는 이유**: 이 편집기는 중앙 19셀을 role `'finder'` 로
잠근다 (`editHexCell` 의 `if (role !== 'finder')` 가드). 그래서 히스토리 작업도 불필요했다.

**실측 결과** — `node test/output/lanes/scratch/editor-sync-verify.mjs` → ALL PASS:
OAK 3종 모두 `finderStarter` 가 그대로 실리고, **19셀 × 3면 = 57 슬롯 톤 불일치 0/57**,
정본 표 오염 없음, 360° 회전 항등, 직렬화 무크래시, 기존 4종 무회귀, 기본값은 여전히 bullseye.

**daehan 은 아직 편집기에 못 태운다** — 발자국이 39/59/79 셀인데 편집기의 파인더 영역 판정은
`isCenterCell`(중앙 19)뿐이라 나머지 20/40/60 셀이 role `'data'` 로 떨어진다. 게다가
`tools/build-cell-editor.mjs` 의 `CELL_EDITOR_MODULE_ORDER` 에 `finder-daehan` 이 없어서
코어가 그것을 import 하면 **독립 번들 빌드가 죽는다**(그 빌드를 회귀가 단언한다).
그래서 코어에는 OAK 만 들였고, daehan 은 회귀가 **알려진 예외로 명시**한다 — 조용한 폴백이
아니라 목록에 이름이 적힌 예외다.

### 6.2 새 셀 표면 파인더를 고급 모드 없이도 — 고쳤다

`applyFinderExperimentVisibility` 의 대상 목록에서 `finderOak` 만 뺐다. 나머지 두 서랍
(`finderBelowBar` · `finderUnscannable`)은 고급 전용 그대로다. 서랍 자체는 접힘 유지
(`details` 기본 닫힘)라 일반 모드 카드 수는 여전히 4개로 보인다.

`finderDaehan` 은 **목록에 넣었다**(= 고급 전용). 지시가 「새로 추가된 셀 표면 파인더」
한정이고 daehan 은 그 지시가 쓰인 시점에 UI 에 없었으며, 무엇보다 §0 실측이 「안정판
스캐너가 못 읽는다」를 말한다. **이건 운영자 확인이 필요한 판단이다** — daehan 도 같은
「새 셀 표면 파인더」로 보아 일반 모드로 올릴지, 스캐너 옵트인이 기본 켜질 때까지 고급에
둘지. 올리려면 `test/generator-ui-wiring.test.js` 의 §6.2 daehan 테스트 기대값 한 줄만 뒤집으면 된다.

### 6.3 용어 정정 — 반영했다

이 보고서는 OAK 를 「셀 표면(full-surface) 파인더 후보」로 쓴다. 중앙 19셀은 그 설계 중
**검출기가 쓰는 발자국**이지 파인더의 정의가 아니다. 다만 정확히 하자면 — 편집기가 오늘
표현할 수 있는 것은 **그 19셀 발자국뿐**이다(`isCenterCell` 판정). §6.1 이 고친 것은
「편집기가 OAK 의 19셀 발자국을 그 후보의 3레벨 톤으로 그린다」이고, full-surface 전체를
편집기에 태우는 것은 별개의 미해결 과제다(daehan 항목과 같은 뿌리).

---

## 3. 각 UI 의 «눌렀을 때 인코딩이 바뀐다» 증명

브리프 §4 의 요구다 — 「카드가 있다」 회귀는 있는데 「누르면 동작한다」가 없어서
2026-08-18 에 OAK 카드가 클릭 시 throw 한 채로 배포됐다.

`test/generator-finder-dom.test.js` 의 기존 DOM 대체 하네스(네이티브 `EventTarget` 상속 +
실제 프로덕션 `wireFinderCardActivation` 배선 + 실 `encode → buildScene → rasterize →
verifyRaster` 파이프라인)를 그대로 썼다. 새 하네스를 안 만들었다.

| UI | 증명 방식 | 결과 |
|---|---|---|
| daehan 카드 | 19장 전 카드 클릭 순회에서 daehan 차례에 `encoded.daehanFinder === true` · 그려진 템플릿 id == `daehanPatternId(encoded.k)` · **같은 버전** legacy 대비 용량 감소 | pass |
| daehan (Type A) | A 에서 누르면 `rendered.finderPatternId !== 'oak-daehan-k10'` (기본 파인더로 대체) | pass |
| daehan 점수 패널 | 카드 id 전수가 «점수 레코드 있음 ∨ 미측정 분기가 받음» — index.html 과 **같은 술어**로 잰다 | pass |
| turnA 토글 | `encodeA(turnA)` on/off 의 `formatIndex` 가 정본 6벡터대로 달라진다 (A0 1→2 · A1 12→4 · A2 13→0) · k·용량은 불변 | pass |
| OAK 편집기 동기화 | 카드 id → 편집기 톤 57 슬롯 전수 대조, 불일치 0 | pass |

**변이 검증** (테스트가 실제로 막는지 — 「주석의 주장은 사실이어야 한다」):

| 변이 | 잡혔나 |
|---|---|
| `finderOak` 을 모드 게이트 목록에 되돌림 | ✅ §6.2 테스트 1건 실패 |
| `syncCellEditorFinderFromGenerator(state, ctx)` 호출 삭제 | ✅ §6.1 테스트 1건 실패 |
| `getOakFinderPattern(id) ||` 폴백 삭제 | ✅ §6.1 테스트 2건 실패 |

---

## 4. 용량 표시가 daehan 에서 올바른 값을 내는가 — 낸다

브리프 §5-4 의 표를 **회귀로 잠갔다** (`test/generator-ui-wiring.test.js`).
실측값이 표와 정확히 일치한다:

| | L | M | H |
|---|---|---|---|
| **V1D** | 15 | 11 | 7 |
| **V2D** | 32 | 26 | 18 |
| **V3D** | 57 | 46 | 32 |

**필요한 수정은 `encodeOptsFor` 한 줄이었다** — `isDaehanFinderPatternId(cfg.finderPatternId)`
면 `opts.daehanFinder = true`. 이 한 줄이 `provider.capacity` 를 `capacityForDaehan` 으로
바꾸고, 화면의 모든 용량 표시(정보줄 g450 · 게이지 · 절단 프로브)는 `encoded.capacity` 를
**단일 원천**으로 읽으므로 자동으로 따라온다. 브리프가 「지금 표시는 일반 V1/V2/V3 값이라
틀린 값을 보여 준다」고 한 것은 그 한 줄이 없었기 때문이고, 표시 코드 자체는 옳았다.

**버전 이름에도 D 를 넣었다** — 정보줄과 게이지 양쪽. 인코더는 이미 `V*D` 라는 이름을
쓰는데(`capacityDaehan.js`) 화면만 「V3」라고 쓰면 65 B 를 기대하는 사람이 46 B 짜리 코드를
들고 간다. 이름이 회계와 갈리는 순간이 조용한 오독의 시작이다.

---

## 5. 8개 언어 사전

새 키 7개를 **ko·en·ja·fr·it·de·es·pt 여덟 사전 전부**에 넣었다 (7 × 8 = 56줄):

| 키 | 쓰임 |
|---|---|
| `g569` | daehan 카드 라벨 |
| `g570` | daehan 서랍 summary |
| `g571` | daehan 힌트 (용량 감소 + 시험판 스캐너 전용) |
| `g572`\~`g575` | turnA 섹션 제목 · 정삼각 · 역삼각 · 힌트 |

- 강제 장치: `test/i18n-coverage.test.js` 「생성기 사전의 여덟 언어가 같은 키 집합을 갖는다」
  — **pass**. `i18n-fallback` · `i18n-language-switch` 도 pass.
- 키 번호 선택 근거: 현재 340키 중 최댓값이 `g998` 이고 **3자리 형식이 강제**된다
  (coverage 테스트의 추출 정규식이 `"(g\d{3})"` 고정폭이라 `g1000` 은 **조용히 검사에서
  빠진다**). 그래서 최댓값 뒤가 아니라 빈 구간 `g569`\~`g599` 를 썼다.
- daehan 카드 라벨(`g569`)은 8언어가 서로 다른 문자열이다 — 브리프 레인은 「고유명이니
  8언어 동일」을 제안했지만, `daehan (전면 79셀)` / `daehan (79-cell full surface)` 처럼
  **고유명은 유지하되 괄호 설명은 번역**했다. 괄호 안이 설명문이라 안 옮기면 그 언어에서
  못 읽는 문구가 남는다. (`g565`\~`g567` 은 괄호 없는 순수 분자명이라 전례와 충돌 없음.)

---

## 6. 못 푼 것 · 내가 틀렸다가 고친 것 · 줄끝 확인

### 6.1 못 푼 것

1. **썸네일 시각 판정 — 브리프가 「브라우저로 확인하라」 한 항목을 못 했다.**
   이 환경은 브라우저를 못 띄운다 (repo 자체 테스트 헤더가 「로컬 HTTP 브라우저 권한 거부 +
   headless Chromium 이 renderer 세션을 못 만듦」을 기록하고 있고, playwright MCP 도 이
   세션에 붙지 않았다). 대신 **기하를 수치로** 냈다
   (`node test/output/lanes/scratch/thumb-geometry.mjs`):

   | | 발자국 | viewBox |
   |---|---|---|
   | 19셀 (OAK 3장) | 19 | 10.06 × 8.90 |
   | daehan k=10 | 79 | 32.58 × 23.90 |

   같은 CSS 폭에 viewBox 자동 맞춤이면 **daehan 카드의 셀은 OAK 카드 셀보다 3.24배 작다**
   (셀 하나가 0.31배). 「알아볼 수 있는가」는 시각 판정이라 **답하지 않았다.**
   운영자가 브라우저에서 보고 판정할 항목이고, 안 되면 별도 축소 규칙(예: daehan 카드만
   `max-width` 를 키우거나 중앙 19셀만 그리고 「전면」을 아이콘으로 암시)이 필요하다.

   ⚠ 다만 **더 큰 결함 하나는 이 과정에서 찾아 고쳤다**: 현행 썸네일 코드는
   `pattern.finderCells` 를 **아예 안 봤다.** 79셀 패턴에 대해 정본 앞 19톤을 **엉뚱한
   불스아이 좌표** 위에 찍고, 배열 길이가 남아서 죽지도 않았다 — 「작아진다」가 아니라
   「같은 크기의 틀린 그림」이었다. 발자국을 패턴에서 받도록 고쳤다(`scene.js` 와 같은 규칙).

2. **daehan 을 편집기에 못 태웠다** — §6.1 말미 참조 (발자국 판정 + 번들 MODULE_ORDER 미등재).
3. **A-CM/O-CM 실기기 검증 전무** — 실사진 휘도 덤프 76개에 코너마커 프레임이 없다.
   합성 래스터에서 검출기가 3/3 정답 k 를 냈다는 것이 실사 노이즈·톤커브·모션블러에서도
   선다는 뜻은 아니다.
4. **turnA/daehan 도 실기기 미검증** — 같은 이유(해당 프레임 없음). 합성 왕복만 쟀다.
5. **`capacity.formatIndex` 의 잠재 불일치** (turnA) — `result.formatIndex` 는 표 값인데
   `result.capacity.formatIndex` 는 기본 A 값 그대로다 (`capacityA.js:196` 이 `spec.formatIndex`
   를 그대로 싣는다). 지금 index.html 은 `.formatIndex` 를 안 읽어서 UI 영향 0 이지만,
   소비자가 생기면 조용히 틀린다. **안 고쳤다** — 이번 범위 밖(인코더 계약)이고, 고치면
   `capacityA` 소비자 전부를 다시 재야 한다.
6. **번들을 패치에 안 넣었다** — 아래 §7 참조.

### 6.2 내가 틀렸다가 고친 것

1. **용량 비교의 «자»를 잘못 잡았다.** 「daehan 을 누르면 용량이 준다」를 검증하면서
   auto 버전끼리 비교했다 → legacy V2 31 B vs daehan V3 32 B 로 **「늘었다」는 답**이 나와
   테스트가 빨개졌다. daehan 은 용량이 줄어 자동 버전 선택이 한 단 올라간다.
   **같은 버전끼리** 재야 했다 (V3: 52 → 32 B). 대상이 아니라 자가 틀린 것이었다.
2. **스크래치 스크립트의 상대경로 깊이를 틀렸다** (`../../../` → `../../../../`).
   `ERR_MODULE_NOT_FOUND` 로 즉사했고, 「모듈이 없다」가 아니라 「내가 4단계를 3단계로
   적었다」였다.
3. **브리프의 「`cornerMarker` 가 `src/decoder/` 에 0건」을 그대로 믿고 「검출기가 없다」로
   읽을 뻔했다.** 실제로는 `src/decoder/corner-marker-detect.js` 가 529줄로 **존재하고**
   단위 테스트도 초록이다. 0건인 것은 **옵션 이름**이고, 없는 것은 **배선**이다.
   이 구분을 안 하면 「구현이 없다」는 틀린 보고를 하게 된다.
4. **`isOakFinderPatternId('oak-daehan-k10')` 이 true 일 거라 가정했다** — id 가 `oak-` 로
   시작하니까. **false 다.** `OAK_BY_ID` 는 세 id 만 든 Map 이고 접두사는 계보를 말해 주지
   않는다. 이 오해를 그대로 뒀으면 daehan 카드를 **고르는 순간** `finder score record
   missing` 으로 `renderFinderUi` 가 죽었을 것이다 (2026-08-18 OAK 편입 때 실제로 터진 자리).
5. **`finder-card-ui.js` 에 daehan import 를 넣고 빌드 순서를 안 봤다.**
   `tools/build-single.mjs` 의 `assertTopologicalOrder` 가 막았다 —
   「`finder-card-ui`(8) → `finder-daehan`(21) : 전방 참조」. `placement` · `finder-daehan` 을
   `finder-card-ui` 앞으로 옮겼다. **이 가드가 없었으면 브라우저에서만 터졌을 것이다.**
   (브리프 레인이 「스캐너 MODULE_ORDER 에 등재하라」는 존재하지 않는 작업을 제안할 뻔한
   것과 반대 방향의 함정 — 스캐너 빌더는 자동 수집이고, 생성기 빌더는 수동 목록이다.)
6. **`test/generator-finder-dom.test.js` 의 daehan 자체검증 실패를 제품 결함으로 오독할 뻔했다.**
   원인은 하네스의 `encodeFor` 가 `daehanFinder` 를 안 넘겨 79셀 파인더가 data 셀 위에
   덧칠된 것이었다 — 하네스가 제품 규칙(`encodeOptsFor`)을 안 따라간 것이다. 하네스를
   제품과 같은 규칙으로 맞췄다.

### 6.3 줄끝 — 안 바꿨다

`.gitattributes` 의 `* text=auto eol=lf` 가 `core.autocrlf=true` 를 이긴다. 사전 삽입은
버퍼로 읽고 버퍼로 쓰는 도구(`test/output/lanes/scratch/add-i18n.mjs`)로 했다.

```
 index.html                        | 271 +++++++++++++++++++++++++++++++++++---
 src/cell-editor-core.js           |  57 +++++++-
 src/finder-card-ui.js             |  13 ++
 src/generator-state.js            |  12 ++
 test/gen-variants.test.js         |   7 +-
 test/generator-finder-dom.test.js |  76 +++++++++--
 test/generator-ui-wiring.test.js  | 259 ++++++++++++++++++++++++++++++++++++
 test/i18n-coverage.test.js        |   7 +-
 tools/build-single.mjs            |  16 ++-
 9 files changed, 681 insertions(+), 37 deletions(-)
```

**index.html 271줄 변경 — 8657줄 전부가 아니다.** CRLF 검사도 직접 돌렸다:
패치 파일 CRLF 0줄, 수정한 소스 6개 파일 전부 CRLF 0줄.

---

## 7. 패치 적용 방법 (읽을 것)

`test/output/lanes/gen-ui.patch` 에는 **소스·테스트·빌드 도구만** 들어 있다.
`dist/` · `sites/_shared/` 의 **생성 산출물은 뺐다** — 넣으면 패치가 70 KB 에서 **4.4 MB** 로
불어나고(98%가 번들 바이트), 어차피 재빌드로 결정적으로 복원되는 파일이다.

```
git apply test/output/lanes/gen-ui.patch
node tools/build-single.mjs
node tools/build-scanner.mjs
node tools/build-lab.mjs
node tools/build-gen-variants.mjs
node tools/build-cell-editor.mjs
node tools/build-finder-editor.mjs
node tools/build-scan-variants.mjs
```

재빌드를 안 하면 `test/bundle.test.js` 등 번들 동기화 회귀가 「최신이 아니에요」로 빨개진다
(그게 그 테스트의 일이다). 재빌드로 실제 바뀌는 파일은 4개다:
`dist/trilume.html` · `sites/_shared/gen-finder.html` · `sites/_shared/lab-gen.html` ·
`sites/_shared/cell-editor.html`. 스캐너 번들(`dist/tlscan.html` 등)은 index.html 을 안 담아
바이트 불변이다.

**워킹트리는 원상복구했다** — `git status --porcelain` 빈 출력, `git apply --check` PASS.
커밋·push 는 안 했다.

---

## 8. 테스트 결과

**표적 34파일 스위트: tests 392 / pass 392 / fail 0 / skipped 0** (전체 스위트는 안 돌렸다 — 무겁다).

포함: `generator-ui-wiring`(신규 15) · `generator-finder-dom` · `gen-variants` ·
`cell-editor-core` · `cell-editor-history` · `finder-editor` · `finder-patterns` ·
`finder-oak-patterns` · `finder-oak-lineup` · `finder-daehan` · `finder-selection` ·
`finder-render-selection` · `finder-score` · `generator-state` · `generator-help-ui` ·
`generator-help-capacity` · `generator-export-ui` · `generator-preview-ui` ·
`i18n-coverage` · `i18n-fallback` · `i18n-language-switch` · `scanner-i18n` ·
`bundle` · `bundle-scanner` · `lab-build` · `lab-routing` · `html-module-syntax` ·
`turnA-wire-regression` · `encodeA` · `encode` · `capacity` · `capacityA` ·
`build-stamp-freshness` · `namespace` · `hub-build`

### 신규 회귀 — `test/generator-ui-wiring.test.js` (15개)

**명제를 잠갔지 모양을 안 잠갔다.** (2026-08-18 에 `bootstrap` 객체 모양 전체를 정규식으로
잠근 핀이 형제 키 하나 추가에 깨진 전례.) 예: §6.2 는 정규식으로 줄을 맞추는 대신
`applyFinderExperimentVisibility` 의 **id 집합을 파싱해 멤버십**을 잰다.

그중 4개는 **「아직 안 된다」를 잠그는 테스트**다 (§5 대조군 + daehan 옵트인 + turnA + CM).
지금 조용히 실패 중인 왕복을 누군가 배선하면 **그 테스트가 빨개져서** 사실이 드러난다.
실패 메시지에 「이제 무엇을 하면 되는지」를 적어 뒀다 — 예:

> `turnA 왕복이 서기 시작했다 — 축하한다. 이제 이 카드를 lab 게이트 밖으로 내보내고`
> `index.html 의 «못 읽어요» 힌트(g575)와 turnASection 주석을 같이 고쳐라.`

대조군 테스트를 같이 넣은 이유: 저 4개가 빨개졌을 때 **대상이 고쳐진 것인지 자가 깨진
것인지** 구분할 수 있어야 한다.

---

## 9. 운영자 판단이 필요한 것 (3건)

1. **daehan 서랍을 일반 모드로 올릴까?** 지금은 고급 전용이다(근거: 안정판 스캐너 옵트인
   미탑재). §6.2 지시를 「새 셀 표면 파인더 전부」로 읽으면 올려야 한다.
   올리려면 `generator-ui-wiring.test.js` 의 §6.2 daehan 기대값 한 줄만 뒤집으면 된다.
2. **daehan 썸네일** — 79셀이 3.24배 작게 그려진다. 브라우저 확인 뒤 별도 축소 규칙이
   필요한지 판정 필요.
3. **turnA 를 `/lab/` 에 두는 것이 맞는가** — 대안은 「왕복이 설 때까지 UI 를 아예 안 붙인다」
   (§3.3 과 같은 처리)다. `/lab/` 에 둔 이유는 그래야 실기기에서 켜 보고 다음 판정을 할 수
   있기 때문이고, 이건 daehan 스캐너 토글이 하루 전 세운 관례를 따른 것이다.

## 10. 재현용 스크래치 (전부 `test/output/lanes/scratch/`, 읽기 전용)

| 파일 | 무엇을 재나 |
|---|---|
| `turnA-daehan-roundtrip.mjs` | §0 표의 turnA · daehan 왕복 (대조군 포함) |
| `cm-roundtrip.mjs` · `cm-diag.mjs` · `cm-cost.mjs` | §3.3 코너마커 왕복 · 실패 단계 진단 · 검출 비용 |
| `editor-sync-verify.mjs` | §6.1 편집기 톤 57슬롯 전수 대조 |
| `thumb-geometry.mjs` | 썸네일 viewBox 배율 |
| `daehan-cap.mjs` · `daehan-clip-equiv.mjs` · `daehan-thumb.mjs` | daehan 용량표 · 잘림 동등성 · 썸네일 |
| `turnA-probe.mjs` | turnA formatIndex 6벡터 · 좌표 집합 동일성 |
| `add-i18n.mjs` | 8언어 사전 삽입 (버퍼 I/O — 줄끝 보존) |
| `recon.json` | 5개 정찰 레인의 구조화 산출 원본 |
