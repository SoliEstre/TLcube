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
import { overheadBreakdown, ANCHOR_SET_B_RADII, buildRoleSets } from './placement.js';
import { hexDistance } from './hexgrid.js';
import { daehanReservedCells } from './finder-daehan.js';
import { notchCellsC, typeCReservedCells } from './notchC.js';
import { C_FORMAT_INDEX, TYPE_C_RADII } from './formatC.js';

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
  // 노치 v2 (3줄 슬롯, 3k−22셀) × 4단 사다리 재유도값 — 2026-08-30.
  // 유도: .agent/scratch/derive-ladder4.mjs. 잔여 셀은 k mod 3 부류가 결정한다
  // (k≡2→1 · k≡1→0 · k≡0→2) — 엔진은 잔여를 일반 처리하고 이 표가 행별로 잠근다.
  const EXPECT = Object.freeze({
    C0: Object.freeze({ k: 14, overhead: 81, dataCells: 550, symbols: 183, residual: 1, payload: [154, 130, 105] }),
    C1: Object.freeze({ k: 16, overhead: 91, dataCells: 726, symbols: 242, residual: 0, payload: [203, 172, 139] }),
    C2: Object.freeze({ k: 18, overhead: 101, dataCells: 926, symbols: 308, residual: 2, payload: [255, 220, 176] }),
    C3: Object.freeze({ k: 20, overhead: 111, dataCells: 1150, symbols: 383, residual: 1, payload: [255, 255, 223] }),
    C0D: Object.freeze({ k: 14, overhead: 141, dataCells: 490, symbols: 163, residual: 1, payload: [137, 116, 93] }),
    C1D: Object.freeze({ k: 16, overhead: 151, dataCells: 666, symbols: 222, residual: 0, payload: [188, 157, 128] }),
    C2D: Object.freeze({ k: 18, overhead: 161, dataCells: 866, symbols: 288, residual: 2, payload: [240, 205, 166] }),
    C3D: Object.freeze({ k: 20, overhead: 171, dataCells: 1090, symbols: 363, residual: 1, payload: [255, 255, 208] }),
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
        || cap.residualCells !== want.residual || cap.maxPayloadBytes !== want.payload[i]) {
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

  // 노치 v2 구조 계약 (2026-08-30):
  // ① 앵커 세트 B 반경 목록은 placement.js 의 사본이다 — 정본(TYPE_C_RADII)과의
  //    일치를 여기서 잠근다 (placement → formatC import 는 순환이라 불가).
  if (ANCHOR_SET_B_RADII.length !== TYPE_C_RADII.length
    || ANCHOR_SET_B_RADII.some((k, i) => k !== TYPE_C_RADII[i])) {
    throw new Error('capacityC: placement.ANCHOR_SET_B_RADII 가 formatC.TYPE_C_RADII 와 다르다');
  }
  // ② 노치는 순수 데이터 영역만 판다 — 앵커(세트 B)·포맷·레퍼런스·불스아이와
  //    서로소. 겹치면 overheadBreakdown 의 단순 합산이 이중 계상이 된다.
  for (const k of TYPE_C_RADII) {
    const roles = buildRoleSets(k, []);
    for (const cell of notchCellsC(k)) {
      const cellK = `${cell.q},${cell.r}`;
      if (hexDistance(cell.q, cell.r) <= 2
        || roles.anchor.has(cellK) || roles.format.has(cellK) || roles.reference.has(cellK)) {
        throw new Error(`capacityC: k=${k} 노치 셀 ${cellK} 이 비데이터 역할을 침범한다`);
      }
    }
  }
}
