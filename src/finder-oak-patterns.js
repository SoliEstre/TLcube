/**
 * finder-oak-patterns.js — O/A/K 파인더 후보의 **렌더·검출 표현** (2026-08-18 편입).
 *
 * ─ 왜 `finder-patterns.js` 가 아니라 여기인가 ──────────────────────────────
 * `src/finder-patterns.js` 는 `tools/extract-finder-patterns.mjs` 의 **생성물**이고
 * 바이트 동일 회귀가 그걸 지킨다. 그 도구의 파이프라인은 `cellMasksToBits` ·
 * `bitsToCellMasks` · 6축 채점 하네스까지 전부 **이진 비트** 위에 서 있다.
 * OAK 후보는 그 탐색의 산출물이 아니라 **운영자 편집기 export** 이고 중간톤을
 * 쓰므로, 거기 끼워 넣는 것은 출처를 속이는 일이자 생성 도구를 통째로 뜯는 일이다.
 * 그래서 출처가 다른 표를 **출처가 다른 모듈**에 둔다.
 *
 * ─ 정본과 유도 ─────────────────────────────────────────────────────────────
 * 정본: 바깥 repo `.agent/decoder/data/finder-oak-candidates.json`
 *       (schema `tlcube-cell-editor/v2`, 운영자 제공 2026-08-15).
 * 유도 규약 (정본 `_note`):
 *   · 좌표는 축 좌표 [q,r] → `FINDER_CELL_ORDER` 순서로 정렬
 *   · 톤은 면별 override 이고, **export 에 없는 면은 중간톤(1)** 이다
 *   · 여기 삼중은 [T, L, R]
 * 재유도 스크립트: `test/output/lanes/claude-oak-derive-probe.mjs`.
 * 전사 검증: `test/finder-oak-patterns.test.js` 가 정본 JSON 이 있을 때 전수 대조하고,
 * 없으면 skip 하지 않고 **자기 일관성**(톤 분포 · 명부 대조)만으로 실패 가능하게 남긴다.
 *
 * ─ 왜 `cellLevels` 인가 ────────────────────────────────────────────────────
 * 세 후보 중 둘이 중간톤 면을 쓴다 — Nitrogen r2 5면 · Aspirin 2면. 면당 1비트인
 * `cellMasks` 로는 **표현 자체가 불가능**하다. 이진으로 반올림하면 그것은 다른
 * 후보이지 이 후보가 아니다. Benzene 은 이진이지만 같은 계열이라 같은 표현으로 둔다
 * (표현이 갈리면 «어느 쪽이 정본인가» 를 매번 되묻게 된다).
 *
 * ─ 여기 없는 후보와 그 이유 (드랍이 아니라 **미편입**) ──────────────────────
 *   · H2O (A) · H2CO3 (K) — override 가 전부 중앙 19셀 **밖**(코너 18 / 30셀)이다.
 *     중앙 19셀 격자 정합 검출기(cell-finder-detect.js)의 표현 범위 밖.
 *     ⚠ 2026-08-21: 둘은 확장 영역만 쓰는 파인더다. finderStarter 는 기준선이지
 *     중앙 3톤 큐브가 그 디자인의 내용인 것이 아니다.
 *   · daehan (O) — 31셀 **전체 표면**이다. 중앙 19만 떼면 다른 후보가 된다
 *     (margin 0.6452 는 31셀 표면에서 나온 값이다).
 *     2026-08-21 분류 층: 내부 19 = taegeuk, 밖 = sagoae. 와이어 id 는 원자 유지.
 *     ⚠ 2026-08-23: 그 «중앙 19만 뗀 것» 이 **별개 후보로** 편입됐다 — 아래
 *     `oak-taegeuk-solo` (PM/022 W2-taegeuk ①). daehan 미편입 사유와 모순이 아니다:
 *     daehan(합성)은 여전히 전용 모듈이고, taegeuk 단독은 19셀 안에 사는 **다른
 *     margin(0.6667)의 다른 후보**로서 이 표의 불변식(19셀)에 맞는다. 단 **렌더
 *     전용**이다 — 검출 라인업에 넣으면 daehan 프레임을 가로챈다
 *     (`OAK_RENDER_ONLY_FINDER_PATTERNS` 헤더의 실측 · 검출 편입은 통합자 몫).
 *   · Nitrogen (dead) · Xylene (dropped) — 명부의 지위가 그렇다. 차단이지 삭제가
 *     아니므로 명부(`finder-oak-lineup.js`)에는 남아 있고 여기에만 없다.
 *
 * 이 모듈은 명부와 **다른 것**을 든다: 명부는 «어느 후보가 유망한가»(margin·지위),
 * 이 표는 «그 후보가 정확히 무엇인가»(셀 톤). 둘의 교집합은 아래 자기검증이 잡는다.
 */

import { FINDER_CELL_ORDER } from './finder-patterns.js';
import { OAK_LINEUP } from './finder-oak-lineup.js';
import { FOOTPRINT_NAME, FOOTPRINT_CELL_LEVELS } from './finder-footprint.js';
import { taegeukCells, taegeukLevels } from './finder-daehan.js';

/** `cellLevels` 삼중의 면 순서 — 검출기·렌더러와 **같은 표**여야 한다. */
export const OAK_LEVEL_FACE_INDEX = Object.freeze({ T: 0, L: 1, R: 2 });

function defineOakPattern(pattern) {
  if (!Array.isArray(pattern.cellLevels)
      || pattern.cellLevels.length !== FINDER_CELL_ORDER.length) {
    throw new RangeError(pattern.id + ': cellLevels 는 '
      + FINDER_CELL_ORDER.length + '개여야 한다');
  }
  for (const triple of pattern.cellLevels) {
    if (!Array.isArray(triple) || triple.length !== 3) {
      throw new RangeError(pattern.id + ': cellLevels 항목은 [T,L,R] 삼중이어야 한다');
    }
    for (const level of triple) {
      if (level !== 0 && level !== 1 && level !== 2) {
        throw new RangeError(pattern.id + ': 톤 레벨은 0|1|2 여야 한다: ' + level);
      }
    }
  }
  if (pattern.cellMasks !== undefined) {
    throw new RangeError(pattern.id + ': OAK 후보는 cellMasks 를 함께 들면 안 된다'
      + ' — 이진 근사가 정본 행세를 하게 된다');
  }
  return Object.freeze({
    ...pattern,
    // 검출·렌더 경로를 기존 19셀 파인더와 **같게** 쓴다. renderKind 를 새로 만들면
    // scene.js·cell-finder-detect.js 양쪽에 분기가 하나씩 더 생기고, 그 둘이
    // 어긋나는 날 «그린 것과 읽는 것» 이 갈린다.
    renderKind: 'cell-mask',
    family: 'oak',
    params: Object.freeze({ ...pattern.params }),
    cellLevels: Object.freeze(pattern.cellLevels.map((triple) => Object.freeze([...triple]))),
  });
}

/**
 * taegeuk 단독의 슬롯 순 cellLevels — **유도**다 (값 복사 금지, 사본 목록은 썩는다).
 *
 * 정본은 `finder-daehan.js` 의 `taegeukCells()`/`taegeukLevels()` (daehan k10 정본의
 * 불스아이 안 19셀 — 그 좌표 집합이 `FINDER_CELL_ORDER` 와 같다는 것은 그 모듈의
 * 로드 자기검증 ⑥ 이 잠근다). 단 **순서가 다르다** — taegeukCells 는 daehan 정본
 * 등장 순서이고 이 표는 슬롯 순서여야 하므로, 좌표 키로 재배열한다. 재배열이
 * 19/19 전부를 찾는지 여기서 다시 던져 잠근다.
 */
function taegeukSlotCellLevels() {
  const cells = taegeukCells();
  const levels = taegeukLevels();
  const byKey = new Map(cells.map((cell, i) => [cell.q + ',' + cell.r, levels[i]]));
  return FINDER_CELL_ORDER.map((cell) => {
    const triple = byKey.get(cell.q + ',' + cell.r);
    if (!triple) {
      throw new Error('taegeuk 유도: 슬롯 좌표 ' + cell.q + ',' + cell.r
        + ' 가 taegeukCells 에 없다 — daehan 정본이 바뀌었나');
    }
    return [...triple];
  });
}

export const OAK_FINDER_PATTERNS = Object.freeze([
  defineOakPattern({
    id: 'oak-nitrogen-r2',
    // **정식 표시명 = Niteogen** (운영자 확정 2026-08-18). `lineupName` 은 그대로
    // 'Nitrogen r2' 다 — 그건 표시가 아니라 **정본 JSON 의 조회 키**이고, 정본을
    // 안 건드린 채 이름만 바꾸면 대조가 끊긴다. id 도 안 바꾼다: 이미 라이브에
    // 나갔고(09532c8) 저장된 선택·URL·텔레메트리가 그 문자열을 들고 있다.
    name: 'Niteogen',
    lineupName: 'Nitrogen r2',
    params: { candidate: 'O-1r2-central3tone', type: 'O', finderStarter: 'central-cube-3tone' },
    cellLevels: [
      [2, 0, 2], [2, 2, 2], [2, 0, 2], [2, 2, 0], [2, 0, 2], [1, 0, 1], [0, 2, 2],
      [0, 2, 2], [0, 2, 2], [2, 1, 0], [1, 1, 0], [2, 2, 0], [0, 2, 2], [0, 0, 0],
      [0, 0, 0], [2, 2, 2], [0, 2, 2], [2, 0, 2], [2, 2, 0],
    ],
  }),
  defineOakPattern({
    id: 'oak-aspirin',
    name: 'Aspirin',
    lineupName: 'Aspirin',
    params: { candidate: 'O-2-central3tone', type: 'O', finderStarter: 'central-cube-3tone' },
    cellLevels: [
      [2, 2, 2], [2, 2, 2], [0, 2, 2], [2, 2, 0], [2, 0, 2], [0, 2, 2], [2, 2, 2],
      [2, 2, 2], [0, 2, 2], [2, 1, 0], [2, 2, 2], [0, 2, 2], [2, 2, 2], [2, 0, 2],
      [2, 2, 2], [2, 1, 2], [2, 0, 2], [2, 2, 2], [2, 0, 2],
    ],
  }),
  defineOakPattern({
    id: 'oak-benzene',
    name: 'Benzene',
    lineupName: 'Benzene',
    params: { candidate: 'O-3-bullseye', type: 'O', finderStarter: 'cube-bullseye' },
    cellLevels: [
      [2, 2, 0], [0, 2, 2], [2, 2, 2], [2, 2, 2], [2, 0, 2], [2, 2, 0], [0, 2, 2],
      [2, 2, 0], [2, 0, 2], [0, 2, 2], [2, 0, 2], [2, 2, 2], [0, 2, 2], [2, 2, 0],
      [2, 2, 0], [0, 2, 2], [2, 0, 2], [2, 2, 2], [2, 0, 2],
    ],
  }),
  // ── Wave 2 신규 후보 (2026-08-23 편입 — PM/022 W2 선행) ───────────────────
  defineOakPattern({
    id: 'oak-footprint',
    // 정본: finder-footprint-2026-08-23.json (운영자 셀 편집기 신작). 표는
    // finder-footprint.js 가 든다 — 여기서는 유도 import 만 한다.
    name: FOOTPRINT_NAME,
    lineupName: FOOTPRINT_NAME,
    params: { candidate: 'O-footprint-fullsurface', type: 'O', finderStarter: 'cube-bullseye' },
    cellLevels: FOOTPRINT_CELL_LEVELS.map((triple) => [...triple]),
  }),
]);

/**
 * **렌더 전용** OAK 후보 — 카드·편집기·장면에는 있고 **기본 검출 라인업에는 없다**.
 *
 * 왜 갈랐나 (2026-08-23 실측): `OAK_FINDER_PATTERNS` 는 bootstrap.js 의
 * `CELL_FINDER_LINEUP` 이 스프레드로 유도한다 — 이 표에 넣는 것 = 검출 편입이다.
 * 그런데 taegeuk 단독의 19셀은 **모든 daehan 잘림본(k6/k8/k10)의 진부분집합이고
 * 톤까지 같다.** daehan 프레임의 중앙 19 위에서 이 템플릿은 정당하게 상관 1.0 이고,
 * `fit` 은 contrastRatio 가 섞여 작은 발자국이 더 높게 나오는 일까지 있어서
 * (finder-daehan.js §포함 사슬), 검출 라인업에 넣는 순간 **daehan 옵트인 왕복이
 * taegeuk-solo 오수용으로 죽는다** (test/finder-daehan.test.js ⑤·⑥·⑦ 실측 —
 * «k=6 오수용: oak-taegeuk-solo»). 검출은 원리적으로 daehan/taegeuk-solo 를 못
 * 가르고 RS/CRC 가설 열거가 갈라야 하므로, 그 배선은 오수용·margin 게이트 실측과
 * 함께 통합자 몫이다 (daehan 이 옵트인 상수로 갈라져 있는 것과 같은 전례).
 * 그날이 오면 이 목록에서 `OAK_FINDER_PATTERNS` 로 옮기는 것이 승격이다.
 */
export const OAK_RENDER_ONLY_FINDER_PATTERNS = Object.freeze([
  defineOakPattern({
    id: 'oak-taegeuk-solo',
    // **표시명 = taegeuk** (운영자 확정). 분류 층 id `taegeuk`(finder-daehan.TAEGUK_ID)
    // 와 같은 문자열이지만 다른 표다 — 그쪽은 daehan 합성의 «내부 19» 분류 라벨이고,
    // 이쪽은 sagoae 예약셀 없이 19셀만 쓰는 **독립 렌더 후보**다
    // (용량·와이어·formatIndex 변경 0 — daehanFinder 회계를 타지 않는다).
    name: 'taegeuk',
    lineupName: 'taegeuk-solo',
    params: { candidate: 'O-taegeuk-solo', type: 'O', finderStarter: 'bullseye' },
    cellLevels: taegeukSlotCellLevels(),
  }),
]);

/** 렌더 표현이 있는 OAK 후보 전부 — 카드·편집기·분류 층의 유도 원천. */
export const OAK_ALL_FINDER_PATTERNS = Object.freeze([
  ...OAK_FINDER_PATTERNS,
  ...OAK_RENDER_ONLY_FINDER_PATTERNS,
]);

export const OAK_FINDER_PATTERN_IDS = Object.freeze(
  OAK_FINDER_PATTERNS.map((pattern) => pattern.id),
);

// 조회는 **렌더 표현 전부**를 커버한다 — scene.js·편집기·점수 패널이 이 조회로
// 그린다. 검출 라인업은 이 Map 이 아니라 `OAK_FINDER_PATTERNS` 배열이 정한다.
const OAK_BY_ID = new Map(OAK_ALL_FINDER_PATTERNS.map((pattern) => [pattern.id, pattern]));

/** OAK 후보(렌더 전용 포함)면 그 패턴, 아니면 undefined — 호출자가 기존 조회로 넘어갈 수 있게. */
export function getOakFinderPattern(id) {
  return OAK_BY_ID.get(id);
}

export function isOakFinderPatternId(id) {
  return OAK_BY_ID.has(id);
}

/**
 * 명부 후보가 **실제로 그려지는가** — `status` 가 대답하지 못하는 물음.
 *
 * `status: 'active'` 는 「탈락하지 않았다」이지 「구현됐다」가 아니다. 그런데 margin 순으로
 * 정렬하면 1위가 H2O(0.6667)·3위가 H2CO3(0.4667)이고 **둘 다 그릴 수 없다** — 그 사실이
 * 명부 표 어디에도 안 적혀 있어서, 운영자가 생성기에서 고르고 «렌더링이 안 된다» 를 보고
 * 나서야 드러났다 (2026-08-20).
 *
 * 그래서 **손으로 적지 않고 유도한다.** 사본 목록은 반드시 원본과 어긋난다.
 *   · `oak-*` 패턴표에 있으면 → 이 모듈이 그린다
 *   · daehan → 전용 모듈(`finder-daehan.js`)이 그린다
 *   · 그 외 → **못 그린다**
 *
 * ⚠ H2O·H2CO3 가 못 그려지는 이유는 «기하» 가 아니다. 발자국은 `markerA.js` 에 이미
 *   있다(꼭짓점에서 (−1,+2) 2칸 안쪽 링 3개, 21셀). 못 그리는 것은 **톤**이다 —
 *   정본 톤이 21셀 중 9셀(H2CO3 는 30 중 18)이 **비-순열**이라 `digitToRanks` 경로가
 *   표현하지 못한다. 채택은 렌더러 계약 변경이고 운영자 결정 사항이다.
 */
export function oakRenderStatus(lineupName) {
  const entry = OAK_LINEUP.find((row) => row.name === lineupName);
  if (!entry) return null;
  if (OAK_ALL_FINDER_PATTERNS.some((pattern) => pattern.lineupName === lineupName)) {
    return 'oak-pattern-table';
  }
  if (entry.id === 'O-daehan') return 'daehan-module';
  return 'not-renderable';
}

/** 명부 전체의 «그릴 수 있는가» 요약 — 진단·문서용. */
export function oakRenderSummary() {
  return OAK_LINEUP.map((row) => Object.freeze({
    name: row.name,
    status: row.status,
    margin: row.margin,
    render: oakRenderStatus(row.name),
  }));
}

// ── 로드 자기검증 ──────────────────────────────────────────────────────────
// 표 주도 데이터는 조용히 썩는다 (turnA.js 전례). 모듈이 로드되는 것 자체가
// 아래 명제들의 통과를 뜻하게 만든다 — 회귀 파일을 안 돌려도 앱이 먼저 죽는다.
{
  const ids = new Set();
  for (const pattern of OAK_ALL_FINDER_PATTERNS) {
    if (ids.has(pattern.id)) throw new Error('OAK 후보 id 중복: ' + pattern.id);
    ids.add(pattern.id);
  }

  // ① 명부(finder-oak-lineup)에 **활성**으로 있는 후보만 여기 있다. 지위가 dead /
  //    dropped 인 것을 렌더·검출에 올리면 «차단인데 살아 있는» 상태가 된다.
  for (const pattern of OAK_ALL_FINDER_PATTERNS) {
    const entry = OAK_LINEUP.find((row) => row.name === pattern.lineupName);
    if (!entry) {
      throw new Error(pattern.id + ': 명부에 없는 후보다 (lineupName=' + pattern.lineupName + ')');
    }
    if (entry.status !== 'active') {
      throw new Error(pattern.id + ': 명부 지위가 ' + entry.status + ' 인데 표현이 있다');
    }
    if (entry.type !== 'O') {
      throw new Error(pattern.id + ': 지금 표현 가능한 것은 타입 O 뿐이다 (' + entry.type + ')');
    }
  }

  // ② 중간톤을 쓰는 후보가 **실제로 있다**. 이게 0 이 되면 cellLevels 를 도입한
  //    근거 자체가 사라진 것이므로, 표현을 되돌릴지 다시 판단해야 한다.
  const midFaces = OAK_ALL_FINDER_PATTERNS.map((pattern) => pattern.cellLevels
    .reduce((sum, triple) => sum + triple.filter((level) => level === 1).length, 0));
  if (midFaces.reduce((a, b) => a + b, 0) === 0) {
    throw new Error('OAK 후보 어느 것도 중간톤을 안 쓴다 — cellLevels 의 존재 이유가 없다');
  }

  // ③ 어느 후보도 **한 톤으로 균일하지 않다**. 균일하면 검출기의 centeredExpected 가
  //    norm2 = 0 으로 죽는다 (거기서 죽으면 원인이 여기라는 걸 못 읽는다).
  for (const pattern of OAK_ALL_FINDER_PATTERNS) {
    const seen = new Set(pattern.cellLevels.flat());
    if (seen.size < 2) throw new Error(pattern.id + ': 면 톤이 균일하다 — 검출 불가');
  }

  // ④ 렌더 전용 후보는 **검출 표에 없다** — 이 분리가 무너지면 daehan 옵트인 왕복이
  //    부분집합 오수용으로 죽는다 (OAK_RENDER_ONLY_FINDER_PATTERNS 헤더의 실측).
  //    승격은 이동이지 복사가 아니다: 두 표에 같이 있으면 여기서 죽는다.
  const detectable = new Set(OAK_FINDER_PATTERNS.map((pattern) => pattern.id));
  for (const pattern of OAK_RENDER_ONLY_FINDER_PATTERNS) {
    if (detectable.has(pattern.id)) {
      throw new Error(pattern.id + ': 렌더 전용 후보가 검출 표에도 있다 — 승격은 이동이다');
    }
  }
}
