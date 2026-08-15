/**
 * cellSurfaceFinal.js — Type Y 셀 표면 **최종 라인업** (v0 · v2r2).
 *
 * 운영자 확정 라인업 (2026-08-15):
 *   Y0 (n=13) → v0   — 네 코너 소형 블록 파인더 30셀 (정본: cellsurface-v0-editor.json)
 *   Y1 (n=21) → v2r2 — 원점 앵커 블록 A(4×4) + 먼 꼭짓점 앵커 블록 B(7×7) = 65셀
 *   Y2 (n=25) → v2r2 — 같은 앵커식 (블록 B 가 (n−7..n−1)² 로 평행이동)
 *
 * v2r2 의 정본(cellsurface-v2r2-editor.json)은 n=11 편집 캔버스지만 **n 종속이 아니다**:
 * 블록 A 는 (0..3)² 원점 고정, 블록 B 는 (n−7..n−1)² 먼 꼭짓점 고정 — n=11 에서
 * (4..10)² 였던 블록 B 를 (n−11) 만큼 평행이동해 일반 n 에 인스턴스화한다.
 * n=13 은 autoplace REF_QUADRANT 거부(블록이 사분면을 잠식) — 그래서 v0 가 있다.
 *
 * reference(12) · format(15) 는 **autoplaceY.placeReservedCells 로만 유도**한다 —
 * 손 좌표표 금지(c0e7321 계약: 편집기·인코더·디코더가 같은 함수를 쓴다).
 *
 * formatIndex 는 «신세대 셀 표면» **한 쌍만** 쓴다 — 2톤 1 · 3톤 3 (3T = 2T + 2,
 * ADR 0006 D3-5 쌍 불변식). 레이아웃은 와이어가 아니라 **n 으로 정해진다** — 디코더는
 * 기하에서 n 을 이미 알므로 format 읽기 전에 레이아웃이 확정된다(부트스트랩 순환 없음).
 * tri 축 A0(1)·A0Q(3) 과 숫자가 겹치지만 cube 축(finder=null)이라 분리된다
 * (Y0=0 vs hex V1=0 전례, ADR 0006 D3-1).
 *
 * 구 v1 CS(12/14)·v1r2(4/6)·v2(5/7) 초안은 **배포된 와이어 의미**라 슬롯을 소각 기록으로
 * 남긴다(모듈 로드 시점 충돌 검증의 대조군) — 이 모듈은 그 슬롯을 재사용하지 않는다.
 *
 * 런타임 의존성 0 · 순수 ESM (node: API 금지, Math.random/Date 금지).
 */

import { maxBytesForSymbols } from './capacity.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { VERSIONS_Y } from './capacityY.js';
import {
  CELL_SURFACE_FORMAT_INDEX_2T as LEGACY_CS_INDEX_2T,
  CELL_SURFACE_FORMAT_INDEX_3T as LEGACY_CS_INDEX_3T,
} from './cellSurfaceY.js';
import {
  CELL_SURFACE_LAYOUT_FORMAT_INDEX as DRAFT_LAYOUT_FORMAT_INDEX,
  CELL_SURFACE_LAYOUT_IDS as DRAFT_LAYOUT_IDS,
} from './cellSurfaceLayouts.js';
import { placeReservedCells } from './autoplaceY.js';

export const CELL_SURFACE_FINAL_V0 = 'v0';
export const CELL_SURFACE_FINAL_V2R2 = 'v2r2';
export const CELL_SURFACE_FINAL_IDS = Object.freeze([
  CELL_SURFACE_FINAL_V0,
  CELL_SURFACE_FINAL_V2R2,
]);

export const CELL_SURFACE_FINAL_PROFILE = Object.freeze({
  [CELL_SURFACE_FINAL_V0]: 'cell-surface-v0',
  [CELL_SURFACE_FINAL_V2R2]: 'cell-surface-v2r2',
});

/** 신세대 셀 표면 formatIndex — 한 쌍뿐. 레이아웃 구분은 n 이 한다. */
export const CELL_SURFACE_FINAL_FORMAT_INDEX = Object.freeze({ 2: 1, 3: 3 });

/** 레이아웃별 허용 n. v2r2 는 n=13 을 autoplace 가 거부한다(REF_QUADRANT). */
export const CELL_SURFACE_FINAL_NS = Object.freeze({
  [CELL_SURFACE_FINAL_V0]: Object.freeze([13]),
  [CELL_SURFACE_FINAL_V2R2]: Object.freeze([21, 25]),
});

/** n → 최종 레이아웃 id. 라인업 밖 n 은 null. */
export function finalLayoutIdForN(n) {
  if (n === 13) return CELL_SURFACE_FINAL_V0;
  if (n === 21 || n === 25) return CELL_SURFACE_FINAL_V2R2;
  return null;
}

/** n → VERSIONS_Y 논리 버전 (Y0/Y1/Y2). */
export function versionForFinalN(n) {
  if (n === 13) return 0;
  if (n === 21) return 1;
  if (n === 25) return 2;
  throw new RangeError('셀 표면 최종 라인업의 n 은 13 | 21 | 25 다: ' + n);
}

/** 회계 선언값 — n² − painted − 12 − 27+... = n² − painted − 27. 어긋나면 로드 시 throw. */
const DECLARED_DATA_BY_N = Object.freeze({ 13: 112, 21: 349, 25: 533 });

const FACES = Object.freeze(['T', 'L', 'R']);

/**
 * v0 정본 30셀 [i, j, T, L, R] — cellsurface-v0-editor.json (사용자 제공 2026-08-15)
 * 컴팩트 전사. 네 코너 블록: NW 3×3 · NE 2×3 · SW 3×2 · SE 3×3 + 팔 (n=13 고정).
 */
const V0_CELLS = Object.freeze([
  [0, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 2, 2, 2, 2], [0, 10, 2, 2, 2], [0, 11, 0, 2, 0], [0, 12, 0, 0, 0],
  [1, 0, 0, 0, 0], [1, 1, 0, 0, 0], [1, 2, 2, 2, 2], [1, 10, 2, 0, 2], [1, 11, 2, 0, 2], [1, 12, 2, 0, 2],
  [2, 0, 2, 2, 2], [2, 1, 2, 2, 2], [2, 2, 2, 2, 2], [10, 0, 2, 2, 2], [10, 1, 2, 2, 0], [10, 10, 2, 2, 0],
  [10, 11, 2, 2, 0], [10, 12, 2, 2, 0], [11, 0, 0, 0, 2], [11, 1, 2, 2, 0], [11, 10, 2, 2, 0], [11, 11, 0, 0, 2],
  [11, 12, 0, 0, 0], [12, 0, 0, 0, 0], [12, 1, 2, 2, 0], [12, 10, 2, 2, 0], [12, 11, 0, 0, 0], [12, 12, 0, 0, 0],
]);

/** v2r2 기준 캔버스 크기 — 블록 B 평행이동의 원점. */
const V2R2_BASE_N = 11;

/**
 * v2r2 정본 65셀 [i, j, T, L, R] — cellsurface-v2r2-editor.json (사용자 제공 2026-08-15)
 * 컴팩트 전사, n=11 캔버스 좌표. 블록 A = (0..3)² 16셀 · 블록 B = (4..10)² 49셀.
 * 일반 n 인스턴스화: A 는 그대로, B 는 (i,j) → (i+n−11, j+n−11).
 */
const V2R2_BASE_CELLS = Object.freeze([
  [0, 0, 0, 0, 0], [0, 1, 2, 2, 2], [0, 2, 0, 0, 0], [0, 3, 2, 2, 2], [1, 0, 2, 2, 2], [1, 1, 2, 2, 2],
  [1, 2, 0, 0, 2], [1, 3, 2, 2, 2], [2, 0, 0, 0, 0], [2, 1, 2, 0, 0], [2, 2, 0, 0, 0], [2, 3, 2, 2, 2],
  [3, 0, 2, 2, 2], [3, 1, 2, 2, 2], [3, 2, 2, 2, 2], [3, 3, 2, 2, 2], [4, 4, 2, 2, 2], [4, 5, 2, 2, 2],
  [4, 6, 2, 2, 2], [4, 7, 2, 2, 2], [4, 8, 2, 2, 2], [4, 9, 2, 2, 2], [4, 10, 2, 2, 2], [5, 4, 2, 2, 2],
  [5, 5, 0, 0, 0], [5, 6, 0, 0, 0], [5, 7, 0, 0, 2], [5, 8, 0, 2, 2], [5, 9, 0, 0, 0], [5, 10, 0, 0, 0],
  [6, 4, 2, 2, 2], [6, 5, 0, 0, 0], [6, 6, 2, 0, 0], [6, 7, 2, 0, 2], [6, 8, 2, 2, 2], [6, 9, 2, 2, 2],
  [6, 10, 0, 2, 0], [7, 4, 2, 2, 2], [7, 5, 0, 0, 2], [7, 6, 2, 0, 2], [7, 7, 0, 0, 2], [7, 8, 0, 2, 2],
  [7, 9, 2, 0, 2], [7, 10, 0, 0, 2], [8, 4, 2, 2, 2], [8, 5, 0, 2, 2], [8, 6, 2, 2, 2], [8, 7, 0, 2, 2],
  [8, 8, 0, 2, 0], [8, 9, 2, 2, 0], [8, 10, 0, 2, 0], [9, 4, 2, 2, 2], [9, 5, 0, 0, 0], [9, 6, 2, 2, 2],
  [9, 7, 2, 0, 2], [9, 8, 2, 2, 0], [9, 9, 2, 0, 0], [9, 10, 0, 0, 0], [10, 4, 2, 2, 2], [10, 5, 0, 0, 0],
  [10, 6, 0, 2, 0], [10, 7, 0, 0, 2], [10, 8, 0, 2, 0], [10, 9, 0, 0, 0], [10, 10, 0, 0, 0],
]);

function cellKey(i, j) {
  return i + ',' + j;
}

export function assertCellSurfaceFinalId(id) {
  if (!CELL_SURFACE_FINAL_IDS.includes(id)) {
    throw new RangeError('셀 표면 최종 레이아웃은 v0 또는 v2r2 여야 한다: ' + id);
  }
  return id;
}

export function assertCellSurfaceFinalTones(tones) {
  if (tones !== 2 && tones !== 3) {
    throw new RangeError('셀 표면 최종 라인업 tones 는 2 또는 3 이어야 한다: ' + tones);
  }
  return tones;
}

export function isCellSurfaceFinalId(id) {
  return CELL_SURFACE_FINAL_IDS.includes(id);
}

export function formatIndexCellSurfaceFinal(tones) {
  return CELL_SURFACE_FINAL_FORMAT_INDEX[assertCellSurfaceFinalTones(tones)];
}

export function isCellSurfaceFinalFormatIndex(index) {
  return index === CELL_SURFACE_FINAL_FORMAT_INDEX[2]
    || index === CELL_SURFACE_FINAL_FORMAT_INDEX[3];
}

export function tonesFromCellSurfaceFinalFormatIndex(index) {
  if (index === CELL_SURFACE_FINAL_FORMAT_INDEX[2]) return 2;
  if (index === CELL_SURFACE_FINAL_FORMAT_INDEX[3]) return 3;
  throw new RangeError(
    '신세대 셀 표면 formatIndex 는 ' + CELL_SURFACE_FINAL_FORMAT_INDEX[2]
    + ' 또는 ' + CELL_SURFACE_FINAL_FORMAT_INDEX[3] + ' 이어야 한다: ' + index,
  );
}

/** 최종 라인업이 지원하는 n 인지. */
export function isCellSurfaceFinalN(n) {
  return finalLayoutIdForN(n) !== null;
}

/** id + n 정합 검사 — v0 는 13 만, v2r2 는 21|25 만. */
export function assertCellSurfaceFinalN(id, n) {
  assertCellSurfaceFinalId(id);
  if (!CELL_SURFACE_FINAL_NS[id].includes(n)) {
    throw new RangeError(
      '셀 표면 ' + id + ' 는 n=' + CELL_SURFACE_FINAL_NS[id].join('|') + ' 전용이다: n=' + n,
    );
  }
  return n;
}

/** v2r2 파인더 65셀을 일반 n 좌표로 인스턴스화 (A 원점 고정 · B 먼 꼭짓점 고정). */
function v2r2CellsForN(n) {
  const shift = n - V2R2_BASE_N;
  return V2R2_BASE_CELLS.map(([i, j, T, L, R]) => {
    const inA = i <= 3 && j <= 3;
    const inB = i >= 4 && j >= 4;
    if (!inA && !inB) {
      throw new Error('v2r2 정본 셀 (' + i + ',' + j + ') 이 블록 A/B 어느 쪽도 아니다');
    }
    return inA ? [i, j, T, L, R] : [i + shift, j + shift, T, L, R];
  });
}

function buildLocatorCells(rows) {
  const seen = new Set();
  const cells = rows.map(([i, j, T, L, R]) => {
    const key = cellKey(i, j);
    if (seen.has(key)) throw new Error('locator 좌표 중복: ' + key);
    seen.add(key);
    for (const tone of [T, L, R]) {
      if (tone !== 0 && tone !== 2) {
        throw new Error('locator 톤이 0/2 가 아니다: ' + key);
      }
    }
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

function buildFinalSurface(n) {
  const id = finalLayoutIdForN(n);
  if (id === null) {
    throw new RangeError('셀 표면 최종 라인업의 n 은 13 | 21 | 25 다: ' + n);
  }
  const rows = id === CELL_SURFACE_FINAL_V0 ? V0_CELLS : v2r2CellsForN(n);
  const locatorCells = buildLocatorCells(rows);
  const painted = locatorCells.map((cell) => ({ i: cell.i, j: cell.j }));

  // format 15 · reference 12 는 autoplace 유도 — 손 좌표표 금지 (c0e7321 계약).
  const placed = placeReservedCells(n, painted);
  const format = placed.formatCells;
  const reference = placed.referenceCells;

  const locatorKeys = new Set(painted.map((cell) => cellKey(cell.i, cell.j)));
  for (const cell of [...format, ...reference]) {
    if (locatorKeys.has(cellKey(cell.i, cell.j))) {
      throw new Error(id + '@n=' + n + ': autoplace 산출이 파인더와 겹친다: ' + cellKey(cell.i, cell.j));
    }
  }

  const declared = DECLARED_DATA_BY_N[n];
  const dataCells = n * n - locatorCells.length - reference.length - format.length;
  if (dataCells !== declared) {
    throw new Error(
      id + '@n=' + n + ': ' + n + '² − painted(' + locatorCells.length + ') − 12 − 15 = '
      + dataCells + ' 이 선언 data ' + declared + ' 와 다르다',
    );
  }

  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;

  return Object.freeze({
    id,
    profile: CELL_SURFACE_FINAL_PROFILE[id],
    n,
    version: versionForFinalN(n),
    locatorCells,
    locatorCount: locatorCells.length,
    paintedCells: Object.freeze(painted.map((cell) => Object.freeze({ i: cell.i, j: cell.j }))),
    formatCells: format,
    referenceCells: reference,
    referenceGroups: placed.referenceGroups,
    autoplace: placed.metrics,
    declaredDataCells: declared,
    usedSymbols,
    residualCells,
    nsym: nsymTable(usedSymbols),
    formatIndex: CELL_SURFACE_FINAL_FORMAT_INDEX,
  });
}

const SURFACES = Object.freeze({
  13: buildFinalSurface(13),
  21: buildFinalSurface(21),
  25: buildFinalSurface(25),
});

/** n → 최종 셀 표면 인스턴스 (동결 캐시 — autoplace 는 로드 시 1회). */
export function cellSurfaceFinal(n) {
  const surface = SURFACES[n];
  if (!surface) {
    throw new RangeError('셀 표면 최종 라인업의 n 은 13 | 21 | 25 다: ' + n);
  }
  return surface;
}

export function nameCellSurfaceFinal(n, tones) {
  const surface = cellSurfaceFinal(n);
  const suffix = assertCellSurfaceFinalTones(tones) === 3 ? 'T' : '';
  return 'Y' + surface.version + suffix + '-CS-' + surface.id.toUpperCase();
}

export function locatorCellsCellSurfaceFinal(n) {
  return cellSurfaceFinal(n).locatorCells;
}

export function paintedCellsCellSurfaceFinal(n) {
  return cellSurfaceFinal(n).paintedCells;
}

export function formatCellsCellSurfaceFinal(n) {
  return cellSurfaceFinal(n).formatCells;
}

export function referenceCellsCellSurfaceFinal(n) {
  return cellSurfaceFinal(n).referenceCells;
}

export function locatorToneCellSurfaceFinal(n, face, i, j) {
  if (!FACES.includes(face)) throw new RangeError('면 라벨은 T | L | R 이어야 한다: ' + face);
  for (const cell of cellSurfaceFinal(n).locatorCells) {
    if (cell.i === i && cell.j === j) return cell[face];
  }
  return 1;
}

export function dataCellsInScanOrderCellSurfaceFinal(n) {
  const surface = cellSurfaceFinal(n);
  const blocked = new Set([
    ...surface.locatorCells.map((cell) => cellKey(cell.i, cell.j)),
    ...surface.formatCells.map((cell) => cellKey(cell.i, cell.j)),
    ...surface.referenceCells.map((cell) => cellKey(cell.i, cell.j)),
  ]);
  const out = [];
  for (let j = 0; j < surface.n; j += 1) {
    for (let i = 0; i < surface.n; i += 1) {
      if (!blocked.has(cellKey(i, j))) out.push({ i, j });
    }
  }
  if (out.length !== surface.declaredDataCells) {
    throw new Error(
      surface.id + '@n=' + n + ': scan data ' + out.length
      + ' !== 선언 ' + surface.declaredDataCells,
    );
  }
  return out;
}

export function fillerCellsCellSurfaceFinal(n) {
  const scan = dataCellsInScanOrderCellSurfaceFinal(n);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

export function layoutMapCellSurfaceFinal(n) {
  const surface = cellSurfaceFinal(n);
  const map = new Map();
  surface.locatorCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'locator', index });
  });
  surface.referenceCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'reference', index });
  });
  surface.formatCells.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'format', index });
  });
  dataCellsInScanOrderCellSurfaceFinal(n).forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'data', index });
  });
  return map;
}

function nsymForLevel(surface, level) {
  const nsym = surface.nsym[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError(surface.id + '@n=' + surface.n + ' 에 없는 ECC 레벨: ' + level);
  }
  return nsym;
}

export function capacityForCellSurfaceFinal(n, level = 'M', tones = 2) {
  const surface = cellSurfaceFinal(n);
  const resolvedTones = assertCellSurfaceFinalTones(tones);
  const nsym = nsymForLevel(surface, level);
  const dataSymbols = surface.usedSymbols - nsym;
  const dataBytes = maxBytesForSymbols(dataSymbols);
  return {
    name: nameCellSurfaceFinal(n, resolvedTones),
    version: surface.version,
    n: surface.n,
    tones: resolvedTones,
    formatIndex: CELL_SURFACE_FINAL_FORMAT_INDEX[resolvedTones],
    cellSurface: true,
    cellSurfaceLayout: surface.id,
    locatorProfile: surface.profile,
    totalCells: surface.n * surface.n,
    overhead: surface.locatorCount + surface.formatCells.length + surface.referenceCells.length,
    locator: surface.locatorCount,
    format: surface.formatCells.length,
    reference: surface.referenceCells.length,
    dataCells: surface.declaredDataCells,
    usedSymbols: surface.usedSymbols,
    residualCells: surface.residualCells,
    level,
    nsym,
    errorCapacity: errorCapacity(nsym),
    dataSymbols,
    dataBytes,
    maxPayloadBytes: maxPayloadFor(dataBytes),
    headerBytes: HEADER_BYTES,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증 — 조용히 시프트하지 않는다.
// ─────────────────────────────────────────────────────────────────────────
{
  // ① 정본 셀 수 — v0 30 · v2r2 65 (블록 A 16 + B 49).
  if (V0_CELLS.length !== 30) throw new Error('v0 정본이 30셀이 아니다: ' + V0_CELLS.length);
  if (V2R2_BASE_CELLS.length !== 65) {
    throw new Error('v2r2 정본이 65셀이 아니다: ' + V2R2_BASE_CELLS.length);
  }
  {
    let inA = 0;
    let inB = 0;
    for (const [i, j] of V2R2_BASE_CELLS) {
      if (i <= 3 && j <= 3) inA += 1;
      else if (i >= 4 && j >= 4) inB += 1;
    }
    if (inA !== 16 || inB !== 49) {
      throw new Error('v2r2 블록 분할이 A16/B49 가 아니다: A=' + inA + ' B=' + inB);
    }
  }

  // ② formatIndex 쌍 불변식 + cube 축 기사용 슬롯 전수 대조 (겹치면 로드 시 throw).
  if (CELL_SURFACE_FINAL_FORMAT_INDEX[3] !== CELL_SURFACE_FINAL_FORMAT_INDEX[2] + 2) {
    throw new Error('신세대 셀 표면 3톤 formatIndex 는 2톤 + 2 이어야 한다');
  }
  {
    const used = new Set(VERSIONS_Y.map((spec) => spec.formatIndex));
    used.add(LEGACY_CS_INDEX_2T);
    used.add(LEGACY_CS_INDEX_3T);
    for (const draftId of DRAFT_LAYOUT_IDS) {
      const table = DRAFT_LAYOUT_FORMAT_INDEX[draftId];
      used.add(table[2]);
      used.add(table[3]);
    }
    for (const index of [CELL_SURFACE_FINAL_FORMAT_INDEX[2], CELL_SURFACE_FINAL_FORMAT_INDEX[3]]) {
      if (used.has(index)) {
        throw new Error(
          '신세대 셀 표면 formatIndex ' + index + ' 가 cube 축 기사용 슬롯과 겹친다: '
          + [...used].sort((a, b) => a - b).join(','),
        );
      }
      if (!Number.isInteger(index) || index < 0 || index > 15) {
        throw new Error('formatIndex ' + index + ' 가 4bit 범위를 벗어난다');
      }
    }
  }

  // ③ 세 인스턴스 회계 — 사용 심볼·잔여 셀이 확정 수치와 일치해야 한다.
  const expected = {
    13: { symbols: 37, residual: 1, locator: 30 },
    21: { symbols: 116, residual: 1, locator: 65 },
    25: { symbols: 177, residual: 2, locator: 65 },
  };
  for (const n of [13, 21, 25]) {
    const surface = cellSurfaceFinal(n);
    const want = expected[n];
    if (surface.locatorCount !== want.locator) {
      throw new Error('n=' + n + ' locator ' + surface.locatorCount + ' !== ' + want.locator);
    }
    if (surface.usedSymbols !== want.symbols || surface.residualCells !== want.residual) {
      throw new Error(
        'n=' + n + ' 회계 불일치: S=' + surface.usedSymbols + '/' + want.symbols
        + ' 잔여=' + surface.residualCells + '/' + want.residual,
      );
    }
    const scan = dataCellsInScanOrderCellSurfaceFinal(n);
    if (scan.length !== surface.declaredDataCells) {
      throw new Error('n=' + n + ': data 선언과 scan 이 어긋난다');
    }
  }
}
