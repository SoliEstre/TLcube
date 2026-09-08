/** unit-face H 세 면을 직전→현재 광도 추적으로 함께 옮겨요. */
import { multiply3, trackPhotometric } from '../decoder/c-photometric-track.js';

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
function failure(reason, pointCount, detail = null) {
  return { ok: false, reason, detail, pointCount, faceHs: null, motion: null };
}

export function trackCubeYFaces(previous, current, faceHs, { gridSide = 16, iterations = 30 } = {}) {
  if (!previous?.data || !current?.data || previous.width !== current.width || previous.height !== current.height
    || !Array.isArray(faceHs) || faceHs.length !== 3 || faceHs.some((H) => !validH(H))) {
    throw new TypeError('같은 크기 luma 두 장과 unit-face H 3개가 필요해요');
  }
  const points = [];
  for (const H of faceHs) for (let row = 0; row < gridSide; row++) for (let column = 0; column < gridSide; column++) {
    const point = project(H, (column + 0.5) / gridSide, (row + 0.5) / gridSide);
    if (point && point.x >= 0 && point.y >= 0 && point.x + 1 < previous.width && point.y + 1 < previous.height) points.push(point);
  }
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

