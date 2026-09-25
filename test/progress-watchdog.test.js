/**
 * progress-watchdog.test.js — test/helpers/progress-watchdog.mjs 의 자기 테스트.
 *
 * seq-truth 는 이 감시자를 믿고 총 벽시계 상한을 버렸다. 그러니 감시자가 «멈춤은 잡고
 * 오래 걸리는 것은 안 잡는다» 를 따로 잰다 — seq-truth 본체는 20 분짜리라 멈춤 경로를
 * 매번 지나지 않는다.
 *
 * ⚠ 이 파일 자체가 부하에 민감하면 안 된다. 실제 자식은 기동 시간이 부하를 따라 늘어서
 * (첫 초안의 20 ms × 5 틱 창은 노드 기동 중에 자식을 죽였다) «언제 몇 바이트가 왔나» 를
 * 단언하지 않는다. 진행 배선은 같은 이벤트 루프의 가짜 자식으로 잰다 — 루프가 막혀도
 * 방출 타이머와 틱 타이머가 같이 밀리므로 결과가 부하와 무관하다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  createStallDetector, runWithProgressWatchdog, watchProgress,
} from './helpers/progress-watchdog.mjs';

test('판정기: 틱마다 진행하면 총 틱 수가 한도의 수천 배여도 멈춤이 아니에요', () => {
  const detector = createStallDetector(5);
  for (let i = 0; i < 10_000; i += 1) {
    detector.progress();
    assert.equal(detector.tick(), false);
  }
  assert.equal(detector.stalled, false);
  assert.equal(detector.maxIdleTicks, 0);
});

test('판정기: 무진행이 한도-1 틱이면 넘어가고, 한도 틱째에 딱 한 번 멈춤이에요', () => {
  const detector = createStallDetector(5);
  for (let i = 0; i < 4; i += 1) assert.equal(detector.tick(), false);
  detector.progress();
  assert.equal(detector.tick(), false, '진행이 오면 무진행 연속이 끊긴다');
  const fired = [];
  for (let i = 1; i <= 8; i += 1) fired.push(detector.tick());
  assert.deepEqual(fired, [false, false, false, false, true, false, false, false]);
  assert.equal(detector.stalled, true);
  assert.equal(detector.maxIdleTicks, 5);
  detector.progress();
  assert.equal(detector.tick(), false, '멈춤 판정은 되돌리지 않는다');
  assert.equal(detector.stalled, true);
});

test('판정기·감시자: 한도와 틱은 1 이상의 정수만 받아요', () => {
  for (const bad of [0, -1, 1.5, Number.NaN, '5', undefined]) {
    assert.throws(() => createStallDetector(bad), RangeError);
    assert.throws(() => watchProgress(fakeChild(), { tickMs: bad, stallTicks: 5 }), RangeError);
    // spawn 전에 던져야 고아 자식이 안 남는다 (동기 throw = spawn 에 닿지 않음).
    for (const timing of [{ tickMs: bad, stallTicks: 5 }, { tickMs: 20, stallTicks: bad }]) {
      assert.throws(() => runWithProgressWatchdog(process.execPath, ['-e', ''], timing), RangeError);
    }
  }
});

/** 같은 이벤트 루프 안의 가짜 자식 — kill() 하면 신호 종료처럼 'close' 를 낸다. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    setImmediate(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };
  return child;
}

test('배선: 틱보다 촘촘히 출력하면 총 시간이 창의 몇 배여도 안 죽이고 출력을 다 받아요', async () => {
  const child = fakeChild();
  const watched = watchProgress(child, { tickMs: 20, stallTicks: 5 });
  let n = 0;
  // 방출 간격(5 ms)이 틱(20 ms)보다 짧다. 타이머 해상도가 거칠어도(Windows 약 15.6 ms)
  // 둘이 같은 루프에서 같이 밀리므로, 방출 없이 틱만 5 번 연속 오는 일은 없다.
  const emitter = setInterval(() => {
    (n % 2 === 0 ? child.stdout : child.stderr).write(n % 2 === 0 ? '.' : 'e');
    n += 1;
    if (n === 100) {
      clearInterval(emitter);
      setImmediate(() => child.emit('close', 0, null));
    }
  }, 5);
  const result = await watched;
  assert.equal(child.killed, false);
  assert.equal(result.stalled, false);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '.'.repeat(50), 'stdout 이 진행으로 셌다');
  assert.equal(result.stderr, 'e'.repeat(50), 'stderr 도 진행으로 셌다');
  assert.ok(result.ticks >= 3 * 5, `총 틱 ${result.ticks} — 창(5 틱)의 3 배 넘게 돌았어야 이 경우가 의미 있다`);
});

test('배선: 출력이 끊기면 한도 틱째에 kill 하고 stalled·status null 로 끝나요', async () => {
  const child = fakeChild();
  const watched = watchProgress(child, { tickMs: 10, stallTicks: 5 });
  child.stdout.write('..');
  const result = await watched;
  assert.equal(child.killed, true);
  assert.equal(result.stalled, true);
  assert.equal(result.status, null);
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(result.stdout, '..');
  assert.equal(result.maxIdleTicks, 5);
});

// 실제 자식은 «kill 이 실제로 듣는다» 만 잰다. 기동 중에 죽든 출력 뒤에 죽든 멈춤은 멈춤이다.
for (const [label, source] of [
  ['무한 루프(CPU 를 태우는 멈춤)', "process.stdout.write('.');for(;;){}"],
  ['교착(CPU 를 안 쓰는 멈춤)', "process.stdout.write('.');setInterval(()=>{},1<<30);"],
]) {
  test(`실제 자식: ${label} 이면 죽이고 stalled 로 끝나요`, async () => {
    const result = await runWithProgressWatchdog(process.execPath, ['-e', source], {
      tickMs: 20, stallTicks: 5,
    });
    assert.equal(result.stalled, true);
    assert.equal(result.status, null, '감시자가 죽였으니 exit status 가 없다');
  });
}

test('실제 자식: 정상 종료는 멈춤이 아니고 exit status 와 출력을 그대로 넘겨요', async () => {
  // 창은 넉넉히(깨어 있는 20 초) — 기동 시간이 부하로 늘어도 이 경우를 흔들지 않게.
  const source = "process.stdout.write('...');process.stderr.write('끝');process.exitCode=3;";
  const result = await runWithProgressWatchdog(process.execPath, ['-e', source], {
    tickMs: 50, stallTicks: 400,
  });
  assert.equal(result.stalled, false);
  assert.equal(result.status, 3);
  assert.equal(result.stdout, '...');
  assert.equal(result.stderr, '끝');
});

test('전제: 반복 타이머는 막힌 루프 뒤 밀린 틱을 몰아 쏘지 않아요 (틱 수 ≈ 깨어 있는 시간)', async () => {
  // 절전·루프 정지 구간이 «무진행 틱» 으로 쌓이지 않는다는 감시자의 전제.
  // 몰아 쏘기라면 300 ms 정지 동안 10 ms 틱이 30 개 이상 쌓인다. 부하는 틱을 줄일 뿐 늘리지 못한다.
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 10);
  const until = Date.now() + 300;
  while (Date.now() < until) { /* 루프를 막는다 */ }
  await new Promise((resolve) => setTimeout(resolve, 50));
  clearInterval(timer);
  assert.ok(ticks <= 10, `막힌 300 ms 뒤 50 ms 동안 틱 ${ticks} — 몰아 쏘기면 30+`);
});
