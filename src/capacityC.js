/**
 * capacityC.js — Type C(3시 노치) 버전별 셀·GF(211) 회계.
 *
 * k 단계 C0=14/C1=17/C2=20과 와이어 표는 formatC.js에서 읽는다.
 * overhead는 placement.overheadBreakdown에 노치 8셀(평 C), 또는 노치 8셀+
 * daehan 완전판의 불스아이 밖 sagoae 60셀(C*D)을 넣어 유도한다. 중앙 taegeuk
 * 19셀은 기존 bullseye 항이 이미 세므로 다시 더하지 않는다.
 *
 * C1/C2 계열은 `rs211.js`의 고정 다중 블록 표를 쓴다. `nsym`은 전 블록 패리티 합,
 * 실제 정정 한계는 `errorCapacityPerBlock`과 블록별 `2v+s≤p` 계약으로 해석한다.
 */

import { capacityFor } from './capacity.js';
import {
  MAX_CODEWORD_LEN, NSYM_TABLE_C, errorCapacity, rsBlockConfigForC,
} from './rs211.js';
import { symbolCountForByteLength } from './base211.js';
import { overheadBreakdown } from './placement.js';
import { daehanReservedCells } from './finder-daehan.js';
import { notchCellsC, typeCReservedCells } from './notchC.js';
import { C_FORMAT_INDEX } from './formatC.js';

const NSYM_SOURCE = Object.freeze({ table: NSYM_TABLE_C, tableName: 'NSYM_TABLE_C' });

function buildSpec(entry) {
  const additional = entry.daehanFinder ? daehanReservedCells(entry.k) : undefined;
  const reserved = typeCReservedCells(entry.k, additional);
  return Object.freeze({
    ...entry,
    overhead: overheadBreakdown(entry.k, reserved.length).total,
    symbolKey: entry.name,
    notchCount: notchCellsC(entry.k).length,
    finderReservedCount: entry.daehanFinder ? additional.length : 0,
  });
}

/** 평 Type C 버전 정의. 배열 순서는 용량 오름차순이다. */
export const VERSIONS_C = Object.freeze(
  C_FORMAT_INDEX.filter((entry) => !entry.daehanFinder).map(buildSpec),
);

/** Type C + daehan/sagoae 예약 회계 버전. version은 평 C와 공유하므로 배열을 합치지 않는다. */
export const VERSIONS_C_DAEHAN = Object.freeze(
  C_FORMAT_INDEX.filter((entry) => entry.daehanFinder).map(buildSpec),
);

/**
 * Type C 한 행의 셀·패리티·고정 블록 회계.
 */
export function capacityForC(spec, level = 'M') {
  const base = capacityFor(spec, level, NSYM_SOURCE);
  const rsBlockConfig = rsBlockConfigForC(spec.symbolKey, level);
  const dataSymbolsPerBlock = rsBlockConfig.dataSymbolsPerBlock;
  const paritySymbolsPerBlock = rsBlockConfig.paritySymbolsPerBlock;
  const codewordSymbolsPerBlock = Object.freeze(
    dataSymbolsPerBlock.map((count) => count + paritySymbolsPerBlock),
  );
  const dataSymbols = dataSymbolsPerBlock.reduce((sum, count) => sum + count, 0);
  const totalParity = rsBlockConfig.blockCount * paritySymbolsPerBlock;
  if (dataSymbols !== base.dataSymbols || totalParity !== base.nsym
    || codewordSymbolsPerBlock.reduce((sum, count) => sum + count, 0) !== base.usedSymbols) {
    throw new Error(`${spec.name}/${level}: capacityFor와 RS 블록 표의 심볼 회계가 어긋난다`);
  }
  const errorCapacityPerBlock = errorCapacity(paritySymbolsPerBlock);
  return {
    ...base,
    // 총 오류가 어디에 몰릴지 모르는 보장은 한 블록 t까지다. 블록에 고르게 퍼진
    // 최댓값은 errorCapacityAggregate이고, 정규 판정은 각 블록 2v+s≤p다.
    errorCapacity: errorCapacityPerBlock,
    errorCapacityPerBlock,
    errorCapacityAggregate: rsBlockConfig.blockCount * errorCapacityPerBlock,
    totalParitySymbols: totalParity,
    nsymPerBlock: paritySymbolsPerBlock,
    name: spec.name,
    formatIndex: spec.formatIndex,
    notchC: true,
    daehanFinder: spec.daehanFinder === true,
    notchCount: spec.notchCount,
    finderReservedCount: spec.finderReservedCount,
    rsEncodable: true,
    singleBlockEncodable: base.usedSymbols <= MAX_CODEWORD_LEN,
    minimumRsBlocks: Math.ceil(base.usedSymbols / MAX_CODEWORD_LEN),
    rsBlockCount: rsBlockConfig.blockCount,
    rsParitySymbolsPerBlock: paritySymbolsPerBlock,
    rsDataSymbolsPerBlock: dataSymbolsPerBlock,
    rsCodewordSymbolsPerBlock: codewordSymbolsPerBlock,
    rsBlockConfig,
  };
}

export function capacityForCDaehan(spec, level = 'M') {
  if (!spec || spec.daehanFinder !== true) {
    throw new RangeError('capacityForCDaehan은 C*D 표 항목만 받는다');
  }
  return capacityForC(spec, level);
}

export function capacityTableC(level = 'M', options = {}) {
  const versions = options.daehanFinder === true ? VERSIONS_C_DAEHAN : VERSIONS_C;
  return versions.map((spec) => capacityForC(spec, level));
}

// 로드 자기검증 — 회계·청킹·고정 블록 경계를 값으로 잠근다.
{
  const EXPECT = Object.freeze({
    C0: Object.freeze({ k: 14, overhead: 69, dataCells: 562, symbols: 187, payload: [158, 134, 107] }),
    C1: Object.freeze({ k: 17, overhead: 75, dataCells: 844, symbols: 281, payload: [237, 202, 160] }),
    C2: Object.freeze({ k: 20, overhead: 81, dataCells: 1180, symbols: 393, payload: [255, 255, 225] }),
    C0D: Object.freeze({ k: 14, overhead: 129, dataCells: 502, symbols: 167, payload: [140, 118, 95] }),
    C1D: Object.freeze({ k: 17, overhead: 135, dataCells: 784, symbols: 261, payload: [221, 187, 150] }),
    C2D: Object.freeze({ k: 20, overhead: 141, dataCells: 1120, symbols: 373, payload: [255, 255, 214] }),
  });
  const levels = ['L', 'M', 'H'];
  for (const spec of [...VERSIONS_C, ...VERSIONS_C_DAEHAN]) {
    const want = EXPECT[spec.name];
    if (!want) throw new Error(`capacityC: 기대표에 없는 행 ${spec.name}`);
    if (spec.k !== want.k || spec.overhead !== want.overhead) {
      throw new Error(
        `capacityC: ${spec.name} k/overhead 불일치 — ${spec.k}/${spec.overhead}`,
      );
    }
    for (let i = 0; i < levels.length; i += 1) {
      const cap = capacityForC(spec, levels[i]);
      if (cap.dataCells !== want.dataCells || cap.usedSymbols !== want.symbols
        || cap.residualCells !== 1 || cap.maxPayloadBytes !== want.payload[i]) {
        throw new Error(`capacityC: ${spec.name}/${levels[i]} 회계가 기대표와 다르다`);
      }
      if (symbolCountForByteLength(cap.dataBytes) !== cap.dataSymbols) {
        throw new Error(`capacityC: ${spec.name}/${levels[i]} base-211 청킹 비정렬`);
      }
      const expectedBlocks = Math.ceil(cap.usedSymbols / MAX_CODEWORD_LEN);
      if (cap.rsBlockCount !== expectedBlocks || cap.minimumRsBlocks !== expectedBlocks
        || cap.rsCodewordSymbolsPerBlock.some((count) => count > MAX_CODEWORD_LEN)) {
        throw new Error(`capacityC: ${spec.name}/${levels[i]} RS 블록 경계가 표와 다르다`);
      }
    }
  }
}
