// decode.test.js — 영상 앞단 없이 digit 계층에서 닫는 후단 디코더 회귀

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { VERSIONS, capacityFor } from '../src/capacity.js';
import { VERSIONS_A } from '../src/capacityA.js';
import {
  VERSIONS_Y,
  windowedReferenceCellsY,
  windowedFormatCellsY,
  windowExcludedCellsY,
} from '../src/capacityY.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeY } from '../src/encodeY.js';
import { decodeCells, RS211_ERASURE_MODE } from '../src/decode.js';
import { decode as decodeFormatInfo } from '../src/formatinfo.js';
import { dataCellsInScanOrder as dataCellsInScanOrderO } from '../src/layout.js';
import { dataCellsInScanOrderA } from '../src/layoutA.js';
import { dataCellsInScanOrder as dataCellsInScanOrderY } from '../src/layoutY.js';
import { maskAdd, maskSub } from '../src/mask.js';
import { symbolValueToCellDigits } from '../src/base211.js';

const encoder = new TextEncoder();
const ECC_LEVELS = ['L', 'M', 'H'];

function digitsFromMap(scan, cellDigits, keyOf) {
  return Uint8Array.from(scan.map((cell) => {
    const entry = cellDigits.get(keyOf(cell));
    assert.ok(entry, 'scan order 셀에 digit가 없다: ' + JSON.stringify(cell));
    return entry.digit;
  }));
}

function oDigits(encoded) {
  return digitsFromMap(
    dataCellsInScanOrderO(encoded.k),
    encoded.cellDigits,
    (cell) => cell.q + ',' + cell.r,
  );
}

function aDigits(encoded) {
  return digitsFromMap(
    dataCellsInScanOrderA(encoded.k),
    encoded.cellDigits,
    (cell) => cell.q + ',' + cell.r,
  );
}

function yDigits(encoded) {
  return digitsFromMap(
    dataCellsInScanOrderY(encoded.n),
    encoded.cellDigits,
    (cell) => cell.i + ',' + cell.j,
  );
}

function yWindowScan(n, tones) {
  const references = new Set(
    windowedReferenceCellsY(n, tones).map((cell) => cell.i + ',' + cell.j),
  );
  const formats = new Set(windowedFormatCellsY(n).map((cell) => cell.i + ',' + cell.j));
  const excluded = new Set(windowExcludedCellsY(n).map((cell) => cell.i + ',' + cell.j));
  const out = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const key = i + ',' + j;
      if (!references.has(key) && !formats.has(key) && !excluded.has(key)) out.push({ i, j });
    }
  }
  return out;
}

function yWindowDigits(encoded) {
  return digitsFromMap(
    yWindowScan(encoded.n, encoded.tones),
    encoded.cellDigits,
    (cell) => cell.i + ',' + cell.j,
  );
}

function oFormat(encoded) {
  return { version: encoded.version, eccLevel: encoded.eccLevel, k: encoded.k };
}

function rawFormatInfo(encoded) {
  const result = decodeFormatInfo([
    encoded.formatDigits.slice(0, 5),
    encoded.formatDigits.slice(5, 10),
    encoded.formatDigits.slice(10, 15),
  ]);
  assert.equal(result.ok, true);
  return result;
}

function setOneSafeSymbolError(maskedDigits, encoded, symbolIndex) {
  const scan = dataCellsInScanOrderO(encoded.k);
  const digitIndex = symbolIndex * 3;
  const cell = scan[digitIndex];
  const original = maskSub(maskedDigits[digitIndex], cell.q, cell.r);
  // 첫 digit을 0/1 사이에서만 바꾸면 3-digit 값이 211..215가 되지 않는다.
  const replacement = original === 0 ? 1 : 0;
  maskedDigits[digitIndex] = maskAdd(replacement, cell.q, cell.r);
}

function setIllegalSymbol(maskedDigits, encoded, symbolIndex, value = 215) {
  const scan = dataCellsInScanOrderO(encoded.k);
  const triple = symbolValueToCellDigits(value);
  const start = symbolIndex * 3;
  for (let offset = 0; offset < 3; offset += 1) {
    const cell = scan[start + offset];
    maskedDigits[start + offset] = maskAdd(triple[offset], cell.q, cell.r);
  }
}

function assertCleanRoundTrip(text, options) {
  const encoded = encode(text, options);
  const result = decodeCells(oDigits(encoded), oFormat(encoded));
  assert.equal(result.ok, true, result.ok ? '' : result.reason);
  assert.equal(result.text, text);
  assert.equal(result.corrected, 0);
}

describe('Type O encoder ↔ decoder digit-layer round trip', () => {
  test('전 버전 × 전 ECC × 빈값·1B·최대·한글·이모지 경계', () => {
    for (const spec of VERSIONS) {
      for (const eccLevel of ECC_LEVELS) {
        const capacity = capacityFor(spec, eccLevel).maxPayloadBytes;
        assert.ok(capacity >= 4, '이 테스트의 이모지 경계 전제: V' + spec.version + '/' + eccLevel);
        const cases = [
          { name: 'empty', text: '' },
          { name: 'one-byte', text: 'A' },
          { name: 'korean', text: '한' },
          { name: 'emoji', text: '😀' },
          { name: 'maximum-ascii', text: 'x'.repeat(capacity) },
          { name: 'maximum-ending-emoji', text: 'x'.repeat(capacity - 4) + '😀' },
        ];

        for (const entry of cases) {
          assert.equal(
            encoder.encode(entry.text).length <= capacity,
            true,
            '용량 초과 fixture: V' + spec.version + '/' + eccLevel + '/' + entry.name,
          );
          assertCleanRoundTrip(entry.text, { version: spec.version, eccLevel });
        }
      }
    }
  });

  test('필러 포함 scan 배열과 심볼 digit 전용 배열을 모두 받는다', () => {
    const encoded = encode('filler input', { version: 3, eccLevel: 'M' });
    const full = oDigits(encoded);
    const symbolOnly = encoded.dataDigits.slice();
    const fullResult = decodeCells(full, oFormat(encoded));
    const symbolOnlyResult = decodeCells(symbolOnly, oFormat(encoded));
    assert.equal(fullResult.ok, true, fullResult.ok ? '' : fullResult.reason);
    assert.equal(symbolOnlyResult.ok, true, symbolOnlyResult.ok ? '' : symbolOnlyResult.reason);
    assert.equal(fullResult.text, 'filler input');
    assert.equal(symbolOnlyResult.text, 'filler input');
  });

  test('formatinfo.js의 raw version-index와 numeric ECC 결과를 바로 받는다', () => {
    const o = encode('raw O', { version: 2, eccLevel: 'M' });
    const rawO = rawFormatInfo(o);
    const oResult = decodeCells(oDigits(o), {
      type: 'O', version: rawO.version, eccLevel: rawO.eccLevel, k: o.k,
    });
    assert.equal(oResult.ok, true, oResult.ok ? '' : oResult.reason);
    assert.equal(oResult.text, 'raw O');

    const a = encodeA('raw A', { version: 0, eccLevel: 'M' });
    const rawA = rawFormatInfo(a);
    const aResult = decodeCells(aDigits(a), {
      type: 'A', version: rawA.version, eccLevel: rawA.eccLevel, k: a.k,
    });
    assert.equal(aResult.ok, true, aResult.ok ? '' : aResult.reason);
    assert.equal(aResult.text, 'raw A');

    // raw index=2는 logical Y2와 충돌하지만 n=13이 raw Y0T를 유일하게 고른다.
    const y = encodeY('raw Y', { version: 0, eccLevel: 'M', tones: 3 });
    const rawY = rawFormatInfo(y);
    const yResult = decodeCells(yDigits(y), {
      type: 'Y', version: rawY.version, eccLevel: rawY.eccLevel, n: y.n,
    });
    assert.equal(yResult.ok, true, yResult.ok ? '' : yResult.reason);
    assert.equal(yResult.text, 'raw Y');
  });
});

describe('RS error correction at the cell-digit boundary', () => {
  test('정정 한계 이내의 서로 다른 RS 심볼 훼손은 원문과 corrected를 복원한다', () => {
    const text = '정정 한계 digit 경계';
    const encoded = encode(text, { version: 3, eccLevel: 'M' });
    const corrupted = encoded.dataDigits.slice();
    const t = encoded.capacity.errorCapacity;

    for (let symbolIndex = 0; symbolIndex < t; symbolIndex += 1) {
      setOneSafeSymbolError(corrupted, encoded, symbolIndex);
    }

    const result = decodeCells(corrupted, oFormat(encoded));
    assert.equal(result.ok, true, result.ok ? '' : result.reason);
    assert.equal(result.text, text);
    assert.equal(result.corrected, t);
  });

  test('정정 한계를 명확히 넘는 훼손은 rs 단계 실패로 반환한다', () => {
    const encoded = encode('too many errors', { version: 3, eccLevel: 'M' });
    const corrupted = encoded.dataDigits.slice();

    // nsym개를 바꾸면 t보다 충분히 크고, 이 고정 패턴은 rs211의 실패 관문을 지난다.
    for (let symbolIndex = 0; symbolIndex < encoded.capacity.nsym; symbolIndex += 1) {
      setOneSafeSymbolError(corrupted, encoded, symbolIndex);
    }

    const result = decodeCells(corrupted, oFormat(encoded));
    assert.equal(result.ok, false);
    assert.match(result.reason, /^rs:/);
  });
});

describe('illegal 211..215 symbol handling without RS erasure support', () => {
  test('불법 triple은 일반 오류 fallback으로 정정하고 그 사실을 결과에 남긴다', () => {
    const text = 'illegal symbol fallback';
    const encoded = encode(text, { version: 3, eccLevel: 'M' });
    const corrupted = encoded.dataDigits.slice();
    const target = Array.from(encoded.codewordSymbols).findIndex((symbol) => symbol !== 0);
    assert.notEqual(target, -1, '0이 아닌 심볼이 있어야 fallback을 검증할 수 있다');

    setIllegalSymbol(corrupted, encoded, target);
    const result = decodeCells(corrupted, oFormat(encoded));

    assert.equal(result.ok, true, result.ok ? '' : result.reason);
    assert.equal(result.text, text);
    assert.equal(result.corrected, 1);
    assert.deepEqual(result.erasureFallback, {
      mode: RS211_ERASURE_MODE,
      illegalSymbolIndices: [target],
      placeholder: 0,
    });
  });
});

describe('Type A and Type Y use the same back-half contract with their own layouts', () => {
  test('Type A 전 버전 × ECC', () => {
    for (const spec of VERSIONS_A) {
      for (const eccLevel of ECC_LEVELS) {
        const text = 'A-' + spec.name + '-' + eccLevel;
        const encoded = encodeA(text, { version: spec.version, eccLevel });
        const result = decodeCells(aDigits(encoded), {
          type: 'A', version: encoded.version, eccLevel: encoded.eccLevel, k: encoded.k,
        });
        assert.equal(result.ok, true, result.ok ? '' : result.reason);
        assert.equal(result.text, text);
      }
    }
  });

  test('Type Y 전 모드 × ECC 및 Y2 window', () => {
    for (const spec of VERSIONS_Y) {
      for (const eccLevel of ECC_LEVELS) {
        const text = 'Y-' + spec.name + '-' + eccLevel;
        const encoded = encodeY(text, {
          version: spec.version, eccLevel, tones: spec.tones,
        });
        const result = decodeCells(yDigits(encoded), {
          type: 'Y', version: encoded.version, eccLevel: encoded.eccLevel,
          n: encoded.n, tones: encoded.tones,
        });
        assert.equal(result.ok, true, result.ok ? '' : result.reason);
        assert.equal(result.text, text);
      }
    }

    // 현행 encodeY.js가 실제로 생성 가능한 window 조합은 L/M뿐이다. H는
    // base-211 83B -> 87심볼과 capacity 86심볼이 달라 인코더가 명시적으로 거부한다.
    for (const eccLevel of ['L', 'M']) {
      const text = 'Y-window-' + eccLevel;
      const encoded = encodeY(text, {
        version: 2, eccLevel, tones: 2, window: true,
      });
      const result = decodeCells(yWindowDigits(encoded), {
        type: 'Y', version: encoded.version, eccLevel: encoded.eccLevel,
        n: encoded.n, tones: encoded.tones, window: true,
      });
      assert.equal(result.ok, true, result.ok ? '' : result.reason);
      assert.equal(result.text, text);
    }

    const impossibleWindowH = decodeCells([], {
      type: 'Y', version: 2, eccLevel: 'H', n: 25, tones: 2, window: true,
    });
    assert.equal(impossibleWindowH.ok, false);
    assert.match(impossibleWindowH.reason, /^format: base-211 data 심볼 수 불일치:/);
  });
});

describe('determinism and non-throwing public failures', () => {
  test('같은 손상 입력은 같은 결과를 돌린다', () => {
    const encoded = encode('deterministic', { version: 3, eccLevel: 'M' });
    const corrupted = encoded.dataDigits.slice();
    setOneSafeSymbolError(corrupted, encoded, 0);
    const first = decodeCells(corrupted, oFormat(encoded));
    const second = decodeCells(corrupted, oFormat(encoded));
    assert.deepEqual(first, second);
  });

  test('형식·마스크 입력 문제를 예외 대신 단계별 실패로 돌린다', () => {
    const encoded = encode('failure result', { version: 1, eccLevel: 'M' });
    const good = encoded.dataDigits.slice();
    const badFormat = decodeCells(good, { version: 99, eccLevel: 'M', k: encoded.k });
    assert.equal(badFormat.ok, false);
    assert.match(badFormat.reason, /^format:/);

    const invalidDigit = Array.from(good);
    invalidDigit[0] = 6;
    const badDigit = decodeCells(invalidDigit, oFormat(encoded));
    assert.equal(badDigit.ok, false);
    assert.match(badDigit.reason, /^mask:/);
  });
});
