// 격리 관측 자의 세션 소비자예요. 제품 runtime에 등록하거나 기본값을 바꾸지 않아요.
import { createR2Session, R2_SESSION_STATUS } from '../src/r2/session.js';
import { FAMILY_C } from '../src/r2/adapter-c.js';
import { createRsBlockDecodeInto, createRsBlockStats } from '../src/r2/decode-rs-blocks.js';

/** 관측으로 bind된 후보만 받는다. 참값 H/원문/랭크/신뢰도를 주입하지 않는다. */
export function createObservedCSession(candidate, onDecode = null) {
  if (!candidate?.bound || typeof candidate.alignInto !== 'function') throw new TypeError('관측 후보가 필요해요');
  const bound = candidate.bound, stats = createRsBlockStats(bound);
  const rs = createRsBlockDecodeInto(bound, { stats });
  const calls = { detect: 0, align: 0, decode: 0 };
  const session = createR2Session({ layout: bound,
    detectInto(_luma, _width, _height, _timestamp, _pose, output) {
      calls.detect++;
      output.found = candidate.invalidated ? 0 : 1;
      output.family = candidate.invalidated ? 0 : FAMILY_C;
      return R2_SESSION_STATUS.OK;
    },
    alignInto(luma, width, height, timestamp, pose, _detection, output, faceLuma, visibleCells) {
      calls.align++;
      // 표본·가시성·가중치·정합 출력은 그대로. undefined 반환만 세션 status 계약에 맞춘다.
      const status = candidate.alignInto(luma, width, height, timestamp, pose,
        candidate, output, faceLuma, visibleCells);
      return status ?? R2_SESSION_STATUS.OK;
    },
    decodeInto(...args) {
      calls.decode++;
      const status = rs(...args);
      if (onDecode) onDecode({ status, stats, values: args[0], confidence: args[1], erasures: args[2], output: args[5] });
      return status;
    },
  });
  // 소켓만 제공한다. 후보 수명 관리/움직임 추적/DONE 재검증은 이 정지영상 자의 범위 밖이다.
  return { session, stats, calls };
}
