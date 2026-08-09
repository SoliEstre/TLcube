// encodeY.js — Type Y 인코더 파이프라인 통합 (SPEC §14, encode.js 대칭)
//
// UTF-8 페이로드 → 길이 헤더 1B 부착 → 0x00 패딩(고정 dataBytes까지) → base-211 심볼
// 변환(27B↔28심볼, MSD-first) → RS(GF(211)) 패리티 → 코드워드 = 심볼 열 S개 →
// 심볼 → 3 digit(MSD-first) → 마스크 가산 → scan order-Y 로 셀 배치 → 잔여 셀에
// 필러(프리마스크 0 + 마스크) → digit 확정까지. 배정(digit → 3면 색 — 2톤 패턴 또는
// 3톤 순위)·렌더는 다른 모듈 몫이다 — 여기서는 셀별 digit 확정까지만 한다.
//
// 이 모듈은 새 규약을 만들지 않는다 — capacityY.js/header.js/base211.js/rs211.js/
// mask.js/formatinfo.js/layoutY.js/placementY.js 가 이미 확정한 조각을 파이프라인
// 순서대로 조합만 한다. nsym 은 rs211.js 의 NSYM_TABLE(Type O)이 아니라 capacityY.js
// 의 NSYM_TABLE_Y(Type Y, [U3] 잠정)를 쓴다 — capacityForY 가 이미 그 표를 참조한다.
//
// [v3.1 §4b 2톤 메인 전환] tones 옵션(기본 2)이 데이터 파이프라인 자체(마스크·
// scan order·RS·심볼 변환)에는 영향을 주지 않는다 — capacityY.js 주석대로 용량 회계가
// tones 무관이기 때문. tones 가 바꾸는 것은 딱 둘: ① 레퍼런스 조 digit 배정
// (placementY.referenceCellsAll 이 tones 를 받는다) ② 포맷 정보 버전 인덱스
// (versionSpecY 가 반환하는 spec.formatIndex — Y1/Y2=8/9, Y1T/Y2T=10/11).

import {
  VERSIONS_Y, capacityForY, versionSpecY,
  capacityForY2Window, windowedReferenceCellsY, windowedFormatCellsY, windowExcludedCellsY,
  WINDOW_SUPPORTED_N, WINDOW_SUPPORTED_TONES,
} from './capacityY.js';
import { frame, payloadByteLength } from './header.js';
import { bytesToSymbols, unpackSymbolsToCellDigits } from './base211.js';
import { rsEncode } from './rs211.js';
import { maskAdd } from './mask.js';
import { encodeReplicated, ECC_LEVEL } from './formatinfo.js';
import { dataCellsInScanOrder, fillerCells } from './layoutY.js';
import { referenceCellsAll, formatCells } from './placementY.js';

function cellKey(i, j) {
  return `${i},${j}`;
}

// ─────────────────────────────────────────────────────────────────────────
// 면 내 QR 윈도 β (ADR 0003 D1 + [C7 Q7]) — Y2(n=25)·tones=2 전용, scan order
// ─────────────────────────────────────────────────────────────────────────
//
// layoutY.js(dataCellsInScanOrder)는 윈도를 모른다(placementY.js 의 베이스
// 레퍼런스/포맷 좌표만 안다) — 이 lane 은 layoutY.js/placementY.js 를 고치지
// 않으므로(과제 지침, 파일 목록 밖 금지), 윈도 모드의 scan order 는 여기서 로컬로
// 재구성한다: capacityY.js 의 윈도 재배치 좌표(reference/format) + 윈도 배제
// 좌표(windowExcludedCellsY)를 역할표로 삼아 layoutY 와 동일한 래스터 규약(D5:
// j 오름차순 바깥, i 오름차순 안쪽, role==='data' 만)을 그대로 적용한다.

function windowRoleSetsY(n, tones) {
  const reference = new Set(
    windowedReferenceCellsY(n, tones).map((c) => cellKey(c.i, c.j)),
  );
  const format = new Set(windowedFormatCellsY(n).map((c) => cellKey(c.i, c.j)));
  const excluded = new Set(windowExcludedCellsY(n).map((c) => cellKey(c.i, c.j)));
  return { reference, format, excluded };
}

/** layoutY.dataCellsInScanOrder(n) 의 윈도 변형 — D5 래스터 규약 그대로, 윈도
 * 배제 좌표까지 함께 스킵한다(제외 좌표는 세 면 전부 데이터에서 뺀다, D1). */
function windowedDataCellsInScanOrder(n, tones) {
  const { reference, format, excluded } = windowRoleSetsY(n, tones);
  const out = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = cellKey(i, j);
      if (reference.has(k) || format.has(k) || excluded.has(k)) continue;
      out.push({ i, j });
    }
  }
  return out;
}

/** layoutY.fillerCells(n) 의 윈도 변형 — scan order 꼬리의 (C mod 3) 개(§5.6 준용). */
function windowedFillerCellsY(n, tones) {
  const scan = windowedDataCellsInScanOrder(n, tones);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

/**
 * 페이로드 바이트 길이가 들어가는 최소 VERSIONS_Y 항목을 고른다(같은 tones 안에서만
 * 후보로 삼는다). 마지막 항목도 초과하면 RangeError.
 * @param {string} text
 * @param {'L'|'M'|'H'} [eccLevel]
 * @param {2|3} [tones] 기본 2(2톤 메인).
 * @returns {{name:string, version:number, n:number, tones:2|3, formatIndex:number, overhead:number, symbolKey:string}} VERSIONS_Y 원소
 */
export function chooseVersionY(text, eccLevel = 'M', tones = 2) {
  const byteLength = payloadByteLength(text);
  const candidates = VERSIONS_Y.filter((v) => v.tones === tones);
  if (candidates.length === 0) {
    throw new RangeError(`지원하지 않는 tones: ${tones} (허용 ${[...new Set(VERSIONS_Y.map((v) => v.tones))].join(', ')})`);
  }
  for (const spec of candidates) {
    const capacity = capacityForY(spec, eccLevel);
    if (byteLength <= capacity.maxPayloadBytes) return spec;
  }
  const last = candidates[candidates.length - 1];
  throw new RangeError(
    `페이로드 ${byteLength} B 는 ${last.name}(ECC-${eccLevel}) 용량을 초과한다`,
  );
}

/**
 * Type Y 인코더 파이프라인 진입점 (SPEC §14). version 을 생략하면
 * `chooseVersionY` 로 자동 선택한다.
 * @param {string} text UTF-8 페이로드
 * @param {{version?: number, eccLevel?: 'L'|'M'|'H', tones?: 2|3, window?: boolean}} [options]
 *   tones 기본 2(2톤 메인, ADR 0003 v3.1 §4b) — 3 은 Y-T 옵션. window 는 면 내 QR
 *   윈도 β(ADR 0003 D1 + [C7 Q7]) — version=2(Y2)·tones=2 에서만 허용(그 외 RangeError),
 *   version 생략 시 2 로 강제한다(윈도가 지원되는 유일한 버전이므로).
 * @returns {{
 *   version: number, n: number, eccLevel: 'L'|'M'|'H', tones: 2|3, formatIndex: number,
 *   window: boolean,
 *   capacity: object,
 *   codewordSymbols: Uint8Array,
 *   dataDigits: Uint8Array,
 *   fillerDigits: Uint8Array,
 *   formatDigits: number[],
 *   cellDigits: Map<string, {digit:number, role:'reference'|'format'|'data'|'filler'}>,
 * }}
 */
export function encodeY(text, options = {}) {
  // encode.js(Type O) 전례: version 명시 경로가 chooseVersionY(→ payloadByteLength
  // 의 타입 검사)를 건너뛰면 TextEncoder 가 undefined → '' 로 조용히 강제 변환한다.
  // 두 경로의 판정을 여기서 먼저 일치시킨다.
  if (typeof text !== 'string') {
    throw new TypeError(`페이로드는 문자열이어야 한다: ${typeof text}`);
  }
  const {
    version, eccLevel = 'M', tones = 2, window = false,
  } = options;

  // 면 내 QR 윈도(ADR 0003 D1 조건 ②: n≥25 → Y2 만 가능, Y1 은 애초 불가) —
  // version=2/tones=2 이외의 명시 조합은 조용히 무시하지 않고 던진다.
  if (window) {
    if (tones !== WINDOW_SUPPORTED_TONES) {
      throw new RangeError(
        `options.window 은 tones=${WINDOW_SUPPORTED_TONES} 에서만 허용된다 (ADR 0003 D1 조건 ②): tones=${tones}`,
      );
    }
    if (version !== undefined && version !== 2) {
      throw new RangeError(`options.window 은 version=2(Y2) 에서만 허용된다 (Y1 은 D1 조건 ② 로 불가): version=${version}`);
    }
  }

  const spec = window
    ? versionSpecY(2, WINDOW_SUPPORTED_TONES) // Y2 고정 — formatIndex 도 Y2 와 동일(9).
    : (version === undefined ? chooseVersionY(text, eccLevel, tones) : versionSpecY(version, tones));

  const capacity = window ? capacityForY2Window(eccLevel) : capacityForY(spec, eccLevel);
  const { n } = spec;
  if (window && n !== WINDOW_SUPPORTED_N) {
    // 방어적 가드 — WINDOW_SUPPORTED_N 이 바뀌면(향후 버전 확장) 여기서 바로 드러난다.
    throw new Error(`내부 불변 위반: window=true 인데 spec.n(${n}) !== WINDOW_SUPPORTED_N(${WINDOW_SUPPORTED_N})`);
  }

  // 길이 헤더 + 0x00 패딩 (header.js) → base-211 심볼 (base211.js).
  const framed = frame(text, capacity.dataBytes);
  const symbols = bytesToSymbols(framed);
  if (symbols.length !== capacity.dataSymbols) {
    // 조용히 맞추지 않는다 — 파이프라인 자기검증(과제 지침 절대 규칙).
    throw new RangeError(
      `심볼 개수 불일치: bytesToSymbols() ${symbols.length} !== capacity.dataSymbols ${capacity.dataSymbols}`,
    );
  }

  // RS(GF(211)) 패리티 부착 → 코드워드 = 데이터 심볼 ‖ 패리티, 길이 S(=usedSymbols).
  const codewordSymbols = rsEncode(symbols, capacity.nsym);
  if (codewordSymbols.length !== capacity.usedSymbols) {
    throw new RangeError(
      `코드워드 심볼 개수 불일치: rsEncode() ${codewordSymbols.length} !== capacity.usedSymbols ${capacity.usedSymbols}`,
    );
  }

  // 심볼 → 3 digit(MSD-first, 프리마스크) → scan order-Y 좌표에 마스크 가산.
  //
  // `dataCellsInScanOrder(n)` 는 role === 'data' 인 셀 **전부**(= dataCells 개,
  // capacity.dataCells)를 돌려준다 — 그중 앞 3S 개가 실제 심볼 3-digit 그룹이고
  // 나머지 (residualCells 개, = `fillerCells(n)` 와 정확히 같은 셀)가 필러다
  // (layoutY.js `symbolCellGroups`/`fillerCells` 의 분할과 동일하게 여기서도 슬라이스한다).
  const preMaskDataDigits = unpackSymbolsToCellDigits(codewordSymbols); // 길이 3S
  const scanCells = window ? windowedDataCellsInScanOrder(n, spec.tones) : dataCellsInScanOrder(n);
  if (scanCells.length !== capacity.dataCells) {
    throw new RangeError(
      `scan order-Y 셀 수 불일치: ${window ? 'windowedDataCellsInScanOrder' : 'dataCellsInScanOrder'}() `
      + `${scanCells.length} !== capacity.dataCells ${capacity.dataCells}`,
    );
  }
  const dataCellCoords = scanCells.slice(0, preMaskDataDigits.length);
  const dataDigits = new Uint8Array(preMaskDataDigits.length);
  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    // 마스크 좌표 = raw (i,j) — maskAdd(digit, q, r) 에 i→q, j→r 로 전달한다
    // (SPEC §14: Type Y 는 (T,L,R) 기하가 아니라 인덱스 격자 좌표 그대로 쓴다).
    dataDigits[i] = maskAdd(preMaskDataDigits[i], c.i, c.j);
  }

  // 잔여 셀 = 프리마스크 0 에 마스크 가산(§5.6 준용). scan order-Y 의 꼬리와 동일 셀.
  const fillerCoords = window ? windowedFillerCellsY(n, spec.tones) : fillerCells(n);
  if (fillerCoords.length !== capacity.residualCells) {
    throw new RangeError(
      `필러 셀 수 불일치: ${window ? 'windowedFillerCellsY' : 'fillerCells'}() `
      + `${fillerCoords.length} !== capacity.residualCells ${capacity.residualCells}`,
    );
  }
  const fillerDigits = new Uint8Array(fillerCoords.length);
  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    fillerDigits[i] = maskAdd(0, c.i, c.j);
  }

  // 포맷 정보(§5.4 승계): 버전 인덱스는 spec.formatIndex(Y1/Y2=8/9, Y1T/Y2T=10/11 —
  // versionSpecY 가 이미 tones 로 갈랐다), eccLevel 문자 → formatinfo 매핑.
  // formatCells(n) 순서로 15셀에 배치한다.
  const eccLevelValue = ECC_LEVEL[eccLevel];
  if (eccLevelValue === undefined || eccLevelValue === ECC_LEVEL.RESERVED) {
    throw new RangeError(`알 수 없는 ECC 레벨: ${eccLevel}`);
  }
  const formatReplicas = encodeReplicated({
    version: spec.formatIndex,
    eccLevel: eccLevelValue,
  });
  const formatDigits = formatReplicas.flat(); // 길이 15, formatCells(n) 순서와 정합

  // 셀별 digit + role 맵. Type Y 는 불스아이·앵커가 없다(reference | format | data | filler).
  const cellDigits = new Map();

  // 레퍼런스 조 digit 배정도 tones 모드별(placementY.js D9 전환 비용 항목) — 마스크 없음.
  // window===true 면 [C7 부속 계약 ①] 재배치 좌표(capacityY.windowedReferenceCellsY) —
  // digit 배정 순서는 불변, 좌표만 바뀐다.
  const references = window ? windowedReferenceCellsY(n, spec.tones) : referenceCellsAll(n, spec.tones);
  for (const c of references) {
    cellDigits.set(cellKey(c.i, c.j), { digit: c.digit, role: 'reference' });
  }

  const formatCoords = window ? windowedFormatCellsY(n) : formatCells(n);
  for (let i = 0; i < formatCoords.length; i += 1) {
    const c = formatCoords[i];
    cellDigits.set(cellKey(c.i, c.j), { digit: formatDigits[i], role: 'format' });
  }

  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    cellDigits.set(cellKey(c.i, c.j), { digit: dataDigits[i], role: 'data' });
  }

  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    cellDigits.set(cellKey(c.i, c.j), { digit: fillerDigits[i], role: 'filler' });
  }

  return {
    version: spec.version,
    n,
    eccLevel,
    tones: spec.tones,
    formatIndex: spec.formatIndex,
    window,
    capacity,
    codewordSymbols,
    dataDigits,
    fillerDigits,
    formatDigits,
    cellDigits,
  };
}
