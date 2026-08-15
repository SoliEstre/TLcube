/**
 * cellSurfaceLayouts.js — Type Y 셀 표면 레이아웃 2종 (v1r2 · v2).
 *
 * 정본 입력은 셀 편집기 export. 파인더가 점유한 셀은 toneOverrides 가 닿는
 * (i,j) 전체다. userNonData 만 세면 format/reference 위에 칠한 셀이 빠진다.
 * reference(12) · format(15) 는 autoplaceY 가 그 점유 집합에서 유도한다.
 * 데이터 셀 수는
 *   441 − painted − 12 − 15
 * 이며 선언값(v1r2 334 · v2 306)과 같아야 한다.
 *
 * formatIndex 는 cube 축의 빈 슬롯. 구 v1 CS 12/14 의미는 그대로 둔다.
 *   v1r2d: 4 (2톤) / 6 (3톤)   ← 초안 와이어. 같은 기하의 **최종** v1r2 는 1/3 을 쓴다.
 *   v2:    5 (2톤) / 7 (3톤)
 *
 * 2026-08-15 밤: v1r2 기하가 최종 라인업(cellSurfaceFinal.js)으로 승격되면서 이 모듈의
 * id 는 'v1r2d' 로 분리됐다 — 여기 남은 것은 **소각된 와이어 슬롯 4/6 의 기록**이다.
 *
 * 런타임 의존성 0 · 순수 ESM.
 */

import { maxBytesForSymbols } from './capacity.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { VERSIONS_Y } from './capacityY.js';
import { placeReservedCells } from './autoplaceY.js';

export const CELL_SURFACE_LAYOUT_N = 21;
export const CELL_SURFACE_LAYOUT_VERSION = 1;
export const CELL_SURFACE_LEGACY_REFERENCE = 12;
export const CELL_SURFACE_LEGACY_FORMAT = 15;

/**
 * 초안 슬롯 id. 값이 'v1r2d' 인 이유 — 같은 기하가 2026-08-15 밤 **최종 라인업**에
 * v1r2(formatIndex 1/3) 로 승격됐다(cellSurfaceFinal.js). 이 모듈은 배포된 와이어
 * 슬롯 4/6 의 소각 기록이므로 id 를 분리해 두 경로가 서로를 가리지 않게 한다.
 * 기하·톤·데이터 회계(80 painted · 334 data)는 최종 v1r2 와 바이트 동일하다.
 */
export const CELL_SURFACE_LAYOUT_V1R2 = 'v1r2d';
export const CELL_SURFACE_LAYOUT_V2 = 'v2';
export const CELL_SURFACE_LAYOUT_IDS = Object.freeze([
  CELL_SURFACE_LAYOUT_V1R2,
  CELL_SURFACE_LAYOUT_V2,
]);
export const DEFAULT_CELL_SURFACE_LAYOUT = CELL_SURFACE_LAYOUT_V1R2;

export const CELL_SURFACE_LAYOUT_PROFILE = Object.freeze({
  [CELL_SURFACE_LAYOUT_V1R2]: 'cell-surface-v1r2',
  [CELL_SURFACE_LAYOUT_V2]: 'cell-surface-v2',
});

/** cube 미사용 슬롯. 3톤 = 2톤 + 2. 구 12/14 는 건드리지 않는다. */
export const CELL_SURFACE_LAYOUT_FORMAT_INDEX = Object.freeze({
  [CELL_SURFACE_LAYOUT_V1R2]: Object.freeze({ 2: 4, 3: 6 }),
  [CELL_SURFACE_LAYOUT_V2]: Object.freeze({ 2: 5, 3: 7 }),
});

export const CELL_SURFACE_LAYOUT_DECLARED_DATA = Object.freeze({
  [CELL_SURFACE_LAYOUT_V1R2]: 334,
  [CELL_SURFACE_LAYOUT_V2]: 306,
});

const FACES = Object.freeze(['T', 'L', 'R']);

const V1R2_USER = Object.freeze([
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 16], [0, 17], [0, 18], [0, 19], [0, 20],
  [1, 0], [1, 1], [1, 16], [1, 17], [1, 18], [1, 19], [1, 20],
  [2, 0], [2, 4], [2, 20],
  [3, 0], [3, 3], [3, 4], [3, 19], [3, 20],
  [4, 0], [4, 2], [4, 3], [4, 4],
  [16, 0], [16, 1], [16, 16], [16, 17], [16, 18], [16, 20],
  [17, 0], [17, 1], [17, 16], [17, 17], [17, 18], [17, 20],
  [18, 0], [18, 1], [18, 16], [18, 17], [18, 20],
  [19, 0], [19, 1], [19, 3], [19, 16], [19, 17], [19, 19], [19, 20],
  [20, 0], [20, 1], [20, 2], [20, 3], [20, 16], [20, 17], [20, 18], [20, 19], [20, 20],
]);

const V1R2_TONES = Object.freeze({
  T: Object.freeze([
    [0, 0, 0], [0, 1, 0], [0, 2, 2], [0, 3, 0], [0, 4, 2], [0, 16, 2], [0, 17, 0], [0, 18, 0], [0, 19, 0], [0, 20, 0],
    [1, 0, 0], [1, 1, 0], [1, 2, 2], [1, 3, 0], [1, 4, 2], [1, 16, 2], [1, 17, 2], [1, 18, 2], [1, 19, 2], [1, 20, 0],
    [2, 0, 2], [2, 1, 2], [2, 2, 2], [2, 3, 0], [2, 4, 2], [2, 18, 2], [2, 19, 2], [2, 20, 0],
    [3, 0, 0], [3, 1, 2], [3, 2, 2], [3, 3, 0], [3, 4, 2], [3, 19, 2], [3, 20, 2],
    [4, 0, 2], [4, 1, 2], [4, 2, 2], [4, 3, 2], [4, 4, 2],
    [16, 0, 2], [16, 1, 2], [16, 16, 2], [16, 17, 2], [16, 18, 2], [16, 19, 2], [16, 20, 2],
    [17, 0, 0], [17, 1, 2], [17, 16, 2], [17, 17, 0], [17, 18, 0], [17, 19, 2], [17, 20, 0],
    [18, 0, 0], [18, 1, 2], [18, 2, 2], [18, 16, 2], [18, 17, 0], [18, 18, 0], [18, 19, 2], [18, 20, 0],
    [19, 0, 0], [19, 1, 2], [19, 2, 2], [19, 3, 2], [19, 16, 2], [19, 17, 2], [19, 18, 2], [19, 19, 2], [19, 20, 0],
    [20, 0, 0], [20, 1, 0], [20, 2, 0], [20, 3, 2], [20, 16, 2], [20, 17, 0], [20, 18, 0], [20, 19, 0], [20, 20, 0],
  ]),
  L: Object.freeze([
    [0, 0, 0], [0, 1, 0], [0, 2, 2], [0, 3, 0], [0, 4, 2], [0, 16, 2], [0, 17, 0], [0, 18, 0], [0, 19, 0], [0, 20, 0],
    [1, 0, 0], [1, 1, 0], [1, 2, 2], [1, 3, 0], [1, 4, 2], [1, 16, 2], [1, 17, 2], [1, 18, 2], [1, 19, 2], [1, 20, 0],
    [2, 0, 2], [2, 1, 2], [2, 2, 2], [2, 3, 0], [2, 4, 2], [2, 18, 2], [2, 19, 2], [2, 20, 0],
    [3, 0, 0], [3, 1, 0], [3, 2, 0], [3, 3, 0], [3, 4, 2], [3, 19, 2], [3, 20, 2],
    [4, 0, 2], [4, 1, 2], [4, 2, 2], [4, 3, 2], [4, 4, 2],
    [16, 0, 2], [16, 1, 2], [16, 16, 0], [16, 17, 0], [16, 18, 0], [16, 19, 0], [16, 20, 0],
    [17, 0, 0], [17, 1, 2], [17, 16, 0], [17, 17, 2], [17, 18, 2], [17, 19, 2], [17, 20, 2],
    [18, 0, 0], [18, 1, 2], [18, 2, 2], [18, 16, 0], [18, 17, 2], [18, 18, 0], [18, 19, 2], [18, 20, 0],
    [19, 0, 0], [19, 1, 2], [19, 2, 2], [19, 3, 2], [19, 16, 0], [19, 17, 2], [19, 18, 2], [19, 19, 2], [19, 20, 0],
    [20, 0, 0], [20, 1, 0], [20, 2, 0], [20, 3, 2], [20, 16, 0], [20, 17, 2], [20, 18, 0], [20, 19, 0], [20, 20, 0],
  ]),
  R: Object.freeze([
    [0, 0, 0], [0, 1, 0], [0, 2, 2], [0, 3, 0], [0, 4, 2], [0, 16, 2], [0, 17, 0], [0, 18, 0], [0, 19, 0], [0, 20, 0],
    [1, 0, 0], [1, 1, 0], [1, 2, 2], [1, 3, 2], [1, 4, 2], [1, 16, 2], [1, 17, 2], [1, 18, 2], [1, 19, 2], [1, 20, 0],
    [2, 0, 2], [2, 1, 2], [2, 2, 2], [2, 3, 2], [2, 4, 2], [2, 18, 2], [2, 19, 2], [2, 20, 0],
    [3, 0, 0], [3, 1, 0], [3, 2, 0], [3, 3, 0], [3, 4, 2], [3, 19, 2], [3, 20, 2],
    [4, 0, 2], [4, 1, 2], [4, 2, 2], [4, 3, 2], [4, 4, 2],
    [16, 0, 2], [16, 1, 2], [16, 16, 0], [16, 17, 0], [16, 18, 0], [16, 19, 0], [16, 20, 0],
    [17, 0, 0], [17, 1, 2], [17, 16, 0], [17, 17, 2], [17, 18, 2], [17, 19, 2], [17, 20, 2],
    [18, 0, 0], [18, 1, 2], [18, 2, 2], [18, 16, 0], [18, 17, 2], [18, 18, 0], [18, 19, 2], [18, 20, 0],
    [19, 0, 0], [19, 1, 2], [19, 2, 2], [19, 3, 2], [19, 16, 0], [19, 17, 2], [19, 18, 2], [19, 19, 2], [19, 20, 0],
    [20, 0, 0], [20, 1, 0], [20, 2, 0], [20, 3, 2], [20, 16, 0], [20, 17, 2], [20, 18, 0], [20, 19, 0], [20, 20, 0],
  ]),
});

const V2_USER = Object.freeze([
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 16], [0, 17], [0, 18], [0, 19], [0, 20],
  [1, 0], [1, 1], [1, 16], [1, 17], [1, 18], [1, 19], [1, 20],
  [2, 0], [2, 4], [2, 20],
  [3, 0], [3, 3], [3, 4], [3, 19], [3, 20],
  [4, 0], [4, 2], [4, 3], [4, 4], [4, 19], [4, 20],
  [14, 14], [14, 15], [14, 16], [14, 17], [14, 18], [14, 20],
  [15, 14], [15, 15], [15, 16], [15, 17], [15, 18], [15, 20],
  [16, 0], [16, 1], [16, 14], [16, 15], [16, 16], [16, 17], [16, 18], [16, 20],
  [17, 0], [17, 1], [17, 14], [17, 15], [17, 16], [17, 17], [17, 18], [17, 20],
  [18, 0], [18, 1], [18, 14], [18, 15], [18, 16], [18, 17], [18, 20],
  [19, 0], [19, 1], [19, 3], [19, 4], [19, 14], [19, 15], [19, 16], [19, 17], [19, 19], [19, 20],
  [20, 0], [20, 1], [20, 2], [20, 3], [20, 4], [20, 14], [20, 15], [20, 16], [20, 17], [20, 18], [20, 19], [20, 20],
]);

const V2_TONES = Object.freeze({
  T: Object.freeze([
    [0, 0, 0], [0, 1, 0], [0, 2, 2], [0, 3, 0], [0, 4, 2], [0, 16, 2], [0, 17, 0], [0, 18, 0], [0, 19, 0], [0, 20, 0],
    [1, 0, 0], [1, 1, 0], [1, 2, 2], [1, 3, 0], [1, 4, 2], [1, 16, 2], [1, 17, 2], [1, 18, 2], [1, 19, 2], [1, 20, 0],
    [2, 0, 2], [2, 1, 2], [2, 2, 2], [2, 3, 0], [2, 4, 2], [2, 18, 2], [2, 19, 2], [2, 20, 0],
    [3, 0, 0], [3, 1, 0], [3, 2, 0], [3, 3, 0], [3, 4, 2], [3, 19, 2], [3, 20, 0],
    [4, 0, 2], [4, 1, 2], [4, 2, 2], [4, 3, 2], [4, 4, 2], [4, 19, 2], [4, 20, 2],
    [14, 14, 2], [14, 15, 2], [14, 16, 2], [14, 17, 2], [14, 18, 2], [14, 19, 2], [14, 20, 2],
    [15, 14, 2], [15, 15, 0], [15, 16, 0], [15, 17, 0], [15, 18, 0], [15, 19, 0], [15, 20, 0],
    [16, 0, 2], [16, 1, 2], [16, 14, 2], [16, 15, 0], [16, 16, 2], [16, 17, 2], [16, 18, 2], [16, 19, 2], [16, 20, 0],
    [17, 0, 0], [17, 1, 2], [17, 14, 2], [17, 15, 0], [17, 16, 2], [17, 17, 0], [17, 18, 0], [17, 19, 2], [17, 20, 0],
    [18, 0, 0], [18, 1, 2], [18, 2, 2], [18, 14, 2], [18, 15, 0], [18, 16, 2], [18, 17, 0], [18, 18, 0], [18, 19, 2], [18, 20, 0],
    [19, 0, 0], [19, 1, 2], [19, 2, 2], [19, 3, 2], [19, 4, 2], [19, 14, 2], [19, 15, 0], [19, 16, 2], [19, 17, 2], [19, 18, 2], [19, 19, 2], [19, 20, 0],
    [20, 0, 0], [20, 1, 0], [20, 2, 0], [20, 3, 0], [20, 4, 2], [20, 14, 2], [20, 15, 0], [20, 16, 0], [20, 17, 0], [20, 18, 0], [20, 19, 0], [20, 20, 0],
  ]),
  L: Object.freeze([
    [0, 0, 0], [0, 1, 0], [0, 2, 2], [0, 3, 0], [0, 4, 2], [0, 16, 2], [0, 17, 0], [0, 18, 0], [0, 19, 0], [0, 20, 0],
    [1, 0, 0], [1, 1, 0], [1, 2, 2], [1, 3, 0], [1, 4, 2], [1, 16, 2], [1, 17, 2], [1, 18, 2], [1, 19, 2], [1, 20, 0],
    [2, 0, 2], [2, 1, 2], [2, 2, 2], [2, 3, 0], [2, 4, 2], [2, 18, 2], [2, 19, 2], [2, 20, 0],
    [3, 0, 0], [3, 1, 0], [3, 2, 0], [3, 3, 0], [3, 4, 2], [3, 19, 2], [3, 20, 0],
    [4, 0, 2], [4, 1, 2], [4, 2, 2], [4, 3, 2], [4, 4, 2], [4, 19, 2], [4, 20, 2],
    [14, 14, 2], [14, 15, 2], [14, 16, 2], [14, 17, 2], [14, 18, 2], [14, 19, 2], [14, 20, 2],
    [15, 14, 2], [15, 15, 0], [15, 16, 0], [15, 17, 0], [15, 18, 0], [15, 19, 0], [15, 20, 0],
    [16, 0, 2], [16, 1, 2], [16, 14, 2], [16, 15, 0], [16, 16, 2], [16, 17, 2], [16, 18, 2], [16, 19, 2], [16, 20, 0],
    [17, 0, 0], [17, 1, 2], [17, 14, 2], [17, 15, 0], [17, 16, 2], [17, 17, 0], [17, 18, 0], [17, 19, 2], [17, 20, 0],
    [18, 0, 0], [18, 1, 2], [18, 2, 2], [18, 14, 2], [18, 15, 0], [18, 16, 2], [18, 17, 0], [18, 18, 0], [18, 19, 2], [18, 20, 0],
    [19, 0, 0], [19, 1, 2], [19, 2, 2], [19, 3, 2], [19, 4, 2], [19, 14, 2], [19, 15, 0], [19, 16, 2], [19, 17, 2], [19, 18, 2], [19, 19, 2], [19, 20, 0],
    [20, 0, 0], [20, 1, 0], [20, 2, 0], [20, 3, 0], [20, 4, 2], [20, 14, 2], [20, 15, 0], [20, 16, 0], [20, 17, 0], [20, 18, 0], [20, 19, 0], [20, 20, 0],
  ]),
  R: Object.freeze([
    [0, 0, 0], [0, 1, 0], [0, 2, 2], [0, 3, 2], [0, 4, 2], [0, 16, 2], [0, 17, 0], [0, 18, 0], [0, 19, 0], [0, 20, 0],
    [1, 0, 0], [1, 1, 0], [1, 2, 2], [1, 3, 2], [1, 4, 2], [1, 16, 2], [1, 17, 2], [1, 18, 2], [1, 19, 2], [1, 20, 0],
    [2, 0, 2], [2, 1, 2], [2, 2, 2], [2, 3, 2], [2, 4, 2], [2, 18, 2], [2, 19, 2], [2, 20, 0],
    [3, 0, 0], [3, 1, 0], [3, 2, 0], [3, 3, 0], [3, 4, 2], [3, 19, 2], [3, 20, 0],
    [4, 0, 2], [4, 1, 2], [4, 2, 2], [4, 3, 2], [4, 4, 2], [4, 19, 2], [4, 20, 2],
    [14, 14, 2], [14, 15, 2], [14, 16, 2], [14, 17, 2], [14, 18, 2], [14, 19, 2], [14, 20, 2],
    [15, 14, 2], [15, 15, 0], [15, 16, 0], [15, 17, 0], [15, 18, 0], [15, 19, 0], [15, 20, 0],
    [16, 0, 2], [16, 1, 2], [16, 14, 2], [16, 15, 0], [16, 16, 2], [16, 17, 2], [16, 18, 2], [16, 19, 2], [16, 20, 0],
    [17, 0, 0], [17, 1, 2], [17, 14, 2], [17, 15, 0], [17, 16, 2], [17, 17, 0], [17, 18, 0], [17, 19, 2], [17, 20, 0],
    [18, 0, 0], [18, 1, 2], [18, 2, 2], [18, 14, 2], [18, 15, 0], [18, 16, 2], [18, 17, 0], [18, 18, 0], [18, 19, 2], [18, 20, 0],
    [19, 0, 0], [19, 1, 2], [19, 2, 2], [19, 3, 2], [19, 4, 2], [19, 14, 2], [19, 15, 0], [19, 16, 2], [19, 17, 2], [19, 18, 2], [19, 19, 2], [19, 20, 0],
    [20, 0, 0], [20, 1, 0], [20, 2, 0], [20, 3, 0], [20, 4, 2], [20, 14, 2], [20, 15, 0], [20, 16, 0], [20, 17, 0], [20, 18, 0], [20, 19, 0], [20, 20, 0],
  ]),
});

function cellKey(i, j) {
  return i + ',' + j;
}

function toneMap(triples) {
  const map = Object.create(null);
  for (const [i, j, tone] of triples) map[cellKey(i, j)] = tone;
  return Object.freeze(map);
}

function uniquePaintedCells(tones) {
  const seen = new Set();
  const cells = [];
  for (const face of FACES) {
    for (const triple of tones[face]) {
      const i = triple[0];
      const j = triple[1];
      const key = cellKey(i, j);
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ i, j });
    }
  }
  cells.sort((a, b) => a.i - b.i || a.j - b.j);
  return cells;
}

function buildLocatorCells(painted, tones) {
  const tables = {
    T: toneMap(tones.T),
    L: toneMap(tones.L),
    R: toneMap(tones.R),
  };
  const cells = painted.map(({ i, j }) => {
    const key = cellKey(i, j);
    const T = tables.T[key];
    const L = tables.L[key];
    const R = tables.R[key];
    if (T !== 0 && T !== 2) throw new Error('locator T 톤이 0/2 가 아니다: ' + key);
    if (L !== 0 && L !== 2) throw new Error('locator L 톤이 0/2 가 아니다: ' + key);
    if (R !== 0 && R !== 2) throw new Error('locator R 톤이 0/2 가 아니다: ' + key);
    return Object.freeze({ i, j, T, L, R });
  });
  cells.sort((a, b) => a.i - b.i || a.j - b.j);
  return Object.freeze(cells);
}

function nsymTable(symbols) {
  const L = Math.round(0.12 * symbols);
  let M = Math.round(0.25 * symbols);
  if (M % 2 === 0) M += 1;
  const H = Math.round(0.40 * symbols);
  return Object.freeze({ symbols, L, M, H });
}

function buildLayout(id, user, tones) {
  const n = CELL_SURFACE_LAYOUT_N;
  const painted = uniquePaintedCells(tones);
  const paintedKeys = new Set(painted.map((cell) => cellKey(cell.i, cell.j)));
  for (const pair of user) {
    const key = cellKey(pair[0], pair[1]);
    if (!paintedKeys.has(key)) {
      throw new Error(id + ': userNonData 가 톤 표에 없다: ' + key);
    }
  }
  const locatorCells = buildLocatorCells(painted, tones);
  const placed = placeReservedCells(n, painted);
  const format = placed.formatCells;
  const reference = placed.referenceCells;
  const locatorKeys = new Set(locatorCells.map((cell) => cellKey(cell.i, cell.j)));
  const formatKeys = new Set(format.map((cell) => cellKey(cell.i, cell.j)));
  const referenceKeys = new Set(reference.map((cell) => cellKey(cell.i, cell.j)));

  for (const key of locatorKeys) {
    if (formatKeys.has(key)) throw new Error(id + ': locator 가 format 과 겹친다: ' + key);
    if (referenceKeys.has(key)) throw new Error(id + ': locator 가 reference 와 겹친다: ' + key);
  }
  if (locatorCells.length !== painted.length) {
    throw new Error(id + ': locator 수가 칠한 셀 수와 다르다');
  }
  if (format.length !== CELL_SURFACE_LEGACY_FORMAT) {
    throw new Error(id + ': format 15가 아니다: ' + format.length);
  }
  if (reference.length !== CELL_SURFACE_LEGACY_REFERENCE) {
    throw new Error(id + ': reference 12가 아니다: ' + reference.length);
  }

  const declared = CELL_SURFACE_LAYOUT_DECLARED_DATA[id];
  const dataCells = n * n - locatorCells.length - reference.length - format.length;
  if (dataCells !== declared) {
    throw new Error(
      id + ': 441 − painted − 12 − 15 = ' + dataCells
      + ' 이 선언 data ' + declared + ' 와 다르다',
    );
  }

  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;
  const nsym = nsymTable(usedSymbols);
  const formatIndex = CELL_SURFACE_LAYOUT_FORMAT_INDEX[id];
  if (formatIndex[3] !== formatIndex[2] + 2) {
    throw new Error(id + ': 3톤 formatIndex 는 2톤 + 2 이어야 한다');
  }

  return Object.freeze({
    id,
    profile: CELL_SURFACE_LAYOUT_PROFILE[id],
    n,
    version: CELL_SURFACE_LAYOUT_VERSION,
    locatorCells,
    locatorCount: locatorCells.length,
    paintedCells: Object.freeze(painted.map((cell) => Object.freeze({ i: cell.i, j: cell.j }))),
    paintedCount: painted.length,
    userNonDataCount: user.length,
    formatCells: format,
    referenceCells: reference,
    autoplace: placed.metrics,
    declaredDataCells: declared,
    usedSymbols,
    residualCells,
    nsym,
    formatIndex,
  });
}

const LAYOUTS = Object.freeze({
  [CELL_SURFACE_LAYOUT_V1R2]: buildLayout(CELL_SURFACE_LAYOUT_V1R2, V1R2_USER, V1R2_TONES),
  [CELL_SURFACE_LAYOUT_V2]: buildLayout(CELL_SURFACE_LAYOUT_V2, V2_USER, V2_TONES),
});

export function assertCellSurfaceLayoutId(id) {
  if (!CELL_SURFACE_LAYOUT_IDS.includes(id)) {
    throw new RangeError('cell-surface layout 은 v1r2 또는 v2 여야 한다: ' + id);
  }
  return id;
}

export function assertCellSurfaceLayoutTones(tones) {
  if (tones !== 2 && tones !== 3) {
    throw new RangeError('cell-surface layout tones 는 2 또는 3 이어야 한다: ' + tones);
  }
  return tones;
}

export function cellSurfaceLayout(id) {
  return LAYOUTS[assertCellSurfaceLayoutId(id)];
}

export function formatIndexCellSurfaceLayout(id, tones) {
  return cellSurfaceLayout(id).formatIndex[assertCellSurfaceLayoutTones(tones)];
}

export function nameCellSurfaceLayout(id, tones) {
  const layout = cellSurfaceLayout(id);
  const suffix = assertCellSurfaceLayoutTones(tones) === 3 ? 'T' : '';
  return 'Y1' + suffix + '-CS-' + layout.id.toUpperCase();
}

export function isCellSurfaceLayoutFormatIndex(index) {
  for (const id of CELL_SURFACE_LAYOUT_IDS) {
    const table = CELL_SURFACE_LAYOUT_FORMAT_INDEX[id];
    if (index === table[2] || index === table[3]) return true;
  }
  return false;
}

export function layoutIdFromFormatIndex(index) {
  for (const id of CELL_SURFACE_LAYOUT_IDS) {
    const table = CELL_SURFACE_LAYOUT_FORMAT_INDEX[id];
    if (index === table[2] || index === table[3]) return id;
  }
  return null;
}

export function tonesFromCellSurfaceLayoutFormatIndex(index) {
  for (const id of CELL_SURFACE_LAYOUT_IDS) {
    const table = CELL_SURFACE_LAYOUT_FORMAT_INDEX[id];
    if (index === table[2]) return 2;
    if (index === table[3]) return 3;
  }
  throw new RangeError('cell-surface layout formatIndex 가 아니다: ' + index);
}

export function locatorCellsCellSurfaceLayout(id) {
  return cellSurfaceLayout(id).locatorCells;
}

export function paintedCellsCellSurfaceLayout(id) {
  return cellSurfaceLayout(id).paintedCells;
}

export function formatCellsCellSurfaceLayout(id) {
  return cellSurfaceLayout(id).formatCells;
}

export function dataCellsInScanOrderCellSurfaceLayout(id) {
  const layout = cellSurfaceLayout(id);
  const blocked = new Set([
    ...layout.locatorCells.map((cell) => cellKey(cell.i, cell.j)),
    ...layout.formatCells.map((cell) => cellKey(cell.i, cell.j)),
    ...layout.referenceCells.map((cell) => cellKey(cell.i, cell.j)),
  ]);
  const out = [];
  for (let j = 0; j < layout.n; j += 1) {
    for (let i = 0; i < layout.n; i += 1) {
      if (!blocked.has(cellKey(i, j))) out.push({ i, j });
    }
  }
  if (out.length !== layout.declaredDataCells) {
    throw new Error(
      layout.id + ': scan data ' + out.length
      + ' !== 선언 ' + layout.declaredDataCells,
    );
  }
  return out;
}

export function fillerCellsCellSurfaceLayout(id) {
  const scan = dataCellsInScanOrderCellSurfaceLayout(id);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

export function layoutMapCellSurfaceLayout(id) {
  const layout = cellSurfaceLayout(id);
  const map = new Map();
  layout.locatorCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'locator', index });
  });
  layout.referenceCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'reference', index });
  });
  layout.formatCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'format', index });
  });
  dataCellsInScanOrderCellSurfaceLayout(id).forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'data', index });
  });
  return map;
}

export function locatorToneCellSurfaceLayout(id, face, i, j) {
  const layout = cellSurfaceLayout(id);
  if (!FACES.includes(face)) throw new RangeError('면 라벨은 T | L | R 이어야 한다: ' + face);
  for (const cell of layout.locatorCells) {
    if (cell.i === i && cell.j === j) return cell[face];
  }
  return 1;
}

function nsymForLevel(layout, level) {
  const nsym = layout.nsym[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError(layout.id + ' 에 없는 ECC 레벨: ' + level);
  }
  return nsym;
}

export function capacityForCellSurfaceLayout(id, level = 'M', tones = 2) {
  const layout = cellSurfaceLayout(id);
  const resolvedTones = assertCellSurfaceLayoutTones(tones);
  const nsym = nsymForLevel(layout, level);
  const dataSymbols = layout.usedSymbols - nsym;
  const dataBytes = maxBytesForSymbols(dataSymbols);
  return {
    name: nameCellSurfaceLayout(id, resolvedTones),
    version: layout.version,
    n: layout.n,
    tones: resolvedTones,
    formatIndex: formatIndexCellSurfaceLayout(id, resolvedTones),
    cellSurface: true,
    cellSurfaceLayout: id,
    locatorProfile: layout.profile,
    totalCells: layout.n * layout.n,
    overhead: layout.locatorCount + layout.formatCells.length + layout.referenceCells.length,
    locator: layout.locatorCount,
    format: layout.formatCells.length,
    reference: layout.referenceCells.length,
    dataCells: layout.declaredDataCells,
    usedSymbols: layout.usedSymbols,
    residualCells: layout.residualCells,
    level,
    nsym,
    errorCapacity: errorCapacity(nsym),
    dataSymbols,
    dataBytes,
    maxPayloadBytes: maxPayloadFor(dataBytes),
    headerBytes: HEADER_BYTES,
  };
}

export function usedCubeFormatIndices() {
  return Object.freeze([...new Set(VERSIONS_Y.map((spec) => spec.formatIndex))].sort((a, b) => a - b));
}

{
  const used = usedCubeFormatIndices();
  for (const id of CELL_SURFACE_LAYOUT_IDS) {
    const table = CELL_SURFACE_LAYOUT_FORMAT_INDEX[id];
    for (const index of [table[2], table[3]]) {
      if (used.includes(index)) {
        throw new Error(
          id + ' formatIndex ' + index + ' 가 cube VERSIONS_Y 와 겹친다: ' + used.join(','),
        );
      }
    }
    const scan = dataCellsInScanOrderCellSurfaceLayout(id);
    if (scan.length !== CELL_SURFACE_LAYOUT_DECLARED_DATA[id]) {
      throw new Error(id + ': data 선언과 scan 이 어긋난다');
    }
  }
}
