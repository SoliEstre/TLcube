/* Public-consumption proposal: H HUD projective/staleness/mapping edge regressions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  H_LIVE_FACE_MAX_AGE_MS, hFrameToStageMapping, hLiveFaceLabelsModel,
} from '../src/h-face-hud.js';

const identityMapping = hFrameToStageMapping({
  frameCrop: { sourceX: 0, sourceY: 0, sourceSide: 100, target: 100 },
  stageCrop: { x: 0, y: 0, width: 100, height: 100 }, side: 100,
});
function stats({ observedAt = 1000, observedFaces } = {}) {
  return {
    required: 3, leadingId: 'hud', observedAt, frameWidth: 100, frameHeight: 100,
    observedFaces: observedFaces ?? [{ face: 'ZM', n: 1, H: [1, 0, 0, 0, 1, 0, 0, 0, 1], quality: { score: 1 } }],
    assemblies: [{ id: 'hud', present: ['ZM'], expiresAt: 9000, faceExpiresAt: { ZM: 9000 } }],
  };
}
const live = (input) => hLiveFaceLabelsModel({ ...input, source: 'camera', cameraActive: true, runtimeEnabled: true, mapping: identityMapping });

test('nonzero projective H keeps all four finite ordered stage corners and matrix3d denominator terms', () => {
  const H = [0.7, 0.1, 0.1, 0.05, 0.65, 0.15, 0.15, 0.05, 1];
  const labels = live({ stats: stats({ observedFaces: [{ face: 'ZM', n: 1, H, quality: { score: 4 } }] }), now: 1200 });
  assert.equal(labels.length, 1);
  assert.notEqual(labels[0].H[6], 0, 'projective x denominator was flattened');
  assert.notEqual(labels[0].H[7], 0, 'projective y denominator was flattened');
  assert.match(labels[0].matrix3d, /^matrix3d\(/);
  assert.equal(new Set(labels[0].corners.map(({ x, y }) => `${x.toFixed(8)},${y.toFixed(8)}`)).size, 4);
  for (const point of labels[0].corners) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1, 'valid edge-bounded projection escaped stage');
  }
});

test('stale, future, and denominator-zero observations never leave a live HUD label', () => {
  const base = stats();
  assert.equal(live({ stats: base, now: 1000 + H_LIVE_FACE_MAX_AGE_MS }).length, 1, 'TTL boundary must remain live');
  assert.deepEqual(live({ stats: base, now: 1001 + H_LIVE_FACE_MAX_AGE_MS }), [], 'one millisecond past TTL must clear label');
  assert.deepEqual(live({ stats: stats({ observedAt: 1001 }), now: 1000 }), [], 'future observation must not become live');
  const singular = stats({ observedFaces: [{ face: 'ZM', n: 1, H: [1, 0, 0, 0, 1, 0, -1, 0, 1], quality: { score: 1 } }] });
  assert.deepEqual(live({ stats: singular, now: 1200 }), [], 'edge denominator zero must hide label');
  const crossing = stats({ observedFaces: [{ face: 'ZM', n: 1, H: [1, 0, 0, 0, 1, 0, -2, 0, 1], quality: { score: 1 } }] });
  assert.deepEqual(live({ stats: crossing, now: 1200 }), [], 'interior denominator crossing must hide label');
});

test('invalid crop mappings fail closed, including mirror and zero/negative edge bounds', () => {
  const valid = { frameCrop: { sourceX: 2, sourceY: 3, sourceSide: 80, target: 40 }, stageCrop: { x: 10, y: 20, width: 160, height: 80 }, side: 320 };
  assert.equal(hFrameToStageMapping(valid)?.verified, true);
  for (const bad of [
    { ...valid, mirrorX: true },
    { ...valid, side: 0 },
    { ...valid, frameCrop: { ...valid.frameCrop, sourceSide: 0 } },
    { ...valid, frameCrop: { ...valid.frameCrop, target: -1 } },
    { ...valid, stageCrop: { ...valid.stageCrop, width: 0 } },
    { ...valid, stageCrop: { ...valid.stageCrop, height: -1 } },
  ]) assert.equal(hFrameToStageMapping(bad), null);
  assert.deepEqual(hLiveFaceLabelsModel({ stats: stats(), now: 1200, source: 'camera', cameraActive: true, runtimeEnabled: true, mapping: { verified: true, mirrorX: false, frameToStage: { xScale: 0, xOffset: 0, yScale: 1, yOffset: 0 } } }), []);
});
