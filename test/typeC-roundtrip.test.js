/**
 * typeC-roundtrip.test.js — Type C 생성측 합성 자.
 *
 * C 전용 디코더가 생기기 전까지 인코드 → 회계·scan-order → scene → raster
 * 자체검증을 닫는다. GF(211) 단일 블록에 들어오지 않는 C1/C2 계열은 같은 자에서
 * 명시 거절을 잠그며, 다중 블록을 임의로 발명하지 않는다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { encode, chooseVersion } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { verifyRaster } from '../src/verify.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { FACES, axialToPixel, facePolygon } from '../src/hexgrid.js';
import { dataCellsInScanOrder } from '../src/layout.js';
import { notchCellsC, typeCReservedCells } from '../src/notchC.js';
import {
  VERSIONS_C, VERSIONS_C_DAEHAN, TYPE_C_RS_BLOCK_UNDEFINED_REASON,
} from '../src/capacityC.js';
import { TYPE_C_CM_UNSUPPORTED_REASON } from '../src/formatC.js';
import {
  daehanPatternId, daehanReservedCells, sagoaeCells,
} from '../src/finder-daehan.js';
import { decode as decodeFormat, ECC_LEVEL } from '../src/formatinfo.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const LEVELS = Object.freeze(['L', 'M', 'H']);
const PAYLOAD = 'TYPE-C 타입 C';
const TAEGEUK = 'oak-taegeuk-solo';

function formatInfoOf(encoded) {
  const reads = [0, 1, 2].map((replica) =>
    encoded.formatDigits.slice(replica * 5, replica * 5 + 5));
  return decodeFormat(reads);
}

function renderAndVerify(encoded, finderPatternId) {
  const scene = buildScene(encoded, {
    palette: PALETTE,
    ...(finderPatternId === undefined ? {} : { finderPatternId }),
  });
  const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
  const check = verifyRaster(raster, scene, encoded);
  assert.equal(check.ok, true,
    `${encoded.capacity.name}/${encoded.eccLevel}: ${check.matched}/${check.total}, minΔ=${check.minDelta}`);
  assert.equal(check.total, encoded.cellDigits.size);
  assert.deepEqual(check.mismatches, []);
  return { scene, raster };
}

function pixelHash(raster) {
  return createHash('sha256').update(Buffer.from(
    raster.pixels.buffer, raster.pixels.byteOffset, raster.pixels.byteLength,
  )).digest('hex');
}

describe('C0 × ECC L/M/H 생성·회계·자체검증', () => {
  for (const eccLevel of LEVELS) {
    test(`C0/${eccLevel}`, () => {
      const encoded = encode(PAYLOAD, { notchC: true, version: 0, eccLevel });
      assert.equal(encoded.notchC, true);
      assert.equal(encoded.k, 14);
      assert.equal(encoded.capacity.name, 'C0');
      assert.equal(encoded.capacity.formatIndex, 0);
      assert.equal(encoded.codewordSymbols.length, encoded.capacity.usedSymbols);

      const format = formatInfoOf(encoded);
      assert.equal(format.ok, true);
      assert.equal(format.version, 0);
      assert.equal(format.eccLevel, ECC_LEVEL[eccLevel]);

      const reserved = typeCReservedCells(encoded.k);
      assert.equal(dataCellsInScanOrder(encoded.k, reserved).length, encoded.capacity.dataCells);
      for (const cell of notchCellsC(encoded.k)) {
        assert.equal(encoded.cellDigits.has(`${cell.q},${cell.r}`), false);
      }
      assert.equal(encoded.cellDigits.get(`${encoded.k},0`)?.role, 'anchor');

      const { scene } = renderAndVerify(encoded, 'bullseye');
      assert.equal(scene.notchC, true);
      assert.equal(scene.shapes.length, 3 * encoded.cellDigits.size + 6);

      // 노치는 배경색 도형도 아닌 단순 부재다. 각 노치 면과 같은 폴리곤이 하나도 없다.
      const polygonKeys = new Set(
        scene.shapes.filter((shape) => shape.kind === 'polygon')
          .map((shape) => JSON.stringify(shape.points)),
      );
      for (const cell of notchCellsC(encoded.k)) {
        for (const face of FACES) {
          assert.equal(
            polygonKeys.has(JSON.stringify(facePolygon(cell.q, cell.r, face, scene.layout))),
            false,
          );
        }
      }

      // 중앙 파인더는 노치와 무관하게 axial 원점에 그대로 남는다.
      const center = axialToPixel(0, 0, scene.layout);
      for (const shape of scene.shapes.slice(-6)) {
        assert.equal(shape.kind, 'disc');
        assert.equal(shape.cx, center.x);
        assert.equal(shape.cy, center.y);
      }
    });
  }
});

describe('C0D × daehan/sagoae 합성', () => {
  for (const eccLevel of LEVELS) {
    test(`C0D/${eccLevel} 원자·분해 합성`, () => {
      const atomic = encode(PAYLOAD, {
        notchC: true, version: 0, eccLevel, daehanFinder: true,
      });
      const split = encode(PAYLOAD, {
        notchC: true, version: 0, eccLevel, sagoae: true,
      });
      assert.equal(atomic.capacity.name, 'C0D');
      assert.equal(atomic.capacity.formatIndex, 1);
      assert.equal(split.capacity.name, 'C0D');
      assert.equal(split.sagoae, true);
      assert.deepEqual(split.cellDigits, atomic.cellDigits);
      assert.deepEqual(split.formatDigits, atomic.formatDigits);

      const reserved = typeCReservedCells(atomic.k, daehanReservedCells(atomic.k));
      assert.equal(reserved.length, 68);
      assert.equal(dataCellsInScanOrder(atomic.k, reserved).length, atomic.capacity.dataCells);
      for (const cell of [...notchCellsC(atomic.k), ...sagoaeCells(atomic.k)]) {
        assert.equal(atomic.cellDigits.has(`${cell.q},${cell.r}`), false);
      }

      const atomicRender = renderAndVerify(atomic, daehanPatternId(atomic.k));
      const splitRender = renderAndVerify(split, TAEGEUK);
      assert.equal(atomicRender.scene.finderPatternId, daehanPatternId(atomic.k));
      assert.equal(splitRender.scene.finderPatternId, TAEGEUK);
      assert.equal(splitRender.scene.sagoae, true);
      assert.equal(pixelHash(splitRender.raster), pixelHash(atomicRender.raster));

      const format = formatInfoOf(atomic);
      assert.equal(format.ok, true);
      assert.equal(format.version, 1);
      assert.equal(format.eccLevel, ECC_LEVEL[eccLevel]);
    });
  }
});

test('C1/C2와 C1D/C2D는 전 ECC에서 같은 단일블록 사유로 거절된다', () => {
  for (const versions of [VERSIONS_C, VERSIONS_C_DAEHAN]) {
    const daehanFinder = versions === VERSIONS_C_DAEHAN;
    for (const spec of versions.filter((entry) => entry.version > 0)) {
      for (const eccLevel of LEVELS) {
        assert.throws(
          () => encode(PAYLOAD, {
            notchC: true, version: spec.version, eccLevel, daehanFinder,
          }),
          (error) => error instanceof RangeError
            && error.message.includes(TYPE_C_RS_BLOCK_UNDEFINED_REASON),
          `${spec.name}/${eccLevel}`,
        );
      }
    }
  }
  assert.throws(
    () => chooseVersion('x'.repeat(135), 'M', false, false, true),
    (error) => error instanceof RangeError
      && error.message.includes(TYPE_C_RS_BLOCK_UNDEFINED_REASON),
  );
  assert.throws(
    () => chooseVersion('x'.repeat(119), 'M', false, true, true),
    (error) => error instanceof RangeError
      && error.message.includes(TYPE_C_RS_BLOCK_UNDEFINED_REASON),
  );
});

test('CM × C는 자동·명시 버전 모두 표의 동일 사유로 거절된다', () => {
  for (const options of [
    { notchC: true, cornerMarker: true },
    { notchC: true, cornerMarker: true, version: 0 },
    { notchC: true, cornerMarker: true, daehanFinder: true },
  ]) {
    assert.throws(
      () => encode(PAYLOAD, options),
      (error) => error instanceof RangeError
        && error.message === TYPE_C_CM_UNSUPPORTED_REASON,
    );
  }
});

test('scene은 노치 셀이 되살아난 입력을 조용히 필터링하지 않는다', () => {
  const encoded = encode(PAYLOAD, { notchC: true, version: 0 });
  const cellDigits = new Map(encoded.cellDigits);
  const [cell] = notchCellsC(encoded.k);
  cellDigits.set(`${cell.q},${cell.r}`, { digit: 0, role: 'data' });
  assert.throws(
    () => buildScene({ ...encoded, cellDigits }, { palette: PALETTE, finderPatternId: 'bullseye' }),
    /Type C 노치 셀이 렌더 입력에 남았다/,
  );
});
