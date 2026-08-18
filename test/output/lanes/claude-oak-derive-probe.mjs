import { readFileSync } from 'node:fs';
import { FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
const j = JSON.parse(readFileSync('../.agent/decoder/data/finder-oak-candidates.json', 'utf8'));
const d = JSON.parse(readFileSync('../.agent/decoder/data/finder-daehan-editor.json', 'utf8'));
const order = FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r);

console.log('후보          중앙19 면관측 57개 중 중간톤(1) 면 수   이진표현 가능?');
for (const c of j.candidates) {
  if (c.type !== 'O') continue;
  const t = { T: new Map(), L: new Map(), R: new Map() };
  for (const f of ['T','L','R']) for (const e of (c.toneOverrides[f] || [])) t[f].set(e[0]+','+e[1], e[2]);
  let mid = 0; const where = [];
  for (const k of order) for (const f of ['T','L','R']) {
    if (!t[f].has(k)) { mid += 1; where.push(k + ':' + f); }
  }
  console.log(String(c.name).padEnd(14) + String(mid).padEnd(38) + (mid === 0 ? '가능' : '★불가')
    + (mid ? '   ' + where.join(' ') : ''));
}
const byKey = new Map(d.cells.map((c) => [c[0]+','+c[1], c]));
let dmid = 0;
for (const k of order) { const e = byKey.get(k); if (!e) { dmid += 3; continue; }
  for (const i of [2,3,4]) if (e[i] === 1) dmid += 1; }
console.log('daehan(중앙19) ' + String(dmid).padEnd(38) + (dmid === 0 ? '가능' : '★불가')
  + '   — 단 전체 31셀 표면이라 중앙만 쓰면 다른 후보가 된다');
