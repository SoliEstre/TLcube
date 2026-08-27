import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CENTRAL_N7_FINDER_CARD,
  FINDER_CARD_GROUPS,
  centralN7ThumbnailCells,
  getUnmeasuredFinderPattern,
  labOnlyFinderCardsVisible,
  labOnlyFinderSelectionAllowed,
  sanitizeLabOnlyFinderState,
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

test('시험판 카드 표에는 중앙 M7·중앙 TL 두 장만 있고 formal에는 둘 다 없다', () => {
  assert.deepEqual(FINDER_CARD_GROUPS.lab.map((card) => card.id), [
    CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
    CENTRAL_N7_FINDER_PATTERN_ID,
  ]);
  const formalIds = new Set(FINDER_CARD_GROUPS.formal.map((card) => card.id));
  assert.equal(formalIds.has(CENTRAL_MARKER_N7_FINDER_PATTERN_ID), false);
  assert.equal(formalIds.has(CENTRAL_N7_FINDER_PATTERN_ID), false);
  assert.equal(CENTRAL_N7_FINDER_CARD.id, CENTRAL_N7_FINDER_PATTERN_ID);
  assert.equal(getUnmeasuredFinderPattern(CENTRAL_N7_FINDER_PATTERN_ID).labelKey, 'g1001');
  assert.ok(GENERATOR_STATE_SCHEMA.finderPatternId.options.includes(CENTRAL_N7_FINDER_PATTERN_ID));
});

test('두 시험판 카드 모두 정식에서 비노출·선택 거부·저장 상태 복구된다', () => {
  assert.equal(labOnlyFinderCardsVisible(false), false);
  assert.equal(labOnlyFinderCardsVisible(true), true);
  for (const id of [CENTRAL_MARKER_N7_FINDER_PATTERN_ID, CENTRAL_N7_FINDER_PATTERN_ID]) {
    assert.equal(labOnlyFinderSelectionAllowed(id, false), false, id);
    assert.equal(labOnlyFinderSelectionAllowed(id, true), true, id);
    const unsafe = {
      finderPatternId: id,
      previousFinderPatternId: id,
      finderQrProfiles: Object.freeze({
        OA: Object.freeze({ finderPatternId: id, previousFinderPatternId: id }),
      }),
    };
    const safe = sanitizeLabOnlyFinderState(
      unsafe, false, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    );
    assert.equal(safe.finderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID, id);
    assert.equal(safe.previousFinderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID, id);
    assert.equal(safe.finderQrProfiles.OA.finderPatternId,
      GENERATOR_DEFAULT_FINDER_PATTERN_ID, id);
    assert.strictEqual(sanitizeLabOnlyFinderState(
      unsafe, true, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    ), unsafe, id + ' lab state');
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
    assert.equal(Object.hasOwn(strings[language], 'g1000'), true, language + ' g1000');
    assert.equal(Object.hasOwn(strings[language], 'g1001'), true, language + ' g1001');
  }
});
