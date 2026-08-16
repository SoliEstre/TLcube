// generator-state.js — 생성기 선택 상태의 단일 진실
//
// 일반/고급 모드는 이 객체를 따로 소유하지 않는다. 같은 상태를 서로 다른 밀도로
// 보여줄 뿐이다. 특히 해상도는 일반에서 auto/저/중/고, 고급에서 auto/정확한 버전으로
// 라벨만 달라진다. 아래 type별 version 필드가 canonical 값이고 양쪽 UI는 이 값에
// 왕복 매핑한다. Type Y 안쪽 윈도처럼 렌더가 Y2를 강제해도 저장된 versionY는 바꾸지
// 않는다 — 윈도를 끄거나 O→Y→O로 돌아오면 사용자가 고른 값이 그대로 살아야 한다.

import {
  CUBE_BULLSEYE_FINDER_PATTERN_ID, FINDER_PATTERN_IDS, LEGACY_FINDER_PATTERN_ID,
} from './finder-patterns.js';
import {
  CENTER_QR_FINDER_PATTERN_ID,
  DEFAULT_OUTER_QR_POSITION,
  createFinderQrProfiles,
} from './finder-selection.js';
import { DEFAULT_PRESET, PRESETS } from './luminance.js';
import { TL_READER_URL } from './qr.js';
import { DEFAULT_RENDER_PROFILE, RENDER_PROFILE_IDS } from './render-profile.js';
import { DEFAULT_SHADING_MODE, SHADING_MODES } from './shading.js';
import {
  DEFAULT_LOCATOR_PROFILE_Y,
  LOCATOR_PROFILE_CELL_SURFACE_V0,
  LOCATOR_PROFILE_CELL_SURFACE_V0W,
  LOCATOR_PROFILE_CELL_SURFACE_V0WQ,
  LOCATOR_PROFILE_CELL_SURFACE_V0X,
  LOCATOR_PROFILE_CELL_SURFACE_V0XQ,
  LOCATOR_PROFILE_HEX_FRAME_V1,
  LOCATOR_PROFILE_OFF,
} from './locatorY.js';

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
/** 생성기 화면의 초기 파인더 — 라이브러리 기본값과 별개다(위 주석). */
export const GENERATOR_DEFAULT_FINDER_PATTERN_ID = CUBE_BULLSEYE_FINDER_PATTERN_ID;
const DEFAULT_FINDER_QR_PROFILES = createFinderQrProfiles(GENERATOR_DEFAULT_FINDER_PATTERN_ID);
const ALTERNATE_FINDER_QR_PROFILES = createFinderQrProfiles(LEGACY_FINDER_PATTERN_ID);

export const GENERATOR_STATE_SCHEMA = Object.freeze({
  contentTab: field('url', BOTH, ['url', 'text', 'wifi', 'card']),
  type: field('Y', BOTH, GENERATOR_TYPES),
  preset: field(DEFAULT_PRESET, BOTH, [...Object.keys(PRESETS), 'custom']),
  wifiSecurity: field('WPA', BOTH, ['WPA', 'WEP', 'nopass']),
  // 'plane' = **큐브 바깥 면-평면 QR** (v0WY, 2026-08-16). 'inner'(윈도 β)와 달리
  // 실루엣 **밖**에 앉아 데이터 셀을 한 칸도 안 먹는다 — 그래서 어떤 레이아웃과도
  // 조합되고, v0W 와 붙인 것이 v0WY 다 (`sceneY.js` §renderOuterFaceQr).
  qrPosition: field(DEFAULT_OUTER_QR_POSITION, BOTH,
    ['inner', 'plane', 'TL', 'TR', 'BL', 'BR', 'none']),
  // 생성기 화면의 **초기 선택**은 하이브리드다(사용자 지시 2026-08-13). 실사진 12/12 ·
  // 285ms 로 순수 불스아이(24/24 · 603ms)와 같은 인식률에 절반 가까이 빠르고, 프로젝트
  // 정체성인 큐브가 코드에 실제로 보인다.
  // ⚠ 라이브러리 기본값(`DEFAULT_FINDER_PATTERN_ID`)은 «불스아이» 그대로 둔다 — 그쪽은
  //   finderPatternId 를 안 준 buildScene 이 받는 값이라 임베더의 계약이고, 바꾸면
  //   불스아이 렌더 계약을 고정한 테스트 30건이 한꺼번에 깨진다. 둘은 다른 개념이다.
  finderPatternId: field(GENERATOR_DEFAULT_FINDER_PATTERN_ID, BOTH,
    [LEGACY_FINDER_PATTERN_ID, CENTER_QR_FINDER_PATTERN_ID, ...FINDER_PATTERN_IDS]),
  previousFinderPatternId: field(GENERATOR_DEFAULT_FINDER_PATTERN_ID, INTERNAL,
    [LEGACY_FINDER_PATTERN_ID, ...FINDER_PATTERN_IDS]),
  // 'plane'(v0WY) 도 **바깥 QR 위치**라 여기 들어간다 — 빠뜨리면 Y 에서 «면» 을 고른 뒤
  // O/A 로 갔다 돌아올 때 복원값이 허용값 밖이 되어 조용히 기본으로 떨어진다.
  previousOuterQrPosition: field(DEFAULT_OUTER_QR_POSITION, INTERNAL,
    ['TL', 'TR', 'BL', 'BR', 'plane', 'none']),
  // O/A는 회전 기준을 함께 주는 중앙 QR이 기본이고, Y는 종전 코너 QR 기본을 유지한다.
  // 공용 상태가 타입 사이로 새지 않게 타입군별 마지막 선택을 별도 보존한다.
  finderQrProfiles: field(DEFAULT_FINDER_QR_PROFILES, INTERNAL,
    [DEFAULT_FINDER_QR_PROFILES, ALTERNATE_FINDER_QR_PROFILES]),
  eccLevel: field('auto', BOTH, ['auto', 'H', 'M', 'L']),
  versionO: field('auto', BOTH, ['auto', 1, 2, 3]),
  versionA: field('auto', BOTH, ['auto', 0, 1, 2]),
  versionY: field('auto', BOTH, ['auto', 0, 1, 2]),
  customHue: field(210, BOTH, [210, 37]),
  bgMode: field('transparent', BOTH, ['transparent', 'white', 'black']),
  quietMode: field('auto', BOTH, ['auto', 'none', 'white', 'black', 'contrast']),
  tone: field(3, BOTH, [2, 3]),
  // 렌더 프로파일 (과업 #16) — 면 게인 묶음. 정식은 화면용·출력물용 2종이고
  // «오리지널» 은 lab 카드로만 뜬다. 허용값에는 셋 다 넣는다 — lab 에서 고른 값이
  // 정식 화면으로 돌아왔을 때 «알 수 없는 값» 으로 죽으면 안 되기 때문이다
  // (locatorProfileY 와 같은 규약). 노출은 BOTH — 일반 모드에도 카드가 뜬다.
  renderProfile: field(DEFAULT_RENDER_PROFILE, BOTH, [...RENDER_PROFILE_IDS]),
  // 입체 음영 (과업 #17) — 좌상단 조명 전제의 그림자·반사광 띠. 셀에는 절대 안 닿고
  // 안전영역 + 배경 영역에만 그린다 (shading.js 계약). 기본 **끔**: 새 옵션이고,
  // 켜면 렌더 픽셀이 바뀌므로 «아무것도 안 골랐는데 그림이 달라졌다» 가 안 되게 한다.
  shading: field(DEFAULT_SHADING_MODE, BOTH, [...SHADING_MODES]),
  // ② T면 엣지 아웃라인 — **별도 서브옵션**이다 (운영자 «효과 미지수» 표명).
  // 위쪽 실루엣(=T면 쪽)에 얇은 반사광/그림자 아웃라인을 더한다. shading 이 꺼져
  // 있으면 이 값은 그림에 아무 영향이 없다 (UI 도 그때는 비활성으로 보인다).
  shadingRim: field(false, BOTH, [false, true]),
  // ⚠ faceGain 슬라이더는 «절대 게인» 이 아니라 **선택한 프로파일까지의 보간 강도**다
  //   (0 = 3면 평면, 100 = 프로파일 게인 그대로). 출력물용은 프로파일 자체가 동률이라
  //   슬라이더를 움직여도 그림이 안 바뀐다 — 그게 정의상 옳다.
  faceGain: field(100, ADVANCED, [100, 41]),
  qrText: field(TL_READER_URL, ADVANCED,
    [TL_READER_URL, 'https://example.com/fallback']),
  qrCornerToo: field(false, ADVANCED, [false, true]),
  // 시험판(/lab/) Type Y 로케이터. 안정판 UI 는 이 키를 보여 주지 않고 항상 off.
  // 라인업(2026-08-16 드랍 + v0W 편입 반영): v0 = Y0(n=13) · v0X = Y1(n=21) ·
  // v0XQ = Y1 중앙 QR · v0W = Y1 신설 (운영자 설계, 조건부 드랍 판정 대기).
  //
  // **v2r2 · v1r2 드랍 (운영자 확정 2026-08-16)** — 허용값에서 내린다. 초안 v2 ·
  // 구 v1 CS 와 같은 처리이며, 저장돼 있던 값은 **검증 실패로 기본(off)에 떨어진다**.
  // 와이어·정본·디코더 판독 능력은 그대로다 (`cellSurfaceFinal.js`
  // §CELL_SURFACE_FINAL_DROPPED_IDS — 차단·비삭제).
  // hex-frame-v1 은 그것대로 UI 카드만 내리고 값은 살려 둔 채다(다른 전례).
  locatorProfileY: field(DEFAULT_LOCATOR_PROFILE_Y, INTERNAL,
    [
      LOCATOR_PROFILE_OFF,
      LOCATOR_PROFILE_HEX_FRAME_V1,
      LOCATOR_PROFILE_CELL_SURFACE_V0,
      LOCATOR_PROFILE_CELL_SURFACE_V0X,
      LOCATOR_PROFILE_CELL_SURFACE_V0XQ,
      LOCATOR_PROFILE_CELL_SURFACE_V0W,
      LOCATOR_PROFILE_CELL_SURFACE_V0WQ,
    ]),
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
