/**
 * claude-v0t-derive.mjs — v0T 정본 팩 ↔ 기존 정본 배열의 유도 관계 실측.
 *
 * 목적 (v0T 프로그램 레인, 2026-08-17):
 *   ① 팩의 6개 블록을 분해하고 각 블록이 기존 정본에서 유도 가능한지 값으로 잰다.
 *      (v0W 편입 «손 좌표 0» · v0W2 «손 표는 SE(R) 하나» 와 같은 회계 —
 *       유도 가능한 블록은 참조/유도로 만들고, 아닌 블록만 전사한다.)
 *   ② 모듈 편입 후에는 `cellSurfaceFinal(21,'v0t')` ↔ 팩의 104셀 완전 대조가
 *      §④ 에서 돈다 (편입 전에는 «아직 없음» 으로 표시).
 *
 * 비교 대상 (기존 정본):
 *   · v1r2 NW (0..3)² 16셀 — K3 계보 중앙 (v0X NW 와 같은 자리)
 *   · 그 **3면 다수결 대칭화** — v0W2 중앙과 같은 규칙 (majorityTone)
 *   · V0XQ_CORNER 36셀 = v0X SE 의 (i−15,j) 평행이동 (v0W·v0WQ·v0W2·v0WY NE)
 *   · V0W_PHASE 9셀 = v0 SE 3×3 의 (+8,+8) 평행이동 (v0W·v0WQ SE 마커)
 *   · v0 정본의 다른 블록들 (팔 · SW) — W 블록·N 팔의 출처 후보
 */
import { readFileSync, existsSync } from 'node:fs';
import { locatorCellsCellSurfaceFinal, isCellSurfaceFinalId } from '../../../src/cellSurfaceFinal.js';

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
const cells = PACK.cells.map(([i, j, T, L, R]) => ({ i, j, T, L, R }));
const key = (c) => c.i + ',' + c.j;
const toneKey = (c) => key(c) + ':' + c.T + c.L + c.R;

// ── ① 블록 분해 ─────────────────────────────────────────────────────────
const BOXES = {
  NW: (c) => c.i <= 3 && c.j <= 3,
  A: (c) => c.i >= 4 && c.i <= 6 && c.j >= 3 && c.j <= 5,
  ARM: (c) => c.i <= 1 && c.j >= 10 && c.j <= 14,
  NE: (c) => c.i <= 5 && c.j >= 15,
  W: (c) => c.i >= 10 && c.i <= 15 && c.j <= 3,
  SE: (c) => c.i >= 18 && c.j >= 18,
};
console.log('=== ① 블록 분해 (팩 104셀) ===');
const blocks = {};
let homeless = 0;
for (const c of cells) {
  const homes = Object.entries(BOXES).filter(([, f]) => f(c)).map(([name]) => name);
  if (homes.length !== 1) { homeless += 1; console.log('  ★소속 ' + homes.length + '개: ' + key(c)); continue; }
  (blocks[homes[0]] ??= []).push(c);
}
for (const [name, list] of Object.entries(blocks)) {
  const asym = list.filter((c) => !(c.T === c.L && c.L === c.R)).length;
  console.log('  ' + name + ': ' + list.length + '셀 (비대칭 ' + asym + ')');
}
console.log('  블록 밖: ' + homeless + (homeless === 0 ? ' — ok (6블록 완전 분할)' : ' ★'));

// ── ② 유도 관계 실측 ────────────────────────────────────────────────────
console.log('\n=== ② 기존 정본과의 유도 관계 ===');
function compare(name, mine, theirs, mapCoord = (c) => c) {
  const mineMap = new Map(mine.map((c) => [key(c), c]));
  let match = 0; let toneMiss = 0; let coordMiss = 0;
  for (const t of theirs) {
    const m = mapCoord(t);
    const found = mineMap.get(m.i + ',' + m.j);
    if (!found) { coordMiss += 1; continue; }
    if (found.T === m.T && found.L === m.L && found.R === m.R) match += 1;
    else toneMiss += 1;
  }
  const exact = match === mine.length && match === theirs.length && toneMiss === 0 && coordMiss === 0;
  console.log('  ' + name + ': 일치 ' + match + '/' + mine.length
    + (toneMiss ? ' · 톤 불일치 ' + toneMiss : '')
    + (coordMiss ? ' · 좌표 불일치 ' + coordMiss : '')
    + ' → ' + (exact ? '완전 유도 가능' : '유도 불가 (전사 필요)'));
  return exact;
}
const majority = (T, L, R) => (T === L || T === R) ? T : L;
const v1r2Nw16 = locatorCellsCellSurfaceFinal(21, 'v1r2').filter((c) => c.i <= 3 && c.j <= 3);
const v1r2Nw16Sym = v1r2Nw16.map((c) => {
  const t = majority(c.T, c.L, c.R);
  return { i: c.i, j: c.j, T: t, L: t, R: t };
});
compare('NW 16 ← v1r2 NW (0..3)² 원본 그대로', blocks.NW, v1r2Nw16);
const nwDerivable = compare('NW 16 ← v1r2 NW (0..3)² 3면 다수결 대칭화', blocks.NW, v1r2Nw16Sym);
const v0xqCorner = locatorCellsCellSurfaceFinal(21, 'v0xq').filter((c) => c.i <= 5 && c.j >= 15);
const neDerivable = compare('NE 36 ← V0XQ_CORNER (v0X SE 평행이동)', blocks.NE, v0xqCorner);
const v0wPhase = locatorCellsCellSurfaceFinal(21, 'v0w').filter((c) => c.i >= 18 && c.j >= 18);
const seDerivable = compare('SE 9 ← V0W_PHASE (v0 SE 3×3 의 (+8,+8))', blocks.SE, v0wPhase);

// W 블록 후보: v0 정본 블록들의 평행이동·미러, NW 자기 미러.
const v0Cells = locatorCellsCellSurfaceFinal(13, 'v0');
// v0 SW 3×2 (i>=10, j<=1) 의 이동본?
const v0Sw = v0Cells.filter((c) => c.i >= 10 && c.j <= 1);
compare('W 24 ← v0 SW 3×2 (어떤 평행이동으로도 크기 불일치 24≠6)', blocks.W, v0Sw);
// W 블록 = NW 16 의 세로 미러-회문 스택? W(10..15) 행 = NW 행 [3,2,1,0,2,3]? 실측:
{
  const nwRow = (i) => blocks.NW.filter((c) => c.i === i).sort((a, b) => a.j - b.j);
  const wRow = (i) => blocks.W.filter((c) => c.i === i).sort((a, b) => a.j - b.j);
  const rowKey = (list) => list.map((c) => c.T + '' + c.L + '' + c.R).join(' ');
  const patterns = [3, 2, 1, 0, 2, 3].map((nwI, idx) => {
    const w = wRow(10 + idx);
    const nw = nwRow(nwI);
    return w.length === 4 && nw.length === 4 && rowKey(w) === rowKey(nw);
  });
  console.log('  W 24 ← NW 행 [3,2,1,0,2,3] 스택 (톤 기준): '
    + patterns.map((p) => (p ? 'o' : 'x')).join('') + ' → '
    + (patterns.every(Boolean) ? '패턴 관찰됨 (참조 유도는 아님 — 행 재배열)' : '아님'));
}
// N 팔 후보: v0 정본 팔 (0..1)×(10..12)?
{
  const v0Arm = v0Cells.filter((c) => c.i <= 1 && c.j >= 10);
  compare('N팔 10 ← v0 팔 (0..1)×(10..12) — 크기 10≠' + v0Arm.length, blocks.ARM, v0Arm);
}
// A 블록 (4..6)×(3..5) — 완전 신규 (L 반전 비대칭). 기존 어느 정본에도 같은 자리 블록 없음.
console.log('  A 9 (L 반전 비대칭): 기존 정본에 같은 자리·같은 문법 블록 없음 → 전사 필요');

// ── ③ 요약 ──────────────────────────────────────────────────────────────
console.log('\n=== ③ 유도 회계 요약 ===');
console.log('  유도 가능: NW 16 (' + (nwDerivable ? 'v1r2 NW 대칭화' : '★실패') + ')'
  + ' · NE 36 (' + (neDerivable ? 'V0XQ_CORNER 참조' : '★실패') + ')'
  + ' · SE 9 (' + (seDerivable ? 'V0W_PHASE 참조' : '★실패') + ')'
  + ' = ' + (16 + 36 + 9) + '/104');
console.log('  전사 필요: A 9 · N팔 10 · W 24 = 43/104 (신규 도안 — 운영자 편집기 export)');

// ── ④ 모듈 편입 후 완전 대조 (편입 전에는 «아직 없음») ──────────────────
console.log('\n=== ④ 모듈 ↔ 팩 완전 대조 ===');
if (!isCellSurfaceFinalId('v0t')) {
  console.log('  v0t 미편입 상태 — 편입 후 이 스크립트를 다시 돌리면 여기서 104/104 대조가 돈다.');
} else {
  const module_ = locatorCellsCellSurfaceFinal(21, 'v0t');
  const packSet = new Set(cells.map(toneKey));
  const missing = module_.filter((c) => !packSet.has(toneKey(c)));
  const extra = cells.filter((c) => !module_.some((m) => toneKey(m) === toneKey(c)));
  console.log('  모듈 ' + module_.length + '셀 · 팩 ' + cells.length + '셀 · 모듈에만 '
    + missing.length + ' · 팩에만 ' + extra.length
    + ' → ' + (module_.length === 104 && missing.length === 0 && extra.length === 0
      ? '완전 일치 104/104 — ok' : '★불일치'));
  if (missing.length > 0) console.log('    모듈에만: ' + missing.map(toneKey).join(' '));
  if (extra.length > 0) console.log('    팩에만: ' + extra.map(toneKey).join(' '));
}
