// hub-build.test.js — 소개 허브 3언어 산출물이 생성기와 어긋나지 않는지 지킨다.
//
// 왜 필요한가: `sites/tl/**/index.html` 은 **생성물**인데 손으로 고치기 쉬운 모양(그냥
// HTML)이다. 손으로 고치면 다음 `node tools/build-hub.mjs` 에 조용히 덮여 사라지고,
// 반대로 문구를 `tools/hub-content.mjs` 에만 고치고 생성을 안 돌리면 배포본이 옛 문구를
//유지한다. 번들(dist)에 걸어 둔 동기화 가드와 같은 이유다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { languages, strings, stats } from '../tools/hub-content.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const pagePath = (lang) => `${ROOT}sites/tl/${lang.dir}index.html`;
const read = (lang) => readFileSync(pagePath(lang), 'utf8');

test('동기화: build-hub.mjs 를 다시 돌려도 3언어 산출물이 바뀌지 않는다', () => {
  const before = languages.map((l) => read(l));
  execFileSync(process.execPath, [`${ROOT}tools/build-hub.mjs`], { stdio: 'pipe' });
  const after = languages.map((l) => read(l));
  languages.forEach((l, i) => {
    assert.equal(after[i], before[i],
      `sites/tl/${l.dir}index.html 이 최신이 아니에요. tools/hub-content.mjs 를 고쳤으면 node tools/build-hub.mjs 를 다시 실행하세요.`);
  });
});

test('3언어 모두 자기 언어·정본 URL·hreflang 을 갖는다', () => {
  for (const lang of languages) {
    const html = read(lang);
    assert.match(html, new RegExp(`<html lang="${lang.htmlLang}"`), `${lang.code}: html lang`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://tl\\.estre\\.so/${lang.dir}">`), `${lang.code}: canonical`);
    // 세 언어 + x-default = 4개. 하나라도 빠지면 검색엔진이 언어판을 중복으로 본다.
    assert.equal((html.match(/rel="alternate" hreflang=/g) || []).length, languages.length + 1, `${lang.code}: hreflang 개수`);
    assert.match(html, /hreflang="x-default"/, `${lang.code}: x-default`);
  }
});

test('언어 디렉터리의 자산 경로가 한 단계 올라간다', () => {
  for (const lang of languages) {
    const html = read(lang);
    const expected = lang.dir === '' ? 'assets/type-Y.png' : '../assets/type-Y.png';
    assert.ok(html.includes(`src="${expected}"`),
      `${lang.code}: 자산 경로가 ${expected} 여야 한다 — 언어 디렉터리에서 흔한 404 원인이다`);
    const css = lang.dir === '' ? '../_shared/site.css' : '../../_shared/site.css';
    assert.ok(html.includes(`href="${css}?v=`), `${lang.code}: CSS 경로`);
  }
});

// nginx 는 `_shared/*` 에 7일 캐시를 주는데 HTML 에는 안 준다. 버전 쿼리가 없으면
// 재방문자가 **새 HTML + 옛 CSS/JS** 를 받는다 — 실제로 언어 드롭다운이 그 조합으로
// 모양이 깨지고 클릭이 안 먹었다. 해시가 내용과 함께 움직이는지 지킨다.
test('공유 자산 URL 에 내용 해시 버전이 붙는다 (캐시 스큐 방지)', () => {
  const shared = (name) => readFileSync(`${ROOT}sites/_shared/${name}`);
  const expected = (name) => createHash('sha256').update(shared(name)).digest('hex').slice(0, 8);
  for (const lang of languages) {
    const html = read(lang);
    for (const [name, v] of [['site.css', expected('site.css')], ['site.js', expected('site.js')]]) {
      assert.ok(html.includes(`${name}?v=${v}`),
        `${lang.code}: ${name} 의 버전 쿼리가 현재 파일 내용의 해시(${v})와 달라요 — build-hub 를 다시 돌리세요`);
    }
  }
});

test('실측 수치는 세 언어가 같은 값을 쓴다 (한 언어만 옛 숫자로 남지 않게)', () => {
  for (const lang of languages) {
    const html = read(lang);
    for (const type of ['Y', 'O', 'A']) {
      assert.ok(html.includes(stats.types[type].decoded),
        `${lang.code}: Type ${type} 복호 수치 ${stats.types[type].decoded} 가 없다`);
    }
    assert.ok(html.includes(stats.centerQr.decoded), `${lang.code}: 중앙 QR 수치`);
    assert.ok(html.includes(String(stats.cellFloorPx)), `${lang.code}: 셀당 픽셀 하한`);
    assert.ok(html.includes(stats.measuredOn), `${lang.code}: 측정일`);
  }
});

test('정지사진 1회 수치를 라이브 등급으로 외삽하지 않는다', () => {
  const forbidden = /복호 시간이 실시간 스캔 체감을 지배|Decode time dominates how live scanning feels|復号時間がリアルタイム性の体感を左右/;
  for (const lang of languages) {
    const html = read(lang);
    assert.doesNotMatch(html, forbidden, `${lang.code}: 철회한 라이브 인과 주장이 남아 있다`);
    assert.ok(html.includes(strings[lang.code].badgePending),
      `${lang.code}: 라이브 상태가 추가 측정 중으로 표시돼야 한다`);
    assert.ok(html.includes(strings[lang.code].thTime),
      `${lang.code}: 시간 열이 정지사진 1회 기준임을 밝혀야 한다`);
    assert.doesNotMatch(html, /badge ok">(?:쓸 만함|usable|実用的)/,
      `${lang.code}: 근거 없는 라이브 사용성 배지가 남아 있다`);
  }
});

// 상단 내비는 이 페이지의 목차다. 목차가 본문과 다른 순서로 서 있으면 방문자는
// «건너뛴 섹션이 있나» 하고 되짚는다. 실제로 내비만 옛 순서(why-now → what → types)로
// 남아 본문(why-now → types → what)과 어긋나 있었다.
test('상단 내비의 앵커 순서가 본문 섹션 순서와 같다', () => {
  for (const lang of languages) {
    const html = read(lang);
    const nav = /<nav>([\s\S]*?)<\/nav>/.exec(html);
    assert.ok(nav, `${lang.code}: nav 블록 없음`);
    const anchors = [...nav[1].matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
    assert.ok(anchors.length >= 4, `${lang.code}: 내비 앵커가 너무 적다 — 정규식이 안 맞는 것일 수 있다`);
    const sections = [...html.matchAll(/<section id="([\w-]+)"/g)].map((m) => m[1]);
    // 내비에 없는 섹션(hero)은 빼고, 남은 것끼리 순서를 비교한다.
    assert.deepEqual(anchors, sections.filter((id) => anchors.includes(id)),
      `${lang.code}: 내비 순서가 본문 섹션 순서와 다르다`);
    for (const id of anchors) {
      assert.ok(sections.includes(id), `${lang.code}: 내비가 없는 섹션 #${id} 을 가리킨다`);
    }
  }
});

// 언어 선택은 접힌 레이어다. 접혀 있어도 ① 지금 무슨 언어인지 보이고 ② 세 언어 링크가
// 문서에 남아야 한다 — 링크가 사라지면 크롤러의 언어판 연결이 끊긴다.
test('언어 선택이 닫힌 드롭다운이고 현재 언어를 토글에 드러낸다', () => {
  for (const lang of languages) {
    const html = read(lang);
    assert.match(html, /<div class="lang-drop-menu"[^>]*\shidden>/,
      `${lang.code}: 메뉴가 기본으로 닫혀 있어야 한다`);
    assert.match(html, /class="lang-drop-toggle"[^>]*aria-expanded="false"/,
      `${lang.code}: 토글의 초기 aria-expanded 는 false`);
    assert.ok(html.includes(`<span class="lang-drop-current">${lang.label}</span>`),
      `${lang.code}: 토글에 현재 언어(${lang.label})가 적혀 있어야 한다`);
    for (const l of languages) {
      assert.ok(html.includes(`data-lang-pick="${l.code}"`), `${lang.code}: ${l.code} 링크 누락`);
    }
  }
});

// llms.txt 계열은 **에이전트가 읽는 표면**이다. 사람 눈에 안 띄어서 조용히 낡는다 —
// 실제로 HTML 이 두 번 갱신되는 동안 이쪽은 「중앙 QR 미지원 · Type O 10.9초」로 남아
// 있었다. 페이지가 «된다» 고 말하는 것을 llms 는 «안 된다» 고 말하고 있었던 셈이다.
// 이 두 파일은 HTML 과 같은 수치를 싣는다고 선언했으므로 같은 값인지 지킨다.
const LLMS_WITH_STATS = ['sites/tl/llms.txt', 'sites/_shared/llms-tlscan.txt'];
test('llms.txt 계열이 페이지와 같은 실측값을 쓴다', () => {
  for (const rel of LLMS_WITH_STATS) {
    const txt = readFileSync(ROOT + rel, 'utf8');
    assert.ok(txt.includes(stats.measuredOn), `${rel}: 측정일이 ${stats.measuredOn} 이 아니다`);
    for (const type of ['Y', 'O', 'A']) {
      assert.ok(txt.includes(stats.types[type].decoded),
        `${rel}: Type ${type} 복호 수치 ${stats.types[type].decoded} 가 없다`);
    }
    assert.ok(txt.includes(stats.centerQr.decoded), `${rel}: 중앙 QR 수치`);
    assert.ok(!/개발 중/.test(txt),
      `${rel}: 「개발 중」이 남아 있다 — 페이지는 «동작 · 개선 중» 이라고 말하고 있다`);
    assert.doesNotMatch(txt, /복호 시간이 실시간 체감을 지배/,
      `${rel}: 철회한 라이브 인과 주장이 남아 있다`);
    assert.match(txt, /정지사진 1장|정지사진 한 장/,
      `${rel}: 시간 수치가 정지사진 기준임을 밝혀야 한다`);
  }
});

test('JSON-LD 가 파싱되고 문서 언어를 선언한다', () => {
  for (const lang of languages) {
    const html = read(lang);
    const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, `${lang.code}: JSON-LD 블록 없음`);
    const parsed = JSON.parse(match[1]);
    const article = parsed['@graph'].find((n) => n['@type'] === 'TechArticle');
    assert.equal(article.inLanguage, lang.code, `${lang.code}: TechArticle inLanguage`);
  }
});

test('번역 키가 세 언어에 빠짐없이 있다', () => {
  const keys = Object.keys(strings.ko);
  for (const lang of languages) {
    const missing = keys.filter((k) => !(k in strings[lang.code]));
    assert.deepEqual(missing, [], `${lang.code}: 누락된 키`);
    const empty = keys.filter((k) => String(strings[lang.code][k]).trim() === '');
    assert.deepEqual(empty, [], `${lang.code}: 빈 문자열`);
  }
});
