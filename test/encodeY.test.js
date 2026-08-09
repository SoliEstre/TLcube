// encodeY.test.js — encodeY.js 와이어 계약 검증 (SPEC §14, encode-wire.test.js 의 교훈을
// 처음부터 반영: cellDigits 맵 단독 복호 왕복을 dataDigits 배열 불개입으로 검증한다)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY, chooseVersionY } from '../src/encodeY.js';
import {
  VERSIONS_Y, capacityForY, versionSpecY,
  capacityForY2Window, windowedReferenceCellsY, windowedFormatCellsY, windowExcludedCellsY,
} from '../src/capacityY.js';
import { dataCellsInScanOrder, layoutMapY } from '../src/layoutY.js';
import {
  referenceCellsAll, formatCells, REFERENCE_GROUP_DIGITS_2T, REFERENCE_GROUP_DIGITS_3T,
} from '../src/placementY.js';
import { maskSub, maskAdd } from '../src/mask.js';
import { packCellDigitsToSymbols } from '../src/base211.js';
import { rsDecodeMessage } from '../src/rs211.js';
import { symbolsToBytes } from '../src/base211.js';
import { unframe } from '../src/header.js';
import { decodeSingle } from '../src/formatinfo.js';

const key = (i, j) => `${i},${j}`;

// tones 를 생략한 케이스(기본 2, 2톤 메인)와 tones=3(Y-T 옵션) 을 명시한 케이스를
// 섞는다 — encodeY 의 기본값 경로와 명시 경로 양쪽을 실제로 왕복시킨다.
const CASES = [
  { version: 1, eccLevel: 'L', text: 'Type Y wire V1/L' },
  { version: 1, eccLevel: 'M', text: 'Type Y 와이어 V1/M — 한글 포함' },
  { version: 1, eccLevel: 'H', text: 'Type Y wire V1/H' },
  { version: 2, eccLevel: 'L', text: 'Type Y wire V2/L' },
  { version: 2, eccLevel: 'M', text: 'Type Y 와이어 V2/M — 한글 포함' },
  { version: 2, eccLevel: 'H', text: 'Type Y wire V2/H' },
  { version: 1, eccLevel: 'M', tones: 3, text: 'Type Y-T wire V1/M' },
  { version: 2, eccLevel: 'M', tones: 3, text: 'Type Y-T 와이어 V2/M — 한글 포함' },
];

// ── 1. cellDigits 맵 단독 복호 왕복 (Y1·Y2 × L/M/H) ─────────────────────────

for (const { version, eccLevel, tones, text } of CASES) {
  test(`encodeY — cellDigits 단독 복호 왕복 Y${version}/${eccLevel}/t${tones ?? 2} — 배열 경유 없이 맵에서만`, () => {
    const encoded = encodeY(text, { version, eccLevel, ...(tones === undefined ? {} : { tones }) });
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

for (const { version, eccLevel, tones, text } of CASES) {
  test(`encodeY — cellDigits.size === n², role 개수 정합 Y${version}/${eccLevel}/t${tones ?? 2}`, () => {
    const encoded = encodeY(text, { version, eccLevel, ...(tones === undefined ? {} : { tones }) });
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

// ── 3. formatDigits 왕복(formatIndex — v3.1 §4b) + 레퍼런스 조 digit(tones 별) ──

for (const { version, eccLevel, tones, text } of CASES) {
  test(`encodeY — formatDigits 를 formatinfo.decode 로 왕복 Y${version}/${eccLevel}/t${tones ?? 2}`, () => {
    const encoded = encodeY(text, { version, eccLevel, ...(tones === undefined ? {} : { tones }) });
    assert.equal(encoded.formatDigits.length, 15);
    assert.equal(encoded.tones, tones === undefined ? 2 : tones);
    assert.equal(encoded.formatIndex, versionSpecY(version, encoded.tones).formatIndex);

    const replicas = [
      encoded.formatDigits.slice(0, 5),
      encoded.formatDigits.slice(5, 10),
      encoded.formatDigits.slice(10, 15),
    ];
    for (const replica of replicas) {
      const result = decodeSingle(replica);
      assert.equal(result.ok, true);
      assert.equal(result.version, encoded.formatIndex, 'Y1/Y2=8/9, Y1T/Y2T=10/11 네임스페이스');
      const ECC_INDEX = { L: 0, M: 1, H: 2 };
      assert.equal(result.eccLevel, ECC_INDEX[eccLevel]);
    }

    // 레퍼런스 4조 전부 tones 모드에 맞는 digit (마스크 없음).
    const expectedDigits = encoded.tones === 2 ? REFERENCE_GROUP_DIGITS_2T : REFERENCE_GROUP_DIGITS_3T;
    const references = referenceCellsAll(encoded.n, encoded.tones);
    assert.equal(references.length, 12);
    for (let g = 0; g < 4; g += 1) {
      const group = references.slice(g * 3, g * 3 + 3);
      assert.deepEqual(group.map((c) => c.digit), expectedDigits);
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
  // tones=2(기본, 2톤 메인) 후보 중 최대 용량 = Y2. 용량 회계는 tones 무관 동일하므로
  // Y2T 로 재어도 같은 수치가 나온다(capacityY.test.js 항등 참조) — 여기서는 encodeY
  // 기본 경로(tones=2)와 맞춰 versionSpecY(2,2) 로 명시한다.
  const last = versionSpecY(2, 2);
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
      const chosen = chooseVersionY(exact, eccLevel, spec.tones);
      assert.equal(chosen.tones, spec.tones, `${spec.name}/${eccLevel}: tones 필터링이 새지 않아야 한다`);
      assert.ok(
        capacityForY(chosen, eccLevel).maxPayloadBytes >= capacity.maxPayloadBytes,
        `${spec.name}/${eccLevel}: 정확히 용량인 페이로드가 더 작은 버전을 골라선 안 된다`,
      );
      const encoded = encodeY(exact, { version: chosen.version, eccLevel, tones: spec.tones });
      assert.equal(encoded.eccLevel, eccLevel);
      assert.equal(encoded.tones, spec.tones);
    }
  }
});

test('encodeY — chooseVersionY: 알 수 없는 tones 는 RangeError', () => {
  assert.throws(() => chooseVersionY('x', 'M', 4), RangeError);
  assert.throws(() => chooseVersionY('x', 'M', 0), RangeError);
});

test('encodeY — 명시 버전이 알 수 없으면 RangeError', () => {
  assert.throws(() => encodeY('x', { version: 99 }), RangeError);
  assert.throws(() => encodeY('x', { version: 0 }), RangeError);
});

test('encodeY — (version, tones) 조합이 VERSIONS_Y 에 없으면 RangeError (v3.1 §4b)', () => {
  assert.throws(() => encodeY('x', { version: 1, tones: 4 }), RangeError);
  // version=1 은 tones=2/3 둘 다 존재하지만, 존재하지 않는 조합을 요구하면 던진다.
  assert.throws(() => encodeY('x', { version: 99, tones: 3 }), RangeError);
});

test('encodeY — 비문자열 페이로드는 version 명시 여부와 무관하게 TypeError', () => {
  assert.throws(() => encodeY(undefined, { version: 1 }), TypeError);
  assert.throws(() => encodeY(123, { version: 1 }), TypeError);
  assert.throws(() => encodeY(null), TypeError);
  assert.throws(() => encodeY(['a'], { version: 2, eccLevel: 'H' }), TypeError);
});

// ── 5. 면 내 QR 윈도 β (ADR 0003 D1 + [C7 Q7]) — Y2(n=25)·tones=2 전용 ────────

/** windowedDataCellsInScanOrder(n,tones) 를 encodeY.js 밖에서 재구성한다(그
 * 함수는 export 되지 않는다 — capacityY.js 의 윈도 재배치 헬퍼로 동일 규약을
 * 조립해 e2e 왕복 테스트가 encodeY.js 내부 구현에 결합하지 않게 한다). */
function reconstructWindowScanY(n, tones) {
  const refSet = new Set(windowedReferenceCellsY(n, tones).map((c) => key(c.i, c.j)));
  const fmtSet = new Set(windowedFormatCellsY(n).map((c) => key(c.i, c.j)));
  const winSet = new Set(windowExcludedCellsY(n).map((c) => key(c.i, c.j)));
  const out = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = key(i, j);
      if (refSet.has(k) || fmtSet.has(k) || winSet.has(k)) continue;
      out.push({ i, j });
    }
  }
  return out;
}

const WINDOW_TEXTS = [
  'Type Y2W wire test',
  'Type Y2W 와이어 — 한글 포함',
];

for (const text of WINDOW_TEXTS) {
  test(`encodeY — Y2W(윈도) cellDigits 단독 복호 왕복 — 배열 경유 없이 맵에서만: "${text}"`, () => {
    const encoded = encodeY(text, { window: true, eccLevel: 'M' });
    const { n, capacity } = encoded;
    assert.equal(n, 25);
    assert.equal(encoded.window, true);
    assert.equal(encoded.tones, 2);
    assert.equal(encoded.formatIndex, 9, 'Y2 와 동일 — 와이어 무변경(광학 신호)');

    const scanCells = reconstructWindowScanY(n, 2);
    assert.equal(scanCells.length, capacity.dataCells);
    const dataLen = capacity.usedSymbols * 3;

    const digits = new Uint8Array(dataLen);
    for (let i = 0; i < scanCells.length; i += 1) {
      const cell = scanCells[i];
      const entry = encoded.cellDigits.get(key(cell.i, cell.j));
      assert.ok(entry, `scan order ${i} 셀 (${cell.i},${cell.j}) 이 cellDigits 에 없다`);
      if (i < dataLen) {
        assert.equal(entry.role, 'data');
        digits[i] = entry.digit;
      } else {
        assert.equal(entry.role, 'filler');
        assert.equal(entry.digit, maskAdd(0, cell.i, cell.j));
      }
    }

    const unmasked = digits.map((d, i) => maskSub(d, scanCells[i].i, scanCells[i].j));
    const { symbols, illegalIndices } = packCellDigitsToSymbols(unmasked);
    assert.equal(illegalIndices.length, 0);
    const message = rsDecodeMessage(symbols, capacity.nsym);
    const bytes = symbolsToBytes(message, capacity.dataBytes);
    const { text: decoded } = unframe(bytes);
    assert.equal(decoded, text);
  });
}

test('encodeY — Y2W: 윈도 좌표(169셀)는 cellDigits 에 아예 없다 (D1 — 세 면 전부 데이터에서 뺀다)', () => {
  const encoded = encodeY('window exclusion check', { window: true, eccLevel: 'M' });
  const excluded = windowExcludedCellsY(25);
  assert.equal(excluded.length, 169);
  for (const c of excluded) {
    assert.equal(encoded.cellDigits.get(key(c.i, c.j)), undefined, `(${c.i},${c.j}) 가 cellDigits 에 있으면 안 된다`);
  }
  assert.equal(encoded.cellDigits.size, 25 * 25 - 169);
});

test('encodeY — Y2W: cellDigits role 개수 정합 (reference 12 · format 15 · data+filler = dataCells)', () => {
  const encoded = encodeY('window role counts', { window: true, eccLevel: 'M' });
  const { capacity } = encoded;
  const counts = { reference: 0, format: 0, data: 0, filler: 0 };
  for (const { role } of encoded.cellDigits.values()) counts[role] += 1;
  assert.equal(counts.reference, 12);
  assert.equal(counts.format, 15);
  assert.equal(counts.data, capacity.usedSymbols * 3);
  assert.equal(counts.filler, capacity.residualCells);
  assert.equal(counts.reference + counts.format + counts.data + counts.filler, encoded.cellDigits.size);
});

test('encodeY — Y2W: 레퍼런스·포맷 좌표가 capacityY 의 윈도 재배치 스냅샷과 정확히 같다', () => {
  const encoded = encodeY('window placement snapshot', { window: true, eccLevel: 'M' });
  const expectedRef = windowedReferenceCellsY(25, 2);
  const expectedFmt = windowedFormatCellsY(25);
  assert.equal(expectedRef.length, 12);
  assert.equal(expectedFmt.length, 15);
  for (const c of expectedRef) {
    const entry = encoded.cellDigits.get(key(c.i, c.j));
    assert.equal(entry.role, 'reference');
    assert.equal(entry.digit, c.digit);
  }
  for (const c of expectedFmt) {
    assert.equal(encoded.cellDigits.get(key(c.i, c.j)).role, 'format');
  }
});

test('encodeY — Y2W: options.window=true 는 version=2/tones=2 이외 명시 조합에서 RangeError', () => {
  assert.throws(() => encodeY('x', { window: true, version: 1 }), RangeError);
  assert.throws(() => encodeY('x', { window: true, tones: 3 }), RangeError);
  assert.throws(() => encodeY('x', {
    window: true, version: 1, tones: 3,
  }), RangeError);
});

test('encodeY — Y2W: version 생략 시 2(Y2) 로 강제 — 윈도가 지원되는 유일한 버전', () => {
  const encoded = encodeY('version omitted with window', { window: true, eccLevel: 'M' });
  assert.equal(encoded.version, 2);
  assert.equal(encoded.n, 25);
});

test('encodeY — Y2W: version=2/tones=2 명시는 window=true 와 함께 통과한다(허용 조합)', () => {
  assert.doesNotThrow(() => encodeY('x', {
    window: true, version: 2, tones: 2,
  }));
});

test('encodeY — Y2W: 용량 초과 RangeError (capacityForY2Window 기준)', () => {
  const cap = capacityForY2Window('M');
  const tooLong = 'x'.repeat(cap.maxPayloadBytes + 1);
  assert.throws(() => encodeY(tooLong, { window: true, eccLevel: 'M' }), RangeError);
});

test('encodeY — Y2W: 결정성 — 동일 입력 2회 호출이 cellDigits 완전 일치', () => {
  const a = encodeY('window determinism', { window: true, eccLevel: 'M' });
  const b = encodeY('window determinism', { window: true, eccLevel: 'M' });
  assert.equal(a.cellDigits.size, b.cellDigits.size);
  for (const [k, va] of a.cellDigits) {
    const vb = b.cellDigits.get(k);
    assert.ok(vb, `${k} 가 두 번째 호출 결과에 없다`);
    assert.equal(va.digit, vb.digit);
    assert.equal(va.role, vb.role);
  }
  assert.deepEqual(Array.from(a.codewordSymbols), Array.from(b.codewordSymbols));
});

test('encodeY — window 생략(기본 false) 은 기존 경로와 완전히 동일 — encoded.window===false', () => {
  const encoded = encodeY('no window default', { version: 2, eccLevel: 'M' });
  assert.equal(encoded.window, false);
  assert.equal(encoded.cellDigits.size, 25 * 25);
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
