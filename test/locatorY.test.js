/**
 * locatorY.test.js — Type Y 실험 로케이터 기하·프로파일·렌더 계약.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LOCATOR_PROFILE_Y,
  HEX_FRAME_V1,
  LOCATOR_PROFILE_HEX_FRAME_V1,
  LOCATOR_PROFILE_OFF,
  LOCATOR_PROFILES_Y,
  assertLocatorProfileY,
  locatorHubClearsSampleDiscs,
  locatorOuterPaddingCells,
  locatorShapesY,
} from '../src/locatorY.js';
import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { moduleSampleDisc, layoutForCube, YFACES } from '../src/ygrid.js';
import { FACE_INRADIUS_COEFF } from '../src/hexgrid.js';
import { qrMatrix } from '../src/qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});

function pointInDisc(px, py, disc) {
  const dx = px - disc.x;
  const dy = py - disc.y;
  return dx * dx + dy * dy <= disc.radius * disc.radius;
}

function shapeHitsDisc(shape, disc) {
  if (shape.kind === 'disc') {
    const dx = shape.cx - disc.x;
    const dy = shape.cy - disc.y;
    const reach = Math.sqrt(dx * dx + dy * dy) - shape.r;
    return reach <= disc.radius;
  }
  if (shape.kind !== 'polygon') return false;
  for (const p of shape.points) {
    if (pointInDisc(p.x, p.y, disc)) return true;
  }
  return false;
}

test('프로파일 식별자는 off · hex-frame-v1 · cell-surface-v1/v1r2/v2/v0/v2r2/v0x 이고 기본은 off', () => {
  // v0 · v2r2 · v1r2 · v0x = 최종 라인업 (cellSurfaceFinal.js). v1/v2 는
  // 배포 출력물 법의학용으로 식별자만 유지한다.
  // 의도적 갱신 (2026-08-16): v0X 편입으로 'cell-surface-v0x' 가 목록 끝에 붙었다.
  assert.deepEqual([...LOCATOR_PROFILES_Y], [
    'off', 'hex-frame-v1', 'cell-surface-v1', 'cell-surface-v1r2', 'cell-surface-v2',
    'cell-surface-v0', 'cell-surface-v2r2', 'cell-surface-v0x',
  ]);
  assert.equal(DEFAULT_LOCATOR_PROFILE_Y, LOCATOR_PROFILE_OFF);
  assert.equal(assertLocatorProfileY('hex-frame-v1'), LOCATOR_PROFILE_HEX_FRAME_V1);
  assert.throws(() => assertLocatorProfileY('unknown'), RangeError);
  assert.equal(locatorOuterPaddingCells('off'), 0);
  assert.equal(locatorOuterPaddingCells('cell-surface-v1'), 0);
  assert.equal(locatorOuterPaddingCells('cell-surface-v0'), 0);
  assert.equal(locatorOuterPaddingCells('cell-surface-v2r2'), 0);
  assert.equal(locatorOuterPaddingCells('cell-surface-v0x'), 0);
  assert.ok(locatorOuterPaddingCells('hex-frame-v1') > 1.8);
  assert.equal(locatorHubClearsSampleDiscs('hex-frame-v1'), true);
});

test('hex-frame-v1 획은 Y0 최소 렌더(ppu=8)에서 2px 이상', () => {
  const px = HEX_FRAME_V1.stroke * 8;
  assert.ok(px >= 2, `획 ${px}px 는 인쇄에 너무 가늘다`);
});

test('중앙 파인더는 오른쪽 변이 열린 C형 육각 고리다', () => {
  const layout = layoutForCube(13, { size: 10, margin: 4 });
  const shapes = locatorShapesY(13, layout, PALETTE, 'hex-frame-v1');
  const hubEdges = shapes.filter((shape) => shape.locatorPart === 'hub-c-ring');
  assert.equal(hubEdges.length, 5);
  assert.deepEqual(
    hubEdges.map((shape) => shape.locatorEdge).sort((a, b) => a - b),
    [0, 2, 3, 4, 5],
  );
  assert.equal(hubEdges.some((shape) => shape.locatorEdge === HEX_FRAME_V1.hubGapSide), false);
});

test('기본 프로파일은 기존 scene 도형 수를 바꾸지 않는다', () => {
  const encoded = encodeY('https://tl.estre.so', { version: 0, tones: 3, eccLevel: 'M' });
  const legacy = buildSceneY(encoded, { palette: PALETTE });
  const explicit = buildSceneY(encoded, { palette: PALETTE, locatorProfile: 'off' });
  assert.equal(legacy.shapes.length, explicit.shapes.length);
  assert.equal(legacy.locatorProfile, 'off');
});

test('hex-frame-v1 은 도형을 더하고 샘플 원판과 겹치지 않는다', () => {
  const encoded = encodeY('https://tl.estre.so', { version: 0, tones: 3, eccLevel: 'M' });
  const off = buildSceneY(encoded, { palette: PALETTE, locatorProfile: 'off' });
  const on = buildSceneY(encoded, { palette: PALETTE, locatorProfile: 'hex-frame-v1' });
  assert.equal(on.locatorProfile, 'hex-frame-v1');
  assert.ok(on.shapes.length > off.shapes.length);

  const layout = on.layout;
  const discs = [];
  for (let j = 0; j < encoded.n; j += 1) {
    for (let i = 0; i < encoded.n; i += 1) {
      for (const face of YFACES) {
        discs.push(moduleSampleDisc(face, i, j, layout));
      }
    }
  }
  const added = on.shapes.slice(off.shapes.length);
  // QR 이 없으면 추가분은 전부 로케이터.
  for (const shape of added) {
    if (shape.color === PALETTE.bullseyeLight) continue; // 흰 가드는 원판 밖 여백
    for (const disc of discs) {
      assert.equal(shapeHitsDisc(shape, disc), false,
        `로케이터 도형이 샘플 원판과 겹친다 r=${disc.radius}`);
    }
  }
  const inradius = FACE_INRADIUS_COEFF * layout.size * 0.5;
  assert.ok(inradius > 0);
});

test('로케이터는 코너 QR 블록과 겹치지 않는다', () => {
  const encoded = encodeY('https://tl.estre.so', { version: 0, tones: 3, eccLevel: 'M' });
  const qrText = 'HTTPS://TL.EXAMPLE/A';
  assert.doesNotThrow(() => buildSceneY(encoded, {
    palette: PALETTE,
    locatorProfile: 'hex-frame-v1',
    qrText,
    qrCorner: 'TL',
  }));
  const scene = buildSceneY(encoded, {
    palette: PALETTE,
    locatorProfile: 'hex-frame-v1',
    qrText,
    qrCorner: 'TL',
  });
  const qr = qrMatrix(qrText);
  let dark = 0;
  for (const m of qr.modules) if (m === 1) dark += 1;
  assert.ok(scene.shapes.length > 3 * encoded.n * encoded.n + 4 + dark);
});

test('작은 margin 은 로케이터 두께만큼 자동으로 늘어난다', () => {
  const encoded = encodeY('x', { version: 0, tones: 3, eccLevel: 'M' });
  const tight = buildSceneY(encoded, {
    palette: PALETTE,
    locatorProfile: 'hex-frame-v1',
    margin: 0.5,
  });
  const off = buildSceneY(encoded, {
    palette: PALETTE,
    locatorProfile: 'off',
    margin: 0.5,
  });
  const pad = locatorOuterPaddingCells('hex-frame-v1');
  const extra = tight.layout.width - off.layout.width;
  assert.ok(extra > 0, `로케이터 margin 이 안 늘었다 on=${tight.layout.width} off=${off.layout.width}`);
  assert.ok(Math.abs(extra - 2 * (pad - 0.5)) < 1e-9,
    `width Δ=${extra} expected=${2 * (pad - 0.5)}`);
});

test('locatorShapesY(off) 는 빈 배열', () => {
  const layout = layoutForCube(13, { size: 1, margin: 4 });
  assert.deepEqual(locatorShapesY(13, layout, PALETTE, 'off'), []);
  assert.ok(locatorShapesY(13, layout, PALETTE, 'hex-frame-v1').length >= 12);
});
