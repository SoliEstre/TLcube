import test from 'node:test';
import assert from 'node:assert/strict';
import { createR2TypeExpansionRuntime } from '../src/r2/type-expansion-runtime.js';

const field = { width: 1, height: 1, data: new Float32Array([1]) };
function fixtures({ yCounts = [0], cCount = 0, cubeCount = 0, cMs = 0, cubeMs = 0,
  yDone = false, cDone = false, cubeDone = false, budget = 10, maxCandidates = 8,
  maxHudCandidates = Infinity, yHudCount = 1 } = {}) {
  let clock = 0, reserve = null;
  const order = [], totals = [];
  function service(name, count, cost, done) {
    const stats = { candidateCount: count, observations: 0 }, calls = [], capacityCalls = [];
    let deferred = 0;
    return { stats, calls, capacityCalls, hudCandidates: [{ id: `${name}-own` }],
      get deferred() { return deferred; },
      setCapacity(cap) { capacityCalls.push(cap); stats.candidateCount = Math.min(stats.candidateCount, cap); },
      reset() { stats.candidateCount = 0; calls.length = 0; },
      deferFrame() { deferred++; },
      pushFrame(_field, timestamp, options) {
        assert.ok(stats.candidateCount <= options.maxCandidates);
        calls.push({ timestamp, ...options }); order.push(name); clock += cost;
        return done ? { text: `${name} winner`, profile: name === 'C' ? 'C' : 'Y', candidateId: `${name}-own` } : null;
      } };
  }
  const c = service('C', cCount, cMs, cDone), cube = service('Y3D', cubeCount, cubeMs, cubeDone);
  const y = { enabled: true, view: {}, hudCandidates: Array.from({ length: yHudCount }, (_, i) => ({ id: i === 0 ? 'Y-own' : `Y-shelf-${i}` })),
    stats: { frames: 0, candidateCount: yCounts[0], locked: 0, lockDistrusted: true, format: { source: 'default' }, progressD: 0 },
    setCandidateReservation(fn) { fn(this.stats.candidateCount); reserve = fn; },
    setEnabled(v) { this.enabled = v; },
    reset() { this.stats.frames = 0; this.stats.candidateCount = 0; },
    invalidateLock() { return 1; },
    pushFrame() {
      const count = yCounts[Math.min(this.stats.frames, yCounts.length - 1)];
      reserve(count); this.stats.candidateCount = count;
      totals.push(count + c.stats.candidateCount + cube.stats.candidateCount);
      this.stats.frames++;
      return yDone ? { text: 'Y winner', candidateId: 'Y-own' } : null;
    } };
  const runtime = createR2TypeExpansionRuntime({ yRuntime: y, cRuntime: c, cubeYRuntime: cube,
    maxCandidates, maxHudCandidates, maxTrustedFrames: 3, maxStalledFrames: 10, maxAdditionalMs: budget, now: () => clock });
  return { runtime, y, c, cube, totals, order };
}

test('세 런타임의 실제 후보 합산 상한은 Y 생성 전에 예약돼요', () => {
  const f = fixtures({ yCounts: [1, 5], cCount: 4, cubeCount: 3 });
  f.runtime.pushFrame(field, 0); f.runtime.pushFrame(field, 100);
  assert.deepEqual(f.totals, [8, 8]);
  assert.equal(f.runtime.expansionStats.totalCandidateCount, 8);
  assert.equal(f.runtime.expansionStats.cCandidateCount + f.runtime.expansionStats.cubeYCandidateCount, 3);
  for (const row of f.c.calls) assert.ok(row.maxCandidates >= f.c.stats.candidateCount);
  assert.equal(f.runtime.stats, f.y.stats); assert.equal(f.runtime.view, f.y.view);
});

test('C/3D 실행 순서를 교대하고 같은 프레임에 각각 한 번만 실행해요', () => {
  const f = fixtures();
  f.runtime.pushFrame(field, 0); f.runtime.pushFrame(field, 100);
  assert.deepEqual(f.order, ['C', 'Y3D', 'Y3D', 'C']);
  assert.deepEqual(f.c.calls.map(r => r.frameId), [1, 2]);
  assert.deepEqual(f.cube.calls.map(r => r.frameId), [1, 2]);
  assert.equal(f.runtime.expansionStats.cTries, 2); assert.equal(f.runtime.expansionStats.cubeYTries, 2);
});

test('추가 soft 예산을 넘긴 원자 작업은 기록하고 다음 서비스는 다음 프레임에 먼저 실행해요', () => {
  const f = fixtures({ cMs: 12, cubeMs: 12, budget: 10 });
  f.runtime.pushFrame(field, 0);
  assert.deepEqual(f.order, ['C']); assert.equal(f.cube.deferred, 1);
  assert.equal(f.runtime.expansionStats.framesSinceCubeYTry, 1);
  f.runtime.pushFrame(field, 100);
  assert.deepEqual(f.order, ['C', 'Y3D']); assert.equal(f.c.deferred, 1);
  assert.equal(f.runtime.expansionStats.framesSinceCTry, 1);
  assert.equal(f.runtime.expansionStats.additionalBudgetHits, 2);
  assert.equal(f.runtime.expansionStats.additionalBudgetOverrunMs, 4);
  assert.equal(f.runtime.expansionStats.maxAdditionalUnitMs, 12);
  assert.equal(f.runtime.expansionStats.lastAdditionalMs, 12);
  assert.equal(f.c.calls[0].budgetMs, 10); assert.equal(f.cube.calls[0].budgetMs, 10);
});

test('먼저 실행된 실제 DONE만 반환하고 다른 확장 서비스는 실행하지 않아요', () => {
  const f = fixtures({ cDone: true, cubeDone: true });
  const first = f.runtime.pushFrame(field, 0);
  assert.equal(first.text, 'C winner'); assert.equal(first.frame, 0);
  assert.deepEqual(f.order, ['C']);
  const next = f.runtime.pushFrame(field, 100);
  assert.equal(next.text, 'Y3D winner'); assert.equal(next.profile, 'Y'); assert.equal(next.frame, 1);
  assert.deepEqual(f.order, ['C', 'Y3D']);
  assert.equal(f.runtime.expansionStats.lastWinner, 'Y3D');
});

test('기존 Y DONE은 두 확장 서비스보다 먼저 수용돼요', () => {
  const f = fixtures({ yDone: true, cDone: true, cubeDone: true });
  assert.equal(f.runtime.pushFrame(field, 0).text, 'Y winner');
  assert.deepEqual(f.order, []);
  assert.equal(f.runtime.expansionStats.lastWinner, 'Y');
});

test('HUD 합집합은 각 생산자의 행을 그대로 내고 원본 배열을 변경하지 않아요', () => {
  const f = fixtures();
  const rows = f.runtime.hudCandidates;
  assert.deepEqual(rows.map(r => r.id), ['Y-own', 'C-own', 'Y3D-own']);
  assert.equal(rows[0], f.y.hudCandidates[0]); assert.equal(rows[1], f.c.hudCandidates[0]);
  assert.notEqual(rows, f.y.hudCandidates); assert.notEqual(rows, f.c.hudCandidates);
  f.c.hudCandidates.push({ id: 'C-accepted' });
  assert.ok(f.runtime.hudCandidates.some(r => r.id === 'C-accepted'));
});

test('disable/reset/invalidate는 확장 후보와 스케줄 상태를 함께 비워요', () => {
  const f = fixtures({ yCounts: [1], cCount: 2, cubeCount: 2 });
  f.runtime.pushFrame(field, 0);
  f.runtime.setEnabled(false);
  assert.equal(f.c.stats.candidateCount + f.cube.stats.candidateCount, 0);
  assert.equal(f.runtime.pushFrame(field, 100), null);
  assert.equal(f.runtime.expansionStats.cubeYTries, 0);
  f.runtime.setEnabled(true); f.runtime.pushFrame(field, 200);
  assert.equal(f.runtime.invalidateLock(), 1);
  assert.equal(f.runtime.expansionStats.cubeYTries, 0);
  f.runtime.reset(); assert.equal(f.runtime.expansionStats.frames, 0);
});

test('상한 또는 예산을 가장하는 잘못된 소켓은 즉시 거부해요', () => {
  assert.throws(() => fixtures({ budget: 0 }), TypeError);
  assert.throws(() => fixtures({ maxCandidates: 0 }), TypeError);
  assert.throws(() => fixtures({ maxHudCandidates: 7 }), TypeError);
});

test('Y 활성5+보존5는 그대로 두고 추가 후보를2개까지 허용해 HUD12칸을 지켜요', () => {
  const f = fixtures({ yCounts: [5], cCount: 2, cubeCount: 1, yHudCount: 10, maxHudCandidates: 12 });
  f.runtime.pushFrame(field, 0);
  assert.equal(f.y.hudCandidates.length, 10, '보존 Y 증거를 버리지 않아요');
  assert.equal(f.c.stats.candidateCount + f.cube.stats.candidateCount, 2);
  assert.equal(f.runtime.expansionStats.totalCandidateCount, 7);
  for (const call of f.c.calls) assert.equal(call.maxCandidates, 1);
  for (const call of f.cube.calls) assert.equal(call.maxCandidates, 1);
  f.y.hudCandidates.length = 5;
  f.runtime.pushFrame(field, 100);
  assert.equal(f.c.calls.at(-1).maxCandidates, 2, '선반이 비면 활성 K까지 여유를 다시 줘요');
  assert.equal(f.cube.calls.at(-1).maxCandidates, 2);
});

test('한 서비스 DONE 뒤 나머지는 같은 프레임의 실행과 HUD defer 모두 건너뛰어요', () => {
  const f = fixtures({ cDone: true });
  f.runtime.pushFrame(field, 0);
  assert.deepEqual(f.order, ['C']);
  assert.equal(f.cube.deferred, 0);
  assert.equal(f.runtime.expansionStats.cubeYDeferredFrames, 0);
});
