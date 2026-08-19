// layoutA.js — Type A scan order-A(T3) + 레이아웃 통합 파사드
// (ADR 0005 D3, docs/adr/0005_typeA_layout.md v1.1 / 0005b §3)
//
// placementA.js 가 이미 확정한 "어디에 무엇을 놓는가"(꼭짓점 앵커·패치 레퍼런스)
// 위에 **데이터 셀의 순회 순서**만 얹는다. layout.js(Type O) 와 대칭 구조 —
// 소비자가 placementA/placement 를 따로 import 하지 않도록 재-export 파사드를
// 겸한다.
//
// [D3 채택 — T3 행 boustrophedon] scan order-A = 육각부 §5.7 순서(=
// `layout.dataCellsInScanOrder(k)`) 그대로 접두 + 패치 꼬리 [top → BR → BL]:
//   top 패치는 행 j=1..k (r=−k−j), 행 내 q∈[j,k], **홀수 행 오름차순·짝수 행
//   내림차순(boustrophedon)**; BR = rotate120(top 순서) · BL = rotate240(top 순서).
//   role === 'data' 인 셀만(앵커·레퍼런스 스킵).
// 후보 4개(T1 링 연장·T2 행 고정방향·T3·B 전역 행 우선) 실측 비교에서 T3 만
// 유일하게 양쪽 k(8·10)에서 "전 그룹 인접쌍 보유 100%" 계약을 보존하고 변
// 스크레이프 터치 심볼도 최소였다(0005b §3 표). 하기 실계산이 그 채택 근거를
// 회귀로 고정한다(layoutA.test.js sha256 스냅샷).
//
// 필러: A1(k=8) 잔여 0(필러 없음) · A2(k=10) 잔여 2 → scan 꼬리 마지막 2셀 =
// (−19,10)·(−19,9) = BL 패치 최외곽 행(실루엣 가장자리, §5.6 취지 유지).
//
// 런타임 의존성 0 · ESM.

import { dataCellsInScanOrder as hexDataCellsInScanOrder } from './layout.js';
import { rotate120, rotate240 } from './placement.js';
import { occupiedCells } from './bullseye.js';
import {
  buildRoleSetsA,
  roleOfA,
  regionCellsA,
  vertexAnchors,
  patchReferenceCells,
} from './placementA.js';
import {
  anchorCells,
  formatCells,
  referenceCellsAll,
} from './placement.js';

function key(q, r) {
  return `${q},${r}`;
}

function assertRadius(k) {
  if (!Number.isInteger(k) || k < 4) {
    throw new RangeError(`k 는 4 이상의 정수여야 한다: ${k}`);
  }
  return k;
}

// ─────────────────────────────────────────────────────────────────────────────
// scan order-A (T3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * top 패치를 행 j=1..k 로 훑되, 홀수 행은 q 오름차순 · 짝수 행은 q 내림차순
 * (boustrophedon). D3 이 채택한 T3 규칙의 핵심 — 인접 행끼리 끝점이 맞물려
 * 연속쌍 인접률이 T2(행 고정방향)보다 높다(0005b §3 실측표).
 */
function topPatchBoustrophedon(k) {
  const out = [];
  for (let j = 1; j <= k; j += 1) {
    const r = -k - j;
    const rowQs = [];
    for (let q = j; q <= k; q += 1) rowQs.push(q);
    if (j % 2 === 0) rowQs.reverse();
    for (const q of rowQs) out.push({ q: q + 0, r: r + 0 });
  }
  return out;
}

/**
 * 패치 꼬리(top → BR → BL, T3 boustrophedon) 중 role === 'data' 인 셀만.
 * 꼭짓점 앵커·패치 레퍼런스는 스킵된다.
 * @param {number} k
 * @param {{anchor:Set<string>, format:Set<string>, reference:Set<string>}} roleSets
 */
function patchDataTail(k, roleSets) {
  const top = topPatchBoustrophedon(k);
  const br = top.map((c) => rotate120(c.q, c.r));
  const bl = top.map((c) => rotate240(c.q, c.r));
  return [...top, ...br, ...bl].filter((c) => roleOfA(c.q, c.r, k, roleSets) === 'data');
}

/**
 * 데이터 셀을 캐노니컬 scan order-A(T3) 로. 육각부 접두(`layout.
 * dataCellsInScanOrder(k)`, 바이트 동일) + 패치 꼬리(top→BR→BL, boustrophedon,
 * role=='data' 만).
 *
 * `finderReserved` 는 육각부 접두에만 전달한다 — daehan 셀은 패치에 0개 (실측).
 * 인자를 안 넘기면 예전과 완전히 같다.
 * @param {number} k
 * @param {Iterable<{q:number,r:number}>|Set<string>} [finderReserved]
 * @returns {{q:number, r:number}[]} 길이 = 데이터 셀 수 (A1(k=8) → 267 · A2(k=10) → 431)
 */
export function dataCellsInScanOrderA(k, finderReserved) {
  assertRadius(k);
  const hexPrefix = hexDataCellsInScanOrder(k, finderReserved);
  const roleSets = buildRoleSetsA(k, finderReserved);
  const tail = patchDataTail(k, roleSets);
  return [...hexPrefix, ...tail];
}

/**
 * scan order-A 의 연속 3셀씩 묶은 심볼 그룹. §4.2 MSD-first 규약 그대로. 마지막
 * (C mod 3) 개는 그룹에 들지 않고 `fillerCellsA` 로 간다.
 * @param {number} k
 * @returns {{q:number, r:number}[][]}
 */
export function symbolCellGroupsA(k, finderReserved) {
  const scan = dataCellsInScanOrderA(k, finderReserved);
  const groupCount = Math.floor(scan.length / 3);
  const groups = [];
  for (let i = 0; i < groupCount; i += 1) {
    groups.push([scan[3 * i], scan[3 * i + 1], scan[3 * i + 2]]);
  }
  return groups;
}

/**
 * 필러 셀 — scan order-A 의 마지막 (C mod 3) 개 (§5.6 준용). A1 은 0개, A2 는
 * 2개 = (−19,10)·(−19,9)(BL 패치 최외곽 행, D3 KAT).
 * @param {number} k
 * @returns {{q:number, r:number}[]}
 */
export function fillerCellsA(k, finderReserved) {
  const scan = dataCellsInScanOrderA(k, finderReserved);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

// ─────────────────────────────────────────────────────────────────────────────
// 통합 레이아웃 맵 (디코더 역독 진입점, layout.js `layoutMap` 대칭)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 영역 A(k) 전 셀의 역할 + (역할 내) 인덱스.
 *
 * 역할별 index 의 기준 목록:
 *   - bullseye  → `bullseye.occupiedCells()` 순서
 *   - anchor    → 육각 코너 3셀(`placement.anchorCells(k)`) + 꼭짓점 3셀
 *                 (`placementA.vertexAnchors(k)`), 이 순서로 이어붙여 인덱스 0..5
 *   - format    → `placement.formatCells(k)` 순서 (육각부 재사용, 무변경)
 *   - reference → 육각 레퍼런스(`placement.referenceCellsAll(k)`) + 패치
 *                 레퍼런스(`placementA.patchReferenceCells(k)`), 이 순서로 이어붙임
 *   - data      → `dataCellsInScanOrderA(k)` 순서 (= scan order-A 인덱스, 심볼
 *                 그룹 번호는 `Math.floor(index / 3)`, 그룹 내 위치는 `index % 3`)
 *
 * @param {number} k
 * @returns {Map<string, {role: 'bullseye'|'anchor'|'format'|'reference'|'data', index: number}>}
 */
export function layoutMapA(k, finderReserved) {
  assertRadius(k);
  const map = new Map();

  occupiedCells().forEach((c, i) => map.set(key(c.q, c.r), { role: 'bullseye', index: i }));
  if (finderReserved) {
    Array.from(finderReserved).forEach((c, i) => map.set(key(c.q, c.r), { role: 'finder', index: i }));
  }

  const anchors = [...anchorCells(k), ...vertexAnchors(k)];
  anchors.forEach((c, i) => map.set(key(c.q, c.r), { role: 'anchor', index: i }));

  formatCells(k).forEach((c, i) => map.set(key(c.q, c.r), { role: 'format', index: i }));

  const references = [...referenceCellsAll(k), ...patchReferenceCells(k)];
  references.forEach((c, i) => map.set(key(c.q, c.r), { role: 'reference', index: i }));

  dataCellsInScanOrderA(k, finderReserved).forEach((c, i) => map.set(key(c.q, c.r), { role: 'data', index: i }));

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 재-export 파사드 — 소비자가 placementA/placement 를 직접 import 하지 않아도 되게
// ─────────────────────────────────────────────────────────────────────────────

export {
  roleOfA,
  buildRoleSetsA,
  regionCellsA,
  vertexAnchors,
  patchReferenceCells,
  anchorCells,
  formatCells,
  referenceCellsAll,
};
export { occupiedCells };
