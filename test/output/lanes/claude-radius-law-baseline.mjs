/** 기존 14후보 × 4자세의 correlation 을 뜬다. 패치 전후로 돌려 비트 동일을 확인한다. */
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { encode } from '../../../src/encode.js';
import { FINDER_CELL_MASK_PATTERNS } from '../../../src/finder-patterns.js';
import { OAK_FINDER_PATTERNS } from '../../../src/finder-oak-patterns.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { rasterize } from '../../../src/raster.js';
import { buildScene } from '../../../src/scene.js';
import { distortImage } from '../../harness/distort.mjs';
const P = getPreset(DEFAULT_PRESET);
const PAL = { background: P.background, levels: P.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT };
const FILL = { ...P.background, a: 255 };
const LINEUP = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS];
const POSES = [['참', (i)=>i], ['rot13', (i)=>distortImage(i,{rotation:13,fill:FILL})],
  ['persp20', (i)=>distortImage(i,{perspective:20,fill:FILL})], ['scale0.9', (i)=>distortImage(i,{scale:0.9,fill:FILL})]];
const out = [];
for (const [pose, apply] of POSES) for (const p of LINEUP) {
  const enc = encode('baseline', { version: 2, eccLevel: 'M' });
  const luma = toRelativeLuminance(apply(rasterize(buildScene(enc,{palette:PAL,finderPatternId:p.id}),
    { pixelsPerUnit: 12, supersample: 2 })));
  const r = detectCellFinders(luma, LINEUP, { cellSizeSeeds: [12] });
  out.push(pose + '|' + p.id + '|' + (r.ok ? r.candidates[0].patternId + '|' + r.candidates[0].correlation.toFixed(12)
    + '|' + r.candidates[0].orientationMargin.toFixed(12) + '|' + r.candidates[0].hardChecksPassed : 'FAIL'));
}
console.log(out.join('\n'));
