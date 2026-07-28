// header.js — 페이로드 헤더와 코드워드 프레이밍 (SPEC §4.5)
//
// 코드워드는 (버전, ECC) 별 **고정 크기**다:
//
//   ┌────────┬──────────────────────┬──────────┬───────────────┐
//   │ 길이 1B │ UTF-8 페이로드        │ 0x00 패딩 │ RS 패리티      │
//   └────────┴──────────────────────┴──────────┴───────────────┘
//   └──────────── RS 적용 범위 ───────────────┘
//
// 이 모듈은 RS 적용 **전**의 바이트열(= 길이 + 페이로드 + 패딩)만 만들고 되읽는다.
// 패리티는 rs.js 소관이고, digit 변환은 base6.js 소관이다.
//
// [H1] 길이 필드는 **1 바이트**, 페이로드 바이트 수 0..255.
//      타입 필드는 두지 않는다 — 페이로드는 UTF-8 텍스트 고정이고 콘텐츠 타입 판별은
//      소비자 몫이다 (QR byte mode 와 같은 스탠스).
//
// [H2] 패딩은 **0x00**. QR 식 0xEC/0x11 교대 패턴을 쓰지 않는 이유: 시각 균일화는
//      마스크(SPEC §4.3)의 책임이고 여기서 중복할 이유가 없다.
//
// [H3] 길이 필드의 **유일한** 역할은 패딩 절단이다. digit 경계·청크 모호성과 무관하다.
//
// [H4] 페이로드 인코딩은 UTF-8 고정. 문자 수가 아니라 **바이트 수**가 용량을 정한다 —
//      한글 1자 = 3 바이트다.

/** 길이 필드 크기 (바이트). */
export const HEADER_BYTES = 1;

/** 길이 필드가 표현 가능한 최대 페이로드 바이트 수. */
export const MAX_PAYLOAD_BYTES = 255;

/** 패딩 바이트 값. */
export const PAD_BYTE = 0x00;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * 데이터 영역 크기에서 실을 수 있는 최대 페이로드 바이트 수.
 * @param {number} dataBytes 코드워드에서 RS 패리티를 뺀 크기 (헤더 포함)
 * @returns {number}
 */
export function maxPayloadFor(dataBytes) {
  assertSize(dataBytes, 'dataBytes');
  if (dataBytes < HEADER_BYTES) return 0;
  return Math.min(dataBytes - HEADER_BYTES, MAX_PAYLOAD_BYTES);
}

/**
 * 문자열을 UTF-8 로 인코딩한 바이트 수. 용량 판정에 쓴다.
 * @param {string} text
 * @returns {number}
 */
export function payloadByteLength(text) {
  if (typeof text !== 'string') throw new TypeError(`문자열이어야 한다: ${typeof text}`);
  return encoder.encode(text).length;
}

/**
 * UTF-8 텍스트 → 고정 크기 데이터 영역 (헤더 + 페이로드 + 0x00 패딩).
 * 이 결과가 rs.js 의 메시지 입력이 된다.
 *
 * @param {string} text UTF-8 페이로드
 * @param {number} dataBytes 데이터 영역 고정 크기 (= 코드워드 − 패리티)
 * @returns {Uint8Array} 길이 정확히 dataBytes
 */
export function frame(text, dataBytes) {
  assertSize(dataBytes, 'dataBytes');
  const payload = encoder.encode(text);

  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new RangeError(
      `페이로드 ${payload.length} B 는 1 바이트 길이 필드로 표현 불가 (최대 ${MAX_PAYLOAD_BYTES} B)`);
  }
  const capacity = maxPayloadFor(dataBytes);
  if (payload.length > capacity) {
    throw new RangeError(
      `페이로드 ${payload.length} B 가 데이터 영역 ${dataBytes} B 의 용량 ${capacity} B 를 초과한다`);
  }

  const out = new Uint8Array(dataBytes);   // 기본값이 0 이므로 패딩은 자동
  out[0] = payload.length;
  out.set(payload, HEADER_BYTES);
  return out;
}

/**
 * 데이터 영역 → UTF-8 텍스트. RS 복호 **후**에 호출한다.
 *
 * 손상된 데이터가 여기까지 오면 길이 필드가 쓰레기일 수 있다. 그 경우 조용히 잘린
 * 문자열을 돌려주지 않고 던진다 — 조용한 오복호가 예외보다 훨씬 나쁘다.
 *
 * @param {Uint8Array} data 고정 크기 데이터 영역
 * @param {{lenient?: boolean}} [options] lenient=true 면 길이 초과를 클램프한다 (디버깅용)
 * @returns {{text: string, payloadLength: number, padding: number}}
 */
export function unframe(data, options = {}) {
  if (!(data instanceof Uint8Array)) throw new TypeError('Uint8Array 여야 한다');
  if (data.length < HEADER_BYTES) {
    throw new RangeError(`데이터 영역이 헤더보다 작다: ${data.length} B`);
  }

  const declared = data[0];
  const available = data.length - HEADER_BYTES;
  let length = declared;

  if (declared > available) {
    if (!options.lenient) {
      throw new RangeError(
        `길이 필드 ${declared} B 가 가용 ${available} B 를 초과한다 — 데이터 손상 (RS 복호 실패를 의심하라)`);
    }
    length = available;
  }

  const bytes = data.subarray(HEADER_BYTES, HEADER_BYTES + length);
  let text;
  try {
    text = decoder.decode(bytes);
  } catch (cause) {
    throw new RangeError('페이로드가 유효한 UTF-8 이 아니다 — 데이터 손상', { cause });
  }
  return { text, payloadLength: length, padding: available - length };
}

function assertSize(n, name) {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`${name} 은 0 이상 정수여야 한다: ${n}`);
  }
}
