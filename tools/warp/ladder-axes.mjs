// 왜곡 사다리 확장 — yaw · pitch · roll · 6면 축을 서로 독립적으로 측정한다.
//
// 기본 재료는 실측으로 확정된 cellSurfaceLayout v0 · 3톤 · ECC M이다.
// `--material=broken`은 기준선 게이트의 실효성을 검증하는 고의 오염 모드다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeY } from '../../src/encodeY.js';
import { buildOrbitMesh } from '../../src/y3d-viewer.js';
import { layoutForCube } from '../../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { rasterToPng } from '../../src/png.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';

const OUT = 'test/output/warp-ladder';
const PAYLOAD = 'https://tl.estre.so';
const PPU = 17;
const MARGIN = 4;
const DEG = Math.PI / 180;
const BROKEN = process.argv.includes('--material=broken');

const P = getPreset(DEFAULT_PRESET);
const encodeOptions = BROKEN
  ? { cellSurface: true, version: 1, tones: 3, eccLevel: 'M' }
  : { cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'M' };
const encoded = encodeY(PAYLOAD, encodeOptions);
const n = encoded.n;
const layout = layoutForCube(n, { size: 1, margin: MARGIN });
const digitAt = (i, j) => {
  const cell = encoded.cellDigits.get(`${i},${j}`);
  return cell ? cell.digit : null;
};
const levelAt = (i, j, face) => {
  const cell = encoded.cellDigits.get(`${i},${j}`);
  if (!cell || !cell.tones) return null;
  const level = cell.tones[face];
  return Number.isInteger(level) ? level : null;
};

const meshToScene = (mesh) => ({
  width: layout.width,
  height: layout.height,
  background: P.background,
  shapes: mesh.quads.map((quad) => ({
    kind: 'polygon', points: quad.points2d, color: quad.color,
  })),
});

function render(view) {
  const mesh = buildOrbitMesh({
    n, tones: encoded.tones, levels: P.levels, layout, digitAt, levelAt, ...view,
  });
  const raster = rasterize(meshToScene(mesh), { pixelsPerUnit: PPU, supersample: 2 });
  return { mesh, raster };
}

function judge(raster) {
  try {
    const decoded = decodeFrontend({
      width: raster.width, height: raster.height, pixels: raster.pixels,
    }, {});
    if (decoded && decoded.ok) {
      return String(decoded.text) === PAYLOAD ? 'ok' : `wrong(${String(decoded.text).length})`;
    }
    return String((decoded && (decoded.reason || decoded.code)) || 'fail');
  } catch (error) {
    return `throw:${error.message.slice(0, 30)}`;
  }
}

function visibleFaceIds(mesh) {
  return [...new Set(mesh.quads
    .filter((quad) => quad.kind === 'module' && quad.facing < 0)
    .map((quad) => `${quad.side}:${quad.face}`))].sort();
}

const neutral = Object.freeze({ perspective: 0, yaw: 0, pitch: 0, roll: 0, faces: 3 });
const axes = [
  {
    axis: 'yaw',
    values: [-30, -20, -10, 0, 10, 20, 30],
    view: (degrees) => ({ ...neutral, yaw: degrees * DEG }),
    tag: (degrees) => `yaw_${degrees < 0 ? 'm' : 'p'}${Math.abs(degrees)}`,
    unit: 'degree',
  },
  {
    axis: 'pitch',
    values: [-30, -20, -10, 0, 10, 20, 30],
    view: (degrees) => ({ ...neutral, pitch: degrees * DEG }),
    tag: (degrees) => `pitch_${degrees < 0 ? 'm' : 'p'}${Math.abs(degrees)}`,
    unit: 'degree',
  },
  {
    axis: 'roll',
    values: [0, 15, 30, 45],
    view: (degrees) => ({ ...neutral, roll: degrees * DEG }),
    tag: (degrees) => `roll_p${degrees}`,
    unit: 'degree',
  },
  {
    axis: 'faces',
    values: [3, 6],
    view: (faces) => ({ ...neutral, faces }),
    tag: (faces) => `faces_${faces}`,
    unit: 'count',
  },
];

// 🔴 축별 중립값을 각각 먼저 읽는다. 하나라도 실패하면 산출물을 만들지 않는다.
for (const spec of axes) {
  const gate = render(neutral);
  const verdict = judge(gate.raster);
  console.log(`기준선 (${spec.axis} 중립): ${verdict}`);
  if (verdict !== 'ok') {
    console.log(`❌ ${spec.axis} 기준선이 안 읽힌다 — 사다리를 만들지 않는다.`);
    process.exit(1);
  }
}

if (BROKEN) {
  throw new Error('깨진 재료가 기준선 게이트를 통과했다 — 게이트 회귀');
}

mkdirSync(OUT, { recursive: true });
const results = [];
for (const spec of axes) {
  const rows = [];
  console.log(`\n── ${spec.axis} 축 ──`);
  for (const value of spec.values) {
    const view = spec.view(value);
    const { mesh, raster } = render(view);
    const verdict = judge(raster);
    const visibleFaces = visibleFaceIds(mesh);
    const tag = `axis_${spec.tag(value)}`;
    writeFileSync(`${OUT}/${tag}.png`, Buffer.from(rasterToPng(raster)));
    writeFileSync(`${OUT}/${tag}.json`, JSON.stringify({
      axis: spec.axis,
      value,
      unit: spec.unit,
      view,
      n,
      ppu: PPU,
      payload: PAYLOAD,
      verdict,
      visibleFaceCount: visibleFaces.length,
      visibleFaces,
      size: { w: raster.width, h: raster.height },
      cells: mesh.quads.filter((quad) => quad.kind === 'module')
        .map((quad) => ({ face: quad.face, i: quad.i, j: quad.j, digit: quad.digit })),
    }, null, 1));
    rows.push({ value, unit: spec.unit, verdict, visibleFaceCount: visibleFaces.length, visibleFaces, tag });
    console.log(`  ${String(value).padStart(3)} ${spec.unit.padEnd(6)} → ${verdict} · 보이는 면 ${visibleFaces.length}`);
  }
  results.push({ axis: spec.axis, rows });
}

writeFileSync(`${OUT}/manifest-axes.json`, JSON.stringify({
  _note: '축별 독립 왜곡 사다리. 재료 = cellSurfaceLayout v0 · tones 3 · ECC M.',
  payload: PAYLOAD,
  n,
  ppu: PPU,
  margin: MARGIN,
  neutral,
  results,
}, null, 1));

console.log(`\n완료: ${results.reduce((sum, result) => sum + result.rows.length, 0)}칸`);
