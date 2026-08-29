/**
 * lab-expected-emphasis-ui.test.js — 시험판 「기대」 축 ④ (중앙 강조 변이, 2026-08-29).
 *
 * 왜 생겼나: 라이브 스캔 프레임을 강조 변이별로 가르는 축이 없었다. gen 행의
 * emphasis(010)는 frame 과 붙일 조인 키가 없고(스캐너는 config_id 를 싣지 않는다 —
 * 2026-08-29 라이브 357프레임 실측 매칭 0/357), 정지사진(emph29: 전체 강조 0/4 최하)과
 * 라이브 체감(전체 강조 우세)의 충돌을 가를 수 없었다. 그래서 007(축 ③)과 같은
 * 모양으로 기대 축을 편다: 스캐너 카드 → frame.expected.centralN7Emphasis →
 * relay expected_emphasis (011).
 *
 * 이 파일은 축 ④만 잠근다. 축 ①은 lab-expected-layout-ui.test.js, 축 ②·③은
 * lab-expected-finder-ui.test.js 가 계속 소유한다 — 여기서는 네 축이 안 섞였는지만 본다.
 *
 * 규약 (①②③에서 물려받은 정본): **폐쇄집합에 있는 것만 버튼이 있다.** 목록은 손으로
 * 적지 않는다 — 정본은 렌더·인코더가 쓰는 CENTRAL_N7_EMPHASIS_MODES 에서 유도된다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LAB_EMPHASIS_MODES, normalizeExpectedEmphasis } from '../src/lab-expected-axes.js';
import { CENTRAL_N7_EMPHASIS_MODES } from '../src/centralN7Emphasis.js';
import { CONFIG_SIDE_KEYS, emptyConfigSide } from '../src/lab-telemetry.js';
import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_HTML = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
const GEN_HTML = readFileSync(ROOT + 'index.html', 'utf8');
const SCANNER_JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');

/** `data-<attr>="…"` 값 전부 (빈 값 = «모름» 은 뺀다). */
function buttonValues(html, attr) {
  const found = [];
  const re = new RegExp('data-' + attr + '="([^"]*)"', 'g');
  let match = re.exec(html);
  while (match !== null) {
    if (match[1] !== '') found.push(match[1]);
    match = re.exec(html);
  }
  return found;
}

const LANGS = Object.keys(SCANNER_STRINGS);

test('축 ④: 정본은 손 목록이 아니라 CENTRAL_N7_EMPHASIS_MODES 에서 유도된다', () => {
  assert.deepEqual([...LAB_EMPHASIS_MODES], [...CENTRAL_N7_EMPHASIS_MODES],
    'LAB_EMPHASIS_MODES 가 렌더·인코더 정본과 어긋난다 — 변이가 추가/드랍되면'
    + ' 유도 스프레드가 자동으로 따라와야 한다');
});

test('축 ④: 기대 버튼 집합이 정본과 정확히 같다', () => {
  assert.deepEqual(buttonValues(SCAN_HTML, 'expected-emphasis'), [...LAB_EMPHASIS_MODES],
    '시험판 강조 버튼이 LAB_EMPHASIS_MODES 와 어긋난다 — 폐쇄집합에 있는데 버튼이'
    + ' 없으면 그 변이의 expected_emphasis 를 영원히 못 재고, 집합 밖 버튼이 있으면'
    + ' 고른 프레임이 영원히 미스로 남는다');
});

test('축 ④: 생성기 «중앙 강조색» 카드와 값 집합이 같다 — 생성 ↔ 기대 왕복', () => {
  // 생성기가 만들 수 있는 변이와 스캐너가 «기대» 로 고를 수 있는 변이가 어긋나면
  // 그 차집합의 프레임은 분해가 원리적으로 불가능하다. 두 표면 모두
  // CENTRAL_N7_EMPHASIS_MODES 소비자여야 한다는 명제를 값 집합으로 잰다.
  assert.deepEqual(
    buttonValues(GEN_HTML, 'n7-emphasis').slice().sort(),
    [...LAB_EMPHASIS_MODES].sort(),
    '생성기 카드(data-n7-emphasis)와 기대 축 ④ 의 변이 집합이 어긋난다',
  );
});

test('축 ④: 텔레메트리 화이트리스트가 열려 있다 — 조용한 폐기 방지', () => {
  // CONFIG_SIDE_KEYS 에 없으면 normalizeConfigSide 가 스캐너 expected 에서 조용히
  // 버린다 (gen 쪽 GEN_BODY_KEYS 누락과 같은 함정 — 이번 라운드의 발단).
  assert.ok(CONFIG_SIDE_KEYS.includes('centralN7Emphasis'),
    'CONFIG_SIDE_KEYS 에 centralN7Emphasis 가 없다');
  assert.ok('centralN7Emphasis' in emptyConfigSide(),
    'emptyConfigSide 에 centralN7Emphasis 자리가 없다');
});

test('축 ④: 스캐너가 카드를 expected 로 배선한다', () => {
  // ⚠ 소스 철자 자다 — 배선 «존재» 만 잰다 (버튼·사전이 있어도 소비자 배선이 빠지면
  //   화면은 초록인데 컬럼은 영영 빈 칸이 되는 축을 다른 어떤 자도 못 지킨다).
  assert.match(SCANNER_JS, /getElementById\('lab-expected-emphasis'\)/,
    '스캐너가 기대 강조 카드 루트를 읽지 않는다');
  assert.match(SCANNER_JS, /normalizeExpectedEmphasis\(/,
    '스캐너가 정본 판정(normalizeExpectedEmphasis)을 소비하지 않는다');
  assert.match(SCANNER_JS, /expected\.centralN7Emphasis = expectedEmphasis/,
    '스캐너가 선택값을 frame.expected 로 싣지 않는다');
});

test('축 ④: 모든 버튼에 8언어 사전 항목이 있다', () => {
  const prefix = 'lab.expectedEmphasis.';
  for (const value of [...buttonValues(SCAN_HTML, 'expected-emphasis'), 'unknown']) {
    const key = prefix + value;
    assert.ok(SCAN_HTML.includes('data-i18n="' + key + '"'),
      value + ' 버튼에 data-i18n="' + key + '" 가 없다');
    for (const lang of LANGS) {
      assert.ok(typeof SCANNER_STRINGS[lang][key] === 'string'
        && SCANNER_STRINGS[lang][key].length > 0,
      lang + ' 사전에 ' + key + ' 가 없다 — 언어를 바꾸면 그 버튼만 한국어로 남는다');
    }
  }
  for (const lang of LANGS) {
    assert.ok(typeof SCANNER_STRINGS[lang][prefix + 'label'] === 'string',
      lang + ' 사전에 ' + prefix + 'label 이 없다');
  }
});

test('축 ④가 다른 세 축과 안 섞였다 — 버튼 속성도 값도 겹치지 않는다', () => {
  const emphasis = new Set(buttonValues(SCAN_HTML, 'expected-emphasis'));
  for (const [attr, label] of [
    ['expected-layout', '① 레이아웃'],
    ['expected-finder', '② 중앙 파인더'],
    ['expected-outer', '③ 외곽'],
  ]) {
    const other = new Set(buttonValues(SCAN_HTML, attr));
    assert.ok(other.size > 0, label + ' 버튼이 사라졌다 — 이 라운드는 그 축을 안 건드린다');
    const shared = [...emphasis].filter((id) => other.has(id));
    assert.deepEqual(shared, [], '④ 강조 ↔ ' + label + ' 가 같은 값을 쓴다: '
      + JSON.stringify(shared));
  }
  const list = buttonValues(SCAN_HTML, 'expected-emphasis');
  assert.equal(new Set(list).size, list.length, 'expected-emphasis 버튼이 중복됐다');
});

test('폐쇄집합 밖 값은 null(모름)로 떨어진다 — 저장·URL 로 들어온 옛 값 포함', () => {
  assert.equal(normalizeExpectedEmphasis('default'), 'default');
  assert.equal(normalizeExpectedEmphasis('locator'), 'locator');
  assert.equal(normalizeExpectedEmphasis('all'), 'all');
  assert.equal(normalizeExpectedEmphasis(''), null, '빈 값(모름)은 null 이어야 한다');
  assert.equal(normalizeExpectedEmphasis(undefined), null);
  assert.equal(normalizeExpectedEmphasis('v0t'), null, '레이아웃 id 가 축 ④ 로 새면 안 된다');
  assert.equal(normalizeExpectedEmphasis('bullseye'), null, '파인더 id 가 축 ④ 로 새면 안 된다');
});
