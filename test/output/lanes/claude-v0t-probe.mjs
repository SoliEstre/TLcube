/**
 * claude-v0t-probe.mjs — v0T 정본 검산 + 「정중앙 3셀 편입」 판단 실측.
 *
 * 운영자 질문: 정중앙 1셀 (i=0,j=0) × 3면 = 큐브 중심점 3셀을 dark 로 칠해 파인더에
 * 편입할 것인가, 그대로 데이터로 둘 것인가.
 *
 * 재는 것: ① 정본 자기검산 ② 방향 margin ③ 인코더 정합 ⑤ ④ 기존 라인업과의 판별력
 */
import { readFileSync, existsSync } from 'node:fs';
import { placeReservedCells, FORMAT_BLOCK_LENGTH_V2 } from '../../../src/autoplaceY.js';
import { maxBytesForSymbols } from '../../../src/capacity.js';
import { symbolCountForByteLength } from '../../../src/base211.js';
import { locatorCellsCellSurfaceFinal } from '../../../src/cellSurfaceFinal.js';

const N = 21;
// 정본 팩 경로 — **기계 고정 절대경로 금지** (통합자 규약 2026-08-17):
// import.meta.url 상대 + 두 배치 탐침 (중첩 `../.agent` · 형제 워크트리) 우선,
// 구 절대경로 둘은 폴백으로만 남긴다.
const PACK_REL = '.agent/decoder/data/cellsurface-v0t-editor.json';
const PACK_PATHS = [
  new URL('../../../../' + PACK_REL, import.meta.url),
  new URL('../../../../TrilLuminanceCube/' + PACK_REL, import.meta.url),
  'C:/Dev/TrilLuminanceCube/' + PACK_REL,
  'E:/WorkBase/TrilLuminanceCube/' + PACK_REL,
];
const PACK_PATH = PACK_PATHS.find((path) => existsSync(path));
if (!PACK_PATH) throw new Error('정본 팩을 어느 경로에서도 못 찾았다: ' + PACK_PATHS.join(' | '));
const PACK = JSON.parse(readFileSync(PACK_PATH, 'utf8'));

const base = PACK.cells.map(([i, j, T, L, R]) => ({ i, j, T, L, R }));

// ── ① 정본 자기검산 ────────────────────────────────────────────────────
console.log('=== ① 자기검산 ===');
console.log('  셀 수 %d (선언 detector %d) → %s',
  base.length, PACK.counts.detector,
  base.length === PACK.counts.detector ? 'ok' : '★불일치');
const keys = new Set(base.map((c) => c.i + ',' + c.j));
console.log('  중복 좌표: %s', keys.size === base.length ? '없음 — ok' : '★있음');
const oob = base.filter((c) => c.i < 0 || c.i >= N || c.j < 0 || c.j >= N);
console.log('  범위 밖: %s', oob.length === 0 ? '없음 — ok' : '★' + oob.length);
// (0,0) 3면 dark 편입은 **결정·반영 완료**다 (팩 resolvedDecision 2026-08-17) —
// 이 스크립트 최초 작성 시점에는 열린 결정이었다. 이제 «포함» 이 정상이다.
console.log('  (0,0) 포함 여부: %s (편입 확정 — 포함이 정상)',
  keys.has('0,0') ? '포함됨 — ok' : '★제외됨 (결정 미반영)');
const tones = new Set(base.flatMap((c) => [c.T, c.L, c.R]));
console.log('  등장 톤: {%s} (2톤 설계면 {0,2})', [...tones].sort().join(','));

// 구조 주장 검증 — R 은 SE 에서만, L 은 (4..6)×(3..5) 에서만 T 와 다른가.
const diffL = base.filter((c) => c.L !== c.T).map((c) => `${c.i},${c.j}`);
const diffR = base.filter((c) => c.R !== c.T).map((c) => `${c.i},${c.j}`);
const inBlockA = (s) => { const [i, j] = s.split(',').map(Number); return i >= 4 && i <= 6 && j >= 3 && j <= 5; };
const inBlockB = (s) => { const [i, j] = s.split(',').map(Number); return i >= 18 && j >= 18; };
console.log('  L≠T 셀 %d개, 전부 (4..6)×(3..5): %s', diffL.length,
  diffL.every(inBlockA) ? 'ok' : '★아님 → ' + diffL.filter((s) => !inBlockA(s)).join(' '));
console.log('  R≠T 셀 %d개, 전부 (18..20)²: %s', diffR.length,
  diffR.every(inBlockB) ? 'ok' : '★아님 → ' + diffR.filter((s) => !inBlockB(s)).join(' '));

// ── 자 검증: 기존 정본 margin 재현 ────────────────────────────────────
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
console.log('\n=== 자 검증 (기존 회귀값 재현) ===');
let rulerOk = true;
for (const [id, want] of [['v0w', 0.0952], ['v0w2', 0.1512], ['v0wq', 0.0889], ['v0wy', 0.0796]]) {
  let cells;
  try { cells = locatorCellsCellSurfaceFinal(N, id); } catch { console.log('  %s — 조회 불가(스킵)', id); continue; }
  const m = marginAnalytic(cells);
  const ok = Math.abs(m.margin - want) < 0.0016;
  if (!ok) rulerOk = false;
  console.log('  %s = %s (회귀 %s) → %s', id, m.margin.toFixed(4), want, ok ? 'ok' : '★불일치');
}
if (!rulerOk) { console.log('\n★ 자가 안 맞는다 — 아래 수치 무효.'); process.exit(1); }

// ── ②③ 두 후보 ────────────────────────────────────────────────────────
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

const CENTRE = [{ i: 0, j: 0, T: 0, L: 0, R: 0 }];
const CANDS = [
  { id: 'v0T (주어진 대로 — 중심 3셀 제외)', cells: base },
  { id: 'v0T+C (중심 3셀 dark 편입)', cells: [...base, ...CENTRE] },
];

console.log('\n=== ②③ 후보 비교 ===');
for (const cand of CANDS) {
  const occupied = cand.cells.map((c) => ({ i: c.i, j: c.j }));
  let placed;
  try {
    placed = placeReservedCells(N, occupied, { formatBlockLength: FORMAT_BLOCK_LENGTH_V2 });
  } catch (e) { console.log('\n[%s]\n  autoplace 거부: %s', cand.id, e.message); continue; }

  const data = N * N - cand.cells.length - placed.referenceCells.length - placed.formatCells.length;
  const S = Math.floor(data / 3);
  const nsym = nsymTable(S);
  const enc = [];
  let encOk = true;
  for (const lv of ['L', 'M', 'H']) {
    const budget = S - nsym[lv];
    const bytes = packable(budget);
    const need = symbolCountForByteLength(bytes);
    if (need !== budget) { encOk = false; enc.push(`${lv}:★${bytes}B->${need}/${budget}`); }
    else enc.push(`${lv}:ok(${bytes}B)`);
  }
  const m = marginAnalytic(cand.cells);
  const asym = cand.cells.filter((c) => !(c.T === c.L && c.L === c.R)).length;
  console.log('\n[%s]', cand.id);
  console.log('  파인더 %d · ref %d · format %d · data %d · S=%d · 잔여 %d',
    cand.cells.length, placed.referenceCells.length, placed.formatCells.length,
    data, S, data - S * 3);
  console.log('  인코더 정합 ⑤ — %s → %s', enc.join(' '), encOk ? 'ok' : '거부');
  console.log('  방향 margin %s (%d/%d · 비대칭 %d/%d) — 게이트 0.035 의 %sx',
    m.margin.toFixed(4), m.miss, m.obs, asym, cand.cells.length,
    (m.margin / 0.035).toFixed(2));
}

// ── ④ 기존 라인업과의 판별력 ──────────────────────────────────────────
console.log('\n=== ④ 기존 라인업과의 셀 수준 판별력 ===');
const mine = new Map(base.map((c) => [c.i + ',' + c.j, c]));
for (const id of ['v0w', 'v0w2', 'v0wq', 'v0wy', 'v0']) {
  let cells;
  try { cells = locatorCellsCellSurfaceFinal(id === 'v0' ? 13 : N, id); } catch { continue; }
  const theirs = new Map(cells.map((c) => [c.i + ',' + c.j, c]));
  const mineOnly = [...mine.keys()].filter((k) => !theirs.has(k)).length;
  const theirOnly = [...theirs.keys()].filter((k) => !mine.has(k)).length;
  const clash = [...mine.entries()].filter(([k, c]) => {
    const t = theirs.get(k);
    return t && !(t.T === c.T && t.L === c.L && t.R === c.R);
  }).length;
  console.log('  v0T vs %-5s — 내것만 %3d · 상대만 %3d · 겹치는데 톤 충돌 %3d',
    id, mineOnly, theirOnly, clash);
}
