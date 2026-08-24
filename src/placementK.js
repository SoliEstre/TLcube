// placementK.js — Type K(육각별/hexagram 실루엣) 영역·별 꼭짓점 앵커·패치 레퍼런스 배치
// (계약 claude-k-contract.md K-1·K-2·K-3, Wave 3 ② 레인 K)
//
// Type K 는 정삼각(영역 A)과 역삼각(반전 A)을 겹친 **육각별** — 육각 코어(반경 k) +
// 삼각 패치 6개다. 데이터 계약(§4.1 순위 3튜플·GF(211)·§4.3 마스크)은 Type O/A 를
// 전부 승계하고 **레이아웃만** 확장한다. 모듈 구조는 placementA.js 동형이다.
//
// [영역 정본] `src/cell-editor-core.js` 의 isInRegionK/patchOfK 가 영역 정의의 정본이다
// (계약 K-1 — «정본은 이미 코드에 있다»). 그 모듈은 편집기 층이라 여기서 import 하면
// 레이아웃 코어가 UI 계열에 의존하게 되므로 **같은 식을 재서술**하고, 두 서술의 전수
// 일치는 test/placementK.test.js 가 잠근다 (사본 목록 부패 방지는 규칙이 아니라 자로).
//
// [D2 안 1 승계 — 무수정 공유] 육각부의 역할 지도(앵커 3·포맷 15·레퍼런스 2(k−2))는
// Type O 와 바이트 동일이다 — placement.js/hexgrid.js 를 import 만 하고 절대 수정하지
// 않는다. A 계열 꼭짓점 앵커도 placementA.vertexAnchors 를 **그대로** 재사용한다.
//
// [반전 계열 꼭짓점 앵커 = digit 1 — 통합자 확정 2026-08-24] 육각별 실루엣은 6회
// 대칭이지만 rhombille 면 분할은 120° 대칭뿐이다. 두 삼각 계열을 digit 으로 구분하면
// (A 계열 5/0/0 · 반전 계열 1/1/1) 60° 급 오가설이 **앵커 판정만으로 죽는다** —
// 60° 회전은 A 계열 꼭짓점을 반전 계열 자리로 보내는데 기대값 5/0 자리에서 1 이
// 읽히므로 expectedPattern 이 깨진다 (계약 K-2 · H2CO3 60° 위치 대칭 12/30 실측이
// 마커-단독 대안의 위험이다).
//
// 셀 수 검산: 6k² + 6k + 1 — k=6 → 253 · k=8 → 433 · k=10 → 661 (계약 K-1 실계산).
//
// 런타임 의존성 0 · 순수 ESM.

import { hexDistance, regionCells } from './hexgrid.js';
import {
  REFERENCE_DIGIT,
  rotate120,
  rotate240,
  ringWalk,
  buildRoleSets,
} from './placement.js';
import {
  isInRegionA,
  isTopPatch,
  vertexAnchors,
  patchReferenceRings,
} from './placementA.js';

function key(q, r) {
  return `${q},${r}`;
}

function assertRadius(k) {
  // placementA 와 같은 하한 (FORMAT_RING+1 = 4) — 육각부 재사용 요건이 그대로다.
  if (!Number.isInteger(k) || k < 4) {
    throw new RangeError(`k 는 4 이상의 정수여야 한다: ${k}`);
  }
  return k;
}

/** 반전 계열 꼭짓점 앵커의 digit (통합자 확정 2026-08-24 — 계약 K-2 추천안 채택).
 *  {0, 5}(A 계열)·{3}(레퍼런스) 와 달라야 한다. */
export const ANCHOR_INVERTED_DIGIT = 1;

// ─────────────────────────────────────────────────────────────────────────────
// 영역 정의 (계약 K-1 — cell-editor-core.js 정본의 재서술, 테스트가 일치를 잠근다)
// ─────────────────────────────────────────────────────────────────────────────

/** 반전 영역 A — 영역 A 의 축좌표 180° 상과 같은 집합 (cube x,y,z ≥ −k). */
export function isInRegionInvertedA(q, r, k) {
  return q >= -k && r >= -k && (q + r) <= k;
}

/** 영역 K = A ∪ 반전A (육각별). */
export function isInRegionK(q, r, k) {
  return isInRegionA(q, r, k) || isInRegionInvertedA(q, r, k);
}

/** 셀의 패치 소속 — 'top'|'BL'|'BR'(A 계열) | 'bottom'|'TR'|'TL'(반전 계열) |
 *  null(육각 코어 또는 영역 밖). cell-editor-core.patchOfK 와 같은 판정 순서다. */
export function patchOfK(q, r, k) {
  if (!isInRegionK(q, r, k)) return null;
  if (hexDistance(q, r) <= k) return null; // 육각 코어
  if (r < -k) return 'top';
  if (q < -k) return 'BL';
  if (q + r > k) return 'BR';
  if (r > k) return 'bottom';
  if (q > k) return 'TR';
  if (q + r < -k) return 'TL';
  return null;
}

// top 패치 셀 — placementA topPatchCellsAscending 와 같은 나열(행 j=1..k, r=−k−j,
// 행 내 q∈[j,k] 오름차순). scan order 의 boustrophedon 은 layoutK.js 소관이다.
function topPatchCellsAscending(k) {
  const out = [];
  for (let j = 1; j <= k; j += 1) {
    const r = -k - j;
    for (let q = j; q <= k; q += 1) out.push({ q: q + 0, r: r + 0 });
  }
  return out;
}

function negate(cell) {
  return { q: -cell.q, r: -cell.r };
}

/**
 * 패치 6개를 계약 K-4 의 순서 [top → BR → BL → TL → bottom → TR] 로,
 * 각 패치 내부는 top 순회의 ρ(회전)/반전 사상으로 낸다 (새 순회 규칙 0개):
 *   BR = ρ120(top) · BL = ρ240(top) · TL = 반전(ρ120(top)) · bottom = 반전(top) ·
 *   TR = 반전(ρ240(top)).
 * @param {(k:number) => {q:number,r:number}[]} topEnumerator top 패치 순회
 */
function patchOrbits(k, topEnumerator) {
  const top = topEnumerator(k);
  const br = top.map((c) => rotate120(c.q, c.r));
  const bl = top.map((c) => rotate240(c.q, c.r));
  return [top, br, bl, br.map(negate), top.map(negate), bl.map(negate)];
}

/**
 * 영역 K(k) 전 셀, 결정적 순서 — 육각부 `regionCells(k)` 접두 그대로 + 패치 6개
 * (계약 K-4 순서, 각 패치 내부는 행 오름차순 원시 나열).
 * @param {number} k
 * @returns {{q:number, r:number}[]} 길이 6k² + 6k + 1
 */
export function regionCellsK(k) {
  assertRadius(k);
  return [...regionCells(k), ...patchOrbits(k, topPatchCellsAscending).flat()];
}

/** layoutK.js 가 scan order 를 조립할 때 쓰는 내부 공급자 — 계약 K-4 패치 순서로
 *  top 순회 사상 6벌을 낸다. (공개 계약은 layoutK.dataCellsInScanOrderK 쪽이다.) */
export function patchOrbitsK(k, topEnumerator = topPatchCellsAscending) {
  assertRadius(k);
  return patchOrbits(k, topEnumerator);
}

// ─────────────────────────────────────────────────────────────────────────────
// 별 꼭짓점 앵커 6셀 (계약 K-2)
// ─────────────────────────────────────────────────────────────────────────────
//
// A 계열 3개 = placementA.vertexAnchors(k) 그대로 (digit 5/0/0 — 한 자리도 안 바꾼다).
// 반전 계열 3개 = 그 180° 상 (−q,−r), 전부 ANCHOR_INVERTED_DIGIT(1).
//   TL(−k,−k) · bottom(−k,2k) · TR(2k,−k) — 계약 K-2 표의 순서.
// 전부 중심에서 hexDistance = 2k (유클리드 3k·셀) — 별의 여섯 끝점이다.

/** 반전 계열 꼭짓점 3셀 (digit 1). */
export function invertedVertexAnchors(k) {
  assertRadius(k);
  return vertexAnchors(k).map((anchor) => ({
    q: -anchor.q,
    r: -anchor.r,
    digit: ANCHOR_INVERTED_DIGIT,
  }));
}

/** 별 꼭짓점 앵커 6셀 — A 계열(5/0/0) + 반전 계열(1/1/1), 이 순서로 이어붙임.
 *  기존 육각 코너 3셀(placement.anchorCells)은 보조 앵커로 별도 유지된다(K-3). */
export function vertexAnchorsK(k) {
  return [...vertexAnchors(k), ...invertedVertexAnchors(k)];
}

/** 별 꼭짓점 앵커 좌표 집합 (Set<"q,r">). digit 무관, 위치만. */
export function vertexAnchorPositionSetK(k) {
  return new Set(vertexAnchorsK(k).map((c) => key(c.q, c.r)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 패치 레퍼런스 — 규칙 R′ (계약 K-3)
// ─────────────────────────────────────────────────────────────────────────────
//
// A 의 규칙 R(placementA.patchReferenceCells)을 6패치로 확장한다: 링 목록은 A 와
// 동일(ρ ∈ {k+2, k+5, …, ≤2k−1})하고, 링마다 **top arc 중앙 + TL arc 중앙**을 잡아
// 각각 ρ-궤도(rotate120/240) 3복제 → 링당 6셀. 반전 계열 arc 는 patchOfK==='TL'
// 필터로 정의한다 (계약 K-3 원문 그대로).
//
// 실측 (2026-08-25 프로브): 전 (k, ρ) 에서 top·TL arc 모두 ringWalk 인덱스 연속
// (랩어라운드 없음) — arc 중앙 ⌊(len−1)/2⌋ 이 기하 중앙과 일치한다. A 계열 궤도는
// placementA.patchReferenceCells(k) 와 좌표가 **정확히 같다** (같은 규칙이므로).
// 셀 수: k=6 → 12 · k=8 → 12 · k=10 → 18. ⚠ 계약 K-6 표의 「18/24/36」은 스스로
// 「추정」이라 적은 가정치였고 K-3 규칙의 실계산과 다르다 — K-3 이 규범이다
// (레인 보고서 §계약 대비 이탈).

/**
 * 패치 레퍼런스 셀 전부(규칙 R′). digit 은 REFERENCE_DIGIT(3).
 * @param {number} k
 * @returns {{q:number, r:number, digit:number}[]} 링당 6셀
 */
export function patchReferenceCellsK(k) {
  assertRadius(k);
  const out = [];
  for (const rho of patchReferenceRings(k)) {
    const ring = ringWalk(rho);
    for (const filter of [
      (c) => isTopPatch(c.q, c.r, k),
      (c) => patchOfK(c.q, c.r, k) === 'TL',
    ]) {
      const arc = ring.filter(filter);
      if (arc.length === 0) {
        throw new RangeError(`k=${k} rho=${rho}: 패치 레퍼런스 arc 가 비었다 — 규칙 R′ 전제 위반`);
      }
      const center = arc[Math.floor((arc.length - 1) / 2)];
      const b = rotate120(center.q, center.r);
      const c2 = rotate240(center.q, center.r);
      out.push({ q: center.q, r: center.r, digit: REFERENCE_DIGIT });
      out.push({ q: b.q, r: b.r, digit: REFERENCE_DIGIT });
      out.push({ q: c2.q, r: c2.r, digit: REFERENCE_DIGIT });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 역할 분할 — 육각부(placement.js 무수정) + 꼭짓점 앵커 6 + 패치 레퍼런스 R′
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 영역 K(k) 전체의 역할 분류표. 육각부는 placement.buildRoleSets(k) 를 그대로
 * 재사용(바이트 동일)하고, 별 꼭짓점 앵커·패치 레퍼런스만 그 위에 얹는다 —
 * placementA.buildRoleSetsA 와 같은 구조다.
 * @param {number} k
 * @returns {{anchor: Set<string>, format: Set<string>, reference: Set<string>, finder: Set<string>}}
 */
export function buildRoleSetsK(k) {
  assertRadius(k);
  const hexSets = buildRoleSets(k);
  const anchor = new Set(hexSets.anchor);
  for (const c of vertexAnchorsK(k)) anchor.add(key(c.q, c.r));
  const reference = new Set(hexSets.reference);
  for (const c of patchReferenceCellsK(k)) reference.add(key(c.q, c.r));
  return { anchor, format: hexSets.format, reference, finder: hexSets.finder };
}

/**
 * 셀 (q,r) 의 역할. 육각부는 placement.roleOf 와 동일 판정, 패치 좌표만
 * anchor/reference/data 로 새로 갈린다 — placementA.roleOfA 동형.
 * @returns {'bullseye'|'anchor'|'format'|'reference'|'data'}
 */
export function roleOfK(q, r, k, roleSets) {
  const d = hexDistance(q, r);
  if (d <= 2) return 'bullseye'; // BULLSEYE_RADIUS — placement.js 와 같은 값
  const sets = roleSets || buildRoleSetsK(k);
  const kk = key(q, r);
  if (sets.finder && sets.finder.has(kk)) return 'finder';
  if (sets.anchor.has(kk)) return 'anchor';
  if (sets.format.has(kk)) return 'format';
  if (sets.reference.has(kk)) return 'reference';
  return 'data';
}

// ─────────────────────────────────────────────────────────────────────────────
// 로드 시점 자기검증 — 유도가 주장대로인지 못 박는다 (placementA 턴A 블록 전례).
// 「영역 = 6k²+6k+1 · 패치 사상이 정확히 그 패치에 떨어진다 · 앵커/레퍼런스가
//  서로·데이터와 안 겹친다」 — 하나라도 깨지면 회계·scan order 가 조용히 어긋난다.
// ─────────────────────────────────────────────────────────────────────────────
{
  const PATCH_ORDER = ['top', 'BR', 'BL', 'TL', 'bottom', 'TR'];
  for (const k of [4, 6, 8, 10]) {
    const region = regionCellsK(k);
    const expectedTotal = 6 * k * k + 6 * k + 1;
    if (region.length !== expectedTotal) {
      throw new Error(`placementK: k=${k} 영역 길이 ${region.length} !== ${expectedTotal}`);
    }
    const seen = new Set(region.map((c) => key(c.q, c.r)));
    if (seen.size !== region.length) {
      throw new Error(`placementK: k=${k} 영역에 중복 셀이 있다`);
    }
    for (const c of region) {
      if (!isInRegionK(c.q, c.r, k)) {
        throw new Error(`placementK: k=${k} 영역 밖 셀 ${key(c.q, c.r)}`);
      }
    }
    // 패치 사상 검증 — i번째 궤도의 셀 전부가 계약 K-4 순서의 그 패치여야 한다.
    const orbits = patchOrbitsK(k);
    orbits.forEach((cells, i) => {
      for (const c of cells) {
        const patch = patchOfK(c.q, c.r, k);
        if (patch !== PATCH_ORDER[i]) {
          throw new Error(`placementK: k=${k} 궤도 ${i}(${PATCH_ORDER[i]}) 셀 ${key(c.q, c.r)} 이 ${patch} 다`);
        }
      }
    });
    // 앵커 6 = 전부 d=2k (계약 K-2), digit 은 {5,0,0,1,1,1}.
    const anchors = vertexAnchorsK(k);
    if (anchors.length !== 6) throw new Error('placementK: 꼭짓점 앵커가 6이 아니다');
    const digits = anchors.map((c) => c.digit).join(',');
    if (digits !== '5,0,0,1,1,1') {
      throw new Error('placementK: 꼭짓점 digit 배열이 5,0,0,1,1,1 이 아니다: ' + digits);
    }
    for (const c of anchors) {
      if (hexDistance(c.q, c.r) !== 2 * k) {
        throw new Error(`placementK: k=${k} 꼭짓점 ${key(c.q, c.r)} 의 d 가 2k 가 아니다`);
      }
    }
    // 겹침 없음: 꼭짓점 앵커 ∩ 패치 레퍼런스 = ∅, 패치 레퍼런스 중복 없음.
    const refs = patchReferenceCellsK(k);
    const refKeys = new Set(refs.map((c) => key(c.q, c.r)));
    if (refKeys.size !== refs.length) {
      throw new Error(`placementK: k=${k} 패치 레퍼런스에 중복이 있다`);
    }
    for (const c of anchors) {
      if (refKeys.has(key(c.q, c.r))) {
        throw new Error(`placementK: k=${k} 앵커 ${key(c.q, c.r)} 가 패치 레퍼런스와 겹친다`);
      }
    }
    // 레퍼런스가 전부 패치 위(코어 밖·영역 안)에 있다.
    for (const c of refs) {
      if (patchOfK(c.q, c.r, k) === null) {
        throw new Error(`placementK: k=${k} 패치 레퍼런스 ${key(c.q, c.r)} 가 패치 밖이다`);
      }
    }
  }
}
