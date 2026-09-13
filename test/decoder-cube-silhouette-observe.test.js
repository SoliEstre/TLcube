import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSeedlessBgLinefitCandidates as observe,
  detectSeedlessBgLinefitCandidatesSteps as steps } from '../src/decoder/cube-silhouette-observe.js';

function hexagon() {
  const width = 128, height = 128, data = new Float32Array(width * height).fill(.96);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = Math.abs(x - width / 2), dy = Math.abs(y - height / 2);
    if (dx < width * .3 && dy < height * .3 && dx + dy * .5 < width * .4) data[y * width + x] = .12;
  }
  return { width, height, data, alpha: new Uint8Array(data.length).fill(255) };
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'ms' && key !== 'elapsedMs')
    .map(([key, child]) => [key, stable(child)]));
}
function drain(iterator) {
  let step = iterator.next(), units = 0;
  while (!step.done) { units++; step = iterator.next(); }
  return { value: step.value, units };
}
test('합성 육각형은 픽셀에서 여섯 꼭짓점과 관측 근거를 만든다', () => {
  const result = observe(hexagon());
  assert.equal(result.ok, true);
  assert.equal(result.candidates.length, 1);
  for (const candidate of result.candidates) {
    assert.equal(candidate.vertices.length, 6);
    assert.ok(candidate.vertices.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    assert.equal(candidate.diagnostics.pixelExtrema.count, candidate.diagnostics.edgePoints);
    assert.equal(candidate.diagnostics.tlsIntersections.count, 6);
    assert.ok(['luma > threshold', 'luma < threshold'].includes(candidate.provenance.foregroundRule));
    assert.ok(Number.isFinite(candidate.provenance.threshold));
  }
});
test('관측은 입력/oracle getter를 건드리지 않고 반환값의 변경을 격리한다', () => {
  const field = hexagon(), dataBefore = field.data.slice(), alphaBefore = field.alpha.slice();
  for (const name of ['n', 'layout', 'format', 'expected', 'body', 'pose', 'registry', 'encodeY']) {
    Object.defineProperty(field, name, { get() { throw Error('금지된 oracle: ' + name); } });
  }
  const result = observe(field), expected = stable(result);
  result.candidates[0].vertices[0].x = -123456;
  result.candidates[0].diagnostics.lineSpans[0] = -1;
  result.source.candidatePolicy.push('forbidden');
  assert.deepEqual(stable(observe(field)), expected);
  assert.deepEqual(field.data, dataBefore);
  assert.deepEqual(field.alpha, alphaBefore);
});
test('양성·음성 cursor의 pause/interleave/return은 동기 결과와 같다', () => {
  const positive = hexagon(), negative = hexagon(); negative.data.fill(.96);
  const left = steps(positive), right = steps(negative);
  for (let i = 0; i < 3; i++) {
    assert.equal(left.next().done, false); assert.equal(right.next().done, false);
  }
  assert.deepEqual(stable(drain(left).value), stable(observe(positive)));
  assert.deepEqual(stable(drain(right).value), stable(observe(negative)));
  const cancelled = steps(positive); assert.equal(cancelled.next().done, false);
  assert.equal(cancelled.return().done, true);
  assert.equal(cancelled.next().done, true);
  const fresh = drain(steps(positive));
  assert.ok(fresh.units > 3);
  assert.deepEqual(stable(fresh.value), stable(observe(positive)));
});
test('빈 화면과 희소 잡음에서 기하를 지어내지 않는다', () => {
  const blank = { width: 16, height: 16, data: new Float32Array(256).fill(.5) };
  const noisy = { width: 16, height: 16, data: blank.data.slice() };
  for (const index of [0, 19, 70, 141, 238]) noisy.data[index] = 1;
  for (const field of [blank, noisy]) {
    const result = observe(field);
    assert.equal(result.ok, true); assert.deepEqual(result.candidates, []);
    assert.equal(result.diagnostics.measuredArms, 2);
    assert.equal(result.diagnostics.emittedCandidates, 0);
    assert.ok(result.diagnostics.arms.every(arm => arm.emitted === false));
  }
});
test('malformed LumaField를 명시적으로 거부한다', () => {
  for (const field of [null, {}, { width: 0, height: 1, data: new Float32Array(0) },
    { width: 1.5, height: 1, data: new Float32Array(1) },
    { width: 2, height: 2, data: new Float32Array(3) }]) {
    assert.throws(() => observe(field), { name: 'TypeError', message: '유효한 LumaField가 필요하다' });
  }
});
