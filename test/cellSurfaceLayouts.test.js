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
  usedCubeFormatIndices,
} from '../src/cellSurfaceLayouts.js';
import { encodeY } from '../src/encodeY.js';
import { decodeCells } from '../src/decode.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { verifyRasterY } from '../src/verifyY.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { formatCells, referenceCellsAll } from '../src/placementY.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});

test('선언 data 는 441 − userNonData − 12 − 15 와 같고 다시 깎지 않는다', () => {
  const used = usedCubeFormatIndices();
  for (const id of [CELL_SURFACE_LAYOUT_V1R2, CELL_SURFACE_LAYOUT_V2]) {
    const layout = cellSurfaceLayout(id);
    const declared = CELL_SURFACE_LAYOUT_DECLARED_DATA[id];
    assert.equal(layout.declaredDataCells, declared);
    assert.equal(
      21 * 21 - layout.locatorCount - CELL_SURFACE_LEGACY_REFERENCE - CELL_SURFACE_LEGACY_FORMAT,
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
  assert.equal(CELL_SURFACE_LAYOUT_DECLARED_DATA.v1r2, 352);
  assert.equal(CELL_SURFACE_LAYOUT_DECLARED_DATA.v2, 326);
  assert.equal(cellSurfaceLayout('v1r2').locatorCount, 62);
  assert.equal(cellSurfaceLayout('v2').locatorCount, 88);
});

test('locator 는 reference/format 과 겹치지 않는다', () => {
  const ref = new Set(referenceCellsAll(21, 2).map((c) => c.i + ',' + c.j));
  const fmt = new Set(formatCells(21).map((c) => c.i + ',' + c.j));
  for (const id of [CELL_SURFACE_LAYOUT_V1R2, CELL_SURFACE_LAYOUT_V2]) {
    for (const cell of cellSurfaceLayout(id).locatorCells) {
      const key = cell.i + ',' + cell.j;
      assert.equal(ref.has(key), false, id + ' locator∩reference ' + key);
      assert.equal(fmt.has(key), false, id + ' locator∩format ' + key);
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

test('v1r2 frontend 왕복 (2톤 ppu10)', { timeout: 30_000 }, () => {
  const text = 'fe-v1r2';
  const { raster } = renderLayout(text, CELL_SURFACE_LAYOUT_V1R2, 2);
  const result = decodeFrontend(raster, {
    bootstrap: { family: { cube: { enableCellSurfaceY: true } } },
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.text, text);
  assert.equal(result.hypothesis.cellSurfaceLayout, CELL_SURFACE_LAYOUT_V1R2);
});

test('v2 초안은 순위 셀이 적어 0° 합성도 방향 게이트에 걸릴 수 있다', { timeout: 30_000 }, () => {
  const { raster } = renderLayout('fe-v2', CELL_SURFACE_LAYOUT_V2, 2);
  const result = decodeFrontend(raster, {
    bootstrap: { family: { cube: { enableCellSurfaceY: true } } },
  });
  if (result.ok === true) {
    assert.equal(result.hypothesis.cellSurfaceLayout, CELL_SURFACE_LAYOUT_V2);
    return;
  }
  assert.ok(
    result.reason === 'frontend:no-format-candidate'
    || result.reason === 'frontend:no-grid-hypothesis',
    result.reason,
  );
});
