/**
 * daehan 을 라인업에 넣으면 기존 14후보가 다치는가 — 통합자 독립 확인.
 * 레인 주장: 척도 씨앗이 없으면 5칸을 daehan 이 가져간다 (그중 3칸은 «실패 → 오수용»).
 * 씨앗 정책 셋을 갈라 재서 「본질적 잠식」인지 「척도를 모를 때만」인지 가른다.
 */
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { encode } from '../../../src/encode.js';
import { FINDER_CELL_MASK_PATTERNS } from '../../../src/finder-patterns.js';
import { OAK_FINDER_PATTERNS } from '../../../src/finder-oak-patterns.js';
import { DAEHAN_FINDER_PATTERNS } from '../../../src/finder-daehan.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { rasterize } from '../../../src/raster.js';
import { buildScene } from '../../../src/scene.js';

const P = getPreset(DEFAULT_PRESET);
const PAL = { background: P.background, levels: P.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT };
const BASE = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS];
const WITH = [...BASE, ...DAEHAN_FINDER_PATTERNS];
console.log('기존 라인업 ' + BASE.length + ' · daehan 포함 ' + WITH.length
  + ' (daehan 패턴 ' + DAEHAN_FINDER_PATTERNS.length + '종: '
  + DAEHAN_FINDER_PATTERNS.map(p => p.id).join(', ') + ')\n');

const VER = Number(process.argv[2] || 2), PPU = Number(process.argv[3] || 24);
console.log('프레임: version '+VER+' · ppu '+PPU);
const SEEDS = [
  ['S-a 중심+척도 씨앗', (w, h) => ({ centerSeeds: [{ x: w/2, y: h/2 }], cellSizeSeeds: [PPU] })],
  ['S-b 중심만',        (w, h) => ({ centerSeeds: [{ x: w/2, y: h/2 }] })],
  ['S-c 씨앗 없음',      () => ({})],
];
console.log('씨앗 정책              라인업14 자기이름  라인업N 자기이름  daehan 가로챔  실패→오수용');
for (const [label, mk] of SEEDS) {
  let ok14 = 0, okN = 0, stolen = 0, failToWrong = 0;
  const rows = [];
  for (const p of BASE) {
    const enc = encode('lineup risk', { version: VER, eccLevel: 'M' });
    const ras = rasterize(buildScene(enc, { palette: PAL, finderPatternId: p.id }),
      { pixelsPerUnit: PPU, supersample: 2 });
    const luma = toRelativeLuminance(ras);
    const opt = mk(ras.width, ras.height);
    const a = detectCellFinders(luma, BASE, opt);
    const b = detectCellFinders(luma, WITH, opt);
    const aName = a.ok && a.candidates[0].hardChecksPassed ? a.candidates[0].patternId : null;
    const bName = b.ok && b.candidates[0].hardChecksPassed ? b.candidates[0].patternId : null;
    if (aName === p.id) ok14 += 1;
    if (bName === p.id) okN += 1;
    if (bName && bName !== p.id && bName.includes('daehan')) {
      stolen += 1;
      if (aName !== p.id) failToWrong += 1;
      rows.push('      ' + p.id.padEnd(36) + (aName === p.id ? '자기이름' : (aName || '검출실패'))
        + ' → ' + bName);
    }
  }
  console.log(label.padEnd(22) + String(ok14 + '/' + BASE.length).padEnd(18)
    + String(okN + '/' + BASE.length).padEnd(18) + String(stolen).padEnd(15) + failToWrong);
  for (const r of rows) console.log(r);
}
console.log('\n판독: S-a 에서 피해 0 이면 «척도를 모를 때만» 나는 문제다.');
