/**
 * cellSurfaceY.js — Type Y 시험판 프로파일 cell-surface-v1 (Y1 / Y1T 공용 locator)
 *
 * 사용자가 /lab/ 셀 편집기로 칠한 61좌표 코너 패턴은 dark/bright 두 단계만 쓴다.
 * 같은 시각 locator 를 2톤(Y1-CS)과 3톤(Y1T-CS) 데이터가 공유하고, 와이어는
 * formatIndex 로만 가른다(3톤 = 2톤 + 2). 용량 회계는 톤 무관이다.
 * 기본 encodeY() 와 VERSIONS_Y 와이어는 바꾸지 않는다.
 *
 * 런타임 의존성 0 · 순수 ESM (node: API 금지, Math.random/Date 금지).
 */

import { maxBytesForSymbols } from './capacity.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { VERSIONS_Y } from './capacityY.js';
import {
  CELL_EDITOR_SCHEMA,
  DEFAULT_CELL_TONE,
  TONE_LEVELS,
  coordKey,
  createCellEditorState,
  serializeCellEditor,
  toneKey,
} from './type-y-cell-editor.js';
import {
  formatCells as legacyFormatCells,
  referenceCellsAll,
} from './placementY.js';

export const CELL_SURFACE_PROFILE_ID = 'cell-surface-v1';
export const CELL_SURFACE_N = 21;
export const CELL_SURFACE_VERSION = 1;
export const CELL_SURFACE_NAME_2T = 'Y1-CS';
export const CELL_SURFACE_NAME_3T = 'Y1T-CS';
/** @deprecated 3톤 이름. 신규 코드는 nameCellSurface(tones) 를 쓴다. */
export const CELL_SURFACE_NAME = CELL_SURFACE_NAME_3T;

/**
 * cube 패밀리 미사용 슬롯. 기존 T 변형 불변식(3톤 = 2톤 + 2)을 따른다.
 * VERSIONS_Y 사용분 {0,2,8,9,10,11} 과 겹치지 않음을 로드 시 검증한다.
 * 12/14 는 tri A1/A1Q 와 숫자가 같지만 cube 축(finder=null)이라 분리된다.
 */
export const CELL_SURFACE_FORMAT_INDEX_2T = 12;
export const CELL_SURFACE_FORMAT_INDEX_3T = 14;
/** @deprecated 2톤 index. 신규 코드는 formatIndexCellSurface(tones) 를 쓴다. */
export const CELL_SURFACE_FORMAT_INDEX = CELL_SURFACE_FORMAT_INDEX_2T;

export const CELL_SURFACE_LOCATOR_COUNT = 61;
export const CELL_SURFACE_FORMAT_COUNT = 15;
export const CELL_SURFACE_DATA_CELLS = 365;
export const CELL_SURFACE_USED_SYMBOLS = 121;
export const CELL_SURFACE_RESIDUAL_CELLS = 2;

export const NSYM_TABLE_CELL_SURFACE_Y = Object.freeze({
  symbols: CELL_SURFACE_USED_SYMBOLS,
  L: 15,
  M: 31,
  H: 48,
});

const FACES = Object.freeze(['T', 'L', 'R']);
const R_ASYMMETRY = Object.freeze([
  Object.freeze({ i: 0, j: 3 }),
  Object.freeze({ i: 1, j: 3 }),
  Object.freeze({ i: 2, j: 3 }),
]);

/** 사용자가 데이터에서 뺀 47좌표 (편집기 userNonData). */
const USER_NON_DATA_SPEC = Object.freeze([
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 17], [0, 18], [0, 19], [0, 20],
  [1, 0], [1, 1], [1, 17], [1, 18], [1, 19], [1, 20],
  [2, 0], [2, 4], [2, 20],
  [3, 0], [3, 3], [3, 4], [3, 19], [3, 20],
  [4, 0], [4, 2], [4, 3], [4, 4],
  [17, 0], [17, 1], [17, 20],
  [18, 0], [18, 1], [18, 20],
  [19, 0], [19, 1], [19, 3], [19, 17], [19, 19], [19, 20],
  [20, 0], [20, 1], [20, 2], [20, 3], [20, 17], [20, 18], [20, 19], [20, 20],
]);

/** T/L 61개 톤. R 은 이 표와 같되 (0,3)(1,3)(2,3) 만 2. */
const TL_TONE_SPEC = Object.freeze([
  [0, 0, 0], [0, 1, 0], [0, 2, 2], [0, 3, 0], [0, 4, 2], [0, 17, 2], [0, 18, 0], [0, 19, 0], [0, 20, 0],
  [1, 0, 0], [1, 1, 0], [1, 2, 2], [1, 3, 0], [1, 4, 2], [1, 17, 2], [1, 18, 2], [1, 19, 2], [1, 20, 0],
  [2, 0, 2], [2, 1, 2], [2, 2, 2], [2, 3, 0], [2, 4, 2], [2, 19, 2], [2, 20, 0],
  [3, 0, 0], [3, 1, 0], [3, 2, 0], [3, 3, 0], [3, 4, 2], [3, 19, 2], [3, 20, 2],
  [4, 0, 2], [4, 1, 2], [4, 2, 2], [4, 3, 2], [4, 4, 2],
  [17, 0, 2], [17, 1, 2], [17, 19, 2], [17, 20, 2],
  [18, 0, 0], [18, 1, 2], [18, 19, 2], [18, 20, 0],
  [19, 0, 0], [19, 1, 2], [19, 2, 2], [19, 3, 2], [19, 17, 2], [19, 18, 2], [19, 19, 2], [19, 20, 0],
  [20, 0, 0], [20, 1, 0], [20, 2, 0], [20, 3, 2], [20, 17, 2], [20, 18, 0], [20, 19, 0], [20, 20, 0],
]);

function cellKey(i, j) {
  return i + ',' + j;
}

export function assertCellSurfaceTones(tones) {
  if (tones !== 2 && tones !== 3) {
    throw new RangeError('cell-surface-v1 tones 는 2 또는 3 이어야 한다: ' + tones);
  }
  return tones;
}

export function formatIndexCellSurface(tones) {
  return assertCellSurfaceTones(tones) === 3
    ? CELL_SURFACE_FORMAT_INDEX_3T
    : CELL_SURFACE_FORMAT_INDEX_2T;
}

export function nameCellSurface(tones) {
  return assertCellSurfaceTones(tones) === 3
    ? CELL_SURFACE_NAME_3T
    : CELL_SURFACE_NAME_2T;
}

export function isCellSurfaceFormatIndex(index) {
  return index === CELL_SURFACE_FORMAT_INDEX_2T || index === CELL_SURFACE_FORMAT_INDEX_3T;
}

export function tonesFromCellSurfaceFormatIndex(index) {
  if (index === CELL_SURFACE_FORMAT_INDEX_2T) return 2;
  if (index === CELL_SURFACE_FORMAT_INDEX_3T) return 3;
  throw new RangeError('cell-surface-v1 formatIndex 는 12 또는 14 이어야 한다: ' + index);
}

function buildLocatorCells() {
  const cells = [];
  const seen = new Set();
  for (const [i, j, toneTL] of TL_TONE_SPEC) {
    const key = cellKey(i, j);
    if (seen.has(key)) {
      throw new Error('locator 좌표 중복: ' + key);
    }
    seen.add(key);
    const asymmetric = R_ASYMMETRY.some((cell) => cell.i === i && cell.j === j);
    cells.push(Object.freeze({
      i,
      j,
      T: toneTL,
      L: toneTL,
      R: asymmetric ? 2 : toneTL,
    }));
  }
  cells.sort((a, b) => a.i - b.i || a.j - b.j);
  return Object.freeze(cells);
}

export const CELL_SURFACE_LOCATOR_CELLS = buildLocatorCells();

const LOCATOR_KEY_SET = new Set(
  CELL_SURFACE_LOCATOR_CELLS.map((cell) => cellKey(cell.i, cell.j)),
);

const TONE_BY_FACE = Object.freeze({
  T: Object.freeze(Object.fromEntries(
    CELL_SURFACE_LOCATOR_CELLS.map((cell) => [cellKey(cell.i, cell.j), cell.T]),
  )),
  L: Object.freeze(Object.fromEntries(
    CELL_SURFACE_LOCATOR_CELLS.map((cell) => [cellKey(cell.i, cell.j), cell.L]),
  )),
  R: Object.freeze(Object.fromEntries(
    CELL_SURFACE_LOCATOR_CELLS.map((cell) => [cellKey(cell.i, cell.j), cell.R]),
  )),
});

/**
 * format 15셀. locator 61 과 겹치지 않는 내부 좌표, 복제 3개를 공간 분산.
 *
 *   복제 0 = (8,6)..(12,6)   — 상단 내부 가로
 *   복제 1 = (6,8)..(6,12)   — 좌측 내부 세로
 *   복제 2 = (8,14)..(12,14) — 하단 내부 가로
 */
export const CELL_SURFACE_FORMAT_CELLS = Object.freeze((() => {
  const cells = [];
  for (let i = 8; i <= 12; i += 1) cells.push(Object.freeze({ i, j: 6 }));
  for (let j = 8; j <= 12; j += 1) cells.push(Object.freeze({ i: 6, j }));
  for (let i = 8; i <= 12; i += 1) cells.push(Object.freeze({ i, j: 14 }));
  return cells;
})());

export const CELL_SURFACE_USER_NON_DATA = Object.freeze(
  USER_NON_DATA_SPEC.map(([i, j]) => Object.freeze({ i, j })),
);

export function isCellSurfaceLocator(i, j) {
  return LOCATOR_KEY_SET.has(cellKey(i, j));
}

export function locatorTone(face, i, j) {
  const table = TONE_BY_FACE[face];
  if (!table) throw new RangeError('면 라벨은 T | L | R 이어야 한다: ' + face);
  const tone = table[cellKey(i, j)];
  return tone === undefined ? DEFAULT_CELL_TONE : tone;
}

export function formatCellsCellSurface() {
  return CELL_SURFACE_FORMAT_CELLS;
}

export function locatorCellsCellSurface() {
  return CELL_SURFACE_LOCATOR_CELLS;
}

export function buildRoleSetsCellSurface() {
  const locator = new Set(LOCATOR_KEY_SET);
  const format = new Set(CELL_SURFACE_FORMAT_CELLS.map((cell) => cellKey(cell.i, cell.j)));
  return { locator, format };
}

export function roleOfCellSurface(i, j, roleSets) {
  const sets = roleSets || buildRoleSetsCellSurface();
  const key = cellKey(i, j);
  if (sets.locator.has(key)) return 'locator';
  if (sets.format.has(key)) return 'format';
  return 'data';
}

export function dataCellsInScanOrderCellSurface() {
  const roleSets = buildRoleSetsCellSurface();
  const out = [];
  for (let j = 0; j < CELL_SURFACE_N; j += 1) {
    for (let i = 0; i < CELL_SURFACE_N; i += 1) {
      if (roleOfCellSurface(i, j, roleSets) === 'data') out.push({ i, j });
    }
  }
  return out;
}

export function fillerCellsCellSurface() {
  const scan = dataCellsInScanOrderCellSurface();
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

export function layoutMapCellSurface() {
  const map = new Map();
  CELL_SURFACE_LOCATOR_CELLS.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'locator', index });
  });
  CELL_SURFACE_FORMAT_CELLS.forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'format', index });
  });
  dataCellsInScanOrderCellSurface().forEach((cell, index) => {
    map.set(cellKey(cell.i, cell.j), { role: 'data', index });
  });
  return map;
}

function nsymForLevel(level) {
  const nsym = NSYM_TABLE_CELL_SURFACE_Y[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError('cell-surface-v1 에 없는 ECC 레벨: ' + level);
  }
  return nsym;
}

export function capacityForCellSurfaceY(level = 'M', tones = 2) {
  const resolvedTones = assertCellSurfaceTones(tones);
  const totalCells = CELL_SURFACE_N * CELL_SURFACE_N;
  const overhead = CELL_SURFACE_LOCATOR_COUNT + CELL_SURFACE_FORMAT_COUNT;
  const dataCells = totalCells - overhead;
  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;
  if (usedSymbols !== NSYM_TABLE_CELL_SURFACE_Y.symbols) {
    throw new RangeError(
      'cell-surface-v1: 실계산 사용 심볼 ' + usedSymbols
      + ' 이 NSYM_TABLE_CELL_SURFACE_Y.symbols('
      + NSYM_TABLE_CELL_SURFACE_Y.symbols + ') 과 어긋난다',
    );
  }
  const nsym = nsymForLevel(level);
  const dataSymbols = usedSymbols - nsym;
  const dataBytes = maxBytesForSymbols(dataSymbols);
  return {
    name: nameCellSurface(resolvedTones),
    version: CELL_SURFACE_VERSION,
    n: CELL_SURFACE_N,
    tones: resolvedTones,
    formatIndex: formatIndexCellSurface(resolvedTones),
    cellSurface: true,
    locatorProfile: CELL_SURFACE_PROFILE_ID,
    totalCells,
    overhead,
    locator: CELL_SURFACE_LOCATOR_COUNT,
    format: CELL_SURFACE_FORMAT_COUNT,
    dataCells,
    usedSymbols,
    residualCells,
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

export function isCellSurfaceCompatibleY(version, tones) {
  return version === CELL_SURFACE_VERSION && (tones === 2 || tones === 3);
}

/**
 * 편집기 JSON 정본. 47 userNonData + 183 toneOverrides (61×3, 전부 mid 가 아님).
 */
export function canonicalCellEditorDocument() {
  const state = createCellEditorState(CELL_SURFACE_N);
  for (const { i, j } of CELL_SURFACE_USER_NON_DATA) {
    state.userNonData.add(coordKey(i, j));
  }
  for (const cell of CELL_SURFACE_LOCATOR_CELLS) {
    for (const face of FACES) {
      const tone = cell[face];
      if (tone !== DEFAULT_CELL_TONE) {
        state.tones.set(toneKey(face, cell.i, cell.j), tone);
      }
    }
  }
  return serializeCellEditor(state);
}

export function expectedEditorToneLevels() {
  return { 0: TONE_LEVELS[0], 1: TONE_LEVELS[1], 2: TONE_LEVELS[2] };
}

export { CELL_EDITOR_SCHEMA };

// 모듈 로드 시점 자기검증 — 조용히 시프트하지 않는다.
{
  if (CELL_SURFACE_LOCATOR_CELLS.length !== CELL_SURFACE_LOCATOR_COUNT) {
    throw new Error('locator 61좌표가 아니다: ' + CELL_SURFACE_LOCATOR_CELLS.length);
  }
  if (CELL_SURFACE_USER_NON_DATA.length !== 47) {
    throw new Error('userNonData 47좌표가 아니다: ' + CELL_SURFACE_USER_NON_DATA.length);
  }
  if (CELL_SURFACE_FORMAT_CELLS.length !== CELL_SURFACE_FORMAT_COUNT) {
    throw new Error('format 15셀이 아니다: ' + CELL_SURFACE_FORMAT_CELLS.length);
  }

  const formatKeys = new Set();
  for (const cell of CELL_SURFACE_FORMAT_CELLS) {
    const key = cellKey(cell.i, cell.j);
    if (LOCATOR_KEY_SET.has(key)) {
      throw new Error('format 이 locator 와 겹친다: ' + key);
    }
    if (formatKeys.has(key)) throw new Error('format 좌표 중복: ' + key);
    if (cell.i < 1 || cell.i > CELL_SURFACE_N - 2 || cell.j < 1 || cell.j > CELL_SURFACE_N - 2) {
      throw new Error('format 셀이 내부 inset 을 벗어난다: ' + key);
    }
    formatKeys.add(key);
  }

  const dataCells = dataCellsInScanOrderCellSurface();
  if (dataCells.length !== CELL_SURFACE_DATA_CELLS) {
    throw new Error('data 365가 아니다: ' + dataCells.length);
  }
  if (dataCells.length % 3 !== CELL_SURFACE_RESIDUAL_CELLS) {
    throw new Error('잔여 셀이 2가 아니다');
  }

  const used = usedCubeFormatIndices();
  for (const index of [CELL_SURFACE_FORMAT_INDEX_2T, CELL_SURFACE_FORMAT_INDEX_3T]) {
    if (used.includes(index)) {
      throw new Error(
        'cell-surface formatIndex ' + index
        + ' 가 cube VERSIONS_Y 와 겹친다: ' + used.join(','),
      );
    }
  }
  if (CELL_SURFACE_FORMAT_INDEX_3T !== CELL_SURFACE_FORMAT_INDEX_2T + 2) {
    throw new Error('cell-surface 3톤 formatIndex 는 2톤 + 2 이어야 한다');
  }

  const S = CELL_SURFACE_USED_SYMBOLS;
  const expectedL = Math.round(0.12 * S);
  let expectedM = Math.round(0.25 * S);
  if (expectedM % 2 === 0) expectedM += 1;
  const expectedH = Math.round(0.40 * S);
  if (NSYM_TABLE_CELL_SURFACE_Y.L !== expectedL
    || NSYM_TABLE_CELL_SURFACE_Y.M !== expectedM
    || NSYM_TABLE_CELL_SURFACE_Y.H !== expectedH) {
    throw new Error('cell-surface ECC 표가 현행 산출 규칙과 어긋난다');
  }

  const legacyOverlap = new Set();
  for (const cell of [...referenceCellsAll(CELL_SURFACE_N, 3), ...legacyFormatCells(CELL_SURFACE_N)]) {
    if (LOCATOR_KEY_SET.has(cellKey(cell.i, cell.j))) {
      legacyOverlap.add(cellKey(cell.i, cell.j));
    }
  }
  if (legacyOverlap.size !== 14) {
    throw new Error('현행 reference/format 과 locator 겹침이 14가 아니다: ' + legacyOverlap.size);
  }
}
