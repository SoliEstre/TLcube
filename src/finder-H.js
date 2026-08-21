/**
 * finder-H.js — H 파인더 (타입 G 기본 파인더)의 «톤 정본».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 1. 지위 — CM 은 «자리 예약», 그 자리의 «심볼» 이 기본 파인더다
 * ─────────────────────────────────────────────────────────────────────────
 * 운영자 결정 (2026-08-21): CM 계열은 파인더가 아니라 자리 예약 개념으로 격하됐고,
 * 그 자리에 들어가는 심볼이 기본 파인더다 — Type A 자리(A-CM 21셀)엔 H2O
 * (`markerA.js` H2O_LOCAL_TONES_A), Type G(= O + 코너 예약) 자리(O-CM 12셀)엔
 * **H** (이 모듈). 배정은 `markerG.js` 표의 `defaultFinder` 열이 든다.
 *
 * H 는 **확장 영역만 쓰는 파인더**다 — 중앙 19셀 슬롯·OAK 공통 영역과 분리된 축이고,
 * `finderStarter: bullseye` 는 「중앙은 불스아이 그대로」라는 기준선 선언이지 대체가
 * 아니다. 실측: 정본 export 의 중앙 `cellMasks` 19개는 `cell-editor-core.js`
 * `bullseyeCellMasks()` 산출과 **바이트 동일**이다 (claude-h-probe ④) — 즉 중앙
 * 슬롯 표현은 이미 있는 것과 정확히 대응하고, 새 중앙 파인더는 만들지 않는다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2. 정본과 발자국 — 12셀 = markerCells(6), 손 좌표 없음
 * ─────────────────────────────────────────────────────────────────────────
 * 정본: 셀 편집기 v2 export `finder-H.json` (운영자 제공 2026-08-21 · type O ·
 * k=6 · full-surface · starter bullseye). repo 사본: `test/output/lanes/finder-H.json`
 * (바이트 동일). 유도 규약은 OAK 와 같다 — export 에 없는 면은 중간톤(1).
 * toneOverrides 30항목이 닿는 12셀은 **`markerCells(6)` 위치와 완전 일치**한다
 * (12/12 · 어긋남 0, `test/output/lanes/h-footprint-check.mjs` 재현). 그래서 좌표는
 * 이 모듈에 없다 — 아래 표는 코너×로컬라벨(A·B·C·D)로만 적히고, 좌표는 전부
 * `markerO.markerCells(k)` 에서 유도된다 (좌표 손 나열은 이 저장소 최다 결함).
 *
 * 12셀 중 6은 정본 편집기에서도 detector(비-데이터)고 6은 데이터 셀에 톤만 덮은
 * 것이다 (counts.detector 6) — H2O(18 전부 detector)보다 데이터 손실이 작다.
 * O-CM 레이아웃에서는 12셀 전부가 이미 예약석(앵커 3 + 마커 9)이라 회계 무변화다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 3. k=8·10 유도 규칙 — 로컬 라벨 복사 (ringCentersA 전례)
 * ─────────────────────────────────────────────────────────────────────────
 * 정본은 k=6 뿐이다. `markerA.js` 가 「같은 로컬 라벨을 링 중심에 복사」로 전 k 를
 * 유도했듯, H 는 **같은 (코너, 라벨) 튜플을 markerCells(k) 가 주는 그 k 의 tetrad
 * 자리에 복사**한다. tetrad 로컬 구조(A=코너, B·C·D 이웃)는 k 무관하게 동형이고
 * (markerO `tetradBase`), 위치의 영역 안·ρ-불변·역할 무충돌은 markerO 로드
 * 자기검증이 k=6/8/10 전부에서 이미 강제한다. 그래서 규칙은 전 k 에서 성립한다 —
 * 값 확인은 `test/finder-H.test.js` ②.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 4. 렌더 계약 — 팔레트는 palette.levels, 파인더 축 금지
 * ─────────────────────────────────────────────────────────────────────────
 * 셀 entry 에 `tones: {T,L,R}` 를 실으면 `scene.js` faceColor 가 **데이터와 같은
 * `palette.levels`** 로 그린다. 파인더 축(bullseyeLight = 순백)은 금지 — 순백이
 * 안전영역·흰 지면과 구별되지 않아 실루엣에 구멍이 나고 원거리 인식률이 떨어진다
 * (2026-08-20 실기기 실측, `scene.js` faceColor 헤더). 구별은 색이 아니라 «조합»
 * 이다: H 12셀 중 6셀이 비-순열(전면 동톤 3 포함)이라 데이터 셀이 만들 수 없다.
 * digit 층은 그대로 남는다 — digit 은 와이어·알파벳 계약이고 tones 는 심볼 오버레이다.
 *
 * ⚠ 알려진 공백 (실측 2026-08-21, `claude-h-decode-probe.mjs`): H 는 tetrad A
 * (= 레거시 앵커 3셀)까지 덮으므로, 톤을 실은 프레임은 digit 기반 앵커 검출이
 * 못 읽는다 (H2O 는 앵커를 안 덮어 이 공백이 없다). 그래서 `encode.js` 의 톤 적재는
 * **opt-in** (`markerTones`) 이고 기본 digit 렌더는 바이트 동일이다 — 검출기 배선과
 * 기본값 전환은 통합자 몫이다 (`test/finder-H.test.js` ⑥ 이 공백을 잠근다).
 *
 * 런타임 의존성 0 · 순수 ESM.
 */

import { markerCells, MARKER_LABELS } from './markerO.js';
import { ANCHOR_CORNER_INDICES } from './placement.js';
import { markerGSpec } from './markerG.js';
import { VERSIONS } from './capacity.js';

/** 심볼 이름 — `markerG.js` 표의 `defaultFinder` 값과 같은 문자열. */
export const H_NAME = 'H';

function key(q, r) {
  return q + ',' + r;
}

/**
 * 정본 H 의 면별 톤 — k=6 편집기 export 를 코너(0·2·4) × 로컬 라벨(A·B·C·D)에 고정.
 * 다른 k 는 같은 로컬 라벨을 그 k 의 tetrad 자리에 복사한다 (`hTonesByKeyO`).
 * export 에 없는 면은 중간톤 1 (편집기 v2 규약 — 36면 중 6면이 그렇다).
 * 실측: 비-순열 6셀 (전면 동톤 3셀 포함) · 세 코너 튜플이 서로 다르다.
 */
export const H_LOCAL_TONES_O = Object.freeze({
  0: Object.freeze({
    A: Object.freeze({ T: 0, L: 0, R: 0 }),
    B: Object.freeze({ T: 1, L: 0, R: 2 }),
    C: Object.freeze({ T: 2, L: 0, R: 1 }),
    D: Object.freeze({ T: 1, L: 0, R: 2 }),
  }),
  2: Object.freeze({
    A: Object.freeze({ T: 0, L: 2, R: 0 }),
    B: Object.freeze({ T: 0, L: 0, R: 2 }),
    C: Object.freeze({ T: 2, L: 2, R: 2 }),
    D: Object.freeze({ T: 2, L: 0, R: 0 }),
  }),
  4: Object.freeze({
    A: Object.freeze({ T: 0, L: 0, R: 0 }),
    B: Object.freeze({ T: 2, L: 0, R: 1 }),
    C: Object.freeze({ T: 1, L: 2, R: 0 }),
    D: Object.freeze({ T: 2, L: 1, R: 0 }),
  }),
});

/** 정본 H 톤을 k 의 마커 좌표로 전개한 표 ("q,r" → {T,L,R}) — 좌표는 markerCells 유도. */
export function hTonesByKeyO(k) {
  const map = new Map();
  for (const cell of markerCells(k)) {
    const corner = H_LOCAL_TONES_O[cell.corner];
    const tones = corner && corner[cell.label];
    if (!tones) {
      throw new Error('finder-H: 로컬 표에 코너 ' + cell.corner + ' 라벨 ' + cell.label + ' 가 없다');
    }
    map.set(key(cell.q, cell.r), tones);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────
// 모듈 로드 시점 자기검증 (markerA 전례) — 표의 주장들이 거짓이면 즉시 throw
// ─────────────────────────────────────────────────────────────────────────
{
  // ① 표의 키가 정확히 코너 3 × 라벨 4 이고 톤이 0/1/2 다.
  const corners = Object.keys(H_LOCAL_TONES_O).map(Number).sort((a, b) => a - b);
  if (corners.join(',') !== [...ANCHOR_CORNER_INDICES].sort((a, b) => a - b).join(',')) {
    throw new Error('finder-H: 표의 코너가 ANCHOR_CORNER_INDICES 와 다르다: ' + corners);
  }
  for (const corner of corners) {
    const labels = Object.keys(H_LOCAL_TONES_O[corner]).sort();
    if (labels.join(',') !== [...MARKER_LABELS].sort().join(',')) {
      throw new Error('finder-H: 코너 ' + corner + ' 의 라벨이 MARKER_LABELS 와 다르다');
    }
    for (const label of labels) {
      for (const face of ['T', 'L', 'R']) {
        const tone = H_LOCAL_TONES_O[corner][label][face];
        if (tone !== 0 && tone !== 1 && tone !== 2) {
          throw new Error('finder-H: ' + corner + '.' + label + '.' + face + ' 톤이 0/1/2 가 아니다');
        }
      }
    }
  }
  // ② 전 k 에서 마커 12셀 전부에 톤이 실린다 (markerCells 의 톤 계약이 누락을 던진다).
  for (const k of [6, 8, 10]) {
    const cells = markerCells(k, hTonesByKeyO(k));
    if (cells.length !== 12 || cells.some((c) => !c.tones)) {
      throw new Error('finder-H k=' + k + ': 톤 적재가 12셀을 다 못 덮는다');
    }
  }
  // ③ 심볼다움 — 비-순열 셀이 실재하고(digit 경로가 못 그리는 이유), 톤이 균일하지
  //    않으며(검출 가능성, finder-oak-patterns ③ 전례), 세 코너 튜플이 서로 다르다
  //    (방향 비공변 — O-CM digit 층과 달리 톤 층은 코너 자체로 갈린다).
  const tuples = corners.map((corner) => MARKER_LABELS
    .map((label) => ['T', 'L', 'R'].map((face) => H_LOCAL_TONES_O[corner][label][face]).join(''))
    .join('|'));
  if (new Set(tuples).size !== 3) {
    throw new Error('finder-H: 코너 튜플이 서로 같다 — 코너 구별이 죽는다');
  }
  let nonPermutation = 0;
  const seenTones = new Set();
  for (const corner of corners) {
    for (const label of MARKER_LABELS) {
      const t = H_LOCAL_TONES_O[corner][label];
      seenTones.add(t.T).add(t.L).add(t.R);
      if (new Set([t.T, t.L, t.R]).size < 3) nonPermutation += 1;
    }
  }
  if (nonPermutation === 0) {
    throw new Error('finder-H: 비-순열 셀이 없다 — digit 알파벳으로 충분했다는 뜻이 된다');
  }
  if (seenTones.size < 2) throw new Error('finder-H: 톤이 균일하다 — 검출 불가');
  // ④ markerG 표와의 연결 — hex(타입 G) 전 버전의 기본 파인더가 H 로 적혀 있다.
  for (const spec of VERSIONS) {
    if (markerGSpec('hex', spec.version).defaultFinder !== H_NAME) {
      throw new Error('finder-H: markerG hex V' + spec.version + ' 의 defaultFinder 가 H 가 아니다');
    }
  }
}
