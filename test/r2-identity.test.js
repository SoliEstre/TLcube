import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IDENTITY_DROP_REASON,
  IDENTITY_STATE,
  createIdentity,
  observeIdentity,
} from '../src/r2/identity.js';

test('일치 관측만 이어지면 identity는 ACTIVE에서 드랍되지 않는다', () => {
  const identity = createIdentity();
  for (let frame = 0; frame < 500; frame += 1) {
    assert.equal(observeIdentity(identity, true, true, 0, 1), IDENTITY_STATE.ACTIVE);
  }
  assert.equal(identity.dropReason, IDENTITY_DROP_REASON.NONE);
  assert.equal(identity.sprtQ8, 0);
});

test('p_e=5% 가설에서 gated 불일치 3셀은 SPRT 드랍을 일으킨다', () => {
  const identity = createIdentity();
  assert.ok(identity.mismatchIncrementQ8 > 0);
  assert.ok(identity.matchIncrementQ8 < 0);
  assert.equal(observeIdentity(identity, true, true, 3, 0), IDENTITY_STATE.DROPPED);
  assert.equal(identity.dropReason, IDENTITY_DROP_REASON.SPRT);
});

test('정합 게이트를 통과하지 못한 불일치는 SPRT 증거가 되지 않는다', () => {
  const identity = createIdentity({ nCoast: 10 });
  observeIdentity(identity, true, false, 100, 0);
  assert.equal(identity.state, IDENTITY_STATE.COAST);
  assert.equal(identity.sprtQ8, 0);
  assert.equal(identity.dropReason, IDENTITY_DROP_REASON.NONE);
});

test('COAST 만료는 정확히 params.nCoast번째 공백 프레임에 발생한다', () => {
  for (let nCoast = 1; nCoast <= 20; nCoast += 1) {
    const identity = createIdentity({ nCoast });
    for (let frame = 1; frame < nCoast; frame += 1) {
      assert.equal(observeIdentity(identity, false, false), IDENTITY_STATE.COAST);
      assert.equal(identity.coastFrames, frame);
    }
    assert.equal(observeIdentity(identity, false, false), IDENTITY_STATE.DROPPED);
    assert.equal(identity.coastFrames, nCoast);
    assert.equal(identity.dropReason, IDENTITY_DROP_REASON.COAST_EXPIRED);
  }
});

test('COAST 재개는 gated 일치 증거가 -B를 넘은 뒤에만 허용된다', () => {
  const identity = createIdentity({ nCoast: 10 });
  observeIdentity(identity, false, false);
  assert.equal(identity.state, IDENTITY_STATE.COAST);

  assert.equal(observeIdentity(identity, true, true, 0, 1), IDENTITY_STATE.COAST);
  assert.equal(observeIdentity(identity, true, true, 0, 2), IDENTITY_STATE.ACTIVE);
  assert.equal(identity.coastFrames, 0);
});

