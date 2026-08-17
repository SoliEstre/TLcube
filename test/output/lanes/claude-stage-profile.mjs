/**
 * claude-stage-profile.mjs — 군집화 수리 뒤 **하류** 비용 회계.
 *
 * `claude-frame-budget.post.out.txt`: 로케이터 335 → 184ms 로 잡혔는데 전체는
 * 2164 → 1919ms 다. 로케이터는 이제 프레임의 10% — 남은 \~1700ms 가 어디인지 찾는다.
 *
 * 파이프라인에 `options.onStage` 훅이 이미 있다 (bootstrap.withStage). 단계는
 * proposal / format / decode / verify. 그걸로 벽시계를 나눈다.
 * ⚠ 같은 단계가 여러 번 열리므로 **호출 수와 총합**을 같이 낸다 — 한 번이 비싼지
 * 여러 번이라 비싼지가 처방을 가른다.
 */

import { performance } from 'node:perf_hooks';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../../../tools/read-luma.mjs';

const dumps = listLumaDumps()
  .filter((d) => d.name.startsWith('v0t-crop-20260817/') && d.name.endsWith('.960.luma'))
  .sort((a, b) => a.name.localeCompare(b.name));

const totals = new Map();
const counts = new Map();

console.log('덤프                      전체ms | 단계별 ms (호출수)');
for (const dump of dumps) {
  const raster = lumaToRaster(readLumaDump(dump.path));
  const stack = [];
  const local = new Map();
  const localCount = new Map();
  const onStage = (stage, edge) => {
    if (edge === 'enter') { stack.push([stage, performance.now()]); return; }
    const top = stack.pop();
    if (!top) return;
    const ms = performance.now() - top[1];
    local.set(top[0], (local.get(top[0]) || 0) + ms);
    localCount.set(top[0], (localCount.get(top[0]) || 0) + 1);
  };
  decodeFrontend(raster, {
    bootstrap: {
      family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } },
      onStage,
    },
  }); // 워밍업
  local.clear(); localCount.clear(); stack.length = 0;

  const t0 = performance.now();
  decodeFrontend(raster, {
    bootstrap: {
      family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } },
      onStage,
    },
  });
  const total = performance.now() - t0;

  const short = dump.name.replace('v0t-crop-20260817/KakaoTalk_20260817_', '').replace('.960.luma', '');
  const parts = [...local.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v.toFixed(0)}(${localCount.get(k)})`);
  console.log(`${short.padEnd(26)}${total.toFixed(0).padEnd(7)}| ${parts.join('  ')}`);
  for (const [k, v] of local) {
    totals.set(k, (totals.get(k) || 0) + v);
    counts.set(k, (counts.get(k) || 0) + localCount.get(k));
  }
  totals.set('__total', (totals.get('__total') || 0) + total);
}

console.log('\n=== 단계 총합 ===');
const all = totals.get('__total');
for (const [k, v] of [...totals.entries()].filter(([k]) => k !== '__total')
  .sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${v.toFixed(0).padStart(7)}ms  (${(100 * v / all).toFixed(0)}%)`
    + `  호출 ${counts.get(k)}회  평균 ${(v / counts.get(k)).toFixed(1)}ms`);
}
console.log(`  ${'(합계)'.padEnd(10)} ${all.toFixed(0).padStart(7)}ms`);
console.log('\n판독: 「호출 수 × 평균」 중 어느 쪽이 큰지가 처방을 가른다 —'
  + ' 호출이 많으면 후보 가지치기, 평균이 크면 그 단계 자체의 최적화(또는 WASM).');
