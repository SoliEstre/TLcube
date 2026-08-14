/**
 * cellSurfaceY.test.js — cell-surface-v1 계약: 좌표·톤·역할·용량·결정성.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_EDITOR_SCHEMA,
  CELL_SURFACE_DATA_CELLS,
  CELL_SURFACE_FORMAT_CELLS,
  CELL_SURFACE_FORMAT_INDEX,
  CELL_SURFACE_FORMAT_INDEX_2T,
  CELL_SURFACE_FORMAT_INDEX_3T,
  CELL_SURFACE_LOCATOR_CELLS,
  CELL_SURFACE_LOCATOR_COUNT,
  CELL_SURFACE_N,
  CELL_SURFACE_PROFILE_ID,
  CELL_SURFACE_RESIDUAL_CELLS,
  CELL_SURFACE_USED_SYMBOLS,
  CELL_SURFACE_USER_NON_DATA,
  NSYM_TABLE_CELL_SURFACE_Y,
  canonicalCellEditorDocument,
  capacityForCellSurfaceY,
  dataCellsInScanOrderCellSurface,
  formatCellsCellSurface,
  formatIndexCellSurface,
  isCellSurfaceLocator,
  locatorTone,
  nameCellSurface,
  roleOfCellSurface,
  usedCubeFormatIndices,
} from '../src/cellSurfaceY.js';
import { encodeY } from '../src/encodeY.js';
import { decodeCells } from '../src/decode.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { verifyRasterY } from '../src/verifyY.js';
import { sceneToSvg } from '../src/svg.js';
import { rasterToPng } from '../src/png.js';
import { maskAdd } from '../src/mask.js';
import { VERSIONS_Y } from '../src/capacityY.js';
import { formatCells, referenceCellsAll } from '../src/placementY.js';
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

function key(i, j) {
  return i + ',' + j;
}

test('프로파일 id 와 cube format index 12/14 가 비어 있고 +2 불변식을 지킨다', () => {
  assert.equal(CELL_SURFACE_PROFILE_ID, 'cell-surface-v1');
  assert.deepEqual([...usedCubeFormatIndices()], [0, 2, 8, 9, 10, 11]);
  assert.equal(CELL_SURFACE_FORMAT_INDEX_2T, 12);
  assert.equal(CELL_SURFACE_FORMAT_INDEX_3T, 14);
  assert.equal(CELL_SURFACE_FORMAT_INDEX, 12);
  assert.equal(CELL_SURFACE_FORMAT_INDEX_3T, CELL_SURFACE_FORMAT_INDEX_2T + 2);
  assert.equal(formatIndexCellSurface(2), 12);
  assert.equal(formatIndexCellSurface(3), 14);
  assert.equal(nameCellSurface(2), 'Y1-CS');
  assert.equal(nameCellSurface(3), 'Y1T-CS');
  assert.equal(VERSIONS_Y.some((spec) => spec.formatIndex === 12), false);
  assert.equal(VERSIONS_Y.some((spec) => spec.formatIndex === 14), false);
});

test('locator 61좌표·톤이 사용자 정본과 같다', () => {
  assert.equal(CELL_SURFACE_LOCATOR_CELLS.length, CELL_SURFACE_LOCATOR_COUNT);
  assert.equal(CELL_SURFACE_USER_NON_DATA.length, 47);
  const coords = CELL_SURFACE_LOCATOR_CELLS.map((c) => key(c.i, c.j));
  assert.equal(new Set(coords).size, 61);
  assert.equal(locatorTone('T', 0, 0), 0);
  assert.equal(locatorTone('L', 0, 0), 0);
  assert.equal(locatorTone('R', 0, 0), 0);
  assert.equal(locatorTone('T', 0, 3), 0);
  assert.equal(locatorTone('L', 0, 3), 0);
  assert.equal(locatorTone('R', 0, 3), 2);
  assert.equal(locatorTone('T', 1, 3), 0);
  assert.equal(locatorTone('R', 1, 3), 2);
  assert.equal(locatorTone('T', 2, 3), 0);
  assert.equal(locatorTone('R', 2, 3), 2);
  for (const cell of CELL_SURFACE_LOCATOR_CELLS) {
    assert.equal(cell.T, cell.L);
    const asymmetric = (cell.i === 0 || cell.i === 1 || cell.i === 2) && cell.j === 3;
    assert.equal(cell.R, asymmetric ? 2 : cell.T);
  }
});

test('편집기 JSON 정본과 프로파일 상수가 같다', () => {
  const doc = canonicalCellEditorDocument();
  assert.equal(doc.schema, CELL_EDITOR_SCHEMA);
  assert.equal(doc.n, 21);
  assert.equal(doc.userNonData.length, 47);
  assert.equal(doc.toneOverrides.length, 183);
  assert.equal(doc.counts.userNonData, 47);
  const userKeys = new Set(doc.userNonData.map((c) => key(c.i, c.j)));
  for (const cell of CELL_SURFACE_USER_NON_DATA) {
    assert.ok(userKeys.has(key(cell.i, cell.j)), key(cell.i, cell.j));
  }
});

test('format 15셀이 locator 와 안 겹치고 세 복제가 분산된다', () => {
  const cells = formatCellsCellSurface();
  assert.equal(cells.length, 15);
  assert.deepEqual(cells.slice(0, 5), [
    { i: 8, j: 6 }, { i: 9, j: 6 }, { i: 10, j: 6 }, { i: 11, j: 6 }, { i: 12, j: 6 },
  ]);
  assert.deepEqual(cells.slice(5, 10), [
    { i: 6, j: 8 }, { i: 6, j: 9 }, { i: 6, j: 10 }, { i: 6, j: 11 }, { i: 6, j: 12 },
  ]);
  assert.deepEqual(cells.slice(10, 15), [
    { i: 8, j: 14 }, { i: 9, j: 14 }, { i: 10, j: 14 }, { i: 11, j: 14 }, { i: 12, j: 14 },
  ]);
  for (const cell of cells) {
    assert.equal(isCellSurfaceLocator(cell.i, cell.j), false);
    assert.equal(roleOfCellSurface(cell.i, cell.j), 'format');
  }
});

test('현행 Y1T reference/format 14좌표가 locator 와 겹친다', () => {
  const overlap = new Set();
  for (const cell of [...referenceCellsAll(21, 3), ...formatCells(21)]) {
    if (isCellSurfaceLocator(cell.i, cell.j)) overlap.add(key(cell.i, cell.j));
  }
  assert.equal(overlap.size, 14);
});

test('역할 회계 data=365 symbols=121 residual=2', () => {
  const scan = dataCellsInScanOrderCellSurface();
  assert.equal(scan.length, CELL_SURFACE_DATA_CELLS);
  assert.equal(Math.floor(scan.length / 3), CELL_SURFACE_USED_SYMBOLS);
  assert.equal(scan.length % 3, CELL_SURFACE_RESIDUAL_CELLS);
  assert.equal(NSYM_TABLE_CELL_SURFACE_Y.L, 15);
  assert.equal(NSYM_TABLE_CELL_SURFACE_Y.M, 31);
  assert.equal(NSYM_TABLE_CELL_SURFACE_Y.H, 48);
});

test('ECC/용량은 BigInt 재사용이며 톤 모드와 무관하다', () => {
  const two = capacityForCellSurfaceY('M', 2);
  const three = capacityForCellSurfaceY('M', 3);
  assert.equal(two.dataCells, 365);
  assert.equal(two.usedSymbols, 121);
  assert.equal(two.nsym, 31);
  assert.equal(two.dataSymbols, 90);
  assert.equal(two.dataBytes, 86);
  assert.equal(two.maxPayloadBytes, 85);
  assert.equal(two.formatIndex, 12);
  assert.equal(two.name, 'Y1-CS');
  assert.equal(two.tones, 2);
  assert.equal(three.dataCells, two.dataCells);
  assert.equal(three.usedSymbols, two.usedSymbols);
  assert.equal(three.nsym, two.nsym);
  assert.equal(three.dataSymbols, two.dataSymbols);
  assert.equal(three.dataBytes, two.dataBytes);
  assert.equal(three.maxPayloadBytes, two.maxPayloadBytes);
  assert.equal(three.formatIndex, 14);
  assert.equal(three.name, 'Y1T-CS');
  assert.equal(three.tones, 3);
  assert.equal(capacityForCellSurfaceY('L', 2).maxPayloadBytes, 101);
  assert.equal(capacityForCellSurfaceY('H', 3).maxPayloadBytes, 69);
  assert.equal(capacityForCellSurfaceY('M').formatIndex, 12);
});

test('encodeY 기본 호출은 cell-surface 와 1바이트도 같지 않게 분리된다', () => {
  const text = 'https://tl.estre.so';
  const legacy = encodeY(text, { version: 1, tones: 3, eccLevel: 'M' });
  const surface2 = encodeY(text, { version: 1, tones: 2, eccLevel: 'M', cellSurface: true });
  const surface3 = encodeY(text, { version: 1, tones: 3, eccLevel: 'M', cellSurface: true });
  const surfaceDefault = encodeY(text, { cellSurface: true, eccLevel: 'M' });
  assert.equal(legacy.cellSurface, undefined);
  assert.equal(legacy.formatIndex, 10);
  assert.equal(legacy.capacity.dataCells, 414);
  assert.equal(surface2.cellSurface, true);
  assert.equal(surface2.tones, 2);
  assert.equal(surface2.formatIndex, 12);
  assert.equal(surface2.capacity.name, 'Y1-CS');
  assert.equal(surface3.cellSurface, true);
  assert.equal(surface3.tones, 3);
  assert.equal(surface3.formatIndex, 14);
  assert.equal(surface3.capacity.name, 'Y1T-CS');
  assert.equal(surfaceDefault.tones, 2);
  assert.equal(surfaceDefault.formatIndex, 12);
  assert.equal(surface2.capacity.dataCells, 365);
  assert.equal(surface3.capacity.dataCells, 365);
  assert.equal(surface2.cellDigits.size, 441);
  const locators = [...surface3.cellDigits.values()].filter((e) => e.role === 'locator');
  const formats = [...surface3.cellDigits.values()].filter((e) => e.role === 'format');
  const data = [...surface3.cellDigits.values()].filter((e) => e.role === 'data');
  const filler = [...surface3.cellDigits.values()].filter((e) => e.role === 'filler');
  assert.equal(locators.length, 61);
  assert.equal(formats.length, 15);
  assert.equal(data.length, 363);
  assert.equal(filler.length, 2);
  assert.equal(legacy.cellDigits.get('0,0').role, 'data');
  assert.equal(surface2.cellDigits.get('0,0').role, 'locator');
  assert.deepEqual(surface2.cellDigits.get('0,0').tones, surface3.cellDigits.get('0,0').tones);
});

test('cell-surface encode → decodeCells 왕복 (2톤·3톤 · 짧은 URL · 경계 payload)', () => {
  const cases = [
    { text: 'https://tl.estre.so', ecc: 'M', tones: 2 },
    { text: 'https://tl.estre.so', ecc: 'M', tones: 3 },
    { text: 'x', ecc: 'L', tones: 2 },
    { text: 'a'.repeat(85), ecc: 'M', tones: 3 },
  ];
  for (const item of cases) {
    const encoded = encodeY(item.text, {
      version: 1, tones: item.tones, eccLevel: item.ecc, cellSurface: true,
    });
    const scan = dataCellsInScanOrderCellSurface();
    const digits = scan.map((cell, index) => {
      const entry = encoded.cellDigits.get(key(cell.i, cell.j));
      if (index >= encoded.capacity.usedSymbols * 3) {
        assert.equal(entry.role, 'filler');
        assert.equal(entry.digit, maskAdd(0, cell.i, cell.j));
        return 0;
      }
      assert.equal(entry.role, 'data');
      return entry.digit;
    });
    const decoded = decodeCells(digits, {
      type: 'Y',
      formatIndex: encoded.formatIndex,
      eccLevel: item.ecc,
      n: 21,
      tones: item.tones,
      cellSurface: true,
    });
    assert.equal(decoded.ok, true, decoded.reason);
    assert.equal(decoded.text, item.text);
    const mismatch = decodeCells(digits, {
      type: 'Y',
      formatIndex: item.tones === 2 ? 14 : 12,
      eccLevel: item.ecc,
      n: 21,
      tones: item.tones,
      cellSurface: true,
    });
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.reason, /어긋난다/);
  }
});

test('cell-surface scene 은 61좌표 톤을 그리고 2톤·3톤 모두 왕복한다', () => {
  for (const tones of [2, 3]) {
    const encoded = encodeY('https://tl.estre.so', {
      version: 1, tones, eccLevel: 'M', cellSurface: true,
    });
    const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
    assert.equal(scene.locatorProfile, 'cell-surface-v1');
    assert.equal(scene.shapes.some((shape) => shape.locatorPart === 'hub-c-ring'), false);
    const raster = rasterize(scene, { pixelsPerUnit: 8, supersample: 2 });
    const check = verifyRasterY(raster, scene, encoded);
    assert.equal(check.ok, true, JSON.stringify({
      tones,
      mismatches: check.mismatches.length,
      residual: check.residualGate && check.residualGate.ok,
    }));
  }
});

test('cell-surface PNG/SVG 는 결정적이다', () => {
  const encoded = encodeY('https://tl.estre.so', {
    version: 1, tones: 3, eccLevel: 'M', cellSurface: true,
  });
  const a = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
  const b = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
  const svgA = sceneToSvg(a);
  const svgB = sceneToSvg(b);
  assert.equal(svgA, svgB);
  const pngA = rasterToPng(rasterize(a, { pixelsPerUnit: 8, supersample: 1 }));
  const pngB = rasterToPng(rasterize(b, { pixelsPerUnit: 8, supersample: 1 }));
  assert.deepEqual([...pngA], [...pngB]);
});

test('cell-surface 는 window 및 version≠1 · 불법 톤을 거부한다', () => {
  assert.throws(
    () => encodeY('x', { version: 1, tones: 3, window: true, cellSurface: true }),
    RangeError,
  );
  assert.throws(
    () => encodeY('x', { version: 0, tones: 3, cellSurface: true }),
    RangeError,
  );
  assert.throws(
    () => encodeY('x', { version: 2, tones: 2, cellSurface: true }),
    RangeError,
  );
  assert.throws(
    () => encodeY('x', { version: 1, tones: 4, cellSurface: true }),
    RangeError,
  );
});
