// layout.js — 캐노니컬 scan order + 레이아웃 통합 파사드 (SPEC §4.2, §5.6, §13 T8)
//
// 인코더(T9)와 디코더(M1)가 공유하는 단일 진입점. "어디에 무엇을 놓는가"의 개별
// 조각(앵커·포맷·레퍼런스·불스아이)은 placement.js/bullseye.js 가 이미 확정했다 —
// 이 모듈은 그 위에 **데이터 셀의 순회 순서**(scan order)만 얹고, 소비자가
// placement/bullseye 를 따로 import 하지 않도록 재-export 파사드를 겸한다.
//
// scan order 확정 설계 (통합자 확정, 이 파일이 유일한 구현):
//   - ring-major 안→밖 (r = FORMAT_RING(3) .. k), 각 링은 `ringWalk(r)` 인덱스
//     오름차순, **roleOf == 'data' 인 셀만** (앵커·포맷·레퍼런스·불스아이 스킵).
//   - 근거: 새 규약 0개(ringWalk 재사용) · 결정성 자명 · 연속 3셀 = 1 심볼이
//     공간적으로도 인접(버스트 → 심볼 집중 → 3t−2 보장과 정합) · 필러(마지막
//     C mod 3 셀)가 최외곽 링 끝 = 가장자리.
//   - 심볼 그룹: scan order 의 연속 3셀 (d₀,d₁,d₂) = 심볼 1개, §4.2 MSD-first 규약.
//
// 런타임 의존성 0 · ESM.

import { hexDistance } from './hexgrid.js';
import {
  FORMAT_RING,
  buildRoleSets,
  roleOf,
  ringWalk,
  anchorCells,
  formatCells,
  referenceCellsAll,
  overheadBreakdown,
} from './placement.js';
import { occupiedCells } from './bullseye.js';

function key(q, r) {
  return `${q},${r}`;
}

function assertRadius(k) {
  if (!Number.isInteger(k) || k < FORMAT_RING + 1) {
    throw new RangeError(`k 는 ${FORMAT_RING + 1} 이상의 정수여야 한다: ${k}`);
  }
  return k;
}

// ─────────────────────────────────────────────────────────────────────────────
// scan order
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 데이터 셀을 캐노니컬 scan order 로. ring-major 안→밖(r = 3..k), 각 링은
 * `ringWalk(r)` 인덱스 오름차순, role == 'data' 인 셀만.
 * @param {number} k
 * @returns {{q:number, r:number}[]} 길이 = 데이터 셀 수 (예: k=6 → 82)
 */
export function dataCellsInScanOrder(k) {
  assertRadius(k);
  const roleSets = buildRoleSets(k);
  const out = [];
  for (let r = FORMAT_RING; r <= k; r += 1) {
    for (const cell of ringWalk(r)) {
      if (roleOf(cell.q, cell.r, k, roleSets) === 'data') out.push(cell);
    }
  }
  return out;
}

/**
 * scan order 의 연속 3셀씩 묶은 심볼 그룹. 그룹 내부 순서 = (d₀,d₁,d₂),
 * §4.2 MSD-first 규약 그대로. 마지막 C mod 3 개는 그룹에 들지 않고
 * `fillerCells` 로 간다.
 * @param {number} k
 * @returns {{q:number, r:number}[][]} 길이 = ⌊데이터 셀 수 / 3⌋
 */
export function symbolCellGroups(k) {
  const scan = dataCellsInScanOrder(k);
  const groupCount = Math.floor(scan.length / 3);
  const groups = [];
  for (let i = 0; i < groupCount; i += 1) {
    groups.push([scan[3 * i], scan[3 * i + 1], scan[3 * i + 2]]);
  }
  return groups;
}

/**
 * 필러 셀 — scan order 의 마지막 (C mod 3) 개 (§5.6). 최외곽 링(k) 끝에 온다.
 * @param {number} k
 * @returns {{q:number, r:number}[]}
 */
export function fillerCells(k) {
  const scan = dataCellsInScanOrder(k);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

// ─────────────────────────────────────────────────────────────────────────────
// 통합 레이아웃 맵 (디코더 역독 진입점)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 반경 k 영역 전 셀의 역할 + (역할 내) 인덱스.
 *
 * 역할별 index 의 기준 목록:
 *   - bullseye  → `bullseye.occupiedCells()` 순서
 *   - anchor    → `placement.anchorCells(k)` 순서
 *   - format    → `placement.formatCells(k)` 순서
 *   - reference → `placement.referenceCellsAll(k)` 순서
 *   - data      → `dataCellsInScanOrder(k)` 순서 (= scan order 인덱스,
 *                 심볼 그룹 번호는 `Math.floor(index / 3)`, 그룹 내 위치는
 *                 `index % 3`)
 *
 * @param {number} k
 * @returns {Map<string, {role: 'bullseye'|'anchor'|'format'|'reference'|'data', index: number}>}
 */
export function layoutMap(k) {
  assertRadius(k);
  const map = new Map();

  occupiedCells().forEach((c, i) => map.set(key(c.q, c.r), { role: 'bullseye', index: i }));
  anchorCells(k).forEach((c, i) => map.set(key(c.q, c.r), { role: 'anchor', index: i }));
  formatCells(k).forEach((c, i) => map.set(key(c.q, c.r), { role: 'format', index: i }));
  referenceCellsAll(k).forEach((c, i) => map.set(key(c.q, c.r), { role: 'reference', index: i }));
  dataCellsInScanOrder(k).forEach((c, i) => map.set(key(c.q, c.r), { role: 'data', index: i }));

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 재-export 파사드 — 소비자가 placement/bullseye 를 직접 import 하지 않아도 되게
// ─────────────────────────────────────────────────────────────────────────────

export {
  roleOf,
  overheadBreakdown,
  anchorCells,
  formatCells,
  referenceCellsAll,
};
export { occupiedCells };
export { hexDistance };
