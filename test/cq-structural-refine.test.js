import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encode } from '../src/encode.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { observeCqQrGeometry } from '../src/decoder/cq-observe.js';
import {
  CQ_STRUCTURAL_REFINE_GRID,
  createCqStructuralRefineCursor,
} from '../src/decoder/cq-structural-refine.js';
import { buildScene } from '../src/scene.js';
import { R2_TYPE_C_PROFILE, TYPE_C_DATA_TONES } from '../src/r2/profiles/c.js';
import { readFormatC } from '../src/r2/adapter-c.js';

const preset = getPreset(DEFAULT_PRESET);
const palette = { background: preset.background, levels: preset.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT };

function cq2l() {
  const encoded = encode('cq-2-L', { version: 2, eccLevel: 'L', notchC: true, centerQr: true });
  const scene = buildScene(encoded, {
    palette, centerQr: true, qrText: 'HTTPS://TL.ESTRE.SO/', margin: 20,
  });
  const field = toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 12, supersample: 1 }));
  const geometry = [...observeCqQrGeometry(field)]
    .find(entry => entry.k === 18 && entry.qrCandidateIndex === 0 && entry.axisIndex === 0);
  assert.ok(geometry);
  const format = readFormatC(field, geometry.H, geometry.k);
  assert.equal(format.kind, 'read');
  assert.equal(format.layoutId, 'CQ2');
  const bound = R2_TYPE_C_PROFILE.bind({ profile: 'C', layoutId: format.layoutId,
    dimensionKind: 'radius-k', dimension: geometry.k, ecc: format.ecc,
    maskIndex: format.maskIndex, wire: format.wire, tones: TYPE_C_DATA_TONES,
    orientation: geometry.orientation, sourceIdentity: 'cq-refine-test' });
  assert.ok(bound);
  return { field, geometry, bound };
}

function drain(cursor, origin) {
  let resumes = 0;
  while (cursor.status.phase !== 'done') {
    const before = cursor.status.evaluations;
    const progress = cursor.resume(origin);
    resumes += 1;
    assert.equal(progress.evaluated, true);
    assert.equal(cursor.status.evaluations, before + 1,
      'resume 하나는 H 후보 하나의 전체-cell score만 평가해야 한다');
    assert.ok(resumes < 100);
  }
  assert.equal(resumes, 33);
  return cursor.takeForFrame(origin);
}

test('CQ2/L 구조 cursor는 private probe와 같은 33평가 H·점수를 만든다', () => {
  const { field, geometry, bound } = cq2l();
  const origin = { frameId: 'cq2-l', timestamp: 10, generation: 7,
    width: field.width, height: field.height };
  const cursor = createCqStructuralRefineCursor(field, geometry.H, bound.cellCoord, origin);
  const result = drain(cursor, origin);
  assert.deepEqual(result.params,
    { scaleX: 0.01, scaleY: 0, translateX: -1, translateY: 0 });
  assert.deepEqual(Array.from(result.H), [
    11.874571186181212, 0, 623.25,
    0, 12.074757962935136, 575.75,
    0, 0, 1,
  ]);
  assert.deepEqual(result.seedScore, {
    totalScore: 147.71465983986855, minMargin: 0,
    minPositiveMargin: 0.09122076630592346,
    tieCells: 111, invalidCells: 0, cellCount: 924,
  });
  assert.deepEqual(result.score, {
    totalScore: 168.65669997036457,
    minMargin: 0.18244153261184692,
    minPositiveMargin: 0.18244153261184692,
    tieCells: 0, invalidCells: 0, cellCount: 924,
  });
  assert.equal(result.evaluations, 33);
  assert.deepEqual(result.origin, origin);
  assert.equal(cursor.status.snapshotRetainedBytes, 0);
  const before = cursor.status.evaluations;
  assert.equal(cursor.resume(origin).state, 'done');
  assert.equal(cursor.status.evaluations, before);
  const callerCopy = result.H;
  callerCopy.fill(0);
  assert.equal(cursor.takeForFrame(origin).H[0], 11.874571186181212);
  // takeForFrame의 coarse H도 반환마다 독립 소유여야 해요. params/score/origin은
  // 이미 freeze된 평면을 그대로 공유해도 되지만 typed-array H는 caller가 쓸 수 있어요.
  const coarseBaseline = Array.from(result.coarse.H);
  const scoreBaseline = { ...result.score };
  result.H[0] = 12345;
  result.coarse.H[0] = 12345;
  const afterCallerMutation = cursor.takeForFrame(origin);
  assert.deepEqual(Array.from(afterCallerMutation.H), [
    11.874571186181212, 0, 623.25,
    0, 12.074757962935136, 575.75,
    0, 0, 1,
  ]);
  assert.deepEqual(Array.from(afterCallerMutation.coarse.H), coarseBaseline);
  assert.deepEqual(afterCallerMutation.score, scoreBaseline);
  assert.equal(afterCallerMutation.evaluations, 33);
  assert.equal(cursor.takeForFrame({ ...origin, frameId: 'later', timestamp: 11 }), null);
});

test('caller field·H·cellCoord 변경이 cursor snapshot으로 새지 않는다', () => {
  const reference = cq2l(), mutated = cq2l();
  const origin = { frameId: 3, timestamp: 3, generation: 1,
    width: reference.field.width, height: reference.field.height };
  const expected = drain(createCqStructuralRefineCursor(reference.field,
    reference.geometry.H, reference.bound.cellCoord, origin), origin);
  const cursor = createCqStructuralRefineCursor(mutated.field,
    mutated.geometry.H, mutated.bound.cellCoord, origin);
  mutated.field.data.fill(0);
  mutated.field.alpha?.fill(0);
  mutated.geometry.H.fill(0);
  mutated.bound.cellCoord.fill(0);
  assert.deepEqual(drain(cursor, origin), expected);
});

test('strict tie는 항등 H를 보존하고 origin lifecycle 위반은 snapshot을 폐기한다', () => {
  const field = { width: 120, height: 120, data: new Float32Array(120 * 120).fill(0.5) };
  const H = new Float64Array([10, 0, 60, 0, 10, 60, 0, 0, 1]);
  const cellCoord = new Int32Array([0, 0]);
  const origin = { frameId: 'flat', timestamp: 10, generation: 2, width: 120, height: 120 };
  const identity = drain(createCqStructuralRefineCursor(field, H, cellCoord, origin), origin);
  assert.deepEqual(identity.params, { scaleX: 0, scaleY: 0, translateX: 0, translateY: 0 });
  assert.deepEqual(Array.from(identity.H), Array.from(H));
  assert.equal(identity.score.totalScore, 0);
  assert.equal(identity.score.tieCells, 1);

  for (const [current, reason] of [
    [{ ...origin, width: 121 }, 'resize-or-generation'],
    [{ ...origin, generation: 3 }, 'resize-or-generation'],
    [{ ...origin, timestamp: 9 }, 'invalid-time'],
  ]) {
    const cursor = createCqStructuralRefineCursor(field, H, cellCoord, origin);
    assert.equal(cursor.resume(current).reason, reason);
    assert.equal(cursor.status.phase, 'discarded');
    assert.equal(cursor.status.snapshotRetainedBytes, 0);
  }
  const reset = createCqStructuralRefineCursor(field, H, cellCoord, origin);
  reset.reset();
  assert.equal(reset.status.disposalReason, 'reset');
  assert.throws(() => createCqStructuralRefineCursor(field, H, cellCoord,
    { ...origin, frameId: {} }), TypeError);
  assert.throws(() => createCqStructuralRefineCursor(field, H, cellCoord,
    { ...origin, generation: {} }), TypeError);
});

test('decoder 모듈은 grid sampler 외 R2·encoder·decode를 import하지 않는다', () => {
  const source = fs.readFileSync(new URL('../src/decoder/cq-structural-refine.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from ['"](.+)['"];$/gm)].map(match => match[1]);
  assert.deepEqual(imports, ['./grid-sample.js']);
  assert.ok(imports.every(specifier => !specifier.includes('/r2/')
    && !specifier.includes('encode') && !specifier.includes('decode')));
  assert.deepEqual(CQ_STRUCTURAL_REFINE_GRID.coordinateOrder,
    ['scaleX', 'scaleY', 'translateX', 'translateY']);
});
