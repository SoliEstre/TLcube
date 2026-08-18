/**
 * claude-daehan-rot.mjs — 운영자 질문에 숫자로 답한다:
 *   «120° 회전일 때 오인식 여지가 있나? 중앙 셀로 분별 안 되나?»
 *
 * 재는 것은 **방향 여유(orientationMargin)** 다 = 정방향 상관 − 최고 오방향 상관.
 * 게이트는 0.035. 세 조건을 같은 자로 잰다:
 *   ⓐ daehan 전체 31셀
 *   ⓑ daehan 중앙 19셀만  ← 「중앙 셀로 분별 되나」의 답
 *   ⓒ daehan 바깥 12셀만  ← 바깥이 방향에 기여하는 몫
 *
 * 중요한 구분: 바깥 12셀이 «120° 불변이 아니다» 는 **역할 집합의 성질**이고,
 * 여기서 재는 것은 «패턴이 회전을 가르는 힘» 이다. 둘은 다른 명제다 —
 * 앵커는 불변이라 회전 전에 찾을 수 있어야 해서 불변이 필요하고,
 * 파인더는 자기가 회전을 정하므로 오히려 **비대칭할수록 유리하다.**
 */
import { readFileSync } from 'node:fs';
import { FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { facePolygon } from '../../../src/hexgrid.js';

const d = JSON.parse(readFileSync('../.agent/decoder/data/finder-daehan-editor.json', 'utf8'));
const orderSet = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));
const outerRaw = d.cells.filter((c) => !orderSet.has(c[0] + ',' + c[1]));
const byKey = new Map(d.cells.map((c) => [c[0] + ',' + c[1], c]));
const levelsFor = (cells) => cells.map((cell) => {
  const e = byKey.get(cell.q + ',' + cell.r);
  return e ? [e[2], e[3], e[4]] : [1, 1, 1];
});
const INNER = [...FINDER_CELL_ORDER];
const OUTER = outerRaw.map((c) => ({ q: c[0], r: c[1] }));
const FULL = [...INNER, ...OUTER];

const CELL_PX = 16, FRAME = 640, LEVEL_Y = [0, 0.5, 1];
function synth(cells, levels) {
  const data = new Float32Array(FRAME * FRAME).fill(0.5);
  const layout = { size: CELL_PX, originX: FRAME / 2, originY: FRAME / 2 };
  for (let i = 0; i < cells.length; i += 1) {
    for (let f = 0; f < 3; f += 1) {
      const poly = facePolygon(cells[i].q, cells[i].r, ['T', 'L', 'R'][f], layout);
      const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(FRAME - 1, Math.ceil(Math.max(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(FRAME - 1, Math.ceil(Math.max(...ys)));
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
        let hit = false;
        for (let a = 0, bIdx = poly.length - 1; a < poly.length; bIdx = a++) {
          const p = poly[a], q2 = poly[bIdx];
          if ((p.y > y + 0.5) !== (q2.y > y + 0.5)
            && x + 0.5 < (q2.x - p.x) * (y + 0.5 - p.y) / (q2.y - p.y) + p.x) hit = !hit;
        }
        if (hit) data[y * FRAME + x] = LEVEL_Y[levels[i][f]];
      }
    }
  }
  return { width: FRAME, height: FRAME, data };
}

console.log('조건            셀수  correlation  orientationMargin  게이트(0.035)');
for (const [label, cells] of [['ⓐ 전체 31셀', FULL], ['ⓑ 중앙 19만', INNER], ['ⓒ 바깥 12만', OUTER]]) {
  const levels = levelsFor(cells);
  const pattern = { id: 'probe', renderKind: 'cell-mask', finderCells: cells, cellLevels: levels };
  const luma = synth(cells, levels);
  const r = detectCellFinders(luma, [pattern], {
    centerSeeds: [{ x: FRAME / 2, y: FRAME / 2 }], cellSizeSeeds: [CELL_PX],
  });
  if (!r.ok) { console.log(label.padEnd(16) + String(cells.length).padEnd(6) + '검출 실패 ' + JSON.stringify(r.reason)); continue; }
  const b = r.candidates[0];
  console.log(label.padEnd(16) + String(cells.length).padEnd(6)
    + b.correlation.toFixed(4).padEnd(13) + b.orientationMargin.toFixed(4).padEnd(19)
    + (b.hardChecks.orientation ? '통과 (' + (b.orientationMargin / 0.035).toFixed(0) + '배)' : '★미달'));
}
console.log('\n판독:');
console.log('  ⓑ 가 게이트를 넉넉히 넘으면 «중앙 19만으로도 방향이 갈린다» 는 뜻이고,');
console.log('  바깥 12셀의 120° 비불변은 방향 오인식과 무관하다 (그건 역할 집합의 성질이지');
console.log('  패턴의 회전 변별력이 아니다).');
