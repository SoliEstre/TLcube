// base6.js — 바이트 스트림 ↔ base-6 digit 청크 변환 (SPEC §4.2)
//
// ─────────────────────────────────────────────────────────────────────────────
// 계약 (인코더/디코더가 반드시 같은 값을 쓰지 않으면 조용히 깨진다)
// ─────────────────────────────────────────────────────────────────────────────
//
// [C1] 청크 크기: 8 바이트(64bit) ↔ base-6 digit 25 개.
//      6^25 = 28430288029929701376 > 2^64 = 18446744073709551616 이므로 손실 없음.
//      효율 64/25 = 2.56 bit/symbol (이론치 log2(6) ≈ 2.585 의 99%).
//
// [C2] **바이트 엔디안 = 빅엔디안(MSB first).**
//      청크 내 bytes[0] 이 최상위 바이트다. 즉 value = Σ bytes[i] · 256^(len-1-i).
//      근거: 페이로드는 네트워크 바이트 순서로 읽히는 옥텟 스트림이고,
//      RS(GF(2^8)) 단계에서도 바이트 인덱스 순서가 그대로 유지된다.
//
// [C3] **digit 순서 = 최상위 우선(MSD first).**
//      청크의 digits[0] 이 6^(k-1) 계수다. 즉 value = Σ digits[i] · 6^(k-1-i).
//      근거: 셀 배치가 레이아웃 맵 순서대로 진행되므로, 사람이 읽는 수 표기와
//      배치 순서가 일치해야 디버깅 가능하다.
//
// [C4] 청크는 **독립적으로** 변환한다. 전체 바이트열을 하나의 빅넘으로 만들지 않는다
//      (SPEC §4.2 가 명시적으로 배제). 청크당 작업 메모리는 상수다.
//
// [C5] 마지막 부분 청크(m = 1..7 바이트)는 `digitCountForBytes(m)` 개의 digit 을 쓴다
//      = ceil(m·8 / log2 6) → m=1..7 에서 4, 7, 10, 13, 16, 19, 22.
//      앞쪽은 0 으로 패딩된다(MSD first 이므로 선행 0).
//
//      ⚠ 이 꼬리 규약은 **SPEC 에 없다 — 본 구현의 단독 결정**이다. SPEC §4.2 는
//      "마지막 청크는 길이 프리픽스로 패딩 모호성 제거" 라고만 적고, 꼬리도 25 digit
//      을 쓰되 바이트 쪽을 패딩한다는 해석도 열려 있다. 두 해석은 비호환이다
//      (SPEC 만 읽고 만든 디코더는 이 인코더의 출력을 읽지 못한다).
//      → `.agent/_questions/open/` 에 SPEC 승격 질문이 열려 있다. SPEC 개정 전까지
//      이 규약은 잠정이다.
//
//      패딩 모호성은 SPEC §4.2 대로 **페이로드 헤더의 바이트 길이 필드**로 제거한다.
//      (부수적으로 digit 개수 자체도 꼬리 바이트 수를 유일하게 결정한다 —
//       `byteLengthForDigitCount` 참조. 그러나 실제 코드 영역에는 레이아웃 용량만큼
//       채움 심볼이 붙을 수 있으므로 **정본은 길이 필드**다.)
//
// [C6] 마스크 가산/감산(mod-6)은 이 모듈의 책임이 아니다 (SPEC §4.3, 별도 모듈).
//      여기서 나온 digit 은 **마스크 적용 전** 값이다.

/** 청크당 바이트 수 (SPEC §4.2). */
export const CHUNK_BYTES = 8;

/** 청크당 digit 수 (SPEC §4.2). */
export const CHUNK_DIGITS = 25;

/** 심볼 알파벳 크기. */
export const BASE = 6;

const BASE_BIG = 6n;
const BYTE_MASK = 0xffn;

/**
 * m 바이트를 손실 없이 담는 **최소** base-6 digit 수.
 * 정의상 min{ k : 6^k >= 2^(8m) } 이고, 닫힌 형태 ceil(m·8 / log2 6) 과 같다.
 * (이 공식은 SPEC 에 없다 — [C5] 참조.)
 * 부동소수 반올림에 의존하지 않도록 BigInt 로 정확히 계산한다.
 * @param {number} m 바이트 수 (>= 0)
 * @returns {number}
 */
export function digitCountForBytes(m) {
  if (!Number.isInteger(m) || m < 0) {
    throw new RangeError(`바이트 수는 0 이상 정수여야 한다: ${m}`);
  }
  if (m <= CHUNK_BYTES) return TAIL_DIGITS[m];
  return minDigitsExact(m);
}

/**
 * 닫힌 형태 ceil(m·8 / log2 6) 을 부동소수로 계산한 것. `digitCountForBytes` 의
 * BigInt 정확 계산과 일치해야 하며 테스트가 이를 단언한다 (일치가 깨지면 부동소수
 * 반올림이 경계에서 틀렸다는 뜻이고, 정본은 `digitCountForBytes` 다).
 * SPEC 에 적힌 공식이 아니다 — [C5] 참조.
 * @param {number} m
 * @returns {number}
 */
export function digitCountFormula(m) {
  if (!Number.isInteger(m) || m < 0) {
    throw new RangeError(`바이트 수는 0 이상 정수여야 한다: ${m}`);
  }
  return Math.ceil((m * 8) / Math.log2(BASE));
}

/** m = 0..8 사전 계산 표 (인덱스 = 바이트 수). */
const TAIL_DIGITS = Object.freeze(buildTailTable());

function buildTailTable() {
  const table = [];
  for (let m = 0; m <= CHUNK_BYTES; m += 1) table.push(minDigitsExact(m));
  return table;
}

/** min{ k : 6^k >= 2^(8m) } 를 BigInt 로 정확히 계산. */
function minDigitsExact(m) {
  const target = 1n << BigInt(8 * m);
  let k = 0;
  let pow = 1n;
  while (pow < target) {
    pow *= BASE_BIG;
    k += 1;
  }
  return k;
}

/**
 * 전체 바이트 길이에 대응하는 digit 총 개수.
 * @param {number} byteLength
 * @returns {number}
 */
export function digitCountForByteLength(byteLength) {
  if (!Number.isInteger(byteLength) || byteLength < 0) {
    throw new RangeError(`바이트 길이는 0 이상 정수여야 한다: ${byteLength}`);
  }
  const full = Math.floor(byteLength / CHUNK_BYTES);
  const tail = byteLength % CHUNK_BYTES;
  return full * CHUNK_DIGITS + TAIL_DIGITS[tail];
}

/** 꼬리 digit 수 → 꼬리 바이트 수 역인덱스. */
const TAIL_DIGITS_TO_BYTES = (() => {
  const map = new Map();
  for (let m = 0; m < CHUNK_BYTES; m += 1) map.set(TAIL_DIGITS[m], m);
  return map;
})();

/**
 * digit 총 개수 → 바이트 길이. 꼬리 digit 수 {0,4,7,10,13,16,19,22} 가 서로 다르고
 * 모두 25 미만이라 유일하게 역산된다. [C5] 참고 — 정본은 헤더 길이 필드다.
 * @param {number} digitCount
 * @returns {number}
 */
export function byteLengthForDigitCount(digitCount) {
  if (!Number.isInteger(digitCount) || digitCount < 0) {
    throw new RangeError(`digit 개수는 0 이상 정수여야 한다: ${digitCount}`);
  }
  const full = Math.floor(digitCount / CHUNK_DIGITS);
  const rem = digitCount % CHUNK_DIGITS;
  const tailBytes = TAIL_DIGITS_TO_BYTES.get(rem);
  if (tailBytes === undefined) {
    throw new RangeError(`유효한 청크 분해가 없는 digit 개수: ${digitCount} (나머지 ${rem})`);
  }
  return full * CHUNK_BYTES + tailBytes;
}

// ── 청크 단위 원시 변환 ([C4] 상수 메모리 프리미티브) ──────────────────────────

/**
 * 바이트 구간 → BigInt (빅엔디안, [C2]).
 * @param {Uint8Array|number[]} bytes
 * @param {number} offset
 * @param {number} length 1..8 (그 이상도 동작하지만 청크 규약 밖)
 * @returns {bigint}
 */
export function bytesToBigInt(bytes, offset = 0, length = bytes.length - offset) {
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
 * BigInt → 바이트 구간에 기록 (빅엔디안, [C2]).
 * @param {bigint} value
 * @param {Uint8Array} out
 * @param {number} offset
 * @param {number} length
 */
export function bigIntToBytes(value, out, offset, length) {
  if (value < 0n) throw new RangeError('음수는 인코딩할 수 없다');
  let rest = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[offset + i] = Number(rest & BYTE_MASK);
    rest >>= 8n;
  }
  if (rest !== 0n) {
    throw new RangeError(`값이 ${length} 바이트에 들어가지 않는다: ${value}`);
  }
}

/**
 * BigInt → digit 배열에 기록 (MSD first, [C3]). 앞은 0 으로 패딩.
 * @param {bigint} value
 * @param {number} digitCount
 * @param {Uint8Array|number[]} out
 * @param {number} offset
 */
export function bigIntToDigits(value, digitCount, out, offset = 0) {
  if (value < 0n) throw new RangeError('음수는 인코딩할 수 없다');
  let rest = value;
  for (let i = digitCount - 1; i >= 0; i -= 1) {
    out[offset + i] = Number(rest % BASE_BIG);
    rest /= BASE_BIG;
  }
  if (rest !== 0n) {
    throw new RangeError(`값이 digit ${digitCount} 개에 들어가지 않는다: ${value}`);
  }
}

/**
 * digit 구간 → BigInt (MSD first, [C3]).
 * @param {Uint8Array|number[]} digits
 * @param {number} offset
 * @param {number} digitCount
 * @returns {bigint}
 */
export function digitsToBigInt(digits, offset = 0, digitCount = digits.length - offset) {
  let value = 0n;
  for (let i = 0; i < digitCount; i += 1) {
    const d = digits[offset + i];
    if (!Number.isInteger(d) || d < 0 || d >= BASE) {
      throw new RangeError(`digit 범위 위반: index ${offset + i} = ${d} (허용 0..${BASE - 1})`);
    }
    value = value * BASE_BIG + BigInt(d);
  }
  return value;
}

/**
 * 한 청크(1..8 바이트) → digit 들. 작업 메모리 상수.
 * @param {Uint8Array} bytes
 * @param {number} byteOffset
 * @param {number} byteLength 1..8
 * @param {Uint8Array|number[]} out
 * @param {number} digitOffset
 * @returns {number} 기록한 digit 개수
 */
export function encodeChunkInto(bytes, byteOffset, byteLength, out, digitOffset) {
  if (byteLength < 1 || byteLength > CHUNK_BYTES) {
    throw new RangeError(`청크 바이트 길이는 1..${CHUNK_BYTES}: ${byteLength}`);
  }
  const digitCount = TAIL_DIGITS[byteLength];
  bigIntToDigits(bytesToBigInt(bytes, byteOffset, byteLength), digitCount, out, digitOffset);
  return digitCount;
}

/**
 * 한 청크의 digit 들 → 바이트. 작업 메모리 상수.
 * @param {Uint8Array|number[]} digits
 * @param {number} digitOffset
 * @param {number} byteLength 1..8 (기대 바이트 수 — 헤더 길이 필드에서 온다)
 * @param {Uint8Array} out
 * @param {number} byteOffset
 * @returns {number} 소비한 digit 개수
 */
export function decodeChunkInto(digits, digitOffset, byteLength, out, byteOffset) {
  if (byteLength < 1 || byteLength > CHUNK_BYTES) {
    throw new RangeError(`청크 바이트 길이는 1..${CHUNK_BYTES}: ${byteLength}`);
  }
  const digitCount = TAIL_DIGITS[byteLength];
  const value = digitsToBigInt(digits, digitOffset, digitCount);
  bigIntToBytes(value, out, byteOffset, byteLength);
  return digitCount;
}

// ── 스트림 API ────────────────────────────────────────────────────────────────

/**
 * 바이트열 → base-6 digit 열. 8바이트 청크 단위 스트리밍 ([C4]).
 * @param {Uint8Array} bytes
 * @returns {Uint8Array} digit 값 {0..5} 의 배열
 */
export function bytesToDigits(bytes) {
  assertBytes(bytes);
  const out = new Uint8Array(digitCountForByteLength(bytes.length));
  let byteOffset = 0;
  let digitOffset = 0;
  while (byteOffset < bytes.length) {
    const take = Math.min(CHUNK_BYTES, bytes.length - byteOffset);
    digitOffset += encodeChunkInto(bytes, byteOffset, take, out, digitOffset);
    byteOffset += take;
  }
  return out;
}

/**
 * base-6 digit 열 → 바이트열.
 * @param {Uint8Array|number[]} digits
 * @param {number} [byteLength] 페이로드 헤더의 바이트 길이 필드 ([C5] 정본).
 *   생략하면 digit 개수로부터 역산한다.
 * @returns {Uint8Array}
 */
export function digitsToBytes(digits, byteLength) {
  if (!digits || typeof digits.length !== 'number') {
    throw new TypeError('digits 는 배열 유사 객체여야 한다');
  }
  const len = byteLength === undefined ? byteLengthForDigitCount(digits.length) : byteLength;
  const expected = digitCountForByteLength(len);
  if (digits.length !== expected) {
    throw new RangeError(
      `digit 개수 불일치: ${digits.length} 개, 바이트 길이 ${len} 는 ${expected} 개를 요구`,
    );
  }
  const out = new Uint8Array(len);
  let byteOffset = 0;
  let digitOffset = 0;
  while (byteOffset < len) {
    const take = Math.min(CHUNK_BYTES, len - byteOffset);
    digitOffset += decodeChunkInto(digits, digitOffset, take, out, byteOffset);
    byteOffset += take;
  }
  return out;
}

/**
 * 출력 배열을 통째로 잡지 않는 진짜 스트리밍 변환. digit 을 하나씩 흘린다.
 * @param {Uint8Array} bytes
 * @yields {number} digit {0..5}
 */
export function* iterDigits(bytes) {
  assertBytes(bytes);
  const scratch = new Uint8Array(CHUNK_DIGITS);
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
