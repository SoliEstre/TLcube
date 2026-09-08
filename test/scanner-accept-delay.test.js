/**
 * scanner-accept-delay.test.js — **수용 뒤 «닫기» 유예**의 계약 (운영자 결정 ⑯ = (i) · 2026-09-06 승격).
 *
 * 재는 것을 먼저 적는다 (자마다 «어떤 성질»인지 · 대부분 **값**이다):
 *   ⓐ 유예 길이 — R2 출처 ∧ 정정 셀 실재일 때만 delayMs, 그 밖(R1·QR·사진, 정정 0, 잘못된 입력)은 0.
 *      길이의 정본은 `R2_HUD_CORRECTION_MS` 하나다 — 강조가 사는 창과 카메라가 사는 창이 같은 수여야
 *      「보이는 시간 = 유예」가 성립한다. 그래서 기본값을 **상수에서** 잰다 (손 숫자 사본 금지).
 *   ⓑ 불변식 (b) — 유예 중 두 번째 수용이 없다: `arm()` 이 false 를 돌려주고 쥔 것을 안 바꾼다.
 *   ⓒ 불변식 (d) — 만료는 가짜 시계로 한 번, 그 뒤 회수가 «나머지 절반» 을 정확히 한 번 내준다.
 *   ⓓ 불변식 (c) — 회수(리셋·카메라 정지)가 오면 타이머가 **지워지고** 나머지 절반은 그대로 확정된다;
 *      늦은 타이머가 두 번째 닫기를 만들지 않는다.
 *   ⓔ 유예를 안 걸었을 때 — `arm()` 이 false 고 `isPending()` 은 거짓: 호출자는 종전처럼 즉시 닫는다.
 *   ⓕ 스캐너 배선 (⚠ 철자 자 — 브라우저 밖) — 세 자리(문의 수용, 프레임 루프의 두 갈래, stopCamera 의 회수)에
 *      실제로 연결돼 있다. 값으로 잴 수 있는 것은 위 다섯이고 **연결**은 소스로만 볼 수 있다.
 *   ⓘ 🔴 **행동 자 (빚 1, 2026-09-07)** — 세 모듈(`acceptStopDelayMs` → `createAcceptStopGate` →
 *      `hudPaintPlan`)을 실제로 이어 붙여 프레임을 밀고, **오버레이가 `hidden=false` 인 프레임 수**를
 *      센다. 승격 전 결함(F1)은 그 수가 0 이었던 것이고, ⓐ\~ⓕ 는 각자 초록이어도 **이은 창**을
 *      아무도 안 쟀다. 대조군(정정 0 = 승격 전 경로)이 0장을 내므로 이 자는 실패를 볼 수 있다.
 *
 * ⚠ 이 파일이 **못** 재는 축 (이름을 붙여 둔다):
 *   · 브라우저가 유예 창의 프레임을 실제로 **합성**하는가. rAF·페인트는 노드 밖이다 — ⓘ 가 재는 것은
 *     「그 프레임의 표시 판정이 열림이었나」까지고, 그 위는 운영자 실기 4차가 답했다.
 *   · 600 ms 가 사람 눈에 **충분한가**. 그것은 실기 판정이고, 결정 ⑯ 이 이미 답이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { acceptStopDelayMs, createAcceptStopGate } from '../src/scanner-accept-delay.js';
import { HUD_PHASE, R2_HUD_CORRECTION_MS } from '../src/r2-hud-model.js';
// ⓘ (빚 1) — 한 프레임의 표시 판정. 시계를 주입받으므로 유예 창을 프레임 단위로 밀어 볼 수 있다.
import { hudPaintPlan } from '../src/r2-hud-paint.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');

/** 가짜 시계 — 타이머 id 는 1부터, `fire()` 가 만료를 돌린다. */
function fakeClock() {
  const timers = new Map();
  let next = 1;
  return {
    cleared: [],
    setTimer(fn) {
      const id = next;
      next += 1;
      timers.set(id, fn);
      return id;
    },
    clearTimer(id) {
      this.cleared.push(id);
      timers.delete(id);
    },
    /** 살아 있는 타이머를 전부 만료시킨다 (이 설계에는 언제나 0개 또는 1개다). */
    fire() {
      const live = [...timers.values()];
      timers.clear();
      for (const fn of live) fn();
      return live.length;
    },
    live() { return timers.size; },
  };
}

/** 실제 배선과 같은 모양의 문지기 — 시계를 주입한다. */
function gateWithClock(clock) {
  return createAcceptStopGate({
    setTimer: (fn, ms) => clock.setTimer(fn, ms),
    clearTimer: (id) => clock.clearTimer(id),
  });
}

test('ⓐ 유예 길이 — R2 ∧ 정정 실재일 때만, 길이는 R2_HUD_CORRECTION_MS 에서 온다', () => {
  // 기본값은 상수에서 온다 — 여기 600 을 적으면 그 숫자가 사본이 되어 상수를 바꾸는 날 조용히 갈린다.
  assert.equal(acceptStopDelayMs({ engineR2: true, correctedCount: 1 }), R2_HUD_CORRECTION_MS);
  assert.equal(acceptStopDelayMs({ engineR2: true, correctedCount: 7 }), R2_HUD_CORRECTION_MS);
  // 정정이 0 이면 보여 줄 것이 없다 — 미루면 그 시간이 그대로 「결과가 늦게 뜬다」가 된다.
  assert.equal(acceptStopDelayMs({ engineR2: true, correctedCount: 0 }), 0);
  assert.equal(acceptStopDelayMs({ engineR2: true, correctedCount: -3 }), 0);
  // R2 가 아니면(R1·QR·사진) 그릴 강조 자체가 없다.
  assert.equal(acceptStopDelayMs({ engineR2: false, correctedCount: 5 }), 0);
  // 모름·비객체·비유한은 전부 0 — 「모르면 안 미룬다」가 안전한 쪽이다.
  for (const bad of [undefined, null, 0, 'x', [], {}]) assert.equal(acceptStopDelayMs(bad), 0, String(bad));
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined, 'x']) {
    assert.equal(acceptStopDelayMs({ engineR2: true, correctedCount: bad }), 0, String(bad));
  }
  // delayMs 를 주면 그것이 이긴다(자가 시간을 주입할 수 있어야 한다). 0 이하·비유한은 «안 미룸».
  assert.equal(acceptStopDelayMs({ engineR2: true, correctedCount: 2, delayMs: 250 }), 250);
  for (const bad of [0, -1, Number.NaN, 'x']) {
    assert.equal(acceptStopDelayMs({ engineR2: true, correctedCount: 2, delayMs: bad }), 0, String(bad));
  }
  // 그리고 상수 자체가 양수여야 이 표면이 존재한다.
  assert.ok(R2_HUD_CORRECTION_MS > 0, '정정 강조 창이 0 이면 ⑯(i) 가 살 수 있는 시간이 없다');
});

test('ⓑ (b) 유예 중 두 번째 수용은 없다 — arm 이 false 고 쥔 것이 안 바뀐다', () => {
  const clock = fakeClock();
  const gate = gateWithClock(clock);
  const seen = [];
  assert.equal(gate.isPending(), false, '아무것도 안 걸었는데 유예 중이다');
  assert.equal(gate.arm(R2_HUD_CORRECTION_MS, () => seen.push('first'), () => seen.push('expire1')), true);
  assert.equal(gate.isPending(), true);
  // 두 번째 적중 — 같은 글자든 다른 글자든 받아들이지 않는다.
  assert.equal(gate.arm(R2_HUD_CORRECTION_MS, () => seen.push('second'), () => seen.push('expire2')), false,
    '유예 중에 두 번째 수용이 걸렸다 — 결과가 두 번 뜨고 어느 것이 남는지 프레임 운이 정한다');
  assert.equal(clock.live(), 1, '두 번째 수용이 타이머를 하나 더 만들었다');
  clock.fire();
  assert.deepEqual(seen, ['expire1'], '만료가 두 번째 수용의 것으로 바뀌었다');
  const rest = gate.take();
  assert.equal(typeof rest, 'function');
  rest();
  assert.deepEqual(seen, ['expire1', 'first'], '쥐고 있던 «나머지 절반» 이 두 번째 것으로 덮였다');
});

test('ⓒ (d) 만료 — 가짜 시계로 한 번, 순서는 stopCamera → 결과 시트', () => {
  const clock = fakeClock();
  const gate = gateWithClock(clock);
  const order = [];
  // 실제 배선과 같은 모양: onExpire 안에서 stopCamera 가 돌고, 그 stopCamera 가 take() 로 시트를 잇는다.
  const stopCamera = () => {
    order.push('stop');
    const rest = gate.take();
    if (rest) rest();
  };
  gate.arm(R2_HUD_CORRECTION_MS, () => order.push('sheet'), stopCamera);
  assert.deepEqual(order, [], '유예를 걸자마자 닫혔다 — 미루는 뜻이 없다');
  assert.equal(clock.fire(), 1, '만료할 타이머가 없다');
  // 순서가 승격 전과 같아야 한다: 정지 → 결과 시트.
  assert.deepEqual(order, ['stop', 'sheet'], '유예 만료의 순서가 stopCamera → 결과 시트가 아니다');
  assert.equal(gate.isPending(), false);
  // 두 번째 회수는 아무것도 안 내준다 — 결과 시트가 두 번 뜨지 않는다.
  assert.equal(gate.take(), null);
  // 그리고 stopCamera 가 또 불려도(다음 세션) 시트를 다시 안 띄운다.
  stopCamera();
  assert.deepEqual(order, ['stop', 'sheet', 'stop']);
});

test('ⓓ (c) 리셋·카메라 정지가 유예를 가로채도 결과는 확정되고, 늦은 타이머가 두 번 안 닫는다', () => {
  const clock = fakeClock();
  const gate = gateWithClock(clock);
  const order = [];
  const stopCamera = () => {
    order.push('stop');
    const rest = gate.take();
    if (rest) rest();
  };
  gate.arm(R2_HUD_CORRECTION_MS, () => order.push('sheet'), stopCamera);
  // 사용자가 리셋을 눌렀다 / 탭이 숨겨졌다 → manualRescan · stopCameraForLifecycle 이 stopCamera 로 온다.
  stopCamera();
  assert.deepEqual(order, ['stop', 'sheet'],
    '유예를 가로챈 정지가 읽은 결과를 버렸다 — 리셋은 유실이 아니다');
  // 타이머는 **지워졌다**. 안 지우면 창이 끝난 뒤 늦은 만료가 새 세션의 카메라를 끈다.
  assert.equal(clock.live(), 0, '회수했는데 타이머가 살아 있다 — 늦은 만료가 다음 세션을 끈다');
  assert.equal(clock.cleared.length, 1, '타이머를 지운 흔적이 없다');
  assert.equal(clock.fire(), 0);
  assert.deepEqual(order, ['stop', 'sheet'], '늦은 타이머가 한 번 더 닫았다');
});

test('ⓔ 유예를 안 걸었을 때 — arm 이 false 고 유예 중이 아니다 (호출자는 종전처럼 즉시 닫는다)', () => {
  const clock = fakeClock();
  const gate = gateWithClock(clock);
  const noop = () => {};
  // 길이 0 = 「미루지 마라」 (acceptStopDelayMs 의 R1·정정 0 출력).
  assert.equal(gate.arm(acceptStopDelayMs({ engineR2: false, correctedCount: 9 }), noop, noop), false);
  assert.equal(gate.arm(acceptStopDelayMs({ engineR2: true, correctedCount: 0 }), noop, noop), false);
  assert.equal(gate.isPending(), false, '안 걸었는데 유예 중이다 — 문이 영원히 닫힌다');
  assert.equal(clock.live(), 0, '안 걸었는데 타이머가 생겼다');
  assert.equal(gate.take(), null);
  // 콜백이 아닌 것을 주면 걸지 않는다 — 「걸렸다」고 믿고 return 하면 결과가 영영 안 뜬다.
  assert.equal(gate.arm(R2_HUD_CORRECTION_MS, null, noop), false);
  assert.equal(gate.arm(R2_HUD_CORRECTION_MS, noop, null), false);
  assert.equal(gate.isPending(), false);
});

test('ⓕ 스캐너 배선 — 문·프레임 루프·stopCamera·리셋에 연결돼 있다 (⚠ 철자 자 — 브라우저 밖)', () => {
  assert.ok(JS.includes("from '/src/scanner-accept-delay.js'"), 'scanner.js 가 유예 모듈을 안 문다');
  assert.ok(JS.includes('const acceptStopGate = createAcceptStopGate()'), '문지기 인스턴스가 없다');

  // ① 문 — 유예 중에는 두 번째 수용이 없다. 가드가 handleDecodeResult 첫머리(세션 가드 바로 뒤)에 있다.
  const doorAt = JS.indexOf('function handleDecodeResult(');
  assert.ok(doorAt > 0, 'handleDecodeResult 가 없다');
  const doorHead = JS.slice(doorAt, JS.indexOf('const payloadRaw', doorAt));
  assert.ok(doorHead.includes('if (acceptStopGate.isPending()) return;'),
    '문이 유예 중에도 열려 있다 — 두 번째 적중이 결과를 덮는다 (불변식 b)');

  // ② 문 — 미루는 조건은 순수 함수에서 오고(리터럴 복사 금지), 걸리면 stopCamera 를 만료로 넘긴다.
  assert.ok(/acceptStopDelayMs\(\{\s*\n?\s*engineR2: result\.source === 'r2',/.test(JS),
    '유예 조건이 순수 함수에서 안 온다 — 규칙이 두 곳에 산다');
  assert.ok(JS.includes('correctedCount: r2Correction === null ? 0 : r2Correction.count'),
    '정정 수가 «그릴 것이 있다» 래치에서 안 온다 — 수만 있고 셀이 없는 적중까지 미룬다');
  assert.ok(JS.includes('if (acceptStopGate.arm(delayMs, showAccepted, stopCamera, ready)) return;'),
    '유예를 걸고 나서 그대로 닫는다 — 미루는 뜻이 없다');
  assert.ok(JS.includes('if (!r2CandidateHud.accept(acceptedCandidateId, nowMs())) return false;'),
    '실제로 표시된 성공 후보 없이 150ms 타이머를 시작해요');
  assert.ok(JS.includes('renderR2CellMap(); acceptStopGate.poll();'),
    '좌석 소멸 뒤 표시 수용 대기를 다시 시도하지 않아요');

  // ③ stopCamera — 회수한 «나머지 절반» 을 정지 **뒤**에 잇는다 (순서 (d)).
  const stopAt = JS.indexOf('function stopCamera()');
  const stop = JS.slice(stopAt, JS.indexOf('function cameraFailure(', stopAt));
  const takeAt = stop.indexOf('const acceptRest = acceptStopGate.take();');
  const callAt = stop.indexOf('if (acceptRest) acceptRest();');
  const bumpAt = stop.indexOf('scanSession += 1;');
  assert.ok(takeAt > 0, 'stopCamera 가 유예를 회수하지 않는다 — 늦은 타이머가 다음 세션을 끈다');
  assert.ok(callAt > takeAt, '결과 시트가 정지 **앞**이다 — 순서가 승격 전과 달라진다');
  assert.ok(bumpAt > takeAt && bumpAt < callAt, '회수·시트가 정지 본문을 감싸지 않는다');

  // ④ 프레임 루프 — 유예 중엔 문에 다시 넣지 않고(흡수 상태), 거부 정리도 안 탄다.
  const loopAt = JS.indexOf('if (r2Runtime.enabled) {');
  const block = JS.slice(loopAt, JS.indexOf('} catch', loopAt));
  assert.ok(block.includes("if (hit && typeof hit.text === 'string' && !acceptStopGate.isPending()) {"),
    '유예 중에도 적중을 문에 다시 넣는다 — 흡수 상태의 같은 답이 매 프레임 문을 두드린다');
  const branchAt = block.indexOf('if (!acceptStopGate.isPending()) {');
  const guardAt = block.indexOf('if (session !== scanSession) {');
  assert.ok(branchAt > 0, '유예를 «거부» 로 읽는다 — 방금 확정한 래치·정정 강조를 스스로 지운다');
  assert.ok(branchAt > guardAt, '유예 갈래가 세션 가드보다 앞이다');
  // 그 갈래는 **return 하지 않는다** — return 하면 rAF 재예약을 건너뛰어 유예 창의 루프가 죽는다.
  assert.ok(!/if \(acceptStopGate\.isPending\(\)\)\s*return;/.test(block),
    '유예 갈래가 return 한다 — 프레임 루프가 죽어 강조가 한 장도 안 그려진다 (불변식 a)');

  // ⑤ 리셋 — 유예 중 「처음부터」가 오면 읽은 결과를 먼저 확정한다.
  const resetAt = JS.indexOf('function manualRescan()');
  const reset = JS.slice(resetAt, JS.indexOf('r2Runtime.reset()', resetAt));
  assert.ok(reset.includes('if (acceptStopGate.isPending()) stopCamera();'),
    '리셋이 유예를 안 끝낸다 — 읽은 결과가 버려지거나 늦은 타이머가 새 화면을 끈다 (불변식 c)');
});

/*
 * ⓖ **유예 창을 끝내는 입구** — 손 목록이 아니라 «행위» 로 잰다.
 *
 * 왜 이렇게 재나: ⓕ 는 «이 다섯 자리에 가드가 있다» 를 재는데, 그건 사본 목록이라 여섯 번째 입구가
 * 생기는 날 조용히 통과한다(실제로 그렇게 났다 — 엔진 스위치 핸들러가 유예를 모른 채 래치를 비웠다).
 * 그래서 자리 대신 **두 행위**를 훑는다:
 *   ① 엔진을 바꾸는 행위(`r2Runtime.setEnabled(`) — 유예 중에 일어나면 만료 콜백이 «방금 바꾼» 카메라를
 *      끈다. 그 앞에서 유예를 끝내야 한다.
 *   ② «가시성 때문에 껐다» 를 기록하는 행위(`stoppedForVisibility = true`) — 유예 중의 정지는 가시성이
 *      아니라 수용 확정이다. 그 플래그가 서면 복귀 때 resumeAction 이 'restart' 를 돌려 **결과 시트가
 *      열린 채 카메라가 다시 켜진다**(승격 전에는 도달 불가였던 상태).
 * 새 입구가 어디에 생기든 그 행위를 쓰면 이 자가 잡는다.
 */
test('ⓖ 유예를 가로챌 수 있는 «행위» 는 전부 유예를 먼저 끝낸다 (⚠ 철자 자 — 자리 목록이 아니라 행위 훑기)', () => {
  const acts = [
    { needle: 'r2Runtime.setEnabled(', what: '엔진 전환', why: '만료 콜백이 방금 바꾼 카메라를 끄고 결과 카드의 R2 확정 요약이 사라진다' },
    { needle: 'stoppedForVisibility = true', what: '가시성 정지 기록', why: '복귀 때 결과 시트가 열린 채 카메라가 자동 재시작한다' },
  ];
  for (const act of acts) {
    let at = JS.indexOf(act.needle);
    assert.ok(at > 0, act.what + ' 자리를 못 찾았다 — 이 자가 공허해진다 (' + act.needle + ')');
    let seen = 0;
    while (at > 0) {
      seen += 1;
      const before = JS.slice(Math.max(0, at - 900), at);
      assert.ok(before.includes('acceptStopGate.isPending()'),
        act.what + ' 자리(' + seen + '번째)가 유예를 안 끝낸다 — ' + act.why);
      at = JS.indexOf(act.needle, at + act.needle.length);
    }
  }
});

/*
 * ⓗ **결과 카드의 R2 확정 요약은 «수용한 순간» 의 값이다.**
 *
 * 유예를 걸면 결과 시트를 띄우는 클로저가 600 ms 뒤에 돈다. 그 사이 래치(`r2Latched`)를 비우는 입구가
 * 실재하므로(엔진 스위치 · 리셋 · 새 세션), 클로저가 래치를 **호출 시점에** 읽으면 그 입구 하나가
 * 카드의 «Type/n/DONE/RS 정정 k» 를 통째로 지운다 — 유예를 만든 이유와 정확히 반대다.
 * 성질: 지연되는 클로저는 R2 가변 상태를 **참조하지 않는다**.
 */
test('ⓗ 지연 클로저는 R2 가변 상태를 참조하지 않는다 — 요약은 수용 시점에 값으로 붙잡힌다 (⚠ 철자 자)', () => {
  const doorAt = JS.indexOf('function handleDecodeResult(');
  const openAt = JS.indexOf('const showAccepted = () => {', doorAt);
  assert.ok(openAt > doorAt, 'showAccepted 클로저를 못 찾았다');
  const body = JS.slice(openAt, JS.indexOf('};', openAt));
  for (const mutable of ['r2Latched', 'r2Correction']) {
    assert.ok(!body.includes(mutable),
      '지연 클로저가 ' + mutable + ' 를 호출 시점에 읽는다 — 유예 중 그것을 비우는 입구가 결과 카드를 지운다');
  }
  assert.ok(JS.includes("const acceptedR2Summary = result.source === 'r2' ? r2Latched : null;"),
    '요약을 수용 시점에 값으로 안 붙잡는다 — R2 출처일 때만, 그리고 지금 붙잡아야 한다');
  assert.ok(JS.indexOf('const acceptedR2Summary =', doorAt) < openAt, '요약 캡처가 클로저 뒤다');
  assert.ok(body.includes('r2Summary: acceptedR2Summary'), '결과 시트가 붙잡아 둔 요약을 안 쓴다');

  /*
   * 상태줄도 같은 축이다 — 유예 창의 문구는 «읽었다» 여야 한다(정정 강조가 그 600 ms 동안 «이 셀들을
   * 고쳤다» 를 그린다). 그래서 setStatus 는 클로저 **밖**, 유예를 걸기 **전**이다.
   */
  assert.ok(!body.includes("setStatus(t('status.decoded'))"),
    '상태줄이 지연 클로저 안이다 — 유예 창 600 ms 동안 문구가 «모으는 중» 으로 남는다');
  const statusAt = JS.indexOf("setStatus(t('status.decoded'));", doorAt);
  const armAt = JS.indexOf('acceptStopGate.arm(', doorAt);
  assert.ok(statusAt > doorAt && statusAt < armAt, '«읽었다» 문구가 유예를 건 뒤에 온다');
});


/*
 * ── ⓘ 빚 1 — 🔴 **«캔버스가 hidden=false 로 ≥1 프레임 산다»** (행동 자) ────────────────────
 *
 * 승격 전 결함(3b 검토 F1): 수용이 같은 태스크에서 `stopCamera()` → `renderR2CellMap()` →
 * `hideR2Hud()` 로 이어져 정정 강조가 **한 프레임도 합성되지 않았다**. 결정 ⑯(i) 가 닫기를
 * 미뤄 그 표면을 열었는데, 「실제로 열려 있었나」를 재는 자가 없었다 — 유예 길이(ⓐ\~ⓔ)와
 * 표시 규칙(r2-hud-model)이 각자 초록이어도 **둘을 이은 창**은 아무도 안 쟀다.
 *
 * 여기서는 실제 세 모듈을 그대로 이어 붙여 **프레임을 민다**:
 *   `acceptStopDelayMs` → `createAcceptStopGate`(가짜 시계) → 프레임마다 `hudPaintPlan`.
 * 재는 값: 「오버레이가 `hidden=false` 인 프레임 수」.
 *
 * ⚠ 못 재는 축 — 브라우저가 그 프레임을 실제로 **합성**했는가. 여기서 재는 것은 「그 프레임에
 * 표시 판정이 열림이었나」까지다. 그 위(rAF·페인트)는 실기 판정이고 운영자 4차가 이미 답했다.
 *
 * ⚠ 제품 명제(«캔버스가 산다»)의 사슬은 넷이고 이 자는 **②** 만 닫는다 (3b 검토 F1 / rulers §4):
 *   ① 유예 창 동안 프레임 루프가 산다 — `r2-scan-runtime.test` ⓕ (철자).
 *   ② 그 프레임의 계획이 «열림» 을 낸다 — **여기**.
 *   ③ 렌더러가 그 값을 캔버스의 `hidden` 에 쓴다 — `r2-hud-paint.test` ⓓ (값 · 2026-09-07 신설).
 *      ⚠ 이 자를 처음 세울 때 ③ 은 **무자였다**: 그것을 덮던 ⓞ 의 두 줄이 같은 커밋에서 대체 없이
 *      사라져, 오버레이를 `hidden = true` 로 못박아도 표적 134/134 가 초록이었다.
 *   ④ 브라우저가 합성한다 — 자 없음 (실기).
 * 그리고 이 하네스는 `corrGridOk`·`overlayGeom`·`isoGeom`·`phase`·`n` 을 **상수로 못박으므로**
 * 「정정 강조가 실제로 켜지는 조건」은 여기로 안 지난다 — 그 축은 `r2-hud-model.test` 빚3
 * `hudCorrectionGridOk` 가 값으로 잰다.
 */

/** 만기 시각을 아는 가짜 시계 — 프레임 루프가 시간을 밀 때 그때 도래한 타이머만 돈다. */
function fakeFrameClock() {
  const timers = new Map();
  let seq = 1;
  let now = 0;
  return {
    now() { return now; },
    setTimer(fn, ms) {
      const id = seq;
      seq += 1;
      timers.set(id, { due: now + Number(ms), fn });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    /** 시각을 t 로 밀고, 그때까지 도래한 타이머를 만기 순서대로 돌린다. */
    advanceTo(t) {
      now = t;
      const due = [...timers.entries()].filter(([, timer]) => timer.due <= now);
      due.sort((a, b) => a[1].due - b[1].due);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.fn();
      }
    },
    live() { return timers.size; },
  };
}

/**
 * 수용 한 번을 그대로 재현한다 — 스캐너의 문(handleDecodeResult 꼬리)과 **같은 순서**:
 * 유예 길이 판정 → arm(성공하면 return, 실패하면 즉시 stopCamera → 결과 시트) → 프레임 루프.
 */
function runAcceptWindow({ correctedCount, frames = 60, stepMs = 16 }) {
  const clock = fakeFrameClock();
  const gate = createAcceptStopGate({
    setTimer: (fn, ms) => clock.setTimer(fn, ms),
    clearTimer: (id) => clock.clearTimer(id),
  });
  const state = { cameraOn: true, sheets: 0, stops: 0, order: [] };
  const showAccepted = () => { state.sheets += 1; state.order.push('sheet'); };
  const stopCamera = () => {
    state.stops += 1;
    state.order.push('stop');
    state.cameraOn = false;
    const rest = gate.take();
    if (rest) rest();
  };

  // 정정 강조 래치 — 스캐너는 문 **앞**에서 세운다 (수용된 그 프레임의 시각).
  const correction = correctedCount > 0 ? { at: clock.now(), count: correctedCount } : null;
  const delayMs = acceptStopDelayMs({ engineR2: true, correctedCount });
  if (!gate.arm(delayMs, showAccepted, stopCamera)) {
    stopCamera();
    showAccepted();
  }

  const visibleAt = [];
  for (let f = 0; f < frames; f += 1) {
    // 프레임 루프는 유예 창 동안 계속 돈다 (갈래 ② 는 return 하지 않는다).
    clock.advanceTo(f * stepMs);
    const plan = hudPaintPlan({
      nowMs: clock.now(),
      correction,
      hasStream: state.cameraOn,
      runtimeEnabled: true,
      hasView: true,
      // DONE 위상 — 수용된 뒤라 래치가 서 있다. 원래 오버레이가 닫히는 위상이다.
      phase: HUD_PHASE.DONE,
      n: 13,
      overlayGeom: true,
      isoGeom: true,
      corrGridOk: true,
      lockAlpha: 1,
    });
    if (!plan.surfaces.overlayHidden) visibleAt.push(clock.now());
  }
  return {
    delayMs,
    visibleFrames: visibleAt.length,
    firstVisibleMs: visibleAt.length > 0 ? visibleAt[0] : -1,
    lastVisibleMs: visibleAt.length > 0 ? visibleAt[visibleAt.length - 1] : -1,
    ...state,
  };
}

test('ⓘ 빚1 — 정정이 있는 수용은 오버레이가 hidden=false 인 프레임을 **적어도 하나** 남긴다', () => {
  const run = runAcceptWindow({ correctedCount: 2 });
  assert.equal(run.delayMs, R2_HUD_CORRECTION_MS, '유예가 안 걸렸다 — 시나리오가 아니다');
  // 🔴 이 한 줄이 빚 1 이다.
  assert.ok(run.visibleFrames >= 1,
    '유예 창에 오버레이가 열린 프레임이 0장이다 — ⑯(i) 가 산 600 ms 가 빈 화면이다');
  // 첫 프레임부터 열려 있다 — 「수용 직후」가 이 표면의 존재 이유다.
  assert.equal(run.firstVisibleMs, 0, '수용 직후 첫 프레임이 닫혀 있다');
  // 그리고 강조는 유예보다 **오래 안 산다** — 두 창이 같은 상수를 쓴다 (사본 금지의 값 확인).
  assert.ok(run.lastVisibleMs < R2_HUD_CORRECTION_MS,
    '강조가 유예 창(' + R2_HUD_CORRECTION_MS + 'ms) 밖에서도 열려 있다: ' + run.lastVisibleMs + 'ms');
  // 창이 «한 프레임 운» 이 아니다 — 16 ms 캐던스면 수십 장이다 (공허 방지).
  assert.ok(run.visibleFrames >= 10,
    '열린 프레임이 ' + run.visibleFrames + '장뿐이다 — 창이 표본 운으로 좁아졌다');
  // 닫기는 정확히 한 번, 순서는 승격 전과 같다: 정지 → 결과 시트.
  assert.equal(run.stops, 1, 'stopCamera 가 ' + run.stops + '번 돌았다');
  assert.equal(run.sheets, 1, '결과 시트가 ' + run.sheets + '번 떴다');
  assert.deepEqual(run.order, ['stop', 'sheet'], '정지와 결과 시트의 순서가 뒤집혔다');
  assert.equal(run.cameraOn, false, '유예가 끝났는데 카메라가 살아 있다');
});

test('ⓘ-b 대조군 — 정정 0(=승격 전 경로)은 열린 프레임이 **0장**이다 (자가 실패를 본다)', () => {
  const run = runAcceptWindow({ correctedCount: 0 });
  assert.equal(run.delayMs, 0, '정정 0 인데 유예가 걸렸다 — 결과가 늦게 뜬다');
  /*
   * 🔴 이 0 이 «자가 실패를 볼 수 있다» 는 증거다. 같은 하네스로 잰 두 팔이 **38 대 0** 이면
   * 위 자의 초록은 유예가 실제로 만든 것이지 하네스가 늘 참을 내는 것이 아니다.
   * (600 ms 유예 ÷ 16 ms 캐던스 → 0…592 ms 의 38장. 옛 주석의 «37» 은 실측과 어긋났다 —
   *  3b 검토 rulers F8. 단언은 `>= 10` 이라 이 수 자체가 자를 깨지는 않는다.)
   */
  assert.equal(run.visibleFrames, 0,
    '그릴 것이 없는데 오버레이가 열렸다 — 결과 시트 아래에 빈 그림이 남는다');
  assert.equal(run.stops, 1);
  assert.equal(run.sheets, 1);
  assert.deepEqual(run.order, ['stop', 'sheet'], '즉시 닫는 갈래의 순서도 정지 → 결과 시트다');
});

test('ⓘ-c 유예를 가로채면(리셋·가시성) 그 프레임부터 닫힌다 — 늦은 타이머는 안 돈다', () => {
  const clock = fakeFrameClock();
  const gate = createAcceptStopGate({
    setTimer: (fn, ms) => clock.setTimer(fn, ms),
    clearTimer: (id) => clock.clearTimer(id),
  });
  let cameraOn = true;
  let sheets = 0;
  const stopCamera = () => {
    cameraOn = false;
    const rest = gate.take();
    if (rest) rest();
  };
  const correction = { at: 0, count: 3 };
  assert.equal(gate.arm(R2_HUD_CORRECTION_MS, () => { sheets += 1; }, stopCamera), true);

  const frameOpen = (at) => {
    clock.advanceTo(at);
    return !hudPaintPlan({
      nowMs: clock.now(),
      correction,
      hasStream: cameraOn,
      runtimeEnabled: true,
      hasView: true,
      phase: HUD_PHASE.DONE,
      n: 13,
      overlayGeom: true,
      isoGeom: true,
      corrGridOk: true,
      lockAlpha: 1,
    }).surfaces.overlayHidden;
  };

  assert.equal(frameOpen(0), true, '유예 첫 프레임이 닫혀 있다');
  assert.equal(frameOpen(100), true, '유예 중 프레임이 닫혔다');
  // 리셋·가시성 전환이 유예를 가로챈다 — 읽은 결과는 그대로 확정된다.
  stopCamera();
  assert.equal(sheets, 1, '가로챈 정지가 읽은 결과를 버렸다');
  assert.equal(frameOpen(116), false, '카메라가 꺼졌는데 오버레이가 열려 있다');
  // 늦은 타이머는 죽었다 — 두 번째 닫기가 없다.
  clock.advanceTo(R2_HUD_CORRECTION_MS + 100);
  assert.equal(clock.live(), 0, '늦은 타이머가 살아 있다');
  assert.equal(sheets, 1, '결과 시트가 두 번 떴다');
});
