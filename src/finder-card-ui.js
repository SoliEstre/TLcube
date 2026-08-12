// finder-card-ui.js — 생성기 중앙 파인더 카드의 표시 순서와 이벤트 바인딩
//
// 이 모듈은 카드의 데이터 순서와 클릭/키보드 활성화 경계를 한 곳에 둔다.
// 3톤 큐브는 19셀 마스크가 아니므로 정식 행에서 별도 표현으로 배치한다.

import {
  CUBE_BULLSEYE_FINDER_PATTERN_ID,
  FINDER_PATTERNS,
  LEGACY_FINDER_PATTERN_ID,
  THREE_TONE_CUBE_FINDER_PATTERN_ID,
  getFinderPattern,
} from './finder-patterns.js';
import { CENTER_QR_FINDER_PATTERN_ID } from './finder-selection.js';

function descriptor(id, pattern) {
  return Object.freeze({ id, pattern });
}

const threeTonePatterns = FINDER_PATTERNS.filter(
  (pattern) => pattern.id === THREE_TONE_CUBE_FINDER_PATTERN_ID,
);
if (threeTonePatterns.length !== 1
    || threeTonePatterns[0].renderKind !== 'three-tone-cube') {
  throw new Error('정식 3톤 큐브 파인더가 정확히 하나 필요하다');
}

const cubeBullseyePatterns = FINDER_PATTERNS.filter(
  (pattern) => pattern.id === CUBE_BULLSEYE_FINDER_PATTERN_ID,
);
if (cubeBullseyePatterns.length !== 1
    || cubeBullseyePatterns[0].renderKind !== 'cube-bullseye') {
  throw new Error('하이브리드(링+큐브) 파인더가 정확히 하나 필요하다');
}

const generatedPatterns = FINDER_PATTERNS.filter(
  (pattern) => pattern.renderKind === 'cell-mask' && pattern.family !== 'user-refined',
);
if (generatedPatterns.length !== 8) {
  throw new Error('생성 파인더 카드가 8개여야 한다: ' + generatedPatterns.length);
}

const refinedPatterns = FINDER_PATTERNS.filter(
  (pattern) => pattern.family === 'user-refined',
);
if (refinedPatterns.length !== 3) {
  throw new Error('사용자 개선 파인더 카드가 3개여야 한다: ' + refinedPatterns.length);
}

export const FINDER_CARD_GROUPS = Object.freeze({
  // 사용자 지시 2026-08-12: 정식 선택지 행은 이 순서다.
  // 하이브리드는 두 큐브 선택지가 붙어 보이도록 순수 큐브 바로 뒤에 넣는다.
  formal: Object.freeze([
    descriptor(LEGACY_FINDER_PATTERN_ID, null),
    descriptor(THREE_TONE_CUBE_FINDER_PATTERN_ID, getFinderPattern(THREE_TONE_CUBE_FINDER_PATTERN_ID)),
    descriptor(CUBE_BULLSEYE_FINDER_PATTERN_ID, getFinderPattern(CUBE_BULLSEYE_FINDER_PATTERN_ID)),
    descriptor(CENTER_QR_FINDER_PATTERN_ID, null),
  ]),
  generated: Object.freeze(generatedPatterns.map((pattern) => descriptor(pattern.id, pattern))),
  refined: Object.freeze(refinedPatterns.map((pattern) => descriptor(pattern.id, pattern))),
});

/**
 * 실제 카드 요소의 click/Enter/Space를 같은 활성화 경계로 묶는다.
 * DOM이 없는 회귀 대체에서도 이 공개적인 EventTarget 형태를 그대로 사용한다.
 */
export function wireFinderCardActivation(card, activate) {
  if (!card || typeof card.addEventListener !== 'function') {
    throw new TypeError('파인더 카드 EventTarget이 필요하다');
  }
  if (typeof activate !== 'function') {
    throw new TypeError('파인더 카드 활성화 콜백이 필요하다');
  }

  const onClick = () => activate();
  const onKeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate();
  };
  card.addEventListener('click', onClick);
  card.addEventListener('keydown', onKeydown);

  return () => {
    if (typeof card.removeEventListener !== 'function') return;
    card.removeEventListener('click', onClick);
    card.removeEventListener('keydown', onKeydown);
  };
}
