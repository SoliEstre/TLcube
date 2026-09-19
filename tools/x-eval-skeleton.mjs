/**
 * Type X D-2 evaluator boundary.
 *
 * This is deliberately not a detector.  It validates a bounded evaluation
 * manifest, projects blind detector arguments, and reports that the detector
 * stage is unimplemented.  Oracle truth remains evaluator-only and is never
 * passed to buildBlindInput().
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { X_PROFILES, X_PROFILE_IDS } from '../src/x-profile.js';

export const MANIFEST_SCHEMA_VERSION = 1;
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
export const MAX_MANIFEST_PIXELS = 16_000_000;

const MANIFEST_KEYS = new Set(['schemaVersion', 'samples']);
const SAMPLE_KEYS = new Set([
  'sampleId', 'corpusId', 'layoutId', 'profile', 'seedSplit', 'status',
  'blindInput', 'oracleTruth',
]);
const BLIND_KEYS = new Set([
  'schemaVersion', 'field', 'calibration', 'observationProfile', 'profiles',
  'budget', 'frameId', 'timestamp', 'sessionId', 'generation',
]);
const SAMPLE_STATUSES = new Set(['pending', 'available', 'unsupported', 'not-applicable']);
const STAGE_STATUSES = new Set(['pending', 'unsupported', 'not-applicable', 'unimplemented', 'not-run', 'completed']);
const SPLITS = new Set(['exploration', 'fixed-regression', 'holdout']);
const LAYOUTS = new Set(['x8-gpt-v1', 'lee-fo-v1']);
// Structural registry (N/c/layoutId) is derived from the producer `src/x-profile.js` — a hand copy drifts silently when
// X2 lands (integration commit). The closed DTO checks below (exact keys, tones 2/3, candidate cap) stay local on purpose.
const PROFILE_REGISTRY = Object.freeze(Object.fromEntries(X_PROFILE_IDS.map((id) => [
  id, Object.freeze({ N: X_PROFILES[id].N, c: X_PROFILES[id].c, layoutId: X_PROFILES[id].layoutId }),
])));
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

function fail(pathName, message) {
  throw new TypeError(`${pathName}: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, pathName) {
  if (!isPlainObject(value)) fail(pathName, 'must be a plain object');
}

function assertExactKeys(value, allowed, required, pathName) {
  assertPlainObject(value, pathName);
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (typeof key !== 'string') fail(pathName, 'must not have symbol keys');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) fail(`${pathName}.${key}`, 'must be enumerable');
    if (!Object.hasOwn(descriptor, 'value')) fail(`${pathName}.${key}`, 'must be a data property, not an accessor');
    if (!allowed.has(key)) fail(`${pathName}.${key}`, 'is not allowed');
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${pathName}.${key}`, 'is required');
  }
}

function assertDenseArray(value, pathName, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(pathName, `must be a dense array with ${min}..${max} entries`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
    fail(pathName, 'must not contain holes, extra properties, or symbols');
  }
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(`${pathName}[${index}]`, 'must be an enumerable data property');
    }
  }
}

function assertCleanTypedArray(value, constructor, pathName, expectedLength) {
  if (!(value instanceof constructor) || value.length !== expectedLength) {
    fail(pathName, `must be a ${constructor.name} matching width * height`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key)) {
      fail(pathName, 'must not have extra properties, symbols, or accessors');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${pathName}.${key}`, 'must be a data property');
  }
}

function assertSafeInteger(value, pathName, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(pathName, `must be a safe integer in [${min}, ${max}]`);
  }
}

function assertFiniteNumber(value, pathName, { min = -Infinity, max = Infinity, exclusiveMin = false } = {}) {
  if (!Number.isFinite(value) || value < min || value > max || (exclusiveMin && value <= min)) {
    fail(pathName, 'must be a finite number in range');
  }
}

function assertId(value, pathName) {
  if (typeof value !== 'string' || !ID_RE.test(value)) fail(pathName, 'must be a 1..64 character identifier');
}

function assertProfile(profile, pathName, layoutId = null) {
  assertExactKeys(profile, new Set(['profileId', 'N', 'c', 'tones']), ['profileId', 'N', 'c', 'tones'], pathName);
  // String check BEFORE any registry lookup: arrays, boxed Strings and toString/Symbol.toPrimitive objects were coerced by
  // ToPropertyKey and their conversion functions ran (REPORT_005). The message never interpolates the value.
  if (typeof profile.profileId !== 'string') fail(`${pathName}.profileId`, 'must be a string');
  const expected = Object.hasOwn(PROFILE_REGISTRY, profile.profileId) ? PROFILE_REGISTRY[profile.profileId] : null;
  if (!expected) fail(`${pathName}.profileId`, 'is not in the v1 profile registry');
  if (profile.N !== expected.N || profile.c !== expected.c) fail(pathName, 'does not match its bounded profile registry entry');
  if (profile.tones !== 2 && profile.tones !== 3) fail(`${pathName}.tones`, 'must be 2 or 3');
  if (layoutId !== null && layoutId !== expected.layoutId) {
    fail(pathName, `must use ${expected.layoutId} for ${profile.profileId}`);
  }
}

function assertLumaField(field, pathName, onPixels = null) {
  assertExactKeys(field, new Set(['width', 'height', 'data', 'alpha']), ['width', 'height', 'data'], pathName);
  assertSafeInteger(field.width, `${pathName}.width`, { min: 1, max: 4_000_000 });
  assertSafeInteger(field.height, `${pathName}.height`, { min: 1, max: 4_000_000 });
  const pixels = field.width * field.height;
  if (!Number.isSafeInteger(pixels) || pixels > 4_000_000) fail(pathName, 'exceeds 4,000,000 pixels');
  onPixels?.(pixels);
  assertCleanTypedArray(field.data, Float32Array, `${pathName}.data`, pixels);
  for (let index = 0; index < field.data.length; index += 1) {
    assertFiniteNumber(field.data[index], `${pathName}.data[${index}]`, { min: 0, max: 1 });
  }
  if (Object.hasOwn(field, 'alpha') && field.alpha != null
    && !((field.alpha instanceof Uint8Array) && field.alpha.length === pixels)) {
    fail(`${pathName}.alpha`, 'must be null or a Uint8Array matching width * height');
  }
  if (field.alpha != null) assertCleanTypedArray(field.alpha, Uint8Array, `${pathName}.alpha`, pixels);
  return pixels;
}

function assertCalibration(calibration, pathName, field) {
  assertExactKeys(calibration, new Set(['model', 'width', 'height', 'fx', 'fy', 'cx', 'cy']),
    ['model', 'width', 'height', 'fx', 'fy', 'cx', 'cy'], pathName);
  if (calibration.model !== 'pinhole-rectified') fail(`${pathName}.model`, 'must be pinhole-rectified');
  if (calibration.width !== field.width || calibration.height !== field.height) {
    fail(pathName, 'dimensions must match field');
  }
  assertFiniteNumber(calibration.fx, `${pathName}.fx`, { min: 0, exclusiveMin: true });
  assertFiniteNumber(calibration.fy, `${pathName}.fy`, { min: 0, exclusiveMin: true });
  assertFiniteNumber(calibration.cx, `${pathName}.cx`, { min: 0, max: field.width - 1 });
  assertFiniteNumber(calibration.cy, `${pathName}.cy`, { min: 0, max: field.height - 1 });
}

function assertObservationProfile(profile, pathName) {
  assertExactKeys(profile, new Set(['id', 'tones', 'lowLevel', 'highLevel', 'contrastMin', 'localGainMin', 'localGainMax']),
    ['id', 'tones', 'lowLevel', 'highLevel', 'contrastMin', 'localGainMin', 'localGainMax'], pathName);
  assertId(profile.id, `${pathName}.id`);
  if (profile.tones !== 2 && profile.tones !== 3) fail(`${pathName}.tones`, 'must be 2 or 3');
  assertFiniteNumber(profile.lowLevel, `${pathName}.lowLevel`, { min: 0, max: 1 });
  assertFiniteNumber(profile.highLevel, `${pathName}.highLevel`, { min: 0, max: 1 });
  if (profile.lowLevel >= profile.highLevel) fail(pathName, 'requires lowLevel < highLevel');
  assertFiniteNumber(profile.contrastMin, `${pathName}.contrastMin`, { min: 0, max: 1, exclusiveMin: true });
  assertFiniteNumber(profile.localGainMin, `${pathName}.localGainMin`, { min: 0, max: 1, exclusiveMin: true });
  assertFiniteNumber(profile.localGainMax, `${pathName}.localGainMax`, { min: 1, max: 4 });
}

function assertBlindProfiles(profiles, pathName, observationProfile) {
  assertDenseArray(profiles, pathName, { min: 1, max: 2 });
  const seen = new Set();
  for (let index = 0; index < profiles.length; index += 1) {
    const candidate = profiles[index];
    assertExactKeys(candidate, new Set(['profileId', 'layoutId', 'N', 'c', 'tones']),
      ['profileId', 'layoutId', 'N', 'c', 'tones'], `${pathName}[${index}]`);
    if (!LAYOUTS.has(candidate.layoutId)) fail(`${pathName}[${index}].layoutId`, 'is not in the v1 layout allowlist');
    assertProfile({
      profileId: candidate.profileId,
      N: candidate.N,
      c: candidate.c,
      tones: candidate.tones,
    }, `${pathName}[${index}]`, candidate.layoutId);
    if (candidate.tones !== observationProfile.tones) fail(`${pathName}[${index}].tones`, 'must match observationProfile.tones');
    const key = `${candidate.profileId}:${candidate.layoutId}:${candidate.tones}`;
    if (seen.has(key)) fail(`${pathName}[${index}]`, 'duplicates a profile candidate');
    seen.add(key);
  }
}

function assertBudget(budget, pathName) {
  assertExactKeys(budget, new Set(['maxMs', 'maxCandidates']), ['maxMs', 'maxCandidates'], pathName);
  assertFiniteNumber(budget.maxMs, `${pathName}.maxMs`, { min: 0, max: 100, exclusiveMin: true });
  assertSafeInteger(budget.maxCandidates, `${pathName}.maxCandidates`, { min: 1, max: 4 });
}

function validateBlindInput(value, pathName = 'blindInput', { onPixels = null } = {}) {
  assertExactKeys(value, BLIND_KEYS, BLIND_KEYS, pathName);
  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) fail(`${pathName}.schemaVersion`, 'must be 1');
  assertLumaField(value.field, `${pathName}.field`, onPixels);
  assertCalibration(value.calibration, `${pathName}.calibration`, value.field);
  assertObservationProfile(value.observationProfile, `${pathName}.observationProfile`);
  assertBlindProfiles(value.profiles, `${pathName}.profiles`, value.observationProfile);
  assertBudget(value.budget, `${pathName}.budget`);
  assertSafeInteger(value.frameId, `${pathName}.frameId`);
  assertFiniteNumber(value.timestamp, `${pathName}.timestamp`, { min: 0 });
  assertId(value.sessionId, `${pathName}.sessionId`);
  assertSafeInteger(value.generation, `${pathName}.generation`);
  return value;
}

function cloneBlindValue(value) {
  if (value instanceof Float32Array) return new Float32Array(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (Array.isArray(value)) return value.map(cloneBlindValue);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneBlindValue(entry)]));
  return value;
}

/**
 * Convert the JSON-only wire form used by the CLI into the runtime DTO.
 * This is deliberately narrow: only field.data and field.alpha numeric arrays
 * become typed arrays. All other keys remain subject to normal validation.
 */
export function fromWireManifest(wireManifest) {
  assertExactKeys(wireManifest, MANIFEST_KEYS, ['schemaVersion', 'samples'], 'wireManifest');
  assertDenseArray(wireManifest.samples, 'wireManifest.samples', { min: 1, max: 4_000 });
  let aggregatePixels = 0;
  const samples = wireManifest.samples.map((sample, index) => {
    const samplePath = `wireManifest.samples[${index}]`;
    assertExactKeys(sample, SAMPLE_KEYS,
      ['sampleId', 'corpusId', 'layoutId', 'profile', 'seedSplit', 'status', 'oracleTruth'], samplePath);
    const normalized = {};
    for (const key of SAMPLE_KEYS) {
      if (Object.hasOwn(sample, key)) normalized[key] = sample[key];
    }
    if (!Object.hasOwn(sample, 'blindInput') || sample.blindInput === null) return normalized;

    const blind = sample.blindInput;
    assertExactKeys(blind, BLIND_KEYS, BLIND_KEYS, `${samplePath}.blindInput`);
    assertExactKeys(blind.field, new Set(['width', 'height', 'data', 'alpha']), ['width', 'height', 'data'], `${samplePath}.blindInput.field`);
    assertSafeInteger(blind.field.width, `${samplePath}.field.width`, { min: 1, max: 4_000_000 });
    assertSafeInteger(blind.field.height, `${samplePath}.field.height`, { min: 1, max: 4_000_000 });
    const pixels = blind.field.width * blind.field.height;
    if (pixels > 4_000_000 || (aggregatePixels += pixels) > MAX_MANIFEST_PIXELS) fail(samplePath, 'wire aggregate pixel budget exceeded before allocation');
    if (blind.field.data?.length !== pixels || (blind.field.alpha != null && blind.field.alpha.length !== pixels)) fail(samplePath, 'wire pixel array length mismatch');
    assertDenseArray(blind.field.data, `${samplePath}.blindInput.field.data`, { min: 0, max: 4_000_000 });
    for (let dataIndex = 0; dataIndex < blind.field.data.length; dataIndex += 1) {
      assertFiniteNumber(blind.field.data[dataIndex], `${samplePath}.blindInput.field.data[${dataIndex}]`, { min: 0, max: 1 });
    }
    if (Object.hasOwn(blind.field, 'alpha') && blind.field.alpha != null) {
      assertDenseArray(blind.field.alpha, `${samplePath}.blindInput.field.alpha`, { min: 0, max: 4_000_000 });
      for (let alphaIndex = 0; alphaIndex < blind.field.alpha.length; alphaIndex += 1) {
        assertSafeInteger(blind.field.alpha[alphaIndex], `${samplePath}.blindInput.field.alpha[${alphaIndex}]`, { min: 0, max: 255 });
      }
    }
    const field = {};
    for (const key of ['width', 'height', 'data', 'alpha']) {
      if (Object.hasOwn(blind.field, key)) field[key] = blind.field[key];
    }
    field.data = Float32Array.from(blind.field.data);
    if (field.alpha != null) field.alpha = Uint8Array.from(field.alpha);
    const normalizedBlind = {};
    for (const key of BLIND_KEYS) normalizedBlind[key] = key === 'field' ? field : blind[key];
    normalized.blindInput = normalizedBlind;
    return normalized;
  });
  return { schemaVersion: wireManifest.schemaVersion, samples };
}

/**
 * Validate and copy the only values a future detector may receive.
 * It intentionally has no parameter through which oracle truth or callbacks
 * can be supplied.
 */
export function buildBlindInput(blindInput) {
  validateBlindInput(blindInput);
  const projection = {};
  for (const key of BLIND_KEYS) projection[key] = cloneBlindValue(blindInput[key]);
  return projection;
}

/** Validate the bounded, versioned manifest without reading a corpus. */
export function validateManifest(manifest) {
  assertExactKeys(manifest, MANIFEST_KEYS, ['schemaVersion', 'samples'], 'manifest');
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) fail('manifest.schemaVersion', 'must be 1');
  assertDenseArray(manifest.samples, 'manifest.samples', { min: 1, max: 4_000 });

  const sampleIds = new Set();
  const seedOwners = new Map();
  let aggregatePixels = 0;
  for (let index = 0; index < manifest.samples.length; index += 1) {
    const sample = manifest.samples[index];
    const samplePath = `manifest.samples[${index}]`;
    assertExactKeys(sample, SAMPLE_KEYS,
      ['sampleId', 'corpusId', 'layoutId', 'profile', 'seedSplit', 'status', 'oracleTruth'], samplePath);
    assertId(sample.sampleId, `${samplePath}.sampleId`);
    if (sampleIds.has(sample.sampleId)) fail(`${samplePath}.sampleId`, 'must be globally unique');
    sampleIds.add(sample.sampleId);
    assertId(sample.corpusId, `${samplePath}.corpusId`);
    if (!LAYOUTS.has(sample.layoutId)) fail(`${samplePath}.layoutId`, 'is not in the v1 layout allowlist');
    assertProfile(sample.profile, `${samplePath}.profile`, sample.layoutId);
    assertExactKeys(sample.seedSplit, new Set(['kind', 'seed']), ['kind', 'seed'], `${samplePath}.seedSplit`);
    if (!SPLITS.has(sample.seedSplit.kind)) fail(`${samplePath}.seedSplit.kind`, 'must be exploration, fixed-regression, or holdout');
    assertSafeInteger(sample.seedSplit.seed, `${samplePath}.seedSplit.seed`);
    const priorKind = seedOwners.get(sample.seedSplit.seed);
    if (priorKind !== undefined && priorKind !== sample.seedSplit.kind) {
      fail(`${samplePath}.seedSplit.seed`, 'must not be reused across seed splits');
    }
    seedOwners.set(sample.seedSplit.seed, sample.seedSplit.kind);
    if (!SAMPLE_STATUSES.has(sample.status)) fail(`${samplePath}.status`, 'is not a supported manifest status');
    assertExactKeys(sample.oracleTruth, new Set(['classification']), ['classification'], `${samplePath}.oracleTruth`);
    if (sample.oracleTruth.classification !== 'positive' && sample.oracleTruth.classification !== 'negative') {
      fail(`${samplePath}.oracleTruth.classification`, 'must be positive or negative');
    }
    if (sample.status === 'available') {
      if (!Object.hasOwn(sample, 'blindInput')) fail(`${samplePath}.blindInput`, 'is required for available samples');
      validateBlindInput(sample.blindInput, `${samplePath}.blindInput`, {
        onPixels(pixels) {
          aggregatePixels += pixels;
          if (aggregatePixels > MAX_MANIFEST_PIXELS) {
            fail(`${samplePath}.blindInput.field`, `aggregate manifest pixels exceed ${MAX_MANIFEST_PIXELS}`);
          }
        },
      });
      const matchesCandidate = sample.blindInput.profiles.some((candidate) => candidate.profileId === sample.profile.profileId
        && candidate.layoutId === sample.layoutId && candidate.tones === sample.profile.tones);
      if (!matchesCandidate) fail(`${samplePath}.blindInput.profiles`, 'must include the sample profile candidate');
    } else if (Object.hasOwn(sample, 'blindInput') && sample.blindInput != null) {
      fail(`${samplePath}.blindInput`, 'is only allowed for available samples');
    }
  }
  return manifest;
}

function publicStagesFor(status) {
  if (status === 'pending' || status === 'unsupported' || status === 'not-applicable') {
    return {
      structure: { status },
      oracle: { status: 'not-run' },
      blind: { status, accepted: false },
      body: { status },
    };
  }
  return {
    structure: { status: 'unimplemented', reason: 'structure-detector-unavailable', anchorsComplete: false, fullFrameComplete: false },
    oracle: { status: 'unimplemented', reason: 'oracle-mode-detector-unavailable' },
    blind: { status: 'unimplemented', reason: 'detector-unavailable', accepted: false },
    body: {
      status: 'unimplemented',
      reason: 'full-frame-body-verifier-unavailable',
      crcStatus: 'not-run',
      fullFrameVerified: false,
      profileValidated: false,
      domainValidated: false,
      lengthValidated: false,
    },
  };
}

function makeInternalResult(sample) {
  const stages = publicStagesFor(sample.status);
  return {
    manifestStatus: sample.status,
    // This field is evaluator-internal. evaluateManifest() never serializes it.
    oracle: { classification: sample.oracleTruth.classification, status: stages.oracle.status },
    blind: stages.blind,
    structure: stages.structure,
    body: stages.body,
  };
}

function isFullBodyAcceptance(result) {
  return result?.blind?.status === 'completed'
    && result.blind.accepted === true
    && result?.body?.status === 'completed'
    && result.body.fullFrameVerified === true
    && result.body.profileValidated === true
    && result.body.domainValidated === true
    && result.body.lengthValidated === true
    && result.body.crcStatus === 'valid'
    && result.body.partialCrc !== true;
}

function assertStageStatus(stage, pathName) {
  if (typeof stage.status !== 'string' || !STAGE_STATUSES.has(stage.status)) {
    fail(`${pathName}.status`, 'is not a known stage status');
  }
}

function assertOptionalReason(stage, pathName) {
  if (Object.hasOwn(stage, 'reason') && (typeof stage.reason !== 'string' || stage.reason.length < 1 || stage.reason.length > 128)) {
    fail(`${pathName}.reason`, 'must be a bounded non-empty string');
  }
}

function assertInternalResult(result, pathName) {
  assertExactKeys(result, new Set(['manifestStatus', 'oracle', 'blind', 'structure', 'body']),
    ['manifestStatus', 'oracle', 'blind', 'structure', 'body'], pathName);
  if (typeof result.manifestStatus !== 'string' || !SAMPLE_STATUSES.has(result.manifestStatus)) {
    fail(`${pathName}.manifestStatus`, 'is invalid');
  }

  assertExactKeys(result.oracle, new Set(['classification', 'status']), ['classification', 'status'], `${pathName}.oracle`);
  assertStageStatus(result.oracle, `${pathName}.oracle`);
  if (result.oracle.classification !== 'positive' && result.oracle.classification !== 'negative') {
    fail(`${pathName}.oracle.classification`, 'must be evaluator-only positive or negative truth');
  }

  assertExactKeys(result.blind, new Set(['status', 'reason', 'accepted', 'elapsedMs']), ['status', 'accepted'], `${pathName}.blind`);
  assertStageStatus(result.blind, `${pathName}.blind`);
  assertOptionalReason(result.blind, `${pathName}.blind`);
  if (typeof result.blind.accepted !== 'boolean') fail(`${pathName}.blind.accepted`, 'must be boolean');
  if (Object.hasOwn(result.blind, 'elapsedMs') && typeof result.blind.elapsedMs !== 'number') {
    fail(`${pathName}.blind.elapsedMs`, 'must be a number when supplied');
  }

  assertExactKeys(result.structure, new Set(['status', 'reason', 'anchorsComplete', 'fullFrameComplete', 'partialAnchors']), ['status'], `${pathName}.structure`);
  assertStageStatus(result.structure, `${pathName}.structure`);
  assertOptionalReason(result.structure, `${pathName}.structure`);
  for (const key of ['anchorsComplete', 'fullFrameComplete', 'partialAnchors']) {
    if (Object.hasOwn(result.structure, key) && typeof result.structure[key] !== 'boolean') {
      fail(`${pathName}.structure.${key}`, 'must be boolean');
    }
  }

  assertExactKeys(result.body, new Set(['status', 'reason', 'crcStatus', 'fullFrameVerified', 'profileValidated', 'domainValidated', 'lengthValidated', 'partialCrc']), ['status'], `${pathName}.body`);
  assertStageStatus(result.body, `${pathName}.body`);
  assertOptionalReason(result.body, `${pathName}.body`);
  if (Object.hasOwn(result.body, 'crcStatus') && !new Set(['valid', 'invalid', 'not-run']).has(result.body.crcStatus)) {
    fail(`${pathName}.body.crcStatus`, 'must be valid, invalid, or not-run');
  }
  for (const key of ['fullFrameVerified', 'profileValidated', 'domainValidated', 'lengthValidated', 'partialCrc']) {
    if (Object.hasOwn(result.body, key) && typeof result.body[key] !== 'boolean') {
      fail(`${pathName}.body.${key}`, 'must be boolean');
    }
  }
  if (result.blind.accepted && !isFullBodyAcceptance(result)) {
    fail(pathName, 'accepted result lacks complete body/profile/domain/length/CRC evidence');
  }
  if (result.manifestStatus !== 'available'
    && (result.blind.status !== result.manifestStatus || result.blind.accepted
      || result.body.status === 'completed')) fail(pathName, 'non-available sample has inconsistent completed/accepted evidence');
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil((percentileValue / 100) * ordered.length) - 1];
}

/**
 * Summarize evaluator-internal stage records. Only completed blind stages are
 * eligible for positive/negative denominators; an oracle stage can never add
 * an observation by itself.
 */
export function summarizeResults(results) {
  assertDenseArray(results, 'results', { min: 0, max: 4_000 });
  const coverage = {
    available: 0,
    pending: 0,
    unsupported: 0,
    notApplicable: 0,
    unimplemented: 0,
    completedBlind: 0,
    invalidTiming: 0,
  };
  const positive = { denominator: 0, accepted: 0 };
  const negative = { denominator: 0, falseAccepts: 0 };
  const elapsed = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    assertInternalResult(result, `results[${index}]`);
    if (result.manifestStatus === 'not-applicable') coverage.notApplicable += 1;
    else coverage[result.manifestStatus] += 1;
    if (result.blind.status === 'unimplemented') coverage.unimplemented += 1;
    if (Object.hasOwn(result.blind, 'elapsedMs')
      && (!Number.isFinite(result.blind.elapsedMs) || result.blind.elapsedMs < 0)) coverage.invalidTiming += 1;
    if (result.manifestStatus !== 'available' || result.blind.status !== 'completed') continue;
    coverage.completedBlind += 1;
    const accepted = isFullBodyAcceptance(result);
    if (result.oracle.classification === 'positive') {
      positive.denominator += 1;
      if (accepted) positive.accepted += 1;
    } else {
      negative.denominator += 1;
      if (accepted) negative.falseAccepts += 1;
    }
    if (Number.isFinite(result.blind.elapsedMs) && result.blind.elapsedMs >= 0) elapsed.push(result.blind.elapsedMs);
  }

  return {
    coverage,
    metrics: {
      positive: {
        denominator: positive.denominator,
        accepted: positive.accepted,
        acceptanceRate: positive.denominator === 0 ? null : positive.accepted / positive.denominator,
      },
      negative: {
        denominator: negative.denominator,
        falseAccepts: negative.falseAccepts,
        falsePositiveRate: negative.denominator === 0 ? null : negative.falseAccepts / negative.denominator,
      },
      elapsedMs: {
        finiteDenominator: elapsed.length,
        p50: percentile(elapsed, 50),
        p90: percentile(elapsed, 90),
        p95: percentile(elapsed, 95),
      },
    },
  };
}

function publicResult(sample, internal) {
  return {
    sampleId: sample.sampleId,
    corpusId: sample.corpusId,
    layoutId: sample.layoutId,
    profileId: sample.profile.profileId,
    seedSplit: sample.seedSplit.kind,
    manifestStatus: sample.status,
    stages: internal.structure && internal.body
      ? { structure: internal.structure, oracle: internal.oracle.status === 'not-run' ? { status: 'not-run' } : { status: internal.oracle.status }, blind: internal.blind, body: internal.body }
      : publicStagesFor(sample.status),
    accepted: false,
    elapsedMs: null,
  };
}

/**
 * Evaluate a manifest without accessing a corpus or network. Detector calls
 * are intentionally absent, so an available sample is rejected as
 * unimplemented and can never be reported as a success.
 */
export function evaluateManifest(manifest) {
  validateManifest(manifest);
  const internal = manifest.samples.map(makeInternalResult);
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    evaluator: 'type-x-d2-skeleton',
    detectorImplemented: false,
    results: manifest.samples.map((sample, index) => publicResult(sample, internal[index])),
    summary: summarizeResults(internal),
  };
}

function usage() {
  return [
    'Usage: node tools/x-eval-skeleton.mjs <manifest.json>',
    '',
    'Validates a bounded Type X D-2 manifest and prints an unimplemented evaluation result.',
    'No corpus is read and no detector or network operation is performed.',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (argv.length !== 1) {
    process.stderr.write(`${usage()}\n`);
    return 1;
  }
  const manifestPath = path.resolve(argv[0]);
  const metadata = await stat(manifestPath);
  if (!metadata.isFile()) fail('manifest', 'path must name a file');
  if (metadata.size > MAX_MANIFEST_BYTES) fail('manifest', `wire bytes exceed ${MAX_MANIFEST_BYTES}`);
  const raw = await readFile(manifestPath, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_MANIFEST_BYTES) fail('manifest', `wire bytes exceed ${MAX_MANIFEST_BYTES}`);
  const parsed = JSON.parse(raw);
  process.stdout.write(`${JSON.stringify(evaluateManifest(fromWireManifest(parsed)), null, 2)}\n`);
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().then((exitCode) => { process.exitCode = exitCode; }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
