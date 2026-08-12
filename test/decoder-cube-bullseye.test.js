/*
 * 하이브리드 파인더 — 바깥 불스아이 링(위치·스케일) + 안쪽 3톤 큐브(방향).
 *
 * 왜 이 파일이 필요한가: 2026-08-12 에 «안쪽 밴드를 갈아 끼우면 불스아이 검출기는 못 쓴다»
 * 고 결론냈다가 뒤집었다. 그때 실험이 **검증** 단계만 관대하게 만들고 정작 결정하는
 * **제안** 단계(방사 대칭 투표)를 그대로 뒀던 것이 이유다. 두 단계가 같은 레이아웃을
 * 봐야 한다는 계약을 여기 고정한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BAND_COUNT, HYBRID_INNER_CUBE_BANDS, HYBRID_RING_BAND_COUNT,
  bandRadii, hybridBandRadii, hybridCubeRadius, maxSafeRadius,
} from '../src/bullseye.js';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset, relativeLuminance,
} from '../src/luminance.js';
import { detectBullseyes, pyramidLevelsForImage } from '../src/decoder/bullseye-detect.js';
import { readCubeOrientation } from '../src/decoder/cube-bullseye.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { rotateImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: Object.freeze({ r: 255, g: 255, b: 255 }),
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const TEXT = 'TLCUBE OK';
const ENCODED = encode(TEXT, { version: 1, eccLevel: 'M' });

function render(finderPatternId, pixelsPerUnit) {
  const scene = buildScene(ENCODED, { palette: PALETTE, cellSize: 1, finderPatternId });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

function toLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  for (let index = 0; index < data.length; index += 1) {
    const pixel = index * 4;
    data[index] = relativeLuminance({
      r: raster.pixels[pixel], g: raster.pixels[pixel + 1], b: raster.pixels[pixel + 2],
    });
  }
  return { width: raster.width, height: raster.height, data, alpha: null };
}

function bestCandidate(result) {
  if (result.ok !== true || result.candidates.length === 0) return null;
  return result.candidates.reduce((left, right) => (right.score > left.score ? right : left));
}

test('하이브리드 기하는 canonical 밴드 격자에서 유도된다 — 별도 상수가 없다', () => {
  const radii = bandRadii(1);
  // 큐브 반지름 = 안쪽 두 밴드의 폭 합 = 두 번째 경계. 이게 성립해야 남는 4밴드가
  // «원래 자리 그대로» 이고, 검출기의 정규 기하를 한 줄도 안 고치고 재사용할 수 있다.
  assert.equal(hybridCubeRadius(1), radii[HYBRID_INNER_CUBE_BANDS - 1]);
  assert.equal(HYBRID_RING_BAND_COUNT, BAND_COUNT - HYBRID_INNER_CUBE_BANDS);
  assert.equal(HYBRID_RING_BAND_COUNT, 4);

  const ring = hybridBandRadii(1);
  assert.equal(ring.length, HYBRID_RING_BAND_COUNT + 1);
  assert.equal(ring[0], hybridCubeRadius(1));
  assert.equal(ring[ring.length - 1], maxSafeRadius(1));
  // 폭이 균등하므로 링 밴드 폭은 순수 불스아이와 같다 — 저해상도 병목이 나빠지지 않는다.
  for (let index = 1; index < ring.length; index += 1) {
    assert.ok(Math.abs((ring[index] - ring[index - 1]) - maxSafeRadius(1) / BAND_COUNT) < 1e-12);
  }

  // 배율에도 같은 비율이 유지된다 (cellSize 를 흘려보내는 경로가 하나뿐이라는 계약).
  assert.ok(Math.abs(hybridCubeRadius(3) - 3 * hybridCubeRadius(1)) < 1e-12);
});

test('하이브리드 렌더는 어느 배경에서도 색이 null 인 shape 을 만들지 않는다', () => {
  // shape.color 는 언제나 구체 {r,g,b} 다. 투명이 허용되는 곳은 scene.background 뿐이고,
  // 이 계약을 깨서 큐브 파인더가 라이브에서 죽은 적이 있다(2026-08-12).
  for (const background of [null, { r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }]) {
    const scene = buildScene(ENCODED, {
      palette: { ...PALETTE, background },
      cellSize: 1,
      finderPatternId: 'cube-bullseye',
    });
    for (const shape of scene.shapes) {
      assert.ok(shape.color !== null && typeof shape.color === 'object',
        `배경 ${background === null ? 'transparent' : 'opaque'} 에서 color=${shape.color}`);
    }
  }
});

test('검출기는 하이브리드를 9\~40px/cell 전 구간에서 잡는다', () => {
  for (const pixelsPerUnit of [40, 24, 16, 12, 9]) {
    const luma = toLuma(render('cube-bullseye', pixelsPerUnit));
    const found = bestCandidate(detectBullseyes(luma, {
      innerBandsReplaced: HYBRID_INNER_CUBE_BANDS,
    }));
    assert.ok(found, `${pixelsPerUnit}px/cell 에서 검출 실패`);
    assert.equal(found.hardChecksPassed, true, `${pixelsPerUnit}px/cell hard check`);
    const cellSizeError = Math.abs(found.cellSize - pixelsPerUnit) / pixelsPerUnit;
    assert.ok(cellSizeError < 0.05, `${pixelsPerUnit}px/cell cellSize 오차 ${cellSizeError}`);
  }
});

test('레이아웃을 모르고도 고른다 — 두 레이아웃을 같은 제안 위에서 채점한다', () => {
  const layouts = { ringLayouts: [0, HYBRID_INNER_CUBE_BANDS] };
  const hybrid = bestCandidate(detectBullseyes(toLuma(render('cube-bullseye', 24)), layouts));
  assert.ok(hybrid);
  assert.equal(hybrid.innerBandsReplaced, HYBRID_INNER_CUBE_BANDS);
  // 방향은 `cube` 아래에만 둔다 — 최상위에 얹으면 하류 가설 정렬 비교자가 집는다.
  assert.equal(hybrid.cube.orientationSource, 'hybrid-cube-face-rank');
  assert.equal(hybrid.rotationDegrees, undefined);
  assert.equal(hybrid.orientation, undefined);

  const plain = bestCandidate(detectBullseyes(toLuma(render('bullseye', 24)), layouts));
  assert.ok(plain);
  // 순수 불스아이는 하이브리드로 «승격» 되면 안 된다. 뭉개진 안쪽 밴드를 무시하는 쪽이
  // 점수가 높아지는 함정이 실재해서(jpeg q60 + blur 스윕이 잡았다) 큐브 증거를 요구한다.
  assert.equal(plain.innerBandsReplaced, 0);
});

test('제안 단계가 레이아웃을 모르면 소용없다 — 순수 불스아이 투표는 한 표도 안 바뀐다', () => {
  // 기본 경로 회귀 방어: ringLayouts 를 줘도 레이아웃 0 이 목록에 있으면 투표 경계는
  // 그대로 [1..5] 여야 한다. (여기가 갈리면 배포된 검출률이 조용히 움직인다.)
  const luma = toLuma(render('bullseye', 24));
  const baseline = bestCandidate(detectBullseyes(luma, {}));
  const withLayouts = bestCandidate(detectBullseyes(luma, {
    ringLayouts: [0, HYBRID_INNER_CUBE_BANDS],
  }));
  assert.ok(baseline && withLayouts);
  assert.equal(withLayouts.center.x, baseline.center.x);
  assert.equal(withLayouts.center.y, baseline.center.y);
  assert.equal(withLayouts.cellSize, baseline.cellSize);
});

test('큐브에서 절대 회전각을 읽는다 — 불스아이가 원리적으로 못 주는 값', () => {
  /*
   * 정제가 최적화하는 것은 SPD 행렬이라 **회전 성분이 없다**. 그래서 순수 불스아이
   * 후보의 H 로는 각도를 알 수 없고, 하이브리드에서만 나온다.
   *
   * ⚠ 위상은 «세 조각 중앙값의 분리 폭 최대화» 로 찾으면 안 된다 — 조각(120°)과 면(120°)
   *   이 같은 폭이라 목적함수가 평탄해지고 argmax 가 그 구간 아무 데나 찍힌다(실측 오차
   *   중앙값 30°). 차분의 3차 조화파로 **경계**를 직접 잡아야 한다.
   */
  const base = render('cube-bullseye', 24);
  let baseline = null;
  const errors = [];
  for (let degrees = 0; degrees < 360; degrees += 15) {
    const luma = toLuma(rotateImage(base, degrees));
    const found = bestCandidate(detectBullseyes(luma, {
      innerBandsReplaced: HYBRID_INNER_CUBE_BANDS,
    }));
    assert.ok(found, `${degrees}° 검출 실패`);
    const read = readCubeOrientation(luma, found);
    assert.ok(read, `${degrees}° 방향 읽기 실패`);
    if (baseline === null) baseline = read.rotationDegrees;
    let delta = (read.rotationDegrees - baseline - degrees) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    // rotateImage 의 부호 규약에 의존하지 않도록 ± 양쪽을 본다.
    let mirrored = (read.rotationDegrees - baseline + degrees) % 360;
    if (mirrored > 180) mirrored -= 360;
    if (mirrored < -180) mirrored += 360;
    errors.push(Math.min(Math.abs(delta), Math.abs(mirrored)));
  }
  const worst = Math.max(...errors);
  assert.ok(worst < 5, `회전각 최대 오차 ${worst.toFixed(1)}° — 5° 미만이어야 한다`);
});

test('순수 불스아이에서는 큐브 증거가 나오지 않는다 (오검출 게이트)', () => {
  const luma = toLuma(render('bullseye', 24));
  const found = bestCandidate(detectBullseyes(luma, {}));
  assert.ok(found);
  const read = readCubeOrientation(luma, {
    transform: found.transform,
    innerBandsReplaced: HYBRID_INNER_CUBE_BANDS,
  });
  /*
   * 거절은 두 갈래로 온다. 완벽히 균일한 밴드 위에서는 차분이 전부 0 이라 위상 자체가
   * 정의되지 않고 null 이 나온다(합성 렌더가 이 경우). 실사진처럼 잡음이 있으면 값은
   * 나오되 문턱에 걸린다.
   *
   * 실측 분포(2026-08-12): 진짜 하이브리드는 순위 여유 ≥0.376 · 면 평탄도 ≥0.989,
   * 순수 불스아이 오독은 각각 ≤0.284 · ≤0.703. 순위 여유만으로는 여유가 얇아
   * **면 평탄도**가 결정적이다 — 오독은 표본 고리가 밴드 경계를 스쳐서 생기므로
   * 조각 안이 기울어 있다.
   */
  if (read !== null) {
    assert.ok(read.faceFlatness < 0.80,
      `순수 불스아이인데 면 평탄도 ${read.faceFlatness.toFixed(3)}`);
  }
});

test('탐색 커버는 이미지에서 유도된다 — «크게 찍으면 안 읽힌다» 방지', () => {
  /*
   * 피라미드 레벨 하나가 한 옥타브(~24px)만 맡으므로, 레벨 수를 상수로 고정하면 탐색이
   * 24·2^(n-1) px 에서 끊기고 그보다 큰 파인더는 **제안조차 안 만들어진다**. 실사진
   * (2026-08-13) 파인더 반지름이 76~136px 였는데 파이프라인은 1~2레벨(24·48px)로 불러
   * 전멸했다. 지금까지 안 드러난 건 outline 이 반지름을 직접 넘겨 사다리를 우회해 준
   * 경우가 많았기 때문이다.
   */
  assert.equal(pyramidLevelsForImage({ width: 100, height: 50 }), 1);
  for (const size of [240, 480, 960, 1920]) {
    const levels = pyramidLevelsForImage({ width: size, height: size });
    const reach = 24 * 2 ** (levels - 1);
    const largestPlausible = size * 0.42;
    assert.ok(reach >= largestPlausible,
      `${size}px 이미지: 커버 ${reach}px < 최대 파인더 ${largestPlausible.toFixed(0)}px`);
  }
});

test('프레임을 꽉 채운 하이브리드도 복호된다 (커버 천장 회귀)', () => {
  // margin 0 · 240px 급 렌더 → 축소본에서 파인더 반지름이 옛 커버(24·48px)를 넘는다.
  const scene = buildScene(ENCODED, {
    palette: PALETTE, cellSize: 1, finderPatternId: 'cube-bullseye', margin: 0,
  });
  const raster = rasterize(scene, { pixelsPerUnit: 20, supersample: 2 });
  const image = { width: raster.width, height: raster.height, pixels: raster.pixels };

  // 1 은 파이프라인 outline 경로가 쓰던 상수 그대로다 — 이 케이스가 실제로 실패해야
  // 이 테스트가 진짜 결함을 막는다(실측: cap1 ✖ · cap2 이상 ✔ · 유도값 4).
  const capped = decodeFrontend(image, { bootstrap: { finder: { maxPyramidLevels: 1 } } });
  assert.equal(capped.ok, false, '레벨 1로 묶으면 실패해야 이 테스트가 진짜 결함을 막는다');
  assert.ok(pyramidLevelsForImage(raster) >= 3, '이 렌더는 3레벨 이상을 요구해야 한다');

  const result = decodeFrontend(image);
  assert.equal(result.ok, true, `기본 경로: ${result.reason}`);
  assert.equal(result.text, TEXT);
});

test('하이브리드 코드가 끝에서 끝까지 복호된다 (파이프라인 기본 옵션)', () => {
  for (const pixelsPerUnit of [24, 12, 9]) {
    const raster = render('cube-bullseye', pixelsPerUnit);
    const result = decodeFrontend({
      width: raster.width, height: raster.height, pixels: raster.pixels,
    });
    assert.equal(result.ok, true, `${pixelsPerUnit}px/cell: ${result.reason}`);
    assert.equal(result.text, TEXT);
  }
});
