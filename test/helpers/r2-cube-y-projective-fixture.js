/** mesh 생성과 별도 화면 카메라 사영. 엔진에는 픽셀만 전달해요. */
import { encodeY } from '../../src/encodeY.js';
import { buildOrbitMesh } from '../../src/y3d-viewer.js';
import { layoutForCube } from '../../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { toRelativeLuminance } from '../../src/decoder/luma.js';

export const PROJECTIVE_TEXT = 'https://tl.estre.so/range-check';

const rad = (degrees) => degrees * Math.PI / 180;

export function renderProjectiveCubeY(options = {}) {
  const yaw = options.yaw ?? 0;
  const pitch = options.pitch ?? 0;
  const roll = options.roll ?? 0;
  const perspective = options.perspective ?? 0;
  const cameraYaw = options.cameraYaw ?? 0;
  const cameraPitch = options.cameraPitch ?? 0;
  const ppu = options.ppu ?? 17;
  const encoded = encodeY(PROJECTIVE_TEXT, {
    cellSurfaceLayout: 'v0tr', version: 2, tones: 3, eccLevel: 'H', maskIndex: 0,
  });
  const layout = layoutForCube(encoded.n, { size: 1, margin: 4 });
  const preset = getPreset(DEFAULT_PRESET);
  const mesh = buildOrbitMesh({
    n: encoded.n, tones: encoded.tones, levels: preset.levels, layout,
    digitAt: (i, j) => encoded.cellDigits.get(`${i},${j}`)?.digit ?? null,
    levelAt: (i, j, face) => encoded.cellDigits.get(`${i},${j}`)?.tones?.[face] ?? null,
    yaw: rad(yaw), pitch: rad(pitch), roll: rad(roll), faces: 3, perspective: perspective / 60,
  });
  function camera(point) {
    const x = point.x - layout.width / 2, y = point.y - layout.height / 2;
    const f = Math.max(layout.width, layout.height) * 2;
    const xx = Math.cos(rad(cameraYaw)) * x, z = -Math.sin(rad(cameraYaw)) * x;
    const yy = Math.cos(rad(cameraPitch)) * y - Math.sin(rad(cameraPitch)) * z;
    const zz = Math.sin(rad(cameraPitch)) * y + Math.cos(rad(cameraPitch)) * z;
    return { x: layout.width / 2 + xx * f / (f + zz), y: layout.height / 2 + yy * f / (f + zz) };
  }
  const shapes = mesh.quads.map((quad) => ({
    kind: 'polygon',
    points: quad.points2d.map((point) => camera(point)),
    color: quad.color,
  }));
  const raster = rasterize(
    { width: layout.width, height: layout.height, background: preset.background, shapes },
    { pixelsPerUnit: ppu, supersample: 2 },
  );
  return {
    text: PROJECTIVE_TEXT,
    field: toRelativeLuminance({ width: raster.width, height: raster.height, pixels: raster.pixels }, {}),
  };
}
