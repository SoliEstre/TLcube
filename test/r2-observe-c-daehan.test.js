import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from '../src/encode.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { observeCDaehanGeometry } from '../src/decoder/c-daehan-observe.js';
import { daehanPatternId } from '../src/finder-daehan.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { TYPE_C_RADII } from '../src/formatC.js';

function daehanLuma() {
  const preset = getPreset(DEFAULT_PRESET);
  const palette = {
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
  const encoded = encode('c-daehan-observe', {
    version: 0,
    eccLevel: 'M',
    notchC: true,
    daehanFinder: true,
  });
  const scene = buildScene(encoded, {
    palette, cellSize: 12, margin: 20, finderPatternId: daehanPatternId(6),
  });
  return toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 1, supersample: 1 }));
}

test('C×daehan 관찰은 실제 finder seed와 통과 anchor를 독립 소유로 내보낸다', () => {
  const luma = daehanLuma();
  const entries = [...observeCDaehanGeometry(luma)];
  assert.ok(entries.length >= TYPE_C_RADII.length, '실제 daehan finder seed가 없다');
  const seeds = entries.filter((entry) => entry.stage === 'seed');
  assert.deepEqual(seeds.slice(0, TYPE_C_RADII.length).map((entry) => entry.k), TYPE_C_RADII);
  assert.ok(entries.every((entry) => entry.sourceKind === 'c-daehan'));
  assert.ok(entries.every((entry) => entry.H instanceof Float64Array && entry.H.length === 9));
  assert.ok(entries.every((entry) => Object.isFrozen(entry.finder)));
  const first = entries[0];
  const originalH = Array.from(first.H);
  first.H.fill(0);
  assert.throws(() => { first.finder.center.x = -1; }, TypeError);
  const fresh = [...observeCDaehanGeometry(luma)][0];
  assert.deepEqual(Array.from(fresh.H), originalH, '앞 소비자의 H 변경이 새 iterator에 누출됐다');
  assert.notDeepEqual(Array.from(entries[1].H), Array(9).fill(0), '앞 후보 H 변경이 다음 후보에 누출됐다');
});
