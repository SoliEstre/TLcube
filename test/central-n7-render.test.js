import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { ranksToDigit } from '../src/lehmer.js';
import {
  CENTRAL_N7_DATA_SCAN_ORDER,
  CENTRAL_N7_FINDER_PATTERN_ID,
  CENTRAL_N7_LOCATOR_CELLS,
  CENTRAL_N7_SIZE,
} from '../src/centralN7Schema.js';
import { decodeCentralN7 } from '../src/centralN7Codec.js';
import {
  CORNER_UNIT_OFFSETS, FACES, axialToPixel, hexCorners,
} from '../src/hexgrid.js';
import { FINDER_CELL_ORDER } from '../src/finder-patterns.js';
import { centralBeaconGeometry } from '../src/centralBeaconWire.js';
import { moduleCenter } from '../src/ygrid.js';

const PALETTE = Object.freeze({
  background: Object.freeze({ r: 248, g: 249, b: 251 }),
  levels: Object.freeze([
    Object.freeze({ r: 20, g: 28, b: 42 }),
    Object.freeze({ r: 96, g: 116, b: 145 }),
    Object.freeze({ r: 218, g: 228, b: 242 }),
  ]),
  bullseyeDark: Object.freeze({ r: 0, g: 0, b: 0 }),
  bullseyeLight: Object.freeze({ r: 255, g: 255, b: 255 }),
});

function centralN7Layout(scene) {
  const center = axialToPixel(0, 0, scene.layout);
  const points = FINDER_CELL_ORDER.flatMap((cell) =>
    hexCorners(cell.q, cell.r, scene.layout));
  const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map((point) =>
    (point.x - center.x) * axis.x + (point.y - center.y) * axis.y)));
  return {
    size: (Math.min(...supports) * centralBeaconGeometry().shrink) / CENTRAL_N7_SIZE,
    originX: center.x,
    originY: center.y,
  };
}

function nearestLevelAt(raster, point) {
  const x = Math.max(0, Math.min(raster.width - 1, Math.floor(point.x * raster.pixelsPerUnit)));
  const y = Math.max(0, Math.min(raster.height - 1, Math.floor(point.y * raster.pixelsPerUnit)));
  const offset = (y * raster.width + x) * 4;
  const rgb = [raster.pixels[offset], raster.pixels[offset + 1], raster.pixels[offset + 2]];
  const distances = PALETTE.levels.map((level) =>
    (rgb[0] - level.r) ** 2 + (rgb[1] - level.g) ** 2 + (rgb[2] - level.b) ** 2);
  return distances.indexOf(Math.min(...distances));
}

function readCellRanks(raster, cell, layout) {
  return Object.fromEntries(FACES.map((face) => [
    face,
    nearestLevelAt(raster, moduleCenter(face, cell.i, cell.j, layout)),
  ]));
}

test('중앙 n=7 렌더는 O/G/A/V/K 계열을 명시해 30 locator + 19 payload를 되읽는다', () => {
  const cases = [
    { type: 'O', family: 'hex', encoded: encode('N7-O', { version: 1, centralN7: true }) },
    { type: 'G', family: 'hex', encoded: encode('N7-G', { version: 1, cornerMarker: true, centralN7: true }) },
    { type: 'A', family: 'tri', encoded: encodeA('N7-A', { version: 0, centralN7: true }) },
    { type: 'V', family: 'tri', encoded: encodeA('N7-V', { version: 0, turnA: true, centralN7: true }) },
    { type: 'K', family: 'star', encoded: encodeK('N7-K', { version: 0, centralN7: true }) },
  ];

  for (const { type, family, encoded } of cases) {
    const scene = buildScene(encoded, {
      palette: PALETTE,
      margin: 20,
      finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
      centralN7Family: family,
    });
    const raster = rasterize(scene, { pixelsPerUnit: 16, supersample: 3 });
    const layout = centralN7Layout(scene);

    for (const cell of CENTRAL_N7_LOCATOR_CELLS) {
      assert.deepEqual(readCellRanks(raster, cell, layout),
        Object.fromEntries(FACES.map((face) => [face, cell[face]])),
        `${type} locator (${cell.i},${cell.j})`);
    }

    const digits = CENTRAL_N7_DATA_SCAN_ORDER.map((cell) =>
      ranksToDigit(readCellRanks(raster, cell, layout)));
    const decoded = decodeCentralN7(digits);
    assert.notEqual(decoded, null, type);
    assert.equal(decoded.family, family, type);
    assert.deepEqual(decoded.outerFormat, encoded.formatDigits.slice(0, 5), type);
    assert.equal(scene.finderPatternId, CENTRAL_N7_FINDER_PATTERN_ID, type);
  }
});
