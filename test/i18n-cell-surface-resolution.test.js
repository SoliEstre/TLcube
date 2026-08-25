/**
 * i18n-cell-surface-resolution.test.js — 셀 표면 카드 문구가 **허용 n 목록을 따라가는지**.
 *
 * 왜 이 파일이 있나: 운영자가 2026-08-25 하루에 **세 번** 같은 신고를 냈다 —
 * 「라인업만 넓히고 상수를 안 걷어」. 레이아웃의 허용 해상도를 열면 코드는 열리는데
 * 그 레이아웃을 설명하는 **사용자 가시 문자열**은 예전 배타 주장을 그대로 들고 있다
 * (T 계열 다섯이 여덟 언어에서 「Y1(n=21) 전용」이라고 말하고 있었다). 테스트는
 * 초록이고, 화면만 거짓말을 한다.
 *
 * 그래서 문구를 **손 목록으로 다시 적어 두지 않는다.** 정본은
 * `CELL_SURFACE_FINAL_NS` 하나이고, 여기서는 그 정본에서 **유도한 요구**를 건다:
 *
 *   ① 허용 n 에 25 가 있으면 → 그 레이아웃의 힌트는 여덟 언어 모두 `n=25` 를
 *      **말해야** 하고, 라벨 꼬리표는 `(Y1/Y2)` 여야 한다 (v2r2/g543 관례).
 *   ② 라벨 꼬리표는 여덟 언어가 **서로 같아야** 한다 (ko 를 기준으로 유도 — 한 언어만
 *      갱신되는 「번역 누락」이 여기서 걸린다).
 *   ③ 번역 전에 보이는 정적 DOM 스팬은 **ko 사전 값과 글자까지 같아야** 한다
 *      (사전만 쓸고 DOM 을 잊는 것이 이 화면의 단골 실패다).
 *   ④ 이 키들의 값에 마크다운 강조(`**`)가 없어야 한다 — 팝오버는 textContent 렌더라
 *      별표가 그대로 화면에 나온다.
 *
 * ⚠ **여기서 재지 않는 방향**: 「문구가 `CELL_SURFACE_FINAL_NS` 보다 **넓게** 주장한다」
 *   는 이 파일이 잡지 않는다. 2026-08-25 현재 슬롯 계열(v0ty·v0trq·v0try)의 n=25 개방은
 *   **별건 레인**이 들고 있고(§CELL_SURFACE_FINAL_NS 의 「QR 슬롯 위치 규범이 아직
 *   없다」 주석), 문구는 그 개방을 **앞질러** 적혀 있다. 그 앞지름이 실제로 메워졌는지는
 *   통합 후 `CELL_SURFACE_FINAL_NS` 로 확인해야 한다 — 이 파일의 ① 은 개방이 들어오는
 *   순간 그 문구를 그대로 통과시키고, 개방만 하고 문구를 안 쓴 **다음** 레이아웃에서
 *   빨갛게 선다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CELL_SURFACE_FINAL_NS,
  CELL_SURFACE_FINAL_V0T,
  CELL_SURFACE_FINAL_V0TY,
  CELL_SURFACE_FINAL_V0TR,
  CELL_SURFACE_FINAL_V0TRQ,
  CELL_SURFACE_FINAL_V0TRY,
} from '../src/cellSurfaceFinal.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

const LANGS = ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt'];

/** 생성기 카드가 서 있는 셀 표면 레이아웃 → 그 카드의 사전 키. */
const CARD_KEYS = Object.freeze({
  [CELL_SURFACE_FINAL_V0T]: { label: 'g993', hint: 'g994' },
  [CELL_SURFACE_FINAL_V0TY]: { label: 'g996', hint: 'g997' },
  [CELL_SURFACE_FINAL_V0TR]: { label: 'g955', hint: 'g956' },
  [CELL_SURFACE_FINAL_V0TRQ]: { label: 'g958', hint: 'g959' },
  [CELL_SURFACE_FINAL_V0TRY]: { label: 'g936', hint: 'g938' },
});

function langBlock(lang) {
  const start = INDEX.indexOf('const GENERATOR_STRINGS = {');
  assert.ok(start >= 0, 'GENERATOR_STRINGS 를 못 찾았다');
  const at = INDEX.indexOf(`  ${lang}: {`, start);
  assert.ok(at > start, `${lang} 사전을 못 찾았다`);
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

/** 한 언어 사전에서 키 하나의 **원시 값**(escape 그대로). 없으면 null. */
function dictValue(lang, key) {
  const block = langBlock(lang);
  const m = block.match(new RegExp(`\\n\\s*"${key}":\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return m === null ? null : m[1];
}

test('셀 표면 카드 키는 여덟 언어에 빠짐없이 있다', () => {
  for (const [id, keys] of Object.entries(CARD_KEYS)) {
    for (const key of [keys.label, keys.hint]) {
      for (const lang of LANGS) {
        assert.notEqual(dictValue(lang, key), null, `${lang} 에 ${id} 의 ${key} 가 없다`);
      }
    }
  }
});

test('허용 n 에 25 가 있으면 문구가 여덟 언어 모두 n=25 를 말한다 (NS 유도)', () => {
  let open = 0;
  for (const [id, keys] of Object.entries(CARD_KEYS)) {
    const ns = CELL_SURFACE_FINAL_NS[id];
    assert.ok(Array.isArray(ns) && ns.length > 0, `${id} 의 허용 n 목록이 비었다`);
    if (!ns.includes(25)) continue;
    open += 1;
    for (const lang of LANGS) {
      const hint = dictValue(lang, keys.hint);
      assert.ok(
        hint.includes('n=25'),
        `${id} 는 n=25 를 지원하는데 ${lang} 힌트(${keys.hint})가 n=25 를 안 말한다`,
      );
      const label = dictValue(lang, keys.label);
      assert.ok(
        label.endsWith(' (Y1/Y2)'),
        `${id} 는 n=25 를 지원하는데 ${lang} 라벨(${keys.label})이 «${label}» 이다`,
      );
    }
  }
  // 「하나도 안 열려 있어서 위 루프가 통째로 건너뛰었다」 를 초록으로 넘기지 않는다.
  assert.ok(open > 0, '허용 n 에 25 를 가진 T 계열 카드가 하나도 없다 — 유도가 끊겼다');
});

test('라벨 해상도 꼬리표는 여덟 언어가 같다', () => {
  for (const [id, keys] of Object.entries(CARD_KEYS)) {
    const ko = dictValue('ko', keys.label);
    const m = ko.match(/ \((Y[0-9]+(?:\/Y[0-9]+)*)\)$/);
    assert.ok(m !== null, `${id} 의 ko 라벨에 해상도 꼬리표가 없다: ${ko}`);
    for (const lang of LANGS) {
      const value = dictValue(lang, keys.label);
      assert.ok(
        value.endsWith(` (${m[1]})`),
        `${id} 의 ${lang} 라벨 꼬리표가 ko(${m[1]}) 와 다르다: ${value}`,
      );
    }
  }
});

test('정적 DOM 스팬은 ko 사전 값과 글자까지 같다', () => {
  for (const [id, keys] of Object.entries(CARD_KEYS)) {
    const ko = dictValue('ko', keys.label);
    const m = INDEX.match(
      new RegExp(`data-locator="cell-surface-${id}"[\\s\\S]{0,2000}?data-i18n="${keys.label}">([^<]*)<`),
    );
    assert.ok(m !== null, `${id} 카드에서 ${keys.label} 스팬을 못 찾았다`);
    assert.equal(m[1], ko, `${id} 의 정적 스팬이 ko 사전과 어긋난다`);
  }
});

test('셀 표면 카드 문구에 마크다운 강조가 없다 (팝오버는 textContent 렌더)', () => {
  for (const [id, keys] of Object.entries(CARD_KEYS)) {
    for (const key of [keys.label, keys.hint]) {
      for (const lang of LANGS) {
        const value = dictValue(lang, key);
        assert.equal(
          value.includes('**'), false,
          `${lang} 의 ${id} ${key} 에 «**» 가 있다 — 화면에 별표가 그대로 나온다`,
        );
      }
    }
  }
});
