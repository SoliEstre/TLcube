/**
 * CQ 기하의 이미지 구조 점수 보정 cursor.
 *
 * 포맷·RS·candidate identity는 알지 못한다. caller가 관측한 H와 그 candidate가
 * 소유한 cellCoord만 snapshot하고, 한 resume마다 H 후보 하나의 전체 셀 점수만 잰다.
 */
import { sampleHexCell } from './grid-sample.js';

const COARSE = Object.freeze({
  scale: Object.freeze([-0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03]),
  translation: Object.freeze([-1, -0.5, 0, 0.5, 1]),
});
const FINE = Object.freeze({
  scale: Object.freeze([-0.005, 0, 0.005]),
  translation: Object.freeze([-0.25, -0.125, 0, 0.125, 0.25]),
});
const GRIDS = Object.freeze([
  Object.freeze({ name: 'coarse', values: COARSE }),
  Object.freeze({ name: 'fine', values: FINE }),
]);
const COORDINATES = Object.freeze([
  Object.freeze({ key: 'scaleX', values: 'scale' }),
  Object.freeze({ key: 'scaleY', values: 'scale' }),
  Object.freeze({ key: 'translateX', values: 'translation' }),
  Object.freeze({ key: 'translateY', values: 'translation' }),
]);
const ZERO_PARAMS = Object.freeze({ scaleX: 0, scaleY: 0, translateX: 0, translateY: 0 });

export const CQ_STRUCTURAL_REFINE_GRID = Object.freeze({
  coordinateOrder: Object.freeze(COORDINATES.map(entry => entry.key)),
  coarse: COARSE,
  fineDeltaAroundCoarse: FINE,
});

function validFrameId(value) {
  return typeof value === 'string' || Number.isSafeInteger(value);
}

function validGeneration(value) {
  return typeof value === 'string' || Number.isSafeInteger(value);
}

function validField(field) {
  return Number.isInteger(field?.width) && Number.isInteger(field?.height)
    && field.width > 0 && field.height > 0
    && field.data instanceof Float32Array
    && field.data.length === field.width * field.height
    && field.data.every(Number.isFinite)
    && (!field.alpha || (field.alpha instanceof Uint8Array
      && field.alpha.length === field.data.length));
}

function validH(H) {
  return H instanceof Float64Array && H.length === 9 && H.every(Number.isFinite);
}

function sameEpoch(left, right) {
  return !!right && left.width === right.width && left.height === right.height
    && left.generation === right.generation;
}

function sameFrame(left, right) {
  return sameEpoch(left, right) && left.frameId === right.frameId
    && left.timestamp === right.timestamp;
}

function imageCenter(H) {
  const w = H[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) throw new TypeError('CQ H 중심을 사영할 수 없어요');
  return Object.freeze({ x: H[2] / w, y: H[5] / w });
}

function correctedHomography(seedH, center, params) {
  const sx = 1 + params.scaleX, sy = 1 + params.scaleY;
  const ax = center.x + params.translateX - sx * center.x;
  const ay = center.y + params.translateY - sy * center.y;
  const out = new Float64Array(9);
  for (let col = 0; col < 3; col += 1) {
    out[col] = sx * seedH[col] + ax * seedH[6 + col];
    out[3 + col] = sy * seedH[3 + col] + ay * seedH[6 + col];
    out[6 + col] = seedH[6 + col];
  }
  return out;
}

function freezeScore(score) {
  return Object.freeze(score);
}

function scoreGeometry(field, H, cellCoord) {
  let totalScore = 0, tieCells = 0, invalidCells = 0, minMargin = Infinity;
  let minPositiveMargin = Infinity;
  const cellCount = cellCoord.length / 2;
  for (let cell = 0; cell < cellCount; cell += 1) {
    const sample = sampleHexCell(field, { H }, cellCoord[2 * cell], cellCoord[2 * cell + 1], {});
    let margin = 0;
    if (!sample.ok || !Number.isFinite(sample.separation)) invalidCells += 1;
    else if (sample.tie === true) tieCells += 1;
    else {
      margin = sample.separation;
      minPositiveMargin = Math.min(minPositiveMargin, margin);
    }
    totalScore += margin;
    minMargin = Math.min(minMargin, margin);
  }
  return freezeScore({ totalScore, minMargin: minMargin === Infinity ? 0 : minMargin,
    minPositiveMargin: minPositiveMargin === Infinity ? 0 : minPositiveMargin,
    tieCells, invalidCells, cellCount });
}

function publicTrial(trial) {
  return Object.freeze({ H: trial.H.slice(), params: trial.params, score: trial.score });
}

/**
 * @param {{width:number,height:number,data:Float32Array,alpha?:Uint8Array|null}} field
 * @param {Float64Array} H
 * @param {Int32Array} cellCoord interleaved q,r pairs for exactly one bound candidate
 * @param {{frameId:string|number,timestamp:number,generation:unknown,width:number,height:number}} origin
 */
export function createCqStructuralRefineCursor(field, H, cellCoord, origin, options = {}) {
  if (!validField(field) || !validH(H) || !(cellCoord instanceof Int32Array)
    || cellCoord.length === 0 || cellCoord.length % 2 !== 0
    || !origin || !validFrameId(origin.frameId) || !Number.isFinite(origin.timestamp)
    || !validGeneration(origin.generation)
    || origin.width !== field.width || origin.height !== field.height) {
    throw new TypeError('완전한 CQ frame, H, cellCoord, origin snapshot이 필요해요');
  }
  const identity = Object.freeze({ frameId: origin.frameId, timestamp: origin.timestamp,
    generation: origin.generation, width: origin.width, height: origin.height });
  const timing = typeof options.timing === 'function' ? options.timing : null;
  const copiedAt = performance.now();
  let snapshot = { width: field.width, height: field.height,
    data: field.data.slice(), alpha: field.alpha?.slice() ?? null };
  let seedH = H.slice(), coordinates = cellCoord.slice();
  const center = imageCenter(seedH);
  const copyMs = performance.now() - copiedAt;
  const snapshotBytes = snapshot.data.byteLength + (snapshot.alpha?.byteLength ?? 0)
    + seedH.byteLength + coordinates.byteLength;
  let snapshotRetainedBytes = snapshotBytes;
  let phase = 'seed', disposalReason = null, lastTimestamp = identity.timestamp;
  let evaluations = 0, maxUnitMs = 0, maxUnit = null;
  let best = null, seedScore = null, coarse = null, result = null;
  let gridIndex = 0, coordinateIndex = 0, deltaIndex = 0;
  let coordinateBase = null, coordinateBest = null;

  function discard(reason = 'discarded') {
    phase = 'discarded'; disposalReason = reason; snapshotRetainedBytes = 0;
    snapshot = seedH = coordinates = best = seedScore = coarse = result = null;
    coordinateBase = coordinateBest = null;
  }

  function trialFor(params) {
    const ownedParams = Object.freeze({ ...params });
    const trialH = correctedHomography(seedH, center, ownedParams);
    return { H: trialH, params: ownedParams,
      score: scoreGeometry(snapshot, trialH, coordinates) };
  }

  function finish() {
    phase = 'done';
    result = Object.freeze({ H: best.H.slice(), params: best.params, score: best.score,
      seedScore, coarse, evaluations, origin: identity });
    snapshotRetainedBytes = 0;
    snapshot = seedH = coordinates = best = coordinateBase = coordinateBest = null;
  }

  function startCoordinate() {
    if (gridIndex === GRIDS.length) { finish(); return; }
    if (coordinateIndex === COORDINATES.length) {
      if (GRIDS[gridIndex].name === 'coarse') coarse = publicTrial(best);
      gridIndex += 1; coordinateIndex = 0;
      startCoordinate();
      return;
    }
    coordinateBase = best.params;
    coordinateBest = best;
    deltaIndex = 0;
    phase = GRIDS[gridIndex].name;
  }

  function nextDelta() {
    const coordinate = COORDINATES[coordinateIndex];
    const values = GRIDS[gridIndex].values[coordinate.values];
    while (deltaIndex < values.length && values[deltaIndex] === 0) deltaIndex += 1;
    if (deltaIndex < values.length) return values[deltaIndex++];
    best = coordinateBest;
    coordinateIndex += 1;
    startCoordinate();
    return phase === 'done' ? null : nextDelta();
  }

  function resume(current = identity) {
    if (phase === 'discarded') return { state: phase, reason: disposalReason };
    if (!sameEpoch(identity, current)) {
      discard('resize-or-generation'); return { state: phase, reason: disposalReason };
    }
    if (!validFrameId(current.frameId) || !Number.isFinite(current.timestamp)
      || current.timestamp < lastTimestamp) {
      discard('invalid-time'); return { state: phase, reason: disposalReason };
    }
    lastTimestamp = current.timestamp;
    if (phase === 'done') return { state: phase, originFrameId: identity.frameId,
      ageMs: current.timestamp - identity.timestamp };

    const unit = phase === 'seed' ? 'seed' : `${phase}.${COORDINATES[coordinateIndex].key}`;
    const started = performance.now();
    let trial;
    if (phase === 'seed') {
      trial = trialFor(ZERO_PARAMS);
      evaluations += 1; best = trial; seedScore = trial.score;
      startCoordinate();
    } else {
      const coordinate = COORDINATES[coordinateIndex];
      const delta = nextDelta();
      if (delta !== null) {
        trial = trialFor({ ...coordinateBase,
          [coordinate.key]: coordinateBase[coordinate.key] + delta });
        evaluations += 1;
        if (trial.score.totalScore > coordinateBest.score.totalScore) coordinateBest = trial;
        // 방금 값이 이 좌표의 마지막 후보면 현재 좌표 승자를 바로 retire한다.
        const values = GRIDS[gridIndex].values[coordinate.values];
        if (!values.slice(deltaIndex).some(value => value !== 0)) {
          best = coordinateBest; coordinateIndex += 1; startCoordinate();
        }
      }
    }
    const ms = performance.now() - started;
    if (ms > maxUnitMs) { maxUnitMs = ms; maxUnit = unit; }
    if (timing) timing({ stage: `cq-structural-refine.${unit}`, ms });
    return { state: phase, unit, ms, evaluated: trial !== undefined,
      evaluations, originFrameId: identity.frameId,
      ageMs: current.timestamp - identity.timestamp };
  }

  return Object.freeze({ resume, discard, reset: () => discard('reset'),
    takeForFrame(current) {
      if (!sameEpoch(identity, current)) { discard('resize-or-generation'); return null; }
      if (phase !== 'done' || !sameFrame(identity, current)) return null;
      return Object.freeze({ H: result.H.slice(), params: result.params, score: result.score,
        seedScore: result.seedScore, coarse: publicTrial(result.coarse), evaluations: result.evaluations,
        origin: result.origin });
    },
    get status() {
      return { phase, origin: identity, evaluations, copyMs, snapshotBytes,
        snapshotRetainedBytes, maxUnitMs, maxUnit, disposalReason };
    },
  });
}
