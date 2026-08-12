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

// 정규화된 기본 셀 크기(1)의 기하 계산은 순수·불변이므로 재사용한다.
// 공개 API는 새 배열을 계속 반환하며, profileAt 내부만 이 읽기 전용 캐시를 쓴다.
let canonicalMaxSafeRadius;
let canonicalProfileBandRadii;

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
  // Math.hypot 금지 — ES 규격상 implementation-approximated 라 엔진별 1 ulp 이 갈릴 수
  // 있고, 이 값이 밴드 반지름을 거쳐 렌더 바이트 결정성에 물린다. sqrt 는 IEEE 754
  // 정확 반올림이라 결정적이다 (T9 검증 라운드 발견).
  const dx = p.x - cx;
  const dy = p.y - cy;
  return Math.sqrt(dx * dx + dy * dy);
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
      // hypot 대신 sqrt — 위 distPointToSegment 와 같은 결정성 사유.
      const centerDist = Math.sqrt(disc.x * disc.x + disc.y * disc.y);
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
  if (size === 1) {
    if (canonicalMaxSafeRadius === undefined) {
      canonicalMaxSafeRadius = Math.min(footprintBoundaryClearance(size), ring3DiscClearance(size));
    }
    return canonicalMaxSafeRadius;
  }
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
  // 마지막 원소는 (R/N)·N 재계산이 아니라 R 그 자체 — 정의상 최외곽 경계 = R_max 이고,
  // FP 재계산은 1 ulp 를 얹어 "마지막 원소가 R_max" 계약을 깬다 (T9 검증 라운드 여파).
  for (let i = 1; i < BAND_COUNT; i++) radii.push(width * i);
  radii.push(R);
  return radii;
}

function profileBandRadii(cellSize) {
  if (cellSize === undefined || cellSize === 1) {
    if (canonicalProfileBandRadii === undefined) {
      canonicalProfileBandRadii = bandRadii(1);
    }
    return canonicalProfileBandRadii;
  }
  return bandRadii(cellSize);
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
  const radii = profileBandRadii(cellSize);
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

// ─────────────────────────────────────────────────────────────────────────────
// 하이브리드 (불스아이 링 + 중앙 3톤 큐브)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 하이브리드에서 3톤 큐브가 **대체하는 안쪽 밴드 수**. 이 상수 하나가 하이브리드
 * 기하 전체를 결정한다 — 큐브 반지름도, 남는 링 밴드도, 검출기가 투표·검증에 쓰는
 * 경계 번호도 전부 여기서 유도된다.
 *
 * 왜 하이브리드인가: 두 파인더가 서로 없는 걸 갖고 있다. 동심원은 롬빌 데이터 필드에
 * 존재하지 않는 시그니처라 **위치·스케일**을 잡는 데 강하고(실사진 6/6), 큐브는 회전
 * 대칭이 없어 **방향**을 준다(단독 검출은 실사진 0/6 — 실루엣을 못 찾는다).
 *
 * 왜 하필 2인가: 밴드 폭이 균등(R_max/6)이라 안쪽 2밴드를 걷어내면 큐브 반지름이
 * R_max/3 ≈ 1.202c 가 되고, 남는 4밴드는 **원래 자리 그대로**다. 즉 canonical 밴드
 * 격자(`bandRadii`)를 하나도 안 바꾸고 «어느 밴드가 살아 있나» 만 달라진다 — 검출기의
 * 정규 기하를 재사용할 수 있는 유일한 분할점이다.
 */
export const HYBRID_INNER_CUBE_BANDS = 2;

/** 하이브리드에서 살아 있는 링 밴드 수 (바깥쪽). */
export const HYBRID_RING_BAND_COUNT = BAND_COUNT - HYBRID_INNER_CUBE_BANDS;

/** 하이브리드 중앙 큐브의 외접 반지름 = 안쪽 `HYBRID_INNER_CUBE_BANDS` 밴드의 폭 합. */
export function hybridCubeRadius(cellSize) {
  return (maxSafeRadius(cellSize) * HYBRID_INNER_CUBE_BANDS) / BAND_COUNT;
}

/**
 * 하이브리드가 실제로 그리는 링 경계 반지름(안→밖). 첫 원소가 큐브와 맞닿는
 * 경계(= `hybridCubeRadius`), 마지막이 R_max.
 */
export function hybridBandRadii(cellSize) {
  return bandRadii(cellSize).slice(HYBRID_INNER_CUBE_BANDS - 1);
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
    // 마지막 표본은 (rMax·i)/(n−1) 재계산이 아니라 rMax 그 자체 — FP 재계산이 1 ulp
    // 위로 반올림되면 profileAt 의 범위 검사(> rMax)에 걸린다 (bandRadii 와 같은 부류).
    const d = i === n - 1 ? rMax : (rMax * i) / (n - 1);
    out.push(profileAt(d, cellSize));
  }
  return out;
}
