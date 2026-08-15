/**
 * lab-telemetry.js — 시험판(`/lab/`) 전용 계측 클라이언트.
 *
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
export const SHOT_MAX_PER_REASON = 3;
export const SHOT_LATE_RESERVE = 2;
export const FRAME_MS_KEYS = Object.freeze(['total', 'proposal', 'verify', 'format', 'decode']);
export const TIMING_STAGES = Object.freeze(['proposal', 'verify', 'format', 'decode']);
export const CHAIN_STAGES = Object.freeze([
  'input-quality', 'proposal', 'finder', 'geometry', 'sample', 'format', 'body',
]);
export const CONFIG_SIDE_KEYS = Object.freeze([
  'type', 'version', 'ecc', 'tones', 'finderPatternId', 'qrPosition', 'locatorProfile',
  'locatorLayout',
]);
export const GEN_BODY_KEYS = Object.freeze([
  'type', 'version', 'ecc', 'tones', 'finderPatternId', 'qrPosition', 'bgMode', 'quietMode',
  'locatorProfile', 'locatorLayout',
]);

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
 * 단계 시간. `total` 은 벽시계 전체.
 * 측정된 구간만 정수 ms 로 넣고, 측정하지 못한 단계는 null.
 * 마지막 단계에 total 을 복사하지 않는다.
 *
 * 두 번째 인자가 문자열이면 예전 호출 형태다. 도달 단계 힌트일 뿐이며
 * 그 칸에 total 을 넣지 않는다.
 */
export function fillFrameMs(totalMs, measured) {
  const total = finiteMs(totalMs);
  const ms = { total, proposal: null, verify: null, format: null, decode: null };
  const src = measured && typeof measured === 'object' && !Array.isArray(measured)
    ? measured
    : {};
  for (const key of TIMING_STAGES) {
    if (src[key] == null) continue;
    const n = Number(src[key]);
    if (Number.isFinite(n) && n >= 0) ms[key] = Math.round(n);
  }
  return ms;
}

export function timingKey(stage) {
  if (stage === 'proposal' || stage === 'finder' || stage === 'geometry') return 'proposal';
  if (stage === 'verify') return 'verify';
  if (stage === 'format') return 'format';
  if (stage === 'decode' || stage === 'body') return 'decode';
  return null;
}

/** decoder `onStage(stage, 'enter'|'leave')` 를 구간 합으로 모은다. */
export function createStageClock(nowFn = nowMs) {
  const acc = { proposal: 0, verify: 0, format: 0, decode: 0 };
  const measured = { proposal: false, verify: false, format: false, decode: false };
  const open = { proposal: [], verify: [], format: [], decode: [] };

  function onStage(stage, phase) {
    const key = timingKey(stage);
    if (!key) return;
    const t = nowFn();
    if (phase === 'leave') {
      const start = open[key].pop();
      if (start != null) {
        acc[key] += Math.max(0, t - start);
        measured[key] = true;
      }
      return;
    }
    open[key].push(t);
  }

  function snapshot() {
    const t = nowFn();
    const out = { proposal: null, verify: null, format: null, decode: null };
    for (const key of TIMING_STAGES) {
      let value = measured[key] ? acc[key] : 0;
      const stack = open[key];
      if (stack.length > 0) {
        value += Math.max(0, t - stack[stack.length - 1]);
        out[key] = Math.round(value);
      } else if (measured[key]) {
        out[key] = Math.round(acc[key]);
      }
    }
    return out;
  }

  return { onStage, snapshot };
}

export function familyToType(family) {
  if (family === 'hex') return 'O';
  if (family === 'tri') return 'A';
  if (family === 'cube') return 'Y';
  return null;
}

/**
 * 프레임이 코드를 가득 채웠다고 가정한 추정. 와이어의 실측 cellPx 로 쓰지 않는다.
 */
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

export function makeAttemptId(now = Date.now, random = Math.random) {
  return `a${Number(now()).toString(36)}${String(random()).slice(2, 8)}`;
}

export function fnv1a32(text) {
  let hash = 0x811c9dc5;
  const src = String(text);
  for (let i = 0; i < src.length; i += 1) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function canonicalGenConfig(src) {
  const input = src && typeof src === 'object' ? src : {};
  const out = {};
  for (const key of GEN_BODY_KEYS) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    out[key] = input[key];
  }
  return out;
}

export function makeConfigId(config) {
  const norm = canonicalGenConfig(config);
  const keys = Object.keys(norm).sort();
  if (keys.length === 0) return null;
  return `c${fnv1a32(JSON.stringify(keys.map((key) => [key, norm[key]])))}`;
}

export function emptyConfigSide() {
  return {
    type: null,
    version: null,
    ecc: null,
    tones: null,
    finderPatternId: null,
    qrPosition: null,
    locatorProfile: null,
    locatorLayout: null,
  };
}

export function normalizeConfigSide(src) {
  const out = emptyConfigSide();
  if (!src || typeof src !== 'object') return out;
  for (const key of CONFIG_SIDE_KEYS) {
    const value = src[key];
    if (value == null || value === '') {
      out[key] = null;
      continue;
    }
    if (key === 'tones') {
      const n = Number(value);
      out[key] = Number.isFinite(n) ? n : null;
      continue;
    }
    if (key === 'version') {
      const n = Number(value);
      out[key] = Number.isFinite(n) ? n : String(value);
      continue;
    }
    out[key] = String(value);
  }
  return out;
}

export function observedFromResult(result) {
  const out = emptyConfigSide();
  if (!result || typeof result !== 'object') return out;
  if (result.family) out.type = familyToType(result.family);
  if (Number.isFinite(result.version)) out.version = result.version;
  if (typeof result.eccLevel === 'string' && result.eccLevel) out.ecc = result.eccLevel;
  if (Number.isFinite(result.tones)) out.tones = result.tones;
  const hyp = result.hypothesis;
  if (hyp && hyp.centerQr === true) {
    out.qrPosition = 'inner';
    out.finderPatternId = 'center-qr';
  } else if (hyp && (hyp.source === 'center-qr' || hyp.source === 'bullseye')) {
    out.finderPatternId = hyp.source;
    if (hyp.source === 'center-qr') out.qrPosition = 'inner';
  }
  if (hyp && typeof hyp.locatorProfile === 'string' && hyp.locatorProfile) {
    out.locatorProfile = hyp.locatorProfile;
  } else if (hyp && typeof hyp.source === 'string' && hyp.source.startsWith('locator-')) {
    out.locatorProfile = hyp.source.slice('locator-'.length);
  }
  if (hyp && typeof hyp.cellSurfaceLayout === 'string' && hyp.cellSurfaceLayout) {
    out.locatorLayout = hyp.cellSurfaceLayout;
    if (!out.locatorProfile) out.locatorProfile = 'cell-surface-' + hyp.cellSurfaceLayout;
  }
  if (hyp && typeof hyp.locatorArm === 'string' && hyp.locatorArm) {
    out.locatorArm = hyp.locatorArm;
  }
  return out;
}

function emptyChainStage(stage) {
  return { stage, status: 'unknown', reason: null };
}

export function emptyCauseChain() {
  return {
    stages: CHAIN_STAGES.map(emptyChainStage),
    failed: null,
  };
}

function setChain(by, stage, status, reason) {
  const row = by[stage];
  if (!row) return;
  row.status = status;
  row.reason = reason || null;
}

function reachBefore(by, stage) {
  const idx = CHAIN_STAGES.indexOf(stage);
  for (let i = 0; i < idx; i += 1) {
    const name = CHAIN_STAGES[i];
    if (by[name].status === 'unknown') setChain(by, name, 'reached');
  }
}

function lookupDiagnostics(result) {
  const detail = result && result.detail && typeof result.detail === 'object'
    ? result.detail
    : {};
  const cause = detail.cause && typeof detail.cause === 'object' ? detail.cause : null;
  const diagnostics = (result && result.diagnostics)
    || detail.diagnostics
    || (cause && cause.diagnostics)
    || null;
  const bootstrap = diagnostics && diagnostics.bootstrap;
  const geometry = (bootstrap && bootstrap.geometry)
    || (diagnostics && diagnostics.geometry)
    || detail.geometryDiagnostics
    || (cause && cause.geometryDiagnostics)
    || null;
  const validation = (bootstrap && bootstrap.validation)
    || (diagnostics && diagnostics.validation)
    || (detail.diagnostics && detail.diagnostics.validation)
    || (cause && cause.diagnostics && cause.diagnostics.validation)
    || null;
  return { detail, diagnostics, geometry, validation, cause };
}

/**
 * 기존 diagnostics/detail 만으로 도달·실패 사슬을 만든다. 없는 원인을 추정하지 않는다.
 */
export function buildCauseChain(result) {
  const chain = emptyCauseChain();
  const by = Object.fromEntries(chain.stages.map((row) => [row.stage, row]));
  if (!result || typeof result !== 'object') return chain;

  const reason = result.ok === true ? '' : (typeof result.reason === 'string' ? result.reason : '');
  const { detail, diagnostics, geometry, validation } = lookupDiagnostics(result);
  const pipeline = String(detail.pipelineStage || detail.stage || '');
  const code = String(detail.pipelineCode || '');
  const blob = `${reason} ${pipeline} ${code}`.toLowerCase();

  if (result.ok === true) {
    for (const stage of CHAIN_STAGES) setChain(by, stage, 'reached');
    chain.failed = null;
    return chain;
  }

  if (
    reason === 'frontend:empty-input'
    || reason === 'frontend:luma-degenerate'
    || reason === 'frame-invalid'
    || blob.includes('empty-input')
    || blob.includes('luma-degenerate')
    || blob.includes('frame-invalid')
    || blob.includes('options-not-object')
  ) {
    setChain(by, 'input-quality', 'failed', reason || 'input-quality');
    chain.failed = 'input-quality';
    return chain;
  }

  if (reason || diagnostics || pipeline) {
    setChain(by, 'input-quality', 'reached');
  }

  if (geometry && Number(geometry.finderCount) > 0) {
    setChain(by, 'proposal', 'reached');
    setChain(by, 'finder', 'reached');
  }
  if (geometry && Number(geometry.geometryHypothesisCount) > 0) {
    setChain(by, 'proposal', 'reached');
    setChain(by, 'finder', 'reached');
    setChain(by, 'geometry', 'reached');
  }
  if (validation && Number(validation.formatProposalCount) > 0) {
    reachBefore(by, 'format');
    setChain(by, 'format', 'reached');
  }
  if (validation && Number(validation.formatCandidateCount) > 0) {
    reachBefore(by, 'format');
    setChain(by, 'format', 'reached');
  }
  if (validation && Number(validation.bodyValidCount) > 0) {
    reachBefore(by, 'body');
    setChain(by, 'body', 'reached');
  }

  if (reason === 'frontend:no-finder' || /\bno-finder\b/.test(blob)) {
    setChain(by, 'proposal', 'reached');
    setChain(by, 'finder', 'failed', reason);
    chain.failed = 'finder';
    return chain;
  }

  if (reason === 'frontend:family-ambiguous') {
    setChain(by, 'proposal', 'failed', reason);
    reachBefore(by, 'proposal');
    chain.failed = 'proposal';
    return chain;
  }

  if (reason === 'frontend:no-anchors' || reason === 'frontend:homography-degenerate') {
    if (by.finder.status === 'unknown') setChain(by, 'finder', 'reached');
    setChain(by, 'geometry', 'failed', reason);
    reachBefore(by, 'geometry');
    chain.failed = 'geometry';
    return chain;
  }

  if (reason === 'frontend:symbol-clipped') {
    if (pipeline.includes('finder')) {
      setChain(by, 'finder', 'failed', reason);
      reachBefore(by, 'finder');
      chain.failed = 'finder';
      return chain;
    }
    setChain(by, 'geometry', 'failed', reason);
    reachBefore(by, 'geometry');
    chain.failed = 'geometry';
    return chain;
  }

  if (reason === 'frontend:sample-starved' || reason === 'frontend:reference-mismatch') {
    setChain(by, 'sample', 'failed', reason);
    reachBefore(by, 'sample');
    chain.failed = 'sample';
    return chain;
  }

  if (reason === 'frontend:no-format-candidate' || code === 'NO_FORMAT_CANDIDATE') {
    setChain(by, 'format', 'failed', reason || 'frontend:no-format-candidate');
    reachBefore(by, 'format');
    chain.failed = 'format';
    return chain;
  }

  if (
    code === 'BODY_RS_FAILED'
    || code === 'PAYLOAD_VALIDATION_FAILED'
    || blob.includes('body_rs')
    || blob.includes('payload')
    || pipeline.includes('selection')
  ) {
    setChain(by, 'body', 'failed', reason);
    reachBefore(by, 'body');
    chain.failed = 'body';
    return chain;
  }

  if (reason === 'frontend:no-grid-hypothesis') {
    if (validation && Number(validation.formatCandidateCount) > 0) {
      setChain(by, 'body', 'failed', reason);
      reachBefore(by, 'body');
      chain.failed = 'body';
      return chain;
    }
    if (by.geometry.status === 'reached') {
      chain.failed = null;
      return chain;
    }
    setChain(by, 'proposal', 'failed', reason);
    reachBefore(by, 'proposal');
    chain.failed = 'proposal';
    return chain;
  }

  chain.failed = null;
  return chain;
}

export function normalizeCauseChain(src) {
  const fallback = emptyCauseChain();
  if (!src || typeof src !== 'object') return fallback;
  const incoming = Array.isArray(src.stages) ? src.stages : [];
  const byName = new Map();
  for (const row of incoming) {
    if (!row || typeof row !== 'object') continue;
    if (!CHAIN_STAGES.includes(row.stage)) continue;
    const status = row.status === 'reached' || row.status === 'failed' || row.status === 'skipped'
      ? row.status
      : 'unknown';
    byName.set(row.stage, {
      stage: row.stage,
      status,
      reason: typeof row.reason === 'string' && row.reason ? row.reason : null,
    });
  }
  const stages = CHAIN_STAGES.map((stage) => byName.get(stage) || emptyChainStage(stage));
  const failed = CHAIN_STAGES.includes(src.failed) ? src.failed : null;
  return { stages, failed };
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function finiteOrDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bboxFromMinMax(bounds) {
  const minX = finiteOrNull(bounds.minX);
  const minY = finiteOrNull(bounds.minY);
  const maxX = finiteOrNull(bounds.maxX);
  const maxY = finiteOrNull(bounds.maxY);
  if (minX == null || minY == null || maxX == null || maxY == null) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return null;
  return { x: minX, y: minY, w, h };
}

function bboxFromXYWH(src) {
  const x = finiteOrNull(src.x);
  const y = finiteOrNull(src.y);
  const w = finiteOrNull(src.w);
  const h = finiteOrNull(src.h);
  if (x == null || y == null || !(w > 0) || !(h > 0)) return null;
  return { x, y, w, h };
}

function bboxFromBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  if ('minX' in bounds) return bboxFromMinMax(bounds);
  if ('w' in bounds || 'width' in bounds) {
    return bboxFromXYWH({
      x: bounds.x,
      y: bounds.y,
      w: bounds.w != null ? bounds.w : bounds.width,
      h: bounds.h != null ? bounds.h : bounds.height,
    });
  }
  return null;
}

function bboxFromPoints(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return null;
  return { x: minX, y: minY, w, h };
}

function normalizePoints(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out = [];
  for (const point of value) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    out.push({ x: point.x, y: point.y });
  }
  return out;
}

function clipSideFromBbox(bbox, width, height) {
  if (!bbox || !(width > 0) || !(height > 0)) return null;
  const tol = 1;
  const sides = [];
  if (bbox.x <= tol) sides.push('left');
  if (bbox.y <= tol) sides.push('top');
  if (bbox.x + bbox.w >= width - tol) sides.push('right');
  if (bbox.y + bbox.h >= height - tol) sides.push('bottom');
  if (sides.length === 0) return 'none';
  if (sides.length === 1) return sides[0];
  return 'multi';
}

function perspectiveFromCorners(corners) {
  if (!corners || corners.length < 4) return null;
  const a = corners[0];
  const b = corners[1];
  const c = corners[2];
  const d = corners[3];
  const d1 = Math.hypot(a.x - c.x, a.y - c.y);
  const d2 = Math.hypot(b.x - d.x, b.y - d.y);
  if (!(d1 > 0) || !(d2 > 0)) return null;
  const ratio = d1 >= d2 ? d1 / d2 : d2 / d1;
  if (!Number.isFinite(ratio)) return null;
  return ratio - 1;
}

/** 실패 프레임이 도달한 마지막 기하 단계. 앞일수록 덜 갔다. */
export const GEOMETRY_STAGES = Object.freeze([
  'mask', 'component', 'silhouette', 'y-junction', 'finder', 'grid',
]);

export const DETECT_PATHS = Object.freeze(['finder', 'silhouette']);

export function emptyGeometry() {
  return {
    bbox: null,
    corners: null,
    occupancy: null,
    clipSide: null,
    rotationDeg: null,
    perspective: null,
    residualPx: null,
    cellPx: null,
    geometryStage: null,
    detectPath: null,
  };
}

export function emptyCellSurfaceProbe() {
  return {
    attempted: false,
    accepted: false,
    score: null,
    reason: null,
    profile: null,
    arm: null,
    layoutId: null,
    expectedLayout: null,
    orientationGate: null,
    orientationGateApplied: null,
    ambiguous: false,
  };
}

function cubeDiagnosticsOf(cube) {
  if (!cube || typeof cube !== 'object') return null;
  const top = cube.diagnostics || (cube.detail && cube.detail.diagnostics) || null;
  if (!top || typeof top !== 'object') return null;
  if (top.cellSurfaceProbe || Array.isArray(top.geometryReports)) return top;
  if (top.diagnostics && typeof top.diagnostics === 'object'
    && (top.diagnostics.cellSurfaceProbe || Array.isArray(top.diagnostics.geometryReports))) {
    return top.diagnostics;
  }
  return top;
}

function collectGeometryReports(result) {
  const bags = [];
  const { detail, diagnostics, geometry } = lookupDiagnostics(result || {});
  const bootstrap = diagnostics && diagnostics.bootstrap;
  const cubes = [
    diagnostics && diagnostics.cube,
    bootstrap && bootstrap.cube,
    geometry && geometry.cube,
  ];
  for (const cube of cubes) {
    const diag = cubeDiagnosticsOf(cube);
    if (diag && Array.isArray(diag.geometryReports)) bags.push(diag.geometryReports);
    if (diag && diag.cellSurfaceProbe) bags.push([diag.cellSurfaceProbe]);
  }
  const cause = detail && detail.cause;
  const failDiag = cubeDiagnosticsOf(cause && cause.cubeFailure);
  if (failDiag && Array.isArray(failDiag.geometryReports)) bags.push(failDiag.geometryReports);
  if (failDiag && failDiag.cellSurfaceProbe) bags.push([failDiag.cellSurfaceProbe]);
  const out = [];
  for (const bag of bags) {
    for (const entry of bag) {
      if (entry && typeof entry === 'object') out.push(entry);
    }
  }
  return out;
}

/**
 * 셀 표면 검출기가 돌았는지 / 몇 점인지 / 왜 거절됐는지.
 * geometryReports 가 프레임까지 안 나가던 구멍을 메운다.
 */
export function extractCellSurfaceProbe(result) {
  const empty = emptyCellSurfaceProbe();
  const reports = collectGeometryReports(result).filter((entry) =>
    entry.attempted === true
    || entry.attempted === false
    || typeof entry.profile === 'string'
    || entry.accepted === true);
  if (reports.length === 0) return empty;

  let best = reports[0];
  for (const entry of reports) {
    if (entry.accepted === true && best.accepted !== true) {
      best = entry;
      continue;
    }
    const score = Number(entry.score);
    const bestScore = Number(best.score);
    if (entry.accepted === best.accepted
      && Number.isFinite(score)
      && (!Number.isFinite(bestScore) || score > bestScore)) {
      best = entry;
    }
  }
  const score = Number(best.score);
  return {
    attempted: best.attempted !== false,
    accepted: best.accepted === true,
    score: Number.isFinite(score) ? score : null,
    reason: typeof best.reason === 'string' && best.reason ? best.reason : null,
    profile: typeof best.profile === 'string' ? best.profile : null,
    arm: typeof best.arm === 'string' && best.arm ? best.arm : null,
    layoutId: typeof best.layoutId === 'string' && best.layoutId ? best.layoutId : null,
    expectedLayout: typeof best.expectedLayout === 'string' && best.expectedLayout
      ? best.expectedLayout : null,
    orientationGate: typeof best.orientationGate === 'string' && best.orientationGate
      ? best.orientationGate : null,
    orientationGateApplied: best.orientationGateApplied === true
      ? true
      : best.orientationGateApplied === false ? false : null,
    ambiguous: best.ambiguous === true,
  };
}

function normalizeCellSurfaceProbe(src) {
  const empty = emptyCellSurfaceProbe();
  if (!src || typeof src !== 'object') return empty;
  const score = finiteOrNull(src.score);
  return {
    attempted: src.attempted === true,
    accepted: src.accepted === true,
    score: score == null ? null : score,
    reason: typeof src.reason === 'string' && src.reason ? src.reason : null,
    profile: typeof src.profile === 'string' && src.profile ? src.profile : null,
    arm: typeof src.arm === 'string' && src.arm ? src.arm : null,
    layoutId: typeof src.layoutId === 'string' && src.layoutId ? src.layoutId : null,
    expectedLayout: typeof src.expectedLayout === 'string' && src.expectedLayout
      ? src.expectedLayout : null,
    orientationGate: typeof src.orientationGate === 'string' && src.orientationGate
      ? src.orientationGate : null,
    orientationGateApplied: src.orientationGateApplied === true
      ? true
      : src.orientationGateApplied === false ? false : null,
    ambiguous: src.ambiguous === true,
  };
}

const GEOMETRY_STAGE_RANK = Object.freeze(Object.fromEntries(
  GEOMETRY_STAGES.map((name, index) => [name, index + 1]),
));

function betterStage(current, next) {
  const a = current && GEOMETRY_STAGE_RANK[current] ? GEOMETRY_STAGE_RANK[current] : 0;
  const b = next && GEOMETRY_STAGE_RANK[next] ? GEOMETRY_STAGE_RANK[next] : 0;
  return b > a ? next : current;
}

function liftReduced(point, factor) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return { x: point.x * f + (f - 1) / 2, y: point.y * f + (f - 1) / 2 };
}

function shapeCellPx(shape, factor) {
  if (!shape) return null;
  const radius = Number(shape.radius);
  if (!Number.isFinite(radius) || !(radius > 0)) return null;
  const n = Number.isFinite(Number(shape.estimatedN)) && Number(shape.estimatedN) > 0
    ? Number(shape.estimatedN)
    : 21;
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const cellPx = (radius * f) / n;
  return Number.isFinite(cellPx) && cellPx > 0 ? cellPx : null;
}

function collectCubeDiagBags(result) {
  const bags = [];
  const { detail, diagnostics, geometry } = lookupDiagnostics(result || {});
  const bootstrap = diagnostics && diagnostics.bootstrap;
  const cubes = [
    diagnostics && diagnostics.cube,
    bootstrap && bootstrap.cube,
    geometry && geometry.cube,
  ];
  for (const cube of cubes) {
    const diag = cubeDiagnosticsOf(cube);
    if (diag) bags.push(diag);
    if (cube && cube.diagnostics && cube.diagnostics !== diag) bags.push(cube.diagnostics);
  }
  const failSources = [
    detail && detail.cubeFailure,
    detail && detail.cause && detail.cause.cubeFailure,
    result && result.detail && result.detail.cubeFailure,
    geometry && geometry.cube,
  ];
  for (const fail of failSources) {
    const diag = cubeDiagnosticsOf(fail);
    if (diag) bags.push(diag);
    if (fail && fail.detail && fail.detail.diagnostics) bags.push(fail.detail.diagnostics);
    if (fail && fail.diagnostics) bags.push(fail.diagnostics);
  }
  if (diagnostics && typeof diagnostics === 'object') bags.push(diagnostics);
  return bags.filter((bag) => bag && typeof bag === 'object');
}

function inferStageFromShapes(shapes) {
  if (!shapes || typeof shapes !== 'object') return null;
  if (Number(shapes.acceptedShapeCount) > 0) return 'y-junction';
  const counts = shapes.rejectionCounts && typeof shapes.rejectionCounts === 'object'
    ? shapes.rejectionCounts
    : {};
  if (Number(counts['y-junction']) > 0) return 'y-junction';
  if (Number(counts['diagonal-concurrency']) > 0 || Number(counts['mask-fill']) > 0) {
    return 'silhouette';
  }
  if (Number(counts['hull-not-hexagon']) > 0) return 'component';
  const componentCount = Number(shapes.componentCount)
    || Number(shapes.rawComponentCount)
    || 0;
  if (componentCount > 0) return 'component';
  if (typeof shapes.foregroundSource === 'string' && shapes.foregroundSource) return 'mask';
  return null;
}

/**
 * 실패 프레임에서 추정 가능한 지점까지의 기하.
 * 가설이 없어도 실루엣 후보·거부 기록·파인더 시드가 있으면 남긴다.
 * 아무것도 없으면 필드를 null 로 둔다. 거짓 0 을 넣지 않는다.
 */
function extractPartialGeometry(result, width, height) {
  const partial = {
    bbox: null,
    occupancy: null,
    cellPx: null,
    rotationDeg: null,
    geometryStage: null,
    detectPath: null,
  };
  if (!result || typeof result !== 'object') return partial;

  const bags = collectCubeDiagBags(result);
  let stage = null;
  let detectPath = null;
  let bestCell = null;
  let bestBbox = null;

  const { detail, cause } = lookupDiagnostics(result);
  for (const src of [detail, cause, result]) {
    if (!src || typeof src !== 'object') continue;
    if (typeof src.detectPath === 'string' && DETECT_PATHS.includes(src.detectPath)) {
      detectPath = src.detectPath;
    }
    if (typeof src.geometryStage === 'string' && GEOMETRY_STAGE_RANK[src.geometryStage]) {
      stage = betterStage(stage, src.geometryStage);
    }
  }

  for (const bag of bags) {
    if (typeof bag.detectPath === 'string' && DETECT_PATHS.includes(bag.detectPath)) {
      detectPath = bag.detectPath;
    }
    if (typeof bag.geometryStage === 'string' && GEOMETRY_STAGE_RANK[bag.geometryStage]) {
      stage = betterStage(stage, bag.geometryStage);
    }
    const factor = Number(bag.downsampleFactor);
    const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
    const shapes = bag.shapes && typeof bag.shapes === 'object' ? bag.shapes : bag;
    stage = betterStage(stage, inferStageFromShapes(shapes));

    const candidates = Array.isArray(bag.shapeCandidates)
      ? bag.shapeCandidates
      : (Array.isArray(shapes.candidates) ? shapes.candidates : []);
    for (const shape of candidates) {
      if (!shape || typeof shape !== 'object') continue;
      stage = betterStage(stage, 'y-junction');
      const cellPx = shapeCellPx(shape, f);
      if (cellPx != null && (bestCell == null || cellPx > bestCell)) bestCell = cellPx;
      const vertices = Array.isArray(shape.vertices)
        ? shape.vertices.map((point) => liftReduced(point, f)).filter(Boolean)
        : null;
      const bbox = vertices && vertices.length >= 3 ? bboxFromPoints(vertices) : null;
      if (bbox && (!bestBbox || bbox.w * bbox.h > bestBbox.w * bestBbox.h)) bestBbox = bbox;
      if (Number.isFinite(Number(shape.rotationDegrees)) && partial.rotationDeg == null) {
        partial.rotationDeg = Number(shape.rotationDegrees);
      }
    }

    const rejections = Array.isArray(shapes.rejections) ? shapes.rejections : [];
    for (const rejection of rejections) {
      if (!rejection || typeof rejection !== 'object') continue;
      const measured = rejection.measured && typeof rejection.measured === 'object'
        ? rejection.measured
        : rejection;
      if (rejection.stage === 'y-junction') stage = betterStage(stage, 'y-junction');
      else if (rejection.stage === 'diagonal-concurrency' || rejection.stage === 'mask-fill') {
        stage = betterStage(stage, 'silhouette');
      } else if (rejection.stage === 'hull-not-hexagon') {
        stage = betterStage(stage, 'component');
      }
      const cellPx = shapeCellPx(measured, f);
      if (cellPx != null && (bestCell == null || cellPx > bestCell)) bestCell = cellPx;
      const vertices = Array.isArray(measured.vertices)
        ? measured.vertices.map((point) => liftReduced(point, f)).filter(Boolean)
        : null;
      const bbox = vertices && vertices.length >= 3 ? bboxFromPoints(vertices) : null;
      if (bbox && (!bestBbox || bbox.w * bbox.h > bestBbox.w * bestBbox.h)) bestBbox = bbox;
    }

    const finder = bag.finderSeed && typeof bag.finderSeed === 'object' ? bag.finderSeed : bag;
    if (Number(finder.ySpokeCount) > 0 || Number(finder.qrCount) > 0
      || (Array.isArray(finder.seeds) && finder.seeds.length > 0)) {
      stage = betterStage(stage, 'finder');
      if (!detectPath) detectPath = 'finder';
    }
  }

  if (result.hypothesis) stage = betterStage(stage, 'grid');
  const { geometry } = lookupDiagnostics(result);
  if (geometry && Number(geometry.geometryHypothesisCount) > 0) {
    stage = betterStage(stage, 'grid');
  }

  if (bestBbox) {
    partial.bbox = bestBbox;
    if (width > 0 && height > 0) {
      const occupancy = (bestBbox.w * bestBbox.h) / (width * height);
      partial.occupancy = Number.isFinite(occupancy) && occupancy > 0 ? occupancy : null;
    }
  }
  partial.cellPx = bestCell;
  partial.geometryStage = stage;
  if (!detectPath && (bestBbox || bestCell || stage === 'y-junction' || stage === 'silhouette'
    || stage === 'component' || stage === 'mask')) {
    detectPath = 'silhouette';
  }
  partial.detectPath = detectPath;
  return partial;
}

/**
 * 신뢰할 수 있는 diagnostics 만 정규화한다. 측정되지 않으면 null.
 * 좌표는 이미지 픽셀, 원점 좌상단, +x 오른쪽, +y 아래.
 * 실패 프레임도 추정 가능한 지점까지의 기하를 남긴다. 거짓 0 금지.
 */
export function extractGeometry(result, width, height) {
  const geo = emptyGeometry();
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!result || typeof result !== 'object') return geo;

  const hypothesis = result.hypothesis;
  const { detail, geometry } = lookupDiagnostics(result);
  const outline = geometry && geometry.outline;

  let corners = null;
  if (hypothesis) {
    corners = normalizePoints(hypothesis.vertices)
      || normalizePoints(hypothesis.anchors)
      || normalizePoints(hypothesis.corners);
  }
  geo.corners = corners;

  let bbox = corners ? bboxFromPoints(corners) : null;
  if (!bbox && outline && outline.bounds) bbox = bboxFromBounds(outline.bounds);
  geo.bbox = bbox;

  if (bbox && w > 0 && h > 0) {
    const occupancy = (bbox.w * bbox.h) / (w * h);
    geo.occupancy = Number.isFinite(occupancy) && occupancy > 0 ? occupancy : null;
  } else if (outline && Number.isFinite(outline.fillRatio) && outline.fillRatio > 0) {
    geo.occupancy = outline.fillRatio;
  }

  if (Number.isInteger(detail.clippingSideCount)) {
    if (detail.clippingSideCount <= 0) geo.clipSide = 'none';
    else if (detail.clippingSideCount >= 2) geo.clipSide = 'multi';
    else geo.clipSide = clipSideFromBbox(bbox, w, h);
  } else if (outline && outline.touchesBorder === true) {
    geo.clipSide = clipSideFromBbox(bbox, w, h) || 'border';
  } else if (outline && outline.touchesBorder === false) {
    geo.clipSide = 'none';
  }

  if (hypothesis && Number.isFinite(hypothesis.rotationDegrees)) {
    geo.rotationDeg = hypothesis.rotationDegrees;
  }
  if (hypothesis && Number.isFinite(hypothesis.geometryResidual)) {
    geo.residualPx = hypothesis.geometryResidual;
  }
  if (hypothesis && Number.isFinite(hypothesis.cellSizePx) && hypothesis.cellSizePx > 0) {
    geo.cellPx = hypothesis.cellSizePx;
  }
  geo.perspective = perspectiveFromCorners(corners);

  const partial = extractPartialGeometry(result, w, h);
  if (!geo.bbox && partial.bbox) geo.bbox = partial.bbox;
  if (geo.occupancy == null && partial.occupancy != null) geo.occupancy = partial.occupancy;
  if (geo.cellPx == null && partial.cellPx != null) geo.cellPx = partial.cellPx;
  if (geo.rotationDeg == null && partial.rotationDeg != null) geo.rotationDeg = partial.rotationDeg;
  geo.geometryStage = hypothesis ? 'grid' : partial.geometryStage;
  geo.detectPath = typeof (geometry && geometry.detectPath) === 'string'
    && DETECT_PATHS.includes(geometry.detectPath)
    ? geometry.detectPath
    : partial.detectPath;
  if (geo.bbox && geo.occupancy == null && w > 0 && h > 0) {
    const occupancy = (geo.bbox.w * geo.bbox.h) / (w * h);
    geo.occupancy = Number.isFinite(occupancy) && occupancy > 0 ? occupancy : null;
  }
  return geo;
}

export function normalizeGeometry(src) {
  const geo = emptyGeometry();
  if (!src || typeof src !== 'object') return geo;
  geo.bbox = bboxFromXYWH(src.bbox || {}) || bboxFromBounds(src.bbox);
  geo.corners = normalizePoints(src.corners);
  const occupancy = finiteOrNull(src.occupancy);
  geo.occupancy = occupancy == null ? null : occupancy;
  geo.clipSide = typeof src.clipSide === 'string' && src.clipSide ? src.clipSide : null;
  geo.rotationDeg = finiteOrNull(src.rotationDeg);
  geo.perspective = finiteOrNull(src.perspective);
  geo.residualPx = finiteOrNull(src.residualPx);
  const cellPx = finiteOrNull(src.cellPx);
  geo.cellPx = cellPx != null && cellPx > 0 ? cellPx : null;
  geo.geometryStage = typeof src.geometryStage === 'string' && src.geometryStage
    ? src.geometryStage
    : null;
  geo.detectPath = typeof src.detectPath === 'string' && src.detectPath
    ? src.detectPath
    : null;
  return geo;
}

export function frameHasCandidate(result, geometry) {
  if (result && result.ok === true) return true;
  if (result && result.hypothesis) return true;
  const { geometry: geoDiag } = lookupDiagnostics(result || {});
  if (geoDiag && Number(geoDiag.finderCount) > 0) return true;
  if (geoDiag && Number(geoDiag.geometryHypothesisCount) > 0) return true;
  if (geometry && geometry.bbox) return true;
  if (geometry && geometry.corners && geometry.corners.length >= 3) return true;
  return false;
}

export function rootReasonOf(reason, ok) {
  if (ok === true) return 'ok';
  return typeof reason === 'string' && reason ? reason : 'unknown';
}

/**
 * 시도·사유를 가로지르는 상한 샘플러.
 * 세션 첫 실패 20장이 한도를 독점하지 않게, 늦은 성공/직전 실패를 위해 2칸을 비워 둔다.
 */
export function createShotSampler(options = {}) {
  const maxTotal = Number.isFinite(options.maxTotal) ? options.maxTotal : MAX_SHOTS;
  const maxPerReason = Number.isFinite(options.maxPerReason)
    ? options.maxPerReason
    : SHOT_MAX_PER_REASON;
  const lateReserve = Number.isFinite(options.lateReserve)
    ? options.lateReserve
    : SHOT_LATE_RESERVE;

  let emitted = 0;
  const reasonCounts = new Map();
  const firstCandidateAttempts = new Set();
  const successAttempts = new Set();

  function canEmitRegular() {
    return emitted < Math.max(0, maxTotal - lateReserve);
  }

  function canEmitLate() {
    return emitted < maxTotal;
  }

  function note(reason) {
    emitted += 1;
    const key = rootReasonOf(reason, reason === 'ok');
    reasonCounts.set(key, (reasonCounts.get(key) || 0) + 1);
  }

  function decide(input) {
    const attemptId = input && input.attemptId ? String(input.attemptId) : '';
    const ok = !!(input && input.ok);
    const reason = rootReasonOf(input && input.reason, ok);
    const count = reasonCounts.get(reason) || 0;

    if (ok) {
      if (successAttempts.has(attemptId) || !canEmitLate()) {
        return { action: 'skip', role: 'success-dup' };
      }
      successAttempts.add(attemptId);
      note('ok');
      return { action: 'emit', role: 'success' };
    }

    if (input && input.hasCandidate && attemptId && !firstCandidateAttempts.has(attemptId)
      && canEmitRegular()) {
      firstCandidateAttempts.add(attemptId);
      note(reason);
      return { action: 'emit', role: 'first-candidate' };
    }

    if (count === 0 && canEmitRegular()) {
      note(reason);
      return { action: 'emit', role: 'new-reason' };
    }

    if (count < maxPerReason && canEmitRegular()) {
      note(reason);
      return { action: 'emit', role: 'reason-sample' };
    }

    // 성공·성공 직전만 늦은 예약 칸을 쓴다. 시도 종료 flush 가 그 칸을 먹으면
    // 이후 성공 프레임이 빠진다.
    if (input && input.flush === 'pre-success' && canEmitLate()) {
      note(reason);
      return { action: 'emit', role: 'pre-success' };
    }
    if (input && input.flush === 'attempt-end' && canEmitRegular()) {
      note(reason);
      return { action: 'emit', role: 'attempt-end' };
    }

    return { action: input && input.flush ? 'skip' : 'hold-last', role: 'hold-last' };
  }

  return {
    decide,
    get emitted() { return emitted; },
    reasonCount(reason) { return reasonCounts.get(rootReasonOf(reason, reason === 'ok')) || 0; },
    maxTotal,
  };
}

function finiteMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function nullableMs(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function isoNow() {
  return new Date().toISOString();
}

function nullableString(value) {
  if (value == null) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
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
  const ms = { total: finiteMs(msIn.total) };
  for (const key of TIMING_STAGES) ms[key] = nullableMs(msIn[key]);
  const type = src.type == null ? null : String(src.type);
  const geometry = normalizeGeometry(src.geometry);
  let cellPx = src.cellPx == null ? geometry.cellPx : Number(src.cellPx);
  if (!Number.isFinite(cellPx) || cellPx <= 0) cellPx = geometry.cellPx;
  if (!Number.isFinite(cellPx) || cellPx <= 0) cellPx = null;
  return {
    seq: Number.isFinite(Number(src.seq)) ? Number(src.seq) : 0,
    w: Number(src.w) || 0,
    h: Number(src.h) || 0,
    zoom: Number.isFinite(Number(src.zoom)) ? Number(src.zoom) : 1,
    zoomRequested: finiteOrDefault(src.zoomRequested, Number.isFinite(Number(src.zoom)) ? Number(src.zoom) : 1),
    crop: finiteOrDefault(src.crop, 1),
    cropRequested: finiteOrDefault(src.cropRequested, finiteOrDefault(src.crop, 1)),
    effectiveZoom: finiteOrDefault(
      src.effectiveZoom,
      (Number.isFinite(Number(src.zoom)) ? Number(src.zoom) : 1) * finiteOrDefault(src.crop, 1),
    ),
    zoomError: typeof src.zoomError === 'string' && src.zoomError ? src.zoomError : '',
    ms,
    stage: typeof src.stage === 'string' && src.stage.length > 0 ? src.stage : 'proposal',
    ok: src.ok === true,
    reason: typeof src.reason === 'string' ? src.reason : '',
    type,
    cellPx,
    attempt_id: nullableString(src.attempt_id),
    config_id: nullableString(src.config_id),
    expected: normalizeConfigSide(src.expected),
    observed: normalizeConfigSide(src.observed),
    chain: normalizeCauseChain(src.chain),
    geometry,
    cellSurface: mergeExpectedArmIntoProbe(
      normalizeCellSurfaceProbe(src.cellSurface),
      src.expected,
    ),
  };
}

function mergeExpectedArmIntoProbe(probe, expected) {
  if (!probe || probe.expectedLayout) return probe;
  const layout = expected && typeof expected.locatorLayout === 'string'
    ? expected.locatorLayout
    : null;
  if (!layout) return probe;
  return { ...probe, expectedLayout: layout };
}

export function normalizeGenBody(body) {
  const out = canonicalGenConfig(body);
  const configId = makeConfigId(out);
  if (configId) out.config_id = configId;
  return out;
}

export function normalizeFrameShotBody(body) {
  const src = body && typeof body === 'object' ? body : {};
  return {
    seq: Number.isFinite(Number(src.seq)) ? Number(src.seq) : 0,
    w: Number(src.w) || 0,
    h: Number(src.h) || 0,
    png: typeof src.png === 'string' ? src.png : '',
    attempt_id: nullableString(src.attempt_id),
    config_id: nullableString(src.config_id),
    reason: typeof src.reason === 'string' ? src.reason : '',
    stage: typeof src.stage === 'string' ? src.stage : '',
    shot_role: typeof src.shot_role === 'string' ? src.shot_role : '',
    chain_failed: typeof src.chain_failed === 'string' ? src.chain_failed : '',
    geometry: normalizeGeometry(src.geometry),
  };
}

/**
 * ⚠ 전진 폭은 **반드시 `chunk`** 다. `i += 1` 이면 매 반복이 «남은 배열 전체» 를 다시
 *   이어붙여 O(n²) 로 커진다 — 29KB PNG 하나가 426MB 문자열이 됐고(실측), 그 결과
 *   ① 프레임당 수 초가 사라지고 ② data URI 가 MAX_SHOT_CHARS 를 넘겨 캡처가 통째로
 *   버려졌다. node 는 위 Buffer 분기를 타서 이 경로를 **안 지나므로 테스트가 못 잡는다** —
 *   `lab-telemetry.test.js` 가 Buffer 를 지워 이 분기를 강제로 밟는 이유다.
 */
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
    attemptId: '',
    emit: noop,
    env: noop,
    gen: noop,
    frame: noop,
    frameShot: noop,
    beginAttempt: () => '',
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
  let closed = false;
  let attemptId = '';
  const sampler = createShotSampler();
  const heldByAttempt = new Map();

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

  function emitShotRecord(record, roleOverride) {
    if (!record || !record.shot) return;
    const shot = normalizeFrameShotBody({
      ...record.meta,
      ...record.shot,
      shot_role: roleOverride || record.meta.shot_role || '',
    });
    if (sampler.emitted > sampler.maxTotal) return;
    emit('frameShot', shot);
  }

  function flushHeld(id, role) {
    if (!id || !heldByAttempt.has(id)) return;
    const held = heldByAttempt.get(id);
    heldByAttempt.delete(id);
    const decision = sampler.decide({
      ok: false,
      reason: held.meta.reason,
      attemptId: id,
      hasCandidate: held.meta.hasCandidate,
      flush: role === 'pre-success' ? 'pre-success' : 'attempt-end',
    });
    if (decision.action === 'emit') emitShotRecord(held, role || decision.role);
  }

  function beginAttempt(nextId) {
    const previous = attemptId;
    if (previous && previous !== nextId) flushHeld(previous, 'attempt-end');
    attemptId = nextId || makeAttemptId();
    return attemptId;
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
    get attemptId() { return attemptId; },
    emit,
    beginAttempt,
    env(body) { emit('env', body && typeof body === 'object' ? body : {}); },
    gen(body) { emit('gen', normalizeGenBody(body)); },
    frame(body) {
      const normalized = normalizeFrameBody({
        ...body,
        attempt_id: body && body.attempt_id != null ? body.attempt_id : (attemptId || null),
      });
      emit('frame', normalized);
    },
    frameShot(input) {
      const image = input && input.imageData ? input.imageData : input;
      const shot = shrinkFrameShot(image);
      if (!shot) return;
      const id = nullableString(input && input.attempt_id) || attemptId || '';
      const reason = input && input.ok === true
        ? 'ok'
        : (typeof (input && input.reason) === 'string' ? input.reason : '');
      const meta = {
        seq: Number.isFinite(Number(input && input.seq)) ? Number(input.seq) : 0,
        attempt_id: id || null,
        config_id: nullableString(input && input.config_id),
        reason: input && input.ok === true ? '' : reason,
        stage: typeof (input && input.stage) === 'string' ? input.stage : '',
        chain_failed: typeof (input && input.chain_failed) === 'string' ? input.chain_failed : '',
        geometry: normalizeGeometry(input && input.geometry),
        hasCandidate: !!(input && input.hasCandidate),
      };
      if (input && input.ok === true) flushHeld(id, 'pre-success');
      const decision = sampler.decide({
        ok: input && input.ok === true,
        reason,
        attemptId: id,
        hasCandidate: meta.hasCandidate,
      });
      if (decision.action === 'hold-last') {
        heldByAttempt.set(id, { shot, meta });
        return;
      }
      if (decision.action !== 'emit') return;
      emitShotRecord({ shot, meta: { ...meta, shot_role: decision.role } }, decision.role);
    },
    close() {
      if (attemptId) flushHeld(attemptId, 'attempt-end');
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
