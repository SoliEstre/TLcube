/**
 * decode-c.js — Type C(3시 노치) 본문 역해석.
 *
 * 공용 `decode.js`는 공개된 O/A/Y 계약을 보존한다. Type C는 같은 GF(211)·base-211
 * 파이프라인을 쓰되 `(formatIndex, k)` 표와 노치/사괘 예약 scan-order가 별도라,
 * 그 파일을 넓히지 않고 디코더 레인 안에서 같은 하류 연산을 조립한다.
 *
 * C1/C2 계열은 회계 표는 있으나 단일 RS 블록 상한을 넘는다. 여기서 임의 다중 블록
 * 규약을 만들지 않고 `assertTypeCSingleBlock`의 공용 사유를 결과로 돌려준다.
 */

import {
  CHUNK_BYTES,
  decodeChunkInto,
  packCellDigitsToSymbols,
  symbolCountForByteLength,
} from '../base211.js';
import { RS211_ERASURE_MODE, RS211_ERASURE_MODE_LEGACY } from '../decode.js';
import { daehanReservedCells } from '../finder-daehan.js';
import { cSpecFromFormatIndex } from '../formatC.js';
import { unframe } from '../header.js';
import { dataCellsInScanOrder } from '../layout.js';
import { DEFAULT_MASK_INDEX, maskSub } from '../mask.js';
import { typeCReservedCells } from '../notchC.js';
import {
  capacityForC,
  VERSIONS_C,
  VERSIONS_C_DAEHAN,
} from '../capacityC.js';
import { rsDecodeBlocks } from '../rs211.js';

const ECC_LEVEL_BY_VALUE = Object.freeze({ 0: 'L', 1: 'M', 2: 'H' });
const ILLEGAL_SYMBOL_PLACEHOLDER = 0;

function fail(stage, cause) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return { ok: false, reason: `${stage}: ${detail}` };
}

function normalizeEccLevel(value) {
  if (value === 'L' || value === 'M' || value === 'H') return value;
  if (Number.isInteger(value) && ECC_LEVEL_BY_VALUE[value] !== undefined) {
    return ECC_LEVEL_BY_VALUE[value];
  }
  throw new RangeError(`eccLevel은 L, M, H 또는 formatinfo.js의 값 0, 1, 2여야 한다: ${value}`);
}

function assertOptional(value, name, expected) {
  if (value === undefined) return;
  if (value !== expected) {
    throw new RangeError(`${name}가 Type C 표와 다르다: ${value} !== ${expected}`);
  }
}

function resolveProfile(format) {
  if (!format || typeof format !== 'object' || Array.isArray(format)) {
    throw new TypeError('format은 객체여야 한다');
  }
  if (!Number.isInteger(format.k)) {
    throw new RangeError(`Type C에는 정수 k가 필요하다: ${format.k}`);
  }
  if (!Number.isInteger(format.formatIndex)) {
    throw new RangeError(`Type C에는 명시 formatIndex가 필요하다: ${format.formatIndex}`);
  }
  if (format.type !== undefined && format.type !== 'C') {
    throw new RangeError(`decodeCellsC의 type은 C여야 한다: ${format.type}`);
  }
  if (format.maskIndex !== undefined && format.maskIndex !== DEFAULT_MASK_INDEX) {
    throw new RangeError(`Type C 포맷 v1은 maskIndex ${DEFAULT_MASK_INDEX}만 쓴다: ${format.maskIndex}`);
  }

  const spec = cSpecFromFormatIndex(format.formatIndex, format.k);
  if (spec === null) {
    throw new RangeError(
      `Type C 와이어 표에 없는 (formatIndex,k): (${format.formatIndex},${format.k})`,
    );
  }
  assertOptional(format.version, 'version', spec.version);
  if (format.daehanFinder !== undefined && format.daehanFinder !== spec.daehanFinder) {
    throw new RangeError(
      `daehanFinder가 Type C 와이어 표와 다르다: ${format.daehanFinder} !== ${spec.daehanFinder}`,
    );
  }

  // formatC의 행은 의도적으로 와이어 필드만 가진다. 용량 계산에는 symbolKey·overhead
  // 를 함께 보유한 capacityC의 정본 행이 필요하므로 name/k/daehan 조합으로 다시 찾는다.
  // 이 연결도 formatIndex 단독이나 version 산술을 쓰지 않는다.
  const capacitySpec = [...VERSIONS_C, ...VERSIONS_C_DAEHAN].find(
    (entry) => entry.name === spec.name
      && entry.k === spec.k
      && entry.daehanFinder === spec.daehanFinder,
  );
  if (!capacitySpec) {
    throw new RangeError(`Type C 용량 표에 없는 와이어 행: ${spec.name}`);
  }

  const eccLevel = normalizeEccLevel(format.eccLevel);
  const capacity = capacityForC(capacitySpec, eccLevel);
  // 단일 블록 가드는 다중 RS 블록 규약(레인 typec-rs)으로 소멸했다 — C1/C2 의
  // 블록 분할·재조립은 백엔드(decode.js)가 표 조회로 대칭 처리한다. 이 자리에
  // 가드를 남기면 개방된 계열을 프런트가 도로 막는다 (리허설 교차 실측).
  const reserved = typeCReservedCells(
    spec.k,
    spec.daehanFinder ? daehanReservedCells(spec.k) : undefined,
  );
  const scan = dataCellsInScanOrder(spec.k, reserved);
  const symbolDigits = capacity.usedSymbols * 3;
  if (scan.length !== capacity.dataCells) {
    throw new Error(`scan order 셀 수 불일치: ${scan.length} !== ${capacity.dataCells}`);
  }
  if (symbolDigits + capacity.residualCells !== scan.length) {
    throw new Error(
      `심볼 digit/필러 회계 불일치: ${symbolDigits} + ${capacity.residualCells} !== ${scan.length}`,
    );
  }
  if (symbolCountForByteLength(capacity.dataBytes) !== capacity.dataSymbols) {
    throw new Error(
      `base-211 data 심볼 수 불일치: ${symbolCountForByteLength(capacity.dataBytes)} !== ${capacity.dataSymbols}`,
    );
  }
  return {
    spec,
    capacity,
    scan,
    symbolDigits,
    maskIndex: DEFAULT_MASK_INDEX,
  };
}

function unmaskSymbolDigits(cellDigits, profile) {
  if (!cellDigits || typeof cellDigits.length !== 'number' || typeof cellDigits === 'string') {
    throw new TypeError('cellDigits는 배열 유사 객체여야 한다');
  }
  if (cellDigits.length !== profile.symbolDigits && cellDigits.length !== profile.scan.length) {
    throw new RangeError(
      `scan-order digit 수가 맞지 않는다: ${cellDigits.length} (심볼 영역 ${profile.symbolDigits}`
      + ` 또는 필러 포함 ${profile.scan.length} 필요)`,
    );
  }
  const out = new Uint8Array(profile.symbolDigits);
  for (let index = 0; index < profile.symbolDigits; index += 1) {
    const digit = cellDigits[index];
    if (!Number.isInteger(digit) || digit < 0 || digit > 5) {
      throw new RangeError(`digit 범위 위반 (scan index ${index}): ${digit} (허용 0..5)`);
    }
    const cell = profile.scan[index];
    out[index] = maskSub(digit, cell.q, cell.r, profile.maskIndex);
  }
  return out;
}

function decodeSymbolsToFramedBytes(symbols, byteLength) {
  const expected = symbolCountForByteLength(byteLength);
  if (symbols.length !== expected) {
    throw new RangeError(
      `RS 메시지 심볼 수 불일치: ${symbols.length} !== ${expected} (dataBytes ${byteLength})`,
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
    throw new RangeError(`base-211 청크 소비량 불일치: ${symbolOffset} !== ${symbols.length}`);
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
    for (let index = 0; index < cells.length; index += 1) {
      const cellIndex = cells[index];
      if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= profile.scan.length) {
        throw new RangeError(
          `erasureCells[${index}]는 0..${profile.scan.length - 1} 정수여야 한다: ${cellIndex}`,
        );
      }
      if (cellIndex < profile.symbolDigits) out.add(Math.floor(cellIndex / 3));
    }
  }
  const symbols = options.erasureSymbols;
  if (symbols !== undefined && symbols !== null) {
    if (!Array.isArray(symbols) && !ArrayBuffer.isView(symbols)) {
      throw new TypeError('erasureSymbols는 배열이어야 한다');
    }
    for (let index = 0; index < symbols.length; index += 1) {
      const symbolIndex = symbols[index];
      if (!Number.isInteger(symbolIndex) || symbolIndex < 0 || symbolIndex >= symbolCount) {
        throw new RangeError(
          `erasureSymbols[${index}]는 0..${symbolCount - 1} 정수여야 한다: ${symbolIndex}`,
        );
      }
      out.add(symbolIndex);
    }
  }
  return [...out].sort((left, right) => left - right);
}

function mergeSorted(left, right) {
  const out = new Set(left);
  for (const value of right) out.add(value);
  return [...out].sort((leftValue, rightValue) => leftValue - rightValue);
}

function assertZeroPadding(framed, payloadLength) {
  for (let index = 1 + payloadLength; index < framed.length; index += 1) {
    if (framed[index] !== 0) {
      throw new RangeError(`0x00 패딩이 아니다 (byte index ${index}): ${framed[index]}`);
    }
  }
}

/**
 * Type C scan-order digit을 원문으로 역해석한다.
 *
 * 형식은 반드시 `(formatIndex, k)`로 지정한다. C0/C1/C2가 같은 formatIndex를 쓰므로
 * 버전 산술이나 formatIndex 단독 조회는 허용하지 않는다.
 */
export function decodeCellsC(cellDigits, format, options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options는 객체여야 한다');
  }
  const erasureMode = options.erasureMode ?? RS211_ERASURE_MODE;
  if (erasureMode !== RS211_ERASURE_MODE && erasureMode !== RS211_ERASURE_MODE_LEGACY) {
    throw new RangeError(
      `erasureMode는 ${RS211_ERASURE_MODE} 또는 ${RS211_ERASURE_MODE_LEGACY}여야 한다: ${erasureMode}`,
    );
  }

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

  let declaredErasures;
  try {
    declaredErasures = collectDeclaredErasures(options, profile, packed.symbols.length);
  } catch (cause) {
    return fail('erasure', cause);
  }

  const received = packed.symbols.slice();
  for (const index of packed.illegalIndices) received[index] = ILLEGAL_SYMBOL_PLACEHOLDER;
  for (const index of declaredErasures) received[index] = ILLEGAL_SYMBOL_PLACEHOLDER;
  const erasureIndices = erasureMode === RS211_ERASURE_MODE
    ? mergeSorted(packed.illegalIndices, declaredErasures)
    : [];

  let rsResult;
  try {
    // 다중 RS 블록 (레인 typec-rs) — C1/C2 는 블록 분할·인터리빙이라 단일
    // rsDecode 로 풀면 정당한 프레임이 본문에서 죽는다 (리허설 교차 실측:
    // 포맷 후보 1 통과 후 BODY_RS_FAILED). 블록 수 1(C0)은 rsDecodeBlocks 가
    // 기존 rsDecode 반환 계약을 문자 그대로 재사용해 무회귀다.
    rsResult = erasureIndices.length > 0
      ? rsDecodeBlocks(received, profile.capacity.rsBlockConfig, { erasures: erasureIndices })
      : rsDecodeBlocks(received, profile.capacity.rsBlockConfig);
  } catch (cause) {
    return fail('rs', cause);
  }
  if (!rsResult.ok) {
    const marked = packed.illegalIndices.length + declaredErasures.length;
    const fallback = marked === 0
      ? ''
      : erasureMode === RS211_ERASURE_MODE
        ? `; 소거 ${erasureIndices.length}개(불법 심볼 ${packed.illegalIndices.length}`
          + ` + 미표본 ${declaredErasures.length})를 위치 지정 소거로 넘겼다`
        : `; 표시된 심볼 ${marked}개는 legacy 모드라 일반 오류(0 치환)로 처리했다`;
    return fail('rs', `${rsResult.reason}${fallback}`);
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
      mode: erasureMode,
      illegalSymbolIndices: packed.illegalIndices.slice(),
      erasureSymbolIndices: erasureIndices.slice(),
      placeholder: ILLEGAL_SYMBOL_PLACEHOLDER,
    };
  }
  return result;
}
