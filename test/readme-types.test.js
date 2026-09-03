// readme-types.test.js — README 두 본과 허브가 **같은 타입 집합**을 싣는지 지킨다.
//
// 왜 필요한가: 타입 표는 손으로 유지되는 표면이 셋(README.md · README.ko.md · 허브
// `type*Name` 카드)인데, 늘어나는 건 늘 한 군데씩이다. 실제로 타입 C 가 들어온 뒤
// **표는 5행인데 제목은 「Four types」** 로 남아 있었다 — 표를 고친 사람이 산문의
// 개수를 못 본 것이다. 손 사본은 반드시 어긋나므로, 개수를 세는 대신 **집합을 맞춘다**.
//
// ⚠ 이 자가 재는 것과 못 재는 것:
//   · 잰다 — 세 표면의 타입 **문자 집합**이 어긋나는 것 (한 곳에만 추가한 경우).
//   · 잰다 — 제목·머리 산문이 **개수를 주장하는 것**. 단 아래 COUNT_WORDS 는 두 README
//     언어의 «철자» 목록이라, 목록에 없는 표현으로 개수를 쓰면 못 잡는다. 자의 한계를
//     알고 써라 — 이쪽은 주장이 아니라 «쓴 방식» 을 막는 절반이다.
//   · 못 잰다 — 표의 용량 수치가 `src/capacity*.js` 와 맞는지. 그건 capacity 자들 몫이다.
//
// ⚠ 허브 `stats.types`(4종)와 헷갈리지 마라. 그건 **측정 범위**라 타입 총수와 일부러
//   다르다 (tools/hub-content.mjs stats 주석). 여기서 맞추는 건 `type*Name` **카드**다.
//
// 개수의 정본은 **표** 다. 산문에 개수를 쓰지 않으면 타입이 늘어도 안 썩는다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { strings } from '../tools/hub-content.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// ⚠ 제목 정규식은 **개수가 붙은 제목도 찾아야 한다** («## Four types»). 안 그러면
//   개수를 되돌렸을 때 「개수를 주장한다」 가 아니라 「절을 못 찾았다」 로 죽어서,
//   자가 무엇을 잡았는지 읽는 사람이 오해한다 (실제로 그렇게 났다).
//   두 README 어디에도 type/타입 이 든 다른 `## ` 제목은 없다 — 유일하게 걸린다.
const READMES = [
  { file: 'README.md', heading: /^##[^\n]*types?[^\n]*$/im },
  { file: 'README.ko.md', heading: /^##[^\n]*타입[^\n]*$/m },
];

/** 제목·머리 산문이 개수를 주장하면 잡는 철자 목록 (두 README 언어 한정). */
const COUNT_WORDS = [
  'four', 'Four', 'five', 'Five', 'six', 'Six', 'seven', 'Seven',
  '네 타입', '다섯', '여섯', '일곱',
];

/** 타입 절만 잘라 낸다 — 다른 표(마일스톤 등)를 같이 세지 않기 위해. */
function typesSection(file, heading) {
  const text = readFileSync(ROOT + file, 'utf8');
  const start = text.search(heading);
  assert.notEqual(start, -1, `${file}: 타입 절 제목을 못 찾았다 — 자가 고장 났다`);
  const rest = text.slice(start);
  const end = rest.indexOf('\n## ', 1);
  const body = end === -1 ? rest : rest.slice(0, end);
  return { headingLine: rest.slice(0, rest.indexOf('\n')), body };
}

/** 표 행에서 타입 문자를 유도한다 — 개수를 어디에도 적지 않는다. */
function typeLettersOf(body) {
  return [...body.matchAll(/^\|\s*\*\*([A-Z])\*\*\s*\|/gm)].map((m) => m[1]).sort();
}

const hubLetters = Object.keys(strings.en)
  .map((key) => /^type([A-Z])Name$/.exec(key))
  .filter(Boolean).map((m) => m[1]).sort();

test('README 두 본과 허브 카드가 같은 타입 집합을 싣는다', () => {
  assert.ok(hubLetters.length >= 4, '허브 type*Name 카드를 못 읽었다 — 자가 고장 났다');

  for (const { file, heading } of READMES) {
    const letters = typeLettersOf(typesSection(file, heading).body);
    assert.ok(letters.length >= 4, `${file}: 타입 표 행을 못 읽었다 — 표 모양이 바뀌었나`);
    assert.deepEqual(letters, hubLetters,
      `${file} 의 타입 표가 허브 카드와 어긋난다`
      + ` (README=${letters.join('')} · 허브=${hubLetters.join('')})`
      + ' — 타입을 추가·삭제했다면 README 2본 + tools/hub-content.mjs 를 함께 고쳐라'
      + ' (AGENTS.md §7 N-way sync)');
  }
});

test('타입 절의 제목과 머리 산문이 개수를 주장하지 않는다', () => {
  for (const { file, heading } of READMES) {
    const { headingLine, body } = typesSection(file, heading);
    // 표 바로 뒤 첫 문단 — 「All four share…」 가 썩었던 자리다.
    const afterTable = body.slice(body.lastIndexOf('|\n') + 2).split('\n\n')[0];

    assert.ok(!/[0-9]/.test(headingLine),
      `${file}: 타입 절 제목에 숫자가 있다 (${headingLine.trim()})`
      + ' — 개수는 표에서 읽게 두고 제목은 개수를 안 세는 표기로 남겨라');

    for (const scope of [
      { name: '제목', text: headingLine },
      { name: '머리 산문', text: afterTable },
    ]) {
      for (const word of COUNT_WORDS) {
        assert.ok(!scope.text.includes(word),
          `${file}: 타입 절 ${scope.name} 이 개수를 주장한다 («${word}»)`
          + ' — 타입이 늘 때마다 썩는 자리다. 개수를 빼고 쓰거나, 뺄 수 없으면'
          + ' 이 자(test/readme-types.test.js)를 함께 고쳐 근거를 남겨라');
      }
    }
  }
});
