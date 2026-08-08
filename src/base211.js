// base211.js — 셀 3개 ↔ RS 심볼(GF(211)) 매핑 + 바이트열 ↔ 심볼열 청킹 (ADR 0001 D3′)
//
// ─────────────────────────────────────────────────────────────────────────────
// 배경 (ADR 0001, docs/adr/0001_base6_error_amplification.md)
// ─────────────────────────────────────────────────────────────────────────────
//
// 승인된 새 규약: **3 digit = 1 RS 심볼, RS over GF(211)**.
// 파이프라인 순서 (§8.2 예정 문안): 바이트 → 심볼(이 모듈의 청커) → RS(심볼 도메인)
// → digit(이 모듈의 3-digit 패킹, ×3) → 마스크 → scan order 로 셀 배치.
// 즉 이 모듈은 **서로 다른 두 계층**을 담당한다. 절대 섞지 말 것:
//
//   [계층 A] 셀 도메인 ↔ RS 심볼 값 — 3 digit(base-6, {0..5} 각각) ↔ 정수 0..215.
//            216 = 6^3 상태 중 **211..215 는 GF(211) 밖(불법)**. 인코더는 RS 심볼이
//            언제나 0..210 이므로 불법값을 만들 수 없다(청커가 보장). 디코더는
//            셀에서 읽은 3-digit 이 211..215 로 떨어지면 **명시적으로 위치를 보고**한다
//            (예외를 던지지 않는다 — RS 소거 정정(P4)의 입력이 되기 때문).
//
//   [계층 B] 페이로드 바이트열 ↔ RS 심볼열 — RS 부호화 **이전**에 끝나는 자릿수(base-211)
//            변환. 청크 단위 **27 바이트 ↔ 28 심볼** (211^28 >= 2^216, 211^27 < 2^216 이므로
//            27 이 상한이자 28 이 최소). 상수 메모리, 청크 독립 변환, big-endian 바이트 →
//            BigInt → base-211 MSD-first. 꼬리(1..26 바이트)는 ceil(8m / log2 211) 심볼.
//
// **오정정보다 무서운 실패는 "조용한 절단"이다.** 값이 목표 폭에 들어가지 않으면
// 반드시 던진다 — 그리고 **출력 버퍼를 오염시키기 전에** 던진다. base6.js 의
// bigIntToDigits/bigIntToBytes 는 다 쓴 뒤에야 나머지를 검사해 실패 시에도 out 이
// 이미 절단된 값으로 채워져 있었다(검증에서 잡힌 실패 사례). 이 모듈은 쓰기 전에
// 크기를 확인한다.

// ── [계층 A] 셀 3-digit ↔ RS 심볼 값 ────────────────────────────────────────────

/** 셀 1개(digit)의 알파벳 크기 (base-6, SPEC §4.1). */
export const CELL_DIGIT_BASE = 6;

/** RS 심볼 1개를 구성하는 셀(digit) 개수. */
export const DIGITS_PER_SYMBOL = 3;

/** 3-digit 조합이 표현 가능한 전체 상태 수 = 6^3. */
export const CELL_TRIPLE_STATES = CELL_DIGIT_BASE ** DIGITS_PER_SYMBOL; // 216

/** RS 심볼이 사는 체 GF(211) 의 위수. 이 값이 GF(211) 안의 합법 심볼 개수다. */
export const RS_SYMBOL_BASE = 211;

/** 3-digit 조합 중 GF(211) 밖으로 떨어지는 값의 최솟값 (포함) — 211..215. */
export const ILLEGAL_SYMBOL_MIN = RS_SYMBOL_BASE; // 211

/** 3-digit 조합 중 GF(211) 밖으로 떨어지는 값의 최댓값 (포함). */
export const ILLEGAL_SYMBOL_MAX = CELL_TRIPLE_STATES - 1; // 215

/**
 * 3-digit(각 0..5) → 정수 값 0..215. MSD-first: v = d0·36 + d1·6 + d2
 * (§4.2 기존 규약과 정합 — 최상위 digit 이 배열 앞).
 * 이 함수는 216 상태 전체에 대한 **전단사**다. GF(211) 합법성은 별도로 `isLegalSymbolValue`
 * 로 판정한다 — 여기서는 판정하지 않는다(디코더가 불법값도 일단 값으로 받아야
 * 위치 보고가 가능하기 때문).
 * @param {number} d0
 * @param {number} d1
 * @param {number} d2
 * @returns {number} 0..215
 */
export function cellDigitsToSymbolValue(d0, d1, d2) {
  assertCellDigit(d0, 0);
  assertCellDigit(d1, 1);
  assertCellDigit(d2, 2);
  return d0 * CELL_DIGIT_BASE * CELL_DIGIT_BASE + d1 * CELL_DIGIT_BASE + d2;
}

/**
 * 정수 값 0..215 → 3-digit(각 0..5), MSD-first. `cellDigitsToSymbolValue` 의 역함수.
 * @param {number} value 0..215
 * @returns {[number, number, number]}
 */
export function symbolValueToCellDigits(value) {
  if (!Number.isInteger(value) || value < 0 || value >= CELL_TRIPLE_STATES) {
    throw new RangeError(`심볼 값 범위 위반: ${value} (허용 0..${CELL_TRIPLE_STATES - 1})`);
  }
  const d0 = Math.floor(value / (CELL_DIGIT_BASE * CELL_DIGIT_BASE));
  const rem = value % (CELL_DIGIT_BASE * CELL_DIGIT_BASE);
  const d1 = Math.floor(rem / CELL_DIGIT_BASE);
  const d2 = rem % CELL_DIGIT_BASE;
  return [d0, d1, d2];
}

/** value 가 GF(211) 안의 합법 RS 심볼인지 (0..210). */
export function isLegalSymbolValue(value) {
  return Number.isInteger(value) && value >= 0 && value < RS_SYMBOL_BASE;
}

function assertCellDigit(d, position) {
  if (!Number.isInteger(d) || d < 0 || d >= CELL_DIGIT_BASE) {
    throw new RangeError(
      `digit 범위 위반 (위치 ${position}): ${d} (허용 0..${CELL_DIGIT_BASE - 1})`,
    );
  }
}

/**
 * 셀 도메인 digit 배열(3의 배수 길이) → RS 심볼 값 배열.
 * **디코더용.** 불법값(211..215)을 만나도 던지지 않고 위치를 함께 보고한다 —
 * RS 소거 정정(P4)의 입력이 되기 때문. 인코더 방향에서는 `unpackSymbolsToCellDigits`
 * 를 쓴다(합법 심볼만 다루므로 불법값이 원천적으로 발생하지 않는다).
 * @param {Uint8Array|number[]} digits 길이가 3의 배수
 * @returns {{ symbols: Uint8Array, illegalIndices: number[] }} illegalIndices 는
 *   symbols 배열 기준 인덱스(셀 인덱스 아님).
 */
export function packCellDigitsToSymbols(digits) {
  if (!digits || typeof digits.length !== 'number') {
    throw new TypeError('digits 는 배열 유사 객체여야 한다');
  }
  if (digits.length % DIGITS_PER_SYMBOL !== 0) {
    throw new RangeError(
      `digit 개수는 ${DIGITS_PER_SYMBOL} 의 배수여야 한다: ${digits.length}`,
    );
  }
  const symbolCount = digits.length / DIGITS_PER_SYMBOL;
  const symbols = new Uint8Array(symbolCount);
  const illegalIndices = [];
  for (let i = 0; i < symbolCount; i += 1) {
    const base = i * DIGITS_PER_SYMBOL;
    const value = cellDigitsToSymbolValue(digits[base], digits[base + 1], digits[base + 2]);
    symbols[i] = value; // Uint8Array 는 0..255 를 담으므로 215 까지도 무손실 저장
    if (!isLegalSymbolValue(value)) illegalIndices.push(i);
  }
  return { symbols, illegalIndices };
}

/**
 * RS 심볼 값 배열(전부 합법, 0..210) → 셀 도메인 digit 배열(길이 = symbols.length × 3).
 * **인코더용.** 심볼이 불법값(>=211)이면 이 함수는 그 자리에서 던진다 — RS 는
 * GF(211) 위에서만 동작하므로 인코더가 불법 심볼을 만드는 것 자체가 상위 버그다.
 * 출력 버퍼를 쓰기 전에 전수 검증하므로 실패 시 out 이 오염되지 않는다.
 * @param {Uint8Array|number[]} symbols 값 0..210
 * @returns {Uint8Array}
 */
export function unpackSymbolsToCellDigits(symbols) {
  if (!symbols || typeof symbols.length !== 'number') {
    throw new TypeError('symbols 는 배열 유사 객체여야 한다');
  }
  for (let i = 0; i < symbols.length; i += 1) {
    if (!isLegalSymbolValue(symbols[i])) {
      throw new RangeError(`불법 RS 심볼 값 (인덱스 ${i}): ${symbols[i]} (허용 0..${RS_SYMBOL_BASE - 1})`);
    }
  }
  const out = new Uint8Array(symbols.length * DIGITS_PER_SYMBOL);
  for (let i = 0; i < symbols.length; i += 1) {
    const [d0, d1, d2] = symbolValueToCellDigits(symbols[i]);
    const base = i * DIGITS_PER_SYMBOL;
    out[base] = d0;
    out[base + 1] = d1;
    out[base + 2] = d2;
  }
  return out;
}

// ── [계층 B] 바이트열 ↔ RS 심볼열 청커 (base-211 위치 기수법) ────────────────────

/** 청크당 바이트 수. */
export const CHUNK_BYTES = 27;

/** 청크당 심볼 수. 211^28 >= 2^216 이 성립하는 최소값(아래 자기검증 참조). */
export const CHUNK_SYMBOLS = 28;

const SYMBOL_BASE_BIG = 211n;
const BYTE_MASK = 0xffn;

/**
 * 배열 구간 [offset, offset+count) 이 실재하는지 검증한다.
 * typed array 는 범위 밖 쓰기를 예외 없이 **조용히 버리므로**, 이 검사 없이는
 * "조용한 절단 금지" 계약이 쓰기 경로에서 공허해진다 (검증 라운드 지적).
 * 음수 count 도 여기서 잡는다 — offset > length 일 때 기본 length 인자가 음수가 되어
 * 루프가 0회 돌고 0n 이 반환되는 위장 실패를 막는다.
 */
function assertRange(arr, offset, count, what) {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`${what}: offset 은 0 이상 정수여야 한다: ${offset}`);
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`${what}: 개수는 0 이상 정수여야 한다: ${count} (offset ${offset} 이 배열 길이 ${arr.length} 를 넘었는가?)`);
  }
  if (offset + count > arr.length) {
    throw new RangeError(`${what}: 구간 [${offset}, ${offset + count}) 이 배열 길이 ${arr.length} 를 넘는다`);
  }
}

// 모듈 로드 시 1회 자기검증: 27B↔28심볼이 무손실 최소 청크인지 BigInt 로 단언.
// (ADR §6.2 근거 5 · PM/005 요구사항 — "27 이 상한이자 28 이 최소".)
(() => {
  const bound = 1n << BigInt(8 * CHUNK_BYTES); // 2^216
  const pow28 = SYMBOL_BASE_BIG ** BigInt(CHUNK_SYMBOLS);
  const pow27 = SYMBOL_BASE_BIG ** BigInt(CHUNK_SYMBOLS - 1);
  if (pow28 < bound) {
    throw new Error(`자기검증 실패: 211^${CHUNK_SYMBOLS} < 2^${8 * CHUNK_BYTES}`);
  }
  if (pow27 >= bound) {
    throw new Error(`자기검증 실패: 211^${CHUNK_SYMBOLS - 1} >= 2^${8 * CHUNK_BYTES} (28 이 최소가 아님)`);
  }
})();

/**
 * m 바이트를 손실 없이 담는 **최소** base-211 심볼 수.
 * 정의상 min{ s : 211^s >= 2^(8m) }. BigInt 로 정확히 계산한다(부동소수 반올림 회피).
 * @param {number} m 바이트 수 (>= 0)
 * @returns {number}
 */
export function minSymbolsExact(m) {
  if (!Number.isInteger(m) || m < 0) {
    throw new RangeError(`바이트 수는 0 이상 정수여야 한다: ${m}`);
  }
  const target = 1n << BigInt(8 * m);
  let s = 0;
  let pow = 1n;
  while (pow < target) {
    pow *= SYMBOL_BASE_BIG;
    s += 1;
  }
  return s;
}

/**
 * 닫힌 형태 ceil(m·8 / log2 211) 을 부동소수로 계산한 것. `minSymbolsExact` 의 BigInt
 * 정확 계산과 일치해야 한다(테스트가 단언). 정본은 `minSymbolsExact`.
 * @param {number} m
 * @returns {number}
 */
export function symbolCountFormula(m) {
  if (!Number.isInteger(m) || m < 0) {
    throw new RangeError(`바이트 수는 0 이상 정수여야 한다: ${m}`);
  }
  return Math.ceil((m * 8) / Math.log2(RS_SYMBOL_BASE));
}

/** m = 0..CHUNK_BYTES 사전 계산 표 (인덱스 = 바이트 수). */
const TAIL_SYMBOLS = Object.freeze(buildTailTable());

function buildTailTable() {
  const table = [];
  for (let m = 0; m <= CHUNK_BYTES; m += 1) table.push(minSymbolsExact(m));
  return table;
}

/**
 * m 바이트에 대응하는 심볼 개수(꼬리표 조회, m = 0..27) 또는 일반식(m > 27).
 * @param {number} m
 * @returns {number}
 */
export function symbolCountForBytes(m) {
  if (!Number.isInteger(m) || m < 0) {
    throw new RangeError(`바이트 수는 0 이상 정수여야 한다: ${m}`);
  }
  if (m <= CHUNK_BYTES) return TAIL_SYMBOLS[m];
  return minSymbolsExact(m);
}

/**
 * 전체 바이트 길이에 대응하는 심볼 총 개수.
 * @param {number} byteLength
 * @returns {number}
 */
export function symbolCountForByteLength(byteLength) {
  if (!Number.isInteger(byteLength) || byteLength < 0) {
    throw new RangeError(`바이트 길이는 0 이상 정수여야 한다: ${byteLength}`);
  }
  const full = Math.floor(byteLength / CHUNK_BYTES);
  const tail = byteLength % CHUNK_BYTES;
  return full * CHUNK_SYMBOLS + TAIL_SYMBOLS[tail];
}

/** 꼬리 심볼 수 → 꼬리 바이트 수 역인덱스. */
const TAIL_SYMBOLS_TO_BYTES = (() => {
  const map = new Map();
  for (let m = 0; m < CHUNK_BYTES; m += 1) map.set(TAIL_SYMBOLS[m], m);
  return map;
})();

/**
 * 심볼 총 개수 → 바이트 길이. 꼬리 심볼 수가 서로 다르고 모두 28 미만이면 유일하게
 * 역산된다(테스트가 표의 단사성을 확인한다). 정본은 헤더 길이 필드다.
 * @param {number} symbolCount
 * @returns {number}
 */
export function byteLengthForSymbolCount(symbolCount) {
  if (!Number.isInteger(symbolCount) || symbolCount < 0) {
    throw new RangeError(`심볼 개수는 0 이상 정수여야 한다: ${symbolCount}`);
  }
  const full = Math.floor(symbolCount / CHUNK_SYMBOLS);
  const rem = symbolCount % CHUNK_SYMBOLS;
  const tailBytes = TAIL_SYMBOLS_TO_BYTES.get(rem);
  if (tailBytes === undefined) {
    throw new RangeError(`유효한 청크 분해가 없는 심볼 개수: ${symbolCount} (나머지 ${rem})`);
  }
  return full * CHUNK_BYTES + tailBytes;
}

// ── 청크 단위 원시 변환 (상수 메모리 프리미티브) ─────────────────────────────────

/**
 * 바이트 구간 → BigInt (빅엔디안).
 * @param {Uint8Array|number[]} bytes
 * @param {number} offset
 * @param {number} length
 * @returns {bigint}
 */
export function bytesToBigInt(bytes, offset = 0, length = bytes.length - offset) {
  assertRange(bytes, offset, length, 'bytesToBigInt');
  let value = 0n;
  for (let i = 0; i < length; i += 1) {
    const b = bytes[offset + i];
    if (!Number.isInteger(b) || b < 0 || b > 255) {
      throw new RangeError(`바이트 값 범위 위반: index ${offset + i} = ${b}`);
    }
    value = (value << 8n) | BigInt(b);
  }
  return value;
}

/**
 * BigInt → 바이트 구간에 기록 (빅엔디안). **쓰기 전에 크기를 검증**해서 실패 시
 * out 을 오염시키지 않는다.
 * @param {bigint} value
 * @param {Uint8Array} out
 * @param {number} offset
 * @param {number} length
 */
export function bigIntToBytes(value, out, offset, length) {
  assertRange(out, offset, length, 'bigIntToBytes');
  if (value < 0n) throw new RangeError('음수는 인코딩할 수 없다');
  if (value >= (1n << BigInt(8 * length))) {
    throw new RangeError(`값이 ${length} 바이트에 들어가지 않는다: ${value}`);
  }
  let rest = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[offset + i] = Number(rest & BYTE_MASK);
    rest >>= 8n;
  }
}

/**
 * BigInt → 심볼 배열에 기록 (MSD first). 앞은 0 으로 패딩.
 * **쓰기 전에 크기를 검증**해서 실패 시 out 을 오염시키지 않는다.
 * @param {bigint} value
 * @param {number} symbolCount
 * @param {Uint8Array|number[]} out
 * @param {number} offset
 */
export function bigIntToSymbols(value, symbolCount, out, offset = 0) {
  assertRange(out, offset, symbolCount, 'bigIntToSymbols');
  if (value < 0n) throw new RangeError('음수는 인코딩할 수 없다');
  if (value >= SYMBOL_BASE_BIG ** BigInt(symbolCount)) {
    throw new RangeError(`값이 심볼 ${symbolCount} 개에 들어가지 않는다: ${value}`);
  }
  let rest = value;
  for (let i = symbolCount - 1; i >= 0; i -= 1) {
    out[offset + i] = Number(rest % SYMBOL_BASE_BIG);
    rest /= SYMBOL_BASE_BIG;
  }
}

/**
 * 심볼 구간 → BigInt (MSD first). 심볼 값이 0..210 를 벗어나면 던진다
 * (base-211 위치 기수법의 자릿값 자체가 GF(211) 범위이므로 이 검사가 곧
 * "RS 심볼 도메인 검증"이다 — 계층 A 의 셀 불법값 판정과는 별개).
 * @param {Uint8Array|number[]} symbols
 * @param {number} offset
 * @param {number} symbolCount
 * @returns {bigint}
 */
export function symbolsToBigInt(symbols, offset = 0, symbolCount = symbols.length - offset) {
  assertRange(symbols, offset, symbolCount, 'symbolsToBigInt');
  let value = 0n;
  for (let i = 0; i < symbolCount; i += 1) {
    const s = symbols[offset + i];
    if (!isLegalSymbolValue(s)) {
      throw new RangeError(`심볼 범위 위반: index ${offset + i} = ${s} (허용 0..${RS_SYMBOL_BASE - 1})`);
    }
    value = value * SYMBOL_BASE_BIG + BigInt(s);
  }
  return value;
}

/**
 * 한 청크(1..27 바이트) → 심볼들. 작업 메모리 상수.
 * @param {Uint8Array} bytes
 * @param {number} byteOffset
 * @param {number} byteLength 1..27
 * @param {Uint8Array|number[]} out
 * @param {number} symbolOffset
 * @returns {number} 기록한 심볼 개수
 */
export function encodeChunkInto(bytes, byteOffset, byteLength, out, symbolOffset) {
  if (byteLength < 1 || byteLength > CHUNK_BYTES) {
    throw new RangeError(`청크 바이트 길이는 1..${CHUNK_BYTES}: ${byteLength}`);
  }
  const symbolCount = TAIL_SYMBOLS[byteLength];
  bigIntToSymbols(bytesToBigInt(bytes, byteOffset, byteLength), symbolCount, out, symbolOffset);
  return symbolCount;
}

/**
 * 한 청크의 심볼들 → 바이트. 작업 메모리 상수.
 * @param {Uint8Array|number[]} symbols
 * @param {number} symbolOffset
 * @param {number} byteLength 1..27 (기대 바이트 수 — 헤더 길이 필드에서 온다)
 * @param {Uint8Array} out
 * @param {number} byteOffset
 * @returns {number} 소비한 심볼 개수
 */
export function decodeChunkInto(symbols, symbolOffset, byteLength, out, byteOffset) {
  if (byteLength < 1 || byteLength > CHUNK_BYTES) {
    throw new RangeError(`청크 바이트 길이는 1..${CHUNK_BYTES}: ${byteLength}`);
  }
  const symbolCount = TAIL_SYMBOLS[byteLength];
  const value = symbolsToBigInt(symbols, symbolOffset, symbolCount);
  bigIntToBytes(value, out, byteOffset, byteLength);
  return symbolCount;
}

// ── 스트림 API ────────────────────────────────────────────────────────────────

/**
 * 바이트열 → RS 심볼열. 27바이트 청크 단위 스트리밍.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array} 심볼 값 {0..210} 의 배열
 */
export function bytesToSymbols(bytes) {
  assertBytes(bytes);
  const out = new Uint8Array(symbolCountForByteLength(bytes.length));
  let byteOffset = 0;
  let symbolOffset = 0;
  while (byteOffset < bytes.length) {
    const take = Math.min(CHUNK_BYTES, bytes.length - byteOffset);
    symbolOffset += encodeChunkInto(bytes, byteOffset, take, out, symbolOffset);
    byteOffset += take;
  }
  return out;
}

/**
 * RS 심볼열 → 바이트열.
 * @param {Uint8Array|number[]} symbols
 * @param {number} [byteLength] 페이로드 헤더의 바이트 길이 필드(정본). 생략하면
 *   심볼 개수로부터 역산한다.
 * @returns {Uint8Array}
 */
export function symbolsToBytes(symbols, byteLength) {
  if (!symbols || typeof symbols.length !== 'number') {
    throw new TypeError('symbols 는 배열 유사 객체여야 한다');
  }
  const len = byteLength === undefined ? byteLengthForSymbolCount(symbols.length) : byteLength;
  const expected = symbolCountForByteLength(len);
  if (symbols.length !== expected) {
    throw new RangeError(
      `심볼 개수 불일치: ${symbols.length} 개, 바이트 길이 ${len} 는 ${expected} 개를 요구`,
    );
  }
  const out = new Uint8Array(len);
  let byteOffset = 0;
  let symbolOffset = 0;
  while (byteOffset < len) {
    const take = Math.min(CHUNK_BYTES, len - byteOffset);
    symbolOffset += decodeChunkInto(symbols, symbolOffset, take, out, byteOffset);
    byteOffset += take;
  }
  return out;
}

/**
 * 출력 배열을 통째로 잡지 않는 진짜 스트리밍 변환. 심볼을 하나씩 흘린다.
 * @param {Uint8Array} bytes
 * @yields {number} 심볼 값 {0..210}
 */
export function* iterSymbols(bytes) {
  assertBytes(bytes);
  const scratch = new Uint8Array(CHUNK_SYMBOLS);
  let byteOffset = 0;
  while (byteOffset < bytes.length) {
    const take = Math.min(CHUNK_BYTES, bytes.length - byteOffset);
    const n = encodeChunkInto(bytes, byteOffset, take, scratch, 0);
    for (let i = 0; i < n; i += 1) yield scratch[i];
    byteOffset += take;
  }
}

function assertBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('bytes 는 Uint8Array 여야 한다');
  }
}
