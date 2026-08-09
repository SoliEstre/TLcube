// placementA.js — Type A(삼각 실루엣) 영역·꼭짓점 앵커·패치 레퍼런스 배치
// (ADR 0005 D1·D2·D4, docs/adr/0005_typeA_layout.md v1.1)
//
// Type A 는 육각 영역(반경 k)의 세 교대 방향에 삼각 코너 패치를 붙여 실루엣을
// 정삼각형(△, 위 꼭짓점)으로 닫는 변형이다. 데이터 계약(§4.1 순위 3튜플·GF(211)·
// §4.3 마스크)은 Type O 를 전부 승계하고 **레이아웃만** 확장한다.
//
// [D2 안 1 채택 — 무수정 공유 계약] 육각부의 역할 지도(앵커 3셀·포맷 15셀·레퍼런스
// 2(k-2)셀)는 Type O 와 **바이트 동일**이다 — 이 모듈은 `placement.js`/`hexgrid.js`
// 를 import 만 하고 절대 수정하지 않는다. 육각 코너 3셀 (0,0,5) 은 보조 앵커로
// 그대로 남고, 꼭짓점 3셀이 주 앵커로 추가되어 앵커 총 6개가 된다.
//
// cube 좌표 (x,y,z) = (q, −q−r, r) 에서:
//   영역 A(k)  = { x≤k ∧ y≤k ∧ z≤k } ⇔ axial q≤k ∧ r≤k ∧ q+r≥−k
//   육각부     = 여기에 min(x,y,z)≥−k 를 더한 것 (= 기존 hexDistance≤k 와 전수 일치)
//   패치       = 정확히 하나의 cube 좌표가 <−k 인 셀
//     top(상단) 패치: r < −k (z < −k)
//     BL(좌하) 패치:  q < −k (x < −k)
//     BR(우하) 패치:  q+r > k (y < −k)
// 세 패치는 `rotate120` 궤도(top → BR → BL)로 서로 사상된다 — placement.js 의
// 120°/240° 회전(rhombille 이 갖는 유일한 비자명 대칭)을 그대로 재사용한다.
//
// 셀 수 검산: (3k+1)(3k+2)/2 — k=8 → 325 · k=10 → 496 (placementA.test.js 전수 검산).
//
// 런타임 의존성 0 · 순수 ESM.

import { hexDistance, regionCells } from './hexgrid.js';
import {
  BULLSEYE_RADIUS,
  REFERENCE_DIGIT,
  ANCHOR_PRIMARY_DIGIT,
  ANCHOR_SECONDARY_DIGIT,
  FORMAT_RING,
  rotate120,
  rotate240,
  ringWalk,
  buildRoleSets,
} from './placement.js';

function key(q, r) {
  return `${q},${r}`;
}

function assertRadius(k) {
  // 육각부 재사용(placement.js/hexgrid.js)이 요구하는 최소 반경을 그대로 승계한다
  // (FORMAT_RING=3 이 데이터 링이려면 앵커 링(k) 보다 작아야 한다). 패치 레퍼런스
  // 링 공식(k+2 .. 2k-1)도 k≥3 만 있으면 성립하므로 이 하한이 더 좁혀 잡는다.
  if (!Number.isInteger(k) || k < FORMAT_RING + 1) {
    throw new RangeError(`k 는 ${FORMAT_RING + 1} 이상의 정수여야 한다: ${k}`);
  }
  return k;
}

// ─────────────────────────────────────────────────────────────────────────────
// 영역 정의 (D1)
// ─────────────────────────────────────────────────────────────────────────────

/** 영역 A(k) 소속 판정 — cube 좌표 x,y,z ≤ k (⇔ axial q≤k ∧ r≤k ∧ −q−r≤k). */
export function isInRegionA(q, r, k) {
  return q <= k && r <= k && (-q - r) <= k;
}

/**
 * 패치 판별 — 정확히 하나의 cube 좌표가 <−k 인 셀만 패치다. 호출자는 (q,r) 이
 * 이미 `isInRegionA(q,r,k)` 를 만족하는 셀임을 보장해야 한다(역할 분류·레퍼런스
 * arc 필터링 등 내부 소비처가 전부 그렇다) — 임의 좌표에 대한 독립 판정이 아니다.
 */
export function isTopPatch(q, r, k) {
  return isInRegionA(q, r, k) && r < -k;
}

export function isBLPatch(q, r, k) {
  return isInRegionA(q, r, k) && q < -k;
}

export function isBRPatch(q, r, k) {
  return isInRegionA(q, r, k) && (q + r) > k;
}

/** 셀의 패치 소속 — 'top' | 'BL' | 'BR' | null(육각부 또는 영역 밖). */
export function patchOfA(q, r, k) {
  if (!isInRegionA(q, r, k)) return null;
  if (isTopPatch(q, r, k)) return 'top';
  if (isBLPatch(q, r, k)) return 'BL';
  if (isBRPatch(q, r, k)) return 'BR';
  return null; // 육각부
}

// top 패치 셀 — 행 j=1..k (r=−k−j), 행 내 q∈[j,k], 오름차순 고정(레이아웃-무관
// 원시 나열). scan order(T3)의 boustrophedon 은 layoutA.js 소관이라 여기서 다루지
// 않는다 — placementA.js 는 "무엇이 패치 셀인가"만 답한다.
function topPatchCellsAscending(k) {
  const out = [];
  for (let j = 1; j <= k; j += 1) {
    const r = -k - j;
    for (let q = j; q <= k; q += 1) out.push({ q: q + 0, r: r + 0 });
  }
  return out;
}

/**
 * 영역 A(k) 전 셀, 결정적 순서 — 육각부 `regionCells(k)` 접두 그대로 + 패치 셀
 * (top → BR(rotate120) → BL(rotate240), 각 패치 내부는 행 j=1..k 오름차순 q).
 * @param {number} k
 * @returns {{q:number, r:number}[]} 길이 (3k+1)(3k+2)/2
 */
export function regionCellsA(k) {
  assertRadius(k);
  const hexPart = regionCells(k);
  const top = topPatchCellsAscending(k);
  const br = top.map((c) => rotate120(c.q, c.r));
  const bl = top.map((c) => rotate240(c.q, c.r));
  return [...hexPart, ...top, ...br, ...bl];
}

// ─────────────────────────────────────────────────────────────────────────────
// 꼭짓점 앵커 3셀 (D2)
// ─────────────────────────────────────────────────────────────────────────────
//
// 닫힌 형태: cube 좌표에서 두 개가 +k, 하나가 −2k 인 세 점.
//   (k,−2k) 위 꼭짓점 · (k,k) 우하 꼭짓점 · (−2k,k) 좌하 꼭짓점
// digit 규약(§5.2 승계): digit 5 = 위 꼭짓점 (Type A 명명 근거 △ 와 일치하는 방향
// 기준점), 나머지 두 꼭짓점 = digit 0. rotate120 이 top→BR→BL 순으로 사상하므로
// 이 배열 순서 자체가 그 궤도를 반영한다.

/**
 * 삼각 꼭짓점 3셀과 digit 배정 (D2 주 앵커). 기존 육각 코너 앵커(`placement.
 * anchorCells(k)`, 보조 앵커로 유지)와 합쳐야 앵커 총 6개다 — 이 함수는 꼭짓점
 * 3개만 낸다.
 * @param {number} k
 * @returns {{q:number, r:number, digit:number}[]} 길이 3
 */
export function vertexAnchors(k) {
  assertRadius(k);
  return [
    { q: k, r: -2 * k, digit: ANCHOR_PRIMARY_DIGIT }, // 위 꼭짓점
    { q: k, r: k, digit: ANCHOR_SECONDARY_DIGIT }, //     우하 꼭짓점 (BR)
    { q: -2 * k, r: k, digit: ANCHOR_SECONDARY_DIGIT }, // 좌하 꼭짓점 (BL)
  ];
}

/** 꼭짓점 앵커 좌표 집합 (Set<"q,r">). digit 무관, 위치만. */
export function vertexAnchorPositionSet(k) {
  return new Set(vertexAnchors(k).map((c) => key(c.q, c.r)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 패치 레퍼런스 셀 — 규칙 R (D4)
// ─────────────────────────────────────────────────────────────────────────────
//
// 패치 링 ρ ∈ {k+2, k+5, k+8, …} (ρ ≤ 2k−1) 에서 top 패치 arc(**= ringWalk(ρ) 중
// 영역 A(k) 내 top 패치 셀만** — [C7] 자문 정정: "r_ax<−k 만"으로는 영역 밖 셀이
// 섞이는 구현 함정이 있었다. `isTopPatch` 가 이미 `isInRegionA` 를 내부에서
// 검사하므로 이 필터 한 줄로 두 조건을 동시에 만족한다)의 **중앙 셀**
// (⌊(len−1)/2⌋) 을 잡고 rotate120/240 으로 복제한다 — 링당 3개.
//
// 랩어라운드 무관: 대칭 복제라 arc 인덱스 산술이 top 패치에서만 필요하고,
// top 패치는 ringWalk 순회에서 절대 인덱스 0/끝을 걸치지 않는다(경험적으로
// [C7] 독립 재구현이 재확인 — placementA.test.js 가 KAT 좌표로 회귀 고정한다).

/** 패치 레퍼런스가 사는 링 반경 목록 — k+2 부터 2k−1 까지 3씩. */
export function patchReferenceRings(k) {
  assertRadius(k);
  const rings = [];
  for (let rho = k + 2; rho <= 2 * k - 1; rho += 3) rings.push(rho);
  return rings;
}

/**
 * 패치 레퍼런스 셀 전부(규칙 R). 링마다 top arc 중앙 + rotate120(→BR) +
 * rotate240(→BL) 3개, digit 은 `REFERENCE_DIGIT`(placement.js §5.3 값 3 승계).
 * k=8 KAT: (5,−10)·(7,−13) + 회전상(총 6). k=10 KAT: (6,−12)·(8,−15)·(9,−18) +
 * 회전상(총 9). (placementA.test.js 가 좌표를 그대로 회귀 고정한다.)
 * @param {number} k
 * @returns {{q:number, r:number, digit:number}[]}
 */
export function patchReferenceCells(k) {
  assertRadius(k);
  const out = [];
  for (const rho of patchReferenceRings(k)) {
    const arc = ringWalk(rho).filter((c) => isTopPatch(c.q, c.r, k));
    if (arc.length === 0) {
      throw new RangeError(`k=${k} rho=${rho}: 패치 레퍼런스 arc 가 비었다 — 규칙 R 전제 위반`);
    }
    const center = arc[Math.floor((arc.length - 1) / 2)];
    const br = rotate120(center.q, center.r);
    const bl = rotate240(center.q, center.r);
    out.push({ q: center.q, r: center.r, digit: REFERENCE_DIGIT });
    out.push({ q: br.q, r: br.r, digit: REFERENCE_DIGIT });
    out.push({ q: bl.q, r: bl.r, digit: REFERENCE_DIGIT });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 역할 분할 — 육각부(placement.js 무수정) + 꼭짓점 앵커 + 패치 레퍼런스
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 반경 k 영역 전체(육각부 + 패치)의 역할 분류표. 육각부는 `placement.
 * buildRoleSets(k)` 를 그대로 재사용(D2 안 1 계약 — 바이트 동일)하고, 꼭짓점
 * 앵커·패치 레퍼런스만 그 위에 얹는다.
 * @param {number} k
 * @returns {{anchor: Set<string>, format: Set<string>, reference: Set<string>}}
 */
export function buildRoleSetsA(k) {
  assertRadius(k);
  const hexSets = buildRoleSets(k);
  const anchor = new Set(hexSets.anchor);
  for (const c of vertexAnchors(k)) anchor.add(key(c.q, c.r));
  const reference = new Set(hexSets.reference);
  for (const c of patchReferenceCells(k)) reference.add(key(c.q, c.r));
  return { anchor, format: hexSets.format, reference };
}

/**
 * 셀 (q,r) 의 역할. 육각부는 `placement.roleOf` 와 완전히 동일한 판정을 낸다
 * (앵커·포맷·레퍼런스 좌표가 그대로이므로) — 패치 좌표만 anchor/reference/data 로
 * 새로 갈린다.
 * @param {number} q
 * @param {number} r
 * @param {number} k
 * @param {{anchor:Set<string>, format:Set<string>, reference:Set<string>}} [roleSets]
 * @returns {'bullseye'|'anchor'|'format'|'reference'|'data'}
 */
export function roleOfA(q, r, k, roleSets) {
  const d = hexDistance(q, r);
  if (d <= BULLSEYE_RADIUS) return 'bullseye';
  const sets = roleSets || buildRoleSetsA(k);
  const kk = key(q, r);
  if (sets.anchor.has(kk)) return 'anchor';
  if (sets.format.has(kk)) return 'format';
  if (sets.reference.has(kk)) return 'reference';
  return 'data';
}
