/**
 * notchC.js — Type C 3시 노치의 좌표 정본 (v2, 2026-08-30 개정).
 *
 * v2 형상 = **3줄 개방 슬롯**: r ∈ {−1, 0, +1} 세 줄을 3시 코너 끝(실루엣 포함)에서
 * 안쪽으로 파낸다. 중심 줄이 양옆보다 2칸 깊은 스피어형이고, 3시 축(거울 (q,r) ↔
 * (q+r, −r))에 대칭이다. 코너 (k,0) 은 **노치에 포함**된다 — v1 이 (k,0) 을 «기준
 * 앵커»로 남겨 이웃 전멸로 부유 큐브를 만들었던 결함의 정정이며, 그래서 Type C
 * 반경의 앵커는 placement.js 가 세트 B({(0,k),(−k,0),(k,−k)}) 로 이설한다.
 *
 *   r = −1 : q ∈ [9, k]      (k−8 셀)
 *   r =  0 : q ∈ [7, k]      (k−6 셀)  ← 스피어 중심
 *   r = +1 : q ∈ [8, k−1]    (k−8 셀)
 *
 * 성질 (아래 로드 자기검증이 잠근다):
 *   - 셀 수 = 3k − 22 ≡ 2 (mod 3). 데이터 셀 잔여(0/1/2)는 k 의 mod-3 부류가
 *     결정한다 — 잔여는 표(capacityC)가 행별로 잠그고 엔진은 일반 처리한다.
 *   - 최심 링 7 — daehan 예약(링 ≤ 6)·포맷 링(3)·불스아이(≤ 2) 와 구조적으로
 *     서로소. 레퍼런스 셀 비침범은 capacityC 로드 자기검증이 역할표로 잰다.
 *   - v1 의 고정 8셀은 v2 의 진부분집합이다 (기하 연속성 — 기존 배경 기대 검사가
 *     재던 영역이 그대로 안에 있다).
 *
 * 설계 유래: k=6 축소 개념도(`.agent/PM/027` assets, 운영자 작화)의 «3줄 × 4깊이 ×
 * 코너 포함» 12셀을 k≥14 로 비례 일반화한 것. k=6 개념도 자체는 그 판의 포맷 링과
 * 겹쳐 실규약이 될 수 없으므로 **문서 지위**로 남고, 코드 오라클은 k=14 절대좌표다.
 */

import { hexDistance } from './hexgrid.js';

/** Type C 와이어가 정의된 최소 반경 (C0). v2 규칙은 k < 14 에서 정의되지 않는다. */
export const TYPE_C_MIN_RADIUS = 14;

/** 규약상 노치 셀 수 — k 의 함수다 (v1 은 고정 8이었다). */
export function notchCellCountC(k) {
  assertRadius(k);
  return 3 * k - 22;
}

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
 * 반경 k의 3시 노치 셀. 반환 순서는 줄(r=−1 → 0 → +1) 순, 줄 안에서 q 오름차순 —
 * 결정적이며 소비자는 이 순서에 의미를 싣지 않는다 (집합이 계약이다).
 * @param {number} k
 * @returns {ReadonlyArray<Readonly<{q:number,r:number}>>}
 */
export function notchCellsC(k) {
  assertRadius(k);
  const cells = [];
  for (let q = 9; q <= k; q += 1) cells.push(Object.freeze({ q, r: -1 }));
  for (let q = 7; q <= k; q += 1) cells.push(Object.freeze({ q, r: 0 }));
  for (let q = 8; q <= k - 1; q += 1) cells.push(Object.freeze({ q, r: 1 }));
  return Object.freeze(cells);
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

// 모듈 로드 자기검증 — 규칙과 독립된 k=14 절대좌표 오라클 + 전 지원 반경 성질.
{
  // 규칙에서 역유도하지 않고 손으로 전개한 C0(k=14) 20셀.
  const oracleK14 = [
    [9, -1], [10, -1], [11, -1], [12, -1], [13, -1], [14, -1],
    [7, 0], [8, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0], [14, 0],
    [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1],
  ];
  const actual = notchCellsC(14);
  if (actual.length !== oracleK14.length || actual.length !== notchCellCountC(14)) {
    throw new Error(`notchC: k=14 노치가 ${oracleK14.length}셀이 아니다: ${actual.length}`);
  }
  for (let i = 0; i < actual.length; i += 1) {
    const got = actual[i];
    const [wq, wr] = oracleK14[i];
    if (got.q !== wq || got.r !== wr) {
      throw new Error(`notchC: k=14 오라클 불일치 index=${i} 실제 ${cellKey(got.q, got.r)} 기대 ${cellKey(wq, wr)}`);
    }
  }
  for (const k of [14, 16, 18, 20]) {
    const cells = notchCellsC(k);
    const set = new Set(cells.map((c) => cellKey(c.q, c.r)));
    if (set.size !== cells.length) throw new Error(`notchC: k=${k} 좌표 중복`);
    if (cells.length !== 3 * k - 22 || cells.length % 3 !== 2) {
      throw new Error(`notchC: k=${k} 셀 수 성질 위반 (${cells.length})`);
    }
    for (const c of cells) {
      const d = hexDistance(c.q, c.r);
      if (d < 7 || d > k) throw new Error(`notchC: k=${k} 링 범위 밖 좌표 ${cellKey(c.q, c.r)} (링 ${d})`);
      // 3시 축 거울 대칭: (q,r) ↔ (q+r, −r)
      if (!set.has(cellKey(c.q + c.r, -c.r))) {
        throw new Error(`notchC: k=${k} 거울 대칭 위반 ${cellKey(c.q, c.r)}`);
      }
    }
    // v2 는 코너를 실루엣째 판다 — (k,0) 이 없으면 부유 큐브 결함(v1)으로의 회귀다.
    if (!set.has(cellKey(k, 0))) {
      throw new Error(`notchC: k=${k} 노치가 3시 코너 (k,0) 을 포함해야 한다`);
    }
  }
}
