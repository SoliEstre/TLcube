import assert from 'node:assert/strict';
import test from 'node:test';

import { cellSampleDiscs } from '../src/hexgrid.js';
import {
  CORNER_QR_ASSIST_PROFILES,
  localizeCornerQrAssist,
} from '../src/decoder/corner-qr-assist.js';
import { enumerateCornerQrSeeds, qrRightAngleAxes } from '../src/decoder/corner-qr-seed.js';
import { immediateCornerQrHint } from '../src/scanner-scan-assist.js';

function candidateAt(x, y, modulePx) {
  return {
    kind: 'center',
    kindAmbiguous: false,
    module: modulePx,
    cosine: 0,
    shared: { x, y, module: modulePx },
    axisA: { x: x + 14 * modulePx, y, module: modulePx },
    axisB: { x, y: y + 14 * modulePx, module: modulePx },
  };
}

function blankLuma(width = 1000, height = 1000) {
  return { width, height, data: new Float32Array(width * height).fill(0.5) };
}

function paintSilhouette(luma, candidate, seed, silhouette, swapAxes = false) {
  const profile = CORNER_QR_ASSIST_PROFILES.find((entry) => entry.id === silhouette);
  const axes = qrRightAngleAxes(candidate);
  const horizontal = swapAxes ? axes.v : axes.u;
  const vertical = swapAxes ? axes.u : axes.v;
  for (const cell of profile.cells) {
    const discs = cellSampleDiscs(cell.q, cell.r, { size: 1, originX: 0, originY: 0 });
    for (const [index, face] of ['T', 'L', 'R'].entries()) {
      const point = discs[face];
      const x = Math.round(seed.center.x + 2 * point.x * horizontal.x + 2 * point.y * vertical.x);
      const y = Math.round(seed.center.y + 2 * point.x * horizontal.y + 2 * point.y * vertical.y);
      if (x >= 0 && y >= 0 && x < luma.width && y < luma.height) {
        luma.data[y * luma.width + x] = [0.05, 0.5, 0.95][index];
      }
    }
  }
}

function seedFor(candidate, silhouette, placement) {
  return enumerateCornerQrSeeds([candidate], CORNER_QR_ASSIST_PROFILES)
    .find((seed) => seed.silhouette === silhouette && seed.placement === placement);
}

test('스케일·평행이동에도 실제 지지 위치와 cellPx를 돌려준다', () => {
  for (const sample of [
    { x: 120, y: 140, modulePx: 3 },
    { x: 230, y: 180, modulePx: 5 },
  ]) {
    const candidate = candidateAt(sample.x, sample.y, sample.modulePx);
    const expected = seedFor(candidate, 'hex', 'TL');
    const luma = blankLuma();
    paintSilhouette(luma, candidate, expected, 'hex', true);
    const result = localizeCornerQrAssist(luma, [candidate]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(Math.hypot(result.center.x - expected.center.x, result.center.y - expected.center.y) < 1e-9);
    assert.equal(result.cellPx, sample.modulePx * 2);
    assert.equal(result.corner, 'TL');
    assert.equal(result.ambiguity.location, false);
  }
});

test('서로 다른 두 위치가 비슷하게 지지되면 하나를 지어내지 않는다', () => {
  const candidate = candidateAt(250, 250, 4);
  const first = seedFor(candidate, 'hex', 'TL');
  const second = seedFor(candidate, 'hex', 'BR');
  const luma = blankLuma();
  paintSilhouette(luma, candidate, first, 'hex');
  paintSilhouette(luma, candidate, second, 'hex');
  const result = localizeCornerQrAssist(luma, [candidate]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ambiguous-location');
  assert.equal(result.ambiguity.location, true);
  assert.equal(result.center, undefined);
});

test('QR 기하가 없거나 잔차 문턱을 넘으면 모른다', () => {
  const luma = blankLuma();
  assert.equal(localizeCornerQrAssist(luma, []).reason, 'no-finder');
  const malformed = candidateAt(200, 200, 4);
  malformed.axisB.x += 20;
  assert.equal(localizeCornerQrAssist(luma, [malformed]).reason, 'no-geometric-candidate');
});

test('프레임 중앙에 가까워도 표면 지지가 없으면 모른다', () => {
  const candidate = candidateAt(286, 300, 4);
  const result = localizeCornerQrAssist(blankLuma(), [candidate]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, 'ambiguous-location');
  assert.equal(result.center, undefined);
});

test('즉시 안내는 cell 하한 아래에서만 열리고 모름·잘림을 우선한다', () => {
  const base = {
    ok: false,
    scanAssist: { ok: true, cellPx: 8.99, center: { x: 10, y: 20 } },
  };
  assert.equal(immediateCornerQrHint(base).messageKey, 'status.small');
  assert.equal(immediateCornerQrHint({ ...base, scanAssist: { ok: true, cellPx: 9 } }), null);
  assert.equal(immediateCornerQrHint({ ...base, scanAssist: { ok: false } }), null);
  assert.equal(immediateCornerQrHint({ ...base, clipSide: 'multi' }), null);
});
