/**
 * cell-shape.js — 마름모 셀 꾸미기(셀 모양) 모듈 (DESIGN_001 §3.0 · §3.1 · §3.2 · §3.4 · §4.1)
 *
 * O/A/K(+C/G/V) 의 면과 Y 의 모듈은 **같은 60°/120° 마름모**다(변 = 1셀, 내접원
 * r_in = (√3/4)·변, `hexgrid.FACE_INRADIUS_COEFF` · `ygrid.js:21-24`). 그래서 두 생산자
 * (`scene.js` · `sceneY.js`)가 이 모듈 하나를 공유한다. 여기서 하는 일은 넷이다.
 *
 *   ① 등급 — `cellShapeTier(type, entry)`: 셀 역할 → T1(항상 사각) · T2(원판 보존 모양만) ·
 *      T3(모든 모양). 모르는 role · 모르는 타입은 **T1**(fail-closed, safety m5).
 *   ② 발자국 승격 — `promoteNearT0(faces, t0Shapes)`: 셀과 면을 나누는 T0 도형(중앙 QR ·
 *      불스아이 · n7 …)에서 1셀 미만인 T2/T3 면을 T1 로 올린다(safety M2). sqrt 만 쓴다.
 *   ③ 기하 — `shapeCellFace(points, color, spec, tier, cell)`: 마름모 한 면 → scene 도형 배열.
 *      dot 은 등급 외에 셀 단위 한정(Y 는 data 만, §3.2)이 있어 `cell = {type, entry}` 가
 *      있어야만 그린다(`cellShapeAllowedKinds`).
 *      꾸민 도형에는 **`basePoints`(꾸미기 전 꼭짓점)를 스스로 붙인다**(wiring M13) —
 *      안전영역·코너 QR 배치는 그 기하를 읽어야 꾸미기 켬/끔에서 판이 같다.
 *   ④ 해석 — `resolveCellShapeSpec(state, ctx, allow)`: 상태 + 렌더 문맥 + 허용표 →
 *      `{spec}` 또는 `{spec:null, lockReason}`. **상태를 고치지 않는다**(조용히 사각으로
 *      떨어뜨리지 않는다 — 잠금은 사유와 함께 보인다, wiring M10).
 *      **구조 잠금**(설계 1차 잠금 — 통합자 결정 2, 2026-09-26)은 허용표보다 먼저 건다: 표에
 *      행이 있어도 잠긴다(`cellShapeStructuralLock` · `CELL_SHAPE_STRUCTURAL_LOCK_REASONS`).
 *      **측정 구성 불일치**(2026-09-27)도 구조 잠금이다 — 표 행은 표 키 밖 축(코너 마커 · 사괘 · ECC · 실효 검출 강조)의
 *      한 값(`CELL_SHAPE_MEASURED_CONFIG`)에서만 잰 사실이라, 렌더 구성이 그와 다르면 표 키가 같아도 잠근다.
 *      사유는 반사실로 고른다 — **같은 표 키(같은 버전 · 파인더 · 틈 …)에서** 측정 구성 키만 바꾸면 표 행이 열릴 때만
 *      «자리 · ECC · 강조 탓»(seat-config · ecc-level · detector-emphasis), 아니면 설계 잠금 · 미확인 사유 그대로다(잠금 여부는
 *      같고 사유만 참이게 — 2026-09-27 검토). ⚠ 제품의 자동 버전은 구성을 바꾸면 재인코딩으로 버전(표 키)이 바뀔 수 있다 —
 *      그래서 와이어 축(자리 · ECC) 사유는 «제품 자동 경로가 측정 와이어 구성으로 **같은 표 키**에 닿는다» 가 참일 때만 낸다
 *      (보조 필드 `measuredStateAtTableKey` — 2026-09-28). 다른 표 키로 가면 그 키에 행이 있어도 unmeasured 다(따르면 열릴 수도
 *      있지만 표 키 고정 반사실로는 말하지 않는다 — 문구 «판독이 확인되지 않은 조합» 은 참).
 *      렌더 면 게인(face-gain — Y 큐브 입체감)도 측정 구성 축이다(측정 구성 키 밖 — `CELL_SHAPE_MEASURED_FACE_GAINS`).
 *      내보내기 축(export-dither · export-size — 2026-09-28 외부 검토)도 같다: 행은 비디더에서, 잰 하한(`MEASURED_FLOORS`)부터 위로 몇 점의
 *      ppu 에서 잰 사실이라, 지금 내보내기 계획이 디더를 걸거나 고정 · 커스텀 크기가 잰 하한 아래 ppu 를 내면 잠근다(렌더 값 `exportPlan` 이
 *      있을 때만 — 하한 위쪽은 단조 가정으로 연다: `CELL_SHAPE_LOCK_REASONS` 의 이름 붙인 축). H 셀 스타일 카드도 같은 판정이다.
 *      사유 축은 **정확히 하나**만 다를 때만 그 축이다 — 둘 이상이면 unmeasured(`CELL_SHAPE_LOCK_AXES`).
 *      표 키에는 길이가 없다 — 행은 그 표 키의 **측정 밴드**(제품 자동이 그 키를 고르는 길이)에서 잰 사실이라, 버전 고정 · Y 로케이터
 *      직접 선택으로 더 짧은 페이로드가 그 키에 닿으면(잰 적 없는 영 패딩) 같은 보조 필드가 거짓이라 잠근다.
 *   ⑤ 문맥 — `cellShapeCtx(type, encoded, state, render)`: 제품이 resolver 에 넘길 문맥을
 *      **한 벌만** 유도한다(통합자 결정 1 — 하네스도 이 함수를 import 한다, H 의
 *      `generator-h.hCellStyleCtx` 가 선례). `cellShapeAllowCtx(ctx)` 는 그 문맥을 허용표 행
 *      키(`table` + `CELL_SHAPE_ALLOW_KEYS[table]`)로 깎는다 — 영수증 행 allowCtx 모양.
 *
 * 결정성 계약(`raster.js:9` · `sceneY.js:10-11` 과 같다): 삼각함수 · Math.hypot ·
 * Math.random · Date 를 쓰지 않는다. 호의 점은 15° 간격 **닫힌 형태 표**(cos15 =
 * (√6+√2)/4 …)로 만든다 — 같은 입력이면 어느 엔진에서나 같은 비트가 나온다.
 *
 * 의존은 `luminance.js`(면 게인의 sRGB↔선형 · 팔레트 등급) · `cell-shape-allow.js`(허용표) ·
 * `finder-patterns.js`(불스아이 계열 id) · `locatorY.js`(hex-frame id) · `formatinfo.js`(ECC 레벨 이름) ·
 * `generator-types.js`(생성기 타입 목록 — 잰 하한 문맥의 실효 → 생성기 타입 유도)
 * 뿐이다 — 여섯 다 `tools/build-single.mjs` 와 `tools/build-finder-editor.mjs` 의 MODULE_ORDER 에서 이
 * 모듈보다 앞이다. ⛔ `cellSurfaceFinal.js`(슬롯 레이아웃 목록)는 build-single 에서 **뒤**라 import 할 수
 * 없다 — 슬롯 판정은 인코딩 결과의 `role:'slot'` 셀(코드 자체)에서 읽는다(`cellShapeCtx`).
 * ⛔ `generator-seat-auto.js`(자동 자리표)도 import 하지 않는다 — build-finder-editor 번들에 없다. 측정 구성
 * 선언(`CELL_SHAPE_MEASURED_CONFIG`)과 자동 자리표의 대조는 `test/cell-shape-measured-config.test.js` 가 한다.
 * ⛔ **`sceneY.js` 를 import 하지 않는다**(wiring B1 — scene.js 가 이 모듈을 import 하면
 * sceneY 를 끌어와 번들 위상이 꼬인다). `sceneY.applyFaceGain` 과 같은 계산을
 * `faceGainColor` 로 다시 구현하고, 비트 동일은 `test/cell-shape-geometry.test.js` 가 잠근다.
 *
 * 도형 형식은 scene 계약 그대로다: `{kind:'polygon', points:[{x,y}…], color:{r,g,b}}` ·
 * `{kind:'disc', cx, cy, r, color}`. 추가 키는 `basePoints` 와 `noSeam`(gap · dot —
 * seam stroke 가 줄눈을 메우지 않게 하려는 표지) 둘이다. ⚠ 기준 e28e215 의 `svg.js:163` 은
 * 아직 `s.qr` 만 읽는다 — `s.qr || s.noSeam` 으로 넓히는 것은 레인 L2b(DESIGN §4.2) 몫이고,
 * 그 전까지 `noSeam` 은 **효과가 없다**(gap · dot 에도 seam stroke 가 그려진다).
 */

import {
  srgbChannelToLinear, relativeLuminance, PRESET_BG_SEPARATION_MIN, PRESETS,
} from './luminance.js';
import * as DEFAULT_ALLOW from './cell-shape-allow.js';
import { FINDER_PATTERNS, LEGACY_FINDER_PATTERN_ID } from './finder-patterns.js';
import { LOCATOR_PROFILE_HEX_FRAME_V1 } from './locatorY.js';
import { ECC_NAME_BY_VALUE } from './formatinfo.js';
import { GENERATOR_TYPES } from './generator-types.js';

// ── 닫힌 형태 상수 ─────────────────────────────────────────────────────────────

const SQRT2 = Math.sqrt(2);
const SQRT3 = Math.sqrt(3);
const SQRT6 = Math.sqrt(6);

/** 마름모 내접원 반지름 계수: r_in = (√3/4)·변. `hexgrid.FACE_INRADIUS_COEFF` 와 같은 값. */
export const CELL_INRADIUS_COEFF = SQRT3 / 4;

/** §7.2 표본 원판 = 내접원 × 0.5 (`hexgrid.SAMPLE_FRACTION_DEFAULT`). 테스트·문서용 참조값. */
export const SAMPLE_DISC_FRACTION = 0.5;

/**
 * 60° 모서리 필렛 반지름 상한 계수: ρ60 ≤ (0.5/√3)·변 ≈ 0.289.
 * 60° 모서리의 접점 거리는 t = √3·ρ 라 이 상한에서 t = 0.5 — 변의 절반을 넘지 않는다.
 * (한 변은 60° 모서리와 120° 모서리가 나눠 쓴다: 0.5 + ρ120/√3 ≤ 0.5 + 0.25 < 1.)
 */
export const FILLET_60_CAP_COEFF = 0.5 / SQRT3;

/** bevel 코어 배율. 코어 내접 = 0.7·r_in ≈ 0.303 > 표본 원판 0.2165 · 띠 폭 0.3·r_in ≈ 0.13셀. */
export const BEVEL_CORE_SCALE = 0.7;

/**
 * 15° 간격 호 표 — k·15° (k = 0…8) 의 cos · sin. 삼각함수 없이 닫힌 형태로만.
 * 60° 모서리의 호는 120° = 8칸, 120° 모서리의 호는 60° = 4칸이다.
 */
export const ARC_STEP_COS = Object.freeze([
  1, (SQRT6 + SQRT2) / 4, SQRT3 / 2, SQRT2 / 2, 0.5, (SQRT6 - SQRT2) / 4, 0,
  -(SQRT6 - SQRT2) / 4, -0.5,
]);
export const ARC_STEP_SIN = Object.freeze([
  0, (SQRT6 - SQRT2) / 4, 0.5, SQRT2 / 2, SQRT3 / 2, (SQRT6 + SQRT2) / 4, 1,
  (SQRT6 + SQRT2) / 4, SQRT3 / 2,
]);
const ARC_STEPS_ACUTE = 8; // 60° 모서리 — 호 120°
const ARC_STEPS_OBTUSE = 4; // 120° 모서리 — 호 60°

// ── 어휘 · 파라미터 ────────────────────────────────────────────────────────────

/** 셀 모양 6종. `square` 는 현재 출력(바이트 동일 1순위). */
export const CELL_SHAPES = Object.freeze(['square', 'round', 'bevel', 'round-bevel', 'gap', 'dot']);

/** 기본 모양 = 꾸미기 끔(현재 출력). 상태 스키마 `cellShape` 의 기본값 정본. */
export const CELL_SHAPE_DEFAULT = 'square';

/**
 * 모양별 강도 파라미터 — 상태 키 · 도메인 · 기본값 (DESIGN_001 §2.2).
 * 강도 키는 모양마다 따로다(모양을 바꿨다 돌아와도 보존). `round-bevel` 은 고정(round 0.7 +
 * bevel 0.6)이라 여기 없고 `ROUND_BEVEL_FIXED` 에 있다.
 *   round f = 필렛 ρ / r_in · bevel gain = 선형광 띠 게인 · gap s = 줄눈 배율(상한 0.08) ·
 *   dot f = 원 반지름 / r_in.
 */
export const CELL_SHAPE_PARAMS = Object.freeze({
  round: Object.freeze({ key: 'cellRound', domain: Object.freeze([0.35, 0.7, 1.0]), default: 0.7 }),
  bevel: Object.freeze({ key: 'cellBevel', domain: Object.freeze([0.6, 1.4]), default: 0.6 }),
  gap: Object.freeze({ key: 'cellGap', domain: Object.freeze([0.04, 0.08]), default: 0.08 }),
  dot: Object.freeze({ key: 'cellDot', domain: Object.freeze([0.8, 1.0]), default: 0.8 }),
});

/** `round-bevel` 의 고정 조합. */
export const ROUND_BEVEL_FIXED = Object.freeze({ round: 0.7, bevel: 0.6 });

/**
 * 노출형 — 셀 아래 판·표면이 드러나는 모양(§3.0 safety M1 · B2). 실효 틈 등급이 측정된
 * 곳에서만 열린다. bevel 은 면을 다 덮으므로 비노출형이다.
 */
export const EXPOSED_CELL_SHAPES = Object.freeze(['round', 'round-bevel', 'gap', 'dot']);

// ── 등급 (§3.0) ────────────────────────────────────────────────────────────────

/** 등급 이름. T0 = 셀 루프 밖 도형(건드리지 않음) · T1 = 항상 사각 · T2 = 원판 보존 모양만 · T3 = 전부. */
export const CELL_TIERS = Object.freeze({ T0: 'T0', T1: 'T1', T2: 'T2', T3: 'T3' });

/**
 * 등급별 허용 모양(square 제외). dot 은 **T3 에만** 쓴다(§3.0). 단 등급만으로는 부족하다 —
 * Y 는 dot 을 data 에만 허용하므로(§3.2) 셀 단위 목록은 `cellShapeAllowedKinds` 를 쓴다.
 */
export const SHAPES_BY_TIER = Object.freeze({
  T2: Object.freeze(['round', 'bevel', 'round-bevel', 'gap']),
  T3: Object.freeze(['round', 'bevel', 'round-bevel', 'gap', 'dot']),
});

/** O 술어를 쓰는 타입 — O(C/G 포함) · A(V 포함) · K. 술어 표가 셋 다 같다(§3.0). */
const OAK_FAMILY_TYPES = Object.freeze(['O', 'C', 'G', 'A', 'V', 'K']);

/**
 * 셀 역할 → 등급 (렌더 시점, 발자국 승격 전). §3.0 술어표:
 *
 * | 타입 | T1 | T2 | T3 |
 * |---|---|---|---|
 * | O/A/K(+C/G/V) | role ∈ {anchor, marker} ∨ entry.tones | role ∈ {reference, format} | role ∈ {data, filler} |
 * | Y | role ∈ {locator, reference} | format | data · filler |
 *
 * - O/A/K 는 tones 가 없는 anchor 도 역할만으로 T1(정정 1 — «검출 요소는 꾸미지 않는다»).
 * - Y 는 tones 가 아니라 **role** 로 가른다(정정 2 — 구 레이아웃은 tones 없이 톤을 유도).
 * - 모르는 role(`bullseye` · `finder` · `slot` · 미래 role) · 모르는 타입(H 포함) · entry 없음 → T1.
 *
 * @param {string} type 'O' | 'C' | 'G' | 'A' | 'V' | 'K' | 'Y' (그 밖은 T1)
 * @param {{role?: string, tones?: unknown}} entry cellDigits 항목
 * @returns {'T1'|'T2'|'T3'}
 */
export function cellShapeTier(type, entry) {
  if (!entry || typeof entry !== 'object') return CELL_TIERS.T1;
  const role = entry.role;
  if (OAK_FAMILY_TYPES.includes(type)) {
    if (entry.tones) return CELL_TIERS.T1;
    if (role === 'anchor' || role === 'marker') return CELL_TIERS.T1;
    if (role === 'reference' || role === 'format') return CELL_TIERS.T2;
    if (role === 'data' || role === 'filler') return CELL_TIERS.T3;
    return CELL_TIERS.T1;
  }
  if (type === 'Y') {
    if (role === 'locator' || role === 'reference') return CELL_TIERS.T1;
    if (role === 'format') return CELL_TIERS.T2;
    if (role === 'data' || role === 'filler') return CELL_TIERS.T3;
    return CELL_TIERS.T1;
  }
  return CELL_TIERS.T1;
}

/**
 * dot 을 받을 수 있는 셀인가 — 등급과 **별개의** 규칙이다.
 *
 * - §3.0 은 «dot 은 T3 에만» 이고 T3 = data · filler 다(O/A/K 는 이것만 적용된다).
 * - §3.2 는 Y 에 더 좁은 한정을 건다: **data 만**. 대조군(로케이터까지 도트, v0TR21)이
 *   slate 에서 `no-format-candidate` 로 실패했기 때문이다. 그래서 Y filler 는 T3 이지만
 *   dot 을 받지 않는다(round · bevel · round-bevel · gap 은 그대로 받는다).
 * - 허용표 키(`CELL_SHAPE_ALLOW_KEYS.y`)에는 role 이 없다 — 표는 «코드 단위» 로 열고 이
 *   셀 단위 한정은 여기서만 걸린다. 그래서 `shapeCellFace` 는 셀 정체(`cell`)가 없으면
 *   dot 을 그리지 않는다(fail-closed).
 * 모르는 타입 · entry 없음 → false.
 */
function dotEligible(type, entry) {
  const role = entry && typeof entry === 'object' ? entry.role : undefined;
  if (OAK_FAMILY_TYPES.includes(type)) return role === 'data' || role === 'filler';
  if (type === 'Y') return role === 'data';
  return false;
}

/**
 * 이 셀이 받을 수 있는 모양 목록(square 제외). 등급(발자국 승격 뒤 값을 넘길 수 있다)의
 * 허용 모양에서, 셀 단위 dot 한정(`dotEligible`)을 뺀다. T0 · T1 · 모르는 등급 → [].
 * @param {string} type
 * @param {{role?: string, tones?: unknown}} entry
 * @param {'T0'|'T1'|'T2'|'T3'} [tier] 생략하면 `cellShapeTier(type, entry)`
 * @returns {string[]}
 */
export function cellShapeAllowedKinds(type, entry, tier = cellShapeTier(type, entry)) {
  const byTier = SHAPES_BY_TIER[tier];
  if (!byTier) return [];
  return byTier.filter((kind) => kind !== 'dot' || dotEligible(type, entry));
}

// ── 면 게인 (sceneY.applyFaceGain 재구현 — 비트 동일은 테스트가 잠근다) ──────────

/** 선형 채널(0..1) → sRGB 8bit(반올림, 클램프). IEC 61966-2-1 역변환 — sceneY 의 내부 헬퍼와 같은 식. */
function linearChannelToSrgb8(linear) {
  const clampedLinear = linear < 0 ? 0 : linear > 1 ? 1 : linear;
  const c = clampedLinear <= 0.0031308
    ? clampedLinear * 12.92
    : 1.055 * Math.pow(clampedLinear, 1 / 2.4) - 0.055;
  const v = Math.round(c * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * 색 {r,g,b} 에 선형광 게인을 곱한 색(채널별 sRGB→선형→×gain→sRGB).
 * `sceneY.applyFaceGain` 과 **같은 계산**이다 — 이 모듈이 sceneY 를 import 할 수 없어서
 * 옮겨 적었고, 사본이 어긋나면 `test/cell-shape-geometry.test.js` 가 빨개진다.
 */
export function faceGainColor(rgb, gain) {
  return {
    r: linearChannelToSrgb8(srgbChannelToLinear(rgb.r) * gain),
    g: linearChannelToSrgb8(srgbChannelToLinear(rgb.g) * gain),
    b: linearChannelToSrgb8(srgbChannelToLinear(rgb.b) * gain),
  };
}

/** bevel 띠가 실효 틈 색 · 배경과 떨어져야 하는 최소 휘도 차 (SPEC §7.1 셀 레벨–배경 분리 바닥). */
export const BEVEL_BAND_SEPARATION_MIN = PRESET_BG_SEPARATION_MIN;

/** 클램프 사다리 칸 수 — gain 에서 1(원색) 쪽으로 16등분해 첫 합격 칸을 쓴다(결정적). */
const BEVEL_CLAMP_STEPS = 16;

/**
 * bevel 띠 색. `avoid`(실효 틈 색 · 배경 {r,g,b} 목록)가 주어지면 띠 휘도가 그 각각과
 * ≥ 0.05 떨어질 때까지 gain 을 1 쪽으로 당긴다(§3.1 bevel «클램프»). 끝까지 못 떨어지면
 * 원색(= 띠 없음)이다 — 원색은 데이터 레벨이라 프리셋 계약이 이미 배경 분리를 진다.
 */
function bevelBandColor(color, gain, avoid) {
  if (!Array.isArray(avoid) || avoid.length === 0) return faceGainColor(color, gain);
  const avoidY = avoid.map((c) => relativeLuminance(c));
  for (let k = 0; k < BEVEL_CLAMP_STEPS; k += 1) {
    const g = gain + ((1 - gain) * k) / BEVEL_CLAMP_STEPS;
    const band = faceGainColor(color, g);
    const y = relativeLuminance(band);
    if (avoidY.every((ay) => Math.abs(y - ay) >= BEVEL_BAND_SEPARATION_MIN)) return band;
  }
  return { r: color.r, g: color.g, b: color.b };
}

// ── 마름모 기하 ────────────────────────────────────────────────────────────────

function isPoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * 60°/120° 마름모 틀 읽기. 꼭짓점 순서(시계 · 반시계)와 시작점은 자유다 — 각 꼭짓점의
 * 각을 두 변 단위벡터의 내적 부호(+½ = 60°, −½ = 120°)로 가른다. 마름모가 아니면 throw.
 */
function rhombusFrame(points) {
  if (!Array.isArray(points) || points.length !== 4 || !points.every(isPoint)) {
    throw new RangeError('shapeCellFace: 마름모 꼭짓점 4개({x,y})가 필요하다');
  }
  const sides = [];
  for (let i = 0; i < 4; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    sides.push(Math.sqrt(dx * dx + dy * dy));
  }
  const side = sides[0];
  if (!(side > 0) || sides.some((s) => Math.abs(s - side) > side * 1e-9)) {
    throw new RangeError(`shapeCellFace: 네 변 길이가 같지 않다(${sides.join(', ')})`);
  }
  const corners = [];
  for (let i = 0; i < 4; i += 1) {
    const v = points[i];
    const prev = points[(i + 3) % 4];
    const next = points[(i + 1) % 4];
    const lp = sides[(i + 3) % 4];
    const ln = sides[i];
    const uPrev = { x: (prev.x - v.x) / lp, y: (prev.y - v.y) / lp };
    const uNext = { x: (next.x - v.x) / ln, y: (next.y - v.y) / ln };
    const cos = uPrev.x * uNext.x + uPrev.y * uNext.y;
    let acute;
    if (Math.abs(cos - 0.5) <= 1e-6) acute = true;
    else if (Math.abs(cos + 0.5) <= 1e-6) acute = false;
    else throw new RangeError(`shapeCellFace: 60°/120° 마름모가 아니다(꼭짓점 ${i} 내적 ${cos})`);
    corners.push({ v, uPrev, uNext, acute });
  }
  const centroid = {
    x: (points[0].x + points[1].x + points[2].x + points[3].x) / 4,
    y: (points[0].y + points[1].y + points[2].y + points[3].y) / 4,
  };
  return { side, corners, centroid };
}

/**
 * 둥근 마름모의 꼭짓점 목록. 필렛 ρ = f·r_in, 60° 모서리는 ρ ≤ (0.5/√3)·변 으로 캡.
 *   접점 거리: 60° → t = √3·ρ · 120° → t = ρ/√3
 *   호 중심: 꼭짓점 + (u_prev + u_next)·(2ρ/√3) — |u_prev+u_next| 가 60° 에서 √3, 120° 에서 1
 *     이고 중심 거리가 각각 2ρ · 2ρ/√3 이라 두 경우 모두 같은 계수로 떨어진다.
 *   호의 점: 중심 + v0·cos(k·15°) + w·sin(k·15°) (v0 = 첫 접점 − 중심, w = v0 을 끝 접점
 *     쪽으로 90° 돌린 것). 첫 점과 끝 점은 **접점 그대로** 둔다 — 변과 호가 끊김 없이 잇는다.
 * f ≤ 1 이면 내접원이 보존된다(120° 모서리는 f=1 에서 호 = 내접원 자체). 단 호를 15° 현으로
 * 펴므로 현의 처짐 ρ(1 − cos 7.5°) 만큼은 안쪽으로 들어온다 — 테스트가 그 한계를 잰다.
 * @param {{x:number,y:number}[]} points 마름모 꼭짓점 4개
 * @param {number} f 0 < f ≤ 1
 */
export function roundedRhombusPoints(points, f) {
  const { side, corners } = rhombusFrame(points);
  const rho = f * CELL_INRADIUS_COEFF * side;
  const rho60 = Math.min(rho, FILLET_60_CAP_COEFF * side);
  const out = [];
  for (const { v, uPrev, uNext, acute } of corners) {
    const r = acute ? rho60 : rho;
    if (!(r > 0)) {
      out.push({ x: v.x, y: v.y });
      continue;
    }
    const t = acute ? SQRT3 * r : r / SQRT3;
    const k = (2 * r) / SQRT3;
    const c = { x: v.x + (uPrev.x + uNext.x) * k, y: v.y + (uPrev.y + uNext.y) * k };
    const p0 = { x: v.x + uPrev.x * t, y: v.y + uPrev.y * t };
    const p1 = { x: v.x + uNext.x * t, y: v.y + uNext.y * t };
    const v0 = { x: p0.x - c.x, y: p0.y - c.y };
    const v1 = { x: p1.x - c.x, y: p1.y - c.y };
    let w = { x: -v0.y, y: v0.x };
    if (w.x * v1.x + w.y * v1.y < 0) w = { x: -w.x, y: -w.y };
    const steps = acute ? ARC_STEPS_ACUTE : ARC_STEPS_OBTUSE;
    out.push(p0);
    for (let s = 1; s < steps; s += 1) {
      out.push({
        x: c.x + v0.x * ARC_STEP_COS[s] + w.x * ARC_STEP_SIN[s],
        y: c.y + v0.y * ARC_STEP_COS[s] + w.y * ARC_STEP_SIN[s],
      });
    }
    out.push(p1);
  }
  return out;
}

/** 점 목록을 중심 c 기준 k 배. */
function scaleAbout(points, c, k) {
  return points.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
}

function copyPoints(points) {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

function assertParam(kind, param) {
  const def = CELL_SHAPE_PARAMS[kind];
  if (!def.domain.includes(param)) {
    throw new RangeError(`shapeCellFace: ${kind} 파라미터 ${param} 가 도메인 [${def.domain.join(', ')}] 밖이다`);
  }
}

/**
 * 마름모 한 면 → scene 도형 배열.
 *
 * - `spec` 이 null · square 이거나, 등급이 T2/T3 가 아니거나(T0 · T1 · 모르는 값),
 *   그 셀에 허용되지 않는 모양이면(`cellShapeAllowedKinds` — T2 의 dot, Y filler 의 dot,
 *   `cell` 을 안 넘긴 dot) **원 도형 그대로** `[{kind:'polygon', points, color}]` 를 돌려준다
 *   — 키도 순서도 셀 루프가 원래 넣던 것과 같다(`basePoints` 없음).
 * - dot 은 셀 정체가 있어야만 그린다(fail-closed): 등급 T3 만으로는 Y filler(§3.2 «data 만»)
 *   를 가를 수 없고, 허용표 키에도 role 이 없기 때문이다. 다른 모양은 `cell` 없이도 등급만으로
 *   가른다(§3.0 표가 그 모양들에 대해선 등급과 일치한다).
 * - 꾸민 도형은 모두 `basePoints`(원 꼭짓점 사본)를 가진다.
 *   round        → 둥근 마름모 1장
 *   bevel        → 바깥 마름모(색 × gain, 선형광) + 안쪽 0.7배 마름모(원색) 2장
 *   round-bevel  → 둥근(0.7) 바깥(× 0.6) + 그 0.7배 안쪽(원색) 2장
 *   gap          → 무게중심 기준 (1−s)배 마름모 1장, `noSeam:true`
 *   dot          → 면 중심 원판 r = f·r_in 1장(`disc`), `noSeam:true`
 *
 * @param {{x:number,y:number}[]} points 마름모 꼭짓점 4개(60°/120°)
 * @param {{r:number,g:number,b:number}} color 면 색(이미 면 게인이 적용된 색이어도 된다)
 * @param {null | {kind:string, param?:number|null, avoid?:Array<{r,g,b}>}} spec resolver 결과.
 *   `avoid` 는 bevel 띠 클램프용 실효 틈 색·배경(선택).
 * @param {'T0'|'T1'|'T2'|'T3'} tier 발자국 승격(`promoteNearT0`) 뒤 등급
 * @param {{type: string, entry: {role?: string, tones?: unknown}}} [cell] 셀 정체 — dot 에 필수
 * @returns {object[]} scene 도형
 */
export function shapeCellFace(points, color, spec, tier, cell) {
  const identity = () => [{ kind: 'polygon', points, color }];
  if (!spec || spec.kind === 'square') return identity();
  if (!CELL_SHAPES.includes(spec.kind)) {
    throw new RangeError(`shapeCellFace: 모르는 셀 모양 ${spec.kind}`);
  }
  const allowed = SHAPES_BY_TIER[tier];
  if (!allowed || !allowed.includes(spec.kind)) return identity();
  if (spec.kind === 'dot' && !(cell && cellShapeAllowedKinds(cell.type, cell.entry, tier).includes('dot'))) {
    return identity();
  }

  const frame = rhombusFrame(points);
  const basePoints = copyPoints(points);
  switch (spec.kind) {
    case 'round': {
      assertParam('round', spec.param);
      return [{ kind: 'polygon', points: roundedRhombusPoints(points, spec.param), color, basePoints }];
    }
    case 'bevel': {
      assertParam('bevel', spec.param);
      return [
        { kind: 'polygon', points: copyPoints(points), color: bevelBandColor(color, spec.param, spec.avoid), basePoints },
        { kind: 'polygon', points: scaleAbout(points, frame.centroid, BEVEL_CORE_SCALE), color, basePoints: copyPoints(points) },
      ];
    }
    case 'round-bevel': {
      const rounded = roundedRhombusPoints(points, ROUND_BEVEL_FIXED.round);
      return [
        { kind: 'polygon', points: rounded, color: bevelBandColor(color, ROUND_BEVEL_FIXED.bevel, spec.avoid), basePoints },
        { kind: 'polygon', points: scaleAbout(rounded, frame.centroid, BEVEL_CORE_SCALE), color, basePoints: copyPoints(points) },
      ];
    }
    case 'gap': {
      assertParam('gap', spec.param);
      return [{
        kind: 'polygon', points: scaleAbout(points, frame.centroid, 1 - spec.param), color, basePoints, noSeam: true,
      }];
    }
    case 'dot': {
      assertParam('dot', spec.param);
      return [{
        kind: 'disc',
        cx: frame.centroid.x,
        cy: frame.centroid.y,
        r: spec.param * CELL_INRADIUS_COEFF * frame.side,
        color,
        basePoints,
        noSeam: true,
      }];
    }
    default:
      return identity();
  }
}

// ── 발자국 승격 (§3.0 safety M2) ───────────────────────────────────────────────

function bboxOfPoints(points) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function bboxGap(a, b) {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.sqrt(dx * dx + dy * dy);
}

/** 점 p 와 선분 ab 사이 거리. */
function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ex = a.x + dx * t - p.x;
  const ey = a.y + dy * t - p.y;
  return Math.sqrt(ex * ex + ey * ey);
}

/** 짝홀 규칙 점-다각형 포함(볼록 여부 무관). 경계 위는 거리 0 으로 따로 잡힌다. */
function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y)) {
      const xCross = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (p.x < xCross) inside = !inside;
    }
  }
  return inside;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

/** 두 다각형 사이 최소 거리(겹치면 0). 꼭짓점–변 거리 양방향 + 교차 · 포함 검사. */
function polygonDistance(a, b) {
  if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a))) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i += 1) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const b0 = b[j];
      const b1 = b[(j + 1) % b.length];
      if (segmentsCross(a0, a1, b0, b1)) return 0;
      const d = Math.min(
        pointSegmentDistance(a0, b0, b1),
        pointSegmentDistance(b0, a0, a1),
      );
      if (d < best) best = d;
    }
  }
  return best;
}

/** 다각형과 원판 사이 최소 거리(겹치면 0). */
function polygonDiscDistance(poly, disc) {
  const c = { x: disc.cx, y: disc.cy };
  if (pointInPolygon(c, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const d = pointSegmentDistance(c, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return Math.max(0, best - disc.r);
}

function t0Geometry(shape) {
  if (shape && shape.kind === 'disc') {
    if (![shape.cx, shape.cy, shape.r].every(Number.isFinite)) {
      throw new RangeError('promoteNearT0: disc 에 유한한 cx·cy·r 가 필요하다');
    }
    return {
      disc: shape,
      bbox: { minX: shape.cx - shape.r, minY: shape.cy - shape.r, maxX: shape.cx + shape.r, maxY: shape.cy + shape.r },
    };
  }
  if (shape && Array.isArray(shape.points) && shape.points.length >= 3 && shape.points.every(isPoint)) {
    return { points: shape.points, bbox: bboxOfPoints(shape.points) };
  }
  // 모르는 도형을 조용히 건너뛰면 «발자국이 없다» 가 된다 — 잴 수 없으면 멈춘다.
  throw new RangeError(`promoteNearT0: 거리를 잴 수 없는 T0 도형 ${shape && shape.kind}`);
}

/**
 * T0 발자국 이웃 → T1 승격. 셀 면과 «셀과 면을 나누는 T0 도형» 사이 최소 거리가
 * **1셀(= 그 면의 변 길이) 미만**이면 T1 로 올린다. 겹치면 거리 0 이라 당연히 올라간다
 * (중앙 QR 블록은 셀보다 먼저 그려지고 ring-3 셀이 콰이어트를 덮는다 — `scene.js:651-653`).
 * 거리는 꼭짓점–변 거리(sqrt 만)로 잰다. 어느 T0 도형을 넘길지는 생산자가 정한다(§3.0 목록).
 *
 * 입력을 고치지 않는다 — 새 등급 배열을 돌려준다.
 * @param {Array<{points:{x,y}[], tier:string}>} faces 셀 면(원 기하)과 술어 등급
 * @param {object[]} t0Shapes scene 도형(polygon | disc)
 * @param {{cells?: number}} [opts] 문턱 배수(기본 1셀)
 * @returns {string[]} faces 와 같은 길이의 등급
 */
export function promoteNearT0(faces, t0Shapes, opts = {}) {
  const cells = opts.cells ?? 1;
  const t0 = (t0Shapes || []).map(t0Geometry);
  return faces.map((face) => {
    const tier = face.tier;
    if (tier !== CELL_TIERS.T2 && tier !== CELL_TIERS.T3) return tier;
    const pts = face.points;
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const threshold = cells * Math.sqrt(dx * dx + dy * dy);
    const box = bboxOfPoints(pts);
    for (const g of t0) {
      if (bboxGap(box, g.bbox) >= threshold) continue;
      const d = g.disc ? polygonDiscDistance(pts, g.disc) : polygonDistance(pts, g.points);
      if (d < threshold) return CELL_TIERS.T1;
    }
    return tier;
  });
}

// ── 해석 (§2.3) ────────────────────────────────────────────────────────────────

/**
 * 허용표 키(§3.4). 행은 이 키를 **전부** 가져야 하고 문맥과 모두 같아야 허가한다
 * (와일드카드 없음 — v0@13 에서 잰 행이 v0TR@25 를 허가하지 않는다).
 *   gapGrade(실효 틈 등급) ∈ `CELL_GAP_GRADES` · paletteGrade ∈ {slate, ember, mono, custom}.
 *   Y 의 seamAdjacent 는 «심 인접 1줄 꾸밈» 변형(§3.0 예외).
 */
export const CELL_SHAPE_ALLOW_KEYS = Object.freeze({
  oak: Object.freeze([
    'type', 'version', 'finderPatternId', 'tones', 'gapGrade', 'bgMode', 'paletteGrade', 'qrPosition',
  ]),
  y: Object.freeze([
    'cellSurfaceLayout', 'locatorProfile', 'nBand', 'tones', 'gapGrade', 'bgMode', 'paletteGrade', 'seamAdjacent',
  ]),
});

/**
 * 측정 구성 키 — 표 키 밖에서 셀 역할 · 판독 여유를 바꾸는 축(2026-09-27 자리 레인). 허용표 행은 이 축의 **한 값**
 * (측정 구성)에서만 잰 사실이라, 렌더 구성이 그 값과 다르면 행이 있어도 잠근다(`resolveCellShapeSpec`).
 * ⚠ 설계 잠금 문맥 키(`CELL_SHAPE_LOCK_CTX_KEYS`)와 **따로 둔다** — 그쪽은 측정 하네스가 케이스마다 유도해 영수증
 * `allowCtxLock` 에 싣는 계약이다(그 주석 참조). resolver 는 두 목록을 모두 요구한다(`CELL_SHAPE_REQUIRED_CTX_KEYS`).
 *   cornerMarker — 코너 마커 자리(O 안쪽 o-cm → 타입 G 로 갈린다 · A 바깥 a-cm · K 바깥 k-cm). 같은 버전 · 같은 표 키에서
 *     셀 역할이 달라진다(기본 URL 19 B 실측: A 25셀 · K 37셀) — A · K 바깥 «없음» 이 a-cm/k-cm 에서 잰 행으로 열리던 거짓 열림.
 *   sagoae — 심부 자리 사괘(합성 고리). 같은 버전에서 data 셀이 예약으로 빠진다(12 B 실측: O v2 40셀 · A v0 20셀).
 *     finderPatternId 는 사괘 합성을 못 가른다(원자 daehan 과 daehanFinder 가 같다 — 광학 구분은 인코딩 `sagoae`).
 *   eccLevel — 인코딩이 실제로 쓴 ECC 레벨(auto 해석 뒤). 기하는 같아도 정정 한도(nsym)와 렌더 숫자가 다르다.
 *   detectorEmphasis — **실효 검출 강조**: 생산자에 실제로 넘어간 강조가 그 렌더에서 어떤 강조 값들과 같은 그림인가
 *     (`CELL_SHAPE_DETECTOR_EMPHASIS_MODES` 의 부분집합을 '+' 로 이은 문자열 — 예 'all' · 'locator+all'). 도형 좌표는 같아도
 *     검출 셀 · 중앙 검출기의 채움색이 달라진다(실측: O v2 · A · K 자동에서 'locator' · 'default' 가 'all' 과 38–133 도형).
 *     렌더 뒤에야 아는 값이라 `render.detectorEmphasis` 로 받는다(유도는 생산자 옵션을 만드는 쪽 —
 *     generator-render-config `detectorEmphasisEquivalents`). 세 값 전부면 «해당 없음»(`CELL_SHAPE_DETECTOR_EMPHASIS_NOT_APPLICABLE`
 *     — 강조를 소비하는 표면이 없어 무엇을 넘겨도 같은 그림)이고, 측정 구성과의 비교는 «측정 값이 이 집합에 드는가» 다.
 * 값은 **인코딩 결과**(과 생산자 옵션)에서 유도한다(`cellShapeCtx`) — 상태 표지(outerSeat · deepSeat · centralN7Emphasis)가
 * 아니다: 매퍼가 사괘를 떨구는 조합(A a-cm + 사괘 선택 · O daehan + 사괘 선택)은 와이어가 측정 구성과 같아 열려야 맞고,
 * 강조 상태가 무엇이든 생산자에 안 넘어갔거나(Y 일반 화면) 소비 표면이 없으면 그림은 측정 때와 같다.
 */
export const CELL_SHAPE_MEASURED_CONFIG_KEYS = Object.freeze({
  oak: Object.freeze(['cornerMarker', 'sagoae', 'eccLevel', 'detectorEmphasis']),
  y: Object.freeze(['eccLevel', 'detectorEmphasis']),
});

/** 측정 구성 키 중 «자리» 축(사유 `seat-config`). eccLevel 은 `ecc-level`, detectorEmphasis 는 `detector-emphasis` — 뜻이 달라 사유를 나눈다. */
export const CELL_SHAPE_SEAT_CONFIG_KEYS = Object.freeze(['cornerMarker', 'sagoae']);

/**
 * 검출 강조 값의 폐쇄집합 — `centralN7Emphasis.CENTRAL_N7_EMPHASIS_MODES` 의 **검증되는 사본**(순서까지 같다).
 * ⚠ 이 모듈은 build-single MODULE_ORDER 에서 centralN7Emphasis 보다 앞이라 import 할 수 없다(`CELL_GAP_QUIET_COLORS` 와 같은 사정).
 * `test/cell-shape-measured-config.test.js` 가 두 목록이 같은지 잰다.
 */
export const CELL_SHAPE_DETECTOR_EMPHASIS_MODES = Object.freeze(['default', 'locator', 'all']);

/** «해당 없음» — 세 값이 전부 같은 그림(강조를 소비하는 표면이 없다). 측정 구성의 어떤 값과도 일치한다(집합에 든다). */
export const CELL_SHAPE_DETECTOR_EMPHASIS_NOT_APPLICABLE = CELL_SHAPE_DETECTOR_EMPHASIS_MODES.join('+');

/**
 * `render.detectorEmphasis` → 문맥 값. 폐쇄집합 순서 · 중복 없음 · 빈 집합 아님인 '+' 목록만 받는다 — 아니면 값 모름(undefined →
 * resolver `ctx-incomplete`). 추측으로 채우지 않는다.
 */
function detectorEmphasisCtxValue(value) {
  if (typeof value !== 'string' || value === '') return undefined;
  const parts = value.split('+');
  const canon = CELL_SHAPE_DETECTOR_EMPHASIS_MODES.filter((m) => parts.includes(m));
  return canon.length === parts.length && canon.join('+') === value ? value : undefined;
}

/**
 * 문맥의 측정 구성 값이 측정 구성 선언 값과 «같다» 인가 — 키마다 뜻이 다르다. detectorEmphasis 는 집합(같은 그림을 내는
 * 값들)이라 «측정 값이 그 집합에 드는가»(해당 없음 = 세 값 전부라 늘 참), 나머지는 값이 같은가.
 */
function measuredValueMatches(key, ctxValue, measured) {
  if (key === 'detectorEmphasis') return typeof ctxValue === 'string' && ctxValue.split('+').includes(measured);
  return ctxValue === measured;
}

/**
 * 측정 구성 — 허용표 행을 **잰** 렌더 구성. 키 = 실효 타입(oak 행의 `type`) · Y(y 표). 한 번만 선언한다.
 *
 * 출처: L6 · L6g · L7len(길이 축) 측정 하네스 규약(동결 하네스의 O/A/K · Y 케이스 조립 — 세 측정 모두 측정 트리
 * 0d2e67b. L7len 판은 길이 본문 · 밴드 탐침 · 조립 가드(G × daehan/사괘 불허)를 더했고, 길이 케이스마다 조립 결과의 구성 4 키 —
 * 버전 밴드 · ECC · 자리 · 강조 — 를 이 선언의 하네스 사본과 단언했다) — 계열 상태의 자리는 그때의 제품 자동 자리표(`autoSeatsFor`,
 * 비-taegeuk · 막힌 칸 불허)로 채운 뒤
 * **O · C 는 안쪽을 «없음»** 으로, **V 는 turnA + 바깥 «없음»** 으로 내렸고, **G 는 자동 자리 그대로**(안쪽 o-cm — 코너 마커 +
 * 마커 톤, 제품 기본 O 가 실효 타입 G 다. L6g 계열 g-n7 · g-pinwheel)다. C · V 는 지금 행이 0 이라 선언이 없다. 사괘는 전
 * 계열 없음(O · G 자동 심부도 «없음»), ECC 는 전 영수증 H(19 B 기본은 auto 가 H · 길이 축은 제품 auto 의 **H 밴드**만 잰다 —
 * auto 가 M · L 로 내려가는 길이는 잠금 유지). 검출 강조(detectorEmphasis — 생산자에 넘어간
 * 값)는 O · A · K · G 가 'all' — 조립이 `createGeneratorState` 기본(GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS, 0d2e67b 에서도 'all')을
 * sceneOptionsForOA(O · A · G) · 손 조립(K)으로 늘 실었다 — 이고, Y 는 'default' — Y 케이스 조립이 강조 옵션을 안 실어 라이브러리
 * 기본(DEFAULT_CENTRAL_N7_EMPHASIS)으로 그렸다. 잰 트리(0d2e67b) ↔ 착지 트리의 동등은 착지 동등 자(land-equiv)가 쟀다 —
 * 영수증 sha256 31db1e579905e93544c9f49bf0e8ed2b5eaccf67baea206e3520901c2fe12505: PASS — 복호 폐포 103 파일(src/decoder 밖 75)
 * 동일 · 렌더 목록 3 파일 · 영수증 격자 장면 6524/6524 동일 · 하한 ≥ · 영수증 결속 7/7(qr 2 제외). 이 영수증은 **이 주석을 적은 커밋의
 * 직전 트리**(레인 커밋 6804825 — 코드의 최종 상태)의 것이다: 주석만 바꾸는 커밋은 자기 트리의 영수증을 자기 안에 적을 수 없어(적는
 * 순간 트리가 바뀐다) 직전 트리의 영수증을 적는다 — 그 커밋은 주석(과 이 주석을 싣는 번들)만 바꿨다. 잰 트리 위의 착지들은 잠금
 * 사유(와이어 축 실현 조건 · 사유 축 개수) · 측정 밴드 · 면 게인 · 내보내기 축(디더 · 고정/커스텀 크기) 잠금 · 하한 문맥 유도만
 * 더했다(생산자 옵션 · 와이어 불변 — 잠그는 쪽으로만).
 * G 의 'all' 은 렌더에서 계열마다 다른 «같은 그림 집합» 에 든다 — 중앙 n7 은 'all' 하나(중앙 두 팔), 핀휠은 'locator+all'(안쪽
 * 코너 마커 검출 셀 한 팔). 2026-09-27 동결 하네스 조립(0d2e67b · 이 트리 둘 다 와이어 · 생산자 옵션 동일)으로 재유도했고,
 * 2026-09-28 길이 격자로 넓힌 대조(`test/cell-shape-ctx-locks.test.js` ⑦ — 하네스가 유도한 길이 케이스 · 표의 (타입 · 버전/n) 전부)로
 * 다시 재유도했다 — 값 불변.
 * 허용표 행 키에는 이 값들이 없다 — 영수증 code «A k=6 v=0» 로는 A 와 A-CM 을
 * 못 가른다. 그래서 여기 적고, `test/cell-shape-measured-config.test.js` 가 (1) 선언이 묶인 영수증 sha
 * (`CELL_SHAPE_MEASURED_CONFIG_RECEIPT_SHA256`)와 허용표 RECEIPT_SHA256 이 같은지(표를 다시 생성하면 빨개진다 — 재유도할 것)
 * (2) 제품 자동 자리가 이 선언과 다르면 제품 기본이 잠기는지(성질 — 값의 같음을 강제하지 않는다)
 * (3) 표에 행이 있는 타입마다 선언이 있는지 잰다.
 * 제품 자동 자리표에서 **유도하지 않는다** — 제품 기본이 바뀌면 측정 사실이 아닌데도 조용히 따라간다. 선언은 영수증에서만
 * 바꾼다(제품 기본이 이 선언과 달라지면 그 기본이 잠기는 것이 맞다 — 재측정하거나 제품 기본을 재검토할 일이다).
 *
 * 표에 행이 없는 타입(V · C)은 항목이 없다 — 그 타입은 행이 0 이라 `unmeasured`(C 는 구조 잠금 `type-c-ultra`)로
 * 잠긴다. 그 타입의 행이 생기면 선언도 같이 생겨야 한다(위 (3)). V 를 잴 때는 cornerMarker 와 co2AnchorTones 를 함께
 * 키로 올릴 것 — 제품 기본 V 는 v-cm 이다.
 * 하네스 과제(2026-09-27 실측):
 *   ① (반영됨 — 2026-09-27, L0 하네스가 조립 sceneOpts 로 `detectorEmphasisEquivalents` 를 `render.detectorEmphasis` 에 싣는다.
 *   `test/cell-shape-ctx-locks.test.js` ⑧ 이 TL_L0_DIR 에서 초록) 측정 하네스(L0 tl-decode allowCtxBaseOf)의 `cellShapeCtx`
 *   호출이 강조를 안 실으면 처치 행을 제품 resolver 에 주입할 때 측정 구성 키 값 모름(ctx-incomplete → lib-ctx «키 드리프트»
 *   throw)이 나고, 이 실패는 **조용하다** — tl-decode trial 이 그 throw 를 render-error 로 삼키고(처치 표지보다 먼저 던져
 *   treatmentErrors 에도 안 잡힌다) 처치 행을 treatment-invalid 로 세어 판정 PASS · exit 0 으로 끝난다(영수증에 allowShape 를
 *   받은 처치 행이 0 개다). ⑧ 이 그 경로의 자다(느슨하게 하지 말 것). ⑥ 은 --treatments none 이라 이 경로를 안 지나고, ⑦ 은
 *   호출 모양이 완전한 문맥 · 선언과 같은 값을 내는지 잰다.
 *   ② (남음 — 측정 구성 잠금 이후 트리에서 재생성하기 **전에**) 허용표 생성기 probe 의 resolver 문맥({type, allowCtxLock, 행 키})에
 *   측정 구성 키가 없다 — 측정 구성 잠금이 들어온 0b94f0b 이후 트리로 재생성하면 셀 행이 전부 ctx-incomplete 라 E_RESOLVER_REJECTS 로
 *   멈춘다(크게 실패한다. L6g · L7len 재생성은 측정 트리 0d2e67b — 잠금 전 — 에서 돌아 해당 없었다). 행 타입의 이 선언으로 채우거나,
 *   생성기가 이 구성을 허용표 머리로 내보내도록 옮기고 이 상수는 표에서 읽게 바꿀 것(측정 구성을 행별 표 키로 올리는 후속 설계가 구조로 푼다).
 */
export const CELL_SHAPE_MEASURED_CONFIG = Object.freeze({
  O: Object.freeze({ cornerMarker: false, sagoae: false, eccLevel: 'H', detectorEmphasis: 'all' }),
  G: Object.freeze({ cornerMarker: true, sagoae: false, eccLevel: 'H', detectorEmphasis: 'all' }),
  A: Object.freeze({ cornerMarker: true, sagoae: false, eccLevel: 'H', detectorEmphasis: 'all' }),
  K: Object.freeze({ cornerMarker: true, sagoae: false, eccLevel: 'H', detectorEmphasis: 'all' }),
  Y: Object.freeze({ eccLevel: 'H', detectorEmphasis: 'default' }),
});

/**
 * 위 선언을 읽어 낸 허용표 영수증(`cell-shape-allow.js` RECEIPT_SHA256). 표가 바뀌면 선언을 재유도하고 이 값을 갱신한다.
 * 2026-09-27 L6g — 영수증 7 개(L6 5 + L6g 2)의 묶음. O · A · K · Y 는 L6 과 같은 하네스 규약이라 그대로, G 를 더했다.
 * 2026-09-28 L7len(길이 축) — 영수증 9 개(L6 5 + L6g 2 + 길이 slate · 팔레트 2)의 묶음. 같은 하네스 규약(하네스가 케이스마다 구성
 * 4 키를 단언)이라 선언 값은 그대로다 — 길이 격자로 넓힌 ⑦ 로 재유도해 확인했다(위 선언 주석).
 * 허용표 생성본(`cell-shape-allow.js`) 머리의 측정 도구 이름 · 영수증 파일명 · 하한 출처 문구는 손으로 고치지 않는다 — 생성본이라
 * 다음 재생성 때 생성기가 공개 서술로 고칠 몫이다(여기 적는 주석은 이 모듈의 것만 고친다).
 */
export const CELL_SHAPE_MEASURED_CONFIG_RECEIPT_SHA256 = 'eb9ae46341182c168ce87b01f7f2192b84128eacaca18c8ab57f82594135694d';

/**
 * 측정 면 게인 — 허용표 행을 잰 **렌더 면 게인**(큐브 입체감 · 면 밝기 비). 키 = 표를 가르는 타입(Y 만 — O/A/K 생산자(scene.js)는
 * 면 게인을 읽지 않는다: `test/cell-shape-measured-config.test.js` 가 장면으로 잰다). 2026-09-28 착지 검토 major 로 붙였다 — 이 축이
 * 선언에도 문맥에도 없어 y 행이 잰 적 없는 «약» · «출력물용» 게인(일반 화면 인쇄용 갈래 · 디더 2 · 입체감 카드 · 고급 슬라이더)에서도
 * 열렸다(장면이 달라도 문맥이 같았다). 디더가 바꾼 게인(디더 2 · 4 의 자동 입체감)은 지금은 디더 축으로 센다(`CELL_SHAPE_LOCK_AXES`).
 * 출처: 측정 하네스 조립 규약(기본 면 게인 — 측정 트리 0d2e67b 의
 * `faceGainsForRenderProfile(resolveRenderProfile(자동, {인쇄용 아님, 디더 없음}))` = 화면용). 하네스에 면 게인 축은 없다(그 값 하나).
 * 측정 구성(`CELL_SHAPE_MEASURED_CONFIG`)의 키로 두지 **않는** 이유: 그 키는 resolver 필수 문맥 키라 값 모름이면 잠그는데, 측정
 * 하네스의 제품 문맥 호출(렌더 값 {판 색 · 강조})에는 게인이 없다 — 넣으면 하네스가 처치 행을 «키 드리프트» 로 멈춘다(⑧). 그래서
 * **렌더 값 `render.faceGains` 가 있을 때만** 판정한다: 제품 렌더(index.html `cellShapeDecoFor` — generator-render-config
 * `producerFaceGains`)는 늘 싣고(`test/decoration-ui.test.js` 가 제품 경로로 잰다), 하네스 경로는 이 값 하나로만 조립하므로 판정할 것이 없다.
 * 비교는 T · L · R 값이 **정확히** 같은가다(같은 그림 — 게인은 선형 곱이라 다른 값은 다른 채움색이다).
 * 제품 기본(입체감 자동 · 화면용 갈래 · 디더 자동 · 슬라이더 100)이 이 값과 달라지면 그 기본이 잠기는 것이 맞다(재측정하거나 기본을
 * 재검토할 일 — 측정 구성 선언과 같은 규칙).
 * 이름만 붙이는 이웃 축: Y 입체 음영(shading — 고급 옵트인, 기본 끔)도 하네스가 안 그렸다(측정 밖). 음영은 셀 밖(안전영역 · 배경)만
 * 칠하고, 켜면 꾸미기와 무관하게 Y 전경 실루엣 검출이 깨진다(generator-state `shading` 주석 실측) — 그래서 여기서 따로 잠그지 않는다.
 */
export const CELL_SHAPE_MEASURED_FACE_GAINS = Object.freeze({
  Y: Object.freeze({ T: 1, L: 0.72, R: 0.62 }),
});
const FACE_GAIN_KEYS = Object.freeze(['T', 'L', 'R']);

/**
 * 설계 잠금이 읽는 **표 밖** 문맥 키(허용표 행에는 없다 — 표로 가를 수 없어서 따로 둔다).
 *   Y: qrPosition(상태 — 'inner' = 윈도 β · 안쪽 QR) · qrWindow(인코딩 `window` — 윈도 β 코드) ·
 *      qrSlot(인코딩에 `role:'slot'` 셀이 있는가 — 슬롯 레이아웃).
 *   O/A/K: 없음. 타입 C 는 `cellShapeCtx` 가 코드에서 type 'C' 로 판정.
 * 빠지면 잴 수 없으므로 잠근다(`ctx-incomplete`) — fail-closed.
 *
 * ⚠ **측정 하네스 계약이다** — L0 하네스(private `tl-decode.mjs` LOCK_DERIVE)는 이 목록의 키마다 값 유도가 있어야 하고
 * (없으면 «키 드리프트» 로 멈춘다), 영수증 행 `allowCtxLock` 에 정확히 이 키를 싣는다(gen-allow E_ROW_CTX_KEYS).
 * 측정 구성 키(`CELL_SHAPE_MEASURED_CONFIG_KEYS`)를 여기 넣지 않는 이유: 하네스는 측정 구성 **한 값**만 재므로 케이스마다
 * 유도할 값이 아니고, 넣으면 지금 하네스가 대조군부터 render-error 로 멈춘다(2026-09-27 검토 blocking — 표준 원격 전수
 * TL_L0_DIR 에서 `test/cell-shape-ctx-locks.test.js` ⑥ 이 빨개졌다). 다음 측정에서 하네스가 측정 구성을 영수증에 싣게 되면
 * (`CELL_SHAPE_MEASURED_CONFIG` TODO) 하네스와 **같은 커밋 쌍**으로 옮긴다.
 */
export const CELL_SHAPE_LOCK_CTX_KEYS = Object.freeze({
  oak: Object.freeze([]),
  y: Object.freeze(['qrPosition', 'qrWindow', 'qrSlot']),
});

/**
 * resolver 가 문맥에 요구하는 키 전부 — 표 키(`CELL_SHAPE_ALLOW_KEYS`) + 설계 잠금 문맥 키(`CELL_SHAPE_LOCK_CTX_KEYS`) +
 * 측정 구성 키(`CELL_SHAPE_MEASURED_CONFIG_KEYS`). 제품 문맥(`cellShapeCtx`)은 렌더 값을 주면 이 키가 전부 정의된다.
 */
export const CELL_SHAPE_REQUIRED_CTX_KEYS = Object.freeze(Object.fromEntries(['oak', 'y'].map((t) => [t, Object.freeze([
  ...CELL_SHAPE_ALLOW_KEYS[t], ...CELL_SHAPE_LOCK_CTX_KEYS[t], ...CELL_SHAPE_MEASURED_CONFIG_KEYS[t],
])])));
// 로드 시 자기검증 — 세 목록은 서로 겹치지 않는다(겹치면 한 키가 두 계약에 묶여 옮길 때 한쪽이 조용히 남는다).
for (const [t, keys] of Object.entries(CELL_SHAPE_REQUIRED_CTX_KEYS)) {
  if (new Set(keys).size !== keys.length) throw new Error(`cell-shape: ${t} 문맥 키 목록이 겹친다 — ${keys.join(',')}`);
}

// 로드 시 자기검증 — 선언의 키가 그 표의 측정 구성 키와 정확히 같다(빠진 키는 잠금 판정에서 조용히 빠진다).
for (const [configType, config] of Object.entries(CELL_SHAPE_MEASURED_CONFIG)) {
  const want = [...CELL_SHAPE_MEASURED_CONFIG_KEYS[configType === 'Y' ? 'y' : 'oak']].sort().join(',');
  if (Object.keys(config).sort().join(',') !== want) {
    throw new Error(`cell-shape: 측정 구성 ${configType} 의 키가 ${want} 가 아니다`);
  }
  // 측정 구성의 강조는 «넘긴 값» 하나다(집합이 아니다) — 문맥 쪽이 집합이고 비교는 «이 값이 그 집합에 드는가».
  if (!CELL_SHAPE_DETECTOR_EMPHASIS_MODES.includes(config.detectorEmphasis)) {
    throw new Error(`cell-shape: 측정 구성 ${configType} 의 detectorEmphasis(${config.detectorEmphasis})가 강조 값 하나가 아니다`);
  }
}

/**
 * 잠금 사유 — **안정 id**. UI 는 이 값으로 인라인 사유 문구(i18n 키)를 고른다. 문자열을 바꾸면 i18n
 * 매핑이 끊기므로 바꾸지 않는다(새 사유는 새 id 로).
 */
export const CELL_SHAPE_LOCK_REASONS = Object.freeze({
  UNMEASURED: 'unmeasured', // 허용표에 행이 없다(판독 미확인 — 미측정 · 측정 실패 · 판정 무효를 표는 가르지 않는다)
  EXPOSED_GAP: 'exposed-gap', // 노출형인데 틈이 검정 판·미지 표면이고, 흰 틈 형제 행은 있다(틈이 가르는 축)
  UNKNOWN_SHAPE: 'unknown-shape',
  PARAM_OUT_OF_DOMAIN: 'param-out-of-domain',
  TYPE_NOT_RHOMBUS: 'type-not-rhombus', // H 등 마름모 셀이 아닌 타입
  CTX_INCOMPLETE: 'ctx-incomplete', // 문맥에 허용표 키 · 설계 잠금 키 · 측정 구성 키가 빠졌다 — 잴 수 없으면 잠근다
  // ── 구조 잠금(설계 1차 잠금 — 허용표에 행이 있어도 잠긴다) ──
  TYPE_C_ULTRA: 'type-c-ultra', // §3.1 — C(ultra, k ≥ 14)는 모든 모양 미측정
  Y_TWO_TONE: 'y-two-tone', // §3.2 — Y 2톤(Y*-2T) × 모든 모양
  Y_INNER_QR: 'y-inner-qr', // §3.2 — 윈도(β) 구성 · qrPosition inner × 모든 모양(inner-QR 레인 영역)
  Y_QR_SLOT: 'y-qr-slot', // §3.2 — 슬롯 레이아웃(v0TY · v0TRQ · v0TRY …) × 모든 모양
  Y_HEX_FRAME_EXPOSED: 'y-hex-frame-gap-dot', // §3.2 — hex-frame-v1 × gap/dot
  BULLSEYE_DOT: 'bullseye-dot', // §3.1 표 — 불스아이 계열(불스아이 · cube-bullseye)은 dot 전면 금지
  BEVEL_RAISED: 'bevel-raised', // §3.1 safety M13 — 돌출 bevel(게인 > 1, 1.4)은 바닥 띠를 흰 판 쪽으로 넓힌다
  // ── 측정 구성 불일치(2026-09-27 — 표 행은 `CELL_SHAPE_MEASURED_CONFIG` 에서만 잰 사실이다) ──
  //   잠금 자체는 행 유무와 무관(측정 구성과 다르면 늘 잠근다). **사유**로는 반사실일 때만 낸다 — 같은 표 키에서 측정
  //   구성으로 바꾸면 표 행이 열리는 경우(그 축이 실제로 가른다). 행이 없거나 설계 잠금이면 그 사유(unmeasured ·
  //   bevel-raised …)가 나간다. 아래 «측정 구성이면 열린다» 는 모두 표 키(버전 포함) 고정 반사실이다(머리말 ④).
  //   와이어 축(자리 · ECC)의 사유에는 **실현 조건**이 붙는다(ECC 실현 조건 — 2026-09-28, 자리는 착지 검토 major 로 넓혔다):
  //   제품의 자동 경로가 측정 와이어 구성(자리 · ECC 전부)으로 이 페이로드를 인코딩하면 **같은 표 키**에 닿을 때만(문맥 보조 필드
  //   `measuredStateAtTableKey`). 아니면 «그 축 탓» 은 따를 수 없는 안내라 unmeasured 다.
  SEAT_CONFIG: 'seat-config', // 자리(코너 마커 · 사괘) 구성이 그 타입의 측정 구성과 다르고, 측정 구성이면 열린다(실현 조건)
  // 인코딩 ECC 레벨이 측정 구성과 다르고, 측정 구성이면 열린다(같은 기하라도 정정 여유가 다르다 — 실현 조건).
  ECC_LEVEL: 'ecc-level',
  // 실효 검출 강조가 측정 구성과 다르고(측정 값이 «같은 그림 집합» 에 없다), 측정 구성이면 열린다(같은 기하라도 채움색이 다르다).
  // 강조를 소비하는 표면이 없는 렌더(«해당 없음»)에서는 나지 않는다 — 무엇을 넘겨도 측정 때와 같은 그림이다.
  DETECTOR_EMPHASIS: 'detector-emphasis',
  // 렌더 면 게인(큐브 입체감)이 측정 면 게인(`CELL_SHAPE_MEASURED_FACE_GAINS` — Y 만)과 다르고, 측정 게인이면 열린다(2026-09-28).
  // 렌더 값이 게인을 실을 때만 판정한다(그 상수 주석).
  FACE_GAIN: 'face-gain',
  // ── 내보내기 축(2026-09-28 외부 검토 major — 허용표 행은 비디더에서, 잰 하한부터 위로 몇 점의 ppu 사다리에서 잰 사실이다) ──
  //   렌더 값 `render.exportPlan`(지금 내보내기 계획 — generator-render-config `cellShapeExportPlan`)이 있을 때만 판정한다(측정 하네스
  //   경로는 싣지 않는다). 미리보기도 같은 판정으로 사각이 된다(내보내기 결과 = 미리보기). H 셀 스타일 카드도 같은 문자열 · 같은 판정
  //   (`exportPlanAxes`)을 쓴다(generator-h `resolveHCellStyleSpec` — 같은 날 후속 검토).
  //   ⚠ 이름 붙인 축(덮는 자 없음): 사다리 **위쪽**은 잰 적이 없다 — 마름모 셀 격자는 하한 · 하한+0.5 · 하한+2 · 16 ppu, H 는 하한(12)까지만
  //   쟀다. 자동 맞춤 · 고해상(하한 × 1.5 · × 2.5)과 1024 px 이상 고정 · 큰 커스텀은 그 위라 «ppu 가 커져도 판독이 나빠지지 않는다» 는
  //   단조 가정으로 연다(열림의 근거는 하한 쪽 측정뿐). 덮으려면 사다리 위쪽 점을 재거나 상한을 표에 싣고 여기서 맞댈 것.
  // 내보내기가 디더(양자화)를 건다 — 측정은 비디더만 쟀다. 디더를 끄면 열린다.
  EXPORT_DITHER: 'export-dither',
  // 내보내기 계획의 ppu(고정 · 커스텀 크기)가 그 표 키의 잰 하한(허용표 `MEASURED_FLOORS`)보다 낮다. 자동 크기로 두면 열린다.
  EXPORT_SIZE: 'export-size',
});

/**
 * 구조 잠금 사유 id 전부 — `cellShapeStructuralLock` 이 낼 수 있는 값의 목록(테스트 · i18n 대조용).
 * seat-config · ecc-level · detector-emphasis · face-gain 은 resolver 가 반사실로 거른 뒤에만 카드 사유로 나간다(`resolveCellShapeSpec`).
 * 내보내기 축(export-dither · export-size)은 여기 없다 — 구조 잠금(측정 하네스 계약)이 아니라 resolver 가 렌더 값으로만 판정한다
 * (`CELL_SHAPE_LOCK_AXES`).
 */
export const CELL_SHAPE_STRUCTURAL_LOCK_REASONS = Object.freeze([
  CELL_SHAPE_LOCK_REASONS.TYPE_C_ULTRA,
  CELL_SHAPE_LOCK_REASONS.Y_TWO_TONE,
  CELL_SHAPE_LOCK_REASONS.Y_INNER_QR,
  CELL_SHAPE_LOCK_REASONS.Y_QR_SLOT,
  CELL_SHAPE_LOCK_REASONS.Y_HEX_FRAME_EXPOSED,
  CELL_SHAPE_LOCK_REASONS.BULLSEYE_DOT,
  CELL_SHAPE_LOCK_REASONS.BEVEL_RAISED,
  CELL_SHAPE_LOCK_REASONS.SEAT_CONFIG,
  CELL_SHAPE_LOCK_REASONS.ECC_LEVEL,
  CELL_SHAPE_LOCK_REASONS.DETECTOR_EMPHASIS,
  CELL_SHAPE_LOCK_REASONS.FACE_GAIN,
]);

/**
 * 측정 구성 축 → 사유(판정 순서 그대로) — 자리(와이어 셀 역할) → ECC(와이어 정정 여유) → 실효 검출 강조(렌더 채움색).
 * 이 순서는 구조 잠금(`cellShapeStructuralLock` — 측정 하네스 계약, 첫 번째로 다른 축)의 순서다. 카드 **사유**는 순서로 고르지 않는다 —
 * resolver 는 다른 축을 전부 세어 **정확히 하나**일 때만 그 축을 탓한다(`CELL_SHAPE_LOCK_AXES` 주석 — 2026-09-28 외부 검토 major).
 * 측정 구성 키 전부가 정확히 한 축에 든다(아래 로드 시 자기검증 — 새 키가 사유 없이 조용히 빠지지 않게).
 */
export const CELL_SHAPE_MEASURED_CONFIG_AXES = Object.freeze([
  Object.freeze({ reason: CELL_SHAPE_LOCK_REASONS.SEAT_CONFIG, keys: CELL_SHAPE_SEAT_CONFIG_KEYS }),
  Object.freeze({ reason: CELL_SHAPE_LOCK_REASONS.ECC_LEVEL, keys: Object.freeze(['eccLevel']) }),
  Object.freeze({ reason: CELL_SHAPE_LOCK_REASONS.DETECTOR_EMPHASIS, keys: Object.freeze(['detectorEmphasis']) }),
]);
{
  const axisKeys = CELL_SHAPE_MEASURED_CONFIG_AXES.flatMap((a) => a.keys);
  const configKeys = [...new Set([...CELL_SHAPE_MEASURED_CONFIG_KEYS.oak, ...CELL_SHAPE_MEASURED_CONFIG_KEYS.y])];
  if (new Set(axisKeys).size !== axisKeys.length || axisKeys.length !== configKeys.length
    || !configKeys.every((k) => axisKeys.includes(k))) {
    throw new Error(`cell-shape: 측정 구성 축(${axisKeys.join(',')})이 측정 구성 키(${configKeys.join(',')})와 한 번씩 맞지 않는다`);
  }
}

/**
 * 불스아이 계열 파인더 id — 라이브러리 불스아이(`LEGACY_FINDER_PATTERN_ID`) + renderKind
 * 'cube-bullseye' 패턴 전부(패턴 표에서 **유도** — 손 목록 아님). 동심 원판이 셀과 면을 나누는
 * T0 라서 dot(노출 56 %)은 원판 경계를 흐린다(§3.1 «불스아이 O 는 dot 전면 금지»).
 */
export const BULLSEYE_FAMILY_FINDER_PATTERN_IDS = Object.freeze([
  LEGACY_FINDER_PATTERN_ID,
  ...FINDER_PATTERNS.filter((p) => p.renderKind === 'cube-bullseye').map((p) => p.id),
]);
if (BULLSEYE_FAMILY_FINDER_PATTERN_IDS.length < 2) {
  throw new Error('cell-shape: 불스아이 계열 유도 실패 — renderKind cube-bullseye 패턴이 없다');
}

function allowTableOf(type) {
  if (OAK_FAMILY_TYPES.includes(type)) return 'oak';
  if (type === 'Y') return 'y';
  return null;
}

/**
 * 측정 구성 불일치 — 문맥의 측정 구성 키가 그 타입의 측정 구성(`CELL_SHAPE_MEASURED_CONFIG`)과 다르면 사유 id.
 * 축 순서(`CELL_SHAPE_MEASURED_CONFIG_AXES`): 자리(코너 마커 · 사괘) → ECC → 실효 검출 강조. 강조는 «측정 값이 문맥의 같은
 * 그림 집합에 드는가» 로 비교한다(`measuredValueMatches` — 해당 없음이면 늘 같다). 선언이 없는 타입(V · C)은 판정하지
 * 않는다(행이 0 이라 unmeasured). ⚠ 이 갈래는 fail-open 이다 — 선언 없는 타입에 행이 생기면 자리 · ECC · 강조와 무관하게
 * 열린다. 런타임 가드는 없고 테스트(cell-shape-measured-config ⓒ «행이 있는 타입마다 선언» · cell-shape-allow-generated)만
 * 막는다. 런타임은 fail-open 을 유지한다(2026-09-27 통합자 결정) — resolver 에서 «선언 없는 타입의 행» 을 잠그면 측정
 * 하네스의 계약(주입한 행은 구조 잠금이 없으면 연다 — 아니면 «키 드리프트» 로 멈춘다)과 V 에서 충돌한다(시험해 확인). 선언
 * 없는 타입의 행은 표를 다시 생성할 때만 들어오고, 그때 ⓒ 가 빨개진다. 값 모름(undefined)은 여기서 판정하지 않는다 — resolver 가 먼저 `ctx-incomplete` 로
 * 잠근다(다른 구조 잠금 줄과 같은 결: 증거가 있을 때만 사유를 낸다).
 * 반환은 다른 축 **전부**(축 순서) — 구조 잠금은 그 첫째를 쓰고(`measuredConfigLock`), resolver 는 개수를 센다(`lockAxes`).
 */
function measuredConfigDiffs(table, ctx) {
  const config = CELL_SHAPE_MEASURED_CONFIG[table === 'y' ? 'Y' : ctx.type];
  if (!config) return [];
  const differs = (k) => Object.prototype.hasOwnProperty.call(config, k) && ctx[k] !== undefined
    && !measuredValueMatches(k, ctx[k], config[k]);
  const out = CELL_SHAPE_MEASURED_CONFIG_AXES.filter((axis) => axis.keys.some(differs)).map((axis) => axis.reason);
  // 렌더 면 게인(측정 구성 키 밖 — `CELL_SHAPE_MEASURED_FACE_GAINS` 주석): 렌더 값이 게인을 실었을 때만 판정한다. 축 순서의 맨 뒤다.
  if (faceGainsDiffer(table, ctx.type, ctx.faceGains)) out.push(CELL_SHAPE_LOCK_REASONS.FACE_GAIN);
  return out;
}
/** 구조 잠금의 측정 구성 줄 — 첫 번째로 다른 축(측정 하네스 계약: 잠금 여부만 쓴다). 카드 사유는 이 값이 아니다(`lockAxes`). */
function measuredConfigLock(table, ctx) {
  return measuredConfigDiffs(table, ctx)[0] ?? null;
}
/** 면 게인이 그 표의 측정 면 게인과 다른가 — 측정 게인 선언이 없는 타입이거나 게인을 모르면(undefined) 판정 안 함(false). */
function faceGainsDiffer(table, type, gains) {
  const measured = CELL_SHAPE_MEASURED_FACE_GAINS[table === 'y' ? 'Y' : type];
  return Boolean(measured) && gains !== undefined && !FACE_GAIN_KEYS.every((k) => gains[k] === measured[k]);
}

/**
 * 카드 사유가 될 수 있는 **축** — 측정 구성 축(`CELL_SHAPE_MEASURED_CONFIG_AXES`) · 면 게인 · 내보내기 축(디더 · 크기). resolver 는
 * 행이 있는 표 키(hit)에서 이 축들 중 다른 것을 **전부** 세고(`lockAxes`), 사유를 이렇게 고른다(2026-09-28 외부 검토 major — 두 렌즈가
 * 독립으로 같은 결함을 냈다: 옛 규칙 «여러 축이 함께 다르면 앞 축 사유» 는 그 축만 따라서는 안 열리는 틀린 안내였다).
 *   0 개 → 열림(측정 상태 거짓이면 unmeasured) · **정확히 1 개** → 그 축을 측정 값으로 돌리면 열릴 때만(`measuredCounterfactualHolds`) 그 축 ·
 *   2 개 이상 → unmeasured(g1162 «판독이 확인되지 않은 조합» — 어느 한 축만 따라서는 안 열린다).
 * 잠금 여부는 개수와 무관하다(하나라도 다르면 잠근다) — 바뀌는 것은 사유뿐이다.
 * 디더 ↔ 면 게인(Y): 자동 입체감은 디더 비트깊이를 읽어 게인을 바꾼다(export-options resolveRenderProfile — 디더 2 → 출력물용). 그래서
 * 디더 축의 반사실(디더를 끈 내보내기)은 면 게인도 다시 유도한 값(`exportPlan.faceGainsDitherOff`)으로 센다: 디더를 끄면 측정 게인으로
 * 돌아오면 면 게인 차이는 디더의 파생이라 **한 축(디더)** 으로 세고 사유는 export-dither 다(face-gain 은 나오지 않는다 — 두 사유가 같은
 * 원인을 두 번 말하지 않는다). 디더를 꺼도 게인이 측정 밖이면(입체감 카드 · 인쇄용 갈래 · 슬라이더) 두 축이라 unmeasured 다. 디더를 끈
 * 게인을 모르면 지금 게인으로 센다(보수 — 둘 다 다르면 unmeasured).
 */
export const CELL_SHAPE_LOCK_AXES = Object.freeze([
  ...CELL_SHAPE_MEASURED_CONFIG_AXES.map((a) => a.reason),
  CELL_SHAPE_LOCK_REASONS.FACE_GAIN,
  CELL_SHAPE_LOCK_REASONS.EXPORT_DITHER,
  CELL_SHAPE_LOCK_REASONS.EXPORT_SIZE,
]);

/**
 * 다른 축 전부(`CELL_SHAPE_LOCK_AXES` 의 부분집합 — 순서는 의미 없다, 개수만 쓴다)와 «잰 하한을 모른다».
 * 내보내기 축은 문맥 보조 필드 `exportPlan`(렌더 값 — `renderAuxCtx`)이 있을 때만 센다:
 *   dithered → export-dither(면 게인은 위 규칙으로 디더를 끈 게인으로 다시 센다).
 *   ppu · floorKey → 허용표 `MEASURED_FLOORS[floorKey]` 보다 ppu 가 낮으면 export-size. 표가 MEASURED_FLOORS 를 싣는데 그 키가 없으면
 *     floorUnknown(잴 수 없으면 잠근다 — 생성 표에서는 행의 하한 키가 늘 있다: test/cell-shape-measured-floors.test.js ①). 표가
 *     MEASURED_FLOORS 자체를 안 싣으면(행만 주입한 표 — 테스트 fixture · 옛 스텁) 크기는 판정하지 않는다.
 */
function lockAxes(table, ctx, allow) {
  const axes = measuredConfigDiffs(table, ctx);
  const plan = ctx.exportPlan;
  const R = CELL_SHAPE_LOCK_REASONS;
  const ex = exportPlanAxes(plan, allow);
  if (ex.dithered) {
    if (plan.faceGainsDitherOff !== undefined) {
      const at = axes.indexOf(R.FACE_GAIN);
      const afterDitherOff = faceGainsDiffer(table, ctx.type, plan.faceGainsDitherOff);
      if (at >= 0 && !afterDitherOff) axes.splice(at, 1); // 게인 차이는 디더의 파생 — 한 축
      else if (at < 0 && afterDitherOff) axes.push(R.FACE_GAIN); // 디더를 끄면 게인이 측정 밖이 된다 — 두 축
    }
    axes.push(R.EXPORT_DITHER);
  }
  if (ex.belowFloor) axes.push(R.EXPORT_SIZE);
  return { axes, floorUnknown: ex.floorUnknown };
}

/**
 * 내보내기 축 판정 **한 벌** — 셀 모양(`lockAxes`)과 H 셀 스타일(generator-h `resolveHCellStyleSpec`)이 같이 쓴다. 허용표 행은
 * 비디더 · 잰 하한(`MEASURED_FLOORS`) 이상 ppu 에서만 잰 사실이라, 두 카드 모두 같은 규칙으로 잠근다(2026-09-28 외부 검토 major 의
 * 후속 — H 카드에 같은 거짓 열림이 남아 있었다).
 *   dithered — 계획이 양자화하는 디더를 건다(`plan.dithered === true`).
 *   belowFloor — 계획 ppu 가 그 표 키의 잰 하한보다 낮다(`plan.ppu < allow.MEASURED_FLOORS[plan.floorKey]`).
 *   floorUnknown — 표가 MEASURED_FLOORS 를 싣는데 그 키가 없다(잴 수 없으면 잠근다). 표가 MEASURED_FLOORS 자체를 안 싣으면(행만 주입한
 *     표 — 테스트 fixture · 옛 스텁) 크기는 판정하지 않는다. ppu 또는 floorKey 가 없으면(계획이 던졌다 · 모름) 크기를 판정하지 않는다.
 * @param {{dithered: boolean, ppu?: number, floorKey?: string}|undefined} plan 문맥 보조 필드(`exportPlanAux` 결과) — 없으면 전부 거짓
 * @param {{MEASURED_FLOORS?: object}} [allow] 허용표
 * @returns {{dithered: boolean, belowFloor: boolean, floorUnknown: boolean}}
 */
export function exportPlanAxes(plan, allow) {
  const out = { dithered: false, belowFloor: false, floorUnknown: false };
  if (!plan) return out;
  out.dithered = plan.dithered === true;
  if (typeof plan.ppu === 'number' && typeof plan.floorKey === 'string') {
    const floors = allow && allow.MEASURED_FLOORS;
    if (floors && typeof floors === 'object') {
      if (!Object.prototype.hasOwnProperty.call(floors, plan.floorKey)) out.floorUnknown = true;
      else if (plan.ppu < floors[plan.floorKey]) out.belowFloor = true;
    }
  }
  return out;
}

/** 측정 구성 축 사유 중 **와이어** 축(자리 · ECC — 바꾸면 재인코딩된다). 강조 · 면 게인은 렌더 축이다(인코딩 불변). */
const WIRE_AXIS_REASONS = Object.freeze([CELL_SHAPE_LOCK_REASONS.SEAT_CONFIG, CELL_SHAPE_LOCK_REASONS.ECC_LEVEL]);
/**
 * 와이어 축의 측정 구성 키(자리 · ECC — 인코딩 결과에서 읽는 키). `CELL_SHAPE_MEASURED_CONFIG_AXES` 에서 유도한다(손 목록 아님).
 * generator-render-config `measuredStateAtTableKey` 가 반사실 인코딩이 측정 구성을 실현했는지 이 키로 확인한다.
 */
export const CELL_SHAPE_WIRE_CONFIG_KEYS = Object.freeze(
  CELL_SHAPE_MEASURED_CONFIG_AXES.filter((a) => WIRE_AXIS_REASONS.includes(a.reason)).flatMap((a) => a.keys),
);

/**
 * 측정 구성 축 사유의 반사실이 **따를 수 있는가**(ECC 실현 조건 — 2026-09-28, 착지 검토로 자리 축 · 길이 밴드까지 넓혔다).
 * 문맥 보조 필드 `measuredStateAtTableKey`(표 키도 필수 키도 아니다 — `cellShapeCtx` 가 렌더 값에서 싣는다: generator-render-config
 * `measuredStateAtTableKey` 가 제품 인코더 · 제품 자동 경로로 유도한 «측정 상태가 이 표 키에 있다» — 측정 와이어 구성(자리 · ECC)으로 제품
 * 자동 버전 · 레이아웃을 고르면 이 페이로드가 같은 표 키에 닿는다)에서만 읽는다.
 *   와이어 축(자리 · ECC): 그 값이 true 일 때만 참. 없거나(모름) 거짓이면 «그 축 탓» 은 따를 수 없는 안내라 unmeasured.
 *   렌더 축(강조 · 면 게인 · 내보내기 디더 · 크기): 인코딩이 안 바뀌므로 값이 **거짓일 때만** 거짓(모름이면 참 — 측정 하네스 경로는 이 값을
 *   안 싣는다). 이 판정은 다른 축이 **하나뿐**일 때만 쓴다(`CELL_SHAPE_LOCK_AXES` — 하나뿐이면 «그 축 = 측정 구성 전부» 라 와이어 반사실
 *   (측정 와이어 구성 전부로 인코딩)이 곧 그 축 하나를 돌린 반사실이다).
 * 왜: ① 제품 auto 는 H 가 안 들어가는 길이에서 M 을 고른다(A 79–96 · Y n25 v0tr 114–117 B 등 — 행이 있는 표 키만 hit) — 그
 * 버전에 H 로는 안 들어가므로 «ECC 를 H 로» 는 참이 아니다. ② A 바깥 «없음» 79–80 B(v2 H)는 코너 마커를 켜면 v2 H 에 안 들어가
 * auto 가 M 으로 내려간다 — «자리 탓» 을 따라도 열리지 않는다. ③ 버전을 고정(고급 화면)하거나 Y 로케이터를 직접 고른 짧은
 * 페이로드는 그 표 키의 측정 밴드(제품 자동이 그 키를 고르는 길이 — 패딩이 잰 최대 이하)보다 짧아, 측정 구성으로 바꿔도 잰 적 없는
 * 영 패딩 구간이다.
 * 반사실은 여전히 **표 키 고정**이다(머리말 ④): 자동 경로가 다른 표 키로 가면(예 A 바깥 없음 22–25 B → 코너 마커면 v1) 그 키에
 * 행이 있어도 거짓이다 — 사유는 unmeasured(문구 «판독이 확인되지 않은 조합» 은 참).
 */
function measuredCounterfactualHolds(reason, ctx) {
  const state = ctx.measuredStateAtTableKey;
  if (WIRE_AXIS_REASONS.includes(reason)) return state === true;
  return state !== false;
}

/**
 * 설계 잠금 — 문맥 전체를 막는 것(C · Y 2톤 · 안쪽 QR · 슬롯) → 모양별(불스아이 dot · hex-frame gap/dot · 돌출 bevel).
 * 측정 구성을 무엇으로 바꿔도 열리지 않는 **영구** 잠금이라, 측정 구성 불일치보다 사유가 앞선다(그 반대면 «자리를 되돌리면
 * 열릴 것» 처럼 읽혀 틀린 안내가 된다 — 2026-09-27 검토). 표 키 · 설계 잠금 문맥 키만 읽는다(측정 구성 키 없이도 판정).
 */
function designLock(table, kind, param, ctx) {
  const R = CELL_SHAPE_LOCK_REASONS;
  if (table === 'oak') {
    if (ctx.type === 'C') return R.TYPE_C_ULTRA;
  } else if (table === 'y') {
    if (ctx.tones === 2) return R.Y_TWO_TONE;
    if (ctx.qrWindow === true || ctx.qrPosition === 'inner') return R.Y_INNER_QR;
    if (ctx.qrSlot === true) return R.Y_QR_SLOT;
  }
  if (table === 'oak' && kind === 'dot' && BULLSEYE_FAMILY_FINDER_PATTERN_IDS.includes(ctx.finderPatternId)) {
    return R.BULLSEYE_DOT;
  }
  if (table === 'y' && (kind === 'gap' || kind === 'dot') && ctx.locatorProfile === LOCATOR_PROFILE_HEX_FRAME_V1) {
    return R.Y_HEX_FRAME_EXPOSED;
  }
  // 게인 > 1 = 돌출(띠를 흰 쪽으로) — 1.4 가 그 값이다. 도메인이 늘어도 «돌출» 이면 잠근다.
  if (kind === 'bevel' && typeof param === 'number' && param > 1) return R.BEVEL_RAISED;
  return null;
}

/**
 * 구조 잠금 판정 — 허용표와 **무관하게** 잠그는 조합이면 사유 id, 아니면 null. 순수 함수.
 * resolver 가 허용표보다 먼저 판정한다(측정 영수증에 그 조합의 행이 생겨도 열리지 않는다).
 * 여는 쪽(측정 레인)이 풀려면 이 함수의 해당 줄을 **먼저 지우고 이유를 적어야** 한다.
 *
 * 순서: 설계 잠금(`designLock` — 문맥 전체 → 모양별) → 측정 구성 불일치(자리 · ECC · 실효 검출 강조 — 모든 모양).
 * 여기서 낸 측정 구성 사유는 **표 없는** 답이다 — resolver 는 잠금은 그대로 두고, 카드 사유로는 측정 구성으로 바꾸면
 * 표 행이 열릴 때만 그 사유를 내고 아니면 unmeasured 로 떨어뜨린다(반사실 — `resolveCellShapeSpec`).
 *
 * @param {'oak'|'y'} table
 * @param {string} kind 셀 모양(square 제외)
 * @param {number|null} param 강도(round-bevel 은 null)
 * @param {object} ctx `cellShapeCtx` 문맥(`CELL_SHAPE_REQUIRED_CTX_KEYS[table]`)
 * @returns {string|null}
 */
export function cellShapeStructuralLock(table, kind, param, ctx) {
  return designLock(table, kind, param, ctx) ?? measuredConfigLock(table, ctx);
}

/**
 * 상태 + 렌더 문맥 + 허용표 → 셀 모양 spec.
 *
 * - square(키 없음 포함) → `{spec:null}` (잠금 사유 없음 — 기본값이다).
 * - 판정 순서: 모양 · 강도 도메인 → 표(타입) → 문맥 완전성(표 키 + 설계 잠금 키) → **설계 잠금**(표와 무관 · 영구) →
 *   문맥 완전성(측정 구성 키) → 허용표 행 × **측정 구성 불일치**(표와 무관하게 잠근다). 행은 문맥 · 모양 · 파라미터가
 *   **모두** 같아야 연다(type 키 포함 — 다른 타입 행은 같은 비-type 문맥이어도 이 문맥을 열지 않는다). round-bevel 의
 *   param 은 null(고정 조합).
 * - 사유는 참이어야 한다(반사실 — «그걸 따르면 열린다»): 축 사유(seat-config · ecc-level · detector-emphasis · face-gain ·
 *   export-dither · export-size)는 다른 축이 **정확히 하나**이고 «같은 표 키에서 그 축만 측정 값으로 돌리면 이 행이 열린다» 일 때만
 *   (`CELL_SHAPE_LOCK_AXES` — 둘 이상이면 unmeasured), exposed-gap 은 «틈만 흰색으로 바꾸면 열린다»(다른 축 0 ∧ 측정 상태 ∧ 흰 틈 형제 행)
 *   일 때만. 그 밖은 unmeasured. 와이어 축(seat-config · ecc-level)은 그 반사실이 **실현 가능**할 때만 — 제품 자동 경로가 측정 와이어 구성으로
 *   이 페이로드를 같은 표 키에 인코딩한다(문맥 보조 필드 `measuredStateAtTableKey`, `measuredCounterfactualHolds`). 거짓이거나
 *   모르면 unmeasured(2026-09-28, ECC 실현 조건 + 착지 검토). 보조 필드가 **거짓**이면(측정 밴드 밖 — 버전 고정 · Y 로케이터
 *   직접 선택의 짧은 페이로드) 구성이 측정과 같아도 잠그고 사유는 unmeasured 다.
 *   반사실은 표 키를 고정한다 — 제품 자동 버전에서 구성을 바꾸면 재인코딩으로 버전이 바뀌어 안 열릴 수 있다(모듈 머리말 ④).
 * - 그 밖은 `{spec:null, lockReason}`. **상태는 읽기만 한다**(동결 객체로도 동작).
 * 강도 키가 없으면 그 모양의 기본값으로 읽는다(«키 없음 ≡ 명시적 기본값», §7.1 (a)).
 *
 * @param {object} state 생성기 상태(cellShape · cellRound · cellBevel · cellGap · cellDot)
 * @param {object} ctx 렌더 시점 문맥 — `cellShapeCtx` 결과(`CELL_SHAPE_REQUIRED_CTX_KEYS[table]`)
 * @param {{ROWS?: object[], MEASURED_FLOORS?: object}} [allow] 허용표(기본 `src/cell-shape-allow.js`) — MEASURED_FLOORS 는 내보내기 크기
 *   판정(`lockAxes`)에만 쓴다
 * @returns {{spec: null | {kind:string, param:number|null}, lockReason?: string}}
 */
export function resolveCellShapeSpec(state, ctx, allow = DEFAULT_ALLOW) {
  const kind = state && state.cellShape !== undefined ? state.cellShape : CELL_SHAPE_DEFAULT;
  if (kind === CELL_SHAPE_DEFAULT) return { spec: null };
  const R = CELL_SHAPE_LOCK_REASONS;
  if (!CELL_SHAPES.includes(kind)) return { spec: null, lockReason: R.UNKNOWN_SHAPE };

  let param = null;
  if (kind !== 'round-bevel') {
    const def = CELL_SHAPE_PARAMS[kind];
    const raw = state[def.key];
    param = raw === undefined ? def.default : raw;
    if (!def.domain.includes(param)) return { spec: null, lockReason: R.PARAM_OUT_OF_DOMAIN };
  }

  const table = allowTableOf(ctx && ctx.type);
  if (!table) return { spec: null, lockReason: R.TYPE_NOT_RHOMBUS };
  const keys = CELL_SHAPE_ALLOW_KEYS[table];
  if ([...keys, ...CELL_SHAPE_LOCK_CTX_KEYS[table]].some((k) => ctx[k] === undefined)) {
    return { spec: null, lockReason: R.CTX_INCOMPLETE };
  }

  // 설계 잠금은 측정 구성 키 없이도 판정한다 — 영구 잠금 사유가 «값 모름» · «자리 탓» 보다 참이다. 측정 하네스의
  // 구조 잠금 탐침(표 키 + 설계 잠금 키만 채운 합성 문맥)도 여기서 답을 받는다.
  const design = designLock(table, kind, param, ctx);
  if (design !== null) return { spec: null, lockReason: design };
  if (CELL_SHAPE_MEASURED_CONFIG_KEYS[table].some((k) => ctx[k] === undefined)) {
    return { spec: null, lockReason: R.CTX_INCOMPLETE };
  }

  const rows = (allow && Array.isArray(allow.ROWS)) ? allow.ROWS : [];
  const hit = rows.some((row) => row
    && row.table === table
    && row.cellShape === kind
    && row.param === param
    && keys.every((k) => Object.prototype.hasOwnProperty.call(row, k) && row[k] === ctx[k]));
  // 측정 구성 · 면 게인 · 내보내기 축 불일치는 행이 있어도 잠근다(표 행은 측정 구성 · 비디더 · 잰 하한 이상에서만 잰 사실). 행 매칭은
  // 표 키만 보므로, 여기서 hit 는 곧 «같은 표 키에서 다른 축을 측정 값으로 돌린 반사실 문맥에서 이 행이 연다» 이다(표 키 고정 반사실 —
  // 자동 버전의 재인코딩은 표 키를 바꿀 수 있어 와이어 축은 `measuredStateAtTableKey` 로 따로 본다).
  const { axes, floorUnknown } = lockAxes(table, ctx, allow);
  // 측정 상태 밖(보조 필드가 **거짓** — 모름은 판정 안 함): 구성이 측정 구성과 같아도 이 표 키의 측정 밴드 밖이다(버전 고정 ·
  // Y 로케이터 직접 선택의 짧은 페이로드 — 잰 적 없는 영 패딩 구간, 2026-09-28 착지 검토 major). 행이 있어도 잠그고, 어느 한 축만
  // 바꿔서는 안 열리니 사유는 unmeasured(틈 탓도 아니다 — 아래 whiteSibling 이 같은 조건을 본다).
  const outOfMeasuredState = ctx.measuredStateAtTableKey === false;
  if (hit) {
    // 잰 하한을 모르는 표 키(표가 하한을 싣는데 이 키가 없다)는 크기를 잴 수 없다 — 잠그고, 어느 축을 따라도 열린다고 말할 수 없다.
    if (floorUnknown) return { spec: null, lockReason: R.UNMEASURED };
    if (axes.length === 0) return outOfMeasuredState ? { spec: null, lockReason: R.UNMEASURED } : { spec: { kind, param } };
    // 축 사유는 다른 축이 정확히 하나이고 그 반사실을 따를 수 있을 때만(`measuredCounterfactualHolds` — 와이어 축은 같은 표 키에 측정
    // 상태가 있어야 한다). 둘 이상이면 어느 한 축만 따라서는 안 열린다 — unmeasured(2026-09-28 외부 검토 major).
    if (axes.length === 1 && measuredCounterfactualHolds(axes[0], ctx)) return { spec: null, lockReason: axes[0] };
    return { spec: null, lockReason: R.UNMEASURED };
  }

  // 사유도 표에서 유도한다. exposed-gap = 노출형 × 비흰 틈 × **흰 틈 형제 행이 있다**(틈 · 바탕만 다르고
  // 나머지 표 키 · 모양 · 강도가 같은 행 — 측정 격자에서 틈 등급과 bgMode 는 짝지어 움직인다). 틈이 실제로
  // 가르는 축일 때만 «틈 탓» 이다. 스텁 표 시절의 «노출형 × 비흰 틈 ⇒ 틈 탓» 은 실측 표에서 거짓이 됐다 —
  // Y 투명(unknown) n13 은 둥글게를 여는데 행이 없는 n21 에서도 «틈 탓» 이라 말했다(2026-09-27 화면 확인).
  // 다른 축(측정 구성 · 면 게인 · 내보내기)까지 다르면 틈만 바꿔서는 안 열린다 — 한 축이 가르지 않으니 unmeasured. 흰 틈 형제의 잰
  // 하한 키는 이 문맥과 같다(하한 키는 타입 · 버전/n · 레이아웃뿐) — 하한을 모르면 형제도 모른다.
  // 그 밖은 unmeasured — 미측정 · 측정 실패 · 판정 무효를 표는 가르지 않으므로 «판독이 확인되지 않음» 이다.
  const whiteSibling = axes.length === 0 && !floorUnknown && !outOfMeasuredState && EXPOSED_CELL_SHAPES.includes(kind) && ctx.gapGrade !== 'white'
    && rows.some((row) => row
      && row.table === table
      && row.cellShape === kind
      && row.param === param
      && row.gapGrade === 'white'
      && keys.every((k) => k === 'gapGrade' || k === 'bgMode'
        || (Object.prototype.hasOwnProperty.call(row, k) && row[k] === ctx[k])));
  return { spec: null, lockReason: whiteSibling ? R.EXPOSED_GAP : R.UNMEASURED };
}

// ── 문맥 (§2.3 ctx · 통합자 결정 1) ──────────────────────────────────────────────

/** 실효 틈 등급(§3.0) — 셀 아래에 실제로 보이는 것: 흰 판·흰 평탄화 / 검정 판·검정 평탄화 / 미지 표면. */
export const CELL_GAP_GRADES = Object.freeze(['white', 'black', 'unknown']);

/**
 * `quiet-auto.resolveQuietZoneChoice(...).color` 어휘(QUIET_COLOR_* — white · black · none · surface).
 * ⚠ 검증되는 사본이다: `quiet-auto.js` 는 build-finder-editor 번들에 없어 이 모듈이 import 할 수 없다.
 * `test/cell-shape-ctx-locks.test.js` 가 quiet-auto 의 QUIET_COLOR_* 전부가 여기 있는지 잰다.
 */
export const CELL_GAP_QUIET_COLORS = Object.freeze(['white', 'black', 'none', 'surface']);

/**
 * 실효 틈 등급 유도 — **렌더 뒤에야 아는 값**(안전영역 판 색)을 `render.quietColor` 로 받는다.
 *   quietMode 'contrast' → 'unknown' (설계 §3.0: 판 색이 배치 사진에 따라 바뀐다 — 미지 표면으로 묶는다)
 *   판 white → 'white' · 판 black → 'black' · 판 surface(배치 사진 지면 색) → 'unknown'
 *   판 없음 → 배경 평탄화: bgMode white → 'white' · black → 'black' · transparent → 'unknown'
 *     (Y 기본 = auto 가 판을 안 깐다 + 투명 → 'unknown' — 설계 §3.2 safety B2 «Y 기본은 bevel 만 후보»)
 * `render.quietColor` 가 없거나 모르는 값이면 undefined(→ resolver `ctx-incomplete` 잠금 — 잴 수 없으면 잠근다).
 * 파생값 트리거(§2.3): quiet-auto 재렌더 · 배치 사진 변경 · bgMode 변경 때 문맥을 **다시** 유도한다.
 *
 * @param {{bgMode?: string, quietMode?: string}} state
 * @param {{quietColor?: string}|null|undefined} render
 * @returns {'white'|'black'|'unknown'|undefined}
 */
export function cellGapGrade(state, render) {
  if (state && state.quietMode === 'contrast') return 'unknown';
  const q = render ? render.quietColor : undefined;
  if (!CELL_GAP_QUIET_COLORS.includes(q)) return undefined;
  if (q === 'white' || q === 'black') return q;
  if (q === 'surface') return 'unknown';
  const bg = state ? state.bgMode : undefined;
  if (bg === 'white' || bg === 'black') return bg;
  return bg === 'transparent' ? 'unknown' : undefined;
}

/**
 * 팔레트 등급 {slate, ember, mono, custom} — 상태의 `preset`(스타일 프리셋)에서. 모르는 값은
 * undefined(문맥 불완전 → 잠금). H(`generator-h.hPaletteGrade`)도 이 함수를 쓴다(한 벌).
 * custom 의 채도(customSat)는 등급 키가 아니다 — 측정 쪽(gen-allow R5)이 sat 양 끝 · 중점을 모두
 * 통과한 custom 행만 만든다.
 */
export function paletteGradeOf(state) {
  const preset = state ? state.preset : undefined;
  if (typeof preset !== 'string') return undefined;
  if (Object.prototype.hasOwnProperty.call(PRESETS, preset)) return preset;
  return preset === 'custom' ? 'custom' : undefined;
}

/** 제품이 그리는 Y 심 인접 1줄 변형. 'decorate' 는 측정 변형(L6)일 뿐 제품 선택지가 아니다. */
export const Y_SEAM_ADJACENT_PRODUCT = 'keep';

/**
 * 셀 모양 문맥의 타입 — 생성기 타입(O · A · K · Y) + 상태 + **코드**에서 유도한 실효 타입.
 *   C  = 인코딩이 `notchC`(ultra — 코드에서 판정, 상태의 versionO 표지가 아니라)
 *   G  = O + innerSeat 'o-cm' · V = A + turnA (index.html `effectiveEditorTypeFromGenerator` 와 같은 규칙)
 *   H  = Y + yRepresentation '3d' → null(사각 셀 — `generator-h.hCellStyleCtx` 가 따로 맡는다)
 * 모르는 타입 → null.
 */
export function cellShapeTypeOf(type, encoded, state) {
  const s = state || {};
  if (type === 'Y') return s.yRepresentation === '3d' ? null : 'Y';
  if (type === 'K') return 'K';
  if (type === 'O') {
    if (encoded && encoded.notchC === true) return 'C';
    return s.innerSeat === 'o-cm' ? 'G' : 'O';
  }
  if (type === 'A') return s.turnA === true ? 'V' : 'A';
  return null;
}

/** ECC 레벨 이름 도메인 — `formatinfo.ECC_NAME_BY_VALUE`(RESERVED 제외)에서 유도한다(손 목록 아님). */
const ECC_LEVEL_NAMES = Object.freeze(Object.values(ECC_NAME_BY_VALUE));

/**
 * 측정 구성 문맥 값 — **인코딩 결과**에서만 읽는다(상태 표지 아님 — `CELL_SHAPE_MEASURED_CONFIG_KEYS` 주석).
 *   cornerMarker: 인코더가 돌려준 boolean(encode · encodeA · encodeK 가 항상 싣는다), 아니면 undefined(값 모름).
 *   sagoae: 인코더가 돌려준 boolean 이 늘 우선. 키가 없으면 실효 타입 K 만 false — «개념 없음»(encodeK 는 sagoae:true 에
 *     던지고 결과에 키를 싣지 않는다; 반례 자는 test/cell-shape-measured-config.test.js). 그 밖(O/A 인데 키 없음)은 undefined.
 *   eccLevel: 인코딩이 실제로 쓴 레벨(auto 해석 뒤)이 L · M · H 중 하나면 그 값, 아니면 undefined.
 *   detectorEmphasis: **렌더 값**(`render.detectorEmphasis` — 생산자 옵션에서 유도한 «같은 그림 집합»)이 폐쇄집합의 '+' 목록이면
 *     그 값, 아니면 undefined(값 모름 — render 인자에 없음 포함). 인코딩에서 읽지 않는다(강조는 와이어가 아니라 렌더 축이다).
 * undefined 는 resolver 가 `ctx-incomplete` 로 잠근다 — 개념 없음(명시 값)과 값 모름(undefined)을 가른다.
 */
function measuredConfigCtx(effType, encoded, render) {
  let sagoae;
  if (typeof encoded.sagoae === 'boolean') sagoae = encoded.sagoae;
  else if (effType === 'K') sagoae = false;
  return {
    cornerMarker: typeof encoded.cornerMarker === 'boolean' ? encoded.cornerMarker : undefined,
    sagoae,
    eccLevel: ECC_LEVEL_NAMES.includes(encoded.eccLevel) ? encoded.eccLevel : undefined,
    detectorEmphasis: detectorEmphasisCtxValue(render ? render.detectorEmphasis : undefined),
  };
}

/**
 * 렌더 값 → 문맥 보조 필드(표 키도 필수 키도 아니다 — 모양이 틀리거나 없으면 **키를 만들지 않는다**, 추측으로 채우지 않는다).
 *   measuredStateAtTableKey: boolean 만(generator-render-config `measuredStateAtTableKey` — 측정 상태가 이 표 키에 있는가).
 *   faceGains: Y 만, T · L · R 이 유한한 양수인 객체만 → 그 세 값의 동결 사본(generator-render-config `producerFaceGains`).
 *   exportPlan: 지금 내보내기 계획(generator-render-config `cellShapeExportPlan`) — dithered 가 boolean 인 객체만. 그 안에서 ppu(유한한
 *     양수)와 floorKey(문자열)는 **둘 다** 있을 때만, faceGainsDitherOff 는 Y 이고 게인 모양일 때만 싣는다(동결 사본).
 * 없을 때 뜻: measuredStateAtTableKey 모름 → 와이어 축 사유를 안 낸다(잠금은 같다) · faceGains 모름 → 면 게인을 판정 안 한다
 * (측정 하네스 경로 — `CELL_SHAPE_MEASURED_FACE_GAINS` 주석) · exportPlan 모름 → 내보내기 축을 판정 안 한다(측정 하네스 경로 ·
 * 제품 렌더의 첫 판정 — index.html render 가 계획을 얻은 뒤 다시 판정한다) · ppu 모름 → 크기를 판정 안 한다(내보내기 계획이 던진다 —
 * 커스텀 크기 오입력: 내보낼 그림이 없다).
 */
function renderAuxCtx(effType, render) {
  const aux = {};
  if (!render) return aux;
  if (typeof render.measuredStateAtTableKey === 'boolean') aux.measuredStateAtTableKey = render.measuredStateAtTableKey;
  const gainsOf = (g) => (g && typeof g === 'object'
    && FACE_GAIN_KEYS.every((k) => typeof g[k] === 'number' && Number.isFinite(g[k]) && g[k] > 0)
    ? Object.freeze({ T: g.T, L: g.L, R: g.R }) : undefined);
  const g = effType === 'Y' ? gainsOf(render.faceGains) : undefined;
  if (g) aux.faceGains = g;
  const plan = exportPlanFields(render.exportPlan);
  if (plan) {
    const off = effType === 'Y' ? gainsOf(render.exportPlan.faceGainsDitherOff) : undefined;
    if (off) plan.faceGainsDitherOff = off;
    aux.exportPlan = Object.freeze(plan);
  }
  return aux;
}

/** 내보내기 계획 렌더 값 → 보조 필드의 공통 모양 {dithered, ppu?, floorKey?}(동결 전 — 호출자가 더 싣고 얼린다) · 모양이 틀리면 undefined. */
function exportPlanFields(p) {
  if (!p || typeof p !== 'object' || typeof p.dithered !== 'boolean') return undefined;
  const plan = { dithered: p.dithered };
  if (typeof p.ppu === 'number' && Number.isFinite(p.ppu) && p.ppu > 0 && typeof p.floorKey === 'string') {
    plan.ppu = p.ppu;
    plan.floorKey = p.floorKey;
  }
  return plan;
}

/**
 * 내보내기 계획 렌더 값 → 문맥 보조 필드 exportPlan(셀 모양 `renderAuxCtx` 와 같은 검증 — 면 게인 필드는 없다). H 셀 스타일 문맥
 * (generator-h `hCellStyleCtx`)이 쓴다. 모양이 틀리거나 없으면 undefined(키를 만들지 않는다 — 내보내기 축을 판정 안 한다).
 * @param {{dithered: boolean, ppu?: number, floorKey?: string}|undefined} p generator-render-config `hCellStyleExportPlan` 결과
 * @returns {Readonly<{dithered: boolean, ppu?: number, floorKey?: string}>|undefined}
 */
export function exportPlanAux(p) {
  const plan = exportPlanFields(p);
  return plan ? Object.freeze(plan) : undefined;
}

function hasSlotCells(encoded) {
  const cells = encoded && encoded.cellDigits;
  if (!cells || typeof cells.values !== 'function') return undefined;
  for (const entry of cells.values()) if (entry && entry.role === 'slot') return true;
  return false;
}

/**
 * 제품 셀 모양 문맥 — resolver 에 넘기는 값의 **유일한 유도**(하네스도 이것을 쓴다).
 *
 * 공통: tones = 인코딩 tones ?? 상태 tone · gapGrade = `cellGapGrade(state, render)` · bgMode = 상태 ·
 *       paletteGrade = `paletteGradeOf(state)`.
 * O/A/K(+C/G/V) `table:'oak'`: type(실효 — `cellShapeTypeOf`) · version = 인코딩 · finderPatternId = 상태
 *       **선택값**(중앙 QR 로 렌더가 양보해도 선택값) · qrPosition = 상태 ·
 *       측정 구성 키 cornerMarker · sagoae · eccLevel(인코딩) · detectorEmphasis(렌더 값) — `measuredConfigCtx`.
 * Y `table:'y'`: cellSurfaceLayout = 인코딩 ?? 'none' · locatorProfile = 인코딩 ?? 상태 locatorProfileY(해석 뒤) ·
 *       nBand = String(인코딩 n)(구간 = n 하나) · seamAdjacent = `Y_SEAM_ADJACENT_PRODUCT` ·
 *       설계 잠금 키 qrPosition(상태) · qrWindow(인코딩 window) · qrSlot(인코딩 role 'slot' 셀 유무) ·
 *       측정 구성 키 eccLevel(인코딩) · detectorEmphasis(렌더 값).
 * 값을 모르면 그 키는 undefined 로 남는다 — resolver 가 `ctx-incomplete` 로 잠근다(추측으로 채우지 않는다).
 * 보조 필드(표 키도 필수 키도 아니다 — `renderAuxCtx`): measuredStateAtTableKey(boolean) · faceGains(Y 만) · exportPlan — 렌더 값이
 *       주면 싣고, 없거나 모양이 틀리면 **키를 만들지 않는다**(값 모름으로 잠그지 않는다 — resolver 는 그때 와이어 축 사유를 안 내고
 *       면 게인 · 내보내기 축을 판정하지 않는다).
 *
 * @param {'O'|'A'|'K'|'Y'} type 생성기 타입(`generatorState.type`)
 * @param {object} encoded 실제 인코딩 결과(자동 버전 · 레이아웃 해석 뒤)
 * @param {object} state 생성기 상태
 * @param {{quietColor?: 'white'|'black'|'none'|'surface', detectorEmphasis?: string, measuredStateAtTableKey?: boolean,
 *          faceGains?: {T: number, L: number, R: number},
 *          exportPlan?: {dithered: boolean, ppu?: number, floorKey?: string, faceGainsDitherOff?: {T: number, L: number, R: number}}}} [render]
 *   렌더 뒤에야 아는 값 — quietColor = `resolveQuietZoneChoice(...).color`(없으면 gapGrade 가 undefined — 잠금) ·
 *   detectorEmphasis = 생산자 옵션에서 유도한 실효 검출 강조(generator-render-config `detectorEmphasisEquivalents(type, encoded,
 *   sceneOpts)` — 없으면 undefined, 잠금) · measuredStateAtTableKey = 제품 자동 경로가 측정 와이어 구성으로 이 페이로드를 같은 표
 *   키에 인코딩하는가(generator-render-config `measuredStateAtTableKey` — 제품 인코더 · 자동 사다리로 유도, 와이어 축 사유의 실현 조건이자
 *   측정 밴드 판정 · 없으면 와이어 축 사유를 안 낸다) · faceGains = 생산자가 쓸 면 게인(generator-render-config `producerFaceGains` —
 *   Y 만, 없으면 면 게인을 판정 안 한다) · exportPlan = 지금 내보내기 계획의 셀 꾸미기 판정 모양(generator-render-config
 *   `cellShapeExportPlan` — 디더 여부 · ppu · 잰 하한 키 · 디더를 끈 면 게인, 없으면 내보내기 축을 판정 안 한다).
 * @returns {object|null} 문맥, 또는 마름모 셀이 아닌 타입(H 등) · 입력 없음이면 null
 */
export function cellShapeCtx(type, encoded, state, render) {
  if (!encoded || typeof encoded !== 'object' || !state || typeof state !== 'object') return null;
  const effType = cellShapeTypeOf(type, encoded, state);
  if (effType === null) return null;
  const common = {
    tones: encoded.tones ?? state.tone,
    gapGrade: cellGapGrade(state, render),
    bgMode: state.bgMode,
    paletteGrade: paletteGradeOf(state),
  };
  const config = measuredConfigCtx(effType, encoded, render);
  const aux = renderAuxCtx(effType, render);
  if (effType !== 'Y') {
    return {
      table: 'oak', type: effType, version: encoded.version, finderPatternId: state.finderPatternId,
      qrPosition: state.qrPosition, ...common,
      cornerMarker: config.cornerMarker, sagoae: config.sagoae, eccLevel: config.eccLevel,
      detectorEmphasis: config.detectorEmphasis, ...aux,
    };
  }
  return {
    table: 'y',
    type: 'Y',
    cellSurfaceLayout: encoded.cellSurfaceLayout ?? 'none',
    locatorProfile: encoded.locatorProfile ?? state.locatorProfileY,
    nBand: Number.isInteger(encoded.n) ? String(encoded.n) : undefined,
    seamAdjacent: Y_SEAM_ADJACENT_PRODUCT,
    ...common,
    qrPosition: state.qrPosition,
    qrWindow: encoded.window === true,
    qrSlot: hasSlotCells(encoded),
    eccLevel: config.eccLevel,
    detectorEmphasis: config.detectorEmphasis,
    ...aux,
  };
}

/**
 * 문맥 → 허용표 행 문맥(`table` + `CELL_SHAPE_ALLOW_KEYS[table]`, 정확히 그 키만). 영수증 행 allowCtx 의 모양.
 * 설계 잠금 키 · 측정 구성 키 · type(Y) 같은 표 밖 키는 깎는다. 모르는 표면 null.
 */
export function cellShapeAllowCtx(ctx) {
  const keys = ctx && CELL_SHAPE_ALLOW_KEYS[ctx.table];
  if (!keys) return null;
  const out = { table: ctx.table };
  for (const k of keys) out[k] = ctx[k];
  return out;
}

// ── 잰 하한 문맥 (허용표 MEASURED_FLOORS — 2026-09-28) ──────────────────────────────

/**
 * 실효 타입 → 생성기 타입(`generatorState.type` — 내보내기 하한이 받는 `current.type` 과 같은 축). `cellShapeTypeOf` 를 **훑어**
 * 유도한다(손 표 아님): 생성기 타입(`GENERATOR_TYPES`)마다 실효 타입을 가르는 입력(코드 notchC · 상태 innerSeat 'o-cm' · turnA)을
 * 넣어 나온 실효 타입을 모은다. 한 실효 타입이 두 생성기 타입에서 나오면 그 실효 타입은 **모호**(null)로 두고
 * `CELL_SHAPE_GENERATOR_TYPE_COLLISIONS` 에 적는다 — 로드 때 던지지 않는다(이 사상의 소비자는 잰 하한 자뿐인데, 이 모듈은 생성기 ·
 * 시험판 · 파인더 편집기 번들 전부가 싣는다: 던지면 번들이 통째로 안 뜬다 — 2026-09-28 착지 검토 minor). 모호하거나 이 입력 밖의
 * 새 축으로 갈리면 `allowRowFloorCtx` 가 null 을 내고, 잰 하한 자(test/cell-shape-measured-floors.test.js)가 빨개진다(fail-closed).
 */
const GENERATOR_TYPE_DERIVATION = (() => {
  const probes = [[{}, {}], [{ notchC: true }, {}], [{}, { innerSeat: 'o-cm' }], [{}, { turnA: true }]];
  const out = {};
  const collisions = [];
  for (const gen of GENERATOR_TYPES) {
    for (const [encoded, state] of probes) {
      const eff = cellShapeTypeOf(gen, encoded, state);
      if (eff === null) continue;
      if (out[eff] !== undefined && out[eff] !== gen) {
        collisions.push(`${eff}: ${out[eff] ?? '?'} · ${gen}`);
        out[eff] = null;
        continue;
      }
      out[eff] = gen;
    }
  }
  return { map: Object.freeze(out), collisions: Object.freeze(collisions) };
})();
export const CELL_SHAPE_GENERATOR_TYPE_OF = GENERATOR_TYPE_DERIVATION.map;
/** 실효 타입 → 생성기 타입 유도의 충돌(한 실효 타입이 두 생성기 타입에서 나온다) — 비어 있어야 한다(잰 하한 자가 잰다). */
export const CELL_SHAPE_GENERATOR_TYPE_COLLISIONS = GENERATOR_TYPE_DERIVATION.collisions;

/**
 * 허용표 행 → 제품 하한 문맥(export-options `minRoundtripPpuKey` · `minRoundtripPpu` 의 입력 — 내보내기 경로와 같은 축:
 * 생성기 타입 · 버전, Y 는 n · 셀 표면 레이아웃). 잰 하한(허용표 `MEASURED_FLOORS`)과 제품 하한을 같은 키로 맞대는 **한 벌**의 유도다.
 *   oak → {type: 생성기 타입(`CELL_SHAPE_GENERATOR_TYPE_OF` — 실효 G · C → O, V → A), version}
 *   y   → {type: 'Y', n: Number(nBand), cellSurfaceLayout}(레이아웃 'none' 은 null — 그때 제품 키는 버전이 필요한데 행에 없어
 *         키가 어긋나 자가 빨개진다: 셀 표면 밖 Y 행이 생기면 이 유도를 먼저 넓힐 것)
 *   h   → {type: 'H', version}
 *   qr · 모르는 표 · 모르는 실효 타입 → null(qr 은 px/모듈이라 하한 키가 없다).
 * 디더 비트는 싣지 않는다(비디더 — 잰 하한이 비디더 점만 센다).
 * 세 소비자가 이 한 벌을 쓴다: (1) 잰 하한 자(test/cell-shape-measured-floors.test.js — 자동 크기의 하한 상수 export-options
 * minRoundtripPpu ≥ 잰 하한) (2) 셀 모양 카드의 내보내기 크기 잠금(generator-render-config `cellShapeExportPlan` 이 렌더 문맥의 표 키로
 * 이 유도를 불러 잰 하한 키를 싣고, resolver 가 지금 내보내기 계획의 ppu 와 맞댄다 — 고정 크기(192 · 512 px)와 커스텀 크기는 minPpu 를
 * 안 써(export-options resolveExportSize) 잰 하한 아래로 갈 수 있어서다, 2026-09-28 외부 검토 major) (3) H 셀 스타일 카드의 같은
 * 잠금(generator-render-config `hCellStyleExportPlan` → generator-h `resolveHCellStyleSpec` — 같은 날 후속 검토: H 카드에 같은 거짓
 * 열림이 남아 있었다). 그 호출 모양(index.html 내보내기 계획의 minRoundtripPpu 문맥)과 같은 키가 나오는지는 test/decoration-ui.test.js 가
 * 제품 렌더로 잰다(마름모 · H 둘 다).
 * 또 h 행의 잰 하한은 증거 케이스의 사다리 floorPpu 가 아니라 측정 격자에 더한 «제품 H 하한 점»(측정 트리의 제품 minRoundtripPpu 값 —
 * 그 점에서 대조군이 판별돼야 H 행이 열렸다)이다 — 표 머리의 «값 = 그 키 행의 증거 케이스 비디더 floorPpu» 문장은 h 에 맞지 않는다
 * (방향은 보수 — 표 머리는 생성본이라 손대지 않는다: 다음 재생성 때 생성기 문구를 고칠 몫).
 * @param {object} row 허용표 행
 * @returns {{type: string, version?: number, n?: number|null, cellSurfaceLayout?: string|null}|null}
 */
export function allowRowFloorCtx(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.table === 'oak') {
    const type = CELL_SHAPE_GENERATOR_TYPE_OF[row.type];
    return typeof type === 'string' ? { type, version: row.version } : null;
  }
  if (row.table === 'y') {
    const n = Number(row.nBand);
    return { type: 'Y', n: Number.isInteger(n) ? n : null, cellSurfaceLayout: row.cellSurfaceLayout === 'none' ? null : row.cellSurfaceLayout };
  }
  if (row.table === 'h') return { type: 'H', version: row.version };
  return null;
}
