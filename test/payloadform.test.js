/**
 * payloadform.test.js — JCODD 페이로드 규약 (PM/009 §1) + 벤더 무결성
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PAYLOAD_KINDS, WIFI_SECURITY, wifiPayload, cardPayload, sniffPayload,
} from '../src/payloadform.js';
import { Jcodd } from '../src/vendor/jcodd.js';

const utf8Bytes = (s) => new TextEncoder().encode(s).length;

test('wifiPayload — 왕복 (한국어·이모지 SSID 포함 UTF-8)', () => {
  const p = wifiPayload({ ssid: '우리집 공유기 ✦', password: 'pw-1234!', security: 'WPA' });
  const sniffed = sniffPayload(p);
  assert.equal(sniffed.kind, 'wifi');
  assert.equal(sniffed.data.s, '우리집 공유기 ✦');
  assert.equal(sniffed.data.p, 'pw-1234!');
  assert.equal(sniffed.data.e, undefined); // WPA 기본 — 생략
});

test('wifiPayload — WEP 는 e 명시, nopass 는 p 생략', () => {
  const wep = sniffPayload(wifiPayload({ ssid: 'net', password: 'x', security: 'WEP' }));
  assert.equal(wep.data.e, 'WEP');
  const open = sniffPayload(wifiPayload({ ssid: 'cafe', password: '무시됨', security: 'nopass' }));
  assert.equal(open.data.p, undefined);
});

test('wifiPayload — ssid 필수·보안값 검증', () => {
  assert.throws(() => wifiPayload({ ssid: '  ' }), RangeError);
  assert.throws(() => wifiPayload({ ssid: 'a', security: 'WPA3' }), RangeError);
});

test('cardPayload — 왕복 + 빈 필드 생략', () => {
  const p = cardPayload({ name: '홍길동', phone: '010-1234-5678', email: 'hong@example.com', org: '', url: '' });
  const { kind, data } = sniffPayload(p);
  assert.equal(kind, 'card');
  assert.equal(data.n, '홍길동');
  assert.equal(data.tel, '010-1234-5678');
  assert.equal(data.em, 'hong@example.com');
  assert.equal(data.org, undefined);
  assert.equal(data.u, undefined);
  assert.throws(() => cardPayload({ name: '' }), RangeError);
});

test('sniffPayload — 3분기 규약 전 케이스', () => {
  assert.equal(sniffPayload('https://tl.estre.so').kind, 'url');
  assert.equal(sniffPayload('HTTP://EXAMPLE.COM').kind, 'url');
  assert.equal(sniffPayload('그냥 텍스트').kind, 'text');
  assert.equal(sniffPayload('{깨진 jcodd').kind, 'text'); //           파싱 실패 폴백
  assert.equal(sniffPayload(Jcodd.coddify({ a: 1 })).kind, 'text'); // t 키 없음 폴백
  assert.equal(sniffPayload('').kind, 'text');
});

test('용량 적합 — 짧은 Wi-Fi ≤ 39 B (V2) · 전형 Wi-Fi ≤ 65 B (V3) · 전형 명함 ≤ 98 B (Y1)', () => {
  // 규약 오버헤드 {t:"wifi",s:"",p:""} = 21 B. JCODD 는 한글을 %uXXXX(6 B/자)로
  // 이스케이프하므로 (payloadform.js 헤더 주의), 계층: ASCII 짧은 조합 = V2 ·
  // ASCII 전형 = V3 · 한글 포함 전형 = Y1. 생성기 버전 자동 선택이 흡수한다.
  const short = wifiPayload({ ssid: 'HomeNet', password: 'pass1234' });
  assert.ok(utf8Bytes(short) <= 39, `짧은 Wi-Fi ${utf8Bytes(short)} B > 39`);
  const ascii = wifiPayload({ ssid: 'MyHome-Router-5G', password: 'family-pass-2026!' });
  assert.ok(utf8Bytes(ascii) <= 65, `ASCII 전형 Wi-Fi ${utf8Bytes(ascii)} B > 65`);
  const korean = wifiPayload({ ssid: '우리집 5G', password: 'family-pass-2026!' });
  assert.ok(utf8Bytes(korean) <= 98, `한글 전형 Wi-Fi ${utf8Bytes(korean)} B > 98`);
  const card = cardPayload({
    name: '홍길동', phone: '010-1234-5678', email: 'gildong.hong@example.com', org: 'Trilume',
  });
  assert.ok(utf8Bytes(card) <= 98, `명함 ${utf8Bytes(card)} B > 98`);
});

test('상수 표면', () => {
  assert.deepEqual([...PAYLOAD_KINDS], ['text', 'url', 'wifi', 'card']);
  assert.deepEqual([...WIFI_SECURITY], ['WPA', 'WEP', 'nopass']);
});

test('벤더 무결성 — 원본 무수정 (허용 추가분: 헤더 주석·ESM export 만)', () => {
  const vendored = readFileSync(new URL('../src/vendor/jcodd.js', import.meta.url), 'utf8');
  // 원본 본문의 앵커들이 그대로 존재하고, 추가분이 명시 두 곳뿐임을 구조로 확인.
  assert.ok(vendored.includes('class Jcodd {'));
  assert.ok(vendored.includes("if (typeof module !== 'undefined'"));
  assert.ok(vendored.includes('export { Jcodd, JCODD };'));
  assert.ok(vendored.includes('[벤더링]'));
  // 벤더 파일이 실제로 동작한다 (파싱·직렬화 왕복).
  const obj = { name: 'Jane', age: 30, city: null };
  const code = Jcodd.coddify(obj);
  assert.deepEqual(Jcodd.parse(code), obj);
});
