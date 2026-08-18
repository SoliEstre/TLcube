/**
 * 대조군 — 구설계를 **같은 프로브**(FRAME 900 · CELL_PX 13)로 재서
 * 「재설계가 나쁜 것」인지 「내 프로브가 큰 발자국을 못 다루는 것」인지 가른다.
 */
import { readFileSync } from 'node:fs';
import { FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { facePolygon, hexDistance } from '../../../src/hexgrid.js';

const NEW = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const OLD = JSON.parse(readFileSync('../.agent/decoder/data/finder-daehan-editor.json', 'utf8'));
const innerSet = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));

const oldCells = OLD.cells.map((c) => ({ q: c[0], r: c[1] }));
const oldLv = new Map(OLD.cells.map((c) => [c[0]+','+c[1], [c[2], c[3], c[4]]]));
const newCells = NEW.userNonData.map((c) => ({ q: c.q, r: c.r }));
const newTone = new Map(NEW.toneOverrides.map((t) => [t.face+':'+t.q+','+t.r, t.tone]));

const LEVEL_Y = [0, 0.5, 1];
function synth(cells, levels, FRAME, CELL_PX) {
  const data = new Float32Array(FRAME*FRAME).fill(0.5);
  const layout = { size: CELL_PX, originX: FRAME/2, originY: FRAME/2 };
  for (let i = 0; i < cells.length; i += 1) for (let f = 0; f < 3; f += 1) {
    const poly = facePolygon(cells[i].q, cells[i].r, ['T','L','R'][f], layout);
    const xs = poly.map(p=>p.x), ys = poly.map(p=>p.y);
    const x0=Math.max(0,Math.floor(Math.min(...xs))), x1=Math.min(FRAME-1,Math.ceil(Math.max(...xs)));
    const y0=Math.max(0,Math.floor(Math.min(...ys))), y1=Math.min(FRAME-1,Math.ceil(Math.max(...ys)));
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
      let hit=false;
      for (let a=0,b=poly.length-1;a<poly.length;b=a++) {
        const p=poly[a], q2=poly[b];
        if ((p.y>y+0.5)!==(q2.y>y+0.5) && x+0.5<(q2.x-p.x)*(y+0.5-p.y)/(q2.y-p.y)+p.x) hit=!hit;
      }
      if (hit) data[y*FRAME+x]=LEVEL_Y[levels[i][f]];
    }
  }
  return { width: FRAME, height: FRAME, data };
}
function probe(label, cells, levels, FRAME, CELL_PX, seeds) {
  const pattern = { id:'p', renderKind:'cell-mask', finderCells: cells, cellLevels: levels };
  const r = detectCellFinders(synth(cells, levels, FRAME, CELL_PX), [pattern],
    { centerSeeds: [{ x: FRAME/2, y: FRAME/2 }], cellSizeSeeds: seeds || [CELL_PX] });
  const out = r.ok
    ? r.candidates[0].correlation.toFixed(4) + '  m=' + r.candidates[0].orientationMargin.toFixed(4)
    : '검출 실패 ' + String(r.reason);
  console.log(label.padEnd(34) + 'F' + FRAME + '/c' + CELL_PX + '  ' + out);
}
const oldL = (cells) => cells.map(c => oldLv.get(c.q+','+c.r) || [1,1,1]);
const newL = (cells) => cells.map(c => ['T','L','R'].map(f =>
  newTone.has(f+':'+c.q+','+c.r) ? newTone.get(f+':'+c.q+','+c.r) : 1));

console.log('=== 대조군: 같은 프로브로 구설계 ===');
probe('구 중앙19  (원래 1.3370)', [...FINDER_CELL_ORDER], oldL([...FINDER_CELL_ORDER]), 900, 13);
probe('구 전체31  (원래 1.1198)', oldCells, oldL(oldCells), 900, 13);
console.log('\n=== 원래 프로브 크기로 되돌리면 ===');
probe('구 중앙19', [...FINDER_CELL_ORDER], oldL([...FINDER_CELL_ORDER]), 640, 16);
probe('구 전체31', oldCells, oldL(oldCells), 640, 16);

console.log('\n=== 재설계 — 프레임/셀크기·시드를 바꿔 가며 ===');
const newInner = newCells.filter(c => innerSet.has(c.q+','+c.r));
for (const [F, C] of [[900,13],[900,20],[1200,20],[1400,26]]) {
  probe('재설계 전체79', newCells, newL(newCells), F, C, [C, C*0.8, C*1.25]);
}
probe('재설계 중앙19만', newInner, newL(newInner), 640, 16);
console.log('\n재설계 중앙19 톤이 구설계와 같은가:',
  JSON.stringify(newL(newInner)) === JSON.stringify(oldL(newInner)) ? '같다' : '★다르다');
