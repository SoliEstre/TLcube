import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import {
  FINDER_BASELINE_SCORES, FINDER_PATTERNS,
} from '../src/finder-patterns.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { verifyRaster } from '../src/verify.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

const TYPES = Object.freeze(['O', 'A']);
const FINDER_RENDER_CASES = Object.freeze([
  ...Object.values(FINDER_BASELINE_SCORES),
  ...FINDER_PATTERNS,
]);

function isCenterQrBaseline(entry) {
  return entry.id === 'center-qr';
}

function encodeFor(type, centerQr) {
  const options = { version: 1, eccLevel: 'M', centerQr };
  return type === 'A'
    ? encodeA('finder selection', options)
    : encode('finder selection', options);
}

function renderSelectedFinder(type, entry) {
  const centerQr = isCenterQrBaseline(entry);
  const encoded = encodeFor(type, centerQr);
  const options = {
    palette: PALETTE,
    finderPatternId: entry.id,
    margin: type === 'A' ? 20 : undefined,
  };
  if (centerQr) options.qrText = 'TLSCAN.ESTRE.SO';
  const scene = buildScene(encoded, options);
  const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
  const check = verifyRaster(raster, scene, encoded);
  return { scene, raster, check };
}

test('기준선과 모든 FINDER_PATTERNS를 Type O/A 장면으로 선택·렌더한다', () => {
  assert.ok(FINDER_RENDER_CASES.length > FINDER_PATTERNS.length);
  for (const type of TYPES) {
    for (const entry of FINDER_RENDER_CASES) {
      let result;
      try {
        result = renderSelectedFinder(type, entry);
      } catch (error) {
        assert.fail(type + '/' + entry.id + ' 렌더 예외: ' + (error && error.stack ? error.stack : error));
      }
      assert.ok(result.scene.shapes.length > 0, type + '/' + entry.id + ': shapes 없음');
      assert.equal(
        result.check.ok,
        true,
        type + '/' + entry.id + ': ' + JSON.stringify(result.check.mismatches),
      );
    }
  }
});
