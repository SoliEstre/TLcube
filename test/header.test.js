// header.test.js — SPEC §4.5 헤더/프레이밍 계약 테스트

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  HEADER_BYTES, MAX_PAYLOAD_BYTES, PAD_BYTE,
  maxPayloadFor, payloadByteLength, frame, unframe,
} from '../src/header.js';

describe('상수 (SPEC §4.5)', () => {
  test('길이 필드는 1 바이트, 최대 255 B, 패딩은 0x00', () => {
    assert.equal(HEADER_BYTES, 1);
    assert.equal(MAX_PAYLOAD_BYTES, 255);
    assert.equal(PAD_BYTE, 0x00);
  });

  test('1 바이트 길이 필드가 SPEC §5.5 전 버전을 덮는다', () => {
    // V1/V2/V3 순 페이로드 18 / 38 / 65 B. 대형 확장도 ~140 B 수준.
    for (const net of [18, 38, 65, 140]) assert.ok(net <= MAX_PAYLOAD_BYTES);
  });
});

describe('용량 산술', () => {
  test('maxPayloadFor = 데이터 영역 − 헤더', () => {
    assert.equal(maxPayloadFor(19), 18);   // V1: 코드워드 25 − 패리티 6
    assert.equal(maxPayloadFor(39), 38);   // V2: 53 − 14
    assert.equal(maxPayloadFor(66), 65);   // V3: 88 − 22
  });

  test('길이 필드 상한에서 잘린다', () => {
    assert.equal(maxPayloadFor(1000), MAX_PAYLOAD_BYTES);
  });

  test('헤더도 안 들어가면 0', () => {
    assert.equal(maxPayloadFor(0), 0);
    assert.equal(maxPayloadFor(1), 0);
  });

  test('잘못된 인자는 예외', () => {
    assert.throws(() => maxPayloadFor(-1), RangeError);
    assert.throws(() => maxPayloadFor(1.5), RangeError);
  });
});

describe('UTF-8 바이트 수 (문자 수 아님)', () => {
  test('한글 1자 = 3 바이트', () => {
    assert.equal(payloadByteLength('가'), 3);
    assert.equal(payloadByteLength('안녕'), 6);
  });

  test('ASCII 1자 = 1 바이트, 이모지는 4 바이트', () => {
    assert.equal(payloadByteLength('abc'), 3);
    assert.equal(payloadByteLength('🎲'), 4);
  });

  test('V1(18 B)에 한글은 6자까지', () => {
    assert.equal(payloadByteLength('가나다라마바'), 18);
    assert.equal(payloadByteLength('가나다라마바사'), 21);
  });
});

describe('frame — 고정 크기 데이터 영역', () => {
  test('길이가 항상 dataBytes 와 정확히 같다', () => {
    for (const n of [3, 19, 39, 66, 200]) {
      assert.equal(frame('hi', n).length, n, `dataBytes=${n}`);
    }
    // 페이로드가 비어도 데이터 영역은 고정 크기로 채워진다
    for (const n of [1, 2, 19]) {
      assert.equal(frame('', n).length, n, `빈 페이로드 @ dataBytes=${n}`);
    }
  });

  test('데이터 영역이 너무 작으면 던진다 (조용히 자르지 않는다)', () => {
    assert.throws(() => frame('hi', 1), RangeError);   // 용량 0
    assert.throws(() => frame('hi', 2), RangeError);   // 용량 1 < 2
  });

  test('0번 바이트가 페이로드 바이트 수', () => {
    assert.equal(frame('hello', 39)[0], 5);
    assert.equal(frame('안녕', 39)[0], 6);
    assert.equal(frame('', 39)[0], 0);
  });

  test('나머지는 전부 0x00 패딩', () => {
    const out = frame('ab', 10);
    assert.deepEqual([...out], [2, 0x61, 0x62, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('용량을 정확히 채우면 패딩이 0바이트', () => {
    const text = 'x'.repeat(18);
    const out = frame(text, 19);
    assert.equal(out[0], 18);
    assert.equal(out.length, 19);
    assert.ok(![...out.subarray(1)].includes(0));
  });

  test('용량 초과는 조용히 자르지 않고 던진다', () => {
    assert.throws(() => frame('x'.repeat(19), 19), RangeError);
    assert.throws(() => frame('가'.repeat(7), 19), RangeError);   // 21 B > 18
  });

  test('255 B 초과는 길이 필드로 표현 불가 → 던진다', () => {
    assert.throws(() => frame('x'.repeat(256), 1000), /길이 필드/);
  });
});

describe('unframe — 왕복', () => {
  const CASES = ['', 'a', 'hello world', '안녕하세요', 'https://example.com/x',
    '🎲🎲', 'x'.repeat(18), '가나다라마바'];

  test('frame → unframe 이 항등', () => {
    for (const text of CASES) {
      const need = payloadByteLength(text) + HEADER_BYTES;
      for (const dataBytes of [need, need + 1, need + 20]) {
        const { text: back, payloadLength, padding } = unframe(frame(text, dataBytes));
        assert.equal(back, text, `"${text}" @ ${dataBytes}B`);
        assert.equal(payloadLength, payloadByteLength(text));
        assert.equal(padding, dataBytes - HEADER_BYTES - payloadByteLength(text));
      }
    }
  });

  test('패딩 안의 0x00 이 페이로드로 새지 않는다', () => {
    const { text } = unframe(frame('ab', 50));
    assert.equal(text, 'ab');
    assert.equal(text.length, 2);
  });

  test('길이 필드가 가용량을 넘으면 조용히 자르지 않고 던진다', () => {
    const bad = new Uint8Array(10);
    bad[0] = 200;   // 손상: 가용 9 B 인데 200 이라 주장
    assert.throws(() => unframe(bad), /데이터 손상/);
  });

  test('lenient 모드는 클램프한다 (디버깅용)', () => {
    const bad = new Uint8Array(10);
    bad[0] = 200;
    const { payloadLength } = unframe(bad, { lenient: true });
    assert.equal(payloadLength, 9);
  });

  test('유효하지 않은 UTF-8 은 던진다', () => {
    const bad = new Uint8Array(5);
    bad[0] = 2; bad[1] = 0xff; bad[2] = 0xfe;
    assert.throws(() => unframe(bad), /UTF-8/);
  });

  test('헤더보다 작은 입력은 던진다', () => {
    assert.throws(() => unframe(new Uint8Array(0)), RangeError);
  });

  test('Uint8Array 가 아니면 던진다', () => {
    assert.throws(() => unframe([1, 2, 3]), TypeError);
  });
});

describe('결정성', () => {
  test('같은 입력 → 바이트 동일 출력', () => {
    for (const text of ['안녕', 'x'.repeat(18), '']) {
      assert.deepEqual([...frame(text, 39)], [...frame(text, 39)]);
    }
  });
});
