/** unit-face H 세 면을 직전→현재 광도 추적으로 함께 옮겨요. */
import { multiply3, trackPhotometric } from './adapter-cube-y.js';

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
function failure(reason, pointCount, detail = null) {
  return { ok: false, reason, detail, pointCount, faceHs: null, motion: null };
}

export function trackCubeYFaces(previous, current, faceHs, { gridSide = 16, iterations = 30 } = {}) {
  if (!previous?.data || !current?.data || previous.width !== current.width || previous.height !== current.height
    || !Array.isArray(faceHs) || faceHs.length !== 3 || faceHs.some((H) => !validH(H))) {
    throw new TypeError('같은 크기 luma 두 장과 unit-face H 3개가 필요해요');
  }
  const points = cubeYFaceTrackingPoints(faceHs, previous.width, previous.height, { gridSide });
  if (points.length < 20) return failure('insufficient-visible-points', points.length);
  let tracked;
  try { tracked = trackPhotometric(previous, current, points, { iterations }); }
  catch (error) { return failure('photometric-track-failed', points.length, String(error?.message ?? error)); }
  if (!tracked.after || tracked.after.count < 20 || !validH(tracked.motion)) {
    return failure('invalid-photometric-result', points.length);
  }
  const moved = faceHs.map((H) => multiply3(tracked.motion, H));
  if (moved.some((H) => !validH(H))) return failure('invalid-composed-face-H', points.length);
  return { ok: true, reason: null, pointCount: points.length, faceHs: moved.map((H) => Float64Array.from(H)),
    motion: Float64Array.from(tracked.motion), before: { ...tracked.before }, after: { ...tracked.after },
    gain: tracked.gain, bias: tracked.bias, iterations: tracked.iterations, ms: tracked.ms };
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
