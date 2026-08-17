/**
 * claude-cluster-equiv.mjs — 격자 군집화가 선형판과 **같은 결과**를 내는지 검산 + 속도.
 *
 * 최적화의 유일한 조건: 출력이 한 톨도 다르면 안 된다. 어제 실사진 A/B
 * (개선 13 · 회귀 0)가 선형판 출력 위에 서 있기 때문이다.
 *
 * 실사진 전부 + 합성 프레임 몇 장으로 두 판을 돌려 클러스터 배열을 통째로 비교한다.
 */

import { performance } from 'node:perf_hooks';
import {
  CS_BLOCK_LOCATOR_INTERNALS, UNVERIFIED_CS_BLOCK_LOCATOR,
} from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { downsampleLumaForSeed, otsuThreshold } from '../../../src/decoder/finder-seed.js';
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { listLumaDumps, readLumaDump } from '../../../tools/read-luma.mjs';
import { embed960 } from './claude-v0w2-leak.mjs';

const { scanConcentricCores, clusterCores, clusterCoresLinear } = CS_BLOCK_LOCATOR_INTERNALS;
const cfg = { ...UNVERIFIED_CS_BLOCK_LOCATOR };
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});

function synth(layout, ppu) {
  const encoded = encodeY('https://tl.estre.so', {
    cellSurfaceLayout: layout, version: layout === 'v0' ? 0 : 1, tones: 2, eccLevel: 'H',
  });
  return embed960(rasterize(buildSceneY(encoded, { palette: PALETTE, margin: 4 }), {
    pixelsPerUnit: ppu, supersample: 2,
  }));
}

const frames = [];
for (const dump of listLumaDumps().filter((d) => d.name.includes('20260817_23'))) {
  frames.push({ name: dump.name, luma: readLumaDump(dump.path) });
}
for (const ppu of [15, 11, 8, 6]) {
  for (const layout of ['v0t', 'v0']) {
    frames.push({ name: `합성 ${layout}@${ppu}`, luma: toRelativeLuminance(synth(layout, ppu), {}) });
  }
}

console.log(`프레임 ${frames.length}개\n`);
console.log('프레임                                  cores   선형ms   격자ms   배속   동일');
let mismatch = 0; let sumLin = 0; let sumGrid = 0;
for (const frame of frames) {
  const reduced = downsampleLumaForSeed(frame.luma, cfg.searchMaxSide);
  const cut = otsuThreshold(reduced.luma);
  const cores = scanConcentricCores(reduced.luma, cut, cfg);

  clusterCores(cores, cfg); clusterCoresLinear(cores, cfg); // 워밍업
  const t0 = performance.now();
  const lin = clusterCoresLinear(cores, cfg);
  const t1 = performance.now();
  const grid = clusterCores(cores, cfg);
  const t2 = performance.now();

  const same = JSON.stringify(lin) === JSON.stringify(grid);
  if (!same) mismatch += 1;
  sumLin += t1 - t0; sumGrid += t2 - t1;
  const short = frame.name.replace('v0t-crop-20260817/KakaoTalk_20260817_', 'crop ')
    .replace('v0t-20260817/KakaoTalk_20260817_', 'orig ');
  console.log(`${short.padEnd(40)}${String(cores.length).padEnd(8)}`
    + `${(t1 - t0).toFixed(0).padEnd(9)}${(t2 - t1).toFixed(0).padEnd(9)}`
    + `${((t1 - t0) / Math.max(t2 - t1, 1e-9)).toFixed(1).padEnd(7)}`
    + (same ? 'ok' : '★다름'));
  if (!same) {
    console.log(`   선형 ${lin.length}개 · 격자 ${grid.length}개`);
    for (let i = 0; i < Math.max(lin.length, grid.length) && i < 5; i += 1) {
      if (JSON.stringify(lin[i]) !== JSON.stringify(grid[i])) {
        console.log(`   [${i}] 선형 ${JSON.stringify(lin[i])}`);
        console.log(`   [${i}] 격자 ${JSON.stringify(grid[i])}`);
      }
    }
  }
}

console.log(`\n=== 결과 ===`);
console.log(`불일치 ${mismatch}/${frames.length} 프레임`
  + (mismatch === 0 ? '  → 등가 확인' : '  ★★ 등가 깨짐 — 이 최적화는 쓸 수 없다'));
console.log(`군집화 총합: 선형 ${sumLin.toFixed(0)}ms → 격자 ${sumGrid.toFixed(0)}ms`
  + `  (${(sumLin / Math.max(sumGrid, 1e-9)).toFixed(1)}× 빠름)`);
