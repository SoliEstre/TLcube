# 슬롯 QR 확증 결함 2건 수리 — 계기(결함 A) 먼저, 본체(결함 B) 다음

레인: `lane/v0wy` · 기점 `127d055` · 2026-08-17
하네스: `test/output/lanes/claude-slotqr-{ruler,instrument,probe,phase}.mjs` (+ 각 `.out.txt` = 수리 전 · `.post.out.txt` = 수리 후)

## 1. 한 줄 결론

거절 계수기가 구제 경로의 거절(절반)을 안 세던 것을 경로별 분리 계수로 고치고, 그 계기로 «빈 슬롯에서 v0wy 포즈 2 통과» 의 원인이 **눈금 없는 두 자(Pearson·contrast)가 span 붕괴 아래서 폭발하는 것**임을 실측으로 못박은 뒤, 확증에 **프로브 상관 하한(0.25 · 새 키)** 과 **span 상응성(0.35 · 새 키, 같은 포즈의 중앙 불스아이가 눈금)** 을 추가해 빈 슬롯 팔의 v0wy 포즈를 0 으로 만들었다 — 기존 문턱·게이트는 한 값도 안 움직였고, 진짜 프레임들의 포즈 회계는 여섯 프레임 전부 한 자리도 안 움직였다.

## 2. 자 검증 (수리 전, 127d055 무수정 — `claude-slotqr-ruler.out.txt`)

브리프의 세 기준선 전부 재현됐다:

| 기준선 | 브리프 서술 | 실측 | 일치 |
|---|---|---|---|
| 진짜 QR 프레임의 v0wy 포즈 | 1 | **1** (정답 H contrast 1.0392) | ○ |
| 그때 `diagnostics.slotQr` | rejected 가 실패를 못 센다 | `{rejected: 0}` (확증 off 3 ↔ on 1 인데 0) | ○ |
| 결함 B 재현 | 구멍·단색에서 포즈 2 | 구멍 **2** · 단색 어두움 **2** (정답 H contrast 둘 다 0.0000) | ○ |

진짜 QR 프레임(팔 A) 전체 회계: `v0w:3 v0w2:3 v0wy:1 v0:2` — 직전 레인 기록
(`claude-v0wy-probe.out.txt` §⑤ v0wy 행)과 일치. 브리프 4절의 «v0w:8 · v0w2:8 · v0:2» 는
**v0W·v0W2 프레임**의 회계다 (같은 §⑤ — 아래 4절 표에서 함께 고정).

## 3. 결함 A — 계기 수리

**무엇이 안 세어졌나.** `slotQrConfirmsPose` 를 부르는 조립 경로는 둘이다 —
앵커드(`assembleAnchoredPoses`, 거절 시 계수)와 중앙 불스아이 구제
(`assembleBullseyeConfirmedPoses`, 거절 시 `continue` 만 하고 **무계수**). v0WY 계열
프레임에서는 앵커드 경로가 v0wy 후보를 아예 안 내고(실측 rejAnchored 0) 후보 **전부**가
구제 경로로 오므로, «회귀 대조군» 으로 못박힌 `slotQr.rejected` 가 정작 v0WY 프레임의
거절을 **하나도** 못 셌다 (확증 off 3 → on 1 인데 rejected 0).

**어떻게 고쳤나.** 구제 경로에 계수기를 달고 경로별로 분리해서 내보낸다:

```
slotQr: {
  rejected:          <합계 — 기존 소비자 무접촉>,
  rejectedAnchored:  <앵커드 경로>,
  rejectedBullseye:  <구제 경로>,
}
```

불변식: `rejected === rejectedAnchored + rejectedBullseye`. 기존 회귀
(`cellSurface-block-locator.test.js` «거절 수 = 확증 없이 섰을 포즈 수», v0W 프레임 8)는
합계 의미가 보존되므로 그대로 성립한다.

**회귀 이름** (`test/cellSurface-block-locator.test.js` 신설 2건 중 1):

- **«슬롯 QR 거절 계수기 — 두 확증 경로가 각각 계수되고 총수 = 경로별 합»** —
  ① 총수 = 경로별 합 (v0W·v0WY 프레임 양쪽), ② 각 경로가 실제로 한 번은 올라간다
  (앵커드는 v0W 프레임 실측 8 · 구제는 v0WY 프레임 실측 2 — 한쪽이 0 이면 그 경로의
  자가 죽은 것), ③ 총수 = «확증 없이 섰을 포즈 − 선 포즈» (전수 계수).

## 4. 결함 B — 본체 수리

**고친 계기로 본 것 (수리 A 후 — `claude-slotqr-instrument.out.txt`).** 수리 전에 안 보이던
것이 바로 보였다: 팔 A 의 거절 2 는 전부 구제 경로였고(rejBullseye 2), 빈 슬롯 팔에서는
후보 3 중 **1 만 거절되고 2 가 통과**하고 있었다 — 게다가 거절된 1 이 하필 «정답 기하»
후보였다 (진짜 자리를 보는 후보는 contrast 0.0000 으로 잘리고, 엉뚱한 데를 보는 후보가
통과하는 역전).

**원인 (전부 실측 — `claude-slotqr-probe.out.txt` · `claude-slotqr-phase.out.txt`).**
구제 경로의 v0wy 후보 3 개는 같은 삼중점의 세 코너에서 시드된 **세 120° 위상**이다.
브리프의 가설(«registerPatch 의 오프셋 탐색이 확증을 뚫는다»)이 두 형태로 확인됐다:

- **오프셋 보행**: 정답 기하 후보의 슬롯 패치가 빈 슬롯을 보면 contrast@H = 0.0000 이지만,
  `slotQrConfirmsPose` 의 registerPatch 재정합에는 원 봉합 ② 호출부에 있던 **상관 하한이
  없어서**, 상관 0.17 짜리 쓰레기 피크(탐색 격자 모서리 +7.5px)를 물고 온다. 그 어긋난
  자리에서 패치 span(p95−p5)이 0.9622 → 0.0559 로 무너지고 contrast = 2.0574 로 폭발 → 통과.
- **회전 위상**: 120°/240° 위상 후보의 슬롯 패치는 물리 L/R 필러 코너(균일 어두움)를
  보는데, Pearson 도 contrast 도 **눈금 없는(scale-free) 자**라 면 게인 음영 잔재
  (진폭 \~0.1 의 기울기)만으로 상관 0.25\~0.59 · contrast 1.67\~2.58 이 선다 — 소스가 봉합 ②
  설계 주석에서 경고한 바로 그 실패 모드(«상관은 사실상 면 게인 음영만 잰다»)의 재발이다.
  진짜 QR 이 슬롯에 있으면 이 위상들의 상관은 −0.25\~−0.12 로 죽는다 — 팔 A 에서 거절 2 가
  나오고 빈 팔에서 통과 2 가 나온 역전의 정체.

공통 서명은 **span 붕괴**다: 진짜 통과의 span 0.96\~1.00 대 누수의 span 0.039\~0.063.

**수리 (조건 추가 2 — 기존 문턱 무접촉·전부 새 키·방향은 엄격화뿐).**

1. `v0wySlotQrMinCorrelation: 0.25` — 원 봉합 ② 호출부가 contrast 를 읽기 **전에**
   registerPatch 프로브에 걸던 상관 게이트(0.25)를 재사용 지점에도 단다 (호출부 패턴 완성).
   진짜 실측 0.9928\~0.9999 (톤 사다리 포함) ↔ 오프셋 보행 누수 0.155\~0.173.
2. `v0wySlotQrMinSpanRatio: 0.35` — **span 상응성**: 슬롯 패치의 동적 범위가 같은 포즈
   중앙 K3 불스아이 패치의 동적 범위(같은 H·같은 프레임)에 상응해야 한다. 분자·분모가
   같은 광학을 지나므로 톤 커브·노출·면 게인이 약분되는 무차원 자다 (봉합 ② 정규화와
   같은 원리). 실측: 진짜 1.1702\~1.5559 (톤 사다리 4종) ↔ 누수 전부 0.0536\~0.0865
   → 문턱 0.35 는 진짜 최소의 3.34× 아래 · 누수 최대의 4.05× 위.

기각한 대안 (실측 근거): 프로브 경계-히트 거절은 **진짜 통과**(팔 A 위상 120°, offset
−1.72,+7.51 경계)를 자르므로 기각. 상관 하한 단독은 회전 위상 누수(상관 0.25\~0.59)를
못 자르므로 불충분.

**수리 후 재측정 (`claude-slotqr-instrument.post.out.txt` — 여섯 프레임 전부).**

| 프레임 | ON v0wy | rejected | rejAnchored | rejBullseye | 합일치 | OFF v0wy | 전수계수 | 포즈 회계 (수리 전 → 후) |
|---|---|---|---|---|---|---|---|---|
| A 진짜 QR (v0wy) | **1** | 2 | 0 | 2 | ○ | 3 | ○ | `v0w:3 v0w2:3 v0wy:1 v0:2` → **동일** |
| B 슬롯 구멍 | **0** (전 2) | 3 | 0 | 3 | ○ | 3 | ○ | 타 패밀리 동일 |
| C2 단색 어두움 | **0** (전 2) | 3 | 0 | 3 | ○ | 3 | ○ | 타 패밀리 동일 |
| v0w 프레임 | 0 | 8 | 8 | 0 | ○ | 8 | ○ | `v0w:8 v0w2:8 v0:2` → **동일** |
| v0w2 프레임 | 0 | 8 | 8 | 0 | ○ | 8 | ○ | `v0w:8 v0w2:8 v0:2` → **동일** |
| v0wq 프레임 | 0 | 0 | 0 | 0 | ○ | 0 | ○ | `v0wq:1 v0:2` → **동일** |

빈 슬롯 팔 v0wy = 0 (요구 충족). 진짜 프레임들의 기존 포즈 회계 — v0wy 프레임
`v0w:3 v0w2:3 v0wy:1 v0:2` · v0W/v0W2 프레임 `v0w:8 v0w2:8 v0:2` (rejected 8 유지) ·
v0WQ 프레임 `v0wq:1 v0:2` — **한 자리도 안 움직였다** (직전 레인 §⑤ 대장과 전 행 일치).
게이트 재료의 열화 봉투(톤 사다리 4종, `claude-slotqr-phase.post.out.txt`): 진짜 위상
상관 ≥ 0.9968 · contrast 1.0009\~1.0392 · span 비 ≥ 1.1702 — 세 조건 모두 넉넉하다.

**회귀 이름** (신설 2건 중 2):

- **«슬롯 QR 확증 — 슬롯에 QR 이 없으면 v0wy 포즈가 0 이다 (구멍·단색 어두움)»** —
  두 빈 슬롯 팔에서 ON 포즈 0, 대조군(확증 off 후보 ≥ 1 — «항상 0 인 자» 방지),
  전수 계수(rejected = off 포즈 수), 타 패밀리 비침습, 그리고 진짜 QR 프레임의 v0wy ≥ 1
  («전부 자르는 자» 방지).

**표적 테스트**: `node --test test/cellSurface-block-locator.test.js` → (결과 대기 중 — 완료 후 갱신)

## 5. 손댄 파일

- `src/decoder/cellsurface-block-detect.js` — ① 구제 경로 거절 계수 + 반환/폴백 객체에
  `slotQrRejected` 추가, ② 진단 `slotQr` 을 합계 + 경로별 2필드로 확장, ③ DEFAULTS 에
  새 키 2 (`v0wySlotQrMinCorrelation` 0.25 · `v0wySlotQrMinSpanRatio` 0.35) + 근거 주석,
  ④ `patchSpan` 헬퍼 신설, ⑤ `slotQrConfirmsPose` 에 상관 하한·span 상응성 게이트 추가.
- `test/cellSurface-block-locator.test.js` — 회귀 2건 신설 (§3·§4 의 이름), import 2줄 추가
  (`centerQrSlotCellsFor`/`centerQrSlotOriginFor` · `faceBasis`).
- `test/output/lanes/claude-slotqr-{ruler,instrument,probe,phase}.mjs` + `.out.txt`/`.post.out.txt` —
  측정 하네스와 수리 전·후 기록 (신규, 트리 내 `test/output/` 한정).
- `test/output/claude-slotqr-repair.md` — 이 보고서.

## 6. 막힌 지점

- **실사진 검증 불가 (통합자 확인 항목).** 이 체크아웃에는 실사진 휘도 덤프가 없어
  실사진 가드 6건이 통째로 skip 된다. 새 조건 2 는 무차원(톤·노출·게인 약분)이라
  구조적으로 실사진에 안전하도록 골랐지만, **실사진에서의 진짜 v0wy 상관·span 비의
  실분포는 여기서 못 쟀다**. 특히 강한 블러는 1셀 폭 콰이어트 링의 span 을 불스아이
  (5×5 블록)보다 먼저 깎을 수 있다 — 3.34× 여유가 그것을 감당하는지는 덤프 있는
  기계의 몫이다. 문턱 0.35·0.25 는 `csBlockLocator` calibration 키라 현장 조정 가능.
- 우회 ①: 후보 포즈의 H 를 검출기 내부에서 직접 뽑지 않고(소스 무수정 원칙),
  확증 off 세계의 **셰이프 정점 7점에서 DLT 로 복원**했다 (잔차 ≤ 6e-13 px 자체 검증).
  셰이프 dedupe 가 120° 위상을 지우므로 복원 H 에 canonical 120° 회전을 합성해 위상
  후보 6개(실후보 3개의 상위집합)를 전수 평가했다 — 실후보 귀속은 poseCount·rejected
  실측과 교차 검증했다 (`phase` 하네스 판정 합계 = 검출기 실측과 일치).
- 관측 (수리 안 함 — 브리프 범위 밖): 진단 `bullseyeConfirmed.poses` 가
  `posesV0x + posesV0w + posesV0w2` 만 합산하고 **`posesV0wy` 를 빠뜨린다**
  (`cellsurface-block-detect.js` 진단 조립부). 결함 A 와 같은 «구제 경로 누락» 패턴의
  잔재다 — 별도 레인에서 같은 방식(경로별 분리)으로 고칠 것을 권한다.
- 그 외 막힘: **없음.**

## 7. 게이트 무접촉 증명

`git diff` 의 **삭제 줄은 정확히 3줄**이고 전부 의도한 편집점이다:

```
-  if (!probe) return false;                                          (확증 — 상관 하한 추가 위해 대체)
-            if (spec.slotQr && !slotQrConfirmsPose(...)) continue;   (구제 경로 — 계수 추가 위해 대체)
-      slotQr: { rejected: slotQrRejected },                          (진단 — 경로별 분리로 대체)
```

보호 목록의 값·키는 diff 의 추가/삭제 줄 어디에도 없다 (grep 무일치 확인):
`0.78`(agreement) · `0.035`(orientationMargin) · `0.075`(불스아이 거부권 반경비) ·
`centreQrMinFinderContrast`(0.6) · `v0wySlotQrMinContrast: 0.6` ·
`v0xqCentreMinCorrelation: 0.25` · `minimumAgreement` · `minimumOrientationMargin` ·
CRC · RS · 인코더 정합 ⑤ — 전부 무접촉. v0WY 셀 배치(파인더 67 · 슬롯 [13,20]² 64셀 ·
margin 0.0796)도 무접촉 (인코더·렌더러·`cellSurfaceFinal.js` diff 없음).
추가된 문턱 2건은 **새 키**이며 방향은 엄격화뿐이다 — 이 조건들로 새로 통과하게 되는
경우는 존재하지 않는다 (거짓이 참이 되는 방향의 변경 없음).

git 조작 없음 — 변경은 워킹트리에만 있다.
