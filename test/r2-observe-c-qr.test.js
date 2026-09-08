import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from '../src/encode.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { observeCqQrGeometry } from '../src/decoder/cq-observe.js';
import { buildScene } from '../src/scene.js';
import { TYPE_C_RADII } from '../src/formatC.js';

function cqLuma() {
  const preset = getPreset(DEFAULT_PRESET);
  const palette = {
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
  const encoded = encode('cq-generator', {
    version: 0,
    eccLevel: 'M',
    notchC: true,
    centerQr: true,
  });
  const scene = buildScene(encoded, {
    palette,
    centerQr: true,
    qrText: 'HTTPS://TL.ESTRE.SO/',
    margin: 20,
  });
  return toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 12, supersample: 1 }));
}

function consumeAtMost(iterator, maximum) {
  const rows = [];
  while (rows.length < maximum) {
    const next = iterator.next();
    if (next.done) break;
    rows.push(next.value);
  }
  return rows;
}

test('CQ QR 관찰은 실제 소비 개수만큼만 결정적 기하 후보를 생성한다', () => {
  const luma = cqLuma();
  const iterator = observeCqQrGeometry(luma);
  const limited = consumeAtMost(iterator, 1);
  const first = limited[0];
  const firstH = Array.from(first.H);
  const firstSharedX = first.qrCandidate.shared.x;
  first.H.fill(0);
  assert.throws(() => { first.qrCandidate.shared.x = -1; }, TypeError);
  const next = iterator.next();
  assert.equal(next.done, false);
  limited.push(next.value, ...consumeAtMost(iterator, 3));
  assert.equal(limited.length, 5, '소비 상한 전에 후보가 끊겼다');
  assert.deepEqual(limited.map((entry) => entry.k), [14, 16, 18, 20, 14]);
  assert.ok(limited.every((entry) => entry.sourceKind === 'c-cq'));
  assert.ok(limited.every((entry) => entry.H instanceof Float64Array && entry.H.length === 9));
  assert.notDeepEqual(Array.from(limited[1].H), Array(9).fill(0), '다음 후보 H가 앞 후보 변경에 오염됐다');
  assert.equal(limited[1].qrCandidate.shared.x, firstSharedX);
  assert.equal(limited[0].qrCandidateIndex, 0);
  assert.equal(limited[0].axisIndex, 0);
  assert.equal(limited[4].axisIndex, 1);

  const all = [...observeCqQrGeometry(luma)];
  assert.ok(all.length >= limited.length);
  assert.deepEqual(Array.from(all[0].H), firstH, '새 iterator의 접두 H가 앞 소비자 변경에 오염됐다');
  assert.equal(all[0].qrCandidate.shared.x, firstSharedX);
  assert.deepEqual(all.slice(1, limited.length), limited.slice(1));
  for (let index = 0; index < all.length; index += 1) {
    const entry = all[index];
    assert.equal(entry.sourceKind, 'c-cq');
    assert.ok(TYPE_C_RADII.includes(entry.k));
    assert.equal(entry.orientation, entry.axisIndex);
    if (index > 0) {
      const previous = all[index - 1];
      assert.ok(
        entry.qrCandidateIndex > previous.qrCandidateIndex
        || (entry.qrCandidateIndex === previous.qrCandidateIndex
          && entry.axisIndex >= previous.axisIndex),
        'QR 후보와 축 순서가 역전됐다',
      );
    }
  }
});
