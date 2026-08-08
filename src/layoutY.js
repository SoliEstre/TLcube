// layoutY.js — Type Y scan order-Y + 레이아웃 통합 파사드 (SPEC §14, ADR 0003 D5·U7)
//
// placementY.js 가 이미 확정한 "어디에 무엇을 놓는가"(레퍼런스 4조·포맷 15셀) 위에
// **데이터 셀의 순회 순서**(scan order-Y)만 얹는다. layout.js(Type O) 와 대칭 구조 —
// 소비자가 placementY 를 따로 import 하지 않도록 재-export 파사드를 겸한다.
//
// 캐노니컬 정의 (와이어 계약, ADR 0003 D5 "좌표-국소 래스터"의 구체화):
//   j = 0..n-1 오름차순(행), 행 안에서 i = 0..n-1 오름차순, role === 'data' 인
//   셀만(레퍼런스·포맷 스킵). 연속 3셀 = RS 심볼 1개 (d0,d1,d2 MSD-first, §4.2 승계).
//   필러 = 마지막 (C mod 3) 개(§5.6 준용).
//
// 좌표-국소 래스터를 쓰는 이유(ADR D5): 분산 배치 대비 포화 글레어 임계 면적이
// 3.95%→12%로 3배 커진다 — "연속 3셀 = 1심볼 + 공간 인접" 원칙(Type O §5.7)의 Type Y
// 승계.
//
// 런타임 의존성 0 · ESM.

import {
  buildRoleSets,
  roleOf,
  referenceGroups,
  referenceCellsAll,
  formatCells,
} from './placementY.js';

function key(i, j) {
  return `${i},${j}`;
}

function assertSize(n) {
  if (!Number.isInteger(n) || n < 9) {
    throw new RangeError(`n 은 9 이상의 정수여야 한다: ${n}`);
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// scan order-Y
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 데이터 셀을 캐노니컬 scan order-Y 로. j 오름차순(행), 행 안에서 i 오름차순,
 * role === 'data' 인 셀만.
 * @param {number} n
 * @returns {{i:number, j:number}[]} 길이 = 데이터 셀 수
 */
export function dataCellsInScanOrder(n) {
  assertSize(n);
  const roleSets = buildRoleSets(n);
  const out = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      if (roleOf(i, j, n, roleSets) === 'data') out.push({ i, j });
    }
  }
  return out;
}

/**
 * scan order-Y 의 연속 3셀씩 묶은 심볼 그룹. 그룹 내부 순서 = (d0,d1,d2),
 * §4.2 MSD-first 규약 그대로. 마지막 (C mod 3) 개는 그룹에 들지 않고
 * `fillerCells` 로 간다.
 * @param {number} n
 * @returns {{i:number, j:number}[][]} 길이 = ⌊데이터 셀 수 / 3⌋
 */
export function symbolCellGroups(n) {
  const scan = dataCellsInScanOrder(n);
  const groupCount = Math.floor(scan.length / 3);
  const groups = [];
  for (let g = 0; g < groupCount; g += 1) {
    groups.push([scan[3 * g], scan[3 * g + 1], scan[3 * g + 2]]);
  }
  return groups;
}

/**
 * 필러 셀 — scan order-Y 의 마지막 (C mod 3) 개 (§5.6 준용). scan order 꼬리에 온다.
 * @param {number} n
 * @returns {{i:number, j:number}[]}
 */
export function fillerCells(n) {
  const scan = dataCellsInScanOrder(n);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

// ─────────────────────────────────────────────────────────────────────────────
// 통합 레이아웃 맵 (디코더 역독 진입점, layout.js `layoutMap` 대칭)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * n×n 인덱스 격자 전 셀의 역할 + (역할 내) 인덱스.
 *
 * 역할별 index 의 기준 목록:
 *   - reference → `placementY.referenceCellsAll(n)` 순서(조 순 · 조 내 순)
 *   - format    → `placementY.formatCells(n)` 순서(복제 순 · 복제 내 순)
 *   - data      → `dataCellsInScanOrder(n)` 순서(= scan order-Y 인덱스, 심볼
 *                 그룹 번호는 `Math.floor(index / 3)`, 그룹 내 위치는 `index % 3`)
 *
 * @param {number} n
 * @returns {Map<string, {role: 'reference'|'format'|'data', index: number}>}
 */
export function layoutMapY(n) {
  assertSize(n);
  const map = new Map();

  referenceCellsAll(n).forEach((c, i) => map.set(key(c.i, c.j), { role: 'reference', index: i }));
  formatCells(n).forEach((c, i) => map.set(key(c.i, c.j), { role: 'format', index: i }));
  dataCellsInScanOrder(n).forEach((c, i) => map.set(key(c.i, c.j), { role: 'data', index: i }));

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 재-export 파사드 — 소비자가 placementY 를 직접 import 하지 않아도 되게
// ─────────────────────────────────────────────────────────────────────────────

export { roleOf, referenceGroups, referenceCellsAll, formatCells };
