/**
 * markerO.js — Type O 코너 마커 (O-CM) 레이아웃.
 *
 * 운영자 지시: «O/K/A 타입도 마커 구현 필요. 인식 여건을 Y 계열과 같은 수준으로.»
 * Y 의 v0/v0X 코너 마커 문법을 육각 격자로 옮긴 것이다. **중앙 불스아이는 그대로
 * 두고** 코너 마커는 «보조 앵커» 로만 쓴다 — 왜곡 시 호모그래피 보강 + 방향 확정.
 * (claude-oak-review.md §2.4: central-finder 는 no-go, 중앙 슬롯 교체 금지.)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 1. 왜 «tetrad» 인가 — 측정이 정한 모양
 * ─────────────────────────────────────────────────────────────────────────
 * 육각 코너 셀은 영역 안 이웃이 정확히 3개다(6 중 3은 영역 밖). 그래서 «코너 셀 +
 * 영역 내 이웃 전부» 는 자동으로 4셀이고, 이보다 작으면 마커가 아니라 앵커이며
 * 이보다 크면 링을 따라 임의로 늘리는 선택이 된다. 이 4셀 묶음을 tetrad 라 한다.
 *
 * 교대 코너 3개(세트 A = `ANCHOR_CORNER_INDICES`)에만 놓는다. 실측 결과(전 k 공통):
 *
 *   | 가설 | 마커 12셀 중 마커로 되돌아오는 셀 |
 *   |---|---|
 *   | 항등 · 120° · 240° | **12/12** |
 *   | **60° · 180° · 300°** | **0/12** |
 *   | 거울 m0/m1/m2 (변 중점 축) | **0/12** |
 *   | 거울 m3/m4/m5 (코너 관통 축) | 12/12 |
 *
 * 즉 **60°급 오가설과 절반의 거울 가설은 톤을 보기도 전에 «위치» 로 죽는다** —
 * 그 가설에서 마커가 있어야 할 자리는 홀수 코너이고 거기엔 데이터가 있다.
 * claude-oak-review.md §1.3 이 «margin 이 커버하지 않는 클래스» 라 적은 바로 그
 * 60° 급을, 이 배치는 구조로 제거한다. 남는 것은 코너 관통 거울 3개뿐이고 그것은
 * 톤(면 배정)이 가른다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2. 왜 «같은 로컬 튜플을 세 코너에 그대로 복사» 하는가 — 회전 margin 0.9444
 * ─────────────────────────────────────────────────────────────────────────
 * 물리 120° 회전은 «좌표 회전(rotate120) ∘ 면 순환(T→R→L)» 합성이다
 * (claude-oak-review.md §1.1, 이 모듈이 σ=[4,5,1,0,3,2] 로 독립 재현했고
 * `decoder/anchor-detect.js` 의 SIGMA_CW 와 값이 같다).
 *
 * 로컬 라벨(A,B,C,D)은 ρ-동변이다: ρ(T0.X) = T2.X, ρ²(T0.X) = T4.X. 그래서 세
 * tetrad 에 **같은 로컬 digit 튜플을 σ 없이 그대로** 쓰면, 회전한 코드가 내는 digit
 * 은 σ(d) 인데 정본은 d 라서 어긋난다. 그리고 **모든 d 에서 σ(d) 와 d 는 세 면이
 * 전부 다르다** — σ 가 고정점 없는 3-순환이고 digit→ranks 는 단사라 rank 가 같은
 * 면이 존재할 수 없다(대수적으로 증명되고 아래 자기검증이 실행 시 확인한다).
 *
 * 결과: 마커 12셀 × 3면 = 36 슬롯 중 **레거시 앵커 digit(5,0,0) 이 강제하는 2 슬롯만**
 * 회전 공변이고 나머지 34 는 전부 어긋난다 → **방향 margin = 1 − 2/36 = 0.9444.**
 * (대조: H2O(A) 0.6667 · H2CO3(K) 0.4667 · Benzene(O) 0.386 · v2r2 게이트 0.035.)
 * 전수 탐색으로 이 값이 «앵커 digit 을 유지하는 배정의 최대» 임을 확인했다(동률 1728).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 3. 레거시 계약 보존
 * ─────────────────────────────────────────────────────────────────────────
 * - 코너 셀 A 는 **앵커 그대로** (digit 5/0/0, `placement.anchorCells`). 따라서
 *   `decoder/anchor-detect.js` 의 3점 앵커 판정은 **한 줄도 안 고치고** O-CM 에서도
 *   그대로 성립한다. 마커는 앵커를 대체하지 않고 **감싼다.**
 * - 불스아이(hexDistance ≤ 2) 무변경 — 실사 24/24 기준선을 건드리지 않는다.
 * - format/reference 는 `autoplaceHex.placeReservedCellsHex` 가 마커 점유를 피해
 *   재배치한다. 마커 없이 부르면 레거시 좌표와 바이트 동일이다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 4. 와이어 (formatIndex) — 신설하지 않는다
 * ─────────────────────────────────────────────────────────────────────────
 * O-CM 은 **formatIndex 를 새로 만들지 않는다.** V1/V2/V3(및 V*Q) 인덱스를 그대로
 * 쓰고, 마커 유/무는 **광학 검출 + 사후 RS/CRC** 로 가른다 — Type Y 의 Y2W(면 내 QR
 * 윈도)가 이미 쓰는 계약과 같다 (`capacityY.js` capacityForY2Window: «윈도 유/무는
 * 와이어가 아니라 광학 검출 + 사후 RS/CRC 로 구분한다»). 디코더는 코너 마커 검증이
 * 통과하면 O-CM 회계로, 아니면 레거시 O 회계로 본문을 푼다.
 * 전용 인덱스가 필요하다는 판단이 서면 그것은 통합자·운영자 결정이다 — 이 모듈은
 * 제안만 남긴다 (test/output/claude-oak-markers.md §와이어 제안).
 *
 * 런타임 의존성 0 · 순수 ESM.
 */

import { hexDistance, neighbors } from './hexgrid.js';
import {
  FORMAT_RING,
  ANCHOR_CORNER_INDICES,
  corners,
  anchorCells,
  ringWalk,
  rotate120,
  rotate240,
} from './placement.js';
import { occupiedCells as bullseyeCells } from './bullseye.js';
import { placeReservedCellsHex } from './autoplaceHex.js';
import { digitToRanks, ranksToDigit } from './lehmer.js';
import { maxBytesForSymbols } from './capacity.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';

const MIN_K = FORMAT_RING + 1;

function key(q, r) {
  return q + ',' + r;
}

function assertK(k) {
  if (!Number.isInteger(k) || k < MIN_K) {
    throw new RangeError('k 는 ' + MIN_K + ' 이상의 정수여야 한다: ' + k);
  }
  return k;
}

// ─────────────────────────────────────────────────────────────────────────
// σ — 물리 120° CW 회전의 digit 치환 (면 내용이 T→R→L 로 간다)
// ─────────────────────────────────────────────────────────────────────────

/** digit d 를 물리 120° CW 회전 후의 digit 으로. `anchor-detect.SIGMA_CW` 와 동일. */
export function rotateDigitCw(d) {
  const r = digitToRanks(d);
  return ranksToDigit({ T: r.L, L: r.R, R: r.T });
}

/** digit d 를 물리 240°(= CCW 120°) 회전 후의 digit 으로. */
export function rotateDigitCcw(d) {
  return rotateDigitCw(rotateDigitCw(d));
}

// ─────────────────────────────────────────────────────────────────────────
// tetrad 기하 — 로컬 라벨 A(코너) · B · C · D
// ─────────────────────────────────────────────────────────────────────────

/** 로컬 라벨 순서 (마커 셀 나열·digit 튜플의 정준 순서). */
export const MARKER_LABELS = Object.freeze(['A', 'B', 'C', 'D']);

/**
 * 코너 0(= (k,0)) tetrad 의 로컬 좌표. 나머지 두 코너는 ρ / ρ² 상이다.
 *   A = (k, 0)   코너 셀 (= 레거시 앵커)
 *   B = (k, −1)  링 k 이웃
 *   C = (k−1, 1) 링 k 이웃
 *   D = (k−1, 0) 링 k−1 이웃 (안쪽)
 * @param {number} k
 */
export function tetradBase(k) {
  assertK(k);
  return Object.freeze({
    A: Object.freeze({ q: k, r: 0 }),
    B: Object.freeze({ q: k, r: -1 }),
    C: Object.freeze({ q: k - 1, r: 1 }),
    D: Object.freeze({ q: k - 1, r: 0 }),
  });
}

/**
 * 마커 로컬 digit 튜플 (B, C, D). A 는 앵커 digit 이라 여기 없다.
 *
 * 선택 규칙 (전수 후보 1728 중에서, 아래 셋으로 유일하게 좁혀진다):
 *   ① A·B·C·D 네 digit 이 서로 다르다 — 코너 셀 A 가 코너 0 에서 5, 코너 2·4 에서
 *      0 이므로 {0,5} 를 피한다 → B,C,D ∈ {1,2,3,4}.
 *   ② tetrad 안에서 세 면 {A.L, C.T, D.R} 은 **한 꼭짓점에 모이는 3-마름모**다
 *      (면 폴리곤 변 공유로 실측). 이 셋의 rank 를 서로 다르게 두면 마커마다
 *      «중앙 불스아이와 같은 3톤 큐브» 가 하나씩 생긴다 — 연속 회전각을 읽을 수 있는
 *      Y-접합이고(`decoder/cube-bullseye.readCubeOrientation` 과 같은 계열),
 *      국소 정합의 기준점이 된다.
 *   ③ ①+② 를 동시에 만족하는 것은 (C,D) = (1,2) 또는 (3,4) 두 갈래뿐이고, 남는
 *      B 는 각각 {3,4} · {1,2} 다.
 * 그중 **B=4 · C=1 · D=2** 를 채택한다 — 두 갈래의 3톤 큐브 위상이 서로 거울이고
 * (1,2,0) 쪽이 중앙 불스아이 큐브의 정본 위상(`finder-oak-candidates.json`
 * toneRanks T2·L1·R0 의 순환 방향)과 같은 손잡이라 코드 전체의 큐브 방향이 통일된다.
 *
 * @type {Readonly<{B:number, C:number, D:number}>}
 */
export const MARKER_LOCAL_DIGITS = Object.freeze({ B: 4, C: 1, D: 2 });

function applyRotation(cell, times) {
  if (times === 0) return { q: cell.q, r: cell.r };
  if (times === 1) return rotate120(cell.q, cell.r);
  return rotate240(cell.q, cell.r);
}

/**
 * 마커 12셀 — 코너 3개 × tetrad 4셀. 각 원소는 좌표 + digit + 로컬 라벨 + 코너 인덱스.
 * 순서는 코너(세트 A 열거 순) → 라벨(A,B,C,D) 로 결정적이다.
 * @param {number} k
 * @returns {{q:number, r:number, digit:number, label:string, corner:number, role:'anchor'|'marker'}[]}
 */
export function markerCells(k) {
  assertK(k);
  const base = tetradBase(k);
  const anchors = anchorCells(k);
  const out = [];
  for (let m = 0; m < ANCHOR_CORNER_INDICES.length; m += 1) {
    const cornerIndex = ANCHOR_CORNER_INDICES[m];
    const anchor = anchors[m];
    for (const label of MARKER_LABELS) {
      const p = applyRotation(base[label], m);
      if (label === 'A') {
        if (p.q !== anchor.q || p.r !== anchor.r) {
          throw new Error('markerO: tetrad A 가 앵커 좌표와 어긋난다 — ρ 궤도 가정 위반');
        }
        out.push({
          q: p.q, r: p.r, digit: anchor.digit, label, corner: cornerIndex, role: 'anchor',
        });
      } else {
        out.push({
          q: p.q,
          r: p.r,
          digit: MARKER_LOCAL_DIGITS[label],
          label,
          corner: cornerIndex,
          role: 'marker',
        });
      }
    }
  }
  return out;
}

/** 마커가 점유하는 좌표 집합 (앵커 3셀 포함, 12개). */
export function markerPositionSet(k) {
  return new Set(markerCells(k).map((c) => key(c.q, c.r)));
}

/** 코너별 tetrad — 검출기가 «코너 단위» 로 다루기 위한 묶음. */
export function markerTetrads(k) {
  const cells = markerCells(k);
  const byCorner = new Map();
  for (const c of cells) {
    if (!byCorner.has(c.corner)) byCorner.set(c.corner, []);
    byCorner.get(c.corner).push(c);
  }
  return Array.from(byCorner.entries()).map(([cornerIndex, list]) => ({
    corner: cornerIndex,
    cells: list,
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// 배치 — autoplaceHex 로 format/reference 재유도
// ─────────────────────────────────────────────────────────────────────────

/** 검출기 점유 = 불스아이 풋프린트(19) + 마커 12셀. */
export function reservedOccupiedOMarker(k) {
  assertK(k);
  const out = bullseyeCells().map((c) => ({ q: c.q, r: c.r }));
  for (const c of markerCells(k)) out.push({ q: c.q, r: c.r });
  return out;
}

const placementCache = new Map();

/** O-CM 의 format 15 · reference 2(k−2) 배치 (autoplaceHex 산출, k 당 1회 캐시). */
export function placementOMarker(k) {
  assertK(k);
  if (!placementCache.has(k)) {
    placementCache.set(k, placeReservedCellsHex(k, reservedOccupiedOMarker(k)));
  }
  return placementCache.get(k);
}

export function formatCellsOMarker(k) {
  return placementOMarker(k).formatCells;
}

export function referenceCellsOMarker(k) {
  return placementOMarker(k).referenceCells;
}

/**
 * 역할 집합. 'marker' 는 앵커와 별개 역할이다 — 코너 셀 A 는 계속 'anchor' 이고
 * B·C·D 만 'marker' 다 (레거시 앵커 계약 보존, 모듈 헤더 §3).
 * @param {number} k
 */
export function buildRoleSetsOMarker(k) {
  assertK(k);
  const anchor = new Set();
  const marker = new Set();
  for (const c of markerCells(k)) {
    (c.role === 'anchor' ? anchor : marker).add(key(c.q, c.r));
  }
  const format = new Set(formatCellsOMarker(k).map((c) => key(c.q, c.r)));
  const reference = new Set(referenceCellsOMarker(k).map((c) => key(c.q, c.r)));
  return {
    anchor, marker, format, reference,
  };
}

/**
 * 셀 역할 — `placement.roleOf` 와 같은 값 집합에 'marker' 만 추가된다.
 * @returns {'bullseye'|'anchor'|'marker'|'format'|'reference'|'data'}
 */
export function roleOfOMarker(q, r, k, roleSets) {
  if (hexDistance(q, r) <= 2) return 'bullseye';
  const sets = roleSets || buildRoleSetsOMarker(k);
  const kk = key(q, r);
  if (sets.anchor.has(kk)) return 'anchor';
  if (sets.marker.has(kk)) return 'marker';
  if (sets.format.has(kk)) return 'format';
  if (sets.reference.has(kk)) return 'reference';
  return 'data';
}

/** 데이터 셀 scan order — `layout.dataCellsInScanOrder` 와 같은 규칙(링 major 3..k). */
export function dataCellsInScanOrderOMarker(k) {
  assertK(k);
  const sets = buildRoleSetsOMarker(k);
  const out = [];
  for (let r = FORMAT_RING; r <= k; r += 1) {
    for (const cell of ringWalk(r)) {
      if (roleOfOMarker(cell.q, cell.r, k, sets) === 'data') out.push(cell);
    }
  }
  return out;
}

/** 필러 셀 — scan order 꼬리 (C mod 3). */
export function fillerCellsOMarker(k) {
  const scan = dataCellsInScanOrderOMarker(k);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

/** 오버헤드 실계산 — 불스아이 + 앵커 + 마커(9) + 포맷 + 레퍼런스. */
export function overheadBreakdownOMarker(k) {
  assertK(k);
  const cells = markerCells(k);
  const anchor = cells.filter((c) => c.role === 'anchor').length;
  const marker = cells.filter((c) => c.role === 'marker').length;
  const bullseye = bullseyeCells().length;
  const format = formatCellsOMarker(k).length;
  const reference = referenceCellsOMarker(k).length;
  return {
    k,
    bullseye,
    anchor,
    marker,
    format,
    reference,
    total: bullseye + anchor + marker + format + reference,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 용량 — Y2W 전례를 따른 «변형 표»
// ─────────────────────────────────────────────────────────────────────────
//
// 산출 절차는 `capacityY.js` NSYM_TABLE_Y 헤더가 적은 것과 **완전히 같다**:
//   M = round(0.25·S) (JS half-up), 짝수면 +1 홀수화 · L = round(0.12·S) · H = round(0.40·S)
//   V1CM S=24  → M round(6)=6(짝) → 7    · L round(2.88)=3  · H round(9.6)=10
//   V2CM S=53  → M round(13.25)=13(홀)   · L round(6.36)=6  · H round(21.2)=21
//   V3CM S=89  → M round(22.25)=22(짝)→23 · L round(10.68)=11 · H round(35.6)=36
// 이 표는 **제안**이다 — 확정(비준)은 운영자 몫이고, 그 전까지 O-CM 은 실험 경로다.

/** @type {Readonly<Record<string, Readonly<{symbols:number, L:number, M:number, H:number}>>>} */
export const NSYM_TABLE_OCM = Object.freeze({
  V1CM: Object.freeze({
    symbols: 24, L: 3, M: 7, H: 10,
  }),
  V2CM: Object.freeze({
    symbols: 53, L: 6, M: 13, H: 21,
  }),
  V3CM: Object.freeze({
    symbols: 89, L: 11, M: 23, H: 36,
  }),
});

/** O-CM 버전 정의 — formatIndex 는 레거시 O 와 같다(모듈 헤더 §4). */
export const VERSIONS_OCM = Object.freeze([
  Object.freeze({
    name: 'V1CM', version: 1, k: 6, overhead: overheadBreakdownOMarker(6).total, symbolKey: 'V1CM',
  }),
  Object.freeze({
    name: 'V2CM', version: 2, k: 8, overhead: overheadBreakdownOMarker(8).total, symbolKey: 'V2CM',
  }),
  Object.freeze({
    name: 'V3CM', version: 3, k: 10, overhead: overheadBreakdownOMarker(10).total, symbolKey: 'V3CM',
  }),
]);

/**
 * O-CM 한 버전의 용량. `capacity.capacityFor` 회계를 그대로 승계한다 — 표와 실계산이
 * 어긋나면 조용히 맞추지 않고 던진다.
 * @param {{name:string, version:number, k:number, overhead:number, symbolKey:string}} spec
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityForOMarker(spec, level = 'M') {
  const totalCells = 3 * spec.k * spec.k + 3 * spec.k + 1;
  const dataCells = totalCells - spec.overhead;
  if (dataCells <= 0) {
    throw new RangeError(spec.name + ': 오버헤드 ' + spec.overhead + ' 가 총 셀 ' + totalCells + ' 이상이다');
  }
  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;

  const table = NSYM_TABLE_OCM[spec.symbolKey];
  if (!table) throw new RangeError(spec.name + ': NSYM_TABLE_OCM 에 키 ' + spec.symbolKey + ' 가 없다');
  if (table.symbols !== usedSymbols) {
    throw new RangeError(
      spec.name + ': 실계산 사용 심볼 ' + usedSymbols + ' 이 NSYM_TABLE_OCM.'
      + spec.symbolKey + '.symbols (' + table.symbols + ') 과 어긋난다',
    );
  }
  const nsym = table[level];
  if (!Number.isInteger(nsym)) {
    throw new RangeError(spec.name + ': NSYM_TABLE_OCM.' + spec.symbolKey + ' 에 레벨 ' + level + ' 이 없다');
  }
  const dataSymbols = usedSymbols - nsym;
  if (dataSymbols <= 0) {
    throw new RangeError(spec.name + '/' + level + ': nsym ' + nsym + ' 이 사용 심볼 ' + usedSymbols + ' 이상이다');
  }
  const dataBytes = maxBytesForSymbols(dataSymbols);
  return {
    name: spec.name,
    version: spec.version,
    k: spec.k,
    cornerMarker: true,
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

/** 전 버전 O-CM 용량표. */
export function capacityTableOMarker(level = 'M') {
  return VERSIONS_OCM.map((v) => capacityForOMarker(v, level));
}

// ─────────────────────────────────────────────────────────────────────────
// 방향 margin (이상·무노이즈) — 설계 근거 수치를 코드가 낸다
// ─────────────────────────────────────────────────────────────────────────

/**
 * 마커 12셀 × 3면 = 36 슬롯에서, 물리 회전(좌표 회전 ∘ 면 순환)한 패턴과 원본의
 * 일치율의 최대치를 1 에서 뺀 값. `claude-oak-review.md` §1.2 와 같은 메트릭이다.
 * @param {number} k
 * @returns {{margin:number, slots:number, agree120:number, agree240:number}}
 */
export function orientationMarginOMarker(k) {
  const cells = markerCells(k);
  const byPos = new Map(cells.map((c) => [key(c.q, c.r), c.digit]));
  function agreeFor(rotCell, rotDigit) {
    let agree = 0;
    for (const c of cells) {
      const p = rotCell(c.q, c.r);
      const there = byPos.get(key(p.q, p.r));
      if (there === undefined) continue; // 위치로 이미 죽은 슬롯 — 톤 비교 대상 아님
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
    margin: 1 - Math.max(agree120, agree240) / slots,
    slots,
    agree120,
    agree240,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증 — 설계 주장이 실행 시 참인지 즉시 확인한다
// ─────────────────────────────────────────────────────────────────────────
{
  // ① σ 는 고정점 없는 3-순환이라 어떤 digit 도 자기 자신과 면이 겹치지 않는다.
  for (let d = 0; d < 6; d += 1) {
    const a = digitToRanks(d);
    for (const s of [rotateDigitCw(d), rotateDigitCcw(d)]) {
      const b = digitToRanks(s);
      if (a.T === b.T || a.L === b.L || a.R === b.R) {
        throw new Error('markerO: σ 가 digit ' + d + ' 에서 면을 고정한다 — 설계 전제 위반');
      }
    }
  }
  // ② 마커 위치 집합은 ρ-불변이고 60°·180°·300° 에서는 겹침 0 이어야 한다.
  for (const k of [6, 8, 10]) {
    const set = markerPositionSet(k);
    const maps = [
      ['120', (q, r) => rotate120(q, r), true],
      ['240', (q, r) => rotate240(q, r), true],
      ['60', (q, r) => ({ q: -r, r: q + r }), false],
      ['180', (q, r) => ({ q: -q, r: -r }), false],
      ['300', (q, r) => ({ q: q + r, r: -q }), false],
    ];
    for (const [name, f, wantInvariant] of maps) {
      let hit = 0;
      for (const kk of set) {
        const [q, r] = kk.split(',').map(Number);
        const p = f(q, r);
        if (set.has(key(p.q, p.r))) hit += 1;
      }
      const want = wantInvariant ? set.size : 0;
      if (hit !== want) {
        throw new Error('markerO k=' + k + ': ' + name + '° 겹침 ' + hit + ' 이 기대 ' + want + ' 와 다르다');
      }
    }
    // ③ 마커·포맷·레퍼런스·불스아이가 서로 안 겹친다.
    const seen = new Set();
    for (const c of [...markerCells(k), ...formatCellsOMarker(k), ...referenceCellsOMarker(k),
      ...bullseyeCells()]) {
      const kk = key(c.q, c.r);
      if (seen.has(kk)) throw new Error('markerO k=' + k + ': 역할 좌표 충돌 ' + kk);
      seen.add(kk);
    }
    // ④ 회계 항등 — 총 셀 = 오버헤드 + 데이터.
    const ob = overheadBreakdownOMarker(k);
    const total = 3 * k * k + 3 * k + 1;
    const scan = dataCellsInScanOrderOMarker(k).length;
    if (total !== ob.total + scan) {
      throw new Error('markerO k=' + k + ': 회계 불일치 total=' + total + ' overhead=' + ob.total + ' data=' + scan);
    }
  }
}
