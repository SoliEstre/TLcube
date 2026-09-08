import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as legacy from '../src/decoder/central-beacon-adapt.js';
import * as n7 from '../src/decoder/central-n7-observe.js';
import * as shared from '../src/decoder/central-beacon-observation-shared.js';
import { CENTRAL_N7_PATTERN_FAMILY_ID } from '../src/centralN7Schema.js';
import { projectPoint } from '../src/decoder/homography.js';

test('n7 관측 재수출은 래퍼나 사본이 아닌 같은 함수·상수다', () => {
  for (const name of [
    'outerCellSizeFromCentralN7ModulePitch',
    'scaleCentralN7HomographyToOuter',
    'verifyCentralN7LocatorTones',
    'readCentralN7Payload',
    'centralN7CenterPriorSeeds',
    'discoverCentralN7Finders',
  ]) {
    assert.equal(typeof n7[name], 'function', name);
    assert.strictEqual(legacy[name], n7[name], name);
  }
  assert.equal(n7.CENTRAL_N7_FINDER_KIND, CENTRAL_N7_PATTERN_FAMILY_ID);
  assert.strictEqual(legacy.CENTRAL_N7_FINDER_KIND, n7.CENTRAL_N7_FINDER_KIND);
  assert.strictEqual(legacy.BEACON_CS_BLOCK_LOCATOR, shared.BEACON_CS_BLOCK_LOCATOR);
  assert.strictEqual(legacy.unitCentralSlotRadius, shared.unitCentralSlotRadius);
  assert.ok(Object.isFrozen(shared.BEACON_CS_BLOCK_LOCATOR));
  assert.ok(Object.isFrozen(shared.ORIENTATION_DEGREES));
  // 기존 통합 어댑터에는 내부 조립 소켓을 새 공개 API로 노출하지 않는다.
  assert.equal(Object.hasOwn(legacy, 'centralN7Finders'), false);
});

test('n7 독립 관측 폐포에는 통합 어댑터·인코더·본문 복호기가 없다', () => {
  const root = new URL('../', import.meta.url);
  const pending = [new URL('src/decoder/central-n7-observe.js', root)];
  const seen = new Set();
  while (pending.length > 0) {
    const url = pending.pop();
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const code = readFileSync(url, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const match of code.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      pending.push(new URL(match[1], url));
    }
  }
  assert.ok(seen.size > 10, '폐포 감사가 진입점만 재고 통과하면 안 된다');
  for (const name of [
    'src/encodeY.js', 'src/encode.js', 'src/decode.js',
    'src/decoder/bootstrap.js', 'src/decoder/decode-c.js', 'src/decoder/decode-k.js',
    'src/decoder/central-beacon-adapt.js',
  ]) {
    assert.equal(seen.has(new URL(name, root).href), false, name);
  }
  assert.ok(seen.has(new URL('src/centralN7Codec.js', root).href));
  assert.ok(seen.has(new URL('src/decoder/central-beacon-observation-shared.js', root).href));
  for (const url of seen) assert.ok(fileURLToPath(url).endsWith('.js'));
});

test('n7 외부 H 변환은 원점과 projective 분모를 보존하고 입력을 수정하지 않는다', () => {
  const H = new Float64Array([2, 0.2, 100, 0.1, 3, 80, 0.001, -0.002, 1]);
  const before = H.slice();
  const outer = n7.scaleCentralN7HomographyToOuter(H);
  assert.ok(outer instanceof Float64Array);
  assert.notStrictEqual(outer, H);
  assert.deepEqual(H, before);
  assert.deepEqual(projectPoint(outer, { x: 0, y: 0 }), { x: 100, y: 80 });
  assert.deepEqual([...outer.slice(6)], [...H.slice(6)]);
  const scale = n7.outerCellSizeFromCentralN7ModulePitch(1);
  for (const point of [{ x: 1, y: 0 }, { x: -2, y: 3 }]) {
    const a = projectPoint(H, point);
    const b = projectPoint(outer, point);
    assert.ok(Math.abs(b.x - (100 + scale * (a.x - 100))) < 1e-10);
    assert.ok(Math.abs(b.y - (80 + scale * (a.y - 80))) < 1e-10);
  }
  assert.equal(n7.scaleCentralN7HomographyToOuter(null), null);
  assert.equal(n7.scaleCentralN7HomographyToOuter([...H]), null);
  assert.equal(n7.scaleCentralN7HomographyToOuter(new Float64Array(8)), null);
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(n7.outerCellSizeFromCentralN7ModulePitch(value), null);
  }
});

test('관측 공유 표본은 최근접·경계 clamp 계약을 보존한다', () => {
  const luma = { width: 2, height: 2, data: new Float32Array([0.1, 0.2, 0.3, 0.4]) };
  assert.equal(shared.sampleLuma(luma, -20, -20), luma.data[0]);
  assert.equal(shared.sampleLuma(luma, 0.51, 0.49), luma.data[1]);
  assert.equal(shared.sampleLuma(luma, 20, 20), luma.data[3]);
  assert.equal(shared.unitCentralSlotRadius(), shared.UNIT_CENTRAL_SLOT_RADIUS);
  assert.ok(shared.UNIT_CENTRAL_SLOT_RADIUS > 0);
});
