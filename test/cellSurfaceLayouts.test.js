/**
 * cellSurfaceLayouts.test.js — v1r2 · v2 데이터 셀 수 불변식과 왕복.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_SURFACE_LAYOUT_DECLARED_DATA,
  CELL_SURFACE_LAYOUT_FORMAT_INDEX,
  CELL_SURFACE_LAYOUT_V1R2,
  CELL_SURFACE_LAYOUT_V2,
  CELL_SURFACE_LEGACY_FORMAT,
  CELL_SURFACE_LEGACY_REFERENCE,
  capacityForCellSurfaceLayout,
  cellSurfaceLayout,
  dataCellsInScanOrderCellSurfaceLayout,
  formatIndexCellSurfaceLayout,
  isCellSurfaceLayoutFormatIndex,
  layoutIdFromFormatIndex,
  locatorCellsCellSurfaceLayout,
  usedCubeFormatIndices,
} from '../src/cellSurfaceLayouts.js';
import { encodeY } from '../src/encodeY.js';
import { decodeCells } from '../src/decode.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  UNVERIFIED_CELL_SURFACE_Y,
  evaluateCellSurfaceGeometry,
} from '../src/decoder/cellSurfaceY-detect.js';
import { extractCellSurfaceProbe } from '../src/lab-telemetry.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { verifyRasterY } from '../src/verifyY.js';
import { layoutForCube, moduleCenter, YFACES } from '../src/ygrid.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});

test('선언 data 는 441 − painted − 12 − 15 와 같고 다시 깎지 않는다', () => {
  const used = usedCubeFormatIndices();
  for (const id of [CELL_SURFACE_LAYOUT_V1R2, CELL_SURFACE_LAYOUT_V2]) {
    const layout = cellSurfaceLayout(id);
    const declared = CELL_SURFACE_LAYOUT_DECLARED_DATA[id];
    assert.equal(layout.declaredDataCells, declared);
    assert.equal(layout.paintedCount, layout.locatorCount);
    assert.equal(
      21 * 21 - layout.paintedCount - CELL_SURFACE_LEGACY_REFERENCE - CELL_SURFACE_LEGACY_FORMAT,
      declared,
    );
    assert.equal(layout.referenceCells.length, 12);
    assert.equal(layout.formatCells.length, 15);
    assert.equal(dataCellsInScanOrderCellSurfaceLayout(id).length, declared);
    const fi = CELL_SURFACE_LAYOUT_FORMAT_INDEX[id];
    assert.equal(fi[3], fi[2] + 2);
    assert.ok(!used.includes(fi[2]));
    assert.ok(!used.includes(fi[3]));
    assert.ok(![12, 14].includes(fi[2]));
    assert.ok(![12, 14].includes(fi[3]));
    assert.equal(layoutIdFromFormatIndex(fi[2]), id);
    assert.equal(formatIndexCellSurfaceLayout(id, 2), fi[2]);
    assert.ok(isCellSurfaceLayoutFormatIndex(fi[2]));
  }
  assert.equal(CELL_SURFACE_LAYOUT_DECLARED_DATA.v1r2, 334);
  assert.equal(CELL_SURFACE_LAYOUT_DECLARED_DATA.v2, 306);
  assert.equal(cellSurfaceLayout('v1r2').locatorCount, 80);
  assert.equal(cellSurfaceLayout('v1r2').userNonDataCount, 62);
  assert.equal(cellSurfaceLayout('v2').locatorCount, 108);
  assert.equal(cellSurfaceLayout('v2').userNonDataCount, 88);
});

test('locator 는 유도된 reference/format 과 겹치지 않는다', () => {
  for (const id of [CELL_SURFACE_LAYOUT_V1R2, CELL_SURFACE_LAYOUT_V2]) {
    const layout = cellSurfaceLayout(id);
    const ref = new Set(layout.referenceCells.map((c) => c.i + ',' + c.j));
    const fmt = new Set(layout.formatCells.map((c) => c.i + ',' + c.j));
    for (const cell of layout.locatorCells) {
      const key = cell.i + ',' + cell.j;
      assert.equal(ref.has(key), false, id + ' locator∩reference ' + key);
      assert.equal(fmt.has(key), false, id + ' locator∩format ' + key);
    }
  }
});

test('칠한 셀 전체가 cellDigits 에서 레이아웃 톤을 갖는다', () => {
  for (const id of [CELL_SURFACE_LAYOUT_V1R2, CELL_SURFACE_LAYOUT_V2]) {
    const layout = cellSurfaceLayout(id);
    const encoded = encodeY('tone-guard-' + id, {
      cellSurfaceLayout: id, tones: 2, eccLevel: 'M', version: 1,
    });
    assert.equal(layout.paintedCount, layout.locatorCount);
    for (const cell of layout.paintedCells) {
      const entry = encoded.cellDigits.get(cell.i + ',' + cell.j);
      assert.ok(entry, id + ' missing ' + cell.i + ',' + cell.j);
      assert.equal(entry.role, 'locator', id + ' role ' + cell.i + ',' + cell.j);
      const locator = layout.locatorCells.find((item) => item.i === cell.i && item.j === cell.j);
      assert.equal(entry.tones.T, locator.T);
      assert.equal(entry.tones.L, locator.L);
      assert.equal(entry.tones.R, locator.R);
    }
    for (const cell of layout.formatCells.concat(layout.referenceCells)) {
      const entry = encoded.cellDigits.get(cell.i + ',' + cell.j);
      assert.notEqual(entry.role, 'locator');
    }
  }
});

function renderLayout(text, layout, tones) {
  const encoded = encodeY(text, {
    cellSurfaceLayout: layout, tones, eccLevel: 'M', version: 1,
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 8 });
  const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 1 });
  return { encoded, scene, raster };
}

test('v1r2 · v2 인코더 셀 맵이 441 을 채우고 선언 data 를 지킨다', () => {
  for (const id of [CELL_SURFACE_LAYOUT_V1R2, CELL_SURFACE_LAYOUT_V2]) {
    const encoded = encodeY('layout-map', {
      cellSurfaceLayout: id, tones: 2, eccLevel: 'M', version: 1,
    });
    assert.equal(encoded.cellDigits.size, 441);
    assert.equal(encoded.capacity.dataCells, CELL_SURFACE_LAYOUT_DECLARED_DATA[id]);
    assert.equal(encoded.cellSurfaceLayout, id);
    const roles = { locator: 0, reference: 0, format: 0, data: 0, filler: 0 };
    for (const entry of encoded.cellDigits.values()) roles[entry.role] += 1;
    assert.equal(roles.locator, cellSurfaceLayout(id).locatorCount);
    assert.equal(roles.reference, 12);
    assert.equal(roles.format, 15);
    assert.equal(roles.data + roles.filler, CELL_SURFACE_LAYOUT_DECLARED_DATA[id]);
  }
});

test('v1r2 · v2 2톤·3톤 digits 왕복', () => {
  for (const id of [CELL_SURFACE_LAYOUT_V1R2, CELL_SURFACE_LAYOUT_V2]) {
    for (const tones of [2, 3]) {
      const text = 'rt-' + id + '-' + tones;
      const encoded = encodeY(text, {
        cellSurfaceLayout: id, tones, eccLevel: 'M', version: 1,
      });
      const digits = [];
      for (const cell of dataCellsInScanOrderCellSurfaceLayout(id)) {
        const entry = encoded.cellDigits.get(cell.i + ',' + cell.j);
        digits.push(entry.digit);
      }
      const decoded = decodeCells(digits, {
        type: 'Y',
        n: 21,
        tones,
        formatIndex: encoded.formatIndex,
        cellSurface: true,
        cellSurfaceLayout: id,
        eccLevel: 'M',
      });
      assert.equal(decoded.ok, true, decoded.reason);
      assert.equal(decoded.text, text);
    }
  }
});

test('v1r2 · v2 렌더 자체 검증', () => {
  for (const id of [CELL_SURFACE_LAYOUT_V1R2, CELL_SURFACE_LAYOUT_V2]) {
    for (const tones of [2, 3]) {
      const { encoded, raster, scene } = renderLayout('vrf-' + id + tones, id, tones);
      const report = verifyRasterY(raster, scene, encoded, { palette: PALETTE });
      assert.equal(report.mismatches.length, 0, id + ' tones=' + tones);
      assert.ok(report.matched > 0);
    }
  }
});

test('v1r2 frontend 왕복 (2톤 ppu10) — 명시 옵션(법의학 경로)으로만', { timeout: 30_000 }, () => {
  // 2026-08-15 라인업 확정: 초안(v1r2/v2)은 디코더 기본 경로에서 내렸다.
  // 배포 출력물 복호는 cellSurfaceLayout 명시 옵션으로 유지된다.
  const text = 'fe-v1r2';
  const { raster } = renderLayout(text, CELL_SURFACE_LAYOUT_V1R2, 2);
  const result = decodeFrontend(raster, {
    bootstrap: {
      family: {
        cube: { enableCellSurfaceY: true, cellSurfaceLayout: CELL_SURFACE_LAYOUT_V1R2 },
      },
    },
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.text, text);
  assert.equal(result.hypothesis.cellSurfaceLayout, CELL_SURFACE_LAYOUT_V1R2);
  assert.equal(result.hypothesis.rotationDegrees, 0, '0° 입력은 0° 로 보고해야 한다');

  // 기본 경로(옵션 없음)는 초안을 더 이상 수용하지 않는다.
  const byDefault = decodeFrontend(raster, {
    bootstrap: { family: { cube: { enableCellSurfaceY: true } } },
  });
  assert.notEqual(
    byDefault.ok === true
      && byDefault.hypothesis
      && byDefault.hypothesis.cellSurfaceLayout === CELL_SURFACE_LAYOUT_V1R2,
    true,
    '기본 경로가 초안 v1r2 를 수용했다 — 라인업 차단이 풀렸다',
  );
});

const PLUS120 = Object.freeze({ T: 'R', R: 'L', L: 'T' });

function rankingCellsOf(id) {
  return cellSurfaceLayout(id).locatorCells.filter((cell) =>
    cell.T !== cell.L || cell.L !== cell.R || cell.T !== cell.R);
}

function finderClusterOf(id) {
  return cellSurfaceLayout(id).locatorCells.filter((cell) => cell.i >= 14 && cell.j >= 14);
}

function occupancyHamming(cells) {
  const occupancy = new Set();
  for (const cell of cells) {
    for (const face of YFACES) occupancy.add(face + ':' + cell.i + ',' + cell.j);
  }
  let ham = 0;
  for (const cell of cells) {
    for (const face of YFACES) {
      if (!occupancy.has(PLUS120[face] + ':' + cell.i + ',' + cell.j)) ham += 1;
    }
  }
  return ham;
}

function faceCycleFaceHamming(cells, cycle) {
  let ham = 0;
  for (const cell of cells) {
    if (cell[cycle[0]] !== cell.T) ham += 1;
    if (cell[cycle[1]] !== cell.L) ham += 1;
    if (cell[cycle[2]] !== cell.R) ham += 1;
  }
  return ham;
}

function idealSampleCell(layoutId, cycle = ['T', 'L', 'R']) {
  const table = locatorCellsCellSurfaceLayout(layoutId);
  const byKey = new Map(table.map((cell) => [cell.i + ',' + cell.j, cell]));
  return (i, j) => {
    const cell = byKey.get(i + ',' + j);
    if (!cell) return { i, j, ok: false };
    return {
      i,
      j,
      ok: true,
      T: { median: cell[cycle[0]] === 0 ? 0.08 : 0.82 },
      L: { median: cell[cycle[1]] === 0 ? 0.08 : 0.82 },
      R: { median: cell[cycle[2]] === 0 ? 0.08 : 0.82 },
    };
  };
}

function rotatePoint(point, deg, origin) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return { x: origin.x + c * dx - s * dy, y: origin.y + s * dx + c * dy };
}

test('v2 파인더 배치는 120° 사상에서 세 회전이 같고 순위 게이트를 통과하지 못한다', () => {
  const v2 = cellSurfaceLayout(CELL_SURFACE_LAYOUT_V2);
  const ranking = rankingCellsOf(CELL_SURFACE_LAYOUT_V2);
  const finder = finderClusterOf(CELL_SURFACE_LAYOUT_V2);
  assert.equal(v2.locatorCount, 108);
  assert.equal(ranking.length, 3);
  assert.deepEqual(
    ranking.map((cell) => [cell.i, cell.j, cell.T, cell.L, cell.R]),
    [[0, 3, 0, 0, 2], [1, 3, 0, 0, 2], [2, 3, 0, 0, 2]],
  );
  assert.equal(v2.locatorCells.some((cell) => cell.i === 1 && cell.j === 3), true);
  assert.equal(v2.locatorCells.some((cell) => cell.i === 2 && cell.j === 3), true);
  assert.equal(finder.length, 49);
  assert.ok(finder.every((cell) => cell.T === cell.L && cell.L === cell.R));
  assert.equal(occupancyHamming(v2.locatorCells), 0);
  assert.equal(occupancyHamming(finder), 0);
  assert.equal(faceCycleFaceHamming(finder, ['L', 'R', 'T']), 0);
  assert.equal(faceCycleFaceHamming(finder, ['R', 'T', 'L']), 0);
  assert.equal(faceCycleFaceHamming(v2.locatorCells, ['L', 'R', 'T']), 6);
  const margin = 6 / (v2.locatorCount * 3);
  assert.ok(Math.abs(margin - 6 / 324) < 1e-12);
  assert.ok(margin < UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin);

  const cube = layoutForCube(21, { size: 1, margin: 0 });
  const origin = { x: cube.originX, y: cube.originY };
  const centroids = {};
  for (const face of YFACES) {
    let sx = 0;
    let sy = 0;
    for (const cell of finder) {
      const point = moduleCenter(face, cell.i, cell.j, cube);
      sx += point.x;
      sy += point.y;
    }
    centroids[face] = { x: sx / finder.length, y: sy / finder.length };
  }
  const tToR = Math.hypot(
    rotatePoint(centroids.T, 120, origin).x - centroids.R.x,
    rotatePoint(centroids.T, 120, origin).y - centroids.R.y,
  );
  const rToL = Math.hypot(
    rotatePoint(centroids.R, 120, origin).x - centroids.L.x,
    rotatePoint(centroids.R, 120, origin).y - centroids.L.y,
  );
  const lToT = Math.hypot(
    rotatePoint(centroids.L, 120, origin).x - centroids.T.x,
    rotatePoint(centroids.L, 120, origin).y - centroids.T.y,
  );
  assert.ok(tToR < 1e-9 && rToL < 1e-9 && lToT < 1e-9);

  const v1 = rankingCellsOf(CELL_SURFACE_LAYOUT_V1R2);
  assert.equal(v1.length, 18);
  const v1Margin = (18 * 2) / (cellSurfaceLayout(CELL_SURFACE_LAYOUT_V1R2).locatorCount * 3);
  assert.ok(v1Margin >= UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin);
});

test('v2 이상적 표본은 정방향도 방향 게이트에 걸린다', () => {
  const canon = evaluateCellSurfaceGeometry(
    { n: 21 },
    idealSampleCell(CELL_SURFACE_LAYOUT_V2),
    { cellSurfaceLayout: CELL_SURFACE_LAYOUT_V2 },
  );
  assert.equal(canon.ok, true);
  assert.equal(canon.accepted, false);
  assert.equal(canon.diagnostics.rejectReason, 'orientation-margin');
  assert.equal(canon.diagnostics.orientationGate, 'applied');
  assert.equal(canon.diagnostics.agreement, 1);
  assert.ok(canon.diagnostics.orientationMargin < UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin);

  for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
    const wrong = evaluateCellSurfaceGeometry(
      { n: 21 },
      idealSampleCell(CELL_SURFACE_LAYOUT_V2, cycle),
      { cellSurfaceLayout: CELL_SURFACE_LAYOUT_V2 },
    );
    assert.equal(wrong.accepted, false);
    assert.equal(wrong.diagnostics.rejectReason, 'orientation-margin');
    assert.ok(wrong.diagnostics.agreement >= UNVERIFIED_CELL_SURFACE_Y.minimumAgreement);
  }

  const v1 = evaluateCellSurfaceGeometry(
    { n: 21 },
    idealSampleCell(CELL_SURFACE_LAYOUT_V1R2),
    { cellSurfaceLayout: CELL_SURFACE_LAYOUT_V1R2 },
  );
  assert.equal(v1.accepted, true);
  assert.ok(v1.diagnostics.orientationMargin >= UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin);
});

test('v2 초안은 배치로 방향을 못 정하고 0° frontend 왕복에 실패한다', { timeout: 30_000 }, () => {
  // 2026-08-15 라인업 확정 이후 초안은 명시 옵션으로만 산다 — 이 역사적 결함
  // 기록(orientation-margin 거부)은 그 경로에서 그대로 재현돼야 한다.
  const text = 'fe-v2';
  const { raster } = renderLayout(text, CELL_SURFACE_LAYOUT_V2, 2);
  const result = decodeFrontend(raster, {
    bootstrap: {
      family: {
        cube: { enableCellSurfaceY: true, cellSurfaceLayout: CELL_SURFACE_LAYOUT_V2 },
      },
    },
  });
  assert.equal(result.ok, false, 'v2 가 방향을 정하면 이 단언을 뒤집고 왕복을 고정하라');
  assert.equal(result.reason, 'frontend:no-format-candidate');
  const probe = extractCellSurfaceProbe(result);
  assert.equal(probe.attempted, true);
  assert.equal(probe.accepted, false);
  assert.equal(probe.layoutId, CELL_SURFACE_LAYOUT_V2);
  assert.equal(probe.reason, 'orientation-margin');
  assert.equal(probe.orientationGate, 'applied');
  assert.equal(probe.orientationGateApplied, true);
  assert.equal(probe.score, 1);
});
