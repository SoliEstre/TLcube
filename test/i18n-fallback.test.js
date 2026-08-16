// i18n-fallback.test.js — 언어 자동 선택의 두 폴백을 분리해 고정한다.
//
// ① 브라우저 언어가 지원 밖(nl·pl 등)이면 **영어**로 (FALLBACK_LANGUAGE — 국제 기본값,
//    운영자 지시 2026-08-16). 허브의 첫 방문 리다이렉트 스크립트도 같은 규약이다.
// ② 사전에서 키가 빠지면 **한국어**로 (DEFAULT_LANGUAGE — 저작 원본이라 ko 만 완본).
// 두 폴백은 역할이 달라서 하나의 상수로 합치면 안 된다 — 합치는 순간 «지원 밖 브라우저에
// 한국어» 또는 «영어 사전 미스키가 키 문자열 노출» 중 하나로 퇴행한다.
//
// ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): 예시 언어가 fr·de 였는데 그 둘이
//   **지원 언어가 됐다.** 예시를 안 바꾸면 이 테스트는 «불어 브라우저는 영어로» 라는
//   이제 틀린 규약을 지키게 되고, 새 언어판이 있는데 아무도 도달 못 하는 상태를
//   초록으로 덮는다. 지원 밖 예시는 nl·pl 로 바꾸고, fr 은 반대로 «fr 로 간다» 를 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectLanguage, translate, DEFAULT_LANGUAGE, FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES,
} from '../src/i18n.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('지원 언어는 지역 부호를 버리고 그대로 선택된다', () => {
  assert.equal(detectLanguage(['ja-JP']), 'ja');
  assert.equal(detectLanguage(['en-GB', 'ko']), 'en');
  assert.equal(detectLanguage(['KO-kr']), 'ko');
});

test('새 5언어 브라우저는 자기 언어로 간다 (영어로 떨어지지 않는다)', () => {
  assert.equal(detectLanguage(['fr-FR']), 'fr');
  assert.equal(detectLanguage(['it-CH', 'de-CH']), 'it');
  assert.equal(detectLanguage(['de-AT']), 'de');
  assert.equal(detectLanguage(['es-MX']), 'es');
  assert.equal(detectLanguage(['pt-BR']), 'pt');
});

test('지원 밖 언어·빈 목록은 영어로 폴백한다 (ko 아님)', () => {
  assert.equal(FALLBACK_LANGUAGE, 'en');
  assert.equal(detectLanguage(['nl-NL', 'pl-PL']), 'en');
  assert.equal(detectLanguage([]), 'en');
  // 지원 언어가 뒤에 있으면 폴백보다 우선한다.
  assert.equal(detectLanguage(['nl-NL', 'ja']), 'ja');
});

// 목록 자체를 못 박는다. 사전만 8언어가 되고 이 상수가 3으로 남으면 `setLanguage` 가
// 조기 반환해 «드롭다운은 있는데 골라도 안 바뀐다» 로 출고된다 (실제로 과업 1 종료
// 시점의 상태였다). 반대로 상수만 넓히면 화면 절반이 한국어로 남는다.
test('지원 언어 목록이 여덟 언어로 고정돼 있다', () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES].sort(),
    ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt']);
  // 저작 원본·국제 기본값은 둘 다 목록 안에 있어야 폴백이 실제로 도달한다.
  assert.ok(SUPPORTED_LANGUAGES.includes(DEFAULT_LANGUAGE));
  assert.ok(SUPPORTED_LANGUAGES.includes(FALLBACK_LANGUAGE));
});

test('사전 미스키 폴백은 여전히 한국어다 (저작 원본)', () => {
  assert.equal(DEFAULT_LANGUAGE, 'ko');
  const dict = { ko: { a: '가', b: '나' }, en: { a: 'A' } };
  assert.equal(translate(dict, 'en', 'a'), 'A');
  assert.equal(translate(dict, 'en', 'b'), '나'); // en 에 없으면 ko
  assert.equal(translate(dict, 'en', 'c'), 'c'); // 어디에도 없으면 키 노출
});

test('허브 리다이렉트 스크립트도 지원 밖 언어를 영어로 보낸다 (규약 동기화)', () => {
  const hub = readFileSync(
    fileURLToPath(new URL('../tools/build-hub.mjs', import.meta.url)), 'utf8');
  assert.match(hub, /if \(!want\) want = 'en';/);
  // ⚠ **의도적 갱신** (2026-08-17): 리다이렉트가 «어느 언어를 지원 언어로 보는지» 를
  //   손으로 적으면 언어판을 늘린 날 여기만 옛 목록으로 남는다 — 새 /fr/ 이 있는데
  //   불어 브라우저는 계속 /en/ 으로 튕긴다. 목록을 languages 에서 찍어 내는지 잰다.
  assert.match(hub, /var supported = \$\{JSON\.stringify\(languages\.map\(\(l\) => l\.code\)\)\};/);
  assert.doesNotMatch(hub, /l === 'ko' \|\| l === 'en' \|\| l === 'ja'/);
});
