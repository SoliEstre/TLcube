/**
 * scanner-frame-rate.test.js — R1 단발 캐던스의 «유휴 창» 계약 (PM/029B §27.6 · 운영자 요구 ⑤).
 *
 *   ⓐ 성질 — idleAfterDecodeMs 는 하한 100 · 비율 R1_IDLE_FRACTION · 비유한/0 이하는 하한.
 *   ⓑ 단조·멱등 아님 — 비용이 커지면 유휴도 줄지 않는다(단조 비감소). 값의 «자» 는 비율이지 표가 아니다.
 *   ⓒ 합성 항등 — idleAfterDecodeMs(adaptiveFrameIntervalMs(x)) === idleAfterDecodeMs(x) (모든 x).
 *      scanner.js 가 두 함수를 겹쳐 부르는 이유가 이것이다: 옛 철자(adaptiveFrameIntervalMs(lastFrameCostMs))
 *      를 앵커로 찍는 두 자(qr-bridge ⓕ' · scanner-fpscap)를 살린 채 뜻만 바꾼다. 이 자가 빨개지면
 *      **겹쳐 부르는 것이 더는 항등이 아니다** — 그때 scanner.js 는 바깥 한 겹을 벗겨야 한다.
 *   ⓓ 배선(⚠ 철자 자) — 캐던스·기준점이 `r2Available` 로 갈린다(스위치 실재 = 유휴 창),
 *      갱신은 `.finally` 한 곳, 옛 철자 `lastDecodeAt = timestamp` 는 0건.
 *      ⚠ **승격(2026-09-06)으로 이 자의 «정식» 문장이 바뀌었다**: 갈래는 그대로지만 정식도 스위치를
 *      가지므로(ENGINE_SWITCH_PRODUCT_ENABLED) 정식이 서는 쪽은 **유휴 창**이다 — 결정 ⑮ 는 새 코드
 *      없이 승격으로 시험판 동작 그대로 넘어간다. 어느 쪽에 서는지는 아래에서 **값으로** 잰다.
 *   ⓔ 거래가 주석에 적혀 있고 그 수치가 R1_IDLE_FRACTION 에서 **유도**된다 — 처리율을 판다는 사실이
 *      소스에 없으면 다음 사람이 «회귀» 로 되돌리고, 손으로 적은 수치는 비율을 바꾸면 조용히 썩는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  FRAME_MIN_INTERVAL_MS,
  R1_IDLE_FRACTION,
  adaptiveFrameIntervalMs,
  idleAfterDecodeMs,
} from '../src/scanner-frame-rate.js';
// 승격(2026-09-06) 뒤 «정식이 어느 갈래에 서는가» 는 진리표에서 나온다 — 손으로 적으면 그 사본이 썩는다.
import { ENGINE_SWITCH_PRODUCT_ENABLED, engineSwitchAvailable } from '../src/scanner-scan-assist.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');

test('ⓐ 유휴 창의 성질 — 하한 · 비율 · 모름은 하한', () => {
  assert.equal(FRAME_MIN_INTERVAL_MS, 100);
  assert.ok(R1_IDLE_FRACTION > 0 && R1_IDLE_FRACTION < 1, '유휴 비율이 (0,1) 밖이면 거래가 성립하지 않는다');

  // 하한 — 빠른 기기에서 유휴가 0 으로 붕괴하면 옛 duty 99 % 로 되돌아간다.
  for (const cost of [0, 1, 53, 92, 199]) {
    assert.equal(idleAfterDecodeMs(cost), FRAME_MIN_INTERVAL_MS, cost + 'ms 비용에서 하한이 안 걸린다');
  }
  // 비율 — 값 표가 아니라 «비용 × 비율» 이라는 성질로 잰다 (상수를 바꾸면 자도 같이 움직인다).
  for (const cost of [400, 1400, 2170, 2800, 9999]) {
    assert.equal(idleAfterDecodeMs(cost), Math.max(FRAME_MIN_INTERVAL_MS, Math.round(cost * R1_IDLE_FRACTION)));
  }
  // 실측 대역(1.4\~2.8 s)에서 유휴는 실제로 하한보다 훨씬 크다 — 그게 페인트 창이다.
  assert.ok(idleAfterDecodeMs(1400) > FRAME_MIN_INTERVAL_MS * 5);
  // 모름 · 비유한 · 음수는 하한.
  for (const bad of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, -9999, 'x', {}]) {
    assert.equal(idleAfterDecodeMs(bad), FRAME_MIN_INTERVAL_MS, String(bad) + ' 가 하한으로 안 떨어진다');
  }
});

test('ⓑ 단조 비감소 — 느린 프레임이 더 짧은 유휴를 받지 않는다', () => {
  let previous = -1;
  for (let cost = 0; cost <= 4000; cost += 37) {
    const idle = idleAfterDecodeMs(cost);
    assert.ok(idle >= previous, cost + 'ms 에서 유휴가 줄었다');
    previous = idle;
  }
});

test('ⓒ 합성 항등 — idleAfterDecodeMs(adaptiveFrameIntervalMs(x)) === idleAfterDecodeMs(x)', () => {
  const grid = [0, 1, 50, 99, 100, 101, 147, 199, 200, 201, 999, 1400, 2170, 2800, 100000];
  for (const x of grid) {
    assert.equal(idleAfterDecodeMs(adaptiveFrameIntervalMs(x)), idleAfterDecodeMs(x),
      x + 'ms 에서 겹쳐 부르기가 항등이 아니다 — scanner.js 의 바깥 한 겹이 값을 바꾸고 있다');
  }
  for (const bad of [undefined, Number.NaN, -5]) {
    assert.equal(idleAfterDecodeMs(adaptiveFrameIntervalMs(bad)), idleAfterDecodeMs(bad));
  }
  // 그리고 scanner.js 는 실제로 겹쳐 부른다 (이 자가 지키는 대상).
  assert.ok(JS.includes('idleAfterDecodeMs(adaptiveFrameIntervalMs(lastFrameCostMs))'),
    'scanner.js 가 유휴 창을 안 쓰거나 옛 철자 앵커를 잃었다');
});

test('ⓓ 배선 — 캐던스는 `r2Available` 로 갈리고, 기준점 갱신은 `.finally` 한 곳뿐 (⚠ 철자 자)', () => {
  const loopAt = JS.indexOf('function startFrameLoop(');
  const loop = JS.slice(loopAt, JS.indexOf('async function startCamera(', loopAt));
  assert.ok(loop.length > 0, '프레임 루프를 못 찾았다');

  /*
   * 두 갈래 — 유휴 창은 «스위치가 실재하는가»(r2Available)에 매인다. 그 매임이 이 자가 지키는 것이다:
   * 스위치가 없는 화면에서는 반응성을 살 이유가 없으므로 −33 % 를 치르지 않는다.
   * 승격(2026-09-06) 뒤 정식은 스위치를 갖는다 → 정식도 유휴 창 쪽이다 (결정 ⑮ 가 그대로 넘어간다).
   * 갈래 자체는 지운 게 아니라 **입력이 옮겨 간 것**이다 — 되돌리면 정식이 다시 옛 간격으로 간다.
   */
  assert.ok(/const intervalMs = r2Available\s*\n?\s*\? idleAfterDecodeMs\(adaptiveFrameIntervalMs\(lastFrameCostMs\)\)\s*\n?\s*: adaptiveFrameIntervalMs\(lastFrameCostMs\);/.test(loop),
    '캐던스가 r2Available 로 갈리지 않는다 — 스위치가 hidden 인 정식이 유휴 창의 −33 % 를 대신 치른다');
  assert.ok(/lastDecodeAt = r2Available \? frameStartedAt \+ lastFrameCostMs : frameStartedAt;/.test(loop),
    '기준점이 캐던스와 짝이 아니다 — 한쪽만 완료 기준이면 간격의 뜻이 갈린다');

  /*
   * **값** — 정식이 실제로 어느 갈래에 서는가 (승격 2026-09-06 · 결정 ⑮). 위 두 단언은 갈래의 **철자**만
   * 재므로, 갈래가 살아 있는 채로 정식이 엉뚱한 쪽에 서 있어도 초록이다. 그래서 진리표를 정식 입력으로
   * 실제로 통과시켜 「정식이 유휴 창을 산다」를 잰다 — 승격을 되돌리면 이 줄이 먼저 빨개진다.
   */
  const productR2Available = engineSwitchAvailable({ labPath: false, productEnabled: ENGINE_SWITCH_PRODUCT_ENABLED });
  assert.equal(productR2Available, true,
    '정식이 유휴 창 갈래에 안 선다 — 결정 ⑮ 가 승격으로 안 넘어갔다(정식은 옛 시작 시각 기준 그대로다)');
  // 그리고 그 갈래에서 실제로 사는 간격이 옛 간격보다 크다 — «−33 %» 의 값 쪽 얼굴이다.
  for (const cost of [400, 1400, 2800]) {
    const chosen = productR2Available ? idleAfterDecodeMs(adaptiveFrameIntervalMs(cost)) : adaptiveFrameIntervalMs(cost);
    assert.ok(chosen > 0 && chosen === idleAfterDecodeMs(cost),
      cost + 'ms 에서 정식이 사는 유휴가 유휴 창의 값이 아니다');
  }

  // 정식 분기는 rAF `timestamp` 가 아니라 같은 콜백의 `frameStartedAt` 을 쓴다(차이 <1 ms). 옛 철자 부활 금지.
  assert.ok(!/lastDecodeAt\s*=\s*timestamp/.test(JS),
    'lastDecodeAt 을 rAF `timestamp` 로 되돌렸다 — 기준점 철자가 둘로 갈린다');

  // 갱신 자리는 `.finally` 안 한 곳, 그리고 세션 회계와 같은 가드 안이다.
  const finallyAt = loop.indexOf('.finally(() => {');
  assert.ok(finallyAt > 0, 'R1 attempt 의 finally 를 못 찾았다');
  const fin = loop.slice(finallyAt, loop.indexOf('noteFrameProcessed();', finallyAt));
  assert.ok(fin.includes('lastDecodeAt = r2Available ? frameStartedAt + lastFrameCostMs : frameStartedAt;'),
    'finally 가 캐던스 기준점을 갱신하지 않는다');
  assert.ok(fin.indexOf('lastFrameCostMs = Math.max(0, nowMs() - frameStartedAt);') < fin.indexOf('lastDecodeAt ='),
    '완료 시각을 비용보다 먼저 잡는다 — 두 값이 어긋난다');
  assert.ok(fin.includes('if (session === scanSession) {'), '갱신이 세션 가드 밖이다 — 옛 세션의 늦은 finally 가 새 세션의 첫 grab 을 미룬다');

  // 루프 전체에서 대입은 그 한 줄뿐 (리셋 경로 제외 — 그쪽은 0 으로 되돌린다).
  const assignments = (loop.match(/lastDecodeAt\s*=/g) || []).length;
  assert.equal(assignments, 1, '프레임 루프 안에서 lastDecodeAt 대입이 ' + assignments + '곳이다 — 기준점이 둘이면 뜻이 갈린다');
  assert.ok(/lastDecodeAt = 0;/.test(JS), 'stopCamera 의 초기화가 사라졌다 — 새 세션 첫 프레임이 옛 완료 시각을 상속한다');
});

test('ⓔ 거래가 소스에 적혀 있다 — 그리고 적힌 수치가 상수에서 **유도**된다', () => {
  // 사본 금지: 주석의 «−33 %» 는 R1_IDLE_FRACTION 에서 나온 수다. 비율을 바꾸면 이 자가 주석까지
  // 빨갛게 만든다(«있다» 만 재면 비율 0.25 에서도 옛 −33 % 가 그대로 남는다 — 손으로 유지하는 사본).
  const pct = Math.round((1 - 1 / (1 + R1_IDLE_FRACTION)) * 100);
  const written = new RegExp('[−-]' + pct + '\\s*%');
  const src = readFileSync(ROOT + 'src/scanner-frame-rate.js', 'utf8');
  assert.ok(written.test(src) && /R1_IDLE_FRACTION/.test(src),
    'scanner-frame-rate.js 의 처리율 거래 수치가 R1_IDLE_FRACTION 과 어긋난다 (기대 −' + pct + ' %)');
  const loopAt = JS.indexOf('function startFrameLoop(');
  const loop = JS.slice(loopAt, JS.indexOf('async function startCamera(', loopAt));
  assert.ok(written.test(loop),
    'scanner.js 의 캐던스 자리 수치가 R1_IDLE_FRACTION 과 어긋난다 (기대 −' + pct + ' %)');
  /*
   * 그리고 그 거래를 «누가 치르는가» 도 적혀 있어야 한다. 승격(2026-09-06) **전**엔 그 답이 «정식은
   * 안 치른다» 였고 지금은 정반대다 — 스위치가 정식에 섰으므로 결정 ⑮ 가 새 코드 없이 넘어가 정식의
   * R1 위치도 −33 % 를 치른다. 그래서 여기서 재는 것은 「정식」이라는 **글자**가 아니라 ① 갈래의
   * 입력(`r2Available`) ② 갈래를 옮긴 사건(승격 날짜)이 적혀 있는가, 그리고 ③ 승격 전의 거짓 문장이
   * 되살아나지 **않았는가** 다. 값 쪽 얼굴은 ⓓ 가 잰다(정식 입력이 실제로 유휴 창 갈래에 선다).
   */
  assert.ok(/r2Available/.test(loop) && /2026-09-06/.test(loop),
    '캐던스 주석이 «누가 이 거래를 치르는가»(갈래 입력 + 승격 사건)를 안 적었다 — 다음 사람이 갈래를 지운다');
  assert.ok(!/정식[^\n]{0,20}(안 치른다|치르지 않는다)/.test(loop),
    '캐던스 주석이 승격 전의 거짓 문장(«정식은 이 거래를 치르지 않는다»)으로 되돌아갔다 — 승격 뒤 정식도 치른다');
});
