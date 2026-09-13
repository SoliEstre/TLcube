import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeH } from '../src/h-codec.js';
import { buildHScene, hPalette, hProjection } from '../src/h-render.js';
import { applyHRotationFill, resolveHLighting } from '../src/h-lighting.js';
import { composeHRotation, hAlignmentRotation, hRotationPeriodMs, hScreenSpin } from '../src/h-rotation.js';

const NORMALS = Object.freeze({ ZM: [0, 0, -1], XM: [-1, 0, 0], YM: [0, -1, 0], ZP: [0, 0, 1], XP: [1, 0, 0], YP: [0, 1, 0] });
const CAMERA = Object.freeze([-1 / Math.sqrt(3), -1 / Math.sqrt(3), -1 / Math.sqrt(3)]);
const FACES = Object.keys(NORMALS);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const close = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} !== ${expected}`);

function rotate([x, y, z], { rotateX = 0, rotateY = 0, rotateZ = 0 } = {}) {
  const cx = Math.cos(rotateX), sx = Math.sin(rotateX), cy = Math.cos(rotateY), sy = Math.sin(rotateY), cz = Math.cos(rotateZ), sz = Math.sin(rotateZ);
  const a = [x, y * cx - z * sx, y * sx + z * cx];
  const b = [a[0] * cy + a[2] * sy, a[1], -a[0] * sy + a[2] * cy];
  return [b[0] * cz - b[1] * sz, b[0] * sz + b[1] * cz, b[2]];
}
function facing(face, pose) { return clamp(dot(rotate(NORMALS[face], pose), CAMERA), 0, 1); }
function poseAt(degrees, axis, reverse, arrangement) {
  const speed = 75;
  const spin = hScreenSpin(degrees * 1000 / speed, {
    axis, speed, directionX: reverse ? -1 : 1, directionY: reverse ? -1 : 1,
  });
  return composeHRotation(hAlignmentRotation(arrangement), spin);
}
function luma({ r, g, b }) { return r * .2126 + g * .7152 + b * .0722; }

test('rotationFill은 모든 물리 면이 camera-facing .50 이상일 때 read gain=1과 공통 fill .196을 받아요', () => {
  let entries = 0;
  const allPeakFaces = new Set();
  for (const axis of ['x', 'y', 'gyro']) for (const reverse of [false, true]) for (const arrangement of ['isometric', 'horizontal', 'vertical']) {
    const seen = new Set();
    for (let degrees = 0; degrees < 360; degrees += 3) {
      const pose = poseAt(degrees, axis, reverse, arrangement);
      const lighting = resolveHLighting({ profile: 'screen', shading: 'off', rotationFill: true }, pose);
      for (const face of FACES) if (facing(face, pose) >= .5) {
        seen.add(face); allPeakFaces.add(face); entries++;
        close(lighting.faceReadGains[face], 1, `${axis}/${reverse}/${arrangement}/${degrees}/${face} read gain`);
        close(lighting.faceFills[face], .56 * .35, `${axis}/${reverse}/${arrangement}/${degrees}/${face} fill`);
      }
    }
    // 정렬된 회전축과 평행한 cap은 이 한 경로에서 .5에 닿지 않을 수 있어요.
    // 그 cap은 "peak 보장" 대상이 아니며, 실제 peak를 지난 면만 같은 계약을 확인해요.
    if (arrangement === 'isometric' || axis === 'gyro') {
      assert.deepEqual([...seen].sort(), [...FACES].sort(), `${axis}/${reverse}/${arrangement}: 가능한 경로에서 six-face peak를 모두 지나야 해요`);
    } else {
      assert.ok(seen.size >= 4, `${axis}/${reverse}/${arrangement}: 충분히 facing한 실제 면 표본이 부족해요`);
    }
  }
  assert.deepEqual([...allPeakFaces].sort(), [...FACES].sort(), '축·방향·정렬 전체에서는 모든 물리 면이 한 번 이상 camera-facing peak를 가져야 해요');
  assert.ok(entries > 300, '한두 면만 검사하는 고정 시점 테스트가 아니어야 해요');
});

test('rotationFill은 360도 닫힘과 .25도 연속성을 유지하며 static opt-out의 기존 객체를 바꾸지 않아요', () => {
  for (const axis of ['x', 'y', 'gyro']) for (const reverse of [false, true]) for (const arrangement of ['isometric', 'horizontal', 'vertical']) {
    const period = hRotationPeriodMs({ axis, speed: 75 });
    const first = resolveHLighting({ profile: 'screen', shading: 'off', rotationFill: true }, poseAt(0, axis, reverse, arrangement));
    const closed = resolveHLighting({ profile: 'screen', shading: 'off', rotationFill: true }, poseAt(360, axis, reverse, arrangement));
    for (const face of FACES) {
      close(first.faceReadGains[face], closed.faceReadGains[face], `${axis}/${reverse}/${arrangement}/${face} closure gain`);
      close(first.faceFills[face], closed.faceFills[face], `${axis}/${reverse}/${arrangement}/${face} closure fill`);
    }
    let prior = first;
    for (let degrees = .25; degrees <= 360; degrees += .25) {
      const next = resolveHLighting({ profile: 'screen', shading: 'off', rotationFill: true }, poseAt(degrees, axis, reverse, arrangement));
      for (const face of FACES) {
        assert.ok(Math.abs(next.faceReadGains[face] - prior.faceReadGains[face]) <= .04, `${axis}/${reverse}/${arrangement}/${face}: read gain angular jump`);
        assert.ok(Math.abs(next.faceFills[face] - prior.faceFills[face]) <= .04, `${axis}/${reverse}/${arrangement}/${face}: fill angular jump`);
      }
      prior = next;
    }
    assert.ok(period > 0, '회전 period 계약은 유효해야 해요');
  }
  const pose = poseAt(123, 'gyro', true, 'isometric');
  assert.deepEqual(
    resolveHLighting({ profile: 'screen', shading: 'off' }, pose),
    resolveHLighting({ profile: 'screen', shading: 'off', rotationFill: false }, pose),
    'rotationFill opt-out은 기존 정적 object/pixels 계약을 바꾸면 안 돼요',
  );
});

test('빈 면은 기존 face gain을 유지하고, camera-facing 실제 code face의 data/reference 순서는 공통 read gain 아래 유지돼요', () => {
  const encoded = encodeH('facing fill', { version: 8, mode: 6, tones: 3, ecc: 'H', mask: 7, finder: 'corners' });
  const palette = { levels: [{ r: 35, g: 35, b: 35 }, { r: 135, g: 135, b: 135 }, { r: 235, g: 235, b: 235 }] };
  const pose = poseAt(120, 'y', false, 'isometric');
  const lighting = resolveHLighting({ profile: 'screen', shading: 'off', rotationFill: true }, pose);
  const scene = buildHScene(encoded, { ...pose, perspective: .3, palette, lighting: { profile: 'screen', shading: 'off', rotationFill: true } });
  const view = hProjection(encoded.n, { ...pose, perspective: .3 });
  const colors = hPalette(palette, encoded.tones).colors;
  const codeFace = view.visible.find(face => encoded.faces[face] && facing(face, pose) >= .5);
  assert.ok(codeFace, '실제 가시 code face가 camera-facing peak를 가져야 해요');
  const byLevel = new Map();
  for (const shape of scene.shapes.filter(shape => shape.face === codeFace)) {
    const level = encoded.faces[codeFace][shape.i * encoded.n + shape.j];
    if (!byLevel.has(level)) byLevel.set(level, shape.color);
  }
  for (const level of [0, 1, 2]) {
    assert.deepEqual(byLevel.get(level), applyHRotationFill(colors[level], lighting.faceFills[codeFace], lighting.faceReadGains[codeFace]));
  }
  assert.ok(luma(byLevel.get(0)) < luma(byLevel.get(1)) && luma(byLevel.get(1)) < luma(byLevel.get(2)), 'data tone order는 공통 read gain 아래 유지돼요');
  assert.deepEqual(byLevel.get(3), colors[3], 'black reference marker는 fill/gain을 받지 않아요');
  assert.deepEqual(byLevel.get(4), colors[4], 'white reference marker는 fill/gain을 받지 않아요');

  const threeFace = encodeH('blank fill', { version: 8, mode: 3, tones: 3, ecc: 'H', mask: 7, finder: 'corners' });
  const blankPose = { rotateY: Math.PI };
  const blankLighting = resolveHLighting({ profile: 'screen', shading: 'off', rotationFill: true }, blankPose);
  const blankScene = buildHScene(threeFace, { ...blankPose, perspective: .3, palette, lighting: { profile: 'screen', shading: 'off', rotationFill: true } });
  const blankFaces = hProjection(threeFace.n, { ...blankPose, perspective: .3 }).visible.filter(face => !threeFace.faces[face]);
  const blankShapes = blankScene.shapes.filter(shape => shape.kind === 'polygon' && shape.face === undefined && shape.gain !== undefined);
  assert.equal(blankShapes.length, blankFaces.length);
  for (const [index, shape] of blankShapes.entries()) {
    const gain = blankLighting.faceGains[blankFaces[index]];
    close(shape.gain, gain, `${blankFaces[index]} blank gain`);
    assert.deepEqual(shape.color, { r: Math.round(colors[5].r * gain), g: Math.round(colors[5].g * gain), b: Math.round(colors[5].b * gain) });
  }
});
