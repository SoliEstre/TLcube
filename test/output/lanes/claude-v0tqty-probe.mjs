/**
 * claude-v0tqty-probe.mjs — v0TQ(중앙 슬롯)·v0TY(먼 코너 슬롯) 회계 실측.
 *
 * 운영자 확정 (2026-08-17): 두 변형의 비대칭 이중화는 **의도된 설계**다 —
 * 슬롯이 어느 쪽 비대칭 블록을 삼켜도 나머지 하나가 방향을 준다. 이 스크립트는
 * «설계 결정» 을 하지 않는다. 재는 것만 한다:
 *   ① 슬롯 크기 m 스윕 — autoplace 수용 상한 (m=4..11)
 *   ② m=8 (운영자 스펙 — v0WQ·v0WY 와 동일) 의 회계: 파인더 · data · S · 잔여
 *   ③ 인코더 정합 ⑤ — L/M/H 전부. **⑤ 거부만이 m 조정 사유다** (v0WQ 9→8 전례).
 *   ④ 방향 margin (해석적) — 표에 적되 판정 근거로 쓰지 않는다 (브리프: 현행
 *      margin 자는 QR 파인더 패턴이 주는 방향 정보를 못 세므로 이 두 변형을
 *      과소평가한다 — «낮으니 보강» 결론 금지, 운영자 기각).
 *
 * 셀 집합은 정본 팩(JSON)에서 직접 유도한다 — 모듈 편입 전에 돌 수 있어야
 * ⑤ 판정이 슬롯 상수를 확정한 **뒤에** 모듈을 쓰기 때문이다.
 */
import { readFileSync, existsSync } from 'node:fs';
import { placeReservedCells, FORMAT_BLOCK_LENGTH_V2 } from '../../../src/autoplaceY.js';
import { maxBytesForSymbols } from '../../../src/capacity.js';
import { symbolCountForByteLength } from '../../../src/base211.js';
import { centerQrQuietFrameCells, centerQrModulePitchCells } from '../../../src/cellSurfaceFinal.js';

const N = 21;
// 기계 고정 절대경로 금지 (통합자 규약 2026-08-17) — 상대 탐침 우선, 절대경로는 폴백.
const PACK_REL = '.agent/decoder/data/cellsurface-v0t-editor.json';
const PACK_PATHS = [
  new URL('../../../../' + PACK_REL, import.meta.url),
  new URL('../../../../TrilLuminanceCube/' + PACK_REL, import.meta.url),
  'C:/Dev/TrilLuminanceCube/' + PACK_REL,
  'E:/WorkBase/TrilLuminanceCube/' + PACK_REL,
];
const PACK_PATH = PACK_PATHS.find((path) => existsSync(path));
if (!PACK_PATH) throw new Error('정본 팩 없음: ' + PACK_PATHS.join(' | '));
const PACK = JSON.parse(readFileSync(PACK_PATH, 'utf8'));
const V0T = PACK.cells.map(([i, j, T, L, R]) => ({ i, j, T, L, R }));
if (V0T.length !== 104) throw new Error('팩이 104셀이 아니다: ' + V0T.length);

function slotCells(origin, m) {
  const out = [];
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < m; j += 1) out.push({ i: origin.i + i, j: origin.j + j });
  }
  return out;
}
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

const VARIANTS = [
  {
    id: 'v0TQ', slotName: '중앙 [0,m−1]²', originFor: () => ({ i: 0, j: 0 }),
    // 슬롯이 삼키는 블록: NW (0..3)² 16 + A (4..6)×(3..5) 9 = 25 (m=8 기준).
    eaten: (c, m) => c.i <= m - 1 && c.j <= m - 1,
    remainAsym: 'SE (18..20)² — R 반전 6셀',
  },
  {
    id: 'v0TY', slotName: '먼 코너 [n−m,n−1]²', originFor: (m) => ({ i: N - m, j: N - m }),
    // 슬롯이 삼키는 블록: SE (18..20)² 9 (m=8 기준).
    eaten: (c, m) => c.i >= N - m && c.j >= N - m,
    remainAsym: 'A (4..6)×(3..5) — L 반전 9셀',
  },
];

for (const variant of VARIANTS) {
  console.log('=== ' + variant.id + ' (' + variant.slotName + ') ===');
  // ① m 스윕 — autoplace 수용 상한 (거부는 사유까지 기록한다).
  const accepted = [];
  for (let m = 4; m <= 11; m += 1) {
    const origin = variant.originFor(m);
    const finder = V0T.filter((c) => !variant.eaten(c, m));
    const slot = slotCells(origin, m);
    const occupied = [...finder.map((c) => ({ i: c.i, j: c.j })), ...slot];
    try {
      placeReservedCells(N, occupied, { formatBlockLength: FORMAT_BLOCK_LENGTH_V2 });
      accepted.push(m);
      console.log('  ① m=' + m + ' 수용 (파인더 ' + finder.length + ')');
    } catch (e) {
      console.log('  ① m=' + m + ' 거부 — ' + e.message);
    }
  }
  console.log('  ① 요약: 수용 m = [' + accepted.join(', ') + '] → 상한 '
    + (accepted.length > 0 ? Math.max(...accepted) : '없음'));

  // ①-b 콰이어트 프레임 회계 — 슬롯 QR 확증 게이트(`centreQrFinderContrast`)는
  // 콰이어트 표본 ≥ 6 을 요구한다 (**손대지 않는 게이트** — 표본 미달 = null = 거절).
  // 콰이어트 프레임 셀 수는 정본 함수로 잰다 (재유도 금지).
  for (let m = 4; m <= 9; m += 1) {
    const quiet = centerQrQuietFrameCells(m).length;
    console.log('  ①-b m=' + m + ': 콰이어트 프레임 ' + quiet + '셀 · QR 모듈 피치 '
      + centerQrModulePitchCells(m).toFixed(4) + '셀 → 확증 게이트(콰이어트 ≥ 6): '
      + (quiet >= 6 ? '표본 충분' : '★구조적 거절 (표본 ' + quiet + ' < 6)'));
  }

  // ②③④ — m=8 (운영자 스펙: v0WQ·v0WY 와 동일 크기) + autoplace 가 수용한 m 전부.
  for (const m of [...new Set([...accepted, 8])].sort((a, b) => a - b)) {
    const origin = variant.originFor(m);
    const finder = V0T.filter((c) => !variant.eaten(c, m));
    const slot = slotCells(origin, m);
    const eatenCount = V0T.length - finder.length;
    const occupied = [...finder.map((c) => ({ i: c.i, j: c.j })), ...slot];
    let placed;
    try {
      placed = placeReservedCells(N, occupied, { formatBlockLength: FORMAT_BLOCK_LENGTH_V2 });
    } catch (e) {
      console.log('  ② m=' + m + ' autoplace 거부: ' + e.message);
      continue;
    }
    const data = N * N - finder.length - slot.length
      - placed.referenceCells.length - placed.formatCells.length;
    const S = Math.floor(data / 3);
    const nsym = nsymTable(S);
    const enc = [];
    let encOk = true;
    for (const lv of ['L', 'M', 'H']) {
      const budget = S - nsym[lv];
      const bytes = packable(budget);
      const need = symbolCountForByteLength(bytes);
      if (need !== budget) { encOk = false; enc.push(lv + ':★' + bytes + 'B->' + need + '/' + budget); }
      else enc.push(lv + ':ok(' + bytes + 'B)');
    }
    const mg = marginAnalytic(finder);
    const asym = finder.filter((c) => !(c.T === c.L && c.L === c.R)).length;
    console.log('  ② m=' + m + ' 회계: 파인더 ' + finder.length + ' (삼킨 ' + eatenCount
      + ') · 슬롯 ' + slot.length + ' · ref ' + placed.referenceCells.length
      + ' · format ' + placed.formatCells.length + ' · data ' + data
      + ' · S=' + S + ' · 잔여 ' + (data - S * 3));
    console.log('  ③ 인코더 정합 ⑤ — ' + enc.join(' ') + ' → ' + (encOk ? '통과' : '★거부 (m 조정 사유)'));
    console.log('  ④ 방향 margin ' + mg.margin.toFixed(4) + ' (' + mg.miss + '/' + mg.obs
      + ' · 비대칭 ' + asym + '/' + finder.length + ') — 게이트 0.035 의 '
      + (mg.margin / 0.035).toFixed(2) + 'x');
    console.log('     ※ 남은 비대칭: ' + variant.remainAsym
      + ' · margin 자는 슬롯 QR 의 방향 정보를 못 세므로 **판정 근거 아님** (표기용)');
  }
  console.log('');
}
