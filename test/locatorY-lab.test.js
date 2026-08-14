/**
 * locatorY-lab.test.js — 로케이터 옵션이 시험판 전용·다국어·상태 보존·번들 포함인지.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  GENERATOR_STATE_SCHEMA,
  createGeneratorState,
  exposedGeneratorStateKeys,
} from '../src/generator-state.js';
import {
  DEFAULT_LOCATOR_PROFILE_Y,
  LOCATOR_PROFILE_HEX_FRAME_V1,
  LOCATOR_PROFILE_OFF,
} from '../src/locatorY.js';
import { buildGeneratorLabHtml } from '../tools/build-gen-variants.mjs';
import { buildSingleHtml, OFFICIAL_GENERATOR_EDITION } from '../tools/build-single.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

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

test('locatorProfileY 는 내부 상태이고 기본은 off 이며 왕복 선택지가 있다', () => {
  const state = createGeneratorState();
  assert.equal(state.locatorProfileY, DEFAULT_LOCATOR_PROFILE_Y);
  assert.equal(state.locatorProfileY, LOCATOR_PROFILE_OFF);
  assert.equal(GENERATOR_STATE_SCHEMA.locatorProfileY.exposure, 'internal');
  assert.deepEqual(
    [...GENERATOR_STATE_SCHEMA.locatorProfileY.options],
    [LOCATOR_PROFILE_OFF, LOCATOR_PROFILE_HEX_FRAME_V1],
  );
  assert.equal(exposedGeneratorStateKeys('normal').includes('locatorProfileY'), false);
  assert.equal(exposedGeneratorStateKeys('advanced').includes('locatorProfileY'), false);

  state.locatorProfileY = LOCATOR_PROFILE_HEX_FRAME_V1;
  const clone = createGeneratorState(state);
  assert.equal(clone.locatorProfileY, LOCATOR_PROFILE_HEX_FRAME_V1);
});

test('Y타입 검출기 옵션 섹션은 소스에 있고 lab 경로에서만 연다', () => {
  assert.match(INDEX, /id="yLocatorSection"/);
  assert.match(INDEX, /data-i18n="g515"/);
  assert.match(INDEX, /data-locator="off"/);
  assert.match(INDEX, /data-locator="hex-frame-v1"/);
  assert.match(INDEX, /function syncYLocatorUi\(\)/);
  assert.match(INDEX, /isLabPath\(\) && generatorState\.type === 'Y'/);
  assert.match(INDEX, /isLabPath\(\) && generatorState\.locatorProfileY === LOCATOR_PROFILE_HEX_FRAME_V1/);
  assert.match(INDEX, /locatorProfile: generatorState\.locatorProfileY/);
  assert.doesNotMatch(INDEX, /회전·조명·인쇄·라이브 스캔 성능을 보장해요/);
});

test('로케이터 문구는 ko/en/ja 가 같고 성능 보장을 하지 않는다', () => {
  for (const key of ['g515', 'g516', 'g517', 'g518', 'g519', 'g520']) {
    for (const lang of ['ko', 'en', 'ja']) {
      assert.match(langBlock(lang), new RegExp('"' + key + '"\\s*:'), `${lang} 에 ${key} 가 없다`);
    }
  }
  assert.match(INDEX, /실험용입니다\. 회전·조명·인쇄·라이브 스캔 성능을 보장하지 않아요/);
  assert.match(INDEX, /Does not guarantee rotation, lighting, print, or live-scan performance/);
  assert.match(INDEX, /回転・照明・印刷・ライブスキャンの性能は保証しません/);
});

test('시험판 번들에는 섹션이 있고 안정판은 런타임에 숨긴다', () => {
  const lab = buildGeneratorLabHtml();
  const official = buildSingleHtml({ generatorEdition: OFFICIAL_GENERATOR_EDITION });
  assert.match(lab, /id="yLocatorSection"/);
  assert.match(lab, /data-i18n="g515"/);
  assert.match(official, /id="yLocatorSection"/);
  assert.match(official, /section\.hidden = !show/);
  assert.match(official, /isLabPath\(\) && generatorState\.type === 'Y'/);
});
