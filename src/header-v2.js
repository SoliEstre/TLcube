/**
 * header-v2.js — 예약된 프레이밍 v2 (길이 8bit + CRC-24/OpenPGP).
 *
 * 2026-09-03: MODULE_ORDER 에 등재하지 않는다. 아무도 import 하지 않는다.
 * 이유: 옵셔널 CRC 는 0 bit 다. 디코더가 v1 프레이밍 코드를 계속 읽는 한 구 행이
 * 가설 집합에 남아 거짓 착지가 그대로 통과한다. 값을 하는 유일한 롤아웃은 파괴적
 * 전-행 단절이고, 그 단절은 SPEC §3.3 예약절의 트리거가 울리기 전에는 열지 않는다.
 * 등재하면 번들 테스트가 「치환 안 된 specifier」로 잡거나 번들만 부푼다.
 *
 * 설계는 잠갔다: 합계 4 B, 범위는 CRC 필드를 뺀 데이터 영역 전체
 * (길이 + 페이로드 + 패딩), init≠0. 배선은 트리거 발동 날의 일이다.
 *
 * 레이아웃 (dataBytes 고정):
 *   [0]        길이 1 B
 *   [1..3]     CRC-24 빅엔디안 3 B
 *   [4 ..]     UTF-8 페이로드 + 0x00 패딩
 */

export const HEADER_BYTES_V2 = 4;
export const CRC24_POLY = 0x864CFB;
export const CRC24_INIT = 0xB704CE;
export const MAX_PAYLOAD_BYTES_V2 = 255;
export const PAD_BYTE_V2 = 0x00;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * CRC-24/OpenPGP (RFC 4880): poly 0x864CFB, init 0xB704CE, 비반사, xorout 0.
 * 체크값 "123456789" → 0x21CF02.
 */
export function crc24(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Uint8Array 여야 한다');
  let crc = CRC24_INIT;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i] << 16;
    for (let bit = 0; bit < 8; bit += 1) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= CRC24_POLY;
    }
  }
  return crc & 0xFFFFFF;
}

function crcRange(data) {
  const out = new Uint8Array(1 + (data.length - HEADER_BYTES_V2));
  out[0] = data[0];
  out.set(data.subarray(HEADER_BYTES_V2), 1);
  return out;
}

function writeCrc24(data, value) {
  data[1] = (value >>> 16) & 0xFF;
  data[2] = (value >>> 8) & 0xFF;
  data[3] = value & 0xFF;
}

function readCrc24(data) {
  return ((data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
}

export function maxPayloadForV2(dataBytes) {
  if (!Number.isInteger(dataBytes) || dataBytes < 0) {
    throw new RangeError(`dataBytes 은 0 이상 정수여야 한다: ${dataBytes}`);
  }
  if (dataBytes < HEADER_BYTES_V2) return 0;
  return Math.min(dataBytes - HEADER_BYTES_V2, MAX_PAYLOAD_BYTES_V2);
}

/**
 * UTF-8 텍스트 → 고정 크기 데이터 영역 (길이 + CRC-24 + 페이로드 + 0x00 패딩).
 * CRC 는 길이바이트 + 페이로드 + 패딩 위에 걸린다 (CRC 필드 자신은 제외).
 */
export function frameV2(text, dataBytes) {
  if (typeof text !== 'string') throw new TypeError(`문자열이어야 한다: ${typeof text}`);
  if (!Number.isInteger(dataBytes) || dataBytes < 0) {
    throw new RangeError(`dataBytes 은 0 이상 정수여야 한다: ${dataBytes}`);
  }
  const payload = encoder.encode(text);
  if (payload.length > MAX_PAYLOAD_BYTES_V2) {
    throw new RangeError(
      `페이로드 ${payload.length} B 는 1 바이트 길이 필드로 표현 불가 (최대 ${MAX_PAYLOAD_BYTES_V2} B)`,
    );
  }
  const capacity = maxPayloadForV2(dataBytes);
  if (payload.length > capacity) {
    throw new RangeError(
      `페이로드 ${payload.length} B 가 데이터 영역 ${dataBytes} B 의 용량 ${capacity} B 를 초과한다`,
    );
  }
  const out = new Uint8Array(dataBytes);
  out[0] = payload.length;
  out.set(payload, HEADER_BYTES_V2);
  writeCrc24(out, crc24(crcRange(out)));
  return out;
}

/**
 * 데이터 영역 → UTF-8 텍스트. CRC 불일치는 던진다 — 조용한 오복호가 예외보다 나쁘다.
 */
export function unframeV2(data) {
  if (!(data instanceof Uint8Array)) throw new TypeError('Uint8Array 여야 한다');
  if (data.length < HEADER_BYTES_V2) {
    throw new RangeError(`데이터 영역이 헤더보다 작다: ${data.length} B`);
  }
  const stored = readCrc24(data);
  const computed = crc24(crcRange(data));
  if (stored !== computed) {
    throw new RangeError(
      `CRC-24 불일치 (stored=0x${stored.toString(16).padStart(6, '0')}`
      + ` computed=0x${computed.toString(16).padStart(6, '0')}) — 데이터 손상`,
    );
  }
  const declared = data[0];
  const available = data.length - HEADER_BYTES_V2;
  if (declared > available) {
    throw new RangeError(
      `길이 필드 ${declared} B 가 가용 ${available} B 를 초과한다 — 데이터 손상`,
    );
  }
  const bytes = data.subarray(HEADER_BYTES_V2, HEADER_BYTES_V2 + declared);
  let text;
  try {
    text = decoder.decode(bytes);
  } catch (cause) {
    throw new RangeError('페이로드가 유효한 UTF-8 이 아니다 — 데이터 손상', { cause });
  }
  return { text, payloadLength: declared, padding: available - declared };
}

if (crc24(new Uint8Array(19)) === 0) {
  throw new Error('header-v2: 전-0 19 B 의 CRC-24 가 0 이다 — init≠0 계약 위반');
}
