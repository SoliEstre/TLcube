import { getPreset, relativeLuminance } from './luminance.js';

/** 커스텀 hue가 slate의 상대휘도 구조를 물려받을 때 쓰는 채도. */
export const CUSTOM_SATS = Object.freeze({
  background: 0.32,
  levels: Object.freeze([0.42, 0.4, 0.3]),
});

/**
 * 채도 조정값 p(0–200 %)를 기준 HSL 채도 base 에 적용한다. 100 은 base 그대로,
 * 0–100 은 선형으로 0 까지, 100–200 은 선형으로 1 까지 — 레벨마다 base 가 달라도
 * 양 끝(0 · 1)에 같이 닿아 죽은 구간이 없다. 커스텀 팔레트와 폴백 QR 색이 공유하는 정본.
 */
export function satAt(base, p) {
  if (p === 100) return base;
  if (p <= 100) return base * p / 100;
  return base + (1 - base) * (p - 100) / 100;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0; let g1 = 0; let b1 = 0;
  if (hp < 1) { r1 = c; g1 = x; } else if (hp < 2) { r1 = x; g1 = c; }
  else if (hp < 3) { g1 = c; b1 = x; } else if (hp < 4) { g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; b1 = c; } else { r1 = c; b1 = x; }
  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/** hue·sat을 고정하고 목표 상대휘도를 만족하는 HSL lightness를 이진 탐색한다. */
export function colorAtLuminance(hue, sat, targetY) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (relativeLuminance(hslToRgb(hue, sat, mid)) < targetY) lo = mid; else hi = mid;
  }
  return hslToRgb(hue, sat, (lo + hi) / 2);
}

/** 채도 조정값 p 의 도메인(%). 상태 스키마 `customSat` 의 0–200 정수와 같은 폭이다. */
export const CUSTOM_SAT_MIN = 0;
export const CUSTOM_SAT_MAX = 200;

// index.html의 기존 의미를 보존한다: 마지막 {hue, sat} 하나만 캐시하고, 같은
// {hue, sat}에 다른 label이 들어와도 처음 만든 팔레트를 돌려준다. sat 이 캐시 키에
// 들어가는 이유 — 슬라이더만 움직이면 hue 는 그대로라, hue 만 비교하면 옛 채도의
// 팔레트가 계속 나온다(«켰는데 안 먹는» 상태).
let customPaletteCache = { hue: null, sat: null, palette: null };

/**
 * slate의 배경·세 레벨 상대휘도를 유지하면서 hue(와 채도 조정 sat %)만 바꾼 팔레트.
 *
 * sat 은 레벨·배경마다 `satAt(CUSTOM_SATS.x, sat)` 으로 HSL 채도에 적용되고, 상대휘도는
 * `colorAtLuminance` 의 이진 탐색이 그대로 지킨다 — 그래서 채도를 어디로 돌려도 순위 간
 * 분리(Δmin)·2톤 대비비(ρ)·배경 분리는 slate 의 목표 Y 근처에 머문다(8비트 반올림 오차만).
 *
 * **sat === 100 이면 종전 계산과 비트 동일**하다 — `satAt(base, 100)` 이 base 를 그대로
 * 돌려주기 때문이다. 반환 객체에는 필드를 더하지 않는다: `tools/asset-render.mjs` 가
 * `JSON.stringify` 의 sha256 을 기준선과 비교한다(채도는 레벨 RGB 에만 반영된다).
 *
 * @param {number} hue 0–359 (hslToRgb 가 360 으로 감싼다)
 * @param {string} [label]
 * @param {number} [sat] 채도 조정 % (0–200, 기본 100 = 종전 채도)
 */
export function makeCustomPalette(hue, label = 'custom', sat = 100) {
  if (!Number.isFinite(sat) || sat < CUSTOM_SAT_MIN || sat > CUSTOM_SAT_MAX) {
    // 200 을 넘으면 satAt 이 1 을 넘겨 HSL 이 색역 밖 RGB 를 만든다 — 조용히 자르지 않고 던진다.
    throw new RangeError(
      `makeCustomPalette: sat=${sat} 가 도메인 [${CUSTOM_SAT_MIN}, ${CUSTOM_SAT_MAX}] 밖이다`,
    );
  }
  if (customPaletteCache.hue === hue && customPaletteCache.sat === sat) {
    return customPaletteCache.palette;
  }
  const base = getPreset('slate');
  const palette = {
    name: 'custom',
    label,
    background: colorAtLuminance(
      hue, satAt(CUSTOM_SATS.background, sat), relativeLuminance(base.background),
    ),
    levels: base.levels.map((level, index) => colorAtLuminance(
      hue, satAt(CUSTOM_SATS.levels[index], sat), relativeLuminance(level),
    )),
  };
  customPaletteCache = { hue, sat, palette };
  return palette;
}
