/**
 * luminance.js — 휘도 레벨 프리셋 (SPEC §4.4, §5.1, §7.2)
 *
 * SPEC §4.4 계약 요지:
 * - 면의 휘도값은 §7.2 샘플 원판(내접원 부분 영역) 안의 상대휘도 **median** 이다.
 *   면 평균이 아니다. 이 모듈의 프리셋은 면을 평면 단색으로 채우는 것을 전제하므로
 *   (렌더러 책임 — 그라디언트·텍스처 없음) 원판 median = 그 색 자체의 상대휘도와 같다.
 *   즉 여기서 정의하는 레벨 Y 값이 곧 §7.2 계약 통계다.
 * - 순위 간 최소 분리폭: sRGB 상대휘도 Y 기준 Δmin >= 0.12 (0..1). 절대값·색상 선택은
 *   자유(§9) — 계약은 median 기준 순서와 분리폭뿐이다.
 * - SPEC §5.1: 불스아이는 파인더 마커라 Δmin 계약과 무관. 최대 대비 0.0/1.0 고정.
 *
 * RGB 리터럴은 런타임 솔버가 아니라 스크래치 계산(node -e, repo 밖)으로 실측해
 * 요건을 만족시킨 뒤 상수로 박아 넣었다 (결정성 — M0 완료 기준). 유도 근거는
 * 각 리터럴 옆 주석에 남긴다.
 */

import { digitToRanks } from './lehmer.js';

/** SPEC §4.4 계약: 순위 간 최소 분리폭 (sRGB 상대휘도 Y, 0..1). */
export const DELTA_MIN_CONTRACT = 0.12;

/** SPEC §5.1: 불스아이 파인더 마커 — 최대 대비, Δmin 계약과 무관. */
export const BULLSEYE_DARK = Object.freeze({ r: 0, g: 0, b: 0 });
export const BULLSEYE_LIGHT = Object.freeze({ r: 255, g: 255, b: 255 });

/**
 * sRGB 8bit 채널 → 선형 채널. IEC 61966-2-1 (sRGB 표준 EOTF).
 * @param {number} v8 0..255 정수
 * @returns {number} 0..1
 */
export function srgbChannelToLinear(v8) {
  const c = v8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * sRGB 8bit {r,g,b} → 상대휘도 Y (ITU-R BT.709 계수, 선형화 후 가중합).
 * SPEC §4.4 의 "sRGB 상대휘도" 정의.
 * @param {{r: number, g: number, b: number}} rgb
 * @returns {number} 0..1
 */
export function relativeLuminance(rgb) {
  return (
    0.2126 * srgbChannelToLinear(rgb.r) +
    0.7152 * srgbChannelToLinear(rgb.g) +
    0.0722 * srgbChannelToLinear(rgb.b)
  );
}

/**
 * slate 프리셋 — 단색조 슬레이트 블루. 파랑 채널 우세·저채도로 "어두운 배경 위에
 * 뜬 아이소메트릭 큐브 필드" 인상을 노린다. 최상위 레벨(rank 2)은 흰색 쪽으로
 * 탈채도해 Y 를 끌어올렸다 (파랑 우세 색만으로는 Y 0.72 이상이 물리적으로 불가 —
 * 청색 BT.709 계수가 0.0722 로 가장 작기 때문).
 *
 * 실측 Y (node -e 스크래치 계산, repo 밖):
 *   background {14,16,24}   → Y ≈ 0.0053
 *   levels[0]  {58,68,108}  → Y ≈ 0.0612   (background 와 분리 ≈ 0.0559 >= 0.05)
 *   levels[1]  {110,135,190}→ Y ≈ 0.2436   (levels[0] 과 분리 ≈ 0.1824 >= 0.15)
 *   levels[2]  {220,228,240}→ Y ≈ 0.7699   (levels[1] 과 분리 ≈ 0.5263 >= 0.15)
 * presetDeltaMin('slate') = min(0.1824, 0.5263) ≈ 0.1824 >= 0.15 (계약 0.12 + 여유).
 */
export const PRESETS = Object.freeze({
  slate: Object.freeze({
    name: 'slate',
    label: '슬레이트 블루 (Slate Blue)',
    background: Object.freeze({ r: 14, g: 16, b: 24 }),
    levels: Object.freeze([
      Object.freeze({ r: 58, g: 68, b: 108 }), // rank 0 (어두움)
      Object.freeze({ r: 110, g: 135, b: 190 }), // rank 1 (중간)
      Object.freeze({ r: 220, g: 228, b: 240 }), // rank 2 (밝음)
    ]),
  }),
});

/** 기본 프리셋 이름. */
export const DEFAULT_PRESET = 'slate';

/**
 * 프리셋 조회.
 * @param {string} name
 * @returns {{name: string, label: string, background: {r,g,b}, levels: {r,g,b}[]}}
 */
export function getPreset(name) {
  if (!Object.prototype.hasOwnProperty.call(PRESETS, name)) {
    throw new RangeError(`등록되지 않은 프리셋: ${name} (허용: ${Object.keys(PRESETS).join(', ')})`);
  }
  return PRESETS[name];
}

/**
 * 프리셋의 레벨 3개를 실측 상대휘도로 변환. rank 0→2 순서(오름차순)를 유지한다.
 * @param {string} name
 * @returns {[number, number, number]}
 */
export function presetLuminances(name) {
  const preset = getPreset(name);
  return preset.levels.map((rgb) => relativeLuminance(rgb));
}

/**
 * 프리셋의 인접 순위 간 최소 분리폭 (SPEC §4.4 Δmin 계약 검증용).
 * @param {string} name
 * @returns {number}
 */
export function presetDeltaMin(name) {
  const [y0, y1, y2] = presetLuminances(name);
  return Math.min(y1 - y0, y2 - y1);
}

/**
 * digit → 각 면의 실제 색상. digitToRanks(digit) 로 (T,L,R) 순위를 얻어
 * 프리셋의 levels[rank] 에 매핑한다.
 * @param {number} digit 0..5
 * @param {string} name 프리셋 이름
 * @returns {{T: {r,g,b}, L: {r,g,b}, R: {r,g,b}}}
 */
export function faceColors(digit, name) {
  const preset = getPreset(name);
  const ranks = digitToRanks(digit);
  return {
    T: preset.levels[ranks.T],
    L: preset.levels[ranks.L],
    R: preset.levels[ranks.R],
  };
}
