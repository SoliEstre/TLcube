/**
 * probe-guide-prior.mjs — 가이드-사전 포즈의 **포획 봉투(capture envelope)** 실측.
 *
 * 무엇을 재나: 가이드에 정확히 맞춘 합성 렌더를 만들고, 배율·중심 오차를 넣은 뒤
 *   ① 포맷 CRC 까지 가는 범위 (1단계 관문)
 *   ② 본문 RS 까지 통과하는 범위 (최종 수용)
 * 를 각각 찾는다. 여기서 나온 수가 `src/scan-guide-prior.js` 사다리 간격의 근거다.
 *
 * ⚠ 프로브는 `tools/probes/` 에 둔다 — `test/output/` 에 두면 스위트가 매번 덮어써
 *   스냅샷이 부패한다 (2026-08-16 교훈, scanner-zoom.js 주석 참조).
 *
 * 실행: node tools/probes/probe-guide-prior.mjs
 */

import { performance } from 'node:perf_hooks';

import { encode } from '../../src/encode.js';
import { encodeA } from '../../src/encodeA.js';
import { encodeY } from '../../src/encodeY.js';
import { buildScene } from '../../src/scene.js';
import { buildSceneY } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../../src/luminance.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import {
  guidePriorPoses,
  jitterPoses,
  layoutCellPx,
  PRIOR_LAYOUTS,
  refineSeedsFrom,
} from '../../src/scan-guide-prior.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const FRAME_SIDE = 960;

function renderLayout(layoutId, text, cellPx) {
  if (layoutId.startsWith('O-')) {
    const version = { 'O-k6': 1, 'O-k8': 2, 'O-k10': 3 }[layoutId];
    const encoded = encode(text, { version, eccLevel: 'M' });
    const scene = buildScene(encoded, { palette: PALETTE, margin: 1 });
    return { scene, raster: rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }) };
  }
  if (layoutId.startsWith('A-')) {
    // Type A 는 0-베이스 버전(A0/A1/A2)이고, 삼각 패치가 육각 기본 margin 을 넘는다.
    const version = { 'A-k6': 0, 'A-k8': 1, 'A-k10': 2 }[layoutId];
    const encoded = encodeA(text, { version, eccLevel: 'M' });
    const scene = buildScene(encoded, { palette: PALETTE, margin: 26 });
    return { scene, raster: rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }) };
  }
  const version = { 'Y-n21': 1, 'Y-n25': 2 }[layoutId];
  const encoded = encodeY(text, { version, eccLevel: 'M', tones: 3 });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 1 });
  return { scene, raster: rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }) };
}

/**
 * 렌더 raster 를 FRAME_SIDE² 프레임에 넣는다. 코드 중심(scene.layout origin)이 프레임
 * 중심 + (dx,dy) 에 오도록, 그리고 배율 factor 를 곱해서 (배율 오차 주입).
 * 역매핑 + 이중선형 — 한 번만 리샘플한다.
 */
function placeInFrame(raster, scene, { dx = 0, dy = 0, factor = 1 } = {}) {
  const side = FRAME_SIDE;
  const pixels = new Uint8ClampedArray(side * side * 4);
  const ppu = raster.pixelsPerUnit;
  const originX = scene.layout.originX * ppu;
  const originY = scene.layout.originY * ppu;
  const cx = side / 2 + dx;
  const cy = side / 2 + dy;

  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      // frame → source: (x - cx)/factor + originX
      const sx = (x - cx) / factor + originX;
      const sy = (y - cy) / factor + originY;
      const offset = (y * side + x) * 4;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= raster.width || y0 + 1 >= raster.height) {
        pixels[offset] = FILL.r;
        pixels[offset + 1] = FILL.g;
        pixels[offset + 2] = FILL.b;
        pixels[offset + 3] = 255;
        continue;
      }
      const tx = sx - x0;
      const ty = sy - y0;
      for (let channel = 0; channel < 3; channel += 1) {
        const p00 = raster.pixels[(y0 * raster.width + x0) * 4 + channel];
        const p10 = raster.pixels[(y0 * raster.width + x0 + 1) * 4 + channel];
        const p01 = raster.pixels[((y0 + 1) * raster.width + x0) * 4 + channel];
        const p11 = raster.pixels[((y0 + 1) * raster.width + x0 + 1) * 4 + channel];
        pixels[offset + channel] = Math.round(
          p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty)
          + p01 * (1 - tx) * ty + p11 * tx * ty,
        );
      }
      pixels[offset + 3] = 255;
    }
  }
  return { width: side, height: side, pixels };
}

function attempt(frame, poses) {
  const t0 = performance.now();
  const result = decodeFrontend(
    { width: frame.width, height: frame.height, pixels: frame.pixels },
    { priorPoses: poses },
  );
  return { result, ms: performance.now() - t0 };
}

function admittedOf(result) {
  if (result.ok) {
    const prior = result.diagnostics && result.diagnostics.bootstrap
      && result.diagnostics.bootstrap.prior;
    return prior ? prior.admittedPoses : [];
  }
  const prior = result.detail && (result.detail.prior
    || (result.detail.cause && result.detail.cause.prior));
  return prior ? prior.admittedPoses : [];
}

const TEXT = 'tlcube guide prior';
const rows = [];

for (const layout of PRIOR_LAYOUTS) {
  const cellPx = layoutCellPx(layout, FRAME_SIDE);
  let render;
  try {
    render = renderLayout(layout.id, TEXT, cellPx);
  } catch (error) {
    rows.push({ layout: layout.id, cellPx, error: String(error && error.message) });
    continue;
  }

  const poses = guidePriorPoses({ frameSide: FRAME_SIDE, layouts: [layout.id] });
  // ① 완전 정렬
  const exact = placeInFrame(render.raster, render.scene);
  const base = attempt(exact, poses);

  /*
   * ② 배율 오차 스윕 — **1.0 양쪽을 전부 쓸어야 한다.**
   *
   * ⚠ 정정 (2026-08-16 적대 검증): 예전 사다리는 `[1 … 1.12]` 즉 **1.0 이상만** 있었는데
   *   보고서는 「배율 ±8%」 라고 대칭으로 요약했다. 재 보지 않은 쪽을 ± 로 적으면
   *   그것은 측정이 아니라 추정이다 — 실제로 − 측은 레이아웃마다 크게 다르다.
   */
  const scaleEnvelope = [];
  for (const factor of [
    0.88, 0.92, 0.95, 0.965, 0.98, 0.99, 0.995,
    1, 1.005, 1.01, 1.02, 1.03, 1.05, 1.08, 1.12,
  ]) {
    const frame = placeInFrame(render.raster, render.scene, { factor });
    const first = attempt(frame, poses);
    let stage = first.result.ok ? 'decoded' : (admittedOf(first.result).length > 0 ? 'format' : 'none');
    let refineMs = 0;
    if (!first.result.ok) {
      const seeds = admittedOf(first.result).slice(0, 2)
        .map((id) => poses.find((pose) => pose.id === id))
        .filter(Boolean);
      const refine = seeds.flatMap((pose) => jitterPoses(pose, { frameSide: FRAME_SIDE }));
      if (refine.length > 0) {
        const second = attempt(frame, refine);
        refineMs = second.ms;
        if (second.result.ok) stage = 'decoded-refined';
      }
    }
    scaleEnvelope.push({ factor, stage, ms: Math.round(first.ms), refineMs: Math.round(refineMs) });
  }

  // ③ 중심 오차 스윕 (px)
  const offsetEnvelope = [];
  for (const dx of [0, 2, 4, 6, 8, 12, 16, 24]) {
    const frame = placeInFrame(render.raster, render.scene, { dx });
    const first = attempt(frame, poses);
    let stage = first.result.ok ? 'decoded' : (admittedOf(first.result).length > 0 ? 'format' : 'none');
    if (!first.result.ok) {
      const seeds = admittedOf(first.result).slice(0, 2)
        .map((id) => poses.find((pose) => pose.id === id))
        .filter(Boolean);
      const refine = seeds.flatMap((pose) => jitterPoses(pose, { frameSide: FRAME_SIDE }));
      if (refine.length > 0 && attempt(frame, refine).result.ok) stage = 'decoded-refined';
    }
    offsetEnvelope.push({ dxPx: dx, dxCells: Number((dx / cellPx).toFixed(3)), stage });
  }

  /*
   * ④ **대각** 중심 오차 스윕 — 1단계 오프셋 사다리가 십자(cross)뿐이라 축과 대각의
   *   봉투가 다르다. 예전 프로브는 축만 재고 보고서는 그 수를 「중심 봉투」 라고 썼다
   *   (2026-08-16 적대 검증). 대각을 안 재면 「유지됨 ≡ 사전이 흡수 가능」 이라는
   *   anchor 톨러런스의 근거가 축 위에서만 성립한다는 사실이 안 보인다.
   */
  const diagonalEnvelope = [];
  for (const step of [0, 2, 3, 4, 5, 6, 8]) {
    const frame = placeInFrame(render.raster, render.scene, { dx: step, dy: step });
    const first = attempt(frame, poses);
    let stage = first.result.ok ? 'decoded' : (admittedOf(first.result).length > 0 ? 'format' : 'none');
    if (!first.result.ok) {
      const seeds = admittedOf(first.result).slice(0, 2)
        .map((id) => poses.find((pose) => pose.id === id))
        .filter(Boolean);
      const refine = seeds.flatMap((pose) => jitterPoses(pose, { frameSide: FRAME_SIDE }));
      if (refine.length > 0 && attempt(frame, refine).result.ok) stage = 'decoded-refined';
    }
    diagonalEnvelope.push({
      stepPx: step,
      radiusPx: Number((step * Math.SQRT2).toFixed(2)),
      radiusCells: Number(((step * Math.SQRT2) / cellPx).toFixed(3)),
      stage,
    });
  }

  rows.push({
    layout: layout.id,
    cellPx: Number(cellPx.toFixed(2)),
    poseCount: poses.length,
    exact: {
      ok: base.result.ok,
      reason: base.result.ok ? '' : base.result.reason,
      ms: Math.round(base.ms),
    },
    scaleEnvelope,
    offsetEnvelope,
    diagonalEnvelope,
  });
}

// 전체 8 레이아웃 동시 후보 (실제 스캐너가 던지는 수) 비용
const allPoses = guidePriorPoses({ frameSide: FRAME_SIDE });
const oRender = renderLayout('O-k6', TEXT, layoutCellPx(PRIOR_LAYOUTS[0], FRAME_SIDE));
const oFrame = placeInFrame(oRender.raster, oRender.scene);
const fullPass = attempt(oFrame, allPoses);
const blankFrame = {
  width: FRAME_SIDE,
  height: FRAME_SIDE,
  pixels: (() => {
    const p = new Uint8ClampedArray(FRAME_SIDE * FRAME_SIDE * 4);
    for (let i = 0; i < FRAME_SIDE * FRAME_SIDE; i += 1) {
      p[i * 4] = FILL.r; p[i * 4 + 1] = FILL.g; p[i * 4 + 2] = FILL.b; p[i * 4 + 3] = 255;
    }
    return p;
  })(),
};
const blankPass = attempt(blankFrame, allPoses);

/*
 * 배치 조기 종료의 이득 — **교대 측정**으로 잰다.
 *
 * ⚠ 정정 (2026-08-16 적대 검증): 예전 인용 「720 전량 877ms → 61ms (1/15)」 는 서로 다른
 *   부하 상태에서 잰 두 수를 나눈 것이었다. 절대 ms 는 부하에 2\~4× 흔들리므로,
 *   비율을 말하려면 **같은 프로세스에서 워밍업 뒤 번갈아** 재야 한다.
 */
function medianOf(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

const earlyMs = [];
const fullMs = [];
let fullEvaluated = 0;
for (let round = 0; round < 9; round += 1) {
  const early = attempt(oFrame, allPoses);
  const full = (() => {
    const t0 = performance.now();
    const result = decodeFrontend(
      { width: oFrame.width, height: oFrame.height, pixels: oFrame.pixels },
      /*
       * ⚠ 자 검증 (2026-08-16): `priorBatchSize` 는 **`options.bootstrap` 아래**로 넘겨야
       *   한다. 최상위에 주면 `decodeFrontend` 가 `options.bootstrap` 만 복사해 넘기므로
       *   **조용히 무시**되고 — 같은 경로를 두 번 재게 된다(그때 나온 «배수» 는 1.03 이었다).
       *   그래서 아래 `posesEvaluated` 로 «정말 720개를 봤는가» 를 함께 확인한다.
       */
      { priorPoses: allPoses, bootstrap: { priorBatchSize: allPoses.length } },
    );
    const prior = result.ok
      ? result.diagnostics.bootstrap.prior
      : (result.detail && result.detail.prior);
    fullEvaluated = prior ? prior.posesEvaluated : 0;
    return performance.now() - t0;
  })();
  if (round >= 2) { // 앞 두 라운드는 워밍업
    earlyMs.push(early.ms);
    fullMs.push(full);
  }
}
const earlyMedian = medianOf(earlyMs);
const fullMedian = medianOf(fullMs);

/*
 * 2단계(refine) 실비용 — **생산 경로와 같은 씨앗 수**로 잰다. 예전 인용 「2단계 24포즈
 * 190\~700ms」 는 상한(24)을 실제 후보 수로 착각한 것이다. 실패 프레임에서 1단계를
 * 통과하는 포즈는 보통 1\~2개라 후보가 6\~12개다.
 */
const refineSamples = [];
for (const factor of [1.03, 1.12, 0.95]) {
  const frame = placeInFrame(oRender.raster, oRender.scene, { factor });
  const first = attempt(frame, allPoses);
  if (first.result.ok) {
    refineSamples.push({ factor, note: '1단계에서 복호 — 2단계 없음' });
    continue;
  }
  const refine = refineSeedsFrom(allPoses, admittedOf(first.result), { frameSide: FRAME_SIDE });
  if (refine.length === 0) {
    refineSamples.push({ factor, admitted: admittedOf(first.result).length, refineCount: 0 });
    continue;
  }
  const second = attempt(frame, refine);
  refineSamples.push({
    factor,
    admitted: admittedOf(first.result).length,
    refineCount: refine.length,
    coarseMs: Math.round(first.ms),
    refineMs: Math.round(second.ms),
    ok: second.result.ok,
  });
}

console.log(JSON.stringify({
  frameSide: FRAME_SIDE,
  fullPoseCount: allPoses.length,
  fullPassMs: Math.round(fullPass.ms),
  fullPassOk: fullPass.result.ok,
  blankPassMs: Math.round(blankPass.ms),
  earlyExit: {
    rounds: earlyMs.length,
    earlyMedianMs: Number(earlyMedian.toFixed(1)),
    fullBatchMedianMs: Number(fullMedian.toFixed(1)),
    // 자 검증 — 720 이 아니면 위 배수는 «같은 경로 두 번» 이라는 뜻이다.
    fullPosesEvaluated: fullEvaluated,
    speedup: Number((fullMedian / earlyMedian).toFixed(2)),
  },
  refineSamples,
  rows,
}, null, 2));
