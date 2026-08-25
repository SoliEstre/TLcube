/**
 * M1 계측 ① — 앵커 반경을 **정본에서 유도**했을 때 손 닫힌형과 같은가.
 *
 * `V0T_CORE_RADIUS_CELLS` 등은 √279 · 18 을 손으로 적어 뒀다. NS 유도로 바꾸려면
 * 먼저 «유도값이 손값과 같은 비트인가» 를 재야 한다 — 다르면 스냅 경계가 ULP만큼
 * 움직여 «바이트 동일» 주장을 못 한다.
 */
import { CS_BLOCK_LOCATOR_INTERNALS } from '../../../src/decoder/cellsurface-block-detect.js';
import { CELL_SURFACE_FINAL_NS } from '../../../src/cellSurfaceFinal.js';

const { patchesFor } = CS_BLOCK_LOCATOR_INTERNALS;
const closed = {
  v1r2: 18,
  v0x: 18,
  v0w: Math.sqrt(279),
  v0w2: Math.sqrt(279),
  v0wy: Math.sqrt(279),
  v0t: Math.sqrt(279),
  v0ty: Math.sqrt(279),
  v0xq: Math.sqrt(279),
};
const ids = ['v1r2', 'v0x', 'v0xq', 'v0w', 'v0wq', 'v0w2', 'v0wy', 'v0t', 'v0ty', 'v0tr', 'v0trq', 'v0try'];
for (const id of ids) {
  const ns = CELL_SURFACE_FINAL_NS[id] || [];
  for (const n of ns) {
    let anchor = null;
    let err = null;
    try {
      anchor = patchesFor(n, id).corners[0].anchor;
    } catch (e) { err = e.message; }
    if (err) { console.log(id + '@' + n + ' THROW ' + err); continue; }
    const r = Math.hypot(anchor.x, anchor.y);
    const c = closed[id];
    const eq = c === undefined ? 'n/a' : (r === c ? 'EXACT' : 'delta=' + (r - c).toExponential(3));
    console.log(id + '@' + n + ': anchor=(' + anchor.x + ',' + anchor.y + ') r='
      + r.toFixed(12) + ' closed=' + (c === undefined ? '-' : c) + ' ' + eq);
  }
}
// NS 밖 질의는 throw 해야 정상 (= 유도가 필요한 이유).
for (const id of ['v0ty', 'v0trq', 'v0try']) {
  try {
    patchesFor(25, id);
    console.log(id + '@25: BUILT (NS 밖인데 만들어짐)');
  } catch (e) { console.log(id + '@25: throw — ' + e.message); }
}
