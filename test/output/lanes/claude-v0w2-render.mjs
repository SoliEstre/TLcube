/**
 * claude-v0w2-render.mjs — **렌더 픽셀 자기검증**.
 *
 * 직전 레인이 «문자 그대로 실행» 이라고 쓴 유도 검증에 렌더 코드가 0줄이었다
 * (v0W 프로그램 §26 F8). 그래서 이 레인은 정본 배열을 **실제 래스터**로 굽고,
 * 다시 픽셀에서 읽어 면별로 분류한 결과가 정본과 한 셀도 어긋나지 않는지 본다.
 *
 * 방법:
 *   ① `encodeY` → `buildSceneY` → `rasterize` (ppu 24 · supersample 2) 로 진짜 이미지
 *   ② 같은 레이아웃 파라미터로 `layoutForCube` → `moduleSampleDisc` 로 셀 중심 원판
 *   ③ 원판 안 픽셀의 상대 휘도 평균 → **면별로** 두 무리로 가른다 (면마다 게인이
 *      달라 전역 문턱은 못 쓴다 — R 게인 0.62)
 *   ④ 분류 결과 vs 정본 톤 (0=dark · 2=bright) 대조 → 불일치 0 이어야 한다
 *
 * 실행: node test/output/lanes/claude-v0w2-render.mjs [--layouts v0w2,v0w,v0x]
 * src 무수정 · RNG 없음 · test/output/ 밖에 쓰지 않는다.
 */
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { layoutForCube, moduleSampleDisc, YFACES } from '../../../src/ygrid.js';
import { locatorCellsCellSurfaceFinal } from '../../../src/cellSurfaceFinal.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { relativeLuminance8 } from '../../../src/luminance.js';
import { TL_READER_URL } from '../../../src/qr.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PAYLOAD = 'https://tl.estre.so';
const NEEDS_QR = new Set(['v0xq', 'v0wq']);
const PPU = 24;
const CELL = 1;
const MARGIN = 4;

const argLayouts = (() => {
  const at = process.argv.indexOf('--layouts');
  if (at < 0) return ['v0w2', 'v0w', 'v0x'];
  return process.argv[at + 1].split(',');
})();

function renderLayout(layoutId) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layoutId, version: 1, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, cellSize: CELL, margin: MARGIN };
  if (NEEDS_QR.has(layoutId)) opts.qrText = TL_READER_URL;
  const scene = buildSceneY(encoded, opts);
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
  return { raster, n: encoded.n };
}

/** 원판 안 픽셀의 상대 휘도 평균. */
function discLuma(raster, disc) {
  const cx = disc.x * PPU;
  const cy = disc.y * PPU;
  const r = disc.radius * PPU;
  const r2 = r * r;
  let sum = 0;
  let count = 0;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(raster.width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(raster.height - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      const at = (y * raster.width + x) * 4;
      sum += relativeLuminance8(raster.pixels[at], raster.pixels[at + 1], raster.pixels[at + 2]);
      count += 1;
    }
  }
  return count === 0 ? null : sum / count;
}

let anyFail = false;
for (const layoutId of argLayouts) {
  const { raster, n } = renderLayout(layoutId);
  const layout = layoutForCube(n, { size: CELL, margin: MARGIN });
  const cells = locatorCellsCellSurfaceFinal(n, layoutId);
  // 면별 관측 — [tone, luma] 쌍.
  const observed = Object.fromEntries(YFACES.map((f) => [f, []]));
  for (const cell of cells) {
    for (const face of YFACES) {
      const tone = cell[face];
      const disc = moduleSampleDisc(face, cell.i, cell.j, layout);
      const luma = discLuma(raster, disc);
      if (luma === null) throw new Error('원판이 캔버스 밖이다: ' + layoutId + ' ' + face + ' ' + cell.i + ',' + cell.j);
      observed[face].push({ i: cell.i, j: cell.j, tone, luma });
    }
  }
  console.log('\n══ ' + layoutId + '@' + n + ' — 래스터 ' + raster.width + '×' + raster.height
    + ' (ppu ' + PPU + ' · ss2) · 파인더 ' + cells.length + '셀 · 면 ' + (cells.length * 3) + ' ══');
  let fail = 0;
  for (const face of YFACES) {
    const rows = observed[face];
    const dark = rows.filter((r) => r.tone === 0).map((r) => r.luma).sort((a, b) => a - b);
    const bright = rows.filter((r) => r.tone === 2).map((r) => r.luma).sort((a, b) => a - b);
    const mid = rows.filter((r) => r.tone === 1);
    if (mid.length !== 0) throw new Error('정본에 mid 면이 있다 — 이 하네스는 2톤 전제다');
    // 면별 문턱 = 두 무리의 «맞닿는 극단» 의 중점. 완전 이봉이면 dark 최대 < bright 최소.
    const darkMax = dark[dark.length - 1];
    const brightMin = bright[0];
    const threshold = (darkMax + brightMin) / 2;
    const bimodal = darkMax < brightMin;
    let miss = 0;
    for (const row of rows) {
      const seen = row.luma >= threshold ? 2 : 0;
      if (seen !== row.tone) { miss += 1; fail += 1; console.log('   ✖ ' + face + ' (' + row.i + ',' + row.j + ') 정본 ' + row.tone + ' → 관측 ' + seen + ' (Y=' + row.luma.toFixed(4) + ')'); }
    }
    console.log('  ' + face + ' : dark ' + dark.length + '면 [' + dark[0].toFixed(4) + '..' + darkMax.toFixed(4)
      + '] · bright ' + bright.length + '면 [' + brightMin.toFixed(4) + '..' + bright[bright.length - 1].toFixed(4)
      + '] · 간극 ' + (brightMin - darkMax).toFixed(4)
      + ' · 이봉 ' + (bimodal ? '완전' : '**깨짐**') + ' · 불일치 ' + miss);
    if (!bimodal) fail += 1;
  }
  console.log('  ⇒ ' + layoutId + ' 불일치 ' + fail + (fail === 0 ? ' ✓' : ' ✖'));
  if (fail !== 0) anyFail = true;
}
process.exit(anyFail ? 1 : 0);
