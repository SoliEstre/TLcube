import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CENTRAL_V0_SOURCE_N,
} from '../src/cellSurfaceFinal.js';
import { CS_BLOCK_LOCATOR_INTERNALS } from '../src/decoder/cellsurface-block-detect.js';
import { encodeY } from '../src/encodeY.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  getPreset,
  DEFAULT_PRESET,
} from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { faceBasis, layoutForCube } from '../src/ygrid.js';
import {
  buildOrbitMesh,
  cubeCenter,
  cubePoint,
  orbitPoint,
  perspectiveInvDist,
  projectPoint as projectPoint3d,
} from '../src/y3d-viewer.js';
import {
  RECTIFY_ANCHOR_IDS,
  detectRectifyAnchors,
} from '../src/decoder/rectify-anchors.js';

const FRAME_SIDE = 960;
const PPU = 17;
const PAYLOAD = 'https://tl.estre.so';
const DEGREE = Math.PI / 180;
const FACES = Object.freeze(['T', 'L', 'R']);
let baselinePassed = false;
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});

function referenceAnchorPatches() {
  const reference = CS_BLOCK_LOCATOR_INTERNALS.patchesForN(CENTRAL_V0_SOURCE_N);
  const patches = [...reference.subPatches.slice(0, 3), ...reference.corners];
  assert.equal(patches.length, RECTIFY_ANCHOR_IDS.length);
  return patches;
}

function faceCoordinates(face, point) {
  const basis = faceBasis(face);
  const determinant = basis.ei.x * basis.ej.y - basis.ei.y * basis.ej.x;
  assert.notEqual(determinant, 0);
  return {
    a: (point.x * basis.ej.y - point.y * basis.ej.x) / determinant,
    b: (basis.ei.x * point.y - basis.ei.y * point.x) / determinant,
  };
}

function renderFrontFrame(tones) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0', tones, eccLevel: 'M',
  });
  assert.equal(encoded.n, CENTRAL_V0_SOURCE_N);
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
  const { frame, offsetX, offsetY } = embedSquare(raster);
  return { frame, scene, offsetX, offsetY };
}

function embedSquare(raster) {
  assert.ok(raster.width <= FRAME_SIDE && raster.height <= FRAME_SIDE);
  const frame = {
    width: FRAME_SIDE,
    height: FRAME_SIDE,
    pixels: new Uint8ClampedArray(FRAME_SIDE * FRAME_SIDE * 4),
  };
  for (let index = 0; index < FRAME_SIDE * FRAME_SIDE; index += 1) {
    frame.pixels[index * 4] = PRESET.background.r;
    frame.pixels[index * 4 + 1] = PRESET.background.g;
    frame.pixels[index * 4 + 2] = PRESET.background.b;
    frame.pixels[index * 4 + 3] = 255;
  }
  const offsetX = Math.floor((FRAME_SIDE - raster.width) / 2);
  const offsetY = Math.floor((FRAME_SIDE - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const source = (y * raster.width + x) * 4;
      const target = ((y + offsetY) * FRAME_SIDE + x + offsetX) * 4;
      frame.pixels[target] = raster.pixels[source];
      frame.pixels[target + 1] = raster.pixels[source + 1];
      frame.pixels[target + 2] = raster.pixels[source + 2];
      frame.pixels[target + 3] = raster.pixels[source + 3];
    }
  }
  return { frame, offsetX, offsetY };
}

function expectedFrontAnchors(scene, offsetX, offsetY) {
  return referenceAnchorPatches().map((patch, index) => ({
    id: RECTIFY_ANCHOR_IDS[index],
    x: offsetX + PPU * (scene.layout.originX + patch.anchor.x),
    y: offsetY + PPU * (scene.layout.originY + patch.anchor.y),
    cellPitch: Math.sqrt(Math.sqrt(3) / 2) * PPU,
  }));
}

function renderOtherLayoutFrame() {
  const encoded = encodeY(PAYLOAD, { version: 0, tones: 3, eccLevel: 'M' });
  assert.equal(encoded.n, CENTRAL_V0_SOURCE_N);
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return embedSquare(rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 })).frame;
}

function renderPoseFrame({ perspective, yawDegrees, pitchDegrees }) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'M',
  });
  assert.equal(encoded.n, CENTRAL_V0_SOURCE_N);
  const layout = layoutForCube(encoded.n, { size: 1, margin: 4 });
  const digitAt = (i, j) => encoded.cellDigits.get(`${i},${j}`)?.digit ?? null;
  const levelAt = (i, j, face) => {
    const cell = encoded.cellDigits.get(`${i},${j}`);
    return Number.isInteger(cell?.tones?.[face]) ? cell.tones[face] : null;
  };
  const yaw = yawDegrees * DEGREE;
  const pitch = pitchDegrees * DEGREE;
  const mesh = buildOrbitMesh({
    n: encoded.n,
    tones: encoded.tones,
    levels: PRESET.levels,
    layout,
    digitAt,
    levelAt,
    perspective,
    yaw,
    pitch,
    roll: 0,
    faces: 3,
  });
  const raster = rasterize({
    width: layout.width,
    height: layout.height,
    background: PRESET.background,
    shapes: mesh.quads.map((quad) => ({
      kind: 'polygon', points: quad.points2d, color: quad.color,
    })),
  }, { pixelsPerUnit: PPU, supersample: 2 });
  const embedded = embedSquare(raster);
  return {
    ...embedded,
    layout,
    perspective,
    yaw,
    pitch,
  };
}

function polygonArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - current.y * next.x;
  }
  return Math.abs(twiceArea) / 2;
}

function expectedPoseAnchors(rendered) {
  const center3d = cubeCenter(CENTRAL_V0_SOURCE_N);
  const invDist = perspectiveInvDist(
    rendered.perspective,
    (CENTRAL_V0_SOURCE_N / 2) * Math.sqrt(3),
  );
  const project = (face, a, b) => {
    const source = cubePoint(face, a, b);
    const rotated = orbitPoint(
      source, rendered.yaw, rendered.pitch, center3d, 0,
    );
    const point = projectPoint3d(
      rotated, rendered.layout, center3d, invDist,
    );
    return {
      x: rendered.offsetX + point.x * PPU,
      y: rendered.offsetY + point.y * PPU,
    };
  };
  return referenceAnchorPatches().map((patch, index) => {
    const face = FACES[index % FACES.length];
    const { a, b } = faceCoordinates(face, patch.anchor);
    const center = project(face, a, b);
    const quad = [
      project(face, a - 0.5, b - 0.5),
      project(face, a + 0.5, b - 0.5),
      project(face, a + 0.5, b + 0.5),
      project(face, a - 0.5, b + 0.5),
    ];
    return {
      id: RECTIFY_ANCHOR_IDS[index],
      x: center.x,
      y: center.y,
      cellPitch: Math.sqrt(polygonArea(quad)),
    };
  });
}

function measurementRow(id, pose, expected, result) {
  const centerResiduals = [];
  const pitchResiduals = [];
  for (let index = 0; index < expected.length; index += 1) {
    const actual = result.anchors[index];
    if (actual === null) continue;
    centerResiduals.push(Math.hypot(
      actual.x - expected[index].x,
      actual.y - expected[index].y,
    ));
    pitchResiduals.push(Math.abs(actual.cellPitch - expected[index].cellPitch));
  }
  const rms = (values) => values.length === 0 ? null
    : Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  const maximum = (values) => values.length === 0 ? null : Math.max(...values);
  const rounded = (value) => value === null ? null : Number(value.toFixed(3));
  return {
    id,
    perspective: pose.perspective,
    yawDegrees: pose.yawDegrees,
    pitchDegrees: pose.pitchDegrees,
    minCellPixels: rounded(Math.min(...expected.map((anchor) => anchor.cellPitch))),
    detected: result.detectedCount,
    centerRmsPixels: rounded(rms(centerResiduals)),
    centerMaxPixels: rounded(maximum(centerResiduals)),
    pitchRmsPixels: rounded(rms(pitchResiduals)),
    pitchMaxPixels: rounded(maximum(pitchResiduals)),
  };
}

// 기준선 게이트: 이 테스트가 서지 않으면 아래 왜곡 측정 표를 만들지 않는다.
test('정면 960px v0 프레임에서 6개 앵커 중심을 1px 이내로 찾는다', (t) => {
  for (const tones of [2, 3]) {
    const { frame, scene, offsetX, offsetY } = renderFrontFrame(tones);
    const expected = expectedFrontAnchors(scene, offsetX, offsetY);
    assert.deepEqual(expected.map((anchor) => anchor.id), RECTIFY_ANCHOR_IDS);

    const result = detectRectifyAnchors(frame, CENTRAL_V0_SOURCE_N);
    assert.equal(
      result.detectedCount,
      6,
      `tones=${tones}: ${JSON.stringify(result.anchors)}`,
    );
    assert.equal(result.reason, null);
    assert.equal(result.anchors.length, 6);
    const residuals = [];
    const rawCenterResiduals = [];
    const rawPitchResiduals = [];
    for (let index = 0; index < expected.length; index += 1) {
      const actual = result.anchors[index];
      assert.notEqual(actual, null, `tones=${tones} ${expected[index].id} 검출 실패`);
      const residual = Math.hypot(
        actual.x - expected[index].x,
        actual.y - expected[index].y,
      );
      const pitchResidual = Math.abs(actual.cellPitch - expected[index].cellPitch);
      rawCenterResiduals.push(residual);
      rawPitchResiduals.push(pitchResidual);
      residuals.push({
        id: expected[index].id,
        residual: Number(residual.toFixed(3)),
        expected: [Number(expected[index].x.toFixed(2)), Number(expected[index].y.toFixed(2))],
        actual: [Number(actual.x.toFixed(2)), Number(actual.y.toFixed(2))],
        cellPitch: Number(actual.cellPitch.toFixed(3)),
        pitchResidual: Number(pitchResidual.toFixed(3)),
        correlation: Number(actual.correlation.toFixed(4)),
      });
    }
    assert.ok(
      rawCenterResiduals.every((residual) => residual <= 1),
      `tones=${tones} 1px 초과: ${JSON.stringify(residuals)}`,
    );
    assert.ok(
      rawPitchResiduals.every((residual) => residual <= 1),
      `tones=${tones} 피치 1px 초과: ${JSON.stringify(residuals)}`,
    );
    const row = measurementRow(
      `baseline-front-${tones}tone`,
      { perspective: 0, yawDegrees: 0, pitchDegrees: 0 },
      expected,
      result,
    );
    assert.ok(row.minCellPixels > 9);
    t.diagnostic(`RECTIFY_METRIC ${JSON.stringify(row)}`);
  }
  baselinePassed = true;
});

test('원근·자세 프레임의 검출 수와 독립 기대좌표 잔차를 잰다', (t) => {
  assert.equal(baselinePassed, true, '정면 기준선 실패 뒤에는 왜곡 표를 만들지 않는다');
  const poses = [
    { id: 'perspective-0.1', perspective: 0.1, yawDegrees: 0, pitchDegrees: 0 },
    { id: 'perspective-0.3', perspective: 0.3, yawDegrees: 0, pitchDegrees: 0 },
    { id: 'perspective-0.5', perspective: 0.5, yawDegrees: 0, pitchDegrees: 0 },
    { id: 'pose-2deg', perspective: 0.1, yawDegrees: 2, pitchDegrees: -2 },
    { id: 'pose-5deg', perspective: 0.1, yawDegrees: 5, pitchDegrees: -5 },
    { id: 'perspective-0.3-pose-2deg', perspective: 0.3, yawDegrees: -2, pitchDegrees: 2 },
  ];
  const rows = [];
  for (const pose of poses) {
    const rendered = renderPoseFrame(pose);
    const expected = expectedPoseAnchors(rendered);
    const minimumPitch = Math.min(...expected.map((anchor) => anchor.cellPitch));
    assert.ok(
      minimumPitch > 9,
      `${pose.id}: 자가 9px 하한 미달 (${minimumPitch.toFixed(3)}px)`,
    );
    const result = detectRectifyAnchors(rendered.frame, CENTRAL_V0_SOURCE_N);
    assert.equal(result.anchors.length, RECTIFY_ANCHOR_IDS.length);
    assert.equal(
      result.detectedCount,
      result.anchors.filter((anchor) => anchor !== null).length,
    );
    const row = measurementRow(pose.id, pose, expected, result);
    rows.push(row);
    t.diagnostic(`RECTIFY_METRIC ${JSON.stringify(row)}`);
  }
  // 양성 포락만 잠근다: 저원근(t=0.1) 6/6 · 중심 ≤1 px. 0/6 행(t≥0.3 · ±2°)은 값으로
  // 잠그지 않는다 — 잠그면 개선을 거부하게 된다. 그 행들은 진단 출력으로만 남긴다.
  const lowPerspective = rows.find((row) => row.id === 'perspective-0.1');
  assert.equal(lowPerspective.detected, RECTIFY_ANCHOR_IDS.length,
    '저원근(t=0.1) 6/6 이 퇴행했다');
  assert.ok(lowPerspective.centerMaxPixels <= 1,
    `저원근(t=0.1) 중심 잔차 max ${lowPerspective.centerMaxPixels}px > 1px`);
  assert.ok(new Set(rows.map((row) => row.minCellPixels)).size > 1,
    '왜곡 자가 한 값으로 몰렸다');
});

test('같은 n의 다른 레이아웃은 v0 앵커로 오인하지 않는다', () => {
  const result = detectRectifyAnchors(
    renderOtherLayoutFrame(), CENTRAL_V0_SOURCE_N,
  );
  assert.equal(result.detectedCount, 0);
  assert.equal(result.reason, 'not-found');
  assert.deepEqual(result.anchors, Array(RECTIFY_ANCHOR_IDS.length).fill(null));
});

test('잘못된 입력과 지원하지 않는 n은 던지지 않고 null 슬롯을 반환한다', () => {
  for (const [frame, n, reason] of [
    [null, CENTRAL_V0_SOURCE_N, 'invalid-input'],
    [{ width: 10, height: 10, pixels: new Uint8Array(4) }, CENTRAL_V0_SOURCE_N,
      'invalid-input'],
    [{ width: 1, height: 1, pixels: new Uint8ClampedArray(4) }, 12,
      'unsupported-n'],
  ]) {
    let result;
    assert.doesNotThrow(() => { result = detectRectifyAnchors(frame, n); });
    assert.equal(result.reason, reason);
    assert.equal(result.detectedCount, 0);
    assert.deepEqual(result.anchors, Array(RECTIFY_ANCHOR_IDS.length).fill(null));
  }
});
