import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CELL_SURFACE_FINAL_ACTIVE_IDS,
  CELL_SURFACE_FINAL_FORMAT_WIRES,
  CELL_SURFACE_FINAL_LEGACY_IDS,
  CELL_SURFACE_FINAL_NS,
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
} from '../src/cellSurfaceFinal.js';
import { ECC_NAME_BY_VALUE } from '../src/formatinfo.js';
import { MASK_CANDIDATES, maskValue } from '../src/mask.js';
import { buildYLayout } from '../src/r2/y-layout.js';

function lineupNs() {
  const ns = new Set();
  for (const id of CELL_SURFACE_FINAL_ACTIVE_IDS) {
    for (const n of CELL_SURFACE_FINAL_NS[id] || []) ns.add(n);
  }
  return [...ns].filter((n) => finalLayoutIdsForN(n).length > 0).sort((a, b) => a - b);
}

function eccNames() {
  return Object.keys(ECC_NAME_BY_VALUE).map(Number).sort((a, b) => a - b)
    .map((value) => ECC_NAME_BY_VALUE[value]);
}

function registry() {
  const legacy = new Set(CELL_SURFACE_FINAL_LEGACY_IDS);
  const rows = [];
  for (const n of lineupNs()) {
    for (const layoutId of finalLayoutIdsForN(n)) {
      for (const formatWire of CELL_SURFACE_FINAL_FORMAT_WIRES) {
        if (formatWire === 1 && !legacy.has(layoutId)) continue;
        for (const eccName of eccNames()) {
          const masks = formatWire === 1 ? [0] : MASK_CANDIDATES.map((_, index) => index);
          for (const maskIndex of masks) {
            rows.push({ n, layoutId, formatWire, eccName, maskIndex });
          }
        }
      }
    }
  }
  return rows;
}

function expectedFromSsot({ n, layoutId, formatWire, eccName, maskIndex }) {
  const scan = dataCellsInScanOrderCellSurfaceFinal(n, layoutId, formatWire);
  const capacity = capacityForCellSurfaceFinal(n, eccName, 2, layoutId, formatWire);
  return {
    layoutId,
    cellCount: scan.length,
    requiredSymbolCount: capacity.dataSymbols,
    nsym: capacity.nsym,
    maskDigits: Uint8Array.from(scan,
      (cell) => maskValue(cell.i, cell.j, maskIndex)),
    maxPayloadBytes: capacity.dataBytes,
    payloadBytes: capacity.dataBytes,
    eccName,
    maskIndex,
    formatWire,
  };
}

function outcome(call) {
  try {
    return { ok: true, value: call() };
  } catch (error) {
    return { ok: false, name: error?.name, message: error?.message };
  }
}

test('공개 Y registry 전조합을 SSoT에서 유도해 정확히 조립한다', () => {
  const rows = registry();
  assert.equal(rows.length, 102);
  for (const row of rows) {
    const actual = buildYLayout(
      row.n, row.layoutId, row.eccName, row.maskIndex, row.formatWire,
    );
    assert.deepEqual(actual, expectedFromSsot(row), JSON.stringify(row));
    assert.ok(actual.maskDigits instanceof Uint8Array);
  }
});

test('구형 wire/layout 실패도 원 SSoT 호출과 같은 예외다', () => {
  const legacy = new Set(CELL_SURFACE_FINAL_LEGACY_IDS);
  const cases = [];
  for (const n of lineupNs()) {
    for (const layoutId of finalLayoutIdsForN(n)) {
      if (!legacy.has(layoutId)) {
        cases.push({ n, layoutId, formatWire: 1, eccName: 'H', maskIndex: 0 });
      }
    }
  }
  assert.ok(cases.length > 0);
  for (const row of cases) {
    const expected = outcome(() => expectedFromSsot(row));
    const actual = outcome(() => buildYLayout(
      row.n, row.layoutId, row.eccName, row.maskIndex, row.formatWire,
    ));
    assert.equal(expected.ok, false, `SSoT가 실패해야 하는 case: ${JSON.stringify(row)}`);
    assert.deepEqual(actual, expected, JSON.stringify(row));
  }
});

test('호출마다 반환 객체와 maskDigits 소유권이 분리된다', () => {
  const row = registry()[0];
  const first = buildYLayout(
    row.n, row.layoutId, row.eccName, row.maskIndex, row.formatWire,
  );
  const second = buildYLayout(
    row.n, row.layoutId, row.eccName, row.maskIndex, row.formatWire,
  );
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.maskDigits, second.maskDigits);
  const pristine = Uint8Array.from(second.maskDigits);
  first.maskDigits.fill(255);
  assert.deepEqual(second.maskDigits, pristine);
});
