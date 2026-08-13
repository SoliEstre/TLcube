/**
 * ws.test.js — RFC 6455 핸드셰이크 벡터 · 프레임 왕복 · 릴레이 소켓 격리.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import {
  OP_TEXT,
  encodeMaskedFrame,
  secAccept,
  tryReadFrame,
  upgradeResponse,
} from './ws.mjs';
import { createRelay } from './server.mjs';

test('RFC 6455 §1.3 Sec-WebSocket-Accept 벡터', () => {
  assert.equal(secAccept('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  assert.match(upgradeResponse('dGhlIHNhbXBsZSBub25jZQ=='), /101 Switching Protocols/);
});

test('RFC 6455 §5.7 마스크된 Hello 프레임', () => {
  const raw = Buffer.from('818537fa213d7f9f4d5158', 'hex');
  const frame = tryReadFrame(raw, 1024);
  assert.equal(frame.needMore, undefined);
  assert.equal(frame.error, undefined);
  assert.equal(frame.opcode, OP_TEXT);
  assert.equal(frame.payload.toString('utf8'), 'Hello');
  assert.equal(frame.consumed, raw.length);
});

test('클라이언트 마스크 프레임을 다시 읽으면 원문이 나온다', () => {
  const encoded = encodeMaskedFrame(OP_TEXT, 'ping', Buffer.from([1, 2, 3, 4]));
  const frame = tryReadFrame(encoded, 1024);
  assert.equal(frame.payload.toString('utf8'), 'ping');
});

test('마스크 없는 프레임은 프로토콜 에러', () => {
  const raw = Buffer.from('810548656c6c6f', 'hex'); // unmasked "Hello"
  const frame = tryReadFrame(raw, 1024);
  assert.equal(frame.error, 'unmasked');
});

async function openWs(url) {
  const ws = new WebSocket(url);
  await once(ws, 'open');
  return ws;
}

function sendJson(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function nextMessage(ws, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    ws.addEventListener('message', (ev) => {
      clearTimeout(t);
      resolve(String(ev.data));
    }, { once: true });
  });
}

test('릴레이 — emitter 이벤트를 observer 가 받고, 적재 실패는 방송을 죽이지 않는다', async () => {
  const ingested = [];
  const relay = createRelay({
    host: '127.0.0.1',
    port: 0,
    ingest: async (ev) => {
      ingested.push(ev.kind);
      throw new Error('ch down');
    },
    log() {},
  });
  const addr = await relay.listen();
  const base = `ws://127.0.0.1:${addr.port}/lab/ws`;
  const observer = await openWs(base);
  const emitter = await openWs(base);
  sendJson(observer, { role: 'observer' });
  sendJson(emitter, { role: 'emitter' });
  await new Promise((r) => setTimeout(r, 30));

  const event = {
    v: 1,
    sid: 'live1',
    site: 'scan',
    ts: '2026-08-13T12:00:00.000Z',
    kind: 'frame',
    body: {
      seq: 1, w: 320, h: 240, zoom: 1,
      ms: { total: 10, proposal: 4, verify: 3, format: 2, decode: 1 },
      stage: 'decode', ok: false, reason: 'x', type: null, cellPx: null,
    },
  };
  const gotP = nextMessage(observer);
  sendJson(emitter, event);
  const got = JSON.parse(await gotP);
  assert.equal(got.kind, 'frame');
  assert.equal(got.body.seq, 1);
  // ingest 가 throw 해도 여기까지 온다. 허브가 삼킬 시간을 준다.
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(ingested, ['frame']);

  observer.close();
  emitter.close();
  await relay.close();
});

test('릴레이 — 관찰자가 없어도 적재는 호출된다', async () => {
  let n = 0;
  const relay = createRelay({
    host: '127.0.0.1',
    port: 0,
    ingest: async () => { n += 1; },
    log() {},
  });
  const addr = await relay.listen();
  const emitter = await openWs(`ws://127.0.0.1:${addr.port}/lab/ws`);
  sendJson(emitter, { role: 'emitter' });
  await new Promise((r) => setTimeout(r, 20));
  sendJson(emitter, {
    v: 1, sid: 'solo', site: 'gen', ts: '2026-08-13T12:00:00.000Z',
    kind: 'env', body: { w: 1, h: 1 },
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(n, 1);
  emitter.close();
  await relay.close();
});

test('릴레이 — 잘못된 봉투는 관찰자에게 안 나간다', async () => {
  const relay = createRelay({
    host: '127.0.0.1',
    port: 0,
    ingest: async () => { throw new Error('should not ingest'); },
    log() {},
  });
  const addr = await relay.listen();
  const base = `ws://127.0.0.1:${addr.port}/lab/ws`;
  const observer = await openWs(base);
  const emitter = await openWs(base);
  sendJson(observer, { role: 'observer' });
  sendJson(emitter, { role: 'emitter' });
  await new Promise((r) => setTimeout(r, 20));
  let leaked = false;
  observer.addEventListener('message', () => { leaked = true; });
  emitter.send(JSON.stringify({ v: 1, kind: 'nope' }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(leaked, false);
  observer.close();
  emitter.close();
  await relay.close();
});
