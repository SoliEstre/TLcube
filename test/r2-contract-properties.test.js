// PM/029B §4 의 계약 C1~C6 과 브리프 「자」 절의 성질 중, 모듈별 테스트가
// 구조적으로 덮지 못하는 축을 잰다. 전부 적대적 리뷰(2026-08-31)가 «자가 없어
// 회귀가 통과한다» 고 지목한 자리다 — 각 테스트는 그 회귀를 실제로 잡는다.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCUMULATE_STATUS,
  accumulateCell,
  accumulateFrame,
  cellArgmax,
  createAccumulator,
  materializeSymbolsInto,
} from '../src/r2/accumulate.js';
import {
  IDENTITY_STATE,
  createIdentity,
  observeIdentity,
} from '../src/r2/identity.js';
import { Q15_ONE, createR2Params } from '../src/r2/params.js';
import {
  R2_INDICATOR,
  R2_SESSION_STATUS,
  createR2Session,
} from '../src/r2/session.js';

function evidenceFor(target) {
  const evidence = new Int16Array(6);
  for (let state = 0; state < 6; state += 1) {
    evidence[state] = state === target ? -8 : -1600 - (state * 7);
  }
  return evidence;
}

// ── 마스크 제거 (SPEC §4.3 · 계약 C1) ────────────────────────────────────
// accumulateCell 의 shift 는 «unmasked state d 가 관측 state d+shift 를 읽는다».
// 방향이 뒤집히면 라이브 코드의 전 심볼이 치환되는데, shift≠0 경로를 지나는
// 테스트가 없으면 스위트는 초록으로 남는다.

test('디마스크: unmasked argmax = (관측 digit − shift) mod 6 — 전 shift·전 digit', () => {
  for (let shift = 0; shift < 6; shift += 1) {
    for (let observed = 0; observed < 6; observed += 1) {
      const accumulator = createAccumulator(1);
      const evidence = evidenceFor(observed);
      for (let frame = 0; frame < 8; frame += 1) {
        accumulateCell(accumulator, 0, evidence, 0, Q15_ONE, shift);
      }
      assert.equal(
        cellArgmax(accumulator, 0),
        ((observed - shift) % 6 + 6) % 6,
        `shift=${shift} observed=${observed}`,
      );
    }
  }
});

test('디마스크는 shift 만큼의 순환일 뿐 — 누적 score 집합이 보존된다', () => {
  const unshifted = createAccumulator(1);
  const shifted = createAccumulator(1);
  for (let frame = 0; frame < 8; frame += 1) {
    accumulateCell(unshifted, 0, evidenceFor(3), 0, Q15_ONE, 0);
    accumulateCell(shifted, 0, evidenceFor(3), 0, Q15_ONE, 2);
  }
  for (let state = 0; state < 6; state += 1) {
    assert.equal(shifted.scores[state], unshifted.scores[(state + 2) % 6]);
  }
});

test('증거 배열이 누산기 scratch 를 앨리어싱해도 shift 결과가 같다', () => {
  // accumulateFrame 은 accumulator.scratch 를 증거 버퍼로 넘긴다. 결과를 같은
  // 배열에 쓰면 shift≠0 에서 이미 덮어쓴 항을 읽게 되므로, 증거는 먼저 스냅샷돼야
  // 한다. 별도 버퍼로 계산한 기준값과 바이트 동일해야 한다.
  const reference = createAccumulator(1);
  const aliased = createAccumulator(1);
  const evidence = evidenceFor(5);

  for (let frame = 0; frame < 4; frame += 1) {
    accumulateCell(reference, 0, evidence, 0, Q15_ONE, 4);
    for (let state = 0; state < 6; state += 1) aliased.scratch[state] = evidence[state];
    accumulateCell(aliased, 0, aliased.scratch, 0, Q15_ONE, 4);
  }
  assert.deepEqual(aliased.scores, reference.scores);
  assert.equal(cellArgmax(aliased, 0), 1);
});

// ── erasure 플래그 (계약 C2) ─────────────────────────────────────────────
// 세 트리거가 전부 미측정이면 `erasures[symbol] = 0` 상수화도 통과한다.
// erasure 를 잃으면 디코더가 쓰레기 심볼을 error 로 먹어 RS 예산을 2배로 쓴다.

test('erasure: 미관측 셀을 포함한 심볼은 소거로 표시된다', () => {
  const accumulator = createAccumulator(3, { erasureMarginQ8: 1 });
  for (let frame = 0; frame < 12; frame += 1) {
    accumulateCell(accumulator, 0, evidenceFor(1), 0, Q15_ONE);
    accumulateCell(accumulator, 1, evidenceFor(2), 0, Q15_ONE);
    // 셀 2 는 한 번도 관측되지 않는다.
  }
  const erasures = new Uint8Array(1);
  assert.equal(
    materializeSymbolsInto(
      accumulator, {}, new Uint8Array(1), new Int16Array(1), erasures,
    ),
    ACCUMULATE_STATUS.OK,
  );
  assert.equal(erasures[0], 1);
});

test('erasure: 신뢰 마진이 임계 미만이면 소거로 표시된다', () => {
  const accumulator = createAccumulator(3, { erasureMarginQ8: 32000 });
  for (let cell = 0; cell < 3; cell += 1) {
    for (let frame = 0; frame < 12; frame += 1) {
      accumulateCell(accumulator, cell, evidenceFor(cell), 0, Q15_ONE);
    }
  }
  const erasures = new Uint8Array(1);
  const confidence = new Int16Array(1);
  assert.equal(
    materializeSymbolsInto(
      accumulator, {}, new Uint8Array(1), confidence, erasures,
    ),
    ACCUMULATE_STATUS.OK,
  );
  assert.ok(confidence[0] < 32000);
  assert.equal(erasures[0], 1);
});

test('erasure: 불법 argmax(>210)를 이기는 합법 값은 소거로 표시된다', () => {
  // digit (5,5,5) = 215 > 210 이 전체 최선이면, 채택되는 합법 값은 신뢰할 수 없다.
  const accumulator = createAccumulator(3, { erasureMarginQ8: 1 });
  for (let cell = 0; cell < 3; cell += 1) {
    for (let frame = 0; frame < 12; frame += 1) {
      accumulateCell(accumulator, cell, evidenceFor(5), 0, Q15_ONE);
    }
  }
  const values = new Uint8Array(1);
  const erasures = new Uint8Array(1);
  assert.equal(
    materializeSymbolsInto(
      accumulator, {}, values, new Int16Array(1), erasures,
    ),
    ACCUMULATE_STATUS.OK,
  );
  assert.ok(values[0] <= 210);
  assert.equal(erasures[0], 1);
});

// ── SPRT 의 «유지» 측 (계약 C4 · A4 §3) ──────────────────────────────────
// 드랍 측만 재면 hair-trigger(불일치 1셀에 즉시 드랍) 회귀가 통과한다. p_e=5%
// 재관측 오류를 흡수하는 것이 SPRT 를 쓰는 이유 자체다.

test('SPRT 유지: 임계 미만 불일치는 ACTIVE 를 유지한다', () => {
  for (const mismatches of [1, 2]) {
    const identity = createIdentity();
    assert.equal(
      observeIdentity(identity, true, true, mismatches, 0),
      IDENTITY_STATE.ACTIVE,
      `불일치 ${mismatches}셀에 드랍하면 안 된다`,
    );
  }
});

test('SPRT 유지: 일치 증거가 불일치를 상쇄해 순증거로 판정한다', () => {
  const identity = createIdentity();
  // 불일치 3 은 단독이면 드랍 임계를 넘지만, 같은 프레임의 일치 3 이 상쇄한다.
  assert.equal(
    observeIdentity(identity, true, true, 3, 3),
    IDENTITY_STATE.ACTIVE,
  );
  assert.ok(identity.sprtQ8 < identity.params.sprtDropThresholdQ8);
});

test('SPRT 유지: 일치만 관측하면 임의 길이로 ACTIVE 가 유지된다', () => {
  const identity = createIdentity();
  for (let frame = 0; frame < 500; frame += 1) {
    assert.equal(
      observeIdentity(identity, true, true, 0, 12),
      IDENTITY_STATE.ACTIVE,
    );
  }
});

test('SPRT 드랍: 순불일치가 임계를 넘으면 드랍한다 (반대쪽 자)', () => {
  const identity = createIdentity();
  let state = IDENTITY_STATE.ACTIVE;
  for (let frame = 0; frame < 8 && state === IDENTITY_STATE.ACTIVE; frame += 1) {
    state = observeIdentity(identity, true, true, 1, 0);
  }
  assert.equal(state, IDENTITY_STATE.DROPPED);
});

// ── 세션 계약 C4·C6 (드랍 = 버퍼·표시 리셋 / coast ≠ w=0) ────────────────

function createSessionAdapters(behavior) {
  return {
    detectInto(luma, width, height, timestamp, pose, output) {
      output.found = behavior.detected ? 1 : 0;
      output.family = 7;
      return R2_SESSION_STATUS.OK;
    },
    alignInto(
      luma, width, height, timestamp, pose, detection, output, faceLuma, visibleCells,
    ) {
      output.gatePassed = behavior.gatePassed ? 1 : 0;
      output.weightQ15 = behavior.gatePassed ? Q15_ONE : 0;
      output.mismatchCount = behavior.mismatchCount ?? 0;
      output.matchCount = 0;
      output.visibleCount = visibleCells.length;
      for (let cell = 0; cell < visibleCells.length; cell += 1) {
        visibleCells[cell] = 1;
        faceLuma[cell * 3] = 255;
        faceLuma[(cell * 3) + 1] = 128;
        faceLuma[(cell * 3) + 2] = 0;
      }
      return R2_SESSION_STATUS.OK;
    },
    decodeInto(symbolValues, symbolConfidenceQ8, erasures, symbolCount, layout, output) {
      output.accepted = 0;
      output.payloadLength = 0;
      return R2_SESSION_STATUS.OK;
    },
  };
}

function createGapSession(behavior) {
  return createR2Session({
    layout: {
      cellCount: 3, requiredSymbolCount: 1, safetySymbolCount: 0, maxPayloadBytes: 8,
    },
    params: { tauCellQ8: 256, erasureMarginQ8: 256 },
    ...createSessionAdapters(behavior),
  });
}

test('세션 드랍: 신원 드랍이 누적·진행·셀맵을 리셋한다 (C4·C6)', () => {
  const behavior = { detected: true, gatePassed: true, mismatchCount: 0 };
  const session = createGapSession(behavior);
  const luma = new Uint8Array([128]);

  for (let frame = 0; frame < 6; frame += 1) session.pushFrame(luma, 1, 1, frame * 33, undefined);
  assert.ok(session.result.progress.D > 0, '드랍 전에는 진행이 있어야 한다');
  assert.ok(session.buffers.observations[0] > 0);

  behavior.mismatchCount = 12; // 순불일치 폭주 → SPRT 드랍
  let state = session.result.state;
  for (let frame = 6; frame < 12 && state !== IDENTITY_STATE.DROPPED; frame += 1) {
    state = session.pushFrame(luma, 1, 1, frame * 33, undefined).state;
  }

  assert.equal(state, IDENTITY_STATE.DROPPED);
  assert.equal(session.result.indicator, R2_INDICATOR.DROPPED);
  assert.equal(session.result.progress.D, 0, '드랍은 표시를 명시적으로 리셋한다');
  assert.equal(session.result.progress.internalD, 0);
  assert.equal(session.result.payloadLength, 0);
  for (const value of session.buffers.observations) assert.equal(value, 0);
  for (const state2 of session.result.progress.cellMap) assert.equal(state2, 0);
});

// coast 의 표시는 두 갈래다 — 대상을 못 찾으면 SEARCHING(«조준하세요»), 찾았지만
// 정합 게이트를 못 넘으면 HOLD(«유지하세요»). 둘 다 증거는 보존한다 (동결 ≠ 드랍).
test('세션 coast: 검출 소실은 SEARCHING 이고 누적을 리셋하지 않는다', () => {
  const behavior = { detected: true, gatePassed: true, mismatchCount: 0 };
  const session = createGapSession(behavior);
  const luma = new Uint8Array([128]);
  for (let frame = 0; frame < 6; frame += 1) session.pushFrame(luma, 1, 1, frame * 33, undefined);

  const observationsBefore = session.buffers.observations.slice();
  const dBefore = session.result.progress.D;

  behavior.detected = false;
  const coasted = session.pushFrame(luma, 1, 1, 200, undefined);

  assert.equal(coasted.state, IDENTITY_STATE.COAST);
  assert.equal(coasted.indicator, R2_INDICATOR.SEARCHING);
  assert.deepEqual(session.buffers.observations, observationsBefore, 'coast 는 증거를 보존한다');
  assert.equal(coasted.progress.D, dBefore, '표시는 후퇴하지 않는다');
  assert.equal(coasted.progress.hold, 1);
});

test('세션 coast: 정합 게이트 실패는 HOLD 이고 누적을 리셋하지 않는다', () => {
  const behavior = { detected: true, gatePassed: true, mismatchCount: 0 };
  const session = createGapSession(behavior);
  const luma = new Uint8Array([128]);
  for (let frame = 0; frame < 6; frame += 1) session.pushFrame(luma, 1, 1, frame * 33, undefined);

  const observationsBefore = session.buffers.observations.slice();
  behavior.gatePassed = false;
  const held = session.pushFrame(luma, 1, 1, 200, undefined);

  assert.equal(held.state, IDENTITY_STATE.COAST);
  assert.equal(held.indicator, R2_INDICATOR.HOLD);
  assert.deepEqual(session.buffers.observations, observationsBefore, '오정합 프레임은 w=0 이라 증거를 안 바꾼다');
});

test('세션 coast 만료: nCoast 프레임 뒤 드랍으로 넘어간다', () => {
  const behavior = { detected: false, gatePassed: false, mismatchCount: 0 };
  const session = createGapSession(behavior);
  const luma = new Uint8Array([128]);
  let state = IDENTITY_STATE.ACTIVE;
  let frames = 0;
  while (state !== IDENTITY_STATE.DROPPED && frames < 100) {
    state = session.pushFrame(luma, 1, 1, frames * 33, undefined).state;
    frames += 1;
  }
  assert.equal(state, IDENTITY_STATE.DROPPED);
  assert.equal(frames, createR2Params().nCoast);
});

// ── 진행률 분모의 도달 가능성 (A6 · 브리프 「임계 도달 순간 D=1」) ────────
// C_eff 상한은 정확히 symbolCount 다. 분모가 그보다 크면 D=1 이 수학적으로
// 도달 불가라 decodeInto 가 영원히 안 불린다 — K/m 을 안 준 layout 의 폴백이
// 정확히 그 경우였다.

test('K/m 없는 layout 도 D=1 에 도달하고 복호를 시도한다', () => {
  let decodeCalls = 0;
  const session = createR2Session({
    layout: { cellCount: 12 }, // requiredSymbolCount·safetySymbolCount 미지정
    params: { tauCellQ8: 256, erasureMarginQ8: 256 },
    ...createSessionAdapters({ detected: true, gatePassed: true }),
    decodeInto(symbolValues, symbolConfidenceQ8, erasures, symbolCount, layout, output) {
      decodeCalls += 1;
      output.accepted = 0;
      output.payloadLength = 0;
      return R2_SESSION_STATUS.OK;
    },
  });

  const luma = new Uint8Array([128]);
  for (let frame = 0; frame < 40; frame += 1) session.pushFrame(luma, 1, 1, frame * 33, undefined);

  assert.equal(session.result.progress.internalD, 1);
  assert.equal(session.result.progress.D, 1);
  assert.ok(decodeCalls > 0, '분모가 도달 불가면 복호가 한 번도 시도되지 않는다');
});

test('진행률 분모는 달성 가능 상한(symbolCount)을 넘지 않는다', () => {
  // K 를 크게 주고 m 을 안 주는 조합에서도 D=1 이 도달 가능해야 한다.
  const session = createR2Session({
    layout: { cellCount: 12, requiredSymbolCount: 4 }, // m 은 기본 안전분
    params: { tauCellQ8: 256, erasureMarginQ8: 256 },
    ...createSessionAdapters({ detected: true, gatePassed: true }),
  });
  const luma = new Uint8Array([128]);
  for (let frame = 0; frame < 40; frame += 1) session.pushFrame(luma, 1, 1, frame * 33, undefined);
  assert.equal(session.result.progress.internalD, 1);
});
