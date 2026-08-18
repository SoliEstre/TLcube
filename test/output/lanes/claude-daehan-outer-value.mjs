/**
 * claude-daehan-outer-value.mjs — 운영자 되물음에 답한다:
 *   «바깥 12셀이 방향 탐지에 전혀 도움이 안 되나?»
 *
 * ⚠ 앞선 측정(claude-daehan-rot.mjs)은 **무노이즈 이상 프레임 하나**에서 방향 여유만
 *   쟀고, 거기서 전체 31셀(1.1699)이 중앙 19(1.3370)보다 낮게 나왔다. 그걸 근거로
 *   «기여하지 않는다» 고 말한 것은 **너무 넓은 주장**이었다. 바깥 링은 반경을 넓히니
 *   자세·스케일 추정에는 유리할 수 있고, 왜곡 아래선 순위가 뒤집힐 수 있다.
 *
 * 그래서 **왜곡 스윕**으로 다시 잰다. 두 후보를 같은 프레임·같은 조건에서 겨룬다:
 *   inner19 = daehan 중앙 19셀만 · full31 = daehan 전체
 * 재는 것: ⓐ 검출 성공 여부 ⓑ orientationMargin ⓒ correlation.
 * 각 조건에서 프레임은 **그 후보 자신의 도형**으로 만든다 (자기 프레임을 자기가 읽는다).
 */
import { readFileSync } from 'node:fs';
import { FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { facePolygon } from '../../../src/hexgrid.js';
import {
  rotateImage, perspectiveImage, scaleImage, cameraTiltImage,
  addGaussianNoise, applyGamma, barrelDistortImage, BARREL_PRESETS,
} from '../../harness/distort.mjs';

const d = JSON.parse(readFileSync('../.agent/decoder/data/finder-daehan-editor.json', 'utf8'));
const orderSet = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));
const byKey = new Map(d.cells.map((c) => [c[0] + ',' + c[1], c]));
const INNER = [...FINDER_CELL_ORDER];
const OUTER = d.cells.filter((c) => !orderSet.has(c[0] + ',' + c[1])).map((c) => ({ q: c[0], r: c[1] }));
const FULL = [...INNER, ...OUTER];
const levelsFor = (cells) => cells.map((cell) => {
  const e = byKey.get(cell.q + ',' + cell.r);
  return e ? [e[2], e[3], e[4]] : [1, 1, 1];
});

// ── RGBA 래스터 합성 (왜곡 하네스가 raster.js 계약을 받는다) ──────────────
const FRAME = 720, CELL_PX = 15;
const TONE_RGB = [0, 188, 255];   // level 0/1/2 → 무채색 8bit (BULLSEYE_MID = 188)
function rasterOf(cells, levels) {
  const data = new Uint8ClampedArray(FRAME * FRAME * 4);  // raster.js 계약: 필드명은 pixels
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i+1] = data[i+2] = 128; data[i+3] = 255; }
  const layout = { size: CELL_PX, originX: FRAME / 2, originY: FRAME / 2 };
  for (let i = 0; i < cells.length; i += 1) {
    for (let f = 0; f < 3; f += 1) {
      const poly = facePolygon(cells[i].q, cells[i].r, ['T', 'L', 'R'][f], layout);
      const v = TONE_RGB[levels[i][f]];
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
        if (hit) { const o = (y*FRAME+x)*4; data[o]=data[o+1]=data[o+2]=v; data[o+3]=255; }
      }
    }
  }
  return { width: FRAME, height: FRAME, pixels: data };
}

const CANDIDATES = [
  { key: 'inner19', cells: INNER },
  { key: 'full31', cells: FULL },
].map((c) => ({ ...c, levels: levelsFor(c.cells),
  pattern: { id: c.key, renderKind: 'cell-mask', finderCells: c.cells, cellLevels: levelsFor(c.cells) },
  raster: rasterOf(c.cells, levelsFor(c.cells)) }));

const FILL = { r: 128, g: 128, b: 128, a: 255 };
const CONDITIONS = [
  ['무왜곡',            (img) => img],
  ['회전 17°',          (img) => rotateImage(img, 17, { fill: FILL })],
  ['원근 20°',          (img) => perspectiveImage(img, 20, { fill: FILL })],
  ['원근 30°',          (img) => perspectiveImage(img, 30, { fill: FILL })],
  ['카메라 틸트 25°',   (img) => cameraTiltImage(img, 25, { fill: FILL })],
  ['축소 0.60×',        (img) => scaleImage(img, 0.60, { fill: FILL })],
  ['축소 0.50×',        (img) => scaleImage(img, 0.50, { fill: FILL })],
  // ⚠ sigma 는 **0..255 8비트 단위**다 (assertRange(sigma, 0, 255)). 처음에 0.06/0.12 를
  //   넣어 «노이즈 0» 을 노이즈라고 부르고 있었다.
  ['노이즈 σ=15/255',   (img) => addGaussianNoise(img, 15, { seed: 20260818 })],
  ['노이즈 σ=35/255',   (img) => addGaussianNoise(img, 35, { seed: 20260818 })],
  ['노이즈 σ=60/255',   (img) => addGaussianNoise(img, 60, { seed: 20260818 })],
  ['감마 0.7',          (img) => applyGamma(img, 0.7)],
  ['감마 1.6',          (img) => applyGamma(img, 1.6)],
  // ⚠ BARREL_PRESETS 의 키는 phoneWideMild/phoneWide/phoneWideStrong 이다.
  //   'wide' 는 없어서 undefined 를 spread 하고 왜곡이 안 걸리고 있었다.
  ['배럴 phoneWide',    (img) => barrelDistortImage(img, { strength: BARREL_PRESETS.phoneWide, fill: FILL })],
  ['배럴 강',           (img) => barrelDistortImage(img, { strength: BARREL_PRESETS.phoneWideStrong, fill: FILL })],
  ['원근30+σ35',        (img) => addGaussianNoise(perspectiveImage(img, 30, { fill: FILL }), 35, { seed: 7 })],
  ['틸트25+σ35',        (img) => addGaussianNoise(cameraTiltImage(img, 25, { fill: FILL }), 35, { seed: 7 })],
];

console.log('조건'.padEnd(20) + 'inner19 (19셀)'.padEnd(26) + 'full31 (31셀)'.padEnd(26) + '판정');
const tally = { inner: 0, full: 0, tie: 0 };
for (const [label, apply] of CONDITIONS) {
  const cells = [];
  for (const c of CANDIDATES) {
    let out;
    try {
      const luma = toRelativeLuminance(apply(c.raster));
      const r = detectCellFinders(luma, [c.pattern], { cellSizeSeeds: [CELL_PX, CELL_PX*0.85, CELL_PX*0.7, CELL_PX*0.6, CELL_PX*0.5, CELL_PX*0.4] });
      out = r.ok
        ? { ok: true, m: r.candidates[0].orientationMargin, corr: r.candidates[0].correlation,
            gate: r.candidates[0].hardChecks.orientation }
        : { ok: false };
    } catch (e) { out = { ok: false, err: String(e.message).slice(0, 24) }; }
    cells.push(out);
  }
  const [a, b] = cells;
  const fmt = (x) => x.ok
    ? ('m=' + x.m.toFixed(4) + ' c=' + x.corr.toFixed(3) + (x.gate ? '' : ' ✗게이트'))
    : ('검출실패' + (x.err ? ' ' + x.err : ''));
  let verdict;
  if (a.ok && !b.ok) { verdict = 'inner 승'; tally.inner += 1; }
  else if (!a.ok && b.ok) { verdict = 'full 승'; tally.full += 1; }
  else if (!a.ok && !b.ok) { verdict = '둘 다 실패'; }
  else if (Math.abs(a.m - b.m) < 0.02) { verdict = '무승부'; tally.tie += 1; }
  else if (a.m > b.m) { verdict = 'inner 승 (+' + (a.m - b.m).toFixed(3) + ')'; tally.inner += 1; }
  else { verdict = 'full 승 (+' + (b.m - a.m).toFixed(3) + ')'; tally.full += 1; }
  console.log(label.padEnd(20) + fmt(a).padEnd(26) + fmt(b).padEnd(26) + verdict);
}
console.log('\n집계 — inner19 우세 ' + tally.inner + ' · full31 우세 ' + tally.full + ' · 무승부 ' + tally.tie);
console.log('\n판독: full31 이 왜곡 조건에서 이기면 바깥 링은 «이상 프레임에서만 손해» 인 것이고,');
console.log('      inner19 이 전 조건에서 이기면 바깥 링의 값어치는 미학 쪽이다.');
