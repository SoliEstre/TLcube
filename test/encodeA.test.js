// encodeA.test.js — encodeA.js 와이어 계약 검증 (encode-wire.test.js/encodeY.test.js
// 의 교훈을 처음부터 반영: cellDigits 맵 단독 복호 왕복을 dataDigits 배열 불개입으로
// 검증한다)
//
// [A2/H 제외 안내] capacityA.test.js "base211 청킹 정렬" 절에서 확인했듯 A2/H
// (NSYM_TABLE_A.A2.H=57, dataSymbols=86) 는 base211.js 청크 인코더와 정렬이
// 깨져 있다 — encodeA 가 파이프라인 자기검증에서 그 자리에서 던진다(조용히
// 넘어가지 않는다). 아래 왕복 스위트는 정렬이 확인된 5개 조합(A1 L/M/H · A2 L/M)
// 만 돌리고, A2/H 는 별도로 "던진다"를 명시적으로 확인한다.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeA, chooseVersionA } from '../src/encodeA.js';
import { VERSIONS_A, capacityForA, versionSpecA } from '../src/capacityA.js';
import { dataCellsInScanOrderA, layoutMapA } from '../src/layoutA.js';
import {
  anchorCells, referenceCellsAll, formatCells, REFERENCE_DIGIT,
  ANCHOR_PRIMARY_DIGIT, ANCHOR_SECONDARY_DIGIT,
} from '../src/placement.js';
import { vertexAnchors, patchReferenceCells } from '../src/placementA.js';
import { maskSub, maskAdd } from '../src/mask.js';
import { packCellDigitsToSymbols } from '../src/base211.js';
import { rsDecodeMessage } from '../src/rs211.js';
import { symbolsToBytes } from '../src/base211.js';
import { unframe } from '../src/header.js';
import { decodeSingle } from '../src/formatinfo.js';

const key = (c) => `${c.q},${c.r}`;

// A2/H 는 base211 청킹 정렬이 깨져 있어(capacityA.test.js 참조) 왕복 대상에서 제외한다.
const CASES = [
  { version: 1, eccLevel: 'L', text: 'Type A wire A1/L' },
  { version: 1, eccLevel: 'M', text: 'Type A 와이어 A1/M — 한글 포함' },
  { version: 1, eccLevel: 'H', text: 'Type A wire A1/H' },
  { version: 2, eccLevel: 'L', text: 'Type A wire A2/L' },
  { version: 2, eccLevel: 'M', text: 'Type A 와이어 A2/M — 한글 포함' },
];

// ── 1. cellDigits 맵 단독 복호 왕복 ─────────────────────────────────────────

for (const { version, eccLevel, text } of CASES) {
  for (const centerQr of [false, true]) {
    test(`encodeA — cellDigits 단독 복호 왕복 A${version}/${eccLevel}/centerQr=${centerQr} — 배열 경유 없이 맵에서만`, () => {
      const encoded = encodeA(text, { version, eccLevel, centerQr });
      const { k, capacity } = encoded;
      const scanCells = dataCellsInScanOrderA(k);
      const map = layoutMapA(k);
      const dataLen = capacity.usedSymbols * 3;

      const digits = new Uint8Array(dataLen);
      for (let i = 0; i < scanCells.length; i += 1) {
        const cell = scanCells[i];
        const entry = encoded.cellDigits.get(key(cell));
        assert.ok(entry, `scan order ${i} 셀 (${cell.q},${cell.r}) 이 cellDigits 에 없다`);
        const mapped = map.get(key(cell));
        assert.equal(mapped.role, 'data');
        assert.equal(mapped.index, i, 'layoutMapA 의 scan 인덱스와 어긋난다');
        if (i < dataLen) {
          assert.equal(entry.role, 'data');
          digits[i] = entry.digit;
        } else {
          // 필러: 프리마스크 0 + 마스크 = maskAdd(0, q, r) 이어야 한다 (§5.6 준용).
          assert.equal(entry.role, 'filler');
          assert.equal(entry.digit, maskAdd(0, cell.q, cell.r));
        }
      }

      // 언마스크 → 3digit → 심볼 → RS → 바이트 → 언프레임. dataDigits 배열 불개입.
      const unmasked = digits.map((d, i) => maskSub(d, scanCells[i].q, scanCells[i].r));
      const { symbols, illegalIndices } = packCellDigitsToSymbols(unmasked);
      assert.equal(illegalIndices.length, 0);
      const message = rsDecodeMessage(symbols, capacity.nsym);
      const bytes = symbolsToBytes(message, capacity.dataBytes);
      const { text: decoded } = unframe(bytes);
      assert.equal(decoded, text);
    });
  }
}

// ── 2. cellDigits.size / role 개수 ───────────────────────────────────────────

for (const { version, eccLevel, text } of CASES) {
  test(`encodeA — cellDigits.size === 총 셀 − 19(불스아이), role 개수 정합 A${version}/${eccLevel}`, () => {
    const encoded = encodeA(text, { version, eccLevel });
    const { k, capacity } = encoded;
    const totalCells = (3 * k + 1) * (3 * k + 2) / 2;
    // 불스아이 19셀은 cellDigits 맵에 실리지 않는다(encode.js Type O 전례 승계 —
    // 불스아이는 고정 패턴이라 다른 렌더 계층 몫).
    assert.equal(encoded.cellDigits.size, totalCells - 19, '총 셀 - 불스아이 19 를 커버해야 한다');

    const counts = {
      anchor: 0, format: 0, reference: 0, data: 0, filler: 0,
    };
    for (const { role } of encoded.cellDigits.values()) {
      assert.ok(role in counts, `알 수 없는 role: ${role}`);
      counts[role] += 1;
    }

    assert.equal(counts.anchor, 6);
    assert.equal(counts.format, 15);
    assert.equal(counts.reference, referenceCellsAll(k).length + patchReferenceCells(k).length);
    assert.equal(counts.data, capacity.usedSymbols * 3);
    assert.equal(counts.filler, capacity.residualCells);
    assert.equal(counts.filler, capacity.dataCells % 3);
  });
}

// ── 3. formatDigits 왕복 + 앵커/레퍼런스 digit 배정 ──────────────────────────

for (const { version, eccLevel, text } of CASES) {
  test(`encodeA — formatDigits 를 formatinfo.decode 로 왕복, D6 네임스페이스(12/13) A${version}/${eccLevel}`, () => {
    const encoded = encodeA(text, { version, eccLevel });
    assert.equal(encoded.formatDigits.length, 15);
    assert.equal(encoded.formatIndex, versionSpecA(version).formatIndex);
    assert.equal(encoded.formatIndex, version === 1 ? 12 : 13);

    const replicas = [
      encoded.formatDigits.slice(0, 5),
      encoded.formatDigits.slice(5, 10),
      encoded.formatDigits.slice(10, 15),
    ];
    for (const replica of replicas) {
      const result = decodeSingle(replica);
      assert.equal(result.ok, true);
      assert.equal(result.version, encoded.formatIndex);
      const ECC_INDEX = { L: 0, M: 1, H: 2 };
      assert.equal(result.eccLevel, ECC_INDEX[eccLevel]);
    }
  });

  test(`encodeA — centerQr=true 는 formatIndex +2 (14/15, D6) A${version}/${eccLevel}`, () => {
    const encoded = encodeA(text, { version, eccLevel, centerQr: true });
    assert.equal(encoded.formatIndex, version === 1 ? 14 : 15);
    const replica = encoded.formatDigits.slice(0, 5);
    const result = decodeSingle(replica);
    assert.equal(result.ok, true);
    assert.equal(result.version, encoded.formatIndex);
  });

  test(`encodeA — 앵커 6(육각3+꼭짓점3)·레퍼런스(육각+패치) digit 배정 정합 A${version}/${eccLevel}`, () => {
    const encoded = encodeA(text, { version, eccLevel });
    const { k } = encoded;

    for (const c of anchorCells(k)) {
      const entry = encoded.cellDigits.get(key(c));
      assert.equal(entry.role, 'anchor');
      assert.equal(entry.digit, c.digit);
    }
    for (const c of vertexAnchors(k)) {
      const entry = encoded.cellDigits.get(key(c));
      assert.equal(entry.role, 'anchor');
      assert.equal(entry.digit, c.digit);
      assert.ok(entry.digit === ANCHOR_PRIMARY_DIGIT || entry.digit === ANCHOR_SECONDARY_DIGIT);
    }
    for (const c of referenceCellsAll(k)) {
      const entry = encoded.cellDigits.get(key(c));
      assert.equal(entry.role, 'reference');
      assert.equal(entry.digit, REFERENCE_DIGIT);
    }
    for (const c of patchReferenceCells(k)) {
      const entry = encoded.cellDigits.get(key(c));
      assert.equal(entry.role, 'reference');
      assert.equal(entry.digit, REFERENCE_DIGIT);
    }
  });
}

// ── 4. A2/H 는 base211 청킹 정렬이 깨져 있어 자기검증이 그 자리에서 던진다 ──────

test('encodeA — A2/H 는 파이프라인 자기검증에서 RangeError (base211 청킹 정렬 불일치, capacityA.test.js 참조)', () => {
  assert.throws(() => encodeA('아무 텍스트', { version: 2, eccLevel: 'H' }), /심볼 개수 불일치/);
});

// ── 5. 용량 초과 / chooseVersionA 경계 / 비문자열 / 결정성 ──────────────────

test('encodeA — 용량 초과 RangeError', () => {
  const last = versionSpecA(2);
  const capacity = capacityForA(last, 'M'); // A2/H 는 자체가 자기검증에서 던지므로 M 을 기준으로 검사
  const tooLong = 'x'.repeat(capacity.maxPayloadBytes + 1);
  assert.throws(() => encodeA(tooLong, { eccLevel: 'M' }), RangeError);
  assert.throws(() => chooseVersionA(tooLong, 'M'), RangeError);
});

test('encodeA — chooseVersionA 경계: 정확히 maxPayloadBytes 는 통과, 그 버전으로 인코딩된다', () => {
  for (const spec of VERSIONS_A) {
    for (const eccLevel of ['L', 'M']) { // H 는 A2 자기검증 예외가 있어 L/M 만 경계 검사
      const capacity = capacityForA(spec, eccLevel);
      const exact = 'a'.repeat(capacity.maxPayloadBytes);
      const chosen = chooseVersionA(exact, eccLevel);
      assert.ok(
        capacityForA(chosen, eccLevel).maxPayloadBytes >= capacity.maxPayloadBytes,
        `${spec.name}/${eccLevel}: 정확히 용량인 페이로드가 더 작은 버전을 골라선 안 된다`,
      );
      const encoded = encodeA(exact, { version: chosen.version, eccLevel });
      assert.equal(encoded.eccLevel, eccLevel);
    }
  }
});

test('encodeA — 명시 버전이 알 수 없으면 RangeError', () => {
  assert.throws(() => encodeA('x', { version: 99 }), RangeError);
  assert.throws(() => encodeA('x', { version: 0 }), RangeError);
});

test('encodeA — centerQr 이 boolean 이 아니면 TypeError', () => {
  assert.throws(() => encodeA('x', { version: 1, centerQr: 1 }), TypeError);
  assert.throws(() => encodeA('x', { version: 1, centerQr: 'true' }), TypeError);
});

test('encodeA — 비문자열 페이로드는 version 명시 여부와 무관하게 TypeError', () => {
  assert.throws(() => encodeA(undefined, { version: 1 }), TypeError);
  assert.throws(() => encodeA(123, { version: 1 }), TypeError);
  assert.throws(() => encodeA(null), TypeError);
  assert.throws(() => encodeA(['a'], { version: 2, eccLevel: 'L' }), TypeError);
});

test('encodeA — 결정성: 동일 입력 2회 호출이 cellDigits 완전 일치', () => {
  const a = encodeA('결정성 테스트 Type A', { version: 2, eccLevel: 'M' });
  const b = encodeA('결정성 테스트 Type A', { version: 2, eccLevel: 'M' });
  assert.equal(a.cellDigits.size, b.cellDigits.size);
  for (const [k, va] of a.cellDigits) {
    const vb = b.cellDigits.get(k);
    assert.ok(vb, `${k} 가 두 번째 호출 결과에 없다`);
    assert.equal(va.digit, vb.digit);
    assert.equal(va.role, vb.role);
  }
  assert.deepEqual(Array.from(a.codewordSymbols), Array.from(b.codewordSymbols));
});
