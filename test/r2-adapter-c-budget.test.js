import test from 'node:test';
import assert from 'node:assert/strict';
import { createCAdapters } from '../src/r2/adapter-c.js';
import { callDetect } from './r2-c-fixtures.js';

const blankField = (size = 16) => ({
  width: size,
  height: size,
  data: new Float32Array(size * size).fill(1),
  alpha: null,
});

function withTickingPerformance(step, operation) {
  const original = Object.getOwnPropertyDescriptor(performance, 'now');
  let tick = 0;
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => (tick += step),
  });
  try {
    return operation();
  } finally {
    if (original) Object.defineProperty(performance, 'now', original);
    else delete performance.now;
  }
}

test('기본 Infinity 예산은 기존처럼 프레임당 cursor resume 한 번이다', () => {
  withTickingPerformance(1, () => {
    const adapter = createCAdapters();
    callDetect(adapter, blankField(), 0);
    assert.equal(adapter.stats.resumeCursor.steps, 1);
  });
});

test('명시 finite 예산은 남은 wall budget 동안 실제 cursor를 여러 번 resume한다', () => {
  withTickingPerformance(1, () => {
    const adapter = createCAdapters({ budget: { detectMs: 14 } });
    callDetect(adapter, blankField(), 0);
    assert.equal(adapter.stats.resumeCursor.steps, 3);
    assert.equal(adapter.stats.budgetHits, 1);
  });
});

test('0 예산은 snapshot을 만들되 cursor resume을 시작하지 않는다', () => {
  withTickingPerformance(1, () => {
    const adapter = createCAdapters({ budget: { detectMs: 0 } });
    callDetect(adapter, blankField(), 0);
    assert.equal(adapter.stats.snapshotCopies, 2);
    assert.equal(adapter.stats.resumeCursor.steps, 0);
    assert.equal(adapter.stats.budgetHits, 1);
  });
});

test('공유 0 예산은 새 snapshot도 만들지 않고 다음 프레임에 그대로 시작한다', () => {
  withTickingPerformance(1, () => {
    const adapter = createCAdapters({ budget: { detectMs: 14 } });
    callDetect(adapter, blankField(), 0, {}, 0, { budgetMs: 0 });
    assert.equal(adapter.stats.snapshotCopies, 0);
    assert.equal(adapter.stats.resumeCursor, null);
    assert.equal(adapter.stats.budgetHits, 0);
    callDetect(adapter, blankField(), 1, {}, 1, { budgetMs: 14 });
    assert.ok(adapter.stats.snapshotCopies > 0);
    assert.ok(adapter.stats.resumeCursor.steps > 0);
  });
});

test('공유 예산은 기존 개별 예산의 상한을 넘기지 않고 잘못된 값은 거부한다', () => {
  withTickingPerformance(1, () => {
    const adapter = createCAdapters({ budget: { detectMs: 14 } });
    callDetect(adapter, blankField(), 0, {}, 0, { budgetMs: 7 });
    assert.equal(adapter.stats.resumeCursor.steps, 1);
  });
  const unlimited = createCAdapters({ budget: { detectMs: 14 } });
  callDetect(unlimited, blankField(), 0, {}, 0, { budgetMs: Infinity });
  assert.ok(unlimited.stats.resumeCursor.steps > 0);
  for (const budgetMs of [-1, NaN, '5']) {
    const adapter = createCAdapters({ budget: { detectMs: 14 } });
    assert.throws(() => callDetect(adapter, blankField(), 0, {}, 0, { budgetMs }), TypeError);
    assert.equal(adapter.stats.snapshotCopies, 0);
  }
});

test('남은 예산보다 긴 원자 하나 뒤 즉시 멈추고 초과·원자 최대를 기록한다', () => {
  withTickingPerformance(1, () => {
    const adapter = createCAdapters({ budget: { detectMs: 7 } });
    callDetect(adapter, blankField(), 0);
    assert.equal(adapter.stats.resumeCursor.steps, 1);
    assert.equal(adapter.stats.budgetHits, 1);
    assert.equal(adapter.stats.budgetOverrunMs, 3);
    assert.equal(adapter.stats.maxUnitMs, 3);
    assert.equal(adapter.stats.maxUnit, 'downsample');
  });
});

function runBlankToTerminal(adapter) {
  const field = blankField(8);
  const output = {};
  let frameId = 0;
  while (!adapter.stats.scanComplete && frameId < 2_000) {
    callDetect(adapter, field, frameId, output);
    frameId += 1;
  }
  assert.equal(adapter.stats.scanComplete, true);
  return {
    output,
    terminal: {
      phase: adapter.stats.resumeCursor.phase,
      index: adapter.stats.resumeCursor.index,
      total: adapter.stats.resumeCursor.total,
      steps: adapter.stats.resumeCursor.steps,
      originFrameId: adapter.stats.resumeCursor.originFrameId,
      originTimestamp: adapter.stats.resumeCursor.originTimestamp,
      coreCandidates: adapter.stats.coreCandidates,
      clusterCount: adapter.stats.clusterCount,
      shapeCount: adapter.stats.shapeCount,
      hypothesesTried: adapter.stats.hypothesesTried,
      anchorSearches: adapter.stats.anchorSearches,
    },
  };
}

test('작은 실제 cursor의 terminal 의미는 one-step baseline과 finite batch가 같다', () => {
  const baseline = runBlankToTerminal(createCAdapters());
  const batched = runBlankToTerminal(createCAdapters({ budget: { detectMs: 100 } }));

  assert.deepEqual(batched.output, baseline.output);
  assert.deepEqual(batched.terminal, baseline.terminal);
});
