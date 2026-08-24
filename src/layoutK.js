// layoutK.js — Type K scan order-K + 레이아웃 통합 파사드 (계약 K-4, layoutA.js 대칭)
//
// placementK.js 가 확정한 "어디에 무엇을 놓는가" 위에 **데이터 셀의 순회 순서**만
// 얹는다. 소비자가 placementK/placement 를 따로 import 하지 않도록 재-export
// 파사드를 겸한다.
//
// scan order-K (계약 K-4 — 전부 A 에 이미 있는 규칙, 새 개념 0개):
//   ① 육각 코어: §5.7 순서 그대로 (= layout.dataCellsInScanOrder(k), 바이트 동일 접두)
//   ② 패치 6개: top → BR → BL → TL → bottom → TR
//      (= A 계열 ρ-궤도 3개 먼저, 그 다음 반전 계열 — placementK.patchOrbitsK 순서).
//      각 패치 내부는 A 의 scan 순회(T3 — 행 j=1..k, 홀수 행 q 오름차순 · 짝수 행
//      내림차순 boustrophedon)를 top 프레임에서 정의하고 ρ/반전으로 사상한다.
//      ⚠ 계약 K-4 원문의 «행 안 q 오름차순» 은 A 의 **영역 나열**(placementA
//      topPatchCellsAscending) 서술이고, A 의 실제 scan 규칙은 T3 boustrophedon
//      (layoutA.js D3 채택 — 0005b §3 실측)이다. K-4 의 근거 문장(«전부 A 에 이미
//      있는 규칙»)에 따라 **A 의 실규칙(T3)을 승계**한다 — 레인 보고서 §해석.
//   ③ role === 'data' 인 셀만 (앵커·레퍼런스·포맷·불스아이 스킵). 연속 3셀 = 심볼
//      1개 (MSD-first, §4.2 승계).
//
// 필러: K0 잔여 1 · K1 잔여 0 · K2 잔여 2 — scan 꼬리(마지막 패치 TR 의 끝) = 실루엣
// 가장자리 (§5.6 취지 유지).
//
// 런타임 의존성 0 · ESM.

import { dataCellsInScanOrder as hexDataCellsInScanOrder } from './layout.js';
import { anchorCells, formatCells, referenceCellsAll } from './placement.js';
import { occupiedCells } from './bullseye.js';
import {
  buildRoleSetsK,
  roleOfK,
  regionCellsK,
  patchOrbitsK,
  vertexAnchorsK,
  invertedVertexAnchors,
  patchReferenceCellsK,
  isInRegionK,
  patchOfK,
} from './placementK.js';

function key(q, r) {
  return `${q},${r}`;
}

function assertRadius(k) {
  if (!Number.isInteger(k) || k < 4) {
    throw new RangeError(`k 는 4 이상의 정수여야 한다: ${k}`);
  }
  return k;
}

/**
 * top 패치의 T3 boustrophedon 순회 — layoutA.topPatchBoustrophedon 과 같은 규칙
 * (행 j=1..k, r=−k−j, 홀수 행 q 오름차순 · 짝수 행 내림차순). layoutA 쪽은 비공개
 * 함수라 같은 규칙을 재서술한다 — 두 서술의 일치는 test/layoutK.test.js 가
 * «A 계열 패치 접두 = dataCellsInScanOrderA 의 패치 꼬리» 대조로 잠근다.
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
 * 패치 꼬리(계약 K-4 순서 6패치, T3 boustrophedon) 중 role === 'data' 인 셀만.
 */
function patchDataTail(k, roleSets) {
  return patchOrbitsK(k, topPatchBoustrophedon)
    .flat()
    .filter((c) => roleOfK(c.q, c.r, k, roleSets) === 'data');
}

/**
 * 데이터 셀을 캐노니컬 scan order-K 로. 육각부 접두(layout.dataCellsInScanOrder(k),
 * 바이트 동일) + 패치 꼬리(K-4 순서, role=='data' 만).
 * @param {number} k
 * @returns {{q:number, r:number}[]} 길이 = 데이터 셀 수 (K0 → 190 · K1 → 366 · K2 → 584)
 */
export function dataCellsInScanOrderK(k) {
  assertRadius(k);
  const hexPrefix = hexDataCellsInScanOrder(k);
  const roleSets = buildRoleSetsK(k);
  return [...hexPrefix, ...patchDataTail(k, roleSets)];
}

/**
 * scan order-K 의 연속 3셀씩 묶은 심볼 그룹 (§4.2 MSD-first). 마지막 (C mod 3)
 * 개는 그룹에 들지 않고 fillerCellsK 로 간다.
 */
export function symbolCellGroupsK(k) {
  const scan = dataCellsInScanOrderK(k);
  const groupCount = Math.floor(scan.length / 3);
  const groups = [];
  for (let i = 0; i < groupCount; i += 1) {
    groups.push([scan[3 * i], scan[3 * i + 1], scan[3 * i + 2]]);
  }
  return groups;
}

/**
 * 필러 셀 — scan order-K 의 마지막 (C mod 3) 개 (§5.6 준용).
 */
export function fillerCellsK(k) {
  const scan = dataCellsInScanOrderK(k);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

// ─────────────────────────────────────────────────────────────────────────────
// 통합 레이아웃 맵 (디코더 역독 진입점, layoutA.layoutMapA 대칭)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 영역 K(k) 전 셀의 역할 + (역할 내) 인덱스.
 *
 * 역할별 index 의 기준 목록:
 *   - bullseye  → bullseye.occupiedCells() 순서
 *   - anchor    → 육각 코너 3셀(placement.anchorCells) + 별 꼭짓점 6셀
 *                 (placementK.vertexAnchorsK — A 계열 3 + 반전 계열 3), 인덱스 0..8
 *   - format    → placement.formatCells(k) 순서 (육각부 재사용, 무변경)
 *   - reference → 육각 레퍼런스(placement.referenceCellsAll) + 패치 레퍼런스 R′
 *   - data      → dataCellsInScanOrderK(k) 순서 (= scan order-K 인덱스)
 *
 * @param {number} k
 * @returns {Map<string, {role: 'bullseye'|'anchor'|'format'|'reference'|'data', index: number}>}
 */
export function layoutMapK(k) {
  assertRadius(k);
  const map = new Map();

  occupiedCells().forEach((c, i) => map.set(key(c.q, c.r), { role: 'bullseye', index: i }));

  const anchors = [...anchorCells(k), ...vertexAnchorsK(k)];
  anchors.forEach((c, i) => map.set(key(c.q, c.r), { role: 'anchor', index: i }));

  formatCells(k).forEach((c, i) => map.set(key(c.q, c.r), { role: 'format', index: i }));

  const references = [...referenceCellsAll(k), ...patchReferenceCellsK(k)];
  references.forEach((c, i) => map.set(key(c.q, c.r), { role: 'reference', index: i }));

  dataCellsInScanOrderK(k).forEach((c, i) => map.set(key(c.q, c.r), { role: 'data', index: i }));

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 재-export 파사드
// ─────────────────────────────────────────────────────────────────────────────

export {
  roleOfK,
  buildRoleSetsK,
  regionCellsK,
  vertexAnchorsK,
  invertedVertexAnchors,
  patchReferenceCellsK,
  isInRegionK,
  patchOfK,
  anchorCells,
  formatCells,
  referenceCellsAll,
};
export { occupiedCells };
