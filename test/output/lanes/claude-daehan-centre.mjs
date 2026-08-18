/**
 * claude-daehan-centre.mjs — daehan 의 중앙 19셀만 떼면 무엇이 되나.
 *
 * daehan 은 명부에서 margin 0.6452 로 **가장 높다** (게이트 0.035 의 18.4×).
 * 그런데 이번 편입에서 빠졌다. 이유가 «나빠서» 가 아니라 «중앙 19셀 격자 정합
 * 검출기의 표현 범위 밖» 이라는 것을 값으로 확인한다:
 *   ① daehan 은 31셀 전체 표면이다 — 중앙 19 + 바깥 12.
 *   ② 중앙 19만 떼면 그것은 **다른 후보**다. 그 «다른 후보» 가 쓸 만한지 잰다.
 * 잰 뒤에 편입할지 말지는 운영자 판단이다 — 여기서는 사실만 만든다.
 */
import { readFileSync } from 'node:fs';
import { FINDER_CELL_ORDER, FINDER_CELL_MASK_PATTERNS } from '../../../src/finder-patterns.js';
import { OAK_FINDER_PATTERNS } from '../../../src/finder-oak-patterns.js';
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { encode } from '../../../src/encode.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { rasterize } from '../../../src/raster.js';
import { buildScene } from '../../../src/scene.js';

const d = JSON.parse(readFileSync('../.agent/decoder/data/finder-daehan-editor.json', 'utf8'));
const orderSet = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));
const byKey = new Map(d.cells.map((c) => [c[0] + ',' + c[1], c]));

const inside = d.cells.filter((c) => orderSet.has(c[0] + ',' + c[1]));
const outside = d.cells.filter((c) => !orderSet.has(c[0] + ',' + c[1]));
console.log('daehan 셀 ' + d.cells.length + ' = 중앙19 안 ' + inside.length + ' + 밖 ' + outside.length);
console.log('바깥 12셀 좌표:', outside.map((c) => '(' + c[0] + ',' + c[1] + ')').join(' '));

const levels = FINDER_CELL_ORDER.map((cell) => {
  const e = byKey.get(cell.q + ',' + cell.r);
  // 편집기 규약: export 에 없으면 중간톤(1). daehan 은 중앙 19 가 전부 있다.
  return e ? [e[2], e[3], e[4]] : [1, 1, 1];
});
const flat = levels.flat();
console.log('중앙19 톤 0/1/2 =', [0, 1, 2].map((L) => flat.filter((x) => x === L).length).join('/'),
  ' → 중간톤 ' + flat.filter((x) => x === 1).length + '면');

const candidate = { id: 'daehan-centre19', name: 'daehan (중앙19)', renderKind: 'cell-mask', cellLevels: levels };

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = {
  background: PRESET.background, levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
};
// 렌더는 등록된 id 로만 되므로, 검출만 «후보로 넣어» 잰다: 다른 패턴으로 그린
// 프레임에서 이 후보가 얼마나 뜨는지가 아니라, **자기 자신을 그린 것이 없으니**
// 여기서는 «기존 후보들과 얼마나 헷갈리는가»(교차 오수용 위험)를 본다.
const lineup = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS, candidate];
let stolen = 0;
for (const pattern of [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS]) {
  const encoded = encode('daehan probe', { version: 2, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: PALETTE, finderPatternId: pattern.id });
  const luma = toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 12, supersample: 2 }));
  const r = detectCellFinders(luma, lineup, { cellSizeSeeds: [12] });
  const got = r.ok ? r.candidates[0].patternId : '(실패)';
  if (got !== pattern.id) { stolen += 1; console.log('  ★ ' + pattern.id + ' → ' + got); }
}
console.log('\n기존 ' + (FINDER_CELL_MASK_PATTERNS.length + OAK_FINDER_PATTERNS.length)
  + '종 중 daehan-중앙19 가 가로챈 것: ' + stolen);
console.log('\n판독: 가로챔 0 이면 «편입해도 기존 검출을 안 흔든다» 는 뜻이다.');
console.log('      다만 이 후보는 daehan 이 아니다 — margin 0.6452 는 31셀 표면의 값이고,');
console.log('      중앙 19만 쓰면 바깥 12셀이 데이터로 돌아가 다른 코드가 된다.');
