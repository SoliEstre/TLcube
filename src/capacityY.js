// capacityY.js — Type Y 버전별 용량 산출 (SPEC §14, ADR 0003 D7·U3·U9·v3.1§4b — capacity.js 대칭)
//
// **이 모듈이 SPEC §14 생성물 표의 소스다.** 수기로 유지하지
// 않는다.
//
// [v3.1 §4b 2톤 메인 전환] VERSIONS_Y 는 이제 4항목이다 — n=21·25 각각에 톤 모드
// (tones=2 2톤 메인 · tones=3 Y-T 옵션)가 곱해진다. **용량 회계는 tones 무관 동일**
// (동일 base-6 심볼 알파벳 — 오버헤드·NSYM_TABLE_Y·페이로드 전부 n 에만 의존, tones
// 는 digit→면 매핑(sceneY.js/tonemap.js/verifyY.js)만 바꾼다). 그래서 Y1 과 Y1T,
// Y2 와 Y2T 는 formatIndex 만 다르고 나머지 용량 수치는 항상 완전히 같다 — 이 항등을
// capacityY.test.js 가 회귀로 고정한다.
//
// [U3 ✅ 확정 — 사용자 비준 (ADR 0003 v3.1, 2026-08-09)] `NSYM_TABLE_Y` 는 Type O V3 전례(ADR 0001 §3.3.3: 오정정
// 검출 여유 +1 로 홀수 nsym)를 따라 산출한 확정표다. 절차 (재현 가능 — 검증 라운드 정정):
// **M = Math.round(0.25·S) (JS half-up), 결과가 짝수면 +1 홀수화 (홀수면 유지)**:
//   Y1 S=138 → round(34.5) = 35 (홀수 → 유지)
//   Y2 S=199 → round(49.75) = 50 (짝수 → +1) = 51
// L = round(0.12·S), H = round(0.40·S) (반올림, 홀짝 보정 없음 — Type O NSYM_TABLE 의
// L/H 열도 동일 절차).
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
import {
  referenceCellsAll, formatCells, referenceGroups, FORMAT_BLOCK_LENGTH,
} from './placementY.js';

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
 * [U3 ✅ 확정] Type Y 사용 심볼 수 대비 ECC 레벨별 nsym 표. 산출 근거는 위 모듈 헤더 주석.
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

// ─────────────────────────────────────────────────────────────────────────
// 면 내 QR 윈도 β (ADR 0003 D1 + [C7 Q7]) — Y2(n=25)·tones=2 전용
// ─────────────────────────────────────────────────────────────────────────
//
// 윈도 좌표(와이어, 스냅샷 고정): 상단면(T) 의 바깥 꼭짓점 코너 — (i,j) ∈
// [n-13, n-1]² (W=13 — ½피치 v1 QR: 21 QR모듈 + 안쪽 2변 콰이어트 4 QR모듈 = 25
// QR모듈 = 12.5 데이터 피치, 바깥 2변 콰이어트는 실루엣 밖 배경이 제공, ADR 0003
// D1). **제외 좌표는 세 면 전부 데이터에서 뺀다** — window===true 인코딩은 이
// 좌표들을 cellDigits 에 아예 싣지 않는다.
//
// [C7 부속 계약 ① — 실계산으로 확인, ADR 원문이 명시한 것보다 넓다] n=25 에서
// 윈도 [12,24]² 와 겹치는 것은 **레퍼런스 앵커 (n-3,n-3)=(22,22) 조 전체(3셀)
// 뿐 아니라 포맷 정보 복제 2(i=n-8..n-4, j=n-2 — 5셀 전부)도 겹친다** (ADR
// 0003b 자문 원문은 레퍼런스만 짚었다 — 이 lane 이 실계산으로 포맷 복제 2 충돌을
// 추가로 발견했다, 아래 모듈 로드 시점 자기검증 참조). 조용히 옮기지 않고
// 결정적 탐색으로 해소한다: |shift| 오름차순으로 j축 평행이동을 먼저 시도하고
// (윈도가 항상 (n-13..n-1) 코너에 있으므로 j 감소가 항상 벗어나는 방향이다),
// 실패하면 i축을 시도해 "윈도 밖·격자 내·미점유"인 최초 해를 그 그룹 전체(조/
// 복제, 구조·상대좌표·digit 배정 순서 불변)에 적용한다. n=25/tones=2 결과
// (스냅샷, encodeY.test.js 가 회귀로 고정):
//   레퍼런스 조 D: (22,22)→(22,10) · (23,22)→(23,10) · (22,23)→(22,11) (j축 −12)
//   포맷 복제 2:   (17,23)→(7,23) · (18,23)→(8,23) · (19,23)→(9,23) ·
//                  (20,23)→(10,23) · (21,23)→(11,23) (i축 −10)

/** 윈도 한 변의 데이터 셀 폭 W (ADR 0003 D1). */
export const WINDOW_SIZE_Y = 13;

/** 윈도가 지원되는 유일한 (n, tones) — Y2/2톤(D1 조건 ②: n≥25, Y1 은 불가). */
export const WINDOW_SUPPORTED_N = 25;
export const WINDOW_SUPPORTED_TONES = 2;

/** 윈도 경계(포함) — (i,j) ∈ [lo, hi]² 이면 윈도 안. */
export function windowBoundsY(n) {
  return { lo: n - WINDOW_SIZE_Y, hi: n - 1 };
}

/** 좌표 (i,j) 가 윈도 안인가. */
export function inWindowY(i, j, n) {
  const { lo, hi } = windowBoundsY(n);
  return i >= lo && i <= hi && j >= lo && j <= hi;
}

function cellKeyY(i, j) {
  return `${i},${j}`;
}

function translateCellsY(cells, di, dj) {
  return cells.map((c) => ({ ...c, i: c.i + di, j: c.j + dj }));
}

function cellsClearOfWindow(cells, n, occupied) {
  for (const c of cells) {
    if (c.i < 0 || c.i > n - 1 || c.j < 0 || c.j > n - 1) return false;
    if (inWindowY(c.i, c.j, n)) return false;
    if (occupied.has(cellKeyY(c.i, c.j))) return false;
  }
  return true;
}

/**
 * 결정적 탐색 — |shift| 오름차순, 매 shift 에서 j축 평행이동을 먼저 시도하고
 * 실패하면 i축을 시도한다. 그룹(조/복제)을 통째로 옮긴다(구조·상대좌표 불변).
 * 위 모듈 헤더 주석의 n=25 결과가 이 탐색의 산출물이다(재현 가능, 하드코딩 아님).
 */
function relocateGroupOutOfWindow(cells, n, occupied, maxShift) {
  for (let shift = 1; shift <= maxShift; shift += 1) {
    const byJ = translateCellsY(cells, 0, -shift);
    if (cellsClearOfWindow(byJ, n, occupied)) return byJ;
    const byI = translateCellsY(cells, -shift, 0);
    if (cellsClearOfWindow(byI, n, occupied)) return byI;
  }
  throw new RangeError(`n=${n}: 윈도 충돌 그룹을 재배치할 탐색 범위(${maxShift}) 안에서 못 찾았다`);
}

/**
 * 윈도 배제 후 레퍼런스 4조. 윈도와 안 겹치는 조는 그대로, 겹치는 조(3셀 전부
 * 윈도 안이어야 함 — 부분 겹침은 결정 규칙 밖이라 throw)는 통째 재배치한다.
 * @param {number} n
 * @param {2|3} [tones]
 * @returns {{cells:{i:number,j:number}[], digits:number[]}[]} 길이 4
 */
export function windowedReferenceGroupsY(n, tones = 2) {
  const groups = referenceGroups(n, tones);
  const occupied = new Set();
  for (const g of groups) {
    for (const c of g.cells) if (!inWindowY(c.i, c.j, n)) occupied.add(cellKeyY(c.i, c.j));
  }
  for (const c of formatCells(n)) {
    if (!inWindowY(c.i, c.j, n)) occupied.add(cellKeyY(c.i, c.j));
  }

  return groups.map((g) => {
    const flags = g.cells.map((c) => inWindowY(c.i, c.j, n));
    if (flags.every((f) => !f)) return g; // 안 겹침 — 그대로.
    if (!flags.every(Boolean)) {
      throw new RangeError(`n=${n}: 레퍼런스 조가 윈도와 부분 겹침 — 결정 규칙 밖 (${JSON.stringify(g.cells)})`);
    }
    const relocated = relocateGroupOutOfWindow(g.cells, n, occupied, n);
    relocated.forEach((c) => occupied.add(cellKeyY(c.i, c.j)));
    return { cells: relocated, digits: g.digits };
  });
}

/** 윈도 배제 후 레퍼런스 12셀 전부(조 순·조 내 순 평탄화), digit 포함. */
export function windowedReferenceCellsY(n, tones = 2) {
  const out = [];
  for (const group of windowedReferenceGroupsY(n, tones)) {
    group.cells.forEach((cell, idx) => out.push({ ...cell, digit: group.digits[idx] }));
  }
  return out;
}

/**
 * 윈도 배제 후 포맷 정보 15셀. 복제 단위(FORMAT_BLOCK_LENGTH=5셀 연속 런)로
 * 전부/전무만 허용 — 부분 겹침은 결정 규칙 밖(throw).
 * @param {number} n
 * @returns {{i:number,j:number}[]} 길이 15
 */
export function windowedFormatCellsY(n) {
  const cells = formatCells(n);
  const occupied = new Set();
  for (const c of cells) if (!inWindowY(c.i, c.j, n)) occupied.add(cellKeyY(c.i, c.j));
  for (const c of referenceCellsAll(n)) if (!inWindowY(c.i, c.j, n)) occupied.add(cellKeyY(c.i, c.j));

  const out = [];
  for (let r = 0; r < cells.length; r += FORMAT_BLOCK_LENGTH) {
    const run = cells.slice(r, r + FORMAT_BLOCK_LENGTH);
    const flags = run.map((c) => inWindowY(c.i, c.j, n));
    if (flags.every((f) => !f)) {
      out.push(...run);
      continue;
    }
    if (!flags.every(Boolean)) {
      throw new RangeError(`n=${n}: 포맷 복제가 윈도와 부분 겹침 — 결정 규칙 밖 (${JSON.stringify(run)})`);
    }
    const relocated = relocateGroupOutOfWindow(run, n, occupied, n);
    relocated.forEach((c) => occupied.add(cellKeyY(c.i, c.j)));
    out.push(...relocated);
  }
  return out;
}

/** 윈도가 배제하는 W² 좌표 전부(재배치 후에는 순수 데이터-제외 영역이 된다). */
export function windowExcludedCellsY(n) {
  const { lo, hi } = windowBoundsY(n);
  const out = [];
  for (let j = lo; j <= hi; j += 1) {
    for (let i = lo; i <= hi; i += 1) out.push({ i, j });
  }
  return out;
}

/**
 * 윈도 후 오버헤드 — 레퍼런스 12 + 포맷 15(재배치로 위치만 바뀔 뿐 개수는 불변)
 * + 윈도 배제 W². overhead(=27) 는 표시용이 아니라 실제 역할 셀 수 그대로 두고,
 * windowExcluded 를 별도 필드로 노출한다(오버헤드 정의 자체를 바꾸지 않는다).
 */
export function overheadBreakdownY2Window() {
  const base = overheadBreakdownY(WINDOW_SUPPORTED_N);
  return { ...base, windowExcluded: WINDOW_SIZE_Y * WINDOW_SIZE_Y };
}

/**
 * [✅ 확정 — 사용자 비준 2026-08-09, hb-20260809-tlrat1] Y2W 사용 심볼(143) 대비 ECC 레벨별 nsym. capacityForY2Window() 가
 * 실계산하는 dataCells(429)/usedSymbols(143) 에 대해 NSYM_TABLE_Y 와 동일 절차
 * (M = round(0.25·S), 짝수면 +1 홀수화 · L = round(0.12·S) · H = round(0.40·S)):
 *   S=143 → M: round(35.75)=36(짝) → 37 · L: round(17.16)=17 · H: round(57.2)=57
 */
export const NSYM_TABLE_Y2W = Object.freeze({ symbols: 143, L: 17, M: 37, H: 57 });

/**
 * Y2W(면 내 QR 윈도 채택) 용량. version=2/tones=2 전용 — `capacityForY` 의 창
 * 배제 변형. **formatIndex 는 Y2 와 동일(9)** — 윈도 유/무는 와이어(포맷 정보)가
 * 아니라 광학 검출 + 사후 RS/CRC 로 구분한다(ADR 0003 [C7 Q7], β 출하는 와이어
 * 무변경).
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityForY2Window(level = 'M') {
  const n = WINDOW_SUPPORTED_N;
  const totalCells = n * n;
  const { total: overhead, windowExcluded } = overheadBreakdownY2Window();
  const dataCells = totalCells - overhead - windowExcluded;
  if (dataCells <= 0) {
    throw new RangeError(`Y2W: 오버헤드+윈도(${overhead + windowExcluded}) 가 총 셀(${totalCells}) 이상`);
  }

  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;

  if (NSYM_TABLE_Y2W.symbols !== usedSymbols) {
    throw new RangeError(
      `Y2W: 실계산 사용 심볼 ${usedSymbols} 이 NSYM_TABLE_Y2W.symbols(${NSYM_TABLE_Y2W.symbols}) 과 어긋난다`,
    );
  }
  const nsym = NSYM_TABLE_Y2W[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError(`Y2W: NSYM_TABLE_Y2W 에 레벨 ${level} 이 없다`);
  }
  const dataSymbols = usedSymbols - nsym;
  if (dataSymbols <= 0) {
    throw new RangeError(`Y2W/${level}: nsym ${nsym} 이 사용 심볼 ${usedSymbols} 이상이다`);
  }

  const dataBytes = maxBytesForSymbols(dataSymbols);

  return {
    name: 'Y2W',
    version: 2,
    n,
    tones: WINDOW_SUPPORTED_TONES,
    formatIndex: 9, // Y2 와 동일 — 광학 신호(ADR 0003 [C7 Q7]).
    window: true,
    totalCells,
    overhead,
    windowExcluded,
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

// 모듈 로드 시점 자기검증 — Y2W 재배치가 실제로 윈도 밖·무충돌인지, 그리고 [C7]
// 부속 계약 ①(레퍼런스 조 D + 포맷 복제 2 둘 다 겹침)이 여전히 참인지 즉시 확인한다.
// "충돌 시 조용히 옮기지 않는다"(과제 지침) 를 import 시점부터 지킨다.
{
  const n = WINDOW_SUPPORTED_N;
  const baseRefD = referenceGroups(n, WINDOW_SUPPORTED_TONES)[3]; // 앵커 (n-3,n-3)
  if (!baseRefD.cells.every((c) => inWindowY(c.i, c.j, n))) {
    throw new Error('n=25: [C7 부속 계약 ①] 전제(레퍼런스 조 D 가 윈도와 전부 겹침) 가 깨졌다 — 재검토 필요');
  }
  const baseFmt2 = formatCells(n).slice(10, 15);
  if (!baseFmt2.every((c) => inWindowY(c.i, c.j, n))) {
    throw new Error('n=25: [C7 부속 계약 ①] 전제(포맷 복제 2 가 윈도와 전부 겹침) 가 깨졌다 — 재검토 필요');
  }

  const relocatedRef = windowedReferenceCellsY(n, WINDOW_SUPPORTED_TONES);
  const relocatedFmt = windowedFormatCellsY(n);
  if (relocatedRef.length !== 12 || relocatedFmt.length !== 15) {
    throw new Error('n=25: 윈도 재배치 후 레퍼런스/포맷 셀 수가 12/15 가 아니다');
  }
  const seen = new Set();
  for (const c of [...relocatedRef, ...relocatedFmt]) {
    if (inWindowY(c.i, c.j, n)) {
      throw new Error(`n=25: 재배치 후에도 윈도 안 좌표가 남아 있다: (${c.i},${c.j})`);
    }
    const k = cellKeyY(c.i, c.j);
    if (seen.has(k)) throw new Error(`n=25: 재배치된 레퍼런스/포맷 셀이 충돌한다: (${c.i},${c.j})`);
    seen.add(k);
  }
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
  // Y2W(면 내 QR 윈도, ADR 0003 [C7 Q7]) 행을 덧붙인다 — "오버헤드" 열은 그 행에서만
  // ref+format(27) 에 윈도 배제(169)를 더한 표시용 합(196)을 쓴다(그래야 "총 셀 −
  // 오버헤드 = 데이터 셀" 산술이 표에서도 그대로 성립한다, capacityForY2Window() 가
  // 돌려주는 overhead 필드 자체(27)는 바꾸지 않는다 — windowExcluded 는 별도 필드).
  const rows = [...capacityTableY(level), capacityForY2Window(level)];
  const head = '| 버전 | n | 총 셀 | 오버헤드 | 데이터 셀 C | 사용 심볼 S | 잔여 셀 | ECC-'
    + level + ' nsym | t | 데이터 심볼 | K | 순 페이로드 |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => {
    const displayOverhead = r.windowExcluded === undefined ? r.overhead : r.overhead + r.windowExcluded;
    return `| ${r.name} | ${r.n} | ${r.totalCells} | ${displayOverhead} | `
      + `${r.dataCells} | ${r.usedSymbols} | ${r.residualCells} | ${r.nsym} | ${r.errorCapacity} | `
      + `${r.dataSymbols} | ${r.dataBytes} B | **${r.maxPayloadBytes} B** |`;
  });
  return [head, sep, ...body].join('\n');
}
