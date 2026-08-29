// generate-debounce.test.js — 생성 비콘을 «입력이 멎은 설정» 단위로 접는 성질을 잰다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  GENERATE_SETTLE_MS,
  createGenerateDebounceState,
  reduceGenerateDebounce,
} from '../src/generate-debounce.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function scenario(actions) {
  let state = createGenerateDebounceState();
  const emitted = [];
  for (const action of actions) {
    const result = reduceGenerateDebounce(state, action);
    state = result.state;
    emitted.push(...result.emitted);
  }
  return { state, emitted };
}

test('같은 입력 버스트의 N번 변경은 마지막 설정 이벤트 1건만 낸다', () => {
  const actions = [];
  for (let i = 0; i < 8; i += 1) {
    actions.push({
      type: 'change',
      at: i * 120,
      signature: `payload-${i}`,
      props: { bytes: 20 + i },
      enabled: true,
    });
  }
  actions.push({ type: 'time', at: 7 * 120 + GENERATE_SETTLE_MS - 1 });
  actions.push({ type: 'time', at: 7 * 120 + GENERATE_SETTLE_MS });

  const result = scenario(actions);
  assert.deepEqual(result.emitted, [{ bytes: 27 }]);
  assert.equal(result.state.pending, null);
});

test('정착 간격을 넘겨 떨어진 두 변경은 이벤트 2건을 낸다', () => {
  const result = scenario([
    { type: 'change', at: 0, signature: 'first', props: { bytes: 10 }, enabled: true },
    { type: 'time', at: GENERATE_SETTLE_MS },
    {
      type: 'change',
      at: GENERATE_SETTLE_MS + 1,
      signature: 'second',
      props: { bytes: 11 },
      enabled: true,
    },
    { type: 'time', at: 2 * GENERATE_SETTLE_MS + 1 },
  ]);

  assert.deepEqual(result.emitted, [{ bytes: 10 }, { bytes: 11 }]);
});

test('대기 중 종료 신호는 마지막 상태를 즉시 한 번 내고 유실하지 않는다', () => {
  const result = scenario([
    { type: 'change', at: 0, signature: 'leaving', props: { bytes: 31 }, enabled: true },
    { type: 'flush', at: 200 },
    { type: 'flush', at: 201 },
  ]);

  assert.deepEqual(result.emitted, [{ bytes: 31 }]);
  assert.equal(result.state.pending, null);
});

test('같은 고유 설정의 중복 렌더는 대기 시간을 늘리거나 다시 발신하지 않는다', () => {
  const state0 = createGenerateDebounceState();
  const first = reduceGenerateDebounce(state0, {
    type: 'change', at: 0, signature: 'same', props: { bytes: 8 }, enabled: true,
  });
  const duplicate = reduceGenerateDebounce(first.state, {
    type: 'change', at: 900, signature: 'same', props: { bytes: 8 }, enabled: true,
  });

  assert.equal(duplicate.state.pending.dueAt, GENERATE_SETTLE_MS);
  const settled = reduceGenerateDebounce(duplicate.state, {
    type: 'time', at: GENERATE_SETTLE_MS,
  });
  assert.deepEqual(settled.emitted, [{ bytes: 8 }]);
});

test('초기 자동 렌더는 관측 서명만 갱신하고 generate를 예약하지 않는다', () => {
  const result = scenario([
    { type: 'change', at: 0, signature: 'example', props: { bytes: 7 }, enabled: false },
    { type: 'time', at: GENERATE_SETTLE_MS },
  ]);

  assert.deepEqual(result.emitted, []);
  assert.equal(result.state.lastSignature, 'example');
  assert.equal(result.state.pending, null);
});

test('브라우저 수명주기는 미실행 렌더를 먼저 끝내고 hidden·pagehide에서 flush한다', () => {
  // 순수 flush 성질이 실제 페이지 훅에 닿지 않는 배선 누락을 막는 얇은 계약이다.
  const index = readFileSync(ROOT + 'index.html', 'utf8');
  assert.match(index, /function flushPendingProductGenerate\(\)[\s\S]*?flushScheduledRender\(\)[\s\S]*?type: 'flush'/);
  assert.match(index, /visibilitychange[\s\S]*?visibilityState === 'hidden'[\s\S]*?flushPendingProductGenerate\(\)/);
  assert.match(index, /addEventListener\('pagehide', flushPendingProductGenerate\)/);
});
