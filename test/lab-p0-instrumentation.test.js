/*
 * lab-p0-instrumentation.test.js — 시험판 P0 계측 계약.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { eventRow, parseEnvelope, thumbnailRow } from '../relay/protocol.mjs';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  MAX_SHOTS,
  buildCauseChain,
  createLabTelemetry,
  createShotSampler,
  createStageClock,
  emptyConfigSide,
  extractGeometry,
  fillFrameMs,
  makeAttemptId,
  makeConfigId,
  makeEnvelope,
  normalizeFrameBody,
  normalizeGenBody,
  observedFromResult,
} from '../src/lab-telemetry.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SQL = readFileSync(ROOT + 'relay/schema.sql', 'utf8');
const MIG = readFileSync(ROOT + 'deploy/estre-so/clickhouse/002_tl_lab_p0_instrumentation.sql', 'utf8');
const MIG_AB = readFileSync(ROOT + 'deploy/estre-so/clickhouse/003_tl_lab_cellsurface_ab.sql', 'utf8');
const MIG_ZOOM = readFileSync(ROOT + 'deploy/estre-so/clickhouse/004_tl_lab_zoom.sql', 'utf8');

function memoryStore() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

class FakeWS {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this._listeners = { open: [], close: [], error: [] };
    FakeWS.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      for (const fn of this._listeners.open) fn();
    });
  }
  addEventListener(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  }
  send(data) { this.sent.push(String(data)); }
  close() { this.readyState = 3; }
}
FakeWS.instances = [];

function labOpts(over = {}) {
  return {
    site: 'scan',
    location: { pathname: '/lab/', protocol: 'https:', host: 'tlscan.estre.so' },
    sessionStorage: memoryStore(),
    localStorage: memoryStore(),
    WebSocket: FakeWS,
    ...over,
  };
}

function tinyImage() {
  return { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(120) };
}

function schemaColumns(table) {
  const start = SQL.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  const open = SQL.indexOf('(', start);
  const close = SQL.indexOf('\n)', open);
  return SQL.slice(open + 1, close)
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0].replace(/,$/, ''))
    .filter((name) => /^[a-z_]+$/.test(name));
}

test('attempt ID 는 한 시도에서 안정적이고 다음 시도에서 바뀐다', async () => {
  FakeWS.instances = [];
  const tel = createLabTelemetry(labOpts());
  const first = tel.beginAttempt('attempt-one');
  assert.equal(first, 'attempt-one');
  tel.frame({
    seq: 1, w: 10, h: 10, zoom: 1, stage: 'proposal', ok: false, reason: 'frontend:no-finder',
    ms: fillFrameMs(4, { proposal: 4 }),
  });
  tel.frame({
    seq: 2, w: 10, h: 10, zoom: 1, stage: 'proposal', ok: false, reason: 'frontend:no-finder',
    ms: fillFrameMs(5, { proposal: 5 }),
  });
  const second = tel.beginAttempt('attempt-two');
  assert.equal(second, 'attempt-two');
  assert.notEqual(first, second);
  tel.frame({
    seq: 1, w: 10, h: 10, zoom: 1, stage: 'proposal', ok: false, reason: 'frontend:no-finder',
    ms: fillFrameMs(6, { proposal: 6 }),
  });
  await new Promise((r) => setTimeout(r, 30));
  const frames = FakeWS.instances[0].sent.slice(1).map((line) => JSON.parse(line))
    .filter((ev) => ev.kind === 'frame');
  assert.equal(frames[0].body.attempt_id, 'attempt-one');
  assert.equal(frames[1].body.attempt_id, 'attempt-one');
  assert.equal(frames[2].body.attempt_id, 'attempt-two');
  assert.notEqual(makeAttemptId(() => 1, () => 0.1), makeAttemptId(() => 2, () => 0.2));
});

test('config ID 는 결정적이고 expected/observed 미상은 null', () => {
  const a = makeConfigId({ type: 'Y', version: 2, ecc: 'M', tones: 3 });
  const b = makeConfigId({ tones: 3, ecc: 'M', version: 2, type: 'Y' });
  const c = makeConfigId({ type: 'Y', version: 3, ecc: 'M', tones: 3 });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(makeConfigId({}), null);
  const gen = normalizeGenBody({ type: 'O', version: 1, ecc: 'L', payload: 'secret' });
  assert.equal(gen.config_id, makeConfigId(gen));
  assert.equal(gen.payload, undefined);
  const frame = normalizeFrameBody({
    seq: 1, w: 8, h: 8, ok: false, reason: 'frontend:no-finder',
    expected: emptyConfigSide(),
    observed: observedFromResult({ ok: false, reason: 'frontend:no-finder' }),
  });
  for (const key of ['type', 'version', 'ecc', 'tones', 'finderPatternId', 'qrPosition', 'locatorProfile', 'locatorArm']) {
    assert.equal(frame.expected[key], null);
    assert.equal(frame.observed[key], null);
  }
  assert.equal(frame.config_id, null);
});

test('기존 reason 호환 + 원인 사슬 순서·미상', () => {
  const noFinder = buildCauseChain({ ok: false, reason: 'frontend:no-finder' });
  assert.deepEqual(noFinder.stages.map((row) => row.stage), [
    'input-quality', 'proposal', 'finder', 'geometry', 'sample', 'format', 'body',
  ]);
  assert.equal(noFinder.failed, 'finder');
  assert.equal(noFinder.stages[0].status, 'reached');
  assert.equal(noFinder.stages[2].status, 'failed');
  assert.equal(noFinder.stages[3].status, 'unknown');
  assert.equal(noFinder.stages[3].reason, null);

  const ok = buildCauseChain({ ok: true, family: 'cube' });
  assert.ok(ok.stages.every((row) => row.status === 'reached'));
  assert.equal(ok.failed, null);

  const opaque = buildCauseChain({ ok: false, reason: 'decode-threw:boom' });
  assert.equal(opaque.failed, null);
  assert.equal(opaque.stages.find((row) => row.stage === 'body').status, 'unknown');

  const framed = normalizeFrameBody({
    seq: 1, w: 8, h: 8, ok: false, reason: 'frontend:no-finder', chain: noFinder,
  });
  assert.equal(framed.reason, 'frontend:no-finder');
  assert.equal(framed.chain.failed, 'finder');
});

test('단계 시간은 total 복사본이 아니며 합·경계가 계약에 맞다', () => {
  let t = 100;
  const clock = createStageClock(() => t);
  clock.onStage('proposal', 'enter');
  t = 140;
  clock.onStage('proposal', 'leave');
  clock.onStage('format', 'enter');
  t = 155;
  clock.onStage('format', 'leave');
  clock.onStage('decode', 'enter');
  t = 175;
  clock.onStage('decode', 'leave');
  const snap = clock.snapshot();
  assert.equal(snap.proposal, 40);
  assert.equal(snap.format, 15);
  assert.equal(snap.decode, 20);
  assert.equal(snap.verify, null);
  const ms = fillFrameMs(80, snap);
  assert.equal(ms.total, 80);
  assert.notEqual(ms.proposal, ms.total);
  assert.notEqual(ms.format, ms.total);
  assert.equal(ms.verify, null);
  const sum = ms.proposal + ms.format + ms.decode;
  assert.ok(sum <= ms.total);
  assert.equal(fillFrameMs(12, { proposal: 12 }).proposal, 12);
});

test('bbox/corners/occupancy/rotation/perspective/cellPx 단위와 nullable 직렬화', () => {
  const empty = extractGeometry({ ok: false, reason: 'frontend:no-finder' }, 100, 80);
  assert.equal(empty.bbox, null);
  assert.equal(empty.corners, null);
  assert.equal(empty.occupancy, null);
  assert.equal(empty.rotationDeg, null);
  assert.equal(empty.perspective, null);
  assert.equal(empty.residualPx, null);
  assert.equal(empty.cellPx, null);

  const corners = [
    { x: 10, y: 10 }, { x: 90, y: 12 }, { x: 88, y: 70 }, { x: 12, y: 68 },
  ];
  const geo = extractGeometry({
    ok: true,
    hypothesis: {
      vertices: corners,
      rotationDegrees: 120,
      geometryResidual: 1.4,
      cellSizePx: 11.2,
    },
  }, 100, 80);
  assert.ok(geo.bbox);
  assert.equal(geo.bbox.x, 10);
  assert.equal(geo.corners.length, 4);
  assert.ok(geo.occupancy > 0 && geo.occupancy < 1);
  assert.equal(geo.rotationDeg, 120);
  assert.ok(geo.perspective > 0);
  assert.equal(geo.residualPx, 1.4);
  assert.equal(geo.cellPx, 11.2);

  const body = normalizeFrameBody({
    seq: 1, w: 100, h: 80, ok: true, reason: '', geometry: geo, cellPx: geo.cellPx,
  });
  const parsed = parseEnvelope(JSON.stringify(makeEnvelope('s', 'scan', 'frame', body)));
  assert.equal(parsed.ok, true, parsed.error);
  const row = eventRow(parsed.event);
  assert.equal(row.cell_px, 11.2);
  assert.equal(row.bbox_x, 10);
  assert.equal(row.rotation_deg, 120);
  const missing = eventRow(makeEnvelope('s', 'scan', 'frame', normalizeFrameBody({
    seq: 1, w: 8, h: 8, ok: false, reason: 'x',
  })));
  assert.equal(missing.cell_px, null);
  assert.equal(missing.ms_proposal, null);
  assert.equal(missing.bbox_x, null);
  const zeroCell = normalizeFrameBody({
    seq: 1, w: 8, h: 8, ok: false, reason: 'x', cellPx: 0,
  });
  assert.equal(zeroCell.cellPx, null);
});

test('층화 샘플러는 첫 20장 편향·동일 reason 독점·성공 누락을 막고 상한을 지킨다', async () => {
  const sampler = createShotSampler({ maxTotal: 20, maxPerReason: 3, lateReserve: 2 });
  let emitted = 0;
  for (let i = 0; i < 30; i += 1) {
    const d = sampler.decide({
      ok: false, reason: 'frontend:no-finder', attemptId: 'a1', hasCandidate: i === 0,
    });
    if (d.action === 'emit') emitted += 1;
  }
  assert.ok(emitted <= 3, `같은 reason 이 ${emitted}장`);
  assert.ok(sampler.emitted <= 18);

  const reasons = [];
  for (let i = 0; i < 12; i += 1) {
    const d = sampler.decide({
      ok: false, reason: `frontend:reason-${i}`, attemptId: 'a2', hasCandidate: i === 0,
    });
    if (d.action === 'emit') reasons.push(`frontend:reason-${i}`);
  }
  assert.ok(reasons.length >= 8);
  assert.ok(new Set(reasons).size >= 8);
  const successA2 = sampler.decide({ ok: true, reason: '', attemptId: 'a2' });
  assert.equal(successA2.action, 'emit');
  assert.equal(successA2.role, 'success');

  const leftover = createShotSampler({ maxTotal: 20, maxPerReason: 3, lateReserve: 2 });
  for (let i = 0; i < 18; i += 1) {
    leftover.decide({
      ok: false, reason: `frontend:unique-${i}`, attemptId: 'prev', hasCandidate: i === 0,
    });
  }
  const endFlush = leftover.decide({
    ok: false, reason: 'frontend:held', attemptId: 'prev', flush: 'attempt-end',
  });
  assert.equal(endFlush.action, 'skip', '시도 종료가 늦은 예약 칸을 먹으면 안 된다');
  const pre = leftover.decide({
    ok: false, reason: 'frontend:held', attemptId: 'next', flush: 'pre-success',
  });
  assert.equal(pre.action, 'emit');
  assert.equal(pre.role, 'pre-success');
  const success = leftover.decide({ ok: true, reason: '', attemptId: 'next' });
  assert.equal(success.action, 'emit');
  assert.equal(success.role, 'success');
  assert.ok(leftover.emitted <= 20);

  FakeWS.instances = [];
  const tel = createLabTelemetry(labOpts());
  tel.beginAttempt('live');
  const img = tinyImage();
  for (let i = 0; i < 25; i += 1) {
    tel.frameShot({
      seq: i, imageData: img, attempt_id: 'live',
      reason: 'frontend:no-finder', hasCandidate: i === 2,
    });
  }
  tel.frameShot({
    seq: 99, imageData: img, attempt_id: 'live', ok: true, reason: '', hasCandidate: true,
  });
  await new Promise((r) => setTimeout(r, 30));
  const shots = FakeWS.instances[0].sent.slice(1).map((line) => JSON.parse(line))
    .filter((ev) => ev.kind === 'frameShot');
  assert.ok(shots.length <= MAX_SHOTS);
  assert.ok(shots.some((ev) => ev.body.shot_role === 'success'));
  assert.ok(shots.some((ev) => ev.body.shot_role === 'first-candidate'
    || ev.body.shot_role === 'pre-success'
    || ev.body.shot_role === 'new-reason'));
  assert.ok(shots.every((ev) => ev.body.attempt_id === 'live'));
});

test('relay/ClickHouse 컬럼과 client envelope 가 일치한다', () => {
  const body = normalizeFrameBody({
    seq: 3, w: 96, h: 64, zoom: 1.5, stage: 'format', ok: false,
    reason: 'frontend:no-format-candidate',
    attempt_id: 'a1', config_id: null,
    ms: { total: 40, proposal: 20, verify: null, format: 7, decode: null },
    expected: emptyConfigSide(),
    observed: { type: 'Y', version: 2, ecc: null, tones: 3, finderPatternId: null, qrPosition: null },
    chain: buildCauseChain({ ok: false, reason: 'frontend:no-format-candidate' }),
    geometry: {
      bbox: { x: 1, y: 2, w: 30, h: 40 }, corners: null, occupancy: 0.2,
      clipSide: 'none', rotationDeg: null, perspective: null, residualPx: null, cellPx: null,
    },
  });
  const parsed = parseEnvelope(JSON.stringify(makeEnvelope('s', 'scan', 'frame', body)));
  assert.equal(parsed.ok, true, parsed.error);
  const row = eventRow(parsed.event);
  assert.deepEqual(Object.keys(row).sort(), schemaColumns('tl_lab.events').slice().sort());
  assert.equal(row.ms_total, 40);
  assert.equal(row.ms_proposal, 20);
  assert.equal(row.ms_verify, null);
  assert.equal(row.attempt_id, 'a1');
  assert.equal(row.expected_type, '');
  assert.equal(row.observed_type, 'Y');
  assert.equal(row.chain_failed, 'format');
  assert.equal(row.cell_px, null);

  const shot = thumbnailRow(makeEnvelope('s', 'scan', 'frameShot', {
    seq: 3, w: 96, h: 48, png: 'data:image/png;base64,AA==',
    attempt_id: 'a1', reason: 'frontend:no-format-candidate', stage: 'format',
    shot_role: 'new-reason', chain_failed: 'format',
    geometry: { bbox: { x: 1, y: 2, w: 30, h: 40 }, occupancy: 0.2, clipSide: 'none' },
  }));
  assert.deepEqual(Object.keys(shot).sort(), schemaColumns('tl_lab.thumbnails').slice().sort());
  assert.equal(shot.attempt_id, 'a1');
  assert.equal(shot.cell_px, null);
});

test('live migration 파일은 idempotent ALTER 이고 실행 명령이 없다', () => {
  assert.match(MIG, /ADD COLUMN IF NOT EXISTS attempt_id/);
  assert.match(MIG, /MODIFY COLUMN ms_proposal Nullable/);
  assert.match(MIG, /이 저장소에서는 실행하지 않는다/);
  assert.doesNotMatch(MIG, /^clickhouse-client/m);
  assert.match(SQL, /ms_proposal\s+Nullable/);
  assert.match(SQL, /cell_px\s+Nullable/);
  assert.match(SQL, /cs_attempted\s+UInt8/);
  assert.match(MIG, /ADD COLUMN IF NOT EXISTS cs_attempted/);
  assert.match(SQL, /cs_arm\s+LowCardinality/);
  assert.match(SQL, /expected_locator_arm\s+LowCardinality/);
  assert.match(SQL, /observed_locator_arm\s+LowCardinality/);
  assert.match(MIG_AB, /ADD COLUMN IF NOT EXISTS cs_arm/);
  assert.match(MIG_AB, /ADD COLUMN IF NOT EXISTS expected_locator_arm/);
  assert.match(MIG_AB, /ADD COLUMN IF NOT EXISTS cs_orientation_gate/);
  assert.match(MIG_AB, /ADD COLUMN IF NOT EXISTS cs_ambiguous/);
  assert.doesNotMatch(MIG_AB, /^clickhouse-client/m);
  assert.match(SQL, /zoom_requested\s+Float32/);
  assert.match(SQL, /effective_zoom\s+Float32/);
  assert.match(SQL, /zoom_error\s+String/);
  assert.match(MIG_ZOOM, /ADD COLUMN IF NOT EXISTS zoom_requested/);
  assert.match(MIG_ZOOM, /ADD COLUMN IF NOT EXISTS crop /);
  assert.match(MIG_ZOOM, /ADD COLUMN IF NOT EXISTS crop_requested/);
  assert.match(MIG_ZOOM, /ADD COLUMN IF NOT EXISTS effective_zoom/);
  assert.match(MIG_ZOOM, /ADD COLUMN IF NOT EXISTS zoom_error/);
  assert.doesNotMatch(MIG_ZOOM, /^clickhouse-client/m);
});

test('decodeFrontend onStage 훅은 기본 반환을 바꾸지 않는다', () => {
  const raster = {
    width: 4,
    height: 4,
    pixels: new Uint8ClampedArray(4 * 4 * 4),
  };
  const marks = [];
  const plain = decodeFrontend(raster);
  const hooked = decodeFrontend(raster, {
    onStage(stage, phase) { marks.push([stage, phase]); },
  });
  assert.equal(plain.ok, hooked.ok);
  assert.equal(plain.reason, hooked.reason);
  assert.ok(marks.length === 0 || marks.every((row) => row[1] === 'enter' || row[1] === 'leave'));
});
