/**
 * cell-editor-history.test.js — 되돌리기/다시하기 의미 · 스트로크 코얼레싱 ·
 * 타입 전환 · 단축키 스코프.
 *
 * 왜 이 파일이 필요한가: 되돌리기는 «버튼이 있다» 로 검증되지 않는다. 셀마다 스택을
 * 쌓으면 UI 는 멀쩡한데 붓질 한 번을 지우려고 Ctrl+Z 를 마흔 번 눌러야 한다 —
 * 스크린샷으로는 안 보이고 사용자만 안다. 그래서 **스텝 수**를 세는 단언을 둔다.
 *
 * DOM 이 없어도 되도록 코어 로직을 순수 모듈로 뺐다. 단축키도 «이벤트 모양» 만
 * 보는 분류기라 평범한 객체로 전부 시험할 수 있다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_EDITOR_HISTORY_LIMIT,
  HISTORY_MASK_MODE,
  HISTORY_SHORTCUT_REDO,
  HISTORY_SHORTCUT_UNDO,
  armStroke,
  beginStroke,
  beginStrokeOnBucket,
  canRedo,
  canUndo,
  classifyHistoryShortcut,
  clearHistory,
  commitEdit,
  createHistoryBucket,
  createHistoryStore,
  editUnitKey,
  endStroke,
  endStrokeOnBucket,
  historyKey,
  isStrokeOpen,
  isTextEntryTarget,
  recordOnBucket,
  recordSnapshot,
  redoSnapshot,
  undoOnBucket,
  undoSnapshot,
} from '../src/cell-editor-history.js';
import {
  armEditStroke,
  beginEditStroke,
  canRedo as coreCanRedo,
  canUndo as coreCanUndo,
  commitCellEdit,
  createUniversalEditorState,
  endEditStroke,
  applyBrush,
  applyMaskToggle as coreMaskToggle,
  parseUniversalEditor,
  pushUndoSnapshot,
  redo,
  serializeUniversalEditor,
  stringifyUniversalEditorCompact,
  undo,
} from '../src/cell-editor-core.js';
import {
  CELL_EDITOR_MODE_MASK,
  CELL_EDITOR_MODE_TONE,
  TONE_DARKEN,
  applyCellEdit,
  createCellEditorState,
} from '../src/type-y-cell-editor.js';
import { cellSurfaceFinal } from '../src/cellSurfaceFinal.js';

// ─────────────────────────────────────────────────────────────────────────────
// 스택 의미
// ─────────────────────────────────────────────────────────────────────────────

test('한 스텝 = 한 되돌리기, redo 는 그 정확한 역이다', () => {
  const store = createHistoryStore();
  const key = historyKey('Y', 11);
  assert.equal(canUndo(store, key), false);
  assert.equal(canRedo(store, key), false);

  recordSnapshot(store, key, 'A'); // 상태 A 에서 편집 → B
  recordSnapshot(store, key, 'B'); // 상태 B 에서 편집 → C

  assert.equal(canUndo(store, key), true);
  assert.equal(undoSnapshot(store, key, 'C'), 'B');
  assert.equal(undoSnapshot(store, key, 'B'), 'A');
  assert.equal(undoSnapshot(store, key, 'A'), null, '더 되돌릴 것이 없다');

  assert.equal(canRedo(store, key), true);
  assert.equal(redoSnapshot(store, key, 'A'), 'B');
  assert.equal(redoSnapshot(store, key, 'B'), 'C');
  assert.equal(redoSnapshot(store, key, 'C'), null);
});

test('새 편집은 redo 가지를 버린다', () => {
  const store = createHistoryStore();
  const key = historyKey('O', 6);
  recordSnapshot(store, key, 'A');
  recordSnapshot(store, key, 'B');
  undoSnapshot(store, key, 'C');
  assert.equal(canRedo(store, key), true);
  recordSnapshot(store, key, 'B*'); // 다른 방향으로 다시 편집
  assert.equal(canRedo(store, key), false, '되돌린 뒤 새로 편집하면 redo 는 사라진다');
});

test('유한 스택 — 상한 50 을 넘으면 가장 오래된 것부터 버린다', () => {
  assert.equal(CELL_EDITOR_HISTORY_LIMIT, 50);
  const store = createHistoryStore();
  const key = historyKey('Y', 21);
  for (let i = 0; i < CELL_EDITOR_HISTORY_LIMIT + 10; i += 1) recordSnapshot(store, key, i);
  let steps = 0;
  let current = 'now';
  for (;;) {
    const prev = undoSnapshot(store, key, current);
    if (prev === null) break;
    current = prev;
    steps += 1;
  }
  assert.equal(steps, CELL_EDITOR_HISTORY_LIMIT, '상한만큼만 남는다');
  assert.equal(current, 10, '가장 오래된 10개가 밀려났다');
});

// ─────────────────────────────────────────────────────────────────────────────
// 스트로크 코얼레싱 — 이 파일의 핵심
// ─────────────────────────────────────────────────────────────────────────────

test('드래그 스트로크는 셀 수와 무관하게 **한 스텝**이다', () => {
  const store = createHistoryStore();
  const key = historyKey('Y', 11);

  beginStroke(store, key, 'before-stroke');
  assert.equal(isStrokeOpen(store, key), true);
  for (let i = 0; i < 40; i += 1) recordSnapshot(store, key, `mid-${i}`); // 드래그 중 40셀
  endStroke(store, key);
  assert.equal(isStrokeOpen(store, key), false);

  assert.equal(undoSnapshot(store, key, 'after-stroke'), 'before-stroke');
  assert.equal(undoSnapshot(store, key, 'before-stroke'), null, '스트로크는 한 스텝뿐이다');
});

test('스트로크 두 번은 스텝 두 개다 (코얼레싱이 스트로크를 넘지 않는다)', () => {
  const store = createHistoryStore();
  const key = historyKey('A', 6);
  beginStroke(store, key, 's0');
  recordSnapshot(store, key, 'x');
  endStroke(store, key);
  beginStroke(store, key, 's1');
  recordSnapshot(store, key, 'y');
  endStroke(store, key);

  assert.equal(undoSnapshot(store, key, 's2'), 's1');
  assert.equal(undoSnapshot(store, key, 's1'), 's0');
  assert.equal(undoSnapshot(store, key, 's0'), null);
});

test('스트로크 중첩 시작은 스텝을 늘리지 않는다', () => {
  const bucket = createHistoryBucket();
  assert.equal(beginStrokeOnBucket(bucket, 'a'), true);
  assert.equal(beginStrokeOnBucket(bucket, 'b'), false, '이미 열린 스트로크는 다시 안 연다');
  assert.equal(bucket.undoStack.length, 1);
  assert.equal(endStrokeOnBucket(bucket), true);
  assert.equal(endStrokeOnBucket(bucket), false);
});

test('열린 스트로크 안의 기록은 false 를 돌려준다 (호출자가 코얼레싱을 관측할 수 있다)', () => {
  const bucket = createHistoryBucket();
  assert.equal(recordOnBucket(bucket, 'a'), true);
  beginStrokeOnBucket(bucket, 'b');
  assert.equal(recordOnBucket(bucket, 'c'), false);
  endStrokeOnBucket(bucket);
  assert.equal(recordOnBucket(bucket, 'd'), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 빈 스텝 금지 — «실제 변경 없으면 스텝 없음»
//
// 왜 이 절이 필요한가: 잠긴 셀을 눌러도 스텝이 쌓이면 Ctrl+Z 는 «아무것도 안 하는»
// 버튼이 되고, 반복 클릭이 상한 50 스택을 밀어내 **되돌릴 수 있었던 진짜 편집을
// 잃는다**. 화면은 멀쩡해서 스크린샷으로는 안 보인다.
// ─────────────────────────────────────────────────────────────────────────────

test('commitEdit 는 apply 가 {changed:false} 면 스텝을 만들지 않는다', () => {
  const store = createHistoryStore();
  const key = historyKey('Y', 21);
  let snapshots = 0;
  const snapshot = () => { snapshots += 1; return 'S'; };

  const noop = commitEdit(store, key, { snapshot, apply: () => ({ changed: false }) });
  assert.deepEqual(
    { changed: noop.changed, recorded: noop.recorded }, { changed: false, recorded: false },
  );
  assert.equal(canUndo(store, key), false, '무동작 뒤에는 되돌릴 것이 없어야 한다');

  assert.equal(commitEdit(store, key, { snapshot, apply: () => false }).recorded, false);
  assert.equal(canUndo(store, key), false, 'boolean false 도 무동작이다');

  const real = commitEdit(store, key, { snapshot, apply: () => ({ changed: true }) });
  assert.equal(real.recorded, true);
  assert.equal(canUndo(store, key), true);
  assert.equal(snapshots, 3, '스냅샷은 편집 전에 만든다 (되돌릴 상태가 편집 전이라서)');
});

test('예약된 스트로크는 실제 편집이 있어야 확정된다 (잠긴 셀 클릭 = 스텝 0)', () => {
  const store = createHistoryStore();
  const key = historyKey('O', 6);
  const snapshot = () => 'before';

  armStroke(store, key, 'armed');
  commitEdit(store, key, { snapshot, apply: () => ({ changed: false, reason: 'fixed' }) });
  assert.equal(isStrokeOpen(store, key), false, '아직 스트로크가 열리지 않았다');
  endStroke(store, key);
  assert.equal(canUndo(store, key), false, '잠긴 셀만 눌렀으면 되돌릴 것이 없다');

  // 같은 예약 뒤 실제 편집이 하나라도 있으면 스트로크가 열리고 스텝은 정확히 하나다.
  armStroke(store, key, 'armed');
  for (let i = 0; i < 5; i += 1) commitEdit(store, key, { snapshot, apply: () => true });
  assert.equal(isStrokeOpen(store, key), true);
  endStroke(store, key);
  assert.equal(undoSnapshot(store, key, 'after'), 'armed', '되돌리면 누른 순간으로 간다');
  assert.equal(undoSnapshot(store, key, 'armed'), null, '드래그 전체가 한 스텝이다');
});

test('endStroke 는 확정되지 않은 예약을 버린다 (다음 편집이 그 스냅샷을 쓰면 안 된다)', () => {
  const store = createHistoryStore();
  const key = historyKey('A', 6);
  armStroke(store, key, 'stale');
  endStroke(store, key);
  commitEdit(store, key, { snapshot: () => 'fresh', apply: () => true });
  assert.equal(undoSnapshot(store, key, 'now'), 'fresh');
});

test('되돌리기는 열린 스트로크를 닫는다 (남은 드래그가 기록에서 사라지지 않게)', () => {
  const bucket = createHistoryBucket();
  beginStrokeOnBucket(bucket, 'before-stroke');
  assert.equal(recordOnBucket(bucket, 'mid'), false, '스트로크 중에는 코얼레싱된다');
  undoOnBucket(bucket, 'now');
  assert.equal(bucket.strokeOpen, false, 'undo 가 스트로크를 닫아야 한다');
  assert.equal(recordOnBucket(bucket, 'after-undo'), true, '그 뒤 편집은 다시 기록된다');
});

test('코어 상태도 같은 규칙 — 무동작 도구는 되돌리기 스텝을 남기지 않는다', () => {
  const state = createUniversalEditorState({ type: 'O', size: 4 });
  armEditStroke(state);
  // 스포이드처럼 «아무것도 안 바꾸는» 도구 한 번.
  const picked = commitCellEdit(state, () => false);
  endEditStroke(state);
  assert.equal(picked.changed, false);
  assert.equal(coreCanUndo(state), false, '빈 클릭은 되돌릴 것을 만들지 않는다');

  // 고정 역할(앵커·format) 좌표의 마스크 토글도 코어가 {changed:false} 로 막는다.
  const fixed = enumerateFixedCoord(state);
  armEditStroke(state);
  commitCellEdit(state, () => coreMaskToggle(state, fixed));
  endEditStroke(state);
  assert.equal(coreCanUndo(state), false, '잠긴 좌표 클릭도 스텝 0 이다');

  // 진짜 편집 하나는 정확히 한 스텝.
  armEditStroke(state);
  commitCellEdit(state, () => applyBrush(state, 'T', { q: 3, r: 1 }, { tone: 0 }));
  endEditStroke(state);
  assert.equal(state.undoStack.length, 1);
  assert.equal(undo(state), true);
  assert.equal(state.userNonData.size, 0);
});

/** 이 상태에서 «고정 역할» 인 첫 좌표. 마스크 토글이 거부해야 하는 자리다. */
function enumerateFixedCoord(state) {
  const found = coreMaskFixedCoord(state);
  assert.ok(found, '고정 역할 좌표가 있어야 시험이 성립한다');
  return found;
}

function coreMaskFixedCoord(state) {
  for (let q = -state.size; q <= state.size; q += 1) {
    for (let r = -state.size; r <= state.size; r += 1) {
      if (Math.abs(q + r) > state.size) continue;
      const probe = { q, r };
      const before = state.userNonData.size;
      const res = coreMaskToggle(state, probe);
      if (res.changed === false && res.reason === 'fixed') return probe;
      if (res.changed) { // 되돌려 놓는다 — 탐색이 상태를 바꾸면 안 된다
        coreMaskToggle(state, probe);
      }
      assert.equal(state.userNonData.size, before);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Y 마스크 모드 — 생성기 섹션 편집기가 지나는 바로 그 조합
// ─────────────────────────────────────────────────────────────────────────────

/** index.html 의 yCellEditorContext 와 같은 방식으로 정본 역할·점유 집합을 만든다. */
function ySurfaceSets(n) {
  const surface = cellSurfaceFinal(n);
  return {
    reference: new Set(surface.referenceCells.map((c) => `${c.i},${c.j}`)),
    format: new Set(surface.formatCells.map((c) => `${c.i},${c.j}`)),
    occupied: new Set(surface.paintedCells.map((c) => `${c.i},${c.j}`)),
  };
}

function firstOf(set) {
  const [key] = [...set];
  const [i, j] = key.split(',').map(Number);
  return { i, j };
}

test('Y 마스크 모드에서 잠긴 셀(fixed·occupied)을 눌러도 되돌리기가 생기지 않는다', () => {
  const n = 21;
  const sets = ySurfaceSets(n);
  const state = createCellEditorState(n);
  state.mode = CELL_EDITOR_MODE_MASK;
  const store = createHistoryStore();
  const key = historyKey('Y', n);
  const snapshot = () => ({
    userNonData: new Set(state.userNonData), tones: new Map(state.tones),
  });

  for (const locked of [firstOf(sets.format), firstOf(sets.reference), firstOf(sets.occupied)]) {
    for (let click = 0; click < 5; click += 1) {
      const res = commitEdit(store, key, {
        snapshot,
        apply: () => applyCellEdit(state, 'T', locked.i, locked.j, TONE_DARKEN, sets),
      });
      assert.equal(res.changed, false, `(${locked.i},${locked.j}) 는 무동작이어야 한다`);
    }
  }
  assert.equal(canUndo(store, key), false, '잠긴 셀은 몇 번을 눌러도 스텝 0 이다');

  // 그리고 진짜 편집은 여전히 되돌릴 수 있어야 한다 — 잠긴 셀 클릭이 상한을 갉아먹어
  // 이 스텝을 밀어내면 «되돌릴 수 있었던 편집» 이 사라진다 (실기에서 그랬다).
  let data = null;
  for (let i = 0; i < n && data === null; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const kk = `${i},${j}`;
      if (!sets.reference.has(kk) && !sets.format.has(kk) && !sets.occupied.has(kk)) {
        data = { i, j };
        break;
      }
    }
  }
  assert.ok(data, '데이터 좌표가 있어야 한다');
  commitEdit(store, key, {
    snapshot,
    apply: () => applyCellEdit(state, 'T', data.i, data.j, TONE_DARKEN, sets),
  });
  assert.equal(canUndo(store, key), true);
  assert.equal(state.userNonData.size, 1);
  for (let click = 0; click < CELL_EDITOR_HISTORY_LIMIT + 5; click += 1) {
    const locked = firstOf(sets.format);
    commitEdit(store, key, {
      snapshot,
      apply: () => applyCellEdit(state, 'T', locked.i, locked.j, TONE_DARKEN, sets),
    });
  }
  const restored = undoSnapshot(store, key, snapshot());
  assert.ok(restored, '잠긴 셀 55회 클릭 뒤에도 실편집이 스택에 남아 있어야 한다');
  assert.equal(restored.userNonData.size, 0, '되돌리면 실편집 직전으로 간다');
});

// ─────────────────────────────────────────────────────────────────────────────
// 드래그 중복 방지 단위 — 마스크는 좌표, 톤은 면
// ─────────────────────────────────────────────────────────────────────────────

test('editUnitKey — 마스크 모드는 면을 무시하고 좌표만 본다', () => {
  const cellT = { face: 'T', q: 3, r: -1 };
  const cellL = { face: 'L', q: 3, r: -1 };
  assert.equal(editUnitKey(cellT, HISTORY_MASK_MODE), editUnitKey(cellL, HISTORY_MASK_MODE));
  assert.notEqual(editUnitKey(cellT, 'tone'), editUnitKey(cellL, 'tone'));
  assert.notEqual(
    editUnitKey(cellT, HISTORY_MASK_MODE), editUnitKey({ face: 'T', q: 3, r: 0 }, HISTORY_MASK_MODE),
  );
  // Type Y 좌표(i,j)도 같은 규칙.
  assert.equal(
    editUnitKey({ face: 'T', i: 2, j: 3 }, HISTORY_MASK_MODE),
    editUnitKey({ face: 'R', i: 2, j: 3 }, HISTORY_MASK_MODE),
  );
  assert.notEqual(
    editUnitKey({ face: 'T', i: 2, j: 3 }, CELL_EDITOR_MODE_TONE),
    editUnitKey({ face: 'R', i: 2, j: 3 }, CELL_EDITOR_MODE_TONE),
  );
});

test('마스크 모드 이름은 편집기 코어와 같은 값이어야 한다 (의존성 0 모듈의 거울)', () => {
  assert.equal(HISTORY_MASK_MODE, CELL_EDITOR_MODE_MASK);
});

/**
 * 드래그 한 번을 흉내낸다 — index.html `editCellFromHit` 의 «중복 방지 → 편집» 루프와
 * 같은 순서다 (그 배선 자체는 type-y-cell-editor-lab.test.js 가 소스로 고정한다).
 */
function dragOnce(store, key, cells, mode, snapshot, applyFor) {
  const painted = new Set();
  armStroke(store, key, snapshot());
  for (const cell of cells) {
    const mark = editUnitKey(cell, mode);
    if (painted.has(mark)) continue;
    painted.add(mark);
    commitEdit(store, key, { snapshot, apply: () => applyFor(cell) });
  }
  endStroke(store, key);
}

test('마스크 드래그가 한 셀의 세 면을 스쳐도 토글은 한 번이다 (O)', () => {
  const state = createUniversalEditorState({ type: 'O', size: 6 });
  state.mode = CELL_EDITOR_MODE_MASK;
  const store = createHistoryStore();
  const key = historyKey('O', 6);
  const snapshot = () => ({
    userNonData: new Set(state.userNonData), tones: new Map(state.tones),
  });
  const coord = { q: 3, r: 1 };
  const cells = ['T', 'L', 'R'].map((face) => ({ face, ...coord }));

  dragOnce(store, key, cells, state.mode, snapshot, (cell) => coreMaskToggle(state, cell));
  assert.equal(state.userNonData.size, 1, '세 면을 스쳐도 좌표 하나가 한 번만 뒤집힌다');

  // 같은 드래그를 다시 하면 원래대로 (토글이니까) — 그리고 스텝은 각각 하나씩.
  dragOnce(store, key, cells, state.mode, snapshot, (cell) => coreMaskToggle(state, cell));
  assert.equal(state.userNonData.size, 0);
  assert.equal(undoSnapshot(store, key, snapshot()).userNonData.size, 1);
});

test('마스크 드래그가 한 셀의 세 면을 스쳐도 토글은 한 번이다 (Y)', () => {
  const n = 21;
  const sets = ySurfaceSets(n);
  const state = createCellEditorState(n);
  state.mode = CELL_EDITOR_MODE_MASK;
  const store = createHistoryStore();
  const key = historyKey('Y', n);
  const snapshot = () => ({
    userNonData: new Set(state.userNonData), tones: new Map(state.tones),
  });
  let data = null;
  for (let i = 0; i < n && data === null; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const kk = `${i},${j}`;
      if (!sets.reference.has(kk) && !sets.format.has(kk) && !sets.occupied.has(kk)) {
        data = { i, j };
        break;
      }
    }
  }
  const cells = ['T', 'L', 'R'].map((face) => ({ face, ...data }));
  dragOnce(
    store, key, cells, state.mode, snapshot,
    (cell) => applyCellEdit(state, cell.face, cell.i, cell.j, TONE_DARKEN, sets),
  );
  assert.equal(state.userNonData.size, 1, 'Y 도 마스크 단위는 (i,j) 다');
  assert.equal(canUndo(store, key), true, '실제로 바뀌었으니 되돌릴 수 있다');
});

test('톤 드래그는 면 단위라 한 셀의 세 면이 각각 칠해진다', () => {
  const state = createUniversalEditorState({ type: 'O', size: 6 });
  const store = createHistoryStore();
  const key = historyKey('O', 6);
  const snapshot = () => ({
    userNonData: new Set(state.userNonData), tones: new Map(state.tones),
  });
  const coord = { q: 3, r: 1 };
  const cells = ['T', 'L', 'R'].map((face) => ({ face, ...coord }));
  dragOnce(
    store, key, cells, CELL_EDITOR_MODE_TONE, snapshot,
    (cell) => applyBrush(state, cell.face, coord, { tone: 0 }),
  );
  assert.equal(state.tones.size, 3, '면 셋이 각각 칠해진다');
  assert.equal(undoSnapshot(store, key, snapshot()).tones.size, 0, '그래도 되돌리기는 한 번');
});

// ─────────────────────────────────────────────────────────────────────────────
// 타입 전환 — 버킷 분리
// ─────────────────────────────────────────────────────────────────────────────

test('타입·크기별 히스토리는 서로 섞이지 않고, 돌아오면 그대로 있다', () => {
  const store = createHistoryStore();
  const yKey = historyKey('Y', 11);
  const oKey = historyKey('O', 6);

  recordSnapshot(store, yKey, 'y0');
  assert.equal(canUndo(store, oKey), false, 'O 로 갈아타면 O 의 (빈) 히스토리를 본다');
  recordSnapshot(store, oKey, 'o0');
  assert.equal(undoSnapshot(store, oKey, 'o1'), 'o0');
  // Y 로 돌아오면 Y 스택이 살아 있다.
  assert.equal(canUndo(store, yKey), true);
  assert.equal(undoSnapshot(store, yKey, 'y1'), 'y0');
});

test('같은 타입이라도 크기가 다르면 다른 버킷이다 (n=21 스냅샷을 n=13 에 붙이면 파괴다)', () => {
  const store = createHistoryStore();
  recordSnapshot(store, historyKey('Y', 21), 'big');
  assert.equal(canUndo(store, historyKey('Y', 13)), false);
  assert.notEqual(historyKey('Y', 21), historyKey('Y', 13));
});

test('clearHistory 는 지정 버킷만, 인자 없으면 전부 비운다', () => {
  const store = createHistoryStore();
  recordSnapshot(store, historyKey('Y', 11), 'y');
  recordSnapshot(store, historyKey('O', 6), 'o');
  clearHistory(store, historyKey('Y', 11));
  assert.equal(canUndo(store, historyKey('Y', 11)), false);
  assert.equal(canUndo(store, historyKey('O', 6)), true);
  clearHistory(store);
  assert.equal(canUndo(store, historyKey('O', 6)), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 단축키 스코프
// ─────────────────────────────────────────────────────────────────────────────

const evt = (over) => ({
  ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: 'z', target: null, ...over,
});

test('Ctrl/Cmd+Z 는 undo, Ctrl+Shift+Z 와 Ctrl+Y 는 redo', () => {
  assert.equal(classifyHistoryShortcut(evt({ ctrlKey: true })), HISTORY_SHORTCUT_UNDO);
  assert.equal(classifyHistoryShortcut(evt({ metaKey: true })), HISTORY_SHORTCUT_UNDO);
  assert.equal(classifyHistoryShortcut(evt({ ctrlKey: true, key: 'Z' })), HISTORY_SHORTCUT_UNDO);
  assert.equal(
    classifyHistoryShortcut(evt({ ctrlKey: true, shiftKey: true })), HISTORY_SHORTCUT_REDO,
  );
  assert.equal(
    classifyHistoryShortcut(evt({ metaKey: true, shiftKey: true })), HISTORY_SHORTCUT_REDO,
  );
  assert.equal(classifyHistoryShortcut(evt({ ctrlKey: true, key: 'y' })), HISTORY_SHORTCUT_REDO);
});

test('수식키 없는 z·y, Alt 조합, 무관한 키는 가로채지 않는다', () => {
  assert.equal(classifyHistoryShortcut(evt({})), null);
  assert.equal(classifyHistoryShortcut(evt({ key: 'y' })), null);
  assert.equal(classifyHistoryShortcut(evt({ ctrlKey: true, altKey: true })), null);
  assert.equal(classifyHistoryShortcut(evt({ ctrlKey: true, key: 'a' })), null);
  assert.equal(classifyHistoryShortcut(evt({ ctrlKey: true, shiftKey: true, key: 'y' })), null);
  assert.equal(classifyHistoryShortcut(null), null);
});

test('글상자 안에서는 브라우저 기본 동작을 남긴다 (편집기 히스토리 가로채기 금지)', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'input', 'textarea']) {
    assert.equal(isTextEntryTarget({ tagName }), true, `${tagName} 는 글상자다`);
    assert.equal(
      classifyHistoryShortcut(evt({ ctrlKey: true, target: { tagName } })), null,
      `${tagName} 안의 Ctrl+Z 를 가로채면 안 된다`,
    );
  }
  assert.equal(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(
    classifyHistoryShortcut(evt({
      ctrlKey: true, target: { tagName: 'DIV', isContentEditable: true },
    })), null,
  );
  // 편집기 셀(SVG g)·버튼·섹션은 글상자가 아니다 → 정상적으로 잡는다.
  for (const tagName of ['G', 'BUTTON', 'DIV', 'svg']) {
    assert.equal(isTextEntryTarget({ tagName }), false);
    assert.equal(
      classifyHistoryShortcut(evt({ ctrlKey: true, target: { tagName } })),
      HISTORY_SHORTCUT_UNDO,
    );
  }
  assert.equal(isTextEntryTarget(null), false);
});

test('<select> 는 글상자가 아니다 — 거기서도 Ctrl+Z 는 편집기 되돌리기여야 한다', () => {
  // 정정(2026-08-16): SELECT 를 글상자로 넣었더니 «브라우저 기본 동작 보존» 이 아니라
  // 그냥 되돌리기가 죽었다 — `<select>` 에는 되돌릴 기본 동작이 없다. 독립 편집기의
  // 크기·스타터 select 는 change 에서 스텝을 쌓는데, 포커스가 select 에 남은 채 누른
  // Ctrl+Z 가 무시돼 방금 만든 스텝을 되돌릴 수 없었다.
  assert.equal(isTextEntryTarget({ tagName: 'SELECT' }), false);
  assert.equal(
    classifyHistoryShortcut(evt({ ctrlKey: true, target: { tagName: 'SELECT' } })),
    HISTORY_SHORTCUT_UNDO,
  );
  // contenteditable 인 select 흉내(=진짜 글상자)는 여전히 보호된다.
  assert.equal(
    isTextEntryTarget({ tagName: 'SELECT', isContentEditable: true }), true,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 코어 통합 — 독립 /celleditor/ 가 같은 규칙을 쓴다
// ─────────────────────────────────────────────────────────────────────────────

test('코어 편집 상태도 스트로크 한 번 = 한 스텝이다', () => {
  const state = createUniversalEditorState({ type: 'O', size: 4 });
  assert.equal(coreCanUndo(state), false);

  // 전부 data 역할인 셀만 고른다 — 고정 역할(format/anchor)은 userNonData 에 안 들어가서
  // «스트로크가 몇 셀을 건드렸나» 를 세는 이 단언의 계산이 흐려진다.
  beginEditStroke(state);
  for (const cell of [{ q: 3, r: 1 }, { q: 2, r: 2 }, { q: 0, r: 4 }]) {
    pushUndoSnapshot(state); // 붓이 셀마다 부르는 자리
    applyBrush(state, 'T', cell, { tone: 0 });
  }
  endEditStroke(state);

  assert.equal(state.undoStack.length, 1, '드래그 세 셀이 한 스텝이어야 한다');
  assert.equal(state.userNonData.size, 3);
  assert.equal(undo(state), true);
  assert.equal(state.userNonData.size, 0, '한 번의 되돌리기로 스트로크 전체가 사라진다');
  assert.equal(coreCanUndo(state), false);
  assert.equal(coreCanRedo(state), true);
  assert.equal(redo(state), true);
  assert.equal(state.userNonData.size, 3);
});

test('스트로크 밖 편집은 셀마다 스텝이 남는다 (코얼레싱이 새지 않는다)', () => {
  const state = createUniversalEditorState({ type: 'A', size: 4 });
  for (const cell of [{ q: 0, r: 3 }, { q: 1, r: 3 }]) {
    pushUndoSnapshot(state);
    applyBrush(state, 'L', cell, { tone: 2 });
  }
  assert.equal(state.undoStack.length, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// 컴팩트 튜플 팩 — 왕복
// ─────────────────────────────────────────────────────────────────────────────

test('컴팩트 튜플 팩은 왕복하고 항목당 한 줄이다', () => {
  const state = createUniversalEditorState({ type: 'O', size: 4 });
  applyBrush(state, 'T', { q: 3, r: 1 }, { tone: 0 });
  applyBrush(state, 'L', { q: 2, r: 2 }, { tone: 2 });

  const text = stringifyUniversalEditorCompact(state);
  assert.match(text, /"userNonData": \[\n\s+\[2, 2\],\n\s+\[3, 1\]\n\s+\]/);
  assert.match(text, /\["T", 3, 1, 0\]/);
  assert.match(text, /\["L", 2, 2, 2\]/);

  const back = parseUniversalEditor(text);
  assert.deepEqual(
    serializeUniversalEditor(back), serializeUniversalEditor(state),
    '컴팩트 팩 → 파서 → 직렬화가 원본과 같아야 한다',
  );
  // 같은 문서를 indent 2 객체로 뽑으면 몇 배로 부푼다 — 이 팩이 존재하는 이유다.
  const verbose = JSON.stringify(serializeUniversalEditor(state), null, 2);
  assert.ok(text.length < verbose.length, '컴팩트 팩이 더 짧아야 한다');
});

test('컴팩트 팩은 Type Y 좌표도 튜플로 싼다', () => {
  const state = createUniversalEditorState({ type: 'Y', size: 11 });
  applyBrush(state, 'R', { i: 2, j: 3 }, { tone: 0 });
  const text = stringifyUniversalEditorCompact(state);
  assert.match(text, /"userNonData": \[\n\s+\[2, 3\]\n\s+\]/);
  assert.match(text, /\["R", 2, 3, 0\]/);
  const back = parseUniversalEditor(text);
  assert.deepEqual(serializeUniversalEditor(back), serializeUniversalEditor(state));
});
