/**
 * markerK.js — Type K(육각별) 코너 **자리 예약** (K-CM) 레이아웃.
 *
 * 계약 정본: `.agent/_contracts/type-k.md` K-2(앵커)·K-5(H2CO3 마커)·K-8.1(fixed 회계).
 * 운영자 확정 2026-08-24 — **(다)안 «앵커 위 마커»**.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 1. 발자국은 정본 H2CO3, 톤은 digit 알파벳 안에서 재배정 (markerA 전례)
 * ─────────────────────────────────────────────────────────────────────────
 * 정본 후보 H2CO3(`finder-oak-candidates.json`, K·k=4·30셀)는 **H2O(A 계열 링 마커
 * 3개) + 반전 계열 꼭짓점 삼각 3개**다 (계약 K-5 실측 분해). 이 모듈은 그 30셀을
 * 손 좌표가 아니라 **규칙**으로 유도한다:
 *
 *   A 계열 21셀 = `markerA.markerCellsA(k)` 그대로 (링 중심 3 + 반경-1 링 18)
 *   반전 계열 9셀 = ({V} ∪ (neighbors(V) ∩ 영역K)) × ρ-궤도 3벌
 *                   V = `placementK.invertedVertexAnchors(k)` 의 별 꼭짓점
 *
 * `test/markerK-measure.mjs` 가 이 유도의 k=4 산출이 정본 H2CO3 `userNonData`
 * 30셀과 **집합 동일**(누락 0·초과 0)임을 잰다. 아래 로드 자기검증도 같은 대조를 한다.
 *
 * ⭐ **정본 톤 채택 (2026-08-25 — 계약 K-8.2 해소)**
 *
 * 구 서술은 「정본 톤은 안 쓴다 — 비-순열이라 표현이 안 된다」였다. 그 문장은 **digit
 * 알파벳 층에서만 참**이고, 렌더러 계약은 2026-08-20 에 이미 열려 있었다 (`scene.js` 는
 * `entry.tones` 가 있으면 면별 절대 톤을 파인더 축으로 그린다). encodeA 는 그때부터
 * H2O 정본 톤을 실어 왔다 (`markerCellsA(k, h2oTonesByKeyA(k))`). 운영자 지적으로 드러난
 * 사실: **K 만 그 배선이 없었다** — 못 넣은 게 아니라 K-8.2 를 레인 범위 밖으로 미뤄 둔 것.
 *
 * 실측이 세 가지를 확인했다 (`.agent/_remote/probes/h2co3.mjs`, k=4 정본 대조):
 *   ① 유도 30셀 ≡ 정본 `userNonData` (누락 0 · 초과 0)
 *   ② **A 계열 21셀의 정본 톤이 H2O 표와 21/21 같다** — 「H2CO3 = H2O + 반전삼각」
 *      분해가 발자국만이 아니라 **톤 축에서도** 성립한다는 독립 교차검증이다.
 *      그래서 이 모듈은 A 계열 톤을 새로 적지 않고 `h2oTonesByKeyA` 를 재사용한다.
 *   ③ 비-순열 18/30 (계약 K-5 서술과 일치)
 *
 * ⚠ **양보한 것: 방향 margin.** 정본 톤은 ρ-공변이다(코너 4·5 가 코너 3 의 면 순환).
 *   그래서 «칠한 층» 의 방향 margin 은 1.0000 → **0.4667** 이 된다. 이것은 K 만의
 *   문제가 아니다 — **A-CM 도 이미 0.6667 이다**(같은 자로 실측한 대조군). 즉 정본 톤
 *   채택이 margin 을 양보하는 것은 이 프로젝트가 A 에서 이미 받아들인 거래이고,
 *   `orientationMarginAMarker`/`orientationMarginKMarker` 가 **digit 층**을 보고하는
 *   관습도 둘이 같다. 게이트 0.035 대비로는 두 값 모두 한참 위다.
 *   두 층의 값은 `test/markerK.test.js` 가 **둘 다** 잠근다 — 조용히 갈리지 않게.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2. (다)안 «앵커 위 마커» — 왜 성립하는가 (실측이 답했다)
 * ─────────────────────────────────────────────────────────────────────────
 * 반전 계열 삼각은 **별 꼭짓점 앵커를 포함한다** (A 계열 링 마커는 꼭짓점에 안
 * 닿는다 — markerA §2). 그래서 그 3셀은 «앵커 digit» 과 «마커 톤» 을 동시에
 * 만족해야 한다. 운영자 확정 (다)안이 그 요구다.
 *
 * 해가 있다: 꼭짓점 셀의 마커 digit 을 `placementK.ANCHOR_INVERTED_DIGIT`(1) 로
 * 두면 두 요구가 **같은 값**이 된다. 그리고 1 은 이미 markerA 어휘
 * (`MARKER_LOCAL_DIGITS_A.ringOdd`) 안의 값이라 새 digit 어휘가 0개다.
 *
 * 실측 (`test/markerK-measure.mjs`, 2026-08-24 — 구현 전 게이트):
 *   ① 방향 margin **1.0000** (게이트 0.035). 반전 삼각 digit 36조합 전부 동률이다 —
 *      ρ 는 삼각을 «다른» 삼각으로 보내고 σ(면 순환)는 고정점 없는 3-순환이라
 *      (markerO 로드 자기검증) 어떤 digit 을 박아도 세 면이 전부 어긋난다.
 *      → 꼭짓점에 앵커 digit 을 고정하는 제약이 판별력을 **한 슬롯도** 안 깎는다.
 *   ② 60° 오가설: 별 꼭짓점 앵커 6셀만으로 0.3889 로 죽는다. (다)안은 앵커 digit 을
 *      건드리지 않으므로(앵커∩마커 3셀 digit 충돌 0) 계약 K-2 의 근거가 그대로 선다.
 *   ③ 마커 유/무: 평 K 프레임 70건에 K-CM 기대를 대면 최고 agreement 0.4667 로
 *      수용 하한 0.78(corner-marker-detect) 아래다. 유/무가 갈린다.
 *
 * 반전 삼각의 나머지 두 셀 digit 은 ①이 동률이라 **다른 축이 골랐다**: 오가설 최고
 * agreement 와 평 K 최고 agreement 두 축 동시 최소가 (ringOdd, center) = (1, 2) 다.
 *
 * ⚠ 부수 실측 — 별 꼭짓점 앵커 6셀은 **거울 사상에 불변**이다 (mirror/면항등
 * agreement 1.0000): 거울 (q,r)→(−q−r,r) 이 꼭짓점 둘을 고정하고 나머지 둘씩을
 * 맞바꾸는데 그 짝의 digit 이 같다(0↔0·1↔1). 계약 K-2 는 «60° 가 죽는다» 고 적었고
 * 그건 맞지만 «앵커가 6회 대칭을 깬다» 로 넓혀 읽으면 틀린다. **거울은 마커가
 * 죽인다** — 마커 30셀 포함 시 1.0000 → 0.4000. 이것이 K-CM 이 평 K 에 더하는 값이다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 3. K-8.1 fixed 회계 해소 — 한 줄
 * ─────────────────────────────────────────────────────────────────────────
 *   마커 셀 30 · 그 중 3 = 반전 꼭짓점 앵커(이미 fixed) → **오버헤드 가산 27** (전 k 공통)
 *   overhead(K*CM) = overhead(K*) + 27
 *
 * 계약 K-6 은 «(a) 꼭짓점을 앵커로 센다 / (b) 마커에 포함시킨다 / (c) A 계열만 앵커»
 * 셋 중 하나라 적고 «3셀이 안 맞는다 — 미해소» 로 멈췄다. (다)안은 (a)+(b) 를 **동시에**
 * 취한다: 회계로는 앵커로 **한 번** 세고, 기하로는 마커 발자국에 **들어 있다**. 두
 * 주장이 안 싸우는 이유가 §2 다 — 그 셀의 기대값이 두 역할에서 같은 값(digit 1)이다.
 * 이중 계상이 없으니 3셀 불일치도 없다. 그래서 이 모듈의 역할 판정은 **앵커가 이긴다**
 * (`roleOfKMarker`) — 평 K 의 앵커 회계가 바이트 동일로 유지되는 것이 위 한 줄의 근거다.
 *
 * ⚠ 정본 H2CO3 JSON 의 `counts`(fixed 41 · detector 30 · data 50)는 **k=4 편집기
 * export 회계**이고 k=4 는 `VERSIONS_K` 에 없다 (생산 버전 k=6/8/10). 패치 레퍼런스와
 * 별 꼭짓점을 안 센 편집기 층 수치라 생산 회계와 다투지 않는다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 4. 충돌 — 패치 레퍼런스만 (markerA §4 의 K 판)
 * ─────────────────────────────────────────────────────────────────────────
 * 실측(자기검증이 매 로드 확인): 마커가 먹는 비-데이터 셀은 **패치 레퍼런스**와
 * **반전 꼭짓점 앵커 3셀**뿐이다. 불스아이·포맷·육각 레퍼런스·육각 코너 앵커·A 계열
 * 꼭짓점 앵커는 한 셀도 안 건드린다. 그래서 `autoplaceHex` 급 전면 재배치가 필요
 * 없고, 규칙 R′ 의 «arc 중앙» 을 markerA 와 **같은 문법**으로 «중앙에서 가장 가까운
 * 빈 칸, 없으면 링을 안쪽으로» 로 넓힌다 (결정적 · 자리가 없으면 AutoplaceError).
 *
 * 런타임 의존성 0 · 순수 ESM.
 */

import { neighbors, hexDistance } from './hexgrid.js';
import { rotate120, rotate240, ringWalk, REFERENCE_DIGIT } from './placement.js';
import { isTopPatch, patchReferenceRings } from './placementA.js';
import {
  ANCHOR_INVERTED_DIGIT,
  invertedVertexAnchors,
  vertexAnchorPositionSetK,
  isInRegionK,
  patchOfK,
  buildRoleSetsK,
  regionCellsK,
} from './placementK.js';
import { dataCellsInScanOrderK } from './layoutK.js';
import {
  markerCellsA, h2oTonesByKeyA, MARKER_LOCAL_DIGITS_A, MARKER_CELL_COUNT_A,
} from './markerA.js';
import { AutoplaceError } from './autoplaceY.js';
import { digitToRanks } from './lehmer.js';
import { maxBytesForSymbols } from './capacity.js';
import { symbolCountForByteLength } from './base211.js';
import { errorCapacity } from './rs211.js';
import { HEADER_BYTES, maxPayloadFor } from './header.js';
import { VERSIONS_K } from './capacityK.js';
import { kMarkerFormatSpec } from './formatK.js';
import {
  hexLayoutFrom,
  hexRotationHypotheses,
  scoreLayoutOrientation,
} from './decoder/orientation-scorer.js';

export const AUTOPLACE_STAR_PATCH_REF = 'AUTOPLACE_STAR_PATCH_REF';

function key(q, r) {
  return `${q},${r}`;
}

function assertK(k) {
  if (!Number.isInteger(k) || k < 4) {
    throw new RangeError('k 는 4 이상의 정수여야 한다: ' + k);
  }
  return k;
}

// ─────────────────────────────────────────────────────────────────────────
// 기하 — 반전 계열 꼭짓점 삼각 3개 (계약 K-5 «꼭짓점 삼각 3셀»)
// ─────────────────────────────────────────────────────────────────────────

/** 계약 K-4 의 패치 순서 중 반전 계열 부분 — 삼각 나열 순서의 정본. */
const INVERTED_PATCH_ORDER = Object.freeze(['TL', 'bottom', 'TR']);

/** 반전 삼각의 로컬 라벨 — 꼭짓점 W, 안쪽 이웃 둘 N0·N1 (`neighbors` 순서). */
export const MARKER_INVERTED_LABELS_K = Object.freeze(['W', 'N0', 'N1']);

/**
 * 반전 삼각 로컬 digit.
 *   W  = `ANCHOR_INVERTED_DIGIT` — (다)안의 전부다. 앵커 기대값과 **같은 값**이라
 *        한 셀이 두 역할을 동시에 만족한다.
 *   N0 = markerA 의 `ringOdd` · N1 = markerA 의 `center`
 *        — 값은 실측이 골랐고(§2), 셋 다 기존 어휘 안이라 새 digit 어휘가 0개다.
 * 하드코딩이 아니라 **두 정본 어휘의 조합**이다 (사본이 아니라 유도).
 */
export const MARKER_INVERTED_DIGITS_K = Object.freeze({
  W: ANCHOR_INVERTED_DIGIT,
  N0: MARKER_LOCAL_DIGITS_A.ringOdd,
  N1: MARKER_LOCAL_DIGITS_A.center,
});

/**
 * 반전 꼭짓점 하나의 삼각 3셀 — {V} ∪ (neighbors(V) ∩ 영역 K).
 * 꼭짓점은 별의 끝점(d=2k)이라 영역 안 이웃이 정확히 2개다 (자기검증이 강제).
 */
function triangleAt(anchor, k) {
  const inward = neighbors(anchor.q, anchor.r).filter((c) => isInRegionK(c.q, c.r, k));
  if (inward.length !== 2) {
    throw new Error('markerK: 반전 꼭짓점 ' + key(anchor.q, anchor.r)
      + ' 의 영역 안 이웃이 2 가 아니다: ' + inward.length);
  }
  return [
    { q: anchor.q, r: anchor.r, label: 'W' },
    { q: inward[0].q, r: inward[0].r, label: 'N0' },
    { q: inward[1].q, r: inward[1].r, label: 'N1' },
  ];
}

/**
 * 반전 계열 삼각 3벌 — 기준 삼각 하나 + ρ120/ρ240 상(라벨 보존). 꼭짓점마다 따로
 * 유도하지 않는 이유는 **라벨 정합**이다: `neighbors` 인덱스는 ρ 로 i→i+2 이동하므로
 * 꼭짓점별 독립 유도는 라벨이 어긋날 수 있다. 하나만 유도하고 사상한다
 * (`placementK.patchOrbitsK`·`markerA.markerCellsTurnA` 와 같은 문법).
 * 나열 순서는 계약 K-4 의 반전 패치 순서 [TL → bottom → TR] 다.
 */
export function invertedTrianglesK(k) {
  assertK(k);
  const base = triangleAt(invertedVertexAnchors(k)[0], k);
  const orbit = [
    base,
    base.map((c) => ({ ...rotate120(c.q, c.r), label: c.label })),
    base.map((c) => ({ ...rotate240(c.q, c.r), label: c.label })),
  ];
  return INVERTED_PATCH_ORDER.map((patch) => {
    const found = orbit.find((cells) => patchOfK(cells[0].q, cells[0].r, k) === patch);
    if (!found) throw new Error('markerK: 반전 삼각 궤도에 패치 ' + patch + ' 가 없다');
    return found;
  });
}

/**
 * 반전 삼각의 정본 H2CO3 톤 — 코너 3(기준) 하나만 적고 나머지는 ρ 면 순환으로
 * **유도**한다. 손 표를 세 벌 적으면 회전 대칭이 깨져도 아무도 모른다.
 *
 * 실측 (`.agent/_remote/probes/h2co3.mjs`, k=4 정본 대조):
 *   코너 3: W (0,0,0) · N0 (2,2,0) · N1 (2,2,0)
 *   코너 4: W (0,0,0) · N0 (0,2,2) · N1 (0,2,2)   ← 코너 3 의 면 1-순환
 *   코너 5: W (0,0,0) · N0 (2,0,2) · N1 (2,0,2)   ← 면 2-순환
 * 세 코너의 W 가 전부 (0,0,0) 이고 N0·N1 이 코너 안에서 같다 — 그래서 기준 한 벌이면 된다.
 */
const INVERTED_LOCAL_TONES_K = Object.freeze({
  W: Object.freeze({ T: 0, L: 0, R: 0 }),
  N0: Object.freeze({ T: 2, L: 2, R: 0 }),
  N1: Object.freeze({ T: 2, L: 2, R: 0 }),
});

/** 면 (T,L,R) 을 shift 칸 순환. ρ(120°)가 면에 하는 일과 같은 사상이다. */
function cycleFaces(tones, shift) {
  const order = ['T', 'L', 'R'];
  const out = {};
  for (let i = 0; i < order.length; i += 1) {
    out[order[(i + shift) % order.length]] = tones[order[i]];
  }
  return Object.freeze(out);
}

/**
 * 별 꼭짓점 W 의 정본 톤은 `(0,0,0)` — **전면 동톤**이다. 그 셀은 동시에 별 꼭짓점
 * 앵커(계약 K-2)라 예전에는 순위를 지키려고 톤 표에서 뺐다. 운영자 작화는 3면 다
 * dark 가 정본이고, 디코더는 그 자리의 기대값을 동률로 뒤집는다 (`flatDark`).
 * 빼는 쪽이 구현이 작화를 덮은 것이었으므로 기본은 싣는다.
 * `includeVertex: false` 는 칠하지 않은 대조군용이다.
 */
export const H2CO3_VERTEX_KEEPS_DIGIT = false;

/**
 * 정본 H2CO3 톤을 k 의 마커 좌표로 전개한 표 ("q,r" → {T,L,R}).
 *
 * A 계열 21셀은 **H2O 표를 그대로 재사용**한다 — 실측으로 21/21 같았다
 * (H2CO3 = H2O + 반전삼각 분해가 발자국만이 아니라 톤 축에서도 성립한다는
 * 독립 교차검증이다). 사본을 새로 적지 않는 이유가 그것이다.
 *
 * @param {number} k
 * @param {{includeVertex?: boolean}} [options] 기본은 꼭짓점 W 포함.
 *   `includeVertex: false` 는 칠하지 않은 대조군.
 */
export function h2co3TonesByKeyK(k, options = {}) {
  assertK(k);
  const includeVertex = options.includeVertex !== false;
  const map = h2oTonesByKeyA(k);
  invertedTrianglesK(k).forEach((cells, corner) => {
    for (const c of cells) {
      if (c.label === 'W' && !includeVertex) continue;
      map.set(key(c.q, c.r), cycleFaces(INVERTED_LOCAL_TONES_K[c.label], corner));
    }
  });
  return map;
}

/**
 * K-CM 마커 30셀 — A 계열 21(코너 0..2, markerA 정본) + 반전 삼각 9(코너 3..5).
 * digit 은 전부 순열 알파벳 안이다.
 *
 * `tonesByKey` 를 주면 그 표에 **있는 셀에만** 절대 톤 `tones: {T,L,R}` 가 실린다.
 * 정본은 꼭짓점 W 포함 30셀 전부다. `includeVertex: false` 대조군만 꼭짓점 3셀을 뺀다.
 * digit 은 그대로 남는다 — digit 은 렌더 알파벳 계약이고 tones 는 그 위에 얹는 층이다.
 *
 * @param {number} k
 * @param {Map<string,{T:number,L:number,R:number}>} [tonesByKey]
 * @returns {{q:number,r:number,digit:number,label:string,corner:number,
 *            series:'A'|'inverted',role:'marker',tones?:{T:number,L:number,R:number}}[]}
 */
export function markerCellsK(k, tonesByKey) {
  assertK(k);
  const out = markerCellsA(k).map((c) => ({ ...c, series: 'A' }));
  // 반전 코너 번호는 A 계열 코너 수 뒤에서 이어진다 (상수 3 을 손으로 적지 않는다).
  const aCorners = new Set(out.map((c) => c.corner)).size;
  invertedTrianglesK(k).forEach((cells, i) => {
    for (const c of cells) {
      out.push({
        q: c.q,
        r: c.r,
        digit: MARKER_INVERTED_DIGITS_K[c.label],
        label: c.label,
        corner: aCorners + i,
        series: 'inverted',
        role: 'marker',
      });
    }
  });
  if (tonesByKey === undefined) return out;
  return out.map((cell) => {
    const tones = tonesByKey instanceof Map
      ? tonesByKey.get(key(cell.q, cell.r))
      : tonesByKey[key(cell.q, cell.r)];
    if (!tones) return cell; // includeVertex:false 대조군만 여기로 온다
    for (const face of ['T', 'L', 'R']) {
      const tone = tones[face];
      if (tone !== 0 && tone !== 1 && tone !== 2) {
        throw new RangeError('markerK: ' + key(cell.q, cell.r) + '.' + face + ' 톤이 0/1/2 가 아니다: ' + tone);
      }
    }
    return { ...cell, tones: { T: tones.T, L: tones.L, R: tones.R } };
  });
}

export function markerPositionSetK(k) {
  return new Set(markerCellsK(k).map((c) => key(c.q, c.r)));
}

/** 코너별 묶음 6개 — 검출기가 «코너 단위» 로 다룬다 (`corner-marker-detect` 의
 *  groupsFor 공급자 규약). 기준점은 A 계열이 링 중심 Z, 반전 계열이 꼭짓점 W 다. */
export function markerGroupsK(k) {
  const groups = [];
  for (const cell of markerCellsK(k)) {
    if (!groups[cell.corner]) {
      groups[cell.corner] = {
        corner: cell.corner,
        cells: [],
        anchorLabel: cell.series === 'A' ? 'Z' : 'W',
        series: cell.series,
      };
    }
    groups[cell.corner].cells.push(cell);
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────
// 패치 레퍼런스 재배치 — 규칙 R′ 의 «arc 중앙» 을 «중앙에서 가장 가까운 빈 칸» 으로
// ─────────────────────────────────────────────────────────────────────────

const ARC_FILTERS = Object.freeze([
  (c, k) => isTopPatch(c.q, c.r, k), // A 계열 arc (규칙 R 그대로)
  (c, k) => patchOfK(c.q, c.r, k) === 'TL', // 반전 계열 arc (규칙 R′)
]);

/**
 * 마커를 피한 패치 레퍼런스 (규칙 R′ + markerA §4 의 escalate 문법).
 * 링마다 두 arc(top·TL) 각각에서 중앙 → |오프셋| 오름차순으로 첫 빈 칸을 잡고
 * rotate120/240 으로 3복제한다. 마커가 없으면 `placementK.patchReferenceCellsK`
 * 와 좌표까지 같다 (자기검증이 강제).
 * @param {number} k
 * @returns {{q:number,r:number,digit:number}[]} 링당 6셀
 */
export function patchReferenceCellsKMarker(k) {
  assertK(k);
  const blocked = markerPositionSetK(k);
  for (const kk of vertexAnchorPositionSetK(k)) blocked.add(kk); // 별 꼭짓점은 앵커다
  const out = [];
  for (const rho of patchReferenceRings(k)) {
    for (const filter of ARC_FILTERS) {
      let picked = null;
      for (let probe = rho; probe > k && picked === null; probe -= 1) {
        const arc = ringWalk(probe).filter((c) => filter(c, k));
        if (arc.length === 0) continue;
        const centre = Math.floor((arc.length - 1) / 2);
        for (let step = 0; step < arc.length && picked === null; step += 1) {
          for (const index of step === 0 ? [centre] : [centre - step, centre + step]) {
            if (index < 0 || index >= arc.length) continue;
            const cell = arc[index];
            if (blocked.has(key(cell.q, cell.r))) continue;
            picked = cell;
            break;
          }
        }
      }
      if (picked === null) {
        throw new AutoplaceError(
          AUTOPLACE_STAR_PATCH_REF,
          'k=' + k + ' rho=' + rho + ': 마커를 피한 패치 레퍼런스 자리가 링 '
          + (k + 1) + '..' + rho + ' 어디에도 없다',
          { k, rho },
        );
      }
      for (const c of [picked, rotate120(picked.q, picked.r), rotate240(picked.q, picked.r)]) {
        blocked.add(key(c.q, c.r));
        out.push({ q: c.q, r: c.r, digit: REFERENCE_DIGIT });
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// 역할 · scan order · 회계
// ─────────────────────────────────────────────────────────────────────────

/**
 * K-CM 역할 지도. 평 K(`buildRoleSetsK`) 위에 마커를 얹고 패치 레퍼런스를
 * 재배치본으로 갈아 끼운다. **앵커 집합은 평 K 와 바이트 동일**이다 — 마커가
 * 덮은 반전 꼭짓점 3셀은 여전히 앵커로 «한 번» 센다 (모듈 헤더 §3).
 */
export function buildRoleSetsKMarker(k) {
  assertK(k);
  const base = buildRoleSetsK(k);
  const marker = markerPositionSetK(k);
  const reference = new Set();
  for (const kk of base.reference) {
    if (!marker.has(kk)) reference.add(kk);
  }
  for (const c of patchReferenceCellsKMarker(k)) reference.add(key(c.q, c.r));
  return {
    anchor: base.anchor, marker, format: base.format, reference, finder: base.finder,
  };
}

/**
 * 셀 (q,r) 의 역할. **앵커가 마커를 이긴다** — 반전 꼭짓점 3셀은 앵커로 세는 것이
 * (다)안 회계의 전부이기 때문이다 (모듈 헤더 §3). 마커 소속 여부는 별도로
 * `markerPositionSetK` 가 답한다 (검출기는 그쪽을 본다).
 * @returns {'bullseye'|'finder'|'anchor'|'marker'|'format'|'reference'|'data'}
 *   ('finder' 는 육각부 roleSets 승계분이다 — placementK.roleOfK 와 같은 분기.)
 */
export function roleOfKMarker(q, r, k, roleSets) {
  if (hexDistance(q, r) <= 2) return 'bullseye';
  const sets = roleSets || buildRoleSetsKMarker(k);
  const kk = key(q, r);
  if (sets.finder && sets.finder.has(kk)) return 'finder';
  if (sets.anchor.has(kk)) return 'anchor';
  if (sets.marker.has(kk)) return 'marker';
  if (sets.format.has(kk)) return 'format';
  if (sets.reference.has(kk)) return 'reference';
  return 'data';
}

/**
 * 데이터 scan order — `layoutK.dataCellsInScanOrderK` 의 **순회를 그대로 쓰고**
 * 마커·재배치 레퍼런스를 뺀 뒤 «마커가 먹어서 레퍼런스에서 풀려난 셀» 을 뒤에 붙인다.
 * 순회 규칙(육각 접두 + 6패치 T3 boustrophedon)을 복제하지 않는 것이 요점이다 —
 * 규칙이 두 곳에 있으면 하나가 조용히 낡는다 (markerA 와 같은 문법).
 * @param {number} k
 */
export function dataCellsInScanOrderKMarker(k) {
  assertK(k);
  const sets = buildRoleSetsKMarker(k);
  const keep = new Set();
  for (const cell of regionCellsK(k)) {
    if (roleOfKMarker(cell.q, cell.r, k, sets) === 'data') keep.add(key(cell.q, cell.r));
  }
  const legacyOrder = dataCellsInScanOrderK(k);
  const ordered = legacyOrder.filter((c) => keep.has(key(c.q, c.r)));
  const seen = new Set(ordered.map((c) => key(c.q, c.r)));
  const freed = [...keep].filter((kk) => !seen.has(kk))
    .map((kk) => {
      const [q, r] = kk.split(',').map(Number);
      return { q, r };
    })
    .sort((a, b) => a.q - b.q || a.r - b.r);
  return [...ordered, ...freed];
}

/** 필러 셀 — scan order 꼬리 (C mod 3). */
export function fillerCellsKMarker(k) {
  const scan = dataCellsInScanOrderKMarker(k);
  const residual = scan.length % 3;
  return residual === 0 ? [] : scan.slice(scan.length - residual);
}

// ─────────────────────────────────────────────────────────────────────────
// 방향 margin — orientation-scorer 정본 (손 계산 금지)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 마커 30셀 × 3면 = 90 슬롯의 방향 margin. 사상은 «좌표 회전 ∘ 면 순환» 합성이고
 * 채점은 `decoder/orientation-scorer.js` 정본이다 — markerO/markerA 의 margin 규약과
 * 같은 자다 (이 모듈은 자를 새로 만들지 않는다).
 *
 * ⚠ **이 함수가 재는 것은 «digit 층» 이다** — 렌더는 정본 톤 30셀(꼭짓점 W 포함)을
 *   칠하므로 화면의 무늬는 이것과 다르다 (헤더 §1 ⚠). 층을 바꾸지 않는 이유는
 *   `orientationMarginAMarker` 가 A 에서 **정확히 같은 관습**이기 때문이다 — 한쪽만
 *   바꾸면 두 자가 갈려서 A·K 비교가 불가능해진다. 칠한 층의 값은 테스트가 따로 잠근다.
 */
export function orientationMarginKMarker(k) {
  const layout = hexLayoutFrom(
    markerCellsK(k).map((c) => ({ q: c.q, r: c.r, tones: digitToRanks(c.digit) })),
  );
  const scored = scoreLayoutOrientation(layout, hexRotationHypotheses());
  return {
    margin: scored.orientationMargin,
    slots: scored.claimed.total,
    phases: scored.phases,
    rival: scored.rival,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 용량 — capacityK 회계 승계, 마커가 데이터에서 27셀을 뺏는다
// ─────────────────────────────────────────────────────────────────────────

/** 마커 셀 수 (전 k 공통 30 — H2CO3 발자국). */
export const MARKER_CELL_COUNT_K = 30;
/** 오버헤드 가산 = 마커 30 − 이미 앵커인 반전 꼭짓점 3 (모듈 헤더 §3). */
export const MARKER_OVERHEAD_ADDED_K = 27;

/**
 * NSYM 표 — 산출 절차는 capacityK.js NSYM_TABLE_K 헤더와 같다
 * (M = round(0.25·S), 짝수면 +1 홀수화 · L = round(0.12·S) · H = round(0.40·S)):
 *   K0CM S=54  → L round(6.48)=6   · M round(13.5)=14(짝)→15 · H round(21.6)=22
 *   K1CM S=113 → L round(13.56)=14 · M round(28.25)=28(짝)→29 · H round(45.2)=45
 *   K2CM S=185 → L round(22.2)=22  · M round(46.25)=46(짝)→47 · H round(74)=74
 * 9조합 **전부 base-211 청크 정렬**이다 (K2/L 처럼 대체가 필요한 칸이 없다) —
 * 아래 자기검증이 매 로드 확인한다. ⚠ 제안이다 — 비준은 운영자.
 */
export const NSYM_TABLE_KCM = Object.freeze({
  K0CM: Object.freeze({ symbols: 54, L: 6, M: 15, H: 22 }),
  K1CM: Object.freeze({ symbols: 113, L: 14, M: 29, H: 45 }),
  K2CM: Object.freeze({ symbols: 185, L: 22, M: 47, H: 74 }),
});

/**
 * K-CM 버전 정의 — 평 K 표에서 유도한다 (하드코딩 0). formatIndex 는 star 축
 * K-CM 행(`formatK.kMarkerFormatSpec`)에서 읽는다: 평 K 와 **다른 값**이어야
 * 디코더가 마커 회계(27셀)를 와이어에서 구분한다 (markerA/markerG 가 실기
 * 「코너 마커 코드 스캔 불가」에서 배운 것).
 */
export const VERSIONS_KCM = Object.freeze(VERSIONS_K.map((spec) => Object.freeze({
  name: spec.name + 'CM',
  version: spec.version,
  k: spec.k,
  formatIndex: kMarkerFormatSpec(spec.version).formatIndex,
  overhead: spec.overhead + MARKER_OVERHEAD_ADDED_K,
  symbolKey: spec.name + 'CM',
})));

export function versionSpecKMarker(version) {
  const spec = VERSIONS_KCM.find((entry) => entry.version === version);
  if (!spec) {
    throw new RangeError('알 수 없는 K-CM 버전: ' + version
      + ' (허용 ' + VERSIONS_KCM.map((v) => `${v.name}(v${v.version})`).join(', ') + ')');
  }
  return spec;
}

/** 한 버전의 용량 전체 — `capacityK.capacityForK` 회계 승계. */
export function capacityForKMarker(spec, level = 'M') {
  const label = spec.name || `K${spec.version}CM`;
  const totalCells = 6 * spec.k * spec.k + 6 * spec.k + 1;
  const dataCells = totalCells - spec.overhead;
  if (dataCells <= 0) {
    throw new RangeError(`${label}: 오버헤드 ${spec.overhead} 가 총 셀 ${totalCells} 이상이다`);
  }
  const usedSymbols = Math.floor(dataCells / 3);
  const residualCells = dataCells - usedSymbols * 3;
  const table = NSYM_TABLE_KCM[spec.symbolKey];
  if (!table) throw new RangeError(`${label}: NSYM_TABLE_KCM 에 키 ${spec.symbolKey} 가 없다`);
  if (table.symbols !== usedSymbols) {
    throw new RangeError(
      `${label}: 실계산 사용 심볼 ${usedSymbols} 이 NSYM_TABLE_KCM.${spec.symbolKey}.symbols `
      + `(${table.symbols}) 과 어긋난다 — overhead(${spec.overhead})/k(${spec.k}) 와 표가 불일치한다`,
    );
  }
  const nsym = table[level];
  if (!Number.isInteger(nsym)) throw new RangeError(`${label}: 레벨 ${level} 이 없다`);
  const dataSymbols = usedSymbols - nsym;
  if (dataSymbols <= 0) throw new RangeError(`${label}/${level}: nsym ${nsym} 이 너무 크다`);
  const dataBytes = maxBytesForSymbols(dataSymbols);
  const chunkAligned = symbolCountForByteLength(dataBytes) === dataSymbols;
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
    chunkAligned,
    maxPayloadBytes: maxPayloadFor(dataBytes),
    headerBytes: HEADER_BYTES,
  };
}

export function capacityTableKMarker(level = 'M') {
  return VERSIONS_KCM.map((spec) => capacityForKMarker(spec, level));
}

/**
 * SPEC 증보(통합자 몫)용 마크다운 표 — `capacityK.renderMarkdownTableK` 대칭.
 * **이 함수가 표의 소스다. SPEC 에 수기로 옮겨 적고 유지하지 않는다.**
 * 단일 물결표는 쓰지 않는다 (규약 §6.11 — GFM 취소선 트랩).
 * @param {'L'|'M'|'H'} [level]
 */
export function renderMarkdownTableKMarker(level = 'M') {
  const rows = capacityTableKMarker(level);
  const head = '| 버전 | k | formatIndex | 총 셀 | 오버헤드 | 데이터 셀 C | 사용 심볼 S | 잔여 셀 | ECC-'
    + level + ' nsym | t | 데이터 심볼 | K | 순 페이로드 |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => `| ${r.name} | ${r.k} | ${r.formatIndex} | ${r.totalCells} | `
    + `${r.overhead} | ${r.dataCells} | ${r.usedSymbols} | ${r.residualCells} | ${r.nsym} | `
    + `${r.errorCapacity} | ${r.dataSymbols} | ${r.dataBytes} B | **${r.maxPayloadBytes} B**`
    + `${r.chunkAligned ? '' : ' 청킹 비정렬 — 인코딩 불가 (nsym 재조정 필요)'} |`);
  return [head, sep, ...body].join('\n');
}

/** 페이로드가 들어가는 최소 K-CM 버전 (chooseVersionK 대칭). */
export function chooseVersionKMarker(byteLength, eccLevel = 'M') {
  for (const spec of VERSIONS_KCM) {
    if (byteLength <= capacityForKMarker(spec, eccLevel).maxPayloadBytes) return spec;
  }
  const last = VERSIONS_KCM[VERSIONS_KCM.length - 1];
  throw new RangeError(
    `페이로드 ${byteLength} B 는 ${last.name}(ECC-${eccLevel}) 용량을 초과한다`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증 — 헤더의 주장이 실행 시 참인지 즉시 확인한다
// ─────────────────────────────────────────────────────────────────────────
{
  // ⓪ 발자국 유도가 정본 H2CO3(k=4·30셀)와 집합 동일한가. 이 대조가 «규칙이
  //    정본을 재현한다» 는 §1 주장의 전부다 — 깨지면 다른 마커를 그리는 것이다.
  const H2CO3_K4 = [
    '-7,3', '-7,4', '-6,2', '-6,3', '-6,4', '-5,2', '-5,3', '-4,-4', '-4,-3', '-4,7',
    '-4,8', '-3,-4', '-3,7', '2,-6', '2,-5', '2,3', '2,4', '3,-7', '3,-6', '3,-5',
    '3,2', '3,3', '3,4', '4,-7', '4,-6', '4,2', '4,3', '7,-4', '7,-3', '8,-4',
  ];
  const derived4 = markerPositionSetK(4);
  if (derived4.size !== H2CO3_K4.length) {
    throw new Error('markerK: k=4 유도 셀 수 ' + derived4.size + ' !== 정본 H2CO3 ' + H2CO3_K4.length);
  }
  for (const kk of H2CO3_K4) {
    if (!derived4.has(kk)) throw new Error('markerK: 정본 H2CO3 셀 ' + kk + ' 이 유도에 없다');
  }

  for (const spec of VERSIONS_K) {
    const { k } = spec;
    const cells = markerCellsK(k);
    if (cells.length !== MARKER_CELL_COUNT_K) {
      throw new Error('markerK k=' + k + ': 마커 셀 수가 ' + MARKER_CELL_COUNT_K + ' 이 아니다');
    }
    if (cells.filter((c) => c.series === 'A').length !== MARKER_CELL_COUNT_A) {
      throw new Error('markerK k=' + k + ': A 계열 셀 수가 markerA 정본(' + MARKER_CELL_COUNT_A + ')과 다르다');
    }
    if (cells.filter((c) => c.series === 'inverted').length !== 9) {
      throw new Error('markerK k=' + k + ': 반전 계열이 삼각 3×3 = 9 가 아니다');
    }
    // ① 전 셀이 영역 K 안이고 패치 위(코어 밖)에 있다.
    for (const c of cells) {
      if (!isInRegionK(c.q, c.r, k)) {
        throw new Error('markerK k=' + k + ': 마커 셀이 영역 밖 ' + key(c.q, c.r));
      }
      if (patchOfK(c.q, c.r, k) === null) {
        throw new Error('markerK k=' + k + ': 마커 셀 ' + key(c.q, c.r) + ' 이 육각 코어에 있다');
      }
    }
    // ② 마커 집합은 ρ-불변이고 방향 margin 이 1.0 이다 (실측 §2 ①).
    const set = markerPositionSetK(k);
    for (const kk of set) {
      const [q, r] = kk.split(',').map(Number);
      for (const rot of [rotate120, rotate240]) {
        const p = rot(q, r);
        if (!set.has(key(p.q, p.r))) {
          throw new Error('markerK k=' + k + ': 마커 집합이 ρ-불변이 아니다 (' + kk + ')');
        }
      }
    }
    const margin = orientationMarginKMarker(k);
    if (margin.slots !== MARKER_CELL_COUNT_K * 3 || margin.margin !== 1) {
      throw new Error('markerK k=' + k + ': 방향 margin 이 1.0 이 아니다 '
        + JSON.stringify({ margin: margin.margin, slots: margin.slots }));
    }
    // ③ (다)안의 핵심 — 마커가 덮는 앵커는 반전 꼭짓점 3셀뿐이고, 그 셀의 마커
    //    digit 이 앵커 digit 과 **같다**. 이게 깨지면 앵커 판정과 마커 판정이 싸운다.
    const anchorDigit = new Map(invertedVertexAnchors(k).map((c) => [key(c.q, c.r), c.digit]));
    const covered = cells.filter((c) => vertexAnchorPositionSetK(k).has(key(c.q, c.r)));
    if (covered.length !== 3) {
      throw new Error('markerK k=' + k + ': 마커가 덮는 꼭짓점 앵커가 3 이 아니다: ' + covered.length);
    }
    for (const c of covered) {
      const want = anchorDigit.get(key(c.q, c.r));
      if (want === undefined) {
        throw new Error('markerK k=' + k + ': 마커가 **A 계열** 꼭짓점 앵커를 덮었다 ' + key(c.q, c.r));
      }
      if (c.digit !== want) {
        throw new Error('markerK k=' + k + ': (다)안 위반 — 꼭짓점 ' + key(c.q, c.r)
          + ' 의 마커 digit ' + c.digit + ' 이 앵커 digit ' + want + ' 과 다르다');
      }
    }
    // ④ 마커가 불스아이·포맷·육각 레퍼런스·육각 앵커를 안 건드린다 (헤더 §4).
    const base = buildRoleSetsK(k);
    for (const c of cells) {
      const kk = key(c.q, c.r);
      if (hexDistance(c.q, c.r) <= 2) throw new Error('markerK k=' + k + ': 마커가 불스아이를 덮는다');
      if (base.format.has(kk)) throw new Error('markerK k=' + k + ': 마커가 포맷 셀을 덮는다 ' + kk);
      if (base.anchor.has(kk) && !vertexAnchorPositionSetK(k).has(kk)) {
        throw new Error('markerK k=' + k + ': 마커가 육각 코너 앵커를 덮는다 ' + kk);
      }
    }
    // ⑤ 재배치 패치 레퍼런스 — 개수 유지 · 마커/앵커와 무겹침 · 전부 패치 위.
    const refs = patchReferenceCellsKMarker(k);
    if (refs.length !== patchReferenceRings(k).length * 6) {
      throw new Error('markerK k=' + k + ': 패치 레퍼런스 수가 달라졌다 ' + refs.length);
    }
    const refKeys = new Set(refs.map((c) => key(c.q, c.r)));
    if (refKeys.size !== refs.length) {
      throw new Error('markerK k=' + k + ': 패치 레퍼런스에 중복이 있다');
    }
    for (const c of refs) {
      if (set.has(key(c.q, c.r))) throw new Error('markerK k=' + k + ': 패치 레퍼런스가 마커와 겹친다');
      if (vertexAnchorPositionSetK(k).has(key(c.q, c.r))) {
        throw new Error('markerK k=' + k + ': 패치 레퍼런스가 꼭짓점 앵커와 겹친다');
      }
      if (patchOfK(c.q, c.r, k) === null) {
        throw new Error('markerK k=' + k + ': 패치 레퍼런스 ' + key(c.q, c.r) + ' 이 패치 밖이다');
      }
    }
    // ⑥ 회계 — scan order 길이가 «평 K 데이터 − 27» 이고 capacity 표와 맞는다.
    const scan = dataCellsInScanOrderKMarker(k);
    const legacy = dataCellsInScanOrderK(k);
    if (scan.length !== legacy.length - MARKER_OVERHEAD_ADDED_K) {
      throw new Error('markerK k=' + k + ': 데이터 셀이 ' + (legacy.length - scan.length)
        + '개 줄었다 — 기대 ' + MARKER_OVERHEAD_ADDED_K);
    }
    if (new Set(scan.map((c) => key(c.q, c.r))).size !== scan.length) {
      throw new Error('markerK k=' + k + ': scan order 에 중복 셀이 있다');
    }
    for (const c of scan) {
      if (set.has(key(c.q, c.r))) throw new Error('markerK k=' + k + ': scan order 에 마커 셀이 있다');
    }
  }

  // ⑦ 용량표 — 실계산과 표가 맞고 9조합 전부 청크 정렬이다.
  const EXPECT = {
    K0CM: { overhead: 90, dataCells: 163, symbols: 54, residual: 1 },
    K1CM: { overhead: 94, dataCells: 339, symbols: 113, residual: 0 },
    K2CM: { overhead: 104, dataCells: 557, symbols: 185, residual: 2 },
  };
  for (const spec of VERSIONS_KCM) {
    const want = EXPECT[spec.name];
    if (!want) throw new Error('markerK: 기대표에 없는 키 ' + spec.name);
    if (spec.overhead !== want.overhead) {
      throw new Error(spec.name + ': 오버헤드 ' + spec.overhead + ' !== ' + want.overhead);
    }
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForKMarker(spec, level);
      if (cap.dataCells !== want.dataCells || cap.usedSymbols !== want.symbols
        || cap.residualCells !== want.residual) {
        throw new Error(spec.name + '/' + level + ': 데이터 셀·심볼·잔여가 확정값과 다르다');
      }
      if (cap.chunkAligned !== true) {
        throw new Error(spec.name + '/' + level + ': 청크 비정렬 — 생산 불가');
      }
      if (cap.dataCells !== dataCellsInScanOrderKMarker(spec.k).length) {
        throw new Error(spec.name + ': capacity.dataCells 와 scan order 길이가 다르다');
      }
    }
    // 와이어 구분 — K-CM 값은 평 K 값과 달라야 한다 (markerG 가 배운 것).
    const plain = VERSIONS_K.find((v) => v.version === spec.version);
    if (plain.formatIndex === spec.formatIndex) {
      throw new Error(spec.name + ': formatIndex 가 평 K 와 같다 — 디코더가 마커 회계를 못 가른다');
    }
  }
}
