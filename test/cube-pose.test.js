/**
 * cube-pose.test.js — 큐브 강체 포즈 7파라미터 LM.
 *
 * 합성 렌더 경로는 test/rectify-anchors.test.js · 씨앗 judge-common 과 같다.
 * lane-in/ 은 import 하지 않는다.
 *
 * 실행: node --test test/cube-pose.test.js
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { describe, test } from 'node:test';

import { CENTRAL_V0_SOURCE_N } from '../src/cellSurfaceFinal.js';
import { CS_BLOCK_LOCATOR_INTERNALS } from '../src/decoder/cellsurface-block-detect.js';
import { estimateCubePose } from '../src/decoder/cube-pose.js';
import {
  RECTIFY_ANCHOR_IDS,
  detectRectifyAnchors,
} from '../src/decoder/rectify-anchors.js';
import { encodeY } from '../src/encodeY.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
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

const FRAME_SIDE = 960;
const PPU = 17;
const PAYLOAD = 'https://tl.estre.so';
const DEGREE = Math.PI / 180;
const FACES = Object.freeze(['T', 'L', 'R']);
const N = CENTRAL_V0_SOURCE_N;
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PARAM_KEYS = Object.freeze([
  'yaw', 'pitch', 'roll', 'invDist', 'ppu', 'offX', 'offY',
]);

const NORMAL_POSES = Object.freeze([
  { id: 'perspective-0.1', perspective: 0.1, yawDegrees: 0, pitchDegrees: 0 },
  { id: 'perspective-0.15', perspective: 0.15, yawDegrees: 0, pitchDegrees: 0 },
  { id: 'perspective-0.2', perspective: 0.2, yawDegrees: 0, pitchDegrees: 0 },
  { id: 'pose-2deg', perspective: 0.1, yawDegrees: 2, pitchDegrees: -2 },
  { id: 'pose-2deg-t0', perspective: 0, yawDegrees: 2, pitchDegrees: -2 },
  { id: 'yaw-2deg-only', perspective: 0.1, yawDegrees: 2, pitchDegrees: 0 },
  { id: 'pitch-2deg-only', perspective: 0.1, yawDegrees: 0, pitchDegrees: -2 },
]);

const ENVELOPE_POSES = Object.freeze([
  { id: 'pose-3deg', perspective: 0.1, yawDegrees: 3, pitchDegrees: -3 },
  { id: 'pose-5deg', perspective: 0.1, yawDegrees: 5, pitchDegrees: -5 },
  { id: 'perspective-0.25', perspective: 0.25, yawDegrees: 0, pitchDegrees: 0 },
  { id: 'perspective-0.3', perspective: 0.3, yawDegrees: 0, pitchDegrees: 0 },
  { id: 'roll-2deg', perspective: 0.1, yawDegrees: 0, pitchDegrees: 0, rollDegrees: 2 },
]);

function referenceAnchorPatches() {
  const reference = CS_BLOCK_LOCATOR_INTERNALS.patchesForN(N);
  const patches = [...reference.subPatches.slice(0, 3), ...reference.corners];
  assert.equal(patches.length, RECTIFY_ANCHOR_IDS.length);
  return patches;
}

const PATCHES = referenceAnchorPatches();

function faceCoordinates(face, point) {
  const basis = faceBasis(face);
  const determinant = basis.ei.x * basis.ej.y - basis.ei.y * basis.ej.x;
  return {
    a: (point.x * basis.ej.y - point.y * basis.ej.x) / determinant,
    b: (basis.ei.x * point.y - basis.ei.y * point.x) / determinant,
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

function embedSquare(raster) {
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

function geometryOfPose(pose) {
  const pixelsPerUnit = pose.pixelsPerUnit ?? PPU;
  const layout = layoutForCube(N, { size: 1, margin: 4 });
  const width = Math.round(layout.width * pixelsPerUnit);
  const height = Math.round(layout.height * pixelsPerUnit);
  const offsetX = Math.floor((FRAME_SIDE - width) / 2);
  const offsetY = Math.floor((FRAME_SIDE - height) / 2);
  const yaw = pose.yawDegrees * DEGREE;
  const pitch = pose.pitchDegrees * DEGREE;
  const roll = (pose.rollDegrees ?? 0) * DEGREE;
  const invDist = perspectiveInvDist(pose.perspective, (N / 2) * Math.sqrt(3));
  return {
    id: pose.id,
    layout,
    offsetX,
    offsetY,
    pixelsPerUnit,
    yaw,
    pitch,
    roll,
    invDist,
    perspective: pose.perspective,
  };
}

function truthParamsOf(geom) {
  return {
    yaw: geom.yaw,
    pitch: geom.pitch,
    roll: geom.roll,
    invDist: geom.invDist,
    ppu: geom.pixelsPerUnit,
    offX: geom.offsetX,
    offY: geom.offsetY,
  };
}

function poseOptions(geom, initial) {
  const options = { n: N, layout: geom.layout };
  if (initial) options.initial = initial;
  return options;
}

function expectedAnchors(geom) {
  const center3d = cubeCenter(N);
  const project = (face, a, b) => {
    const source = cubePoint(face, a, b);
    const rotated = orbitPoint(source, geom.yaw, geom.pitch, center3d, geom.roll);
    const point = projectPoint3d(rotated, geom.layout, center3d, geom.invDist);
    return {
      x: geom.offsetX + point.x * geom.pixelsPerUnit,
      y: geom.offsetY + point.y * geom.pixelsPerUnit,
    };
  };
  return PATCHES.map((patch, index) => {
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
      face,
      a,
      b,
      x: center.x,
      y: center.y,
      cellPitch: Math.sqrt(polygonArea(quad)),
      basisI: { x: alongI.x - center.x, y: alongI.y - center.y },
      basisJ: { x: alongJ.x - center.x, y: alongJ.y - center.y },
    };
  });
}

function observationsFromExpected(anchors) {
  return anchors.map((anchor) => ({
    id: anchor.id,
    face: anchor.face,
    a: anchor.a,
    b: anchor.b,
    x: anchor.x,
    y: anchor.y,
    cellPitch: anchor.cellPitch,
  }));
}

function observationsFromDetected(anchors) {
  const obs = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (anchor === null || anchor === undefined) continue;
    const face = anchor.face || FACES[index % FACES.length];
    const { a, b } = faceCoordinates(face, PATCHES[index].anchor);
    obs.push({
      id: anchor.id ?? RECTIFY_ANCHOR_IDS[index],
      face,
      a,
      b,
      x: anchor.x,
      y: anchor.y,
      cellPitch: anchor.cellPitch,
    });
  }
  return obs;
}

function shiftObservation(obs, cells, index) {
  const target = index === undefined
    ? Math.min(4, obs.length - 1)
    : index;
  return obs.map((item, i) => (
    i === target
      ? { ...item, x: item.x + cells * item.cellPitch }
      : item
  ));
}

function renderPoseFrame(pose) {
  const geom = geometryOfPose(pose);
  const encoded = encodeY(PAYLOAD, { cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'M' });
  assert.equal(encoded.n, N);
  const digitAt = (i, j) => encoded.cellDigits.get(`${i},${j}`)?.digit ?? null;
  const levelAt = (i, j, face) => {
    const cell = encoded.cellDigits.get(`${i},${j}`);
    return Number.isInteger(cell?.tones?.[face]) ? cell.tones[face] : null;
  };
  const mesh = buildOrbitMesh({
    n: encoded.n,
    tones: encoded.tones,
    levels: PRESET.levels,
    layout: geom.layout,
    digitAt,
    levelAt,
    perspective: pose.perspective,
    yaw: geom.yaw,
    pitch: geom.pitch,
    roll: geom.roll,
    faces: 3,
  });
  const raster = rasterize({
    width: geom.layout.width,
    height: geom.layout.height,
    background: PRESET.background,
    shapes: mesh.quads.map((quad) => ({
      kind: 'polygon', points: quad.points2d, color: quad.color,
    })),
  }, { pixelsPerUnit: geom.pixelsPerUnit, supersample: 2 });
  const embedded = embedSquare(raster);
  return { ...geom, frame: embedded.frame, offsetX: embedded.offsetX, offsetY: embedded.offsetY };
}

function finiteAll(values) {
  return values.every((v) => v !== null && Number.isFinite(v));
}

describe('입력 계약', () => {
  test('배열이 아니면 invalid-input 이고 던지지 않는다', () => {
    const result = estimateCubePose(null, { n: N });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-input');
    assert.equal(result.params, null);
    assert.equal(result.converged, false);
  });

  test('n 이 없으면 invalid-input', () => {
    const geom = geometryOfPose(NORMAL_POSES[0]);
    const obs = observationsFromExpected(expectedAnchors(geom));
    const result = estimateCubePose(obs, {});
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-input');
  });

  test('면 라벨·cellPitch 가 나쁘면 invalid-input', () => {
    const geom = geometryOfPose(NORMAL_POSES[0]);
    const obs = observationsFromExpected(expectedAnchors(geom));
    const badFace = estimateCubePose(
      obs.map((o, i) => (i === 0 ? { ...o, face: 'X' } : o)),
      poseOptions(geom),
    );
    assert.equal(badFace.reason, 'invalid-input');
    const badPitch = estimateCubePose(
      obs.map((o, i) => (i === 0 ? { ...o, cellPitch: 0 } : o)),
      poseOptions(geom),
    );
    assert.equal(badPitch.reason, 'invalid-input');
  });
});

describe('자유도', () => {
  const geom = geometryOfPose(NORMAL_POSES[0]);
  const all = observationsFromExpected(expectedAnchors(geom));

  test('n=3 → underdetermined', () => {
    const result = estimateCubePose(all.slice(0, 3), poseOptions(geom));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'underdetermined');
    assert.equal(result.params, null);
    assert.equal(result.residual.perObsCells.length, 3);
    assert.ok(result.residual.perObsCells.every((v) => v === null));
  });

  test('n=4 → LOO 는 전부 null, in-sample 은 유한', () => {
    const result = estimateCubePose(all.slice(0, 4), poseOptions(geom));
    assert.equal(result.ok, true);
    assert.equal(result.residual.perObsCells.length, 4);
    assert.ok(result.residual.perObsCells.every((v) => v === null));
    assert.equal(result.residual.maxCells, null);
    assert.ok(Number.isFinite(result.residual.inSampleMaxCells));
    assert.ok(result.residual.inSampleMaxCells < 1e-6);
  });

  test('n=5 → LOO 유한 (불안정할 수 있음 — 값은 내기만 한다)', () => {
    const result = estimateCubePose(all.slice(0, 5), poseOptions(geom));
    assert.equal(result.ok, true);
    assert.equal(result.residual.perObsCells.length, 5);
    assert.ok(finiteAll(result.residual.perObsCells));
    assert.ok(Number.isFinite(result.residual.maxCells));
    assert.ok(Number.isFinite(result.residual.inSampleMaxCells));
  });

  test('n=6 → LOO 유한', () => {
    const result = estimateCubePose(all, poseOptions(geom));
    assert.equal(result.ok, true);
    assert.ok(finiteAll(result.residual.perObsCells));
    assert.ok(result.residual.inSampleMaxCells < 1e-6);
    assert.ok(result.residual.maxCells < 1e-6);
  });
});

describe('참값 회복', () => {
  test('합성 참 앵커는 in-sample · LOO 가 0 에 수렴한다 (≤1e-6셀)', () => {
    const rows = [];
    for (const pose of NORMAL_POSES) {
      const geom = geometryOfPose(pose);
      const obs = observationsFromExpected(expectedAnchors(geom));
      const started = performance.now();
      const blind = estimateCubePose(obs, poseOptions(geom));
      const oracle = estimateCubePose(obs, poseOptions(geom, truthParamsOf(geom)));
      const ms = performance.now() - started;
      rows.push({
        id: pose.id,
        blindOk: blind.ok,
        oracleOk: oracle.ok,
        blindIn: blind.residual.inSampleMaxCells,
        blindLoo: blind.residual.maxCells,
        oracleIn: oracle.residual.inSampleMaxCells,
        oracleLoo: oracle.residual.maxCells,
        iterations: blind.iterations,
        ms: Number(ms.toFixed(3)),
      });
      assert.equal(blind.ok, true, pose.id + ' blind');
      assert.equal(oracle.ok, true, pose.id + ' oracle');
      assert.ok(blind.residual.inSampleMaxCells <= 1e-6, pose.id + ' blind in-sample');
      assert.ok(blind.residual.maxCells <= 1e-6, pose.id + ' blind LOO');
      assert.ok(oracle.residual.inSampleMaxCells <= 1e-6, pose.id + ' oracle in-sample');
      assert.ok(oracle.residual.maxCells <= 1e-6, pose.id + ' oracle LOO');
    }
    console.log('TRUTH_RECOVERY', JSON.stringify(rows));
  });
});

describe('결정성', () => {
  test('같은 입력 2회 호출이 JSON 비트 동일', () => {
    const geom = geometryOfPose(NORMAL_POSES[3]);
    const obs = observationsFromExpected(expectedAnchors(geom));
    const a = estimateCubePose(obs, poseOptions(geom));
    const b = estimateCubePose(obs, poseOptions(geom));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
});

describe('blind vs oracle (참 앵커)', () => {
  test('6/6 정상 행에서 같은 값으로 수렴한다', () => {
    const rows = [];
    for (const pose of NORMAL_POSES) {
      const geom = geometryOfPose(pose);
      const obs = observationsFromExpected(expectedAnchors(geom));
      const truth = truthParamsOf(geom);
      const blind = estimateCubePose(obs, poseOptions(geom));
      const oracle = estimateCubePose(obs, poseOptions(geom, truth));
      assert.equal(blind.ok, true);
      assert.equal(oracle.ok, true);
      const delta = {};
      for (const key of PARAM_KEYS) {
        delta[key] = Math.abs(blind.params[key] - oracle.params[key]);
      }
      rows.push({ id: pose.id, delta });
      assert.ok(delta.yaw < 1e-6, pose.id + ' yaw');
      assert.ok(delta.pitch < 1e-6, pose.id + ' pitch');
      assert.ok(delta.roll < 1e-6, pose.id + ' roll');
      assert.ok(delta.invDist < 1e-6, pose.id + ' invDist');
      assert.ok(delta.ppu < 1e-4, pose.id + ' ppu');
      assert.ok(delta.offX < 1e-3, pose.id + ' offX');
      assert.ok(delta.offY < 1e-3, pose.id + ' offY');
    }
    console.log('BLIND_VS_ORACLE_TRUTH', JSON.stringify(rows));
  });
});

describe('정상 3D 행 · 검출 앵커 · 대조군', { timeout: 180000 }, () => {
  test('6/6 검출에서 LOO·in-sample 이 대조군과 갈린다', () => {
    const healthy = [];
    const controls = [];
    for (const pose of NORMAL_POSES) {
      const rendered = renderPoseFrame(pose);
      const detected = detectRectifyAnchors(rendered.frame, N, {});
      assert.equal(detected.detectedCount, 6, pose.id + ' 6/6');
      const obs = observationsFromDetected(detected.anchors);
      assert.equal(obs.length, 6, pose.id + ' obs');
      const started = performance.now();
      const fit = estimateCubePose(obs, poseOptions(rendered));
      const ms = performance.now() - started;
      const oracle = estimateCubePose(
        obs,
        poseOptions(rendered, truthParamsOf(rendered)),
      );
      const shifted2 = estimateCubePose(shiftObservation(obs, 2), poseOptions(rendered));
      const shifted05 = estimateCubePose(shiftObservation(obs, 0.5), poseOptions(rendered));
      const row = {
        id: pose.id,
        ok: fit.ok,
        reason: fit.reason,
        loo: fit.residual.maxCells,
        inSample: fit.residual.inSampleMaxCells,
        rms: fit.residual.rmsCells,
        iterations: fit.iterations,
        ms: Number(ms.toFixed(3)),
        ctl2: shifted2.residual.maxCells,
        ctl05: shifted05.residual.maxCells,
        oracleOk: oracle.ok,
        paramDeltaYaw: Math.abs(fit.params.yaw - oracle.params.yaw),
        paramDeltaPitch: Math.abs(fit.params.pitch - oracle.params.pitch),
        paramDeltaRoll: Math.abs(fit.params.roll - oracle.params.roll),
        roll: fit.params.roll,
      };
      healthy.push(row);
      controls.push({
        id: pose.id,
        loo: fit.residual.maxCells,
        ctl2: shifted2.residual.maxCells,
        ctl05: shifted05.residual.maxCells,
      });
      assert.equal(fit.ok, true, pose.id + ' ok');
      assert.equal(shifted2.ok, true, pose.id + ' 2셀도 ok');
      assert.ok(fit.residual.maxCells <= 0.15, pose.id + ' LOO ' + fit.residual.maxCells);
      assert.ok(
        fit.residual.inSampleMaxCells <= 0.08,
        pose.id + ' in-sample ' + fit.residual.inSampleMaxCells,
      );
      assert.ok(
        fit.residual.maxCells < shifted2.residual.maxCells,
        pose.id + ' LOO < 2셀 대조군',
      );
      assert.ok(shifted2.residual.maxCells >= 1.5, pose.id + ' 2셀 ≥1.5');
      assert.ok(shifted05.residual.maxCells >= 0.3, pose.id + ' 0.5셀 ≥0.3');
      assert.equal(oracle.ok, true, pose.id + ' oracle ok');
      assert.ok(row.paramDeltaYaw < 1e-3, pose.id + ' blind/oracle yaw');
      assert.ok(row.paramDeltaPitch < 1e-3, pose.id + ' blind/oracle pitch');
    }
    const healthyMax = Math.max(...healthy.map((r) => r.loo));
    const control2Min = Math.min(...controls.map((r) => r.ctl2));
    const control05Min = Math.min(...controls.map((r) => r.ctl05));
    const gap2 = control2Min - healthyMax;
    const gap05 = control05Min - healthyMax;
    console.log('DETECTED_HEALTHY', JSON.stringify(healthy));
    console.log('DETECTED_CONTROLS', JSON.stringify({
      healthyMax, control2Min, control05Min, gap2, gap05, controls,
    }));
    assert.ok(gap2 > 0, '정상 최대 LOO 와 2셀 대조군 최소 사이에 간격이 있어야 한다');
  });
});

describe('포락 밖 · roll 식별 (가설 H2 · H3)', () => {
  test('참 앵커에서 포락 밖·비영 roll 의 거동을 기록한다', () => {
    const rows = [];
    for (const pose of ENVELOPE_POSES) {
      const geom = geometryOfPose(pose);
      const obs = observationsFromExpected(expectedAnchors(geom));
      const truth = truthParamsOf(geom);
      const started = performance.now();
      const blind = estimateCubePose(obs, poseOptions(geom));
      const oracle = estimateCubePose(obs, poseOptions(geom, truth));
      const ms = performance.now() - started;
      rows.push({
        id: pose.id,
        blindOk: blind.ok,
        blindReason: blind.reason,
        blindConverged: blind.converged,
        blindIn: blind.residual.inSampleMaxCells,
        blindLoo: blind.residual.maxCells,
        blindRoll: blind.params && blind.params.roll,
        oracleOk: oracle.ok,
        oracleIn: oracle.residual.inSampleMaxCells,
        oracleLoo: oracle.residual.maxCells,
        oracleRoll: oracle.params && oracle.params.roll,
        truthRoll: truth.roll,
        rollErrBlind: blind.params ? Math.abs(blind.params.roll - truth.roll) : null,
        yawErrBlind: blind.params ? Math.abs(blind.params.yaw - truth.yaw) : null,
        pitchErrBlind: blind.params ? Math.abs(blind.params.pitch - truth.pitch) : null,
        iterations: blind.iterations,
        ms: Number(ms.toFixed(3)),
      });
    }
    console.log('ENVELOPE_AND_ROLL', JSON.stringify(rows));
    for (const row of rows) {
      assert.ok(
        row.blindIn <= 1e-6,
        row.id + ' blind in-sample ' + row.blindIn,
      );
    }
    const rollRow = rows.find((r) => r.id === 'roll-2deg');
    assert.ok(rollRow);
    // 식별이 약해도 제거하지 않는다. 전방식이 맞으면 oracle 잔차는 0 이어야 한다.
    assert.equal(rollRow.oracleOk, true);
    assert.ok(rollRow.oracleIn <= 1e-6);
    assert.ok(rollRow.rollErrBlind <= 1e-9, 'roll 회복 ' + rollRow.rollErrBlind);
  });
});

describe('축퇴 (roll, ppu)', () => {
  test('180° 렌더 참 앵커는 roll≈0 · ppu<0 으로 완벽 적합한다', () => {
    const pose = {
      id: 'roll-180',
      perspective: 0.1,
      yawDegrees: 0,
      pitchDegrees: 0,
      rollDegrees: 180,
    };
    const geom = geometryOfPose(pose);
    const obs = observationsFromExpected(expectedAnchors(geom));
    const blind = estimateCubePose(obs, poseOptions(geom));
    console.log('ROLL_PI_DEGENERACY', JSON.stringify({
      ok: blind.ok,
      converged: blind.converged,
      roll: blind.params && blind.params.roll,
      ppu: blind.params && blind.params.ppu,
      offX: blind.params && blind.params.offX,
      offY: blind.params && blind.params.offY,
      inSample: blind.residual.inSampleMaxCells,
      loo: blind.residual.maxCells,
      truthRoll: geom.roll,
      truthPpu: geom.pixelsPerUnit,
    }));
    assert.equal(blind.ok, true);
    assert.ok(blind.params.ppu < 0, 'ppu < 0, got ' + blind.params.ppu);
    assert.ok(
      Math.abs(blind.params.roll) <= 1e-9,
      'roll ≈ 0, got ' + blind.params.roll,
    );
    assert.ok(
      blind.residual.inSampleMaxCells <= 1e-6,
      'in-sample ' + blind.residual.inSampleMaxCells,
    );
  });
});

describe('비수렴', () => {
  test('maxIter:1 은 did-not-converge 이고 params 는 남긴다', () => {
    const geom = geometryOfPose(NORMAL_POSES[0]);
    const obs = observationsFromExpected(expectedAnchors(geom));
    const result = estimateCubePose(obs, { ...poseOptions(geom), maxIter: 1 });
    console.log('DID_NOT_CONVERGE', JSON.stringify({
      ok: result.ok,
      reason: result.reason,
      converged: result.converged,
      paramsNull: result.params === null,
      iterations: result.iterations,
      inSample: result.residual.inSampleMaxCells,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'did-not-converge');
    assert.ok(result.params !== null);
  });
});
