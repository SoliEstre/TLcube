/**
 * claude-cellsurface-default-cost.mjs
 *
 * `enableCellSurfaceY` 기본값을 true 로 올릴 때의 **비용과 판정 변화**를 실사진으로 잰다.
 * 운영자 결정(2026-08-19): 켜되 «값이 나쁘면 되돌린다».
 *
 * 자 규율 (레인이 이 라운드에 두 번 속은 자리를 피한다):
 *   · **왕복(`decodeFrontend`)** 으로 잰다 — 검출기 층위가 아니다. 검출은 살고 복호가
 *     죽는 사례가 이 저장소에 실재한다 (minCellSize 8 사건).
 *   · 같은 프레임을 **교대로** 잰다 (off, on, off, on …) — 블록별로 몰아 재면 JIT 표류가
 *     비용차로 위장한다 (이 프로젝트에서 실제로 겪었다).
 *   · **판정 변화를 셋으로 가른다**: 회복(off✗→on✓) · 손실(off✓→on✗) · 원문 바뀜.
 *     손실이 0 이 아니면 그 자체로 기각 사유다.
 */
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../../tools/read-luma.mjs';

const dumps = listLumaDumps();
if (dumps.length === 0) {
  console.log('★ 실사진 덤프가 0장이다 — 이 워크트리에 정션이 안 걸렸다. 측정 안 함.');
  process.exit(1);
}

const OFF = { bootstrap: { family: { cube: { enableCellSurfaceY: false } } } };
const ON = { bootstrap: { family: { cube: { enableCellSurfaceY: true } } } };

const rows = [];
for (const dump of dumps) {
  const raster = lumaToRaster(readLumaDump(dump.path));
  const t = [];
  let rOff = null; let rOn = null;
  for (let round = 0; round < 2; round++) {          // 교대 2회, 최솟값 채택
    let s = process.hrtime.bigint();
    const a = decodeFrontend(raster, OFF);
    t[0] = Math.min(t[0] ?? Infinity, Number(process.hrtime.bigint() - s) / 1e6);
    s = process.hrtime.bigint();
    const b = decodeFrontend(raster, ON);
    t[1] = Math.min(t[1] ?? Infinity, Number(process.hrtime.bigint() - s) / 1e6);
    rOff = a; rOn = b;
  }
  rows.push({ name: dump.name, offOk: rOff.ok === true, onOk: rOn.ok === true,
    offText: rOff.text ?? null, onText: rOn.text ?? null, msOff: t[0], msOn: t[1] });
}

const recovered = rows.filter((r) => !r.offOk && r.onOk);
const lost = rows.filter((r) => r.offOk && !r.onOk);
const changed = rows.filter((r) => r.offOk && r.onOk && r.offText !== r.onText);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sum = (a) => a.reduce((x, y) => x + y, 0);

console.log('덤프 ' + rows.length + '장 · 왕복 · 교대 최솟값');
console.log('  복호 성공  off ' + rows.filter((r) => r.offOk).length
  + '  →  on ' + rows.filter((r) => r.onOk).length);
console.log('  회복(off✗→on✓) ' + recovered.length
  + ' · **손실(off✓→on✗) ' + lost.length + '** · 원문 바뀜 ' + changed.length);
console.log('  시간 중앙값  off ' + med(rows.map((r) => r.msOff)).toFixed(1) + ' ms'
  + '  →  on ' + med(rows.map((r) => r.msOn)).toFixed(1) + ' ms'
  + '  (×' + (med(rows.map((r) => r.msOn)) / med(rows.map((r) => r.msOff))).toFixed(2) + ')');
console.log('  시간 합계    off ' + (sum(rows.map((r) => r.msOff)) / 1000).toFixed(1) + ' s'
  + '  →  on ' + (sum(rows.map((r) => r.msOn)) / 1000).toFixed(1) + ' s'
  + '  (×' + (sum(rows.map((r) => r.msOn)) / sum(rows.map((r) => r.msOff))).toFixed(2) + ')');
for (const r of lost) console.log('  ★손실: ' + r.name);
for (const r of changed) console.log('  ★원문바뀜: ' + r.name);
for (const r of recovered.slice(0, 10)) console.log('  회복: ' + r.name);
