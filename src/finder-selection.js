// finder-selection.js — Type O/A 중앙 파인더와 QR 위치의 양방향 상태 계약

export const CENTER_QR_FINDER_PATTERN_ID = 'center-qr';
export const DEFAULT_OUTER_QR_POSITION = 'TL';

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
    }),
    Y: Object.freeze({
      qrPosition: DEFAULT_OUTER_QR_POSITION,
      finderPatternId: defaultFinderPatternId,
      previousFinderPatternId: defaultFinderPatternId,
      previousOuterQrPosition: DEFAULT_OUTER_QR_POSITION,
    }),
  });
}

function finderQrSnapshot(state) {
  return Object.freeze({
    qrPosition: state.qrPosition,
    finderPatternId: state.finderPatternId,
    previousFinderPatternId: state.previousFinderPatternId,
    previousOuterQrPosition: state.previousOuterQrPosition,
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
    ? previous
    : defaultFinderPatternId;
}

/**
 * O/A 에서만 중앙 QR ↔ 안쪽을 하나의 상태로 정규화한다.
 * Type Y 의 안쪽은 Y2 윈도이므로 파인더 상태를 절대 건드리지 않는다.
 */
export function normalizeFinderQrState(state, type, defaultFinderPatternId) {
  const next = { ...state };
  if (type === 'Y') return next;

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
