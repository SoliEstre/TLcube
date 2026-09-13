/** 3D Y 외곽 관측을 budget 사이에서 재개 가능한 unit-face H + CRC 후보로 bind해요. */
import { detectSeedlessBgLinefitCandidatesSteps, iterateCubeFaceGeometry, sampleUnitFaceHsInto,
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
function ownBound(bound) {
  return { ...bound, maskDigits: bound.maskDigits ? new Uint8Array(bound.maskDigits) : bound.maskDigits };
}
function ownDescriptor(row) {
  return {
    key: row.key, n: row.n, layoutId: row.layoutId, format: { ...row.format },
    faceHs: ownHs(row.faceHs), scan: row.scan.map((point) => ({ ...point })), bound: ownBound(row.bound),
    F: row.F, margin: row.margin, visibleCount: row.visibleCount,
    faceLuma: new Uint8Array(row.faceLuma), visibleCells: new Uint8Array(row.visibleCells),
    rawOrdinal: row.rawOrdinal, geometryOrdinal: row.geometryOrdinal,
    layoutOrdinal: row.layoutOrdinal, formatOrdinal: row.formatOrdinal, geometryMethod: row.geometryMethod,
  };
}

/**
 * 한 job은 start 시점의 소유 snapshot만 읽어요. 서로 다른 프레임의 관측을 한 epoch로 섞지 않아요.
 * silhouette 행/화소 블록과 D6 geometry 한 건을 각각 선점 경계로 사용해요.
 * geometry 하나가 생기면 그 후속 confidence→format→candidate는 stage-wide barrier 없이
 * 같은 job의 bounded pipeline unit으로만 이어져요.
 */
export function createCubeYAcquisition() {
  let job = null;
  const lifetime = { starts: 0, resumes: 0, units: 0, maxUnitMs: 0, maxUnitKind: null };
  function reset() { job?.observationIterator?.return?.(); job?.geometryIterator?.return?.(); job = null; }
  function start(field, origin = {}) {
    const snapshot = cloneField(field);
    job = { snapshot, origin: { frameId: origin.frameId ?? null, timestamp: origin.timestamp ?? null,
      epoch: origin.epoch ?? lifetime.starts }, phase: 'observe', raw: [], descriptors: [], ready: [], rawIndex: 0,
      observationIterator: null, geometryIterator: null, geometryRawOrdinal: -1, pipeline: [],
      geometryOrdinal: 0, observed: 0, geometryCount: 0, complete: false,
      unitCounts: { observe: 0, geometry: 0, confidence: 0, format: 0, candidate: 0 } };
    lifetime.starts++;
  }
  function finishJob() {
    job.phase = 'done';
    job.complete = true;
    return 'geometry-transition';
  }
  function unit() {
    if (!job || job.complete || job.phase === 'done') {
      if (job) { job.phase = 'done'; job.complete = true; }
      return 'done-transition';
    }
    if (job.phase === 'observe') {
      job.observationIterator ??= detectSeedlessBgLinefitCandidatesSteps(job.snapshot);
      const step = job.observationIterator.next();
      if (!step.done) return 'observe';
      const observed = step.value;
      job.observationIterator = null;
      job.raw = observed.candidates.map((shape) => ({ ...shape,
        vertices: shape.vertices.map((point) => ({ ...point })) }));
      job.observed = job.raw.length; job.phase = 'geometry';
      return 'observe';
    }
    if (job.phase === 'geometry') {
      // 한 geometry의 후속 단계를 모두 비운 뒤에만 다음 geometry를 열어요. 따라서
      // ready 순서는 raw/geometry/layout/format ordinal의 발견 순서이며, runtime은 이
      // 순서로 capacity를 채웁니다. 전부 끝난 동기 API만 F 우선 최종 정렬을 적용해요.
      if (job.pipeline.length > 0) return job.pipeline.shift()();
      if (!job.geometryIterator) {
        if (job.rawIndex >= job.raw.length) return finishJob();
        job.geometryRawOrdinal = job.rawIndex;
        job.geometryOrdinal = 0;
        job.geometryIterator = iterateCubeFaceGeometry(job.raw[job.rawIndex++].vertices);
      }
      const next = job.geometryIterator.next();
      if (next.done) {
        job.geometryIterator = null;
        return 'geometry-transition';
      }
      const geometryOrdinal = job.geometryOrdinal++;
      if (next.value.ok) {
        job.geometryCount++;
        const geometry = { ...next.value, faceHs: ownHs(next.value.faceHs) };
        const row = { rawOrdinal: job.geometryRawOrdinal, geometryOrdinal, geometry };
        // 각 후속 primitive는 별도 unit이에요. silhouette/geometry 자체를 더 잘게
        // 쪼갤 수는 없지만, stage-wide barrier는 만들지 않아요.
        job.pipeline.push(() => {
          const confidence = measureFaceGridConfidence(job.snapshot, row.geometry.faceHs, LINEUP_NS);
          const best = confidence.diagnostics.best;
          if (best && best.F >= GRID_LOCK_GATE_F
            && confidence.diagnostics.margin >= DEFAULT_R2_PARAMS.lockMarginMin) {
            const qualified = { ...row, n: best.n, F: best.F, margin: confidence.diagnostics.margin,
              perCellHs: cellHs(row.geometry.faceHs, best.n), layouts: finalLayoutIdsForN(best.n) };
            for (const [layoutOrdinal, layoutId] of qualified.layouts.entries()) {
              job.pipeline.push(() => {
                const read = readFormatFromLocator(job.snapshot,
                  { H: qualified.perCellHs[0], faceHs: qualified.perCellHs, n: qualified.n, layoutId });
                if (read.ok) for (const [formatOrdinal, format] of read.candidates.entries()) {
                  const pending = { ...qualified, layoutId, layoutOrdinal, formatOrdinal, format: { ...format } };
                  job.pipeline.push(() => descriptorUnit(pending));
                }
                return 'format';
              });
            }
          }
          return 'confidence';
        });
      }
      return 'geometry';
    }
    return finishJob();
  }
  function descriptorUnit(row) {
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
        const descriptor = { key, n, layoutId, format: { ...format }, faceHs, scan,
          bound: buildYLayout(n, layoutId, format.eccName, format.maskIndex, format.formatWireVersion),
          F: row.F, margin: row.margin, visibleCount, faceLuma, visibleCells,
          rawOrdinal: row.rawOrdinal, geometryOrdinal: row.geometryOrdinal,
          layoutOrdinal: row.layoutOrdinal, formatOrdinal: row.formatOrdinal, geometryMethod: geometry.method };
        job.descriptors.push(descriptor);
        job.ready.push(ownDescriptor(descriptor));
      }
      return 'candidate';
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
  function takeReady({ maxCandidates = 8 } = {}) {
    if (!job) return null;
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 0) throw new TypeError('maxCandidates가 필요해요');
    const candidates = job.ready.splice(0, maxCandidates);
    return { candidates, origin: { ...job.origin, field: cloneField(job.snapshot) }, complete: job.complete,
      observed: job.observed, geometryCount: job.geometryCount,
      descriptorCount: job.descriptors.length, unitCounts: { ...job.unitCounts } };
  }
  return Object.freeze({ start, resume, takeCompleted, takeReady, reset, stats: lifetime,
    get active() { return Boolean(job); }, get phase() { return job?.phase ?? 'idle'; },
    get readyCount() { return job?.ready.length ?? 0; } });
}

/** 동기 호출자는 같은 cursor를 무제한 budget으로 끝까지 소비해요. */
export function observeCubeYCandidates(field, { maxCandidates = 8 } = {}) {
  const acquisition = createCubeYAcquisition();
  acquisition.start(field);
  acquisition.resume({ maxAdditionalMs: Infinity, maxWorkUnits: Infinity });
  return acquisition.takeCompleted({ maxCandidates });
}
