/**
 * claude-geometry-profile.mjs — `proposal` 안쪽 1600ms 의 출처.
 *
 * 단계 프로파일(`claude-stage-profile.out.txt`): 프레임의 98% 가 `proposal` 이고
 * 1회 호출에 평균 1816ms. 그중 CS 블록 로케이터는 184ms 뿐이다. 남은 ~1600ms 가
 * 기하 제안의 어디인지 찾는다.
 *
 * 방법: `enumerateGeometryHypotheses` 는 내부라 직접 못 부른다. 대신 **패밀리 스위치**로
 * 경로를 하나씩 끄고 차분을 본다 — 끈 만큼 줄어든 시간이 그 경로의 비용이다.
 *   base       평소 lab 설정
 *   −CS        enableCellSurfaceY: false  (CS 블록 로케이터 + CS 평가 제거)
 *   −locatorY  enableLocatorY: false
 *   −둘 다
 * ⚠ 차분은 «경로 비용» 의 근사다 (경로끼리 조기 종료로 얽힌다). 그래도 자릿수는 가른다.
 */

import { performance } from 'node:perf_hooks';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../../../tools/read-luma.mjs';

const ARMS = [
  ['base', { enableLocatorY: true, enableCellSurfaceY: true }],
  ['−CS', { enableLocatorY: true, enableCellSurfaceY: false }],
  ['−locY', { enableLocatorY: false, enableCellSurfaceY: true }],
  ['−둘다', { enableLocatorY: false, enableCellSurfaceY: false }],
];

const dumps = listLumaDumps()
  .filter((d) => d.name.startsWith('v0t-crop-20260817/') && d.name.endsWith('.960.luma'))
  .sort((a, b) => a.name.localeCompare(b.name));

const sums = new Map(ARMS.map(([k]) => [k, 0]));
console.log('덤프                      ' + ARMS.map(([k]) => k.padEnd(9)).join('') + '판정(base)');
for (const dump of dumps) {
  const raster = lumaToRaster(readLumaDump(dump.path));
  const cells = [];
  let verdict = '';
  for (const [label, cube] of ARMS) {
    const opts = { bootstrap: { family: { cube } } };
    decodeFrontend(raster, opts); // 워밍업
    const t = performance.now();
    const r = decodeFrontend(raster, opts);
    const ms = performance.now() - t;
    sums.set(label, sums.get(label) + ms);
    cells.push(ms.toFixed(0).padEnd(9));
    if (label === 'base') verdict = r.ok ? 'OK ' + r.hypothesis.cellSurfaceLayout : '실패';
  }
  const short = dump.name.replace('v0t-crop-20260817/KakaoTalk_20260817_', '').replace('.960.luma', '');
  console.log(`${short.padEnd(26)}${cells.join('')}${verdict}`);
}

console.log('\n=== 총합 ===');
for (const [k] of ARMS) console.log(`  ${k.padEnd(8)} ${sums.get(k).toFixed(0).padStart(7)}ms`);
const base = sums.get('base');
console.log(`\n차분 (base 대비):`);
console.log(`  CS 경로      ${(base - sums.get('−CS')).toFixed(0)}ms`);
console.log(`  locatorY 경로 ${(base - sums.get('−locY')).toFixed(0)}ms`);
console.log(`  둘 다 끄면    ${sums.get('−둘다').toFixed(0)}ms 남는다`
  + '  ← 이 값이 크면 «공통 기하»(실루엣·hull·shapeCandidates)가 진짜 병목이다');
