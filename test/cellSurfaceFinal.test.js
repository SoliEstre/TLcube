/**
 * cellSurfaceFinal.test.js — 최종 라인업 (v0 n=13 · v2r2 n=21/25 · v1r2·v0X n=21)
 * 회계·배정·왕복.
 *
 * 라인업 (운영자 확정 2026-08-15): Y0→v0 · Y1/Y2→v2r2. formatIndex 는 신세대
 * 셀 표면 한 쌍(2T=1 · 3T=3)뿐이다.
 * 2026-08-15 밤 추가: v1r2(n=21, 네 코너 블록 80셀)가 **A/B 후보**로 부활 — 같은
 * formatIndex 쌍을 쓰고, n=21 의 기본은 그대로 v2r2 다. 레이아웃 판별은 로케이터
 * 패밀리 + CS 평가 게이트가 한다.
 * 2026-08-16 추가: v0X(id 'v0x', n=21, QR 파인더 문법 65셀)가 **3파전 후보**로 편입 —
 * 같은 formatIndex 쌍을 쓰고 n=21 기본은 그대로 v2r2 다. 최종 라인업 중 유일하게
 * mid(1) 면을 갖는다(4개) — 편집기 정본이 DEFAULT_TONE 을 생략하기 때문.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_SURFACE_FINAL_FORMAT_INDEX,
  CELL_SURFACE_FINAL_IDS,
  CELL_SURFACE_FINAL_NS,
  CELL_SURFACE_FINAL_PROFILE,
  V0X_BLOCKS,
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
  CELL_SURFACE_FINAL_FORMAT_WIRE,
  CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
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
import { rsDecode, rsEncode } from '../src/rs211.js';
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

test('n → 기본 레이아웃·버전 (13→v0/Y0 · 21→v2r2/Y1 · 25→v2r2/Y2), n=21 후보는 셋', () => {
  // 2026-08-15 밤 운영자 지시로 v1r2 가 n=21 **A/B 후보**로 부활했다.
  // 기본(default)은 그대로 v2r2 — finalLayoutIdForN 의 반환은 바뀌지 않는다.
  // 의도적 갱신 (2026-08-16): v0X 편입으로 n=21 후보가 셋이 됐다. 기본은 여전히 v2r2.
  assert.deepEqual([...CELL_SURFACE_FINAL_IDS], ['v0', 'v2r2', 'v1r2', 'v0x']);
  assert.equal(finalLayoutIdForN(13), 'v0');
  assert.equal(finalLayoutIdForN(21), 'v2r2');
  assert.equal(finalLayoutIdForN(25), 'v2r2');
  assert.equal(finalLayoutIdForN(11), null);
  assert.deepEqual([...finalLayoutIdsForN(13)], ['v0']);
  assert.deepEqual([...finalLayoutIdsForN(21)], ['v2r2', 'v1r2', 'v0x']);
  assert.deepEqual([...finalLayoutIdsForN(25)], ['v2r2']);
  assert.deepEqual([...finalLayoutIdsForN(11)], []);
  assert.equal(versionForFinalN(13), 0);
  assert.equal(versionForFinalN(21), 1);
  assert.equal(versionForFinalN(25), 2);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v0], [13]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v2r2], [21, 25]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v1r2], [21]);
  assert.deepEqual([...CELL_SURFACE_FINAL_NS.v0x], [21]);
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0, 'cell-surface-v0');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v2r2, 'cell-surface-v2r2');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v1r2, 'cell-surface-v1r2');
  assert.equal(CELL_SURFACE_FINAL_PROFILE.v0x, 'cell-surface-v0x');
  // formatIndex 신설 금지 — 네 레이아웃이 한 쌍(2T=1 · 3T=3)을 함께 쓴다.
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

// 의도적 갱신 (2026-08-16, 운영자 지시): v2r2 중앙 블록 A 가 구 4×4 링(16셀)에서
// v1r2 NW 5×5(25셀) 공유로 교체됐다 — painted 65→74, data 349→340 · 533→524.
// 의도적 갱신 (2026-08-16, 포맷 v2 일괄 전환): 포맷 셀 15→18 (마스크 index 2bit 를
// 싣는 6번째 digit). 예약 27→30, data −3 — v0 112→109 · v2r2@21 340→337 · @25 524→521.
test('회계 — v0 169−30−30=109 · v2r2@21 441−74−30=337 · v2r2@25 625−74−30=521', () => {
  const want = {
    13: { locator: 30, data: 109, S: 36, residual: 1 },
    21: { locator: 74, data: 337, S: 112, residual: 1 },
    25: { locator: 74, data: 521, S: 173, residual: 2 },
  };
  for (const [n, w] of Object.entries(want).map(([k, v]) => [Number(k), v])) {
    const surface = cellSurfaceFinal(n);
    assert.equal(surface.locatorCount, w.locator, 'n=' + n + ' locator');
    assert.equal(surface.declaredDataCells, w.data, 'n=' + n + ' data');
    assert.equal(surface.usedSymbols, w.S, 'n=' + n + ' S');
    assert.equal(surface.residualCells, w.residual, 'n=' + n + ' 잔여');
    assert.equal(surface.formatCells.length, 18);
    assert.equal(surface.referenceCells.length, 12);
    assert.equal(dataCellsInScanOrderCellSurfaceFinal(n).length, w.data);
    assert.equal(fillerCellsCellSurfaceFinal(n).length, w.residual);
    assert.equal(
      n * n,
      surface.locatorCount + 30 + w.data,
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

test('방향 margin — v0 0.311 · v2r2 0.234 (중앙 개정 재검산치와 일치), 게이트 통과', () => {
  // margin = 1 − (오방향 최대 일치율). v0 오방향 68.9% → margin 0.311.
  // 의도적 갱신 (2026-08-16): v2r2 중앙이 v1r2 NW 5×5 공유로 교체되며 margin 이
  // 0.2462 → 0.2342 로 재검산됐다 (공유 불스아이 중앙은 회전 대칭성이 높지만 블록 B
  // 가 비대칭을 유지 — 게이트 0.035 의 6.7배로 여전히 여유). 게이트 완화 아님.
  const wantMargin = { 13: 0.311, 21: 0.2342, 25: 0.2342 };
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

// 의도적 갱신 (2026-08-16, 포맷 v2): 포맷 15→18 → data 334→331 · S 111→110.
test('v1r2 회계 — 441 − 80 − 12 − 18 = 331 · S 110 · 잔여 1 (autoplace 유도)', () => {
  const surface = cellSurfaceFinal(21, 'v1r2');
  assert.equal(surface.id, 'v1r2');
  assert.equal(surface.n, 21);
  assert.equal(surface.version, 1);
  assert.equal(surface.locatorCount, 80);
  assert.equal(surface.declaredDataCells, 331);
  assert.equal(surface.usedSymbols, 110);
  assert.equal(surface.residualCells, 1);
  assert.equal(surface.formatCells.length, 18);
  assert.equal(surface.referenceCells.length, 12);
  assert.equal(21 * 21, surface.locatorCount + 30 + surface.declaredDataCells);
  assert.equal(dataCellsInScanOrderCellSurfaceFinal(21, 'v1r2').length, 331);
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
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones, 'v1r2').dataCells, 331);
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
    assert.equal(encoded.capacity.dataCells, 331);
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

// ─────────────────────────────────────────────────────────────────────────
// v0X (n=21 3파전 후보) — 2026-08-16 편입. QR 파인더 문법 차용 v0 확장.
// 정본은 toneOverrides 셀 집합(65)에서 유도했다 — 손 좌표표 사본이 아니다.
// ─────────────────────────────────────────────────────────────────────────

// 의도적 갱신 (2026-08-16, 포맷 v2): 포맷 15→18 → data 349→346 · S 116→115.
test('v0X 회계 — 441 − 65 − 12 − 18 = 346 · S 115 · 잔여 1 (autoplace 유도)', () => {
  const surface = cellSurfaceFinal(21, 'v0x');
  assert.equal(surface.id, 'v0x');
  assert.equal(surface.n, 21);
  assert.equal(surface.version, 1);
  assert.equal(surface.locatorCount, 65);
  assert.equal(surface.declaredDataCells, 346);
  assert.equal(surface.usedSymbols, 115);
  assert.equal(surface.residualCells, 1);
  assert.equal(surface.formatCells.length, 18);
  assert.equal(surface.referenceCells.length, 12);
  assert.equal(21 * 21, surface.locatorCount + 30 + surface.declaredDataCells);
  assert.equal(dataCellsInScanOrderCellSurfaceFinal(21, 'v0x').length, 346);
  assert.equal(fillerCellsCellSurfaceFinal(21, 'v0x').length, 1);
  assert.deepEqual(surface.nsym, { symbols: 115, L: 14, M: 29, H: 46 });
  // autoplace 하한 — 손 좌표표가 아니라 유도값이다.
  assert.ok(surface.autoplace.dRef >= surface.autoplace.dRefMin);
  assert.ok(surface.autoplace.sFmtMax >= surface.autoplace.sFmtMinRequired);
  assert.equal(surface.autoplace.occupied, 65);
  // 파인더 ∩ (format ∪ reference) = 0.
  const painted = new Set(surface.locatorCells.map((c) => c.i + ',' + c.j));
  for (const cell of [...surface.formatCells, ...surface.referenceCells]) {
    assert.equal(painted.has(cell.i + ',' + cell.j), false, '겹침 ' + cell.i + ',' + cell.j);
  }
  // 편집기 정본의 counts.data(349) 는 **포맷 v1 기준**이었다 — v0X 파인더가 편집기
  // 고정 배치를 잠식하지 않아 v1 에서는 일치했고, v2 로 3셀이 더 빠져 346 이 된다.
  for (const tones of [2, 3]) {
    assert.equal(
      capacityForCellSurfaceFinal(21, 'M', tones, 'v0x').name,
      tones === 3 ? 'Y1T-CS-V0X' : 'Y1-CS-V0X',
    );
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones, 'v0x').formatIndex, tones === 3 ? 3 : 1);
    assert.equal(capacityForCellSurfaceFinal(21, 'M', tones, 'v0x').dataCells, 346);
  }
  // 기본 경로는 건드리지 않았다 — id 를 안 주면 여전히 v2r2.
  assert.equal(cellSurfaceFinal(21).id, 'v2r2');
});

test('v0X 구조 — NW16 · SE36 · NE6 · SW6 + 단독 (14,20), SE 는 3면 동일 35/36', () => {
  const cells = locatorCellsCellSurfaceFinal(21, 'v0x');
  assert.equal(cells.length, 65);
  const inBox = (c, box) => (box.iMax === undefined || c.i <= box.iMax)
    && (box.iMin === undefined || c.i >= box.iMin)
    && (box.jMax === undefined || c.j <= box.jMax)
    && (box.jMin === undefined || c.j >= box.jMin);
  const counts = { NW: 0, NE: 0, SW: 0, SE: 0, SINGLE: 0 };
  for (const cell of cells) {
    let home = null;
    for (const name of ['NW', 'NE', 'SW', 'SE']) if (inBox(cell, V0X_BLOCKS[name])) home = name;
    if (home === null && cell.i === V0X_BLOCKS.SINGLE.i && cell.j === V0X_BLOCKS.SINGLE.j) {
      home = 'SINGLE';
    }
    assert.ok(home !== null, '블록 밖 셀 ' + cell.i + ',' + cell.j);
    counts[home] += 1;
  }
  assert.deepEqual(counts, { NW: 16, NE: 6, SW: 6, SE: 36, SINGLE: 1 });

  // SE 6×6 은 QR 동심 사각 — 암 테두리 / 명 링 / 암 2×2 코어. 3면 동일 35/36
  // ((19,19).R 만 mid). 이 «3면 동일» 이 로케이터 사각 링 서명의 근거다.
  const se = cells.filter((c) => inBox(c, V0X_BLOCKS.SE));
  assert.equal(se.filter((c) => c.T === c.L && c.L === c.R).length, 35);
  const seT = new Map(se.map((c) => [c.i + ',' + c.j, c.T]));
  const wantSE = ['000000', '022220', '020020', '020020', '022220', '000000'];
  for (let i = 15; i <= 20; i += 1) {
    const row = [];
    for (let j = 15; j <= 20; j += 1) row.push(String(seT.get(i + ',' + j)));
    assert.equal(row.join(''), wantSE[i - 15], 'SE 면 T 행 i=' + i);
  }
  // 중심 통과 런 D1 B1 D2 B1 D1 = 1:1:2:1:1 (K5 회문) — 행·열 양쪽에서 성립한다.
  for (let j = 15; j <= 20; j += 1) {
    const col = [];
    for (let i = 15; i <= 20; i += 1) col.push(String(seT.get(i + ',' + j)));
    assert.equal(col.join(''), wantSE[j - 15], 'SE 면 T 열 j=' + j);
  }

  // NW (0..3)² 는 v1r2 NW 의 같은 범위와 같다 — 공유 K3 중앙 계보 ((0,3).L mid 만 예외).
  const nw = new Map(locatorCellsCellSurfaceFinal(21, 'v1r2')
    .filter((c) => c.i <= 3 && c.j <= 3).map((c) => [c.i + ',' + c.j, c]));
  assert.equal(nw.size, 16);
  for (const cell of cells.filter((c) => inBox(c, V0X_BLOCKS.NW))) {
    const want = nw.get(cell.i + ',' + cell.j);
    assert.ok(want, 'v1r2 NW 에 없는 v0X NW 셀 ' + cell.i + ',' + cell.j);
    for (const face of ['T', 'L', 'R']) {
      if (cell[face] === 1) continue;
      assert.equal(cell[face], want[face], 'NW ' + cell.i + ',' + cell.j + '.' + face);
    }
  }
});

test('v0X mid(1) 면 — 정확히 4개, 좌표·면이 정본과 일치하고 v0X 밖엔 없다', () => {
  // 편집기 정본은 tone !== DEFAULT_TONE(=1) 만 직렬화한다 → 빠진 면은 mid 확정이다.
  // (0,3).L · (14,20).L · (14,20).R · (19,19).R — 최종 라인업에서 v0X 만 갖는다.
  const want = ['0,3:L', '14,20:L', '14,20:R', '19,19:R'];
  const got = [];
  for (const cell of locatorCellsCellSurfaceFinal(21, 'v0x')) {
    for (const face of ['T', 'L', 'R']) {
      if (cell[face] === 1) got.push(cell.i + ',' + cell.j + ':' + face);
    }
  }
  assert.deepEqual(got.sort(), want.slice().sort());
  for (const [id, n] of [['v0', 13], ['v2r2', 21], ['v2r2', 25], ['v1r2', 21]]) {
    for (const cell of locatorCellsCellSurfaceFinal(n, id)) {
      for (const face of ['T', 'L', 'R']) {
        assert.notEqual(cell[face], 1, id + '@' + n + ' 에 mid 면이 생겼다 ' + cell.i + ',' + cell.j);
      }
    }
  }
  // (14,20) 은 T=2 · L=R=mid — 세 면 조합이 유일한 «단면 점» 이다.
  const single = locatorCellsCellSurfaceFinal(21, 'v0x')
    .find((c) => c.i === 14 && c.j === 20);
  assert.deepEqual({ T: single.T, L: single.L, R: single.R }, { T: 2, L: 1, R: 1 });
});

test('v0X 인코더 왕복 — digit 레벨 decodeCells (2톤·3톤)', () => {
  for (const tones of [2, 3]) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: 'v0x', version: 1, tones, eccLevel: 'M',
    });
    assert.equal(encoded.n, 21);
    assert.equal(encoded.cellSurfaceLayout, 'v0x');
    assert.equal(encoded.locatorProfile, 'cell-surface-v0x');
    assert.equal(encoded.formatIndex, tones === 3 ? 3 : 1);
    const digits = dataCellsInScanOrderCellSurfaceFinal(21, 'v0x')
      .map(({ i, j }) => encoded.cellDigits.get(i + ',' + j).digit);
    const decoded = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
      cellSurfaceLayout: 'v0x',
    });
    assert.equal(decoded.ok, true, 'v0x t' + tones + ': ' + decoded.reason);
    assert.equal(decoded.text, PAYLOAD);
    // 프로파일 힌트 경로 — 'cell-surface-v0x' 는 초안 슬롯이 없어 충돌하지 않는다.
    const byProfile = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
      locatorProfile: 'cell-surface-v0x',
    });
    assert.equal(byProfile.ok, true, 'v0x t' + tones + ' (profile): ' + byProfile.reason);
    assert.equal(byProfile.text, PAYLOAD);
    // n+formatIndex 만으론 기본(v2r2)으로 풀린다 — 기본 레이아웃 계약 불변.
    const byIndexOnly = decodeCells(digits, {
      type: 'Y', n: 21, formatIndex: encoded.formatIndex, eccLevel: 'M',
    });
    assert.notEqual(
      byIndexOnly.ok && byIndexOnly.text, PAYLOAD,
      'n+formatIndex 만으로 v0X 가 풀렸다 — 기본 레이아웃 계약이 깨졌다',
    );
  }
});

test('v0X 렌더 자체 검증 — verifyRasterY 전 셀 일치 (2톤·3톤, mid 면 포함)', () => {
  for (const tones of [2, 3]) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: 'v0x', version: 1, tones, eccLevel: 'M',
    });
    const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
    const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
    const report = verifyRasterY(raster, scene, encoded, { palette: PALETTE });
    assert.equal(report.mismatches.length, 0, 'v0x t' + tones);
    assert.equal(report.erasures.length, 0, 'v0x t' + tones);
    assert.equal(scene.locatorProfile, 'cell-surface-v0x');
  }
});

test('encodeY 버전 가드 — v0X 는 Y1(n=21) 전용', () => {
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v0x', version: 0, tones: 2 }), RangeError);
  assert.throws(() => encodeY(PAYLOAD, { cellSurfaceLayout: 'v0x', version: 2, tones: 2 }), RangeError);
  assert.equal(encodeY('short', { cellSurfaceLayout: 'v0x', tones: 2 }).n, 21);
  // v0X 는 n=25 가 없으므로 Y1 용량을 넘으면 바로 거부다 (조용히 v2r2 로 넘어가지 않는다).
  assert.throws(() => encodeY('x'.repeat(200), { cellSurfaceLayout: 'v0x', tones: 2 }), RangeError);
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

// 의도적 갱신 (2026-08-16): v0X 편입으로 n=21 후보가 셋 — 채점 대상·교차 오수용
// 검사가 3-way 로 넓어진다. 게이트(0.78 / 0.035)는 그대로다.
test('n=21 병행 평가 — 세 후보를 다 채점하고 게이트가 고른다 (교차 오수용 없음)', () => {
  const outcome = {};
  const N21 = ['v2r2', 'v1r2', 'v0x'];
  for (const layout of N21) {
    const encoded = encodeY(PAYLOAD, {
      cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
    });
    const scored = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(encoded), {},
    );
    assert.equal(scored.ok, true, layout + ' 평가 실패');
    // 후보 둘 다 실제로 채점됐다.
    assert.deepEqual(Object.keys(scored.diagnostics.layouts).sort(), ['v0x', 'v1r2', 'v2r2']);
    assert.equal(scored.accepted, true, layout + ' 정답 레이아웃이 수용되지 않았다');
    assert.equal(scored.scored.layoutId, layout, layout + ' 이 아닌 레이아웃이 뽑혔다');
    assert.equal(scored.scored.profile, 'cell-surface-' + layout);
    // v0X 는 mid 면 4개가 **이 테스트의 이진 표본기**(:625 median 0.08/0.82 — mid 를
    // bright 로 보냄)에서 어긋나 상한이 191/195 다. 이 상수는 이진 표본기 측정치이지
    // 팔레트 측정치가 아니다 — 팔레트 경로는 mid 가 dark 쪽으로 가서 margin 이 다르다
    // (이진 0.1282 vs 팔레트 0.1333, 적대 검증 실측). 정본 mid 4면을 0/2 로 확정해도
    // 이 단언은 움직이지 않으니 그 결정의 자로 쓰지 말 것. 게이트 0.78 위 여유는 큼.
    assert.equal(
      scored.diagnostics.layouts[layout].agreement,
      layout === 'v0x' ? 191 / 195 : 1,
      layout + ' 정방향 일치율',
    );
    // **교차 오수용 금지** — 나머지 후보는 같은 프레임에서 게이트를 통과하면 안 된다.
    for (const rival of N21) {
      if (rival === layout) continue;
      assert.equal(
        scored.diagnostics.layouts[rival].accepted,
        false,
        layout + ' 프레임이 ' + rival + ' 로도 수용됐다 (교차 오수용): '
        + JSON.stringify(scored.diagnostics.layouts[rival]),
      );
    }
    assert.equal(scored.diagnostics.ambiguous, false);
    outcome[layout] = { margin: scored.scored.orientationMargin };
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
  for (const layout of N21) {
    assert.ok(
      outcome[layout].margin >= UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin,
      layout + ' margin ' + outcome[layout].margin,
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════
// RS 파라미터 전수 회귀 (2026-08-16 r2 · 통합자 결정 C)
//
// 왜 생겼나 — **조용히 지나간 사고가 있었다.** 포맷 v2 전환(S 가 1 줄어듦)이
// `nsymTable` 의 **비율 기반** 반올림 문턱을 넘겨 세 조합에서 정정능력을 1심볼
// 깎았는데(v2r2@21-L 7→6 · v2r2@25-M 22→21 · v2r2@25-H 35→34), 스위트 전체에서
// `nsym` 을 단언하는 곳이 `v0x@21` 한 줄뿐이라 아무도 못 봤다(적대 검증 F2).
// 왜곡 강건성을 노린 개정이 정정능력을 깎았는데 테스트는 초록이었다.
//
// 그래서 **(레이아웃 × ECC) 15조합 × {nsym, errorCapacity, dataSymbols, dataBytes,
// maxPayloadBytes}** 를 전수 단언한다. 값은 «맞아야 할 값» 이 아니라 **실측값**이다 —
// 여기가 빨개지면 그것은 버그 신호가 아니라 «공표 수치를 다시 재라» 는 신호다
// (SPEC §5.5 용량표 · §6 ECC 파라미터가 이 표를 승계한다).
//
// 두 세대를 다 건다: 현행(포맷 v2)과 레거시(포맷 v1, 판독 전용). 레거시 열은
// 개정 전 트리(04fdff4)에서 뜬 값 그대로이므로 폴백 복호의 RS 파라미터가
// 조용히 어긋나는 것도 여기서 잡힌다.
// ═════════════════════════════════════════════════════════════════════════

/** 15조합 실측표 — [nsym, errorCapacity, dataSymbols, dataBytes, maxPayloadBytes]. */
const RS_TABLE = Object.freeze({
  2: Object.freeze({ // 현행 세대 (포맷 v2 · 18셀)
    'v0@13': { S: 36, L: [4, 2, 32, 30, 29], M: [9, 4, 27, 26, 25], H: [14, 7, 22, 21, 20] },
    'v2r2@21': { S: 112, L: [13, 6, 99, 95, 94], M: [29, 14, 83, 80, 79], H: [45, 22, 67, 64, 63] },
    'v2r2@25': { S: 173, L: [21, 10, 152, 146, 145], M: [43, 21, 130, 125, 124], H: [69, 34, 104, 100, 99] },
    'v1r2@21': { S: 110, L: [13, 6, 97, 93, 92], M: [29, 14, 81, 78, 77], H: [44, 22, 66, 63, 62] },
    'v0x@21': { S: 115, L: [14, 7, 101, 97, 96], M: [29, 14, 86, 82, 81], H: [46, 23, 69, 66, 65] },
  }),
  1: Object.freeze({ // 레거시 세대 (포맷 v1 · 15셀) — 개정 전 트리와 동일
    'v0@13': { S: 37, L: [4, 2, 33, 31, 30], M: [9, 4, 28, 27, 26], H: [15, 7, 22, 21, 20] },
    'v2r2@21': { S: 113, L: [14, 7, 99, 95, 94], M: [29, 14, 84, 81, 80], H: [45, 22, 68, 65, 64] },
    'v2r2@25': { S: 174, L: [21, 10, 153, 147, 146], M: [45, 22, 129, 124, 123], H: [70, 35, 104, 100, 99] },
    'v1r2@21': { S: 111, L: [13, 6, 98, 94, 93], M: [29, 14, 82, 79, 78], H: [44, 22, 67, 64, 63] },
    'v0x@21': { S: 116, L: [14, 7, 102, 98, 97], M: [29, 14, 87, 83, 82], H: [46, 23, 70, 67, 66] },
  }),
});

test('RS 파라미터 전수 — 15조합 × {nsym, errorCapacity, dataSymbols, dataBytes, payload} (현행 세대)', () => {
  let combos = 0;
  for (const [key, want] of Object.entries(RS_TABLE[CELL_SURFACE_FINAL_FORMAT_WIRE])) {
    const [id, raw] = key.split('@');
    const n = Number(raw);
    const surface = cellSurfaceFinal(n, id);
    assert.equal(surface.usedSymbols, want.S, key + ' S');
    assert.deepEqual(surface.nsym, {
      symbols: want.S, L: want.L[0], M: want.M[0], H: want.H[0],
    }, key + ' nsym 표');
    for (const level of ['L', 'M', 'H']) {
      const [nsym, ec, dataSymbols, dataBytes, payload] = want[level];
      const capacity = capacityForCellSurfaceFinal(n, level, 2, id);
      assert.equal(capacity.nsym, nsym, key + '-' + level + ' nsym');
      assert.equal(capacity.errorCapacity, ec, key + '-' + level + ' errorCapacity');
      assert.equal(capacity.dataSymbols, dataSymbols, key + '-' + level + ' dataSymbols');
      assert.equal(capacity.dataBytes, dataBytes, key + '-' + level + ' dataBytes');
      assert.equal(capacity.maxPayloadBytes, payload, key + '-' + level + ' maxPayloadBytes');
      // nsym 은 «데이터 + 패리티 = S» 회계와 항상 맞아야 한다.
      assert.equal(capacity.dataSymbols + capacity.nsym, want.S, key + '-' + level + ' 합계');
      combos += 1;
    }
  }
  assert.equal(combos, 15, '조합 수가 15 가 아니다 — 라인업이 늘었으면 표를 갱신하라');
});

test('RS 파라미터 전수 — 레거시(포맷 v1) 세대도 개정 전 값 그대로다', () => {
  let combos = 0;
  for (const [key, want] of Object.entries(RS_TABLE[CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY])) {
    const [id, raw] = key.split('@');
    const n = Number(raw);
    const surface = cellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
    assert.equal(surface.usedSymbols, want.S, key + ' S(v1)');
    for (const level of ['L', 'M', 'H']) {
      const [nsym, ec, dataSymbols, dataBytes, payload] = want[level];
      const capacity = capacityForCellSurfaceFinal(
        n, level, 2, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
      );
      assert.equal(capacity.nsym, nsym, key + '-' + level + ' nsym(v1)');
      assert.equal(capacity.errorCapacity, ec, key + '-' + level + ' errorCapacity(v1)');
      assert.equal(capacity.dataSymbols, dataSymbols, key + '-' + level + ' dataSymbols(v1)');
      assert.equal(capacity.dataBytes, dataBytes, key + '-' + level + ' dataBytes(v1)');
      assert.equal(capacity.maxPayloadBytes, payload, key + '-' + level + ' payload(v1)');
      combos += 1;
    }
  }
  assert.equal(combos, 15);
});

test('세대 전환의 대가 — 정정능력 −1 이 세 조합, payload 는 «전부 −1 B» 가 아니다', () => {
  // ⚠ **운영자 재가 대기 항목**. 이 테스트는 «좋다» 고 말하지 않는다 —
  // 포맷 v2 가 무엇을 얼마나 깎았는지를 **수치로 고정**해 다음 사람이 모르고
  // 지나가지 못하게 한다. 재가 전까지 이 표는 SPEC §7.5 «불변» 행을 대체한다.
  const eccLoss = [];
  const payloadDelta = {};
  for (const key of Object.keys(RS_TABLE[2])) {
    const [id, raw] = key.split('@');
    const n = Number(raw);
    for (const level of ['L', 'M', 'H']) {
      const now = capacityForCellSurfaceFinal(n, level, 2, id);
      const legacy = capacityForCellSurfaceFinal(
        n, level, 2, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
      );
      if (now.errorCapacity !== legacy.errorCapacity) {
        eccLoss.push(key + '-' + level + ' ' + legacy.errorCapacity + '→' + now.errorCapacity);
      }
      payloadDelta[key + '-' + level] = now.maxPayloadBytes - legacy.maxPayloadBytes;
    }
  }
  // 정정능력이 움직인 조합은 정확히 셋이고 전부 v2r2 (n=21·25 기본 레이아웃)다.
  assert.deepEqual(eccLoss, [
    'v2r2@21-L 7→6',
    'v2r2@25-M 22→21',
    'v2r2@25-H 35→34',
  ], '정정능력 변동 집합이 달라졌다 — 운영자 재가 표(§7.5)를 갱신하라');
  // «전 레이아웃 payload −1 B» 는 거짓이다 — 15조합 중 4개가 반례(0 셋 · +1 하나).
  const counts = { '-1': 0, 0: 0, 1: 0 };
  for (const delta of Object.values(payloadDelta)) counts[String(delta)] += 1;
  assert.deepEqual(counts, { '-1': 11, 0: 3, 1: 1 }, 'payload 델타 분포');
  assert.equal(payloadDelta['v2r2@25-M'], 1,
    'v2r2@25-M 은 payload 가 **늘어난다**(123→124) — nsym 45→43 이 −1심볼을 덮는다');
});

test('errorCapacity 는 실제 정정 한계와 일치한다 — RS 훼손 실험 (v2r2@25-M)', () => {
  // 장부상 수치가 아니라 실제라는 것을 한 조합에서 실측으로 못 박는다
  // (적대 검증 F2 가 쓴 방법 그대로: nsym/2 개까지 복구, 그 위는 실패).
  const capacity = capacityForCellSurfaceFinal(25, 'M', 2, 'v2r2');
  assert.equal(capacity.errorCapacity, 21);
  const data = new Uint8Array(capacity.dataSymbols);
  for (let i = 0; i < data.length; i += 1) data[i] = (i * 7 + 3) % 211;
  const codeword = rsEncode(data, capacity.nsym);
  const corrupt = (count) => {
    const copy = Uint8Array.from(codeword);
    for (let i = 0; i < count; i += 1) copy[i] = (copy[i] + 1) % 211;
    return rsDecode(copy, capacity.nsym);
  };
  const atLimit = corrupt(21);
  assert.equal(atLimit.ok, true, '정정 한계 21 에서 복구 실패: ' + (atLimit.reason || ''));
  assert.deepEqual(Array.from(atLimit.message), Array.from(data), '21 훼손 복구값이 다르다');
  const overLimit = corrupt(22);
  const recovered = overLimit.ok
    && Array.from(overLimit.message).every((v, i) => v === data[i]);
  assert.equal(recovered, false, '한계 초과(22)에서 복구됐다 — errorCapacity 선언이 낮다');
});
