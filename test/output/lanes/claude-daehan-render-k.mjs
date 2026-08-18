/**
 * claude-daehan-render-k.mjs — daehan 재설계본이 k=6/8/10 에서 어떻게 보이는지 SVG.
 *
 * 인코더가 daehan 을 아직 모르므로 buildScene 을 못 쓴다. facePolygon 으로 직접 그린다.
 * 데이터 셀은 회색으로 두고 파인더 셀만 실제 톤(0=검정 · 2=흰색)으로 칠해,
 * 「사괘가 어디까지 살아남는가」가 눈에 바로 들어오게 한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { facePolygon, hexDistance, regionCells } from '../../../src/hexgrid.js';
import { FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';

const D = JSON.parse(readFileSync('test/output/lanes/daehan-k10.json', 'utf8'));
const cells = D.userNonData.map((c) => ({ q: c.q, r: c.r }));
const tone = new Map(D.toneOverrides.map((t) => [t.face + ':' + t.q + ',' + t.r, t.tone]));
const innerSet = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));
const finderSet = new Set(cells.map((c) => c.q + ',' + c.r));
const TONE_FILL = ['#111', '#bcbcbc', '#fff'];

const SIZE = 15;
function svgFor(k) {
  const pad = 14;
  const all = regionCells(k);
  const pts = [];
  const parts = [];
  const layout = { size: SIZE, originX: 0, originY: 0 };
  // 데이터/기타 셀 — 옅은 회색
  for (const c of all) {
    if (finderSet.has(c.q + ',' + c.r)) continue;
    for (const face of ['T', 'L', 'R']) {
      const poly = facePolygon(c.q, c.r, face, layout);
      pts.push(...poly);
      parts.push('<polygon points="' + poly.map((p) => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ')
        + '" fill="#eef1f5" stroke="#d5dae2" stroke-width="0.4"/>');
    }
  }
  // 파인더 셀 — 실제 톤
  let alive = 0;
  for (const c of cells) {
    if (hexDistance(c.q, c.r) > k) continue;
    alive += 1;
    for (const face of ['T', 'L', 'R']) {
      const poly = facePolygon(c.q, c.r, face, layout);
      pts.push(...poly);
      const t = tone.get(face + ':' + c.q + ',' + c.r);
      parts.push('<polygon points="' + poly.map((p) => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ')
        + '" fill="' + TONE_FILL[t === undefined ? 1 : t] + '" stroke="#7a8595" stroke-width="0.5"/>');
    }
  }
  // 잘려 나간 파인더 셀 — 점선 윤곽만 (어디를 잃었는지 보이게)
  let cut = 0;
  for (const c of cells) {
    if (hexDistance(c.q, c.r) <= k) continue;
    cut += 1;
    for (const face of ['T', 'L', 'R']) {
      const poly = facePolygon(c.q, c.r, face, layout);
      pts.push(...poly);
      parts.push('<polygon points="' + poly.map((p) => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ')
        + '" fill="none" stroke="#d94f4f" stroke-width="0.7" stroke-dasharray="2 2"/>');
    }
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  return { body: parts.join(''), vb: [minX, minY, maxX - minX, maxY - minY], alive, cut,
    w: maxX - minX, h: maxY - minY };
}

const panels = [6, 8, 10].map((k) => ({ k, ...svgFor(k) }));
const gap = 30;
const H = Math.max(...panels.map((p) => p.h));
let x = 0; const chunks = []; const labels = [];
for (const p of panels) {
  chunks.push('<g transform="translate(' + (x - p.vb[0]) + ',' + (-p.vb[1] + (H - p.h) / 2) + ')">' + p.body + '</g>');
  labels.push('<text x="' + (x + p.w / 2) + '" y="' + (H + 22) + '" text-anchor="middle" '
    + 'font-family="system-ui,sans-serif" font-size="13" fill="#333">V'
    + (p.k === 6 ? 1 : p.k === 8 ? 2 : 3) + ' (k=' + p.k + ') — 파인더 ' + p.alive + '셀'
    + (p.cut ? ' · 잘림 ' + p.cut : ' · 전원') + '</text>');
  x += p.w + gap;
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + x + '" height="' + (H + 34)
  + '" viewBox="0 0 ' + x + ' ' + (H + 34) + '"><rect width="100%" height="100%" fill="#fff"/>'
  + chunks.join('') + labels.join('') + '</svg>';
writeFileSync(process.argv[2], svg);
console.log('그림 저장: ' + process.argv[2]);
for (const p of panels) console.log('  k=' + p.k + '  살아남음 ' + p.alive + ' · 잘림 ' + p.cut);
