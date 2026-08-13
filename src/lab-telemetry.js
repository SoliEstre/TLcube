/**
 * lab-telemetry.js — 시험판(`/lab/`) 전용 계측 클라이언트.
 *
 * 계약: `.agent/_contracts/lab-telemetry.md` §3·§4·§5.
 * 와이어 검증 정본은 `relay/protocol.mjs` 와 같은 모양이어야 한다.
 *
 * 안정판 경로에서는 소켓을 열지 않고, 큐에 쓰지 않고, 한 바이트도 보내지 않는다.
 * 연결 실패는 조용히 삼킨다 — 생성·스캔 동작 조건이 아니다.
 *
 * @module lab-telemetry
 */

import { rasterToPng } from './png.js';

export const WIRE_VERSION = 1;
export const SID_KEY = 'tl-lab-sid';
export const QUEUE_KEY = 'tl-lab-queue';
export const MAX_QUEUE = 50;
export const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_SHOTS = 20;
export const SHOT_MAX_SIDE = 96;
export const MAX_SHOT_CHARS = 80 * 1024;
export const FRAME_MS_KEYS = Object.freeze(['total', 'proposal', 'verify', 'format', 'decode']);
export const GEN_BODY_KEYS = Object.freeze([
  'type', 'version', 'ecc', 'tones', 'finderPatternId', 'qrPosition', 'bgMode', 'quietMode',
]);

const STAGES = Object.freeze(['proposal', 'verify', 'format', 'decode']);

/** `/lab` 또는 `/lab/…` 만 시험판. `/label` 같은 접두 오탐을 막는다. */
export function isLabPath(pathname) {
  const path = typeof pathname === 'string'
    ? pathname
    : (typeof location !== 'undefined' && typeof location.pathname === 'string'
      ? location.pathname
      : '');
  return path === '/lab' || path.startsWith('/lab/');
}

export function classifyStage(result) {
  if (result && result.ok === true) return 'decode';
  const reason = result && typeof result.reason === 'string' ? result.reason : '';
  const detail = result && result.detail && typeof result.detail === 'object'
    ? result.detail
    : {};
  const raw = String(detail.pipelineStage || detail.stage || '');
  const blob = `${reason} ${raw}`.toLowerCase();
  if (blob.includes('reference')) return 'verify';
  if (blob.includes('format')) return 'format';
  if (
    blob.includes('decode')
    || blob.includes('selection')
    || blob.includes('validation')
    || blob.includes('grid-sampling')
    || blob.includes('payload')
    || blob.includes('body_rs')
    || blob.includes('no-grid-hypothesis')
  ) {
    return 'decode';
  }
  return 'proposal';
}

/**
 * 디코더 내부 단계 시계는 이 레인이 못 고친다. 벽시계 `total` 을 항상 채우고,
 * 도달한 마지막 단계에 같은 값을 넣는다. 아직 안 간 단계는 0.
 */
export function fillFrameMs(totalMs, stage) {
  const total = finiteMs(totalMs);
  const ms = { total, proposal: 0, verify: 0, format: 0, decode: 0 };
  if (STAGES.includes(stage)) ms[stage] = total;
  return ms;
}

export function familyToType(family) {
  if (family === 'hex') return 'O';
  if (family === 'tri') return 'A';
  if (family === 'cube') return 'Y';
  return null;
}

export function estimateCellPx(result, width, height) {
  if (!result || result.ok !== true || !result.hypothesis) return null;
  const side = Math.min(Number(width) || 0, Number(height) || 0);
  if (!(side > 0)) return null;
  const k = result.hypothesis.k;
  const n = result.hypothesis.n;
  if (Number.isFinite(k) && k > 0) return side / (2 * k + 1);
  if (Number.isFinite(n) && n > 0) return side / (2 * n);
  return null;
}

export function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function finiteMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function isoNow() {
  return new Date().toISOString();
}

function readSessionSid(storage) {
  try {
    const existing = storage.getItem(SID_KEY);
    if (typeof existing === 'string' && existing.length > 0) return existing;
    const made = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    storage.setItem(SID_KEY, made);
    return made;
  } catch {
    return 'nostore';
  }
}

function readQueue(storage) {
  try {
    const raw = storage.getItem(QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(storage, list) {
  try {
    storage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch {
    // 저장소가 막혀 있으면 큐를 포기한다 — 계측 실패는 앱을 막지 않는다.
  }
}

export function labSocketUrl(loc) {
  const protocol = loc && loc.protocol === 'http:' ? 'ws:' : 'wss:';
  const host = loc && loc.host ? loc.host : '';
  return `${protocol}//${host}/lab/ws`;
}

export function makeEnvelope(sid, site, kind, body, ts) {
  return {
    v: WIRE_VERSION,
    sid,
    site,
    ts: ts || isoNow(),
    kind,
    body: body && typeof body === 'object' ? body : {},
  };
}

export function normalizeFrameBody(body) {
  const src = body && typeof body === 'object' ? body : {};
  const msIn = src.ms && typeof src.ms === 'object' ? src.ms : {};
  const ms = {};
  for (const key of FRAME_MS_KEYS) ms[key] = finiteMs(msIn[key]);
  const type = src.type == null ? null : String(src.type);
  const cellPx = src.cellPx == null || !Number.isFinite(Number(src.cellPx))
    ? null
    : Number(src.cellPx);
  return {
    seq: Number.isFinite(Number(src.seq)) ? Number(src.seq) : 0,
    w: Number(src.w) || 0,
    h: Number(src.h) || 0,
    zoom: Number.isFinite(Number(src.zoom)) ? Number(src.zoom) : 1,
    ms,
    stage: typeof src.stage === 'string' && src.stage.length > 0 ? src.stage : 'proposal',
    ok: src.ok === true,
    reason: typeof src.reason === 'string' ? src.reason : '',
    type,
    cellPx,
  };
}

export function normalizeGenBody(body) {
  const src = body && typeof body === 'object' ? body : {};
  const out = {};
  for (const key of GEN_BODY_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 실패 프레임을 장변 ~96px 그레이스케일 PNG data URI 로 줄인다.
 * ImageData 또는 {width,height,data|pixels} 를 받는다.
 */
export function shrinkFrameShot(image, maxSide = SHOT_MAX_SIDE) {
  if (!image) return null;
  const srcW = image.width | 0;
  const srcH = image.height | 0;
  const src = image.data || image.pixels;
  if (!(srcW > 0) || !(srcH > 0) || !src || src.length < srcW * srcH * 4) return null;

  const long = Math.max(srcW, srcH);
  const scale = long > maxSide ? maxSide / long : 1;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const pixels = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * srcH / h));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * srcW / w));
      const i = (sy * srcW + sx) * 4;
      const yv = Math.round(0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]);
      const o = (y * w + x) * 4;
      pixels[o] = yv;
      pixels[o + 1] = yv;
      pixels[o + 2] = yv;
      pixels[o + 3] = 255;
    }
  }

  let png;
  try {
    png = rasterToPng({ width: w, height: h, pixels });
  } catch {
    return null;
  }
  const uri = `data:image/png;base64,${bytesToBase64(png)}`;
  if (uri.length > MAX_SHOT_CHARS) return null;
  return { seq: 0, w, h, png: uri };
}

function disabledClient() {
  const noop = () => {};
  return {
    enabled: false,
    sid: '',
    emit: noop,
    env: noop,
    gen: noop,
    frame: noop,
    frameShot: noop,
    close: noop,
  };
}

/**
 * @param {{
 *   site: 'gen'|'scan',
 *   location?: { pathname: string, protocol?: string, host?: string },
 *   sessionStorage?: Storage,
 *   localStorage?: Storage,
 *   WebSocket?: typeof WebSocket,
 *   now?: () => number,
 * }} [options]
 */
export function createLabTelemetry(options = {}) {
  const loc = options.location
    || (typeof location !== 'undefined' ? location : { pathname: '', protocol: 'https:', host: '' });
  if (!isLabPath(loc.pathname)) return disabledClient();

  const site = options.site === 'gen' ? 'gen' : 'scan';
  const sessionStore = options.sessionStorage
    || (typeof sessionStorage !== 'undefined' ? sessionStorage : memoryStore());
  const queueStore = options.localStorage
    || (typeof localStorage !== 'undefined' ? localStorage : memoryStore());
  const Socket = options.WebSocket
    || (typeof WebSocket !== 'undefined' ? WebSocket : null);

  const sid = readSessionSid(sessionStore);
  const url = labSocketUrl(loc);
  let socket = null;
  let roleSent = false;
  let shotCount = 0;
  let closed = false;

  function enqueue(event) {
    const q = readQueue(queueStore);
    q.push({ ...event, queued_at: Date.now() });
    writeQueue(queueStore, q.slice(-MAX_QUEUE));
  }

  function sendRaw(text) {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(text);
      return true;
    } catch {
      return false;
    }
  }

  function sendEvent(event) {
    if (closed) return;
    const line = JSON.stringify(event);
    if (roleSent && sendRaw(line)) return;
    enqueue(event);
    connect();
  }

  function flushQueue() {
    if (!roleSent) return;
    const queued = readQueue(queueStore);
    if (queued.length === 0) return;
    const cutoff = Date.now() - MAX_AGE_MS;
    const kept = [];
    for (const row of queued) {
      if (row.queued_at && row.queued_at < cutoff) continue;
      const { queued_at: _ignored, ...event } = row;
      if (!sendRaw(JSON.stringify(event))) kept.push(row);
    }
    writeQueue(queueStore, kept);
  }

  function connect() {
    if (closed || !Socket) return;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    try {
      socket = new Socket(url);
    } catch {
      socket = null;
      return;
    }
    const onOpen = () => {
      roleSent = sendRaw(JSON.stringify({ role: 'emitter' }));
      if (roleSent) flushQueue();
    };
    const onClose = () => {
      socket = null;
      roleSent = false;
    };
    const onError = () => {
      // 연결 실패는 스캐너·생성기 동작 조건이 아니다.
    };
    try {
      if (typeof socket.addEventListener === 'function') {
        socket.addEventListener('open', onOpen);
        socket.addEventListener('close', onClose);
        socket.addEventListener('error', onError);
      } else {
        socket.onopen = onOpen;
        socket.onclose = onClose;
        socket.onerror = onError;
      }
    } catch {
      socket = null;
    }
  }

  function emit(kind, body) {
    if (closed) return;
    sendEvent(makeEnvelope(sid, site, kind, body));
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      connect();
      flushQueue();
    });
  }
  connect();
  flushQueue();

  return {
    enabled: true,
    sid,
    emit,
    env(body) { emit('env', body && typeof body === 'object' ? body : {}); },
    gen(body) { emit('gen', normalizeGenBody(body)); },
    frame(body) { emit('frame', normalizeFrameBody(body)); },
    frameShot(input) {
      if (shotCount >= MAX_SHOTS) return;
      const image = input && input.imageData ? input.imageData : input;
      const shot = shrinkFrameShot(image);
      if (!shot) return;
      shotCount += 1;
      shot.seq = Number.isFinite(Number(input && input.seq)) ? Number(input.seq) : 0;
      emit('frameShot', shot);
    },
    close() {
      closed = true;
      try { if (socket) socket.close(); } catch { /* */ }
      socket = null;
    },
  };
}

function memoryStore() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(key); },
  };
}
