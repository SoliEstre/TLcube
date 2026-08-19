/**
 * claude-v0try-measure.mjs — v0TRY 편입 **전** 계측 (브리프 §4-①).
 *
 * v0TRY 는 유도다: `v0tr` 의 셀 집합에서 **먼 코너 슬롯 박스 [n−m, n−1]²** 를 필터로
 * 뺀 것 (n=21 · m = CENTER_QR_SLOT_CELLS_V0TY = 8 → 슬롯 [13,20]²).
 * v0TY 가 `V0T_CELLS.filter(...)` 인 것과 **문자 그대로 같은 꼴**이다.
 *
 * 이 스크립트는 설계 결정을 하지 않는다. 재는 것만 한다:
 *   ⓐ 슬롯이 무엇을 삼키는가 — 블록별 전수
 *   ⓑ 남은 방향 판별자 (비대칭 셀) — 0 이면 §6 탈출구
 *   ⓒ 방향 margin — 게이트 0.035 · v0tr·v0ty 와 나란히
 *   ⓓ autoplace 수용 · S_fmt · data · S · L/M/H payload · ⑤ 인코더 정합
 *   ⓔ 코어 반경 — `patchesFor(21,'v0tr').corners[0].anchor` 와 **같은 경로**
 *   (ⓕ 교차 수용 행렬은 레이아웃 등록이 필요하므로 편입 뒤
 *    `claude-v0try-crossmatrix.mjs` 에서 잰다 — 여기서는 불가능하다.)
 *
 * 기계 고정 절대경로 금지 — 모든 import 는 `import.meta.url` 기준 상대다.
 */
import { placeReservedCells, FORMAT_BLOCK_LENGTH_V2, minFormatSeparation } from '../../../src/autoplaceY.js';
import { maxBytesForSymbols } from '../../../src/capacity.js';
import { symbolCountForByteLength } from '../../../src/base211.js';
import {
  locatorCellsCellSurfaceFinal, CENTER_QR_SLOT_CELLS_V0TY,
  V0TR_BLOCKS, V0TY_BLOCKS,
} from '../../../src/cellSurfaceFinal.js';
import { moduleCenter } from '../../../src/ygrid.js';
import { CS_BLOCK_LOCATOR_INTERNALS } from '../../../src/decoder/cellsurface-block-detect.js';

const N = 21;
const GATE_MARGIN = 0.035;
const ANCHOR_SNAP_CELLS = 3.2;
const V0W_CORE_RADIUS_CELLS = Math.sqrt(279);
const CANONICAL_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });

// 슬롯 규약은 v0TY 와 **같은 상수**를 쓴다 (새 상수 신설 금지 — 브리프 §2).
const SLOT_CELLS = CENTER_QR_SLOT_CELLS_V0TY;
const SLOT_MIN = N - SLOT_CELLS;

const v0tr = locatorCellsCellSurfaceFinal(N, 'v0tr');
const v0ty = locatorCellsCellSurfaceFinal(N, 'v0ty');
const v0t = locatorCellsCellSurfaceFinal(N, 'v0t');
const v0trq = locatorCellsCellSurfaceFinal(N, 'v0trq');

const inSlot = (c) => c.i >= SLOT_MIN && c.j >= SLOT_MIN;
const v0try = v0tr.filter((c) => !inSlot(c));
const swallowed = v0tr.filter(inSlot);

// ── ⓐ 슬롯이 무엇을 삼키는가 ───────────────────────────────────────────────
console.log('=== ⓐ 슬롯 [%d,%d]² (m=%d, v0TY 와 같은 상수) 가 삼키는 v0TR 셀 ===',
  SLOT_MIN, N - 1, SLOT_CELLS);
console.log('  자 검증 — v0TY 슬롯 원점: iMin %d / jMin %d → %s',
  V0TY_BLOCKS.SLOT.iMin, V0TY_BLOCKS.SLOT.jMin,
  V0TY_BLOCKS.SLOT.iMin === SLOT_MIN && V0TY_BLOCKS.SLOT.jMin === SLOT_MIN ? 'ok (같은 상자)' : '★불일치');

const BLOCKS = [
  ['NW 중앙 (0..3)²', (c) => c.i <= V0TR_BLOCKS.NW.iMax && c.j <= V0TR_BLOCKS.NW.jMax],
  ['A (4..6)×(3..5)', (c) => c.i >= V0TR_BLOCKS.A.iMin && c.i <= V0TR_BLOCKS.A.iMax
    && c.j >= V0TR_BLOCKS.A.jMin && c.j <= V0TR_BLOCKS.A.jMax],
  ['NE 바깥 (0..5)×(15..20)', (c) => c.i <= V0TR_BLOCKS.NE_OUTER.iMax
    && c.j >= V0TR_BLOCKS.NE_OUTER.jMin],
  ['NE 안쪽 (2..7)×(10..15)', (c) => c.i >= V0TR_BLOCKS.NE_INNER.iMin
    && c.i <= V0TR_BLOCKS.NE_INNER.iMax && c.j >= V0TR_BLOCKS.NE_INNER.jMin
    && c.j <= V0TR_BLOCKS.NE_INNER.jMax],
  ['SE (18..20)²', (c) => c.i >= V0TR_BLOCKS.SE.iMin && c.j >= V0TR_BLOCKS.SE.jMin],
];
const asym = (c) => !(c.T === c.L && c.L === c.R);
console.log('\n  | 블록 | v0TR 셀 | 삼킴 | 남음 | 비대칭(전) | 비대칭(삼킴) |');
let sumCells = 0;
let sumEat = 0;
for (const [label, filter] of BLOCKS) {
  const all = v0tr.filter(filter);
  const eat = all.filter(inSlot);
  // 겹침(바깥∩안쪽 j=15 열)은 바깥에 귀속 — 합계는 아래에서 따로 검산한다.
  sumCells += all.length;
  sumEat += eat.length;
  console.log('  | %s | %d | %d | %d | %d | %d |', label.padEnd(23), all.length, eat.length,
    all.length - eat.length, all.filter(asym).length, eat.filter(asym).length);
}
console.log('  (블록 합 %d — v0TR 총 %d 과 차 %d = 바깥∩안쪽 겹침 중복 계수)',
  sumCells, v0tr.length, sumCells - v0tr.length);
console.log('\n  v0TR %d셀 → 삼킴 %d → **v0TRY %d셀** (예측 93 → %s)',
  v0tr.length, swallowed.length, v0try.length, v0try.length === 93 ? 'ok' : '★다르다');
console.log('  삼킨 셀 좌표: %s',
  swallowed.map((c) => '(' + c.i + ',' + c.j + ')').join(' '));
console.log('  삼킨 셀이 전부 SE 인가: %s',
  swallowed.every((c) => c.i >= V0TR_BLOCKS.SE.iMin && c.j >= V0TR_BLOCKS.SE.jMin) ? 'ok' : '★아니다');
// 슬롯 박스 안에 v0TRY 셀이 하나도 남지 않는가 (v0TY 자기검증과 같은 명제).
console.log('  슬롯 박스에 남은 v0TRY 셀: %d (0 기대)', v0try.filter(inSlot).length);

// ── ⓑ 남은 방향 판별자 ─────────────────────────────────────────────────────
console.log('\n=== ⓑ 남은 방향 판별자 (비대칭 셀) ===');
const asymBefore = v0tr.filter(asym);
const asymAfter = v0try.filter(asym);
const inA = BLOCKS[1][1];
const inSe = BLOCKS[4][1];
console.log('  v0TR 비대칭 %d = A %d + SE %d', asymBefore.length,
  asymBefore.filter(inA).length, asymBefore.filter(inSe).length);
console.log('  v0TRY 비대칭 **%d** = A %d + SE %d (예측 9 = A → %s)',
  asymAfter.length, asymAfter.filter(inA).length, asymAfter.filter(inSe).length,
  asymAfter.length === 9 && asymAfter.filter(inA).length === 9 ? 'ok' : '★다르다');
if (asymAfter.length === 0) {
  console.log('  ★★ 방향 판별자 0 — 브리프 §6 탈출구. 구현하지 말고 보고할 것.');
  process.exit(1);
}
// 반전 축 — A 는 L 반전(T=R≠L), SE 는 R 반전(T=L≠R) 이어야 한다.
const axisOf = (c) => (c.T === c.R && c.T !== c.L ? 'L반전'
  : (c.T === c.L && c.T !== c.R ? 'R반전' : (c.L === c.R && c.T !== c.L ? 'T반전' : '3면상이')));
const axes = {};
for (const c of asymAfter) { axes[axisOf(c)] = (axes[axisOf(c)] || 0) + 1; }
console.log('  v0TRY 비대칭 반전 축 분포: %s (A 블록이면 L반전 9 기대)', JSON.stringify(axes));
console.log('  v0TRY 비대칭 좌표: %s',
  asymAfter.map((c) => '(' + c.i + ',' + c.j + ')').join(' '));

// ── ⓒ 방향 margin ──────────────────────────────────────────────────────────
console.log('\n=== ⓒ 방향 margin (게이트 %s) ===', GATE_MARGIN);
console.log('  합성 사상 rotate120(q,r)=(−q−r,q) ∘ σ(T→R,R→L,L→T) 의 두 오방향 순환:');
function marginAnalytic(cells) {
  const cycles = [['L', 'R', 'T'], ['R', 'T', 'L']];
  let worst = Infinity;
  for (const cyc of cycles) {
    let miss = 0;
    for (const c of cells) {
      if (c[cyc[0]] !== c.T) miss += 1;
      if (c[cyc[1]] !== c.L) miss += 1;
      if (c[cyc[2]] !== c.R) miss += 1;
    }
    worst = Math.min(worst, miss);
  }
  return { margin: worst / (3 * cells.length), miss: worst, obs: 3 * cells.length };
}
let rulerOk = true;
for (const [id, want] of [['v0t', 0.0962], ['v0ty', 0.0632], ['v0tr', 0.0980],
  ['v0trq', 0.0519], ['v0', 0.3111]]) {
  const n = id === 'v0' ? 13 : N;
  const m = marginAnalytic(locatorCellsCellSurfaceFinal(n, id));
  const ok = Math.abs(m.margin - want) < 0.0016;
  if (!ok) rulerOk = false;
  console.log('  자 검증 %s@%d = %s (회귀 핀 %s) → %s',
    id.padEnd(5), n, m.margin.toFixed(4), want, ok ? 'ok' : '★불일치');
}
if (!rulerOk) { console.log('\n★ 자가 안 맞는다 — 아래 수치 무효.'); process.exit(1); }

console.log('\n  | id | margin | 내역 | 비대칭/셀 | 게이트 대비 |');
for (const [id, cells] of [['v0t', v0t], ['v0ty', v0ty], ['v0tr', v0tr],
  ['v0trq', v0trq], ['v0try', v0try]]) {
  const m = marginAnalytic(cells);
  console.log('  | %s | **%s** | %d/%d | %d/%d | **%s배** | %s',
    id.padEnd(5), m.margin.toFixed(4), m.miss, m.obs,
    cells.filter(asym).length, cells.length,
    (m.margin / GATE_MARGIN).toFixed(2),
    m.margin >= GATE_MARGIN ? '통과' : '★게이트 미달 (§6 탈출구)');
}

// ── ⓓ autoplace + 회계 + ⑤ 인코더 정합 ────────────────────────────────────
console.log('\n=== ⓓ autoplace · 회계 · ⑤ 인코더 정합 ===');
console.log('  minFormatSeparation(21) = %d', minFormatSeparation(N));
function nsymTable(S) {
  const L = Math.round(0.12 * S);
  let M = Math.round(0.25 * S);
  if (M % 2 === 0) M += 1;
  return { L, M, H: Math.round(0.40 * S) };
}
function packable(dataSymbols) {
  let b = maxBytesForSymbols(dataSymbols);
  while (b > 0 && symbolCountForByteLength(b) > dataSymbols) b -= 1;
  return b;
}
function slotBox(min, side) {
  const out = [];
  for (let i = 0; i < side; i += 1) for (let j = 0; j < side; j += 1) out.push({ i: min + i, j: min + j });
  return out;
}
const CASES = [
  { id: 'v0ty (대조)', cells: v0ty, slot: slotBox(SLOT_MIN, SLOT_CELLS) },
  { id: 'v0tr (대조)', cells: v0tr, slot: [] },
  { id: 'v0try', cells: v0try, slot: slotBox(SLOT_MIN, SLOT_CELLS) },
];
for (const layout of CASES) {
  const occupied = [...layout.cells.map((c) => ({ i: c.i, j: c.j })), ...layout.slot];
  let placed;
  try {
    placed = placeReservedCells(N, occupied, { formatBlockLength: FORMAT_BLOCK_LENGTH_V2 });
  } catch (e) {
    console.log('  [%s] ★autoplace 거부: %s', layout.id, e.message);
    continue;
  }
  const data = N * N - layout.cells.length - layout.slot.length
    - placed.referenceCells.length - placed.formatCells.length;
  const S = Math.floor(data / 3);
  const nsym = nsymTable(S);
  const enc = [];
  const bytes = {};
  let encOk = true;
  for (const lv of ['L', 'M', 'H']) {
    const budget = S - nsym[lv];
    const b = packable(budget);
    const need = symbolCountForByteLength(b);
    bytes[lv] = b;
    if (need !== budget) { encOk = false; enc.push(lv + ':★' + b + 'B->' + need + '/' + budget); }
    else enc.push(lv + ':ok(' + b + 'B)');
  }
  console.log('  [%s] 파인더 %d · 슬롯 %d · ref %d · format %d · data %d · S=%d · 잔여 %d',
    layout.id, layout.cells.length, layout.slot.length, placed.referenceCells.length,
    placed.formatCells.length, data, S, data - S * 3);
  console.log('        detector(파인더+슬롯) = %d · payload L/M/H = %d/%d/%d B',
    layout.cells.length + layout.slot.length, bytes.L, bytes.M, bytes.H);
  console.log('        S_fmt(metrics.sFmtMax) = %s vs 하한 %d → %s (최소 이격² %s · dRef %s / 하한 %s)',
    placed.metrics.sFmtMax, placed.metrics.sFmtMinRequired,
    placed.metrics.sFmtMax >= placed.metrics.sFmtMinRequired ? 'ok' : '★미달',
    placed.metrics.sFmtMin, placed.metrics.dRef, placed.metrics.dRefMin);
  console.log('        ⑤ 인코더 정합 — %s → %s', enc.join(' '), encOk ? '통과' : '★거부 (§6 탈출구)');
}

// ── ⓔ 코어 반경 ────────────────────────────────────────────────────────────
console.log('\n=== ⓔ 코어 반경 — v0tr 과 같아야 정상 (슬롯은 SE 쪽이지 NE 가 아니다) ===');
function anchorRadius(cells) {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const c of cells) {
    if (c.T === 1) continue;
    const point = moduleCenter('T', c.i, c.j, CANONICAL_LAYOUT);
    sumX += point.x;
    sumY += point.y;
    count += 1;
  }
  return Math.hypot(sumX / count, sumY / count);
}
const { patchesFor } = CS_BLOCK_LOCATOR_INTERNALS;
const trAnchor = patchesFor(N, 'v0tr').corners[0].anchor;
const trR = Math.hypot(trAnchor.x, trAnchor.y);
console.log('  자 검증 — patchesFor(21,"v0tr").corners[0].anchor 반경 = %s (√279 = %s) → %s',
  trR.toFixed(4), V0W_CORE_RADIUS_CELLS.toFixed(4),
  Math.abs(trR - V0W_CORE_RADIUS_CELLS) < 1e-9 ? 'ok' : '★불일치');
const inOuter = BLOCKS[2][1];
const rTr = anchorRadius(v0tr.filter(inOuter));
const rTry = anchorRadius(v0try.filter(inOuter));
console.log('  v0tr  NE 바깥 %d셀 → r = %s', v0tr.filter(inOuter).length, rTr.toFixed(4));
console.log('  v0try NE 바깥 %d셀 → r = %s · Δ(v0tr) = %s → %s',
  v0try.filter(inOuter).length, rTry.toFixed(4), (rTry - rTr).toFixed(6),
  Math.abs(rTry - rTr) < 1e-12 ? 'ok — 같다 (유도가 옳다)' : '★다르다 — 유도가 틀렸다');
console.log('  Δ(√279) = %s · ANCHOR_SNAP_CELLS %s → %s',
  (rTry - V0W_CORE_RADIUS_CELLS).toFixed(4), ANCHOR_SNAP_CELLS,
  Math.abs(rTry - V0W_CORE_RADIUS_CELLS) > ANCHOR_SNAP_CELLS
    ? '|Δ| > 3.2 — 거리로 갈린다' : '|Δ| ≤ 3.2 — 같은 쌍에서 refinePose 한 벌 더');
console.log('  ※ 편입 뒤 `patchesFor(21,"v0try").corners[0].anchor` 로 다시 검산한다 (§②).');

// ── 요약 ───────────────────────────────────────────────────────────────────
const mTry = marginAnalytic(v0try);
console.log('\n=== 요약 (통합자 예측 vs 실측) ===');
console.log('  | 항목 | 통합자 예측 | 이 레인 실측 | 일치 |');
console.log('  | 삼키는 셀 | 9 (SE 전부, 비대칭 6) | %d (비대칭 %d) | %s |',
  swallowed.length, swallowed.filter(asym).length,
  swallowed.length === 9 && swallowed.filter(asym).length === 6 ? 'ok' : '★');
console.log('  | 남는 비대칭 | 9 (= A) | %d (A %d) | %s |',
  asymAfter.length, asymAfter.filter(inA).length,
  asymAfter.length === 9 ? 'ok' : '★');
console.log('  | 셀 | 93 | %d | %s |', v0try.length, v0try.length === 93 ? 'ok' : '★');
console.log('  | margin | 0.0645 (1.84배) | %s (%s배) | %s |',
  mTry.margin.toFixed(4), (mTry.margin / GATE_MARGIN).toFixed(2),
  Math.abs(mTry.margin - 0.0645) < 0.0002 ? 'ok' : '★');
