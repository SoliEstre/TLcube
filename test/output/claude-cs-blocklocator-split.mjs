/**
 * claude-cs-blocklocator-split.mjs — 플래그 하나가 켜는 **두 가지**를 가른다.
 *
 * `cube-detect.js:3118` :
 *   if (options.enableCellSurfaceY === true && options.csBlockLocator !== false) { … }
 *
 * 즉 `enableCellSurfaceY` 기본값을 올리면 **셀 표면 라인업**과 **블록 로케이터**가
 * 같이 켜진다. 운영자가 결정한 것은 앞의 것이므로, 뒤의 것이 이득에 필요한지
 * **따로 재야** 한다. 필요 없으면 안 켜는 쪽이 좁고 싸다.
 *
 * ⚠ 시간은 이 실행에서 믿지 마라 (다른 작업과 CPU 공유). 판정은 결정적이다.
 */
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../../tools/read-luma.mjs';

const WORLDS = [
  ['off', { bootstrap: { family: { cube: { enableCellSurfaceY: false } } } }],
  ['both', { bootstrap: { family: { cube: { enableCellSurfaceY: true } } } }],
  ['lineup', { bootstrap: { family: { cube: { enableCellSurfaceY: true, csBlockLocator: false } } } }],
];

const dumps = listLumaDumps();
if (dumps.length === 0) { console.log('★ 덤프 0장 — 무효'); process.exit(1); }

const rows = [];
for (const dump of dumps) {
  const raster = lumaToRaster(readLumaDump(dump.path));
  const row = { name: dump.name };
  for (const [key, o] of WORLDS) {
    const t = process.hrtime.bigint();
    const r = decodeFrontend(raster, o);
    row[key] = r.ok === true;
    row[key + 'Text'] = r.ok ? r.text : null;
    row[key + 'Ms'] = Number(process.hrtime.bigint() - t) / 1e6;
  }
  rows.push(row);
}

const n = (k) => rows.filter((r) => r[k]).length;
const med = (k) => {
  const s = rows.map((r) => r[k + 'Ms']).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
console.log('덤프 ' + rows.length + '장');
for (const [key] of WORLDS) {
  console.log('  ' + key.padEnd(7) + ' 복호 ' + String(n(key)).padStart(3)
    + ' · 중앙값 ' + med(key).toFixed(0) + ' ms');
}
for (const [from, to] of [['off', 'both'], ['off', 'lineup'], ['lineup', 'both']]) {
  const rec = rows.filter((r) => !r[from] && r[to]);
  const lost = rows.filter((r) => r[from] && !r[to]);
  const chg = rows.filter((r) => r[from] && r[to] && r[from + 'Text'] !== r[to + 'Text']);
  console.log('  ' + from + '→' + to + '  회복 ' + rec.length + ' · 손실 ' + lost.length
    + ' · 원문바뀜 ' + chg.length);
  for (const r of lost) console.log('      ★손실 ' + r.name);
  for (const r of chg) console.log('      ★원문바뀜 ' + r.name);
}
