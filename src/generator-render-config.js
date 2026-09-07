// generator-render-config.js — 생성기의 정규 상태 → 인코더/scene 옵션 경계

import { CENTER_QR_FINDER_PATTERN_ID, isCentralV0FinderPatternId } from './finder-selection.js';
import {
  centralMarkerN7FamilyForType, isCentralMarkerN7FinderPatternId,
} from './centralMarkerN7.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from './centralN7Schema.js';
import {
  CELL_SURFACE_LOCATOR_RENDER_KIND, DETECTOR_EMPHASIS_RENDER_KINDS,
} from './centralN7Emphasis.js';
import {
  FINDER_PATTERNS, THREE_TONE_CUBE_FINDER_PATTERN_ID,
} from './finder-patterns.js';
import { finderRenderKindOf } from './finder-render-kind.js';
import { WINDOW_SUPPORTED_TONES, WINDOW_SUPPORTED_VERSION } from './capacityY.js';
import {
  CELL_SURFACE_FINAL_V0,
  CELL_SURFACE_FINAL_V0T,
  CELL_SURFACE_FINAL_V0TY,
  CELL_SURFACE_FINAL_V0TR,
  CELL_SURFACE_FINAL_V0TRQ,
  CELL_SURFACE_FINAL_V0TRY,
  CELL_SURFACE_FINAL_V0W,
  CELL_SURFACE_FINAL_V0W2,
  CELL_SURFACE_FINAL_V0WY,
  CELL_SURFACE_FINAL_V0WQ,
  CELL_SURFACE_FINAL_V0X,
  CELL_SURFACE_FINAL_V0XQ,
  CELL_SURFACE_FINAL_V1R2,
  CELL_SURFACE_FINAL_V2R2,
  assertCellSurfaceFinalId,
} from './cellSurfaceFinal.js';
import {
  LOCATOR_PROFILE_CELL_SURFACE_V0,
  LOCATOR_PROFILE_CELL_SURFACE_V0T,
  LOCATOR_PROFILE_CELL_SURFACE_V0TY,
  LOCATOR_PROFILE_CELL_SURFACE_V0TR,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRQ,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRY,
  LOCATOR_PROFILE_CELL_SURFACE_V0W,
  LOCATOR_PROFILE_CELL_SURFACE_V0W2,
  LOCATOR_PROFILE_CELL_SURFACE_V0WY,
  LOCATOR_PROFILE_CELL_SURFACE_V0WQ,
  LOCATOR_PROFILE_CELL_SURFACE_V0X,
  LOCATOR_PROFILE_CELL_SURFACE_V0XQ,
  LOCATOR_PROFILE_CELL_SURFACE_V1R2,
  LOCATOR_PROFILE_CELL_SURFACE_V2R2,
} from './locatorY.js';

const CENTRAL_N7_FAMILY_BY_TYPE = Object.freeze({
  O: 'hex',
  G: 'hex',
  A: 'tri',
  V: 'tri',
  K: 'star',
});

/** 바깥 타입을 중앙 n=7 payload의 명시 family로 바꾼다. */
export function centralN7FamilyForType(type) {
  const family = CENTRAL_N7_FAMILY_BY_TYPE[type];
  if (family === undefined) throw new RangeError('중앙 n=7을 지원하지 않는 타입: ' + type);
  return family;
}

/**
 * `centralN7Emphasis` 강조 축이 적용되는 중앙 파인더인가 — 정본 목록의 단일 소유자.
 *
 * 운영자 결정 2026-08-29 §4 는 «중앙 TL + 3톤 큐브 + 중앙 Y0» 였으나, **3톤 큐브는
 * 같은 브리프의 §2.4 왕복 자에서 거부됐다**: 강조 dark(순검정 Y=0.0000)가 기본
 * 프리셋 배경(Y=0.0053)과의 차 0.0053 < 마스크 허용오차 0.018 로 배경에 흡수돼
 * 실루엣 검출이 전패한다 (ppu 10/12/16/24 `frontend:no-finder` · 흰 배경 대조군은
 * 전부 통과 — scene.js three-tone-cube 분기 주석 실측). 왕복 자는
 * test/central-emphasis-roundtrip.test.js — 대상은 3택 전부 기본과 동일 복호,
 * 큐브는 옵션 무시(픽셀 동일)를 잠근다. 소비자: sceneOptionsForOA · index.html 의
 * K 디스패치 · 강조 섹션 가시성 · lab 텔레메트리 — 손 사본을 두지 말고 이걸 불러라.
 *
 * ⚠ **정본은 이제 아래 `detectorEmphasisApplicability` 다** (운영자 결정 ⑭
 * 2026-09-06). 이 술어는 그 함수의 `applies` 를 그대로 돌려주는 얇은 이름이다.
 *
 * ⭐ **값 표가 (B) 에서 넓어졌다 (2026-09-07)**: 중앙 TL · 중앙 Y0 **+ 중앙 M7**.
 * 이제 참/거짓이 리터럴 id 가 아니라 **renderKind** 에서 나오고, 그 집합의 정본은
 * `centralN7Emphasis.DETECTOR_EMPHASIS_RENDER_KINDS` 하나다 — 렌더(scene.js)가 보는
 * 것과 **같은 집합**이라 «켰는데 안 먹는» / «안 먹는다고 써 놓고 먹는» 이 구조적으로
 * 안 생긴다. 참이면 중앙 슬롯뿐 아니라 **바깥 코드 셀 전부**가 같은 팔레트 치환을
 * 받는다 (검출 셀은 'locator' 부터, 페이로드 셀은 'all' 에서).
 */
export function centralN7EmphasisAppliesTo(finderPatternId) {
  return detectorEmphasisApplicability(finderPatternId).applies;
}

/**
 * 강조가 **안 되는** 사유의 폐쇄집합 (운영자 결정 ⑭ 2026-09-06 · PM/029B §27.14).
 *
 * 화면이 «없는 축» 과 «지금은 못 쓰는 축» 을 구별해 말하려면 사유가 필요하다. 이
 * 목록은 UI 문구 키의 정본이기도 하다 — 소비자는 여기서 유도하고 손 목록을 두지 마라.
 */
export const DETECTOR_EMPHASIS_REASONS = Object.freeze(['cube-3tone', 'bwg', 'not-yet']);

/**
 * **파인더 축(palette.bullseyeDark / BULLSEYE_MID / bullseyeLight)의 링·격자로
 * 그려지는** renderKind 들 — 즉 dark 가 이미 순검정(BULLSEYE_DARK = rgb 0,0,0)인 화법.
 *
 * 실측 근거는 `scene.js` 의 렌더 분기다: cell-mask 는 level/mask → bullseyeLight ·
 * BULLSEYE_MID · bullseyeDark, cube-bullseye 의 링과 bullseye 의 6밴드는
 * `i % 2 === 0 ? palette.bullseyeDark : palette.bullseyeLight`, center-qr 블록은
 * `pushQrBlock` 이 bullseyeLight 바탕 위에 bullseyeDark 모듈을 깐다.
 *
 * ⚠ **이 집합만으로는 «강조가 줄 것이 없다» 가 성립하지 않는다** (2026-09-06, 010
 * 리뷰 F1). `cube-bullseye` 는 링만 파인더 축이고 **안쪽 큐브 3면은 프리셋이 아닌
 * 고정 상수 `FINDER_CUBE_TONES`** 로 그린다 (scene.js cube-bullseye 분기 — 028A §3
 * 실측 «큐브 최암면 Y=0.1008», 순검정이 아니다). 그래서 사유 `bwg` 는 아래
 * `CUBE_TONE_RENDER_KINDS` 를 **빼고** 정의한다 = «모든 면이 bullseye 축에서 나온다».
 * 하이브리드는 어느 쪽 주장도 실측이 없으므로 `not-yet` 으로 떨어진다.
 */
const BULLSEYE_AXIS_RENDER_KINDS = Object.freeze([
  'cell-mask', 'cube-bullseye', 'bullseye', 'center-qr',
]);

/**
 * 면을 **고정 상수 `FINDER_CUBE_TONES`** 로 칠하는 renderKind 들 — 손 목록이 아니라
 * 정본 표의 불변식에서 유도한다.
 *
 * `finder-patterns.definePattern` 은 `toneRanks`(0/1/2 순열)를 renderKind 가
 * three-tone-cube · cube-bullseye 일 때만 요구하고 그 밖에서는 금지한다. 그리고
 * scene.js 는 그 `toneRanks` 를 그대로 `FINDER_CUBE_TONES[...]` 의 첨자로 쓴다 —
 * 즉 «toneRanks 를 가진 패턴 = 큐브 톤으로 칠하는 패턴» 이 표의 성질이다.
 */
const CUBE_TONE_RENDER_KINDS = Object.freeze([...new Set(
  FINDER_PATTERNS.filter((pattern) => pattern.toneRanks !== undefined)
    .map((pattern) => pattern.renderKind),
)]);

/** 3톤 큐브의 renderKind — 철자를 옮겨 적지 않고 정본 표에서 뽑는다. */
const THREE_TONE_CUBE_RENDER_KIND = FINDER_PATTERNS
  .find((pattern) => pattern.id === THREE_TONE_CUBE_FINDER_PATTERN_ID).renderKind;

/**
 * finderPatternId → renderKind — **정본은 `finder-render-kind.js` 하나**다.
 *
 * 종전엔 scene.js `resolveFinderRenderPattern` 의 조회 순서를 여기 옮겨 적었고
 * (표 밖 중앙 id 2개는 리터럴), 둘의 어긋남을 재는 자가 없었다 (2026-09-06 010
 * 리뷰 F4 — LEGACY 를 다른 renderKind 로 바꿔도 스위트 전부 초록이었다). 이제
 * 그리는 쪽과 분류하는 쪽이 같은 표를 읽는다.
 *
 * 여기가 렌더와 다른 점은 «모르는 id 에서 죽지 않는다» 뿐이다 — 분류 쪽에는
 * 자리 예약 id(o-cm…)·Y 로케이터 프로파일 id 처럼 중앙 파인더가 아닌 값도
 * 들어오고, 그런 값의 답은 «아직 대상 아님» 이지 예외가 아니다.
 */
function detectorRenderKind(finderPatternId) {
  return finderRenderKindOf(finderPatternId);
}

const APPLICABILITY_YES = Object.freeze({ applies: true, reason: null });
const APPLICABILITY_NO = Object.freeze(Object.fromEntries(
  DETECTOR_EMPHASIS_REASONS.map((reason) => [reason, Object.freeze({ applies: false, reason })]),
));

/**
 * 이 검출기에 «검출기 강조» 축이 적용되는가, 아니면 **왜** 아닌가.
 *
 * `centralN7EmphasisAppliesTo` 의 상위 함수다 — 그쪽은 이 함수의 `applies` 를 그대로
 * 돌려준다. 렌더 사슬(sceneOptionsForOA · index.html K 디스패치)이 쓰는 판정은
 * 하나뿐이고, 화면은 그 판정에 **사유 한 줄**을 덧붙여 말한다 (운영자 결정 ⑭).
 *
 * 적용 여부도 사유도 라벨이 아니라 **렌더 축(renderKind)에서 유도**된다:
 *   · **적용** — 강조 팔레트를 실제로 소비하는 화법
 *     (`centralN7Emphasis.DETECTOR_EMPHASIS_RENDER_KINDS` = 중앙 TL · 중앙 v0 ·
 *     중앙 M7). 그 집합의 정본은 **렌더와 공유**한다 — 종전엔 여기 리터럴 id 두
 *     개였고, 그래서 «렌더는 소비하는데 분류는 모른다»(또는 반대)를 아무 자도 못
 *     봤다. 지금은 자 ⓐ(test/detector-emphasis-cells.test.js)가 전수를 **독립
 *     출처**로 잰다 — 강조 상수를 한 번도 안 읽고 «`palette.levels` 만 바꾼 두
 *     팔레트에서 검출기 자신의 그림이 달라지는가» 를 재서 이 함수의 답·렌더와
 *     대조한다. (종전 문구 「«applies ⟺ 'all' 렌더가 다르다» 를 성질로 잰다」는
 *     양변이 같은 상수에서 나오는 **항진명제**였다 — 2026-09-07 검토 F3 실측.)
 *   · `cube-3tone` — 3톤 큐브 화법. 강조 dark(순검정)가 어두운 프리셋 배경과 차
 *     0.0053 < 마스크 허용오차 0.018 로 먹혀 실루엣 검출이 전패한다 (2026-08-29
 *     §2.4 왕복 자 거부 — 위 `centralN7EmphasisAppliesTo` 주석의 실측).
 *   · `bwg` — **모든 면이** 파인더 축에서 나오는 화법 (BULLSEYE_AXIS_RENDER_KINDS
 *     빼기 CUBE_TONE_RENDER_KINDS). dark 가 이미 순검정이라 강조가 light 를 낮추는
 *     방향밖에 못 간다 (= 대비 감소. 정책상 안 한다). 링 + 고정 큐브 톤 하이브리드는
 *     이 주장이 성립하지 않아 여기 안 들어온다 (2026-09-06 F1).
 *   · `not-yet` — 그 밖. **어떤 축이 빠졌는지**로 읽어라 (2026-09-07 (B) 정정):
 *     남은 실례는 `cube-bullseye` 하나이고, 그 화법에는 강조가 바꿀 `palette.levels`
 *     면이 **한 장도 없다**(링은 파인더 축, 안쪽 3면은 FINDER_CUBE_TONES). 미배선·
 *     미측정 화법도 여기로 떨어진다 — 실측이 서면 이 함수의 답이 먼저 바뀐다.
 *
 * @param {string} finderPatternId
 * @returns {{applies: boolean, reason: null | 'cube-3tone' | 'bwg' | 'not-yet'}}
 */
export function detectorEmphasisApplicability(finderPatternId) {
  const renderKind = detectorRenderKind(finderPatternId);
  // 렌더가 강조 팔레트를 소비하는 화법인가 — 판정은 **한 집합**에서만 나온다.
  if (DETECTOR_EMPHASIS_RENDER_KINDS.includes(renderKind)) return APPLICABILITY_YES;
  if (renderKind === THREE_TONE_CUBE_RENDER_KIND) return APPLICABILITY_NO['cube-3tone'];
  // «모든 면이 bullseye 축에서 나온다» 가 조건이다 — 링만 파인더 축이고 안쪽을
  // FINDER_CUBE_TONES 로 칠하는 하이브리드(cube-bullseye)는 여기서 빠져 not-yet 이 된다.
  if (BULLSEYE_AXIS_RENDER_KINDS.includes(renderKind)
    && !CUBE_TONE_RENDER_KINDS.includes(renderKind)) return APPLICABILITY_NO.bwg;
  return APPLICABILITY_NO['not-yet'];
}

/**
 * 강조 축은 **있는데** 정식 화면에서는 내려 둔 화법 — 고급 모드·시험판에서만 켠다.
 *
 * ⭐ **`cell-surface-locator`(Type Y) 실측 (2026-09-07 (C), 레인 emph-c)**
 *
 * Y 로케이터 강조는 배선했고 렌더는 정확하다(자 ⓙ). 그런데 **합성 왕복에서 검출
 * 회귀**가 나왔다 — 레이아웃 × ppu 20점 격자, 기본 프리셋(slate) 바탕:
 *   · v0 (n13) · v0T (n21·n25) — 회귀 0 (15/15 원문 일치, 3택 전부)
 *   · **v0TR (n21·n25) — 회귀 8점** (`default` 가 복호하는 자리에서 `locator`/`all`
 *     이 실패. 실패 코드는 전부 `frontend:no-grid-hypothesis` ·
 *     `frontend:no-format-candidate` = **검출(그리드 가설) 단계**)
 * 원자료: `.agent/lanes/emph-c/emphc-y-roundtrip.jsonl`.
 *
 * 기전(가설, 미확증): Y 로케이터 셀은 레벨 0·2 만 쓰고 레벨 1 은 **한 장도 안 쓴다**
 * (전 레이아웃 실측). 그래서 강조가 바꾸는 것은 오직 어두운 면이고, 그 방향이
 * 순검정(Y 0.0000)이라 프리셋 배경(slate Y 0.0053)과 붙는다 — 3톤 큐브 거부
 * (2026-08-29 §2.4)와 같은 «배경에 먹힘» 이다. **흰 바탕 대조군은 결론을 못 준다**
 * (기준선까지 3/6 으로 흔들렸다 — `emphc-y-roundtrip-white.jsonl`).
 *
 * 그래서 이 라운드의 착지는 «배선은 만들되 기본 off» 다 (브리프 §8). 축을 **없다고**
 * 말하지 않는 이유: 없는 게 아니라 정식 화면에서 내린 것이고, 고급·시험판에서는
 * 실제로 켜지며 렌더도 정확하다. 되돌릴 조건: v0TR 회귀의 원인이 검출기 쪽에서
 * 닫히거나(그리드 가설 단계), 실사진 A/B 가 무해를 보이면 이 목록에서 뺀다.
 */
export const DETECTOR_EMPHASIS_ADVANCED_ONLY_RENDER_KINDS = Object.freeze([
  CELL_SURFACE_LOCATOR_RENDER_KIND,
]);

/**
 * 이 검출기의 강조는 **고급 모드·시험판에서만** 켤 수 있는가 — 화면(모형)과 렌더
 * 좌석(index.html `renderTypeY`)이 **같은 술어**를 본다. 두 벌이 되면 «화면은 켤 수
 * 있다는데 렌더는 안 먹는» / 그 반대가 생긴다.
 */
export function detectorEmphasisRequiresAdvanced(finderPatternId) {
  return DETECTOR_EMPHASIS_ADVANCED_ONLY_RENDER_KINDS
    .includes(detectorRenderKind(finderPatternId));
}

/**
 * Type Y 인코더 옵션 — UI 상태(톤·해상도·폴백)를 인코더가 받는 모양으로 바꾼다.
 *
 * 왜 모듈로 빼나: 윈도 β 는 **Y2 · 2톤 전용**(ADR 0003 D1 조건 ②)인데, 생성기가 version 만
 * 강제하고 tones 는 사용자 값(기본 3)을 그대로 넘겨 `RangeError` 로 **렌더가 통째로 죽었다.**
 * 인라인 HTML 안에 있어서 테스트가 닿지 않던 자리였다 — 여기로 옮겨 계약을 고정한다.
 *
 * 강제는 **렌더 시점에만** 한다. 저장된 톤·해상도 선택은 그대로 두어야 윈도를 벗어났을 때
 * 사용자가 고른 값이 복원된다(해상도 티어가 이미 같은 규약을 쓴다).
 *
 * @param {{tone: 2|3, versionY?: number, fallback: {mode: string}, locatorProfileY?: string}} state
 * @returns {{tones: 2|3, version?: number, window?: true, cellSurface?: true, cellSurfaceLayout?: 'v0'|'v2r2'|'v1r2'|'v0x'|'v0xq'|'v0w'|'v0wq'|'v0w2'|'v0wy'|'v0t'|'v0ty'|'v0tr'|'v0trq'|'v0try'}}
 */
export function encodeOptionsForY(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('Type Y 생성기 상태가 필요하다');
  }
  const { tone, versionY, fallback, locatorProfileY } = state;
  if (fallback === null || typeof fallback !== 'object') {
    throw new TypeError('Y QR 폴백 상태가 필요하다');
  }
  // 카드 라인업 (2026-08-17 v0T 편입·v0W 계열 전체 드랍까지 반영):
  // v0 = Y0(n=13) ·
  // v0T = **T 계열 최종 파인더** (NW 16 + A 9 + N팔 10 + NE 36 + W 24 + SE 9 = 104셀) —
  //       n=21 데이터 307 · **n=25 데이터 491** (2026-08-25 편입. 면 모서리 기준 배치라
  //       파인더 셀 수가 n 에 불변이고, 늘어난 면적이 그대로 데이터로 간다) ·
  // v0TY = v0T 파생 (먼 코너 QR 슬롯 8² — 파인더 95 · 슬롯 64 ·
  //       n=21 데이터 252 · **n=25 데이터 436** (2026-08-25 편입. 슬롯 원점은
  //       `centerQrSlotOriginFor` 가 이미 n 을 받는다 — far = (n−m, n−m))).
  //
  // ⚠ **어느 분기가 version 을 고정하는지가 이 함수의 실질**이다. 레이아웃이 여러 n 을
  //   지원하면 고정을 걷어야 하고, 안 걷으면 «사다리·카드 목록은 Y2 를 고르는데 렌더만
  //   Y1» 인 조용한 어긋남이 된다 (2026-08-25 운영자 신고의 원인). 판정 정본은
  //   `cellSurfaceFinal.js` 의 `CELL_SURFACE_FINAL_NS` 다.
  //
  // **v2r2 · v1r2 (2026-08-16) · v0XQ · v0X · v0W · v0WQ · v0W2 · v0WY (2026-08-17)
  // 는 카드에서 내려갔다** (`generator-state.js` 의 허용값에서 제거 — UI 로는 이
  // 값이 더 이상 들어오지 않는다). 아래 **드랍 분기들은 삭제하지 않는다**: 이미
  // 발행된 출력물의 재생성·법의학·와이어 회귀 테스트가 이 함수를 직접 부른다
  // (`cellSurfaceFinal.js` §CELL_SURFACE_FINAL_DROPPED_IDS — 차단·비삭제).
  // 초안 v2 와 구 v1 CS 도 같은 이유로 UI 에서만 내린 채다.
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0) {
    return {
      tones: tone === 3 ? 3 : 2,
      version: 0,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V2R2) {
    return {
      tones: tone === 3 ? 3 : 2,
      // Y2(버전 2) 명시 선택만 n=25 — 그 외(auto/0/1)는 Y1(n=21) 기본.
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V2R2),
    };
  }
  // v0X — 2026-08-17 드랍(차단·비삭제, 판정 3라운드). 카드가 없어 UI 로는 안
  // 들어오지만, 발행분 재생성·법의학 호출이 이 분기를 직접 쓴다.
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0X) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0X 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0X),
    };
  }
  // v0XQ — 2026-08-17 드랍(차단·비삭제). 카드가 없어 UI 로는 안 들어오지만,
  // 발행분 재생성·법의학 호출이 이 분기를 직접 쓴다.
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0XQ) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0XQ 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0XQ),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0W) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0W 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0W),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0WQ) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0WQ 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0WQ),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0W2) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0W2 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0W2),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0WY) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v0WY 도 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0WY),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0T) {
    return {
      tones: tone === 3 ? 3 : 2,
      // ⭐ **하드핀 해제 (2026-08-25)** — 「v0T 도 n=21 뿐이다」는 9ce2883 이전의 사실이다.
      // 「면 모서리 기준 배치」(SPEC §4.11)가 n=25 를 열어 v0T·v0TR 이 [21, 25] 가 됐다
      // (`CELL_SURFACE_FINAL_NS` 가 정본). 그때 라인업·선언 data·회계 표는 넓혔는데
      // **이 상수를 안 걷어서** 사다리는 Y2 를 고르는데 렌더는 Y1 이 나왔다 — 그리고
      // 용량을 넘기면 ECC 가 내려갔다(운영자 신고 2026-08-25 「Y2로 넘어가면 마커가
      // 사라짐 · 수동 선택해도 렌더 안 됨」). 셋을 통과시켜도 **누가 이 값을 고정하는가**
      // 는 아무도 안 묻는다 — 허용 목록을 넓히는 것과 강제 상수를 걷는 것은 다른 작업이다.
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0T),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0TY) {
    return {
      tones: tone === 3 ? 3 : 2,
      // ⭐ **하드핀 해제 (2026-08-25, 레인 QR25)** — 「v0TY 는 n=21 뿐이다」는
      // `centerQrSlotOriginFor` 가 이미 n 을 받기 전의 서술이다. NS 가 [21, 25] 가
      // 됐으므로 여기 상수도 함께 걷는다 (v0T·v0TR 과 같은 사고 — 라인업만 넓히고
      // 하드핀을 안 걷으면 사다리는 Y2 를 고르는데 렌더는 Y1).
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0TY),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0TR) {
    return {
      tones: tone === 3 ? 3 : 2,
      // ⭐ **하드핀 해제 (2026-08-25)** — v0T 와 같은 근거다 (§V0T 분기 주석).
      // v0TR 은 [21, 25] 이고, 자동 사다리(`generator-auto-y.js` RUNGS 2단)가
      // 「Y2 + v0TR」을 고르는 **유일한 마커 보존 경로**다. 여기가 1 로 못 박혀 있으면
      // 그 단이 존재하되 도달할 수 없다.
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0TR),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0TRQ) {
    return {
      tones: tone === 3 ? 3 : 2,
      // ⭐ **하드핀 해제 (2026-08-25, 레인 QR25)** — v0TY 와 같은 근거다.
      // 슬롯은 seam (0,0) 이라 n 과 무관하고, NS 가 [21, 25] 다.
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0TRQ),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0TRY) {
    return {
      tones: tone === 3 ? 3 : 2,
      // ⭐ **하드핀 해제 (2026-08-25, 레인 QR25)** — v0TY 와 같은 근거다.
      // 슬롯은 far (n−m, n−m) 이라 이미 n 일반화돼 있고, NS 가 [21, 25] 다.
      version: versionY === 2 ? 2 : 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V0TRY),
    };
  }
  if (locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V1R2) {
    return {
      tones: tone === 3 ? 3 : 2,
      // v1r2 는 n=21 뿐이다 — 버전 선택과 무관하게 Y1 로 고정한다.
      version: 1,
      cellSurface: true,
      cellSurfaceLayout: assertCellSurfaceFinalId(CELL_SURFACE_FINAL_V1R2),
    };
  }
  if (fallback.mode === 'window') {
    return { tones: WINDOW_SUPPORTED_TONES, version: WINDOW_SUPPORTED_VERSION, window: true };
  }
  const opts = { tones: tone };
  if (versionY !== undefined) opts.version = versionY;
  return opts;
}

/**
 * 중앙 QR은 중앙 슬롯을 독점한다. 특히 실험판의 기본 파인더가 cell-mask일 때도
 * finderPatternId를 생략해 기본값으로 되돌아가지 않도록 여기서 명시한다.
 */
export function sceneOptionsForOA({
  centralN7Emphasis,
  fallback,
  finderPatternId,
  palette,
  qrText,
  type,
}) {
  if (fallback === null || typeof fallback !== 'object') {
    throw new TypeError('O/A QR 폴백 상태가 필요하다');
  }
  if (type !== 'O' && type !== 'A') {
    throw new RangeError('sceneOptionsForOA는 Type O 또는 A만 받는다: ' + type);
  }

  const centerQr = fallback.mode === 'center';
  const opts = {
    palette,
    centerQr,
    finderPatternId: centerQr ? CENTER_QR_FINDER_PATTERN_ID : finderPatternId,
  };
  // 중앙 TL family는 QR 위치가 아니라 바깥 타입의 속성이다. 실제 N7 렌더가 선택된
  // 모든 O/A 경로에서 여기서 유도해, 호출자가 옵션을 손으로 덧붙이는 사본을 만들지 않는다.
  if (isCentralMarkerN7FinderPatternId(opts.finderPatternId)) {
    opts.centralMarkerN7Family = centralMarkerN7FamilyForType(type);
  }
  if (opts.finderPatternId === CENTRAL_N7_FINDER_PATTERN_ID) {
    opts.centralN7Family = centralN7FamilyForType(type);
  }
  // 강조 축은 family 보다 넓다 — 정본 판정은 renderKind 유도이고 (2026-09-07 (B))
  // 오늘의 값 표는 중앙 TL · 중앙 Y0 · 중앙 M7 이다 (3톤 큐브는 2026-08-29 §2.4 실측
  // 거부라 여기 없다). 참이면 중앙 슬롯뿐 아니라 **바깥 코드 셀 전부**가 같은 치환을
  // 받는다 — 그래서 이 한 줄이 «검출기 강조» 의 실질 게이트다.
  // centerQr 이면 finderPatternId 가 center-qr 로 이미 양보돼 있어 여기서 걸리지 않는다.
  if (centralN7EmphasisAppliesTo(opts.finderPatternId) && centralN7Emphasis !== undefined) {
    opts.centralN7Emphasis = centralN7Emphasis;
  }
  let needsCornerQr = false;
  if (centerQr) {
    opts.qrText = qrText;
    opts.cornerToo = Boolean(fallback.cornerToo);
    needsCornerQr = opts.cornerToo;
  } else if (fallback.mode === 'corner') {
    opts.qrText = qrText;
    opts.qrCorner = fallback.corner;
    needsCornerQr = true;
  }
  /*
   * 배치 불변 정책 (생성기 앱 레이어) — 코너 QR 이 안 그려지는 경로(안쪽 QR·없음)에서도
   * margin 을 코너 QR 구성과 같은 20 으로 유지한다. scene.js 의 라이브러리 기본(2)을
   * 여기서 덮는 이유: 기본대로 두면 Type O V1 기준 scene 이 62.517×60 → 26.517×24 로
   * 줄고, 미리보기는 한 축을 항상 100% 채우므로 코드가 2.4~2.5배 «확대» 돼 보인다 —
   * QR 배치를 바꿔 가며 스캔 성능·미리보기를 비교할 수 없다 (운영자 2026-08-23).
   * 원래 A 전용 구제였던 것을 O 로 확장했다. 라이브러리 기본(2)은 임베더 계약이라
   * 그대로 두고, «여백 없음» 내보내기의 trim 표(export-options.js)도 별개 기능이라
   * 건드리지 않는다 — margin 정본은 세 층이 각자 소유한다는 뜻이 아니라, 이 줄이
   * «생성기 화면·산출물의 배치 정책» 단일 소유자라는 뜻이다.
   */
  if (!needsCornerQr) opts.margin = 20;
  return opts;
}

/**
 * 중앙 슬롯 **비컨** 파인더 → 인코더 플래그. 중앙 QR 이 켜져 있으면 아무것도 안 준다
 * (중앙은 하나만 먹는다).
 *
 * ⚠ **이 유도가 존재하는 이유는 손 사본이 실제로 늙었기 때문이다.** 종전에는
 * `index.html` 의 디스패치 안에만 있었고, `test/generator-finder-dom.test.js` 의
 * 하네스가 같은 규칙을 손으로 다시 적어 두고 있었다. 그 사본은 `daehanFinder` 만
 * 알아서, 새 중앙 비컨(centralN7)이 붙자 하네스만 `centralN7 불일치` 로 죽었다.
 * 새 점유자가 늘 때 **한 곳만 고치면 되도록** 여기 한 번만 적는다.
 *
 * daehan 은 여기 넣지 않는다 — 이 유도는 «중앙 슬롯 **비컨**» 전용이고, daehan 은
 * 회계까지 바꾸는 셀 파인더라 층이 다르다. daehanFinder 플래그는 O/A/K 디스패치가
 * 각자의 else-if 체인(코너 자리와의 우선순위 해소) 안에서 같은 술어
 * (isDaehanFinderPatternId + !centerQr)로 싣는다 — K 도 2026-08-29 개설로 같은
 * 모양이 됐다 (세 분기 대조 자: test/finder-daehan-vk.test.js §배선).
 */
export function centralBeaconEncoderOptions(finderPatternId, centerQr) {
  if (centerQr) return {};
  if (isCentralV0FinderPatternId(finderPatternId)) return { centralV0: true };
  if (finderPatternId === CENTRAL_N7_FINDER_PATTERN_ID) return { centralN7: true };
  return {};
}
