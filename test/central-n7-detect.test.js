import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  detectCentralN7BlockShapes,
} from '../src/decoder/cellsurface-block-detect.js';
import {
  outerCellSizeFromCentralN7ModulePitch,
  readCentralN7Payload,
  unitCentralSlotRadius,
  verifyCentralN7LocatorTones,
} from '../src/decoder/central-beacon-adapt.js';
import {
  CENTRAL_N7_FINDER_PATTERN_ID,
  CENTRAL_N7_LOCATOR_CELLS,
  CENTRAL_N7_PATTERN_FAMILY_ID,
  CENTRAL_N7_SCHEMA_ID,
  CENTRAL_N7_SIZE,
} from '../src/centralN7Schema.js';
import { CENTRAL_MARKER_N7_FINDER_PATTERN_ID } from '../src/centralMarkerN7.js';
import { centralBeaconGeometry } from '../src/centralBeaconWire.js';
import {
  CORNER_UNIT_OFFSETS, axialToPixel, hexCorners,
} from '../src/hexgrid.js';
import { FINDER_CELL_ORDER } from '../src/finder-patterns.js';
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

function n7Geometry(scene, pixelsPerUnit) {
  const center = axialToPixel(0, 0, scene.layout);
  const points = FINDER_CELL_ORDER.flatMap((cell) =>
    hexCorners(cell.q, cell.r, scene.layout));
  const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map((point) =>
    (point.x - center.x) * axis.x + (point.y - center.y) * axis.y)));
  return {
    center: { x: center.x * pixelsPerUnit, y: center.y * pixelsPerUnit },
    modulePitch: Math.min(...supports) * centralBeaconGeometry().shrink
      / CENTRAL_N7_SIZE * pixelsPerUnit,
  };
}

function renderN7(encoded, family, pixelsPerUnit = 16) {
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: 20,
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    centralN7Family: family,
  });
  const raster = rasterize(scene, { pixelsPerUnit, supersample: 2 });
  return { scene, raster, luma: toRelativeLuminance(raster), ...n7Geometry(scene, pixelsPerUnit) };
}

function locatorToneField(flipped) {
  const width = 900;
  const height = 900;
  const data = new Float32Array(width * height).fill(0.5);
  const center = { x: width / 2, y: height / 2 };
  const modulePitch = 14;
  const layout = { size: modulePitch, originX: 0, originY: 0 };
  let index = 0;
  const occupied = new Set();
  for (const cell of CENTRAL_N7_LOCATOR_CELLS) {
    for (const face of ['T', 'L', 'R']) {
      const point = moduleCenter(face, cell.i, cell.j, layout);
      const x = Math.round(center.x + point.x);
      const y = Math.round(center.y + point.y);
      const key = x + ',' + y;
      assert.equal(occupied.has(key), false, '면 중심 표본이 겹치면 문턱 자가 무의미하다');
      occupied.add(key);
      const expected = cell[face] === 2 ? 0.9 : 0.1;
      data[y * width + x] = index < flipped ? 1 - expected : expected;
      index += 1;
    }
  }
  return { luma: { width, height, data, alpha: null }, center, modulePitch };
}

test('n=7 전용 블록 템플릿은 정본 shape와 19셀 payload를 함께 복원한다', () => {
  const frame = renderN7(encode('n7-block', { version: 1, centralN7: true }), 'hex');
  const detected = detectCentralN7BlockShapes(frame.luma, [{
    center: frame.center,
    modulePitch: frame.modulePitch,
    degrees: 0,
    outerFamily: 'hex',
    outerK: 8,
    outerCellSize: frame.scene.layout.size,
  }]);
  assert.equal(detected.shapes.length, 1);
  const shape = detected.shapes[0];
  assert.equal(shape.estimatedN, CENTRAL_N7_SIZE);
  assert.equal(shape.blockLocator.family, CENTRAL_N7_PATTERN_FAMILY_ID);
  assert.equal(shape.blockLocator.schemaId, CENTRAL_N7_SCHEMA_ID);

  const tone = verifyCentralN7LocatorTones(
    frame.luma, shape.center, shape.blockLocator.modulePitch,
    shape.blockLocator.rotationDegrees,
  );
  assert.equal(tone.pass, true);
  const payload = readCentralN7Payload(
    frame.luma, shape.center, shape.blockLocator.modulePitch,
    shape.blockLocator.rotationDegrees, tone,
  );
  assert.notEqual(payload, null);
  assert.equal(payload.family, 'hex');
  assert.ok(payload.levels[0] < payload.mid && payload.mid < payload.levels[2]);
  assert.equal(payload.normalization.source, 'locator-dark-light');
});

test('locator tone 수용 경계는 정확히 5/6이고 후보 B는 통과하지 않는다', () => {
  const atBoundary = locatorToneField(15);
  const boundaryVerdict = verifyCentralN7LocatorTones(
    atBoundary.luma, atBoundary.center, atBoundary.modulePitch, 0,
  );
  assert.equal(boundaryVerdict.agreement, 5 / 6);
  assert.equal(boundaryVerdict.pass, true);

  const belowBoundary = locatorToneField(16);
  const belowVerdict = verifyCentralN7LocatorTones(
    belowBoundary.luma, belowBoundary.center, belowBoundary.modulePitch, 0,
  );
  assert.equal(belowVerdict.agreement, 74 / 90);
  assert.equal(belowVerdict.pass, false);

  const encoded = encode('candidate-b', { version: 1 });
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: 20,
    finderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
    centralMarkerN7Family: 'hex',
  });
  const pixelsPerUnit = 16;
  const raster = rasterize(scene, { pixelsPerUnit, supersample: 2 });
  const geometry = n7Geometry(scene, pixelsPerUnit);
  const candidateVerdict = verifyCentralN7LocatorTones(
    toRelativeLuminance(raster), geometry.center, geometry.modulePitch, 0,
  );
  assert.equal(candidateVerdict.pass, false);
});

test('n=7 source size 역변환은 렌더 정방향 식의 항등이고 v0 상수를 빌리지 않는다', () => {
  for (const outerCellSize of [3, 7.5, 19]) {
    const modulePitch = outerCellSize * unitCentralSlotRadius()
      * centralBeaconGeometry().shrink / CENTRAL_N7_SIZE;
    assert.ok(Math.abs(
      outerCellSizeFromCentralN7ModulePitch(modulePitch) - outerCellSize,
    ) < 1e-12);
  }
});

test('합성 O/A/K 중앙 n=7은 codeword가 지정한 family로만 바깥 본문을 복호한다', {
  timeout: 120_000,
}, () => {
  const cases = [
    { family: 'hex', text: 'n7-O', encoded: encode('n7-O', { version: 1, centralN7: true }) },
    { family: 'tri', text: 'n7-A', encoded: encodeA('n7-A', { version: 0, centralN7: true }) },
    { family: 'star', text: 'n7-K', encoded: encodeK('n7-K', { version: 0, centralN7: true }) },
  ];
  for (const spec of cases) {
    const frame = renderN7(spec.encoded, spec.family);
    const result = decodeFrontend(frame.raster);
    assert.equal(result.ok, true, `${spec.family}: ${result.reason}`);
    assert.equal(result.text, spec.text, spec.family);
    assert.equal(result.family, spec.family, spec.family);
    assert.equal(result.hypothesis.finderPatternId, CENTRAL_N7_FINDER_PATTERN_ID, spec.family);
  }
});
