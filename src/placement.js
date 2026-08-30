// placement.js — 앵커 3셀 + 포맷 정보 15셀 + 레퍼런스 셀 배치 맵 (SPEC §5.2, §5.3, §5.4, §13 T6)
//
// 이 모듈은 "어디에 무엇을 놓는가"만 다룬다. 포맷 정보 12bit → base-6 5심볼 변환(§5.4,
// T7 하드 블로커)이나 scan order(§13, T8)는 여기서 확정하지 않는다 — 이 모듈이 내는
// 셀 좌표 목록이 그 두 작업의 입력이 된다.
//
// 불스아이 풋프린트는 SPEC 이 이미 고정했다: hexDistance ≤ 2 (19셀). bullseye.js 는
// 동시 작성 중이라 import 하지 않고 여기서 직접 hexDistance 로 판정한다(과제 지침).
//
// ─────────────────────────────────────────────────────────────────────────────
// 앵커 3셀 (§5.2, "확정할 것 1")
// ─────────────────────────────────────────────────────────────────────────────
//
// 외곽 6개 코너는 axial 좌표로 (k,0)·(0,k)·(-k,k)·(-k,0)·(0,-k)·(k,-k) 이다. 이 순서를
// `CORNER_DIRECTIONS` 로 고정한다 — 인접 코너 사이는 60°, 한 칸씩 건너뛰면 120°다.
//
// **rhombille 분할은 120° 대칭만 갖는다** (hexgrid.js 헤더 주석: 면 오프셋이 전 셀
// 동일하고 spine 이 {0,2,4} 꼭짓점에 고정되므로, 60°/180°/240°/300° 회전은 T/L/R 면
// 배정 자체를 깨뜨린다 — 유효한 대칭군은 항등·120°·240° 뿐이다). 따라서 앵커는
// **교대(alternating) 3개**를 골라야 "임의의 유효 회전에서 앵커 3점이 여전히 앵커
// 위치 집합"이라는 성질이 성립한다. 후보는 두 세트뿐이다:
//   세트 A = 코너 인덱스 {0,2,4} = { (k,0), (-k,k), (0,-k) }
//   세트 B = 코너 인덱스 {1,3,5} = { (0,k), (-k,0), (k,-k) }
// 어느 쪽이든 120°-불변 성질은 동일하게 성립한다(대칭적인 선택지라 구조적 우열이
// 없다). **세트 A를 채택한다** — `CORNER_DIRECTIONS` 열거 순서의 첫 코너 (k,0) 를
// 포함해 "정준 목록의 짝수 인덱스"로 서술하기 가장 단순하고, 이후 §5.4 포맷 정보의
// ring-3 순회 시작점·§5.3 레퍼런스 셀의 충돌 회피 규칙과 같은 인덱스 산술
// (`ringWalk` 참조)을 그대로 재사용할 수 있어 코드 전체의 회전 산술이 한 가지
// 공식으로 통일된다.
//
// 방향 기준점(어느 코너가 digit 5 인가): 세트 A 의 첫 원소 (k,0) 를 5, 나머지 두
// 코너를 0 으로 둔다. **왜 유일하게 결정되는가**: 세 앵커 위치의 집합 자체는
// 120°/240° 회전에 불변이지만, "이 물리적 좌표에 이 digit 이 찍혀 있다"는 배정
// 함수는 항등 회전에서만 자기 자신과 같다 — 120°/240° 만큼 회전한 패턴은 5가 찍힌
// 위치가 다른 코너로 옮겨가므로 원본과 달라진다(아래 `test/placement.test.js` 가
// 전수로 단언). 즉 디코더가 "5 찍힌 앵커가 어디 있는가"만 읽으면 세 회전 후보 중
// 정확히 하나만 남는다.

import { hexDistance, AXIAL_DIRECTIONS } from './hexgrid.js';

// ─────────────────────────────────────────────────────────────────────────────
// 기본 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 불스아이 풋프린트 반경 (SPEC §5.1: hexDistance ≤ 2, 19셀). */
export const BULLSEYE_RADIUS = 2;

/**
 * 외곽 6 코너의 단위 방향 (k 를 곱하면 실제 코너 좌표). 60° 간격 정준 순서.
 * @type {ReadonlyArray<{q:number, r:number}>}
 */
export const CORNER_DIRECTIONS = Object.freeze([
  Object.freeze({ q: 1, r: 0 }), //  0: (k, 0)
  Object.freeze({ q: 0, r: 1 }), //  1: (0, k)
  Object.freeze({ q: -1, r: 1 }), //  2: (-k, k)
  Object.freeze({ q: -1, r: 0 }), //  3: (-k, 0)
  Object.freeze({ q: 0, r: -1 }), //  4: (0, -k)
  Object.freeze({ q: 1, r: -1 }), //  5: (k, -k)
]);

/** 앵커로 쓰는 코너 인덱스 — 세트 A(교대 인덱스, 위 주석 근거). */
export const ANCHOR_CORNER_INDICES = Object.freeze([0, 2, 4]);

/**
 * Type C(3시 노치) 반경은 **세트 B** {1,3,5} 를 쓴다 — 노치 v2 가 (k,0) 코너를
 * 실루엣째 파내므로 세트 A 의 기준 앵커 자리가 사라진다. 교대 3코너의 유효한
 * 선택지는 두 세트뿐이고(위 주석), 세트 B 도 120°-불변·회전 유일성 성질이 같다.
 * k=14/16/18/20 은 C 전용 반경이라 이 분기는 다른 타입의 배치를 건드리지 않는다.
 * ⚠ 이 목록은 formatC.js `TYPE_C_RADII` 와 같아야 한다 — capacityC.js 로드
 * 자기검증이 두 목록의 일치를 단언한다 (여기서 import 하면 순환이라 사본을 두되
 * 자로 잠근다).
 */
export const ANCHOR_SET_B_RADII = Object.freeze([14, 16, 18, 20]);
export const ANCHOR_CORNER_INDICES_SET_B = Object.freeze([1, 3, 5]);

/**
 * 반경 k 가 쓰는 앵커 코너 인덱스 목록.
 *
 * 기본은 k 유도다 — 확장 반경(k ≥ 14)의 **발행 와이어는 Type C** 라 세트 B 가
 * 정권이다. 단 같은 k 를 쓰는 **G(코너 자리) 정권은 구조적으로 세트 A 전용**이다
 * (markerO ρ 궤도 정리 — tetrad 가 세트 A 코너에 산다. C×CM 거절이 두 정권의
 * 비겹침을 보증한다). 그래서 G 계열(markerO·autoplaceHex)은 `set: 'A'` 를 명시로
 * 넘겨 k 유도를 우회한다 — lab 확장 반경의 평 O 는 기본(세트 B)을 그대로 쓴다.
 * @param {number} k
 * @param {'A'|'B'} [set] 명시 세트 (생략 시 k 유도)
 */
export function anchorCornerIndicesFor(k, set) {
  if (set === 'A') return ANCHOR_CORNER_INDICES;
  if (set === 'B') return ANCHOR_CORNER_INDICES_SET_B;
  return ANCHOR_SET_B_RADII.includes(k) ? ANCHOR_CORNER_INDICES_SET_B : ANCHOR_CORNER_INDICES;
}

/** 앵커 중 digit 5 를 받는 코너 인덱스(= 방향 기준점). 나머지 앵커는 digit 0. */
export const ANCHOR_PRIMARY_INDEX = 0;

/** 앵커 digit 값 (SPEC §5.2: (0,0,5)). */
export const ANCHOR_PRIMARY_DIGIT = 5;
export const ANCHOR_SECONDARY_DIGIT = 0;

/** 포맷 정보가 사는 링 번호 (불스아이 인접 링, §5.4). */
export const FORMAT_RING = 3;

/** 포맷 정보 반복 블록 길이(5셀) · 개수(3, 120° 간격) (§5.4). */
export const FORMAT_BLOCK_LENGTH = 5;
export const FORMAT_REPLICAS = 3;

/** 레퍼런스 셀에 배정하는 알려진 digit — 앵커 값 {0,5} 와 달라야 한다(§5.3 "확정할 것 3"). */
export const REFERENCE_DIGIT = 3;

function assertRadius(k) {
  if (!Number.isInteger(k) || k < FORMAT_RING + 1) {
    // FORMAT_RING(=3) 자체가 데이터 링이려면 앵커 링(k)보다 작아야 한다.
    throw new RangeError(`k 는 ${FORMAT_RING + 1} 이상의 정수여야 한다: ${k}`);
  }
  return k;
}

function key(q, r) {
  return `${q},${r}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 회전 (120°/240°, cube 좌표 기반 — rhombille 이 갖는 유일한 비자명 대칭)
// ─────────────────────────────────────────────────────────────────────────────

/** axial (q,r) 를 원점 기준 120° 회전. */
export function rotate120(q, r) {
  return { q: -q - r, r: q };
}

/** axial (q,r) 를 원점 기준 240° 회전 (= rotate120 두 번). */
export function rotate240(q, r) {
  return { q: r, r: -q - r };
}

// ─────────────────────────────────────────────────────────────────────────────
// 외곽 코너 · 앵커
// ─────────────────────────────────────────────────────────────────────────────

/** 반경 k 영역의 외곽 코너 6개, `CORNER_DIRECTIONS` 순서대로. */
export function corners(k) {
  assertRadius(k);
  return CORNER_DIRECTIONS.map((d) => ({ q: d.q * k, r: d.r * k }));
}

/**
 * 앵커 3셀과 digit 배정.
 * @param {number} k
 * @returns {{q:number, r:number, digit:number}[]} 길이 3
 */
export function anchorCells(k, set) {
  const all = corners(k);
  const indices = anchorCornerIndicesFor(k, set);
  return indices.map((idx) => ({
    ...all[idx],
    digit: idx === indices[ANCHOR_PRIMARY_INDEX]
      ? ANCHOR_PRIMARY_DIGIT
      : ANCHOR_SECONDARY_DIGIT,
  }));
}

/** 앵커 좌표 집합 (Set<"q,r">). digit 무관, 위치만. */
export function anchorPositionSet(k, set) {
  return new Set(anchorCells(k, set).map((c) => key(c.q, c.r)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 링 순회 (표준 hex-ring walk, 각도순 — format/reference 인덱스 산술의 기반)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 반경 r 인 링(hexDistance == r)의 셀을, 코너 `CORNER_DIRECTIONS[2]·r` (= `(-r, r)`) 에서 시작해
 * `AXIAL_DIRECTIONS[0..5]` 순서로 각 변을 r 걸음씩 걸어 각도순으로 나열한다.
 * 길이 6r (r=0 이면 [{0,0}] 길이 1). 코너는 정확히 인덱스 0, r, 2r, 3r, 4r, 5r 에 온다
 * (증명: `test/placement.test.js` 가 이 성질과 §5.2 앵커 인덱스 일치를 검증한다).
 * @param {number} r
 * @returns {{q:number, r:number}[]}
 */
export function ringWalk(r) {
  if (!Number.isInteger(r) || r < 0) {
    throw new RangeError(`링 반경 r 은 0 이상의 정수여야 한다: ${r}`);
  }
  if (r === 0) return [{ q: 0, r: 0 }];
  let cur = { q: AXIAL_DIRECTIONS[4].q * r, r: AXIAL_DIRECTIONS[4].r * r };
  const cells = [];
  for (let dir = 0; dir < 6; dir += 1) {
    for (let step = 0; step < r; step += 1) {
      cells.push({ q: cur.q, r: cur.r });
      cur = { q: cur.q + AXIAL_DIRECTIONS[dir].q, r: cur.r + AXIAL_DIRECTIONS[dir].r };
    }
  }
  return cells;
}

// ─────────────────────────────────────────────────────────────────────────────
// 포맷 정보 15셀 (§5.4, "확정할 것 2")
// ─────────────────────────────────────────────────────────────────────────────
//
// 시작 위치·진행 방향: `ringWalk(FORMAT_RING)` 인덱스 0 = 코너 `CORNER_DIRECTIONS[2]·3`
// = `(-3, 3)` 에서 시작해 `AXIAL_DIRECTIONS[0..5]` 순서로 진행한다.
// (v1 주석은 CORNER_DIRECTIONS[4] 로 잘못 적었었다 — 검증 라운드 정정. 코드가 정본이고
//  실측 ringWalk(3)[0] = (-3,3) 이다. 이 규약은 인코더/디코더 공통 와이어 계약이다.)
// 링3 은 18셀(6·3). 5셀 블록 3개(=15셀)를 120° 간격(= 인덱스 +6, 18/3)으로 두면
// 인덱스 [0-4], [6-10], [12-16] 이 포맷이고 [5, 11, 17] 세 칸이 남는다 — SPEC 이
// 명시한 "18셀 중 15개가 포맷, 3개만 남는다"와 정확히 일치한다.

/** 포맷 블록 하나의 시작 인덱스(링3 순회 기준), 120° 간격 3개. */
export function formatBlockStarts() {
  const ringSize = 6 * FORMAT_RING;
  const step = ringSize / FORMAT_REPLICAS;
  return Array.from({ length: FORMAT_REPLICAS }, (_, i) => i * step);
}

/** 포맷 정보 15셀 (블록 3개 × 5셀, ring3 순회 순서 그대로 이어붙임). */
export function formatCells(k) {
  assertRadius(k);
  const ring = ringWalk(FORMAT_RING);
  const cells = [];
  for (const start of formatBlockStarts()) {
    for (let i = 0; i < FORMAT_BLOCK_LENGTH; i += 1) {
      cells.push(ring[(start + i) % ring.length]);
    }
  }
  return cells;
}

/** 포맷 정보가 차지하지 않는 ring3 의 나머지 셀 (18 - 15 = 3개). */
export function formatRingLeftoverCells() {
  const ring = ringWalk(FORMAT_RING);
  const occupied = new Set();
  for (const start of formatBlockStarts()) {
    for (let i = 0; i < FORMAT_BLOCK_LENGTH; i += 1) occupied.add((start + i) % ring.length);
  }
  return ring.filter((_, idx) => !occupied.has(idx));
}

function formatOccupiedIndexSet() {
  const ringSize = 6 * FORMAT_RING;
  const occupied = new Set();
  for (const start of formatBlockStarts()) {
    for (let i = 0; i < FORMAT_BLOCK_LENGTH; i += 1) occupied.add((start + i) % ringSize);
  }
  return occupied;
}

// ─────────────────────────────────────────────────────────────────────────────
// 레퍼런스 셀 (§5.3, "확정할 것 3") — 데이터 링(ring 3..k)당 정확히 2개
// ─────────────────────────────────────────────────────────────────────────────
//
// 규칙(오직 (k, ring) 으로 결정): `ringWalk(r)` 순회에서 인덱스 0 부터, 그리고
// 인덱스 `3r`(= 정확히 180° 대척점) 부터 각각 정방향으로 선형 탐색해 "점유되지
// 않은" 첫 인덱스를 잡는다. 점유 판정은 다음 두 경우뿐이다(그 외 링은 아무 것도
// 점유하지 않으므로 정확히 대척점 쌍이 나온다 — "각도상 최대 분리" 요건 충족):
//   - r === FORMAT_RING(3): 포맷 15셀이 점유 → 위 §5.4 의 occupied 인덱스 집합
//   - r === k(앵커 링): 앵커 3셀이 점유 → 세트 A 코너가 이 순회에서 정확히
//     인덱스 {0, 2r, 4r} 에 온다(§5.2 주석 · `ringWalk` docstring 의 코너 인덱스
//     성질 + ANCHOR_CORNER_INDICES = {0,2,4} 조합)
// r===3 인 경우 탐색 결과는 항상 {5, 11} 로 수렴한다 — 링3 여유 3칸 {5,11,17} 중
// 앞의 두 칸. 결정적이며 앵커·포맷과 무충돌임이 알고리즘적으로 보장된다.

function ringOccupiedIndexSet(k, r) {
  const occupied = new Set();
  if (r === FORMAT_RING) {
    for (const idx of formatOccupiedIndexSet()) occupied.add(idx);
  }
  if (r === k) {
    const ringSize = 6 * r;
    // 앵커 세트는 k 유도다 — 세트 B 반경(Type C)에서 세트 A 인덱스를 회피하면
    // 레퍼런스가 실제 앵커 위에 앉는다.
    for (const idx of anchorCornerIndicesFor(k)) {
      // corners()[idx] 는 ringWalk(r) 에서 인덱스 (idx 를 코너-슬롯 순서로 재사상)에
      // 온다. corners() 순서 [0..5] ↔ ringWalk 코너 인덱스 [2r,r,0,5r,4r,3r]
      // (docstring 유도: dir4·r 시작 = corners()[2], 이후 dir0 r걸음 = corners()[1], ...).
      const cornerToRingIndex = [2 * r, r, 0, 5 * r, 4 * r, 3 * r];
      occupied.add(cornerToRingIndex[idx] % ringSize);
    }
  }
  return occupied;
}

/**
 * 링 r(3..k)의 레퍼런스 2셀. `ringWalk(r)` 인덱스 기준 0 과 `3r` 에서 점유 인덱스를
 * 건너뛰며 선형 탐색해 결정적으로 고른다.
 * @param {number} k
 * @param {number} r FORMAT_RING(3) 이상 k 이하
 * @returns {{q:number, r:number}[]} 길이 2
 */
export function referenceCells(k, r) {
  assertRadius(k);
  if (!Number.isInteger(r) || r < FORMAT_RING || r > k) {
    throw new RangeError(`레퍼런스 링 r 은 ${FORMAT_RING}..${k} 범위여야 한다: ${r}`);
  }
  const ring = ringWalk(r);
  const ringSize = ring.length;
  const occupied = ringOccupiedIndexSet(k, r);

  const taken = new Set();
  function pickFrom(startIdx) {
    for (let step = 0; step < ringSize; step += 1) {
      const idx = (startIdx + step) % ringSize;
      if (!occupied.has(idx) && !taken.has(idx)) {
        taken.add(idx);
        return idx;
      }
    }
    throw new RangeError(`k=${k} r=${r}: 레퍼런스 셀을 배치할 빈 칸이 없다`);
  }

  const i1 = pickFrom(0);
  const i2 = pickFrom(Math.floor(ringSize / 2));
  return [i1, i2].map((idx) => ({ ...ring[idx], digit: REFERENCE_DIGIT }));
}

/** 데이터 링 전부(3..k)의 레퍼런스 셀을 이어붙인 목록. */
export function referenceCellsAll(k) {
  assertRadius(k);
  const out = [];
  for (let r = FORMAT_RING; r <= k; r += 1) out.push(...referenceCells(k, r));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 역할 분할 (§5.4 "확정할 것 4")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 반경 k 영역 전체의 역할 분류표를 한 번에 만든다 (roleOf 를 셀마다 다시 계산하지
 * 않도록 Set 을 미리 구성 — 전수 테스트에서 O(k²) 반복이 O(k) 조회가 되게 한다).
 * @param {number} k
 * @returns {{bullseye: Set<string>, anchor: Set<string>, format: Set<string>, reference: Set<string>}}
 */
export function buildRoleSets(k, finderReserved) {
  assertRadius(k);
  const anchor = anchorPositionSet(k);
  const format = new Set(formatCells(k).map((c) => key(c.q, c.r)));
  const reference = new Set(referenceCellsAll(k).map((c) => key(c.q, c.r)));
  // 파인더 예약 (2026-08-18, daehan 편입) — **불스아이 19셀 밖**에 셀을 더 쓰는
  // 파인더가 처음 생겼다. 기본은 빈 집합이라 이 인자를 안 넘기면 예전과 완전히 같다.
  //
  // ⚠ 이 셀들은 현재 전부 role 'data' 다 (실측: claude-daehan-cost.mjs). 즉 이 예약은
  //   **용량을 실제로 깎는다** — anchor/format/reference 와 겹쳐 «공짜로» 얻는 게
  //   아니다. 그래서 capacity.js 가 별도 스펙 행을 들어야 하고, 그냥 여기만 고치면
  //   NSYM_TABLE 심볼 수와 어긋나 capacityFor 가 던진다 (일부러 그렇게 돼 있다).
  const finder = finderReserved instanceof Set
    ? finderReserved
    : new Set((finderReserved || []).map((c) => key(c.q, c.r)));
  return { anchor, format, reference, finder };
}

/**
 * 셀 (q,r) 의 역할.
 * @param {number} q
 * @param {number} r
 * @param {number} k
 * @param {{anchor:Set<string>, format:Set<string>, reference:Set<string>}} [roleSets]
 *   `buildRoleSets(k)` 결과를 미리 넘기면 전수 테스트에서 재계산을 피한다.
 * @returns {'bullseye'|'anchor'|'format'|'reference'|'data'}
 */
export function roleOf(q, r, k, roleSets) {
  const d = hexDistance(q, r);
  if (d <= BULLSEYE_RADIUS) return 'bullseye';
  const sets = roleSets || buildRoleSets(k);
  const kk = key(q, r);
  // 파인더 예약을 anchor 보다 **먼저** 본다. 지금 daehan 의 12셀은 anchor/format/
  // reference 와 하나도 안 겹치므로(실측) 순서가 결과를 안 바꾸지만, 겹치는 날
  // «파인더가 이긴다» 가 맞다 — 파인더는 검출 기구라 다른 역할이 그 위에 그려지면
  // 검출 자체가 깨진다. 그 규약을 순서로 못 박아 둔다.
  if (sets.finder && sets.finder.has(kk)) return 'finder';
  if (sets.anchor.has(kk)) return 'anchor';
  if (sets.format.has(kk)) return 'format';
  if (sets.reference.has(kk)) return 'reference';
  return 'data';
}

// ─────────────────────────────────────────────────────────────────────────────
// 오버헤드 집계 (§5.5 "확정할 것 5" — capacity.js 는 절대 건드리지 않는다)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 버전 k 의 비데이터 셀 실계산 합. capacity.js 의 `overhead` 잠정치(45/50/55)와
 * **대조만** 한다 — 이 함수는 capacity.js 를 읽지도 쓰지도 않는다.
 * @param {number} k
 */
export function overheadBreakdown(k, finderReservedCount = 0) {
  assertRadius(k);
  if (!Number.isInteger(finderReservedCount) || finderReservedCount < 0) {
    throw new RangeError('파인더 예약 셀 수는 0 이상 정수여야 한다: ' + finderReservedCount);
  }
  const bullseye = 3 * BULLSEYE_RADIUS * BULLSEYE_RADIUS + 3 * BULLSEYE_RADIUS + 1; // cellCount(2)
  const anchor = ANCHOR_CORNER_INDICES.length;
  const format = FORMAT_BLOCK_LENGTH * FORMAT_REPLICAS;
  const reference = 2 * (k - FORMAT_RING + 1); // 링 FORMAT_RING..k, 링당 2개
  // 파인더 예약 (2026-08-18) — 기본 0 이라 인자를 안 넘기면 예전 값 그대로다.
  // 여기 세는 것은 «불스아이 19셀 **밖**» 의 파인더 셀만이다 (안쪽은 bullseye 가 이미 셌다).
  return {
    k,
    bullseye,
    anchor,
    format,
    reference,
    finder: finderReservedCount,
    total: bullseye + anchor + format + reference + finderReservedCount,
  };
}
