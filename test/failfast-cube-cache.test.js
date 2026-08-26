import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeFrontend } from '../src/decoder/frontend.js';
import { FAILFAST_CACHE_TEST_ONLY } from '../src/decoder/family.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeY } from '../src/encodeY.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY } from '../src/sceneY.js';

const { cachedCubeTiling, cubeTilingCacheLimit, storeCubeTiling } = FAILFAST_CACHE_TEST_ONLY;
const preset = getPreset(DEFAULT_PRESET);
const palette = Object.freeze({
  background: preset.background,
  levels: preset.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function renderFamily(family, text) {
  if (family === 'hex') {
    const encoded = encode(text, { version: 2, eccLevel: 'M' });
    return rasterize(buildScene(encoded, { palette, margin: 20 }), {
      pixelsPerUnit: 12, supersample: 1,
    });
  }
  if (family === 'tri') {
    const encoded = encodeA(text, { version: 1, eccLevel: 'M' });
    return rasterize(buildScene(encoded, { palette, margin: 26 }), {
      pixelsPerUnit: 12, supersample: 1,
    });
  }
  const encoded = encodeY(text, { version: 1, eccLevel: 'M', tones: 3 });
  return rasterize(buildSceneY(encoded, { palette, margin: 20 }), {
    pixelsPerUnit: 12, supersample: 1,
  });
}

function decodeWithCacheEntries(raster, cacheEntries) {
  return decodeFrontend(raster, {
    bootstrap: { family: { _cubeTilingCacheEntries: cacheEntries } },
  });
}

test('운영 기본값은 두 칸이고 계측 대조만 한 칸이다', () => {
  assert.equal(cubeTilingCacheLimit({}), 2);
  assert.equal(cubeTilingCacheLimit({ _cubeTilingCacheEntries: 1 }), 1);
});

test('cube proposal 캐시는 기본·전수 두 키를 함께 보존한다', () => {
  const luma = {};
  const yJunction = {};
  const baseOptions = { enableCellSurfaceY: true };
  const exhaustiveOptions = {
    enableCellSurfaceY: true,
    exhaustiveBlockRecovery: true,
  };
  const baseValue = { id: 'base' };
  const exhaustiveValue = { id: 'exhaustive' };

  storeCubeTiling(luma, yJunction, baseOptions, baseValue, 2);
  storeCubeTiling(luma, yJunction, exhaustiveOptions, exhaustiveValue, 2);

  assert.equal(cachedCubeTiling(luma, yJunction, baseOptions), baseValue);
  assert.equal(cachedCubeTiling(luma, yJunction, exhaustiveOptions), exhaustiveValue);
});

test('한 칸 변이는 기본 → 전수 전환 뒤 기본 키를 잃어 자가 빨개진다', () => {
  const luma = {};
  const yJunction = {};
  const baseOptions = { enableCellSurfaceY: true };
  const exhaustiveOptions = {
    enableCellSurfaceY: true,
    exhaustiveBlockRecovery: true,
  };

  storeCubeTiling(luma, yJunction, baseOptions, { id: 'base' }, 1);
  storeCubeTiling(luma, yJunction, exhaustiveOptions, { id: 'exhaustive' }, 1);

  assert.equal(cachedCubeTiling(luma, yJunction, baseOptions), undefined);
});

test('결과를 바꾸는 입력·옵션 정체성은 캐시 키를 공유하지 않는다', () => {
  const luma = {};
  const otherLuma = {};
  const yJunction = {};
  const otherYJunction = {};
  const sample = {};
  const options = { enableCellSurfaceY: true, sample };
  const value = { id: 'only-this-key' };

  storeCubeTiling(luma, yJunction, options, value, 2);

  assert.equal(cachedCubeTiling(luma, yJunction, options), value);
  assert.equal(cachedCubeTiling(otherLuma, yJunction, options), undefined);
  assert.equal(cachedCubeTiling(luma, otherYJunction, options), undefined);
  assert.equal(cachedCubeTiling(luma, yJunction, { ...options, sample: {} }), undefined);
});

test('합성 왕복 성공 집합은 한 칸과 두 칸에서 3/3으로 같다', { timeout: 120_000 }, () => {
  const rows = [];
  for (const family of ['hex', 'tri', 'cube']) {
    const text = 'failfast-' + family;
    const raster = renderFamily(family, text);
    const before = decodeWithCacheEntries(raster, 1);
    const after = decodeWithCacheEntries(raster, 2);
    rows.push({ family, before: before.ok, after: after.ok });

    assert.equal(before.ok, true, `${family}/before: ${JSON.stringify(before)}`);
    assert.equal(after.ok, true, `${family}/after: ${JSON.stringify(after)}`);
    assert.equal(after.text, before.text, family + ': payload가 달라졌다');
    assert.equal(after.family, before.family, family + ': family가 달라졌다');
    assert.equal(after.text, text, family + ': 원문 왕복 실패');
  }
  assert.deepEqual(
    rows.map((row) => [row.before, row.after]),
    [[true, true], [true, true], [true, true]],
  );
  process.stdout.write('FAILFAST_SYNTHETIC ' + JSON.stringify({
    cases: rows.length,
    beforeSuccesses: rows.filter((row) => row.before).length,
    afterSuccesses: rows.filter((row) => row.after).length,
    mismatches: rows.filter((row) => row.before !== row.after).length,
  }) + '\n');
});
