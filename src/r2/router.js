const NO_FRAME = Symbol('no-frame');

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name}는 유한 양의 정수여야 해요`);
  }
  return value;
}

/**
 * Y 신뢰도와 진행 정체만으로 C 실행 시점을 정하는 순수 스케줄러다.
 * 실제 C 호출 계상은 next와 분리된 commit에서만 수행한다.
 */
export function createR2Router(options = {}) {
  const maxTrustedFrames = positiveInteger(options.maxTrustedFrames, 'maxTrustedFrames');
  const maxStalledFrames = positiveInteger(options.maxStalledFrames, 'maxStalledFrames');

  let lastFrameId = NO_FRAME;
  let lastCommittedFrameId = NO_FRAME;
  let pendingFrameId = NO_FRAME;
  let framesSinceCTry = 0;
  let framesSinceProgress = 0;
  let bestProgressD = null;
  let cTries = 0;

  const result = (runC, reason) => Object.freeze({
    runC,
    reason,
    framesSinceCTry,
    framesSinceProgress,
    cTries,
  });

  function next(input = {}) {
    const { yTrusted, progressD, allowC, frameId } = input;
    if (typeof yTrusted !== 'boolean' || typeof allowC !== 'boolean') {
      throw new TypeError('yTrusted와 allowC는 boolean이어야 해요');
    }
    if (frameId == null || (typeof frameId === 'number' && !Number.isFinite(frameId))) {
      throw new TypeError('유효한 frameId가 필요해요');
    }

    const duplicateFrame = lastFrameId !== NO_FRAME && Object.is(frameId, lastFrameId);
    if (!duplicateFrame) {
      lastFrameId = frameId;
      pendingFrameId = NO_FRAME;
      framesSinceCTry += 1;

      if (Number.isFinite(progressD)) {
        if (bestProgressD === null || progressD > bestProgressD) {
          bestProgressD = progressD;
          framesSinceProgress = 0;
        } else {
          framesSinceProgress += 1;
        }
      } else if (bestProgressD !== null || framesSinceProgress > 0) {
        framesSinceProgress += 1;
      }
    }

    if (lastCommittedFrameId !== NO_FRAME && Object.is(frameId, lastCommittedFrameId)) {
      pendingFrameId = NO_FRAME;
      return result(false, 'already-ran-this-frame');
    }

    let reason = 'not-due';
    if (!yTrusted) reason = 'y-untrusted';
    else if (framesSinceProgress >= maxStalledFrames) reason = 'y-stalled';
    else if (framesSinceCTry >= maxTrustedFrames) reason = 'trusted-cadence';

    const due = reason !== 'not-due';
    const runC = due && allowC;
    pendingFrameId = runC ? frameId : NO_FRAME;
    return result(runC, due && !allowC ? `${reason}-blocked` : reason);
  }

  function commit({ frameId, ranC } = {}) {
    if (ranC !== true) {
      if (pendingFrameId !== NO_FRAME && Object.is(frameId, pendingFrameId)) pendingFrameId = NO_FRAME;
      return Object.freeze({ framesSinceCTry, cTries });
    }
    if (pendingFrameId === NO_FRAME || !Object.is(frameId, pendingFrameId)) {
      throw new Error('next가 이 frameId에 예약한 실제 C 실행만 commit할 수 있어요');
    }
    cTries += 1;
    framesSinceCTry = 0;
    lastCommittedFrameId = frameId;
    pendingFrameId = NO_FRAME;
    return Object.freeze({ framesSinceCTry, cTries });
  }

  function reset() {
    lastFrameId = NO_FRAME;
    lastCommittedFrameId = NO_FRAME;
    pendingFrameId = NO_FRAME;
    framesSinceCTry = 0;
    framesSinceProgress = 0;
    bestProgressD = null;
    cTries = 0;
  }

  return Object.freeze({ next, commit, reset });
}
