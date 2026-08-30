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

test('C1/M 데이터→패리티 경계 버스트 2t심볼이 두 블록 t/t로 분산 복구된다', () => {
  const encoded = encode(PAYLOAD, { notchC: true, version: 1, eccLevel: 'M' });
  const tPerBlock = Math.floor(encoded.capacity.rsParitySymbolsPerBlock / 2);
  const map = rsBlockInterleaveMap(encoded.capacity.rsBlockConfig);
  // 인터리브 2상 성질: 데이터 라운드로빈 전부 끝난 뒤에야 패리티 라운드로빈이다 —
  // 짧은 블록의 첫 패리티가 긴 블록의 마지막 데이터와 절대 섞이지 않는다.
  const dataSymbols = encoded.capacity.dataSymbols;
  assert.ok(map.slice(0, dataSymbols).every((slot) => slot.kind === 'data'));
  assert.ok(map.slice(dataSymbols).every((slot) => slot.kind === 'parity'));

  const burst = Array.from({ length: 2 * tPerBlock }, (_, index) => dataSymbols - tPerBlock + index);
  const byBlock = [0, 0];
  for (const wireIndex of burst) byBlock[map[wireIndex].blockIndex] += 1;
  assert.deepEqual(byBlock, [tPerBlock, tPerBlock]);
  assert.ok(burst.includes(dataSymbols - 1));
  assert.ok(burst.includes(dataSymbols));

  const damaged = corruptSymbols(encoded.codewordSymbols, burst);
  const decoded = decodeCells(maskedDigitsForCodeword(encoded, damaged), formatFor(encoded));
  assert.equal(decoded.ok, true, decoded.reason);
  assert.equal(decoded.text, PAYLOAD);
  assert.equal(decoded.corrected, 2 * tPerBlock);
  assert.equal(decoded.crsDistance, 4 * tPerBlock);
  assert.deepEqual(decoded.blockCorrections.map((block) => block.errorCount), [tPerBlock, tPerBlock]);
});

test('전역 소거가 한 블록의 p를 넘으면 실패 블록을 명시한다', () => {
  const encoded = encode(PAYLOAD, { notchC: true, version: 1, eccLevel: 'L' });
  const map = rsBlockInterleaveMap(encoded.capacity.rsBlockConfig);
  const blockZeroWire = map.flatMap((slot, wireIndex) =>
    slot.blockIndex === 0 ? [wireIndex] : []).slice(0, encoded.capacity.rsParitySymbolsPerBlock + 1);
  const parityPerBlock = encoded.capacity.rsParitySymbolsPerBlock;
  assert.equal(blockZeroWire.length, parityPerBlock + 1);
  const damaged = corruptSymbols(encoded.codewordSymbols, blockZeroWire);
  const decoded = decodeCells(
    maskedDigitsForCodeword(encoded, damaged),
    formatFor(encoded),
    { erasureSymbols: blockZeroWire },
  );
  assert.equal(decoded.ok, false);
  assert.match(decoded.reason, new RegExp(
    `^rs: RS \ube14\ub85d 1/2: \uc18c\uac70 \uac1c\uc218\\(${parityPerBlock + 1}\\).*\ud328\ub9ac\ud2f0 \uc2ec\ubcfc \uc218\\(${parityPerBlock}\\)`,
  ));
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

test('C0..C3/C0D..C3D canonical scan order 좌표는 불변이다', () => {
  const expected = {
    C0: [550, '38259676b4a29178b5de33bae7122b09cac29d93fd4b9f92335d6bd661566f33'],
    C1: [726, 'e5daa04aa44e1028e553ed99a17755a2edeb12c0f9139e0c293bdde54aa8647c'],
    C2: [926, 'c8ed9aec6234bf32de6605a3888f302f4fc548eac70e8a317001274abeb971e3'],
    C3: [1150, '54b8e70b4737238ef4cc69b8e3fbac20463b0ad0c405c937973295aa46d27f92'],
    C0D: [490, '8f8c4c1bfb41e5c0b23673813bcc05cb73c6a9998eaea712712a0f3af3a0340b'],
    C1D: [666, '7938f87ddf1805bec6282776b5e60019ff2967abcb7600096991e1682782c2f3'],
    C2D: [866, '60c378c100bc1550ed85014cf6e2845869b42fa968a50fd5bf765480aaa03d6a'],
    C3D: [1090, 'b6a480cebe979fa8b95af5b2269b140f4dae13bc24dc65a79a77f08f92145142'],
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
      L: '534760df42b40d2a78a65b920ec119897c696e51ae8afe59f4fedadbb238e2e1',
      M: 'a38e8479dd78db99a0c93bf68f759fbe19ff2787a70fcb2f177d958c30374562',
      H: 'd2add2b537ff7423cd45fbe2f0f1426e3af457a7e17be2bee557a22b33a9d38e',
    },
    C0D: {
      L: '7934dda25d5c8a3ab41e3e941930ef0c896e0e1b6507f0976e74bfda98c52987',
      M: 'c67723bf644609f6cb0e89fefaa786ea352a7d894d2a4612aad4901c76b94d0c',
      H: '69a9ac6ef540444e36ad94d277e292d4d59f44eb4c7eb8b52b6532cddf044cbe',
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
