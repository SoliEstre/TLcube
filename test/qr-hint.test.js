// qr-hint.test.js — TL 리더 QR의 25자 가족 힌트와 tlscan 경로 역해석 계약.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  QR_ALNUM_CHARSET,
  QR_V1L_CAPACITY,
  TL_READER_HINT_REGISTRY,
  TL_READER_URL,
  tlReaderFamilyHintFromPath,
  tlReaderUrlWithHint,
} from '../src/qr.js';

describe('TL 리더 가족 힌트', () => {
  test('모든 등록 family 입력은 v1-L 한계 안의 알파뉴메릭 TL 리더 URL을 만든다', () => {
    for (const entry of TL_READER_HINT_REGISTRY) {
      for (const family of entry.aliases) {
        const url = tlReaderUrlWithHint(family);
        assert.ok(url.length <= QR_V1L_CAPACITY, family + ': ' + url.length + '자');
        assert.ok(url.startsWith(TL_READER_URL), family + ': 기존 리더 URL 접두가 아니다');
        for (const ch of url) {
          assert.ok(QR_ALNUM_CHARSET.includes(ch), family + ': 문자셋 밖 ' + JSON.stringify(ch));
        }
      }
    }
  });

  test('등록부의 모든 힌트 문자는 tlscan 경로 파서에서 같은 family로 왕복한다', () => {
    for (const entry of TL_READER_HINT_REGISTRY) {
      const url = tlReaderUrlWithHint(entry.aliases[0]);
      const pathname = url.slice(TL_READER_URL.length);
      assert.equal(tlReaderFamilyHintFromPath(pathname), entry.family, entry.hint);
    }
  });

  test('미지 문자와 빈 경로는 무힌트이며, 예약 숫자는 가족으로 열리지 않는다', () => {
    for (const pathname of ['', '/', '/Z', '/0', '/9', '/OO', 'O', '/o']) {
      assert.equal(tlReaderFamilyHintFromPath(pathname), null, JSON.stringify(pathname));
    }
  });

  test('등록부 밖 가족의 URL은 기존 상수와 바이트 동일하다', () => {
    for (const family of [undefined, null, '', 'unknown', 'C4']) {
      assert.equal(tlReaderUrlWithHint(family), TL_READER_URL);
    }
  });
});
