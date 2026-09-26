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
 * `finder-patterns.js`(불스아이 계열 id) · `locatorY.js`(hex-frame id) 뿐이다 — 넷 다
 * `tools/build-single.mjs` 와 `tools/build-finder-editor.mjs` 의 MODULE_ORDER 에서 이 모듈보다
 * 앞이다. ⛔ `cellSurfaceFinal.js`(슬롯 레이아웃 목록)는 build-single 에서 **뒤**라 import 할 수
 * 없다 — 슬롯 판정은 인코딩 결과의 `role:'slot'` 셀(코드 자체)에서 읽는다(`cellShapeCtx`).
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
 * 구조 잠금이 읽는 **표 밖** 문맥 키(허용표 행에는 없다 — 표로 가를 수 없어서 따로 둔다).
 *   Y: qrPosition(상태 — 'inner' = 윈도 β · 안쪽 QR) · qrWindow(인코딩 `window` — 윈도 β 코드) ·
 *      qrSlot(인코딩에 `role:'slot'` 셀이 있는가 — 슬롯 레이아웃).
 * 빠지면 잴 수 없으므로 잠근다(`ctx-incomplete`) — fail-closed. O/A/K 는 표 키(type · finderPatternId)로
 * 충분하다(C 는 `cellShapeCtx` 가 코드에서 type 'C' 로 판정).
 */
export const CELL_SHAPE_LOCK_CTX_KEYS = Object.freeze({
  oak: Object.freeze([]),
  y: Object.freeze(['qrPosition', 'qrWindow', 'qrSlot']),
});

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
  CTX_INCOMPLETE: 'ctx-incomplete', // 문맥에 허용표 키 · 구조 잠금 키가 빠졌다 — 잴 수 없으면 잠근다
  // ── 구조 잠금(설계 1차 잠금 — 허용표에 행이 있어도 잠긴다) ──
  TYPE_C_ULTRA: 'type-c-ultra', // §3.1 — C(ultra, k ≥ 14)는 모든 모양 미측정
  Y_TWO_TONE: 'y-two-tone', // §3.2 — Y 2톤(Y*-2T) × 모든 모양
  Y_INNER_QR: 'y-inner-qr', // §3.2 — 윈도(β) 구성 · qrPosition inner × 모든 모양(inner-QR 레인 영역)
  Y_QR_SLOT: 'y-qr-slot', // §3.2 — 슬롯 레이아웃(v0TY · v0TRQ · v0TRY …) × 모든 모양
  Y_HEX_FRAME_EXPOSED: 'y-hex-frame-gap-dot', // §3.2 — hex-frame-v1 × gap/dot
  BULLSEYE_DOT: 'bullseye-dot', // §3.1 표 — 불스아이 계열(불스아이 · cube-bullseye)은 dot 전면 금지
  BEVEL_RAISED: 'bevel-raised', // §3.1 safety M13 — 돌출 bevel(게인 > 1, 1.4)은 바닥 띠를 흰 판 쪽으로 넓힌다
});

/** 구조 잠금 사유 id 전부 — `cellShapeStructuralLock` 이 낼 수 있는 값의 목록(테스트 · i18n 대조용). */
export const CELL_SHAPE_STRUCTURAL_LOCK_REASONS = Object.freeze([
  CELL_SHAPE_LOCK_REASONS.TYPE_C_ULTRA,
  CELL_SHAPE_LOCK_REASONS.Y_TWO_TONE,
  CELL_SHAPE_LOCK_REASONS.Y_INNER_QR,
  CELL_SHAPE_LOCK_REASONS.Y_QR_SLOT,
  CELL_SHAPE_LOCK_REASONS.Y_HEX_FRAME_EXPOSED,
  CELL_SHAPE_LOCK_REASONS.BULLSEYE_DOT,
  CELL_SHAPE_LOCK_REASONS.BEVEL_RAISED,
]);

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
 * 구조 잠금 판정 — 허용표와 **무관하게** 잠그는 조합이면 사유 id, 아니면 null. 순수 함수.
 * resolver 가 허용표보다 먼저 부른다(측정 영수증에 그 조합의 행이 생겨도 열리지 않는다).
 * 여는 쪽(측정 레인)이 풀려면 이 함수의 해당 줄을 **먼저 지우고 이유를 적어야** 한다.
 *
 * @param {'oak'|'y'} table
 * @param {string} kind 셀 모양(square 제외)
 * @param {number|null} param 강도(round-bevel 은 null)
 * @param {object} ctx `cellShapeCtx` 문맥(표 키 + `CELL_SHAPE_LOCK_CTX_KEYS[table]`)
 * @returns {string|null}
 */
export function cellShapeStructuralLock(table, kind, param, ctx) {
  const R = CELL_SHAPE_LOCK_REASONS;
  if (table === 'oak') {
    if (ctx.type === 'C') return R.TYPE_C_ULTRA;
    if (kind === 'dot' && BULLSEYE_FAMILY_FINDER_PATTERN_IDS.includes(ctx.finderPatternId)) return R.BULLSEYE_DOT;
  } else if (table === 'y') {
    if (ctx.tones === 2) return R.Y_TWO_TONE;
    if (ctx.qrWindow === true || ctx.qrPosition === 'inner') return R.Y_INNER_QR;
    if (ctx.qrSlot === true) return R.Y_QR_SLOT;
    if ((kind === 'gap' || kind === 'dot') && ctx.locatorProfile === LOCATOR_PROFILE_HEX_FRAME_V1) {
      return R.Y_HEX_FRAME_EXPOSED;
    }
  }
  // 게인 > 1 = 돌출(띠를 흰 쪽으로) — 1.4 가 그 값이다. 도메인이 늘어도 «돌출» 이면 잠근다.
  if (kind === 'bevel' && typeof param === 'number' && param > 1) return R.BEVEL_RAISED;
  return null;
}

/**
 * 상태 + 렌더 문맥 + 허용표 → 셀 모양 spec.
 *
 * - square(키 없음 포함) → `{spec:null}` (잠금 사유 없음 — 기본값이다).
 * - 판정 순서: 모양 · 강도 도메인 → 표(타입) → 문맥 완전성(표 키 + 구조 잠금 키) →
 *   **구조 잠금**(표와 무관) → 허용표 행. 행은 문맥 · 모양 · 파라미터가 **모두** 같아야 연다.
 *   round-bevel 의 param 은 null(고정 조합).
 * - 그 밖은 `{spec:null, lockReason}`. **상태는 읽기만 한다**(동결 객체로도 동작).
 * 강도 키가 없으면 그 모양의 기본값으로 읽는다(«키 없음 ≡ 명시적 기본값», §7.1 (a)).
 *
 * @param {object} state 생성기 상태(cellShape · cellRound · cellBevel · cellGap · cellDot)
 * @param {object} ctx 렌더 시점 문맥 — `cellShapeCtx` 결과(표 키 + 구조 잠금 키)
 * @param {{ROWS?: object[]}} [allow] 허용표(기본 `src/cell-shape-allow.js`)
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

  const structural = cellShapeStructuralLock(table, kind, param, ctx);
  if (structural !== null) return { spec: null, lockReason: structural };

  const rows = (allow && Array.isArray(allow.ROWS)) ? allow.ROWS : [];
  const hit = rows.some((row) => row
    && row.table === table
    && row.cellShape === kind
    && row.param === param
    && keys.every((k) => Object.prototype.hasOwnProperty.call(row, k) && row[k] === ctx[k]));
  if (hit) return { spec: { kind, param } };

  // 사유도 표에서 유도한다. exposed-gap = 노출형 × 비흰 틈 × **흰 틈 형제 행이 있다**(틈 · 바탕만 다르고
  // 나머지 표 키 · 모양 · 강도가 같은 행 — 측정 격자에서 틈 등급과 bgMode 는 짝지어 움직인다). 틈이 실제로
  // 가르는 축일 때만 «틈 탓» 이다. 스텁 표 시절의 «노출형 × 비흰 틈 ⇒ 틈 탓» 은 실측 표에서 거짓이 됐다 —
  // Y 투명(unknown) n13 은 둥글게를 여는데 행이 없는 n21 에서도 «틈 탓» 이라 말했다(2026-09-27 화면 확인).
  // 그 밖은 unmeasured — 미측정 · 측정 실패 · 판정 무효를 표는 가르지 않으므로 «판독이 확인되지 않음» 이다.
  const whiteSibling = EXPOSED_CELL_SHAPES.includes(kind) && ctx.gapGrade !== 'white'
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
 *       **선택값**(중앙 QR 로 렌더가 양보해도 선택값) · qrPosition = 상태.
 * Y `table:'y'`: cellSurfaceLayout = 인코딩 ?? 'none' · locatorProfile = 인코딩 ?? 상태 locatorProfileY(해석 뒤) ·
 *       nBand = String(인코딩 n)(구간 = n 하나) · seamAdjacent = `Y_SEAM_ADJACENT_PRODUCT` ·
 *       구조 잠금 키 qrPosition(상태) · qrWindow(인코딩 window) · qrSlot(인코딩 role 'slot' 셀 유무).
 * 값을 모르면 그 키는 undefined 로 남는다 — resolver 가 `ctx-incomplete` 로 잠근다(추측으로 채우지 않는다).
 *
 * @param {'O'|'A'|'K'|'Y'} type 생성기 타입(`generatorState.type`)
 * @param {object} encoded 실제 인코딩 결과(자동 버전 · 레이아웃 해석 뒤)
 * @param {object} state 생성기 상태
 * @param {{quietColor?: 'white'|'black'|'none'|'surface'}} [render] 렌더 뒤에야 아는 값 —
 *   `resolveQuietZoneChoice(...).color`. 없으면 gapGrade 가 undefined(잠금).
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
  if (effType !== 'Y') {
    return {
      table: 'oak', type: effType, version: encoded.version, finderPatternId: state.finderPatternId,
      qrPosition: state.qrPosition, ...common,
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
  };
}

/**
 * 문맥 → 허용표 행 문맥(`table` + `CELL_SHAPE_ALLOW_KEYS[table]`, 정확히 그 키만). 영수증 행 allowCtx 의 모양.
 * 구조 잠금 키 · type(Y) 같은 표 밖 키는 깎는다. 모르는 표면 null.
 */
export function cellShapeAllowCtx(ctx) {
  const keys = ctx && CELL_SHAPE_ALLOW_KEYS[ctx.table];
  if (!keys) return null;
  const out = { table: ctx.table };
  for (const k of keys) out[k] = ctx[k];
  return out;
}
