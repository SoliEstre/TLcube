import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { syntheticC } from './r2-c-fixtures.js';
import { readLumaDump } from '../tools/read-luma.mjs';
import {
  centralN7CenterPriorSeeds,
  centralN7Finders,
  centralN7FindersFromShapes,
} from '../src/decoder/central-n7-observe.js';
import {
  createCentralN7BlockCursor,
  detectCentralN7BlockShapes,
} from '../src/decoder/cellsurface-block-detect.js';
import { createVerifiedCursorPrototypeV3 } from '../src/decoder/cs-verified-cursor-v3-prototype.js';
import { BEACON_CS_BLOCK_LOCATOR } from '../src/decoder/central-beacon-observation-shared.js';
import { resumeCursorWithinBudget } from '../src/r2/cursor-budget.js';

function originFor(field, frameId = 7) {
  return { frameId, timestamp: frameId, generation: 1, width: field.width, height: field.height };
}

function verifiedHits(field) {
  const origin = originFor(field, 0);
  const cursor = createVerifiedCursorPrototypeV3(field, origin, {
    calibration: { csBlockLocator: BEACON_CS_BLOCK_LOCATOR },
  });
  for (let calls = 0; calls < 1_000_000; calls += 1) {
    if (cursor.resume(origin).state === 'done') {
      const result = cursor.takeForFrame(origin);
      assert.ok(result);
      return result.verified;
    }
  }
  assert.fail('verified cursor가 제한 안에 끝나야 해요');
}

function complete(cursor, origin, unitsPerFrame) {
  let frames = 0;
  for (; frames < 1_000_000; frames += 1) {
    for (let unit = 0; unit < unitsPerFrame; unit += 1) {
      if (cursor.resume(origin).state === 'done') {
        return { result: cursor.takeForFrame(origin), frames: frames + 1, steps: cursor.status.steps };
      }
    }
  }
  assert.fail('n7 cursor가 제한 안에 끝나야 해요');
}

function actualCase(id, field) {
  const verified = verifiedHits(field);
  const seeds = centralN7CenterPriorSeeds(field, verified);
  return { id, field, verified, seeds, expected: detectCentralN7BlockShapes(field, seeds) };
}

let syntheticActual = null;
function getSyntheticActual() {
  if (!syntheticActual) syntheticActual = actualCase('synthetic-c0', syntheticC(0).field);
  return syntheticActual;
}

function assertFragmentationInvariant(spec) {
  const rows = [];
  for (const units of [1, 64, 4096]) {
    const origin = originFor(spec.field, units);
    const cursor = createCentralN7BlockCursor(spec.field, spec.seeds, origin);
    const completed = complete(cursor, origin, units);
    assert.deepStrictEqual(completed.result, spec.expected, `${spec.id}/U${units}`);
    rows.push({ units, frames: completed.frames, steps: completed.steps,
      maxUnitMs: cursor.status.maxUnitMs });
  }
  assert.equal(new Set(rows.map((row) => row.steps)).size, 1);
  return rows;
}

test('actual 합성 C0 seed의 sync 결과와 U1/64/4096 cursor 결과가 같다', { timeout: 20_000 }, () => {
  const spec = getSyntheticActual();
  assert.equal(spec.verified.length, 18);
  assert.equal(spec.seeds.length, 318);
  assertFragmentationInvariant(spec);
});

test('shape 후처리 helper는 기존 centralN7Finders의 순서·dedupe 결과와 같다', () => {
  const spec = getSyntheticActual();
  const expected = centralN7Finders(spec.field, spec.verified);
  const actual = centralN7FindersFromShapes(spec.field, spec.expected.shapes);
  assert.deepStrictEqual(actual, expected);
  assert.ok(actual.length > 0);
});

test('actual 실사진 c3-tl f0 seed의 sync 결과와 U1/64/4096 cursor 결과가 같다', {
  timeout: 20_000,
}, (context) => {
  const path = fileURLToPath(new URL('output/photos/luma/c3-tl/c3-tl.f0000.960.luma', import.meta.url));
  if (!existsSync(path)) { context.skip('로컬 luma dump 없음'); return; }
  const spec = actualCase('c3-tl-f0', readLumaDump(path));
  assert.ok(spec.verified.length > 0);
  assert.ok(spec.seeds.length > 0);
  assertFragmentationInvariant(spec);
});

test('완전 동점 seed도 전역 stable top-12의 입력 순서를 보존한다', () => {
  const spec = getSyntheticActual();
  const referenceShape = spec.expected.shapes[0];
  const base = {
    center: { ...referenceShape.center },
    modulePitch: referenceShape.blockLocator.modulePitch,
    degrees: referenceShape.blockLocator.rotationDegrees,
    outerFamily: 'hex',
    outerCellSize: referenceShape.blockLocator.seedCellSize,
  };
  const seeds = Array.from({ length: 14 }, (_, outerK) => ({ ...base,
    center: { ...base.center }, outerK }));
  const expected = detectCentralN7BlockShapes(spec.field, seeds);
  const origin = originFor(spec.field);
  const completed = complete(createCentralN7BlockCursor(spec.field, seeds, origin), origin, 64);
  assert.deepStrictEqual(completed.result, expected);
  assert.deepEqual(expected.shapes.map((shape) => shape.blockLocator.outerK),
    Array.from({ length: 12 }, (_, index) => index));
});

test('refinement 두 round의 갱신 base를 보존해 sync와 같은 pose를 만든다', () => {
  const spec = getSyntheticActual();
  const shape = spec.expected.shapes[0];
  const pitch = shape.blockLocator.modulePitch;
  const seed = {
    center: { x: shape.center.x + pitch * 0.1, y: shape.center.y - pitch * 0.1 },
    modulePitch: pitch * 0.92,
    degrees: shape.blockLocator.rotationDegrees - 4,
    outerFamily: 'hex', outerK: 14, outerCellSize: shape.blockLocator.seedCellSize,
  };
  const expected = detectCentralN7BlockShapes(spec.field, [seed]);
  assert.equal(expected.shapes.length, 1);
  assert.notDeepEqual(expected.shapes[0].center, seed.center);
  const finalPose = [expected.shapes[0].center.x, expected.shapes[0].center.y,
    expected.shapes[0].blockLocator.modulePitch,
    expected.shapes[0].blockLocator.rotationDegrees];
  const firstRoundPoses = [];
  for (const oy of [-0.5, 0, 0.5]) for (const ox of [-0.5, 0, 0.5]) {
    for (const scale of [0.96, 1, 1.04]) for (const angle of [-3, 0, 3]) {
      firstRoundPoses.push([
        seed.center.x + ox * seed.modulePitch,
        seed.center.y + oy * seed.modulePitch,
        seed.modulePitch * scale,
        seed.degrees + angle,
      ]);
    }
  }
  assert.equal(firstRoundPoses.some((pose) => pose.every((value, index) => value === finalPose[index])),
    false, '최종 pose가 1차 grid 밖이어야 2차 round base 변이가 검출돼요');
  const origin = originFor(spec.field);
  const completed = complete(createCentralN7BlockCursor(spec.field, [seed], origin), origin, 1);
  assert.deepStrictEqual(completed.result, expected);
});

test('생성 뒤 caller luma/seed 변경은 snapshot 결과를 바꾸지 않는다', () => {
  const spec = getSyntheticActual();
  const field = { width: spec.field.width, height: spec.field.height,
    data: spec.field.data.slice(), alpha: null };
  const seeds = spec.seeds.map((seed) => ({ ...seed, center: { ...seed.center } }));
  const expected = detectCentralN7BlockShapes(field, seeds);
  const origin = originFor(field);
  const cursor = createCentralN7BlockCursor(field, seeds, origin);
  field.data.fill(0);
  seeds[0].center.x += 10_000;
  seeds.length = 1;
  const completed = complete(cursor, origin, 4096);
  assert.deepStrictEqual(completed.result, expected);
  assert.ok(cursor.status.copyMs >= 0);
  assert.equal(cursor.status.snapshotBytes, field.data.byteLength);
});

test('0 budget·epoch 폐기·terminal 무재실행 계약을 지킨다', () => {
  const spec = getSyntheticActual();
  const origin = originFor(spec.field);
  const zero = createCentralN7BlockCursor(spec.field, spec.seeds.slice(0, 1), origin);
  const batch = resumeCursorWithinBudget(zero, origin, { budgetMs: 0 });
  assert.equal(batch.steps, 0);
  assert.equal(zero.status.steps, 0);
  assert.equal(zero.status.phase, 'expand');

  const discarded = createCentralN7BlockCursor(spec.field, spec.seeds.slice(0, 1), origin);
  assert.equal(discarded.resume({ ...origin, generation: 2 }).state, 'discarded');
  assert.equal(discarded.status.disposalReason, 'resize-or-generation');
  assert.equal(discarded.takeForFrame(origin), null);

  const terminal = createCentralN7BlockCursor(spec.field, spec.seeds.slice(0, 1), origin);
  complete(terminal, origin, 4096);
  const before = terminal.status.steps;
  assert.equal(terminal.resume(origin).state, 'done');
  assert.equal(terminal.status.steps, before);
  assert.equal(terminal.takeForFrame({ ...origin, frameId: 8 }), null);
  assert.equal(terminal.status.phase, 'done');
  assert.equal(terminal.status.snapshotRetainedBytes, 0);
});

test('입력 타입·frameId를 엄격히 검사하고 resume 시간은 단조 증가한다', () => {
  const spec = getSyntheticActual();
  const origin = originFor(spec.field);
  assert.throws(() => createCentralN7BlockCursor(
    { ...spec.field, data: Array.from(spec.field.data) }, [], origin,
  ), TypeError);
  assert.throws(() => createCentralN7BlockCursor(spec.field, [], { ...origin, frameId: {} }),
    TypeError);
  assert.throws(() => createCentralN7BlockCursor(
    { ...spec.field, alpha: new Float32Array(spec.field.data.length) }, [], origin,
  ), TypeError);

  const empty = createCentralN7BlockCursor(spec.field, [], origin);
  assert.equal(empty.status.snapshotBytes,
    spec.field.data.byteLength + (spec.field.alpha?.byteLength ?? 0));
  assert.equal(empty.status.snapshotRetainedBytes, 0);

  const discarded = createCentralN7BlockCursor(spec.field, spec.seeds.slice(0, 1), origin);
  assert.notEqual(discarded.resume({ ...origin, frameId: 'same', timestamp: 10 }).state, 'discarded');
  assert.notEqual(discarded.resume({ ...origin, frameId: 'same', timestamp: 10 }).state, 'discarded');
  assert.equal(discarded.resume({ ...origin, frameId: 'older', timestamp: 9 }).state, 'discarded');
  assert.equal(discarded.status.disposalReason, 'invalid-time');
  assert.equal(discarded.status.snapshotRetainedBytes, 0);

  const badFrame = createCentralN7BlockCursor(spec.field, spec.seeds.slice(0, 1), origin);
  assert.equal(badFrame.resume({ ...origin, frameId: {}, timestamp: 10 }).state, 'discarded');
  assert.equal(badFrame.status.snapshotRetainedBytes, 0);
});
