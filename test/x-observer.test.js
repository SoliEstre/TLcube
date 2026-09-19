import assert from 'node:assert/strict';
import test from 'node:test';
import {
  X_DROPOUT_REASONS, X_VISIBILITY_REASONS, createXObservation, transitionXObservation,
  validateXBlindInput, validateXObservation, validateXObservationBatch,
} from '../src/x-observer.js';

function blind(overrides = {}) {
  const out = {
    schemaVersion: 1, frameId: 0, generation: 0, timestamp: 10, sessionId: 'session.1',
    field: { width: 2, height: 2, data: new Float32Array([0, 0.25, 0.5, 1]) },
    calibration: { model: 'pinhole-rectified', width: 2, height: 2, fx: 1, fy: 1, cx: 0, cy: 0 },
    observationProfile: { id: 'off-2t', tones: 2, lowLevel: 0, highLevel: 1, contrastMin: 0.1, localGainMin: 0.5, localGainMax: 2 },
    profiles: [{ profileId: 'X0', layoutId: 'lee-fo-v1', N: 8, c: 0, tones: 2 }],
    budget: { maxMs: 10, maxCandidates: 1 },
  };
  return { ...out, ...overrides };
}
function observed(overrides = {}) {
  const out = {
    schemaVersion: 1, frameId: 0, generation: 0, timestamp: 10, sessionId: 'session.1', trackId: 'track.1', poseHypothesisId: 'pose.1',
    profileEvidence: { profileId: 'X0', layoutId: 'lee-fo-v1', N: 8, c: 0, tones: 2, confidence: 0.9 },
    siteId: 0, state: 'observed', levelLikelihood: [0.2, 0.8], visibilityReason: 'visible', negativeEvidence: null,
  };
  return { ...out, ...overrides };
}

test('blind DTO는 allowlist와 유한 registry만 받고 GT 키를 막아요', () => {
  const input = blind();
  const pixels = [...input.field.data];
  assert.equal(validateXBlindInput(input), input);
  assert.deepEqual([...input.field.data], pixels, '검증이 픽셀을 바꾸면 안 돼요');
  assert.throws(() => validateXBlindInput({ ...input, groundTruthPose: {} }), /허용/);
  assert.throws(() => validateXBlindInput(blind({ field: { ...input.field, siteId: 3 } })), /허용/);
  assert.throws(() => validateXBlindInput(blind({ profiles: [{ ...input.profiles[0], layoutId: 'x8-gpt-v1', N: 10 }] })), /profile/);
  assert.throws(() => validateXBlindInput(blind({ profiles: [{ ...input.profiles[0], confidence: 1 }] })), /허용/);
  assert.throws(() => validateXBlindInput(blind({ calibration: { ...input.calibration, bitDepth: 8 } })), /허용/);
});

test('producer profile registry X0/X0g/X1 매핑을 엄격히 지켜요', () => {
  assert.doesNotThrow(() => validateXBlindInput(blind({ profiles: [{ profileId: 'X0g', layoutId: 'x8-gpt-v1', N: 8, c: 0, tones: 2 }] })));
  assert.throws(() => validateXBlindInput(blind({ profiles: [{ profileId: 'X0g', layoutId: 'x8-gpt-v1', N: 10, c: 0, tones: 2 }] })), /N.c/);
  assert.throws(() => validateXBlindInput(blind({ profiles: [{ profileId: 'X0g', layoutId: 'lee-fo-v1', N: 8, c: 0, tones: 2 }] })), /layoutId/);
  assert.throws(() => validateXBlindInput(blind({ profiles: [{ profileId: 'X0', layoutId: 'x8-gpt-v1', N: 8, c: 0, tones: 2 }] })), /layoutId/);
});

test('관측 state, off 음의 근거, 식별자와 확률 경계를 검증해요', () => {
  assert.doesNotThrow(() => validateXObservation(observed()));
  const off = observed({ state: 'off', visibilityReason: 'off', negativeEvidence: { inView: true, separable: true, unoccluded: true, unsaturated: true, backgroundChecked: true } });
  assert.doesNotThrow(() => validateXObservation(off));
  assert.throws(() => validateXObservation(observed({ state: 'unknown', visibilityReason: 'off', levelLikelihood: null })), /조합/);
  assert.throws(() => validateXObservation(observed({ state: 'missing', visibilityReason: 'occluded', levelLikelihood: [0.5, 0.5] })), /null/);
  assert.throws(() => validateXObservation(observed({ state: 'off', visibilityReason: 'off', negativeEvidence: { ...off.negativeEvidence, backgroundChecked: false } })), /true/);
  assert.throws(() => validateXObservation(observed({ trackId: 'bad space' })), /식별자/);
  assert.throws(() => validateXObservation(observed({ siteId: 512 })), /범위/);
  assert.throws(() => validateXObservation(observed({ profileEvidence: { ...observed().profileEvidence, score: 1 } })), /허용/);
});

test('생성본은 깊게 복제·freeze하고 전이는 identity를 보존해요', () => {
  const source = observed();
  const frozen = createXObservation(source);
  source.levelLikelihood[0] = 1;
  assert.deepEqual(frozen.levelLikelihood, [0.2, 0.8]);
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.levelLikelihood), true);
  const off = transitionXObservation(frozen, {
    state: 'off', visibilityReason: 'off', levelLikelihood: [0.5, 0.5],
    negativeEvidence: { inView: true, separable: true, unoccluded: true, unsaturated: true, backgroundChecked: true },
  });
  assert.equal(off.frameId, frozen.frameId);
  assert.equal(off.sessionId, frozen.sessionId);
  assert.equal(off.state, 'off');
  assert.throws(() => transitionXObservation(frozen, { frameId: 1 }), /허용/);
  assert.throws(() => transitionXObservation(frozen, { profileEvidence: { ...frozen.profileEvidence } }), /허용/);
});

test('batch는 frame/session/generation/timestamp 동질성과 중복·상한을 강제해요', () => {
  const first = observed();
  const second = observed({ siteId: 1 });
  const batch = validateXObservationBatch([first, second]);
  assert.equal(Object.isFrozen(batch), true);
  assert.throws(() => validateXObservationBatch([first, observed()]), /중복/);
  assert.throws(() => validateXObservationBatch([first, observed({ siteId: 1, timestamp: 11 })]), /timestamp/);
  assert.throws(() => validateXObservation({ ...first, extra: true }), /허용/);
  assert.deepEqual(X_VISIBILITY_REASONS, ['visible', 'off', 'unknown', 'overlap', 'saturated', 'occluded', 'ghost', 'outOfView']);
  assert.deepEqual(X_DROPOUT_REASONS, ['emitterFailure', 'physicalOcclusion', 'detectorMiss']);
});

test('own data property, dense array, 수치 경계와 batch 가설 상한을 강제해요', () => {
  const input = blind();
  const inherited = Object.create(input);
  assert.throws(() => validateXBlindInput(inherited), /plain object/);
  const accessor = blind();
  Object.defineProperty(accessor, 'field', { enumerable: true, get() { throw new Error('getter must not run'); } });
  assert.throws(() => validateXBlindInput(accessor), /data property/);
  const hidden = blind();
  Object.defineProperty(hidden, 'secret', { value: true });
  assert.throws(() => validateXBlindInput(hidden), /허용/);
  assert.throws(() => validateXBlindInput(blind({ field: { ...input.field, data: new Float32Array([0, NaN, 0, 1]) } })), /범위/);
  assert.throws(() => validateXObservation(observed({ levelLikelihood: [1, 1] })), /합계/);
  const sparse = [0.5, 0.5]; delete sparse[1];
  assert.throws(() => validateXObservation(observed({ levelLikelihood: sparse })), /sparse/);
  assert.throws(() => validateXObservationBatch(new Array(4_001).fill(observed())), /4000/);
  assert.throws(() => validateXObservationBatch(Array.from({ length: 9 }, (_, index) => observed({ trackId: `t${index}`, siteId: index }))), /track/);
  assert.throws(() => validateXObservationBatch(Array.from({ length: 5 }, (_, index) => observed({ poseHypothesisId: `p${index}`, siteId: index }))), /pose/);
  assert.throws(() => validateXObservationBatch([
    observed(),
    observed({ siteId: 1, profileEvidence: { profileId: 'X0g', layoutId: 'x8-gpt-v1', N: 8, c: 0, tones: 2, confidence: 0.8 } }),
    observed({ siteId: 2, profileEvidence: { profileId: 'X1', layoutId: 'lee-fo-v1', N: 10, c: 0, tones: 2, confidence: 0.8 } }),
  ]), /profile 상한/);
  assert.throws(() => validateXObservationBatch([
    observed(),
    observed({ siteId: 1, profileEvidence: { ...observed().profileEvidence, tones: 3 }, levelLikelihood: [1 / 3, 1 / 3, 1 / 3] }),
  ]), /N.c.tones/);
});
