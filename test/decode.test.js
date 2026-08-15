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
import {
  decodeCells,
  RS211_ERASURE_MODE,
  RS211_ERASURE_MODE_LEGACY,
} from '../src/decode.js';
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
  assert.equal(result.crsDistance, 0);
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
    assert.equal(result.crsDistance, 2 * t);
  });

  test('C_RS 거리는 오류 k개에 2k이고 정정 한계 t에서도 유지된다', () => {
    const encoded = encode('C_RS distance', { version: 3, eccLevel: 'M' });
    const t = encoded.capacity.errorCapacity;

    for (const k of [0, 1, t]) {
      const corrupted = encoded.dataDigits.slice();
      for (let symbolIndex = 0; symbolIndex < k; symbolIndex += 1) {
        setOneSafeSymbolError(corrupted, encoded, symbolIndex);
      }

      const result = decodeCells(corrupted, oFormat(encoded));
      assert.equal(result.ok, true, result.ok ? '' : result.reason);
      assert.equal(result.corrected, k);
      // rs211.js는 소거 복호가 없으므로 이 경로의 e는 항상 0, C_RS=2u다.
      assert.equal(result.crsDistance, 2 * k);
    }
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

describe('illegal 211..215 symbol handling as RS erasure', () => {
  test('불법 triple은 위치 지정 소거로 정정하고 그 사실을 결과에 남긴다', () => {
    const text = 'illegal symbol fallback';
    const encoded = encode(text, { version: 3, eccLevel: 'M' });
    const corrupted = encoded.dataDigits.slice();
    const target = Array.from(encoded.codewordSymbols).findIndex((symbol) => symbol !== 0);
    assert.notEqual(target, -1, '0이 아닌 심볼이 있어야 소거를 검증할 수 있다');

    setIllegalSymbol(corrupted, encoded, target);
    const result = decodeCells(corrupted, oFormat(encoded));

    assert.equal(result.ok, true, result.ok ? '' : result.reason);
    assert.equal(result.text, text);
    // 소거는 위치를 알기 때문에 «위치 미상 오류» 로 세지 않는다. C_RS = 2u + e = 1.
    assert.equal(result.corrected, 0);
    assert.equal(result.crsDistance, 1);
    assert.deepEqual(result.erasureFallback, {
      mode: RS211_ERASURE_MODE,
      illegalSymbolIndices: [target],
      erasureSymbolIndices: [target],
      placeholder: 0,
    });
  });

  test('legacy 모드(opt-out)는 소거 지원 이전 동작 — 일반 오류 2칸을 그대로 쓴다', () => {
    const text = 'illegal symbol fallback';
    const encoded = encode(text, { version: 3, eccLevel: 'M' });
    const corrupted = encoded.dataDigits.slice();
    const target = Array.from(encoded.codewordSymbols).findIndex((symbol) => symbol !== 0);

    setIllegalSymbol(corrupted, encoded, target);
    const result = decodeCells(corrupted, oFormat(encoded), {
      erasureMode: RS211_ERASURE_MODE_LEGACY,
    });

    assert.equal(result.ok, true, result.ok ? '' : result.reason);
    assert.equal(result.text, text);
    assert.equal(result.corrected, 1);
    assert.equal(result.crsDistance, 2);
    assert.equal(result.erasureFallback.mode, RS211_ERASURE_MODE_LEGACY);
  });

  test('불법 심볼 nsym개 — 소거는 성공하고 legacy(오류 전용)는 실패한다', () => {
    const text = 'erasure doubles the reach';
    const encoded = encode(text, { version: 3, eccLevel: 'M' });
    const nsym = encoded.capacity.nsym;
    const t = encoded.capacity.errorCapacity;
    assert.ok(nsym > t, '소거 이득이 존재하려면 nsym > t 여야 한다');

    const corrupted = encoded.dataDigits.slice();
    for (let symbolIndex = 0; symbolIndex < nsym; symbolIndex += 1) {
      setIllegalSymbol(corrupted, encoded, symbolIndex);
    }

    const erasure = decodeCells(corrupted, oFormat(encoded));
    assert.equal(erasure.ok, true, erasure.ok ? '' : erasure.reason);
    assert.equal(erasure.text, text);
    assert.equal(erasure.crsDistance, nsym);

    const legacy = decodeCells(corrupted, oFormat(encoded), {
      erasureMode: RS211_ERASURE_MODE_LEGACY,
    });
    assert.equal(legacy.ok, false, '오류 전용 경로는 nsym개를 고칠 수 없다');
  });

  // 이름 주의: 이 테스트가 치는 것은 «소거 개수 > nsym» 조기 반환 가드 **하나뿐**이다.
  // ECC 한계 전반의 정직성을 주장하지 않는다 — s = nsym 절벽은 아래 describe 가 다룬다.
  test('소거를 nsym+1개 선언하면 복호를 시도조차 하지 않는다 (한계 초과 조기 반환 가드)', () => {
    const encoded = encode('honest limit', { version: 3, eccLevel: 'M' });
    const nsym = encoded.capacity.nsym;
    const corrupted = encoded.dataDigits.slice();
    for (let symbolIndex = 0; symbolIndex < nsym + 1; symbolIndex += 1) {
      setIllegalSymbol(corrupted, encoded, symbolIndex);
    }
    const result = decodeCells(corrupted, oFormat(encoded));
    assert.equal(result.ok, false);
    assert.match(result.reason, /^rs:/);
    assert.match(result.reason, /소거 개수/, '가드가 «개수» 를 이유로 밝혀야 한다');
  });
});

describe('s = nsym 절벽 — ECC 검출 마진이 0 인 지점에서는 상위층이 유일한 방어선이다', () => {
  // rs211 은 s = nsym 에서 «틀렸다» 고 말할 능력이 구조적으로 없다
  // (test/rs211.test.js «절벽 —» 참조: 조용한 오정정 100%). 그런데 §2.1 이 이득으로
  // 내세우는 운용점(불법 심볼 nsym 개)이 정확히 그 지점이다. 따라서 종단 정직성은
  // ECC 가 아니라 **페이로드 프레이밍**(base-211 범위 · 길이 헤더 · UTF-8 · 0 패딩)이
  // 댄다. 그 사실을 주석이 아니라 단언으로 고정한다 — 프레이밍 검사를 느슨하게
  // 만드는 변경이 있으면 여기서 먼저 빨개져야 한다.

  /** 결정적 PRNG — 이 describe 안의 모든 표본은 시드 고정이다. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickSymbols(symbolCount, count, rnd) {
    const chosen = new Set();
    while (chosen.size < count) chosen.add(Math.floor(rnd() * symbolCount));
    return [...chosen].sort((a, b) => a - b);
  }

  /**
   * 소거 nsym 개를 «정확히» 선언하고, 선언하지 않은 오류를 1개 더 심는다.
   * RS 로서는 2v + s = nsym + 2 rung 이고 잔여 패리티가 0 이다.
   */
  function overCliff(encoded, rnd) {
    const nsym = encoded.capacity.nsym;
    const symbolCount = encoded.capacity.usedSymbols;
    const picked = pickSymbols(symbolCount, nsym + 1, rnd);
    const erasureSymbols = picked.slice(0, nsym);
    const undeclared = picked[nsym];

    const digits = encoded.dataDigits.slice();
    const erasureCells = [];
    for (const symbolIndex of erasureSymbols) {
      for (let offset = 0; offset < 3; offset += 1) {
        erasureCells.push(symbolIndex * 3 + offset);
        digits[symbolIndex * 3 + offset] = 0; // 프레임 밖 = 결정적 0
      }
    }
    setOneSafeSymbolError(digits, encoded, undeclared);
    return { digits, erasureCells };
  }

  test('RS 는 통과시키지만 상위층이 전부 막는다 — 종단 오수용 0', () => {
    const cases = [
      // 최대 페이로드와 짧은 페이로드 양쪽. 프레이밍 여유가 다르다.
      { version: 3, eccLevel: 'M', text: 'A'.repeat(65) },
      { version: 3, eccLevel: 'M', text: 'honest limit' },
      { version: 3, eccLevel: 'H', text: 'cliff' },
      { version: 2, eccLevel: 'M', text: 'short' },
    ];
    let total = 0;
    let wrongAccept = 0;
    let stoppedByRs = 0;
    const stages = new Map();

    for (const spec of cases) {
      const encoded = encode(spec.text, { version: spec.version, eccLevel: spec.eccLevel });
      const rnd = mulberry32(0x5c11ff + spec.version * 131 + spec.eccLevel.charCodeAt(0));
      for (let trial = 0; trial < 40; trial += 1) {
        const { digits, erasureCells } = overCliff(encoded, rnd);
        const result = decodeCells(digits, oFormat(encoded), { erasureCells });
        total += 1;
        if (result.ok) {
          // 종단에서 «성공» 이 나왔다면 최소한 값은 맞아야 한다.
          if (result.text !== spec.text) wrongAccept += 1;
          continue;
        }
        const stage = result.reason.split(':')[0];
        stages.set(stage, (stages.get(stage) ?? 0) + 1);
        if (stage === 'rs') stoppedByRs += 1;
      }
    }

    assert.equal(total, 160);
    assert.equal(wrongAccept, 0, '종단 오수용은 0 이어야 한다 — 이 줄이 무너지면 포맷이 거짓말을 한다');
    assert.equal(
      stoppedByRs, 0,
      'RS 가 막았다면 절벽 전제가 깨진 것이다 — 이 테스트가 재는 대상이 아니게 된다',
    );
    // 실제로 막은 것은 전부 프레이밍 층이다. 이 집합 밖의 단계가 나오면 계약이 바뀐 것.
    for (const stage of stages.keys()) {
      assert.ok(
        ['base211', 'header', 'utf8'].includes(stage),
        `상위층 방어선이 아닌 단계가 막았다: ${stage}`,
      );
    }
    // 세 갈래가 모두 실제로 쓰인다 — 한 갈래만 일하고 있으면 «3중 방어» 는 과장이다.
    assert.deepEqual(
      [...stages.keys()].sort(),
      ['base211', 'header', 'utf8'],
      `프레이밍 3층이 전부 동원돼야 한다: ${JSON.stringify(Object.fromEntries(stages))}`,
    );
    assert.equal(
      [...stages.values()].reduce((sum, count) => sum + count, 0), total,
      '한 건도 남김없이 정직 실패로 끝나야 한다',
    );
  });

  test('절벽 지점의 crsDistance 는 예산 전액(nsym)을 정직하게 보고한다', () => {
    // crsDistance 는 절대 게이트가 아니라 점수·타이브레이크다(bootstrap.js). 그래서
    // «값이 크다» 는 것을 상위 소비자가 읽을 수 있게 하는 것이 최소 계약이다.
    const encoded = encode('budget spent', { version: 3, eccLevel: 'M' });
    const nsym = encoded.capacity.nsym;
    const digits = encoded.dataDigits.slice();
    const erasureCells = [];
    for (let symbolIndex = 0; symbolIndex < nsym; symbolIndex += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        erasureCells.push(symbolIndex * 3 + offset);
        digits[symbolIndex * 3 + offset] = 0;
      }
    }
    const result = decodeCells(digits, oFormat(encoded), { erasureCells });
    assert.equal(result.ok, true, result.ok ? '' : result.reason);
    assert.equal(result.text, 'budget spent');
    assert.equal(result.crsDistance, nsym, '소거 nsym 개 = 패리티 예산 전액');
    assert.equal(result.corrected, 0, '위치를 아는 소거는 «위치 미상 오류» 로 세지 않는다');
    assert.equal(result.erasureFallback.erasureSymbolIndices.length, nsym);
  });
});

describe('unsampled (out-of-frame) cells map to RS erasures', () => {
  /** scan-order 셀 인덱스를 «표본이 없었다» 로 만든다 — 값은 결정적 0. */
  function blankCells(digits, cellIndices) {
    const out = digits.slice();
    for (const index of cellIndices) out[index] = 0;
    return out;
  }

  test('프레임 밖 셀을 소거로 넘기면 오류 전용 한계를 넘어 복구한다', () => {
    const text = 'out of frame cells';
    const encoded = encode(text, { version: 3, eccLevel: 'M' });
    const nsym = encoded.capacity.nsym;

    // 심볼 nsym개 = 셀 3·nsym개가 프레임 밖이라 결정적 0으로 채워졌다.
    const erasureCells = [];
    for (let symbolIndex = 0; symbolIndex < nsym; symbolIndex += 1) {
      erasureCells.push(symbolIndex * 3, symbolIndex * 3 + 1, symbolIndex * 3 + 2);
    }
    const starved = blankCells(encoded.dataDigits, erasureCells);

    const blind = decodeCells(starved, oFormat(encoded));
    const informed = decodeCells(starved, oFormat(encoded), { erasureCells });

    assert.equal(informed.ok, true, informed.ok ? '' : informed.reason);
    assert.equal(informed.text, text);
    assert.equal(informed.crsDistance, nsym);
    assert.equal(blind.ok, false, '위치를 모르면 같은 손상을 고칠 수 없어야 한다');
  });

  test('erasureSymbols 직접 지정도 같은 결과다', () => {
    const text = 'symbol level erasure';
    const encoded = encode(text, { version: 3, eccLevel: 'M' });
    const nsym = encoded.capacity.nsym;
    const symbols = Array.from({ length: nsym }, (unused, index) => index);
    const cells = [];
    for (const symbolIndex of symbols) {
      cells.push(symbolIndex * 3, symbolIndex * 3 + 1, symbolIndex * 3 + 2);
    }
    const starved = blankCells(encoded.dataDigits, cells);

    const viaCells = decodeCells(starved, oFormat(encoded), { erasureCells: cells });
    const viaSymbols = decodeCells(starved, oFormat(encoded), { erasureSymbols: symbols });
    assert.equal(viaSymbols.ok, true, viaSymbols.ok ? '' : viaSymbols.reason);
    assert.equal(viaSymbols.text, viaCells.text);
    assert.deepEqual(
      viaSymbols.erasureFallback.erasureSymbolIndices,
      viaCells.erasureFallback.erasureSymbolIndices,
    );
  });

  test('filler 구간의 셀 인덱스는 코드워드가 아니므로 소거로 세지 않는다', () => {
    const encoded = encode('filler tail', { version: 3, eccLevel: 'M' });
    const capacity = encoded.capacity;
    if (capacity.residualCells === 0) return; // 이 버전에 filler가 없으면 검사 대상이 없다
    const fillerIndex = capacity.usedSymbols * 3;
    const result = decodeCells(encoded.dataDigits, oFormat(encoded), {
      erasureCells: [fillerIndex],
    });
    assert.equal(result.ok, true, result.ok ? '' : result.reason);
    assert.equal(result.crsDistance, 0);
    assert.equal(result.erasureFallback, undefined);
  });

  test('범위 밖 소거 인덱스는 조용히 버리지 않고 erasure 단계 실패로 보고한다', () => {
    const encoded = encode('range check', { version: 3, eccLevel: 'M' });
    const bad = decodeCells(encoded.dataDigits, oFormat(encoded), { erasureCells: [-1] });
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /^erasure:/);
  });

  test('결정성 — 같은 소거 입력은 2회 호출에서 deepEqual', () => {
    const encoded = encode('deterministic erasure', { version: 3, eccLevel: 'M' });
    const cells = [0, 1, 2, 9, 10, 11];
    const starved = blankCells(encoded.dataDigits, cells);
    const first = decodeCells(starved, oFormat(encoded), { erasureCells: cells });
    const second = decodeCells(starved, oFormat(encoded), { erasureCells: cells });
    assert.deepEqual(first, second);
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
