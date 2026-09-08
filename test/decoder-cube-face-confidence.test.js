import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  faceGridLockF,
  measureFaceGridConfidence,
} from '../src/decoder/cube-face-confidence.js';
import { finalLayoutIdsForN } from '../src/cellSurfaceFinal.js';
import { createA3Adapters } from '../src/r2/adapter-locator.js';

function syntheticField(kind, ArrayType = Float32Array) {
  const width = 160;
  const height = 160;
  const values = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      values[y * width + x] = kind === 0
        ? (((Math.floor(x / 6) + Math.floor(y / 6)) & 1) ? 209 : 46)
        : Math.max(0, Math.min(255, Math.round(
          128 + 54 * Math.sin(x * 0.19) + 41 * Math.cos(y * 0.13),
        )));
    }
  }
  let data;
  if (ArrayType === Float32Array) data = Float32Array.from(values, (value) => value / 255);
  else if (ArrayType === Uint16Array) data = Uint16Array.from(values, (value) => value * 257);
  else data = Uint8Array.from(values);
  return { width, height, data };
}

function unitFaceHsFromSingleH(H, n) {
  const unit = Float64Array.from(H);
  unit[0] *= n; unit[1] *= n;
  unit[3] *= n; unit[4] *= n;
  unit[6] *= n; unit[7] *= n;
  return [Float64Array.from(unit), Float64Array.from(unit), Float64Array.from(unit)];
}

function actualA3F(field, H, n, timestamp) {
  const adapter = createA3Adapters({ params: { lockMarginMin: 0 } });
  adapter.installHomography(H, n, finalLayoutIdsForN(n)[0]);
  adapter.alignInto(field.data, field.width, field.height, timestamp, null,
    {}, {}, new Uint8Array(0), new Uint8Array(0));
  return adapter.stats.gridLockF;
}

function assertClose(actual, expected, label) {
  const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected}`);
}

function assertScaleClose(actual, expected, label) {
  const tolerance = 1e-7 * Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected}`);
}

test('single-H를 unit face-H 세 장으로 반복하면 실제 A3 F와 같다', () => {
  const cases = [
    { kind: 0, n: 13, H: new Float64Array([3, 0, 80, 0, 3, 80, 0, 0, 1]) },
    { kind: 1, n: 21, H: new Float64Array([2.7, 0.11, 80, -0.07, 2.8, 80, 0.0002, -0.0001, 1]) },
  ];
  for (const [index, entry] of cases.entries()) {
    const field = syntheticField(entry.kind);
    const measured = faceGridLockF(field, unitFaceHsFromSingleH(entry.H, entry.n), entry.n);
    assertClose(measured.F, actualA3F(field, entry.H, entry.n, index + 1), `case ${index}`);
    assert.ok(measured.groupCount > 0);
  }
});

test('고정 난수 8개 입력도 실제 A3 공식과 같다', () => {
  let state = 0x6d2b79f5;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = 0; index < 8; index += 1) {
    const width = 160;
    const height = 160;
    const data = new Float32Array(width * height);
    for (let pixel = 0; pixel < data.length; pixel += 1) data[pixel] = random();
    const field = { width, height, data };
    const n = index % 2 === 0 ? 13 : 21;
    const scale = n === 13 ? 3.4 : 2.7;
    const H = new Float64Array([
      scale, (random() - 0.5) * 0.2, 78 + random() * 4,
      (random() - 0.5) * 0.2, scale, 78 + random() * 4,
      (random() - 0.5) * 0.0003, (random() - 0.5) * 0.0003, 1,
    ]);
    const measured = faceGridLockF(field, unitFaceHsFromSingleH(H, n), n);
    assertClose(measured.F, actualA3F(field, H, n, index + 10), `random ${index}`);
  }
});

test('Float32/Uint8/Uint16 스케일이 같고 alpha를 읽지 않는다', () => {
  const n = 13;
  const H = new Float64Array([3, 0, 80, 0, 3, 80, 0, 0, 1]);
  const faceHs = unitFaceHsFromSingleH(H, n);
  const fields = [Float32Array, Uint8Array, Uint16Array].map((Type) => {
    const field = syntheticField(1, Type);
    Object.defineProperty(field, 'alpha', {
      get() { throw new Error('alpha를 읽으면 안 된다'); },
    });
    return field;
  });
  const results = fields.map((field) => faceGridLockF(field, faceHs, n));
  assert.equal(results[0].groupCount, results[1].groupCount);
  assert.equal(results[1].groupCount, results[2].groupCount);
  assertScaleClose(results[0].F, results[1].F, 'Float32 vs Uint8');
  assertScaleClose(results[1].F, results[2].F, 'Uint8 vs Uint16');
});

test('lineup 동점은 호출자 순서로 안정적이며 반환값과 입력은 호출별 소유된다', () => {
  const width = 256;
  const height = 256;
  const field = { width, height, data: new Float32Array(width * height).fill(0.5) };
  const H = new Float64Array([100, 0, 128, 0, 100, 128, 0, 0, 1]);
  const faceHs = [Float64Array.from(H), Float64Array.from(H), Float64Array.from(H)];
  const lineup = [21, 13, 25];
  const inputData = Float32Array.from(field.data);
  const inputHs = faceHs.map((matrix) => Float64Array.from(matrix));
  const first = measureFaceGridConfidence(field, faceHs, lineup);
  assert.deepEqual(first.measures.map((row) => row.n), lineup);
  assert.equal(first.diagnostics.best.n, 21);
  assert.equal(first.diagnostics.second.n, 13);
  assert.equal(first.diagnostics.margin, Infinity);
  assert.deepEqual(field.data, inputData);
  assert.deepEqual(faceHs, inputHs);
  first.measures[0].F = -1;
  first.diagnostics.best.F = -2;
  const second = measureFaceGridConfidence(field, faceHs, lineup);
  assert.equal(second.measures[0].F, 0);
  assert.equal(second.diagnostics.best.F, 0);
  assert.notStrictEqual(first.measures[0], second.measures[0]);
  assert.notStrictEqual(first.diagnostics.best, second.diagnostics.best);
});

test('유효하지 않은 field, face-H, n, lineup을 거부한다', () => {
  const field = syntheticField(0);
  const H = new Float64Array([1, 0, 80, 0, 1, 80, 0, 0, 1]);
  const faceHs = [Float64Array.from(H), Float64Array.from(H), Float64Array.from(H)];
  const invalidFields = [null, { width: 1, height: 2, data: new Float32Array(2) },
    { width: 2, height: 2, data: new Float64Array(4) }];
  for (const invalid of invalidFields) {
    assert.throws(() => faceGridLockF(invalid, faceHs, 13), TypeError);
  }
  assert.throws(() => faceGridLockF(field, faceHs.slice(0, 2), 13), TypeError);
  const nonfinite = faceHs.map((matrix) => Float64Array.from(matrix));
  nonfinite[1][4] = NaN;
  assert.throws(() => faceGridLockF(field, nonfinite, 13), TypeError);
  assert.throws(() => faceGridLockF(field, faceHs, 0), TypeError);
  assert.throws(() => faceGridLockF(field, faceHs, 1.5), TypeError);
  assert.throws(() => measureFaceGridConfidence(field, faceHs, []), TypeError);
  assert.throws(() => measureFaceGridConfidence(field, faceHs, [13, 13]), TypeError);
});

test('순수 confidence 절단면은 format/RS/R2/runtime과 선택 문턱을 담지 않는다', async () => {
  const source = await readFile(
    new URL('../src/decoder/cube-face-confidence.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /^import\s/m);
  const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(executable, /cellSurface|format|decode|session|runtime|gateF|lockMarginMin/i);
});
