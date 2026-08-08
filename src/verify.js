/**
 * verify.js — 렌더 자체 검증 (SPEC §4.4 측정 통계 · M0 수용 기준, T9)
 *
 * "렌더 결과에서 3면 상대휘도 순서가 의도한 digit 과 100% 일치하는가" 를 디코더
 * 없이 픽셀 샘플링으로 확인한다. 측정 통계는 계약 그대로 **§7.2 샘플 원판 안의
 * 상대휘도 median** 이다 — 면 평균이 아니다 (§4.4 가 그 함정을 명시한다).
 *
 * 샘플링은 RNG 가 아니라 **원판 안에 픽셀 중심이 드는 전 픽셀의 전수 조사**다.
 * 결정적이고(M0 완료 기준), 원판이 작아도 표본 편향이 없다.
 *
 * 이 모듈은 M1 디코더가 아니다 — 기하를 이미 알고(렌더한 쪽이므로) 왜곡도 없다.
 * 순수하게 "인코더·렌더러 조합이 자기 계약을 지켰는가" 만 본다.
 */

import { FACES, faceSampleDisc } from './hexgrid.js';
import { ranksToDigit } from './lehmer.js';
import { relativeLuminance, DELTA_MIN_CONTRACT } from './luminance.js';

/** 홀수 길이면 중앙값, 짝수 길이면 중앙 두 값의 평균 (ε 하네스와 동일 규약). */
export function median(values) {
  if (values.length === 0) throw new RangeError('median: 빈 표본');
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 래스터에서 원판(픽셀 좌표) 안 전 픽셀의 상대휘도 median.
 * 픽셀 중심 (px+0.5, py+0.5) 이 원판에 들면 표본에 넣는다. hypot 금지 — 제곱 비교.
 * @param {{width:number,height:number,pixels:Uint8ClampedArray}} raster
 * @param {number} cxPx @param {number} cyPx @param {number} radiusPx
 * @returns {number} 상대휘도 Y (0..1)
 */
export function discMedianLuminance(raster, cxPx, cyPx, radiusPx) {
  const { width, height, pixels } = raster;
  const x0 = Math.max(0, Math.floor(cxPx - radiusPx));
  const x1 = Math.min(width - 1, Math.ceil(cxPx + radiusPx));
  const y0 = Math.max(0, Math.floor(cyPx - radiusPx));
  const y1 = Math.min(height - 1, Math.ceil(cyPx + radiusPx));
  const r2 = radiusPx * radiusPx;
  const values = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cxPx;
      const dy = y + 0.5 - cyPx;
      if (dx * dx + dy * dy <= r2) {
        const i = (y * width + x) * 4;
        values.push(relativeLuminance({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }));
      }
    }
  }
  if (values.length === 0) {
    throw new RangeError(
      `원판 (${cxPx}, ${cyPx}, r=${radiusPx}) 안에 픽셀이 없다 — 해상도가 너무 낮다`,
    );
  }
  return median(values);
}

/**
 * 셀 (q,r) 의 세 면 원판 median 휘도. 원판 위치·반지름은 §7.2 기본 규약
 * (faceSampleDisc 기본값) 그대로 — 검증이 계약과 다른 영역을 재면 무의미하다.
 * @returns {{T:number, L:number, R:number}}
 */
export function measureCellFaceMedians(raster, scene, q, r) {
  const out = {};
  for (const face of FACES) {
    const disc = faceSampleDisc(q, r, face, scene.layout);
    out[face] = discMedianLuminance(
      raster,
      disc.x * raster.pixelsPerUnit,
      disc.y * raster.pixelsPerUnit,
      disc.radius * raster.pixelsPerUnit,
    );
  }
  return out;
}

/** 면별 median → 순위 → digit. 동률은 T,L,R 정준 순서로 안정 결정 (ε 하네스와 동일). */
export function recoverDigit(medians) {
  const order = [0, 1, 2];
  const values = FACES.map((f) => medians[f]);
  order.sort((a, b) => values[a] - values[b] || a - b);
  const ranks = {};
  order.forEach((faceIdx, rankPos) => {
    ranks[FACES[faceIdx]] = rankPos;
  });
  return ranksToDigit(ranks);
}

/**
 * 래스터 전체 자체 검증 — encoded.cellDigits 의 전 셀(불스아이 제외 전 역할)에 대해
 * digit 복원 일치와 셀 내 인접 순위 간 분리폭을 잰다.
 *
 * @param {object} raster rasterize() 산출물
 * @param {object} scene buildScene() 산출물 (layout 을 쓴다)
 * @param {{cellDigits: Map<string, {digit:number, role:string}>}} encoded
 * @returns {{total:number, matched:number, mismatches:Array, minDelta:number, ok:boolean}}
 */
export function verifyRaster(raster, scene, encoded) {
  let total = 0;
  let matched = 0;
  let minDelta = Infinity;
  const mismatches = [];

  for (const [cellKey, { digit, role }] of encoded.cellDigits) {
    const [q, r] = cellKey.split(',').map(Number);
    const medians = measureCellFaceMedians(raster, scene, q, r);
    const recovered = recoverDigit(medians);

    const sorted = FACES.map((f) => medians[f]).sort((a, b) => a - b);
    const delta = Math.min(sorted[1] - sorted[0], sorted[2] - sorted[1]);
    if (delta < minDelta) minDelta = delta;

    total += 1;
    if (recovered === digit) {
      matched += 1;
    } else {
      mismatches.push({ q, r, role, expected: digit, recovered, medians });
    }
  }

  return {
    total,
    matched,
    mismatches,
    minDelta,
    ok: mismatches.length === 0 && minDelta >= DELTA_MIN_CONTRACT,
  };
}
