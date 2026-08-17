/**
 * claude-v0wy-design.mjs — v0WY 겹침 해소 3후보의 **설계 결정 실측**.
 *
 * 운영자 스펙: «윈도 β 식 안쪽 배치 (T 면 먼 코너 C0 에 묻힘)» + «QR 할당 영역 = 8×8 = 64셀».
 * 그런데 v0W 의 SE 위상 마커 (18..20)² 가 먼 코너 슬롯 [13,20]² 과 **겹친다**.
 *
 * 후보:
 *   (a) SE 마커를 슬롯에 내주고 위상 판별을 NW K3 비대칭에 의존   — 파인더 61
 *   (b) 슬롯을 안쪽으로 밀어 SE 마커를 살린다                     — 파인더 70
 *   (c) SE 마커를 SW 로 이전 (v0X SW = v0 SW 블록 (+8,0))         — 파인더 67
 *
 * 재는 것 (전부 src 무수정 · 순수 계산):
 *   ① 겹침 실재 여부 (후보 (b) 의 «한 칸 안쪽» 이 실제로 푸는가)
 *   ② 방향 margin (해석 — 2·A/(3·C), A = 면 비대칭 셀 수)
 *   ③ autoplace 수용 + 회계
 *   ④ **인코더 정합 ⑤** (자기검증 ⑤ 와 같은 자 — v0WQ 슬롯 8 을 정한 그 게이트)
 *   ⑤ 이상 표본기 교차 수용 (v0W·v0WQ·v0W2 와의 별칭 구조)
 *
 * 실행: node test/output/lanes/claude-v0wy-design.mjs
 */
import { placeReservedCells, FORMAT_BLOCK_LENGTH_V2 } from '../../../src/autoplaceY.js';
import { maxBytesForSymbols } from '../../../src/capacity.js';
import { symbolCountForByteLength } from '../../../src/base211.js';
import { locatorCellsCellSurfaceFinal } from '../../../src/cellSurfaceFinal.js';

const N = 21;
const SLOT = 8;

// ── 정본 블록을 «있는 그대로» 읽어 온다 (손 좌표 0) ──────────────────────
const v0wCells = locatorCellsCellSurfaceFinal(N, 'v0w');
const v0xqCells = locatorCellsCellSurfaceFinal(N, 'v0xq');
const v0w2Cells = locatorCellsCellSurfaceFinal(N, 'v0w2');
const v0wqCells = locatorCellsCellSurfaceFinal(N, 'v0wq');

const K3 = v0wCells.filter((c) => c.i <= 4 && c.j <= 4);
const NE = v0wCells.filter((c) => c.i <= 5 && c.j >= 15);
const SE9 = v0wCells.filter((c) => c.i >= 18 && c.j >= 18);
const SW6 = v0xqCells.filter((c) => c.i >= 18 && c.j <= 1);

console.log('블록 계수 — K3 %d · NE %d · SE(v0W) %d · SW(v0X) %d',
  K3.length, NE.length, SE9.length, SW6.length);

// v0X SW 가 정말 v0 SW 블록의 (+8,0) 평행이동인가 — 유도 계보 확인.
const v0Cells = locatorCellsCellSurfaceFinal(13, 'v0');
const v0Sw = v0Cells.filter((c) => c.i >= 10 && c.j <= 1);
const swDerived = v0Sw.every((c, k) => {
  const t = SW6[k];
  return t.i === c.i + 8 && t.j === c.j && t.T === c.T && t.L === c.L && t.R === c.R;
});
console.log('SW 계보 — v0 SW 3×2 (%d셀) → (+8,0) → v0X SW: %s',
  v0Sw.length, swDerived ? '완전 일치' : '★불일치');

function slotBox(iMin, jMin) {
  const cells = [];
  for (let i = iMin; i < iMin + SLOT; i += 1) {
    for (let j = jMin; j < jMin + SLOT; j += 1) cells.push({ i, j });
  }
  return cells;
}

const CANDIDATES = [
  { id: 'a', label: 'SE 포기 · 슬롯 먼 코너', finder: [...K3, ...NE], slot: slotBox(13, 13) },
  { id: 'b-lit', label: '브리프 문안 그대로 — 슬롯 [12,19]²', finder: [...K3, ...NE, ...SE9], slot: slotBox(12, 12) },
  { id: 'b-fix', label: 'SE 유지 · 슬롯 [10,17]² (겹침이 실제로 풀리는 최소 후퇴)', finder: [...K3, ...NE, ...SE9], slot: slotBox(10, 10) },
  { id: 'c', label: 'SE → SW 이전 · 슬롯 먼 코너', finder: [...K3, ...NE, ...SW6], slot: slotBox(13, 13) },
];

function nsymTable(symbols) {
  const L = Math.round(0.12 * symbols);
  let M = Math.round(0.25 * symbols);
  if (M % 2 === 0) M += 1;
  const H = Math.round(0.40 * symbols);
  return { symbols, L, M, H };
}
function packableBytesForSymbols(dataSymbols) {
  let bytes = maxBytesForSymbols(dataSymbols);
  while (bytes > 0 && symbolCountForByteLength(bytes) > dataSymbols) bytes -= 1;
  return bytes;
}

function asymmetry(cells) {
  return cells.filter((c) => !(c.T === c.L && c.L === c.R)).length;
}

// margin = 1 − max(오방향 일치율). 톤이 0/2 뿐이라 비대칭 셀은 «두 면 같고 하나 다름»
// 이고 순환 치환마다 정확히 2 관측이 어긋난다 → 2A/(3C). (v0w 20/210 · v0w2 44/291
// 로 기존 회귀와 대조 검산한다.)
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

// 자 검증 — 기존 정본에서 알려진 값이 나오는가.
for (const [id, cells, want] of [['v0w', v0wCells, 0.0952], ['v0w2', v0w2Cells, 0.1512],
  ['v0wq', v0wqCells, 0.0889], ['v0xq', v0xqCells, 0.0635]]) {
  const m = marginAnalytic(cells);
  const ok = Math.abs(m.margin - want) < 0.0016;
  console.log('자 검증 margin %s = %s (%d/%d) 회귀값 %s → %s',
    id, m.margin.toFixed(4), m.miss, m.obs, want, ok ? 'ok' : '★불일치');
}

console.log('\n=== 후보별 ===');
const results = [];
for (const cand of CANDIDATES) {
  const finderKeys = new Set(cand.finder.map((c) => c.i + ',' + c.j));
  const slotKeys = new Set(cand.slot.map((c) => c.i + ',' + c.j));
  const overlap = [...finderKeys].filter((k) => slotKeys.has(k));
  const row = {
    id: cand.id, label: cand.label,
    finder: cand.finder.length, slot: cand.slot.length,
    overlap: overlap.length, overlapCells: overlap,
  };
  // 슬롯이 먼 코너 C0 에 닿는가 (운영자 스펙 «T면 먼 코너 C0 에 묻힘»).
  row.farCorner = slotKeys.has((N - 1) + ',' + (N - 1));
  if (overlap.length > 0) {
    row.verdict = '겹침 ' + overlap.length + '셀 — 실격';
    results.push(row);
    continue;
  }
  const occupied = [...cand.finder.map((c) => ({ i: c.i, j: c.j })), ...cand.slot];
  let placed = null;
  try {
    placed = placeReservedCells(N, occupied, { formatBlockLength: FORMAT_BLOCK_LENGTH_V2 });
  } catch (error) {
    row.verdict = 'autoplace 거부: ' + error.message;
    results.push(row);
    continue;
  }
  const data = N * N - cand.finder.length - cand.slot.length
    - placed.referenceCells.length - placed.formatCells.length;
  const S = Math.floor(data / 3);
  const residual = data - S * 3;
  const nsym = nsymTable(S);
  const enc = [];
  let encOk = true;
  for (const level of ['L', 'M', 'H']) {
    const dataSymbols = S - nsym[level];
    const bytes = packableBytesForSymbols(dataSymbols);
    const need = symbolCountForByteLength(bytes);
    const ok = need === dataSymbols;
    if (!ok) encOk = false;
    enc.push(level + ':' + (ok ? 'ok' : '★' + bytes + 'B→' + need + '심볼 vs 예산 ' + dataSymbols));
  }
  Object.assign(row, {
    data, S, residual, nsym: [nsym.L, nsym.M, nsym.H].join('/'),
    enc: enc.join(' '), encOk,
    ...marginAnalytic(cand.finder),
    asym: asymmetry(cand.finder),
  });
  row.verdict = encOk ? 'ok' : '인코더 정합 ⑤ 거부';
  results.push(row);
}

for (const r of results) {
  console.log('\n[%s] %s', r.id, r.label);
  console.log('  파인더 %d · 슬롯 %d · 겹침 %d%s · 먼 코너 C0 %s',
    r.finder, r.slot, r.overlap, r.overlap ? ' (' + r.overlapCells.join(' ') + ')' : '',
    r.farCorner ? '닿음' : '★안 닿음');
  if (r.data !== undefined) {
    console.log('  data %d · S=%d · 잔여 %d · nsym %s', r.data, r.S, r.residual, r.nsym);
    console.log('  인코더 정합 ⑤ — %s', r.enc);
    console.log('  방향 margin %s (%d/%d · 비대칭 셀 %d/%d)',
      r.margin.toFixed(4), r.miss, r.obs, r.asym, r.finder);
  }
  console.log('  판정: %s', r.verdict);
}

// ── ⑤ 이상 표본기 교차 수용 구조 (부분집합 별칭) ──────────────────────────
console.log('\n=== 부분집합 별칭 구조 (이상 표본기 기전) ===');
const lineup = { v0w: v0wCells, v0wq: v0wqCells, v0w2: v0w2Cells };
for (const cand of CANDIDATES) {
  if (cand.id === 'b-lit') continue;
  const slotKeys = new Set(cand.slot.map((c) => c.i + ',' + c.j));
  const mine = new Map(cand.finder.map((c) => [c.i + ',' + c.j, c]));
  for (const [id, cells] of Object.entries(lineup)) {
    const theirs = new Map(cells.map((c) => [c.i + ',' + c.j, c]));
    // 방향 1: 상대 프레임을 v0WY 로 채점 — v0WY 파인더 셀 중 상대 파인더에 없는 것
    // (= 그 프레임에서 데이터/슬롯) 은 이상 표본기가 «관측 없음» 으로 버린다.
    const mineMissing = [...mine.keys()].filter((k) => !theirs.has(k));
    const mineConflict = [...mine.entries()].filter(([k, c]) => {
      const t = theirs.get(k);
      return t && !(t.T === c.T && t.L === c.L && t.R === c.R);
    });
    // 방향 2: v0WY 프레임을 상대로 채점.
    const theirMissing = [...theirs.keys()].filter((k) => !mine.has(k));
    const theirInSlot = theirMissing.filter((k) => slotKeys.has(k));
    console.log('%s vs %s — 내 셀 중 상대에 없음 %d (톤 충돌 %d) · 상대 셀 중 내게 없음 %d (그중 내 슬롯 %d)',
      cand.id, id, mineMissing.length, mineConflict.length, theirMissing.length, theirInSlot.length);
  }
}
