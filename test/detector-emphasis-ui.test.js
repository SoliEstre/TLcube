/**
 * detector-emphasis-ui.test.js — 「검출기 강조」 UI 정직 개편의 계약
 * (운영자 결정 ⑭ 2026-09-06 · PM/029B §27.14 (A)).
 *
 * ⚠ **머리말 정정 (2026-09-07, (B) 실체 확장)**: 아래 「라이브러리·와이어는 한 줄도
 *   안 바뀌었다」는 (A) 라운드 시점의 사실이고 **지금은 거짓**이다. (B) 가 렌더를
 *   바꿨다 — 적용 대상이 renderKind 유도로 넓어졌고(중앙 M7 편입), 대상 검출기에서는
 *   바깥 코드 셀까지 같은 팔레트 치환을 받는다. 그 축의 자는
 *   `test/detector-emphasis-cells.test.js` 다. 여기서 여전히 안 바뀐 것은 **3택
 *   폐쇄집합·라이브러리 기본값·lab 기대 축** 셋이다.
 *
 * 무엇이 바뀌었나 ((A) 라운드 기준):
 *   라이브러리 3택(CENTRAL_N7_EMPHASIS_MODES) · 기본값(GENERATOR_DEFAULT_…='all') ·
 *   lab 기대 축 ④ · relay 폐쇄집합은 그대로. 바뀐 것은 생성기 UI 의 «모양과 정직함» 뿐:
 *     ① 제목이 «중앙 강조색» → «검출기 강조» (중앙 전제 제거)
 *     ② 일반 모드 카드는 기본/강조 두 장, «로케이터만» 은 고급 전용
 *     ③ 섹션이 **사라지지 않는다** — 대상이 아니면 비활성 + 사유 한 줄
 *
 * ⚠ **이 자는 소스 철자를 안 잰다** (2026-09-06 리뷰 F3·F9·F10 교정). 종전판은
 *   index.html 정규식 11개였고, 그래서 가시성 게이트를 지워도(카드 상시 노출),
 *   키보드 가드를 주석 처리해도(비대상에서 Enter 로 상태 변경), 사유 노트의
 *   `textContent` 배선을 지워도(요소는 보이는데 빈 줄) 전부 초록이었다 — 실측
 *   변이 m3·m4·M4·M8. 결정 로직이 순수 모형(`emphasisSectionModel`)으로 나왔으므로
 *   이제 **모형의 표**를 (타입 × 검출기 × 모드 × 고급노출) 격자로 잰다.
 *   index.html 에 남는 정규식은 «모형을 소비하는가» 라는 **배선 확인**뿐이다.
 *
 * 재는 것:
 *   ① 사유가 **renderKind/톤 축에서 유도**되는가 — 그리는 쪽(scene.js) · 분류 정본
 *      (finder-taxonomy) 과 **다른 출처로** 대조한다.
 *   ② 모형의 표 — 편집 가능 · 카드 가시성 진리표 · 비활성 · 앵커 · 노트 키 총함수.
 *   ③ 마크업이 폐쇄집합·기본값·고급 표식을 **모형에서 유도**하는가.
 *   ④ 사유 문구가 폐쇄집합 전부 × 8언어에 있고, «중앙» 전제·반말이 없는가.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DETECTOR_EMPHASIS_REASONS,
  centralN7EmphasisAppliesTo,
  detectorEmphasisApplicability,
  detectorEmphasisRequiresAdvanced,
} from '../src/generator-render-config.js';
import {
  ADVANCED_ONLY_EMPHASIS_MODES,
  DETECTOR_EMPHASIS_ADVANCED_DETECTOR_KEY,
  DETECTOR_EMPHASIS_ADVANCED_HIDDEN_KEY,
  DETECTOR_EMPHASIS_MARKER_SCOPE_KEY,
  DETECTOR_EMPHASIS_REASON_KEYS,
  emphasisSectionModel,
  hasCentralFinderAxis,
} from '../src/detector-emphasis-ui-model.js';
import { cornerMarkerSeatActive } from '../src/finder-zone-ui.js';
import {
  CENTRAL_N7_EMPHASIS_MODES, GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS,
} from '../src/centralN7Emphasis.js';
import { GENERATOR_TYPES } from '../src/generator-types.js';
import {
  FINDER_PATTERNS, FINDER_PATTERN_IDS, THREE_TONE_CUBE_FINDER_PATTERN_ID,
} from '../src/finder-patterns.js';
import { OAK_ALL_FINDER_PATTERNS } from '../src/finder-oak-patterns.js';
import { DAEHAN_FINDER_PATTERN_IDS } from '../src/finder-daehan.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';
import {
  OUT_OF_TABLE_FINDER_RENDER_KINDS, finderRenderKindOf,
} from '../src/finder-render-kind.js';
import { resolveFinderRenderPattern } from '../src/scene.js';
import {
  LOCATOR_PROFILES_Y, isCellSurfaceLocatorProfileY,
} from '../src/locatorY.js';
import { FINDER_TAXONOMY, TONE_FINDER_BWG } from '../src/finder-taxonomy.js';
import { SUPPORTED_LANGUAGES } from '../src/i18n.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

/**
 * 판정이 답해야 하는 **전수** — 「렌더가 실제로 풀 수 있는 finderPatternId」.
 *
 * 손 목록이 아니라 렌더 표들의 합집합이다. ⚠ 표 밖 중앙 id 도 **리터럴로 안 적는다**
 * (2026-09-06 F5) — `OUT_OF_TABLE_FINDER_RENDER_KINDS` 의 키가 그 정본이고, 새 표 밖
 * id 가 생기면 이 전수가 자동으로 그것을 포함한다.
 */
const RENDER_REACHABLE_IDS = Object.freeze([...new Set([
  ...FINDER_PATTERN_IDS,
  ...OAK_ALL_FINDER_PATTERNS.map((pattern) => pattern.id),
  ...DAEHAN_FINDER_PATTERN_IDS,
  ...Object.keys(OUT_OF_TABLE_FINDER_RENDER_KINDS),
])]);

/** id 로 시작하는 요소의 바깥 HTML 을 태그 깊이로 잘라 낸다. */
function outerHtmlById(html, id) {
  const at = html.indexOf(`id="${id}"`);
  assert.ok(at >= 0, `${id} 를 못 찾았다`);
  const start = html.lastIndexOf('<', at);
  let depth = 0;
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g;
  tagRe.lastIndex = start;
  let m;
  while ((m = tagRe.exec(html))) {
    const [, closing, tag, selfClose] = m;
    if (selfClose || ['br', 'img', 'input', 'hr', 'meta', 'link'].includes(tag)) continue;
    depth += closing ? -1 : 1;
    if (depth === 0) return html.slice(start, tagRe.lastIndex);
  }
  throw new Error(`${id} 가 닫히지 않는다`);
}

/** `const NAME = ...{ … }` 의 첫 객체 리터럴을 중괄호 깊이로 떠 온다. */
function objectLiteralAfter(source, declaration) {
  const declarationAt = source.indexOf(declaration);
  assert.ok(declarationAt >= 0, '선언을 찾지 못했다: ' + declaration);
  const open = source.indexOf('{', declarationAt + declaration.length);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error('객체 끝을 찾지 못했다: ' + declaration);
}

const SECTION_HTML = outerHtmlById(INDEX, 'centralN7EmphasisSection');
const GENERATOR_STRINGS = Function(
  '"use strict"; return (' + objectLiteralAfter(INDEX, 'const GENERATOR_STRINGS =') + ');',
)();

/** 모형을 부르는 얇은 헬퍼 — 상태를 매번 손으로 적지 않는다. */
function modelOf({
  type = 'O', finderPatternId = CENTRAL_N7_FINDER_PATTERN_ID,
  locatorProfileY = 'off', centralN7Emphasis = GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS,
  advancedCardsVisible = true,
  // 검출기 seat 축 (2026-09-07 emph-centerqr) — 기본은 «마커 없음» 이라, 이 인자를
  // 안 주는 기존 격자는 종전과 같은 자리를 계속 잰다.
  innerSeat = 'none', outerSeat = 'none', turnA = false,
} = {}) {
  return emphasisSectionModel(
    {
      type, finderPatternId, locatorProfileY, centralN7Emphasis,
      innerSeat, outerSeat, turnA,
    },
    { advancedCardsVisible },
  );
}

/** 이 타입에서 마커를 실제로 켜는 seat 조합 — 술어 정본이 참인 값을 쓴다. */
const MARKER_SEAT_BY_TYPE = Object.freeze({
  O: { innerSeat: 'o-cm' },
  A: { outerSeat: 'a-cm' },
  K: { outerSeat: 'k-cm' },
});

// ── ① 적용 여부와 사유는 렌더 축에서 유도된다 ────────────────────────────

test('① 그리는 쪽과 분류하는 쪽이 같은 답을 낸다 — 사본이 다시 생기면 여기서 갈린다', () => {
  // scene.js `resolveFinderRenderPattern` 은 그리려고, `finderRenderKindOf` 는
  // 분류하려고 같은 질문을 한다. 종전엔 두 벌의 손 사본이라 한쪽만 늙어도 아무 자가
  // 안 죽었다 (2026-09-06 F4 실측: LEGACY 의 renderKind 를 바꿔도 스위트 전부 초록).
  //
  // ⚠ **이 자가 못 지키는 축을 적어 둔다** (정직성). 사본을 없앤 지금 둘은 같은 표를
  //   읽으므로, 그 **한 출처의 값이 틀린** 경우는 여기서 안 잡힌다 — 같이 틀리기
  //   때문이다. 그 축을 덮는 것은 실제 렌더다: 표의 renderKind 가 scene 의 분기와
  //   어긋나면 그림이 달라지고, test/central-emphasis-roundtrip.test.js ·
  //   test/finder-patterns*.test.js 의 왕복·픽셀 자가 그것을 본다. 여기가 잡는 것은
  //   «두 소비자가 다시 갈라지는 것» 하나다.
  for (const id of RENDER_REACHABLE_IDS) {
    const drawn = resolveFinderRenderPattern(id).renderKind;
    assert.equal(finderRenderKindOf(id), drawn,
      `${id}: 그리는 쪽(${drawn})과 분류하는 쪽(${finderRenderKindOf(id)})이 갈렸다`);
  }
  // 표 밖 id 도 전수에 들어와 있어야 한다 — 신설 id 가 조용히 미측정이 되는 자리.
  for (const id of Object.keys(OUT_OF_TABLE_FINDER_RENDER_KINDS)) {
    assert.ok(RENDER_REACHABLE_IDS.includes(id), `표 밖 id ${id} 가 전수에 없다`);
  }
});

test('① applicability 는 전수에 대해 총함수이고 applies 는 정본 술어와 같다', () => {
  for (const id of RENDER_REACHABLE_IDS) {
    const verdict = detectorEmphasisApplicability(id);
    assert.equal(typeof verdict.applies, 'boolean', id);
    assert.equal(verdict.applies, centralN7EmphasisAppliesTo(id),
      `${id}: 두 술어가 갈렸다 — centralN7EmphasisAppliesTo 는 applies 의 이름이어야 한다`);
    if (verdict.applies) {
      assert.equal(verdict.reason, null, `${id}: 적용 대상인데 사유가 붙었다`);
    } else {
      assert.ok(DETECTOR_EMPHASIS_REASONS.includes(verdict.reason),
        `${id}: 폐쇄집합 밖 사유 ${JSON.stringify(verdict.reason)}`);
    }
  }
  /*
   * 적용 대상 집합 — **손 목록으로 잠그지 않는다** (2026-09-07 (B) 갱신).
   *
   * 종전판은 `[중앙 TL, 중앙 Y0]` 리터럴이었다. (A) 라운드에서는 그게 «값 표가 안
   * 바뀌었다» 를 잠그는 옳은 자였지만, 집합이 실제로 넓어지는 라운드가 오면 그 자는
   * **정답을 거부하고** 손으로 고쳐질 뿐이다 (교훈 «레인은 내 잘못된 지시를 자로
   * 굳힌다»). 그래서 «무엇이 들어 있나» 가 아니라 «어떤 성질이면 들어오나» 를 잰다.
   *
   * ⚠ **이 대조는 «선언 대 선언» 이다** (2026-09-07 검토 F4 — 정직하게 적어 둔다).
   *   구현은 renderKind(= DETECTOR_EMPHASIS_RENDER_KINDS)에서 유도하고, 여기서는
   *   운영자 3분류 정본(finder-taxonomy)의 `toneAxis` **산문에 `palette.levels` 가
   *   들어 있는가**로 다시 잰다. 한쪽만 늙으면 여기서 죽지만 **둘을 같이 넓히면
   *   통과한다** — 실측 변이 N9b(집합에 `bullseye` 를 넣고 그 행 산문에도
   *   `palette.levels` 를 덧붙임)가 형제 7파일 54/54 초록이었다. 산문 부분문자열은
   *   뜻이 아니라 철자라 「(palette.levels 아님)」을 붙여도 매칭된다(변이 N8).
   *
   *   **행동 앵커는 다른 파일에 있다**: `test/detector-emphasis-cells.test.js` ⓐ 가
   *   강조 상수를 한 번도 안 읽는 **독립 프로브**(levels 세 색만 바꾼 두 팔레트에서
   *   검출기 자신의 그림이 움직이는가)로 같은 집합을 재고, 비대상 전수 × 3택의
   *   셰이프·래스터 동일까지 잠근다. N9b 는 이제 그쪽에서 죽는다 — 여기가 잡는 것은
   *   «두 선언이 갈라지는 것» 하나로 한정된다.
   */
  const applying = RENDER_REACHABLE_IDS.filter(
    (id) => detectorEmphasisApplicability(id).applies,
  ).sort();
  const toneById = new Map(FINDER_TAXONOMY.map((item) => [item.id, item.toneAxis]));
  for (const id of applying) {
    assert.ok(toneById.has(id),
      `${id}: 적용 대상인데 분류 정본(finder-taxonomy)에 행이 없다 — 대조가 못 닿는다`);
  }
  const byTaxonomy = RENDER_REACHABLE_IDS
    .filter((id) => (toneById.get(id) || '').includes('palette.levels')).sort();
  assert.deepEqual(applying, byTaxonomy,
    '적용 대상이 분류 정본의 palette.levels 축 행과 어긋난다');
  assert.ok(applying.length >= 3, '적용 대상 표본이 줄었다 — 대조가 빈 집합으로 초록이 됐다');
  // 결정 ⑭ (A) 의 둘은 계속 대상이다 (넓히기만 했지 빼지 않았다).
  for (const id of [CENTRAL_N7_FINDER_PATTERN_ID, CENTRAL_V0_FINDER_PATTERN_ID]) {
    assert.ok(applying.includes(id), `${id}: (A) 부터 대상이던 검출기가 빠졌다`);
  }
});

test('① 사유 cube-3tone 은 renderKind 축에서 나온다 (라벨이 아니라)', () => {
  const cubeKind = FINDER_PATTERNS
    .find((pattern) => pattern.id === THREE_TONE_CUBE_FINDER_PATTERN_ID).renderKind;
  for (const id of RENDER_REACHABLE_IDS) {
    const isCube = finderRenderKindOf(id) === cubeKind;
    assert.equal(detectorEmphasisApplicability(id).reason === 'cube-3tone', isCube,
      `${id}: 3톤 큐브 사유가 renderKind 와 어긋난다`);
  }
});

test('① 사유 bwg 는 «모든 면이 흑백회» 인 화법에만 붙는다 (고정 큐브 톤 제외)', () => {
  // ⚠ **다른 출처로 잰다.** 구현은 renderKind 에서 유도하고, 여기서는 운영자 3분류
  //   정본(finder-taxonomy)의 `toneAxis` 로 다시 잰다. 한쪽만 늙으면 여기서 죽는다.
  //
  //   ⛔ 표시·분류 층 id(sagoae·taegeuk 등)는 finderPatternId 가 아니라 판정 대상이
  //      아니고, 그래서 전수의 교집합만 본다.
  //
  //   **F1 교정 (2026-09-06)**: `cube-bullseye` 는 링만 파인더 축이고 안쪽 큐브 3면은
  //   고정 상수 FINDER_CUBE_TONES 다 (028A §3 «큐브 최암면 Y=0.1008» — 순검정이 아니다).
  //   toneAxis 도 그렇게 정정됐고, 하이브리드는 «흑백» 주장이 성립하지 않아 bwg 에서
  //   빠진다. 두 손 목록이 같은 오류를 공유하던 상태를 이 대조가 잡는다.
  const toneById = new Map(FINDER_TAXONOMY.map((item) => [item.id, item.toneAxis]));
  let bwgSeen = 0;
  let hybridSeen = 0;
  for (const id of RENDER_REACHABLE_IDS) {
    const toneAxis = toneById.get(id);
    if (toneAxis === undefined) continue;
    const verdict = detectorEmphasisApplicability(id);
    if (verdict.applies || verdict.reason === 'cube-3tone') continue;
    const taxonomyBwg = toneAxis.startsWith(TONE_FINDER_BWG);
    assert.equal(verdict.reason === 'bwg', taxonomyBwg,
      `${id}: 사유 ${verdict.reason} ↔ 분류 정본 toneAxis «${toneAxis}» 가 어긋난다`);
    if (taxonomyBwg) bwgSeen += 1;
    else hybridSeen += 1;
  }
  assert.ok(bwgSeen >= 3, 'BWG 대조 표본이 사라졌다 — 자가 빈 루프로 초록이 됐다');
  assert.ok(hybridSeen >= 1,
    '고정 큐브 톤 하이브리드 표본이 사라졌다 — F1 이 다시 안 보이는 상태다');
});

test('① 폐쇄집합의 사유가 전부 실재한다 — 죽은 사유·못 닿는 문구 금지', () => {
  const seen = new Set(RENDER_REACHABLE_IDS
    .map((id) => detectorEmphasisApplicability(id).reason)
    .filter((reason) => reason !== null));
  for (const reason of DETECTOR_EMPHASIS_REASONS) {
    assert.ok(seen.has(reason), `사유 ${reason} 이 전수 어디에서도 안 나온다 — 죽은 사유다`);
  }
  assert.deepEqual([...DETECTOR_EMPHASIS_REASONS].sort(),
    ['bwg', 'cube-3tone', 'not-yet'], '사유 폐쇄집합이 바뀌었다 — 문구·자를 같이 늘려라');
});

test('① Type Y: 셀 표면 로케이터는 **전부 대상**, 그 밖은 «아직 대상 아님»', () => {
  /*
   * ⭐ **주장이 뒤집혔다 (2026-09-07 (C))** — 종전 이 자는 「Y 로케이터 프로파일은
   *   **전부** 아직 대상 아님」을 잠갔고, 그 근거가 「Y 렌더 경로에 소비자가 0 건」
   *   이었다. 운영자 판정(「Y 의 경우는 v0 이나 v0T, v0TR 같은 로케이터 강조가 되어야
   *   하는데 이쪽은 미지원 상태」)에 따라 이 라운드가 `sceneY.js` 에 소비자를 넣었으므로
   *   근거가 사라졌다. 자를 지우지 않고 **가르는 선**을 새로 잠근다 — 셀 표면 로케이터
   *   (레이아웃이 톤을 고정한 셀)는 대상, `off`·`hex-frame-v1`(별도 도형)은 비대상.
   *
   * ⚠ 한 개만 재면 표본 운이다 (2026-09-06 F6 — 종전판은 'cell-surface-v0t' 하나였다).
   */
  assert.ok(LOCATOR_PROFILES_Y.length >= 10, 'Y 로케이터 전수가 줄었다 — 출처를 확인하라');
  let applied = 0;
  let notYet = 0;
  for (const profile of LOCATOR_PROFILES_Y) {
    const verdict = detectorEmphasisApplicability(profile);
    // 판정 축은 **로케이터 정본 술어**다 — 이 자가 id 목록을 손으로 다시 적지 않는다.
    const cellSurface = isCellSurfaceLocatorProfileY(profile);
    assert.equal(verdict.applies, cellSurface,
      `${profile}: 셀 표면 로케이터 여부와 강조 대상 여부가 어긋난다`);
    assert.equal(verdict.reason, cellSurface ? null : 'not-yet',
      `${profile}: 비대상의 답은 «아직 대상 아님» 이어야 한다`);
    if (cellSurface) applied += 1; else notYet += 1;
  }
  // 양쪽 표본이 실재해야 «가르는 선» 이 의미가 있다 (한쪽이 0 이면 공허 통과).
  assert.ok(applied >= 10, `대상 Y 로케이터 표본이 ${applied} 뿐이다`);
  assert.ok(notYet >= 2, `비대상 Y 로케이터 표본이 ${notYet} 뿐이다 (off · hex-frame-v1)`);
});

// ── ② 모형의 표 (index.html 철자가 아니라 값) ────────────────────────────

test('② 편집 가능 = **검출기 축 하나** — 타입 × 검출기 전수 격자', () => {
  /*
   * ⭐ **축이 하나로 줄었다 (2026-09-07 (C))** — 종전은 «타입 축 × 검출기 축» 이었고
   *   그 타입 축이 Type Y 를 통째로 막았다(= 운영자가 본 «Y 미지원»). 지금은 검출기
   *   축 하나가 답하고, 타입은 앵커에만 남는다. 그래서 이 격자는 **타입마다 그 타입의
   *   검출기 id 축**을 돈다 — Y 는 `locatorProfileY`, 나머지는 `finderPatternId`.
   */
  for (const type of GENERATOR_TYPES) {
    const isY = !hasCentralFinderAxis(type);
    const ids = isY ? LOCATOR_PROFILES_Y : RENDER_REACHABLE_IDS;
    let editableSeen = 0;
    for (const id of ids) {
      const seat = isY ? { locatorProfileY: id } : { finderPatternId: id };
      // 고급 카드가 보이는 화면 기준 — 고급 게이트 자체는 아래 자가 따로 잰다.
      const model = modelOf({ type, ...seat, advancedCardsVisible: true });
      const expected = detectorEmphasisApplicability(id).applies;
      assert.equal(model.editable, expected, `${type}/${id}: 편집 가능이 어긋난다`);
      assert.equal(model.detectorId, id, `${type}/${id}: 판정에 들어간 검출기 id 가 다르다`);
      assert.equal(model.markerCells, false,
        `${type}/${id}: seat 를 안 준 상태인데 마커 축이 참이다 — 이 격자의 전제가 깨졌다`);
      // 비활성은 **모든 카드**에 걸린다 — 한 장만 살아 있으면 «켰는데 안 먹는» 자리다.
      for (const card of model.cards) {
        assert.equal(card.disabled, !expected, `${type}/${id}/${card.mode}: 비활성 누락`);
      }
      if (expected) editableSeen += 1;

      /*
       * ⭐ **축 ② — 켜 둔 코너 마커 (2026-09-07 emph-centerqr)**.
       *
       * 렌더는 마커 검출 셀을 **중앙 파인더 선택과 무관하게** 강조한다
       * (detector-emphasis-cells ⓚ①). 그러니 화면도 그때는 켤 수 있어야 한다 —
       * 종전엔 축 ① 하나가 카드를 잠가서 «렌더는 먹는데 화면은 못 켜는» 자리였고,
       * 그게 운영자 신고(「O/A/K에서 중앙 QR일 때는 적용이 안되던데」)의 화면 쪽 절반이다.
       */
      const markerSeat = MARKER_SEAT_BY_TYPE[type];
      if (markerSeat) {
        const withMarker = modelOf({
          type, ...seat, ...markerSeat, advancedCardsVisible: true,
        });
        assert.equal(withMarker.markerCells, true,
          `${type}/${id}: 마커 seat 를 켰는데 축 ② 가 거짓이다`);
        assert.equal(withMarker.editable, true,
          `${type}/${id}: 마커를 켰는데 강조를 못 켠다 — 렌더는 그 셀을 강조한다`);
        for (const card of withMarker.cards) {
          assert.equal(card.disabled, false,
            `${type}/${id}/${card.mode}: 마커가 있는데 카드가 잠겼다`);
        }
        // 검출기 자신이 비대상이면 화면은 **범위**를 말한다 (사유 줄이 아니라).
        assert.equal(withMarker.noteKey,
          expected ? null : DETECTOR_EMPHASIS_MARKER_SCOPE_KEY,
          `${type}/${id}: 마커만 강조되는 자리에서 화면이 옛 사유 문구를 말한다`);
      }
    }
    // 타입마다 «켤 수 있는» 검출기가 실재해야 한다 — Y 가 0 이면 (C) 가 안 걸린 것이다.
    assert.ok(editableSeen > 0, `${type}: 강조를 켤 수 있는 검출기가 하나도 없다`);
  }
});

test('② 섹션은 사라지지 않고 앵커만 갈아탄다', () => {
  for (const type of GENERATOR_TYPES) {
    const model = modelOf({ type });
    assert.equal(model.hidden, false,
      `${type}: 생성기 타입인데 섹션이 숨는다 — 상시 표시가 이 라운드의 본론이다`);
    assert.equal(model.anchor, hasCentralFinderAxis(type) ? 'finder' : 'yLocator',
      `${type}: 앵커가 검출기 섹션과 어긋난다`);
  }
  // GENERATOR_TYPES 밖 값에서만 숨는다 — 종전 게이트는 전수라 **항상 false** 였다(F7).
  assert.equal(modelOf({ type: 'Z' }).hidden, true);
});

test('② 고급 전용 카드 가시성 진리표 — 4조합 전부', () => {
  // ⚠ 종전판은 index.html 정규식이었고, 숨김 자체를 지워도 초록이었다 (F9 변이 M4).
  for (const advancedCardsVisible of [true, false]) {
    const model = modelOf({ advancedCardsVisible });
    for (const card of model.cards) {
      const advancedOnly = ADVANCED_ONLY_EMPHASIS_MODES.includes(card.mode);
      assert.equal(card.advancedOnly, advancedOnly, card.mode);
      assert.equal(card.visible, !advancedOnly || advancedCardsVisible,
        `${card.mode} × 고급노출 ${advancedCardsVisible}: 가시성이 어긋난다`);
    }
  }
  assert.deepEqual(modelOf({ advancedCardsVisible: false }).cards
    .filter((card) => !card.visible).map((card) => card.mode),
  [...ADVANCED_ONLY_EMPHASIS_MODES],
  '일반 모드에서 내려가는 카드가 고급 전용 집합과 다르다');
});

test('② 노트 키는 총함수다 — 조용한 무시가 없다', () => {
  // 사유가 있는 자리: 사유 키. 편집 가능 + 고급 전용 active 숨김: 안내. 그 밖: null.
  //
  // ⭐ **«사유 없는 비활성» 갈래가 사라졌다 (2026-09-07 (C))** — 그 상태의 유일한
  //   실례가 Type Y 였고, 이 라운드가 Y 를 배선해 타입 게이트를 걷었다. 이제 비활성의
  //   답은 **언제나 검출기 사유**다 (폐쇄집합 3택). 그래서 옛 g1030 은 폐기됐고,
  //   그 상태가 다시 생기면 모형이 **던진다**(모형 안 자기검증) — 아래 «비활성인데
  //   사유 줄이 없다» 단언은 그 던짐 앞의 두 번째 그물이다.
  let editableSeen = 0;
  let disabledSeen = 0;
  for (const type of GENERATOR_TYPES) {
    const isY = !hasCentralFinderAxis(type);
    const ids = isY ? LOCATOR_PROFILES_Y : RENDER_REACHABLE_IDS;
    for (const id of ids) {
      for (const emphasis of CENTRAL_N7_EMPHASIS_MODES) {
        for (const advancedCardsVisible of [true, false]) {
          const seat = isY ? { locatorProfileY: id } : { finderPatternId: id };
          const model = modelOf({
            type, ...seat, centralN7Emphasis: emphasis, advancedCardsVisible,
          });
          if (!model.editable) {
            disabledSeen += 1;
            assert.ok(model.noteKey, `${type}/${id}: 비활성인데 사유 줄이 없다`);
          } else {
            editableSeen += 1;
          }
          // 고급 게이트로 막힌 자리 — «축은 있는데 정식 화면에서 내려 뒀다».
          const gated = detectorEmphasisRequiresAdvanced(id) && !advancedCardsVisible;
          if (model.reason) {
            assert.equal(model.noteKey, DETECTOR_EMPHASIS_REASON_KEYS[model.reason]);
          } else if (gated) {
            assert.equal(model.noteKey, DETECTOR_EMPHASIS_ADVANCED_DETECTOR_KEY,
              `${type}/${id}: 고급 전용 검출기인데 그 사실을 말하지 않는다`);
            assert.equal(model.editable, false, `${type}/${id}: 고급 게이트가 안 걸렸다`);
          } else if (model.advancedHiddenActive) {
            assert.equal(model.noteKey, DETECTOR_EMPHASIS_ADVANCED_HIDDEN_KEY);
          } else {
            assert.equal(model.noteKey, null);
          }
        }
      }
    }
  }
  assert.ok(editableSeen > 0 && disabledSeen > 0, '격자에 한쪽 표본이 없다 — 공허 통과다');
  // Y 의 셀 표면 로케이터는 **고급 화면에서 켤 수 있고 할 말이 없다** — (C) 가 연 자리.
  const y = modelOf({ type: 'Y', locatorProfileY: 'cell-surface-v0tr', advancedCardsVisible: true });
  assert.equal(y.editable, true, 'Y v0TR 에서 강조를 못 켠다 — (C) 배선이 끊겼다');
  assert.equal(y.reason, null);
  assert.equal(y.anchor, 'yLocator', 'Y 섹션 앵커가 검출기 섹션 쪽으로 갔다');
  // 정식 화면(고급 카드 비노출)에서는 **못 켜고**, 그 사실을 화면이 말한다 —
  // 실측 회귀(v0TR 8점) 때문에 내려 둔 자리다 (브리프 §8 「기본 off + 라벨에」).
  const yPlain = modelOf({
    type: 'Y', locatorProfileY: 'cell-surface-v0tr', advancedCardsVisible: false,
  });
  assert.equal(yPlain.editable, false, 'Y 강조가 정식 화면에서 켜진다 — 실측 회귀가 새 나간다');
  assert.equal(yPlain.noteKey, DETECTOR_EMPHASIS_ADVANCED_DETECTOR_KEY);
  assert.equal(yPlain.reason, null, '고급 게이트는 «검출기 사유» 가 아니다');
  // 로케이터를 끈 Y 는 여전히 비대상이고, 그 사유는 검출기가 말한다.
  const off = modelOf({ type: 'Y', locatorProfileY: 'off' });
  assert.equal(off.editable, false);
  assert.equal(off.noteKey, DETECTOR_EMPHASIS_REASON_KEYS['not-yet']);
  // ⭐ **마커 범위 줄 (2026-09-07 emph-centerqr)** — 운영자가 신고한 자리 그대로:
  //   Type O × 중앙 QR × 내곽 H. 검출기 자신은 비대상(bwg)인데 마커가 켜져 있다.
  const qrWithMarker = modelOf({
    type: 'O', finderPatternId: 'center-qr', innerSeat: 'o-cm',
  });
  assert.equal(qrWithMarker.reason, 'bwg', '중앙 QR 자신의 사유가 바뀌었다');
  assert.equal(qrWithMarker.editable, true,
    '중앙 QR × 마커에서 강조를 못 켠다 — 운영자 신고 그 자리다');
  assert.equal(qrWithMarker.noteKey, DETECTOR_EMPHASIS_MARKER_SCOPE_KEY,
    '마커만 강조되는 자리에서 화면이 «강조 축 자체를 못 켜요» 를 말한다');
  // 마커를 끄면 다시 비활성 + **사유** 줄이다 (범위 줄이 상시로 새면 안 된다).
  const qrNoMarker = modelOf({ type: 'O', finderPatternId: 'center-qr' });
  assert.equal(qrNoMarker.editable, false);
  assert.equal(qrNoMarker.noteKey, DETECTOR_EMPHASIS_REASON_KEYS.bwg);
  // Type Y 는 코너 자리 축이 없다 — 범위 줄이 Y 에 새면 «못 하는 안내» 가 된다.
  for (const profile of LOCATOR_PROFILES_Y) {
    const yModel = modelOf({ type: 'Y', locatorProfileY: profile, innerSeat: 'o-cm', outerSeat: 'k-cm' });
    assert.equal(yModel.markerCells, false, `Y/${profile}: 코너 마커 축이 새어 들어왔다`);
    assert.notEqual(yModel.noteKey, DETECTOR_EMPHASIS_MARKER_SCOPE_KEY,
      `Y/${profile}: 코너 자리가 없는 타입에 마커 범위 줄이 떴다`);
  }
});

test('② 마커 seat 술어는 **정본 한 벌**이고 index.html 이 그것을 소비한다', () => {
  // 값 축 — 술어가 타입·자리·방향의 짝을 지킨다 (turnA 는 a-cm/v-cm 을 가른다).
  assert.equal(cornerMarkerSeatActive({ type: 'O', innerSeat: 'o-cm' }), true);
  assert.equal(cornerMarkerSeatActive({ type: 'O', innerSeat: 'none' }), false);
  assert.equal(cornerMarkerSeatActive({ type: 'K', outerSeat: 'k-cm' }), true);
  assert.equal(cornerMarkerSeatActive({ type: 'A', outerSeat: 'a-cm', turnA: false }), true);
  assert.equal(cornerMarkerSeatActive({ type: 'A', outerSeat: 'a-cm', turnA: true }), false);
  assert.equal(cornerMarkerSeatActive({ type: 'A', outerSeat: 'v-cm', turnA: true }), true);
  assert.equal(cornerMarkerSeatActive({ type: 'A', outerSeat: 'v-cm', turnA: false }), false);
  assert.equal(cornerMarkerSeatActive({ type: 'Y', innerSeat: 'o-cm', outerSeat: 'k-cm' }), false);
  /*
   * **트리거 축** — 파생값은 트리거도 필요하다. 자리 카드 경로는
   * syncAfterSeatChange → renderFinderUi → syncCentralN7EmphasisUi 로 섹션을 다시
   * 칠하지만, **방향(turnA) 카드 경로는 그 사슬을 안 탄다**. 그래도 되는 근거는
   * 값이다: 그 핸들러는 방향을 뒤집으면서 자리도 함께 정규화하므로(a-cm⇄v-cm)
   * 이 술어의 답이 **안 바뀐다**. 그 불변식이 깨지면 트리거를 붙여야 하니 여기서 잰다.
   */
  for (const outerSeat of ['none', 'a-cm', 'v-cm']) {
    const before = cornerMarkerSeatActive({ type: 'A', outerSeat, turnA: outerSeat === 'v-cm' });
    // 핸들러의 정규화: 방향을 켜면 a-cm → v-cm, 끄면 v-cm → a-cm.
    const flippedSeat = outerSeat === 'a-cm' ? 'v-cm' : outerSeat === 'v-cm' ? 'a-cm' : outerSeat;
    const after = cornerMarkerSeatActive({
      type: 'A', outerSeat: flippedSeat, turnA: flippedSeat === 'v-cm',
    });
    assert.equal(after, before,
      `A/${outerSeat}: 방향을 뒤집으면 마커 축이 바뀐다 — 그 경로에 강조 섹션 트리거가 없다`);
  }
  // 배선 축 — 인코더 옵션을 만드는 자리(buildConfig)가 **같은 함수**를 부른다.
  //   ⚠ 여기만 소스 철자다. 사본이 생기면 «화면은 켤 수 있다는데 와이어엔 마커가
  //     없다» 가 조용히 생기고, 그건 이 파일의 어떤 값 자로도 안 보인다.
  assert.match(INDEX, /cornerMarker: cornerMarkerSeatActive\(generatorState\)/,
    'buildConfig 가 마커 seat 술어 정본을 안 부른다 — 인라인 사본이 되살아났다');
  assert.doesNotMatch(INDEX, /cornerMarker: \(type === 'O' && generatorState\.innerSeat/,
    '구 인라인 술어가 남아 있다');
});

test('② 렌더 좌석 셋이 강조 옵션을 **판정으로 막지 않는다** — 소비자 스윕', () => {
  /*
   * 값 축은 detector-emphasis-cells ⓚ⑥ 이 잰다 (조립 함수를 불러 실제로 그린다).
   * 여기는 **손 조립 좌석**(index.html 의 Type K 디스패치 · lab 봉투)만 본다 — 그 둘은
   * 모듈이 아니라 인라인이라 값 자로 못 닿는다. 2026-09-07 emph-centerqr 실측에서
   * 이 게이트가 렌더 정정을 통째로 무력화하고 있었다 (QR 중앙: 마커 검출 면 0/24).
   */
  assert.doesNotMatch(INDEX, /if \(centralN7EmphasisAppliesTo\(cfg\.finderPatternId\)\) \{/,
    'Type K 디스패치가 아직 판정으로 강조 옵션을 막는다 — 렌더를 고쳐도 화면은 그대로다');
  assert.match(
    INDEX,
    /if \(cfg\.centralN7Emphasis !== undefined\) \{\s+sceneOpts\.centralN7Emphasis = cfg\.centralN7Emphasis;/,
    'Type K 디스패치가 강조 옵션을 안 싣는다',
  );
  assert.doesNotMatch(INDEX, /centralN7Emphasis: centralN7EmphasisAppliesTo\(/,
    'lab 봉투가 아직 판정으로 강조 값을 접는다 — A/B 두 팔이 둘 다 undefined 로 보고된다');
  // Y 좌석의 게이트는 **다른 축**이라 그대로 산다 (고급 전용 검출기 — 실측 회귀).
  assert.match(INDEX, /if \(centralN7EmphasisAppliesTo\(yDetectorId\)/,
    'Y 좌석의 검출기 게이트가 사라졌다 — 그쪽은 실측 회귀로 내려 둔 자리다');
});

// ── ③ 마크업 — 폐쇄집합·기본값·표식을 모형에서 유도한다 ───────────────────

test('③ 섹션은 «검출기 선택» 뒤에 서고 Y 검출기 섹션보다 앞이다', () => {
  const finderHeadingAt = INDEX.indexOf('data-i18n="g459"');
  const sectionAt = INDEX.indexOf('id="centralN7EmphasisSection"');
  const yLocatorAt = INDEX.indexOf('id="yLocatorSection"');
  assert.ok(finderHeadingAt >= 0 && sectionAt >= 0 && yLocatorAt >= 0);
  assert.ok(finderHeadingAt < sectionAt,
    '강조 섹션이 «검출기 선택»(g459) 앞에 있다 — 무엇의 강조인지가 안 읽힌다');
  assert.ok(sectionAt < yLocatorAt, '정적 자리는 O/A/K 검출기 섹션 바로 밑이다');
});

test('③ 카드 값 집합·고급 표식·기본 선택이 정본에서 유도된다', () => {
  const cards = [...SECTION_HTML.matchAll(
    /data-n7-emphasis="([^"]+)"([^>]*)>/g,
  )].map(([, mode, rest]) => ({ mode, advancedOnly: /data-advanced-only="true"/.test(rest) }));
  assert.deepEqual(cards.map((card) => card.mode).sort(), [...CENTRAL_N7_EMPHASIS_MODES].sort(),
    '카드 값 집합이 CENTRAL_N7_EMPHASIS_MODES 와 어긋난다 — lab 기대 축 ④ 도 같이 깨진다');
  assert.deepEqual(cards.filter((card) => card.advancedOnly).map((card) => card.mode),
    [...ADVANCED_ONLY_EMPHASIS_MODES],
    '마크업의 고급 표식이 모형의 ADVANCED_ONLY_EMPHASIS_MODES 와 어긋난다');
  const active = [...SECTION_HTML.matchAll(/<div class="toggle-card([^"]*)" data-n7-emphasis="([^"]+)"/g)]
    .filter(([, classes]) => / active\b/.test(classes))
    .map(([, , mode]) => mode);
  assert.deepEqual(active, [GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS],
    `초기 active 카드가 ${GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS} 하나가 아니다`);
  assert.ok(!ADVANCED_ONLY_EMPHASIS_MODES.includes(GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS),
    '기본값 카드가 고급 전용이다 — 일반 모드에서 선택 상태를 볼 수 없다');
  assert.match(SECTION_HTML, /id="detectorEmphasisNote"/,
    '사유 한 줄(#detectorEmphasisNote)이 섹션 안에 없다');
});

test('③ 정적 DOM 문구가 ko 사전과 **전부** 같다 — 첫 페인트 rot 금지', () => {
  // 사전만 고치면 첫 페인트가 옛 문구로 뜬다 ((A) 레인 규약). 종전엔 이 대조가 섹션
  // 제목(g1002) **한 줄**뿐이라, 카드 부제(g1006·g1008)의 정적 span 이 사전과 갈려도
  // 아무 자가 안 봤다 — 손으로 유지하는 사본 두 벌이었다 (2026-09-07 (B) 라운드에서
  // 실제로 g1006·g1008 을 둘 다 고쳐야 했다).
  const spans = [...SECTION_HTML.matchAll(/data-i18n="(g\d+)"[^>]*>([^<]*)</g)];
  assert.ok(spans.length >= 6,
    `정적 문구 표본이 ${spans.length} 뿐이다 — 정규식이 늙었거나 마크업이 바뀌었다`);
  for (const [, key, text] of spans) {
    assert.equal(text, GENERATOR_STRINGS.ko[key],
      `정적 DOM 의 ${key} 가 ko 사전과 다르다 — 첫 페인트가 옛 문구다`);
  }
});

test('③ index.html 은 모형을 **소비만** 한다 — 규칙의 두 번째 사본 금지', () => {
  // ⚠ 여기만 소스 철자다. 규칙 자체는 위 ② 가 값으로 재고, 이 자는 «화면이 그 규칙에
  //   연결돼 있는가» 만 묻는다 (연결이 끊기면 위 격자가 전부 무의미해진다).
  assert.match(INDEX, /emphasisSectionModel\(generatorState, \{/,
    '강조 섹션이 정본 모형을 안 부른다');
  assert.match(INDEX, /els\.detectorEmphasisNote\.textContent = t\(model\.noteKey\)/,
    '사유 줄이 모형의 키를 안 읽는다 — 요소는 보이는데 빈 줄로 침묵한다');
  assert.match(INDEX, /card\.style\.display = entry\.visible \? '' : 'none'/,
    '카드 가시성이 모형을 안 읽는다');
  assert.match(INDEX, /if \(!centralN7EmphasisEditable\(\)\) return;/,
    'Enter/Space 경로가 안 잠겼다 — pointer-events 는 키보드를 못 막는다');
  // 타입 손 목록이 되살아나면 여기서 죽는다 (F7 — 축은 hasCentralFinderAxis 하나).
  assert.doesNotMatch(INDEX, /\['O', 'A', 'K'\]\.includes\(/,
    '타입 손 목록이 되살아났다 — 축은 hasCentralFinderAxis 하나에서 유도한다');
});

// ── ④ i18n 8언어 ─────────────────────────────────────────────────────────

/** 이 섹션이 소유하는 문구 키 전부 — 모형의 키 상수에서 유도한다. */
const SECTION_KEYS = Object.freeze([
  'g1002', 'g1003', 'g1004', 'g1005', 'g1006', 'g1007', 'g1008',
  ...Object.values(DETECTOR_EMPHASIS_REASON_KEYS),
  DETECTOR_EMPHASIS_ADVANCED_HIDDEN_KEY,
  DETECTOR_EMPHASIS_ADVANCED_DETECTOR_KEY,
  DETECTOR_EMPHASIS_MARKER_SCOPE_KEY,
]);

test('④ 섹션 문구가 8언어 전부에 있다 (사유가 늘면 자동으로 잰다)', () => {
  assert.deepEqual(Object.keys(GENERATOR_STRINGS), [...SUPPORTED_LANGUAGES]);
  for (const language of SUPPORTED_LANGUAGES) {
    for (const key of SECTION_KEYS) {
      const value = GENERATOR_STRINGS[language][key];
      assert.equal(typeof value, 'string', `${language} 사전에 ${key} 가 없다`);
      assert.ok(value.length > 0, `${language}/${key} 가 빈 문자열이다`);
    }
  }
});

test('④ «중앙» 전제가 8언어 어디에도 없다', () => {
  // 검출기 강조는 이제 «중앙 파인더의 색» 이 아니라 «고른 검출기의 색» 축이다.
  // ⚠ 종전판은 ko 하나만 쟀다 (2026-09-06 F11 — ja 를 「中央を…」 로 되돌려도 초록).
  const CENTRE_WORD = Object.freeze({
    ko: /중앙/,
    en: /\bcent(re|er)\w*\b/i,
    ja: /中央/,
    fr: /\bcentr\w*\b/i,
    it: /\bcentr\w*\b/i,
    de: /\b(Mitte|mittig|zentral\w*)\b/i,
    es: /\bcentr\w*\b/i,
    pt: /\bcentr\w*\b/i,
  });
  assert.deepEqual(Object.keys(CENTRE_WORD).sort(), [...SUPPORTED_LANGUAGES].sort(),
    '«중앙» 어휘 표가 지원 언어와 어긋난다 — 언어가 늘면 여기도 같이 늘려라');
  for (const language of SUPPORTED_LANGUAGES) {
    for (const key of SECTION_KEYS) {
      assert.doesNotMatch(GENERATOR_STRINGS[language][key], CENTRE_WORD[language],
        `${language}/${key} 에 «중앙» 전제가 남아 있다: ${GENERATOR_STRINGS[language][key]}`);
    }
  }
  // 정적 DOM 도 같이 바뀌어야 한다 — 사전만 고치면 첫 페인트가 옛 문구다.
  assert.ok(SECTION_HTML.includes(`>${GENERATOR_STRINGS.ko.g1002}<`),
    '정적 제목이 ko 사전값과 다르다');
  assert.doesNotMatch(SECTION_HTML, /중앙 강조색/);
});

test('④ de·es 는 존댓말이다 — du/tú 체 금지', () => {
  // 프로젝트 요구사항인데 자가 없었다 (2026-09-06 F12 — de g1029 를 «deine» 로
  // 바꿔도 초록이었다). 키 범위를 이 섹션으로 좁혀 오탐을 피한다.
  const INFORMAL = Object.freeze({
    de: /\b(du|dein\w*|dich|dir)\b/i,
    es: /\b(tú|tus|te|contigo)\b/i,
  });
  for (const [language, pattern] of Object.entries(INFORMAL)) {
    for (const key of SECTION_KEYS) {
      assert.doesNotMatch(GENERATOR_STRINGS[language][key], pattern,
        `${language}/${key} 가 반말이다: ${GENERATOR_STRINGS[language][key]}`);
    }
  }
});
