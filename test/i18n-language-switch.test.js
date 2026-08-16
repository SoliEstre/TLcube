/*
 * i18n-language-switch.test.js — 언어 선택 UI 가 **실제로 여덟 언어를 고를 수 있는가**.
 *
 * 왜 별도 파일인가: 기존 i18n 테스트들은 «사전이 다 찼는가» 를 잰다. 그런데 과업 1 이
 * 끝난 시점의 실제 상태는 «사전은 8언어, 버튼도 8개, 그런데 눌러도 안 바뀜» 이었다 —
 * `SUPPORTED_LANGUAGES` 가 3언어라 `setLanguage` 가 조기 반환했기 때문이다.
 * 사전 커버리지 테스트는 전부 초록이었다. 즉 **고를 수 있는가는 아무도 안 재고 있었다.**
 *
 * 여기서 재는 것은 세 가지다.
 *   ① 지원 목록·라벨표가 8언어이고 서로 어긋나지 않는가
 *   ② 생성기·스캐너의 선택 UI 가 드롭다운이고 항목이 8개인가 (운영자 지시 2026-08-17:
 *      «8언어는 드롭다운»). 버튼 나열이 남아 있으면 실패시킨다 — 되돌아가면 상단 바가
 *      다시 접힌다.
 *   ③ 그 드롭다운을 기구가 실제로 잡는가 (`wireLanguageSwitch` 의 select 분기)
 *
 * ⚠ 이 파일은 **소스를 본다.** 실제 클릭 동작은 브라우저에서 확인해야 하지만, 여기서
 *    막는 것은 «배선이 통째로 빠지는» 회귀다 — 그게 지난번에 난 결함이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '../src/i18n.js';
import { languages } from '../tools/hub-content.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(ROOT + rel, 'utf8');

const INDEX = read('index.html');
const SCANNER_HTML = read('sites/tlscan/index.html');
const I18N_SRC = read('src/i18n.js');

/** `<select …>…</select>` 한 덩어리를 뽑는다. */
function selectBlock(html, id) {
  const at = html.indexOf(`<select id="${id}"`);
  assert.ok(at >= 0, `#${id} select 를 못 찾았다 — 언어 선택이 드롭다운이 아니다`);
  const end = html.indexOf('</select>', at);
  assert.ok(end > at, `#${id} select 가 닫히지 않았다`);
  return html.slice(at, end);
}

function optionsOf(block) {
  return [...block.matchAll(/<option value="([a-z]{2})">([^<]+)<\/option>/g)]
    .map((m) => ({ code: m[1], label: m[2] }));
}

test('지원 목록과 자기표기 라벨표가 같은 여덟 언어를 덮는다', () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 8);
  assert.deepEqual([...SUPPORTED_LANGUAGES].sort(),
    ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt']);
  // 라벨이 빠지면 드롭다운에 «fr» 같은 코드가 그대로 노출된다.
  assert.deepEqual(Object.keys(LANGUAGE_LABELS).sort(), [...SUPPORTED_LANGUAGES].sort());
  // 자기 표기여야 한다 — 언어를 바꾸려는 사람은 지금 화면 언어를 못 읽는 사람이다.
  assert.deepEqual(LANGUAGE_LABELS, {
    ko: '한국어',
    en: 'English',
    ja: '日本語',
    fr: 'Français',
    it: 'Italiano',
    de: 'Deutsch',
    es: 'Español',
    pt: 'Português',
  });
});

test('허브 언어판 목록이 지원 목록과 같은 집합·같은 라벨이다', () => {
  assert.deepEqual(languages.map((l) => l.code).sort(), [...SUPPORTED_LANGUAGES].sort());
  for (const l of languages) {
    assert.equal(l.label, LANGUAGE_LABELS[l.code], `${l.code}: 허브 라벨이 자기표기와 다르다`);
  }
  // ko 만 디렉터리가 없다(정본 URL `/`). 나머지는 전부 `<code>/`.
  assert.equal(languages.find((l) => l.code === 'ko').dir, '');
  for (const l of languages.filter((x) => x.code !== 'ko')) {
    assert.equal(l.dir, `${l.code}/`, `${l.code}: 언어 디렉터리`);
  }
});

for (const [label, html, id, container] of [
  ['생성기', INDEX, 'langSelect', 'langSwitch'],
  ['스캐너', SCANNER_HTML, 'lang-select', 'lang-switch'],
]) {
  test(`${label} 언어 선택이 드롭다운이고 항목이 여덟 개다`, () => {
    const block = selectBlock(html, id);
    assert.match(block, /\sdata-lang-select\b/,
      `${label}: data-lang-select 가 없으면 wireLanguageSwitch 가 못 잡는다`);
    const options = optionsOf(block);
    assert.equal(options.length, 8, `${label}: 항목이 ${options.length}개`);
    // 순서까지 고정한다 — ko 가 저작 원본이라 맨 앞이고, 그 뒤는 지원 목록 순서다.
    assert.deepEqual(options.map((o) => o.code), [...SUPPORTED_LANGUAGES]);
    for (const o of options) {
      assert.equal(o.label, LANGUAGE_LABELS[o.code], `${label}/${o.code}: 항목 라벨`);
    }
  });

  test(`${label} 에 3언어 시절 버튼 나열이 남아 있지 않다`, () => {
    // 남아 있으면 «드롭다운도 있고 버튼도 있다» 가 되어 현재 언어 표시가 두 곳으로
    // 갈린다. 실제로 어느 쪽이 진짜인지 화면이 대답 못 한다.
    const at = html.indexOf(`id="${container}"`);
    assert.ok(at >= 0, `${label}: #${container} 컨테이너가 없다`);
    const chunk = html.slice(at, html.indexOf('</div>', html.indexOf('</select>', at)));
    assert.doesNotMatch(chunk, /<button[^>]*\sdata-lang=/,
      `${label}: 언어 버튼이 남아 있다`);
  });

  test(`${label} 언어 드롭다운이 접근 가능한 이름을 사전에서 받는다`, () => {
    const block = selectBlock(html, id);
    assert.match(block, /data-i18n-attr="aria-label:[^"]+"/,
      `${label}: aria-label 이 사전을 안 거치면 언어를 바꿔도 영영 첫 언어로 읽힌다`);
  });
}

test('wireLanguageSwitch 가 select 를 잡고 되돌림 동기화를 한다', () => {
  const at = I18N_SRC.indexOf('export function wireLanguageSwitch');
  assert.ok(at >= 0, 'wireLanguageSwitch 를 못 찾았다');
  const body = I18N_SRC.slice(at);
  assert.match(body, /querySelector\('select\[data-lang-select\]'\)/,
    'select 분기가 없다 — 드롭다운을 붙여도 아무 일도 안 일어난다');
  assert.match(body, /select\.addEventListener\('change'/, 'change 를 안 듣는다');
  // setLanguage 는 지원 밖 코드를 조용히 무시한다. 되돌리지 않으면 «드롭다운은 FR
  // 인데 화면은 한국어» 인 거짓 표시가 남는다.
  assert.match(body, /i18n\.setLanguage\(select\.value\);\s*\n\s*sync\(\);/,
    'change 뒤에 sync() 로 되돌리지 않는다');
});

test('생성기·스캐너 번들에 새 5언어가 실렸다', () => {
  // 사전을 넓혀도 번들을 다시 안 찍으면 배포본은 3언어 그대로다. 언어별로 «그 언어에만
  // 있는 문구» 를 하나씩 골라 잰다 — 키 존재가 아니라 값이 실렸는지를 본다.
  const gen = read('dist/trilume.html');
  const scan = read('dist/tlscan.html');
  for (const [lang, needle] of [
    ['fr', 'Impossible de lire cette photo.'],
    ['it', 'Nessun codice trovato in questa foto.'],
    ['de', 'Dieses Foto konnte nicht gelesen werden.'],
    ['es', 'No se ha podido leer esa foto.'],
    ['pt', 'Não foi possível ler essa foto.'],
  ]) {
    assert.ok(scan.includes(needle), `dist/tlscan.html 에 ${lang} 문구가 없다: ${needle}`);
  }
  for (const [lang, needle] of [
    ['fr', '<option value="fr">Français</option>'],
    ['it', '<option value="it">Italiano</option>'],
    ['de', '<option value="de">Deutsch</option>'],
    ['es', '<option value="es">Español</option>'],
    ['pt', '<option value="pt">Português</option>'],
  ]) {
    assert.ok(gen.includes(needle), `dist/trilume.html 에 ${lang} 드롭다운 항목이 없다`);
    assert.ok(scan.includes(needle), `dist/tlscan.html 에 ${lang} 드롭다운 항목이 없다`);
  }
});
