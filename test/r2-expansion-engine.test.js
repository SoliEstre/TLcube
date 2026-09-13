import test from 'node:test';
import assert from 'node:assert/strict';
import { createR2ExpansionEngine, R2_ENGINE_SCHEDULING_INTERNALS } from '../src/r2-expansion-engine.js';
import { renderPlanar } from './helpers/r2-planar-fixture.js';
import { syntheticC } from './r2-c-fixtures.js';
import { renderCubeY } from './helpers/r2-cube-y-fixture.js';
import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';

test('reset·토글·입력 불연속은 이전 세션 telemetry를 현재 값으로 남기지 않아요', () => {
  const engine = createR2ExpansionEngine({ enabled: true });
  const field = { width: 8, height: 8, data: new Float32Array(64).fill(.5) };
  const empty = () => {
    const stats = engine.stats;
    for (const key of ['frames', 'totalMs', 'lastTotalMs', 'lastCopyMs', 'lastYMs', 'lastExtraMs', 'lastBudgetMs',
      'deadlineMisses', 'overrunMs', 'maxTotalMs', 'fairnessLoans', 'maxServiceDelayFrames',
      'cubeYColdProbeServices', 'cubeYPriorityServices', 'cubeYMaxServiceGapFrames',
      'candidateCount', 'retainedYCount', 'progressD']) assert.equal(stats[key], 0, key);
    for (const key of ['source', 'lastError', 'inputFrameId']) assert.equal(stats[key], null, key);
    assert.equal(engine.accepted, null); assert.deepEqual(engine.hudCandidates, []);
  };
  engine.pushFrame(field, 1); assert.equal(engine.stats.frames, 1);
  engine.reset(); empty();
  engine.pushFrame(field, 2); engine.setEnabled(false); empty();
  engine.setEnabled(true); empty();
  engine.pushFrame(field, 10); engine.pushFrame(field, 9);
  assert.equal(engine.stats.frames, 1); assert.equal(engine.stats.inputFrameId, 9);
  engine.pushFrame({ width: 9, height: 8, data: new Float32Array(72).fill(.5) }, 11);
  assert.equal(engine.stats.frames, 1); assert.equal(engine.stats.inputFrameId, 11);
});

test('invalidate 직후 Y retained HUD는 보존하고 폐기한 extra 집계는 제거해요', () => {
  const yRow = { id: 'y', type: 'Y', n: 13, alive: true, tracking: true, retained: false, D: .2 };
  const y = { stats: { candidateCount: 1, locked: 1, progressD: .2, indicator: 1, phaseMs: {} },
    view: { n: 13 }, hudCandidates: [yRow], reset() {}, setEnabled() {}, pushFrame() { return null; },
    invalidateLock() { this.stats.locked = 0; yRow.tracking = false; yRow.retained = true; return 1; } };
  const makeLane = id => ({ stats: { candidateCount: 1, progressD: .8, indicator: 2 },
    pushFrame() { return null; }, deferFrame() {}, setCapacity() {},
    reset() { this.stats.candidateCount = 0; this.stats.progressD = 0; },
    get hudCandidates() { return this.stats.candidateCount ? [{ id, type: 'K', alive: true, D: .8 }] : []; } });
  const engine = createR2ExpansionEngine({ enabled: true, candidateScope: 'all', yRuntime: y,
    cRuntime: makeLane('c'), planarRuntime: makeLane('p'), cubeRuntime: makeLane('cube') });
  engine.pushFrame({ width: 8, height: 8, data: new Float32Array(64).fill(.5) }, 1);
  assert.equal(engine.stats.candidateCount, 4); assert.equal(engine.stats.progressD, .8);
  assert.equal(engine.invalidateLock(), 1);
  assert.deepEqual(engine.hudCandidates.map(row => [row.id, row.tracking, row.retained]), [['y', false, true]]);
  assert.equal(engine.stats.candidateCount, 1); assert.equal(engine.stats.progressD, .2);
  assert.equal(engine.stats.source, 'Y'); assert.equal(engine.stats.indicator, 1);
  assert.ok(engine.stats.lanes.every(lane => lane.stats.candidateCount === 0));
  assert.equal(engine.accepted, null);
});

test('진전 중인 Y는 새 획득을 유예하지만16입력 안에 다른 관측에도 기회를 줘요', () => {
  const makeLane=()=>({stats:{candidateCount:0,progressD:0},calls:0,reset(){},setCapacity(){},deferFrame(){},
    pushFrame(){this.calls++;return null;},get hudCandidates(){return [];}});
  const lanes=[makeLane(),makeLane(),makeLane()];
  const y={stats:{candidateCount:1,locked:1,progressD:0,phaseMs:{}},frames:0,view:{},hudCandidates:[],
    reset(){},setEnabled(){},pushFrame(){this.frames++;this.stats.progressD+=.001;return null;}};
  const engine=createR2ExpansionEngine({enabled:true,candidateScope:'all',yRuntime:y,cRuntime:lanes[0],planarRuntime:lanes[1],cubeRuntime:lanes[2]});
  const field={width:8,height:8,data:new Float32Array(64).fill(.5)};
  for(let frame=0;frame<15;frame++)engine.pushFrame(field,frame);
  assert.equal(y.frames,15);assert.deepEqual(lanes.map(l=>l.calls),[0,0,0]);
  engine.pushFrame(field,15);
  assert.equal(y.frames,16);assert.deepEqual(lanes.map(l=>l.calls),[1,1,1]);
});

function stalledLoanHarness(t, { laneCounts = [0, 0, 0], advancingInputs = 2, yFrameMs = null } = {}) {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const events = [], field = { width: 8, height: 8, data: new Float32Array(64).fill(.5) };
  const makeLane = (id, candidateCount) => ({ stats: { candidateCount, progressD: 0 }, adapters: { stats: { resumeCursor: null } }, calls: 0,
    reset() { this.stats.candidateCount = 0; }, setCapacity() {}, deferFrame() {},
    pushFrame() { this.calls++; events.push(id); return this.hit ?? null; }, get hudCandidates() { return []; } });
  const lanes = [makeLane('C', laneCounts[0]), makeLane('planar', laneCounts[1]), makeLane('y-faces', laneCounts[2])];
  const y = { stats: { candidateCount: 1, locked: 1, progressD: 0, phaseMs: {} }, inputs: 0,
    view: {}, hudCandidates: [], reset() { this.inputs = 0; this.stats.progressD = 0; }, setEnabled() {},
    pushFrame() {
      events.push('Y'); this.inputs++;
      if (this.inputs <= advancingInputs) this.stats.progressD++;
      // live 후보가 있으면 observed 24ms, 없으면 기본 12ms를 모두 사용해 post-Y 순서가 섞이지 않게 해요.
      now += yFrameMs ?? (lanes.some(lane => lane.stats.candidateCount > 0) ? 24 : 12);
      return this.hitAt === this.inputs ? this.hit : null;
    } };
  const engine = createR2ExpansionEngine({ enabled: true, candidateScope: 'all', yRuntime: y,
    cRuntime: lanes[0], planarRuntime: lanes[1], cubeRuntime: lanes[2] });
  return { engine, events, field, lanes, y };
}

test('잠긴 Y가 네 입력 동안 D 진전을 멈추면 live lane 하나를 Y 전에만 service해요', t => {
  const { engine, events, field, lanes, y } = stalledLoanHarness(t);
  engine.pushFrame(field, 1); engine.pushFrame(field, 2); // 마지막 D 진전은 ordinal 2예요.
  lanes[0].stats.candidateCount = 1;
  for (let stamp = 3; stamp <= 5; stamp++) engine.pushFrame(field, stamp);
  assert.deepEqual(events, ['Y', 'Y', 'Y', 'Y', 'Y'], '세 입력 정체까지는 Y가 먼저예요');
  engine.pushFrame(field, 6);
  assert.deepEqual(events.slice(-2), ['C', 'Y'], '넷째 정체 입력에서는 기존 live C를 Y 전에 service해요');
  assert.equal(lanes[0].calls, 1); assert.equal(y.inputs, 6, 'loan이 있어도 모든 입력은 Y에 전달해요');
  assert.equal(engine.stats.fairnessLoans, 1);
});

test('잠긴 Y 정체에서 fake Y가 예산을 모두 써도 empty lane은16~18입력 안에 한 번 service해요', t => {
  const { engine, events, field, lanes, y } = stalledLoanHarness(t);
  for (let stamp = 1; stamp <= 18; stamp++) engine.pushFrame(field, stamp);
  assert.deepEqual(events.filter(event => event !== 'Y'), ['C', 'planar', 'y-faces']);
  assert.deepEqual(lanes.map(lane => lane.calls), [1, 1, 1]);
  assert.equal(y.inputs, 18); assert.equal(engine.stats.fairnessLoans, 3);
});

test('잠긴 Y 정체의 여러 live loan은 oldest-first로 돌고 유한 입력 안에 모두 service해요', t => {
  const { engine, events, field, lanes } = stalledLoanHarness(t);
  engine.pushFrame(field, 1); engine.pushFrame(field, 2);
  for (const lane of lanes) lane.stats.candidateCount = 1;
  for (let stamp = 3; stamp <= 8; stamp++) engine.pushFrame(field, stamp);
  assert.deepEqual(events.filter(event => event !== 'Y'), ['C', 'planar', 'y-faces']);
  assert.deepEqual(lanes.map(lane => lane.calls), [1, 1, 1]);
  assert.equal(engine.stats.fairnessLoans, 3);
});

test('동일 입력의 pre-loan hit와 Y hit가 함께 있으면 기존대로 Y를 채택해요', t => {
  const { engine, events, field, lanes, y } = stalledLoanHarness(t);
  engine.pushFrame(field, 1); engine.pushFrame(field, 2);
  lanes[0].stats.candidateCount = 1;
  lanes[0].hit = { candidateId: 'c', profile: 'C', text: 'C' };
  y.hitAt = 6; y.hit = { candidateId: 'y', profile: 'Y', text: 'Y' };
  for (let stamp = 3; stamp <= 6; stamp++) engine.pushFrame(field, stamp);
  assert.deepEqual(events.slice(-2), ['C', 'Y']);
  assert.equal(engine.accepted.profile, 'Y'); assert.equal(engine.accepted.text, 'Y');
});

test('reset 뒤에는 이전 세션의 마지막 Y D 진전이 stalled-loan 판정을 막지 않아요', t => {
  const { engine, events, field, lanes } = stalledLoanHarness(t);
  engine.pushFrame(field, 1); engine.pushFrame(field, 2);
  engine.reset(); events.length = 0; lanes[0].stats.candidateCount = 1;
  engine.pushFrame(field, 3);
  assert.deepEqual(events, ['C', 'Y'], '새 세션은 이전 lastYAdvanceOrdinal을 보유하면 안 돼요');
});

test('Y의 D 진전이 다시 시작되면 다음 세 입력은 pre-loan 없이 Y에 집중해요', t => {
  const { engine, events, field, lanes, y } = stalledLoanHarness(t);
  const originalPush = y.pushFrame.bind(y);
  y.pushFrame = function () {
    const hit = originalPush();
    if (this.inputs === 7) this.stats.progressD++;
    return hit;
  };
  engine.pushFrame(field, 1); engine.pushFrame(field, 2);
  lanes[0].stats.candidateCount = 1;
  for (let stamp = 3; stamp <= 7; stamp++) engine.pushFrame(field, stamp);
  assert.equal(lanes[0].calls, 2);
  events.length = 0;
  for (let stamp = 8; stamp <= 10; stamp++) engine.pushFrame(field, stamp);
  assert.deepEqual(events, ['Y', 'Y', 'Y']);
  assert.equal(lanes[0].calls, 2);
  engine.pushFrame(field, 11);
  assert.deepEqual(events.slice(-2), ['C', 'Y']);
  assert.equal(lanes[0].calls, 3); assert.equal(y.inputs, 11);
});

test('정체한 locked Y는 pending C hypotheses와 cq-refine을 넷째 입력에 Y 전에 service해요', t => {
  const { engine, events, field, lanes, y } = stalledLoanHarness(t, { yFrameMs: 24 });
  for (const cursor of [{ phase: 'hypotheses', index: 0, total: 1 }, { phase: 'cq-refine' }]) {
    engine.reset(); events.length = 0; lanes[0].calls = 0; lanes[0].adapters.stats.resumeCursor = null;
    engine.pushFrame(field, 1); engine.pushFrame(field, 2);
    lanes[0].adapters.stats.resumeCursor = cursor; events.length = 0;
    for (let stamp = 3; stamp <= 6; stamp++) engine.pushFrame(field, stamp);
    assert.deepEqual(events, ['Y', 'Y', 'Y', 'C', 'Y'], cursor.phase);
    assert.equal(lanes[0].calls, 1); assert.equal(y.inputs, 6, `${cursor.phase}: Y 입력을 건너뛰면 안 돼요`);
  }
});

test('complete·exhausted hypotheses·shared-n7 C cursor는16입력 전 pending pre-loan 대상이 아니에요', t => {
  const { engine, events, field, lanes, y } = stalledLoanHarness(t, { yFrameMs: 24 });
  for (const cursor of [{ phase: 'complete' }, { phase: 'hypotheses', index: 1, total: 1 }, { phase: 'shared-n7' }]) {
    engine.reset(); events.length = 0; lanes[0].calls = 0; lanes[0].adapters.stats.resumeCursor = null;
    engine.pushFrame(field, 1); engine.pushFrame(field, 2);
    lanes[0].adapters.stats.resumeCursor = cursor; events.length = 0;
    for (let stamp = 3; stamp <= 6; stamp++) engine.pushFrame(field, stamp);
    assert.deepEqual(events, ['Y', 'Y', 'Y', 'Y'], cursor.phase);
    assert.equal(lanes[0].calls, 0); assert.equal(y.inputs, 6, `${cursor.phase}: Y 입력을 건너뛰면 안 돼요`);
  }
});

test('Y D가 계속 진전하면 pending C도 pre-loan으로 실행하지 않아요', t => {
  const { engine, events, field, lanes, y } = stalledLoanHarness(t, { advancingInputs: Infinity, yFrameMs: 24 });
  engine.pushFrame(field, 1); engine.pushFrame(field, 2);
  lanes[0].adapters.stats.resumeCursor = { phase: 'hypotheses', index: 0, total: 1 }; events.length = 0;
  for (let stamp = 3; stamp <= 6; stamp++) engine.pushFrame(field, stamp);
  assert.deepEqual(events, ['Y', 'Y', 'Y', 'Y']);
  assert.equal(lanes[0].calls, 0); assert.equal(y.inputs, 6);
});

test('전체 좌석이 찼을 때 빈 lane이 기존 후보의 Y 이전 서비스 기회를 가로채지 않아요', t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const makeLane = count => ({ stats: { candidateCount: count, progressD: 0 }, calls: 0,
    reset() {}, setCapacity() {}, deferFrame() {}, pushFrame() { this.calls++; return null; },
    get hudCandidates() { return []; } });
  const lanes = [makeLane(0), makeLane(0), makeLane(8)];
  const y = { stats: { candidateCount: 0, locked: 0, progressD: 0, phaseMs: {} }, frames: 0,
    view: {}, hudCandidates: [], reset() {}, setEnabled() {}, pushFrame() {
      this.frames++; now += 1; // Y만으로 시험 예산을 모두 쓰는 결정적 가상 시계.
      return null;
    } };
  const engine = createR2ExpansionEngine({ enabled: true, candidateScope: 'all', budgetMs: .25, maxCandidates: 8, yRuntime: y,
    cRuntime: lanes[0], planarRuntime: lanes[1], cubeRuntime: lanes[2] });
  const field = { width: 8, height: 8, data: new Float32Array(64).fill(.5) };
  for (let frame = 0; frame < 8; frame++) engine.pushFrame(field, frame);
  assert.equal(y.frames, 8, 'Y 입력을 생략하면 안 돼요');
  assert.deepEqual(lanes.map(lane => lane.calls), [0, 0, 2], '네 입력마다 실행 가능한 후보 소유자를 서비스해야 해요');
});

test('기본 목표는 C 관측 상태에만 따라 바뀌고 명시적 예산·초기화는 보존한다', t => {
  t.mock.method(performance, 'now', () => 0);
  const field = { width: 8, height: 8, data: new Float32Array(64).fill(.5) };
  function setup(budgetMs) {
    const make = () => ({ stats: { candidateCount: 0, progressD: 0 },
      adapters: { stats: { resumeCursor: null } },
      reset() { this.stats.candidateCount = 0; this.adapters.stats.resumeCursor = null; },
      setCapacity() {}, deferFrame() {}, pushFrame() { return null; }, get hudCandidates() { return []; } });
    const c = make(), planar = make(), cube = make();
    const y = { stats: { candidateCount: 0, locked: 0, progressD: 0, phaseMs: {} },
      view: {}, hudCandidates: [], reset() {}, setEnabled() {}, invalidateLock() { return 1; }, pushFrame() { return null; } };
    const engine = createR2ExpansionEngine({ enabled: true, candidateScope: 'all',
      ...(budgetMs === undefined ? {} : { budgetMs }),
      yRuntime: y, cRuntime: c, planarRuntime: planar, cubeRuntime: cube });
    return { engine, c, planar, cube };
  }
  for (const fixed of [undefined, .25, 14, 64]) {
    const { engine, c, planar, cube } = setup(fixed);
    let stamp = 0;
    const check = expected => { engine.pushFrame(field, stamp++); assert.equal(engine.stats.lastBudgetMs, expected); };
    check(fixed ?? 11);
    for (const phase of ['shared-n7', 'extra', 'complete']) {
      c.adapters.stats.resumeCursor = { phase }; check(fixed ?? 11);
    }
    for (const phase of ['hypotheses', 'cq-refine']) {
      c.adapters.stats.resumeCursor = { phase, index: 0, total: 1 }; check(fixed ?? 24);
    }
    for (const [index, total] of [[0, 0], [1, 1]]) {
      c.adapters.stats.resumeCursor = { phase: 'hypotheses', index, total }; check(fixed ?? 11);
    }
    c.adapters.stats.resumeCursor = null;
    planar.stats.candidateCount = 1; cube.stats.candidateCount = 1; check(fixed ?? 11);
    c.stats.candidateCount = 1; check(fixed ?? 24);
    c.stats.candidateCount = 0; check(fixed ?? 11);
    c.stats.candidateCount = 1; engine.reset(); assert.equal(engine.stats.lastBudgetMs, 0); check(fixed ?? 11);
    c.adapters.stats.resumeCursor = { phase: 'hypotheses', index: 0, total: 1 }; engine.invalidateLock(); check(fixed ?? 11);
    c.stats.candidateCount = 1; engine.pushFrame(field, -1); assert.equal(engine.stats.lastBudgetMs, fixed ?? 11);
    c.stats.candidateCount = 1;
    engine.pushFrame({ width: 9, height: 8, data: new Float32Array(72).fill(.5) }, stamp++);
    assert.equal(engine.stats.lastBudgetMs, fixed ?? 11, '리사이즈 전에 있던 C 관측의 큰 예산이 새 크기로 새면 안 돼요');
    engine.reset();
  }
});

test('미완료 공유 획득을 우선해도 다른 광학 lane은 유한 간격으로 서비스한다',()=>{
  const make=id=>({id,lastService:0,runtime:{stats:{candidateCount:0},adapters:{stats:{resumeCursor:{phase:'shared-n7'}}}}});
  const lanes=['C','planar','y-faces'].map(make),last={C:0,planar:0,'y-faces':0};
  let next=0;
  for(let frame=1;frame<=64;frame++){
    const order=R2_ENGINE_SCHEDULING_INTERNALS.extraServiceOrder(lanes,next,frame,true);
    assert.equal(new Set(order).size,lanes.length);
    const first=order[0];first.lastService=frame;last[first.id]=frame;next=(next+1)%3;
    if(frame>=17)for(const id of ['planar','y-faces'])assert.ok(frame-last[id]<=16,id+'가 영구 굶으면 안 돼요');
  }
  const rr=[lanes[1],lanes[2],lanes[0]];
  assert.deepEqual(R2_ENGINE_SCHEDULING_INTERNALS.extraServiceOrder(lanes,1,65,false),rr);
  for(const phase of ['hypotheses','cq-refine','extra']){
    lanes[0].runtime.adapters.stats.resumeCursor.phase=phase;
    lanes.forEach(lane=>lane.lastService=64);
    assert.equal(R2_ENGINE_SCHEDULING_INTERNALS.extraServiceOrder(lanes,1,65,false)[0],lanes[0],
      '공유 검출 뒤 관측 검증까지 같은 유한 획득 작업이에요');
  }
  lanes[0].runtime.adapters.stats.resumeCursor.phase='complete';
  assert.deepEqual(R2_ENGINE_SCHEDULING_INTERNALS.extraServiceOrder(lanes,1,65,false),rr);
  lanes[0].runtime.adapters.stats.resumeCursor.phase='shared-n7';
  lanes[1].runtime.stats.candidateCount=1;
  assert.deepEqual(R2_ENGINE_SCHEDULING_INTERNALS.extraServiceOrder(lanes,1,65,true),rr,
    '이미 살아 있는 다른 후보의 누적은 공유 획득 우선순위로 밀면 안 돼요');
});

for (const [type, style] of [['O','cell'], ['A','n7'], ['V','bullseye'], ['K','qr'], ['C','n7'], ['Y','y-faces']]) {
  test(`${type === 'Y' ? '기본 Y 전용' : '개발용 all opt-in'} 엔진 ${type}/${style} 실제 관측→RS`, t => {
    const fixture = type === 'C' ? syntheticC(0, 'engine-C')
      : type === 'Y' ? renderCubeY('ENGINE-Y3D-CROSS-TYPE') : renderPlanar(type, { style, text: `engine-${type}` });
    const engine = createR2ExpansionEngine({ enabled: true, ...(type === 'Y' ? {} : { candidateScope: 'all' }) });
    let hit = null;
    for (let frame = 0; frame < 480 && !hit; frame++) {
      hit = engine.pushFrame(fixture.field, frame * 100, { frameId: frame });
      assert.equal(engine.stats.lastError, null);
      assert.ok(engine.stats.candidateCount <= 12);
    }
    const stats = engine.stats;
    t.diagnostic(JSON.stringify({ type, style, hit, frames: stats.frames, totalMs: stats.totalMs,
      maxTotalMs: stats.maxTotalMs, fairnessLoans: stats.fairnessLoans, pool: stats.sharedCentralN7,
      lanes: stats.lanes.map(lane => ({ id: lane.id, calls: lane.calls, serviceMs: lane.serviceMs, stats: lane.stats, observation: lane.observation })) }));
    assert.ok(hit, `${type}/${style}: 전체 엔진의 실제 복호가 없어요`);
    assert.equal(hit.text, fixture.text); assert.equal(hit.profile, type);
    if (style === 'y-faces') {
      assert.equal(engine.hudCandidates.find(row => row.id === hit.candidateId)?.geometryMode, 'y-faces',
        '기존 평면Y 경로의 성공으로3D 관측 회귀를 대신할 수 없어요');
    }
    engine.reset(); assert.equal(engine.hudCandidates.length, 0);
    assert.equal(engine.stats.sharedCentralN7.retainedBytes, 0);
  });
}

test('카메라와 같은 소수점 timestamp 기본 ID도 처리하고 동일 프레임은 중복하지 않아요', () => {
  const engine = createR2ExpansionEngine({enabled:true});
  const field = {width:16,height:16,data:new Float32Array(256).fill(.5)};
  engine.pushFrame(field,123.456); assert.equal(engine.stats.frames,1);
  engine.pushFrame(field,123.456); assert.equal(engine.stats.frames,1);
  engine.pushFrame(field,123.457); assert.equal(engine.stats.frames,2);
  engine.reset();
});

test('엔진 off는 입력 복사/탐색이 없고 reset·토글은 후보/공유수명을 버려요', () => {
  const engine = createR2ExpansionEngine();
  assert.equal(engine.pushFrame(null, NaN), null); assert.equal(engine.stats.frames, 0);
  engine.setEnabled(true);
  const field = { width: 16, height: 16, data: new Float32Array(256).fill(.5) };
  engine.pushFrame(field, 1); assert.equal(engine.stats.frames, 1);
  const generation = engine.stats.generation;
  engine.setEnabled(false);
  assert.ok(engine.stats.generation > generation); assert.equal(engine.stats.candidateCount, 0);
  assert.equal(engine.stats.sharedCentralN7.retainedBytes, 0);
});

test('잘못된 candidateScope는 거부해요', () => {
  assert.throws(() => createR2ExpansionEngine({ candidateScope: 'c' }), TypeError);
  assert.throws(() => createR2ExpansionEngine({ candidateScope: '' }), TypeError);
});

test('기본 candidateScope y는 C/planar/sharedN7을 만들지 않고 Y-grid와 y-faces만 남겨요', () => {
  const options = { enabled: true };
  Object.defineProperty(options, 'cRuntime', { get() { throw new Error('cRuntime poison'); } });
  Object.defineProperty(options, 'planarRuntime', { get() { throw new Error('planarRuntime poison'); } });
  let yPushes = 0, faceCalls = 0;
  options.yRuntime = { stats: { candidateCount: 0, locked: 0, progressD: 0, phaseMs: {}, indicator: 0 },
    view: {}, hudCandidates: [{ id: 'y-grid', type: 'Y', alive: true, D: 0 }],
    reset() {}, setEnabled() {}, pushFrame() { yPushes++; return null; } };
  options.cubeRuntime = { stats: { candidateCount: 0, progressD: 0 }, calls: 0,
    reset() {}, setCapacity() {}, deferFrame() {},
    pushFrame() { faceCalls++; this.calls++; return null; }, get hudCandidates() { return []; } };
  const engine = createR2ExpansionEngine(options);
  assert.equal(engine.stats.candidateScope, 'y');
  assert.deepEqual(engine.stats.lanes.map(lane => lane.id), ['y-faces']);
  assert.equal(engine.stats.sharedCentralN7.retainedBytes, 0);
  assert.equal(engine.stats.sharedCentralN7.jobs, 0);
  engine.pushFrame({ width: 8, height: 8, data: new Float32Array(64).fill(.5) }, 1);
  assert.equal(yPushes, 1);
  assert.equal(faceCalls, 1);
  assert.equal(engine.hudCandidates.some(row => row.id === 'y-grid'), true);
});

function cubePriorityHarness(t, yFrameMs = 250) {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const events = [], received = [];
  const cube = { stats: { candidateCount: 0, progressD: 0, acquisitionPhase: 'idle' },
    reset() { this.stats.candidateCount = 0; this.stats.acquisitionPhase = 'idle'; },
    setCapacity() {}, deferFrame() {}, get hudCandidates() { return []; },
    pushFrame(field, timestamp, control) {
      events.push(`cube:${control.frameId}`); received.push({ field, timestamp, ...control });
      return this.hit ?? null;
    } };
  const y = { stats: { candidateCount: 1, locked: 1, progressD: 0, phaseMs: {} },
    view: {}, hudCandidates: [], inputs: 0, advance: true,
    reset() { this.inputs = 0; this.stats.progressD = 0; }, setEnabled() {},
    pushFrame(field, timestamp) {
      events.push(`Y:${timestamp}`); this.inputs++; if (this.advance) this.stats.progressD += .001;
      now += yFrameMs; return this.hit ?? null;
    } };
  const engine = createR2ExpansionEngine({ enabled: true, budgetMs: 11, yRuntime: y, cubeRuntime: cube });
  const field = { width: 8, height: 8, data: new Float32Array(64).fill(.5) };
  return { cube, y, engine, field, events, received };
}

test('Y 전용은 긴 Y-grid 검출에도 네 입력 안에 cube cold 탐색을 시작해요', t => {
  const { engine, y, field, events, received } = cubePriorityHarness(t);
  y.stats.locked = 0; y.stats.candidateCount = 0;
  for (let stamp = 1; stamp <= 4; stamp++) engine.pushFrame(field, stamp, { frameId: stamp });
  assert.deepEqual(events, ['Y:1', 'Y:2', 'Y:3', 'cube:4', 'Y:4']);
  assert.equal(y.inputs, 4);
  assert.equal(received.length, 1); assert.equal(received[0].runDetect, true);
  assert.equal(received[0].serviceBudgetMs, 11); assert.equal(received[0].budgetMs, 11);
  assert.equal(engine.stats.cubeYColdProbeServices, 1); assert.equal(engine.stats.cubeYPriorityServices, 0);
});

for (const state of ['acquiring', 'live']) {
  test(`Y 미획득 중 ${state} cube는 모든 최신 frame을 Y-grid 전에 한 번씩 받아요`, t => {
    const { engine, cube, y, field, events, received } = cubePriorityHarness(t);
    y.stats.locked = 0; y.stats.candidateCount = 0;
    if (state === 'acquiring') cube.stats.acquisitionPhase = 'geometry';
    else cube.stats.candidateCount = 1;
    for (let stamp = 1; stamp <= 5; stamp++) {
      field.data[0] = stamp / 10;
      engine.pushFrame(field, stamp, { frameId: stamp });
    }
    assert.deepEqual(events, [1, 2, 3, 4, 5].flatMap(stamp => [`cube:${stamp}`, `Y:${stamp}`]));
    assert.equal(y.inputs, 5); assert.deepEqual(received.map(row => row.frameId), [1, 2, 3, 4, 5]);
    received.forEach((row, index) => {
      assert.ok(Math.abs(row.field.data[0] - (index + 1) / 10) < 1e-6);
      assert.equal(row.runDetect, true); assert.equal(row.serviceBudgetMs, 11);
    });
    assert.equal(engine.stats.cubeYPriorityServices, 5);
    assert.equal(engine.stats.cubeYMaxServiceGapFrames, 1);
    assert.equal(engine.stats.fairnessLoans, 0);
  });
}

for (const state of ['acquiring', 'live']) {
  test(`건강한 Y-grid는 ${state} cube보다 먼저이고 진전 정체 4입력째부터 선서비스를 재개해요`, t => {
    const { engine, cube, y, field, events } = cubePriorityHarness(t);
    if (state === 'acquiring') cube.stats.acquisitionPhase = 'geometry';
    else cube.stats.candidateCount = 1;
    for (let stamp = 1; stamp <= 6; stamp++) engine.pushFrame(field, stamp);
    assert.deepEqual(events, ['cube:1', 'Y:1', 'Y:2', 'Y:3', 'Y:4', 'Y:5', 'Y:6']);
    assert.equal(y.inputs, 6);
    events.length = 0; y.advance = false;
    for (let stamp = 7; stamp <= 10; stamp++) engine.pushFrame(field, stamp);
    assert.deepEqual(events, ['Y:7', 'Y:8', 'Y:9', 'cube:10', 'Y:10']);
    assert.equal(y.inputs, 10); assert.equal(engine.stats.cubeYPriorityServices, 2);
  });
}

test('Y 전용 선행 cube hit와 Y-grid hit가 겹쳐도 Y 우선 계약은 유지해요', t => {
  const { engine, cube, y, field } = cubePriorityHarness(t);
  cube.stats.candidateCount = 1; cube.hit = { candidateId: 'cube', profile: 'Y', text: 'cube' };
  y.hit = { candidateId: 'grid', profile: 'Y', text: 'grid' };
  assert.equal(engine.pushFrame(field, 1).text, 'grid');
  assert.equal(y.inputs, 1);
});

test('빠른 Y 뒤의 여유 예산은 cold 탐색에 쓰고 active cube는 같은 입력에서 중복 서비스하지 않아요', t => {
  const { engine, cube, y, field, events, received } = cubePriorityHarness(t, 1);
  y.stats.locked = 0; y.stats.candidateCount = 0;
  engine.pushFrame(field, 1, { frameId: 1 });
  assert.deepEqual(events, ['Y:1', 'cube:1']);
  assert.equal(received[0].serviceBudgetMs, 10); assert.equal(received[0].runDetect, true);
  cube.stats.acquisitionPhase = 'geometry'; events.length = 0;
  engine.pushFrame(field, 2, { frameId: 2 });
  assert.deepEqual(events, ['cube:2', 'Y:2']); assert.equal(received.length, 2);
  assert.equal(engine.stats.cubeYPriorityServices, 1); assert.equal(y.inputs, 2);
});

test('기본 Y 전용 전체 엔진은 저장 Y-grid 시퀀스의 참 격자·본문을 그대로 복호해요', t => {
  const seq = listLumaSequences().find(row => row.name.split('/').pop() === 'y2');
  if (!seq) { t.skip('저장 휘도 덤프 없음 — 배포 후보 검증에서는 skip 0이 필수예요'); return; }
  assert.ok(seq && seq.frames.length >= 12, '필수 Y-grid 회귀 시퀀스 12프레임이 없어요');
  const engine = createR2ExpansionEngine({ enabled: true });
  let hit = null;
  for (let frame = 0; frame < 12 && !hit; frame++) {
    hit = engine.pushFrame(readLumaDump(seq.frames[frame].path), frame * 100, { frameId: frame });
  }
  assert.ok(hit, '기본 엔진의 Y-grid가 12프레임 안에 복호되지 않았어요');
  assert.equal(hit.text, 'https://tl.estre.so'); assert.equal(hit.layoutId, 'v0tr');
  assert.equal(engine.hudCandidates.find(row => row.id === hit.candidateId)?.geometryMode, 'y-grid');
  assert.deepEqual(engine.stats.lanes.map(row => row.id), ['y-faces']);
});

test('Y 전용 active 큐브의16ms 목표는 기존 Y 진전·cold·명시적 예산을 바꾸지 않아요', t => {
  t.mock.method(performance, 'now', () => 0);
  const field = { width: 8, height: 8, data: new Float32Array(64).fill(.5) };
  for (const fixed of [undefined, .25, 11, 24]) {
    let advance = false;
    const cube = { stats: { candidateCount: 0, progressD: 0, acquisitionPhase: 'idle' },
      reset() { this.stats.candidateCount = 0; this.stats.acquisitionPhase = 'idle'; },
      setCapacity() {}, deferFrame() {}, pushFrame() { return null; }, get hudCandidates() { return []; } };
    const y = { stats: { candidateCount: 0, locked: 0, progressD: 0, phaseMs: {} },
      view: {}, hudCandidates: [], setEnabled() {},
      reset() { this.stats.locked = 0; this.stats.progressD = 0; },
      pushFrame() { if (advance) this.stats.progressD += .01; return null; } };
    const engine = createR2ExpansionEngine({ enabled: true, yRuntime: y, cubeRuntime: cube,
      ...(fixed === undefined ? {} : { budgetMs: fixed }) });
    let stamp = 0;
    const check = expected => { engine.pushFrame(field, ++stamp); assert.equal(engine.stats.lastBudgetMs, fixed ?? expected); };
    check(11);
    cube.stats.acquisitionPhase = 'geometry'; check(16);
    cube.stats.acquisitionPhase = 'idle'; cube.stats.candidateCount = 1; check(16);
    y.stats.locked = 1; y.stats.candidateCount = 1; advance = true;
    check(16); check(11);
    advance = false; check(11); check(11); check(11); check(16);
    engine.reset(); check(11);
  }
});
