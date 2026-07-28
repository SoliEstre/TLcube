// capacity.js — 버전별 용량 산출 (SPEC §5.5)
//
// **SPEC §5.5 의 표는 이 모듈의 생성물이다. 수기로 유지하지 않는다.**
//
// 이유: V1 은 필러 여유가 3, V2·V3 는 1 뿐이다. 불스아이나 레퍼런스가 한 셀만 늘어도
// 표가 조용히 틀려진다. 수기 표는 그 사실을 알려주지 않지만, 스냅샷 테스트는 시끄럽게
// 깨진다 — "조용히 틀림" 을 "테스트가 깨짐" 으로 바꾸는 것이 이 모듈의 목적이다.
//
// [P1] `overhead` 는 지금 **잠정 상수**다. 불스아이 형상(§5.1)·레퍼런스 배치(§5.3)·
//      포맷 정보 배치(§5.4)가 확정되면 layout.js 가 구성요소 합으로 계산해 여기 넣는다.
//      그때 스냅샷이 깨지는 것이 **정상**이고, 깨진 값을 확인 후 갱신하는 것이 절차다.
//
// [P2] 코드워드 크기는 자유 파라미터가 아니라 **유도값**이다. 데이터 심볼 용량 C 에
//      대해 D(코드워드 바이트) <= C 를 만족하는 최대 페이로드를 찾는다. RS 패리티가
//      데이터 길이에 의존하므로(nsymForLevel) 단순 나눗셈이 아니라 탐색이 필요하다.

import { cellCount } from './hexgrid.js';
import { digitCountForByteLength } from './base6.js';
import { nsymForLevel, errorCapacity } from './rs.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';

/**
 * 버전 정의. `overhead` 는 잠정 — [P1] 참조.
 * @type {ReadonlyArray<{version: number, k: number, overhead: number, provisional: boolean}>}
 */
export const VERSIONS = Object.freeze([
  Object.freeze({ version: 1, k: 6, overhead: 45, provisional: true }),
  Object.freeze({ version: 2, k: 8, overhead: 50, provisional: true }),
  Object.freeze({ version: 3, k: 10, overhead: 55, provisional: true }),
]);

/**
 * 데이터 심볼 용량 C 안에 들어가는 **최대 코드워드**를 찾는다.
 *
 * 조건: digitCountForByteLength(dataBytes + nsym) <= C
 * nsym 이 dataBytes 에 의존하므로 아래에서 위로 훑는다 (C <= 331 이라 비용은 무시 가능).
 *
 * @param {number} dataSymbols 데이터 심볼 용량 C (셀 개수)
 * @param {'L'|'M'|'H'} level
 * @returns {{dataBytes: number, nsym: number, codewordBytes: number, digits: number}}
 */
export function fitCodeword(dataSymbols, level) {
  let best = { dataBytes: 0, nsym: 0, codewordBytes: 0, digits: 0 };
  for (let dataBytes = 1; dataBytes <= 255; dataBytes += 1) {
    const nsym = nsymForLevel(dataBytes, level);
    const codewordBytes = dataBytes + nsym;
    if (codewordBytes > 255) break;                    // RS 코드워드 상한
    const digits = digitCountForByteLength(codewordBytes);
    if (digits > dataSymbols) break;                   // 단조 증가라 여기서 멈춰도 안전
    best = { dataBytes, nsym, codewordBytes, digits };
  }
  return best;
}

/**
 * 한 버전의 용량 전체.
 * @param {{version: number, k: number, overhead: number}} spec
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityFor(spec, level = 'M') {
  const totalCells = cellCount(spec.k);
  const dataSymbols = totalCells - spec.overhead;
  if (dataSymbols <= 0) {
    throw new RangeError(`V${spec.version}: 오버헤드 ${spec.overhead} 가 총 셀 ${totalCells} 이상이다`);
  }
  const fit = fitCodeword(dataSymbols, level);
  return {
    version: spec.version,
    k: spec.k,
    totalCells,
    overhead: spec.overhead,
    dataSymbols,
    level,
    dataBytes: fit.dataBytes,
    nsym: fit.nsym,
    errorCapacity: errorCapacity(fit.nsym),
    codewordBytes: fit.codewordBytes,
    codewordDigits: fit.digits,
    filler: dataSymbols - fit.digits,
    maxPayloadBytes: maxPayloadFor(fit.dataBytes),
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
  const head = '| 버전 | k | 총 셀 | 오버헤드 | 데이터 심볼 C | 코드워드 | 코드워드 digit D | 필러 C−D | ECC-'
    + level + ' 순 페이로드 |';
  const sep = '|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => `| V${r.version} | ${r.k} | ${r.totalCells} | ${r.overhead} | `
    + `${r.dataSymbols} | ${r.codewordBytes} B | ${r.codewordDigits} | ${r.filler} | `
    + `**${r.maxPayloadBytes} B** |`);
  return [head, sep, ...body].join('\n');
}
