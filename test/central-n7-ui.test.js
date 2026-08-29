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
  CENTRAL_N7_EMPHASIS_MODES, GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS,
} from '../src/centralN7Emphasis.js';
import { centralN7EmphasisAppliesTo } from '../src/generator-render-config.js';
import { CENTER_QR_FINDER_PATTERN_ID, CENTRAL_V0_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import {
  CUBE_BULLSEYE_FINDER_PATTERN_ID, LEGACY_FINDER_PATTERN_ID,
  THREE_TONE_CUBE_FINDER_PATTERN_ID,
} from '../src/finder-patterns.js';
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
  // **자 교정 (2026-08-29, 완화 아님)** — 종전 단언은 «UI 기본 = 라이브러리 기본»
  // 이라는 배치를 고정했다. 운영자 결정 §3(전체 강조 기본)으로 두 축이 갈라졌으므로,
  // 재는 성질을 «스키마 기본 = 생성기 기본 상수(= 'all')» 로 재조준한다. 라이브러리
  // 기본('default') 불변은 central-n7-emphasis.test.js 가 잰다.
  assert.equal(GENERATOR_STATE_SCHEMA.centralN7Emphasis.defaultValue,
    GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS);
  assert.equal(GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS, 'all');
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

test('중앙 강조 UI는 3택 상태와 O/A/K × 적용 파인더 가시성에 배선된다', () => {
  // **자 교정 (2026-08-29, 완화 아님)** — 종전 단언은 가시성 술어를 «중앙 TL 하나»
  // 라는 배치로 고정했다. 운영자 결정 §4(3톤 큐브·중앙 Y0 확장)로 재는 성질을
  // «정본 술어(centralN7EmphasisAppliesTo)를 소비하는가» + 그 술어의 값 표로 재조준.
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sharedKeys = source.match(/id="sharedControls" data-state-keys="([^"]+)"/u)?.[1]
    .split(/\s+/u) || [];
  assert.ok(sharedKeys.includes('centralN7Emphasis'));
  assert.match(source, /id="centralN7EmphasisSection" hidden/);
  for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
    assert.match(source, new RegExp(`data-n7-emphasis="${mode}"`));
  }
  assert.match(source, /\['O', 'A', 'K'\]\.includes\(generatorState\.type\)/);
  assert.match(source, /centralN7EmphasisAppliesTo\(generatorState\.finderPatternId\)/,
    '강조 섹션 가시성이 정본 술어를 안 쓴다 — 손 사본이 생겼다');
  assert.match(source, /centralN7Emphasis: cfg\.centralN7Emphasis/);
  assert.match(source, /sceneOpts\.centralN7Emphasis = cfg\.centralN7Emphasis/);
  // 적용 대상의 정본 값 표 (2026-08-29 §4) — 소스 철자가 아니라 술어 값으로 잰다.
  // ⛔ 3톤 큐브는 §2.4 왕복 자에서 **거부**됐다 (강조 순검정이 어두운 프리셋 배경
  // 마스크에 먹혀 실루엣 검출 전패 — generator-render-config 주석 실측). true 로
  // 되돌리려면 central-emphasis-roundtrip 의 큐브 왕복부터 다시 세워라.
  assert.equal(centralN7EmphasisAppliesTo(CENTRAL_N7_FINDER_PATTERN_ID), true);
  assert.equal(centralN7EmphasisAppliesTo(CENTRAL_V0_FINDER_PATTERN_ID), true);
  assert.equal(centralN7EmphasisAppliesTo(THREE_TONE_CUBE_FINDER_PATTERN_ID), false,
    '3톤 큐브 강조는 2026-08-29 §2.4 실측 거부다 — 왕복 자 없이 되살리면 안 된다');
  assert.equal(centralN7EmphasisAppliesTo(CUBE_BULLSEYE_FINDER_PATTERN_ID), false,
    'cube-bullseye 는 결정 범위 밖이다 («3톤 큐브 파인더와 중앙 Y0»)');
  assert.equal(centralN7EmphasisAppliesTo(LEGACY_FINDER_PATTERN_ID), false);
  assert.equal(centralN7EmphasisAppliesTo(CENTER_QR_FINDER_PATTERN_ID), false);
  // §5 스와치 — 색 계산이 UI 자체 산술이 아니라 강조 모듈 함수를 소비한다.
  assert.match(source, /function centralN7EmphasisSwatchTones\(/);
  assert.match(source, /centralN7LevelPalettes\(levels, mode\)/);
  // 팔레트 변경 트리거 — 스타일 sync 가 스와치 재도색을 부른다 (파생값 트리거 규율).
  const styleSync = source.slice(
    source.indexOf('function syncStyleUi()'),
    source.indexOf('els.customStyleCard.addEventListener'),
  );
  assert.match(styleSync, /syncCentralN7EmphasisUi\(\);/,
    '프리셋·hue 변경이 스와치를 다시 칠하지 않는다');
});
