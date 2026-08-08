/**
 * encode-wire.test.js — cellDigits 와이어 표면의 독립 검증 (T9 검증 라운드 major 대응)
 *
 * 배경: encode.test.js 의 왕복은 `dataDigits` 배열을 소비하고, render-selfcheck 는
 * 렌더에 쓰인 것과 같은 `cellDigits` 를 기대값으로 쓴다 — 즉 **cellDigits 의 셀↔digit
 * 대응 자체**는 자기일관 검증뿐이었다. 검증 라운드의 뮤테이션 실험(데이터 셀 배정을
 * 1칸 순환 시프트)이 전체 스위트를 통과하며 이 사각을 실증했다.
 *
 * 이 파일은 그 사각을 막는다: 복호가 **cellDigits 맵에서만** 출발한다 — dataDigits
 * 배열은 대응 검증 외에는 쓰지 않는다. 디코더가 실제로 하는 일(레이아웃 맵으로 셀
 * 역할·인덱스를 알아내 digit 을 회수)과 동형이다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { dataCellsInScanOrder, layoutMap } from '../src/layout.js';
import { maskSub, maskAdd } from '../src/mask.js';
import { packCellDigitsToSymbols } from '../src/base211.js';
import { rsDecodeMessage } from '../src/rs211.js';
import { symbolsToBytes } from '../src/base211.js';
import { unframe } from '../src/header.js';

const key = (c) => `${c.q},${c.r}`;

const CASES = [
  { version: 1, eccLevel: 'M', text: 'wire V1' },
  { version: 2, eccLevel: 'L', text: 'wire V2 — 독립 복호 ✓' },
  { version: 3, eccLevel: 'H', text: 'wire V3' },
];

for (const { version, eccLevel, text } of CASES) {
  test(`cellDigits 단독 복호 왕복 V${version}/${eccLevel} — 배열 경유 없이 맵에서만`, () => {
    const encoded = encode(text, { version, eccLevel });
    const { k, capacity } = encoded;
    const scanCells = dataCellsInScanOrder(k);
    const map = layoutMap(k);
    const dataLen = capacity.usedSymbols * 3;

    // 1. cellDigits 에서 scan order digit 을 회수한다 — 역할·인덱스는 layoutMap 교차 확인.
    const digits = new Uint8Array(dataLen);
    for (let i = 0; i < scanCells.length; i += 1) {
      const cell = scanCells[i];
      const entry = encoded.cellDigits.get(key(cell));
      assert.ok(entry, `scan order ${i} 셀 (${cell.q},${cell.r}) 이 cellDigits 에 없다`);
      const mapped = map.get(key(cell));
      assert.equal(mapped.role, 'data');
      assert.equal(mapped.index, i, 'layoutMap 의 scan 인덱스와 어긋난다');
      if (i < dataLen) {
        assert.equal(entry.role, 'data');
        digits[i] = entry.digit;
      } else {
        // 필러: 프리마스크 0 + 마스크 = maskAdd(0, q, r) 이어야 한다 (§5.6).
        assert.equal(entry.role, 'filler');
        assert.equal(entry.digit, maskAdd(0, cell.q, cell.r));
      }
    }

    // 2. 언마스크 → 3digit → 심볼 → RS → 바이트 → 언프레임. dataDigits 배열 불개입.
    const unmasked = digits.map((d, i) => maskSub(d, scanCells[i].q, scanCells[i].r));
    const { symbols, illegalIndices } = packCellDigitsToSymbols(unmasked);
    assert.equal(illegalIndices.length, 0);
    const message = rsDecodeMessage(symbols, capacity.nsym);
    const bytes = symbolsToBytes(message, capacity.dataBytes);
    const { text: decoded } = unframe(bytes);
    assert.equal(decoded, text);
  });

  test(`cellDigits ↔ dataDigits/fillerDigits 대응 일치 V${version}/${eccLevel}`, () => {
    const encoded = encode(text, { version, eccLevel });
    const scanCells = dataCellsInScanOrder(encoded.k);
    const dataLen = encoded.dataDigits.length;
    for (let i = 0; i < scanCells.length; i += 1) {
      const entry = encoded.cellDigits.get(key(scanCells[i]));
      const expected = i < dataLen
        ? encoded.dataDigits[i]
        : encoded.fillerDigits[i - dataLen];
      assert.equal(entry.digit, expected, `scan order ${i} 대응 불일치`);
    }
  });
}

test('encode — 비문자열 페이로드는 version 명시 여부와 무관하게 TypeError', () => {
  assert.throws(() => encode(undefined, { version: 1 }), TypeError);
  assert.throws(() => encode(123, { version: 1 }), TypeError);
  assert.throws(() => encode(null), TypeError);
  assert.throws(() => encode(['a'], { version: 2, eccLevel: 'H' }), TypeError);
});
