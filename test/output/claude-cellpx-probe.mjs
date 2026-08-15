/**
 * claude-cellpx-probe.mjs — 자 검증 프로브 (읽기 전용 벤치, 커밋 대상 아님).
 * cell_px(=pixelsPerUnit) 15 무왜곡에서 v0@13 · v1r2@21 · v2r2@21 3종 복호 재현.
 * 부수로 각 레이아웃/cell_px 조합의 캔버스 크기를 출력해 «통제 변수» 정합을 확인한다.
 */
import { encodeY } from '../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../src/sceneY.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PAYLOAD = 'https://tl.estre.so';
const TARGETS = [
  { layout: 'v0', version: 0, n: 13 },
  { layout: 'v1r2', version: 1, n: 21 },
  { layout: 'v2r2', version: 1, n: 21 },
];

function render(target, tones, cellPx, margin) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: target.layout, version: target.version, tones, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin });
  return rasterize(scene, { pixelsPerUnit: cellPx, supersample: 2 });
}

for (const margin of [4, 20]) {
  for (const target of TARGETS) {
    for (const tones of [2, 3]) {
      const raster = render(target, tones, 15, margin);
      const t0 = process.hrtime.bigint();
      const result = decodeFrontend(raster, {
        bootstrap: { family: { cube: { enableCellSurfaceY: true, enableLocatorY: true } } },
      });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log([
        'margin=' + margin,
        target.layout + '@' + target.n,
        't=' + tones,
        raster.width + 'x' + raster.height,
        (result.ok === true && result.text === PAYLOAD) ? 'OK' : 'FAIL',
        result.ok ? (result.hypothesis && result.hypothesis.cellSurfaceLayout) : (result.reason || ''),
        Math.round(ms) + 'ms',
      ].join(' | '));
    }
  }
}
