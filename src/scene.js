/**
 * scene.js — 인코딩 결과 → 결정적 도형(scene) 전개 (SPEC §3, §4.1, §5.1)
 *
 * 인코더 산출물(셀별 digit)을 캔버스 미리보기 / PNG·SVG export 가 공유 소비할
 * 단일 도형 목록으로 펼친다. 여기서 확정한 순서(painter order)가 계약이다 —
 * 이후 어떤 백엔드도 이 순서를 재해석하지 않고 그대로 따라 그린다.
 *
 * 이 모듈은 순수 기하 + 계약 조립만 다룬다. luminance.js·encode.js 는 아직
 * 없으므로(병렬 lane 작성 중) import 하지 않는다 — encoded/palette 는 인터페이스
 * 계약으로만 다룬다.
 */

import { FACES, facePolygon, layoutForRegion, regionCells, axialToPixel } from './hexgrid.js';
import { bandRadii } from './bullseye.js';
import { digitToRanks } from './lehmer.js';

/** 콰이어트 존 기본 배수 — margin 미지정 시 `cellSize · DEFAULT_MARGIN_FACTOR`. */
const DEFAULT_MARGIN_FACTOR = 2;

/**
 * 인코딩 결과로부터 scene 을 조립한다.
 *
 * @param {{k: number, cellDigits: Map<string, {digit: number, role: string}>}} encoded
 * @param {{palette: {background: {r,g,b}, levels: [{r,g,b},{r,g,b},{r,g,b}], bullseyeDark: {r,g,b}, bullseyeLight: {r,g,b}}, cellSize?: number, margin?: number}} options
 * @returns {{k: number, layout: object, width: number, height: number, background: {r,g,b}, shapes: Array}}
 */
export function buildScene(encoded, options) {
  if (encoded === null || typeof encoded !== 'object') {
    throw new TypeError('encoded 는 객체여야 한다');
  }
  const { k, cellDigits } = encoded;
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError(`encoded.k 는 0 이상의 정수여야 한다: ${k}`);
  }
  if (!(cellDigits instanceof Map)) {
    throw new TypeError('encoded.cellDigits 는 Map 이어야 한다');
  }

  const opts = options || {};
  const palette = opts.palette;
  if (palette === null || typeof palette !== 'object') {
    throw new TypeError('palette 는 객체여야 한다');
  }

  const cellSize = opts.cellSize === undefined ? 1 : opts.cellSize;
  const margin =
    opts.margin === undefined ? DEFAULT_MARGIN_FACTOR * cellSize : opts.margin;

  const layout = layoutForRegion(k, { size: cellSize, margin });

  const shapes = [];

  // (1) 셀 3면 폴리곤 — regionCells(k) 순회 순서로, cellDigits 에 있는 셀만.
  for (const { q, r } of regionCells(k)) {
    const key = `${q},${r}`;
    const entry = cellDigits.get(key);
    if (entry === undefined) continue; // 불스아이 셀은 Map 에 없다.
    const ranks = digitToRanks(entry.digit);
    for (const face of FACES) {
      shapes.push({
        kind: 'polygon',
        points: facePolygon(q, r, face, layout),
        color: palette.levels[ranks[face]],
      });
    }
  }

  // (2) 불스아이 6 disc — 바깥 밴드(반지름 큰 것)부터. i(0=중심)가 짝수면 dark, 홀수면 light.
  const center = axialToPixel(0, 0, layout);
  const radii = bandRadii(cellSize); // 오름차순(안→밖), 마지막이 R_max.
  for (let i = radii.length - 1; i >= 0; i -= 1) {
    shapes.push({
      kind: 'disc',
      cx: center.x,
      cy: center.y,
      r: radii[i],
      color: i % 2 === 0 ? palette.bullseyeDark : palette.bullseyeLight,
    });
  }

  return {
    k,
    layout,
    width: layout.width,
    height: layout.height,
    background: palette.background,
    shapes,
  };
}
