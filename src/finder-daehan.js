/**
 * finder-daehan.js — daehan 파인더의 **좌표·톤 정본** (2026-08-18 편입).
 *
 * ─ 왜 `finder-oak-patterns.js` 가 아니라 여기인가 ──────────────────────────
 * OAK 표는 「중앙 19셀 안에서만 사는 후보」의 표다 — 그 모듈 헤더가 daehan 을
 * **일부러 뺐고**, 그 이유를 «31셀 전체 표면이라 중앙 19만 떼면 다른 후보가 된다»
 * 라고 적어 뒀다. daehan(재설계본)은 79셀이고 **불스아이 19셀 밖으로 60셀을 더
 * 쓴다** — 즉 이 후보만이 유일하게 «용량을 깎는» 파인더다. 그 회계적 성질이 다른
 * 것을 같은 표에 넣으면 «19셀 안에 산다» 는 OAK 표의 불변식이 조용히 깨진다.
 * 그래서 표를 나눈다.
 *
 * ─ 정본과 유도 ───────────────────────────────────────────────────────────
 * 정본: 바깥 repo `.agent/decoder/data/daehan-k10.json`
 *       (schema `tlcube-cell-editor/v2` · 운영자 재설계 2026-08-18 · k=10 · 79셀).
 * repo 사본: `test/output/lanes/daehan-k10.json` (바이트 동일).
 * 유도 규약 (정본 `_note` · OAK 와 같다):
 *   · 좌표는 축 좌표 [q, r] — 여기서는 **정본 `userNonData` 등장 순서 그대로**.
 *   · 톤은 면별 override 이고, export 에 없는 면은 중간톤(1).
 *     ⚠ daehan 정본은 79×3 = 237 면이 **전부** override 를 든다 (정본
 *       `_transcriptionCheck.faceObservations` = 237). 즉 이 후보에서 중간톤
 *       규약은 한 번도 발동하지 않는다 — 표는 0/2 이진이다. 그래도 `cellLevels`
 *       표현을 쓴다: 검출기·렌더러가 `finderCells` 를 든 발자국을 `cellLevels`
 *       경로에서만 읽기 때문이고(`cell-finder-detect.js` normalizePatterns),
 *       표현이 갈리면 「그린 것과 읽는 것」이 어긋난다.
 *   · 여기 삼중은 [T, L, R].
 * 이 파일의 데이터 블록은 **손 전사가 아니다** —
 * `test/output/lanes/claude-di-gen-finder.mjs` 가 정본에서 기계로 찍었다.
 * 전수 대조: `test/finder-daehan.test.js`.
 *
 * ─ 해상도별 잘림 (운영자 확정) ────────────────────────────────────────────
 * **모든 해상도에서 이 절대 좌표를 그대로 쓴다.** 반경 k 밖의 셀은 잘린다 —
 * V1/V2 에서 사괘 일부가 없어져도 무방하다. A/K 타입의 외곽 영역으로는 넘어가지
 * 않는다(중앙 육각형 셀 영역 안에서만). 실측 잘림:
 *
 *   | k | 살아남는 파인더셀 | 그중 불스아이 | 예약(= data 잠식) |
 *   |---|---|---|---|
 *   | 6  | 39 | 19 | 20 |
 *   | 8  | 59 | 19 | 40 |
 *   | 10 | 79 | 19 | 60 |
 *
 * **그러므로 발자국이 해상도마다 다르다** — 검출 템플릿도 k 마다 따로 있어야 한다.
 * k=6 프레임에 79셀 템플릿을 대면 없는 40셀 자리에서 데이터 셀을 읽어 상관이
 * 망가진다 (실측: k=6 프레임에서 k8 템플릿 corr 0.9011). 그래서 id 를
 * `oak-daehan-k6 / -k8 / -k10` 셋으로 나눈다.
 *
 * ⚠ **그렇다고 patternId 가 k 를 말해 주지는 않는다.** 잘림은 포함 사슬
 *   (k6 ⊂ k8 ⊂ k10)이라 **k=8 프레임 위에서 k6 템플릿의 39셀은 전부 제 톤 위에
 *   앉는다** — 상관이 «정당하게» 1.000000 이고, k8 템플릿과 소수 6자리까지 같다
 *   (실측 `test/output/lanes/claude-di-nesting.mjs` §②). 게다가 `fit` 은
 *   contrastRatio 가 섞여 있어 작은 쪽이 **더 높게** 나오는 일까지 있다.
 *   즉 검출기는 «daehan 이다» 까지만 말할 수 있고 «어느 k 인가» 는 못 말한다.
 *   k 는 디코더가 전 후보를 열거해 **RS/CRC 로** 고른다 (`bootstrap.js`
 *   `cellFinderHypotheses` 주석). `daehanKForPatternId` 는 «그 템플릿이 어느
 *   잘림본인가» 를 돌려주는 표 조회일 뿐 프레임의 k 가 아니다.
 *
 * ⚠ `oak-daehan-k10` 이라는 id 는 직전 라운드들(radius10-search · reconcile 보고서 ·
 *   `claude-rc-minrepro.mjs`)이 이미 쓰고 있는 문자열이고, 그 79셀이 정확히 k=10
 *   잘림분이라 **의미가 바뀌지 않는다.** 바꾸면 그 측정들과의 대조가 끊긴다.
 *
 * 런타임 의존성 0 · 순수 ESM.
 */

import { hexDistance } from './hexgrid.js';
import { BULLSEYE_RADIUS } from './placement.js';
import { FINDER_CELL_ORDER } from './finder-patterns.js';

/** 정본 이름 — 와이어·명부·텔레메트리 키. 분류 층의 id 가 아니다. */
export const DAEHAN_NAME = 'daehan';

/**
 * 분류·표시 층 id (2026-08-21). 와이어 patternId (`oak-daehan-k6/k8/k10`) 와
 * formatIndex 는 그대로다 — 기존 발행 프레임이 그 문자열을 들고 있다.
 *
 *   taegeuk = 불스아이 안 19셀. 좌표 집합이 `FINDER_CELL_ORDER` 와 같다 (분류 1).
 *   sagoae  = `daehanReservedCells(k)` — 중심부 기준, 꼭짓점 상대 아님 (분류 2).
 */
export const TAEGUK_ID = 'taegeuk';
export const SAGOAE_ID = 'sagoae';

/** `cellLevels` 삼중의 면 순서 — 검출기·렌더러와 **같은 표**여야 한다. */
export const DAEHAN_LEVEL_FACE_INDEX = Object.freeze({ T: 0, L: 1, R: 2 });

/**
 * 79셀 좌표 — 정본 `userNonData` 등장 순서 그대로 (canonical order).
 *
 * ⚠ 순서를 «중앙 19 먼저» 로 바꾸고 싶은 유혹이 있다 (radius10-search 보고서 §0 이
 *   그 순서에서 참 자세 1.0000 을 냈다). **바꾸지 마라** — 그 값은 `scoreParams`
 *   발자국 누수(792c060 에서 수정)가 만든 착시였고, 누수를 고친 뒤에는 두 순서가
 *   **완전히 같은 값**을 낸다 (같은 보고서 §6.2 ⓒ=ⓓ). 정본 순서를 그대로 두는 쪽이
 *   정본↔코드 대조를 한 줄로 만든다.
 */
export const DAEHAN_FINDER_CELLS = Object.freeze([
  [-10, 3], [-10, 4], [-10, 5], [-10, 6], [-10, 7], [-8, 2],
  [-8, 3], [-8, 4], [-8, 5], [-8, 6], [-7, -3], [-6, -4],
  [-6, -2], [-6, 1], [-6, 2], [-6, 3], [-6, 4], [-6, 5],
  [-5, -5], [-5, -3], [-5, -1], [-4, -6], [-4, -4], [-4, -2],
  [-3, -7], [-3, -5], [-3, -3], [-2, -6], [-2, -4], [-2, 0],
  [-2, 1], [-2, 2], [-1, -5], [-1, -1], [-1, 0], [-1, 1],
  [-1, 2], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2],
  [1, -2], [1, -1], [1, 0], [1, 1], [1, 5], [2, -2],
  [2, -1], [2, 0], [2, 4], [2, 6], [3, 3], [3, 5],
  [3, 7], [4, 2], [4, 4], [4, 6], [5, 1], [5, 3],
  [5, 5], [6, -5], [6, -4], [6, -3], [6, -2], [6, -1],
  [6, 2], [6, 4], [7, 3], [8, -6], [8, -5], [8, -4],
  [8, -3], [8, -2], [10, -7], [10, -6], [10, -5], [10, -4],
  [10, -3],
].map(([q, r]) => Object.freeze({ q, r })));

/** 79셀의 면 톤 [T, L, R] — `DAEHAN_FINDER_CELLS` 와 **같은 순서**. */
export const DAEHAN_CELL_LEVELS = Object.freeze([
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  [0, 0, 0], [0, 0, 0], [2, 2, 2], [0, 0, 0], [0, 0, 0],
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [2, 0, 2],
  [2, 0, 0], [0, 0, 0], [0, 0, 0], [2, 2, 2], [2, 2, 2],
  [2, 0, 0], [0, 0, 0], [2, 2, 2], [2, 2, 2], [2, 2, 0],
  [0, 0, 0], [0, 0, 0], [2, 2, 2], [2, 2, 0], [0, 0, 0],
  [0, 0, 0], [0, 0, 0], [2, 2, 2], [2, 0, 0], [0, 0, 0],
  [0, 0, 0], [0, 0, 0], [2, 2, 2], [0, 0, 0], [0, 0, 0],
  [0, 0, 0], [2, 2, 2], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  [2, 2, 2], [0, 0, 0], [0, 0, 0], [2, 2, 2], [0, 0, 0],
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  [0, 0, 0], [2, 2, 2], [0, 0, 0], [0, 0, 0],
].map((triple) => Object.freeze([...triple])));

/** daehan 잘림 템플릿 반경 — 기존 O 버전과 같은 셋. 패턴 명부/디코더 후보는 이 셋이다. */
export const DAEHAN_RADII = Object.freeze([6, 8, 10]);

/** 79셀 정본이 완전히 들어오는 최소 반경. 그 이상은 모두 k10 완전판을 공유한다. */
export const DAEHAN_COMPLETE_RADIUS = 10;

function clipIndices(k) {
  const out = [];
  for (let i = 0; i < DAEHAN_FINDER_CELLS.length; i += 1) {
    const cell = DAEHAN_FINDER_CELLS[i];
    if (hexDistance(cell.q, cell.r) <= k) out.push(i);
  }
  return out;
}

function templateRadius(k) {
  if (!Number.isInteger(k)) {
    throw new RangeError('daehan 반경은 정수여야 한다: ' + k);
  }
  if (DAEHAN_RADII.includes(k)) return k;
  if (k > DAEHAN_COMPLETE_RADIUS) return DAEHAN_COMPLETE_RADIUS;
  throw new RangeError(
    'daehan 은 반경 6/8 또는 완전판이 들어오는 10 이상에서 정의된다: ' + k,
  );
}

const CLIPPED = new Map(DAEHAN_RADII.map((k) => {
  const idx = clipIndices(k);
  return [k, Object.freeze({
    cells: Object.freeze(idx.map((i) => DAEHAN_FINDER_CELLS[i])),
    levels: Object.freeze(idx.map((i) => DAEHAN_CELL_LEVELS[i])),
  })];
}));

/** 반경 k 에서 살아남는 파인더 셀 (잘림 적용). 39 / 59 / 79. */
export function daehanFinderCellsFor(k) {
  return CLIPPED.get(templateRadius(k)).cells;
}

/**
 * 반경 k 의 **예약 셀** = 살아남은 파인더 셀 중 불스아이 19셀 **밖**의 것.
 * 20 / 40 / 60. 이것이 `placement.buildRoleSets(k, reserved)` 에 넘길 목록이고
 * `overheadBreakdown(k, reserved.length)` 가 세는 수다.
 *
 * 불스아이 안쪽 19셀을 빼는 이유: 그 셀들은 **이미** 오버헤드로 세어져 있다
 * (`overheadBreakdown` 의 `bullseye` 항). 두 번 세면 회계가 19만큼 부풀고
 * `capacityFor` 가 NSYM 표와 어긋나 던진다.
 */
export function daehanReservedCells(k) {
  return daehanFinderCellsFor(k).filter((c) => hexDistance(c.q, c.r) > BULLSEYE_RADIUS);
}

/** 분류 1 — taegeuk 좌표. 정본 `DAEHAN_FINDER_CELLS` 등장 순서, 불스아이 안만. */
export function taegeukCells() {
  return DAEHAN_FINDER_CELLS.filter((c) => hexDistance(c.q, c.r) <= BULLSEYE_RADIUS);
}

/** taegeuk 면 톤 — `taegeukCells()` 와 같은 순서. */
export function taegeukLevels() {
  const out = [];
  for (let i = 0; i < DAEHAN_FINDER_CELLS.length; i += 1) {
    if (hexDistance(DAEHAN_FINDER_CELLS[i].q, DAEHAN_FINDER_CELLS[i].r) <= BULLSEYE_RADIUS) {
      out.push(DAEHAN_CELL_LEVELS[i]);
    }
  }
  return Object.freeze(out);
}

/** 분류 2 — sagoae 좌표. `daehanReservedCells` 의 공개 이름. */
export function sagoaeCells(k) {
  return daehanReservedCells(k);
}

/** sagoae 면 톤 — `sagoaeCells(k)` 와 같은 순서.
 *
 * 원자 daehan 패턴의 바깥 부분을 복사한 별도 표가 아니다. 같은 잘림 정본에서
 * 불스아이 밖 인덱스만 함께 고른다. 중앙 파인더와 sagoae 를 합성하는 장면은 이
 * 함수와 `sagoaeCells` 를 짝으로 써야 좌표·톤 순서가 갈리지 않는다.
 */
export function sagoaeLevels(k) {
  const clipped = CLIPPED.get(templateRadius(k));
  const out = [];
  for (let i = 0; i < clipped.cells.length; i += 1) {
    if (hexDistance(clipped.cells[i].q, clipped.cells[i].r) > BULLSEYE_RADIUS) {
      out.push(clipped.levels[i]);
    }
  }
  return Object.freeze(out);
}

/** 반경 k 의 파인더 패턴 id. */
export function daehanPatternId(k) {
  return 'oak-daehan-k' + templateRadius(k);
}

function definePattern(k) {
  const { cells, levels } = CLIPPED.get(k);
  return Object.freeze({
    id: daehanPatternId(k),
    name: DAEHAN_NAME,
    // 검출·렌더 경로를 기존 파인더와 **같게** 쓴다 (finder-oak-patterns.js 와 같은 이유:
    // renderKind 를 새로 만들면 scene.js·cell-finder-detect.js 양쪽에 분기가 하나씩
    // 더 생기고, 그 둘이 어긋나는 날 «그린 것과 읽는 것» 이 갈린다).
    renderKind: 'cell-mask',
    family: 'daehan',
    k,
    params: Object.freeze({
      // type: 'O' 은 **출처**(육각 코어에서 그린 후보)이지 타입 잠금이 아니다.
      // A 의 육각 코어는 O 와 좌표가 같고, 이 셀들은 패치에 0개다 (실측 2026-08-19).
      // 런타임 게이트는 이 필드가 아니라 encodeA/bootstrap/decode 배선이다.
      candidate: 'O-daehan-k10-fullsurface', type: 'O', finderStarter: 'bullseye',
    }),
    finderCells: cells,
    cellLevels: levels,
  });
}

/** k=6 / 8 / 10 의 daehan 검출 템플릿 (반경 오름차순). */
export const DAEHAN_FINDER_PATTERNS = Object.freeze(DAEHAN_RADII.map(definePattern));

export const DAEHAN_FINDER_PATTERN_IDS = Object.freeze(
  DAEHAN_FINDER_PATTERNS.map((pattern) => pattern.id),
);

const BY_ID = new Map(DAEHAN_FINDER_PATTERNS.map((pattern) => [pattern.id, pattern]));

/** daehan 패턴이면 그 패턴, 아니면 undefined — 호출자가 기존 조회로 넘어갈 수 있게. */
export function getDaehanFinderPattern(id) {
  return BY_ID.get(id);
}

export function isDaehanFinderPatternId(id) {
  return BY_ID.has(id);
}

/**
 * 파인더 patternId → **그 템플릿이 어느 잘림본인가** (아니면 undefined).
 *
 * ⚠ 이것은 «프레임의 k» 가 아니다. 포함 사슬 때문에 k=8 프레임을 `oak-daehan-k6`
 *   템플릿이 상관 1.000000 으로 맞춘다 (모듈 헤더 §잘림). 프레임의 k 를 정하는 것은
 *   RS/CRC 다. 디코더가 회계를 가를 때 쓰는 술어는 `isDaehanFinderPatternId` 이지
 *   이 함수가 아니다 — 이 함수는 렌더·테스트·진단용 표 조회다.
 */
export function daehanKForPatternId(id) {
  const pattern = BY_ID.get(id);
  return pattern ? pattern.k : undefined;
}

// ── 로드 자기검증 ──────────────────────────────────────────────────────────
// 표 주도 데이터는 조용히 썩는다 (finder-oak-patterns.js 전례). 모듈이 로드되는 것
// 자체가 아래 명제들의 통과를 뜻하게 만든다 — 회귀 파일을 안 돌려도 앱이 먼저 죽는다.
{
  const key = (c) => c.q + ',' + c.r;

  // ① 79셀 · 좌표 중복 없음 · 톤 표 길이 일치 · 레벨 값 0|1|2.
  if (DAEHAN_FINDER_CELLS.length !== 79) {
    throw new Error('daehan: 좌표가 79개가 아니다 — ' + DAEHAN_FINDER_CELLS.length);
  }
  if (DAEHAN_CELL_LEVELS.length !== DAEHAN_FINDER_CELLS.length) {
    throw new Error('daehan: 좌표 ' + DAEHAN_FINDER_CELLS.length
      + ' 과 톤 ' + DAEHAN_CELL_LEVELS.length + ' 의 길이가 다르다');
  }
  const seen = new Set();
  for (const cell of DAEHAN_FINDER_CELLS) {
    if (seen.has(key(cell))) throw new Error('daehan: 좌표 중복 ' + key(cell));
    seen.add(key(cell));
    if (hexDistance(cell.q, cell.r) > 10) {
      throw new Error('daehan: 반경 10 밖 좌표 ' + key(cell) + ' — 정본은 k=10 기준이다');
    }
  }
  for (const triple of DAEHAN_CELL_LEVELS) {
    if (triple.length !== 3) throw new Error('daehan: 톤 삼중이 아니다 ' + triple);
    for (const level of triple) {
      if (level !== 0 && level !== 1 && level !== 2) {
        throw new Error('daehan: 톤 레벨은 0|1|2 여야 한다: ' + level);
      }
    }
  }

  // ② 정본 `_transcriptionCheck` 의 독립 계수 — 면 관측 237 · 밝은 면 T18/L14/R13.
  //    손 전사가 아니라 기계 생성물이지만, 생성기를 다시 안 돌려도 여기서 썩는 걸 잡는다.
  const bright = { T: 0, L: 0, R: 0 };
  for (const triple of DAEHAN_CELL_LEVELS) {
    if (triple[DAEHAN_LEVEL_FACE_INDEX.T] === 2) bright.T += 1;
    if (triple[DAEHAN_LEVEL_FACE_INDEX.L] === 2) bright.L += 1;
    if (triple[DAEHAN_LEVEL_FACE_INDEX.R] === 2) bright.R += 1;
  }
  if (bright.T !== 18 || bright.L !== 14 || bright.R !== 13) {
    throw new Error('daehan: 밝은 면 계수가 정본과 다르다 — ' + JSON.stringify(bright)
      + ' (정본 T18/L14/R13)');
  }
  if (DAEHAN_CELL_LEVELS.length * 3 !== 237) {
    throw new Error('daehan: 면 관측이 237 이 아니다');
  }

  // ③ 톤이 균일하지 않다 — 균일하면 검출기의 centeredExpected 가 norm2 = 0 으로
  //    죽고, 거기서 죽으면 원인이 여기라는 걸 못 읽는다 (OAK 표 ③ 과 같은 가드).
  const tones = new Set(DAEHAN_CELL_LEVELS.flat());
  if (tones.size < 2) throw new Error('daehan: 면 톤이 균일하다 — 검출 불가');

  // ④ 해상도별 잘림이 운영자 확정 실측과 같다.
  const EXPECT = { 6: { alive: 39, reserved: 20 }, 8: { alive: 59, reserved: 40 },
    10: { alive: 79, reserved: 60 } };
  for (const k of DAEHAN_RADII) {
    const alive = daehanFinderCellsFor(k).length;
    const reserved = daehanReservedCells(k).length;
    if (alive !== EXPECT[k].alive || reserved !== EXPECT[k].reserved) {
      throw new Error('daehan k=' + k + ': 잘림 실측 불일치 — 살아남음 ' + alive
        + '(기대 ' + EXPECT[k].alive + ') · 예약 ' + reserved + '(기대 ' + EXPECT[k].reserved + ')');
    }
    // 예약 + 불스아이 19 = 살아남은 전부. 즉 «불스아이 밖» 판정에 빠진 셀이 없다.
    if (reserved + 19 !== alive) {
      throw new Error('daehan k=' + k + ': 예약 + 불스아이 19 != 살아남음');
    }
    if (sagoaeCells(k).length !== reserved) {
      throw new Error('sagoaeCells 가 daehanReservedCells 와 갈렸다 k=' + k);
    }
  }

  // ④b 완전판 포화 — Type C처럼 k>10인 프레임은 새 템플릿/새 그림이 아니라 k10
  // 79셀 정본을 중심 고정으로 그대로 쓴다. legacy DAEHAN_RADII는 늘리지 않는다.
  // 12 = V4D (평 O 대용량 개방 2026-08-30) · 14/17/20 = Type C.
  for (const k of [12, 14, 16, 18, 20]) {
    if (daehanFinderCellsFor(k).length !== 79 || daehanReservedCells(k).length !== 60) {
      throw new Error('daehan k=' + k + ': k10 완전판 79/예약60 포화가 성립하지 않는다');
    }
    if (sagoaeLevels(k).length !== 60 || daehanPatternId(k) !== daehanPatternId(10)) {
      throw new Error('daehan k=' + k + ': 좌표·톤·템플릿 id가 k10 완전판과 갈렸다');
    }
  }

  // ⑥ 분류 층: taegeuk 19셀 집합 = FINDER_CELL_ORDER. 순서는 정본 등장이라
  //    슬롯 순서와 달라도 된다 — 집합만 같다. 이게 깨지면 분류 1 슬롯이 다른 물건이다.
  const taegeuk = taegeukCells();
  if (taegeuk.length !== 19) {
    throw new Error('taegeuk 이 19셀이 아니다: ' + taegeuk.length);
  }
  if (taegeukLevels().length !== 19) {
    throw new Error('taegeukLevels 가 19가 아니다');
  }
  const taegeukSet = new Set(taegeuk.map(key));
  const slotSet = new Set(FINDER_CELL_ORDER.map(key));
  if (taegeukSet.size !== slotSet.size || [...taegeukSet].some((k) => !slotSet.has(k))) {
    throw new Error('taegeuk 좌표 집합이 FINDER_CELL_ORDER 와 다르다');
  }
  if (TAEGUK_ID === DAEHAN_NAME || SAGOAE_ID === DAEHAN_NAME) {
    throw new Error('분류 id 가 와이어 이름 daehan 과 같다 — 표시층이 안 갈렸다');
  }

  // ⑤ 잘림은 **포함 사슬**이다 — k=6 ⊂ k=8 ⊂ k=10. 아니면 «작은 코드가 큰 코드에
  //    없는 셀을 쓴다» 는 뜻이고 절대 좌표 규약이 깨진 것이다.
  for (let i = 1; i < DAEHAN_RADII.length; i += 1) {
    const smaller = new Set(daehanFinderCellsFor(DAEHAN_RADII[i - 1]).map(key));
    const larger = new Set(daehanFinderCellsFor(DAEHAN_RADII[i]).map(key));
    for (const kk of smaller) {
      if (!larger.has(kk)) {
        throw new Error('daehan: k=' + DAEHAN_RADII[i - 1] + ' 의 셀 ' + kk
          + ' 이 k=' + DAEHAN_RADII[i] + ' 에 없다 — 포함 사슬 위반');
      }
    }
  }
}
