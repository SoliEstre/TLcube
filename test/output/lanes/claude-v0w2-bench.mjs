/**
 * claude-v0w2-bench.mjs — **v0XQ 드랍의 시간 회수** 49-매트릭스 벤치.
 *
 * 재는 것: n=21 의 CS 평가 후보가 **4 → 3** 으로 줄고 로케이터 패밀리가 하나 꺼진
 * 만큼의 프레임 시간 회수. 재지 않는 것: 정확도(같은 표에서 복호 결과를 문자열로
 * 대조해 «안 움직였다» 를 증거로 남긴다).
 *
 * ── 이 하네스가 지키는 두 가지 (직전 레인 §26 P0 의 재발 방지) ───────────────
 *
 * ① **calibration 은 반드시 `bootstrap.family.cube.calibration` 중첩 경로**다.
 *    최상위 키로 넘기면 `decodeFrontend` 가 조용히 버린다 — 그러면 «편입 전» 팔이
 *    실제로는 편입 후와 같은 코드를 돌고, 표는 초록인 채 거짓말이 된다.
 *    아래 `decodeLab` 하나만 이 경로를 만들고, 모든 팔이 그 함수를 쓴다.
 *
 * ② **인접 교대 실행**만 신뢰한다 (이 머신 ±77 % 스윙 실증). 팔을 통째로 이어
 *    돌리지 않고, **같은 (타깃, 칸)** 안에서 팔을 연달아 돌린다. 그리고 칸마다
 *    팔 **순서를 뒤집어** 단조 드리프트(터보·써멀)를 상쇄한다. 통계는 중앙값이다.
 *
 * ── 팔 정의 (드랍 하나만 분리한다) ──────────────────────────────────────────
 *
 * | 팔 | CS 후보 (n=21) | 로케이터 v0xq | 뜻 |
 * |---|---|---|---|
 * | `shipped`  | 기본 라인업 = [v0x, v0w, v0wq] | off (기본) | 지금 출고되는 것 |
 * | `lineup3`  | **명시** [v0x, v0w, v0wq]      | off        | 드랍 **후** (대조 기준) |
 * | `lineup4`  | **명시** [v0x, v0xq, v0w, v0wq] | **on**    | 드랍 **전** |
 *
 * 왜 `includeDroppedCellSurfaceLayouts` 를 안 쓰나: 그 스위치는 v2r2·v1r2 까지
 * 함께 되살린다 (2026-08-16 드랍). 그러면 이 벤치가 **두 드랍의 합**을 재게 된다.
 * 후보 목록을 명시로 넘겨 **v0xq 한 항목만** 갈라 놓는다. `shipped` 팔은 그 명시
 * 목록이 기본 라인업과 같은 값을 낸다는 확인용이다 (n=21 프레임 한정 — n=13 은
 * 명시 목록이 비어 라인업과 갈리므로 이 벤치의 타깃에서 뺐다).
 *
 * 49-매트릭스: 톤 7종 × 물리 회전 7종. (직전 레인의 하네스는 repo 에 없어 여기서
 * 새로 정의한다 — 그래서 §1.3 의 절대값과는 직접 비교하지 않고, **이 스크립트가
 * 같은 프로세스에서 낸 팔 사이의 차이**만 결론으로 쓴다.)
 *
 * 실행: node test/output/lanes/claude-v0w2-bench.mjs [--targets v0x,v0w,v0wq,v0xq]
 */

import { performance } from 'node:perf_hooks';

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
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

/** 중앙 QR 슬롯이 있는 레이아웃은 qrText 가 필수다 (슬롯이 비면 sceneY 가 던진다). */
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
  const W = 960;
  const H = 960;
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

/** ⚠ P0 — calibration 은 이 함수 안에서만 만든다 (중첩 경로 고정). */
function decodeLab(frame, cube) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: {
      family: {
        cube: { enableLocatorY: true, enableCellSurfaceY: true, ...cube },
      },
    },
  });
}

const ARMS = Object.freeze({
  shipped: Object.freeze({}),
  lineup3: Object.freeze({
    cellSurfaceLayouts: ['v0x', 'v0w', 'v0wq'],
  }),
  lineup4: Object.freeze({
    cellSurfaceLayouts: ['v0x', 'v0xq', 'v0w', 'v0wq'],
    calibration: { csBlockLocator: { v0xqFamily: true } },
  }),
});

/** 49-매트릭스 — 톤 7 × 물리 회전 7. */
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
  return sorted.length % 2 === 1
    ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const sum = (values) => values.reduce((a, b) => a + b, 0);

function outcomeOf(result) {
  if (!result.ok) return 'FAIL:' + (result.reason || 'unknown');
  const layout = result.hypothesis && result.hypothesis.cellSurfaceLayout;
  return 'OK:' + layout + ':' + (result.text === PAYLOAD ? 'payload' : 'WRONGTEXT');
}

const argTargets = (() => {
  const flag = process.argv.indexOf('--targets');
  if (flag < 0) return ['v0x', 'v0w', 'v0wq', 'v0xq'];
  return process.argv[flag + 1].split(',').map((s) => s.trim()).filter(Boolean);
})();

const armNames = Object.keys(ARMS);
const report = {};

for (const target of argTargets) {
  const base = embed960(render(target, 15));
  const times = Object.fromEntries(armNames.map((name) => [name, []]));
  const outcomes = Object.fromEntries(armNames.map((name) => [name, []]));
  let cellIndex = 0;

  // 워밍업 — JIT·코드 캐시가 첫 칸에 몰리면 그 칸의 팔 하나만 비싸진다.
  {
    const warm = distortImage(base, { rotation: 0, fill: FILL });
    for (const name of armNames) decodeLab(warm, ARMS[name]);
  }

  for (const [toneName, tone] of TONES) {
    for (const rotation of ROTATIONS) {
      const frame = distortImage(base, { ...tone, rotation, fill: FILL });
      // **인접 교대** — 같은 칸 안에서 팔을 연달아 돌리되, 칸마다 순서를 **순환
      // 치환 + 반전**으로 돌려 6가지 순열을 고르게 쓴다. (앞선 판본은 순서를
      // 뒤집기만 해서 가운데 팔이 «항상 두 번째» 라는 특권 자리를 가졌다 —
      // 첫 실행이 비싼 이 머신에서 그것 자체가 팔 사이 편향이 된다.)
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

  // 로케이터 단독 — 같은 프레임(무왜곡)에서 v0xq 패밀리 on/off 의 블록 로케이터 시간.
  const luma = toRelativeLuminance(distortImage(base, { rotation: 0, fill: FILL }));
  const locator = { off: [], on: [] };
  for (let repeat = 0; repeat < 11; repeat += 1) {
    const pairOrder = repeat % 2 === 0 ? ['off', 'on'] : ['on', 'off'];
    for (const which of pairOrder) {
      const opts = which === 'on'
        ? { calibration: { csBlockLocator: { v0xqFamily: true } } }
        : {};
      const t0 = performance.now();
      detectCellSurfaceBlockShapes(luma, opts);
      locator[which].push(performance.now() - t0);
    }
  }

  report[target] = {
    perArm: Object.fromEntries(armNames.map((name) => [name, {
      medianMs: Number(median(times[name]).toFixed(1)),
      meanMs: Number((sum(times[name]) / times[name].length).toFixed(1)),
      totalMs: Number(sum(times[name]).toFixed(0)),
      decoded: outcomes[name].filter((line) => line.includes('→ OK:')).length,
      cells: outcomes[name].length,
    }])),
    // 칸별 짝 차이 — 같은 칸에서 lineup4 − lineup3 (ms). 인접 교대라 이 차이는
    // 머신 드리프트가 대부분 상쇄된 값이다. 중앙값이 결론이고 부호가 근거다.
    pairedDeltaMs: (() => {
      const deltas = times.lineup4.map((value, index) => value - times.lineup3[index]);
      return {
        medianMs: Number(median(deltas).toFixed(1)),
        positiveCells: deltas.filter((value) => value > 0).length,
        cells: deltas.length,
      };
    })(),
    outcomes,
    locatorMedianMs: {
      off: Number(median(locator.off).toFixed(2)),
      on: Number(median(locator.on).toFixed(2)),
    },
  };

  const arm3 = report[target].perArm.lineup3.medianMs;
  const arm4 = report[target].perArm.lineup4.medianMs;
  const shipped = report[target].perArm.shipped.medianMs;
  report[target].recovery = {
    // 드랍 전(lineup4) → 후(lineup3) 의 중앙값 회수율.
    medianPercent: Number((((arm4 - arm3) / arm4) * 100).toFixed(1)),
    totalPercent: Number(((
      (report[target].perArm.lineup4.totalMs - report[target].perArm.lineup3.totalMs)
      / report[target].perArm.lineup4.totalMs) * 100).toFixed(1)),
    shippedVsLineup3Ms: Number((shipped - arm3).toFixed(1)),
  };
  // 정확도 무회귀 — shipped 와 lineup3 은 문자열까지 같아야 한다 (n=21 타깃 한정).
  report[target].shippedEqualsLineup3 = JSON.stringify(outcomes.shipped)
    === JSON.stringify(outcomes.lineup3);
  report[target].lineup3EqualsLineup4 = JSON.stringify(outcomes.lineup3)
    === JSON.stringify(outcomes.lineup4);
}

console.log(JSON.stringify(report, null, 2));
