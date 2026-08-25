/**
 * cellsurface-block-detect.js — CS 파인더 블록 전용 로케이터 (마스크·실루엣 무의존).
 *
 * 강한 톤 시프트(감마·S-커브)는 전경 마스크를 침식해 실루엣 hull 을 0.5셀 이상
 * 어긋나게 하고, CS agreement 는 오정렬에 계단형이라 국소 탐색 gradient 가 없다
 * (2026-08-15 실사 207프레임 + claude-acceptance.md). 이 모듈은 실루엣을 전혀 쓰지
 * 않고 **면별 톤이 알려진 CS 파인더 블록**을 축소본에서 직접 찾아 기하를 만든다.
 *
 * 톤은 절대값이 아니라 **국소 순위/대비**로만 다룬다:
 *   · 이진화 = 스캔라인·레이 **1-D** sliding min-max 계층 규칙 (§1 주석) — 단조 톤
 *     커브·면 게인에 불변. 2-D 창은 Y-심 근방에서 세 면 섹터를 섞어 쓰지 않는다.
 *   · 패치 정합 = Pearson 상관 — 국소 아핀 톤 변화에 불변.
 *
 * 검출 서명 (정본 cellSurfaceFinal.js 에서 유도, 3면 합집합 기준 · 2026-08-16 중앙 통일):
 *   · **공유 K3 중앙** — v0(NW 3×3)·v1r2(NW 5×5)·v2r2(중앙 A = v1r2 NW 공유):
 *     어두운 육각 + 밝은 링 → 중심 통과 런렝스 [B1 D4 B1], 교차거리 비 2:3.
 *     세 패밀리의 중앙 서명이 같으므로 **중앙만으로는 패밀리를 판별하지 않는다.**
 *   · v2r2 면 T 블록 B((n−7..n−1)², QR 모티프 동심 사각): 회문 코어 (B,2D,B) = K5,
 *     교차거리 비 1:2(:3) 뒤 배경으로 열린다 → 'v2r2-corner'. 중앙에서 (n−3.5)셀.
 *   · v1r2 면 T SE 5×5: 같은 K5 코어 → 'v2r2-corner'. 중앙에서 18셀.
 *   · v0X SE 6×6 (QR 동심 사각): **3면 톤이 같아** 세 면이 각각 같은 K5 코어를 낸다 →
 *     'v2r2-corner' 가 **120° 간격 3개**, 전부 중앙에서 18셀. v1r2 는 하나뿐이라
 *     이 «사각 링 동반자» 가 같은 반경을 쓰는 두 패밀리의 판별자다 (§6 상세).
 *   · 구 v2r2 중앙(동심 육각 링 스택, 닫힌 K5 1:2:3:4)은 **소각된 디자인**이다 —
 *     'legacy-v2r2-center' 로 분류만 남기고 어떤 포즈도 세우지 않는다(차단).
 *   동심 닮은꼴 다각형의 중심 통과 교차거리 비는 방향 무관(아핀 불변)이다.
 *
 * 기하 조립 — **2차 앵커 조기 분기** (중앙 히트에서 세 패밀리 순차 시도 금지):
 *   · K3 중앙 × K5 원거리 코어 쌍의 거리 스냅(v2r2@21 17.5 · v1r2 18 · v2r2@25 21.5,
 *     ±3.2셀)이 맞으면 **앵커드 패밀리** similarity → 패치 Pearson 정합 4앵커
 *     estimateHomography4 2라운드 → 6~12 서브앵커 최소제곱 DLT 재적합.
 *     v2r2@21·v1r2 는 거리로 안 갈라진다 — 둘 다 세우고 CS 게이트가 고른다.
 *   · v0X 는 반경이 v1r2 와 같으므로(18.0) 거리 스냅에 더해 **사각 링 동반자 ≥ 1** 을
 *     시딩 게이트로 요구한다. 세 후보 코너를 각각 «면 T 먼 코너» 로 가정해 시드하고
 *     (120° 위상 3가설) 패치 Pearson 이 참 위상을 고른다.
 *   · 앵커드 포즈가 성립한 중앙은 v0 스윕 대상에서 빠진다. 앵커드 포즈가 없는
 *     중앙만 v0 경로: 30셀 전체 템플릿 회전×스케일 스윕(3°×4 → 0.75°) → 4앵커
 *     정합 2라운드 → 12 서브앵커(NW·SE + NE·SW 엣지) 최소제곱 재적합.
 *     분기 조건이 «앵커 존재» 가 아니라 «앵커드 포즈 성립» 인 이유: 데이터 필드의
 *     우연한 K5 코어가 v0 검출을 죽이면 안 되기 때문.
 *
 * 부분 앵커 포즈 (§6b, 2026-08-16) — **잘림 구제의 실병목이 여기였다.**
 *   엄격 경로는 4 앵커 패치를 전부 정합해야 하고 registerPatch 는 투영점 80% 이상이
 *   프레임 안일 때만 상관을 낸다. 코너가 5% 잘리면 한 면 코너 패치가 67% 로 떨어져
 *   **참 기하가 아예 만들어지지 않는다**. 그래서 엄격 경로가 실패했고 **앵커가 실제로
 *   프레임 밖으로 나갔을 때만** 부분 완성을 연다: 관측 앵커 ≥ 2 → similarity 최소제곱
 *   (전단·뒤집힘 불가, 3점부터 과결정이라 잔차가 실재) → 빠진 앵커는 레이아웃 좌표로
 *   외삽(프레임 밖 허용) → **상대 잔차 게이트**(외삽 앵커 이동 ≤ ratio × max(관측 잔차,
 *   그 라운드 탐색 반경), 전부 셀 단위 — 절대 픽셀 금지). 정합 상관 문턱과 하류 CS
 *   게이트(0.78/0.035)는 **한 값도 완화하지 않는다**.
 *
 * 결정성: RNG 없음, 모든 순회·정렬 고정 순서, 동점은 (score desc, y, x) 으로 깬다.
 * 노출: cube-detect 의 lab 경로(enableCellSurfaceY)에서만 호출된다. 산출 shape 는
 * cellSurfaceOnly=true 라 셀 표면 평가만 받는다 — 수용은 기존 CS 게이트가 결정한다.
 *
 * 모든 임계값은 합성 실험용 [미검증]이며 options.calibration.csBlockLocator 로 덮을 수 있다.
 */

import { CORNER_UNIT_OFFSETS } from '../hexgrid.js';
import { faceBasis, moduleCenter } from '../ygrid.js';
import {
  CENTER_QR_SLOT_CELLS,
  blocksCellSurfaceFinalForN,
  centerQrFinderCoreCells, centerQrQuietFrameCells, centerQrSlotCellsFor,
  centerQrSlotOriginFor, centerQrSlotPlacementFor,
  locatorCellsCellSurfaceFinal,
} from '../cellSurfaceFinal.js';

/** 슬롯 원점의 기본값 (Y-심 앵커) — v0xq·v0wq 가 쓴다. */
const ZERO_SLOT_ORIGIN = Object.freeze({ i: 0, j: 0 });
import { estimateHomography4, projectPoint } from './homography.js';
import { downsampleLumaForSeed, otsuThreshold } from './finder-seed.js';

export const UNVERIFIED_CS_BLOCK_LOCATOR = Object.freeze({
  searchMaxSide: 480,
  minimumCoreUnitPx: 1.2,
  minimumClusterSupport: 2,
  maximumVerifiedPerKind: 80,
  maximumPosesPerFamily: 2,
  minimumRayPass: 6,
  minimumPatchCorrelation: 0.25,
  registrationRangeCells: 1.25,
  registrationStepCells: 0.25,
  registrationRange2Cells: 0.5,
  registrationStep2Cells: 0.125,
  v0RotationStepDeg: 3,
  v0RotationRefineDeg: 0.75,
  // ── 실험판 드랍 (운영자 확정 2026-08-16) — 차단이지 삭제가 아니다 ──────────
  // v2r2 패밀리 (중앙 K3 + 원거리 K5 앵커, n=21/25). **기본 off.**
  // 근거: `test/output/claude-skew-real.md` §P6 — 실사 프레임에서 전 레이아웃 평가
  // 32,595회 중 v2r2 가 15,450회(47.4 %)를 먹고 **수용 0회**. 그 문서가 남긴 미실시
  // 항목(«v2r2 를 끈 런의 프레임 시간을 재라»)이 이 스위치다.
  // true 로 켜면 드랍 전 기준선·교차 오수용 대조군이 그대로 돌아온다.
  v2r2Family: false,
  // v1r2 패밀리 (n=21 A/B 후보). **기본 off** (같은 드랍).
  // v0X 와 코어 반경이 같아(18.0셀) 거리로 안 갈라지고, 쌍마다 refinePose 를 한 번
  // 더 태우기만 했다. true 로 켜면 A/B 대조군이 돌아온다.
  v1r2Family: false,
  // ── v0X 드랍 (운영자 실기기 확정 2026-08-17, 판정 3라운드) — 차단·비삭제 ──────
  // v0X 패밀리. **기본 off.**
  // 근거: 실기기 관측 「파인더 인식 다 해놓고도 잘 못 읽음」 + 「v0 과 혼선 자주」.
  // 앞 줄이 이 스위치가 사는 층을 정확히 가리킨다 — **포즈는 서는데 하류가 못 넘긴다**
  // 는 뜻이라, 절감분은 «코너/중앙 재탐색» 이 아니라 **(중앙, 코너) 쌍마다 붙던
  // refinePose 한 벌 + 그 포즈가 끌고 가는 CS 평가 한 벌**이다 (v0XQ 드랍과 같은 회계).
  // true 로 켜면 드랍 전 기준선·교차 오수용 대조군이 그대로 돌아온다
  // (`cellSurfaceFinal.js` §CELL_SURFACE_FINAL_DROPPED_IDS — 같은 규약).
  //
  // ⚠ **v0W·v0W2 는 이 스위치에 딸려 내려가지 않는다.** 셋은 같은 (중앙, 코너) 쌍을
  // 보지만 `assembleAnchoredPoses` 안에서 **서로 독립한 `if`** 다 — v0X 게이트 실패가
  // 뒤 브랜치를 자르던 `continue` 는 2026-08-16 에 이미 걷어냈다. `v0xFamily: false`
  // 는 그 세 블록 중 첫 번째만 건너뛴다.
  // ⚠ **정본 배열은 한 줄도 안 내려간다.** `V0X_CELLS`(SE 톤)는 **활성 레이아웃
  // v0W2 의 SE(T/L) 유도 원천**이고 `V0XQ_CORNER_CELLS`(= v0X SE 평행이동)는
  // v0W·v0WQ·v0W2 의 NE **그 자체**다 (참조 동일성 자기검증이 매 로드 증명한다).
  v0xFamily: false,
  // v0X 시딩 게이트 — 사각 링 동반자(120° 회전 위치의 다른 K5 코어)를 요구한다.
  // false 면 반경 스냅만으로 시드한다(게이트 실패 모드 비교용).
  v0xRequireSquareRing: true,
  // 사각 링 동반자 판정 허용폭 — 반경 비 ±18% · 120° 에서 ±18°.
  squareRingRadiusTolerance: 0.18,
  squareRingAngleToleranceDeg: 18,
  // ── v0W 계열 전체 드랍 (운영자 확정 2026-08-17, v0T 편입 라운드) — 차단·비삭제 ──
  // v0T 가 **Type Y 최종 파인더**로 확정되면서 v0W 계열 넷(v0w·v0wq·v0w2·v0wy)이
  // 라인업에서 내려갔다. 넷의 스위치는 **서로 독립**이다 — 하나만 true 로 켜면 그
  // 패밀리의 드랍 전 검출이 그대로 돌아온다 (교차 오수용 대조군·법의학·발행분 판독.
  // `cellSurfaceFinal.js` §CELL_SURFACE_FINAL_DROPPED_IDS — v2r2·v1r2·v0xq·v0x 와
  // 같은 규약). CS 평가 쪽 짝은 `includeDroppedCellSurfaceLayouts` 다.
  //
  // ⚠ **v0w 를 끄는 것은 v0t 를 끄는 것이 아니다** — v0T 는 NE 동심 사각(같은 배열)
  // 과 SE 마커(V0W_PHASE_CELLS 같은 배열)를 공유하지만 앵커드 순회에서 서로 독립한
  // `if` 다 (v0X ↔ v0W 드랍에서 고정한 것과 같은 독립성).
  // v0W 패밀리 (n=21, 2026-08-16 편입 → 2026-08-17 드랍). **기본 off.**
  v0wFamily: false,
  // v0W 시딩 게이트 — v0X 와 **같은 사각 링 동반자 조건**이다. v0W 의 NE 동심 사각도
  // 3면 동일이라 120° 쌍둥이 코어를 내기 때문이다. false 면 반경 스냅만으로 시드한다.
  v0wRequireSquareRing: true,
  // v0W2 패밀리 (v0W 파생 ② — SE 6×6 대형 마커, 2026-08-17 편입 → 같은 날 v0T 편입
  // 라운드에 드랍). **기본 off** (위 §v0W 계열 전체 드랍).
  //
  // ⚠ **v0W 와 코어 반경(√279)·NE 동심 사각이 같다** — 같은 배열·같은 자리라
  // 거리로도, 사각 링 게이트로도 안 갈라진다. 두 패밀리는 서로의 프레임에서 서로
  // 시드된다 (v0X ↔ v0W 와 같은 구조). 가르는 것은 (a) 패치 Pearson — v0W2 는
  // 중앙이 3면 대칭이고 SE 서브앵커가 6×6 이라 v0W 의 3×3 과 겹치는 자리가
  // 다르다 (b) 손대지 않은 CS 게이트(0.78 · 0.035) 다.
  v0w2Family: false,
  // v0W2 시딩 게이트 — v0X·v0W 와 **같은 사각 링 동반자 조건**. v0W2 의 NE 도
  // 3면 동일 동심 사각이라 120° 쌍둥이 코어를 낸다.
  v0w2RequireSquareRing: true,
  // v0WY 패밀리 (v0W 파생 ③ — **먼 코너 QR 슬롯**, 운영자 재설계 2026-08-17 →
  // 같은 날 v0T 편입 라운드에 드랍). **기본 off** (위 §v0W 계열 전체 드랍).
  //
  // ⚠ **이 레인의 최대 지뢰가 여기다.** v0WY 는 중앙 K3 도 NE 동심 사각도 v0W 와
  // **같은 배열·같은 자리**라, 시드 기하가 v0W 와 문자 그대로 동일하다 (반경 √279 ·
  // 사각 링 동반자 조건 · 앵커 방향 −141.1° 전부 같다). v0W2 는 최소한 중앙이
  // 3면 대칭이라는 차이라도 있었지만 v0WY 는 그것조차 없다.
  // 갈라내는 것은 셋이다:
  //   ⓐ 위상 마커 자리 — v0W 는 SE 9셀, v0WY 는 **SW 6셀**. 서로의 프레임에서
  //      그 자리는 데이터라 refinePose 의 Pearson 서브앵커가 어긋난다.
  //   ⓑ 먼 코너 [13,20]² — v0W 는 데이터 + SE 마커, v0WY 는 **QR 슬롯**.
  //   ⓒ 하류 CS 수용 게이트 (0.78 · 0.035) — **무접촉**.
  // ⓑ 를 Pearson 에만 맡기지 않고 **직접** 재는 것이 아래 `v0wyRequireSlotQr` 다.
  v0wyFamily: false,
  // v0WY 시딩 게이트 ① — v0X·v0W·v0W2 와 **같은 사각 링 동반자 조건**.
  v0wyRequireSquareRing: true,
  // v0WY 시딩 게이트 ② — **봉합 ② (QR 다움 판별) 인프라를 코너 슬롯에 재사용**한다.
  v0wyRequireSlotQr: true,
  // refinePose 가 통과한 포즈에서 먼 코너 QR 패치를 다시 정합하고, 파인더 암코어
  // 3점이 콰이어트 프레임보다 충분히 어두운지를 패치 자신의 동적 범위로 정규화해
  // 잰다 (`centreQrFinderContrast` — **한 줄도 안 고쳤다**).
  //
  // 왜 refinePose **뒤**인가: 봉합 ②는 시드 H 에서 «가짜 삼중점» 을 미리 자르는
  // 사전 게이트였다. 여기서는 시드 기하가 v0W 와 같아 사전에 자를 것이 없고
  // (자르면 v0W 시드까지 같이 죽는다), 값이 나오는 자리는 «refinePose 를 통과한
  // v0W 프레임의 v0WY 포즈» 다. 그 포즈를 CS 평가(3방향 × n² 표본) 전에 떨구는 것이
  // 절감이자 교차 차단이다.
  //
  // 문턱은 **새 키**다 — 봉합 ②의 `centreQrMinFinderContrast`(0.6) 를 건드리지
  // 않는다 (배제 목록). 값은 같은 0.6 이지만 근거는 이 레인의 자체 실측이다
  // (`test/output/lanes/claude-v0wy-probe.mjs` §③).
  v0wySlotQrMinContrast: 0.6,
  // v0WY 확증 프로브의 상관 하한 — 봉합 ②의 **호출부 패턴을 마저 가져온다**
  // (2026-08-17 결함 B 수리). 원 호출부(§assembleCentreQrPoses)는 registerPatch
  // 프로브를 상관 하한(0.25)으로 게이트한 **뒤에야** contrast 를 읽는데, v0WY
  // 재사용은 그 게이트를 빠뜨렸다. 그래서 빈 슬롯(무늬가 없어 Pearson 이 설 자리가
  // 없다)에서 프로브가 상관 0.15\~0.17 짜리 쓰레기 offset(탐색 격자 모서리 +7.5px)을
  // 물어 오고, 그 어긋난 자리에서 span(p95−p5)이 0.056 으로 무너져 contrast 가
  // 2.06 으로 폭발했다 — 정답 H 위의 contrast 는 0.0000 인데 게이트는 다른 H 를
  // 보고 있었다 (`test/output/lanes/claude-slotqr-probe.out.txt` 실측).
  // 정합이 서지 않은 자리의 contrast 는 판별이 아니다 — 거절한다.
  //
  // 문턱은 **새 키**다 — 봉합 ②의 `v0xqCentreMinCorrelation`(0.25) 을 건드리지
  // 않는다 (`v0wySlotQrMinContrast` 와 같은 규약). 값 0.25 는 원 게이트와 같고,
  // 방향은 엄격화뿐이다 (이 조건으로 새로 통과하는 것은 없다). 진짜 QR 의 실측
  // 프로브 상관은 0.9996 이라 3.99× 여유다 (톤 사다리 전체에서 ≥ 0.9968).
  v0wySlotQrMinCorrelation: 0.25,
  // v0WY 확증 조건 ③ — **span 상응성** (2026-08-17 결함 B 수리 ②/②).
  //
  // 상관 하한만으로는 안 닫힌다: Pearson 도 contrast 도 **눈금 없는(scale-free)** 자라,
  // 무늬 없는 슬롯(구멍·단색)의 **면 게인 음영 잔재**(진폭 0.1 급 기울기)가 회전 위상
  // 후보에서 상관 0.25\~0.59 를 만들고, 무너진 span(p95−p5 ≈ 0.04\~0.06) 이 contrast 를
  // 1.67\~2.58 로 폭발시킨다 — 소스가 봉합 ② 설계에서 경고한 바로 그 실패 모드
  // («상관은 사실상 면 게인 음영만 잰다»)가 먼 코너 재사용에서 재발한 것이다.
  //
  // 그래서 눈금을 단다: 슬롯 패치의 동적 범위(span, 프로브 offset 위)가 **같은 포즈의
  // 중앙 K3 불스아이 패치의 동적 범위**(같은 H · 같은 프레임 · 같은 톤 커브) 에
  // 상응해야 한다. 분자·분모가 같은 광학을 지나므로 톤 커브·노출·면 게인이 약분된다
  // (봉합 ②의 정규화와 같은 원리 — 무차원). QR 이 실제로 있으면 콰이어트 밝음 ↔
  // 모듈 어두움이 불스아이 명암과 같은 급이고, 빈 슬롯이면 span 이 0 으로 무너진다.
  // 실측 (`test/output/lanes/claude-slotqr-phase.out.txt`):
  //   진짜 (톤 사다리 clean·sCurve0.6·gamma0.7·gamma0.6): 비 1.1702\~1.5559
  //   빈 슬롯 위상 누수 전부:                              비 0.0536\~0.0865
  // → 문턱 0.35 (진짜 최소의 3.34× 아래 · 누수 최대의 4.05× 위).
  // ⚠ 실사진 검증은 이 체크아웃에서 불가(휘도 덤프 없음) — 통합자 확인 항목.
  v0wySlotQrMinSpanRatio: 0.35,
  // ── v0T (Type Y 최종 파인더 — 운영자 확정 2026-08-17) ─────────────────────
  // v0T 패밀리. false 로 끄면 v0T 편입 전 기준선을 잰다.
  //
  // 시드 기하는 v0W 계열과 같은 앵커드 경로다 — 중앙 K3 계보(단, 5×5 가 아니라
  // (0..3)² 16셀 대칭화본 — v0X 의 NW 와 같은 자리·같은 서명) × NE 동심 사각
  // (`V0XQ_CORNER_CELLS` 같은 배열, 반경 √279 · 앵커 방향 −141.1°). v0W 계열이
  // 드랍으로 꺼져 있어도 이 브랜치는 독립으로 돈다. 가르는 것은 refinePose 의
  // 패치 Pearson (v0T 는 A 블록 · N팔 · W 블록 · SE 마커가 더 있다 — 면당 104점)
  // 과 하류 CS 게이트 (0.78 · 0.035, **무접촉**) 다.
  v0tFamily: true,
  // v0T 시딩 게이트 — v0X·v0W 계열과 **같은 사각 링 동반자 조건** (NE 가 3면 동일
  // 동심 사각이라 120° 쌍둥이 코어를 낸다). false 면 반경 스냅만으로 시드한다.
  v0tRequireSquareRing: true,
  // v0TY 패밀리 (v0T 파생 — **먼 코너 QR 슬롯**, 운영자 확정 2026-08-17).
  // false 로 끄면 v0TY 편입 전 기준선을 잰다.
  //
  // v0WY 와 같은 구조의 지뢰다 — 중앙·NE 가 v0T 와 같은 배열이라 시드 기하로는
  // v0T 와 안 갈라진다. 가르는 것: ⓐ SE 마커 자리 (v0T 는 R 반전 9셀 · v0TY 는
  // QR 슬롯) ⓑ A 블록은 **둘 다 있다** (의도된 비대칭 이중화 — v0WY 와 달리 위상
  // 판별자가 슬롯 밖에 남는 설계) ⓒ 하류 CS 게이트 (무접촉). ⓐ 를 Pearson 에만
  // 맡기지 않고 직접 재는 것이 슬롯 QR 확증이다 (아래 `v0tyRequireSlotQr`).
  v0tyFamily: true,
  // v0TY 시딩 게이트 ① — 위와 같은 사각 링 동반자 조건.
  v0tyRequireSquareRing: true,
  // v0TY 시딩 게이트 ② — **v0WY 의 슬롯 QR 확증을 그대로 재사용**한다
  // (`slotQrConfirmsPose` — 같은 far 앵커 · 같은 슬롯 8² · 같은 뒤집기 규약).
  // 문턱 셋(`v0wySlotQrMinContrast` 0.6 · `v0wySlotQrMinCorrelation` 0.25 ·
  // `v0wySlotQrMinSpanRatio` 0.35)은 **먼 코너 슬롯 경로의 파라미터**이지 레이아웃의
  // 파라미터가 아니므로 그대로 공유한다 (v0wq 가 v0xq* 값을 공유한 것과 같은 규약 —
  // 새 문턱 0 · 완화 0). 이 스위치는 확증 **호출 여부**만 가른다 (A/B 대조군).
  v0tyRequireSlotQr: true,
  // ── v0TR 계열 (v0T 재설계 — 운영자 2026-08-17) ────────────────────────────
  // v0TR 패밀리. false 로 끄면 v0TR 편입 전 기준선을 잰다.
  //
  // NE 동심 사각이 **둘**인 계열이다 (바깥 = v0T 와 같은 자리 √279 · 안쪽 = 그
  // (i+2, j−5) 평행이동 √129 = 11.3578). 코너 앵커는 **바깥**이고, 그것은 설계
  // 취향이 아니라 **실측이 고른 값**이다 (§V0TR_CORE_RADIUS_CELLS 에 전말):
  //   · 안쪽(11.3578)을 코너로 삼으면 `ANCHOR_SNAP_CELLS`(3.2) 밖으로 나가 계열이
  //     거리로 깔끔히 갈릴 «뻔했다». 그런데 실물 프레임에서 안쪽 코어는 **엄격
  //     코너로 검증되지 않아**(바깥 사각과 맞닿아 «배경으로 열린다» 가 안 선다)
  //     v0TR 자기 프레임의 포즈가 0 이 됐다 (`claude-v0tr-detect-debug.mjs`).
  //   · 합집합 68셀의 무게중심(13.9374)은 **어느 암코어와도 안 맞는다** — 그걸로
  //     시드하면 스케일이 1.20배 틀어진다 (그래서 합집합도 코너 앵커가 아니다).
  // 안쪽 사각 36셀은 **서브앵커 패치**로 쓴다 — v0T 프레임에서 그 자리는 데이터라
  // 두 계열을 가르는 Pearson 신호가 바로 여기다 (면당 36점).
  v0trFamily: true,
  // v0TR 시딩 게이트 — v0X·v0W 계열·v0T 와 **같은 사각 링 동반자 조건**.
  // 안쪽 동심 사각도 3면 동일이라 120° 쌍둥이 코어를 낸다 (정준 실측: 반경 3개 동일 ·
  // 각 −127.6°/112.4°/−7.6° · 이웃 각차 120.0°). false 면 반경 스냅만으로 시드한다.
  v0trRequireSquareRing: true,
  // v0TRQ 패밀리 (v0TR 파생 — **중앙 QR 슬롯**). false 로 끄면 편입 전 기준선을 잰다.
  //
  // 중앙에 불스아이가 **없으므로**(슬롯) 앵커드 경로가 성립하지 않는다 —
  // v0xq·v0wq 와 같은 **코너 삼중점** 경로를 탄다 (`assembleV0trqPoses`).
  // 그 경로의 튜닝값(`v0xqTriple*` · `v0xqCentreMinCorrelation` · 봉합 ①②)은
  // «코너 삼중점 경로» 의 파라미터이지 레이아웃의 파라미터가 아니므로 **그대로
  // 공유한다** (v0wq 가 v0xq* 를 공유한 것과 같은 규약 — 새 문턱 0 · 완화 0).
  v0trqFamily: true,
  // v0TRQ 코너 후보 예산 — **게이트가 아니라 후보 수**다.
  //
  // 기존 삼중점 소비자(v0xq·v0wq·불스아이 확증)는 코너를 `slice(0, 4)` 로 받는다.
  // 그 4 는 «면당 동심 사각이 하나» 라는 전제 위의 값이다 (3면 + 여유 1). v0TR 계열은
  // 면당 **둘**이라 참 코너만 6개가 뜨고, 상위 4개가 두 반경으로 섞이면 «내 반경» 의
  // 삼중점이 구조적으로 못 선다. 그래서 이 패밀리에만 6 을 준다.
  // 다른 패밀리의 슬라이스는 **한 자리도 안 건드린다** (그쪽 비용·거동 불변).
  v0trqCornerBudget: 6,
  // v0TRY 패밀리 (v0TR 파생 — **먼 코너 QR 슬롯**, 운영자 2026-08-18).
  // false 로 끄면 v0TRY 편입 전 기준선을 잰다.
  //
  // v0T → v0TY 와 같은 변형이라 같은 구조의 지뢰다 — 중앙·NE 가 v0TR 과 같은 배열이라
  // 시드 기하로는 v0TR 과 안 갈라진다 (코어 반경도 √279 로 **동일** — 슬롯이 SE 쪽이라
  // NE 코너가 안 움직인다). 가르는 것: ⓐ SE 마커 자리 (v0TR 은 R 반전 9셀 · v0TRY 는
  // QR 슬롯) ⓑ A 블록은 **둘 다 있다** (v0TY 와 같은 이중화 — 위상 판별자가 슬롯 밖에
  // 남는 설계) ⓒ 하류 CS 게이트 (무접촉). ⓐ 를 Pearson 에만 맡기지 않고 직접 재는 것이
  // 슬롯 QR 확증이다 (아래 `v0tryRequireSlotQr`).
  v0tryFamily: true,
  // v0TRY 시딩 게이트 ① — v0TR 과 같은 사각 링 동반자 조건.
  v0tryRequireSquareRing: true,
  // v0TRY 시딩 게이트 ② — **v0WY·v0TY 의 슬롯 QR 확증을 그대로 재사용**한다
  // (`slotQrConfirmsPose` — 같은 far 앵커 · 같은 슬롯 8² · 같은 뒤집기 규약).
  // 문턱 셋(`v0wySlotQrMinContrast` 0.6 · `v0wySlotQrMinCorrelation` 0.25 ·
  // `v0wySlotQrMinSpanRatio` 0.35)은 **먼 코너 슬롯 경로의 파라미터**이므로 그대로
  // 공유한다 (새 문턱 0 · 완화 0). 이 스위치는 확증 **호출 여부**만 가른다.
  v0tryRequireSlotQr: true,
  // ── v0XQ 드랍 (운영자 실기기 확정 2026-08-17) — 차단이지 삭제가 아니다 ──────
  // v0xq 패밀리 (중앙 QR 변형). **기본 off.**
  // 근거: 실기기 인식 순위 v0WQ ≫ v0XQ > v0X ≈ v0W — v0W 편입 때 걸어 둔 조건부
  // 드랍 규칙 «v0WQ > v0XQ» 가 성립했다. 두 레이아웃은 같은 문법의 대조 실험이라
  // (중앙 QR 슬롯 × 같은 동심 사각, 위상 마커만 다르다) 진 쪽을 라인업에서 내린다.
  // true 로 켜면 드랍 전 기준선·교차 오수용 대조군이 그대로 돌아온다
  // (`cellSurfaceFinal.js` §CELL_SURFACE_FINAL_DROPPED_IDS — 같은 규약).
  //
  // ⚠ **v0wq 는 이 스위치에 딸려 내려가지 않는다.** 아래 코너 수집 게이트가
  // `(cfg.v0xqFamily !== false || cfg.v0wqFamily !== false)` 라 한쪽만 꺼도
  // `verifyV0xqCornerCluster` 순회가 그대로 돌고, 삼중점 조립만 v0xq 쪽이 빈다.
  // 즉 **드랍의 절감분은 «코너 재탐색» 이 아니라 «삼중점당 중앙 게이트 +
  // refinePose 한 벌»** 이다 — 벤치가 재는 것이 그 값이다 (v0WQ 편입 비용의 역).
  v0xqFamily: false,
  // v0wq 패밀리 (v0W 파생 — 중앙 QR 슬롯, 2026-08-17 v0T 편입 라운드에 드랍).
  // **기본 off** (위 §v0W 계열 전체 드랍).
  //
  // ⚠ v0wq 는 **코너 블록·코어 반경·중앙 QR 게이트가 v0xq 와 같다** (동심 사각이
  // 같은 배열·같은 자리, 슬롯도 같은 NW 사분면). 그래서 아래 v0xq* 튜닝값을
  // **그대로 공유한다** — 그 값들이 «코너 삼중점 경로» 의 파라미터이지 레이아웃의
  // 파라미터가 아니기 때문이다. 두 레이아웃을 가르는 것은 위상 마커 패치와
  // 하류 CS 게이트다 (v0X ↔ v0W 와 같은 구조).
  // ⚠ v0xq·v0wq 가 둘 다 꺼져도 **코너 수집(§v0xqCorners)은 돈다** —
  // `centreBullseyeConfirmedPoses` 가 같은 코너 목록을 쓰기 때문이다 (게이트 참조).
  v0wqFamily: false,
  // v0xq 시딩 게이트 — 시드 H 에서 **중앙 QR 블록 패치**가 먼저 정합돼야 한다.
  // v0xq 는 K3 중앙이 없어 코너 삼중점만으로 시드되므로, 이 게이트가 없으면
  // v0X·v1r2·v2r2 의 K5 코너 삼중점이 v0xq 후보로 새어 들어온다.
  // false 면 삼중점 기하만으로 시드한다(게이트 효과 대조군).
  //
  // ⚠ **실효는 정확도가 아니라 비용이다** — 단, 그 이유는 «refinePose 가 거르기
  // 때문» 이 **아니다** (2026-08-16 통합 리허설 재측정, ppu15 · rot0/120 ·
  // 톤 채널 5종 × 2·3톤 20 프레임, `test/output/_v0xq-gate2.mjs`):
  //   · v0X **2톤** 프레임에서는 켜든 끄든 v0xq 포즈 0 이다. 여기서는 시드가
  //     refinePose 를 못 넘는다 — 위 문장이 참인 유일한 구간이고, 아래 대조군
  //     테스트의 기본 프레임이 여기 속한다.
  //   · v0X **3톤 + 톤 열화**(gamma 0.7/0.6 · sCurve 0.6/0.9, rot0)에서는
  //     **v0xq 포즈가 실제로 선다** — 그리고 **ON/OFF 가 프레임마다 한 자리도
  //     같다** (20 프레임 전부 onPose === offPose). 즉 이 구간에서 게이트는
  //     «살아남는 포즈» 를 한 개도 자르지 못한다. poseCount 는 refinePose 를
  //     **통과한 뒤** 증가하므로 refinePose 도 거르지 않는다.
  //   · 그 포즈를 실제로 막는 단계는 하류 **CS 수용 게이트**
  //     (`cellSurfaceY-detect.js` minimumAgreement 0.78 · minimumOrientationMargin
  //     0.035)다 — 교차 오수용 0 은 거기서 나온다.
  // 그래서 이 게이트의 실효는 여전히 «막을 것을 더 싸게 막는다» 이지만, 막는
  // 주체는 refinePose 가 아니라 CS 수용 게이트다. 대조군 테스트
  // cellSurface-block-locator-v0xq.test.js «v0xq 시딩 게이트» 가 두 구간을 함께 고정한다.
  v0xqRequireCenterQr: true,
  // 중앙 QR 블록 패치 사전 게이트의 상관 하한. refinePose 안의
  // minimumPatchCorrelation(0.25)과 **같은 값** — 사전 게이트가 사후 판정보다
  // 느슨하지도 엄격하지도 않게 둔다 (게이트 완화 0 · 비용만 앞당긴다).
  v0xqCentreMinCorrelation: 0.25,
  // 코너 삼중점 허용폭 — 반경 비 ±18% · 120° 에서 ±18° (사각 링과 같은 자).
  v0xqTripleRadiusTolerance: 0.18,
  v0xqTripleAngleToleranceDeg: 18,
  // v0xq 코너 검증 — 링 비 계급을 만족한 레이 최소 수 (8중 5, v2r2 코너와 같은 값).
  v0xqMinimumRing2: 5,
  // v0xq 코너 검증에 훑을 k5 클러스터 상한 (count 내림차순). 참 코너는 count 50+ 라
  // 상위권에 있고, 이 상한이 «클러스터 500개 × 레이 8» 비용을 막는다.
  v0xqMaxInspectedClusters: 24,
  // ── 링 두 개 문제 (2026-08-17 v0T 오분류 규명, `_lessons/008`) ───────────────
  //
  // v0T 파인더에는 **120° 링이 두 개** 있다 — 진짜 NE 블록(r≈17.8셀)과 보조
  // 블록(ARM/W 계열, r≈13.4셀). 둘 다 3면 복제라 둘 다 코너 검증을 통과한다.
  // 코너 후보를 **점수순 상위 4** 로 먼저 자르면 두 링이 슬롯을 나눠 가져
  // 진짜 링의 세 번째 멤버가 5위로 밀린다. 그러면 사각 링 동반자 게이트가 0 을
  // 돌리고(→ 앵커드 시드 실패), 남은 조합은 전부 링 혼합이라 반경 허용폭 0.18 에서
  // 전멸한다(실측 0.20/0.54/0.65/0.66 → 확증 경로 tripleCount 전 칸 0). 포즈가
  // 하나도 안 서면 중앙이 v0 360° 스윕으로 내려가 **n=13** 이 되고 CS 평가는
  // v0 만 채점한다 — 운영자가 본 «파인더 다 잡고도 v0 으로 분류».
  //
  // 실측 확증 (`test/output/claude-v0t-misclassify.md`): 같은 게이트를 코너 **전체**
  // 에 돌리면 12칸 중 10칸에서 통과 삼중점이 나오고 **전부 5위 멤버를 필요로 한다**.
  // 정보는 있었고 자르기가 버렸다.
  //
  // 수리 방향은 «게이트 완화» 가 아니라 **«싼 필터를 캡보다 앞으로»** 다. 삼중점의
  // 기하 검사(반경비·120°·중심 불스아이)는 세 점 산술이라 사실상 공짜고, 비싼 것은
  // 그 뒤의 `refinePose` 다. 그래서 **후보 풀은 넓히고 «시딩까지 가는 삼중점 수» 를
  // 캡한다** — 비용 지평(refinePose 호출 수)은 종전과 같다.
  /** 불스아이 확증 경로가 보는 느슨 코너 풀. 4 로 되돌리면 종전 동작. */
  bullseyeConfirmedCornerPool: 8,
  /** 그중 **시딩까지 가는** 삼중점 상한. 종전 유효 천장 C(4,3)=4 를 그대로 둔다. */
  bullseyeConfirmedMaxTriples: 4,
  /**
   * 사각 링 동반자 게이트가 **잘리지 않은** 엄격 코너 목록을 본다. 이 게이트는
   * 순수 산술이라(«같은 반경의 120° 쌍둥이가 있나») 목록을 넓혀도 refinePose 는
   * 한 번도 늘지 않는다 — 늘어나는 것은 «증거가 있다» 판정뿐이고, 수용은 여전히
   * 하류 CS 게이트(agreement 0.78 · margin 0.035)가 한다. false 면 종전 동작.
   */
  squareRingUsesFullCornerPool: true,
  // ── 교차 누수 봉합 (2026-08-17) — «가짜 후보를 더 잘 거른다» 방향 ──────────
  //
  // 왜 필요한가 (실측, `test/output/claude-v0w2-program.md` §21\~§22):
  // 코너 동심 사각은 v0X·v0W·v0W2·v0XQ·v0WQ 가 **문자 그대로 같은 셀**을 쓴다
  // (`V0W_BLOCKS.NE === V0XQ_BLOCKS.CORNER === V0WQ_BLOCKS.CORNER === V0W2_BLOCKS.NE`).
  // 그래서 불스아이 중앙 레이아웃의 프레임에서도 120° 삼중점이 그대로 서고, 위
  // `v0xqRequireCenterQr` 상관 게이트(0.25)는 그것을 **못 자른다** — 잰 값:
  //   진짜 v0WQ 프레임 상관 0.9996\~0.9999 / 가짜(v0X·v0W 3톤) 0.28\~0.42.
  // 게이트가 실제로 재는 것은 «QR 다움» 이 아니라 **면 게인 음영**(T 밝음 대 L·R
  // 어두움)이라 큐브면 무엇이든 통과한다. 48칸 중 18칸이 가짜인데 통과했다.
  //
  // 아래 둘은 **문턱을 내리지 않는다** — 가짜만 떨어뜨리는 방향의 **추가** 조건이고,
  // 보호 게이트 5종(agreement 0.78 · orientationMargin 0.035 · CRC · RS · 인코더 정합)
  // 에는 닿지 않는다. 각각 false 로 끄면 봉합 전 세계가 그대로 돌아온다 (A/B 대조군).
  //
  // ① **중앙 불스아이 거부권** — 코너 삼중점의 무게중심에 **이미 검증된 K3 불스아이**
  //    (`verifyV0Cluster` 의 `v0-center`)가 앉아 있으면 그 중앙은 QR 슬롯이 아니다.
  //    소스가 이미 그렇게 선언해 놓고(§V0XQ_CORE_RADIUS_CELLS 주석 «가르는 것은
  //    중앙이다 — v0xq 만 중앙이 QR 이고 나머지는 K3 불스아이다») 구현하지 않았던
  //    조건이다. 값은 **삼중점 반경 R 로 정규화**한 거리 (실측 256칸):
  //      가짜 0.000\~0.054 · 진짜 0.108\~1.000 → 문턱 0.075 (양쪽 \~1.4× 여유).
  //    비용 0 — centres 는 이미 계산돼 있다.
  centreQrBullseyeVeto: true,
  centreQrBullseyeVetoRadiusRatio: 0.075,
  // ② **QR 다움 판별** — 중앙 QR 패치가 정합된 자리에서 파인더 암코어 3점이
  //    콰이어트 프레임보다 얼마나 어두운지를 **패치 자신의 동적 범위(p95−p5)로
  //    정규화**해 잰다. 정규화가 톤 커브·노출·면 게인을 나눠 없앤다.
  //    실측 (검증 렌즈 정정 2026-08-17): 자기 패밀리 포즈 기준 (n=62) 진짜
  //    0.995\~1.084 · 가짜 −0.477\~0.411 → 문턱 0.60 (진짜 최소의 1.66× 아래).
  //    무필터 분포는 −0.269 까지 내려가나 그 2칸은 삼중점 0 이라 게이트가 안 울린다.
  //    (불스아이가 검출 안 된 프레임에서도 듣는다 — ① 과 같은 술어의 양면이 아니라
  //    별개 신호다. ① 과 ③ 은 같은 술어의 양면 — 참이면 둘 다, 거짓이면 둘 다 아님.)
  centreQrRequireFinderContrast: true,
  centreQrMinFinderContrast: 0.6,
  // ③ **중앙 불스아이 확증 조립** (과업 3 ③) — 같은 일치를 **인가**에 쓴다.
  //    느슨한 코너(`verifyV0xqCornerCluster`)의 120° 삼중점 중심에 검증된 K3
  //    불스아이가 앉아 있으면, 그 중앙에서 v0W·v0W2 를 시드한다 (v0X 브랜치도
  //    있지만 2026-08-17 드랍으로 `v0xFamily` 가 기본 off 라 안 돈다 — 켜면 돈다).
  //    엄격 코너가 3개 미만이라 사각 링 게이트가 **구조적으로** 0 이 되는 칸의 구제다
  //    (실측: v0W 48칸 중 자기 포즈 0 인 13칸 → 12칸이 그 게이트에서 죽었다).
  //    false 로 끄면 확증 조립 전 세계가 그대로 돌아온다.
  centreBullseyeConfirmedPoses: true,
  // ── 부분 앵커 포즈 (§7) — 프레임 밖으로 나간 앵커를 레이아웃 지식으로 외삽한다.
  // false 로 끄면 잘림 도입 전(엄격 4앵커) 기준선을 그대로 잰다.
  partialAnchorPose: true,
  // 부분 정합을 시도할 최소 in-frame 비율. 이 아래면 «관측 없음»(외삽 대상)이다.
  partialMinimumCoverage: 0.3,
  // 완성 포즈를 세우는 데 필요한 **관측된** 앵커 최소 수 (중앙 + 코너, 서로 다른 자리).
  partialMinimumAnchors: 2,
  // 라운드 3 최소제곱에 필요한 관측 서브앵커 최소 수 / 호모그래피(8dof)로 올릴 문턱.
  partialMinimumSubAnchors: 4,
  partialHomographySubAnchors: 8,
  // 외삽 앵커 이동 허용 배수 — 관측 잔차(또는 그 라운드의 탐색 반경) 대비 **상대값**.
  partialResidualRatio: 1.5,
});

const CANONICAL_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });
const YFACE_LIST = Object.freeze(['T', 'L', 'R']);
/** 면별 먼 코너 대각 단위 방향 = ei_f + ej_f (ygrid FACE_BASIS 에서 유도). */
const FACE_DIAG = Object.freeze({
  T: Object.freeze({ x: 0, y: -1 }),
  L: Object.freeze({ x: -Math.sqrt(3) / 2, y: 0.5 }),
  R: Object.freeze({ x: Math.sqrt(3) / 2, y: 0.5 }),
});
const EPSILON = 1e-9;

function calibration(options) {
  const supplied = options && options.calibration && typeof options.calibration === 'object'
    ? options.calibration
    : {};
  const overlay = supplied.csBlockLocator && typeof supplied.csBlockLocator === 'object'
    ? supplied.csBlockLocator
    : {};
  return { ...UNVERIFIED_CS_BLOCK_LOCATOR, ...overlay };
}

// ─────────────────────────────────────────────────────────────────────────
// 1. 1-D 라인 방향 min-max 혼성 이진화.
//
// 순수 국소평균 이진화는 «더 어두운 어두움» 옆에서 뒤집힌다 — 배경(Y≈0.005)과
// 심선·중앙 도트(bullseyeDark)는 level0 셀(Y≈0.06)보다 어두워, 어두운 영역 내부의
// level0 셀이 국소 평균 위로 떠 밝음으로 오분류된다. 전역 Otsu 단독도 안 된다 —
// 면 게인(R 0.52) × 강한 감마에서 저게인 면의 밝은 셀이 전역 문턱 아래로 눌린다.
// 2-D 창도 안 된다 — Y-심 근방에선 어떤 창이든 세 면 섹터를 동시에 덮어, 게인 1 면의
// 밝음이 게인 0.52 면의 밝음을 어두움으로 밀어낸다. 링 구조는 방사형이라 스캔라인·
// 레이 하나는 국소적으로 한 면만 지난다 — 그래서 이진화를 **라인 1-D** 로 한다:
// 라인 방향 sliding min/max 대비가 실하면 중간값 비교, 평탄하면 전역 Otsu.
// ─────────────────────────────────────────────────────────────────────────

/** 단조 deque O(n) sliding min/max — 반지름 radius 샘플. */
function slidingExtrema(values, count, radius, outMin, outMax) {
  const dequeMin = new Int32Array(count);
  const dequeMax = new Int32Array(count);
  let minHead = 0;
  let minTail = 0;
  let maxHead = 0;
  let maxTail = 0;
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const limit = Math.min(count - 1, index + radius);
    while (cursor <= limit) {
      const value = values[cursor];
      while (minTail > minHead && values[dequeMin[minTail - 1]] >= value) minTail -= 1;
      dequeMin[minTail] = cursor;
      minTail += 1;
      while (maxTail > maxHead && values[dequeMax[maxTail - 1]] <= value) maxTail -= 1;
      dequeMax[maxTail] = cursor;
      maxTail += 1;
      cursor += 1;
    }
    const from = index - radius;
    while (dequeMin[minHead] < from) minHead += 1;
    while (dequeMax[maxHead] < from) maxHead += 1;
    outMin[index] = values[dequeMin[minHead]];
    outMax[index] = values[dequeMax[maxHead]];
  }
}

const FLAT_CONTRAST = 0.03;
/** 창 최대가 전역 컷의 이 비율 미만이면 창 전체가 어두운 계급이다 — level0(≈0.22·cut)
 * 대 저게인 밝음(≥0.48·cut) 사이. 어두움 내부의 미세 대비(level0 vs 심선·도트·배경)가
 * 가짜 밝음을 만드는 것을 막는다. */
const ALL_DARK_RATIO = 0.4;

/** 라인 값 배열을 계층 규칙으로 어두움(1)/밝음(0) 이진화한다:
 *  ① 창 전체가 어두운 계급 → 어두움 ② 창 전체가 밝은 계급 → 밝음
 *  ③ 창이 두 계급을 걸치고 대비가 실하면 국소 중간값 비교 ④ 평탄하면 전역 Otsu. */
function binarizeSeries(values, count, radius, otsuCut, scratch) {
  const outMin = scratch.min;
  const outMax = scratch.max;
  slidingExtrema(values, count, radius, outMin, outMax);
  const cut = Number.isFinite(otsuCut) ? otsuCut : 0.5;
  const allDark = cut * ALL_DARK_RATIO;
  const binary = scratch.binary;
  for (let index = 0; index < count; index += 1) {
    const low = outMin[index];
    const high = outMax[index];
    const value = values[index];
    if (high < allDark) binary[index] = 1;
    else if (low > cut) binary[index] = 0;
    else if (high - low >= FLAT_CONTRAST) binary[index] = value < (low + high) / 2 ? 1 : 0;
    else binary[index] = value <= cut ? 1 : 0;
  }
  return binary;
}

function makeSeriesScratch(capacity) {
  return {
    values: new Float32Array(capacity),
    min: new Float32Array(capacity),
    max: new Float32Array(capacity),
    binary: new Uint8Array(capacity),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. 회문 코어 런렝스 스캔 — 4방향(행·열·대각·반대각).
// ─────────────────────────────────────────────────────────────────────────

function scanLineForCores(
  luma, startX, startY, stepX, stepY, length, stepLen, otsuCut, scratch, cfg, out,
) {
  if (length < 8) return;
  const { width, data, alpha } = luma;
  const values = scratch.values;
  for (let position = 0; position < length; position += 1) {
    const index = (startY + stepY * position) * width + (startX + stepX * position);
    values[position] = alpha && alpha[index] === 0 ? 0 : data[index];
  }
  // 이진화 창 반지름 ≈ 셀 1.3개(21px/2·stepLen) — 라인은 국소적으로 한 면만 지난다.
  const radius = Math.max(4, Math.round(10.5 / stepLen));
  const binary = binarizeSeries(values, length, radius, otsuCut, scratch);
  // 런 수집
  let runStart = 0;
  let runDark = binary[0] === 1;
  const runs = [];
  for (let position = 1; position <= length; position += 1) {
    const dark = position < length ? binary[position] === 1 : !runDark;
    if (dark === runDark) continue;
    runs.push({ start: runStart, length: position - runStart, dark: runDark });
    runDark = dark;
    runStart = position;
  }
  for (let index = 1; index + 1 < runs.length; index += 1) {
    const middle = runs[index];
    if (!middle.dark) continue;
    const before = runs[index - 1];
    const after = runs[index + 1];
    const a = before.length;
    const d = middle.length;
    const b = after.length;
    const midPosition = middle.start + d / 2;
    const px = startX + stepX * midPosition;
    const py = startY + stepY * midPosition;
    // K5: (B1, D2, B1) — v2r2 중앙·코너 앵커의 회문 코어.
    {
      const unit = (a + d + b) / 4;
      if (unit * stepLen >= cfg.minimumCoreUnitPx
        && d >= 1.35 * unit && d <= 2.7 * unit
        && a >= 0.5 * unit && a <= 1.8 * unit
        && b >= 0.5 * unit && b <= 1.8 * unit) {
        out.push({ kind: 'k5', x: px, y: py, u: unit * stepLen });
      }
    }
    // K3: (B1, D4, B1) — v0 중앙 불스아이.
    {
      const unit = (a + d + b) / 6;
      if (unit * stepLen >= Math.max(1, cfg.minimumCoreUnitPx * 0.8)
        && Math.abs(d - 4 * unit) <= 1.2 * unit
        && a >= 0.45 * unit && a <= 1.9 * unit
        && b >= 0.45 * unit && b <= 1.9 * unit) {
        out.push({ kind: 'k3', x: px, y: py, u: unit * stepLen });
      }
    }
  }
}

function scanConcentricCores(luma, otsuCut, cfg, out = []) {
  const { width, height } = luma;
  const scratch = makeSeriesScratch(Math.max(width, height));
  const stepLenDiag = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    scanLineForCores(luma, 0, y, 1, 0, width, 1, otsuCut, scratch, cfg, out);
  }
  for (let x = 0; x < width; x += 1) {
    scanLineForCores(luma, x, 0, 0, 1, height, 1, otsuCut, scratch, cfg, out);
  }
  for (let y = 0; y < height; y += 1) {
    scanLineForCores(
      luma, 0, y, 1, 1, Math.min(width, height - y), stepLenDiag, otsuCut, scratch, cfg, out,
    );
  }
  for (let x = 1; x < width; x += 1) {
    scanLineForCores(
      luma, x, 0, 1, 1, Math.min(width - x, height), stepLenDiag, otsuCut, scratch, cfg, out,
    );
  }
  for (let y = 0; y < height; y += 1) {
    scanLineForCores(
      luma, 0, y, 1, -1, Math.min(width, y + 1), stepLenDiag, otsuCut, scratch, cfg, out,
    );
  }
  for (let x = 1; x < width; x += 1) {
    scanLineForCores(
      luma, x, height - 1, 1, -1, Math.min(width - x, height), stepLenDiag, otsuCut, scratch,
      cfg, out,
    );
  }
  return out;
}

/**
 * 군집화 **선형 참조판** — 2026-08-18 격자판 이전의 원본 그대로다.
 *
 * 런타임은 쓰지 않는다. 존재 이유는 하나 — 격자판이 실사진에서 **같은 클러스터를
 * 내는지** 테스트가 직접 검산하기 위해서다. 어제 실사진 A/B(개선 13 · 회귀 0)가
 * 이 함수의 출력 위에 서 있으므로, 최적화가 결과를 한 톨이라도 바꾸면 그 검증이
 * 통째로 무효가 된다. 지우지 말 것.
 */
function clusterCoresLinear(candidates, cfg) {
  const byKind = new Map();
  for (const candidate of candidates) {
    if (!byKind.has(candidate.kind)) byKind.set(candidate.kind, []);
    byKind.get(candidate.kind).push(candidate);
  }
  const clusters = [];
  for (const kind of ['k5', 'k3']) {
    const list = byKind.get(kind) || [];
    list.sort((left, right) => left.y - right.y || left.x - right.x || left.u - right.u);
    const kindClusters = [];
    for (const candidate of list) {
      let home = null;
      for (const cluster of kindClusters) {
        if (clusterAccepts(cluster, candidate)) { home = cluster; break; }
      }
      if (!home) {
        home = { kind, count: 0, sumX: 0, sumY: 0, sumU: 0 };
        kindClusters.push(home);
      }
      home.count += 1;
      home.sumX += candidate.x;
      home.sumY += candidate.y;
      home.sumU += candidate.u;
    }
    for (const cluster of kindClusters) {
      if (cluster.count < cfg.minimumClusterSupport) continue;
      clusters.push({
        kind,
        count: cluster.count,
        x: cluster.sumX / cluster.count,
        y: cluster.sumY / cluster.count,
        u: cluster.sumU / cluster.count,
      });
    }
  }
  clusters.sort((left, right) =>
    right.count - left.count || left.y - right.y || left.x - right.x);
  return clusters;
}

/**
 * 후보 하나가 들어갈 클러스터를 찾는 술어 — 선형판과 격자판이 **같은 식**을 쓴다.
 * 둘이 갈라지면 등가가 깨지므로 여기 말고 다른 곳에서 이 조건을 쓰지 않는다.
 */
function clusterAccepts(cluster, candidate) {
  const meanX = cluster.sumX / cluster.count;
  const meanY = cluster.sumY / cluster.count;
  const meanU = cluster.sumU / cluster.count;
  // reach 는 좁게 — 데이터 필드의 이웃 우연 코어가 평균을 끌고 가지 않게 한다.
  const reach = 1.2 * Math.max(meanU, candidate.u, 2);
  const dx = candidate.x - meanX;
  const dy = candidate.y - meanY;
  // u 가 크게 다른 코어는 같은 앵커가 아니다 — 체인 스미어 방지.
  const uCompatible = candidate.u >= 0.5 * meanU && candidate.u <= 2.0 * meanU;
  return uCompatible && dx * dx + dy * dy <= reach * reach;
}

/**
 * 후보를 받을 수 있는 클러스터가 존재할 수 있는 **최대 거리**.
 *
 * u 호환 조건이 `candidate.u <= 2·meanU` 를 요구하므로 매치 가능한 클러스터는
 * `meanU >= candidate.u / 2` 이고, 동시에 `candidate.u >= 0.5·meanU` 이므로
 * `meanU <= 2·candidate.u` 다. 따라서 reach = 1.2·max(meanU, u, 2) 의 상한이
 * **후보만으로** 정해진다 — 이 사실이 격자 탐색의 정확성 근거다.
 */
function clusterSearchRadius(candidate) {
  return 1.2 * Math.max(2 * candidate.u, 2);
}

/** 격자 버킷 한 변 (축소 좌표 px). 탐색 반경 대비 너무 작으면 버킷 수가, 크면 후보 수가 는다. */
const CLUSTER_BUCKET_PX = 16;

/**
 * 코어 군집화 — **공간 격자판** (2026-08-18).
 *
 * 왜 고쳤나: 실사진 비용 프로파일(`test/output/lanes/claude-cost-profile.out.txt`)에서
 * 로케이터 시간의 **87 %** 가 이 함수였다. 후보마다 기존 클러스터를 **전부** 훑어
 * O(후보 × 클러스터) 다 — 코어 6095 → 14 ms 인데 63587 → 2570 ms 로 **초선형**
 * (코어 10.4배에 시간 183배). fps 를 막고 있던 것이 이것이다.
 *
 * ⚠ **출력은 선형판과 비트 동일해야 한다** — 어제 실사진 A/B(개선 13·회귀 0)가
 * 그 위에 서 있다. 선형판은 «삽입 순서상 처음 매치하는 클러스터» 를 고르므로
 * (`break`), 격자판도 후보 버킷 이웃에서 모은 매치 중 **삽입 인덱스가 가장 작은**
 * 것을 고른다. 두 판이 같은 술어(`clusterAccepts`)와 같은 반경 상한
 * (`clusterSearchRadius`)을 쓰고, `clusterCoresLinear` 를 INTERNALS 로 노출해
 * 테스트가 실사진에서 **동일성을 직접 검산**한다.
 */
function clusterCores(candidates, cfg) {
  const byKind = new Map();
  for (const candidate of candidates) {
    if (!byKind.has(candidate.kind)) byKind.set(candidate.kind, []);
    byKind.get(candidate.kind).push(candidate);
  }
  const clusters = [];
  for (const kind of ['k5', 'k3']) {
    const list = byKind.get(kind) || [];
    list.sort((left, right) => left.y - right.y || left.x - right.x || left.u - right.u);
    const kindClusters = [];
    // 버킷키 → 그 버킷에 mean 이 든 클러스터의 삽입 인덱스 배열.
    const buckets = new Map();
    const bucketOf = (x, y) => (Math.floor(x / CLUSTER_BUCKET_PX) * 100003)
      + Math.floor(y / CLUSTER_BUCKET_PX);
    const place = (index, x, y) => {
      const key = bucketOf(x, y);
      const slot = buckets.get(key);
      if (slot) slot.push(index); else buckets.set(key, [index]);
      return key;
    };
    for (const candidate of list) {
      const radius = clusterSearchRadius(candidate);
      // +1 은 부동소수·버킷 경계 여유다. 등가가 정확성의 전부라 인색하게 굴지 않는다.
      const span = Math.ceil(radius / CLUSTER_BUCKET_PX) + 1;
      const bx = Math.floor(candidate.x / CLUSTER_BUCKET_PX);
      const by = Math.floor(candidate.y / CLUSTER_BUCKET_PX);
      // 삽입 순서상 **처음** 매치를 고른다 — 선형판의 break 와 같은 선택.
      let bestIndex = -1;
      for (let gx = bx - span; gx <= bx + span; gx += 1) {
        for (let gy = by - span; gy <= by + span; gy += 1) {
          const slot = buckets.get((gx * 100003) + gy);
          if (!slot) continue;
          for (const index of slot) {
            if (bestIndex >= 0 && index > bestIndex) continue;
            if (clusterAccepts(kindClusters[index], candidate)) bestIndex = index;
          }
        }
      }
      let home;
      if (bestIndex >= 0) {
        home = kindClusters[bestIndex];
        // 평균이 움직이면 버킷도 옮긴다 (드물다 — reach 안에서만 흡수하므로).
        const beforeKey = home.bucketKey;
        home.count += 1;
        home.sumX += candidate.x;
        home.sumY += candidate.y;
        home.sumU += candidate.u;
        const afterKey = bucketOf(home.sumX / home.count, home.sumY / home.count);
        if (afterKey !== beforeKey) {
          const old = buckets.get(beforeKey);
          if (old) {
            const at = old.indexOf(bestIndex);
            if (at >= 0) old.splice(at, 1);
          }
          home.bucketKey = place(bestIndex, home.sumX / home.count, home.sumY / home.count);
        }
        continue;
      }
      home = { kind, count: 0, sumX: 0, sumY: 0, sumU: 0, bucketKey: 0 };
      kindClusters.push(home);
      home.bucketKey = place(kindClusters.length - 1, candidate.x, candidate.y);
      home.count += 1;
      home.sumX += candidate.x;
      home.sumY += candidate.y;
      home.sumU += candidate.u;
    }
    for (const cluster of kindClusters) {
      if (cluster.count < cfg.minimumClusterSupport) continue;
      clusters.push({
        kind,
        count: cluster.count,
        x: cluster.sumX / cluster.count,
        y: cluster.sumY / cluster.count,
        u: cluster.sumU / cluster.count,
      });
    }
  }
  clusters.sort((left, right) =>
    right.count - left.count || left.y - right.y || left.x - right.x);
  return clusters;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. 방향별 교차거리 비 검증 — 링 인덱스 비는 방향 무관(동심 닮은꼴).
// ─────────────────────────────────────────────────────────────────────────

const RAY_DIRECTIONS = Object.freeze([
  Object.freeze({ x: 1, y: 0 }), Object.freeze({ x: Math.SQRT1_2, y: Math.SQRT1_2 }),
  Object.freeze({ x: 0, y: 1 }), Object.freeze({ x: -Math.SQRT1_2, y: Math.SQRT1_2 }),
  Object.freeze({ x: -1, y: 0 }), Object.freeze({ x: -Math.SQRT1_2, y: -Math.SQRT1_2 }),
  Object.freeze({ x: 0, y: -1 }), Object.freeze({ x: Math.SQRT1_2, y: -Math.SQRT1_2 }),
]);

const RAY_STEP = 0.5;
const rayScratch = makeSeriesScratch(512);

/**
 * 레이 방향 루마를 1-D 이진화한 뒤 전이 반경을 수집한다. 레이는 방사형이라
 * 국소적으로 한 면 섹터만 지난다 — 면 게인이 섞이지 않는다.
 */
function rayTransitions(luma, otsuCut, cx, cy, dir, maxR) {
  const { width, height, data, alpha } = luma;
  const values = rayScratch.values;
  let count = 0;
  const capacity = Math.min(values.length, Math.floor(maxR / RAY_STEP) + 1);
  for (let step = 0; step < capacity; step += 1) {
    const r = step * RAY_STEP;
    const x = Math.round(cx + dir.x * r);
    const y = Math.round(cy + dir.y * r);
    if (x < 0 || y < 0 || x >= width || y >= height) break;
    const index = y * width + x;
    values[count] = alpha && alpha[index] === 0 ? 0 : data[index];
    count += 1;
  }
  if (count < 8) return { transitions: [], centerDark: false };
  const radius = Math.max(4, Math.round(10.5 / RAY_STEP));
  const binary = binarizeSeries(values, count, radius, otsuCut, rayScratch);
  const transitions = [];
  let previous = binary[0];
  let pendingValue = null;
  let pendingStep = 0;
  for (let step = 1; step < count; step += 1) {
    const value = binary[step];
    if (value === previous) {
      pendingValue = null;
      continue;
    }
    if (pendingValue === value) {
      // 2연속 확인(히스테리시스) — 픽셀 노이즈 한 점은 전이로 안 친다.
      transitions.push(pendingStep * RAY_STEP);
      previous = value;
      pendingValue = null;
      if (transitions.length >= 5) break;
    } else {
      pendingValue = value;
      pendingStep = step;
    }
  }
  return { transitions, centerDark: binary[0] === 1 };
}

/** t1 쌍(±방향)으로 중심을 재추정한다 — 2회 고정 반복. */
function recentreByRays(luma, otsuCut, cluster, maxR) {
  let cx = cluster.x;
  let cy = cluster.y;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    let shiftX = 0;
    let shiftY = 0;
    let pairs = 0;
    for (let axis = 0; axis < 4; axis += 1) {
      const forward = rayTransitions(luma, otsuCut, cx, cy, RAY_DIRECTIONS[axis], maxR);
      const backward = rayTransitions(luma, otsuCut, cx, cy, RAY_DIRECTIONS[axis + 4], maxR);
      if (forward.transitions.length === 0 || backward.transitions.length === 0) continue;
      const delta = (forward.transitions[0] - backward.transitions[0]) / 2;
      shiftX += delta * RAY_DIRECTIONS[axis].x;
      shiftY += delta * RAY_DIRECTIONS[axis].y;
      pairs += 1;
    }
    if (pairs === 0) break;
    cx += shiftX / pairs;
    cy += shiftY / pairs;
  }
  return { x: cx, y: cy };
}

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * v2r2 앵커 검증 — 심선(어두운 3선)이 레이 하나를 죽일 수 있고, 링 2 의 밝은
 * 반점·바깥 데이터 병합이 t3/t4 를 흔들므로, t1 중앙값 일관성 + 비율 계급으로 센다.
 */
function verifyV2r2Cluster(luma, otsuCut, cluster, cfg) {
  const maxR = cluster.u * 7;
  const center = recentreByRays(luma, otsuCut, cluster, maxR);
  if (Math.hypot(center.x - cluster.x, center.y - cluster.y) > 2.5 * cluster.u) return null;
  const rays = RAY_DIRECTIONS.map((dir) =>
    rayTransitions(luma, otsuCut, center.x, center.y, dir, maxR));
  if (rays.filter((ray) => ray.centerDark).length < 6) return null;
  const t1List = [];
  for (const ray of rays) {
    if (!ray.centerDark || ray.transitions.length === 0) continue;
    const t1 = ray.transitions[0];
    if (t1 >= 0.4 * cluster.u && t1 <= 2.2 * cluster.u) t1List.push(t1);
  }
  if (t1List.length < 5) return null;
  const t1Median = median(t1List);
  let full = 0;
  let ring3 = 0;
  let open = 0;
  let ring2Ok = 0;
  for (const ray of rays) {
    if (!ray.centerDark || ray.transitions.length < 2) continue;
    const t1 = ray.transitions[0];
    if (!(t1 >= 0.72 * t1Median && t1 <= 1.38 * t1Median)) continue;
    const r2 = ray.transitions[1] / t1;
    // 하한 1.6 — v0 불스아이의 링 비(1.5)를 배제한다.
    if (!(r2 >= 1.6 && r2 <= 2.55)) continue;
    ring2Ok += 1;
    const t3 = ray.transitions.length >= 3 ? ray.transitions[2] : null;
    const t4 = ray.transitions.length >= 4 ? ray.transitions[3] : null;
    const hasRing3 = t3 !== null && t3 / t1 >= 2.4 && t3 / t1 <= 3.8;
    if (hasRing3 && t4 !== null && t4 / t1 >= 3.3 && t4 / t1 <= 5.0) full += 1;
    else if (hasRing3) ring3 += 1;
    else if (t3 === null || t3 / t1 > 4.6) open += 1;
  }
  const closed = full + ring3;
  if (ring2Ok < 5) return null;
  if (closed >= 5 && open <= 1) {
    // 구 v2r2 중앙(닫힌 동심 육각 링 스택) — **소각된 디자인** (2026-08-16 중앙 개정).
    // 분류는 법의학 진단용으로만 남긴다. 어떤 조립도 이 kind 를 소비하지 않으므로
    // 구 디자인 인쇄물은 포즈 0 → 복호 불가로 차단된다.
    return {
      kind: 'legacy-v2r2-center', x: center.x, y: center.y, u: t1Median,
      score: (2 * full + ring3) / 16, count: cluster.count,
    };
  }
  if (open >= 3 && closed <= 4) {
    return {
      kind: 'v2r2-corner', x: center.x, y: center.y, u: t1Median,
      score: (open + ring2Ok) / 16, count: cluster.count,
    };
  }
  return null;
}

/**
 * v0xq 3코너 동심 사각 검증 — **`verifyV2r2Cluster` 를 못 쓴다** (실측으로 확인).
 *
 * v0X 의 SE 블록은 면의 **먼 꼭짓점**에 있어 두 변이 실루엣 경계다: 암 테두리 바깥이
 * 곧 배경(어두움)이라 t3/t4 전이가 안 생기고 «open» 으로 분류된다. v0xq 의 같은
 * 무늬는 **NE 사분면**에 있어 바깥이 데이터 셀·심이라 전이가 더 생긴다. 실측
 * (클린 프레임, 8레이):
 *   v0X   T open 3 closed 2 · L open 4 closed 4 · R open 3 closed 2  → 셋 다 corner ✓
 *   v0xq  T open 2 closed 4 · L open 2 closed 5 · R open 5 closed 2  → **R 만** corner
 * open ≥ 3 문턱에 T·L 이 2 로 걸려 3코너 중 하나만 선다 → 삼중점이 성립하지 않는다.
 *
 * 그렇다고 `verifyV2r2Cluster` 의 문턱을 내리지 않는다 — 그 함수는 «소각된 구 v2r2
 * 중앙(닫힌 링)» 과 «v2r2/v0X 코너(열린 링)» 를 가르는 자이고, 문턱을 만지면 네
 * 레이아웃의 분류가 동시에 바뀐다(소각 차단이 풀릴 수 있다). 대신 **덧붙이는**
 * 검증기를 따로 둔다:
 *   · 별도 순회 · 별도 occupied — 기존 `verified` 배열과 분류에 **한 비트도** 닿지 않는다.
 *   · open/closed 를 아예 안 본다. 동심 사각의 불변식(암 코어 → 명 링, r2 ≈ 2)만 센다.
 *   · 느슨해진 만큼은 **위쪽에서** 다시 조인다 — v0xq 시드는 (a) 120° 삼중점 +
 *     (b) 같은 반경 + (c) 중앙 QR 블록 패치 정합을 전부 통과해야 열린다.
 *     복호 수용 게이트(0.78 / 0.035)는 그대로다.
 */
function verifyV0xqCornerCluster(luma, otsuCut, cluster, cfg) {
  const maxR = cluster.u * 7;
  const center = recentreByRays(luma, otsuCut, cluster, maxR);
  if (Math.hypot(center.x - cluster.x, center.y - cluster.y) > 2.5 * cluster.u) return null;
  const rays = RAY_DIRECTIONS.map((dir) =>
    rayTransitions(luma, otsuCut, center.x, center.y, dir, maxR));
  if (rays.filter((ray) => ray.centerDark).length < 6) return null;
  const t1List = [];
  for (const ray of rays) {
    if (!ray.centerDark || ray.transitions.length === 0) continue;
    const t1 = ray.transitions[0];
    if (t1 >= 0.4 * cluster.u && t1 <= 2.2 * cluster.u) t1List.push(t1);
  }
  if (t1List.length < 5) return null;
  const t1Median = median(t1List);
  let ring2Ok = 0;
  for (const ray of rays) {
    if (!ray.centerDark || ray.transitions.length < 2) continue;
    const t1 = ray.transitions[0];
    if (!(t1 >= 0.72 * t1Median && t1 <= 1.38 * t1Median)) continue;
    const r2 = ray.transitions[1] / t1;
    // v2r2/v0X 코너와 **같은** 링 비 계급 — 하한 1.6 이 v0 불스아이(1.5)를 배제한다.
    if (!(r2 >= 1.6 && r2 <= 2.55)) continue;
    ring2Ok += 1;
  }
  if (ring2Ok < cfg.v0xqMinimumRing2) return null;
  return {
    kind: 'v0xq-corner', x: center.x, y: center.y, u: t1Median,
    score: ring2Ok / 8, count: cluster.count,
  };
}

/**
 * v0 불스아이 검증 — 밝은 링(2..3)의 바깥 경계는 인접 데이터 셀과 병합될 수 있어
 * 신뢰할 수 없다. 항상 성립하는 것은 어두운 코어 경계(t1 ≈ 2u)뿐이므로,
 * t1 의 방향 간 중앙값 일관성으로 검증한다 (심선 방향 레이는 t1 이 크게 이탈 → 자연 탈락).
 */
function verifyV0Cluster(luma, otsuCut, cluster, cfg) {
  const maxR = cluster.u * 5;
  const center = recentreByRays(luma, otsuCut, cluster, maxR);
  if (Math.hypot(center.x - cluster.x, center.y - cluster.y) > 2.5 * cluster.u) return null;
  const rays = RAY_DIRECTIONS.map((dir) =>
    rayTransitions(luma, otsuCut, center.x, center.y, dir, maxR));
  if (rays.filter((ray) => ray.centerDark).length < 6) return null;
  const t1List = [];
  for (const ray of rays) {
    if (!ray.centerDark || ray.transitions.length === 0) continue;
    const t1 = ray.transitions[0];
    if (t1 >= 1.2 * cluster.u && t1 <= 3.0 * cluster.u) t1List.push(t1);
  }
  if (t1List.length < 5) return null;
  const t1Median = median(t1List);
  let pass = 0;
  let ring2Bonus = 0;
  let v2r2Stack = 0;
  for (const ray of rays) {
    if (!ray.centerDark || ray.transitions.length === 0) continue;
    const t1 = ray.transitions[0];
    if (!(t1 >= 0.75 * t1Median && t1 <= 1.3 * t1Median)) continue;
    pass += 1;
    if (ray.transitions.length >= 2) {
      const ratio = ray.transitions[1] / t1;
      if (ratio >= 1.25 && ratio <= 1.78) ring2Bonus += 1;
      // 구(소각) v2r2 중앙 링 스택(1:2:3)이 K3 불스아이(2:3)로 위장하는 것을 걸러낸다 —
      // 2026-08-16 중앙 통일 후에도 구 디자인 인쇄물 차단 가드로 유지한다.
      if (ratio >= 1.85 && ratio <= 2.35 && ray.transitions.length >= 3
        && ray.transitions[2] / t1 >= 2.6 && ray.transitions[2] / t1 <= 3.5) {
        v2r2Stack += 1;
      }
    }
  }
  if (pass < cfg.minimumRayPass || v2r2Stack >= 3) return null;
  return {
    kind: 'v0-center', x: center.x, y: center.y,
    u: t1Median / 2,
    score: (pass + ring2Bonus) / 16, count: cluster.count,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. 패치 정본 — canonical 모듈 중심 + 기대 이진 톤 (레이아웃별 지연 캐시).
// ─────────────────────────────────────────────────────────────────────────

const patchCache = new Map();

function buildPatch(cells, face, filter) {
  const points = [];
  let sumX = 0;
  let sumY = 0;
  for (const cell of cells) {
    if (!filter(cell)) continue;
    // mid(1) 면은 이진 기대값이 없다 — 밝음/어두움 어느 쪽으로 눌러도 Pearson 을
    // 편향시키므로 패치에서 뺀다. **현재 정본 넷에는 mid 면이 하나도 없어 이 분기는
    // 한 번도 타지 않는다** (v0X 정규화 2026-08-16 이전에는 4면이 해당했다).
    // cellSurfaceFinal.buildLocatorCells 가 로드 시점에 mid 를 막으므로 사실상
    // 도달 불가지만, 정본이 다시 mid 를 얻는 날 패치가 조용히 편향되지 않도록 남긴다.
    if (cell[face] === 1) continue;
    const point = moduleCenter(face, cell.i, cell.j, CANONICAL_LAYOUT);
    const expected = cell[face] === 2 ? 1 : 0;
    points.push({ x: point.x, y: point.y, expected });
    sumX += point.x;
    sumY += point.y;
  }
  if (points.length === 0) return null;
  return {
    anchor: { x: sumX / points.length, y: sumY / points.length },
    points,
  };
}

function mergePatches(patches) {
  const points = [];
  let sumX = 0;
  let sumY = 0;
  for (const patch of patches) {
    for (const point of patch.points) {
      points.push(point);
      sumX += point.x;
      sumY += point.y;
    }
  }
  return { anchor: { x: sumX / points.length, y: sumY / points.length }, points };
}

/**
 * 레이아웃별 블록 경계 — [중앙 블록 상한, 먼 코너 하한, 엣지 블록(있으면)].
 * v0 · v1r2 는 네 코너 블록이라 NE(i 작음·j 큼)·SW(i 큼·j 작음) 엣지도 정본이고,
 * 그 6 패치가 최소제곱 재적합의 스프레드를 넓힌다. v2r2 는 두 블록뿐이다.
 */
function blockLimitsFor(n, layoutId) {
  if (layoutId === 'v0x') {
    // NW (0..3)² 16 · SE (15..20)² 36 · NE (0..1)×(18..20) 6 · SW (18..20)×(0..1) 6.
    // (14,20) 단독 셀은 패치가 아니다 — 1점 패치는 Pearson 최소 6점(registerPatch)을
    // 못 채워 subPatch 경로가 null 이 되고, refineWithSubPatches 가 round-3 최소제곱
    // 재적합 없이 base 포즈로 폴백한다 (포즈가 죽는 게 아니라 정밀도만 잃는다 —
    // 적대 검증 실측: 1점 subPatch 주입 전후 poseCount·shapeCount 동일). 그래서 배제.
    return {
      nearLimit: 3,
      farLimit: 15,
      edges: Object.freeze([
        Object.freeze({ iMax: 1, jMin: 18 }),
        Object.freeze({ iMin: 18, jMax: 1 }),
      ]),
    };
  }
  if (layoutId === 'v1r2') {
    return {
      nearLimit: 4,
      farLimit: 16,
      edges: Object.freeze([
        Object.freeze({ iMax: 3, jMin: 16 }),
        Object.freeze({ iMin: 16, jMax: 3 }),
      ]),
    };
  }
  if (n === 13) {
    return {
      nearLimit: 2,
      farLimit: 10,
      edges: Object.freeze([
        Object.freeze({ iMax: 1, jMin: 10 }),
        Object.freeze({ iMin: 10, jMax: 1 }),
      ]),
    };
  }
  // v2r2 — 중앙 블록 A 가 v1r2 NW 5×5 공유로 개정(2026-08-16)돼 상한이 4 다.
  return { nearLimit: 4, farLimit: n - 7, edges: Object.freeze([]) };
}

function inEdgeBlock(cell, box) {
  if (box.iMax !== undefined && cell.i > box.iMax) return false;
  if (box.iMin !== undefined && cell.i < box.iMin) return false;
  if (box.jMax !== undefined && cell.j > box.jMax) return false;
  if (box.jMin !== undefined && cell.j < box.jMin) return false;
  return true;
}

/**
 * v0xq 중앙 앵커 — **중앙 QR 블록 자체**가 4번째 앵커다.
 *
 * v0xq 는 최종 라인업에서 처음으로 K3 불스아이 중앙이 **없다** (그 자리를 QR 슬롯이
 * 가져갔다). 그래서 기존 «K3 중앙 × K5 원거리» 시딩이 통째로 성립하지 않고,
 * 중앙 앵커를 중앙 QR 에서 얻어야 한다 — 브리프의 «detectQrFinderTriples 를 중앙
 * 앵커 공급자로 (제4 앵커)».
 *
 * ⚠ **`detectQrFinderTriples` 를 여기서 직접 부를 수 없다** — import 순환이다:
 *   bootstrap.js → cube-detect.js → cellsurface-block-detect.js → (bootstrap.js).
 * 그 함수를 별 모듈로 추출하면 풀리지만 3,688줄 파일의 570줄 이동이라 이 레인의
 * 배제 목록(기존 경로 무수정)에 가깝다. 대신 **같은 신호를 모델 공간에서** 잡는다:
 *   ① 콰이어트 프레임 (T 면, 밝음 32셀) — 심볼이 닿지 않는 슬롯 테두리.
 *   ② L/R 슬롯 채움 (어두움 162셀) — 중앙 QR 변형에만 있는 큰 무늬.
 *   ③ QR 파인더 3개의 암 코어 (T 면, 어두움 3점) — 내용 무관 고정 구조이자
 *      **직각 이등변**이라 120° 위상까지 깬다 (동심 사각 3코너는 3중 대칭이라 못 깬다).
 * detectQrFinderTriples 가 kind 'window' 로 잡는 것과 같은 삼중점이고, 여기서는
 * 이미지 탐색 없이 canonical 좌표로 바로 쓴다 (탐색 비용 0 · 결정적).
 */
function buildCenterQrPatch(
  slotCells = CENTER_QR_SLOT_CELLS, origin = ZERO_SLOT_ORIGIN, flip = false,
) {
  const points = [];
  // `role` 은 «QR 다움» 판별(§centreQrRequireFinderContrast)이 읽는다. registerPatch 는
  // x·y·expected 만 보므로 필드를 더해도 정합 계산은 한 비트도 안 바뀐다.
  const push = (face, a, b, expected, role) => {
    const { ei, ej } = faceBasis(face);
    points.push({
      x: ((origin.i + a) * ei.x + (origin.j + b) * ej.x) * CANONICAL_LAYOUT.size,
      y: ((origin.i + a) * ei.y + (origin.j + b) * ej.y) * CANONICAL_LAYOUT.size,
      expected,
      role,
    });
  };
  for (const cell of centerQrQuietFrameCells(slotCells)) {
    push('T', cell.i + 0.5, cell.j + 0.5, 1, 'quiet');
  }
  for (const face of ['L', 'R']) {
    for (let i = 0; i < slotCells; i += 1) {
      for (let j = 0; j < slotCells; j += 1) push(face, i + 0.5, j + 0.5, 0, 'slot');
    }
  }
  // 파인더 암코어의 슬롯-로컬 좌표는 **정본 모듈**이 낸다 — 뒤집기 규약이 렌더러와
  // 여기에 따로 적히면 v0WY 의 QR 다움 판별이 조용히 엉뚱한 3점을 보게 된다
  // (`cellSurfaceFinal.js` §centerQrFinderCoreCells).
  for (const core of centerQrFinderCoreCells(slotCells, flip)) {
    push('T', core.a, core.b, 0, 'finder');
  }
  let sumX = 0;
  let sumY = 0;
  for (const point of points) { sumX += point.x; sumY += point.y; }
  return { anchor: { x: sumX / points.length, y: sumY / points.length }, points };
}

/**
 * v0xq 패치 — 중앙 = 중앙 QR 블록, 코너 3 = 면별 동심 사각(NE 사분면),
 * 서브앵커 = 코너 3 + 위상 마커 3 (SW 사분면, T=L·R≠ 비대칭이라 120° 판별의 원천).
 */
/**
 * ⚠ 중앙 QR 패치는 `CENTER_QR_SLOT_CELLS` 에서 점 수가 파생된다 (m=9 → 197점).
 * `registerPatch` 의 스크래치는 **고정 256**이고, 타입배열은 범위 밖 쓰기를 조용히
 * 버린다 — 넘치면 Pearson 이 잘린 표본으로 계산되고 아무도 모른다. 로드 시점에 막는다.
 */
function assertCentrePatchFits(patch) {
  if (patch.points.length > scratchValues.length) {
    throw new Error(
      '중앙 QR 패치 ' + patch.points.length + '점이 스크래치 '
      + scratchValues.length + ' 을 넘는다 — CENTER_QR_SLOT_CELLS 를 올렸다면 '
      + 'scratchValues/scratchExpected 도 같이 키워야 한다',
    );
  }
  return patch;
}

function patchesForV0xq(n) {
  const cells = locatorCellsCellSurfaceFinal(n, 'v0xq');
  const blocks = blocksCellSurfaceFinalForN(n, 'v0xq');
  const inCorner = (cell) => cell.i <= blocks.CORNER.iMax && cell.j >= blocks.CORNER.jMin;
  const inMarker = (cell) => cell.i >= blocks.MARKER.iMin && cell.j <= blocks.MARKER.jMax;
  const corners = YFACE_LIST.map((face) => buildPatch(cells, face, inCorner));
  const markers = YFACE_LIST.map((face) => buildPatch(cells, face, inMarker))
    .filter((patch) => patch !== null);
  const centre = assertCentrePatchFits(buildCenterQrPatch());
  return {
    centre,
    corners,
    subPatches: [...corners, ...markers],
    all: mergePatches([...corners, ...markers]),
  };
}

/**
 * v0W 패치 — 중앙 = K3 불스아이(NW 5×5), 코너 3 = 면별 동심 사각(NE 사분면),
 * 서브앵커 = 중앙 3 + 코너 3 + 위상 마커 3 (SE 3×3).
 *
 * 일반 `patchesFor` 의 사각형 필터(`i ≥ farLimit && j ≥ farLimit`)로는 v0W 의 코너를
 * 못 쓴다 — v0W 의 «코너» 는 i 가 작고 j 가 큰 **NE 사분면**이기 때문이다.
 * (그 자리는 v0X·v1r2 에서는 소형 엣지 마커였고, v0W 에서는 반대로 6×6 대형 블록이다.)
 *
 * 위상 마커(SE 3×3)는 면당 9점이라 `registerPatch` 의 Pearson 최소 6점을 넘는다 —
 * 서브앵커로 쓸 수 있다. v0X 의 (14,20) 단독 셀과 다른 점이 이것이다.
 */
function patchesForV0w(n) {
  const cells = locatorCellsCellSurfaceFinal(n, 'v0w');
  const blocks = blocksCellSurfaceFinalForN(n, 'v0w');
  const inCentre = (cell) => cell.i <= blocks.NW.iMax && cell.j <= blocks.NW.jMax;
  const inCorner = (cell) => cell.i <= blocks.NE.iMax && cell.j >= blocks.NE.jMin;
  const inPhase = (cell) => cell.i >= blocks.SE.iMin && cell.j >= blocks.SE.jMin;
  const centreParts = YFACE_LIST.map((face) => buildPatch(cells, face, inCentre));
  const corners = YFACE_LIST.map((face) => buildPatch(cells, face, inCorner));
  const phase = YFACE_LIST.map((face) => buildPatch(cells, face, inPhase))
    .filter((patch) => patch !== null);
  return {
    centre: mergePatches(centreParts),
    corners,
    subPatches: [...centreParts, ...corners, ...phase],
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
}

/**
 * v0W2 패치 — 중앙 = K3 불스아이(NW 5×5, **3면 대칭화본**), 코너 3 = 면별 동심 사각
 * (NE 사분면, v0W 와 같은 블록), 서브앵커 = 중앙 3 + 코너 3 + **대형 마커 3 (SE 6×6)**.
 *
 * v0W 와 형태는 같고 두 곳이 다르다:
 *   · 중앙 패치가 3면 대칭이라 **면 사이 판별력이 0** 이다 — 위상은 전적으로 SE 가 준다.
 *   · SE 서브앵커가 9점 → **36점**. `registerPatch` 의 Pearson 최소 6점 대비 6배라,
 *     실기기에서 «부 파인더가 아예 안 잡힌다» 던 v0W 의 약점을 이 두께로 친다.
 */
function patchesForV0w2(n) {
  const cells = locatorCellsCellSurfaceFinal(n, 'v0w2');
  const blocks = blocksCellSurfaceFinalForN(n, 'v0w2');
  const inCentre = (cell) => cell.i <= blocks.NW.iMax && cell.j <= blocks.NW.jMax;
  const inCorner = (cell) => cell.i <= blocks.NE.iMax && cell.j >= blocks.NE.jMin;
  const inMarker = (cell) => cell.i >= blocks.SE.iMin && cell.j >= blocks.SE.jMin;
  const centreParts = YFACE_LIST.map((face) => buildPatch(cells, face, inCentre));
  const corners = YFACE_LIST.map((face) => buildPatch(cells, face, inCorner));
  const markers = YFACE_LIST.map((face) => buildPatch(cells, face, inMarker))
    .filter((patch) => patch !== null);
  return {
    centre: mergePatches(centreParts),
    corners,
    subPatches: [...centreParts, ...corners, ...markers],
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
}

/**
 * v0WQ 패치 — 중앙 = 중앙 QR 블록(슬롯 8), 코너 3 = 면별 동심 사각(NE, v0xq 와 같은 블록),
 * 서브앵커 = 코너 3 + 위상 마커 3 (SE 3×3, v0W 와 같은 블록).
 *
 * v0xq 와 다른 것은 **둘뿐**이다: ① 위상 마커가 SW 6셀 → SE 9셀 ② 중앙 QR 슬롯이
 * 9 → 8 셀(모듈 피치가 달라 콰이어트 프레임 셀 집합이 다르다). 코너 패치는 문자
 * 그대로 같은 셀에서 나온다 — 그래서 **두 패밀리는 서로의 프레임에서 서로 시드된다**.
 */
function patchesForV0wq(n) {
  const cells = locatorCellsCellSurfaceFinal(n, 'v0wq');
  const blocks = blocksCellSurfaceFinalForN(n, 'v0wq');
  const inCorner = (cell) => cell.i <= blocks.CORNER.iMax && cell.j >= blocks.CORNER.jMin;
  const inMarker = (cell) => cell.i >= blocks.MARKER.iMin && cell.j >= blocks.MARKER.jMin;
  const corners = YFACE_LIST.map((face) => buildPatch(cells, face, inCorner));
  const markers = YFACE_LIST.map((face) => buildPatch(cells, face, inMarker))
    .filter((patch) => patch !== null);
  const centre = assertCentrePatchFits(buildCenterQrPatch(centerQrSlotCellsFor('v0wq')));
  return {
    centre,
    corners,
    subPatches: [...corners, ...markers],
    all: mergePatches([...corners, ...markers]),
  };
}

/**
 * v0WY 패치 — 중앙 = K3 불스아이(NW 5×5, **v0W 과 같은 배열**), 코너 3 = 면별 동심
 * 사각(NE, v0W 과 같은 블록), 서브앵커 = 중앙 3 + 코너 3 + 위상 마커 3 (SW 6셀) +
 * **먼 코너 QR 패치 1**.
 *
 * ⚠ **v0W 과 시드 기하가 완전히 같다** — 중앙 서명도 코너 반경도 같은 배열에서 나온다.
 * 그래서 두 패밀리는 서로의 프레임에서 서로 시드되고, 가르는 것은 이 패치의 **차이
 * 두 곳**이다:
 *   ① 위상 마커가 SE(v0W) 가 아니라 **SW** 에 있다 — v0W 프레임의 그 자리는 데이터다.
 *   ② 먼 코너 [n−8, n−1]² 에 **QR 패치**가 있다 — v0W 프레임의 그 자리는 데이터 +
 *      SE 위상 마커다.
 * ② 는 Pearson 서브앵커로만 쓰는 것이 아니라 **«QR 다움» 판별의 입력**이기도 하다
 * (§slotQr — 봉합 ② 인프라 재사용). 그래서 `slotQr` 를 따로 내보낸다.
 */
function patchesForV0wy(n) {
  const cells = locatorCellsCellSurfaceFinal(n, 'v0wy');
  const blocks = blocksCellSurfaceFinalForN(n, 'v0wy');
  const inCentre = (cell) => cell.i <= blocks.NW.iMax && cell.j <= blocks.NW.jMax;
  const inCorner = (cell) => cell.i <= blocks.NE.iMax && cell.j >= blocks.NE.jMin;
  const inMarker = (cell) => cell.i >= blocks.SW.iMin && cell.j <= blocks.SW.jMax;
  const centreParts = YFACE_LIST.map((face) => buildPatch(cells, face, inCentre));
  const corners = YFACE_LIST.map((face) => buildPatch(cells, face, inCorner));
  const markers = YFACE_LIST.map((face) => buildPatch(cells, face, inMarker))
    .filter((patch) => patch !== null);
  const placement = centerQrSlotPlacementFor('v0wy');
  const slotQr = assertCentrePatchFits(buildCenterQrPatch(
    centerQrSlotCellsFor('v0wy'), centerQrSlotOriginFor('v0wy', n), placement.flip,
  ));
  return {
    centre: mergePatches(centreParts),
    corners,
    slotQr,
    subPatches: [...centreParts, ...corners, ...markers, slotQr],
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
}

/**
 * v0T 패치 — 중앙 = K3 계보 (0..3)² 16셀 (3면 대칭화본 — 위상 판별력 0), 코너 3 =
 * 면별 동심 사각 (NE, v0W 계열과 같은 블록), 서브앵커 = 중앙 3 + 코너 3 + A 블록 3
 * (L 반전 9셀 — 위상 판별자 ①) + N팔 3 + W 블록 3 + SE 마커 3 (R 반전 — 위상 판별자 ②).
 *
 * 위상 판별이 **두 블록으로 이중화**돼 있다 (운영자 의도 설계) — 파생 v0TY 의 슬롯이
 * SE 를 삼켜도 A 가 남는다. 여섯 블록 전부 registerPatch 의 Pearson 최소 6점을 넘는다
 * (A 9 · N팔 10 · SE 9 · W 24).
 */
function patchesForV0t(n) {
  const cells = locatorCellsCellSurfaceFinal(n, 'v0t');
  const blocks = blocksCellSurfaceFinalForN(n, 'v0t');
  const inCentre = (cell) => cell.i <= blocks.NW.iMax && cell.j <= blocks.NW.jMax;
  const inCorner = (cell) => cell.i <= blocks.NE.iMax && cell.j >= blocks.NE.jMin;
  const inA = (cell) => cell.i >= blocks.A.iMin && cell.i <= blocks.A.iMax
    && cell.j >= blocks.A.jMin && cell.j <= blocks.A.jMax;
  const inArm = (cell) => cell.i <= blocks.ARM.iMax && cell.j >= blocks.ARM.jMin
    && cell.j <= blocks.ARM.jMax;
  const inW = (cell) => cell.i >= blocks.W.iMin && cell.i <= blocks.W.iMax
    && cell.j <= blocks.W.jMax;
  const inPhase = (cell) => cell.i >= blocks.SE.iMin && cell.j >= blocks.SE.jMin;
  const centreParts = YFACE_LIST.map((face) => buildPatch(cells, face, inCentre));
  const corners = YFACE_LIST.map((face) => buildPatch(cells, face, inCorner));
  const extras = [inA, inArm, inW, inPhase]
    .flatMap((filter) => YFACE_LIST.map((face) => buildPatch(cells, face, filter)))
    .filter((patch) => patch !== null);
  return {
    centre: mergePatches(centreParts),
    corners,
    subPatches: [...centreParts, ...corners, ...extras],
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
}

/**
 * v0TY 패치 — v0T 에서 SE 마커가 빠지고 **먼 코너 QR 패치**가 들어온 것.
 * 남은 위상 판별자는 A 블록 하나다 (의도된 이중화의 실증 — §CELL_SURFACE_FINAL_V0TY).
 * slotQr 는 v0WY 와 같은 규약으로 따로 내보낸다 (Pearson 서브앵커 + «QR 다움» 입력).
 */
function patchesForV0ty(n) {
  const cells = locatorCellsCellSurfaceFinal(n, 'v0ty');
  const blocks = blocksCellSurfaceFinalForN(n, 'v0ty');
  const inCentre = (cell) => cell.i <= blocks.NW.iMax && cell.j <= blocks.NW.jMax;
  const inCorner = (cell) => cell.i <= blocks.NE.iMax && cell.j >= blocks.NE.jMin;
  const inA = (cell) => cell.i >= blocks.A.iMin && cell.i <= blocks.A.iMax
    && cell.j >= blocks.A.jMin && cell.j <= blocks.A.jMax;
  const inArm = (cell) => cell.i <= blocks.ARM.iMax && cell.j >= blocks.ARM.jMin
    && cell.j <= blocks.ARM.jMax;
  const inW = (cell) => cell.i >= blocks.W.iMin && cell.i <= blocks.W.iMax
    && cell.j <= blocks.W.jMax;
  const centreParts = YFACE_LIST.map((face) => buildPatch(cells, face, inCentre));
  const corners = YFACE_LIST.map((face) => buildPatch(cells, face, inCorner));
  const extras = [inA, inArm, inW]
    .flatMap((filter) => YFACE_LIST.map((face) => buildPatch(cells, face, filter)))
    .filter((patch) => patch !== null);
  const placement = centerQrSlotPlacementFor('v0ty');
  const slotQr = assertCentrePatchFits(buildCenterQrPatch(
    centerQrSlotCellsFor('v0ty'), centerQrSlotOriginFor('v0ty', n), placement.flip,
  ));
  return {
    centre: mergePatches(centreParts),
    corners,
    slotQr,
    subPatches: [...centreParts, ...corners, ...extras, slotQr],
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
}

/**
 * v0TR 패치 — 중앙 = K3 계보 (0..3)² 16셀 (v0T 와 **같은 배열**, 3면 대칭이라 위상
 * 판별력 0), 코너 3 = 면별 **바깥** 동심 사각 (v0T·v0W 계열과 같은 블록 · 반경 √279),
 * 서브앵커 = 중앙 3 + 코너(바깥) 3 + **안쪽 동심 사각 3** + SE 마커 3 (R 반전 — 이 계열의
 * 유일한 위상 판별자).
 *
 * ⚠ **«안쪽 사각을 코너 앵커로» 는 실측으로 기각됐다** (2026-08-17,
 * `claude-v0tr-detect-debug.mjs`). 정준 기하로는 안쪽 삼중점이 완벽히 서고 반경도
 * `ANCHOR_SNAP_CELLS` 밖(√129 대 √279, 5.35셀)이라 «거리로 갈리는 첫 계열» 이 될
 * 뻔했는데, **실물 프레임에서 안쪽 코어가 엄격 코너로 검증되지 않는다**:
 *   · `verifyV2r2Cluster` (엄격, open/closed 분류까지 요구) → v0TR 프레임에서 검증되는
 *     `v2r2-corner` 는 **바깥 셋뿐**이다 (실측 3/3, 전부 추정 반경 18.55).
 *     안쪽 코어는 바깥 사각과 j=15 열을 맞대고 있어 «배경으로 열린다» 를 못 만든다.
 *   · `verifyV0xqCornerCluster` (느슨, 링 비만 요구) → 안쪽도 잡는다 (느슨 코너 7개).
 * 앵커드 경로가 보는 것은 **엄격** 목록이므로, 안쪽을 코너로 삼으면 v0TR 자기
 * 프레임에서 포즈가 **0** 이 된다 (실측 그대로였다). 그래서 코너는 바깥으로 되돌리고,
 * 안쪽 36셀은 **서브앵커**로 쓴다 — 거기가 이 블록의 실제 일자리다 (v0T 프레임에서
 * 그 자리는 데이터라 Pearson 이 두 계열을 가른다).
 *
 * 네 블록 전부 `registerPatch` 의 Pearson 최소 6점을 넘는다 (중앙 16 · 바깥 36 ·
 * 안쪽 36 · SE 9).
 */
function patchesForV0tr(n) {
  const cells = locatorCellsCellSurfaceFinal(n, 'v0tr');
  const blocks = blocksCellSurfaceFinalForN(n, 'v0tr');
  const inCentre = (cell) => cell.i <= blocks.NW.iMax && cell.j <= blocks.NW.jMax;
  const inInner = (cell) => cell.i >= blocks.NE_INNER.iMin
    && cell.i <= blocks.NE_INNER.iMax
    && cell.j >= blocks.NE_INNER.jMin && cell.j <= blocks.NE_INNER.jMax;
  const inOuter = (cell) => cell.i <= blocks.NE_OUTER.iMax
    && cell.j >= blocks.NE_OUTER.jMin;
  const inPhase = (cell) => cell.i >= blocks.SE.iMin && cell.j >= blocks.SE.jMin;
  // A 블록 (2026-08-18 편입) — v0T 와 같은 자리·같은 배열. 정련의 방향 판별자다.
  // 빠뜨리면 정본에는 들어왔는데 정련이 안 쓰는 «반쪽 편입» 이 된다.
  const inA = (cell) => cell.i >= blocks.A.iMin && cell.i <= blocks.A.iMax
    && cell.j >= blocks.A.jMin && cell.j <= blocks.A.jMax;
  const centreParts = YFACE_LIST.map((face) => buildPatch(cells, face, inCentre));
  const corners = YFACE_LIST.map((face) => buildPatch(cells, face, inOuter));
  const extras = [inA, inInner, inPhase]
    .flatMap((filter) => YFACE_LIST.map((face) => buildPatch(cells, face, filter)))
    .filter((patch) => patch !== null);
  return {
    centre: mergePatches(centreParts),
    corners,
    subPatches: [...centreParts, ...corners, ...extras],
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
}

/**
 * v0TRQ 패치 — v0TR 에서 중앙 K3 가 빠지고 **중앙 QR 블록**(슬롯 8, Y-심 앵커)이
 * 4번째 앵커로 들어온 것. 코너 3 = 면별 **바깥** 동심 사각 (v0TR 과 같은 블록),
 * 서브앵커 = 코너 3 + 안쪽 사각 3 + SE 마커 3.
 *
 * v0xq·v0wq 와 같은 «중앙이 QR» 구조라 같은 삼중점 경로를 탄다. 코너 블록도 같은
 * 자리라 삼중점도 같은 자리에 선다 — 가르는 것은 ① 중앙 QR 패치(슬롯 8) ② 안쪽
 * 사각·SE 서브패치 셋이다 (v0xq ↔ v0wq 와 같은 구조).
 * 코너를 «안쪽» 으로 잡지 않는 이유는 §patchesForV0tr 에 실측과 함께 적혀 있다.
 */
function patchesForV0trq(n) {
  const cells = locatorCellsCellSurfaceFinal(n, 'v0trq');
  const blocks = blocksCellSurfaceFinalForN(n, 'v0trq');
  const inInner = (cell) => cell.i >= blocks.NE_INNER.iMin
    && cell.i <= blocks.NE_INNER.iMax
    && cell.j >= blocks.NE_INNER.jMin && cell.j <= blocks.NE_INNER.jMax;
  const inOuter = (cell) => cell.i <= blocks.NE_OUTER.iMax
    && cell.j >= blocks.NE_OUTER.jMin;
  const inPhase = (cell) => cell.i >= blocks.SE.iMin && cell.j >= blocks.SE.jMin;
  const corners = YFACE_LIST.map((face) => buildPatch(cells, face, inOuter));
  const extras = [inInner, inPhase]
    .flatMap((filter) => YFACE_LIST.map((face) => buildPatch(cells, face, filter)))
    .filter((patch) => patch !== null);
  const centre = assertCentrePatchFits(buildCenterQrPatch(centerQrSlotCellsFor('v0trq')));
  return {
    centre,
    corners,
    subPatches: [...corners, ...extras],
    // ⚠ v0xq·v0wq 처럼 블록 패치를 합치면 **안 된다** — 두 동심 사각이 4셀을 공유해
    // 그 셀이 두 번 세어진다 (243 ≠ 77×3). 파인더 셀 전수로 만든다.
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
}

/**
 * v0TRY 패치 — v0TR 에서 SE 마커가 빠지고 **먼 코너 QR 패치**가 들어온 것.
 * v0T → v0TY 의 변형과 **문자 그대로 같은 꼴**이다 (그쪽도 SE 가 슬롯에 삼켜진다).
 *
 * 중앙 = K3 계보 (0..3)² 16셀 (v0TR 과 같은 배열), 코너 3 = 면별 **바깥** 동심 사각
 * (v0TR 과 같은 블록 · 반경 √279 — 슬롯이 SE 쪽이라 코너가 안 움직인다),
 * 서브앵커 = 중앙 3 + 코너 3 + A 3 + 안쪽 사각 3 + 슬롯 QR.
 *
 * ⚠ **A 블록이 여기서 유일한 위상 판별자다** (SE 가 슬롯에 먹혔다). 정련이 A 를 안
 * 쓰면 방향을 줄 패치가 하나도 없다 — `patchesForV0tr` 이 A 를 넣은 이유와 같은 자리,
 * 더 강한 형태다. slotQr 는 v0WY·v0TY 와 같은 규약으로 따로 내보낸다.
 *
 * 네 블록 전부 `registerPatch` 의 Pearson 최소 6점을 넘는다 (중앙 16 · 바깥 36 ·
 * A 9 · 안쪽 36).
 */
function patchesForV0try(n) {
  const cells = locatorCellsCellSurfaceFinal(n, 'v0try');
  const blocks = blocksCellSurfaceFinalForN(n, 'v0try');
  const inCentre = (cell) => cell.i <= blocks.NW.iMax && cell.j <= blocks.NW.jMax;
  const inA = (cell) => cell.i >= blocks.A.iMin && cell.i <= blocks.A.iMax
    && cell.j >= blocks.A.jMin && cell.j <= blocks.A.jMax;
  const inInner = (cell) => cell.i >= blocks.NE_INNER.iMin
    && cell.i <= blocks.NE_INNER.iMax
    && cell.j >= blocks.NE_INNER.jMin && cell.j <= blocks.NE_INNER.jMax;
  const inOuter = (cell) => cell.i <= blocks.NE_OUTER.iMax
    && cell.j >= blocks.NE_OUTER.jMin;
  const centreParts = YFACE_LIST.map((face) => buildPatch(cells, face, inCentre));
  const corners = YFACE_LIST.map((face) => buildPatch(cells, face, inOuter));
  const extras = [inA, inInner]
    .flatMap((filter) => YFACE_LIST.map((face) => buildPatch(cells, face, filter)))
    .filter((patch) => patch !== null);
  const placement = centerQrSlotPlacementFor('v0try');
  const slotQr = assertCentrePatchFits(buildCenterQrPatch(
    centerQrSlotCellsFor('v0try'), centerQrSlotOriginFor('v0try', n), placement.flip,
  ));
  return {
    centre: mergePatches(centreParts),
    corners,
    slotQr,
    subPatches: [...centreParts, ...corners, ...extras, slotQr],
    // ⚠ v0TR 과 같은 이유로 블록 패치를 합치면 안 된다 — 두 동심 사각이 4셀을 공유한다.
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
}

function patchesFor(n, layoutId = undefined) {
  const key = (layoutId || 'default') + '@' + n;
  if (patchCache.has(key)) return patchCache.get(key);
  if (layoutId === 'v0try') {
    const builtV0try = patchesForV0try(n);
    patchCache.set(key, builtV0try);
    return builtV0try;
  }
  if (layoutId === 'v0tr') {
    const builtV0tr = patchesForV0tr(n);
    patchCache.set(key, builtV0tr);
    return builtV0tr;
  }
  if (layoutId === 'v0trq') {
    const builtV0trq = patchesForV0trq(n);
    patchCache.set(key, builtV0trq);
    return builtV0trq;
  }
  if (layoutId === 'v0t') {
    const builtV0t = patchesForV0t(n);
    patchCache.set(key, builtV0t);
    return builtV0t;
  }
  if (layoutId === 'v0ty') {
    const builtV0ty = patchesForV0ty(n);
    patchCache.set(key, builtV0ty);
    return builtV0ty;
  }
  if (layoutId === 'v0wy') {
    const builtV0wy = patchesForV0wy(n);
    patchCache.set(key, builtV0wy);
    return builtV0wy;
  }
  if (layoutId === 'v0wq') {
    const builtV0wq = patchesForV0wq(n);
    patchCache.set(key, builtV0wq);
    return builtV0wq;
  }
  if (layoutId === 'v0xq') {
    const builtV0xq = patchesForV0xq(n);
    patchCache.set(key, builtV0xq);
    return builtV0xq;
  }
  if (layoutId === 'v0w') {
    const builtV0w = patchesForV0w(n);
    patchCache.set(key, builtV0w);
    return builtV0w;
  }
  if (layoutId === 'v0w2') {
    const builtV0w2 = patchesForV0w2(n);
    patchCache.set(key, builtV0w2);
    return builtV0w2;
  }
  const cells = locatorCellsCellSurfaceFinal(n, layoutId);
  const { nearLimit, farLimit, edges: edgeBoxes } = blockLimitsFor(n, layoutId);
  const centreParts = YFACE_LIST.map((face) =>
    buildPatch(cells, face, (cell) => cell.i <= nearLimit && cell.j <= nearLimit));
  const corners = YFACE_LIST.map((face) =>
    buildPatch(cells, face, (cell) => cell.i >= farLimit && cell.j >= farLimit));
  const edges = YFACE_LIST.flatMap((face) =>
    edgeBoxes.map((box) => buildPatch(cells, face, (cell) => inEdgeBlock(cell, box))))
    .filter((patch) => patch !== null);
  const built = {
    centre: mergePatches(centreParts),
    corners,
    // 최소제곱 재적합용 서브앵커 — 면별 중앙 3 + 면별 먼 코너 3 (+ v0·v1r2 엣지 6).
    subPatches: [...centreParts, ...corners, ...edges],
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
  patchCache.set(key, built);
  return built;
}

/** 기존 호출 형태 유지 — n 의 **기본** 레이아웃 패치. */
function patchesForN(n) {
  return patchesFor(n, undefined);
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Pearson 패치 정합과 호모그래피 재적합.
// ─────────────────────────────────────────────────────────────────────────

function bilinear(luma, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= luma.width || y0 + 1 >= luma.height) return null;
  const fx = x - x0;
  const fy = y - y0;
  const base = y0 * luma.width + x0;
  const top = luma.data[base] * (1 - fx) + luma.data[base + 1] * fx;
  const bottom = luma.data[base + luma.width] * (1 - fx) + luma.data[base + luma.width + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function pearson(values, expected, count) {
  if (count < 6) return null;
  let sumV = 0;
  let sumE = 0;
  for (let index = 0; index < count; index += 1) {
    sumV += values[index];
    sumE += expected[index];
  }
  const meanV = sumV / count;
  const meanE = sumE / count;
  let covVE = 0;
  let varV = 0;
  let varE = 0;
  for (let index = 0; index < count; index += 1) {
    const dv = values[index] - meanV;
    const de = expected[index] - meanE;
    covVE += dv * de;
    varV += dv * dv;
    varE += de * de;
  }
  if (varV <= EPSILON || varE <= EPSILON) return null;
  return covVE / Math.sqrt(varV * varE);
}

function localCellPx(H) {
  const origin = projectPoint(H, { x: 0, y: 0 });
  const east = projectPoint(H, { x: 1, y: 0 });
  const south = projectPoint(H, { x: 0, y: 1 });
  if (!origin || !east || !south) return null;
  return (Math.hypot(east.x - origin.x, east.y - origin.y)
    + Math.hypot(south.x - origin.x, south.y - origin.y)) / 2;
}

const scratchValues = new Float64Array(256);
const scratchExpected = new Float64Array(256);

/**
 * 패치를 현재 H 로 투영한 뒤 이미지 평면 오프셋 그리드에서 Pearson 최대를 찾는다.
 * 반환 offset 은 이미지 px — 포물선 보간으로 서브픽셀까지 간다.
 *
 * `options` 없이 부르면 **기존 계약 그대로**다 (커버리지 0.8 · 오프셋마다 표본 재계산).
 * 부분 앵커 경로만 options 를 준다:
 *   · `minCoverage` — in-frame 비율 하한을 낮춘다 (잘린 블록의 남은 조각으로 정합).
 *   · `lockSubset`  — **표본 집합을 오프셋 전 구간에서 고정**한다. 이게 없으면 프레임
 *     경계 근처에서 «안쪽으로 미는 오프셋일수록 점이 많다» 는 편향이 생겨 Pearson 이
 *     오프셋끼리 비교 불가능해진다 (점이 적을수록 상관이 우연히 커진다). 고정 집합은
 *     투영점이 탐색 반경 + 탭 만큼 여유를 두고 프레임 안에 있는 점들만 쓴다.
 */
function registerPatch(luma, H, patch, rangePx, stepPx, options = null) {
  const minCoverage = options && Number.isFinite(options.minCoverage)
    ? options.minCoverage : 0.8;
  const lockSubset = options ? options.lockSubset === true : false;
  const projected = [];
  for (const point of patch.points) {
    const image = projectPoint(H, point);
    if (!image) return null;
    projected.push({ x: image.x, y: image.y, expected: point.expected });
  }
  // 모듈당 5-탭(중심 + 십자 0.18셀) 평균 — 픽셀 격자 앨리어싱을 눌러 정합 봉우리를 안정화.
  const cellPx = localCellPx(H);
  const tap = Number.isFinite(cellPx) ? 0.18 * cellPx : 0;
  let usable = projected;
  if (lockSubset) {
    const pad = rangePx + tap + 1;
    usable = projected.filter((point) =>
      point.x - pad >= 0 && point.y - pad >= 0
      && point.x + pad < luma.width - 1 && point.y + pad < luma.height - 1);
    if (usable.length < Math.max(6, Math.floor(projected.length * minCoverage))) return null;
  }
  const requiredCount = lockSubset
    ? usable.length
    : Math.max(6, Math.floor(projected.length * minCoverage));
  const steps = Math.max(1, Math.round(rangePx / stepPx));
  const size = 2 * steps + 1;
  const grid = new Float64Array(size * size).fill(-2);
  let best = -2;
  let bestIx = -1;
  let bestIy = -1;
  for (let iy = 0; iy < size; iy += 1) {
    const oy = (iy - steps) * stepPx;
    for (let ix = 0; ix < size; ix += 1) {
      const ox = (ix - steps) * stepPx;
      let count = 0;
      for (const point of usable) {
        const px = point.x + ox;
        const py = point.y + oy;
        const centre = bilinear(luma, px, py);
        if (centre === null) continue;
        let value = centre;
        let taps = 1;
        if (tap > 0) {
          const east = bilinear(luma, px + tap, py);
          const west = bilinear(luma, px - tap, py);
          const south = bilinear(luma, px, py + tap);
          const north = bilinear(luma, px, py - tap);
          if (east !== null) { value += east; taps += 1; }
          if (west !== null) { value += west; taps += 1; }
          if (south !== null) { value += south; taps += 1; }
          if (north !== null) { value += north; taps += 1; }
        }
        scratchValues[count] = value / taps;
        scratchExpected[count] = point.expected;
        count += 1;
      }
      if (count < requiredCount) continue;
      const corr = pearson(scratchValues, scratchExpected, count);
      if (corr === null) continue;
      grid[iy * size + ix] = corr;
      if (corr > best) {
        best = corr;
        bestIx = ix;
        bestIy = iy;
      }
    }
  }
  if (bestIx < 0) return null;
  let offsetX = (bestIx - steps) * stepPx;
  let offsetY = (bestIy - steps) * stepPx;
  // 포물선 서브픽셀 — 내부 극값에서만.
  if (bestIx > 0 && bestIx + 1 < size) {
    const left = grid[bestIy * size + bestIx - 1];
    const right = grid[bestIy * size + bestIx + 1];
    if (left > -2 && right > -2) {
      const denom = left - 2 * best + right;
      if (denom < -EPSILON) offsetX += 0.5 * ((left - right) / denom) * stepPx;
    }
  }
  if (bestIy > 0 && bestIy + 1 < size) {
    const up = grid[(bestIy - 1) * size + bestIx];
    const down = grid[(bestIy + 1) * size + bestIx];
    if (up > -2 && down > -2) {
      const denom = up - 2 * best + down;
      if (denom < -EPSILON) offsetY += 0.5 * ((up - down) / denom) * stepPx;
    }
  }
  return {
    offsetX,
    offsetY,
    correlation: best,
    coverage: projected.length > 0 ? usable.length / projected.length : 0,
    usedPoints: usable.length,
  };
}

/** 4앵커(중앙 + 3코너) 정합 → estimateHomography4 재적합. 실패 시 이전 H 유지. */
function refineHomographyWithPatches(luma, H, patches, rangeCells, stepCells) {
  const cellPx = localCellPx(H);
  if (!Number.isFinite(cellPx) || cellPx <= 0.5) return null;
  const anchorPatches = [patches.centre, ...patches.corners];
  const canonicalPoints = [];
  const imagePoints = [];
  let correlationSum = 0;
  let worst = Infinity;
  for (const patch of anchorPatches) {
    const registered = registerPatch(
      luma, H, patch, rangeCells * cellPx, Math.max(0.5, stepCells * cellPx),
    );
    if (!registered) return null;
    const projectedAnchor = projectPoint(H, patch.anchor);
    if (!projectedAnchor) return null;
    canonicalPoints.push({ x: patch.anchor.x, y: patch.anchor.y });
    imagePoints.push({
      x: projectedAnchor.x + registered.offsetX,
      y: projectedAnchor.y + registered.offsetY,
    });
    correlationSum += registered.correlation;
    worst = Math.min(worst, registered.correlation);
  }
  const refined = estimateHomography4(canonicalPoints, imagePoints);
  return {
    H: refined || H,
    meanCorrelation: correlationSum / anchorPatches.length,
    worstCorrelation: worst,
  };
}

/**
 * 4점 이상 최소제곱 DLT (h8=1 고정, Hartley 정규화 + 정규방정식 가우스 소거).
 * estimateHomography4 는 정확히 4점 전용이라 6 서브앵커 재적합에는 이걸 쓴다.
 */
function homographyLeastSquares(canonicalPoints, imagePoints) {
  const count = canonicalPoints.length;
  if (count < 4 || imagePoints.length !== count) return null;
  let meanCx = 0;
  let meanCy = 0;
  let meanIx = 0;
  let meanIy = 0;
  for (let k = 0; k < count; k += 1) {
    meanCx += canonicalPoints[k].x;
    meanCy += canonicalPoints[k].y;
    meanIx += imagePoints[k].x;
    meanIy += imagePoints[k].y;
  }
  meanCx /= count;
  meanCy /= count;
  meanIx /= count;
  meanIy /= count;
  let scaleC = 0;
  let scaleI = 0;
  for (let k = 0; k < count; k += 1) {
    scaleC += Math.hypot(canonicalPoints[k].x - meanCx, canonicalPoints[k].y - meanCy);
    scaleI += Math.hypot(imagePoints[k].x - meanIx, imagePoints[k].y - meanIy);
  }
  scaleC = scaleC > EPSILON ? (Math.SQRT2 * count) / scaleC : 1;
  scaleI = scaleI > EPSILON ? (Math.SQRT2 * count) / scaleI : 1;
  const ata = new Float64Array(64);
  const atb = new Float64Array(8);
  const row = new Float64Array(8);
  for (let k = 0; k < count; k += 1) {
    const x = (canonicalPoints[k].x - meanCx) * scaleC;
    const y = (canonicalPoints[k].y - meanCy) * scaleC;
    const u = (imagePoints[k].x - meanIx) * scaleI;
    const v = (imagePoints[k].y - meanIy) * scaleI;
    for (let half = 0; half < 2; half += 1) {
      const rhs = half === 0 ? u : v;
      row[0] = half === 0 ? x : 0;
      row[1] = half === 0 ? y : 0;
      row[2] = half === 0 ? 1 : 0;
      row[3] = half === 0 ? 0 : x;
      row[4] = half === 0 ? 0 : y;
      row[5] = half === 0 ? 0 : 1;
      row[6] = -rhs * x;
      row[7] = -rhs * y;
      for (let a = 0; a < 8; a += 1) {
        atb[a] += row[a] * rhs;
        for (let b = 0; b < 8; b += 1) ata[a * 8 + b] += row[a] * row[b];
      }
    }
  }
  const perm = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 8; r += 1) {
      if (Math.abs(ata[perm[r] * 8 + col]) > Math.abs(ata[perm[pivot] * 8 + col])) pivot = r;
    }
    const swap = perm[col];
    perm[col] = perm[pivot];
    perm[pivot] = swap;
    const diag = ata[perm[col] * 8 + col];
    if (!(Math.abs(diag) > 1e-12)) return null;
    for (let r = col + 1; r < 8; r += 1) {
      const factor = ata[perm[r] * 8 + col] / diag;
      if (factor === 0) continue;
      for (let c = col; c < 8; c += 1) ata[perm[r] * 8 + c] -= factor * ata[perm[col] * 8 + c];
      atb[perm[r]] -= factor * atb[perm[col]];
    }
  }
  const h = new Float64Array(8);
  for (let col = 7; col >= 0; col -= 1) {
    let acc = atb[perm[col]];
    for (let c = col + 1; c < 8; c += 1) acc -= ata[perm[col] * 8 + c] * h[c];
    h[col] = acc / ata[perm[col] * 8 + col];
  }
  // 정규화 해제: H = Timg 역 · Hn · Tcan.
  const a00 = h[0] * scaleC;
  const a01 = h[1] * scaleC;
  const a02 = h[2] - h[0] * scaleC * meanCx - h[1] * scaleC * meanCy;
  const a10 = h[3] * scaleC;
  const a11 = h[4] * scaleC;
  const a12 = h[5] - h[3] * scaleC * meanCx - h[4] * scaleC * meanCy;
  const a20 = h[6] * scaleC;
  const a21 = h[7] * scaleC;
  const a22 = 1 - h[6] * scaleC * meanCx - h[7] * scaleC * meanCy;
  const out = new Float64Array(9);
  out[0] = a00 / scaleI + meanIx * a20;
  out[1] = a01 / scaleI + meanIx * a21;
  out[2] = a02 / scaleI + meanIx * a22;
  out[3] = a10 / scaleI + meanIy * a20;
  out[4] = a11 / scaleI + meanIy * a21;
  out[5] = a12 / scaleI + meanIy * a22;
  out[6] = a20;
  out[7] = a21;
  out[8] = a22;
  return out;
}

/**
 * 2점 이상 최소제곱 **similarity** (회전 + 등방 스케일 + 평행이동, 4 dof).
 *
 * 부분 앵커 완성의 기본 모델이다. 이유 — 관측 앵커가 2~3개면 호모그래피(8 dof)는
 * 미결정이고 아핀(6 dof)도 3점에서 **정확 적합**이라 잔차가 항등 0 이 된다. 잔차가
 * 0 이면 «완성이 얼마나 억지인가» 를 잴 수가 없다. similarity 는 3점에서 6식 4미지수라
 * **과결정**이고, 그래서 §7 의 상대 잔차 게이트가 실제로 값을 갖는다. 또 전단·뒤집힘이
 * 구조적으로 불가능해 외삽이 «레이아웃을 회전·확대해 놓는 것» 이상을 못 한다.
 */
function similarityLeastSquares(canonicalPoints, imagePoints) {
  const count = canonicalPoints.length;
  if (count < 2 || imagePoints.length !== count) return null;
  let meanCx = 0;
  let meanCy = 0;
  let meanIx = 0;
  let meanIy = 0;
  for (let k = 0; k < count; k += 1) {
    meanCx += canonicalPoints[k].x;
    meanCy += canonicalPoints[k].y;
    meanIx += imagePoints[k].x;
    meanIy += imagePoints[k].y;
  }
  meanCx /= count;
  meanCy /= count;
  meanIx /= count;
  meanIy /= count;
  let numeratorA = 0;
  let numeratorB = 0;
  let denominator = 0;
  for (let k = 0; k < count; k += 1) {
    const cx = canonicalPoints[k].x - meanCx;
    const cy = canonicalPoints[k].y - meanCy;
    const ix = imagePoints[k].x - meanIx;
    const iy = imagePoints[k].y - meanIy;
    numeratorA += cx * ix + cy * iy;
    numeratorB += cx * iy - cy * ix;
    denominator += cx * cx + cy * cy;
  }
  if (!(denominator > EPSILON)) return null;
  const a = numeratorA / denominator;
  const b = numeratorB / denominator;
  if (!(Math.hypot(a, b) > EPSILON)) return null;
  const out = new Float64Array(9);
  out[0] = a;
  out[1] = -b;
  out[2] = meanIx - (a * meanCx - b * meanCy);
  out[3] = b;
  out[4] = a;
  out[5] = meanIy - (b * meanCx + a * meanCy);
  out[6] = 0;
  out[7] = 0;
  out[8] = 1;
  return out;
}

function similarityHomography(center, scale, angleCos, angleSin) {
  const H = new Float64Array(9);
  H[0] = scale * angleCos;
  H[1] = -scale * angleSin;
  H[2] = center.x;
  H[3] = scale * angleSin;
  H[4] = scale * angleCos;
  H[5] = center.y;
  H[6] = 0;
  H[7] = 0;
  H[8] = 1;
  return H;
}

function liftPoint(point, factor) {
  return {
    x: point.x * factor + (factor - 1) / 2,
    y: point.y * factor + (factor - 1) / 2,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 6. 조립 — 2차 앵커 조기 분기 (2026-08-16 중앙 통일):
//    K3 중앙 × K5 원거리 코어 쌍 → 앵커드 패밀리(v2r2@21/25 · v1r2),
//    앵커드 포즈가 없는 중앙만 v0 360° 회전 스윕.
// ─────────────────────────────────────────────────────────────────────────

/** 라운드 3 — 6 서브앵커(면별 중앙 3 + 코너 3) 정합 → 최소제곱 재적합. */
function refineWithSubPatches(luma, H, patches, cfg) {
  const cellPx = localCellPx(H);
  if (!Number.isFinite(cellPx) || cellPx <= 0.5) return null;
  const canonicalPoints = [];
  const imagePoints = [];
  let correlationSum = 0;
  let worst = Infinity;
  for (const patch of patches.subPatches) {
    const registered = registerPatch(
      luma, H, patch, 0.5 * cellPx, Math.max(0.5, 0.125 * cellPx),
    );
    if (!registered) return null;
    const projectedAnchor = projectPoint(H, patch.anchor);
    if (!projectedAnchor) return null;
    canonicalPoints.push({ x: patch.anchor.x, y: patch.anchor.y });
    imagePoints.push({
      x: projectedAnchor.x + registered.offsetX,
      y: projectedAnchor.y + registered.offsetY,
    });
    correlationSum += registered.correlation;
    worst = Math.min(worst, registered.correlation);
  }
  const refined = homographyLeastSquares(canonicalPoints, imagePoints);
  if (!refined) return null;
  return {
    H: refined,
    meanCorrelation: correlationSum / patches.subPatches.length,
    worstCorrelation: worst,
  };
}

function refinePoseStrict(luma, H0, patches, cfg) {
  const round1 = refineHomographyWithPatches(
    luma, H0, patches, cfg.registrationRangeCells, cfg.registrationStepCells,
  );
  if (!round1 || round1.worstCorrelation < cfg.minimumPatchCorrelation) return null;
  const round2 = refineHomographyWithPatches(
    luma, round1.H, patches, cfg.registrationRange2Cells, cfg.registrationStep2Cells,
  );
  const base = round2 && round2.meanCorrelation >= round1.meanCorrelation ? round2 : round1;
  const round3 = refineWithSubPatches(luma, base.H, patches, cfg);
  if (!round3) return base;
  return round3.meanCorrelation >= base.meanCorrelation - 0.05 ? round3 : base;
}

// ─────────────────────────────────────────────────────────────────────────
// 6b. 부분 앵커 포즈 — 프레임 밖으로 나간 앵커를 레이아웃 지식으로 외삽한다.
//
// **왜 필요한가 (측정)**: 잘린 프레임에서 죽는 곳은 실루엣도 RS 도 아니고 여기다.
// registerPatch 는 투영점의 80% 이상이 프레임 안에 있어야 상관을 내고,
// refineHomographyWithPatches 는 4 앵커를 **전부** 정합해야 한다
// (`if (!registered) return null`). 코너 하나가 5% 잘리면 그 면 코너 패치의 in-frame
// 비율이 67% 로 떨어지고 → 패치 null → 포즈 null → 그 프레임의 참 기하가 아예
// 만들어지지 않는다. 실측(v0X@21 corner-se, 시드 similarity 기준 커버리지):
//   qz 100/100/100/100 · 5% 100/100/67/100 · 10% 100/100/33/100 · 15%·20% 100/100/0/100.
// 잘림 축이 0/9 로 전멸하던 이유가 이 한 줄이다.
//
// **설계**
//   ① 엄격 경로가 성공하면 그대로 쓴다 — 그 경우 동작은 한 비트도 바뀌지 않는다.
//      («클린 프레임이면 안 바뀐다» 가 아니다. 클린 프레임에서도 데이터 필드의 헛
//      시드는 엄격 경로를 실패시키고 앵커를 프레임 밖으로 던져 부분 가지를 연다 —
//      실측 v0X 클린 attempted 7 · completed 2. 지켜지는 성질은 «가지가 안 열린다»
//      가 아니라 «최종 판정이 같다» 이고, 그건 테스트가 on/off 로 단언한다.)
//   ② 엄격 경로가 실패했고, **앵커 투영이 실제로 프레임 밖으로 나간 증거**가 있을 때만
//      부분 경로를 연다. 저대비·오정합으로 죽은 패치는 여기 오지 않는다 (부분 경로는
//      «잘림» 의 구제이지 정합 품질 완화가 아니다).
//   ③ 관측 앵커 ≥ 2 (서로 다른 자리) → similarity 최소제곱. 빠진 앵커는 모델이
//      **레이아웃 좌표로 예측**한다 — 프레임 밖 외삽 코너를 허용한다.
//   ④ 상대 잔차 게이트(§ residualGate): 외삽 앵커가 완성 전 포즈에서 움직인 거리를
//      **관측 잔차 대비 상대값**으로 잰다. 절대 픽셀은 쓰지 않는다.
//   ⑤ 수용은 여전히 CS 게이트(0.78/0.035)가 결정한다 — 완화 0.
// ─────────────────────────────────────────────────────────────────────────

/** 앵커 패치 투영이 프레임 밖으로 나갔는가 — 부분 경로의 발동 조건(잘림 증거). */
function anchorsLeaveFrame(luma, H, patches) {
  for (const patch of [patches.centre, ...patches.corners]) {
    for (const point of patch.points) {
      const image = projectPoint(H, point);
      if (!image) return true;
      if (image.x < 1 || image.y < 1
        || image.x >= luma.width - 1 || image.y >= luma.height - 1) return true;
    }
  }
  return false;
}

/**
 * 상대 잔차 게이트 — 외삽 앵커의 이동량을 **관측 잔차 대비**로 잰다.
 *
 * `observedResidual` = 완성 H 아래 관측 앵커의 RMS 재투영 잔차(셀 단위).
 * `extrapolationDrift` = 외삽 앵커가 완성 전 H 대비 움직인 최대 거리(셀 단위).
 * 바닥값은 **그 라운드의 탐색 반경**이다 — 정합이 원래 허용하는 이동 규모라
 * 임의 상수가 아니고, 셀 단위라 cell_px 에 의존하지 않는다 (절대 픽셀 금지 조항).
 *
 * 관측 앵커가 2개면 similarity 가 정확 적합이라 관측 잔차가 0 이고, 그때는 바닥값
 * 하나가 게이트를 쥔다. 3개 이상이면 과결정이라 잔차가 실제 값을 갖는다.
 */
function residualGate(observedResidual, extrapolationDrift, rangeCells, cfg) {
  const scale = Math.max(observedResidual, rangeCells);
  return extrapolationDrift <= cfg.partialResidualRatio * scale;
}

/**
 * 앵커 패치들을 «관측 / 외삽» 으로 나눈다.
 * 관측 = 엄격 정합 성공, 또는 `partialMinimumCoverage` 이상이 프레임 안에 남아
 * 고정 표본 집합으로 정합에 성공한 것.
 */
function classifyPatchRegistrations(luma, H, patchList, rangePx, stepPx, cfg) {
  const observed = [];
  const extrapolated = [];
  let correlationSum = 0;
  let worst = Infinity;
  let partialCount = 0;
  for (const patch of patchList) {
    let registered = registerPatch(luma, H, patch, rangePx, stepPx);
    let partial = false;
    if (!registered) {
      registered = registerPatch(luma, H, patch, rangePx, stepPx, {
        minCoverage: cfg.partialMinimumCoverage,
        lockSubset: true,
      });
      partial = registered !== null;
    }
    const projectedAnchor = projectPoint(H, patch.anchor);
    if (!projectedAnchor) return null;
    if (!registered) {
      extrapolated.push({ patch, seedImage: projectedAnchor });
      continue;
    }
    if (partial) partialCount += 1;
    observed.push({
      patch,
      seedImage: projectedAnchor,
      image: {
        x: projectedAnchor.x + registered.offsetX,
        y: projectedAnchor.y + registered.offsetY,
      },
      correlation: registered.correlation,
    });
    correlationSum += registered.correlation;
    worst = Math.min(worst, registered.correlation);
  }
  return { observed, extrapolated, correlationSum, worst, partialCount };
}

/** 관측 앵커의 RMS 재투영 잔차(셀 단위) — 완성 모델이 관측을 얼마나 못 맞췄나. */
function observedResidualCells(H, observed, cellPx) {
  if (observed.length === 0 || !(cellPx > 0)) return Infinity;
  let sum = 0;
  for (const entry of observed) {
    const predicted = projectPoint(H, entry.patch.anchor);
    if (!predicted) return Infinity;
    sum += (predicted.x - entry.image.x) ** 2 + (predicted.y - entry.image.y) ** 2;
  }
  return Math.sqrt(sum / observed.length) / cellPx;
}

/** 외삽 앵커가 완성 전 포즈 대비 움직인 최대 거리(셀 단위). */
function extrapolationDriftCells(H, extrapolated, cellPx) {
  if (!(cellPx > 0)) return Infinity;
  let worst = 0;
  for (const entry of extrapolated) {
    const predicted = projectPoint(H, entry.patch.anchor);
    if (!predicted) return Infinity;
    worst = Math.max(worst, Math.hypot(
      predicted.x - entry.seedImage.x, predicted.y - entry.seedImage.y,
    ) / cellPx);
  }
  return worst;
}

/** 관측 앵커가 서로 다른 자리를 차지하는가 — 한 점에 뭉친 2개는 포즈를 못 세운다. */
function anchorsAreDistinct(observed) {
  for (let a = 0; a < observed.length; a += 1) {
    for (let b = a + 1; b < observed.length; b += 1) {
      const left = observed[a].patch.anchor;
      const right = observed[b].patch.anchor;
      if (Math.hypot(left.x - right.x, left.y - right.y) > 1) return true;
    }
  }
  return false;
}

/** 부분 앵커 라운드 — 4앵커(중앙 + 면별 먼 코너 3) 중 관측된 것만으로 완성한다. */
function refineAnchorsPartial(luma, H, patches, rangeCells, stepCells, cfg) {
  const cellPx = localCellPx(H);
  if (!Number.isFinite(cellPx) || cellPx <= 0.5) return null;
  const classified = classifyPatchRegistrations(
    luma, H, [patches.centre, ...patches.corners],
    rangeCells * cellPx, Math.max(0.5, stepCells * cellPx), cfg,
  );
  if (!classified) return null;
  const { observed, extrapolated } = classified;
  if (observed.length < cfg.partialMinimumAnchors) return null;
  if (!anchorsAreDistinct(observed)) return null;
  const canonicalPoints = observed.map((entry) => entry.patch.anchor);
  const imagePoints = observed.map((entry) => entry.image);
  const completed = extrapolated.length === 0
    ? (observed.length === 4
      ? estimateHomography4(canonicalPoints, imagePoints)
      : similarityLeastSquares(canonicalPoints, imagePoints))
    : similarityLeastSquares(canonicalPoints, imagePoints);
  if (!completed) return null;
  const residual = observedResidualCells(completed, observed, cellPx);
  const drift = extrapolationDriftCells(completed, extrapolated, cellPx);
  if (!residualGate(residual, drift, rangeCells, cfg)) return null;
  return {
    H: completed,
    meanCorrelation: classified.correlationSum / observed.length,
    worstCorrelation: classified.worst,
    anchorCount: observed.length,
    extrapolatedCount: extrapolated.length,
    partialCount: classified.partialCount,
    observedResidual: residual,
    extrapolationDrift: drift,
  };
}

/** 부분 앵커 라운드 3 — 서브앵커 중 관측된 것만으로 최소제곱 재적합. */
function refineSubPatchesPartial(luma, H, patches, cfg) {
  const cellPx = localCellPx(H);
  if (!Number.isFinite(cellPx) || cellPx <= 0.5) return null;
  const rangeCells = 0.5;
  const classified = classifyPatchRegistrations(
    luma, H, patches.subPatches, rangeCells * cellPx, Math.max(0.5, 0.125 * cellPx), cfg,
  );
  if (!classified) return null;
  const { observed, extrapolated } = classified;
  if (observed.length < cfg.partialMinimumSubAnchors) return null;
  const canonicalPoints = observed.map((entry) => entry.patch.anchor);
  const imagePoints = observed.map((entry) => entry.image);
  // 관측 서브앵커가 충분히 많을 때만 8 dof 를 푼다. 적을 때 호모그래피를 풀면
  // 원근 항이 관측 잡음을 그대로 먹어 외삽 코너가 크게 튄다 (전단·뒤집힘 가능).
  const completed = observed.length >= cfg.partialHomographySubAnchors
    ? (homographyLeastSquares(canonicalPoints, imagePoints)
      || similarityLeastSquares(canonicalPoints, imagePoints))
    : similarityLeastSquares(canonicalPoints, imagePoints);
  if (!completed) return null;
  const residual = observedResidualCells(completed, observed, cellPx);
  const drift = extrapolationDriftCells(completed, extrapolated, cellPx);
  if (!residualGate(residual, drift, rangeCells, cfg)) return null;
  return {
    H: completed,
    meanCorrelation: classified.correlationSum / observed.length,
    worstCorrelation: classified.worst,
    anchorCount: observed.length,
    extrapolatedCount: extrapolated.length,
    observedResidual: residual,
    extrapolationDrift: drift,
  };
}

function refinePosePartial(luma, H0, patches, cfg) {
  const round1 = refineAnchorsPartial(
    luma, H0, patches, cfg.registrationRangeCells, cfg.registrationStepCells, cfg,
  );
  // 정합 품질 게이트는 엄격 경로와 **같은 값**을 쓴다 — 부분 경로는 잘림 구제이지
  // 상관 문턱 완화가 아니다.
  if (!round1 || round1.worstCorrelation < cfg.minimumPatchCorrelation) return null;
  const round2 = refineAnchorsPartial(
    luma, round1.H, patches, cfg.registrationRange2Cells, cfg.registrationStep2Cells, cfg,
  );
  const base = round2 && round2.meanCorrelation >= round1.meanCorrelation ? round2 : round1;
  const round3 = refineSubPatchesPartial(luma, base.H, patches, cfg);
  const chosen = round3 && round3.meanCorrelation >= base.meanCorrelation - 0.05
    ? round3 : base;
  return {
    ...chosen,
    partial: {
      anchorCount: base.anchorCount,
      extrapolatedCount: base.extrapolatedCount,
      subAnchorCount: round3 ? round3.anchorCount : null,
      observedResidual: chosen.observedResidual,
      extrapolationDrift: chosen.extrapolationDrift,
    },
  };
}

/**
 * 포즈 정제 — 엄격 4앵커 경로가 먼저다. 실패했고 **앵커가 프레임 밖으로 나갔을 때만**
 * 부분 앵커 완성으로 내려간다.
 *
 * ⚠ «클린 프레임에서는 두 번째 가지가 아예 열리지 않는다» 고 적혀 있었으나 **거짓**이다
 * (2026-08-16 정정). 데이터 필드의 헛 시드(예: n=25 반경으로 스냅된 쌍)는 스케일이 틀려
 * 클린 이미지에서도 앵커를 프레임 밖으로 던진다 — 실측 v0X 클린 `attempted 7 ·
 * completed 2`, v2r2 `2 · 2`, v0@13 `1 · 1`, v1r2 `0 · 0`. 그렇게 선 포즈들은 하류
 * CS 게이트를 못 넘거나 패밀리 dedupe 에서 밀려 **최종 판정을 바꾸지 않는다**. 이 경로가
 * 지키는 성질은 «시도 0» 이 아니라 «판정 불변» 이고, 그쪽이 테스트로 고정돼 있다.
 */
function refinePose(luma, H0, patches, cfg, telemetry = null) {
  const strict = refinePoseStrict(luma, H0, patches, cfg);
  if (strict) return strict;
  if (cfg.partialAnchorPose === false) return null;
  if (!anchorsLeaveFrame(luma, H0, patches)) return null;
  if (telemetry) telemetry.attempted += 1;
  const partial = refinePosePartial(luma, H0, patches, cfg);
  if (telemetry && partial) {
    telemetry.completed += 1;
    telemetry.byAnchorCount[partial.partial.anchorCount] =
      (telemetry.byAnchorCount[partial.partial.anchorCount] || 0) + 1;
  }
  return partial;
}

/**
 * 앵커드 패밀리 후보표 — 중앙(K3)에서 K5 원거리 코어까지의 canonical 거리(셀).
 *   · v2r2: 블록 B 7×7 코어 중심 = 셀 (n−4,n−4) 중심 → (n−3.5) — 21→17.5 · 25→21.5.
 *   · v1r2: 면 T SE 5×5 코어 중심 = (17.5,17.5) → 18.0
 *     (셀 (c,c) 중심의 원점 거리 = (c+0.5)·u — 같은 규칙).
 * 스냅 허용폭 ±3.2셀 (마스크 침식이 u 를 부풀린다 — 종전 근거 유지).
 * v2r2@21(17.5)과 v1r2(18.0)는 거리로 갈라지지 않는다 — 둘 다 후보 포즈를 세우고
 * 수용은 CS 평가 게이트가 판정한다 (n=21 병행 평가 계약, formatIndex 불변).
 */
const ANCHOR_SNAP_CELLS = 3.2;
const V1R2_CORE_RADIUS_CELLS = 18;
const V1R2_N = 21;
const V2R2_RADII = Object.freeze([
  Object.freeze({ n: 21, radius: 17.5 }),
  Object.freeze({ n: 25, radius: 21.5 }),
]);
/** v2r2 드랍 기본값의 «후보 0개» 표 — 루프 형태를 바꾸지 않고 시드만 0 으로 만든다. */
const EMPTY_RADII = Object.freeze([]);

/**
 * v0X — SE (15..20)² 동심 사각의 암 2×2 코어 중심은 셀 경계 (18,18) 이라 중앙에서
 * **18.0셀**, v1r2 SE 5×5 코어와 같은 반경이다. 거리로는 안 갈라진다.
 *
 * **사각 링 서명 (측정, 2026-08-16 · 정본 정규화 2026-08-16 재측정)** — v0X SE 블록은
 * 3면 톤이 같아(정규화 전 35/36 → 지금 **36/36**, (19,19).R 복원) 세 면이
 * 각각 같은 K5 회문 코어를 낸다. 그래서 클린 프레임에서 'v2r2-corner' 히트가
 * **120° 간격 3개**로 뜬다 (재측정 2026-08-16: 각 150.1° · 30.2° · −90.0°,
 * r/u 18.55~18.65 — 정규화 전후 동일한 세 자리다).
 *
 * 판별자는 «코너 개수» 가 **아니라 동반자 쌍 수**다. 코너 수는 프레임마다 흔들린다
 * (재측정 2026-08-16, 6채널 clean/sCurve0.6/gamma0.7/gamma0.6/rot120/rot240:
 * v0X 3~4 · v1r2 0~2 · v2r2@21 1~4 · v0 0~2 — 회전·톤 프레임에서 데이터 필드의 우연
 * K5 가 코너로 올라온다). 반면 **동반자 쌍은 v0X 6~8, v1r2·v2r2·v0 는 전 채널 0** 이다.
 * 중앙 서명(K3)은 네 레이아웃이 공유하므로 판별에 쓸 수 없다.
 *
 * 이 동반자 조건을 **v0X 시딩 게이트로 쓴다** (cfg.v0xRequireSquareRing). 게이트를
 * 켜기 전에 실패 모드를 먼저 쟀다 — «저게인 면(R 0.52)의 코어가 먼저 죽어 동반자가
 * 0 이 되면 v0X 가 통째로 죽는다» 가 유일한 위험인데, 합성 측정에서는 일어나지 않았다:
 *   · 49-매트릭스(톤 7 × 회전 7) v0X 프레임 49/49 에서 동반자 쌍 ≥ 2 (최빈 4~8).
 *   · cell_px 7·8·9·10·12·15 × 채널 5 × 회전 3 × 2·3톤 = 180 프레임에서도 **v0X 포즈가
 *     0 인 프레임이 한 번도 없었다** (정규화 후 최소 3 · cell_px 별 최소 3~6; 정규화
 *     전에도 최소 3 — 이 축은 정규화에 안 움직인다). cell_px 7 은 이미 복호가
 *     흔들리는 자리인데도 신호는 남았다 — 동심 사각의 코어는 링보다 굵어 마지막까지 버틴다.
 *   · ⚠ 다만 **복호 자체는 cell_px 7 에서 정규화로 21/30 → 17/30 로 내렸다**
 *     (실패 단계는 frontend:no-grid-hypothesis — 로케이터가 아니라 그 앞이다).
 *     cell_px 8 이상은 30/30 불변. 자세한 귀속은 test/output/claude-v0x-normalize.md §5.
 * 반대편(게이트가 잡아 주는 것)도 쟀다 — 같은 하네스에서 v1r2 프레임의 헛 v0x 포즈
 * 98개 중 94개, v2r2@21 162개 중 113개, Type O/A 프레임의 헛 포즈 **28개 전부**가
 * 동반자 0 프레임에서 나왔다. 게이트가 없으면 n=21 프레임마다 refinePose 가 한 번씩
 * 더 돌아 복호 중앙값이 10~19% 오른다 (실측, §벤치).
 *
 * 게이트를 통과한 뒤에는 세 후보 코너 각각을 «면 T 의 먼 코너» 로 가정해 시드하고
 * (→ 120° 위상 3가설), 패치 Pearson 이 참 위상을 고른다.
 */
const V0X_CORE_RADIUS_CELLS = 18;
const V0X_N = 21;

/**
 * v0W — 동심 사각이 v0X 와 **같은 블록**인데 앉은 자리가 다르다.
 *
 * v0X 는 SE (15..20)² = 면마다 «먼 꼭짓점»(C0·C2·C4), v0W 는 NE (0..5)×(15..20) =
 * 면마다 «심(seam) 꼭짓점»(C1·C3·C5)이다. 블록 무게중심 (a,b) = (3,18) 이고 두 기저의
 * 사잇각이 120° 이므로 닫힌 형태로
 *   r² = a² + b² − a·b = 9 + 324 − 54 = 279 → r = √279 = 16.7033셀
 * — v0xq 의 CORNER 와 **같은 반경**이다 (같은 블록·같은 자리). v0X 의 18.0 과는
 * 1.30셀 차이라 `ANCHOR_SNAP_CELLS`(3.2) 안에서 거리로 못 가른다.
 *
 * v0xq 와 갈리는 것은 **중앙**이다 — v0W 는 K3 불스아이가 있어 앵커드 경로를 타고,
 * v0xq 는 중앙이 QR 이라 코너 삼중점 경로를 탄다. 그래서 v0W 는 여기, v0xq 는
 * `assembleV0xqPoses` 에 산다.
 *
 * canonical 앵커 방향은 **(0,−1) 이 아니다** (면 T 실측 θ = −141.1°) — 그래서
 * `anchoredSimilaritySeedTo` 를 쓴다. 자세한 근거는 그 함수 주석과
 * `test/output/lanes/claude-v0w-probe-geom.mjs`.
 */
const V0W_CORE_RADIUS_CELLS = Math.sqrt(279);
const V0W_N = 21;

/**
 * v0W2 — NE 동심 사각이 v0W 와 **같은 배열·같은 자리**라 코어 반경도 같은 √279 다.
 * 그래서 v0W2 는 v0W 바로 뒤에 같은 (중앙, 코너) 쌍에서 시드된다. 두 패밀리를 가르는
 * 것은 거리가 아니라 refinePose 의 패치 Pearson 과 하류 CS 게이트다.
 */
const V0W2_CORE_RADIUS_CELLS = V0W_CORE_RADIUS_CELLS;
const V0W2_N = 21;

/**
 * v0WY — NE 동심 사각이 v0W 와 **같은 배열·같은 자리**라 코어 반경도 같다 (√279).
 * 즉 시드 기하로는 v0W·v0W2 와 한 톨도 안 갈라진다. §v0wyFamily 의 ⓐⓑⓒ 가 가른다.
 */
const V0WY_CORE_RADIUS_CELLS = V0W_CORE_RADIUS_CELLS;
const V0WY_N = 21;

/**
 * v0T — NE 동심 사각이 v0W 계열과 **같은 배열·같은 자리**라 코어 반경도 같다 (√279).
 * 중앙은 K3 계보의 (0..3)² 16셀 대칭화본 — `verifyV0Cluster` 의 'v0-center' 서명은
 * 같은 K3 계보라 그대로 잡는다 (v0X 의 NW 16 이 같은 자리에서 잡혀 온 전례).
 * v0W 계열이 드랍으로 꺼진 뒤에도 이 브랜치는 독립으로 돈다.
 */
const V0T_CORE_RADIUS_CELLS = V0W_CORE_RADIUS_CELLS;
const V0T_N = 21;

/** v0TY — 중앙·NE 가 v0T 와 같은 배열이라 시드 기하가 같다. 슬롯 QR 확증이 가른다. */
const V0TY_CORE_RADIUS_CELLS = V0W_CORE_RADIUS_CELLS;
const V0TY_N = 21;

/**
 * v0TR — 코너 앵커가 NE **바깥** 동심 사각이라 반경이 √279 로 v0W 계열·v0T·v0TY 와 같다.
 *
 * ⚠ **여기에 «√129 로 갈라진다» 를 쓸 뻔했다 — 실측이 기각했다.** 정본의 NE 안쪽
 * 동심 사각(무게중심 (5,13) → r² = 25+169−65 = 129 → 11.3578셀)은 √279 와 5.35셀
 * 떨어져 `ANCHOR_SNAP_CELLS`(3.2) 밖이라, 코너로 삼으면 «최종 라인업에서 처음으로
 * 거리로 갈리는 계열» 이 될 수 있었다. 그런데 **실물 프레임에서 안쪽 코어가 엄격
 * 코너(`verifyV2r2Cluster`)로 검증되지 않는다** — 바깥 사각과 맞닿아 있어 «배경으로
 * 열린다» 를 못 만들기 때문이다. 앵커드 경로는 엄격 목록만 보므로 v0TR 자기
 * 프레임의 포즈가 0 이 됐다 (실측 `claude-v0tr-detect-debug.mjs`).
 * 그래서 반경은 v0T 와 같은 √279 이고, **같은 (중앙, 코너) 쌍에서 시드된다** —
 * 가르는 것은 refinePose 의 패치 Pearson (안쪽 사각 36 + SE 9 서브앵커) 과
 * 하류 CS 게이트다 (v0W ↔ v0W2 ↔ v0T 와 같은 구조).
 *
 * 값은 **손으로 적지 않는다.** 브리프 규약대로 `patchesFor(...).corners[0].anchor` —
 * 즉 v0T 반경이 만들어지는 것과 **같은 경로** — 에서 그대로 뽑는다. 정본 블록이
 * 움직이면 이 반경도 같이 움직인다 (닫힌 형태 상수를 박아 두면 조용히 어긋난다).
 * 실측 대조: `test/output/lanes/claude-v0tr-measure.mjs` ⓑ.
 */
const V0TR_N = 21;
const V0TR_CORE_RADIUS_CELLS = (() => {
  const anchor = patchesFor(V0TR_N, 'v0tr').corners[0].anchor;
  return Math.hypot(anchor.x, anchor.y);
})();
/** v0TRQ — 코너가 v0TR 과 같은 배열(안쪽 사각)이라 삼중점 반경도 같다. */
const V0TRQ_N = 21;
/**
 * v0TRY — 코너가 v0TR 과 **같은 배열**(NE 바깥 사각)이다. 슬롯이 SE 쪽이라 NE 를 한
 * 셀도 안 건드리므로 반경이 v0TR 과 **같다** (실측 Δ = 0.000000 —
 * `claude-v0try-measure.mjs` ⓔ). v0T ↔ v0TY 와 같은 관계다.
 * 값은 여기서도 손으로 적지 않고 **같은 경로**에서 뽑는다.
 */
const V0TRY_N = 21;
const V0TRY_CORE_RADIUS_CELLS = (() => {
  const anchor = patchesFor(V0TRY_N, 'v0try').corners[0].anchor;
  return Math.hypot(anchor.x, anchor.y);
})();

/**
 * 패치의 동적 범위 (p95−p5) — §v0wySlotQrMinSpanRatio (span 상응성) 의 재료.
 * `centreQrFinderContrast` 의 분모와 같은 식이되 role 무관 전 표본이다.
 * 표본 부족은 null — 호출부가 거절로 읽는다 (null 을 «통과» 로 읽지 않는다).
 */
function patchSpan(luma, H, patch, offsetX, offsetY) {
  const values = [];
  for (const point of patch.points) {
    const image = projectPoint(H, point);
    if (!image) continue;
    const value = bilinear(luma, image.x + offsetX, image.y + offsetY);
    if (value === null) continue;
    values.push(value);
  }
  if (values.length < 20) return null;
  values.sort((left, right) => left - right);
  const pick = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  return pick(0.95) - pick(0.05);
}

/**
 * ★ v0WY 슬롯 QR 확증 — 봉합 ② (`centreQrFinderContrast`) 를 **먼 코너 패치에 재사용**.
 *
 * 부르는 자리가 다르다: 봉합 ②는 «가짜 삼중점» 을 시드 단계에서 잘랐지만, v0WY 는
 * 시드 기하가 v0W 와 같아 시드 단계에서 자를 것이 없다 (자르면 v0W 도 같이 죽는다).
 * 그래서 **refinePose 를 통과한 뒤** 부른다 — 재는 명제는 «이 포즈가 주장하는 먼 코너에
 * 실제로 QR 이 있는가» 이고, 아니면 그 포즈는 v0W 프레임 위에 선 v0WY 가설이다.
 *
 * 정합된 H 에서 다시 registerPatch 를 한 번 도는 것은 시드 어긋남 보정이다 (봉합 ②가
 * `probe.offsetX/Y` 를 쓴 것과 같은 이유). 실패(표본 부족·정합 실패)는 **거절**이다 —
 * null 을 «통과» 로 읽지 않는다.
 */
function slotQrConfirmsPose(fullLuma, H, patches, cfg, enabled = cfg.v0wyRequireSlotQr) {
  // `enabled` 기본값은 v0wy 스위치 — 기존 호출부는 인자 없이 불러 비트 동일하다.
  // v0TY 호출부는 `cfg.v0tyRequireSlotQr` 를 명시로 넘긴다 (스위치 독립 — 한쪽의
  // A/B 대조군이 다른 쪽 확증을 조용히 끄면 안 된다). 문턱 3종은 공유한다 (§v0tyRequireSlotQr).
  if (enabled === false) return true;
  if (!patches.slotQr) return false;
  const cellPx = localCellPx(H);
  if (!Number.isFinite(cellPx) || cellPx <= 0.5) return false;
  const probe = registerPatch(
    fullLuma, H, patches.slotQr,
    cfg.registrationRange2Cells * cellPx,
    Math.max(0.5, cfg.registrationStepCells * cellPx),
  );
  // 상관 하한 (§v0wySlotQrMinCorrelation) — 정합이 실제로 선 프로브만 신뢰한다.
  // 이것이 없으면 무늬 없는 슬롯에서 쓰레기 offset 이 contrast 판별을 어긋난 H 위로
  // 끌고 가, span 붕괴로 값이 폭발한다 (결함 B — 확증이 열리는 쪽으로 실패했다).
  if (!probe || probe.correlation < cfg.v0wySlotQrMinCorrelation) return false;
  // span 상응성 (§v0wySlotQrMinSpanRatio) — contrast 는 눈금 없는 자라, 분모(슬롯
  // 패치 자신의 동적 범위)가 무너지면 무늬 없는 슬롯의 잔재 기울기로도 폭발한다.
  // 같은 포즈의 중앙 불스아이가 눈금이다 — 같은 H·같은 프레임이라 톤·게인이 약분된다.
  const slotSpan = patchSpan(fullLuma, H, patches.slotQr, probe.offsetX, probe.offsetY);
  const centreSpan = patchSpan(fullLuma, H, patches.centre, 0, 0);
  if (slotSpan === null || centreSpan === null || !(centreSpan > EPSILON)
    || slotSpan < cfg.v0wySlotQrMinSpanRatio * centreSpan) return false;
  const contrast = centreQrFinderContrast(
    fullLuma, H, patches.slotQr, probe.offsetX, probe.offsetY,
  );
  return contrast !== null && contrast >= cfg.v0wySlotQrMinContrast;
}

/**
 * 코너 하나에 대해, 같은 중앙 기준으로 ±120° 회전 위치에 다른 코너가 있는지 센다.
 * 0..2. 결정성: corners 배열의 고정 순서로만 순회한다.
 */
function squareRingCompanions(centre, corner, corners, cfg) {
  const baseX = corner.x - centre.x;
  const baseY = corner.y - centre.y;
  const baseR = Math.hypot(baseX, baseY);
  if (!(baseR > EPSILON)) return 0;
  const baseAngle = Math.atan2(baseY, baseX);
  const angleTolerance = (cfg.squareRingAngleToleranceDeg * Math.PI) / 180;
  let found = 0;
  for (const turn of [1, -1]) {
    const wantAngle = baseAngle + (turn * 2 * Math.PI) / 3;
    for (const other of corners) {
      if (other === corner) continue;
      const dx = other.x - centre.x;
      const dy = other.y - centre.y;
      const r = Math.hypot(dx, dy);
      if (!(r > EPSILON)) continue;
      if (Math.abs(r - baseR) > cfg.squareRingRadiusTolerance * baseR) continue;
      let delta = Math.atan2(dy, dx) - wantAngle;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      if (Math.abs(delta) > angleTolerance) continue;
      found += 1;
      break;
    }
  }
  return found;
}

/**
 * 사각 링 동반자 — **게이트용** 값. 넓은 풀(`ringPool`)까지 훑는다.
 *
 * ⚠ 왜 `companions` 와 **따로** 두는가 (2026-08-17 회귀에서 배운 것):
 * `squareRingCompanions` 는 게이트일 뿐 아니라 **정렬 키**다 —
 * `familyPoses.sort` 의 첫 항목이 `squareRingCompanions` 이고, 그 뒤
 * `maximumPosesPerFamily(2)` 로 잘린다. 풀만 넓혀서 이 값을 키웠더니 포즈 **순위**가
 * 바뀌어 옳은 포즈가 상위 2 밖으로 밀렸고, v0T·v0W2 자기 복호가 깨졌다
 * (스위트 fail 1 → 5). 그래서 **포즈에 싣는 값·telemetry 는 종전(캡된 목록) 그대로**
 * 두고, 여기 값은 «증거가 있나» 라는 **불리언 판정에만** 쓴다.
 *
 * 풀이 같으면(스위치 off) 재계산 없이 종전 값을 그대로 돌려준다 — 비트 동일.
 */
function companionsForGate(centre, corner, corners, ringPool, cfg, companions) {
  if (ringPool === corners) return companions;
  if (companions !== 0) return companions;
  return squareRingCompanions(centre, corner, ringPool, cfg);
}

/** 중앙+원거리 쌍의 similarity 시드 — canonical 대각 (0,−1)·radius → 코너.
 *  R·(0,−1) = w 에서 cos = −wy, sin = wx. */
function anchoredSimilaritySeed(centre, corner, factor, radiusCells) {
  const centreFull = liftPoint(centre, factor);
  const cornerFull = liftPoint(corner, factor);
  const scale = Math.hypot(cornerFull.x - centreFull.x, cornerFull.y - centreFull.y)
    / radiusCells;
  const wx = (cornerFull.x - centreFull.x) / (scale * radiusCells);
  const wy = (cornerFull.y - centreFull.y) / (scale * radiusCells);
  return similarityHomography(centreFull, scale, -wy, wx);
}

/**
 * 같은 시드의 **일반형** — canonical 앵커 방향이 (0,−1) 이 아닌 패밀리용.
 *
 * 위 `anchoredSimilaritySeed` 는 «면 T 의 원거리 코어가 canonical (0,−1)·r 에 있다» 를
 * 전제한다. v0·v0X·v1r2·v2r2 는 원거리 블록이 **먼 꼭짓점**(C0·C2·C4)에 앉아 그 전제가
 * 참이다(실측 θ = −90.0°). v0W 의 NE 동심 사각은 **심 꼭짓점**(C1·C3·C5)이라
 * θ = −141.1° 이므로 그대로 쓰면 51.1° 틀어진 시드가 나온다
 * (`test/output/lanes/claude-v0w-probe-geom.mjs` 실측).
 *
 * p̂ = canonicalPoint 의 단위벡터, w = (코너−중앙) 의 단위벡터일 때
 * R·p̂ = w 인 회전은 cos = w·p̂ · sin = w × p̂ 다. p̂ = (0,−1) 을 넣으면
 * cos = −wy · sin = wx 로 위 함수와 정확히 같아진다 — 즉 일반형이 특수형을 포함한다.
 * 그래도 기존 호출부는 **건드리지 않는다**: 부동소수 연산 순서가 달라지면
 * 기존 패밀리의 포즈가 비트 단위로 흔들릴 수 있고, 이 레인의 합격선은 무회귀다.
 */
function anchoredSimilaritySeedTo(centre, corner, factor, canonicalPoint) {
  const centreFull = liftPoint(centre, factor);
  const cornerFull = liftPoint(corner, factor);
  const radius = Math.hypot(canonicalPoint.x, canonicalPoint.y);
  const dx = cornerFull.x - centreFull.x;
  const dy = cornerFull.y - centreFull.y;
  const distance = Math.hypot(dx, dy);
  if (!(radius > EPSILON) || !(distance > EPSILON)) return null;
  const scale = distance / radius;
  const wx = dx / distance;
  const wy = dy / distance;
  const px = canonicalPoint.x / radius;
  const py = canonicalPoint.y / radius;
  return similarityHomography(centreFull, scale, wx * px + wy * py, wy * px - wx * py);
}

/**
 * 앵커드 조립 — 세 패밀리의 중앙이 같은 K3 서명을 공유하므로(2026-08-16 중앙 통일)
 * 패밀리·n 판별은 **2차 앵커(K5 원거리 코어)의 존재/부재**가 맡는다. 중앙 히트
 * 하나에서 세 패밀리를 순차 시도하지 않는다:
 *   · 거리 스냅이 맞는 중앙×코너 쌍 → 앵커드 패밀리 포즈. 허용폭 안 후보는
 *     **전부** 시드한다. 드랍(2026-08-16 v2r2·v1r2 · 2026-08-17 v0X)으로 기본
 *     앵커드 패밀리는 **v0W · v0W2 둘**이다 — v2r2(@21·@25)·v1r2·v0X 는 cfg
 *     스위치가 off 라 쌍당 refinePose 가 6회 → 2회로 준다. 스위치를 켜면 여섯이
 *     그대로 돌아온다 (대조군·법의학).
 *   · 시드는 2앵커 similarity (면 T 원거리 코어가 120° 위상을 즉시 확정 — 스윕 없음),
 *     4앵커 직접 DLT 는 refinePose 라운드 1·2, 6~12 서브앵커 최소제곱은 라운드 3.
 * 반환의 anchoredCentres 는 **앵커드 포즈가 실제로 선** 중앙 인덱스다 — v0 스윕
 * 조기 분기의 조건. 결정성: centres/corners 는 verified 정렬 순서로만 순회한다.
 */
function assembleAnchoredPoses(
  centres, corners, fullLuma, factor, cfg, telemetry = null, companionPool = null,
) {
  // 사각 링 동반자 게이트만 **잘리지 않은** 코너 목록을 본다 (§squareRingUsesFullCornerPool).
  // 쌍 순회(= refinePose 예산)는 여전히 캡된 `corners` 위에서 돈다 — 비용 불변.
  const ringPool = cfg.squareRingUsesFullCornerPool !== false && Array.isArray(companionPool)
    ? companionPool
    : corners;
  const posesV2r2 = [];
  const posesV1r2 = [];
  const posesV0x = [];
  const posesV0w = [];
  const posesV0w2 = [];
  const posesV0wy = [];
  const posesV0t = [];
  const posesV0ty = [];
  const posesV0tr = [];
  const posesV0try = [];
  const anchoredCentres = new Set();
  let companionPairs = 0;
  let slotQrRejected = 0;
  for (let centreIndex = 0; centreIndex < centres.length; centreIndex += 1) {
    const centre = centres[centreIndex];
    for (const corner of corners) {
      const distance = Math.hypot(corner.x - centre.x, corner.y - centre.y);
      if (!(distance > 6 * centre.u)) continue;
      // v0-center 의 u 는 셀 크기다 (t1 = 2셀 → u = t1/2).
      const estimatedRadius = distance / Math.max(centre.u, EPSILON);
      // v2r2 — **드랍(2026-08-16)으로 기본 off**. cfg.v2r2Family === true 로 켜면
      // 아래 로직이 드랍 전 그대로 돈다 (대조군·법의학).
      //
      // 허용폭 안 후보 **전부** 정합한다 (가장 가까운 n 단독 스냅 금지).
      // 톤 커브가 밝은 링을 침식하면 u 가 부풀어 21↔25 겹침 구간(18.3~20.7셀)에서
      // 오스냅되는데, 그때 진짜 n 포즈가 아예 시드되지 않아 프레임이 죽는다
      // (S-커브 0.6 rot135 실측). 대신 **쌍마다 정합 점수 최고 n 하나만 채택**한다 —
      // 잘못된 n 의 포즈는 CS 게이트가 어차피 기각하므로 순수한 하류 비용(shape 마다
      // n² 표본 CS 평가)일 뿐이고, 같은 쌍에서는 참 n 이 패치 Pearson 을 이긴다.
      // 동률은 앞선 후보(작은 n)가 이긴다 — 결정성.
      let bestV2r2 = null;
      for (const candidate of (cfg.v2r2Family === true ? V2R2_RADII : EMPTY_RADII)) {
        if (Math.abs(estimatedRadius - candidate.radius) > ANCHOR_SNAP_CELLS) continue;
        const H0 = anchoredSimilaritySeed(centre, corner, factor, candidate.radius);
        const refined = refinePose(fullLuma, H0, patchesForN(candidate.n), cfg, telemetry);
        if (refined && (bestV2r2 === null || refined.meanCorrelation > bestV2r2.score)) {
          bestV2r2 = {
            n: candidate.n,
            H: refined.H,
            score: refined.meanCorrelation,
            partial: refined.partial || null,
          };
        }
      }
      if (bestV2r2 !== null) {
        anchoredCentres.add(centreIndex);
        posesV2r2.push({
          family: 'v2r2',
          n: bestV2r2.n,
          H: bestV2r2.H,
          score: bestV2r2.score,
          partial: bestV2r2.partial,
          estimatedRadius,
        });
      }
      // v1r2 (n=21 A/B 후보) — **드랍(2026-08-16)으로 기본 off**.
      // cfg.v1r2Family === true 로 켜면 A/B 대조군이 그대로 돌아온다.
      if (cfg.v1r2Family === true
        && Math.abs(estimatedRadius - V1R2_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        const H0 = anchoredSimilaritySeed(centre, corner, factor, V1R2_CORE_RADIUS_CELLS);
        const refined = refinePose(fullLuma, H0, patchesFor(V1R2_N, 'v1r2'), cfg, telemetry);
        if (refined) {
          anchoredCentres.add(centreIndex);
          posesV1r2.push({
            family: 'v1r2',
            layoutId: 'v1r2',
            n: V1R2_N,
            H: refined.H,
            score: refined.meanCorrelation,
            partial: refined.partial || null,
            estimatedRadius,
          });
        }
      }
      // v0X — **드랍(2026-08-17)으로 기본 off**. cfg.v0xFamily === true 로 켜면
      // 아래 로직이 드랍 전 그대로 돈다 (대조군·법의학).
      // v1r2 와 같은 반경 18.0 이라 거리로는 안 갈라진다. 가르는 것은
      // **사각 링 동반자**(3면 동일 SE 블록의 120° 쌍둥이 코어)다.
      if (cfg.v0xFamily !== false
        && Math.abs(estimatedRadius - V0X_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        const companions = squareRingCompanions(centre, corner, corners, cfg);
        const gateCompanions = companionsForGate(centre, corner, corners, ringPool, cfg, companions);
        if (companions > 0) companionPairs += 1;
        // 게이트 실패는 **v0X 시딩만** 건너뛴다. 예전에는 `continue` 로 코너 반복
        // 자체를 끊었는데, 그때는 뒤에 아무 패밀리도 없어 결과가 같았다. v0W 가
        // 뒤에 붙으면서 «v0X 게이트가 v0W 를 대신 자르는» 결합이 생기므로 끊는다
        // (기존 패밀리 동작은 비트 단위로 동일 — 뒤에 코드가 없던 자리의 형태 변경).
        if (gateCompanions !== 0 || cfg.v0xRequireSquareRing === false) {
          const H0 = anchoredSimilaritySeed(centre, corner, factor, V0X_CORE_RADIUS_CELLS);
          const refined = refinePose(fullLuma, H0, patchesFor(V0X_N, 'v0x'), cfg, telemetry);
          if (refined) {
            anchoredCentres.add(centreIndex);
            posesV0x.push({
              family: 'v0x',
              layoutId: 'v0x',
              n: V0X_N,
              H: refined.H,
              score: refined.meanCorrelation,
              partial: refined.partial || null,
              estimatedRadius,
              squareRingCompanions: companions,
            });
          }
        }
      }
      // v0W (n=21 신설 후보, 2026-08-16) — 동심 사각이 **심 꼭짓점**에 앉아 반경이
      // 16.7033셀이다. v0X 의 18.0 과 1.30셀 차이라 ANCHOR_SNAP_CELLS(3.2) 안에서
      // **거리로는 못 가른다** — 두 패밀리는 서로의 프레임에서 서로 시드된다.
      // 같은 이유로 사각 링 동반자도 둘 다 참이라 게이트가 안 가른다.
      // 가르는 것은 (a) 패치 Pearson — v0W 코너 패치는 canonical θ=−141.1° 라
      // v0X 프레임에서 51.1° 틀어진 자리를 보고, (b) 하류 CS 수용 게이트
      // (agreement 0.78 · orientation margin 0.035) 다. 교차 오수용 0 은 거기서 나온다
      // (v0xq 편입에서 확인한 것과 같은 구조 — §v0xqRequireCenterQr 주석).
      if (cfg.v0wFamily !== false
        && Math.abs(estimatedRadius - V0W_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        const companions = squareRingCompanions(centre, corner, corners, cfg);
        const gateCompanions = companionsForGate(centre, corner, corners, ringPool, cfg, companions);
        if (gateCompanions !== 0 || cfg.v0wRequireSquareRing === false) {
          const patches = patchesFor(V0W_N, 'v0w');
          // YFACE_LIST[0] = 'T' — 면 T 의 동심 사각 무게중심이 canonical 앵커다.
          const H0 = anchoredSimilaritySeedTo(centre, corner, factor, patches.corners[0].anchor);
          const refined = H0 === null ? null : refinePose(fullLuma, H0, patches, cfg, telemetry);
          if (refined) {
            anchoredCentres.add(centreIndex);
            posesV0w.push({
              family: 'v0w',
              layoutId: 'v0w',
              n: V0W_N,
              H: refined.H,
              score: refined.meanCorrelation,
              partial: refined.partial || null,
              estimatedRadius,
              squareRingCompanions: companions,
            });
          }
        }
      }
      // v0W2 (v0W 파생 ②, 2026-08-17) — 반경도 NE 블록도 v0W 와 **같다**. 그래서
      // 같은 쌍에서 한 번 더 시드하고, 가르는 것은 refinePose 의 패치 Pearson 과
      // 하류 CS 게이트다. v0W 브랜치와 **독립**이다 (게이트 실패가 서로를 안 자른다 —
      // v0X ↔ v0W 에서 고친 것과 같은 결합을 여기서 만들지 않는다).
      if (cfg.v0w2Family !== false
        && Math.abs(estimatedRadius - V0W2_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        const companions = squareRingCompanions(centre, corner, corners, cfg);
        const gateCompanions = companionsForGate(centre, corner, corners, ringPool, cfg, companions);
        if (gateCompanions !== 0 || cfg.v0w2RequireSquareRing === false) {
          const patches = patchesFor(V0W2_N, 'v0w2');
          // YFACE_LIST[0] = 'T' — 면 T 의 동심 사각 무게중심이 canonical 앵커다
          // (v0W 과 같은 블록이라 같은 방향 −141.1°).
          const H0 = anchoredSimilaritySeedTo(centre, corner, factor, patches.corners[0].anchor);
          const refined = H0 === null ? null : refinePose(fullLuma, H0, patches, cfg, telemetry);
          if (refined) {
            anchoredCentres.add(centreIndex);
            posesV0w2.push({
              family: 'v0w2',
              layoutId: 'v0w2',
              n: V0W2_N,
              H: refined.H,
              score: refined.meanCorrelation,
              partial: refined.partial || null,
              estimatedRadius,
              squareRingCompanions: companions,
            });
          }
        }
      }
      // v0WY (v0W 파생 ③, 2026-08-17 재설계) — 중앙도 NE 도 v0W 와 **같은 배열**이라
      // 시드는 v0W 브랜치와 문자 그대로 같은 계산이다. v0W·v0W2 브랜치와 **독립**이다
      // (게이트 실패가 서로를 안 자른다 — v0X ↔ v0W 에서 고친 결합을 여기서 안 만든다).
      // 마지막에 **슬롯 QR 확증**이 붙는다 — 이것만이 «먼 코너에 진짜 QR 이 있는가» 를
      // 재고, 없으면 그 포즈는 v0W 프레임 위에 선 v0WY 가설이다 (§slotQrConfirmsPose).
      if (cfg.v0wyFamily !== false
        && Math.abs(estimatedRadius - V0WY_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        const companions = squareRingCompanions(centre, corner, corners, cfg);
        const gateCompanions = companionsForGate(centre, corner, corners, ringPool, cfg, companions);
        if (gateCompanions !== 0 || cfg.v0wyRequireSquareRing === false) {
          const patches = patchesFor(V0WY_N, 'v0wy');
          const H0 = anchoredSimilaritySeedTo(centre, corner, factor, patches.corners[0].anchor);
          const refined = H0 === null ? null : refinePose(fullLuma, H0, patches, cfg, telemetry);
          if (refined && slotQrConfirmsPose(fullLuma, refined.H, patches, cfg)) {
            anchoredCentres.add(centreIndex);
            posesV0wy.push({
              family: 'v0wy',
              layoutId: 'v0wy',
              n: V0WY_N,
              H: refined.H,
              score: refined.meanCorrelation,
              partial: refined.partial || null,
              estimatedRadius,
              squareRingCompanions: companions,
            });
          } else if (refined) {
            slotQrRejected += 1;
          }
        }
      }
      // v0T (Type Y 최종 파인더, 2026-08-17) — 반경·NE 블록이 v0W 계열과 같아
      // 같은 (중앙, 코너) 쌍에서 시드된다. 드랍된 v0W 계열 브랜치와 **독립**이다
      // (게이트 실패가 서로를 안 자른다 — v0X ↔ v0W 에서 고친 결합을 안 만든다).
      // 가르는 것은 refinePose 의 패치 Pearson (A·N팔·W·SE 서브앵커) 과 하류 CS 게이트다.
      if (cfg.v0tFamily !== false
        && Math.abs(estimatedRadius - V0T_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        const companions = squareRingCompanions(centre, corner, corners, cfg);
        const gateCompanions = companionsForGate(centre, corner, corners, ringPool, cfg, companions);
        if (gateCompanions !== 0 || cfg.v0tRequireSquareRing === false) {
          const patches = patchesFor(V0T_N, 'v0t');
          const H0 = anchoredSimilaritySeedTo(centre, corner, factor, patches.corners[0].anchor);
          const refined = H0 === null ? null : refinePose(fullLuma, H0, patches, cfg, telemetry);
          if (refined) {
            anchoredCentres.add(centreIndex);
            posesV0t.push({
              family: 'v0t',
              layoutId: 'v0t',
              n: V0T_N,
              H: refined.H,
              score: refined.meanCorrelation,
              partial: refined.partial || null,
              estimatedRadius,
              squareRingCompanions: companions,
            });
          }
        }
      }
      // v0TY (v0T 파생 — 먼 코너 QR 슬롯) — 시드 기하가 v0T 와 같다. 마지막에
      // **슬롯 QR 확증**이 붙는다 (v0WY 와 같은 확증 — 스위치만 독립, §v0tyRequireSlotQr).
      if (cfg.v0tyFamily !== false
        && Math.abs(estimatedRadius - V0TY_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        const companions = squareRingCompanions(centre, corner, corners, cfg);
        const gateCompanions = companionsForGate(centre, corner, corners, ringPool, cfg, companions);
        if (gateCompanions !== 0 || cfg.v0tyRequireSquareRing === false) {
          const patches = patchesFor(V0TY_N, 'v0ty');
          const H0 = anchoredSimilaritySeedTo(centre, corner, factor, patches.corners[0].anchor);
          const refined = H0 === null ? null : refinePose(fullLuma, H0, patches, cfg, telemetry);
          if (refined
            && slotQrConfirmsPose(fullLuma, refined.H, patches, cfg, cfg.v0tyRequireSlotQr)) {
            anchoredCentres.add(centreIndex);
            posesV0ty.push({
              family: 'v0ty',
              layoutId: 'v0ty',
              n: V0TY_N,
              H: refined.H,
              score: refined.meanCorrelation,
              partial: refined.partial || null,
              estimatedRadius,
              squareRingCompanions: companions,
            });
          } else if (refined) {
            slotQrRejected += 1;
          }
        }
      }
      // v0TR (v0T 재설계, 2026-08-17) — 위 브랜치들과 **독립**이다 (게이트 실패가
      // 서로를 안 자른다 — v0X ↔ v0W 에서 고친 결합을 다시 만들지 않는다).
      //
      // ⚠ **정정 (2026-08-18, v0TRY 레인 지적)**: 여기에 «여기만 반경이 다르다
      // (√129 = 11.3578) · 3.2셀 밖이라 v0T·v0TY 프레임에서는 이 if 가 첫 줄에서
      // 끝난다 = 비용이 안 붙는다» 고 적혀 있었다. **둘 다 사실이 아니다.**
      // `V0TR_CORE_RADIUS_CELLS` 는 **√279 = 16.7033** 으로 v0T 계열과 **같다** —
      // 코너 앵커가 바깥 동심 사각이기 때문이다(§V0TR_BLOCKS 및 위 §1426 주석:
      // «안쪽을 코너 앵커로» 는 실물에서 엄격 코너 검증이 안 돼 기각됐다).
      // 반경이 같으므로 이 `if` 는 v0T·v0TY 프레임에서도 **매번 열리고**, 그래서
      // 편입 비용이 그 프레임들에도 붙는다 — 실측 **+17\~28 %** (v0TRY 레인 §①ⓖ).
      // 낡은 주석을 믿고 «비용이 안 붙는다» 로 설계 판단을 하면 안 된다.
      if (cfg.v0trFamily !== false
        && Math.abs(estimatedRadius - V0TR_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        // ⚠ 리베이스 화해 (2026-08-18): 이 브랜치는 `fd37c9c` 기준 레인에서 왔고
        // 링 수리(3c2bfa0)를 못 봤다. 다른 여섯 브랜치와 **같이** 게이트값과 정렬값을
        // 가른다 — 안 가르면 v0TR 만 «캡된 목록으로 동반자 판정» 이라 거리에서
        // 시드가 죽는다 (§companionsForGate · `.agent/_lessons/008`).
        // 3-way 는 충돌 없이 조용히 통과시켰다. 손으로 맞춘 자리다.
        const companions = squareRingCompanions(centre, corner, corners, cfg);
        const gateCompanions = companionsForGate(centre, corner, corners, ringPool, cfg, companions);
        if (gateCompanions !== 0 || cfg.v0trRequireSquareRing === false) {
          const patches = patchesFor(V0TR_N, 'v0tr');
          const H0 = anchoredSimilaritySeedTo(centre, corner, factor, patches.corners[0].anchor);
          const refined = H0 === null ? null : refinePose(fullLuma, H0, patches, cfg, telemetry);
          if (refined) {
            anchoredCentres.add(centreIndex);
            posesV0tr.push({
              family: 'v0tr',
              layoutId: 'v0tr',
              n: V0TR_N,
              H: refined.H,
              score: refined.meanCorrelation,
              partial: refined.partial || null,
              estimatedRadius,
              squareRingCompanions: companions,
            });
          }
        }
      }
      // v0TRY (v0TR 파생 — 먼 코너 QR 슬롯, 2026-08-18) — 시드 기하가 v0TR 과 같다
      // (반경 √279 동일). 마지막에 **슬롯 QR 확증**이 붙는다 (v0WY·v0TY 와 같은 확증 —
      // 스위치만 독립, §v0tryRequireSlotQr). 위 브랜치들과 **독립**이다.
      if (cfg.v0tryFamily !== false
        && Math.abs(estimatedRadius - V0TRY_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        // ⚠ 게이트값 ≠ 정렬값 — 다른 일곱 브랜치와 **같은 형태**로 쓴다
        // (§companionsForGate · `.agent/_lessons/008` · 링 수리 3c2bfa0).
        // `squareRingCompanions` 만으로 게이트를 판정하면 캡된 목록으로 판정하게 되어
        // 거리에서 시드가 죽는다 — v0TR 리베이스에서 통합자가 손으로 고친 그 자리다.
        const companions = squareRingCompanions(centre, corner, corners, cfg);
        const gateCompanions = companionsForGate(centre, corner, corners, ringPool, cfg, companions);
        if (gateCompanions !== 0 || cfg.v0tryRequireSquareRing === false) {
          const patches = patchesFor(V0TRY_N, 'v0try');
          const H0 = anchoredSimilaritySeedTo(centre, corner, factor, patches.corners[0].anchor);
          const refined = H0 === null ? null : refinePose(fullLuma, H0, patches, cfg, telemetry);
          if (refined
            && slotQrConfirmsPose(fullLuma, refined.H, patches, cfg, cfg.v0tryRequireSlotQr)) {
            anchoredCentres.add(centreIndex);
            posesV0try.push({
              family: 'v0try',
              layoutId: 'v0try',
              n: V0TRY_N,
              H: refined.H,
              score: refined.meanCorrelation,
              partial: refined.partial || null,
              estimatedRadius,
              squareRingCompanions: companions,
            });
          } else if (refined) {
            slotQrRejected += 1;
          }
        }
      }
    }
  }
  return {
    posesV2r2,
    posesV1r2,
    posesV0x,
    posesV0w,
    posesV0w2,
    posesV0wy,
    posesV0t,
    posesV0ty,
    posesV0tr,
    posesV0try,
    anchoredCentres,
    companionPairs,
    slotQrRejected,
  };
}

/**
 * ★ 중앙 불스아이 확증 조립 (2026-08-17, 과업 3 ③) — «주 파인더 + 중앙» 이중 확인의
 * **양의 방향**. 위 `centreQrBullseyeVeto` 가 같은 일치를 **거부**에 쓴다면, 여기서는
 * 같은 일치를 **인가**에 쓴다.
 *
 * 왜 필요한가 (실측, 48칸 v0W 열화 사다리 — `claude-v0w2-anchored.mjs`):
 * v0W 자기 포즈가 0 이 된 13칸 중 **12칸이 사각 링 동반자 게이트에서 죽는다**
 * (거리·반경 스냅·패치 정합은 한 칸도 안 죽였다). 원인은 게이트 자체가 아니라
 * **코너 목록이 다르다**는 것이다 — 같은 물리 블록을 두 검증기가 본다:
 *   · 앵커드 경로: `verifyV2r2Cluster` (open/closed 분류까지 요구) → 3톤 열화에서 1\~2개
 *   · 중앙 QR 경로: `verifyV0xqCornerCluster` (링 비만 요구)          → 같은 칸에서 3\~4개
 * 코너가 3개 미만이면 120° 쌍둥이가 없어 사각 링 게이트가 구조적으로 0 이 된다.
 * 즉 **가짜(v0WQ) 후보는 더 큰 그물로 같은 물고기를 잡고 있었다.**
 *
 * 여기서 하는 일: 느슨한 코너로 만든 **120° 삼중점의 중심에 검증된 K3 불스아이가
 * 앉아 있으면**, 그 프레임의 중앙은 불스아이이고 세 면 코너가 실재한다는 것이
 * 이미 증명된 것이다 — 사각 링 게이트가 «동반자 1개» 로 찾던 증거보다 **강한** 증거다.
 * 그때만 (불스아이 중앙 × 삼중점 코너) 로 앵커드 패밀리를 시드한다.
 *
 * 완화가 아니라 **증거 치환**이다:
 *   · 엄격 경로가 이미 포즈를 세운 중앙(`anchoredCentres`)은 **건드리지 않는다** —
 *     그 프레임의 동작은 한 비트도 안 바뀐다.
 *   · refinePose·CS 수용 게이트(0.78 / 0.035)는 그대로 통과해야 한다.
 *   · v0WQ 프레임에서는 **구조적으로 발동하지 않는다** — 진짜 중앙 QR 삼중점의
 *     중심에는 불스아이가 없다 (실측 최소 0.108 R, 문턱 0.075 R).
 */
function assembleBullseyeConfirmedPoses(
  centres, anchoredCentres, looseCorners, fullLuma, factor, cfg, telemetry = null,
) {
  const posesV0x = [];
  const posesV0w = [];
  const posesV0w2 = [];
  const posesV0wy = [];
  const posesV0t = [];
  const posesV0ty = [];
  const posesV0tr = [];
  const posesV0try = [];
  const confirmed = new Set();
  let tripleCount = 0;
  // 슬롯 QR 확증이 이 경로에서 자른 v0wy·v0ty 후보 수 — 앵커드 경로의 `slotQrRejected`
  // 와 **따로** 센다 (합계만 내보내면 어느 경로가 샜는지 되볼 수 없다 — 2026-08-17 수리).
  let slotQrRejected = 0;
  if (looseCorners.length < 3 || centres.length === 0) {
    return {
      posesV0x, posesV0w, posesV0w2, posesV0wy, posesV0t, posesV0ty, posesV0tr, posesV0try,
      confirmedCentres: confirmed, tripleCount,
      slotQrRejected,
    };
  }
  const angleTolerance = (cfg.v0xqTripleAngleToleranceDeg * Math.PI) / 180;
  for (let a = 0; a < looseCorners.length; a += 1) {
    for (let b = a + 1; b < looseCorners.length; b += 1) {
      for (let c = b + 1; c < looseCorners.length; c += 1) {
        const triple = [looseCorners[a], looseCorners[b], looseCorners[c]];
        const centre = {
          x: (triple[0].x + triple[1].x + triple[2].x) / 3,
          y: (triple[0].y + triple[1].y + triple[2].y) / 3,
        };
        const radii = triple.map((hit) => Math.hypot(hit.x - centre.x, hit.y - centre.y));
        const rMin = Math.min(...radii);
        const rMax = Math.max(...radii);
        if (!(rMin > EPSILON)) continue;
        if (rMax - rMin > cfg.v0xqTripleRadiusTolerance * rMax) continue;
        const angles = triple
          .map((hit) => Math.atan2(hit.y - centre.y, hit.x - centre.x))
          .sort((left, right) => left - right);
        let spaced = true;
        for (let k = 0; k < 3; k += 1) {
          let delta = angles[(k + 1) % 3] - angles[k];
          if (delta < 0) delta += 2 * Math.PI;
          if (Math.abs(delta - (2 * Math.PI) / 3) > angleTolerance) spaced = false;
        }
        if (!spaced) continue;
        // 이 삼중점의 중심에 앉은 불스아이를 찾는다 — 거부권과 **같은 자**(같은 비율).
        const snapRadius = cfg.centreQrBullseyeVetoRadiusRatio * ((rMin + rMax) / 2);
        let centreIndex = -1;
        for (let index = 0; index < centres.length; index += 1) {
          const hit = centres[index];
          if (Math.hypot(hit.x - centre.x, hit.y - centre.y) <= snapRadius) {
            centreIndex = index;
            break;
          }
        }
        if (centreIndex < 0) continue;
        // 엄격 경로가 이미 세운 중앙은 손대지 않는다 (무회귀의 근거).
        if (anchoredCentres.has(centreIndex)) continue;
        tripleCount += 1;
        // 시딩까지 가는 삼중점 수를 여기서 캡한다 (§bullseyeConfirmedMaxTriples).
        // 위 기하 검사(반경비·120°·중심 불스아이)는 세 점 산술이라 사실상 공짜고
        // 비싼 것은 아래 refinePose 다 — **캡을 싼 필터 뒤에 둔다**는 것이 이번
        // 수리의 요지다 (`_lessons/008`: 자르기가 게이트보다 앞이면 정답이 버려진다).
        // `tripleCount` 는 캡 **앞**에서 세므로 «유효 삼중점이 몇 개 있었나» 의
        // 정직한 분모로 남는다 (종전엔 풀이 4라 이 값이 늘 0\~4 였다).
        if (tripleCount > cfg.bullseyeConfirmedMaxTriples) continue;
        const anchor = centres[centreIndex];
        for (const corner of triple) {
          const distance = Math.hypot(corner.x - anchor.x, corner.y - anchor.y);
          if (!(distance > 6 * anchor.u)) continue;
          const estimatedRadius = distance / Math.max(anchor.u, EPSILON);
          if (cfg.v0xFamily !== false
            && Math.abs(estimatedRadius - V0X_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
            const H0 = anchoredSimilaritySeed(anchor, corner, factor, V0X_CORE_RADIUS_CELLS);
            const refined = refinePose(fullLuma, H0, patchesFor(V0X_N, 'v0x'), cfg, telemetry);
            if (refined) {
              confirmed.add(centreIndex);
              posesV0x.push({
                family: 'v0x',
                layoutId: 'v0x',
                n: V0X_N,
                H: refined.H,
                score: refined.meanCorrelation,
                partial: refined.partial || null,
                estimatedRadius,
                bullseyeConfirmed: true,
              });
            }
          }
          for (const spec of [
            { on: cfg.v0wFamily !== false, id: 'v0w', n: V0W_N, radius: V0W_CORE_RADIUS_CELLS, out: posesV0w },
            { on: cfg.v0w2Family !== false, id: 'v0w2', n: V0W2_N, radius: V0W2_CORE_RADIUS_CELLS, out: posesV0w2 },
            // v0WY 도 같은 구제 경로를 태다 — 중앙 K3 불스아이가 있는 레이아웃이라
            // 엄격 코너가 3개 미만이라 사각 링 게이트가 구조적으로 0 이 되는 칸에서
            // 똑같이 죽는다. 슬롯 QR 확증은 여기서도 붙는다 (아래 spec.slotQr).
            { on: cfg.v0wyFamily !== false, id: 'v0wy', n: V0WY_N, radius: V0WY_CORE_RADIUS_CELLS, out: posesV0wy, slotQr: true, slotQrEnabled: cfg.v0wyRequireSlotQr },
            // v0T·v0TY (2026-08-17 편입) — 중앙이 K3 계보 16셀이라 같은 구제 대상이다.
            // v0TY 의 슬롯 QR 확증 스위치는 v0WY 와 독립이다 (§v0tyRequireSlotQr).
            { on: cfg.v0tFamily !== false, id: 'v0t', n: V0T_N, radius: V0T_CORE_RADIUS_CELLS, out: posesV0t },
            { on: cfg.v0tyFamily !== false, id: 'v0ty', n: V0TY_N, radius: V0TY_CORE_RADIUS_CELLS, out: posesV0ty, slotQr: true, slotQrEnabled: cfg.v0tyRequireSlotQr },
            // v0TR (2026-08-17) — 중앙이 v0T 와 같은 K3 계보 16셀이라 같은 구제 대상이다.
            // ⚠ **정정 (2026-08-18)**: «반경만 다르다 (√129) — 이 표에서 √279 가 아닌
            // 유일한 행» 이라고 적혀 있었으나 **틀렸다.** `V0TR_CORE_RADIUS_CELLS` 는
            // √279 = 16.7033 으로 이 표의 다른 행과 **같다** (코너 앵커가 바깥 사각).
            // 같은 오류가 앵커드 브랜치 주석에도 있었다 — 함께 고쳤다.
            { on: cfg.v0trFamily !== false, id: 'v0tr', n: V0TR_N, radius: V0TR_CORE_RADIUS_CELLS, out: posesV0tr },
            // v0TRY (2026-08-18) — v0TR 과 같은 중앙 K3 16셀·같은 코너 반경이라 같은
            // 구제 대상이다. 슬롯 QR 확증 스위치는 v0WY·v0TY 와 독립이다.
            { on: cfg.v0tryFamily !== false, id: 'v0try', n: V0TRY_N, radius: V0TRY_CORE_RADIUS_CELLS, out: posesV0try, slotQr: true, slotQrEnabled: cfg.v0tryRequireSlotQr },
          ]) {
            if (!spec.on) continue;
            if (Math.abs(estimatedRadius - spec.radius) > ANCHOR_SNAP_CELLS) continue;
            const patches = patchesFor(spec.n, spec.id);
            const H0 = anchoredSimilaritySeedTo(
              anchor, corner, factor, patches.corners[0].anchor,
            );
            const refined = H0 === null
              ? null : refinePose(fullLuma, H0, patches, cfg, telemetry);
            if (!refined) continue;
            // 거절도 **계수**한다 — 예전에는 여기서 조용히 `continue` 만 해서
            // `diagnostics.slotQr.rejected` (회귀 대조군) 가 이 경로의 실패를 못 셌다.
            if (spec.slotQr
              && !slotQrConfirmsPose(fullLuma, refined.H, patches, cfg, spec.slotQrEnabled)) {
              slotQrRejected += 1;
              continue;
            }
            confirmed.add(centreIndex);
            spec.out.push({
              family: spec.id,
              layoutId: spec.id,
              n: spec.n,
              H: refined.H,
              score: refined.meanCorrelation,
              partial: refined.partial || null,
              estimatedRadius,
              bullseyeConfirmed: true,
            });
          }
        }
      }
    }
  }
  return {
    posesV0x, posesV0w, posesV0w2, posesV0wy, posesV0t, posesV0ty, posesV0tr, posesV0try,
    confirmedCentres: confirmed, tripleCount,
    slotQrRejected,
  };
}

/**
 * v0xq — 3코너 동심 사각의 암 2×2 코어 중심은 블록 (0..5)×(15..20) 의 **정중앙**
 * (a,b) = (3,18) 이다 (동심 사각이 i·j 양방향 대칭이라 블록 무게중심 = 코어 중심).
 * 중심 거리는 닫힌 형태로 떨어진다 — 두 기저의 사잇각이 120° 이므로
 *   r² = a² + b² − a·b = 9 + 324 − 54 = 279 → r = √279 = 16.7033셀.
 * v0X·v1r2 의 18.0 과 1.30셀 차이라 ANCHOR_SNAP_CELLS(3.2) 안에서 **거리로는 못
 * 가른다**. 가르는 것은 중앙이다 — v0xq 만 중앙이 QR 이고 나머지는 K3 불스아이다.
 */
const V0XQ_CORE_RADIUS_CELLS = Math.sqrt(279);
const V0XQ_N = 21;

/** 단위 벡터 u 를 v 로 보내는 회전의 (cos, sin). 삼각함수 없이 내적·외적으로. */
function rotationBetween(ux, uy, vx, vy) {
  return { cos: ux * vx + uy * vy, sin: ux * vy - uy * vx };
}

/**
 * 중앙 QR 시그니처 — **«QR 다움» 을 상관이 아니라 직접** 잰다 (2026-08-17 봉합 ②).
 *
 * 왜 Pearson 으로는 안 되나: 중앙 QR 패치의 기대 벡터는 «T 콰이어트 = 밝음 · L·R
 * 슬롯 = 어두움 · 파인더 암코어 3 = 어두움» 인데 점 수가 **슬롯에 압도적으로 쏠려**
 * 있다 (실측: v0wq 159점 = 콰이어트 28 + 슬롯 128 + 파인더 3 → 슬롯이 80.5 % ·
 * v0xq 197점 = 32 + 162 + 3 → 82.2 %). 그래서 상관은 사실상 **면 게인 음영**
 * (T 1.0 > L > R 0.62)만 재고, 큐브면 무엇이든 0.28\~0.42 를 낸다 — 문턱 0.25 를
 * 그냥 넘는다.
 * 오직 QR 에만 있는 것은 «콰이어트 프레임 안에 박힌 3개의 암 코어» 다.
 *
 * 반환값은 (콰이어트 평균 − 파인더 암코어 평균) / (패치 표본 p95 − p5).
 * 분모가 **패치 자신의 동적 범위**라 톤 커브·노출·면 게인이 약분된다.
 * 실측(256칸 열화 사다리, 검증 렌즈 정정 2026-08-17): 자기 패밀리 포즈 기준 (n=62)
 * 진짜 v0WQ 0.995\~1.084 · 가짜 −0.477\~0.411 (무필터 최소 −0.269 는 삼중점 0 칸).
 *
 * offsetX/offsetY 는 `registerPatch` 가 찾은 최적 정합 위치다 — 시드 H 가 조금
 * 어긋나 있어도 **정합된 자리에서** 판별하도록.
 */
function centreQrFinderContrast(luma, H, patch, offsetX, offsetY) {
  const values = [];
  const quiet = [];
  const finder = [];
  for (const point of patch.points) {
    const image = projectPoint(H, point);
    if (!image) continue;
    const value = bilinear(luma, image.x + offsetX, image.y + offsetY);
    if (value === null) continue;
    values.push(value);
    if (point.role === 'quiet') quiet.push(value);
    else if (point.role === 'finder') finder.push(value);
  }
  // 표본이 모자라면 «판별 불가» 다 — null 을 «통과» 로 읽지 않는다(호출부가 거절).
  if (values.length < 20 || quiet.length < 6 || finder.length < 3) return null;
  values.sort((left, right) => left - right);
  const pick = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  const span = pick(0.95) - pick(0.05);
  if (!(span > EPSILON)) return null;
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  return (mean(quiet) - mean(finder)) / span;
}

/**
 * v0xq 조립 — K3 중앙이 없으므로 **코너 삼중점**이 중앙·스케일·위상을 동시에 준다.
 *
 * 세 코너가 120° 간격 같은 반경이면 그 무게중심이 곧 큐브 중심이다 (canonical 에서
 * 세 면 코너 앵커의 합이 정확히 0 이라 — 세 면이 서로 120° 회전이기 때문).
 * 위상은 3가설(«이 코너가 T 면») 로 열고 패치 Pearson 이 고른다. 그다음
 * refinePose 의 4앵커 DLT 가 중앙 QR 블록을 4번째 앵커로 써서 원근까지 올린다.
 *
 * 결정성: corners 는 verified 정렬 순서로만 순회하고 조합도 고정 순서다.
 */
function assembleCentreQrPoses(
  layoutId, corners, fullLuma, factor, cfg, telemetry = null, centres = [],
) {
  const poses = [];
  let bullseyeVetoed = 0;
  let finderContrastRejected = 0;
  if (corners.length < 3) {
    return {
      poses, tripleCount: 0, centreRejected: 0, bullseyeVetoed, finderContrastRejected,
    };
  }
  const patches = patchesFor(V0XQ_N, layoutId);
  const canonical = patches.corners[0].anchor; // YFACE_LIST[0] = 'T'
  const canonicalR = Math.hypot(canonical.x, canonical.y);
  const angleTolerance = (cfg.v0xqTripleAngleToleranceDeg * Math.PI) / 180;
  let tripleCount = 0;
  let centreRejected = 0;
  for (let a = 0; a < corners.length; a += 1) {
    for (let b = a + 1; b < corners.length; b += 1) {
      for (let c = b + 1; c < corners.length; c += 1) {
        const triple = [corners[a], corners[b], corners[c]];
        const centre = {
          x: (triple[0].x + triple[1].x + triple[2].x) / 3,
          y: (triple[0].y + triple[1].y + triple[2].y) / 3,
        };
        const radii = triple.map((hit) => Math.hypot(hit.x - centre.x, hit.y - centre.y));
        const rMin = Math.min(...radii);
        const rMax = Math.max(...radii);
        if (!(rMin > EPSILON)) continue;
        if (rMax - rMin > cfg.v0xqTripleRadiusTolerance * rMax) continue;
        // 120° 간격 검사 — 정렬된 각도의 이웃 차가 전부 120° ± tol.
        const angles = triple
          .map((hit) => Math.atan2(hit.y - centre.y, hit.x - centre.x))
          .sort((left, right) => left - right);
        let spaced = true;
        for (let k = 0; k < 3; k += 1) {
          let delta = angles[(k + 1) % 3] - angles[k];
          if (delta < 0) delta += 2 * Math.PI;
          if (Math.abs(delta - (2 * Math.PI) / 3) > angleTolerance) spaced = false;
        }
        if (!spaced) continue;
        tripleCount += 1;
        // ★ 중앙 불스아이 거부권 — 이 삼중점의 중심에 **이미 검증된 K3 불스아이**가
        // 앉아 있으면 그 중앙은 QR 슬롯이 아니다 (§centreQrBullseyeVeto).
        // 삼중점 반경으로 정규화해 스케일 무관하게 잰다. centres 는 이 함수 밖에서
        // 이미 계산된 배열이라 추가 이미지 연산이 0 이다.
        if (cfg.centreQrBullseyeVeto !== false && centres.length > 0) {
          const vetoRadius = cfg.centreQrBullseyeVetoRadiusRatio * ((rMin + rMax) / 2);
          const occupiedByBullseye = centres.some((hit) =>
            Math.hypot(hit.x - centre.x, hit.y - centre.y) <= vetoRadius);
          if (occupiedByBullseye) {
            bullseyeVetoed += 1;
            continue;
          }
        }
        const centreFull = liftPoint(centre, factor);
        const estimatedRadius = ((rMin + rMax) / 2) / Math.max(triple[0].u, EPSILON);
        for (const corner of triple) {
          const cornerFull = liftPoint(corner, factor);
          const dx = cornerFull.x - centreFull.x;
          const dy = cornerFull.y - centreFull.y;
          const d = Math.hypot(dx, dy);
          if (!(d > EPSILON)) continue;
          const rot = rotationBetween(
            canonical.x / canonicalR, canonical.y / canonicalR, dx / d, dy / d,
          );
          const scale = d / canonicalR;
          const H0 = similarityHomography(centreFull, scale, rot.cos, rot.sin);
          if (cfg.v0xqRequireCenterQr !== false) {
            const cellPx = localCellPx(H0);
            if (!Number.isFinite(cellPx) || cellPx <= 0.5) continue;
            const probe = registerPatch(
              fullLuma, H0, patches.centre,
              cfg.registrationRangeCells * cellPx,
              Math.max(0.5, cfg.registrationStepCells * cellPx),
            );
            if (!probe || probe.correlation < cfg.v0xqCentreMinCorrelation) {
              centreRejected += 1;
              continue;
            }
            // ★ QR 다움 판별 — 상관이 통과해도 «파인더 암코어 3점» 이 실제로 어둡지
            // 않으면 그 중앙은 QR 이 아니다 (§centreQrRequireFinderContrast).
            // 상관 게이트가 재는 것은 면 게인 음영이고, 이것이 재는 것이 QR 구조다.
            if (cfg.centreQrRequireFinderContrast !== false) {
              const contrast = centreQrFinderContrast(
                fullLuma, H0, patches.centre, probe.offsetX, probe.offsetY,
              );
              if (contrast === null || contrast < cfg.centreQrMinFinderContrast) {
                finderContrastRejected += 1;
                continue;
              }
            }
          }
          const refined = refinePose(fullLuma, H0, patches, cfg, telemetry);
          if (!refined) continue;
          poses.push({
            family: layoutId,
            layoutId,
            n: V0XQ_N,
            H: refined.H,
            score: refined.meanCorrelation,
            partial: refined.partial || null,
            estimatedRadius,
          });
        }
      }
    }
  }
  return {
    poses, tripleCount, centreRejected, bullseyeVetoed, finderContrastRejected,
  };
}

/**
 * v0xq 조립 — 일반형의 특수화. **호출 형태를 바꾸지 않는다** (기존 테스트·내부 노출이
 * 이 이름으로 걸려 있다). v0wq 는 `assembleV0wqPoses` 를 쓴다.
 */
function assembleV0xqPoses(corners, fullLuma, factor, cfg, telemetry = null, centres = []) {
  return assembleCentreQrPoses('v0xq', corners, fullLuma, factor, cfg, telemetry, centres);
}

/**
 * v0wq 조립 — **같은 코너 삼중점**에서 시작한다 (동심 사각이 같은 블록이라 코너 검증
 * 결과를 재사용한다 — 다시 훑지 않는다). 갈리는 곳은 ① 중앙 QR 패치(슬롯 8) ②
 * 위상 마커 서브패치(SE 9셀) 둘뿐이고, 그 둘이 refinePose 의 Pearson 을 가른다.
 */
function assembleV0wqPoses(corners, fullLuma, factor, cfg, telemetry = null, centres = []) {
  return assembleCentreQrPoses('v0wq', corners, fullLuma, factor, cfg, telemetry, centres);
}

/**
 * v0trq 조립 — **같은 코너 히트 배열**을 쓰지만 서는 삼중점이 다르다.
 *
 * v0xq·v0wq 의 삼중점은 반경 √279 (바깥 동심 사각), v0trq 의 삼중점은 √129
 * (안쪽 동심 사각) 자리에 선다. 삼중점 탐색 자체는 반경 **비**만 보므로
 * (`v0xqTripleRadiusTolerance` — 절대 반경을 안 본다) 같은 함수가 둘 다 찾아내고,
 * 어느 삼중점이 «내 것» 인지는 `patches.corners[0].anchor` 의 반경으로 정해지는
 * 시드 스케일이 가른다 — 남의 삼중점으로 시드하면 중앙 QR 패치가 1.47배 어긋난
 * 자리에 떨어져 `v0xqCentreMinCorrelation` 게이트에서 죽는다.
 *
 * ⚠ **v0TR 프레임에는 면당 동심 사각이 둘이라 코너 후보가 최대 6개** 뜬다.
 * 호출부가 넘기는 코너 슬라이스가 4개면 두 반경이 섞여 «내 삼중점» 이 못 설 수 있어
 * (실측 근거는 §detectCellSurfaceBlockShapes 의 v0trq 호출부 주석), 이 패밀리에만
 * 넓힌 슬라이스를 준다. 게이트가 아니라 **후보 예산**이다.
 */
function assembleV0trqPoses(corners, fullLuma, factor, cfg, telemetry = null, centres = []) {
  return assembleCentreQrPoses('v0trq', corners, fullLuma, factor, cfg, telemetry, centres);
}

function rotationSweepScore(reducedLuma, template, centre, unit, angleCos, angleSin) {
  let count = 0;
  for (const point of template.points) {
    const x = centre.x + unit * (angleCos * point.x - angleSin * point.y);
    const y = centre.y + unit * (angleSin * point.x + angleCos * point.y);
    const value = bilinear(reducedLuma, x, y);
    if (value === null) continue;
    scratchValues[count] = value;
    scratchExpected[count] = point.expected;
    count += 1;
  }
  if (count < Math.floor(template.points.length * 0.8)) return null;
  return pearson(scratchValues, scratchExpected, count);
}

/** 마스크 침식이 불스아이 u 를 부풀리는 방향이라 스케일 스윕은 아래쪽을 더 연다. */
const V0_SCALE_SWEEP = Object.freeze([0.72, 0.85, 1, 1.12]);

/**
 * v0 조립 — 조기 분기의 **폴백 가지**: anchoredCentres 에 든 중앙(앵커드 포즈가 선
 * 중앙)은 360°×4스케일 스윕을 건너뛴다. 세 패밀리 중앙 서명이 같아진 뒤(2026-08-16)
 * v1r2·v2r2 프레임에서 이 스윕이 헛돌던 문제(claude-v1r2-revival.md §5-③)의 해소.
 */
function assembleV0Poses(
  centres, anchoredCentres, reducedLuma, fullLuma, factor, cfg, telemetry = null,
) {
  const poses = [];
  const template = patchesForN(13).all;
  for (let centreIndex = 0; centreIndex < centres.length; centreIndex += 1) {
    if (anchoredCentres.has(centreIndex)) continue;
    const centre = centres[centreIndex];
    const sweep = [];
    for (const scale of V0_SCALE_SWEEP) {
      const unit = centre.u * scale;
      for (let degrees = 0; degrees < 360; degrees += cfg.v0RotationStepDeg) {
        const radians = (degrees * Math.PI) / 180;
        const corr = rotationSweepScore(
          reducedLuma, template, centre, unit, Math.cos(radians), Math.sin(radians),
        );
        if (corr !== null) sweep.push({ degrees, unit, corr });
      }
    }
    if (sweep.length === 0) continue;
    sweep.sort((left, right) =>
      right.corr - left.corr || left.degrees - right.degrees || left.unit - right.unit);
    const seeds = [];
    for (const entry of sweep) {
      if (seeds.some((seed) => {
        const delta = Math.abs(seed.degrees - entry.degrees);
        return Math.min(delta, 360 - delta) < 25;
      })) continue;
      seeds.push(entry);
      if (seeds.length >= 2) break;
    }
    for (const seed of seeds) {
      let bestDegrees = seed.degrees;
      let bestCorr = seed.corr;
      for (let offset = -cfg.v0RotationStepDeg; offset <= cfg.v0RotationStepDeg;
        offset += cfg.v0RotationRefineDeg) {
        const degrees = seed.degrees + offset;
        const radians = (degrees * Math.PI) / 180;
        const corr = rotationSweepScore(
          reducedLuma, template, centre, seed.unit, Math.cos(radians), Math.sin(radians),
        );
        if (corr !== null && corr > bestCorr) {
          bestCorr = corr;
          bestDegrees = degrees;
        }
      }
      const radians = (bestDegrees * Math.PI) / 180;
      const centreFull = liftPoint(centre, factor);
      const H0 = similarityHomography(
        centreFull, seed.unit * factor, Math.cos(radians), Math.sin(radians),
      );
      const refined = refinePose(fullLuma, H0, patchesForN(13), cfg, telemetry);
      if (!refined) continue;
      poses.push({
        family: 'v0',
        n: 13,
        H: refined.H,
        score: refined.meanCorrelation,
        partial: refined.partial || null,
        sweepCorrelation: bestCorr,
      });
    }
  }
  return poses;
}

// ─────────────────────────────────────────────────────────────────────────
// 7. shape 합성 — cube-detect 의 shape 계약(cellSurfaceOnly)으로 출력.
// ─────────────────────────────────────────────────────────────────────────

/**
 * 같은 패밀리 안의 **기하 중복 포즈** 를 걷어낸다 — k3·k5 클러스터가 같은 물리 앵커를
 * 겹으로 검증하면 사실상 같은 H 가 두 번 조립되고, 하류에서 shape 마다 CS 평가
 * (n² 표본 × 후보 레이아웃)가 돌아 복호 시간이 곱절이 된다 (2026-08-16 실측).
 * 판정: 같은 n 이고, 투영 원점과 투영 대각점(0,−10)이 각각 2셀 이내면 중복.
 * 입력은 score 내림차순이라 자리당 최고점 포즈가 남는다. 회전이 다른 포즈는 대각점이
 * 갈라져 살아남는다. 결정성: 고정 순서 순회.
 */
function dedupePosesByGeometry(poses) {
  const kept = [];
  const projected = [];
  for (const pose of poses) {
    const origin = projectPoint(pose.H, { x: 0, y: 0 });
    const probe = projectPoint(pose.H, { x: 0, y: -10 });
    const cellPx = localCellPx(pose.H);
    if (!origin || !probe || !Number.isFinite(cellPx)) continue;
    const isDuplicate = projected.some((seen, index) =>
      kept[index].n === pose.n
      && Math.hypot(seen.origin.x - origin.x, seen.origin.y - origin.y)
        <= 2 * Math.max(seen.cellPx, cellPx)
      && Math.hypot(seen.probe.x - probe.x, seen.probe.y - probe.y)
        <= 2 * Math.max(seen.cellPx, cellPx));
    if (isDuplicate) continue;
    kept.push(pose);
    projected.push({ origin, probe, cellPx });
  }
  return kept;
}

function shapeFromPose(pose, index) {
  const vertices = [];
  for (const corner of CORNER_UNIT_OFFSETS) {
    const point = projectPoint(pose.H, { x: corner.x * pose.n, y: corner.y * pose.n });
    if (!point) return null;
    vertices.push(point);
  }
  const centre = projectPoint(pose.H, { x: 0, y: 0 });
  if (!centre) return null;
  let radiusSum = 0;
  for (const vertex of vertices) {
    radiusSum += Math.hypot(vertex.x - centre.x, vertex.y - centre.y);
  }
  return {
    componentIndex: 2000 + index,
    componentSource: 'cell-surface-block-locator',
    center: centre,
    vertices,
    // 정점 배열이 canonical 코너 순서(C0..C5)라 심은 홀수 인덱스 = parity 1.
    seamParity: 1,
    seamVertices: [1, 3, 5].map((k) => vertices[k]),
    radius: radiusSum / 6,
    maskFill: 0,
    concurrencyResidual: 1,
    seam: { contrast: 0, support: 0 },
    hardChecks: {
      hexSilhouette: false,
      diagonalConcurrency: false,
      yJunction: false,
      all: false,
    },
    score: pose.score,
    cellSurfaceOnly: true,
    estimatedN: pose.n,
    blockLocator: {
      family: pose.family,
      patchCorrelation: pose.score,
      // n=21 은 후보가 둘이라 로케이터 패밀리가 어느 쪽을 세웠는지 남긴다.
      // 수용은 여전히 CS 평가 게이트가 판정한다 (여기서 레이아웃을 못박지 않는다).
      layoutId: pose.layoutId || null,
      // 부분 앵커로 완성된 포즈면 그 사실과 근거 수치를 남긴다 (수용에는 관여하지
      // 않는다 — CS 게이트가 그대로 판정한다).
      partial: pose.partial || null,
    },
  };
}

/**
 * CS 파인더 블록 로케이터 진입점. luma 만 받는다 — 마스크·실루엣 무의존.
 * @returns {{shapes: object[], diagnostics: object}}
 */
export function detectCellSurfaceBlockShapes(luma, options = {}) {
  const cfg = calibration(options);
  const reduced = downsampleLumaForSeed(luma, cfg.searchMaxSide);
  const { width, height } = reduced.luma;
  const globalCut = otsuThreshold(reduced.luma);
  const cores = scanConcentricCores(reduced.luma, globalCut, cfg);
  const clusters = clusterCores(cores, cfg);

  const verified = [];
  const occupied = [];
  let inspectedK5 = 0;
  let inspectedK3 = 0;
  for (const cluster of clusters) {
    if (cluster.kind === 'k5') {
      if (inspectedK5 >= cfg.maximumVerifiedPerKind) continue;
      inspectedK5 += 1;
    } else {
      if (inspectedK3 >= cfg.maximumVerifiedPerKind) continue;
      inspectedK3 += 1;
    }
    // 같은 자리·같은 코어 종류의 클러스터 조각들 — 이미 검증된 자리면 건너뛴다.
    // (다른 종류는 막지 않는다 — k3 오검증이 같은 자리 k5 의 v2r2 검증을 가리면 안 된다.)
    if (occupied.some((hit) => hit.coreKind === cluster.kind
      && Math.hypot(hit.x - cluster.x, hit.y - cluster.y)
        <= 2.2 * Math.max(hit.u, cluster.u))) continue;
    // 코어 종류 우선 검증 후, 실패하면 교차 검증한다 — 링 침식으로 코어 비율이
    // 이웃 서명으로 넘어가는 경우(v2r2 중앙 ↔ v0 불스아이)를 회수한다.
    const native = cluster.kind === 'k5'
      ? verifyV2r2Cluster(reduced.luma, globalCut, cluster, cfg)
      : verifyV0Cluster(reduced.luma, globalCut, cluster, cfg);
    const hit = native || (cluster.kind === 'k5'
      ? verifyV0Cluster(reduced.luma, globalCut, cluster, cfg)
      : verifyV2r2Cluster(reduced.luma, globalCut, cluster, cfg));
    if (hit) {
      verified.push(hit);
      occupied.push({ ...hit, coreKind: cluster.kind });
    }
  }
  verified.sort((left, right) =>
    right.score - left.score || right.count - left.count
    || left.y - right.y || left.x - right.x);

  // 조기 분기 (2026-08-16 중앙 통일): 공유 K3 중앙 × K5 원거리 코어 쌍으로 앵커드
  // 패밀리를 먼저 세우고, 앵커드 포즈가 선 중앙은 v0 360° 스윕에서 뺀다.
  // 주의 — 같은 자리 중복 히트(k3·k5 클러스터가 같은 앵커를 각각 검증)를 위치
  // dedupe 로 걷어내는 안은 **측정으로 기각**했다: 중복이 차지하던 상위 슬롯에
  // 데이터 필드의 우연 K3 가 들어와, 실패 정합 + v0 스윕 비용이 중복 성공 정합보다
  // 비쌌다 (v1r2 클린 벤치 724→1620 ms). 상위 3/4 슬라이스가 사실상의 비용 캡이다.
  // 중앙 창 제한 (2026-08-24) — `centreWindowFraction` 을 준 호출자는 «찾는 블록이
  // 중앙 고정» 이라는 **계약**을 선언한 것이다 (비컨 어댑터). 그 창 밖 후보는 상위
  // 컷을 다투기 전에 빠진다 — 점수 컷은 비용 캡이지 «누가 진짜인가» 의 자가 아니다
  // (코너 QR 파인더가 v0-center 1.00 으로 컷을 점거하던 실측의 처방). 미선언 경로는
  // 아래 필터가 항등이라 비트 동일이다.
  const centreWindow = Number.isFinite(cfg.centreWindowFraction)
    && cfg.centreWindowFraction > 0 && cfg.centreWindowFraction <= 1
    ? cfg.centreWindowFraction : null;
  const inCentreWindow = (hit) => {
    if (centreWindow === null) return true;
    const halfW = width * centreWindow / 2;
    const halfH = height * centreWindow / 2;
    return Math.abs(hit.x - width / 2) <= halfW && Math.abs(hit.y - height / 2) <= halfH;
  };
  const centres = verified.filter((hit) => hit.kind === 'v0-center' && inCentreWindow(hit))
    .slice(0, 3);
  const corners = verified.filter((hit) => hit.kind === 'v2r2-corner').slice(0, 4);
  const partialTelemetry = { attempted: 0, completed: 0, byAnchorCount: {} };
  // 느슨한 코너 순회 (`verifyV0xqCornerCluster`) — **별도 순회**다 (그 함수 주석 참조):
  // 위 `verified` 배열·분류·occupied 에 닿지 않으므로 다른 패밀리의 동작은 한 비트도
  // 안 바뀐다. 2026-08-17 부터 소비자가 셋이라 앵커드 조립 **앞으로** 옮겼다:
  //   ① v0xq 삼중점 ② v0wq 삼중점 ③ **중앙 불스아이 확증 조립**(§과업 3 ③).
  // 순서를 옮겨도 이 루프는 위 결과에 의존하지 않으므로 산출은 같다.
  // 2026-08-17 v0TR 편입으로 소비자가 넷이 됐다 — ④ **v0trq 삼중점**. 코너 수집은
  // 넷 중 하나라도 켜져 있으면 돈다 (기존 셋의 게이트 표현은 한 자도 안 바뀐다).
  const v0xqCorners = [];
  if (cfg.v0xqFamily !== false || cfg.v0wqFamily !== false
    || cfg.v0trqFamily !== false
    || cfg.centreBullseyeConfirmedPoses !== false) {
    const v0xqOccupied = [];
    let inspected = 0;
    for (const cluster of clusters) {
      if (cluster.kind !== 'k5') continue;
      if (inspected >= cfg.v0xqMaxInspectedClusters) break;
      inspected += 1;
      if (v0xqOccupied.some((hit) => Math.hypot(hit.x - cluster.x, hit.y - cluster.y)
        <= 2.2 * Math.max(hit.u, cluster.u))) continue;
      const hit = verifyV0xqCornerCluster(reduced.luma, globalCut, cluster, cfg);
      if (!hit) continue;
      v0xqCorners.push(hit);
      v0xqOccupied.push(hit);
    }
    v0xqCorners.sort((left, right) =>
      right.score - left.score || right.count - left.count
      || left.y - right.y || left.x - right.x);
  }

  // 조기 분기 (2026-08-16 중앙 통일): 공유 K3 중앙 × K5 원거리 코어 쌍으로 앵커드
  // 패밀리를 세운다.
  const {
    posesV2r2, posesV1r2, posesV0x, posesV0w, posesV0w2, posesV0wy, posesV0t, posesV0ty,
    posesV0tr, posesV0try,
    anchoredCentres, companionPairs, slotQrRejected,
  } = assembleAnchoredPoses(
    centres, corners, luma, reduced.factor, cfg, partialTelemetry,
    // 동반자 게이트 전용 풀 — 잘리지 않은 엄격 코너 전체 (§squareRingUsesFullCornerPool).
    verified.filter((hit) => hit.kind === 'v2r2-corner'),
  );
  // ★ 중앙 불스아이 확증 (과업 3 ③) — 엄격 코너가 3개를 못 채워 사각 링 게이트가
  // 구조적으로 0 이 된 중앙만 구제한다. 엄격 경로가 이미 세운 중앙은 건드리지 않는다.
  const confirmed = cfg.centreBullseyeConfirmedPoses === false
    ? {
      posesV0x: [],
      posesV0w: [],
      posesV0w2: [],
      posesV0wy: [],
      posesV0t: [],
      posesV0ty: [],
      posesV0tr: [],
      posesV0try: [],
      confirmedCentres: new Set(),
      tripleCount: 0,
      slotQrRejected: 0,
    }
    : assembleBullseyeConfirmedPoses(
      centres, anchoredCentres,
      // 풀을 넓힌다 (종전 4). 링이 둘이면 진짜 링의 세 번째 멤버가 5위로 밀려
      // 잘려 나갔다 — 실측 근거는 §bullseyeConfirmedCornerPool 주석.
      v0xqCorners.slice(0, cfg.bullseyeConfirmedCornerPool),
      luma, reduced.factor, cfg,
      partialTelemetry,
    );
  posesV0x.push(...confirmed.posesV0x);
  posesV0w.push(...confirmed.posesV0w);
  posesV0w2.push(...confirmed.posesV0w2);
  posesV0wy.push(...confirmed.posesV0wy);
  posesV0t.push(...confirmed.posesV0t);
  posesV0ty.push(...confirmed.posesV0ty);
  posesV0tr.push(...confirmed.posesV0tr);
  posesV0try.push(...confirmed.posesV0try);
  // 확증 경로로 포즈가 선 중앙도 v0 360° 스윕에서 뺀다 (조기 분기와 같은 이유).
  const sweptExclusions = new Set(anchoredCentres);
  for (const index of confirmed.confirmedCentres) sweptExclusions.add(index);
  const posesV0 = assembleV0Poses(
    centres, sweptExclusions, reduced.luma, luma, reduced.factor, cfg, partialTelemetry,
  );
  // ⚠ `centres` 를 넘긴다 — 중앙 불스아이 거부권(§centreQrBullseyeVeto)의 입력이다.
  // 이미 검증된 배열이라 이미지 연산은 늘지 않는다.
  const emptyCentreQr = {
    poses: [], tripleCount: 0, centreRejected: 0, bullseyeVetoed: 0, finderContrastRejected: 0,
  };
  const v0xq = cfg.v0xqFamily === false
    ? emptyCentreQr
    : assembleV0xqPoses(
      v0xqCorners.slice(0, 4), luma, reduced.factor, cfg, partialTelemetry, centres,
    );
  const posesV0xq = v0xq.poses;
  // v0wq — v0xq 와 **같은 코너 히트**를 쓴다. 코너 검증(verifyV0xqCornerCluster)은 한 번만
  // 돌고, 삼중점 탐색도 같은 배열에서 다시 돈다. 즉 편입 비용은 «코너 재탐색» 이 아니라
  // «삼중점당 중앙 게이트 + refinePose 한 벌» 이다 — 벤치가 재는 것이 그 값이다.
  //
  // ⚠ v0xqFamily 를 꺼도 v0wq 는 산다 (코너 수집은 두 패밀리 중 하나라도 켜져 있으면
  // 돈다). 두 패밀리를 각각 격리해서 재려면 스위치도 각각 꺼야 한다.
  const v0wq = cfg.v0wqFamily === false
    ? emptyCentreQr
    : assembleV0wqPoses(
      v0xqCorners.slice(0, 4), luma, reduced.factor, cfg, partialTelemetry, centres,
    );
  const posesV0wq = v0wq.poses;
  // v0trq — 같은 코너 배열을 쓰되 **슬라이스가 넓다** (§v0trqCornerBudget).
  // v0TR 프레임은 면당 동심 사각이 둘이라 참 코너가 6개 뜨고, 상위 4개가 두 반경으로
  // 섞이면 «내 반경(√129)» 의 삼중점이 구조적으로 못 선다. 넓힌 것은 이 호출부뿐이라
  // v0xq·v0wq·불스아이 확증의 입력은 한 자도 안 바뀐다.
  const v0trq = cfg.v0trqFamily === false
    ? emptyCentreQr
    : assembleV0trqPoses(
      v0xqCorners.slice(0, cfg.v0trqCornerBudget), luma, reduced.factor, cfg,
      partialTelemetry, centres,
    );
  const posesV0trq = v0trq.poses;

  const shapes = [];
  // 순서 = 셰이프 후보 순서. v0W 는 **v0X 뒤**다 — 라인업 기본이 v0X 인 것과 같은
  // 이유이고, `cellSurfaceFinal.CELL_SURFACE_FINAL_IDS` 의 선언 순서와 맞춘다.
  // v0T·v0TY (2026-08-17 편입) 는 선언 순서대로 v0WY 뒤에 선다.
  for (const familyPoses of [
    posesV2r2, posesV1r2, posesV0x, posesV0xq, posesV0w, posesV0wq, posesV0w2, posesV0wy,
    posesV0t, posesV0ty,
    // v0TR 계열 (2026-08-17 편입 · v0try 는 2026-08-18) — 선언 순서대로 v0TY 뒤에 선다
    // (`cellSurfaceFinal.CELL_SURFACE_FINAL_IDS` 와 같은 순서 — n=21 기본은 v0t 그대로).
    posesV0tr, posesV0trq, posesV0try,
    posesV0,
  ]) {
    familyPoses.sort((left, right) =>
      // v0X 는 사각 링 동반자가 많은 포즈를 먼저 본다 (3면 동일 서명이 실재한다는 증거).
      (right.squareRingCompanions || 0) - (left.squareRingCompanions || 0)
      || right.score - left.score || left.n - right.n);
    for (const pose of dedupePosesByGeometry(familyPoses).slice(0, cfg.maximumPosesPerFamily)) {
      const shape = shapeFromPose(pose, shapes.length);
      if (shape) shapes.push(shape);
    }
  }

  return {
    shapes,
    diagnostics: {
      source: 'cell-surface-block-locator',
      downsampleFactor: reduced.factor,
      coreCandidates: cores.length,
      clusterCount: clusters.length,
      verified: verified.map((hit) => ({
        kind: hit.kind,
        x: hit.x * reduced.factor,
        y: hit.y * reduced.factor,
        u: hit.u * reduced.factor,
        score: hit.score,
        count: hit.count,
      })),
      poseCount: {
        v2r2: posesV2r2.length,
        v1r2: posesV1r2.length,
        v0x: posesV0x.length,
        v0xq: posesV0xq.length,
        v0w: posesV0w.length,
        v0wq: posesV0wq.length,
        v0w2: posesV0w2.length,
        v0wy: posesV0wy.length,
        v0t: posesV0t.length,
        v0ty: posesV0ty.length,
        v0tr: posesV0tr.length,
        v0trq: posesV0trq.length,
        v0try: posesV0try.length,
        v0: posesV0.length,
      },
      // v0WY 관측 — refinePose 를 통과하고도 **먼 코너에 QR 이 없어** 잘린 포즈 수.
      // v0W 프레임에서 이 값이 0 이면 «슬롯 확증이 살아 있는가» 를 못 재는 것이다
      // (회귀가 대조군으로 이 수치를 함께 본다).
      //
      // 확증을 부르는 조립 경로는 **둘**이다 — 앵커드(§assembleAnchoredPoses)와
      // 중앙 불스아이 구제(§assembleBullseyeConfirmedPoses). 2026-08-17 수리 전에는
      // 구제 경로의 거절이 계수되지 않아 이 대조군이 거절의 절반을 놓쳤다.
      // `rejected` 는 두 경로의 **합**이고 (기존 소비자 무접촉), 경로별 값이 따로 선다
      // — 불변식: rejected === rejectedAnchored + rejectedBullseye.
      slotQr: {
        rejected: slotQrRejected + confirmed.slotQrRejected,
        rejectedAnchored: slotQrRejected,
        rejectedBullseye: confirmed.slotQrRejected,
      },
      // v0xq 관측 — 120° 코너 삼중점 수와, 그중 중앙 QR 게이트가 자른 시드 수.
      // v0X·v1r2·v2r2 프레임에서도 삼중점은 뜬다(K5 코너가 120°) — 게이트가
      // 자르는 것이 그쪽이고, 그 사실이 centreRejected 로 보인다.
      centerQr: {
        corners: v0xqCorners.length,
        tripleCount: v0xq.tripleCount,
        centreRejected: v0xq.centreRejected,
        // v0wq 는 같은 코너·같은 삼중점을 쓰므로 tripleCount 가 같아야 정상이다
        // (다르면 둘 중 하나가 코너 배열을 몰래 건드린 것이다).
        v0wqTripleCount: v0wq.tripleCount,
        v0wqCentreRejected: v0wq.centreRejected,
        // 교차 누수 봉합 관측 (2026-08-17) — 두 새 조건이 각각 몇 개를 잘랐나.
        // 불스아이 중앙 레이아웃 프레임(v0X·v0W·v0W2)에서 bullseyeVetoed 가 곧
        // «샐 뻔한 삼중점» 의 수다. tripleCount 는 자르기 **전** 값이라 분모로 읽는다.
        bullseyeVetoed: v0xq.bullseyeVetoed,
        finderContrastRejected: v0xq.finderContrastRejected,
        v0wqBullseyeVetoed: v0wq.bullseyeVetoed,
        v0wqFinderContrastRejected: v0wq.finderContrastRejected,
        // v0trq 관측 (2026-08-17) — **삼중점 수가 위와 다를 수 있다**. 두 이유다:
        //   ① 슬라이스가 넓다 (§v0trqCornerBudget) ② v0TR 프레임에는 반경이 다른
        //   삼중점이 둘 선다 (바깥 √279 · 안쪽 √129). 남의 삼중점은 시드 스케일이
        //   어긋나 중앙 QR 게이트(centreRejected)에서 죽는 것이 기대 거동이다.
        v0trqCorners: Math.min(v0xqCorners.length, cfg.v0trqCornerBudget),
        v0trqTripleCount: v0trq.tripleCount,
        v0trqCentreRejected: v0trq.centreRejected,
        v0trqBullseyeVetoed: v0trq.bullseyeVetoed,
        v0trqFinderContrastRejected: v0trq.finderContrastRejected,
      },
      // 사각 링 서명 관측 — 120° 동반자를 가진 (중앙, 코너) 쌍의 수.
      // v0X 프레임은 3면 동일 SE 블록이라 크고, v1r2·v2r2 프레임은 0 이 기대값이다.
      squareRing: { companionPairs },
      // 조기 분기 관측 — 몇 개의 K3 중앙이 앵커드로 분기했고 몇 개가 v0 스윕으로
      // 내려갔는지 (swept = centres − anchored).
      earlyBranch: {
        centres: centres.length,
        anchored: anchoredCentres.size,
        swept: centres.length - sweptExclusions.size,
      },
      // 중앙 불스아이 확증 관측 (2026-08-17) — 엄격 경로가 못 세운 중앙을 몇 개
      // 구제했나. triples 는 «불스아이가 중심에 앉은 느슨한 삼중점» 의 수(분모),
      // centres 는 그중 실제로 포즈까지 간 중앙 수, poses 는 세운 포즈 수.
      bullseyeConfirmed: {
        triples: confirmed.tripleCount,
        centres: confirmed.confirmedCentres.size,
        // v0wy 는 v0T 편입 라운드에 합산에 넣었다 — 종전 누락 정정. 기본 cfg 에서는
        // v0wyFamily off 라 0 이므로 기본 관측값은 비트 동일하다 (복원 스위치 경로만 정확해진다).
        poses: confirmed.posesV0x.length + confirmed.posesV0w.length
          + confirmed.posesV0w2.length + confirmed.posesV0wy.length
          + confirmed.posesV0t.length + confirmed.posesV0ty.length
          + confirmed.posesV0tr.length + confirmed.posesV0try.length,
      },
      // 부분 앵커 완성 관측 — attempted 는 «엄격 경로 실패 + 앵커가 프레임 밖» 인
      // 시드 수, completed 는 그중 상대 잔차 게이트까지 통과한 수.
      partialAnchor: {
        attempted: partialTelemetry.attempted,
        completed: partialTelemetry.completed,
        byAnchorCount: partialTelemetry.byAnchorCount,
      },
      shapeCount: shapes.length,
    },
  };
}

/** 단위 테스트·진단 전용 내부 노출 — 런타임 경로는 detectCellSurfaceBlockShapes 만 쓴다. */
export const CS_BLOCK_LOCATOR_INTERNALS = Object.freeze({
  binarizeSeries,
  makeSeriesScratch,
  registerPatch,
  refineHomographyWithPatches,
  refineWithSubPatches,
  homographyLeastSquares,
  scanConcentricCores,
  clusterCores,
  // 격자판 등가 검산용 선형 참조판 (§clusterCoresLinear). 런타임 경로는 안 쓴다.
  clusterCoresLinear,
  verifyV2r2Cluster,
  verifyV0Cluster,
  verifyV0xqCornerCluster,
  assembleV0xqPoses,
  assembleV0wqPoses,
  assembleV0trqPoses,
  centreQrFinderContrast,
  patchesForV0wq,
  patchesForV0tr,
  patchesForV0trq,
  rayTransitions,
  recentreByRays,
  patchesForN,
  patchesFor,
  assembleAnchoredPoses,
  assembleBullseyeConfirmedPoses,
  anchoredSimilaritySeed,
  anchoredSimilaritySeedTo,
  squareRingCompanions,
  similarityLeastSquares,
  refineAnchorsPartial,
  refineSubPatchesPartial,
  anchorsLeaveFrame,
  residualGate,
  // 진단 전용 추가 (2026-08-17, 고립점 앵커 타당성 계측). 런타임 경로 무접촉 —
  // 「A 블록 고립점 삼중점을 시드로 써도 refinePose 가 참 포즈로 수렴하는가」 를
  // 재려면 정련기 자체를 불러야 한다 (`claude-dot-seed-feasibility.mjs`).
  refinePose,
  localCellPx,
});
