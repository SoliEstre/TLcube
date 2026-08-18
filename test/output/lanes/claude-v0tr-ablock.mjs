/**
 * claude-v0tr-ablock.mjs — v0TR A 블록 편입 전/후 방향 margin.
 *
 * 운영자 지적 (2026-08-18): «v0TR 중앙 부분에 불스아이 주변 보조 파인더가 빠졌는데?
 * v0TRY 에도 들어가야 되니까 이거 넣는 걸 먼저 해야 할 듯.»
 *
 * 맞다 — 실측으로 v0TR 은 중앙 16 + NE 68 + SE 9 = 93셀이고 비대칭이 SE 6뿐이었다.
 * 그러면 v0TRY 는 먼 코너 슬롯이 SE 를 삼켜 **방향 판별자가 0** 이 된다.
 * v0TY 가 SE 를 잃고도 서는 이유가 정확히 A 블록의 L-반전 9셀이다.
 *
 * ⚠ 이 부재는 레인의 실수가 아니라 **내 브리프가 «보충 블록 신설 금지» 를 지시한
 * 결과**다. 레인은 규약을 지켰고 부재를 자기검증으로 정직하게 잠가 뒀다.
 * A 는 «신설» 이 아니라 v0T 정본의 행 참조 재사용이라 금지 규약과도 맞는다.
 *
 * 여기서 재는 것: 편입 후 각 레이아웃의 방향 margin (게이트 0.035) 과, v0TRY 가
 * 성립하는지의 선행 조건 — «먼 코너 슬롯 [13,20]² 밖에 비대칭이 남는가».
 */

import {
  locatorCellsCellSurfaceFinal, CENTER_QR_SLOT_CELLS_V0TY,
} from '../../../src/cellSurfaceFinal.js';

const N = 21;
const SLOT_MIN = N - CENTER_QR_SLOT_CELLS_V0TY; // 13

/** 방향 margin — 합성 사상(좌표 회전 ∘ 면 순환)의 두 비항등 상에서 최소 어긋남 비율. */
function marginOf(cells) {
  const cycles = [['L', 'R', 'T'], ['R', 'T', 'L']];
  let worst = Infinity;
  for (const c of cycles) {
    let miss = 0;
    for (const cell of cells) {
      if (cell[c[0]] !== cell.T) miss += 1;
      if (cell[c[1]] !== cell.L) miss += 1;
      if (cell[c[2]] !== cell.R) miss += 1;
    }
    worst = Math.min(worst, miss / (3 * cells.length));
  }
  return worst;
}

const rows = [];
for (const id of ['v0t', 'v0ty', 'v0tr', 'v0trq']) {
  const cells = locatorCellsCellSurfaceFinal(N, id);
  const asym = cells.filter((c) => !(c.T === c.L && c.L === c.R));
  rows.push({ id, cells: cells.length, asym: asym.length, margin: marginOf(cells) });
}

// v0TRY 예측 — v0TR 에서 먼 코너 슬롯 박스를 뺀 것.
const trCells = locatorCellsCellSurfaceFinal(N, 'v0tr');
const tryCells = trCells.filter((c) => !(c.i >= SLOT_MIN && c.j >= SLOT_MIN));
const tryAsym = tryCells.filter((c) => !(c.T === c.L && c.L === c.R));
rows.push({
  id: 'v0try(예측)', cells: tryCells.length, asym: tryAsym.length, margin: marginOf(tryCells),
});

console.log('레이아웃        셀    비대칭  margin    게이트 0.035 대비');
for (const r of rows) {
  console.log(`${r.id.padEnd(15)}${String(r.cells).padEnd(6)}${String(r.asym).padEnd(8)}`
    + `${r.margin.toFixed(4).padEnd(10)}${(r.margin / 0.035).toFixed(2)}배`
    + (r.margin < 0.035 ? '  ★미달' : ''));
}

console.log('\n=== v0TRY 성립 여부 ===');
console.log(`먼 코너 슬롯 [${SLOT_MIN},${N - 1}]² 이 삼킨 셀: ${trCells.length - tryCells.length}`);
const swallowed = trCells.filter((c) => c.i >= SLOT_MIN && c.j >= SLOT_MIN);
const swallowedAsym = swallowed.filter((c) => !(c.T === c.L && c.L === c.R));
console.log(`  그중 비대칭: ${swallowedAsym.length} (SE 마커)`);
console.log(`남은 비대칭: ${tryAsym.length} ${tryAsym.length > 0 ? '→ 방향 판별 가능 ✅' : '→ ★판별자 0 · v0TRY 불성립'}`);
if (tryAsym.length > 0) {
  const where = tryAsym.map((c) => `(${c.i},${c.j})`).join(' ');
  console.log(`  위치: ${where}  ← A 블록이어야 한다`);
}
