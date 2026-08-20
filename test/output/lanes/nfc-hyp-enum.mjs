// symbol-clipped 프레임에서 «시도된 포맷 가설 전부» 를 나열한다.
// hex/6 이 유일한 가설이었는지, 여럿 중 하나였는지가 결론을 가른다.
import { listLumaDumps, readLumaDump, lumaToRaster } from '../../../tools/read-luma.mjs';
import { decodeFrontend } from '../../../src/decoder/frontend.js';

const targets = [
  'cellmask-20260819-tele/KakaoTalk_20260819_231034092_04.1440.luma',
  'cellmask-20260819-wide/KakaoTalk_20260819_231341235_10.1440.luma',
];
const dumps = new Map(listLumaDumps().map((d) => [d.name, d]));
for (const name of targets) {
  const d = dumps.get(name);
  const luma = readLumaDump(d.path);
  const r = decodeFrontend(lumaToRaster(luma), {});
  const diag = r.detail?.cause?.diagnostics || {};
  const failures = diag.formatFailures || [];
  console.log('── ' + name + '  (' + luma.width + 'x' + luma.height + ')');
  console.log('   reason=' + r.reason + ' · 시도된 포맷 가설 ' + failures.length + '개');
  const tally = {};
  for (const f of failures) {
    const key = (f.family ?? '?') + '/' + (f.k ?? f.n ?? '?')
      + ' → ' + (f.detail?.firstFormatCellFailure?.reason ?? f.reason ?? '?');
    tally[key] = (tally[key] || 0) + 1;
  }
  for (const [k, v] of Object.entries(tally)) console.log('     ' + v + '  ' + k);
  const g = r.detail?.geometryDiagnostics;
  console.log('   outline fillRatio=' + g?.outline?.fillRatio?.toFixed(4)
    + ' touchesBorder=' + g?.outline?.touchesBorder
    + ' · finderCount=' + g?.finderCount + ' · qrHyp=' + g?.qr?.hypothesisCount);
  if (g?.outline?.bbox) console.log('   outline bbox=' + JSON.stringify(g.outline.bbox));
  console.log('');
}
