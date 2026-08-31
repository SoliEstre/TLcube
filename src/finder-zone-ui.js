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
 * 구역 규약 (운영자 확정 3분류, 2026-08-21 + W2 설계 ① + T4 심부 분리 2026-08-31):
 *   · 중앙 = 분류 1 — 카드 DOM 은 기존 FINDER_CARD_GROUPS 경로 승계.
 *     taegeuk 단독 카드는 만들지 않는다 (통합자 C2b 게이트 보류 — 브리프 §2 탈출구).
 *   · 내곽 = 분류 2 의 **꼭짓점 기준** 갈래 — 없음(기본) · O-CM(type O).
 *   · **심부(deep) = 분류 2 의 «중심부 기준» 갈래** (T4, PM/028 §2) — 없음(기본) ·
 *     sagoae(O·A, 링 6/8/10 예약 — 기존 daehan 회계/formatIndex 공유 + C2c 검증).
 *     구 내곽 슬롯에 얹혀 있어 H(코너 tetrad)와 배타이던 것을 자기 축으로 분리했다.
 *     H×sagoae는 좌표 정본 재측정으로 G2~G4(k=8/10/12)에서 서로소라 개방했고,
 *     G1(k=6)은 4셀 충돌이라 배타다. Type C도 노치와 H가 전 반경 4셀 겹쳐 닫는다.
 *   · 외곽 = 분류 3 seat — 없음(기본) · A-CM(type A) · V-CM(type A × turnA) ·
 *     K-CM(type K — **와이어는 실재, 생성기 타입 K 가 아직 없어 상태값은 아니다**).
 *   분류 3 의 파인더 행(H · H2O · H2CO3)은 seat 카드가 아니다 — 그 자리를 채우는
 *   파인더 디자인이다 (SEAT_DEFAULT_FINDER 가 연결).
 *
 * seat 실재의 런타임 유도: markerG 표의 family 가 곧 seat 다 — hex(=Type O 육각)
 * 에 CM 행이 있으면 o-cm, tri(=Type A 삼각)에 있으면 a-cm. 마커 와이어가 없는
 * family 는 seat 도 없다. v-cm 은 turnA V 표, k-cm 은 formatK star 표에서 같은
 * 규칙으로 유도한다 (2026-08-24 실체 전환 — 부재 손 행이 사라졌다).
 *
 * ⚠ formatK 는 여기서 import 하므로 **번들에 들어간다** — 그래서 formatK 의 의존은
 * turnA·markerG 둘로 묶어 뒀다 (capacityY 를 끌어들이면 MODULE_ORDER 위상이 깨진다.
 * formatK.js 헤더 §값 선택 ③ 의 ⚠ 참조).
 */

import {
  CENTRAL_N7_FINDER_CARD, CENTRAL_V0_FINDER_CARD, FINDER_CARD_GROUPS,
} from './finder-card-ui.js';
import { GENERATOR_STATE_SCHEMA } from './generator-state.js';
import { MARKER_G_FORMAT_INDEX } from './markerG.js';
import { TURN_A_FORMAT_INDEX } from './turnA.js';
import { K_FORMAT_INDEX } from './formatK.js';
import { SAGOAE_ID } from './finder-daehan.js';

export const SEAT_NONE = 'none';

/**
 * 정식(official) normal 의 중앙 구역 3장 — 운영자 확정 (2026-08-28):
 * cube-bullseye · central-n7-payload(새 기본) · center-qr. 중앙 Y0(central-v0)는
 * 기능을 유지한 채 advanced 표시로 이동한다. 나머지 formal 카드도 advanced에서만
 * 보인다 (**표시 게이트일 뿐** — 스키마·선택 값은 BOTH 유지).
 */
export const OFFICIAL_NORMAL_CENTRAL_IDS = Object.freeze(
  ['cube-bullseye', CENTRAL_N7_FINDER_CARD.id, 'center-qr'],
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

/** 부재 seat — 코드 정체가 없어 유도 원천이 없는 자리 (분류 정본의 KIND_ABSENT 행과
 *  1:1 — test/finder-zone-ui.test.js 가 짝을 강제한다). 자리만 + 클릭 불가.
 *  **지금은 비어 있다**: v-cm(turnSeat)·k-cm(starSeat) 이 2026-08-24 실체 전환으로
 *  각자 와이어 유도로 옮겨 갔다. 목록 자체는 남긴다 — 다음 «코드 정체 없는 자리» 가
 *  생겼을 때 갈 곳이 이미 있어야 부재를 양성 행으로 위장하지 않는다. */
const ABSENT_SEATS = Object.freeze([]);

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

/**
 * K-CM seat (2026-08-24) — «와이어 존재가 곧 seat 실재» 규칙을 formatK star 표로
 * 확장: 표에 cornerMarker 행(K0CM/K1CM/K2CM)이 실재하면 k-cm seat 가 실재한다.
 *
 * ## ⭐ 배타 개설 (2026-08-25) — `stateValue: false` 를 걷었다
 *
 * 사유가 두 번 바뀐 자리다. ① 「생성기 타입에 K 가 아직 없어서」 → K 편입으로 거짓이
 * 됐고, ② 「`decoder/bootstrap.js` 가 star 축 formatIndex 8 을 안 연다」로 이전됐다.
 * ②가 진짜였고 **레인 KCM 이 그 한 줄을 찾아 닫았다**: `familyProfiles('star')` 가
 * `VERSIONS_K` 3행만 소유해서, 광학 디지트가 163/163 맞고 `decodeCellsK` 가 성공했는데도
 * `profileForFormatCandidate` 가 포맷 8 프로파일을 못 찾아 **성공 후보를 버렸다**
 * (빈 후보가 상위에서 `BODY_RS_FAILED` 로 접혀 RS 실패처럼 보였다).
 * star 소유 표를 `[...VERSIONS_K, ...VERSIONS_KCM]` 로 넓혀 닫혔다.
 *
 * 근거는 주장이 아니라 자다 — `test/typeK-roundtrip.test.js` 의 구 음성 락이 같은
 * 자리에서 **K0CM/K1CM/K2CM 전수 양성 왕복**으로 뒤집혔다 (배타 개설 정형 ④).
 * 새 (값,k) 도 새 인덱스도 안 만들었다 — 이미 있던 포맷 8 을 그대로 쓴다.
 */
function starSeat() {
  const wired = K_FORMAT_INDEX.some((entry) => entry.cornerMarker === true);
  return wired
    ? [Object.freeze({
      id: 'k-cm', name: 'K-CM', types: Object.freeze(['K']), ready: true, absent: false,
    })]
    : [];
}

// ⭐ **K 추가 (2026-08-25)** — 「없음」은 자리 축의 원점이라 자리 구역이 뜨는 타입
// 전부에 있어야 한다. K 가 빠져 있어서 Type K 에서는 내곽·외곽 카드가 **하나도**
// 서지 않았다 (운영자 신고 ① 「내곽 및 외곽 파인더 섹션도 없음」의 절반).
const NONE_CARD = Object.freeze({
  id: SEAT_NONE,
  name: SEAT_NONE,
  types: Object.freeze(['O', 'A', 'K']),
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
    // H 는 **카드가 아니다** (운영자 2026-08-24 아침 검수 3 — A-CM=H2O 문법):
    // o-cm 선택이 곧 «자리 + H 심볼 톤» 이다 (buildConfig 가 markerTones 를 함께
    // 싣는다). 분류 2 의 심볼 파인더(H)는 자리(o-cm)의 기본 심볼로 흡수된다 —
    // SEAT_DEFAULT_FINDER 가 그 매핑의 정본이고, zone 대조 테스트는 분류 2 에서
    // 자리 기본 심볼을 **제외한** 집합과 1:1 을 잰다 (외곽의 H2O 와 같은 규칙).
  ];
  const deep = [
    NONE_CARD,
    // sagoae — 분류 2 «중심부 기준» 갈래의 심부 자리 (T4 재편 2026-08-31, PM/028 §2 —
    // 구 내곽 행에서 이사). 기존 daehan 예약 회계/formatIndex 를 공유하고 장면이
    // 선택된 중앙(독립 cell-mask + 정식 3종) 바깥에 고리만 합성한다. 디코더는 C2c
    // 검증으로 같은 포즈에서 예약 회계를 연다. 별도 renderKind·formatIndex 없음.
    Object.freeze({
      id: SAGOAE_ID, name: SAGOAE_ID, types: Object.freeze(['O', 'A']),
      ready: true, absent: false,
    }),
  ];
  const outer = [
    NONE_CARD,
    ...markerSeat('outer'),
    ...turnSeat(),
    ...starSeat(),
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
    deep: Object.freeze(deep),
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
export const DEEP_SEAT_OPTIONS = Object.freeze(
  ZONES.deep.filter((card) => !card.absent && card.stateValue !== false)
    .map((card) => card.id),
);
export const OUTER_SEAT_OPTIONS = Object.freeze(
  ZONES.outer.filter((card) => !card.absent && card.stateValue !== false)
    .map((card) => card.id),
);

/**
 * 자리 구역이 열리는 생성기 타입 (Y 는 자기 로케이터 문법을 쓰므로 자리 축이 없다).
 *
 * index.html 이 손 사본으로 들고 있던 값을 여기로 올렸다 (2026-08-30) — 자리 축의
 * 다른 정본이 전부 이 모듈에 있는데 «어느 타입에 자리가 있나» 만 소비 지점에
 * 남아 있었다. 사본 규칙(«유도하거나 규칙을 적어라»)의 미적용 자리였다.
 */
export const SEAT_ZONE_TYPES = Object.freeze(['O', 'A', 'K']);

/**
 * 이 자리 카드가 **보이는가** (정식·시험판 공통).
 *
 * ⚠ **표시와 잠금은 다른 축이다.** 이 술어는 «화면에 카드가 있나» 만 답한다.
 * 누를 수 있나(seatReady · wireLocked · vcmLocked · 타입 부합 잠금)는 소비 지점이
 * 따로 계산하고, 잠긴 카드는 **보이되 disabled** 다 — 숨기면 존재를 발견할 길이
 * 없다(V-CM g875 전례).
 *
 * ## ⭐ 정식 노출 (운영자 지시 2026-08-30) — 구 `officialHidden` 철폐
 *
 * 구 규칙은 index.html syncSeatUi 의 `officialHidden = !lab && !isAutoCard && !isNone`
 * 이었다 (운영자 2026-08-25 «CM계열 선택지 정식에선 숨기고(lab에만 표시)»). 그래서
 * 정식 빌드에는 자동·없음 둘만 남았고, 운영자가 2026-08-30 에 그 결과를 네 갈래로
 * 신고했다: 내곽에 정식 H 카드가 없다 · 외곽에 H2O·CO2·H2CO3 카드가 없다 ·
 * 사괘 단독 카드가 없다 · daehan 이 고급에 갇혀 있다.
 *
 * 근거가 그 사이에 바뀌었다 — 구 게이트의 사유는 «실기기 라운드 전» 이었는데
 * (generator-state seat 필드 주석) 그 라운드가 돌았다: K-CM 은 typeK-roundtrip 전수
 * 양성, V-CM 은 V*CM 인덱스 공유 왕복, sagoae 는 C2c 왕복 36칸(O/A × V × ECC ×
 * 해상도, test/sagoae-roundtrip ③), daehan 은 운영자 라이브 실기(턴A·K2).
 *
 * 그래서 `lab` 은 이 술어의 인자가 **아니다**. 시험판이 정식보다 더 보여 주는 축은
 * 여전히 있지만(자동의 allowBlocked 등) 그건 «무엇을 고르나» 쪽이지 «카드가 있나»
 * 쪽이 아니다.
 *
 * @param {{seat:string, type:string, seatTypes:readonly string[], turnA?:boolean,
 *          absent?:boolean}} input
 */
export function seatCardShown({ seat, type, seatTypes, turnA = false, absent = false }) {
  // 부재 자리 — 쓸 수 있는 내부 타입이 생성기에 없다. 존재는 분류 정본과 SPEC 이
  // 말한다, 잠긴 카드가 아니라.
  if (absent === true) return false;
  // 타입 부합 (zoneCards 의 types 표).
  if (!seatTypes.includes(type)) return false;
  // 외곽 코너 자리는 실루엣 방향을 따라간다 (Wave 3 ④ — 던짐 조합을 UI 가 안
  // 만든다): 정삼각이면 a-cm, 역삼각(턴A)이면 v-cm 하나만 보인다.
  if (seat === 'a-cm' && turnA === true) return false;
  if (seat === 'v-cm' && turnA !== true) return false;
  return true;
}

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
  if (ZONES.inner[0].id !== SEAT_NONE || ZONES.deep[0].id !== SEAT_NONE
    || ZONES.outer[0].id !== SEAT_NONE) {
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
  // T4 (2026-08-31) — sagoae 는 내곽이 아니라 심부 허용값이다. 내곽에 남거나
  // 심부에서 빠지면 자리 재편이 반쪽이다.
  if (!INNER_SEAT_OPTIONS.includes('o-cm') || INNER_SEAT_OPTIONS.includes(SAGOAE_ID)
    || !DEEP_SEAT_OPTIONS.includes(SAGOAE_ID)
    || !OUTER_SEAT_OPTIONS.includes('a-cm') || !OUTER_SEAT_OPTIONS.includes('v-cm')) {
    throw new Error('seat 허용값 유도가 깨졌다: inner=['
      + INNER_SEAT_OPTIONS.join(',') + '] deep=[' + DEEP_SEAT_OPTIONS.join(',')
      + '] outer=[' + OUTER_SEAT_OPTIONS.join(',') + ']');
  }
  for (const card of [...ZONES.inner, ...ZONES.deep, ...ZONES.outer]) {
    if (!card.types || card.types.length === 0) {
      throw new Error('seat 카드 ' + card.id + ' 에 타입 부합 표가 없다');
    }
  }
  // 상태 스키마 options 대조 — generator-state 는 이 유도를 **직접 스프레드하지
  // 못한다** (헤더 ② 순환 제약). 그쪽은 검증되는 사본이고, 어긋남은 여기서
  // 로드 시점에 던진다.
  const schemaEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (!schemaEq([...GENERATOR_STATE_SCHEMA.innerSeat.options], [...INNER_SEAT_OPTIONS])
    || !schemaEq([...GENERATOR_STATE_SCHEMA.deepSeat.options], [...DEEP_SEAT_OPTIONS])
    || !schemaEq([...GENERATOR_STATE_SCHEMA.outerSeat.options], [...OUTER_SEAT_OPTIONS])) {
    throw new Error('generator-state 의 seat options 사본이 zone 유도와 어긋났다: '
      + 'inner ' + GENERATOR_STATE_SCHEMA.innerSeat.options.join(',') + ' vs '
      + INNER_SEAT_OPTIONS.join(',') + ' · deep '
      + GENERATOR_STATE_SCHEMA.deepSeat.options.join(',') + ' vs '
      + DEEP_SEAT_OPTIONS.join(',') + ' · outer '
      + GENERATOR_STATE_SCHEMA.outerSeat.options.join(',') + ' vs '
      + OUTER_SEAT_OPTIONS.join(','));
  }
}
