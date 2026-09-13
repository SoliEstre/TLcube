import { classifyQrValue, QR_VALUE_KIND } from './qr-bridge.js';
import { decodeCentralN7 } from './centralN7Codec.js';
import { CENTRAL_N7_PATTERN_FAMILY_ID, CENTRAL_N7_SCHEMA_ID } from './centralN7Schema.js';

const NON_CUBE = new Set(['hex', 'tri', 'star']);

/** 문자열 모양이나 외부 family 필드만으로는 전환하지 않아요. */
export function confirmedQrEngineFamily(hits) {
  const families = new Set();
  for (const hit of Array.isArray(hits) ? hits : []) {
    const value = classifyQrValue(hit?.text);
    if (value.kind === QR_VALUE_KIND.TL_PLAIN) return null;
    if (value.kind !== QR_VALUE_KIND.TL_HINT) continue;
    if (!NON_CUBE.has(value.family)) return null;
    families.add(value.family);
  }
  return families.size === 1 ? [...families][0] : null;
}

/** 모양 후보가 아니라 톤 검사 뒤 얻은 실제 N7 코드워드를 다시 확인해요. */
export function confirmedN7EngineFamily(finders) {
  const families = new Set();
  for (const finder of Array.isArray(finders) ? finders : []) {
    const n7 = finder?.centralN7;
    if (finder?.finderKind !== CENTRAL_N7_PATTERN_FAMILY_ID
      || finder.source !== 'central-n7-block-locator' || n7?.schemaId !== CENTRAL_N7_SCHEMA_ID) continue;
    const decoded = decodeCentralN7(n7.digits);
    if (!decoded || !NON_CUBE.has(decoded.family) || decoded.family !== n7.family
      || !Array.isArray(n7.outerFormat) || n7.outerFormat.length !== decoded.outerFormat.length
      || decoded.outerFormat.some((value, i) => value !== n7.outerFormat[i])) continue;
    families.add(decoded.family);
  }
  return families.size === 1 ? [...families][0] : null;
}

/** 이미 수집 중인 H나 현재 락에서 누적되는 Y를 다른 표식이 끊지 않아요. */
export function protectsYHEngine(stats, timestamp) {
  const fresh = at => Number.isFinite(at) && Number.isFinite(timestamp)
    && timestamp >= at && timestamp - at <= 1000;
  return fresh(stats?.h?.lastConfirmedAt)
    || (stats?.h?.observedFaces?.length ?? 0) > 0 && fresh(stats.h.observedAt)
    || Number(stats?.locked) === 1 && Number(stats?.progressD) > 0 && fresh(stats.engineRouteYConfirmedAt);
}

export function validEngineRouteEvidence(evidence, timestamp) {
  return evidence?.source === 'central-n7' && NON_CUBE.has(evidence.family)
    && Number.isFinite(evidence.timestamp) && Number.isFinite(timestamp)
    && timestamp >= evidence.timestamp && timestamp - evidence.timestamp <= 3000;
}
