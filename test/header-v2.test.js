// header-v2.test.js — 예약된 프레이밍 v2 (미배선 모듈)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  HEADER_BYTES_V2,
  CRC24_POLY,
  CRC24_INIT,
  crc24,
  frameV2,
  unframeV2,
  maxPayloadForV2,
} from '../src/header-v2.js';

describe('상수', () => {
  test('4 B 헤더, OpenPGP CRC-24 다항식·초기값', () => {
    assert.equal(HEADER_BYTES_V2, 4);
    assert.equal(CRC24_POLY, 0x864CFB);
    assert.equal(CRC24_INIT, 0xB704CE);
  });

  test('maxPayloadForV2 = 데이터 영역 − 4', () => {
    assert.equal(maxPayloadForV2(19), 15);
    assert.equal(maxPayloadForV2(4), 0);
    assert.equal(maxPayloadForV2(3), 0);
  });
});

describe('CRC-24/OpenPGP', () => {
  test('체크값 crc24("123456789") === 0x21CF02', () => {
    const bytes = new TextEncoder().encode('123456789');
    assert.equal(crc24(bytes), 0x21CF02);
  });

  test('전-0 19 B 입력의 CRC 는 0 이 아니다 (init≠0)', () => {
    assert.notEqual(crc24(new Uint8Array(19)), 0);
  });
});

describe('전-0 데이터 영역 거부', () => {
  test('19 B 전-0 은 CRC 불일치로 던진다', () => {
    assert.throws(() => unframeV2(new Uint8Array(19)), /CRC-24/);
  });
});

describe('왕복', () => {
  const CASES = ['', 'a', 'hello world', '안녕하세요', 'https://tl.estre.so', '🎲'];

  test('frameV2 → unframeV2 가 항등', () => {
    for (const text of CASES) {
      const need = new TextEncoder().encode(text).length + HEADER_BYTES_V2;
      for (const dataBytes of [need, need + 1, need + 20]) {
        const framed = frameV2(text, dataBytes);
        assert.equal(framed.length, dataBytes);
        const back = unframeV2(framed);
        assert.equal(back.text, text, `"${text}" @ ${dataBytes}B`);
        assert.equal(back.payloadLength, new TextEncoder().encode(text).length);
      }
    }
  });
});

describe('길이 필드 손상 → CRC 불일치', () => {
  test('길이 바이트를 뒤집으면 CRC 가 막는다', () => {
    const framed = frameV2('https://tl.estre.so', 32);
    const damaged = framed.slice();
    damaged[0] = (damaged[0] + 1) & 0xFF;
    assert.throws(() => unframeV2(damaged), /CRC-24/);
  });
});
