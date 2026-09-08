import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from 'node:inspector';
import { createCAdapters } from '../src/r2/adapter-c.js';
import { syntheticC, copyField, callDetect, observeAll } from './r2-c-fixtures.js';

test('C seed/anchor 풀 공존·origin/age 보존·마지막 가설까지 공정 진행', () => {
  const run = observeAll(syntheticC().field), rows = run.rows;
  assert.ok(rows.some(row => row.observation.sourceKind === 'c-central-n7-seed'));
  assert.ok(rows.some(row => row.observation.sourceKind === 'c-central-n7-anchor'));
  const first = rows[0].observation;
  assert.equal(first.originFrameId, 0); assert.equal(first.originTimestamp, 0);
  assert.equal(first.ageFrames, rows[0].frameId); assert.equal(first.ageMs, rows[0].frameId);
  assert.equal(run.adapter.stats.resumeCursor.index, run.adapter.stats.resumeCursor.total);
  assert.ok(run.adapter.stats.resumeCursor.steps > 1000, '작은 자만으로 실물 크기 경로를 대신하지 않아요');
});

test('C 동일 버퍼 내용만 교체해도 origin 계산은 불변·옛 H 현재 사용 금지', () => {
  const original = syntheticC().field, field = copyField(original), adapter = createCAdapters(), out = {};
  callDetect(adapter, field, 0, out);
  const bytes = adapter.stats.snapshotBytes;
  field.data.fill(1); if (field.alpha) field.alpha.fill(0);
  let frame = 1, published = 0;
  for (; frame < 500000 && adapter.stats.discarded === 0 && !adapter.stats.scanComplete; frame++) {
    callDetect(adapter, field, frame, out); published += out.found;
  }
  assert.equal(published, 0); assert.equal(adapter.stats.discarded, 1);
  assert.ok(adapter.stats.hypothesesTried > 0, 'live buffer 별칭이면 origin의 n7 양성을 잃어요');
  assert.equal(adapter.stats.snapshotBytes, bytes); assert.equal(adapter.stats.snapshotRetainedBytes, 0);
  assert.equal(out.H, null); assert.equal(adapter.stats.resumeCursor, null);
  assert.equal(adapter.stats.locked, 0);
});

test('C 재개 중 이동·교체 뒤 낡은 H 없음', () => {
  for (const change of ['move', 'replace']) {
    const field = copyField(syntheticC().field), adapter = createCAdapters(), out = {};
    callDetect(adapter, field, 0);
    if (change === 'replace') field.data.set(syntheticC(0, 'REPLACED').field.data);
    else {
      const old = field.data.slice(); field.data.fill(1);
      for (let y = 0; y < field.height - 24; y++) field.data.set(old.subarray(y * field.width, (y + 1) * field.width), (y + 24) * field.width);
    }
    let count = 0;
    for (let i = 1; i < 500000 && adapter.stats.discarded === 0 && !adapter.stats.scanComplete; i++) { callDetect(adapter, field, i, out); count += out.found; }
    assert.equal(count, 0); assert.equal(adapter.stats.discarded, 1); assert.equal(out.H, null);
  }
});

for (const trigger of ['resize', 'generation', 'invalidateLock', 'reset']) test(`C 커서 ${trigger} 즉시 폐기·새 origin`, () => {
  const field = copyField(syntheticC().field), adapter = createCAdapters();
  callDetect(adapter, field, 0, {}, 0, { generation: 'old' });
  const oldCopy = adapter.stats.snapshotBytes;
  if (trigger === 'invalidateLock' || trigger === 'reset') adapter[trigger]();
  else if (trigger === 'generation') callDetect(adapter, field, 1, {}, 1, { generation: 'new' });
  else callDetect(adapter, { width: 16, height: 16, data: new Float32Array(256) }, 1);
  assert.equal(adapter.stats.discarded, 1); assert.equal(adapter.stats.locked, 0);
  if (trigger === 'reset' || trigger === 'invalidateLock') {
    assert.equal(adapter.stats.resumeCursor, null); assert.equal(adapter.stats.snapshotRetainedBytes, 0);
  } else {
    assert.equal(adapter.stats.resumeCursor.originFrameId, 1);
    assert.equal(adapter.stats.resumeCursor.steps, 1); assert.ok(adapter.stats.snapshotBytes > oldCopy);
  }
});

test('C 폐기된 관측 토큰을 보관해도 실제 스냅샷·finder·H 참조를 해제한다', async () => {
  const run = observeAll(syntheticC().field), row = run.rows[0];
  const post = (session, method, params = {}) => new Promise((resolve, reject) => session.post(method, params,
    (error, result) => error ? reject(error) : resolve(result)));
  const session = new Session(), scripts = [], flag = '__tlcubeCObservationCleanupProbe';
  assert.equal(Object.hasOwn(globalThis, flag), false);
  session.connect(); session.on('Debugger.scriptParsed', ({ params }) => scripts.push(params));
  try {
    await post(session, 'Debugger.enable');
    const script = scripts.find(s => s.url === new URL('../src/r2/adapter-c.js', import.meta.url).href);
    assert.ok(script);
    const { scriptSource } = await post(session, 'Debugger.getScriptSource', { scriptId: script.scriptId });
    const at = scriptSource.indexOf('function bindCandidate(observation, format) {'); assert.ok(at >= 0);
    const fields = ['snapshot', 'finder', 'H', 'notch'];
    const point = await post(session, 'Debugger.setBreakpoint', {
      location: { scriptId: script.scriptId, lineNumber: scriptSource.slice(0, at).split('\n').length - 1, columnNumber: 0 },
      condition: `globalThis[${JSON.stringify(flag)}] = [${fields.map(field => `observations.get(observation).${field} === null`).join(',')}, observationRecords.size], false`,
    });
    try {
      const candidate = run.adapter.bindCandidate(row.observation, row.format); assert.ok(candidate);
      assert.deepEqual(globalThis[flag].slice(0, 4), [false, false, false, false]);
      assert.ok(globalThis[flag][4] > 0);
      run.adapter.invalidateLock(); delete globalThis[flag];
      assert.equal(run.adapter.bindCandidate(row.observation, row.format), null);
      assert.deepEqual(globalThis[flag], [true, true, true, true, 0]);
    } finally { await post(session, 'Debugger.removeBreakpoint', { breakpointId: point.breakpointId }); }
  } finally { delete globalThis[flag]; session.disconnect(); }
});
