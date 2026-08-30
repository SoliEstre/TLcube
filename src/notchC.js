/**
 * notchC.js — Type C 3시 노치의 좌표 정본.
 *
 * 노치는 3시 코너 `(k, 0)`에 상대적인 고정 8셀이다. k가 커져도 폭을 늘리지 않는다.
 * 좌표 규칙은 운영자가 확정한 k=6 축소 개념을 일반화한 것이며, 아래 로드
 * 자기검증이 그 정본 8셀과 배열 순서·집합을 모두 대조한다.
 *
 * 런타임 의존성 0 원칙을 지키기 위해 JSON을 브라우저 번들에 싣지 않는다. 대신 규칙과
 * 독립된 k=6 절대좌표 오라클을 함께 두고, 둘이 갈리면 모듈 로드에서 즉시 실패한다.
 */

import { hexDistance } from './hexgrid.js';

/** Type C가 지원하는 최소 반경. k=6은 개념도 자기검증에만 쓰인다. */
export const TYPE_C_MIN_RADIUS = 6;

/** 규약상 노치 셀 수. */
export const NOTCH_C_CELL_COUNT = 8;

/** 3시 코너 `(k,0)` 상대 오프셋 `[dq, dr]` — 개념도 등장 순서 그대로. */
export const NOTCH_C_RELATIVE_OFFSETS = Object.freeze([
  Object.freeze([-3, 1]),
  Object.freeze([-2, -1]),
  Object.freeze([-2, 0]),
  Object.freeze([-2, 1]),
  Object.freeze([-1, -1]),
  Object.freeze([-1, 0]),
  Object.freeze([-1, 1]),
  Object.freeze([0, -1]),
]);

function assertRadius(k) {
  if (!Number.isInteger(k) || k < TYPE_C_MIN_RADIUS) {
    throw new RangeError(`Type C 반경 k는 ${TYPE_C_MIN_RADIUS} 이상의 정수여야 한다: ${k}`);
  }
  return k;
}

function cellKey(q, r) {
  return `${q},${r}`;
}

/**
 * 반경 k의 3시 노치 8셀. 반환 순서는 `NOTCH_C_RELATIVE_OFFSETS` 순서다.
 * @param {number} k
 * @returns {ReadonlyArray<Readonly<{q:number,r:number}>>}
 */
export function notchCellsC(k) {
  assertRadius(k);
  return Object.freeze(
    NOTCH_C_RELATIVE_OFFSETS.map(([dq, dr]) => Object.freeze({ q: k + dq, r: dr })),
  );
}

/** 반경 k의 노치 좌표 집합 (`Set<"q,r">`). */
export function notchPositionSetC(k) {
  return new Set(notchCellsC(k).map((cell) => cellKey(cell.q, cell.r)));
}

/**
 * 노치와 추가 예약 셀을 하나의 목록으로 합친다. Type C 인코더가 일반 C에서는 노치만,
 * C*D에서는 노치+사괘를 같은 scan-order 제외 목록으로 넘기는 단일 진입점이다.
 * 겹침은 회계를 두 번 세는 오류이므로 조용히 중복 제거하지 않고 던진다.
 *
 * @param {number} k
 * @param {Iterable<{q:number,r:number}>} [additionalReserved]
 */
export function typeCReservedCells(k, additionalReserved) {
  assertRadius(k);
  const out = notchCellsC(k).map((cell) => ({ q: cell.q, r: cell.r }));
  const seen = new Set(out.map((cell) => cellKey(cell.q, cell.r)));
  for (const cell of additionalReserved || []) {
    if (!cell || !Number.isInteger(cell.q) || !Number.isInteger(cell.r)) {
      throw new TypeError('Type C 추가 예약 셀은 정수 q,r 좌표여야 한다');
    }
    if (hexDistance(cell.q, cell.r) > k) {
      throw new RangeError(`Type C 추가 예약 셀이 반경 k=${k} 밖이다: ${cellKey(cell.q, cell.r)}`);
    }
    const key = cellKey(cell.q, cell.r);
    if (seen.has(key)) {
      throw new RangeError(`Type C 노치·추가 예약 셀 중복: ${key}`);
    }
    seen.add(key);
    out.push({ q: cell.q, r: cell.r });
  }
  return Object.freeze(out.map((cell) => Object.freeze(cell)));
}

// 모듈 로드 자기검증 — turnA.js의 표 검증 문법을 따른다.
{
  // 규칙에서 역유도하지 않은 k=6 개념도 절대좌표 오라클.
  const conceptK6 = Object.freeze([
    Object.freeze({ q: 3, r: 1 }),
    Object.freeze({ q: 4, r: -1 }),
    Object.freeze({ q: 4, r: 0 }),
    Object.freeze({ q: 4, r: 1 }),
    Object.freeze({ q: 5, r: -1 }),
    Object.freeze({ q: 5, r: 0 }),
    Object.freeze({ q: 5, r: 1 }),
    Object.freeze({ q: 6, r: -1 }),
  ]);
  const actual = notchCellsC(6);
  if (actual.length !== NOTCH_C_CELL_COUNT || conceptK6.length !== NOTCH_C_CELL_COUNT) {
    throw new Error(`notchC: k=6 노치가 ${NOTCH_C_CELL_COUNT}셀이 아니다`);
  }
  const seen = new Set();
  for (let i = 0; i < actual.length; i += 1) {
    const got = actual[i];
    const want = conceptK6[i];
    const key = cellKey(got.q, got.r);
    if (seen.has(key)) throw new Error(`notchC: k=6 좌표 중복 ${key}`);
    seen.add(key);
    if (got.q !== want.q || got.r !== want.r) {
      throw new Error(
        `notchC: k=6 개념도 불일치 index=${i} 실제 ${key} 기대 ${cellKey(want.q, want.r)}`,
      );
    }
    if (hexDistance(got.q, got.r) > 6) {
      throw new Error(`notchC: k=6 영역 밖 좌표 ${key}`);
    }
  }
  if (seen.has('6,0')) {
    throw new Error('notchC: 3시 방향 기준 앵커 (k,0)를 노치가 먹는다');
  }
}
