/**
 * 카메라 스트림과 비디오 요소의 관측값만으로 현재 생존 상태를 판정한다.
 * DOM 객체를 직접 받지 않아 브라우저 없이 전수 테스트할 수 있다.
 */
export function cameraLiveness(view = {}) {
  if (!view.hasStream) return 'absent';

  const trackStates = Array.isArray(view.videoTrackStates)
    ? view.videoTrackStates
    : [];
  const hasLiveVideoTrack = trackStates.some((state) => state === 'live');

  if (!hasLiveVideoTrack || view.srcObjectMatches === false || view.videoEnded === true) {
    return 'dead';
  }

  return 'live';
}

/**
 * 포그라운드 복귀 때 취할 행동을 정한다.
 * 자동 재시작은 같은 전환에서 한 번만 허용하고, 그 뒤에는 사용자 게이트로 강등한다.
 */
export function resumeAction(state = {}) {
  if (state.liveness === 'live') return 'none';
  if (!state.secure || !state.hasApi) return 'gate';
  if (Number(state.attemptsThisTransition) >= 1) return 'gate';

  if (state.hadCameraThisSession || state.stoppedForVisibility || state.liveness === 'dead') {
    return 'restart';
  }

  return 'none';
}

/**
 * 게이트 단계와 호출자가 요청한 시작 가능 여부를 실제 버튼 표현으로 바꾼다.
 * preparing은 호출자가 시작 가능하다고 넘겨도 버튼과 포커스 대상을 만들지 않는다.
 */
export function gatePresentation(phase, requestedCanStart = true) {
  const showStart = phase !== 'preparing';
  return {
    showStart,
    canStart: showStart && requestedCanStart !== false,
  };
}
