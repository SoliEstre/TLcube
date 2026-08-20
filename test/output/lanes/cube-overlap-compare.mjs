// 성공하는 옛 큐브 프레임 vs 실패하는 새 프레임 — 배경 모델이 심볼 톤을 먹는가를 나란히.
import { listLumaDumps, readLumaDump, lumaToRaster } from '../../../tools/read-luma.mjs';
import { detectCentralCubeFinders } from '../../../src/decoder/cube-detect.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { FINDER_CUBE_TONES, getPreset, relativeLuminance } from '../../../src/luminance.js';

const TONES = FINDER_CUBE_TONES.map((c) => relativeLuminance(c));
const LEVELS = getPreset('slate').levels.map((c) => relativeLuminance(c));
const ALL = [...TONES, ...LEVELS];

const rows = [];
const WANT = process.argv.slice(2);
for (const { name, path } of listLumaDumps()) {
  if (WANT.length && !WANT.some((w) => name.includes(w))) continue;
  const luma = readLumaDump(path);
  const c = detectCentralCubeFinders(luma, {});
  const s = (c.detail?.diagnostics?.shapes) || c.detail?.shapes || {};
  const models = s.backgroundModels || [];
  if (!models.length) continue;
  const eaten = ALL.filter((y) => models.some((m) => Math.abs(y - m.mean) <= m.tolerance)).length;
  const spread = Math.max(...models.map((m) => m.mean)) - Math.min(...models.map((m) => m.mean));
  const r = decodeFrontend(lumaToRaster(luma), {});
  rows.push({ name, ok: Boolean(r.ok), cubeOk: c.ok, eaten, models: models.length, spread, isNew: name.includes('cube3t-20260820') });
}
const g = (f) => rows.filter(f);
const stat = (xs, k) => xs.length ? (xs.reduce((a, r) => a + r[k], 0) / xs.length).toFixed(2) : '—';
console.log('그룹                          n   먹힌톤평균  모델수평균  스프레드평균');
for (const [label, sel] of [
  ['옛 코퍼스 · 복호 성공', (r) => !r.isNew && r.ok],
  ['옛 코퍼스 · 복호 실패', (r) => !r.isNew && !r.ok],
  ['새 3톤큐브 사진 (보고건)', (r) => r.isNew],
]) {
  const xs = g(sel);
  console.log(label.padEnd(26) + String(xs.length).padStart(4)
    + stat(xs, 'eaten').padStart(11) + stat(xs, 'models').padStart(11) + stat(xs, 'spread').padStart(13));
}
console.log('\n먹힌 톤 개수별 복호 성공률 (옛 코퍼스):');
for (let e = 0; e <= 6; e += 1) {
  const xs = g((r) => !r.isNew && r.eaten === e);
  if (!xs.length) continue;
  const ok = xs.filter((r) => r.ok).length;
  console.log('  ' + e + '개 먹힘 : ' + ok + '/' + xs.length + ' (' + (100 * ok / xs.length).toFixed(0) + '%)');
}
