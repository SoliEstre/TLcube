/**
 * D-1(x-profile/x-project/x-synth-render, Claude) ↔ D-2(x-observer/x-eval-skeleton, codex) 통합 자 — 두 레인이 단독으로는 못 보는 «합성 결함» 만 재요.
 * ① profile registry 가 producer 에서 유도되어 두 소비자와 같은가(사본이 어긋나면 blind DTO 가 producer 프로파일을 거절해요)
 * ② producer 의 xProfileDto 출력과 합성 렌더의 blind 산출(camera + f32 luma)이 그대로 validateXBlindInput / buildBlindInput / validateManifest 를 통과하는가
 * ③ truth 의 정답 키는 blind 에 없고, 넣으면 거절되는가(계약 X 불변 1 의 기계적 확인)
 * ④ 비문자열 profileId(배열·boxed String·toString/Symbol.toPrimitive 함수·getter) 는 5 경로 전부 «즉시 거절 + 변환 함수/getter 호출 0»(codex REPORT_005)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { X_PROFILE_IDS, X_PROFILES, xProfileDto } from '../src/x-profile.js';
import { validateXBlindInput, validateXObservation, X_OBSERVER_LIMITS } from '../src/x-observer.js';
import { buildBlindInput, validateManifest } from '../tools/x-eval-skeleton.mjs';
import { renderXSynth } from '../tools/x-synth-render.mjs';

const OBS_PROFILE = { id: 'xa-2tone-v0', tones: 2, lowLevel: 0.05, highLevel: 0.6, contrastMin: 0.2, localGainMin: 0.5, localGainMax: 2 };

function blindFrom(render, profiles, extra = {}) {
  const { camera } = render.blind;
  return {
    schemaVersion: X_OBSERVER_LIMITS.SCHEMA_VERSION,
    field: { width: render.width, height: render.height, data: render.luma },
    calibration: { model: camera.model, width: camera.width, height: camera.height, fx: camera.fx, fy: camera.fy, cx: camera.cx, cy: camera.cy },
    observationProfile: OBS_PROFILE,
    profiles,
    budget: { maxMs: 50, maxCandidates: 2 },
    frameId: 0, timestamp: 0, sessionId: 'rehearsal-1', generation: 0,
    ...extra,
  };
}
function record(profileEvidence) {
  return {
    schemaVersion: 1, frameId: 0, generation: 0, timestamp: 10, sessionId: 'session.1', trackId: 'track.1', poseHypothesisId: 'pose.1',
    profileEvidence, siteId: 0, state: 'observed', levelLikelihood: [0.2, 0.8], visibilityReason: 'visible', negativeEvidence: null,
  };
}
function sample(profile, status, blindInput) {
  const s = { sampleId: `s-${status}`, corpusId: 'c1', layoutId: profile.layoutId ?? 'lee-fo-v1', profile: { profileId: profile.profileId, N: profile.N, c: profile.c, tones: profile.tones },
    seedSplit: { kind: 'exploration', seed: status === 'available' ? 2 : 1 }, status, oracleTruth: { classification: 'positive' } };
  if (blindInput) s.blindInput = blindInput;
  return s;
}
const manifest = samples => ({ schemaVersion: 1, samples });
const tiny = () => renderXSynth({ profile: 'X0', text: 'reh', width: 16, height: 16, fov: 40, noise: 0 });

test('통합 ① — producer registry 의 모든 프로파일 DTO 가 observer blind · evaluator build/manifest 를 통과해요(유도된 사본)', () => {
  const r = tiny();
  for (const id of X_PROFILE_IDS) {
    const dto = xProfileDto(id);
    assert.doesNotThrow(() => validateXBlindInput(blindFrom(r, [dto])), `observer ${id}`);
    assert.doesNotThrow(() => validateXObservation(record({ ...dto, confidence: 0.5 })), `record ${id}`);
    assert.doesNotThrow(() => buildBlindInput(blindFrom(r, [dto])), `evaluator build ${id}`);
    assert.doesNotThrow(() => validateManifest(manifest([sample(dto, 'pending')])), `manifest pending ${id}`);
    assert.doesNotThrow(() => validateManifest(manifest([sample(dto, 'available', blindFrom(r, [dto]))])), `manifest available ${id}`);
  }
  // 후보 상한 2 는 registry 크기와 별개
  assert.doesNotThrow(() => validateXBlindInput(blindFrom(r, [xProfileDto('X0'), xProfileDto('X1')])));
  assert.throws(() => validateXBlindInput(blindFrom(r, X_PROFILE_IDS.map(xProfileDto))), RangeError);
  // 어긋난 사본 시뮬레이션: layoutId/N 을 바꾸면 두 소비자 모두 거절
  assert.throws(() => validateXBlindInput(blindFrom(r, [{ ...xProfileDto('X0'), layoutId: 'x8-gpt-v1' }])), RangeError);
  assert.throws(() => validateXBlindInput(blindFrom(r, [{ ...xProfileDto('X1'), N: 8 }])), RangeError);
  assert.throws(() => validateManifest(manifest([sample({ ...xProfileDto('X1'), N: 8 }, 'pending')])), TypeError);
  // 미지 id 는 두 소비자 모두 거절(유도된 registry 밖)
  assert.throws(() => validateXBlindInput(blindFrom(r, [{ ...xProfileDto('X0'), profileId: 'X2' }])), RangeError);
  assert.throws(() => validateManifest(manifest([sample({ ...xProfileDto('X0'), profileId: 'X2' }, 'pending')])), TypeError);
});

test('통합 ② — 합성 렌더의 blind 산출(camera + Float32 luma) 이 그대로 blind 입력이 돼요 (X0·X1, 두 해상도, observer 와 evaluator)', () => {
  for (const [profile, width, height] of [['X0', 160, 120], ['X1', 320, 240]]) {
    const r = renderXSynth({ profile, text: 'reh', width, height, fov: 40, az: 30, el: 20 });
    assert.equal(r.luma.length, width * height);
    const input = blindFrom(r, [xProfileDto(profile)]);
    assert.doesNotThrow(() => validateXBlindInput(input), `${profile} ${width}×${height}`);
    assert.deepEqual(input.calibration, r.blind.camera);
    const built = buildBlindInput(input);
    assert.deepEqual(Object.keys(built).sort(), ['budget', 'calibration', 'field', 'frameId', 'generation', 'observationProfile', 'profiles', 'schemaVersion', 'sessionId', 'timestamp']);
  }
});

test('통합 ③ — truth 의 정답 키를 blind 에 섞으면 observer·evaluator 가 거절해요(불변 1 의 기계적 확인)', () => {
  const r = tiny();
  const base = blindFrom(r, [xProfileDto('X0')]);
  for (const key of ['pose', 'levels', 'digits', 'points', 'text', 'overlap', 'visibility', 'dropout', 'seed', 'truth', 'emission']) {
    assert.throws(() => validateXBlindInput({ ...base, [key]: r.truth[key] ?? 1 }), TypeError, `observer blind.${key}`);
    assert.throws(() => buildBlindInput({ ...base, [key]: r.truth[key] ?? 1 }), TypeError, `evaluator blind.${key}`);
  }
  assert.ok(Object.keys(r.blind).every(k => ['schemaVersion', 'camera', 'width', 'height', 'imageSha256', 'lumaFormat'].includes(k)));
  assert.throws(() => validateXBlindInput(blindFrom(r, [{ ...X_PROFILES.X0 }])), TypeError, 'profile 원본(ecc·label) 은 allowlist 밖');
});

test('통합 ④ — 비문자열 profileId 6종 × 5 경로: 즉시 거절 + 변환 함수/getter 호출 0 (codex REPORT_005)', () => {
  const r = tiny();
  const calls = { fn: 0, getter: 0 };
  const kinds = {
    array: () => ['X0'],
    boxed: () => new String('X0'),
    toStringFn: () => ({ toString() { calls.fn += 1; return 'X0'; } }),
    toPrimitiveFn: () => ({ [Symbol.toPrimitive]() { calls.fn += 1; return 'X0'; } }),
    toPrimitiveGetter: () => ({ get [Symbol.toPrimitive]() { calls.getter += 1; return () => { calls.fn += 1; return 'X0'; }; } }),
    toStringGetter: () => Object.defineProperty({}, 'toString', { enumerable: true, get() { calls.getter += 1; return () => { calls.fn += 1; return 'X0'; }; } }),
  };
  for (const [kind, make] of Object.entries(kinds)) {
    const bad = make();
    const dto = { ...xProfileDto('X0'), profileId: bad };
    // observer blind
    assert.throws(() => validateXBlindInput(blindFrom(r, [dto])), TypeError, `${kind} observer blind`);
    // observer 관측 record
    assert.throws(() => validateXObservation(record({ ...dto, confidence: 0.5 })), TypeError, `${kind} record`);
    // evaluator build
    assert.throws(() => buildBlindInput(blindFrom(r, [dto])), TypeError, `${kind} build`);
    // evaluator manifest pending
    assert.throws(() => validateManifest(manifest([sample(dto, 'pending')])), TypeError, `${kind} pending`);
    // evaluator manifest available — sample.profile 과 blind 후보가 같은 객체 id 를 공유(shared) / blind 만 객체(blind-only)
    assert.throws(() => validateManifest(manifest([sample(dto, 'available', blindFrom(r, [dto]))])), TypeError, `${kind} available shared`);
    assert.throws(() => validateManifest(manifest([sample(xProfileDto('X0'), 'available', blindFrom(r, [dto]))])), TypeError, `${kind} available blind-only`);
    assert.deepEqual(calls, { fn: 0, getter: 0 }, `${kind}: 거절 경로에서 변환 함수/getter 가 실행됐어요`);
  }
  // 정상 문자열 X0/X0g/X1 · tones 2/3 · 후보 2 허용 / 3 거절은 유지
  for (const id of X_PROFILE_IDS) {
    assert.doesNotThrow(() => validateXBlindInput(blindFrom(r, [{ ...xProfileDto(id), tones: 3 }], { observationProfile: { ...OBS_PROFILE, tones: 3 } })), `${id} tones 3`);
  }
});
