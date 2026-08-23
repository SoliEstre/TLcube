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
import {
  CENTER_QR_FINDER_PATTERN_ID, CENTRAL_V0_FINDER_PATTERN_ID,
} from './finder-selection.js';
import { OAK_ALL_FINDER_PATTERNS, OAK_FINDER_PATTERNS } from './finder-oak-patterns.js';
import { OAK_LINEUP } from './finder-oak-lineup.js';
import { DAEHAN_FINDER_PATTERNS } from './finder-daehan.js';

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

// ⚠ OAK 후보(2026-08-18)는 `FINDER_PATTERNS` 에 **없다** — 생성 도구 산출물이
// 아니라 별도 표다(finder-oak-patterns.js 헤더). 그래서 이 필터는 예전과 같은
// 8개를 그대로 집는다. 만약 언젠가 OAK 가 생성 도구로 흡수되면 여기 8이 먼저
// 터지고, 그때는 «흡수했으니 필터를 좁혀라» 가 정답이다.
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

if (OAK_FINDER_PATTERNS.length === 0) {
  throw new Error('OAK 파인더 카드가 비었다 — 편입했는데 표가 없다');
}

// daehan 대표 템플릿 — 79셀 정본(k=10). 위 자기검증들과 같은 관례로 로드 시점에 죽는다.
const DAEHAN_K10 = DAEHAN_FINDER_PATTERNS.find((pattern) => pattern.k === 10);
if (!DAEHAN_K10 || !Array.isArray(DAEHAN_K10.finderCells) || DAEHAN_K10.finderCells.length !== 79) {
  throw new Error('daehan k10 정본(79셀)이 없다 — 표가 바뀌었으면 카드 대표도 같이 정해라');
}

/** 생성 패턴 표 밖의 중앙 v0 카드 — 기존 그룹 계보·개수 계약과 분리한다. */
export const CENTRAL_V0_FINDER_CARD = descriptor(CENTRAL_V0_FINDER_PATTERN_ID, null);

export const FINDER_CARD_GROUPS = Object.freeze({
  // 사용자 지시 2026-08-13: 하이브리드를 두 번째로 — 실사진에서 실제로 읽히는 큐브
  // 선택지가 이쪽이고, 순수 3톤 큐브는 정지 사진 0/6 이라 뒤로 민다.
  formal: Object.freeze([
    descriptor(LEGACY_FINDER_PATTERN_ID, null),
    descriptor(CUBE_BULLSEYE_FINDER_PATTERN_ID, getFinderPattern(CUBE_BULLSEYE_FINDER_PATTERN_ID)),
    descriptor(THREE_TONE_CUBE_FINDER_PATTERN_ID, getFinderPattern(THREE_TONE_CUBE_FINDER_PATTERN_ID)),
    descriptor(CENTER_QR_FINDER_PATTERN_ID, null),
  ]),
  generated: Object.freeze(generatedPatterns.map((pattern) => descriptor(pattern.id, pattern))),
  refined: Object.freeze(refinedPatterns.map((pattern) => descriptor(pattern.id, pattern))),
  // O/A/K 후보 (2026-08-18) — 운영자 편집기 export 계보. 이진 후보들과 **다른 줄**에
  // 두는 이유: 출처가 다르고(탐색 산출물 vs 손작업), 표현이 다르며(면당 3레벨),
  // 지위 관리도 별도 명부(finder-oak-lineup.js)가 한다. 한 줄에 섞으면 «이 카드가
  // 어느 계보인가» 를 이름으로 못 읽는다.
  // 카드는 **렌더 표현 전부**에서 유도한다 (2026-08-23) — 렌더 전용
  // oak-taegeuk-solo 포함. 카드로 고르는 것은 «그리기» 이지 검출 편입이 아니다
  // (daehan 카드가 기본 검출 라인업 밖인 것과 같은 관계).
  // 명부 live-join (C1, 2026-08-23) — 카드는 «렌더 가능 ∩ 명부 active» 다. 명부에서
  // 드랍하면 카드·(카드 유도인) 상태 스키마가 따라 닫힌다 — 사본이 아니라 유도.
  // 패턴 표·검출 라인업은 건드리지 않는다 (발행분 판독 유지 — Benzene 전례).
  oak: Object.freeze(OAK_ALL_FINDER_PATTERNS
    .filter((pattern) => {
      const row = OAK_LINEUP.find((entry) => entry.id === pattern.params.candidate);
      return row ? row.status === 'active' : true;
    })
    .map((pattern) => descriptor(pattern.id, pattern))),
  // daehan (2026-08-19 UI 편입) — **카드는 한 장**이다. 표에는 k=6/8/10 세 템플릿이
  // 있지만 그건 잘림본이고(k6 ⊂ k8 ⊂ k10), 어느 것을 그릴지는 **버전이 정한다**
  // (V1↔k6 · V2↔k8 · V3↔k10). 카드를 셋으로 쪼개면 사용자가 버전과 모순되는 k 를
  // 고를 수 있게 된다. 대표 id 는 79셀 정본인 k10 — 직전 라운드 측정들이 이미 쓰는
  // 문자열이라 바꾸면 그 측정들과의 대조가 끊긴다 (finder-daehan.js §56-58).
  // 2026-08-21: 분류 층은 taegeuk(내부 19)+sagoae(예약) 로 갈리지만 카드는 합성
  // 한 장을 유지한다. 라벨만 갈랐다 (g569). 와이어 id 는 oak-daehan-k10.
  daehan: Object.freeze([descriptor(DAEHAN_K10.id, DAEHAN_K10)]),
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
