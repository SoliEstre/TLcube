/**
 * markerA.js — Type A 코너 마커 (A-CM) 레이아웃.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 1. 정본 H2O 의 «발자국» 은 그대로, «톤» 은 못 쓴다 — 실측이 가른 것
 * ─────────────────────────────────────────────────────────────────────────
 * 정본 후보 H2O(`finder-oak-candidates.json`, A·k=4·코너 18셀)를 코드로 되짚었더니
 * 그 18셀은 임의 배치가 아니라 **꼭짓점에서 2칸 안쪽 셀을 중심으로 한 반경-1 육각 링**
 * 3개였다 (집합 동일성 실측: k=4 에서 `userNonData` 18셀과 정확히 일치). 그리고 그
 * 규칙은 k=6·8·10 에서도 전부 영역 안에 들어온다. → **발자국은 정본을 그대로 쓴다.**
 * 중심 3셀까지 더한 21셀이 `claude-oak-review.md` §1.2 가 «슬롯 63» 으로 센 집합이고,
 * 이 모듈도 21셀을 쓴다.
 *
 * 반면 **H2O 의 톤 정본은 Type A 알파벳(순위 순열)으로 표현할 수 없다.** 21셀 중
 * **9셀이 비-순열**이다 (예: 링 중심 (3,−6) = (2,2,2) 전면 밝음 · (2,−6) = (2,2,0)).
 * digit 경로(`digitToRanks` → `palette.levels`)는 그런 셀을 못 그린다.
 *
 * 2026-08-20: **렌더러 계약이 열렸다.** `scene.js` 는 `entry.tones` 가 있으면 면별
 * 절대 톤을 파인더 축(bullseyeLight / BULLSEYE_MID / bullseyeDark)으로 그린다.
 * 이 모듈은 정본 H2O 톤을 `h2oTonesByKeyA(k)` 로 실어 주고, A-CM 검출 진입점
 * (`findACornerMarkerHypotheses`)이 그 표를 기본값으로 관통한다. 무인자
 * `markerCellsA(k)` 산출은 그대로 digit-only 다 — 톤은 명시적으로 실어야 한다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2. 방향 margin 1.0000 — A 는 O 보다 깨끗하다
 * ─────────────────────────────────────────────────────────────────────────
 * O-CM 은 코너 셀이 레거시 앵커(digit 5/0/0)라 36 슬롯 중 2 가 회전 공변으로 남았다.
 * **A 의 마커는 꼭짓점 앵커를 포함하지 않는다** — 링 중심이 꼭짓점에서 2칸 안쪽이라
 * 링 6셀도 앵커에 안 닿는다. 그래서 앵커 제약이 없고, 63 슬롯 전부를 비공변으로 둘 수 있다.
 *
 * 배정 규칙: ρ 는 링 방향 인덱스를 i → i+2 로 보낸다(`AXIAL_DIRECTIONS` 순서 기준).
 * 그래서 링 digit 을 **인덱스 패리티로만** 정하면(주기 2) 회전 후 비교 대상이 항상
 * 같은 digit 이 되고, `σ(d)` 와 `d` 는 세 면이 전부 다르므로(markerO §2 와 같은 논거)
 * 모든 슬롯이 어긋난다. 중심 digit 도 마찬가지다.
 *   → **margin = 1 − 0/63 = 1.0000** (모듈 자기검증이 실행 시 확인한다).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 3. 실루엣 의존 — 애초에 없었다 (oak §4-7 답)
 * ─────────────────────────────────────────────────────────────────────────
 * 「A 실루엣 프론트엔드 확인」은 이렇게 닫힌다: **A 에는 삼각 실루엣 검출 경로가 없다.**
 * 디코더의 A 경로는 `decoder/family.js` 의 `scoreTriTiling`(gridKind
 * 'hex-core-tri-patch' — 불스아이 H 로 코어·패치 셀을 찍어 채점) + `decoder/
 * bootstrap.js` L1419 의 `findAAnchorHypotheses` 다. 실루엣 hull 을 쓰는
 * `cube-detect.simplifyHullToHex`/`detectCubeFromSilhouette` 는 **cube(Y) 패밀리 전용**
 * 이고 A 는 그 경로를 타지 않는다. 즉 A 의 전면 탐색은 이미 불스아이 앵커드다.
 * 마커는 여기에 **원거리 기하 증거 3점**을 더해 불스아이 단독 의존을 낮춘다
 * (실루엣 의존을 줄이는 게 아니라, 없던 실루엣 대신 있는 유일한 의존을 보강한다).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 4. 충돌 — 최외곽 패치 레퍼런스 3셀만
 * ─────────────────────────────────────────────────────────────────────────
 * 실측: 전 k 에서 링 마커가 먹는 비-데이터 셀은 **패치 레퍼런스 링 ρ=2k−1 의 3셀뿐**
 * 이다 (A0 (6,−11)·(5,6)·(−11,5) / A1 (7,−13)… / A2 (9,−18)…). 육각부(format·
 * reference·불스아이·육각 코너 앵커)와 꼭짓점 앵커는 **한 셀도 안 건드린다** — 마커가
 * 전부 패치 안에 있기 때문이다. 그래서 여기서는 `autoplaceHex` 급의 전면 재배치가
 * 필요 없고, 규칙 R 의 «arc 중앙» 선택만 «arc 중앙에서 가장 가까운 빈 칸» 으로 넓힌다
 * (결정적 · 자리가 없으면 AutoplaceError).
 *
 * 런타임 의존성 0 · 순수 ESM.
 */

import { neighbors, AXIAL_DIRECTIONS, hexDistance } from './hexgrid.js';
import { rotate120, rotate240, ringWalk, REFERENCE_DIGIT } from './placement.js';
import {
  isInRegionA,
  isTopPatch,
  patchReferenceRings,
  buildRoleSetsA,
  vertexAnchors,
  regionCellsA,
} from './placementA.js';
import { dataCellsInScanOrderA } from './layoutA.js';
import { AutoplaceError } from './autoplaceY.js';
import { digitToRanks } from './lehmer.js';
import { maxBytesForSymbols } from './capacity.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { VERSIONS_A } from './capacityA.js';
import { markerGSpec } from './markerG.js';
import { rotateDigitCw, rotateDigitCcw } from './markerO.js';

export const AUTOPLACE_TRI_PATCH_REF = 'AUTOPLACE_TRI_PATCH_REF';

function key(q, r) {
  return q + ',' + r;
}

function assertK(k) {
  if (!Number.isInteger(k) || k < 4) {
    throw new RangeError('k 는 4 이상의 정수여야 한다: ' + k);
  }
  return k;
}

// ─────────────────────────────────────────────────────────────────────────
// 기하 — 링 중심 3개 + 반경-1 링 18셀
// ─────────────────────────────────────────────────────────────────────────

/** 링 중심 3셀 (top → BR → BL, ρ 궤도). 정본 H2O 유도값. */
export function ringCentersA(k) {
  assertK(k);
  const top = { q: k - 1, r: -2 * k + 2 };
  const br = rotate120(top.q, top.r);
  const bl = rotate240(top.q, top.r);
  return [top, br, bl];
}

/**
 * 마커 로컬 digit — 중심 Z 와 링 인덱스 패리티 두 값.
 * 링 digit 을 패리티로만 정하는 이유는 모듈 헤더 §2 (ρ 가 i → i+2).
 * 값은 markerO 의 알파벳(4·1·2)과 맞춰 코드 전체에서 마커 digit 어휘를 통일했다.
 */
export const MARKER_LOCAL_DIGITS_A = Object.freeze({ ringEven: 4, ringOdd: 1, center: 2 });

/**
 * 정본 H2O 의 면별 톤 — k=4 편집기 export 를 로컬 라벨(Z, R0..R5) × 코너에 고정.
 * 다른 k 는 같은 로컬 라벨을 링 중심에 복사한다 (`h2oTonesByKeyA`).
 * export 에 없는 면은 중간색 1 (편집기 v2 규약). 실측: 비-순열 9셀.
 */
export const H2O_LOCAL_TONES_A = Object.freeze({
  0: Object.freeze({
    Z: Object.freeze({ T: 2, L: 2, R: 2 }),
    R0: Object.freeze({ T: 2, L: 0, R: 2 }),
    R1: Object.freeze({ T: 2, L: 0, R: 2 }),
    R2: Object.freeze({ T: 2, L: 2, R: 0 }),
    R3: Object.freeze({ T: 2, L: 2, R: 0 }),
    R4: Object.freeze({ T: 0, L: 2, R: 2 }),
    R5: Object.freeze({ T: 0, L: 2, R: 2 }),
  }),
  1: Object.freeze({
    Z: Object.freeze({ T: 0, L: 0, R: 0 }),
    R0: Object.freeze({ T: 1, L: 2, R: 0 }),
    R1: Object.freeze({ T: 0, L: 2, R: 1 }),
    R2: Object.freeze({ T: 0, L: 1, R: 2 }),
    R3: Object.freeze({ T: 1, L: 0, R: 2 }),
    R4: Object.freeze({ T: 2, L: 0, R: 1 }),
    R5: Object.freeze({ T: 2, L: 1, R: 0 }),
  }),
  2: Object.freeze({
    Z: Object.freeze({ T: 0, L: 0, R: 0 }),
    R0: Object.freeze({ T: 1, L: 2, R: 0 }),
    R1: Object.freeze({ T: 0, L: 2, R: 1 }),
    R2: Object.freeze({ T: 0, L: 1, R: 2 }),
    R3: Object.freeze({ T: 1, L: 0, R: 2 }),
    R4: Object.freeze({ T: 2, L: 0, R: 1 }),
    R5: Object.freeze({ T: 2, L: 1, R: 0 }),
  }),
});

/** 정본 H2O 톤을 k 의 마커 좌표로 전개한 표 ("q,r" → {T,L,R}). */
export function h2oTonesByKeyA(k) {
  assertK(k);
  const map = new Map();
  for (const cell of markerCellsA(k)) {
    const tones = H2O_LOCAL_TONES_A[cell.corner][cell.label];
    if (!tones) {
      throw new Error('markerA: H2O 로컬 표에 코너 ' + cell.corner + ' 라벨 ' + cell.label + ' 가 없다');
    }
    map.set(key(cell.q, cell.r), tones);
  }
  return map;
}

/**
 * 절대 톤 표 조회 — 마커 셀 «전부» 의 톤이 있어야 한다. 누락을 조용한 digit 폴백으로
 * 덮지 않고 즉시 던진다: 톤 표는 «정본 톤 채택» 이라는 명시적 결정의 산출물이라
 * (모듈 헤더 §1 — H2O 정본 21셀 중 9셀이 비-순열) 부분 적용이 성립하지 않는다.
 */
function toneTripleFrom(tonesByKey, q, r) {
  const kk = key(q, r);
  const raw = tonesByKey instanceof Map ? tonesByKey.get(kk) : tonesByKey[kk];
  if (!raw || typeof raw !== 'object') {
    throw new RangeError('markerA: 톤 표에 ' + kk + ' 가 없다 — 마커 셀 전부의 톤이 필요하다');
  }
  const tones = {};
  for (const face of ['T', 'L', 'R']) {
    const tone = raw[face];
    if (tone !== 0 && tone !== 1 && tone !== 2) {
      throw new RangeError('markerA: ' + kk + '.' + face + ' 톤이 0/1/2 가 아니다: ' + tone);
    }
    tones[face] = tone;
  }
  return tones;
}

/**
 * 마커 21셀 — 코너 3 × (중심 1 + 링 6). 순서는 코너(top→BR→BL) → 라벨(Z, R0..R5).
 *
 * `tonesByKey`("q,r" → {T,L,R}, Map 또는 평범한 객체)를 주면 각 셀에 절대 톤
 * `tones: {T,L,R}` (0/1/2)가 실린다 — `corner-marker-detect` 가 그 셀을 순위 접기
 * 대신 **절대 톤 경로**로 검증한다 (비-순열 정본 톤은 순위로 표현이 안 되므로 —
 * 모듈 헤더 §1). digit 은 그대로 남는다: digit 은 렌더(alphabet) 계약이고 tones 는
 * 디코더 검증 계약이라 층이 다르다. 렌더러가 비-순열 톤을 못 그리는 사실은 변하지
 * 않았으므로, 정본 톤 «생성» 채택은 여전히 운영자 결정이다.
 * @param {number} k
 * @param {Map<string,{T:number,L:number,R:number}>|Record<string,{T:number,L:number,R:number}>} [tonesByKey]
 * @returns {{q:number,r:number,digit:number,label:string,corner:number,role:'marker',tones?:{T:number,L:number,R:number}}[]}
 */
export function markerCellsA(k, tonesByKey) {
  assertK(k);
  const centers = ringCentersA(k);
  const out = [];
  for (let corner = 0; corner < centers.length; corner += 1) {
    const centre = centers[corner];
    out.push({
      q: centre.q,
      r: centre.r,
      digit: MARKER_LOCAL_DIGITS_A.center,
      label: 'Z',
      corner,
      role: 'marker',
    });
    const ring = neighbors(centre.q, centre.r);
    if (ring.length !== AXIAL_DIRECTIONS.length) {
      throw new Error('markerA: 링 이웃 수가 6 이 아니다');
    }
    ring.forEach((cell, index) => {
      out.push({
        q: cell.q,
        r: cell.r,
        digit: index % 2 === 0 ? MARKER_LOCAL_DIGITS_A.ringEven : MARKER_LOCAL_DIGITS_A.ringOdd,
        label: 'R' + index,
        corner,
        role: 'marker',
      });
    });
  }
  if (tonesByKey === undefined) return out;
  return out.map((cell) => ({ ...cell, tones: toneTripleFrom(tonesByKey, cell.q, cell.r) }));
}

export function markerPositionSetA(k) {
  return new Set(markerCellsA(k).map((c) => key(c.q, c.r)));
}

/** 코너별 묶음 — 검출기가 «코너 단위» 로 다룬다. 기준점(anchor)은 링 중심이다.
 *  `tonesByKey` 는 `markerCellsA` 로 그대로 승계된다 (절대 톤 검증용). */
export function markerGroupsA(k, tonesByKey) {
  const cells = markerCellsA(k, tonesByKey);
  const groups = [];
  for (const cell of cells) {
    if (!groups[cell.corner]) groups[cell.corner] = { corner: cell.corner, cells: [], anchorLabel: 'Z' };
    groups[cell.corner].cells.push(cell);
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────
// 패치 레퍼런스 재배치 — 규칙 R 의 «arc 중앙» 을 «중앙에서 가장 가까운 빈 칸» 으로
// ─────────────────────────────────────────────────────────────────────────

/**
 * 마커를 피한 패치 레퍼런스. 링마다 top arc 중앙에서 |오프셋| 오름차순(동률이면
 * 작은 인덱스 먼저)으로 첫 빈 칸을 잡고 rotate120/240 으로 복제한다 — 규칙 R 의
 * 대칭 복제 구조는 그대로다. 마커가 없으면 산출이 `placementA.patchReferenceCells`
 * 와 좌표까지 같다 (자기검증이 강제).
 * @param {number} k
 */
export function patchReferenceCellsAMarker(k) {
  assertK(k);
  const blocked = markerPositionSetA(k);
  const out = [];
  for (const rho of patchReferenceRings(k)) {
    // 링 안쪽으로 escalate 한다. 최외곽 링 ρ=2k−1 의 top arc 는 셀이 2개뿐인데
    // 마커 링이 그 둘을 다 먹는 k 가 있다(실측: k=6 에서 ρ=11 arc = {(5,−11),(6,−11)}
    // 이 전부 마커). 규칙 R 의 «arc 중앙» 을 «가장 안쪽으로 한 칸씩 물러나며 arc
    // 중앙에서 가장 가까운 빈 칸» 으로 넓힌다 — 결정적이고, 마커가 없으면 ρ 에서
    // 바로 잡히므로 레거시와 좌표가 같다.
    let picked = null;
    let pickedRho = rho;
    for (let probe = rho; probe > k && picked === null; probe -= 1) {
      const arc = ringWalk(probe).filter((c) => isTopPatch(c.q, c.r, k));
      if (arc.length === 0) continue;
      const centre = Math.floor((arc.length - 1) / 2);
      for (let step = 0; step < arc.length && picked === null; step += 1) {
        for (const index of step === 0 ? [centre] : [centre - step, centre + step]) {
          if (index < 0 || index >= arc.length) continue;
          const cell = arc[index];
          if (blocked.has(key(cell.q, cell.r))) continue;
          picked = cell;
          pickedRho = probe;
          break;
        }
      }
    }
    if (picked === null) {
      throw new AutoplaceError(
        AUTOPLACE_TRI_PATCH_REF,
        'k=' + k + ' rho=' + rho + ': 마커를 피한 패치 레퍼런스 자리가 링 ' + (k + 1) + '..' + rho + ' 어디에도 없다',
        { k, rho },
      );
    }
    void pickedRho;
    const br = rotate120(picked.q, picked.r);
    const bl = rotate240(picked.q, picked.r);
    for (const c of [picked, br, bl]) {
      blocked.add(key(c.q, c.r));
      out.push({ q: c.q, r: c.r, digit: REFERENCE_DIGIT });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// 역할 · scan order · 회계
// ─────────────────────────────────────────────────────────────────────────

export function buildRoleSetsAMarker(k) {
  assertK(k);
  const base = buildRoleSetsA(k);
  const marker = markerPositionSetA(k);
  // 패치 레퍼런스는 재배치본으로 갈아 끼운다 — 레거시 좌표는 마커와 겹칠 수 있다.
  const reference = new Set();
  for (const kk of base.reference) {
    if (!marker.has(kk)) reference.add(kk);
  }
  for (const c of patchReferenceCellsAMarker(k)) reference.add(key(c.q, c.r));
  return {
    anchor: base.anchor, marker, format: base.format, reference,
  };
}

export function roleOfAMarker(q, r, k, roleSets) {
  const sets = roleSets || buildRoleSetsAMarker(k);
  const kk = key(q, r);
  if (sets.marker.has(kk)) return 'marker';
  if (sets.anchor.has(kk)) return 'anchor';
  if (sets.format.has(kk)) return 'format';
  if (sets.reference.has(kk)) return 'reference';
  return null; // 육각 코어의 불스아이/데이터 판정은 호출자(layoutA 규칙)가 한다
}

/**
 * 데이터 scan order — `layoutA.dataCellsInScanOrderA` 의 **순회를 그대로 쓰고**
 * 마커 21셀과 «재배치로 새로 레퍼런스가 된 셀» 만 뺀 뒤, «마커가 먹어서 레퍼런스에서
 * 풀려난 셀» 을 도로 넣는다. 순회 규칙(boustrophedon 등)을 복제하지 않는 것이 요점이다
 * — 규칙이 두 곳에 있으면 하나가 조용히 낡는다.
 * @param {number} k
 */
export function dataCellsInScanOrderAMarker(k) {
  assertK(k);
  const sets = buildRoleSetsAMarker(k);
  const legacySets = buildRoleSetsA(k);
  const out = [];
  for (const cell of regionCellsA(k)) {
    const kk = key(cell.q, cell.r);
    if (sets.marker.has(kk)) continue;
    if (sets.anchor.has(kk) || sets.format.has(kk) || sets.reference.has(kk)) continue;
    if (hexDistance(cell.q, cell.r) <= 2) continue; // 불스아이
    out.push(cell);
  }
  // scan order 는 레거시 순회 순서를 그대로 따른다: 레거시 목록에서 남은 것 + 새로
  // 데이터가 된 셀(레거시 레퍼런스였다가 재배치로 풀린 셀)을 레거시 순회에 없으므로
  // 뒤에 붙인다. 실측상 그런 셀은 레거시 패치 레퍼런스 중 마커에 먹힌 것뿐이다.
  const legacyOrder = dataCellsInScanOrderA(k);
  const keep = new Set(out.map((c) => key(c.q, c.r)));
  const ordered = legacyOrder.filter((c) => keep.has(key(c.q, c.r)));
  const seen = new Set(ordered.map((c) => key(c.q, c.r)));
  const freed = out.filter((c) => !seen.has(key(c.q, c.r)))
    .sort((a, b) => a.q - b.q || a.r - b.r);
  void legacySets;
  return [...ordered, ...freed];
}

/** 필러 셀 — scan order 꼬리 (C mod 3). */
export function fillerCellsAMarker(k) {
  const scan = dataCellsInScanOrderAMarker(k);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

// ─────────────────────────────────────────────────────────────────────────
// 방향 margin
// ─────────────────────────────────────────────────────────────────────────

/** 마커 21셀 × 3면 = 63 슬롯의 회전 일치율 → margin. */
export function orientationMarginAMarker(k) {
  const cells = markerCellsA(k);
  const byPos = new Map(cells.map((c) => [key(c.q, c.r), c.digit]));
  function agreeFor(rotCell, rotDigit) {
    let agree = 0;
    for (const c of cells) {
      const p = rotCell(c.q, c.r);
      const there = byPos.get(key(p.q, p.r));
      if (there === undefined) continue;
      const moved = digitToRanks(rotDigit(c.digit));
      const truth = digitToRanks(there);
      if (moved.T === truth.T) agree += 1;
      if (moved.L === truth.L) agree += 1;
      if (moved.R === truth.R) agree += 1;
    }
    return agree;
  }
  const slots = cells.length * 3;
  const agree120 = agreeFor((q, r) => rotate120(q, r), rotateDigitCw);
  const agree240 = agreeFor((q, r) => rotate240(q, r), rotateDigitCcw);
  return {
    margin: 1 - Math.max(agree120, agree240) / slots, slots, agree120, agree240,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 용량 — capacityA 회계 승계, 마커 21셀만큼 데이터가 준다
// ─────────────────────────────────────────────────────────────────────────
//
// NSYM 산출 절차는 capacityY.js NSYM_TABLE_Y 헤더와 같다
// (M = round(0.25·S), 짝수면 +1 홀수화 · L = round(0.12·S) · H = round(0.40·S)):
//   A0CM S=38  → M round(9.5)=10(짝) → 11 · L round(4.56)=5  · H round(15.2)=15
//   A1CM S=82  → M round(20.5)=21(홀)     · L round(9.84)=10 · H round(32.8)=33
//   A2CM S=136 → M round(34)=34(짝) → 35  · L round(16.32)=16 · H round(54.4)=54
// ⚠ 제안이다 — 비준은 운영자.

export const NSYM_TABLE_ACM = Object.freeze({
  A0CM: Object.freeze({
    symbols: 38, L: 5, M: 11, H: 15,
  }),
  A1CM: Object.freeze({
    symbols: 82, L: 10, M: 21, H: 33,
  }),
  A2CM: Object.freeze({
    symbols: 136, L: 16, M: 35, H: 54,
  }),
});

/** 마커가 먹는 셀 수 (전 k 공통 21). */
export const MARKER_CELL_COUNT_A = 21;

// formatIndex 는 레거시 A 가 아니라 **내부 타입 G 표**(`markerG.js`, 운영자 확정
// 2026-08-20)에서 유도한다 — 레거시 값을 그대로 실으면 디코더가 마커 회계(21셀)를
// 와이어에서 구분할 수 없다 (실기 「코너 마커 코드 스캔 불가」의 근본 원인).
export const VERSIONS_ACM = Object.freeze(VERSIONS_A.map((spec) => Object.freeze({
  name: spec.name + 'CM',
  version: spec.version,
  k: spec.k,
  formatIndex: markerGSpec('tri', spec.version).formatIndex,
  overhead: spec.overhead + MARKER_CELL_COUNT_A,
  symbolKey: spec.name + 'CM',
})));

export function capacityForAMarker(spec, level = 'M') {
  const totalCells = ((3 * spec.k + 1) * (3 * spec.k + 2)) / 2;
  const dataCells = totalCells - spec.overhead;
  if (dataCells <= 0) throw new RangeError(spec.name + ': 오버헤드가 총 셀 이상이다');
  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;
  const table = NSYM_TABLE_ACM[spec.symbolKey];
  if (!table) throw new RangeError(spec.name + ': NSYM_TABLE_ACM 에 키가 없다');
  if (table.symbols !== usedSymbols) {
    throw new RangeError(
      spec.name + ': 실계산 사용 심볼 ' + usedSymbols + ' 이 NSYM_TABLE_ACM.'
      + spec.symbolKey + '.symbols (' + table.symbols + ') 과 어긋난다',
    );
  }
  const nsym = table[level];
  if (!Number.isInteger(nsym)) throw new RangeError(spec.name + ': 레벨 ' + level + ' 이 없다');
  const dataSymbols = usedSymbols - nsym;
  if (dataSymbols <= 0) throw new RangeError(spec.name + '/' + level + ': nsym 이 너무 크다');
  const dataBytes = maxBytesForSymbols(dataSymbols);
  return {
    name: spec.name,
    version: spec.version,
    k: spec.k,
    cornerMarker: true,
    formatIndex: spec.formatIndex,
    totalCells,
    overhead: spec.overhead,
    dataCells,
    usedSymbols,
    residualCells,
    level,
    nsym,
    errorCapacity: errorCapacity(nsym),
    dataSymbols,
    dataBytes,
    maxPayloadBytes: maxPayloadFor(dataBytes),
    headerBytes: HEADER_BYTES,
  };
}

export function capacityTableAMarker(level = 'M') {
  return VERSIONS_ACM.map((spec) => capacityForAMarker(spec, level));
}

// ─────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증
// ─────────────────────────────────────────────────────────────────────────
{
  for (const spec of VERSIONS_A) {
    const k = spec.k;
    const cells = markerCellsA(k);
    if (cells.length !== MARKER_CELL_COUNT_A) {
      throw new Error('markerA k=' + k + ': 마커 셀 수가 ' + MARKER_CELL_COUNT_A + ' 이 아니다');
    }
    // ① 전 셀이 영역 A 안이고 꼭짓점 앵커와 겹치지 않는다.
    const vertexKeys = new Set(vertexAnchors(k).map((c) => key(c.q, c.r)));
    for (const c of cells) {
      if (!isInRegionA(c.q, c.r, k)) throw new Error('markerA k=' + k + ': 마커 셀이 영역 밖 ' + key(c.q, c.r));
      if (vertexKeys.has(key(c.q, c.r))) throw new Error('markerA k=' + k + ': 마커가 꼭짓점 앵커와 겹친다');
    }
    // ② ρ-불변 + 방향 margin 1.0
    const set = markerPositionSetA(k);
    for (const rot of [rotate120, rotate240]) {
      for (const kk of set) {
        const [q, r] = kk.split(',').map(Number);
        const p = rot(q, r);
        if (!set.has(key(p.q, p.r))) throw new Error('markerA k=' + k + ': 마커 집합이 ρ-불변이 아니다');
      }
    }
    const margin = orientationMarginAMarker(k);
    if (margin.agree120 !== 0 || margin.agree240 !== 0) {
      throw new Error('markerA k=' + k + ': 회전 공변 슬롯이 남았다 ' + JSON.stringify(margin));
    }
    // ③ 재배치된 패치 레퍼런스가 마커와 안 겹치고 개수가 유지된다.
    const refs = patchReferenceCellsAMarker(k);
    if (refs.length !== patchReferenceRings(k).length * 3) {
      throw new Error('markerA k=' + k + ': 패치 레퍼런스 수가 달라졌다');
    }
    for (const c of refs) {
      if (set.has(key(c.q, c.r))) throw new Error('markerA k=' + k + ': 패치 레퍼런스가 마커와 겹친다');
    }
  }
}
