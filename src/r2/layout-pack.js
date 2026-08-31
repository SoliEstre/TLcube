/**
 * R2 레이아웃 팩 v1.
 *
 * 생성 경로는 기존 JS 좌표 정본을 읽어 고정폭 바이너리로 굽는다. 소비 경로는
 * 좌표 규칙을 다시 해석하지 않고 헤더의 고정 오프셋과 레코드 인덱스만 사용한다.
 * 런타임 의존성 0 · DOM/Node API 무의존 · 리틀엔디언.
 */

import { regionCells } from '../hexgrid.js';
import {
  VERSIONS,
} from '../capacity.js';
import {
  VERSIONS_DAEHAN,
} from '../capacityDaehan.js';
import {
  VERSIONS_A,
} from '../capacityA.js';
import {
  VERSIONS_K,
  VERSIONS_K_DAEHAN,
} from '../capacityK.js';
import {
  VERSIONS_C,
  VERSIONS_C_DAEHAN,
} from '../capacityC.js';
import {
  dataCellsInScanOrder,
} from '../layout.js';
import {
  dataCellsInScanOrderA,
} from '../layoutA.js';
import {
  dataCellsInScanOrderK,
} from '../layoutK.js';
import {
  anchorCells,
  formatCells,
} from '../placement.js';
import {
  regionCellsA,
  regionCellsTurnA,
  vertexAnchors,
} from '../placementA.js';
import {
  regionCellsK,
  vertexAnchorsK,
} from '../placementK.js';
import {
  VERSIONS_OCM,
  dataCellsInScanOrderOMarker,
  formatCellsOMarker,
} from '../markerO.js';
import {
  VERSIONS_OCM_DAEHAN,
  dataCellsInScanOrderOMarkerDaehan,
} from '../markerOdaehan.js';
import { daehanReservedCells } from '../finder-daehan.js';
import { typeCReservedCells } from '../notchC.js';

export const LAYOUT_PACK_FAMILY = Object.freeze({
  O: 1,
  A: 2,
  V: 3,
  K: 4,
  C: 5,
});

/**
 * 팩 키에 들어가는 것은 좌표를 바꾸는 비트뿐이다.
 *
 * - SAGOAE_RESERVED: 원자 daehan과 분해 사괘가 공유하는 불스아이 밖 예약 집합.
 * - CORNER_MARKER: Type G의 O 코너 tetrad 자리 예약.
 *
 * 중앙 불스아이/TL/QR은 같은 19셀 슬롯의 점유자 교체라 레이아웃 비트가 아니다.
 */
export const LAYOUT_PACK_FLAGS = Object.freeze({
  NONE: 0,
  SAGOAE_RESERVED: 1 << 0,
  CORNER_MARKER: 1 << 1,
});

const KNOWN_FLAGS = LAYOUT_PACK_FLAGS.SAGOAE_RESERVED | LAYOUT_PACK_FLAGS.CORNER_MARKER;

export const LAYOUT_PACK_SECTION = Object.freeze({
  SCAN_ORDER: 1,
  NON_DATA: 2,
  FORMAT_WALK: 3,
  ANCHORS: 4,
  CELL_LOOKUP: 5,
});

/** CELL_LOOKUP의 음수 sentinel. 0 이상의 값은 scan-order 인덱스다. */
export const LAYOUT_PACK_CELL = Object.freeze({
  OUTSIDE: -1,
  NON_DATA: -2,
});

const MAGIC = Object.freeze([0x54, 0x4c, 0x50, 0x4b]); // TLPK
const VERSION = 1;
const HEADER_BYTES = 96;
const DIRECTORY_OFFSET = 32;
const DIRECTORY_ENTRY_BYTES = 12;
const SECTION_COUNT = 5;
const COORDINATE_RECORD_BYTES = 4;
const ANCHOR_RECORD_BYTES = 6;
const LOOKUP_RECORD_BYTES = 4;

export const LAYOUT_PACK_FORMAT = Object.freeze({
  magic: 'TLPK',
  version: VERSION,
  endian: 'little',
  headerBytes: HEADER_BYTES,
  directoryOffset: DIRECTORY_OFFSET,
  directoryEntryBytes: DIRECTORY_ENTRY_BYTES,
  sectionCount: SECTION_COUNT,
  coordinateRecordBytes: COORDINATE_RECORD_BYTES,
  anchorRecordBytes: ANCHOR_RECORD_BYTES,
  lookupRecordBytes: LOOKUP_RECORD_BYTES,
});

function familyCode(family) {
  return LAYOUT_PACK_FAMILY[family];
}

function familyName(code) {
  switch (code) {
    case LAYOUT_PACK_FAMILY.O: return 'O';
    case LAYOUT_PACK_FAMILY.A: return 'A';
    case LAYOUT_PACK_FAMILY.V: return 'V';
    case LAYOUT_PACK_FAMILY.K: return 'K';
    case LAYOUT_PACK_FAMILY.C: return 'C';
    default: return undefined;
  }
}

function specKey(spec) {
  return `${spec.family}:${spec.k}:${spec.flags}`;
}

function freezeSpec(family, k, flags) {
  return Object.freeze({ family, k, flags });
}

function specsFrom(table, family, flags) {
  return table.map((entry) => freezeSpec(family, entry.k, flags));
}

/**
 * R2 정식 지원 중 좌표가 서로 다른 전 조합.
 * 중앙 점유자 변형은 같은 팩을 공유하므로 중복 행을 만들지 않는다.
 */
export const SUPPORTED_LAYOUT_PACK_SPECS = Object.freeze([
  ...specsFrom(VERSIONS, 'O', LAYOUT_PACK_FLAGS.NONE),
  ...specsFrom(VERSIONS_DAEHAN, 'O', LAYOUT_PACK_FLAGS.SAGOAE_RESERVED),
  ...specsFrom(VERSIONS_OCM, 'O', LAYOUT_PACK_FLAGS.CORNER_MARKER),
  ...specsFrom(
    VERSIONS_OCM_DAEHAN,
    'O',
    LAYOUT_PACK_FLAGS.SAGOAE_RESERVED | LAYOUT_PACK_FLAGS.CORNER_MARKER,
  ),
  ...specsFrom(VERSIONS_A, 'A', LAYOUT_PACK_FLAGS.NONE),
  ...specsFrom(VERSIONS_A, 'V', LAYOUT_PACK_FLAGS.NONE),
  ...specsFrom(VERSIONS_K, 'K', LAYOUT_PACK_FLAGS.NONE),
  ...specsFrom(VERSIONS_K_DAEHAN, 'K', LAYOUT_PACK_FLAGS.SAGOAE_RESERVED),
  ...specsFrom(VERSIONS_C, 'C', LAYOUT_PACK_FLAGS.NONE),
  ...specsFrom(VERSIONS_C_DAEHAN, 'C', LAYOUT_PACK_FLAGS.SAGOAE_RESERVED),
].sort((a, b) => familyCode(a.family) - familyCode(b.family)
  || a.k - b.k || a.flags - b.flags));

const SUPPORTED_SPEC_KEYS = new Set();
for (const spec of SUPPORTED_LAYOUT_PACK_SPECS) {
  const key = specKey(spec);
  if (SUPPORTED_SPEC_KEYS.has(key)) {
    throw new Error(`layout-pack 지원 조합이 중복됐다: ${key}`);
  }
  SUPPORTED_SPEC_KEYS.add(key);
}

export function layoutPackSpecKey(spec) {
  const normalized = normalizeSpec(spec);
  return specKey(normalized);
}

export function layoutPackFileName(spec) {
  const normalized = normalizeSpec(spec);
  return `${normalized.family.toLowerCase()}-k${String(normalized.k).padStart(2, '0')}`
    + `-f${normalized.flags.toString(16).padStart(4, '0')}.tlp`;
}

function normalizeSpec(spec) {
  if (spec === null || typeof spec !== 'object') {
    throw new TypeError('레이아웃 팩 spec은 {family,k,flags} 객체여야 한다');
  }
  const family = spec.family;
  const k = spec.k;
  const flags = spec.flags === undefined ? LAYOUT_PACK_FLAGS.NONE : spec.flags;
  if (familyCode(family) === undefined) {
    throw new RangeError(`지원하지 않는 레이아웃 family: ${String(family)}`);
  }
  if (!Number.isInteger(k) || k <= 0 || k > 0xffff) {
    throw new RangeError(`레이아웃 k는 1..65535 정수여야 한다: ${k}`);
  }
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffff) {
    throw new RangeError(`레이아웃 flags는 uint16이어야 한다: ${flags}`);
  }
  if ((flags & ~KNOWN_FLAGS) !== 0) {
    throw new RangeError(`알 수 없는 레이아웃 flags 비트: 0x${flags.toString(16)}`);
  }
  const normalized = freezeSpec(family, k, flags);
  if (!SUPPORTED_SPEC_KEYS.has(specKey(normalized))) {
    throw new RangeError(
      `지원하지 않는 레이아웃 조합: family=${family}, k=${k}, flags=0x${flags.toString(16)}`,
    );
  }
  return normalized;
}

function key(cell) {
  return `${cell.q},${cell.r}`;
}

function coordinateOnly(cell) {
  return { q: cell.q, r: cell.r };
}

function compareCoordinates(a, b) {
  return a.q - b.q || a.r - b.r;
}

function mapTurnA(k, lists) {
  const source = regionCellsA(k);
  const turned = regionCellsTurnA(k);
  if (source.length !== turned.length) {
    throw new Error(`V k=${k}: 정립/반전 영역 길이가 다르다`);
  }
  const bySource = new Map();
  for (let i = 0; i < source.length; i += 1) {
    bySource.set(key(source[i]), turned[i]);
  }
  const turnList = (cells) => cells.map((cell) => {
    const mapped = bySource.get(key(cell));
    if (!mapped) throw new Error(`V k=${k}: 반전 정본에 없는 좌표 ${key(cell)}`);
    return cell.digit === undefined
      ? { q: mapped.q, r: mapped.r }
      : { q: mapped.q, r: mapped.r, digit: cell.digit };
  });
  return {
    region: turned.map(coordinateOnly),
    scan: turnList(lists.scan),
    format: turnList(lists.format),
    anchors: turnList(lists.anchors),
  };
}

function canonicalLayout(spec) {
  const hasSagoae = (spec.flags & LAYOUT_PACK_FLAGS.SAGOAE_RESERVED) !== 0;
  const hasCornerMarker = (spec.flags & LAYOUT_PACK_FLAGS.CORNER_MARKER) !== 0;

  switch (spec.family) {
    case 'O': {
      const region = regionCells(spec.k).map(coordinateOnly);
      if (hasCornerMarker && hasSagoae) {
        return {
          region,
          scan: dataCellsInScanOrderOMarkerDaehan(spec.k),
          format: formatCellsOMarker(spec.k),
          anchors: anchorCells(spec.k, 'A'),
        };
      }
      if (hasCornerMarker) {
        return {
          region,
          scan: dataCellsInScanOrderOMarker(spec.k),
          format: formatCellsOMarker(spec.k),
          anchors: anchorCells(spec.k, 'A'),
        };
      }
      const reserved = hasSagoae ? daehanReservedCells(spec.k) : undefined;
      return {
        region,
        scan: dataCellsInScanOrder(spec.k, reserved),
        format: formatCells(spec.k),
        anchors: anchorCells(spec.k, 'A'),
      };
    }
    case 'A':
      return {
        region: regionCellsA(spec.k).map(coordinateOnly),
        scan: dataCellsInScanOrderA(spec.k),
        format: formatCells(spec.k),
        anchors: [...anchorCells(spec.k, 'A'), ...vertexAnchors(spec.k)],
      };
    case 'V':
      return mapTurnA(spec.k, {
        scan: dataCellsInScanOrderA(spec.k),
        format: formatCells(spec.k),
        anchors: [...anchorCells(spec.k, 'A'), ...vertexAnchors(spec.k)],
      });
    case 'K': {
      const reserved = hasSagoae ? daehanReservedCells(spec.k) : undefined;
      return {
        region: regionCellsK(spec.k).map(coordinateOnly),
        scan: dataCellsInScanOrderK(spec.k, reserved),
        format: formatCells(spec.k),
        anchors: [...anchorCells(spec.k, 'A'), ...vertexAnchorsK(spec.k)],
      };
    }
    case 'C': {
      const reserved = typeCReservedCells(
        spec.k,
        hasSagoae ? daehanReservedCells(spec.k) : undefined,
      );
      return {
        region: regionCells(spec.k).map(coordinateOnly),
        scan: dataCellsInScanOrder(spec.k, reserved),
        format: formatCells(spec.k),
        anchors: anchorCells(spec.k, 'B'),
      };
    }
    default:
      throw new RangeError(`지원하지 않는 레이아웃 family: ${spec.family}`);
  }
}

function assertCoordinate(cell, label) {
  if (!cell || !Number.isInteger(cell.q) || !Number.isInteger(cell.r)) {
    throw new TypeError(`${label} 좌표는 정수 q,r이어야 한다`);
  }
  if (cell.q < -0x8000 || cell.q > 0x7fff || cell.r < -0x8000 || cell.r > 0x7fff) {
    throw new RangeError(`${label} 좌표가 int16 범위 밖이다: ${key(cell)}`);
  }
}

function materializeLayout(spec) {
  const canonical = canonicalLayout(spec);
  const regionKeys = new Set();
  let minQ = Infinity;
  let maxQ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const cell of canonical.region) {
    assertCoordinate(cell, '영역');
    const kk = key(cell);
    if (regionKeys.has(kk)) throw new Error(`영역 좌표 중복: ${kk}`);
    regionKeys.add(kk);
    if (cell.q < minQ) minQ = cell.q;
    if (cell.q > maxQ) maxQ = cell.q;
    if (cell.r < minR) minR = cell.r;
    if (cell.r > maxR) maxR = cell.r;
  }
  if (regionKeys.size === 0) throw new Error('레이아웃 영역이 비었다');

  const scanKeys = new Set();
  const scan = canonical.scan.map((cell) => {
    assertCoordinate(cell, 'scan');
    const kk = key(cell);
    if (!regionKeys.has(kk)) throw new Error(`scan 좌표가 영역 밖이다: ${kk}`);
    if (scanKeys.has(kk)) throw new Error(`scan 좌표 중복: ${kk}`);
    scanKeys.add(kk);
    return coordinateOnly(cell);
  });

  const nonData = [];
  for (const cell of canonical.region) {
    if (!scanKeys.has(key(cell))) nonData.push(coordinateOnly(cell));
  }
  nonData.sort(compareCoordinates);
  if (scan.length + nonData.length !== canonical.region.length) {
    throw new Error('scan/non-data 분할이 영역을 정확히 덮지 않는다');
  }
  const nonDataKeys = new Set(nonData.map(key));

  const format = canonical.format.map((cell) => {
    assertCoordinate(cell, 'format');
    if (!nonDataKeys.has(key(cell))) throw new Error(`format 좌표가 non-data가 아니다: ${key(cell)}`);
    return coordinateOnly(cell);
  });
  if (new Set(format.map(key)).size !== format.length) {
    throw new Error('format walk에 중복 좌표가 있다');
  }

  const anchors = canonical.anchors.map((cell) => {
    assertCoordinate(cell, 'anchor');
    if (!Number.isInteger(cell.digit) || cell.digit < 0 || cell.digit > 5) {
      throw new RangeError(`anchor digit은 0..5여야 한다: ${cell.digit}`);
    }
    if (!nonDataKeys.has(key(cell))) throw new Error(`anchor 좌표가 non-data가 아니다: ${key(cell)}`);
    return { q: cell.q, r: cell.r, digit: cell.digit };
  });
  if (new Set(anchors.map(key)).size !== anchors.length) {
    throw new Error('anchor에 중복 좌표가 있다');
  }

  return {
    scan,
    nonData,
    format,
    anchors,
    bounds: { minQ, maxQ, minR, maxR },
  };
}

function align4(value) {
  return (value + 3) & ~3;
}

function writeDirectoryEntry(view, index, id, recordBytes, offset, count) {
  const base = DIRECTORY_OFFSET + index * DIRECTORY_ENTRY_BYTES;
  view.setUint16(base, id, true);
  view.setUint16(base + 2, recordBytes, true);
  view.setUint32(base + 4, offset, true);
  view.setUint32(base + 8, count, true);
}

function writeCoordinates(view, offset, cells, recordBytes, includeDigit) {
  for (let i = 0; i < cells.length; i += 1) {
    const base = offset + i * recordBytes;
    view.setInt16(base, cells[i].q, true);
    view.setInt16(base + 2, cells[i].r, true);
    if (includeDigit) {
      view.setUint8(base + 4, cells[i].digit);
      view.setUint8(base + 5, 0);
    }
  }
}

/** 기존 JS 정본에서 한 조합의 결정적 레이아웃 팩을 굽는다. */
export function buildLayoutPack(inputSpec) {
  const spec = normalizeSpec(inputSpec);
  const layout = materializeLayout(spec);
  const width = layout.bounds.maxQ - layout.bounds.minQ + 1;
  const height = layout.bounds.maxR - layout.bounds.minR + 1;
  const lookupCount = width * height;
  if (width > 0xffff || height > 0xffff || lookupCount > 0xffffffff) {
    throw new RangeError(`lookup 격자가 포맷 범위를 넘는다: ${width}x${height}`);
  }

  const scanOffset = HEADER_BYTES;
  const nonDataOffset = align4(scanOffset + layout.scan.length * COORDINATE_RECORD_BYTES);
  const formatOffset = align4(nonDataOffset + layout.nonData.length * COORDINATE_RECORD_BYTES);
  const anchorOffset = align4(formatOffset + layout.format.length * COORDINATE_RECORD_BYTES);
  const lookupOffset = align4(anchorOffset + layout.anchors.length * ANCHOR_RECORD_BYTES);
  const totalBytes = lookupOffset + lookupCount * LOOKUP_RECORD_BYTES;

  const bytes = new Uint8Array(totalBytes);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < MAGIC.length; i += 1) bytes[i] = MAGIC[i];
  view.setUint16(4, VERSION, true);
  view.setUint16(6, HEADER_BYTES, true);
  view.setUint32(8, totalBytes, true);
  view.setUint8(12, familyCode(spec.family));
  view.setUint8(13, 0);
  view.setUint16(14, spec.flags, true);
  view.setUint16(16, spec.k, true);
  view.setUint16(18, SECTION_COUNT, true);
  view.setInt16(20, layout.bounds.minQ, true);
  view.setInt16(22, layout.bounds.maxQ, true);
  view.setInt16(24, layout.bounds.minR, true);
  view.setInt16(26, layout.bounds.maxR, true);
  view.setUint16(28, width, true);
  view.setUint16(30, height, true);

  writeDirectoryEntry(
    view, 0, LAYOUT_PACK_SECTION.SCAN_ORDER,
    COORDINATE_RECORD_BYTES, scanOffset, layout.scan.length,
  );
  writeDirectoryEntry(
    view, 1, LAYOUT_PACK_SECTION.NON_DATA,
    COORDINATE_RECORD_BYTES, nonDataOffset, layout.nonData.length,
  );
  writeDirectoryEntry(
    view, 2, LAYOUT_PACK_SECTION.FORMAT_WALK,
    COORDINATE_RECORD_BYTES, formatOffset, layout.format.length,
  );
  writeDirectoryEntry(
    view, 3, LAYOUT_PACK_SECTION.ANCHORS,
    ANCHOR_RECORD_BYTES, anchorOffset, layout.anchors.length,
  );
  writeDirectoryEntry(
    view, 4, LAYOUT_PACK_SECTION.CELL_LOOKUP,
    LOOKUP_RECORD_BYTES, lookupOffset, lookupCount,
  );

  writeCoordinates(view, scanOffset, layout.scan, COORDINATE_RECORD_BYTES, false);
  writeCoordinates(view, nonDataOffset, layout.nonData, COORDINATE_RECORD_BYTES, false);
  writeCoordinates(view, formatOffset, layout.format, COORDINATE_RECORD_BYTES, false);
  writeCoordinates(view, anchorOffset, layout.anchors, ANCHOR_RECORD_BYTES, true);

  for (let i = 0; i < lookupCount; i += 1) {
    view.setInt32(lookupOffset + i * LOOKUP_RECORD_BYTES, LAYOUT_PACK_CELL.OUTSIDE, true);
  }
  const lookupIndex = (q, r) => (q - layout.bounds.minQ) * height + (r - layout.bounds.minR);
  for (let i = 0; i < layout.nonData.length; i += 1) {
    const cell = layout.nonData[i];
    const index = lookupIndex(cell.q, cell.r);
    view.setInt32(
      lookupOffset + index * LOOKUP_RECORD_BYTES,
      LAYOUT_PACK_CELL.NON_DATA,
      true,
    );
  }
  for (let i = 0; i < layout.scan.length; i += 1) {
    const cell = layout.scan[i];
    const index = lookupIndex(cell.q, cell.r);
    view.setInt32(lookupOffset + index * LOOKUP_RECORD_BYTES, i, true);
  }

  return bytes;
}

function readDirectoryEntry(view, index) {
  const base = DIRECTORY_OFFSET + index * DIRECTORY_ENTRY_BYTES;
  return Object.freeze({
    id: view.getUint16(base, true),
    recordBytes: view.getUint16(base + 2, true),
    offset: view.getUint32(base + 4, true),
    count: view.getUint32(base + 8, true),
  });
}

function sectionEnd(section) {
  return section.offset + section.recordBytes * section.count;
}

function assertSection(section, id, recordBytes, label, totalBytes) {
  if (section.id !== id || section.recordBytes !== recordBytes) {
    throw new RangeError(
      `${label} 디렉터리 계약 위반: id=${section.id}, recordBytes=${section.recordBytes}`,
    );
  }
  const end = sectionEnd(section);
  if (section.offset < HEADER_BYTES || section.offset % 4 !== 0 || end > totalBytes) {
    throw new RangeError(`${label} 섹션 범위가 팩 밖이거나 4바이트 정렬이 아니다`);
  }
}

function assertIndex(index, length, label) {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new RangeError(`${label} 인덱스 범위 밖: ${index} (길이 ${length})`);
  }
}

function coordinateSection(view, descriptor, label, includeDigit) {
  const section = {
    length: descriptor.count,
    qAt(index) {
      assertIndex(index, descriptor.count, label);
      return view.getInt16(descriptor.offset + index * descriptor.recordBytes, true);
    },
    rAt(index) {
      assertIndex(index, descriptor.count, label);
      return view.getInt16(descriptor.offset + index * descriptor.recordBytes + 2, true);
    },
    at(index) {
      assertIndex(index, descriptor.count, label);
      const base = descriptor.offset + index * descriptor.recordBytes;
      const cell = {
        q: view.getInt16(base, true),
        r: view.getInt16(base + 2, true),
      };
      if (includeDigit) {
        const digit = view.getUint8(base + 4);
        if (digit > 5) throw new RangeError(`anchor digit이 0..5 범위 밖이다: ${digit}`);
        cell.digit = digit;
      }
      return Object.freeze(cell);
    },
    [Symbol.iterator]() {
      let index = 0;
      return {
        next() {
          if (index >= descriptor.count) return { value: undefined, done: true };
          const value = section.at(index);
          index += 1;
          return { value, done: false };
        },
      };
    },
  };
  return Object.freeze(section);
}

/**
 * 팩을 규칙 해석 없는 읽기 전용 인덱스 뷰로 연다.
 * 입력 Uint8Array는 뷰의 수명 동안 불변으로 취급한다.
 */
export function readLayoutPack(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('레이아웃 팩은 Uint8Array여야 한다');
  }
  if (bytes.byteLength < HEADER_BYTES) throw new RangeError('레이아웃 팩 헤더가 잘렸다');
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]
    || bytes[2] !== MAGIC[2] || bytes[3] !== MAGIC[3]) {
    throw new RangeError('레이아웃 팩 magic이 TLPK가 아니다');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  const headerBytes = view.getUint16(6, true);
  const totalBytes = view.getUint32(8, true);
  const family = familyName(view.getUint8(12));
  const reserved = view.getUint8(13);
  const flags = view.getUint16(14, true);
  const k = view.getUint16(16, true);
  const sectionCount = view.getUint16(18, true);
  const minQ = view.getInt16(20, true);
  const maxQ = view.getInt16(22, true);
  const minR = view.getInt16(24, true);
  const maxR = view.getInt16(26, true);
  const width = view.getUint16(28, true);
  const height = view.getUint16(30, true);

  if (version !== VERSION || headerBytes !== HEADER_BYTES || totalBytes !== bytes.byteLength) {
    throw new RangeError('레이아웃 팩 버전·헤더 크기·전체 길이 계약이 맞지 않는다');
  }
  if (family === undefined || reserved !== 0 || k === 0 || (flags & ~KNOWN_FLAGS) !== 0) {
    throw new RangeError('레이아웃 팩 spec 헤더가 유효하지 않다');
  }
  if (!SUPPORTED_SPEC_KEYS.has(specKey({ family, k, flags }))) {
    throw new RangeError(
      `지원하지 않는 레이아웃 팩 조합: family=${family}, k=${k}, flags=0x${flags.toString(16)}`,
    );
  }
  if (sectionCount !== SECTION_COUNT || minQ > maxQ || minR > maxR
    || width !== maxQ - minQ + 1 || height !== maxR - minR + 1) {
    throw new RangeError('레이아웃 팩 섹션 수 또는 lookup 경계가 유효하지 않다');
  }

  const scanDescriptor = readDirectoryEntry(view, 0);
  const nonDataDescriptor = readDirectoryEntry(view, 1);
  const formatDescriptor = readDirectoryEntry(view, 2);
  const anchorDescriptor = readDirectoryEntry(view, 3);
  const lookupDescriptor = readDirectoryEntry(view, 4);

  assertSection(
    scanDescriptor, LAYOUT_PACK_SECTION.SCAN_ORDER,
    COORDINATE_RECORD_BYTES, 'scan-order', totalBytes,
  );
  assertSection(
    nonDataDescriptor, LAYOUT_PACK_SECTION.NON_DATA,
    COORDINATE_RECORD_BYTES, 'non-data', totalBytes,
  );
  assertSection(
    formatDescriptor, LAYOUT_PACK_SECTION.FORMAT_WALK,
    COORDINATE_RECORD_BYTES, 'format-walk', totalBytes,
  );
  assertSection(
    anchorDescriptor, LAYOUT_PACK_SECTION.ANCHORS,
    ANCHOR_RECORD_BYTES, 'anchors', totalBytes,
  );
  assertSection(
    lookupDescriptor, LAYOUT_PACK_SECTION.CELL_LOOKUP,
    LOOKUP_RECORD_BYTES, 'cell-lookup', totalBytes,
  );

  if (scanDescriptor.offset !== HEADER_BYTES
    || nonDataDescriptor.offset !== align4(sectionEnd(scanDescriptor))
    || formatDescriptor.offset !== align4(sectionEnd(nonDataDescriptor))
    || anchorDescriptor.offset !== align4(sectionEnd(formatDescriptor))
    || lookupDescriptor.offset !== align4(sectionEnd(anchorDescriptor))
    || sectionEnd(lookupDescriptor) !== totalBytes
    || lookupDescriptor.count !== width * height) {
    throw new RangeError('레이아웃 팩 섹션 오프셋 체인이 유효하지 않다');
  }

  const scanOrder = coordinateSection(view, scanDescriptor, 'scan-order', false);
  const nonData = coordinateSection(view, nonDataDescriptor, 'non-data', false);
  const formatWalk = coordinateSection(view, formatDescriptor, 'format-walk', false);
  const anchors = coordinateSection(view, anchorDescriptor, 'anchors', true);
  const spec = freezeSpec(family, k, flags);
  const bounds = Object.freeze({ minQ, maxQ, minR, maxR, width, height });
  const sections = Object.freeze({
    scanOrder: scanDescriptor,
    nonData: nonDataDescriptor,
    formatWalk: formatDescriptor,
    anchors: anchorDescriptor,
    cellLookup: lookupDescriptor,
  });

  function lookupValue(q, r) {
    if (!Number.isInteger(q) || !Number.isInteger(r)
      || q < minQ || q > maxQ || r < minR || r > maxR) {
      return LAYOUT_PACK_CELL.OUTSIDE;
    }
    const index = (q - minQ) * height + (r - minR);
    const value = view.getInt32(lookupDescriptor.offset + index * LOOKUP_RECORD_BYTES, true);
    if (value !== LAYOUT_PACK_CELL.OUTSIDE && value !== LAYOUT_PACK_CELL.NON_DATA
      && (value < 0 || value >= scanDescriptor.count)) {
      throw new RangeError(`cell-lookup 값이 유효한 scan 인덱스가 아니다: ${value}`);
    }
    return value;
  }

  return Object.freeze({
    spec,
    byteLength: totalBytes,
    bounds,
    sections,
    scanOrder,
    nonData,
    formatWalk,
    anchors,
    lookupValue,
    isNonData(q, r) {
      return lookupValue(q, r) === LAYOUT_PACK_CELL.NON_DATA;
    },
    scanIndexAt(q, r) {
      const value = lookupValue(q, r);
      return value >= 0 ? value : -1;
    },
  });
}
