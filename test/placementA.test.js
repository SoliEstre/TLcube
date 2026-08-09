/**
 * placementA.test.js — Type A 영역·꼭짓점 앵커·패치 레퍼런스 배치 검증
 * (ADR 0005 D1·D2·D4, docs/adr/0005_typeA_layout.md v1.1 / 0005b §1·§2·§4)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  isInRegionA,
  isTopPatch,
  isBLPatch,
  isBRPatch,
  patchOfA,
  regionCellsA,
  vertexAnchors,
  vertexAnchorPositionSet,
  patchReferenceRings,
  patchReferenceCells,
  buildRoleSetsA,
  roleOfA,
} from '../src/placementA.js';
import {
  hexDistance, regionCells, cellCount,
} from '../src/hexgrid.js';
import {
  rotate120, rotate240, REFERENCE_DIGIT, ANCHOR_PRIMARY_DIGIT, ANCHOR_SECONDARY_DIGIT,
  anchorCells, formatCells, referenceCellsAll, buildRoleSets, roleOf,
} from '../src/placement.js';

const VERSIONS_K = [8, 10];

function key(c) {
  return `${c.q},${c.r}`;
}

function sha256Of(cells) {
  return createHash('sha256').update(JSON.stringify(cells)).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// D1 — 영역 정의: 셀 수 검산 (3k+1)(3k+2)/2, 육각부/패치 분할
// ─────────────────────────────────────────────────────────────────────────────

describe('isInRegionA / 셀 수 검산 (D1)', () => {
  test('전수 카운트가 (3k+1)(3k+2)/2 와 일치 (k=1,2,6,8,10)', () => {
    for (const k of [1, 2, 6, 8, 10]) {
      let count = 0;
      for (let q = -2 * k; q <= k; q += 1) {
        for (let r = -2 * k; r <= k; r += 1) {
          if (isInRegionA(q, r, k)) count += 1;
        }
      }
      assert.equal(count, (3 * k + 1) * (3 * k + 2) / 2, `k=${k}`);
    }
  });

  test('육각부 = isInRegionA 중 hexDistance<=k 와 전수 일치 (min(x,y,z)>=-k 동치)', () => {
    for (const k of VERSIONS_K) {
      for (const c of regionCells(k)) {
        assert.ok(isInRegionA(c.q, c.r, k), `hex(${c.q},${c.r}) 가 A(k) 밖`);
      }
      // 역방향: A(k) 안이면서 hexDistance<=k 인 셀은 정확히 regionCells(k) 집합과 같다.
      const hexSet = new Set(regionCells(k).map(key));
      const region = regionCellsA(k);
      for (const c of region) {
        const inHex = hexDistance(c.q, c.r) <= k;
        assert.equal(inHex, hexSet.has(key(c)), `k=${k} (${c.q},${c.r})`);
      }
    }
  });

  test('패치 셀 수 = 3·k(k+1)/2 = 총 셀 − 육각부(cellCount)', () => {
    for (const k of VERSIONS_K) {
      const total = (3 * k + 1) * (3 * k + 2) / 2;
      assert.equal(total - cellCount(k), 3 * k * (k + 1) / 2, `k=${k}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 패치 판별 — top r<-k / BL q<-k / BR q+r>k, 세 패치는 상호 배타 · rotate120 궤도
// ─────────────────────────────────────────────────────────────────────────────

describe('패치 판별 (top/BL/BR)', () => {
  test('영역 A(k) 의 모든 셀은 육각부 아니면 정확히 한 패치에만 속한다', () => {
    for (const k of VERSIONS_K) {
      for (const c of regionCellsA(k)) {
        const flags = [isTopPatch(c.q, c.r, k), isBLPatch(c.q, c.r, k), isBRPatch(c.q, c.r, k)];
        const patchCount = flags.filter(Boolean).length;
        const inHex = hexDistance(c.q, c.r) <= k;
        if (inHex) {
          assert.equal(patchCount, 0, `k=${k} hex(${c.q},${c.r}) 가 패치로도 분류됐다`);
        } else {
          assert.equal(patchCount, 1, `k=${k} (${c.q},${c.r}) 패치 배타성 위반 (flags=${flags})`);
        }
      }
    }
  });

  test('patchOfA 가 top/BL/BR/null(육각부) 을 정확히 되돌린다', () => {
    for (const k of VERSIONS_K) {
      for (const c of regionCellsA(k)) {
        const p = patchOfA(c.q, c.r, k);
        const inHex = hexDistance(c.q, c.r) <= k;
        if (inHex) {
          assert.equal(p, null, `k=${k} (${c.q},${c.r})`);
        } else {
          assert.ok(['top', 'BL', 'BR'].includes(p), `k=${k} (${c.q},${c.r}) => ${p}`);
        }
      }
    }
  });

  test('rotate120 은 top→BR→BL 궤도 (top 패치 셀을 회전하면 BR, 다시 돌리면 BL)', () => {
    for (const k of VERSIONS_K) {
      for (const c of regionCellsA(k)) {
        if (!isTopPatch(c.q, c.r, k)) continue;
        const br = rotate120(c.q, c.r);
        const bl = rotate240(c.q, c.r);
        assert.ok(isBRPatch(br.q, br.r, k), `k=${k} rotate120(${c.q},${c.r})=(${br.q},${br.r}) 가 BR 이 아니다`);
        assert.ok(isBLPatch(bl.q, bl.r, k), `k=${k} rotate240(${c.q},${c.r})=(${bl.q},${bl.r}) 가 BL 이 아니다`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// regionCellsA — 결정적 순서, 육각부 접두 바이트 동일
// ─────────────────────────────────────────────────────────────────────────────

describe('regionCellsA — 결정적 순서', () => {
  test('길이 = (3k+1)(3k+2)/2, 중복 없음', () => {
    for (const k of VERSIONS_K) {
      const region = regionCellsA(k);
      assert.equal(region.length, (3 * k + 1) * (3 * k + 2) / 2, `k=${k}`);
      assert.equal(new Set(region.map(key)).size, region.length, `k=${k} 중복`);
    }
  });

  test('육각부 접두가 hexgrid.regionCells(k) 와 바이트 동일', () => {
    for (const k of VERSIONS_K) {
      const region = regionCellsA(k);
      const hexPart = regionCells(k);
      assert.deepEqual(region.slice(0, hexPart.length), hexPart, `k=${k}`);
    }
  });

  test('호출 2회가 완전히 동일 (결정성)', () => {
    for (const k of VERSIONS_K) {
      assert.deepEqual(regionCellsA(k), regionCellsA(k), `k=${k}`);
    }
  });

  test('sha256 고정 (와이어 계약 스냅샷)', () => {
    const SHA256 = {
      8: 'e7d496f348102b25e357ca2351470140fe4a8307b0b5b2363ba56bc1f52878f9',
      10: 'b1a064f8fdeedf94fffe395256266f98c505ab596bd5df1cb99a41dcb1f03d07',
    };
    for (const k of VERSIONS_K) {
      assert.equal(sha256Of(regionCellsA(k)), SHA256[k], `k=${k}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 꼭짓점 앵커 3셀 (D2) — KAT 좌표 + digit 배정 + 120° 궤도
// ─────────────────────────────────────────────────────────────────────────────

describe('vertexAnchors (D2)', () => {
  const KAT = {
    8: [
      { q: 8, r: -16, digit: ANCHOR_PRIMARY_DIGIT },
      { q: 8, r: 8, digit: ANCHOR_SECONDARY_DIGIT },
      { q: -16, r: 8, digit: ANCHOR_SECONDARY_DIGIT },
    ],
    10: [
      { q: 10, r: -20, digit: ANCHOR_PRIMARY_DIGIT },
      { q: 10, r: 10, digit: ANCHOR_SECONDARY_DIGIT },
      { q: -20, r: 10, digit: ANCHOR_SECONDARY_DIGIT },
    ],
  };

  test('닫힌 형태 (k,−2k)·(k,k)·(−2k,k), digit 5/0/0 — KAT 좌표 정확 일치', () => {
    for (const k of VERSIONS_K) {
      assert.deepEqual(vertexAnchors(k), KAT[k], `k=${k}`);
    }
  });

  test('위 꼭짓점(digit5)만 top 패치, 나머지 둘은 각각 BR/BL 패치 소속', () => {
    for (const k of VERSIONS_K) {
      const [top, br, bl] = vertexAnchors(k);
      assert.ok(isTopPatch(top.q, top.r, k), `k=${k} top`);
      assert.ok(isBRPatch(br.q, br.r, k), `k=${k} br`);
      assert.ok(isBLPatch(bl.q, bl.r, k), `k=${k} bl`);
    }
  });

  test('120°/240° 회전에 대해 꼭짓점 집합 자체는 불변 (위치 집합)', () => {
    for (const k of VERSIONS_K) {
      const posSet = vertexAnchorPositionSet(k);
      for (const c of vertexAnchors(k)) {
        const r120 = rotate120(c.q, c.r);
        const r240 = rotate240(c.q, c.r);
        assert.ok(posSet.has(`${r120.q},${r120.r}`), `k=${k} rotate120(${c.q},${c.r})`);
        assert.ok(posSet.has(`${r240.q},${r240.r}`), `k=${k} rotate240(${c.q},${c.r})`);
      }
    }
  });

  test('꼭짓점은 실제로 영역 A(k) 안에 있다', () => {
    for (const k of VERSIONS_K) {
      for (const c of vertexAnchors(k)) {
        assert.ok(isInRegionA(c.q, c.r, k), `k=${k} (${c.q},${c.r})`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 패치 레퍼런스 — 규칙 R (D4), KAT 좌표
// ─────────────────────────────────────────────────────────────────────────────

describe('patchReferenceCells — 규칙 R (D4)', () => {
  test('패치 레퍼런스 링 = {k+2, k+5, …} <= 2k-1 — k=8 → [10,13], k=10 → [12,15,18]', () => {
    assert.deepEqual(patchReferenceRings(8), [10, 13]);
    assert.deepEqual(patchReferenceRings(10), [12, 15, 18]);
  });

  test('KAT 좌표 — k=8: (5,-10)·(7,-13) + 회전상(총 6) / k=10: (6,-12)·(8,-15)·(9,-18) + 회전상(총 9)', () => {
    const digit = REFERENCE_DIGIT;
    assert.deepEqual(patchReferenceCells(8), [
      { q: 5, r: -10, digit }, { q: 5, r: 5, digit }, { q: -10, r: 5, digit },
      { q: 7, r: -13, digit }, { q: 6, r: 7, digit }, { q: -13, r: 6, digit },
    ]);
    assert.deepEqual(patchReferenceCells(10), [
      { q: 6, r: -12, digit }, { q: 6, r: 6, digit }, { q: -12, r: 6, digit },
      { q: 8, r: -15, digit }, { q: 7, r: 8, digit }, { q: -15, r: 7, digit },
      { q: 9, r: -18, digit }, { q: 9, r: 9, digit }, { q: -18, r: 9, digit },
    ]);
  });

  test('개수 = 3·⌈(k−2)/3⌉ — k=8 → 6, k=10 → 9', () => {
    assert.equal(patchReferenceCells(8).length, 6);
    assert.equal(patchReferenceCells(10).length, 9);
  });

  test('전부 REFERENCE_DIGIT(3), 전부 hexDistance>k(패치 안, 육각부 아님)', () => {
    for (const k of VERSIONS_K) {
      for (const c of patchReferenceCells(k)) {
        assert.equal(c.digit, REFERENCE_DIGIT, `k=${k}`);
        assert.ok(hexDistance(c.q, c.r) > k, `k=${k} (${c.q},${c.r}) 가 육각부 안`);
        assert.ok(isInRegionA(c.q, c.r, k), `k=${k} (${c.q},${c.r}) 가 A(k) 밖`);
      }
    }
  });

  test('링당 3개 = top 중앙 + rotate120(→BR) + rotate240(→BL)', () => {
    for (const k of VERSIONS_K) {
      const cells = patchReferenceCells(k);
      const rings = patchReferenceRings(k);
      assert.equal(cells.length, rings.length * 3, `k=${k}`);
      for (let i = 0; i < rings.length; i += 1) {
        const [top, br, bl] = cells.slice(3 * i, 3 * i + 3);
        assert.ok(isTopPatch(top.q, top.r, k), `k=${k} ring ${rings[i]} top`);
        const expBr = rotate120(top.q, top.r);
        const expBl = rotate240(top.q, top.r);
        assert.deepEqual({ q: br.q, r: br.r }, expBr, `k=${k} ring ${rings[i]} BR`);
        assert.deepEqual({ q: bl.q, r: bl.r }, expBl, `k=${k} ring ${rings[i]} BL`);
      }
    }
  });

  test('전부 정확히 hexDistance == 해당 링 반경 (ringWalk 소속 확인)', () => {
    for (const k of VERSIONS_K) {
      const rings = patchReferenceRings(k);
      const cells = patchReferenceCells(k);
      for (let i = 0; i < rings.length; i += 1) {
        for (const c of cells.slice(3 * i, 3 * i + 3)) {
          assert.equal(hexDistance(c.q, c.r), rings[i], `k=${k} ring ${rings[i]} (${c.q},${c.r})`);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 역할 분할 — buildRoleSetsA/roleOfA, 육각부는 placement.roleOf 와 바이트 동일
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRoleSetsA / roleOfA', () => {
  test('육각부 셀 전부 placement.roleOf 와 동일한 판정 (D2 안 1 — 바이트 동일 계약)', () => {
    for (const k of VERSIONS_K) {
      const hexSets = buildRoleSets(k);
      const aSets = buildRoleSetsA(k);
      for (const c of regionCells(k)) {
        assert.equal(roleOfA(c.q, c.r, k, aSets), roleOf(c.q, c.r, k, hexSets), `k=${k} (${c.q},${c.r})`);
      }
    }
  });

  test('앵커 6 = 육각 코너 3(anchorCells) + 꼭짓점 3(vertexAnchors)', () => {
    for (const k of VERSIONS_K) {
      const sets = buildRoleSetsA(k);
      assert.equal(sets.anchor.size, 6, `k=${k}`);
      for (const c of anchorCells(k)) assert.ok(sets.anchor.has(key(c)), `k=${k} hex anchor (${c.q},${c.r})`);
      for (const c of vertexAnchors(k)) assert.ok(sets.anchor.has(key(c)), `k=${k} vertex (${c.q},${c.r})`);
    }
  });

  test('레퍼런스 = 육각 2(k-2) + 패치 레퍼런스', () => {
    for (const k of VERSIONS_K) {
      const sets = buildRoleSetsA(k);
      const expected = referenceCellsAll(k).length + patchReferenceCells(k).length;
      assert.equal(sets.reference.size, expected, `k=${k}`);
    }
  });

  test('포맷 = 육각 15셀 그대로 (패치에는 포맷 셀이 없다)', () => {
    for (const k of VERSIONS_K) {
      const sets = buildRoleSetsA(k);
      assert.equal(sets.format.size, 15, `k=${k}`);
      assert.deepEqual([...sets.format].sort(), [...new Set(formatCells(k).map(key))].sort(), `k=${k}`);
    }
  });

  test('역할별 개수 총합 = 총 셀 (bullseye 19 + anchor 6 + format 15 + reference + data)', () => {
    for (const k of VERSIONS_K) {
      const sets = buildRoleSetsA(k);
      const counts = { bullseye: 0, anchor: 0, format: 0, reference: 0, data: 0 };
      for (const c of regionCellsA(k)) counts[roleOfA(c.q, c.r, k, sets)] += 1;
      const total = (3 * k + 1) * (3 * k + 2) / 2;
      assert.equal(
        counts.bullseye + counts.anchor + counts.format + counts.reference + counts.data,
        total,
        `k=${k}`,
      );
      assert.equal(counts.bullseye, 19, `k=${k}`);
      assert.equal(counts.anchor, 6, `k=${k}`);
      assert.equal(counts.format, 15, `k=${k}`);
      assert.equal(counts.reference, referenceCellsAll(k).length + patchReferenceCells(k).length, `k=${k}`);
    }
  });

  test('roleSets 를 생략해도(재계산) 동일 결과', () => {
    for (const k of VERSIONS_K) {
      const c = vertexAnchors(k)[0];
      assert.equal(roleOfA(c.q, c.r, k), 'anchor', `k=${k}`);
    }
  });
});
