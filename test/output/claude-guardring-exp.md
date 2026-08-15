# 가드 링 반증 실험 A\~F — 실행 보고 (claude 레인, 2026-08-15)

설계 정본: `.agent/decoder/009_guardring_design.md` §1.3 · §5 · §6.
워크트리: `3616deb` detached, `src/` 무수정. 스크립트:
- `test/output/lanes/claude-guardring-exp.mjs` — 정본 실험 (자 검증 + A\~F)
- `test/output/lanes/claude-guardring-exp-b5.mjs` — 부가 진단 (proposalBoundaries [5])

둘 다 결정적 (RNG 없음). 검출 호출: `detectBullseyes(luma, { ringLayouts: [0, 2] })` — 현행 스캐너(`bootstrap.js`)와 동일.

심볼 앵커 재확인 (3616deb 기준, 009 의 행 번호는 구버전): `detectBullseyes` = `src/decoder/bullseye-detect.js:1505`,
실패 객체 `evaluatedRaw` = `:1653`, `bestCandidate` = `:1656`, `voteScale` 경계·부호 규약(`boundary % 2 === 1 ? 1 : -1`
= `:731`, `boundaryRadius = outerRadius·k/6` = `:734`) = `:725~745`, `proposalBoundaries` 공개 옵션 = `:698~722`. 계약은 009 서술과 동일.

## 공통 파라미터

- 9 px/cell, 무왜곡, supersample 2.
- R_max = maxSafeRadius(1) = √13 = 3.605551275463989 unit → 32.44996 px
- 가드 접면 5/6 R = 3.0046260628866577 unit → 27.04163 px
- 고립 캔버스: 24×24 unit (216×216 px), 참 중심 (108, 108) px, 참 cellSize = 9 px.
- 색: 명 = BULLSEYE_LIGHT {255,255,255}, 암 = BULLSEYE_DARK {0,0,0}, 배경 = DEFAULT_PRESET background {14,16,24}.
- D 의 참 중심: V1 scene layout 원점 (119.32497, 108) px.

## 1. 자 검증 (하네스 건전성)

순수 불스아이 V1 (`encode('gt', {version:1, eccLevel:'M'})` + 기본 파인더 `bullseye`, 9 px/cell) →
`detectBullseyes(luma, { ringLayouts: [0, 2] })` **성공** (후보 1개, layout 0).

| 측정 | 값 |
|---|---:|
| center 오차 | **0.7523 px = 0.0836 cell** |
| cellSize | 9.00256 (참 9) — 상대오차 **0.028%** |
| score | 0.99988 |

하네스는 건전하다. 이하 실패는 하네스가 아니라 대상의 실패다.

## 2. 실험 A\~C — 고립 2-disc

Scene: 명 disc r=R_max + 암 disc r=5/6 R_max (내부 단색 암), 배경 preset. §5 절차 1 그대로.

결과: `ok: false` (`frontend:no-finder`) — 예상대로 (§2.3, 성공은 애초에 기대 안 함).

| 문턱 | 실측 | 문턱값 | 판정 |
|---|---:|---|---|
| A. `evaluatedRaw` | **60** | ≥ 1 살림 | **살림** — 제안(투표)은 생긴다 |
| B. `bestCandidate.center` 오차 | 4.2874 px = **0.4764 cell** | < 0.5 cell 살림 | **살림 (근소 — 여유 4.7%)** |
| C. `bestCandidate.cellSize` | 14.2496 (참 9) = **상대오차 58.33%** | < 8% 살림 | **버림** |

bestCandidate = (105.470, 104.538), cellSize 14.250, bestScore 0.3713, evaluatedRefined 8.

C 의 죽음은 문턱표가 예고한 바로 그 모드다 — «스케일 시드가 경계 5를 다른 k 로 해석».
14.250/9 = 1.583 즉 검출기는 27.04 px 의 진짜 경계-5 원을 더 큰 파인더의 안쪽 경계로 읽었다.

## 3. 실험 D — Type O V1 데이터 필드 + disc 2장 오버레이

Scene: `buildScene(V1)` 뒤 shapes 에 명 disc(R_max)·암 disc(5/6 R_max) push — 중앙 파인더가 가드 링으로 덮인다.

결과: `ok: false`, evaluatedRaw **59**, evaluatedRefined 8, bestScore 0.2930.

| 문턱 | 실측 | 판정 |
|---|---:|---|
| B. center 오차 | 2.2014 px = **0.2446 cell** | **살림** (< 0.5 cell) |
| C. cellSize | 12.6086 (참 9) = **상대오차 40.10%** | **버림** (≥ 8%) |

D 는 고립(A\~C)과 같은 무늬로 죽었다 — 중심은 버티고 스케일이 죽는다. «고립은 되고 필드 안에서만 죽는» D 전용 사망이 아니다.

## 4. 실험 E — disc 없는 셀-칠 육각 가드 대조

Scene: `regionCells(2)` 19셀 × 3면 전부 암 폴리곤 (잘린 12셀 = 가드 암, 내부 7셀 = A 의 «내부 단색 암» 평행),
배경 = BULLSEYE_LIGHT (disc 없음 — 명/암 경계가 19셀 합집합의 육각 윤곽).

결과: `ok: false`, evaluatedRaw 72, bestScore 0.6036.

| 측정 | 실측 |
|---|---:|
| bestCandidate.center 오차 | 32.518 px = **3.613 cell** |
| bestCandidate.cellSize | 11.787 = 상대오차 30.97% |

**셀-칠 가드는 죽었다** — 후보가 중심에서 3.6 cell 떨어진 육각 변 쪽에 선다. A(중심오차 0.48 cell)는 사는데
E 가 죽었으므로, §5 E 행 판정 그대로 **«셀 칠 가드» 안 폐기, disc 윤곽 우위 유지**. §1.5 의
«잘린 셀을 색만 칠하면 윤곽이 롬빌» 주장이 실측으로 확인됐다.

## 5. 실험 F — 명암 반전 disc + 기본 부호

Scene: A 와 동일하되 색 교환 (암 disc r=R_max + 명 disc r=5/6 R_max), 배경 preset, 기본 부호로 검출.

결과: `ok: false`, evaluatedRaw 59, bestScore 0.

| 측정 | 실측 |
|---|---:|
| bestCandidate.center 오차 | 94.837 px = **10.537 cell** |
| bestCandidate.cellSize | 13.377 = 상대오차 48.63% |

**B 실패 = 정상.** 반전 극성은 기본 부호로 중심에 모이지 않는다 — §2.1 의 부호 해석
(홀수 경계 = 안 암 → 밖 명, 반대면 표가 반대편으로)이 맞다는 대조 확인.

## 6. 부가 진단 — proposalBoundaries [5] (§2.2 «전용 제안 패스» 시뮬레이션)

§2.2 는 «`proposalBoundaries` 를 [5] 로 줄이면 표가 한곳으로 모인다» 고 추정했다. 같은 A·D luma 에
공개 옵션 `{ ringLayouts: [0, 2], proposalBoundaries: [5] }` 만 바꿔 재검출:

| 케이스 | evaluatedRaw | center 오차 | cellSize 상대오차 |
|---|---:|---:|---:|
| A-고립 [1..5] (정본) | 60 | 0.476 cell | 58.3% |
| A-고립 **[5]** | 49 | **1.007 cell** | **24.4%** |
| D-오버레이 [1..5] (정본) | 59 | 0.245 cell | 40.1% |
| D-오버레이 **[5]** | 54 | **2.886 cell** | **90.5%** |

[5] 단독은 관측 가능한 `bestCandidate` 기준으로 **구제하지 못했고 오히려 악화**됐다.

⚠ 해석 한계: `bestCandidate` 는 **점수 순위**(compareScored — hardChecks → radialError)의 최상위지
투표 피크가 아니다. 가드 링은 어떤 후보도 링 채점을 통과하지 못하므로, 최상위는 «쓰레기 후보들 중
점수 우연이 가장 좋은 것» 이다. [5] 악화가 «표가 안 모인다» 의 증명은 아니다 — 투표 평면 자체는
공개 API 로 관측 불가 (`collectRawProposals`·`voteScale` 비공개). 다만 **문턱표의 관측 대상은
bestCandidate 로 정의**돼 있고, 그 자로는 기본이든 [5] 든 C 가 죽는다.

## 7. §6 판정 트리 적용

§5 판정문: «A\~C 가 깨지면 고리 전략 자체를 버린다. D 만 깨지면 ‹고리 1개 + 커스텀 내부› 를 버리고 하이브리드(링 4)로 남긴다.»

- A 살림 (60 ≥ 1) · B 살림 (0.476 < 0.5, 근소) · **C 버림 (58.3% ≥ 8%)** → A\~C 세트가 온전히 살지 못했다.
- D 만 죽은 경우가 아니다 — 고립에서 이미 C 가 죽었다.
- E 죽음 → 셀-칠 가드 폐기 (disc 우위는 유지되나 상위 판정에 흡수).
- F 는 예상대로 실패 → 부호 규약 유효, 재측정 불요.

**판정: 「고리 전략 폐기」행.** 문턱표 문언 그대로 — 고리 1개는 현행 제안 경로에서 위치(B)는 근소하게
건지지만 스케일 시드(C)를 신뢰 가능하게 만들지 못한다. C 의 버림 사유 문구(«스케일 시드가 경계 5를
다른 k 로 해석»)가 실측과 정확히 일치하고, §2.2 가 남겨 둔 구제 수단([5] 전용 패스)도 문턱표의 자로는
구제하지 못했다.

부기 (판정 아님, 관측 사실): B 가 두 케이스 모두 산 것은 «중심 제안 자체는 생긴다» 는 §2.1 의 방향이
틀리지 않았음을 시사한다. 죽은 것은 스케일 축이다. 고리 **하나**의 반지름을 6분할 격자의 어느 k 로
읽을지가 단서 없이는 정해지지 않는 구조적 문제라, 링을 늘리는 순간 사실상 하이브리드(링 4)다 —
§5 D 행의 «링을 늘리거나(사실상 하이브리드) 포기» 와 같은 자리로 수렴한다.

## 8. 못 한 것

1. **§5 말미 부가 실험 (detectCentralCubeFinders 큐브 r=1.2 vs 3.5 대조)** — 미실행. «시간 남으면» 조건부인
   데다 가드 링 판정 트리와 무관하고, `detectCentralCubeFinders` 호출 계약을 이 레인에서 새로 익히다
   하네스 오용 노이즈를 만들 리스크가 판정 가치보다 크다고 봤다. §4 는 미확인 상태로 남는다.
2. **투표 평면 직접 관측** — `voteScale`/`collectRawProposals` 비공개라 «표가 중심에 몇 점 모였는가» 를
   직접 재지 못했다. 재려면 구현 라운드에서 디버그 훅이 필요하다 (src 무수정 제약상 이번 범위 밖).
3. 실사진 검증 — §5 규약대로 A\~C 가 산 뒤에만 보기로 했고, C 가 죽었으므로 하지 않았다.
