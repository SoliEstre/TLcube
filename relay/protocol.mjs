/**
 * protocol.mjs — 계약 §3·§4 봉투 검증, frameShot 상한, 실패 격리 디스패치.
 *
 * 소켓·ClickHouse 를 모른다. 서버와 테스트가 같은 함수를 쓴다.
 */

export const WIRE_VERSION = 1;
export const SITES = Object.freeze(['gen', 'scan']);
export const KINDS = Object.freeze(['env', 'gen', 'frame', 'frameShot']);
export const ROLES = Object.freeze(['emitter', 'observer']);
export const EVENT_KINDS = Object.freeze(['env', 'gen', 'frame']);

/** 계약 §5 — 실패 프레임 표본, 세션(sid)당 20장. */
export const MAX_SHOTS_PER_SID = 20;

/** 한 WebSocket 텍스트 프레임 상한. 96px 그레이스케일 data URI 보다 충분히 크다. */
export const MAX_MESSAGE_BYTES = 128 * 1024;

/** frameShot.png 문자 수 상한 (data URI). */
export const MAX_SHOT_CHARS = 80 * 1024;

export const MAX_SID_CHARS = 128;

const FRAME_MS_KEYS = Object.freeze(['total', 'proposal', 'verify', 'format', 'decode']);

export function splitLines(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line) out.push(line);
  }
  return out;
}

export function parseRoleFrame(text) {
  const obj = parseObject(text);
  if (!obj.ok) return obj;
  const role = obj.value.role;
  if (role !== 'emitter' && role !== 'observer') {
    return { ok: false, error: 'role 은 emitter 또는 observer' };
  }
  return { ok: true, role };
}

export function parseEnvelope(text) {
  if (typeof text !== 'string') return { ok: false, error: 'not a string' };
  if (text.length > MAX_MESSAGE_BYTES) return { ok: false, error: 'message too large' };
  const obj = parseObject(text);
  if (!obj.ok) return obj;
  return validateEnvelope(obj.value);
}

export function validateEnvelope(value) {
  if (!isPlainObject(value)) return { ok: false, error: 'envelope 는 객체' };
  if (value.v !== WIRE_VERSION) return { ok: false, error: 'v 는 1' };
  if (!isNonEmptyString(value.sid) || value.sid.length > MAX_SID_CHARS) {
    return { ok: false, error: 'sid' };
  }
  if (!SITES.includes(value.site)) return { ok: false, error: 'site 는 gen|scan' };
  if (!isNonEmptyString(value.ts) || Number.isNaN(Date.parse(value.ts))) {
    return { ok: false, error: 'ts 는 ISO' };
  }
  if (!KINDS.includes(value.kind)) return { ok: false, error: 'kind' };
  if (!isPlainObject(value.body)) return { ok: false, error: 'body 는 객체' };

  if (value.kind === 'frame') {
    const bodyErr = validateFrameBody(value.body);
    if (bodyErr) return { ok: false, error: bodyErr };
  } else if (value.kind === 'frameShot') {
    const bodyErr = validateFrameShotBody(value.body);
    if (bodyErr) return { ok: false, error: bodyErr };
  }

  return { ok: true, event: value };
}

/** 계약 §4 — 단계별 ms 가 빠지면 이 수집의 존재 이유가 사라진다. */
export function validateFrameBody(body) {
  if (!isFiniteNumber(body.seq) || body.seq < 0) return 'frame.seq';
  if (!isFiniteNumber(body.w) || body.w <= 0) return 'frame.w';
  if (!isFiniteNumber(body.h) || body.h <= 0) return 'frame.h';
  if (!isFiniteNumber(body.zoom)) return 'frame.zoom';
  if (!isPlainObject(body.ms)) return 'frame.ms';
  for (const key of FRAME_MS_KEYS) {
    if (!isFiniteNumber(body.ms[key]) || body.ms[key] < 0) return `frame.ms.${key}`;
  }
  if (typeof body.stage !== 'string' || body.stage.length === 0) return 'frame.stage';
  if (typeof body.ok !== 'boolean') return 'frame.ok';
  if (typeof body.reason !== 'string') return 'frame.reason';
  if (!(body.type === null || typeof body.type === 'string')) return 'frame.type';
  if (!(body.cellPx === null || body.cellPx === undefined || isFiniteNumber(body.cellPx))) {
    return 'frame.cellPx';
  }
  return null;
}

export function validateFrameShotBody(body) {
  if (!isFiniteNumber(body.seq) || body.seq < 0) return 'frameShot.seq';
  if (!isFiniteNumber(body.w) || body.w <= 0) return 'frameShot.w';
  if (!isFiniteNumber(body.h) || body.h <= 0) return 'frameShot.h';
  if (typeof body.png !== 'string' || !body.png.startsWith('data:image/')) return 'frameShot.png';
  if (body.png.length > MAX_SHOT_CHARS) return 'frameShot.png too large';
  return null;
}

/** ClickHouse DateTime64(3, 'UTC') 가 받는 'YYYY-MM-DD HH:mm:ss.sss'. */
export function toChDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('bad ts');
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

/** tl_lab.events 한 행. 키 집합은 schema.sql 과 테스트가 고정한다. */
export function eventRow(event) {
  const body = event.body || {};
  const ms = isPlainObject(body.ms) ? body.ms : {};
  return {
    v: event.v,
    sid: event.sid,
    site: event.site,
    ts: toChDateTime(event.ts),
    kind: event.kind,
    seq: asUInt(body.seq),
    w: asUInt(body.w),
    h: asUInt(body.h),
    zoom: asFloat(body.zoom),
    ms_total: asUInt(ms.total),
    ms_proposal: asUInt(ms.proposal),
    ms_verify: asUInt(ms.verify),
    ms_format: asUInt(ms.format),
    ms_decode: asUInt(ms.decode),
    stage: body.stage == null ? '' : String(body.stage),
    ok: body.ok ? 1 : 0,
    reason: body.reason == null ? '' : String(body.reason),
    type: body.type == null ? '' : String(body.type),
    cell_px: body.cellPx == null ? 0 : asFloat(body.cellPx),
    body: JSON.stringify(body),
  };
}

/** tl_lab.thumbnails 한 행. */
export function thumbnailRow(event) {
  const body = event.body || {};
  return {
    v: event.v,
    sid: event.sid,
    site: event.site,
    ts: toChDateTime(event.ts),
    seq: asUInt(body.seq),
    w: asUInt(body.w),
    h: asUInt(body.h),
    png: typeof body.png === 'string' ? body.png : '',
  };
}

export class ShotLedger {
  /**
   * @param {{ max?: number, ttlMs?: number }} [opts]
   */
  constructor({ max = MAX_SHOTS_PER_SID, ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    /** @type {Map<string, { n: number, seen: number }>} */
    this.map = new Map();
  }

  count(sid) {
    const cur = this.map.get(sid);
    return cur ? cur.n : 0;
  }

  tryAdd(sid, now = Date.now()) {
    this.gc(now);
    const cur = this.map.get(sid) || { n: 0, seen: now };
    if (cur.n >= this.max) {
      cur.seen = now;
      this.map.set(sid, cur);
      return false;
    }
    cur.n += 1;
    cur.seen = now;
    this.map.set(sid, cur);
    return true;
  }

  gc(now = Date.now()) {
    const cutoff = now - this.ttlMs;
    for (const [sid, cur] of this.map) {
      if (cur.seen < cutoff) this.map.delete(sid);
    }
  }
}

/**
 * 적재와 브로드캐스트를 같은 호출에서 일으키되, 한쪽 예외가 다른 쪽을 삼키지 않는다.
 *
 * - 관찰자가 0이어도 ingest 는 호출된다
 * - ingest 가 던져도 이미 보낸 브로드캐스트는 그대로다
 * - 관찰자 하나가 던지면 그 소켓만 빼고 나머지는 계속 받는다
 * - ingest 는 await 하지 않은 채 시작되므로 브로드캐스트를 막지 않는다
 */
export function createHub({ ingest, log = () => {}, shots = new ShotLedger() } = {}) {
  const observers = new Set();

  function addObserver(ws) {
    observers.add(ws);
  }

  function removeObserver(ws) {
    observers.delete(ws);
  }

  function dispatch(event, rawText) {
    if (event.kind === 'frameShot' && !shots.tryAdd(event.sid)) {
      try { log('shot-cap', event.sid); } catch { /* 로그 실패도 격리 */ }
      return { accepted: false, reason: 'shot-cap', ingestP: Promise.resolve() };
    }

    const payload = rawText == null ? JSON.stringify(event) : rawText;

    for (const obs of [...observers]) {
      try {
        obs.send(payload);
      } catch (err) {
        try { log('observer', err); } catch { /* */ }
        try { observers.delete(obs); } catch { /* */ }
      }
    }

    let ingestP;
    try {
      ingestP = Promise.resolve(ingest ? ingest(event) : undefined);
    } catch (err) {
      try { log('ingest', err); } catch { /* */ }
      ingestP = Promise.resolve();
    }
    ingestP = ingestP.catch((err) => {
      try { log('ingest', err); } catch { /* */ }
    });

    return { accepted: true, ingestP };
  }

  return { addObserver, removeObserver, dispatch, observers, shots };
}

function parseObject(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid json' };
  }
  if (!isPlainObject(value)) return { ok: false, error: 'not an object' };
  return { ok: true, value };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function asUInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function asFloat(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
