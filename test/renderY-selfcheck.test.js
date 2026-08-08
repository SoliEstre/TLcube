/**
 * renderY-selfcheck.test.js — Type Y 통합 e2e (M0-Y 수용 기준 직결, SPEC §14)
 *
 * encodeY → sceneY(면 게인 음영 포함) → 결정적 래스터 → §7.2-Y 정규화(가중 로그 LS
 * 게인 추정) → 전 셀 digit 복원. 음영이 걸린 채로 100% 왕복해야 §4.4-Y 계약이
 * "정규화 체제에서" 성립함을 실증하는 것이다 — Type O 셀프체크와 달리 정규화 계층이
 * 검증 경로 안에 있다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { encodeY } from '../src/encodeY.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { verifyRasterY } from '../src/verifyY.js';
import { capacityTableY } from '../src/capacityY.js';

const QR_TEXT = 'HTTPS://TLCUBE.APP/S';

function paletteOf() {
  const p = getPreset(DEFAULT_PRESET);
  return {
    background: p.background,
    levels: p.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
    faceGains: DEFAULT_FACE_GAINS,
  };
}

const CASES = [
  { version: 1, text: 'Trilume Type Y — 단일 큐브 셀프체크 v1 왕복' }, //          61 B ≤ 98
  { version: 2, text: `https://example.com/trilume/type-y?payload=v2&pad=${'x'.repeat(80)}` }, // 128 B ≤ 141
];

for (const { version, text } of CASES) {
  test(`e2e 자체검증 Y${version} — 면 게인 음영 하 전 셀 digit 100% + Δmin-Y ≥ 0.12`, () => {
    const encoded = encodeY(text, { version, eccLevel: 'M' });
    const scene = buildSceneY(encoded, { palette: paletteOf(), qrText: QR_TEXT });
    const raster = rasterize(scene, { pixelsPerUnit: 14, supersample: 2 });
    const report = verifyRasterY(raster, scene, encoded);

    assert.equal(report.mismatches.length, 0,
      `digit 불일치 ${report.mismatches.length}건: ${JSON.stringify(report.mismatches.slice(0, 3))}`);
    assert.equal(report.matched, report.total);
    assert.ok(report.minDeltaY >= 0.12, `정규화 후 Δmin-Y ${report.minDeltaY} < 0.12`);
    assert.ok(report.residualGate.ok, `잔차 게이트 위반: ${JSON.stringify(report.residualGate)}`);
    assert.ok(report.ok);

    // 게인 추정이 렌더 게인을 실제로 복원했는가 (§7.2-Y 추정기 건전성).
    for (const face of ['T', 'L', 'R']) {
      assert.ok(Math.abs(report.gains[face] - DEFAULT_FACE_GAINS[face]) < 0.05,
        `${face} 게인 추정 ${report.gains[face]} vs 렌더 ${DEFAULT_FACE_GAINS[face]}`);
    }
  });
}

test('용량 생성표와 인코더 정합 (Y1/Y2 × M)', () => {
  for (const row of capacityTableY('M')) {
    const encoded = encodeY('y', { version: row.version, eccLevel: 'M' });
    assert.equal(encoded.codewordSymbols.length, row.usedSymbols);
    assert.equal(encoded.dataDigits.length, row.usedSymbols * 3);
  }
});

test('결정성 — 동일 입력 → 동일 픽셀 (QR 블록 포함)', () => {
  const run = () => {
    const encoded = encodeY('결정성 Y', { version: 1, eccLevel: 'M' });
    const scene = buildSceneY(encoded, { palette: paletteOf(), qrText: QR_TEXT });
    const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
    return createHash('sha256').update(Buffer.from(raster.pixels.buffer)).digest('hex');
  };
  assert.equal(run(), run());
});
