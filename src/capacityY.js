// capacityY.js — Type Y 버전별 용량 산출 (SPEC §14, ADR 0003 D7·U3·U9·v3.1§4b — capacity.js 대칭)
//
// **이 모듈이 SPEC §14 생성물 표(nsym 확정 전까지 잠정)의 소스다.** 수기로 유지하지
// 않는다.
//
// [v3.1 §4b 2톤 메인 전환] VERSIONS_Y 는 이제 4항목이다 — n=21·25 각각에 톤 모드
// (tones=2 2톤 메인 · tones=3 Y-T 옵션)가 곱해진다. **용량 회계는 tones 무관 동일**
// (동일 base-6 심볼 알파벳 — 오버헤드·NSYM_TABLE_Y·페이로드 전부 n 에만 의존, tones
// 는 digit→면 매핑(sceneY.js/tonemap.js/verifyY.js)만 바꾼다). 그래서 Y1 과 Y1T,
// Y2 와 Y2T 는 formatIndex 만 다르고 나머지 용량 수치는 항상 완전히 같다 — 이 항등을
// capacityY.test.js 가 회귀로 고정한다.
//
// [U3 — 잠정, 사용자 확정 대기] `NSYM_TABLE_Y` 는 Type O V3 전례(ADR 0001 §3.3.3: 오정정
// 검출 여유 +1 로 홀수 nsym)를 따라 산출한 잠정표다. 절차 (재현 가능 — 검증 라운드 정정):
// **M = Math.round(0.25·S) (JS half-up), 결과가 짝수면 +1 홀수화 (홀수면 유지)**:
//   Y1 S=138 → round(34.5) = 35 (홀수 → 유지)
//   Y2 S=199 → round(49.75) = 50 (짝수 → +1) = 51
// L = round(0.12·S), H = round(0.40·S) (반올림, 홀짝 보정 없음 — Type O NSYM_TABLE 의
// L/H 열도 동일 절차). 이 표는 U3 확정 전까지 잠정이며, 확정되면 이 주석과 함께
// rs211.js 의 NSYM_TABLE 처럼 사용자 확정 값으로 교체한다.
//
// 회계는 capacity.js 와 동형이다(심볼 도메인):
//   총 좌표(셀)     total = n²  (Type Y 는 3면 공통 좌표 격자 — 기하 곱셈 없이 n×n)
//   오버헤드         overhead = placementY 레퍼런스 12셀 + 포맷 15셀 실계산 합(=27)
//   데이터 심볼(셀)  C = total − overhead
//   사용 심볼        S = ⌊C / 3⌋  (잔여 셀 = C − 3S)
//   RS               S = 데이터심볼 + nsym  (nsym 은 NSYM_TABLE_Y 표에서)
//   데이터 바이트     K = max{k : 211^(S−nsym) >= 2^(8k)}  (capacity.js 의
//                     `maxBytesForSymbols` 를 그대로 재사용 — BigInt 정확 계산, Type Y
//                     전용으로 다시 구현하지 않는다)
//   순 페이로드       = K − 1  (헤더 1B, header.js 승계)

import { maxBytesForSymbols } from './capacity.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { referenceCellsAll, formatCells } from './placementY.js';

/**
 * Type Y 오버헤드 실계산(레퍼런스 12셀 + 포맷 15셀). capacity.js 의
 * `overheadBreakdown(k).total` 과 동형 — 하드코딩 27 이 아니라 placementY 실계산이다.
 * @param {number} n
 * @returns {{n:number, reference:number, format:number, total:number}}
 */
export function overheadBreakdownY(n) {
  const reference = referenceCellsAll(n).length;
  const format = formatCells(n).length;
  return { n, reference, format, total: reference + format };
}

/**
 * [U3 잠정] Type Y 사용 심볼 수 대비 ECC 레벨별 nsym 표. 산출 근거는 위 모듈 헤더 주석.
 * @type {Readonly<Record<string, Readonly<{symbols:number, L:number, M:number, H:number}>>>}
 */
export const NSYM_TABLE_Y = Object.freeze({
  Y1: Object.freeze({
    symbols: 138, L: 17, M: 35, H: 55,
  }),
  Y2: Object.freeze({
    symbols: 199, L: 24, M: 51, H: 80,
  }),
});

/**
 * 버전 정의. `overhead` 는 `overheadBreakdownY(n).total` 로 유도한다(하드코딩 아님).
 * 포맷 정보 버전 인덱스 네임스페이스(SPEC §14): 8·9 = Y1·Y2(tones=2, 2톤 메인) ·
 * 10·11 = Y1T·Y2T(tones=3, Y-T 옵션). `symbolKey` 는 NSYM_TABLE_Y 조회 키 — n 이
 * 같으면(=용량 회계가 같으면) tones 와 무관하게 같은 키를 쓴다(Y1T 도 'Y1').
 * @type {ReadonlyArray<{name:string, version:number, n:number, tones:2|3, formatIndex:number, overhead:number, symbolKey:string}>}
 */
export const VERSIONS_Y = Object.freeze([
  Object.freeze({
    name: 'Y1', version: 1, n: 21, tones: 2, formatIndex: 8, overhead: overheadBreakdownY(21).total, symbolKey: 'Y1',
  }),
  Object.freeze({
    name: 'Y2', version: 2, n: 25, tones: 2, formatIndex: 9, overhead: overheadBreakdownY(25).total, symbolKey: 'Y2',
  }),
  Object.freeze({
    name: 'Y1T', version: 1, n: 21, tones: 3, formatIndex: 10, overhead: overheadBreakdownY(21).total, symbolKey: 'Y1',
  }),
  Object.freeze({
    name: 'Y2T', version: 2, n: 25, tones: 3, formatIndex: 11, overhead: overheadBreakdownY(25).total, symbolKey: 'Y2',
  }),
]);

/**
 * (version, tones) → VERSIONS_Y 항목. 인코더/디코더가 모드를 명시했을 때의
 * 단일 조회 진입점 — 필드 4개(name/tones/formatIndex 포함)를 재조합하지 않는다.
 * @param {number} version 1 | 2
 * @param {2|3} [tones] 기본 2(2톤 메인).
 * @returns {{name:string, version:number, n:number, tones:2|3, formatIndex:number, overhead:number, symbolKey:string}}
 */
export function versionSpecY(version, tones = 2) {
  const spec = VERSIONS_Y.find((v) => v.version === version && v.tones === tones);
  if (!spec) {
    throw new RangeError(
      `알 수 없는 Type Y 버전/모드: version=${version}, tones=${tones} `
      + `(허용 ${VERSIONS_Y.map((v) => `${v.name}(v${v.version}/t${v.tones})`).join(', ')})`,
    );
  }
  return spec;
}

/**
 * 한 버전의 용량 전체. capacity.js `capacityFor` 회계를 그대로 승계한다.
 * @param {{version:number, n:number, overhead:number, symbolKey:string}} spec
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityForY(spec, level = 'M') {
  const label = spec.name || `Y${spec.version}`;
  const totalCells = spec.n * spec.n;
  const dataCells = totalCells - spec.overhead;
  if (dataCells <= 0) {
    throw new RangeError(`${label}: 오버헤드 ${spec.overhead} 가 총 셀 ${totalCells} 이상이다`);
  }

  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;

  const table = NSYM_TABLE_Y[spec.symbolKey];
  if (!table) {
    throw new RangeError(`${label}: NSYM_TABLE_Y 에 키 ${spec.symbolKey} 가 없다`);
  }
  if (table.symbols !== usedSymbols) {
    // 표가 전제한 심볼 수와 실계산이 어긋난다 — 조용히 맞추지 않고 던진다
    // (capacity.js `capacityFor` 와 동일한 규약 · 과제 지침 절대 규칙 6).
    throw new RangeError(
      `${label}: 실계산 사용 심볼 ${usedSymbols} 이 NSYM_TABLE_Y.${spec.symbolKey}.symbols `
      + `(${table.symbols}) 과 어긋난다 — overhead(${spec.overhead})/n(${spec.n}) 와 표가 불일치한다`,
    );
  }

  const nsym = table[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError(`${label}: NSYM_TABLE_Y.${spec.symbolKey} 에 레벨 ${level} 이 없다`);
  }
  const dataSymbols = usedSymbols - nsym;
  if (dataSymbols <= 0) {
    throw new RangeError(`${label}/${level}: nsym ${nsym} 이 사용 심볼 ${usedSymbols} 이상이다`);
  }

  const dataBytes = maxBytesForSymbols(dataSymbols);

  return {
    name: spec.name,
    version: spec.version,
    n: spec.n,
    tones: spec.tones,
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
    maxPayloadBytes: maxPayloadFor(dataBytes),
    headerBytes: HEADER_BYTES,
  };
}

/**
 * 전 버전 용량표.
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityTableY(level = 'M') {
  return VERSIONS_Y.map((v) => capacityForY(v, level));
}

/**
 * SPEC §14 에 붙일 마크다운 표. 단일 물결표는 쓰지 않는다(규약 §6.11).
 * @param {'L'|'M'|'H'} [level]
 * @returns {string}
 */
export function renderMarkdownTableY(level = 'M') {
  const rows = capacityTableY(level);
  const head = '| 버전 | n | 총 셀 | 오버헤드 | 데이터 셀 C | 사용 심볼 S | 잔여 셀 | ECC-'
    + level + ' nsym | t | 데이터 심볼 | K | 순 페이로드 |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => `| ${r.name} | ${r.n} | ${r.totalCells} | ${r.overhead} | `
    + `${r.dataCells} | ${r.usedSymbols} | ${r.residualCells} | ${r.nsym} | ${r.errorCapacity} | `
    + `${r.dataSymbols} | ${r.dataBytes} B | **${r.maxPayloadBytes} B** |`);
  return [head, sep, ...body].join('\n');
}
