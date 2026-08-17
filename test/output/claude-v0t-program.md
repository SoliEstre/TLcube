# claude-v0t-program.md — v0T 편입 + v0W 계열 전체 드랍 + v0TQ·v0TY 프로그램

레인: Claude (위임, 2026-08-17) · 기점 `origin/main` `2354f71` · 워킹트리만 (커밋 없음)
정본 팩: `cellsurface-v0t-editor.json` (운영자 편집기 export 2026-08-17 — 유일한 진실)

## ① 한 줄 결론

v0T(104셀 · data 307 · margin 0.0962)를 Type Y 최종 파인더로 편입하고 v0W 계열
4종을 차단·비삭제 규약으로 드랍했으며(기본 승계 v0w → v0t), v0TY 는 운영자 스펙
그대로(슬롯 8² · 먼 코너 · 보충 블록 0) 편입되어 남은 A 블록 하나로 톤 사다리
12/12 가 서지만, **v0TQ 는 어떤 슬롯 크기에서도 손대지 않은 게이트(autoplace ·
슬롯 QR 확증)가 거부해 편입하지 않았다** — 게이트를 내려야만 통과한다면 그것이
곧 답이다. (v0T 자체는 10/12 — rot0 × 강한 감마 2칸은 전임 v0W2 와 같은 좌표의
약점으로 핀, §③.)

## ② 자 검증 (기점, 손대기 전)

`claude-v0t-probe.mjs` (경로 폴백만 수리 — C:/Dev ↔ E:/WorkBase):

| id | 회귀값 | 재현값 | 판정 |
|---|---|---|---|
| v0w | 0.0952 | 0.0952 | ok |
| v0w2 | 0.1512 | 0.1512 | ok |
| v0wq | 0.0889 | 0.0889 | ok |
| v0wy | 0.0796 | 0.0796 | ok |

팩 자기검산: 104셀 · 중복 0 · 범위 밖 0 · (0,0) 포함(편입 확정 반영) · 톤 {0,2} ·
L≠T 는 A (4..6)×(3..5) 9셀뿐 · R≠T 는 SE (18..20)² 6셀뿐. 회계: data 307 ·
S=102 · 잔여 1 · payload L/M/H = 86/72/58 B · margin 0.0962 (게이트 0.035 의
2.75배) · 인코더 정합 ⑤ 통과 — 브리프 수치와 전부 일치.

## ③ v0T 편입 범위

와이어 id `v0t` · 프로파일 `cell-surface-v0t` · n=21 전용 · 레거시(v1) 세대 없음.

**정본 유도 (유도 61 + 전사 43 — `claude-v0t-derive.mjs`, 모듈 ↔ 팩 104/104 완전 대조):**

| 블록 | 셀 | 출처 | 비대칭 |
|---|---|---|---|
| NW (0..3)² | 16 | `K3_CENTRE_SYMMETRIC_CELLS` (0..3)² 필터 — v1r2 NW 의 3면 다수결 대칭화, 16/16 일치 | 0 |
| A (4..6)×(3..5) | 9 | 전사 (신규 도안 — L 만 T·R 의 톤 반전) | 9 |
| N팔 (0..1)×(10..14) | 10 | 전사 (신규 도안) | 0 |
| NE (0..5)×(15..20) | 36 | `V0XQ_CORNER_CELLS` **같은 배열**, 36/36 일치 | 0 |
| W (10..15)×(0..3) | 24 | 전사 (톤 수준 NW 행 회문 스택이 관찰되나 행 재배열이라 전사) | 0 |
| SE (18..20)² | 9 | `V0W_PHASE_CELLS` **같은 배열** (v0 SE 의 (+8,+8)), 9/9 일치 | 6 |

- 라인업: `finalLayoutIdsForN(21)` = **[v0t, v0ty]** · 기본 **v0t** (승계 v0w → v0t).
  와이어 선호는 v2r2 그대로 (발행 이력).
- 검출: 앵커드 경로 (K3 계보 중앙 × NE 동심 사각 √279 · 사각 링 게이트 · −141.1°
  앵커) + 중앙 불스아이 확증 구제. `v0tFamily` (기본 on) — v0W 계열 브랜치와 독립.
- **끝-대-끝 톤 사다리 실측** (`claude-v0t-toneladder.out.txt`, ppu 15 · embed 960):
  **v0T 10/12 · v0TY 12/12**. v0T 의 실패 2칸은 **rot0 × gamma0.7/0.6** — 활성
  전임자 v0W2 가 편입 때 갖고 있던 것과 **같은 좌표·같은 회계**의 약점이라 같은
  방식으로 **핀**했다 (`cellSurface-block-locator.test.js` §v0T 자기 복호).
  기전은 다르다 (`claude-v0t-detect-debug.out.txt`): v0T 의 W 블록이 3면 회문
  팔레트라 **중앙 유사 서명**을 내고, 그 가짜 중앙들이 블록 로케이터의 중앙 상위
  3 슬라이스에서 진짜 중앙을 밀어내 앵커드 시드가 0 이 된다 — 실루엣 경로가 함께
  죽는 강한 감마 rot0 칸에서만 겉으로 드러난다. 슬라이스 상한은 기존 경로의 측정
  된 비용 캡이라 이 레인은 건드리지 않았다 (건드리면 전 패밀리 침습) — 실기기
  판정·후속 레인의 후보 좌표로 남긴다.
- 렌더·인코더·디코더·카드·i18n 8언어(g993\~g995)·스캐너 기대 버튼 — 전부 배선.
- (0,0) 3면 dark 편입은 팩에 반영된 확정 그대로 (되돌리지 않음).
- 자기검증 ①-h (로드 시 throw): 블록 분할 16/9/10/36/24/9 · 비대칭 분포 A 9 + SE 6 +
  그 밖 0 · A 는 «L 만 반전» · NE·SE 참조 동일성 · mid 0 · 슬롯 0.

## ④ 드랍 범위 + 정본 의존 실측

**v0W 계열 4종 (v0w · v0wq · v0w2 · v0wy) — 차단이지 삭제가 아니다** (v2r2·v1r2·
v0xq·v0x 와 같은 규약):

- 내림: `CELL_SURFACE_FINAL_DROPPED_IDS` 등재 · 로케이터 패밀리 4스위치 기본 off
  (`v0wFamily`·`v0wqFamily`·`v0w2Family`·`v0wyFamily` — 서로 독립, 하나만 켜면
  그 패밀리 복원) · 생성기 카드 4종 · locatorProfileY 허용값 · 스캐너 lab 기대
  버튼 (v0W·v0WQ·v0W2) · 해상도 연동(#22)의 «중 = v0W».
- 보존: 정본 배열·자기검증·DECLARED_DATA·NS·PROFILE·`encodeOptionsForY` 분기 ·
  i18n 사전 키 8언어 (g606\~g611 · g948·g949·g954 · g966\~g968 ·
  lab.expectedLayout.v0w/.v0wq/.v0w2) · `cellSurfaceFinal(21,'v0w')` 등 와이어 생성.

**정본 상호 의존 실측** (`claude-v0t-derive.mjs` — 브리프가 경고한 «지우면 같이
죽는» 검사):

- `V0W_PHASE_CELLS` (v0 SE 의 평행이동) = **v0T 의 SE 블록 그 자체** (참조 동일).
  v0X 드랍 때 V0X_CELLS 가 활성 v0W2 를 받치던 것과 같은 구조 — **드랍된 계열의
  배열이 새 기본 v0t 를 받친다.** 자기검증 ①-h 가 참조 동일성으로 못 박는다.
- `V0XQ_CORNER_CELLS` = v0T 의 NE 그 자체 (세 번째 보존 사이클).
- `K3_CENTRE_SYMMETRIC_CELLS` (v0W2 의 중앙) = v0T 중앙 16셀의 유도 원천.
- `CENTER_QR_SLOT_CELLS_V0WQ` = v0TY 슬롯 크기의 참조 (운영자 «동일 크기» 스펙).

**n=21 기본 승계 명시: v0w → v0t** (v0X 드랍과 같은 «기본 자체가 빠지는» 드랍 —
선언 순서의 다음 활성 항목이 승계. `finalLayoutIdForN(21) === 'v0t'` 회귀 고정).

복원 스위치 회귀: `cellSurfaceFinal-decode.test.js` §드랍 n=21 왕복 — v0x·v0w·
v0wq·v0w2 가 스위치 위에서 왕복하고, 스위치 없이는 복호가 실패한다 (v0wy 는 그
파일의 조건(ppu 10)에서 드랍 전에도 왕복이 선 적이 없어 행을 신설하지 않았다 —
실측 `claude-v0t-wy-restore-debug.out.txt`: ppu 15 + 복원 스위치에서는 돈다).

## ⑤ v0TQ · v0TY 회계 (4축: 파인더 · data(S) · 인코더 정합 ⑤ · margin)

`claude-v0tqty-probe.mjs` — 셀 집합은 팩에서 직접 유도 (모듈 편입 전 측정).
운영자 확정 준수: 슬롯 제자리 · 보충 블록 신설 0 · 마커 이전 0 · margin 은
표기만 (판정 근거 아님 — 현행 자는 슬롯 QR 파인더 패턴의 방향 정보를 못 센다).

| 변형 | 슬롯 | 파인더 | data · S · 잔여 | 인코더 정합 ⑤ | margin (표기) |
|---|---|---|---|---|---|
| v0TQ m=8 (스펙) | 중앙 [0,7]² | — | — | — (autoplace 가 먼저 거부) | — |
| v0TQ m=4 (유일 수용) | 중앙 [0,3]² | 88 (NW 16 삼킴) | 307 · S=102 · 1 | 통과 (86/72/58 B) | 0.1136 (비대칭 15 잔존) |
| **v0TY m=8 (스펙 — 편입)** | 먼 코너 [13,20]² | **95** (SE 9 삼킴) | **252 · S=84 · 0** | **통과 (71/60/48 B)** | 0.0632 (= A 9셀만, 게이트의 1.80배) |

v0TY autoplace 스윕: m=4..8 수용 · m=9 거부 (S_fmt 260 < 289) — 운영자 스펙 8 =
autoplace 상한 8 = ⑤ 통과, 세 자가 같은 값. m=5 는 ⑤ 가 거부 (L 81B→84/85심볼)
— 슬롯 크기 자가 실제로 물리는 값임을 확인.

## ⑥ 남은 비대칭 블록 하나만으로 회전 3방향이 잡히는가 — **잡힌다 (실측)**

`claude-v0t-rotation.mjs` — 두 층 실측:

| 층 | v0T (A 9 + SE 6 이중화) | v0TY (**A 9 하나** — SE 는 슬롯이 삼킴) |
|---|---|---|
| 이상 표본기 margin | 0.0962 (2.75×) · 오방향 2종 거부 | 0.0632 (1.80×) · 오방향 2종 거부 |
| 실물 래스터 rot0 | ok · v0t · 본문 일치 | ok · v0ty · 본문 일치 |
| 실물 래스터 rot120 | ok · v0t · 본문 일치 | ok · v0ty · 본문 일치 |
| 실물 래스터 rot240 | ok · v0t · 본문 일치 | ok · v0ty · 본문 일치 |

실물 층은 전체 파이프라인(블록 로케이터 시드 → refinePose → 슬롯 QR 확증 →
CS 게이트 → RS)이다 — **의도된 비대칭 이중화가 설계대로 동작한다.** 보충 블록을
만들지 않았고 마커를 옮기지 않았다. 톤 열화까지 얹은 전수는 §③ 의 톤 사다리
(v0TY 12/12 — A 블록 하나로 열화 4종 × 회전 3방향 전부). ⚠ 실사진 검증은 이
체크아웃에서 불가 (휘도 덤프 없음) — 통합자 확인 항목.

## ⑦ 교차 오수용 전수 (남은 라인업 양방향)

`claude-v0t-crossmatrix.mjs` (이상 표본기 — 기전 관측):

- 정방향 별칭 **2 방향**: `v0t|v0ty` · `v0ty|v0t` (둘 다 agreement 1.0000).
  **구조적**이다 — v0ty 로케이터 95셀은 v0t 의 톤까지 같은 진부분집합이고, v0t 의
  나머지 9셀(SE)은 전부 v0ty 슬롯 안이라 이상 표본기(슬롯 표본 없음)의 분모에서
  빠진다. v0w ↔ v0wq 별칭과 같은 기전 계보다.
- 회전 별칭 **0**.
- 타이브레이크: 이상 표본기에서 v0ty 프레임도 기본(v0t)으로 뽑힌다 (agreement
  동률 → n 기본). **실물 래스터에서는 갈린다** — ⑥ 표의 실측이 그 증명이다
  (rot 3방향 전부 자기 레이아웃으로 복호). 가르는 층: 슬롯 자리의 실제 픽셀 +
  블록 로케이터의 슬롯 QR 확증 (`v0tyRequireSlotQr`, v0wy 확증 재사용 · 문턱 공유).
- n=13 v0 와는 n 이 갈라 같은 프레임에서 경쟁하지 않는다 (셀 관계만 기록:
  좌표·톤 일치 10/30).
- 회귀 고정: `cellSurfaceFinal.test.js` §n=21 활성 라인업 교차 수용 (별칭 셋 →
  두 방향 재핀 · 옛 4후보 별칭은 드랍 대조군으로 이관 —
  `claude-v0t-crossmatrix.control.out.txt` 가 드랍 전 별칭 셋 + 회전 한 칸을 그대로
  재현: 드랍이 별칭 구조를 만들지 않았다).
- **부수 발견 (복원 스위치 의미론 — 통합자 참고):** ① 문서에 예고돼 있던 잠재
  별칭 **v0wy → v0xq** 는 `includeDroppedCellSurfaceLayouts` (전체 와이어 10후보)
  로 복원하면 **실물 래스터에서도 활성화된다** — v0xq 42셀이 v0wy 파인더의 톤까지
  같은 부분집합 + v0xq 후보의 슬롯 배제가 v0wy K3 중앙을 채점 밖으로 치워
  agreement 1.0 동률이 되고, 타이브레이크(후보 순서)가 v0xq 를 골라 포맷 판독이
  죽는다. 그래서 v0W 계열 복원 회귀는 **드랍 전 라인업 후보로 좁혀** 돈다
  (`cellSurface-block-locator.test.js` §PRE_V0T_LINEUP_21). ② v0t 를 켠 채 복원하면
  **v0t 포즈 다양성이 복원 세계를 좋아지는 쪽으로도 바꾼다** — v0W2 의 rot0 감마
  약점 핀 2칸이 구제돼 뒤집힌다 (v0W2 가 v0W 을 구제했던 것과 같은 기전). 복원
  회귀는 신설 패밀리까지 격리해 드랍 전 세계를 비트 재현한다.

## ⑧ 손댄 파일

**src (8):** `cellSurfaceFinal.js` (v0t/v0ty 정본·회계·자기검증 ①-h/①-i ·
드랍 목록 · 슬롯 테이블) · `decoder/cellsurface-block-detect.js` (패밀리 스위치
드랍 4 + 신설 v0t/v0ty · 패치 2종 · 앵커드/불스아이 확증 브랜치 · slotQr 확증
enabled 파라미터화 · poseCount) · `decoder/cellSurfaceY-detect.js` (주석·복원
스위치 목록) · `decoder/cube-detect.js` (주석) · `decode.js` (프로파일 힌트 ·
n 추론) · `locatorY.js` (프로파일 2종) · `generator-state.js` (허용값) ·
`generator-render-config.js` (인코드 분기 2종) · `sceneY.js` (프로파일 매핑 ·
import).

**UI/사이트 (4):** `index.html` (카드 2신설·4드랍 · «면» 연동 v0ty · #22 연동
v0t · i18n 신규 6키 × 8언어 + g964/g965 갱신 — 기계 수술 `claude-v0t-i18n-apply.mjs`)
· `sites/tlscan/index.html` (기대 버튼) · `sites/tlscan/scanner.js` (허용값) ·
`sites/tlscan/strings.js` (기대 버튼 키 2 × 8언어).

**파생 번들 재빌드 (브리프 6종 + build-single):** gen-variants · scanner ·
scan-variants · cell-editor · finder-editor · hub · single (dist/trilume.html 은
build-single 산출이라 함께 재빌드 — 동기화 회귀 방지).

**테스트 (8):** `cellSurfaceFinal.test.js` · `cellSurfaceFinal-decode.test.js` ·
`cellSurface-block-locator.test.js` · `locatorY.test.js` · `locatorY-lab.test.js` ·
`generator-help-ui.test.js` · `generator-help-capacity.test.js` ·
`y-cell-editor-refformat.test.js`.

**레인 하네스 (신규):** `claude-v0t-derive.mjs`(+.out) · `claude-v0tqty-probe.mjs`(+.out)
· `claude-v0t-rotation.mjs`(+.out) · `claude-v0t-crossmatrix.mjs`(+.out ·
+control.out — 드랍 4후보 대조군: 드랍 전 별칭 셋 + 회전 별칭 한 칸 그대로 재현) ·
`claude-v0t-toneladder.mjs`(+.out) · `claude-v0t-detect-debug.mjs`(+.out) ·
`claude-v0t-family-interplay.mjs`(+.out) · `claude-v0t-i18n-apply.mjs` ·
`claude-v0t-wy-restore-debug.mjs`(+.out) · `claude-v0t-probe.mjs` 경로 폴백 +
(0,0) 주석 현행화 (+.out 갱신) · 표적 테스트 로그 `claude-v0t-test-*.txt`.

## ⑨ 막힌 지점

**v0TQ — 편입 불가 (게이트 무접촉 실측).** 운영자 스펙 «중앙 [0,7]² · 슬롯 8×8»:

1. **autoplace 가 m=5..9 전부 거부** — 포맷 복제 최대 이격 S_fmt(233\~250) < 하한
   289. v0T 의 N팔(0..1)×(10..14)·W 블록(10..15)×(0..3)이 v0WQ 시절 포맷 복제가
   앉던 자리를 먹기 때문이다 (v0wq 는 m≤9 수용이었다 — 점유 집합이 다르다).
   m≥10 은 NW 레퍼런스 L자 거부 (기존과 동일).
2. **유일 수용 m=4 는 검출이 구조적으로 죽는다** — 콰이어트 프레임이 0셀이라
   (m≤7 전부 0 · m=8 부터 28) 슬롯 QR 확증(`centreQrFinderContrast`, 콰이어트
   표본 ≥ 6 요구)이 모든 시드를 거절한다. 그 확증은 교차 누수를 막으려고 세운
   봉합이라 끄는 것은 완화다.

브리프 규약(«⑤ 거부 → 슬롯 크기 쪽으로 푼다»)의 연장선에서 슬롯 축소를 끝까지
밀어도(4) 다른 손대지 않은 게이트가 막는다 — **문턱을 내려야만 통과한다면 그것이
곧 답이다.** 와이어를 만들지 않았고(«읽을 프레임이 세상에 없는 코드를 유지하지
않는다»), 좌표는 위 ⑤ 표와 `claude-v0tqty-probe.out.txt` 에 전부 남겼다. 중앙
슬롯 변형이 필요하면 v0T 셀 배치 자체의 재설계(운영자 결정)가 필요하다 — 이
레인의 권한 밖이다.

그 밖의 막힘: 없음. (실사진 가드 6건은 이 기계에 덤프가 없어 검증 불가 — 기존
제약이지 이 레인의 막힘이 아니다. 통합자 확인 항목으로 ⑥·⑦ 에 명시.)

## ⑩ 게이트 무접촉 증명

- agreement 0.78 · orientationMargin 0.035 (`cellSurfaceY-detect.js`) — 무수정.
  `git diff src/decoder/cellSurfaceY-detect.js` 는 주석·복원 스위치 목록뿐.
- CRC · RS · 인코더 정합 ⑤ — 무수정 (⑤ 는 v0TY 슬롯 크기를 **판정하는 쪽**으로만
  동작했고, v0TQ 에서는 거부 판정이 그대로 결론이 됐다).
- 봉합 0.075R (`centreQrBullseyeVetoRadiusRatio`) · 0.60 (`centreQrMinFinderContrast`)
  — 무수정.
- `v0wySlotQrMinContrast` 0.6 · `v0wySlotQrMinCorrelation` 0.25 ·
  `v0wySlotQrMinSpanRatio` 0.35 — 무수정. v0TY 는 **같은 값을 공유**한다 (경로
  파라미터 규약 — v0wq 가 v0xq* 값을 공유한 전례. 새 문턱 0 · 완화 0).
  신설 키는 스위치뿐이다: `v0tFamily`·`v0tRequireSquareRing`·`v0tyFamily`·
  `v0tyRequireSquareRing`·`v0tyRequireSlotQr` (전부 기본 on — 게이트 추가 방향)
  + 드랍 스위치 4종 기본 off (복원용).
- `slotQrConfirmsPose` 의 `enabled` 파라미터는 기본값이 기존 스위치라 기존 호출부
  비트 동일 — v0TY 호출부만 자기 스위치를 명시로 넘긴다 (한쪽 A/B 가 다른 쪽
  확증을 조용히 끄지 않게).

## 표적 테스트 (전체 스위트 금지 — 브리프 준수)

| 파일 | 결과 |
|---|---|
| cellSurfaceFinal.test.js | 47/47 pass |
| cellSurfaceFinal-decode.test.js | 7/7 pass |
| locatorY.test.js · y-cell-editor-refformat.test.js · generator-render-config-y.test.js | 29/29 pass |
| cellSurface-clip-partial · generator-help-capacity · generator-help-ui · locatorY-lab | 58/58 pass |
| bundle · bundle-scanner · lab-p0-instrumentation | 23/23 pass |
| encode-wire · scanner-i18n | 15/15 pass |
| i18n-coverage · generator-render-config-y · cellSurfaceLayouts | 30/30 pass |
| y-cell-editor-refformat · bundle (재빌드 후 재확인) | 14/14 pass |
| **cellSurface-block-locator.test.js (72 = 기존 69 + 신설 v0T 축 3)** | **72/72 pass** |

블록 로케이터 스위트의 72/72 는 세 로그의 합성이다 (이 기계에서 전체 1회 ≈ 28분):
전체 런 `claude-v0t-test-blockloc2.txt` 68/72 → 실패 4건의 원인(복원 후보 의미론,
위 ⑦ 부수 발견)을 고쳐 소비자 전수 재실행 — `blockloc4.txt` 10/10 (실패 4 + 같은
상수를 쓰는 6) · `blockloc5.txt` 3/3 (나머지 소비자 3). 두 패턴 런 사이의 유일한
변경은 복원 상수 정의이고 그 소비자 전수(13)가 재실행됐다 (grep 대조).

로그: `test/output/lanes/claude-v0t-test-*.txt`. 실사진 가드 6건은 이 체크아웃에서
skip — 그 초록은 실사진 무검증이다 (통합자가 덤프 있는 기계에서 재측정).

모른다고 적을 것: v0T·v0TY 의 **실기기 인식률**은 이 레인에서 모른다 — 합성
검증만 있다. margin 자가 슬롯 QR 방향 정보를 못 세는 폭도 정량화하지 않았다
(운영자 근거를 그대로 인용했다).
