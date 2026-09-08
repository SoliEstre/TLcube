/** 이미 관측/CRC/bind를 거친 후보를 기존 rank·누적·RS 세션에 연결해요. */
import { createR2Session, R2_SESSION_STATUS } from './session.js';
import { createRsBlockDecodeInto, createRsBlockStats } from './decode-rs-blocks.js';
import { createR2CandidateKey, sameR2CandidateKey } from './candidate-key.js';

export function createBoundCandidateSession(candidate, { family } = {}) {
  const key = createR2CandidateKey(candidate?.key);
  if (!key || !sameR2CandidateKey(key, candidate?.bound?.key)
    || typeof candidate?.alignInto !== 'function'
    || !Number.isSafeInteger(family) || family < 1) {
    throw new TypeError('관측으로 bind된 후보와 family가 필요해요');
  }
  const bound = candidate.bound;
  const blockStats = createRsBlockStats(bound);
  const decode = createRsBlockDecodeInto(bound, { stats: blockStats });
  const calls = { eligibility: 0, align: 0, decode: 0 };
  let disposed = false;
  const session = createR2Session({
    layout: bound,
    // 새 검출을 실행하지 않아요. 수명 관리자가 넘긴 기성 후보의 적격성만 확인해요.
    // 현재 영상의 기하/포맷 증명은 바로 뒤의 candidate.alignInto가 수행해요.
    detectInto(_luma, _width, _height, _timestamp, _pose, output) {
      calls.eligibility++;
      const live = !disposed && !candidate.invalidated && sameR2CandidateKey(key, candidate.key);
      output.found = live ? 1 : 0;
      output.family = live ? family : 0;
      return R2_SESSION_STATUS.OK;
    },
    alignInto(luma, width, height, timestamp, pose, _detection, output, faceLuma, visibleCells) {
      calls.align++;
      return candidate.alignInto(luma, width, height, timestamp, pose,
        candidate, output, faceLuma, visibleCells) ?? R2_SESSION_STATUS.OK;
    },
    decodeInto(...args) { calls.decode++; return decode(...args); },
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    session.reset();
    candidate.dispose?.();
  }
  function pushFrame(field, timestamp, pose = null) {
    if (disposed) return null;
    if (candidate.invalidated || !sameR2CandidateKey(key, candidate.key)) {
      dispose(); return null;
    }
    return session.pushFrame(field.data, field.width, field.height, timestamp, pose);
  }
  return Object.freeze({ key, bound, session, blockStats, calls, pushFrame, dispose,
    get disposed() { return disposed; } });
}
