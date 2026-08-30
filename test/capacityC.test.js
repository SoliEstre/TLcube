/**
 * capacityC.test.js — Type C 표·노치·회계·단일 GF(211) 경계.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { hexDistance } from '../src/hexgrid.js';
import { anchorCells } from '../src/placement.js';
import { tetradBase } from '../src/markerO.js';
import {
  NOTCH_C_CELL_COUNT, NOTCH_C_RELATIVE_OFFSETS, notchCellsC, typeCReservedCells,
} from '../src/notchC.js';
import {
  C_FORMAT_INDEX, TYPE_C_CM_UNSUPPORTED_REASON, TYPE_C_RADII,
  TYPE_C_RESERVED_FORMAT_INDEXES, cFormatSpec, cSpecFromFormatIndex,
} from '../src/formatC.js';
import {
  VERSIONS_C, VERSIONS_C_DAEHAN, capacityForC, capacityTableC,
  assertTypeCSingleBlock, TYPE_C_RS_BLOCK_UNDEFINED_REASON,
} from '../src/capacityC.js';
import {
  DAEHAN_RADII, daehanFinderCellsFor, daehanPatternId, daehanReservedCells,
  sagoaeCells, sagoaeLevels,
} from '../src/finder-daehan.js';
import { NSYM_TABLE, NSYM_TABLE_C } from '../src/rs211.js';
import { symbolCountForByteLength } from '../src/base211.js';
import { MODULE_ORDER } from '../tools/build-single.mjs';
import { CELL_EDITOR_MODULE_ORDER } from '../tools/build-cell-editor.mjs';
import { FINDER_EDITOR_MODULE_ORDER } from '../tools/build-finder-editor.mjs';

const LEVELS = Object.freeze(['L', 'M', 'H']);
const key = (cell) => `${cell.q},${cell.r}`;

function nsymByProcedure(symbols) {
  let M = Math.round(0.25 * symbols);
  if (M % 2 === 0) M += 1;
  return { L: Math.round(0.12 * symbols), M, H: Math.round(0.40 * symbols) };
}

describe('3시 노치 정본', () => {
  test('k=6 대입이 개념도 8셀과 배열 순서까지 정확히 같다', () => {
    assert.deepEqual(NOTCH_C_RELATIVE_OFFSETS, [
      [-3, 1], [-2, -1], [-2, 0], [-2, 1],
      [-1, -1], [-1, 0], [-1, 1], [0, -1],
    ]);
    assert.deepEqual(notchCellsC(6), [
      { q: 3, r: 1 }, { q: 4, r: -1 }, { q: 4, r: 0 }, { q: 4, r: 1 },
      { q: 5, r: -1 }, { q: 5, r: 0 }, { q: 5, r: 1 }, { q: 6, r: -1 },
    ]);
  });

  test('C0/C1/C2 전부 8셀 고유·영역 안·기준 앵커 유지', () => {
    for (const k of TYPE_C_RADII) {
      const cells = notchCellsC(k);
      const positions = new Set(cells.map(key));
      assert.equal(cells.length, NOTCH_C_CELL_COUNT);
      assert.equal(positions.size, NOTCH_C_CELL_COUNT);
      assert.ok(cells.every((cell) => hexDistance(cell.q, cell.r) <= k));
      assert.equal(positions.has(`${k},0`), false);
      for (const anchor of anchorCells(k)) assert.equal(positions.has(key(anchor)), false);
    }
  });
});

describe('Type C 와이어 표와 CM 거절', () => {
  test('평 C 값 0 세 행 뒤 C*D 값 1 세 행이며 예약 밴드를 비운다', () => {
    assert.deepEqual(C_FORMAT_INDEX, [
      { name: 'C0', version: 0, k: 14, formatIndex: 0, daehanFinder: false },
      { name: 'C1', version: 1, k: 17, formatIndex: 0, daehanFinder: false },
      { name: 'C2', version: 2, k: 20, formatIndex: 0, daehanFinder: false },
      { name: 'C0D', version: 0, k: 14, formatIndex: 1, daehanFinder: true },
      { name: 'C1D', version: 1, k: 17, formatIndex: 1, daehanFinder: true },
      { name: 'C2D', version: 2, k: 20, formatIndex: 1, daehanFinder: true },
    ]);
    for (const entry of C_FORMAT_INDEX) {
      assert.equal(TYPE_C_RESERVED_FORMAT_INDEXES.includes(entry.formatIndex), false);
      assert.equal(cFormatSpec(entry.version, { daehanFinder: entry.daehanFinder }), entry);
      assert.equal(cSpecFromFormatIndex(entry.formatIndex, entry.k), entry);
    }
    assert.equal(cSpecFromFormatIndex(2, 14), null);
  });

  test('CM tetrad와 노치가 정확히 3셀 겹쳐 동일 사유로 거절된다', () => {
    const notch = new Set(notchCellsC(6).map(key));
    const overlap = Object.values(tetradBase(6)).map(key)
      .filter((cellKey) => notch.has(cellKey)).sort();
    assert.deepEqual(overlap, ['5,0', '5,1', '6,-1']);
    for (const options of [
      { cornerMarker: true },
      { cornerMarker: true, daehanFinder: true },
    ]) {
      assert.throws(
        () => cFormatSpec(0, options),
        (error) => error instanceof RangeError && error.message === TYPE_C_CM_UNSUPPORTED_REASON,
      );
    }
    assert.equal(C_FORMAT_INDEX.filter((entry) => entry.cornerMarker === true).length, 0);
  });
});

describe('k10 대한 완전판을 k14 이상에서 중심 고정 재사용', () => {
  test('legacy 템플릿 명부는 6/8/10 그대로이고 C 반경은 79/60 완전판이다', () => {
    assert.deepEqual(DAEHAN_RADII, [6, 8, 10]);
    for (const k of TYPE_C_RADII) {
      assert.equal(daehanFinderCellsFor(k).length, 79);
      assert.equal(daehanReservedCells(k).length, 60);
      assert.equal(sagoaeCells(k).length, 60);
      assert.equal(sagoaeLevels(k).length, 60);
      assert.equal(daehanPatternId(k), daehanPatternId(10));
      assert.equal(typeCReservedCells(k, daehanReservedCells(k)).length, 68);
    }
  });
});

describe('용량·ECC 표', () => {
  test('셀·오버헤드·S·순 페이로드 계약값', () => {
    const expected = {
      C0: [631, 69, 562, 187, [158, 134, 107]],
      C1: [919, 75, 844, 281, [237, 201, 161]],
      C2: [1261, 81, 1180, 393, [255, 255, 226]],
      C0D: [631, 129, 502, 167, [140, 118, 95]],
      C1D: [919, 135, 784, 261, [220, 188, 150]],
      C2D: [1261, 141, 1120, 373, [255, 255, 215]],
    };
    for (const spec of [...VERSIONS_C, ...VERSIONS_C_DAEHAN]) {
      const caps = LEVELS.map((level) => capacityForC(spec, level));
      assert.deepEqual(
        [caps[0].totalCells, caps[0].overhead, caps[0].dataCells, caps[0].usedSymbols,
          caps.map((capacity) => capacity.maxPayloadBytes)],
        expected[spec.name],
      );
      assert.ok(caps.every((capacity) => capacity.residualCells === 1));
    }
  });

  test('SPEC §5 절차는 V2/M만 기존 예외이고 Type C는 C1/H 113만 청킹 보정이다', () => {
    const existingMismatches = [];
    for (const [name, row] of Object.entries(NSYM_TABLE)) {
      const want = nsymByProcedure(row.symbols);
      for (const level of LEVELS) {
        if (row[level] !== want[level]) {
          existingMismatches.push(`${name}/${level} ${row[level]}≠${want[level]}`);
        }
      }
    }
    assert.deepEqual(existingMismatches, ['V2/M 14≠15']);

    const cMismatches = [];
    for (const [name, row] of Object.entries(NSYM_TABLE_C)) {
      const want = nsymByProcedure(row.symbols);
      for (const level of LEVELS) {
        if (row[level] !== want[level]) {
          cMismatches.push(`${name}/${level} ${row[level]}≠${want[level]}`);
        }
      }
    }
    assert.deepEqual(cMismatches, ['C1/H 113≠112']);

    for (const spec of [...VERSIONS_C, ...VERSIONS_C_DAEHAN]) {
      for (const level of LEVELS) {
        const cap = capacityForC(spec, level);
        assert.equal(symbolCountForByteLength(cap.dataBytes), cap.dataSymbols, `${spec.name}/${level}`);
      }
    }
  });

  test('GF(211) 단일 블록은 C0/C0D만 열고 C1/C2 계열은 같은 사유로 거절', () => {
    for (const spec of [...VERSIONS_C, ...VERSIONS_C_DAEHAN]) {
      const cap = capacityForC(spec, 'M');
      if (spec.version === 0) {
        assert.equal(assertTypeCSingleBlock(cap), cap);
        assert.equal(cap.minimumRsBlocks, 1);
      } else {
        assert.equal(cap.singleBlockEncodable, false);
        assert.equal(cap.minimumRsBlocks, 2);
        assert.throws(
          () => assertTypeCSingleBlock(cap),
          (error) => error instanceof RangeError
            && error.message.includes(TYPE_C_RS_BLOCK_UNDEFINED_REASON),
        );
      }
    }
    assert.equal(capacityTableC('M').length, 3);
    assert.equal(capacityTableC('M', { daehanFinder: true }).length, 3);
  });
});

test('신설 src 모듈은 세 손 MODULE_ORDER 사본에 모두 위상 순서대로 등재된다', () => {
  for (const order of [MODULE_ORDER, CELL_EDITOR_MODULE_ORDER, FINDER_EDITOR_MODULE_ORDER]) {
    const indexes = ['notchC', 'formatC', 'capacityC'].map((name) => order.indexOf(name));
    assert.ok(indexes.every((index) => index >= 0), `MODULE_ORDER 누락: ${indexes}`);
    assert.ok(order.indexOf('placement') < order.indexOf('notchC'));
    assert.ok(order.indexOf('markerG') < order.indexOf('formatC'));
    assert.ok(order.indexOf('formatC') < order.indexOf('capacityC'));
    assert.ok(order.indexOf('capacityC') < order.indexOf('markerO'));
  }
});
