/**
 * capacityC.js — Type C(3시 노치) 버전별 셀·GF(211) 회계.
 *
 * k 단계 C0=14/C1=17/C2=20과 와이어 표는 formatC.js에서 읽는다.
 * overhead는 placement.overheadBreakdown에 노치 8셀(평 C), 또는 노치 8셀+
 * daehan 완전판의 불스아이 밖 sagoae 60셀(C*D)을 넣어 유도한다. 중앙 taegeuk
 * 19셀은 기존 bullseye 항이 이미 세므로 다시 더하지 않는다.
 *
 * C1/C2는 회계 S가 GF(211) 단일 RS 코드워드 상한 210을 넘는다. 이 모듈은 표와
 * 이론 용량을 숨기지 않되 `singleBlockEncodable:false`로 표시하며, 인코더가 호출하는
 * assertTypeCSingleBlock()은 다중 블록 규약이 없는 상태를 명시적으로 거절한다.
 */

import { capacityFor } from './capacity.js';
import { MAX_CODEWORD_LEN, NSYM_TABLE_C } from './rs211.js';
import { symbolCountForByteLength } from './base211.js';
import { overheadBreakdown } from './placement.js';
import { daehanReservedCells } from './finder-daehan.js';
import { notchCellsC, typeCReservedCells } from './notchC.js';
import { C_FORMAT_INDEX } from './formatC.js';

const NSYM_SOURCE = Object.freeze({ table: NSYM_TABLE_C, tableName: 'NSYM_TABLE_C' });

/** C1/C2 계열 공용 거절 사유. C-UI/C-DEC도 이 상수를 그대로 표시할 수 있다. */
export const TYPE_C_RS_BLOCK_UNDEFINED_REASON =
  'Type C 코드워드가 GF(211) 단일 블록 상한 210심볼을 넘지만 다중 RS 블록의 분할·패리티 배분·scan-order 매핑 규약이 정의되지 않았다';

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
 * Type C 한 행의 셀·패리티 회계. `singleBlockEncodable`은 현 rs211 구현 가능 여부이며,
 * `minimumRsBlocks`는 필요한 블록 수의 하한일 뿐 분할 규약을 주장하지 않는다.
 */
export function capacityForC(spec, level = 'M') {
  const base = capacityFor(spec, level, NSYM_SOURCE);
  return {
    ...base,
    name: spec.name,
    formatIndex: spec.formatIndex,
    notchC: true,
    daehanFinder: spec.daehanFinder === true,
    notchCount: spec.notchCount,
    finderReservedCount: spec.finderReservedCount,
    singleBlockEncodable: base.usedSymbols <= MAX_CODEWORD_LEN,
    minimumRsBlocks: Math.ceil(base.usedSymbols / MAX_CODEWORD_LEN),
  };
}

export function capacityForCDaehan(spec, level = 'M') {
  if (!spec || spec.daehanFinder !== true) {
    throw new RangeError('capacityForCDaehan은 C*D 표 항목만 받는다');
  }
  return capacityForC(spec, level);
}

/** 현재 단일 GF(211) 블록으로 실제 인코딩 가능한지 단언한다. */
export function assertTypeCSingleBlock(capacity) {
  if (!capacity || !Number.isInteger(capacity.usedSymbols)) {
    throw new TypeError('Type C 용량 객체가 필요하다');
  }
  if (capacity.usedSymbols > MAX_CODEWORD_LEN) {
    throw new RangeError(
      `${capacity.name || `C${capacity.version}`}/${capacity.level}: ${TYPE_C_RS_BLOCK_UNDEFINED_REASON} `
      + `(S=${capacity.usedSymbols}, 최소 블록 수 ${Math.ceil(capacity.usedSymbols / MAX_CODEWORD_LEN)})`,
    );
  }
  return capacity;
}

export function capacityTableC(level = 'M', options = {}) {
  const versions = options.daehanFinder === true ? VERSIONS_C_DAEHAN : VERSIONS_C;
  return versions.map((spec) => capacityForC(spec, level));
}

// 로드 자기검증 — 회계·청킹·단일블록 경계를 값으로 잠근다.
{
  const EXPECT = Object.freeze({
    C0: Object.freeze({ k: 14, overhead: 69, dataCells: 562, symbols: 187, payload: [158, 134, 107] }),
    C1: Object.freeze({ k: 17, overhead: 75, dataCells: 844, symbols: 281, payload: [237, 201, 161] }),
    C2: Object.freeze({ k: 20, overhead: 81, dataCells: 1180, symbols: 393, payload: [255, 255, 226] }),
    C0D: Object.freeze({ k: 14, overhead: 129, dataCells: 502, symbols: 167, payload: [140, 118, 95] }),
    C1D: Object.freeze({ k: 17, overhead: 135, dataCells: 784, symbols: 261, payload: [220, 188, 150] }),
    C2D: Object.freeze({ k: 20, overhead: 141, dataCells: 1120, symbols: 373, payload: [255, 255, 215] }),
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
      const shouldFit = spec.version === 0;
      if (cap.singleBlockEncodable !== shouldFit) {
        throw new Error(`capacityC: ${spec.name} 단일블록 경계가 C0/C0D 규약과 다르다`);
      }
    }
  }
}
