/**
 * cell-finder-rotation.test.js — 19셀 cell-mask 파인더의 **격자 밖 회전**과 **반바퀴(C2)** 회귀.
 *
 * 배경 (2026-09-27 · 28 회전 조사 — 꾸미기 측정의 무꾸밈 대조군이 5° 에서 무너진 것이 발단):
 *   - cell-finder 는 회전을 15° 조대 격자로만 훑고 좌표 하강으로 정교화하는데 그 포획이 ≈3° 라,
 *     실패가 회전 크기가 아니라 «격자까지의 잔차» 를 따랐다(5° · 20° ✗, 12° ✓). 기존
 *     decoder-cell-finder 테스트는 0/120/240° — 전부 격자 위라 이 띠를 못 봤다. 처방: 19셀 그룹만
 *     조대 7.5°(cell-finder-detect.js CELL19_COARSE_ANGLE_STEP_DEGREES). → ②
 *   - pinwheel-c2 는 휘도가 180° 회전에 불변이라 파인더가 θ 와 θ+180° 를 못 가린다. 뒤집힌 H 는
 *     자세 오차가 0 이어도 포맷이 전멸한다. 처방: bootstrap 반바퀴 쌍둥이 가설(-r180).
 *     → ③ (정확히 180° 는 조대 동률이 0° 쪽으로 가므로 결정적이다)
 *   - finder 최종 출력 상한 2 에서 daehan 프레임의 19셀 후보가 daehan 후보를 밀어냈다. 처방: 상한 4. → ④
 *
 * 각 단언은 **성질**(읽힌다)만 잰다 — 옛 실패를 값으로 잠그지 않는다. 착지 전 실측(2026-09-28):
 *   ②③ 은 옛 트리(main 0c70b43)에서 전부 ✗.
 *   ④ 는 **19셀 조대 7.5° 와 출력 상한 4 가 함께** 있어야 읽힌다 — 옛 트리는 상한을 4 로 올려도 ✗, 이 트리에서
 *   상한만 2 로 되돌려도 ✗. 그래서 ④ 는 둘 중 하나가 빠지는 회귀를 잡는다.
 *   (정교화 안에서 멀리 뛰는 «회전 괄호» 는 합성에선 더 좋았지만 실사진 코퍼스 죽음 6 · 전수 실패 3 으로
 *   철회했다 — 이 파일의 격자 밖 각도 통과만으로 회전 처방을 바꾸지 마라. 채택 자는 실사진 코퍼스 A/B 다.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isHalfTurnSymmetricCellMasks } from '../src/decoder/cell-finder-detect.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { encode } from '../src/encode.js';
import { daehanPatternId } from '../src/finder-daehan.js';
import { VERSIONS_DAEHAN } from '../src/capacityDaehan.js';
import { FINDER_CELL_MASK_PATTERNS, FINDER_PATTERNS } from '../src/finder-patterns.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { distortImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PINWHEEL = 'pinwheel-c2-2-1100-cw';

function renderPinwheel(text) {
  const encoded = encode(text, { version: 2, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: PALETTE, finderPatternId: PINWHEEL });
  return rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
}

test('① 휘도 C2 판정은 cellMasks 에서 유도된다 — 현 라인업은 pinwheel-c2 하나, 면 비트가 섞인 «C2» 는 아니다', () => {
  const c2 = FINDER_CELL_MASK_PATTERNS.filter((p) => isHalfTurnSymmetricCellMasks(p.cellMasks)).map((p) => p.id);
  assert.deepEqual(c2, [PINWHEEL]);
  // 생성 파라미터가 C2 라도 면 단위 비트가 섞이면 180° 가 면을 면 자리에 못 겹친다 — 메타데이터를 믿지 않는 근거.
  const swirl = FINDER_PATTERNS.find((p) => p.id === 'swirl-c2-5-5-11-both');
  assert.ok(swirl, 'swirl-c2 패턴이 라인업에서 사라졌다 — 이 단언의 표본을 바꿔라');
  assert.equal(isHalfTurnSymmetricCellMasks(swirl.cellMasks), false);
  // 판정 대상 밖: 19셀이 아닌 입력.
  assert.equal(isHalfTurnSymmetricCellMasks([]), false);
  assert.equal(isHalfTurnSymmetricCellMasks(undefined), false);
});

test('② pinwheel 이 15° 조대 격자 밖 각도(잔차 5 · 7 · 5°)에서 원문까지 읽힌다', { timeout: 60_000 }, () => {
  const text = 'cell-finder-rotation';
  const source = renderPinwheel(text);
  for (const degrees of [5, 8, 20]) {
    const result = decodeFrontend(distortImage(source, { rotation: degrees, fill: FILL }));
    assert.equal(result.ok, true, degrees + '°: ' + JSON.stringify(result.reason));
    assert.equal(result.text, text, degrees + '°');
  }
});

test('③ C2 파인더의 반바퀴 — 정확히 180° 돌린 pinwheel 이 반바퀴 쌍둥이 가설로 읽힌다', { timeout: 60_000 }, () => {
  const text = 'cell-finder-rotation';
  const result = decodeFrontend(distortImage(renderPinwheel(text), { rotation: 180, fill: FILL }));
  assert.equal(result.ok, true, JSON.stringify(result.reason));
  assert.equal(result.text, text);
  // 조대 동률은 0° 쪽 후보가 이기므로(insertTop 순서) 참 자세는 쌍둥이 쪽이어야 한다 — 쌍둥이가 빠지면 ✗.
  assert.match(result.hypothesis.id, /-r180$/, '승자가 반바퀴 쌍둥이가 아니다: ' + result.hypothesis.id);
});

test('④ daehan(옵트인) 이 해상도 한계에서 읽힌다 — 19셀 조대 7.5° 와 finder 출력 상한 4 의 짝', { timeout: 60_000 }, () => {
  const spec = VERSIONS_DAEHAN.find((entry) => entry.k === 10);
  assert.ok(spec, 'daehan k10 버전이 표에서 사라졌다');
  const text = 'daehan-cap';
  const encoded = encode(text, { version: spec.version, eccLevel: 'M', daehanFinder: true });
  const scene = buildScene(encoded, { palette: PALETTE, finderPatternId: daehanPatternId(spec.k) });
  // 8 ppu 는 이 코드의 해상도 한계 근처 — 옛 트리 ✗(상한 4 로도), 이 트리의 상한 2 ✗ (2026-09-28 실측, 머리말).
  const raster = rasterize(scene, { pixelsPerUnit: 8, supersample: 2 });
  const result = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
  assert.equal(result.ok, true, JSON.stringify(result.reason));
  assert.equal(result.text, text);
});
