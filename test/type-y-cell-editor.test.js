/**
 * type-y-cell-editor.test.js — Type Y 셀 편집기 순수 상태·경계·직렬화.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { roleOf, buildRoleSets } from '../src/placementY.js';
import {
  BOUNDARY_EDGES,
  CELL_EDITOR_FACES,
  CELL_EDITOR_MODE_MASK,
  CELL_EDITOR_MODE_TONE,
  CELL_EDITOR_SCHEMA,
  DEFAULT_CELL_TONE,
  TONE_BRIGHTEN,
  TONE_DARKEN,
  TONE_LEVELS,
  applyCellEdit,
  applyMaskToggle,
  applyToneEdit,
  cellTone,
  classifyCoord,
  countEditorCoords,
  createCellEditorState,
  createCellEditorStore,
  cycleCellTone,
  dataBoundaryEdges,
  editorStateForN,
  edgeEndpoints,
  isDataCoord,
  parseCellEditor,
  resetCellEditorState,
  serializeCellEditor,
  setEditorMode,
  stringifyCellEditor,
} from '../src/type-y-cell-editor.js';

const N = 13;
const HOLE = { i: 6, j: 6 };

function firstFixed(n, role) {
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (roleOf(i, j, n) === role) return { i, j };
    }
  }
  throw new Error(`${role} 좌표가 없다`);
}

function firstData(n, roleSets) {
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (roleOf(i, j, n, roleSets) === 'data') return { i, j };
    }
  }
  throw new Error('data 좌표가 없다');
}

test('좌·우 순환이 3단계에서 감긴다', () => {
  assert.equal(cycleCellTone(2, TONE_DARKEN), 1);
  assert.equal(cycleCellTone(1, TONE_DARKEN), 0);
  assert.equal(cycleCellTone(0, TONE_DARKEN), 2);
  assert.equal(cycleCellTone(0, TONE_BRIGHTEN), 1);
  assert.equal(cycleCellTone(1, TONE_BRIGHTEN), 2);
  assert.equal(cycleCellTone(2, TONE_BRIGHTEN), 0);
  let tone = 2;
  for (let k = 0; k < 3; k += 1) tone = cycleCellTone(tone, TONE_DARKEN);
  assert.equal(tone, 2);
  tone = 0;
  for (let k = 0; k < 3; k += 1) tone = cycleCellTone(tone, TONE_BRIGHTEN);
  assert.equal(tone, 0);
});

test('기본 모드에서 톤을 바꾸면 (i,j) 가 세 면 공통 데이터에서 빠진다', () => {
  const state = createCellEditorState(N);
  const sets = buildRoleSets(N);
  const { i, j } = HOLE;
  assert.equal(roleOf(i, j, N, sets), 'data');
  assert.equal(isDataCoord(state, i, j, sets), true);
  assert.equal(cellTone(state, 'T', i, j), DEFAULT_CELL_TONE);

  applyToneEdit(state, 'T', i, j, TONE_DARKEN, sets);

  assert.equal(cellTone(state, 'T', i, j), 0);
  assert.equal(cellTone(state, 'L', i, j), DEFAULT_CELL_TONE);
  assert.equal(cellTone(state, 'R', i, j), DEFAULT_CELL_TONE);
  assert.equal(isDataCoord(state, i, j, sets), false);
  assert.equal(classifyCoord(state, i, j, sets), 'detector');
  for (const face of CELL_EDITOR_FACES) {
    assert.equal(classifyCoord(state, i, j, sets), 'detector', face);
    assert.equal(isDataCoord(state, i, j, sets), false, face);
  }
});

test('마스크 모드에서는 색이 그대로이고 데이터 포함/제외만 바뀐다', () => {
  const state = createCellEditorState(N);
  const sets = buildRoleSets(N);
  const { i, j } = HOLE;
  applyToneEdit(state, 'L', i, j, TONE_BRIGHTEN, sets);
  const tones = {
    T: cellTone(state, 'T', i, j),
    L: cellTone(state, 'L', i, j),
    R: cellTone(state, 'R', i, j),
  };
  assert.equal(tones.L, 2);
  assert.equal(isDataCoord(state, i, j, sets), false);

  state.mode = CELL_EDITOR_MODE_MASK;
  const first = applyMaskToggle(state, i, j, sets);
  assert.equal(first.changed, true);
  assert.equal(isDataCoord(state, i, j, sets), true);
  assert.deepEqual({
    T: cellTone(state, 'T', i, j),
    L: cellTone(state, 'L', i, j),
    R: cellTone(state, 'R', i, j),
  }, tones);

  const second = applyCellEdit(state, 'R', i, j, TONE_DARKEN, sets);
  assert.equal(second.changed, true);
  assert.equal(isDataCoord(state, i, j, sets), false);
  assert.deepEqual({
    T: cellTone(state, 'T', i, j),
    L: cellTone(state, 'L', i, j),
    R: cellTone(state, 'R', i, j),
  }, tones);
});

test('reference/format 고정 좌표는 데이터로 토글할 수 없다', () => {
  const state = createCellEditorState(N);
  const sets = buildRoleSets(N);
  const ref = firstFixed(N, 'reference');
  const fmt = firstFixed(N, 'format');

  for (const cell of [ref, fmt]) {
    assert.equal(classifyCoord(state, cell.i, cell.j, sets), 'fixed');
    const before = cellTone(state, 'T', cell.i, cell.j);
    const masked = applyMaskToggle(state, cell.i, cell.j, sets);
    assert.equal(masked.changed, false);
    assert.equal(masked.reason, 'fixed');
    assert.equal(classifyCoord(state, cell.i, cell.j, sets), 'fixed');
    assert.equal(isDataCoord(state, cell.i, cell.j, sets), false);

    applyToneEdit(state, 'T', cell.i, cell.j, TONE_DARKEN, sets);
    assert.equal(cellTone(state, 'T', cell.i, cell.j), cycleCellTone(before, TONE_DARKEN));
    assert.equal(classifyCoord(state, cell.i, cell.j, sets), 'fixed');
    assert.equal(isDataCoord(state, cell.i, cell.j, sets), false);
    const counts = countEditorCoords(state, sets);
    assert.equal(counts.userNonData, 0);
  }
});

test('데이터 경계는 구멍과 외곽을 변 단위로 담고 결정적이다', () => {
  const state = createCellEditorState(N);
  const sets = buildRoleSets(N);
  const first = dataBoundaryEdges(state, sets);
  const second = dataBoundaryEdges(state, sets);
  assert.deepEqual(first, second);
  assert.ok(first.length > 0);

  for (let k = 1; k < first.length; k += 1) {
    const prev = first[k - 1];
    const cur = first[k];
    const prevFace = CELL_EDITOR_FACES.indexOf(prev.face);
    const curFace = CELL_EDITOR_FACES.indexOf(cur.face);
    const ordered = prevFace < curFace
      || (prevFace === curFace && (prev.i < cur.i
        || (prev.i === cur.i && (prev.j < cur.j
          || (prev.j === cur.j
            && BOUNDARY_EDGES.indexOf(prev.edge) <= BOUNDARY_EDGES.indexOf(cur.edge))))));
    assert.equal(ordered, true, `정렬 깨짐 ${JSON.stringify(prev)} → ${JSON.stringify(cur)}`);
  }

  const byFace = new Map(CELL_EDITOR_FACES.map((face) => [face, []]));
  for (const edge of first) byFace.get(edge.face).push(`${edge.i},${edge.j},${edge.edge}`);
  assert.deepEqual(byFace.get('T'), byFace.get('L'));
  assert.deepEqual(byFace.get('T'), byFace.get('R'));

  const holeEdges = first.filter((e) => e.face === 'T' && e.i === HOLE.i && e.j === HOLE.j);
  assert.equal(holeEdges.length, 0);

  const outer = first.filter((e) => e.face === 'T' && e.i === 0 && e.j === 0);
  assert.ok(outer.some((e) => e.edge === 'i-' || e.edge === 'j-'));

  applyToneEdit(state, 'T', HOLE.i, HOLE.j, TONE_DARKEN, sets);
  const after = dataBoundaryEdges(state, sets);
  const afterHole = after.filter((e) => e.face === 'T' && (
    (e.i === HOLE.i - 1 && e.j === HOLE.j && e.edge === 'i+')
    || (e.i === HOLE.i + 1 && e.j === HOLE.j && e.edge === 'i-')
    || (e.i === HOLE.i && e.j === HOLE.j - 1 && e.edge === 'j+')
    || (e.i === HOLE.i && e.j === HOLE.j + 1 && e.edge === 'j-')
  ));
  assert.equal(afterHole.length, 4);
  assert.equal(after.length, first.length + 4 * CELL_EDITOR_FACES.length);

  const minI = Math.min(...first.filter((e) => e.face === 'T').map((e) => e.i));
  const maxI = Math.max(...first.filter((e) => e.face === 'T').map((e) => e.i));
  const minJ = Math.min(...first.filter((e) => e.face === 'T').map((e) => e.j));
  const maxJ = Math.max(...first.filter((e) => e.face === 'T').map((e) => e.j));
  const bboxLike = first.filter((e) => e.face === 'T').every((e) => (
    e.i === minI || e.i === maxI || e.j === minJ || e.j === maxJ
  ));
  assert.equal(bboxLike, false, '고정 역할 구멍 때문에 bbox 한 겹이 되면 안 된다');

  const ends = edgeEndpoints('T', 0, 0, 'i+', { size: 1, originX: 0, originY: 0 });
  assert.equal(ends.length, 2);
  assert.equal(Number.isFinite(ends[0].x) && Number.isFinite(ends[0].y), true);
});

test('JSON 직렬화 스키마·정렬·개수·왕복이 결정적이다', () => {
  const state = createCellEditorState(N);
  const sets = buildRoleSets(N);
  const other = firstData(N, sets);
  applyToneEdit(state, 'R', HOLE.i, HOLE.j, TONE_DARKEN, sets);
  applyToneEdit(state, 'T', other.i, other.j, TONE_BRIGHTEN, sets);
  applyToneEdit(state, 'L', other.i, other.j, TONE_BRIGHTEN, sets);

  const a = serializeCellEditor(state, sets);
  const b = serializeCellEditor(state, sets);
  assert.deepEqual(a, b);
  assert.equal(stringifyCellEditor(state, sets), stringifyCellEditor(state, sets));

  assert.equal(a.schema, CELL_EDITOR_SCHEMA);
  assert.equal(a.n, N);
  assert.deepEqual(a.toneLevels, { 0: 'dark', 1: 'mid', 2: 'bright' });
  assert.deepEqual(a.toneLevels, TONE_LEVELS);
  assert.equal(a.userNonData.length, 2);
  assert.equal(a.counts.userNonData, 2);
  const expectedData = N * N - 27 - 2;
  assert.equal(a.counts.data, expectedData);

  for (let k = 1; k < a.userNonData.length; k += 1) {
    const prev = a.userNonData[k - 1];
    const cur = a.userNonData[k];
    assert.ok(prev.i < cur.i || (prev.i === cur.i && prev.j <= cur.j));
  }
  for (let k = 1; k < a.toneOverrides.length; k += 1) {
    const prev = a.toneOverrides[k - 1];
    const cur = a.toneOverrides[k];
    const prevFace = CELL_EDITOR_FACES.indexOf(prev.face);
    const curFace = CELL_EDITOR_FACES.indexOf(cur.face);
    assert.ok(
      prevFace < curFace
      || (prevFace === curFace && (prev.i < cur.i || (prev.i === cur.i && prev.j <= cur.j))),
    );
  }
  assert.ok(a.toneOverrides.every((item) => item.tone !== DEFAULT_CELL_TONE));

  const round = parseCellEditor(stringifyCellEditor(state, sets));
  assert.deepEqual(serializeCellEditor(round, sets), a);

  const fromTuples = parseCellEditor({
    schema: CELL_EDITOR_SCHEMA,
    n: N,
    userNonData: a.userNonData.map((c) => [c.i, c.j]),
    toneOverrides: a.toneOverrides.map((c) => [c.face, c.i, c.j, c.tone]),
  });
  assert.deepEqual(serializeCellEditor(fromTuples, sets), a);

  resetCellEditorState(state);
  const fresh = serializeCellEditor(state, sets);
  assert.deepEqual(fresh.userNonData, []);
  assert.deepEqual(fresh.toneOverrides, []);
  assert.equal(fresh.counts.userNonData, 0);
  assert.equal(fresh.counts.data, N * N - 27);
});

test('버전 n 을 바꿔도 이전 n 작업이 남고 초기값은 data 만 데이터다', () => {
  const store = createCellEditorStore();
  const a = editorStateForN(store, 13);
  const sets13 = buildRoleSets(13);
  applyToneEdit(a, 'T', HOLE.i, HOLE.j, TONE_DARKEN, sets13);
  assert.equal(classifyCoord(a, HOLE.i, HOLE.j, sets13), 'detector');

  const b = editorStateForN(store, 21);
  const sets21 = buildRoleSets(21);
  assert.equal(b.n, 21);
  assert.equal(classifyCoord(b, HOLE.i, HOLE.j, sets21), 'data');
  assert.equal(countEditorCoords(b, sets21).userNonData, 0);

  const again = editorStateForN(store, 13);
  assert.equal(again, a);
  assert.equal(classifyCoord(again, HOLE.i, HOLE.j, sets13), 'detector');

  setEditorMode(store, CELL_EDITOR_MODE_MASK);
  assert.equal(a.mode, CELL_EDITOR_MODE_MASK);
  assert.equal(b.mode, CELL_EDITOR_MODE_MASK);
  assert.equal(store.mode, CELL_EDITOR_MODE_MASK);
  setEditorMode(store, CELL_EDITOR_MODE_TONE);
});
