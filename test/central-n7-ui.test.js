import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CENTRAL_FINDER_CARD_LINEUP, CENTRAL_N7_FINDER_CARD,
  FINDER_CARD_GROUPS,
  centralN7ThumbnailCells,
  getUnmeasuredFinderPattern,
  isDroppedFinderPatternId,
  labOnlyFinderCardsVisible,
  labOnlyFinderSelectionAllowed,
  sanitizeFinderCardState,
} from '../src/finder-card-ui.js';
import {
  CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
  centralMarkerN7State,
} from '../src/centralMarkerN7.js';
import {
  CENTRAL_N7_DATA_SCAN_ORDER,
  CENTRAL_N7_FINDER_PATTERN_ID,
  CENTRAL_N7_LOCATOR_CELLS,
} from '../src/centralN7Schema.js';
import { decodeCentralN7 } from '../src/centralN7Codec.js';
import {
  CENTRAL_N7_EMPHASIS_MODES, DEFAULT_CENTRAL_N7_EMPHASIS,
} from '../src/centralN7Emphasis.js';
import {
  GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  GENERATOR_STATE_SCHEMA,
} from '../src/generator-state.js';
import { SUPPORTED_LANGUAGES } from '../src/i18n.js';

function key(cell) {
  return cell.i + ',' + cell.j;
}

function objectLiteralAfter(source, declaration) {
  const declarationAt = source.indexOf(declaration);
  if (declarationAt < 0) throw new Error('선언을 찾지 못했다: ' + declaration);
  const open = source.indexOf('{', declarationAt + declaration.length);
  if (open < 0) throw new Error('객체 시작을 찾지 못했다: ' + declaration);

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error('객체 끝을 찾지 못했다: ' + declaration);
}

test('중앙 카드 명부 status가 카드 표면을 live-join하고 M7 기하는 보존한다', () => {
  const allCardIds = new Set(Object.values(FINDER_CARD_GROUPS).flat().map((card) => card.id));
  for (const entry of CENTRAL_FINDER_CARD_LINEUP) {
    assert.equal(allCardIds.has(entry.card.id), entry.status === 'active', entry.card.id);
  }
  const m7 = CENTRAL_FINDER_CARD_LINEUP.find(
    (entry) => entry.card.id === CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
  );
  const tl = CENTRAL_FINDER_CARD_LINEUP.find(
    (entry) => entry.card.id === CENTRAL_N7_FINDER_PATTERN_ID,
  );
  assert.equal(m7.status, 'dropped');
  assert.equal(isDroppedFinderPatternId(m7.card.id), true);
  assert.equal(tl.status, 'active');
  assert.equal(tl.surface, 'formal');
  assert.equal(FINDER_CARD_GROUPS.formal.includes(CENTRAL_N7_FINDER_CARD), true);
  assert.equal(centralMarkerN7State('hex', 0, 0).cells.length > 0, true,
    'M7 카드는 닫아도 기하 모듈은 살아 있어야 한다');
  assert.equal(CENTRAL_N7_FINDER_CARD.id, CENTRAL_N7_FINDER_PATTERN_ID);
  assert.equal(getUnmeasuredFinderPattern(CENTRAL_N7_FINDER_PATTERN_ID).labelKey, 'g1001');
  assert.ok(GENERATOR_STATE_SCHEMA.finderPatternId.options.includes(CENTRAL_N7_FINDER_PATTERN_ID));
  assert.equal(GENERATOR_STATE_SCHEMA.centralN7Emphasis.defaultValue,
    DEFAULT_CENTRAL_N7_EMPHASIS);
  assert.deepEqual(GENERATOR_STATE_SCHEMA.centralN7Emphasis.options,
    CENTRAL_N7_EMPHASIS_MODES);
  assert.equal(GENERATOR_STATE_SCHEMA.finderPatternId.options.includes(
    CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
  ), false);
});

test('중앙 TL은 정식 선택 가능하고 드랍 M7 저장 상태는 모든 표면에서 중앙 TL로 정화된다', () => {
  assert.equal(labOnlyFinderCardsVisible(false), false);
  assert.equal(labOnlyFinderCardsVisible(true), true);
  assert.equal(labOnlyFinderSelectionAllowed(CENTRAL_N7_FINDER_PATTERN_ID, false), true);
  assert.equal(labOnlyFinderSelectionAllowed(CENTRAL_N7_FINDER_PATTERN_ID, true), true);
  assert.equal(labOnlyFinderSelectionAllowed(CENTRAL_MARKER_N7_FINDER_PATTERN_ID, false), false);
  assert.equal(labOnlyFinderSelectionAllowed(CENTRAL_MARKER_N7_FINDER_PATTERN_ID, true), false);
  const unsafe = {
    finderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
    previousFinderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
    finderQrProfiles: Object.freeze({
      OA: Object.freeze({
        finderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
        previousFinderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
      }),
    }),
  };
  for (const lab of [false, true]) {
    const safe = sanitizeFinderCardState(
      unsafe, lab, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    );
    assert.equal(safe.finderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID);
    assert.equal(safe.previousFinderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID);
    assert.equal(safe.finderQrProfiles.OA.finderPatternId,
      GENERATOR_DEFAULT_FINDER_PATTERN_ID);
  }
});

test('기존의 살아 있는 카드 선택은 기본값 변경 뒤에도 정화 과정에서 보존된다', () => {
  for (const card of Object.values(FINDER_CARD_GROUPS).flat()) {
    const oldState = {
      finderPatternId: card.id,
      previousFinderPatternId: card.id,
      finderQrProfiles: Object.freeze({
        OA: Object.freeze({ finderPatternId: card.id, previousFinderPatternId: card.id }),
      }),
    };
    assert.strictEqual(sanitizeFinderCardState(
      oldState, true, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    ), oldState, card.id);
  }
});

test('새 아이콘은 정본 locator 30 + scan-order data 19이며 후보 B 아이콘과 다르다', () => {
  const cells = centralN7ThumbnailCells();
  assert.equal(cells.length, 49);
  assert.equal(new Set(cells.map(key)).size, 49);

  const locator = cells.filter((cell) => cell.role === 'locator');
  const data = cells.filter((cell) => cell.role === 'data');
  assert.equal(locator.length, CENTRAL_N7_LOCATOR_CELLS.length);
  assert.equal(data.length, CENTRAL_N7_DATA_SCAN_ORDER.length);
  assert.deepEqual(new Set(locator.map(key)), new Set(CENTRAL_N7_LOCATOR_CELLS.map(key)));
  assert.deepEqual(new Set(data.map(key)), new Set(CENTRAL_N7_DATA_SCAN_ORDER.map(key)));

  const dataByKey = new Map(data.map((cell) => [key(cell), cell]));
  const decoded = decodeCentralN7(CENTRAL_N7_DATA_SCAN_ORDER.map(
    (cell) => dataByKey.get(key(cell)).digit,
  ));
  assert.notEqual(decoded, null);
  assert.equal(decoded.family, 'hex');

  const candidate = centralMarkerN7State('hex', 0, 0).cells;
  const toneSignature = (items) => items
    .map((cell) => `${key(cell)}:${cell.T}${cell.L}${cell.R}`).sort();
  assert.notDeepEqual(toneSignature(cells), toneSignature(candidate));
});

test('생성기 i18n은 8개 언어 모두에 후보 B·새 카드 키가 존재한다', () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const literal = objectLiteralAfter(source, 'const GENERATOR_STRINGS =');
  const strings = Function('"use strict"; return (' + literal + ');')();
  assert.deepEqual(Object.keys(strings), [...SUPPORTED_LANGUAGES]);
  assert.equal(Object.keys(strings).length, 8);
  for (const language of SUPPORTED_LANGUAGES) {
    for (const key of ['g1000', 'g1001', 'g1002', 'g1003', 'g1004', 'g1005', 'g1006', 'g1007', 'g1008']) {
      assert.equal(Object.hasOwn(strings[language], key), true, language + ' ' + key);
    }
  }
});

test('중앙 TL 강조 UI는 3택 상태와 O/A/K + 중앙 TL 가시성에 배선된다', () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sharedKeys = source.match(/id="sharedControls" data-state-keys="([^"]+)"/u)?.[1]
    .split(/\s+/u) || [];
  assert.ok(sharedKeys.includes('centralN7Emphasis'));
  assert.match(source, /id="centralN7EmphasisSection" hidden/);
  for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
    assert.match(source, new RegExp(`data-n7-emphasis="${mode}"`));
  }
  assert.match(source, /\['O', 'A', 'K'\]\.includes\(generatorState\.type\)/);
  assert.match(source, /generatorState\.finderPatternId === CENTRAL_N7_FINDER_PATTERN_ID/);
  assert.match(source, /centralN7Emphasis: cfg\.centralN7Emphasis/);
  assert.match(source, /sceneOpts\.centralN7Emphasis = cfg\.centralN7Emphasis/);
});
