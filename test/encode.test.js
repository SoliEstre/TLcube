// encode.test.js — src/encode.js 검증 (SPEC §7.1)

import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseVersion, encode } from '../src/encode.js';
import { VERSIONS, capacityFor, capacityTable } from '../src/capacity.js';
import { cellCount } from '../src/hexgrid.js';
import { frame, unframe, payloadByteLength } from '../src/header.js';
import { dataCellsInScanOrder, fillerCells } from '../src/layout.js';
import {
  anchorCells,
  ANCHOR_PRIMARY_INDEX,
  ANCHOR_PRIMARY_DIGIT,
  ANCHOR_SECONDARY_DIGIT,
  referenceCellsAll,
  REFERENCE_DIGIT,
  formatCells,
} from '../src/placement.js';
import { maskSub } from '../src/mask.js';
import { packCellDigitsToSymbols, symbolsToBytes } from '../src/base211.js';
import { rsDecodeMessage } from '../src/rs211.js';
import { decode as decodeFormatInfo, ECC_LEVEL } from '../src/formatinfo.js';

const LEVELS = ['L', 'M', 'H'];

// 왕복 케이스: ASCII, 한국어, 이모지 혼합. 각 버전 용량 안에 들어가도록 짧게 유지한다.
const ROUNDTRIP_TEXTS = [
  '',
  'hello, TrilLuminanceCube!',
  '안녕하세요, 트릴루미넌스 큐브입니다.',
  '이모지 테스트 🎲🔺🔷 base-6 rank code',
];

/** dataDigits 를 역파이프라인으로 원문 텍스트까지 되돌린다. */
function decodeRoundTrip(result) {
  // dataCellsInScanOrder(k) 는 데이터 셀 전부(3S + 잔여)를 돌려준다 — 심볼 3-digit
  // 그룹은 그 앞쪽 3S 개(= dataDigits 길이)뿐이다(encode.js 와 동일한 슬라이스).
  const scanCells = dataCellsInScanOrder(result.k).slice(0, result.dataDigits.length);

  const preMaskDigits = new Uint8Array(result.dataDigits.length);
  for (let i = 0; i < scanCells.length; i += 1) {
    const c = scanCells[i];
    preMaskDigits[i] = maskSub(result.dataDigits[i], c.q, c.r);
  }

  const { symbols, illegalIndices } = packCellDigitsToSymbols(preMaskDigits);
  assert.deepEqual(illegalIndices, []);
  assert.equal(symbols.length, result.capacity.usedSymbols);

  const message = rsDecodeMessage(symbols, result.capacity.nsym);
  const bytes = symbolsToBytes(message, result.capacity.dataBytes);
  return unframe(bytes).text;
}

test('encode: 3버전 x 3레벨 왕복 (ASCII/한국어/이모지)', () => {
  for (const spec of VERSIONS) {
    for (const level of LEVELS) {
      for (const text of ROUNDTRIP_TEXTS) {
        const capacity = capacityFor(spec, level);
        if (payloadByteLength(text) > capacity.maxPayloadBytes) continue; // 이 조합엔 안 실림
        const result = encode(text, { version: spec.version, eccLevel: level });
        assert.equal(result.version, spec.version);
        assert.equal(result.eccLevel, level);
        const decoded = decodeRoundTrip(result);
        assert.equal(decoded, text, `V${spec.version}/${level}: "${text}"`);
      }
    }
  }
});

test('encode: cellDigits 크기·값 범위·role 별 개수', () => {
  const spec = VERSIONS[0];
  const level = 'M';
  // V1/M 은 용량이 작다(수 십 바이트) — ASCII 짧은 문자열로 확실히 담는다.
  const result = encode('hi V1', { version: spec.version, eccLevel: level });
  const k = result.k;

  const expectedSize = cellCount(k) - cellCount(2); // 불스아이(반경 2, 19셀) 제외
  assert.equal(result.cellDigits.size, expectedSize);

  const counts = { anchor: 0, reference: 0, format: 0, data: 0, filler: 0 };
  for (const [, entry] of result.cellDigits) {
    assert.ok(Number.isInteger(entry.digit));
    assert.ok(entry.digit >= 0 && entry.digit <= 5, `digit 범위 위반: ${entry.digit}`);
    assert.ok(Object.prototype.hasOwnProperty.call(counts, entry.role), `알 수 없는 role: ${entry.role}`);
    counts[entry.role] += 1;
  }

  assert.equal(counts.anchor, 3);
  assert.equal(counts.reference, 2 * (k - 2));
  assert.equal(counts.format, 15);
  assert.equal(counts.data, result.capacity.usedSymbols * 3);
  assert.equal(counts.filler, result.capacity.residualCells);

  // 총합 = 맵 크기와 일치해야 한다 (역할이 서로 배타적).
  const total = counts.anchor + counts.reference + counts.format + counts.data + counts.filler;
  assert.equal(total, expectedSize);
});

test('encode: 앵커/레퍼런스 digit 및 위치, 포맷 정보 왕복', () => {
  for (const spec of VERSIONS) {
    const level = 'M';
    // V1/M 도 담을 수 있게 짧은 ASCII 로 고정한다 (버전별 앵커/레퍼런스/포맷 위치만 확인 목적).
    const result = encode('anchor test', { version: spec.version, eccLevel: level });
    const k = result.k;

    const anchors = anchorCells(k);
    for (let i = 0; i < anchors.length; i += 1) {
      const c = anchors[i];
      const entry = result.cellDigits.get(`${c.q},${c.r}`);
      assert.equal(entry.role, 'anchor');
      const expectedDigit = i === ANCHOR_PRIMARY_INDEX ? ANCHOR_PRIMARY_DIGIT : ANCHOR_SECONDARY_DIGIT;
      assert.equal(entry.digit, expectedDigit);
      assert.equal(c.digit, expectedDigit);
    }

    const references = referenceCellsAll(k);
    for (const c of references) {
      const entry = result.cellDigits.get(`${c.q},${c.r}`);
      assert.equal(entry.role, 'reference');
      assert.equal(entry.digit, REFERENCE_DIGIT);
    }

    // formatDigits 를 formatCells(k) 순서의 3블록(5digit)으로 잘라 formatinfo.decode 로 왕복.
    assert.equal(result.formatDigits.length, 15);
    const reads = [
      result.formatDigits.slice(0, 5),
      result.formatDigits.slice(5, 10),
      result.formatDigits.slice(10, 15),
    ];
    const decoded = decodeFormatInfo(reads);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.version, spec.version - 1);
    assert.equal(decoded.eccLevel, ECC_LEVEL[level]);

    const formatCoords = formatCells(k);
    assert.equal(formatCoords.length, 15);
    for (let i = 0; i < formatCoords.length; i += 1) {
      const c = formatCoords[i];
      const entry = result.cellDigits.get(`${c.q},${c.r}`);
      assert.equal(entry.role, 'format');
      assert.equal(entry.digit, result.formatDigits[i]);
    }
  }
});

test('encode: centerQr=false(기본) 는 버전 인덱스·반환 형태를 바꾸지 않는다 (ADR 0004 §1-3)', () => {
  for (const spec of VERSIONS) {
    const result = encode('anchor test', { version: spec.version, eccLevel: 'M' });
    assert.equal(result.centerQr, false);
    const reads = [
      result.formatDigits.slice(0, 5),
      result.formatDigits.slice(5, 10),
      result.formatDigits.slice(10, 15),
    ];
    const decoded = decodeFormatInfo(reads);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.version, spec.version - 1); // 0~2, centerQr 오프셋 없음.
  }
});

test('encode: centerQr=true 는 포맷 정보 버전 인덱스에 +4 오프셋을 준다 → V1Q=4·V2Q=5·V3Q=6 (ADR 0004 §1-3)', () => {
  for (const spec of VERSIONS) {
    const result = encode('anchor test', { version: spec.version, eccLevel: 'M', centerQr: true });
    assert.equal(result.centerQr, true);
    const reads = [
      result.formatDigits.slice(0, 5),
      result.formatDigits.slice(5, 10),
      result.formatDigits.slice(10, 15),
    ];
    const decoded = decodeFormatInfo(reads);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.version, (spec.version - 1) + 4); // 4,5,6
    assert.equal(decoded.eccLevel, ECC_LEVEL.M);
  }
});

test('encode: centerQr 이 boolean 이 아니면 TypeError', () => {
  assert.throws(() => encode('x', { centerQr: 'yes' }), TypeError);
});

test('encode: 용량 초과 페이로드는 RangeError (버전 지정)', () => {
  const spec = VERSIONS[0];
  const level = 'M';
  const capacity = capacityFor(spec, level);
  const overSized = 'a'.repeat(capacity.maxPayloadBytes + 1);
  assert.throws(() => encode(overSized, { version: spec.version, eccLevel: level }), RangeError);
});

test('chooseVersion: 경계값 (capacityTable 기반, 하드코딩 없이 동적 검사)', () => {
  const level = 'M';
  const table = capacityTable(level);

  for (let i = 0; i < table.length; i += 1) {
    const boundary = table[i].maxPayloadBytes;

    // 경계 그대로: 현재 버전이 최소 버전이어야 한다 (더 작은 버전은 못 싣는다).
    const exact = 'a'.repeat(boundary);
    const chosenExact = chooseVersion(exact, level);
    assert.equal(chosenExact.version, VERSIONS[i].version, `V${VERSIONS[i].version} 경계값 ${boundary} B`);
    // encode 도 같은 버전을 자동 선택해야 한다.
    const encoded = encode(exact, { eccLevel: level });
    assert.equal(encoded.version, VERSIONS[i].version);

    // 경계 + 1: 다음 버전으로 넘어가거나(마지막 버전이면) RangeError.
    const over = 'a'.repeat(boundary + 1);
    if (i + 1 < table.length) {
      const chosenOver = chooseVersion(over, level);
      assert.equal(chosenOver.version, VERSIONS[i + 1].version);
    } else {
      assert.throws(() => chooseVersion(over, level), RangeError);
      assert.throws(() => encode(over, { eccLevel: level }), RangeError);
    }
  }
});

test('encode: 결정성 — 동일 입력 2회 encode 는 완전히 일치한다', () => {
  // V2/H 는 결정성 확인용 텍스트를 담기에 충분히 크다(수십 바이트 용량).
  const text = '결정성 확인 🔁';
  const opts = { version: 2, eccLevel: 'H' };
  assert.ok(payloadByteLength(text) <= capacityFor(VERSIONS[1], 'H').maxPayloadBytes);
  const a = encode(text, opts);
  const b = encode(text, opts);

  assert.deepEqual(Array.from(a.dataDigits), Array.from(b.dataDigits));
  assert.deepEqual(Array.from(a.fillerDigits), Array.from(b.fillerDigits));
  assert.deepEqual(a.formatDigits, b.formatDigits);
  assert.deepEqual(Array.from(a.codewordSymbols), Array.from(b.codewordSymbols));
  assert.deepEqual([...a.cellDigits.entries()], [...b.cellDigits.entries()]);
});

// frame/fillerCells 는 위 테스트들에서 간접적으로만 쓰이지만, 미사용 import 로 남기지
// 않기 위해 여기서 최소한으로 직접도 건드려 둔다 (파이프라인 자기검증 취지 재확인).
test('encode: frame()/fillerCells() 계약이 encode() 결과와 정합한다', () => {
  const spec = VERSIONS[1];
  const level = 'L';
  const text = 'sanity';
  const result = encode(text, { version: spec.version, eccLevel: level });
  const framed = frame(text, result.capacity.dataBytes);
  assert.equal(framed.length, result.capacity.dataBytes);
  assert.equal(fillerCells(result.k).length, result.capacity.residualCells);
});
