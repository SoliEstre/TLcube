/**
 * claude-misrec-verify.mjs — 「게이트를 통과하는 오수용」 재현 (통합자 독립 확인).
 *
 * ⚠ 1차 시도는 0/42 가 나왔는데 **빈 측정**이었다: `distortImage` 에는
 *   `translate` 옵션이 **없다** (조용히 무시된다 — 실측 0픽셀 변화).
 *   레인의 오수용은 정확히 «이동이 섞인 자세» 에 몰려 있었으므로 내 프로브는
 *   그 자세를 애초에 만들지 못했다. 그래서 이동을 직접 구현한다.
 *
 * 그리고 **라인업 크기를 갈라서** 잰다:
 *   · 14후보 (현재 배포본) — 오수용이 여기서도 나면 **기존 성질**
 *   · 15후보 (daehan 포함) — 여기서만 나면 **편입이 만드는 것**
 * 이 구분이 처방을 완전히 바꾼다.
 */
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { encode } from '../../../src/encode.js';
import { FINDER_CELL_MASK_PATTERNS, FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
import { OAK_FINDER_PATTERNS } from '../../../src/finder-oak-patterns.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { rasterize } from '../../../src/raster.js';
import { buildScene } from '../../../src/scene.js';
import { distortImage } from '../../harness/distort.mjs';
import { readFileSync } from 'node:fs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = { background: PRESET.background, levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT };
const FILL = { ...PRESET.background, a: 255 };

/** 하네스에 없는 평행이동 — 픽셀 단위 시프트, 빈 곳은 배경으로. */
function translateImage(img, dx, dy) {
  const out = new Uint8ClampedArray(img.pixels.length);
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const o = (y * img.width + x) * 4;
      const sx = x - dx, sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) {
        out[o] = FILL.r; out[o+1] = FILL.g; out[o+2] = FILL.b; out[o+3] = 255;
      } else {
        const s = (sy * img.width + sx) * 4;
        out[o] = img.pixels[s]; out[o+1] = img.pixels[s+1];
        out[o+2] = img.pixels[s+2]; out[o+3] = img.pixels[s+3];
      }
    }
  }
  return { width: img.width, height: img.height, pixels: out };
}

const DAEHAN = JSON.parse(readFileSync('test/output/lanes/daehan-k10.json', 'utf8'));
const dCells = DAEHAN.userNonData.map((c) => ({ q: c.q, r: c.r }));
const dTone = new Map(DAEHAN.toneOverrides.map((t) => [t.face+':'+t.q+','+t.r, t.tone]));
const daehan = Object.freeze({
  id: 'oak-daehan-k10', renderKind: 'cell-mask', family: 'oak',
  finderCells: dCells,
  cellLevels: dCells.map((c) => ['T','L','R'].map((f) =>
    dTone.has(f+':'+c.q+','+c.r) ? dTone.get(f+':'+c.q+','+c.r) : 1)),
});

const BASE = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS];
const POSES = [
  ['참 자세',             (i) => i],
  ['이동 (14,-9)',        (i) => translateImage(i, 14, -9)],
  ['회전 13°',            (i) => distortImage(i, { rotation: 13, fill: FILL })],
  ['복합 13°/×0.95/이동', (i) => translateImage(
      distortImage(i, { rotation: 13, scale: 0.95, fill: FILL }), 14, -9)],
];

function render(id) {
  const enc = encode('misrec probe', { version: 2, eccLevel: 'M' });
  return rasterize(buildScene(enc, { palette: PALETTE, finderPatternId: id }),
    { pixelsPerUnit: 12, supersample: 2 });
}

// 이동이 실제로 걸리는지 먼저 확인 (1차 실패의 교훈)
{
  const a = render('tristar-refined-h3');
  const b = translateImage(a, 14, -9);
  let n = 0; for (let i = 0; i < a.pixels.length; i += 4) if (a.pixels[i] !== b.pixels[i]) n += 1;
  console.log('이동 자가검증: 변한 픽셀 ' + n + '/' + (a.width * a.height)
    + (n > 0 ? '  ok' : '  ★ 이동이 안 걸린다 — 여기서 멈춰라'));
  if (n === 0) process.exit(1);
}

for (const [lineLabel, lineup] of [['14후보 (현재 배포본)', BASE], ['15후보 (daehan 포함)', [...BASE, daehan]]]) {
  let pass = 0, mis = 0; const rows = [];
  for (const [poseLabel, apply] of POSES) {
    for (const p of BASE) {                       // 프레임은 기존 14후보만 (daehan 렌더 불가)
      const r = detectCellFinders(toRelativeLuminance(apply(render(p.id))), lineup,
        { cellSizeSeeds: [12] });
      if (!r.ok) continue;
      const b = r.candidates[0];
      if (!b.hardChecksPassed) continue;
      pass += 1;
      if (b.patternId !== p.id) {
        mis += 1;
        rows.push('    ' + poseLabel.padEnd(22) + p.id.padEnd(36) + '→ ' + b.patternId
          + '  corr ' + b.correlation.toFixed(4));
      }
    }
  }
  console.log('\n' + lineLabel + ': 게이트 통과 ' + pass + ' 중 오수용 **' + mis + '**');
  for (const row of rows) console.log(row);
}
console.log('\n판독: 14후보에서도 나면 기존 배포본의 성질 · 15후보에서만 나면 daehan 편입이 만드는 것.');
