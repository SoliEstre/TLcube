// capacityA.js — Type A 버전별 용량 산출 (ADR 0005 D5·D6, capacity.js/capacityY.js 대칭)
//
// **이 모듈이 향후 SPEC 생성물 표(nsym 확정 전까지 잠정)의 소스다.** 수기로 유지
// 하지 않는다.
//
// [A-U1 — 잠정, 사용자 비준 대기] `NSYM_TABLE_A` 는 ADR 0005 D5 실계산 절차(기존
// rs211.js NSYM_TABLE 표 규칙 승계: M = round(0.25·S), 짝수면 +1 홀수화 / L =
// round(0.12·S) / H = round(0.40·S), 보정 없음)를 그대로 따른 잠정표다:
//   A1 S=89  → round(22.25)=22(짝수 → +1) = 23(25.8%)
//   A2 S=143 → round(35.75)=36(짝수 → +1) = 37(25.9%)
// 확정되면 이 주석과 함께 rs211.js NSYM_TABLE 전례처럼 사용자 확정 값으로 교체한다.
//
// 회계는 capacity.js 와 동형이다(심볼 도메인):
//   총 셀           total = (3k+1)(3k+2)/2  (D1 — 육각 3k²+3k+1 + 패치 3·k(k+1)/2)
//   오버헤드         overhead = 불스아이 19 + 포맷 15 + 앵커 6(육각3+꼭짓점3) +
//                     육각 레퍼런스 2(k−2) + 패치 레퍼런스(규칙 R, D4) — 실계산 합
//                     (k=8 → 58 · k=10 → 65, D5 검산값과 정확히 일치해야 한다)
//   데이터 심볼(셀)  C = total − overhead
//   사용 심볼        S = ⌊C / 3⌋  (잔여 셀 = C − 3S)
//   RS               S = 데이터심볼 + nsym  (nsym 은 NSYM_TABLE_A 표에서)
//   데이터 바이트     K = max{k : 211^(S−nsym) >= 2^(8k)}  (capacity.js 의
//                     `maxBytesForSymbols` 재사용 — BigInt 정확 계산, 전용 재구현 아님)
//   순 페이로드       = K − 1  (헤더 1B, header.js 승계)
//
// [D6 네임스페이스] formatIndex 12=A1 · 13=A2 · 14=A1Q · 15=A2Q(중앙 QR, +2 오프셋 —
// encodeA.js 가 centerQr 옵션으로 적용). 3·7 은 Type O V4/V4Q 예약으로 여기서
// 소진하지 않는다(D6 명시).

import { cellCount } from './hexgrid.js';
import { symbolCountForByteLength } from './base211.js';
import { maxBytesForSymbols } from './capacity.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { occupiedCells } from './bullseye.js';
import { anchorCells, formatCells, referenceCellsAll } from './placement.js';
import { vertexAnchors, patchReferenceCells } from './placementA.js';

/**
 * Type A 오버헤드 실계산(불스아이 19 + 포맷 15 + 앵커 6 + 육각 레퍼런스 2(k−2) +
 * 패치 레퍼런스). 하드코딩이 아니라 placement.js/placementA.js 실계산 합이다.
 * @param {number} k
 * @returns {{k:number, bullseye:number, anchor:number, format:number,
 *            hexReference:number, patchReference:number, total:number}}
 */
export function overheadBreakdownA(k) {
  const bullseye = occupiedCells().length; // 19 (hexDistance<=2, k 무관)
  const anchor = anchorCells(k).length + vertexAnchors(k).length; // 3 + 3 = 6
  const format = formatCells(k).length; // 15 (k 무관)
  const hexReference = referenceCellsAll(k).length; // 2(k-2)
  const patchReference = patchReferenceCells(k).length; // 규칙 R, D4
  const total = bullseye + anchor + format + hexReference + patchReference;
  return {
    k, bullseye, anchor, format, hexReference, patchReference, total,
  };
}

// ADR 0005 D5 검산값 — 58(k=8)/65(k=10). "조용히 맞추지 않는다"(과제 지침
// 절대 규칙): 모듈 로드 시점에 실계산이 검산값과 어긋나면 즉시 던진다.
for (const [k, expectedTotal] of [[8, 58], [10, 65]]) {
  const actual = overheadBreakdownA(k).total;
  if (actual !== expectedTotal) {
    throw new Error(
      `overheadBreakdownA(${k}) 실계산 불일치: ${actual} !== ADR 0005 D5 검산값 ${expectedTotal}`,
    );
  }
}

/**
 * [A-U1 잠정] Type A 사용 심볼 수 대비 ECC 레벨별 nsym 표. 산출 근거는 위 모듈
 * 헤더 주석 (ADR 0005 D5).
 * @type {Readonly<Record<string, Readonly<{symbols:number, L:number, M:number, H:number}>>>}
 */
export const NSYM_TABLE_A = Object.freeze({
  A1: Object.freeze({
    symbols: 89, L: 11, M: 23, H: 36,
  }),
  A2: Object.freeze({
    symbols: 143, L: 17, M: 37, H: 57,
  }),
});

/**
 * 버전 정의. `overhead` 는 `overheadBreakdownA(k).total` 로 유도한다(하드코딩
 * 아님). `formatIndex` 는 D6 네임스페이스(12=A1·13=A2) — centerQr(A*Q) 는
 * encodeA.js 가 +2 오프셋으로 적용한다(14=A1Q·15=A2Q).
 * @type {ReadonlyArray<{name:string, version:number, k:number, formatIndex:number, overhead:number, symbolKey:string}>}
 */
export const VERSIONS_A = Object.freeze([
  Object.freeze({
    name: 'A1', version: 1, k: 8, formatIndex: 12, overhead: overheadBreakdownA(8).total, symbolKey: 'A1',
  }),
  Object.freeze({
    name: 'A2', version: 2, k: 10, formatIndex: 13, overhead: overheadBreakdownA(10).total, symbolKey: 'A2',
  }),
]);

/**
 * version → VERSIONS_A 항목.
 * @param {number} version 1 | 2
 * @returns {{name:string, version:number, k:number, formatIndex:number, overhead:number, symbolKey:string}}
 */
export function versionSpecA(version) {
  const spec = VERSIONS_A.find((v) => v.version === version);
  if (!spec) {
    throw new RangeError(
      `알 수 없는 Type A 버전: ${version} (허용 ${VERSIONS_A.map((v) => `${v.name}(v${v.version})`).join(', ')})`,
    );
  }
  return spec;
}

/**
 * 한 버전의 용량 전체. capacity.js `capacityFor` 회계를 그대로 승계한다.
 * @param {{version:number, k:number, overhead:number, symbolKey:string}} spec
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityForA(spec, level = 'M') {
  const label = spec.name || `A${spec.version}`;
  const totalCells = (3 * spec.k + 1) * (3 * spec.k + 2) / 2;
  // hexgrid.cellCount(k) + 패치 3·k(k+1)/2 와 항등이어야 한다(placementA.test.js 가
  // 이 항등을 회귀 고정) — 여기서는 닫힌 형태로 직접 계산(D1)한다.
  const dataCells = totalCells - spec.overhead;
  if (dataCells <= 0) {
    throw new RangeError(`${label}: 오버헤드 ${spec.overhead} 가 총 셀 ${totalCells} 이상이다`);
  }

  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;

  const table = NSYM_TABLE_A[spec.symbolKey];
  if (!table) {
    throw new RangeError(`${label}: NSYM_TABLE_A 에 키 ${spec.symbolKey} 가 없다`);
  }
  if (table.symbols !== usedSymbols) {
    // 표가 전제한 심볼 수와 실계산이 어긋난다 — 조용히 맞추지 않고 던진다
    // (capacity.js `capacityFor` 와 동일한 규약 · 과제 지침 절대 규칙 6).
    throw new RangeError(
      `${label}: 실계산 사용 심볼 ${usedSymbols} 이 NSYM_TABLE_A.${spec.symbolKey}.symbols `
      + `(${table.symbols}) 과 어긋난다 — overhead(${spec.overhead})/k(${spec.k}) 와 표가 불일치한다`,
    );
  }

  const nsym = table[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError(`${label}: NSYM_TABLE_A.${spec.symbolKey} 에 레벨 ${level} 이 없다`);
  }
  const dataSymbols = usedSymbols - nsym;
  if (dataSymbols <= 0) {
    throw new RangeError(`${label}/${level}: nsym ${nsym} 이 사용 심볼 ${usedSymbols} 이상이다`);
  }

  const dataBytes = maxBytesForSymbols(dataSymbols);

  // [발견 — 검증 라운드 2026-08-09] "S개 심볼 = 하나의 큰 base-211 수" K 산정과
  // base211.js 의 27B↔28심볼 청크 인코더는 효율이 미세하게 달라, K 를 실제 청크
  // 인코딩하면 dataSymbols 와 어긋나는 조합이 존재한다(현행 표에선 A2/H 가 유일 —
  // symbolCountForByteLength(83)=87 ≠ 86). 그런 조합은 encodeA.js 자기검증이
  // throw 하므로 **생산 불가**다 — 표 소비자가 이를 정상 용량으로 게시하지 않도록
  // 플래그로 명시한다 (A-U1 비준에서 nsym 재조정 대상).
  const chunkAligned = symbolCountForByteLength(dataBytes) === dataSymbols;

  return {
    name: spec.name,
    version: spec.version,
    k: spec.k,
    formatIndex: spec.formatIndex,
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
    chunkAligned,
    maxPayloadBytes: maxPayloadFor(dataBytes),
    headerBytes: HEADER_BYTES,
  };
}

/**
 * 전 버전 용량표.
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityTableA(level = 'M') {
  return VERSIONS_A.map((v) => capacityForA(v, level));
}

/**
 * SPEC 에 붙일 마크다운 표(향후 §14 대칭 절 생성용). 단일 물결표는 쓰지 않는다
 * (규약 §6.11).
 * @param {'L'|'M'|'H'} [level]
 * @returns {string}
 */
export function renderMarkdownTableA(level = 'M') {
  const rows = capacityTableA(level);
  const head = '| 버전 | k | 총 셀 | 오버헤드 | 데이터 셀 C | 사용 심볼 S | 잔여 셀 | ECC-'
    + level + ' nsym | t | 데이터 심볼 | K | 순 페이로드 |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => `| ${r.name} | ${r.k} | ${r.totalCells} | ${r.overhead} | `
    + `${r.dataCells} | ${r.usedSymbols} | ${r.residualCells} | ${r.nsym} | ${r.errorCapacity} | `
    + `${r.dataSymbols} | ${r.dataBytes} B | **${r.maxPayloadBytes} B**`
    + `${r.chunkAligned ? '' : ' ⚠ 청킹 비정렬 — 인코딩 불가 (A-U1 재조정 대상)'} |`);
  return [head, sep, ...body].join('\n');
}

// 대조용: hexgrid.cellCount 는 육각부만(패치 미포함) 계산한다 — capacityA.test.js
// 가 "totalCells - cellCount(k) === 3*k*(k+1)/2(패치 셀 수)" 항등을 검증할 때 쓴다.
export { cellCount as hexCellCount };
