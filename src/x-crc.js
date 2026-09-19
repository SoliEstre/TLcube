/**
 * Type X 프레임 CRC(rd-5 초안 v2, DESIGN_003 §3\~§4 — **옵션 구현, 와이어 잠금 아님**: 운영자 카드 d-x-header 답과 소비자 ACK 뒤 계약 X.4 로).
 *
 * 왜: D-3/D-3b 실복호에서 «RS ok · 본문 불일치» 가 6 건(전부 e = nsym, 2s+e > nsym) 나왔고 그중 1 건은 길이까지 원문과 같았어요 —
 * 길이/UTF-8 검사로는 못 막아요. 도메인에 결속한 CRC 가 «맞는 프로파일·순서로 읽은 온전한 프레임인가» 를 판정해요.
 *
 * 바이트 계약(1 B 헤더 배치):
 *   frame[B] = u8(L) ‖ payload[L] ‖ CRC32C_LE[4] ‖ zero_padding[B − L − 5],  0 ≤ L ≤ min(255, B − 5)
 *   CRC 입력 = domainBytes ‖ frame[0 : 1+L]   (u8 L + payload 원바이트; 패딩·패리티 제외)
 *   CRC-32C: reflected 0x82f63b78, init/final XOR 0xffffffff (h-codec.js 의 crc32c 재사용)
 * 도메인 문자열(UTF-8, 구분자 '|', 값에 '|' 금지, 종료 구분자 있음):
 *   TLcube:X:crc:v0|<profileId>|<layoutId>|N<N>c<c>|<scanOrderId>|<toneCodebookId>|<maskId>|<ecc>|rev<wireRevision>|
 *   scanOrderId 는 registry 기본값이 아니라 실제 쓰인 순서(cap.layout.profile.scanOrderId).
 * 검증 순서: (RS → symbolsToBytes 는 x-codec) → B ≥ 5 · L ≤ B−5 · 패딩 0 → 원바이트 CRC → strict UTF-8 → verified:true.
 * wireRevision 은 명시 변경 규칙: 예약·finder·format·nsym 규칙/표 버전·프레임 배치·CRC 파라미터·코덱 리비전이 바뀌면 올려요.
 */
import { crc32c } from './h-codec.js';

export const X_CRC_ID = 'x-crc32c-v0';
export const X_CRC_BYTES = 4;
export const X_WIRE_REVISION = 0;
export const X_CRC_DOMAIN_PREFIX = 'TLcube:X:crc:v0';

const encoder = new TextEncoder();
// ignoreBOM: 기본 TextDecoder 는 선두 U+FEFF 를 «소비» 해 원바이트를 CRC 로 검증해도 JS 문자열이 달라져요(codex 0118) — 텍스트 왕복 계약이라 BOM 도 문자로 보존
const strictDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function field(name, value) {
  const s = String(value);
  if (s.includes('|')) throw new RangeError(`CRC 도메인 필드 ${name} 에 '|' 금지`);
  return s;
}

/** 도메인 문자열 — 실제 와이어 선택(순서·코드북·마스크·ECC)에 결속 */
export function xCrcDomain({ profileId, layoutId, N, c, scanOrderId, toneCodebookId, maskId, ecc }, wireRevision = X_WIRE_REVISION) {
  for (const [k, v] of Object.entries({ profileId, layoutId, N, c, scanOrderId, toneCodebookId, maskId, ecc })) {
    if (v === undefined || v === null) throw new RangeError(`CRC 도메인 필드 ${k} 가 없어요`);
  }
  if (!Number.isInteger(N) || !Number.isInteger(c) || !Number.isInteger(wireRevision)) throw new RangeError('N/c/wireRevision 은 정수');
  return `${X_CRC_DOMAIN_PREFIX}|${field('profileId', profileId)}|${field('layoutId', layoutId)}|N${N}c${c}|${field('scanOrderId', scanOrderId)}|${field('toneCodebookId', toneCodebookId)}|${field('maskId', maskId)}|${field('ecc', ecc)}|rev${wireRevision}|`;
}

export function xCrcDomainBytes(fields, wireRevision) {
  return encoder.encode(xCrcDomain(fields, wireRevision));
}

/** payload 최대 = B − 1(L) − 4(CRC), 255 상한 */
export function xCrcMaxPayload(dataBytes) {
  if (!Number.isInteger(dataBytes) || dataBytes < 5) return 0;
  return Math.min(255, dataBytes - 1 - X_CRC_BYTES);
}

function crcOver(domainBytes, headerAndPayload) {
  const buf = new Uint8Array(domainBytes.length + headerAndPayload.length);
  buf.set(domainBytes, 0);
  buf.set(headerAndPayload, domainBytes.length);
  return crc32c(buf) >>> 0;
}

/** 프레임 만들기 — 배치 §3 그대로. header.js 의 frame() 뒤에 CRC 를 «붙이는» 구현이 아니에요(레이아웃 혼용 금지). */
export function frameX(text, dataBytes, domainBytes) {
  if (!Number.isInteger(dataBytes) || dataBytes < 5) throw new RangeError(`dataBytes 는 5 이상 정수: ${dataBytes}`);
  if (!(domainBytes instanceof Uint8Array) || domainBytes.length === 0) throw new TypeError('domainBytes 가 필요해요');
  if (typeof text !== 'string') throw new TypeError('text 는 문자열이어야 해요');
  // 고립 surrogate 는 TextEncoder 가 U+FFFD 로 바꿔 «조용히 다른 본문» 이 되므로 인코드 단계에서 거절(왕복 계약). NUL·보충평면·내부 BOM 은 그대로 바이트로.
  if (typeof text.isWellFormed === 'function' ? !text.isWellFormed() : /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) throw new RangeError('고립 surrogate 를 포함한 문자열은 인코드할 수 없어요');
  const payload = encoder.encode(text);
  const max = xCrcMaxPayload(dataBytes);
  if (payload.length > max) throw new RangeError(`페이로드 ${payload.length} B > 용량 ${max} B (B ${dataBytes} − 1 − 4)`);
  const out = new Uint8Array(dataBytes);
  out[0] = payload.length;
  out.set(payload, 1);
  const crc = crcOver(domainBytes, out.subarray(0, 1 + payload.length));
  const at = 1 + payload.length;
  out[at] = crc & 0xff; out[at + 1] = (crc >>> 8) & 0xff; out[at + 2] = (crc >>> 16) & 0xff; out[at + 3] = (crc >>> 24) & 0xff;
  return out;
}

/**
 * 프레임 검증·해체 — 순서: 길이/CRC 위치/패딩 → 원바이트 CRC → strict UTF-8. 어느 단계든 실패는 throw(RangeError, `stage` 필드).
 * 문자열화·재인코딩으로 원바이트를 바꾸지 않아요.
 */
export function unframeX(data, domainBytes) {
  if (!(data instanceof Uint8Array)) throw new TypeError('Uint8Array 여야 해요');
  if (!(domainBytes instanceof Uint8Array) || domainBytes.length === 0) throw new TypeError('domainBytes 가 필요해요');
  const B = data.length;
  const fail = (stage, message) => { const e = new RangeError(message); e.stage = stage; throw e; };
  if (B < 5) fail('length', `프레임 ${B} B < 5`);
  const L = data[0];
  if (L > B - 5) fail('length', `길이 필드 ${L} > B−5 = ${B - 5}`);
  for (let i = 5 + L; i < B; i += 1) if (data[i] !== 0) fail('padding', `패딩 [${5 + L}, ${B}) 에 비영 바이트`);
  const stored = (data[1 + L] | (data[2 + L] << 8) | (data[3 + L] << 16) | (data[4 + L] << 24)) >>> 0;
  const expected = crcOver(domainBytes, data.subarray(0, 1 + L));
  if (stored !== expected) fail('crc', `CRC 불일치 (stored ${stored.toString(16)} ≠ ${expected.toString(16)})`);
  let text;
  try { text = strictDecoder.decode(data.subarray(1, 1 + L)); }
  catch (cause) { fail('utf8', '페이로드가 유효한 UTF-8 이 아니에요'); }
  return { text, payloadLength: L, crc: stored, padding: B - 5 - L };
}
