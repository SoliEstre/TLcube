// C 관측 자의 합성 입력. truth H는 oracle에만 쓰며 관측기에는 전달하지 않아요.
import assert from 'node:assert/strict';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';
import { createCAdapters } from '../src/r2/adapter-c.js';
import { ranksToDigit } from '../src/lehmer.js';
import { packCellDigitsToSymbols } from '../src/base211.js';
import { createRsBlockDecodeInto, createRsBlockStats } from '../src/r2/decode-rs-blocks.js';
import { unframe } from '../src/header.js';

const palette = { background: { r: 248, g: 249, b: 251 },
  levels: [{ r: 20, g: 28, b: 42 }, { r: 96, g: 116, b: 145 }, { r: 218, g: 228, b: 242 }],
  bullseyeDark: { r: 0, g: 0, b: 0 }, bullseyeLight: { r: 255, g: 255, b: 255 } };
const fixtureCache = new Map();
export function syntheticC(version = 0, text = `obs-C-${version}`, extra = {}) {
  const cacheKey = JSON.stringify([version, text, extra]);
  if (fixtureCache.has(cacheKey)) return fixtureCache.get(cacheKey);
  const encoded = encode(text, { version, eccLevel: 'M', notchC: true, centralN7: true, ...extra });
  const scene = buildScene(encoded, { palette, margin: 20,
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID, centralN7Family: 'hex' });
  const ppu = 12, field = toRelativeLuminance(rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 }));
  const H = new Float64Array([scene.layout.size * ppu, 0, scene.layout.originX * ppu,
    0, scene.layout.size * ppu, scene.layout.originY * ppu, 0, 0, 1]);
  const fixture = { field, H, k: encoded.k, version, text, encoded, scene };
  fixtureCache.set(cacheKey, fixture);
  return fixture;
}
export function copyField(field) {
  return { width: field.width, height: field.height, data: field.data.slice(), alpha: field.alpha?.slice() ?? null };
}
export function callDetect(adapter, field, frameId, output = {}, timestamp = frameId, extraPose = {}) {
  adapter.detectInto(field, field.width, field.height, timestamp, { frameId, ...extraPose }, output);
  return output;
}
export function observeAll(field, options = {}) {
  const adapter = createCAdapters(options), rows = [], output = {};
  let calls = 0;
  for (; calls < 500000 && !adapter.stats.scanComplete; calls++) {
    callDetect(adapter, field, calls, output);
    if (output.found) rows.push({ ...output, H: output.H.slice(), frameId: calls });
  }
  assert.ok(adapter.stats.scanComplete, `탐색 미완료 ${calls} ${adapter.stats.resumeCursor?.phase}`);
  return { adapter, rows, calls, field };
}
export function alignCandidate(candidate, field, frameId, timestamp = frameId, extraPose = {}) {
  const faceLuma = new Uint8Array(candidate.bound.cellCount * 3), visibleCells = new Uint8Array(candidate.bound.cellCount), output = {};
  candidate.alignInto(field, field.width, field.height, timestamp, { frameId, ...extraPose }, candidate, output, faceLuma, visibleCells);
  return { faceLuma, visibleCells, output };
}
export function decodeCandidate(candidate, field, frameId) {
  const sampled = alignCandidate(candidate, field, frameId), bound = candidate.bound;
  const digits = new Uint8Array(bound.cellCount), erasedCells = [];
  for (let i = 0; i < bound.cellCount; i++) {
    const faces = ['T', 'L', 'R'].map((face, j) => ({ face, value: sampled.faceLuma[3 * i + j] }))
      .sort((a, b) => a.value - b.value);
    if (!sampled.visibleCells[i] || faces[0].value === faces[1].value || faces[1].value === faces[2].value) {
      erasedCells.push(i); continue;
    }
    const rank = Object.fromEntries(faces.map((face, j) => [face.face, j]));
    digits[i] = (ranksToDigit(rank) - bound.maskDigit[i] + 6) % 6;
  }
  const packed = packCellDigitsToSymbols(digits), values = packed.symbols;
  const confidence = new Int16Array(bound.symbolCount).fill(30000), erasures = new Uint8Array(bound.symbolCount);
  for (const i of packed.illegalIndices) { values[i] = 0; confidence[i] = 0; erasures[i] = 1; }
  for (const cell of erasedCells) { const i = Math.floor(cell / 3); values[i] = 0; confidence[i] = 0; erasures[i] = 1; }
  const stats = createRsBlockStats(bound), decode = createRsBlockDecodeInto(bound, { stats });
  const out = { accepted: 0, payloadLength: 0, correctedCount: 0, tResidual: 0,
    correctedPositions: new Uint16Array(bound.symbolCount) }, payload = new Uint8Array(bound.dataBytes);
  const status = decode(values, confidence, erasures, bound.symbolCount, bound, out, payload);
  let text = null, bodyError = null;
  if (out.accepted) { try { text = unframe(payload).text; } catch (error) { bodyError = error.message; } }
  return { done: out.accepted === 1 && text !== null, text, accepted: out.accepted,
    blocksOk: stats.blocksOk, blocks: bound.blocks.length, status, bodyError,
    visibleCount: sampled.output.visibleCount, correctedCount: out.correctedCount, sampled };
}
