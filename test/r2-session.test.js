import test from 'node:test';
import assert from 'node:assert/strict';

import { IDENTITY_STATE } from '../src/r2/identity.js';
import { Q15_ONE } from '../src/r2/params.js';
import {
  R2_INDICATOR,
  R2_SESSION_STATUS,
  createR2Session,
} from '../src/r2/session.js';

function createAdapters(referenceChecks = undefined, acceptAfterDecodeCalls = 1) {
  let detectionReference;
  let alignmentReference;
  let faceReference;
  let visibleReference;
  let decodeReference;
  let payloadReference;
  let symbolValuesReference;
  let symbolConfidenceReference;
  let erasuresReference;
  const stats = { detectCalls: 0, alignCalls: 0, decodeCalls: 0 };

  function detectInto(luma, width, height, timestamp, pose, output) {
    stats.detectCalls += 1;
    detectionReference ??= output;
    assert.equal(output, detectionReference);
    if (referenceChecks !== undefined) assert.equal(pose, referenceChecks.pose);
    output.found = 1;
    output.family = 7;
    return R2_SESSION_STATUS.OK;
  }

  function alignInto(
    luma,
    width,
    height,
    timestamp,
    pose,
    detection,
    output,
    faceLuma,
    visibleCells,
  ) {
    stats.alignCalls += 1;
    alignmentReference ??= output;
    faceReference ??= faceLuma;
    visibleReference ??= visibleCells;
    assert.equal(output, alignmentReference);
    assert.equal(faceLuma, faceReference);
    assert.equal(visibleCells, visibleReference);
    output.gatePassed = 1;
    output.weightQ15 = Q15_ONE;
    output.mismatchCount = 0;
    output.matchCount = 0;
    output.visibleCount = visibleCells.length;
    for (let cell = 0; cell < visibleCells.length; cell += 1) {
      visibleCells[cell] = 1;
      faceLuma[(cell * 3)] = 255;
      faceLuma[(cell * 3) + 1] = 128;
      faceLuma[(cell * 3) + 2] = 0;
    }
    return R2_SESSION_STATUS.OK;
  }

  function decodeInto(
    symbolValues,
    symbolConfidenceQ8,
    erasures,
    symbolCount,
    layout,
    output,
    payloadBuffer,
  ) {
    stats.decodeCalls += 1;
    decodeReference ??= output;
    payloadReference ??= payloadBuffer;
    symbolValuesReference ??= symbolValues;
    symbolConfidenceReference ??= symbolConfidenceQ8;
    erasuresReference ??= erasures;
    assert.equal(output, decodeReference);
    assert.equal(payloadBuffer, payloadReference);
    assert.equal(symbolValues, symbolValuesReference);
    assert.equal(symbolConfidenceQ8, symbolConfidenceReference);
    assert.equal(erasures, erasuresReference);
    assert.equal(symbolCount, 1);
    assert.equal(symbolValues[0], 0);
    output.accepted = stats.decodeCalls >= acceptAfterDecodeCalls ? 1 : 0;
    output.payloadLength = output.accepted ? 2 : 0;
    output.tResidual = 4;
    payloadBuffer[0] = 0x52;
    payloadBuffer[1] = 0x32;
    return R2_SESSION_STATUS.OK;
  }

  return { detectInto, alignInto, decodeInto, stats };
}

function createTestSession(adapters) {
  return createR2Session({
    layout: {
      cellCount: 3,
      requiredSymbolCount: 1,
      safetySymbolCount: 0,
      maxPayloadBytes: 8,
    },
    params: {
      tauCellQ8: 256,
      erasureMarginQ8: 256,
    },
    ...adapters,
  });
}

/*
 * ⚠ **이 자의 계약이 2026-09-06 에 바뀌었다** (검토 R3c, 결함 5).
 * 옛 판은 프레임마다 `decodeCalls === frame + 1` 을 단언했다 — 즉 「증거 개정이 늘 때마다 RS 를
 * 무조건 한 번」이라는 옛 거동을 못박았다. 그 거동이 실측 결함이었다: 풀 수 없는 상태(다른 코드로
 * 갈아탄 뒤)에서 **17\~30 프레임 연속 실패**가 나고, n=21 실물 RS 1회가 ≈0.9 s 라 스캐너가 초 단위로
 * 막혔다. 그래서 세션은 연속 실패에 **되물림**(`DECODE_RETRY_GAP_MAX`)을 건다.
 *
 * 그래서 여기서 재는 것을 바꾼다 — 「매 프레임 복호」가 아니라:
 *   · 버퍼·view 는 여전히 **한 번도 안 바뀐다** (이 자의 원래 목적).
 *   · 검출·정합은 **여전히 매 프레임**이다 (되물림은 복호 축에만 걸린다).
 *   · 복호는 프레임 수보다 **적게** 불린다 (되물림이 실제로 듣는다 — 공허 방지).
 *   · 그래도 증거가 계속 쌓이면 **결국 DONE 에 닿는다** (되물림이 진행을 막지 않는다).
 */
test('pushFrame은 긴 active-frame 열에서 결과·중첩 view·모든 scratch buffer를 재사용한다 (복호는 되물림)', () => {
  const pose = Object.freeze({ id: 17 });
  const acceptAfterDecodeCalls = 8;
  const frameBudget = 256;
  const adapters = createAdapters({ pose }, acceptAfterDecodeCalls);
  const session = createTestSession(adapters);
  const luma = new Uint8Array([128]);
  const resultReference = session.result;
  const progressReference = session.result.progress;
  const cellMapReference = session.result.progress.cellMap;
  const buffersReference = session.buffers;
  const faceReference = session.buffers.faceLuma;

  let frames = 0;
  let done = false;
  while (frames < frameBudget && !done) {
    const result = session.pushFrame(luma, 1, 1, frames * 33, pose);
    frames += 1;
    assert.equal(result, resultReference);
    assert.equal(result.progress, progressReference);
    assert.equal(result.progress.cellMap, cellMapReference);
    assert.equal(session.buffers, buffersReference);
    assert.equal(session.buffers.faceLuma, faceReference);
    // 되물림은 **복호 축에만** 걸린다 — 검출·정합은 프레임마다 그대로다.
    assert.equal(adapters.stats.detectCalls, frames);
    assert.equal(adapters.stats.alignCalls, frames);
    assert.ok(adapters.stats.decodeCalls <= frames,
      '복호가 프레임보다 많이 불렸다 — 한 프레임에 두 번 시도한다');
    done = result.indicator === R2_INDICATOR.DONE;
    if (!done) assert.equal(result.payload, undefined);
  }

  assert.ok(done, frameBudget + '프레임 안에 DONE 이 없다 — 되물림이 진행을 막는다');
  assert.equal(session.result.status, R2_SESSION_STATUS.OK);
  assert.equal(session.result.state, IDENTITY_STATE.ACTIVE);
  assert.equal(session.result.indicator, R2_INDICATOR.DONE);
  assert.equal(session.result.payload, session.buffers.payload);
  assert.equal(session.result.payloadLength, 2);
  assert.equal(adapters.stats.decodeCalls, acceptAfterDecodeCalls);
  assert.equal(adapters.stats.detectCalls, frames);
  assert.equal(adapters.stats.alignCalls, frames);
  // 🔴 공허 방지 — 되물림이 실제로 들어야 이 자가 무언가를 재는 것이다.
  assert.ok(frames > acceptAfterDecodeCalls,
    '복호 시도 수 = 프레임 수다 — 연속 실패 되물림이 안 듣는다 (' + frames + '프레임 / '
    + adapters.stats.decodeCalls + '회)');
});

test('같은 입력 시퀀스는 독립 세션에서 같은 상태·진행·payload를 만든다', () => {
  const first = createTestSession(createAdapters());
  const second = createTestSession(createAdapters());
  const luma = new Uint8Array([64]);

  for (let frame = 0; frame < 8; frame += 1) {
    const a = first.pushFrame(luma, 1, 1, frame * 33, undefined);
    const b = second.pushFrame(luma, 1, 1, frame * 33, undefined);
    assert.equal(a.status, b.status);
    assert.equal(a.state, b.state);
    assert.equal(a.indicator, b.indicator);
    assert.equal(a.progress.D, b.progress.D);
    assert.equal(a.progress.internalD, b.progress.internalD);
    assert.deepEqual(a.progress.cellMap, b.progress.cellMap);
    assert.equal(a.payloadLength, b.payloadLength);
    if (a.indicator === R2_INDICATOR.DONE) break;
  }

  assert.equal(first.result.indicator, R2_INDICATOR.DONE);
  assert.equal(second.result.indicator, R2_INDICATOR.DONE);
  assert.deepEqual(first.result.payload, second.result.payload);
});

test('기본 주입 스텁은 검출을 가장하지 않고 stable SEARCHING 결과를 낸다', () => {
  const session = createR2Session({
    layout: { cellCount: 3, requiredSymbolCount: 1, safetySymbolCount: 0 },
  });
  const result1 = session.pushFrame(new Uint8Array([0]), 1, 1, 0, undefined);
  const result2 = session.pushFrame(new Uint8Array([0]), 1, 1, 33, undefined);
  assert.equal(result1, result2);
  assert.equal(result2.status, R2_SESSION_STATUS.OK);
  assert.equal(result2.indicator, R2_INDICATOR.SEARCHING);
  assert.equal(result2.progress.D, 0);
});

test('rejectPayload — DONE 을 무르되 **증거는 지킨다** (RS 통과·프레이밍 실패 후보가 고착하던 결함)', () => {
  const adapters = createAdapters(undefined, 1);
  const session = createTestSession(adapters);
  const luma = new Uint8Array([64]);

  session.pushFrame(luma, 1, 1, 0, undefined);
  assert.equal(session.result.indicator, R2_INDICATOR.DONE, '전제: 첫 프레임에 DONE 이다');
  const cellMapBefore = Uint8Array.from(session.result.progress.cellMap);
  const dBefore = session.result.progress.internalD;
  const decodeCallsAtDone = adapters.stats.decodeCalls;

  // 🔴 무르기 전 — 옛 거동: complete=1 이라 다음 프레임이 **즉시 반환**한다 (누적도 복호도 없다).
  session.pushFrame(luma, 1, 1, 33, undefined);
  assert.equal(adapters.stats.decodeCalls, decodeCallsAtDone,
    '전제: complete 상태에서는 복호를 다시 안 한다');
  assert.equal(adapters.stats.detectCalls, 1, '전제: complete 상태에서는 검출도 안 한다');

  assert.equal(session.rejectPayload(), 1, 'rejectPayload 가 무르지 않았다');
  assert.notEqual(session.result.indicator, R2_INDICATOR.DONE, 'DONE 표시가 남았다');
  assert.equal(session.result.payload, undefined, 'payload 가 남았다');
  // 증거는 **그대로**다 — 무르는 것은 「이 답이 아니다」이지 「처음부터」가 아니다.
  assert.deepEqual(session.result.progress.cellMap, cellMapBefore, '무르기가 셀맵을 지웠다');
  assert.equal(session.result.progress.internalD, dBefore, '무르기가 진행을 되돌렸다');

  // 그리고 다시 모을 수 있다 — 프레임이 실제로 세션을 통과한다.
  session.pushFrame(luma, 1, 1, 66, undefined);
  assert.ok(adapters.stats.detectCalls > 1,
    '무른 뒤에도 프레임이 즉시 반환된다 — complete 고착이 안 풀렸다');

  // 두 번 무르는 것은 무해하다 (이미 안 완료면 0).
  assert.equal(session.rejectPayload(), 1, '재복호가 다시 DONE 을 냈어야 한다 (가짜 복호기는 항상 수용)');
  assert.equal(session.rejectPayload(), 0, '완료가 아닌데 1 을 돌려준다');
});
