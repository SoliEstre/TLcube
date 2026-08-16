/**
 * claude-v0w2-f6.mjs — §26 F6 «rot0 슬롯 위반» 이 교차 누수와 **같은 기전인가** 판정.
 * 위반이 난 칸에서 자기 패밀리 포즈가 서 있는지, 그리고 봉합이 지표를 움직이는지.
 * 실행: node test/output/lanes/claude-v0w2-f6.mjs
 */
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../../src/luminance.js';
import { distortImage } from '../../harness/distort.mjs';
import { embed960 } from './claude-v0w2-leak.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = { background: PRESET.background, levels: PRESET.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT, faceGains: DEFAULT_FACE_GAINS };
const FILL = { ...PRESET.background, a: 255 };
const PAYLOAD = 'https://tl.estre.so';
const SEAL_OFF = { centreQrBullseyeVeto: false, centreQrRequireFinderContrast: false, centreBullseyeConfirmedPoses: false };
const frameOf = (layout) => embed960(rasterize(buildSceneY(encodeY(PAYLOAD, { cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M' }), { palette: PALETTE, margin: 4 }), { pixelsPerUnit: 15, supersample: 2 }));
const dec = (frame, cs) => decodeFrontend({ width: frame.width, height: frame.height, pixels: frame.pixels }, { bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true, calibration: { csBlockLocator: cs } } } } });

const TONES = [['clean', {}], ['sCurve0.6', { sCurve: 0.6 }], ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }]];
for (const layout of ['v0w', 'v0w2']) {
  const base = frameOf(layout);
  for (const [name, tone] of TONES) {
    const frame = distortImage(base, { ...tone, rotation: 0, fill: FILL });
    const luma = toRelativeLuminance(frame);
    const pre = detectCellSurfaceBlockShapes(luma, { calibration: { csBlockLocator: SEAL_OFF } });
    const post = detectCellSurfaceBlockShapes(luma, {});
    const rPre = dec(frame, SEAL_OFF);
    const rPost = dec(frame, {});
    const fmt = (r) => (r.ok ? `OK:${r.hypothesis.cellSurfaceLayout}:rot${r.hypothesis.rotationDegrees}${r.hypothesis.rotationDegrees !== 0 ? ' ★위반' : ''}` : `FAIL:${r.reason}`);
    console.log([
      layout.padEnd(5), name.padEnd(10),
      'pre poses', `${pre.diagnostics.poseCount[layout]}/wq${pre.diagnostics.poseCount.v0wq}`.padEnd(8), fmt(rPre).padEnd(28),
      '| post poses', `${post.diagnostics.poseCount[layout]}/wq${post.diagnostics.poseCount.v0wq}`.padEnd(8), fmt(rPost),
    ].join(' '));
  }
}
