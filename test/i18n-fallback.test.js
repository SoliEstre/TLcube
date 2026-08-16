// i18n-fallback.test.js — 언어 자동 선택의 두 폴백을 분리해 고정한다.
//
// ① 브라우저 언어가 지원 밖(fr·de 등)이면 **영어**로 (FALLBACK_LANGUAGE — 국제 기본값,
//    운영자 지시 2026-08-16). 허브의 첫 방문 리다이렉트 스크립트도 같은 규약이다.
// ② 사전에서 키가 빠지면 **한국어**로 (DEFAULT_LANGUAGE — 저작 원본이라 ko 만 완본).
// 두 폴백은 역할이 달라서 하나의 상수로 합치면 안 된다 — 합치는 순간 «불어 브라우저에
// 한국어» 또는 «영어 사전 미스키가 키 문자열 노출» 중 하나로 퇴행한다.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectLanguage, translate, DEFAULT_LANGUAGE, FALLBACK_LANGUAGE,
} from '../src/i18n.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('지원 언어는 지역 부호를 버리고 그대로 선택된다', () => {
  assert.equal(detectLanguage(['ja-JP']), 'ja');
  assert.equal(detectLanguage(['en-GB', 'ko']), 'en');
  assert.equal(detectLanguage(['KO-kr']), 'ko');
});

test('지원 밖 언어·빈 목록은 영어로 폴백한다 (ko 아님)', () => {
  assert.equal(FALLBACK_LANGUAGE, 'en');
  assert.equal(detectLanguage(['fr-FR', 'de-DE']), 'en');
  assert.equal(detectLanguage([]), 'en');
  // 지원 언어가 뒤에 있으면 폴백보다 우선한다.
  assert.equal(detectLanguage(['fr-FR', 'ja']), 'ja');
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
});
