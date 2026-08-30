/**
 * rs211-blocks.test.js — Type C 고정 RS 블록 표와 QR식 2단계 인터리빙 자.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  NSYM_TABLE_C,
  rsBlockConfigForC,
  rsBlockInterleaveMap,
  interleaveRsBlocks,
  deinterleaveRsBlocks,
  rsEncode,
  rsEncodeBlocks,
  rsDecode,
  rsDecodeBlocks,
} from '../src/rs211.js';

const LEVELS = Object.freeze(['L', 'M', 'H']);

describe('Type C RS 블록 구성 표', () => {
  test('24개 (행,ECC) 구성이 리터럴 계약값과 같다 (4단 사다리, 노치 v2)', () => {
    const expected = {
      C0: { totals: [22, 47, 73], data: [[161], [136], [110]], parity: [22, 47, 73] },
      C1: {
        totals: [30, 62, 96],
        data: [[106, 106], [90, 90], [73, 73]],
        parity: [15, 31, 48],
      },
      C2: {
        totals: [36, 78, 124],
        data: [[136, 136], [115, 115], [92, 92]],
        parity: [18, 39, 62],
      },
      C3: {
        totals: [50, 94, 150],
        data: [[166, 167], [144, 145], [116, 117]],
        parity: [25, 47, 75],
      },
      C0D: { totals: [19, 41, 65], data: [[144], [122], [98]], parity: [19, 41, 65] },
      C1D: {
        totals: [26, 58, 88],
        data: [[98, 98], [82, 82], [67, 67]],
        parity: [13, 29, 44],
      },
      C2D: {
        totals: [38, 74, 114],
        data: [[125, 125], [107, 107], [87, 87]],
        parity: [19, 37, 57],
      },
      C3D: {
        totals: [44, 94, 146],
        data: [[159, 160], [134, 135], [108, 109]],
        parity: [22, 47, 73],
      },
    };

    for (const [symbolKey, want] of Object.entries(expected)) {
      const row = NSYM_TABLE_C[symbolKey];
      assert.deepEqual(LEVELS.map((level) => row[level]), want.totals, symbolKey);
      for (let index = 0; index < LEVELS.length; index += 1) {
        const config = rsBlockConfigForC(symbolKey, LEVELS[index]);
        assert.equal(config.blockCount, want.data[index].length, `${symbolKey}/${LEVELS[index]}`);
        assert.deepEqual(config.dataSymbolsPerBlock, want.data[index], `${symbolKey}/${LEVELS[index]}`);
        assert.equal(
          config.paritySymbolsPerBlock, want.parity[index], `${symbolKey}/${LEVELS[index]}`,
        );
        assert.equal(Object.isFrozen(config), true);
        assert.equal(Object.isFrozen(config.dataSymbolsPerBlock), true);
      }
    }
  });

  test('프로토타입 키는 표 행이나 ECC 레벨로 오인하지 않는다', () => {
    for (const symbolKey of ['toString', '__proto__', 'constructor']) {
      assert.throws(() => rsBlockConfigForC(symbolKey, 'L'), /NSYM_TABLE_C 에 키/);
    }
    for (const level of ['toString', '__proto__', 'constructor']) {
      assert.throws(() => rsBlockConfigForC('C1', level), /blocks 에 레벨/);
    }
  });
});

test('인터리빙은 데이터 RR 뒤 패리티 RR이며 역함수가 정확하다', () => {
  const config = Object.freeze({
    blockCount: 2,
    dataSymbolsPerBlock: Object.freeze([2, 3]),
    paritySymbolsPerBlock: 2,
  });
  const blocks = [
    Uint8Array.of(10, 11, 90, 91),
    Uint8Array.of(20, 21, 22, 92, 93),
  ];
  const interleaved = interleaveRsBlocks(blocks, config);
  assert.deepEqual(
    [...interleaved],
    [10, 20, 11, 21, 22, 90, 92, 91, 93],
    '짧은 블록 패리티 90은 긴 블록의 마지막 데이터 22 뒤에 와야 한다',
  );
  assert.deepEqual(
    rsBlockInterleaveMap(config).map(({ blockIndex, codewordIndex, kind }) =>
      [blockIndex, codewordIndex, kind]),
    [
      [0, 0, 'data'], [1, 0, 'data'], [0, 1, 'data'], [1, 1, 'data'], [1, 2, 'data'],
      [0, 2, 'parity'], [1, 3, 'parity'], [0, 3, 'parity'], [1, 4, 'parity'],
    ],
  );
  assert.deepEqual(deinterleaveRsBlocks(interleaved, config), blocks);
});

test('다중 블록 복호는 교정 위치를 전역 와이어 인덱스로 되돌린다', () => {
  const config = rsBlockConfigForC('C1', 'M');
  const dataLength = config.dataSymbolsPerBlock.reduce((sum, count) => sum + count, 0);
  const message = Uint8Array.from({ length: dataLength }, (_, index) => (index * 19 + 3) % 211);
  const codeword = rsEncodeBlocks(message, config);
  const damaged = codeword.slice();
  for (const wireIndex of [210, 211]) damaged[wireIndex] = (damaged[wireIndex] + 1) % 211;

  const decoded = rsDecodeBlocks(damaged, config);
  assert.equal(decoded.ok, true, decoded.reason);
  assert.deepEqual(decoded.message, message);
  assert.deepEqual(decoded.codeword, codeword);
  assert.deepEqual(decoded.errorPositions, [210, 211]);
  assert.deepEqual(decoded.correctedPositions, [210, 211]);
  assert.equal(decoded.errorCount, 2);
  assert.deepEqual(decoded.blockResults.map((block) => block.errorCount), [1, 1]);
});

test('두 번째 블록의 소거 한계 초과는 블록 2/2와 전역 위치를 보존해 실패한다', () => {
  const config = rsBlockConfigForC('C1', 'L');
  const dataLength = config.dataSymbolsPerBlock.reduce((sum, count) => sum + count, 0);
  const message = Uint8Array.from({ length: dataLength }, (_, index) => (index * 23 + 5) % 211);
  const codeword = rsEncodeBlocks(message, config);
  const map = rsBlockInterleaveMap(config);
  const erasures = map.flatMap((slot, wireIndex) =>
    slot.blockIndex === 1 ? [wireIndex] : []).slice(0, config.paritySymbolsPerBlock + 1);
  const damaged = codeword.slice();
  for (const wireIndex of erasures) damaged[wireIndex] = (damaged[wireIndex] + 1) % 211;

  const decoded = rsDecodeBlocks(damaged, config, { erasures: new Uint16Array(erasures) });
  assert.equal(decoded.ok, false);
  assert.equal(decoded.blockIndex, 1);
  assert.match(decoded.reason, new RegExp(
    `^RS 블록 2/2: 소거 개수\\(${config.paritySymbolsPerBlock + 1}\\).*패리티 심볼 수\\(${config.paritySymbolsPerBlock}\\)`,
  ));
  assert.deepEqual(decoded.erasurePositions, erasures);
});

test('C0/C0D 단일 블록 인터리빙은 기존 rsEncode 코드워드의 항등 사상이다', () => {
  for (const symbolKey of ['C0', 'C0D']) {
    for (const level of LEVELS) {
      const config = rsBlockConfigForC(symbolKey, level);
      const data = Uint8Array.from(
        { length: config.dataSymbolsPerBlock[0] }, (_, index) => (index * 37 + 9) % 211,
      );
      const legacy = rsEncode(data, config.paritySymbolsPerBlock);
      assert.deepEqual(rsEncodeBlocks(data, config), legacy, `${symbolKey}/${level} encode`);
      const interleaved = interleaveRsBlocks([legacy], config);
      assert.deepEqual(interleaved, legacy, `${symbolKey}/${level}`);
      assert.deepEqual(deinterleaveRsBlocks(interleaved, config), [legacy], `${symbolKey}/${level}`);
      assert.deepEqual(
        rsDecodeBlocks(legacy, config),
        rsDecode(legacy, config.paritySymbolsPerBlock),
        `${symbolKey}/${level} decode`,
      );
    }
  }
});

test('블록 표 위반은 조용히 보정하지 않는다', () => {
  assert.throws(
    () => interleaveRsBlocks(
      [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6)],
      { blockCount: 2, dataSymbolsPerBlock: [2, 4], paritySymbolsPerBlock: 1 },
    ),
    /데이터 심볼 수 차이는 1 이하/,
  );
  assert.throws(
    () => deinterleaveRsBlocks(
      Uint8Array.of(1, 2),
      { blockCount: 1, dataSymbolsPerBlock: [2], paritySymbolsPerBlock: 1 },
    ),
    /코드워드 합계/,
  );
});
