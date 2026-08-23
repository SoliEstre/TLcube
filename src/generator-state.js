// generator-state.js — 생성기 선택 상태의 단일 진실
//
// 일반/고급 모드는 이 객체를 따로 소유하지 않는다. 같은 상태를 서로 다른 밀도로
// 보여줄 뿐이다. 특히 해상도는 일반에서 auto/저/중/고, 고급에서 auto/정확한 버전으로
// 라벨만 달라진다. 아래 type별 version 필드가 canonical 값이고 양쪽 UI는 이 값에
// 왕복 매핑한다. Type Y 안쪽 윈도처럼 렌더가 Y2를 강제해도 저장된 versionY는 바꾸지
// 않는다 — 윈도를 끄거나 O→Y→O로 돌아오면 사용자가 고른 값이 그대로 살아야 한다.

import {
  CUBE_BULLSEYE_FINDER_PATTERN_ID, LEGACY_FINDER_PATTERN_ID,
} from './finder-patterns.js';
import { CENTRAL_V0_FINDER_CARD, FINDER_CARD_GROUPS } from './finder-card-ui.js';
import {
  CENTRAL_V0_FINDER_PATTERN_ID,
  CENTER_QR_FINDER_PATTERN_ID,
  DEFAULT_OUTER_QR_POSITION,
  createFinderQrProfiles,
} from './finder-selection.js';
import { DEFAULT_PRESET, PRESETS } from './luminance.js';
import { TL_READER_URL } from './qr.js';
import {
  DEFAULT_RENDER_PROFILE_CHOICE, RENDER_PROFILE_CHOICES,
} from './render-profile.js';
import {
  DEFAULT_EXPORT_CUSTOM_PX,
  DEFAULT_EXPORT_DITHER,
  DEFAULT_EXPORT_MARGIN,
  DEFAULT_EXPORT_PPI_PURPOSE,
  DEFAULT_EXPORT_SIZE,
  EXPORT_DITHER_CHOICES,
  EXPORT_MARGIN_MODES,
  EXPORT_PPI_DETAIL_AUTO,
  EXPORT_PPI_DETAIL_CHOICES,
  EXPORT_PPI_PURPOSES,
  EXPORT_SIZE_CHOICES,
} from './export-options.js';
import { DEFAULT_SHADING_MODE, SHADING_MODES } from './shading.js';
import {
  DEFAULT_LOCATOR_PROFILE_Y,
  LOCATOR_PROFILE_CELL_SURFACE_V0,
  LOCATOR_PROFILE_CELL_SURFACE_V0T,
  LOCATOR_PROFILE_CELL_SURFACE_V0TY,
  LOCATOR_PROFILE_CELL_SURFACE_V0TR,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRQ,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRY,
  // ⚠ `LOCATOR_PROFILE_CELL_SURFACE_V0XQ`(2026-08-17 2라운드) 와
  //   `LOCATOR_PROFILE_CELL_SURFACE_V0X`(2026-08-17 3라운드),
  //   그리고 **v0W 계열 넷**(`..._V0W`·`..._V0WQ`·`..._V0W2`·`..._V0WY`,
  //   2026-08-17 v0T 편입 라운드) 은 드랍으로 여기서 빠졌다
  //   (v1r2·v2r2 와 같은 전례 — 상수 자체는 `locatorY.js` 에 그대로 산다).
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

/**
 * 카드로 고를 수 있는 파인더 id 전부 — 카드 그룹 + 중앙 v0(그룹 밖 단독 카드).
 * finderPatternId 허용값의 유일한 출처다 (F-37 — 손 목록 금지).
 */
const FINDER_CARD_PATTERN_IDS = Object.freeze(
  [...Object.values(FINDER_CARD_GROUPS).flat(), CENTRAL_V0_FINDER_CARD]
    .map((card) => card.id),
);
if (!FINDER_CARD_PATTERN_IDS.includes(GENERATOR_DEFAULT_FINDER_PATTERN_ID)
  || !FINDER_CARD_PATTERN_IDS.includes(CENTRAL_V0_FINDER_PATTERN_ID)
  || new Set(FINDER_CARD_PATTERN_IDS).size !== FINDER_CARD_PATTERN_IDS.length) {
  throw new Error('파인더 카드 id 유도가 깨졌다 — 기본값/중앙 v0 부재 또는 중복: '
    + FINDER_CARD_PATTERN_IDS.join(','));
}

export const GENERATOR_STATE_SCHEMA = Object.freeze({
  contentTab: field('url', BOTH, ['url', 'text', 'wifi', 'card']),
  type: field('Y', BOTH, GENERATOR_TYPES),
  preset: field(DEFAULT_PRESET, BOTH, [...Object.keys(PRESETS), 'custom']),
  wifiSecurity: field('WPA', BOTH, ['WPA', 'WEP', 'nopass']),
  // 'plane' = **먼 코너 QR** (v0TY — 2026-08-17 v0T 편입 라운드부터. 그 전에는
  // v0WY 였고, v0W 계열 드랍으로 전환 대상만 바뀌었다). ⚠ **의도적 갱신
  // (2026-08-17 재설계)** — 이 자리에는 「큐브 바깥 면-평면 QR · 실루엣 밖이라
  // 데이터 셀을 한 칸도 안 먹고 어떤 레이아웃과도 조합된다」 가 적혀 있었다.
  // 운영자가 그 설계를 폐기하고 «윈도 β 식 안쪽 배치» 로 재설계했다 — 지금의
  // 'plane' 은 **레이아웃 선택**이다 (locatorProfileY 를 v0ty 로 전환한다,
  // index.html §qrPositionCards). 그래서 «어떤 레이아웃과도 조합» 이 아니고 64셀을 먹는다.
  qrPosition: field(DEFAULT_OUTER_QR_POSITION, BOTH,
    ['inner', 'plane', 'TL', 'TR', 'BL', 'BR', 'none']),
  // 생성기 화면의 **초기 선택**은 하이브리드다(사용자 지시 2026-08-13). 실사진 12/12 ·
  // 285ms 로 순수 불스아이(24/24 · 603ms)와 같은 인식률에 절반 가까이 빠르고, 프로젝트
  // 정체성인 큐브가 코드에 실제로 보인다.
  // ⚠ 라이브러리 기본값(`DEFAULT_FINDER_PATTERN_ID`)은 «불스아이» 그대로 둔다 — 그쪽은
  //   finderPatternId 를 안 준 buildScene 이 받는 값이라 임베더의 계약이고, 바꾸면
  //   불스아이 렌더 계약을 고정한 테스트 30건이 한꺼번에 깨진다. 둘은 다른 개념이다.
  // ⚠ F-37 (2026-08-23 수리): 허용값을 손 목록으로 들다가 OAK 3종 + daehan 카드가
  //   조용히 빠져 있었다 — 카드로 고를 수 있는데 «허용값 밖» 인 상태. 사본 목록은
  //   반드시 원본과 어긋나므로, **카드 그룹에서 유도**한다 (formal 4 + 생성 8 +
  //   손그림 3 + OAK + daehan 대표 + 중앙 v0). 카드가 늘면 여기와 상태 왕복 회귀가
  //   자동으로 따라온다 — «전수 등록» 이 주장이 아니라 유도 사실이 된다.
  finderPatternId: field(GENERATOR_DEFAULT_FINDER_PATTERN_ID, BOTH,
    FINDER_CARD_PATTERN_IDS),
  // 중앙 QR 만 뺀다 — previous 는 «중앙 QR 에서 되돌아갈 곳» 이라 center-qr 자신은
  // 담기지 않는다 (finder-selection.selectFinderPattern 이 그 불변식을 지킨다).
  previousFinderPatternId: field(GENERATOR_DEFAULT_FINDER_PATTERN_ID, INTERNAL,
    FINDER_CARD_PATTERN_IDS.filter((id) => id !== CENTER_QR_FINDER_PATTERN_ID)),
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
  // 턴A (역삼각 Type A, 2026-08-19 UI 편입) — Type A 전용. `INTERNAL` 인 이유는
  // locatorProfileY 와 같다: **아직 lab 게이트 뒤**라 정식 화면의 노출 대조
  // (index.html `data-state-keys`)에 들어가면 안 된다.
  //
  // ⚠ 왜 lab 뒤인가 (실측 2026-08-19): `encodeA(turnA:true)` 로 만든 코드는
  //   라이브 경로(decodeFrontend)가 **0/3 으로 못 읽는다** (대조군 turnA:false 는
  //   3/3). 인코더가 아직 역삼각 «기하» 를 안 내고(셀 좌표 집합이 정삼각과 동일,
  //   format 15셀만 다르다) 검출기의 turn 신호도 배선돼 있지 않다. 즉 이 스위치는
  //   «와이어 값만 바꾸는 실험 장치» 이지 실루엣 전환이 아니다.
  //   안정판 노출은 (a) 인코더 기하 전환 + (b) family.turn → decode.format.turn
  //   배선이 끝나고 왕복이 서는 날이다.
  turnA: field(false, INTERNAL, [false, true]),
  // 코너 마커 (O-CM / A-CM, 2026-08-20 UI 편입) — Type O·A 전용, lab 게이트 뒤.
  // turnA 와 같은 `INTERNAL` 이지만 **이유가 다르다**: turnA 는 왕복이 안 서서
  // lab 에 갇혀 있고, 코너 마커는 왕복이 선다 (합성 원근에서 앵커 한계 g=0.0001 →
  // 코너 마커 g=0.0008, test/decoder-corner-marker-wiring.test.js ②).
  // lab 에 두는 이유는 **실기기 라운드를 아직 안 돌았기** 때문이다 — 합성만으로
  // 정식 노출을 정하지 않는다는 이 저장소의 규약 그대로다.
  // ⚠ turnA 와 상호배제 (encodeA 가 둘 다 참이면 던진다).
  cornerMarker: field(false, INTERNAL, [false, true]),
  versionY: field('auto', BOTH, ['auto', 0, 1, 2]),
  customHue: field(210, BOTH, [210, 37]),
  bgMode: field('transparent', BOTH, ['transparent', 'white', 'black']),
  quietMode: field('auto', BOTH, ['auto', 'none', 'white', 'black', 'contrast']),
  tone: field(3, BOTH, [2, 3]),
  // 큐브 입체감 (구 «렌더 프로파일», 2026-08-19 개편 — 과업 #16 → 내보내기 옵션 ④).
  // 카드는 자동-강-중-약-평면 순서이고 «강(오리지널)» 은 lab 카드로만 뜬다. 허용값에는
  // 자동 + 구체 프로파일 전부를 넣는다 — lab 에서 고른 값이 정식 화면으로 돌아왔을 때
  // «알 수 없는 값» 으로 죽으면 안 되기 때문이다 (locatorProfileY 와 같은 규약).
  // 기본값은 «자동» — 인쇄용·디더링 문맥이 없으면 «중» 으로 풀리므로 종전 픽셀과 같다
  // (export-options.resolveRenderProfile). 노출은 BOTH — 일반 모드에도 카드가 뜬다.
  renderProfile: field(DEFAULT_RENDER_PROFILE_CHOICE, BOTH, [...RENDER_PROFILE_CHOICES]),
  // ── 내보내기 옵션 ①②③ (2026-08-19 신설 — 도메인·자동 규칙은 export-options.js 가
  //    단일 정의다. 여기는 상태 슬롯과 노출만 등록한다.) ──────────────────────────
  // ① 고정 이미지 크기 — 커스텀 외 정사각·contain. 자동 3종은 복호 실측 하한에서 온다.
  exportSize: field(DEFAULT_EXPORT_SIZE, BOTH, [...EXPORT_SIZE_CHOICES]),
  // 커스텀 폭·높이 (px). 자유 숫자 입력이다 — options 는 customHue·qrText 전례대로
  // «상태 왕복 테스트 선택지» 이고, 실제 검증은 export-options.resolveExportSize 가
  // 한다 (16..16384 정수).
  exportWidth: field(DEFAULT_EXPORT_CUSTOM_PX, BOTH, [DEFAULT_EXPORT_CUSTOM_PX, 640]),
  exportHeight: field(DEFAULT_EXPORT_CUSTOM_PX, BOTH, [DEFAULT_EXPORT_CUSTOM_PX, 768]),
  // 여백 포함(기본)/없음 — «없음» 이 quiet zone 을 깎는지의 실측·경고는 보고서 §2.4.
  exportMargin: field(DEFAULT_EXPORT_MARGIN, BOTH, [...EXPORT_MARGIN_MODES]),
  // ② 적은 색상 화면 최적화 — **고급 전용.** 일반 모드는 기본값(자동 = 양자화 없음).
  exportDither: field(DEFAULT_EXPORT_DITHER, ADVANCED, [...EXPORT_DITHER_CHOICES]),
  // ③ 출력 최적화 (PNG 전용) — 일반 모드는 갈래(화면용/인쇄용)만, 세부 7종은 고급 전용.
  exportPpi: field(DEFAULT_EXPORT_PPI_PURPOSE, BOTH, [...EXPORT_PPI_PURPOSES]),
  exportPpiDetail: field(EXPORT_PPI_DETAIL_AUTO, ADVANCED, [...EXPORT_PPI_DETAIL_CHOICES]),
  // 입체 음영 (과업 #17) — 좌상단 조명 전제의 그림자·반사광 띠. 셀에는 절대 안 닿고
  // 안전영역 + 배경 영역에만 그린다 (shading.js 계약). 렌더러는 **Type Y 에만** 얹는다
  // (index.html withShading — O/A 는 그대로 통과). 기본 **끔**: 켜면 배경/안전영역을
  // 채워 Y 전경 실루엣 검출이 깨져 복호가 죽는다 (shading.js DEFAULT_SHADING_MODE
  // 주석 실측). 그래서 decode-safe 기본값은 끔이고, 켬은 고급 명시 옵트인이다.
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
  // 라인업(2026-08-17 v0T 편입·v0W 계열 전체 드랍까지 반영): v0 = Y0(n=13) ·
  // v0T = **Y1 최종 파인더** · v0TY = v0T 파생(먼 코너 QR 슬롯).
  //
  // **v2r2 · v1r2 드랍 (운영자 확정 2026-08-16)** — 허용값에서 내린다. 효과는 UI
  // 카드 소멸 + 허용값 목록 이탈이다. (생성기 상태는 어디에도 저장되지 않으므로
  // «저장값 폴백» 은 해당 없음 — 이 목록의 소비자는 현재 테스트뿐이다. 검증 렌즈
  // 2026-08-17 정정: 복원기가 생기는 날 이 목록이 그 검증 기준이 된다.)
  //
  // **v0XQ 드랍 (운영자 실기기 확정 2026-08-17, 2라운드)** — 같은 규약으로 허용값에서
  // 내린다. 조건부 드랍 규칙 «v0WQ > v0XQ» 가 실기기 순위(v0WQ ≫ v0XQ > v0X ≈ v0W)로
  // 성립했다.
  //
  // **v0X 드랍 (운영자 실기기 확정 2026-08-17, 3라운드)** — 또 같은 규약이다.
  // 관측 「파인더 인식 다 해놓고도 잘 못 읽음」 + 「v0 과 혼선 자주」.
  //
  // **v0W 계열 전체 드랍 (운영자 확정 2026-08-17, v0T 편입 라운드)** — v0T 가
  // Type Y 최종 파인더로 확정되면서 v0W · v0WQ · v0W2 · v0WY 넷을 같은 규약으로
  // 내린다. 남는 Y1 카드는 v0T · v0TY 둘이다. QR 위치 «면» 카드는 이제 v0TY 로
  // 전환한다 (index.html §qrPositionCards — v0WY 시절과 같은 문법).
  //
  // 와이어·정본·디코더 판독 능력은 그대로다 (`cellSurfaceFinal.js`
  // §CELL_SURFACE_FINAL_DROPPED_IDS — 차단·비삭제). `encodeOptionsForY` 의
  // 드랍 분기들도 **남긴다** — 이미 발행된 출력물의 재생성 경로다.
  // hex-frame-v1 은 그것대로 UI 카드만 내리고 값은 살려 둔 채다(다른 전례).
  locatorProfileY: field(DEFAULT_LOCATOR_PROFILE_Y, INTERNAL,
    [
      LOCATOR_PROFILE_OFF,
      LOCATOR_PROFILE_HEX_FRAME_V1,
      LOCATOR_PROFILE_CELL_SURFACE_V0,
      LOCATOR_PROFILE_CELL_SURFACE_V0T,
      // v0TY — 사용자는 QR 위치 «면» 카드로 이 값으로 오고, 다른 QR 위치를 고르면
      // v0T 로 돌아간다 (v0WY 시절과 같은 문법 — index.html §qrPositionCards).
      LOCATOR_PROFILE_CELL_SURFACE_V0TY,
      // **v0TR 계열 편입 (2026-08-17)** — v0T 의 거리 약점 대응 재설계다. 카드가
      // 둘 는다: v0TR(파인더) · v0TRQ(중앙 QR 슬롯). v0T·v0TY 는 **그대로 남는다** —
      // 드랍 판정은 실기기 재스캔 뒤 운영자 몫이지 편입의 몫이 아니다.
      LOCATOR_PROFILE_CELL_SURFACE_V0TR,
      LOCATOR_PROFILE_CELL_SURFACE_V0TRQ,
      // **v0TRY 편입 (2026-08-18)** — v0TR 의 «면»(먼 코너) QR 파생. v0TY 가 v0T 의
      // QR 위치 카드로 오는 것과 같은 문법이다 (index.html §qrPositionCards).
      LOCATOR_PROFILE_CELL_SURFACE_V0TRY,
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
