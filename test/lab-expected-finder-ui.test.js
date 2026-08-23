/**
 * lab-expected-finder-ui.test.js — 시험판 「기대」 축 ②·③ ↔ 검출 라인업 대조.
 *
 * 왜 생겼나 (2026-08-19, 운영자 실기기 피드백): 시험판의 「기대」 선택이 **셀 표면
 * 레이아웃 한 축**뿐이었다. 그런데 그 라운드 신고는 다른 축의 이야기였다 —
 * 「신규 3개 셀 표면 파인더(Nitrogen·Aspirin·Benzene)가 전부 인식 안 된다」와
 * 「외곽 파인더는 별도 선택이어야 한다」. 고를 자리가 없으니 **그 신고를 계측으로
 * 확인할 방법 자체가 없었다.**
 *
 * 이 파일은 축 ②(중앙 파인더)·③(외곽/코너)의 명제를 잠근다.
 * 축 ①(셀 표면 레이아웃)은 `lab-expected-layout-ui.test.js` 가 계속 소유한다 —
 * 이 파일은 ①을 **한 줄도 건드리지 않는다**. 대신 세 축이 서로 안 섞였는지만 본다.
 *
 * 규약 (①에서 물려받은 정본): **검출 라인업에 있는 것만 버튼이 있다.**
 * 라인업 밖 값을 «기대» 로 고를 수 있으면 그 프레임의 텔레메트리는 영원히 미스다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  LAB_CENTRAL_FINDER_IDS, LAB_OUTER_FINDER_IDS,
  normalizeCentralFinderId, normalizeOuterFinderId,
} from '../src/lab-expected-axes.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INDEX_HTML = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');

/** `data-<attr>="…"` 값 전부 (빈 값 = «모름» 은 뺀다). */
function buttonValues(attr) {
  const found = [];
  const re = new RegExp('data-' + attr + '="([^"]*)"', 'g');
  let match = re.exec(INDEX_HTML);
  while (match !== null) {
    if (match[1] !== '') found.push(match[1]);
    match = re.exec(INDEX_HTML);
  }
  return found;
}

const LANGS = Object.keys(SCANNER_STRINGS);

test('축 ②: 중앙 파인더 버튼 집합이 검출 라인업과 정확히 같다', () => {
  assert.deepEqual(buttonValues('expected-finder'), [...LAB_CENTRAL_FINDER_IDS],
    '시험판 중앙 파인더 버튼이 LAB_CENTRAL_FINDER_IDS 와 어긋난다 —'
    + ' 라인업에 있는데 버튼이 없으면 그 파인더의 expected_finder 를 영원히 못 재고,'
    + ' 라인업에 없는데 버튼이 있으면 고른 프레임이 영원히 미스로 남는다.');
});

test('축 ②: 라인업이 운영자 순위의 넷과 OAK 3종을 모두 담는다', () => {
  // 운영자 순위 «QR > 불스아이속큐브 > 불스아이 > 3톤큐브 > 그 외» 의 넷 —
  // 이 넷이 축 ② 에서 빠지면 그 순위를 텔레메트리로 재현할 수 없다.
  for (const id of ['center-qr', 'cube-bullseye', 'bullseye', 'central-cube-3tone']) {
    assert.ok(LAB_CENTRAL_FINDER_IDS.includes(id), id + ' 가 중앙 파인더 축에 없다');
  }
  // 2026-08-19 신고의 표적 — 이 셋이 빠지면 「전부 인식 안 됨」을 못 잰다.
  for (const id of ['oak-nitrogen-r2', 'oak-aspirin', 'oak-benzene']) {
    assert.ok(LAB_CENTRAL_FINDER_IDS.includes(id), id + ' (OAK) 가 중앙 파인더 축에 없다');
  }
  // F-40 (2026-08-23): 중앙 v0(비컨)는 살아 있는 생산 파인더인데 이 축에 없어서
  // 비컨 프레임의 실기기 A/B(expected/observed)가 처음부터 불가능했다 — 3톤 큐브의
  // «아예 인식 안 됨» 을 잡아낸 그 대조를 비컨엔 할 수 없었다. id 는 손으로 적지 않고
  // 렌더·검출이 공유하는 상수(finder-selection.js)에서 가져온다.
  assert.ok(LAB_CENTRAL_FINDER_IDS.includes(CENTRAL_V0_FINDER_PATTERN_ID),
    'central-v0 가 중앙 파인더 축에 없다 — 비컨 실사진 검증의 전제조건이 무너진다');
  assert.equal(normalizeCentralFinderId(CENTRAL_V0_FINDER_PATTERN_ID),
    CENTRAL_V0_FINDER_PATTERN_ID);
  assert.equal(new Set(LAB_CENTRAL_FINDER_IDS).size, LAB_CENTRAL_FINDER_IDS.length,
    '중앙 파인더 id 가 중복됐다');
});

test('축 ③: 외곽 파인더 버튼 집합이 정본과 정확히 같다', () => {
  assert.deepEqual(buttonValues('expected-outer'), [...LAB_OUTER_FINDER_IDS],
    '시험판 외곽 파인더 버튼이 LAB_OUTER_FINDER_IDS 와 어긋난다');
  // 「없음」은 「모름」과 다른 값이다 — 둘이 같은 값으로 뭉개지면 «외곽이 없는 코드를
  // 찍었다» 는 적극적 관측이 «안 골랐다» 와 구별되지 않는다.
  assert.ok(LAB_OUTER_FINDER_IDS.includes('none'), '외곽 축에 «없음» 값이 필요하다');
  assert.equal(normalizeOuterFinderId(''), null, '빈 값(모름)은 null 이어야 한다');
  assert.notEqual(normalizeOuterFinderId('none'), null, '«없음»은 null 이 아니어야 한다');
});

test('축 ②·③ 의 모든 버튼에 8언어 사전 항목이 있다', () => {
  const cases = [
    ['expected-finder', 'lab.expectedFinder.'],
    ['expected-outer', 'lab.expectedOuter.'],
  ];
  for (const [attr, prefix] of cases) {
    for (const value of [...buttonValues(attr), 'unknown']) {
      const key = prefix + value;
      assert.ok(INDEX_HTML.includes('data-i18n="' + key + '"'),
        value + ' 버튼에 data-i18n="' + key + '" 가 없다');
      for (const lang of LANGS) {
        assert.ok(typeof SCANNER_STRINGS[lang][key] === 'string'
          && SCANNER_STRINGS[lang][key].length > 0,
        lang + ' 사전에 ' + key + ' 가 없다 — 언어를 바꾸면 그 버튼만 한국어로 남는다');
      }
    }
    const label = prefix + 'label';
    for (const lang of LANGS) {
      assert.ok(typeof SCANNER_STRINGS[lang][label] === 'string',
        lang + ' 사전에 ' + label + ' 이 없다');
    }
  }
});

test('세 축이 서로 안 섞였다 — 버튼 속성도 값도 겹치지 않는다', () => {
  const layout = new Set(buttonValues('expected-layout'));
  const central = new Set(buttonValues('expected-finder'));
  const outer = new Set(buttonValues('expected-outer'));
  assert.ok(layout.size > 0, '축 ① 버튼이 사라졌다 — 이 라운드는 ①을 안 건드린다');
  for (const [a, b, label] of [
    [layout, central, '① 레이아웃 ↔ ② 중앙 파인더'],
    [layout, outer, '① 레이아웃 ↔ ③ 외곽'],
    [central, outer, '② 중앙 파인더 ↔ ③ 외곽'],
  ]) {
    const shared = [...a].filter((id) => b.has(id));
    assert.deepEqual(shared, [], label + ' 가 같은 값을 쓴다: ' + JSON.stringify(shared));
  }
  for (const attr of ['expected-finder', 'expected-outer']) {
    const list = buttonValues(attr);
    assert.equal(new Set(list).size, list.length, attr + ' 버튼이 중복됐다');
  }
});

test('라인업 밖 값은 null(모름)로 떨어진다 — 저장·URL 로 들어온 옛 값 포함', () => {
  assert.equal(normalizeCentralFinderId('oak-daehan-k6'), null,
    'daehan 은 축 ③ 이다 — 축 ② 로 들어오면 안 된다');
  assert.equal(normalizeCentralFinderId('v0t'), null, '레이아웃 id 가 축 ② 로 새면 안 된다');
  assert.equal(normalizeCentralFinderId(''), null);
  assert.equal(normalizeCentralFinderId(undefined), null);
  assert.equal(normalizeCentralFinderId('bullseye'), 'bullseye');
  assert.equal(normalizeOuterFinderId('daehan'), 'daehan');
  assert.equal(normalizeOuterFinderId('bullseye'), null);
});
