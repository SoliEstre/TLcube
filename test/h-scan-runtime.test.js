import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeH } from '../src/h-codec.js';
import { H_FACE_IDS } from '../src/h-profile.js';
import { createHCollector } from '../src/h-collector.js';
import { detectH } from '../src/h-detect.js';
import {
  createHScanRuntime, hHitToDecodeResult, isVerifiedHDecodeResult, createHCompositeEngine,
} from '../src/h-scan-runtime.js';
import { resultAutoOpen, urlOriginOf } from '../src/scanner-url-result.js';
import { buildHScene, hAutoRotation } from '../src/h-render.js';
import { rasterize } from '../src/raster.js';
import { relativeLuminance8 } from '../src/luminance.js';

function dummyH() {
  return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

function observationsFrom(encoded) {
  return Object.entries(encoded.faces).map(([face, levels]) => ({
    ok: true,
    version: encoded.version,
    n: encoded.n,
    mode: encoded.mode,
    finder: encoded.finder,
    tones: encoded.tones,
    ecc: encoded.ecc,
    mask: encoded.mask,
    routeId: encoded.routeId,
    face,
    levels: levels.slice(),
    H: dummyH(),
    quad: [{ x: 1, y: 1 }, { x: 10, y: 1 }, { x: 10, y: 10 }, { x: 1, y: 10 }],
    rotation: 0,
    mirror: false,
    hamming: 0,
    quality: { score: 0.9, refGap: 0.2, refSpread: 0.01, dataMargin: 0.08, knownRatio: 1 },
  }));
}

function fakeDetect(encoded) {
  return () => ({ ok: true, faces: observationsFrom(encoded), rejected: [], stats: { elapsedMs: 0, components: 1, capped: false } });
}

function field(n = 16) {
  return { width: n, height: n, data: new Float32Array(n * n).fill(0.5) };
}

function yStub() {
  const calls = [];
  let enabled = true;
  let stats = { frames: 0, progressD: 0, indicator: 'searching' };
  return {
    calls,
    pushFrame(fieldArg, timestamp, options) {
      calls.push({ type: 'push', field: fieldArg, timestamp, options });
      stats = { ...stats, frames: stats.frames + 1 };
      return null;
    },
    reset() { calls.push({ type: 'reset' }); },
    setEnabled(flag) { enabled = flag === true; calls.push({ type: 'setEnabled', flag }); },
    invalidateLock() { calls.push({ type: 'invalidateLock' }); },
    get enabled() { return enabled; },
    get stats() { return { ...stats }; },
    get view() { return { profile: 'Y', n: 25 }; },
    get hudCandidates() { return [{ id: 'y1', type: 'Y' }]; },
    get accepted() { return null; },
  };
}

function rasterField(scene, ppu = 12) {
  const raster = rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 });
  const data = new Float32Array(raster.width * raster.height);
  for (let i = 0, o = 0; i < data.length; i += 1, o += 4) {
    data[i] = relativeLuminance8(raster.pixels[o], raster.pixels[o + 1], raster.pixels[o + 2]);
  }
  return { width: raster.width, height: raster.height, data };
}

function assertNoPayload(stats) {
  const blob = JSON.stringify(stats);
  assert.equal(blob.includes('"text"'), false);
  assert.equal(blob.includes('"bytes"'), false);
  assert.equal(blob.includes('"levels"'), false);
}

test('3F 한 프레임 전면 관측이 원문을 복원해요', () => {
  const encoded = encodeH('hello', { version: 1, mode: 3, mask: 0 });
  const runtime = createHScanRuntime({ detect: fakeDetect(encoded), coldIntervalMs: 0, activeIntervalMs: 0 });
  const hit = runtime.pushFrame(field(), 1000, { frameId: 'a', force: true });
  assert.equal(hit.kind, 'h');
  assert.equal(hit.profile, 'H');
  assert.equal(hit.type, 'H');
  assert.equal(hit.text, 'hello');
  assert.equal(hit.layoutId, 'h-v2-3f');
  assert.equal(hit.mode, 3);
  assert.ok(hit.bytes instanceof Uint8Array);
  const adapted = hHitToDecodeResult(hit);
  assert.equal(adapted.source, 'h');
  assert.notEqual(adapted.source, 'r2');
  assert.equal(adapted.payload, 'hello');
  assert.equal(adapted.hSummary.profile, 'H');
  assertNoPayload(runtime.stats);
});

test('6F 한 프레임 전면 관측이 원문을 복원해요', () => {
  const encoded = encodeH('world', { version: 1, mode: 6, mask: 0 });
  const runtime = createHScanRuntime({ detect: fakeDetect(encoded), coldIntervalMs: 0, activeIntervalMs: 0 });
  const hit = runtime.pushFrame(field(), 1, { frameId: 1, force: true });
  assert.equal(hit.text, 'world');
  assert.equal(hit.layoutId, 'h-v2-6f');
  assert.equal(hit.mode, 6);
});

test('H2/H4/H5 frame·corners 완료는 v2f/v2fc layout과 identity-verified URL 권한을 보존해요', () => {
  const url = 'https://tl.example/h-mode';
  for (const mode of [2,4,5]) for (const finder of ['frame','corners']) {
    const version = finder === 'corners' ? 7 : 2;
    const encoded = encodeH(url, { version, mode, tones: 3, ecc: 'M', mask: 3, finder });
    const runtime = createHScanRuntime({ detect: fakeDetect(encoded), coldIntervalMs: 0, activeIntervalMs: 0 });
    const hit = runtime.pushFrame(field(), mode, { frameId: finder + '-' + mode, force: true });
    assert.equal(hit.layoutId, 'h-' + (finder === 'corners' ? 'v2fc' : 'v2f') + '-' + mode + 'f');
    assert.equal(new TextDecoder().decode(hit.bytes), url);
    const result = hHitToDecodeResult(hit);
    assert.equal(result.payload, url);
    assert.equal(isVerifiedHDecodeResult(result), true);
    const provenance = { isVerifiedHResult: isVerifiedHDecodeResult };
    assert.equal(urlOriginOf(result, provenance), 'tl');
    assert.equal(resultAutoOpen(result, provenance), true);
    assert.equal(resultAutoOpen({ ...result }, provenance), false, 'object clone must lose WeakSet authority');
  }
});

test('같은 frameId와 역순 timestamp를 무시하거나 새 세션으로 리셋해요', () => {
  const encoded = encodeH('dup', { version: 1, mode: 3, mask: 0 });
  let calls = 0;
  const detect = () => { calls += 1; return fakeDetect(encoded)(); };
  const runtime = createHScanRuntime({ detect, coldIntervalMs: 0, activeIntervalMs: 0 });
  const first = runtime.pushFrame(field(), 10, { frameId: 'f', force: true });
  assert.equal(first.text, 'dup');
  const again = runtime.pushFrame(field(), 10, { frameId: 'f', force: true });
  assert.equal(calls, 1);
  assert.equal(again.text, 'dup');
  const reversed = runtime.pushFrame(field(), 1, { frameId: 'g', force: true });
  assert.equal(calls, 2);
  assert.equal(reversed.text, 'dup');
});

test('cold/active cadence와 force', () => {
  const encoded = encodeH('cad', { version: 1, mode: 3, mask: 0 });
  let calls = 0;
  const detect = () => { calls += 1; return fakeDetect(encoded)(); };
  const runtime = createHScanRuntime({
    detect, coldIntervalMs: 200, activeIntervalMs: 100,
  });
  runtime.pushFrame(field(), 0, { frameId: '0' });
  assert.equal(calls, 1);
  runtime.pushFrame(field(), 50, { frameId: '1' });
  assert.equal(calls, 1);
  runtime.pushFrame(field(), 50, { frameId: '2', force: true });
  assert.equal(calls, 2);
  runtime.pushFrame(field(), 160, { frameId: '3' });
  assert.equal(calls, 3);
});

test('TTL 90초 뒤 수집이 비어요', () => {
  const encoded = encodeH('ttl', { version: 1, mode: 3, mask: 0 });
  let calls=0;
  const runtime = createHScanRuntime({ detect: ()=>++calls===1?fakeDetect(encoded)():{faces:[]}, coldIntervalMs: 0, activeIntervalMs: 0 });
  runtime.pushFrame(field(), 0, { frameId: 't0', force: true });
  assert.equal(runtime.stats.state, 'DONE');
  runtime.pushFrame(field(20), 90_001, { frameId: 't1', force: true });
  assert.equal(runtime.stats.state,'EMPTY');assert.equal(runtime.stats.count,0);
});

test('reset/setEnabled/invalidateLock이 기하만 지우고 정본 수집은 유지해요', () => {
  const encoded = encodeH('keep', { version: 1, mode: 3, mask: 0 });
  const collector = createHCollector();
  const runtime = createHScanRuntime({
    detect: fakeDetect(encoded), collector, coldIntervalMs: 0, activeIntervalMs: 0,
  });
  runtime.pushFrame(field(), 5, { frameId: 'k', force: true });
  assert.equal(runtime.stats.observedFaces.length, 3);
  assert.equal(runtime.stats.state, 'DONE');
  runtime.invalidateLock();
  assert.equal(runtime.stats.observedFaces.length, 0);
  assert.equal(runtime.stats.observedAt, null);
  assert.equal(runtime.stats.state, 'DONE');
  assert.equal(collector.snapshot().state, 'DONE');
  runtime.reset();
  assert.equal(runtime.stats.state, 'EMPTY');
  runtime.setEnabled(false);
  assert.equal(runtime.pushFrame(field(), 9, { frameId: 'off' }), null);
  runtime.setEnabled(true);
  assert.equal(runtime.stats.state, 'EMPTY');
});

test('서로 다른 크기 필드는 세션을 유지해요', () => {
  const encoded = encodeH('size', { version: 1, mode: 3, mask: 0 });
  const faces = observationsFrom(encoded);
  let step = 0;
  const detect = () => {
    const obs = [faces[step % 3]];
    step += 1;
    return { ok: true, faces: obs, rejected: [], stats: { elapsedMs: 0, components: 1, capped: false } };
  };
  const runtime = createHScanRuntime({ detect, coldIntervalMs: 0, activeIntervalMs: 0 });
  runtime.pushFrame(field(16), 1, { frameId: 's1', force: true });
  runtime.pushFrame(field(32), 2, { frameId: 's2', force: true });
  runtime.pushFrame(field(48), 3, { frameId: 's3', force: true });
  assert.equal(runtime.stats.count, 3);
  assert.equal(runtime.stats.state, 'DONE');
});

test('H 예외는 Y를 깨지 않아요', () => {
  const y = yStub();
  const hRuntime = createHScanRuntime({
    detect: () => { throw new Error('boom'); },
    coldIntervalMs: 0, activeIntervalMs: 0,
  });
  const engine = createHCompositeEngine({ yEngine: y, hRuntime });
  const hit = engine.pushFrame(field(), 3, { frameId: 'e' });
  assert.equal(hit, null);
  assert.equal(y.calls.filter((c) => c.type === 'push').length, 1);
  assert.ok(String(hRuntime.stats.lastError).includes('boom'));
});

test('H가 없으면 Y에 같은 인자를 그대로 전달해요', () => {
  const y = yStub();
  const hRuntime = createHScanRuntime({
    detect: () => ({ ok: false, faces: [], rejected: [], stats: { elapsedMs: 1, components: 0, capped: false } }),
    coldIntervalMs: 0, activeIntervalMs: 0,
  });
  const engine = createHCompositeEngine({ yEngine: y, hRuntime });
  const f = field();
  engine.pushFrame(f, 7, { frameId: 'fwd', ownedInput: true });
  const push = y.calls.find((c) => c.type === 'push');
  assert.equal(push.field, f);
  assert.equal(push.timestamp, 7);
  assert.equal(push.options.frameId, 'fwd');
  assert.equal(push.options.ownedInput, true);
});

test('확정 H 관측 500ms 안에는 Y를 건너뛰고 이후 재개해요', () => {
  const encoded = encodeH('skip', { version: 1, mode: 3, mask: 0 });
  const y = yStub();
  let calls=0;
  const hRuntime = createHScanRuntime({ detect: ()=>++calls===1?fakeDetect(encoded)():{faces:[]}, coldIntervalMs: 0, activeIntervalMs: 0 });
  const engine = createHCompositeEngine({ yEngine: y, hRuntime });
  const hHit = engine.pushFrame(field(), 1000, { frameId: 'h1', force: true });
  assert.equal(hHit.text, 'skip');
  assert.equal(engine.stats.h.lastConfirmedAt,1000);
  assert.equal(y.calls.filter((c) => c.type === 'push').length, 0);
  engine.pushFrame(field(), 1400, { frameId: 'h2', force: true });
  assert.equal(y.calls.filter((c) => c.type === 'push').length, 0);
  engine.pushFrame(field(), 1600, { frameId: 'h3', force: true });
  assert.equal(y.calls.filter((c) => c.type === 'push').length, 1);
  assert.ok(engine.stats.hSkippedY >= 2);
  assert.equal(engine.stats.progressD, 0);
  assert.equal(engine.view.profile, 'Y');
  assert.equal(engine.hudCandidates[0].type, 'Y');
  engine.invalidateLock();assert.equal(engine.stats.h.lastConfirmedAt,null);
});

test('stats는 text/bytes/levels를 숨기고 변이 누출이 없어요', () => {
  const encoded = encodeH('hide', { version: 1, mode: 3, mask: 0 });
  const runtime = createHScanRuntime({ detect: fakeDetect(encoded), coldIntervalMs: 0, activeIntervalMs: 0 });
  const hit = runtime.pushFrame(field(), 4, { frameId: 'm', force: true });
  const stats = runtime.stats;
  stats.state = 'HACK';
  stats.observedFaces.push({ face: 'ZZ' });
  hit.text = 'mutated';
  assert.equal(runtime.stats.state, 'DONE');
  assert.equal(runtime.stats.observedFaces.some((row) => row.face === 'ZZ'), false);
  const again = runtime.pushFrame(field(), 5, { frameId: 'm2', force: true });
  assert.equal(again.text, 'hide');
  assertNoPayload(runtime.stats);
  assert.ok(!('levels' in runtime.stats.observedFaces[0]));
});

test('실 회전 프레임이 6면 식별과 원문을 모아요', () => {
  const encoded = encodeH('H', { version: 0, mode: 6, tones: 3, ecc: 'M', mask: 0 });
  const y = yStub();
  const engine = createHCompositeEngine({
    yEngine: y,
    hRuntime: createHScanRuntime({ detect: detectH, coldIntervalMs: 0, activeIntervalMs: 0 }),
  });
  const seen = new Set();
  let payload = null;
  for (let t = 0; t < 48000; t += 3000) {
    const fieldArg = rasterField(buildHScene(encoded, { ...hAutoRotation(t), perspective: 0.18 }), 12);
    const hit = engine.pushFrame(fieldArg, t, { frameId: `r${t}`, force: true });
    for (const row of engine.stats.h.observedFaces) seen.add(row.face);
    if (hit?.kind === 'h' && hit.text === 'H') payload = hit.text;
  }
  assert.equal(seen.size, 6);
  for (const id of H_FACE_IDS) assert.ok(seen.has(id));
  assert.equal(payload, 'H');
  const adapted = hHitToDecodeResult(engine.accepted);
  assert.equal(adapted?.source, 'h');
});
