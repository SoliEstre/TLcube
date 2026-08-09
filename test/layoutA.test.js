/**
 * layoutA.test.js — Type A scan order-A(T3) + layoutA.js 통합 파사드 검증
 * (ADR 0005 D3, docs/adr/0005_typeA_layout.md v1.1 / 0005b §3)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  dataCellsInScanOrderA,
  symbolCellGroupsA,
  fillerCellsA,
  layoutMapA,
  roleOfA,
  buildRoleSetsA,
  regionCellsA,
  vertexAnchors,
  patchReferenceCells,
  anchorCells,
  formatCells,
  referenceCellsAll,
  occupiedCells,
} from '../src/layoutA.js';
import { dataCellsInScanOrder as hexScan } from '../src/layout.js';

const VERSIONS_K = [8, 10];

// k=8: 총 325 − 오버헤드 58 = 267 (3의 배수, 잔여 0)
// k=10: 총 496 − 오버헤드 65 = 431 (3으로 나누면 잔여 2)
const EXPECTED_DATA_CELLS = { 8: 267, 10: 431 };
const EXPECTED_GROUPS = { 8: 89, 10: 143 };
const EXPECTED_FILLER = { 8: 0, 10: 2 };
const EXPECTED_TOTAL = { 8: 325, 10: 496 };
const EXPECTED_REFERENCE = { 8: 18, 10: 25 }; // 육각 2(k-2) + 패치(6/9)

// 전 scan order-A sha256(JSON.stringify 좌표 배열) — 와이어 계약 스냅샷
// (`.scratch_explore/gen_snapshots.mjs` 로 산출, 구현에서 고정).
const SCAN_SHA256 = {
  8: '76094c7fe8374c2a134bcd18dadd646e7559632c2a4c7e0a89eb4835e71eee80',
  10: 'b76b869c106783dc1aaeda10573c77633642da26c28fd3a37a48bd3d55b6f976',
};

// 처음 6셀(육각부 §5.7 접두 초입) + 마지막 6셀(패치 꼬리, BL 최외곽) — 와이어 계약 스냅샷.
const SCAN_SNAPSHOT = {
  8: {
    first6: [
      { q: -3, r: 2 }, { q: -3, r: 4 }, { q: -2, r: 4 },
      { q: -1, r: 4 }, { q: 0, r: 4 }, { q: 1, r: 3 },
    ],
    last6: [
      { q: -13, r: 5 }, { q: -14, r: 6 }, { q: -14, r: 7 },
      { q: -14, r: 8 }, { q: -15, r: 8 }, { q: -15, r: 7 },
    ],
  },
  10: {
    first6: [
      { q: -3, r: 2 }, { q: -3, r: 4 }, { q: -2, r: 4 },
      { q: -1, r: 4 }, { q: 0, r: 4 }, { q: 1, r: 3 },
    ],
    last6: [
      { q: -17, r: 8 }, { q: -17, r: 7 }, { q: -18, r: 8 },
      { q: -18, r: 10 }, { q: -19, r: 10 }, { q: -19, r: 9 },
    ],
  },
};

function sha256Of(scan) {
  return createHash('sha256').update(JSON.stringify(scan)).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// dataCellsInScanOrderA — 길이 · 중복 없음 · 전 셀 role=='data' · 육각부 접두 동일
// ─────────────────────────────────────────────────────────────────────────────

describe('dataCellsInScanOrderA', () => {
  test('길이 = 총 셀 − 오버헤드(D5 검산값)', () => {
    for (const k of VERSIONS_K) {
      assert.equal(dataCellsInScanOrderA(k).length, EXPECTED_DATA_CELLS[k], `k=${k}`);
    }
  });

  test('중복 없음', () => {
    for (const k of VERSIONS_K) {
      const scan = dataCellsInScanOrderA(k);
      const seen = new Set(scan.map((c) => `${c.q},${c.r}`));
      assert.equal(seen.size, scan.length, `k=${k}`);
    }
  });

  test('전 셀이 roleOfA == "data" (앵커·포맷·레퍼런스·불스아이 混入 없음)', () => {
    for (const k of VERSIONS_K) {
      const roleSets = buildRoleSetsA(k);
      for (const c of dataCellsInScanOrderA(k)) {
        assert.equal(roleOfA(c.q, c.r, k, roleSets), 'data', `k=${k} (${c.q},${c.r})`);
      }
    }
  });

  test('scan order 의 셀 집합 = regionCellsA 중 role=="data" 인 셀 전체 (브루트포스 대조)', () => {
    for (const k of VERSIONS_K) {
      const roleSets = buildRoleSetsA(k);
      const expected = new Set(
        regionCellsA(k)
          .filter((c) => roleOfA(c.q, c.r, k, roleSets) === 'data')
          .map((c) => `${c.q},${c.r}`),
      );
      const actual = new Set(dataCellsInScanOrderA(k).map((c) => `${c.q},${c.r}`));
      assert.equal(actual.size, expected.size, `k=${k}`);
      for (const kk of expected) assert.ok(actual.has(kk), `k=${k} 누락 ${kk}`);
    }
  });

  test('육각부 접두가 layout.dataCellsInScanOrder(k) 와 바이트 동일 (D3 공유 계약)', () => {
    for (const k of VERSIONS_K) {
      const hexPrefix = hexScan(k);
      const scan = dataCellsInScanOrderA(k);
      assert.deepEqual(scan.slice(0, hexPrefix.length), hexPrefix, `k=${k}`);
    }
  });

  test('처음 6셀 · 마지막 6셀 정확 좌표 스냅샷', () => {
    for (const k of VERSIONS_K) {
      const scan = dataCellsInScanOrderA(k);
      assert.deepEqual(scan.slice(0, 6), SCAN_SNAPSHOT[k].first6, `k=${k} first6`);
      assert.deepEqual(scan.slice(-6), SCAN_SNAPSHOT[k].last6, `k=${k} last6`);
    }
  });

  test('전 scan order-A sha256 고정 (와이어 계약)', () => {
    for (const k of VERSIONS_K) {
      assert.equal(sha256Of(dataCellsInScanOrderA(k)), SCAN_SHA256[k], `k=${k} sha256 불일치`);
    }
  });

  test('결정성 — 호출 2회가 완전히 동일', () => {
    for (const k of VERSIONS_K) {
      assert.deepEqual(dataCellsInScanOrderA(k), dataCellsInScanOrderA(k), `k=${k}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// symbolCellGroupsA / fillerCellsA
// ─────────────────────────────────────────────────────────────────────────────

describe('symbolCellGroupsA / fillerCellsA', () => {
  test('그룹 수 = ⌊C/3⌋, 필러 수 = C mod 3', () => {
    for (const k of VERSIONS_K) {
      const groups = symbolCellGroupsA(k);
      const filler = fillerCellsA(k);
      assert.equal(groups.length, EXPECTED_GROUPS[k], `k=${k} groups`);
      assert.equal(filler.length, EXPECTED_FILLER[k], `k=${k} filler`);
      assert.equal(filler.length, EXPECTED_DATA_CELLS[k] % 3, `k=${k} filler = C mod 3`);
      assert.equal(groups.length * 3 + filler.length, EXPECTED_DATA_CELLS[k], `k=${k} 합`);
    }
  });

  test('그룹 + 필러가 scan order-A 를 순서대로 정확히 재구성한다', () => {
    for (const k of VERSIONS_K) {
      const scan = dataCellsInScanOrderA(k);
      const groups = symbolCellGroupsA(k);
      const filler = fillerCellsA(k);
      const rebuilt = [...groups.flat(), ...filler];
      assert.deepEqual(rebuilt, scan, `k=${k}`);
    }
  });

  test('필러는 scan order 꼬리(마지막 filler.length 개)와 일치, A2 는 (−19,10)·(−19,9)', () => {
    for (const k of VERSIONS_K) {
      const scan = dataCellsInScanOrderA(k);
      const filler = fillerCellsA(k);
      if (filler.length === 0) continue;
      assert.deepEqual(scan.slice(scan.length - filler.length), filler, `k=${k}`);
    }
    assert.deepEqual(fillerCellsA(10), [{ q: -19, r: 10 }, { q: -19, r: 9 }]);
    assert.deepEqual(fillerCellsA(8), []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// layoutMapA — 통합 레이아웃 맵
// ─────────────────────────────────────────────────────────────────────────────

describe('layoutMapA', () => {
  test('맵 크기 = 총 셀 (역할 무관 전 셀), 키는 "q,r" 문자열', () => {
    for (const k of VERSIONS_K) {
      const map = layoutMapA(k);
      assert.equal(map.size, EXPECTED_TOTAL[k], `k=${k}`);
      for (const c of regionCellsA(k)) {
        assert.ok(map.has(`${c.q},${c.r}`), `k=${k} 누락 (${c.q},${c.r})`);
      }
    }
  });

  test('anchor 인덱스 = [육각 anchorCells(k), vertexAnchors(k)] 이어붙인 순서와 정합', () => {
    for (const k of VERSIONS_K) {
      const map = layoutMapA(k);
      const anchors = [...anchorCells(k), ...vertexAnchors(k)];
      anchors.forEach((c, idx) => {
        const entry = map.get(`${c.q},${c.r}`);
        assert.equal(entry.role, 'anchor', `k=${k} idx=${idx}`);
        assert.equal(entry.index, idx, `k=${k} idx=${idx}`);
      });
    }
  });

  test('format 인덱스 = formatCells(k) 순서와 정합', () => {
    for (const k of VERSIONS_K) {
      const map = layoutMapA(k);
      formatCells(k).forEach((c, idx) => {
        const entry = map.get(`${c.q},${c.r}`);
        assert.equal(entry.role, 'format');
        assert.equal(entry.index, idx);
      });
    }
  });

  test('reference 인덱스 = [육각 referenceCellsAll(k), patchReferenceCells(k)] 이어붙인 순서와 정합', () => {
    for (const k of VERSIONS_K) {
      const map = layoutMapA(k);
      const references = [...referenceCellsAll(k), ...patchReferenceCells(k)];
      references.forEach((c, idx) => {
        const entry = map.get(`${c.q},${c.r}`);
        assert.equal(entry.role, 'reference', `k=${k} idx=${idx}`);
        assert.equal(entry.index, idx, `k=${k} idx=${idx}`);
      });
    }
  });

  test('bullseye 인덱스 = occupiedCells() 순서와 정합', () => {
    for (const k of VERSIONS_K) {
      const map = layoutMapA(k);
      occupiedCells().forEach((c, idx) => {
        const entry = map.get(`${c.q},${c.r}`);
        assert.equal(entry.role, 'bullseye');
        assert.equal(entry.index, idx);
      });
    }
  });

  test('data 인덱스 = dataCellsInScanOrderA(k) 순서와 정합, index/3 = 그룹 번호', () => {
    for (const k of VERSIONS_K) {
      const map = layoutMapA(k);
      const scan = dataCellsInScanOrderA(k);
      scan.forEach((c, idx) => {
        const entry = map.get(`${c.q},${c.r}`);
        assert.equal(entry.role, 'data');
        assert.equal(entry.index, idx);
      });
    }
  });

  test('역할별 개수 총합 = 총 셀, bullseye=19 · anchor=6 · format=15 · reference=EXPECTED · data=EXPECTED', () => {
    for (const k of VERSIONS_K) {
      const map = layoutMapA(k);
      const counts = {
        bullseye: 0, anchor: 0, format: 0, reference: 0, data: 0,
      };
      for (const { role } of map.values()) counts[role] += 1;
      assert.equal(counts.bullseye, 19, `k=${k}`);
      assert.equal(counts.anchor, 6, `k=${k}`);
      assert.equal(counts.format, 15, `k=${k}`);
      assert.equal(counts.reference, EXPECTED_REFERENCE[k], `k=${k}`);
      assert.equal(counts.data, EXPECTED_DATA_CELLS[k], `k=${k}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 재-export 파사드 — placementA/placement 를 직접 import 하지 않아도 되게
// ─────────────────────────────────────────────────────────────────────────────

describe('재-export 파사드', () => {
  test('roleOfA/buildRoleSetsA/regionCellsA/vertexAnchors/patchReferenceCells/anchorCells/formatCells/referenceCellsAll/occupiedCells 가 재-export 된다', () => {
    for (const k of VERSIONS_K) {
      assert.equal(typeof roleOfA, 'function');
      assert.equal(typeof buildRoleSetsA, 'function');
      assert.equal(regionCellsA(k).length, EXPECTED_TOTAL[k]);
      assert.equal(vertexAnchors(k).length, 3);
      assert.equal(anchorCells(k).length, 3);
      assert.equal(formatCells(k).length, 15);
      assert.equal(referenceCellsAll(k).length, 2 * (k - 2));
    }
    assert.equal(occupiedCells().length, 19);
  });
});
