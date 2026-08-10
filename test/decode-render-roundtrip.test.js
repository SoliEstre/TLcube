/**
 * decode-render-roundtrip.test.js — 렌더를 통과하는 왕복 (M1 에서 검출 단계만 뺀 것)
 *
 * 인코더 → scene → 래스터 → **픽셀 샘플링으로 digit 복원** → `decodeCells` → 원문.
 *
 * 왜 별도로 두는가 — 기존 두 테스트의 사이가 비어 있었다:
 *   · `render-selfcheck.test.js` 는 렌더에서 digit 을 복원해 **의도한 digit 과** 대조한다
 *     (페이로드까지 가지 않는다).
 *   · `decode.test.js` 는 인코더의 `cellDigits` 를 그대로 되돌린다 (**렌더를 거치지 않는다**).
 *   둘 다 통과해도 "렌더된 픽셀에서 페이로드가 나온다" 는 보장되지 않는다 — 이 파일이
 *   그 이음매를 고정한다. 두 절반이 실제로 합성되는지가 M1 의 전제다.
 *
 * 기하는 알고 있으므로(렌더한 쪽이므로) **검출·호모그래피는 범위 밖**이다. 그건 앞단
 * (`.agent/decoder/001_frontend_design.md` · `001c_design_revision.md`) 몫이고, 왜곡
 * 입력은 `test/harness/distort.mjs` 와 함께 M1 하네스에서 다룬다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { measureCellFaceMedians, recoverDigit } from '../src/verify.js';
import { decodeCells } from '../src/decode.js';
import { dataCellsInScanOrder } from '../src/layout.js';

/** 프리셋 → scene palette (index.html · render-selfcheck 와 동일한 결선). */
function paletteOf(name) {
  const p = getPreset(name);
  return {
    background: p.background,
    levels: p.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

/** 버전 → 격자 반경 k (Type O). */
const K_OF_VERSION = Object.freeze({ 1: 6, 2: 8, 3: 10 });

/**
 * 렌더된 래스터에서만 digit 을 읽어 페이로드까지 되돌린다.
 * 인코더의 `cellDigits` 는 **대조용으로만** 쓰고 복호 입력으로 쓰지 않는다 —
 * 그러면 렌더를 우회해 "역의 역" 을 검사하는 것이 된다.
 */
function roundTripThroughRender(text, { version, eccLevel, pixelsPerUnit }) {
  const encoded = encode(text, { version, eccLevel });
  const scene = buildScene(encoded, { palette: paletteOf(DEFAULT_PRESET) });
  const raster = rasterize(scene, { pixelsPerUnit, supersample: 2 });

  const k = K_OF_VERSION[encoded.version];
  const digits = [];
  let mismatched = 0;

  for (const cell of dataCellsInScanOrder(k)) {
    const q = cell.q ?? cell[0];
    const r = cell.r ?? cell[1];
    const recovered = recoverDigit(measureCellFaceMedians(raster, scene, q, r));
    digits.push(recovered);

    const truth = encoded.cellDigits.get(`${q},${r}`);
    if (truth && truth.digit !== recovered) mismatched += 1;
  }

  return {
    result: decodeCells(digits, { version: encoded.version, eccLevel, k }),
    mismatched,
    cellCount: digits.length,
  };
}

const CASES = [
  { text: 'hello trilume', version: 1, eccLevel: 'M' },
  { text: 'x', version: 1, eccLevel: 'L' },
  { text: 'https://tl.estre.so', version: 2, eccLevel: 'M' },
  { text: '한글 페이로드 테스트', version: 3, eccLevel: 'M' },
  { text: '한국어 문자열 확인용', version: 3, eccLevel: 'H' },
];

for (const { text, version, eccLevel } of CASES) {
  for (const pixelsPerUnit of [8, 14]) {
    test(`렌더 왕복 V${version}/${eccLevel} ppu=${pixelsPerUnit}`, () => {
      const { result, mismatched, cellCount } = roundTripThroughRender(text, {
        version, eccLevel, pixelsPerUnit,
      });

      // digit 이 하나라도 어긋나면 ECC 가 덮더라도 렌더 계약이 깨진 것이다 —
      // §4.4 의 "순서 100% 보존" 은 ECC 이전 층의 약속이므로 여기서 0 을 요구한다.
      assert.equal(mismatched, 0,
        `렌더에서 복원한 digit 이 ${mismatched}/${cellCount} 개 어긋났다`);

      assert.equal(result.ok, true,
        `복호 실패: ${JSON.stringify(result)}`);
      assert.equal(result.text, text);
      assert.equal(result.corrected, 0,
        '무왜곡 렌더인데 RS 정정이 발생했다 — 앞 단계에 손상이 있다');
    });
  }
}

test('렌더 왕복은 결정적이다', () => {
  const once = roundTripThroughRender('determinism', { version: 2, eccLevel: 'M', pixelsPerUnit: 10 });
  const twice = roundTripThroughRender('determinism', { version: 2, eccLevel: 'M', pixelsPerUnit: 10 });
  assert.deepEqual(once.result, twice.result);
  assert.equal(once.mismatched, twice.mismatched);
});
