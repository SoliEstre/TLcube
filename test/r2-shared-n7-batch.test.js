import test from 'node:test';
import assert from 'node:assert/strict';

import { createSharedCentralN7Pool } from '../src/r2/shared-central-n7.js';
import { createR2ExpansionEngine } from '../src/r2-expansion-engine.js';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const preset = getPreset(DEFAULT_PRESET);
const palette = Object.freeze({
  background: preset.background,
  levels: preset.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function current(frameId, timestamp, input, generation = 'batch-g') {
  return Object.freeze({ frameId, timestamp, generation, width: input.width, height: input.height, ordinal: frameId });
}

function renderN7Fixture() {
  const encoded = encode('shared-n7-batch', { version: 2, eccLevel: 'M', centralN7: true });
  const scene = buildScene(encoded, {
    palette,
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    centralN7Family: 'hex',
  });
  return toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 12, supersample: 1 }));
}

function finishMixed(left, right, frame, limit = 100_000) {
  let last = null;
  for (let index = 0; index < limit; index += 1) {
    last = index % 3 === 0
      ? left.resumeBatch(frame, { budgetMs: Infinity, maxSteps: 3 })
      : right.resume(frame);
    const output = left.readOrigin();
    if (output) return output;
    assert.notEqual(last.state, 'stale', JSON.stringify(last));
  }
  throw new Error(`shared n7 batch가 끝나지 않았어요: ${JSON.stringify(last)}`);
}

function finishSingle(left, right, frame, limit = 100_000) {
  let last = null;
  for (let index = 0; index < limit; index += 1) {
    last = index & 1 ? right.resume(frame) : left.resume(frame);
    const output = left.readOrigin();
    if (output) return output;
    assert.notEqual(last.state, 'stale', JSON.stringify(last));
  }
  throw new Error(`shared n7 single이 끝나지 않았어요: ${JSON.stringify(last)}`);
}

test('shared n7 batch는 zero budget·step cap·반환 계약을 원자 resume과 같은 pool에 적용한다', {
  timeout: 30_000,
}, () => {
  const input = renderN7Fixture();
  const frame = current(1, 1000, input);
  const pool = createSharedCentralN7Pool();
  const lease = pool.acquire(input, frame);

  for (const options of [
    { budgetMs: -1 }, { budgetMs: NaN }, { budgetMs: '1' },
    { budgetMs: 1, maxSteps: -1 }, { budgetMs: 1, maxSteps: 1.5 }, { budgetMs: 1, maxSteps: NaN },
  ]) assert.throws(() => lease.resumeBatch(frame, options), TypeError);

  const beforeZero = pool.stats.steps;
  const zero = lease.resumeBatch(frame, { budgetMs: 0, maxSteps: 3 });
  assert.deepEqual(Object.keys(zero).sort(), [
    'batchMs', 'currentFrameUsable', 'lastProgress', 'maxUnitMs', 'maxUnitStage', 'reason', 'stage', 'state', 'steps',
  ]);
  assert.equal(zero.state, 'active');
  assert.equal(zero.stage, null);
  assert.equal(zero.steps, 0);
  assert.equal(zero.lastProgress, null);
  assert.equal(zero.currentFrameUsable, false);
  assert.equal(pool.stats.steps - beforeZero, 0);

  const beforeThree = pool.stats.steps;
  const three = lease.resumeBatch(frame, { budgetMs: Infinity, maxSteps: 3 });
  assert.ok(['active', 'done'].includes(three.state));
  assert.ok(three.steps >= 0 && three.steps <= 3);
  assert.equal(pool.stats.steps - beforeThree, three.steps);
  assert.equal(three.currentFrameUsable, false);
  assert.equal(three.stage, three.lastProgress?.state ?? null);
  assert.ok(Number.isFinite(three.batchMs) && three.batchMs >= 0);
  assert.ok(Number.isFinite(three.maxUnitMs) && three.maxUnitMs >= 0);
  assert.ok(three.batchMs >= three.maxUnitMs, '원자 최대는 전체 batch 시간에 포함돼야 해요');
  assert.equal(typeof three.maxUnitStage, 'string');
  lease.release();
});

test('shared n7 batch의 양수 soft budget은 결정적 시계에서 maxSteps보다 먼저 멈추고 clock을 복원한다', () => {
  const descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  let tick = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => ++tick });
  try {
    const input = renderN7Fixture();
    const frame = current(1, 1000, input);
    const pool = createSharedCentralN7Pool();
    const lease = pool.acquire(input, frame);
    const before = pool.stats.steps;
    const batch = lease.resumeBatch(frame, { budgetMs: 2, maxSteps: 100 });
    assert.ok(batch.steps < 100, '남은 budget이 없으면 다음 원자를 시작하면 안 돼요');
    assert.equal(pool.stats.steps - before, batch.steps);
    assert.ok(batch.batchMs >= 2, '원자 실행 뒤의 soft deadline 초과는 batch 전체 시간에 남겨요');
    lease.release();
  } finally {
    if (descriptor) Object.defineProperty(performance, 'now', descriptor);
    else delete performance.now;
  }
});

test('C와 planar 소비자가 batch와 single을 교대해도 single-only 광학 origin/finders와 같다', {
  timeout: 30_000,
}, () => {
  const input = renderN7Fixture();
  const frame = current(1, 1000, input);

  const baselinePool = createSharedCentralN7Pool();
  const baselineLeft = baselinePool.acquire(input, frame);
  const baselineRight = baselinePool.acquire(input, frame);
  const expected = finishSingle(baselineLeft, baselineRight, frame);

  const batchPool = createSharedCentralN7Pool();
  const batchLeft = batchPool.acquire(input, frame);
  const batchRight = batchPool.acquire(input, frame);
  const actual = finishMixed(batchLeft, batchRight, frame);
  assert.deepEqual(actual, expected);
  assert.deepEqual(batchRight.readOrigin(), actual);
  assert.equal(batchPool.stats.jobs, 1);
  assert.equal(batchPool.stats.joins, 1);
  baselineLeft.release(); baselineRight.release(); batchLeft.release(); batchRight.release();
});

test('shared n7 batch는 release·expiry·reset의 single resume identity 결과를 보존한다', () => {
  const input = renderN7Fixture();
  const frame = current(1, 1000, input);

  const releasedPool = createSharedCentralN7Pool();
  const released = releasedPool.acquire(input, frame);
  assert.equal(released.release(), true);
  assert.deepEqual(released.resumeBatch(frame, { budgetMs: Infinity }), {
    state: 'released', stage: null, steps: 0, batchMs: 0, maxUnitMs: 0, maxUnitStage: null,
    lastProgress: null, currentFrameUsable: false,
  });

  const expiryPool = createSharedCentralN7Pool({ maxAgeFrames: 1, maxAgeMs: 10 });
  const old = expiryPool.acquire(input, frame);
  const newer = current(3, 1001, input);
  expiryPool.acquire(input, newer);
  const expired = old.resumeBatch(frame, { budgetMs: Infinity });
  assert.equal(expired.state, 'stale');
  assert.equal(expired.stage, null);
  assert.equal(expired.steps, 0);
  assert.equal(expired.reason, 'age-frames');

  const resetPool = createSharedCentralN7Pool();
  const resetLease = resetPool.acquire(input, frame);
  resetPool.reset();
  const reset = resetLease.resumeBatch(frame, { budgetMs: Infinity });
  assert.equal(reset.state, 'stale');
  assert.equal(reset.stage, null);
  assert.equal(reset.steps, 0);
  assert.equal(reset.reason, 'reset');
});

function runtimeLane(id, phase, candidateCount, calls) {
  return {
    stats: { candidateCount, progressD: 0, indicator: 0 },
    adapters: { stats: { resumeCursor: { phase } } },
    reset() {}, setCapacity() {}, deferFrame() {},
    pushFrame(_field, _timestamp, options) {
      calls.push({ id, frameId: options.frameId, runDetect: options.runDetect });
      return null;
    },
    get hudCandidates() { return []; },
  };
}

function quietY() {
  return {
    stats: { candidateCount: 0, locked: 0, progressD: 0, indicator: 0, phaseMs: {} },
    view: {}, hudCandidates: [], reset() {}, setEnabled() {},
    pushFrame() { return null; },
  };
}

function scheduleEvents({ phase, cCandidates = 1, planarCandidates = 0, frames = 2 }) {
  const calls = [];
  const engine = createR2ExpansionEngine({ enabled: true, candidateScope: 'all', budgetMs: 100,
    yRuntime: quietY(),
    cRuntime: runtimeLane('C', phase, cCandidates, calls),
    planarRuntime: runtimeLane('planar', 'complete', planarCandidates, calls),
    cubeRuntime: runtimeLane('y-faces', 'complete', 0, calls),
  });
  const field = { width: 2, height: 2, data: new Float32Array(4).fill(.5) };
  for (let frame = 0; frame < frames; frame += 1) engine.pushFrame(field, frame, { frameId: frame });
  return calls;
}

function firstServicePerFrame(events) {
  const first = new Map();
  for (const event of events) if (!first.has(event.frameId)) first.set(event.frameId, event.id);
  return [...first.values()];
}

test('실제 expansion service는 C 자기 후보가 있어도 pending 관측 phase를 우선하고, 다른 live lane·complete에서는 RR로 돌아간다', () => {
  for (const phase of ['hypotheses', 'cq-refine', 'extra']) {
    assert.deepEqual(firstServicePerFrame(scheduleEvents({ phase, cCandidates: 1 })), ['C', 'C'],
      `${phase}: C의 live 후보는 자기 미완료 관측의 first service를 막으면 안 돼요`);
  }
  assert.deepEqual(firstServicePerFrame(scheduleEvents({ phase: 'hypotheses', cCandidates: 1, planarCandidates: 1, frames: 3 })),
    ['C', 'planar', 'y-faces'], '다른 live lane이 있으면 실제 service 순서는 RR이어야 해요');
  assert.deepEqual(firstServicePerFrame(scheduleEvents({ phase: 'complete', cCandidates: 1, frames: 3 })), ['C', 'planar', 'y-faces'],
    'C의 pending 수명이 끝나면 실제 service는 RR로 복귀해야 해요');
});
