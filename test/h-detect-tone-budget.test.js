// 어두운 데이터 후보가 앞쪽 예산을 소진하던 H7 회귀예요.
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeH } from '../src/h-codec.js';
import { detectH } from '../src/h-detect.js';
import { createHCollector } from '../src/h-collector.js';
import { buildHScene } from '../src/h-render.js';
import { hScreenSpin } from '../src/h-rotation.js';
import { rasterize } from '../src/raster.js';
import { getPreset, relativeLuminance8 } from '../src/luminance.js';

const payload = 'lt.estre.so';
const expectedBytes = new TextEncoder().encode(payload);
const palette = { levels: getPreset('slate').levels, background: { r: 255, g: 255, b: 255 } };

function bounds(points) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function rendered(encoded, gamma, degrees) {
  const side = 1440;
  const raw = buildHScene(encoded, { ...hScreenSpin(degrees * 1000 / 15, { axis: 'y', speed: 15 }), perspective: .0667, outline: true, palette });
  const box = bounds(raw.shapes.flatMap(shape => shape.points)); const scale = side * .85 / Math.max(box.width, box.height);
  const centerX = (box.minX + box.maxX) / 2; const centerY = (box.minY + box.maxY) / 2;
  const scene = { ...raw, width: side, height: side, shapes: raw.shapes.map(shape => ({ ...shape, points: shape.points.map(point => ({ x: (point.x - centerX) * scale + side / 2, y: (point.y - centerY) * scale + side / 2 })) })) };
  const raster = rasterize(scene, { pixelsPerUnit: 1, supersample: 2 }); const data = new Float32Array(raster.width * raster.height);
  for (let at = 0, pixel = 0; at < data.length; at += 1, pixel += 4) data[at] = relativeLuminance8(raster.pixels[pixel], raster.pixels[pixel + 1], raster.pixels[pixel + 2]) ** gamma;
  const value = { expectedVisible: scene.hModel.visible.slice().sort(), field: { width: raster.width, height: raster.height, data } }; return value;
}

function assertFrameBudget(hit, field, original, expectedVisible) {
  assert.deepEqual(field.data, original, 'detectH가 input field를 변경하면 안 돼요');
  assert.ok(hit.stats.candidateComponents <= 512, 'candidate flood 상한은 512예요');
  assert.ok(hit.stats.floodPixels <= field.data.length, '픽셀 방문은 입력 크기 이내예요');
  assert.equal(hit.faces.length, expectedVisible.length, '다른 프로필의 거짓 면도 허용하지 않아요');
  assert.ok(hit.stats.components <= 128, 'contour/hull 입력 상한은 128이에요');
  assert.ok(Number.isInteger(hit.stats.prunedComponents) && hit.stats.prunedComponents >= 0, 'prunedComponents 진단이 필요해요');
  if (hit.stats.prunedComponents > 0) assert.equal(hit.stats.capped, true, 'pruning도 capped로 보여요');
  const accepted = [...new Set(hit.faces.filter(face => face.version === 7 && face.n === 41 && face.finder === 'corners').map(face => face.face))].sort();
  assert.deepEqual(accepted, expectedVisible);
}

function collect(mode, gamma) {
  const encoded = encodeH(payload, { version: 7, mode, tones: 3, ecc: 'M', mask: 'auto', finder: 'auto' });
  assert.equal(encoded.n, 41); assert.equal(encoded.finder, 'corners');
  const collector = createHCollector(); const degrees = mode === 6 ? [0, 180] : [0]; const hits = []; let pruned = false;
  for (const [index, degree] of degrees.entries()) {
    const frame = rendered(encoded, gamma, degree); const original = frame.field.data.slice(); const hit = detectH(frame.field, { debug: true });
    assertFrameBudget(hit, frame.field, original, frame.expectedVisible);
    assert.ok(hit.faces.every(face => face.mode === mode && face.tones === 3 && face.ecc === 'M' && face.mask === encoded.mask)); pruned ||= hit.stats.prunedComponents > 0; hits.push(hit);
    const state = collector.addFrame({ observations: hit.faces, frameId: `tone-${mode}-${gamma}-${degree}`, timestamp: index * 1000, sessionId: `tone-${mode}-${gamma}`, trackId: 'plane180' });
    if (index + 1 === degrees.length) { assert.equal(state.state, 'DONE'); assert.equal(state.result.text, payload); assert.equal(state.result.crc, encoded.crc); assert.deepEqual(state.result.bytes, expectedBytes); }
  }
  if (gamma !== 1) assert.equal(pruned, true, '고감마 case에는 적어도 하나의 pruning frame이 있어요');
  return hits;
}

test('H7 slate gamma 1 3F는 n41·input 불변·full CRC를 보존해요', () => { collect(3, 1); });
test('H7 slate gamma 1 6F는 0도 뒤 180도 ZP raster까지 full CRC예요', () => { collect(6, 1); });
test('H7 slate gamma 1.25 3F는 pruning 뒤에도 full CRC예요', () => { collect(3, 1.25); });
test('H7 slate gamma 1.25 6F front/back은 pruning 뒤에도 full CRC예요', () => { collect(6, 1.25); });
test('H7 slate gamma 1.5 3F는 pruning 뒤에도 full CRC예요', () => { collect(3, 1.5); });
test('H7 slate gamma 1.5 6F front/back은 wrong face 없이 full CRC예요', () => { collect(6, 1.5); });
