/** unit-face H 세 면을 직전→현재 광도 추적으로 면마다 옮겨요. */
import { multiply3, trackPhotometric } from './adapter-cube-y.js';
import { DEFAULT_CUBE_Y_CONTINUITY } from './cube-y-identity.js';

const SQRT3_HALF = Math.sqrt(3) / 2;
const EI_X = Object.freeze([SQRT3_HALF, -SQRT3_HALF, 0]);
const EI_Y = Object.freeze([-0.5, -0.5, 1]);
const EJ_X = Object.freeze([-SQRT3_HALF, 0, SQRT3_HALF]);
const EJ_Y = Object.freeze([-0.5, 1, -0.5]);

function determinant(H) {
  return H[0] * (H[4] * H[8] - H[5] * H[7])
    - H[1] * (H[3] * H[8] - H[5] * H[6])
    + H[2] * (H[3] * H[7] - H[4] * H[6]);
}
function validH(H) { return H?.length === 9 && Array.from(H).every(Number.isFinite) && determinant(H) !== 0; }
function project(H, u, v) {
  const w = H[6] * u + H[7] * v + H[8];
  if (!Number.isFinite(w) || w === 0) return null;
  const x = (H[0] * u + H[1] * v + H[2]) / w;
  const y = (H[3] * u + H[4] * v + H[5]) / w;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
function canonicalXY(face, a, b) {
  return { x: a * EI_X[face] + b * EJ_X[face], y: a * EI_Y[face] + b * EJ_Y[face] };
}
const MIN_FACE_POINTS = 20;
const MAX_PYRAMID_LEVELS = 3;
const MIN_PYRAMID_SIDE = 32;

function resolveMinTrackedNcc(value) {
  const ncc = value ?? DEFAULT_CUBE_Y_CONTINUITY.minTrackedNcc;
  if (!Number.isFinite(ncc) || ncc < 0 || ncc > 1) {
    throw new TypeError('minTrackedNcc는 0..1 유한값이어야 해요');
  }
  return ncc;
}

function ownDetail(detail) {
  if (detail === null || detail === undefined) return null;
  if (typeof detail !== 'object') return detail;
  return structuredClone(detail);
}

function failure(reason, pointCount, detail = null) {
  return { ok: false, reason, detail: ownDetail(detail), pointCount, faceHs: null, motion: null, faceMotions: null, perFace: null };
}

function scoreCopy(score) {
  return score ? { count: score.count, coverage: score.coverage, rms: score.rms, p95: score.p95, ncc: score.ncc } : null;
}

function validField(field) {
  return field && Number.isInteger(field.width) && Number.isInteger(field.height)
    && field.width > 1 && field.height > 1 && field.data
    && field.data.length >= field.width * field.height;
}

function downsampleMatrix(s) {
  const scale = 1 / s, shift = 0.5 / s - 0.5;
  return new Float64Array([scale, 0, shift, 0, scale, shift, 0, 0, 1]);
}
function upsampleMatrix(s) {
  return new Float64Array([s, 0, (s - 1) / 2, 0, s, (s - 1) / 2, 0, 0, 1]);
}
function mapPointsThrough(points, D, width, height) {
  const out = [];
  for (const point of points) {
    const x = D[0] * point.x + D[1] * point.y + D[2];
    const y = D[3] * point.x + D[4] * point.y + D[5];
    if (x >= 0 && y >= 0 && x + 1 < width && y + 1 < height) out.push({ x, y, face: point.face, a: point.a, b: point.b });
  }
  return out;
}
function levelToFull(levelH, s) {
  return multiply3(multiply3(upsampleMatrix(s), levelH), downsampleMatrix(s));
}
function levelToLevel(levelH, fromS, toS) {
  return multiply3(multiply3(downsampleMatrix(toS), levelToFull(levelH, fromS)), upsampleMatrix(toS));
}

function downsample2x2(field) {
  const width = Math.floor(field.width / 2), height = Math.floor(field.height / 2);
  const data = new Float32Array(width * height);
  const src = field.data, srcW = field.width;
  for (let y = 0; y < height; y++) {
    const y0 = y * 2;
    for (let x = 0; x < width; x++) {
      const i00 = y0 * srcW + x * 2;
      data[y * width + x] = (src[i00] + src[i00 + 1] + src[i00 + srcW] + src[i00 + srcW + 1]) / 4;
    }
  }
  return { width, height, data };
}

function buildSharedPyramid(previous, current) {
  const started = performance.now();
  const prevLevels = [], currLevels = [];
  let prev = previous, curr = current;
  for (let level = 0; level < MAX_PYRAMID_LEVELS; level++) {
    const width = Math.floor(prev.width / 2), height = Math.floor(prev.height / 2);
    if (width < MIN_PYRAMID_SIDE || height < MIN_PYRAMID_SIDE) break;
    prev = downsample2x2(prev);
    curr = downsample2x2(curr);
    prevLevels.push(prev);
    currLevels.push(curr);
  }
  return { previous: prevLevels, current: currLevels, ms: performance.now() - started };
}

function coarseValid(tracked) {
  return Boolean(tracked?.after) && tracked.after.count >= MIN_FACE_POINTS && validH(tracked.motion)
    && Number.isFinite(tracked.after.ncc) && Number.isFinite(tracked.gain) && tracked.gain > 0;
}
function fullValid(tracked, minTrackedNcc) {
  return coarseValid(tracked) && tracked.after.ncc >= minTrackedNcc;
}
function betterThanDirect(candidate, direct) {
  return Boolean(candidate) && (!coarseValid(direct.tracked) || candidate.after.ncc > direct.tracked.after.ncc);
}

function runTrack(previous, current, points, options) {
  try { return { tracked: trackPhotometric(previous, current, points, options), error: null }; }
  catch (error) { return { tracked: null, error: String(error?.message ?? error) }; }
}

function fallbackFace(previous, current, facePoints, iterations, pyramid, minTrackedNcc) {
  if (!pyramid.previous.length) return { tracked: null, iterations: 0, ms: 0, stages: 0, error: 'no-pyramid-level' };
  let iterationsUsed = 0, msUsed = 0, stages = 0, lastH = null, lastS = null, error = null;
  for (let index = pyramid.previous.length - 1; index >= 0; index--) {
    const s = 2 ** (index + 1);
    const prevL = pyramid.previous[index], currL = pyramid.current[index];
    const D = downsampleMatrix(s);
    const coarsePoints = mapPointsThrough(facePoints, D, prevL.width, prevL.height);
    if (coarsePoints.length < MIN_FACE_POINTS) continue;
    const initial = lastH ? levelToLevel(lastH, lastS, s) : null;
    const ran = runTrack(prevL, currL, coarsePoints, { iterations, initial });
    iterationsUsed += ran.tracked?.iterations ?? 0;
    msUsed += ran.tracked?.ms ?? 0;
    if (!ran.tracked) { error = ran.error; continue; }
    if (!coarseValid(ran.tracked)) continue;
    lastH = ran.tracked.motion;
    lastS = s;
    stages += 1;
  }
  if (!lastH) return { tracked: null, iterations: iterationsUsed, ms: msUsed, stages, error: error ?? 'coarse-unproven' };
  const initial = levelToFull(lastH, lastS);
  const final = runTrack(previous, current, facePoints, { iterations, initial });
  iterationsUsed += final.tracked?.iterations ?? 0;
  msUsed += final.tracked?.ms ?? 0;
  stages += 1;
  if (!final.tracked) return { tracked: null, iterations: iterationsUsed, ms: msUsed, stages, error: final.error };
  if (!fullValid(final.tracked, minTrackedNcc)) {
    return { tracked: null, iterations: iterationsUsed, ms: msUsed, stages, error: 'full-unproven' };
  }
  return { tracked: final.tracked, iterations: iterationsUsed, ms: msUsed, stages, error: null };
}

export function trackCubeYFaces(previous, current, faceHs, options = {}) {
  const gridSide = options.gridSide ?? 16;
  const iterations = options.iterations ?? 30;
  const minTrackedNcc = resolveMinTrackedNcc(options.minTrackedNcc);
  if (!validField(previous) || !validField(current) || previous.width !== current.width || previous.height !== current.height
    || !Array.isArray(faceHs) || faceHs.length !== 3 || faceHs.some((H) => !validH(H))) {
    throw new TypeError('같은 크기 luma 두 장과 unit-face H 3개가 필요해요');
  }
  const started = performance.now();
  const points = cubeYFaceTrackingPoints(faceHs, previous.width, previous.height, { gridSide });
  const byFace = [[], [], []];
  for (const point of points) byFace[point.face].push(point);
  const moved = [];
  const faceMotions = [];
  const perFace = [];
  let nccMin = Infinity, gainMin = Infinity, coverageMin = Infinity, countSum = 0, iterSum = 0;
  let pyramid = null, globalSeed = undefined;
  for (let face = 0; face < 3; face++) {
    const facePoints = byFace[face];
    if (facePoints.length < MIN_FACE_POINTS) {
      return failure('insufficient-visible-points', points.length, { face, count: facePoints.length });
    }
    const direct = runTrack(previous, current, facePoints, { iterations });
    let faceIter = direct.tracked?.iterations ?? 0;
    let faceMs = direct.tracked?.ms ?? 0;
    let adopted = fullValid(direct.tracked, minTrackedNcc) ? direct.tracked : null;
    let fallbackUsed = false, fallbackStages = 0, seedKind = 'direct';
    if (!adopted) {
      pyramid ??= buildSharedPyramid(previous, current);
      const fallback = fallbackFace(previous, current, facePoints, iterations, pyramid, minTrackedNcc);
      faceIter += fallback.iterations;
      faceMs += fallback.ms;
      fallbackStages = fallback.stages;
      if (betterThanDirect(fallback.tracked, direct)) {
        adopted = fallback.tracked;
        fallbackUsed = true;
        seedKind = 'face-pyramid';
      } else {
        if (globalSeed === undefined) {
          globalSeed = fallbackFace(previous, current, points, iterations, pyramid, minTrackedNcc);
        }
        if (globalSeed && !globalSeed.attributed) {
          faceIter += globalSeed.iterations;
          faceMs += globalSeed.ms;
          globalSeed.attributed = true;
        }
        const globalH = globalSeed?.tracked?.motion;
        if (validH(globalH)) {
          const refined = runTrack(previous, current, facePoints, { iterations, initial: globalH });
          faceIter += refined.tracked?.iterations ?? 0;
          faceMs += refined.tracked?.ms ?? 0;
          fallbackStages += 1;
          if (fullValid(refined.tracked, minTrackedNcc) && betterThanDirect(refined.tracked, direct)) {
            adopted = refined.tracked;
            fallbackUsed = true;
            seedKind = 'global-seed';
          }
        }
      }
      if (!adopted) {
        const reason = direct.error ? 'photometric-track-failed' : 'invalid-photometric-result';
        return failure(reason, points.length, {
          face, message: direct.error ?? fallback.error ?? globalSeed?.error,
          fallbackError: fallback.error, globalError: globalSeed?.error ?? null,
        });
      }
    }
    const composed = multiply3(adopted.motion, faceHs[face]);
    if (!validH(composed)) return failure('invalid-composed-face-H', points.length, { face });
    moved.push(composed);
    faceMotions.push(Float64Array.from(adopted.motion));
    perFace.push({
      face, pointCount: facePoints.length, gain: adopted.gain, bias: adopted.bias,
      iterations: faceIter, ms: faceMs,
      before: scoreCopy(adopted.before), after: scoreCopy(adopted.after),
      fallbackUsed, fallbackStages, seedKind,
    });
    nccMin = Math.min(nccMin, adopted.after.ncc);
    gainMin = Math.min(gainMin, adopted.gain);
    coverageMin = Math.min(coverageMin, adopted.after.coverage);
    countSum += adopted.after.count;
    iterSum += faceIter;
  }
  return {
    ok: true, reason: null, pointCount: points.length,
    faceHs: moved.map((H) => Float64Array.from(H)),
    // 세 면에 하나의 전역 H를 곱하지 않아요. 면별 motion만 해당 face-H에 합성해요.
    motion: null,
    before: null,
    after: { count: countSum, ncc: nccMin, coverage: coverageMin, rms: null, p95: null },
    gain: gainMin, bias: null, iterations: iterSum, ms: performance.now() - started,
    pyramidBuildMs: pyramid?.ms ?? 0,
    globalSeedMs: globalSeed?.ms ?? 0,
    globalSeedUsed: perFace.some((row) => row.seedKind === 'global-seed'),
    faceMotions, perFace,
  };
}

/** sampleUnitFaceHsInto와 같은 face basis에서 광도 추적점을 만들어요. */
export function cubeYFaceTrackingPoints(faceHs, width, height, { gridSide = 16 } = {}) {
  if (!Array.isArray(faceHs) || faceHs.length !== 3 || faceHs.some((H) => !validH(H))
    || !Number.isInteger(width) || !Number.isInteger(height) || width <= 1 || height <= 1
    || !Number.isSafeInteger(gridSide) || gridSide <= 0) throw new TypeError('face-H/화면/gridSide가 필요해요');
  const points = [];
  for (let face = 0; face < faceHs.length; face++) {
    const H = faceHs[face];
    for (let row = 0; row < gridSide; row++) for (let column = 0; column < gridSide; column++) {
      const a = (column + 0.5) / gridSide;
      const b = (row + 0.5) / gridSide;
      const canonical = canonicalXY(face, a, b);
      const point = project(H, canonical.x, canonical.y);
      if (point && point.x >= 0 && point.y >= 0 && point.x + 1 < width && point.y + 1 < height) {
        points.push({ x: point.x, y: point.y, face, a, b });
      }
    }
  }
  return points;
}
