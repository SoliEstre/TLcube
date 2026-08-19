/**
 * claude-poster-offcenter.mjs — 인쇄 포스터의 v0 TL 이 **치우친 프레임**에서 사나.
 *
 * 왜: 피드백 레인 §1 이 「셀 표면 계열은 중심 씨앗 포획 반경 0.512셀 안에서만 잡히고,
 * 손으로 든 실사진의 치우침은 1.33~7.60셀」이라고 실측했다. 인쇄 포스터를 폰으로 찍는 것은
 * 정확히 그 손으로 든 경우다. 포스터를 v0 로 바꾼 것이 그 함정에 빠지는지 값으로 본다.
 *
 * 재는 것: ① 어느 검출 경로가 잡았나(finderSource) ② 치우침 0~6셀에서 복호가 사나.
 */
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { encodeY } from '../../src/encodeY.js';
import { buildSceneY } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import {
  POSTER_URL, POSTER_TL_VERSION, POSTER_TL_TONES, POSTER_TL_ECC,
  POSTER_TL_CELL_SURFACE_LAYOUT, PRINT_PALETTE,
} from '../../tools/build-print-poster.mjs';

const enc = encodeY(POSTER_URL, {
  version: POSTER_TL_VERSION, tones: POSTER_TL_TONES, eccLevel: POSTER_TL_ECC,
  cellSurface: true, cellSurfaceLayout: POSTER_TL_CELL_SURFACE_LAYOUT,
});
const OPTIONS = { bootstrap: { family: { cube: { enableCellSurfaceY: true } } } };
const PPU = 14;

const scene = buildSceneY(enc, { palette: PRINT_PALETTE, cellSize: 1, margin: 3, cornerQr: false });
const base = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });

// 배경(용지 흰색)에 코드를 offset 만큼 치우쳐 얹는다 — 프레임 중심 ≠ 코드 중심.
function offsetFrame(src, dx, dy, pad) {
  const W = src.width + pad * 2, H = src.height + pad * 2;
  const px = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < src.height; y++) {
    const ty = y + pad + dy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + pad + dx;
      if (tx < 0 || tx >= W) continue;
      const s = (y * src.width + x) * 4, t = (ty * W + tx) * 4;
      px[t] = src.pixels[s]; px[t + 1] = src.pixels[s + 1];
      px[t + 2] = src.pixels[s + 2]; px[t + 3] = 255;
    }
  }
  return { width: W, height: H, pixels: px };
}

console.log('셀 px ≈ ' + PPU + ' · 코드 ' + base.width + '×' + base.height);
console.log('치우침(셀) | 복호 | finderSource | 사유');
// 대조군: 셀표면 검출을 **끄고** 같은 것을 잰다. 여전히 살면 v0 로케이터는
// 검출에 안 쓰이고 있는 것이고(불스아이가 잡는 것), 죽으면 v0 가 진짜 경로다.
const OFF = { bootstrap: { family: { cube: { enableCellSurfaceY: false } } } };
for (const cells of [0, 0.5, 1, 2, 4, 6]) {
  const d = Math.round(cells * PPU);
  const pad = Math.max(60, d + 40);
  const frame = offsetFrame(base, d, d, pad);
  const r = decodeFrontend(frame, OPTIONS);
  const off = decodeFrontend(frame, OFF);
  const src = r.detail?.geometryDiagnostics?.finderSource
    ?? r.geometry?.finderSource ?? r.diagnostics?.finderSource ?? '?';
  console.log('  ' + String(cells).padStart(4) + '셀   | ' + (r.ok ? ' OK ' : 'FAIL')
    + ' | 셀표면끔 ' + (off.ok ? ' OK ' : 'FAIL') + ' | ' + (r.ok ? '' : JSON.stringify(r.reason)));
}
