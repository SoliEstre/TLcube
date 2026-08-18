/**
 * claude-daehan-k10-eval.mjs — 운영자 재설계본(k=10 사괘)을 구설계와 나란히 잰다.
 *
 * 재는 것:
 *  ① 발자국 회계 — 중앙 19 안 / 밖, 해상도별로 몇 셀이 살아남고 몇이 잘리나
 *  ② 120° 회전 겹침 — 구설계의 방향 손실 기전이 6/12 겹침이었다
 *  ③ 방향 여유 — 중앙 19만 vs 전체. 재설계가 손실을 고쳤나
 *  ④ 해상도별 용량 비용 (k=6/8/10 에서 데이터 셀을 몇 개 먹나)
 *
 * 전제 (운영자 확정 2026-08-18): 절대 좌표를 모든 해상도에서 그대로 쓰고,
 * 낮은 해상도에서 사괘 일부가 잘려 나가는 것을 허용한다.
 */
import { readFileSync } from 'node:fs';
import { FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
import { detectCellFinders } from '../../../src/decoder/cell-finder-detect.js';
import { rotate120, rotate240, roleOf, buildRoleSets } from '../../../src/placement.js';
import { hexDistance } from '../../../src/hexgrid.js';
import { facePolygon } from '../../../src/hexgrid.js';

const NEW = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const OLD = JSON.parse(readFileSync('../.agent/decoder/data/finder-daehan-editor.json', 'utf8'));

const innerSet = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));
const newCells = NEW.userNonData.map((c) => ({ q: c.q, r: c.r }));
const oldCells = OLD.cells.map((c) => ({ q: c[0], r: c[1] }));

function census(cells, label) {
  const inner = cells.filter((c) => innerSet.has(c.q + ',' + c.r));
  const outer = cells.filter((c) => !innerSet.has(c.q + ',' + c.r));
  const set = new Set(outer.map((c) => c.q + ',' + c.r));
  const ov120 = outer.map((c) => rotate120(c.q, c.r)).filter((c) => set.has(c.q + ',' + c.r)).length;
  const ov240 = outer.map((c) => rotate240(c.q, c.r)).filter((c) => set.has(c.q + ',' + c.r)).length;
  console.log(label.padEnd(12) + '총 ' + String(cells.length).padEnd(5)
    + '중앙19 ' + String(inner.length).padEnd(5) + '바깥 ' + String(outer.length).padEnd(5)
    + '120° 겹침 ' + ov120 + '/' + outer.length + ' · 240° ' + ov240 + '/' + outer.length);
  return { inner, outer };
}
console.log('=== ① 발자국 회계 ===');
const oldC = census(oldCells, '구설계 k6');
const newC = census(newCells, '재설계 k10');

console.log('\n=== ④ 해상도별 — 절대 좌표 유지, 반경 밖은 잘림 ===');
console.log('k    총셀   살아남는 파인더셀   그중 바깥(=데이터 잠식)   현행 role 이 data 인 것');
for (const k of [6, 8, 10]) {
  const sets = buildRoleSets(k);
  const alive = newCells.filter((c) => hexDistance(c.q, c.r) <= k);
  const aliveOuter = alive.filter((c) => !innerSet.has(c.q + ',' + c.r));
  const eatsData = aliveOuter.filter((c) => roleOf(c.q, c.r, k, sets) === 'data').length;
  const total = 3 * k * k + 3 * k + 1;
  console.log(String(k).padEnd(5) + String(total).padEnd(7) + String(alive.length).padEnd(20)
    + String(aliveOuter.length).padEnd(25) + eatsData);
}

// ── ③ 방향 여유 ────────────────────────────────────────────────────────────
const brightKey = new Map();
for (const t of NEW.toneOverrides) brightKey.set(t.face + ':' + t.q + ',' + t.r, t.tone);
const levelsFor = (cells) => cells.map((c) =>
  ['T', 'L', 'R'].map((f) => brightKey.has(f + ':' + c.q + ',' + c.r)
    ? brightKey.get(f + ':' + c.q + ',' + c.r) : 1));

const FRAME = 900, CELL_PX = 13, LEVEL_Y = [0, 0.5, 1];
function synth(cells, levels) {
  const data = new Float32Array(FRAME * FRAME).fill(0.5);
  const layout = { size: CELL_PX, originX: FRAME / 2, originY: FRAME / 2 };
  for (let i = 0; i < cells.length; i += 1) {
    for (let f = 0; f < 3; f += 1) {
      const poly = facePolygon(cells[i].q, cells[i].r, ['T', 'L', 'R'][f], layout);
      const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(FRAME-1, Math.ceil(Math.max(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(FRAME-1, Math.ceil(Math.max(...ys)));
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
        let hit = false;
        for (let a = 0, b = poly.length-1; a < poly.length; b = a++) {
          const p = poly[a], q2 = poly[b];
          if ((p.y > y+0.5) !== (q2.y > y+0.5)
            && x+0.5 < (q2.x-p.x)*(y+0.5-p.y)/(q2.y-p.y)+p.x) hit = !hit;
        }
        if (hit) data[y*FRAME+x] = LEVEL_Y[levels[i][f]];
      }
    }
  }
  return { width: FRAME, height: FRAME, data };
}
console.log('\n=== ③ 방향 여유 (게이트 0.035) ===');
console.log('조건                     셀수  correlation  orientationMargin');
for (const [label, cells] of [
  ['재설계 중앙19만', newC.inner],
  ['재설계 전체', newCells],
  ['재설계 k=6 잘림분', newCells.filter((c) => hexDistance(c.q, c.r) <= 6)],
]) {
  const levels = levelsFor(cells);
  const pattern = { id: 'p', renderKind: 'cell-mask', finderCells: cells, cellLevels: levels };
  const r = detectCellFinders(synth(cells, levels), [pattern],
    { centerSeeds: [{ x: FRAME/2, y: FRAME/2 }], cellSizeSeeds: [CELL_PX] });
  if (!r.ok) { console.log(label.padEnd(24) + String(cells.length).padEnd(6) + '검출 실패'); continue; }
  const b = r.candidates[0];
  console.log(label.padEnd(24) + String(cells.length).padEnd(6)
    + b.correlation.toFixed(4).padEnd(13) + b.orientationMargin.toFixed(4)
    + '  (' + (b.orientationMargin/0.035).toFixed(0) + '배)');
}
console.log('\n비교 — 구설계: 중앙19만 1.3370 · 전체31 1.1198 (바깥이 −0.217 깎았다)');
