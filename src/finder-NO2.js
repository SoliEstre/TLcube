/**
 * finder-NO2.js — NO2 파인더 (턴A = 내부 타입 V 의 기본 파인더)의 «톤 정본».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 1. 지위 — V-CM 은 «자리 예약», 그 자리의 «심볼» 이 기본 파인더다
 * ─────────────────────────────────────────────────────────────────────────
 * 운영자 결정 (2026-08-21 CM 격하 · 2026-08-24 NO2 편입): CM 계열은 파인더가 아니라
 * 자리 예약이고, 그 자리에 들어가는 심볼이 기본 파인더다 — Type A 자리(A-CM)엔 H2O
 * (`markerA.js` H2O_LOCAL_TONES_A), Type G 자리(O-CM)엔 H (`finder-H.js`), 그리고
 * **턴A 자리(V-CM)엔 NO2** (이 모듈). 배정은 `finder-taxonomy.SEAT_DEFAULT_FINDER`
 * 의 `'v-cm'` 열이 든다.
 *
 * ⚠ **중앙 파인더와 직교** (운영자 확정 2026-08-24 — «중앙 파인더 관련 없음, 모두
 * 사용 가능»). NO2 는 **자리(V-CM) 심볼**이고 중앙 19셀 슬롯 축과 별개다. 그래서
 * 이 모듈은 `finder-patterns.js`·`finder-selection.js` 를 **import 하지 않는다** —
 * 표가 중앙 파인더 선택에 의존할 방법이 구조적으로 없다는 것이 직교성의 증명이고,
 * `test/finder-NO2.test.js` ⑤ 가 그 사실을 값으로 잠근다 (불스아이·큐브 불스아이·
 * 중앙 3톤 큐브·중앙 v0 비컨 전부에서 NO2 면 색이 바이트 동일).
 *
 * 정본 export 의 `finderPattern.cellMasks` 19개는 `cell-editor-core.js`
 * `bullseyeCellMasks()` 산출과 **바이트 동일**이다 (실측) — 즉 중앙 슬롯 표현은
 * 이미 있는 것과 정확히 대응하고, **새 중앙 파인더를 만들지 않는다.** H 정본이
 * 같은 성질을 가졌던 것과 같은 축이다 (`finder-H.js` §1).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2. 정본과 발자국 — 9셀 = 꼭짓점 앵커 3 + «영역 내 이웃» 6, 손 좌표 0
 * ─────────────────────────────────────────────────────────────────────────
 * 정본: 셀 편집기 v2 export (운영자 작화 2026-08-24 **수정본** · type V · k=4 ·
 * starter bullseye). repo 사본: `test/output/lanes/finder-NO2.json` (바이트 동일).
 *
 * 정본이 닿는 9셀을 코드로 되짚었더니 임의 배치가 아니라 **닫힌 규칙**이었다:
 *
 *   NO2 셀 = ⋃ (V 꼭짓점 앵커 a) { a } ∪ { a 의 이웃 중 영역 안인 것 }
 *
 * 그리고 그 «영역 안인 이웃» 은 **전 k 에서 정확히 2개**다 (k=4/6/8/10 실측 —
 * 아래 로드 자기검증 ①이 매 로드마다 다시 잰다). 꼭짓점은 영역의 뾰족한 끝이라
 * 이웃 6 중 4가 영역 밖으로 떨어지기 때문이고, 그래서 이 규칙은 k 무관하게 선다.
 * V 꼭짓점 앵커 자신은 `placementA.vertexAnchors(k)` 의 180° 상이다 (턴A 정의).
 *
 * k=4 정본 대조 (`test/finder-NO2.test.js` ①): 유도한 9셀이 정본
 * `userNonData`(6) ∪ 앵커(3) 와 **전수 일치**하고 톤도 27면 전부 일치한다.
 * 그래서 좌표는 이 모듈에 **하나도 없다** — 아래 표는 코너 × 로컬 라벨(A·N0·N1)
 * 로만 적히고 좌표는 전부 `vertexAnchors` + `neighbors` 에서 유도된다
 * (좌표 손 나열은 이 저장소 최다 결함).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 3. 톤은 120° 궤도가 **아니다** — 그래서 «코너별 로컬 표»다
 * ─────────────────────────────────────────────────────────────────────────
 * 발자국은 ρ-불변(rotate120/240 으로 자기 자신에 사상)인데 **톤은 아니다**: 코너 0
 * 의 앵커는 (T2,L0,R0) 인데 코너 1·2 의 앵커는 (0,0,0) 이다. `placement.rotate120`
 * + 면 순환 T→R→L 로 궤도 전개를 시도하면 27면 중 6면이 어긋난다 (실측).
 * → 궤도 공식이 아니라 **코너별 로컬 표**로 저장한다. `markerA.js` 의
 * `H2O_LOCAL_TONES_A` 와 `finder-H.js` 의 `H_LOCAL_TONES_O` 가 같은 문법이다.
 *
 * 다른 k 는 **같은 (코너, 라벨) 튜플을 그 k 의 자리에 복사**한다 — 로컬 구조가
 * k 무관하게 동형이기 때문이다 (자기검증 ②가 «코너별 이웃 방향 인덱스 쌍» 이
 * 전 k 에서 같음을 재서 그 동형성을 값으로 확인한다: c0={4,5} · c1={2,3} ·
 * c2={0,1}). 정본에 없는 면은 없다 — 27/27 이 명시돼 있어 중간톤 폴백을 안 쓴다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 4. 회계 — V-CM 자리에서 «셀을 새로 먹지 않는다»
 * ─────────────────────────────────────────────────────────────────────────
 * 실측 (전 k): NO2 의 마커 6셀은 **A-CM 마커 21셀의 부분집합**이고 (꼭짓점에서
 * 2칸 안쪽 링의 바깥쪽 두 셀), 앵커 3셀은 이미 `vertexAnchors` 다. 그래서 V-CM
 * (= A-CM 회계의 턴A 사상) 위에 NO2 를 얹으면 **오버헤드·scan order·용량이 전부
 * 불변**이다 — digit 은 그대로 남고 `tones` 오버레이만 붙는다. 자기검증 ③이 잰다.
 *
 * 반대로 **순수 V**(자리 예약 없는 턴A) 레이아웃에서는 그 6셀이 데이터(k=6 은
 * 데이터 4 + 레퍼런스 2)라 정본 편집기가 `counts.detector = 6` 으로 뺀 것이다.
 * 그것이 정본이 «자리 예약 위» 가 아니라 «맨 V 위» 에 그려진 이유다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 5. 렌더 계약 — 팔레트는 palette.levels, 파인더 축 금지
 * ─────────────────────────────────────────────────────────────────────────
 * 셀 entry 에 `tones: {T,L,R}` 를 실으면 `scene.js` faceColor 가 **데이터와 같은
 * `palette.levels`** 로 그린다. 파인더 축(bullseyeLight = 순백)은 금지 — 순백이
 * 안전영역·흰 지면과 구별되지 않아 실루엣에 구멍이 난다 (2026-08-20 실기기 실측,
 * `scene.js` faceColor 헤더). 구별은 색이 아니라 «조합»이다: NO2 9셀은 **전부
 * 비-순열**(전면 동톤 2셀 포함)이라 데이터 셀이 만들 수 없는 무늬다.
 *
 * ⚠ **알려진 공백 (실측 2026-08-24)** — NO2 는 **꼭짓점 앵커 3셀까지 덮는다.**
 * 앵커에 절대 톤을 실은 프레임은 digit 기반 앵커 검출이 못 읽는다 (V0/V1/V2 CM
 * 전부 `no-anchors`, ppu 12·24 양쪽). H 가 tetrad A 를 덮어 같은 공백을 가졌던
 * 것과 **정확히 같은 축**이다 (`finder-H.js` §4). 그래서 앵커 톤 적재는
 * **opt-in**(`encodeA` 의 `no2AnchorTones`)이고 기본은 마커 6셀만 싣는다.
 * 기본값 전환은 검출기 배선(통합자 몫)이 선 다음이다 — 한쪽만 켜면 효과가 음수다.
 * 공백 잠금: `test/finder-NO2.test.js` ⑥.
 *
 * 반면 **마커 6셀 적재는 기본**이고, 그 전환은 V0CM 을 살렸다: A-CM 기본 심볼
 * (H2O) 톤을 V-CM 에 그대로 싣던 종전 경로에서 V0CM(k=6)은 전 해상도 `no-anchors`
 * 였는데, NO2 로 바꾸자 ppu 10\~32 중 8/9 에서 원문까지 돌아온다 (§왕복 실측).
 *
 * 런타임 의존성 0 · 순수 ESM.
 */

import { neighbors, AXIAL_DIRECTIONS } from './hexgrid.js';
import { vertexAnchors, isInRegionA } from './placementA.js';
import { rotate120, rotate240 } from './placement.js';
import { markerCellsA, markerPositionSetA } from './markerA.js';
import { VERSIONS_A } from './capacityA.js';

/** 심볼 이름 — `finder-taxonomy.SEAT_DEFAULT_FINDER['v-cm']` 값과 같은 문자열. */
export const NO2_NAME = 'NO2';

/** 로컬 라벨 — A = 꼭짓점 앵커, N0·N1 = 영역 안 이웃 2 (`neighbors` 순서). */
export const NO2_LABELS = Object.freeze(['A', 'N0', 'N1']);

/** 앵커 라벨 (톤 적재가 opt-in 인 셀) 과 마커 라벨 (기본 적재) 의 분할. */
export const NO2_ANCHOR_LABEL = 'A';
export const NO2_MARKER_LABELS = Object.freeze(['N0', 'N1']);

/** 발자국 개수 — 유도값의 기대치. 자기검증이 매 로드마다 재확인한다. */
export const NO2_ANCHOR_COUNT = 3;
export const NO2_MARKER_COUNT = 6;
export const NO2_CELL_COUNT = NO2_ANCHOR_COUNT + NO2_MARKER_COUNT;

function key(q, r) {
  return q + ',' + r;
}

function assertK(k) {
  if (!Number.isInteger(k) || k < 4) {
    throw new RangeError('k 는 4 이상의 정수여야 한다: ' + k);
  }
  return k;
}

/**
 * 정본 NO2 의 면별 톤 — k=4 편집기 export 를 코너(0·1·2) × 로컬 라벨(A·N0·N1)에
 * 고정. 다른 k 는 같은 로컬 라벨을 그 k 의 꼭짓점 자리에 복사한다 (`no2TonesByKeyA`).
 * 27/27 면이 정본에 명시돼 있다 — 중간톤 폴백을 쓰는 면이 없다.
 * 실측: 9셀 **전부** 비-순열 · 세 코너 튜플이 서로 다르다 (방향 비공변).
 *
 * ⚠ 코너 인덱스는 `placementA.vertexAnchors(k)` 배열 순서다 (0 = A 의 위 꼭짓점 →
 *   V 에서는 아래, 1 = A 의 우하 → V 의 좌상, 2 = A 의 좌하 → V 의 우상).
 */
export const NO2_LOCAL_TONES_V = Object.freeze({
  0: Object.freeze({
    A: Object.freeze({ T: 2, L: 0, R: 0 }),
    N0: Object.freeze({ T: 0, L: 2, R: 0 }),
    N1: Object.freeze({ T: 0, L: 0, R: 2 }),
  }),
  1: Object.freeze({
    A: Object.freeze({ T: 0, L: 0, R: 0 }),
    N0: Object.freeze({ T: 2, L: 2, R: 0 }),
    N1: Object.freeze({ T: 2, L: 2, R: 0 }),
  }),
  2: Object.freeze({
    A: Object.freeze({ T: 0, L: 0, R: 0 }),
    N0: Object.freeze({ T: 2, L: 0, R: 2 }),
    N1: Object.freeze({ T: 2, L: 0, R: 2 }),
  }),
});

/**
 * NO2 발자국 9셀 — **canonical(Type A) 좌표**. 인코더가 쓰는 공간이다
 * (`encodeA` 는 canonical 좌표로 cellDigits 를 채우고 `scene.js` 의 turnA 분기가
 * 그리는 자리만 반전한다 — `markerA.markerCellsTurnA` 헤더와 같은 계약).
 *
 * 순서는 코너(0→1→2) × 라벨(A, N0, N1). 손 좌표 0 — `vertexAnchors` + `neighbors`
 * + `isInRegionA` 유도가 전부다.
 *
 * @param {number} k
 * @returns {{q:number,r:number,corner:number,label:string,role:'anchor'|'marker',
 *            tones:{T:number,L:number,R:number}}[]} 길이 9
 */
export function no2CellsA(k) {
  assertK(k);
  const out = [];
  vertexAnchors(k).forEach((anchor, corner) => {
    const table = NO2_LOCAL_TONES_V[corner];
    if (!table) throw new Error('finder-NO2: 로컬 표에 코너 ' + corner + ' 가 없다');
    out.push({
      q: anchor.q,
      r: anchor.r,
      corner,
      label: NO2_ANCHOR_LABEL,
      role: 'anchor',
      tones: table[NO2_ANCHOR_LABEL],
    });
    const inner = neighbors(anchor.q, anchor.r).filter((c) => isInRegionA(c.q, c.r, k));
    if (inner.length !== NO2_MARKER_LABELS.length) {
      throw new Error(
        'finder-NO2 k=' + k + ': 코너 ' + corner + ' 의 영역 내 이웃이 '
        + inner.length + ' 개다 — 유도 규칙(정확히 2)의 전제 위반',
      );
    }
    inner.forEach((cell, index) => {
      const label = NO2_MARKER_LABELS[index];
      out.push({
        q: cell.q, r: cell.r, corner, label, role: 'marker', tones: table[label],
      });
    });
  });
  return out;
}

/**
 * NO2 발자국 9셀 — **턴A(이미지) 좌표**. 정본 편집기 export 가 쓰는 공간이고
 * (`(q,r) → (−q,−r)`), 검출기·분류 서술·정본 대조가 쓴다. 셀이 정립이라 면별
 * 절대 톤은 사상에서 안 돈다 — `markerCellsTurnA` 와 같은 문법.
 * @param {number} k
 */
export function no2CellsTurnA(k) {
  return no2CellsA(k).map((cell) => ({ ...cell, q: -cell.q, r: -cell.r }));
}

function tonesByKey(cells, labels) {
  const map = new Map();
  for (const cell of cells) {
    if (labels && !labels.includes(cell.label)) continue;
    map.set(key(cell.q, cell.r), cell.tones);
  }
  return map;
}

/** 정본 NO2 톤을 k 의 **canonical** 좌표로 전개한 표 ("q,r" → {T,L,R}) — 9셀. */
export function no2TonesByKeyA(k) {
  return tonesByKey(no2CellsA(k));
}

/** 정본 NO2 톤을 k 의 **턴A(이미지)** 좌표로 전개한 표 — 9셀 (정본 대조용). */
export function no2TonesByKeyTurnA(k) {
  return tonesByKey(no2CellsTurnA(k));
}

/**
 * V-CM 자리(A-CM 21셀 레이아웃)에 NO2 심볼을 얹은 **마커 셀 목록**.
 * 21셀의 digit·역할은 `markerCellsA(k)` 그대로이고 (회계 불변), NO2 가 덮는 6셀만
 * `tones` 를 든다. 나머지 15셀은 digit-only — 정본에 그 자리의 톤이 없기 때문이고,
 * 없는 값을 H2O 에서 빌려 오면 «다른 심볼 두 개가 한 자리에» 가 된다.
 * @param {number} k
 */
export function no2SeatMarkerCellsA(k) {
  const toneMap = tonesByKey(no2CellsA(k), NO2_MARKER_LABELS);
  return markerCellsA(k).map((cell) => {
    const tones = toneMap.get(key(cell.q, cell.r));
    return tones ? { ...cell, tones } : { ...cell };
  });
}

/**
 * V-CM 자리에서 NO2 가 덮는 **꼭짓점 앵커 3셀** (톤 포함, canonical 좌표).
 * digit 은 `vertexAnchors` 그대로다 — 이 목록은 `tones` 오버레이 전용이다.
 *
 * ⚠ 적재는 opt-in 이다 (모듈 헤더 §5 — 앵커 피복은 digit 기반 앵커 검출을 죽인다).
 * @param {number} k
 */
export function no2SeatAnchorCellsA(k) {
  const byKey = new Map(vertexAnchors(k).map((c) => [key(c.q, c.r), c.digit]));
  return no2CellsA(k)
    .filter((cell) => cell.label === NO2_ANCHOR_LABEL)
    .map((cell) => {
      const digit = byKey.get(key(cell.q, cell.r));
      if (digit === undefined) {
        throw new Error('finder-NO2: 앵커 라벨 셀 ' + key(cell.q, cell.r) + ' 이 꼭짓점 앵커가 아니다');
      }
      return { q: cell.q, r: cell.r, digit, corner: cell.corner, tones: cell.tones };
    });
}

// ─────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증 (finder-H·markerA 전례) — 표의 주장들이 거짓이면 즉시 throw
// ─────────────────────────────────────────────────────────────────────────
{
  // ⓪ 표의 모양 — 코너 3 × 라벨 3, 톤은 0/1/2.
  const corners = Object.keys(NO2_LOCAL_TONES_V).map(Number).sort((a, b) => a - b);
  if (corners.join(',') !== '0,1,2') {
    throw new Error('finder-NO2: 표의 코너가 0,1,2 가 아니다: ' + corners);
  }
  for (const corner of corners) {
    const labels = Object.keys(NO2_LOCAL_TONES_V[corner]).sort();
    if (labels.join(',') !== [...NO2_LABELS].sort().join(',')) {
      throw new Error('finder-NO2: 코너 ' + corner + ' 의 라벨이 NO2_LABELS 와 다르다');
    }
    for (const label of labels) {
      for (const face of ['T', 'L', 'R']) {
        const tone = NO2_LOCAL_TONES_V[corner][label][face];
        if (tone !== 0 && tone !== 1 && tone !== 2) {
          throw new Error('finder-NO2: ' + corner + '.' + label + '.' + face + ' 톤이 0/1/2 가 아니다');
        }
      }
    }
  }

  const dirIndexOf = (from, to) => AXIAL_DIRECTIONS.findIndex(
    (d) => d.q === to.q - from.q && d.r === to.r - from.r,
  );
  let dirSignature = null;

  // 전 k («모든 k 대응» — 운영자 지시 2026-08-24). 발행 k 는 VERSIONS_A 표에서
  // 유도하고, 거기에 **정본 작화 k=4** 를 더한다 — k=4 는 발행 버전이 아니지만
  // (VERSIONS_A = 6/8/10) 정본이 그 k 로 그려졌으므로 유도 규칙이 반드시 서야 하는
  // 자리다. `placementA` 의 턴A 자기검증도 같은 이유로 [4,6,8,10] 을 돈다.
  const CANON_K = 4;
  const KS = [CANON_K, ...VERSIONS_A.map((spec) => spec.k)];
  for (const k of KS) {
    const cells = no2CellsA(k);
    // ① 마커 6 · 앵커 3 (유도 규칙의 전제 «영역 내 이웃이 정확히 2» 는
    //    no2CellsA 안에서 이미 던진다 — 여기서는 합계를 다시 센다).
    if (cells.length !== NO2_CELL_COUNT) {
      throw new Error('finder-NO2 k=' + k + ': 셀 수가 ' + NO2_CELL_COUNT + ' 이 아니다: ' + cells.length);
    }
    const anchorCount = cells.filter((c) => c.role === 'anchor').length;
    const markerCount = cells.filter((c) => c.role === 'marker').length;
    if (anchorCount !== NO2_ANCHOR_COUNT || markerCount !== NO2_MARKER_COUNT) {
      throw new Error(
        'finder-NO2 k=' + k + ': 앵커/마커 수가 ' + anchorCount + '/' + markerCount
        + ' 다 — ' + NO2_ANCHOR_COUNT + '/' + NO2_MARKER_COUNT + ' 이어야 한다',
      );
    }
    // 전 셀에 톤이 실린다 (표 누락을 조용한 폴백으로 덮지 않는다).
    for (const c of cells) {
      if (!c.tones) throw new Error('finder-NO2 k=' + k + ': ' + key(c.q, c.r) + ' 에 톤이 없다');
    }

    // ② 로컬 구조 동형 — 코너별 «이웃 방향 인덱스 쌍» 이 전 k 에서 같아야
    //    «같은 (코너,라벨) 튜플 복사» 라는 k 유도 규칙이 성립한다.
    const signature = vertexAnchors(k).map((anchor) => neighbors(anchor.q, anchor.r)
      .filter((c) => isInRegionA(c.q, c.r, k))
      .map((c) => dirIndexOf(anchor, c)).join('')).join('|');
    if (dirSignature === null) dirSignature = signature;
    else if (signature !== dirSignature) {
      throw new Error(
        'finder-NO2 k=' + k + ': 로컬 방향 서명이 다르다 (' + signature + ' vs '
        + dirSignature + ') — 라벨 복사 유도가 k 마다 다른 자리를 가리킨다',
      );
    }

    // ③ 자리 회계 — 마커 6셀은 A-CM 마커 21셀 안, 앵커 3셀은 꼭짓점 앵커.
    //    (이것이 «V-CM 에서 셀을 새로 먹지 않는다» 의 근거다 — 모듈 헤더 §4.)
    const markerSet = markerPositionSetA(k);
    const vertexSet = new Set(vertexAnchors(k).map((c) => key(c.q, c.r)));
    for (const c of cells) {
      const kk = key(c.q, c.r);
      if (c.role === 'marker' && !markerSet.has(kk)) {
        throw new Error('finder-NO2 k=' + k + ': 마커 셀 ' + kk + ' 이 A-CM 마커 21셀 밖이다');
      }
      if (c.role === 'anchor' && !vertexSet.has(kk)) {
        throw new Error('finder-NO2 k=' + k + ': 앵커 셀 ' + kk + ' 이 꼭짓점 앵커가 아니다');
      }
      if (!isInRegionA(c.q, c.r, k)) {
        throw new Error('finder-NO2 k=' + k + ': 셀 ' + kk + ' 이 영역 밖이다');
      }
    }
    // 자리 적재본이 21셀 회계를 그대로 두고 6셀에만 톤을 얹는다.
    const seat = no2SeatMarkerCellsA(k);
    const base = markerCellsA(k);
    if (seat.length !== base.length) {
      throw new Error('finder-NO2 k=' + k + ': 자리 적재본 셀 수가 A-CM 과 다르다');
    }
    let toned = 0;
    for (let i = 0; i < seat.length; i += 1) {
      if (seat[i].q !== base[i].q || seat[i].r !== base[i].r || seat[i].digit !== base[i].digit) {
        throw new Error('finder-NO2 k=' + k + ': 자리 적재본이 A-CM 좌표/digit 을 바꿨다 [' + i + ']');
      }
      if (seat[i].tones) toned += 1;
    }
    if (toned !== NO2_MARKER_COUNT) {
      throw new Error('finder-NO2 k=' + k + ': 자리 적재 톤 셀이 ' + toned + ' 개다 — ' + NO2_MARKER_COUNT + ' 이어야 한다');
    }

    // ④ 발자국 ρ-불변 — 코너 셋이 rotate120/240 궤도로 닫힌다 (방향 판별의 전제).
    const set = new Set(cells.map((c) => key(c.q, c.r)));
    for (const rot of [rotate120, rotate240]) {
      for (const kk of set) {
        const [q, r] = kk.split(',').map(Number);
        const p = rot(q, r);
        if (!set.has(key(p.q, p.r))) {
          throw new Error('finder-NO2 k=' + k + ': 발자국이 ρ-불변이 아니다 (' + kk + ')');
        }
      }
    }

    // ⑤ 턴A 사상 정확성 — (−q,−r) 이고 나머지 필드는 불변 (셀 정립).
    const turned = no2CellsTurnA(k);
    for (let i = 0; i < cells.length; i += 1) {
      if (turned[i].q !== -cells[i].q || turned[i].r !== -cells[i].r) {
        throw new Error('finder-NO2 k=' + k + ': 턴A 사상이 (−q,−r) 이 아니다 [' + i + ']');
      }
      if (turned[i].label !== cells[i].label || turned[i].corner !== cells[i].corner
        || turned[i].tones !== cells[i].tones) {
        throw new Error('finder-NO2 k=' + k + ': 턴A 사상이 라벨/코너/톤을 바꿨다 [' + i + ']');
      }
    }
  }

  // ⑥ 심볼다움 — 비-순열 셀이 실재하고(digit 경로가 못 그리는 이유), 톤이 균일하지
  //    않으며, 세 코너 튜플이 서로 다르다 (코너 구별이 산다). finder-H ③ 전례.
  const tuples = corners.map((corner) => NO2_LABELS
    .map((label) => ['T', 'L', 'R'].map((face) => NO2_LOCAL_TONES_V[corner][label][face]).join(''))
    .join('|'));
  if (new Set(tuples).size !== 3) {
    throw new Error('finder-NO2: 코너 튜플이 서로 같다 — 코너 구별이 죽는다');
  }
  let nonPermutation = 0;
  const seenTones = new Set();
  for (const corner of corners) {
    for (const label of NO2_LABELS) {
      const t = NO2_LOCAL_TONES_V[corner][label];
      seenTones.add(t.T).add(t.L).add(t.R);
      if (new Set([t.T, t.L, t.R]).size < 3) nonPermutation += 1;
    }
  }
  if (nonPermutation === 0) {
    throw new Error('finder-NO2: 비-순열 셀이 없다 — digit 알파벳으로 충분했다는 뜻이 된다');
  }
  if (seenTones.size < 2) throw new Error('finder-NO2: 톤이 균일하다 — 검출 불가');
}
