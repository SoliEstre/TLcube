// capacityK.js — Type K(육각별) 버전별 용량 산출 (계약 claude-k-contract.md K-6,
// capacityA.js 대칭 — Wave 3 ② 레인 K)
//
// **이 모듈이 SPEC 증보(통합자 몫)용 표의 소스다.** 수기로 유지하지 않는다.
//
// 회계는 capacity.js/capacityA.js 와 동형이다(심볼 도메인):
//   총 셀           total = 6k² + 6k + 1  (계약 K-1 — 코어 3k²+3k+1 + 패치 6·k(k+1)/2)
//   오버헤드         overhead = 불스아이 19 + 앵커 9(육각3 + 별 꼭짓점6) + 포맷 15 +
//                     육각 레퍼런스 2(k−2) + 패치 레퍼런스(규칙 R′ — 실계산 합)
//   데이터 심볼(셀)  C = total − overhead · 사용 심볼 S = ⌊C/3⌋ · 잔여 = C − 3S
//   RS               nsym 은 NSYM_TABLE_K 표에서 · 데이터 바이트 = maxBytesForSymbols
//   순 페이로드       = K − 1 (헤더 1B)
//
// [NSYM_TABLE_K 산출 근거 — A-U1 절차 승계 (ADR 0005 D5 표 규칙)]
//   M = round(0.25·S), 짝수면 +1 홀수화 · L = round(0.12·S) · H = round(0.40·S).
//   실측 (2026-08-25, k-probe1.mjs — 전 조합 청크 정렬 검사):
//     K0 S=63  → L 8 · M 17 · H 25            (전부 정렬)
//     K1 S=122 → L 15 · M 31 · H 49           (전부 정렬)
//     K2 S=194 → L 26(**절차값 23 대체**) · M 49 · H 78
//   K2/L 만 절차값 23 이 base-211 청킹 비정렬이라 **26** 으로 대체했다 — 정렬 ·
//   t 불감소(11→13, daehan A2D/M 전례 «t 를 줄이지 않는다») · 절차 최근접(위쪽 최소)
//   3조건 동시 만족. 24·25 는 비정렬이라 후보가 아니다 (A2/H 57→59 와 같은 꼴).
//
// [계약 K-6 대비 이탈 — 보고서 §계약 대비] K-6 의 k∈{6,8,10} 행은 패치 레퍼런스를
// 「A 링 목록 × 6패치 = 18/24/36」로 **가정**했지만(스스로 «추정» 표기), K-3 규칙
// R′ 의 실계산은 링당 6셀 = **12/12/18** 이다. K-3 이 규범이고 이 모듈은 실계산을
// 따른다. k=4 검산(총 121 = 코어 61 + 패치 6×10)은 계약과 일치한다 — 아래 자기검증.
//
// formatIndex 는 **star 축 독립 표**(src/formatK.js — 전 버전 7, k 로 가른다)에서
// 읽는다. hex·tri 축과 (값,k) 충돌이 없음은 formatK.js 로드 자기검증이 잰다.

import { cellCount } from './hexgrid.js';
import { symbolCountForByteLength } from './base211.js';
import { maxBytesForSymbols } from './capacity.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { occupiedCells } from './bullseye.js';
import { anchorCells, formatCells, referenceCellsAll } from './placement.js';
import { vertexAnchorsK, patchReferenceCellsK, regionCellsK } from './placementK.js';
import { kFormatSpec } from './formatK.js';

/**
 * Type K 오버헤드 실계산 — 하드코딩이 아니라 placement.js/placementK.js 실계산 합.
 * @param {number} k
 * @returns {{k:number, bullseye:number, anchor:number, format:number,
 *            hexReference:number, patchReference:number, total:number}}
 */
export function overheadBreakdownK(k) {
  const bullseye = occupiedCells().length; // 19 (hexDistance<=2, k 무관)
  const anchor = anchorCells(k).length + vertexAnchorsK(k).length; // 3 + 6 = 9
  const format = formatCells(k).length; // 15 (k 무관)
  const hexReference = referenceCellsAll(k).length; // 2(k-2)
  const patchReference = patchReferenceCellsK(k).length; // 규칙 R′ — 링당 6
  const total = bullseye + anchor + format + hexReference + patchReference;
  return {
    k, bullseye, anchor, format, hexReference, patchReference, total,
  };
}

// 검산값 (2026-08-25 실측 — k-probe1.mjs): 63(k=6) / 67(k=8) / 77(k=10).
// "조용히 맞추지 않는다": 모듈 로드 시점에 실계산이 검산값과 어긋나면 즉시 던진다.
for (const [k, expectedTotal] of [[6, 63], [8, 67], [10, 77]]) {
  const actual = overheadBreakdownK(k).total;
  if (actual !== expectedTotal) {
    throw new Error(
      `overheadBreakdownK(${k}) 실계산 불일치: ${actual} !== 검산값 ${expectedTotal}`,
    );
  }
}

/**
 * Type K 사용 심볼 수 대비 ECC 레벨별 nsym 표 — 산출 근거는 모듈 헤더.
 * @type {Readonly<Record<string, Readonly<{symbols:number, L:number, M:number, H:number}>>>}
 */
export const NSYM_TABLE_K = Object.freeze({
  K0: Object.freeze({
    symbols: 63, L: 8, M: 17, H: 25,
  }),
  K1: Object.freeze({
    symbols: 122, L: 15, M: 31, H: 49,
  }),
  K2: Object.freeze({
    symbols: 194, L: 26, M: 49, H: 78, // L: 절차값 23 은 청크 비정렬 — 헤더 §근거
  }),
});

/**
 * 버전 정의. overhead 는 overheadBreakdownK(k).total 로 유도(하드코딩 아님),
 * formatIndex 는 star 축 표(formatK.js)에서 읽는다.
 * 배열 순서는 **용량 오름차순** — chooseVersionK 가 앞에서부터 훑는다.
 * @type {ReadonlyArray<{name:string, version:number, k:number, formatIndex:number, overhead:number, symbolKey:string}>}
 */
export const VERSIONS_K = Object.freeze([0, 1, 2].map((version) => {
  const format = kFormatSpec(version);
  return Object.freeze({
    name: format.name,
    version,
    k: format.k,
    formatIndex: format.formatIndex,
    overhead: overheadBreakdownK(format.k).total,
    symbolKey: format.name,
  });
}));

/**
 * version → VERSIONS_K 항목.
 * @param {number} version 0 | 1 | 2
 */
export function versionSpecK(version) {
  const spec = VERSIONS_K.find((entry) => entry.version === version);
  if (!spec) {
    throw new RangeError(
      `알 수 없는 Type K 버전: ${version} (허용 ${VERSIONS_K.map((v) => `${v.name}(v${v.version})`).join(', ')})`,
    );
  }
  return spec;
}

/**
 * 한 버전의 용량 전체. capacityA.js `capacityForA` 회계를 그대로 승계한다.
 * @param {{name?:string, version:number, k:number, overhead:number, symbolKey:string, formatIndex:number}} spec
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityForK(spec, level = 'M') {
  const label = spec.name || `K${spec.version}`;
  const totalCells = 6 * spec.k * spec.k + 6 * spec.k + 1;
  const dataCells = totalCells - spec.overhead;
  if (dataCells <= 0) {
    throw new RangeError(`${label}: 오버헤드 ${spec.overhead} 가 총 셀 ${totalCells} 이상이다`);
  }

  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;

  const table = NSYM_TABLE_K[spec.symbolKey];
  if (!table) {
    throw new RangeError(`${label}: NSYM_TABLE_K 에 키 ${spec.symbolKey} 가 없다`);
  }
  if (table.symbols !== usedSymbols) {
    // 표가 전제한 심볼 수와 실계산이 어긋난다 — 조용히 맞추지 않고 던진다.
    throw new RangeError(
      `${label}: 실계산 사용 심볼 ${usedSymbols} 이 NSYM_TABLE_K.${spec.symbolKey}.symbols `
      + `(${table.symbols}) 과 어긋난다 — overhead(${spec.overhead})/k(${spec.k}) 와 표가 불일치한다`,
    );
  }

  const nsym = table[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError(`${label}: NSYM_TABLE_K.${spec.symbolKey} 에 레벨 ${level} 이 없다`);
  }
  const dataSymbols = usedSymbols - nsym;
  if (dataSymbols <= 0) {
    throw new RangeError(`${label}/${level}: nsym ${nsym} 이 사용 심볼 ${usedSymbols} 이상이다`);
  }

  const dataBytes = maxBytesForSymbols(dataSymbols);
  // A-U1 가드 승계 — 청크 비정렬 조합은 encodeK 자기검증이 던지므로 생산 불가.
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
export function capacityTableK(level = 'M') {
  return VERSIONS_K.map((v) => capacityForK(v, level));
}

/**
 * SPEC 증보(통합자 몫)용 마크다운 표. 단일 물결표는 쓰지 않는다 (규약 §6.11).
 * @param {'L'|'M'|'H'} [level]
 */
export function renderMarkdownTableK(level = 'M') {
  const rows = capacityTableK(level);
  const head = '| 버전 | k | 총 셀 | 오버헤드 | 데이터 셀 C | 사용 심볼 S | 잔여 셀 | ECC-'
    + level + ' nsym | t | 데이터 심볼 | K | 순 페이로드 |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => `| ${r.name} | ${r.k} | ${r.totalCells} | ${r.overhead} | `
    + `${r.dataCells} | ${r.usedSymbols} | ${r.residualCells} | ${r.nsym} | ${r.errorCapacity} | `
    + `${r.dataSymbols} | ${r.dataBytes} B | **${r.maxPayloadBytes} B**`
    + `${r.chunkAligned ? '' : ' ⚠ 청킹 비정렬 — 인코딩 불가 (nsym 재조정 필요)'} |`);
  return [head, sep, ...body].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 로드 시점 자기검증 — 확정 수치(2026-08-25 실측)와 청크 정렬을 못 박는다
// (capacityA daehan EXPECT 블록 전례). 계약 K-1 의 k=4 총 셀 검산(121 = 61 + 6×10)
// 은 placementK 자기검증(6k²+6k+1)이 이미 덮지만, «코어+패치» 분해를 여기서 한 번 더.
// ─────────────────────────────────────────────────────────────────────────────
{
  if (regionCellsK(4).length !== 121 || cellCount(4) !== 61) {
    throw new Error('capacityK: 계약 K-1 k=4 검산(총 121 · 코어 61) 실패');
  }
  const EXPECT = {
    K0: { k: 6, overhead: 63, dataCells: 190, symbols: 63, residual: 1, payload: { L: 52, M: 43, H: 35 } },
    K1: { k: 8, overhead: 67, dataCells: 366, symbols: 122, residual: 0, payload: { L: 102, M: 86, H: 69 } },
    K2: { k: 10, overhead: 77, dataCells: 584, symbols: 194, residual: 2, payload: { L: 161, M: 138, H: 110 } },
  };
  for (const spec of VERSIONS_K) {
    const want = EXPECT[spec.name];
    if (!want) throw new Error('capacityK: 기대표에 없는 키 ' + spec.name);
    if (spec.k !== want.k || spec.overhead !== want.overhead) {
      throw new Error(spec.name + ': k/오버헤드가 확정값과 다르다 — k=' + spec.k
        + ' overhead=' + spec.overhead);
    }
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForK(spec, level);
      if (cap.dataCells !== want.dataCells || cap.usedSymbols !== want.symbols
        || cap.residualCells !== want.residual) {
        throw new Error(spec.name + '/' + level + ': 데이터 셀·심볼·잔여가 확정값과 다르다');
      }
      if (cap.maxPayloadBytes !== want.payload[level]) {
        throw new Error(spec.name + '/' + level + ': 순 페이로드 ' + cap.maxPayloadBytes
          + ' B 가 확정값 ' + want.payload[level] + ' B 와 다르다');
      }
      if (cap.chunkAligned !== true) {
        throw new Error(spec.name + '/' + level + ': 청크 비정렬 — 생산 불가');
      }
    }
  }
}
