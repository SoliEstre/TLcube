/**
 * scanner-zoom.js — 스캐너 확대·크롭·실효 배율 + 정사각 뷰 + 3링 조준 가이드 기하.
 *
 * 화면 CSS 확대는 디코더에 전달되지 않는다. 이 모듈은
 *   1) 트랙 `applyConstraints({ advanced: [{ zoom }] })` (지원 시)
 *   2) 원본 해상도에서 중앙 크롭 후 축소 (미지원·거부 시)
 * 두 경로의 수치와, **정사각 프리뷰 컨테이너 ≡ 분석 정사각** 구조(2026-08-16 운영자
 * 지시)의 수치만 맡는다. DOM 은 스캐너 셸이 소유한다.
 */

import { CORNER_UNIT_OFFSETS, SQRT3 } from './hexgrid.js';

/**
 * 변-중점(E) 방향 단위 벡터 — E_i = (C_i + C_{i+1}) / √3.
 *
 * |C_i + C_{i+1}| = 2·cos(30°) = √3 이므로 나누면 정확히 단위 벡터다. 삼각함수를
 * 다시 돌리지 않고 CORNER_UNIT_OFFSETS(닫힌 형태 상수)에서만 유도한다 — C 링과의
 * 30° 회전 관계가 **구성상** 보장된다. 가이드 중간 링(O 실루엣 목표)의 방향 정본.
 */
export const EDGE_UNIT_OFFSETS = Object.freeze(CORNER_UNIT_OFFSETS.map((u, i) => {
  const v = CORNER_UNIT_OFFSETS[(i + 1) % 6];
  return Object.freeze({ x: (u.x + v.x) / SQRT3, y: (u.y + v.y) / SQRT3 });
}));

/** 복호 하한(셀당 px). scanner.js 주석의 실측(2026-08-11)과 같다. */
export const CELL_PX_FLOOR = 9;

/** 디코더에 넘기는 프레임 긴 변 상한. scanner.js FRAME_MAX_SIDE 와 같아야 한다. */
export const FRAME_MAX_SIDE = 960;

/**
 * 스캐너가 켤 때 쓰는 기본 배율. **한 곳에서만 바꾼다.**
 *
 * 2026-08-15 되돌림: 2 → 1 (12점 가이드 의뢰 때 확정, r3 정사각 뷰에서도 유지).
 * 실측(배포 f2dbb2b 이후 340프레임, ClickHouse 직조회): zoom 2 + 상시 크롭에서
 * 화면 가이드 사각형과 분석 크롭 경계가 어긋나, 가이드에 맞춘 구간(2면 이상 잘림)
 * 성공 0% (274/274) · 실루엣이 프레임 안에 온전한 구간 100% (34/34). 확대가 아니라
 * «가이드 ≠ 분석 영역» 불일치가 사고 원인이었다. r3 에서는 프리뷰 자체가 분석
 * 정사각(정사각 컨테이너 + cover)이라 불일치가 구조적으로 소멸한다. 수동 확대 유지.
 */
export const DEFAULT_USER_ZOOM = 1;

/**
 * 조준 가이드의 기준 셀 수.
 * Type O V3 는 k=10 → 2k+1 = 21. Type Y Y1 은 n=21.
 * Y2 는 n=25 이라 같은 9px 하한에서 더 큰 점유율이 필요하다.
 */
export const GUIDE_CELLS_V3 = 21;
export const GUIDE_CELLS_Y2 = 25;

/** 크롭 배율 기본 범위. 하드웨어 zoom 이 없으면 이 값을 쓴다. */
export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 8;
export const CROP_ZOOM_STEP = 0.1;

/**
 * ── 연속 실패 시 자동 크롭 사다리 (2026-08-18) ─────────────────────────────
 *
 * 왜: 실사진 역산(`test/output/lanes/claude-scanner-cellpx.out.txt`)에서 운영자의
 * 실패 거리가 **셀당 3.7\~5.9px**, 「되기 시작하는」 경계가 **6.1\~6.3px** 였다.
 * 합성 사다리의 벽(ppu 7 본문 RS · ≤6 포맷 불가)과 같은 자리다. 즉 그 거리에서는
 * 프레임이 느린 게 아니라 **셀 픽셀이 모자라서** 어떤 알고리즘도 못 읽는다.
 * (운영자 확인: 줌 1 · 기본 광각 — 광각이라 코드가 더 작게 잡힌다.)
 *
 * ⚠ **기본 확대는 건드리지 않는다.** `DEFAULT_USER_ZOOM = 1` 은 2026-08-15
 * **운영자 지시**로 2 → 1 복귀한 값이다 (당시 사고 원인은 확대 자체가 아니라
 * «가이드 ≠ 분석 크롭» 불일치, 성공 0%/274). 그 전제는 r3 에서 소멸했지만
 * 되돌리는 것은 운영자 판정이지 이 변경의 몫이 아니다.
 *
 * 대신 **실패가 쌓인 구간만** 친다: 연속 실패가 한 단씩 쌓일 때 크롭을 올리고,
 * 성공하면 즉시 1 로 복귀한다. 세 가지가 안전장치다.
 *   ① **끈적하다** — 프레임마다 오르내리지 않는다. 매 프레임 흔들면 프리뷰가
 *      출렁이고, 프리뷰를 안 따라가게 하면 2026-08-15 의 «가이드 ≠ 분석» 을
 *      그대로 재현한다. 분석과 프리뷰는 **같은 값**을 쓴다.
 *   ② **잘림이면 올리지 않는다** — clipSide==='multi' 는 «너무 가깝다» 는 뜻이라
 *      확대는 정반대 처방이다. 그 신호가 오면 사다리를 0 으로 되돌린다.
 *   ③ **사용자가 손대면 멈춘다** — 수동 확대가 기본값과 다르면 자동은 개입하지 않는다.
 *
 * 상한 2.2 인 이유: 실패 세트 3.7\~5.9px × 2.2 = 8.1\~13.0px 로 벽(6\~7)을 넘고
 * CELL_PX_FLOOR(9) 에 닿는다. 그 이상은 크롭 창이 좁아져 조준이 어려워진다.
 */
export const AUTO_CROP_LADDER = Object.freeze([1, 1.5, 2.2]);
/** 한 단 올리는 데 필요한 연속 실패 프레임 수. */
export const AUTO_CROP_STEP_FRAMES = 8;

/**
 * 연속 실패 수 → 사다리 인덱스. 순수 함수라 테스트가 직접 잰다.
 *
 * @param {number} failedFrames 연속 실패 프레임 수
 * @param {boolean} clipped 잘림(«너무 가깝다») 신호가 서 있는가
 * @param {boolean} manual 사용자가 확대를 직접 건드렸는가
 * @returns {number} AUTO_CROP_LADDER 인덱스 (0 = 개입 없음)
 */
export function autoCropRung(failedFrames, { clipped = false, manual = false } = {}) {
  if (clipped || manual) return 0;
  const n = Number(failedFrames);
  if (!Number.isFinite(n) || n < AUTO_CROP_STEP_FRAMES) return 0;
  return Math.min(
    AUTO_CROP_LADDER.length - 1,
    Math.floor(n / AUTO_CROP_STEP_FRAMES),
  );
}

/** 사다리 인덱스 → 크롭 배율. 범위 밖은 양끝으로 물린다. */
export function autoCropZoomFor(rung) {
  const index = Math.max(0, Math.min(AUTO_CROP_LADDER.length - 1, Math.trunc(Number(rung) || 0)));
  return AUTO_CROP_LADDER[index];
}

/*
 * ── 3링 18점 조준 가이드 (운영자 설계 2026-08-15, 12점의 재설계) ──────────────
 *
 * 동심 육각형 3개의 꼭짓점 18점. 세 링의 비율은 감이 아니라 **타입 간 관계**에서
 * 코드 기하로 유도한다 (12점의 안쪽/바깥 갭은 단일 타입(O V3) 기준이라 폐기).
 *
 *   · 바깥 6점 (C0…C5 방향) = 코드 외곽 목표 — Y 육각 꼭짓점·K 육망성 첨두(전 방향),
 *     A 정삼각 꼭짓점(그중 C0·C2·C4). K/A 실루엣 첨두 반경 = (3k+2)·s
 *     (placementA 영역의 변 직선 — q=k 열 UR 꼭짓점열 — 연장 교점, 테스트가 좌표 검산).
 *   · 중간 6점 (변-중점 E 방향 = C 에서 30° 회전) = **O 실루엣 목표 (신규)**.
 *     K 를 바깥 점에 채우면 K 의 중앙 육각(두 삼각 교집합)이 정확히 여기 온다:
 *       중앙 육각 반경 = (3k+2)s/√3 = √3(k+2/3)s — O 실루엣 공식과 **유리수 항등**.
 *     따라서 r_outer/r_middle = √3 (k 무관, 정확), 방향은 30° 회전이 기하의 결과다.
 *     같은 k 면 셀 크기도 같다(s = R_out/(3k+2) 양쪽 동일) — «O 를 그대로 같은 k 의
 *     K 로 바꾸면 첨두가 바깥 점에 맞는다» (운영자 불변식, 짝: O V1↔A0 기하 k6 ·
 *     O V2↔A1 k8 · O V3↔A2 k10 — 운영자 표기 «O1 - K1(A1)» 은 A 1-베이스 읽기).
 *   · 안쪽 6점 (C 방향) = 짝 대표(GUIDE_PAIR_K=6, 운영자 지정 «O1»)의 O 코드가
 *     **중간 링에 앉을 때**의 중앙 파인더 큐브 꼭짓점.
 *
 * 방향 정본: 실루엣 꼭짓점 0 = 상단 C0 (decoder/cube-detect.js simplifyHullToHex ·
 * ygrid.js 헤더). hexgrid 의 CORNER_UNIT_OFFSETS 를 그대로 재사용한다 — 삼각함수
 * 재계산 금지(닫힌 형태 상수라야 결정적이다).
 */

/**
 * 바깥 육각형 꼭짓점 지름 / 분석 프레임 한 변.
 *
 * 산정(실측 성공 지대 점유율 0.15-0.3, 배포 f2dbb2b 이후 340프레임):
 *   코드를 바깥 점(반지름 R = f·S/2)까지 채우면
 *     Y 육각·K 육망성 bbox = √3R × 2R → 점유율 (√3/2)·f²
 *     A 정삼각      bbox = √3R × 1.5R → 점유율 (3√3/8)·f²
 *   0.15 ≤ 점유율 ≤ 0.3 을 두 형상 동시에 만족하는 f ∈ [0.481, 0.589].
 *   f = 0.54 → Y/K 0.253 · A 0.189 — 지대 안쪽, 상한 0.3 에 손떨림 여유.
 * cell px 검산(960px 프레임 기준 R = 259.2, 첨두 반경 (3k+2)s 기준 — kaApexRadiusCells):
 * Y1 12.3 · Y2 10.4 · O V3 14.0 · A0 13.0 · A1 10.0 · A2 8.10(<9).
 * A2 는 프레임 승격이 받치되 **기기 조건부**다 — 승격은 round(sourceSide)로 캡핑되므로
 * 전형적 1080p 스트림에선 1080² → A2 ≈ 9.11px (하한 9 대비 여유 1.2%).
 * 12.15px 는 min side ≥ 1440 기기에서만이고, 그 미만 저해상도 스트림은 승격해도
 * 하한 미달일 수 있다. (구 표기 8.36/9.41 은 ≈(3k+1) 반경 기준 — 폐기.)
 */
export const GUIDE_OUTER_FRACTION = 0.54;

/**
 * 중앙 파인더 큐브 반지름(셀). finder-patterns.js `central-cube-3tone`.radiusCells
 * 의 사본이다 — 값이 갈리면 scanner-zoom.test.js 가 잡는다(모듈 전체를 번들에
 * 끌어들이지 않으려고 import 대신 상수 + 동기화 테스트를 쓴다).
 */
export const GUIDE_FINDER_RADIUS_CELLS = 3.5;

/**
 * K/A 실루엣 첨두 반경(셀 단위) = (3k+2)·size.
 * 유도: placementA 영역의 변 직선(q=k 열 UR 꼭짓점열, 기울기 √3)과 그 거울상의
 * 교점 = (0, −(3k+2)s). 하변(r=k 행 하단 꼭짓점, y=(1.5k+1)s)과의 교점도 반경
 * 2(1.5k+1)s = (3k+2)s — 정삼각형. K = A ∪ 반전A 라 첨두가 C0…C5 전 방향.
 * scanner-zoom.test.js 가 placementA/cell-editor-core 좌표로 검산한다.
 */
export function kaApexRadiusCells(k) {
  return 3 * k + 2;
}

/**
 * O 복합 실루엣(반경 k 육각 영역)의 단순화 육각 꼭짓점 반경 = √3·(k+2/3)·size.
 * 유도: 12각형 hull 의 긴 변 연장 교점 (k=2 전수 좌표 검산 — 8√3/3 일치).
 * 꼭짓점 방향은 변-중점(E) — K 중앙 육각(두 삼각 교집합)과 같은 직선·같은 꼭짓점:
 *   (3k+2)/√3 = √3(k+2/3)  (모든 k 에서 유리수 항등).
 */
export function silhouetteRadiusCells(k) {
  return SQRT3 * (k + 2 / 3);
}

/**
 * 중간 육각형(E 방향) 꼭짓점 지름 / 정사각 뷰 한 변 = 바깥/√3.
 *
 * «같은 k 의 K 를 바깥 점까지 채우면 K 중앙 육각 = O 실루엣이 정확히 여기 온다»
 * (운영자 불변식). r_outer/r_middle = (3k+2) ÷ (3k+2)/√3 = √3 — k 무관, 정확.
 */
export const GUIDE_MIDDLE_FRACTION = GUIDE_OUTER_FRACTION / SQRT3;

/**
 * 안쪽 링이 기준하는 O↔K(A) 버전 짝의 k. 운영자 지정 «O1 - K1(A1)» = 코드 명명
 * O V1(k=6) ↔ A0 기하의 K. (같은 k 끼리만 불변식이 성립한다 — V2↔A1 은 k8,
 * V3↔A2 는 k10. 운영자 표기는 A 를 1-베이스로 읽은 것.)
 */
export const GUIDE_PAIR_K = 6;

/**
 * 안쪽 육각형(C 방향) 꼭짓점 지름 / 정사각 뷰 한 변.
 * = «짝 k=6 의 O 코드가 **중간 링**에 앉을 때의 중앙 파인더 큐브» 크기
 *   (구 12점의 0.102299 = «O V3 가 바깥 링」 기준 단일 타입 유도 — 폐기).
 * = MIDDLE × 3.5/(√3(6+2/3)) = OUTER × 3.5/(3·6+2) = 0.0945.
 */
export const GUIDE_INNER_FRACTION =
  GUIDE_MIDDLE_FRACTION * (GUIDE_FINDER_RADIUS_CELLS / silhouetteRadiusCells(GUIDE_PAIR_K));

/**
 * 코드를 바깥 점까지 채웠을 때의 예상 점유율(bbox / 분석 프레임).
 * 실측 성공 지대 [0.15, 0.3] 안에 있는지 테스트가 검사한다.
 */
export function guideOccupancyEstimates(fraction = GUIDE_OUTER_FRACTION) {
  const f = Number(fraction);
  if (!Number.isFinite(f) || f <= 0) return null;
  return {
    hexagon: (SQRT3 / 2) * f * f, //  Y 육각·K 육망성 (첨두 반경 R = f·S/2)
    triangle: ((3 * SQRT3) / 8) * f * f, // A 정삼각 (꼭짓점 반경 R)
  };
}

/**
 * 3링 18점의 중심 기준 좌표. `screenSide` = 정사각 뷰(≡ 분석 정사각 투영) 한 변(px).
 * 바깥·안쪽 = C 방향(0 = 상단, 이후 화면상 시계방향), 중간 = E 방향(C 에서 30° 회전).
 */
export function guideDotPositions(screenSide, centerX = 0, centerY = 0) {
  const side = Number(screenSide);
  if (!Number.isFinite(side) || side <= 0) return null;
  const ring = (offsets, fraction) => offsets.map((u) => ({
    x: centerX + u.x * fraction * (side / 2),
    y: centerY + u.y * fraction * (side / 2),
  }));
  return {
    outer: ring(CORNER_UNIT_OFFSETS, GUIDE_OUTER_FRACTION),
    middle: ring(EDGE_UNIT_OFFSETS, GUIDE_MIDDLE_FRACTION),
    inner: ring(CORNER_UNIT_OFFSETS, GUIDE_INNER_FRACTION),
  };
}

/**
 * 정사각 뷰 한 변 / 가용 영역 짧은 변. 산정 근거:
 *   · 상한: 링·점·테두리가 뷰 경계에 붙지 않을 시각 여유 + 노치/safe-area 인셋을
 *     흡수할 양쪽 4% (합 8%). 가이드 최대 반경은 0.54/2 = 27% 라 어떤 비율 < 1 에서도
 *     점 이탈은 없다 — 8% 는 순수 시각·인셋 마진이다.
 *   · 하한: 뷰가 작을수록 같은 거리에서 코드가 프리뷰에 작게 보여 사용자가 과도하게
 *     다가간다. 분석 해상도(grab)는 뷰 크기와 무관하므로(센서 중앙 정사각 그대로)
 *     크게 잡는 쪽이 손해가 없다 → 마진을 뺀 최대 = 0.92.
 * CSS `min(92vw, 92dvh)` 와 **같은 식**이어야 한다 — 갈리면 테스트가 잡는다.
 */
export const SQUARE_VIEW_FRACTION = 0.92;

/**
 * 가용 영역(w×h)에서의 정사각 뷰 한 변(px). 방향(세로/가로/폴드)을 타지 않는다 —
 * 짧은 변 하나로 결정된다. 이것이 r3 구조의 핵심: 프리뷰 컨테이너가 정사각이면
 * `object-fit: cover` 가 보여주는 것이 정확히 **센서 중앙 정사각** = cropWindow(crop=1)
 * 의 분석 영역이라, «가이드 ≠ 분석» 불일치가 좌표 변환 없이 구조적으로 소멸한다.
 *
 * ⚠ 이 함수는 «시각 여백 상한» 항 하나(CSS `--tl-vmin-cap`)만 준다. r4 부터 실제 뷰
 * 한 변은 여기에 **배치 적합 상한**(스택: 가용 세로 − UI 예산 / 옆배치: 가용 가로 −
 * 패널 최소폭)을 더 min 한 값이다 — `scanLayout()` 이 정본이다.
 */
export function squareViewSide(availWidth, availHeight, fraction = SQUARE_VIEW_FRACTION) {
  const w = Number(availWidth);
  const h = Number(availHeight);
  const f = Number(fraction);
  if (!(w > 0) || !(h > 0) || !(f > 0) || !(f <= 1)) return null;
  return Math.min(w, h) * f;
}

/*
 * ── r4 화면비 적응 배치 (운영자 지시 2026-08-16) ──────────────────────────────
 *
 * 왜 필요했나: r3 는 정사각 변을 «뷰포트 짧은 변 92%» 하나로 정했다. 그런데 아래
 * 스택(로고·안내·상태·줌·사진 버튼·푸터)의 높이는 화면이 커져도 거의 **상수**(≈390px)
 * 라서, 세로 비율이 대략 0.58(H=844) 을 넘는 순간 스택이 화면 밖으로 밀려 페이지가
 * 스크롤됐다. 태블릿 세로(768×1024)·태블릿 가로·폴드 펼침이 전부 여기 걸렸다.
 * 기존 가로 대응(`max-height:620px and orientation:landscape`)은 높이 620 초과인
 * 태블릿·폴드 가로를 아예 못 잡았다.
 *
 * 불변식: **페이지 스크롤 0**. 아래 상수와 `scanLayout()` 은 index.html 의 CSS 커스텀
 * 속성과 **한 쌍**이며, scanner-zoom.test.js 가 CSS 문자열과 대조한다.
 */

/** 옆배치(정사각 | 패널) 로 넘어가는 뷰포트 비율 W/H. CSS `(min-aspect-ratio: 9/10)`. */
export const SPLIT_MIN_ASPECT = 0.9;

/** 셸 패딩의 인셋 없는 값 — CSS `max(10px, env(safe-area-inset-*))`. */
export const SHELL_PAD_MIN = 10;

/** 셸 자식 사이 간격 — CSS `--tl-shell-gap`. */
export const SHELL_GAP = 10;

/** 옆배치의 열 간격 — CSS `--tl-split-gap`. */
export const SPLIT_COLUMN_GAP = 14;

/** 옆배치에서 패널 열이 요구하는 폭 — CSS `--tl-ui-min-w` 의 `min(300px, …)` 항. */
export const SPLIT_PANEL_MIN_WIDTH = 300;

/**
 * 패널 열 폭의 화면 비율 캡 — CSS `min(300px, 42vw)`.
 * 세로의 `UI_BUDGET_CAP_FRACTION` 과 같은 이유다: 고정 300px 이면 좁은 가로 화면
 * (예: 400×320)에서 정사각이 하한(96px)까지 밀려 배치가 성립하지 않는다.
 */
export const SPLIT_PANEL_CAP_FRACTION = 0.42;

/**
 * 정사각 변의 절대 하한 — CSS `--tl-square-side` 의 `max(96px, …)`.
 * 산정: 96px 이면 가이드 바깥 링 지름이 51.8px 이라 조준은 가능하다. 이 하한이
 * 걸리는 것은 짧은 변 240px 미만의 비현실적 뷰포트뿐이다(`body{min-width:320px}`).
 * 하한이 없으면 극단 뷰포트에서 `width` 가 음수가 되어 선언 자체가 무효가 된다.
 */
export const SQUARE_MIN_SIDE = 96;

/**
 * 세로 스택 UI 예산의 분해. 각 값은 index.html 의 CSS 선언에서 산출한 것이다
 * (진단표 참조). 합이 `--tl-ui-stack-h` 의 calc 항과 **문자 그대로** 같아야 한다.
 *
 *   top    36 = .brand-logo (8+8 padding + 1+1 border + 14px lh 1 = 32) + 여유 4
 *   guide 132 = 메시지 2줄(16 + 2×21.6 = 59.2) + 안내1 2줄(4 + 2×16.2 = 36.4)
 *               + 안내2 1줄(4 + 16.2 = 20.2) + .scan-guide-wrap grid gap 8×2 = 131.8
 *   status 34 = .scan-status 1줄 (14 + 18.2 = 32.2) + 여유
 *   zoom   62 = padding 8+8 + border 1+1 + 버튼 44
 *   photo  52 = .photo-button min-height
 *   footer 24 = padding-top 8 + 11px lh 1.35 (= 22.85) + 여유
 *   gaps   76 = 셸 gap 10×3 + 패널 내부 gap 10 + .scanner-bottom (padding-top 12 + gap 12×2)
 *
 * 즉 예산은 «안내가 전부 최대 줄 수로 접힌 폰» 을 담는 값이다. 실제 콘텐츠가 이보다
 * 크면 패널이 내부 스크롤을 갖고, 작으면 정사각이 그만큼 커진다 — 어느 쪽도 페이지를
 * 스크롤시키지 않는다.
 */
export const UI_STACK_BUDGET_PARTS = Object.freeze({
  top: 36,
  guide: 132,
  status: 34,
  zoom: 62,
  photo: 52,
  footer: 24,
  gaps: 76,
});

/** 세로 스택 UI 예산(px) = 위 분해의 합. CSS `--tl-ui-stack-h`. */
export const UI_STACK_BUDGET = Object.values(UI_STACK_BUDGET_PARTS)
  .reduce((sum, part) => sum + part, 0);

/**
 * UI 예산이 화면 높이에서 차지할 수 있는 상한 비율 — CSS `min(var(--tl-ui-stack-h), 52dvh)`.
 *
 * 왜 캡이 필요한가: 예산이 고정 `UI_STACK_BUDGET`(416px)이면 세로 568px 짜리 작은
 * 화면에서 정사각이 132px(= 568 − 20 − 416)로 쪼그라들어 «카메라 뷰» 로서 기능을 잃는다.
 * 화면의 52% 를 넘는 예산은 쓰지 않고, 대신 그 화면에서는 **패널이 내부 스크롤**을
 * 갖는다 (페이지는 여전히 0). 52% 는 «정사각이 가용 세로의 절반 미만으로 내려가지
 * 않는다» 를 뜻한다.
 *
 * [정정 2026-08-16, r5] 이 주석과 `scanLayout()` 주석이 근거를 **400px** 로 적고
 * 있었다. 실제 상수는 416 이고, 그래서 예시 수치(148px)도 틀려 있었다. 산식은 처음부터
 * 416 을 썼으므로 코드 동작은 무변경 — 틀린 것은 서술뿐이었다.
 */
export const UI_BUDGET_CAP_FRACTION = 0.52;

/**
 * `.scanner-bottom` 자신의 여백 — padding-top 12 + row gap 12×2. `gaps`(76) 항의 부분이다.
 * (옆배치에서는 CSS 가 padding-top 0 · gap 8 로 줄이므로 이 값은 **보수적 상한**이다.)
 */
export const BOTTOM_STACK_CHROME = 36;

/**
 * 패널 위·아래에서 셸이 이미 가져가는 높이 — 로고 36 + 푸터 24 + 셸 gap 10×3 = 90.
 * 패널의 **가시** 높이는 배치가 패널에 준 공간에서 이만큼을 뺀 값이다.
 * 스택: 셸 자식이 top / stage / panels / footer (gap 3개).
 * 옆배치: 패널 열의 grid 행이 top / notice / panels / footer (row-gap 3개, notice 는
 *         hidden 이라 0 높이지만 gap 은 남는다) — 결과적으로 같은 식이다.
 */
export const PANEL_CHROME_HEIGHT = UI_STACK_BUDGET_PARTS.top
  + UI_STACK_BUDGET_PARTS.footer + SHELL_GAP * 3;

/**
 * r5 재배열 후 패널 **맨 앞**에 오는 행동 컨트롤 3종의 높이(px) —
 * `.scanner-bottom` 여백 36 + 상태 34 + 줌 62 + 사진 버튼 52 = 184.
 * 줌 컨트롤이 노출된 «평상 상태» 기준이다 (줌 미지원 기기는 62 만큼 더 여유가 있다).
 *
 * 이 값이 `scanLayout().panelVisibleHeight` 이하여야 «사진에서 스캔» 이 스크롤 없이
 * 보인다. r4 는 안내 문구(guide 132 + 패널 gap 10)가 앞에 있어 이 합이 326 이었고,
 * 짧은 폰에서 가시 영역을 넘겼다 — 그것이 이번에 고친 회귀다.
 */
export const ACTION_CONTROLS_HEIGHT = BOTTOM_STACK_CHROME
  + UI_STACK_BUDGET_PARTS.status + UI_STACK_BUDGET_PARTS.zoom + UI_STACK_BUDGET_PARTS.photo;

/** 배치 모드 — `'stack'`(정사각 위 · 패널 아래) / `'split'`(정사각 옆 · 패널 옆). */
export function layoutModeFor(viewportWidth, viewportHeight) {
  const w = Number(viewportWidth);
  const h = Number(viewportHeight);
  if (!(w > 0) || !(h > 0)) return null;
  return w / h >= SPLIT_MIN_ASPECT ? 'split' : 'stack';
}

/**
 * 화면비 적응 배치의 **정본 산식**. CSS `--tl-square-side` 와 항·순서까지 같다.
 *
 *   stack: max(96px, min(0.92·min(W,H), availW, availH − uiBudget))
 *   split: max(96px, min(0.92·min(W,H), availH, availW − uiBudget − colGap))
 *
 * where availW = W − padL − padR, availH = H − padT − padB,
 *       uiBudget(stack) = min(416px, 0.52 × H)   ← dvh/vw 기준이라 avail 이 아니라 W·H.
 *                         (416 = UI_STACK_BUDGET. [정정 r5] 여기 400 이라 적혀 있었다.)
 *       uiBudget(split) = min(300px, 0.42 × W)
 *
 * 무스크롤 증명(하한이 안 걸리는 범위에서):
 *   stack — side ≤ availH − uiBudget 이므로 side + uiBudget + padY ≤ H. 세로 OK.
 *           side ≤ availW 이므로 side + padX ≤ W. 가로 OK.
 *   split — side ≤ availW − panelMinW − colGap 이므로
 *           side + colGap + panelMinW + padX ≤ W. 가로 OK.
 *           side ≤ availH 이므로 side + padY ≤ H. 세로 OK.
 * 하한(96px)이 걸리는 경우는 `fits` 가 false 로 돌아온다 — 테스트가 그 경계를 고정한다.
 *
 * ⚠ 무스크롤은 **페이지**의 성질이지 도달성의 보증이 아니다. 예산 캡이 걸린 화면에서는
 *   패널이 내부 스크롤을 갖고, 그때 캡 밖으로 밀린 것은 «보이지 않는다». 그래서 무엇이
 *   먼저 밀리는지가 배치의 일부다 — `panelVisibleHeight` 와 `ACTION_CONTROLS_HEIGHT`
 *   가 그 경계를 수치로 준다 (r5 재배열의 근거).
 */
export function scanLayout({
  viewportWidth,
  viewportHeight,
  safeAreaTop = 0,
  safeAreaRight = 0,
  safeAreaBottom = 0,
  safeAreaLeft = 0,
} = {}) {
  const w = Number(viewportWidth);
  const h = Number(viewportHeight);
  if (!(w > 0) || !(h > 0)) return null;

  const pad = (inset) => {
    const n = Number(inset);
    return Math.max(SHELL_PAD_MIN, Number.isFinite(n) && n > 0 ? n : 0);
  };
  const padTop = pad(safeAreaTop);
  const padRight = pad(safeAreaRight);
  const padBottom = pad(safeAreaBottom);
  const padLeft = pad(safeAreaLeft);

  const availWidth = w - padLeft - padRight;
  const availHeight = h - padTop - padBottom;
  const mode = layoutModeFor(w, h);
  const visualCap = SQUARE_VIEW_FRACTION * Math.min(w, h); // CSS min(92vw, 92dvh)
  const uiBudget = mode === 'stack'
    ? Math.min(UI_STACK_BUDGET, UI_BUDGET_CAP_FRACTION * h)
    : Math.min(SPLIT_PANEL_MIN_WIDTH, SPLIT_PANEL_CAP_FRACTION * w);
  const crossCap = mode === 'stack' ? availWidth : availHeight;
  const fitCap = mode === 'stack'
    ? availHeight - uiBudget
    : availWidth - uiBudget - SPLIT_COLUMN_GAP;

  const unclamped = Math.min(visualCap, crossCap, fitCap);
  const squareSide = Math.max(SQUARE_MIN_SIDE, unclamped);
  const binding = squareSide > unclamped
    ? 'floor'
    : (unclamped === visualCap ? 'visual' : (unclamped === crossCap ? 'cross' : 'fit'));

  const contentWidth = mode === 'stack'
    ? squareSide + padLeft + padRight
    : squareSide + SPLIT_COLUMN_GAP + uiBudget + padLeft + padRight;
  const contentHeight = mode === 'stack'
    ? squareSide + uiBudget + padTop + padBottom
    : squareSide + padTop + padBottom;

  return {
    mode,
    aspect: w / h,
    padTop,
    padRight,
    padBottom,
    padLeft,
    availWidth,
    availHeight,
    visualCap,
    crossCap,
    fitCap,
    uiBudget,
    squareSide,
    binding,
    /** 패널이 받는 공간 — stack 은 높이, split 은 폭. */
    panelExtent: mode === 'stack'
      ? availHeight - squareSide
      : availWidth - squareSide - SPLIT_COLUMN_GAP,
    /**
     * 패널의 **가시 높이**(px) — 스크롤 없이 실제로 보이는 세로. 로고·푸터·셸 gap 을
     * 뺀 값이다(`PANEL_CHROME_HEIGHT`). 이 아래로 밀린 콘텐츠는 «있지만 안 보인다» —
     * 페이지 무스크롤 불변식과 **다른 축**이고, r5 회귀가 난 축이 이쪽이었다.
     */
    panelVisibleHeight: (mode === 'stack' ? availHeight - squareSide : availHeight)
      - PANEL_CHROME_HEIGHT,
    contentWidth,
    contentHeight,
    /** 무스크롤 예산 충족 여부 (하한이 걸리면 false 가 될 수 있다). */
    fits: contentWidth <= w + 1e-9 && contentHeight <= h + 1e-9,
  };
}

/**
 * 정사각 컨테이너(한 변 containerSide)의 `object-fit: cover` + (크롭 폴백 시)
 * CSS `scale(cropZoom)` 이 **비디오 소스에서 실제로 보여주는 창**.
 *
 * 프리뷰 ≡ 분석 증명(이 함수가 그 증명의 실행형이다):
 *   cover 배율 = containerSide / min(vW,vH) (정사각 컨테이너라 짧은 변이 항상 기준).
 *   CSS scale(crop) 을 더하면 총 배율 = containerSide·crop / min(vW,vH).
 *   보이는 소스 창 변 = containerSide ÷ 총 배율 = min(vW,vH)/crop
 *                    = cropWindow(vW,vH,crop).sourceSide — **분석 크롭과 동일**.
 *   중심 정렬(cover·scale 모두 중심 원점)이라 창 위치도 중앙 = 분석 크롭과 동일.
 * 트랙 zoom 경로는 소스 자체가 확대라(crop=1) 같은 식이다. 960 축소는 해상도만
 * 바꾼다 — 영역·점유율 불변. scanner-zoom.test.js 가 cropWindow 와 대조한다.
 */
export function previewSourceWindow({
  videoWidth,
  videoHeight,
  containerSide,
  cropZoom = 1,
} = {}) {
  const vW = Number(videoWidth);
  const vH = Number(videoHeight);
  const side = Number(containerSide);
  if (!(vW > 0) || !(vH > 0) || !(side > 0)) return null;
  const crop = Math.max(1, Number(cropZoom) || 1);
  const sourceSide = Math.min(vW, vH) / crop;
  return {
    sourceX: (vW - sourceSide) / 2,
    sourceY: (vH - sourceSide) / 2,
    sourceSide,
  };
}

/**
 * 뷰(0..side)를 벗어난 가이드 점 목록. r3 구조에서는 **항상 빈 배열**이어야 한다
 * (최대 링 반경 0.27·side < 0.5·side). 위반은 좌표계 회귀다 — 셸이 콘솔 경고
 * + 오버레이 표기로 올린다 (조용히 그리던 12점 시절의 실기기 불가시성 재발 방지).
 */
export function dotsOutOfBounds(dots, side) {
  const s = Number(side);
  if (!dots || !(s > 0)) return [];
  const out = [];
  for (const [ringName, points] of Object.entries(dots)) {
    if (!Array.isArray(points)) continue;
    points.forEach((p, i) => {
      if (!p || !(p.x >= 0) || !(p.x <= s) || !(p.y >= 0) || !(p.y <= s)) {
        out.push({ ring: ringName, index: i, x: p && p.x, y: p && p.y });
      }
    });
  }
  return out;
}

export function parseZoomCapability(capabilities) {
  const raw = capabilities && capabilities.zoom;
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const min = Number(raw.min);
    const max = Number(raw.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return null;
    const step = Number(raw.step);
    return {
      min,
      max,
      step: Number.isFinite(step) && step > 0 ? step : CROP_ZOOM_STEP,
    };
  }
  return null;
}

export function defaultZoomRange() {
  return { min: CROP_ZOOM_MIN, max: CROP_ZOOM_MAX, step: CROP_ZOOM_STEP };
}

export function zoomRangeFor(capability) {
  return capability || defaultZoomRange();
}

export function snapZoom(value, range) {
  const spec = zoomRangeFor(range);
  const n = Number(value);
  if (!Number.isFinite(n)) return spec.min;
  const clamped = Math.min(spec.max, Math.max(spec.min, n));
  const step = spec.step;
  if (!(step > 0)) return clamped;
  const snapped = spec.min + Math.round((clamped - spec.min) / step) * step;
  const bounded = Math.min(spec.max, Math.max(spec.min, snapped));
  return Number(bounded.toFixed(4));
}

/** ± 버튼은 한 손으로 쓸 수 있게 최소 0.5 배씩 움직인다. */
export function buttonStep(range) {
  const spec = zoomRangeFor(range);
  return Math.max(spec.step, 0.5);
}

export function zoomConstraint(value) {
  return { advanced: [{ zoom: value }] };
}

export function zoomMismatch(requested, applied, step) {
  if (!Number.isFinite(requested) || !Number.isFinite(applied)) return true;
  const tol = Math.max(Number(step) || CROP_ZOOM_STEP, 0.05);
  return Math.abs(requested - applied) > tol + 1e-6;
}

/**
 * 원본 프레임에서 중앙 정사각을 크롭한 뒤, 필요할 때만 축소한다.
 * 축소 후 크롭하면 셀 픽셀이 이미 사라진 뒤다.
 *
 * cropZoom=1 → 기존 imageDataCenterSquare 와 동일(짧은 변 전체).
 * cropZoom=2 → 짧은 변의 절반만 남긴다.
 * target 은 크롭 한 변과 maxSide 중 작은 값 — 없는 픽셀을 만들어 올리지 않는다.
 */
export function cropWindow(width, height, cropZoom, maxSide = FRAME_MAX_SIDE) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!(w > 0) || !(h > 0)) return null;
  const zoom = Math.max(1, Number(cropZoom) || 1);
  const fullSide = Math.min(w, h);
  const sourceSide = Math.max(1, fullSide / zoom);
  const cap = Number(maxSide) > 0 ? Number(maxSide) : FRAME_MAX_SIDE;
  return {
    sourceX: (w - sourceSide) / 2,
    sourceY: (h - sourceSide) / 2,
    sourceSide,
    target: Math.max(1, Math.min(cap, Math.round(sourceSide))),
    cropZoom: fullSide / sourceSide,
  };
}

/**
 * 원본(확대·크롭 없음) 대비 셀이 몇 배로 커졌는가.
 * 트랙 zoom 은 getSettings() 값, cropZoom 은 실제로 자른 배율.
 */
export function effectiveMagnification({
  trackZoom = 1,
  trackNative = 1,
  cropZoom = 1,
} = {}) {
  const track = Number(trackZoom);
  const native = Number(trackNative);
  const crop = Number(cropZoom);
  const t = Number.isFinite(track) && track > 0 ? track : 1;
  const n = Number.isFinite(native) && native > 0 ? native : 1;
  const c = Number.isFinite(crop) && crop >= 1 ? crop : 1;
  return (t / n) * c;
}

/**
 * 요청값과 적용값을 한 객체로 고정한다.
 * 실패해도 요청값은 남긴다 — 오늘 사고의 본질이 «조용히 1 로 보임» 이었다.
 */
export function zoomTelemetry(state = {}) {
  const trackRequested = Number.isFinite(Number(state.trackRequested))
    ? Number(state.trackRequested)
    : 1;
  const trackApplied = Number.isFinite(Number(state.trackApplied))
    ? Number(state.trackApplied)
    : 1;
  const cropRequested = Number.isFinite(Number(state.cropRequested))
    ? Number(state.cropRequested)
    : 1;
  const cropApplied = Number.isFinite(Number(state.cropApplied))
    ? Number(state.cropApplied)
    : 1;
  const native = Number.isFinite(Number(state.trackNative)) && Number(state.trackNative) > 0
    ? Number(state.trackNative)
    : 1;
  const error = typeof state.error === 'string' && state.error ? state.error : '';
  return {
    zoom: trackApplied,
    zoomRequested: trackRequested,
    crop: cropApplied,
    cropRequested,
    effectiveZoom: effectiveMagnification({
      trackZoom: trackApplied,
      trackNative: native,
      cropZoom: cropApplied,
    }),
    zoomError: error,
  };
}

/**
 * 프레임 한 변 `frameSide`(px)에서 복호 하한(셀당 9px)을 만족하는 최소 채움 비율.
 * 3링 가이드에서는 표시용이 아니라 검산용이다 — GUIDE_OUTER_FRACTION 이 이 하한
 * 위에 있는지 테스트가 대조한다.
 */
export function aimGuideMinFractions(frameSide = FRAME_MAX_SIDE, cellPx = CELL_PX_FLOOR) {
  const side = Number(frameSide) > 0 ? Number(frameSide) : FRAME_MAX_SIDE;
  const px = Number(cellPx) > 0 ? Number(cellPx) : CELL_PX_FLOOR;
  return {
    floorPx: px,
    frameSide: side,
    minV3: (GUIDE_CELLS_V3 * px) / side,
    minY2: (GUIDE_CELLS_Y2 * px) / side,
  };
}

/**
 * 사용자 배율을 트랙 확대 / 크롭으로 나눈다.
 *
 * - 트랙이 지원되고 적용이 맞으면 크롭은 1.
 * - 트랙이 없거나 적용이 거부·불일치면 같은 배율을 크롭으로 돌린다.
 *   실패를 숨기지 않도록 error 코드를 남긴다.
 */
export function resolveZoomPlan({
  userZoom,
  capability = null,
  trackApplied = null,
  applyError = null,
  settingsMissing = false,
} = {}) {
  const range = zoomRangeFor(capability);
  const wanted = snapZoom(userZoom, range);
  const native = capability ? capability.min : 1;

  if (!capability) {
    const cropApplied = wanted >= 1 ? wanted : 1;
    return {
      mode: 'crop',
      trackRequested: 1,
      trackApplied: 1,
      cropRequested: wanted,
      cropApplied,
      trackNative: 1,
      error: wanted > 1 && cropApplied <= 1 ? 'fallback-1x' : '',
    };
  }

  if (applyError) {
    return {
      mode: 'crop-fallback',
      trackRequested: wanted,
      trackApplied: Number.isFinite(trackApplied) ? trackApplied : native,
      cropRequested: wanted,
      cropApplied: wanted,
      trackNative: native,
      error: String(applyError),
    };
  }

  if (settingsMissing || trackApplied == null || !Number.isFinite(trackApplied)) {
    return {
      mode: 'crop-fallback',
      trackRequested: wanted,
      trackApplied: native,
      cropRequested: wanted,
      cropApplied: wanted,
      trackNative: native,
      error: 'settings-unreported',
    };
  }

  if (zoomMismatch(wanted, trackApplied, capability.step)) {
    return {
      mode: 'crop-fallback',
      trackRequested: wanted,
      trackApplied,
      cropRequested: wanted,
      cropApplied: wanted,
      trackNative: native,
      error: 'mismatch',
    };
  }

  return {
    mode: 'track',
    trackRequested: wanted,
    trackApplied,
    cropRequested: 1,
    cropApplied: 1,
    trackNative: native,
    error: '',
  };
}

/**
 * 트랙에 zoom 을 건다. 실패 이유를 삼키지 않고 코드로 돌려준다.
 *
 * @param {{
 *   applyConstraints?: Function,
 *   getSettings?: Function,
 * }} track
 * @param {number} value
 */
export async function applyTrackZoom(track, value) {
  if (!track || typeof track.applyConstraints !== 'function') {
    return { ok: false, applied: null, error: 'no-applyConstraints' };
  }
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) {
    return { ok: false, applied: null, error: 'bad-zoom' };
  }

  let rejected = '';
  try {
    await track.applyConstraints(zoomConstraint(zoom));
  } catch (err) {
    rejected = (err && err.name ? err.name + ':' : '') +
      (err && err.message ? err.message : 'applyConstraints-rejected');
    try {
      await track.applyConstraints({ zoom });
    } catch (err2) {
      const second = (err2 && err2.name ? err2.name + ':' : '') +
        (err2 && err2.message ? err2.message : rejected);
      return { ok: false, applied: readTrackZoom(track), error: second || rejected };
    }
  }

  const applied = readTrackZoom(track);
  if (applied == null) {
    return { ok: false, applied: null, error: 'settings-unreported' };
  }
  return { ok: true, applied, error: '' };
}

export function readTrackZoom(track) {
  if (!track || typeof track.getSettings !== 'function') return null;
  try {
    const zoom = track.getSettings().zoom;
    return Number.isFinite(zoom) ? zoom : null;
  } catch {
    return null;
  }
}

export function readTrackCapability(track) {
  if (!track || typeof track.getCapabilities !== 'function') return null;
  try {
    return parseZoomCapability(track.getCapabilities());
  } catch {
    return null;
  }
}
