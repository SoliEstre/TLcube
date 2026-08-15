/**
 * cell-editor-core.js — TLcube 다중 타입 셀 & 파인더 편집기 순수 엔진
 *
 * 지원 타입:
 *   - Type Y: 아이소메트릭 큐브 격자 (n x n, T/L/R 면)
 *   - Type O: 육각 축 격자 (반경 k, 중앙 19셀 파인더 모드 또는 전체 셀 표면 모드)
 *   - Type A: 삼각 실루엣 격자 (육각 코어 + 코너 패치 3개)
 *   - Type K: 육망성 실루엣 격자 (설계 초안 / 육각 코어 + 코너 패치 6개)
 *
 * 지원 도구:
 *   - Brush (붓): 클릭 및 연속 드래그로 면/셀 채색
 *   - Bucket (페인트통): 연결된 동일 톤/상태 영역 플러드 필
 *   - Eraser (지우개): 기본 톤(1: mid) 복원 및 비데이터 해제
 *   - Eyedropper (스포이드): 대상 톤 추출
 *   - Undo / Redo: 전체 히스토리 스택 관리 (Ctrl+Z / Ctrl+Shift+Z)
 *   - 120° 회전 및 톤 반전
 *   - tlcube-y-cell-editor/v1 및 tlcube-cell-editor/v2 스키마 양방향 직렬화
 *
 * 런타임 의존성 0 · 순수 ESM.
 */

import {
  DEFAULT_LAYOUT,
  FACES,
  faceCentroid,
  hexDistance,
} from './hexgrid.js';
import {
  bandRadii,
} from './bullseye.js';
import {
  buildRoleSets as buildRoleSetsY,
  roleOf as roleOfY,
} from './placementY.js';
import {
  BULLSEYE_RADIUS,
  buildRoleSets as buildRoleSetsO,
  roleOf as roleOfO,
  rotate120 as rotate120Axial,
  rotate240 as rotate240Axial,
} from './placement.js';
import {
  buildRoleSetsA,
  isInRegionA,
  patchOfA,
  roleOfA,
} from './placementA.js';
import {
  FINDER_CELL_ORDER,
  FINDER_FACE_BITS,
  FINDER_PATTERNS,
  getFinderPattern,
} from './finder-patterns.js';
import {
  cloneFinderEditorPattern,
  serializeFinderEditorPattern,
} from './finder-editor-pattern.js';

export function bullseyeCellMasks() {
  const radii = bandRadii(1);
  return FINDER_CELL_ORDER.map((cell) => {
    let mask = 0;
    for (const face of FACES) {
      const point = faceCentroid(cell.q, cell.r, face, DEFAULT_LAYOUT);
      const distance = Math.hypot(point.x, point.y);
      const band = radii.findIndex((radius) => distance <= radius + 1e-9);
      if (band >= 0 && band % 2 === 1) mask |= FINDER_FACE_BITS[face];
    }
    return mask;
  });
}

export const CELL_EDITOR_SCHEMA_V1 = 'tlcube-y-cell-editor/v1';
export const CELL_EDITOR_SCHEMA_V2 = 'tlcube-cell-editor/v2';

export const CELL_TYPES = Object.freeze(['Y', 'O', 'A', 'K']);
export const DEFAULT_CELL_TYPE = 'Y';

export const EDIT_MODES = Object.freeze(['tone', 'mask']);
export const DEFAULT_EDIT_MODE = 'tone';

export const EDIT_TOOLS = Object.freeze(['brush', 'bucket', 'eraser', 'dropper']);
export const DEFAULT_EDIT_TOOL = 'brush';

export const FINDER_MODES = Object.freeze(['central-finder', 'full-surface']);
export const DEFAULT_FINDER_MODE = 'central-finder';

export const DEFAULT_TONE = 1;
export const TONE_LEVELS = Object.freeze({
  0: 'dark',
  1: 'mid',
  2: 'bright',
});

export const BOUNDARY_EDGES = Object.freeze(['i+', 'i-', 'j+', 'j-']);

export const TYPE_Y_SIZES = Object.freeze([11, 13, 21, 25]);
export const DEFAULT_SIZE_Y = 11;

export const TYPE_HEX_SIZES = Object.freeze([4, 6, 8, 10]);
export const DEFAULT_SIZE_HEX = 4;

export const BULLSEYE_STARTER_ID = 'bullseye';
export const DEFAULT_FINDER_STARTER = BULLSEYE_STARTER_ID;

const FACE_ORDER = Object.freeze({ T: 0, L: 1, R: 2 });
const CUBE_OVERLAY_KINDS = Object.freeze(['three-tone-cube', 'cube-bullseye']);

export function defaultSizeForType(type) {
  return assertType(type) === 'Y' ? DEFAULT_SIZE_Y : DEFAULT_SIZE_HEX;
}

export function finderOverlayKind(pattern) {
  if (!pattern) return null;
  return CUBE_OVERLAY_KINDS.includes(pattern.renderKind) ? pattern.renderKind : null;
}

function assertToneRanks(toneRanks) {
  if (toneRanks === null || typeof toneRanks !== 'object') {
    throw new TypeError('toneRanks는 객체여야 한다');
  }
  const ranks = FACES.map((face) => toneRanks[face]);
  if (ranks.slice().sort((a, b) => a - b).join(',') !== '0,1,2') {
    throw new RangeError('toneRanks는 0/1/2 순열이어야 한다');
  }
}

/** cell-mask / 3톤 큐브 / 하이브리드를 에디터가 소유할 가변 사본으로 바꾼다. */
export function cloneCellEditorFinderPattern(pattern) {
  if (pattern === null || typeof pattern !== 'object') {
    throw new TypeError('파인더 패턴 객체가 필요하다');
  }
  const renderKind = pattern.renderKind || 'cell-mask';
  if (renderKind === 'cube-bullseye') {
    assertToneRanks(pattern.toneRanks);
    return {
      renderKind,
      toneRanks: { T: pattern.toneRanks.T, L: pattern.toneRanks.L, R: pattern.toneRanks.R },
    };
  }
  return cloneFinderEditorPattern(pattern);
}

export function serializeCellEditorFinderPattern(pattern) {
  const copy = cloneCellEditorFinderPattern(pattern);
  if (copy.renderKind === 'cube-bullseye') {
    return [
      'renderKind: "cube-bullseye",',
      `toneRanks: { T: ${copy.toneRanks.T}, L: ${copy.toneRanks.L}, R: ${copy.toneRanks.R} },`,
    ].join('\n');
  }
  return serializeFinderEditorPattern(copy);
}

export function listFinderStarters() {
  const seen = new Set();
  const starters = [];
  const add = (id, renderKind) => {
    if (seen.has(id)) return;
    seen.add(id);
    starters.push({ id, renderKind });
  };
  add(BULLSEYE_STARTER_ID, 'cell-mask');
  for (const pattern of FINDER_PATTERNS) {
    add(pattern.id, pattern.renderKind || 'cell-mask');
  }
  return starters;
}

export function resolveFinderStarter(starterId) {
  const id = starterId || DEFAULT_FINDER_STARTER;
  if (id === BULLSEYE_STARTER_ID) {
    return {
      id,
      renderKind: 'cell-mask',
      pattern: { renderKind: 'cell-mask', cellMasks: bullseyeCellMasks() },
    };
  }
  try {
    const patternDef = getFinderPattern(id);
    const pattern = cloneCellEditorFinderPattern(patternDef);
    return { id, renderKind: pattern.renderKind, pattern };
  } catch {
    return {
      id: BULLSEYE_STARTER_ID,
      renderKind: 'cell-mask',
      pattern: { renderKind: 'cell-mask', cellMasks: bullseyeCellMasks() },
    };
  }
}

export function applyFinderStarter(state, starterId) {
  const resolved = resolveFinderStarter(starterId);
  state.finderStarter = resolved.id;
  if (state.type === 'Y') {
    state.finderPattern = null;
    return null;
  }
  state.finderPattern = resolved.pattern;
  return resolved.pattern;
}

function rotateMaskBits120(mask) {
  let next = 0;
  if (mask & FINDER_FACE_BITS.T) next |= FINDER_FACE_BITS.R;
  if (mask & FINDER_FACE_BITS.R) next |= FINDER_FACE_BITS.L;
  if (mask & FINDER_FACE_BITS.L) next |= FINDER_FACE_BITS.T;
  return next;
}

export function rotateFinderPattern120(pattern) {
  if (!pattern) return null;
  const copy = cloneCellEditorFinderPattern(pattern);
  if (copy.renderKind === 'three-tone-cube' || copy.renderKind === 'cube-bullseye') {
    copy.toneRanks = {
      T: pattern.toneRanks.L,
      R: pattern.toneRanks.T,
      L: pattern.toneRanks.R,
    };
    return copy;
  }
  const newMasks = new Array(FINDER_CELL_ORDER.length);
  for (let i = 0; i < FINDER_CELL_ORDER.length; i += 1) {
    const cell = FINDER_CELL_ORDER[i];
    const rotated = rotate120Axial(cell.q, cell.r);
    const dest = FINDER_CELL_ORDER.findIndex(
      (candidate) => candidate.q === rotated.q && candidate.r === rotated.r,
    );
    if (dest >= 0) newMasks[dest] = rotateMaskBits120(copy.cellMasks[i]);
  }
  copy.cellMasks = newMasks;
  return copy;
}

function assertType(type) {
  if (!CELL_TYPES.includes(type)) {
    throw new RangeError(`지원하지 않는 타입: ${type}`);
  }
  return type;
}

function assertTone(tone) {
  if (!Number.isInteger(tone) || tone < 0 || tone > 2) {
    throw new RangeError(`톤은 0 | 1 | 2 여야 한다: ${tone}`);
  }
  return tone;
}

function assertFace(face) {
  if (!FACES.includes(face)) {
    throw new RangeError(`면은 T | L | R 이어야 한다: ${face}`);
  }
  return face;
}

// ─────────────────────────────────────────────────────────────────────────────
// 좌표 키 및 톤 키 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

export function coordKey(type, c) {
  if (type === 'Y') {
    return `${c.i},${c.j}`;
  }
  return `${c.q},${c.r}`;
}

export function parseCoordKey(type, key) {
  const parts = key.split(',').map(Number);
  if (type === 'Y') {
    return { i: parts[0], j: parts[1] };
  }
  return { q: parts[0], r: parts[1] };
}

export function toneKey(type, face, c) {
  return `${face}:${coordKey(type, c)}`;
}

export function parseToneKey(type, key) {
  const colon = key.indexOf(':');
  if (colon < 0) throw new RangeError(`잘못된 톤 키: ${key}`);
  const face = key.slice(0, colon);
  const coord = parseCoordKey(type, key.slice(colon + 1));
  return { face, ...coord };
}

// ─────────────────────────────────────────────────────────────────────────────
// Type K (육망성 / Hexagram Draft) 기하
// ─────────────────────────────────────────────────────────────────────────────

export function isInRegionInvertedA(q, r, k) {
  return q >= -k && r >= -k && (q + r) <= k;
}

export function isInRegionK(q, r, k) {
  return isInRegionA(q, r, k) || isInRegionInvertedA(q, r, k);
}

export function patchOfK(q, r, k) {
  if (!isInRegionK(q, r, k)) return null;
  if (hexDistance(q, r) <= k) return null; // 육각 코어
  if (r < -k) return 'top';
  if (q < -k) return 'BL';
  if (q + r > k) return 'BR';
  if (r > k) return 'bottom';
  if (q > k) return 'TR';
  if (q + r < -k) return 'TL';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 격자 셀 열거 및 역할 판정
// ─────────────────────────────────────────────────────────────────────────────

export function enumerateCells(type, size) {
  assertType(type);
  if (type === 'Y') {
    const cells = [];
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        cells.push({ i, j });
      }
    }
    return cells;
  }
  if (type === 'O') {
    const cells = [];
    const k = size;
    for (let q = -k; q <= k; q += 1) {
      for (let r = -k; r <= k; r += 1) {
        if (hexDistance(q, r) <= k) {
          cells.push({ q, r });
        }
      }
    }
    return cells;
  }
  if (type === 'A') {
    const cells = [];
    const k = size;
    for (let q = -2 * k; q <= k; q += 1) {
      for (let r = -2 * k; r <= k; r += 1) {
        if (isInRegionA(q, r, k)) {
          cells.push({ q, r });
        }
      }
    }
    return cells;
  }
  if (type === 'K') {
    const cells = [];
    const k = size;
    for (let q = -2 * k; q <= 2 * k; q += 1) {
      for (let r = -2 * k; r <= 2 * k; r += 1) {
        if (isInRegionK(q, r, k)) {
          cells.push({ q, r });
        }
      }
    }
    return cells;
  }
  throw new RangeError(`알 수 없는 타입: ${type}`);
}

export function isCenterCell(type, c) {
  if (type === 'Y') return false;
  return hexDistance(c.q, c.r) <= BULLSEYE_RADIUS;
}

export function roleOfCoord(type, size, c, options = {}) {
  const { finderMode = DEFAULT_FINDER_MODE } = options;
  if (type === 'Y') {
    return roleOfY(c.i, c.j, size);
  }
  if (type === 'O') {
    if (finderMode === 'central-finder' && isCenterCell(type, c)) {
      return 'finder';
    }
    if (finderMode === 'full-surface' && isCenterCell(type, c)) {
      return 'data';
    }
    return roleOfO(c.q, c.r, size);
  }
  if (type === 'A') {
    if (finderMode === 'central-finder' && isCenterCell(type, c)) {
      return 'finder';
    }
    if (finderMode === 'full-surface' && isCenterCell(type, c)) {
      return 'data';
    }
    return roleOfA(c.q, c.r, size);
  }
  if (type === 'K') {
    if (finderMode === 'central-finder' && isCenterCell(type, c)) {
      return 'finder';
    }
    if (finderMode === 'full-surface' && isCenterCell(type, c)) {
      return 'data';
    }
    if (hexDistance(c.q, c.r) <= size) {
      return roleOfO(c.q, c.r, size);
    }
    const patch = patchOfK(c.q, c.r, size);
    if (patch) return 'patch-data';
    return 'data';
  }
  return 'data';
}

export function isFixedRole(role) {
  return role === 'reference' || role === 'format' || role === 'anchor' || role === 'finder';
}

// ─────────────────────────────────────────────────────────────────────────────
// 상태 생성 및 저장소
// ─────────────────────────────────────────────────────────────────────────────

export function createUniversalEditorState(options = {}) {
  const type = assertType(options.type || DEFAULT_CELL_TYPE);
  const size = Number.isInteger(options.size) ? options.size : defaultSizeForType(type);
  const finderMode = options.finderMode || (type === 'Y' ? 'full-surface' : DEFAULT_FINDER_MODE);
  const mode = options.mode || DEFAULT_EDIT_MODE;
  const activeTool = options.activeTool || DEFAULT_EDIT_TOOL;
  const activeTone = options.activeTone !== undefined ? options.activeTone : 0;
  const finderStarter = options.finderStarter || DEFAULT_FINDER_STARTER;

  const state = {
    type,
    size,
    finderMode,
    finderStarter,
    mode,
    activeTool,
    activeTone,
    userNonData: new Set(),
    tones: new Map(), // toneKey -> tone (0 | 1 | 2)
    finderPattern: null,
    undoStack: [],
    redoStack: [],
  };
  applyFinderStarter(state, finderStarter);
  return state;
}

export function cloneSnapshot(state) {
  return {
    type: state.type,
    size: state.size,
    finderMode: state.finderMode,
    finderStarter: state.finderStarter,
    userNonData: new Set(state.userNonData),
    tones: new Map(state.tones),
    finderPattern: state.finderPattern ? cloneCellEditorFinderPattern(state.finderPattern) : null,
  };
}

function restoreSnapshotFields(state, snapshot) {
  if (snapshot.type) state.type = snapshot.type;
  if (Number.isInteger(snapshot.size)) state.size = snapshot.size;
  if (snapshot.finderMode) state.finderMode = snapshot.finderMode;
  if (snapshot.finderStarter) state.finderStarter = snapshot.finderStarter;
  state.userNonData = new Set(snapshot.userNonData);
  state.tones = new Map(snapshot.tones);
  state.finderPattern = snapshot.finderPattern
    ? cloneCellEditorFinderPattern(snapshot.finderPattern)
    : null;
}

export function pushUndoSnapshot(state) {
  const snapshot = cloneSnapshot(state);
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 50) {
    state.undoStack.shift();
  }
  state.redoStack.length = 0; // 새 변경 시 redo 초기화
}

export function undo(state) {
  if (state.undoStack.length === 0) return false;
  const currentSnapshot = cloneSnapshot(state);
  state.redoStack.push(currentSnapshot);
  const prev = state.undoStack.pop();
  restoreSnapshotFields(state, prev);
  return true;
}

export function redo(state) {
  if (state.redoStack.length === 0) return false;
  const currentSnapshot = cloneSnapshot(state);
  state.undoStack.push(currentSnapshot);
  const next = state.redoStack.pop();
  restoreSnapshotFields(state, next);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 셀 톤 조회 및 설정
// ─────────────────────────────────────────────────────────────────────────────

export function getCellTone(state, face, c) {
  assertFace(face);
  if (state.type !== 'Y' && state.finderMode === 'central-finder' && isCenterCell(state.type, c)) {
    if (!state.finderPattern) return DEFAULT_TONE;
    if (state.finderPattern.renderKind === 'three-tone-cube'
      || state.finderPattern.renderKind === 'cube-bullseye') {
      return state.finderPattern.toneRanks[face] ?? DEFAULT_TONE;
    }
    if (state.finderPattern.renderKind === 'cell-mask') {
      const cellIndex = FINDER_CELL_ORDER.findIndex(
        (cell) => cell.q === c.q && cell.r === c.r,
      );
      if (cellIndex < 0) return DEFAULT_TONE;
      const mask = state.finderPattern.cellMasks[cellIndex];
      const faceBit = FINDER_FACE_BITS[face];
      return (mask & faceBit) !== 0 ? 2 : 0;
    }
  }
  const key = toneKey(state.type, face, c);
  return state.tones.has(key) ? state.tones.get(key) : DEFAULT_TONE;
}

export function setCellToneDirect(state, face, c, tone) {
  assertFace(face);
  assertTone(tone);
  if (state.type !== 'Y' && state.finderMode === 'central-finder' && isCenterCell(state.type, c)) {
    if (!state.finderPattern) return;
    if (state.finderPattern.renderKind === 'three-tone-cube'
      || state.finderPattern.renderKind === 'cube-bullseye') {
      const current = state.finderPattern.toneRanks[face];
      if (current !== tone) {
        const otherFace = FACES.find((candidate) => state.finderPattern.toneRanks[candidate] === tone);
        if (otherFace) {
          state.finderPattern.toneRanks[otherFace] = current;
        }
        state.finderPattern.toneRanks[face] = tone;
      }
      return;
    }
    if (state.finderPattern.renderKind === 'cell-mask') {
      const cellIndex = FINDER_CELL_ORDER.findIndex(
        (cell) => cell.q === c.q && cell.r === c.r,
      );
      if (cellIndex >= 0) {
        const bit = FINDER_FACE_BITS[face];
        let mask = state.finderPattern.cellMasks[cellIndex];
        if (tone === 2) mask |= bit;
        else mask &= ~bit;
        state.finderPattern.cellMasks[cellIndex] = mask;
      }
      return;
    }
  }

  const key = toneKey(state.type, face, c);
  if (tone === DEFAULT_TONE) {
    state.tones.delete(key);
  } else {
    state.tones.set(key, tone);
  }
}

export function cycleCellTone(tone, direction = 1) {
  assertTone(tone);
  return (tone + direction + 3) % 3;
}

// ─────────────────────────────────────────────────────────────────────────────
// 인접 그래프 (Flood Fill 및 경계 추출용)
// ─────────────────────────────────────────────────────────────────────────────

export function getFaceNeighbors(type, size, face, c) {
  const neighbors = [];
  // 셀 내부 면 간 연결
  for (const otherFace of FACES) {
    if (otherFace !== face) {
      neighbors.push({ face: otherFace, coord: c });
    }
  }

  if (type === 'Y') {
    const { i, j } = c;
    if (face === 'T') {
      if (j > 0) neighbors.push({ face: 'R', coord: { i, j: j - 1 } });
      if (i > 0) neighbors.push({ face: 'L', coord: { i: i - 1, j } });
    } else if (face === 'L') {
      if (j > 0) neighbors.push({ face: 'R', coord: { i, j: j - 1 } });
      if (i + 1 < size) neighbors.push({ face: 'T', coord: { i: i + 1, j } });
    } else if (face === 'R') {
      if (i > 0) neighbors.push({ face: 'L', coord: { i: i - 1, j } });
      if (j + 1 < size) neighbors.push({ face: 'T', coord: { i, j: j + 1 } });
    }
  } else {
    // Axial 좌표 (O, A, K)
    const { q, r } = c;
    const isValid = (nq, nr) => {
      if (type === 'O') return hexDistance(nq, nr) <= size;
      if (type === 'A') return isInRegionA(nq, nr, size);
      if (type === 'K') return isInRegionK(nq, nr, size);
      return false;
    };

    if (face === 'T') {
      if (isValid(q, r - 1)) neighbors.push({ face: 'R', coord: { q, r: r - 1 } });
      if (isValid(q + 1, r - 1)) neighbors.push({ face: 'L', coord: { q: q + 1, r: r - 1 } });
    } else if (face === 'L') {
      if (isValid(q - 1, r + 1)) neighbors.push({ face: 'T', coord: { q: q - 1, r: r + 1 } });
      if (isValid(q - 1, r)) neighbors.push({ face: 'R', coord: { q: q - 1, r } });
    } else if (face === 'R') {
      if (isValid(q, r + 1)) neighbors.push({ face: 'T', coord: { q, r: r + 1 } });
      if (isValid(q + 1, r)) neighbors.push({ face: 'L', coord: { q: q + 1, r } });
    }
  }

  return neighbors;
}

// ─────────────────────────────────────────────────────────────────────────────
// 도구 실행 (Brush, Bucket, Eraser, Dropper, Mask)
// ─────────────────────────────────────────────────────────────────────────────

export function applyBrush(state, face, c, options = {}) {
  const { allFaces = false, tone = state.activeTone } = options;
  const faces = allFaces ? FACES : [face];
  let changed = false;

  for (const f of faces) {
    const curTone = getCellTone(state, f, c);
    if (curTone !== tone) {
      setCellToneDirect(state, f, c, tone);
      changed = true;
    }
  }

  // 기본 모드에서는 변경 시 비데이터로 자동 등록
  const role = roleOfCoord(state.type, state.size, c, { finderMode: state.finderMode });
  if (!isFixedRole(role)) {
    const ck = coordKey(state.type, c);
    state.userNonData.add(ck);
  }

  return changed;
}

export function applyBucket(state, face, c, targetTone = state.activeTone, options = {}) {
  const startTone = getCellTone(state, face, c);
  if (startTone === targetTone) return false;

  const startKey = toneKey(state.type, face, c);
  const visited = new Set([startKey]);
  const queue = [{ face, coord: c }];

  while (queue.length > 0) {
    const current = queue.shift();
    setCellToneDirect(state, current.face, current.coord, targetTone);

    const role = roleOfCoord(state.type, state.size, current.coord, { finderMode: state.finderMode });
    if (!isFixedRole(role)) {
      state.userNonData.add(coordKey(state.type, current.coord));
    }

    const nbs = getFaceNeighbors(state.type, state.size, current.face, current.coord);
    for (const nb of nbs) {
      const nbKey = toneKey(state.type, nb.face, nb.coord);
      if (!visited.has(nbKey)) {
        visited.add(nbKey);
        if (getCellTone(state, nb.face, nb.coord) === startTone) {
          queue.push(nb);
        }
      }
    }
  }

  return true;
}

export function applyEraser(state, face, c, options = {}) {
  const { allFaces = false } = options;
  const faces = allFaces ? FACES : [face];
  let changed = false;

  for (const f of faces) {
    const curTone = getCellTone(state, f, c);
    if (curTone !== DEFAULT_TONE) {
      setCellToneDirect(state, f, c, DEFAULT_TONE);
      changed = true;
    }
  }

  // 3면 모두 default 톤이면 userNonData 에서도 해제
  const allDefault = FACES.every((f) => getCellTone(state, f, c) === DEFAULT_TONE);
  if (allDefault) {
    const ck = coordKey(state.type, c);
    if (state.userNonData.has(ck)) {
      state.userNonData.delete(ck);
      changed = true;
    }
  }

  return changed;
}

export function applyMaskToggle(state, c) {
  const role = roleOfCoord(state.type, state.size, c, { finderMode: state.finderMode });
  if (isFixedRole(role)) {
    return { changed: false, reason: 'fixed' };
  }
  const ck = coordKey(state.type, c);
  if (state.userNonData.has(ck)) {
    state.userNonData.delete(ck);
  } else {
    state.userNonData.add(ck);
  }
  return { changed: true, reason: 'ok' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 일괄 변환 (회전, 반전, 초기화)
// ─────────────────────────────────────────────────────────────────────────────

export function invertAllTones(state) {
  pushUndoSnapshot(state);
  const cells = enumerateCells(state.type, state.size);
  for (const c of cells) {
    for (const face of FACES) {
      const tone = getCellTone(state, face, c);
      if (tone === 0) setCellToneDirect(state, face, c, 2);
      else if (tone === 2) setCellToneDirect(state, face, c, 0);
    }
  }
}

export function resetAllTones(state) {
  pushUndoSnapshot(state);
  state.tones.clear();
  state.userNonData.clear();
  if (state.type !== 'Y') {
    applyFinderStarter(state, state.finderStarter || DEFAULT_FINDER_STARTER);
  } else {
    state.finderPattern = null;
  }
}

export function rotate120(state) {
  if (state.type === 'Y') return false; // Y는 120도 회전이 축 대칭과 달라 axial 전용
  pushUndoSnapshot(state);

  const newTones = new Map();
  const newUserNonData = new Set();

  for (const [key, tone] of state.tones) {
    const parsed = parseToneKey(state.type, key);
    const rotatedCoord = rotate120Axial(parsed.q, parsed.r);
    // Face 순환: T -> R -> L -> T
    const nextFace = parsed.face === 'T' ? 'R' : parsed.face === 'R' ? 'L' : 'T';
    newTones.set(toneKey(state.type, nextFace, rotatedCoord), tone);
  }

  for (const key of state.userNonData) {
    const parsed = parseCoordKey(state.type, key);
    const rotatedCoord = rotate120Axial(parsed.q, parsed.r);
    newUserNonData.add(coordKey(state.type, rotatedCoord));
  }

  state.tones = newTones;
  state.userNonData = newUserNonData;
  if (state.finderPattern) {
    state.finderPattern = rotateFinderPattern120(state.finderPattern);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 직렬화 및 역직렬화 (v1 / v2 스키마 지원)
// ─────────────────────────────────────────────────────────────────────────────

export function serializeUniversalEditor(state) {
  const cells = enumerateCells(state.type, state.size);
  let dataCount = 0;
  let detectorCount = 0;
  let fixedCount = 0;

  for (const c of cells) {
    const role = roleOfCoord(state.type, state.size, c, { finderMode: state.finderMode });
    const ck = coordKey(state.type, c);
    if (isFixedRole(role)) {
      fixedCount += 1;
    } else if (state.userNonData.has(ck)) {
      detectorCount += 1;
    } else {
      dataCount += 1;
    }
  }

  const userNonData = Array.from(state.userNonData)
    .map((k) => parseCoordKey(state.type, k))
    .sort((a, b) => (state.type === 'Y' ? a.i - b.i || a.j - b.j : a.q - b.q || a.r - b.r));

  const toneOverrides = [];
  for (const [key, tone] of state.tones) {
    if (tone !== DEFAULT_TONE) {
      const parsed = parseToneKey(state.type, key);
      toneOverrides.push({ ...parsed, tone });
    }
  }
  toneOverrides.sort((a, b) => (
    (FACE_ORDER[a.face] - FACE_ORDER[b.face])
    || (state.type === 'Y' ? a.i - b.i || a.j - b.j : a.q - b.q || a.r - b.r)
  ));

  const baseDoc = {
    schema: state.type === 'Y' ? CELL_EDITOR_SCHEMA_V1 : CELL_EDITOR_SCHEMA_V2,
    type: state.type,
    size: state.size,
    finderMode: state.finderMode,
    finderStarter: state.finderStarter || DEFAULT_FINDER_STARTER,
    toneLevels: { 0: 'dark', 1: 'mid', 2: 'bright' },
    counts: {
      total: cells.length,
      data: dataCount,
      detector: detectorCount,
      fixed: fixedCount,
    },
    userNonData,
    toneOverrides,
  };

  if (state.type === 'Y') {
    baseDoc.n = state.size;
  } else {
    baseDoc.k = state.size;
    if (state.finderPattern) {
      baseDoc.finderPattern = cloneCellEditorFinderPattern(state.finderPattern);
    }
  }

  return baseDoc;
}

export function parseUniversalEditor(input) {
  const obj = typeof input === 'string' ? JSON.parse(input) : input;
  if (!obj || typeof obj !== 'object') {
    throw new TypeError('셀 편집기 JSON 객체가 필요하다');
  }

  const isV1 = obj.schema === CELL_EDITOR_SCHEMA_V1;
  const isV2 = obj.schema === CELL_EDITOR_SCHEMA_V2;
  if (!isV1 && !isV2) {
    throw new RangeError(`지원하지 않는 스키마: ${obj.schema}`);
  }

  const type = obj.type || (isV1 ? 'Y' : 'O');
  const rawSize = obj.size ?? obj.n ?? obj.k;
  const size = Number.isInteger(rawSize) ? rawSize : defaultSizeForType(type);
  const state = createUniversalEditorState({
    type,
    size,
    finderMode: obj.finderMode || (type === 'Y' ? 'full-surface' : 'central-finder'),
    finderStarter: obj.finderStarter || DEFAULT_FINDER_STARTER,
  });

  if (Array.isArray(obj.userNonData)) {
    for (const item of obj.userNonData) {
      const c = Array.isArray(item)
        ? (type === 'Y' ? { i: item[0], j: item[1] } : { q: item[0], r: item[1] })
        : item;
      state.userNonData.add(coordKey(type, c));
    }
  }

  if (Array.isArray(obj.toneOverrides)) {
    for (const item of obj.toneOverrides) {
      const c = Array.isArray(item)
        ? (type === 'Y'
          ? { face: item[0], i: item[1], j: item[2], tone: item[3] }
          : { face: item[0], q: item[1], r: item[2], tone: item[3] })
        : item;
      if (c.tone !== DEFAULT_TONE) {
        state.tones.set(toneKey(type, c.face, c), c.tone);
      }
    }
  }

  if (obj.finderPattern) {
    state.finderPattern = cloneCellEditorFinderPattern(obj.finderPattern);
  }

  return state;
}
