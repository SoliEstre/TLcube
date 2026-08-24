/**
 * placementK.test.js — Type K 영역·앵커·패치 레퍼런스 (계약 K-1·K-2·K-3, Wave 3 ②).
 *
 * 영역 정본은 cell-editor-core.js(isInRegionK/patchOfK — 계약 K-1 «정본은 이미
 * 코드에 있다»)이고 placementK.js 는 레이아웃 층의 재서술이다 — 이 파일이 두
 * 서술의 전수 일치를 잠근다 (사본 부패 방지는 규칙이 아니라 자로).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isInRegionInvertedA,
  isInRegionK,
  patchOfK,
  regionCellsK,
  vertexAnchorsK,
  invertedVertexAnchors,
  patchReferenceCellsK,
  buildRoleSetsK,
  roleOfK,
  ANCHOR_INVERTED_DIGIT,
} from '../src/placementK.js';
import {
  isInRegionInvertedA as coreInverted,
  isInRegionK as coreK,
  patchOfK as corePatch,
} from '../src/cell-editor-core.js';
import { vertexAnchors, patchReferenceCells } from '../src/placementA.js';
import { anchorCells, formatCells, referenceCellsAll } from '../src/placement.js';
import { hexDistance, cellCount } from '../src/hexgrid.js';

const KS = [4, 6, 8, 10];
const key = (c) => c.q + ',' + c.r;

test('영역 판정이 정본(cell-editor-core)과 전수 일치한다', () => {
  for (const k of KS) {
    for (let q = -2 * k - 1; q <= 2 * k + 1; q += 1) {
      for (let r = -2 * k - 1; r <= 2 * k + 1; r += 1) {
        assert.equal(isInRegionInvertedA(q, r, k), coreInverted(q, r, k),
          `k=${k} (${q},${r}) isInRegionInvertedA 불일치`);
        assert.equal(isInRegionK(q, r, k), coreK(q, r, k),
          `k=${k} (${q},${r}) isInRegionK 불일치`);
        assert.equal(patchOfK(q, r, k), corePatch(q, r, k),
          `k=${k} (${q},${r}) patchOfK 불일치`);
      }
    }
  }
});

test('영역 K = 6k²+6k+1 — 코어 + 패치 6개 분해 (계약 K-1 셀 수 표)', () => {
  // 계약 K-1 실계산 표: k=4 → 121(61+6×10) · 6 → 253(127+6×21) · 8 → 433(217+6×36)
  // · 10 → 661(331+6×55).
  const EXPECTED = { 4: 121, 6: 253, 8: 433, 10: 661 };
  for (const k of KS) {
    const region = regionCellsK(k);
    assert.equal(region.length, EXPECTED[k], `k=${k} 총 셀`);
    assert.equal(region.length, 6 * k * k + 6 * k + 1, `k=${k} 닫힌 형태`);
    const core = region.filter((c) => hexDistance(c.q, c.r) <= k);
    assert.equal(core.length, cellCount(k), `k=${k} 코어`);
    const byPatch = new Map();
    for (const c of region) {
      const p = patchOfK(c.q, c.r, k);
      if (p) byPatch.set(p, (byPatch.get(p) || 0) + 1);
    }
    assert.deepEqual([...byPatch.keys()].sort(),
      ['BL', 'BR', 'TL', 'TR', 'bottom', 'top'], `k=${k} 패치 6종`);
    for (const [p, n] of byPatch) {
      assert.equal(n, k * (k + 1) / 2, `k=${k} 패치 ${p} 셀 수`);
    }
    // 중복 없음 + 전수(경계 상자 열거와 집합 동일)
    const seen = new Set(region.map(key));
    assert.equal(seen.size, region.length, `k=${k} 중복`);
    let enumerated = 0;
    for (let q = -2 * k; q <= 2 * k; q += 1) {
      for (let r = -2 * k; r <= 2 * k; r += 1) {
        if (isInRegionK(q, r, k)) {
          enumerated += 1;
          assert.ok(seen.has(q + ',' + r), `k=${k} 누락 (${q},${r})`);
        }
      }
    }
    assert.equal(enumerated, region.length, `k=${k} 전수 열거 수`);
  }
});

test('별 꼭짓점 앵커 6 — A 계열 5/0/0 그대로 + 반전 계열 digit 1 (계약 K-2 채택안)', () => {
  for (const k of KS) {
    const anchors = vertexAnchorsK(k);
    assert.equal(anchors.length, 6);
    // A 계열 3개는 placementA.vertexAnchors 와 바이트 동일 (한 자리도 안 바꾼다).
    assert.deepEqual(anchors.slice(0, 3), vertexAnchors(k), `k=${k} A 계열 승계`);
    // 반전 계열 = A 계열의 180° 상, 전부 digit 1. 순서는 A 계열 사상 순
    // (top→bottom · BR→TL · BL→TR). 좌표는 계약 K-2 표의 세 점과 집합 동일.
    assert.deepEqual(anchors.slice(3), [
      { q: -k, r: 2 * k, digit: 1 },
      { q: -k, r: -k, digit: 1 },
      { q: 2 * k, r: -k, digit: 1 },
    ], `k=${k} 반전 계열`);
    for (const c of anchors.slice(3)) {
      assert.equal(c.digit, ANCHOR_INVERTED_DIGIT);
    }
    // 계약 K-2: 전부 hexDistance = 2k. 반전 좌표 집합 = {(−k,−k),(−k,2k),(2k,−k)}.
    for (const c of anchors) assert.equal(hexDistance(c.q, c.r), 2 * k);
    assert.deepEqual(
      new Set(anchors.slice(3).map(key)),
      new Set([`${-k},${-k}`, `${-k},${2 * k}`, `${2 * k},${-k}`]),
      `k=${k} 반전 꼭짓점 좌표 집합`,
    );
  }
});

test('60° 회전은 A 계열 꼭짓점을 반전 계열 자리로 보낸다 — digit 1 배정의 근거 (K-2)', () => {
  // 축좌표 60° 회전: (q,r) → (−r, q+r). A 계열 기대값 {5,0} 자리에서 1 이 읽히므로
  // 앵커 판정만으로 60° 오가설이 죽는다.
  const rot60 = (c) => ({ q: -c.r, r: c.q + c.r });
  for (const k of KS) {
    const inverted = new Set(invertedVertexAnchors(k).map(key));
    for (const anchor of vertexAnchors(k)) {
      const moved = rot60(anchor);
      assert.ok(inverted.has(key(moved)),
        `k=${k} 60°(${key(anchor)}) = ${key(moved)} 가 반전 꼭짓점이 아니다`);
    }
  }
});

test('패치 레퍼런스 R′ — A 계열 궤도는 A 규칙과 좌표 동일, 링당 6셀 (계약 K-3)', () => {
  // 실측 KAT (2026-08-25 k-probe1.mjs) — 좌표를 그대로 회귀 고정한다.
  const KAT = {
    6: '(4,-8)(4,4)(-8,4)(-4,-4)(8,-4)(-4,8)(6,-11)(5,6)(-11,5)(-5,-6)(11,-5)(-6,11)',
    8: '(5,-10)(5,5)(-10,5)(-5,-5)(10,-5)(-5,10)(7,-13)(6,7)(-13,6)(-6,-7)(13,-6)(-7,13)',
    10: '(6,-12)(6,6)(-12,6)(-6,-6)(12,-6)(-6,12)(8,-15)(7,8)(-15,7)(-7,-8)(15,-7)(-8,15)'
      + '(9,-18)(9,9)(-18,9)(-9,-9)(18,-9)(-9,18)',
  };
  const COUNT = { 6: 12, 8: 12, 10: 18 };
  for (const k of [6, 8, 10]) {
    const refs = patchReferenceCellsK(k);
    assert.equal(refs.length, COUNT[k], `k=${k} R′ 셀 수 (계약 K-6 추정표 18/24/36 아님 — K-3 규칙 실계산)`);
    assert.equal(refs.map((c) => `(${c.q},${c.r})`).join(''), KAT[k], `k=${k} R′ KAT`);
    // A 계열 부분집합: placementA.patchReferenceCells(k) ⊂ R′.
    const keys = new Set(refs.map(key));
    for (const c of patchReferenceCells(k)) {
      assert.ok(keys.has(key(c)), `k=${k} A 규칙 셀 ${key(c)} 이 R′ 에 없다`);
    }
    // 반전 계열 = A 계열의 180° 상 (집합).
    const aSeries = new Set(patchReferenceCells(k).map(key));
    const invSeries = refs.filter((c) => !aSeries.has(key(c)));
    assert.equal(invSeries.length, refs.length / 2);
    for (const c of invSeries) {
      assert.ok(aSeries.has(`${-c.q},${-c.r}`), `k=${k} 반전 레퍼런스 ${key(c)} 의 180° 상이 A 계열에 없다`);
    }
  }
});

test('역할 분할 — 고정 셀이 서로소이고 데이터와 안 겹친다 (계약 K-3 회계 전제)', () => {
  for (const k of [6, 8, 10]) {
    const sets = buildRoleSetsK(k);
    const lists = {
      hexAnchor: anchorCells(k).map(key),
      starAnchor: vertexAnchorsK(k).map(key),
      format: formatCells(k).map(key),
      hexRef: referenceCellsAll(k).map(key),
      patchRef: patchReferenceCellsK(k).map(key),
    };
    const all = Object.values(lists).flat();
    assert.equal(new Set(all).size, all.length, `k=${k} 고정 셀 목록끼리 겹친다`);
    // roleOfK 총계 = 회계 (불스아이 19 + 앵커 9 + 포맷 15 + 레퍼런스 2(k−2)+R′ + 데이터)
    const counts = { bullseye: 0, anchor: 0, format: 0, reference: 0, data: 0 };
    for (const c of regionCellsK(k)) {
      counts[roleOfK(c.q, c.r, k, sets)] += 1;
    }
    assert.equal(counts.bullseye, 19, `k=${k} 불스아이`);
    assert.equal(counts.anchor, 9, `k=${k} 앵커 (육각 3 + 별 6)`);
    assert.equal(counts.format, 15, `k=${k} 포맷`);
    assert.equal(counts.reference, 2 * (k - 2) + lists.patchRef.length, `k=${k} 레퍼런스`);
    assert.equal(
      counts.data,
      regionCellsK(k).length - 19 - 9 - 15 - counts.reference,
      `k=${k} 데이터 잔여 회계`,
    );
  }
});
