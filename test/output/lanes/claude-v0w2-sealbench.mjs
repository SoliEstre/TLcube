/**
 * claude-v0w2-sealbench.mjs — 봉합 **비용** 벤치 (과업 3 ②, 시간 축).
 *
 * ⚠ 이 머신은 인접 동일 실행에서 ±77 % 스윙한다 (§26 P0-3). 그래서:
 *   · 팔을 통째로 이어 돌리지 않고 **같은 (타깃, 칸) 안에서 인접 교대**한다.
 *   · 칸마다 팔 순서를 **순환 치환 + 반전**해 순열을 고르게 쓴다.
 *   · 통계는 **중앙값**이고, 결론은 **같은 칸 짝 차이**의 중앙값이다.
 *   · 워밍업 한 칸을 버린다 (JIT 이 첫 팔에 몰리지 않게).
 * ⚠ P0 — calibration 은 bootstrap.family.cube.calibration 중첩 경로.
 *
 * 실행: node test/output/lanes/claude-v0w2-sealbench.mjs
 */

import { performance } from 'node:perf_hooks';

import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { render, embed960, photoLike } from './claude-v0w2-leak.mjs';

const ARMS = Object.freeze({
  pre: {
    centreQrBullseyeVeto: false,
    centreQrRequireFinderContrast: false,
    centreBullseyeConfirmedPoses: false,
  },
  sealed: {},
});
const armNames = Object.keys(ARMS);

function decodeLab(frame, csBlockLocator) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: {
      family: {
        cube: {
          enableLocatorY: true, enableCellSurfaceY: true, calibration: { csBlockLocator },
        },
      },
    },
  });
}

const LADDER = Object.freeze([
  ['L0 clean', {}],
  ['L4 photo', { blur: 1.6, noise: 6, jpeg: 55 }],
  ['L7 photo+g0.7', { blur: 1.6, noise: 6, jpeg: 55, gamma: 0.7 }],
  ['L9 hard', { blur: 2.4, noise: 9, jpeg: 45 }],
]);
const ROTS = [0, 120];
const TARGETS = ['v0x', 'v0w', 'v0w2', 'v0wq'];

const median = (values) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const frameTimes = Object.fromEntries(armNames.map((name) => [name, []]));
const locatorTimes = Object.fromEntries(armNames.map((name) => [name, []]));
const paired = [];
const pairedLocator = [];

{
  const warm = photoLike(embed960(render('v0w', 15, 2)), { rotation: 0 });
  for (const name of armNames) decodeLab(warm, ARMS[name]);
}

let cellIndex = 0;
for (const target of TARGETS) {
  for (const tones of [2, 3]) {
    const base = embed960(render(target, 15, tones));
    for (const [, spec] of LADDER) {
      for (const rotation of ROTS) {
        const frame = photoLike(base, { ...spec, rotation });
        const luma = toRelativeLuminance(frame);
        const order = cellIndex % 2 === 0 ? armNames : [...armNames].reverse();
        const cellFrame = {};
        const cellLocator = {};
        for (const name of order) {
          const t0 = performance.now();
          decodeLab(frame, ARMS[name]);
          cellFrame[name] = performance.now() - t0;
          frameTimes[name].push(cellFrame[name]);
        }
        for (const name of [...order].reverse()) {
          const t0 = performance.now();
          detectCellSurfaceBlockShapes(luma, { calibration: { csBlockLocator: ARMS[name] } });
          cellLocator[name] = performance.now() - t0;
          locatorTimes[name].push(cellLocator[name]);
        }
        paired.push(cellFrame.sealed - cellFrame.pre);
        pairedLocator.push(cellLocator.sealed - cellLocator.pre);
        cellIndex += 1;
      }
    }
  }
}

const report = {
  cells: paired.length,
  frameMedianMs: Object.fromEntries(armNames.map((name) =>
    [name, Number(median(frameTimes[name]).toFixed(1))])),
  locatorMedianMs: Object.fromEntries(armNames.map((name) =>
    [name, Number(median(locatorTimes[name]).toFixed(2))])),
  // 같은 칸 짝 차이 (sealed − pre) — 머신 드리프트가 대부분 상쇄된 값.
  pairedFrameDeltaMs: {
    medianMs: Number(median(paired).toFixed(1)),
    positiveCells: paired.filter((value) => value > 0).length,
    cells: paired.length,
  },
  pairedLocatorDeltaMs: {
    medianMs: Number(median(pairedLocator).toFixed(2)),
    positiveCells: pairedLocator.filter((value) => value > 0).length,
    cells: pairedLocator.length,
  },
};
report.framePercent = Number(
  ((report.pairedFrameDeltaMs.medianMs / report.frameMedianMs.pre) * 100).toFixed(1),
);
report.locatorPercent = Number(
  ((report.pairedLocatorDeltaMs.medianMs / report.locatorMedianMs.pre) * 100).toFixed(1),
);
console.log(JSON.stringify(report, null, 1));
