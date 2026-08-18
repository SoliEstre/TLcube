/**
 * claude-footprint-eval.mjs — 신규 후보 «footprint» vs 기존 cell-mask 14종.
 *
 * 운영자 판정 기준 (2026-08-19): 「이것도 검출이 안 되면 셀 표면 파인더 자체가
 * 선택의 여지가 낮다」. 그래서 **합성에서 잘 되는가** 만으로는 답이 안 된다 —
 * 기존 후보들도 합성에선 다 통과하는데 실기기에서 안 잡히기 때문이다.
 * 그러므로 **왜곡·저해상 아래에서 기존 최상위와 얼마나 다른가**를 잰다.
 *
 * 대조군: bullseye 계열(실기기 순위 상위)은 cell-mask 가 아니라 이 자로 못 잰다.
 * 여기서 재는 것은 «cell-mask 계열 안에서 footprint 가 앞서는가» 뿐이다 —
 * 그 구분을 흐리지 않는다.
 */
import { readFileSync } from 'node:fs';
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { encode } from '../../../src/encode.js';
import { FINDER_CELL_MASK_PATTERNS, FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
import { OAK_FINDER_PATTERNS } from '../../../src/finder-oak-patterns.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { rasterize } from '../../../src/raster.js';
import { buildScene } from '../../../src/scene.js';
import { facePolygon } from '../../../src/hexgrid.js';
import { distortImage } from '../../harness/distort.mjs';

const J = JSON.parse(readFileSync('test/output/lanes/footprint.json', 'utf8'));
const tone = new Map(J.toneOverrides.map((t) => [t.face + ':' + t.q + ',' + t.r, t.tone]));
const levels = FINDER_CELL_ORDER.map((c) => ['T', 'L', 'R'].map((f) =>
  tone.has(f + ':' + c.q + ',' + c.r) ? tone.get(f + ':' + c.q + ',' + c.r) : 1));
const footprint = Object.freeze({
  id: 'oak-footprint', name: 'footprint', renderKind: 'cell-mask', family: 'oak',
  cellLevels: levels,
});

const P = getPreset(DEFAULT_PRESET);
const PAL = { background: P.background, levels: P.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT };
const FILL = { ...P.background, a: 255 };
const LINEUP = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS, footprint];

const FRAME = 640, CELL_PX = 16, LEVEL_Y = [0, 0.5, 1];
function synth(cells, lv) {
  const data = new Float32Array(FRAME * FRAME).fill(0.5);
  const layout = { size: CELL_PX, originX: FRAME / 2, originY: FRAME / 2 };
  for (let i = 0; i < cells.length; i += 1) for (let f = 0; f < 3; f += 1) {
    const poly = facePolygon(cells[i].q, cells[i].r, ['T', 'L', 'R'][f], layout);
    const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(FRAME-1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(FRAME-1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      let hit = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const p = poly[a], q2 = poly[b];
        if ((p.y > y+0.5) !== (q2.y > y+0.5)
          && x+0.5 < (q2.x-p.x)*(y+0.5-p.y)/(q2.y-p.y)+p.x) hit = !hit;
      }
      if (hit) data[y*FRAME+x] = LEVEL_Y[lv[i][f]];
    }
  }
  return { width: FRAME, height: FRAME, data };
}

// ── ① 이상 프레임에서의 방향 여유 (전 후보 비교) ──────────────────────────
console.log('=== ① 방향 여유 (이상 프레임, 게이트 0.035) ===');
const rows = [];
for (const p of LINEUP) {
  const lv = p.cellLevels || p.cellMasks.map((m) => [1, 2, 4].map((bit) => (m & bit ? 2 : 0)));
  const r = detectCellFinders(synth([...FINDER_CELL_ORDER], lv), [p], {
    centerSeeds: [{ x: FRAME/2, y: FRAME/2 }], cellSizeSeeds: [CELL_PX] });
  rows.push({ id: p.id, ok: r.ok,
    m: r.ok ? r.candidates[0].orientationMargin : NaN,
    c: r.ok ? r.candidates[0].correlation : NaN });
}
rows.sort((a, b) => (b.m || -1) - (a.m || -1));
for (const x of rows) {
  const mark = x.id === 'oak-footprint' ? ' ★신규' : '';
  console.log('  ' + x.id.padEnd(34) + (x.ok ? 'margin ' + x.m.toFixed(4) + '  corr ' + x.c.toFixed(4) : '검출실패') + mark);
}
const rank = rows.findIndex((x) => x.id === 'oak-footprint') + 1;
console.log('\n  → footprint 순위: ' + rank + '/' + rows.length);

// ── ② 왜곡·저해상 스윕 — 렌더 프레임으로 (자기 프레임을 자기가 읽는다) ────
console.log('\n=== ② 렌더 프레임 왜곡 스윕 (cell-mask 계열 전수) ===');
const POSES = [
  ['참', (i) => i],
  ['회전13°', (i) => distortImage(i, { rotation: 13, fill: FILL })],
  ['원근25°', (i) => distortImage(i, { perspective: 25, fill: FILL })],
  ['축소0.7', (i) => distortImage(i, { scale: 0.7, fill: FILL })],
];
// footprint 는 아직 FINDER_PATTERNS 에 없어 buildScene 이 못 그린다 → 합성으로 대체.
// 그 비대칭을 숨기지 않는다: 기존 후보는 렌더, footprint 는 합성이다.
console.log('  ⚠ footprint 는 생성기에 미등록이라 **합성 프레임**으로 쟀다.');
console.log('     기존 후보는 실제 렌더 경로다 — 조건이 완전히 같지 않다.\n');
console.log('  후보                              ' + POSES.map(([n]) => n.padEnd(9)).join(''));
for (const p of LINEUP) {
  const cells = [...FINDER_CELL_ORDER];
  const lv = p.cellLevels || p.cellMasks.map((m) => [1, 2, 4].map((bit) => (m & bit ? 2 : 0)));
  const out = [];
  for (const [, apply] of POSES) {
    let luma;
    if (p.id === 'oak-footprint' || p.cellLevels) {
      // 합성 → RGBA 변환이 없어 왜곡 하네스를 못 태운다. 참 자세만 유효.
      luma = synth(cells, lv);
      if (apply !== POSES[0][1]) { out.push('  —     '); continue; }
    } else {
      const enc = encode('sweep', { version: 2, eccLevel: 'M' });
      luma = toRelativeLuminance(apply(rasterize(
        buildScene(enc, { palette: PAL, finderPatternId: p.id }),
        { pixelsPerUnit: CELL_PX, supersample: 2 })));
    }
    const r = detectCellFinders(luma, LINEUP, { cellSizeSeeds: [CELL_PX] });
    const got = r.ok && r.candidates[0].hardChecksPassed ? r.candidates[0].patternId : null;
    out.push((got === p.id ? '  ok    ' : got ? ' ★' + got.slice(0, 6) : '  실패  ').padEnd(9));
  }
  console.log('  ' + p.id.padEnd(34) + out.join(''));
}
console.log('\n판독: ②의 «—» 는 미측정이다 (합성 프레임은 왜곡 하네스를 못 탄다).');
console.log('      footprint 를 같은 조건에서 재려면 **생성기 등록이 선결**이다.');
