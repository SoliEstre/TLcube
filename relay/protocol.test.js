/**
 * protocol.test.js — 봉투 검증 · frameShot 상한 · 적재/브로드캐스트 실패 격리.
 *
 * 소켓과 ClickHouse 없이 hub 만 돌린다. 격리는 여기가 정본이다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SHOTS_PER_SID,
  ShotLedger,
  createHub,
  eventRow,
  parseEnvelope,
  parseRoleFrame,
  splitLines,
  thumbnailRow,
  toChDateTime,
  validateEnvelope,
} from './protocol.mjs';

const TS = '2026-08-13T12:00:00.000Z';

function frameBody(over = {}) {
  return {
    seq: 12,
    w: 960,
    h: 540,
    zoom: 1,
    ms: { total: 210, proposal: 90, verify: 70, format: 30, decode: 20 },
    stage: 'decode',
    ok: false,
    reason: 'frontend:no-format-candidate',
    type: null,
    cellPx: null,
    ...over,
  };
}

function envelope(over = {}) {
  return {
    v: 1,
    sid: 'tab1',
    site: 'scan',
    ts: TS,
    kind: 'frame',
    body: frameBody(),
    ...over,
  };
}

function line(over = {}) {
  return JSON.stringify(envelope(over));
}

test('역할 첫 프레임 — emitter / observer 만', () => {
  assert.equal(parseRoleFrame('{"role":"emitter"}').role, 'emitter');
  assert.equal(parseRoleFrame('{"role":"observer"}').role, 'observer');
  assert.equal(parseRoleFrame('{"role":"admin"}').ok, false);
  assert.equal(parseRoleFrame(line()).ok, false);
  assert.equal(parseRoleFrame('not-json').ok, false);
});

test('한 줄 = 한 이벤트 — 개행으로 쪼갠다', () => {
  assert.deepEqual(splitLines(`${line()}\n${line({ kind: 'env', body: {} })}\n`), [
    line(),
    line({ kind: 'env', body: {} }),
  ]);
  assert.deepEqual(splitLines('  \n\n'), []);
});

test('계약 §3 봉투 — 정상 frame / env / gen / frameShot', () => {
  assert.equal(parseEnvelope(line()).ok, true);
  assert.equal(parseEnvelope(line({ kind: 'env', site: 'gen', body: { ua: 'x' } })).ok, true);
  assert.equal(parseEnvelope(line({
    kind: 'gen',
    site: 'gen',
    body: { type: 'hex', version: 3, ecc: 'M' },
  })).ok, true);
  assert.equal(parseEnvelope(line({
    kind: 'frameShot',
    body: { seq: 3, w: 96, h: 64, png: 'data:image/png;base64,AA==' },
  })).ok, true);
});

test('계약 §3 봉투 — 불법값 거부', () => {
  const rejects = [
    line({ v: 2 }),
    line({ v: '1' }),
    line({ sid: '' }),
    line({ site: 'hub' }),
    line({ ts: 'not-a-date' }),
    line({ kind: 'pageview' }),
    line({ body: 'str' }),
    '{',
    JSON.stringify({ ...envelope(), body: { ...frameBody(), ms: { total: 1 } } }),
    JSON.stringify({ ...envelope(), body: { ...frameBody(), ok: 'no' } }),
    JSON.stringify({
      ...envelope(),
      kind: 'frameShot',
      body: { seq: 1, w: 10, h: 10, png: 'http://evil/x.png' },
    }),
  ];
  for (const raw of rejects) {
    const r = parseEnvelope(raw);
    assert.equal(r.ok, false, raw);
  }
});

test('frame 본문 — 단계별 ms 가 빠지면 거절 (계약 §4)', () => {
  const ms = { total: 1, proposal: 1, verify: 1, format: 1, decode: 1 };
  for (const key of Object.keys(ms)) {
    const broken = { ...ms };
    delete broken[key];
    const r = validateEnvelope(envelope({ body: frameBody({ ms: broken }) }));
    assert.equal(r.ok, false, key);
  }
});

test('frame.cellSurface 는 선택이고 시도/점수/사유를 행으로 편다', () => {
  const ok = validateEnvelope(envelope({
    body: frameBody({
      cellSurface: {
        attempted: true, accepted: false, score: 0.4, reason: 'below-threshold',
        profile: 'cell-surface-v1-B', arm: 'B', expectedArm: 'A',
        orientationGate: 'applied', orientationGateApplied: true, ambiguous: false,
      },
    }),
  }));
  assert.equal(ok.ok, true, ok.error);
  const row = eventRow(ok.event);
  assert.equal(row.cs_attempted, 1);
  assert.equal(row.cs_accepted, 0);
  assert.equal(row.cs_score, 0.4);
  assert.equal(row.cs_reason, 'below-threshold');
  assert.equal(row.cs_profile, 'cell-surface-v1-B');
  assert.equal(row.cs_arm, 'B');
  assert.equal(row.cs_expected_arm, 'A');
  assert.equal(row.cs_orientation_gate, 'applied');
  assert.equal(row.cs_orientation_gate_applied, 1);
  assert.equal(row.cs_ambiguous, 0);
  const missing = eventRow(envelope({ body: frameBody() }));
  assert.equal(missing.cs_attempted, 0);
  assert.equal(missing.cs_score, null);
});

test('ClickHouse 행 — ISO ts 를 UTC DateTime64 문자열로', () => {
  assert.equal(toChDateTime('2026-08-13T12:00:00.000Z'), '2026-08-13 12:00:00.000');
  const row = eventRow(envelope({ body: frameBody({ ok: true, type: 'hex', cellPx: 11.4 }) }));
  assert.equal(row.ok, 1);
  assert.equal(row.type, 'hex');
  assert.equal(row.cell_px, 11.4);
  assert.equal(row.ms_proposal, 90);
  const missingCell = eventRow(envelope({ body: frameBody({ cellPx: null }) }));
  assert.equal(missingCell.cell_px, null);
  const missingMs = eventRow(envelope({
    body: frameBody({ ms: { total: 10, proposal: null, verify: null, format: null, decode: null } }),
  }));
  assert.equal(missingMs.ms_proposal, null);
  const shot = thumbnailRow(envelope({
    kind: 'frameShot',
    body: { seq: 4, w: 96, h: 54, png: 'data:image/png;base64,AA==' },
  }));
  assert.equal(shot.seq, 4);
  assert.equal(shot.png.startsWith('data:image/'), true);
});

test('frameShot 세션당 20장 — 21번째는 적재도 방송도 없다', async () => {
  const ingested = [];
  const seen = [];
  const hub = createHub({
    ingest: async (ev) => { ingested.push(ev); },
    log() {},
  });
  hub.addObserver({ send(t) { seen.push(t); } });

  const mk = (seq) => envelope({
    kind: 'frameShot',
    sid: 'same',
    body: { seq, w: 96, h: 64, png: 'data:image/png;base64,AA==' },
  });

  for (let i = 1; i <= MAX_SHOTS_PER_SID; i += 1) {
    const r = hub.dispatch(mk(i));
    assert.equal(r.accepted, true, i);
    await r.ingestP;
  }
  const over = hub.dispatch(mk(21));
  assert.equal(over.accepted, false);
  assert.equal(over.reason, 'shot-cap');
  await over.ingestP;
  assert.equal(ingested.length, MAX_SHOTS_PER_SID);
  assert.equal(seen.length, MAX_SHOTS_PER_SID);

  const other = hub.dispatch(mk(1));
  // sid 가 같으면 계속 막힌다
  assert.equal(other.accepted, false);
  const otherSid = hub.dispatch(envelope({
    kind: 'frameShot',
    sid: 'other',
    body: { seq: 1, w: 96, h: 64, png: 'data:image/png;base64,AA==' },
  }));
  assert.equal(otherSid.accepted, true);
  await otherSid.ingestP;
});

test('ShotLedger — 다른 sid 는 독립, 같은 sid 는 누적', () => {
  const ledger = new ShotLedger({ max: 2 });
  assert.equal(ledger.tryAdd('a'), true);
  assert.equal(ledger.tryAdd('a'), true);
  assert.equal(ledger.tryAdd('a'), false);
  assert.equal(ledger.tryAdd('b'), true);
  assert.equal(ledger.count('a'), 2);
});

test('격리 — ingest 가 던져도 관찰자는 받는다', async () => {
  const seen = [];
  const hub = createHub({
    ingest: async () => { throw new Error('ch down'); },
    log() {},
  });
  hub.addObserver({ send(t) { seen.push(t); } });
  const r = hub.dispatch(envelope(), '{"k":1}');
  assert.equal(r.accepted, true);
  assert.deepEqual(seen, ['{"k":1}']);
  await r.ingestP; // reject 되지 않는다
});

test('격리 — ingest 가 동기 throw 여도 관찰자는 받는다', async () => {
  const seen = [];
  const hub = createHub({
    ingest: () => { throw new Error('sync'); },
    log() {},
  });
  hub.addObserver({ send() { seen.push(1); } });
  const r = hub.dispatch(envelope());
  assert.deepEqual(seen, [1]);
  await r.ingestP;
});

test('격리 — 관찰자가 없어도 적재는 계속된다', async () => {
  let n = 0;
  const hub = createHub({ ingest: async () => { n += 1; }, log() {} });
  const r = hub.dispatch(envelope());
  await r.ingestP;
  assert.equal(n, 1);
});

test('격리 — 관찰자 하나가 던져도 나머지와 적재는 산다', async () => {
  let n = 0;
  const seen = [];
  const hub = createHub({ ingest: async () => { n += 1; }, log() {} });
  const dead = { send() { throw new Error('dead'); } };
  hub.addObserver(dead);
  hub.addObserver({ send(t) { seen.push(t); } });
  const r = hub.dispatch(envelope(), 'x');
  await r.ingestP;
  assert.equal(n, 1);
  assert.deepEqual(seen, ['x']);
  assert.equal(hub.observers.has(dead), false);
});

test('격리 — 브로드캐스트가 ingest 를 기다리지 않는다', async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const hub = createHub({
    ingest: () => gate.then(() => { order.push('ingest'); }),
    log() {},
  });
  hub.addObserver({ send() { order.push('broadcast'); } });
  const r = hub.dispatch(envelope());
  assert.deepEqual(order, ['broadcast']);
  release();
  await r.ingestP;
  assert.deepEqual(order, ['broadcast', 'ingest']);
});
