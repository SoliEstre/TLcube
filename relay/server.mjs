/**
 * server.mjs — /lab/ WebSocket 릴레이.
 *
 *   브라우저 ──WS──> 이 프로세스 ──┬──> ClickHouse (적재)
 *                                  └──> 관찰자 브로드캐스트
 *
 * 자격증명(ClickHouse 유저·키)은 환경변수만 본다. 소스로 나가지 않고,
 * 브라우저로도 나가지 않는다. ClickHouse 는 기본 127.0.0.1.
 *
 * 사용: node relay/server.mjs
 */

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createIngest } from './ingest.mjs';
import {
  MAX_MESSAGE_BYTES,
  createHub,
  parseEnvelope,
  parseRoleFrame,
  splitLines,
} from './protocol.mjs';
import { acceptUpgrade } from './ws.mjs';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function loadConfig(env = process.env, overrides = {}) {
  const database = overrides.database || env.TL_LAB_CH_DATABASE || 'tl_lab';
  if (!IDENT.test(database)) throw new Error('TL_LAB_CH_DATABASE');
  const port = Number(overrides.port ?? env.TL_LAB_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('TL_LAB_PORT');
  return {
    host: overrides.host || env.TL_LAB_HOST || '127.0.0.1',
    port,
    chUrl: overrides.chUrl || env.TL_LAB_CH_URL || 'http://127.0.0.1:8123',
    chUser: overrides.chUser || env.TL_LAB_CH_USER || '',
    chKey: overrides.chKey || env.TL_LAB_CH_KEY || '',
    database,
    maxPayload: Number(overrides.maxPayload ?? env.TL_LAB_MAX_PAYLOAD ?? MAX_MESSAGE_BYTES),
    maxSockets: Number(overrides.maxSockets ?? env.TL_LAB_MAX_SOCKETS ?? 256),
    path: '/lab/ws',
  };
}

export function createRelay(options = {}) {
  const cfg = options.cfg || loadConfig(options.env, options);
  const log = options.log || defaultLog;
  const ingest = options.ingest
    || createIngest({
      url: cfg.chUrl,
      user: cfg.chUser,
      key: cfg.chKey,
      database: cfg.database,
      log,
    }).write;
  const hub = options.hub || createHub({ ingest, log });

  let live = 0;
  const sockets = new Set();

  const server = createServer((req, res) => {
    const url = safeUrl(req.url);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok\n');
      return;
    }
    if (url.pathname === cfg.path) {
      res.writeHead(426, {
        'Content-Type': 'text/plain; charset=utf-8',
        Upgrade: 'websocket',
      }).end('upgrade required\n');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found\n');
  });

  server.on('connection', (sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
  });

  server.on('upgrade', (req, socket, head) => {
    const url = safeUrl(req.url);
    if (url.pathname !== cfg.path) {
      try { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); } catch { /* */ }
      try { socket.destroy(); } catch { /* */ }
      return;
    }
    if (live >= cfg.maxSockets) {
      try { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); } catch { /* */ }
      try { socket.destroy(); } catch { /* */ }
      return;
    }
    const ws = acceptUpgrade(req, socket, head, { maxPayload: cfg.maxPayload });
    if (!ws) return;
    live += 1;
    attachClient(ws, hub, log, () => { live = Math.max(0, live - 1); });
  });

  function listen() {
    return new Promise((resolve, reject) => {
      const onErr = (err) => reject(err);
      server.once('error', onErr);
      server.listen(cfg.port, cfg.host, () => {
        server.off('error', onErr);
        resolve(server.address());
      });
    });
  }

  function close() {
    for (const sock of sockets) {
      try { sock.destroy(); } catch { /* */ }
    }
    sockets.clear();
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return { server, hub, cfg, listen, close };
}

function attachClient(ws, hub, log, onGone) {
  let role = null;
  let gone = false;

  const finish = () => {
    if (gone) return;
    gone = true;
    if (role === 'observer') hub.removeObserver(ws);
    onGone();
  };

  ws.onclose = finish;
  ws.ontext = (text) => {
    if (!role) {
      const parsed = parseRoleFrame(text);
      if (!parsed.ok) {
        ws.close(1008, parsed.error);
        return;
      }
      role = parsed.role;
      if (role === 'observer') hub.addObserver(ws);
      return;
    }
    if (role === 'observer') return;
    for (const line of splitLines(text)) {
      const parsed = parseEnvelope(line);
      if (!parsed.ok) {
        try { log('drop', parsed.error); } catch { /* */ }
        continue;
      }
      try {
        hub.dispatch(parsed.event, line);
      } catch (err) {
        // dispatch 자체는 던지지 않도록 짜여 있다. 여기까지 오면 버그다 — 소켓은 살린다.
        try { log('dispatch', err); } catch { /* */ }
      }
    }
  };
}

function safeUrl(raw) {
  try {
    return new URL(raw || '/', 'http://relay.local');
  } catch {
    return new URL('/', 'http://relay.local');
  }
}

function defaultLog(kind, detail) {
  const msg = detail instanceof Error ? detail.message : detail == null ? '' : String(detail);
  // 자격증명·png 본문은 절대 찍지 않는다.
  process.stderr.write(`[lab-relay] ${kind}${msg ? ` ${msg.slice(0, 200)}` : ''}\n`);
}

function launchedAsMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url).toLowerCase() === path.resolve(entry).toLowerCase();
  } catch {
    return false;
  }
}

if (launchedAsMain()) {
  const relay = createRelay();
  const addr = await relay.listen();
  const host = addr.address === '::' ? '127.0.0.1' : addr.address;
  process.stderr.write(`[lab-relay] ws://${host}:${addr.port}${relay.cfg.path}\n`);
  const stop = () => {
    relay.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
