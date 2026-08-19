/**
 * finder-daehan-a.test.js — Type A + daehan (2026-08-19).
 *
 * 전제 (값으로 잠근다): A 육각 코어 == O 좌표, daehan 셀은 패치 0개.
 * 왕복은 decodeCells 만이 아니라 decodeFrontend 다 (검출 손실 0 / 왕복 실패 사고).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { regionCells } from '../src/hexgrid.js';
import { regionCellsA, patchOfA, vertexAnchors, patchReferenceCells, roleOfA, buildRoleSetsA } from '../src/placementA.js';
import { dataCellsInScanOrder } from '../src/layout.js';
import { dataCellsInScanOrderA, fillerCellsA, layoutMapA } from '../src/layoutA.js';
import { hexDistance } from '../src/hexgrid.js';
import {
  DAEHAN_RADII, daehanFinderCellsFor, daehanReservedCells, daehanPatternId,
} from '../src/finder-daehan.js';
import {
  VERSIONS_A, VERSIONS_A_DAEHAN, NSYM_TABLE_A, NSYM_TABLE_A_DAEHAN,
  overheadBreakdownA, capacityForA, capacityForADaehan,
} from '../src/capacityA.js';
import { encodeA } from '../src/encodeA.js';
import { decodeCells } from '../src/decode.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { UNVERIFIED_CELL_FINDER_CALIBRATION } from '../src/decoder/cell-finder-detect.js';

const key = (c) => c.q + ',' + c.r;
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

test('게이트를 한 값도 안 내린다', () => {
  assert.equal(UNVERIFIED_CELL_FINDER_CALIBRATION.minCorrelation, 0.56);
  assert.equal(UNVERIFIED_CELL_FINDER_CALIBRATION.minContrastRatio, 0.24);
  assert.equal(UNVERIFIED_CELL_FINDER_CALIBRATION.minOrientationMargin, 0.035);
});

test('A 육각 코어는 O 와 좌표·순서가 같다 — daehan 좌표 재사용의 전제', () => {
  for (const k of DAEHAN_RADII) {
    const hex = regionCells(k);
    const a = regionCellsA(k);
    assert.equal(a.slice(0, hex.length).map(key).join('|'), hex.map(key).join('|'),
      'k=' + k + ': A 접두가 O regionCells 와 다르다');
    const scanO = dataCellsInScanOrder(k);
    const scanA = dataCellsInScanOrderA(k);
    assert.equal(scanA.slice(0, scanO.length).map(key).join('|'), scanO.map(key).join('|'),
      'k=' + k + ': scan-A 접두가 scan-O 와 다르다');
  }
});

test('daehan 셀은 전 k 에서 A 패치에 0개 · 육각 밖 0개', () => {
  for (const k of DAEHAN_RADII) {
    const alive = daehanFinderCellsFor(k);
    const inPatch = alive.filter((c) => patchOfA(c.q, c.r, k) !== null);
    const outsideHex = alive.filter((c) => hexDistance(c.q, c.r) > k);
    assert.equal(inPatch.length, 0, 'k=' + k + ' 패치 침범 ' + inPatch.map(key));
    assert.equal(outsideHex.length, 0, 'k=' + k + ' 육각 밖 ' + outsideHex.map(key));
  }
});

test('예약 셀은 A 의 꼭짓점·패치레퍼런스와 안 겹치고 원래 data 다', () => {
  for (const k of DAEHAN_RADII) {
    const reserved = daehanReservedCells(k);
    const vertex = new Set(vertexAnchors(k).map(key));
    const patchRef = new Set(patchReferenceCells(k).map(key));
    const roles = buildRoleSetsA(k);
    for (const cell of reserved) {
      assert.equal(vertex.has(key(cell)), false, '꼭짓점과 겹침 ' + key(cell));
      assert.equal(patchRef.has(key(cell)), false, '패치 레퍼런스와 겹침 ' + key(cell));
      assert.equal(roleOfA(cell.q, cell.r, k, roles), 'data');
    }
  }
});

test('A daehan 회계 — 오버헤드 74/98/125 · 페이로드 표', () => {
  const EXPECT = {
    A0D: { k: 6, overhead: 74, dataCells: 116, symbols: 38, payload: { L: 30, M: 25, H: 18 } },
    A1D: { k: 8, overhead: 98, dataCells: 227, symbols: 75, payload: { L: 60, M: 49, H: 36 } },
    A2D: { k: 10, overhead: 125, dataCells: 371, symbols: 123, payload: { L: 101, M: 80, H: 60 } },
  };
  assert.equal(VERSIONS_A_DAEHAN.length, 3);
  for (const spec of VERSIONS_A_DAEHAN) {
    const want = EXPECT[spec.name];
    assert.equal(spec.overhead, overheadBreakdownA(spec.k, daehanReservedCells(spec.k).length).total);
    assert.equal(dataCellsInScanOrderA(spec.k, daehanReservedCells(spec.k)).length, want.dataCells);
    assert.equal(fillerCellsA(spec.k, daehanReservedCells(spec.k)).length, 2);
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForADaehan(spec, level);
      assert.equal(cap.maxPayloadBytes, want.payload[level], spec.name + '/' + level);
      assert.equal(cap.daehanFinder, true);
      assert.equal(cap.chunkAligned, true);
      const parent = capacityForA(VERSIONS_A.find((v) => v.version === spec.version), level);
      assert.ok(cap.maxPayloadBytes <= parent.maxPayloadBytes,
        spec.name + '/' + level + ': daehan 이 부모보다 용량이 늘었다');
    }
    assert.ok(!VERSIONS_A.includes(spec), 'VERSIONS_A 에 A daehan spec 이 섞였다');
  }
  // 부모 nsym 승계. A2D/M 만 37→39 (청크 정렬, t 를 안 줄임).
  assert.equal(NSYM_TABLE_A_DAEHAN.A0D.M, NSYM_TABLE_A.A0.M);
  assert.equal(NSYM_TABLE_A_DAEHAN.A1D.M, NSYM_TABLE_A.A1.M);
  assert.equal(NSYM_TABLE_A_DAEHAN.A2D.M, 39);
  assert.equal(NSYM_TABLE_A.A2.M, 37);
});

test('encodeA(daehan) → decodeCells 가 k×ECC 9칸 전부 원문', () => {
  const base = 'A-daehan roundtrip 0123456789 abcdefghijklmnopqrstuvwxyz';
  for (const spec of VERSIONS_A_DAEHAN) {
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForADaehan(spec, level);
      let text = '';
      while (text.length < cap.maxPayloadBytes) text += base;
      text = text.slice(0, cap.maxPayloadBytes);
      const enc = encodeA(text, { version: spec.version, eccLevel: level, daehanFinder: true });
      assert.equal(enc.daehanFinder, true);
      assert.equal(enc.k, spec.k);
      const scan = dataCellsInScanOrderA(spec.k, daehanReservedCells(spec.k));
      const digits = scan.map((c) => enc.cellDigits.get(key(c)).digit);
      const out = decodeCells(digits, {
        type: 'A', daehanFinder: true, k: spec.k, formatIndex: spec.formatIndex, eccLevel: level,
      });
      assert.ok(out.ok, spec.name + '/' + level + ': ' + out.reason);
      assert.equal(out.text, text);
      for (const cell of daehanReservedCells(spec.k)) {
        assert.equal(enc.cellDigits.has(key(cell)), false, spec.name + ' ' + key(cell));
      }
      const map = layoutMapA(spec.k, daehanReservedCells(spec.k));
      assert.equal(
        Array.from(map.values()).filter((e) => e.role === 'finder').length,
        daehanReservedCells(spec.k).length,
      );
    }
  }
});

test('레거시 A 회계로 A daehan digits 를 읽으면 거절한다', () => {
  const enc = encodeA('A daehan wire', { version: 1, eccLevel: 'M', daehanFinder: true });
  const scan = dataCellsInScanOrderA(8, daehanReservedCells(8));
  const digits = scan.map((c) => enc.cellDigits.get(key(c)).digit);
  const out = decodeCells(digits, { type: 'A', k: 8, formatIndex: 12, eccLevel: 'M' });
  assert.equal(out.ok, false, '레거시 A 가 A daehan 을 조용히 받아들였다');
});

test('decodeFrontend 왕복 — A0D/M 옵트인', () => {
  const enc = encodeA('TLcube-A-D', { version: 0, eccLevel: 'M', daehanFinder: true });
  const scene = buildScene(enc, {
    palette: PALETTE, margin: 20, finderPatternId: daehanPatternId(enc.k),
  });
  const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
  assert.equal(decodeFrontend(raster).ok, false);
  const on = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
  assert.equal(on.text, 'TLcube-A-D', on.ok ? '' : on.reason);
});
