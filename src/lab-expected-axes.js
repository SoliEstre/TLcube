/**
 * lab-expected-axes.js — 시험판 「기대」 선택의 **축 정본** (2026-08-19, 운영자 지시).
 *
 * ─ 왜 생겼나 ───────────────────────────────────────────────────────────────
 * 시험판의 「기대 레이아웃」은 한 줄뿐이었고 그 한 줄이 **셀 표면 레이아웃 한 축**만
 * 담았다 (`CELL_SURFACE_FINAL_ACTIVE_IDS` 와 양방향으로 묶여 있다 —
 * `test/lab-expected-layout-ui.test.js`). 그런데 운영자 신고는 그 축의 이야기가 아니었다:
 *
 *   · 「신규 3개 셀 표면 파인더(Niteogen·Aspirin·Benzene) 전부 인식 안 됨」 → **중앙 파인더 축**
 *   · 「외곽 파인더는 별도 선택이어야 함」                                  → **외곽 축**
 *
 * 한 축에 몰아넣으면 「무엇이 안 잡혔는가」를 못 가른다. 그래서 축을 셋으로 나눈다:
 *
 *   | 축 | 무엇 | 텔레메트리 필드 | 정본 |
 *   |---|---|---|---|
 *   | ① 셀 표면 레이아웃 | v0 · v0t · v0ty · v0tr · v0trq | `locatorLayout` | `CELL_SURFACE_FINAL_ACTIVE_IDS` |
 *   | ② 중앙 파인더 | 불스아이 · 속큐브 · 3톤큐브 · QR · cell-mask 11 · OAK 3 | `finderPatternId` | **이 파일** |
 *   | ③ 외곽/자리 예약 | 없음 · sagoae(키 `daehan`) · A-CM · O-CM | `outerFinderId` | **이 파일** |
 *
 * ①의 정본과 의미는 **한 값도 안 바뀐다.** 기존 회귀가 그 명제를 잠그고 있고,
 * 이 파일은 ①을 아예 언급하지 않는다.
 *
 * ─ 규약 (①의 것을 그대로 물려받는다) ─────────────────────────────────────
 * **검출 라인업에 있는 것만 버튼이 있다.** 라인업에 없는 것을 «기대» 로 고를 수 있으면
 * 그 프레임의 텔레메트리는 영원히 미스로 남는다 — 즉 계기가 눈이 먼다.
 * 그래서 ②의 목록을 손으로 적지 않고 **검출기가 실제로 쓰는 표에서 유도한다**
 * (`bootstrap.js` 의 `CELL_FINDER_LINEUP` 과 같은 출처·같은 순서).
 *
 * ⚠ daehan(`oak-daehan-k6/k8/k10`)은 ②가 아니라 ③이다. 구현상 셀 파인더 라인업에
 *   옵트인으로 얹히지만 (`cellFinderDaehan`), 운영자에게 그것은 «외곽 사괘» 이고
 *   고르는 자리도 거기다. 그리고 k 는 검출로 못 가른다 (포함 사슬 —
 *   `bootstrap.js` cellFinderHypotheses 주석) 이므로 k별 버튼도 두지 않는다.
 *
 * ⚠ 2026-08-21 분류 재편: 텔레메트리 키 `daehan` 은 **유지**한다 (기존 프레임의
 *   expected_outer 가 그 문자열을 든다). 분류상 그 내용은 sagoae (분류 2, 중심부
 *   기준). 내부 19셀 taegeuk 은 분류 1 이지만 축② 버튼을 따로 두지 않는다 —
 *   합성 템플릿의 안쪽이라 다른 19셀 후보와 자리를 다툰다. a-cm / o-cm 은
 *   파인더가 아니라 자리 예약 (기본 파인더 H2O / H).
 */

import {
  CUBE_BULLSEYE_FINDER_PATTERN_ID,
  FINDER_CELL_MASK_PATTERNS,
  LEGACY_FINDER_PATTERN_ID,
  THREE_TONE_CUBE_FINDER_PATTERN_ID,
} from './finder-patterns.js';
import {
  CENTER_QR_FINDER_PATTERN_ID,
  CENTRAL_V0_FINDER_PATTERN_ID,
} from './finder-selection.js';
import { OAK_FINDER_PATTERNS } from './finder-oak-patterns.js';
import { CENTRAL_N7_EMPHASIS_MODES } from './centralN7Emphasis.js';

/**
 * ② 중앙 파인더의 활성 라인업. 순서는 «운영자가 순위로 부른 넷 → cell-mask → OAK →
 * 중앙 v0(비컨)» 다 (넷·cell-mask·OAK 는 신고문 순서 — 화면에서 찾는 순서와 같게 둔다.
 * central-v0 는 F-40, 2026-08-23 등재라 뒤에 선다).
 *
 * central-v0 는 `finder-selection.js` 의 id 상수에서 **유도**한다 — 검출기
 * (`central-beacon-adapt.js` CENTRAL_BEACON_FINDER_KIND)와 렌더(`scene.js`)가 같은
 * 문자열을 쓰는 살아 있는 생산 파인더인데 이 축에 없어서, 비컨 프레임의 실기기
 * 텔레메트리가 전부 «모름» 으로 떨어져 expected/observed A/B 를 처음부터 못 했다.
 */
export const LAB_CENTRAL_FINDER_IDS = Object.freeze([
  LEGACY_FINDER_PATTERN_ID,
  CUBE_BULLSEYE_FINDER_PATTERN_ID,
  THREE_TONE_CUBE_FINDER_PATTERN_ID,
  CENTER_QR_FINDER_PATTERN_ID,
  ...FINDER_CELL_MASK_PATTERNS.map((pattern) => pattern.id),
  // ⚠ 2026-08-23 W2: `oak-footprint` 는 여기(검출 표 유도)로 자동 등재된다.
  //   `oak-taegeuk-solo` 는 **일부러 없다** — 렌더 전용이라 검출 라인업 밖이고
  //   (OAK_RENDER_ONLY_FINDER_PATTERNS — daehan 부분집합 오수용 실측), 라인업에
  //   없는 것을 «기대» 로 고를 수 있으면 그 프레임의 텔레메트리는 영원히 미스다
  //   (이 파일 상단 규약). 검출 편입(통합자)이 되는 날 스프레드가 자동으로 따라온다.
  ...OAK_FINDER_PATTERNS.map((pattern) => pattern.id),
  CENTRAL_V0_FINDER_PATTERN_ID,
]);

/**
 * ③ 외곽 파인더 / 자리 예약.
 *
 * `none` 은 «모름» 과 **다른 값**이다 — 「외곽 파인더가 없는 코드를 찍고 있다」는
 * 적극적 관측이고, 「안 골랐다」와 섞으면 그 구분이 사라진다.
 *
 * `daehan` 은 레거시 키 — 분류 표시는 sagoae. `a-cm`/`o-cm` 은 자리 예약이지
 * 파인더가 아니다. 아직 시험판 UI 에서 고를 일이 드물지만 **자리를 지금 잡아 둔다** —
 * 나중에 값을 더하면 그 전 프레임들이 「미상」과 「없음」 사이에서 애매해진다.
 */
// H (2026-08-24) — O-CM 자리의 심볼 파인더가 생성 축을 얻어 기대값으로도 유효하다.
// 검출 배선 전이라 관측률은 0 이 정상 — 이 축이 배선 완료를 재는 자가 된다.
// v-cm (2026-08-24) — 턴A(내부 타입 V)의 A-CM 사상이 실체가 되어 기대값으로 유효하다.
// k-cm (2026-08-25) — 레인 KCM 이 star 축 formatIndex 8 승격을 닫아 **생성·판독이 다
//   선다**. 등재가 늦으면 K-CM 프레임의 텔레메트리가 전부 «모름» 으로 떨어져
//   expected/observed A/B 를 못 한다 (이 파일 상단 규약 — v-cm 이 지나온 길).
export const LAB_OUTER_FINDER_IDS = Object.freeze(
  ['none', 'daehan', 'a-cm', 'o-cm', 'H', 'v-cm', 'k-cm'],
);

/** 시험판 버튼이 넘겨온 값이 축 ②의 유효 값인가. 아니면 null(모름). */
export function normalizeCentralFinderId(value) {
  return LAB_CENTRAL_FINDER_IDS.includes(value) ? value : null;
}

/** 시험판 버튼이 넘겨온 값이 축 ③의 유효 값인가. 아니면 null(모름). */
export function normalizeOuterFinderId(value) {
  return LAB_OUTER_FINDER_IDS.includes(value) ? value : null;
}

/**
 * ④ 중앙 강조 변이 (2026-08-29). 「강조 변이별 라이브 프레임 성공률」을 가르는 축 —
 * gen 행의 emphasis(010)만으로는 라이브 프레임과 붙일 수 없었다 (스캐너 frame 은
 * config_id 를 싣지 않는다, 실측 0/357). ②·③과 같은 규약이다: 목록은 손으로 적지
 * 않고 렌더·인코더가 쓰는 정본(`centralN7Emphasis.js` CENTRAL_N7_EMPHASIS_MODES)에서
 * 유도한다. 라인업 밖 값(저장·URL 등 옛 값 포함)은 null(모름)로 떨어진다.
 */
export const LAB_EMPHASIS_MODES = Object.freeze([...CENTRAL_N7_EMPHASIS_MODES]);

/** 시험판 버튼이 넘겨온 값이 축 ④의 유효 값인가. 아니면 null(모름). */
export function normalizeExpectedEmphasis(value) {
  return LAB_EMPHASIS_MODES.includes(value) ? value : null;
}
