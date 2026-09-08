/** 3D Y 외곽 관측을 budget 사이에서 재개 가능한 unit-face H + CRC 후보로 bind해요. */
import { detectSeedlessBgLinefitCandidates, iterateCubeFaceGeometry, sampleUnitFaceHsInto,
  measureFaceGridConfidence, readFormatFromLocator } from './adapter-cube-y.js';
import { finalLayoutIdsForN, dataCellsInScanOrderCellSurfaceFinal } from '../cellSurfaceFinal.js';
import { LINEUP_NS, GRID_LOCK_GATE_F } from './adapter-locator.js';
import { DEFAULT_R2_PARAMS } from './params.js';
import { buildYLayout } from './y-layout.js';
import { createR2CandidateKey } from './candidate-key.js';

function cloneField(field) {
  if (!field || !Number.isInteger(field.width) || !Number.isInteger(field.height)
    || !(field.data instanceof Float32Array || field.data instanceof Uint8Array || field.data instanceof Uint16Array)
    || field.data.length < field.width * field.height) throw new TypeError('유효한 luma field가 필요해요');
  return { width: field.width, height: field.height, data: new field.data.constructor(field.data) };
}
function ownHs(faceHs) { return faceHs.map((H) => Float64Array.from(H)); }
function cellHs(faceHs, n) {
  return faceHs.map((unit) => {
    const H = Float64Array.from(unit);
    for (const i of [0, 1, 3, 4, 6, 7]) H[i] /= n;
    return H;
  });
}

/**
 * 한 job은 start 시점의 소유 snapshot만 읽어요. 서로 다른 프레임의 관측을 한 epoch로 섞지 않아요.
 * 현재 primitive의 최소 선점 경계는 silhouette 1회와 raw shape 하나의 D6 geometry 열거 1회예요.
 */
export function createCubeYAcquisition() {
  let job = null;
  const lifetime = { starts: 0, resumes: 0, units: 0, maxUnitMs: 0, maxUnitKind: null };
  function reset() { job = null; }
  function start(field, origin = {}) {
    const snapshot = cloneField(field);
    job = { snapshot, origin: { frameId: origin.frameId ?? null, timestamp: origin.timestamp ?? null,
      epoch: origin.epoch ?? lifetime.starts }, phase: 'observe', raw: [], geometries: [], qualified: [], pending: [],
      descriptors: [], rawIndex: 0, geometryIndex: 0, qualifiedIndex: 0, layoutIndex: 0,
      pendingIndex: 0, geometryIterator: null, geometryRawOrdinal: -1,
      geometryOrdinal: 0, observed: 0, geometryCount: 0, complete: false,
      unitCounts: { observe: 0, geometry: 0, confidence: 0, format: 0, candidate: 0 } };
    lifetime.starts++;
  }
  function unit() {
    if (job.phase === 'observe') {
      const observed = detectSeedlessBgLinefitCandidates(job.snapshot);
      job.raw = observed.candidates.map((shape) => ({ ...shape,
        vertices: shape.vertices.map((point) => ({ ...point })) }));
      job.observed = job.raw.length; job.phase = 'geometry';
      return 'observe';
    }
    if (job.phase === 'geometry') {
      if (!job.geometryIterator) {
        if (job.rawIndex >= job.raw.length) { job.phase = 'confidence'; return 'geometry-transition'; }
        job.geometryRawOrdinal = job.rawIndex;
        job.geometryOrdinal = 0;
        job.geometryIterator = iterateCubeFaceGeometry(job.raw[job.rawIndex++].vertices);
      }
      const next = job.geometryIterator.next();
      if (next.done) {
        job.geometryIterator = null;
        if (job.rawIndex >= job.raw.length) job.phase = 'confidence';
        return 'geometry-transition';
      }
      const geometryOrdinal = job.geometryOrdinal++;
      if (next.value.ok) {
        job.geometries.push({ rawOrdinal: job.geometryRawOrdinal, geometryOrdinal, geometry: next.value });
        job.geometryCount++;
      }
      return 'geometry';
    }
    if (job.phase === 'confidence') {
      if (job.geometryIndex >= job.geometries.length) { job.phase = 'format'; return 'confidence-transition'; }
      const row = job.geometries[job.geometryIndex++];
      const confidence = measureFaceGridConfidence(job.snapshot, row.geometry.faceHs, LINEUP_NS);
      const best = confidence.diagnostics.best;
      if (best && best.F >= GRID_LOCK_GATE_F
        && confidence.diagnostics.margin >= DEFAULT_R2_PARAMS.lockMarginMin) {
        job.qualified.push({ ...row, n: best.n, F: best.F, margin: confidence.diagnostics.margin,
          perCellHs: cellHs(row.geometry.faceHs, best.n), layouts: finalLayoutIdsForN(best.n) });
      }
      if (job.geometryIndex >= job.geometries.length) job.phase = 'format';
      return 'confidence';
    }
    if (job.phase === 'format') {
      if (job.qualifiedIndex >= job.qualified.length) { job.phase = 'candidate'; return 'format-transition'; }
      const row = job.qualified[job.qualifiedIndex];
      const layoutOrdinal = job.layoutIndex++;
      const layoutId = row.layouts[layoutOrdinal];
      const read = readFormatFromLocator(job.snapshot,
        { H: row.perCellHs[0], faceHs: row.perCellHs, n: row.n, layoutId });
      if (read.ok) for (const [formatOrdinal, format] of read.candidates.entries()) {
        job.pending.push({ ...row, layoutId, layoutOrdinal, formatOrdinal, format: { ...format } });
      }
      if (job.layoutIndex >= row.layouts.length) { job.qualifiedIndex++; job.layoutIndex = 0; }
      if (job.qualifiedIndex >= job.qualified.length) job.phase = 'candidate';
      return 'format';
    }
    if (job.phase === 'candidate') {
      if (job.pendingIndex >= job.pending.length) { job.phase = 'done'; job.complete = true; return 'candidate-transition'; }
      const row = job.pending[job.pendingIndex++];
      const { geometry, n, layoutId, format } = row;
      const key = createR2CandidateKey({ profile: 'Y', layoutId, dimensionKind: 'side-n', dimension: n,
        ecc: format.eccName, maskIndex: format.maskIndex, wire: format.formatWireVersion,
        tones: format.tones, orientation: geometry.direction.id,
        sourceIdentity: `y-faces:e${job.origin.epoch}:${row.rawOrdinal}:${row.geometryOrdinal}:${geometry.method}` });
      if (key) {
        const faceHs = ownHs(geometry.faceHs);
        const scan = dataCellsInScanOrderCellSurfaceFinal(n, layoutId, format.formatWireVersion);
        const faceLuma = new Uint8Array(scan.length * 3);
        const visibleCells = new Uint8Array(scan.length);
        const visibleCount = sampleUnitFaceHsInto(job.snapshot, faceHs, n, scan, faceLuma, visibleCells);
        job.descriptors.push({ key, n, layoutId, format: { ...format }, faceHs, scan,
          bound: buildYLayout(n, layoutId, format.eccName, format.maskIndex, format.formatWireVersion),
          F: row.F, margin: row.margin, visibleCount, faceLuma, visibleCells,
          rawOrdinal: row.rawOrdinal, geometryOrdinal: row.geometryOrdinal,
          layoutOrdinal: row.layoutOrdinal, formatOrdinal: row.formatOrdinal, geometryMethod: geometry.method });
      }
      if (job.pendingIndex >= job.pending.length) { job.phase = 'done'; job.complete = true; }
      return 'candidate';
    }
    return 'done';
  }
  function resume({ maxAdditionalMs = Infinity, maxWorkUnits = Infinity } = {}) {
    if (!job) throw new Error('start가 먼저 필요해요');
    if (!(maxAdditionalMs === Infinity || (Number.isFinite(maxAdditionalMs) && maxAdditionalMs >= 0))
      || !(maxWorkUnits === Infinity || (Number.isSafeInteger(maxWorkUnits) && maxWorkUnits >= 0))) {
      throw new TypeError('0 이상의 시간/작업 unit budget이 필요해요');
    }
    lifetime.resumes++;
    const started = performance.now(); let units = 0;
    while (!job.complete && units < maxWorkUnits && performance.now() - started < maxAdditionalMs) {
      const unitAt = performance.now(); const kind = unit(); const elapsed = performance.now() - unitAt;
      if (!kind.endsWith('-transition')) {
        job.unitCounts[kind]++; units++; lifetime.units++;
        if (elapsed > lifetime.maxUnitMs) { lifetime.maxUnitMs = elapsed; lifetime.maxUnitKind = kind; }
      }
    }
    return { complete: job.complete, phase: job.phase, units,
      elapsedMs: performance.now() - started, unitCounts: { ...job.unitCounts },
      maxUnitMs: lifetime.maxUnitMs, maxUnitKind: lifetime.maxUnitKind };
  }
  function takeCompleted({ maxCandidates = 8 } = {}) {
    if (!job?.complete) return null;
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 0) throw new TypeError('maxCandidates가 필요해요');
    job.descriptors.sort((a, b) => b.F - a.F || a.rawOrdinal - b.rawOrdinal
      || a.geometryOrdinal - b.geometryOrdinal || a.layoutOrdinal - b.layoutOrdinal
      || a.formatOrdinal - b.formatOrdinal);
    const result = { observed: job.observed, geometryCount: job.geometryCount,
      descriptorCount: job.descriptors.length, candidates: job.descriptors.slice(0, maxCandidates),
      origin: { ...job.origin, field: job.snapshot }, unitCounts: { ...job.unitCounts } };
    job = null;
    return result;
  }
  return Object.freeze({ start, resume, takeCompleted, reset, stats: lifetime,
    get active() { return Boolean(job); }, get phase() { return job?.phase ?? 'idle'; } });
}

/** 동기 호출자는 같은 cursor를 무제한 budget으로 끝까지 소비해요. */
export function observeCubeYCandidates(field, { maxCandidates = 8 } = {}) {
  const acquisition = createCubeYAcquisition();
  acquisition.start(field);
  acquisition.resume({ maxAdditionalMs: Infinity, maxWorkUnits: Infinity });
  return acquisition.takeCompleted({ maxCandidates });
}
