/**
 * sagoae-verify.js — sagoae(내곽 예약 고리) 단독 검증기 (W2 C2c, 2026-08-24).
 *
 * daehan 을 «taegeuk(중앙 19셀) + sagoae(예약 고리)» 조합으로 **분해**하는 반쪽이다.
 * 원자 daehan 검출기(79셀 NCC)는 기존 프레임 호환용으로 그대로 두고, 이 모듈은
 * 임의의 중앙 파인더 포즈 H 위에서 «예약 고리가 sagoae 톤(이진 0/2)으로 실재하는가»
 * 만 독립 측정한다 — corner-marker-detect 가 앵커 없이 마커 고리만 검증하는 전례.
 *
 * 채점기는 새로 만들지 않는다 — cell-finder-detect 의 `scoreCellMaskAtHomography`
 * 에 «예약 셀만 담은 의사 패턴» 을 먹인다 (검출과 검증이 같은 표본·같은 식을 쓰므로
 * «그린 것과 읽는 것» 이 갈릴 자리가 없다).
 *
 * k 는 좁히지 않는다 — 호출자가 k 마다 따로 물어야 한다. 고리는 k 마다 딴 셀이고
 * (20/40/60), 프레임의 k 를 정하는 것은 여기서도 RS/CRC 다 (bootstrap :1604 계약).
 */
import {
  DAEHAN_CELL_LEVELS, DAEHAN_FINDER_CELLS, DAEHAN_RADII, daehanReservedCells,
} from '../finder-daehan.js';
import {
  UNVERIFIED_CELL_FINDER_CALIBRATION, scoreCellMaskAtHomography,
} from './cell-finder-detect.js';

const LEVEL_BY_CELL = new Map(DAEHAN_FINDER_CELLS.map(
  (cell, i) => [cell.q + ',' + cell.r, DAEHAN_CELL_LEVELS[i]],
));

/** k → 예약 고리만 담은 의사 패턴 (모듈 로드 시 1회 유도 — 정본은 finder-daehan). */
const RING_PATTERNS = new Map(DAEHAN_RADII.map((k) => {
  const cells = daehanReservedCells(k);
  const levels = cells.map((cell) => {
    const level = LEVEL_BY_CELL.get(cell.q + ',' + cell.r);
    if (!level) throw new Error('sagoae 셀의 톤이 정본에 없다: ' + cell.q + ',' + cell.r);
    return level;
  });
  return [k, Object.freeze({
    id: 'sagoae-ring-k' + k,
    finderCells: Object.freeze(cells),
    cellLevels: Object.freeze(levels),
  })];
}));

/**
 * 검증 문턱. 검출기 하드 게이트(corr 0.56)보다 **높다** — 검증기는 «있으면 좋은
 * 추가 가설» 을 여는 쪽이라 오수용 비용이 비대칭이다. 0.80 은 합성 daehan 프레임
 * 실측(≈1.0)과 레거시 프레임 실측(코퍼스 옵트인 A/B — 플립 0) 사이의 값이다.
 */
export const SAGOAE_VERIFY_CALIBRATION = Object.freeze({
  minCorrelation: 0.80,
  minContrastRatio: UNVERIFIED_CELL_FINDER_CALIBRATION.minContrastRatio,
});

/**
 * 포즈 H 위에서 반경 k 의 sagoae 고리를 검증한다.
 * @returns {{ok: boolean, k: number, correlation: number|null, contrastRatio: number|null}}
 *   고리가 화면 밖이거나 휘도 스팬이 죽었으면 ok:false (correlation null).
 */
export function verifySagoae(luma, H, k, options = {}) {
  const pattern = RING_PATTERNS.get(k);
  if (!pattern) throw new RangeError('sagoae 반경이 아니다: ' + k);
  const cfg = { ...SAGOAE_VERIFY_CALIBRATION, ...(options.calibration || {}) };
  // detailed(면당 4점) 로 잰다 — 원자 검출기의 완성 단계와 같은 해상도 (coarse 1점은
  // 셀 경계 안티에일리어싱에 얹히면 이진 톤도 흔들린다).
  const scored = scoreCellMaskAtHomography(luma, [pattern], H, {});
  if (!scored.ok) return { ok: false, k, correlation: null, contrastRatio: null };
  const { correlation, contrastRatio } = scored;
  const pass = correlation >= cfg.minCorrelation && contrastRatio >= cfg.minContrastRatio;
  return { ok: pass, k, correlation, contrastRatio };
}
