/**
 * server.test.js — Origin 허용목록·토큰 설정의 순수 함수 단위.
 *
 * 소켓을 열지 않고 loadConfig / parseAllowedOrigins / isOriginAllowed 만 잰다.
 * 실제 거부/통과 통합은 ws.test.js 가 소켓으로 실증한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig, parseAllowedOrigins, isOriginAllowed } from './server.mjs';

test('parseAllowedOrigins — 미설정은 null(개발 기본값), 콤마·빈항목 처리', () => {
  assert.equal(parseAllowedOrigins(undefined), null);
  assert.equal(parseAllowedOrigins(null), null);
  assert.deepEqual(parseAllowedOrigins(''), []);
  assert.deepEqual(
    parseAllowedOrigins('https://a.example, ,https://b.example ,'),
    ['https://a.example', 'https://b.example'],
  );
  assert.deepEqual(
    parseAllowedOrigins(['https://a.example', '', '  https://c.example  ']),
    ['https://a.example', 'https://c.example'],
  );
});

test('isOriginAllowed — null(개발 기본값): localhost 계열만, 모든 포트', () => {
  assert.equal(isOriginAllowed('http://localhost', null), true);
  assert.equal(isOriginAllowed('http://localhost:5173', null), true);
  assert.equal(isOriginAllowed('https://127.0.0.1:8443', null), true);
  assert.equal(isOriginAllowed('http://[::1]:3000', null), true);
  // 부재·비브라우저·외부는 거부
  assert.equal(isOriginAllowed(undefined, null), false);
  assert.equal(isOriginAllowed('', null), false);
  assert.equal(isOriginAllowed('https://evil.example', null), false);
  // localhost 를 흉내낸 서브도메인 트릭도 거부 (hostname 정확 일치)
  assert.equal(isOriginAllowed('http://localhost.evil.example', null), false);
  assert.equal(isOriginAllowed('http://127.0.0.1.evil.example', null), false);
  // 비-http(s) 스킴 거부
  assert.equal(isOriginAllowed('file://localhost', null), false);
  assert.equal(isOriginAllowed('null', null), false);
});

test('isOriginAllowed — 명시 목록: 정확히 일치하는 것만, Origin 부재는 거부', () => {
  const list = ['https://tlcube.estre.so', 'https://lab.estre.so'];
  assert.equal(isOriginAllowed('https://tlcube.estre.so', list), true);
  assert.equal(isOriginAllowed('https://lab.estre.so', list), true);
  // 목록에 없으면 localhost 도 거부 (개발 기본값이 꺼진다)
  assert.equal(isOriginAllowed('http://localhost', list), false);
  assert.equal(isOriginAllowed('https://tlcube.estre.so.evil.example', list), false);
  assert.equal(isOriginAllowed(undefined, list), false);
  assert.equal(isOriginAllowed('', list), false);
  // 빈 목록([])은 아무 오리진도 통과시키지 않는다
  assert.equal(isOriginAllowed('http://localhost', []), false);
});

test('loadConfig — env 로 오리진·토큰이 흘러 들어온다', () => {
  const dev = loadConfig({});
  assert.equal(dev.allowedOrigins, null);
  assert.equal(dev.token, '');

  const prod = loadConfig({
    TL_LAB_ALLOWED_ORIGINS: 'https://tlcube.estre.so',
    TL_LAB_TOKEN: 's3cret',
  });
  assert.deepEqual(prod.allowedOrigins, ['https://tlcube.estre.so']);
  assert.equal(prod.token, 's3cret');

  // override 가 env 를 이긴다
  const ov = loadConfig(
    { TL_LAB_ALLOWED_ORIGINS: 'https://env.example' },
    { allowedOrigins: ['https://override.example'], token: 'ov' },
  );
  assert.deepEqual(ov.allowedOrigins, ['https://override.example']);
  assert.equal(ov.token, 'ov');
});
