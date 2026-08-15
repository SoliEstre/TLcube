/**
 * _bench-v2r2-center.mjs — v2r2 중앙 교체 레인의 결정적 벤치 (임시 하네스, 커밋 대상 아님).
 *
 * 매트릭스: 톤 7종 × 물리 회전 7종 = 49 (claude-v1r2-revival.md §5 와 동일 조건).
 *   톤: none · sCurve 0.6/0.75/0.9 · gamma 0.7/0.6 · gamma0.7+sCurve0.6
 *   회전: 0 / 90 / 105 / 120 / 135 / 150 / 240°
 * 프레임: 960² · margin 4 · 배경 불투명 · ppu: n=13→17, n=21→15, n=25→12.
 * 결정성: RNG 없음 — 시간 측정만 벽시계.
 *
 * 사용: node test/output/_bench-v2r2-center.mjs [v0|v2r2@21|v2r2@25|v1r2] ...
 */

import { encodeY } from '../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../src/luminance.js';
import { toRelativeLuminance } from '../../src/decoder/luma.js';
import { detectCellSurfaceBlockShapes } from '../../src/decoder/cellsurface-block-detect.js';
import { distortImage } from '../harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PAYLOAD = 'https://tl.estre.so';

const TONES = [
  ['none', {}],
  ['sCurve0.6', { sCurve: 0.6 }],
  ['sCurve0.75', { sCurve: 0.75 }],
  ['sCurve0.9', { sCurve: 0.9 }],
  ['gamma0.7', { gamma: 0.7 }],
  ['gamma0.6', { gamma: 0.6 }],
  ['gamma0.7+sCurve0.6', { gamma: 0.7, sCurve: 0.6 }],
];
const ROTATIONS = [0, 90, 105, 120, 135, 150, 240];
const TONE_FILTER = process.env.BENCH_TONES ? process.env.BENCH_TONES.split('|') : null;

const TARGETS = {
  v0: { layout: 'v0', version: 0, ppu: 17 },
  'v2r2@21': { layout: 'v2r2', version: 1, ppu: 15 },
  'v2r2@25': { layout: 'v2r2', version: 2, ppu: 12 },
  v1r2: { layout: 'v1r2', version: 1, ppu: 15 },
  v0x: { layout: 'v0x', version: 1, ppu: 15 },
};

function renderFinal(layout, version, pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

function embed960(raster) {
  const W = 960;
  const H = 960;
  if (raster.width > W || raster.height > H) {
    throw new Error('raster ' + raster.width + 'x' + raster.height + ' 가 960² 를 넘는다');
  }
  const out = { width: W, height: H, pixels: new Uint8ClampedArray(W * H * 4) };
  for (let index = 0; index < W * H; index += 1) {
    out.pixels[index * 4] = FILL.r;
    out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b;
    out.pixels[index * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((H - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

function decodeLab(frame) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: {
      family: {
        cube: { enableLocatorY: true, enableCellSurfaceY: true },
      },
    },
  });
}

function median(list) {
  const sorted = list.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const requested = process.argv.slice(2);
const keys = requested.length > 0 ? requested : Object.keys(TARGETS);

for (const key of keys) {
  const target = TARGETS[key];
  if (!target) {
    console.error('알 수 없는 타깃: ' + key);
    process.exit(1);
  }
  const base = embed960(renderFinal(target.layout, target.version, target.ppu));
  let pass = 0;
  let total = 0;
  const times = [];
  const locatorTimes = [];
  const failures = [];
  const crossPicks = [];
  const slotViolations = [];
  for (const [toneName, toneOpts] of TONES) {
    if (TONE_FILTER && !TONE_FILTER.includes(toneName)) continue;
    let toneOk = 0;
    for (const rotation of ROTATIONS) {
      const frame = distortImage(base, { ...toneOpts, rotation, fill: FILL });
      const t0 = performance.now();
      const result = decodeLab(frame);
      const t1 = performance.now();
      times.push(t1 - t0);
      total += 1;
      const ok = result.ok === true && result.text === PAYLOAD;
      if (ok) {
        pass += 1;
        toneOk += 1;
        if (result.hypothesis.cellSurfaceLayout !== target.layout) {
          crossPicks.push(key + ' ' + toneName + ' rot' + rotation + ' → '
            + result.hypothesis.cellSurfaceLayout);
        }
        if (result.hypothesis.rotationDegrees !== 0) {
          slotViolations.push(key + ' ' + toneName + ' rot' + rotation
            + ' slot=' + result.hypothesis.rotationDegrees);
        }
      } else {
        failures.push(key + ' ' + toneName + ' rot' + rotation + ' : '
          + (result.reason || 'unknown'));
      }
      // 로케이터 단독 시간 (참고치).
      const luma = toRelativeLuminance(frame);
      const l0 = performance.now();
      detectCellSurfaceBlockShapes(luma);
      const l1 = performance.now();
      locatorTimes.push(l1 - l0);
    }
    console.log(key + ' ' + toneName + ': ' + toneOk + '/7');
  }
  console.log('== ' + key + ' 합계 ' + pass + '/' + total
    + ' | 복호 ms 중앙값 ' + median(times).toFixed(0)
    + ' 최소 ' + Math.min(...times).toFixed(0)
    + ' 최대 ' + Math.max(...times).toFixed(0)
    + ' | 로케이터 ms 중앙값 ' + median(locatorTimes).toFixed(0)
    + ' 범위 ' + Math.min(...locatorTimes).toFixed(0) + '~' + Math.max(...locatorTimes).toFixed(0));
  if (failures.length) console.log('   실패: ' + failures.join(' | '));
  if (crossPicks.length) console.log('   교차 선택: ' + crossPicks.join(' | '));
  if (slotViolations.length) console.log('   슬롯 이탈: ' + slotViolations.join(' | '));
}
