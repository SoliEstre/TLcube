/**
 * Type X 관측 DTO v1의 경계 검증이에요.
 *
 * 이 모듈은 검출기나 진실값을 받지 않아요. 모든 시간값은 같은 세션 단조 시계의
 * 밀리초여야 하고, 관측의 siteId는 검출기가 추론한 출력일 뿐 blind 입력이 아니에요.
 */
import { X_PROFILES, X_PROFILE_IDS } from './x-profile.js';

export const X_OBSERVER_LIMITS = Object.freeze({
  SCHEMA_VERSION: 1,
  MAX_PIXELS: 4_000_000,
  MAX_PROFILES: 2,
  MAX_POSE_HYPOTHESES: 4,
  MAX_TRACKS: 8,
  MAX_BATCH_RECORDS: 4_000,
  MAX_FRAME_HISTORY: 64,
  FRAME_TTL_MS: 3_000,
  MAX_IDENTIFIER_LENGTH: 64,
  MAX_BUDGET_MS: 100,
  MAX_BUDGET_CANDIDATES: 4,
});

export const X_VISIBILITY_REASONS = Object.freeze([
  'visible', 'off', 'unknown', 'overlap', 'saturated', 'occluded', 'ghost', 'outOfView',
]);
export const X_DROPOUT_REASONS = Object.freeze([
  'emitterFailure', 'physicalOcclusion', 'detectorMiss',
]);

const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,64}$/;
const STATES = new Set(['observed', 'off', 'unknown', 'missing']);
const VISIBILITY = new Set(X_VISIBILITY_REASONS);
const STATE_REASONS = Object.freeze({
  observed: new Set(['visible']),
  off: new Set(['off']),
  unknown: new Set(['unknown', 'overlap', 'saturated', 'ghost']),
  missing: new Set(['occluded', 'outOfView']),
});
// 구조 registry(N/c/layoutId) 는 producer `x-profile.js` 에서 «유도» — 손 사본이면 X2 추가 때 조용히 어긋나요(통합 커밋, RT 합의).
// 외부 DTO 의 폐쇄형 자기 키 검사·tones 2/3·active 후보 ≤2 는 여기 그대로예요(xProfileDto 로 대체하지 않음 — 3톤 관측 연구 경로 보존).
const PROFILE_REGISTRY = Object.freeze(Object.fromEntries(X_PROFILE_IDS.map((id) => [
  id, Object.freeze({ N: X_PROFILES[id].N, c: X_PROFILES[id].c, layoutId: X_PROFILES[id].layoutId }),
])));

function fail(Type, message) { throw new Type(message); }
function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(TypeError, `${name} 객체가 필요해요`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(TypeError, `${name}은 plain object여야 해요`);
  return value;
}
function keys(value, allowed, name) {
  object(value, name);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail(TypeError, `${name}.${String(key)} 는 허용되지 않아요`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) {
      fail(TypeError, `${name}.${key} 는 enumerable own data property여야 해요`);
    }
  }
}
function required(value, names, name) {
  for (const key of names) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(TypeError, `${name}.${key} 가 필요해요`);
}
function denseArray(value, name) {
  if (!Array.isArray(value)) fail(TypeError, `${name} 배열이 필요해요`);
  const length = value.length;
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) fail(TypeError, `${name}은 dense array여야 해요`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) fail(TypeError, `${name}에 accessor가 있으면 안 돼요`);
  }
  for (let index = 0; index < length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) fail(TypeError, `${name}에 sparse hole이 있으면 안 돼요`);
  }
  return value;
}
function finite(value, name, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail(RangeError, `${name} 범위가 잘못됐어요`);
  return value;
}
function integer(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(RangeError, `${name} 안전 정수 범위가 잘못됐어요`);
  return value;
}
function identifier(value, name) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(TypeError, `${name} 식별자가 잘못됐어요`);
  return value;
}
function assertProfile(profile, name, confidenceRequired) {
  keys(profile, confidenceRequired
    ? ['profileId', 'layoutId', 'N', 'c', 'tones', 'confidence']
    : ['profileId', 'layoutId', 'N', 'c', 'tones'], name);
  const requiredKeys = ['profileId', 'layoutId', 'N', 'c', 'tones'];
  if (confidenceRequired) requiredKeys.push('confidence');
  required(profile, requiredKeys, name);
  // registry 조회 «전에» 문자열 검사 — 배열·boxed String·toString/Symbol.toPrimitive 객체가 ToPropertyKey 로 강제 변환돼 통과하고
  // 변환 함수까지 실행되던 결함(REPORT_005). 메시지에 값을 보간하지 않아요(호출 0).
  if (typeof profile.profileId !== 'string') fail(TypeError, `${name}.profileId 는 문자열이어야 해요`);
  const registry = Object.hasOwn(PROFILE_REGISTRY, profile.profileId) ? PROFILE_REGISTRY[profile.profileId] : null;
  if (!registry) fail(RangeError, `${name}.profileId 는 유한 registry 밖이에요`);
  if (profile.layoutId !== registry.layoutId) fail(RangeError, `${name}.layoutId 가 profile과 맞지 않아요`);
  integer(profile.N, `${name}.N`, 1, 1_000);
  integer(profile.c, `${name}.c`, 0, 0);
  if (profile.N !== registry.N || profile.c !== registry.c) fail(RangeError, `${name}의 N/c가 profile과 맞지 않아요`);
  integer(profile.tones, `${name}.tones`, 2, 3);
  if (confidenceRequired) finite(profile.confidence, `${name}.confidence`, 0, 1);
}
function assertLikelihood(value, tones, name) {
  denseArray(value, name);
  if (value.length !== tones) fail(TypeError, `${name}은 tones 길이 배열이어야 해요`);
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) sum += finite(value[index], `${name}[${index}]`, 0, 1);
  if (Math.abs(sum - 1) > 1e-6) fail(RangeError, `${name} 합계가 1이 아니에요`);
}
function assertNegativeEvidence(value) {
  keys(value, ['inView', 'separable', 'unoccluded', 'unsaturated', 'backgroundChecked'], 'negativeEvidence');
  required(value, ['inView', 'separable', 'unoccluded', 'unsaturated', 'backgroundChecked'], 'negativeEvidence');
  for (const key of Object.keys(value)) if (value[key] !== true) fail(TypeError, `negativeEvidence.${key} 는 true여야 해요`);
}

/**
 * 검출 전 blind DTO만 검증해요. 외부 GT pose/siteId/정답/seed는 어느 중첩 객체에도
 * allowlist되지 않았으므로 거절돼요. 이 함수는 입력을 변경하거나 보정하지 않아요.
 */
export function validateXBlindInput(input) {
  keys(input, ['schemaVersion', 'field', 'calibration', 'observationProfile', 'profiles', 'budget', 'frameId', 'timestamp', 'sessionId', 'generation'], 'input');
  required(input, ['schemaVersion', 'field', 'calibration', 'observationProfile', 'profiles', 'budget', 'frameId', 'timestamp', 'sessionId', 'generation'], 'input');
  integer(input.schemaVersion, 'schemaVersion', X_OBSERVER_LIMITS.SCHEMA_VERSION, X_OBSERVER_LIMITS.SCHEMA_VERSION);
  integer(input.frameId, 'frameId', 0, Number.MAX_SAFE_INTEGER);
  integer(input.generation, 'generation', 0, Number.MAX_SAFE_INTEGER);
  finite(input.timestamp, 'timestamp', 0, Number.MAX_VALUE);
  identifier(input.sessionId, 'sessionId');

  const { field } = input;
  keys(field, ['width', 'height', 'data', 'alpha'], 'field');
  required(field, ['width', 'height', 'data'], 'field');
  integer(field.width, 'field.width', 1, X_OBSERVER_LIMITS.MAX_PIXELS);
  integer(field.height, 'field.height', 1, X_OBSERVER_LIMITS.MAX_PIXELS);
  const pixels = field.width * field.height;
  if (!Number.isSafeInteger(pixels) || pixels > X_OBSERVER_LIMITS.MAX_PIXELS) fail(RangeError, 'field 픽셀 상한을 넘었어요');
  // data/alpha는 픽셀 transport buffer예요. 4Mpx마다 ancillary own-key 검사를 하지 않고
  // ArrayBuffer view의 타입·길이와 개별 sample 값만 이 DTO 경계에서 검사해요.
  if (!(field.data instanceof Float32Array) || field.data.length !== pixels) fail(TypeError, 'field.data는 픽셀 수와 같은 Float32Array여야 해요');
  for (let index = 0; index < field.data.length; index += 1) finite(field.data[index], `field.data[${index}]`, 0, 1);
  if (field.alpha != null && (!(field.alpha instanceof Uint8Array) || field.alpha.length !== pixels)) fail(TypeError, 'field.alpha는 null 또는 픽셀 수와 같은 Uint8Array여야 해요');

  const { calibration } = input;
  keys(calibration, ['model', 'width', 'height', 'fx', 'fy', 'cx', 'cy'], 'calibration');
  required(calibration, ['model', 'width', 'height', 'fx', 'fy', 'cx', 'cy'], 'calibration');
  if (calibration.model !== 'pinhole-rectified') fail(TypeError, 'calibration.model은 pinhole-rectified여야 해요');
  if (calibration.width !== field.width || calibration.height !== field.height) fail(RangeError, 'calibration 크기가 field와 달라요');
  finite(calibration.fx, 'calibration.fx', Number.MIN_VALUE, Number.MAX_VALUE);
  finite(calibration.fy, 'calibration.fy', Number.MIN_VALUE, Number.MAX_VALUE);
  finite(calibration.cx, 'calibration.cx', 0, field.width - 1);
  finite(calibration.cy, 'calibration.cy', 0, field.height - 1);

  const { observationProfile } = input;
  keys(observationProfile, ['id', 'tones', 'lowLevel', 'highLevel', 'contrastMin', 'localGainMin', 'localGainMax'], 'observationProfile');
  required(observationProfile, ['id', 'tones', 'lowLevel', 'highLevel', 'contrastMin', 'localGainMin', 'localGainMax'], 'observationProfile');
  identifier(observationProfile.id, 'observationProfile.id');
  integer(observationProfile.tones, 'observationProfile.tones', 2, 3);
  finite(observationProfile.lowLevel, 'observationProfile.lowLevel', 0, 1);
  finite(observationProfile.highLevel, 'observationProfile.highLevel', 0, 1);
  if (!(observationProfile.lowLevel < observationProfile.highLevel)) fail(RangeError, 'observationProfile low/high 순서가 잘못됐어요');
  finite(observationProfile.contrastMin, 'observationProfile.contrastMin', Number.MIN_VALUE, 1);
  finite(observationProfile.localGainMin, 'observationProfile.localGainMin', Number.MIN_VALUE, 1);
  finite(observationProfile.localGainMax, 'observationProfile.localGainMax', 1, 4);

  denseArray(input.profiles, 'profiles');
  if (input.profiles.length < 1 || input.profiles.length > X_OBSERVER_LIMITS.MAX_PROFILES) fail(RangeError, 'profiles는 1..2개여야 해요');
  const seenProfiles = new Set();
  for (let index = 0; index < input.profiles.length; index += 1) {
    const profile = input.profiles[index];
    assertProfile(profile, `profiles[${index}]`, false);
    if (profile.tones !== observationProfile.tones) fail(RangeError, 'profiles.tones가 observationProfile과 달라요');
    const profileKey = `${profile.profileId}/${profile.layoutId}`;
    if (seenProfiles.has(profileKey)) fail(RangeError, 'profiles 중복이에요');
    seenProfiles.add(profileKey);
  }

  const { budget } = input;
  keys(budget, ['maxMs', 'maxCandidates'], 'budget');
  required(budget, ['maxMs', 'maxCandidates'], 'budget');
  finite(budget.maxMs, 'budget.maxMs', Number.MIN_VALUE, X_OBSERVER_LIMITS.MAX_BUDGET_MS);
  integer(budget.maxCandidates, 'budget.maxCandidates', 1, X_OBSERVER_LIMITS.MAX_BUDGET_CANDIDATES);
  return input;
}

/** 관측 레코드를 검증해요. 반환값은 편의를 위한 원 입력 참조이며 수정하지 않아요. */
export function validateXObservation(record) {
  keys(record, ['schemaVersion', 'frameId', 'generation', 'timestamp', 'sessionId', 'trackId', 'poseHypothesisId', 'profileEvidence', 'siteId', 'state', 'levelLikelihood', 'visibilityReason', 'negativeEvidence'], 'record');
  required(record, ['schemaVersion', 'frameId', 'generation', 'timestamp', 'sessionId', 'trackId', 'poseHypothesisId', 'profileEvidence', 'siteId', 'state', 'levelLikelihood', 'visibilityReason', 'negativeEvidence'], 'record');
  integer(record.schemaVersion, 'record.schemaVersion', X_OBSERVER_LIMITS.SCHEMA_VERSION, X_OBSERVER_LIMITS.SCHEMA_VERSION);
  integer(record.frameId, 'record.frameId', 0, Number.MAX_SAFE_INTEGER);
  integer(record.generation, 'record.generation', 0, Number.MAX_SAFE_INTEGER);
  finite(record.timestamp, 'record.timestamp', 0, Number.MAX_VALUE);
  identifier(record.sessionId, 'record.sessionId');
  identifier(record.trackId, 'record.trackId');
  identifier(record.poseHypothesisId, 'record.poseHypothesisId');
  assertProfile(record.profileEvidence, 'profileEvidence', true);
  integer(record.siteId, 'record.siteId', 0, record.profileEvidence.N ** 3 - 1);
  if (!STATES.has(record.state)) fail(TypeError, 'record.state가 잘못됐어요');
  if (!VISIBILITY.has(record.visibilityReason) || !STATE_REASONS[record.state].has(record.visibilityReason)) fail(TypeError, 'state와 visibilityReason 조합이 잘못됐어요');
  if (record.state === 'observed' || record.state === 'off') assertLikelihood(record.levelLikelihood, record.profileEvidence.tones, 'levelLikelihood');
  else if (record.levelLikelihood !== null) fail(TypeError, 'unknown/missing levelLikelihood는 null이어야 해요');
  if (record.state === 'off') assertNegativeEvidence(record.negativeEvidence);
  else if (record.negativeEvidence !== null) fail(TypeError, 'off 이외 negativeEvidence는 null이어야 해요');
  return record;
}

function cloneFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozen));
  if (value && typeof value === 'object') {
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = cloneFrozen(value[key]);
    return Object.freeze(copy);
  }
  return value;
}

/** 검증된 관측의 깊은 복제·동결본을 만들어요. 호출자 입력과 내부 참조를 공유하지 않아요. */
export function createXObservation(record) {
  validateXObservation(record);
  return cloneFrozen(record);
}

const IMMUTABLE_IDENTITY = Object.freeze([
  'schemaVersion', 'frameId', 'generation', 'timestamp', 'sessionId', 'trackId', 'poseHypothesisId', 'profileEvidence', 'siteId',
]);
const MUTABLE_OBSERVATION_FIELDS = Object.freeze(['state', 'levelLikelihood', 'visibilityReason', 'negativeEvidence']);

/**
 * 같은 frame/session/track/pose/profile/site identity 안에서만 상태 근거를 바꿔요.
 * 새 프레임·새 시각·새 profile/site는 새 레코드로 만들고 배치에서 별도로 검증해야 해요.
 */
export function transitionXObservation(record, change) {
  validateXObservation(record);
  keys(change, MUTABLE_OBSERVATION_FIELDS, 'change');
  if (Object.keys(change).length === 0) fail(TypeError, 'change에 상태 근거가 필요해요');
  for (const key of IMMUTABLE_IDENTITY) if (Object.prototype.hasOwnProperty.call(change, key)) fail(TypeError, `${key} identity는 전이할 수 없어요`);
  const next = { ...record, ...change };
  return createXObservation(next);
}

/** 한 카메라 프레임의 동질 관측 묶음을 검증하고 깊게 동결한 복제본을 돌려줘요. */
export function validateXObservationBatch(records) {
  denseArray(records, 'records');
  if (records.length > X_OBSERVER_LIMITS.MAX_BATCH_RECORDS) fail(RangeError, 'records는 0..4000개 배열이어야 해요');
  if (records.length === 0) return Object.freeze([]);
  const first = validateXObservation(records[0]);
  const duplicates = new Set();
  const tracks = new Set();
  for (const record of records) {
    validateXObservation(record);
    tracks.add(record.trackId);
  }
  if (tracks.size > X_OBSERVER_LIMITS.MAX_TRACKS) fail(RangeError, 'batch track 상한을 넘었어요');
  const poses = new Set();
  const profiles = new Map();
  const poseProfileSites = new Map();
  const frozen = records.map((record, index) => {
    validateXObservation(record);
    for (const key of ['frameId', 'timestamp', 'sessionId', 'generation']) {
      if (record[key] !== first[key]) fail(RangeError, `records[${index}]는 batch ${key}가 달라요`);
    }
    const key = [record.sessionId, record.trackId, record.poseHypothesisId, record.profileEvidence.profileId, record.profileEvidence.layoutId, record.frameId, record.siteId].join('|');
    if (duplicates.has(key)) fail(RangeError, `records[${index}] identity가 중복돼요`);
    duplicates.add(key);
    const poseKey = `${record.trackId}|${record.poseHypothesisId}`;
    poses.add(poseKey);
    if (poses.size > X_OBSERVER_LIMITS.MAX_POSE_HYPOTHESES) fail(RangeError, 'batch pose hypothesis 상한을 넘었어요');
    const profileKey = `${record.profileEvidence.profileId}|${record.profileEvidence.layoutId}`;
    const profileDefinition = [record.profileEvidence.N, record.profileEvidence.c, record.profileEvidence.tones].join('|');
    const previousDefinition = profiles.get(profileKey);
    if (previousDefinition !== undefined && previousDefinition !== profileDefinition) fail(RangeError, '같은 profile identity의 N/c/tones가 달라요');
    profiles.set(profileKey, profileDefinition);
    if (profiles.size > X_OBSERVER_LIMITS.MAX_PROFILES) fail(RangeError, 'batch profile 상한을 넘었어요');
    const siteKey = `${poseKey}|${profileKey}`;
    const siteCount = (poseProfileSites.get(siteKey) ?? 0) + 1;
    if (siteCount > record.profileEvidence.N ** 3) fail(RangeError, 'pose/profile site 상한을 넘었어요');
    poseProfileSites.set(siteKey, siteCount);
    return createXObservation(record);
  });
  return Object.freeze(frozen);
}
