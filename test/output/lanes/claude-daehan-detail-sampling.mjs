/**
 * 가설 2 — 검출기의 **세부 표본(detailPoints)** 이 «발자국은 연속» 을 전제한다.
 *
 * observationsAt(detailed=true) 는 면마다 파행사변형의 0.10/0.90 지점 4개를 뜬다
 * (= 면의 **모서리 근처**). 발자국이 연속이면 이웃도 파인더라 값이 이어지지만,
 * daehan 처럼 셀이 **흩어져** 있으면 그 지점들이 이웃 «데이터 셀» 위에 떨어진다.
 * 실물에서도 그 이웃은 임의 톤의 데이터 셀이라, 이건 프로브 잡음이 아니라
 * **흩어진 발자국의 실제 성질**이다.
 *
 * 검정: 같은 자세에서 coarse(면 중심만) 와 detailed(모서리 4점) 를 나눠 잰다.
 * coarse 가 1.0 이고 detailed 만 낮으면 가설이 맞다.
 */
import { readFileSync } from 'node:fs';
import { scoreCellMaskAtHomography } from '../../../src/decoder/cell-finder-detect.js';
import { FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
import { facePolygon } from '../../../src/hexgrid.js';

const NEW = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const OLD = JSON.parse(readFileSync('../.agent/decoder/data/finder-daehan-editor.json', 'utf8'));
const innerSet = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));

const newCells = NEW.userNonData.map((c) => ({ q: c.q, r: c.r }));
const newTone = new Map(NEW.toneOverrides.map((t) => [t.face+':'+t.q+','+t.r, t.tone]));
const nl = (cells) => cells.map((c) => ['T','L','R'].map((f) =>
  newTone.has(f+':'+c.q+','+c.r) ? newTone.get(f+':'+c.q+','+c.r) : 1));
const oldCells = OLD.cells.map((c) => ({ q: c[0], r: c[1] }));
const oldMap = new Map(OLD.cells.map((c) => [c[0]+','+c[1], [c[2],c[3],c[4]]]));
const ol = (cells) => cells.map((c) => oldMap.get(c.q+','+c.r) || [1,1,1]);

const FRAME = 1200, CELL_PX = 20, LEVEL_Y = [0, 0.5, 1];
function paint(cells, levels) {
  const data = new Float32Array(FRAME*FRAME).fill(0.5);
  const layout = { size: CELL_PX, originX: FRAME/2, originY: FRAME/2 };
  for (let i=0;i<cells.length;i++) for (let f=0;f<3;f++) {
    const poly = facePolygon(cells[i].q, cells[i].r, ['T','L','R'][f], layout);
    const xs=poly.map(p=>p.x), ys=poly.map(p=>p.y);
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
// 참 자세 H: 셀 좌표계 → 화면. facePolygon 이 쓰는 layout 과 같은 사상.
const H = [CELL_PX, 0, FRAME/2, 0, CELL_PX, FRAME/2, 0, 0, 1];

console.log('후보                 셀수  연속?      coarse       detailed');
for (const [label, cells, levels, contiguous] of [
  ['구 중앙19',      [...FINDER_CELL_ORDER], ol([...FINDER_CELL_ORDER]), '연속'],
  ['구 전체31',      oldCells, ol(oldCells), '흩어짐'],
  ['재설계 중앙19',   newCells.filter(c=>innerSet.has(c.q+','+c.r)),
                     nl(newCells.filter(c=>innerSet.has(c.q+','+c.r))), '연속'],
  ['재설계 전체79',   newCells, nl(newCells), '흩어짐'],
]) {
  const luma = paint(cells, levels);
  const pat = { id: label, renderKind:'cell-mask', finderCells: cells, cellLevels: levels };
  const c1 = scoreCellMaskAtHomography(luma, [pat], H, { patternId: label, detailed: false });
  const c2 = scoreCellMaskAtHomography(luma, [pat], H, { patternId: label, detailed: true });
  const f = (r) => r.ok ? r.correlation.toFixed(4) : '실패';
  console.log(label.padEnd(20) + String(cells.length).padEnd(6) + contiguous.padEnd(11)
    + f(c1).padEnd(13) + f(c2));
}
console.log('\n판독: coarse 가 1.0 인데 detailed 만 낮으면, 원인은 면 모서리 4점이');
console.log('      이웃 «비파인더» 셀 위에 떨어지는 것이다 — 흩어진 발자국의 구조적 성질.');
