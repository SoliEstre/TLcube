// generator-render-config.js — 생성기의 정규 상태 → 인코더/scene 옵션 경계

import { CENTER_QR_FINDER_PATTERN_ID } from './finder-selection.js';
import { WINDOW_SUPPORTED_TONES, WINDOW_SUPPORTED_VERSION } from './capacityY.js';
import {
  CELL_SURFACE_FINAL_V0,
  CELL_SURFACE_FINAL_V1R2,
  CELL_SURFACE_FINAL_V2R2,
  assertCellSurfaceFinalId,
} from './cellSurfaceFinal.js';
import {
  LOCATOR_PROFILE_CELL_SURFACE_V0,
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
 * @returns {{tones: 2|3, version?: number, window?: true, cellSurface?: true, cellSurfaceLayout?: 'v0'|'v2r2'|'v1r2'}}
 */
export function encodeOptionsForY(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('Type Y 생성기 상태가 필요하다');
  }
  const { tone, versionY, fallback, locatorProfileY } = state;
  if (fallback === null || typeof fallback !== 'object') {
    throw new TypeError('Y QR 폴백 상태가 필요하다');
  }
  // 최종 라인업 (2026-08-15): v0 = Y0(n=13) 고정 · v2r2 = Y1/Y2(n=21/25).
  // 2026-08-15 밤 추가: v1r2 = Y1(n=21) 전용 A/B 후보 (네 코너 블록 80셀).
  // 초안 v2 와 구 v1 CS 는 UI 에서 내린 채다.
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
  if (type === 'A' && !needsCornerQr) opts.margin = 20;
  return opts;
}
