import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCUMULATE_STATUS,
  accumulateCell,
  accumulateFrame,
  cellArgmax,
  cellMarginQ8,
  createAccumulator,
  materializeSymbolsInto,
} from '../src/r2/accumulate.js';
import { Q15_ONE } from '../src/r2/params.js';

function evidenceFor(target) {
  const evidence = new Int16Array(6);
  for (let state = 0; state < 6; state += 1) {
    evidence[state] = state === target ? -8 : -1600 - (state * 7);
  }
  return evidence;
}

test('w_t=0 프레임은 score와 관측 횟수를 비트 단위로 보존한다', () => {
  const accumulator = createAccumulator(4);
  const frame = new Int16Array(24);
  for (let index = 0; index < frame.length; index += 1) frame[index] = -index * 13;
  accumulateFrame(accumulator, frame, Q15_ONE);

  const beforeScores = accumulator.scores.slice();
  const beforeObservations = accumulator.observations.slice();
  assert.equal(accumulateFrame(accumulator, frame, 0), ACCUMULATE_STATUS.OK);
  assert.deepEqual(accumulator.scores, beforeScores);
  assert.deepEqual(accumulator.observations, beforeObservations);
});

test('λ<1 반복 누적은 int16 범위에서 유계이고 고정점에 수렴한다', () => {
  const accumulator = createAccumulator(1, {
    lambdaQ15: Math.round(0.9 * Q15_ONE),
    betaQ15: Math.round(0.3 * Q15_ONE),
  });
  const evidence = evidenceFor(4);

  for (let frame = 0; frame < 2000; frame += 1) {
    accumulateCell(accumulator, 0, evidence, 0, Q15_ONE);
  }
  const converged = accumulator.scores.slice();
  for (let frame = 0; frame < 2000; frame += 1) {
    accumulateCell(accumulator, 0, evidence, 0, Q15_ONE);
  }

  assert.deepEqual(accumulator.scores, converged);
  // int16 범위 단언은 Int16Array 위에서 공허하다 (컨테이너가 강제하므로 clampInt16 을
  // 없애도 통과한다). 유계가 실제로 지켜지는지는 «포화 문턱에서 부호가 뒤집히지
  // 않는가» 로만 관측된다 — 값이 클램프 경계에 닿지 않았고 순서가 살아 있는지 잰다.
  assert.equal(cellArgmax(accumulator, 0), 4);
  for (const value of accumulator.scores) {
    assert.ok(value > -32768, '고정점이 클램프 경계에 눌리면 margin 이 죽는다');
  }
});

test('감쇠 없는(λ=1) 장기 누적에서도 wraparound 없이 순서가 보존된다', () => {
  // clampInt16 을 제거하면 Int16Array 저장이 조용히 wrap 해 큰 음수가 양수가 되고
  // argmax 가 뒤집힌다. λ=1 은 재중심화만으로 발산을 막는 최악 경로라 그 자가 된다.
  const accumulator = createAccumulator(1, {
    lambdaQ15: Q15_ONE,
    betaQ15: Q15_ONE,
  });
  const evidence = evidenceFor(1);

  for (let frame = 0; frame < 5000; frame += 1) {
    accumulateCell(accumulator, 0, evidence, 0, Q15_ONE);
    assert.equal(cellArgmax(accumulator, 0), 1);
  }
  assert.ok(cellMarginQ8(accumulator, 0) > 0);
});

test('동일 관측 N회 뒤 argmax는 모든 digit에서 안정적이다', () => {
  for (let target = 0; target < 6; target += 1) {
    const accumulator = createAccumulator(1);
    const evidence = evidenceFor(target);
    accumulateCell(accumulator, 0, evidence, 0, Q15_ONE);
    assert.equal(cellArgmax(accumulator, 0), target);
    const firstMargin = cellMarginQ8(accumulator, 0);

    for (let frame = 1; frame < 200; frame += 1) {
      accumulateCell(accumulator, 0, evidence, 0, Q15_ONE);
      assert.equal(cellArgmax(accumulator, 0), target);
    }
    assert.ok(cellMarginQ8(accumulator, 0) >= firstMargin);
  }
});

test('C2 합성은 연속 3셀을 MSD-first GF(211) 값으로 만든다', () => {
  const accumulator = createAccumulator(3, { erasureMarginQ8: 1 });
  const digits = [2, 3, 4];
  for (let cell = 0; cell < 3; cell += 1) {
    for (let frame = 0; frame < 12; frame += 1) {
      accumulateCell(accumulator, cell, evidenceFor(digits[cell]), 0, Q15_ONE);
    }
  }

  const values = new Uint8Array(1);
  const confidence = new Int16Array(1);
  const erasures = new Uint8Array(1);
  assert.equal(
    materializeSymbolsInto(accumulator, {}, values, confidence, erasures),
    ACCUMULATE_STATUS.OK,
  );
  assert.equal(values[0], (36 * 2) + (6 * 3) + 4);
  assert.equal(erasures[0], 0);
  assert.ok(confidence[0] > 0);
});

