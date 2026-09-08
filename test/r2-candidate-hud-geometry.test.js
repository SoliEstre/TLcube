import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateHudBounds, candidateHudFrameGeometry, candidateHudGeometry, candidateHudQuadSlot } from '../src/r2/candidate-hud-geometry.js';
import { R2_TYPE_C_PROFILE } from '../src/r2/profiles/c.js';
import { syntheticC } from './r2-c-fixtures.js';
import { enumerateCubeFaceGeometry } from '../src/decoder/cube-face-geometry.js';
import { hexCorners } from '../src/hexgrid.js';
import { faceBasis } from '../src/ygrid.js';
import { projectPoint } from '../src/decoder/homography.js';

function cRow() {
  const fixture = syntheticC(0);
  const bound = R2_TYPE_C_PROFILE.bind({ profile: 'C', layoutId: 'C0', dimension: fixture.k,
    ecc: 'M', wire: 1, tones: 3, maskIndex: 0, orientation: 0, sourceIdentity: 'hud-c-fixture' });
  assert.ok(bound);
  return { id: 'c-actual', revision: 7, type: 'C', geometryMode: 'c-hex',
    k: fixture.k, n: fixture.k, dimensionKind: bound.dimensionKind,
    H: Float64Array.from(fixture.H), cellCount: bound.cellCount,
    cellCoord: Int32Array.from(bound.cellCoord), cellMap: new Uint8Array(bound.cellCount),
    frameWidth: fixture.field.width, frameHeight: fixture.field.height };
}

test('C HUD는 실제 C bind의 own cellCoord·H에서만 육각 face를 유도한다', () => {
  const row = cRow();
  const geometry = candidateHudGeometry(row);
  assert.equal(geometry.mode, 'c-hex');
  assert.equal(geometry.count, row.cellCount);
  assert.equal(geometry.quads.length, row.cellCount * 3 * 8);
  assert.equal(candidateHudQuadSlot(geometry, 0, 2), 16);
  const canonicalBounds = candidateHudBounds(geometry);
  assert.ok(canonicalBounds);
  const frame = candidateHudFrameGeometry(row, geometry);
  assert.ok(frame);
  assert.notDeepEqual(Array.from(frame.quads.subarray(0, 8)), Array.from(geometry.quads.subarray(0, 8)));
  const bounds = candidateHudBounds(frame);
  assert.ok(bounds && bounds[2] > bounds[0] && bounds[3] > bounds[1]);
  assert.ok(geometry.outlineCount > 6, '고정 k 반경 육각이 아니라 실제 노치 제외 C 영역의 hull이어야 한다');
  for (let point = 0; point < geometry.quads.length; point += 2) {
    assert.ok(geometry.quads[point] >= canonicalBounds[0] - 1e-9 && geometry.quads[point] <= canonicalBounds[2] + 1e-9);
    assert.ok(geometry.quads[point + 1] >= canonicalBounds[1] - 1e-9 && geometry.quads[point + 1] <= canonicalBounds[3] + 1e-9);
  }
  assert.equal(candidateHudGeometry({ ...row, cellCoord: row.cellCoord.subarray(0, -1) }), null, 'producer 사본의 길이가 계약과 다르면 그리지 않는다');
});

test('Y faces HUD는 cube-face producer의 canonical face H를 sample 좌표계와 같이 쓴다', () => {
  const vertices = hexCorners(0, 0, { size: 120, originX: 180, originY: 180 });
  const branch = enumerateCubeFaceGeometry(vertices).find((entry) => entry.ok);
  assert.ok(branch, '실제 cube-face producer가 유한 H를 냈다');
  const row = { id: 'y-3d', revision: 2, type: 'Y', geometryMode: 'y-faces', n: 13,
    layoutId: 'v0', formatWire: 2, faceHs: branch.faceHs,
    cellMap: new Uint8Array(169), frameWidth: 360, frameHeight: 360 };
  const geometry = candidateHudGeometry(row);
  assert.equal(geometry.mode, 'y-faces');
  assert.equal(candidateHudFrameGeometry(row, geometry), geometry, 'face-H는 이미 image-space라 own H를 다시 입히지 않는다');
  const { ei, ej } = faceBasis('T');
  const expected = projectPoint(branch.faceHs[0], { x: 0 * ei.x + 0 * ej.x, y: 0 * ei.y + 0 * ej.y });
  const slot = candidateHudQuadSlot(geometry, 0, 0);
  assert.ok(Math.hypot(geometry.quads[slot] - expected.x, geometry.quads[slot + 1] - expected.y) < 1e-6);
  assert.equal(candidateHudGeometry({ ...row, faceHs: branch.faceHs.slice(0, 2) }), null);
});
