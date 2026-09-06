/** 후보의 관측 정체성. 움직이는 H는 정체성에 포함하지 않는다. */
export const R2_IDENTITY_FIELDS = Object.freeze([
  'profile', 'layoutId', 'dimensionKind', 'dimension', 'ecc', 'maskIndex',
  'wire', 'tones', 'orientation', 'sourceIdentity',
]);

function label(value) {
  return typeof value === 'string' && value.length > 0;
}

function scalarKey(value) {
  return label(value) || (Number.isInteger(value) && value >= 0);
}

/** 생성 경로 전용. 빠진 정체성은 추정하지 않고 null로 거부한다. */
export function createR2CandidateKey(context) {
  if (context === null || typeof context !== 'object'
    || !label(context.profile) || !label(context.layoutId)
    || !label(context.dimensionKind) || !label(context.ecc)
    || !Number.isInteger(context.dimension) || context.dimension <= 0
    || !Number.isInteger(context.maskIndex) || context.maskIndex < 0
    || !Number.isInteger(context.wire) || context.wire < 0
    || !scalarKey(context.tones) || !scalarKey(context.orientation)
    || !label(context.sourceIdentity)) return null;
  const key = {};
  for (const field of R2_IDENTITY_FIELDS) key[field] = context[field];
  return Object.freeze(key);
}

/** 무할당 비교. 누락된 필드끼리 undefined가 같다는 이유로 수용하지 않는다. */
export function sameR2CandidateKey(a, b) {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  for (let i = 0; i < R2_IDENTITY_FIELDS.length; i += 1) {
    const field = R2_IDENTITY_FIELDS[i];
    if (a[field] === undefined || a[field] !== b[field]) return false;
  }
  return true;
}

/** 포맷 미상은 관측 부족이다. 읽힌 모순과 같은 신호로 취급하지 않는다. */
export function r2FormatAllowsCandidate(key, format) {
  if (key === null || typeof key !== 'object' || format === null || typeof format !== 'object') return false;
  if (format.kind === 'unknown') return true;
  if (format.kind !== 'read') return false;
  return format.layoutId === key.layoutId && format.ecc === key.ecc
    && format.maskIndex === key.maskIndex && format.wire === key.wire;
}
