/**
 * lab-expected-layout-ui.test.js — 시험판 「기대 레이아웃」 버튼 ↔ 활성 라인업 대조.
 *
 * 왜 생겼나 (2026-08-18, 운영자 지적): v0TR 계열을 편입하면서 레인이 `strings.js` 에
 * 라벨(`lab.expectedLayout.v0tr` / `.v0trq`)은 여덟 언어 전부 넣었는데 **`index.html`
 * 의 버튼만 빠졌다.** 통합자도 리베이스에서 못 잡았다. 그리고 이 누락은 **어떤
 * 테스트에도 안 걸렸다** — 라인업과 UI 를 대조하는 자가 없었기 때문이다.
 *
 * 증상은 조용하다: 스캐너 시험판에서 v0TR 프레임을 찍어도 «기대 레이아웃» 으로
 * 고를 수가 없고, 그러면 lab 텔레메트리의 expected_layout 이 영원히 비거나 틀린다
 * — 즉 **레이아웃 판정을 재는 계기 자체가 눈이 먼다.**
 *
 * 규약 (index.html 주석의 정본): **활성 라인업에 있는 것만 버튼이 있다.**
 * 드랍된 것은 버튼을 내리되 사전 키는 남긴다 (되살릴 때 재번역 안 하려고).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CELL_SURFACE_FINAL_ACTIVE_IDS, isDroppedFinalLayout,
} from '../src/cellSurfaceFinal.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INDEX_HTML = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
const STRINGS_JS = readFileSync(ROOT + 'sites/tlscan/strings.js', 'utf8');

/** index.html 의 `data-expected-layout="…"` 값 전부 (빈 값 = «모름» 은 뺀다). */
function buttonLayouts() {
  const found = [];
  const re = /data-expected-layout="([^"]*)"/g;
  let match = re.exec(INDEX_HTML);
  while (match !== null) {
    if (match[1] !== '') found.push(match[1]);
    match = re.exec(INDEX_HTML);
  }
  return found;
}

test('활성 라인업의 모든 셀 표면 레이아웃에 기대 레이아웃 버튼이 있다', () => {
  const buttons = new Set(buttonLayouts());
  const missing = CELL_SURFACE_FINAL_ACTIVE_IDS.filter((id) => !buttons.has(id));
  assert.deepEqual(missing, [],
    '활성 라인업인데 시험판 버튼이 없다: ' + JSON.stringify(missing)
    + ' — 이러면 그 레이아웃의 expected_layout 텔레메트리를 영원히 못 잰다.');
});

test('버튼이 있는 레이아웃은 전부 활성이다 — 드랍된 것이 조용히 남지 않았다', () => {
  const active = new Set(CELL_SURFACE_FINAL_ACTIVE_IDS);
  for (const id of buttonLayouts()) {
    assert.ok(active.has(id),
      '드랍/미지의 레이아웃 «' + id + '» 버튼이 남아 있다 — 고르면 텔레메트리가 영원히 미스다');
    assert.equal(isDroppedFinalLayout(id), false, id + ' 는 드랍 상태다');
  }
});

test('모든 버튼에 i18n 키와 사전 항목이 있다', () => {
  for (const id of buttonLayouts()) {
    const key = 'lab.expectedLayout.' + id;
    assert.ok(INDEX_HTML.includes('data-i18n="' + key + '"'),
      id + ' 버튼에 data-i18n="' + key + '" 가 없다');
    assert.ok(STRINGS_JS.includes("'" + key + "'"),
      'strings.js 에 ' + key + ' 사전 항목이 없다');
  }
});

test('중복 버튼이 없다', () => {
  const list = buttonLayouts();
  assert.equal(new Set(list).size, list.length,
    '기대 레이아웃 버튼이 중복됐다: ' + JSON.stringify(list));
});
