// O-CM / A-CM / H2O 를 k(버전)별로 나란히 렌더한다 — 개념 차이를 눈으로 보기 위한 것.
//
// 세 줄이 «같은 것의 변형» 이 아님을 보이는 게 목적이다:
//   O-CM  : Type O(순수 육각)의 교대 코너 3곳 — 그 자리는 원래 전부 데이터 셀이다
//   A-CM  : Type A(삼각 확장부)의 교대 코너 3곳 — H2O 의 detector 18셀에서 유래
//   H2O   : 정본 후보 원형 — finderMode=central-finder · finderStarter=central-cube-3tone
//           즉 **파인더는 중앙 큐브**고 18셀은 그 옆의 보조(detector)다
import fs from 'node:fs';
import { encode } from '../../../src/encode.js';
import { encodeA } from '../../../src/encodeA.js';
import { buildScene } from '../../../src/scene.js';
import { rasterize } from '../../../src/raster.js';
import { rasterToPng } from '../../../src/png.js';
import { markerCellsA, h2oTonesByKeyA } from '../../../src/markerA.js';
import { markerCells as markerCellsO } from '../../../src/markerO.js';
import { axialToPixel } from '../../../src/hexgrid.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../../../src/luminance.js';

const OUT = new URL('./preview/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

const preset = getPreset(DEFAULT_PRESET);
const palette = {
  background: preset.background,
  levels: preset.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
};
const PPU = 16;
const TEXT = 'TLcube';

/**
 * 진단용 강조 — 마커 셀에 속한 폴리곤만 다른 색으로 칠한다.
 * ⚠ 제안이 아니라 «어디에 앉는가» 를 보이기 위한 오버레이다.
 */
function highlight(scene, cells, color) {
  const centres = cells.map((c) => axialToPixel(c.q, c.r, scene.layout));
  const near = (pts) => {
    let cx = 0; let cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;
    return centres.some((m) => Math.hypot(m.x - cx, m.y - cy) < scene.layout.size * 0.9);
  };
  for (const shape of scene.shapes) {
    if (shape.kind === 'polygon' && Array.isArray(shape.points) && shape.points.length === 4 && near(shape.points)) {
      shape.color = color;
    }
  }
  return scene;
}

const MARK = { r: 0xff, g: 0x5c, b: 0x3a };   // 진단 강조색 (제안 아님)

function write(name, scene, margin) {
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 3 });
  fs.writeFileSync(new URL(name + '.png', OUT), Buffer.from(rasterToPng(raster)));
  return { name, w: raster.width, h: raster.height };
}

/** H2O 원형 재구성: Type A + 중앙 3톤 큐브 파인더 + 18(+3)셀 정본 톤. */
function h2oScene(version) {
  const encoded = encodeA(TEXT, { version, eccLevel: 'M', cornerMarker: true });
  const tones = h2oTonesByKeyA(encoded.k);
  const cellDigits = new Map();
  for (const [kk, entry] of encoded.cellDigits) {
    const t = tones.get(kk);
    cellDigits.set(kk, t ? { ...entry, tones: t } : entry);
  }
  return buildScene({ ...encoded, cellDigits }, {
    palette, margin: 24, finderPatternId: 'central-cube-3tone',
  });
}

const rows = [];
for (const [rowName, make] of [
  ['O-CM', (v) => {
    const enc = encode(TEXT, { version: v + 1, eccLevel: 'M', cornerMarker: true });
    return buildScene(enc, { palette, margin: 12 });
  }],
  ['A-CM', (v) => {
    const enc = encodeA(TEXT, { version: v, eccLevel: 'M', cornerMarker: true });
    return buildScene(enc, { palette, margin: 24 });
  }],
  ['H2O', (v) => {
    const enc = encodeA(TEXT, { version: v, eccLevel: 'M', cornerMarker: true });
    return h2oScene(v);
  }],
]) {
  for (const v of [0, 1, 2]) {
    const k = [6, 8, 10][v];
    try {
      const info = write(rowName + '-now-k' + k, make(v));
      rows.push({ row: rowName, k, ...info });
      console.log('  ok  ' + rowName + ' k=' + k + '  ' + info.w + 'x' + info.h);
    } catch (err) {
      console.log('  ✖   ' + rowName + ' k=' + k + '  ' + err.message);
      rows.push({ row: rowName, k, error: err.message });
    }
  }
}

// 마커 셀 좌표를 함께 뽑는다 — 「어디에 앉는가」가 개념 차이의 핵심이다
console.log('\n마커 발자국 (반경 = hex 거리):');
for (const k of [6, 8, 10]) {
  const cells = markerCellsA(k);
  const radii = [...new Set(cells.map((c) => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r))))].sort((a, b) => a - b);
  console.log('  A-CM k=' + k + ' : ' + cells.length + '셀 · 반경 ' + radii.join(',') + ' (격자 반경 k=' + k + ')');
}
fs.writeFileSync(new URL('index.json', OUT), JSON.stringify(rows, null, 1));
console.log('\n산출: ' + OUT.pathname);
