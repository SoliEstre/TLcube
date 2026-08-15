/**
 * autoplaceY.test.js — 셀 표면 ref/format 자동 배치.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTOPLACE_REF_QUADRANT,
  AutoplaceError,
  minFormatSeparation,
  minReferenceDispersion,
  movedReservedCount,
  placeReservedCells,
  placementKey,
} from '../src/autoplaceY.js';
import { formatCells, referenceCellsAll } from '../src/placementY.js';
import {
  CELL_SURFACE_LAYOUT_V1R2,
  CELL_SURFACE_LAYOUT_V2,
  cellSurfaceLayout,
  paintedCellsCellSurfaceLayout,
} from '../src/cellSurfaceLayouts.js';

function key(cell) {
  return cell.i + ',' + cell.j;
}

function setOf(cells) {
  return new Set(cells.map(key));
}

function paintedFromLayout(id) {
  return paintedCellsCellSurfaceLayout(id).map((cell) => ({ i: cell.i, j: cell.j }));
}

function v2r2Occupied() {
  const cells = [];
  for (let i = 0; i <= 3; i += 1) {
    for (let j = 0; j <= 3; j += 1) cells.push({ i, j });
  }
  for (let i = 4; i <= 10; i += 1) {
    for (let j = 4; j <= 10; j += 1) cells.push({ i, j });
  }
  return cells;
}

test('빈 점유는 n=11·13·21·25 에서 placementY 레거시와 바이트 동일하다', () => {
  for (const n of [11, 13, 21, 25]) {
    const placed = placeReservedCells(n, []);
    const legacyFmt = formatCells(n);
    const legacyRef = referenceCellsAll(n, 2);
    assert.equal(placed.formatCells.length, 15);
    assert.equal(placed.referenceCells.length, 12);
    assert.deepEqual(
      placed.formatCells.map(key),
      legacyFmt.map(key),
      'n=' + n + ' format',
    );
    assert.deepEqual(
      placed.referenceCells.map(key),
      legacyRef.map(key),
      'n=' + n + ' reference',
    );
    assert.ok(placed.metrics.dRef >= minReferenceDispersion(n));
    assert.ok(placed.metrics.sFmtMax >= minFormatSeparation(n));
  }
});

test('입력 순서가 달라도 출력이 바이트 동일하다', () => {
  const occupied = [{ i: 2, j: 2 }, { i: 3, j: 2 }, { i: 2, j: 3 }, { i: 0, j: 0 }];
  const a = placeReservedCells(21, occupied);
  const b = placeReservedCells(21, occupied.slice().reverse());
  const c = placeReservedCells(21, ['0,0', [2, 3], { i: 3, j: 2 }, { i: 2, j: 2 }]);
  assert.equal(placementKey(a), placementKey(b));
  assert.equal(placementKey(a), placementKey(c));
});

test('v1r2 · v2 칠한 셀과 format/reference 교집합이 0 이다', () => {
  for (const id of [CELL_SURFACE_LAYOUT_V1R2, CELL_SURFACE_LAYOUT_V2]) {
    const layout = cellSurfaceLayout(id);
    const painted = layout.paintedCells || layout.locatorCells;
    const placed = placeReservedCells(21, painted);
    const occ = setOf(painted);
    for (const cell of placed.formatCells.concat(placed.referenceCells)) {
      assert.equal(occ.has(key(cell)), false, id + ' overlap ' + key(cell));
    }
    assert.equal(placed.formatCells.length, 15);
    assert.equal(placed.referenceCells.length, 12);
    assert.ok(placed.metrics.dRef >= minReferenceDispersion(21), id + ' D_ref');
    assert.ok(placed.metrics.sFmtMax >= minFormatSeparation(21), id + ' S_fmt');
  }
});

test('v2r2 n=11 (TL 4×4 + BR 7×7) 은 SE 사분면에 레퍼런스를 못 둔다', () => {
  const occupied = v2r2Occupied();
  assert.equal(occupied.length, 65);
  assert.throws(
    () => placeReservedCells(11, occupied),
    (err) => err instanceof AutoplaceError && err.code === AUTOPLACE_REF_QUADRANT,
  );
});

test('같은 65셀을 n=21 에 두면 4조 분산이 성립한다', () => {
  const placed = placeReservedCells(21, v2r2Occupied());
  assert.equal(placed.formatCells.length, 15);
  assert.equal(placed.referenceCells.length, 12);
  const occ = setOf(v2r2Occupied());
  for (const cell of placed.formatCells.concat(placed.referenceCells)) {
    assert.equal(occ.has(key(cell)), false);
  }
  assert.ok(placed.metrics.dRef >= minReferenceDispersion(21));
});

test('셀 1개 토글 민감도 — 빈 격자 n=21', () => {
  const base = placeReservedCells(21, []);
  let maxMoved = 0;
  let sumMoved = 0;
  let count = 0;
  for (let i = 0; i < 21; i += 1) {
    for (let j = 0; j < 21; j += 1) {
      const next = placeReservedCells(21, [{ i, j }]);
      const moved = movedReservedCount(base, next);
      if (moved > maxMoved) maxMoved = moved;
      sumMoved += moved;
      count += 1;
    }
  }
  const mean = sumMoved / count;
  assert.ok(maxMoved <= 6, 'max moved ' + maxMoved);
  assert.ok(mean <= 1, 'mean moved ' + mean);
  // 테스트 파일에서 보고용으로 노출
  placeReservedCells._sensitivityEmpty21 = { maxMoved, mean, count };
});

test('셀 1개 토글 민감도 — v1r2 · v2 칠한 집합', () => {
  const report = {};
  for (const id of [CELL_SURFACE_LAYOUT_V1R2, CELL_SURFACE_LAYOUT_V2]) {
    const painted = paintedFromLayout(id);
    const base = placeReservedCells(21, painted);
    let maxMoved = 0;
    let sumMoved = 0;
    let feasible = 0;
    let infeasible = 0;
    const tryPlace = (occupied) => {
      try {
        return placeReservedCells(21, occupied);
      } catch (error) {
        if (error && error.name === 'AutoplaceError') return null;
        throw error;
      }
    };
    for (const cell of painted) {
      const nextOcc = painted.filter((item) => item.i !== cell.i || item.j !== cell.j);
      const next = tryPlace(nextOcc);
      if (!next) {
        infeasible += 1;
        continue;
      }
      const moved = movedReservedCount(base, next);
      if (moved > maxMoved) maxMoved = moved;
      sumMoved += moved;
      feasible += 1;
    }
    for (const cell of base.formatCells.concat(base.referenceCells)) {
      const next = tryPlace(painted.concat([cell]));
      if (!next) {
        infeasible += 1;
        continue;
      }
      const moved = movedReservedCount(base, next);
      if (moved > maxMoved) maxMoved = moved;
      sumMoved += moved;
      feasible += 1;
    }
    const mean = feasible === 0 ? NaN : sumMoved / feasible;
    report[id] = { maxMoved, mean, feasible, infeasible, painted: painted.length };
    assert.ok(feasible > 0, id + ' 측정 가능한 토글이 없다');
    assert.ok(maxMoved <= 15, id + ' max moved ' + maxMoved);
  }
  placeReservedCells._sensitivityPainted = report;
});
