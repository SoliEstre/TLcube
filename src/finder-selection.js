// finder-selection.js — Type O/A 중앙 파인더와 QR 위치의 양방향 상태 계약

export const CENTER_QR_FINDER_PATTERN_ID = 'center-qr';
export const DEFAULT_OUTER_QR_POSITION = 'TL';

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
