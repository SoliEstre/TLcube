/**
 * claude-isolated-dot-census.mjs — 운영자 제안 「주변 둘레 8칸이 비워진 작은 점」이
 * 현행 파인더에 **실재하는가** 를 센다.
 *
 * 왜 이 셈이 먼저인가: 실재하면 «검출기 추가», 없으면 «설계 변경» 이다. 일의 종류가
 * 다르므로 처방 전에 센다.
 *
 * 앵커로 **쓸 수 있는** 점의 조건 (셋 다 필요):
 *   ① 8이웃이 전부 **파인더 셀**이어야 한다 — 하나라도 data 면 둘레가 페이로드에
 *      따라 변해 «비워짐» 이 보장되지 않는다.
 *   ② 중심과 8이웃의 톤이 갈려야 한다 (dark 점 × light 둘레, 또는 그 반대).
 *   ③ 3면 각각에서 성립해야 3-fold 링이 되어 시드 기하가 된다.
 *
 * 셀 좌표계는 로케이터 정본과 같은 (i, j) 이고, 이웃은 **격자 8이웃**
 * (i±1, j±1) 로 본다 — 마름모 면 격자의 «둘레» 다.
 *
 * 참고로 «반경 1 육각 링» (6이웃) 판정도 함께 낸다. 마름모 격자에서 어느 쪽이
 * 운영자가 말한 «둘레 8칸» 인지 확정되지 않았으므로 둘 다 세고 표시한다.
 */

import {
  locatorCellsCellSurfaceFinal,
} from '../../../src/cellSurfaceFinal.js';

const N = 21;
const FACES = ['T', 'L', 'R'];
const LAYOUTS = ['v0', 'v0t', 'v0ty'];
const NS = { v0: 13, v0t: 21, v0ty: 21 };

const NEIGHBOURS8 = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];
// 마름모(축좌표) 반경-1 육각 링 — (i±1,j), (i,j±1), (i+1,j−1), (i−1,j+1).
const NEIGHBOURS6 = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [1, -1], [-1, 1],
];

for (const layout of LAYOUTS) {
  const n = NS[layout];
  let cells;
  try {
    cells = locatorCellsCellSurfaceFinal(n, layout);
  } catch (error) {
    console.log(`${layout}: ★ 로케이터 셀을 못 얻었다 — ${error.message}`);
    continue;
  }
  // 로케이터 표의 모양을 먼저 찍는다 (추정 금지).
  if (!cells.length) { console.log(`${layout}: 셀 0`); continue; }
  const sample = cells[0];
  const keys = Object.keys(sample);
  const toneOf = {};
  const present = new Set();
  for (const cell of cells) {
    present.add(cell.i + ',' + cell.j);
    for (const face of FACES) {
      if (cell[face] !== undefined) toneOf[face + ':' + cell.i + ',' + cell.j] = cell[face];
    }
  }
  const haveTones = FACES.every((f) => sample[f] !== undefined);
  console.log(`\n══ ${layout} (n=${n}) — 로케이터 셀 ${cells.length}`
    + ` · 키 ${keys.join(',')}${haveTones ? '' : '  ★면 톤 키가 없다 — 아래 셈 무효'}`);
  if (!haveTones) continue;

  for (const [tag, NB] of [['8이웃', NEIGHBOURS8], ['육각6이웃', NEIGHBOURS6]]) {
    const hits = [];
    for (const cell of cells) {
      // ① 8(6)이웃이 전부 파인더 셀인가
      const surround = NB.map(([di, dj]) => ({ i: cell.i + di, j: cell.j + dj }));
      if (!surround.every((p) => present.has(p.i + ',' + p.j))) continue;
      // ②③ 세 면 전부에서 중심 ≠ 둘레 단일톤
      let good = true;
      const centreTones = [];
      for (const face of FACES) {
        const c = toneOf[face + ':' + cell.i + ',' + cell.j];
        const ring = surround.map((p) => toneOf[face + ':' + p.i + ',' + p.j]);
        if (c === undefined || ring.some((t) => t === undefined)) { good = false; break; }
        if (!ring.every((t) => t === ring[0])) { good = false; break; }
        if (c === ring[0]) { good = false; break; }
        centreTones.push(`${face}${c}/${ring[0]}`);
      }
      if (good) hits.push({ i: cell.i, j: cell.j, tones: centreTones.join(' ') });
    }
    console.log(`  ${tag}: 고립점 ${hits.length}개`
      + (hits.length ? ' — ' + hits.map((h) => `(${h.i},${h.j})[${h.tones}]`).join(' ') : ''));
  }
}

console.log('\n판독: 0개면 «검출기 추가» 가 아니라 **설계 변경**이 필요하다'
  + ' (운영자가 파인더에 고립점을 심어야 한다).');
