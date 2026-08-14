/**
 * cellSurfaceY-ab.test.js — 셀 표면 로케이터 A/B 팔.
 *
 * A = 구 대칭 (T=L, R 3셀만 비대칭). B = 신 비대칭 (T 15셀 플립).
 * 디코더는 둘 다 시도하고 점수 높은 쪽을 택한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  UNVERIFIED_CELL_SURFACE_Y,
  scoreCellSurfaceSamples,
} from '../src/decoder/cellSurfaceY-detect.js';
import {
  CELL_SURFACE_ARM_A,
  CELL_SURFACE_ARM_B,
  locatorCellsCellSurface,
} from '../src/cellSurfaceY.js';
import {
  extractCellSurfaceProbe,
  makeEnvelope,
  normalizeFrameBody,
  normalizeGenBody,
  observedFromResult,
} from '../src/lab-telemetry.js';
import { parseEnvelope } from '../relay/protocol.mjs';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { distortImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PAYLOAD = 'https://tl.estre.so';

function renderSurface(arm, tones, { pixelsPerUnit = 10, margin = 20 } = {}) {
  const encoded = encodeY(PAYLOAD, {
    version: 1, tones, eccLevel: 'M', cellSurface: true, locatorArm: arm,
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE,
    margin,
    locatorProfile: 'cell-surface-v1',
  });
  return { encoded, scene, raster: rasterize(scene, { pixelsPerUnit, supersample: 2 }) };
}

function decodeLab(raster) {
  return decodeFrontend(raster, {
    bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
  });
}

function idealSamples(arm, cycle = ['T', 'L', 'R']) {
  return locatorCellsCellSurface(arm).map((cell) => ({
    i: cell.i,
    j: cell.j,
    ok: true,
    T: { median: cell[cycle[0]] === 0 ? 0.08 : 0.82 },
    L: { median: cell[cycle[1]] === 0 ? 0.08 : 0.82 },
    R: { median: cell[cycle[2]] === 0 ? 0.08 : 0.82 },
  }));
}

test('A 팔은 방향 게이트를 면제하고 그 사실을 남긴다', () => {
  const scored = scoreCellSurfaceSamples(idealSamples('A'), { locatorArm: 'A' });
  assert.equal(scored.ok, true);
  assert.equal(scored.accepted, true);
  assert.equal(scored.arm, 'A');
  assert.equal(scored.orientationGate, 'waived');
  assert.equal(scored.orientationGateApplied, false);
  assert.equal(scored.diagnostics.orientationGate, 'waived');
  assert.ok(scored.orientationMargin < UNVERIFIED_CELL_SURFACE_Y.minimumOrientationMargin);
});

test('B 팔은 방향 게이트를 적용하고 오방향을 거부한다', () => {
  const right = scoreCellSurfaceSamples(idealSamples('B'), { locatorArm: 'B' });
  assert.equal(right.accepted, true);
  assert.equal(right.orientationGate, 'applied');
  assert.equal(right.orientationGateApplied, true);
  const wrong = scoreCellSurfaceSamples(idealSamples('B', ['L', 'R', 'T']), { locatorArm: 'B' });
  assert.equal(wrong.accepted, false);
  assert.equal(wrong.diagnostics.rejectReason, 'orientation-margin');
});

test('이중 시도 — B 표본은 B 를 고르고 A 도 맞으면 모호함을 남긴다', () => {
  const scored = scoreCellSurfaceSamples(idealSamples('B'));
  assert.equal(scored.ok, true);
  assert.equal(scored.accepted, true);
  assert.equal(scored.arm, 'B');
  assert.equal(scored.profile, 'cell-surface-v1-B');
  assert.equal(scored.diagnostics.arms.B.accepted, true);
  if (scored.diagnostics.arms.A && scored.diagnostics.arms.A.accepted) {
    assert.equal(scored.ambiguous, true);
    assert.ok(scored.best.agreement >= scored.diagnostics.arms.A.agreement);
  }
});

test('이중 시도 — A 표본은 A 를 고른다', () => {
  const scored = scoreCellSurfaceSamples(idealSamples('A'));
  assert.equal(scored.ok, true);
  assert.equal(scored.accepted, true);
  assert.equal(scored.arm, 'A');
  assert.equal(scored.profile, 'cell-surface-v1-A');
  assert.equal(scored.orientationGate, 'waived');
});

test('A/B 합성 왕복 0° — 관측 팔이 생성 팔과 같다', {
  timeout: 120_000,
}, () => {
  for (const arm of [CELL_SURFACE_ARM_A, CELL_SURFACE_ARM_B]) {
    for (const tones of [2, 3]) {
      const fixture = renderSurface(arm, tones);
      const result = decodeLab(fixture.raster);
      assert.equal(result.ok, true, JSON.stringify({
        arm, tones, reason: result.reason,
      }));
      assert.equal(result.text, PAYLOAD);
      assert.equal(result.hypothesis.locatorArm, arm, `generated ${arm} read as ${result.hypothesis.locatorArm}`);
      assert.equal(result.hypothesis.locatorProfile, 'cell-surface-v1');
      const observed = observedFromResult(result);
      assert.equal(observed.locatorArm, arm);
      const probe = extractCellSurfaceProbe(result);
      assert.equal(probe.attempted, true);
      assert.equal(probe.accepted, true);
      assert.equal(probe.arm, arm);
      assert.equal(probe.profile, 'cell-surface-v1-' + arm);
      assert.equal(probe.orientationGate, arm === 'A' ? 'waived' : 'applied');
    }
  }
});

test('교차 오수용 — A 생성물이 B 로 읽히거나 그 반대가 0° 합성에서 일어나는지', {
  timeout: 120_000,
}, () => {
  const rows = [];
  for (const arm of [CELL_SURFACE_ARM_A, CELL_SURFACE_ARM_B]) {
    for (const tones of [2, 3]) {
      const fixture = renderSurface(arm, tones);
      const result = decodeLab(fixture.raster);
      const observed = result.hypothesis && result.hypothesis.locatorArm;
      rows.push({
        generated: arm,
        tones,
        ok: result.ok === true && result.text === PAYLOAD,
        observed,
        cross: observed && observed !== arm,
      });
    }
  }
  const crosses = rows.filter((row) => row.cross);
  assert.equal(
    crosses.length,
    0,
    '0° 합성에서 교차 오수용: ' + JSON.stringify(crosses),
  );
  for (const row of rows) {
    assert.equal(row.ok, true, JSON.stringify(row));
    assert.equal(row.observed, row.generated);
  }
});

test('A/B 회전 카나리아 — ppu 10 · 2톤 · 0/90/180/270', {
  timeout: 180_000,
}, () => {
  for (const arm of [CELL_SURFACE_ARM_A, CELL_SURFACE_ARM_B]) {
    const fixture = renderSurface(arm, 2, { pixelsPerUnit: 10, margin: 20 });
    for (const degrees of [0, 90, 180, 270]) {
      const rotated = degrees === 0
        ? fixture.raster
        : distortImage(fixture.raster, { rotation: degrees, fill: FILL });
      const result = decodeLab(rotated);
      assert.equal(
        result.ok === true && result.text === PAYLOAD,
        true,
        JSON.stringify({ arm, degrees, reason: result.reason, observed: result.hypothesis && result.hypothesis.locatorArm }),
      );
      assert.equal(result.hypothesis.locatorArm, arm);
    }
  }
});

test('gen·frame 텔레메트리에 기대/관측 팔이 남는다', () => {
  const gen = normalizeGenBody({
    type: 'Y', version: 1, tones: 2, locatorProfile: 'cell-surface-v1', locatorArm: 'A',
  });
  assert.equal(gen.locatorArm, 'A');
  const parsedGen = parseEnvelope(JSON.stringify(makeEnvelope('s', 'gen', 'gen', gen)));
  assert.equal(parsedGen.ok, true, parsedGen.error);
  assert.equal(parsedGen.event.body.locatorArm, 'A');

  const frame = normalizeFrameBody({
    seq: 1, w: 10, h: 10, ok: true, reason: '',
    expected: { locatorArm: 'A', locatorProfile: 'cell-surface-v1' },
    observed: { locatorArm: 'B', locatorProfile: 'cell-surface-v1' },
    cellSurface: {
      attempted: true,
      accepted: true,
      score: 0.9,
      profile: 'cell-surface-v1-B',
      arm: 'B',
      orientationGate: 'applied',
      orientationGateApplied: true,
      ambiguous: true,
    },
  });
  assert.equal(frame.expected.locatorArm, 'A');
  assert.equal(frame.observed.locatorArm, 'B');
  assert.equal(frame.cellSurface.arm, 'B');
  assert.equal(frame.cellSurface.expectedArm, 'A');
  assert.equal(frame.cellSurface.profile, 'cell-surface-v1-B');
  assert.equal(frame.cellSurface.orientationGate, 'applied');
  assert.equal(frame.cellSurface.ambiguous, true);
  const parsed = parseEnvelope(JSON.stringify(makeEnvelope('s', 'scan', 'frame', frame)));
  assert.equal(parsed.ok, true, parsed.error);
});
