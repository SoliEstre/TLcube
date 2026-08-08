/**
 * placementY.test.js — Type Y 레퍼런스 4조 · 포맷 15셀 · 역할 배치 검증
 * (SPEC §14, ADR 0003 U8·U9)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  REFERENCE_GROUP_DIGITS,
  FORMAT_BLOCK_LENGTH,
  FORMAT_REPLICAS,
  referenceAnchors,
  referenceGroups,
  referenceCellsAll,
  formatCells,
  buildRoleSets,
  roleOf,
} from '../src/placementY.js';

const VERSIONS_N = [21, 25];

// ─────────────────────────────────────────────────────────────────────────────
// 레퍼런스 4조 (U9)
// ─────────────────────────────────────────────────────────────────────────────

describe('레퍼런스 4조', () => {
  test('조 앵커 = (2,2)·(n-3,2)·(2,n-3)·(n-3,n-3), 이 순서', () => {
    for (const n of VERSIONS_N) {
      assert.deepEqual(referenceAnchors(n), [
        { p: 2, q: 2 },
        { p: n - 3, q: 2 },
        { p: 2, q: n - 3 },
        { p: n - 3, q: n - 3 },
      ]);
    }
  });

  test('조 = 정확히 4개, 각 조 3셀 = L자형 [(p,q),(p+1,q),(p,q+1)]', () => {
    for (const n of VERSIONS_N) {
      const groups = referenceGroups(n);
      assert.equal(groups.length, 4);
      const anchors = referenceAnchors(n);
      groups.forEach((g, idx) => {
        const { p, q } = anchors[idx];
        assert.deepEqual(g.cells, [
          { i: p, j: q },
          { i: p + 1, j: q },
          { i: p, j: q + 1 },
        ]);
      });
    }
  });

  test('digit 배정 = REFERENCE_GROUP_DIGITS = [0,4,3], 그 순서로', () => {
    assert.deepEqual(REFERENCE_GROUP_DIGITS, [0, 4, 3]);
    for (const n of VERSIONS_N) {
      for (const g of referenceGroups(n)) {
        assert.deepEqual(g.digits, REFERENCE_GROUP_DIGITS);
      }
    }
  });

  test('referenceCellsAll = 조 순 · 조 내 순 평탄화, 길이 12, digit 이 얹혀있다', () => {
    for (const n of VERSIONS_N) {
      const flat = referenceCellsAll(n);
      assert.equal(flat.length, 12);
      const groups = referenceGroups(n);
      let idx = 0;
      for (const g of groups) {
        for (let k = 0; k < 3; k += 1) {
          assert.deepEqual(flat[idx], { ...g.cells[k], digit: g.digits[k] });
          idx += 1;
        }
      }
    }
  });

  test('레퍼런스 12셀은 서로 중복 없음 (전수, n=21·25)', () => {
    for (const n of VERSIONS_N) {
      const keys = referenceCellsAll(n).map((c) => `${c.i},${c.j}`);
      assert.equal(new Set(keys).size, keys.length);
    }
  });

  test('공간 분산 — 4조 앵커는 대각선 위 일직선이 아니다 (4점 중 3점 이상 비공선)', () => {
    for (const n of VERSIONS_N) {
      const pts = referenceAnchors(n).map(({ p, q }) => [p, q]);
      // 4점 전부가 하나의 직선 위에 있지는 않은지 — 서로 다른 기울기가 존재해야 한다.
      const slopes = new Set();
      for (let a = 0; a < pts.length; a += 1) {
        for (let b = a + 1; b < pts.length; b += 1) {
          const [x1, y1] = pts[a];
          const [x2, y2] = pts[b];
          slopes.add(x2 === x1 ? 'inf' : `${(y2 - y1) / (x2 - x1)}`);
        }
      }
      assert.ok(slopes.size > 1, `n=${n}: 4조 앵커가 일직선 상에 있다`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 포맷 정보 15셀 (U8)
// ─────────────────────────────────────────────────────────────────────────────

describe('포맷 정보 15셀', () => {
  test('길이 15 (3복제 × 5셀)', () => {
    for (const n of VERSIONS_N) {
      assert.equal(formatCells(n).length, FORMAT_BLOCK_LENGTH * FORMAT_REPLICAS);
      assert.equal(formatCells(n).length, 15);
    }
  });

  test('결정 규칙 — 복제 0/1/2 좌표 정확 일치 (와이어 계약)', () => {
    for (const n of VERSIONS_N) {
      const cells = formatCells(n);
      const rep0 = cells.slice(0, 5);
      const rep1 = cells.slice(5, 10);
      const rep2 = cells.slice(10, 15);
      assert.deepEqual(rep0, [2, 3, 4, 5, 6].map((i) => ({ i, j: 1 })));
      assert.deepEqual(rep1, [2, 3, 4, 5, 6].map((j) => ({ i: 1, j })));
      assert.deepEqual(rep2, [n - 8, n - 7, n - 6, n - 5, n - 4].map((i) => ({ i, j: n - 2 })));
    }
  });

  test('전 셀 가장자리 inset ≥ 1 (0 또는 n-1 좌표를 쓰지 않는다)', () => {
    for (const n of VERSIONS_N) {
      for (const { i, j } of formatCells(n)) {
        assert.ok(i >= 1 && i <= n - 2, `n=${n}: i=${i} inset 위반`);
        assert.ok(j >= 1 && j <= n - 2, `n=${n}: j=${j} inset 위반`);
      }
    }
  });

  test('포맷 15셀은 서로 중복 없음', () => {
    for (const n of VERSIONS_N) {
      const keys = formatCells(n).map((c) => `${c.i},${c.j}`);
      assert.equal(new Set(keys).size, keys.length);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 무충돌 (모듈 로드 시점 자기검증의 테스트 재확인 — 전수)
// ─────────────────────────────────────────────────────────────────────────────

describe('레퍼런스 vs 포맷 무충돌', () => {
  test('전수: n=21·25 에서 레퍼런스 12셀과 포맷 15셀이 하나도 겹치지 않는다', () => {
    for (const n of VERSIONS_N) {
      const refSet = new Set(referenceCellsAll(n).map((c) => `${c.i},${c.j}`));
      const fmtSet = new Set(formatCells(n).map((c) => `${c.i},${c.j}`));
      for (const k of fmtSet) assert.ok(!refSet.has(k), `n=${n}: 충돌 셀 ${k}`);
      assert.equal(refSet.size + fmtSet.size, 27, `n=${n}: 합집합 크기가 27 이 아니다`);
    }
  });

  test('모듈 로드 자체가 이미 통과했다 (import 성공 = 자기검증 통과)', () => {
    // placementY.js 하단의 자기검증 루프가 throw 했다면 이 테스트 파일의 import 문
    // 자체가 실패한다 — 여기 도달했다는 것이 곧 통과 증거.
    assert.ok(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 역할 분할 — reference | format | data, 전수 커버리지
// ─────────────────────────────────────────────────────────────────────────────

describe('역할 분할', () => {
  test('전수: n×n 격자의 모든 셀이 정확히 하나의 역할을 갖는다 (n=21·25)', () => {
    for (const n of VERSIONS_N) {
      const roleSets = buildRoleSets(n);
      const counts = { reference: 0, format: 0, data: 0 };
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const role = roleOf(i, j, n, roleSets);
          assert.ok(Object.hasOwn(counts, role), `알 수 없는 역할: ${role}`);
          counts[role] += 1;
        }
      }
      assert.equal(counts.reference + counts.format + counts.data, n * n);
      assert.equal(counts.reference, 12, `n=${n}`);
      assert.equal(counts.format, 15, `n=${n}`);
      assert.equal(counts.data, n * n - 27, `n=${n}`);
    }
  });

  test('roleOf 는 roleSets 생략 시에도 동일 결과 (재계산 경로)', () => {
    const n = 21;
    const roleSets = buildRoleSets(n);
    for (let j = 0; j < 5; j += 1) {
      for (let i = 0; i < 5; i += 1) {
        assert.equal(roleOf(i, j, n), roleOf(i, j, n, roleSets));
      }
    }
  });
});
