/**
 * claude-v0w2-cost.mjs — **v0W2 편입 비용** 49-매트릭스 벤치 (인접 교대).
 *
 * 재는 것: n=21 CS 후보가 3 → 4 로 늘고 앵커드 패밀리가 하나 붙은 만큼의 프레임
 * 시간 증가. 재지 않는 것: 정확도(같은 표에서 결과 문자열을 대조해 «어디가
 * 움직였나» 를 증거로 남긴다 — v0W 약점 2칸 구제가 여기 그대로 보인다).
 *
 * ── 지키는 두 가지 (직전 레인 §26 P0 재발 방지) ──────────────────────────────
 * ① calibration 은 **`bootstrap.family.cube.calibration` 중첩 경로**로만 만든다.
 *    최상위 키로 넘기면 decodeFrontend 가 조용히 버려 «편입 전» 팔이 편입 후 코드를
 *    돌게 되고, 표는 초록인 채 거짓말이 된다. `decodeLab` 하나만 이 경로를 만든다.
 * ② **인접 교대 실행**만 신뢰한다 (이 머신 ±77 % 스윙 실증). 같은 (타깃, 칸) 안에서
 *    세 팔을 연달아 돌리고, 칸마다 순환 치환 + 반전으로 6가지 순열을 고르게 쓴다.
 *
 * ── 팔 정의 (v0W2 **하나만** 분리한다) ──────────────────────────────────────
 * | 팔 | n=21 CS 후보 | 로케이터 v0w2Family | 뜻 |
 * |---|---|---|---|
 * | `shipped` | 기본 라인업 | true (기본) | 지금 출고되는 것 |
 * | `after`   | **명시** [v0x,v0w,v0wq,v0w2] | true  | 편입 **후** |
 * | `before`  | **명시** [v0x,v0w,v0wq]      | false | 편입 **전** |
 *
 * 실행: node test/output/lanes/claude-v0w2-cost.mjs [--targets v0x,v0w,v0wq,v0w2]
 * src 무수정 · RNG 없음 · test/output/ 밖에 쓰지 않는다.
 */
import { performance } from 'node:perf_hooks';

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { TL_READER_URL } from '../../../src/qr.js';
import { distortImage } from '../../harness/distort.mjs';

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
const NEEDS_QR = new Set(['v0xq', 'v0wq']);

function render(layout, pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (NEEDS_QR.has(layout)) opts.qrText = TL_READER_URL;
  return rasterize(buildSceneY(encoded, opts), { pixelsPerUnit, supersample: 2 });
}

function embed960(raster) {
  const W = 960; const H = 960;
  const out = { width: W, height: H, pixels: new Uint8ClampedArray(W * H * 4) };
  for (let index = 0; index < W * H; index += 1) {
    out.pixels[index * 4] = FILL.r; out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b; out.pixels[index * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((H - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s]; out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2]; out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

/** ⚠ P0 — calibration 은 이 함수 안에서만 만든다 (중첩 경로 고정). */
function decodeLab(frame, cube) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: {
      family: { cube: { enableLocatorY: true, enableCellSurfaceY: true, ...cube } },
    },
  });
}

const ARMS = Object.freeze({
  shipped: Object.freeze({}),
  after: Object.freeze({ cellSurfaceLayouts: ['v0x', 'v0w', 'v0wq', 'v0w2'] }),
  before: Object.freeze({
    cellSurfaceLayouts: ['v0x', 'v0w', 'v0wq'],
    calibration: { csBlockLocator: { v0w2Family: false } },
  }),
});

const TONES = Object.freeze([
  ['clean', {}],
  ['sCurve0.6', { sCurve: 0.6 }],
  ['sCurve0.9', { sCurve: 0.9 }],
  ['gamma0.7', { gamma: 0.7 }],
  ['gamma0.6', { gamma: 0.6 }],
  ['gamma1.4', { gamma: 1.4 }],
  ['gamma0.7+sCurve0.6', { gamma: 0.7, sCurve: 0.6 }],
]);
const ROTATIONS = Object.freeze([0, 45, 90, 120, 135, 240, 315]);

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const sum = (values) => values.reduce((a, b) => a + b, 0);

function outcomeOf(result) {
  if (!result.ok) return 'FAIL:' + (result.reason || 'unknown');
  const layout = result.hypothesis && result.hypothesis.cellSurfaceLayout;
  return 'OK:' + layout + ':' + (result.text === PAYLOAD ? 'payload' : 'WRONGTEXT');
}

const argTargets = (() => {
  const flag = process.argv.indexOf('--targets');
  if (flag < 0) return ['v0x', 'v0w', 'v0wq', 'v0w2'];
  return process.argv[flag + 1].split(',').map((s) => s.trim()).filter(Boolean);
})();

const armNames = Object.keys(ARMS);
const report = {};

for (const target of argTargets) {
  const base = embed960(render(target, 15));
  const times = Object.fromEntries(armNames.map((name) => [name, []]));
  const outcomes = Object.fromEntries(armNames.map((name) => [name, []]));
  let cellIndex = 0;

  {
    const warm = distortImage(base, { rotation: 0, fill: FILL });
    for (const name of armNames) decodeLab(warm, ARMS[name]);
  }

  for (const [toneName, tone] of TONES) {
    for (const rotation of ROTATIONS) {
      const frame = distortImage(base, { ...tone, rotation, fill: FILL });
      const shift = cellIndex % armNames.length;
      const rotated = [...armNames.slice(shift), ...armNames.slice(0, shift)];
      const order = Math.floor(cellIndex / armNames.length) % 2 === 0
        ? rotated : [...rotated].reverse();
      for (const name of order) {
        const t0 = performance.now();
        const result = decodeLab(frame, ARMS[name]);
        const dt = performance.now() - t0;
        times[name].push(dt);
        outcomes[name].push(`${toneName}/rot${rotation} → ${outcomeOf(result)}`);
      }
      cellIndex += 1;
    }
  }

  // 로케이터 단독 — 같은 무왜곡 프레임에서 v0w2 패밀리 on/off (11회 인접 교대).
  const luma = toRelativeLuminance(distortImage(base, { rotation: 0, fill: FILL }));
  const locator = { off: [], on: [] };
  for (let repeat = 0; repeat < 11; repeat += 1) {
    const pairOrder = repeat % 2 === 0 ? ['off', 'on'] : ['on', 'off'];
    for (const which of pairOrder) {
      const opts = which === 'off'
        ? { calibration: { csBlockLocator: { v0w2Family: false } } }
        : {};
      const t0 = performance.now();
      detectCellSurfaceBlockShapes(luma, opts);
      locator[which].push(performance.now() - t0);
    }
  }

  const deltas = times.after.map((value, index) => value - times.before[index]);
  report[target] = {
    perArm: Object.fromEntries(armNames.map((name) => [name, {
      medianMs: Number(median(times[name]).toFixed(1)),
      totalMs: Number(sum(times[name]).toFixed(0)),
      decoded: outcomes[name].filter((line) => line.includes('→ OK:')).length,
      cells: outcomes[name].length,
    }])),
    pairedDeltaMs: {
      medianMs: Number(median(deltas).toFixed(1)),
      positiveCells: deltas.filter((value) => value > 0).length,
      cells: deltas.length,
    },
    costPercent: Number((((median(times.after) - median(times.before))
      / median(times.before)) * 100).toFixed(1)),
    locatorMedianMs: {
      off: Number(median(locator.off).toFixed(2)),
      on: Number(median(locator.on).toFixed(2)),
    },
    shippedEqualsAfter: JSON.stringify(outcomes.shipped) === JSON.stringify(outcomes.after),
    beforeEqualsAfter: JSON.stringify(outcomes.before) === JSON.stringify(outcomes.after),
    // 결과가 갈린 칸만 남긴다 — «편입이 어디를 바꿨나» 의 정본.
    changedCells: outcomes.after
      .map((line, index) => (line === outcomes.before[index]
        ? null : { cell: line.split(' → ')[0], before: outcomes.before[index].split(' → ')[1], after: line.split(' → ')[1] }))
      .filter(Boolean),
  };
}

console.log(JSON.stringify(report, null, 2));
