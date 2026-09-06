// detector-emphasis-ui-model.js — 「검출기 강조」 섹션의 **결정 로직 전부**
//
// 왜 모듈인가 (2026-09-06, 010/020 리뷰 F3·F9·F10): 이 규칙들이 index.html 안에
// 있는 동안 자는 «성질» 이 아니라 **철자**를 쟀다. 소스 정규식 11개로는 가시성
// 게이트를 지워도(카드가 늘 보임), 키보드 가드를 주석 처리해도(비대상에서 Enter 로
// 상태 변경), 사유 노트의 `textContent` 배선을 지워도(요소는 보이는데 빈 줄) 전부
// 초록이었다 — 실측 변이 m3·m4·M4·M8.
//
// 그래서 결정은 여기 순수 함수로 있고, index.html 은 **칠하기만** 한다. 자는
// (타입 × 검출기 × 모드 × 고급노출) 격자에서 이 함수의 표를 잰다.

import { GENERATOR_TYPES } from './generator-types.js';
import { CENTRAL_N7_EMPHASIS_MODES } from './centralN7Emphasis.js';
import {
  DETECTOR_EMPHASIS_REASONS, detectorEmphasisApplicability,
} from './generator-render-config.js';

/**
 * 검출기 «선택» 이 중앙 파인더가 아니라 **로케이터 프로파일**인 타입.
 *
 * Type Y 의 화면에는 `#finderSection` 이 없고 `#yLocatorSection` 이 그 자리를 맡는다
 * (generator-state 의 `locatorProfileY`). 종전엔 이 사실이 `['O','A','K']` 라는
 * 손 목록 **두 벌**로 적혀 있었고, 그 여집합이 GENERATOR_TYPES 와 같다는 것을 아무도
 * 안 쟀다 — 그래서 노출 게이트 한 줄은 **항상 false** 인 죽은 코드였다 (F7).
 */
export const LOCATOR_DETECTOR_TYPE = 'Y';
if (!GENERATOR_TYPES.includes(LOCATOR_DETECTOR_TYPE)) {
  throw new Error('LOCATOR_DETECTOR_TYPE 이 GENERATOR_TYPES 에 없다');
}

/** 이 타입의 검출기가 **중앙 파인더**인가 (= 강조 축을 실을 수 있는 자리인가). */
export function hasCentralFinderAxis(type) {
  return GENERATOR_TYPES.includes(type) && type !== LOCATOR_DETECTOR_TYPE;
}

/**
 * 사유 → 문구 키. 정본 폐쇄집합은 generator-render-config `DETECTOR_EMPHASIS_REASONS`
 * 이고 여기는 표현 층의 배선이다 — 아래 자기검증이 둘의 어긋남을 로드 시점에 잡는다.
 */
export const DETECTOR_EMPHASIS_REASON_KEYS = Object.freeze({
  'cube-3tone': 'g1026',
  bwg: 'g1027',
  'not-yet': 'g1028',
});
for (const reason of DETECTOR_EMPHASIS_REASONS) {
  if (!DETECTOR_EMPHASIS_REASON_KEYS[reason]) {
    throw new Error('검출기 강조 사유 문구 키가 없다: ' + reason);
  }
}

/** 고급 전용 숨김-active 안내 (카드는 안 보이는데 선택은 살아 있다). */
export const DETECTOR_EMPHASIS_ADVANCED_HIDDEN_KEY = 'g1029';

/**
 * «이 타입엔 강조 배선이 아예 없다» — 타입 게이트에서 떨어졌는데 사유가 없을 때.
 *
 * 이 키가 필요한 이유 (F2): 종전 코드는 `editable ? null : applicability(...).reason`
 * 이라, 언젠가 Y 로케이터 강조가 실측돼 applicability 가 `applies:true` 로 뒤집히면
 * **사유 없는 비활성**(= 조용한 무시)으로 떨어졌다. 화면은 «왜 안 눌리는가» 를 못
 * 말하고, 그 상태를 금지한 주석만 남는다.
 */
export const DETECTOR_EMPHASIS_NO_AXIS_KEY = 'g1030';

/**
 * 정식(일반) 화면에서 **내리는** 강조 모드 — 고급 모드·시험판에서만 보인다.
 *
 * 운영자 실기 A2(2026-08-29 §3)에서 «로케이터만» 이 «강조» 에 밀린 중간 단계라
 * 정식 화면에서 내렸다. 폐쇄집합(CENTRAL_N7_EMPHASIS_MODES)은 3택 그대로다.
 */
export const ADVANCED_ONLY_EMPHASIS_MODES = Object.freeze(['locator']);
for (const mode of ADVANCED_ONLY_EMPHASIS_MODES) {
  if (!CENTRAL_N7_EMPHASIS_MODES.includes(mode)) {
    throw new Error('고급 전용 강조 모드가 폐쇄집합 밖이다: ' + mode);
  }
}

/**
 * 판정 입력이 되는 «검출기 id» — 타입마다 다른 필드에서 온다.
 *
 * 손으로 «Y 는 not-yet» 이라고 적으면, 언젠가 Y 로케이터 강조를 실측했을 때 화면만
 * 옛 답을 계속 말한다. 그래서 Y 도 **자기 검출기 id** 를 판정에 넣는다.
 */
export function detectorEmphasisDetectorId(state) {
  return state.type === LOCATOR_DETECTOR_TYPE
    ? state.locatorProfileY : state.finderPatternId;
}

/**
 * 「검출기 강조」 섹션이 **어떻게 보여야 하는가** — 순수 함수 하나.
 *
 * @param {{type: string, finderPatternId?: string, locatorProfileY?: string,
 *          centralN7Emphasis?: string}} state 생성기 정규 상태 (읽기만 한다)
 * @param {{advancedCardsVisible: boolean}} view 고급 전용 카드가 지금 보이는가
 *        (규칙 정본은 index.html `advancedOnlyCardsVisible()` — 모드·에디션은 DOM 축이라
 *         여기로 안 들인다. 이 함수는 그 **결과**만 받는다.)
 * @returns {{hidden: boolean, anchor: 'finder'|'yLocator', detectorId: string|undefined,
 *            editable: boolean, reason: null|string, advancedHiddenActive: boolean,
 *            cards: ReadonlyArray<{mode: string, advancedOnly: boolean, visible: boolean,
 *                                  active: boolean, disabled: boolean}>,
 *            noteKey: string|null}}
 */
export function emphasisSectionModel(state, view) {
  const type = state.type;
  const known = GENERATOR_TYPES.includes(type);
  const centralAxis = hasCentralFinderAxis(type);
  const detectorId = detectorEmphasisDetectorId(state);
  // 렌더 사슬이 쓰는 술어와 **같은 것**이다 (sceneOptionsForOA · K 디스패치).
  // 화면이 다른 술어를 쓰면 «켰는데 안 먹는» 상태가 된다.
  const applicability = detectorEmphasisApplicability(detectorId);
  const editable = centralAxis && applicability.applies;
  // 사유는 «축이 있는 타입» 에서만 검출기를 탓한다. 축 자체가 없는 타입(Y)의 답은
  // 검출기 사유가 아니라 «배선이 없다» 다 — 검출기 사유를 갖다 붙이면, 그 검출기의
  // 실측이 서는 날 화면이 조용히 «사유 없는 비활성» 으로 떨어진다.
  const reason = editable ? null : (centralAxis ? applicability.reason : null);

  const advancedCardsVisible = view.advancedCardsVisible === true;
  let advancedHiddenActive = false;
  const cards = CENTRAL_N7_EMPHASIS_MODES.map((mode) => {
    const advancedOnly = ADVANCED_ONLY_EMPHASIS_MODES.includes(mode);
    const visible = !(advancedOnly && !advancedCardsVisible);
    const active = mode === state.centralN7Emphasis;
    if (active && !visible) advancedHiddenActive = true;
    return Object.freeze({ mode, advancedOnly, visible, active, disabled: !editable });
  });

  const noteKey = reason ? DETECTOR_EMPHASIS_REASON_KEYS[reason]
    : !editable ? DETECTOR_EMPHASIS_NO_AXIS_KEY
      : advancedHiddenActive ? DETECTOR_EMPHASIS_ADVANCED_HIDDEN_KEY
        : null;

  return Object.freeze({
    // 섹션은 **사라지지 않는다** (결정 ⑭ (A)). 다만 생성기 타입이 아닌 값에서는
    // 그릴 근거가 없다 — 그게 이 게이트가 답하는 유일한 질문이고, 종전의
    // `!(oakType || type === 'Y')` 는 GENERATOR_TYPES 전수라 **항상 false** 였다.
    hidden: !known,
    anchor: centralAxis ? 'finder' : 'yLocator',
    detectorId,
    editable,
    reason,
    advancedHiddenActive,
    cards: Object.freeze(cards),
    noteKey,
  });
}
