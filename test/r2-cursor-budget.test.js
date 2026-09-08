import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeCursorWithinBudget } from '../src/r2/cursor-budget.js';

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    advance: (ms) => { time += ms; },
  };
}

function fakeCursor(clock, durations, states = []) {
  let calls = 0;
  let phase = 'scan-line';
  const currents = [];
  return {
    resume(current) {
      currents.push(current);
      clock.advance(durations[calls] ?? 0);
      phase = states[calls] ?? phase;
      calls += 1;
      return { state: phase };
    },
    get status() { return { phase }; },
    get calls() { return calls; },
    currents,
  };
}

test('원자 resume 시간을 누적하고 소프트 예산 초과량을 보고한다', () => {
  const clock = fakeClock();
  const cursor = fakeCursor(clock, [2, 3, 4, 100]);
  const result = resumeCursorWithinBudget(cursor, { generation: 7 }, {
    budgetMs: 8,
    now: clock.now,
  });

  assert.deepEqual(result, {
    steps: 3,
    elapsedMs: 9,
    overrunMs: 1,
    state: 'scan-line',
    lastProgress: { state: 'scan-line' },
    maxStepMs: 4,
    maxStepUnit: 'scan-line',
  });
  assert.equal(cursor.calls, 3, '초과를 관측한 뒤 다음 원자 단위를 시작하면 안 된다');
});

test('done을 반환하면 남은 예산과 관계없이 즉시 끝낸다', () => {
  const clock = fakeClock();
  const cursor = fakeCursor(clock, [1, 1, 100], ['cluster', 'done', 'done']);
  const result = resumeCursorWithinBudget(cursor, {}, {
    budgetMs: 20,
    now: clock.now,
  });

  assert.equal(result.state, 'done');
  assert.equal(result.steps, 2);
  assert.equal(cursor.calls, 2);
});

test('discarded를 반환하면 다음 resume을 호출하지 않는다', () => {
  const clock = fakeClock();
  const cursor = fakeCursor(clock, [2, 100], ['discarded', 'discarded']);
  const result = resumeCursorWithinBudget(cursor, {}, {
    budgetMs: 20,
    now: clock.now,
  });

  assert.equal(result.state, 'discarded');
  assert.equal(result.steps, 1);
  assert.equal(cursor.calls, 1);
});

test('시계가 전진하지 않아도 maxSteps에서 안전하게 멈춘다', () => {
  const clock = fakeClock();
  const cursor = fakeCursor(clock, []);
  const result = resumeCursorWithinBudget(cursor, {}, {
    budgetMs: 10,
    maxSteps: 4,
    now: clock.now,
  });

  assert.equal(result.steps, 4);
  assert.equal(result.elapsedMs, 0);
  assert.equal(cursor.calls, 4);
});

test('한 묶음의 모든 resume에 동일 snapshot/current epoch를 보존한다', () => {
  const clock = fakeClock();
  const cursor = fakeCursor(clock, [1, 1, 1]);
  const current = Object.freeze({
    frameId: 41,
    timestamp: 900,
    width: 320,
    height: 240,
    generation: 'epoch-a',
  });
  resumeCursorWithinBudget(cursor, current, {
    budgetMs: 10,
    maxSteps: 3,
    now: clock.now,
  });

  assert.equal(cursor.currents.length, 3);
  assert.ok(cursor.currents.every((seen) => seen === current));
  assert.deepEqual(current, {
    frameId: 41,
    timestamp: 900,
    width: 320,
    height: 240,
    generation: 'epoch-a',
  });
});

test('0ms 예산은 cursor 상태만 보고 resume을 시작하지 않는다', () => {
  const clock = fakeClock();
  const cursor = fakeCursor(clock, [1]);
  const result = resumeCursorWithinBudget(cursor, {}, {
    budgetMs: 0,
    now: clock.now,
  });

  assert.deepEqual(result, {
    steps: 0,
    elapsedMs: 0,
    overrunMs: 0,
    state: 'scan-line',
    lastProgress: null,
    maxStepMs: 0,
    maxStepUnit: null,
  });
  assert.equal(cursor.calls, 0);
});

test('무한 예산과 비안전 maxSteps를 거부한다', () => {
  const clock = fakeClock();
  const cursor = fakeCursor(clock, []);

  assert.throws(
    () => resumeCursorWithinBudget(cursor, {}, { budgetMs: Infinity, now: clock.now }),
    /budgetMs/,
  );
  assert.throws(
    () => resumeCursorWithinBudget(cursor, {}, {
      budgetMs: 1,
      maxSteps: 1_000_001,
      now: clock.now,
    }),
    /maxSteps/,
  );
});

test('시계가 직전 표본보다 역행하면 중단한다', () => {
  const samples = [100, 110, 105];
  const cursor = {
    resume: () => ({ state: 'scan-line' }),
    status: { phase: 'scan-line' },
  };

  assert.throws(
    () => resumeCursorWithinBudget(cursor, {}, {
      budgetMs: 20,
      now: () => samples.shift(),
    }),
    /단조 증가/,
  );
});
