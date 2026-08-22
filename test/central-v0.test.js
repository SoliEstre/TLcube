import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CENTRAL_SLOT_CELL_COUNT, VERSIONS, capacityTable } from '../src/capacity.js';
import {
  CELL_SURFACE_FINAL_V0, CENTRAL_V0_SOURCE_N, centralV0FinderCells,
  locatorCellsCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
import { encodeCentralBeacon } from '../src/centralBeacon.js';
import { encode } from '../src/encode.js';
import {
  CENTRAL_V0_FINDER_PATTERN_ID, CENTER_QR_FINDER_PATTERN_ID,
  selectFinderPattern,
} from '../src/finder-selection.js';
import { CENTRAL_V0_FINDER_CARD } from '../src/finder-card-ui.js';
import { createGeneratorState, GENERATOR_DEFAULT_FINDER_PATTERN_ID } from '../src/generator-state.js';
import { FINDER_CELL_ORDER } from '../src/finder-patterns.js';
import {
  CORNER_UNIT_OFFSETS, FACES, axialToPixel, hexCorners,
} from '../src/hexgrid.js';
import { centralSlotCells, overheadBreakdown } from '../src/layout.js';
import { occupiedCells } from '../src/bullseye.js';
import { buildScene } from '../src/scene.js';
import { moduleQuad } from '../src/ygrid.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const PALETTE = Object.freeze({
  background: Object.freeze({ r: 3, g: 7, b: 11 }),
  levels: Object.freeze([
    Object.freeze({ r: 24, g: 36, b: 52 }),
    Object.freeze({ r: 92, g: 118, b: 151 }),
    Object.freeze({ r: 182, g: 204, b: 228 }),
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

function sceneFor(encoded, finderPatternId = CENTRAL_V0_FINDER_PATTERN_ID) {
  return buildScene(encoded, { palette: PALETTE, finderPatternId });
}

test('v0 정본 셀·톤을 중앙 19셀 외곽에서 유도한 닮음 좌표로 옮긴다', () => {
  const source = centralV0FinderCells();
  assert.strictEqual(source,
    locatorCellsCellSurfaceFinal(CENTRAL_V0_SOURCE_N, CELL_SURFACE_FINAL_V0),
    '중앙 v0가 정본 locatorCells의 같은 참조가 아니다');

  const encoded = encode('v0', { version: 1, eccLevel: 'M', centralV0: true });
  const scene = sceneFor(encoded);
  const n = CENTRAL_V0_SOURCE_N;
  const dataShapeCount = encoded.cellDigits.size * FACES.length;
  const finderShapes = scene.shapes.slice(dataShapeCount);
  assert.equal(finderShapes.length, n * n * FACES.length,
    '칠해지는 모듈 위치는 정본 n² 자리 전부여야 한다');

  const locatorByKey = new Map(source.map((cell) => [`${cell.i},${cell.j}`, cell]));
  const beacon = encodeCentralBeacon(encoded, CENTRAL_V0_FINDER_PATTERN_ID);
  const slot = centralSlotRadius(scene);
  const expectedLayout = {
    size: slot.radius / n,
    originX: slot.center.x,
    originY: slot.center.y,
  };
  let shapeIndex = 0;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const locator = locatorByKey.get(`${i},${j}`);
      for (const face of FACES) {
        const shape = finderShapes[shapeIndex];
        assert.equal(shape.kind, 'polygon');
        assert.deepEqual(shape.points, moduleQuad(face, i, j, expectedLayout),
          '좌표는 중앙 슬롯 반지름 / v0 정본 n 규칙에서만 나와야 한다');
        assert.ok(PALETTE.levels.includes(shape.color),
          '비컨 면 색이 palette.levels 밖이다');
        assert.notDeepEqual(shape.color, PALETTE.bullseyeLight,
          '파인더 축의 순백을 중앙 v0 면에 쓰면 안 된다');
        if (locator) {
          assert.strictEqual(shape.color, PALETTE.levels[locator[face]],
            'v0 locator 면 톤을 palette.levels 인덱스로 보존해야 한다');
        }
        shapeIndex += 1;
      }
    }
  }
  assert.equal(beacon.cellDigits.size, n * n);
});

test('중앙 슬롯 회계는 불스아이 정본 19셀을 재사용하고 O/G 용량·포맷은 그대로다', () => {
  const slot = centralSlotCells();
  assert.deepEqual(slot, occupiedCells(), '중앙 슬롯은 bullseye.occupiedCells에서 유도해야 한다');
  assert.equal(slot.length, CENTRAL_SLOT_CELL_COUNT);

  for (const spec of VERSIONS) {
    assert.equal(overheadBreakdown(spec.k).bullseye, slot.length,
      'capacity 생성원의 bullseye 항이 중앙 슬롯 수와 갈렸다');
  }
  assert.deepEqual(capacityTable('M').map((row) => row.overhead),
    VERSIONS.map((spec) => spec.overhead), '용량표가 VERSIONS 생성원을 따르지 않는다');

  for (const cornerMarker of [false, true]) {
    for (const version of VERSIONS.map((spec) => spec.version)) {
      const baseOptions = { version, eccLevel: 'M', cornerMarker };
      const legacy = encode('x', baseOptions);
      const central = encode('x', { ...baseOptions, centralV0: true });
      assert.deepEqual(central.capacity, legacy.capacity,
        '중앙 v0는 기존 중앙 슬롯 교체라 O/G 용량을 더 깎으면 안 된다');
      assert.deepEqual(central.formatDigits, legacy.formatDigits,
        'centralV0 때문에 formatIndex/포맷 워드가 바뀌면 안 된다');
      assert.deepEqual(central.cellDigits, legacy.cellDigits,
        '같은 중앙 슬롯을 쓰므로 데이터 좌표·digit이 바뀌면 안 된다');
      for (const cell of slot) {
        assert.equal(central.cellDigits.has(`${cell.q},${cell.r}`), false,
          '중앙 슬롯 셀이 payload에 남았다');
      }
    }
  }
});

test('중앙 슬롯 3자 중 둘을 켜는 모든 조합은 유도 매트릭스에서 거부된다', () => {
  const occupants = ['centerQr', 'daehanFinder', 'centralV0'];
  for (let left = 0; left < occupants.length; left += 1) {
    for (let right = left + 1; right < occupants.length; right += 1) {
      const options = { version: 1, eccLevel: 'M',
        [occupants[left]]: true, [occupants[right]]: true };
      assert.throws(() => encode('x', options), /중앙 슬롯/,
        occupants[left] + '+' + occupants[right] + '가 허용됐다');
    }
  }

  const encoded = encode('x', { version: 1, eccLevel: 'M', centralV0: true });
  assert.throws(() => buildScene({ ...encoded, centerQr: true }, {
    palette: PALETTE,
    finderPatternId: CENTRAL_V0_FINDER_PATTERN_ID,
    qrText: 'https://example.test',
  }), /중앙 슬롯 점유자는 하나/);
});

test('v0를 쓰지 않은 레거시 프레임 렌더·capacity는 명시 false와 바이트 동일하다', () => {
  for (const version of VERSIONS.map((spec) => spec.version)) {
    const omitted = encode('legacy', { version, eccLevel: 'M' });
    const explicit = encode('legacy', { version, eccLevel: 'M', centralV0: false });
    assert.equal(JSON.stringify(omitted.capacity), JSON.stringify(explicit.capacity));
    assert.equal(JSON.stringify(sceneFor(omitted, 'bullseye')),
      JSON.stringify(sceneFor(explicit, 'bullseye')),
      'centralV0=false가 레거시 scene 바이트를 바꿨다');
  }
});

test('생성기 카드는 O/G에 배선되고 중앙 QR과 한 슬롯을 공유한다 — 8개 언어', () => {
  assert.equal(CENTRAL_V0_FINDER_CARD.id, CENTRAL_V0_FINDER_PATTERN_ID);
  const state = createGeneratorState({ type: 'O', qrPosition: 'TL' });
  const selected = selectFinderPattern(
    state, CENTRAL_V0_FINDER_PATTERN_ID, 'O', GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  );
  assert.equal(selected.finderPatternId, CENTRAL_V0_FINDER_PATTERN_ID);
  assert.notEqual(selected.qrPosition, 'inner');
  const typeA = selectFinderPattern(
    state, CENTRAL_V0_FINDER_PATTERN_ID, 'A', GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  );
  assert.notEqual(typeA.finderPatternId, CENTRAL_V0_FINDER_PATTERN_ID,
    'Type A에 O/G 전용 중앙 v0가 남았다');

  assert.equal(INDEX.split('"g582":').length - 1, 8);
  assert.match(INDEX, /opts\.centralV0 = true/);
  assert.match(INDEX, /isCentralV0FinderPatternId\(generatorState\.finderPatternId\)/);
  assert.notEqual(CENTRAL_V0_FINDER_PATTERN_ID, CENTER_QR_FINDER_PATTERN_ID);
});
