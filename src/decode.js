// decode.js — Type O/A/Y 후단 디코더 (SPEC §7.2)
//
// 이 모듈의 입력 경계는 "셀별 3면 순위 → digit"이 끝난 직후다. 따라서 Lehmer
// 순위 해석과 포맷 정보 3중 복제 판독은 앞단의 책임이며, 여기서는 이미 확정된
// scan-order digit 및 패밀리가 해석된 format만 받는다.
//
// 역순서는 encode*.js와 정확히 짝을 이룬다:
//
//   masked cell digit → maskSub → 3 digit/GF(211) symbol → RS decode
//   → base-211 chunk decode → header unframe → UTF-8 text
//
// Type Y의 QR-window 변형만은 encodeY.js 안의 로컬 scan 함수가 공개되지 않았다.
// 같은 공개 좌표 계약(capacityY.js의 windowed *CellsY)에서 동일한 래스터 순서를
// 여기서 재구성한다. 나머지 타입은 각 layout 모듈의 canonical scan 함수를 쓴다.

import { VERSIONS, capacityFor } from './capacity.js';
import { VERSIONS_A, capacityForA } from './capacityA.js';
import {
  VERSIONS_Y,
  capacityForY,
  capacityForY2Window,
  windowedReferenceCellsY,
  windowedFormatCellsY,
  windowExcludedCellsY,
} from './capacityY.js';
import {
  capacityForCellSurfaceY,
  dataCellsInScanOrderCellSurface,
  isCellSurfaceFormatIndex,
  tonesFromCellSurfaceFormatIndex,
} from './cellSurfaceY.js';
import {
  CELL_SURFACE_LAYOUT_V1R2,
  capacityForCellSurfaceLayout,
  dataCellsInScanOrderCellSurfaceLayout,
  isCellSurfaceLayoutFormatIndex,
  layoutIdFromFormatIndex,
  tonesFromCellSurfaceLayoutFormatIndex,
} from './cellSurfaceLayouts.js';
import {
  assertCellSurfaceFinalN,
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdForN,
  isCellSurfaceFinalFormatIndex,
  isCellSurfaceFinalId,
  tonesFromCellSurfaceFinalFormatIndex,
} from './cellSurfaceFinal.js';
import {
  CHUNK_BYTES,
  decodeChunkInto,
  packCellDigitsToSymbols,
  symbolCountForByteLength,
} from './base211.js';
import { rsDecode } from './rs211.js';
import { maskSub } from './mask.js';
import { unframe } from './header.js';
import { dataCellsInScanOrder as dataCellsInScanOrderO } from './layout.js';
import { dataCellsInScanOrderA } from './layoutA.js';
import { dataCellsInScanOrder as dataCellsInScanOrderY } from './layoutY.js';

/**
 * rs211.js는 소거 위치를 받는 API를 제공하지 않는다. 불법 3-digit 조합은 아래
 * 모드에서 0으로 대체하여 "위치를 모르는 일반 심볼 오류"로만 취급한다. 따라서
 * 소거 복호의 2e+s 한계가 아니라 rsDecode의 일반 오류 한계 t가 적용된다.
 */
export const RS211_ERASURE_MODE = 'error-only-fallback';

const ILLEGAL_SYMBOL_PLACEHOLDER = 0;
const ECC_LEVEL_BY_VALUE = Object.freeze({ 0: 'L', 1: 'M', 2: 'H' });

function fail(stage, cause) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return { ok: false, reason: stage + ': ' + detail };
}

function normalizeEccLevel(value) {
  if (value === 'L' || value === 'M' || value === 'H') return value;
  if (Number.isInteger(value) && ECC_LEVEL_BY_VALUE[value] !== undefined) {
    return ECC_LEVEL_BY_VALUE[value];
  }
  throw new RangeError('eccLevel은 L, M, H 또는 formatinfo.js의 값 0, 1, 2여야 한다: ' + value);
}

function assertOptionalDimension(value, name, expected) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value !== expected) {
    throw new RangeError(name + '가 선택한 버전의 격자 크기와 다르다: ' + value + ' !== ' + expected);
  }
}

function yKey(i, j) {
  return i + ',' + j;
}

/**
 * encodeY.js의 windowedDataCellsInScanOrder와 같은 규약이다. 그 함수는 의도적으로
 * encodeY.js의 로컬 구현이므로, 여기서는 공개된 재배치/제외 좌표만 조합한다.
 */
function windowedDataCellsInScanOrderY(n, tones) {
  const references = new Set(
    windowedReferenceCellsY(n, tones).map((cell) => yKey(cell.i, cell.j)),
  );
  const formats = new Set(windowedFormatCellsY(n).map((cell) => yKey(cell.i, cell.j)));
  const excluded = new Set(windowExcludedCellsY(n).map((cell) => yKey(cell.i, cell.j)));
  const out = [];

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const key = yKey(i, j);
      if (references.has(key) || formats.has(key) || excluded.has(key)) continue;
      out.push({ i, j });
    }
  }
  return out;
}

function finishProfile(profile) {
  const symbolDigits = profile.capacity.usedSymbols * 3;
  if (profile.scan.length !== profile.capacity.dataCells) {
    throw new Error(
      'scan order 셀 수 불일치: ' + profile.scan.length
      + ' !== capacity.dataCells ' + profile.capacity.dataCells,
    );
  }
  if (symbolDigits + profile.capacity.residualCells !== profile.scan.length) {
    throw new Error(
      '심볼 digit/필러 회계 불일치: ' + symbolDigits + ' + '
      + profile.capacity.residualCells + ' !== ' + profile.scan.length,
    );
  }
  const expectedDataSymbols = symbolCountForByteLength(profile.capacity.dataBytes);
  if (expectedDataSymbols !== profile.capacity.dataSymbols) {
    throw new Error(
      'base-211 data 심볼 수 불일치: ' + expectedDataSymbols
      + ' !== capacity.dataSymbols ' + profile.capacity.dataSymbols
      + ' — 이 포맷은 현행 인코더가 생성할 수 없다',
    );
  }
  return { ...profile, symbolDigits };
}

/**
 * 포맷 정보의 version은 패밀리 안에서 두 해석이 가능하다. 논리 버전은 encode 계열의
 * version이고, raw format-index는 formatinfo.decode가 돌려주는 값이다. formatIndex를
 * 명시하면 항상 raw로 읽고, version만 주면 k/n 및 tones로 후보를 좁힌 뒤 논리 버전
 * 호환성을 우선한다. 그래서 앞단의 formatinfo 결과를 k/n과 함께 바로 넘길 수 있다.
 */
function uniqueSpecs(specs) {
  const out = [];
  for (const spec of specs) {
    if (spec && !out.includes(spec)) out.push(spec);
  }
  return out;
}

function selectVersionSpec(options) {
  const {
    type,
    logicalSpec,
    rawSpec,
    rawExplicit,
    dimension,
    dimensionName,
    requestedDimension,
    requestedTones,
  } = options;
  let candidates = uniqueSpecs(rawExplicit ? [rawSpec] : [rawSpec, logicalSpec]);

  if (requestedDimension !== undefined) {
    if (!Number.isInteger(requestedDimension)) {
      throw new RangeError(dimensionName + '은 정수여야 한다: ' + requestedDimension);
    }
    candidates = candidates.filter((spec) => spec[dimension] === requestedDimension);
  }
  if (requestedTones !== undefined) {
    candidates = candidates.filter((spec) => spec.tones === requestedTones);
  }
  if (candidates.length === 0) {
    throw new RangeError(
      '알 수 없거나 격자 크기와 맞지 않는 Type ' + type + ' version/formatIndex: '
      + (rawExplicit ? options.formatIndex : options.version),
    );
  }

  // format.version만 쓰던 호출자는 현재 logical version 의미를 유지한다. k/n 또는
  // formatIndex가 있으면 raw format-info 해석이 먼저 유일해지므로 그 경로가 선택된다.
  if (!rawExplicit && logicalSpec && candidates.includes(logicalSpec)) return logicalSpec;
  return candidates[0];
}

function typeOSpecFromFormatIndex(index) {
  if (!Number.isInteger(index)) return undefined;
  let version;
  if (index >= 0 && index <= 2) version = index + 1;
  else if (index >= 4 && index <= 6) version = index - 3;
  else return undefined;
  return VERSIONS.find((spec) => spec.version === version);
}

function typeASpecFromFormatIndex(index) {
  if (!Number.isInteger(index)) return undefined;
  return VERSIONS_A.find(
    (spec) => spec.formatIndex === index || spec.formatIndex + 2 === index,
  );
}

function typeYSpecFromFormatIndex(index) {
  if (!Number.isInteger(index)) return undefined;
  return VERSIONS_Y.find((spec) => spec.formatIndex === index);
}

function rawFormatIndex(format) {
  return format.formatIndex === undefined ? format.version : format.formatIndex;
}

function resolveProfile(format) {
  if (!format || typeof format !== 'object' || Array.isArray(format)) {
    throw new TypeError('format은 객체여야 한다');
  }

  const type = format.type === undefined ? 'O' : format.type;
  const eccLevel = normalizeEccLevel(format.eccLevel);
  const rawExplicit = format.formatIndex !== undefined;
  const formatIndex = rawFormatIndex(format);

  if (type === 'O') {
    const logicalSpec = VERSIONS.find((entry) => entry.version === format.version);
    const spec = selectVersionSpec({
      type,
      logicalSpec,
      rawSpec: typeOSpecFromFormatIndex(formatIndex),
      rawExplicit,
      dimension: 'k',
      dimensionName: 'k',
      requestedDimension: format.k,
      version: format.version,
      formatIndex,
    });
    assertOptionalDimension(format.k, 'k', spec.k);
    return finishProfile({
      type,
      eccLevel,
      capacity: capacityFor(spec, eccLevel),
      scan: dataCellsInScanOrderO(spec.k),
      coordinates: (cell) => [cell.q, cell.r],
    });
  }

  if (type === 'A') {
    const logicalSpec = VERSIONS_A.find((entry) => entry.version === format.version);
    const spec = selectVersionSpec({
      type,
      logicalSpec,
      rawSpec: typeASpecFromFormatIndex(formatIndex),
      rawExplicit,
      dimension: 'k',
      dimensionName: 'k',
      requestedDimension: format.k,
      version: format.version,
      formatIndex,
    });
    assertOptionalDimension(format.k, 'k', spec.k);
    return finishProfile({
      type,
      eccLevel,
      capacity: capacityForA(spec, eccLevel),
      scan: dataCellsInScanOrderA(spec.k),
      coordinates: (cell) => [cell.q, cell.r],
    });
  }

  if (type === 'Y') {
    const suppliedTones = format.tones;
    if (suppliedTones !== undefined && suppliedTones !== 2 && suppliedTones !== 3) {
      throw new RangeError('Type Y tones는 2 또는 3이어야 한다: ' + suppliedTones);
    }
    const logicalSpec = VERSIONS_Y.find(
      (entry) => entry.version === format.version && entry.tones === (suppliedTones === undefined ? 2 : suppliedTones),
    );
    if (format.n !== undefined && format.k !== undefined && format.n !== format.k) {
      throw new RangeError('Type Y n과 k가 다르다: ' + format.n + ' !== ' + format.k);
    }
    const requestedN = format.n === undefined ? format.k : format.n;
    const window = format.window === undefined ? false : format.window;
    if (typeof window !== 'boolean') {
      throw new TypeError('Type Y format.window은 boolean이어야 한다: ' + window);
    }

    // 최종 라인업 (cellSurfaceFinal.js, v0 · v2r2) — formatIndex 는 한 쌍(1/3)뿐이고
    // 레이아웃은 n 으로 정해진다. 디코더 앞단(bootstrap)은 항상 n 을 싣는다.
    // 프로파일 힌트는 **와이어가 초안 슬롯(4/5/6/7)을 말하지 않을 때만** 쓴다 —
    // 'cell-surface-v1r2' 는 최종 v1r2 와 소각된 초안 v1r2d 가 함께 쓰는 문자열이라,
    // formatIndex 가 초안이면 초안 경로로 내려보내야 한다.
    const draftIndexWire = format.formatIndex !== undefined
      && isCellSurfaceLayoutFormatIndex(format.formatIndex);
    const profileHintId = format.locatorProfile === 'cell-surface-v0'
      ? 'v0'
      : format.locatorProfile === 'cell-surface-v2r2'
        ? 'v2r2'
        : format.locatorProfile === 'cell-surface-v1r2'
          ? 'v1r2'
          : null;
    const finalIdHint = isCellSurfaceFinalId(format.cellSurfaceLayout)
      ? format.cellSurfaceLayout
      : (profileHintId !== null && !draftIndexWire ? profileHintId : null);
    const finalRequested = finalIdHint !== null
      || (format.formatIndex !== undefined && isCellSurfaceFinalFormatIndex(format.formatIndex));
    if (finalRequested) {
      if (window) {
        throw new RangeError('Type Y cellSurface와 window를 함께 쓸 수 없다');
      }
      let finalTones = suppliedTones;
      if (format.formatIndex !== undefined) {
        if (!isCellSurfaceFinalFormatIndex(format.formatIndex)) {
          throw new RangeError('신세대 셀 표면 formatIndex 가 아니다: ' + format.formatIndex);
        }
        const fromIndex = tonesFromCellSurfaceFinalFormatIndex(format.formatIndex);
        if (finalTones !== undefined && finalTones !== fromIndex) {
          throw new RangeError(
            '신세대 셀 표면 tones=' + finalTones
            + ' 와 formatIndex=' + format.formatIndex + ' 가 어긋난다',
          );
        }
        finalTones = fromIndex;
      } else {
        finalTones = finalTones === undefined ? 2 : finalTones;
      }
      let finalN = requestedN;
      if (finalN === undefined) {
        if (finalIdHint === 'v0') finalN = 13;
        else if (finalIdHint === 'v1r2') finalN = 21;
        else {
          throw new RangeError('신세대 셀 표면 v2r2 는 format.n(21|25) 이 필요하다');
        }
      }
      if (finalLayoutIdForN(finalN) === null) {
        throw new RangeError('신세대 셀 표면의 n 은 13|21|25 다: ' + finalN);
      }
      if (finalIdHint !== null) assertCellSurfaceFinalN(finalIdHint, finalN);
      // n=21 은 후보가 둘 — 힌트가 없으면 기본(v2r2). 레이아웃 판별은 로케이터·평가 게이트가 한다.
      const finalId = finalIdHint === null ? finalLayoutIdForN(finalN) : finalIdHint;
      return finishProfile({
        type,
        eccLevel,
        capacity: capacityForCellSurfaceFinal(finalN, eccLevel, finalTones, finalId),
        scan: dataCellsInScanOrderCellSurfaceFinal(finalN, finalId),
        coordinates: (cell) => [cell.i, cell.j],
      });
    }

    const layoutId = format.cellSurfaceLayout
      || (format.formatIndex !== undefined
        ? layoutIdFromFormatIndex(format.formatIndex)
        : null)
      || (format.locatorProfile === 'cell-surface-v1r2'
        ? CELL_SURFACE_LAYOUT_V1R2
        : format.locatorProfile === 'cell-surface-v2'
          ? 'v2'
          : null);
    const cellSurface = format.cellSurface === true
      || format.locatorProfile === 'cell-surface-v1'
      || Boolean(layoutId);
    if (cellSurface && window) {
      throw new RangeError('Type Y cellSurface와 window를 함께 쓸 수 없다');
    }
    if (cellSurface && layoutId) {
      let cellSurfaceTones = suppliedTones;
      if (format.formatIndex !== undefined) {
        if (!isCellSurfaceLayoutFormatIndex(format.formatIndex)) {
          throw new RangeError(
            'cell-surface layout formatIndex 가 아니다: ' + format.formatIndex,
          );
        }
        const fromIndex = tonesFromCellSurfaceLayoutFormatIndex(format.formatIndex);
        if (cellSurfaceTones !== undefined && cellSurfaceTones !== fromIndex) {
          throw new RangeError(
            'cell-surface layout tones=' + cellSurfaceTones
            + ' 와 formatIndex=' + format.formatIndex + ' 가 어긋난다',
          );
        }
        cellSurfaceTones = fromIndex;
      } else {
        cellSurfaceTones = cellSurfaceTones === undefined ? 2 : cellSurfaceTones;
      }
      const resolvedLayout = layoutIdFromFormatIndex(format.formatIndex) || layoutId;
      const capacity = capacityForCellSurfaceLayout(resolvedLayout, eccLevel, cellSurfaceTones);
      if (requestedN !== undefined) assertOptionalDimension(format.n, 'n', capacity.n);
      if (format.k !== undefined) assertOptionalDimension(format.k, 'k', capacity.n);
      return finishProfile({
        type,
        eccLevel,
        capacity,
        scan: dataCellsInScanOrderCellSurfaceLayout(resolvedLayout),
        coordinates: (cell) => [cell.i, cell.j],
      });
    }
    if (cellSurface) {
      let cellSurfaceTones = suppliedTones;
      if (format.formatIndex !== undefined) {
        if (!isCellSurfaceFormatIndex(format.formatIndex)) {
          throw new RangeError(
            'cell-surface-v1 formatIndex는 12 또는 14 이어야 한다: ' + format.formatIndex,
          );
        }
        const fromIndex = tonesFromCellSurfaceFormatIndex(format.formatIndex);
        if (cellSurfaceTones !== undefined && cellSurfaceTones !== fromIndex) {
          throw new RangeError(
            'cell-surface-v1 tones=' + cellSurfaceTones
            + ' 와 formatIndex=' + format.formatIndex + ' 가 어긋난다',
          );
        }
        cellSurfaceTones = fromIndex;
      } else {
        cellSurfaceTones = cellSurfaceTones === undefined ? 2 : cellSurfaceTones;
      }
      const capacity = capacityForCellSurfaceY(eccLevel, cellSurfaceTones);
      if (requestedN !== undefined) assertOptionalDimension(format.n, 'n', capacity.n);
      if (format.k !== undefined) assertOptionalDimension(format.k, 'k', capacity.n);
      return finishProfile({
        type,
        eccLevel,
        capacity,
        scan: dataCellsInScanOrderCellSurface(),
        coordinates: (cell) => [cell.i, cell.j],
      });
    }
    const spec = selectVersionSpec({
      type,
      logicalSpec,
      rawSpec: typeYSpecFromFormatIndex(formatIndex),
      rawExplicit,
      dimension: 'n',
      dimensionName: 'n',
      requestedDimension: requestedN,
      requestedTones: suppliedTones,
      version: format.version,
      formatIndex,
    });
    assertOptionalDimension(format.n, 'n', spec.n);
    assertOptionalDimension(format.k, 'k', spec.n);

    if (window) {
      if (spec.version !== 2 || spec.tones !== 2) {
        throw new RangeError('Type Y window은 Y2, tones=2에서만 허용된다');
      }
      return finishProfile({
        type,
        eccLevel,
        capacity: capacityForY2Window(eccLevel),
        scan: windowedDataCellsInScanOrderY(spec.n, spec.tones),
        coordinates: (cell) => [cell.i, cell.j],
      });
    }

    return finishProfile({
      type,
      eccLevel,
      capacity: capacityForY(spec, eccLevel),
      scan: dataCellsInScanOrderY(spec.n),
      coordinates: (cell) => [cell.i, cell.j],
    });
  }

  throw new RangeError('알 수 없는 코드 패밀리: ' + type + ' (허용 O, A, Y)');
}

function unmaskSymbolDigits(cellDigits, profile) {
  if (!cellDigits || typeof cellDigits.length !== 'number' || typeof cellDigits === 'string') {
    throw new TypeError('cellDigits는 배열 유사 객체여야 한다');
  }

  const fullScanLength = profile.scan.length;
  if (cellDigits.length !== profile.symbolDigits && cellDigits.length !== fullScanLength) {
    throw new RangeError(
      'scan-order digit 수가 맞지 않는다: ' + cellDigits.length + ' (심볼 영역 '
      + profile.symbolDigits + ' 또는 필러 포함 ' + fullScanLength + ' 필요)',
    );
  }

  const out = new Uint8Array(profile.symbolDigits);
  for (let i = 0; i < profile.symbolDigits; i += 1) {
    const digit = cellDigits[i];
    if (!Number.isInteger(digit) || digit < 0 || digit > 5) {
      throw new RangeError('digit 범위 위반 (scan index ' + i + '): ' + digit + ' (허용 0..5)');
    }
    const [x, y] = profile.coordinates(profile.scan[i]);
    out[i] = maskSub(digit, x, y);
  }
  return out;
}

function decodeSymbolsToFramedBytes(symbols, byteLength) {
  const expectedSymbolCount = symbolCountForByteLength(byteLength);
  if (symbols.length !== expectedSymbolCount) {
    throw new RangeError(
      'RS 메시지 심볼 수 불일치: ' + symbols.length + ' !== ' + expectedSymbolCount
      + ' (dataBytes ' + byteLength + ')',
    );
  }

  const out = new Uint8Array(byteLength);
  let byteOffset = 0;
  let symbolOffset = 0;
  while (byteOffset < byteLength) {
    const take = Math.min(CHUNK_BYTES, byteLength - byteOffset);
    symbolOffset += decodeChunkInto(symbols, symbolOffset, take, out, byteOffset);
    byteOffset += take;
  }

  if (symbolOffset !== symbols.length) {
    throw new RangeError(
      'base-211 청크 소비량 불일치: ' + symbolOffset + ' !== ' + symbols.length,
    );
  }
  return out;
}

function assertZeroPadding(framed, payloadLength) {
  const paddingStart = 1 + payloadLength;
  for (let i = paddingStart; i < framed.length; i += 1) {
    if (framed[i] !== 0) {
      throw new RangeError('0x00 패딩이 아니다 (byte index ' + i + '): ' + framed[i]);
    }
  }
}

/**
 * scan order로 정렬된 셀 digit 배열을 UTF-8 텍스트로 복호한다.
 *
 * format.version은 encode 계열의 논리 버전 또는 formatinfo.decode의 raw version-index를
 * 받을 수 있다. 후자와 전자가 충돌하는 값은 k/n(및 Type Y tones)으로 판별하며,
 * formatIndex를 쓰면 raw index임을 명시한다. type을 생략하면 Type O다.
 *
 * cellDigits는 실제 심볼 digit만(3S개) 또는 scan order 전체(3S + filler개) 모두
 * 허용한다. filler는 코드워드가 아니므로 전체 입력일 때도 꼬리에서 무시한다.
 *
 * @param {Uint8Array|number[]} cellDigits
 * @param {{
 *   type?: 'O'|'A'|'Y',
 *   version:number,
 *   formatIndex?:number,
 *   eccLevel:'L'|'M'|'H'|0|1|2,
 *   k?:number,
 *   n?:number,
 *   tones?:2|3,
 *   window?:boolean,
 * }} format
 * @returns {{
 *   ok:true,
 *   text:string,
 *   corrected:number,
 *   crsDistance:number,
 *   erasureFallback?: {
 *     mode:'error-only-fallback',
 *     illegalSymbolIndices:number[],
 *     placeholder:number,
 *   },
 * } | {ok:false, reason:string}}
 */
export function decodeCells(cellDigits, format) {
  let profile;
  try {
    profile = resolveProfile(format);
  } catch (cause) {
    return fail('format', cause);
  }

  let unmasked;
  try {
    unmasked = unmaskSymbolDigits(cellDigits, profile);
  } catch (cause) {
    return fail('mask', cause);
  }

  let packed;
  try {
    packed = packCellDigitsToSymbols(unmasked);
  } catch (cause) {
    return fail('symbol', cause);
  }

  // rs211.js의 options는 fcr뿐이며 erasures를 받지 않는다. 211..215는 체 밖이라
  // 그대로 rsDecode에 넣을 수 없으므로 0이라는 유효한 수신값으로 치환한다. 이는
  // 위치를 아는 소거 복호가 아니라 평범한 오류 복호이며, 성공 결과에도 명시한다.
  const received = packed.symbols.slice();
  for (const index of packed.illegalIndices) received[index] = ILLEGAL_SYMBOL_PLACEHOLDER;

  let rsResult;
  try {
    rsResult = rsDecode(received, profile.capacity.nsym);
  } catch (cause) {
    return fail('rs', cause);
  }
  if (!rsResult.ok) {
    const fallback = packed.illegalIndices.length === 0
      ? ''
      : '; 불법 심볼 ' + packed.illegalIndices.length
        + '개는 rs211.js 소거 미지원으로 일반 오류(0 치환)로 처리했다';
    return fail('rs', rsResult.reason + fallback);
  }

  let framed;
  try {
    framed = decodeSymbolsToFramedBytes(rsResult.message, profile.capacity.dataBytes);
  } catch (cause) {
    return fail('base211', cause);
  }

  let payload;
  try {
    payload = unframe(framed);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return fail(message.includes('UTF-8') ? 'utf8' : 'header', cause);
  }

  try {
    assertZeroPadding(framed, payload.payloadLength);
  } catch (cause) {
    return fail('header', cause);
  }

  const result = {
    ok: true,
    text: payload.text,
    corrected: rsResult.errorCount,
    // rsResult.errorCount는 rs211.js가 실제 변경한 errorPositions 수, 즉 u다.
    // C_RS = 2u + e. rs211.js는 아직 소거 복호가 없으므로 e=0이고, 불법 심볼도
    // 일반 오류 fallback으로만 센다. 소거 지원 뒤에도 점수 계약은 이 필드를 그대로 쓴다.
    crsDistance: 2 * rsResult.errorCount,
  };
  if (packed.illegalIndices.length > 0) {
    result.erasureFallback = {
      mode: RS211_ERASURE_MODE,
      illegalSymbolIndices: packed.illegalIndices.slice(),
      placeholder: ILLEGAL_SYMBOL_PLACEHOLDER,
    };
  }
  return result;
}
