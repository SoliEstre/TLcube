/**
 * decoder-corner-marker-k.test.js — Type K(육각별) 코너 마커 검출 (합성)
 *
 * `decoder-corner-marker.test.js`(O) · `…-tones.test.js`(A) 의 하네스 규약을 따른다:
 * 인코더 → scene → 결정적 rasterizer → 상대휘도 필드의 실제 경로.
 *
 * 고정하는 것 — 전부 **성질**이고 철자가 아니다:
 *   ① 중간 톤(1)은 이 분류기로 못 맞는다 — 세 프리셋의 levels[1] 이 classifyTone 의
 *      mid 밴드 밖이라는 **산술 사실**. 이 자가 빨개지면 팔레트나 밴드가 바뀐 것이고,
 *      그러면 K 변형(극단 톤만)의 근거 자체를 다시 판단해야 한다.
 *   ② 그래서 정본 30셀 H2CO3 는 **완전한 합성 렌더에서도** 코너 alive 게이트를
 *      못 넘는다 (코너 1·2 상한 15/21 = 0.7143 < 0.75). 게이트를 낮춰 통과시키지
 *      않았다는 증거를 소스가 아니라 **측정**으로 남긴다.
 *   ③ 극단 톤 변형은 K0CM/K1CM/K2CM 에서 수락되고, **정답 k 만** 수락한다.
 *   ④ 교차 오수용 0 — 평 K(마커 없음) · Type A · Type O.
 *   ⑤ 묶음이 6개라 재적합이 N점 DLT 로 간다. 코너 3개(=4점) 경로는 종전 정확해와
 *      **비트 동일**이어야 한다 (O·A 무회귀의 근거).
 *
 * ⚠ 이 파일은 게이트 상수를 **한 개도** 덮지 않는다. options 로 임계값을 주면
 *    ①\~④ 가 의미를 잃는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeK } from '../src/encodeK.js';
import { encodeA } from '../src/encodeA.js';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, PRESETS, getPreset, relativeLuminance,
} from '../src/luminance.js';
import {
  findKCornerMarkerHypotheses,
  refineHomographyFromCorners,
  verifyCornerMarkers,
  DEFAULT_CORNER_AGREEMENT,
} from '../src/decoder/corner-marker-detect.js';
import { estimateHomography4 } from '../src/decoder/homography.js';
import { UNVERIFIED_ORIENTATION_SCORER } from '../src/decoder/orientation-scorer.js';
import { h2co3TonesByKeyK, markerCellsK, markerGroupsK } from '../src/markerK.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const PPU = 12;
const KS = Object.freeze([6, 8, 10]);
const FACES = Object.freeze(['T', 'L', 'R']);

function rasterToLuma(raster) {
  const data = new Float32Array(raster.width * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const o = (y * raster.width + x) * 4;
      data[y * raster.width + x] = relativeLuminance({
        r: raster.pixels[o], g: raster.pixels[o + 1], b: raster.pixels[o + 2],
      });
    }
  }
  return { width: raster.width, height: raster.height, data, alpha: null };
}

function render(encoded) {
  const scene = buildScene(encoded, { palette: PALETTE, margin: 20 });
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 1 });
  return {
    luma: rasterToLuma(raster),
    bullseye: {
      center: { x: scene.layout.originX * PPU, y: scene.layout.originY * PPU },
      cellSize: scene.layout.size * PPU,
      score: 1,
      hardChecksPassed: true,
    },
  };
}

test('① 중간 톤은 이 분류기가 원리적으로 못 맞는다 — 세 프리셋이 전부 mid 밴드 밖', () => {
  const midFraction = UNVERIFIED_ORIENTATION_SCORER.classifyMidFraction;
  const low = 0.5 - midFraction / 2;
  const high = 0.5 + midFraction / 2;
  const positions = [];
  for (const name of Object.keys(PRESETS)) {
    const y = PRESETS[name].levels.map((c) => relativeLuminance(c));
    const position = (y[1] - y[0]) / (y[2] - y[0]);
    positions.push({ name, position });
    assert.ok(position < low || position > high,
      `${name} 프리셋의 levels[1] 이 mid 밴드 [${low}, ${high}] 안에 있다 (${position.toFixed(4)}) — `
      + '기대 톤 1 슬롯을 맞힐 수 있게 됐다는 뜻이다. K 변형이 «극단 톤만» 인 근거가 사라졌으니 '
      + 'corner-marker-detect 의 isExtremeToneCellK 주석과 변형 선택을 다시 판단하라');
  }
  // 「밖이다」만으로는 방향을 안 잠근다 — 전부 **아래쪽**이라는 것이 실측의 형태다.
  for (const p of positions) {
    assert.ok(p.position < low, `${p.name}: mid 가 밴드 위쪽에 있다 (${p.position.toFixed(4)})`);
  }
});

test('② 정본 30셀 H2CO3 는 완전한 합성 렌더에서도 코너 alive 게이트를 못 넘는다', () => {
  const k = 10;
  const tones = h2co3TonesByKeyK(k);
  const groups = markerGroupsK(k, tones);
  // 기대 톤 1 슬롯이 실재하고, 그것이 어느 묶음에 몰려 있는지를 **회계로** 확인한다.
  let midSlotsTotal = 0;
  let blockedGroups = 0;
  for (const group of groups) {
    const slots = group.cells.length * 3;
    let mid = 0;
    for (const cell of group.cells) {
      for (const face of FACES) if (cell.tones[face] === 1) mid += 1;
    }
    midSlotsTotal += mid;
    // 중간 톤 슬롯이 전부 틀린다고 볼 때의 상한
    if ((slots - mid) / slots < DEFAULT_CORNER_AGREEMENT) blockedGroups += 1;
  }
  assert.ok(midSlotsTotal > 0, '기대 톤 1 슬롯이 하나도 없다 — ①과 모순이다');
  assert.ok(blockedGroups > 0,
    '정본 30셀에서 alive 상한이 게이트 아래인 묶음이 하나도 없다 — 이 레인의 근거가 바뀌었다. '
    + '30셀 변형을 다시 후보로 올릴 수 있는지 실측하라');

  // 상한 «논거» 로 끝내지 않는다 — 완전한 합성 렌더에 정본 30셀 기대를 직접 대어
  // 수락되지 않음을 **측정**한다 (정답 포즈 · 방향 0 · 국소 탐색 켠 채로).
  const { luma, bullseye } = render(
    encodeK('k-cm-canonical', { cornerMarker: true, version: 2, eccLevel: 'M' }),
  );
  const H = Float64Array.from([
    bullseye.cellSize, 0, bullseye.center.x,
    0, bullseye.cellSize, bullseye.center.y,
    0, 0, 1,
  ]);
  const verification = verifyCornerMarkers(luma, { H, k, cellSize: bullseye.cellSize }, {
    center: bullseye.center,
    groups,
  });
  assert.equal(verification.accepted, false,
    '정본 30셀이 합성에서 수락됐다 — 중간 톤이 읽히기 시작했다는 뜻이니 ①과 변형 선택을 다시 판단하라');
  assert.ok(verification.aliveCorners < groups.length,
    `alive 코너가 ${verification.aliveCorners}/${groups.length} 다 — 기각 사유가 alive 가 아니게 됐다`);
  // 기각 사유가 «agreement 하한» 이 아니라 «alive» 라는 것이 이 레인 결론의 핵심이다.
  assert.ok(verification.agreement >= 0.78,
    `전체 agreement 가 ${verification.agreement.toFixed(4)} 로 하한 아래다 — `
    + '「agreement 는 넘는데 alive 가 막는다」는 서술이 더는 맞지 않는다');
});

test('③ 극단 톤 변형 — K0CM/K1CM/K2CM 이 수락되고 정답 k 만 수락된다', () => {
  for (const [version, k] of [[0, 6], [1, 8], [2, 10]]) {
    const { luma, bullseye } = render(
      encodeK('k-cm-accept', { cornerMarker: true, version, eccLevel: 'M' }),
    );
    const result = findKCornerMarkerHypotheses(luma, bullseye, KS, {});
    assert.equal(result.ok, true,
      `K${version}CM 이 수락되지 않았다: ${JSON.stringify(result.detail && result.detail.rejected && result.detail.rejected.slice(0, 3))}`);
    const ks = [...new Set(result.hypotheses.map((h) => h.k))];
    assert.deepEqual(ks, [k], `K${version}CM 이 오-k 를 수락했다: ${JSON.stringify(ks)}`);
    // 정답 방향(0)이 반드시 후보에 있다 — 없으면 하류가 정답 포즈를 못 본다.
    assert.ok(result.hypotheses.some((h) => h.orientation === 0),
      `K${version}CM: 방향 0 가설이 없다`);
    // 묶음이 6개라는 것이 재적합 N점 경로의 전제다.
    for (const h of result.hypotheses) {
      assert.equal(h.corners.length, 6, `K${version}CM: 묶음이 6개가 아니다 (${h.corners.length})`);
      assert.ok(h.refinedH !== null, `K${version}CM: 재적합 H 가 null 이다 — N점 DLT 가 안 섰다`);
    }
  }
});

test('④ 교차 오수용 0 — 평 K(마커 없음) · Type A · Type O', () => {
  const frames = [
    ['K0(평)', encodeK('plain-k', { version: 0, eccLevel: 'M' })],
    ['K1(평)', encodeK('plain-k', { version: 1, eccLevel: 'M' })],
    ['K2(평)', encodeK('plain-k', { version: 2, eccLevel: 'M' })],
    ['A1', encodeA('type-a', { version: 1, eccLevel: 'M' })],
    ['O(V2)', encode('type-o', { version: 2, eccLevel: 'M' })],
  ];
  for (const [name, encoded] of frames) {
    const { luma, bullseye } = render(encoded);
    const result = findKCornerMarkerHypotheses(luma, bullseye, KS, {});
    const accepted = result.ok ? result.hypotheses.length : 0;
    assert.equal(accepted, 0,
      `${name} 프레임에서 K 코너 마커가 ${accepted}건 수락됐다 — 오수용이다`);
  }
});

test('⑤ 재적합 N 일반화 — 코너 3개(4점) 경로는 종전 정확해와 비트 동일', () => {
  // 4점(중심 + 코너 3)일 때 refineHomographyFromCorners 가 estimateHomography4 와
  // 같은 값을 내야 O·A 가 한 비트도 안 바뀐다.
  const center = { x: 100, y: 120 };
  const verification = {
    corners: [
      { canonical: { x: 10, y: 0 }, imagePoint: { x: 210, y: 118 } },
      { canonical: { x: -5, y: 8.66 }, imagePoint: { x: 47, y: 205 } },
      { canonical: { x: -5, y: -8.66 }, imagePoint: { x: 52, y: 31 } },
    ],
  };
  const got = refineHomographyFromCorners(center, verification);
  const want = estimateHomography4(
    [{ x: 0, y: 0 }, ...verification.corners.map((c) => c.canonical)],
    [center, ...verification.corners.map((c) => c.imagePoint)],
  );
  assert.ok(got !== null, '4점 재적합이 null 이다');
  assert.deepEqual(Array.from(got), Array.from(want),
    '4점 경로가 estimateHomography4 와 다르다 — O·A 무회귀 전제가 깨졌다');

  // 코너가 2개(=3점)면 여전히 null (과소 결정).
  assert.equal(
    refineHomographyFromCorners(center, { corners: verification.corners.slice(0, 2) }), null,
    '3점인데 재적합이 섰다 — 과소 결정 계를 풀었다는 뜻이다',
  );
});
