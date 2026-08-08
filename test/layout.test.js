/**
 * layout.test.js — 캐노니컬 scan order + layout.js 통합 파사드 검증 (SPEC §4.2, §5.6, §13 T8)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  dataCellsInScanOrder,
  symbolCellGroups,
  fillerCells,
  layoutMap,
  roleOf,
  overheadBreakdown,
  anchorCells,
  formatCells,
  referenceCellsAll,
  occupiedCells,
  hexDistance,
} from '../src/layout.js';

const VERSIONS_K = [6, 8, 10];

// SPEC §13 확정 오버헤드 대사(overhead(k) = 33 + 2k) 로부터 유도된 기대 데이터 셀 수.
const EXPECTED_DATA_CELLS = { 6: 82, 8: 168, 10: 278 };
const EXPECTED_GROUPS = { 6: 27, 8: 56, 10: 92 };
const EXPECTED_FILLER = { 6: 1, 8: 0, 10: 2 };

// 처음 6셀 + 마지막 3셀 정확 좌표 — 와이어 계약 스냅샷 (인코더/디코더가 공유).
const SCAN_SNAPSHOT = {
  6: {
    first6: [
      { q: -3, r: 2 }, { q: -3, r: 4 }, { q: -2, r: 4 },
      { q: -1, r: 4 }, { q: 0, r: 4 }, { q: 1, r: 3 },
    ],
    last3: [{ q: -6, r: 3 }, { q: -6, r: 4 }, { q: -6, r: 5 }],
  },
  8: {
    first6: [
      { q: -3, r: 2 }, { q: -3, r: 4 }, { q: -2, r: 4 },
      { q: -1, r: 4 }, { q: 0, r: 4 }, { q: 1, r: 3 },
    ],
    last3: [{ q: -8, r: 5 }, { q: -8, r: 6 }, { q: -8, r: 7 }],
  },
  10: {
    first6: [
      { q: -3, r: 2 }, { q: -3, r: 4 }, { q: -2, r: 4 },
      { q: -1, r: 4 }, { q: 0, r: 4 }, { q: 1, r: 3 },
    ],
    last3: [{ q: -10, r: 7 }, { q: -10, r: 8 }, { q: -10, r: 9 }],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// dataCellsInScanOrder — 길이 · 중복 없음 · 전 셀 role=='data'
// ─────────────────────────────────────────────────────────────────────────────

describe('dataCellsInScanOrder', () => {
  test('길이 = 오버헤드 대사표의 데이터 셀 수', () => {
    for (const k of VERSIONS_K) {
      assert.equal(dataCellsInScanOrder(k).length, EXPECTED_DATA_CELLS[k], `k=${k}`);
    }
  });

  test('overheadBreakdown(k).total 과 정합 (총 셀 - 오버헤드 = 데이터 셀)', () => {
    for (const k of VERSIONS_K) {
      const totalCells = 3 * k * k + 3 * k + 1;
      const { total } = overheadBreakdown(k);
      assert.equal(dataCellsInScanOrder(k).length, totalCells - total, `k=${k}`);
    }
  });

  test('중복 없음 (셀당 정확히 한 번)', () => {
    for (const k of VERSIONS_K) {
      const scan = dataCellsInScanOrder(k);
      const seen = new Set(scan.map((c) => `${c.q},${c.r}`));
      assert.equal(seen.size, scan.length, `k=${k}`);
    }
  });

  test('전 셀이 roleOf == "data"', () => {
    for (const k of VERSIONS_K) {
      for (const c of dataCellsInScanOrder(k)) {
        assert.equal(roleOf(c.q, c.r, k), 'data', `k=${k} cell=(${c.q},${c.r})`);
      }
    }
  });

  test('스냅샷 — 처음 6셀 + 마지막 3셀 (와이어 계약)', () => {
    for (const k of VERSIONS_K) {
      const scan = dataCellsInScanOrder(k);
      assert.deepEqual(scan.slice(0, 6), SCAN_SNAPSHOT[k].first6, `k=${k} first6`);
      assert.deepEqual(scan.slice(-3), SCAN_SNAPSHOT[k].last3, `k=${k} last3`);
    }
  });

  test('결정성 — 두 번 호출 deepEqual', () => {
    for (const k of VERSIONS_K) {
      assert.deepEqual(dataCellsInScanOrder(k), dataCellsInScanOrder(k), `k=${k}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// symbolCellGroups · fillerCells — 분할 · 공간 인접성
// ─────────────────────────────────────────────────────────────────────────────

describe('symbolCellGroups / fillerCells', () => {
  test('그룹 수 = 27/56/92, 필러 = 1/0/2', () => {
    for (const k of VERSIONS_K) {
      assert.equal(symbolCellGroups(k).length, EXPECTED_GROUPS[k], `k=${k} groups`);
      assert.equal(fillerCells(k).length, EXPECTED_FILLER[k], `k=${k} filler`);
    }
  });

  test('그룹(×3) + 필러 = 데이터 셀 전체를 정확히 분할', () => {
    for (const k of VERSIONS_K) {
      const scan = dataCellsInScanOrder(k);
      const groups = symbolCellGroups(k);
      const filler = fillerCells(k);
      const reassembled = [...groups.flat(), ...filler];
      assert.deepEqual(reassembled, scan, `k=${k}`);
    }
  });

  test('필러는 scan order 꼬리(최외곽 링 끝)와 일치', () => {
    for (const k of VERSIONS_K) {
      const scan = dataCellsInScanOrder(k);
      const filler = fillerCells(k);
      const residual = scan.length % 3;
      assert.deepEqual(filler, residual === 0 ? [] : scan.slice(scan.length - residual), `k=${k}`);
    }
  });

  test('연속 3셀의 공간 인접성 — 그룹 중 인접쌍(hexDistance 1) 최소 1쌍 보유 비율', () => {
    for (const k of VERSIONS_K) {
      const groups = symbolCellGroups(k);
      let adjacentGroupCount = 0;
      const nonAdjacent = [];
      groups.forEach((g, gi) => {
        let hasAdjacentPair = false;
        for (let i = 0; i < g.length && !hasAdjacentPair; i += 1) {
          for (let j = i + 1; j < g.length; j += 1) {
            if (hexDistance(g[i].q - g[j].q, g[i].r - g[j].r) === 1) {
              hasAdjacentPair = true;
              break;
            }
          }
        }
        if (hasAdjacentPair) adjacentGroupCount += 1;
        else nonAdjacent.push(gi);
      });
      // numbers_check 로 보고할 실측치: k=6/8/10 전부 100% (링 경계 걸침 그룹도
      // 예외 없이 인접쌍을 가진다 — ring-major 순회가 촘촘해서 걸침 그룹도
      // 이웃 링의 인접 셀을 그대로 잇는다).
      assert.equal(
        adjacentGroupCount,
        groups.length,
        `k=${k}: 인접쌍 없는 그룹 ${nonAdjacent.length}개 (인덱스 ${nonAdjacent.join(',')})`,
      );
    }
  });

  test('결정성 — 두 번 호출 deepEqual', () => {
    for (const k of VERSIONS_K) {
      assert.deepEqual(symbolCellGroups(k), symbolCellGroups(k), `k=${k}`);
      assert.deepEqual(fillerCells(k), fillerCells(k), `k=${k}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// layoutMap — 전 셀 커버리지 · 역할별 인덱스 · 왕복 성질
// ─────────────────────────────────────────────────────────────────────────────

describe('layoutMap', () => {
  test('전 역할 셀이 지도에 존재하고 role/index 가 원 목록과 일치', () => {
    for (const k of VERSIONS_K) {
      const map = layoutMap(k);

      occupiedCells().forEach((c, i) => {
        assert.deepEqual(map.get(`${c.q},${c.r}`), { role: 'bullseye', index: i }, `k=${k} bullseye[${i}]`);
      });
      anchorCells(k).forEach((c, i) => {
        assert.deepEqual(map.get(`${c.q},${c.r}`), { role: 'anchor', index: i }, `k=${k} anchor[${i}]`);
      });
      formatCells(k).forEach((c, i) => {
        assert.deepEqual(map.get(`${c.q},${c.r}`), { role: 'format', index: i }, `k=${k} format[${i}]`);
      });
      referenceCellsAll(k).forEach((c, i) => {
        assert.deepEqual(map.get(`${c.q},${c.r}`), { role: 'reference', index: i }, `k=${k} reference[${i}]`);
      });
      dataCellsInScanOrder(k).forEach((c, i) => {
        assert.deepEqual(map.get(`${c.q},${c.r}`), { role: 'data', index: i }, `k=${k} data[${i}]`);
      });
    }
  });

  test('지도 크기 = 반경 k 영역 전체 셀 수 (3k²+3k+1)', () => {
    for (const k of VERSIONS_K) {
      const totalCells = 3 * k * k + 3 * k + 1;
      assert.equal(layoutMap(k).size, totalCells, `k=${k}`);
    }
  });

  test('결정성 — 두 번 호출 deepEqual', () => {
    for (const k of VERSIONS_K) {
      assert.deepEqual([...layoutMap(k)], [...layoutMap(k)], `k=${k}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 왕복 성질 — 임의 digit 배열 → 셀 배치 → layoutMap 역독 → 원 배열 복원
// ─────────────────────────────────────────────────────────────────────────────

// 결정적 의사난수 (mulberry32) — 고정 시드.
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('왕복 성질 (임의 digit 배열)', () => {
  test('scan order 로 배치한 digit 을 layoutMap 역독으로 그대로 복원 (k 전수, 고정 시드)', () => {
    const SEED = 20260808;
    const rand = mulberry32(SEED);
    for (const k of VERSIONS_K) {
      const scan = dataCellsInScanOrder(k);
      const digits = scan.map(() => Math.floor(rand() * 6)); // base-6 digit

      // 인코더 측: scan order 인덱스 → 셀 좌표로 digit 배치.
      const board = new Map();
      scan.forEach((c, i) => board.set(`${c.q},${c.r}`, digits[i]));

      // 디코더 측: layoutMap 으로 각 데이터 셀의 (role, index) 를 읽어 원 배열 위치로 복원.
      const map = layoutMap(k);
      const recovered = new Array(digits.length);
      for (const [posKey, cellDigit] of board) {
        const { role, index } = map.get(posKey);
        assert.equal(role, 'data', `k=${k} ${posKey} 는 data 역할이어야 한다`);
        recovered[index] = cellDigit;
      }

      assert.deepEqual(recovered, digits, `k=${k}`);
    }
  });
});

describe('전 순서 해시 스냅샷 (검증 라운드 권고 반영)', () => {
  // first6/last3 좌표 스냅샷은 중간 순서 회귀를 못 잡는다 — 전 순서를 sha256 으로 고정.
  // ringWalk 내부가 바뀌어 중간만 달라져도 여기서 깨진다. 깨지면 스냅샷부터 고치지 말고
  // 무엇이 순서를 바꿨는지 먼저 확인하라 — 이 순서는 인코더/디코더 와이어 계약이다.
  test('dataCellsInScanOrder 전 좌표열 sha256 고정 (k=6/8/10)', async () => {
    const { createHash } = await import('node:crypto');
    const EXPECT = { 6: '637d3061d860260b', 8: '9c4812eb7894bd61', 10: '29b4eb89d8b44c4f' };
    for (const k of [6, 8, 10]) {
      const str = dataCellsInScanOrder(k).map((c) => `${c.q},${c.r}`).join(';');
      const h = createHash('sha256').update(str).digest('hex').slice(0, 16);
      assert.equal(h, EXPECT[k], `k=${k}: scan order 전 순서가 바뀌었다`);
    }
  });
});
