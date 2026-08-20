import { listLumaDumps, readLumaDump, lumaToRaster } from '../../../tools/read-luma.mjs';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCentralCubeFinders } from '../../../src/decoder/cube-detect.js';
for (const { name, path } of listLumaDumps()) {
  if (!name.includes('cube3t-20260820')) continue;
  const luma = readLumaDump(path);
  const cube = detectCentralCubeFinders(luma, {});
  const r = decodeFrontend(lumaToRaster(luma), {});
  const d = r.detail || {};
  const g = d.geometryDiagnostics || (d.cause && d.cause.geometryDiagnostics) || {};
  console.log(name.replace('cube3t-20260820/KakaoTalk_20260820_', ''));
  console.log('   중앙큐브 검출 : ok=' + cube.ok + ' reason=' + (cube.reason ?? '—')
    + (cube.finders ? ' n=' + cube.finders.length : ''));
  console.log('   복호        : ok=' + r.ok + ' reason=' + (r.reason ?? '—')
    + ' text=' + JSON.stringify(r.text ?? null));
  console.log('   기하        : family=' + (g.classification?.family ?? '—')
    + ' finder=' + (g.finderCount ?? '—') + ' fill=' + (g.outline?.fillRatio?.toFixed(3) ?? '—')
    + ' touches=' + (g.outline?.touchesBorder ?? '—') + ' qrHyp=' + (g.qr?.hypothesisCount ?? '—'));
}
