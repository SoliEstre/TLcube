import { BULLSEYE_DARK } from './luminance.js';

export const CENTRAL_N7_EMPHASIS_MODES = Object.freeze(['default', 'locator', 'all']);
export const DEFAULT_CENTRAL_N7_EMPHASIS = 'default';

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
