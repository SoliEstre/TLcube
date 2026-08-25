/**
 * generator-locator-options.js — Type Y 검출기(로케이터) 카드의 **표시 규칙**.
 *
 * 운영자 명세 (2026-08-25):
 *   「Y0일 땐 없음이랑 v0만, Y1 이상이면 없음/v0T/v0TR,
 *     안쪽 QR 선택했으면 중앙측일 때는 v0TRQ만,
 *     코너측일 땐 없음(타입 Y QR 안쪽 초기 옵션)/v0TY/v0TRY 이렇게만 표시되어야됨.」
 *
 * ## 왜 «허용 목록» 인가
 *
 * 종전은 «숨길 것» 을 적는 부정 목록이었다. 부정 목록은 옵션이 늘 때마다 샌다 —
 * 새 프로파일은 «안 적혔으니 보인다». 명세가 「이렇게**만** 표시」라면 정본은
 * 긍정 목록이다.
 *
 * ## v0TY · v0TRY 는 카드가 없다
 *
 * 운영자가 코너측에서 부른 이름은 v0TY·v0TRY 인데, 그 둘은 W2 C3 에서 **파생값으로
 * 강등**돼 카드가 없다 (카드를 되살리면 그때 없앤 «QR 위치 ↔ 로케이터» 양방향 강제가
 * 함께 돌아온다). `deriveYLocatorForQrPosition` 이 안쪽+코너측에서 v0T·v0TR 선택을
 * v0TY·v0TRY 로 유도하므로, **카드로는 v0T·v0TR 를 보이고 결과 프로파일이 v0TY·v0TRY**
 * 다 (실측: v0TR 카드 → 47 B = v0TRY. v0TR 자신은 58 B).
 *
 * ## ⚠ 안쪽 QR 은 버전을 묻지 않는다
 *
 * `resolveAutoLocatorProfileY` 가 `pos === 'inner'` 를 자동 사다리보다 **먼저** 가로채
 * T 계열(n=21)로 보낸다. 그래서 여기서도 안쪽이면 버전을 T 계열로 본다 — 사다리 값을
 * 쓰면 짧은 페이로드에서 Y0(n=13)이 나오고 T 계열이 전부 «n 미지원» 으로 걸려
 * **v0T 카드가 조용히 사라진다** (2026-08-25 브라우저 실측에서 실제로 그랬다).
 */

import {
  LOCATOR_PROFILE_OFF,
  LOCATOR_PROFILE_CELL_SURFACE_V0,
  LOCATOR_PROFILE_CELL_SURFACE_V0T,
  LOCATOR_PROFILE_CELL_SURFACE_V0TR,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRQ,
  LOCATOR_PROFILE_CELL_SURFACE_V0TY,
  LOCATOR_PROFILE_CELL_SURFACE_V0TRY,
} from './locatorY.js';

/** 안쪽 QR 이면 T 계열(n=21)이 강제된다 — 버전 축을 묻지 않는다. */
export const INNER_FORCED_VERSION_Y = 1;

/** 파생 프로파일 → 그것을 만든 **기반 카드**. 없으면 활성 카드가 하나도 안 켜진다. */
// ⭐ **2026-08-25 카드 복원으로 비었다.** v0TY·v0TRY 가 자기 카드를 되찾았으므로
// 사상할 것이 없다 — 사상을 남겨 두면 사용자가 v0TY 를 눌렀는데 v0T 가 켜진다.
// 표를 지우지 않고 **빈 채로** 두는 이유: 앞으로 또 «카드 없는 파생값» 이 생기면
// 여기가 그 자리다 (그때 활성 카드가 하나도 안 켜지는 증상으로 되돌아온다).
export const CARD_FOR_DERIVED_PROFILE = Object.freeze({});

/** 활성 프로파일을 화면 카드 id 로 옮긴다 (파생이면 기반 카드). */
export function activeLocatorCardId(profile) {
  return CARD_FOR_DERIVED_PROFILE[profile] || profile;
}

/**
 * 이 상태에서 **보여야 할** 로케이터 카드 id.
 *
 * `auto` 는 여기 없다 — 언제나 보인다 (자동의 값은 렌더 시점에 정해지므로 상태로
 * 가릴 수 없다). 호출자가 별도로 유지한다.
 *
 * @param {{inner:boolean, far:boolean, versionY:number}} state
 * @returns {string[]}
 */
export function allowedYLocatorCards({ inner, far, versionY }) {
  const tSeries = [LOCATOR_PROFILE_CELL_SURFACE_V0T, LOCATOR_PROFILE_CELL_SURFACE_V0TR];
  if (inner) {
    // 중앙측은 «v0TRQ 만» 이다 — 없음도 없다 (중앙 슬롯이 강제된다).
    // 코너측은 **먼 코너 슬롯 계열**이다: v0TY · v0TRY (2026-08-25 운영자 — 카드 복원).
    // v0T · v0TR 이 아니다. 둘은 슬롯이 없는 전면 레이아웃이라 먼 코너 QR 이 설 자리가 없다.
    return far
      ? [LOCATOR_PROFILE_OFF, LOCATOR_PROFILE_CELL_SURFACE_V0TY, LOCATOR_PROFILE_CELL_SURFACE_V0TRY]
      : [LOCATOR_PROFILE_CELL_SURFACE_V0TRQ];
  }
  return versionY === 0
    ? [LOCATOR_PROFILE_OFF, LOCATOR_PROFILE_CELL_SURFACE_V0]
    : [LOCATOR_PROFILE_OFF, ...tSeries];
}

/** 표시 판정에 쓸 «지금 버전». 안쪽이면 사다리를 묻지 않는다 (§⚠). */
export function effectiveVersionYForOptions({ inner, versionY, autoVersion }) {
  if (inner) return INNER_FORCED_VERSION_Y;
  if (versionY !== 'auto') return Number(versionY);
  return Number.isInteger(autoVersion) ? autoVersion : 1;
}
