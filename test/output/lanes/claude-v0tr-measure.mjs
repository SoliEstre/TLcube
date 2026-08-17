/**
 * claude-v0tr-measure.mjs — v0TR 계열 편입 **전** 계측 (브리프 §4-①).
 *
 * 이 스크립트는 설계 결정을 하지 않는다. 재는 것만 한다:
 *   ⓐ 정본 팩 자기검증 + 블록 분해 (유도 가능성 — 손 전사 0 을 목표로)
 *   ⓑ 코어 반경 — NE 블록 앵커까지의 반경을 `patchesFor(21,'v0t').corners[0].anchor`
 *      와 **같은 경로**로 만든다. 비교 대상 `V0W_CORE_RADIUS_CELLS = √279` ·
 *      `ANCHOR_SNAP_CELLS = 3.2`.
 *   ⓒ 방향 margin (해석) — 기존 회귀값으로 «자» 를 먼저 검증한 뒤 v0tr·v0trq 를 잰다.
 *   ⓓ autoplace 수용 · S_fmt · data · S · L/M/H · ⑤ 인코더 정합.
 *   ⓔ v0TRQ 코너 삼중점의 **정준(canonical) 성립성** — 세 면 앵커가 같은 반경 ·
 *      120° 간격인가. (합성 프레임 실측은 편입 뒤 §③ 에서 따로 한다 —
 *      렌더러가 레이아웃 id 를 알아야 프레임이 나오기 때문이다.)
 *
 * 기계 고정 절대경로 금지 — 정본 팩은 `import.meta.url` 기준 상대 탐침으로 찾는다.
 */
import { readFileSync, existsSync } from 'node:fs';
import { placeReservedCells, FORMAT_BLOCK_LENGTH_V2, minFormatSeparation } from '../../../src/autoplaceY.js';
import { maxBytesForSymbols } from '../../../src/capacity.js';
import { symbolCountForByteLength } from '../../../src/base211.js';
import { locatorCellsCellSurfaceFinal } from '../../../src/cellSurfaceFinal.js';
import { moduleCenter } from '../../../src/ygrid.js';
import { CS_BLOCK_LOCATOR_INTERNALS } from '../../../src/decoder/cellsurface-block-detect.js';

const N = 21;
const GATE_MARGIN = 0.035;
const ANCHOR_SNAP_CELLS = 3.2;
const V0W_CORE_RADIUS_CELLS = Math.sqrt(279);
const CANONICAL_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });

const PACK_REL = '.agent/decoder/data/cellsurface-v0trq-editor.json';
const PACK_PATHS = [
  new URL('../../../../' + PACK_REL, import.meta.url),
  new URL('../../../../TrilLuminanceCube/' + PACK_REL, import.meta.url),
];
const PACK_PATH = PACK_PATHS.find((path) => existsSync(path));
if (!PACK_PATH) throw new Error('정본 팩 없음: ' + PACK_PATHS.join(' | '));
const PACK = JSON.parse(readFileSync(PACK_PATH, 'utf8'));
const FINDER = PACK.cells.map(([i, j, T, L, R]) => ({ i, j, T, L, R }));

// ── ⓐ 정본 자기검증 + 블록 분해 ────────────────────────────────────────────
console.log('=== ⓐ 정본 팩 자기검증 (%s) ===', PACK.name);
const check = PACK._transcriptionCheck;
const midCells = FINDER.filter((c) => [c.T, c.L, c.R].includes(1));
const asymCells = FINDER.filter((c) => !(c.T === c.L && c.L === c.R));
const keys = new Set(FINDER.map((c) => c.i + ',' + c.j));
console.log('  파인더 셀 %d (팩 주장 %d) → %s',
  FINDER.length, check.finderCells, FINDER.length === check.finderCells ? 'ok' : '★불일치');
console.log('  중복 좌표 %d · 범위 밖 %d · mid 면 셀 %d (주장 %d) · 비대칭 %d (주장 %d)',
  FINDER.length - keys.size,
  FINDER.filter((c) => c.i < 0 || c.i >= N || c.j < 0 || c.j >= N).length,
  midCells.length, check.midCells, asymCells.length, check.asymmetricCells);
console.log('  슬롯: %s origin (%d,%d) · %d² = %d셀 (주장 %d) · 톤 override %d (주장 %d)',
  PACK.slot.role, PACK.slot.origin[0], PACK.slot.origin[1], PACK.slot.sizeCells,
  PACK.slot.sizeCells ** 2, PACK.slot.cells, 0, check.slotCellsWithTone);
console.log('  detector 주장 %d = 파인더 %d + 슬롯 %d → %s',
  PACK.counts.detector, check.finderCells, check.slotCells,
  PACK.counts.detector === check.finderCells + check.slotCells ? 'ok' : '★불일치');

// 블록 상자 — 두 동심 사각(바깥/안쪽)과 SE 마커.
const inOuter = (c) => c.i <= 5 && c.j >= 15;
const inInner = (c) => c.i >= 2 && c.i <= 7 && c.j >= 10 && c.j <= 15;
const inSe = (c) => c.i >= 18 && c.j >= 18;
const outer = FINDER.filter(inOuter);
const inner = FINDER.filter(inInner);
const se = FINDER.filter(inSe);
const overlap = FINDER.filter((c) => inOuter(c) && inInner(c));
const unclassified = FINDER.filter((c) => !inOuter(c) && !inInner(c) && !inSe(c));
console.log('\n  블록 분해: 바깥 동심사각 (0..5)×(15..20) %d · 안쪽 동심사각 (2..7)×(10..15) %d'
  + ' · SE (18..20)² %d · 겹침 %d · 미분류 %d',
  outer.length, inner.length, se.length, overlap.length, unclassified.length);
console.log('  합집합 %d = 바깥+안쪽+SE−겹침 = %d → %s',
  FINDER.length, outer.length + inner.length + se.length - overlap.length,
  FINDER.length === outer.length + inner.length + se.length - overlap.length ? 'ok' : '★불일치');

// 유도 가능성 — v0T 정본과의 대조 (같은 배열을 참조할 수 있는가).
const v0t = locatorCellsCellSurfaceFinal(N, 'v0t');
const v0tKey = new Map(v0t.map((c) => [c.i + ',' + c.j, c]));
function sameTones(a, b) { return a && b && a.T === b.T && a.L === b.L && a.R === b.R; }
const outerMatch = outer.filter((c) => sameTones(c, v0tKey.get(c.i + ',' + c.j)));
const seMatch = se.filter((c) => sameTones(c, v0tKey.get(c.i + ',' + c.j)));
// 안쪽 사각 = 바깥 사각의 평행이동인가 (i+2, j−5).
const outerKey = new Map(outer.map((c) => [c.i + ',' + c.j, c]));
const innerShift = inner.filter((c) => sameTones(c, outerKey.get((c.i - 2) + ',' + (c.j + 5))));
console.log('\n  v0T NE (0..5)×(15..20) 와 톤까지 일치: %d/%d → %s',
  outerMatch.length, outer.length, outerMatch.length === outer.length ? 'ok (V0XQ_CORNER_CELLS 참조 가능)' : '★부분');
console.log('  v0T SE (18..20)² 와 톤까지 일치: %d/%d → %s',
  seMatch.length, se.length, seMatch.length === se.length ? 'ok (V0W_PHASE_CELLS 참조 가능)' : '★부분');
console.log('  안쪽 사각 = 바깥 사각의 (i+2, j−5) 평행이동: %d/%d → %s',
  innerShift.length, inner.length, innerShift.length === inner.length ? 'ok (유도 가능)' : '★부분');
const centre16 = v0t.filter((c) => c.i <= 3 && c.j <= 3);
console.log('  v0T 중앙 (0..3)² = %d셀 (v0tr 이 그대로 참조)', centre16.length);

// ── ⓑ 코어 반경 ────────────────────────────────────────────────────────────
console.log('\n=== ⓑ 코어 반경 (셀) — 면 T 블록 무게중심까지 ===');
// `buildPatch` 와 같은 경로: 면 T 의 셀 중심 평균 (mid 면은 제외 — 여기엔 없다).
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
const v0tCornerAnchor = patchesFor(N, 'v0t').corners[0].anchor;
const v0tR = Math.hypot(v0tCornerAnchor.x, v0tCornerAnchor.y);
console.log('  자 검증 — patchesFor(21,"v0t").corners[0].anchor 반경 = %s (√279 = %s) → %s',
  v0tR.toFixed(4), V0W_CORE_RADIUS_CELLS.toFixed(4),
  Math.abs(v0tR - V0W_CORE_RADIUS_CELLS) < 1e-9 ? 'ok' : '★불일치');
const rUnion = anchorRadius([...outer, ...inner]);
const rOuter = anchorRadius(outer);
const rInner = anchorRadius(inner);
for (const [label, r] of [['NE 합집합 68셀', rUnion], ['바깥 사각 36셀', rOuter], ['안쪽 사각 36셀', rInner]]) {
  const delta = r - V0W_CORE_RADIUS_CELLS;
  console.log('  %s: r = %s · Δ(√279) = %s → %s',
    label.padEnd(14), r.toFixed(4), delta.toFixed(4),
    Math.abs(delta) > ANCHOR_SNAP_CELLS
      ? '|Δ| > 3.2 — 거리로 갈린다 (기존 패밀리와 시드 비용 무증가)'
      : '|Δ| ≤ 3.2 — 같은 쌍에서 refinePose 한 벌 더 (벤치 필요)');
}
console.log('  ※ 무게중심이 실제 «동심 사각 암코어 중심» 과 같은지: 바깥 (3,18) 안쪽 (5,13)');
console.log('     닫힌 형태 r² = a²+b²−ab → 바깥 %s · 안쪽 %s · 합집합 (4.0,15.5) %s',
  Math.sqrt(9 + 324 - 54).toFixed(4), Math.sqrt(25 + 169 - 65).toFixed(4),
  Math.sqrt(16 + 240.25 - 62).toFixed(4));
console.log('  ⚠ **이 표만 보고 «안쪽을 코너 앵커로» 를 고르면 안 된다.** 여기는 정준(canonical)');
console.log('     기하만 잰다. 실물 프레임에서 안쪽 코어는 엄격 코너(verifyV2r2Cluster)로');
console.log('     검증되지 않아 앵커드 경로가 아예 시드되지 않는다 — 실측은');
console.log('     `claude-v0tr-detect-debug.mjs` 다. 그래서 채택된 코너 앵커는 **바깥**이다.');

// ── ⓒ 방향 margin ──────────────────────────────────────────────────────────
console.log('\n=== ⓒ 방향 margin (게이트 %s) ===', GATE_MARGIN);
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
for (const [id, want] of [['v0t', 0.0962], ['v0ty', 0.0632], ['v0', 0.3111]]) {
  const n = id === 'v0' ? 13 : N;
  const m = marginAnalytic(locatorCellsCellSurfaceFinal(n, id));
  const ok = Math.abs(m.margin - want) < 0.0016;
  if (!ok) rulerOk = false;
  console.log('  자 검증 %s@%d = %s (회귀 %s) → %s', id, n, m.margin.toFixed(4), want, ok ? 'ok' : '★불일치');
}
if (!rulerOk) { console.log('\n★ 자가 안 맞는다 — 아래 수치 무효.'); process.exit(1); }

const V0TR_CELLS = [...centre16.map((c) => ({ i: c.i, j: c.j, T: c.T, L: c.L, R: c.R })), ...outer, ...inner.filter((c) => !inOuter(c)), ...se];
const V0TRQ_CELLS = [...outer, ...inner.filter((c) => !inOuter(c)), ...se];
const LAYOUTS = [
  { id: 'v0tr', cells: V0TR_CELLS, slot: 0 },
  { id: 'v0trq', cells: V0TRQ_CELLS, slot: 8 },
];
for (const layout of LAYOUTS) {
  const m = marginAnalytic(layout.cells);
  const asym = layout.cells.filter((c) => !(c.T === c.L && c.L === c.R)).length;
  console.log('  %s: margin %s (%d/%d · 비대칭 %d/%d) — 게이트의 %sx → %s',
    layout.id.padEnd(6), m.margin.toFixed(4), m.miss, m.obs, asym, layout.cells.length,
    (m.margin / GATE_MARGIN).toFixed(2),
    m.margin >= GATE_MARGIN ? '통과' : '★게이트 미달 (§6 탈출구)');
}
console.log('  ⚠ v0tr 에는 v0T 의 A 블록(L 반전 9셀)이 **없다** — 비대칭은 SE 6셀뿐이다.');
console.log('    v0T 의 «의도된 이중화 2개» 중 하나가 사라진 구조이고, 그것이 그대로 수치에 나온다.');

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
function slotCellList(m) {
  const out = [];
  for (let i = 0; i < m; i += 1) for (let j = 0; j < m; j += 1) out.push({ i, j });
  return out;
}
for (const layout of LAYOUTS) {
  const slot = slotCellList(layout.slot);
  const occupied = [...layout.cells.map((c) => ({ i: c.i, j: c.j })), ...slot];
  let placed;
  try {
    placed = placeReservedCells(N, occupied, { formatBlockLength: FORMAT_BLOCK_LENGTH_V2 });
  } catch (e) {
    console.log('  [%s] ★autoplace 거부: %s', layout.id, e.message);
    continue;
  }
  const data = N * N - layout.cells.length - slot.length
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
  // S_fmt — 포맷 3복제의 **최대 이격**(복제 중심 거리²). autoplace 가 게이트로 쓰는
  // 값이 이것이다 (`sFmtMax ≥ sFmtMinRequired`). 손으로 다시 유도하지 않고 정본이
  // 낸 metrics 를 그대로 읽는다.
  const sFmt = placed.metrics.sFmtMax;
  console.log('  [%s] 파인더 %d · 슬롯 %d · ref %d · format %d · data %d · S=%d · 잔여 %d',
    layout.id, layout.cells.length, slot.length, placed.referenceCells.length,
    placed.formatCells.length, data, S, data - S * 3);
  console.log('        detector(파인더+슬롯) = %d · payload L/M/H = %d/%d/%d B',
    layout.cells.length + slot.length, bytes.L, bytes.M, bytes.H);
  console.log('        S_fmt(복제 최대 이격², metrics.sFmtMax) = %s vs 하한 %d → %s'
    + ' (최소 이격² %s · dRef %s / 하한 %s)',
    sFmt, placed.metrics.sFmtMinRequired,
    sFmt >= placed.metrics.sFmtMinRequired ? 'ok' : '★미달',
    placed.metrics.sFmtMin, placed.metrics.dRef, placed.metrics.dRefMin);
  console.log('        ⑤ 인코더 정합 — %s → %s', enc.join(' '), encOk ? '통과' : '★거부 (§6 탈출구)');
}

// ── ⓔ v0TRQ 코너 삼중점 — 정준 성립성 ─────────────────────────────────────
console.log('\n=== ⓔ v0TRQ 코너 삼중점 (정준 기하) ===');
for (const [label, cells] of [['바깥 사각', outer], ['안쪽 사각', inner]]) {
  const anchors = ['T', 'L', 'R'].map((face) => {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const c of cells) {
      if (c[face] === 1) continue;
      const p = moduleCenter(face, c.i, c.j, CANONICAL_LAYOUT);
      sumX += p.x; sumY += p.y; count += 1;
    }
    return { x: sumX / count, y: sumY / count };
  });
  const radii = anchors.map((a) => Math.hypot(a.x, a.y));
  const angles = anchors.map((a) => (Math.atan2(a.y, a.x) * 180) / Math.PI);
  const sum = anchors.reduce((acc, a) => ({ x: acc.x + a.x, y: acc.y + a.y }), { x: 0, y: 0 });
  const sorted = [...angles].sort((l, r) => l - r);
  const gaps = [sorted[1] - sorted[0], sorted[2] - sorted[1], 360 - (sorted[2] - sorted[0])];
  console.log('  %s — 반경 T/L/R = %s · 각 = %s',
    label, radii.map((r) => r.toFixed(4)).join(' / '), angles.map((a) => a.toFixed(1)).join(' / '));
  console.log('    이웃 각차 = %s (120° 기대) · 세 앵커 합 = (%s, %s) (0 기대) → %s',
    gaps.map((g) => g.toFixed(1)).join(' / '), sum.x.toFixed(6), sum.y.toFixed(6),
    Math.max(...radii) - Math.min(...radii) < 1e-9 && gaps.every((g) => Math.abs(g - 120) < 1e-6)
      ? '삼중점 성립 (같은 반경 · 120° 등간격)' : '★불성립');
}
console.log('  ※ 세 면 동심 사각이 **둘씩** 있으므로 검출기 코너 후보는 면당 2개(총 6개)가 된다.');
console.log('    `detectCellSurfaceBlockShapes` 는 코너를 slice(0,4) 로 자른다 —');
console.log('    상위 4개가 두 반경으로 섞이면 유효 삼중점이 0 이 될 수 있다. 합성 실측 필요.');
