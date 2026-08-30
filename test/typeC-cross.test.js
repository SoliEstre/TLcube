/**
 * typeC-cross.test.js — 다중 RS 블록(레인 typec-rs) × 프런트(레인 typec-dec) 교차 왕복.
 *
 * 두 레인 어느 쪽도 단독으로 못 재는 조합이다: rs 레인은 프런트가 없었고,
 * dec 레인 시점엔 백엔드가 차단이었다. 리허설 머지에서 합성 이음새 2건이 실측됐다:
 *   ① dec 의 decode-c 가 rs 가 내린 assertTypeCSingleBlock 을 import (로드 사망)
 *   ② decode-c 본문이 단일 rsDecode 라 다중 블록 프레임이 BODY_RS_FAILED
 *     (포맷 후보 1 통과 후 본문에서 죽음 — 가설·포맷·본문이 다른 층이라는 증거)
 * 이 파일이 그 이음새를 성질로 잠근다 — 어느 층을 리팩터링해도 C1/C2 프런트
 * 전체 왕복이 서야 한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { daehanPatternId } from '../src/finder-daehan.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function roundtrip(name, opts) {
  const text = 'typeC-cross-' + name;
  const encoded = encode(text, opts);
  // C*D 는 제품 정형대로 태극(daehan 완전판)을 실제로 그린다 — finderPatternId 를
  // 안 주면 사괘 자리 60셀이 빈 «비제품 프레임» 이 되고, 그 프레임의 복호 여부는
  // 제품 축이 아니다 (v1 에서 우연히 돌던 것을 자로 잠그지 않는다).
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: 20,
    ...(opts.daehanFinder ? { finderPatternId: daehanPatternId(encoded.k) } : {}),
  });
  const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
  // 제품 계약: C*D 복호는 daehan 라인업 옵트인 경로다 (정식 스캐너 폴백 2차가
  // 이 옵션을 켠다 — scanner-daehan-fallback). 평 C 는 기본 경로 그대로.
  const result = decodeFrontend(raster, opts.daehanFinder
    ? { bootstrap: { cellFinderDaehan: true } }
    : undefined);
  assert.equal(result.ok, true, name + ' 왕복 실패: ' + (result.reason || ''));
  assert.equal(result.text, text, name + ': 원문 불일치');
  assert.equal(result.hypothesis.k, ({ 1: 16, 2: 18, 3: 20 })[opts.version], name + ': k 판정');
  return result;
}

test('다중 블록 × 프런트 — C1/C2 전 계열이 원문까지 돈다', { timeout: 300_000 }, () => {
  roundtrip('C1/M', { notchC: true, version: 1, eccLevel: 'M' });
  roundtrip('C2/M', { notchC: true, version: 2, eccLevel: 'M' });
  roundtrip('C3/M', { notchC: true, version: 3, eccLevel: 'M' });
  roundtrip('C1D/M', { notchC: true, version: 1, eccLevel: 'M', daehanFinder: true });
  roundtrip('C2D/H', { notchC: true, version: 2, eccLevel: 'H', daehanFinder: true });
  roundtrip('C3D/M', { notchC: true, version: 3, eccLevel: 'M', daehanFinder: true });
});

test('블록 수 1 무회귀 — C0 는 같은 경로에서 종전과 같이 돈다', { timeout: 120_000 }, () => {
  const result = roundtripC0();
  assert.equal(result.corrected, 0, 'C0 청정 프레임의 정정 수는 0 이어야 한다');
});

function roundtripC0() {
  const text = 'typeC-cross-C0/M';
  const encoded = encode(text, { notchC: true, version: 0, eccLevel: 'M' });
  const raster = rasterize(buildScene(encoded, { palette: PALETTE, margin: 20 }),
    { pixelsPerUnit: 12, supersample: 1 });
  const result = decodeFrontend(raster);
  assert.equal(result.ok, true, 'C0/M 왕복 실패: ' + (result.reason || ''));
  assert.equal(result.text, text);
  return result;
}
