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

test('pushFrame은 긴 active-frame 열에서 결과·중첩 view·모든 scratch buffer를 재사용한다', () => {
  const pose = Object.freeze({ id: 17 });
  const activeFrameCount = 64;
  const adapters = createAdapters({ pose }, activeFrameCount);
  const session = createTestSession(adapters);
  const luma = new Uint8Array([128]);
  const resultReference = session.result;
  const progressReference = session.result.progress;
  const cellMapReference = session.result.progress.cellMap;
  const buffersReference = session.buffers;
  const faceReference = session.buffers.faceLuma;

  for (let frame = 0; frame < activeFrameCount; frame += 1) {
    const result = session.pushFrame(luma, 1, 1, frame * 33, pose);
    assert.equal(result, resultReference);
    assert.equal(result.progress, progressReference);
    assert.equal(result.progress.cellMap, cellMapReference);
    assert.equal(session.buffers, buffersReference);
    assert.equal(session.buffers.faceLuma, faceReference);
    assert.equal(adapters.stats.detectCalls, frame + 1);
    assert.equal(adapters.stats.alignCalls, frame + 1);
    assert.equal(adapters.stats.decodeCalls, frame + 1);
    if (frame < activeFrameCount - 1) {
      assert.notEqual(result.indicator, R2_INDICATOR.DONE);
      assert.equal(result.payload, undefined);
    }
  }

  assert.equal(session.result.status, R2_SESSION_STATUS.OK);
  assert.equal(session.result.state, IDENTITY_STATE.ACTIVE);
  assert.equal(session.result.indicator, R2_INDICATOR.DONE);
  assert.equal(session.result.payload, session.buffers.payload);
  assert.equal(session.result.payloadLength, 2);
  assert.deepEqual(adapters.stats, {
    detectCalls: activeFrameCount,
    alignCalls: activeFrameCount,
    decodeCalls: activeFrameCount,
  });
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
