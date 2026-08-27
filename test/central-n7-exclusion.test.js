import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { buildScene } from '../src/scene.js';
import { CENTRAL_MARKER_N7_FINDER_PATTERN_ID } from '../src/centralMarkerN7.js';

const PALETTE = Object.freeze({
  background: Object.freeze({ r: 248, g: 249, b: 251 }),
  levels: Object.freeze([
    Object.freeze({ r: 20, g: 28, b: 42 }),
    Object.freeze({ r: 96, g: 116, b: 145 }),
    Object.freeze({ r: 218, g: 228, b: 242 }),
  ]),
  bullseyeDark: Object.freeze({ r: 0, g: 0, b: 0 }),
  bullseyeLight: Object.freeze({ r: 255, g: 255, b: 255 }),
});

function resultOf(fn, base, flags) {
  try {
    const encoded = fn('x', { ...base, ...flags });
    return { ok: true, encoded };
  } catch (error) {
    return { ok: false, name: error.name, message: error.message };
  }
}

test('중앙 슬롯 점유자 집합은 둘 이상이면 O/A/K 인코더가 모두 거부한다', () => {
  const cases = [
    { label: 'O', fn: encode, base: { version: 1, eccLevel: 'M' },
      occupants: ['centerQr', 'centralV0', 'centralN7', 'daehanFinder'] },
    { label: 'A', fn: encodeA, base: { version: 0, eccLevel: 'M' },
      occupants: ['centerQr', 'centralV0', 'centralN7', 'daehanFinder'] },
    { label: 'K', fn: encodeK, base: { version: 0, eccLevel: 'M' },
      occupants: ['centerQr', 'centralV0', 'centralN7'] },
  ];

  for (const { label, fn, base, occupants } of cases) {
    for (const occupant of occupants) {
      assert.equal(resultOf(fn, base, { [occupant]: true }).ok, true,
        `${label} 단독 ${occupant}`);
    }
    for (let left = 0; left < occupants.length; left += 1) {
      for (let right = left + 1; right < occupants.length; right += 1) {
        const flags = { [occupants[left]]: true, [occupants[right]]: true };
        const result = resultOf(fn, base, flags);
        assert.equal(result.ok, false, `${label} ${occupants[left]}+${occupants[right]}`);
        assert.match(result.message, /중앙 슬롯 점유자는 하나다/);
      }
    }
  }
});

test('새 점유자는 바깥 cornerMarker·turnA와 직교하고 기존 산출 회계를 바꾸지 않는다', () => {
  const cases = [
    { label: 'O', fn: encode, base: { version: 1, eccLevel: 'M' }, extra: {} },
    { label: 'G', fn: encode, base: { version: 1, eccLevel: 'M' }, extra: { cornerMarker: true } },
    { label: 'A', fn: encodeA, base: { version: 0, eccLevel: 'M' }, extra: {} },
    { label: 'V', fn: encodeA, base: { version: 0, eccLevel: 'M' }, extra: { turnA: true } },
    { label: 'K', fn: encodeK, base: { version: 0, eccLevel: 'M' }, extra: {} },
  ];

  for (const { label, fn, base, extra } of cases) {
    const plain = fn('N7 invariant', { ...base, ...extra });
    const withN7 = fn('N7 invariant', { ...base, ...extra, centralN7: true });
    assert.equal(withN7.centralN7, true, label);
    assert.equal(withN7.formatIndex, plain.formatIndex, `${label} formatIndex`);
    assert.deepEqual(withN7.capacity, plain.capacity, `${label} capacity`);
    assert.deepEqual([...withN7.cellDigits], [...plain.cellDigits], `${label} cellDigits`);
  }
});

test('새 점유자 플래그와 후보 B finder ID를 동시에 주면 scene 경계도 거부한다', () => {
  const encoded = encode('N7 vs M7', { version: 1, centralN7: true });
  assert.throws(() => buildScene(encoded, {
    palette: PALETTE,
    finderPatternId: CENTRAL_MARKER_N7_FINDER_PATTERN_ID,
    centralMarkerN7Family: 'hex',
  }), /중앙 슬롯 점유자는 하나만 렌더할 수 있다/);
});

test('centralN7 생략과 명시 false는 기존 전 조합에서 같은 결과를 낸다', () => {
  const oldFlags = ['cornerMarker', 'centerQr', 'turnA', 'daehanFinder', 'centralV0'];
  const cases = [
    { label: 'O', fn: encode, base: { version: 1, eccLevel: 'M' } },
    { label: 'A', fn: encodeA, base: { version: 0, eccLevel: 'M' } },
  ];
  for (const { label, fn, base } of cases) {
    for (let mask = 0; mask < (1 << oldFlags.length); mask += 1) {
      const flags = {};
      oldFlags.forEach((flag, index) => { if (mask & (1 << index)) flags[flag] = true; });
      const omitted = resultOf(fn, base, flags);
      const explicit = resultOf(fn, base, { ...flags, centralN7: false });
      assert.equal(explicit.ok, omitted.ok, `${label} mask=${mask}`);
      if (!omitted.ok) {
        assert.equal(explicit.name, omitted.name, `${label} mask=${mask} error type`);
        assert.equal(explicit.message, omitted.message, `${label} mask=${mask} error message`);
      } else {
        assert.deepEqual(explicit.encoded, omitted.encoded, `${label} mask=${mask} output`);
      }
    }
  }
});
