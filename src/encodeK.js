// encodeK.js — Type K(육각별) 인코더 파이프라인 통합 (encodeA.js 대칭, 계약 K-3·K-4·K-6)
//
// UTF-8 페이로드 → 길이 헤더 1B 부착 → 0x00 패딩(고정 dataBytes까지) → base-211
// 심볼 변환(27B↔28심볼, MSD-first) → RS(GF(211)) 패리티 → 코드워드 = 심볼 열 S개
// → 심볼 → 3 digit(MSD-first) → 마스크 가산 → scan order-K 로 셀 배치 → 잔여 셀에
// 필러(프리마스크 0 + 마스크) → digit 확정까지. 배정(digit → rank)·렌더는 다른
// 모듈 몫이다.
//
// 이 모듈은 새 규약을 만들지 않는다 — capacityK.js/formatK.js/header.js/base211.js/
// rs211.js/mask.js/formatinfo.js/layoutK.js/placementK.js/placement.js(육각부 무수정
// 재사용)가 이미 확정한 조각을 파이프라인 순서대로 조합만 한다.
//
// [옵션 배타 — 배치 검증 미실시 조합은 던진다 (encodeA 문법)]
//   centerQr / centralV0 / cornerMarker(K-CM) / daehanFinder / turnA 전부 **보류**다:
//   · centerQr·centralV0·daehanFinder — 중앙 슬롯·예약 셀과 K 회계의 조합이 미검증.
//     기하상 후보(중앙 19셀 슬롯은 K 코어에도 그대로 있다)지만 배타 개설 정형 3단
//     (근거 실측 → 표 명시 확장 → 구 락의 양성 전환)을 밟기 전엔 열지 않는다.
//   · cornerMarker(K-CM) — H2CO3 발자국이 반전 꼭짓점 앵커(digit 1, 통합자 확정)
//     자리를 포함해(계약 K-6 (b) 실측) fixed 회계가 미해소다(계약 K-8.1).
//     레인 보고서 §보류에 선택지를 실었다.
//   · turnA — K = A ∪ 반전A 라 180° 회전이 실루엣을 보존한다(육각별 자기 대칭).
//     «턴 K» 는 별도 실루엣이 아니므로 옵션 자체가 성립하지 않는다.

import { VERSIONS_K, capacityForK } from './capacityK.js';
import { frame, payloadByteLength } from './header.js';
import { bytesToSymbols, unpackSymbolsToCellDigits } from './base211.js';
import { rsEncode } from './rs211.js';
import { maskAdd } from './mask.js';
import { encodeReplicated, ECC_LEVEL } from './formatinfo.js';
import { dataCellsInScanOrderK, fillerCellsK } from './layoutK.js';
import { anchorCells, referenceCellsAll, formatCells, REFERENCE_DIGIT } from './placement.js';
import { vertexAnchorsK, patchReferenceCellsK } from './placementK.js';

function cellKey(q, r) {
  return `${q},${r}`;
}

/**
 * 페이로드 바이트 길이가 들어가는 최소 VERSIONS_K 항목을 고른다.
 * K2(ECC-eccLevel) 도 초과하면 RangeError.
 * @param {string} text
 * @param {'L'|'M'|'H'} [eccLevel]
 */
export function chooseVersionK(text, eccLevel = 'M') {
  const byteLength = payloadByteLength(text);
  for (const spec of VERSIONS_K) {
    const capacity = capacityForK(spec, eccLevel);
    if (byteLength <= capacity.maxPayloadBytes) return spec;
  }
  const last = VERSIONS_K[VERSIONS_K.length - 1];
  throw new RangeError(
    `페이로드 ${byteLength} B 는 ${last.name}(ECC-${eccLevel}) 용량을 초과한다`,
  );
}

/**
 * Type K 인코더 파이프라인 진입점. version 을 생략하면 chooseVersionK 로 자동 선택.
 * @param {string} text UTF-8 페이로드
 * @param {{version?: number, eccLevel?: 'L'|'M'|'H'}} [options]
 * @returns {{
 *   version:number, k:number, eccLevel:'L'|'M'|'H', formatIndex:number,
 *   capacity:object, codewordSymbols:Uint8Array, dataDigits:Uint8Array,
 *   fillerDigits:Uint8Array, formatDigits:number[],
 *   cellDigits: Map<string, {digit:number, role:'anchor'|'reference'|'format'|'data'|'filler'}>,
 * }}
 */
export function encodeK(text, options = {}) {
  // encodeA 전례: version 명시 경로가 payloadByteLength 의 타입 검사를 건너뛰면
  // TextEncoder 가 undefined → '' 로 조용히 강제 변환한다. 판정을 먼저 일치시킨다.
  if (typeof text !== 'string') {
    throw new TypeError(`페이로드는 문자열이어야 한다: ${typeof text}`);
  }
  const { version, eccLevel = 'M' } = options;
  // 배타 가드 — 모듈 헤더 §옵션 배타. 조용한 무시는 «와이어와 그림이 어긋난
  // 자기모순 아티팩트» 의 씨앗이라 명시 값이 오면 던진다.
  for (const [name, reason] of [
    ['centerQr', '중앙 QR × K 회계는 배치 검증 미실시 조합이다'],
    ['centralV0', '중앙 v0 비컨 × K 는 배치 검증 미실시 조합이다'],
    ['cornerMarker', 'K-CM 은 보류다 — fixed 회계 미해소 (계약 K-8.1, 레인 보고서 §보류)'],
    ['daehanFinder', 'daehan × K 는 배치 검증 미실시 조합이다'],
    ['turnA', 'K 실루엣은 180° 자기 대칭이라 턴 옵션이 성립하지 않는다'],
  ]) {
    if (options[name] !== undefined && options[name] !== false) {
      throw new RangeError(`Type K 는 ${name} 를 지원하지 않는다 — ${reason}`);
    }
  }

  let spec;
  if (version === undefined) {
    spec = chooseVersionK(text, eccLevel);
  } else {
    spec = VERSIONS_K.find((entry) => entry.version === version);
    if (!spec) {
      throw new RangeError(`알 수 없는 Type K 버전: ${version}`);
    }
  }

  const capacity = capacityForK(spec, eccLevel);
  const { k } = spec;

  // 길이 헤더 + 0x00 패딩 → base-211 심볼.
  const framed = frame(text, capacity.dataBytes);
  const symbols = bytesToSymbols(framed);
  if (symbols.length !== capacity.dataSymbols) {
    throw new RangeError(
      `심볼 개수 불일치: bytesToSymbols() ${symbols.length} !== capacity.dataSymbols ${capacity.dataSymbols}`,
    );
  }

  // RS(GF(211)) 패리티 부착 → 코드워드.
  const codewordSymbols = rsEncode(symbols, capacity.nsym);
  if (codewordSymbols.length !== capacity.usedSymbols) {
    throw new RangeError(
      `코드워드 심볼 개수 불일치: rsEncode() ${codewordSymbols.length} !== capacity.usedSymbols ${capacity.usedSymbols}`,
    );
  }

  // 심볼 → 3 digit(MSD-first, 프리마스크) → scan order-K 좌표에 마스크 가산.
  const preMaskDataDigits = unpackSymbolsToCellDigits(codewordSymbols); // 길이 3S
  const scanCells = dataCellsInScanOrderK(k);
  if (scanCells.length !== capacity.dataCells) {
    throw new RangeError(
      `scan order-K 셀 수 불일치: dataCellsInScanOrderK() ${scanCells.length} !== capacity.dataCells ${capacity.dataCells}`,
    );
  }
  const dataCellCoords = scanCells.slice(0, preMaskDataDigits.length);
  const dataDigits = new Uint8Array(preMaskDataDigits.length);
  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    dataDigits[i] = maskAdd(preMaskDataDigits[i], c.q, c.r);
  }

  // 잔여 셀 = 프리마스크 0 에 마스크 가산(§5.6 준용). scan order-K 의 꼬리와 동일 셀.
  const fillerCoords = fillerCellsK(k);
  if (fillerCoords.length !== capacity.residualCells) {
    throw new RangeError(
      `필러 셀 수 불일치: fillerCellsK() ${fillerCoords.length} !== capacity.residualCells ${capacity.residualCells}`,
    );
  }
  const fillerDigits = new Uint8Array(fillerCoords.length);
  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    fillerDigits[i] = maskAdd(0, c.q, c.r);
  }

  // 포맷 정보 — formatIndex 는 star 축 표(formatK.js)가 정본이다 (전 버전 7,
  // k 로 가른다). 인코더 쪽은 부착까지만 한다 (ADR 0004 «인덱스=사후 검증» 승계).
  const eccLevelValue = ECC_LEVEL[eccLevel];
  if (eccLevelValue === undefined || eccLevelValue === ECC_LEVEL.RESERVED) {
    throw new RangeError(`알 수 없는 ECC 레벨: ${eccLevel}`);
  }
  const formatIndex = spec.formatIndex;
  const formatReplicas = encodeReplicated({ version: formatIndex, eccLevel: eccLevelValue });
  const formatDigits = formatReplicas.flat(); // 길이 15, formatCells(k) 순서와 정합

  // 셀별 digit + role 맵 (불스아이 셀은 애초에 어느 목록에도 없으므로 자동 제외).
  const cellDigits = new Map();

  // 앵커 = 육각 코너 3셀(보조, placement.js 무수정) + 별 꼭짓점 6셀(주, K-2) = 9.
  const anchors = [...anchorCells(k), ...vertexAnchorsK(k)];
  for (const c of anchors) {
    cellDigits.set(cellKey(c.q, c.r), { digit: c.digit, role: 'anchor' });
  }

  // 레퍼런스 = 육각 2(k-2)셀 + 패치 레퍼런스(규칙 R′) — 전부 REFERENCE_DIGIT.
  const references = [...referenceCellsAll(k), ...patchReferenceCellsK(k)];
  for (const c of references) {
    cellDigits.set(cellKey(c.q, c.r), { digit: REFERENCE_DIGIT, role: 'reference' });
  }

  const formatCoords = formatCells(k); // 육각부 무수정 재사용
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
    formatIndex,
    capacity,
    codewordSymbols,
    dataDigits,
    fillerDigits,
    formatDigits,
    cellDigits,
  };
}
