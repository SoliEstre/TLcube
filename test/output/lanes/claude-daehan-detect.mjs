/**
 * claude-daehan-detect.mjs — **가장 싼 실험**: daehan 31셀이 실제로 검출되는가.
 *
 * 명부의 margin 0.6452 는 orientation-scorer(«좌표 회전 ∘ 면 순환» 합성 사상)가
 * 낸 값이지 이 19셀 격자 정합 검출기가 낸 값이 아니다. 용량표·RS·formatIndex 를
 * 뜯기 **전에** 이걸 확인한다 — 여기서 안 서면 그 회계는 전부 헛일이다.
 *
 * 재는 것:
 *   ① daehan 프레임을 daehan 이 되찾는가 (게이트 통과 포함)
 *   ② daehan 을 라인업에 넣으면 기존 14종이 흔들리는가 (역방향 교차 오수용)
 *   ③ 발자국이 둘이 됐을 때 검출 비용
 *
 * ⚠ 렌더는 아직 daehan 을 모른다 (인코더 예약이 없다). 그래서 프레임은 **직접
 *   합성**한다 — 31셀 톤을 그대로 칠한 이상 표본. 이건 «실물에서 된다» 가 아니라
 *   «표현·검출 경로가 성립한다» 만 재는 것이다. 그 구분을 흐리면 안 된다.
 */
import { readFileSync } from 'node:fs';
import { FINDER_CELL_MASK_PATTERNS, FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
import { OAK_FINDER_PATTERNS } from '../../../src/finder-oak-patterns.js';
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { encode } from '../../../src/encode.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { rasterize } from '../../../src/raster.js';
import { buildScene } from '../../../src/scene.js';
import { faceCentroid, facePolygon } from '../../../src/hexgrid.js';

const d = JSON.parse(readFileSync('../.agent/decoder/data/finder-daehan-editor.json', 'utf8'));
// 발자국 순서 = 중앙 19 (FINDER_CELL_ORDER 순) + 바깥 12 (정본 cells 등장 순).
const orderSet = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));
const outer = d.cells.filter((c) => !orderSet.has(c[0] + ',' + c[1]));
const CELLS = Object.freeze([
  ...FINDER_CELL_ORDER,
  ...outer.map((c) => Object.freeze({ q: c[0], r: c[1] })),
]);
const byKey = new Map(d.cells.map((c) => [c[0] + ',' + c[1], c]));
const LEVELS = CELLS.map((cell) => {
  const e = byKey.get(cell.q + ',' + cell.r);
  return e ? [e[2], e[3], e[4]] : [1, 1, 1];
});
const daehan = Object.freeze({
  id: 'oak-daehan', name: 'daehan', renderKind: 'cell-mask', family: 'oak',
  finderCells: CELLS, cellLevels: LEVELS,
});
console.log('daehan 발자국 ' + CELLS.length + '셀 · 레벨 ' + LEVELS.length
  + ' · 톤 0/1/2 = ' + [0,1,2].map((L) => LEVELS.flat().filter((x) => x === L).length).join('/'));

// ── 합성 프레임: 31셀을 정본 톤으로 칠한다 ──────────────────────────────
const CELL_PX = 16, FRAME = 640, LEVEL_Y = [0, 0.5, 1];
function synth(cells, levels) {
  const data = new Float32Array(FRAME * FRAME).fill(0.5);
  const layout = { size: CELL_PX, originX: FRAME / 2, originY: FRAME / 2 };
  for (let i = 0; i < cells.length; i += 1) {
    for (let f = 0; f < 3; f += 1) {
      const face = ['T', 'L', 'R'][f];
      const poly = facePolygon(cells[i].q, cells[i].r, face, layout);
      fillPolygon(data, poly, LEVEL_Y[levels[i][f]]);
    }
  }
  return { width: FRAME, height: FRAME, data };
}
function fillPolygon(data, poly, value) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(FRAME - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(FRAME - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    if (inside(poly, x + 0.5, y + 0.5)) data[y * FRAME + x] = value;
  }
}
function inside(poly, px, py) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

const LINEUP = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS, daehan];
console.log('\n=== ① daehan 프레임 → daehan 인가 ===');
const luma = synth(CELLS, LEVELS);
const r = detectCellFinders(luma, LINEUP, {
  centerSeeds: [{ x: FRAME / 2, y: FRAME / 2 }], cellSizeSeeds: [CELL_PX],
});
if (!r.ok) console.log('  ★ 검출 실패:', JSON.stringify(r.reason));
else {
  const b = r.candidates[0];
  console.log('  뽑힘 ' + b.patternId + (b.patternId === 'oak-daehan' ? '  ✅' : '  ★'));
  console.log('  correlation ' + b.correlation.toFixed(4) + ' · contrastRatio '
    + b.contrastRatio.toFixed(4) + ' · orientationMargin ' + b.orientationMargin.toFixed(4));
  console.log('  게이트 ' + JSON.stringify(b.hardChecks));
}

console.log('\n=== ② 역방향 — 기존 14종이 daehan 편입 후에도 자기 이름인가 ===');
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = { background: PRESET.background, levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT };
let stolen = 0;
for (const p of [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS]) {
  const enc = encode('daehan lineup', { version: 2, eccLevel: 'M' });
  const scene = buildScene(enc, { palette: PALETTE, finderPatternId: p.id });
  const lm = toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 12, supersample: 2 }));
  const rr = detectCellFinders(lm, LINEUP, { cellSizeSeeds: [12] });
  const got = rr.ok ? rr.candidates[0].patternId : '(실패)';
  if (got !== p.id) { stolen += 1; console.log('  ★ ' + p.id + ' → ' + got); }
}
console.log('  가로챈 수: ' + stolen + (stolen === 0 ? '  ✅' : ''));

console.log('\n=== ③ 발자국 둘일 때 비용 ===');
const enc = encode('cost', { version: 2, eccLevel: 'M' });
const costLuma = toRelativeLuminance(rasterize(
  buildScene(enc, { palette: PALETTE, finderPatternId: 'tristar-refined-h3' }),
  { pixelsPerUnit: 12, supersample: 2 }));
const A = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS];
const B = LINEUP;
const once = (p) => { const t = process.hrtime.bigint();
  detectCellFinders(costLuma, p, { cellSizeSeeds: [12] });
  return Number(process.hrtime.bigint() - t) / 1e6; };
for (let i = 0; i < 60; i += 1) { once(A); once(B); }
const a = [], b = [];
for (let i = 0; i < 100; i += 1) {
  if (i % 2 === 0) { a.push(once(A)); b.push(once(B)); } else { b.push(once(B)); a.push(once(A)); }
}
const med = (xs) => { const s2 = [...xs].sort((x, y) => x - y); return s2[s2.length >> 1]; };
console.log('  발자국 1개 (14후보): ' + med(a).toFixed(3) + ' ms');
console.log('  발자국 2개 (15후보): ' + med(b).toFixed(3) + ' ms');
console.log('  증가 ' + (((med(b) / med(a)) - 1) * 100).toFixed(1) + ' %  ← 표본을 한 벌 더 뜬 값');
