// decode-k.js — Type K(육각별) 후단 디코더 (decode.js 대칭 — 계약 K-4·K-6)
//
// decode.js(O/A/Y)와 같은 입력 경계다: "셀별 3면 순위 → digit" 이 끝난 직후.
// 역순서도 encodeK.js 와 정확히 짝이다:
//
//   masked cell digit → maskSub → 3 digit/GF(211) symbol → RS decode
//   → base-211 chunk decode → header unframe → UTF-8 text
//
// [왜 별도 모듈인가] decode.js 는 O/A/Y 발행 경로의 정본이고 이 레인의 쓰기 범위
// 밖이다(레인 브리프 §4 — src/decoder/** 만 허용). K 는 star 축 독립 표(formatK.js)
// 라 프로파일 해석이 자체적이고, 파이프라인 조각(mask/base211/rs211/header)은 전부
// 공개 모듈이라 여기서 같은 순서로 조립만 한다. O/A/Y 경로는 **한 바이트도 안
// 바뀐다** — decode.js 를 import 하지도 않는다. 실패 reason 의 stage 접두
// (format/mask/symbol/erasure/rs/base211/header/utf8)는 decode.js 와 같은 어휘를
// 쓴다 — 하류 집계(F-25 등)가 같은 자로 읽게.
//
// 소거 계약도 decode.js 승계: 불법 211..215 심볼과 "프레임 밖" 셀은 위치를 아는
// 소거로 rsDecode 에 넘긴다 (2v + s ≤ nsym).

import { VERSIONS_K, capacityForK } from '../capacityK.js';
import { dataCellsInScanOrderK } from '../layoutK.js';
import {
  CHUNK_BYTES,
  decodeChunkInto,
  packCellDigitsToSymbols,
  symbolCountForByteLength,
} from '../base211.js';
import { rsDecode } from '../rs211.js';
import { maskSub } from '../mask.js';
import { unframe } from '../header.js';

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

/**
 * format → K 프로파일. version(논리) 또는 formatIndex(+k, star 축 표 — 전 버전이
 * 값 7 을 공유하므로 인덱스 단독으로는 유일하지 않다: k 가 필수 판별축이다).
 */
function resolveProfileK(format) {
  if (!format || typeof format !== 'object' || Array.isArray(format)) {
    throw new TypeError('format은 객체여야 한다');
  }
  if (format.type !== undefined && format.type !== 'K') {
    throw new RangeError('decode-k 는 Type K 전용이다: ' + format.type);
  }
  const eccLevel = normalizeEccLevel(format.eccLevel);

  let spec;
  if (format.formatIndex !== undefined) {
    const candidates = VERSIONS_K.filter((entry) => entry.formatIndex === format.formatIndex
      && (format.k === undefined || entry.k === format.k)
      && (format.version === undefined || entry.version === format.version));
    if (candidates.length !== 1) {
      throw new RangeError(
        'Type K formatIndex ' + format.formatIndex + ' 는 k(6|8|10) 로 갈라야 한다'
        + ' — k=' + format.k + ' version=' + format.version
        + ' 에서 후보 ' + candidates.length + '개',
      );
    }
    spec = candidates[0];
  } else {
    spec = VERSIONS_K.find((entry) => entry.version === format.version);
    if (!spec) {
      throw new RangeError('알 수 없는 Type K 버전: ' + format.version);
    }
    if (format.k !== undefined && format.k !== spec.k) {
      throw new RangeError('k가 선택한 버전의 격자 크기와 다르다: ' + format.k + ' !== ' + spec.k);
    }
  }

  const capacity = capacityForK(spec, eccLevel);
  const scan = dataCellsInScanOrderK(spec.k);
  const symbolDigits = capacity.usedSymbols * 3;
  if (scan.length !== capacity.dataCells) {
    throw new Error(
      'scan order-K 셀 수 불일치: ' + scan.length + ' !== capacity.dataCells ' + capacity.dataCells,
    );
  }
  if (symbolDigits + capacity.residualCells !== scan.length) {
    throw new Error(
      '심볼 digit/필러 회계 불일치: ' + symbolDigits + ' + '
      + capacity.residualCells + ' !== ' + scan.length,
    );
  }
  const expectedDataSymbols = symbolCountForByteLength(capacity.dataBytes);
  if (expectedDataSymbols !== capacity.dataSymbols) {
    throw new Error(
      'base-211 data 심볼 수 불일치: ' + expectedDataSymbols
      + ' !== capacity.dataSymbols ' + capacity.dataSymbols
      + ' — 이 포맷은 현행 인코더가 생성할 수 없다',
    );
  }
  return { capacity, scan, symbolDigits };
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
    const cell = profile.scan[i];
    out[i] = maskSub(digit, cell.q, cell.r);
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

function collectDeclaredErasures(options, profile, symbolCount) {
  const out = new Set();
  const cells = options.erasureCells;
  if (cells !== undefined && cells !== null) {
    if (!Array.isArray(cells) && !ArrayBuffer.isView(cells)) {
      throw new TypeError('erasureCells는 배열이어야 한다');
    }
    for (let i = 0; i < cells.length; i += 1) {
      const index = cells[i];
      if (!Number.isInteger(index) || index < 0 || index >= profile.scan.length) {
        throw new RangeError(
          'erasureCells[' + i + ']는 0..' + (profile.scan.length - 1) + ' 정수여야 한다: ' + index,
        );
      }
      if (index >= profile.symbolDigits) continue; // filler는 코드워드가 아니다
      out.add(Math.floor(index / 3));
    }
  }
  const symbols = options.erasureSymbols;
  if (symbols !== undefined && symbols !== null) {
    if (!Array.isArray(symbols) && !ArrayBuffer.isView(symbols)) {
      throw new TypeError('erasureSymbols는 배열이어야 한다');
    }
    for (let i = 0; i < symbols.length; i += 1) {
      const index = symbols[i];
      if (!Number.isInteger(index) || index < 0 || index >= symbolCount) {
        throw new RangeError(
          'erasureSymbols[' + i + ']는 0..' + (symbolCount - 1) + ' 정수여야 한다: ' + index,
        );
      }
      out.add(index);
    }
  }
  return [...out].sort((left, right) => left - right);
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
 * scan order-K digit 배열을 UTF-8 텍스트로 복호한다. 계약은 decode.decodeCells
 * 와 같다 — format.type 만 'K'(생략 가능), 소거·결과 모양 동일.
 *
 * @param {Uint8Array|number[]} cellDigits
 * @param {{type?:'K', version?:number, formatIndex?:number, eccLevel:'L'|'M'|'H'|0|1|2, k?:number}} format
 * @param {{erasureCells?:number[], erasureSymbols?:number[]}} [options]
 */
export function decodeCellsK(cellDigits, format, options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options는 객체여야 한다');
  }

  let profile;
  try {
    profile = resolveProfileK(format);
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

  let declaredErasures;
  try {
    declaredErasures = collectDeclaredErasures(options, profile, packed.symbols.length);
  } catch (cause) {
    return fail('erasure', cause);
  }

  const received = packed.symbols.slice();
  for (const index of packed.illegalIndices) received[index] = ILLEGAL_SYMBOL_PLACEHOLDER;
  for (const index of declaredErasures) received[index] = ILLEGAL_SYMBOL_PLACEHOLDER;

  const erasureIndices = [...new Set([...packed.illegalIndices, ...declaredErasures])]
    .sort((a, b) => a - b);

  let rsResult;
  try {
    rsResult = erasureIndices.length > 0
      ? rsDecode(received, profile.capacity.nsym, { erasures: erasureIndices })
      : rsDecode(received, profile.capacity.nsym);
  } catch (cause) {
    return fail('rs', cause);
  }
  if (!rsResult.ok) {
    const marked = packed.illegalIndices.length + declaredErasures.length;
    const fallback = marked === 0
      ? ''
      : '; 소거 ' + erasureIndices.length + '개(불법 심볼 ' + packed.illegalIndices.length
        + ' + 미표본 ' + declaredErasures.length + ')를 위치 지정 소거로 넘겼다';
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

  const erasureCount = rsResult.erasureCount ?? 0;
  const result = {
    ok: true,
    text: payload.text,
    corrected: rsResult.errorCount,
    crsDistance: 2 * rsResult.errorCount + erasureCount,
  };
  if (packed.illegalIndices.length > 0 || declaredErasures.length > 0) {
    result.erasureFallback = {
      mode: 'erasure',
      illegalSymbolIndices: packed.illegalIndices.slice(),
      erasureSymbolIndices: erasureIndices.slice(),
      placeholder: ILLEGAL_SYMBOL_PLACEHOLDER,
    };
  }
  return result;
}
