import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
  RECTIFY_ANCHOR_INTERNALS,
  detectRectifyAnchors,
} from '../src/decoder/rectify-anchors.js';
import { projectPoint as projectPoint2d } from '../src/decoder/homography.js';
import { addGaussianNoise, cameraTiltImage } from './harness/distort.mjs';

const FRAME_SIDE = 960;
const PPU = 17;
const PAYLOAD = 'https://tl.estre.so';
const DEGREE = Math.PI / 180;
const FACES = Object.freeze(['T', 'L', 'R']);
let baselinePassed = false;
const baselineLadderRows = [];
const poseLadderRows = [];
const planarLadderRows = [];
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
  return referenceAnchorPatches().map((patch, index) => {
    const face = FACES[index % FACES.length];
    const basis = faceBasis(face);
    return {
      id: RECTIFY_ANCHOR_IDS[index],
      x: offsetX + PPU * (scene.layout.originX + patch.anchor.x),
      y: offsetY + PPU * (scene.layout.originY + patch.anchor.y),
      cellPitch: Math.sqrt(Math.sqrt(3) / 2) * PPU,
      basisI: { x: basis.ei.x * PPU, y: basis.ei.y * PPU },
      basisJ: { x: basis.ej.x * PPU, y: basis.ej.y * PPU },
    };
  });
}

function renderOtherLayoutFrame() {
  const encoded = encodeY(PAYLOAD, { version: 0, tones: 3, eccLevel: 'M' });
  assert.equal(encoded.n, CENTRAL_V0_SOURCE_N);
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return embedSquare(rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 })).frame;
}

function renderPoseFrame(pose) {
  const { perspective, yawDegrees, pitchDegrees } = pose;
  const pixelsPerUnit = pose.pixelsPerUnit ?? PPU;
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
  }, { pixelsPerUnit, supersample: 2 });
  const embedded = embedSquare(raster);
  return {
    ...embedded,
    layout,
    perspective,
    yaw,
    pitch,
    pixelsPerUnit,
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

// cameraTiltImage의 픽셀 인덱스 좌표 투영식을 경계 좌표로 옮긴다.
// lane-out 판정자 산출물은 import하지 않고 필요한 자와 참 기대좌표만 여기서 독립 재현한다.
function tiltForward(frame, degrees, axis, distanceRatio) {
  const centerX = (frame.width - 1) / 2;
  const centerY = (frame.height - 1) / 2;
  const extent = Math.max(Math.min(centerX, centerY), 0.5);
  const distance = distanceRatio * extent;
  const phi = ({ horizontal: 0, vertical: 90, diagonal: 45 })[axis] * DEGREE;
  const ax = Math.cos(phi);
  const ay = Math.sin(phi);
  const nx = -Math.sin(phi);
  const ny = Math.cos(phi);
  const theta = degrees * DEGREE;
  const cosine = Math.cos(theta);
  const sine = Math.sin(theta);
  return (boundaryX, boundaryY) => {
    const ux = boundaryX - 0.5 - centerX;
    const uy = boundaryY - 0.5 - centerY;
    const alongAxis = ux * ax + uy * ay;
    const acrossAxis = ux * nx + uy * ny;
    const denominator = 1 + (acrossAxis * sine) / distance;
    const projectedAlong = alongAxis / denominator;
    const projectedAcross = (acrossAxis * cosine) / denominator;
    return {
      x: centerX + projectedAlong * ax + projectedAcross * nx + 0.5,
      y: centerY + projectedAlong * ay + projectedAcross * ny + 0.5,
    };
  };
}

function tiltedExpected(expected, forward) {
  return expected.map((anchor) => {
    const center = forward(anchor.x, anchor.y);
    const alongI = forward(
      anchor.x + anchor.basisI.x,
      anchor.y + anchor.basisI.y,
    );
    const alongJ = forward(
      anchor.x + anchor.basisJ.x,
      anchor.y + anchor.basisJ.y,
    );
    const quad = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ].map(([i, j]) => forward(
      anchor.x + anchor.basisI.x * i + anchor.basisJ.x * j,
      anchor.y + anchor.basisI.y * i + anchor.basisJ.y * j,
    ));
    return {
      id: anchor.id,
      x: center.x,
      y: center.y,
      cellPitch: Math.sqrt(polygonArea(quad)),
      basisI: { x: alongI.x - center.x, y: alongI.y - center.y },
      basisJ: { x: alongJ.x - center.x, y: alongJ.y - center.y },
    };
  });
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
      x: rendered.offsetX + point.x * rendered.pixelsPerUnit,
      y: rendered.offsetY + point.y * rendered.pixelsPerUnit,
    };
  };
  return referenceAnchorPatches().map((patch, index) => {
    const face = FACES[index % FACES.length];
    const { a, b } = faceCoordinates(face, patch.anchor);
    const center = project(face, a, b);
    const alongI = project(face, a + 1, b);
    const alongJ = project(face, a, b + 1);
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
      basisI: { x: alongI.x - center.x, y: alongI.y - center.y },
      basisJ: { x: alongJ.x - center.x, y: alongJ.y - center.y },
    };
  });
}

function singularValues2x2([a, b, c, d]) {
  const sum = a * a + b * b + c * c + d * d;
  const determinantSquared = (a * d - b * c) ** 2;
  const discriminant = Math.sqrt(Math.max(0, sum * sum - 4 * determinantSquared));
  return [
    Math.sqrt(Math.max(0, (sum + discriminant) / 2)),
    Math.sqrt(Math.max(0, (sum - discriminant) / 2)),
  ];
}

function seedGeometryMetrics(expected, trace) {
  const seedH = trace?.adopted?.seedH;
  if (!Array.isArray(seedH) || seedH.length !== 9) {
    return { seedOffsetCells: [], singularValues: [], anisotropy: [], shear: [] };
  }
  const H = Float64Array.from(seedH);
  const patches = referenceAnchorPatches();
  const seedOffsetCells = [];
  const singularValues = [];
  const anisotropy = [];
  const shear = [];
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index];
    const face = FACES[index % FACES.length];
    const basis = faceBasis(face);
    const seedCenter = projectPoint2d(H, patch.anchor);
    const seedI = projectPoint2d(H, {
      x: patch.anchor.x + basis.ei.x,
      y: patch.anchor.y + basis.ei.y,
    });
    const seedJ = projectPoint2d(H, {
      x: patch.anchor.x + basis.ej.x,
      y: patch.anchor.y + basis.ej.y,
    });
    if (!seedCenter || !seedI || !seedJ) continue;
    const hi = { x: seedI.x - seedCenter.x, y: seedI.y - seedCenter.y };
    const hj = { x: seedJ.x - seedCenter.x, y: seedJ.y - seedCenter.y };
    const searchPitch = (Math.hypot(hi.x, hi.y) + Math.hypot(hj.x, hj.y)) / 2;
    const determinant = hi.x * hj.y - hj.x * hi.y;
    if (!(searchPitch > 0) || Math.abs(determinant) < 1e-12) continue;
    seedOffsetCells.push(Math.hypot(
      seedCenter.x + 0.5 - expected[index].x,
      seedCenter.y + 0.5 - expected[index].y,
    ) / searchPitch);
    const oi = expected[index].basisI;
    const oj = expected[index].basisJ;
    const affine = [
      (hj.y * oi.x - hj.x * oi.y) / determinant,
      (hj.y * oj.x - hj.x * oj.y) / determinant,
      (-hi.y * oi.x + hi.x * oi.y) / determinant,
      (-hi.y * oj.x + hi.x * oj.y) / determinant,
    ];
    const [sigmaMax, sigmaMin] = singularValues2x2(affine);
    singularValues.push([sigmaMax, sigmaMin]);
    anisotropy.push(sigmaMin > 0 ? sigmaMax / sigmaMin : Infinity);
    shear.push(Math.max(Math.abs(affine[1]), Math.abs(affine[2])));
  }
  return { seedOffsetCells, singularValues, anisotropy, shear };
}

function failStages(trace) {
  const patches = trace?.adopted?.patches;
  if (!Array.isArray(patches) || patches.length !== RECTIFY_ANCHOR_IDS.length) {
    const stage = trace?.shapeCount === 0 ? 'no-seed' : 'no-adopted-shape';
    return RECTIFY_ANCHOR_IDS.map(() => stage);
  }
  const reseedAdopted = new Set(trace?.adopted?.reseed?.adoptedIndices ?? []);
  return patches.map((patch, index) => {
    if (reseedAdopted.has(index)) return 'reseed:ok';
    const stage = patch.exit === 'ok' || !patch.exitRound
      ? patch.exit : `${patch.exitRound}:${patch.exit}`;
    return patch.affineFallback ? `${stage}+affine-fallback:${patch.affineFallback}` : stage;
  });
}

function finiteMaximum(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0 ? null : Math.max(...finite);
}

function shiftedControlResidual(anchors, index = 4, cells = 2) {
  if (anchors[index] === null) return null;
  const shifted = anchors.map((anchor) => (
    anchor === null ? null : { ...anchor }
  ));
  shifted[index].x += cells * shifted[index].cellPitch;
  return RECTIFY_ANCHOR_INTERNALS.reprojectionResidualForAnchors(shifted);
}

function assertResidualBelowShiftedControl(result, context) {
  const shiftedControl = shiftedControlResidual(result.anchors);
  assert.notEqual(shiftedControl, null, `${context}: 2셀 이동 대조군 residual 객체`);
  assert.ok(Number.isFinite(shiftedControl.maxCells),
    `${context}: 2셀 이동 대조군 maxCells`);
  assert.ok(shiftedControl.maxCells >= 1,
    `${context}: 2셀 이동 대조군 maxCells ${shiftedControl.maxCells} < 1`);
  assert.ok(
    Number.isFinite(result.residual?.maxCells)
      && result.residual.maxCells < shiftedControl.maxCells,
    `${context}: 정상 ${result.residual?.maxCells} >= 대조 ${shiftedControl.maxCells}`,
  );
  return shiftedControl;
}

function measurementRow(id, pose, expected, result, trace, msPerCall) {
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
  const geometry = seedGeometryMetrics(expected, trace);
  const centerRmsPixels = rounded(rms(centerResiduals));
  const centerMaxPixels = rounded(maximum(centerResiduals));
  return {
    id,
    perspective: pose.perspective,
    yawDegrees: pose.yawDegrees,
    pitchDegrees: pose.pitchDegrees,
    minCellPixels: rounded(Math.min(...expected.map((anchor) => anchor.cellPitch))),
    detected: result.detectedCount,
    centerRmsPixels,
    centerMaxPixels,
    pitchRmsPixels: rounded(rms(pitchResiduals)),
    pitchMaxPixels: rounded(maximum(pitchResiduals)),
    shapes: trace?.shapeCount ?? 0,
    seedOffsetMaxCells: rounded(finiteMaximum(geometry.seedOffsetCells)),
    anisoMax: rounded(finiteMaximum(geometry.anisotropy)),
    failStage: failStages(trace),
    pixelsPerUnit: pose.pixelsPerUnit ?? PPU,
    shapeScore: trace?.adopted?.shapeScore ?? null,
    candidateDetected: trace?.adopted?.detectedCount ?? 0,
    seedOffsetCells: geometry.seedOffsetCells.map(rounded),
    singularValues: geometry.singularValues.map(
      ([sigmaMax, sigmaMin]) => [rounded(sigmaMax), rounded(sigmaMin)],
    ),
    anisotropy: geometry.anisotropy.map(rounded),
    shearMax: rounded(finiteMaximum(geometry.shear)),
    shear: geometry.shear.map(rounded),
    trueCenterMaxPx: centerMaxPixels,
    reseeded: result.reseeded,
    residualMaxCells: rounded(result.residual?.maxCells ?? null),
    residualRmsCells: rounded(result.residual?.rmsCells ?? null),
    gate: result.residual?.gate ?? null,
    msPerCall: rounded(msPerCall),
  };
}

function normalizeLadderRows(rows) {
  return rows.map((row) => {
    const normalized = { ...row };
    delete normalized.centerResidualsPixels;
    delete normalized.pitchResidualsPixels;
    normalized.singularValues ??= [];
    normalized.trueCenterMaxPx ??= normalized.centerMaxPixels ?? null;
    if (!Object.hasOwn(normalized, 'reseeded')) normalized.reseeded = null;
    if (!Object.hasOwn(normalized, 'residualMaxCells')) normalized.residualMaxCells = null;
    if (!Object.hasOwn(normalized, 'residualRmsCells')) normalized.residualRmsCells = null;
    if (!Object.hasOwn(normalized, 'gate')) normalized.gate = null;
    if (!Object.hasOwn(normalized, 'msPerCall')) normalized.msPerCall = null;
    return normalized;
  });
}

// 사다리 원자료(before/after 병합 JSON)는 레인 공정 산출물이다 — RECTIFY_LADDER_OUT 에 출력
// 경로를 줄 때만 쓴다. 기본 실행은 저장소 트리에 아무것도 남기지 않는다.
function writeLadder(rows) {
  const path = process.env.RECTIFY_LADDER_OUT;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  let artifact = { schemaVersion: 1, before: [], after: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed?.schemaVersion === 1
      && Array.isArray(parsed.before) && Array.isArray(parsed.after)) artifact = parsed;
  } catch {
    // 첫 실행에는 원자료 파일이 없다.
  }
  const phase = process.env.RECTIFY_LADDER_PHASE ?? 'after';
  if (phase !== 'before' && phase !== 'after') {
    throw new Error(`RECTIFY_LADDER_PHASE must be before or after, got ${phase}`);
  }
  artifact[phase] = rows;
  artifact.before = normalizeLadderRows(artifact.before);
  artifact.after = normalizeLadderRows(artifact.after);
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

// 기준선 게이트: 이 테스트가 서지 않으면 아래 왜곡 측정 표를 만들지 않는다.
test('정면 960px v0 프레임에서 6개 앵커 중심을 1px 이내로 찾는다', (t) => {
  for (const tones of [2, 3]) {
    const { frame, scene, offsetX, offsetY } = renderFrontFrame(tones);
    const expected = expectedFrontAnchors(scene, offsetX, offsetY);
    assert.deepEqual(expected.map((anchor) => anchor.id), RECTIFY_ANCHOR_IDS);

    const trace = {};
    const startedAt = performance.now();
    const result = detectRectifyAnchors(frame, CENTRAL_V0_SOURCE_N, { trace });
    const msPerCall = performance.now() - startedAt;
    assert.equal(
      result.detectedCount,
      6,
      `tones=${tones}: ${JSON.stringify(result.anchors)}`,
    );
    assert.equal(result.reason, null);
    assert.equal(result.anchors.length, 6);
    assertResidualBelowShiftedControl(result, `tones=${tones}`);
    const residuals = [];
    const rawCenterResiduals = [];
    const rawPitchResiduals = [];
    for (let index = 0; index < expected.length; index += 1) {
      const actual = result.anchors[index];
      assert.notEqual(actual, null, `tones=${tones} ${expected[index].id} 검출 실패`);
      assert.equal(actual.localAffine?.length, 4,
        `tones=${tones} ${expected[index].id} localAffine 4원소 계약`);
      assert.ok(actual.localAffine.every(Number.isFinite),
        `tones=${tones} ${expected[index].id} localAffine 비유한 값`);
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
      trace,
      msPerCall,
    );
    assert.ok(row.minCellPixels > 9);
    baselineLadderRows.push({ ...row, gateTrace: trace });
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
    { id: 'perspective-0.15', perspective: 0.15, yawDegrees: 0, pitchDegrees: 0 },
    { id: 'perspective-0.2', perspective: 0.2, yawDegrees: 0, pitchDegrees: 0 },
    { id: 'perspective-0.25', perspective: 0.25, yawDegrees: 0, pitchDegrees: 0 },
    { id: 'pose-2deg-t0', perspective: 0, yawDegrees: 2, pitchDegrees: -2 },
    { id: 'yaw-2deg-only', perspective: 0.1, yawDegrees: 2, pitchDegrees: 0 },
    { id: 'pitch-2deg-only', perspective: 0.1, yawDegrees: 0, pitchDegrees: -2 },
    { id: 'pose-1deg', perspective: 0.1, yawDegrees: 1, pitchDegrees: -1 },
    { id: 'pose-3deg', perspective: 0.1, yawDegrees: 3, pitchDegrees: -3 },
    {
      id: 'perspective-0.2@ppu22', perspective: 0.2,
      yawDegrees: 0, pitchDegrees: 0, pixelsPerUnit: 22,
    },
    {
      id: 'pose-2deg@ppu20', perspective: 0.1,
      yawDegrees: 2, pitchDegrees: -2, pixelsPerUnit: 20,
    },
    {
      id: 'perspective-0.5@ppu26', perspective: 0.5,
      yawDegrees: 0, pitchDegrees: 0, pixelsPerUnit: 26,
    },
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
    const trace = {};
    const startedAt = performance.now();
    const result = detectRectifyAnchors(
      rendered.frame, CENTRAL_V0_SOURCE_N, { trace },
    );
    const msPerCall = performance.now() - startedAt;
    assert.equal(trace.reseed, trace.adopted?.reseed ?? null,
      `${pose.id}: 최종 후보 reseed trace 별칭`);
    assert.equal(result.anchors.length, RECTIFY_ANCHOR_IDS.length);
    assert.equal(
      result.detectedCount,
      result.anchors.filter((anchor) => anchor !== null).length,
    );
    const row = measurementRow(pose.id, pose, expected, result, trace, msPerCall);
    rows.push(row);
    poseLadderRows.push({ ...row, gateTrace: trace });
    if (result.detectedCount >= 4 && result.detectedCount < RECTIFY_ANCHOR_IDS.length) {
      assert.notEqual(result.residual, null, `${pose.id}: 부분 결과 residual 객체`);
    }
    if (pose.id === 'pose-3deg') {
      const reseed = trace.adopted?.reseed;
      t.diagnostic(`RESEED_METRIC ${JSON.stringify({
        attempted: reseed?.attempted ?? false,
        adoptedIndices: reseed?.adoptedIndices ?? [],
        patches: reseed?.patches?.map((patch) => ({
          id: patch.id,
          predicted: patch.predicted,
          predictedOffsetCells: patch.predicted && Number.isInteger(patch.index)
            ? Number((Math.hypot(
              patch.predicted.x - expected[patch.index].x,
              patch.predicted.y - expected[patch.index].y,
            ) / expected[patch.index].cellPitch).toFixed(3))
            : null,
          exit: patch.exit,
          exitRound: patch.exitRound,
          affineFailure: patch.affineFailure,
        })) ?? [],
      })}`);
    }
    // 이 행들은 평면 인쇄물이 아닌 3D 큐브 렌더다. 정상 6/6의 fail은 현재 자의
    // 알려진 비평면 지표이며, 유효성 퇴행으로 오독하지 않도록 방향을 기록한다.
    if (result.detectedCount === RECTIFY_ANCHOR_IDS.length) {
      assert.ok(
        Number.isFinite(result.residual?.maxCells)
          && result.residual.maxCells > result.residual.thresholdCells,
        `${pose.id}: 3D residual ${result.residual?.maxCells} <= 문턱 ${result.residual?.thresholdCells}`,
      );
    }
    t.diagnostic(`RECTIFY_METRIC ${JSON.stringify(row)}`);
  }
  const pose2 = rows.find((row) => row.id === 'pose-2deg');
  assert.equal(pose2.detected, RECTIFY_ANCHOR_IDS.length,
    '자세 2도(t=0.1) 6/6 이 퇴행했다');
  assert.ok(pose2.centerMaxPixels <= 1,
    `자세 2도(t=0.1) 중심 잔차 max ${pose2.centerMaxPixels}px > 1px`);
  const pose2T0 = rows.find((row) => row.id === 'pose-2deg-t0');
  assert.equal(pose2T0.detected, RECTIFY_ANCHOR_IDS.length,
    '자세 2도(t=0) 6/6 이 퇴행했다');
  assert.ok(pose2T0.centerMaxPixels <= 1,
    `자세 2도(t=0) 중심 잔차 max ${pose2T0.centerMaxPixels}px > 1px`);
  const perspective02 = rows.find((row) => row.id === 'perspective-0.2');
  assert.equal(perspective02.detected, RECTIFY_ANCHOR_IDS.length,
    '원근 t=0.2 6/6 이 퇴행했다');
  assert.ok(perspective02.centerMaxPixels <= 1.5,
    `원근 t=0.2 중심 잔차 max ${perspective02.centerMaxPixels}px > 1.5px`);
  // 양성 포락만 잠근다. t≥0.3 등 아직 실패하는 행은 값으로 잠그지 않는다 —
  // 잠그면 다음 개선을 거부하게 된다. 그 행들은 진단 출력으로만 남긴다.
  const lowPerspective = rows.find((row) => row.id === 'perspective-0.1');
  assert.equal(lowPerspective.detected, RECTIFY_ANCHOR_IDS.length,
    '저원근(t=0.1) 6/6 이 퇴행했다');
  assert.ok(lowPerspective.centerMaxPixels <= 1,
    `저원근(t=0.1) 중심 잔차 max ${lowPerspective.centerMaxPixels}px > 1px`);
  const pose3 = rows.find((row) => row.id === 'pose-3deg');
  assert.equal(typeof pose3.reseeded, 'boolean');
  assert.ok(new Set(rows.map((row) => row.minCellPixels)).size > 1,
    '왜곡 자가 한 값으로 몰렸다');
});

test('평면 인쇄물 카메라 기울기에서 잔차가 2셀 이동 대조군보다 작다', (t) => {
  assert.equal(baselinePassed, true);
  const { frame, scene, offsetX, offsetY } = renderFrontFrame(3);
  const frontExpected = expectedFrontAnchors(scene, offsetX, offsetY);
  const cases = [
    { axis: 'horizontal', degrees: 10, distanceRatio: 4 },
    { axis: 'horizontal', degrees: 20, distanceRatio: 4 },
    { axis: 'diagonal', degrees: 20, distanceRatio: 4 },
  ];
  for (const tilt of cases) {
    const id = `planar-tilt-${tilt.axis}-${tilt.degrees}deg-dr${tilt.distanceRatio}`;
    const tilted = cameraTiltImage(frame, tilt.degrees, {
      axis: tilt.axis,
      distanceRatio: tilt.distanceRatio,
    });
    const expected = tiltedExpected(
      frontExpected,
      tiltForward(frame, tilt.degrees, tilt.axis, tilt.distanceRatio),
    );
    const trace = {};
    const startedAt = performance.now();
    const result = detectRectifyAnchors(
      tilted, CENTRAL_V0_SOURCE_N, { trace },
    );
    const msPerCall = performance.now() - startedAt;
    assert.equal(result.detectedCount, RECTIFY_ANCHOR_IDS.length, `${id}: 검출 6/6`);
    const shiftedControl = assertResidualBelowShiftedControl(result, id);
    const row = {
      ...measurementRow(
        id,
        { perspective: 0, yawDegrees: 0, pitchDegrees: 0 },
        expected,
        result,
        trace,
        msPerCall,
      ),
      tiltAxis: tilt.axis,
      tiltDegrees: tilt.degrees,
      distanceRatio: tilt.distanceRatio,
      control2cellMaxCells: Number(shiftedControl.maxCells.toFixed(3)),
      control2cellGate: shiftedControl.gate,
    };
    planarLadderRows.push({ ...row, gateTrace: trace });
    // 평면 기울기의 중심 max <= 1.5 px는 값 잠금 없이 사다리에만 기록한다.
    t.diagnostic(`RECTIFY_PLANAR_METRIC ${JSON.stringify(row)}`);
  }
});

test('정면 PPU 17 잡음 사다리에서 잔차와 참 중심 오차를 함께 잰다', (t) => {
  assert.equal(baselinePassed, true);
  const { frame, scene, offsetX, offsetY } = renderFrontFrame(3);
  const expected = expectedFrontAnchors(scene, offsetX, offsetY);
  const noiseRows = [];
  for (const sigma of [4, 8, 12, 16, 24]) {
    const noisyFrame = addGaussianNoise(frame, sigma, { seed: 0x41505249 + sigma });
    const trace = {};
    const startedAt = performance.now();
    const result = detectRectifyAnchors(
      noisyFrame, CENTRAL_V0_SOURCE_N, { trace },
    );
    const msPerCall = performance.now() - startedAt;
    assert.equal(result.detectedCount, RECTIFY_ANCHOR_IDS.length,
      `가우시안 sigma=${sigma}: 6/6 퇴행`);
    assert.notEqual(result.residual, null, `가우시안 sigma=${sigma}: residual 객체`);
    assert.ok(Number.isFinite(result.residual.maxCells));
    assert.ok(Number.isFinite(result.residual.rmsCells));
    assertResidualBelowShiftedControl(result, `가우시안 sigma=${sigma}`);
    const row = {
      ...measurementRow(
        `noise-sigma-${sigma}`,
        { perspective: 0, yawDegrees: 0, pitchDegrees: 0 },
        expected,
        result,
        trace,
        msPerCall,
      ),
      noiseSigma: sigma,
    };
    noiseRows.push({ ...row, gateTrace: trace });
    t.diagnostic(`RECTIFY_NOISE_METRIC ${JSON.stringify(row)}`);
  }
  writeLadder([
    ...baselineLadderRows,
    ...poseLadderRows,
    ...noiseRows,
    ...planarLadderRows,
  ]);
});

test('잔차 자는 2셀 대조군과 4·5개 부분 결과의 식별 한계를 기록한다', (t) => {
  const { frame } = renderFrontFrame(3);
  const detected = detectRectifyAnchors(frame, CENTRAL_V0_SOURCE_N);
  assert.equal(detected.detectedCount, RECTIFY_ANCHOR_IDS.length);

  const fiveAnchors = detected.anchors.slice();
  fiveAnchors[5] = null;
  const fiveResidual = RECTIFY_ANCHOR_INTERNALS
    .reprojectionResidualForAnchors(fiveAnchors);
  assert.notEqual(fiveResidual, null);
  assert.equal(fiveResidual.perAnchorCells.filter(Number.isFinite).length, 5);
  assert.ok(Number.isFinite(fiveResidual.maxCells));
  assert.ok(Number.isFinite(fiveResidual.rmsCells));
  assert.ok(Number.isFinite(fiveResidual.perFace.T));
  assert.ok(Number.isFinite(fiveResidual.perFace.L));
  assert.equal(fiveResidual.perFace.R, null);

  const fourAnchors = fiveAnchors.slice();
  fourAnchors[4] = null;
  const fourResidual = RECTIFY_ANCHOR_INTERNALS
    .reprojectionResidualForAnchors(fourAnchors);
  assert.notEqual(fourResidual, null);
  assert.deepEqual(fourResidual.perAnchorCells, Array(RECTIFY_ANCHOR_IDS.length).fill(null));
  assert.equal(fourResidual.maxCells, null);
  assert.equal(fourResidual.rmsCells, null);
  assert.deepEqual(fourResidual.perFace, { T: null, L: null, R: null });
  assert.equal(fourResidual.gate, null);

  const threeAnchors = fourAnchors.slice();
  threeAnchors[3] = null;
  assert.equal(
    RECTIFY_ANCHOR_INTERNALS.reprojectionResidualForAnchors(threeAnchors),
    null,
  );

  const shiftedResidual = shiftedControlResidual(detected.anchors);
  assert.notEqual(shiftedResidual, null);
  assert.equal(shiftedResidual.gate, 'fail');
  assert.ok(shiftedResidual.maxCells >= 1);
  const positiveMaxCells = finiteMaximum(
    [...baselineLadderRows, ...poseLadderRows]
      .filter((row) => row.detected === RECTIFY_ANCHOR_IDS.length)
      .map((row) => row.residualMaxCells),
  );
  t.diagnostic(`RECTIFY_CONTROL ${JSON.stringify({
    shiftedAnchor: RECTIFY_ANCHOR_IDS[4],
    shiftCells: 2,
    residualMaxCells: Number(shiftedResidual.maxCells.toFixed(3)),
    residualRmsCells: Number(shiftedResidual.rmsCells.toFixed(3)),
    gate: shiftedResidual.gate,
    thresholdCells: shiftedResidual.thresholdCells,
    currentPositiveMaxCells: positiveMaxCells,
  })}`);
});

test('같은 n의 다른 레이아웃은 v0 앵커로 오인하지 않는다', () => {
  const result = detectRectifyAnchors(
    renderOtherLayoutFrame(), CENTRAL_V0_SOURCE_N,
  );
  assert.equal(result.detectedCount, 0);
  assert.equal(result.reason, 'not-found');
  assert.equal(result.reseeded, false);
  assert.equal(result.residual, null);
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
    assert.equal(result.reseeded, false);
    assert.equal(result.residual, null);
    assert.deepEqual(result.anchors, Array(RECTIFY_ANCHOR_IDS.length).fill(null));
  }
});
