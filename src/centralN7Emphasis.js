import { BULLSEYE_DARK } from './luminance.js';

export const CENTRAL_N7_EMPHASIS_MODES = Object.freeze(['default', 'locator', 'all']);
export const DEFAULT_CENTRAL_N7_EMPHASIS = 'default';

/**
 * **생성기 UI 의 초기 선택** — 라이브러리 기본(`DEFAULT_CENTRAL_N7_EMPHASIS`)과
 * 별개다 (finderPatternId 의 GENERATOR_DEFAULT ↔ DEFAULT 와 같은 관계).
 *
 * 'all' 인 근거: 운영자 실기 A2 비교 (2026-08-29) — 로케이터만/전체 모두 기본보다
 * 향상, 전체가 미묘하게 우세. ⚠ 라이브러리 기본은 'default' 그대로 둔다 — 그쪽은
 * emphasis 를 안 준 buildScene 호출자(임베더)의 계약이라, 바꾸면 기존 발행 출력의
 * 재생성이 조용히 달라진다.
 *
 * 저장 상태 마이그레이션: 해당 없음 (2026-08-29 실측 — 생성기 상태는 어디에도
 * 저장되지 않는다. index.html 의 localStorage 는 'tlcube-theme' 하나뿐이다).
 */
export const GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS = 'all';

export function assertCentralN7Emphasis(value = DEFAULT_CENTRAL_N7_EMPHASIS) {
  if (!CENTRAL_N7_EMPHASIS_MODES.includes(value)) {
    throw new RangeError(
      `알 수 없는 중앙 n=7 강조: ${value} (허용: ${CENTRAL_N7_EMPHASIS_MODES.join(', ')})`,
    );
  }
  return value;
}

function assertRgb(color, label) {
  if (color === null || typeof color !== 'object'
    || !['r', 'g', 'b'].every((channel) => Number.isFinite(color[channel]))) {
    throw new TypeError(`${label} RGB 색이 필요하다`);
  }
}

/**
 * 현재 팔레트의 밝은 레벨은 보존하고, 어두운 레벨을 순검정으로 고정한다.
 * 중간톤은 선형광이 아니라 **인코딩된 sRGB 8비트 채널 공간**에서 두 끝점의 산술
 * 중점을 가장 가까운 정수로 반올림한다. 이 선택은 색상 혼합이 아니라 명시된 렌더
 * 실험 축이며, 디코더가 읽는 순위 0 < 1 < 2는 그대로다.
 */
export function centralN7EmphasisLevels(levels) {
  if (!Array.isArray(levels) || levels.length !== 3) {
    throw new TypeError('중앙 n=7 강조에는 3단계 팔레트가 필요하다');
  }
  const light = levels[2];
  assertRgb(light, '밝은 레벨');
  const middle = Object.freeze({
    r: Math.round((BULLSEYE_DARK.r + light.r) / 2),
    g: Math.round((BULLSEYE_DARK.g + light.g) / 2),
    b: Math.round((BULLSEYE_DARK.b + light.b) / 2),
  });
  return Object.freeze([BULLSEYE_DARK, middle, light]);
}

/** 로케이터 30셀과 데이터 19셀이 각각 소비할 레벨 표를 선택한다. */
export function centralN7LevelPalettes(levels, emphasis = DEFAULT_CENTRAL_N7_EMPHASIS) {
  const mode = assertCentralN7Emphasis(emphasis);
  if (mode === DEFAULT_CENTRAL_N7_EMPHASIS) {
    return Object.freeze({ locator: levels, data: levels });
  }
  const emphasized = centralN7EmphasisLevels(levels);
  return Object.freeze({
    locator: emphasized,
    data: mode === 'all' ? emphasized : levels,
  });
}

// ⛔ 3톤 큐브용 톤 선택 함수(centralN7FinderTones)는 **여기 두지 않는다** — 그 확장은
// 2026-08-29 §2.4 왕복 자에서 거부됐다 (강조 dark 순검정이 어두운 프리셋 배경과의
// 차 0.0053 < 마스크 허용오차 0.018 로 배경에 먹혀 실루엣 검출 전패 — scene.js
// three-tone-cube 분기 주석 실측). 되살리려면 순검정 대신 FINDER_CUBE_SEAM 식
// 두-제약(배경 문턱 초과 + 최암면과의 분리) 앵커부터 다시 재라.
