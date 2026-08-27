import { getPreset, relativeLuminance } from './luminance.js';

/** 커스텀 hue가 slate의 상대휘도 구조를 물려받을 때 쓰는 채도. */
export const CUSTOM_SATS = Object.freeze({
  background: 0.32,
  levels: Object.freeze([0.42, 0.4, 0.3]),
});

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

// index.html의 기존 의미를 보존한다: 마지막 hue 하나만 캐시하고, 같은 hue에 다른
// label이 들어와도 처음 만든 팔레트를 돌려준다.
let customPaletteCache = { hue: null, palette: null };

/** slate의 배경·세 레벨 상대휘도를 유지하면서 hue만 바꾼 팔레트. */
export function makeCustomPalette(hue, label = 'custom') {
  if (customPaletteCache.hue === hue) return customPaletteCache.palette;
  const base = getPreset('slate');
  const palette = {
    name: 'custom',
    label,
    background: colorAtLuminance(
      hue, CUSTOM_SATS.background, relativeLuminance(base.background),
    ),
    levels: base.levels.map((level, index) => colorAtLuminance(
      hue, CUSTOM_SATS.levels[index], relativeLuminance(level),
    )),
  };
  customPaletteCache = { hue, palette };
  return palette;
}
