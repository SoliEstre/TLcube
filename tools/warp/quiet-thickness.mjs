// 안전영역(여백) **크기**가 복호에 미치는 영향 — 자동 두께 규칙의 근거.
//
// 왜 필요한가: 두 실측이 반대 방향을 가리킨다.
//   · `src/quiet-auto.js` — 「투명 배경에서 흰/검 안전영역을 두르면 실루엣 검출이
//     깨진다」 ⇒ auto + Type Y 는 여백을 **안 넣는다** (기본 margin 2셀 기준).
//   · 2026-09-01 실물 실측 — 마인크래프트 큐브는 **넓은 어두운 판**이 있어야 읽혔다.
//
// 가설 (확인하거나 반박한다): 둘 다 참이고 같은 현상이다 —
//   **여백 판 자체가 «큰 어두운 다각형» 이라 코드 실루엣과 경쟁한다.**
//   판이 분석창 안에 **닫힌 도형**으로 들어오면 코드를 이긴다. 분석창을 **넘치면**
//   닫힌 도형이 아니라 경쟁하지 못한다.
//   ⇒ 여백은 「크면 좋다」가 아니라 「분석창을 넘겨야 좋다」이고, 그 사이가 최악이다.
//
// 🔴 이 파일은 자를 두 번 고쳤다 — 둘 다 «표가 한 값으로 몰리는» 신호였다:
//   ① PPU 6 → 셀당 6px 로 하한(9px) 아래라 60/60 **전패**. 「여백 무용」으로 오독할 뻔.
//   ② 배경을 잔결 노이즈로 만드니 60/60 **전승**. 실물의 경쟁자는 노이즈가 아니라
//      밝은 바닥 위의 **큰 어두운 판** 이었다.
import { encodeY } from '../../src/encodeY.js';
import { buildSceneY } from '../../src/sceneY.js';
import { addQuietZone } from '../../src/quietzone.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { GUIDE_OUTER_FRACTION, FRAME_MAX_SIDE } from '../../src/scanner-zoom.js';

const PAYLOAD = 'https://tl.estre.so';
// 🔴 셀당 픽셀이 하한(9px) 위가 되게 잡는다. 분석창 960px · 점유율 54% → 코드 520px,
//    셀 = 520/(2n) ≈ 20px — 실물 사진과 같은 대역이다.
const PPU = 20;
const P = getPreset(DEFAULT_PRESET);
const PALETTE = {
  background: P.background, levels: P.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
};
const encoded = encodeY(PAYLOAD, { cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'H' });
const n = encoded.n;

/** 씬 배경색은 «투명» 자리표지다 — 합성 때 이 색만 배경으로 갈아 끼운다. */
const KEY = { r: 1, g: 254, b: 2 };
const PLATE_COLOR = { r: 40, g: 41, b: 46 };

function render(marginCells, quietColor) {
  const scene = buildSceneY(encoded, { palette: { ...PALETTE, background: KEY }, margin: 0 });
  // ⚠ margin 0 + 색 조합은 quietZonePolygons 가 «Map maximum size exceeded» 로 죽는다.
  //    addQuietZone 계약은 margin ≥ 0 을 허용하므로 별개 결함이다 (여기서는 1 이상만 쓴다).
  return rasterize(
    quietColor ? addQuietZone(scene, { color: quietColor, margin: marginCells }) : scene,
    { pixelsPerUnit: PPU, supersample: 2 },
  );
}

/** 밝은 바닥 (모래빛, 블록 무늬 + 잔결) — 결정적. */
function groundPixel(x, y) {
  let s = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  const t = s / 4294967296;
  const blocky = ((Math.floor(x / 34) * 31 + Math.floor(y / 34) * 17) % 5) / 5;
  const v = 168 + Math.round(74 * (0.65 * blocky + 0.35 * t));
  return { r: v, g: Math.round(v * 0.96), b: Math.round(v * 0.74) };
}

let PLATE_HALF = 0;   // 어두운 판(화면 마름모)의 반대각선 px. 0 이면 판 없음.

function composite(codeRaster, canvasSide, mode) {
  const px = new Uint8ClampedArray(canvasSide * canvasSide * 4);
  const ox = Math.round((canvasSide - codeRaster.width) / 2);
  const oy = Math.round((canvasSide - codeRaster.height) / 2);
  for (let y = 0; y < canvasSide; y += 1) {
    for (let x = 0; x < canvasSide; x += 1) {
      const o = (y * canvasSide + x) * 4;
      let col = null;
      const cx = x - ox;
      const cy = y - oy;
      if (cx >= 0 && cy >= 0 && cx < codeRaster.width && cy < codeRaster.height) {
        const i = (cy * codeRaster.width + cx) * 4;
        const r = codeRaster.pixels[i];
        const g = codeRaster.pixels[i + 1];
        const b = codeRaster.pixels[i + 2];
        if (!(Math.abs(r - KEY.r) < 12 && Math.abs(g - KEY.g) < 12 && Math.abs(b - KEY.b) < 12)) {
          col = { r, g, b };
        }
      }
      if (col === null) {
        if (mode === 'plain') {
          col = { r: 244, g: 244, b: 244 };
        } else {
          const dx = Math.abs(x - canvasSide / 2);
          const dy = Math.abs(y - canvasSide / 2);
          col = (PLATE_HALF > 0 && (dx + dy) <= PLATE_HALF) ? PLATE_COLOR : groundPixel(x, y);
        }
      }
      px[o] = col.r; px[o + 1] = col.g; px[o + 2] = col.b; px[o + 3] = 255;
    }
  }
  return { width: canvasSide, height: canvasSide, pixels: px };
}

function resample(s, target) {
  const out = new Uint8ClampedArray(target * target * 4);
  const scale = s.width / target;
  for (let y = 0; y < target; y += 1) {
    const fy = (y + 0.5) * scale - 0.5;
    const y0 = Math.max(0, Math.min(s.height - 1, Math.floor(fy)));
    const y1 = Math.min(s.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < target; x += 1) {
      const fx = (x + 0.5) * scale - 0.5;
      const x0 = Math.max(0, Math.min(s.width - 1, Math.floor(fx)));
      const x1 = Math.min(s.width - 1, x0 + 1);
      const wx = fx - x0;
      const o = (y * target + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const a = s.pixels[(y0 * s.width + x0) * 4 + c];
        const b = s.pixels[(y0 * s.width + x1) * 4 + c];
        const d = s.pixels[(y1 * s.width + x0) * 4 + c];
        const e = s.pixels[(y1 * s.width + x1) * 4 + c];
        out[o + c] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
      }
    }
  }
  return { width: target, height: target, pixels: out };
}

const CODE_PX = 2 * n * PPU;
const ANALYSIS = Math.round(CODE_PX / GUIDE_OUTER_FRACTION);
const CANVAS = Math.round(ANALYSIS * 1.6);

function shoot(marginCells, quietColor, mode) {
  const r = render(marginCells, quietColor);
  const img = composite(r, CANVAS, mode);
  const off = Math.round((CANVAS - ANALYSIS) / 2);
  const sq = { width: ANALYSIS, height: ANALYSIS, pixels: new Uint8ClampedArray(ANALYSIS * ANALYSIS * 4) };
  for (let y = 0; y < ANALYSIS; y += 1) {
    const s = ((off + y) * CANVAS + off) * 4;
    sq.pixels.set(img.pixels.subarray(s, s + ANALYSIS * 4), y * ANALYSIS * 4);
  }
  try {
    const d = decodeFrontend(resample(sq, Math.min(FRAME_MAX_SIDE, ANALYSIS)), {});
    return d && d.ok && String(d.text) === PAYLOAD ? '✓' : '✗';
  } catch { return '✗'; }
}

console.log(`코드 n=${n} · ppu ${PPU} · 실루엣 폭 ${CODE_PX}px · 셀당 ${(CODE_PX / (2 * n)).toFixed(1)}px`);
console.log(`조준 가이드 ${(GUIDE_OUTER_FRACTION * 100).toFixed(0)}% ⇒ 분석 정사각 ${ANALYSIS}px (코드 폭의 ${(1 / GUIDE_OUTER_FRACTION).toFixed(2)}배)`);
console.log(`합성 캔버스 ${CANVAS}px\n`);

// 🔴 기준선 게이트 — 「여백 없음 · 균일 배경」이 안 읽히면 표 전체가 무의미하다.
PLATE_HALF = 0;
const base = shoot(1, null, 'plain');
console.log(`기준선 (균일 배경 · 판 없음): ${base}`);
if (base !== '✓') {
  console.log('❌ 기준선이 안 읽힌다 — 표를 만들지 않는다.');
  process.exit(1);
}

console.log('\n── 어두운 판(여백)의 크기를 훑는다 ──');
console.log('판이 없으면 경쟁자가 없고, 분석창을 넘치면 «닫힌 도형»이 아니다.');
console.log('그 사이가 최악이라는 것이 가설이다.\n');
console.log('판 반대각선/분석창변   판 상태                 판정');
PLATE_HALF = 0;
console.log(`${'판 없음'.padStart(20)}   ${'경쟁자 없음'.padEnd(22)} ${shoot(1, null, 'plate')}`);
for (const ratio of [0.35, 0.5, 0.7, 0.9, 1.0, 1.2, 1.5, 2.0, 3.0]) {
  PLATE_HALF = Math.round(ANALYSIS * ratio);
  // 화면 마름모(|dx|+|dy| ≤ h)가 한 변 S 인 정사각을 품으려면 h ≥ S 여야 한다.
  const state = PLATE_HALF >= ANALYSIS ? '분석창을 넘침' : '분석창 안에 닫힘';
  console.log(`${ratio.toFixed(2).padStart(20)}   ${state.padEnd(22)} ${shoot(1, null, 'plate')}`);
}
