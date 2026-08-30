import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRankLikelihood,
  RANK_LIKELIHOOD_STATUS,
} from '../src/r2/rank-likelihood.js';
import { Q8_ONE } from '../src/r2/params.js';

const REVERSED_DIGIT = new Uint8Array([5, 3, 4, 1, 2, 0]);

function probabilities(logLikelihoodQ8) {
  const output = new Float64Array(6);
  let total = 0;
  for (let digit = 0; digit < 6; digit += 1) {
    output[digit] = Math.exp(logLikelihoodQ8[digit] / Q8_ONE);
    total += output[digit];
  }
  for (let digit = 0; digit < 6; digit += 1) output[digit] /= total;
  return output;
}

test('rank likelihood는 광범위한 휘도 조합에서 6상태 확률로 정규화된다', () => {
  const kernel = createRankLikelihood();
  const faces = new Uint16Array(3);
  const logLikelihood = new Int16Array(6);

  for (let t = 0; t <= 255; t += 17) {
    for (let l = 0; l <= 255; l += 29) {
      for (let r = 0; r <= 255; r += 43) {
        faces[0] = t;
        faces[1] = l;
        faces[2] = r;
        assert.equal(
          kernel.evaluate(faces, 0, logLikelihood),
          RANK_LIKELIHOOD_STATUS.OK,
        );
        let total = 0;
        for (let digit = 0; digit < 6; digit += 1) {
          total += Math.exp(logLikelihood[digit] / Q8_ONE);
        }
        assert.ok(Math.abs(total - 1) < 0.006, `sum=${total}`);
      }
    }
  }
});

test('동률 휘도는 여섯 순위를 균등하게 둔다', () => {
  const kernel = createRankLikelihood();
  const output = new Int16Array(6);
  kernel.evaluate(new Uint8Array([120, 120, 120]), 0, output);
  for (let digit = 1; digit < 6; digit += 1) {
    assert.equal(output[digit], output[0]);
  }
});

test('휘도 부호 반전은 대응하는 역순 rank 쌍에 같은 우도를 준다', () => {
  const kernel = createRankLikelihood();
  const direct = new Int16Array(6);
  const reversed = new Int16Array(6);

  for (let t = 7; t <= 247; t += 31) {
    for (let l = 11; l <= 239; l += 37) {
      for (let r = 3; r <= 251; r += 41) {
        kernel.evaluate(new Uint8Array([t, l, r]), 0, direct);
        kernel.evaluate(new Uint8Array([255 - t, 255 - l, 255 - r]), 0, reversed);
        for (let digit = 0; digit < 6; digit += 1) {
          assert.ok(
            Math.abs(direct[digit] - reversed[REVERSED_DIGIT[digit]]) <= 1,
          );
        }
      }
    }
  }
});

test('두 인접 마진이 커지면 하나의 순위 상태로 수렴한다', () => {
  const kernel = createRankLikelihood({ rankMarginScaleLuma: 8 });
  const output = new Int16Array(6);
  kernel.evaluate(new Uint8Array([255, 128, 0]), 0, output);
  const posterior = probabilities(output);

  assert.equal(posterior.indexOf(Math.max(...posterior)), 0);
  assert.ok(posterior[0] > 0.999);
});

