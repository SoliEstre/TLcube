/**
 * qr-colors.js — 코너 폴백 QR 꾸미기 색 해석 + 대비 가드 G1–G4 (DESIGN_001 §2.3 · §5.2)
 *
 * 대상은 **코너 QR 3종**(O/A/K `scene.js pushQrBlock` · Y `sceneY.js` 코너 · H
 * `generator-h-qr.js` + GPU `qrTexture`)이다. 중앙 · 윈도 · 슬롯 QR 은 TL 검출 입력이라
 * 흑백 · 사각 고정이고 이 모듈을 읽지 않는다(§1.3).
 *
 * ── 색 모드 (§5.2 표) ─────────────────────────────────────────────────────
 *   default  어두운 #000 · 밝은 #fff (현행).
 *   match    어두운 = 기저 팔레트 levels[0] (커스텀이면 customSat 이 이미 반영된 원본).
 *            levels[2] 는 쓰지 않는다 — 커스텀 s=1 에서 흰 바탕 대비가 미달한다(G2).
 *   custom   어두운 = colorAtLuminance(qrHue, satAt(0.42, qrSat), Y_L0).
 *   밝은 모듈 · quiet 는 모든 모드에서 #fff(G3).
 *   Y_L0 · Y_BG 는 slate 의 levels[0] · background 상대휘도(≈ 0.0612 · 0.0053 — 설계 표의
 *   숫자)를 **유도**해 쓴다. 그래서 custom(hue h, sat p) 의 어두운 색은 hue h · customSat p
 *   커스텀 팔레트의 match 어두운 색과 같은 식이다(`makeCustomPalette` 와 같은 식 — 테스트가 잰다).
 *
 * ── 눈(파인더 7×7 어두운 모듈) 옵션 — 두 해석을 모두 순수 API 로 (§9.3 Q3) ───
 *   'none'    눈 = 어두운 색(현행 모양).
 *   'darker'  Q3 (a) — 눈을 데이터보다 **더 어둡게만**. match 는 기저 팔레트 background
 *             (가드 실패 시 colorAtLuminance(hue(levels[0]), satAt(0.32, p), Y_BG) 폴백),
 *             custom 은 colorAtLuminance(qrHue, satAt(0.32, qrSat), Y_BG). default 는 이미
 *             #000 이라 아무것도 바뀌지 않는다(비활성 = 'none' 과 같다).
 *   'custom'  Q3 (b) — 눈 hue · 채도 별도: colorAtLuminance(qrEyeHue, satAt(0.42, qrEyeSat), Y_L0).
 *             목표 Y ≈ 0.0612 ≤ 0.12(G4). 데이터와의 명암 순서는 묻지 않는다(G1 은 흰 바탕 대비만).
 *   운영자 답(§9.3 Q3, 2026-09-26): 셋 다 UI 에 올린다. 상태 키의 정본은 스키마 `qrEye`
 *   ('none'|'darker'|'custom'). 읽기 순서(`qrEyeModeOf`): `qrEye` → 초안 키 `qrEyeMode`(L0 하네스
 *   fixture 가 쓰는 철자) → 초안 키 `qrEyeDark: true`('darker').
 *   Q3 (b) 의 눈 hue · 채도는 `qrEyeHue` · `qrEyeSat`(없으면 qrHue · 중점 100).
 *
 * ── 구조 잠금 · 문맥 (통합자 결정 1 · 3, 2026-09-26) ─────────────────────────
 *   `qrDecoCtx(host, state)` 가 허용표 QR 행 문맥(host · qrCellStyle · qrColorMode · eyeMode — eyeMode 는
 *   default+darker → none 으로 접는다)의 **유일한 유도**다(하네스도 import). 호스트 'y'(Type Y 코너 QR)의
 *   꾸미기는 허용표와 무관하게 잠근다(`qr-y-host` — 설계 §5.2 safety M6: «실루엣 밖 채색 금지» 기전을
 *   재기 전까지). 잠금 사유 id 는 `QR_DECO_LOCK_REASONS`.
 *
 * ── 대비 가드 (§5.2) ──────────────────────────────────────────────────────
 * 그레이 변환 5종: 선형 Y709(상대휘도) · BT.601 luma · ZXing (R+2G+B)/4 · 감마 709(jsQR —
 * 감마 부호화 값에 709 계수) · avg. 모두 0..1 로 정규화.
 *   G1 반전 금지: 모든 변환에서 f(light) > f(dark), f(light) > f(eye).
 *      'darker' 는 추가로 f(dark) ≥ f(eye).
 *   G2 대비 하한: 모든 변환에서 min(f(light)−f(dark), f(light)−f(eye)) ≥ 0.40(ISO 15415 SC
 *      등급 C 대리값), 그리고 WCAG 대비비 ≥ 7(dark · eye 각각).
 *   G3 quiet = light = #fff.
 *   G4 어두운 · 눈 상대휘도 ≤ 0.12.
 * 로드 시 도메인 격자(`QR_LOAD_ASSERT_GRID` + 프리셋 3)로 단언하고, 반환 직전에 **실제
 * 색으로 다시 단언**한다(실패 → deco:null, lockReason 'qr-contrast'). 정수 전 도메인
 * (hue 360 × sat 201)은 `test/qr-colors.test.js` 가 잰다 — 로드 비용 분담은 아래 격자 주석.
 *
 * ── 기저 팔레트만 받는다 (safety B1 · wiring B3) ─────────────────────────
 * `basePalette` 는 `getPreset(name)` 또는 `makeCustomPalette(hue, label, sat)` 의 **원본**
 * ({name, label, background, levels})이어야 한다. 렌더 팔레트(`paletteOf` — background 가
 * 배경 3택 {null, #fff, #000} 이고 bullseyeDark · bullseyeLight · faceGains 가 붙은 모양)가
 * 들어오면 눈 색이 null 이나 흰색(파인더 소멸)이 되거나, 검정이면 대비는 맞아도 bgMode 에
 * 따라 눈 색이 바뀐다. 그래서 대비 가드와 **별도로** 모양 가드가 거부한다
 * (lockReason 'qr-base-palette').
 * ⛔ `makeCustomPalette` 를 부르지 않는다 — 한 칸 캐시(마지막 {hue, sat})를 흔들어
 * 호출 순서에 따라 label 이 바뀌는 부작용을 막는다. 색은 `colorAtLuminance` 를 직접 쓴다.
 *
 * ── 반환 ────────────────────────────────────────────────────────────────
 *   { deco: null }                              기본(default · square · 눈 없음) — 키를 만들지 않는다
 *   { deco: null, lockReason, failures? }       잠금(상태는 고치지 않는다)
 *   { deco: { dark, light, eye, cellStyle } }   적용
 */

import { getPreset, relativeLuminance } from './luminance.js';
import {
  CUSTOM_SATS, CUSTOM_SAT_MAX, CUSTOM_SAT_MIN, colorAtLuminance, satAt,
} from './palette-hue.js';
import { SQUARE_CELL_STYLES } from './square-cell-style.js';
import * as DEFAULT_ALLOW from './cell-shape-allow.js';

// ── 도메인 ───────────────────────────────────────────────────────────────

/** 색 모드. */
export const QR_COLOR_MODES = Object.freeze(['default', 'match', 'custom']);

/** 눈 옵션 — 'darker' = Q3 (a), 'custom' = Q3 (b). */
export const QR_EYE_MODES = Object.freeze(['none', 'darker', 'custom']);

/** hue 도메인(정수 °) — `qrHue` · `qrEyeHue`. 색 공식은 360 으로 감싸지만 상태는 이 폭의 정수만 받는다. */
export const QR_HUE_MIN = 0;
export const QR_HUE_MAX = 359;

/** 채도 조정 도메인(정수 %) — `qrSat` · `qrEyeSat` · `customSat` 공통. 정본은 palette-hue 의 커스텀 채도 폭. */
export const QR_SAT_MIN = CUSTOM_SAT_MIN;
export const QR_SAT_MAX = CUSTOM_SAT_MAX;
/** 채도 중점 = 기준 채도 그대로(`satAt(base, 중점) === base`). 커스텀 팔레트 · QR 색의 기본값. */
export const QR_SAT_NEUTRAL = (CUSTOM_SAT_MIN + CUSTOM_SAT_MAX) / 2;
if (satAt(0.42, QR_SAT_NEUTRAL) !== 0.42 || satAt(0.3, QR_SAT_NEUTRAL) !== 0.3) {
  throw new Error('qr-colors: 채도 중점이 기준 채도를 보존하지 않는다 — palette-hue satAt 가정 깨짐');
}

/**
 * 폴백 QR 꾸미기 상태 키의 기본값 — 스키마(`generator-state.js`)와 resolver 가 같은 값을 읽는다.
 * 기본 조합(default · square · none)이면 `resolveQrDeco` 는 `{deco:null}` = 현재 출력.
 */
export const QR_DECO_DEFAULTS = Object.freeze({
  qrCellStyle: 'square',
  qrColorMode: 'default',
  qrHue: 210,
  qrSat: QR_SAT_NEUTRAL,
  qrEye: 'none',
  qrEyeHue: 210,
  qrEyeSat: QR_SAT_NEUTRAL,
});
if (!SQUARE_CELL_STYLES.includes(QR_DECO_DEFAULTS.qrCellStyle)
  || !QR_COLOR_MODES.includes(QR_DECO_DEFAULTS.qrColorMode) || !QR_EYE_MODES.includes(QR_DECO_DEFAULTS.qrEye)) {
  throw new Error('qr-colors: QR_DECO_DEFAULTS 가 도메인 밖이다');
}

/** 잠금 사유 — **안정 id**(UI 인라인 사유 i18n 키로 매핑). 문자열을 바꾸지 않는다. */
export const QR_DECO_LOCK_REASONS = Object.freeze({
  INVALID_STATE: 'qr-invalid-state', // 모르는 모드 · 스타일 · 눈 · 범위 밖 hue/sat
  BASE_PALETTE: 'qr-base-palette', // 렌더 팔레트(paletteOf)가 들어왔다 — 기저 팔레트만 받는다
  UNMEASURED: 'qr-unmeasured', // 허용표에 행이 없다
  CONTRAST: 'qr-contrast', // 대비 가드 G1–G4 실패(런타임 재단언)
  Y_HOST: 'qr-y-host', // 구조 잠금 — Type Y 코너 QR 꾸미기(설계 §5.2 safety M6 · 통합자 결정 3)
});

/** 구조 잠금 사유(허용표에 행이 있어도 잠긴다). */
export const QR_DECO_STRUCTURAL_LOCK_REASONS = Object.freeze([QR_DECO_LOCK_REASONS.Y_HOST]);

/** 구조 잠금 호스트 — 이 호스트의 꾸미기(기본 조합 밖)는 표와 무관하게 잠긴다. */
export const QR_LOCKED_HOSTS = Object.freeze(['y']);

/** 코너 QR 호스트 — 허용표 QR 행의 `host` 도메인. */
export const QR_HOSTS = Object.freeze(['oak', 'y', 'h']);

/** 기저 팔레트 이름 — 프리셋 3 + custom. */
export const QR_BASE_PALETTE_NAMES = Object.freeze(['slate', 'ember', 'mono', 'custom']);

/**
 * **렌더 결과** 타입 → 코너 QR 호스트. C/G/V 는 O/A 생산자(scene.js)를 탄다.
 * ⚠ 생성기 상태에서 호스트를 얻을 땐 이 함수가 아니라 `qrDecoHostOf(generatorState.type, generatorState)` —
 * 생성기 상태의 H 는 `type:'Y'` + `yRepresentation:'3d'` 라 여기 넣으면 'y'(구조 잠금)로 잘못 간다.
 */
export function qrHostOfType(type) {
  if (type === 'Y') return 'y';
  if (type === 'H') return 'h';
  if (['O', 'A', 'K', 'C', 'G', 'V'].includes(type)) return 'oak';
  throw new RangeError(`qr-colors: 코너 QR 호스트가 없는 타입: ${type}`);
}

/**
 * **생성기 상태** → 코너 QR 호스트 — 제품 문맥 유도의 QR 짝. H 판정은 `cell-shape.js` `cellShapeTypeOf`
 * (Y + 3d → null) · `generator-h.js` `isHGenerator` 와 같은 뜻: Y + yRepresentation '3d' = H = 'h'.
 * 순환 import 를 피하려고 조건을 옮겨 적었다 — 세 판정의 일치는 test/cell-shape-allowlist.test.js 가 격자로 잰다.
 * Y 2.5D → 'y'(구조 잠금) · O/A/K → 'oak'. 렌더 결과 타입('H' · C/G/V)도 받는다(`qrHostOfType` 위임).
 *
 * @param {string} type generatorState.type(O|A|K|Y) 또는 렌더 결과 타입
 * @param {object} [state] 생성기 상태(yRepresentation 을 읽는다)
 * @returns {'oak'|'y'|'h'}
 */
export function qrDecoHostOf(type, state) {
  if (type === 'Y' && state && state.yRepresentation === '3d') return 'h';
  return qrHostOfType(type);
}

// ── 색 상수 ──────────────────────────────────────────────────────────────

const WHITE = Object.freeze({ r: 255, g: 255, b: 255 });
const BLACK = Object.freeze({ r: 0, g: 0, b: 0 });

const SLATE = getPreset('slate');
/** 어두운 모듈 목표 상대휘도 = slate levels[0] (≈ 0.0612). */
export const QR_DARK_TARGET_Y = relativeLuminance(SLATE.levels[0]);
/** 'darker' 눈 목표 상대휘도 = slate background (≈ 0.0053). */
export const QR_EYE_TARGET_Y = relativeLuminance(SLATE.background);
/** 어두운 모듈 HSL 기준 채도(= CUSTOM_SATS.levels[0]). */
export const QR_DARK_BASE_SAT = CUSTOM_SATS.levels[0];
/** 'darker' 눈 HSL 기준 채도(= CUSTOM_SATS.background). */
export const QR_EYE_BASE_SAT = CUSTOM_SATS.background;

/** 가드 문턱. */
export const QR_GUARD = Object.freeze({
  minContrast: 0.40, // G2 — 모든 그레이 변환
  minWcag: 7, // G2 — WCAG 대비비
  maxDarkY: 0.12, // G4
});

// ── 그레이 변환 5종 ──────────────────────────────────────────────────────

/** 이름 → (rgb → 0..1). 디코더마다 흑백으로 옮기는 식이 달라 전부에서 대비를 본다. */
export const QR_GRAY_TRANSFORMS = Object.freeze({
  /** 선형 Y709 — SPEC §4.4 상대휘도. */
  y709: (c) => relativeLuminance(c),
  /** BT.601 luma (감마 부호화 값). */
  bt601: (c) => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255,
  /** ZXing RGBLuminanceSource — 정수 (R+2G+B)/4. */
  zxing: (c) => Math.floor((c.r + 2 * c.g + c.b) / 4) / 255,
  /** 감마 709 — jsQR 은 감마 부호화 값에 709 계수를 곧바로 곱한다. */
  gamma709: (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255,
  /** 채널 평균. */
  avg: (c) => (c.r + c.g + c.b) / 3 / 255,
});

function wcagRatio(light, dark) {
  const a = relativeLuminance(light);
  const b = relativeLuminance(dark);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function isRgb(c) {
  return !!c && typeof c === 'object'
    && [c.r, c.g, c.b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
}

/**
 * 대비 가드 G1–G4. 실패 목록을 모두 모아 돌려준다(첫 실패에서 멈추지 않는다 —
 * 심은 결함 시험이 «어느 문이 막았는가» 를 단언할 수 있게).
 *
 * @param {{dark:{r,g,b}, light:{r,g,b}, eye:{r,g,b}}} colors
 * @param {{eyeMode?: 'none'|'darker'|'custom'}} [opts]
 * @returns {{ok: boolean, failures: {gate: string, transform?: string, detail: string}[]}}
 */
export function qrContrastGuard(colors, opts = {}) {
  const failures = [];
  const { dark, light, eye } = colors || {};
  if (!isRgb(dark) || !isRgb(light) || !isRgb(eye)) {
    return { ok: false, failures: [{ gate: 'shape', detail: 'dark · light · eye 는 0..255 정수 {r,g,b} 여야 한다' }] };
  }
  const darker = opts.eyeMode === 'darker';
  for (const [name, f] of Object.entries(QR_GRAY_TRANSFORMS)) {
    const fl = f(light);
    const fd = f(dark);
    const fe = f(eye);
    if (!(fl > fd) || !(fl > fe)) {
      failures.push({ gate: 'G1', transform: name, detail: `반전: light ${fl} · dark ${fd} · eye ${fe}` });
    }
    if (darker && !(fd >= fe)) {
      failures.push({ gate: 'G1', transform: name, detail: `눈이 데이터보다 밝다: dark ${fd} < eye ${fe}` });
    }
    const margin = Math.min(fl - fd, fl - fe);
    if (!(margin >= QR_GUARD.minContrast)) {
      failures.push({ gate: 'G2', transform: name, detail: `대비 ${margin} < ${QR_GUARD.minContrast}` });
    }
  }
  const wDark = wcagRatio(light, dark);
  const wEye = wcagRatio(light, eye);
  if (!(Math.min(wDark, wEye) >= QR_GUARD.minWcag)) {
    failures.push({ gate: 'G2', transform: 'wcag', detail: `WCAG ${Math.min(wDark, wEye)} < ${QR_GUARD.minWcag}` });
  }
  if (!(light.r === 255 && light.g === 255 && light.b === 255)) {
    failures.push({ gate: 'G3', detail: `light(quiet) 가 #fff 가 아니다: ${JSON.stringify(light)}` });
  }
  const yDark = relativeLuminance(dark);
  const yEye = relativeLuminance(eye);
  if (!(yDark <= QR_GUARD.maxDarkY) || !(yEye <= QR_GUARD.maxDarkY)) {
    failures.push({ gate: 'G4', detail: `Y dark ${yDark} · eye ${yEye} > ${QR_GUARD.maxDarkY}` });
  }
  return { ok: failures.length === 0, failures };
}

// ── 기저 팔레트 모양 가드 ─────────────────────────────────────────────────

/** 렌더 팔레트(`paletteOf`)에만 있는 키 — 기저 팔레트에 하나라도 있으면 거부. */
const RENDER_PALETTE_KEYS = Object.freeze(['bullseyeDark', 'bullseyeLight', 'faceGains']);

/**
 * 기저 팔레트(getPreset · makeCustomPalette 원본)인가. 렌더 팔레트는 name 이 없고,
 * background 가 배경 3택(null 가능)이며, 렌더 전용 키가 붙어 있다.
 * @returns {string|null} 거부 사유(null = 통과)
 */
export function basePaletteProblem(p) {
  if (!p || typeof p !== 'object') return 'basePalette 가 객체가 아니다';
  for (const key of RENDER_PALETTE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(p, key)) return `렌더 팔레트 키 '${key}' 가 있다(paletteOf 결과가 들어왔다)`;
  }
  if (!QR_BASE_PALETTE_NAMES.includes(p.name)) return `name 이 기저 팔레트 이름이 아니다: ${p.name}`;
  if (!isRgb(p.background)) return 'background 가 {r,g,b} 가 아니다(배경 3택의 null?)';
  if (!Array.isArray(p.levels) || p.levels.length !== 3 || !p.levels.every(isRgb)) return 'levels 가 {r,g,b} 3개가 아니다';
  return null;
}

// ── 색 공식 ─────────────────────────────────────────────────────────────

/** RGB → HSL hue(0..360, 무채색은 0). 삼각함수 없음. */
export function hueOfRgb(c) {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** custom 모드 어두운 색 · Q3 (b) 눈 색 공식. */
export function qrCustomDark(hue, sat) {
  return colorAtLuminance(hue, satAt(QR_DARK_BASE_SAT, sat), QR_DARK_TARGET_Y);
}

/** 'darker' 눈 색 공식(custom 모드 · match 폴백). */
export function qrDarkerEye(hue, sat) {
  return colorAtLuminance(hue, satAt(QR_EYE_BASE_SAT, sat), QR_EYE_TARGET_Y);
}

function normHue(h) {
  return ((h % 360) + 360) % 360;
}

function validSat(p) {
  return Number.isFinite(p) && p >= QR_SAT_MIN && p <= QR_SAT_MAX;
}

/**
 * 상태에서 눈 옵션을 읽는다: 스키마 키 `qrEye` → 초안 키 `qrEyeMode`(하네스 fixture 철자) →
 * 초안 키 `qrEyeDark`(true → 'darker'). 셋 다 없으면 'none'.
 */
export function qrEyeModeOf(state) {
  const s = state || {};
  if (s.qrEye !== undefined) return s.qrEye;
  if (s.qrEyeMode !== undefined) return s.qrEyeMode;
  return s.qrEyeDark === true ? 'darker' : QR_DECO_DEFAULTS.qrEye;
}

// ── 허용표 ─────────────────────────────────────────────────────────────

/** 허용표 QR 행의 키(와일드카드 없음 — 하나라도 빠지면 그 행은 아무것도 허가하지 않는다). */
export const QR_ALLOW_KEYS = Object.freeze(['host', 'qrCellStyle', 'qrColorMode', 'eyeMode']);

function allowedByTable(allow, key) {
  if (!allow || !Array.isArray(allow.ROWS)) {
    throw new TypeError('qr-colors: allow 는 ROWS 배열을 가진 허용표여야 한다(cell-shape-allow.js)');
  }
  return allow.ROWS.some((row) => row && row.table === 'qr'
    && QR_ALLOW_KEYS.every((k) => Object.prototype.hasOwnProperty.call(row, k) && row[k] === key[k]));
}

/**
 * 제품 QR 꾸미기 문맥 — 허용표 QR 행 문맥의 **유일한 유도**(하네스도 이것을 쓴다; H 의
 * `hCellStyleCtx` 선례). `{table:'qr', host, qrCellStyle, qrColorMode, eyeMode}` — QR_ALLOW_KEYS 전부.
 *   - 없는 키는 `QR_DECO_DEFAULTS`. 눈은 `qrEyeModeOf`.
 *   - eyeMode 는 접는다: default 의 어두운 색은 이미 #000 이라 'darker' 는 바꿀 것이 없다 → 'none'.
 *   - 값 검증은 하지 않는다(모르는 값은 그대로 — resolver 가 `qr-invalid-state` 로 잠근다).
 *
 * @param {'oak'|'y'|'h'} host 코너 QR 호스트(생성기 상태에서는 `qrDecoHostOf(type, state)`)
 * @param {object} state 생성기 상태
 * @returns {{table:'qr', host:string, qrCellStyle:string, qrColorMode:string, eyeMode:string}}
 */
export function qrDecoCtx(host, state) {
  const s = state || {};
  const qrColorMode = s.qrColorMode ?? QR_DECO_DEFAULTS.qrColorMode;
  const raw = qrEyeModeOf(s);
  return {
    table: 'qr',
    host,
    qrCellStyle: s.qrCellStyle ?? QR_DECO_DEFAULTS.qrCellStyle,
    qrColorMode,
    eyeMode: qrColorMode === 'default' && raw === 'darker' ? 'none' : raw,
  };
}

// ── 해석 ───────────────────────────────────────────────────────────────

function lock(lockReason, extra = {}) {
  return { deco: null, lockReason, ...extra };
}

/**
 * 상태 + 기저 팔레트 + 호스트 → 코너 QR 꾸미기. 순수 함수 — 상태 · 팔레트를 고치지 않는다.
 * 판정 순서: 상태 도메인 → 기본 조합(`{deco:null}`, 사유 없음) → **구조 잠금**(호스트 'y' — 표와 무관) →
 * 기저 팔레트 모양 → 허용표 행(`qrDecoCtx`) → hue/sat 범위 → 대비 가드(반환 직전 재단언).
 *
 * @param {object} state 생성기 상태(qrColorMode · qrCellStyle · qrHue · qrSat · qrEye|qrEyeMode|qrEyeDark ·
 *   qrEyeHue · qrEyeSat · customSat 를 읽는다. 없는 키는 `QR_DECO_DEFAULTS`)
 * @param {{name, label, background, levels}} basePalette getPreset / makeCustomPalette 원본
 * @param {'oak'|'y'|'h'} host
 * @param {{ROWS: object[]}} [allow] 허용표(기본 `cell-shape-allow.js`)
 */
export function resolveQrDeco(state, basePalette, host, allow = DEFAULT_ALLOW) {
  if (!QR_HOSTS.includes(host)) throw new RangeError(`qr-colors: 모르는 호스트: ${host}`);
  const R = QR_DECO_LOCK_REASONS;
  const s = state || {};
  const ctx = qrDecoCtx(host, s);
  const colorMode = ctx.qrColorMode;
  const cellStyle = ctx.qrCellStyle;
  const eyeMode = ctx.eyeMode;
  if (!QR_COLOR_MODES.includes(colorMode) || !SQUARE_CELL_STYLES.includes(cellStyle) || !QR_EYE_MODES.includes(eyeMode)) {
    return lock(R.INVALID_STATE);
  }
  // 기본 조합 = 현재 출력(키를 만들지 않는다). eyeMode 는 qrDecoCtx 가 이미 접었다(default+darker → none).
  if (colorMode === QR_DECO_DEFAULTS.qrColorMode && cellStyle === QR_DECO_DEFAULTS.qrCellStyle
    && eyeMode === QR_DECO_DEFAULTS.qrEye) return { deco: null };

  // 구조 잠금 — 허용표 · 팔레트와 무관(통합자 결정 3). 사유가 «측정 전» 이 아니라 «설계 1차 잠금» 임을 보인다.
  if (QR_LOCKED_HOSTS.includes(host)) return lock(R.Y_HOST);

  const paletteProblem = basePaletteProblem(basePalette);
  if (paletteProblem !== null) return lock(R.BASE_PALETTE, { detail: paletteProblem });

  if (!allowedByTable(allow, ctx)) return lock(R.UNMEASURED);

  const qrHue = s.qrHue ?? QR_DECO_DEFAULTS.qrHue;
  const qrSat = s.qrSat ?? QR_DECO_DEFAULTS.qrSat;
  const eyeHue = s.qrEyeHue ?? qrHue;
  const eyeSat = s.qrEyeSat ?? QR_DECO_DEFAULTS.qrEyeSat;
  const customSat = s.customSat ?? QR_SAT_NEUTRAL;
  if (!Number.isFinite(qrHue) || !validSat(qrSat) || !Number.isFinite(eyeHue) || !validSat(eyeSat) || !validSat(customSat)) {
    return lock(R.INVALID_STATE);
  }

  let dark;
  let darkerEye;
  if (colorMode === 'default') {
    dark = BLACK;
    darkerEye = BLACK;
  } else if (colorMode === 'match') {
    dark = basePalette.levels[0];
    darkerEye = basePalette.background;
    // 기저 background 가 눈으로서 가드를 못 넘으면(더 밝거나 대비 미달) 공식 폴백.
    if (!qrContrastGuard({ dark, light: WHITE, eye: darkerEye }, { eyeMode: 'darker' }).ok) {
      const p = basePalette.name === 'custom' ? customSat : 100;
      darkerEye = qrDarkerEye(hueOfRgb(dark), p);
    }
  } else {
    dark = qrCustomDark(normHue(qrHue), qrSat);
    darkerEye = qrDarkerEye(normHue(qrHue), qrSat);
  }
  let eye = dark;
  if (eyeMode === 'darker') eye = darkerEye;
  else if (eyeMode === 'custom') eye = qrCustomDark(normHue(eyeHue), eyeSat);

  const colors = { dark, light: WHITE, eye };
  const guard = qrContrastGuard(colors, { eyeMode });
  if (!guard.ok) return lock(R.CONTRAST, { failures: guard.failures });
  return {
    deco: Object.freeze({
      dark: Object.freeze({ ...dark }),
      light: Object.freeze({ ...WHITE }),
      eye: Object.freeze({ ...eye }),
      cellStyle,
    }),
  };
}

// ── 로드 시 도메인 전수 단언 ──────────────────────────────────────────────

/**
 * 색 공식 도메인 전수 단언. hue × sat 격자의 어두운 색 · 'darker' 눈 · Q3 (b) 눈과 프리셋 3의
 * match 색이 G1–G4 를 모두 넘는지 본다. 어기면 던진다.
 * 'custom' 눈과 어두운 색은 서로 독립(명암 순서 무관)이라 색마다 따로 재면 조합 전수와 같다.
 *
 * @param {{hues?: number[], sats?: number[]}} [opts] 기본: hue 0–359 정수 × sat 0–200 5 간격
 * @returns {{colors: number, minMargin: number, minDarkerGap: number}}
 */
export function assertQrColorDomain(opts = {}) {
  const hues = opts.hues ?? Array.from({ length: 360 }, (_, i) => i);
  const sats = opts.sats ?? Array.from({ length: 41 }, (_, i) => i * 5);
  let colors = 0;
  let minMargin = Infinity;
  let minDarkerGap = Infinity;
  const check = (dark, eye, eyeMode, where) => {
    const g = qrContrastGuard({ dark, light: WHITE, eye }, { eyeMode });
    if (!g.ok) throw new Error(`qr-colors: 대비 가드 도메인 위반 ${where}: ${JSON.stringify(g.failures)}`);
    for (const f of Object.values(QR_GRAY_TRANSFORMS)) {
      minMargin = Math.min(minMargin, f(WHITE) - f(dark), f(WHITE) - f(eye));
      if (eyeMode === 'darker') minDarkerGap = Math.min(minDarkerGap, f(dark) - f(eye));
    }
  };
  // default + Q3 (b) 눈은 아래 custom 격자의 어두운 색과 같은 공식이라 따로 돌지 않는다.
  check(BLACK, BLACK, 'none', 'default');
  for (const name of ['slate', 'ember', 'mono']) {
    const p = getPreset(name);
    check(p.levels[0], p.background, 'darker', `match ${name}`);
    colors += 2;
  }
  for (const h of hues) {
    for (const p of sats) {
      const dark = qrCustomDark(h, p);
      const eye = qrDarkerEye(h, p);
      // custom(h,p) 와 match(custom 팔레트 h, customSat p) 는 같은 공식 — 한 번으로 둘 다 덮는다.
      check(dark, eye, 'darker', `hue ${h} sat ${p}`);
      colors += 2;
    }
  }
  return { colors, minMargin, minDarkerGap };
}

/**
 * 로드 시 단언 격자 — hue 5° × sat 25 % (72 × 9). UI 격자 전수(360 × 41)는 약 90 ms 라
 * 생성기 첫 로드마다 치르기엔 무겁다(2026-09-26 실측, 노드). 역할 분담:
 *   로드   — 거친 격자로 공식 어긋남(CUSTOM_SATS · satAt · colorAtLuminance 변경)을 즉시 잡는다.
 *   테스트 — `test/qr-colors.test.js` 가 정수 전 도메인(hue 360 × sat 201)을 잰다.
 *   런타임 — `resolveQrDeco` 가 반환 직전 실제 색을 다시 단언한다(격자 밖 값도 막힌다).
 */
export const QR_LOAD_ASSERT_GRID = Object.freeze({
  hues: Object.freeze(Array.from({ length: 72 }, (_, i) => i * 5)),
  sats: Object.freeze(Array.from({ length: 9 }, (_, i) => i * 25)),
});

// 로드 시 단언 — 팔레트 공식이 바뀌어 가드 도메인을 벗어나면 모듈 평가가 실패한다
// (capacity*.js 자기검증 선례).
assertQrColorDomain(QR_LOAD_ASSERT_GRID);
