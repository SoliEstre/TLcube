// i18n-coverage.test.js — UI 문구가 사전을 **거치지 않고** 박히는 것을 막는다.
//
// 왜 필요한가: 생성기·스캐너의 언어 전환은 두 경로로 동작한다.
//   ① 정적 DOM — `data-i18n` 속성 (applyTranslations 가 채운다)
//   ② JS 가 만드는 문구 — `t()` / `tf()` 를 직접 불러야 한다
// ①만 있으면 라벨은 바뀌는데 힌트·푸터·에러는 한국어로 남는다. 그런데 **눈에 띄는
// 라벨이 바뀌니 번역이 된 것처럼 보인다** — 그래서 배포까지 갔고 사용자가 잡았다
// (2026-08-11: 영어로 바꿔도 스타일 이름·해상도 힌트·푸터 메타가 한국어).
//
// 이 테스트는 사전 밖에 있는 한글 문자열 리터럴을 세서 그 재발을 막는다.
//
// ⚠ 전부를 금지하지는 않는다. 화면에 안 나가는 것은 정당한 예외다:
//   · 내부 불변식 위반 `throw` 메시지 (개발자용 — 사용자에게 안 보인다)
//   · JSON-LD 구조화 데이터 (검색엔진용 메타. 문서 기본 언어를 따른다)
//   · `src/luminance.js` 의 프리셋 표시명 (포맷 정의의 일부. UI 는 data-i18n 으로 덮는다)
// 그래서 «0 이어야 한다» 가 아니라 **알려진 예외 목록과 정확히 일치해야 한다** 로 고정한다.
// 예외가 늘면 테스트가 깨지고, 그 자리에서 «이건 화면에 나가나?» 를 묻게 된다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HANGUL = /[가-힣]/;

/** 주석을 지운다. 문자열 안의 `//` 를 주석으로 오인하지 않도록 상태 기계로 훑는다. */
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        if (src[i] === c) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** 문자열 리터럴을 (내용, 시작 오프셋) 으로 뽑는다. */
function stringLiterals(src) {
  const found = [];
  for (let i = 0; i < src.length;) {
    const q = src[i];
    if (q !== '"' && q !== "'" && q !== '`') { i += 1; continue; }
    const start = i;
    i += 1;
    let body = '';
    while (i < src.length) {
      if (src[i] === '\\') { body += src[i + 1] || ''; i += 2; continue; }
      if (src[i] === q) { i += 1; break; }
      body += src[i];
      i += 1;
    }
    found.push({ body, start });
  }
  return found;
}

/** 언어 사전 객체들의 범위. 키가 `ko:` 든 `"ko":` 든 잡는다. */
// ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): fr·it·de·es·pt 를 넣는다.
//   여기서 빠지면 새 사전 블록이 «사전 밖» 으로 잡혀, 그 안의 한국어(=번역 누락)가
//   ALLOWED 예외 수에 섞여 들어간다 — 잡아야 할 결함이 다른 결함으로 위장된다.
function dictRanges(src) {
  const ranges = [];
  const re = /["']?(ko|en|ja|fr|it|de|es|pt)["']?\s*:\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) { ranges.push({ lang: m[1], from: m.index, to: i }); break; }
      }
    }
  }
  return ranges.sort((a, b) => (a.to - a.from) - (b.to - b.from));
}

function analyze(rel, { htmlScripts = false } = {}) {
  const raw = readFileSync(ROOT + rel, 'utf8');
  const js = stripComments(
    htmlScripts
      ? [...raw.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((x) => x[1]).join('\n;\n')
      : raw,
  );
  const dicts = dictRanges(js);
  const owner = (pos) => (dicts.find((d) => pos >= d.from && pos <= d.to) || {}).lang;

  const outside = [];
  const wrongLang = [];
  for (const s of stringLiterals(js)) {
    if (!HANGUL.test(s.body)) continue;
    const lang = owner(s.start);
    if (lang === 'ko') continue;
    (lang ? wrongLang : outside).push(s.body.replace(/\s+/g, ' ').trim());
  }
  return { outside: [...new Set(outside)], wrongLang: [...new Set(wrongLang)] };
}

// 화면에 안 나가는 정당한 예외. 늘리려면 «정말 화면에 안 나가나?» 를 먼저 답할 것.
const ALLOWED = {
  // **의도적 갱신 (2026-08-19, §6.1 편집기 파인더 동기화)**: 7 → 8.
  // 더해진 1종은 `syncCellEditorFinderFromGenerator` 의 `console.warn` 이다 —
  // 개발자 콘솔 전용이라 화면에 안 나간다(위 헤더의 «내부 불변식 throw» 와 같은 부류).
  // 이 경고가 필요한 이유: resolveFinderStarter 는 모르는 id 를 catch 로 삼켜 조용히
  // 불스아이로 되돌린다. 그 침묵이 §6.1 증상의 절반이었으므로 침묵만은 남기지 않는다.
  // **의도적 갱신 (W2 C4, 2026-08-24)**: 8 → 9. 더해진 1종은 `ensureSeatCards` 의
  // «seat 카드 표현 누락» throw 다 — zoneCards() 유도에 있는데 아이콘·라벨 매핑이
  // 없으면 로드 시점에 던지는 내부 불변식이라 화면에 안 나간다 (헤더의 «내부
  // 불변식 throw» 부류). 이 throw 가 필요한 이유: 매핑은 유도가 아니라 표현 층의
  // 사본이고, 조용히 빠지면 카드가 라벨 없이 선다.
  'index.html': 9, // JSON-LD 7 + 편집기 파인더 폴백 console.warn 1 + seat 표현 불변식 throw 1
  'sites/tlscan/scanner.js': 0,
  'src/luminance.js': 7, // 프리셋 표시명 3 + 내부 불변식 throw 4
  // **의도적 갱신 (2026-08-21, 중앙 v0 편입)**: 9 → 11. 더해진 것은 throw **하나**인데
  // 세는 단위가 «문자열 리터럴» 이라 2종으로 잡힌다 (메시지를 `+` 로 이어 붙였다).
  // 내용은 VERSIONS 를 훑어 `overheadBreakdown.bullseye` 가 중앙 슬롯 셀 수와
  // 어긋나면 **모듈 로드 시점에** 던지는 검사다 — 화면엔 안 나간다(나갈 땐 이미
  // 앱이 안 뜬 뒤다). 위 `실계산 사용 심볼…` 도 같은 이유로 2종을 차지한다.
  'src/capacity.js': 11, // 전부 내부 불변식 throw
};

for (const [rel, allowed] of Object.entries(ALLOWED)) {
  test(`${rel} — 사전 밖 한국어 문자열이 알려진 예외뿐이다`, () => {
    const { outside } = analyze(rel, { htmlScripts: rel.endsWith('.html') });
    assert.equal(outside.length, allowed,
      `사전 밖 한국어가 ${outside.length}종 (알려진 예외 ${allowed}종).\n`
      + `늘었다면 UI 문구를 t()/tf() 없이 박은 것이다 — 언어를 바꿔도 안 바뀐다.\n`
      + `줄었다면 예외를 고친 것이니 이 숫자를 낮춰라.\n`
      + outside.map((s) => `  · ${s.slice(0, 100)}`).join('\n'));
  });
}

// ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): dictRanges 가 8언어를 잡으므로
//   이 테스트는 이름을 바꾸지 않아도 fr·it·de·es·pt 까지 함께 잰다. 이름이 주장보다
//   작아지지 않게 제목만 맞춘다.
test('ko 외 사전(en·ja·fr·it·de·es·pt)에 한국어가 남아 있지 않다', () => {
  for (const rel of ['index.html', 'sites/tlscan/strings.js']) {
    const { wrongLang } = analyze(rel, { htmlScripts: rel.endsWith('.html') });
    assert.deepEqual(wrongLang, [],
      `${rel}: 다른 언어 사전에 한국어가 남았다 — 번역 누락이다`);
  }
});

test('인자 없는 sync* 함수가 전부 TEXT_SYNCERS 에 등록돼 있다', () => {
  // 언어 전환은 JS 가 채운 문구를 **다시 그려야** 완성된다. 목록에서 빠진 함수의
  // 문구는 바뀌기 전 언어로 굳는데, 화면상 «저기만 번역 안 됨» 으로 보여서 원인을
  // 엉뚱한 데서 찾게 된다. 실제로 두 번 그랬다(2026-08-11).
  //
  // 인자를 받는 update* 는 render() 가 인코딩 결과와 함께 부르므로 제외한다.
  const src = readFileSync(`${ROOT}index.html`, 'utf8');
  const declared = [...src.matchAll(/^function (sync[A-Za-z]*)\(\)\s*\{/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 8, `sync 함수를 너무 적게 찾았다(${declared.length}) — 파서가 깨졌을 수 있다`);

  const listMatch = /const TEXT_SYNCERS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(listMatch, 'TEXT_SYNCERS 목록을 못 찾았다');
  const registered = new Set(listMatch[1].split(',').map((s) => s.trim()).filter(Boolean));

  const missing = declared.filter((fn) => !registered.has(fn));
  assert.deepEqual(missing, [],
    `TEXT_SYNCERS 에 빠진 함수: ${missing.join(', ')} — 언어를 바꿔도 이 함수가 채우는 문구는 안 바뀐다`);

  const unknown = [...registered].filter((fn) => !declared.includes(fn));
  assert.deepEqual(unknown, [],
    `TEXT_SYNCERS 에 없는 함수가 있다: ${unknown.join(', ')} — 이름이 바뀌었거나 인자를 받게 됐다`);
});

test('생성기 사전에 중복 키가 없다', () => {
  // ⚠ 이건 아래 «같은 키 집합» 단언이 **원리적으로 못 보는** 각도다. 객체 리터럴에
  // 같은 키가 두 번 있어도 집합은 그대로고, 실행할 때 **뒤엣것이 조용히 이긴다.**
  // 2026-08-26 실제 사고: 새 문구에 이미 쓰이는 g992 를 골라 8언어에 넣었는데
  // 커버리지는 초록이었다. 화면에는 남의 문구(음영 경고)가 나왔을 것이다.
  // ⇒ 새 키는 «최대 + 1» 이 아니라 **실제 미사용**에서 고른다 (g999 까지 차 있었다).
  const raw = readFileSync(`${ROOT}index.html`, 'utf8');
  const start = raw.indexOf('const GENERATOR_STRINGS = {');
  assert.ok(start >= 0, 'GENERATOR_STRINGS 를 못 찾았다');
  const js = raw.slice(start, raw.indexOf('\n};', start));
  const counts = new Map();
  // g1000 이상도 센다. 종전 `{3}`은 g1009~ 신규 키를 통째로 놓쳐 8언어 누락을
  // 초록으로 만들었다 — 자가 새 키 체계보다 먼저 늙은 경우다.
  for (const m of js.matchAll(/"(g\d{3,})":/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  assert.ok(counts.size > 0, '사전 키를 하나도 못 셌다 — 자가 무너졌다');
  // 언어가 여덟이므로 정상 키는 정확히 8회다. 그보다 많으면 중복, 적으면 누락.
  const wrong = [...counts.entries()].filter(([, c]) => c !== 8);
  assert.deepEqual(wrong, [],
    '8회가 아닌 키가 있다 (많으면 **중복** — 뒤엣것이 이겨 엉뚱한 문구가 나온다, '
    + '적으면 누락 — 한국어로 조용히 폴백한다): '
    + wrong.map(([k, c]) => k + '×' + c).join(' '));
  for (let n = 1014; n <= 1022; n += 1) {
    assert.equal(counts.get('g' + n), 8, `Type C UI 키 g${n}가 여덟 사전에 모두 있어야 한다`);
  }
});

test('생성기 사전의 여덟 언어가 같은 키 집합을 갖는다', () => {
  // 키가 빠지면 조용히 한국어로 폴백한다(i18n.js translate). 그게 이번 사고의
  // 증상과 똑같이 보이므로, 폴백에 기대지 말고 여기서 막는다.
  const raw = readFileSync(`${ROOT}index.html`, 'utf8');
  const start = raw.indexOf('const GENERATOR_STRINGS = {');
  assert.ok(start >= 0, 'GENERATOR_STRINGS 를 못 찾았다');
  const js = raw.slice(start, raw.indexOf('\n};', start));
  const keysOf = (lang) => {
    const at = js.search(new RegExp(`["']?${lang}["']?\\s*:\\s*\\{`));
    assert.ok(at >= 0, `${lang} 사전이 없다`);
    const open = js.indexOf('{', at);
    let depth = 0;
    let end = -1;
    for (let i = open; i < js.length; i += 1) {
      if (js[i] === '{') depth += 1;
      else if (js[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    return new Set([...js.slice(open, end).matchAll(/"(g\d{3,})"\s*:/g)].map((m) => m[1]));
  };
  const ko = keysOf('ko');
  // ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): en·ja → 7개 대상 언어.
  //   폴백(translate 의 ko 폴백)이 누락을 삼켜 «번역된 것처럼 보이는» 사고를 막는
  //   자리라, 언어가 늘면 이 목록도 반드시 같이 는다.
  for (const lang of ['en', 'ja', 'fr', 'it', 'de', 'es', 'pt']) {
    const other = keysOf(lang);
    const missing = [...ko].filter((k) => !other.has(k));
    const extra = [...other].filter((k) => !ko.has(k));
    assert.deepEqual(missing, [], `${lang} 사전에 빠진 키: ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `${lang} 사전에만 있는 키: ${extra.join(', ')}`);
  }
  assert.ok(ko.size > 100, `키가 너무 적다(${ko.size}) — 파서가 깨졌을 수 있다`);
});

test('g581은 8언어 모두 «안쪽 QR 우선» 역방향 안내다', () => {
  // **의도적 갱신 (2026-08-29, 결정 1)** — 구 문구는 «QR 위치를 바꾸면 고를 수
  // 있다»(하드 잠금의 안내)였다. 안쪽 활성 중 다른 검출기 클릭이 «직전 바깥 위치
  // 복귀 후 선택» 으로 정의되면서(§1), 문구가 그 결과를 예고하도록 바뀌었다.
  // 재는 성질은 그대로다: 8언어가 같은 역방향 안내를 갖는다.
  const raw = readFileSync(`${ROOT}index.html`, 'utf8');
  const start = raw.indexOf('const GENERATOR_STRINGS = {');
  const js = raw.slice(start, raw.indexOf('\n};', start));
  const values = [...js.matchAll(/"g581":\s*("(?:\\.|[^"])*")/g)]
    .map((match) => JSON.parse(match[1]));
  assert.deepEqual(values, [
    '안쪽 QR 이 가운데를 쓰고 있어요. 이 검출기를 고르면 QR 링크가 직전 바깥 위치로 돌아가요.',
    'The inner QR is using the centre. Choosing this finder moves the QR link back to its previous outer position.',
    '内側 QR が中央を使っています。このファインダーを選ぶと、QR リンクは直前の外側位置に戻ります。',
    'Le QR intérieur occupe le centre. Choisir ce repère ramène le lien QR à sa position extérieure précédente.',
    'Il QR interno occupa il centro. Scegliendo questo finder, il link QR torna alla posizione esterna precedente.',
    'Der innere QR belegt die Mitte. Wenn Sie diesen Finder wählen, kehrt der QR-Link zur vorherigen äußeren Position zurück.',
    'El QR interior ocupa el centro. Al elegir este localizador, el enlace QR vuelve a su posición exterior anterior.',
    'O QR interno ocupa o centro. Ao escolher este localizador, o link QR volta à posição externa anterior.',
  ]);
});
