#!/usr/bin/env node
/**
 * finder-taxonomy.js — 파인더 3분류 정본 (2026-08-21).
 *
 * 손 목록이 아니라 src/ 표에서 유도한다. `node src/finder-taxonomy.js` 가 분류별
 * 항목과 «미분류» 를 찍는다.
 *
 * 이름 근거: `finder-oak-lineup.js` 는 OAK 후보 **명부**(margin·지위)이고
 * `finder-patterns.js` 는 중앙 19셀 **렌더 표**다. 이 모듈은 그 표들을 운영자
 * 확정 3분류로 묶는 **분류 층**이라 `finder-taxonomy` 이다.
 *
 * 운영자 확정 3분류 (2026-08-21 · H 재배치 2026-08-23):
 *   1 중앙 파인더 — 초기 4종 + 중앙 19셀 (taegeuk 포함)
 *   2 OAK 공통 육각 영역 내 셀 표면 파인더 — sagoae · o-cm · **H**
 *     내부 구분: 중심부 기준 / 꼭짓점 기준
 *   3 VAK 확장 영역 셀 표면 파인더 — H2O · H2CO3 · **CO2** · a-cm · v-cm
 *     꼭짓점 기준 only
 *
 * ⚠ **H = 분류 2 (운영자 확정 2026-08-23).** 편입 당시 H 는 H2O·H2CO3 와 묶여
 *   분류 3(VAK 확장 영역)에 들어갔는데, 이후 확정된 H 디자인은 **O-CM 자리의
 *   육각 경계 12셀**(`markerO.markerCells(k)` 와 12/12 일치)이다 — 확장 영역이
 *   아니라 육각 영역 안이므로 자리(o-cm)와 같은 분류 2다. 좌표 기준은 꼭짓점.
 *   H2O(21셀, A-CM 자리)는 분류 3 그대로다 — tri 확장 영역이 맞다.
 *
 *   표 데이터 반영 완료 (2026-08-24 코드 라운드) — `add({id:'H', class: 2, ...})`
 *   가 finder-H.js 실측 문장으로 섰고, 내곽 zone 유도(finder-zone-ui)가 따라온다.
 *
 * ⚠ 2026-08-21 운영자 정정:
 *   H2O·H2CO3 는 «확장 영역만 쓰는 파인더»다. 중앙 19셀 슬롯이나 OAK 공통
 *   영역과 분리된 축이다. `finderStarter` 는 그 디자인이 **올라탄 기준선**일 뿐
 *   그 디자인의 내용이 아니다. 「H2O 가 중앙 3톤 큐브를 파인더로 갖는다」·
 *   「A-CM 이 H2O 의 중앙 파인더를 버렸다」는 오독이다.
 *
 *   CM 계열은 파인더가 아니라 «자리 예약». 그 자리에 들어가는 심볼이 기본
 *   파인더다 — Type A(a-cm) → H2O, Type G(o-cm) → H, **턴A(v-cm) → CO2**
 *   (2026-08-24 편입 — 종전 «H2O 대칭 사상» 잠정 규약을 대체한다).
 *
 * 톤 규약:
 *   중앙 셀 파인더: 흑/백/회색 유지가 기본
 *   그 외 셀 표면 파인더: 셀 컬러(`palette.levels`)만. 큐브 3색 세트 고정 미적용
 *
 * 런타임 의존성 0 · 순수 ESM.
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  FINDER_PATTERNS,
  FINDER_CELL_ORDER,
  LEGACY_FINDER_PATTERN_ID,
} from './finder-patterns.js';
import {
  CENTER_QR_FINDER_PATTERN_ID, CENTRAL_V0_FINDER_PATTERN_ID,
} from './finder-selection.js';
import { FINDER_CARD_GROUPS } from './finder-card-ui.js';
import {
  OAK_LINEUP, liveOakCandidates, oakCandidate,
} from './finder-oak-lineup.js';
import {
  OAK_ALL_FINDER_PATTERNS, OAK_FINDER_PATTERNS, oakRenderStatus,
} from './finder-oak-patterns.js';
import {
  DAEHAN_NAME,
  DAEHAN_FINDER_PATTERN_IDS,
  DAEHAN_RADII,
  TAEGUK_ID,
  SAGOAE_ID,
  daehanFinderCellsFor,
  daehanReservedCells,
  taegeukCells,
  sagoaeCells,
} from './finder-daehan.js';
import {
  markerCells, MARKER_LOCAL_DIGITS,
  overheadBreakdownOMarker,
} from './markerO.js';
import {
  markerCellsK, MARKER_INVERTED_DIGITS_K, MARKER_OVERHEAD_ADDED_K,
} from './markerK.js';
import {
  markerCellsA, markerCellsTurnA, MARKER_CELL_COUNT_A,
  MARKER_LOCAL_DIGITS_A, H2O_LOCAL_TONES_A,
} from './markerA.js';
import {
  CO2_NAME, CO2_LOCAL_TONES_V, CO2_LABELS,
  CO2_CELL_COUNT, CO2_ANCHOR_COUNT, CO2_MARKER_COUNT,
  co2CellsTurnA,
} from './finder-CO2.js';
import { GENERATOR_TYPES } from './generator-state.js';
import {
  LOCATOR_PROFILE_OFF,
  LOCATOR_PROFILE_HEX_FRAME_V1,
  LOCATOR_PROFILE_CELL_SURFACE_V0X,
  LOCATOR_PROFILE_CELL_SURFACE_V0XQ,
} from './locatorY.js';
import { CELL_SURFACE_FINAL_ACTIVE_IDS } from './cellSurfaceFinal.js';
export const FINDER_CLASS = Object.freeze({
  1: '중앙 파인더',
  2: 'OAK 공통 육각 영역 내 셀 표면 파인더',
  3: 'VAK 확장 영역 셀 표면 파인더',
  W: '와이어 합성 (표시층에서 갈림)',
  U: '미분류',
});

export const COORD_CENTER = '중심부';
export const COORD_VERTEX = '꼭짓점';

export const TONE_FINDER_BWG = '흑백회(finder)';
export const TONE_CELL_COLOR = '셀 컬러(palette.levels)';
export const TONE_CANONICAL_NONPERM = '정본 비순열 · 현행 미렌더';

export const KIND_FINDER = 'finder';
export const KIND_SEAT = 'seat-reservation';
export const KIND_WIRE = 'wire-composite';
export const KIND_ABSENT = 'absent';
export const KIND_BLOCKED = 'blocked';
export const KIND_LOCATOR = 'locator';

/**
 * 자리 예약 → 기본 파인더.
 * Type A 는 인코더가 H2O 톤을 싣는 것으로 교차 확인된다 (`encodeA` marker 경로).
 * Type G → H 는 운영자 2026-08-21 — 디자인 정본은 `finder-H.js` (markerTones opt-in).
 */
export const SEAT_DEFAULT_FINDER = Object.freeze({
  'a-cm': 'H2O',
  'o-cm': 'H',
  // V-CM — **CO2** (운영자 작화 2026-08-24 수정본, 편입 2026-08-24).
  //
  // 종전 값은 'H2O' 였다: 자리가 A-CM 의 턴A 사상이니 심볼도 사상해 쓰자는 잠정
  // 규약이었고, 그때는 V 자리의 «자기 심볼» 이 존재하지 않았다. 이제 존재한다 —
  // `src/finder-CO2.js` (꼭짓점 앵커 3 + 영역 내 이웃 6, 전 k 유도).
  // 전환은 자리 모양(A-CM 21셀 회계)을 바꾸지 않는다: CO2 의 마커 6셀이 그 21셀의
  // 부분집합이라 오버헤드·scan order·용량이 전부 불변이다 (finder-CO2 자기검증 ③).
  // ⚠ 레인 C(K-CM)는 이 값을 'H2O' 로 본 시점에서 갈라져 나왔다 — 그쪽 주석의
  //   «A-CM 과 심볼이 같다» 는 이제 낡은 문장이라 채택하지 않는다.
  'v-cm': 'CO2',
  // K-CM (2026-08-24) — 정본 발자국이 H2CO3 다 (= H2O 링 3 + 반전 꼭짓점 삼각 3,
  // 계약 K-5). 톤 정본은 미채택이라 심볼은 발자국까지다 (markerK.js 헤더 §1).
  'k-cm': 'H2CO3',
});

function freezeRow(row) {
  return Object.freeze({ ...row });
}

function permutationFaces(triple) {
  return new Set(triple).size === 3;
}

function h2oNonPermutationCount() {
  let n = 0;
  for (const corner of [0, 1, 2]) {
    for (const label of Object.keys(H2O_LOCAL_TONES_A[corner])) {
      const t = H2O_LOCAL_TONES_A[corner][label];
      if (!permutationFaces([t.T, t.L, t.R])) n += 1;
    }
  }
  return n;
}

function co2NonPermutationCount() {
  let n = 0;
  for (const corner of [0, 1, 2]) {
    for (const label of CO2_LABELS) {
      const t = CO2_LOCAL_TONES_V[corner][label];
      if (!permutationFaces([t.T, t.L, t.R])) n += 1;
    }
  }
  return n;
}

const FORMAL_IDS = FINDER_CARD_GROUPS.formal.map((d) => d.id);
if (FORMAL_IDS.length !== 4) {
  throw new Error('초기 4종이 4가 아니다: ' + FORMAL_IDS.join(','));
}

function isFormalFour(id) {
  return FORMAL_IDS.includes(id);
}

const INNER19 = Object.freeze(
  taegeukCells().map((cell, i) => ({ cell, levels: null, i })),
);
if (INNER19.length !== 19) {
  throw new Error('taegeuk 이 19셀이 아니다: ' + INNER19.length);
}

const TAEGUK_SET = new Set(taegeukCells().map((c) => c.q + ',' + c.r));
const SLOT19_SET = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));
export const taegeukEqualsCentralSlot = TAEGUK_SET.size === SLOT19_SET.size
  && [...TAEGUK_SET].every((k) => SLOT19_SET.has(k));
if (!taegeukEqualsCentralSlot) {
  throw new Error('taegeuk 집합이 FINDER_CELL_ORDER 와 다르다');
}

function buildItems() {
  const items = [];
  const add = (row) => { items.push(freezeRow(row)); };

  for (const desc of FINDER_CARD_GROUPS.formal) {
    const pattern = desc.pattern;
    const renderKind = pattern
      ? pattern.renderKind
      : (desc.id === LEGACY_FINDER_PATTERN_ID ? 'bullseye'
        : desc.id === CENTER_QR_FINDER_PATTERN_ID ? 'center-qr' : '?');
    add({
      id: desc.id,
      name: pattern ? pattern.name : desc.id,
      class: 1,
      className: FINDER_CLASS[1],
      kind: KIND_FINDER,
      origin: 'FINDER_CARD_GROUPS.formal',
      renderPath: 'src/scene.js resolveFinderRenderPattern → ' + renderKind,
      coordBasis: COORD_CENTER,
      innerSplit: null,
      toneAxis: TONE_FINDER_BWG,
      cells: desc.id === CENTER_QR_FINDER_PATTERN_ID ? 'QR 21×21 중앙 슬롯'
        : desc.id === LEGACY_FINDER_PATTERN_ID ? '불스아이 밴드 (19셀 슬롯)'
          : '19셀 슬롯',
      renderable: true,
      consumer: '생성기 카드 formal · LAB_CENTRAL_FINDER_IDS · scene.js',
      note: '초기 4종',
    });
  }

  // central-v0 (비컨) — «전수» 를 주장하는 표에 유일하게 빠져 있던 선택 가능 카드
  // (F-34 · C1 편입, 2026-08-23). 카드 표 밖에서 index.html 이 center-qr 앞에 규칙으로
  // 끼워 넣는 CENTRAL_V0_FINDER_CARD 가 실체다 — 2026-08-22 부터 O·A 공통 선택지.
  add({
    id: CENTRAL_V0_FINDER_PATTERN_ID,
    name: '중앙 TL (비컨)',
    class: 1,
    className: FINDER_CLASS[1],
    kind: KIND_FINDER,
    origin: 'CENTRAL_V0_FINDER_CARD (finder-card-ui) — 카드 표 밖 규칙 삽입',
    renderPath: 'src/scene.js central-v0 (내부 Type Y v0 비컨 렌더)',
    coordBasis: COORD_CENTER,
    innerSplit: null,
    toneAxis: '셀 컬러 (palette.levels — 내부 Y v0 큐브)',
    cells: '중앙 v0 블록 (n=13 축소)',
    renderable: true,
    consumer: '생성기 카드 formal행 삽입 · central-beacon-adapt 검출 · LAB_CENTRAL',
    note: 'F-34 편입 — 계약 _contracts/central-v0-beacon.md 가 기하 정본',
  });

  for (const pattern of FINDER_PATTERNS) {
    if (isFormalFour(pattern.id)) continue;
    add({
      id: pattern.id,
      name: pattern.name,
      class: 1,
      className: FINDER_CLASS[1],
      kind: KIND_FINDER,
      origin: 'FINDER_PATTERNS family=' + pattern.family,
      renderPath: 'src/scene.js cell-mask (cellMasks 19)',
      coordBasis: COORD_CENTER,
      innerSplit: null,
      toneAxis: TONE_FINDER_BWG + ' 이진',
      cells: '19',
      renderable: true,
      consumer: 'FINDER_CARD_GROUPS.generated|refined · cell-finder-detect · LAB_CENTRAL',
      note: pattern.family === 'user-refined' ? '손그림 개선' : '생성 도구 산출',
    });
  }

  for (const pattern of OAK_ALL_FINDER_PATTERNS) {
    const lineup = OAK_LINEUP.find((e) => e.name === pattern.lineupName);
    // 명부 live-join (C1, 2026-08-23) — dropped/dead 후보는 분류 1 행을 만들지 않는다.
    // 안 그러면 같은 후보가 «분류1 파인더 + U·blocked» 두 행으로 이중 등재된다
    // (blocked 행이 유일 표현 — 아래 명부 루프가 만든다). Benzene 이 첫 사례.
    if (lineup && lineup.status !== 'active') continue;
    // 렌더 전용(oak-taegeuk-solo)은 검출 소비자가 없다 — daehan 부분집합 오수용
    // 실측으로 검출 편입이 통합자 게이트 뒤에 있다 (finder-oak-patterns.js
    // OAK_RENDER_ONLY_FINDER_PATTERNS 헤더). 여기 표에서도 그 차이가 읽혀야 한다.
    const detectable = OAK_FINDER_PATTERNS.includes(pattern);
    add({
      id: pattern.id,
      name: pattern.name,
      class: 1,
      className: FINDER_CLASS[1],
      kind: KIND_FINDER,
      origin: (detectable ? 'OAK_FINDER_PATTERNS' : 'OAK_RENDER_ONLY_FINDER_PATTERNS')
        + ' lineupName=' + pattern.lineupName,
      renderPath: 'src/scene.js cell-mask (cellLevels 19)',
      coordBasis: COORD_CENTER,
      innerSplit: null,
      toneAxis: TONE_FINDER_BWG + ' 3레벨',
      cells: '19',
      renderable: true,
      consumer: detectable
        ? 'FINDER_CARD_GROUPS.oak · cell-finder-detect · LAB_CENTRAL'
        : 'FINDER_CARD_GROUPS.oak (렌더 전용 — 검출 편입은 통합자 몫)',
      note: 'margin=' + (lineup ? lineup.margin : '?') + ' status=' + (lineup ? lineup.status : '?'),
    });
  }

  // taegeuk — daehan 내부 19. 기하 함수에서 유도. 와이어 id 가 아니다.
  {
    const cells = taegeukCells();
    add({
      id: TAEGUK_ID,
      name: TAEGUK_ID,
      class: 1,
      className: FINDER_CLASS[1],
      kind: KIND_FINDER,
      origin: '유도: taegeukCells() = hexDistance≤BULLSEYE_RADIUS ∩ DAEHAN_FINDER_CELLS',
      renderPath: '원자 oak-daehan-k* cell-mask 의 내부 19 (전용 renderKind 없음)',
      coordBasis: COORD_CENTER,
      innerSplit: null,
      toneAxis: TONE_FINDER_BWG,
      cells: String(cells.length),
      renderable: true,
      consumer: '표시·분류 층. 와이어는 oak-daehan-k* · daehanFinder',
      note: '집합이 FINDER_CELL_ORDER 와 '
        + (taegeukEqualsCentralSlot ? '동일' : '다름')
        + ' · 카드는 합성 한 장(k 는 버전이 정함)',
    });
  }

  // sagoae — daehan 예약 셀. 중심부 기준 (절대 축좌표).
  add({
    id: SAGOAE_ID,
    name: SAGOAE_ID,
    class: 2,
    className: FINDER_CLASS[2],
    kind: KIND_FINDER,
    origin: '유도: sagoaeCells(k) = daehanReservedCells(k)',
    renderPath: '원자 oak-daehan-k* cell-mask 의 불스아이 밖 (전용 renderKind 없음)',
    coordBasis: COORD_CENTER,
    innerSplit: '중심부 기준',
    toneAxis: TONE_FINDER_BWG + ' — 분류2 규약(셀 컬러만)과 어긋남 (렌더 분리는 후속)',
    cells: DAEHAN_RADII.map((k) => 'k' + k + '=' + sagoaeCells(k).length).join(' '),
    renderable: true,
    consumer: '회계: daehanReservedCells → capacityDaehan / layout scan',
    note: 'lab 텔레메트리 키는 레거시 `daehan`. 표시는 sagoae',
  });

  // 원자 와이어 템플릿 — 분류 1+2 를 한 id 가 붙잡지 않게 합성으로 격하
  for (const id of DAEHAN_FINDER_PATTERN_IDS) {
    const k = Number(id.slice('oak-daehan-k'.length));
    const reserved = daehanReservedCells(k).length;
    const alive = daehanFinderCellsFor(k).length;
    add({
      id,
      name: DAEHAN_NAME + ' k' + k,
      class: 'W',
      className: FINDER_CLASS.W,
      kind: KIND_WIRE,
      origin: 'DAEHAN_FINDER_PATTERN_IDS (검출·인코더 템플릿)',
      renderPath: 'src/scene.js cell-mask (finderCells ' + alive + ')',
      coordBasis: COORD_CENTER,
      innerSplit: null,
      toneAxis: TONE_FINDER_BWG + ' 3레벨 — 정본은 0/2 이진',
      cells: String(alive) + ' (taegeuk 19 + sagoae ' + reserved + ')',
      renderable: true,
      consumer: '카드 대표 oak-daehan-k10 · encode.daehanFinder · bootstrap 옵트인',
      note: 'formatIndex 공유 (V*D). 표시층 id 는 taegeuk + sagoae',
    });
  }

  // O-CM — 자리 예약 (꼭짓점 기준). 기본 파인더는 H (finder-H.js — markerTones opt-in).
  {
    const cells = markerCells(6);
    const markers = cells.filter((c) => c.role === 'marker');
    const anchors = cells.filter((c) => c.role === 'anchor');
    const withTones = cells.filter((c) => c.tones);
    const ob = overheadBreakdownOMarker(6);
    add({
      id: 'o-cm',
      name: 'O-CM',
      class: 2,
      className: FINDER_CLASS[2],
      kind: KIND_SEAT,
      origin: 'src/markerO.js markerCells · markerG family=hex',
      renderPath: 'encode.js provider.fixed → cellDigits digit only → scene.faceColor palette.levels',
      coordBasis: COORD_VERTEX,
      innerSplit: '꼭짓점 기준',
      toneAxis: TONE_CELL_COLOR + '. tones 미부착',
      cells: '12 (anchor ' + anchors.length + ' + marker ' + markers.length + ')',
      renderable: withTones.length === 0
        ? 'digit-only (전용 심볼 없음)'
        : 'tones ' + withTones.length,
      consumer: '생성기 cornerMarker · decode formatIndex G · corner-marker-detect',
      note: '자리 예약. 기본 파인더=' + SEAT_DEFAULT_FINDER['o-cm']
        + ' (디자인 없음) · overhead.marker=' + ob.marker
        + ' · MARKER_LOCAL_DIGITS=' + JSON.stringify(MARKER_LOCAL_DIGITS),
    });
  }

  // H2O · H2CO3 — live A/K 후보. finderMode 로 분류하지 않는다 (오독의 근원).
  for (const row of liveOakCandidates()) {
    if (row.type !== 'A' && row.type !== 'K') continue;
    const isH2O = row.name === 'H2O';
    add({
      id: row.id,
      name: row.name,
      class: 3,
      className: FINDER_CLASS[3],
      kind: KIND_FINDER,
      origin: 'liveOakCandidates type=' + row.type
        + ' (finderMode=' + row.finderMode + ' 는 기준선 필드이지 분류 키가 아니다)',
      renderPath: 'oakRenderStatus=' + oakRenderStatus(row.name)
        + ' — 중앙 19밖 코너 ' + row.counts.detector + '셀',
      coordBasis: COORD_VERTEX,
      innerSplit: '꼭짓점 기준',
      toneAxis: TONE_CANONICAL_NONPERM,
      cells: String(row.counts.detector) + ' detector'
        + (isH2O ? ' / 21 with centers (markerA)' : ''),
      renderable: false,
      consumer: '명부·편집기 JSON. H2O 는 Type A 자리의 기본 파인더 (인코더 톤 표는 있음)',
      note: 'margin=' + row.margin
        + ' · finderStarter=' + row.finderStarter
        + ' 는 올라탄 기준선이지 이 디자인의 내용이 아니다'
        + (isH2O ? ' · 비순열 ' + h2oNonPermutationCount() + '/21' : '')
        + (row.type === 'K'
          // ⚠ 종전엔 «Type K 인코더 없음» 이라 적혀 있었다 — encodeK.js 착지(2026-08-24)로
          // 거짓이 됐고, K 생성기 편입(2026-08-25)으로 두 번째 절도 낡았다. 명부·덤프로
          // 흘러가는 문장이라 거짓이면 다음 사람을 오도한다: **유도해서** 적는다.
          ? ' · Type K 생성기 편입=' + (GENERATOR_TYPES.includes('K') ? 'O' : 'X')
            + ' (GENERATOR_TYPES=' + GENERATOR_TYPES.join(',') + ')'
          : ''),
    });
  }

  // H — Type G 자리의 기본 파인더 (finder-H.js 가 정본 — markerCells 유도 12셀 톤 표).
  add({
    id: 'H',
    name: 'H',
    class: 2,
    className: FINDER_CLASS[2],
    kind: KIND_FINDER,
    origin: 'SEAT_DEFAULT_FINDER[o-cm] — 운영자 2026-08-21 Type G → H · 분류 2 확정 2026-08-23',
    renderPath: 'src/finder-H.js hTonesByKeyO — markerCells(k) 유도 12셀 톤 표, markerTones opt-in',
    coordBasis: COORD_VERTEX,
    innerSplit: '꼭짓점 기준',
    toneAxis: TONE_CELL_COLOR + ' (palette.levels — 순백 금지, finder-H.js §팔레트)',
    cells: '12 (markerCells 유도 — 비순열 6 · detector 6)',
    // H2O 규약과 같다: 인코더 톤 표는 실재하지만 **생성기 선택 축이 미배선**이라
    // 화면에서 그릴 수 없다 (SPEC §13 TBD «[G] H 의 생성기 선택 축» — F-38).
    renderable: false,
    consumer: 'markerG defaultFinder(hex 전 버전) · 편집기 JSON. 렌더는 markerTones opt-in',
    note: '육각 경계 12셀 = O-CM 자리의 심볼 파인더 (분류 2 기하). '
      + 'tetrad A 가 digit 앵커를 덮으므로 앵커 검출 경로는 TBD',
  });

  // CO2 — 턴A 자리(V-CM)의 기본 파인더 (`finder-CO2.js` 가 정본 — 유도 9셀 톤 표).
  // 분류 3: VAK 확장 영역 · 꼭짓점 기준. 꼭짓점 «자체» 를 포함하는 첫 심볼이다
  // (H2O 는 2칸 안쪽 링, H 는 육각 경계 tetrad — 둘 다 꼭짓점 앵커를 안 덮는다).
  add({
    id: CO2_NAME,
    name: CO2_NAME,
    class: 3,
    className: FINDER_CLASS[3],
    kind: KIND_FINDER,
    origin: 'SEAT_DEFAULT_FINDER[v-cm] — 운영자 작화 2026-08-24 (수정본) · 정본 사본 test/output/lanes/finder-CO2.json',
    renderPath: 'src/finder-CO2.js co2SeatMarkerCellsA — encodeA(turnA+cornerMarker) 기본 적재 (마커 6셀)',
    coordBasis: COORD_VERTEX,
    innerSplit: '꼭짓점 기준 (역삼각)',
    toneAxis: TONE_CELL_COLOR + ' (palette.levels — 순백 금지, finder-CO2.js §5)',
    cells: String(CO2_CELL_COUNT) + ' (꼭짓점 앵커 ' + CO2_ANCHOR_COUNT
      + ' + 영역 내 이웃 ' + CO2_MARKER_COUNT + ' — 전 k 유도, 손 좌표 0)',
    // 마커 6셀은 **기본 적재**라 화면에 실제로 그려진다 (H·H2O 와 갈리는 지점).
    // 앵커 3셀은 opt-in — 덮으면 digit 기반 앵커 검출이 죽는다 (실측 2026-08-24).
    renderable: '마커 ' + CO2_MARKER_COUNT + '셀 기본 적재 · 앵커 '
      + CO2_ANCHOR_COUNT + '셀 opt-in(co2AnchorTones)',
    consumer: 'encodeA V-CM 톤 경로 · 생성기 outerSeat v-cm · 편집기 JSON',
    note: '비순열 ' + co2NonPermutationCount() + '/' + CO2_CELL_COUNT
      + ' (전부) · 중앙 파인더 축과 **직교** — 정본 cellMasks 19 는 기본 불스아이와 바이트 동일. '
      + '앵커 피복은 알려진 공백 (H 와 같은 축, finder-CO2.test ⑥)',
  });

  // A-CM — 자리 예약. 기본 파인더는 H2O.
  {
    const cells = markerCellsA(6);
    const withTones = cells.filter((c) => c.tones);
    add({
      id: 'a-cm',
      name: 'A-CM',
      class: 3,
      className: FINDER_CLASS[3],
      kind: KIND_SEAT,
      origin: 'src/markerA.js markerCellsA · markerG family=tri',
      renderPath: 'encodeA.js marker: markerCellsA (H2O 톤 경로 있음) → palette.levels',
      coordBasis: COORD_VERTEX,
      innerSplit: '꼭짓점 기준',
      toneAxis: TONE_CELL_COLOR + '. 기본 파인더 H2O 의 톤 표는 살아 있음',
      cells: String(MARKER_CELL_COUNT_A),
      renderable: withTones.length === 0
        ? 'digit-only 기본 (permutation ' + JSON.stringify(MARKER_LOCAL_DIGITS_A) + ')'
        : 'tones ' + withTones.length,
      consumer: '생성기 cornerMarker(Type A) · decode G · corner-marker-detect',
      note: '자리 예약. 기본 파인더=' + SEAT_DEFAULT_FINDER['a-cm']
        + ' · 발자국 21=18링+3중심. H2O 의 중앙 파인더를 버린 것이 아니다',
    });
  }

  // V-CM — 실체 전환 (2026-08-24, 배타 개설 정형 3단: ① 근거 실측 — 턴A 기하
  // 개통 + markerA ④ 자기검증 ② 표 명시 확장 — turnA.js V 표 말미 V0CM/V1CM/V2CM
  // ③ 구 락(KIND_ABSENT 행 + 아래 자기검증의 'U' 단언)을 이 양성 행으로 전환).
  // 종전 부재 행: «코드 정체 없음 — 분류 3 에 억지 배정하지 않음» — 이제 정체가 있다.
  {
    const cells = markerCellsTurnA(6);
    const co2 = co2CellsTurnA(6);
    add({
      id: 'v-cm',
      name: 'V-CM',
      class: 3,
      className: FINDER_CLASS[3],
      kind: KIND_SEAT,
      origin: 'src/turnA.js V 표 말미(V0CM/V1CM/V2CM) · src/markerA.js markerCellsTurnA (A-CM 대칭 유도)',
      renderPath: 'encodeA.js marker(turnA + cornerMarker) — canonical 좌표 + scene.js turnA 배치 반전',
      coordBasis: COORD_VERTEX,
      innerSplit: '꼭짓점 기준 (역삼각)',
      // **실체 갱신 2026-08-24**: 자리 모양은 그대로 A-CM 사상인데 그 위에 올라가는
      // 심볼이 H2O → CO2 로 바뀌었다. 자리(21셀 회계)와 심볼(9셀 톤)은 다른 층이다.
      toneAxis: TONE_CELL_COLOR + '. 기본 파인더 ' + SEAT_DEFAULT_FINDER['v-cm']
        + ' 톤 표 (셀 정립 — 사상 불변). 21셀 중 ' + co2.filter((c) => c.role === 'marker').length
        + '셀에 톤, 나머지는 digit-only',
      cells: String(cells.length),
      renderable: '자리 21셀 = A-CM 과 동일 digit · 심볼 CO2 마커 '
        + co2.filter((c) => c.role === 'marker').length + '셀 톤 (앵커 '
        + co2.filter((c) => c.role === 'anchor').length + '셀은 opt-in)',
      consumer: '생성기 outerSeat v-cm(Type A × turnA) · decode V-CM(turn + cornerMarker)',
      note: '자리 예약. A-CM 의 턴A 대응 — 손 좌표 0, markerCellsA 의 (−q,−r) 사상. '
        + '기본 파인더=' + SEAT_DEFAULT_FINDER['v-cm'] + ' (2026-08-24 편입 — 종전 H2O 잠정 규약 대체). '
        + 'V-CMQ(+중앙 QR)는 와이어 잔여 0 으로 보류 (turnA.js §V-CM 회계) — '
        + '**자리의 제약이지 CO2 의 제약이 아니다** (CO2 는 중앙 파인더 축과 직교)',
    });
  }
  // K-CM — 실체 전환 (2026-08-24, 배타 개설 정형 3단: ① 근거 실측 — (다)안 «앵커 위
  // 마커» 게이트 3종 통과(test/markerK-measure.mjs) ② 표 명시 확장 — formatK star 축
  // K*CM 3행 + markerK VERSIONS_KCM ③ 구 락(KIND_ABSENT 행 + 아래 자기검증의 'U'
  // 단언)을 이 양성 행으로 전환). 종전 부재 행: «markerK.js 없음» — 이제 있다.
  {
    const cells = markerCellsK(6);
    add({
      id: 'k-cm',
      name: 'K-CM',
      class: 3,
      className: FINDER_CLASS[3],
      kind: KIND_SEAT,
      origin: 'src/markerK.js markerCellsK · src/formatK.js star 축 K*CM 행',
      renderPath: 'encodeK.js cornerMarker: markerCellsK → palette.levels (digit 알파벳)',
      coordBasis: COORD_VERTEX,
      innerSplit: '꼭짓점 기준 (정·역 두 계열)',
      toneAxis: TONE_CELL_COLOR + '. 정본 H2CO3 톤은 30 중 18 이 비-순열이라 미채택 '
        + '(계약 K-8.2) — 발자국만 정본, 톤은 digit 알파벳 재배정 (markerA 전례)',
      cells: String(cells.length),
      renderable: 'digit-only (반전 삼각 ' + JSON.stringify(MARKER_INVERTED_DIGITS_K) + ')',
      consumer: '생성기 outerSeat k-cm(Type K) · encodeK cornerMarker · decode-k (값 8, k)',
      note: '자리 예약. 기본 파인더=' + SEAT_DEFAULT_FINDER['k-cm']
        + ' · 발자국 30 = A 계열 21 + 반전 꼭짓점 삼각 9. 반전 꼭짓점 3셀은 앵커이자 '
        + '마커이고 digit 이 같다((다)안) — 회계는 앵커로 한 번만 세어 오버헤드 +'
        + MARKER_OVERHEAD_ADDED_K + '. 생성기 Type K UI 는 아직 없다 (⑤ 잔여)',
    });
  }

  for (const row of OAK_LINEUP.filter((e) => e.status !== 'active')) {
    add({
      id: row.id,
      name: row.name,
      class: 'U',
      className: FINDER_CLASS.U,
      kind: KIND_BLOCKED,
      origin: 'OAK_LINEUP status=' + row.status,
      renderPath: 'oakRenderStatus=' + oakRenderStatus(row.name),
      coordBasis: COORD_CENTER,
      innerSplit: null,
      toneAxis: '—',
      cells: String(row.counts.detector),
      renderable: false,
      consumer: '명부 기록만 (liveOakCandidates 제외)',
      note: '차단이지 삭제가 아니다 · margin=' + row.margin,
    });
  }

  for (const id of CELL_SURFACE_FINAL_ACTIVE_IDS) {
    add({
      id,
      name: id,
      class: 'U',
      className: FINDER_CLASS.U,
      kind: KIND_LOCATOR,
      origin: 'CELL_SURFACE_FINAL_ACTIVE_IDS (lab 축① locatorLayout)',
      renderPath: 'sceneY / cellSurfaceFinal — Type Y 큐브 면',
      coordBasis: '큐브 면 격자 (육각 아님)',
      innerSplit: null,
      toneAxis: TONE_CELL_COLOR + ' (Type Y 레벨)',
      cells: '레이아웃별',
      renderable: true,
      consumer: '생성기 Type Y 로케이터 · 시험판 기대 레이아웃',
      note: '운영자 3분류 표의 칸이 아니다. v-cm 이 아님',
    });
  }

  add({
    id: LOCATOR_PROFILE_HEX_FRAME_V1,
    name: LOCATOR_PROFILE_HEX_FRAME_V1,
    class: 'U',
    className: FINDER_CLASS.U,
    kind: KIND_LOCATOR,
    origin: 'locatorY.js 프로파일',
    renderPath: 'Type Y 육각 프레임 오버레이 (페이로드 비침범)',
    coordBasis: '실루엣 밖',
    innerSplit: null,
    toneAxis: '오버레이',
    cells: '0 (광학만)',
    renderable: true,
    consumer: '생성기 Type Y locator 프로파일',
    note: '3분류 표 밖',
  });
  add({
    id: LOCATOR_PROFILE_OFF,
    name: LOCATOR_PROFILE_OFF,
    class: 'U',
    className: FINDER_CLASS.U,
    kind: KIND_LOCATOR,
    origin: 'locatorY.js',
    renderPath: '없음',
    coordBasis: '—',
    innerSplit: null,
    toneAxis: '—',
    cells: '0',
    renderable: false,
    consumer: 'Type Y 기본',
    note: '표시 없음',
  });
  for (const id of [LOCATOR_PROFILE_CELL_SURFACE_V0X, LOCATOR_PROFILE_CELL_SURFACE_V0XQ]) {
    add({
      id,
      name: id,
      class: 'U',
      className: FINDER_CLASS.U,
      kind: KIND_BLOCKED,
      origin: 'locatorY.js 드랍 상수 (발행분 법의학)',
      renderPath: '드랍',
      coordBasis: '큐브 면',
      innerSplit: null,
      toneAxis: '—',
      cells: '—',
      renderable: false,
      consumer: '법의학 경로',
      note: '드랍. v-cm 이 아님',
    });
  }

  return items;
}

export const FINDER_TAXONOMY = Object.freeze(buildItems());

export function taxonomyByClass(cls) {
  return FINDER_TAXONOMY.filter((r) => r.class === cls);
}

export function taxonomyItem(id) {
  return FINDER_TAXONOMY.find((r) => r.id === id) || null;
}

/**
 * 분리 불변식. 원자 oak-daehan-k* 가 분류 1 또는 2 를 붙잡고 있으면 분리가
 * 되돌려진 것이다. 모듈 로드와 테스트가 같이 잰다.
 */
export function daehanSplitHolds(items = FINDER_TAXONOMY) {
  const taegeuk = items.find((r) => r.id === TAEGUK_ID);
  const sagoae = items.find((r) => r.id === SAGOAE_ID);
  if (!taegeuk || taegeuk.class !== 1) return false;
  if (!sagoae || sagoae.class !== 2) return false;
  if (items.some((r) => r.class === '1+2')) return false;
  for (const id of DAEHAN_FINDER_PATTERN_IDS) {
    const row = items.find((r) => r.id === id);
    if (!row || row.class !== 'W' || row.kind !== KIND_WIRE) return false;
  }
  return true;
}

{
  if (!daehanSplitHolds()) {
    throw new Error('daehan → taegeuk+sagoae 분리가 되돌려졌다');
  }
  const h2o = taxonomyItem(oakCandidate('H2O').id);
  if (!h2o || h2o.class !== 3 || h2o.kind !== KIND_FINDER) {
    throw new Error('H2O 가 분류 3 파인더가 아니다 — finderStarter 오독일 수 있다');
  }
  const h2co3 = taxonomyItem(oakCandidate('H2CO3').id);
  if (!h2co3 || h2co3.class !== 3) {
    throw new Error('H2CO3 가 분류 3 이 아니다');
  }
  const h = taxonomyItem('H');
  // F-35 (운영자 확정 2026-08-23·코드 반영 2026-08-24): H = 분류 2 — O-CM 자리의
  // 육각 경계 12셀 심볼. 분류 3 이던 편입 당시 문장은 폐기됐다 (헤더 ⚠ 참조).
  if (!h || h.class !== 2 || h.kind !== KIND_FINDER) {
    throw new Error('H 가 분류 2 파인더 슬롯이 아니다 (F-35 운영자 확정)');
  }
  const ocm = taxonomyItem('o-cm');
  const acm = taxonomyItem('a-cm');
  if (!ocm || ocm.kind !== KIND_SEAT || ocm.class !== 2) {
    throw new Error('o-cm 이 분류 2 자리 예약이 아니다');
  }
  if (!acm || acm.kind !== KIND_SEAT || acm.class !== 3) {
    throw new Error('a-cm 이 분류 3 자리 예약이 아니다');
  }
  if (SEAT_DEFAULT_FINDER['a-cm'] !== 'H2O' || SEAT_DEFAULT_FINDER['o-cm'] !== 'H') {
    throw new Error('자리 예약 기본 파인더 표가 운영자 확정과 다르다');
  }
  // v-cm — 실체 전환 (2026-08-24): 구 락(«미분류 'U'» 단언)을 양성 단언으로.
  const vcm = taxonomyItem('v-cm');
  if (!vcm || vcm.kind !== KIND_SEAT || vcm.class !== 3) {
    throw new Error('v-cm 이 분류 3 자리 예약이 아니다 — 2026-08-24 실체 전환과 어긋난다');
  }
  // **심볼 전환 (2026-08-24 CO2 편입)** — 종전 락은 «v-cm 기본 파인더 = H2O» 였다
  // (A-CM 대칭 유도 잠정 규약). V 자리의 자기 심볼(CO2)이 실재하게 됐으므로 그
  // 락을 **양성 단언으로 전환**한다 (배타 개설 정형 3단 ③ — 삭제가 아니라 전환).
  // H2O 는 a-cm 의 심볼로 그대로 남는다 (위 a-cm 단언이 그 자리를 지킨다).
  if (SEAT_DEFAULT_FINDER['v-cm'] !== CO2_NAME) {
    throw new Error('v-cm 자리 예약 기본 파인더가 ' + CO2_NAME + ' 가 아니다 (2026-08-24 편입)');
  }
  const co2 = taxonomyItem(CO2_NAME);
  if (!co2 || co2.class !== 3 || co2.kind !== KIND_FINDER) {
    throw new Error(CO2_NAME + ' 가 분류 3 파인더가 아니다 — 자리(v-cm)와 심볼은 다른 층이다');
  }
  // k-cm — 실체 전환 (2026-08-24): 구 락(«미분류 'U'» 단언)을 양성 단언으로.
  const kcm = taxonomyItem('k-cm');
  if (!kcm || kcm.kind !== KIND_SEAT || kcm.class !== 3) {
    throw new Error('k-cm 이 분류 3 자리 예약이 아니다 — 2026-08-24 실체 전환과 어긋난다');
  }
  if (SEAT_DEFAULT_FINDER['k-cm'] !== 'H2CO3') {
    throw new Error('k-cm 자리 예약 기본 파인더가 H2CO3 가 아니다 (계약 K-5 정본 발자국)');
  }
}

function printSection(title) {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(title);
  console.log('════════════════════════════════════════════════════════════════');
}

function printTable(rows) {
  if (rows.length === 0) {
    console.log('(없음)');
    return;
  }
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells) => cells.map((v, i) => String(v ?? '').padEnd(widths[i])).join('  ');
  console.log(line(cols));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(cols.map((c) => row[c])));
}

export function printFinderTaxonomy() {
  printSection('0. 유도 출처');
  console.log('module: src/finder-taxonomy.js');
  console.log('formal4:', FORMAL_IDS.join(', '));
  console.log('FINDER_PATTERNS:', FINDER_PATTERNS.length);
  console.log('OAK_FINDER_PATTERNS:', OAK_FINDER_PATTERNS.map((p) => p.id).join(', '));
  console.log('DAEHAN_FINDER_PATTERN_IDS:', [...DAEHAN_FINDER_PATTERN_IDS].join(', '));
  console.log('TAEGUK_ID:', TAEGUK_ID, 'SAGOAE_ID:', SAGOAE_ID);
  console.log('taegeuk === FINDER_CELL_ORDER 집합:', taegeukEqualsCentralSlot);
  console.log('GENERATOR_TYPES:', GENERATOR_TYPES.join(','));
  console.log('SEAT_DEFAULT_FINDER:', JSON.stringify(SEAT_DEFAULT_FINDER));
  console.log('daehanSplitHolds:', daehanSplitHolds());

  printSection('1. 전수 항목 (코드에서 유도)');
  printTable(FINDER_TAXONOMY.map((r) => ({
    id: r.id,
    class: r.class,
    kind: r.kind,
    coord: r.coordBasis,
    tone: r.toneAxis,
    render: String(r.renderable),
  })));

  printSection('2. 분류 1 — ' + FINDER_CLASS[1]);
  printTable(taxonomyByClass(1).map((r) => ({
    id: r.id, name: r.name, origin: r.origin, note: r.note,
  })));

  printSection('3. 분류 2 — ' + FINDER_CLASS[2]);
  printTable(taxonomyByClass(2).map((r) => ({
    id: r.id, name: r.name, kind: r.kind, split: r.innerSplit, note: r.note,
  })));

  printSection('4. 분류 3 — ' + FINDER_CLASS[3]);
  printTable(taxonomyByClass(3).map((r) => ({
    id: r.id, name: r.name, kind: r.kind, renderable: String(r.renderable), note: r.note,
  })));

  printSection('5. 와이어 합성 (원자 oak-daehan-k* — formatIndex 불변)');
  printTable(taxonomyByClass('W').map((r) => ({
    id: r.id, cells: r.cells, note: r.note,
  })));

  printSection('6. 미분류');
  printTable(taxonomyByClass('U').map((r) => ({
    id: r.id, name: r.name, kind: r.kind, origin: r.origin, note: r.note,
  })));

  printSection('7. 카운트');
  const byClass = {};
  for (const r of FINDER_TAXONOMY) {
    const k = String(r.class);
    byClass[k] = (byClass[k] || 0) + 1;
  }
  console.log(JSON.stringify(byClass));
  console.log('총 항목', FINDER_TAXONOMY.length);
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) printFinderTaxonomy();
