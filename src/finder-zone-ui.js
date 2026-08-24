/**
 * finder-zone-ui.js — 검출기 3구역(중앙·내곽·외곽) 카드 유도 (W2 C4, 2026-08-24).
 *
 * 분류 정본은 `FINDER_TAXONOMY`(src/finder-taxonomy.js)다. ⚠ 그러나 이 모듈은
 * 그것을 **직접 import 하지 못한다** — 두 겹의 구조 제약이 실측으로 막았다:
 *   ① finder-taxonomy 는 `node:url`·`node:path` 를 top-level import 한다
 *      (CLI 덤프 모드) — 단일 파일 번들(빌드 tools/build-single.mjs)에 넣으면
 *      브라우저가 그 specifier 에서 죽는다 (bundle.test.js 의 specifier 회귀 실측).
 *   ② finder-taxonomy → generator-state import 가 이미 있어, 유도를 스키마에
 *      스프레드하면 taxonomy→state→zone-ui→taxonomy 순환으로 TDZ 가 난다 (실측).
 *
 * 그래서 seat 유도의 **런타임 입력은 와이어 정본**(markerG 표 + finder-daehan)이고,
 * 분류 정본과의 일치는 test/finder-zone-ui.test.js 가 Node 쪽에서 전수 대조한다
 * («유도하거나 규칙을 적어라» — 유도가 막힌 자리는 검증되는 사본으로).
 *
 * 구역 규약 (운영자 확정 3분류, 2026-08-21 + W2 설계 ①):
 *   · 중앙 = 분류 1 — 카드 DOM 은 기존 FINDER_CARD_GROUPS 경로 승계.
 *     taegeuk 단독 카드는 만들지 않는다 (통합자 C2b 게이트 보류 — 브리프 §2 탈출구).
 *   · 내곽 = 분류 2 — 없음(기본) · O-CM(type O) · sagoae(O·A, **자리만** — 단독
 *     와이어 편입은 통합자 C2c. V-CM/K-CM 부재 문법과 동일하게 disabled).
 *   · 외곽 = 분류 3 seat + 부재 — 없음(기본) · A-CM(type A) ·
 *     V-CM/K-CM(**부재** — 자리만, 클릭 불가).
 *   분류 3 의 파인더 행(H · H2O · H2CO3)은 seat 카드가 아니다 — 그 자리를 채우는
 *   파인더 디자인이다 (SEAT_DEFAULT_FINDER 가 연결).
 *
 * seat 실재의 런타임 유도: markerG 표의 family 가 곧 seat 다 — hex(=Type O 육각)
 * 에 CM 행이 있으면 o-cm, tri(=Type A 삼각)에 있으면 a-cm. 마커 와이어가 없는
 * family 는 seat 도 없다. v-cm/k-cm 은 **부재 행**이라 유도 원천 자체가 없다 —
 * 분류 정본의 KIND_ABSENT 손 행과 같은 지위의 손 행이고, 테스트가 짝을 강제한다.
 */

import { CENTRAL_V0_FINDER_CARD, FINDER_CARD_GROUPS } from './finder-card-ui.js';
import { GENERATOR_STATE_SCHEMA } from './generator-state.js';
import { MARKER_G_FORMAT_INDEX } from './markerG.js';
import { TURN_A_FORMAT_INDEX } from './turnA.js';
import { SAGOAE_ID } from './finder-daehan.js';

export const SEAT_NONE = 'none';

/**
 * 정식(official) normal 의 중앙 구역 3장 — 운영자 확정 (2026-08-23·24, W2 C5):
 * cube-bullseye(기본) · central-v0 · center-qr. 나머지 formal 카드는 advanced
 * 에서만 보인다 (**표시 게이트일 뿐** — 스키마·선택 값은 BOTH 유지).
 * 근거: bullseye 는 라이브러리 기본이지 화면 기본이 아니고(finder-patterns.js §9),
 * central-cube-3tone 은 실사진 10장 전부 실패 (PM/021:180 «단일 실패점 — 비컨 대체»).
 */
export const OFFICIAL_NORMAL_CENTRAL_IDS = Object.freeze(
  ['cube-bullseye', 'central-v0', 'center-qr'],
);

/** advancedOnly 는 손 목록이 아니라 **여집합 유도**다: formal 행(formal 그룹 +
 *  중앙 v0) − 정식 normal 3장. formal 카드가 늘면 자동으로 advanced 쪽에 선다. */
export const ADVANCED_ONLY_CENTRAL_IDS = Object.freeze(
  [...FINDER_CARD_GROUPS.formal.map((card) => card.id), CENTRAL_V0_FINDER_CARD.id]
    .filter((id) => !OFFICIAL_NORMAL_CENTRAL_IDS.includes(id)),
);

/** markerG family → seat 카드 서술 (family 가 와이어 정본의 축이다). */
const FAMILY_SEATS = Object.freeze({
  hex: Object.freeze({ id: 'o-cm', name: 'O-CM', zone: 'inner', types: Object.freeze(['O']) }),
  tri: Object.freeze({ id: 'a-cm', name: 'A-CM', zone: 'outer', types: Object.freeze(['A']) }),
});

/** 부재 seat — 코드 정체가 없어 유도 원천이 없다 (분류 정본의 KIND_ABSENT 행과
 *  1:1 — test/finder-zone-ui.test.js 가 짝을 강제한다). 자리만 + 클릭 불가.
 *  v-cm 은 2026-08-24 실체 전환으로 여기서 빠졌다 — 아래 turnSeat() 유도로 옮겨감. */
const ABSENT_SEATS = Object.freeze([
  Object.freeze({ id: 'k-cm', name: 'k-cm', types: Object.freeze(['O', 'A']) }),
]);

/**
 * V-CM seat (2026-08-24) — «와이어 존재가 곧 seat 실재» 규칙을 turnA V 표로 확장:
 * V 표에 cornerMarker 행(V0CM/V1CM/V2CM)이 실재하면 v-cm seat 가 실재한다.
 * Type A × turnA 전용 — turnA off 상태의 표시 게이트는 index.html sync 몫이다
 * (a-cm × turnA 상호배제의 쌍대: v-cm 은 turnA 를 **요구**한다).
 */
function turnSeat() {
  const wired = TURN_A_FORMAT_INDEX.some((entry) => entry.cornerMarker === true);
  return wired
    ? [Object.freeze({
      id: 'v-cm', name: 'V-CM', types: Object.freeze(['A']), ready: true, absent: false,
    })]
    : [];
}

const NONE_CARD = Object.freeze({
  id: SEAT_NONE,
  name: SEAT_NONE,
  types: Object.freeze(['O', 'A']),
  ready: true,
  absent: false,
});

function markerSeat(zone) {
  return Object.entries(FAMILY_SEATS)
    .filter(([family, seat]) => seat.zone === zone
      // 와이어 존재가 곧 seat 실재다 — CM 행이 없는 family 는 카드도 없다.
      && MARKER_G_FORMAT_INDEX.some((entry) => entry.family === family && entry.centerQr === false))
    .map(([, seat]) => Object.freeze({
      id: seat.id, name: seat.name, types: seat.types, ready: true, absent: false,
    }));
}

/**
 * 3구역 카드 서술자. central 은 id 목록(카드 DOM 은 기존 경로 승계 — 분류 1 과의
 * 일치는 테스트가 대조), inner/outer 는 seat 카드 서술자 배열 — 없음이 항상 앞.
 */
export function zoneCards() {
  const inner = [
    NONE_CARD,
    ...markerSeat('inner'),
    // sagoae — 분류 2 의 내곽 파인더. **자리만**이다: 디코더 분해(C2c, sagoae-verify)는
    // 착지했지만 생성측 합성 렌더(임의 중앙 파인더 + sagoae 고리)가 미배선이다.
    Object.freeze({
      id: SAGOAE_ID, name: SAGOAE_ID, types: Object.freeze(['O', 'A']),
      ready: false, absent: false,
    }),
    // H 는 **카드가 아니다** (운영자 2026-08-24 아침 검수 3 — A-CM=H2O 문법):
    // o-cm 선택이 곧 «자리 + H 심볼 톤» 이다 (buildConfig 가 markerTones 를 함께
    // 싣는다). 분류 2 의 심볼 파인더(H)는 자리(o-cm)의 기본 심볼로 흡수된다 —
    // SEAT_DEFAULT_FINDER 가 그 매핑의 정본이고, zone 대조 테스트는 분류 2 에서
    // 자리 기본 심볼을 **제외한** 집합과 1:1 을 잰다 (외곽의 H2O 와 같은 규칙).
  ];
  const outer = [
    NONE_CARD,
    ...markerSeat('outer'),
    ...turnSeat(),
    ...ABSENT_SEATS.map((seat) => Object.freeze({
      id: seat.id, name: seat.name, types: seat.types, ready: false, absent: true,
    })),
  ];
  return Object.freeze({
    central: Object.freeze(
      [...Object.values(FINDER_CARD_GROUPS).flat(), CENTRAL_V0_FINDER_CARD]
        .map((card) => Object.freeze({
          id: card.id,
          // C5 고급 게이팅 — formal 행의 비-정식-normal 카드만 advancedOnly 다.
          advancedOnly: ADVANCED_ONLY_CENTRAL_IDS.includes(card.id),
        })),
    ),
    inner: Object.freeze(inner),
    outer: Object.freeze(outer),
  });
}

const ZONES = zoneCards();

/** 상태 스키마 허용값 유도 (F-37 규약 — 손 목록 금지). 부재(absent)는 상태가
 *  될 수 없으므로 제외한다. sagoae 는 자리 예약 값으로 포함한다 — disabled 는
 *  표시 게이트이지 값의 무효가 아니다. */
export const INNER_SEAT_OPTIONS = Object.freeze(
  ZONES.inner.filter((card) => !card.absent && card.stateValue !== false)
    .map((card) => card.id),
);
export const OUTER_SEAT_OPTIONS = Object.freeze(
  ZONES.outer.filter((card) => !card.absent && card.stateValue !== false)
    .map((card) => card.id),
);

/**
 * CM+Q 와이어 존재 술어 (설계 ① 배타표) — centerQr×seat 잠금은 상수가 아니라
 * **markerG 에 CMQ 행이 실재하는가**로 게이트한다. C2a(2026-08-23)가 CMQ 6칸을
 * 착지시켰으므로 현재 hex·tri 모두 true — 병용이 합법이다. 이 술어가 false 인
 * family 가 다시 생기면 UI 가 그 자리에서 seat 카드를 잠근다 (g580 힌트).
 */
export function cmqWireExists(family) {
  return MARKER_G_FORMAT_INDEX.some(
    (entry) => entry.family === family && entry.centerQr === true,
  );
}

/* ── 자기검증 (모듈 로드 시 — 브라우저 안전 원천만으로) ─────────────────── */
{
  if (ZONES.inner[0].id !== SEAT_NONE || ZONES.outer[0].id !== SEAT_NONE) {
    throw new Error('seat 구역의 첫 카드는 없음이어야 한다');
  }
  // C5 — 정식 normal 3장이 전부 실재하고, advancedOnly 여집합이 비어 있지 않다.
  const centralIds = ZONES.central.map((card) => card.id);
  for (const id of OFFICIAL_NORMAL_CENTRAL_IDS) {
    if (!centralIds.includes(id)) {
      throw new Error('정식 normal 중앙 카드 ' + id + ' 가 카드 목록에 없다');
    }
  }
  if (ADVANCED_ONLY_CENTRAL_IDS.length === 0) {
    throw new Error('advancedOnly 유도가 비었다 — formal 행이 전부 정식 normal 이 됐다면 '
      + 'OFFICIAL_NORMAL_CENTRAL_IDS 확정을 다시 봐야 한다');
  }
  if (!INNER_SEAT_OPTIONS.includes('o-cm') || !INNER_SEAT_OPTIONS.includes(SAGOAE_ID)
    || !OUTER_SEAT_OPTIONS.includes('a-cm') || !OUTER_SEAT_OPTIONS.includes('v-cm')) {
    throw new Error('seat 허용값 유도가 깨졌다: inner=['
      + INNER_SEAT_OPTIONS.join(',') + '] outer=[' + OUTER_SEAT_OPTIONS.join(',') + ']');
  }
  for (const card of [...ZONES.inner, ...ZONES.outer]) {
    if (!card.types || card.types.length === 0) {
      throw new Error('seat 카드 ' + card.id + ' 에 타입 부합 표가 없다');
    }
  }
  // 상태 스키마 options 대조 — generator-state 는 이 유도를 **직접 스프레드하지
  // 못한다** (헤더 ② 순환 제약). 그쪽은 검증되는 사본이고, 어긋남은 여기서
  // 로드 시점에 던진다.
  const schemaEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (!schemaEq([...GENERATOR_STATE_SCHEMA.innerSeat.options], [...INNER_SEAT_OPTIONS])
    || !schemaEq([...GENERATOR_STATE_SCHEMA.outerSeat.options], [...OUTER_SEAT_OPTIONS])) {
    throw new Error('generator-state 의 seat options 사본이 zone 유도와 어긋났다: '
      + 'inner ' + GENERATOR_STATE_SCHEMA.innerSeat.options.join(',') + ' vs '
      + INNER_SEAT_OPTIONS.join(',') + ' · outer '
      + GENERATOR_STATE_SCHEMA.outerSeat.options.join(',') + ' vs '
      + OUTER_SEAT_OPTIONS.join(','));
  }
}
