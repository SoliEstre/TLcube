/**
 * cell-editor-core.test.js — TLcube 다중 타입 셀 & 파인더 에디터 코어 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CELL_EDITOR_SCHEMA_V1,
  CELL_EDITOR_SCHEMA_V2,
  DEFAULT_SIZE_HEX,
  DEFAULT_SIZE_Y,
  DEFAULT_TONE,
  applyBrush,
  applyBucket,
  applyEraser,
  applyFinderStarter,
  applyMaskToggle,
  coordKey,
  createUniversalEditorState,
  defaultSizeForType,
  enumerateCells,
  getCellTone,
  invertAllTones,
  isCenterCell,
  isInRegionK,
  listFinderStarters,
  looksLikeCellEditorJson,
  normalizeFinderName,
  parseUniversalEditor,
  previewAutoplaceY,
  pushUndoSnapshot,
  redo,
  resetAllTones,
  roleOfCoord,
  rotate120,
  serializeUniversalEditor,
  setCellToneDirect,
  stringifyCompactJson,
  undo,
} from '../src/cell-editor-core.js';
import { parseCellEditor } from '../src/type-y-cell-editor.js';
import { FACES } from '../src/hexgrid.js';
import { FINDER_CELL_ORDER } from '../src/finder-patterns.js';
import { buildCellEditorHtml } from '../tools/build-cell-editor.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('모든 지원 타입(Y, O, A, K)의 셀 개수와 좌표 기하가 정확하다', () => {
  // Type Y: n x n
  const cellsY13 = enumerateCells('Y', 13);
  assert.equal(cellsY13.length, 169);
  const cellsY21 = enumerateCells('Y', 21);
  assert.equal(cellsY21.length, 441);

  // Type O: 3k(k+1) + 1
  const cellsO4 = enumerateCells('O', 4);
  assert.equal(cellsO4.length, 3 * 4 * 5 + 1); // 61
  const cellsO6 = enumerateCells('O', 6);
  assert.equal(cellsO6.length, 3 * 6 * 7 + 1); // 127

  // Type A: (3k+1)(3k+2)/2
  const cellsA4 = enumerateCells('A', 4);
  assert.equal(cellsA4.length, (13 * 14) / 2); // 91
  const cellsA6 = enumerateCells('A', 6);
  assert.equal(cellsA6.length, (19 * 20) / 2); // 190

  // Type K (육망성 / Hexagram Draft): 6k^2 + 6k + 1
  const cellsK4 = enumerateCells('K', 4);
  assert.equal(cellsK4.length, 6 * 16 + 24 + 1); // 121
  const cellsK6 = enumerateCells('K', 6);
  assert.equal(cellsK6.length, 6 * 36 + 36 + 1); // 253

  // Type K의 영역 포함 판정
  assert.equal(isInRegionK(0, 0, 4), true); // 원점
  assert.equal(isInRegionK(4, -8, 4), true); // 상단 삼각 꼭짓점
  assert.equal(isInRegionK(-4, 8, 4), true); // 하단 삼각 꼭짓점
  assert.equal(isInRegionK(9, 0, 4), false); // 범위 밖
});

test('중앙 19셀 판정 및 역할 분류가 동작한다', () => {
  assert.equal(isCenterCell('O', { q: 0, r: 0 }), true);
  assert.equal(isCenterCell('O', { q: 2, r: -2 }), true);
  assert.equal(isCenterCell('O', { q: 3, r: 0 }), false);

  const stateO = createUniversalEditorState({ type: 'O', size: 6, finderMode: 'central-finder' });
  assert.equal(roleOfCoord('O', 6, { q: 0, r: 0 }, { finderMode: 'central-finder' }), 'finder');
  assert.equal(roleOfCoord('O', 6, { q: 0, r: 0 }, { finderMode: 'full-surface' }), 'data');
  assert.equal(roleOfCoord('O', 6, { q: 6, r: 0 }), 'anchor');
});

test('붓(Brush) 도구와 드래그 연속 채색이 동작한다', () => {
  const state = createUniversalEditorState({ type: 'Y', size: 13 });
  const coord = { i: 5, j: 5 };

  // 단일 면 칠하기
  pushUndoSnapshot(state);
  const changed1 = applyBrush(state, 'T', coord, { tone: 0 });
  assert.equal(changed1, true);
  assert.equal(getCellTone(state, 'T', coord), 0);
  assert.equal(getCellTone(state, 'L', coord), DEFAULT_TONE);
  assert.equal(state.userNonData.has(coordKey('Y', coord)), true);

  // 셀 3면 전체 칠하기 (Shift+드래그 기능)
  pushUndoSnapshot(state);
  const changed2 = applyBrush(state, 'T', coord, { allFaces: true, tone: 2 });
  assert.equal(changed2, true);
  assert.equal(getCellTone(state, 'T', coord), 2);
  assert.equal(getCellTone(state, 'L', coord), 2);
  assert.equal(getCellTone(state, 'R', coord), 2);
});

test('페인트통(Bucket) 플러드 필 도구가 인접 영역을 정확히 채운다', () => {
  const state = createUniversalEditorState({ type: 'Y', size: 13 });

  // (3,3) 셀의 T/L/R 면을 모두 0(Dark)으로 설정
  setCellToneDirect(state, 'T', { i: 3, j: 3 }, 0);
  setCellToneDirect(state, 'L', { i: 3, j: 3 }, 0);
  setCellToneDirect(state, 'R', { i: 3, j: 3 }, 0);
  // 인접 셀 (3,2)의 R면도 0(Dark)으로 설정 (T of (3,3)과 맞닿음)
  setCellToneDirect(state, 'R', { i: 3, j: 2 }, 0);

  // 플러드 필로 0인 연결 영역을 2(Bright)로 일괄 변경
  pushUndoSnapshot(state);
  const changed = applyBucket(state, 'T', { i: 3, j: 3 }, 2);
  assert.equal(changed, true);

  assert.equal(getCellTone(state, 'T', { i: 3, j: 3 }), 2);
  assert.equal(getCellTone(state, 'L', { i: 3, j: 3 }), 2);
  assert.equal(getCellTone(state, 'R', { i: 3, j: 3 }), 2);
  assert.equal(getCellTone(state, 'R', { i: 3, j: 2 }), 2);

  // 연결되지 않았던 다른 셀은 기본값 유지
  assert.equal(getCellTone(state, 'T', { i: 0, j: 0 }), DEFAULT_TONE);
});

test('지우개(Eraser) 및 데이터 마스크 토글이 동작한다', () => {
  const state = createUniversalEditorState({ type: 'Y', size: 13 });
  const coord = { i: 6, j: 6 };

  applyBrush(state, 'T', coord, { tone: 0 });
  assert.equal(state.userNonData.has(coordKey('Y', coord)), true);

  // 지우개로 3면 전체 리셋
  applyEraser(state, 'T', coord, { allFaces: true });
  assert.equal(getCellTone(state, 'T', coord), DEFAULT_TONE);
  assert.equal(state.userNonData.has(coordKey('Y', coord)), false);

  // 데이터 마스크 토글
  const maskRes1 = applyMaskToggle(state, coord);
  assert.equal(maskRes1.changed, true);
  assert.equal(state.userNonData.has(coordKey('Y', coord)), true);

  const maskRes2 = applyMaskToggle(state, coord);
  assert.equal(maskRes2.changed, true);
  assert.equal(state.userNonData.has(coordKey('Y', coord)), false);
});

test('Undo / Redo 스택이 완벽한 불변성을 보장한다', () => {
  const state = createUniversalEditorState({ type: 'Y', size: 13 });
  const coord = { i: 4, j: 4 };

  assert.equal(undo(state), false); // 빈 스택 undo 불가

  pushUndoSnapshot(state);
  applyBrush(state, 'T', coord, { tone: 0 });
  assert.equal(getCellTone(state, 'T', coord), 0);

  pushUndoSnapshot(state);
  applyBrush(state, 'T', coord, { tone: 2 });
  assert.equal(getCellTone(state, 'T', coord), 2);

  // Undo 1단계
  assert.equal(undo(state), true);
  assert.equal(getCellTone(state, 'T', coord), 0);

  // Undo 2단계
  assert.equal(undo(state), true);
  assert.equal(getCellTone(state, 'T', coord), DEFAULT_TONE);

  // Redo 1단계
  assert.equal(redo(state), true);
  assert.equal(getCellTone(state, 'T', coord), 0);

  // Redo 2단계
  assert.equal(redo(state), true);
  assert.equal(getCellTone(state, 'T', coord), 2);
});

test('120° 회전 및 톤 반전이 동작한다', () => {
  const state = createUniversalEditorState({ type: 'O', size: 6, finderMode: 'full-surface' });
  const coord = { q: 1, r: 2 };

  setCellToneDirect(state, 'T', coord, 0);
  assert.equal(getCellTone(state, 'T', coord), 0);

  // 120° 회전: (1,2) -> (-3, 1), T -> R
  const rotated = rotate120(state);
  assert.equal(rotated, true);
  assert.equal(getCellTone(state, 'R', { q: -3, r: 1 }), 0);

  // 톤 반전: 0 -> 2
  invertAllTones(state);
  assert.equal(getCellTone(state, 'R', { q: -3, r: 1 }), 2);

  // 초기화
  resetAllTones(state);
  assert.equal(getCellTone(state, 'R', { q: -3, r: 1 }), DEFAULT_TONE);
});

test('JSON 직렬화 및 역직렬화 왕복이 일치한다', () => {
  const stateY = createUniversalEditorState({ type: 'Y', size: 21 });
  applyBrush(stateY, 'T', { i: 5, j: 5 }, { tone: 0 });
  applyBrush(stateY, 'L', { i: 5, j: 7 }, { tone: 2 });

  const jsonY = serializeUniversalEditor(stateY);
  assert.equal(jsonY.schema, CELL_EDITOR_SCHEMA_V1);
  assert.equal(jsonY.type, 'Y');
  assert.equal(jsonY.size, 21);
  assert.equal(jsonY.counts.detector, 2);

  const parsedY = parseUniversalEditor(jsonY);
  assert.equal(parsedY.type, 'Y');
  assert.equal(parsedY.size, 21);
  assert.equal(getCellTone(parsedY, 'T', { i: 5, j: 5 }), 0);
  assert.equal(getCellTone(parsedY, 'L', { i: 5, j: 7 }), 2);

  // Type O v2 직렬화
  const stateO = createUniversalEditorState({ type: 'O', size: 6, finderMode: 'central-finder' });
  applyBrush(stateO, 'R', { q: 3, r: -1 }, { tone: 2 });

  const jsonO = serializeUniversalEditor(stateO);
  assert.equal(jsonO.schema, CELL_EDITOR_SCHEMA_V2);
  assert.equal(jsonO.type, 'O');
  assert.equal(jsonO.finderMode, 'central-finder');

  const parsedO = parseUniversalEditor(jsonO);
  assert.equal(parsedO.type, 'O');
  assert.equal(getCellTone(parsedO, 'R', { q: 3, r: -1 }), 2);

  const hybrid = createUniversalEditorState({ type: 'A', finderStarter: 'cube-bullseye' });
  const jsonHybrid = serializeUniversalEditor(hybrid);
  assert.equal(jsonHybrid.finderStarter, 'cube-bullseye');
  assert.equal(jsonHybrid.finderPattern.renderKind, 'cube-bullseye');
  const parsedHybrid = parseUniversalEditor(jsonHybrid);
  assert.equal(parsedHybrid.finderPattern.renderKind, 'cube-bullseye');
  assert.equal(getCellTone(parsedHybrid, 'T', { q: 0, r: 0 }), 2);
  assert.equal(jsonHybrid.name, '');
});

test('손으로 정본화한 면 키 toneOverrides 방언도 읽는다 (조용한 톤 소실 금지)', () => {
  // 정본 문서(.agent/decoder/data/cellsurface-*-editor.json)는 편집기 export 를 사람이
  // 컴팩트하게 옮긴 것이라 톤을 **면 키 객체**로 적는다. 배열만 받던 시절엔
  // looksLikeCellEditorJson 이 true 라 붙여넣기가 «성공» 하면서 톤이 전부 사라졌다.
  const doc = {
    schema: CELL_EDITOR_SCHEMA_V1,
    n: 13,
    size: 13,
    finderMode: 'full-surface',
    userNonData: [[0, 0], [0, 1]],
    toneOverrides: {
      T: [[0, 0, 0], [0, 1, 2]],
      L: [[0, 0, 2]],
      R: [[0, 1, 0]],
    },
  };
  const parsed = parseUniversalEditor(doc);
  assert.equal(parsed.type, 'Y');
  assert.equal(parsed.tones.size, 4, '면 키 세 갈래의 톤이 전부 살아야 한다');
  assert.equal(getCellTone(parsed, 'T', { i: 0, j: 0 }), 0);
  assert.equal(getCellTone(parsed, 'T', { i: 0, j: 1 }), 2);
  assert.equal(getCellTone(parsed, 'L', { i: 0, j: 0 }), 2);
  assert.equal(getCellTone(parsed, 'R', { i: 0, j: 1 }), 0);
  assert.equal(parsed.userNonData.size, 2);

  // 빈 객체 방언(톤 오버라이드 없음)도 그냥 통과한다.
  assert.equal(parseUniversalEditor({ ...doc, toneOverrides: {} }).tones.size, 0);

  // 평평한 배열 방언(편집기 export)은 그대로다 — 두 방언이 같은 상태를 만든다.
  const flat = parseUniversalEditor({
    ...doc,
    toneOverrides: [['T', 0, 0, 0], ['T', 0, 1, 2], ['L', 0, 0, 2], ['R', 0, 1, 0]],
  });
  assert.deepEqual(
    serializeUniversalEditor(flat), serializeUniversalEditor(parsed),
    '두 방언이 같은 문서로 수렴해야 한다',
  );

  // (해소 2026-08-17 — 스캐너 스탬프 상승과 동반) Y 전용 엔진 파서도 면 키 방언을
  // 받는다. 규칙은 core 정본의 **복제**다 (스캐너 번들에 core 를 끌어들이지 않는
  // 대가) — 두 구현이 갈라지면 이 수렴 단언이 잡는다.
  const engineFaceKey = parseCellEditor({ ...doc, schema: CELL_EDITOR_SCHEMA_V1 });
  assert.equal(engineFaceKey.tones.size, 4, 'Y 엔진 파서가 면 키 방언 톤을 소실했다');
  const engineFlat = parseCellEditor({
    ...doc,
    schema: CELL_EDITOR_SCHEMA_V1,
    toneOverrides: [['T', 0, 0, 0], ['T', 0, 1, 2], ['L', 0, 0, 2], ['R', 0, 1, 0]],
  });
  assert.deepEqual(
    [...engineFaceKey.tones.entries()].sort(),
    [...engineFlat.tones.entries()].sort(),
    'Y 엔진 파서에서 두 방언이 같은 상태로 수렴해야 한다',
  );
});

test('컴팩트 JSON 출력은 undefined 를 만나도 유효한 JSON 이다', () => {
  // JSON.stringify 와 같은 규칙 — 객체 키는 빼고 배열 원소는 null.
  assert.equal(stringifyCompactJson({ a: undefined }), '{}');
  assert.equal(stringifyCompactJson({ a: 1, b: undefined, c: 2 }), '{\n  "a": 1,\n  "c": 2\n}');
  assert.equal(stringifyCompactJson([1, undefined, 3]), '[1, null, 3]');
  for (const value of [{ a: undefined }, { a: 1, b: undefined }, [1, undefined, 3]]) {
    assert.deepEqual(
      JSON.parse(stringifyCompactJson(value)), JSON.parse(JSON.stringify(value)),
      'JSON.stringify 와 같은 결과여야 한다',
    );
  }
});

test('파인더 이름이 JSON name으로 왕복하고 공백을 정규화한다', () => {
  assert.equal(normalizeFinderName('  내   바람개비  '), '내 바람개비');
  assert.equal(normalizeFinderName('x'.repeat(100)).length, 80);

  const state = createUniversalEditorState({
    type: 'O',
    finderStarter: 'pinwheel-3-0101-cw-missing-solid',
    finderName: '  실험용 핀휠  ',
  });
  const json = serializeUniversalEditor(state);
  assert.equal(json.name, '실험용 핀휠');
  assert.equal(json.finderPattern.name, '실험용 핀휠');

  const parsed = parseUniversalEditor(json);
  assert.equal(parsed.finderName, '실험용 핀휠');

  const fromAlias = parseUniversalEditor({
    ...json,
    name: undefined,
    finderName: '별칭 이름',
  });
  assert.equal(fromAlias.finderName, '별칭 이름');

  const fromPattern = parseUniversalEditor({
    schema: json.schema,
    type: 'O',
    finderPattern: { ...json.finderPattern, name: '패턴 안 이름' },
  });
  assert.equal(fromPattern.finderName, '패턴 안 이름');

  const stateY = createUniversalEditorState({ type: 'Y', finderName: 'Y 셀표면 초안' });
  const jsonY = serializeUniversalEditor(stateY);
  assert.equal(jsonY.schema, CELL_EDITOR_SCHEMA_V1);
  assert.equal(jsonY.name, 'Y 셀표면 초안');
  assert.equal(parseUniversalEditor(jsonY).finderName, 'Y 셀표면 초안');
});

test('중앙 파인더 프리셋(불스아이, 3톤 큐브 등) 선택에 따라 중앙 19셀 톤이 즉시 변경된다', () => {
  // 불스아이 상태 생성
  const stateBullseye = createUniversalEditorState({
    type: 'O',
    size: 6,
    finderMode: 'central-finder',
    finderStarter: 'bullseye',
  });
  assert.equal(stateBullseye.finderPattern.renderKind, 'cell-mask');
  // 원점(0,0)의 불스아이 중심 톤 확인 (T 면 = 0)
  assert.equal(getCellTone(stateBullseye, 'T', { q: 0, r: 0 }), 0);

  // 3톤 큐브 상태 생성
  const stateCube = createUniversalEditorState({
    type: 'O',
    size: 6,
    finderMode: 'central-finder',
    finderStarter: 'central-cube-3tone',
  });
  assert.equal(stateCube.finderPattern.renderKind, 'three-tone-cube');
  assert.equal(getCellTone(stateCube, 'T', { q: 0, r: 0 }), 2); // T: 2 (Bright)
  assert.equal(getCellTone(stateCube, 'L', { q: 0, r: 0 }), 1); // L: 1 (Mid)
  assert.equal(getCellTone(stateCube, 'R', { q: 0, r: 0 }), 0); // R: 0 (Dark)

  // 프리셋 변경 적용 (다른 파인더 마스크 패턴)
  stateBullseye.finderPattern = {
    renderKind: 'cell-mask',
    cellMasks: new Array(19).fill(7), // 모든 면 Bright(2)
  };
  assert.equal(getCellTone(stateBullseye, 'T', { q: 0, r: 0 }), 2);
  assert.equal(getCellTone(stateBullseye, 'L', { q: 0, r: 0 }), 2);
  assert.equal(getCellTone(stateBullseye, 'R', { q: 0, r: 0 }), 2);
});

test('타입 기본 격자 크기는 Y n=11, O/A/K k=4 이다', () => {
  assert.equal(createUniversalEditorState().type, 'Y');
  assert.equal(createUniversalEditorState().size, DEFAULT_SIZE_Y);
  assert.equal(defaultSizeForType('Y'), 11);
  for (const type of ['O', 'A', 'K']) {
    const state = createUniversalEditorState({ type });
    assert.equal(defaultSizeForType(type), DEFAULT_SIZE_HEX);
    assert.equal(state.size, 4);
    assert.equal(state.finderMode, 'central-finder');
    assert.equal(state.finderStarter, 'bullseye');
    assert.equal(state.finderPattern.renderKind, 'cell-mask');
  }

  const parsedO = parseUniversalEditor({
    schema: CELL_EDITOR_SCHEMA_V2,
    type: 'O',
    userNonData: [],
    toneOverrides: [],
  });
  assert.equal(parsedO.size, 4);

  const parsedY = parseUniversalEditor({
    schema: CELL_EDITOR_SCHEMA_V1,
    type: 'Y',
    userNonData: [],
    toneOverrides: [],
  });
  assert.equal(parsedY.size, 11);
});

test('O/A/K 파인더 프리셋은 중앙 19셀에 즉시 반영되고 하이브리드도 복제된다', () => {
  const starters = listFinderStarters();
  const ids = starters.map((item) => item.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(ids.includes('bullseye'));
  assert.ok(ids.includes('central-cube-3tone'));
  assert.ok(ids.includes('cube-bullseye'));
  assert.equal(starters.find((item) => item.id === 'cube-bullseye').renderKind, 'cube-bullseye');

  const fingerprint = (state) => FINDER_CELL_ORDER
    .flatMap((cell) => FACES.map((face) => getCellTone(state, face, cell)))
    .join('');

  for (const type of ['O', 'A', 'K']) {
    for (const starter of starters) {
      const state = createUniversalEditorState({ type, finderStarter: starter.id });
      assert.equal(state.size, 4);
      assert.ok(state.finderPattern);
      assert.equal(state.finderPattern.renderKind, starter.renderKind);
      assert.equal(state.finderStarter, starter.id);
    }

    const state = createUniversalEditorState({ type, finderStarter: 'bullseye' });
    const before = fingerprint(state);
    applyFinderStarter(state, 'central-cube-3tone');
    assert.equal(state.finderPattern.renderKind, 'three-tone-cube');
    assert.equal(getCellTone(state, 'T', { q: 0, r: 0 }), 2);
    assert.equal(getCellTone(state, 'L', { q: 0, r: 0 }), 1);
    assert.equal(getCellTone(state, 'R', { q: 0, r: 0 }), 0);
    assert.notEqual(fingerprint(state), before);

    applyFinderStarter(state, 'pinwheel-3-0101-cw-missing-solid');
    assert.equal(state.finderPattern.renderKind, 'cell-mask');
    assert.notEqual(fingerprint(state), before);

    applyFinderStarter(state, 'cube-bullseye');
    assert.equal(state.finderPattern.renderKind, 'cube-bullseye');
    assert.equal(getCellTone(state, 'T', { q: 0, r: 0 }), 2);
  }
});

test('타입 전환 스냅샷은 최소 크기 기본값을 되돌린다', () => {
  const state = createUniversalEditorState({ type: 'Y' });
  assert.equal(state.size, 11);
  pushUndoSnapshot(state);
  state.type = 'O';
  state.size = defaultSizeForType('O');
  applyFinderStarter(state, 'bullseye');
  assert.equal(state.size, 4);
  assert.equal(undo(state), true);
  assert.equal(state.type, 'Y');
  assert.equal(state.size, 11);
});

test('붙여넣기용 JSON 판별과 공백 포함 문자열이 왕복한다', () => {
  const state = createUniversalEditorState({ type: 'O', finderStarter: 'cube-bullseye' });
  applyBrush(state, 'T', { q: 3, r: 0 }, { tone: 0 });
  const dumped = `  \n${JSON.stringify(serializeUniversalEditor(state), null, 2)}\n`;
  assert.equal(looksLikeCellEditorJson(dumped), true);
  assert.equal(looksLikeCellEditorJson('{ "not": "editor" }'), false);
  assert.equal(looksLikeCellEditorJson('not json'), false);

  const parsed = parseUniversalEditor(dumped);
  assert.equal(parsed.type, 'O');
  assert.equal(parsed.finderPattern.renderKind, 'cube-bullseye');
  assert.equal(getCellTone(parsed, 'T', { q: 3, r: 0 }), 0);
});

// 의도적 갱신 (2026-08-16, 포맷 v2): Y 편집기는 신세대 셀 표면 정본을 그리는 도구라
// 미리보기도 포맷 v2(18셀)로 유도한다. v1(15셀)은 옵션으로만 남는다.
test('Type Y 미리보기는 칠한 셀에서 ref/format 을 비킨다', () => {
  const state = createUniversalEditorState({ type: 'Y', size: 21 });
  const empty = previewAutoplaceY(state);
  assert.equal(empty.ok, true);
  assert.equal(empty.placement.formatCells.length, 18);
  assert.equal(empty.placement.formatBlockLength, 6);
  assert.equal(empty.placement.referenceCells.length, 12);
  // 세대를 명시하면 레거시 15셀 유도도 그대로 나온다.
  const legacy = previewAutoplaceY(state, { formatBlockLength: 5 });
  assert.equal(legacy.placement.formatCells.length, 15);

  applyBrush(state, 'T', { i: 2, j: 2 }, { allFaces: true, tone: 0 });
  applyBrush(state, 'T', { i: 3, j: 2 }, { allFaces: true, tone: 0 });
  applyBrush(state, 'T', { i: 2, j: 3 }, { allFaces: true, tone: 0 });
  const preview = previewAutoplaceY(state);
  assert.equal(preview.ok, true);
  assert.equal(preview.roles.has('2,2'), false);
  assert.equal(preview.roles.has('3,2'), false);
  assert.equal(preview.roles.has('2,3'), false);
  assert.equal(roleOfCoord('Y', 21, { i: 2, j: 2 }, { roles: preview.roles }), 'data');
  const reserved = [...preview.roles.values()];
  assert.equal(reserved.filter((entry) => entry.role === 'reference').length, 12);
  assert.equal(reserved.filter((entry) => entry.role === 'format').length, 18);
});

test('독립 HTML 단일 번들이 정상적으로 빌드된다', () => {
  const html = buildCellEditorHtml();
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /id="cellCanvas"/);
  assert.match(html, /id="toolBrush"/);
  assert.match(html, /id="toolBucket"/);
  assert.match(html, /id="undoBtn"/);
  assert.match(html, /id="redoBtn"/);
  assert.match(html, /Type K/);
  assert.match(html, /data-i18n="title"/);
  assert.match(html, /Type Y \(n=11\)/);
  assert.match(html, /applyFinderStarter/);
  assert.match(html, /cube-bullseye/);
  assert.match(html, /id="jsonPaste"/);
  assert.match(html, /id="applyPasteJsonBtn"/);
  assert.match(html, /id="clipboardJsonBtn"/);
  assert.match(html, /id="finderNameInput"/);
  assert.match(html, /id="autoplaceHint"/);
  assert.match(html, /autoplaceY/);
  assert.match(html, /looksLikeCellEditorJson/);
  assert.doesNotMatch(html, /<!-- CELL_EDITOR_LOADER -->/);
});

test('독립 편집기도 «실제 변경 없으면 스텝 없음»·붓질 자가 치유·수식키 가드를 쓴다', () => {
  const app = readFileSync(ROOT + 'tools/cell-editor-app.js', 'utf8');
  // 예약 → 첫 실제 편집에서 확정. 누른 순간 무조건 스텝을 쌓던 배선 금지.
  assert.match(app, /armEditStroke\(editorState\)/);
  assert.doesNotMatch(app, /beginEditStroke\(/);
  // 도구 실행은 전부 commitCellEdit 를 지난다 (마스크·우클릭·버킷·지우개·붓).
  assert.ok(
    (app.match(/commitCellEdit\(/g) || []).length >= 6,
    '도구 경로가 commit 을 안 지나면 빈 스텝·미기록이 다시 생긴다',
  );
  // 창 밖에서 버튼을 떼도 스트로크가 열린 채 남지 않는다.
  assert.match(app, /if \(isPointerDown && ev\.buttons === 0\) stopPointerStroke\(\);/);
  assert.match(app, /function stopPointerStroke\(\)/);
  // 되돌리기/다시하기는 진행 중인 붓질을 먼저 끝낸다 (버튼·단축키 양쪽).
  assert.ok(
    (app.match(/stopPointerStroke\(\);\s*\n\s*if \((undo|redo)\(editorState\)\)/g) || []).length
      === 4,
    'undo/redo 네 경로(버튼 2 · 단축키 2)가 모두 붓질을 끝내야 한다',
  );
  // 도구 단축키는 수식키 없는 맨 키에서만 — Ctrl+B/Ctrl+E/Cmd+I 가로채기 금지.
  assert.match(app, /if \(ev\.ctrlKey \|\| ev\.metaKey \|\| ev\.altKey\) return;/);
});
