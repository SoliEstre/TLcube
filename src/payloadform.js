/**
 * payloadform.js — 구조화 페이로드 규약 (JCODD 기반, PM/009 §1)
 *
 * **애플리케이션 계층 규약이다 — 와이어 계약이 아니다.** SPEC §4.5 의 스탠스(페이로드는
 * UTF-8 텍스트, 타입 필드 없음, 콘텐츠 판별은 소비자 몫)를 그대로 유지하고, 그 "소비자
 * 판별"의 규약을 생성기·스캐너(tlscan)가 공유하도록 여기 못 박는다.
 *
 * 판별(스니핑) 규약 — tlscan 구현이 이 3분기를 그대로 쓴다:
 *   1. `/^https?:\/\//i` → URL (스캐너: 열기 동작)
 *   2. 선두 `{` + JCODD 파싱 성공 + 문자열 `t` 키 존재 → 구조화 콘텐츠 (t = 종류)
 *   3. 그 외 → 일반 텍스트
 *
 * JCODD 키 축약표 (규범 — 스캐너·생성기 공유):
 *   wifi: { t:"wifi", s: SSID(필수), p: 암호(없으면 생략), e: "WEP" (WPA 는 기본이라 생략) }
 *   card: { t:"card", n: 이름(필수), tel: 전화, em: 이메일, org: 조직, u: URL } — 빈 값 생략
 *
 * JCODD 는 사용자(메인테이너) 본인의 직렬화 라이브러리다 — src/vendor/jcodd.js 벤더링.
 *
 * ⚠ 용량 주의: JCODD 는 비 -ASCII 를 `%uXXXX` 로 이스케이프한다 (규약 4) — **한글 1자 =
 * 6 B** (UTF-8 원문 3 B 의 2배). 한글 SSID·이름이 든 페이로드는 V3/Y1 대역을 잡는 게
 * 보통이고, 생성기의 버전 자동 선택이 이를 흡수한다.
 */

import { Jcodd } from './vendor/jcodd.js';

/** 생성기·스캐너가 다루는 콘텐츠 종류. */
export const PAYLOAD_KINDS = Object.freeze(['text', 'url', 'wifi', 'card']);

/** Wi-Fi 보안 방식 허용값. 기본 WPA (직렬화 시 생략). */
export const WIFI_SECURITY = Object.freeze(['WPA', 'WEP', 'nopass']);

function cleanString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Wi-Fi 접속 정보 → JCODD 페이로드 문자열.
 * @param {{ssid: string, password?: string, security?: 'WPA'|'WEP'|'nopass'}} fields
 * @returns {string} 예: `{t:"wifi",s:"MyNet",p:"pw1234"}`
 */
export function wifiPayload(fields) {
  const ssid = cleanString(fields && fields.ssid);
  if (ssid === '') throw new RangeError('Wi-Fi 페이로드에는 ssid 가 필수다');
  const security = fields.security === undefined ? 'WPA' : fields.security;
  if (!WIFI_SECURITY.includes(security)) {
    throw new RangeError(`security 는 ${WIFI_SECURITY.join(' | ')} 중 하나여야 한다: ${security}`);
  }
  const password = cleanString(fields.password);

  const obj = { t: 'wifi', s: ssid };
  if (security !== 'nopass' && password !== '') obj.p = password;
  if (security === 'WEP') obj.e = 'WEP'; // WPA(기본)·nopass(p 부재로 표현)는 생략
  return Jcodd.coddify(obj);
}

/**
 * 명함 → JCODD 페이로드 문자열. name 외 빈 필드는 생략된다.
 * @param {{name: string, phone?: string, email?: string, org?: string, url?: string}} fields
 * @returns {string} 예: `{t:"card",n:"홍길동",tel:"010-...",em:"a@b.c"}`
 */
export function cardPayload(fields) {
  const name = cleanString(fields && fields.name);
  if (name === '') throw new RangeError('명함 페이로드에는 name 이 필수다');
  const obj = { t: 'card', n: name };
  const tel = cleanString(fields.phone);
  const em = cleanString(fields.email);
  const org = cleanString(fields.org);
  const u = cleanString(fields.url);
  if (tel !== '') obj.tel = tel;
  if (em !== '') obj.em = em;
  if (org !== '') obj.org = org;
  if (u !== '') obj.u = u;
  return Jcodd.coddify(obj);
}

/**
 * 페이로드 판별 (스니핑 규약의 레퍼런스 구현 — tlscan 과 공유).
 * 실패는 조용히 text 로 폴백한다 (소비자 규약 — 판별기는 던지지 않는다).
 *
 * @param {string} text 복호된 페이로드
 * @returns {{kind: string, data?: object}} kind: 'url' | 'text' | JCODD 의 t 값 ('wifi'·'card'·…)
 */
export function sniffPayload(text) {
  if (typeof text !== 'string' || text.length === 0) return { kind: 'text' };
  if (/^https?:\/\//i.test(text)) return { kind: 'url' };
  if (text[0] === '{') {
    try {
      const obj = Jcodd.parse(text);
      if (obj !== null && typeof obj === 'object' && typeof obj.t === 'string' && obj.t !== '') {
        return { kind: obj.t, data: obj };
      }
    } catch {
      // 파싱 실패 → text 폴백
    }
  }
  return { kind: 'text' };
}
