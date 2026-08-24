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
 *   - Undo / Redo: 유한 히스토리 스택 + 드래그 스트로크 코얼레싱
 *     (규칙은 cell-editor-history.js 한 곳에 있다 — 생성기 섹션 편집기와 공유)
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
  placeReservedCells,
  roleMapFromPlacement,
  FORMAT_BLOCK_LENGTH_V2,
} from './autoplaceY.js';
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
  regionCellsTurnA,
  roleOfA,
} from './placementA.js';
import { markerCells } from './markerO.js';
import {
  FINDER_CELL_ORDER,
  FINDER_FACE_BITS,
  FINDER_PATTERNS,
  getFinderPattern,
} from './finder-patterns.js';
import {
  OAK_LEVEL_FACE_INDEX,
  getOakFinderPattern,
} from './finder-oak-patterns.js';
import {
  cloneFinderEditorPattern,
  serializeFinderEditorPattern,
} from './finder-editor-pattern.js';
import {
  CELL_EDITOR_HISTORY_LIMIT,
  armStrokeOnBucket,
  beginStrokeOnBucket,
  canRedoBucket,
  canUndoBucket,
  commitEditOnBucket,
  endStrokeOnBucket,
  isStrokeArmedOnBucket,
  recordOnBucket,
  redoOnBucket,
  undoOnBucket,
} from './cell-editor-history.js';

export { CELL_EDITOR_HISTORY_LIMIT };

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

// V = 턴A (내부 타입 V, 역삼각 Type A) — 2026-08-24 편입. A 의 **180° 상**이라
// 손 좌표·새 상수 0 이다 (placementA.regionCellsTurnA 사상 재사용).
// G = 내부 타입 G (코너 **자리 예약** — O-CM). 별도 영역이 아니라 **O 영역 + 마커
// 12셀 예약**이다 (markerO.markerCells 유도) — 와이어가 G 를 별도 타입으로 보는
// 이유와 같은 이유로 편집기도 별도 타입으로 연다: 데이터 셀 집합이 O 와 다르다.
export const CELL_TYPES = Object.freeze(['Y', 'O', 'A', 'K', 'V', 'G']);
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
export const FINDER_NAME_MAX_LENGTH = 80;

export function normalizeFinderName(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, FINDER_NAME_MAX_LENGTH);
}

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
  // 3레벨 후보(OAK)는 `cellMasks` 가 없고 `cellLevels`(면당 0/1/2)를 든다. 우선순위는
  // scene.js:512 «둘 다 있으면 레벨이 이긴다» · cell-finder-detect.js normalizePatterns 와
  // 같아야 «그린 것» 과 «편집기가 보여 주는 것» 이 안 갈린다. 정본 표는 frozen 이라
  // 삼중까지 깊게 뜬다 — 얕게 뜨면 편집이 정본을 오염시키거나 조용히 무시된다.
  if (renderKind === 'cell-mask' && Array.isArray(pattern.cellLevels)) {
    if (pattern.cellLevels.length !== FINDER_CELL_ORDER.length) {
      throw new RangeError('cellLevels는 19개여야 한다');
    }
    return { renderKind, cellLevels: pattern.cellLevels.map((triple) => [...triple]) };
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
    // OAK 후보(2026-08-18)는 생성 도구 산출물이 아니라 별도 표라 PATTERN_BY_ID 에
    // 없다 — scene.js resolveFinderRenderPattern 과 **같은 조회 순서**로 먼저 푼다.
    // 안 그러면 아래 getFinderPattern 이 던지고 이 try 의 catch 가 «모르는 파인더» 를
    // 조용히 불스아이로 되돌린다. 그 침묵이 §6.1 증상(생성기에서 OAK 를 골라도
    // 아래 편집기는 계속 불스아이)의 절반이었다.
    const patternDef = getOakFinderPattern(id) || getFinderPattern(id);
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
  // 레벨 패턴(OAK)도 같은 좌표 사상을 타되 면은 값째로 돈다: T→R · R→L · L→T
  // (rotateMaskBits120 과 같은 사상). 이 갈래가 없으면 copy.cellMasks[i] 에서
  // TypeError 가 난다 — clone 이 레벨을 통과시키게 된 이상 짝으로 있어야 한다.
  if (Array.isArray(copy.cellLevels)) {
    const newLevels = new Array(FINDER_CELL_ORDER.length);
    for (let i = 0; i < FINDER_CELL_ORDER.length; i += 1) {
      const cell = FINDER_CELL_ORDER[i];
      const rotated = rotate120Axial(cell.q, cell.r);
      const dest = FINDER_CELL_ORDER.findIndex(
        (candidate) => candidate.q === rotated.q && candidate.r === rotated.r,
      );
      if (dest < 0) continue;
      const src = copy.cellLevels[i];
      const next = [];
      next[OAK_LEVEL_FACE_INDEX.R] = src[OAK_LEVEL_FACE_INDEX.T];
      next[OAK_LEVEL_FACE_INDEX.L] = src[OAK_LEVEL_FACE_INDEX.R];
      next[OAK_LEVEL_FACE_INDEX.T] = src[OAK_LEVEL_FACE_INDEX.L];
      newLevels[dest] = next;
    }
    copy.cellLevels = newLevels;
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
  if (type === 'G') {
    // 영역은 O 와 **한 셀도 다르지 않다** — 다른 것은 역할(마커 12셀 예약)뿐이다.
    return enumerateCells('O', size);
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
  if (type === 'V') {
    // 턴A — regionCellsA 의 180° 상. 사상 함수를 그대로 쓰므로 «A 와 같은 길이·
    // 같은 순서» 가 정본에서 보장된다 (placementA 로드 자기검증).
    return regionCellsTurnA(size).map((cell) => ({ q: cell.q, r: cell.r }));
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

export function occupiedCellsY(state) {
  if (state.type !== 'Y') return [];
  const seen = new Set();
  const cells = [];
  const add = (i, j) => {
    const key = i + ',' + j;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ i, j });
  };
  for (const key of state.tones.keys()) {
    const parsed = parseToneKey('Y', key);
    add(parsed.i, parsed.j);
  }
  for (const key of state.userNonData) {
    const parsed = parseCoordKey('Y', key);
    add(parsed.i, parsed.j);
  }
  cells.sort((a, b) => a.i - b.i || a.j - b.j);
  return cells;
}

/**
 * Y 편집기 미리보기 배치. **포맷 v2(18셀)** 로 유도한다 — 이 편집기의 Y 모드가
 * 만드는 산출물은 신세대 셀 표면 정본(cellSurfaceFinal.js)이고 그 라인업은 전부 v2 다.
 * 다른 세대를 그리려면 `options.formatBlockLength` 로 명시한다.
 */
export function previewAutoplaceY(state, options = {}) {
  if (state.type !== 'Y') return null;
  const formatBlockLength = options.formatBlockLength === undefined
    ? FORMAT_BLOCK_LENGTH_V2
    : options.formatBlockLength;
  try {
    const placement = placeReservedCells(state.size, occupiedCellsY(state), { formatBlockLength });
    return {
      ok: true,
      placement,
      roles: roleMapFromPlacement(placement),
    };
  } catch (error) {
    return {
      ok: false,
      code: error.code || error.name,
      message: error.message,
    };
  }
}

export function roleOfCoord(type, size, c, options = {}) {
  const { finderMode = DEFAULT_FINDER_MODE } = options;
  if (type === 'Y') {
    const roles = options.roles || (options.placement
      ? roleMapFromPlacement(options.placement)
      : null);
    if (roles) {
      const entry = roles.get(c.i + ',' + c.j);
      return entry ? entry.role : 'data';
    }
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
  if (type === 'V') {
    // 역할도 사상이다 — (q,r) 을 A 좌표로 되돌려 roleOfA 에 묻는다. 중앙 19셀은
    // 180° 불변이라 파인더/데이터 분기는 A 와 한 값도 다르지 않다.
    if (finderMode === 'central-finder' && isCenterCell(type, c)) {
      return 'finder';
    }
    if (finderMode === 'full-surface' && isCenterCell(type, c)) {
      return 'data';
    }
    return roleOfA(-c.q, -c.r, size);
  }
  if (type === 'G') {
    // 자리 예약 12셀은 **그 자리에 들어가는 심볼(H)** 의 자리다 — 역할 'finder' 로
    // 잠근다 (isFixedRole 이 잡아 편집기가 금테로 그린다). 나머지는 O 그대로.
    if (markerCells(size).some((cell) => cell.q === c.q && cell.r === c.r)) return 'finder';
    return roleOfCoord('O', size, c, options);
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
    finderName: normalizeFinderName(options.finderName),
    mode,
    activeTool,
    activeTone,
    userNonData: new Set(),
    tones: new Map(), // toneKey -> tone (0 | 1 | 2)
    finderPattern: null,
    undoStack: [],
    redoStack: [],
    strokeOpen: false,
    // 예약된 스트로크 스냅샷 (armEditStroke). 첫 실제 편집에서 확정된다.
    pendingStroke: null,
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
    finderName: state.finderName || '',
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
  if (Object.prototype.hasOwnProperty.call(snapshot, 'finderName')) {
    state.finderName = normalizeFinderName(snapshot.finderName);
  }
  state.userNonData = new Set(snapshot.userNonData);
  state.tones = new Map(snapshot.tones);
  state.finderPattern = snapshot.finderPattern
    ? cloneCellEditorFinderPattern(snapshot.finderPattern)
    : null;
}

/**
 * 상태 객체 자체가 히스토리 버킷이다 (`undoStack`/`redoStack`/`strokeOpen`).
 * 스택 규칙은 cell-editor-history.js 가 소유한다 — 여기서 다시 구현하지 않는다.
 */
export function pushUndoSnapshot(state) {
  return recordOnBucket(state, cloneSnapshot(state), CELL_EDITOR_HISTORY_LIMIT);
}

/**
 * 드래그 도색 시작. 이 사이의 `pushUndoSnapshot` 은 전부 코얼레싱된다 —
 * **연속 도색 한 번 = 되돌리기 한 스텝**(셀 단위가 아니다).
 */
export function beginEditStroke(state) {
  return beginStrokeOnBucket(state, cloneSnapshot(state), CELL_EDITOR_HISTORY_LIMIT);
}

/**
 * 드래그 **예약**. `beginEditStroke` 와 달리 누른 순간에는 스텝을 만들지 않고,
 * 첫 실제 편집(`commitCellEdit`)에서 확정한다 — 잠긴 셀 클릭·무동작 도구(스포이드)가
 * 빈 되돌리기 스텝을 남기지 않게 한다.
 */
export function armEditStroke(state) {
  return armStrokeOnBucket(state, cloneSnapshot(state));
}

export function isEditStrokeArmed(state) {
  return isStrokeArmedOnBucket(state);
}

/**
 * 편집 한 번 — 스냅샷 → `apply()` → **바뀐 경우에만** 기록.
 * `apply()` 는 «바뀌었나» 를 boolean 이나 `{changed}` 로 돌려줘야 한다.
 * @returns {{changed: boolean, recorded: boolean, outcome: *}}
 */
export function commitCellEdit(state, apply) {
  return commitEditOnBucket(state, {
    snapshot: () => cloneSnapshot(state),
    apply,
    limit: CELL_EDITOR_HISTORY_LIMIT,
  });
}

export function endEditStroke(state) {
  return endStrokeOnBucket(state);
}

export function canUndo(state) {
  return canUndoBucket(state);
}

export function canRedo(state) {
  return canRedoBucket(state);
}

export function undo(state) {
  const prev = undoOnBucket(state, cloneSnapshot(state));
  if (prev === null) return false;
  restoreSnapshotFields(state, prev);
  return true;
}

export function redo(state) {
  const next = redoOnBucket(state, cloneSnapshot(state), CELL_EDITOR_HISTORY_LIMIT);
  if (next === null) return false;
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
      // 레벨이 이긴다 — scene.js 렌더 분기와 같은 우선순위. 이 갈래가 없으면
      // OAK 패턴에서 `cellMasks[cellIndex]` 가 undefined 라 TypeError 로 죽는다.
      if (Array.isArray(state.finderPattern.cellLevels)) {
        return state.finderPattern.cellLevels[cellIndex][OAK_LEVEL_FACE_INDEX[face]];
      }
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
      // 레벨 패턴은 면 값을 그대로 쓴다(마스크 비트가 아니다). index.html 의 생성기
      // 편집기는 중앙 19셀을 role 'finder' 로 잠가 여기 못 오지만, 독립 편집기
      // (/celleditor/)는 온다 — 위 clone 갈래가 통과시킨 패턴을 여기서 받아야 한다.
      if (Array.isArray(state.finderPattern.cellLevels)) {
        if (cellIndex >= 0) {
          state.finderPattern.cellLevels[cellIndex][OAK_LEVEL_FACE_INDEX[face]] = tone;
        }
        return;
      }
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
      if (type === 'G') return hexDistance(nq, nr) <= size;
      if (type === 'V') return isInRegionA(-nq, -nr, size);
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

  // Type Y 셀 표면은 칠한 셀이 곧 파인더 점유다. format/reference 는
  // autoplace 가 비키므로 고정 역할이어도 userNonData 에 넣는다.
  const role = roleOfCoord(state.type, state.size, c, { finderMode: state.finderMode });
  if (state.type === 'Y' || !isFixedRole(role)) {
    const ck = coordKey(state.type, c);
    // 데이터 제외가 새로 생기는 것도 «바뀐 것» 이다 — 톤이 그대로여도 그렇다.
    // 반환값이 여기서 거짓말을 하면 되돌리기 스텝이 통째로 안 만들어진다(commitCellEdit).
    if (!state.userNonData.has(ck)) {
      state.userNonData.add(ck);
      changed = true;
    }
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
    if (state.type === 'Y' || !isFixedRole(role)) {
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
  if (state.type !== 'Y' && isFixedRole(role)) {
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
  const yPreview = state.type === 'Y' ? previewAutoplaceY(state) : null;
  const occupiedY = state.type === 'Y'
    ? new Set(occupiedCellsY(state).map((cell) => cell.i + ',' + cell.j))
    : null;

  for (const c of cells) {
    if (state.type === 'Y') {
      const ck = c.i + ',' + c.j;
      if (occupiedY.has(ck)) {
        detectorCount += 1;
      } else if (yPreview && yPreview.ok) {
        const entry = yPreview.roles.get(ck);
        if (entry && (entry.role === 'reference' || entry.role === 'format')) {
          fixedCount += 1;
        } else {
          dataCount += 1;
        }
      } else {
        dataCount += 1;
      }
      continue;
    }
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
    name: normalizeFinderName(state.finderName),
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
      const pattern = cloneCellEditorFinderPattern(state.finderPattern);
      if (baseDoc.name) pattern.name = baseDoc.name;
      baseDoc.finderPattern = pattern;
    }
  }

  return baseDoc;
}

/**
 * 좌표·톤 항목을 **컴팩트 튜플** 로 다시 싼다.
 * `{q,r}` → `[q, r]` · `{face,q,r,tone}` → `["T", q, r, 2]` (Y 는 i/j).
 *
 * 왜: 큰 격자의 편집 결과를 `JSON.stringify(doc, null, 2)` 로 뽑으면 항목 하나가
 * 네댓 줄로 부풀어 2000줄짜리 파일이 나온다 — 정본화할 때 사람이 못 읽는다.
 * `parseUniversalEditor` 는 원래부터 튜플을 받으므로 왕복이 보장된다.
 */
export function packUniversalEditorTuples(doc) {
  if (doc === null || typeof doc !== 'object') {
    throw new TypeError('직렬화된 편집기 문서가 필요하다');
  }
  const type = doc.type || 'Y';
  const packed = { ...doc };
  if (Array.isArray(doc.userNonData)) {
    packed.userNonData = doc.userNonData.map((c) => (
      Array.isArray(c) ? c : (type === 'Y' ? [c.i, c.j] : [c.q, c.r])
    ));
  }
  if (Array.isArray(doc.toneOverrides)) {
    packed.toneOverrides = doc.toneOverrides.map((o) => (
      Array.isArray(o) ? o : (type === 'Y'
        ? [o.face, o.i, o.j, o.tone]
        : [o.face, o.q, o.r, o.tone])
    ));
  }
  return packed;
}

function isPrimitiveArray(value) {
  return Array.isArray(value)
    && value.every((item) => item === null || typeof item !== 'object');
}

/**
 * 원소가 전부 원시값인 배열만 한 줄로 붙이는 JSON 출력. 결정적이다.
 *
 * `undefined`(와 함수)는 `JSON.stringify` 와 **같은 규칙**으로 다룬다 — 객체 키는
 * 통째로 빼고 배열 원소는 `null` 로 적는다. 직접 적으면 `{"a": undefined}` ·
 * `[1, , 3]` 같은 무효 JSON 이 나온다 (스키마에 옵셔널 필드가 하나 붙는 순간 export 가
 * 깨진다 — 지금은 도달 불가라도 파서 계약을 문서 스키마에 인질로 잡히지 않게 둔다).
 */
export function stringifyCompactJson(value, indentLevel = 0) {
  const pad = '  '.repeat(indentLevel);
  const padInner = '  '.repeat(indentLevel + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (isPrimitiveArray(value)) {
      return '[' + value.map((item) => jsonScalar(item)).join(', ') + ']';
    }
    return '[\n'
      + value.map((item) => padInner + stringifyCompactJson(item, indentLevel + 1)).join(',\n')
      + '\n' + pad + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => isJsonValue(value[k]));
    if (keys.length === 0) return '{}';
    return '{\n'
      + keys.map((k) => padInner + JSON.stringify(k) + ': '
        + stringifyCompactJson(value[k], indentLevel + 1)).join(',\n')
      + '\n' + pad + '}';
  }
  return jsonScalar(value);
}

/** JSON 에 실을 수 있는 값인가 (undefined·함수·심볼은 아니다). */
function isJsonValue(value) {
  return value !== undefined && typeof value !== 'function' && typeof value !== 'symbol';
}

/** 배열 원소 자리의 `undefined` 는 `null` 이다 — JSON.stringify 와 같은 규칙. */
function jsonScalar(value) {
  return isJsonValue(value) ? JSON.stringify(value) : 'null';
}

/** 편집기 상태 → 컴팩트 튜플 팩 JSON 문자열. `parseUniversalEditor` 로 되읽힌다. */
export function stringifyUniversalEditorCompact(state) {
  return stringifyCompactJson(packUniversalEditorTuples(serializeUniversalEditor(state)));
}

/**
 * `toneOverrides` 방언 정규화 → 평평한 목록.
 *
 * 두 방언이 실재한다:
 *   ① 편집기 export — `[["T", i, j, tone], …]` (또는 `{face,i,j,tone}` 객체)
 *   ② **손으로 정본화한 문서** — 면 키 객체 `{"T": [[i,j,tone], …], "L": …, "R": …}`
 *
 * ②를 못 읽으면 `looksLikeCellEditorJson` 이 true 라 붙여넣기는 «성공» 한 것처럼
 * 보이면서 톤이 **전부 소실**된다 (조용한 데이터 손실). 그래서 파서가 둘 다 받는다.
 * 같은 규칙을 `type-y-cell-editor.js` 의 파서도 쓴다 (거기 주석 참조).
 */
export function normalizeToneOverrideList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw === null || typeof raw !== 'object') return [];
  const flat = [];
  for (const face of Object.keys(raw)) {
    const entries = raw[face];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (Array.isArray(entry)) flat.push([face, ...entry]);
      else if (entry !== null && typeof entry === 'object') flat.push({ face, ...entry });
    }
  }
  return flat;
}

export function looksLikeCellEditorJson(input) {
  try {
    const obj = typeof input === 'string' ? JSON.parse(input) : input;
    return Boolean(
      obj
      && typeof obj === 'object'
      && (obj.schema === CELL_EDITOR_SCHEMA_V1 || obj.schema === CELL_EDITOR_SCHEMA_V2),
    );
  } catch {
    return false;
  }
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
  const importedName = obj.name ?? obj.finderName
    ?? (obj.finderPattern && obj.finderPattern.name);
  const state = createUniversalEditorState({
    type,
    size,
    finderMode: obj.finderMode || (type === 'Y' ? 'full-surface' : 'central-finder'),
    finderStarter: obj.finderStarter || DEFAULT_FINDER_STARTER,
    finderName: importedName,
  });

  if (Array.isArray(obj.userNonData)) {
    for (const item of obj.userNonData) {
      const c = Array.isArray(item)
        ? (type === 'Y' ? { i: item[0], j: item[1] } : { q: item[0], r: item[1] })
        : item;
      state.userNonData.add(coordKey(type, c));
    }
  }

  for (const item of normalizeToneOverrideList(obj.toneOverrides)) {
    const c = Array.isArray(item)
      ? (type === 'Y'
        ? { face: item[0], i: item[1], j: item[2], tone: item[3] }
        : { face: item[0], q: item[1], r: item[2], tone: item[3] })
      : item;
    if (c.tone !== DEFAULT_TONE) {
      state.tones.set(toneKey(type, c.face, c), c.tone);
    }
  }

  if (obj.finderPattern) {
    state.finderPattern = cloneCellEditorFinderPattern(obj.finderPattern);
  }

  return state;
}
