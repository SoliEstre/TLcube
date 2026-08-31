import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { regionCells } from '../src/hexgrid.js';
import { VERSIONS } from '../src/capacity.js';
import { VERSIONS_DAEHAN } from '../src/capacityDaehan.js';
import { VERSIONS_A } from '../src/capacityA.js';
import { VERSIONS_K, VERSIONS_K_DAEHAN } from '../src/capacityK.js';
import { VERSIONS_C, VERSIONS_C_DAEHAN } from '../src/capacityC.js';
import { dataCellsInScanOrder } from '../src/layout.js';
import { dataCellsInScanOrderA } from '../src/layoutA.js';
import { dataCellsInScanOrderK } from '../src/layoutK.js';
import { anchorCells, formatCells } from '../src/placement.js';
import {
  regionCellsA,
  regionCellsTurnA,
  vertexAnchors,
} from '../src/placementA.js';
import { regionCellsK, vertexAnchorsK } from '../src/placementK.js';
import {
  VERSIONS_OCM,
  dataCellsInScanOrderOMarker,
  formatCellsOMarker,
} from '../src/markerO.js';
import {
  VERSIONS_OCM_DAEHAN,
  dataCellsInScanOrderOMarkerDaehan,
} from '../src/markerOdaehan.js';
import { daehanReservedCells } from '../src/finder-daehan.js';
import { typeCReservedCells } from '../src/notchC.js';
import {
  LAYOUT_PACK_CELL,
  LAYOUT_PACK_FAMILY,
  LAYOUT_PACK_FLAGS,
  LAYOUT_PACK_FORMAT,
  LAYOUT_PACK_SECTION,
  SUPPORTED_LAYOUT_PACK_SPECS,
  buildLayoutPack,
  layoutPackFileName,
  layoutPackSpecKey,
  readLayoutPack,
} from '../src/r2/layout-pack.js';
import {
  OUTPUTS,
  buildLayoutPackArtifacts,
} from '../tools/build-layout-packs.mjs';

const EXPECTED_MANIFEST_SHA256 = '515104af456526f1b3f382a6aed1dbc10e3d601a17c4ce9ba59ed161544b10ce';

function key(cell) {
  return `${cell.q},${cell.r}`;
}

function coordinate(cell) {
  return {
    q: cell.q === 0 ? 0 : cell.q,
    r: cell.r === 0 ? 0 : cell.r,
  };
}

function turnPhysical(k, lists) {
  const canonicalRegion = regionCellsA(k);
  const physicalRegion = regionCellsTurnA(k);
  assert.equal(physicalRegion.length, canonicalRegion.length, `V k=${k} 영역 길이`);
  const physicalByCanonical = new Map();
  for (let i = 0; i < canonicalRegion.length; i += 1) {
    physicalByCanonical.set(key(canonicalRegion[i]), physicalRegion[i]);
  }
  const turn = (cells) => cells.map((cell) => {
    const physical = physicalByCanonical.get(key(cell));
    assert.ok(physical, `V k=${k} 물리상에 ${key(cell)}가 있어야 한다`);
    const mapped = coordinate(physical);
    return cell.digit === undefined ? mapped : { ...mapped, digit: cell.digit };
  });
  return {
    region: physicalRegion.map(coordinate),
    scan: turn(lists.scan),
    format: turn(lists.format),
    anchors: turn(lists.anchors),
  };
}

/** 팩 구현을 거치지 않고 기존 JS 정본 API에서 직접 만든 교차 대조 오라클. */
function canonicalDump(spec) {
  const sagoae = (spec.flags & LAYOUT_PACK_FLAGS.SAGOAE_RESERVED) !== 0;
  const marker = (spec.flags & LAYOUT_PACK_FLAGS.CORNER_MARKER) !== 0;
  let dump;
  switch (spec.family) {
    case 'O': {
      const region = regionCells(spec.k).map(coordinate);
      if (marker && sagoae) {
        dump = {
          region,
          scan: dataCellsInScanOrderOMarkerDaehan(spec.k),
          format: formatCellsOMarker(spec.k),
          anchors: anchorCells(spec.k, 'A'),
        };
      } else if (marker) {
        dump = {
          region,
          scan: dataCellsInScanOrderOMarker(spec.k),
          format: formatCellsOMarker(spec.k),
          anchors: anchorCells(spec.k, 'A'),
        };
      } else {
        const reserved = sagoae ? daehanReservedCells(spec.k) : undefined;
        dump = {
          region,
          scan: dataCellsInScanOrder(spec.k, reserved),
          format: formatCells(spec.k),
          anchors: anchorCells(spec.k, 'A'),
        };
      }
      break;
    }
    case 'A':
      dump = {
        region: regionCellsA(spec.k).map(coordinate),
        scan: dataCellsInScanOrderA(spec.k),
        format: formatCells(spec.k),
        anchors: [...anchorCells(spec.k, 'A'), ...vertexAnchors(spec.k)],
      };
      break;
    case 'V':
      dump = turnPhysical(spec.k, {
        scan: dataCellsInScanOrderA(spec.k),
        format: formatCells(spec.k),
        anchors: [...anchorCells(spec.k, 'A'), ...vertexAnchors(spec.k)],
      });
      break;
    case 'K': {
      const reserved = sagoae ? daehanReservedCells(spec.k) : undefined;
      dump = {
        region: regionCellsK(spec.k).map(coordinate),
        scan: dataCellsInScanOrderK(spec.k, reserved),
        format: formatCells(spec.k),
        anchors: [...anchorCells(spec.k, 'A'), ...vertexAnchorsK(spec.k)],
      };
      break;
    }
    case 'C': {
      const reserved = typeCReservedCells(
        spec.k,
        sagoae ? daehanReservedCells(spec.k) : undefined,
      );
      dump = {
        region: regionCells(spec.k).map(coordinate),
        scan: dataCellsInScanOrder(spec.k, reserved),
        format: formatCells(spec.k),
        anchors: anchorCells(spec.k, 'B'),
      };
      break;
    }
    default:
      assert.fail(`오라클에 없는 family ${spec.family}`);
  }

  const scan = dump.scan.map(coordinate);
  const scanSet = new Set(scan.map(key));
  assert.equal(scanSet.size, scan.length, `${layoutPackSpecKey(spec)} 정본 scan 중복 0`);
  const nonData = new Set(dump.region.filter((cell) => !scanSet.has(key(cell))).map(key));
  assert.equal(scan.length + nonData.size, dump.region.length,
    `${layoutPackSpecKey(spec)} 정본 영역 완전 분할`);
  return {
    scan,
    nonData,
    format: dump.format.map(coordinate),
    anchors: dump.anchors.map((cell) => ({ ...coordinate(cell), digit: cell.digit })),
  };
}

function sectionArray(section) {
  return Array.from(section);
}

function sortedSet(set) {
  return [...set].sort();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('지원 매트릭스는 R2 정식 좌표 조합 35개에서 직접 유도된다', () => {
  assert.equal(SUPPORTED_LAYOUT_PACK_SPECS.length, 35);
  const expected = [
    ...VERSIONS.map((v) => `O:${v.k}:0`),
    ...VERSIONS_DAEHAN.map((v) => `O:${v.k}:1`),
    ...VERSIONS_OCM.map((v) => `O:${v.k}:2`),
    ...VERSIONS_OCM_DAEHAN.map((v) => `O:${v.k}:3`),
    ...VERSIONS_A.map((v) => `A:${v.k}:0`),
    ...VERSIONS_A.map((v) => `V:${v.k}:0`),
    ...VERSIONS_K.map((v) => `K:${v.k}:0`),
    ...VERSIONS_K_DAEHAN.map((v) => `K:${v.k}:1`),
    ...VERSIONS_C.map((v) => `C:${v.k}:0`),
    ...VERSIONS_C_DAEHAN.map((v) => `C:${v.k}:1`),
  ].sort();
  const actual = SUPPORTED_LAYOUT_PACK_SPECS
    .map((spec) => `${spec.family}:${spec.k}:${spec.flags}`).sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length, '지원 조합 중복 0');
});

test(`기존 JS 정본 교차 덤프: ${SUPPORTED_LAYOUT_PACK_SPECS.length}/35 조합 원소 일치`, () => {
  let matched = 0;
  for (const spec of SUPPORTED_LAYOUT_PACK_SPECS) {
    const label = layoutPackSpecKey(spec);
    const expected = canonicalDump(spec);
    const pack = readLayoutPack(buildLayoutPack(spec));

    assert.deepEqual(sectionArray(pack.scanOrder), expected.scan, `${label} scan 순서`);
    assert.deepEqual(sectionArray(pack.formatWalk), expected.format, `${label} format walk 순서`);
    assert.deepEqual(sectionArray(pack.anchors), expected.anchors, `${label} anchor 순서+digit`);

    const actualNonData = new Set(sectionArray(pack.nonData).map(key));
    assert.equal(actualNonData.size, pack.nonData.length, `${label} non-data 중복 0`);
    assert.deepEqual(sortedSet(actualNonData), sortedSet(expected.nonData), `${label} non-data 집합`);
    matched += 1;
  }
  assert.equal(matched, SUPPORTED_LAYOUT_PACK_SPECS.length);
});

test('build → read 왕복: spec과 모든 질의가 같은 답을 낸다', () => {
  for (const spec of SUPPORTED_LAYOUT_PACK_SPECS) {
    const label = layoutPackSpecKey(spec);
    const bytes = buildLayoutPack(spec);
    const pack = readLayoutPack(bytes);
    assert.deepEqual(pack.spec, spec, `${label} spec`);
    assert.deepEqual(buildLayoutPack(pack.spec), bytes, `${label} spec 재빌드`);

    for (let i = 0; i < pack.scanOrder.length; i += 1) {
      const cell = pack.scanOrder.at(i);
      assert.equal(pack.scanOrder.qAt(i), cell.q, `${label} scan qAt ${i}`);
      assert.equal(pack.scanOrder.rAt(i), cell.r, `${label} scan rAt ${i}`);
      assert.equal(pack.scanIndexAt(cell.q, cell.r), i, `${label} scan lookup ${i}`);
      assert.equal(pack.isNonData(cell.q, cell.r), false, `${label} data 분류 ${i}`);
    }
    for (let i = 0; i < pack.nonData.length; i += 1) {
      const cell = pack.nonData.at(i);
      assert.equal(pack.isNonData(cell.q, cell.r), true, `${label} non-data lookup ${i}`);
      assert.equal(pack.scanIndexAt(cell.q, cell.r), -1, `${label} non-data scan sentinel ${i}`);
    }
    assert.equal(pack.lookupValue(pack.bounds.minQ - 1, pack.bounds.minR), LAYOUT_PACK_CELL.OUTSIDE);
    assert.equal(pack.lookupValue(pack.bounds.maxQ + 1, pack.bounds.maxR), LAYOUT_PACK_CELL.OUTSIDE);
  }
});

test('결정성: 같은 spec은 바이트 동일이고 전수 manifest SHA-256이 잠겨 있다', () => {
  for (const spec of SUPPORTED_LAYOUT_PACK_SPECS) {
    assert.deepEqual(buildLayoutPack(spec), buildLayoutPack({ ...spec }));
  }
  const first = buildLayoutPackArtifacts();
  const second = buildLayoutPackArtifacts();
  assert.equal(first.manifestText, second.manifestText);
  assert.equal(sha256(first.manifestText), EXPECTED_MANIFEST_SHA256);
  for (const pack of first.packs) {
    assert.equal(pack.sha256, sha256(pack.bytes), pack.key);
  }
});

test('인덱싱 성질: read에 파싱 루프가 없고 임의 조회는 고정 횟수 DataView 접근이다', () => {
  assert.doesNotMatch(readLayoutPack.toString(), /\b(?:for|while)\s*\(/,
    'readLayoutPack 본문에 파싱 루프가 생겼다');
  const spec = SUPPORTED_LAYOUT_PACK_SPECS.find((entry) => entry.family === 'C' && entry.k === 20
    && entry.flags === LAYOUT_PACK_FLAGS.SAGOAE_RESERVED);
  const pack = readLayoutPack(buildLayoutPack(spec));
  const probe = pack.scanOrder.at(Math.floor(pack.scanOrder.length / 2));

  const originalGetInt32 = DataView.prototype.getInt32;
  let reads = 0;
  DataView.prototype.getInt32 = function countedGetInt32(...args) {
    reads += 1;
    return originalGetInt32.apply(this, args);
  };
  try {
    assert.ok(pack.scanIndexAt(probe.q, probe.r) >= 0);
    assert.equal(reads, 1, '영역 안 임의 셀 조회는 lookup 레코드 1회 접근이어야 한다');
    reads = 0;
    assert.equal(pack.lookupValue(pack.bounds.maxQ + 1, probe.r), LAYOUT_PACK_CELL.OUTSIDE);
    assert.equal(reads, 0, '경계 밖 조회는 메모리 접근 없이 끝나야 한다');
  } finally {
    DataView.prototype.getInt32 = originalGetInt32;
  }

  const originalGetInt16 = DataView.prototype.getInt16;
  let coordinateReads = 0;
  DataView.prototype.getInt16 = function countedGetInt16(...args) {
    coordinateReads += 1;
    return originalGetInt16.apply(this, args);
  };
  try {
    pack.scanOrder.at(pack.scanOrder.length - 1);
    assert.equal(coordinateReads, 2, '좌표 at(i)는 q/r 레코드 2회 접근이어야 한다');
  } finally {
    DataView.prototype.getInt16 = originalGetInt16;
  }
});

test('바이너리 규격: LE 버전 헤더와 고정 5섹션 오프셋 테이블', () => {
  const spec = { family: 'O', k: 6, flags: LAYOUT_PACK_FLAGS.NONE };
  const bytes = buildLayoutPack(spec);
  assert.equal(bytes instanceof Uint8Array, true);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.deepEqual([...bytes.slice(0, 4)], [0x54, 0x4c, 0x50, 0x4b]);
  assert.equal(view.getUint16(4, true), LAYOUT_PACK_FORMAT.version);
  assert.equal(view.getUint16(6, true), LAYOUT_PACK_FORMAT.headerBytes);
  assert.equal(view.getUint32(8, true), bytes.byteLength);
  assert.equal(view.getUint8(12), LAYOUT_PACK_FAMILY.O);
  assert.equal(view.getUint16(14, true), LAYOUT_PACK_FLAGS.NONE);
  assert.equal(view.getUint16(16, true), 6);
  assert.equal(view.getUint16(18, true), LAYOUT_PACK_FORMAT.sectionCount);

  const expectedIds = [
    LAYOUT_PACK_SECTION.SCAN_ORDER,
    LAYOUT_PACK_SECTION.NON_DATA,
    LAYOUT_PACK_SECTION.FORMAT_WALK,
    LAYOUT_PACK_SECTION.ANCHORS,
    LAYOUT_PACK_SECTION.CELL_LOOKUP,
  ];
  for (let i = 0; i < expectedIds.length; i += 1) {
    const base = LAYOUT_PACK_FORMAT.directoryOffset + i * LAYOUT_PACK_FORMAT.directoryEntryBytes;
    assert.equal(view.getUint16(base, true), expectedIds[i]);
    assert.equal(view.getUint32(base + 4, true) % 4, 0, `section ${i} offset 정렬`);
    assert.ok(view.getUint32(base + 8, true) > 0, `section ${i} count`);
  }

  const pack = readLayoutPack(bytes);
  let negativeIndex = -1;
  for (let i = 0; i < pack.scanOrder.length; i += 1) {
    if (pack.scanOrder.qAt(i) < 0) {
      negativeIndex = i;
      break;
    }
  }
  assert.notEqual(negativeIndex, -1, 'LE 부호 표본 좌표');
  const q = pack.scanOrder.qAt(negativeIndex);
  const scanOffset = view.getUint32(LAYOUT_PACK_FORMAT.directoryOffset + 4, true);
  const qOffset = scanOffset + negativeIndex * LAYOUT_PACK_FORMAT.coordinateRecordBytes;
  assert.equal(bytes[qOffset], q & 0xff);
  assert.equal(bytes[qOffset + 1], (q >>> 8) & 0xff);
});

test('읽기 전용 뷰와 손상 팩 거절', () => {
  const bytes = buildLayoutPack({ family: 'K', k: 10, flags: LAYOUT_PACK_FLAGS.NONE });
  const pack = readLayoutPack(bytes);
  assert.equal(Object.isFrozen(pack), true);
  assert.equal(Object.isFrozen(pack.spec), true);
  assert.equal(Object.isFrozen(pack.sections), true);
  assert.equal(Object.isFrozen(pack.scanOrder), true);
  assert.equal(Object.isFrozen(pack.scanOrder.at(0)), true);
  assert.throws(() => { pack.spec.k = 8; }, TypeError);
  assert.throws(() => pack.scanOrder.at(-1), RangeError);
  assert.throws(() => pack.scanOrder.at(Number.NaN), RangeError);
  assert.throws(() => pack.scanOrder.at(0.5), RangeError);
  assert.throws(() => pack.scanOrder.at(pack.scanOrder.length), RangeError);
  assert.throws(() => readLayoutPack(new ArrayBuffer(bytes.byteLength)), TypeError);

  const badMagic = bytes.slice();
  badMagic[0] = 0;
  assert.throws(() => readLayoutPack(badMagic), /magic/);
  const badLength = bytes.slice();
  new DataView(badLength.buffer).setUint32(8, badLength.byteLength - 1, true);
  assert.throws(() => readLayoutPack(badLength), /버전·헤더 크기·전체 길이/);
  const badOffset = bytes.slice();
  new DataView(badOffset.buffer).setUint32(
    LAYOUT_PACK_FORMAT.directoryOffset + 4,
    LAYOUT_PACK_FORMAT.headerBytes + 1,
    true,
  );
  assert.throws(() => readLayoutPack(badOffset), /정렬/);

  const unsupportedSpec = bytes.slice();
  new DataView(unsupportedSpec.buffer).setUint16(16, 7, true);
  assert.throws(() => readLayoutPack(unsupportedSpec), /지원하지 않는/);

  const badLookup = bytes.slice();
  const firstCell = pack.scanOrder.at(0);
  const lookupIndex = (firstCell.q - pack.bounds.minQ) * pack.bounds.height
    + (firstCell.r - pack.bounds.minR);
  new DataView(badLookup.buffer).setInt32(
    pack.sections.cellLookup.offset
      + lookupIndex * LAYOUT_PACK_FORMAT.lookupRecordBytes,
    0x7fffffff,
    true,
  );
  const badLookupPack = readLayoutPack(badLookup);
  assert.throws(
    () => badLookupPack.lookupValue(firstCell.q, firstCell.r),
    /cell-lookup 값/,
  );

  const badAnchor = bytes.slice();
  new DataView(badAnchor.buffer).setUint8(pack.sections.anchors.offset + 4, 0xff);
  const badAnchorPack = readLayoutPack(badAnchor);
  assert.throws(() => badAnchorPack.anchors.at(0), /anchor digit/);
});

test('소비기는 정본 규칙을 재계산하지 않고 팩 레코드를 직접 읽는다', () => {
  const bytes = buildLayoutPack({ family: 'A', k: 8, flags: LAYOUT_PACK_FLAGS.NONE });
  const original = readLayoutPack(bytes).scanOrder.at(0);
  const changed = bytes.slice();
  const view = new DataView(changed.buffer, changed.byteOffset, changed.byteLength);
  const scanOffset = view.getUint32(LAYOUT_PACK_FORMAT.directoryOffset + 4, true);
  view.setInt16(scanOffset, original.q + 1, true);
  assert.equal(readLayoutPack(changed).scanOrder.at(0).q, original.q + 1);
});

test('경계: 지원 밖 family/k/flags 조합은 빈 팩 대신 명확히 거절한다', () => {
  assert.throws(() => buildLayoutPack({ family: 'Y', k: 6, flags: 0 }), /family/);
  assert.throws(() => buildLayoutPack({ family: 'O', k: 7, flags: 0 }), /지원하지 않는/);
  assert.throws(() => buildLayoutPack({ family: 'O', k: 6, flags: 3 }), /지원하지 않는/,
    'G1×daehan은 정본에서 충돌로 제외된다');
  assert.throws(() => buildLayoutPack({ family: 'A', k: 6, flags: 1 }), /지원하지 않는/);
  assert.throws(() => buildLayoutPack({ family: 'K', k: 6, flags: 2 }), /지원하지 않는/);
  assert.throws(() => buildLayoutPack({ family: 'C', k: 14, flags: 2 }), /지원하지 않는/);
  assert.throws(() => buildLayoutPack({ family: 'O', k: 6, flags: 4 }), /알 수 없는/);
  assert.throws(() => buildLayoutPack(null), TypeError);
  assert.equal(layoutPackSpecKey({ family: 'O', k: 6 }), 'O:6:0');
});

test('전수 생성기: 35팩 + manifest, 이름·해시·OUTPUTS가 일치한다', () => {
  const artifacts = buildLayoutPackArtifacts();
  assert.equal(artifacts.packs.length, 35);
  assert.equal(artifacts.manifest.count, 35);
  assert.equal(OUTPUTS.length, 36);
  assert.equal(new Set(OUTPUTS).size, OUTPUTS.length);
  for (const pack of artifacts.packs) {
    assert.equal(pack.file, layoutPackFileName(pack.spec));
    assert.equal(pack.sha256, sha256(pack.bytes));
    assert.deepEqual(readLayoutPack(pack.bytes).spec, pack.spec);
    assert.ok(OUTPUTS.some((output) => output.endsWith(`/${pack.file}`)), pack.file);
  }
  assert.ok(OUTPUTS.some((output) => output.endsWith('/manifest.json')));
});
