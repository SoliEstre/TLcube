// capacityA.js — Type A 버전별 용량 산출 (ADR 0005 D5·D6, capacity.js/capacityY.js 대칭)
//
// **이 모듈이 SPEC 생성물 표의 소스다.** 수기로 유지
// 하지 않는다.
//
// [A-U1 ✅ 확정 — 사용자 비준 2026-08-09, hb-20260809-tlrat1] `NSYM_TABLE_A` 는
// ADR 0005 D5 실계산 절차(기존 rs211.js NSYM_TABLE 표 규칙 승계: M = round(0.25·S),
// 짝수면 +1 홀수화 / L = round(0.12·S) / H = round(0.40·S))를 따르되, **A2/H 만
// 절차값 57 대신 59** 다 — 57·58 은 base-211 청킹 비정렬로 생성 불가(아래 chunkAligned
// 참조), 59 는 정렬·홀수·절차 최근접(|59−57.2|=1.8) 3조건 동시 만족 (비준 확정값):
//   A0 S=45  → L 5 · M 11 (24.4%) · H 18   [ADR 0006 D6, 2026-08-09 비준]
//   A1 S=89  → L 11 · M 23 (25.8%) · H 36
//   A2 S=143 → L 17 · M 37 (25.9%) · H 59 (41.3% — 절차값 57 은 비정렬로 대체)
//
// [ADR 0006 D6 — A0 변 스크레이프 딱지] A0(k=6) 는 변 하나(각 19셀 = 3k+1)가 통째로
// 소실되면 터치 RS 심볼이 **9/8/10** (R/B/L 변)이라 **t(H)=9 로도 L 변을 못 산다** —
// 어떤 ECC 레벨도 변 전체 소실을 오류-전용 복호로 보장하지 못한다. H 강제의 유일한
// 명분이 변 방어인데 그걸 못 사면서 순 페이로드만 31→25 B 로 과세하므로 **기본 M 유지**
// (A1 전례 승계). 소거 회계로는 e ≤ nsym 이라 M(11) ≥ 10 — **P4(소거 복호) 구현이
// A0 변 방어의 전제 조건**이다. M1-A 결합 스윕에 A0 를 포함한다.
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
// [ADR 0006 D3 네임스페이스 — 2026-08-09 비준] formatIndex 는 **tri 패밀리 표**의
// 값이다(4bit 는 격자 수립 경로별 독립 표). 1=A0 · 12=A1 · 13=A2, 중앙 QR 변형은
// +2 오프셋으로 3=A0Q · 14=A1Q · 15=A2Q (encodeA.js 가 centerQr 옵션으로 적용).
//
// **A0 가 0 이 아닌 이유 (설계 불변식)**: tri 는 hex 코어를 좌표까지 그대로 포함
// 한다(`dataCellsInScanOrder(6)` 82셀 == `dataCellsInScanOrderA(6)` 접두). 그래서
// A0(k=6) 를 hex 표의 k=6 값에 배정하면 삼각 패치가 마모·가림됐을 때 hex 로 오판된
// 가설이 격자·앵커·포맷·CRC·인덱스를 전부 "정상 V1"으로 통과시키고 페이로드를 그대로
// 읽는다 — 완전 도플갱어 (몬테카를로 실측 오수락 2.7e-5/L, 설계 불변식 10⁻²⁰ 대비
// 15자릿수 위반). ADR 0006 D3 축 분리 검사: **격자 파라미터 k 가 반드시 달라야 한다**
// (k 가 다르면 샘플링 격자 자체가 어긋나 구조적으로 실패). hex 에서 k=6 인 값은
// **0(V1)·4(V1Q) 둘뿐**이고, +2 쌍 불변식을 지키는 최저 안전쌍이 **1·3** 이다.
// 파인더 종류(불스아이 vs 중앙 QR) 상이는 **단독 근거로 쓰지 않는다** — centerQr 은
// 셀 기하를 전혀 안 바꾸므로(19셀 슬롯 동일) 디코더의 명시적 비교에만 의존한다.

import { cellCount } from './hexgrid.js';
import { symbolCountForByteLength } from './base211.js';
import { maxBytesForSymbols } from './capacity.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { occupiedCells } from './bullseye.js';
import { anchorCells, formatCells, referenceCellsAll } from './placement.js';
import { vertexAnchors, patchReferenceCells } from './placementA.js';
import { daehanReservedCells } from './finder-daehan.js';

/**
 * Type A 오버헤드 실계산(불스아이 19 + 포맷 15 + 앵커 6 + 육각 레퍼런스 2(k−2) +
 * 패치 레퍼런스). 하드코딩이 아니라 placement.js/placementA.js 실계산 합이다.
 * @param {number} k
 * @param {number} [finderReservedCount=0] 불스아이 밖 파인더 예약 셀 수 (daehan).
 *   기본 0 — 인자를 안 넘기면 예전 54/58/65 그대로다.
 * @returns {{k:number, bullseye:number, anchor:number, format:number,
 *            hexReference:number, patchReference:number, finder:number, total:number}}
 */
export function overheadBreakdownA(k, finderReservedCount = 0) {
  if (!Number.isInteger(finderReservedCount) || finderReservedCount < 0) {
    throw new RangeError('파인더 예약 셀 수는 0 이상 정수여야 한다: ' + finderReservedCount);
  }
  const bullseye = occupiedCells().length; // 19 (hexDistance<=2, k 무관)
  const anchor = anchorCells(k).length + vertexAnchors(k).length; // 3 + 3 = 6
  const format = formatCells(k).length; // 15 (k 무관)
  const hexReference = referenceCellsAll(k).length; // 2(k-2)
  const patchReference = patchReferenceCells(k).length; // 규칙 R, D4
  const total = bullseye + anchor + format + hexReference + patchReference + finderReservedCount;
  return {
    k, bullseye, anchor, format, hexReference, patchReference,
    finder: finderReservedCount, total,
  };
}

// ADR 0005 D5 검산값 — 58(k=8)/65(k=10) · ADR 0006 D6 검산값 — 54(k=6).
// "조용히 맞추지 않는다"(과제 지침 절대 규칙): 모듈 로드 시점에 실계산이 검산값과
// 어긋나면 즉시 던진다.
for (const [k, expectedTotal] of [[6, 54], [8, 58], [10, 65]]) {
  const actual = overheadBreakdownA(k).total;
  if (actual !== expectedTotal) {
    throw new Error(
      `overheadBreakdownA(${k}) 실계산 불일치: ${actual} !== ADR 0005 D5 검산값 ${expectedTotal}`,
    );
  }
}

/**
 * [A-U1 ✅ 확정] Type A 사용 심볼 수 대비 ECC 레벨별 nsym 표 (사용자 비준
 * 2026-08-09). 산출 근거는 위 모듈 헤더 주석 (ADR 0005 D5).
 * @type {Readonly<Record<string, Readonly<{symbols:number, L:number, M:number, H:number}>>>}
 */
export const NSYM_TABLE_A = Object.freeze({
  A0: Object.freeze({
    symbols: 45, L: 5, M: 11, H: 18,
  }),
  A1: Object.freeze({
    symbols: 89, L: 11, M: 23, H: 36,
  }),
  A2: Object.freeze({
    symbols: 143, L: 17, M: 37, H: 59,
  }),
});

/**
 * 버전 정의. `overhead` 는 `overheadBreakdownA(k).total` 로 유도한다(하드코딩
 * 아님). `formatIndex` 는 tri 패밀리 표(1=A0·12=A1·13=A2, ADR 0006 D3) —
 * centerQr(A*Q) 는 encodeA.js 가 +2 오프셋으로 적용한다(3=A0Q·14=A1Q·15=A2Q).
 *
 * 배열 순서는 **용량 오름차순** — `chooseVersionA` 가 앞에서부터 훑어 최소 버전을
 * 고르므로 A0 가 선두여야 한다.
 * @type {ReadonlyArray<{name:string, version:number, k:number, formatIndex:number, overhead:number, symbolKey:string}>}
 */
export const VERSIONS_A = Object.freeze([
  Object.freeze({
    name: 'A0', version: 0, k: 6, formatIndex: 1, overhead: overheadBreakdownA(6).total, symbolKey: 'A0',
  }),
  Object.freeze({
    name: 'A1', version: 1, k: 8, formatIndex: 12, overhead: overheadBreakdownA(8).total, symbolKey: 'A1',
  }),
  Object.freeze({
    name: 'A2', version: 2, k: 10, formatIndex: 13, overhead: overheadBreakdownA(10).total, symbolKey: 'A2',
  }),
]);

/**
 * version → VERSIONS_A 항목.
 * @param {number} version 0 | 1 | 2
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
export function capacityForA(spec, level = 'M', nsymTable = NSYM_TABLE_A) {
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

  const table = nsymTable[spec.symbolKey];
  const tableName = nsymTable === NSYM_TABLE_A_DAEHAN ? 'NSYM_TABLE_A_DAEHAN' : 'NSYM_TABLE_A';
  if (!table) {
    throw new RangeError(`${label}: ${tableName} 에 키 ${spec.symbolKey} 가 없다`);
  }
  if (table.symbols !== usedSymbols) {
    // 표가 전제한 심볼 수와 실계산이 어긋난다 — 조용히 맞추지 않고 던진다
    // (capacity.js `capacityFor` 와 동일한 규약 · 과제 지침 절대 규칙 6).
    throw new RangeError(
      `${label}: 실계산 사용 심볼 ${usedSymbols} 이 ${tableName}.${spec.symbolKey}.symbols `
      + `(${table.symbols}) 과 어긋난다 — overhead(${spec.overhead})/k(${spec.k}) 와 표가 불일치한다`,
    );
  }

  const nsym = table[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError(`${label}: ${tableName}.${spec.symbolKey} 에 레벨 ${level} 이 없다`);
  }
  const dataSymbols = usedSymbols - nsym;
  if (dataSymbols <= 0) {
    throw new RangeError(`${label}/${level}: nsym ${nsym} 이 사용 심볼 ${usedSymbols} 이상이다`);
  }

  const dataBytes = maxBytesForSymbols(dataSymbols);

  // [발견 — 검증 라운드 2026-08-09] "S개 심볼 = 하나의 큰 base-211 수" K 산정과
  // base211.js 의 27B↔28심볼 청크 인코더는 효율이 미세하게 달라, K 를 실제 청크
  // 인코딩하면 dataSymbols 와 어긋나는 조합이 존재할 수 있다 (구 A2/H=57 이 그랬고,
  // A-U1 비준으로 59 로 교체해 현행 표는 전 조합 정렬이다). 그런 조합은 encodeA.js
  // 자기검증이 throw 하므로 **생산 불가**다 — 표가 미래에 다시 어긋나면 소비자가
  // 정상 용량으로 게시하지 않도록 플래그를 유지한다 (가드).
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
 * Type A + daehan nsym 표.
 *
 * O daehan 과 같은 정책: **절대 정정능력(부모 버전의 nsym)을 승계**한다.
 * A0D/A1D 는 부모 값 그대로 청크 정렬이다. A2D/M 만 부모 37 이 비정렬이라
 * A2/H 전례(57→59, +2 · 홀수)를 따라 **39** 로 올렸다 — t 를 줄이지 않는다.
 * 실측 (2026-08-19, measure-daehan-a.mjs): A0D 38심볼 · A1D 75 · A2D 123.
 */
export const NSYM_TABLE_A_DAEHAN = Object.freeze({
  A0D: Object.freeze({ symbols: 38, L: 5, M: 11, H: 18 }),
  A1D: Object.freeze({ symbols: 75, L: 11, M: 23, H: 36 }),
  A2D: Object.freeze({ symbols: 123, L: 17, M: 39, H: 59 }),
});

/**
 * Type A daehan 버전. formatIndex 는 레거시 A 와 같다 (전용 와이어를 안 만든다 —
 * O daehan `capacityDaehan.js` 헤더 §와이어와 같은 계약). version 도 A0/A1/A2 의
 * 0/1/2 를 공유하므로 **이 배열을 VERSIONS_A 와 합치면 안 된다.**
 */
export const VERSIONS_A_DAEHAN = Object.freeze([
  Object.freeze({
    name: 'A0D', version: 0, k: 6, formatIndex: 1,
    overhead: overheadBreakdownA(6, daehanReservedCells(6).length).total,
    symbolKey: 'A0D',
  }),
  Object.freeze({
    name: 'A1D', version: 1, k: 8, formatIndex: 12,
    overhead: overheadBreakdownA(8, daehanReservedCells(8).length).total,
    symbolKey: 'A1D',
  }),
  Object.freeze({
    name: 'A2D', version: 2, k: 10, formatIndex: 13,
    overhead: overheadBreakdownA(10, daehanReservedCells(10).length).total,
    symbolKey: 'A2D',
  }),
]);

export function capacityForADaehan(spec, level = 'M') {
  const base = capacityForA(spec, level, NSYM_TABLE_A_DAEHAN);
  return { ...base, daehanFinder: true };
}

export function capacityTableADaehan(level = 'M') {
  return VERSIONS_A_DAEHAN.map((v) => capacityForADaehan(v, level));
}

{
  const EXPECT = {
    A0D: { k: 6, overhead: 74, dataCells: 116, symbols: 38, payload: { L: 30, M: 25, H: 18 } },
    A1D: { k: 8, overhead: 98, dataCells: 227, symbols: 75, payload: { L: 60, M: 49, H: 36 } },
    A2D: { k: 10, overhead: 125, dataCells: 371, symbols: 123, payload: { L: 101, M: 80, H: 60 } },
  };
  for (const spec of VERSIONS_A_DAEHAN) {
    const want = EXPECT[spec.name];
    if (!want) throw new Error('capacityA daehan: 기대표에 없는 키 ' + spec.name);
    if (spec.k !== want.k || spec.overhead !== want.overhead) {
      throw new Error(spec.name + ': k/오버헤드가 확정값과 다르다 — k=' + spec.k
        + ' overhead=' + spec.overhead);
    }
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForADaehan(spec, level);
      if (cap.dataCells !== want.dataCells || cap.usedSymbols !== want.symbols) {
        throw new Error(spec.name + '/' + level + ': 데이터 셀·심볼이 확정값과 다르다');
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
    + `${r.chunkAligned ? '' : ' ⚠ 청킹 비정렬 — 인코딩 불가 (nsym 재조정 필요)'} |`);
  return [head, sep, ...body].join('\n');
}

// 대조용: hexgrid.cellCount 는 육각부만(패치 미포함) 계산한다 — capacityA.test.js
// 가 "totalCells - cellCount(k) === 3*k*(k+1)/2(패치 셀 수)" 항등을 검증할 때 쓴다.
export { cellCount as hexCellCount };
