import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeH } from '../src/h-codec.js';
import { createHCollector } from '../src/h-collector.js';
import { detectH } from '../src/h-detect.js';
import { buildHScene } from '../src/h-render.js';
import { H_ROTATION_TILT_DEFAULT_DEG, hScreenSpin } from '../src/h-rotation.js';
import { rasterize } from '../src/raster.js';
import { relativeLuminance8 } from '../src/luminance.js';

const PAYLOAD = 'https://tl.estre.so';
const SIDE = 640;
const SPEED = 75;
const POSES = Object.freeze([
  Object.freeze({ name: 'initial', rotation: Object.freeze({}) }),
  Object.freeze({ name: 'screen-y-180', rotation: Object.freeze(hScreenSpin(180_000 / SPEED, { axis: 'y', speed: SPEED, tiltDeg: H_ROTATION_TILT_DEFAULT_DEG })) }),
  Object.freeze({ name: 'screen-x-35', rotation: Object.freeze(hScreenSpin(35_000 / SPEED, { axis: 'x', speed: SPEED, tiltDeg: H_ROTATION_TILT_DEFAULT_DEG })) }),
  Object.freeze({ name: 'screen-x-215', rotation: Object.freeze(hScreenSpin(215_000 / SPEED, { axis: 'x', speed: SPEED, tiltDeg: H_ROTATION_TILT_DEFAULT_DEG })) }),
]);
const LIGHTING_PASSES = Object.freeze([
  Object.freeze({ profile: 'screen', fillOnEvenPose: false }),
  Object.freeze({ profile: 'original', fillOnEvenPose: true }),
]);
const FORMATS = Object.freeze([
  Object.freeze({ version: 2, finder: 'frame' }),
  Object.freeze({ version: 7, finder: 'corners' }),
]);

function linearLumaField(raster) {
  const data = new Float32Array(raster.width * raster.height);
  for (let i = 0, pixel = 0; i < data.length; i += 1, pixel += 4) {
    data[i] = relativeLuminance8(
      raster.pixels[pixel],
      raster.pixels[pixel + 1],
      raster.pixels[pixel + 2],
    );
  }
  return { width: raster.width, height: raster.height, data };
}

function renderedField(encoded, rotation, lighting) {
  const scene = buildHScene(encoded, {
    ...rotation,
    perspective: 4 / 60,
    outline: true,
    lighting: { ...lighting, shading: 'off' },
  });
  const raster = rasterize(scene, { pixelsPerUnit: SIDE / scene.width, supersample: 2 });
  assert.equal(raster.width, SIDE);
  assert.equal(raster.height, SIDE);
  return { scene, field: linearLumaField(raster) };
}

test('H2 frame과 H7 corners의 실제 조명 회전 표본 16장이 full RS/CRC로 URL을 복원해요', () => {
  let rendered = 0;
  for (const format of FORMATS) {
    const encoded = encodeH(PAYLOAD, {
      ...format,
      mode: 6,
      tones: 3,
      ecc: 'H',
      mask: 7,
    });
    const collector = createHCollector();
    const observedAcrossRotation = new Set();
    let frame = 0;

    for (const pass of LIGHTING_PASSES) {
      for (const [poseIndex, pose] of POSES.entries()) {
        const rotationFill = poseIndex % 2 === 0
          ? pass.fillOnEvenPose
          : !pass.fillOnEvenPose;
        const label = `H${format.version}/${format.finder}/${pass.profile}/${rotationFill ? 'fill' : 'plain'}/${pose.name}`;
        const { scene, field } = renderedField(encoded, pose.rotation, {
          profile: pass.profile,
          rotationFill,
        });
        const before = field.data.slice();
        const detected = detectH(field);
        assert.deepEqual(field.data, before, `${label}: detectH가 입력 휘도장을 변경하면 안 돼요`);

        const expectedVisible = [...scene.hModel.visible].sort();
        const accepted = [...new Set(detected.faces.map((row) => row.face))].sort();
        assert.equal(detected.faces.length, expectedVisible.length, `${label}: 가시 면마다 하나의 검출만 있어야 해요`);
        assert.deepEqual(accepted, expectedVisible, `${label}: 조명 아래 가시 식별 셀을 모두 읽어야 해요`);
        assert.ok(detected.faces.every((row) => row.ok
          && row.version === format.version
          && row.mode === 6
          && row.tones === 3
          && row.ecc === 'H'
          && row.mask === 7), `${label}: 검출 프로필이 렌더 포맷과 일치해야 해요`);

        for (const row of detected.faces) observedAcrossRotation.add(row.face);
        collector.addFrame({
          observations: detected.faces,
          frameId: `${format.version}-${frame}`,
          timestamp: frame * 1_000,
        });
        frame += 1;
        rendered += 1;
      }
    }

    assert.equal(frame, 8, `H${format.version}: 광학 표본 수가 늘어나면 bounded 자가 아니에요`);
    assert.equal(observedAcrossRotation.size, 6, `H${format.version}: 회전 합집합이 여섯 식별 면을 모아야 해요`);
    const result = collector.snapshot();
    assert.equal(result.state, 'DONE');
    assert.equal(result.count, 6);
    assert.equal(result.result.text, PAYLOAD);
    assert.equal(result.result.crc, encoded.crc);
    assert.deepEqual(result.result.bytes, new TextEncoder().encode(PAYLOAD));
  }
  assert.equal(rendered, 16, '광학 회귀는 16장 이내로 고정해요');
});
