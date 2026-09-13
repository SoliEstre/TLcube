/**
 * 공개 H-v2 codec. Y 그룹 표시와 별도로 부분면 수집·CRC 결속을 담당해요.
 * 하위 8bit routeId 만으로 물체 고유를 보장하지 않아요. 수용 게이트는
 * 전체 CRC32C 와 본문 검증이에요.
 */
import {
  H_SCHEMA, H_SCHEMA_CORNER, H_SCHEMA_FACES, H_SCHEMA_FACES_CORNER, H_SCHEMA_SINGLE, H_SCHEMA_SINGLE_CORNER,
  H_FACE_IDS, H_ECC, H_ECC_RATIOS, H_BINARY, hModeGroups, hModeFaces, isLegacyHMode,
  normalizeHProfile, hMaskValue,resolveHFinder,
} from './h-profile.js';
import { hLayout, makeFaces, validateHFace } from './h-layout.js';
import {
  symbolCountForByteLength, bytesToSymbols, unpackSymbolsToCellDigits,
  packCellDigitsToSymbols, symbolsToBytes,
} from './base211.js';
import { rsEncode, rsDecode } from './rs211.js';
import { ranksToDigit } from './lehmer.js';

const MAX_BLOCK = 210;
const CRC_POLY = 0x82f63b78;
const ENCODE_KEYS = Object.freeze(['version', 'mode', 'tones', 'ecc', 'eccLevel', 'mask','finder','maskLuminance']);
const CAPACITY_KEYS = Object.freeze(['tones', 'ecc', 'eccLevel', 'mask','finder']);
const BINARY_DIGIT = new Map(H_BINARY.map((bits, digit) => [bits.join(','), digit]));

function assertKnownKeys(options, allowed) {
  if (options == null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options 는 객체여야 해요');
  }
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) throw new RangeError(`알 수 없는 option: ${key}`);
  }
}

function resolveEcc(options) {
  const hasEcc = Object.prototype.hasOwnProperty.call(options, 'ecc');
  const hasLevel = Object.prototype.hasOwnProperty.call(options, 'eccLevel');
  if (hasEcc && hasLevel && options.ecc !== options.eccLevel) {
    throw new RangeError('ecc 와 eccLevel 이 충돌해요');
  }
  const ecc = hasEcc ? options.ecc : hasLevel ? options.eccLevel : 'M';
  if (!H_ECC.includes(ecc)) throw new RangeError(`ECC 는 L|M|H: ${ecc}`);
  return ecc;
}

function concatBytes(parts) {
  let n = 0;
  for (const part of parts) n += part.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

function writeU16(out, offset, value) {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(out, offset, value) {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

function mod6(value) {
  return ((value % 6) + 6) % 6;
}
function modRadix(value, radix) { return ((value % radix) + radix) % radix; }

/** Castagnoli CRC-32C. reflected 0x82f63b78, init/final XOR 0xffffffff. */
export function crc32c(bytes) {
  if (!bytes || typeof bytes.length !== 'number') throw new TypeError('crc32c 입력');
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? CRC_POLY : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function splitBlockLengths(symbolCount) {
  const blockCount = Math.ceil(symbolCount / MAX_BLOCK);
  if (!(blockCount >= 1)) throw new RangeError(`지원하지 않는 profile: 심볼 ${symbolCount}`);
  const base = Math.floor(symbolCount / blockCount);
  const rem = symbolCount % blockCount;
  const lengths = [];
  for (let b = 0; b < blockCount; b += 1) lengths.push(base + (b < rem ? 1 : 0));
  if (lengths.reduce((s, n) => s + n, 0) !== symbolCount) {
    throw new RangeError('지원하지 않는 profile: 블록 길이 합');
  }
  if (lengths.some((n) => n < 1 || n > MAX_BLOCK)) {
    throw new RangeError('지원하지 않는 profile: 블록 길이');
  }
  return lengths;
}

function nsymFor(count, ecc) {
  let nsym = Math.max(1, Math.round(H_ECC_RATIOS[ecc] * count));
  if (ecc === 'M' && nsym % 2 === 0) nsym += 1;
  return nsym;
}

function exactPacketBytes(dataSymbols) {
  let best = -1;
  for (let bytes = 7; bytes <= dataSymbols; bytes += 1) {
    if (symbolCountForByteLength(bytes) === dataSymbols) best = bytes;
  }
  return best;
}

function domainBytes(profile, chunkBytes, payloadLength, padded) {
  // 이 함수의 legacy byte layout은 절대 수정하지 않아요.
  const ident = new TextEncoder().encode(profile.finder==='corners'?H_SCHEMA_CORNER:H_SCHEMA);
  const fields = new Uint8Array(11);
  fields[0] = profile.version;
  fields[1] = profile.n;
  fields[2] = profile.mode;
  fields[3] = profile.mode / 3;
  fields[4] = profile.tones;
  fields[5] = H_ECC.indexOf(profile.ecc);
  fields[6] = profile.mask;
  writeU16(fields, 7, chunkBytes);
  writeU16(fields, 9, payloadLength);
  return concatBytes([ident, fields, padded]);
}

/**
 * @param {number} [version]
 * @param {1|2|3|4|5|6} [mode]
 * @param {{tones?:number,ecc?:string,eccLevel?:string,mask?:number}} [options]
 */
export function hCapacity(version = 0, mode = 3, options = {}) {
  assertKnownKeys(options, CAPACITY_KEYS);
  const ecc = resolveEcc(options);
  const tones = options.tones ?? 3;
  const mask = options.mask ?? 0;
  const profile = normalizeHProfile({ version, mode, tones, ecc, mask,finder:options.finder??'frame' });
  const layout = hLayout(profile.version,profile.finder);
  if(!isLegacyHMode(mode)) return hGroupCapacity(profile,layout);
  const cellCount = layout.scan.length;
  if (cellCount % 3 !== 0) throw new RangeError('지원하지 않는 profile: scan 배수');
  const symbolCount = cellCount / 3;
  const lengths = splitBlockLengths(symbolCount);
  const step = ecc === 'M' ? 2 : 1;
  const blocks = lengths.map((count) => {
    const nsym = nsymFor(count, ecc);
    return { symbolCount: count, nsym, dataSymbols: count - nsym };
  });
  for (let guard = 0; guard <= MAX_BLOCK; guard += 1) {
    for (const row of blocks) {
      if (!(row.nsym > 0 && row.dataSymbols > 0 && row.nsym + row.dataSymbols === row.symbolCount)) {
        throw new RangeError('지원하지 않는 profile: 블록 패리티');
      }
    }
    const dataSymbols = blocks.reduce((sum, row) => sum + row.dataSymbols, 0);
    const dataBytes = exactPacketBytes(dataSymbols);
    if (dataBytes >= 7) {
      const chunkBytes = dataBytes - 6;
      if (chunkBytes > 0) {
        return {
          version: profile.version,
          n: profile.n,
          mode: profile.mode,
          tones: profile.tones,
          ecc: profile.ecc,
          eccLevel: profile.ecc,
          mask: profile.mask,
          finder:profile.finder,
          cellCount,
          symbolCount,
          blocks: blocks.map((row) => ({ ...row })),
          dataSymbols,
          dataBytes,
          chunkBytes,
          maxPayloadBytes: chunkBytes * (profile.mode / 3),
        };
      }
    }
    blocks[0].nsym += step;
    blocks[0].dataSymbols = blocks[0].symbolCount - blocks[0].nsym;
  }
  throw new RangeError('지원하지 않는 profile: packet 길이');
}

function encodeBlocks(messageSymbols, capacity) {
  if (messageSymbols.length !== capacity.dataSymbols) {
    throw new Error(`bytesToSymbols ${messageSymbols.length} !== dataSymbols ${capacity.dataSymbols}`);
  }
  let offset = 0;
  const parts = [];
  for (const row of capacity.blocks) {
    const msg = messageSymbols.subarray(offset, offset + row.dataSymbols);
    if (msg.length !== row.dataSymbols) throw new Error('블록 메시지 길이');
    offset += row.dataSymbols;
    const word = rsEncode(msg, row.nsym);
    if (word.length !== row.symbolCount) throw new Error('블록 코드워드 길이');
    parts.push(word);
  }
  if (offset !== messageSymbols.length) throw new Error('메시지 심볼이 남거나 모자랐어요');
  return concatBytes(parts);
}

function maskDigits(raw, scan, mask) {
  const out = new Uint8Array(raw.length);
  for (let k = 0; k < raw.length; k += 1) {
    const { i, j } = scan[k];
    out[k] = mod6(raw[k] + hMaskValue(mask, i, j));
  }
  return out;
}

function adjacencyCost(faces) {
  let cost = 0;
  for (const levels of Object.values(faces)) {
    const n = Math.round(Math.sqrt(levels.length));
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const v = levels[i * n + j];
        if (j + 1 < n && levels[i * n + j + 1] === v) cost += 1;
        if (i + 1 < n && levels[(i + 1) * n + j] === v) cost += 1;
      }
    }
  }
  return cost;
}

const H_LEVEL_LUMA=Object.freeze([0,.5,1,0,1,.5]);
function normalizedMaskLuminance(luminance=H_LEVEL_LUMA) {
  if (!Array.isArray(luminance) || luminance.length !== 6 || !luminance.every(Number.isFinite)) {
    throw new TypeError('maskLuminance 는 여섯 유한 휘도값이어야 해요');
  }
  return luminance;
}
const moments=values=>{
  const mean=values.reduce((sum,value)=>sum+value,0)/values.length;
  return {mean,variance:values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length};
};
/** 실제 출력의 모든 코드면·예약 셀을 포함한 상대 휘도 균일성 진단이에요. */
export function hMaskBalance(faces,luminance=H_LEVEL_LUMA) {
  if(!faces||typeof faces!=='object'||!Object.keys(faces).length)throw new TypeError('H face levels required');
  const luma=normalizedMaskLuminance(luminance);
  const faceMeans=[],quadrantMeans=[];
  for(const [face,levels] of Object.entries(faces)){
    if(!(levels instanceof Uint8Array)||!Number.isInteger(Math.sqrt(levels.length)))throw new TypeError('H face levels required');
    const n=Math.sqrt(levels.length),values=Array.from(levels,value=>luma[value]);
    if(values.some(value=>value===undefined))throw new RangeError('H level');
    faceMeans.push({face,mean:moments(values).mean});
    const quadrants=[[],[],[],[]];
    for(let i=0;i<n;i++)for(let j=0;j<n;j++)quadrants[(i>=n/2?2:0)+(j>=n/2?1:0)].push(luma[levels[i*n+j]]);
    quadrantMeans.push(...quadrants.map(values=>moments(values).mean));
  }
  const face= moments(faceMeans.map(row=>row.mean)),quadrant=moments(quadrantMeans);
  return Object.freeze({faceMeans:Object.freeze(faceMeans.map(Object.freeze)),mean:face.mean,
    spread:Math.max(...faceMeans.map(row=>row.mean))-Math.min(...faceMeans.map(row=>row.mean)),variance:face.variance,
    quadrantMeans:Object.freeze(quadrantMeans),quadrantSpread:Math.max(...quadrantMeans)-Math.min(...quadrantMeans),quadrantVariance:quadrant.variance});
}
function compareMaskCandidate(a,b) {
  for(const key of ['spread','variance','quadrantSpread','quadrantVariance','adjacencyCost','mask']) {
    if(a[key]!==b[key])return a[key]-b[key];
  }
  return 0;
}

function copyFaces(faces) {
  const out = {};
  for (const key of Object.keys(faces)) out[key] = Uint8Array.from(faces[key]);
  return out;
}

function encodeResolved(bytes, profile) {
  if(!isLegacyHMode(profile.mode))return encodeGrouped(bytes,profile);
  const capacity = hCapacity(profile.version, profile.mode, {
    tones: profile.tones, ecc: profile.ecc, mask: profile.mask,finder:profile.finder,
  });
  if (bytes.length > capacity.maxPayloadBytes) {
    throw new RangeError(`용량 초과: ${bytes.length} B > ${capacity.maxPayloadBytes} B`);
  }
  if (bytes.length > 0xffff) throw new RangeError('용량 초과: length u16');
  const triadCount = profile.mode / 3;
  const padded = new Uint8Array(capacity.chunkBytes * triadCount);
  padded.set(bytes);
  const crc = crc32c(domainBytes(profile, capacity.chunkBytes, bytes.length, padded));
  const routeId = crc & 0xff;
  const layout = hLayout(profile.version,profile.finder);
  const triadDigits = [];
  for (let t = 0; t < triadCount; t += 1) {
    const packet = new Uint8Array(capacity.dataBytes);
    writeU16(packet, 0, bytes.length);
    writeU32(packet, 2, crc);
    packet.set(padded.subarray(t * capacity.chunkBytes, (t + 1) * capacity.chunkBytes), 6);
    const codeword = encodeBlocks(bytesToSymbols(packet), capacity);
    const raw = unpackSymbolsToCellDigits(codeword);
    if (raw.length !== layout.scan.length) throw new Error('digit 수와 scan 이 달라요');
    triadDigits.push(maskDigits(raw, layout.scan, profile.mask));
  }
  const faces = makeFaces({
    version: profile.version,
    mode: profile.mode,
    tones: profile.tones,
    ecc: profile.ecc,
    mask: profile.mask,
    finder:profile.finder,
    routeId,
    triadDigits,
  });
  return {
    type: 'H',
    version: profile.version,
    n: profile.n,
    mode: profile.mode,
    tones: profile.tones,
    ecc: profile.ecc,
    eccLevel: profile.ecc,
    mask: profile.mask,
    finder:profile.finder,
    routeId,
    crc,
    capacity,
    faces: copyFaces(faces),
    triadDigits: triadDigits.map((row) => Uint8Array.from(row)),
  };
}

function resolveEncodeProfile(options, byteLength) {
  assertKnownKeys(options, ENCODE_KEYS);
  const ecc = resolveEcc(options);
  const mode = options.mode ?? 3;
  const tones = options.tones ?? 3;
  const finder=options.finder??'frame';
  const maskLuminance=options.maskLuminance===undefined?undefined:normalizedMaskLuminance(options.maskLuminance);
  if(!['frame','corners','auto'].includes(finder))throw new RangeError('finder 는 frame|corners|auto');
  let version = options.version ?? 'auto';
  let mask = options.mask ?? 'auto';
  if (version !== 'auto') {
    if (!Number.isInteger(version) || version < 0 || version > 8) {
      throw new RangeError(`version 은 0..8 또는 auto: ${version}`);
    }
  }
  if (mask !== 'auto') {
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
      throw new RangeError(`mask 는 0..7 또는 auto: ${mask}`);
    }
  }
  if (![1,2,3,4,5,6].includes(mode) || ![2, 3].includes(tones)) {
    throw new RangeError('mode 는 1|2|3|4|5|6, tones 는 2|3');
  }
  if (version === 'auto') {
    let chosen = null;
    for (let v = 0; v <= 8; v += 1) {
      if(finder==='corners'&&v<5)continue;
      let cap;try { cap=hCapacity(v,mode,{tones,ecc,mask:0,finder}); } catch { continue; }
      if (byteLength <= cap.maxPayloadBytes) {
        chosen = v;
        break;
      }
    }
    if (chosen === null) throw new RangeError(`용량 초과: ${byteLength} B`);
    version = chosen;
  }
  return { version, mode, tones, ecc, mask,maskLuminance,finder:resolveHFinder(version,mode,finder) };
}

/**
 * @param {string|Uint8Array} input
 * @param {object} [options]
 */
export function encodeH(input, options = {}) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array
      ? input
      : (() => { throw new TypeError('input 은 string 또는 Uint8Array 여야 해요'); })();
  const resolved = resolveEncodeProfile(options, bytes.length);
  if (resolved.mask !== 'auto') {
    return encodeResolved(bytes, normalizeHProfile({
      version: resolved.version,
      mode: resolved.mode,
      tones: resolved.tones,
      ecc: resolved.ecc,
      mask: resolved.mask,
      finder:resolved.finder,
    }));
  }
  let best = null;
  let bestScore = null;
  for (let mask = 0; mask <= 7; mask += 1) {
    const encoded = encodeResolved(bytes, normalizeHProfile({
      version: resolved.version,
      mode: resolved.mode,
      tones: resolved.tones,
      ecc: resolved.ecc,
      mask,
      finder:resolved.finder,
    }));
    const balance=hMaskBalance(encoded.faces,resolved.maskLuminance);
    const score={mask,...balance,adjacencyCost:adjacencyCost(encoded.faces)};
    if (!bestScore || compareMaskCandidate(score,bestScore)<0) {
      best = encoded;
      bestScore = score;
    }
  }
  return {...best,maskDiagnostics:Object.freeze(bestScore)};
}

function fail(reason) {
  return { ok: false, reason };
}

function binaryDigit(a, b, c) {
  if (a === 0 && b === 0 && c === 0) return null;
  if (a === 1 && b === 1 && c === 1) return null;
  const found = BINARY_DIGIT.get(`${a},${b},${c}`);
  return found === undefined ? null : found;
}

function triadDigit(levels, tones) {
  if (levels.some((v) => v === 255)) return null;
  if (tones === 2) return binaryDigit(levels[0], levels[1], levels[2]);
  if (levels.some((v) => !Number.isInteger(v) || v < 0 || v > 2)) return null;
  if (new Set(levels).size !== 3) return null;
  try {
    return ranksToDigit({ T: levels[0], L: levels[1], R: levels[2] });
  } catch {
    return null;
  }
}

function decodeOneTriad(faces, triadIndex, profile, layout, capacity) {
  const ids = H_FACE_IDS.slice(triadIndex * 3, triadIndex * 3 + 3);
  const digits = new Uint8Array(layout.scan.length);
  const erased = [];
  for (let k = 0; k < layout.scan.length; k += 1) {
    const { i, j } = layout.scan[k];
    const at = i * profile.n + j;
    const observed = triadDigit(
      [faces[ids[0]][at], faces[ids[1]][at], faces[ids[2]][at]],
      profile.tones,
    );
    if (observed === null) {
      digits[k] = 0;
      const s = Math.floor(k / 3);
      if (erased.length === 0 || erased[erased.length - 1] !== s) erased.push(s);
    } else {
      digits[k] = mod6(observed - hMaskValue(profile.mask, i, j));
    }
  }
  const packed = packCellDigitsToSymbols(digits);
  const received = packed.symbols;
  if (received.length !== capacity.symbolCount) return { ok: false, reason: 'symbol-count' };
  const erasedSet = new Set(erased);
  for (const index of packed.illegalIndices) erasedSet.add(index);
  for (const index of erasedSet) received[index]=0;
  let offset = 0;
  const messages = [];
  let corrected = 0;
  for (const row of capacity.blocks) {
    const word = received.subarray(offset, offset + row.symbolCount);
    const local = [];
    for (const g of erasedSet) {
      if (g >= offset && g < offset + row.symbolCount) local.push(g - offset);
    }
    const decoded = rsDecode(word, row.nsym, { erasures: local });
    if (!decoded.ok) return { ok: false, reason: decoded.reason || 'rs-failed' };
    const positions = decoded.correctedPositions || decoded.errorPositions || [];
    corrected += positions.length;
    messages.push(decoded.message);
    offset += row.symbolCount;
  }
  if (offset !== received.length) return { ok: false, reason: 'block-remainder' };
  const message = concatBytes(messages);
  let packet;
  try {
    packet = symbolsToBytes(message, capacity.dataBytes);
  } catch {
    return { ok: false, reason: 'symbols-to-bytes' };
  }
  return { ok: true, packet, corrected };
}

/**
 * @param {Record<string, Uint8Array>} faces
 * @param {object} profile
 */
export function decodeH(faces, profile) {
  if (!profile || typeof profile !== 'object') return fail('profile');
  if(['version','mode','tones','mask','routeId'].some(k=>!Object.prototype.hasOwnProperty.call(profile,k))
    || (!Object.prototype.hasOwnProperty.call(profile,'ecc')&&!Object.prototype.hasOwnProperty.call(profile,'eccLevel')))return fail('profile');
  let ecc;
  try {
    assertKnownKeys(profile, ['version', 'mode', 'tones', 'ecc', 'eccLevel', 'mask', 'routeId', 'n', 'face','finder']);
    ecc = resolveEcc(profile);
  } catch {
    return fail('profile');
  }
  let normalized;
  try {
    normalized = normalizeHProfile({
      version: profile.version,
      mode: profile.mode,
      tones: profile.tones,
      ecc,
      mask: profile.mask,
      finder:profile.finder??'frame',
    });
  } catch {
    return fail('profile');
  }
  const routeId = profile.routeId;
  if(profile.n!==undefined&&profile.n!==normalized.n)return fail('profile-n');
  if (!Number.isInteger(routeId) || routeId < 0 || routeId > 255) return fail('routeId');
  if (!faces || typeof faces !== 'object') return fail('faces');
  const keys = Object.keys(faces);
  const allowed = isLegacyHMode(normalized.mode)?H_FACE_IDS.slice(0,normalized.mode):hModeFaces(normalized.mode);
  if (keys.length !== normalized.mode) return fail('face-count');
  for (const key of keys) {
    if (!allowed.includes(key)) return fail('unknown-face');
  }
  for (const face of allowed) {
    const levels = faces[face];
    if (!(levels instanceof Uint8Array) || levels.length !== normalized.n * normalized.n) {
      return fail('face-type');
    }
    if (!validateHFace(levels, { ...normalized, face, routeId })) return fail('face-format');
  }
  let capacity;
  try {
    capacity = hCapacity(normalized.version, normalized.mode, {
      tones: normalized.tones, ecc: normalized.ecc, mask: normalized.mask,finder:normalized.finder,
    });
  } catch {
    return fail('capacity');
  }
  const layout = hLayout(normalized.version,normalized.finder);
  if(!isLegacyHMode(normalized.mode)) {
    const packets=[];let corrected=0,sharedLen=null,sharedCrc=null;
    for(const group of capacity.groups){const decoded=decodeGroupedPacket(faces,group,normalized,layout);if(!decoded.ok)return decoded;
      const len=readU16(decoded.packet,0),crc=readU32(decoded.packet,2);if(sharedLen===null){sharedLen=len;sharedCrc=crc;}else if(sharedLen!==len||sharedCrc!==crc)return fail('header-mismatch');
      packets.push(decoded.packet.subarray(6));corrected+=decoded.corrected;}
    const padded=concatBytes(packets);if(sharedLen>padded.length)return fail('len-range');
    for(let i=sharedLen;i<padded.length;i++)if(padded[i]!==0)return fail('padding');
    const crc=crc32c(groupDomainBytes(normalized,capacity.groups,sharedLen,padded));
    if(crc!==sharedCrc)return fail('crc');if((crc&255)!==routeId)return fail('route-crc8');
    const out=padded.slice(0,sharedLen);let text=null;try{text=new TextDecoder('utf-8',{fatal:true}).decode(out);}catch{}
    return {ok:true,bytes:out,text,crc,corrected};
  }
  const triadCount = normalized.mode / 3;
  const packets = [];
  let corrected = 0;
  for (let t = 0; t < triadCount; t += 1) {
    const decoded = decodeOneTriad(faces, t, normalized, layout, capacity);
    if (!decoded.ok) return fail(decoded.reason);
    packets.push(decoded.packet);
    corrected += decoded.corrected;
  }
  let sharedLen = null;
  let sharedCrc = null;
  const padded = new Uint8Array(capacity.chunkBytes * triadCount);
  for (let t = 0; t < triadCount; t += 1) {
    const packet = packets[t];
    if (packet.length !== capacity.dataBytes) return fail('packet-length');
    const len = readU16(packet, 0);
    const crc = readU32(packet, 2);
    if (sharedLen === null) {
      sharedLen = len;
      sharedCrc = crc;
    } else if (len !== sharedLen || crc !== sharedCrc) return fail('header-mismatch');
    if (len > capacity.maxPayloadBytes) return fail('len-range');
    padded.set(packet.subarray(6, 6 + capacity.chunkBytes), t * capacity.chunkBytes);
  }
  for (let i = sharedLen; i < padded.length; i += 1) {
    if (padded[i] !== 0) return fail('padding');
  }
  const crc = crc32c(domainBytes(normalized, capacity.chunkBytes, sharedLen, padded));
  if (crc !== sharedCrc) return fail('crc');
  if ((crc & 0xff) !== routeId) return fail('route-crc8');
  const out = padded.slice(0, sharedLen);
  let text = null;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(out);
  } catch {
    text = null;
  }
  return { ok: true, bytes: out, text, crc, corrected };
}

function faceId(face) { const id=H_FACE_IDS.indexOf(face); if(id<0)throw new RangeError('H face'); return id; }
function groupKind(faces, tones) { return faces.length===3?'triad':tones===2?'pair4':'pair6'; }
function groupDomainBytes(profile, groups, payloadLength, padded) {
  const schema=profile.mode===1?(profile.finder==='corners'?H_SCHEMA_SINGLE_CORNER:H_SCHEMA_SINGLE)
    :(profile.finder==='corners'?H_SCHEMA_FACES_CORNER:H_SCHEMA_FACES);
  const ident=new TextEncoder().encode(schema);
  // header: version,n,mode,tones,ecc,mask,groupCount. 각 group: kind,arity,chunkBytes-u16,face ids.
  const fields=new Uint8Array(7+groups.reduce((n,g)=>n+4+g.faces.length,0));
  fields.set([profile.version,profile.n,profile.mode,profile.tones,H_ECC.indexOf(profile.ecc),profile.mask,groups.length]);
  let at=7;
  for(const group of groups) {
    fields[at++]=group.kind==='triad'?3:group.kind==='pair4'?4:6;
    fields[at++]=group.faces.length;
    writeU16(fields,at,group.chunkBytes); at+=2;
    for(const face of group.faces)fields[at++]=faceId(face);
  }
  const length=new Uint8Array(2); writeU16(length,0,payloadLength);
  return concatBytes([ident,fields,length,padded]);
}

function packetCapacity(symbolCount, ecc) {
  const lengths=splitBlockLengths(symbolCount),step=ecc==='M'?2:1;
  const blocks=lengths.map(symbolCount=>({symbolCount,nsym:nsymFor(symbolCount,ecc),dataSymbols:0}));
  for(let guard=0;guard<=MAX_BLOCK;guard++) {
    for(const row of blocks)row.dataSymbols=row.symbolCount-row.nsym;
    if(blocks.some(row=>row.dataSymbols<1))throw new RangeError('지원하지 않는 profile: 블록 패리티');
    const dataSymbols=blocks.reduce((sum,row)=>sum+row.dataSymbols,0),dataBytes=exactPacketBytes(dataSymbols);
    if(dataBytes>=7)return {symbolCount,blocks:blocks.map(row=>({...row})),dataSymbols,dataBytes,chunkBytes:dataBytes-6};
    blocks[0].nsym+=step;
  }
  throw new RangeError('지원하지 않는 profile: packet 길이');
}
function hGroupCapacity(profile, layout) {
  const single=profile.mode===1,cellCount=single?Math.floor(layout.scan.length/2):layout.scan.length;
  const groups=(single?[['XM','XM']]:hModeGroups(profile.mode)).map(faces=>{
    const kind=groupKind(faces,profile.tones),cellsPerSymbol=kind==='pair4'?4:3;
    const symbolCount=Math.floor(cellCount/cellsPerSymbol),packet=packetCapacity(symbolCount,profile.ecc);
    return {faces,kind,radix:kind==='pair4'?4:6,cellsPerSymbol,usedCells:symbolCount*cellsPerSymbol,
      residualCells:cellCount-symbolCount*cellsPerSymbol,...(single?{scanOffsets:[0,cellCount]}:{}),...packet};
  });
  return {version:profile.version,n:profile.n,mode:profile.mode,tones:profile.tones,ecc:profile.ecc,eccLevel:profile.ecc,
    mask:profile.mask,finder:profile.finder,cellCount:layout.scan.length,groups,
    maxPayloadBytes:groups.reduce((sum,group)=>sum+group.chunkBytes,0)};
}

function radix4Digits(symbols, group, scan, mask) {
  const out=new Uint8Array(scan.length);
  for(let s=0;s<symbols.length;s++)for(let q=0;q<4;q++) {
    const k=s*4+q,{i,j}=scan[k],digit=(symbols[s]>>>((3-q)*2))&3;
    out[k]=modRadix(digit+hMaskValue(mask,i,j),4);
  }
  return out;
}
function groupDigits(codeword, group, scan, mask) {
  if(group.kind==='pair4')return radix4Digits(codeword,group,scan,mask);
  return maskDigits(unpackSymbolsToCellDigits(codeword),scan,mask);
}
function encodeGrouped(bytes, profile) {
  const capacity=hCapacity(profile.version,profile.mode,{tones:profile.tones,ecc:profile.ecc,mask:profile.mask,finder:profile.finder});
  if(bytes.length>capacity.maxPayloadBytes||bytes.length>0xffff)throw new RangeError(`용량 초과: ${bytes.length} B > ${capacity.maxPayloadBytes} B`);
  const padded=new Uint8Array(capacity.maxPayloadBytes);padded.set(bytes);
  const crc=crc32c(groupDomainBytes(profile,capacity.groups,bytes.length,padded)),routeId=crc&255,layout=hLayout(profile.version,profile.finder);
  let offset=0;const groupDigitsRows=[];
  for(const group of capacity.groups) {
    const packet=new Uint8Array(group.dataBytes);writeU16(packet,0,bytes.length);writeU32(packet,2,crc);
    packet.set(padded.subarray(offset,offset+group.chunkBytes),6);offset+=group.chunkBytes;
    const scan=profile.mode===1?layout.scan.slice(0,Math.floor(layout.scan.length/2)):layout.scan;
    const codeword=encodeBlocks(bytesToSymbols(packet),group);
    if(profile.mode===1){
      const row=new Uint8Array(scan.length);
      row.set(groupDigits(codeword,group,scan.slice(0,group.usedCells),profile.mask));
      groupDigitsRows.push(row);
    }else groupDigitsRows.push(groupDigits(codeword,group,scan,profile.mask));
  }
  const faces=makeFaces({...profile,routeId,groupDigits:groupDigitsRows});
  return {type:'H',version:profile.version,n:profile.n,mode:profile.mode,tones:profile.tones,ecc:profile.ecc,eccLevel:profile.ecc,
    mask:profile.mask,finder:profile.finder,routeId,crc,capacity,faces:copyFaces(faces),groupDigits:groupDigitsRows.map(row=>Uint8Array.from(row))};
}

function pairDigit(levels, tones) {
  if(levels.some(value=>value===255))return null;
  if(tones===2)return levels.every(value=>value===0||value===1)?((levels[0]<<1)|levels[1]):null;
  const [T,L]=levels,R=3-T-L;
  if(!Number.isInteger(T)||!Number.isInteger(L)||T<0||T>2||L<0||L>2||R<0||R>2||new Set([T,L,R]).size!==3)return null;
  try{return ranksToDigit({T,L,R});}catch{return null;}
}
function decodeGroupedPacket(faces, group, profile, layout) {
  const digits=new Uint8Array(group.usedCells),erased=new Set();
  const single=profile.mode===1,half=Math.floor(layout.scan.length/2);
  if(single){
    for(let k=0;k<layout.scan.length;k++){
      const used=k<group.usedCells||(k>=half&&k<half+group.usedCells);
      const {i,j}=layout.scan[k];if(!used&&faces.XM[i*profile.n+j]!==0)return fail('pair-padding');
    }
  }
  for(let k=0;k<group.usedCells;k++) {
    const {i,j}=layout.scan[k],at=i*profile.n+j,levels=single
      ?[faces.XM[at],faces.XM[layout.scan[k+half].i*profile.n+layout.scan[k+half].j]]
      :group.faces.map(face=>faces[face][at]);
    const digit=group.kind==='triad'?triadDigit(levels,profile.tones):pairDigit(levels,profile.tones);
    if(digit===null)erased.add(Math.floor(k/group.cellsPerSymbol));else digits[k]=modRadix(digit-hMaskValue(profile.mask,i,j),group.radix);
  }
  if(!single&&group.kind==='pair4')for(let k=group.usedCells;k<layout.scan.length;k++) { const {i,j}=layout.scan[k],at=i*profile.n+j;if(group.faces.some(face=>faces[face][at]!==0))return fail('pair-padding'); }
  const received=new Uint8Array(group.symbolCount);
  if(group.kind==='pair4')for(let s=0;s<received.length;s++){const value=digits[s*4]*64+digits[s*4+1]*16+digits[s*4+2]*4+digits[s*4+3];if(value>210)erased.add(s);else received[s]=value;}
  else {const packed=packCellDigitsToSymbols(digits);received.set(packed.symbols);for(const index of packed.illegalIndices)erased.add(index);}
  for(const index of erased)received[index]=0;
  let offset=0,corrected=0;const messages=[];
  for(const row of group.blocks){const local=[...erased].filter(index=>index>=offset&&index<offset+row.symbolCount).map(index=>index-offset);
    const decoded=rsDecode(received.subarray(offset,offset+row.symbolCount),row.nsym,{erasures:local});
    if(!decoded.ok)return fail(decoded.reason||'rs-failed');
    corrected+=(decoded.correctedPositions??decoded.errorPositions??[]).length;messages.push(decoded.message);offset+=row.symbolCount;}
  try{return {ok:true,packet:symbolsToBytes(concatBytes(messages),group.dataBytes),corrected};}catch{return fail('symbols-to-bytes');}
}
