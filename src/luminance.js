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

/**
 * 프리셋 저자 품질 바 — SPEC 최소치(0.12)보다 여유를 둔 내부 기준. 기존
 * 'slate' 테스트가 이미 이 값을 관례로 썼다(>= 0.15) — 신규 프리셋도 동일 바를
 * 모듈 로드 시 자동 단언한다(수기 스크래치 검증에 의존하지 않는다).
 */
export const PRESET_DELTA_MIN = 0.15;

/** SPEC §14 U17: 2톤 렌더용 최소 대비비 ρ = Y(levels[2]) / Y(levels[0]). */
export const RHO_MIN_CONTRACT = 10;

/** 프리셋 배경과 각 레벨 사이 최소 분리 (Y, 0..1) — 기존 slate 관례를 일반화. */
export const PRESET_BG_SEPARATION_MIN = 0.05;

/** SPEC §5.1: 불스아이 파인더 마커 — 최대 대비, Δmin 계약과 무관. */
export const BULLSEYE_DARK = Object.freeze({ r: 0, g: 0, b: 0 });
export const BULLSEYE_LIGHT = Object.freeze({ r: 255, g: 255, b: 255 });

/**
 * 중앙 3톤 큐브 파인더의 세 면 색 — **프리셋과 무관한 포맷 상수**다.
 *
 * 처음엔 데이터 레벨(`palette.levels[rank]`)을 그대로 썼다. 「데이터와 같은 알파벳을
 * 쓴다」가 설계 의도였지만 실촬영에서 그게 결함이 됐다(2026-08-12, 통제 실험 큐브 0/6 ·
 * 불스아이 5/6):
 *
 *   최상위 면이 levels[2] 라 밝은 배경과의 분리가 slate 0.230 · **mono 0.087** 뿐이다.
 *   자기 이웃 면(0.244)보다 배경(1.0)에 가까워서, 화면 반사·글레어가 끼면 그 면이
 *   배경 모델에 흡수된다. 그러면 큐브가 **2면 쐐기**가 되고 hull 의 대각이 안 모여
 *   (잔차 0.70 vs 임계 0.14) 실루엣 후보에서 탈락한다 — 실패 사진 5장에는 큐브 크기의
 *   연결요소가 아예 없었다.
 *
 * 그래서 휘도를 **범위 안쪽으로** 당겼다. 색조는 slate 계열을 유지해 인상은 보존한다.
 * 세 지표가 모두 좋아진다(상대휘도):
 *
 *   흰 배경 ↔ 최상위 면 여유 : 0.230 → 0.380
 *   검은 배경 ↔ 최하위 면 여유: 0.061 → 0.101
 *   면 간 최소 간격          : 0.182 → 0.198
 *
 * ⚠ 프리셋을 따라가면 안 되는 이유: 파인더는 **검출 기구**다. 프리셋마다 분리가 달라지면
 *   (mono 가 특히 나빴다) 같은 검출기가 프리셋에 따라 되고 안 되고 한다. 데이터 셀은
 *   프리셋을 따르고, 파인더는 따르지 않는다 — 불스아이가 이미 그 규약이다(위 두 상수).
 *
 * 순서는 rank 인덱스와 같다: [0] = 가장 어두움 · [1] = 중간 · [2] = 가장 밝음.
 */
export const FINDER_CUBE_TONES = Object.freeze([
  Object.freeze({ r: 0x4a, g: 0x57, b: 0x89 }),
  Object.freeze({ r: 0x79, g: 0x94, b: 0xd1 }),
  Object.freeze({ r: 0xc8, g: 0xcf, b: 0xda }),
]);

/**
 * sRGB 8bit 채널 → 선형 채널. IEC 61966-2-1 (sRGB 표준 EOTF).
 * @param {number} v8 0..255 정수
 * @returns {number} 0..1
 */
/**
 * 0..255 정수 입력에 대한 사전 계산 표.
 *
 * 정의역이 **정확히 256개**라 표가 실수 계산을 완전히 대체한다 — 근사가 아니라 같은 식을
 * 미리 돌려 담은 것이므로 **비트 단위로 동일**하다.
 *
 * 왜 필요한가: 복호는 픽셀마다 이 함수를 3번 부른다. 1440×1920 프레임이면 약 830만 번의
 * `Math.pow` 다. 실측 프로파일에서 이 함수 하나가 self 7.5% 를 먹었다(2026-08-11).
 */
const SRGB_TO_LINEAR = new Float64Array(256);
for (let v = 0; v < 256; v += 1) {
  const c = v / 255;
  SRGB_TO_LINEAR[v] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function srgbChannelToLinear(v8) {
  // 표는 0..255 **정수**에만 쓴다. 렌더 경로(sceneY 의 게인 보정 등)가 소수를 넘길 수
  // 있는데, 그때 반올림해서 표를 쓰면 값이 조용히 달라진다.
  if (Number.isInteger(v8) && v8 >= 0 && v8 <= 255) return SRGB_TO_LINEAR[v8];
  const c = v8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
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
 * `relativeLuminance` 의 8비트 전용 진입점 — 채널을 **0..255 정수로 이미 아는**
 * 자리에서만 쓴다 (canvas RGBA 등).
 *
 * 같은 `SRGB_TO_LINEAR` 표와 같은 계수·같은 덧셈 순서를 쓰므로 정수 입력에 대해
 * `relativeLuminance({r,g,b})` 와 **비트 단위로 같은 값**이다. 차이는 채널마다
 * 하던 `Number.isInteger` 가드와 인자 객체가 없다는 것뿐이다 — 픽셀당 3회씩,
 * 1440×1920 이면 830만 번의 가드였다.
 */
export function relativeLuminance8(r8, g8, b8) {
  return (
    0.2126 * SRGB_TO_LINEAR[r8] +
    0.7152 * SRGB_TO_LINEAR[g8] +
    0.0722 * SRGB_TO_LINEAR[b8]
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
 * ρ = Y(levels[2])/Y(levels[0]) ≈ 0.7699/0.0612 ≈ 12.58 >= 10 (U17).
 */
const SLATE = Object.freeze({
  name: 'slate',
  label: '슬레이트 블루 (Slate Blue)',
  background: Object.freeze({ r: 14, g: 16, b: 24 }),
  levels: Object.freeze([
    Object.freeze({ r: 58, g: 68, b: 108 }), // rank 0 (어두움)
    Object.freeze({ r: 110, g: 135, b: 190 }), // rank 1 (중간)
    Object.freeze({ r: 220, g: 228, b: 240 }), // rank 2 (밝음)
  ]),
});

/**
 * ember 프리셋 — 웜 앰버·다크 브라운. 노을/불빛 톤 인상. 실측 Y (node -e 스크래치,
 * repo 밖):
 *   background {18,11,7}    → Y ≈ 0.0038
 *   levels[0]  {108,52,16}  → Y ≈ 0.0568  (bg 분리 ≈ 0.0530 >= 0.05)
 *   levels[1]  {200,120,40} → Y ≈ 0.2587  (levels[0] 분리 ≈ 0.2018)
 *   levels[2]  {255,210,140}→ Y ≈ 0.6925  (levels[1] 분리 ≈ 0.4338)
 * presetDeltaMin('ember') = min(0.2018, 0.4338) ≈ 0.2018 >= 0.15.
 * ρ = Y(levels[2])/Y(levels[0]) ≈ 0.6925/0.0568 ≈ 12.19 >= 10 (U17).
 */
const EMBER = Object.freeze({
  name: 'ember',
  label: '엠버 (Ember)',
  background: Object.freeze({ r: 18, g: 11, b: 7 }),
  levels: Object.freeze([
    Object.freeze({ r: 108, g: 52, b: 16 }), // rank 0 (어두움)
    Object.freeze({ r: 200, g: 120, b: 40 }), // rank 1 (중간)
    Object.freeze({ r: 255, g: 210, b: 140 }), // rank 2 (밝음)
  ]),
});

/**
 * mono 프리셋 — 무채색 그레이. 인쇄 안전(단색 인쇄에서도 순위 판별 가능). 실측 Y
 * (node -e 스크래치, repo 밖):
 *   background {16,16,16}   → Y ≈ 0.0052
 *   levels[0]  {70,70,70}   → Y ≈ 0.0612  (bg 분리 ≈ 0.0561 >= 0.05)
 *   levels[1]  {150,150,150}→ Y ≈ 0.3050  (levels[0] 분리 ≈ 0.2437)
 *   levels[2]  {245,245,245}→ Y ≈ 0.9131  (levels[1] 분리 ≈ 0.6081)
 * presetDeltaMin('mono') = min(0.2437, 0.6081) ≈ 0.2437 >= 0.15.
 * ρ = Y(levels[2])/Y(levels[0]) ≈ 0.9131/0.0612 ≈ 14.91 >= 10 (U17).
 */
const MONO = Object.freeze({
  name: 'mono',
  label: '모노 (Mono, 인쇄 안전)',
  background: Object.freeze({ r: 16, g: 16, b: 16 }),
  levels: Object.freeze([
    Object.freeze({ r: 70, g: 70, b: 70 }), // rank 0 (어두움)
    Object.freeze({ r: 150, g: 150, b: 150 }), // rank 1 (중간)
    Object.freeze({ r: 245, g: 245, b: 245 }), // rank 2 (밝음)
  ]),
});

export const PRESETS = Object.freeze({
  slate: SLATE,
  ember: EMBER,
  mono: MONO,
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
 * 프리셋의 2톤 대비비 ρ = Y(levels[2]) / Y(levels[0]) (SPEC §14 U17 계약 검증용).
 * @param {string} name
 * @returns {number}
 */
export function presetRho(name) {
  const [y0, , y2] = presetLuminances(name);
  return y2 / y0;
}

/**
 * 프리셋 배경과 레벨들 사이 최소 분리 (Y, 0..1).
 * @param {string} name
 * @returns {number}
 */
export function presetBackgroundSeparation(name) {
  const preset = getPreset(name);
  const bgY = relativeLuminance(preset.background);
  const ys = presetLuminances(name);
  return Math.min(...ys.map((y) => y - bgY));
}

/**
 * 프리셋 계약 3종을 단언한다 (① 3톤 Δmin >= PRESET_DELTA_MIN ② 2톤 ρ >=
 * RHO_MIN_CONTRACT ③ 배경 분리 >= PRESET_BG_SEPARATION_MIN). 위반 시 던진다 —
 * 모듈 로드 시(아래) 전 프리셋에 대해 자동 실행되므로, 신규 프리셋을 추가하면서
 * 계약을 어기면 import 시점에 즉시 드러난다(수기 스크래치 검증에만 의존하지 않는다).
 * @param {string} name
 */
export function assertPresetContract(name) {
  const deltaMin = presetDeltaMin(name);
  if (!(deltaMin >= PRESET_DELTA_MIN)) {
    throw new Error(`프리셋 '${name}': Δmin=${deltaMin} 가 PRESET_DELTA_MIN(${PRESET_DELTA_MIN}) 미만이다`);
  }
  const rho = presetRho(name);
  if (!(rho >= RHO_MIN_CONTRACT)) {
    throw new Error(`프리셋 '${name}': ρ=${rho} 가 RHO_MIN_CONTRACT(${RHO_MIN_CONTRACT}) 미만이다`);
  }
  const bgSep = presetBackgroundSeparation(name);
  if (!(bgSep >= PRESET_BG_SEPARATION_MIN)) {
    throw new Error(`프리셋 '${name}': 배경 분리=${bgSep} 가 PRESET_BG_SEPARATION_MIN(${PRESET_BG_SEPARATION_MIN}) 미만이다`);
  }
}

// 모듈 로드 시 전 프리셋 자동 단언 — 등록된 프리셋이 계약을 어기면 import 시점에
// 즉시 터진다(런타임 호출 전에 잡는다, sceneY.js의 DEFAULT_FACE_GAINS 자기단언과
// 동일 패턴).
for (const presetName of Object.keys(PRESETS)) {
  assertPresetContract(presetName);
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
