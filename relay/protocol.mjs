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
  // token 은 선택 필드 (defense-in-depth). 있으면 문자열이어야 한다.
  // 서버가 토큰을 요구하는지 여부는 cfg 가 정한다 — 여기선 모양만 검증한다.
  const token = obj.value.token;
  if (token !== undefined && token !== null && typeof token !== 'string') {
    return { ok: false, error: 'token 은 문자열' };
  }
  return { ok: true, role, token: typeof token === 'string' ? token : null };
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

function isNullableNumber(value) {
  return value === null || value === undefined || (isFiniteNumber(value) && value >= 0);
}

function isNullableString(value) {
  return value === null || value === undefined || typeof value === 'string';
}

/** 계약 §4 — 단계별 ms 키는 있어야 한다. 측정 안 된 단계는 null, total 복사는 거부하지 않지만 권장하지 않는다. */
export function validateFrameBody(body) {
  if (!isFiniteNumber(body.seq) || body.seq < 0) return 'frame.seq';
  if (!isFiniteNumber(body.w) || body.w <= 0) return 'frame.w';
  if (!isFiniteNumber(body.h) || body.h <= 0) return 'frame.h';
  if (!isFiniteNumber(body.zoom)) return 'frame.zoom';
  if (body.zoomRequested !== undefined && body.zoomRequested !== null
    && !isFiniteNumber(body.zoomRequested)) {
    return 'frame.zoomRequested';
  }
  if (body.crop !== undefined && body.crop !== null && !isFiniteNumber(body.crop)) {
    return 'frame.crop';
  }
  if (body.cropRequested !== undefined && body.cropRequested !== null
    && !isFiniteNumber(body.cropRequested)) {
    return 'frame.cropRequested';
  }
  if (body.effectiveZoom !== undefined && body.effectiveZoom !== null
    && !isFiniteNumber(body.effectiveZoom)) {
    return 'frame.effectiveZoom';
  }
  if (!isNullableString(body.zoomError)) return 'frame.zoomError';
  if (!isPlainObject(body.ms)) return 'frame.ms';
  if (!isFiniteNumber(body.ms.total) || body.ms.total < 0) return 'frame.ms.total';
  for (const key of ['proposal', 'verify', 'format', 'decode']) {
    if (!(key in body.ms)) return `frame.ms.${key}`;
    if (!isNullableNumber(body.ms[key])) return `frame.ms.${key}`;
  }
  if (typeof body.stage !== 'string' || body.stage.length === 0) return 'frame.stage';
  if (typeof body.ok !== 'boolean') return 'frame.ok';
  if (typeof body.reason !== 'string') return 'frame.reason';
  if (!(body.type === null || typeof body.type === 'string')) return 'frame.type';
  if (!(body.cellPx === null || body.cellPx === undefined || isFiniteNumber(body.cellPx))) {
    return 'frame.cellPx';
  }
  if (!isNullableString(body.attempt_id)) return 'frame.attempt_id';
  if (!isNullableString(body.config_id)) return 'frame.config_id';
  if (body.expected !== undefined && body.expected !== null && !isPlainObject(body.expected)) {
    return 'frame.expected';
  }
  if (body.observed !== undefined && body.observed !== null && !isPlainObject(body.observed)) {
    return 'frame.observed';
  }
  if (body.chain !== undefined && body.chain !== null && !isPlainObject(body.chain)) {
    return 'frame.chain';
  }
  if (body.geometry !== undefined && body.geometry !== null && !isPlainObject(body.geometry)) {
    return 'frame.geometry';
  }
  if (isPlainObject(body.geometry)) {
    if (!isNullableString(body.geometry.geometryStage)) return 'frame.geometry.geometryStage';
    if (!isNullableString(body.geometry.detectPath)) return 'frame.geometry.detectPath';
  }
  if (body.cellSurface !== undefined && body.cellSurface !== null) {
    if (!isPlainObject(body.cellSurface)) return 'frame.cellSurface';
    if (body.cellSurface.attempted !== undefined && typeof body.cellSurface.attempted !== 'boolean') {
      return 'frame.cellSurface.attempted';
    }
    if (body.cellSurface.accepted !== undefined && typeof body.cellSurface.accepted !== 'boolean') {
      return 'frame.cellSurface.accepted';
    }
    if (!(body.cellSurface.score === null || body.cellSurface.score === undefined
      || isFiniteNumber(body.cellSurface.score))) {
      return 'frame.cellSurface.score';
    }
    if (!isNullableString(body.cellSurface.reason)) return 'frame.cellSurface.reason';
    if (!isNullableString(body.cellSurface.profile)) return 'frame.cellSurface.profile';
    if (!isNullableString(body.cellSurface.arm)) return 'frame.cellSurface.arm';
    if (!isNullableString(body.cellSurface.expectedArm)) return 'frame.cellSurface.expectedArm';
    if (!isNullableString(body.cellSurface.layoutId)) return 'frame.cellSurface.layoutId';
    if (!isNullableString(body.cellSurface.expectedLayout)) {
      return 'frame.cellSurface.expectedLayout';
    }
    if (!isNullableString(body.cellSurface.orientationGate)) {
      return 'frame.cellSurface.orientationGate';
    }
    if (body.cellSurface.orientationGateApplied !== undefined
      && body.cellSurface.orientationGateApplied !== null
      && typeof body.cellSurface.orientationGateApplied !== 'boolean') {
      return 'frame.cellSurface.orientationGateApplied';
    }
    if (body.cellSurface.ambiguous !== undefined
      && body.cellSurface.ambiguous !== null
      && typeof body.cellSurface.ambiguous !== 'boolean') {
      return 'frame.cellSurface.ambiguous';
    }
  }
  return null;
}

export function validateFrameShotBody(body) {
  if (!isFiniteNumber(body.seq) || body.seq < 0) return 'frameShot.seq';
  if (!isFiniteNumber(body.w) || body.w <= 0) return 'frameShot.w';
  if (!isFiniteNumber(body.h) || body.h <= 0) return 'frameShot.h';
  if (typeof body.png !== 'string' || !body.png.startsWith('data:image/')) return 'frameShot.png';
  if (body.png.length > MAX_SHOT_CHARS) return 'frameShot.png too large';
  if (!isNullableString(body.attempt_id)) return 'frameShot.attempt_id';
  if (!isNullableString(body.config_id)) return 'frameShot.config_id';
  if (!isNullableString(body.reason)) return 'frameShot.reason';
  if (!isNullableString(body.stage)) return 'frameShot.stage';
  if (!isNullableString(body.shot_role)) return 'frameShot.shot_role';
  return null;
}

/** ClickHouse DateTime64(3, 'UTC') 가 받는 'YYYY-MM-DD HH:mm:ss.sss'. */
export function toChDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('bad ts');
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

function configSide(src, key) {
  if (!isPlainObject(src)) return '';
  const value = src[key];
  return value == null ? '' : String(value);
}

function configSideNum(src, key) {
  if (!isPlainObject(src)) return null;
  const value = src[key];
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function geometryField(body, key) {
  const geo = isPlainObject(body.geometry) ? body.geometry : null;
  if (!geo) return null;
  if (key === 'clip_side') {
    return typeof geo.clipSide === 'string' ? geo.clipSide : '';
  }
  if (key.startsWith('bbox_')) {
    const bbox = isPlainObject(geo.bbox) ? geo.bbox : null;
    if (!bbox) return null;
    const map = { bbox_x: 'x', bbox_y: 'y', bbox_w: 'w', bbox_h: 'h' };
    return asNullableFloat(bbox[map[key]]);
  }
  const map = {
    occupancy: 'occupancy',
    rotation_deg: 'rotationDeg',
    perspective: 'perspective',
    residual_px: 'residualPx',
    cell_px: 'cellPx',
  };
  return asNullableFloat(geo[map[key]]);
}

/** tl_lab.events 한 행. 키 집합은 schema.sql 과 테스트가 고정한다. */
export function eventRow(event) {
  const body = event.body || {};
  const ms = isPlainObject(body.ms) ? body.ms : {};
  const expected = isPlainObject(body.expected) ? body.expected : {};
  const observed = isPlainObject(body.observed) ? body.observed : {};
  const chain = isPlainObject(body.chain) ? body.chain : {};
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
    zoom_requested: asFloat(body.zoomRequested),
    crop: body.crop == null ? 1 : asFloat(body.crop),
    crop_requested: asFloat(body.cropRequested),
    effective_zoom: asFloat(body.effectiveZoom),
    zoom_error: body.zoomError == null ? '' : String(body.zoomError),
    ms_total: asUInt(ms.total),
    ms_proposal: asNullableUInt(ms.proposal),
    ms_verify: asNullableUInt(ms.verify),
    ms_format: asNullableUInt(ms.format),
    ms_decode: asNullableUInt(ms.decode),
    stage: body.stage == null ? '' : String(body.stage),
    ok: body.ok ? 1 : 0,
    reason: body.reason == null ? '' : String(body.reason),
    type: body.type == null ? '' : String(body.type),
    cell_px: body.cellPx == null ? geometryField(body, 'cell_px') : asNullableFloat(body.cellPx),
    attempt_id: body.attempt_id == null ? '' : String(body.attempt_id),
    config_id: body.config_id == null ? '' : String(body.config_id),
    expected_type: configSide(expected, 'type'),
    expected_version: expected.version == null ? '' : String(expected.version),
    expected_ecc: configSide(expected, 'ecc'),
    expected_tones: configSideNum(expected, 'tones'),
    expected_finder: configSide(expected, 'finderPatternId'),
    expected_qr: configSide(expected, 'qrPosition'),
    expected_locator: configSide(expected, 'locatorProfile'),
    expected_locator_arm: configSide(expected, 'locatorArm'),
    expected_locator_layout: configSide(expected, 'locatorLayout'),
    expected_outer_finder: configSide(expected, 'outerFinderId'),
    observed_type: configSide(observed, 'type'),
    observed_version: observed.version == null ? '' : String(observed.version),
    observed_ecc: configSide(observed, 'ecc'),
    observed_tones: configSideNum(observed, 'tones'),
    observed_finder: configSide(observed, 'finderPatternId'),
    observed_qr: configSide(observed, 'qrPosition'),
    observed_locator: configSide(observed, 'locatorProfile'),
    observed_locator_arm: configSide(observed, 'locatorArm'),
    observed_locator_layout: configSide(observed, 'locatorLayout'),
    chain_json: Object.keys(chain).length ? JSON.stringify(chain) : '',
    chain_failed: chain.failed == null ? '' : String(chain.failed),
    bbox_x: geometryField(body, 'bbox_x'),
    bbox_y: geometryField(body, 'bbox_y'),
    bbox_w: geometryField(body, 'bbox_w'),
    bbox_h: geometryField(body, 'bbox_h'),
    occupancy: geometryField(body, 'occupancy'),
    clip_side: geometryField(body, 'clip_side') || '',
    rotation_deg: geometryField(body, 'rotation_deg'),
    perspective: geometryField(body, 'perspective'),
    residual_px: geometryField(body, 'residual_px'),
    geo_stage: geometryString(body, 'geometryStage'),
    detect_path: geometryString(body, 'detectPath'),
    cs_attempted: cellSurfaceFlag(body, 'attempted'),
    cs_accepted: cellSurfaceFlag(body, 'accepted'),
    cs_score: cellSurfaceScore(body),
    cs_reason: cellSurfaceString(body, 'reason'),
    cs_profile: cellSurfaceString(body, 'profile'),
    cs_arm: cellSurfaceString(body, 'arm'),
    cs_expected_arm: cellSurfaceString(body, 'expectedArm'),
    cs_layout: cellSurfaceString(body, 'layoutId'),
    cs_expected_layout: cellSurfaceString(body, 'expectedLayout'),
    cs_orientation_gate: cellSurfaceString(body, 'orientationGate'),
    cs_orientation_gate_applied: cellSurfaceFlag(body, 'orientationGateApplied'),
    cs_ambiguous: cellSurfaceFlag(body, 'ambiguous'),
    body: JSON.stringify(body),
  };
}

function geometryString(body, key) {
  const geo = isPlainObject(body.geometry) ? body.geometry : null;
  if (!geo || geo[key] == null) return '';
  return String(geo[key]);
}

function cellSurfaceFlag(body, key) {
  const cs = isPlainObject(body.cellSurface) ? body.cellSurface : null;
  if (!cs || cs[key] == null) return 0;
  return cs[key] === true ? 1 : 0;
}

function cellSurfaceScore(body) {
  const cs = isPlainObject(body.cellSurface) ? body.cellSurface : null;
  if (!cs) return null;
  return asNullableFloat(cs.score);
}

function cellSurfaceString(body, key) {
  const cs = isPlainObject(body.cellSurface) ? body.cellSurface : null;
  if (!cs || cs[key] == null) return '';
  return String(cs[key]);
}

/** tl_lab.thumbnails 한 행. */
export function thumbnailRow(event) {
  const body = event.body || {};
  const geo = isPlainObject(body.geometry) ? body.geometry : {};
  const bbox = isPlainObject(geo.bbox) ? geo.bbox : {};
  return {
    v: event.v,
    sid: event.sid,
    site: event.site,
    ts: toChDateTime(event.ts),
    seq: asUInt(body.seq),
    w: asUInt(body.w),
    h: asUInt(body.h),
    png: typeof body.png === 'string' ? body.png : '',
    attempt_id: body.attempt_id == null ? '' : String(body.attempt_id),
    config_id: body.config_id == null ? '' : String(body.config_id),
    reason: body.reason == null ? '' : String(body.reason),
    stage: body.stage == null ? '' : String(body.stage),
    shot_role: body.shot_role == null ? '' : String(body.shot_role),
    chain_failed: body.chain_failed == null ? '' : String(body.chain_failed),
    bbox_x: asNullableFloat(bbox.x),
    bbox_y: asNullableFloat(bbox.y),
    bbox_w: asNullableFloat(bbox.w),
    bbox_h: asNullableFloat(bbox.h),
    occupancy: asNullableFloat(geo.occupancy),
    clip_side: typeof geo.clipSide === 'string' ? geo.clipSide : '',
    rotation_deg: asNullableFloat(geo.rotationDeg),
    cell_px: asNullableFloat(geo.cellPx),
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

function asNullableUInt(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function asFloat(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asNullableFloat(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
