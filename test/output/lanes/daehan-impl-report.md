# daehan 편입 구현 — 보고

레인: 구현 + 측정 · **`src/` 영구 수정 없음 · 미커밋 · 미푸시** · 작업 디렉터리 `TLcube` (git `f02a00b`)
측정일: 2026-08-18 · 합성 프레임 + 렌더 프레임 + **실사진 휘도 덤프 149장**
게이트 무변경: `minCorrelation 0.56` · `minContrastRatio 0.24` · `minOrientationMargin 0.035`
(모든 측정 스크립트가 실행 시 이를 단언한다 — 건드리면 throw)
전부 포그라운드 · 백그라운드 작업 없음.

---

## 0. 자기 검증 (브리프 §6) — 결과부터

| 검사 | 결과 |
|---|---|
| `overheadBreakdown(6).total === 45` (인자 없이) | ✅ 45 · 8→49 · 10→53 모두 무변경 |
| 기존 14후보가 자기 이름으로 검출 14/14 | ✅ **14/14** (참 씨앗 조건) |
| 실사진 149장 검출·복호 결과 무변화 | ✅ **149장 중 0장 변화** (복호 93 → 93) |
| `git apply --check` PASS | ✅ (깨끗한 트리에서 확인) |
| 워킹트리 청결 (`git status --porcelain` 빈 값) | ✅ |

**어긋난 항목 없음.** 다만 브리프가 안 물은 두 가지를 내가 찾아 여기 올린다 — 둘 다 이번
라운드의 설계를 바꿨다.

> ### ⚠ 발견 ① — **파인더는 «daehan 이다» 까지만 말할 수 있고 «어느 k 인가» 는 못 말한다**
>
> daehan 은 절대 좌표라 잘림이 **포함 사슬**이다 (k6 39셀 ⊂ k8 59셀 ⊂ k10 79셀).
> 그래서 **k=8 프레임 위에서 k6 템플릿의 39셀은 전부 제 톤 위에 앉는다** — 상관이
> 「오수용」이 아니라 **정당하게** 1.000000 이고, k8 템플릿과 소수 6자리까지 같다.
> 게다가 순위 키인 `fit` 은 `correlation × contrastRatio` 라 **작은 쪽이 더 높게** 나오는
> 일까지 있다 (§3). 나는 처음에 「id 가 k 를 말한다」로 배선했고 **k=8·k=10 이 전부
> 죽었다.** 지금은 브리프 §4 ⓑ 계약 그대로 — 파인더가 daehan 여부만 말하고 **k 는
> RS/CRC 가 고른다.** 왕복 18/18 이 그 경로의 실재를 증명한다 (§2).
>
> ### ⚠ 발견 ② — **daehan 을 배포 기본 라인업에 얹으면 레거시가 다친다. 그래서 옵트인이다**
>
> 실기기에 가까운 씨앗 조건(척도 씨앗 없음)에서 **기존 14후보 중 5칸이 daehan 에게
> 이름을 뺏긴다** — 그중 2칸은 원래 자기 이름이었고 3칸은 원래 검출 실패였다
> (= 실패가 **게이트를 통과하는 조용히 틀린 답**으로 바뀐다, §5). 비용도 레거시
> 프레임에서 **×16.6** 이다. 이 라운드는 배선을 완성하고 **기본값은 안 건드렸다** —
> `options.cellFinderDaehan === true` 옵트인이다. 그래서 실사진 149장이 «정의상»
> 안 바뀐다 (라인업이 같으면 결과가 같다). 이것이 이 라운드의 **blocker** 이고 §5 에 있다.

---

## 1. 회계 — 브리프 §2 표와 대조 (구현 **전**에 독립 재계산)

`claude-di-accounting.mjs` (소스 무수정 상태에서 실행 · exit 0 = 전부 일치).

| k | 총셀 | 살아남는 파인더셀 | 그중 불스아이 | data 잠식 | anchor/format/ref 충돌 | 오버헤드 | 데이터셀 | 심볼 | 잔여 |
|---|---|---|---|---|---|---|---|---|---|
| 6 | 127 | 39 | 19 | 20 | **없음** | 45 → **65** | **62** | **20** | 2 |
| 8 | 217 | 59 | 19 | 40 | **없음** | 49 → **89** | **128** | **42** | 2 |
| 10 | 331 | 79 | 19 | 60 | **없음** | 53 → **113** | **218** | **72** | 2 |

브리프 §2.1 표와 **전 칸 일치**. 불스아이 19셀이 정본 79셀에 포함되는 것도 확인했다
(그래서 예약 = 살아남은 셀 − 19 이고, 이중 계상이 없다).

**순 페이로드** — 브리프 §2.2 표를 내가 재계산해 대조:

| 키 | S | nsym L/M/H | L | M | H | 브리프 | 일치 |
|---|---|---|---|---|---|---|---|
| `V1D` | 20 | 3 / 7 / 11 | 15 B | 11 B | 7 B | 15/11/7 | ✅ |
| `V2D` | 42 | 7 / 14 / 22 | 32 B | 26 B | 18 B | 32/26/18 | ✅ |
| `V3D` | 72 | 11 / 23 / 37 | 57 B | 46 B | 32 B | 57/46/32 | ✅ |

**V1D 함정은 코드와 테스트 양쪽에 못 박았다.** `NSYM_TABLE_DAEHAN` 은 `NSYM_TABLE` 과
**다른 객체**이고 키가 하나도 안 겹친다. `test/finder-daehan.test.js` ③ 이 본표 3행의
값을 통째로 단언하고, 두 표의 키 집합이 서로소인 것까지 잰다 — 「V1 행에서 symbols 만
27→20 으로 고치면 되네」가 실행되는 순간 빨강이 된다.

---

## 2. 왕복 (브리프 §3.7 · §5) — **18/18**

`claude-di-roundtrip.mjs`. 두 층을 따로 잰다.

### 2.1 ⓐ 회계 왕복 — `encode(daehan)` → `decodeCells`

| k | ECC | 순 페이로드 | 심볼 S | data 셀 | 왕복 |
|---|---|---|---|---|---|
| 6 | L / M / H | 15 / 11 / 7 B | 20 | 62 | ✅ ✅ ✅ |
| 8 | L / M / H | 32 / 26 / 18 B | 42 | 128 | ✅ ✅ ✅ |
| 10 | L / M / H | 57 / 46 / 32 B | 72 | 218 | ✅ ✅ ✅ |

페이로드는 매 칸 **용량을 꽉 채워** 넣었다 (`maxPayloadBytes` 그대로). 즉 §1 의 표가
회계로만이 아니라 **실제로 그만큼 실린다.**

### 2.2 ⓑ 광학 왕복 — `encode → buildScene → rasterize → decodeFrontend`

| k | ECC | 페이로드 | 프레임 | 이긴 템플릿 | RS/CRC 가 고른 k | 복호 |
|---|---|---|---|---|---|---|
| 6 | L / M / H | 15 / 11 / 7 B | 636×576 | `oak-daehan-k6` | **k=6** | ✅ ✅ ✅ |
| 8 | L / M / H | 32 / 26 / 18 B | 803×720 | `oak-daehan-k6` | **k=8** | ✅ ✅ ✅ |
| 10 | L / M / H | 57 / 46 / 32 B | 969×864 | `oak-daehan-k6` | **k=10** | ✅ ✅ ✅ |

**이 표가 발견 ①의 값이다.** 이긴 템플릿은 아홉 칸 전부 `oak-daehan-k6` 인데 복호된 k 는
6/8/10 으로 **정확히 갈린다.** 파인더가 못 가른 것을 RS/CRC 가 갈랐다 — 브리프 §4 ⓑ
계약이 문자 그대로 작동한 것이다.

---

## 3. 왜 patternId 로 k 를 고르면 안 되는가 (실측)

`claude-di-nesting.mjs`. 같은 호모그래피에서 세 daehan 템플릿을 나란히 채점:

| 프레임 k | k6 corr | k8 corr | k10 corr | 최대 |
|---|---|---|---|---|
| 6 | **1.000000** | 0.901132 | (발자국이 프레임 밖) | k6 |
| 8 | **1.000000** | **1.000000** | 0.917363 | k6 |
| 10 | **0.996446** | 0.983604 | 0.967400 | k6 |

읽는 법:

- **k=8 행이 핵심이다.** k6 과 k8 이 소수 6자리까지 같다. 「작은 템플릿이 큰 프레임을
  맞히는 것」은 결함이 아니라 **포함 사슬의 당연한 귀결**이다 — k6 의 39셀이 k8 프레임에도
  같은 톤으로 그려져 있다.
- **k=10 행은 동률조차 아니다.** 작은 쪽이 **더 높다.** 순위 키 `fit` 이
  `max(0,corr) × clamp01(contrastRatio/0.45)` 인데 발자국이 다르면 `contrastRatio` 의
  분모가 되는 light/dark 평균이 달라지기 때문이다. daehan 의 바깥 셀은 대부분 어두워서
  큰 발자국일수록 contrast 가 희석된다.
- k=6 행의 k8 = 0.901132 는 **반대 방향의 근거**다: 큰 템플릿을 작은 프레임에 대면
  없는 셀 자리에서 데이터를 읽어 상관이 무너진다. 즉 **k 마다 템플릿이 따로 있어야 한다는
  것도 참**이다 (하나로 합칠 수 없다).

> **내가 여기서 한 번 헛짚었다.** 「동률이면 발자국 큰 쪽이 이긴다」는 타이브레이크를
> `scoreBest`/`scoreAll` 에 넣고 «이걸로 닫힌다» 는 주석까지 썼다. 재 보니 **한 칸도
> 안 바뀌었다** — `fit` 은 contrastRatio 가 섞여 있어 **정확히 같은 값이 애초에 안 나오기**
> 때문이다. 죽은 코드에 「이게 막는다」는 주석을 달아 두면 다음 사람이 그 거짓말을 믿는다.
> **되돌렸다.** 패치에 그 변경은 없다.

발자국 크기가 다른 후보를 NCC 하나로 겨루는 문제는 이 라운드가 못 푼다 — 그건 이미
`radius10-search-report.md` §6.4-④ 가 «차원이 다른 검사가 하나 더 필요하다» 로 적어 둔
미해결 과제이고, 그 처방(예: `latticeMargin`)은 `reconcile-report.md` §8 에서 «계량만 하고
막지는 않는다» 로 1단계에 머물러 있다. **억지로 만들지 않았다.**

---

## 4. formatIndex 조사 (브리프 §4) — **ⓐ 는 아직 필요 없다**

`claude-di-misread.mjs`. 브리프가 지정한 질문 그대로: **daehan 프레임을 일반 V1/V2/V3 으로
잘못 읽으면 RS/CRC 가 반드시 거절하는가.** 세 층에서 45조합.

### ① 셀 층 — 27조합 전부 RS 거절

daehan 프레임을 **레거시 격자로** 훑은 digit 열을 만들어(파인더 예약 셀 20/40/60개가
데이터인 척 섞인다) 레거시 프로파일에 먹였다. **셀 수가 맞으므로 «길이로 거절» 이 안 통한다** —
82 / 168 / 278 셀로 레거시 기대치와 정확히 같다. RS 가 진짜로 일을 해야 하는 조건이다.

| 쓴 것 | 읽은 것 | 결과 |
|---|---|---|
| V1D × L/M/H | V1 × L/M/H (9조합) | 전부 거절 — `Berlekamp-Massey deg Λ = 2/4/6 > t` |
| V2D × L/M/H | V2 × L/M/H (9조합) | 전부 거절 — deg Λ 초과 3 · Chien 근 미발견 6 |
| V3D × L/M/H | V3 × L/M/H (9조합) | 전부 거절 — deg Λ 초과 6 · errata 위치자 미발견 3 |

**27/27 거절. 원문이 나온 칸 0.**

### ② 프레임 층 — 9조합 전부 거절

daehan 프레임(k=6/8/10 × L/M/H)을 **배포 기본 라인업**(daehan 없음)으로 `decodeFrontend`:
**9/9 `frontend:no-format-candidate`.** 즉 지금 나가 있는 스캐너가 daehan 코드를 만나면
조용히 틀린 답을 내는 게 아니라 **못 읽는다고 말한다.**

### ③ 역방향 — 9조합 전부 거절

레거시 프레임을 daehan 회계로 읽으면 9/9 RS 거절.

### 판정

> **거절 못 한 조합 0건.** 이 데이터에서 ⓑ(광학 검출 + 사후 RS/CRC) 계약은 안전하고,
> 전용 formatIndex(ⓐ)는 **이번 라운드에 필요하지 않다.**

**단, ⓐ 가 필요해지는 조건을 적어 둔다** (지금 안 필요하다는 것과 영원히 안 필요하다는 것은
다르다):

1. **실기기 잡음이 들어오면 이 45조합은 상한이 아니다.** 위 측정은 전부 **무잡음 합성
   digit** 이다. RS 는 오류가 t 를 넘으면 거절하지만 «다른 유효 코드워드로 오정정» 될
   확률이 0 은 아니고(부호의 한계이지 버그가 아니다), 잡음이 그 확률을 올린다.
   실사진 daehan 프레임이 생기면 이 표를 다시 그려야 한다 — **지금은 daehan 을 찍은
   사진이 한 장도 없다.**
2. **ECC-L 이 가장 얇다.** V1D/L 은 nsym 3 (t=1) 이라 거절 여유가 제일 작다. 위 표에서
   V1D/L → V1/L 의 `deg Λ = 2` 는 t=1 을 **1 만큼** 넘긴 것이다 — 통과한 게 아니라
   아슬하게 걸린 것이고, 이 여유가 실기기에서 가장 먼저 닫힐 자리다.
3. **daehan 이 기본 라인업에 올라가는 날** (§5 blocker 가 풀리는 날) 재측정이 필요하다.
   그때는 «레거시 프레임을 daehan 으로 읽는» 쪽(③)이 실전에서 실제로 발생하기 시작한다.
4. 빈 슬롯은 있다 — VERSION_BITS 4 의 16칸 중 3 · 7 · 8\~15 가 비어 있다. ⓐ 로 가야 할
   때 자리가 없어서 못 가는 상황은 아니다.

---

## 5. Blocker — daehan 은 배포 기본 라인업에 못 올린다 (이번 라운드)

브리프 §3.6 은 «정보가 그 지점까지 도달하는 경로가 실재하는지 먼저 확인하라» 고 했다.
**경로는 실재한다** — 검출 → `cellFinderHypotheses` → `validateGridHypotheses` →
`layoutForFamily` → `decodeCells` 가 전부 이어져 있고 왕복 18/18 이 그것을 값으로 보인다
(§2.2). 막힌 곳은 그 **앞단**이다: 라인업에 daehan 을 넣는 순간 레거시가 다친다.

### 5.1 레거시 오수용 — 씨앗 축을 갈라 전수로 (`claude-di-lineup-risk.mjs`)

기존 14후보 × 씨앗 정책 3 × 라인업 2 = 84 검출.

| 씨앗 정책 | 라인업 14 자기이름 | 라인업 17 자기이름 | daehan 이 가로챈 칸 |
|---|---|---|---|
| **S-a 중심 + 척도 씨앗** | 14/14 | **14/14** | **0** |
| **S-b 중심만** | 9/14 | 7/14 | **5** |
| **S-c 자율 (씨앗 없음)** | 9/14 | 7/14 | **5** |

가로챈 10칸(S-b 5 + S-c 5) 전건:

| 후보 | 라인업 14 | 라인업 17 | 성격 |
|---|---|---|---|
| `flower-7-0020-coprime-offset` | 자기 이름 | `oak-daehan-k6` (게이트 통과) | **자기이름 → 오수용** |
| `flower-7-1020-coprime-offset` | 자기 이름 | `oak-daehan-k6` (게이트 통과) | **자기이름 → 오수용** |
| `swirl-c2-5-5-11-both` | 검출 실패 | `oak-daehan-k6` (게이트 통과) | 실패 → 오수용 |
| `tristar-refined-h3` | 검출 실패 | `oak-daehan-k6` (게이트 통과) | 실패 → 오수용 |
| `oak-nitrogen-r2` | 검출 실패 | `oak-daehan-k6` (게이트 통과) | 실패 → 오수용 |

(다섯 후보가 S-b·S-c 양쪽에서 같은 식으로 걸린다.)

**정직하게 읽는 법:**

- **참 척도 씨앗을 주면 피해가 0 이다** (S-a). 즉 이건 「daehan 템플릿이 본질적으로
  레거시를 잡아먹는다」가 아니라 「**척도를 모를 때** 39셀 발자국이 19셀 발자국의 자리를
  가져간다」다.
- 그런데 **실기기 조건은 S-c 에 가깝다.** 배포 경로(`discoverCellFinders`)는 실루엣에서
  척도 씨앗을 유도하지만 실루엣이 프레임 경계에 닿거나 불안정하면 씨앗 없이 돈다.
- 「실패 → 오수용」 3칸이 「자기이름 → 오수용」 2칸보다 **더 나쁘다.** 검출 실패는 다음
  프레임에 다시 시도하면 되지만, 게이트를 통과한 틀린 이름은 그대로 회계까지 간다.

### 5.2 비용 (`claude-di-cost.mjs`)

검출 비용의 지배항은 «후보 하나 더» 가 아니라 **«발자국 하나 더»** 다
(`cell-finder-detect.js` 헤더 — 발자국별로 표본을 따로 뜬다). 803×720 레거시 프레임 · 중앙값:

| 라인업 | ms | 배수 |
|---|---|---|
| 14 (기존, 발자국 1) | 16.1 | ×1.00 |
| 15 (+daehan k6, 발자국 2) | 41.6 | ×2.59 |
| 15 (+daehan k10, 발자국 2) | 115.2 | ×7.17 |
| **17 (+daehan 셋, 발자국 4)** | **267.4** | **×16.64** |

반경 법칙(`e389c29`)이 큰 발자국에 촘촘한 각도 격자를 주는 대가다. 이 값은 «반경 10 을
제대로 훑는 정직한 비용» 이지 낭비가 아니지만(같은 보고서 §5.5), **실기기 연속 스캔에
그대로 얹을 수는 없다.**

### 5.3 이 라운드가 택한 것

**라인업을 옵트인으로 둔다** — `bootstrap.js` 의 `CELL_FINDER_LINEUP` 은 **한 글자도 안
바뀌었고**, daehan 은 `CELL_FINDER_LINEUP_DAEHAN` 에 따로 있으며
`options.cellFinderDaehan === true` 일 때만 선택된다.

- 배선은 **완성**됐다 (왕복 18/18 · §2.2).
- 실사진 149장은 **정의상** 안 바뀐다 — 기본 라인업이 같으니 결과가 같다.
  그래도 주장하지 않고 **쟀다** (§6).
- `test/finder-daehan.test.js` ⑦ 이 «기본 옵션으로는 거절 · 옵트인으로는 원문 복호» 를
  k=6/8/10 세 칸에서 값으로 잠근다. 누가 기본값으로 바꾸면 그 테스트가 빨강이 된다.

### 5.4 풀리려면 무엇이 필요한가 (다음 라운드 이후)

1. **발자국 크기가 다른 후보를 가르는 검사** — `radius10-search-report.md` §6.4-④,
   `reconcile-report.md` §8 의 `latticeMargin` 2단계(결정적 실험)가 그 자리다.
2. **계단 편성** — 발자국 4개를 매 프레임 다 훑지 않는 라인업 전략. `reconcile-report.md`
   §5.5 가 실측만 남기고 미결로 뒀다.
3. **daehan 실사진** — 지금 149장 중 daehan 을 찍은 것은 0장이다. §4-1 의 재측정도
   이것이 있어야 한다.

---

## 6. 기존 회귀 무영향 — 값으로 증명

`claude-di-regress.mjs` 를 **패치 전(정본 트리)·패치 후 각각** 돌려 JSON 을 남기고
`claude-di-regress-diff.mjs` 로 전수 대조했다 (`exit 0` = 차이 0).

```
게이트                    ✅ 3개 중 0개 다름
① 기존 회계               ✅ 22개 중 0개 다름
② 기존 14후보 자기 이름    ✅ 15개 중 0개 다름
③ 실사진 149장            ✅ 149장 중 바뀐 장 0 (복호 93 → 93)
총 차이 0건 — 패치는 기존 경로를 한 값도 안 바꾼다
```

### 6.1 ① 이 잰 22개 (전부 «예약 인자를 안 넘기는 경로»)

| 값 | 패치 전 | 패치 후 |
|---|---|---|
| `overheadBreakdown(6/8/10).total` | 45 / 49 / 53 | **45 / 49 / 53** |
| `dataCellsInScanOrder(6/8/10).length` | 82 / 168 / 278 | **82 / 168 / 278** |
| `fillerCells(6/8/10).length` | 1 / 0 / 2 | **1 / 0 / 2** |
| `layoutMap(k)` 의 역할 집합 | anchor·bullseye·data·format·reference | **동일** (`finder` 안 생김) |
| `capacityFor(V1..V3, L/M/H)` 9칸 전 필드 | — | **전 칸 동일** |
| `NSYM_TABLE` 직렬화 | — | **동일** |

`capacityFor` 는 이번에 **인자를 하나 더 받게 됐다** (`nsymSource`, 기본값 = 본표).
그 변경이 레거시 산출을 안 흔든다는 것이 위 9칸 × 전 필드 대조다.

### 6.2 ② 기존 14후보 — 14/14

렌더 프레임 · 참 자세 · 참 척도 씨앗 · 라인업 14. 전부 자기 이름, corr 최저 0.9999
(`pinwheel-c2-2-1100-cw`), 게이트 전건 통과. **패치 전후 15개 행이 값까지 동일.**

### 6.3 ③ 실사진 149장 — 0장 변화

`tools/read-luma.mjs` 의 `listLumaDumps()` → **149장** (브리프 §0 대로 반드시 썼다).
`lumaToRaster` → `decodeFrontend(raster, {})` **기본 옵션** = 배포 경로 그대로.

```
복호 성공: 패치 전 93/149 → 패치 후 93/149
ok · reason · text 셋 중 하나라도 다른 장: 0
```

그리고 스위트의 실사진 가드 3종도 패치를 얹고 초록이다 (§8):
중앙 QR 8/9 · 19셀 파인더 3/3 · 기존 불스아이 13/17.

---

## 7. 구현 — 무엇을 어디에 뒀나

### 7.1 파일

| 파일 | 상태 | 하는 일 |
|---|---|---|
| `src/finder-daehan.js` | **신규** | 79셀 좌표 + 237면 톤 + k별 잘림(39/59/79) + 예약 셀 + 로드 자기검증 |
| `src/capacityDaehan.js` | **신규** | `VERSIONS_DAEHAN` 3행 + `capacityForDaehan` + 로드 자기검증 |
| `test/finder-daehan.test.js` | **신규** | 정본 전수 대조 · 회귀 · 왕복 · 포함 사슬 · 옵트인 (12 테스트) |
| `src/rs211.js` | 수정 | `NSYM_TABLE_DAEHAN` 추가. **본표 `NSYM_TABLE` 은 한 값도 안 건드림** |
| `src/capacity.js` | 수정 | `capacityFor(spec, level, nsymSource?)` — 3번째 인자 생략 시 종전과 동일 |
| `src/layout.js` | 수정 | `dataCellsInScanOrder`·`symbolCellGroups`·`fillerCells`·`layoutMap` 에 선택 인자 |
| `src/placement.js` | **무수정** | `buildRoleSets(k, finderReserved)`·`overheadBreakdown(k, n)` 이 이미 있었다 |
| `src/encode.js` | 수정 | `daehanFinder` 옵션 → layout provider |
| `src/decode.js` | 수정 | `format.daehanFinder === true` 분기 (O-CM 전례와 같은 자리) |
| `src/decoder/bootstrap.js` | 수정 | 옵트인 라인업 · patternId → 예약 셀 · `decodeFormat.daehanFinder` |
| `src/decoder/grid-sample.js` | 수정 | role `'finder'` 셀은 불스아이처럼 건너뛴다 (+`skippedFinders` 진단) |
| `src/scene.js` | 수정 | `cell-mask` 렌더가 `finderCells` 발자국을 따르고 반경 k 밖을 자른다 |
| `tools/build-single.mjs` · `tools/build-finder-editor.mjs` | 수정 | 새 모듈 2개를 `MODULE_ORDER` 에 등록 |

### 7.2 «capacity.js 냐 새 파일이냐» — 결정과 이유 (브리프 §3.3)

**새 파일 `src/capacityDaehan.js` 에 뒀다.** 근거 셋:

1. **`VERSIONS` 는 표가 아니라 목록이다.** 브리프가 옳게 지적한 대로 그 배열은 인코더의
   자동 버전 선택 목록(`chooseVersion` 순차 훑기)이자 디코더의 가설 목록
   (`decode.js` `VERSIONS.find`)이다. daehan 은 version(1/2/3)과 k(6/8/10)가 기존과
   **완전히 겹치므로** 같은 배열에 넣으면 `find` 가 조용히 엉뚱한 spec 을 집는다.
2. **전례 둘이 이미 «별도 모듈»이다.** `capacityY.js` 의 `NSYM_TABLE_Y2W` /
   `capacityForY2Window`, `markerO.js` 의 `NSYM_TABLE_OCM` / `VERSIONS_OCM` /
   `capacityForOMarker`. 둘 다 `capacity.js` 밖이다.
3. **`markerO.js` 처럼 레이아웃 모듈 안에 넣지 않은 이유**: O-CM 은 마커 기하와 회계가
   한 몸이라 한 파일이 자연스럽다. daehan 은 기하(79셀 좌표·톤)를 `finder-daehan.js` 가
   들고 **렌더러와 검출기가 그 파일을 import 한다** — 거기에 RS·헤더 회계를 얹으면
   렌더 경로가 `rs211` 을 끌고 온다. 표현(무엇인가)과 회계(얼마나 담는가)를 갈랐다.

### 7.3 `capacityFor` 재사용 (브리프 §2.3 «capacityFor 는 재사용한다»)

`markerO.js` 는 `capacityFor` 본문을 **통째로 베껴** `capacityForOMarker` 를 만들었고,
그 사본은 이미 원본과 조금 갈려 있다 (`spec.name` 라벨 처리). 세 번째 사본을 만드는 대신
`capacityFor` 에 **nsym 표만 주입**하게 했다:

```js
export function capacityFor(spec, level = 'M', nsymSource) {
  const tables = nsymSource || { table: NSYM_TABLE, tableName: 'NSYM_TABLE' };
  ...
```

기본값이 본표이므로 레거시 산출은 비트 동일이고(§6.1), daehan 은
`capacityFor(spec, level, { table: NSYM_TABLE_DAEHAN, tableName: 'NSYM_TABLE_DAEHAN' })`
한 줄로 같은 회계를 탄다. `markerO.js` 의 사본은 **이번에 안 건드렸다** — 그건 별도
정리이고 이 라운드 범위 밖이다.

### 7.4 layout.js 를 «선택 인자» 로 한 이유 (전용 함수가 아니라)

O-CM 은 format·reference 좌표까지 `autoplaceHex` 로 **재유도**하므로 scan order 함수가
통째로 달라야 했다. daehan 은 다르다 — 예약 셀이 anchor/format/reference 와 **하나도
안 겹치는 것이 전 k 에서 실측 확인**됐다(§1). 그래서 바뀌는 것은 「어떤 셀이 data 가
아닌가」 한 가지뿐이고, 규칙 하나가 다른데 함수를 복제하면 나머지 규칙이 갈린다.

---

## 8. 테스트

### 8.1 새 테스트 — `test/finder-daehan.test.js` 12/12

| # | 명제 | 결과 |
|---|---|---|
| ① | 표가 **정본과 같다** (좌표 79 · 면 톤 237 전수 재유도 대조) | ✅ `.agent` 정본으로 대조 |
| ①-b | 잘림이 정본 규약대로 (절대 좌표 · 반경 밖 잘림 · 포함 사슬 · 예약 20/40/60) | ✅ |
| ② | 기존 회계 무변경 (예약 인자를 안 넘기는 경로 전부) | ✅ |
| ③ | **nsym 본표가 안 바뀌었다** (V1D 함정) + 두 표 키 서로소 | ✅ |
| ③-b | daehan 회계가 확정값과 같다 (오버헤드·심볼·페이로드 9칸) | ✅ |
| ③-c | 예약 셀이 anchor/format/reference 와 안 겹친다 | ✅ |
| ④ | 왕복 k×ECC 9칸 전부 원문 + 예약 셀에 digit 없음 | ✅ |
| ④-b | 레거시 회계로 daehan 을 읽으면 조용히 성공하지 않는다 | ✅ |
| ⑤ | 광학 — 그린 것을 검출기가 daehan 으로 되찾고 게이트 통과 | ✅ |
| ⑤-b | 패턴 명부 (이름·발자국 39/59/79·술어가 레거시 id 에 안 걸림) | ✅ |
| ⑥ | **patternId 는 프레임의 k 를 말해 주지 못한다** (포함 사슬을 값으로 잠금) | ✅ |
| ⑦ | 배포 기본은 거절 · 옵트인은 원문 복호 (k=6/8/10) | ✅ |

> **정본이 없으면 skip 하지 않는다.** `.agent` 정본 → repo 사본 → 자기 일관성 순으로
> 내려가고, 어느 단계인지 로그에 찍는다. skip 은 «통과» 로 읽히고 그렇게 거짓 초록이 난다.

### 8.2 기존 스위트 — **142 파일 중 140 초록, 2 는 패치 전에도 빨강**

패치를 얹고 **전 파일**을 돌렸다 — `test/*.test.js` 136 + `test/harness/*` 2 +
`relay/*` 4 = 142. 빠뜨린 파일이 없는지 목록을 대조해 확인했다 (미실행 0).

| 파일 | 결과 | 비고 |
|---|---|---|
| 나머지 140 파일 | ✅ 전부 통과 | 파인더·앞단·실사진 가드 3종 포함 (35/35) |
| `test/cellSurface-block-locator.test.js` | ⏱ **560 s 초과** | **정본 트리에서도 같다** — 측정으로 확인 |
| `test/decoder-cube.test.js` | ✖ 1/13 실패 (Type Y 3톤 실사진) | **정본 트리에서도 같은 실패** — 측정으로 확인 |

두 건 다 **패치 전 트리(`git checkout` 후)에서 같은 결과**를 재현했다. 이 라운드가 만든
것이 아니다. `decoder-cube` 실패는 `frontend:symbol-clipped` / `no-finder` 로 Type Y
3톤 경로이고 daehan 이 닿지 않는 자리다.

---

## 9. 산출물과 적용 절차

### 9.1 패치

`test/output/lanes/daehan-impl.patch` — **13 파일 · 1487줄** (`+1400 −40` 남짓).

```
git apply --check test/output/lanes/daehan-impl.patch     # PASS 확인됨
```

### 9.2 ⚠ 패치를 적용한 뒤 **생성물을 다시 구워야 한다**

`src/` 를 바꾸면 단일 HTML 번들 8개가 어긋난다. 그 8개는 **결정적 생성물**이고 diff 가
**10.7 MB** (긴 한 줄짜리 임베드 문자열)라 패치에 넣지 않았다. 대신 명령을 남긴다:

```
git apply test/output/lanes/daehan-impl.patch
node tools/build-single.mjs        # dist/trilume.html
node tools/build-scanner.mjs       # dist/tlscan.html
node tools/build-finder-editor.mjs # sites/_shared/gen-finder-editor.html
node tools/build-cell-editor.mjs   # sites/_shared/cell-editor.html
node tools/build-lab.mjs           # sites/_shared/lab-gen.html · lab-scan.html
node tools/build-gen-variants.mjs  # sites/_shared/gen-finder.html · sites/tl/
node tools/build-scan-variants.mjs # sites/_shared/scan-new.html
node tools/build-print-poster.mjs  # print/
```

**이걸 건너뛰면 `test/bundle.test.js` · `test/bundle-scanner.test.js` ·
`test/finder-editor.test.js` 3건이 빨강이다** (바이트 동일 동기화 검사). 위 명령을 돌리면
전부 초록이 된다 — 확인했다.

> `tools/build-single.mjs` · `tools/build-finder-editor.mjs` 의 `MODULE_ORDER` 수정은
> **패치에 들어 있다.** 안 넣었으면 `assertTopologicalOrder` 가 «MODULE_ORDER 에 없는
> 모듈» 로 빌드를 죽인다 — 실제로 그렇게 잡혔다. `build-scanner.mjs` 는 import 를 훑어
> Kahn 정렬을 만들므로 손댈 게 없다.

### 9.3 측정 스크립트 (전부 `test/output/lanes/`)

| 파일 | 하는 일 |
|---|---|
| `claude-di-accounting.mjs` / `.out.txt` | **구현 전** 회계 독립 재계산 → 브리프 §2 표 대조 (exit 0 = 일치) |
| `claude-di-gen-finder.mjs` | 정본 JSON → `finder-daehan.js` 데이터 블록 생성 (손 전사 안 함) |
| `claude-di-roundtrip.mjs` / `.json` / `.out.txt` | **왕복 18/18** (회계 9 + 광학 9) |
| `claude-di-nesting.mjs` / `.out.txt` | 포함 사슬 계량 — patternId 가 k 를 못 말하는 이유 |
| `claude-di-misread.mjs` / `.json` / `.out.txt` | **§4 formatIndex 조사** — 45조합 오독 시험 |
| `claude-di-lineup-risk.mjs` / `.json` / `.out.txt` | 라인업 편성 위험 — 14후보 × 씨앗 3 × 라인업 2 |
| `claude-di-cost.mjs` / `.out.txt` | 발자국 추가 비용 (×16.64) |
| `claude-di-regress.mjs` | 회귀 3종 → JSON (패치 전/후 각각 실행) |
| `claude-di-regress.before.json` / `.after.json` | 그 산출물 |
| `claude-di-regress-diff.mjs` / `.out.txt` | 전수 대조 (exit 0 = 차이 0) |
| `claude-di-debug.mjs` | 광학 왕복 실패 지점 진단 (개발용) |

실행 CWD 는 전부 `TLcube` 저장소 루트다. `claude-di-accounting.mjs` 는 **패치를 안 댄
소스**에서 돈다. 나머지는 패치 적용 상태에서 돈다.

---

## 10. 내가 틀렸다가 고친 것

1. **결과를 안 보고 8분을 기다렸다 — 제일 큰 낭비.**
   광학 왕복 첫 실행이 안 끝나길래 «무거운가 보다» 하고 계속 기다렸다. 나중에 찍어 보니
   프레임이 **20870×18720** 이었다 — `buildScene({cellSize: 26})` 에 `rasterize` 기본
   `pixelsPerUnit: 24` 를 곱해 놓고 «셀 26px» 이라고 생각한 것이다. 기존 레인들은 전부
   `cellSize` 를 기본값(1)으로 두고 `pixelsPerUnit` 으로 크기를 준다.
   → **오래 걸리면 기다리지 말고 크기부터 찍어라.** 고친 뒤 같은 일이 803×720 에서 돈다.

2. **patternId 가 k 를 말한다고 배선했다 — k=8·k=10 이 전부 죽었다.**
   `oak-daehan-k6/k8/k10` 으로 id 를 나눠 두면 «검출 결과가 곧 k 가설» 이 된다고
   주석까지 써 놨는데, 잘림이 포함 사슬이라 k=8 프레임을 k6 템플릿이 상관 1.000000 으로
   맞힌다 (§3). `frontend:no-format-candidate` 5건이 그 결과였다.
   → 브리프 §4 ⓑ 계약 그대로 «파인더는 daehan 여부만, k 는 RS/CRC» 로 고쳤다.
   **브리프가 지정한 계약이 내 «더 똑똑한» 배선보다 옳았다.**

3. **죽은 코드에 «이게 막는다» 는 주석을 달았다.**
   ②를 고치려고 `scoreBest`/`scoreAll` 에 「동률이면 발자국 큰 쪽이 이긴다」 타이브레이크를
   넣고, 근거·레거시 무영향까지 20줄짜리 주석으로 적었다. 돌려 보니 **한 칸도 안 바뀐다** —
   순위 키 `fit` 에 contrastRatio 가 섞여 있어 정확한 동률이 애초에 안 나오기 때문이다.
   → **되돌렸다.** 패치에 그 변경은 없다. 「이 검사가 막는다」고 써 놓고 안 막으면,
   그 거짓말이 나중에 진짜 결함을 통과시킨다.

4. **테스트에 내가 만든 문턱을 붙여 놓고 다른 것을 쟀다.**
   광학 테스트에 `correlation >= 0.99` 를 넣었더니 k=6 이 0.9559 로 떨어졌다. 재 보니
   **같은 k=6 프레임이 페이로드에 따라 1.0000 과 0.9559 를 오간다** — 데이터 셀이 바뀌면
   휘도 분포가 바뀌고 척도 탐색이 다른 데 선다. 이 편입이 만든 성질이 아니라 씨앗·척도
   탐색의 기존 성질이다. 0.99 를 단언했으면 **다른 것을 재는 테스트가 초록/빨강을 오간다.**
   → 문턱을 0.9 로 내리고 **왜 0.99 가 아닌지를 주석에 값과 함께** 적었다. 강한 주장
   («원문까지 돌아온다»)은 결정적인 ⑦ 로 옮겼다.

5. **오수용을 씨앗 정책 한 값으로 단정할 뻔했다.**
   첫 프로브에서 `tristar-refined-h3` 프레임이 라인업 17 에서 `oak-daehan-k6` 으로
   뽑히는 것을 보고 «daehan 은 레거시를 잡아먹는다» 로 적으려 했다. 씨앗 축을 갈라
   다시 재니 **참 척도 씨앗을 주면 피해가 0** 이다 (§5.1 S-a). 크기가 4배 부풀 뻔했고,
   무엇보다 **원인이 «daehan 템플릿» 이 아니라 «척도를 모르는 상태»** 라는 게 안 보였다.
   → 씨앗 3정책 × 라인업 2 전수로 다시 그렸다. 판정(옵트인)은 같지만 **근거가 정확해졌다.**

6. **빌드 생성물을 잊었다.**
   `src/` 에 파일을 더하면 단일 HTML 번들의 `MODULE_ORDER` 에 등록해야 하고 8개 생성물을
   다시 구워야 한다. 스위트가 «MODULE_ORDER 에 없는 모듈» 로 잡아 줬다 — 그대로 뒀으면
   **브라우저에서만 터졌을** 자리다.

---

## 11. 못 푼 것 · 다음 라운드로

1. **daehan 이 기본 라인업에 못 올라간다** (§5). 이게 이 라운드의 blocker 이고,
   풀리려면 «발자국 크기가 다른 후보를 가르는 검사» + «계단 편성» 이 필요하다.
2. **daehan 실사진이 0장이다.** §4 의 오독 시험은 전부 무잡음 합성 digit 이다.
   실기기 사진이 생기면 §4 와 §5.1 을 **둘 다** 다시 그려야 한다.
3. **`markerO.js` 의 `capacityForOMarker` 사본을 안 정리했다.** `capacityFor` 가
   이제 표를 주입받으므로 그 사본은 지울 수 있지만, 이 라운드 범위 밖이라 안 건드렸다.
4. **브리프 §3 제외 항목 그대로 안 했다** — 생성기 UI(카드·용량 표시·썸네일) ·
   formatIndex 배정과 포맷 정보 배선 · SPEC 동기화.
5. **원근/기울기(skew)를 안 흔들었다.** daehan 광학 왕복은 참 자세뿐이다.
   자세 8종 스윕은 `radius10-search-report.md` §6.3 이 **패치 사본**으로 했던 것이고,
   정본 소스 + 이번 배선에서는 다시 안 쟀다.
6. **`cellSurface-block-locator.test.js` 가 560 s 를 넘긴다** (정본 트리에서도).
   이 라운드가 만든 게 아니지만 스위트 전체를 한 번에 못 돌리게 만드는 실재하는 문제다.

---

**이 레인은 `src/` 를 영구 수정하지 않았고 커밋·푸시하지 않았다. 게이트 3개는 한 값도
바꾸지 않았다. 실사진 149장을 썼고, 그 결과는 한 장도 안 바뀐다.**
