/**
 * claude-cellpx12-anomaly-poses.mjs — 12px×gamma 실패 6건의 pose 반사실.
 *
 * ① maximumPosesPerFamily 를 8 로 풀어 truncation 뒤에 숨은 pose 전체의 n·score 를
 *    노출하고, ② 같은 완화로 디코드가 살아나는지 재본다.
 * 결과(2026-08-16, acaeb0c): 6/6 여전히 실패. n=21 pose 는 존재하되 열등한 중심
 * 힛에서 나온 것뿐이라 정합 점수 0.51~0.55 (n=25 pose 0.83~0.86) — 즉 truncation 이
 * 아니라 «좋은 기하가 전부 n=25 로 스냅» 이 병목이다.
 *
 * 실행: node test/output/claude-cellpx12-anomaly-poses.mjs
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
      for (let k = 0; k < 4; k += 1) out.pixels[d + k] = raster.pixels[s + k];
    }
  }
  return out;
}

const LIFT = { calibration: { csBlockLocator: { maximumPosesPerFamily: 8 } } };
const rows = [];
for (const tones of [2, 3]) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v2r2', version: 1, tones, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  const embedded = embedSquare(rasterize(scene, { pixelsPerUnit: 12, supersample: 2 }));
  for (const deg of [0, 105, 240]) {
    const rotated = deg === 0 ? embedded : distortImage(embedded, { rotation: deg, fill: FILL });
    const image = applyGamma(rotated, 0.7);
    const luma = toRelativeLuminance(image);
    const det = detectCellSurfaceBlockShapes(luma, LIFT);
    const poses = det.shapes
      .filter((shape) => shape.blockLocator.family === 'v2r2')
      .map((shape) => ({ n: shape.estimatedN, score: Number(shape.score.toFixed(4)) }));
    const result = decodeFrontend(
      { width: image.width, height: image.height, pixels: image.pixels },
      {
        bootstrap: {
          family: {
            cube: { enableCellSurfaceY: true, enableLocatorY: true, ...LIFT },
          },
        },
      },
    );
    const ok = result.ok === true && result.text === PAYLOAD;
    const row = { cellPx: 12, tones, deg, channel: 'gamma0.7', poses, ok, reason: ok ? null : result.reason };
    rows.push(row);
    process.stderr.write(
      `t=${tones} ${deg}° poses=[${poses.map((p) => 'n' + p.n + '@' + p.score).join(', ')}] `
      + `decode(maxPoses=8)=${ok ? 'OK' : 'FAIL'}\n`,
    );
  }
}
writeFileSync(
  new URL('./claude-cellpx12-anomaly-poses.json', import.meta.url),
  JSON.stringify({ note: 'maximumPosesPerFamily=8 반사실', rows }, null, 2) + '\n',
);
process.stdout.write('written claude-cellpx12-anomaly-poses.json\n');
