import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CENTRAL_MARKER_N7_CODEBOOK,
  CENTRAL_MARKER_N7_FAMILIES,
  CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
  CENTRAL_MARKER_N7_SIZE,
  centralMarkerN7FamilyForType,
  centralMarkerN7SelectionAllowed,
  centralMarkerN7State,
  centralMarkerN7VisibleOnSurface,
  mapCentralMarkerGrid,
  sanitizeCentralMarkerN7FinderState,
} from '../src/centralMarkerN7.js';
import {
  FINDER_CARD_GROUPS, labOnlyFinderCardsVisible,
  labOnlyFinderSelectionAllowed, sanitizeFinderCardState,
} from '../src/finder-card-ui.js';
import {
  GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  GENERATOR_STATE_SCHEMA,
} from '../src/generator-state.js';
import { VERSIONS } from '../src/capacity.js';
import { VERSIONS_A } from '../src/capacityA.js';
import { VERSIONS_K } from '../src/capacityK.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
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

function centralSlotRadius(scene) {
  const center = axialToPixel(0, 0, scene.layout);
  const points = FINDER_CELL_ORDER.flatMap((cell) =>
    hexCorners(cell.q, cell.r, scene.layout));
  const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map((point) =>
    (point.x - center.x) * axis.x + (point.y - center.y) * axis.y)));
  return { center, radius: Math.min(...supports) };
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

test('값이 있다 — n=7·49셀·18상태와 family 대응이 코드북 한 곳에서 닫힌다', () => {
  assert.equal(CENTRAL_MARKER_N7_SIZE, 7);
  assert.deepEqual([...CENTRAL_MARKER_N7_FAMILIES], ['hex', 'tri', 'star']);
  assert.equal(CENTRAL_MARKER_N7_CODEBOOK.length, 18);
  assert.equal(new Set(CENTRAL_MARKER_N7_CODEBOOK.map(
    (state) => `${state.family}|${state.turn}|${state.parity}`,
  )).size, 18);
  for (const state of CENTRAL_MARKER_N7_CODEBOOK) {
    assert.equal(state.cells.length, 49);
    assert.equal(state.cells.filter((cell) => cell.role === 'pose').length, 12);
    assert.equal(state.cells.filter((cell) => cell.role === 'family').length, 37);
    for (const cell of state.cells) {
      for (const face of FACES) assert.ok(cell[face] === 0 || cell[face] === 2);
    }
  }
  assert.equal(centralMarkerN7FamilyForType('O'), 'hex');
  assert.equal(centralMarkerN7FamilyForType('G'), 'hex');
  assert.equal(centralMarkerN7FamilyForType('A'), 'tri');
  assert.equal(centralMarkerN7FamilyForType('K'), 'star');
});

test('값이 맞다 — 래스터 18상태의 49셀 face 톤이 코드북과 모두 같다', () => {
  let states = 0;
  let cells = 0;
  let faces = 0;
  for (const expected of CENTRAL_MARKER_N7_CODEBOOK) {
    const scene = buildScene({ k: 6, cellDigits: new Map() }, {
      palette: PALETTE,
      finderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
      centralMarkerN7Family: expected.family,
      centralMarkerN7Turn: expected.turn,
      centralMarkerN7Parity: expected.parity,
    });
    const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 3 });
    const slot = centralSlotRadius(scene);
    const markerLayout = {
      size: (slot.radius * centralBeaconGeometry().shrink) / CENTRAL_MARKER_N7_SIZE,
      originX: slot.center.x,
      originY: slot.center.y,
    };
    for (const cell of expected.cells) {
      for (const face of FACES) {
        let point = moduleCenter(face, cell.i, cell.j, markerLayout);
        if (expected.mirrored) point = { x: 2 * slot.center.x - point.x, y: point.y };
        assert.equal(
          nearestLevelAt(raster, point),
          cell[face],
          `${expected.family}/turn${expected.turn}/parity${expected.parity}`
            + ` (${cell.i},${cell.j}) ${face}`,
        );
        faces += 1;
      }
      cells += 1;
    }
    states += 1;
  }
  assert.equal(states, 18);
  assert.equal(cells, 18 * 49);
  assert.equal(faces, 18 * 49 * 3);
});

test('용량·formatIndex 무회귀 — O/A/K × 전 k × 전 ECC 27조합은 렌더 전후 불변', () => {
  const families = [
    { type: 'O', versions: VERSIONS, encoder: encode },
    { type: 'A', versions: VERSIONS_A, encoder: encodeA },
    { type: 'K', versions: VERSIONS_K, encoder: encodeK },
  ];
  let checked = 0;
  for (const { type, versions, encoder } of families) {
    for (const spec of versions) {
      for (const eccLevel of ['L', 'M', 'H']) {
        const options = { version: spec.version, eccLevel };
        const baseline = encoder('TL', options);
        const rendered = encoder('TL', options);
        const capacityBefore = JSON.stringify(rendered.capacity);
        const formatBefore = rendered.formatIndex ?? rendered.capacity.formatIndex;
        const digitsBefore = JSON.stringify([...rendered.cellDigits]);
        const scene = buildScene(rendered, {
          palette: PALETTE,
          margin: 20,
          finderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
          centralMarkerN7Family: centralMarkerN7FamilyForType(type),
        });
        assert.equal(JSON.stringify(rendered.capacity), capacityBefore, `${type}/k${spec.k}/${eccLevel}`);
        assert.equal(rendered.formatIndex ?? rendered.capacity.formatIndex, formatBefore,
          `${type}/k${spec.k}/${eccLevel} formatIndex`);
        assert.equal(JSON.stringify([...rendered.cellDigits]), digitsBefore,
          `${type}/k${spec.k}/${eccLevel} cellDigits`);
        assert.deepEqual(rendered.capacity, baseline.capacity,
          `${type}/k${spec.k}/${eccLevel} capacity`);
        assert.equal(
          rendered.formatIndex ?? rendered.capacity.formatIndex,
          baseline.formatIndex ?? baseline.capacity.formatIndex,
          `${type}/k${spec.k}/${eccLevel} baseline formatIndex`,
        );
        assert.equal(scene.finderPatternId, CENTRAL_MARKER_N7_FINDER_PATTERN_ID);
        checked += 1;
      }
    }
  }
  assert.equal(checked, 3 * 3 * 3);
});

test('드랍 2겹 차단과 저장 상태 복구 — 전 surface DOM 부재·선택 거부·기본값 복귀', () => {
  assert.equal(centralMarkerN7VisibleOnSurface(false), false);
  assert.equal(centralMarkerN7VisibleOnSurface(true), false);
  assert.equal(centralMarkerN7SelectionAllowed(CENTRAL_MARKER_N7_FINDER_PATTERN_ID, false), false);
  assert.equal(centralMarkerN7SelectionAllowed(CENTRAL_MARKER_N7_FINDER_PATTERN_ID, true), false);

  const unsafe = {
    finderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
    previousFinderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
    finderQrProfiles: Object.freeze({
      OA: Object.freeze({
        finderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
        previousFinderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
      }),
    }),
  };
  const safe = sanitizeCentralMarkerN7FinderState(
    unsafe, false, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  );
  assert.equal(safe.finderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID);
  assert.equal(safe.previousFinderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID);
  assert.equal(safe.finderQrProfiles.OA.finderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID);
  assert.equal(safe.finderQrProfiles.OA.previousFinderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID);
  assert.equal(sanitizeCentralMarkerN7FinderState(
    unsafe, true, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  ).finderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  '드랍 상태는 lab에서도 닫혀야 한다');

  assert.equal(labOnlyFinderCardsVisible(false), false);
  assert.equal(labOnlyFinderCardsVisible(true), true);
  assert.equal(labOnlyFinderSelectionAllowed(CENTRAL_MARKER_N7_FINDER_PATTERN_ID, false), false);
  assert.equal(labOnlyFinderSelectionAllowed(CENTRAL_MARKER_N7_FINDER_PATTERN_ID, true), false);
  for (const lab of [false, true]) assert.equal(sanitizeFinderCardState(
    unsafe, lab, GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  ).finderPatternId, GENERATOR_DEFAULT_FINDER_PATTERN_ID);
  assert.ok(FINDER_CARD_GROUPS.lab.every(
    (card) => card.id !== CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
  ));
  assert.ok(FINDER_CARD_GROUPS.formal.every(
    (card) => card.id !== CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
  ));
  assert.equal(GENERATOR_STATE_SCHEMA.finderPatternId.options
    .includes(CENTRAL_MARKER_N7_FINDER_PATTERN_ID), false);
});

test('아이콘 — 공용 n/셀 공급자는 n=7 49셀·n=13 169셀을 그린다', () => {
  const marker = centralMarkerN7State('hex', 0, 0);
  const markerByKey = new Map(marker.cells.map((cell) => [`${cell.i},${cell.j}`, cell]));
  const n7 = mapCentralMarkerGrid(7, (i, j) => markerByKey.get(`${i},${j}`));
  const n13 = mapCentralMarkerGrid(13, () => ({ T: 0, L: 1, R: 2 }));
  assert.equal(n7.length, 49);
  assert.equal(n13.length, 169);
});
