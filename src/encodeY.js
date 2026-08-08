// encodeY.js — Type Y 인코더 파이프라인 통합 (SPEC §14, encode.js 대칭)
//
// UTF-8 페이로드 → 길이 헤더 1B 부착 → 0x00 패딩(고정 dataBytes까지) → base-211 심볼
// 변환(27B↔28심볼, MSD-first) → RS(GF(211)) 패리티 → 코드워드 = 심볼 열 S개 →
// 심볼 → 3 digit(MSD-first) → 마스크 가산 → scan order-Y 로 셀 배치 → 잔여 셀에
// 필러(프리마스크 0 + 마스크) → digit 확정까지. 배정(digit → 3면 상대 휘도 순위)·
// 렌더는 다른 모듈 몫이다 — 여기서는 셀별 digit 확정까지만 한다.
//
// 이 모듈은 새 규약을 만들지 않는다 — capacityY.js/header.js/base211.js/rs211.js/
// mask.js/formatinfo.js/layoutY.js/placementY.js 가 이미 확정한 조각을 파이프라인
// 순서대로 조합만 한다. nsym 은 rs211.js 의 NSYM_TABLE(Type O)이 아니라 capacityY.js
// 의 NSYM_TABLE_Y(Type Y, [U3] 잠정)를 쓴다 — capacityForY 가 이미 그 표를 참조한다.

import { VERSIONS_Y, capacityForY } from './capacityY.js';
import { frame, payloadByteLength } from './header.js';
import { bytesToSymbols, unpackSymbolsToCellDigits } from './base211.js';
import { rsEncode } from './rs211.js';
import { maskAdd } from './mask.js';
import { encodeReplicated, ECC_LEVEL } from './formatinfo.js';
import { dataCellsInScanOrder, fillerCells } from './layoutY.js';
import { referenceCellsAll, formatCells } from './placementY.js';

// 포맷 정보 버전 인덱스 네임스페이스 분할 (SPEC §14): 0~7 = Type O V1~V8,
// 8~15 = Type Y Y1~Y8 (Y1→8, Y2→9). Type Y 는 spec.version(1,2,...) 에 이 오프셋을
// 더해 formatinfo 의 version 필드를 채운다.
const FORMAT_VERSION_OFFSET_Y = 8;

function cellKey(i, j) {
  return `${i},${j}`;
}

/**
 * 페이로드 바이트 길이가 들어가는 최소 VERSIONS_Y 항목을 고른다.
 * 마지막 항목도 초과하면 RangeError.
 * @param {string} text
 * @param {'L'|'M'|'H'} [eccLevel]
 * @returns {{version:number, n:number, overhead:number, symbolKey:string}} VERSIONS_Y 원소
 */
export function chooseVersionY(text, eccLevel = 'M') {
  const byteLength = payloadByteLength(text);
  for (const spec of VERSIONS_Y) {
    const capacity = capacityForY(spec, eccLevel);
    if (byteLength <= capacity.maxPayloadBytes) return spec;
  }
  const last = VERSIONS_Y[VERSIONS_Y.length - 1];
  throw new RangeError(
    `페이로드 ${byteLength} B 는 Y${last.version}(ECC-${eccLevel}) 용량을 초과한다`,
  );
}

/**
 * Type Y 인코더 파이프라인 진입점 (SPEC §14). version 을 생략하면
 * `chooseVersionY` 로 자동 선택한다.
 * @param {string} text UTF-8 페이로드
 * @param {{version?: number, eccLevel?: 'L'|'M'|'H'}} [options]
 * @returns {{
 *   version: number, n: number, eccLevel: 'L'|'M'|'H',
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
  const { version, eccLevel = 'M' } = options;

  const spec = version === undefined
    ? chooseVersionY(text, eccLevel)
    : VERSIONS_Y.find((v) => v.version === version);
  if (!spec) {
    throw new RangeError(`알 수 없는 Type Y 버전: ${version} (허용 ${VERSIONS_Y.map((v) => v.version).join(', ')})`);
  }

  const capacity = capacityForY(spec, eccLevel);
  const { n } = spec;

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
  const scanCells = dataCellsInScanOrder(n);
  if (scanCells.length !== capacity.dataCells) {
    throw new RangeError(
      `scan order-Y 셀 수 불일치: dataCellsInScanOrder() ${scanCells.length} !== capacity.dataCells ${capacity.dataCells}`,
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
  const fillerCoords = fillerCells(n);
  if (fillerCoords.length !== capacity.residualCells) {
    throw new RangeError(
      `필러 셀 수 불일치: fillerCells() ${fillerCoords.length} !== capacity.residualCells ${capacity.residualCells}`,
    );
  }
  const fillerDigits = new Uint8Array(fillerCoords.length);
  for (let i = 0; i < fillerCoords.length; i += 1) {
    const c = fillerCoords[i];
    fillerDigits[i] = maskAdd(0, c.i, c.j);
  }

  // 포맷 정보(§5.4 승계): 버전 인덱스 네임스페이스 8~15(Y1→8, Y2→9), eccLevel 문자
  // → formatinfo 매핑. formatCells(n) 순서로 15셀에 배치한다.
  const eccLevelValue = ECC_LEVEL[eccLevel];
  if (eccLevelValue === undefined || eccLevelValue === ECC_LEVEL.RESERVED) {
    throw new RangeError(`알 수 없는 ECC 레벨: ${eccLevel}`);
  }
  const formatReplicas = encodeReplicated({
    version: FORMAT_VERSION_OFFSET_Y + (spec.version - 1),
    eccLevel: eccLevelValue,
  });
  const formatDigits = formatReplicas.flat(); // 길이 15, formatCells(n) 순서와 정합

  // 셀별 digit + role 맵. Type Y 는 불스아이·앵커가 없다(reference | format | data | filler).
  const cellDigits = new Map();

  const references = referenceCellsAll(n); // 각 원소가 이미 REFERENCE_GROUP_DIGITS 를 들고 있다 — 마스크 없음.
  for (const c of references) {
    cellDigits.set(cellKey(c.i, c.j), { digit: c.digit, role: 'reference' });
  }

  const formatCoords = formatCells(n);
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
    capacity,
    codewordSymbols,
    dataDigits,
    fillerDigits,
    formatDigits,
    cellDigits,
  };
}
