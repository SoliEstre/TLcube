// 같은 사진의 960 vs 1440 — 「고해상에서 전경 회수가 줄어든다」축을 직접 잰다.
import { listLumaDumps, readLumaDump } from '../../../tools/read-luma.mjs';
import { detectCentralCubeFinders } from '../../../src/decoder/cube-detect.js';
const rows = [];
for (const { name, path } of listLumaDumps()) {
  if (!name.includes('cube3t-20260820')) continue;
  const luma = readLumaDump(path);
  const c = detectCentralCubeFinders(luma, {});
  const s = (c.detail && c.detail.diagnostics && c.detail.diagnostics.shapes)
    || (c.detail && c.detail.shapes) || {};
  const px = luma.width * luma.height;
  rows.push({
    f: name.split('/').pop().replace('KakaoTalk_20260820_202708813', 'F').replace('.luma', ''),
    ok: c.ok, cause: c.detail?.cause ?? '—',
    px,
    raw: s.rawForegroundPixels, rec: s.recoveredForegroundPixels,
    rawR: s.rawForegroundPixels / px, recR: s.recoveredForegroundPixels / px,
    keep: s.recoveredForegroundPixels / s.rawForegroundPixels,
    comps: s.componentCount,
    models: (s.backgroundModels || []).length,
    modelSpread: s.backgroundModels && s.backgroundModels.length
      ? (Math.max(...s.backgroundModels.map((m) => m.mean)) - Math.min(...s.backgroundModels.map((m) => m.mean)))
      : NaN,
  });
}
rows.sort((a, b) => (a.f < b.f ? -1 : 1));
console.log('프레임'.padEnd(12) + ' ok   raw%   rec%   유지%  comp 모델 스프레드  cause');
for (const r of rows) {
  console.log(
    r.f.padEnd(12)
    + ' ' + (r.ok ? 'ok ' : '✖  ')
    + (100 * r.rawR).toFixed(1).padStart(5)
    + (100 * r.recR).toFixed(1).padStart(7)
    + (100 * r.keep).toFixed(1).padStart(7)
    + String(r.comps).padStart(5)
    + String(r.models).padStart(4)
    + r.modelSpread.toFixed(3).padStart(9)
    + '  ' + r.cause,
  );
}
