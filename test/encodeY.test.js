// encodeY.test.js — encodeY.js 와이어 계약 검증 (SPEC §14, encode-wire.test.js 의 교훈을
// 처음부터 반영: cellDigits 맵 단독 복호 왕복을 dataDigits 배열 불개입으로 검증한다)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY, chooseVersionY } from '../src/encodeY.js';
import { VERSIONS_Y, capacityForY } from '../src/capacityY.js';
import { dataCellsInScanOrder, layoutMapY } from '../src/layoutY.js';
import { referenceCellsAll, formatCells, REFERENCE_GROUP_DIGITS } from '../src/placementY.js';
import { maskSub, maskAdd } from '../src/mask.js';
import { packCellDigitsToSymbols } from '../src/base211.js';
import { rsDecodeMessage } from '../src/rs211.js';
import { symbolsToBytes } from '../src/base211.js';
import { unframe } from '../src/header.js';
import { decodeSingle } from '../src/formatinfo.js';

const key = (i, j) => `${i},${j}`;

const CASES = [
  { version: 1, eccLevel: 'L', text: 'Type Y wire V1/L' },
  { version: 1, eccLevel: 'M', text: 'Type Y 와이어 V1/M — 한글 포함' },
  { version: 1, eccLevel: 'H', text: 'Type Y wire V1/H' },
  { version: 2, eccLevel: 'L', text: 'Type Y wire V2/L' },
  { version: 2, eccLevel: 'M', text: 'Type Y 와이어 V2/M — 한글 포함' },
  { version: 2, eccLevel: 'H', text: 'Type Y wire V2/H' },
];

// ── 1. cellDigits 맵 단독 복호 왕복 (Y1·Y2 × L/M/H) ─────────────────────────

for (const { version, eccLevel, text } of CASES) {
  test(`encodeY — cellDigits 단독 복호 왕복 Y${version}/${eccLevel} — 배열 경유 없이 맵에서만`, () => {
    const encoded = encodeY(text, { version, eccLevel });
    const { n, capacity } = encoded;
    const scanCells = dataCellsInScanOrder(n);
    const map = layoutMapY(n);
    const dataLen = capacity.usedSymbols * 3;

    const digits = new Uint8Array(dataLen);
    for (let i = 0; i < scanCells.length; i += 1) {
      const cell = scanCells[i];
      const entry = encoded.cellDigits.get(key(cell.i, cell.j));
      assert.ok(entry, `scan order ${i} 셀 (${cell.i},${cell.j}) 이 cellDigits 에 없다`);
      const mapped = map.get(key(cell.i, cell.j));
      assert.equal(mapped.role, 'data');
      assert.equal(mapped.index, i, 'layoutMapY 의 scan 인덱스와 어긋난다');
      if (i < dataLen) {
        assert.equal(entry.role, 'data');
        digits[i] = entry.digit;
      } else {
        // 필러: 프리마스크 0 + 마스크 = maskAdd(0, i, j) 이어야 한다 (§5.6 준용).
        assert.equal(entry.role, 'filler');
        assert.equal(entry.digit, maskAdd(0, cell.i, cell.j));
      }
    }

    // 언마스크 → 3digit → 심볼 → RS → 바이트 → 언프레임. dataDigits 배열 불개입.
    const unmasked = digits.map((d, i) => maskSub(d, scanCells[i].i, scanCells[i].j));
    const { symbols, illegalIndices } = packCellDigitsToSymbols(unmasked);
    assert.equal(illegalIndices.length, 0);
    const message = rsDecodeMessage(symbols, capacity.nsym);
    const bytes = symbolsToBytes(message, capacity.dataBytes);
    const { text: decoded } = unframe(bytes);
    assert.equal(decoded, text);
  });
}

// ── 2. cellDigits.size / role 개수 ───────────────────────────────────────────

for (const { version, eccLevel, text } of CASES) {
  test(`encodeY — cellDigits.size === n², role 개수 정합 Y${version}/${eccLevel}`, () => {
    const encoded = encodeY(text, { version, eccLevel });
    const { n, capacity } = encoded;
    assert.equal(encoded.cellDigits.size, n * n, 'n² 전 좌표를 커버해야 한다');

    const counts = { reference: 0, format: 0, data: 0, filler: 0 };
    for (const { role } of encoded.cellDigits.values()) {
      assert.ok(role in counts, `알 수 없는 role: ${role}`);
      counts[role] += 1;
    }

    assert.equal(counts.reference, 12);
    assert.equal(counts.format, 15);
    assert.equal(counts.data, capacity.usedSymbols * 3);
    assert.equal(counts.filler, capacity.residualCells);
    assert.equal(counts.filler, capacity.dataCells % 3);
  });
}

// ── 3. formatDigits 왕복 + 레퍼런스 조 digit [0,4,3] ────────────────────────

for (const { version, eccLevel, text } of CASES) {
  test(`encodeY — formatDigits 를 formatinfo.decode 로 왕복 Y${version}/${eccLevel}`, () => {
    const encoded = encodeY(text, { version, eccLevel });
    assert.equal(encoded.formatDigits.length, 15);

    const replicas = [
      encoded.formatDigits.slice(0, 5),
      encoded.formatDigits.slice(5, 10),
      encoded.formatDigits.slice(10, 15),
    ];
    for (const replica of replicas) {
      const result = decodeSingle(replica);
      assert.equal(result.ok, true);
      assert.equal(result.version, 8 + (version - 1), 'Y1→8, Y2→9 네임스페이스');
      const ECC_INDEX = { L: 0, M: 1, H: 2 };
      assert.equal(result.eccLevel, ECC_INDEX[eccLevel]);
    }

    // 레퍼런스 4조 전부 digit [0,4,3] (마스크 없음).
    const references = referenceCellsAll(encoded.n);
    assert.equal(references.length, 12);
    for (let g = 0; g < 4; g += 1) {
      const group = references.slice(g * 3, g * 3 + 3);
      assert.deepEqual(group.map((c) => c.digit), REFERENCE_GROUP_DIGITS);
    }
    // cellDigits 맵에서도 동일하게 확인.
    for (const c of references) {
      const entry = encoded.cellDigits.get(key(c.i, c.j));
      assert.equal(entry.role, 'reference');
      assert.equal(entry.digit, c.digit);
    }
  });
}

// ── 4. 용량 초과 / chooseVersionY 경계 / 비문자열 / 결정성 ──────────────────

test('encodeY — 용량 초과 RangeError', () => {
  const last = VERSIONS_Y[VERSIONS_Y.length - 1];
  const capacity = capacityForY(last, 'H');
  const tooLong = 'x'.repeat(capacity.maxPayloadBytes + 1);
  assert.throws(() => encodeY(tooLong, { eccLevel: 'H' }), RangeError);
  assert.throws(() => chooseVersionY(tooLong, 'H'), RangeError);
});

test('encodeY — chooseVersionY 경계: 정확히 maxPayloadBytes 는 통과, +1 은 다음 버전/실패', () => {
  for (const spec of VERSIONS_Y) {
    for (const eccLevel of ['L', 'M', 'H']) {
      const capacity = capacityForY(spec, eccLevel);
      const exact = 'a'.repeat(capacity.maxPayloadBytes);
      const chosen = chooseVersionY(exact, eccLevel);
      assert.ok(
        capacityForY(chosen, eccLevel).maxPayloadBytes >= capacity.maxPayloadBytes,
        `Y${spec.version}/${eccLevel}: 정확히 용량인 페이로드가 더 작은 버전을 골라선 안 된다`,
      );
      const encoded = encodeY(exact, { version: chosen.version, eccLevel });
      assert.equal(encoded.eccLevel, eccLevel);
    }
  }
});

test('encodeY — 명시 버전이 알 수 없으면 RangeError', () => {
  assert.throws(() => encodeY('x', { version: 99 }), RangeError);
  assert.throws(() => encodeY('x', { version: 0 }), RangeError);
});

test('encodeY — 비문자열 페이로드는 version 명시 여부와 무관하게 TypeError', () => {
  assert.throws(() => encodeY(undefined, { version: 1 }), TypeError);
  assert.throws(() => encodeY(123, { version: 1 }), TypeError);
  assert.throws(() => encodeY(null), TypeError);
  assert.throws(() => encodeY(['a'], { version: 2, eccLevel: 'H' }), TypeError);
});

test('encodeY — 결정성: 동일 입력 2회 호출이 cellDigits 완전 일치', () => {
  const a = encodeY('결정성 테스트 Type Y', { version: 2, eccLevel: 'M' });
  const b = encodeY('결정성 테스트 Type Y', { version: 2, eccLevel: 'M' });
  assert.equal(a.cellDigits.size, b.cellDigits.size);
  for (const [k, va] of a.cellDigits) {
    const vb = b.cellDigits.get(k);
    assert.ok(vb, `${k} 가 두 번째 호출 결과에 없다`);
    assert.equal(va.digit, vb.digit);
    assert.equal(va.role, vb.role);
  }
  assert.deepEqual(Array.from(a.codewordSymbols), Array.from(b.codewordSymbols));
});
