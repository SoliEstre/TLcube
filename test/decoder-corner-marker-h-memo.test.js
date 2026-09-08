import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { encodeK } from '../src/encodeK.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset, relativeLuminance } from '../src/luminance.js';
import { findKCornerMarkerHypotheses } from '../src/decoder/corner-marker-detect.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PALETTE = Object.freeze({ background: getPreset(DEFAULT_PRESET).background, levels: getPreset(DEFAULT_PRESET).levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT });
const renderK = () => { const encoded = encodeK('k-cm-accept', { cornerMarker: true, version: 1, eccLevel: 'M' }); const scene = buildScene(encoded, { palette: PALETTE, margin: 20 }); const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 1 }); const data = new Float32Array(raster.width * raster.height); for (let i = 0; i < data.length; i += 1) { const o = i * 4; data[i] = relativeLuminance({ r: raster.pixels[o], g: raster.pixels[o + 1], b: raster.pixels[o + 2] }); } return { luma: { width: raster.width, height: raster.height, data, alpha: null }, bullseye: { center: { x: scene.layout.originX * 12, y: scene.layout.originY * 12 }, cellSize: scene.layout.size * 12, score: 1, hardChecksPassed: true } }; };

async function loadBaseline() {
  const file = resolve(ROOT, 'src/decoder/corner-marker-detect.js');
  let source = readFileSync(file, 'utf8');
  const start = source.indexOf('    const shiftedMemo = new Map();');
  const end = source.indexOf('    const evaluate =', start);
  assert.ok(start >= 0 && end > start);
  const original = `    const shifted = multiply(\n        translationHomography(offset.dx * cellSize, offset.dy * cellSize),\n        multiply(H, scaleHomography(scale)),\n      );\n`;
  source = source.slice(0, start) + source.slice(end).replace('      const shifted = shiftedFor(scale, offset);', original.trimEnd());
  let replaced = 0;
  source = source.replace(/from\s+(['"])(\.[^'"]+)\1/g, (_m, _q, spec) => { replaced += 1; return `from '${pathToFileURL(resolve(dirname(file), spec)).href}'`; });
  assert.ok(replaced > 0);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
import { verifyCornerMarkers } from '../src/decoder/corner-marker-detect.js';

const field = { width: 64, height: 64, data: new Float32Array(64 * 64) };
const H = new Float64Array([1, 0, 32, 0, 1, 32, 0, 0, 1]);

test('H memo는 호출 내부 결과를 보존하고 호출 사이에 누출되지 않는다', () => {
  const options = { H, center: { x: 32, y: 32 }, searchCells: 0, scaleSearch: 0 };
  const first = verifyCornerMarkers(field, { H, k: 4, cellSize: 4 }, options);
  const second = verifyCornerMarkers(field, { H, k: 4, cellSize: 4 }, options);
  assert.deepEqual(second, first);
  assert.notStrictEqual(second.corners, first.corners);
});

test('K 합성 양성은 원본 baseline과 전체 결과가 같다', async () => {
  const baseline = await loadBaseline();
  const { luma, bullseye } = renderK();
  const current = findKCornerMarkerHypotheses(luma, bullseye, [6, 8, 10], {});
  const old = baseline.findKCornerMarkerHypotheses(luma, bullseye, [6, 8, 10], {});
  assert.deepEqual(current, old);
  assert.equal(current.ok, true);
  assert.ok(current.hypotheses.length > 0);
  const changed = { ...luma, data: luma.data.slice() };
  changed.data[0] = changed.data[0] + 0.001;
  const hCopy = Float64Array.from(bullseye ? [bullseye.cellSize, 0, bullseye.center.x, 0, bullseye.cellSize, bullseye.center.y, 0, 0, 1] : []);
  const changedCurrent = findKCornerMarkerHypotheses(changed, bullseye, [6, 8, 10], { H: hCopy });
  const changedOld = baseline.findKCornerMarkerHypotheses(changed, bullseye, [6, 8, 10], { H: hCopy });
  assert.deepEqual(changedCurrent, changedOld);
});
