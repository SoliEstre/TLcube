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

/*
 * ── 파인더 예약 인자 (2026-08-18 daehan 편입) ────────────────────────────────
 *
 * 아래 네 함수는 전부 **선택 인자** `finderReserved` 를 받는다. 불스아이 19셀 밖에
 * 셀을 더 쓰는 파인더(지금은 daehan 하나뿐)가 그 좌표들을 넘기면 role 이 'finder' 가
 * 되어 scan order 에서 빠진다.
 *
 * **인자를 안 넘기면 예전과 완전히 같다** — `buildRoleSets(k)` 의 두 번째 인자가
 * undefined 면 빈 Set 이 되고, 빈 Set 은 `roleOf` 의 어느 셀도 못 잡는다. 기존
 * 호출부(encode.js 레거시 경로 · decode.js · bootstrap.js · 전 테스트)는 한 글자도
 * 안 고쳐도 값이 안 바뀐다 (회귀: `overheadBreakdown(6).total === 45`,
 * `dataCellsInScanOrder(6).length === 82`).
 *
 * 왜 인자이고 별도 함수(`dataCellsInScanOrderDaehan`)가 아닌가: O-CM 은 format ·
 * reference 좌표까지 `autoplaceHex` 로 **재유도**하므로 scan order 함수가 통째로
 * 달라야 했다. daehan 은 다르다 — 예약 60셀이 anchor/format/reference 와 **하나도
 * 안 겹치는 것이 실측으로 확인**됐고(전 k), 그래서 바뀌는 것은 「어떤 셀이 data 가
 * 아닌가」 한 가지뿐이다. 규칙이 하나만 다른데 함수를 복제하면 나머지 규칙이 갈린다.
 */

/**
 * 데이터 셀을 캐노니컬 scan order 로. ring-major 안→밖(r = 3..k), 각 링은
 * `ringWalk(r)` 인덱스 오름차순, role == 'data' 인 셀만.
 * @param {number} k
 * @param {Iterable<{q:number,r:number}>|Set<string>} [finderReserved] 파인더 예약 셀
 * @returns {{q:number, r:number}[]} 길이 = 데이터 셀 수 (예: k=6 → 82, daehan k=6 → 62)
 */
export function dataCellsInScanOrder(k, finderReserved) {
  assertRadius(k);
  const roleSets = buildRoleSets(k, finderReserved);
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
 * @param {Iterable<{q:number,r:number}>|Set<string>} [finderReserved]
 * @returns {{q:number, r:number}[][]} 길이 = ⌊데이터 셀 수 / 3⌋
 */
export function symbolCellGroups(k, finderReserved) {
  const scan = dataCellsInScanOrder(k, finderReserved);
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
 * @param {Iterable<{q:number,r:number}>|Set<string>} [finderReserved]
 * @returns {{q:number, r:number}[]}
 */
export function fillerCells(k, finderReserved) {
  const scan = dataCellsInScanOrder(k, finderReserved);
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
 * 파인더 예약 셀을 넘기면 `role: 'finder'` 로 표시되고 data 목록에서 빠진다.
 * 예약 셀은 **bullseye 다음, anchor 앞**에 넣는다 — `roleOf` 의 우선순위(파인더가
 * anchor 를 이긴다)와 같은 순서여야 두 경로가 안 갈린다. index 는
 * `finder-daehan.daehanReservedCells(k)` 순서다.
 *
 * @param {number} k
 * @param {Iterable<{q:number,r:number}>} [finderReserved]
 * @returns {Map<string, {role: 'bullseye'|'finder'|'anchor'|'format'|'reference'|'data', index: number}>}
 */
export function layoutMap(k, finderReserved) {
  assertRadius(k);
  const map = new Map();

  occupiedCells().forEach((c, i) => map.set(key(c.q, c.r), { role: 'bullseye', index: i }));
  if (finderReserved) {
    Array.from(finderReserved).forEach((c, i) => map.set(key(c.q, c.r), { role: 'finder', index: i }));
  }
  anchorCells(k).forEach((c, i) => map.set(key(c.q, c.r), { role: 'anchor', index: i }));
  formatCells(k).forEach((c, i) => map.set(key(c.q, c.r), { role: 'format', index: i }));
  referenceCellsAll(k).forEach((c, i) => map.set(key(c.q, c.r), { role: 'reference', index: i }));
  dataCellsInScanOrder(k, finderReserved)
    .forEach((c, i) => map.set(key(c.q, c.r), { role: 'data', index: i }));

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
