/**
 * cellSurface-edge-anchor.test.js — 비-v0 셀 표면의 면 모서리 기준 배치 계약.
 *
 * 이 테스트는 n=25 기하를 계산할 수 있다는 사실과 그 레이아웃을 라인업에 올리는 일을
 * 분리한다. n=21 발행 좌표는 기존 상수·캐시와 동일해야 하고, v0는 n=13 예외로 남는다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  CELL_SURFACE_FINAL_IDS,
  CELL_SURFACE_FINAL_NS,
  V0T_BLOCKS,
  V0TR_BLOCKS,
  V0TRQ_BLOCKS,
  V0TRY_BLOCKS,
  V0TY_BLOCKS,
  V0W_BLOCKS,
  V0W2_BLOCKS,
  V0WQ_BLOCKS,
  V0WY_BLOCKS,
  V0X_BLOCKS,
  V0XQ_BLOCKS,
  V1R2_BLOCKS,
  allFinalLayoutIdsForN,
  blocksCellSurfaceFinalForN,
  cellSurfaceFinal,
  finalLayoutIdForN,
  finalLayoutIdsForN,
  hasFinalLayoutWireForN,
  locatorCellsCellSurfaceFinalForEdgeN,
  wirePreferredFinalLayoutIdForN,
} from '../src/cellSurfaceFinal.js';

const NON_V0_IDS = Object.freeze(CELL_SURFACE_FINAL_IDS.filter((id) => id !== 'v0'));

const BLOCKS_AT_21 = Object.freeze({
  v2r2: Object.freeze({
    CENTER: Object.freeze({ iMax: 4, jMax: 4 }),
    FAR: Object.freeze({ iMin: 14, jMin: 14 }),
  }),
  v1r2: Object.freeze({
    NW: Object.freeze({ iMax: 4, jMax: 4 }),
    NE: Object.freeze({ iMax: 3, jMin: 16 }),
    SW: Object.freeze({ iMin: 16, jMax: 3 }),
    SE: Object.freeze({ iMin: 16, jMin: 16 }),
  }),
  v0x: Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    NE: Object.freeze({ iMax: 1, jMin: 18 }),
    SW: Object.freeze({ iMin: 18, jMax: 1 }),
    SE: Object.freeze({ iMin: 15, jMin: 15 }),
    SINGLE: Object.freeze({ i: 14, j: 20 }),
  }),
  v0xq: Object.freeze({
    CORNER: Object.freeze({ iMax: 5, jMin: 15 }),
    MARKER: Object.freeze({ iMin: 18, jMax: 1 }),
    SLOT: Object.freeze({ iMax: 8, jMax: 8 }),
  }),
  v0w: Object.freeze({
    NW: Object.freeze({ iMax: 4, jMax: 4 }),
    NE: Object.freeze({ iMax: 5, jMin: 15 }),
    SE: Object.freeze({ iMin: 18, jMin: 18 }),
  }),
  v0wq: Object.freeze({
    CORNER: Object.freeze({ iMax: 5, jMin: 15 }),
    MARKER: Object.freeze({ iMin: 18, jMin: 18 }),
    SLOT: Object.freeze({ iMax: 7, jMax: 7 }),
  }),
  v0w2: Object.freeze({
    NW: Object.freeze({ iMax: 4, jMax: 4 }),
    NE: Object.freeze({ iMax: 5, jMin: 15 }),
    SE: Object.freeze({ iMin: 15, jMin: 15 }),
  }),
  v0wy: Object.freeze({
    NW: Object.freeze({ iMax: 4, jMax: 4 }),
    NE: Object.freeze({ iMax: 5, jMin: 15 }),
    SW: Object.freeze({ iMin: 18, jMax: 1 }),
    SLOT: Object.freeze({ iMin: 13, jMin: 13 }),
  }),
  v0t: Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    A: Object.freeze({ iMin: 4, iMax: 6, jMin: 3, jMax: 5 }),
    ARM: Object.freeze({ iMax: 1, jMin: 10, jMax: 14 }),
    NE: Object.freeze({ iMax: 5, jMin: 15 }),
    W: Object.freeze({ iMin: 10, iMax: 15, jMax: 3 }),
    SE: Object.freeze({ iMin: 18, jMin: 18 }),
  }),
  v0tr: Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    A: Object.freeze({ iMin: 4, iMax: 6, jMin: 3, jMax: 5 }),
    NE_OUTER: Object.freeze({ iMax: 5, jMin: 15 }),
    NE_INNER: Object.freeze({ iMin: 2, iMax: 7, jMin: 10, jMax: 15 }),
    SE: Object.freeze({ iMin: 18, jMin: 18 }),
  }),
  v0try: Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    A: Object.freeze({ iMin: 4, iMax: 6, jMin: 3, jMax: 5 }),
    NE_OUTER: Object.freeze({ iMax: 5, jMin: 15 }),
    NE_INNER: Object.freeze({ iMin: 2, iMax: 7, jMin: 10, jMax: 15 }),
    SLOT: Object.freeze({ iMin: 13, jMin: 13 }),
  }),
  v0trq: Object.freeze({
    NE_OUTER: Object.freeze({ iMax: 5, jMin: 15 }),
    NE_INNER: Object.freeze({ iMin: 2, iMax: 7, jMin: 10, jMax: 15 }),
    SE: Object.freeze({ iMin: 18, jMin: 18 }),
    SLOT: Object.freeze({ iMax: 7, jMax: 7 }),
  }),
  v0ty: Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    A: Object.freeze({ iMin: 4, iMax: 6, jMin: 3, jMax: 5 }),
    ARM: Object.freeze({ iMax: 1, jMin: 10, jMax: 14 }),
    NE: Object.freeze({ iMax: 5, jMin: 15 }),
    W: Object.freeze({ iMin: 10, iMax: 15, jMax: 3 }),
    SLOT: Object.freeze({ iMin: 13, jMin: 13 }),
  }),
});

const EXPORTED_BLOCKS_AT_21 = Object.freeze({
  v1r2: V1R2_BLOCKS,
  v0x: V0X_BLOCKS,
  v0xq: V0XQ_BLOCKS,
  v0w: V0W_BLOCKS,
  v0wq: V0WQ_BLOCKS,
  v0w2: V0W2_BLOCKS,
  v0wy: V0WY_BLOCKS,
  v0t: V0T_BLOCKS,
  v0tr: V0TR_BLOCKS,
  v0try: V0TRY_BLOCKS,
  v0trq: V0TRQ_BLOCKS,
  v0ty: V0TY_BLOCKS,
});

const BLOCKS_AT_25 = Object.freeze({
  v2r2: Object.freeze({
    CENTER: Object.freeze({ iMax: 4, jMax: 4 }),
    FAR: Object.freeze({ iMin: 18, jMin: 18 }),
  }),
  v1r2: Object.freeze({
    NW: Object.freeze({ iMax: 4, jMax: 4 }),
    NE: Object.freeze({ iMax: 3, jMin: 20 }),
    SW: Object.freeze({ iMin: 20, jMax: 3 }),
    SE: Object.freeze({ iMin: 20, jMin: 20 }),
  }),
  v0x: Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    NE: Object.freeze({ iMax: 1, jMin: 22 }),
    SW: Object.freeze({ iMin: 22, jMax: 1 }),
    SE: Object.freeze({ iMin: 19, jMin: 19 }),
    SINGLE: Object.freeze({ i: 18, j: 24 }),
  }),
  v0xq: Object.freeze({
    CORNER: Object.freeze({ iMax: 5, jMin: 19 }),
    MARKER: Object.freeze({ iMin: 22, jMax: 1 }),
    SLOT: Object.freeze({ iMax: 8, jMax: 8 }),
  }),
  v0w: Object.freeze({
    NW: Object.freeze({ iMax: 4, jMax: 4 }),
    NE: Object.freeze({ iMax: 5, jMin: 19 }),
    SE: Object.freeze({ iMin: 22, jMin: 22 }),
  }),
  v0wq: Object.freeze({
    CORNER: Object.freeze({ iMax: 5, jMin: 19 }),
    MARKER: Object.freeze({ iMin: 22, jMin: 22 }),
    SLOT: Object.freeze({ iMax: 7, jMax: 7 }),
  }),
  v0w2: Object.freeze({
    NW: Object.freeze({ iMax: 4, jMax: 4 }),
    NE: Object.freeze({ iMax: 5, jMin: 19 }),
    SE: Object.freeze({ iMin: 19, jMin: 19 }),
  }),
  v0wy: Object.freeze({
    NW: Object.freeze({ iMax: 4, jMax: 4 }),
    NE: Object.freeze({ iMax: 5, jMin: 19 }),
    SW: Object.freeze({ iMin: 22, jMax: 1 }),
    SLOT: Object.freeze({ iMin: 17, jMin: 17 }),
  }),
  v0t: Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    A: Object.freeze({ iMin: 4, iMax: 6, jMin: 3, jMax: 5 }),
    ARM: Object.freeze({ iMax: 1, jMin: 14, jMax: 18 }),
    NE: Object.freeze({ iMax: 5, jMin: 19 }),
    W: Object.freeze({ iMin: 14, iMax: 19, jMax: 3 }),
    SE: Object.freeze({ iMin: 22, jMin: 22 }),
  }),
  v0tr: Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    A: Object.freeze({ iMin: 4, iMax: 6, jMin: 3, jMax: 5 }),
    NE_OUTER: Object.freeze({ iMax: 5, jMin: 19 }),
    NE_INNER: Object.freeze({ iMin: 2, iMax: 7, jMin: 14, jMax: 19 }),
    SE: Object.freeze({ iMin: 22, jMin: 22 }),
  }),
  v0try: Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    A: Object.freeze({ iMin: 4, iMax: 6, jMin: 3, jMax: 5 }),
    NE_OUTER: Object.freeze({ iMax: 5, jMin: 19 }),
    NE_INNER: Object.freeze({ iMin: 2, iMax: 7, jMin: 14, jMax: 19 }),
    SLOT: Object.freeze({ iMin: 17, jMin: 17 }),
  }),
  v0trq: Object.freeze({
    NE_OUTER: Object.freeze({ iMax: 5, jMin: 19 }),
    NE_INNER: Object.freeze({ iMin: 2, iMax: 7, jMin: 14, jMax: 19 }),
    SE: Object.freeze({ iMin: 22, jMin: 22 }),
    SLOT: Object.freeze({ iMax: 7, jMax: 7 }),
  }),
  v0ty: Object.freeze({
    NW: Object.freeze({ iMax: 3, jMax: 3 }),
    A: Object.freeze({ iMin: 4, iMax: 6, jMin: 3, jMax: 5 }),
    ARM: Object.freeze({ iMax: 1, jMin: 14, jMax: 18 }),
    NE: Object.freeze({ iMax: 5, jMin: 19 }),
    W: Object.freeze({ iMin: 14, iMax: 19, jMax: 3 }),
    SLOT: Object.freeze({ iMin: 17, jMin: 17 }),
  }),
});

const LOCATOR_COUNTS = Object.freeze({
  v2r2: 74,
  v1r2: 80,
  v0x: 65,
  v0xq: 42,
  v0w: 70,
  v0wq: 45,
  v0w2: 97,
  v0wy: 67,
  v0t: 104,
  v0tr: 102,
  v0try: 93,
  v0trq: 77,
  v0ty: 95,
});

// 수정 전 깨끗한 HEAD 272d80d76349c1b8c855e41cab727cf917d02676에서 얻은 기준선.
const ACTIVE_21_BYTE_BASELINES = Object.freeze({
  v0t: Object.freeze({
    finderBytes: 1337,
    finderSha256: '28d5a32e25c3c729d1b7fe3d56b97031806f83a6156b39310c457948f30a7192',
    surfaceBytes: 1588,
    surfaceSha256: '613c0216766982836f40f16b602eb8d89aeff6350622802ba5ef1bd773e72fc4',
  }),
  v0tr: Object.freeze({
    finderBytes: 1311,
    finderSha256: '1e43f8b407e6875732fe8c1482730d1ab52686b03500af956e4a97ae85e49876',
    surfaceBytes: 1562,
    surfaceSha256: '97d22aa9513cd1b90fb0659d14ae6e594f6a66d4d9db06458d9976789d313bae',
  }),
  v0try: Object.freeze({
    finderBytes: 1185,
    finderSha256: '08379d735e555389fcd01bbd1903cde67cde6ecac5d9f43daae943d18ec5a698',
    surfaceBytes: 1944,
    surfaceSha256: 'c96e0f23fef27580522f6c075a154f97a7d2f3cc9f02852eb87762292b8228e9',
  }),
  v0trq: Object.freeze({
    finderBytes: 1011,
    finderSha256: '93e69b6374559350aa99d0e8277ee8247e5a751320323d826076f22a8035c04a',
    surfaceBytes: 1653,
    surfaceSha256: '56a51e92ae36ba65b131d2d02505cd666246692b1004074e770b81dc3127f3c4',
  }),
  v0ty: Object.freeze({
    finderBytes: 1211,
    finderSha256: '9de7f077f0c70f6d3ae7f492f6b42250da3008139f05e2dc77b465eafb2bdf66',
    surfaceBytes: 1970,
    surfaceSha256: 'f9267b2ba649cad2b8cf407ec6b6cd0522e16c5a7db077b7060a0b287f2c3f06',
  }),
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function byteBaselineFor(surface) {
  const finder = JSON.stringify(
    surface.locatorCells.map(({ i, j, T, L, R }) => [i, j, T, L, R]),
  );
  const all = JSON.stringify({
    locator: surface.locatorCells.map(({ i, j, T, L, R }) => [i, j, T, L, R]),
    slot: surface.slotCells.map(({ i, j }) => [i, j]),
    format: surface.formatCells.map(({ i, j }) => [i, j]),
    reference: surface.referenceCells.map(({ i, j }) => [i, j]),
  });
  return {
    finderBytes: Buffer.byteLength(finder),
    finderSha256: sha256(finder),
    surfaceBytes: Buffer.byteLength(all),
    surfaceSha256: sha256(all),
  };
}

function inBlock(cell, block) {
  if (block.i !== undefined && cell.i !== block.i) return false;
  if (block.j !== undefined && cell.j !== block.j) return false;
  if (block.iMin !== undefined && cell.i < block.iMin) return false;
  if (block.iMax !== undefined && cell.i > block.iMax) return false;
  if (block.jMin !== undefined && cell.j < block.jMin) return false;
  if (block.jMax !== undefined && cell.j > block.jMax) return false;
  return true;
}

function toneHistogram(cells) {
  const counts = new Map();
  for (const { T, L, R } of cells) {
    const key = T + ',' + L + ',' + R;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort(([left], [right]) => left.localeCompare(right));
}

// **의도적 갱신 (2026-08-25)** — 이 락의 원 취지는 「기하가 **저절로** 라인업을 넓히지
// 않는다」였다 (순수 질의가 어떤 n 을 계산할 수 있다는 사실이 곧 지원 조합은 아니다).
// 그 취지는 그대로다. 다만 **명시적 편입**이 한 번 일어났다: v0t·v0tr 에 n=25 를
// 넣었다 (운영자 신고 「Y1에서 Y2로 먼저 넘어가야되는데 마커가 먼저 없어지는데?」).
// 근거는 이 파일이 이미 재고 있다 — n=25 파인더 셀 수가 n=21 과 **같다**.
// ⚠ 슬롯 계열(v0ty·v0trq·v0try)은 여전히 21 뿐이다: QR 슬롯은 변 앵커가 아니라
//   n 마다 위치 규범이 새로 필요하고 그 규범이 아직 없다.
test('CELL_SURFACE_FINAL_NS 는 **명시 편입**으로만 넓어진다 (기하가 저절로 넓히지 않는다)', () => {
  assert.deepEqual(CELL_SURFACE_FINAL_NS, {
    v0: [13],
    v2r2: [21, 25],
    v1r2: [21],
    v0x: [21],
    v0xq: [21],
    v0w: [21],
    v0wq: [21],
    v0w2: [21],
    v0wy: [21],
    v0t: [21, 25],
    v0ty: [21],
    v0tr: [21, 25],
    v0trq: [21],
    v0try: [21],
  });
  assert.deepEqual(finalLayoutIdsForN(13), ['v0']);
  assert.deepEqual(finalLayoutIdsForN(21), ['v0t', 'v0tr', 'v0try', 'v0trq', 'v0ty']);
  assert.deepEqual(finalLayoutIdsForN(25), ['v0t', 'v0tr']);
  assert.equal(finalLayoutIdForN(25), 'v0t');
  // 드랍(v2r2)은 와이어에 남고, 새 편입(v0t·v0tr)이 앞이 아니라 **뒤**에 붙는다 —
  // 선언 순서가 곧 목록 순서다.
  assert.deepEqual(allFinalLayoutIdsForN(25), ['v2r2', 'v0t', 'v0tr']);
  assert.equal(hasFinalLayoutWireForN(25), true);
  assert.equal(wirePreferredFinalLayoutIdForN(25), 'v2r2');
});

test('n=21 블록 상수와 locator 셀이 기존 발행 기하와 동일하다', () => {
  assert.deepEqual(Object.keys(BLOCKS_AT_21).sort(), NON_V0_IDS.slice().sort());
  for (const id of NON_V0_IDS) {
    assert.deepEqual(blocksCellSurfaceFinalForN(21, id), BLOCKS_AT_21[id], id + ' 블록');
    if (id !== 'v2r2') {
      assert.deepEqual(EXPORTED_BLOCKS_AT_21[id], BLOCKS_AT_21[id], id + ' 호환 상수');
    }
    assert.deepEqual(
      locatorCellsCellSurfaceFinalForEdgeN(21, id),
      cellSurfaceFinal(21, id).locatorCells,
      id + ' locator',
    );
  }
});

test('활성 n=21 finder·surface 직렬화가 수정 전 SHA-256과 바이트 동일하다', () => {
  assert.deepEqual(
    finalLayoutIdsForN(21).slice().sort(),
    Object.keys(ACTIVE_21_BYTE_BASELINES).sort(),
  );
  for (const [id, expected] of Object.entries(ACTIVE_21_BYTE_BASELINES)) {
    assert.deepEqual(byteBaselineFor(cellSurfaceFinal(21, id)), expected, id);
  }
});

test('n=25 블록 좌표가 높은 변 inset을 보존하고 전부 동결된다', () => {
  assert.deepEqual(Object.keys(BLOCKS_AT_25).sort(), NON_V0_IDS.slice().sort());
  for (const id of NON_V0_IDS) {
    const actual = blocksCellSurfaceFinalForN(25, id);
    assert.deepEqual(actual, BLOCKS_AT_25[id], id);
    assert.equal(Object.isFrozen(actual), true, id + ' 블록 표가 동결되지 않았다');
    for (const [name, block] of Object.entries(actual)) {
      assert.equal(Object.isFrozen(block), true, id + '.' + name + ' 이 동결되지 않았다');
    }
  }
});

test('n=25 locator 셀은 개수·유일성·범위·톤·블록 소속을 보존한다', () => {
  for (const id of NON_V0_IDS) {
    const cells = locatorCellsCellSurfaceFinalForEdgeN(25, id);
    const keys = cells.map(({ i, j }) => i + ',' + j);
    const finderBlocks = Object.entries(BLOCKS_AT_25[id])
      .filter(([name]) => name !== 'SLOT')
      .map(([, block]) => block);

    assert.equal(cells.length, LOCATOR_COUNTS[id], id + ' locator count');
    assert.equal(new Set(keys).size, cells.length, id + ' locator 좌표 중복');
    assert.equal(Object.isFrozen(cells), true, id + ' locator 배열이 동결되지 않았다');
    for (const cell of cells) {
      assert.equal(Object.isFrozen(cell), true, id + ' locator 셀이 동결되지 않았다');
      assert.equal(Number.isInteger(cell.i) && cell.i >= 0 && cell.i < 25, true,
        id + ' i 범위: ' + cell.i);
      assert.equal(Number.isInteger(cell.j) && cell.j >= 0 && cell.j < 25, true,
        id + ' j 범위: ' + cell.j);
      for (const face of ['T', 'L', 'R']) {
        assert.equal(cell[face] === 0 || cell[face] === 2, true,
          id + ' (' + cell.i + ',' + cell.j + ').' + face + ' 톤: ' + cell[face]);
      }
      assert.equal(finderBlocks.some((block) => inBlock(cell, block)), true,
        id + ' 블록 밖 locator: ' + cell.i + ',' + cell.j);
    }
    assert.deepEqual(
      toneHistogram(cells),
      toneHistogram(locatorCellsCellSurfaceFinalForEdgeN(21, id)),
      id + ' 톤 다중집합',
    );
  }
});

test('v0는 n=13 고정 예외이고 면 모서리 블록 API 대상이 아니다', () => {
  assert.deepEqual(
    locatorCellsCellSurfaceFinalForEdgeN(13, 'v0'),
    cellSurfaceFinal(13, 'v0').locatorCells,
  );
  assert.throws(() => blocksCellSurfaceFinalForN(13, 'v0'), /v0.*n=13.*예외/);
  assert.throws(() => blocksCellSurfaceFinalForN(25, 'v0'), /v0.*n=13.*예외/);
  assert.throws(() => locatorCellsCellSurfaceFinalForEdgeN(25, 'v0'), /v0.*n=13/);
});

test('면 모서리 기하 API는 불법 id·n을 fail-closed로 거부한다', () => {
  for (const n of [20, 21.5, Number.NaN, Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => blocksCellSurfaceFinalForN(n, 'v0t'), RangeError);
    assert.throws(() => locatorCellsCellSurfaceFinalForEdgeN(n, 'v0t'), RangeError);
  }
  assert.throws(() => blocksCellSurfaceFinalForN(25, 'unknown'), RangeError);
  assert.throws(() => locatorCellsCellSurfaceFinalForEdgeN(25, 'unknown'), RangeError);
});
