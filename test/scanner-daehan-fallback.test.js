/**
 * scanner-daehan-fallback.test.js — 폴백 «정책 분기 자체» 를 재는 자.
 *
 * 왜 이 파일이 반드시 있어야 하는가 — 이 폴백은 «디코더 기본 경로가 실패했을 때
 * 그 경로를 우회하는 것» 이 존재 이유다. 그래서 왕복(파이프라인) 테스트는 구조적으로
 * 이 축을 못 지킨다: 왕복이 초록이어도 «정지에서 항상 / 라이브에서 1/N / 토글 시
 * 무동작» 이 깨져 있을 수 있고, 그건 화면에서만 보인다. 분기 규칙을 값으로 잠근다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAEHAN_FALLBACK_INITIAL_STATE,
  DAEHAN_FALLBACK_LIVE_STRIDE,
  DAEHAN_FALLBACK_SKIP,
  daehanFallbackDecision,
} from '../src/scanner-daehan-fallback.js';

const LIVE_FAIL = { source: 'live', firstPassOk: false };
const STILL_FAIL = { source: 'still', firstPassOk: false };

test('상수 — 라이브 스트라이드는 4 이고 초기 카운터는 0', () => {
  assert.equal(DAEHAN_FALLBACK_LIVE_STRIDE, 4);
  assert.equal(DAEHAN_FALLBACK_INITIAL_STATE.consecutiveFailures, 0);
});

// ── 정지 입력 = 항상 ─────────────────────────────────────────────────────────
test('정지 입력은 실패할 때마다 항상 2차 패스를 돈다 (연속 20회)', () => {
  let state = DAEHAN_FALLBACK_INITIAL_STATE;
  for (let i = 0; i < 20; i += 1) {
    const out = daehanFallbackDecision(state, STILL_FAIL);
    assert.equal(out.escalate, true, i + '번째 정지 입력이 스로틀에 걸렸다');
    assert.equal(out.skip, '');
    state = out.state;
  }
});

test('정지 입력이라도 1차 성공이면 2차 패스가 없다', () => {
  const out = daehanFallbackDecision(DAEHAN_FALLBACK_INITIAL_STATE,
    { source: 'still', firstPassOk: true });
  assert.equal(out.escalate, false);
  assert.equal(out.skip, DAEHAN_FALLBACK_SKIP.FIRST_PASS_OK);
});

// ── 라이브 = N 중 1 ─────────────────────────────────────────────────────────
test('라이브 연속 실패 12회에서 2차 패스는 정확히 3회 — 1·5·9번째', () => {
  let state = DAEHAN_FALLBACK_INITIAL_STATE;
  const fired = [];
  for (let i = 1; i <= 12; i += 1) {
    const out = daehanFallbackDecision(state, LIVE_FAIL);
    if (out.escalate) fired.push(i);
    else assert.equal(out.skip, DAEHAN_FALLBACK_SKIP.THROTTLED);
    state = out.state;
  }
  assert.deepEqual(fired, [1, 5, 9]);
  assert.equal(fired.length, 12 / DAEHAN_FALLBACK_LIVE_STRIDE);
  assert.equal(state.consecutiveFailures, 12);
});

test('라이브 stride 는 주입 가능하고 주입값이 실제로 분모다', () => {
  let state = DAEHAN_FALLBACK_INITIAL_STATE;
  const fired = [];
  for (let i = 1; i <= 9; i += 1) {
    const out = daehanFallbackDecision(state, { ...LIVE_FAIL, stride: 3 });
    if (out.escalate) fired.push(i);
    state = out.state;
  }
  assert.deepEqual(fired, [1, 4, 7]);
});

// ── 카운터 리셋 ─────────────────────────────────────────────────────────────
test('성공 프레임이 카운터를 리셋해 다음 실패가 즉시 2차 패스를 받는다', () => {
  let state = DAEHAN_FALLBACK_INITIAL_STATE;
  // 실패 3회 — 1번째만 발동, 2·3번째는 스로틀.
  for (let i = 0; i < 3; i += 1) state = daehanFallbackDecision(state, LIVE_FAIL).state;
  assert.equal(state.consecutiveFailures, 3);
  assert.equal(daehanFallbackDecision(state, LIVE_FAIL).escalate, false,
    '리셋 전 4번째 실패가 발동하면 이 테스트의 전제가 깨진다');

  const reset = daehanFallbackDecision(state, { source: 'live', firstPassOk: true });
  assert.equal(reset.state.consecutiveFailures, 0);
  assert.equal(reset.escalate, false);
  assert.equal(daehanFallbackDecision(reset.state, LIVE_FAIL).escalate, true,
    '리셋 뒤 첫 실패가 2차 패스를 못 받았다 — 「연속」 의 뜻이 깨졌다');
});

test('망가진 state 를 받아도 0 부터 센다 (음수·비정수·undefined)', () => {
  for (const broken of [undefined, {}, { consecutiveFailures: -3 },
    { consecutiveFailures: 1.5 }, { consecutiveFailures: 'x' }]) {
    const out = daehanFallbackDecision(broken, LIVE_FAIL);
    assert.equal(out.escalate, true, JSON.stringify(broken) + ' 에서 첫 실패가 안 돌았다');
    assert.equal(out.state.consecutiveFailures, 1);
  }
});

// ── 토글 강제 시 무동작 ──────────────────────────────────────────────────────
test('/lab/ 토글이 1차부터 daehan 을 강제했으면 2차 패스가 없다 — 라이브·정지 둘 다', () => {
  for (const source of ['live', 'still']) {
    const out = daehanFallbackDecision(DAEHAN_FALLBACK_INITIAL_STATE,
      { source, firstPassOk: false, daehanForced: true });
    assert.equal(out.escalate, false, source + ' 에서 강제 daehan 이 또 돌았다');
    assert.equal(out.skip, DAEHAN_FALLBACK_SKIP.ALREADY_DAEHAN);
  }
});

test('토글 강제는 연속 실패가 쌓여 있어도 절대 발동하지 않는다', () => {
  let state = DAEHAN_FALLBACK_INITIAL_STATE;
  for (let i = 0; i < 10; i += 1) {
    const out = daehanFallbackDecision(state, { ...LIVE_FAIL, daehanForced: true });
    assert.equal(out.escalate, false, i + '번째에서 강제 daehan 이 2차 패스를 돌렸다');
    state = out.state;
  }
});

// ── 사전 포즈 패스 = 무동작 (라인업을 안 보는 유일한 경로) ────────────────────
test('사전 포즈 패스는 2차 패스를 안 돈다 — 라인업 자체를 안 보므로 순수 비용이다', () => {
  const out = daehanFallbackDecision(DAEHAN_FALLBACK_INITIAL_STATE,
    { ...LIVE_FAIL, usedPriorPoses: true });
  assert.equal(out.escalate, false);
  assert.equal(out.skip, DAEHAN_FALLBACK_SKIP.PRIOR_POSES);
});

test('사전 포즈 실패는 카운터를 리셋도 증가도 하지 않는다', () => {
  let state = DAEHAN_FALLBACK_INITIAL_STATE;
  state = daehanFallbackDecision(state, LIVE_FAIL).state;          // 1 — 발동
  state = daehanFallbackDecision(state, LIVE_FAIL).state;          // 2 — 스로틀
  assert.equal(state.consecutiveFailures, 2);

  const prior = daehanFallbackDecision(state, { ...LIVE_FAIL, usedPriorPoses: true });
  assert.equal(prior.state.consecutiveFailures, 2,
    '사전 포즈 실패가 카운터를 건드렸다 — 리셋하면 스로틀이 무의미해지고, ' +
    '증가시키면 2차 패스를 받을 수 없는 프레임이 남의 차례를 먹는다');

  // 리셋되지 않았으므로 그다음 두 번(3·4)은 스로틀, 5번째가 발동이다.
  assert.equal(daehanFallbackDecision(prior.state, LIVE_FAIL).escalate, false);
  let next = daehanFallbackDecision(prior.state, LIVE_FAIL).state;   // 3
  next = daehanFallbackDecision(next, LIVE_FAIL).state;              // 4
  assert.equal(daehanFallbackDecision(next, LIVE_FAIL).escalate, true, '5번째가 안 돌았다');
});

test('사전 포즈 + 1차 성공이면 성공 판정이 앞선다 (카운터 리셋)', () => {
  const out = daehanFallbackDecision({ consecutiveFailures: 7 },
    { source: 'live', firstPassOk: true, usedPriorPoses: true });
  assert.equal(out.skip, DAEHAN_FALLBACK_SKIP.FIRST_PASS_OK);
  assert.equal(out.state.consecutiveFailures, 0);
});

// ── 순수성 — 입력 state 를 변형하지 않는다 ───────────────────────────────────
test('판정은 입력 state 객체를 변형하지 않는다', () => {
  const state = { consecutiveFailures: 5 };
  const snapshot = JSON.stringify(state);
  daehanFallbackDecision(state, LIVE_FAIL);
  daehanFallbackDecision(state, STILL_FAIL);
  assert.equal(JSON.stringify(state), snapshot);
});
