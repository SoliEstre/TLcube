import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeH } from '../src/h-codec.js';
import { detectH } from '../src/h-detect.js';
import { createHCollector } from '../src/h-collector.js';
import { buildHFaceSheet } from '../src/h-render.js';
import { hLayout } from '../src/h-layout.js';
import { rasterize } from '../src/raster.js';
import { relativeLuminance8 } from '../src/luminance.js';

function white(width, height) {
  return { width, height, data: new Float32Array(width * height).fill(1) };
}

function paint(field, x, y, width, height, value = 0) {
  for (let j = y; j < y + height; j++) {
    field.data.fill(value, j * field.width + x, j * field.width + x + width);
  }
}

function sheet(encoded) {
  const raster = rasterize(buildHFaceSheet(encoded), { pixelsPerUnit: 8, supersample: 2 });
  return {
    width: raster.width, height: raster.height,
    data: Float32Array.from({ length: raster.width * raster.height }, (_, i) =>
      relativeLuminance8(raster.pixels[i * 4], raster.pixels[i * 4 + 1], raster.pixels[i * 4 + 2])),
  };
}

function withLeadingSingletons(input) {
  const field = white(Math.max(200, input.width + 16), input.height + 64);
  for (let y = 0; y < input.height; y++) {
    field.data.set(input.data.subarray(y * input.width, (y + 1) * input.width), (y + 48) * field.width + 8);
  }
  // 유효 파인더보다 먼저 스캔되는 640개의 서로 떨어진 1픽셀 검정 점이에요.
  for (let y = 0; y < 10; y++) for (let x = 0; x < 64; x++) {
    field.data[(2 + y * 3) * field.width + 2 + x * 3] = 0;
  }
  return field;
}

function tiledSheets(encoded, count) {
  const input = sheet(encoded), columns = 3, gap = 16, rows = Math.ceil(count / columns);
  const field = white(columns * input.width + (columns - 1) * gap, rows * input.height + (rows - 1) * gap);
  for (let i = 0; i < count; i++) {
    const ox = i % columns * (input.width + gap), oy = Math.floor(i / columns) * (input.height + gap);
    for (let y = 0; y < input.height; y++) {
      field.data.set(input.data.subarray(y * input.width, (y + 1) * input.width), (oy + y) * field.width + ox);
    }
  }
  return field;
}

function collect(observations) {
  return createHCollector().addFrame({ observations, frameId: 0, timestamp: 0 });
}

function rejectWithoutPayload(hit) {
  assert.equal(hit.faces.length, 0);
  const state = collect(hit.faces);
  assert.notEqual(state.state, 'DONE');
  assert.equal(state.result, undefined);
}

test('고립 seed 640개 뒤의 유효 H도 예산과 입력을 보존하고 full CRC로 완료해요', () => {
  const encoded = encodeH('H', { version: 0, mode: 3, tones: 3, ecc: 'M', mask: 0 });
  const field = withLeadingSingletons(sheet(encoded));
  const original = field.data.slice();
  const hit = detectH(field, { normalizeContrast: false });
  assert.equal(hit.stats.capped, false);
  assert.deepEqual(hit.stats.capReasons, []);
  assert.ok(hit.stats.rawComponents < 512);
  assert.deepEqual(hit.faces.map(face => face.face).sort(), ['XM', 'YM', 'ZM']);
  const state = collect(hit.faces);
  assert.equal(state.state, 'DONE');
  assert.equal(state.result.text, 'H');
  assert.deepEqual(field.data, original);
});

test('고립 판정은 seed가 아닌 grow 문턱을 쓰고 행 경계를 넘지 않아요', () => {
  const field = white(96, 64);
  paint(field, 20, 20, 40, 1, .08);
  field.data[20 * field.width + 20] = .02;
  const hit = detectH(field, { normalizeContrast: false });
  assert.equal(hit.stats.photometric.seedThreshold, .04);
  assert.equal(hit.stats.photometric.threshold, .12);
  assert.equal(hit.stats.rawComponents, 1);
  assert.equal(hit.stats.components, 1);
  rejectWithoutPayload(hit);

  const border = white(32, 32);
  border.data[10 * border.width + 31] = 0;
  border.data[11 * border.width] = 0;
  const edgeHit = detectH(border, { normalizeContrast: false });
  assert.equal(edgeHit.stats.rawComponents, 0);
  assert.equal(edgeHit.stats.edgeDiscarded, 0);
  rejectWithoutPayload(edgeHit);
});

test('대각 접촉 성분은 합치지 않고 체커보드의 고립 점도 본문으로 승격하지 않아요', () => {
  const field = white(48, 48);
  paint(field, 10, 10, 6, 6);
  paint(field, 16, 16, 6, 6);
  const hit = detectH(field, { normalizeContrast: false });
  assert.equal(hit.stats.rawComponents, 2);
  assert.equal(hit.stats.components, 2);
  rejectWithoutPayload(hit);

  const checker = white(134, 134);
  for (let y = 2; y < 132; y++) for (let x = 2; x < 132; x++) {
    if ((x + y) % 2 === 0) checker.data[y * checker.width + x] = 0;
  }
  const checked = detectH(checker, { normalizeContrast: false });
  assert.equal(checked.stats.rawComponents, 0);
  assert.equal(checked.stats.capped, false);
  rejectWithoutPayload(checked);
});

test('기존 최소32픽셀 미만 성분은 후보512 예산을 소모하지 않아요', () => {
  const field = white(160, 80);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 32; x++) {
    paint(field, 2 + x * 4, 2 + y * 3, 2, 1);
  }
  const hit = detectH(field, { normalizeContrast: false });
  assert.equal(hit.stats.rawComponents, 640);
  assert.equal(hit.stats.tinyComponents, 640);
  assert.equal(hit.stats.candidateComponents, 0);
  assert.equal(hit.stats.floodPixels, 1280);
  assert.equal(hit.stats.components, 0);
  assert.equal(hit.stats.capped, false);
  rejectWithoutPayload(hit);
});

test('전체 후보를 확인한 뒤 수용 성분 옵션과 절대 128개 상한을 적용해요', () => {
  const field = white(170, 100);
  for (let i = 0; i < 129; i++) paint(field, 4 + i % 16 * 10, 4 + Math.floor(i / 16) * 10, 6, 6);
  for (const maxComponents of [2, 128, 200]) {
    const hit = detectH(field, { normalizeContrast: false, maxComponents });
    assert.equal(hit.stats.rawComponents, 129);
    assert.equal(hit.stats.candidateComponents, 129);
    assert.equal(hit.stats.components, Math.min(maxComponents, 128));
    assert.equal(hit.stats.prunedComponents, 129 - Math.min(maxComponents, 128));
    assert.equal(hit.stats.capped, true);
    assert.deepEqual(hit.stats.capReasons, ['pruned128']);
    assert.equal(hit.stats.componentLimit, Math.min(maxComponents, 128));
    rejectWithoutPayload(hit);
  }
});

test('후보가 512개를 넘는 부정 입력도 flood와 후단 상한을 지키고 완료하지 않아요', () => {
  const field = white(330, 210);
  for (let i = 0; i < 600; i++) paint(field, 4 + i % 32 * 10, 4 + Math.floor(i / 32) * 10, 6, 6);
  const original = field.data.slice();
  const hit = detectH(field, { normalizeContrast: false });
  assert.equal(hit.stats.rawComponents, 512);
  assert.equal(hit.stats.candidateComponents, 512);
  assert.equal(hit.stats.components, 128);
  assert.equal(hit.stats.prunedComponents, 384);
  assert.equal(hit.stats.floodPixels, 512 * 36);
  assert.equal(hit.stats.capped, true);
  assert.deepEqual(hit.stats.capReasons, ['candidates512', 'pruned128']);
  assert.deepEqual(field.data, original);
  rejectWithoutPayload(hit);
});

test('8192개를 넘는 연결 윤곽은 사각 후보로 진행하지 않아요', () => {
  const field = white(260, 76);
  for (let y = 2; y <= 70; y += 2) paint(field, 2, y, 256, 1);
  paint(field, 2, 2, 1, 69);
  const hit = detectH(field, { normalizeContrast: false, debug: true });
  assert.equal(hit.stats.rawComponents, 1);
  assert.equal(hit.stats.components, 1);
  assert.equal(hit.debugQuads.length, 0);
  assert.equal(hit.stats.corners.quads, 0);
  rejectWithoutPayload(hit);
});

test('여러 유효 크기 윤곽의 합계도 65536 작업 상한을 지켜요', () => {
  const field = white(9 * 260, 68);
  for (let i = 0; i < 9; i++) {
    const x = 2 + i * 260;
    for (let y = 2; y <= 60; y += 2) paint(field, x, y, 256, 1);
    paint(field, x, 2, 1, 59);
  }
  const hit = detectH(field, { normalizeContrast: false, debug: true });
  assert.equal(hit.stats.rawComponents, 9);
  assert.equal(hit.stats.components, 9);
  assert.equal(hit.stats.capped, true);
  assert.equal(hit.debugQuads.length, 8);
  assert.deepEqual(hit.stats.capReasons, ['work65536']);
  assert.equal(hit.stats.corners.quads, 8);
  rejectWithoutPayload(hit);
});

test('4M 픽셀을 초과하면 픽셀 저장소를 읽기 전에 거절해요', () => {
  const field = { width: 2001, height: 2000,
    get data() { throw new Error('초과 크기 입력의 픽셀 접근'); },
  };
  const hit = detectH(field);
  rejectWithoutPayload(hit);
  assert.deepEqual(hit.stats.capReasons, []);
});

test('24면을 정확히 읽는 것과 후속 성분을 면 수 상한으로 버리는 것을 구분해요', () => {
  const encoded = encodeH('H', { version: 0, mode: 3, tones: 3, ecc: 'M', mask: 0 });
  const exact = detectH(tiledSheets(encoded, 8), { normalizeContrast: false });
  assert.equal(exact.faces.length, 24);
  assert.equal(exact.stats.capped, false);
  assert.deepEqual(exact.stats.capReasons, []);
  const overflow = detectH(tiledSheets(encoded, 9), { normalizeContrast: false });
  assert.equal(overflow.faces.length, 24);
  assert.equal(overflow.stats.candidateComponents, 27);
  assert.equal(overflow.stats.capped, true);
  assert.deepEqual(overflow.stats.capReasons, ['faces24']);
});

test('고립 점을 건너뛰어 얻은 사각 관측도 거짓 route면 완료하지 않아요', () => {
  const encoded = encodeH('route-guard', { version: 5, mode: 3, tones: 3, ecc: 'M', mask: 0, finder: 'corners' });
  for (const levels of Object.values(encoded.faces)) for (const cell of hLayout(5, 'corners').routeCells) {
    if (cell.bit === 0) levels[cell.i * encoded.n + cell.j] ^= 7;
  }
  const hit = detectH(withLeadingSingletons(sheet(encoded)), { normalizeContrast: false });
  assert.equal(hit.faces.length, 3);
  assert.ok(hit.faces.every(face => face.finder === 'corners'));
  const state = collect(hit.faces);
  assert.equal(state.state, 'COLLECTING');
  assert.equal(state.result, undefined);
});
