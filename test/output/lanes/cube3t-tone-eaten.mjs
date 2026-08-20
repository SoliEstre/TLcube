// 배경 모델이 심볼의 **자기 톤**을 덮고 있는가.
// 전경 마스크는 테두리 k-means 로 배경 모델을 세우고 |Y - mean| <= tolerance 면 배경으로 친다.
// 화면 백라이트 기울기가 크면 모델이 여러 개 생기고, 그 중 하나가 심볼 톤 위에 앉을 수 있다.
import { listLumaDumps, readLumaDump } from '../../../tools/read-luma.mjs';
import { detectCentralCubeFinders } from '../../../src/decoder/cube-detect.js';
import { FINDER_CUBE_TONES, FINDER_CUBE_SEAM, getPreset, relativeLuminance } from '../../../src/luminance.js';

const TONES = FINDER_CUBE_TONES.map((c, i) => ['면' + i, relativeLuminance(c)]);
TONES.push(['심', relativeLuminance(FINDER_CUBE_SEAM)]);
const levels = getPreset('slate').levels.map((c, i) => ['데이터' + i, relativeLuminance(c)]);

console.log('심볼 톤 Y : ' + [...TONES, ...levels].map(([n, y]) => n + ' ' + y.toFixed(4)).join(' · '));
console.log('');
for (const { name, path } of listLumaDumps()) {
  if (!name.includes('cube3t-20260820')) continue;
  const luma = readLumaDump(path);
  const c = detectCentralCubeFinders(luma, {});
  const s = (c.detail?.diagnostics?.shapes) || c.detail?.shapes || {};
  const models = s.backgroundModels || [];
  if (!models.length) { console.log(name.split('/').pop() + '  (모델 없음 — ok=' + c.ok + ')'); continue; }
  const eaten = [];
  for (const [n, y] of [...TONES, ...levels]) {
    const hit = models.find((m) => Math.abs(y - m.mean) <= m.tolerance);
    if (hit) eaten.push(n + '←' + hit.mean.toFixed(3) + '±' + hit.tolerance.toFixed(3));
  }
  console.log(name.split('/').pop().replace('KakaoTalk_20260820_202708813', 'F').replace('.luma', '').padEnd(11)
    + ' ok=' + (c.ok ? 'Y' : 'N')
    + ' 모델 [' + models.map((m) => m.mean.toFixed(2) + '±' + m.tolerance.toFixed(2)).join(' ') + ']');
  console.log('             배경으로 먹힌 톤: ' + (eaten.length ? eaten.join(' · ') : '없음'));
}
