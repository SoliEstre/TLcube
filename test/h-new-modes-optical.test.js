// Private public-ready candidate. Copy to TLcube/test only after the codec/profile merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeH, decodeH } from '../src/h-codec.js';
import { detectH } from '../src/h-detect.js';
import { createHCollector } from '../src/h-collector.js';
import { hModeFaces } from '../src/h-profile.js';
import { hLayout } from '../src/h-layout.js';
import { buildHFaceSheet } from '../src/h-render.js';
import { rasterize } from '../src/raster.js';
import { relativeLuminance8 } from '../src/luminance.js';
import { hFaceNetModel } from '../src/h-face-hud.js';

const MODES = Object.freeze([2, 4, 5]);
const TONES = Object.freeze([2, 3]);
function fieldFromRaster({ width, height, pixels }) {
  const data = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 1, p += 4) data[i] = relativeLuminance8(pixels[p], pixels[p + 1], pixels[p + 2]);
  return { width, height, data };
}
function fieldFor(encoded) { return fieldFromRaster(rasterize(buildHFaceSheet(encoded), { pixelsPerUnit: 12, supersample: 2 })); }
function rotate90({ width, height, data }) {
  const out = new Float32Array(data.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) out[x * height + (height - 1 - y)] = data[y * width + x];
  return { width: height, height: width, data: out };
}
function reflectX({ width, height, data }) {
  const out = new Float32Array(data.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) out[y * width + x] = data[y * width + width - 1 - x];
  return { width, height, data: out };
}
function decoded(hit, encoded) {
  return decodeH(Object.fromEntries(hit.faces.map(row => [row.face, row.levels])), {
    version: encoded.version, mode: encoded.mode, tones: encoded.tones, ecc: encoded.ecc,
    mask: encoded.mask, routeId: encoded.routeId, finder: encoded.finder,
  });
}
function observation(encoded, face) {
  return { ok: true, version: encoded.version, n: encoded.n, mode: encoded.mode, tones: encoded.tones,
    ecc: encoded.ecc, mask: encoded.mask, routeId: encoded.routeId, finder: encoded.finder, face,
    levels: encoded.faces[face].slice(), rotation: 0, mirror: false, hamming: 0, quality: { score: .9 } };
}

test('2/4/5면 frame H2와 corners H7은 2/3톤 실제 pixel sheet 및 90도 회전을 full CRC로 통과해요', () => {
  for (const mode of MODES) for (const tones of TONES) for (const [version, finder] of [[2, 'frame'], [7, 'corners']]) {
    const encoded = encodeH('H', { version, mode, tones, ecc: 'M', mask: 3, finder });
    assert.deepEqual(Object.keys(encoded.faces), hModeFaces(mode));
    for (const field of [fieldFor(encoded), rotate90(fieldFor(encoded))]) {
      const hit = detectH(field), ids = new Set(hit.faces.map(row => row.face));
      assert.deepEqual(ids, new Set(hModeFaces(mode)), `${finder}/${mode}/${tones}`);
      assert.ok(hit.faces.every(row => row.ok && !row.mirror && row.hamming === 0));
      assert.equal(decoded(hit, encoded).text, 'H');
    }
    assert.equal(detectH(reflectX(fieldFor(encoded))).faces.length, 0, `reflection ${finder}/${mode}/${tones}`);
  }
});

test('2/4/5면 corners H7은 2/3톤 모든 면의 두 marker bit 오차를 정정하고 frame H2는 tag 1bit를 수용하지 않아요', () => {
  for (const mode of MODES) for (const tones of TONES) {
    const encoded = encodeH('H', { version: 7, mode, tones, ecc: 'M', mask: 5, finder: 'corners' });
    const marker = [...hLayout(7, 'corners').roles.values()].filter(cell => cell.role === 'marker' && cell.kind === 'bit').slice(0, 2);
    for (const face of hModeFaces(mode)) for (const cell of marker) {
      const at = cell.i * encoded.n + cell.j;
      encoded.faces[face][at] = encoded.faces[face][at] === 3 ? 4 : 3;
    }
    const hit = detectH(fieldFor(encoded));
    assert.deepEqual(new Set(hit.faces.map(row => row.face)), new Set(hModeFaces(mode)));
    assert.ok(hit.faces.every(row => row.hamming === 2));
    assert.equal(decoded(hit, encoded).text, 'H');
    const frame = encodeH('H', { version: 2, mode, tones, ecc: 'M', mask: 5, finder: 'frame' });
    const tag = hLayout(2, 'frame').tagCells[0];
    for (const face of hModeFaces(mode)) {
      const at = tag.i * frame.n + tag.j;
      frame.faces[face][at] = frame.faces[face][at] === 3 ? 4 : 3;
    }
    assert.equal(detectH(fieldFor(frame)).faces.length, 0, `frame tag 1bit ${mode}/${tones}`);
  }
});

test('2/4/5면 collector는 중복 면을 한 번만 세고 필요한 마지막 면 전에는 decode하지 않아요', () => {
  for (const mode of MODES) for (const tones of TONES) {
    const encoded = encodeH('H', { version: 2, mode, tones, ecc: 'M', mask: 0, finder: 'frame' });
    let calls = 0;
    const collector = createHCollector({ decode: (...args) => { calls += 1; return decodeH(...args); } });
    const faces = hModeFaces(mode), first = observation(encoded, faces[0]);
    let state = collector.addFrame({ observations: [first, first], frameId: 0, timestamp: 0 });
    assert.equal(state.count, 1); assert.equal(state.required, mode); assert.equal(calls, 0);
    for (let i = 1; i < faces.length - 1; i += 1) state = collector.addFrame({ observations: [observation(encoded, faces[i])], frameId: i, timestamp: i });
    assert.equal(state.state, 'COLLECTING'); assert.equal(calls, 0);
    state = collector.addFrame({ observations: [observation(encoded, faces.at(-1))], frameId: faces.length, timestamp: faces.length });
    assert.equal(state.state, 'DONE'); assert.equal(state.result.text, 'H'); assert.equal(calls, 1);
  }
});

test('HUD는 hModeFaces 기준으로만 required/current/present/not-required를 그려요', () => {
  for (const mode of MODES) {
    const faces = hModeFaces(mode);
    const stats = { required: mode, leadingId: 'new', observedAt: 1_000,
      observedFaces: [{ face: faces[0], quality: { score: 1 } }],
      assemblies: [{ id: 'new', present: faces.slice(0, Math.min(2, faces.length)), expiresAt: 5_000,
        faceExpiresAt: Object.fromEntries(faces.map(face => [face, 5_000])) }] };
    const net = hFaceNetModel(stats, 1_500);
    assert.equal(net.required, mode);
    for (const cell of net.cells) assert.equal(cell.state,
      cell.face === faces[0] ? 'CURRENT' : faces.includes(cell.face) && faces.indexOf(cell.face) < 2 ? 'PRESENT' : faces.includes(cell.face) ? 'MISSING' : 'NOT_REQUIRED');
  }
});
