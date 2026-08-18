/**
 * claude-v0-leak-anatomy.mjs — 「v0 으로 새는」 프레임의 해부.
 *
 * 운영자 제안 (2026-08-18): «v0T 인지를 먼저 체크하고 아닌 경우 v0 으로 넘어가게
 * 하면 어떨까. v0 은 인식률이 좋기도 하고 해상도가 낮아서 애초에 유리하니깐.»
 *
 * 그 제안이 듣는 형태인지는 **한 가지**에 달려 있다:
 *   ⓐ v0 으로 새는 프레임에 **n=21 가설이 존재하는데 v0 에 졌다** → 순서/우선권 문제.
 *      제안대로 «n=21 먼저» 로 고치면 듣는다.
 *   ⓑ **n=21 가설이 아예 없다** → 순서를 바꿔도 소용없다. n=13 포즈가 서는 조건
 *      (v0 360° 스윕)을 봐야 한다.
 *
 * 추정하지 않고 실사진에서 센다. 프레임마다:
 *   · 블록 로케이터가 낸 셰이프의 estimatedN 분포 (21 이 하나라도 있나)
 *   · 최종 판정의 n 과 layout
 *   · n=21 셰이프가 있는데 n=13 으로 판정된 «역전» 프레임 수  ← ⓐ 의 크기
 */

import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../../../tools/read-luma.mjs';

const LAB = {
  bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
};

const dumps = listLumaDumps()
  .filter((d) => d.name.includes('20260817_23'))
  .sort((a, b) => a.name.localeCompare(b.name));

console.log('덤프                                        n=21셰이프 n=13셰이프  판정            분류');
const rows = [];
for (const dump of dumps) {
  const luma = readLumaDump(dump.path);
  const raster = lumaToRaster(luma);
  const det = detectCellSurfaceBlockShapes(luma, { enableCellSurfaceY: true });
  const n21 = det.shapes.filter((s) => s.estimatedN === 21).length;
  const n13 = det.shapes.filter((s) => s.estimatedN === 13).length;
  const decoded = decodeFrontend(raster, LAB);
  const gotN = decoded.ok ? decoded.hypothesis.n : null;
  const gotLayout = decoded.ok ? decoded.hypothesis.cellSurfaceLayout : null;
  const verdict = decoded.ok ? `OK n${gotN}` : '실패 ' + decoded.reason.replace('frontend:', '');
  rows.push({ name: dump.name, n21, n13, ok: decoded.ok, gotN, gotLayout });
  const short = dump.name.replace('v0t-crop-20260817/KakaoTalk_20260817_', 'crop ')
    .replace('v0t-20260817/KakaoTalk_20260817_', 'orig ')
    .replace('v0t-edge-20260817/KakaoTalk_20260817_', 'edge ');
  console.log(`${short.padEnd(44)}${String(n21).padEnd(11)}${String(n13).padEnd(11)}`
    + `${verdict.padEnd(16)}${gotLayout || '-'}`);
}

console.log('\n=== 회계 ===');
const leaked = rows.filter((r) => r.ok && r.gotN === 13);
const failedWith21 = rows.filter((r) => !r.ok && r.n21 > 0);
const failedNo21 = rows.filter((r) => !r.ok && r.n21 === 0);
console.log(`전체 ${rows.length}덤프`);
console.log(`  v0(n=13)으로 복호된 프레임      : ${leaked.length}`);
console.log(`    그중 n=21 셰이프도 있었던 것  : ${leaked.filter((r) => r.n21 > 0).length}  ← ⓐ (순서 문제)`);
console.log(`    n=21 셰이프가 아예 없던 것    : ${leaked.filter((r) => r.n21 === 0).length}  ← ⓑ (포즈 문제)`);
console.log(`  실패 프레임                     : ${failedWith21.length + failedNo21.length}`);
console.log(`    n=21 셰이프 있음 / 없음       : ${failedWith21.length} / ${failedNo21.length}`);
console.log();
const total21present = rows.filter((r) => r.n21 > 0).length;
console.log(`n=21 셰이프가 선 프레임: ${total21present}/${rows.length}`);
console.log('\n판독:');
console.log('  ⓐ 가 크면 «n=21 먼저» 순서 변경이 듣는다 (운영자 제안대로).');
console.log('  ⓑ 가 크면 순서는 무의미하다 — n=21 포즈가 서게 만드는 것이 표적이다.');
