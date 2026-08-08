/**
 * layoutY.test.js — Type Y scan order-Y + layoutY.js 통합 파사드 검증
 * (SPEC §14, ADR 0003 D5·U7)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  dataCellsInScanOrder,
  symbolCellGroups,
  fillerCells,
  layoutMapY,
  roleOf,
  referenceGroups,
  referenceCellsAll,
  formatCells,
} from '../src/layoutY.js';

const VERSIONS_N = [21, 25];

// n=21: 총 441 - 오버헤드 27 = 414 (3의 배수, 잔여 0)
// n=25: 총 625 - 오버헤드 27 = 598 (3으로 나누면 잔여 1)
const EXPECTED_DATA_CELLS = { 21: 414, 25: 598 };
const EXPECTED_GROUPS = { 21: 138, 25: 199 };
const EXPECTED_FILLER = { 21: 0, 25: 1 };

// 전 scan order sha256(JSON.stringify 좌표 배열) — 와이어 계약 스냅샷.
const SCAN_SHA256 = {
  21: '53ca69517ac2e7dc4b334d9b3c6ec99a706f004ac6a08026ffb6b69286bb4d91',
  25: 'e81defe82788e5b47fb32ce388a13d2d28f353b41298f793c947da6f08fc7866',
};

// 처음 6셀 + 마지막 3셀 정확 좌표 — 와이어 계약 스냅샷 (인코더/디코더가 공유).
const SCAN_SNAPSHOT = {
  21: {
    first6: [
      { i: 0, j: 0 }, { i: 1, j: 0 }, { i: 2, j: 0 },
      { i: 3, j: 0 }, { i: 4, j: 0 }, { i: 5, j: 0 },
    ],
    last3: [{ i: 18, j: 20 }, { i: 19, j: 20 }, { i: 20, j: 20 }],
  },
  25: {
    first6: [
      { i: 0, j: 0 }, { i: 1, j: 0 }, { i: 2, j: 0 },
      { i: 3, j: 0 }, { i: 4, j: 0 }, { i: 5, j: 0 },
    ],
    last3: [{ i: 22, j: 24 }, { i: 23, j: 24 }, { i: 24, j: 24 }],
  },
};

function sha256Of(scan) {
  return createHash('sha256').update(JSON.stringify(scan)).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// dataCellsInScanOrder — 길이 · 중복 없음 · 전 셀 role=='data' · 캐노니컬 순서
// ─────────────────────────────────────────────────────────────────────────────

describe('dataCellsInScanOrder', () => {
  test('길이 = n² - 27 (레퍼런스 12 + 포맷 15)', () => {
    for (const n of VERSIONS_N) {
      assert.equal(dataCellsInScanOrder(n).length, EXPECTED_DATA_CELLS[n], `n=${n}`);
    }
  });

  test('중복 없음 (셀당 정확히 한 번)', () => {
    for (const n of VERSIONS_N) {
      const scan = dataCellsInScanOrder(n);
      const seen = new Set(scan.map((c) => `${c.i},${c.j}`));
      assert.equal(seen.size, scan.length, `n=${n}`);
    }
  });

  test('전 셀이 roleOf 로 data 판정된다', () => {
    for (const n of VERSIONS_N) {
      for (const { i, j } of dataCellsInScanOrder(n)) {
        assert.equal(roleOf(i, j, n), 'data', `n=${n} (${i},${j})`);
      }
    }
  });

  test('캐노니컬 순서 — j 오름차순(행), 행 안에서 i 오름차순 (연속 쌍 비교)', () => {
    for (const n of VERSIONS_N) {
      const scan = dataCellsInScanOrder(n);
      for (let idx = 1; idx < scan.length; idx += 1) {
        const prev = scan[idx - 1];
        const cur = scan[idx];
        const prevKey = prev.j * n + prev.i;
        const curKey = cur.j * n + cur.i;
        assert.ok(curKey > prevKey, `n=${n} idx=${idx}: 순서 위반 ${JSON.stringify(prev)} -> ${JSON.stringify(cur)}`);
      }
    }
  });

  test('처음 6셀 · 마지막 3셀 정확 좌표 스냅샷', () => {
    for (const n of VERSIONS_N) {
      const scan = dataCellsInScanOrder(n);
      assert.deepEqual(scan.slice(0, 6), SCAN_SNAPSHOT[n].first6, `n=${n} first6`);
      assert.deepEqual(scan.slice(-3), SCAN_SNAPSHOT[n].last3, `n=${n} last3`);
    }
  });

  test('전 scan order sha256 고정 (와이어 계약)', () => {
    for (const n of VERSIONS_N) {
      const scan = dataCellsInScanOrder(n);
      assert.equal(sha256Of(scan), SCAN_SHA256[n], `n=${n} sha256 불일치`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// symbolCellGroups / fillerCells — 필러 수 = C mod 3
// ─────────────────────────────────────────────────────────────────────────────

describe('symbolCellGroups / fillerCells', () => {
  test('그룹 수 = ⌊C/3⌋, 필러 수 = C mod 3', () => {
    for (const n of VERSIONS_N) {
      const groups = symbolCellGroups(n);
      const filler = fillerCells(n);
      assert.equal(groups.length, EXPECTED_GROUPS[n], `n=${n} groups`);
      assert.equal(filler.length, EXPECTED_FILLER[n], `n=${n} filler`);
      assert.equal(filler.length, EXPECTED_DATA_CELLS[n] % 3, `n=${n} filler = C mod 3`);
      assert.equal(groups.length * 3 + filler.length, EXPECTED_DATA_CELLS[n], `n=${n} 합`);
    }
  });

  test('그룹 + 필러가 scan order 를 순서대로 정확히 재구성한다', () => {
    for (const n of VERSIONS_N) {
      const scan = dataCellsInScanOrder(n);
      const groups = symbolCellGroups(n);
      const filler = fillerCells(n);
      const rebuilt = [...groups.flat(), ...filler];
      assert.deepEqual(rebuilt, scan, `n=${n}`);
    }
  });

  test('필러는 scan order 꼬리(마지막 filler.length 개)와 일치', () => {
    for (const n of VERSIONS_N) {
      const scan = dataCellsInScanOrder(n);
      const filler = fillerCells(n);
      if (filler.length === 0) continue;
      assert.deepEqual(scan.slice(scan.length - filler.length), filler, `n=${n}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// layoutMapY — 통합 레이아웃 맵, layout.js 대칭 구조
// ─────────────────────────────────────────────────────────────────────────────

describe('layoutMapY', () => {
  test('맵 크기 = n² (역할 무관 전 셀), 키는 "i,j" 문자열', () => {
    for (const n of VERSIONS_N) {
      const map = layoutMapY(n);
      assert.equal(map.size, n * n, `n=${n}`);
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          assert.ok(map.has(`${i},${j}`), `n=${n} 누락 (${i},${j})`);
        }
      }
    }
  });

  test('reference 인덱스 = referenceCellsAll 순서와 정합', () => {
    for (const n of VERSIONS_N) {
      const map = layoutMapY(n);
      referenceCellsAll(n).forEach((c, idx) => {
        const entry = map.get(`${c.i},${c.j}`);
        assert.equal(entry.role, 'reference');
        assert.equal(entry.index, idx);
      });
    }
  });

  test('format 인덱스 = formatCells 순서와 정합', () => {
    for (const n of VERSIONS_N) {
      const map = layoutMapY(n);
      formatCells(n).forEach((c, idx) => {
        const entry = map.get(`${c.i},${c.j}`);
        assert.equal(entry.role, 'format');
        assert.equal(entry.index, idx);
      });
    }
  });

  test('data 인덱스 = dataCellsInScanOrder 순서와 정합, index/3 = 그룹 번호', () => {
    for (const n of VERSIONS_N) {
      const map = layoutMapY(n);
      const scan = dataCellsInScanOrder(n);
      scan.forEach((c, idx) => {
        const entry = map.get(`${c.i},${c.j}`);
        assert.equal(entry.role, 'data');
        assert.equal(entry.index, idx);
      });
    }
  });

  test('역할별 개수 총합 = n², reference=12 · format=15 · data=EXPECTED', () => {
    for (const n of VERSIONS_N) {
      const map = layoutMapY(n);
      const counts = { reference: 0, format: 0, data: 0 };
      for (const { role } of map.values()) counts[role] += 1;
      assert.equal(counts.reference, 12, `n=${n}`);
      assert.equal(counts.format, 15, `n=${n}`);
      assert.equal(counts.data, EXPECTED_DATA_CELLS[n], `n=${n}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 재-export 파사드 — placementY 를 직접 import 하지 않아도 되게
// ─────────────────────────────────────────────────────────────────────────────

describe('재-export 파사드', () => {
  test('roleOf/referenceGroups/referenceCellsAll/formatCells 가 재-export 된다', () => {
    for (const n of VERSIONS_N) {
      assert.equal(typeof roleOf, 'function');
      assert.equal(referenceGroups(n).length, 4);
      assert.equal(referenceCellsAll(n).length, 12);
      assert.equal(formatCells(n).length, 15);
    }
  });
});
