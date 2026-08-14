/**
 * type-y-cell-editor-lab.test.js — /lab/ + Type Y 전용 노출·i18n·접근성·번들.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildGeneratorLabHtml } from '../tools/build-gen-variants.mjs';
import { buildSingleHtml, OFFICIAL_GENERATOR_EDITION } from '../tools/build-single.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

const I18N_KEYS = [
  'g521', 'g522', 'g523', 'g524', 'g525', 'g526', 'g527', 'g528', 'g529',
  'g530', 'g531', 'g532', 'g533', 'g534', 'g535', 'g536', 'g537', 'g538',
  'g539', 'g540',
];

function langBlock(lang) {
  const start = INDEX.indexOf('const GENERATOR_STRINGS = {');
  const at = INDEX.search(new RegExp(`["']?${lang}["']?\\s*:\\s*\\{`, 'm'));
  assert.ok(start >= 0 && at > start, `${lang} 사전을 못 찾았다`);
  const open = INDEX.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < INDEX.length; i += 1) {
    if (INDEX[i] === '{') depth += 1;
    else if (INDEX[i] === '}') {
      depth -= 1;
      if (depth === 0) return INDEX.slice(open, i + 1);
    }
  }
  throw new Error(`${lang} 사전이 닫히지 않는다`);
}

test('/lab/ + Type Y 에서만 섹션을 열고 정식·O/A 에서는 숨긴다', () => {
  assert.match(INDEX, /id="yCellEditorSection"/);
  assert.match(INDEX, /data-i18n="g521"/);
  assert.match(INDEX, /function syncTypeYCellEditorUi\(\)/);
  assert.match(INDEX, /isLabPath\(\) && generatorState\.type === 'Y'/);
  assert.match(INDEX, /if \(isLabPath\(\)\) wireTypeYCellEditor\(\)/);
  assert.match(INDEX, /section\.hidden = !show/);
  assert.doesNotMatch(INDEX, /applyToneEdit\([^)]*current/);
  assert.doesNotMatch(INDEX, /stringifyCellEditor\([^)]*encodeY/);
});

test('셀 편집기 문구는 ko/en/ja 키가 같고 우클릭·키보드·접근성 마크업이 있다', () => {
  for (const key of I18N_KEYS) {
    for (const lang of ['ko', 'en', 'ja']) {
      assert.match(langBlock(lang), new RegExp('"' + key + '"\\s*:'), `${lang} 에 ${key} 가 없다`);
    }
  }
  assert.match(INDEX, /contextmenu/);
  assert.match(INDEX, /preventDefault\(\)/);
  assert.match(INDEX, /closest\('\.y-cell-editor-cell'\)/);
  assert.match(INDEX, /ev\.key === 'Enter' \|\| ev\.key === ' '/);
  assert.match(INDEX, /ev\.shiftKey \? TONE_BRIGHTEN : TONE_DARKEN/);
  assert.match(INDEX, /editYCell\(cell\.face, cell\.i, cell\.j, direction, true\)/);
  assert.match(INDEX, /next\.focus\(\{ preventScroll: true \}\)/);
  assert.match(INDEX, /setAttribute\('role', 'button'\)/);
  assert.match(INDEX, /tf\('g533'/);
  assert.match(INDEX, /aria-live="polite"/);
  assert.match(INDEX, /id="yCellEditorJson"/);
  assert.match(INDEX, /id="yCellEditorStatus"/);
  assert.match(INDEX, /y-cell-editor-viewport/);
  assert.match(INDEX, /overflow:\s*auto/);
});

test('시험판 번들에도 섹션이 있고 안정판은 런타임에 숨기며 모듈이 임베드된다', () => {
  const lab = buildGeneratorLabHtml();
  const official = buildSingleHtml({ generatorEdition: OFFICIAL_GENERATOR_EDITION });
  assert.match(lab, /id="yCellEditorSection"/);
  assert.match(lab, /data-i18n="g521"/);
  assert.match(official, /id="yCellEditorSection"/);
  assert.match(official, /if \(isLabPath\(\)\) wireTypeYCellEditor\(\)/);
  assert.match(official, /isLabPath\(\) && generatorState\.type === 'Y'/);
  assert.match(lab, /\["type-y-cell-editor"/);
  assert.match(official, /\["type-y-cell-editor"/);
});
