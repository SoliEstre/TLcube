/**
 * central-n7-plateau.test.js — 중앙 TL(n7) 포즈의 «일치율 평탄부 중점» (2026-09-25 n7-scale).
 *
 * 결함: 생성기 기본값(중앙 TL + 모서리 QR)으로 내보낸 O(V2 k=8)·A(A0 k=6) PNG 가 스캐너
 * 사진 경로에서 «No code found». 1024 원본 그대로는 읽혔는데, 그건 코드가 **정확히 프레임
 * 중앙**이라 중심 seed 셋 중 «프레임 중심» 이 우연히 맞았기 때문이다. 크롭·평행이동으로
 * 중앙을 벗어나면 남는 seed 는 v0 core hit 뿐이고, 그 피치는 1/8 px 양자화라 참값과 몇 %
 * 다르다. locator 90면 이진 일치율은 피치 ±6 % 가 전부 만점(평탄부)이라 정련이 그
 * 가장자리에서 멈추고(동률은 «작은 셀 우선»), 바깥 H 는 그 피치를 반경 k 까지 외삽해
 * 본문 RS 가 전멸했다 (O: 참 ≈14.8 px 셀을 14.0 으로). 처방은 평탄부 중점 finder 를
 * **추가**하는 것 — 종전 finder 는 그대로 뒤에 남는다.
 *
 *   ⓐ 생성기 기본 O·A 를 슬레이트에 평탄화·크롭(hub-media 정지 이미지 조건) — 대표 1쌍 (종전 0/2)
 *   ⓑ full: O·A × ppu {12, 14.9, 17.3} × 안전영역 {2, 10} 셀 12점 전부 (종전 0/12)
 *   ⓒ 평탄부는 실제로 넓고(±4 % 이상), 중점은 참 피치 ±2 % 안이다 — 양쪽 가장자리에서 출발
 *   ⓓ 기본(옵션 없음)은 종전 finder 목록 그대로, 켜면 그 목록이 뒤에 **그대로** 붙는다
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { addQuietZone } from '../src/quietzone.js';
import { tlReaderUrlWithHint } from '../src/qr.js';
import { sceneOptionsForOA } from '../src/generator-render-config.js';
import { createGeneratorState, GENERATOR_DEFAULT_FINDER_PATTERN_ID } from '../src/generator-state.js';
import { DEFAULT_PRESET, getPreset } from '../src/luminance.js';
import { CENTRAL_N7_FINDER_PATTERN_ID, CENTRAL_N7_SIZE } from '../src/centralN7Schema.js';
import { centralBeaconGeometry } from '../src/centralBeaconWire.js';
import { CORNER_UNIT_OFFSETS, axialToPixel, hexCorners } from '../src/hexgrid.js';
import { FINDER_CELL_ORDER } from '../src/finder-patterns.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  centralN7PlateauPose,
  detectCellSurfaceBlockShapes,
  detectCentralN7BlockShapes,
} from '../src/decoder/cellsurface-block-detect.js';
import { centralN7CenterPriorSeeds, centralN7FindersFromShapes } from '../src/decoder/central-n7-observe.js';
import { BEACON_CS_BLOCK_LOCATOR } from '../src/decoder/central-beacon-observation-shared.js';
import { flattenAndCrop } from '../tools/hub-media.mjs';
import { fullOnly } from './helpers/scope.mjs';

const PAYLOAD = 'https://tl.estre.so';
const PRESET = getPreset(DEFAULT_PRESET);
const STATE = createGeneratorState();

/** index.html paletteOf 와 같은 모양 — bgMode 기본(투명) + 불스아이 흑백. */
const PALETTE = Object.freeze({
  background: null,
  levels: PRESET.levels,
  bullseyeDark: Object.freeze({ r: 0, g: 0, b: 0 }),
  bullseyeLight: Object.freeze({ r: 255, g: 255, b: 255 }),
});

/** 생성기 기본 상태의 O/A 장면 — 중앙 TL + 모서리 QR(TL) + 흰 안전영역. */
function generatorDefaultScene(type, quietMargin) {
  assert.equal(GENERATOR_DEFAULT_FINDER_PATTERN_ID, CENTRAL_N7_FINDER_PATTERN_ID,
    '생성기 기본 파인더가 중앙 TL 이 아니다 — 이 자의 전제가 바뀌었다');
  const encoded = type === 'O'
    ? encode(PAYLOAD, { eccLevel: 'H', centralN7: true })
    : encodeA(PAYLOAD, { eccLevel: 'H', centralN7: true });
  const scene = buildScene(encoded, sceneOptionsForOA({
    centralN7Emphasis: STATE.centralN7Emphasis,
    fallback: { mode: 'corner', corner: 'TL' },
    finderPatternId: GENERATOR_DEFAULT_FINDER_PATTERN_ID,
    palette: PALETTE,
    qrText: tlReaderUrlWithHint(type),
    type,
  }));
  return addQuietZone(scene, { color: { r: 255, g: 255, b: 255 }, margin: quietMargin });
}

/** hub-media 정지 이미지와 같은 조건: 투명 PNG → 기본 프리셋 배경에 평탄화 → 내용 경계 + 48 px. */
function hubStill(type, pixelsPerUnit, quietMargin) {
  const raw = rasterize(generatorDefaultScene(type, quietMargin), { pixelsPerUnit, supersample: 2 });
  return flattenAndCrop(raw, PRESET.background, 48).raster;
}

function assertReadsViaCentralN7(type, pixelsPerUnit, quietMargin) {
  const result = decodeFrontend(hubStill(type, pixelsPerUnit, quietMargin));
  const label = `${type} ppu=${pixelsPerUnit} 안전영역=${quietMargin}`;
  assert.equal(result.ok, true, `${label}: ${result.reason}`);
  assert.equal(result.text, PAYLOAD, label);
  // 이 자가 재는 축은 «중앙 n7 포즈» 다 — 다른 finder 로 읽혀 초록이 되면 엉뚱한 축이다.
  assert.equal(result.hypothesis.finderPatternId, CENTRAL_N7_FINDER_PATTERN_ID, label);
}

test('ⓐ 생성기 기본 O·A 가 hub-media 정지 이미지 조건(슬레이트·크롭)에서 중앙 TL 로 읽힌다', () => {
  for (const type of ['O', 'A']) assertReadsViaCentralN7(type, 14.9, 2);
});

fullOnly(() => {
  test('ⓑ [full] O·A × ppu 3 × 안전영역 2 — 12점 전부 읽힌다 (종전 0/12)', { timeout: 600_000 }, () => {
    for (const type of ['O', 'A']) {
      for (const pixelsPerUnit of [12, 14.9, 17.3]) {
        for (const quietMargin of [2, 10]) assertReadsViaCentralN7(type, pixelsPerUnit, quietMargin);
      }
    }
  });
});

/** 렌더 정방향의 n7 중심·모듈 피치 (central-n7-detect.test.js n7Geometry 와 같은 식). */
function n7Truth(scene, pixelsPerUnit) {
  const center = axialToPixel(0, 0, scene.layout);
  const points = FINDER_CELL_ORDER.flatMap((cell) => hexCorners(cell.q, cell.r, scene.layout));
  const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map((point) =>
    (point.x - center.x) * axis.x + (point.y - center.y) * axis.y)));
  return {
    center: { x: center.x * pixelsPerUnit, y: center.y * pixelsPerUnit },
    modulePitch: Math.min(...supports) * centralBeaconGeometry().shrink / CENTRAL_N7_SIZE * pixelsPerUnit,
  };
}

function cleanO(pixelsPerUnit) {
  const scene = buildScene(encode(PAYLOAD, { eccLevel: 'H', centralN7: true }), {
    palette: { ...PALETTE, background: { r: 255, g: 255, b: 255 } },
    margin: 20,
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    centralN7Family: 'hex',
  });
  const raster = rasterize(scene, { pixelsPerUnit, supersample: 2 });
  return { luma: toRelativeLuminance(raster), truth: n7Truth(scene, pixelsPerUnit) };
}

test('ⓒ 일치율 평탄부는 넓고(±4 % 이상), 중점은 참 피치 ±2 % 안 — 양쪽 가장자리에서 출발', () => {
  const { luma, truth } = cleanO(14.9);
  for (const start of [0.95, 1.05]) {
    const pose = centralN7PlateauPose(luma, truth.center, truth.modulePitch * start, 0);
    const scale = pose.plateau.scale;
    assert.ok(scale, `출발 ×${start}: 평탄부에 서지 못했다`);
    // 결함의 근거 자체를 잠근다 — 평탄부가 좁아지면(점수가 배율을 가르게 되면) 이 처방의
    // 전제가 바뀐 것이니 다시 재야 한다.
    assert.ok(scale.hi - scale.lo >= 0.04, `출발 ×${start}: 평탄부 폭 ${(scale.hi - scale.lo).toFixed(4)}`);
    const error = pose.modulePitch / truth.modulePitch - 1;
    assert.ok(Math.abs(error) <= 0.02, `출발 ×${start}: 중점 오차 ${(error * 100).toFixed(2)} %`);
  }
});

test('ⓓ 기본은 종전 finder 목록 그대로, plateauCentred 는 그 목록을 뒤에 그대로 붙인다 (추가만)', () => {
  const luma = toRelativeLuminance(hubStill('O', 14.9, 2));
  const detected = detectCellSurfaceBlockShapes(luma, { calibration: { csBlockLocator: { ...BEACON_CS_BLOCK_LOCATOR } } });
  const shapes = detectCentralN7BlockShapes(
    luma, centralN7CenterPriorSeeds(luma, detected.diagnostics?.verified || []),
  ).shapes;
  const located = centralN7FindersFromShapes(luma, shapes);
  const centred = centralN7FindersFromShapes(luma, shapes, { plateauCentred: true });
  assert.ok(located.length > 0, '이 프레임에서 n7 finder 가 하나도 안 섰다 — 자의 전제가 무너졌다');
  assert.ok(centred.length > located.length, '평탄부 finder 가 추가되지 않았다');
  assert.deepStrictEqual(centred.slice(centred.length - located.length), located,
    '켰을 때 종전 finder 목록이 바뀌었다 — «추가만» 이 깨졌다');
});
