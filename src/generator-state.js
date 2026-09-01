// generator-state.js — 생성기 선택 상태의 단일 진실
//
// 일반/고급 모드는 이 객체를 따로 소유하지 않는다. 같은 상태를 서로 다른 밀도로
// 보여줄 뿐이다. 특히 해상도는 일반에서 auto/저/중/고, 고급에서 auto/정확한 버전으로
// 라벨만 달라진다. 아래 type별 version 필드가 canonical 값이고 양쪽 UI는 이 값에
// 왕복 매핑한다. Type Y 안쪽 윈도처럼 렌더가 Y2를 강제해도 저장된 versionY는 바꾸지
// 않는다 — 윈도를 끄거나 O→Y→O로 돌아오면 사용자가 고른 값이 그대로 살아야 한다.

import {
  LEGACY_FINDER_PATTERN_ID,
} from './finder-patterns.js';
import {
  CENTRAL_N7_FINDER_CARD, CENTRAL_V0_FINDER_CARD, FINDER_CARD_GROUPS,
  sanitizeFinderCardState,
} from './finder-card-ui.js';
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
  CENTRAL_N7_EMPHASIS_MODES, GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS,
} from './centralN7Emphasis.js';
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

import { GENERATOR_TYPES } from './generator-types.js';

export const GENERATOR_MODES = Object.freeze(['normal', 'advanced']);
// 타입 목록의 정의는 generator-types.js 하나다 (순환 회피 + 손 사본 철폐).
// 소비자들이 예전부터 여기서 가져가므로 재수출로 경로를 유지한다.
export { GENERATOR_TYPES };
// max(«대용량») 와 ultra(«초 대용량» Type C)는 **그 행이 실재하는 타입에만** 있다 —
// 지금은 둘 다 O 화면뿐이다 (각각 V4 k=12 · C0~C2 k=14/17/20, 2026-08-30).
// 타입 맵에 키가 없으면 versionForResolutionTier 가 던진다 (조용한 undefined 금지).
// UI 는 그 카드 자체를 해당 타입에서 숨긴다 (index.html §resTierCards 타입 게이트).
export const RESOLUTION_TIERS = Object.freeze(['auto', 'low', 'mid', 'high', 'max', 'ultra']);

export const RESOLUTION_TIER_VERSIONS = Object.freeze({
  // ultra 는 O 버전 번호가 아니다. `versionO: 'ultra'` 는 활성 정권 표지이고 실제
  // Type C 버전은 별도 `versionC`가 든다. 숫자 0/1/2를 versionO에 넣으면 O축과
  // 충돌하므로 문자열 표지를 RESOLUTION 티어 왕복에만 사용한다.
  O: Object.freeze({ low: 1, mid: 2, high: 3, max: 4, ultra: 'ultra' }),
  A: Object.freeze({ low: 0, mid: 1, high: 2 }),
  Y: Object.freeze({ low: 0, mid: 1, high: 2 }),
  // K 는 VERSIONS_K 표를 쓴다 — version 0/1/2 (O 의 1/2/3 과 **한 칸 어긋난다**).
  K: Object.freeze({ low: 0, mid: 1, high: 2 }),
});

/** 이 타입에서 이 티어가 고를 수 있는가 — 카드 표시 게이트가 쓰는 술어. */
export function resolutionTierAvailable(type, tier) {
  versionStateKey(type);
  if (!RESOLUTION_TIERS.includes(tier)) throw new RangeError('알 수 없는 해상도 티어: ' + tier);
  return tier === 'auto' || RESOLUTION_TIER_VERSIONS[type][tier] !== undefined;
}

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
/** 생성기 O/A/K 화면의 초기 파인더 — 라이브러리 기본값과 별개다(아래 주석). */
export const GENERATOR_DEFAULT_FINDER_PATTERN_ID = CENTRAL_N7_FINDER_CARD.id;
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
  // ⚠ **의도적 갱신 (W2 C3, 2026-08-24)** — 'plane'(«면») 이 허용값에서 빠졌다.
  // «면 = 먼 코너 QR» 은 위치의 한 자리가 아니라 **안쪽 QR 의 배치 축**이라,
  // (qrPosition 'inner') × (qrFacePlacement seam/far) 로 분해했다 (아래 필드).
  // v2r2·v0W 계열 드랍과 같은 규약: 생성기 상태는 저장되지 않으므로 «저장값 폴백»
  // 은 해당 없고, 구 값이 어떤 경로로 들어와도 finder-selection.normalizeFinderQrState
  // 가 'inner' + 'far' 로 정규화한다 (하위호환 매핑 — 한 릴리스 유지).
  qrPosition: field(DEFAULT_OUTER_QR_POSITION, BOTH,
    ['inner', 'TL', 'TR', 'BL', 'BR', 'none']),
  // QR 면 배치 (W2 C3) — Y + 안쪽 전용 축. 'seam' = Y-심 중앙측(v0TRQ 파생) ·
  // 'far' = 먼 코너측(v0T→v0TY · v0TR→v0TRY 파생 — index.html
  // §deriveYLocatorForQrPosition). INTERNAL 인 이유는 locatorProfileY 와 같다:
  // 파생의 입력(v0T 계열 로케이터)이 lab 게이트 뒤라 정식 화면 노출 대조에 들어가면
  // 안 된다 — 정식 Y 안쪽은 레거시 윈도 β 가 유일 경로로 남는다.
  qrFacePlacement: field('seam', INTERNAL, ['seam', 'far']),
  // 생성기 O/A/K 화면의 **초기 선택**은 중앙 TL이다(운영자 지시 2026-08-28).
  // 새 n=7 payload 스키마가 실사진 18/30으로 종전 중앙 Y0 14/30을 넘었고, 디자인
  // 기본값으로 확정됐다. 기본값은 새 상태에만 적용한다 — override로 들어온 기존의
  // 유효한 저장·URL 선택은 아래 createGeneratorState에서 그대로 보존한다.
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
  // 중앙 파인더(중앙 TL · 중앙 Y0 — 3톤 큐브는 §2.4 실측 거부)의 렌더 색만 바꾸는 축 — 포맷·용량·
  // 순위 문법은 어떤 모드에서도 안 바뀐다. **UI 기본값은 'all'** (운영자 실기 A2,
  // 2026-08-29 — 로케이터/전체 모두 향상, 전체가 미묘하게 우세). 라이브러리 기본
  // (DEFAULT_CENTRAL_N7_EMPHASIS = 'default')과 별개다 — finderPatternId 의
  // GENERATOR_DEFAULT ↔ DEFAULT 관계와 동일. 저장 마이그레이션은 해당 없음
  // (생성기 상태는 저장되지 않는다 — 2026-08-29 실측, localStorage 는 테마뿐).
  centralN7Emphasis: field(GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS, BOTH,
    CENTRAL_N7_EMPHASIS_MODES),
  // 중앙 QR 만 뺀다 — previous 는 «중앙 QR 에서 되돌아갈 곳» 이라 center-qr 자신은
  // 담기지 않는다 (finder-selection.selectFinderPattern 이 그 불변식을 지킨다).
  previousFinderPatternId: field(GENERATOR_DEFAULT_FINDER_PATTERN_ID, INTERNAL,
    FINDER_CARD_PATTERN_IDS.filter((id) => id !== CENTER_QR_FINDER_PATTERN_ID)),
  // ⚠ **의도적 갱신 (W2 C3)** — 'plane' 이 여기서도 빠졌다 (qrPosition 과 동시).
  // 구 값은 normalizeFinderQrState 가 기본 코너로 강하시킨다.
  previousOuterQrPosition: field(DEFAULT_OUTER_QR_POSITION, INTERNAL,
    ['TL', 'TR', 'BL', 'BR', 'none']),
  // Type C 중앙 슬롯 개통 (2026-08-30, PM/027 §5.3·§5.4) — 중앙 TL(centralN7)은
  // 평 C 행 그대로, 중앙 QR 은 CQ 행(formatIndex 4)으로 실린다. 여전히 못 싣는
  // 것은 centralV0(중앙 Y0) 하나 — 그 변형이 선택된 채 ultra 에 들어오면 UI가
  // 호환 불스아이로 잠시 옮기고, 정권을 나갈 때 아래 스냅샷으로 복원한다.
  // 사용자가 C 안에서 다른 합법 파인더를 명시 선택하면 active를 내리므로 옛
  // 선택을 덮어쓰지 않는다.
  typeCFinderFallbackActive: field(false, INTERNAL, [false, true]),
  typeCPreviousFinderPatternId: field(GENERATOR_DEFAULT_FINDER_PATTERN_ID, INTERNAL,
    FINDER_CARD_PATTERN_IDS),
  typeCPreviousQrPosition: field(DEFAULT_OUTER_QR_POSITION, INTERNAL,
    ['inner', 'TL', 'TR', 'BL', 'BR', 'none']),
  // O/A/K는 중앙 TL + 바깥 QR이 기본이고, Y는 종전 코너 QR 기본을 유지한다.
  // 공용 상태가 타입 사이로 새지 않게 타입군별 마지막 선택을 별도 보존한다.
  finderQrProfiles: field(DEFAULT_FINDER_QR_PROFILES, INTERNAL,
    [DEFAULT_FINDER_QR_PROFILES, ALTERNATE_FINDER_QR_PROFILES]),
  eccLevel: field('auto', BOTH, ['auto', 'H', 'M', 'L']),
  // V4 (k=12, «대용량») — 2026-08-30 개설. 예약돼 있던 hex 칸 V4=3·V4Q=7 을
  // 레인 v4 가 채웠다 (capacity.js VERSIONS · markerG V4CM/V4CMQ · decode 개방).
  versionO: field('auto', BOTH, ['auto', 1, 2, 3, 4, 'ultra']),
  // Type C(3시 노치)는 생성기 화면 분류상 O지만 와이어 버전은 C0/C1/C2 = 0/1/2다.
  // versionO에 이 숫자를 섞지 않는다. versionO의 'ultra'가 활성 정권만 표시하고,
  // 이 필드가 정권을 나갔다 돌아와도 사용자가 고른 C 버전을 보존한다.
  versionC: field(0, BOTH, [0, 1, 2, 3]),
  versionA: field('auto', BOTH, ['auto', 0, 1, 2]),
  // K — VERSIONS_K 표 (0/1/2). versionO 를 빌려 쓰면 O 의 1/2/3 과
  // 한 칸 어긋나 편집 격자가 생성기와 다른 k 로 열린다 (index.html cellEditorHexSize).
  versionK: field('auto', BOTH, ['auto', 0, 1, 2]),
  // 턴A (역삼각 Type A = **내부 타입 V**) — Type A 전용 구조 옵션.
  //
  // **BOTH 승격 (2026-08-24)**: 구 INTERNAL 사유(«라이브가 0/3 으로 못 읽는다 —
  // 인코더가 역삼각 기하를 안 내고 검출 turn 신호도 미배선»)는 Wave 3 ①②로
  // 전부 닫혔다: scene.js 가 ▽ 기하를 내고(배치 180° 회전·셀 정립),
  // anchor-detect turn 변형 + V 표 인덱스로 왕복이 서며(test/turnA-roundtrip),
  // 운영자 실기기 스캐너 인식이 확인됐다(2026-08-24). 그래서 lab 게이트를 걷고
  // 일반·고급 양쪽 노출로 승격했다 (index.html #turnASection → sharedControls).
  turnA: field(false, BOTH, [false, true]),
  // ── 검출기 seat 축 (W2 C4, 2026-08-24) — 구 `cornerMarker: boolean` 의 승계 ──
  // 코너 마커 (O-CM / A-CM, 2026-08-20 UI 편입)는 «켬/끔» 한 비트가 타입별로 다른
  // 마커를 뜻하는 구조였다. 검출기 3구역 개편으로 **내곽/외곽 seat 선택**으로
  // 분해한다: innerSeat(분류 2 — O-CM · sagoae · H) / outerSeat(분류 3 — A-CM).
  // 허용값의 정본은 finder-zone-ui(FINDER_TAXONOMY 유도)다. ⚠ 여기서 **직접
  // import 하지 못한다** — finder-taxonomy 가 이 모듈(GENERATOR_TYPES)을 import
  // 해서, zone-ui 를 스프레드하면 taxonomy→state→zone-ui→taxonomy 순환으로
  // 모듈 로드가 TDZ 로 죽는다 (W2 C4 실측). 그래서 F-37 의 유도 대신 **검증되는
  // 사본**을 쓴다: 아래 리터럴이 zone-ui 유도와 어긋나면 finder-zone-ui 로드
  // 자기검증이 그 자리에서 던진다 (사본 규칙 명문화 — «유도하거나 규칙을 적어라»).
  // sagoae 는 기존 daehan 예약 회계/formatIndex 를 공유하는 내곽 값이다. 중앙
  // cell-mask 와의 합성 렌더 + C2c 검증 경로가 선 뒤 카드가 양성 선택지가 됐다.
  // `cornerMarker` 필드 자체는 **스키마에서 내렸다** — 생성기 상태는 저장되지
  // 않으므로 «저장값 하위호환» 기전이 없고(드랍 전례의 검증 렌즈 정정과 동일),
  // 죽은 필드를 남기면 그 주석이 거짓이 된다. 인코더 옵션 키 `cornerMarker` 는
  // 그대로다 — buildConfig 가 seat 에서 **파생**해 싣는다 (index.html).
  // 구 boolean 이 어떤 경로로 들어와도 finder-selection.normalizeFinderQrState 가
  // 타입별 seat 로 이관한다.
  // ⭐ **BOTH 승격 (운영자 지시 2026-08-30)** — turnA 승격(위)과 같은 형식이다.
  // 구 INTERNAL 사유는 «실기기 라운드 전 — 합성만으로 정식 노출을 정하지 않는다»
  // (운영자 확정 2026-08-23·24)였고, 그 라운드가 자리별로 다 돌았다:
  //   · o-cm(H) — markerG G formatIndex 왕복 (generator-corner-marker ⑤ 계열).
  //   · a-cm(H2O) — 같은 표의 tri 행.
  //   · v-cm(CO2) — V*CM 인덱스 공유 왕복 (V-CMQ 개설 2026-08-24).
  //   · k-cm(H2CO3) — typeK-roundtrip ② 가 K0CM/K1CM/K2CM 전수 양성으로 뒤집음.
  //   · sagoae — C2c 합성 렌더 + 원문 왕복 36칸 (test/sagoae-roundtrip ②③).
  //   · daehan 서랍 — 운영자 라이브 실기 확인 (턴A·K2, 2026-08-29).
  // 표시 술어의 정본은 finder-zone-ui.seatCardShown 이고, 여기는 **스키마 노출**만
  // 연다 (숨김-active 금지 규약 — 노출과 잠금은 다른 축).
  // ⚠ outerSeat a-cm 은 turnA 와 상호배제 (encodeA 가 둘 다 참이면 던진다).
  // v-cm (2026-08-24 실체 전환) 은 그 쌍대다 — **turnA 를 요구**한다 (V-CM =
  // 턴A + 코너 자리 예약. turnA off + v-cm 조합은 UI sync 가 잠근다).
  // ⭐ **T4 자리 재편 (2026-08-31, PM/028 §2)** — sagoae 가 내곽 허용값에서
  // **심부(deepSeat) 축으로 이사**했다. 내곽은 코너 tetrad 계열(o-cm=H)만 남는다.
  innerSeat: field('none', BOTH, ['none', 'o-cm']),
  // ── 심부(deep) seat 축 (T4 신설 2026-08-31, PM/028 §2) ─────────────────────
  // 분류 2 의 «중심부 기준» 갈래 — 사괘(링 6/8/10 예약)의 전용 축. 3축 모형 =
  // 외곽(앵커 톤) · 내곽(코너 tetrad) · 심부(링 예약), 각 축 독립 선택.
  // 허용값 정본은 finder-zone-ui(DEEP_SEAT_OPTIONS) — innerSeat 와 같은 순환
  // 제약이라 **검증되는 사본**이다 (어긋나면 zone-ui 로드 자기검증이 던진다).
  // 확장 가능 표: 심부 후보가 늘면 값이 는다 (none | sagoae | …).
  // 내곽 o-cm(H)과의 동시 선택은 좌표 정본·합성 회계·왕복이 모두 선 G2~G4
  // (k=8/10/12)에서 개방한다. G1(k=6)은 H×sagoae 교집합 4셀이라 UI가 배타로
  // 남기고, Type C는 노치×H 교집합 4셀이라 o-cm 자체를 노출하지 않는다.
  // 구 innerSeat==='sagoae' 상태는 createGeneratorState 가 이 축으로 이관한다.
  deepSeat: field('none', BOTH, ['none', 'sagoae']),
  // ⭐ **k-cm 편입 (2026-08-25)** — 자리는 2026-08-24 부터 와이어에 실재했지만
  // 부트스트랩이 star 축 포맷 8 을 안 열어 «생성은 되고 스캔이 안 되는» 값이었다.
  // 레인 KCM 이 그 한 줄(familyProfiles('star') 가 VERSIONS_KCM 미소유)을 닫아
  // K0CM/K1CM/K2CM 왕복이 전부 서므로 허용값에 든다 (자 = typeK-roundtrip ②).
  outerSeat: field('none', BOTH, ['none', 'a-cm', 'v-cm', 'k-cm']),
  versionY: field('auto', BOTH, ['auto', 0, 1, 2]),
  customHue: field(210, BOTH, [210, 37]),
  bgMode: field('transparent', BOTH, ['transparent', 'white', 'black']),
  // 'surface' = 배치 미리보기에서 잰 지면 색 판 — **Type Y 전용 카드**다 (운영자
  // 결정 2026-09-01). 스키마는 타입을 모르므로 허용값에만 넣고, 어느 타입에서 카드가
  // 보이는지는 UI 가, 어떻게 푸는지는 quiet-auto 의 resolveQuietZoneChoice 가 진다.
  quietMode: field('auto', BOTH, ['auto', 'none', 'white', 'black', 'contrast', 'surface']),
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
  // 시험판(/lab/) Type Y 로케이터. 안정판 UI 는 이 키를 **보여 주지 않는다**
  // (#yLocatorSection 이 lab 전용).
  //
  // ⚠ 「항상 off」가 아니다 — 이 기본값 'off' 는 **원시 상태값일 뿐**이고, 첫 로드에서
  //   `detectorAutoY = true` 가 `applyAutoLocatorProfileY()` 를 lab 게이트 없이 불러
  //   `cell-surface-v0` 로 덮는다. 즉 사용자가 생성기를 그냥 열면 로케이터는 **켜져 있다.**
  //   (2026-09-01: 이 주석이 「항상 off」라고 말해서, 마인크래프트 빌드 조사 때 「기본값은
  //   우리 사다리와 다른 재료다」라는 오진이 나왔다. 실제로는 같은 v0 이고 ECC 만 다르다.)
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
  // T4 마이그레이션 (2026-08-31, PM/028 §2) — 구 축의 innerSeat='sagoae' 는 심부
  // 자리로 **이관해 읽는다** (조용한 유실 금지: 버리면 사괘 선택이 소리 없이
  // 평 코드가 된다). 명시 deepSeat override 가 함께 오면 새 축이 이긴다 —
  // 이관은 구 상태의 독법이지 새 선택의 상전이 아니다.
  if (state.innerSeat === 'sagoae') {
    state.innerSeat = 'none';
    if (overrides.deepSeat === undefined) state.deepSeat = 'sagoae';
  }
  // 드랍된 중앙 M7이 옛 저장·URL에 남아 있으면 새 기본(중앙 TL)로 명시 정화한다.
  // 그 밖의 유효한 옛 선택은 건드리지 않는다. lab=true는 «lab 전용은 허용» 뜻이고,
  // dropped는 surface와 무관하게 언제나 닫힌다.
  return sanitizeFinderCardState(state, true, GENERATOR_DEFAULT_FINDER_PATTERN_ID);
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
  if (tier === 'auto') return 'auto';
  const version = RESOLUTION_TIER_VERSIONS[type][tier];
  if (version === undefined) {
    // max 는 O 전용 — UI 가 카드를 숨기므로 여기 오면 게이트 누락이다.
    throw new RangeError('Type ' + type + '에 없는 해상도 티어: ' + tier);
  }
  return version;
}

export function resolutionTierForVersion(type, version) {
  versionStateKey(type);
  if (version === 'auto') return 'auto';
  const entry = Object.entries(RESOLUTION_TIER_VERSIONS[type])
    .find(([, candidate]) => String(candidate) === String(version));
  if (!entry) throw new RangeError('Type ' + type + '에 없는 버전: ' + version);
  return entry[0];
}

/**
 * 자리 축 하나가 바뀌면 그 조합을 입력으로 삼는 UI를 한 상전이로 다시 맞춘다.
 *
 * seat 카드 자체만 동기화하면 H/사괘 선택 직후 버전 select·해상도 카드·중앙
 * 파인더 카드에 직전 잠금이 남는다. 호출 순서를 이 함수 하나로 잠가 새 소비자가
 * 생길 때 이벤트 핸들러 일부만 늙는 일을 막는다.
 */
export function syncAfterSeatChange({
  syncSeatUi,
  syncTurnAUi,
  syncTypeUi,
  syncResTierUi,
  renderFinderUi,
}) {
  syncSeatUi();
  syncTurnAUi();
  syncTypeUi();
  syncResTierUi();
  renderFinderUi();
}
