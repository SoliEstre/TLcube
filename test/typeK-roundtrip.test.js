/**
 * typeK-roundtrip.test.js — Type K(육각별) 픽셀 왕복 + 검출 판별 (브리프 ③).
 *
 * encode → buildScene(육각별) → rasterize → decodeFrontend 가 **원문까지** 돌아온다.
 * 검출 경로: family.scoreStarTiling(코어 + 두 계열 패치 + 균형) → star 분류 →
 * findKAnchorHypotheses(별 꼭짓점 6 — 5/0/0·1/1/1) → 포맷 7(star 축) → decode-k.
 *
 * ⚠ 게이트·문턱은 하나도 안 바꿨다 — star 는 «추가 가설 축» 이고 기존 hex/tri/cube
 * 평가는 K 오양성이 없는 한 비트 동일이다 (무회귀는 대조군 + 기존 스위트 + 코퍼스
 * A/B 가 잰다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeK } from '../src/encodeK.js';
import { encodeA } from '../src/encodeA.js';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { scoreCubeTiling, scoreStarTiling } from '../src/decoder/family.js';
import { findKAnchorHypotheses } from '../src/decoder/anchor-detect.js';
import { VERSIONS_K } from '../src/capacityK.js';
import { axialToPixel } from '../src/hexgrid.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const PPU = 12;

function renderK(text, version) {
  const encoded = encodeK(text, { version, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: PALETTE, margin: 20 });
  return {
    encoded,
    scene,
    raster: rasterize(scene, { pixelsPerUnit: PPU, supersample: 1 }),
  };
}

test('K 왕복 — K0/K1/K2 가 star 가설·포맷 7 로 원문까지 돌아온다', () => {
  for (const spec of VERSIONS_K) {
    const text = 'typeK-roundtrip-' + spec.name;
    const { raster } = renderK(text, spec.version);
    const result = decodeFrontend(raster);
    assert.equal(result.ok, true,
      spec.name + ' 왕복 실패: ' + (result.reason || '') + ' '
      + JSON.stringify(result.detail && result.detail.pipelineCode));
    assert.equal(result.text, text, spec.name + ': 원문이 다르다');
    assert.equal(result.family, 'star', spec.name + ': 패밀리가 star 가 아니다');
    assert.equal(result.version, spec.version, spec.name + ': 버전이 다르다');
    assert.equal(result.versionName, spec.name);
    assert.equal(result.hypothesis.k, spec.k);
    assert.equal(result.diagnostics.format.formatIndex, 7,
      spec.name + ': 소비된 formatIndex 가 star 축 표(7)와 다르다');
    // F-107 잠금 검사 — cube 독립 양성이 파인더 경로를 잠그면 K 는 재시도 안전망
    // 없이는 죽는다. 성공 프레임의 진단으로 «잠기지 않았다» 를 명시 단언한다.
    const cubeDiag = result.diagnostics.bootstrap.geometry.cube;
    assert.equal(cubeDiag.ok, false,
      spec.name + ': cube 경로가 K 실루엣에 양성으로 섰다 — F-107 함정이 K 에 열렸다. '
      + '재시도 안전망(retryFinderComparison)에 기대기 시작한 것이니 잠금 검사를 갱신하라');
  }
});

test('대조군 무회귀 — 같은 하네스에서 O·A 는 기존 패밀리로 이긴다 (star 오양성 없음)', () => {
  const encodedA = encodeA('plain-A-control', { version: 1, eccLevel: 'M' });
  const sceneA = buildScene(encodedA, { palette: PALETTE, margin: 20 });
  const resultA = decodeFrontend(rasterize(sceneA, { pixelsPerUnit: PPU, supersample: 1 }));
  assert.equal(resultA.ok, true, 'A1 대조군 실패: ' + resultA.reason);
  assert.equal(resultA.text, 'plain-A-control');
  assert.equal(resultA.family, 'tri', 'A 프레임을 star 가 먹었다 — 배제 규칙 오발');

  const encodedO = encode('plain-O-control', { version: 2, eccLevel: 'M' });
  const sceneO = buildScene(encodedO, { palette: PALETTE });
  const resultO = decodeFrontend(rasterize(sceneO, { pixelsPerUnit: PPU, supersample: 1 }));
  assert.equal(resultO.ok, true, 'O V2 대조군 실패: ' + resultO.reason);
  assert.equal(resultO.text, 'plain-O-control');
  assert.equal(resultO.family, 'hex');
});

test('A 프레임에서 star 채점은 하드체크에 못 선다 — 반전 계열·균형 문턱 (배제 오발 방어)', () => {
  const encodedA = encodeA('star-guard-A', { version: 0, eccLevel: 'M' });
  const sceneA = buildScene(encodedA, { palette: PALETTE, margin: 20 });
  const raster = rasterize(sceneA, { pixelsPerUnit: PPU, supersample: 1 });
  const luma = toRelativeLuminance(raster, {});
  const center = axialToPixel(0, 0, sceneA.layout);
  const star = scoreStarTiling(luma, {
    center: { x: center.x * PPU, y: center.y * PPU },
    cellSize: PPU,
  }, { starKs: [6] });
  assert.equal(star.ok, true);
  assert.equal(star.hardChecks.all, false,
    'A0 프레임에서 star 하드체크가 섰다 — 반전 계열 문턱·균형이 무력하다');
});

test('60° 오가설 사멸 — 앵커 판정만으로 죽는다 (계약 K-2 채택 근거 실측)', () => {
  const spec = VERSIONS_K[0];
  const { scene, raster } = renderK('sixty-degree-probe', spec.version);
  const luma = toRelativeLuminance(raster, {});
  const center = axialToPixel(0, 0, scene.layout);
  const bullseye = {
    center: { x: center.x * PPU, y: center.y * PPU },
    cellSize: PPU,
  };
  // 대조: 올바른 포즈에서는 앵커 6/6 이 선다.
  const upright = findKAnchorHypotheses(luma, bullseye, [spec.k], {});
  assert.equal(upright.ok, true, '대조 실패: ' + (upright.reason || ''));
  assert.ok(upright.hypotheses.some((h) => h.hardChecks.all && h.orientation === 0));
  // 60° 회전 H 주입 — A 계열 꼭짓점 자리가 반전 계열 자리로 간다. digit 배정
  // (5/0/0 vs 1/1/1)이 다르므로 expectedPattern 이 전 방향에서 죽어야 한다.
  const angle = Math.PI / 3;
  const H60 = new Float64Array([
    PPU * Math.cos(angle), -PPU * Math.sin(angle), bullseye.center.x,
    PPU * Math.sin(angle), PPU * Math.cos(angle), bullseye.center.y,
    0, 0, 1,
  ]);
  const rotated = findKAnchorHypotheses(luma, bullseye, [spec.k], { H: H60, cellSizeSearch: false });
  assert.equal(rotated.ok, false, '60° 오가설이 앵커를 통과했다 — digit 1 배정이 무력하다');
  const rejectedAtK = rotated.detail.rejected.filter((r) => r.k === spec.k);
  assert.ok(rejectedAtK.length > 0);
  for (const rejection of rejectedAtK) {
    assert.equal(rejection.hardChecks.expectedPattern, false,
      '60° 오가설의 기각 사유가 expectedPattern 이 아니다 (' + JSON.stringify(rejection.hardChecks)
      + ') — 위치가 아니라 digit 이 죽여야 한다');
  }
});

test('cube 잠금 이중 검사 — K 실루엣에서 cube 채점이 서지 않는다 (F-107 이중 자물쇠)', () => {
  // 위 왕복 테스트의 진단 단언과 겹으로: 검출기 단독 호출에서도 양성이 아니어야
  // 한다 (성공 경로가 바뀌어도 이 자물쇠가 남는다 — 턴A 레인 안전망 전례).
  for (const spec of VERSIONS_K) {
    const { raster } = renderK('cube-lock-' + spec.name, spec.version);
    const luma = toRelativeLuminance(raster, {});
    const cube = scoreCubeTiling(luma, undefined, {});
    const positive = cube.ok === true && cube.hardChecks && cube.hardChecks.all === true;
    assert.equal(positive, false,
      spec.name + ': cube 채점이 K 실루엣에 hard 양성이다 — F-107 함정');
  }
});
