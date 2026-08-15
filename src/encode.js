// encode.js — 인코더 파이프라인 통합 (SPEC §7.1)
//
// UTF-8 페이로드 → 길이 헤더 1B 부착 → 0x00 패딩(고정 K까지) → base-211 심볼
// 변환(27B↔28심볼, MSD-first) → RS(GF(211)) 패리티 → 코드워드 = 심볼 열 S개 →
// 심볼 → 3 digit(MSD-first) → 마스크 가산 → scan order 로 셀 배치 → 잔여 셀에
// 필러(프리마스크 0) → digit 확정까지. 배정(digit → (T,L,R) rank)·렌더는 다른
// 모듈 몫이다 — 여기서는 셀별 digit 확정까지만 한다.
//
// 이 모듈은 새 규약을 만들지 않는다 — capacity.js/header.js/base211.js/rs211.js/
// mask.js/formatinfo.js/layout.js/placement.js 가 이미 확정한 조각을 파이프라인
// 순서대로 조합만 한다.

import { VERSIONS, capacityFor } from './capacity.js';
import { frame, payloadByteLength } from './header.js';
import { bytesToSymbols, unpackSymbolsToCellDigits } from './base211.js';
import { rsEncode } from './rs211.js';
import { maskAdd } from './mask.js';
import { encodeReplicated, ECC_LEVEL } from './formatinfo.js';
import { dataCellsInScanOrder, fillerCells } from './layout.js';
import {
  anchorCells,
  referenceCellsAll,
  REFERENCE_DIGIT,
  formatCells,
} from './placement.js';
import {
  VERSIONS_OCM,
  capacityForOMarker,
  markerCells,
  formatCellsOMarker,
  referenceCellsOMarker,
  dataCellsInScanOrderOMarker,
  fillerCellsOMarker,
} from './markerO.js';

function cellKey(q, r) {
  return `${q},${r}`;
}

/**
 * 레이아웃 공급자 — 레거시 O 와 O-CM(코너 마커)의 차이를 여기 한 곳에 모은다.
 * 파이프라인(헤더·base211·RS·마스크·포맷 정보)은 두 경로가 완전히 같다.
 */
function layoutProviderFor(cornerMarker) {
  if (!cornerMarker) {
    return {
      versions: VERSIONS,
      capacity: capacityFor,
      scan: dataCellsInScanOrder,
      filler: fillerCells,
      format: formatCells,
      reference: referenceCellsAll,
      // 레거시는 앵커 3셀만 — 마커 셀이 없다.
      fixed: (k) => anchorCells(k).map((c) => ({ ...c, role: 'anchor' })),
    };
  }
  return {
    versions: VERSIONS_OCM,
    capacity: capacityForOMarker,
    scan: dataCellsInScanOrderOMarker,
    filler: fillerCellsOMarker,
    format: formatCellsOMarker,
    reference: referenceCellsOMarker,
    // 코너 마커 12셀 = 앵커 3(digit 5/0/0, 레거시 계약 그대로) + 마커 9.
    fixed: (k) => markerCells(k).map((c) => ({
      q: c.q, r: c.r, digit: c.digit, role: c.role,
    })),
  };
}

/**
 * 페이로드 바이트 길이가 들어가는 최소 VERSIONS 항목을 고른다.
 * V3(ECC-eccLevel) 도 초과하면 RangeError.
 * @param {string} text
 * @param {'L'|'M'|'H'} [eccLevel]
 * @returns {{version:number, k:number, overhead:number, symbolKey:string}} VERSIONS 원소
 */
export function chooseVersion(text, eccLevel = 'M', cornerMarker = false) {
  const byteLength = payloadByteLength(text);
  const provider = layoutProviderFor(cornerMarker);
  for (const spec of provider.versions) {
    const capacity = provider.capacity(spec, eccLevel);
    if (byteLength <= capacity.maxPayloadBytes) return spec;
  }
  const last = provider.versions[provider.versions.length - 1];
  throw new RangeError(
    `페이로드 ${byteLength} B 는 V${last.version}${cornerMarker ? 'CM' : ''}(ECC-${eccLevel}) 용량을 초과한다`,
  );
}

/**
 * 인코더 파이프라인 진입점 (SPEC §7.1). version 을 생략하면 `chooseVersion` 으로
 * 자동 선택한다.
 * @param {string} text UTF-8 페이로드
 * @param {{version?: number, eccLevel?: 'L'|'M'|'H', centerQr?: boolean}} [options]
 * @returns {{
 *   version: number, k: number, eccLevel: 'L'|'M'|'H', centerQr: boolean,
 *   capacity: object,
 *   codewordSymbols: Uint8Array,
 *   dataDigits: Uint8Array,
 *   fillerDigits: Uint8Array,
 *   formatDigits: number[],
 *   cellDigits: Map<string, {digit:number, role:'anchor'|'reference'|'format'|'data'|'filler'}>,
 * }}
 */
export function encode(text, options = {}) {
  // version 명시 경로는 chooseVersion(→ payloadByteLength 의 타입 검사)을 건너뛰는데,
  // TextEncoder 는 undefined → '' · 숫자 → 문자열로 조용히 강제 변환한다 — 호출자의
  // undefined 실수가 유효해 보이는 빈 코드로 렌더된다. 두 경로의 판정을 일치시킨다
  // (T9 검증 라운드 발견).
  if (typeof text !== 'string') {
    throw new TypeError(`페이로드는 문자열이어야 한다: ${typeof text}`);
  }
  const {
    version, eccLevel = 'M', centerQr = false, cornerMarker = false,
  } = options;
  if (typeof centerQr !== 'boolean') {
    throw new TypeError(`centerQr 는 boolean 이어야 한다: ${typeof centerQr}`);
  }
  if (typeof cornerMarker !== 'boolean') {
    throw new TypeError(`cornerMarker 는 boolean 이어야 한다: ${typeof cornerMarker}`);
  }
  // 코너 마커는 중앙 슬롯을 안 건드리지만, 중앙 QR 은 링3 을 먹고 마커는 링 k·k−1 을
  // 먹는다 — 두 변형의 동시 사용은 배치 검증을 안 했으므로 조용히 허용하지 않는다.
  if (cornerMarker && centerQr) {
    throw new RangeError('cornerMarker 와 centerQr 를 동시에 켤 수 없다 — 배치 검증 미실시 조합이다');
  }
  const provider = layoutProviderFor(cornerMarker);

  const spec = version === undefined
    ? chooseVersion(text, eccLevel, cornerMarker)
    : provider.versions.find((v) => v.version === version);
  if (!spec) {
    throw new RangeError(`알 수 없는 버전: ${version} (허용 ${provider.versions.map((v) => v.version).join(', ')})`);
  }

  const capacity = provider.capacity(spec, eccLevel);
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

  // 심볼 → 3 digit(MSD-first, 프리마스크) → scan order 좌표에 마스크 가산.
  //
  // `dataCellsInScanOrder(k)` 는 role === 'data' 인 셀 **전부**(= dataCells 개,
  // capacity.dataCells)를 돌려준다 — 그중 앞 3S 개가 실제 심볼 3-digit 그룹이고
  // 나머지 (residualCells 개, = `fillerCells(k)` 와 정확히 같은 셀)가 필러다
  // (layout.js `symbolCellGroups`/`fillerCells` 의 분할과 동일하게 여기서도 슬라이스한다).
  const preMaskDataDigits = unpackSymbolsToCellDigits(codewordSymbols); // 길이 3S
  const scanCells = provider.scan(k);
  if (scanCells.length !== capacity.dataCells) {
    throw new RangeError(
      `scan order 셀 수 불일치: dataCellsInScanOrder() ${scanCells.length} !== capacity.dataCells ${capacity.dataCells}`,
    );
  }
  const dataCellCoords = scanCells.slice(0, preMaskDataDigits.length);
  const dataDigits = new Uint8Array(preMaskDataDigits.length);
  for (let i = 0; i < dataCellCoords.length; i += 1) {
    const c = dataCellCoords[i];
    dataDigits[i] = maskAdd(preMaskDataDigits[i], c.q, c.r);
  }

  // 잔여 셀 = 프리마스크 0 에 마스크 가산(§5.6 필러). scan order 의 꼬리와 동일 셀.
  const fillerCoords = provider.filler(k);
  if (fillerCoords.length !== capacity.residualCells) {
    throw new RangeError(
      `필러 셀 수 불일치: fillerCells() ${fillerCoords.length} !== capacity.residualCells ${capacity.residualCells}`,
    );
  }
  const fillerDigits = new Uint8Array(fillerCoords.length);
  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    fillerDigits[i] = maskAdd(0, c.q, c.r);
  }

  // 포맷 정보(§5.4): 버전 인덱스 = version − 1(V1→0…), eccLevel 문자 → formatinfo 매핑.
  // centerQr(V*Q, ADR 0004 §1-3): 인덱스에 +4 오프셋 — V1Q=4·V2Q=5·V3Q=6. 이 인덱스는
  // 파인더 종류의 **사후 검증**이다(디코더가 발견한 파인더 종류와 복호 인덱스가
  // 일치하는지 대조) — 여기 인코더 쪽은 오프셋 부착까지만 한다.
  const eccLevelValue = ECC_LEVEL[eccLevel];
  if (eccLevelValue === undefined || eccLevelValue === ECC_LEVEL.RESERVED) {
    throw new RangeError(`알 수 없는 ECC 레벨: ${eccLevel}`);
  }
  const versionIndex = (spec.version - 1) + (centerQr ? 4 : 0);
  const formatReplicas = encodeReplicated({ version: versionIndex, eccLevel: eccLevelValue });
  const formatDigits = formatReplicas.flat(); // 길이 15, formatCells(k) 순서와 정합

  // 셀별 digit + role 맵 (불스아이 셀은 애초에 어느 목록에도 없으므로 자동 제외).
  const cellDigits = new Map();

  // 앵커(+O-CM 이면 마커 9셀). 각 원소가 이미 digit 을 들고 있다 — 마스크 없음.
  const fixedCells = provider.fixed(k);
  for (const c of fixedCells) {
    cellDigits.set(cellKey(c.q, c.r), { digit: c.digit, role: c.role });
  }

  const references = provider.reference(k); // 전부 REFERENCE_DIGIT — 마스크 없음.
  for (const c of references) {
    cellDigits.set(cellKey(c.q, c.r), { digit: REFERENCE_DIGIT, role: 'reference' });
  }

  const formatCoords = provider.format(k);
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
    cornerMarker,
    capacity,
    codewordSymbols,
    dataDigits,
    fillerDigits,
    formatDigits,
    cellDigits,
  };
}
