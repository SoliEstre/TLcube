/**
 * 가설 검정 — 재설계의 correlation 0.606 이 «설계가 나빠서» 인가
 * «탐색 기하가 반경 2용으로 잡혀 있어서» 인가.
 *
 * 가장 싼 실험: varianceWindowRadiusCells 를 넓혀 보고 correlation 이 1.0 으로
 * 올라가면 원인은 보정값이다. 안 올라가면 설계 쪽이다.
 * ⚠ 이건 게이트 완화가 아니다 — minCorrelation·minOrientationMargin 은 안 건드린다.
 */
import { readFileSync } from 'node:fs';
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { facePolygon } from '../../../src/hexgrid.js';

const NEW = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const cells = NEW.userNonData.map((c) => ({ q: c.q, r: c.r }));
const tone = new Map(NEW.toneOverrides.map((t) => [t.face+':'+t.q+','+t.r, t.tone]));
const levels = cells.map((c) => ['T','L','R'].map((f) =>
  tone.has(f+':'+c.q+','+c.r) ? tone.get(f+':'+c.q+','+c.r) : 1));

const FRAME = 1200, CELL_PX = 20, LEVEL_Y = [0, 0.5, 1];
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
const luma = { width: FRAME, height: FRAME, data };
const pattern = { id:'daehan79', renderKind:'cell-mask', finderCells: cells, cellLevels: levels };

console.log('varianceWindowRadiusCells  correlation  orientationMargin  게이트');
for (const rad of [4.1, 6, 8, 11, 14, 18]) {
  const r = detectCellFinders(luma, [pattern], {
    centerSeeds: [{ x: FRAME/2, y: FRAME/2 }], cellSizeSeeds: [CELL_PX],
    calibration: { varianceWindowRadiusCells: rad },
  });
  const out = r.ok
    ? r.candidates[0].correlation.toFixed(4).padEnd(13)
      + r.candidates[0].orientationMargin.toFixed(4).padEnd(19)
      + (r.candidates[0].hardChecksPassed ? '통과' : '★' + JSON.stringify(r.candidates[0].hardChecks))
    : '검출 실패';
  console.log(String(rad).padEnd(27) + out);
}
console.log('\n판독: 창을 넓혀 correlation 이 1.0 으로 가면 원인은 «탐색 기하가 반경 2용» 이다.');
console.log('      안 올라가면 설계 자체가 자기 프레임과 안 맞는다는 뜻이라 전사부터 의심해야 한다.');
