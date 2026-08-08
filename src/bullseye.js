/**
 * bullseye.js — 중앙 불스아이 파인더 형상·링 수 확정 (SPEC §5.1, T5)
 *
 * MaxiCode 식 동심원 불스아이: 명암 교대 링 3쌍(= 6밴드), 점유 영역은 중심
 * 반경 2링(hexDistance ≤ 2, 19셀). 이 모듈은 그 최대 안전 반지름과 밴드
 * 구조를 hexgrid 기하에서 **계산**으로 유도한다 — 임의 상수를 두지 않는다.
 *
 * R_max 는 두 제약의 min 이다:
 *   1. 19셀 풋프린트(hexDistance ≤ 2) 경계까지의 최소 거리 — 불스아이가
 *      점유 셀 밖으로 새면 인접(비점유) 셀의 렌더링을 침범한다.
 *   2. ring-3 셀(hexDistance = 3)의 샘플 원판(faceSampleDisc, §7.2 기본값)
 *      까지의 최소 여유 — 포맷 정보가 ring 3 에 살므로(§5.4) 그 판독용
 *      샘플 영역을 불스아이가 침범하면 안 된다.
 *
 * 이 모듈은 순수 기하만 다룬다. Node 전용 API 를 쓰지 않는다.
 */

import {
  regionCells,
  hexDistance,
  hexCorners,
  faceSampleDisc,
  FACES,
  normalizeLayout,
} from './hexgrid.js';

/** 명암 교대 링 3쌍 = 6밴드 (SPEC §5.1). */
export const RING_PAIRS = 3;
export const BAND_COUNT = RING_PAIRS * 2;

/** 불스아이 점유 반경(hexDistance 상한). 반경 2링 = 19셀. */
export const OCCUPIED_RADIUS = 2;

// ─────────────────────────────────────────────────────────────────────────────
// 기하 헬퍼 (모듈 내부 전용)
// ─────────────────────────────────────────────────────────────────────────────

/** 점 p 에서 선분 ab 까지의 최단 거리. */
function distPointToSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  let t = abLenSq === 0 ? 0 : (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** 원점에서 원점 기준 정수 axial 셀 (q,r) 까지 — region(k) 소속 판정용. */
function inFootprint(q, r) {
  return hexDistance(q, r) <= OCCUPIED_RADIUS;
}

/**
 * 19셀 풋프린트(hexDistance ≤ 2)의 경계까지 원점에서의 최소 거리.
 *
 * 풋프린트 안의 각 셀에 대해 6개 변을 순회하고, 그 변이 (풋프린트 밖의
 * 이웃과 접하는) **경계 변**이면 원점-선분 최단거리를 구해 전체 최소를 취한다.
 * "경계 변"인지는 변의 중점을 살짝 바깥으로 밀어 axial 로 반올림해서
 * 그 셀이 풋프린트 밖인지로 판정한다 — 이웃 방향 인덱스 매핑에 기대지
 * 않는 견고한 방식이다.
 */
function footprintBoundaryClearance(cellSize) {
  const layout = { size: cellSize, originX: 0, originY: 0 };
  const cells = regionCells(OCCUPIED_RADIUS);
  let minDist = Infinity;

  for (const { q, r } of cells) {
    const corners = hexCorners(q, r, layout);
    const cx = cellSize * Math.sqrt(3) * (q + r / 2);
    const cy = cellSize * 1.5 * r;

    for (let i = 0; i < 6; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // 셀 중심 → 변 중점 방향으로 살짝(변 길이의 5%) 더 밀어 바깥 셀로 넘긴다.
      const ox = mx + (mx - cx) * 0.05;
      const oy = my + (my - cy) * 0.05;
      const outsideQ = ox / (cellSize * Math.sqrt(3)) - (oy / (cellSize * 1.5)) / 2;
      const outsideR = oy / (cellSize * 1.5);
      // axial 반올림 (cube 방식) — hexgrid.axialRound 와 동치이나 이 모듈은
      // 판정에만 쓰므로 로컬로 계산한다 (수치 안정성 목적 외 의미 없음).
      const rounded = axialRoundLocal(outsideQ, outsideR);
      if (!inFootprint(rounded.q, rounded.r)) {
        const d = distPointToSegment({ x: 0, y: 0 }, a, b);
        if (d < minDist) minDist = d;
      }
    }
  }

  return minDist;
}

function axialRoundLocal(qf, rf) {
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;
  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);
  const dx = Math.abs(rx - xf);
  const dy = Math.abs(ry - yf);
  const dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

/**
 * ring-3 셀(hexDistance = 3) 전 셀 × 전 면의 샘플 원판까지, 원점에서의
 * 최소 여유(clearance) = min(원점-원판중심 거리 − 원판 반지름).
 */
function ring3DiscClearance(cellSize) {
  const layout = { size: cellSize, originX: 0, originY: 0 };
  const ring3 = regionCells(3).filter(({ q, r }) => hexDistance(q, r) === 3);
  let minClearance = Infinity;

  for (const { q, r } of ring3) {
    for (const face of FACES) {
      const disc = faceSampleDisc(q, r, face, layout);
      const centerDist = Math.hypot(disc.x, disc.y);
      const clearance = centerDist - disc.radius;
      if (clearance < minClearance) minClearance = clearance;
    }
  }

  return minClearance;
}

/**
 * 최대 안전 반지름 R_max (cellSize 단위) = min(풋프린트 경계 여유, ring-3
 * 원판 비침범 여유).
 * @param {number} [cellSize=1]
 */
export function maxSafeRadius(cellSize) {
  const size = cellSize === undefined ? 1 : normalizeLayout({ size: cellSize }).size;
  return Math.min(footprintBoundaryClearance(size), ring3DiscClearance(size));
}

// 내부 노출 (numbers_check·테스트 진단용) — 공개 API 계약은 아니다.
export const _internals = { footprintBoundaryClearance, ring3DiscClearance };

// ─────────────────────────────────────────────────────────────────────────────
// 밴드 구조
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 6밴드 경계 반지름(안→밖), 마지막 원소가 R_max.
 *
 * **균등 폭으로 확정** — 선정 규칙: 고정된 R_max 와 밴드 수 N 에 대해, 폭의
 * 합이 R_max 로 고정된 분할 중 "가장 얇은 밴드의 폭"(검출 강건성의 병목 —
 * 블러·저해상도에서 가장 먼저 뭉개지는 곳)을 최대화하는 분할은 **균등
 * 분할**이다 (단순 산술: 합이 고정된 N 분할에서 최소 밴드는 평균 이하이고, 등호는 균등 분배에서만 성립하므로 최소값은 균등 분배에서 최댓값을
 * 갖는다). "중심 원판을 크게" 대안은 중심 밴드를 넓히는 대신 나머지 5밴드가
 * 더 얇아져 최소 밴드 폭이 반드시 감소한다 — 아래 numbers_check 에서 수치로
 * 대조.
 */
export function bandRadii(cellSize) {
  const R = maxSafeRadius(cellSize);
  const width = R / BAND_COUNT;
  const radii = [];
  for (let i = 1; i <= BAND_COUNT; i++) radii.push(width * i);
  return radii;
}

/**
 * distFromCenter 위치의 불스아이 프로파일. 반환값은 상대 순위가 아니라
 * 그 자체로 최대 대비 휘도다(0.0 = 암, 1.0 = 명) — 불스아이는 파인더이지
 * 데이터가 아니므로 §4.4 Δmin 계약과 무관하다.
 *
 * 밴드 0(중심)이 암(0)에서 시작해 교대하고, 밴드 5(최외곽)가 명(1)으로
 * 끝난다. 경계는 반개구간 [하한, 상한) 이고 마지막 밴드만 상한 포함(R_max
 * 그 자체는 불스아이 영역이므로).
 *
 * @param {number} distFromCenter
 * @param {number} [cellSize=1]
 * @returns {0 | 1}
 */
export function profileAt(distFromCenter, cellSize) {
  if (!Number.isFinite(distFromCenter) || distFromCenter < 0) {
    throw new RangeError(`distFromCenter 는 0 이상의 유한수여야 한다: ${distFromCenter}`);
  }
  const radii = bandRadii(cellSize);
  const rMax = radii[radii.length - 1];
  if (distFromCenter > rMax) {
    throw new RangeError(
      `distFromCenter(${distFromCenter}) 가 R_max(${rMax}) 를 벗어난다 — 불스아이 밖`,
    );
  }
  for (let i = 0; i < radii.length; i++) {
    const isLast = i === radii.length - 1;
    if (isLast ? distFromCenter <= radii[i] : distFromCenter < radii[i]) {
      return i % 2 === 0 ? 0 : 1;
    }
  }
  // 도달 불가 (위 루프가 isLast 케이스에서 항상 반환) — 방어적 폴백.
  /* c8 ignore next */
  return 1;
}

/**
 * 불스아이가 점유하는 19셀 (hexDistance ≤ 2), 결정적 순서(regionCells 순서
 * 그대로).
 * @returns {{q: number, r: number}[]}
 */
export function occupiedCells() {
  return regionCells(OCCUPIED_RADIUS);
}

/**
 * 검출기용 기대 방사 시그니처 — 중심(0)에서 R_max 까지 `samples`개 지점을
 * 균등 샘플링한 profileAt 값 배열.
 *
 * @param {number} [cellSize=1]
 * @param {number} [samples=64]
 * @returns {number[]}
 */
export function radialSignature(cellSize, samples) {
  const n = samples === undefined ? 64 : samples;
  if (!Number.isInteger(n) || n < 2) {
    throw new RangeError(`samples 는 2 이상의 정수여야 한다: ${n}`);
  }
  const rMax = maxSafeRadius(cellSize);
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = (rMax * i) / (n - 1);
    out.push(profileAt(d, cellSize));
  }
  return out;
}
