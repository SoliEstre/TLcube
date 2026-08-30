/**
 * typeC-rs.test.js — Type C 다중 RS 블록 백엔드 왕복·오류·소거·무회귀 자.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { encode } from '../src/encode.js';
import { decodeCells } from '../src/decode.js';
import { unpackSymbolsToCellDigits } from '../src/base211.js';
import { maskAdd } from '../src/mask.js';
import { dataCellsInScanOrder } from '../src/layout.js';
import { typeCReservedCells } from '../src/notchC.js';
import { daehanReservedCells } from '../src/finder-daehan.js';
import { rsBlockInterleaveMap } from '../src/rs211.js';
import { C_FORMAT_INDEX } from '../src/formatC.js';
import { decode as decodeFormatInfo } from '../src/formatinfo.js';

const LEVELS = Object.freeze(['L', 'M', 'H']);
const MULTI_ROWS = Object.freeze([
  Object.freeze({ name: 'C1', version: 1, daehanFinder: false }),
  Object.freeze({ name: 'C2', version: 2, daehanFinder: false }),
  Object.freeze({ name: 'C1D', version: 1, daehanFinder: true }),
  Object.freeze({ name: 'C2D', version: 2, daehanFinder: true }),
]);
const PAYLOAD = 'TYPE-C 다중 RS 왕복';

function formatFor(encoded) {
  return {
    type: 'C',
    formatIndex: encoded.capacity.formatIndex,
    k: encoded.k,
    eccLevel: encoded.eccLevel,
  };
}

function decodedFormatFor(encoded) {
  const reads = [0, 1, 2].map((replica) =>
    encoded.formatDigits.slice(replica * 5, (replica + 1) * 5));
  return decodeFormatInfo(reads);
}

function maskedDigitsForCodeword(encoded, codeword) {
  const preMask = unpackSymbolsToCellDigits(codeword);
  const additional = encoded.capacity.daehanFinder
    ? daehanReservedCells(encoded.k)
    : undefined;
  const scan = dataCellsInScanOrder(
    encoded.k, typeCReservedCells(encoded.k, additional),
  );
  assert.equal(preMask.length, encoded.capacity.usedSymbols * 3);
  assert.ok(scan.length >= preMask.length);
  return Uint8Array.from(preMask, (digit, index) => {
    const cell = scan[index];
    return maskAdd(digit, cell.q, cell.r);
  });
}

function corruptSymbols(codeword, indices) {
  const out = codeword.slice();
  for (let order = 0; order < indices.length; order += 1) {
    const index = indices[order];
    out[index] = (out[index] + 1 + (order * 17) % 210) % 211;
  }
  return out;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('C1/C2/C1D/C2D × L/M/H 백엔드 복호', () => {
  for (const row of MULTI_ROWS) {
    for (const eccLevel of LEVELS) {
      test(`${row.name}/${eccLevel} 원문·오류·소거 왕복`, () => {
        const encodeOptions = {
          notchC: true,
          version: row.version,
          eccLevel,
          daehanFinder: row.daehanFinder,
        };
        const probe = encode('', encodeOptions);
        const rowPayload = 'x'.repeat(probe.capacity.maxPayloadBytes);
        const encoded = encode(rowPayload, encodeOptions);
        assert.equal(encoded.capacity.name, row.name);
        assert.equal(encoded.capacity.rsBlockCount, 2);
        assert.deepEqual(maskedDigitsForCodeword(encoded, encoded.codewordSymbols), encoded.dataDigits);

        const clean = decodeCells(encoded.dataDigits, formatFor(encoded));
        assert.equal(clean.ok, true, clean.reason);
        assert.equal(clean.text, rowPayload);
        assert.equal(clean.corrected, 0);
        assert.equal(clean.crsDistance, 0);
        assert.deepEqual(clean.blockCorrections, [
          { blockIndex: 0, errorCount: 0, erasureCount: 0, crsDistance: 0 },
          { blockIndex: 1, errorCount: 0, erasureCount: 0, crsDistance: 0 },
        ]);

        // 첫 데이터 라운드는 wire 0→block0, wire 1→block1이다. 위치 미상 오류를
        // 블록마다 하나씩 넣어 집계와 원문 복원을 동시에 확인한다.
        const errorWire = [0, 1];
        const errorCodeword = corruptSymbols(encoded.codewordSymbols, errorWire);
        const corrected = decodeCells(
          maskedDigitsForCodeword(encoded, errorCodeword), formatFor(encoded),
        );
        assert.equal(corrected.ok, true, corrected.reason);
        assert.equal(corrected.text, rowPayload);
        assert.equal(corrected.corrected, 2);
        assert.equal(corrected.crsDistance, 4);
        assert.deepEqual(
          corrected.blockCorrections.map((block) => block.errorCount), [1, 1],
        );

        // 와이어 꼬리 두 심볼은 각 블록의 마지막 패리티다. C2 계열에서는 256을
        // 넘으므로 Uint16Array를 써 전역 인덱스 래핑이 없음을 함께 잠근다.
        const erasureWire = new Uint16Array([
          encoded.codewordSymbols.length - 2,
          encoded.codewordSymbols.length - 1,
        ]);
        const erasedCodeword = corruptSymbols(encoded.codewordSymbols, [...erasureWire]);
        const erased = decodeCells(
          maskedDigitsForCodeword(encoded, erasedCodeword),
          formatFor(encoded),
          { erasureSymbols: erasureWire },
        );
        assert.equal(erased.ok, true, erased.reason);
        assert.equal(erased.text, rowPayload);
        assert.equal(erased.corrected, 0);
        assert.equal(erased.crsDistance, 2);
        assert.deepEqual(erased.erasureFallback.erasureSymbolIndices, [...erasureWire]);
        assert.deepEqual(
          erased.blockCorrections.map((block) => block.erasureCount), [1, 1],
        );
        assert.throws(
          () => encode('x'.repeat(encoded.capacity.maxPayloadBytes + 1), encodeOptions),
          RangeError,
          `${row.name}/${eccLevel} max+1`,
        );
      });
    }
  }
});

test('C1/M 데이터→패리티 경계 버스트 34심볼이 두 블록 t=17/17로 분산 복구된다', () => {
  const encoded = encode(PAYLOAD, { notchC: true, version: 1, eccLevel: 'M' });
  const map = rsBlockInterleaveMap(encoded.capacity.rsBlockConfig);
  assert.deepEqual(
    map.slice(208, 213).map(({ blockIndex, codewordIndex, kind }) =>
      [blockIndex, codewordIndex, kind]),
    [
      [0, 104, 'data'],
      [1, 104, 'data'],
      [1, 105, 'data'],
      [0, 105, 'parity'],
      [1, 106, 'parity'],
    ],
  );

  const burst = Array.from({ length: 34 }, (_, index) => 194 + index);
  const byBlock = [0, 0];
  for (const wireIndex of burst) byBlock[map[wireIndex].blockIndex] += 1;
  assert.deepEqual(byBlock, [17, 17]);
  assert.ok(burst.includes(encoded.capacity.dataSymbols - 1));
  assert.ok(burst.includes(encoded.capacity.dataSymbols));

  const damaged = corruptSymbols(encoded.codewordSymbols, burst);
  const decoded = decodeCells(maskedDigitsForCodeword(encoded, damaged), formatFor(encoded));
  assert.equal(decoded.ok, true, decoded.reason);
  assert.equal(decoded.text, PAYLOAD);
  assert.equal(decoded.corrected, 34);
  assert.equal(decoded.crsDistance, 68);
  assert.deepEqual(decoded.blockCorrections.map((block) => block.errorCount), [17, 17]);
});

test('전역 소거가 한 블록의 p를 넘으면 실패 블록을 명시한다', () => {
  const encoded = encode(PAYLOAD, { notchC: true, version: 1, eccLevel: 'L' });
  const map = rsBlockInterleaveMap(encoded.capacity.rsBlockConfig);
  const blockZeroWire = map.flatMap((slot, wireIndex) =>
    slot.blockIndex === 0 ? [wireIndex] : []).slice(0, encoded.capacity.rsParitySymbolsPerBlock + 1);
  assert.equal(blockZeroWire.length, 18);
  const damaged = corruptSymbols(encoded.codewordSymbols, blockZeroWire);
  const decoded = decodeCells(
    maskedDigitsForCodeword(encoded, damaged),
    formatFor(encoded),
    { erasureSymbols: blockZeroWire },
  );
  assert.equal(decoded.ok, false);
  assert.match(decoded.reason, /^rs: RS 블록 1\/2: 소거 개수\(18\).*패리티 심볼 수\(17\)/);
});

test('Type C는 formatIndex+k를 필수로 하고 예약·모순 입력을 format 단계에서 거절한다', () => {
  const encoded = encode(PAYLOAD, { notchC: true, version: 1, eccLevel: 'M' });
  const good = formatFor(encoded);
  for (const bad of [
    { ...good, formatIndex: undefined },
    { ...good, k: undefined },
    { ...good, formatIndex: 2 },
    { ...good, version: 2 },
    { ...good, daehanFinder: true },
  ]) {
    const decoded = decodeCells(encoded.dataDigits, bad);
    assert.equal(decoded.ok, false);
    assert.match(decoded.reason, /^format:/);
  }
});

test('formatinfo.decode 원시 version과 논리 version을 6개 C 행 모두 일관되게 수용한다', () => {
  for (const row of C_FORMAT_INDEX) {
    const encoded = encode(PAYLOAD, {
      notchC: true,
      version: row.version,
      eccLevel: 'M',
      daehanFinder: row.daehanFinder,
    });
    const raw = decodedFormatFor(encoded);
    assert.equal(raw.ok, true, row.name);
    assert.equal(raw.version, row.formatIndex, row.name);

    for (const version of [raw.version, row.version]) {
      const decoded = decodeCells(encoded.dataDigits, {
        type: 'C',
        formatIndex: raw.version,
        version,
        k: row.k,
        eccLevel: raw.eccLevel,
      });
      assert.equal(decoded.ok, true, `${row.name}/version=${version}: ${decoded.reason}`);
      assert.equal(decoded.text, PAYLOAD, `${row.name}/version=${version}`);
    }

    const contradictory = decodeCells(encoded.dataDigits, {
      type: 'C',
      formatIndex: raw.version,
      version: 15,
      k: row.k,
      eccLevel: raw.eccLevel,
    });
    assert.equal(contradictory.ok, false, row.name);
    assert.match(contradictory.reason, /^format:/, row.name);
  }
});

test('C0/C1/C2/C0D/C1D/C2D canonical scan order 좌표는 불변이다', () => {
  const expected = {
    C0: [562, 'dcd4fde2756692b735dfbb4d7ad6d8f532ec28d2404fc74650fb6159bd8bd133'],
    C1: [844, 'df3ed24c608eee3974535fd68cd884634a01bc8532a669afeda08c247fd59fbd'],
    C2: [1180, '12929cece498c30b600b9df89e917307093b037cb2a3d88b875193ea85214103'],
    C0D: [502, '0c43aefa99ef760e3552d1a21c780b4d7b228d1ad1c05a09bbbbf4614527ef2d'],
    C1D: [784, '20fb76adb1d43e1d722926f8ad5fc3f1f99d8d5adebae5aa8d98311e2a45402e'],
    C2D: [1120, '2ba64fb6014d28935b225139f83e55516c69aa616ac78512469b5cd706bfe705'],
  };
  for (const row of C_FORMAT_INDEX) {
    const additional = row.daehanFinder ? daehanReservedCells(row.k) : undefined;
    const scan = dataCellsInScanOrder(row.k, typeCReservedCells(row.k, additional));
    const serialized = scan.map((cell) => `${cell.q},${cell.r}`).join(';');
    assert.deepEqual(
      [scan.length, createHash('sha256').update(serialized).digest('hex')],
      expected[row.name],
      row.name,
    );
  }
});

test('C0/C0D 발행 코드워드 해시는 새 1블록 경로에서도 비트 동일하다', () => {
  const expected = {
    C0: {
      L: '1e9d496e8f4f82fc54fcaffc309d866542e8bed4e2da78a6fc14534df5d9927a',
      M: '4d76e6ca3d25f0eb46aef4ef78808ba75a65b1f3c4c3a7af18f8bd784ef1128f',
      H: 'ac075fbaec4bb18075e83a4178362edda563ef03c2a9e0743bcde3a77eb30d38',
    },
    C0D: {
      L: 'bd5205c04561fe68d64a13c7cfd17008a7cdb369c0766fa0d35f25cabd4226c4',
      M: 'ded79cbe9c01172530ccf589220c74198726688d9830b03acafa83e2050e0268',
      H: '1b3b3747011f0affc898eac0519d9c62925ce9a6af6164809577179d8f2364da',
    },
  };
  for (const [name, byLevel] of Object.entries(expected)) {
    const daehanFinder = name === 'C0D';
    for (const eccLevel of LEVELS) {
      const encoded = encode('TYPE-C 타입 C', {
        notchC: true, version: 0, eccLevel, daehanFinder,
      });
      assert.equal(encoded.capacity.rsBlockCount, 1);
      assert.equal(sha256(encoded.codewordSymbols), byLevel[eccLevel], `${name}/${eccLevel}`);
      const decoded = decodeCells(encoded.dataDigits, formatFor(encoded));
      assert.equal(decoded.ok, true, decoded.reason);
      assert.equal(decoded.text, 'TYPE-C 타입 C');
      assert.equal(Object.hasOwn(decoded, 'blockCorrections'), false);
    }
  }
});
