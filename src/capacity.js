// capacity.js — 버전별 용량 산출 (SPEC §5.5, GF(211) 심볼 회계 — ADR 0001)
//
// **SPEC §5.5 의 표는 이 모듈의 생성물이다. 수기로 유지하지 않는다.**
//
// ADR 0001 §3.3.2/§3.3.3 결정: **nsym 은 공식이 아니라 표**. `rs211.js` 가 export 하는
// `NSYM_TABLE` (2026-07-29 사용자 확정)을 그대로 입력으로 쓴다. `fitCodeword` 식 탐색과
// `forceEven` 류 플래그는 여기 두지 않는다 — 그 조합이 ADR 본문에서 비대칭 비교 사고를
// 두 번 냈다(§3.3.3).
//
// 회계는 심볼 도메인이다:
//   데이터 심볼(셀) C = 총 셀 − 오버헤드
//   사용 심볼        S = ⌊C / 3⌋   (잔여 셀 = C − 3S, 3의 배수가 안 되는 나머지 셀)
//   RS               S = 데이터심볼 + nsym  (nsym 은 NSYM_TABLE 표에서)
//   데이터 바이트     K = max{k : 211^(S−nsym) >= 2^(8k)}  (BigInt 정확 계산)
//   순 페이로드       = K − 1  (헤더 1 B, header.js 의 maxPayloadFor 와 정합)
//
// [T8 완료] `overhead` 는 더 이상 잠정 상수가 아니다 — 불스아이(§5.1)·앵커(§5.2)·
//      포맷 정보(§5.4)·레퍼런스 셀(§5.3) 배치가 전부 확정됐으므로 `placement.js` 의
//      `overheadBreakdown(k)` 실계산 합을 그대로 쓴다(구성요소별 유도, 아래 참조).

import { cellCount } from './hexgrid.js';
import { NSYM_TABLE, errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { overheadBreakdown } from './placement.js';

/**
 * 버전 정의. `overhead` 는 `placement.overheadBreakdown(k).total` 로 **유도**한다
 * (T8 이전엔 잠정 상수였다 — [P1] 이력 참조, 이제 내려감). `symbolKey` 는 `rs211.js` 의
 * `NSYM_TABLE` 조회 키.
 * @type {ReadonlyArray<{version: number, k: number, overhead: number, symbolKey: string}>}
 */
export const VERSIONS = Object.freeze([
  Object.freeze({
    version: 1, k: 6, overhead: overheadBreakdown(6).total, symbolKey: 'V1',
  }),
  Object.freeze({
    version: 2, k: 8, overhead: overheadBreakdown(8).total, symbolKey: 'V2',
  }),
  Object.freeze({
    version: 3, k: 10, overhead: overheadBreakdown(10).total, symbolKey: 'V3',
  }),
]);

/**
 * S 개의 GF(211) 심볼이 손실 없이 담는 **최대** 바이트 수 K.
 * 정의: K = max{ k : 211^S >= 2^(8k) }. BigInt 로 정확히 계산한다(부동소수 반올림 회피).
 *
 * 주의: 이것은 base211.js 의 청크 회계(27 B ↔ 28 심볼 단위)가 아니라 **RS 데이터 심볼
 * 전체를 하나의 큰 자릿수로 본 직접 부등식**이다 — ADR §3.3.2/§3.3.3 이 정의한 K 가 이 값이다.
 *
 * @param {number} symbolCount S (0 이상 정수)
 * @returns {number} K (0 이상 정수)
 */
export function maxBytesForSymbols(symbolCount) {
  if (!Number.isInteger(symbolCount) || symbolCount < 0) {
    throw new RangeError(`심볼 개수는 0 이상 정수여야 한다: ${symbolCount}`);
  }
  const cap = 211n ** BigInt(symbolCount);
  let k = 0;
  while ((1n << BigInt(8 * (k + 1))) <= cap) k += 1;
  return k;
}

/**
 * 한 버전의 용량 전체.
 * @param {{version: number, k: number, overhead: number, symbolKey: string}} spec
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityFor(spec, level = 'M') {
  const totalCells = cellCount(spec.k);
  const dataCells = totalCells - spec.overhead;
  if (dataCells <= 0) {
    throw new RangeError(`V${spec.version}: 오버헤드 ${spec.overhead} 가 총 셀 ${totalCells} 이상이다`);
  }

  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;

  const table = NSYM_TABLE[spec.symbolKey];
  if (!table) {
    throw new RangeError(`V${spec.version}: rs211.js NSYM_TABLE 에 키 ${spec.symbolKey} 가 없다`);
  }
  if (table.symbols !== usedSymbols) {
    // 표가 전제한 심볼 수와 실계산이 어긋난다 — 오버헤드·k 가 표와 따로 놀고 있다는
    // 신호다. 조용히 맞추지 않고 여기서 던진다(과제 지침 절대 규칙 6).
    throw new RangeError(
      `V${spec.version}: 실계산 사용 심볼 ${usedSymbols} 이 NSYM_TABLE.${spec.symbolKey}.symbols `
      + `(${table.symbols}) 과 어긋난다 — overhead(${spec.overhead})/k(${spec.k}) 와 표가 불일치한다`,
    );
  }

  const nsym = table[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError(`V${spec.version}: NSYM_TABLE.${spec.symbolKey} 에 레벨 ${level} 이 없다`);
  }
  const dataSymbols = usedSymbols - nsym;
  if (dataSymbols <= 0) {
    throw new RangeError(`V${spec.version}/${level}: nsym ${nsym} 이 사용 심볼 ${usedSymbols} 이상이다`);
  }

  const dataBytes = maxBytesForSymbols(dataSymbols);

  return {
    version: spec.version,
    k: spec.k,
    totalCells,
    overhead: spec.overhead,
    dataCells,
    usedSymbols,
    residualCells,
    level,
    nsym,
    errorCapacity: errorCapacity(nsym),
    dataSymbols,
    dataBytes,
    maxPayloadBytes: maxPayloadFor(dataBytes),
    headerBytes: HEADER_BYTES,
  };
}

/**
 * 전 버전 용량표.
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityTable(level = 'M') {
  return VERSIONS.map((v) => capacityFor(v, level));
}

/**
 * SPEC §5.5 에 붙일 마크다운 표. 단일 물결표는 쓰지 않는다 (규약 §6.11).
 * @param {'L'|'M'|'H'} [level]
 * @returns {string}
 */
export function renderMarkdownTable(level = 'M') {
  const rows = capacityTable(level);
  const head = '| 버전 | k | 총 셀 | 오버헤드 | 데이터 셀 C | 사용 심볼 S | 잔여 셀 | ECC-'
    + level + ' nsym | t | 데이터 심볼 | K | 순 페이로드 |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => `| V${r.version} | ${r.k} | ${r.totalCells} | ${r.overhead} | `
    + `${r.dataCells} | ${r.usedSymbols} | ${r.residualCells} | ${r.nsym} | ${r.errorCapacity} | `
    + `${r.dataSymbols} | ${r.dataBytes} B | **${r.maxPayloadBytes} B** |`);
  return [head, sep, ...body].join('\n');
}
