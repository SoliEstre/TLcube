/**
 * claude-cellpx12-anomaly-nsnap.mjs — 블록 로케이터 n-스냅(21↔25) 전수 측정 + 반사실.
 *
 * 가설(phase 2 에서 유도): 12px×gamma0.7 실패는 assembleV2r2Poses 의
 * estimatedN = distance/u + 3.5 가 23(중간점)을 넘어 25 로 스냅 →
 * cellSurfaceOnly shape 은 candidateNs=[25] 로만 CS 평가 → n=25 locator 표의
 * B 블록이 딴 셀을 읽어 agreement 0.72~0.74 < 0.78 → below-agreement 전멸.
 *
 * 측정 A: 84 프레임(7 cellPx × 2톤 × 3회전 × 2채널) 전수에서
 *   detectCellSurfaceBlockShapes 의 shape n 분포와, verified 힛에서 재계산한
 *   raw estimatedN(중앙×코너 전 쌍)을 기록한다.
 * 측정 B(반사실): csBlockLocator:false 디코드 — gamma 채널에서 로케이터가
 *   유일한 생존 경로인지 확인한다.
 *
 * 실행: node test/output/claude-cellpx12-anomaly-nsnap.mjs
 */
import { writeFileSync } from 'node:fs';
import { encodeY } from '../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { toRelativeLuminance } from '../../src/decoder/luma.js';
import { detectCellSurfaceBlockShapes } from '../../src/decoder/cellsurface-block-detect.js';
import { distortImage, applyGamma } from '../harness/distort.mjs';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../src/luminance.js';

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
const CELL_PX = [9, 10, 11, 12, 13, 14, 15];
const TONES = [2, 3];
const ROTATIONS = [0, 105, 240];
const CHANNELS = ['clean', 'gamma0.7'];

function embedSquare(raster) {
  const side = 2 * Math.ceil(Math.hypot(raster.width, raster.height) / 2);
  const out = { width: side, height: side, pixels: new Uint8ClampedArray(side * side * 4) };
  for (let k = 0; k < side * side; k += 1) {
    out.pixels[k * 4] = FILL.r;
    out.pixels[k * 4 + 1] = FILL.g;
    out.pixels[k * 4 + 2] = FILL.b;
    out.pixels[k * 4 + 3] = 255;
  }
  const ox = Math.floor((side - raster.width) / 2);
  const oy = Math.floor((side - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * side + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

function render(tones, cellPx) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v2r2', version: 1, tones, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return embedSquare(rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 }));
}

function frameImage(tones, cellPx, deg, channel) {
  const embedded = render(tones, cellPx);
  const rotated = deg === 0 ? embedded : distortImage(embedded, { rotation: deg, fill: FILL });
  return channel === 'gamma0.7' ? applyGamma(rotated, 0.7) : rotated;
}

/** 진단 verified 힛(full-res 단위)에서 assembleV2r2Poses 의 raw estimatedN 재계산. */
function rawEstimates(verified) {
  const centres = verified.filter((hit) => hit.kind === 'v2r2-center').slice(0, 3);
  const corners = verified.filter((hit) => hit.kind === 'v2r2-corner').slice(0, 4);
  const pairs = [];
  for (const centre of centres) {
    for (const corner of corners) {
      const distance = Math.hypot(corner.x - centre.x, corner.y - centre.y);
      if (!(distance > 6 * centre.u)) continue;
      const estN = distance / Math.max(centre.u, 1e-9) + 3.5;
      let snap = null;
      for (const candidate of [21, 25]) {
        if (Math.abs(estN - candidate) <= 3.2
          && (snap === null || Math.abs(estN - candidate) < Math.abs(estN - snap))) {
          snap = candidate;
        }
      }
      pairs.push({
        estN: Number(estN.toFixed(3)),
        snap,
        u: Number(centre.u.toFixed(3)),
        distance: Number(distance.toFixed(2)),
        centreScore: centre.score,
      });
    }
  }
  return pairs;
}

const rows = [];
for (const cellPx of CELL_PX) {
  for (const tones of TONES) {
    for (const deg of ROTATIONS) {
      for (const channel of CHANNELS) {
        const image = frameImage(tones, cellPx, deg, channel);
        const luma = toRelativeLuminance(image);
        const det = detectCellSurfaceBlockShapes(luma);
        const shapes = det.shapes.map((shape) => ({
          family: shape.blockLocator.family,
          layoutId: shape.blockLocator.layoutId,
          n: shape.estimatedN,
          score: Number(shape.score.toFixed(4)),
        }));
        const pairs = rawEstimates(det.diagnostics.verified);
        const row = {
          cellPx,
          tones,
          deg,
          channel,
          canvas: image.width,
          dsFactor: det.diagnostics.downsampleFactor,
          effCellPx: Number((cellPx / det.diagnostics.downsampleFactor).toFixed(2)),
          shapes,
          v2r2ShapeNs: shapes.filter((s) => s.family === 'v2r2').map((s) => s.n),
          estNPairs: pairs,
          verifiedKinds: det.diagnostics.verified.reduce((acc, hit) => {
            acc[hit.kind] = (acc[hit.kind] || 0) + 1;
            return acc;
          }, {}),
        };
        rows.push(row);
        process.stderr.write(
          `c=${cellPx} t=${tones} ${deg}° ${channel} eff=${row.effCellPx} `
          + `v2r2Ns=[${row.v2r2ShapeNs}] estN=[${pairs.map((p) => p.estN).join(',')}]\n`,
        );
      }
    }
  }
}

// ── 반사실: csBlockLocator:false — gamma 에서 로케이터 없이는 사는가 ─────────
const COUNTERFACTUALS = [
  { cellPx: 12, tones: 3, deg: 0, channel: 'gamma0.7' },   // 실패 프레임
  { cellPx: 13, tones: 3, deg: 0, channel: 'gamma0.7' },   // 성공 프레임
  { cellPx: 15, tones: 3, deg: 0, channel: 'gamma0.7' },   // 성공 프레임
  { cellPx: 12, tones: 3, deg: 0, channel: 'clean' },      // 성공 프레임 (clean)
];
const counterfactuals = [];
for (const frame of COUNTERFACTUALS) {
  const image = frameImage(frame.tones, frame.cellPx, frame.deg, frame.channel);
  for (const blockLocator of [true, false]) {
    const result = decodeFrontend(
      { width: image.width, height: image.height, pixels: image.pixels },
      {
        bootstrap: {
          family: {
            cube: {
              enableCellSurfaceY: true,
              enableLocatorY: true,
              ...(blockLocator ? {} : { csBlockLocator: false }),
            },
          },
        },
      },
    );
    const ok = result.ok === true && result.text === PAYLOAD;
    counterfactuals.push({
      ...frame, csBlockLocator: blockLocator, ok, reason: ok ? null : result.reason,
    });
    process.stderr.write(
      `CF c=${frame.cellPx} ${frame.channel} blkLoc=${blockLocator} ok=${ok ? 'Y' : 'N'} ${ok ? '' : result.reason}\n`,
    );
  }
}

writeFileSync(
  new URL('./claude-cellpx12-anomaly-nsnap.json', import.meta.url),
  JSON.stringify({ payload: PAYLOAD, rows, counterfactuals }, null, 2) + '\n',
);
process.stdout.write('written claude-cellpx12-anomaly-nsnap.json\n');
