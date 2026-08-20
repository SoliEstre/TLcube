// symbol-clipped 45장 판별: «진짜 촬영 crop» 인가 «거짓 포즈가 만든 영상 밖 투영» 인가.
// 게이트를 한 값도 안 건드린다 — 이미 있는 진단만 읽어 교차표를 만든다.
import fs from 'node:fs';
import { listLumaDumps, readLumaDump, lumaToRaster } from '../../../tools/read-luma.mjs';
import { decodeFrontend } from '../../../src/decoder/frontend.js';

const rows = fs.readFileSync(new URL('../../../lane-out/nfc-deep.txt', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .flatMap((line) => {
    const m = line.match(/^\[L\d+\]\s+(\{.*\})$/);
    return m ? [JSON.parse(m[1])] : [];
  })
  .filter((r) => r.formatFailureReason === 'frontend:symbol-clipped');

const dumps = new Map(listLumaDumps().map((d) => [d.name, d]));
const tally = {};
const detail = [];
for (const row of rows) {
  const d = dumps.get(row.name);
  if (!d) { tally['DUMP-MISSING'] = (tally['DUMP-MISSING'] || 0) + 1; continue; }
  const luma = readLumaDump(d.path);
  const r = decodeFrontend(lumaToRaster(luma), {});
  const g = r.detail?.geometryDiagnostics;
  const failures = r.detail?.cause?.diagnostics?.formatFailures || [];
  const f = failures.find((x) => x.detail?.firstFormatCellFailure?.reason === 'frontend:symbol-clipped');
  const inner = f?.detail?.firstFormatCellFailure?.detail?.failures
    ?.find((x) => x.reason === 'frontend:symbol-clipped');
  const p = inner?.detail?.projectedBounds;
  if (!p) { tally['NO-BOUNDS'] = (tally['NO-BOUNDS'] || 0) + 1; continue; }
  const outside = p.maxX < 0 || p.maxY < 0 || p.minX > luma.width || p.minY > luma.height;
  const touches = Boolean(g?.outline?.touchesBorder);
  const key = `outlineTouches=${touches} projectionOutside=${outside}`;
  tally[key] = (tally[key] || 0) + 1;
  detail.push({
    name: row.name, touches, outside, w: luma.width, h: luma.height,
    bounds: { minX: Math.round(p.minX), maxX: Math.round(p.maxX), minY: Math.round(p.minY), maxY: Math.round(p.maxY) },
    hypothesis: f?.family ? f.family + '/' + (f.k ?? f.n ?? '?') : (row.formatFailureHypothesisId ?? '?'),
  });
}
console.log('symbol-clipped 행 ' + rows.length + '장');
console.log(JSON.stringify(tally, null, 1));
console.log('\n프레임별:');
for (const d of detail) console.log('  ' + JSON.stringify(d));
