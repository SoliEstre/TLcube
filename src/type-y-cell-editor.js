/**
 * type-y-cell-editor.js — Type Y 시험판 셀·데이터 마스크 편집기 (순수 상태)
 *
 * /lab/ 생성기에서 다음 검출기 패턴을 설계하기 위한 도구다. encodeY·용량·와이어·
 * 정식 생성기 출력과 섞지 않는다. 세 면은 같은 (i,j) 데이터 마스크를 공유하고,
 * 톤만 면별로 덮을 수 있다.
 *
 * roleSets 계약: {reference:Set, format:Set, occupied?:Set}. occupied 는 **선택한
 * 검출기(파인더)가 점유한 좌표**다 — 호출자가 정본(cellSurfaceFinal painted 셀)에서
 * 런타임 유도해 넘긴다(손 좌표표 금지). occupied 좌표는 detector 로 분류되고 데이터
 * 합집합·마스크 토글에서 빠진다. 생략하면 기존(무점유) 동작 그대로다.
 *
 * 런타임 의존성 0 · 순수 ESM (node: API 금지, Math.random/Date 금지).
 */

import { roleOf, buildRoleSets } from './placementY.js';
import { YFACES, moduleQuad } from './ygrid.js';

export const CELL_EDITOR_SCHEMA = 'tlcube-y-cell-editor/v1';
export const CELL_EDITOR_MODE_TONE = 'tone';
export const CELL_EDITOR_MODE_MASK = 'mask';
export const CELL_EDITOR_MODES = Object.freeze([
  CELL_EDITOR_MODE_TONE, CELL_EDITOR_MODE_MASK,
]);
export const DEFAULT_CELL_TONE = 1;
export const TONE_DARKEN = -1;
export const TONE_BRIGHTEN = 1;
export const CELL_EDITOR_FACES = YFACES;
export const TONE_LEVELS = Object.freeze({
  0: 'dark',
  1: 'mid',
  2: 'bright',
});
export const BOUNDARY_EDGES = Object.freeze(['i+', 'i-', 'j+', 'j-']);

const FACE_ORDER = Object.freeze({ T: 0, L: 1, R: 2 });

function assertN(n) {
  if (!Number.isInteger(n) || n < 11) {
    throw new RangeError(`n 은 11 이상의 정수여야 한다: ${n}`);
  }
  return n;
}

function assertFace(face) {
  if (!Object.prototype.hasOwnProperty.call(FACE_ORDER, face)) {
    throw new RangeError(`면 라벨은 T | L | R 이어야 한다: ${face}`);
  }
  return face;
}

function assertIndex(v, label, n) {
  if (!Number.isInteger(v) || v < 0 || v >= n) {
    throw new RangeError(`${label} 는 0 이상 ${n} 미만의 정수여야 한다: ${v}`);
  }
  return v;
}

function assertTone(tone) {
  if (!Number.isInteger(tone) || tone < 0 || tone > 2) {
    throw new RangeError(`톤은 0 | 1 | 2 여야 한다: ${tone}`);
  }
  return tone;
}

function assertMode(mode) {
  if (!CELL_EDITOR_MODES.includes(mode)) {
    throw new RangeError(`모드는 ${CELL_EDITOR_MODES.join(' | ')} 여야 한다: ${mode}`);
  }
  return mode;
}

function assertDirection(direction) {
  if (direction !== TONE_DARKEN && direction !== TONE_BRIGHTEN) {
    throw new RangeError(`방향은 ${TONE_DARKEN} 또는 ${TONE_BRIGHTEN} 이어야 한다: ${direction}`);
  }
  return direction;
}

export function coordKey(i, j) {
  return `${i},${j}`;
}

export function toneKey(face, i, j) {
  return `${face},${i},${j}`;
}

function parseCoordKey(key) {
  const [i, j] = key.split(',').map(Number);
  return { i, j };
}

function parseToneKey(key) {
  const [face, i, j] = key.split(',');
  return { face, i: Number(i), j: Number(j) };
}

function cmpCoord(a, b) {
  return a.i - b.i || a.j - b.j;
}

function cmpTone(a, b) {
  return (FACE_ORDER[a.face] - FACE_ORDER[b.face]) || a.i - b.i || a.j - b.j;
}

function setsOf(n, roleSets) {
  return roleSets || buildRoleSets(n);
}

/** 3단계 순환. 어두워짐(−1): 2→1→0→2, 밝아짐(+1): 0→1→2→0. */
export function cycleCellTone(tone, direction) {
  assertTone(tone);
  assertDirection(direction);
  return (tone + direction + 3) % 3;
}

export function createCellEditorState(n) {
  assertN(n);
  return {
    n,
    mode: CELL_EDITOR_MODE_TONE,
    userNonData: new Set(),
    tones: new Map(),
  };
}

/** n별 상태를 보존하는 저장소. 모드는 n 공통. */
export function createCellEditorStore() {
  return {
    byN: new Map(),
    mode: CELL_EDITOR_MODE_TONE,
  };
}

export function editorStateForN(store, n) {
  assertN(n);
  let state = store.byN.get(n);
  if (!state) {
    state = createCellEditorState(n);
    store.byN.set(n, state);
  }
  state.mode = store.mode;
  return state;
}

export function setEditorMode(store, mode) {
  assertMode(mode);
  store.mode = mode;
  for (const state of store.byN.values()) state.mode = mode;
  return store;
}

export function resetCellEditorState(state) {
  state.userNonData.clear();
  state.tones.clear();
  return state;
}

export function isFixedNonData(i, j, n, roleSets) {
  return roleOf(i, j, n, setsOf(n, roleSets)) !== 'data';
}

/** 선택한 검출기(파인더)가 점유한 좌표인지 — roleSets.occupied 는 선택적이다. */
export function isOccupiedNonData(i, j, n, roleSets) {
  const sets = setsOf(n, roleSets);
  return sets.occupied instanceof Set && sets.occupied.has(coordKey(i, j));
}

export function isUserNonData(state, i, j) {
  return state.userNonData.has(coordKey(i, j));
}

export function isDataCoord(state, i, j, roleSets) {
  const sets = setsOf(state.n, roleSets);
  if (isFixedNonData(i, j, state.n, sets)) return false;
  if (isOccupiedNonData(i, j, state.n, sets)) return false;
  return !isUserNonData(state, i, j);
}

/** data | detector | fixed — 범례와 동일한 세 갈래. 파인더 점유는 detector 다. */
export function classifyCoord(state, i, j, roleSets) {
  const sets = setsOf(state.n, roleSets);
  const role = roleOf(i, j, state.n, sets);
  if (role === 'reference' || role === 'format') return 'fixed';
  if (isOccupiedNonData(i, j, state.n, sets) || isUserNonData(state, i, j)) return 'detector';
  return 'data';
}

export function cellTone(state, face, i, j) {
  assertFace(face);
  const key = toneKey(face, i, j);
  return state.tones.has(key) ? state.tones.get(key) : DEFAULT_CELL_TONE;
}

function setCellTone(state, face, i, j, tone) {
  const key = toneKey(face, i, j);
  if (tone === DEFAULT_CELL_TONE) state.tones.delete(key);
  else state.tones.set(key, tone);
}

/**
 * 기본(톤) 모드. 해당 면만 순환하고, 고정 역할이 아니면 (i,j) 를 세 면 공통
 * 데이터에서 제외한다.
 */
export function applyToneEdit(state, face, i, j, direction, roleSets) {
  assertFace(face);
  assertIndex(i, 'i', state.n);
  assertIndex(j, 'j', state.n);
  const next = cycleCellTone(cellTone(state, face, i, j), direction);
  setCellTone(state, face, i, j, next);
  if (!isFixedNonData(i, j, state.n, roleSets)) {
    state.userNonData.add(coordKey(i, j));
  }
  return state;
}

/**
 * 마스크 모드. 색은 그대로 두고 (i,j) 포함/제외만 토글.
 * reference/format 은 데이터로 되돌릴 수 없고, 파인더 점유(occupied)도 마찬가지다.
 */
export function applyMaskToggle(state, i, j, roleSets) {
  assertIndex(i, 'i', state.n);
  assertIndex(j, 'j', state.n);
  if (isFixedNonData(i, j, state.n, roleSets)) {
    return { state, changed: false, reason: 'fixed' };
  }
  if (isOccupiedNonData(i, j, state.n, roleSets)) {
    return { state, changed: false, reason: 'occupied' };
  }
  const key = coordKey(i, j);
  if (state.userNonData.has(key)) state.userNonData.delete(key);
  else state.userNonData.add(key);
  return { state, changed: true, reason: 'ok' };
}

export function applyCellEdit(state, face, i, j, direction, roleSets) {
  if (state.mode === CELL_EDITOR_MODE_MASK) {
    return applyMaskToggle(state, i, j, roleSets);
  }
  applyToneEdit(state, face, i, j, direction, roleSets);
  return { state, changed: true, reason: 'ok' };
}

export function countEditorCoords(state, roleSets) {
  const sets = setsOf(state.n, roleSets);
  let data = 0;
  let userNonData = 0;
  let occupied = 0;
  for (let i = 0; i < state.n; i += 1) {
    for (let j = 0; j < state.n; j += 1) {
      const kind = classifyCoord(state, i, j, sets);
      if (kind === 'data') data += 1;
      else if (kind === 'detector') {
        // 파인더 점유는 사용자 제외와 별도 회계 — data 가 인코더 회계와 일치해야 한다.
        if (isOccupiedNonData(i, j, state.n, sets)) occupied += 1;
        else userNonData += 1;
      }
    }
  }
  return { data, userNonData, occupied };
}

function neighbor(i, j, edge) {
  if (edge === 'i+') return { i: i + 1, j };
  if (edge === 'i-') return { i: i - 1, j };
  if (edge === 'j+') return { i, j: j + 1 };
  return { i, j: j - 1 };
}

/**
 * 데이터 합집합의 실제 변. bbox 가 아니라 셀 한 변 단위다.
 * 바깥 둘레와 비데이터 구멍(고정 역할·사용자 제외)을 모두 포함한다.
 * 세 면은 같은 (i,j) 마스크를 쓰므로 평면 변을 면마다 복제한다.
 */
export function dataBoundaryEdges(state, roleSets) {
  const sets = setsOf(state.n, roleSets);
  const n = state.n;
  const dataAt = (i, j) =>
    i >= 0 && i < n && j >= 0 && j < n && isDataCoord(state, i, j, sets);
  const planar = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (!dataAt(i, j)) continue;
      for (const edge of BOUNDARY_EDGES) {
        const nb = neighbor(i, j, edge);
        if (!dataAt(nb.i, nb.j)) planar.push({ i, j, edge });
      }
    }
  }
  const out = [];
  for (const face of CELL_EDITOR_FACES) {
    for (const item of planar) out.push({ face, i: item.i, j: item.j, edge: item.edge });
  }
  return out;
}

/** 모듈 마름모에서 경계 변의 두 끝점. 정점 순서 = moduleQuad. */
export function edgeEndpoints(face, i, j, edge, layout) {
  const q = moduleQuad(face, i, j, layout);
  if (edge === 'i-') return [q[0], q[3]];
  if (edge === 'i+') return [q[1], q[2]];
  if (edge === 'j-') return [q[0], q[1]];
  if (edge === 'j+') return [q[3], q[2]];
  throw new RangeError(`알 수 없는 변: ${edge}`);
}

function listedUserNonData(state, roleSets) {
  const sets = setsOf(state.n, roleSets);
  const listed = [];
  for (const key of state.userNonData) {
    const { i, j } = parseCoordKey(key);
    if (i < 0 || j < 0 || i >= state.n || j >= state.n) continue;
    if (isFixedNonData(i, j, state.n, sets)) continue;
    listed.push({ i, j });
  }
  listed.sort(cmpCoord);
  return listed;
}

function listedToneOverrides(state) {
  const listed = [];
  for (const [key, tone] of state.tones) {
    if (tone === DEFAULT_CELL_TONE) continue;
    const parsed = parseToneKey(key);
    if (!Object.prototype.hasOwnProperty.call(FACE_ORDER, parsed.face)) continue;
    if (parsed.i < 0 || parsed.j < 0 || parsed.i >= state.n || parsed.j >= state.n) continue;
    listed.push({ face: parsed.face, i: parsed.i, j: parsed.j, tone });
  }
  listed.sort(cmpTone);
  return listed;
}

export function serializeCellEditor(state, roleSets) {
  const userNonData = listedUserNonData(state, roleSets);
  const toneOverrides = listedToneOverrides(state);
  const counts = countEditorCoords(state, roleSets);
  return {
    schema: CELL_EDITOR_SCHEMA,
    n: state.n,
    toneLevels: { 0: TONE_LEVELS[0], 1: TONE_LEVELS[1], 2: TONE_LEVELS[2] },
    userNonData,
    toneOverrides,
    counts: {
      data: counts.data,
      userNonData: counts.userNonData,
      occupied: counts.occupied,
    },
  };
}

export function stringifyCellEditor(state, roleSets) {
  return JSON.stringify(serializeCellEditor(state, roleSets), null, 2);
}

function readCoord(entry) {
  if (Array.isArray(entry) && entry.length >= 2) {
    return { i: entry[0], j: entry[1] };
  }
  if (entry && typeof entry === 'object') return { i: entry.i, j: entry.j };
  throw new TypeError('userNonData 항목은 {i,j} 또는 [i,j] 여야 한다');
}

function readTone(entry) {
  if (Array.isArray(entry) && entry.length >= 4) {
    return { face: entry[0], i: entry[1], j: entry[2], tone: entry[3] };
  }
  if (entry && typeof entry === 'object') {
    return { face: entry.face, i: entry.i, j: entry.j, tone: entry.tone };
  }
  throw new TypeError('toneOverrides 항목은 {face,i,j,tone} 또는 [face,i,j,tone] 여야 한다');
}

/**
 * `toneOverrides` 의 면 키 방언 `{"T":[[i,j,tone],…],"L":…,"R":…}` → 평평한 목록.
 *
 * 정본 규칙은 cell-editor-core.js `normalizeToneOverrideList` 다. 이 모듈은 스캐너
 * 번들(lab-scan)에 실리므로 core 를 끌어들이지 않고 규칙만 복제한다 (F6 해소 —
 * 2026-08-17 스캐너 스탬프 상승과 동반). 두 구현이 갈라지면
 * cell-editor-core.test.js 가 같은 문서로 양쪽 파서를 묶어 잡는다.
 */
function normalizeToneOverrides(raw) {
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

export function parseCellEditor(input) {
  const obj = typeof input === 'string' ? JSON.parse(input) : input;
  if (!obj || typeof obj !== 'object') {
    throw new TypeError('셀 편집기 JSON 객체가 필요하다');
  }
  if (obj.schema !== CELL_EDITOR_SCHEMA) {
    throw new RangeError(`지원하지 않는 스키마: ${obj.schema}`);
  }
  const state = createCellEditorState(obj.n);
  const sets = buildRoleSets(state.n);
  const rawNonData = Array.isArray(obj.userNonData) ? obj.userNonData : [];
  for (const entry of rawNonData) {
    const { i, j } = readCoord(entry);
    if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
    if (i < 0 || j < 0 || i >= state.n || j >= state.n) continue;
    if (isFixedNonData(i, j, state.n, sets)) continue;
    state.userNonData.add(coordKey(i, j));
  }
  const rawTones = normalizeToneOverrides(obj.toneOverrides);
  for (const entry of rawTones) {
    const item = readTone(entry);
    if (!Object.prototype.hasOwnProperty.call(FACE_ORDER, item.face)) continue;
    if (!Number.isInteger(item.i) || !Number.isInteger(item.j)) continue;
    if (item.i < 0 || item.j < 0 || item.i >= state.n || item.j >= state.n) continue;
    if (!Number.isInteger(item.tone) || item.tone < 0 || item.tone > 2) continue;
    if (item.tone === DEFAULT_CELL_TONE) continue;
    state.tones.set(toneKey(item.face, item.i, item.j), item.tone);
  }
  return state;
}
