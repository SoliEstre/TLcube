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
import { X_CRC_ID, X_CRC_BYTES, xCrcDomainBytes, xCrcMaxPayload, frameX, unframeX } from './x-crc.js';

export const X_CODEC_SCHEMA = 'TLcube:X:codec:v0;header=1B;base211;rs211-single;tone2=H_BINARY;scan=cell-order-v0;mask=identity-v0;crc=TBD';
export const X_ERASED = -1;

/** 산출 스키마 문자열은 «실제 쓰인 scan order·CRC» 를 실어요 — 연구 override 산출이 기본값이라고 오표기되지 않게(codex REPORT_009) */
export function xCodecSchema(scanOrderId = 'cell-order-v0', crc = null) {
  return X_CODEC_SCHEMA.replace('scan=cell-order-v0', `scan=${scanOrderId}`).replace('crc=TBD', `crc=${crc ?? 'TBD'}`);
}

/** options.crc: undefined/false/null = 현행(CRC 없음, verified:false) · 'x-crc32c-v0' = 프레임 CRC(연구 옵션, 잠금 아님) · 그 외 거절 */
function resolveCrc(options) {
  const v = options.crc;
  if (v === undefined || v === null || v === false) return null;
  if (v === X_CRC_ID) return X_CRC_ID;
  throw new RangeError(`crc 옵션은 '${X_CRC_ID}' 또는 미지정만이에요`);
}

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
  // options.scanOrderId = rd-4 연구 override(심볼 묶음 순서) — registry/DTO 불변, 같은 프로파일의 다른 와이어 순서를 실제 코덱으로 비교할 때만.
  // undefined 만 «기본값» — 명시된 ''/false/0/NaN 은 그대로 넘겨 enum 검사가 거절하게 해요(truthy 삼항식은 우회로였어요, codex 2351).
  // options.finderId = rd-3 연구 override(파인더 예약) — 같은 규칙(undefined 만 기본값). 예약 뒤 digit 수가 줄어 용량이 자동으로 재유도돼요.
  const layout = xProfileLayout(profile, { ...(options.scanOrderId === undefined ? {} : { scanOrderId: options.scanOrderId }), ...(options.finderId === undefined ? {} : { finderId: options.finderId }) });
  const digits = layout.digits;
  const symbols = Math.floor(digits / DIGITS_PER_SYMBOL);
  if (symbols > MAX_CODEWORD_LEN) throw new RangeError(`단일 RS 블록 한계(${MAX_CODEWORD_LEN})를 넘어요: ${symbols} — 다중 블록은 v1`);
  const nsym = xNsymFor(symbols, profile.ecc);
  const dataSymbols = symbols - nsym;
  const dataBytes = dataBytesFor(dataSymbols);
  if (dataBytes <= HEADER_BYTES) throw new RangeError('헤더를 뺀 순 용량이 0 이에요');
  const crc = resolveCrc(options);
  const payloadBytes = crc ? xCrcMaxPayload(dataBytes) : dataBytes - HEADER_BYTES;
  if (payloadBytes <= 0) throw new RangeError('CRC 를 뺀 순 용량이 0 이에요');
  const p = layout.profile;
  const crcDomain = crc ? xCrcDomainBytes({ profileId: p.profileId, layoutId: p.layoutId, N: p.N, c: p.c, scanOrderId: p.scanOrderId, toneCodebookId: p.toneCodebookId, maskId: p.maskId, ecc: profile.ecc }) : null;
  return {
    profileId: profile.profileId, ecc: profile.ecc, scanOrderId: layout.profile.scanOrderId, crc, crcDomain, digits, symbols, fillerDigits: digits - symbols * DIGITS_PER_SYMBOL,
    nsym, dataSymbols, dataBytes, payloadBytes, layout,
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
  const framed = cap.crc ? frameX(text, cap.dataBytes, cap.crcDomain) : frame(text, cap.dataBytes);
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
  // 파인더 예약 사이트(연구 옵션): 데이터 트리플에서 빠진 자리와 잔여 자리에 구조 레벨을 실어요(중심은 템플릿 그대로 상시 on)
  for (const [siteId, lv] of cap.layout.finderLevels) levels[siteId] = lv;
  return {
    schema: xCodecSchema(cap.layout.profile.scanOrderId, cap.crc), scanOrderId: cap.layout.profile.scanOrderId, crc: cap.crc,
    profileId: cap.profileId, ecc: cap.ecc, N: cap.layout.raw.N, layoutId: cap.layout.raw.layoutId, finderId: cap.layout.finderId,
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
  // 옵션 검증은 입력과 무관하게 «먼저» — 조기 반환(e > nsym) 뒤에 검사하면 불량 옵션 거절이 입력별로 달라져요(codex 0056)
  const reserve = options.erasureReserve ?? 0;
  if (!Number.isInteger(reserve) || reserve < 0 || reserve >= cap.nsym) throw new RangeError(`erasureReserve 는 0…nsym−1 정수여야 해요: ${typeof reserve === 'number' ? reserve : `<${typeof reserve}>`}`);
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
  // 모든 실패 반환은 명시 stage 를 실어요(erasure-budget · rs · bytes · length · padding · crc · utf8 · unframe) — 소비자가 reason 문자열을 파싱하지 않게(codex 0131)
  if (erasures.length > cap.nsym) return { ok: false, stage: 'erasure-budget', reason: `소거 ${erasures.length} > nsym ${cap.nsym}`, erasures: erasures.length };
  // 연구 코덱 임시 가드(D-3 wrongText 사건, REPORT_003 §7): 소거가 패리티를 전부 먹으면(e = nsym) 남은 톤 오류를 검출할 여유가 0 이라
  // «일관되지만 틀린» 코드워드로 수렴할 수 있어요. options.erasureReserve(기본 0 = 현행) 만큼 여유를 남겨요 — 근본 처방은 rd-5 CRC.
  if (erasures.length > cap.nsym - reserve) return { ok: false, stage: 'erasure-budget', reason: `소거 ${erasures.length} > nsym ${cap.nsym} − reserve ${reserve}`, erasures: erasures.length };
  const received = packed.symbols;
  for (const index of erasures) received[index] = 0;
  const decoded = rsDecode(received, cap.nsym, erasures.length ? { erasures } : {});
  if (!decoded.ok) return { ok: false, stage: 'rs', reason: decoded.reason, erasures: erasures.length };
  const messageSymbolCount = symbolCountForByteLength(cap.dataBytes);
  let framed;
  try { framed = symbolsToBytes(decoded.message.subarray(0, messageSymbolCount), cap.dataBytes); }
  catch (error) { return { ok: false, stage: 'bytes', reason: `symbols-to-bytes: ${error.message}`, erasures: erasures.length }; }
  let unframed;
  if (cap.crc) {
    // 검증 순서(DESIGN_003 v2 §3): 길이/CRC 위치/패딩 → 원바이트 CRC(도메인 결속) → strict UTF-8 → verified:true
    try { unframed = unframeX(framed, cap.crcDomain); }
    catch (error) { return { ok: false, stage: error.stage ?? 'unframe', reason: `frameX ${error.stage ?? 'error'}: ${error.message}`, erasures: erasures.length }; }
  } else {
    try { unframed = unframe(framed); }
    catch (error) { return { ok: false, stage: 'unframe', reason: `unframe: ${error.message}`, erasures: erasures.length }; }
  }
  return {
    ok: true, text: unframed.text, payloadLength: unframed.payloadLength,
    corrected: decoded.errorCount ?? 0, erasures: erasures.length,
    schema: xCodecSchema(cap.layout.profile.scanOrderId, cap.crc), scanOrderId: cap.layout.profile.scanOrderId, crc: cap.crc,
    // CRC 옵션이면 도메인 결속 CRC 까지 통과한 프레임만 verified:true — 그래도 «연구 옵션» 이라 소비자 hit 노출은 계약 X.4 잠금 뒤
    verified: Boolean(cap.crc),
  };
}
