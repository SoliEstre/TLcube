/**
 * observed-finder-paths.test.js — 관측 축 복원 (F-30 · F-64 · F-65, 2026-08-23).
 *
 * F-30: compact `finderPatternId` 가 큐브 실루엣·블록·로케이터 **성공**에서 null 이라
 * 텔레메트리 observed_finder 가 공란이었다 — 「안 쟀다(옛 빌드)」와 구별 불능.
 * F-64: 셀 표면 성공 프레임(Type Y 기본 경로 포함)도 같은 축으로 공란.
 * 원인 위치는 frontend.js 의 compact 층(finderPatternIdOf)이다 — 검출기는
 * `hypothesis.source` 에 경로 id 를 이미 남기고 있었는데 compact 가 안 읽었다
 * (프로브 실측 2026-08-23: 실루엣 성공 source='cube-silhouette-y-junction',
 * CS v0 성공 source='locator-cell-surface-v0', 둘 다 finderPatternId null).
 *
 * F-65: 외곽 사괘(daehan)의 patternId(`oak-daehan-k*`)가 **중앙 열**(observed_finder)로
 * 새고 있었다 — 관측 외곽(observed.outerFinderId)으로 옮긴다. k 는 포함 사슬이라
 * 검출이 못 가르므로 관측도 축 키 'daehan' 까지만 말한다.
 *
 * 아래 성공-경로 단언들은 수리 전 코드에서 전부 빨강이다 (finderPatternId null).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import { CENTRAL_V0_SOURCE_N, versionForFinalN } from '../src/cellSurfaceFinal.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { makeEnvelope, normalizeFrameBody, observedFromResult } from '../src/lab-telemetry.js';
import { eventRow, parseEnvelope } from '../relay/protocol.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PAYLOAD = 'https://tl.estre.so';

function renderY(options, sceneOptions = {}) {
  const encoded = encodeY(PAYLOAD, { eccLevel: 'M', ...options });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16, ...sceneOptions });
  return rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
}

/** 성공 결과의 관측 파인더가 relay 행(observed_finder)까지 실리는지 끝단 확인. */
function observedFinderRow(result) {
  const body = normalizeFrameBody({
    seq: 1, w: 10, h: 10, ok: true, reason: '',
    observed: observedFromResult(result),
  });
  const parsed = parseEnvelope(JSON.stringify(makeEnvelope('s', 'scan', 'frame', body)));
  assert.equal(parsed.ok, true, parsed.error);
  return eventRow(parsed.event);
}

test('F-30: 큐브 실루엣 성공이 검출 경로 id 를 observed_finder 로 남긴다', {
  timeout: 120_000,
}, () => {
  const result = decodeFrontend(renderY({ version: 1, tones: 2 }));
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.hypothesis.source, 'cube-silhouette-y-junction',
    '전제가 바뀌었다 — 이 픽스처는 실루엣 경로로 잡혀야 한다: ' + result.hypothesis.source);
  assert.equal(result.hypothesis.finderPatternId, 'cube-silhouette-y-junction',
    '실루엣 성공의 compact finderPatternId 가 비었다 — observed_finder 공란 (F-30)');
  const row = observedFinderRow(result);
  assert.equal(row.observed_finder, 'cube-silhouette-y-junction');
});

test('F-64: 셀 표면 성공(정식 기본 경로) v0·v0t 가 observed_finder 를 채운다', {
  timeout: 240_000,
}, () => {
  const cases = [
    [{ cellSurfaceLayout: 'v0', version: versionForFinalN(CENTRAL_V0_SOURCE_N), tones: 2 }, 'v0'],
    [{ cellSurfaceLayout: 'v0t', version: 1, tones: 2 }, 'v0t'],
  ];
  for (const [options, layout] of cases) {
    // 정식 경로: decodeFrontend 옵션 없음 — 셀 표면 검출은 디코더 기본값이 켜짐.
    const result = decodeFrontend(renderY(options));
    assert.equal(result.ok, true, layout + ': ' + result.reason);
    assert.equal(result.hypothesis.cellSurface, true, layout + ' 가 CS 로 안 읽혔다');
    assert.equal(result.hypothesis.finderPatternId, 'locator-cell-surface-' + layout,
      layout + ' 성공의 compact finderPatternId 가 비었다 (F-64)');
    assert.equal(observedFinderRow(result).observed_finder, 'locator-cell-surface-' + layout);
  }
});

test('F-64: 셀 표면 v1 A팔(lab 로케이터 경로)도 같은 축으로 채워진다', {
  timeout: 120_000,
}, () => {
  const raster = renderY(
    { version: 1, tones: 2, cellSurface: true, locatorArm: 'A' },
    { margin: 20, locatorProfile: 'cell-surface-v1' },
  );
  const result = decodeFrontend(raster, {
    bootstrap: {
      family: {
        cube: { enableLocatorY: true, enableCellSurfaceY: true, enableLegacyCellSurfaceV1: true },
      },
    },
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.hypothesis.finderPatternId, 'locator-cell-surface-v1');
});

test('무회귀 — 파인더 경로의 이름은 한 값도 안 바뀐다 (bullseye · central-v0)', {
  timeout: 120_000,
}, () => {
  // 중앙 비컨 바깥 코드: finder.patternId = 'central-v0' 경로 (수리 전에도 찼다).
  const encoded = encode(PAYLOAD, { version: 2, eccLevel: 'M', centralV0: true });
  const scene = buildScene(encoded, {
    palette: PALETTE, finderPatternId: CENTRAL_V0_FINDER_PATTERN_ID,
  });
  const beacon = decodeFrontend(rasterize(scene, { pixelsPerUnit: 12, supersample: 1 }));
  assert.equal(beacon.ok, true, beacon.reason);
  assert.equal(beacon.hypothesis.finderPatternId, 'central-v0');

  // Type O 불스아이: innerBandsReplaced 경로 (수리 전에도 찼다).
  const plain = decodeFrontend(rasterize(
    buildScene(encode('bullseye-keep', { version: 2, eccLevel: 'M' }), { palette: PALETTE }),
    { pixelsPerUnit: 12, supersample: 1 },
  ));
  assert.equal(plain.ok, true, plain.reason);
  assert.ok(plain.hypothesis.finderPatternId === 'bullseye'
    || plain.hypothesis.finderPatternId === 'cube-bullseye',
  '불스아이 이름이 바뀌었다: ' + plain.hypothesis.finderPatternId);
});

test('F-65: oak-daehan-k* 관측은 중앙 열이 아니라 외곽 열(daehan)로 간다', () => {
  // 합성 가설 모양 — cellFinderHypotheses 가 daehan 검출에 남기는 형태와 같다
  // (finder.patternId = 와이어 id `oak-daehan-k*`).
  const result = {
    ok: true,
    family: 'hex',
    version: 2,
    eccLevel: 'M',
    tones: 3,
    hypothesis: { finderPatternId: 'oak-daehan-k8', source: 'cell-finder' },
  };
  const observed = observedFromResult(result);
  assert.equal(observed.outerFinderId, 'daehan',
    '외곽 관측 열이 비었다 — expected_outer ↔ observed 조인이 원리적으로 불가 (F-65)');
  assert.equal(observed.finderPatternId, null,
    'daehan 이 여전히 중앙 열로 샌다 — 중앙 파인더 순위표를 오염시킨다');
  // 정규화·와이어에서도 산다 (ClickHouse observed_outer_finder 컬럼은 통합자 ALTER 몫 —
  // 그 전까지는 body JSON 에만 남는다).
  const body = normalizeFrameBody({
    seq: 1, w: 10, h: 10, ok: true, reason: '', observed,
  });
  assert.equal(body.observed.outerFinderId, 'daehan');
  const parsed = parseEnvelope(JSON.stringify(makeEnvelope('s', 'scan', 'frame', body)));
  assert.equal(parsed.ok, true, parsed.error);

  // 비-daehan 파인더는 종전대로 중앙 열이다.
  const central = observedFromResult({
    ok: true, family: 'hex', hypothesis: { finderPatternId: 'oak-benzene' },
  });
  assert.equal(central.finderPatternId, 'oak-benzene');
  assert.equal(central.outerFinderId, null);
});
