/**
 * generator-seat-auto.js — 내곽·외곽 «자동» 자리 선택의 기준표.
 *
 * 운영자 명세 (2026-08-25):
 *   「내곽/외곽 옵션 맨 앞에 자동 항목 추가하고 기본 선택 상태로. 자동 기준 아래 적용:
 *     O일땐 외곽 자리 섹션 표시 안 해야하고, 내곽 자리 기본값으로 H로 적용.
 *     A는 내곽 없음, 외곽 H2O를 기본값으로.
 *     V는 내곽 없음, 외곽 NO2(→CO2)를 기본값으로.
 *     K는 내곽 없음, 외곽 H2CO3를 기본값으로.
 *     공통으로 중앙 taegeuk을 선택했을 경우 내곽을 sagoae, 외곽은 없음 기본값으로.」
 *
 * ## 심볼 이름 → 자리 id
 *
 * 명세는 **심볼 이름**(H · H2O · CO2 · H2CO3 · sagoae)으로 적혀 있는데, 상태가 드는
 * 값은 **자리 id**(o-cm · a-cm · v-cm · k-cm · sagoae)다. 둘은 일대일이고 그 매핑의
 * 정본은 `finder-zone-ui`(SEAT_DEFAULT_FINDER)다 — 「o-cm 선택이 곧 자리 + H 심볼 톤」
 * 이라는 2026-08-24 운영자 확정 문법이다. 그래서 H·H2O·H2CO3 는 **카드가 아니다.**
 *
 * ## ⛔ 표의 두 칸은 지금 성립하지 않는다
 *
 * 자동이 «고를 수 있다» 고 말하는 것과 «그 결과가 동작한다» 는 다르다. 아래 둘은
 * 자리는 실재하지만 **끝단이 없다** — 자동이 그걸 고르면 이 프로젝트가 여러 번 겪은
 * 「켰는데 안 먹는」 상태를 자동이 **기본값으로** 만들어 낸다. 그래서 표에 사실을
 * 적어 두고 (`blocked`), 소비자가 안전한 폴백을 쓰게 한다.
 *
 *   · `sagoae` — 검출측(bootstrap 합성 가설 + 회계 개방)은 완료. **생성측 합성 렌더가
 *     없다** (임의 중앙 파인더 + sagoae 고리를 그릴 경로가 없고, index.html 의 렌더
 *     용접 한 줄이 예약을 켜면 중앙 파인더를 원자 daehan 으로 강제한다).
 *   · `k-cm` (H2CO3) — 인코더도 디코더 후단(decode-k)도 있는데 그 사이 부트스트랩이
 *     star 축 formatIndex **8 을 안 연다**. 생성은 되고 **스캔이 안 된다**
 *     (test/typeK-roundtrip.test.js ② 가 그 사실의 자).
 *
 * 해제되면 `blocked` 를 지우면 된다 — 표의 나머지는 안 건드린다.
 */

export const SEAT_NONE = 'none';

/** 자리 id — `finder-zone-ui` 의 카드 id 와 같은 문자열이어야 한다. */
export const SEAT_O_CM = 'o-cm';
export const SEAT_A_CM = 'a-cm';
export const SEAT_V_CM = 'v-cm';
export const SEAT_K_CM = 'k-cm';
export const SEAT_SAGOAE = 'sagoae';

/** 중앙 파인더가 taegeuk 이면 타입과 **무관하게** 이 행이 이긴다 (명세 «공통으로»). */
const TAEGEUK_ROW = Object.freeze({
  inner: SEAT_SAGOAE,
  outer: SEAT_NONE,
  outerSectionVisible: true,
  blocked: 'sagoae-no-generator-render',
});

/**
 * 타입별 자동 기준. `type` 은 **유효 편집 타입**이다 — 턴A 를 켠 Type A 는 `V` 다
 * (index.html effectiveEditorTypeFromGenerator 와 같은 축).
 */
const BY_TYPE = Object.freeze({
  // O 는 외곽 자리 섹션 자체를 안 보인다 (명세).
  O: Object.freeze({ inner: SEAT_O_CM, outer: SEAT_NONE, outerSectionVisible: false, blocked: null }),
  A: Object.freeze({ inner: SEAT_NONE, outer: SEAT_A_CM, outerSectionVisible: true, blocked: null }),
  V: Object.freeze({ inner: SEAT_NONE, outer: SEAT_V_CM, outerSectionVisible: true, blocked: null }),
  K: Object.freeze({
    inner: SEAT_NONE, outer: SEAT_K_CM, outerSectionVisible: true,
    blocked: 'k-cm-bootstrap-unwired',
  }),
});

/** 막힌 칸의 안전 폴백 — «없음». 자동이 스캔 불가 코드를 기본값으로 만들지 않는다. */
const SAFE_FALLBACK = Object.freeze({ inner: SEAT_NONE, outer: SEAT_NONE });

/**
 * 자동이 고를 자리.
 *
 * @param {{type:'O'|'A'|'V'|'K', centralFinderIsTaegeuk?:boolean, allowBlocked?:boolean}} state
 *   `allowBlocked` 는 시험판(/lab/)처럼 «안 되는 것도 눌러 보는» 표면을 위한 문이다.
 *   기본값 false — 정식 화면의 자동은 절대 막힌 칸을 고르지 않는다.
 * @returns {{inner:string, outer:string, outerSectionVisible:boolean, blocked:string|null,
 *            appliedFallback:boolean}}
 */
export function autoSeatsFor({ type, centralFinderIsTaegeuk = false, allowBlocked = false }) {
  const row = centralFinderIsTaegeuk ? TAEGEUK_ROW : BY_TYPE[type];
  if (!row) throw new RangeError('자동 자리 기준표에 없는 타입: ' + type);
  if (row.blocked !== null && !allowBlocked) {
    return {
      inner: SAFE_FALLBACK.inner,
      outer: SAFE_FALLBACK.outer,
      outerSectionVisible: row.outerSectionVisible,
      blocked: row.blocked,
      appliedFallback: true,
    };
  }
  return {
    inner: row.inner,
    outer: row.outer,
    outerSectionVisible: row.outerSectionVisible,
    blocked: row.blocked,
    appliedFallback: false,
  };
}

/** 표에 등재된 타입 (테스트가 전수를 돌 때 쓴다 — 손 목록 금지). */
export const AUTO_SEAT_TYPES = Object.freeze(Object.keys(BY_TYPE));
