/**
 * claude-oak-cost.mjs — OAK 편입의 **검출 비용** 실측.
 *
 * ⚠ 1차 측정은 «편입 후가 19.9% 빠르다» 고 나왔다. 사실이 아니라 **자가 틀린
 * 것**이었다: 블록 단위로 [전, 후, 전, 후] 를 재면 뒤로 갈수록 JIT 가 더워져
 * 나중에 잰 쪽이 유리해진다 (후 측정이 9.52 → 7.19 로 계속 떨어지고 있었다).
 * 그래서 **호출 단위로 교대**하고, 예열을 충분히 준 뒤, 중앙값으로 읽는다.
 * (교훈: [[verify-what-you-are-measuring]] — 0/N 이나 부호가 뒤집힌 결과는
 *  대상이 아니라 자를 의심하라는 신호다.)
 */
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { encode } from '../../../src/encode.js';
import { FINDER_CELL_MASK_PATTERNS } from '../../../src/finder-patterns.js';
import { OAK_FINDER_PATTERNS } from '../../../src/finder-oak-patterns.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { rasterize } from '../../../src/raster.js';
import { buildScene } from '../../../src/scene.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = {
  background: PRESET.background, levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
};
const encoded = encode('oak cost', { version: 2, eccLevel: 'M' });
const scene = buildScene(encoded, { palette: PALETTE, finderPatternId: 'tristar-refined-h3' });
const luma = toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 12, supersample: 2 }));

const OLD = FINDER_CELL_MASK_PATTERNS;
const NEW = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS];

function once(patterns) {
  const start = process.hrtime.bigint();
  detectCellFinders(luma, patterns, { cellSizeSeeds: [12] });
  return Number(process.hrtime.bigint() - start) / 1e6;
}
for (let i = 0; i < 60; i += 1) { once(OLD); once(NEW); }   // 예열

const a = [], b = [];
for (let i = 0; i < 120; i += 1) {
  // 호출 단위 교대 + 순서도 매 회 뒤집는다.
  if (i % 2 === 0) { a.push(once(OLD)); b.push(once(NEW)); }
  else { b.push(once(NEW)); a.push(once(OLD)); }
}
const med = (xs) => { const s = [...xs].sort((x, y) => x - y); return s[s.length >> 1]; };
const before = med(a), after = med(b);
console.log('후보 ' + OLD.length + ' → ' + NEW.length + '  (n=' + a.length + ', 중앙값)');
console.log('  전 ' + before.toFixed(3) + ' ms');
console.log('  후 ' + after.toFixed(3) + ' ms');
console.log('  증가 ' + (((after / before) - 1) * 100).toFixed(1) + ' %'
  + '   (후보 수 증가 ' + (((NEW.length / OLD.length) - 1) * 100).toFixed(1) + ' %)');
console.log('\n판독: 후보 수 증가율보다 훨씬 작으면 관측 표본 뜨기가 지배적이라는 뜻이다');
console.log('      (표본은 후보와 무관하게 한 번, 후보마다 도는 것은 상관 계산뿐).');
