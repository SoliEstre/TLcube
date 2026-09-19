/**
 * Type X 코덱 골격(v0) — bytes ↔ RS 심볼 ↔ base-6 digit ↔ 사이트 레벨.
 *
 * 승계: header.js(1 B 길이 헤더 + 0 패딩) · base211(3 digit = GF(211) 심볼, 27 B ↔ 28 심볼 청킹) ·
 * rs211(단일 블록 ≤210, 소거 복호) · 2톤 패턴 = H_BINARY(000/111 = 소거). 신설: profile 별 용량 회계,
 * scan order 'cell-order-v0', 마스크 'identity-v0'(잠정).
 *
 * ⚠ 이 골격은 rd-5 의 프레임/CRC domain 이 아직 없어요 — 1 B 헤더만 있고 X domain/profile/본문 CRC 는
 * TBD 라 «전체 검증 뒤에만 수락» 규칙을 아직 만족하지 못해요. 그래서 decodeX 결과는 `verified:false`
 * 로 표시하고 소비자(x-collector)는 이를 성공으로 노출하면 안 돼요.
 */
import { frame, unframe, HEADER_BYTES } from './header.js';
import {
  bytesToSymbols, symbolsToBytes, symbolCountForByteLength, packCellDigitsToSymbols,
  unpackSymbolsToCellDigits, DIGITS_PER_SYMBOL,
} from './base211.js';
import { rsEncode, rsDecode, MAX_CODEWORD_LEN } from './rs211.js';
import { H_BINARY, H_ECC_RATIOS } from './h-profile.js';
import { xProfile, assertXProfile, xProfileLayout, xLevelsTemplate } from './x-profile.js';

export const X_CODEC_SCHEMA = 'TLcube:X:codec:v0;header=1B;base211;rs211-single;tone2=H_BINARY;scan=cell-order-v0;mask=identity-v0;crc=TBD';
export const X_ERASED = -1;

/** H 와 같은 nsym 절차(L .12 · M .25 홀수화 · H .40) — NSYM_TABLE_X 로 잠그기 전의 유도식이에요. */
export function xNsymFor(symbolCount, ecc) {
  if (!Number.isInteger(symbolCount) || symbolCount < 2) throw new RangeError(`심볼 수: ${symbolCount}`);
  if (!H_ECC_RATIOS[ecc]) throw new RangeError(`ecc: ${ecc}`);
  let nsym = Math.max(1, Math.round(H_ECC_RATIOS[ecc] * symbolCount));
  if (ecc === 'M' && nsym % 2 === 0) nsym += 1;
  if (nsym >= symbolCount) throw new RangeError('패리티가 심볼 전부를 먹어요');
  return nsym;
}

/** 데이터 심볼 수에 정확히 담기는 최대 바이트 수(base-211 청킹 실호출) */
function dataBytesFor(dataSymbols) {
  let bytes = 0;
  while (symbolCountForByteLength(bytes + 1) <= dataSymbols) bytes += 1;
  return bytes;
}

function resolve(profileOrId, options = {}) {
  const profile = typeof profileOrId === 'string' ? xProfile(profileOrId) : { ...assertXProfile(profileOrId), ecc: profileOrId.ecc };
  if (options.ecc) profile.ecc = options.ecc;
  if (profile.tones !== 2) throw new RangeError('v0 코덱은 2톤만 지원해요');
  return profile;
}

/**
 * 용량 회계 — raw digit 이 아니라 실호출로 유도한 값이에요.
 * @returns {{profileId, ecc, digits, symbols, fillerDigits, nsym, dataSymbols, dataBytes, payloadBytes}}
 */
export function xCapacity(profileOrId, options = {}) {
  const profile = resolve(profileOrId, options);
  // options.scanOrderId = rd-4 연구 override(심볼 묶음 순서) — registry/DTO 불변, 같은 프로파일의 다른 와이어 순서를 실제 코덱으로 비교할 때만
  const layout = xProfileLayout(profile, options.scanOrderId ? { scanOrderId: options.scanOrderId } : {});
  const digits = layout.digits;
  const symbols = Math.floor(digits / DIGITS_PER_SYMBOL);
  if (symbols > MAX_CODEWORD_LEN) throw new RangeError(`단일 RS 블록 한계(${MAX_CODEWORD_LEN})를 넘어요: ${symbols} — 다중 블록은 v1`);
  const nsym = xNsymFor(symbols, profile.ecc);
  const dataSymbols = symbols - nsym;
  const dataBytes = dataBytesFor(dataSymbols);
  if (dataBytes <= HEADER_BYTES) throw new RangeError('헤더를 뺀 순 용량이 0 이에요');
  return {
    profileId: profile.profileId, ecc: profile.ecc, digits, symbols, fillerDigits: digits - symbols * DIGITS_PER_SYMBOL,
    nsym, dataSymbols, dataBytes, payloadBytes: dataBytes - HEADER_BYTES, layout,
  };
}

/** 2톤 패턴 → digit(H_BINARY), 000/111/미관측 → X_ERASED */
export function xDigitFromLevels(pattern) {
  if (!pattern || pattern.length !== 3) return X_ERASED;
  for (let d = 0; d < H_BINARY.length; d += 1) {
    const p = H_BINARY[d];
    if (pattern[0] === p[0] && pattern[1] === p[1] && pattern[2] === p[2]) return d;
  }
  return X_ERASED;
}

/**
 * 인코드: text → 사이트 레벨(0/1). digits 는 scan order(cell-order-v0) 의 trip 별 digit.
 */
export function encodeX(text, profileOrId, options = {}) {
  const cap = xCapacity(profileOrId, options);
  const framed = frame(text, cap.dataBytes);
  const messageSymbols = bytesToSymbols(framed);
  if (messageSymbols.length > cap.dataSymbols) throw new RangeError('메시지 심볼이 데이터 심볼 수를 넘어요');
  const message = new Uint8Array(cap.dataSymbols);
  message.set(messageSymbols);
  const codeword = rsEncode(message, cap.nsym);
  const digits = new Uint8Array(cap.digits); // filler digit 은 0(프리마스크 0 승계, 마스크 identity)
  digits.set(unpackSymbolsToCellDigits(codeword));
  const levels = xLevelsTemplate(cap.layout);
  cap.layout.triples.forEach((triple, i) => {
    const pattern = H_BINARY[digits[i]];
    triple.forEach((siteId, k) => { levels[siteId] = pattern[k]; });
  });
  return {
    schema: X_CODEC_SCHEMA, profileId: cap.profileId, ecc: cap.ecc, N: cap.layout.raw.N, layoutId: cap.layout.raw.layoutId,
    nsym: cap.nsym, dataSymbols: cap.dataSymbols, dataBytes: cap.dataBytes, payloadLength: new TextEncoder().encode(text).length,
    messageSymbolCount: messageSymbols.length, codeword, digits, levels,
  };
}

/**
 * 디코드: 사이트 레벨(0/1/null=미관측) 또는 scan order digit 배열(-1 = 소거) → text.
 * 소거 = 미관측·불법 패턴(000/111)·불법 심볼(211…215). 오류(잘못 읽힌 합법 digit)는 RS 가 2e+s ≤ nsym 안에서 정정.
 * @returns {{ok:true, text, payloadLength, corrected:number, erasures:number, verified:false} | {ok:false, reason, erasures:number}}
 */
export function decodeX(input, profileOrId, options = {}) {
  const cap = xCapacity(profileOrId, options);
  let digits;
  if (input && input.levels) {
    digits = cap.layout.triples.map(triple => xDigitFromLevels(triple.map(siteId => {
      const v = input.levels[siteId];
      return v === null || v === undefined ? null : v;
    })));
  } else if (input && input.digits) {
    digits = Array.from(input.digits);
  } else throw new TypeError('decodeX 입력은 {levels} 또는 {digits} 예요');
  if (digits.length !== cap.digits) throw new RangeError(`digit 수 ${digits.length} ≠ ${cap.digits}`);
  const used = digits.slice(0, cap.symbols * DIGITS_PER_SYMBOL);
  const erased = new Set();
  const clean = used.map((d, i) => {
    if (Number.isInteger(d) && d >= 0 && d < 6) return d;
    erased.add(Math.floor(i / DIGITS_PER_SYMBOL));
    return 0;
  });
  const packed = packCellDigitsToSymbols(clean);
  for (const index of packed.illegalIndices) erased.add(index);
  const erasures = [...erased].sort((a, b) => a - b);
  if (erasures.length > cap.nsym) return { ok: false, reason: `소거 ${erasures.length} > nsym ${cap.nsym}`, erasures: erasures.length };
  const received = packed.symbols;
  for (const index of erasures) received[index] = 0;
  const decoded = rsDecode(received, cap.nsym, erasures.length ? { erasures } : {});
  if (!decoded.ok) return { ok: false, reason: decoded.reason, erasures: erasures.length };
  const messageSymbolCount = symbolCountForByteLength(cap.dataBytes);
  let framed;
  try { framed = symbolsToBytes(decoded.message.subarray(0, messageSymbolCount), cap.dataBytes); }
  catch (error) { return { ok: false, reason: `symbols-to-bytes: ${error.message}`, erasures: erasures.length }; }
  let unframed;
  try { unframed = unframe(framed); }
  catch (error) { return { ok: false, reason: `unframe: ${error.message}`, erasures: erasures.length }; }
  return {
    ok: true, text: unframed.text, payloadLength: unframed.payloadLength,
    corrected: decoded.errorCount ?? 0, erasures: erasures.length,
    verified: false, // rd-5 의 X domain/profile/본문 CRC 가 아직 없어요 — 소비자는 성공으로 노출 금지
  };
}
