// generator-render-config.js — 생성기의 정규 상태 → 인코더/scene 옵션 경계

import { CENTER_QR_FINDER_PATTERN_ID } from './finder-selection.js';
import {
  centralMarkerN7FamilyForType, isCentralMarkerN7FinderPatternId,
} from './centralMarkerN7.js';
import { WINDOW_SUPPORTED_TONES, WINDOW_SUPPORTED_VERSION } from './capacityY.js';
import {
  CELL_SURFACE_FINAL_V0,
  CELL_SURFACE_FINAL_V0T,
  CELL_SURFACE_FINAL_V0TY,
  CELL_SURFACE_FINAL_V0TR,
  CELL_SURFACE_FINAL_V0TRQ,
  CELL_SURFACE_FINAL_V0TRY,
  CELL_SURFACE_FINAL_V0W,
  CELL_SURFACE_FINAL_V0W2,
  CELL_SURFACE_FINAL_V0WY,
  CELL_SURFACE_FINAL_V0WQ,
  CELL_SURFACE_FINAL_V0X,
  CELL_SURFACE_FINAL_V0XQ,
  CELL_SURFACE_FINAL_V1R2,
  CELL_SURFACE_FINAL_V2R2,
  assertCellSurfaceFinalId,
} from './cellSurfaceFinal.js';
import {
  LOCATOR_PROFILE_CELL_SURFACE_V0,
  LOCATOR_PROFILE_CELL_SURFACE_V0T,
  LOCATOR_PROFILE_CELL_SURFACE_V0TY,
  LOCATOR_PROFILE_CELL_SURFACE_V0TR,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRQ,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRY,
  LOCATOR_PROFILE_CELL_SURFACE_V0W,
  LOCATOR_PROFILE_CELL_SURFACE_V0W2,
  LOCATOR_PROFILE_CELL_SURFACE_V0WY,
  LOCATOR_PROFILE_CELL_SURFACE_V0WQ,
  LOCATOR_PROFILE_CELL_SURFACE_V0X,
  LOCATOR_PROFILE_CELL_SURFACE_V0XQ,
  LOCATOR_PROFILE_CELL_SURFACE_V1R2,
  LOCATOR_PROFILE_CELL_SURFACE_V2R2,
} from './locatorY.js';

/**
 * Type Y 인코더 옵션 — UI 상태(톤·해상도·폴백)를 인코더가 받는 모양으로 바꾼다.
 *
 * 왜 모듈로 빼나: 윈도 β 는 **Y2 · 2톤 전용**(ADR 0003 D1 조건 ②)인데, 생성기가 version 만
 * 강제하고 tones 는 사용자 값(기본 3)을 그대로 넘겨 `RangeError` 로 **렌더가 통째로 죽었다.**
 * 인라인 HTML 안에 있어서 테스트가 닿지 않던 자리였다 — 여기로 옮겨 계약을 고정한다.
 *
 * 강제는 **렌더 시점에만** 한다. 저장된 톤·해상도 선택은 그대로 두어야 윈도를 벗어났을 때
 * 사용자가 고른 값이 복원된다(해상도 티어가 이미 같은 규약을 쓴다).
 *
 * @param {{tone: 2|3, versionY?: number, fallback: {mode: string}, locatorProfileY?: string}} state
 * @returns {{tones: 2|3, version?: number, window?: true, cellSurface?: true, cellSurfaceLayout?: 'v0'|'v2r2'|'v1r2'|'v0x'|'v0xq'|'v0w'|'v0wq'|'v0w2'|'v0wy'|'v0t'|'v0ty'|'v0tr'|'v0trq'|'v0try'}}
 */
export function encodeOptionsForY(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('Type Y 생성기 상태가 필요하다');
  }
  const { tone, versionY, fallback, locatorProfileY } = state;
  if (fallback === null || typeof fallback !== 'object') {
    throw new TypeError('Y QR 폴백 상태가 필요하다');
  }
  // 카드 라인업 (2026-08-17 v0T 편입·v0W 계열 전체 드랍까지 반영):
  // v0 = Y0(n=13) ·
  // v0T = **T 계열 최종 파인더** (NW 16 + A 9 + N팔 10 + NE 36 + W 24 + SE 9 = 104셀) —
  //       n=21 데이터 307 · **n=25 데이터 491** (2026-08-25 편입. 면 모서리 기준 배치라
  //       파인더 셀 수가 n 에 불변이고, 늘어난 면적이 그대로 데이터로 간다) ·
  // v0TY = v0T 파생 (먼 코너 QR 슬롯 8² — 파인더 95 · 슬롯 64 ·
  //       n=21 데이터 252 · **n=25 데이터 436** (2026-08-25 편입. 슬롯 원점은
  //       `centerQrSlotOriginFor` 가 이미 n 을 받는다 — far = (n−m, n−m))).
  //
  // ⚠ **어느 분기가 version 을 고정하는지가 이 함수의 실질**이다. 레이아웃이 여러 n 을
  //   지원하면 고정을 걷어야 하고, 안 걷으면 «사다리·카드 목록은 Y2 를 고르는데 렌더만
  //   Y1» 인 조용한 어긋남이 된다 (2026-08-25 운영자 신고의 원인). 판정 정본은
  //   `cellSurfaceFinal.js` 의 `CELL_SURFACE_FINAL_NS` 다.
  //
  // **v2r2 · v1r2 (2026-08-16) · v0XQ · v0X · v0W · v0WQ · v0W2 · v0WY (2026-08-17)
  // 는 카드에서 내려갔다** (`generator-state.js` 의 허용값에서 제거 — UI 로는 이
  // 값이 더 이상 들어오지 않는다). 아래 **드랍 분기들은 삭제하지 않는다**: 이미
  // 발행된 출력물의 재생성·법의학·와이어 회귀 테스트가 이 함수를 직접 부른다
  // (`cellSurfaceFinal.js` §CELL_SURFACE_FINAL_DROPPED_IDS — 차단·비삭제).
  // 초안 v2 와 구 v1 CS 도 같은 이유로 UI 에서만 내린 채다.
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0) {
    return {
      tones: tone === 3 ? 3 : 2,
      version: 0,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V2R2) {
    return {
      tones: tone === 3 ? 3 : 2,
      // Y2(버전 2) 명시 선택만 n=25 — 그 외(auto/0/1)는 Y1(n=21) 기본.
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V2R2),
    };
  }
  // v0X — 2026-08-17 드랍(차단·비삭제, 판정 3라운드). 카드가 없어 UI 로는 안
  // 들어오지만, 발행분 재생성·법의학 호출이 이 분기를 직접 쓴다.
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0X) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0X 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0X),
    };
  }
  // v0XQ — 2026-08-17 드랍(차단·비삭제). 카드가 없어 UI 로는 안 들어오지만,
  // 발행분 재생성·법의학 호출이 이 분기를 직접 쓴다.
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0XQ) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0XQ 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0XQ),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0W) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0W 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0W),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0WQ) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0WQ 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0WQ),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0W2) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0W2 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0W2),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0WY) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0WY 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0WY),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0T) {
    return {
      tones: tone === 3 ? 3 : 2,
      // ⭐ **하드핀 해제 (2026-08-25)** — 「v0T 도 n=21 뿐이다」는 9ce2883 이전의 사실이다.
      // 「면 모서리 기준 배치」(SPEC §4.11)가 n=25 를 열어 v0T·v0TR 이 [21, 25] 가 됐다
      // (`CELL_SURFACE_FINAL_NS` 가 정본). 그때 라인업·선언 data·회계 표는 넓혔는데
      // **이 상수를 안 걷어서** 사다리는 Y2 를 고르는데 렌더는 Y1 이 나왔다 — 그리고
      // 용량을 넘기면 ECC 가 내려갔다(운영자 신고 2026-08-25 「Y2로 넘어가면 마커가
      // 사라짐 · 수동 선택해도 렌더 안 됨」). 셋을 통과시켜도 **누가 이 값을 고정하는가**
      // 는 아무도 안 묻는다 — 허용 목록을 넓히는 것과 강제 상수를 걷는 것은 다른 작업이다.
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0T),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0TY) {
    return {
      tones: tone === 3 ? 3 : 2,
      // ⭐ **하드핀 해제 (2026-08-25, 레인 QR25)** — 「v0TY 는 n=21 뿐이다」는
      // `centerQrSlotOriginFor` 가 이미 n 을 받기 전의 서술이다. NS 가 [21, 25] 가
      // 됐으므로 여기 상수도 함께 걷는다 (v0T·v0TR 과 같은 사고 — 라인업만 넓히고
      // 하드핀을 안 걷으면 사다리는 Y2 를 고르는데 렌더는 Y1).
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0TY),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0TR) {
    return {
      tones: tone === 3 ? 3 : 2,
      // ⭐ **하드핀 해제 (2026-08-25)** — v0T 와 같은 근거다 (§V0T 분기 주석).
      // v0TR 은 [21, 25] 이고, 자동 사다리(`generator-auto-y.js` RUNGS 2단)가
      // 「Y2 + v0TR」을 고르는 **유일한 마커 보존 경로**다. 여기가 1 로 못 박혀 있으면
      // 그 단이 존재하되 도달할 수 없다.
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0TR),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0TRQ) {
    return {
      tones: tone === 3 ? 3 : 2,
      // ⭐ **하드핀 해제 (2026-08-25, 레인 QR25)** — v0TY 와 같은 근거다.
      // 슬롯은 seam (0,0) 이라 n 과 무관하고, NS 가 [21, 25] 다.
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0TRQ),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0TRY) {
    return {
      tones: tone === 3 ? 3 : 2,
      // ⭐ **하드핀 해제 (2026-08-25, 레인 QR25)** — v0TY 와 같은 근거다.
      // 슬롯은 far (n−m, n−m) 이라 이미 n 일반화돼 있고, NS 가 [21, 25] 다.
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0TRY),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V1R2) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v1r2 는 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V1R2),
    };
  }
  if (fallback.mode === 'window') {
    return { tones: WINDOW_SUPPORTED_TONES, version: WINDOW_SUPPORTED_VERSION, window: true };
  }
  const opts = { tones: tone };
  if (versionY !== undefined) opts.version = versionY;
  return opts;
}

/**
 * 중앙 QR은 중앙 슬롯을 독점한다. 특히 실험판의 기본 파인더가 cell-mask일 때도
 * finderPatternId를 생략해 기본값으로 되돌아가지 않도록 여기서 명시한다.
 */
export function sceneOptionsForOA({
  fallback,
  finderPatternId,
  palette,
  qrText,
  type,
}) {
  if (fallback === null || typeof fallback !== 'object') {
    throw new TypeError('O/A QR 폴백 상태가 필요하다');
  }
  if (type !== 'O' && type !== 'A') {
    throw new RangeError('sceneOptionsForOA는 Type O 또는 A만 받는다: ' + type);
  }

  const centerQr = fallback.mode === 'center';
  const opts = {
    palette,
    centerQr,
    finderPatternId: centerQr ? CENTER_QR_FINDER_PATTERN_ID : finderPatternId,
  };
  // 중앙 TL family는 QR 위치가 아니라 바깥 타입의 속성이다. 실제 N7 렌더가 선택된
  // 모든 O/A 경로에서 여기서 유도해, 호출자가 옵션을 손으로 덧붙이는 사본을 만들지 않는다.
  if (isCentralMarkerN7FinderPatternId(opts.finderPatternId)) {
    opts.centralMarkerN7Family = centralMarkerN7FamilyForType(type);
  }
  let needsCornerQr = false;
  if (centerQr) {
    opts.qrText = qrText;
    opts.cornerToo = Boolean(fallback.cornerToo);
    needsCornerQr = opts.cornerToo;
  } else if (fallback.mode === 'corner') {
    opts.qrText = qrText;
    opts.qrCorner = fallback.corner;
    needsCornerQr = true;
  }
  /*
   * 배치 불변 정책 (생성기 앱 레이어) — 코너 QR 이 안 그려지는 경로(안쪽 QR·없음)에서도
   * margin 을 코너 QR 구성과 같은 20 으로 유지한다. scene.js 의 라이브러리 기본(2)을
   * 여기서 덮는 이유: 기본대로 두면 Type O V1 기준 scene 이 62.517×60 → 26.517×24 로
   * 줄고, 미리보기는 한 축을 항상 100% 채우므로 코드가 2.4~2.5배 «확대» 돼 보인다 —
   * QR 배치를 바꿔 가며 스캔 성능·미리보기를 비교할 수 없다 (운영자 2026-08-23).
   * 원래 A 전용 구제였던 것을 O 로 확장했다. 라이브러리 기본(2)은 임베더 계약이라
   * 그대로 두고, «여백 없음» 내보내기의 trim 표(export-options.js)도 별개 기능이라
   * 건드리지 않는다 — margin 정본은 세 층이 각자 소유한다는 뜻이 아니라, 이 줄이
   * «생성기 화면·산출물의 배치 정책» 단일 소유자라는 뜻이다.
   */
  if (!needsCornerQr) opts.margin = 20;
  return opts;
}
