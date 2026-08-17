/**
 * claude-cost-profile.mjs — 「같은 해상도에서 로케이터가 100ms vs 2412ms」의 원인 회계.
 *
 * `claude-frame-budget.out.txt`: 960 실사진에서 로케이터가 113ms(231239674.960) 부터
 * 2412ms(232739735.960) 까지 **24배** 벌어진다. 픽셀 수는 같으므로 원인은 처리량이
 * 아니라 **후보 수**다. 어느 단계의 후보가 폭발하는지 찍는다.
 *
 * 재는 것 (프레임마다):
 *   cores      concentric core 후보 (스캔 산출)
 *   clusters   군집 수
 *   k3 / k5    검증 통과 수  ← verify* 가 클러스터마다 레이를 쏜다
 *   loose      느슨 코너
 *   삼중점      확증 경로가 본 삼중점 (캡 전)
 *   refinePose 호출 수는 직접 못 세므로, **패밀리별 포즈 수 + 시드 시도 상한**으로 대신한다
 *   그리고 각 단계의 벽시계 시간을 분해한다 (스캔 / 군집 / 검증 / 조립).
 *
 * 목적은 「무엇을 자를까」가 아니라 「어디가 비싼가」다 — 자를 곳은 이 표가 정한다.
 */

import { performance } from 'node:perf_hooks';
import {
  CS_BLOCK_LOCATOR_INTERNALS, UNVERIFIED_CS_BLOCK_LOCATOR,
  detectCellSurfaceBlockShapes,
} from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { downsampleLumaForSeed, otsuThreshold } from '../../../src/decoder/finder-seed.js';
import { listLumaDumps, readLumaDump } from '../../../tools/read-luma.mjs';

const {
  scanConcentricCores, clusterCores, verifyV2r2Cluster, verifyV0Cluster,
  verifyV0xqCornerCluster,
} = CS_BLOCK_LOCATOR_INTERNALS;

const cfg = { ...UNVERIFIED_CS_BLOCK_LOCATOR };
const dumps = listLumaDumps()
  .filter((d) => d.name.startsWith('v0t-crop-20260817/') && d.name.endsWith('.960.luma'))
  .sort((a, b) => a.name.localeCompare(b.name));

console.log('덤프                      전체ms  스캔  군집  검증   조립   | cores clusters k3 k5 loose');
const rows = [];
for (const dump of dumps) {
  const luma = readLumaDump(dump.path);
  detectCellSurfaceBlockShapes(luma, { enableCellSurfaceY: true }); // 워밍업

  const t0 = performance.now();
  const reduced = downsampleLumaForSeed(luma, cfg.searchMaxSide);
  const cut = otsuThreshold(reduced.luma);
  const t1 = performance.now();
  const cores = scanConcentricCores(reduced.luma, cut, cfg);
  const t2 = performance.now();
  const clusters = clusterCores(cores, cfg);
  const t3 = performance.now();

  // 검증 단계 — 진입점과 같은 순서·같은 캡.
  const verified = []; const occupied = [];
  let k5seen = 0; let k3seen = 0;
  for (const cluster of clusters) {
    if (cluster.kind === 'k5') { if (k5seen >= cfg.maximumVerifiedPerKind) continue; k5seen += 1; }
    else { if (k3seen >= cfg.maximumVerifiedPerKind) continue; k3seen += 1; }
    if (occupied.some((h) => h.coreKind === cluster.kind
      && Math.hypot(h.x - cluster.x, h.y - cluster.y)
        <= 2.2 * Math.max(h.u, cluster.u))) continue;
    const native = cluster.kind === 'k5'
      ? verifyV2r2Cluster(reduced.luma, cut, cluster, cfg)
      : verifyV0Cluster(reduced.luma, cut, cluster, cfg);
    const hit = native || (cluster.kind === 'k5'
      ? verifyV0Cluster(reduced.luma, cut, cluster, cfg)
      : verifyV2r2Cluster(reduced.luma, cut, cluster, cfg));
    if (hit) { verified.push(hit); occupied.push({ ...hit, coreKind: cluster.kind }); }
  }
  let looseInspected = 0;
  const loose = [];
  for (const cluster of clusters) {
    if (cluster.kind !== 'k5') continue;
    if (looseInspected >= cfg.v0xqMaxInspectedClusters) break;
    looseInspected += 1;
    const hit = verifyV0xqCornerCluster(reduced.luma, cut, cluster, cfg);
    if (hit) loose.push(hit);
  }
  const t4 = performance.now();

  // 조립 = 전체 − 앞 단계들 (진입점 한 번 더 돌려 총합을 잰다).
  const tAll0 = performance.now();
  const det = detectCellSurfaceBlockShapes(luma, { enableCellSurfaceY: true });
  const total = performance.now() - tAll0;

  const k3 = verified.filter((h) => h.kind === 'v0-center').length;
  const k5 = verified.filter((h) => h.kind === 'v2r2-corner').length;
  const scan = t2 - t1; const clus = t3 - t2; const ver = t4 - t3;
  const assemble = Math.max(0, total - (t1 - t0) - scan - clus - ver);
  const short = dump.name.replace('v0t-crop-20260817/KakaoTalk_20260817_', '').replace('.960.luma', '');
  rows.push({ short, total, scan, clus, ver, assemble, cores: cores.length, clusters: clusters.length, k3, k5, loose: loose.length });
  console.log(`${short.padEnd(26)}${total.toFixed(0).padEnd(8)}`
    + `${scan.toFixed(0).padEnd(6)}${clus.toFixed(0).padEnd(6)}${ver.toFixed(0).padEnd(7)}`
    + `${assemble.toFixed(0).padEnd(7)}| ${String(cores.length).padEnd(6)}`
    + `${String(clusters.length).padEnd(9)}${String(k3).padEnd(3)}${String(k5).padEnd(3)}${loose.length}`);
}

console.log('\n=== 상관 ===');
const cheap = rows.slice().sort((a, b) => a.total - b.total)[0];
const dear = rows.slice().sort((a, b) => b.total - a.total)[0];
console.log(`가장 싼 ${cheap.short}: ${cheap.total.toFixed(0)}ms`
  + ` (cores ${cheap.cores} · clusters ${cheap.clusters} · k3 ${cheap.k3} · loose ${cheap.loose})`);
console.log(`가장 비싼 ${dear.short}: ${dear.total.toFixed(0)}ms`
  + ` (cores ${dear.cores} · clusters ${dear.clusters} · k3 ${dear.k3} · loose ${dear.loose})`);
console.log(`배수 ${(dear.total / Math.max(cheap.total, 1e-9)).toFixed(1)}×`
  + ` · cores ${(dear.cores / Math.max(cheap.cores, 1)).toFixed(1)}×`
  + ` · clusters ${(dear.clusters / Math.max(cheap.clusters, 1)).toFixed(1)}×`);
console.log('\n단계별 총합 (전 프레임 합산):');
for (const key of ['scan', 'clus', 'ver', 'assemble']) {
  const sum = rows.reduce((s, r) => s + r[key], 0);
  const all = rows.reduce((s, r) => s + r.total, 0);
  console.log(`  ${key.padEnd(9)} ${sum.toFixed(0).padStart(6)}ms  (${(100 * sum / all).toFixed(0)}%)`);
}
