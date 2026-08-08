/**
 * render-selfcheck.test.js — T9 통합 e2e (M0 수용 기준 직결)
 *
 * 인코더 → scene → 래스터 → §4.4 측정 통계(원판 median)로 전 셀 digit 복원.
 * 수용 기준: 3면 상대휘도 순서가 의도한 digit 과 100% 일치 · Δmin ≥ 0.12 전 셀 성립 ·
 * V1/V2/V3 렌더 + 데이터 심볼 수 §5.5 일치 · 동일 입력 → 동일 픽셀(결정성).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { encode } from '../src/encode.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT, DELTA_MIN_CONTRACT } from '../src/luminance.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { verifyRaster } from '../src/verify.js';
import { capacityTable } from '../src/capacity.js';

/** 프리셋 → scene palette (index.html 과 동일한 결선). */
function paletteOf(presetName) {
  const p = getPreset(presetName);
  return {
    background: p.background,
    levels: p.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
  };
}

/** 버전별 대표 페이로드 — 해당 버전이 자동 선택되도록 길이를 맞춘다. */
const CASES = [
  { version: 1, text: 'TLcube V1 ✓' }, //                                        13 B ≤ 18
  { version: 2, text: 'https://example.com/tlcube?v=2&x=abcdef' }, //            39 B = 39
  { version: 3, text: 'https://example.com/trilume/selfcheck?payload=v3&pad=0123456789' }, // 63 B ≤ 65
];

for (const { version, text } of CASES) {
  test(`e2e 자체검증 V${version} — 전 셀 digit 100% 일치 + Δmin ≥ ${DELTA_MIN_CONTRACT}`, () => {
    const encoded = encode(text, { version, eccLevel: 'M' });
    assert.equal(encoded.version, version);

    const scene = buildScene(encoded, { palette: paletteOf(DEFAULT_PRESET) });
    const raster = rasterize(scene, { pixelsPerUnit: 16, supersample: 2 });
    const report = verifyRaster(raster, scene, encoded);

    assert.equal(report.mismatches.length, 0,
      `digit 불일치 ${report.mismatches.length}건: ${JSON.stringify(report.mismatches.slice(0, 3))}`);
    assert.equal(report.matched, report.total);
    assert.ok(report.minDelta >= DELTA_MIN_CONTRACT,
      `측정 Δmin ${report.minDelta} < 계약 ${DELTA_MIN_CONTRACT}`);
    assert.ok(report.ok);
  });
}

test('데이터 심볼 수가 §5.5 용량표와 일치한다 (V1/V2/V3 × M)', () => {
  const table = capacityTable('M');
  for (const row of table) {
    const encoded = encode('x', { version: row.version, eccLevel: 'M' });
    assert.equal(encoded.codewordSymbols.length, row.usedSymbols);
    assert.equal(encoded.dataDigits.length, row.usedSymbols * 3);
    assert.equal(encoded.fillerDigits.length, row.residualCells);
  }
});

test('결정성 — 동일 입력 → 동일 픽셀 버퍼 (sha256 일치)', () => {
  const run = () => {
    const encoded = encode('결정성', { version: 1, eccLevel: 'M' }); // 9 B ≤ 18
    const scene = buildScene(encoded, { palette: paletteOf(DEFAULT_PRESET) });
    const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
    return createHash('sha256').update(Buffer.from(raster.pixels.buffer)).digest('hex');
  };
  assert.equal(run(), run());
});
