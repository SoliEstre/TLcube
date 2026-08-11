// generator-state.js — 생성기 선택 상태의 단일 진실
//
// 일반/고급 모드는 이 객체를 따로 소유하지 않는다. 같은 상태를 서로 다른 밀도로
// 보여줄 뿐이다. 특히 해상도는 일반에서 auto/저/중/고, 고급에서 auto/정확한 버전으로
// 라벨만 달라진다. 아래 type별 version 필드가 canonical 값이고 양쪽 UI는 이 값에
// 왕복 매핑한다. Type Y 안쪽 윈도처럼 렌더가 Y2를 강제해도 저장된 versionY는 바꾸지
// 않는다 — 윈도를 끄거나 O→Y→O로 돌아오면 사용자가 고른 값이 그대로 살아야 한다.

import {
  DEFAULT_FINDER_PATTERN_ID, FINDER_PATTERN_IDS, LEGACY_FINDER_PATTERN_ID,
} from './finder-patterns.js';
import { CENTER_QR_FINDER_PATTERN_ID, DEFAULT_OUTER_QR_POSITION } from './finder-selection.js';
import { DEFAULT_PRESET, PRESETS } from './luminance.js';
import { TL_READER_URL } from './qr.js';

export const GENERATOR_MODES = Object.freeze(['normal', 'advanced']);
export const GENERATOR_TYPES = Object.freeze(['O', 'A', 'Y']);
export const RESOLUTION_TIERS = Object.freeze(['auto', 'low', 'mid', 'high']);

export const RESOLUTION_TIER_VERSIONS = Object.freeze({
  O: Object.freeze({ low: 1, mid: 2, high: 3 }),
  A: Object.freeze({ low: 0, mid: 1, high: 2 }),
  Y: Object.freeze({ low: 0, mid: 1, high: 2 }),
});

const BOTH = 'both';
const ADVANCED = 'advanced';
const INTERNAL = 'internal';

function field(defaultValue, exposure, options) {
  return Object.freeze({
    defaultValue,
    exposure,
    ...(options === undefined ? {} : { options: Object.freeze([...options]) }),
  });
}

// 선택 가능한 축을 한 곳에 등록한다. UI 노출 대조와 상태 왕복 테스트가 이 스키마를
// 순회하므로 새 항목을 더하면 일반/고급 누락과 보존 검사가 함께 확장된다.
export const GENERATOR_STATE_SCHEMA = Object.freeze({
  contentTab: field('url', BOTH, ['url', 'text', 'wifi', 'card']),
  type: field('Y', BOTH, GENERATOR_TYPES),
  preset: field(DEFAULT_PRESET, BOTH, [...Object.keys(PRESETS), 'custom']),
  wifiSecurity: field('WPA', BOTH, ['WPA', 'WEP', 'nopass']),
  qrPosition: field(DEFAULT_OUTER_QR_POSITION, BOTH,
    ['inner', 'TL', 'TR', 'BL', 'BR', 'none']),
  finderPatternId: field(DEFAULT_FINDER_PATTERN_ID, BOTH,
    [LEGACY_FINDER_PATTERN_ID, CENTER_QR_FINDER_PATTERN_ID, ...FINDER_PATTERN_IDS]),
  previousFinderPatternId: field(DEFAULT_FINDER_PATTERN_ID, INTERNAL,
    [LEGACY_FINDER_PATTERN_ID, ...FINDER_PATTERN_IDS]),
  previousOuterQrPosition: field(DEFAULT_OUTER_QR_POSITION, INTERNAL,
    ['TL', 'TR', 'BL', 'BR', 'none']),
  eccLevel: field('auto', BOTH, ['auto', 'H', 'M', 'L']),
  versionO: field('auto', BOTH, ['auto', 1, 2, 3]),
  versionA: field('auto', BOTH, ['auto', 0, 1, 2]),
  versionY: field('auto', BOTH, ['auto', 0, 1, 2]),
  customHue: field(210, BOTH, [210, 37]),
  bgMode: field('transparent', BOTH, ['transparent', 'white', 'black']),
  quietMode: field('auto', BOTH, ['auto', 'none', 'white', 'black', 'contrast']),
  tone: field(2, ADVANCED, [2, 3]),
  faceGain: field(100, ADVANCED, [100, 41]),
  qrText: field(TL_READER_URL, ADVANCED,
    [TL_READER_URL, 'https://example.com/fallback']),
  qrCornerToo: field(false, ADVANCED, [false, true]),
});

export function createGeneratorState(overrides = {}) {
  const state = {};
  for (const [key, descriptor] of Object.entries(GENERATOR_STATE_SCHEMA)) {
    state[key] = descriptor.defaultValue;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in GENERATOR_STATE_SCHEMA)) throw new RangeError('알 수 없는 생성기 상태 키: ' + key);
    state[key] = value;
  }
  return state;
}

/** 일반 노출 키는 고급에서도 모두 노출되고, 고급 전용 키만 뒤에 더해진다. */
export function exposedGeneratorStateKeys(mode) {
  if (!GENERATOR_MODES.includes(mode)) throw new RangeError('알 수 없는 생성기 모드: ' + mode);
  return Object.freeze(Object.entries(GENERATOR_STATE_SCHEMA)
    .filter(([, descriptor]) => descriptor.exposure === BOTH
      || (mode === 'advanced' && descriptor.exposure === ADVANCED))
    .map(([key]) => key));
}

/** 모드 전환은 view 상태만 바꾸며 generatorState를 읽거나 쓰지 않는다. */
export function transitionGeneratorMode(nextMode) {
  if (!GENERATOR_MODES.includes(nextMode)) {
    throw new RangeError('알 수 없는 생성기 모드: ' + nextMode);
  }
  return nextMode;
}

export function versionStateKey(type) {
  if (!GENERATOR_TYPES.includes(type)) throw new RangeError('알 수 없는 생성기 타입: ' + type);
  return 'version' + type;
}

export function versionForResolutionTier(type, tier) {
  versionStateKey(type);
  if (!RESOLUTION_TIERS.includes(tier)) throw new RangeError('알 수 없는 해상도 티어: ' + tier);
  return tier === 'auto' ? 'auto' : RESOLUTION_TIER_VERSIONS[type][tier];
}

export function resolutionTierForVersion(type, version) {
  versionStateKey(type);
  if (version === 'auto') return 'auto';
  const entry = Object.entries(RESOLUTION_TIER_VERSIONS[type])
    .find(([, candidate]) => candidate === Number(version));
  if (!entry) throw new RangeError('Type ' + type + '에 없는 버전: ' + version);
  return entry[0];
}
