/**
 * scan-steady.test.js — 「안정 유지」 추적기 단위 KAT.
 *
 * 추적기는 시계를 읽지 않는다(시각은 주입). 그래서 안정·흔들림·센서 시퀀스를 그대로
 * 재생해 결정적으로 단언할 수 있다 — 이 파일이 그 계약의 증거다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSteadyTracker,
  gravityAngularRate,
  lumaSignature,
  motionAttachPlan,
  motionExceedsLimit,
  motionGateKind,
  requestMotionPermission,
  signatureDistance,
  STEADY_ANCHOR_TOLERANCE,
  STEADY_GRID,
  STEADY_HOLD_MS,
  STEADY_MOTION_VETO_MS,
  STEADY_RETRY_MS,
  STEADY_ROTATION_RATE_LIMIT,
  STEADY_SAMPLE_MS_CAP,
  STEADY_VISUAL_TOLERANCE,
} from '../src/scan-steady.js';

const FRAME_MS = 320; // scanner.js FRAME_INTERVAL_MS

/** grid² 길이의 서명. base 에 delta 를 균일하게 더하면 MAD 가 정확히 |delta| 다. */
function signatureOf(base, delta = 0) {
  const length = STEADY_GRID * STEADY_GRID;
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    // 부호를 번갈아 주면 합이 0 이라 「평균 이동」 이 아니라 「재배치」 를 흉내낸다.
    out[index] = base[index] + (index % 2 === 0 ? delta : -delta);
  }
  return out;
}

function flatBase(value = 0) {
  return new Float32Array(STEADY_GRID * STEADY_GRID).fill(value);
}

/** 프레임 시퀀스를 재생하고 마지막 스냅샷을 돌려준다. */
function play(tracker, steps) {
  let snapshot = null;
  for (const step of steps) {
    snapshot = tracker.observeFrame(step);
  }
  return snapshot;
}

test('상수 계약 — 유지 1.5초, 톨러런스는 0 이 아니고 anchor 상한이 더 크다', () => {
  assert.equal(STEADY_HOLD_MS, 1500, '운영자 지정 1.5초');
  assert.ok(STEADY_VISUAL_TOLERANCE > 0, '톨러런스 0 이면 사람 손으로는 절대 안 걸린다');
  assert.ok(STEADY_ANCHOR_TOLERANCE > STEADY_VISUAL_TOLERANCE,
    '누적 상한이 프레임 간 상한보다 작으면 anchor 검사가 프레임 검사를 가려 버린다');
  // 프레임 주기보다 veto 가 길어야 최소 한 프레임은 확실히 거른다.
  assert.ok(STEADY_MOTION_VETO_MS > FRAME_MS);

  /*
   * 표본당 상한 계약 (2026-08-16 정정).
   *   · 설계 표본율(320ms)에서는 캡이 걸리면 안 된다 — 걸리면 정상 동작이 바뀐다.
   *   · 그러면서 「1.5초」 가 표본 두 장으로 성립하지 않아야 한다 → holdMs > 2 × 캡.
   */
  assert.ok(STEADY_SAMPLE_MS_CAP > FRAME_MS, '캡이 프레임 주기 이하면 평상 동작이 바뀐다');
  assert.ok(STEADY_HOLD_MS > 2 * STEADY_SAMPLE_MS_CAP,
    '표본 2장으로 유지가 채워진다 — 캡이 제 일을 못 한다');
  assert.equal(Math.ceil(STEADY_HOLD_MS / STEADY_SAMPLE_MS_CAP), 3, '최소 비교 3회');
});

test('표본당 상한 — 표본 두 장(0 → 1600ms)으로는 발동하지 않는다', () => {
  /*
   * 회귀 고정 (2026-08-16 적대 검증 F4): `heldMs += elapsed` 에 상한이 없어서 **표본
   * 2장**이 1600ms 떨어져 있는 것만으로 armed 가 섰다. 표본 주기는 320ms 가 아니라
   * max(320ms, 복호시간)이고, 트리거가 필요한 구간(연속 스캔 실패 중)이 바로 복호가
   * 가장 느린 구간이라 흔한 경로였다.
   */
  const same = signatureOf(flatBase(), 0);

  const sparse = createSteadyTracker();
  sparse.observeFrame({ signature: same, timeMs: 0 });
  const twoSamples = sparse.observeFrame({ signature: same, timeMs: 1600 });
  assert.equal(twoSamples.holdSamples, 1, '비교는 한 번뿐이다');
  assert.equal(twoSamples.heldMs, STEADY_SAMPLE_MS_CAP, '표본 하나가 캡보다 더 기여했다');
  assert.equal(twoSamples.armed, false, '표본 2장으로 「1.5초 유지」 가 성립했다');
  assert.equal(twoSamples.trigger, false);

  // 극단값도 같다 — 60초를 떨어뜨려도 근거는 여전히 비교 한 번이다.
  const stalled = createSteadyTracker();
  stalled.observeFrame({ signature: same, timeMs: 0 });
  assert.equal(stalled.observeFrame({ signature: same, timeMs: 60000 }).armed, false);

  /*
   * 느린 복호(표본 900ms)에서도 세 번째 비교부터 선다 — 그리고 그때 **벽시계로는
   * 이미 2700ms** 가 지났다. 즉 캡은 「1.5초」 를 약화하지 않고 엄격하게만 만든다.
   */
  const slow = createSteadyTracker();
  let snapshot = slow.observeFrame({ signature: same, timeMs: 0 });
  const armedAt = [];
  for (let step = 1; step <= 3; step += 1) {
    snapshot = slow.observeFrame({ signature: same, timeMs: step * 900 });
    armedAt.push(snapshot.armed);
  }
  assert.deepEqual(armedAt, [false, false, true], '캡이 강제하는 최소 비교 3회가 아니다');
  assert.equal(snapshot.holdSamples, 3);
  assert.ok(snapshot.heldMs <= 3 * 900, 'heldMs 가 실제 경과보다 크다 — 캡이 새고 있다');
  assert.ok(snapshot.heldMs >= STEADY_HOLD_MS);

  // 평상 표본율(320ms)에서는 캡이 한 번도 걸리지 않는다 — heldMs 가 벽시계와 같다.
  const normal = createSteadyTracker();
  normal.observeFrame({ signature: same, timeMs: 0 });
  let last = null;
  for (let step = 1; step <= 5; step += 1) {
    last = normal.observeFrame({ signature: same, timeMs: step * FRAME_MS });
  }
  assert.equal(last.heldMs, 5 * FRAME_MS, '평상 동작이 캡 때문에 달라졌다');
});

test('완전 정지 — 1.5초를 채우면 armed·trigger 가 선다 (그 전에는 서지 않는다)', () => {
  const tracker = createSteadyTracker();
  const base = flatBase();
  const same = signatureOf(base, 0);

  // t=0 첫 프레임: 비교 대상이 없다 → 유지 0.
  let snapshot = tracker.observeFrame({ signature: same, timeMs: 0 });
  assert.equal(snapshot.delta, null);
  assert.equal(snapshot.heldMs, 0);
  assert.equal(snapshot.armed, false);
  assert.equal(snapshot.trigger, false);

  // 1.5초에 **못 미치는** 동안은 계속 false.
  for (let time = FRAME_MS; time < STEADY_HOLD_MS; time += FRAME_MS) {
    snapshot = tracker.observeFrame({ signature: same, timeMs: time });
    assert.equal(snapshot.stable, true, 'time=' + time);
    assert.equal(snapshot.armed, false, 'time=' + time + ' 에서 이르게 armed');
    assert.ok(snapshot.progress < 1);
  }

  // 누적이 1500 을 넘는 첫 프레임(t=1600)에서 선다.
  snapshot = tracker.observeFrame({ signature: same, timeMs: 1600 });
  assert.equal(snapshot.heldMs, 1600);
  assert.equal(snapshot.armed, true);
  assert.equal(snapshot.trigger, true);
  assert.equal(snapshot.progress, 1);
});

test('손떨림 톨러런스 — 임계 이하는 유지, 임계 초과는 즉시 리셋', () => {
  const base = flatBase();
  const inside = STEADY_VISUAL_TOLERANCE * 0.9;
  const outside = STEADY_VISUAL_TOLERANCE * 1.1;

  // ① 임계 이하의 미세 흔들림이 계속돼도 유지가 쌓인다 (0 이 아닌 톨러런스의 의미).
  const shaky = createSteadyTracker();
  let snapshot = shaky.observeFrame({ signature: signatureOf(base, 0), timeMs: 0 });
  for (let step = 1; step <= 6; step += 1) {
    // 부호를 번갈아 흔들어 「제자리 떨림」 을 만든다 — 매 프레임 delta 는 2×inside 가
    // 아니라 inside 가 되도록 0 ↔ inside 사이를 오간다.
    const delta = step % 2 === 0 ? 0 : inside;
    snapshot = shaky.observeFrame({ signature: signatureOf(base, delta), timeMs: step * FRAME_MS });
  }
  assert.ok(Math.abs(snapshot.delta - inside) < 1e-6);
  assert.equal(snapshot.stable, true);
  assert.equal(snapshot.heldMs, 6 * FRAME_MS);

  // ② 임계를 넘는 한 프레임이 유지를 0 으로 되돌린다.
  const jolted = createSteadyTracker();
  jolted.observeFrame({ signature: signatureOf(base, 0), timeMs: 0 });
  jolted.observeFrame({ signature: signatureOf(base, 0), timeMs: FRAME_MS });
  const before = jolted.observeFrame({ signature: signatureOf(base, 0), timeMs: 2 * FRAME_MS });
  assert.equal(before.heldMs, 2 * FRAME_MS);
  const after = jolted.observeFrame({
    signature: signatureOf(base, outside),
    timeMs: 3 * FRAME_MS,
  });
  assert.equal(after.stable, false);
  assert.equal(after.heldMs, 0);
  assert.equal(after.armed, false);
});

test('누적 드리프트 — 프레임 간은 매번 통과해도 anchor 대비 상한을 넘으면 끊긴다', () => {
  // 이것이 프레임 간 상한만으로는 못 잡는 결함이다: 같은 방향으로 조금씩 계속 밀리면
  // 프레임마다는 「안정」 인데 1.5초 뒤에는 사전 포즈가 못 따라갈 만큼 어긋나 있다.
  const tracker = createSteadyTracker();
  const base = flatBase();
  const perFrame = STEADY_VISUAL_TOLERANCE * 0.8;
  let snapshot = tracker.observeFrame({ signature: signatureOf(base, 0), timeMs: 0 });

  let broke = false;
  for (let step = 1; step <= 6; step += 1) {
    snapshot = tracker.observeFrame({
      signature: signatureOf(base, perFrame * step),
      timeMs: step * FRAME_MS,
    });
    // 프레임 간 차는 언제나 톨러런스 안이다.
    assert.ok(snapshot.delta <= STEADY_VISUAL_TOLERANCE + 1e-9, 'step=' + step);
    if (snapshot.heldMs === 0) broke = true;
  }
  assert.equal(broke, true, '단조 드리프트가 누적 상한에 걸리지 않았다');
  assert.ok(snapshot.heldMs < STEADY_HOLD_MS, '드리프트 중인데 트리거가 섰다');
});

test('보고 일관성 — stable 과 heldMs 가 서로 어긋나지 않는다', () => {
  /*
   * 회귀 고정: `stable` 을 스냅샷에서 다시 계산하면 「끊긴 직후」 프레임에서
   * heldMs=0 인데 stable=true 가 나온다 (끊길 때 anchor 를 새로 잡으므로 누적차가
   * null 이 되고, 프레임 간 차만 보면 작기 때문). 판정은 한 곳에서만 내야 한다 —
   * 아니면 lab 게이지가 「hold」 라 적힌 채 막대가 0 인 화면이 나온다.
   */
  const tracker = createSteadyTracker();
  const base = flatBase();
  const perFrame = STEADY_VISUAL_TOLERANCE * 0.8;
  let snapshot = tracker.observeFrame({ signature: signatureOf(base, 0), timeMs: 0 });
  for (let step = 1; step <= 10; step += 1) {
    snapshot = tracker.observeFrame({
      signature: signatureOf(base, perFrame * step),
      timeMs: step * FRAME_MS,
    });
    if (snapshot.heldMs === 0) {
      assert.equal(snapshot.stable, false,
        'step=' + step + ': heldMs 0 인데 stable 이 true 다');
    }
    if (snapshot.stable) {
      assert.ok(snapshot.heldMs > 0, 'step=' + step + ': stable 인데 heldMs 가 0 이다');
    }
  }
});

test('rate limit — 유지 중 재시도는 STEADY_RETRY_MS 간격으로만', () => {
  const tracker = createSteadyTracker();
  const same = signatureOf(flatBase(), 0);
  // 평상 표본율로 1.5초를 채운다 (표본 2장 지름길은 캡이 막는다 — 위 테스트).
  let snapshot = null;
  for (let time = 0; time <= 1600; time += FRAME_MS) {
    snapshot = tracker.observeFrame({ signature: same, timeMs: time });
  }
  snapshot = tracker.observeFrame({ signature: same, timeMs: 1600 });
  assert.equal(snapshot.trigger, true);
  tracker.markTriggered(1600);

  // 바로 다음 프레임들은 armed 이지만 trigger 는 false (rate limit).
  snapshot = tracker.observeFrame({ signature: same, timeMs: 1600 + FRAME_MS });
  assert.equal(snapshot.armed, true);
  assert.equal(snapshot.trigger, false);
  snapshot = tracker.observeFrame({ signature: same, timeMs: 1600 + STEADY_RETRY_MS - 1 });
  assert.equal(snapshot.trigger, false);

  // 간격을 채우면 다시 선다.
  snapshot = tracker.observeFrame({ signature: same, timeMs: 1600 + STEADY_RETRY_MS });
  assert.equal(snapshot.trigger, true);
  assert.equal(snapshot.triggerCount, 1, 'markTriggered 를 부르기 전에는 세지 않는다');
});

test('센서 부재 = 시각 단독과 **완전히 같은** 시퀀스 (기능 저하 0 의 증거)', () => {
  /*
   * ⚠ 이 테스트는 **전 프레임 · 전 판정 필드**를 대조한다. 예전에는 마지막 스냅샷의
   *   네 필드만 봤는데, 보고서는 「시퀀스 대조로 단언한다」 고 적고 있었다 — 주장과
   *   테스트가 어긋난 자리다 (2026-08-16 적대 검증 F8). 주장 쪽이 아니라 테스트 쪽을
   *   올려 맞춘다.
   */
  const FIELDS = ['delta', 'anchorDelta', 'stable', 'heldMs', 'holdSamples',
    'progress', 'armed', 'trigger', 'motionVetoed'];
  const pick = (snapshot) => FIELDS.map((field) => snapshot[field]);

  const steps = [];
  const base = flatBase();
  for (let step = 0; step <= 8; step += 1) {
    // 임계 아래에서 흔들리는 현실적인 시퀀스 (전부 동일 서명이면 대조가 무디다).
    const wobble = step % 3 === 0 ? 0 : STEADY_VISUAL_TOLERANCE * 0.4;
    steps.push({ signature: signatureOf(base, wobble), timeMs: step * FRAME_MS });
  }

  const plain = createSteadyTracker();
  const sensed = createSteadyTracker();
  let sensorSnapshot = null;
  for (const step of steps) {
    const withoutSensor = plain.observeFrame(step);
    // 센서를 붙였지만 **임계 아래** 표본만 오는 경우 — 거부권이 발동하지 않으므로
    // 결과가 시각 단독과 한 글자도 달라선 안 된다.
    sensed.observeMotion({
      rotationRate: { alpha: 0.4, beta: -0.3, gamma: 0.2 },
      accelerationIncludingGravity: { x: 0.05, y: 9.8, z: 0.02 },
      timeMs: step.timeMs - 1,
    });
    sensorSnapshot = sensed.observeFrame(step);
    assert.deepEqual(pick(sensorSnapshot), pick(withoutSensor),
      'timeMs=' + step.timeMs + ' 에서 센서 유무가 판정을 갈랐다');
  }
  const withoutSensor = plain.snapshot(steps[steps.length - 1].timeMs);
  // 다만 「센서가 살아 있다」 는 사실 자체는 구분된다 (lab 표시용).
  assert.equal(withoutSensor.sensorActive, false);
  assert.equal(sensorSnapshot.sensorActive, true);
  assert.equal(sensorSnapshot.sensorVetoCount, 0);
});

test('sensorActive 는 **데이터가 온 표본**만 센다 (빈 devicemotion 을 on 으로 읽지 않는다)', () => {
  /*
   * 회귀 고정 (2026-08-16 적대 검증 F9): 필드가 전부 null 인 `devicemotion` 을 흘리는
   * 기기가 있는데, 예전 구현은 이벤트 수만 세어 오버레이에 `sensor:on` 을 찍었다.
   * 「센서가 붙었는데 아무것도 안 준다」 와 「센서가 값을 준다」 는 다른 사실이다.
   */
  const tracker = createSteadyTracker();
  const empty = tracker.observeMotion({
    rotationRate: { alpha: null, beta: null, gamma: null },
    acceleration: null,
    accelerationIncludingGravity: null,
    timeMs: 10,
  });
  assert.equal(empty.sensorSampleCount, 1, '이벤트 자체는 셌어야 한다');
  assert.equal(empty.sensorDataCount, 0);
  assert.equal(empty.sensorActive, false, '값 없는 이벤트를 「센서 살아 있음」 으로 읽었다');

  const real = tracker.observeMotion({
    rotationRate: { alpha: 0.5, beta: 0, gamma: 0 },
    timeMs: 26,
  });
  assert.equal(real.sensorDataCount, 1);
  assert.equal(real.sensorActive, true);
});

test('센서는 거부권만 — 큰 각속도가 유지를 조기에 끊는다 (그리고 veto 창 동안 유지된다)', () => {
  const tracker = createSteadyTracker();
  const same = signatureOf(flatBase(), 0);
  tracker.observeFrame({ signature: same, timeMs: 0 });
  const held = tracker.observeFrame({ signature: same, timeMs: FRAME_MS });
  assert.equal(held.heldMs, FRAME_MS);

  // 시각적으로는 **완전히 같은 프레임**인데 자이로가 크게 움직였다 —
  // 320ms 표본 사이에 일어난 빠른 패닝의 에일리어싱이 정확히 이 모양이다.
  const vetoed = tracker.observeMotion({
    rotationRate: { alpha: STEADY_ROTATION_RATE_LIMIT + 5, beta: 0, gamma: 0 },
    timeMs: FRAME_MS + 10,
  });
  assert.equal(vetoed.motionVetoed, true);
  assert.equal(vetoed.heldMs, 0);
  assert.equal(vetoed.sensorVetoCount, 1);

  // veto 창 안의 프레임은 시각이 같아도 유지를 쌓지 않는다.
  const during = tracker.observeFrame({ signature: same, timeMs: FRAME_MS + 100 });
  assert.equal(during.stable, false);
  assert.equal(during.heldMs, 0);

  // 창이 지나면 다시 쌓인다.
  const after = tracker.observeFrame({
    signature: same,
    timeMs: FRAME_MS + 10 + STEADY_MOTION_VETO_MS + 1,
  });
  assert.equal(after.motionVetoed, false);
  assert.equal(after.stable, true);
});

test('센서는 안정을 «부여» 하지 않는다 — 자이로가 조용해도 시각이 흔들리면 불안정', () => {
  const tracker = createSteadyTracker();
  const base = flatBase();
  tracker.observeFrame({ signature: signatureOf(base, 0), timeMs: 0 });
  for (let step = 1; step <= 8; step += 1) {
    tracker.observeMotion({
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      acceleration: { x: 0, y: 0, z: 0 },
      timeMs: step * FRAME_MS - 1,
    });
    const snapshot = tracker.observeFrame({
      // 매 프레임 톨러런스를 크게 넘는 변화 (피사체·초점 이동은 자이로에 안 잡힌다)
      signature: signatureOf(base, step % 2 === 0 ? 0 : STEADY_VISUAL_TOLERANCE * 4),
      timeMs: step * FRAME_MS,
    });
    assert.equal(snapshot.stable, false, 'step=' + step);
    assert.equal(snapshot.heldMs, 0, 'step=' + step);
  }
});

test('선형 가속 채널 — 순수 평행이동을 보는 유일한 채널이고, 없으면 기권한다', () => {
  // 선형 가속(gravity 제거)이 오는 브라우저. 자이로가 없어도 평행이동을 본다.
  assert.equal(motionExceedsLimit({ acceleration: { x: 0.2, y: 0.1, z: 0 } }, null).exceeded, false);
  assert.equal(motionExceedsLimit({ acceleration: { x: 5, y: 0, z: 0 } }, null).exceeded, true);

  // 아무 값도 없으면 기권 — 「모른다」 를 「움직였다」 로 읽지 않는다.
  assert.equal(motionExceedsLimit({}, null).exceeded, false);
  assert.equal(motionExceedsLimit(null, null).exceeded, false);
  assert.equal(motionExceedsLimit({ acceleration: { x: null, y: null, z: null } }, null).accel, null);
});

test('중력차분 채널 — Δt 정규화가 있어야 실사용 표본율에서 산다 (죽은 채널 회귀)', () => {
  /*
   * 회귀 고정 (2026-08-16 적대 검증 F3): 예전 구현은 `|Δg| > 1.6 m/s²` 를 그대로 임계로
   * 썼다. 그것은 가속도가 아니라 Δ(자세)라 표본율에 통째로 의존한다 — 같은 1.6 이
   * 60Hz 에서 561 deg/s(자이로 임계의 46.8배), 3Hz 에서 28 deg/s 였다. 즉 자이로가 없어
   * 이 폴백을 타는 브라우저에서 채널이 **사실상 발화하지 않았다.** Δt 로 정규화해
   * 자이로와 같은 물리량(deg/s)·같은 임계로 잰다.
   */
  // 유도식 검산: |Δg| = 2·G·sin(θ/2). 9.36° 는 |Δg| ≈ 1.6 에 해당한다.
  const dg = 2 * 9.80665 * Math.sin((9.36 * Math.PI) / 180 / 2);
  assert.ok(Math.abs(dg - 1.6) < 0.01, '유도식 자체가 틀렸다');
  // 같은 |Δg| 라도 표본 간격에 따라 각속도가 다르다 — 그것이 정규화의 요점이다.
  assert.ok(Math.abs(gravityAngularRate(dg, 1000 / 60) - 9.36 * 60) < 1);
  assert.ok(Math.abs(gravityAngularRate(dg, 1000 / 3) - 9.36 * 3) < 1);

  const withGravity = (x, timeMs) => ({
    accelerationIncludingGravity: { x, y: 9.8, z: 0 },
    timeMs,
  });
  const previousAt = (timeMs) => ({ x: 0, y: 9.8, z: 0, timeMs });

  // 60Hz 로 들어오는 작은 자세 변화 — 예전 임계(1.6)로는 **못 잡던** 크기인데,
  // 각속도로 환산하면 자이로 임계를 훌쩍 넘는다.
  const fast = motionExceedsLimit(withGravity(0.5, 16.7), previousAt(0));
  assert.equal(fast.rateSource, 'gravity');
  assert.ok(fast.rate > STEADY_ROTATION_RATE_LIMIT, '60Hz 의 실제 회전을 놓친다');
  assert.equal(fast.exceeded, true);

  // 같은 |Δg| 가 3Hz 간격으로 오면 그것은 느린 움직임이다 — veto 하면 안 된다.
  const slow = motionExceedsLimit(withGravity(0.5, 333), previousAt(0));
  assert.ok(slow.rate < STEADY_ROTATION_RATE_LIMIT);
  assert.equal(slow.exceeded, false);

  // 정지(중력만) 는 어떤 간격에서도 조용하다.
  assert.equal(motionExceedsLimit(withGravity(0.001, 16.7), previousAt(0)).exceeded, false);

  // Δt 가 없거나 유효 범위 밖이면 **기권**한다 — 0 에 가까운 Δt 는 유도값을 발산시켜
  // 거짓 veto 가 되고(유지가 영영 안 쌓인다), 너무 벌어진 쌍은 대표성이 없다.
  assert.equal(motionExceedsLimit(withGravity(5, 1), previousAt(0)).rate, null);
  assert.equal(motionExceedsLimit(withGravity(5, 900), previousAt(0)).rate, null);
  assert.equal(gravityAngularRate(1.6, null), null);
  assert.equal(
    motionExceedsLimit({ accelerationIncludingGravity: { x: 5, y: 9.8, z: 0 } },
      { x: 0, y: 9.8, z: 0 }).rate,
    null,
    '시각이 없는 쌍에서 각속도를 지어내면 안 된다',
  );

  // 자이로가 있으면 유도값을 쓰지 않는다 (같은 물리량을 두 번 재면 잡음만 는다).
  const both = motionExceedsLimit({
    rotationRate: { alpha: 1, beta: 0, gamma: 0 },
    ...withGravity(0.5, 16.7),
  }, previousAt(0));
  assert.equal(both.rateSource, 'gyro');
  assert.equal(both.rate, 1);
  assert.equal(both.exceeded, false);

  /*
   * 구조적 한계 (정직 기록): 자세가 안 변하는 **순수 평행이동**은 Δg = 0 이라 이 채널이
   * 원리상 못 본다. 선형 가속이 없는 브라우저에서는 평행이동을 센서가 못 보고 시각
   * 단독이 맡는다 — 「자이로가 덮는다」 고 말하면 거짓이다.
   */
  const translationOnly = motionExceedsLimit(withGravity(0, 16.7), previousAt(0));
  assert.equal(translationOnly.exceeded, false);
  assert.equal(translationOnly.accel, null, '평행이동을 볼 채널이 애초에 없다');
});

test('reset — 카메라 수명주기 경계에서 유지·트리거·센서 상태가 전부 비워진다', () => {
  const tracker = createSteadyTracker();
  const same = signatureOf(flatBase(), 0);
  tracker.observeFrame({ signature: same, timeMs: 0 });
  tracker.observeFrame({ signature: same, timeMs: 1600 });
  tracker.markTriggered(1600);
  tracker.observeMotion({ rotationRate: { alpha: 99 }, timeMs: 1610 });

  const cleared = tracker.reset();
  assert.equal(cleared.heldMs, 0);
  assert.equal(cleared.delta, null);
  assert.equal(cleared.anchorDelta, null);
  assert.equal(cleared.triggerCount, 0);
  assert.equal(cleared.sensorActive, false);
  assert.equal(cleared.motionVetoed, false);

  // 리셋 뒤에는 다시 처음부터 1.5초를 채워야 한다.
  tracker.observeFrame({ signature: same, timeMs: 5000 });
  const soon = tracker.observeFrame({ signature: same, timeMs: 5000 + FRAME_MS });
  assert.equal(soon.armed, false);
});

test('서명 — 정규화가 노출 변화를 흡수하고, 블록 재배치는 남긴다', () => {
  const width = 48;
  const height = 48;
  const make = (fn) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = fn(x, y);
        const offset = (y * width + x) * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
        data[offset + 3] = 255;
      }
    }
    return { width, height, data };
  };

  const pattern = (x, y) => ((x >> 3) + (y >> 3)) % 2 === 0 ? 40 : 210;
  const flat = lumaSignature(make(pattern), { stride: 1 });
  // 밝기를 20% 올려도(자동노출) 서명은 사실상 같아야 한다.
  const brighter = lumaSignature(make((x, y) => pattern(x, y) * 1.2), { stride: 1 });
  assert.ok(signatureDistance(flat, brighter) < 0.02,
    '자동노출 변화를 「움직였다」 로 읽는다');

  // 한 블록만큼 밀면 확실히 달라야 한다.
  const shifted = lumaSignature(make((x, y) => pattern(x + 8, y)), { stride: 1 });
  assert.ok(signatureDistance(flat, shifted) > 0.5, '블록 재배치를 못 본다');

  // 계약: 길이 = grid², 결정적.
  assert.equal(flat.length, STEADY_GRID * STEADY_GRID);
  assert.deepEqual(Array.from(flat), Array.from(lumaSignature(make(pattern), { stride: 1 })));
  assert.equal(lumaSignature(null), null);
  assert.equal(signatureDistance(flat, null), null);
});

test('서명을 못 만드는 프레임은 유지를 끊는다 (조용히 유지하지 않는다)', () => {
  const tracker = createSteadyTracker();
  const same = signatureOf(flatBase(), 0);
  tracker.observeFrame({ signature: same, timeMs: 0 });
  tracker.observeFrame({ signature: same, timeMs: FRAME_MS });
  const broken = tracker.observeFrame({ frame: null, timeMs: 2 * FRAME_MS });
  assert.equal(broken.heldMs, 0);
  assert.equal(broken.delta, null);
});

test('부착 판정 — 자동 시작 경로에서도 붙는다 (게이트 없으면 즉시, iOS 는 지연)', () => {
  /*
   * 회귀 고정 (2026-08-16 적대 검증 F2): 예전 배선은 `attachMotionAssist()` 를 **스캔
   * 시작 버튼 클릭 한 곳**에서만 불렀다. 그런데 이 스캐너의 주 동선은 「카메라 권한이
   * 이미 허용된 아이폰 → 자동 시작」 이라 그 버튼을 거치지 않는다 — 즉 센서가 가장
   * 중요한 기기에서 영원히 off 였고, 보고서는 `sensor:on` 을 정상 상태로 서술했다.
   *
   * 판정을 순수 함수로 꺼내 두었으므로 경로별 결론을 여기서 직접 못박는다.
   */
  const androidLike = { DeviceMotionEvent: function DME() {} };
  const iosLike = { DeviceMotionEvent: Object.assign(function DME() {}, {
    requestPermission: async () => 'granted',
  }) };
  const desktopLike = {};

  assert.equal(motionGateKind(androidLike), 'no-gate');
  assert.equal(motionGateKind(iosLike), 'gesture-required');
  assert.equal(motionGateKind(desktopLike), 'unsupported');

  // 게이트가 없는 브라우저는 **제스처 없이도** 붙는다 — 자동 시작 경로의 핵심.
  assert.deepEqual(
    motionAttachPlan({ scope: androidLike, userGesture: false }),
    { action: 'attach', gate: 'no-gate', needsPermission: false },
  );

  // iOS 자동 시작(제스처 없음) → 지연. 제스처 밖 requestPermission 은 소진일 뿐이다.
  assert.deepEqual(
    motionAttachPlan({ scope: iosLike, userGesture: false }),
    { action: 'defer', gate: 'gesture-required', needsPermission: true },
  );
  // 그 다음 «컨트롤 조작»(button·select·input·a·[role=button] — 빈 화면 탭은 의도적
  // 제외: 권한 팝업 오발 방지, scanner.js MOTION_GESTURE_SELECTOR)에서는 붙는다.
  assert.deepEqual(
    motionAttachPlan({ scope: iosLike, userGesture: true }),
    { action: 'attach', gate: 'gesture-required', needsPermission: true },
  );

  // 센서 없는 브라우저는 어느 경로에서도 시도하지 않는다 (시각 단독이 정상 경로).
  for (const userGesture of [false, true]) {
    assert.equal(motionAttachPlan({ scope: desktopLike, userGesture }).action, 'skip');
  }
});

test('iOS 권한 게이트 — 거부·미지원·예외가 전부 granted:false 로 접힌다', async () => {
  assert.deepEqual(await requestMotionPermission({}), { granted: false, reason: 'unsupported' });

  // 게이트가 없는 브라우저(Android Chrome 등)는 그냥 붙이면 된다.
  assert.deepEqual(
    await requestMotionPermission({ DeviceMotionEvent: function DME() {} }),
    { granted: true, reason: 'no-gate' },
  );

  const denied = function DME() {};
  denied.requestPermission = async () => 'denied';
  assert.deepEqual(await requestMotionPermission({ DeviceMotionEvent: denied }),
    { granted: false, reason: 'denied' });

  const granted = function DME() {};
  granted.requestPermission = async () => 'granted';
  assert.deepEqual(await requestMotionPermission({ DeviceMotionEvent: granted }),
    { granted: true, reason: 'granted' });

  const throws = function DME() {};
  throws.requestPermission = async () => { throw new TypeError('gesture required'); };
  const result = await requestMotionPermission({ DeviceMotionEvent: throws });
  assert.equal(result.granted, false);
  assert.match(result.reason, /^threw:/);
});
