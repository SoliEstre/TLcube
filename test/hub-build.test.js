// hub-build.test.js — 소개 허브 3언어 산출물이 생성기와 어긋나지 않는지 지킨다.
//
// 왜 필요한가: `sites/tl/**/index.html` 은 **생성물**인데 손으로 고치기 쉬운 모양(그냥
// HTML)이다. 손으로 고치면 다음 `node tools/build-hub.mjs` 에 조용히 덮여 사라지고,
// 반대로 문구를 `tools/hub-content.mjs` 에만 고치고 생성을 안 돌리면 배포본이 옛 문구를
//유지한다. 번들(dist)에 걸어 둔 동기화 가드와 같은 이유다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
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
    assert.ok(html.includes(`href="${css}"`), `${lang.code}: CSS 경로`);
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
