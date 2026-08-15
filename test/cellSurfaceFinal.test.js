/**
 * cellSurfaceFinal.test.js — 최종 라인업 (v0 n=13 · v2r2 n=21/25 · v1r2 n=21) 회계·배정·왕복.
 *
 * 라인업 (운영자 확정 2026-08-15): Y0→v0 · Y1/Y2→v2r2. formatIndex 는 신세대
 * 셀 표면 한 쌍(2T=1 · 3T=3)뿐이다.
 * 2026-08-15 밤 추가: v1r2(n=21, 네 코너 블록 80셀)가 **A/B 후보**로 부활 — 같은
 * formatIndex 쌍을 쓰고, n=21 의 기본은 그대로 v2r2 다. 레이아웃 판별은 로케이터
 * 패밀리 + CS 평가 게이트가 한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_SURFACE_FINAL_FORMAT_INDEX,
  CELL_SURFACE_FINAL_IDS,
  CELL_SURFACE_FINAL_NS,
  CELL_SURFACE_FINAL_PROFILE,
  capacityForCellSurfaceFinal,
  cellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  fillerCellsCellSurfaceFinal,
  finalLayoutIdForN,
  finalLayoutIdsForN,
  formatIndexCellSurfaceFinal,
  isCellSurfaceFinalFormatIndex,
  layoutMapCellSurfaceFinal,
  locatorCellsCellSurfaceFinal,
  locatorToneCellSurfaceFinal,
  nameCellSurfaceFinal,
  tonesFromCellSurfaceFinalFormatIndex,
  versionForFinalN,
} from '../src/cellSurfaceFinal.js';
import { VERSIONS_Y } from '../src/capacityY.js';
import {
  CELL_SURFACE_FORMAT_INDEX_2T,
  CELL_SURFACE_FORMAT_INDEX_3T,
} from '../src/cellSurfaceY.js';
import {
  CELL_SURFACE_LAYOUT_FORMAT_INDEX,
  CELL_SURFACE_LAYOUT_IDS,
} from '../src/cellSurfaceLayouts.js';
import { AutoplaceError, placeReservedCells } from '../src/autoplaceY.js';
import { encodeY } from '../src/encodeY.js';
import { decodeCells } from '../src/decode.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { digitToPattern } from '../src/tonemap.js';
import { verifyRasterY } from '../src/verifyY.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import {
  UNVERIFIED_CELL_SURFACE_Y,
  evaluateCellSurfaceGeometry,
} from '../src/decoder/cellSurfaceY-detect.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PAYLOAD = 'https://tl.estre.so';
const LINEUP = Object.freeze([
  { layout: 'v0', version: 0, n: 13 },
  { layout: 'v2r2', version: 1, n: 21 },
  { layout: 'v2r2', version: 2, n: 25 },
]);

test('formatIndex 배정 — 한 쌍 (2T=1 · 3T=3), cube 축 기사용 슬롯과 무충돌', () => {
  assert.deepEqual(CELL_SURFACE_FINAL_FORMAT_INDEX, { 2: 1, 3: 3 });
  assert.equal(formatIndexCellSurfaceFinal(2), 1);
  assert.equal(formatIndexCellSurfaceFinal(3), 3);
  assert.equal(CELL_SURFACE_FINAL_FORMAT_INDEX[3], CELL_SURFACE_FINAL_FORMAT_INDEX[2] + 2);
  assert.equal(tonesFromCellSurfaceFinalFormatIndex(1), 2);
  assert.equal(tonesFromCellSurfaceFinalFormatIndex(3), 3);
  assert.throws(() => tonesFromCellSurfaceFinalFormatIndex(5), RangeError);

  const used = new Set(VERSIONS_Y.map((spec) => spec.formatIndex));
  used.add(CELL_SURFACE_FORMAT_INDEX_2T);
  used.add(CELL_SURFACE_FORMAT_INDEX_3T);
  for (const id of CELL_SURFACE_LAYOUT_IDS) {
    used.add(CELL_SURFACE_LAYOUT_FORMAT_INDEX[id][2]);
    used.add(CELL_SURFACE_LAYOUT_FORMAT_INDEX[id][3]);
  }
  // 감사 결과 고정: cube 축 기사용 = {0,2,4,5,6,7,8,9,10,11,12,14} → 빈 슬롯 {1,3,13,15}.
  assert.deepEqual([...used].sort((a, b) => a - b), [0, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]);
  for (const index of [1, 3]) {
    assert.equal(used.has(index), false, 'formatIndex ' + index + ' 가 이미 사용 중이다');
    assert.equal(isCellSurfaceFinalFormatIndex(index), true);
  }
});

test('n → 기본 레이아웃·버전 (13→v0/Y0 · 21→v2r2/Y1 · 25→v2r2/Y2), n=21 후보는 둘', () => {
  // 2026-08-15 밤 운영자 지시로 v1r2 가 n=21 **A/B 후보**로 부활했다.
  // 기본(default)은 그대로 v2r2 — finalLayoutIdForN 의 반환은 바뀌지 않는다.
  assert.deepEqual([...CELL_SURFACE_FINAL_IDS], ['v0', 'v2r2', 'v1r2']);
  assert.equal(finalLayoutIdForN(13), 'v0');
  assert.equal(finalLayoutIdForN(21), 'v2r2');
  assert.equal(finalLayoutIdForN(25), 'v2r2');
  assert.equal(finalLayoutIdForN(11), null);
  assert.deepEqual([...finalLayoutIdsForN(13)], ['v0']);
  assert.deepEqual([...finalLayoutIdsForN(21)], ['v2r2', 'v1r2']);
  assert.deepEqual([...finalLayoutIdsForN(25)], ['v2r2']);
  assert.deepEqual([...finalLayoutIdsForN(11)], []);
  assert.equal(versionForFinalN(13), 0);
  assert.equal(versionForFinalN(21), 1);
  assert.equal(versionForFinalN(25), 2);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v0], [13]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v2r2], [21, 25]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v1r2], [21]);
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0, 'cell-surface-v0');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v2r2, 'cell-surface-v2r2');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v1r2, 'cell-surface-v1r2');
  // formatIndex 신설 금지 — 세 레이아웃이 한 쌍(2T=1 · 3T=3)을 함께 쓴다.
  assert.equal(formatIndexCellSurfaceFinal(2), 1);
  assert.equal(formatIndexCellSurfaceFinal(3), 3);
});

test('v2r2 파인더는 n=13 에서 autoplace REF_QUADRANT 거부다 — 그래서 v0 가 있다', () => {
  const cells = [];
  for (let i = 0; i <= 3; i += 1) for (let j = 0; j <= 3; j += 1) cells.push({ i, j });
  for (let i = 6; i <= 12; i += 1) for (let j = 6; j <= 12; j += 1) cells.push({ i, j });
  assert.throws(
    () => placeReservedCells(13, cells),
    (error) => error instanceof AutoplaceError && error.code === 'AUTOPLACE_REF_QUADRANT',
  );
});

test('회계 — v0 169−30−27=112 · v2r2@21 441−65−27=349 · v2r2@25 625−65−27=533', () => {
  const want = {
    13: { locator: 30, data: 112, S: 37, residual: 1 },
    21: { locator: 65, data: 349, S: 116, residual: 1 },
    25: { locator: 65, data: 533, S: 177, residual: 2 },
  };
  for (const [n, w] of Object.entries(want).map(([k, v]) => [Number(k), v])) {
    const surface = cellSurfaceFinal(n);
    assert.equal(surface.locatorCount, w.locator, 'n=' + n + ' locator');
    assert.equal(surface.declaredDataCells, w.data, 'n=' + n + ' data');
    assert.equal(surface.usedSymbols, w.S, 'n=' + n + ' S');
    assert.equal(surface.residualCells, w.residual, 'n=' + n + ' 잔여');
    assert.equal(surface.formatCells.length, 15);
    assert.equal(surface.referenceCells.length, 12);
    assert.equal(dataCellsInScanOrderCellSurfaceFinal(n).length, w.data);
    assert.equal(fillerCellsCellSurfaceFinal(n).length, w.residual);
    assert.equal(
      n * n,
      surface.locatorCount + 27 + w.data,
      'n=' + n + ' 총합 회계',
    );
    // autoplace 하한 충족 (placeReservedCells 가 로드 시 throw 로 이미 강제하지만
    // 수치를 회귀로 고정한다).
    assert.ok(surface.autoplace.dRef >= surface.autoplace.dRefMin);
    assert.ok(surface.autoplace.sFmtMax >= surface.autoplace.sFmtMinRequired);
  }
  for (const tones of [2, 3]) {
    assert.equal(capacityForCellSurfaceFinal(13, 'M', tones).name, tones === 3 ? 'Y0T-CS-V0' : 'Y0-CS-V0');
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones).name, tones === 3 ? 'Y1T-CS-V2R2' : 'Y1-CS-V2R2');
    assert.equal(capacityForCellSurfaceFinal(25, 'M', tones).name, tones === 3 ? 'Y2T-CS-V2R2' : 'Y2-CS-V2R2');
  }
  assert.equal(nameCellSurfaceFinal(13, 2), 'Y0-CS-V0');
});

test('회귀 — 칠한 셀 전체가 cellDigits 에서 role=locator 이고 레이아웃 톤을 갖는다', () => {
  for (const { layout, version, n } of LINEUP) {
    for (const tones of [2, 3]) {
      const encoded = encodeY(PAYLOAD, {
        cellSurfaceLayout: layout, version, tones, eccLevel: 'M',
      });
      assert.equal(encoded.n, n);
      const painted = locatorCellsCellSurfaceFinal(n);
      for (const cell of painted) {
        const entry = encoded.cellDigits.get(cell.i + ',' + cell.j);
        assert.ok(entry, layout + '@n=' + n + ': 칠한 셀 (' + cell.i + ',' + cell.j + ') 이 cellDigits 에 없다');
        assert.equal(entry.role, 'locator', layout + '@n=' + n + ' (' + cell.i + ',' + cell.j + ')');
        assert.deepEqual(
          entry.tones,
          { T: cell.T, L: cell.L, R: cell.R },
          layout + '@n=' + n + ' (' + cell.i + ',' + cell.j + ') 레이아웃 톤',
        );
        assert.equal(
          locatorToneCellSurfaceFinal(n, 'T', cell.i, cell.j),
          cell.T,
        );
      }
      // 역방향 — cellDigits 의 locator 역할 수 = 칠한 셀 수 (초과·누락 0).
      let locatorCount = 0;
      for (const [, entry] of encoded.cellDigits) {
        if (entry.role === 'locator') locatorCount += 1;
      }
      assert.equal(locatorCount, painted.length, layout + '@n=' + n + ' locator 수');
      assert.equal(encoded.cellDigits.size, n * n, layout + '@n=' + n + ' 전 셀 배정');
      // 역할 맵과도 일치.
      const map = layoutMapCellSurfaceFinal(n);
      for (const cell of painted) {
        assert.equal(map.get(cell.i + ',' + cell.j).role, 'locator');
      }
    }
  }
});

test('인코더 왕복 — digit 레벨 decodeCells (2톤·3톤 × n=13/21/25)', () => {
  for (const { layout, version, n } of LINEUP) {
    for (const tones of [2, 3]) {
      const encoded = encodeY(PAYLOAD, {
        cellSurfaceLayout: layout, version, tones, eccLevel: 'M',
      });
      assert.equal(encoded.formatIndex, tones === 3 ? 3 : 1);
      assert.equal(encoded.version, versionForFinalN(n));
      const digits = dataCellsInScanOrderCellSurfaceFinal(n)
        .map(({ i, j }) => encoded.cellDigits.get(i + ',' + j).digit);
      const decoded = decodeCells(digits, {
        type: 'Y',
        n,
        formatIndex: encoded.formatIndex,
        eccLevel: 'M',
        cellSurfaceLayout: layout,
      });
      assert.equal(decoded.ok, true, layout + '@n=' + n + ' t' + tones + ': ' + decoded.reason);
      assert.equal(decoded.text, PAYLOAD);
      // formatIndex 단독(레이아웃 id 없이 n 만) 경로도 같은 결과 — n-결정 안의 계약.
      const byIndexOnly = decodeCells(digits, {
        type: 'Y', n, formatIndex: encoded.formatIndex, eccLevel: 'M',
      });
      assert.equal(byIndexOnly.ok, true, layout + '@n=' + n + ' t' + tones + ' (index-only): ' + byIndexOnly.reason);
      assert.equal(byIndexOnly.text, PAYLOAD);
    }
  }
});

test('렌더 자체 검증 — verifyRasterY 전 셀 일치 (2톤·3톤 × n=13/21/25)', () => {
  for (const { layout, version, n } of LINEUP) {
    for (const tones of [2, 3]) {
      const encoded = encodeY(PAYLOAD, {
        cellSurfaceLayout: layout, version, tones, eccLevel: 'M',
      });
      const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
      const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
      const report = verifyRasterY(raster, scene, encoded, { palette: PALETTE });
      assert.equal(report.mismatches.length, 0, layout + '@n=' + n + ' t' + tones);
      assert.equal(report.erasures.length, 0, layout + '@n=' + n + ' t' + tones);
      assert.ok(report.matched > 0);
      assert.equal(scene.locatorProfile, 'cell-surface-' + layout);
    }
  }
});

function idealSampleCellFor(n, cycle = ['T', 'L', 'R']) {
  const table = locatorCellsCellSurfaceFinal(n);
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

test('방향 margin — v0 0.311 · v2r2 0.246 (JSON 예측치와 일치), 게이트 통과', () => {
  // margin = 1 − (오방향 최대 일치율). 검산 완료 수치(브리프): v0 오방향 68.9% →
  // margin 0.311 · v2r2 margin 0.246. 코드 재계산이 그 예측과 일치해야 한다.
  const wantMargin = { 13: 0.311, 21: 0.246, 25: 0.246 };
  for (const n of [13, 21, 25]) {
    const canon = evaluateCellSurfaceGeometry({ n }, idealSampleCellFor(n), {});
    assert.equal(canon.ok, true, 'n=' + n);
    assert.equal(canon.accepted, true, 'n=' + n + ' 정방향 수용: ' + JSON.stringify(canon.diagnostics));
    assert.equal(canon.scored.layoutId, finalLayoutIdForN(n));
    assert.equal(canon.diagnostics.agreement, 1, 'n=' + n + ' 정방향 완전 일치');
    const margin = canon.scored.orientationMargin;
    assert.ok(
      Math.abs(margin - wantMargin[n]) < 0.0016,
      'n=' + n + ' margin ' + margin.toFixed(4)
      + ' 이 예측 ' + wantMargin[n] + ' 과 다르다',
    );
    assert.ok(margin >= UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin);
    for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
      const wrong = evaluateCellSurfaceGeometry({ n }, idealSampleCellFor(n, cycle), {});
      assert.equal(wrong.accepted, false, 'n=' + n + ' 오방향 거부');
    }
  }
});

test('encodeY 버전·레이아웃 정합 가드 — v0 는 Y0 만, v2r2 는 Y1/Y2 만', () => {
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v0', version: 1, tones: 2 }), RangeError);
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v2r2', version: 0, tones: 2 }), RangeError);
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v2r2', version: 2, tones: 4 }), RangeError);
  // 자동 선택: 작은 페이로드 → n=21, Y1 초과 → n=25.
  assert.equal(encodeY('short', { cellSurfaceLayout: 'v2r2', tones: 2 }).n, 21);
  assert.equal(encodeY('x'.repeat(100), { cellSurfaceLayout: 'v2r2', tones: 2 }).n, 25);
  assert.equal(encodeY('short', { cellSurfaceLayout: 'v0', tones: 2 }).n, 13);
});

// ─────────────────────────────────────────────────────────────────────────
// v1r2 (n=21 A/B 후보) — 2026-08-15 밤 부활. 기하는 v2r2 와 같은 계약으로 세웠다.
// ─────────────────────────────────────────────────────────────────────────

test('v1r2 회계 — 441 − 80 − 12 − 15 = 334 · S 111 · 잔여 1 (autoplace 유도)', () => {
  const surface = cellSurfaceFinal(21, 'v1r2');
  assert.equal(surface.id, 'v1r2');
  assert.equal(surface.n, 21);
  assert.equal(surface.version, 1);
  assert.equal(surface.locatorCount, 80);
  assert.equal(surface.declaredDataCells, 334);
  assert.equal(surface.usedSymbols, 111);
  assert.equal(surface.residualCells, 1);
  assert.equal(surface.formatCells.length, 15);
  assert.equal(surface.referenceCells.length, 12);
  assert.equal(21 * 21, surface.locatorCount + 27 + surface.declaredDataCells);
  assert.equal(dataCellsInScanOrderCellSurfaceFinal(21, 'v1r2').length, 334);
  assert.equal(fillerCellsCellSurfaceFinal(21, 'v1r2').length, 1);
  // autoplace 하한 — 손 좌표표가 아니라 유도값이다.
  assert.ok(surface.autoplace.dRef >= surface.autoplace.dRefMin);
  assert.ok(surface.autoplace.sFmtMax >= surface.autoplace.sFmtMinRequired);
  assert.equal(surface.autoplace.occupied, 80);
  // 파인더 ∩ (format ∪ reference) = 0.
  const painted = new Set(surface.locatorCells.map((c) => c.i + ',' + c.j));
  for (const cell of [...surface.formatCells, ...surface.referenceCells]) {
    assert.equal(painted.has(cell.i + ',' + cell.j), false, '겹침 ' + cell.i + ',' + cell.j);
  }
  // 네 코너 블록 — NW 25 · NE 15 · SW 15 · SE 25 (코너별 비대칭).
  const counts = { NW: 0, NE: 0, SW: 0, SE: 0 };
  for (const cell of surface.locatorCells) {
    counts[(cell.i <= 4 ? 'N' : 'S') + (cell.j <= 4 ? 'W' : 'E')] += 1;
  }
  assert.deepEqual(counts, { NW: 25, NE: 15, SW: 15, SE: 25 });
  for (const tones of [2, 3]) {
    assert.equal(
      capacityForCellSurfaceFinal(21, 'M', tones, 'v1r2').name,
      tones === 3 ? 'Y1T-CS-V1R2' : 'Y1-CS-V1R2',
    );
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones, 'v1r2').formatIndex, tones === 3 ? 3 : 1);
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones, 'v1r2').dataCells, 334);
  }
  // 기본 경로는 건드리지 않았다 — id 를 안 주면 여전히 v2r2.
  assert.equal(cellSurfaceFinal(21).id, 'v2r2');
  assert.equal(capacityForCellSurfaceFinal(21, 'M', 2).cellSurfaceLayout, 'v2r2');
});

test('v1r2 인코더 왕복 — digit 레벨 decodeCells (2톤·3톤)', () => {
  for (const tones of [2, 3]) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: 'v1r2', version: 1, tones, eccLevel: 'M',
    });
    assert.equal(encoded.n, 21);
    assert.equal(encoded.version, 1);
    assert.equal(encoded.cellSurfaceLayout, 'v1r2');
    assert.equal(encoded.locatorProfile, 'cell-surface-v1r2');
    assert.equal(encoded.formatIndex, tones === 3 ? 3 : 1);
    assert.equal(encoded.capacity.dataCells, 334);
    assert.equal(encoded.cellDigits.size, 441);
    // 칠한 80셀 전부 role=locator + 레이아웃 톤.
    let locatorCount = 0;
    for (const [, entry] of encoded.cellDigits) {
      if (entry.role === 'locator') locatorCount += 1;
    }
    assert.equal(locatorCount, 80);
    const digits = dataCellsInScanOrderCellSurfaceFinal(21, 'v1r2')
      .map(({ i, j }) => encoded.cellDigits.get(i + ',' + j).digit);
    const decoded = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
      cellSurfaceLayout: 'v1r2',
    });
    assert.equal(decoded.ok, true, 'v1r2 t' + tones + ': ' + decoded.reason);
    assert.equal(decoded.text, PAYLOAD);
    // locatorProfile 힌트만으로도 같은 결과 (와이어 formatIndex 는 v2r2 와 같다).
    const byProfile = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
      locatorProfile: 'cell-surface-v1r2',
    });
    assert.equal(byProfile.ok, true, 'v1r2 t' + tones + ' (profile): ' + byProfile.reason);
    assert.equal(byProfile.text, PAYLOAD);
    // n+formatIndex 만으로는 **기본** 레이아웃(v2r2)이 되므로 같은 digits 가 풀리지
    // 않아야 한다 — 「레이아웃 판별은 로케이터·평가 게이트가 한다」는 계약의 반증면.
    const byIndexOnly = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
    });
    assert.notEqual(
      byIndexOnly.ok === true && byIndexOnly.text === PAYLOAD,
      true,
      'n+formatIndex 만으로 v1r2 가 풀렸다 — 기본 레이아웃 계약이 깨졌다',
    );
  }
});

test('v1r2 렌더 자체 검증 — verifyRasterY 전 셀 일치 (2톤·3톤)', () => {
  for (const tones of [2, 3]) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: 'v1r2', version: 1, tones, eccLevel: 'M',
    });
    const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
    const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
    const report = verifyRasterY(raster, scene, encoded, { palette: PALETTE });
    assert.equal(report.mismatches.length, 0, 'v1r2 t' + tones);
    assert.equal(report.erasures.length, 0, 'v1r2 t' + tones);
    assert.ok(report.matched > 0);
    assert.equal(scene.locatorProfile, 'cell-surface-v1r2');
  }
});

test('encodeY 버전 가드 — v1r2 는 Y1(n=21) 전용', () => {
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v1r2', version: 0, tones: 2 }), RangeError);
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v1r2', version: 2, tones: 2 }), RangeError);
  assert.equal(encodeY('short', { cellSurfaceLayout: 'v1r2', tones: 2 }).n, 21);
  // v1r2 는 n=25 가 없으므로 Y1 용량을 넘으면 바로 거부다 (조용히 v2r2 로 넘어가지 않는다).
  assert.throws(() => encodeY('x'.repeat(200), { cellSurfaceLayout: 'v1r2', tones: 2 }), RangeError);
});

/**
 * 완전한 심볼 하나를 표본기로 바꾼다 — 파인더 셀은 레이아웃 톤, 나머지는 실제
 * data/format/reference digit 의 2톤 패턴. n² 전 셀을 답하므로 **두 후보 레이아웃이
 * 모두 표본을 얻는다** (교차 오수용을 실제로 시험할 수 있는 유일한 조건).
 */
function idealSampleCellForEncoded(encoded, cycle = ['T', 'L', 'R']) {
  const map = encoded.cellDigits;
  return (i, j) => {
    const entry = map.get(i + ',' + j);
    if (!entry) return { i, j, ok: false };
    const level = {};
    if (entry.role === 'locator' && entry.tones) {
      for (const face of ['T', 'L', 'R']) level[face] = entry.tones[face];
    } else {
      const pattern = digitToPattern(entry.digit);
      for (const face of ['T', 'L', 'R']) level[face] = pattern[face] ? 2 : 0;
    }
    return {
      i,
      j,
      ok: true,
      T: { median: level[cycle[0]] === 0 ? 0.08 : 0.82 },
      L: { median: level[cycle[1]] === 0 ? 0.08 : 0.82 },
      R: { median: level[cycle[2]] === 0 ? 0.08 : 0.82 },
    };
  };
}

test('n=21 병행 평가 — 두 후보를 다 채점하고 게이트가 고른다 (교차 오수용 없음)', () => {
  const outcome = {};
  for (const layout of ['v2r2', 'v1r2']) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
    });
    const scored = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(encoded), {},
    );
    assert.equal(scored.ok, true, layout + ' 평가 실패');
    // 후보 둘 다 실제로 채점됐다.
    assert.deepEqual(Object.keys(scored.diagnostics.layouts).sort(), ['v1r2', 'v2r2']);
    assert.equal(scored.accepted, true, layout + ' 정답 레이아웃이 수용되지 않았다');
    assert.equal(scored.scored.layoutId, layout, layout + ' 이 아닌 레이아웃이 뽑혔다');
    assert.equal(scored.scored.profile, 'cell-surface-' + layout);
    assert.equal(scored.diagnostics.layouts[layout].agreement, 1, layout + ' 정방향 완전 일치');
    // **교차 오수용 금지** — 상대 레이아웃은 같은 프레임에서 게이트를 통과하면 안 된다.
    const rival = layout === 'v2r2' ? 'v1r2' : 'v2r2';
    assert.equal(
      scored.diagnostics.layouts[rival].accepted,
      false,
      layout + ' 프레임이 ' + rival + ' 로도 수용됐다 (교차 오수용): '
      + JSON.stringify(scored.diagnostics.layouts[rival]),
    );
    assert.equal(scored.diagnostics.ambiguous, false);
    outcome[layout] = {
      margin: scored.scored.orientationMargin,
      rivalAgreement: scored.diagnostics.layouts[rival].agreement,
      rivalReject: scored.diagnostics.layouts[rival].rejectReason,
    };
    // 회전 오방향(±120°)도 거부한다.
    for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
      const wrong = evaluateCellSurfaceGeometry(
        { n: 21 }, idealSampleCellForEncoded(encoded, cycle), {},
      );
      assert.equal(wrong.accepted, false, layout + ' 오방향 수용');
    }
  }
  // 방향 margin 은 게이트(0.035) 위여야 한다 — 수치는 회귀로 고정하지 않고 하한만 건다
  // (데이터 셀 패턴이 페이로드에 따라 달라지므로).
  for (const layout of ['v2r2', 'v1r2']) {
    assert.ok(
      outcome[layout].margin >= UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin,
      layout + ' margin ' + outcome[layout].margin,
    );
  }
});
