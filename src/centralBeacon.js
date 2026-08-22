/**
 * centralBeacon.js — O/G 중앙 슬롯에 심는 Type Y v0 자기기술 비컨.
 *
 * 바깥 코드의 페이로드는 싣지 않는다. 스키마·계열·바깥 포맷 워드·파인더 정체·
 * 마커 플래그만 20 B 안에 넣고, 인코딩은 `encodeY` 를 그대로 부른다.
 *
 * 인덱스는 손 목록이 아니다. 계열 글자는 OAK 라인업·markerG 표·셀 표면 활성 id 에서,
 * 파인더 id 는 finder-selection + FINDER_PATTERNS + OAK + daehan 표에서,
 * ECC·포맷 워드는 formatinfo 정본에서 유도한다.
 *
 * ⚠ 이 모듈은 `src/beacon.js`(사용 이벤트 전송) 와 다른 축이다. 이름을 합치지 않는다.
 */

import { encodeY } from './encodeY.js';
import {
  DIGIT_COUNT, ECC_LEVEL,
} from './formatinfo.js';
import {
  CENTER_QR_FINDER_PATTERN_ID, CENTRAL_V0_FINDER_PATTERN_ID,
} from './finder-selection.js';
import {
  FINDER_PATTERNS, LEGACY_FINDER_PATTERN_ID,
} from './finder-patterns.js';
import { OAK_LINEUP } from './finder-oak-lineup.js';
import { OAK_FINDER_PATTERNS } from './finder-oak-patterns.js';
import { DAEHAN_FINDER_PATTERN_IDS } from './finder-daehan.js';
import { MARKER_G_FORMAT_INDEX } from './markerG.js';
import {
  CELL_SURFACE_FINAL_ACTIVE_IDS,
  CELL_SURFACE_FINAL_V0,
  CENTRAL_V0_SOURCE_N,
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  versionForFinalN,
} from './cellSurfaceFinal.js';
import { DIGITS_PER_SYMBOL, packCellDigitsToSymbols, symbolsToBytes } from './base211.js';
import { rsDecode } from './rs211.js';
import { maskSub } from './mask.js';
import { unframe } from './header.js';

/**
 * **「나는 페이로드가 아니다」 구분자** (계약서 `central-v0-beacon.md` §4.1).
 *
 * 중앙 비컨은 **문법적으로 완전한 Type Y v0 코드**다. 그래서 스캐너가 중앙 블록만
 * 잡으면 그것을 독립 코드로 복호해 **성공하고**, 사용자에게 메타데이터 바이트를
 * 「내용」으로 보여준다 — 바깥 URL 대신 쓰레기가 뜬다. 실패가 조용한 종류다.
 *
 * 왜 제어문자인가 — 이 페이로드 경로는 `packBeaconText` 가 `String.fromCharCode` 로
 * 만들고 `unpackBeaconText` 가 **ASCII 7bit 밖을 거부**한다. 그래서 「UTF-8 선두로
 * 불가능한 바이트(0xF5\~0xFF)」 같은 **구조적** 보장은 쓸 수 없다. 대신 생성기의
 * 페이로드 경로(URL · 텍스트 · Wi-Fi · vCard)가 만들어 낼 수 없는 제어문자를 쓴다.
 *
 * 매직만 믿지 않는다 — `unpackBeaconBytes` 의 복합 검사(길이 == 순 페이로드 ·
 * 예약 바이트 전부 0 · 계열/파인더 인덱스 유효 · 포맷 digit < 6)가 2차 방어다.
 * 매직 2바이트는 그 앞에 두는 **싼 1차 관문**이고, 20 B 예산에서 2 B 는 예약분으로 낸다.
 */
export const BEACON_MAGIC = Object.freeze([0x01, 0x0f]); // SOH · SI

/** 이 계약의 스키마. 자리가 남아 있어야 진화할 수 있다. */
export const BEACON_SCHEMA_VERSION = 0;

/**
 * 비컨 데이터 톤. encodeY 기본값(ADR 0003 v3.1 §4b, 2톤 메인)과 같다 —
 * 새 상수가 아니라 그 기본값을 여기에 고정한 것이다.
 */
export const BEACON_TONES = 2;

/** 마커 구성 플래그 비트 자리 — encoded 필드 이름 순서. 값을 손으로 매지 않는다. */
export const BEACON_FLAG_NAMES = Object.freeze([
  'cornerMarker', 'markerTones', 'daehanFinder',
]);

function beaconEccLevel() {
  for (const [name, value] of Object.entries(ECC_LEVEL)) {
    if (name === 'RESERVED') continue;
    if (value === ECC_LEVEL.H) return name;
  }
  throw new Error('ECC_LEVEL 표에 H 가 없다');
}

/** 비컨 ECC — formatinfo.ECC_LEVEL 의 H 키. */
export const BEACON_ECC_LEVEL = beaconEccLevel();

const BEACON_CAPACITY = capacityForCellSurfaceFinal(
  CENTRAL_V0_SOURCE_N, BEACON_ECC_LEVEL, BEACON_TONES, CELL_SURFACE_FINAL_V0,
);

/** v0 · ECC H 의 순 페이로드. capacity 생성원이 정한다 — 20 을 손으로 적지 않는다. */
export const BEACON_PAYLOAD_BYTES = BEACON_CAPACITY.maxPayloadBytes;

const OFF_MAGIC = 0;
const OFF_SCHEMA = OFF_MAGIC + BEACON_MAGIC.length;
const OFF_FAMILY = OFF_SCHEMA + 1;
const OFF_FORMAT = OFF_FAMILY + 1;
const OFF_FINDER = OFF_FORMAT + DIGIT_COUNT;
const OFF_FLAGS = OFF_FINDER + 1;
const OFF_RESERVED = OFF_FLAGS + 1;

/** 스키마 0 이 실제로 쓰는 앞자리. 나머지는 예약 0. */
export const BEACON_USED_BYTES = OFF_RESERVED;
export const BEACON_RESERVED_BYTES = BEACON_PAYLOAD_BYTES - BEACON_USED_BYTES;

if (BEACON_USED_BYTES > BEACON_PAYLOAD_BYTES) {
  throw new Error(
    `비컨 페이로드가 v0/${BEACON_ECC_LEVEL} 용량에 안 들어간다: 사용 ${BEACON_USED_BYTES} B > 순 페이로드 ${BEACON_PAYLOAD_BYTES} B`,
  );
}

function addUnique(list, seen, id) {
  if (typeof id !== 'string' || id === '' || seen.has(id)) return;
  seen.add(id);
  list.push(id);
}

/**
 * 계열 알파벳. O/A/K 는 OAK_LINEUP.type, G 는 markerG 표가 비어 있지 않을 때,
 * Y 는 셀 표면 활성 레이아웃이 있을 때. 정렬은 코드포인트 순.
 */
export function familyAlphabet() {
  const letters = new Set();
  for (const row of OAK_LINEUP) letters.add(row.type);
  if (MARKER_G_FORMAT_INDEX.length > 0) letters.add('G');
  if (CELL_SURFACE_FINAL_ACTIVE_IDS.length > 0) letters.add('Y');
  return Object.freeze([...letters].sort());
}

/**
 * 파인더 id 표. finder-selection 의 슬롯 id 를 앞에 두고, 렌더 표·OAK·daehan 을
 * 선언 순으로 잇는다. 손 enum 이 아니다.
 */
export function finderIdentityIds() {
  const ids = [];
  const seen = new Set();
  addUnique(ids, seen, LEGACY_FINDER_PATTERN_ID);
  addUnique(ids, seen, CENTER_QR_FINDER_PATTERN_ID);
  addUnique(ids, seen, CENTRAL_V0_FINDER_PATTERN_ID);
  for (const pattern of FINDER_PATTERNS) addUnique(ids, seen, pattern.id);
  for (const pattern of OAK_FINDER_PATTERNS) addUnique(ids, seen, pattern.id);
  for (const id of DAEHAN_FINDER_PATTERN_IDS) addUnique(ids, seen, id);
  return Object.freeze(ids);
}

const FAMILY_ALPHABET = familyAlphabet();
const FINDER_IDS = finderIdentityIds();

export function familyIndex(family) {
  const index = FAMILY_ALPHABET.indexOf(family);
  if (index < 0) {
    throw new RangeError('알 수 없는 코드 계열: ' + family);
  }
  return index;
}

export function familyFromIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= FAMILY_ALPHABET.length) {
    throw new RangeError('계열 인덱스가 알파벳 밖이다: ' + index);
  }
  return FAMILY_ALPHABET[index];
}

export function finderIndex(finderPatternId) {
  const index = FINDER_IDS.indexOf(finderPatternId);
  if (index < 0) {
    throw new RangeError('알 수 없는 파인더 id: ' + finderPatternId);
  }
  return index;
}

export function finderIdFromIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= FINDER_IDS.length) {
    throw new RangeError('파인더 인덱스가 표 밖이다: ' + index);
  }
  return FINDER_IDS[index];
}

export function familyLetterFromEncoded(encoded) {
  if (encoded.cellSurfaceLayout
    || (Number.isInteger(encoded.n) && !Number.isInteger(encoded.k))) {
    return 'Y';
  }
  if (encoded.cornerMarker) return 'G';
  if (Object.prototype.hasOwnProperty.call(encoded, 'turnA')) return 'A';
  return 'O';
}

export function packBeaconFlags(meta) {
  let flags = 0;
  for (let i = 0; i < BEACON_FLAG_NAMES.length; i += 1) {
    if (meta[BEACON_FLAG_NAMES[i]]) flags |= 1 << i;
  }
  return flags;
}

export function unpackBeaconFlags(flags) {
  if (!Number.isInteger(flags) || flags < 0 || flags > 0x7f) {
    throw new RangeError('비컨 플래그가 7bit 밖이다: ' + flags);
  }
  const out = {};
  for (let i = 0; i < BEACON_FLAG_NAMES.length; i += 1) {
    out[BEACON_FLAG_NAMES[i]] = (flags & (1 << i)) !== 0;
  }
  return out;
}

export function beaconMetaFromEncoded(encoded, finderPatternId) {
  if (encoded === null || typeof encoded !== 'object') {
    throw new TypeError('encoded 는 객체여야 한다');
  }
  if (!Array.isArray(encoded.formatDigits)
    || encoded.formatDigits.length < DIGIT_COUNT) {
    throw new TypeError('encoded.formatDigits 가 포맷 워드 길이보다 짧다');
  }
  return {
    schemaVersion: BEACON_SCHEMA_VERSION,
    family: familyLetterFromEncoded(encoded),
    formatDigits: encoded.formatDigits.slice(0, DIGIT_COUNT),
    finderPatternId,
    cornerMarker: Boolean(encoded.cornerMarker),
    markerTones: Boolean(encoded.markerTones),
    daehanFinder: Boolean(encoded.daehanFinder),
  };
}

function assertFormatDigit(digit, i) {
  if (!Number.isInteger(digit) || digit < 0 || digit >= 6) {
    throw new RangeError('포맷 digit[' + i + '] 범위 위반: ' + digit);
  }
}

export function packBeaconBytes(meta) {
  const bytes = new Uint8Array(BEACON_PAYLOAD_BYTES);
  bytes.set(BEACON_MAGIC, OFF_MAGIC);
  bytes[OFF_SCHEMA] = BEACON_SCHEMA_VERSION;
  bytes[OFF_FAMILY] = familyIndex(meta.family);
  const formatDigits = meta.formatDigits;
  if (!Array.isArray(formatDigits) && !(formatDigits instanceof Uint8Array)) {
    throw new TypeError('formatDigits 는 배열이어야 한다');
  }
  if (formatDigits.length < DIGIT_COUNT) {
    throw new RangeError(
      '포맷 워드 길이가 DIGIT_COUNT 보다 짧다: ' + formatDigits.length,
    );
  }
  for (let i = 0; i < DIGIT_COUNT; i += 1) {
    assertFormatDigit(formatDigits[i], i);
    bytes[OFF_FORMAT + i] = formatDigits[i];
  }
  bytes[OFF_FINDER] = finderIndex(meta.finderPatternId);
  bytes[OFF_FLAGS] = packBeaconFlags(meta);
  return bytes;
}

export function packBeaconText(meta) {
  return String.fromCharCode(...packBeaconBytes(meta));
}

export function unpackBeaconBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('비컨 바이트는 Uint8Array 여야 한다');
  }
  if (bytes.length !== BEACON_PAYLOAD_BYTES) {
    throw new RangeError(
      '비컨 페이로드 길이가 ' + BEACON_PAYLOAD_BYTES + ' B 가 아니다: ' + bytes.length,
    );
  }
  // 매직 먼저. 이걸 통과 못 하면 «비컨이 아니라 독립 코드» 이고, 호출자는 그
  // 페이로드를 사용자에게 보여줘야 한다 — 스키마 검사보다 앞이어야 하는 이유다.
  for (let i = 0; i < BEACON_MAGIC.length; i += 1) {
    if (bytes[OFF_MAGIC + i] !== BEACON_MAGIC[i]) {
      throw new RangeError('비컨 매직이 아니다 — 독립 Type Y v0 코드로 읽어야 한다');
    }
  }
  const schemaVersion = bytes[OFF_SCHEMA];
  if (schemaVersion !== BEACON_SCHEMA_VERSION) {
    throw new RangeError('비컨 스키마 버전이 아니다: ' + schemaVersion);
  }
  for (let i = OFF_RESERVED; i < bytes.length; i += 1) {
    if (bytes[i] !== 0) {
      throw new RangeError('비컨 스키마 0 예약 바이트가 0 이 아니다');
    }
  }
  const formatDigits = [];
  for (let i = 0; i < DIGIT_COUNT; i += 1) {
    assertFormatDigit(bytes[OFF_FORMAT + i], i);
    formatDigits.push(bytes[OFF_FORMAT + i]);
  }
  return {
    schemaVersion,
    family: familyFromIndex(bytes[OFF_FAMILY]),
    formatDigits,
    finderPatternId: finderIdFromIndex(bytes[OFF_FINDER]),
    ...unpackBeaconFlags(bytes[OFF_FLAGS]),
  };
}

export function unpackBeaconText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('비컨 텍스트는 문자열이어야 한다: ' + typeof text);
  }
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c > 0x7f) {
      throw new RangeError('비컨 페이로드가 ASCII 7bit 밖이다: ' + c);
    }
    bytes[i] = c;
  }
  return unpackBeaconBytes(bytes);
}

/**
 * 바깥 encode 결과 → 중앙 슬롯용 v0 인코딩. 새 인코더가 아니다.
 */
export function encodeCentralBeacon(encoded, finderPatternId) {
  const meta = beaconMetaFromEncoded(encoded, finderPatternId);
  const text = packBeaconText(meta);
  return encodeY(text, {
    version: versionForFinalN(CENTRAL_V0_SOURCE_N),
    eccLevel: BEACON_ECC_LEVEL,
    tones: BEACON_TONES,
    cellSurfaceLayout: CELL_SURFACE_FINAL_V0,
  });
}

function cellKey(i, j) {
  return i + ',' + j;
}

/**
 * encodeY 가 준 cellDigits 에서 비컨 페이로드를 되읽는다.
 * 검출기가 아니라 인코더 산출물의 역파이프라인이다.
 */
export function readBeaconFromEncodedY(encodedY) {
  if (encodedY === null || typeof encodedY !== 'object') {
    throw new TypeError('encodedY 는 객체여야 한다');
  }
  const { cellDigits, n, cellSurfaceLayout, maskIndex, capacity } = encodedY;
  if (!(cellDigits instanceof Map)) {
    throw new TypeError('encodedY.cellDigits 는 Map 이어야 한다');
  }
  const scan = dataCellsInScanOrderCellSurfaceFinal(n, cellSurfaceLayout);
  const dataLen = capacity.usedSymbols * DIGITS_PER_SYMBOL;
  // 모양이 다른 Type Y 코드(다른 n·다른 레이아웃)가 들어오면 아래 scan[i] 가
  // undefined 를 집어 «Cannot read properties of undefined» 로 죽는다. 그건 진단이
  // 아니라 사고다 — 호출자가 알아야 하는 것은 「이건 비컨이 아니다」 하나다.
  if (scan.length < dataLen) {
    throw new RangeError(
      `비컨 형태가 아니다 — 데이터 셀 ${scan.length} < 필요 ${dataLen} (n=${n} · ${cellSurfaceLayout})`,
    );
  }
  const unmasked = new Uint8Array(dataLen);
  for (let i = 0; i < dataLen; i += 1) {
    const c = scan[i];
    const entry = cellDigits.get(cellKey(c.i, c.j));
    if (!entry || !Number.isInteger(entry.digit)) {
      throw new RangeError('비컨 데이터 셀이 없다: ' + cellKey(c.i, c.j));
    }
    unmasked[i] = maskSub(entry.digit, c.i, c.j, maskIndex);
  }
  const packed = packCellDigitsToSymbols(unmasked);
  const rs = rsDecode(packed.symbols, capacity.nsym);
  if (!rs.ok) {
    throw new Error('비컨 RS 복호 실패: ' + rs.reason);
  }
  const framed = symbolsToBytes(rs.message, capacity.dataBytes);
  return unpackBeaconText(unframe(framed).text);
}
