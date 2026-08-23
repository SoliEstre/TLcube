// finder-selection.js — Type O/A 중앙 파인더와 QR 위치의 양방향 상태 계약

export const CENTER_QR_FINDER_PATTERN_ID = 'center-qr';
export const CENTRAL_V0_FINDER_PATTERN_ID = 'central-v0';
export const DEFAULT_OUTER_QR_POSITION = 'TL';

export function isCentralV0FinderPatternId(id) {
  return id === CENTRAL_V0_FINDER_PATTERN_ID;
}

const profileFamily = (type) => type === 'Y' ? 'Y' : 'OA';

/**
 * O/A는 중앙 QR을 기본 파인더로, Y는 종전의 바깥 QR을 기본으로 쓴다.
 *
 * 공용 qrPosition 하나만 두고 타입을 바꾸면 O/A의 `inner`가 Y의 윈도 β로 새거나,
 * 반대로 Y의 코너 선택이 O/A 기본값을 덮는다. 타입군별 스냅샷을 별도로 들고 전환할 때만
 * 공용 렌더 상태로 올린다. 스냅샷은 불변 객체처럼 교체하며 직접 수정하지 않는다.
 */
export function createFinderQrProfiles(defaultFinderPatternId) {
  if (typeof defaultFinderPatternId !== 'string' || defaultFinderPatternId === '') {
    throw new TypeError('기본 파인더 id가 필요하다');
  }
  return Object.freeze({
    OA: Object.freeze({
      qrPosition: 'inner',
      finderPatternId: CENTER_QR_FINDER_PATTERN_ID,
      previousFinderPatternId: defaultFinderPatternId,
      previousOuterQrPosition: DEFAULT_OUTER_QR_POSITION,
      qrFacePlacement: 'seam',
    }),
    Y: Object.freeze({
      qrPosition: DEFAULT_OUTER_QR_POSITION,
      finderPatternId: defaultFinderPatternId,
      previousFinderPatternId: defaultFinderPatternId,
      previousOuterQrPosition: DEFAULT_OUTER_QR_POSITION,
      qrFacePlacement: 'seam',
    }),
  });
}

function finderQrSnapshot(state) {
  return Object.freeze({
    qrPosition: state.qrPosition,
    finderPatternId: state.finderPatternId,
    previousFinderPatternId: state.previousFinderPatternId,
    previousOuterQrPosition: state.previousOuterQrPosition,
    // QR 면 배치 (W2 C3) — Y 전용 축이지만 스냅샷은 타입군 공용 형태라 함께 담는다.
    // O/A 는 이 값을 안 읽으므로 실어도 무해하고, Y 왕복에서 배치 선택이 보존된다.
    qrFacePlacement: state.qrFacePlacement,
  });
}

/** 타입을 바꾸면서 현재 타입군 선택을 저장하고 대상 타입군 선택을 복원한다. */
export function selectGeneratorType(state, type, defaultFinderPatternId) {
  if (!['O', 'A', 'Y'].includes(type)) {
    throw new RangeError('알 수 없는 생성기 타입: ' + type);
  }
  const defaults = createFinderQrProfiles(defaultFinderPatternId);
  const sourceFamily = profileFamily(state.type);
  const targetFamily = profileFamily(type);
  const currentProfiles = state.finderQrProfiles || defaults;
  const finderQrProfiles = Object.freeze({
    ...currentProfiles,
    [sourceFamily]: finderQrSnapshot(state),
  });
  const target = finderQrProfiles[targetFamily] || defaults[targetFamily];
  return normalizeFinderQrState({
    ...state,
    ...target,
    type,
    finderQrProfiles,
  }, type, defaultFinderPatternId);
}

function previousFinderOrDefault(state, defaultFinderPatternId) {
  const previous = state.previousFinderPatternId;
  return previous && previous !== CENTER_QR_FINDER_PATTERN_ID
    && previous !== CENTRAL_V0_FINDER_PATTERN_ID
    ? previous
    : defaultFinderPatternId;
}

/**
 * O/A 에서만 중앙 QR ↔ 안쪽을 하나의 상태로 정규화한다.
 * Type Y 의 안쪽은 Y2 윈도이므로 파인더 상태를 절대 건드리지 않는다.
 */
export function normalizeFinderQrState(state, type, defaultFinderPatternId) {
  const next = { ...state };
  // 하위호환 (W2 C3): 구 'plane'(«면») 값은 «안쪽 + 코너측» 으로 정규화한다 —
  // plane 카드는 (안쪽 여부) × (면 배치) 분해로 삭제됐다 (generator-state.js
  // §qrFacePlacement). 생성기 상태는 저장되지 않으므로 이 매핑은 방어선이다 —
  // 한 릴리스 뒤 제거 후보.
  if (next.qrPosition === 'plane') {
    next.qrPosition = 'inner';
    next.qrFacePlacement = 'far';
  }
  if (next.previousOuterQrPosition === 'plane') {
    next.previousOuterQrPosition = DEFAULT_OUTER_QR_POSITION;
  }
  // 하위호환 (W2 C4): 구 `cornerMarker: boolean` → 타입별 seat 이관 — 스키마에서
  // 내린 필드가 어떤 경로로 들어와도 새 축(innerSeat/outerSeat)으로 옮기고 걷는다
  // (plane 매핑과 같은 방어선 지위. Y 는 대상 밖 — 필드만 걷는다).
  if ('cornerMarker' in next) {
    if (next.cornerMarker === true) {
      if (type === 'O') next.innerSeat = 'o-cm';
      if (type === 'A') next.outerSeat = 'a-cm';
    }
    delete next.cornerMarker;
  }
  if (type === 'Y') return next;

  // **의도적 개방 (2026-08-22 운영자 지시 «타입 OAK 모두»)**: 중앙 v0(비컨)는 이제
  // Type A 에서도 유효하다 — A 의 육각 코어는 O 와 좌표까지 같아 슬롯 규약이 그대로
  // 성립하고, encodeA 가 centralV0 회계·배타를 O 와 같은 규칙으로 든다. 예전의
  // 「A 는 기본 파인더로 되돌린다」 리셋은 여기 있었다 — 되살리면 카드가 사라진다.

  const inner = next.qrPosition === 'inner';
  const centerQr = next.finderPatternId === CENTER_QR_FINDER_PATTERN_ID;
  if (inner && !centerQr) {
    next.previousFinderPatternId = next.finderPatternId;
    next.finderPatternId = CENTER_QR_FINDER_PATTERN_ID;
  } else if (!inner && centerQr) {
    next.finderPatternId = previousFinderOrDefault(next, defaultFinderPatternId);
  }
  return next;
}

/**
 * 파인더/QR 전환을 하나의 커밋 경계로 묶는다.
 * 예약 렌더를 먼저 취소하고, 정규 상태를 반영한 뒤 렌더 콜백을 정확히 한 번 호출한다.
 */
export function commitFinderQrTransition(
  state, nextState, type, defaultFinderPatternId, lifecycle,
) {
  const { cancelPendingRender, render } = lifecycle || {};
  if (typeof cancelPendingRender !== 'function' || typeof render !== 'function') {
    throw new TypeError('cancelPendingRender 와 render 콜백이 필요하다');
  }

  cancelPendingRender();
  const committed = normalizeFinderQrState(nextState, type, defaultFinderPatternId);
  Object.assign(state, committed);
  render(state);
  return state;
}

/** 파인더 카드 선택. 중앙 QR은 안쪽을 고르고, 다른 파인더는 직전 바깥 QR 위치를 복원한다. */
export function selectFinderPattern(state, finderPatternId, type, defaultFinderPatternId) {
  const next = { ...state, finderPatternId };
  if (finderPatternId !== CENTER_QR_FINDER_PATTERN_ID) {
    next.previousFinderPatternId = finderPatternId;
  }
  if (type !== 'Y') {
    if (finderPatternId === CENTER_QR_FINDER_PATTERN_ID) {
      if (state.finderPatternId !== CENTER_QR_FINDER_PATTERN_ID) {
        next.previousFinderPatternId = state.finderPatternId;
      }
      next.qrPosition = 'inner';
    } else if (state.qrPosition === 'inner') {
      next.qrPosition = state.previousOuterQrPosition || DEFAULT_OUTER_QR_POSITION;
    }
  }
  return normalizeFinderQrState(next, type, defaultFinderPatternId);
}

/** QR 위치 선택. O/A 안쪽은 중앙 QR을 고르고, 바깥으로 나가면 직전 파인더를 복원한다. */
export function selectQrPosition(state, qrPosition, type, defaultFinderPatternId) {
  const next = { ...state, qrPosition };
  if (qrPosition !== 'inner') next.previousOuterQrPosition = qrPosition;
  return normalizeFinderQrState(next, type, defaultFinderPatternId);
}
