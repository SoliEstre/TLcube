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
 * 운영자 확정 3분류 (2026-08-21):
 *   1 중앙 파인더 — 초기 4종 + 중앙 19셀 (taegeuk 포함)
 *   2 OAK 공통 육각 영역 내 셀 표면 파인더 — sagoae · o-cm
 *     내부 구분: 중심부 기준 / 꼭짓점 기준
 *   3 VAK 확장 영역 셀 표면 파인더 — H2O · H2CO3 · H · a-cm
 *     꼭짓점 기준 only
 *
 * ⚠ 2026-08-21 운영자 정정:
 *   H2O·H2CO3·H 는 «확장 영역만 쓰는 파인더»다. 중앙 19셀 슬롯이나 OAK 공통
 *   영역과 분리된 축이다. `finderStarter` 는 그 디자인이 **올라탄 기준선**일 뿐
 *   그 디자인의 내용이 아니다. 「H2O 가 중앙 3톤 큐브를 파인더로 갖는다」·
 *   「A-CM 이 H2O 의 중앙 파인더를 버렸다」는 오독이다.
 *
 *   CM 계열은 파인더가 아니라 «자리 예약». 그 자리에 들어가는 심볼이 기본
 *   파인더다 — Type A → H2O, Type G → H.
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
  markerCellsA, MARKER_CELL_COUNT_A,
  MARKER_LOCAL_DIGITS_A, H2O_LOCAL_TONES_A,
} from './markerA.js';
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
 * Type G → H 는 운영자 2026-08-21 — 코드에 디자인이 없다 (짓지 않는다).
 */
export const SEAT_DEFAULT_FINDER = Object.freeze({
  'a-cm': 'H2O',
  'o-cm': 'H',
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

  // O-CM — 자리 예약 (꼭짓점 기준). 기본 파인더는 H (디자인 없음).
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
        + (row.type === 'K' ? ' · Type K 인코더 없음 (GENERATOR_TYPES='
          + GENERATOR_TYPES.join(',') + ')' : ''),
    });
  }

  // H — Type G 자리의 기본 파인더. 코드 표에 없어서 자리 예약 표에서 유도.
  add({
    id: 'H',
    name: 'H',
    class: 3,
    className: FINDER_CLASS[3],
    kind: KIND_FINDER,
    origin: 'SEAT_DEFAULT_FINDER[o-cm] — 운영자 2026-08-21 Type G → H',
    renderPath: '없음 (새 디자인을 짓지 않는다)',
    coordBasis: COORD_VERTEX,
    innerSplit: '꼭짓점 기준',
    toneAxis: TONE_CELL_COLOR + ' (규약). 현행 무디자인',
    cells: '—',
    renderable: false,
    consumer: '없음. o-cm 이 이 자리를 예약만 한다',
    note: '확장 영역만 쓰는 파인더 슬롯. 중앙 19셀·OAK 공통 영역과 분리된 축',
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

  // v-cm / k-cm — 코드 정체 없음. 분류 3에 억지 배정하지 않음.
  add({
    id: 'v-cm',
    name: 'v-cm',
    class: 'U',
    className: FINDER_CLASS.U,
    kind: KIND_ABSENT,
    origin: '검색 대상. OAK_LINEUP/FINDER_PATTERNS/LAB_OUTER/GENERATOR_TYPES/markerG 에 없음',
    renderPath: '없음',
    coordBasis: '—',
    innerSplit: null,
    toneAxis: '—',
    cells: '—',
    renderable: false,
    consumer: '없음',
    note: '부재. Type Y 셀표면 로케이터(v0…)는 다른 축이라 여기 안 넣음',
  });
  add({
    id: 'k-cm',
    name: 'k-cm',
    class: 'U',
    className: FINDER_CLASS.U,
    kind: KIND_ABSENT,
    origin: '검색 대상. markerK.js 없음 · GENERATOR_TYPES 에 K 없음',
    renderPath: '없음',
    coordBasis: '—',
    innerSplit: null,
    toneAxis: '—',
    cells: '—',
    renderable: false,
    consumer: '없음',
    note: '부재. H2CO3 의 CM 승계가 코드에 없다',
  });

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
  if (!h || h.class !== 3 || h.kind !== KIND_FINDER) {
    throw new Error('H 가 분류 3 파인더 슬롯이 아니다');
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
  // v-cm / k-cm 은 미분류(부재) — 분류 3 억지 배정 금지
  if (taxonomyItem('v-cm').class !== 'U' || taxonomyItem('k-cm').class !== 'U') {
    throw new Error('v-cm/k-cm 이 미분류가 아니다');
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
