// encodeA.js — Type A 인코더 파이프라인 통합 (ADR 0005, encode.js 대칭)
//
// UTF-8 페이로드 → 길이 헤더 1B 부착 → 0x00 패딩(고정 dataBytes까지) → base-211
// 심볼 변환(27B↔28심볼, MSD-first) → RS(GF(211)) 패리티 → 코드워드 = 심볼 열 S개
// → 심볼 → 3 digit(MSD-first) → 마스크 가산 → scan order-A(T3) 로 셀 배치 →
// 잔여 셀에 필러(프리마스크 0 + 마스크) → digit 확정까지. 배정(digit → (T,L,R)
// rank)·렌더는 다른 모듈 몫이다 — 여기서는 셀별 digit 확정까지만 한다.
//
// 이 모듈은 새 규약을 만들지 않는다 — capacityA.js/header.js/base211.js/rs211.js/
// mask.js/formatinfo.js/layoutA.js/placementA.js/placement.js(육각부 무수정 재사용)
// 가 이미 확정한 조각을 파이프라인 순서대로 조합만 한다.
//
// [D6 centerQr] formatIndex 는 VERSIONS_A 의 12(A1)/13(A2)에서 centerQr=true 면
// +2 오프셋(14=A1Q·15=A2Q) — 중앙 QR 파인더 변형(ADR 0004 §1-3 규약 승계, D7).
// 오버헤드·용량 수치는 centerQr 무관 동일하다(19셀 슬롯 기하 동일, D5 근거).

import { VERSIONS_A, capacityForA, versionSpecA } from './capacityA.js';
import { frame, payloadByteLength } from './header.js';
import { bytesToSymbols, unpackSymbolsToCellDigits } from './base211.js';
import { rsEncode } from './rs211.js';
import { maskAdd } from './mask.js';
import { encodeReplicated, ECC_LEVEL } from './formatinfo.js';
import { dataCellsInScanOrderA, fillerCellsA } from './layoutA.js';
import { anchorCells, referenceCellsAll, formatCells, REFERENCE_DIGIT } from './placement.js';
import { vertexAnchors, patchReferenceCells } from './placementA.js';

function cellKey(q, r) {
  return `${q},${r}`;
}

/**
 * 페이로드 바이트 길이가 들어가는 최소 VERSIONS_A 항목을 고른다.
 * A2(ECC-eccLevel) 도 초과하면 RangeError.
 * @param {string} text
 * @param {'L'|'M'|'H'} [eccLevel]
 * @returns {{name:string, version:number, k:number, formatIndex:number, overhead:number, symbolKey:string}}
 */
export function chooseVersionA(text, eccLevel = 'M') {
  const byteLength = payloadByteLength(text);
  for (const spec of VERSIONS_A) {
    const capacity = capacityForA(spec, eccLevel);
    if (byteLength <= capacity.maxPayloadBytes) return spec;
  }
  const last = VERSIONS_A[VERSIONS_A.length - 1];
  throw new RangeError(
    `페이로드 ${byteLength} B 는 ${last.name}(ECC-${eccLevel}) 용량을 초과한다`,
  );
}

/**
 * Type A 인코더 파이프라인 진입점. version 을 생략하면 `chooseVersionA` 로
 * 자동 선택한다.
 * @param {string} text UTF-8 페이로드
 * @param {{version?: number, eccLevel?: 'L'|'M'|'H', centerQr?: boolean}} [options]
 * @returns {{
 *   version: number, k: number, eccLevel: 'L'|'M'|'H', centerQr: boolean, formatIndex: number,
 *   capacity: object,
 *   codewordSymbols: Uint8Array,
 *   dataDigits: Uint8Array,
 *   fillerDigits: Uint8Array,
 *   formatDigits: number[],
 *   cellDigits: Map<string, {digit:number, role:'anchor'|'reference'|'format'|'data'|'filler'}>,
 * }}
 */
export function encodeA(text, options = {}) {
  // encode.js(Type O) 전례: version 명시 경로가 chooseVersionA(→ payloadByteLength
  // 의 타입 검사)를 건너뛰면 TextEncoder 가 undefined → '' 로 조용히 강제 변환한다.
  // 두 경로의 판정을 여기서 먼저 일치시킨다.
  if (typeof text !== 'string') {
    throw new TypeError(`페이로드는 문자열이어야 한다: ${typeof text}`);
  }
  const { version, eccLevel = 'M', centerQr = false } = options;
  if (typeof centerQr !== 'boolean') {
    throw new TypeError(`centerQr 는 boolean 이어야 한다: ${typeof centerQr}`);
  }

  const spec = version === undefined ? chooseVersionA(text, eccLevel) : versionSpecA(version);

  const capacity = capacityForA(spec, eccLevel);
  const { k } = spec;

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

  // 심볼 → 3 digit(MSD-first, 프리마스크) → scan order-A 좌표에 마스크 가산.
  //
  // `dataCellsInScanOrderA(k)` 는 role === 'data' 인 셀 **전부**(= dataCells 개,
  // capacity.dataCells)를 돌려준다 — 그중 앞 3S 개가 실제 심볼 3-digit 그룹이고
  // 나머지(residualCells 개, = `fillerCellsA(k)` 와 정확히 같은 셀)가 필러다
  // (layoutA.js `symbolCellGroupsA`/`fillerCellsA` 의 분할과 동일하게 슬라이스한다).
  const preMaskDataDigits = unpackSymbolsToCellDigits(codewordSymbols); // 길이 3S
  const scanCells = dataCellsInScanOrderA(k);
  if (scanCells.length !== capacity.dataCells) {
    throw new RangeError(
      `scan order-A 셀 수 불일치: dataCellsInScanOrderA() ${scanCells.length} !== capacity.dataCells ${capacity.dataCells}`,
    );
  }
  const dataCellCoords = scanCells.slice(0, preMaskDataDigits.length);
  const dataDigits = new Uint8Array(preMaskDataDigits.length);
  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    dataDigits[i] = maskAdd(preMaskDataDigits[i], c.q, c.r);
  }

  // 잔여 셀 = 프리마스크 0 에 마스크 가산(§5.6 준용). scan order-A 의 꼬리와 동일 셀.
  const fillerCoords = fillerCellsA(k);
  if (fillerCoords.length !== capacity.residualCells) {
    throw new RangeError(
      `필러 셀 수 불일치: fillerCellsA() ${fillerCoords.length} !== capacity.residualCells ${capacity.residualCells}`,
    );
  }
  const fillerDigits = new Uint8Array(fillerCoords.length);
  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    fillerDigits[i] = maskAdd(0, c.q, c.r);
  }

  // 포맷 정보(§5.4 승계, D6 네임스페이스): formatIndex(12~15) = spec.formatIndex +
  // centerQr(2) 오프셋 — 12=A1·13=A2·14=A1Q·15=A2Q. 이 인덱스는 파인더 종류
  // (불스아이 vs 중앙 QR)·실루엣(삼각 vs 육각)의 **사후 검증** 축이다(ADR 0004
  // "인덱스=사후 검증" 규약 승계, D6) — 인코더 쪽은 부착까지만 한다.
  const eccLevelValue = ECC_LEVEL[eccLevel];
  if (eccLevelValue === undefined || eccLevelValue === ECC_LEVEL.RESERVED) {
    throw new RangeError(`알 수 없는 ECC 레벨: ${eccLevel}`);
  }
  const formatIndex = spec.formatIndex + (centerQr ? 2 : 0);
  const formatReplicas = encodeReplicated({ version: formatIndex, eccLevel: eccLevelValue });
  const formatDigits = formatReplicas.flat(); // 길이 15, formatCells(k) 순서와 정합

  // 셀별 digit + role 맵 (불스아이 셀은 애초에 어느 목록에도 없으므로 자동 제외).
  const cellDigits = new Map();

  // 앵커 = 육각 코너 3셀(보조, placement.js 무수정) + 꼭짓점 3셀(주, D2) = 6.
  const anchors = [...anchorCells(k), ...vertexAnchors(k)];
  for (const c of anchors) {
    cellDigits.set(cellKey(c.q, c.r), { digit: c.digit, role: 'anchor' });
  }

  // 레퍼런스 = 육각 2(k-2)셀 + 패치 레퍼런스(규칙 R, D4) — 전부 REFERENCE_DIGIT.
  const references = [...referenceCellsAll(k), ...patchReferenceCells(k)];
  for (const c of references) {
    cellDigits.set(cellKey(c.q, c.r), { digit: REFERENCE_DIGIT, role: 'reference' });
  }

  const formatCoords = formatCells(k); // 육각부 무수정 재사용(D7)
  for (let i = 0; i < formatCoords.length; i += 1) {
    const c = formatCoords[i];
    cellDigits.set(cellKey(c.q, c.r), { digit: formatDigits[i], role: 'format' });
  }

  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    cellDigits.set(cellKey(c.q, c.r), { digit: dataDigits[i], role: 'data' });
  }

  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    cellDigits.set(cellKey(c.q, c.r), { digit: fillerDigits[i], role: 'filler' });
  }

  return {
    version: spec.version,
    k,
    eccLevel,
    centerQr,
    formatIndex,
    capacity,
    codewordSymbols,
    dataDigits,
    fillerDigits,
    formatDigits,
    cellDigits,
  };
}
