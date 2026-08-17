/** v0wy 복원 스위치 왕복 디버그 — 드랍 후 «no-format-candidate» 의 원인 규명. */
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { TL_READER_URL } from '../../../src/qr.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PAYLOAD = 'https://tl.estre.so';

// ppu 는 인자 (기본 10 — decode 테스트 조건. 블록 로케이터 스위트는 15 를 쓴다).
const PPU = Number(process.argv[2] || 10);
const encoded = encodeY(PAYLOAD, { cellSurfaceLayout: 'v0wy', version: 1, tones: 2, eccLevel: 'M' });
const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16, qrText: TL_READER_URL });
const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
console.log('ppu=' + PPU);

for (const [label, extra] of [
  ['복원 전체 (테스트 재현)', {
    includeDroppedCellSurfaceLayouts: true,
    calibration: { csBlockLocator: { v0xFamily: true, v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true } },
  }],
  ['v0wy 만 복원', {
    includeDroppedCellSurfaceLayouts: true,
    calibration: { csBlockLocator: { v0wyFamily: true } },
  }],
  ['v0wy 복원 + 신규 v0t 계열 끔', {
    includeDroppedCellSurfaceLayouts: true,
    calibration: { csBlockLocator: { v0wyFamily: true, v0tFamily: false, v0tyFamily: false } },
  }],
]) {
  const result = decodeFrontend(raster, {
    bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true, ...extra } } },
  });
  console.log('[' + label + '] ok=' + result.ok
    + (result.ok ? ' layout=' + result.hypothesis.cellSurfaceLayout : ' reason=' + result.reason));
  const geo = result.diagnostics && result.diagnostics.geometry;
  if (geo && geo.blockLocator) {
    console.log('  poseCount=' + JSON.stringify(geo.blockLocator.poseCount)
      + ' slotQr=' + JSON.stringify(geo.blockLocator.slotQr));
  }
}
