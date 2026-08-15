/**
 * claude-skew-route-census.mjs — 성공 프레임의 기하 경로·여유 센서스.
 *
 * 봉투를 «누가 지탱하는가»(실루엣 vs CS 블록 로케이터)와 «남은 여유»(RS corrected ·
 * geometryResidual · orientationMargin)를 대표점에서 기록한다. 2단계 후보의 근거용.
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { applySCurve, barrelDistortImage, cameraTiltImage } from '../../harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = {
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
};
const FILL = { ...PRESET.background, a: 255 };
const PAYLOAD = 'https://tl.estre.so';

function frame(layout, version, tones, ppu, theta, axis, k1, sCurve) {
  const encoded = encodeY(PAYLOAD, { cellSurfaceLayout: layout, version, tones, eccLevel: 'M' });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 20 });
  let raster = rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 });
  if (theta !== 0) raster = cameraTiltImage(raster, theta, { axis, fill: FILL });
  if (k1 !== 0) raster = barrelDistortImage(raster, { k1, fill: FILL });
  if (sCurve) raster = applySCurve(raster, 0.6);
  return raster;
}

const CASES = [
  ['v0', 0, 2, 15, 0, 'diagonal', 0, false],
  ['v0', 0, 2, 15, 30, 'diagonal', 0.1, true],
  ['v0', 0, 2, 15, 40, 'diagonal', 0.15, true],
  ['v0', 0, 2, 15, 50, 'diagonal', 0.15, true],
  ['v0', 0, 2, 10, 30, 'diagonal', 0.1, true],
  ['v0', 0, 2, 10, 40, 'diagonal', 0.15, true],
  ['v0', 0, 2, 10, 45, 'diagonal', 0.15, true],
  ['v0', 0, 3, 15, 30, 'diagonal', 0.1, true],
  ['v2r2', 1, 2, 15, 30, 'horizontal', 0.1, true],
  ['v2r2', 1, 2, 15, 40, 'horizontal', 0.15, true],
  ['v1r2', 1, 2, 15, 30, 'horizontal', 0.1, true],
  ['v1r2', 1, 2, 15, 40, 'horizontal', 0.15, true],
];

for (const [layout, version, tones, ppu, theta, axis, k1, sCurve] of CASES) {
  const raster = frame(layout, version, tones, ppu, theta, axis, k1, sCurve);
  const result = decodeFrontend(raster, {
    bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
  });
  const label = [layout, tones + 'T', ppu + 'px', theta + '°', axis, 'k1=' + k1, sCurve ? 'S0.6' : 'no-tone'].join(' ');
  if (!result.ok) {
    console.log(JSON.stringify({ label, ok: false, code: result.detail && result.detail.pipelineCode }));
    continue;
  }
  const h = result.hypothesis;
  console.log(JSON.stringify({
    label,
    ok: result.text === PAYLOAD,
    source: h.source,
    locatorRoute: h.locatorRoute,
    locatorPhase: h.locatorPhase,
    locatorProfile: h.locatorProfile,
    decodedLayout: h.cellSurfaceLayout,
    cellSurfaceScore: h.cellSurfaceScore,
    orientationMargin: h.orientationMargin,
    geometryResidual: h.geometryResidual,
    cellSizePx: h.cellSizePx && Number(h.cellSizePx.toFixed(2)),
    corrected: result.corrected,
    crsDistance: result.crsDistance,
    erasureFallback: result.diagnostics.erasureFallback || false,
  }));
}
