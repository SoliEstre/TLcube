/** 실제 3D mesh/raster를 만드는 합성 입력. 관측기에는 픽셀만 전달해요. */
import { encodeY } from '../../src/encodeY.js';
import { buildOrbitMesh } from '../../src/y3d-viewer.js';
import { layoutForCube } from '../../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { toRelativeLuminance } from '../../src/decoder/luma.js';

export function renderCubeY(text, options = {}) {
  const yawDeg = options.yawDeg ?? 0;
  const pitchDeg = options.pitchDeg ?? -20;
  const rollDeg = options.rollDeg ?? 0;
  const perspectiveDeg = options.perspectiveDeg ?? 9;
  const encoded = encodeY(text, { cellSurfaceLayout: 'v0tr', version: 2, tones: 3, eccLevel: 'H', maskIndex: 0 });
  const layout = layoutForCube(encoded.n, { size: 1, margin: 4 });
  const preset = getPreset(DEFAULT_PRESET);
  const mesh = buildOrbitMesh({ n: encoded.n, tones: encoded.tones, levels: preset.levels, layout,
    digitAt: (i, j) => encoded.cellDigits.get(`${i},${j}`)?.digit ?? null,
    levelAt: (i, j, face) => encoded.cellDigits.get(`${i},${j}`)?.tones?.[face] ?? null,
    yaw: yawDeg * Math.PI / 180, pitch: pitchDeg * Math.PI / 180, roll: rollDeg * Math.PI / 180,
    faces: 3, perspective: perspectiveDeg / 60 });
  const raster = rasterize({ width: layout.width, height: layout.height, background: preset.background,
    shapes: mesh.quads.map(quad => ({ kind: 'polygon', points: quad.points2d, color: quad.color })) },
  { pixelsPerUnit: 17, supersample: 2 });
  return { text, field: toRelativeLuminance({ width: raster.width, height: raster.height, pixels: raster.pixels }, {}) };
}
