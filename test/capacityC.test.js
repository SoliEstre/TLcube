/**
 * capacityC.test.js — Type C 표·노치·회계·단일 GF(211) 경계.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { hexDistance } from '../src/hexgrid.js';
import { anchorCells } from '../src/placement.js';
import { tetradBase } from '../src/markerO.js';
import {
  TYPE_C_MIN_RADIUS, notchCellCountC, notchCellsC, typeCReservedCells,
} from '../src/notchC.js';
import {
  C_FORMAT_INDEX, TYPE_C_CM_UNSUPPORTED_REASON, TYPE_C_RADII,
  TYPE_C_RESERVED_FORMAT_INDEXES, cFormatSpec, cSpecFromFormatIndex,
} from '../src/formatC.js';
import {
  VERSIONS_C, VERSIONS_C_DAEHAN, VERSIONS_C_Q, capacityForC, capacityTableC,
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

describe('3시 노치 정본 (v2 — 3줄 개방 슬롯)', () => {
  test('v2 규칙은 k=14 절대좌표 오라클과 배열 순서까지 정확히 같다', () => {
    assert.equal(TYPE_C_MIN_RADIUS, 14);
    assert.throws(() => notchCellsC(13), RangeError);
    assert.deepEqual(notchCellsC(14), [
      { q: 9, r: -1 }, { q: 10, r: -1 }, { q: 11, r: -1 }, { q: 12, r: -1 }, { q: 13, r: -1 }, { q: 14, r: -1 },
      { q: 7, r: 0 }, { q: 8, r: 0 }, { q: 9, r: 0 }, { q: 10, r: 0 }, { q: 11, r: 0 }, { q: 12, r: 0 }, { q: 13, r: 0 }, { q: 14, r: 0 },
      { q: 8, r: 1 }, { q: 9, r: 1 }, { q: 10, r: 1 }, { q: 11, r: 1 }, { q: 12, r: 1 }, { q: 13, r: 1 },
    ]);
  });

  test('C0..C3 전부: 3k−22셀·고유·링 7..k·코너 개방·거울 대칭·mod3 잔여 보존', () => {
    for (const k of TYPE_C_RADII) {
      const cells = notchCellsC(k);
      const positions = new Set(cells.map(key));
      assert.equal(cells.length, notchCellCountC(k));
      assert.equal(cells.length, 3 * k - 22);
      assert.equal(cells.length % 3, 2, '노치 셀 수 ≡ 2 (mod 3) 규칙 성질');
      assert.equal(positions.size, cells.length);
      assert.ok(cells.every((cell) => {
        const d = hexDistance(cell.q, cell.r);
        return d >= 7 && d <= k;
      }));
      // v2 는 3시 코너를 실루엣째 판다 (v1 부유 큐브 결함의 정정).
      assert.equal(positions.has(`${k},0`), true);
      // 3시 축 거울 대칭.
      assert.ok(cells.every((cell) => positions.has(`${cell.q + cell.r},${-cell.r}`)));
      // 앵커(세트 B 이설)는 노치와 서로소이고 코너 (k,0) 이 더는 앵커가 아니다.
      const anchors = anchorCells(k);
      assert.equal(anchors.length, 3);
      for (const anchor of anchors) assert.equal(positions.has(key(anchor)), false);
      assert.ok(anchors.every((anchor) => !(anchor.q === k && anchor.r === 0)));
      assert.equal(anchors.filter((anchor) => anchor.digit === 5).length, 1);
    }
  });
});

describe('Type C 와이어 표와 CM 거절', () => {
  test('평 C 값 0 · C*D 값 1 · CQ 값 4 네 행씩이며 예약 밴드를 비운다', () => {
    assert.deepEqual(C_FORMAT_INDEX, [
      { name: 'C0', version: 0, k: 14, formatIndex: 0, daehanFinder: false, centerQr: false },
      { name: 'C1', version: 1, k: 16, formatIndex: 0, daehanFinder: false, centerQr: false },
      { name: 'C2', version: 2, k: 18, formatIndex: 0, daehanFinder: false, centerQr: false },
      { name: 'C3', version: 3, k: 20, formatIndex: 0, daehanFinder: false, centerQr: false },
      { name: 'C0D', version: 0, k: 14, formatIndex: 1, daehanFinder: true, centerQr: false },
      { name: 'C1D', version: 1, k: 16, formatIndex: 1, daehanFinder: true, centerQr: false },
      { name: 'C2D', version: 2, k: 18, formatIndex: 1, daehanFinder: true, centerQr: false },
      { name: 'C3D', version: 3, k: 20, formatIndex: 1, daehanFinder: true, centerQr: false },
      { name: 'CQ0', version: 0, k: 14, formatIndex: 4, daehanFinder: false, centerQr: true },
      { name: 'CQ1', version: 1, k: 16, formatIndex: 4, daehanFinder: false, centerQr: true },
      { name: 'CQ2', version: 2, k: 18, formatIndex: 4, daehanFinder: false, centerQr: true },
      { name: 'CQ3', version: 3, k: 20, formatIndex: 4, daehanFinder: false, centerQr: true },
    ]);
    for (const entry of C_FORMAT_INDEX) {
      assert.equal(TYPE_C_RESERVED_FORMAT_INDEXES.includes(entry.formatIndex), false);
      assert.equal(cFormatSpec(entry.version, {
        daehanFinder: entry.daehanFinder, centerQr: entry.centerQr,
      }), entry);
      assert.equal(cSpecFromFormatIndex(entry.formatIndex, entry.k), entry);
    }
    assert.equal(cSpecFromFormatIndex(2, 14), null);
    // CDQ(C*D + 중앙 QR)는 행이 없다 — sagoae×정식 중앙 검증기 확장 트랙 몫.
    assert.throws(
      () => cFormatSpec(0, { daehanFinder: true, centerQr: true }),
      (error) => error instanceof RangeError && /CDQ/.test(error.message),
    );
  });

  test('CQ 회계는 같은 버전의 평 C 와 완전 동일하다 — 19셀 슬롯 점유자 교체', () => {
    assert.equal(VERSIONS_C_Q.length, VERSIONS_C.length);
    for (const q of VERSIONS_C_Q) {
      const p = VERSIONS_C.find((entry) => entry.version === q.version);
      assert.ok(p, q.name);
      // RS 블록·NSYM 축은 기본 행의 symbolKey 를 그대로 쓴다 (손 CQ 행 사본 금지).
      assert.equal(q.symbolKey, p.name, q.name);
      assert.equal(q.overhead, p.overhead, q.name);
      for (const level of LEVELS) {
        const a = capacityForC(q, level);
        const b = capacityForC(p, level);
        assert.equal(a.dataCells, b.dataCells, `${q.name}/${level}`);
        assert.equal(a.usedSymbols, b.usedSymbols, `${q.name}/${level}`);
        assert.equal(a.residualCells, b.residualCells, `${q.name}/${level}`);
        assert.equal(a.maxPayloadBytes, b.maxPayloadBytes, `${q.name}/${level}`);
        assert.deepEqual(a.rsBlockConfig, b.rsBlockConfig, `${q.name}/${level}`);
        // 이름·formatIndex 만 자기 것 — 산출물 메타가 실제 실린 행을 말한다.
        assert.equal(a.name, q.name, `${q.name}/${level}`);
        assert.equal(a.formatIndex, 4, `${q.name}/${level}`);
      }
    }
  });

  test('CM tetrad와 노치가 전 C 반경에서 겹쳐 동일 사유로 거절된다', () => {
    // 거절의 근거는 «겹침의 존재»다 — 정확한 셀 목록은 기하 개정마다 바뀌므로
    // 철자 대신 성질(비어 있지 않음)을 잰다.
    for (const k of TYPE_C_RADII) {
      const notch = new Set(notchCellsC(k).map(key));
      const overlap = Object.values(tetradBase(k)).map(key)
        .filter((cellKey) => notch.has(cellKey));
      assert.ok(overlap.length > 0, `k=${k}: CM tetrad 와 노치가 겹치지 않으면 거절 사유가 낡은 것이다`);
    }
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
      assert.equal(
        typeCReservedCells(k, daehanReservedCells(k)).length,
        notchCellCountC(k) + 60,
      );
    }
  });
});

describe('용량·ECC 표', () => {
  test('셀·오버헤드·S·순 페이로드 계약값', () => {
    const expected = {
      C0: [631, 81, 550, 183, 1, [154, 130, 105]],
      C1: [817, 91, 726, 242, 0, [203, 172, 139]],
      C2: [1027, 101, 926, 308, 2, [255, 220, 176]],
      C3: [1261, 111, 1150, 383, 1, [255, 255, 223]],
      C0D: [631, 141, 490, 163, 1, [137, 116, 93]],
      C1D: [817, 151, 666, 222, 0, [188, 157, 128]],
      C2D: [1027, 161, 866, 288, 2, [240, 205, 166]],
      C3D: [1261, 171, 1090, 363, 1, [255, 255, 208]],
    };
    for (const spec of [...VERSIONS_C, ...VERSIONS_C_DAEHAN]) {
      const caps = LEVELS.map((level) => capacityForC(spec, level));
      assert.deepEqual(
        [caps[0].totalCells, caps[0].overhead, caps[0].dataCells, caps[0].usedSymbols,
          caps[0].residualCells, caps.map((capacity) => capacity.maxPayloadBytes)],
        expected[spec.name],
      );
      // 잔여 셀은 k mod 3 부류의 함수다 — 4단 사다리가 세 부류(1/0/2)를 전부 밟는다.
      assert.ok(caps.every((capacity) => capacity.residualCells === caps[0].residualCells));
    }
  });

  test('SPEC §5 절차는 V2/M 기존 예외, Type C 블록 청킹 보정은 6행이다', () => {
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

    const cBlockMismatches = [];
    for (const [name, row] of Object.entries(NSYM_TABLE_C)) {
      for (const level of LEVELS) {
        const config = row.blocks[level];
        const longestCodeword = Math.max(...config.dataSymbolsPerBlock)
          + config.paritySymbolsPerBlock;
        const want = nsymByProcedure(longestCodeword)[level];
        if (config.paritySymbolsPerBlock !== want) {
          cBlockMismatches.push(
            `${name}/${level} ${config.paritySymbolsPerBlock}≠${want}`,
          );
        }
      }
    }
    // 청킹 정렬 보정 발동 행 (4단 사다리 재유도, 실모듈 왕복 동일성이 자):
    // C0D/L 20→19 · C2D/L 17→19 · C2D/H 58→57 · C3/L 23→25 · C3/M 49→47 · C3/H 77→75.
    assert.deepEqual(cBlockMismatches, [
      'C3/L 25≠23', 'C3/M 47≠49', 'C3/H 75≠77',
      'C0D/L 19≠20', 'C2D/L 19≠17', 'C2D/H 57≠58',
    ]);

    for (const spec of [...VERSIONS_C, ...VERSIONS_C_DAEHAN]) {
      for (const level of LEVELS) {
        const cap = capacityForC(spec, level);
        assert.equal(symbolCountForByteLength(cap.dataBytes), cap.dataSymbols, `${spec.name}/${level}`);
      }
    }
  });

  test('C0/C0D는 한 블록, C1 이상 계열은 최소 두 블록으로 모두 210 이하', () => {
    for (const spec of [...VERSIONS_C, ...VERSIONS_C_DAEHAN]) {
      for (const level of LEVELS) {
        const cap = capacityForC(spec, level);
        const expectedBlocks = spec.version === 0 ? 1 : 2;
        assert.equal(cap.rsBlockCount, expectedBlocks, `${spec.name}/${level}`);
        assert.equal(cap.minimumRsBlocks, expectedBlocks, `${spec.name}/${level}`);
        assert.equal(cap.rsEncodable, true, `${spec.name}/${level}`);
        assert.equal(cap.singleBlockEncodable, expectedBlocks === 1, `${spec.name}/${level}`);
        assert.ok(cap.rsCodewordSymbolsPerBlock.every((count) => count <= 210));
        assert.equal(
          cap.rsCodewordSymbolsPerBlock.reduce((sum, count) => sum + count, 0),
          cap.usedSymbols,
        );
        assert.equal(
          cap.rsDataSymbolsPerBlock.reduce((sum, count) => sum + count, 0),
          cap.dataSymbols,
        );
        assert.equal(cap.nsym, cap.rsBlockCount * cap.rsParitySymbolsPerBlock);
        assert.equal(cap.errorCapacity, cap.errorCapacityPerBlock);
        assert.equal(
          cap.errorCapacityAggregate,
          cap.rsBlockCount * cap.errorCapacityPerBlock,
        );
      }
    }
    assert.equal(capacityTableC('M').length, 4);
    assert.equal(capacityTableC('M', { daehanFinder: true }).length, 4);
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
