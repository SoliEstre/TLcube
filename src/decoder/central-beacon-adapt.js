/** R1 비컨 메타 어댑터. 픽셀 관측은 본문 의존성 없는 모듈에서 재노출해요. */
import { readBeaconFromEncodedY, unpackBeaconText } from '../centralBeacon.js';
import { decodeSingle } from '../formatinfo.js';
import { K_FORMAT_INDEX } from '../formatK.js';
import { CENTRAL_BEACON_FINDER_KIND } from './central-v0-observe.js';
import { CENTRAL_N7_FINDER_KIND } from './central-n7-observe.js';

export { BEACON_CS_BLOCK_LOCATOR, unitCentralSlotRadius } from './central-beacon-observation-shared.js';
export {
  CENTRAL_N7_FINDER_KIND, outerCellSizeFromCentralN7ModulePitch, scaleCentralN7HomographyToOuter,
  verifyCentralN7LocatorTones, readCentralN7Payload, centralN7CenterPriorSeeds, discoverCentralN7Finders,
} from './central-n7-observe.js';
export {
  CENTRAL_BEACON_FINDER_KIND, outerCellSizeFromModulePitch,
  outerCellSizeFromBlockRadius,
  modulePitchFromH,
  scaleHomographyToOuter,
  outerPoseFromInnerH,
  isV0BeaconBlockShape,
  isCentralV0CubeHypothesis,
  verifyV0LocatorTones,
  centralV0FindersFromObservation,
  discoverCentralBeaconFinders,
  discoverCentralBeaconFindersSteps,
} from './central-v0-observe.js';

/**
 * 비컨 메타의 계열 글자 + 바깥 포맷 워드 → 바깥 기하 패밀리.
 * G 는 hex 위에 코너 마커가 앉은 것이라 패밀리는 hex, 포맷 워드가 G 인덱스를 말한다.
 * K 는 현재 비컨 계열 추론에서 평 K를 O, K-CM을 G로 적지만, 바깥 포맷 값 7/8은
 * star 축에서만 유효하다. 그래서 그 5digit을 직접 복호해 K 표의 값이면 star로
 * 되짚는다. 새 와이어 값은 없고, K 표가 이미 가진 7/8을 판별 신호로 재사용한다.
 * Y 는 바깥 O/G 가 아니므로 시딩하지 않는다.
 */
export function familiesForBeaconMeta(meta) {
  if (!meta || typeof meta.family !== 'string') return [];
  if (meta.family === 'K') return ['star'];
  if (meta.family === 'A') return ['tri'];
  if (meta.family === 'Y') return [];
  if (Array.isArray(meta.formatDigits) && meta.formatDigits.length === 5) {
    const format = decodeSingle(meta.formatDigits);
    if (format.ok && K_FORMAT_INDEX.some((entry) => entry.formatIndex === format.version)) {
      return ['star'];
    }
  }
  return ['hex'];
}

export function tryReadBeaconFromText(text) {
  if (typeof text !== 'string') return null;
  try {
    return unpackBeaconText(text);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function tryReadBeaconFromEncodedY(encodedY) {
  try {
    return readBeaconFromEncodedY(encodedY);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) return null;
    throw error;
  }
}

export function isPatternFinderKind(kind) {
  return kind === 'cell-mask'
    || kind === 'three-tone-cube'
    || kind === CENTRAL_BEACON_FINDER_KIND
    || kind === CENTRAL_N7_FINDER_KIND;
}
