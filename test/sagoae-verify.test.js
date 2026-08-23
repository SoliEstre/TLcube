/**
 * sagoae-verify.test.js — sagoae 단독 검증기 + «중앙 파인더 ∥ sagoae» 분해 (W2 C2c).
 *
 * 잠그는 명제 셋:
 *  ① 검증기는 자기 k 에만 선다 — daehan k6 프레임 위 solo 포즈에서 k6 고리는
 *     corr ≈ 1.0 으로 서고, k8/k10 고리(그 프레임엔 데이터/배경)는 넘어지지 않는다
 *     (넘어지면 오수용). 레거시 프레임에선 전 k 가 넘어진다.
 *  ② 분해 경로가 실재한다 — **원자 daehan 검출 없이** (공급 파인더 = solo 하나)
 *     옵트인 복호가 원문까지 돈다. 이것이 «daehan = taegeuk + sagoae 조합의
 *     특수례» 재정의(PM/022 W2-taegeuk ③)의 디코더 반쪽 증명이다.
 *  ③ 분해는 옵트인 안이다 — 같은 공급 파인더도 cellFinderDaehan 없이는 daehan
 *     회계가 열리지 않는다 (기본 경로 비트 동일의 구조 근거).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { daehanPatternId } from '../src/finder-daehan.js';
import { detectCellFinders } from '../src/decoder/cell-finder-detect.js';
import { verifySagoae } from '../src/decoder/sagoae-verify.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { FINDER_CELL_MASK_PATTERNS } from '../src/finder-patterns.js';
import {
  OAK_FINDER_PATTERNS, OAK_RENDER_ONLY_FINDER_PATTERNS,
} from '../src/finder-oak-patterns.js';

const preset = getPreset(DEFAULT_PRESET);
const PALETTE = {
  background: preset.background, levels: preset.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
};
// 원자 daehan 패턴이 **없는** 라인업 — solo 가 유일한 daehan 흔적이다.
const LINEUP_NO_ATOMIC = [
  ...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS, ...OAK_RENDER_ONLY_FINDER_PATTERNS,
];

function daehanRaster(text, k) {
  const enc = encode(text, { version: 1, eccLevel: 'M', daehanFinder: true });
  const scene = buildScene(enc, { palette: PALETTE, finderPatternId: daehanPatternId(k) });
  return rasterize(scene, { pixelsPerUnit: 24, supersample: 2 });
}

function soloFinderOf(luma) {
  const detected = detectCellFinders(luma, LINEUP_NO_ATOMIC, {
    centerSeeds: [{ x: luma.width / 2, y: luma.height / 2 }],
  });
  assert.ok(detected.ok, '중앙 후보 검출 실패');
  const solo = detected.candidates.find((c) => c.patternId === 'oak-taegeuk-solo');
  assert.ok(solo, 'taegeuk-solo 후보가 없다: '
    + detected.candidates.map((c) => c.patternId).join(','));
  return solo;
}

test('① 검증기 — 자기 k 에만 선다 (k6 프레임: k6 ✓ · k8/k10 ✗ · 레거시 전 k ✗)', () => {
  const luma = toRelativeLuminance(daehanRaster('sagoae', 6), {});
  const solo = soloFinderOf(luma);
  const v6 = verifySagoae(luma, solo.transform, 6);
  assert.equal(v6.ok, true, JSON.stringify(v6));
  assert.ok(v6.correlation >= 0.99, '고리 상관이 낮다: ' + v6.correlation);
  for (const k of [8, 10]) {
    const v = verifySagoae(luma, solo.transform, k);
    assert.equal(v.ok, false, 'k=' + k + ' 오수용: ' + JSON.stringify(v));
  }
  // 레거시(비-daehan) 프레임 — 예약 자리가 데이터라 전 k 가 넘어져야 한다.
  // 셀마스크 계열 파인더로 그린다 (기본 cube-bullseye 는 cell-finder 대상이 아니다).
  const legacyEnc = encode('legacy', { version: 1, eccLevel: 'M' });
  const legacyLuma = toRelativeLuminance(
    rasterize(buildScene(legacyEnc, {
      palette: PALETTE, finderPatternId: FINDER_CELL_MASK_PATTERNS[0].id,
    }), { pixelsPerUnit: 24, supersample: 2 }), {},
  );
  const legacy = detectCellFinders(legacyLuma, LINEUP_NO_ATOMIC, {
    centerSeeds: [{ x: legacyLuma.width / 2, y: legacyLuma.height / 2 }],
  });
  assert.ok(legacy.ok);
  for (const k of [6, 8, 10]) {
    const v = verifySagoae(legacyLuma, legacy.candidates[0].transform, k);
    assert.equal(v.ok, false, '레거시 k=' + k + ' 오수용: ' + JSON.stringify(v));
  }
});

test('② 분해 경로 — 원자 daehan 검출 없이 solo ∥ sagoae 로 원문까지 돈다', () => {
  const raster = daehanRaster('TLcube', 6);
  const luma = toRelativeLuminance(raster, {});
  const solo = soloFinderOf(luma);
  const on = decodeFrontend(raster, {
    familyEvidence: { finders: [solo] },
    bootstrap: { cellFinderDaehan: true },
  });
  assert.equal(on.ok, true, JSON.stringify(on.reason ?? null));
  assert.equal(on.text, 'TLcube');
});

test('③ 분해는 옵트인 안 — 같은 공급 파인더도 기본 옵션에선 daehan 회계가 안 열린다', () => {
  const raster = daehanRaster('TLcube', 6);
  const luma = toRelativeLuminance(raster, {});
  const solo = soloFinderOf(luma);
  const off = decodeFrontend(raster, { familyEvidence: { finders: [solo] } });
  assert.equal(off.ok, false, '분해 경로가 옵트인 밖으로 샜다');
});
