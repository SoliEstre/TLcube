// no-format-candidate 실물 실패 파기용 census.
// 라벨만 세지 않는다 — cause / family / 기하 진단을 같은 행에 담는다.
import fs from 'node:fs';
import { listLumaDumps, readLumaDump, lumaToRaster } from '../../../tools/read-luma.mjs';
import { decodeFrontend } from '../../../src/decoder/frontend.js';

const rows = [];
for (const { name, path } of listLumaDumps()) {
  const r = decodeFrontend(lumaToRaster(readLumaDump(path)), {});
  const d = r.detail || {};
  const g = d.geometryDiagnostics || (d.cause && d.cause.geometryDiagnostics) || {};
  rows.push({
    name,
    ok: Boolean(r.ok),
    reason: r.reason ?? null,
    cause: (d.cause && d.cause.cause) || (typeof d.cause === 'string' ? d.cause : null),
    family: g.classification?.family ?? r.family ?? null,
    finderCount: g.finderCount ?? null,
    qrHyp: g.qr?.hypothesisCount ?? null,
    fill: g.outline?.fillRatio ?? null,
    touches: g.outline?.touchesBorder ?? null,
    formatCandidateCount: d.formatCandidateCount ?? d.cause?.formatCandidateCount ?? null,
  });
  process.stdout.write(r.ok ? '.' : 'x');
}
process.stdout.write('\n\n');
const tally = (xs) => xs.reduce((a, v) => (a[v ?? '—'] = (a[v ?? '—'] || 0) + 1, a), {});
console.log('덤프 ' + rows.length + ' · ok ' + rows.filter(r => r.ok).length);
console.log('reason 전수 : ' + JSON.stringify(tally(rows.map(r => r.reason)), null, 1));
const nfc = rows.filter(r => r.reason === 'frontend:no-format-candidate');
console.log('\n=== no-format-candidate ' + nfc.length + '장 ===');
console.log('cause  : ' + JSON.stringify(tally(nfc.map(r => r.cause))));
console.log('family : ' + JSON.stringify(tally(nfc.map(r => r.family))));
console.log('finder : ' + JSON.stringify(tally(nfc.map(r => r.finderCount))));
for (const r of nfc) console.log('  ' + JSON.stringify(r));
fs.writeFileSync(new URL('./nfc-census.json', import.meta.url), JSON.stringify({ all: rows, nfc }, null, 1));
