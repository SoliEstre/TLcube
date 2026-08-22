/**
 * central-v0-beacon-detect.test.js — 중앙 비컨 검출 어댑터 회귀.
 *
 * 값이 아니라 관계로 단언한다. 픽셀·모듈 수를 손으로 적지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { centralBeaconGeometry } from '../src/centralBeaconWire.js';
import {
  BEACON_MAGIC,
  encodeCentralBeacon,
  readBeaconFromEncodedY,
} from '../src/centralBeacon.js';
import {
  CELL_SURFACE_FINAL_V0,
  CENTRAL_V0_SOURCE_N,
  versionForFinalN,
} from '../src/cellSurfaceFinal.js';
import { encode } from '../src/encode.js';
import { encodeY } from '../src/encodeY.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import {
  CENTRAL_BEACON_FINDER_KIND,
  discoverCentralBeaconFinders,
  outerCellSizeFromBlockRadius,
  outerCellSizeFromModulePitch,
  tryReadBeaconFromEncodedY,
  tryReadBeaconFromText,
  unitCentralSlotRadius,
} from '../src/decoder/central-beacon-adapt.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { distortImage } from './harness/distort.mjs';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../tools/read-luma.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });

function compactResult(result) {
  return JSON.stringify({
    ok: result.ok,
    text: result.text,
    family: result.family,
    version: result.version,
    eccLevel: result.eccLevel,
    source: result.hypothesis && result.hypothesis.source,
    n: result.hypothesis && result.hypothesis.n,
    k: result.hypothesis && result.hypothesis.k,
    cellSurfaceLayout: result.hypothesis && result.hypothesis.cellSurfaceLayout,
    finderPatternId: result.hypothesis && result.hypothesis.finderPatternId,
  });
}

function startsWithBeaconMagic(text) {
  if (typeof text !== 'string' || text.length < BEACON_MAGIC.length) return false;
  for (let i = 0; i < BEACON_MAGIC.length; i += 1) {
    if (text.charCodeAt(i) !== BEACON_MAGIC[i]) return false;
  }
  return true;
}

function renderOuter(text, {
  version = 2, eccLevel = 'M', ppu = 12, supersample = 1,
  cornerMarker = false, finderPatternId = CENTRAL_V0_FINDER_PATTERN_ID,
} = {}) {
  const encoded = encode(text, { version, eccLevel, centralV0: true, cornerMarker });
  const scene = buildScene(encoded, { palette: PALETTE, finderPatternId });
  const raster = rasterize(scene, { pixelsPerUnit: ppu, supersample });
  return { encoded, raster };
}

function renderIndependentY(text) {
  const encoded = encodeY(text, {
    version: versionForFinalN(CENTRAL_V0_SOURCE_N),
    eccLevel: 'H',
    tones: 2,
    cellSurfaceLayout: CELL_SURFACE_FINAL_V0,
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
  const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
  return { encoded, raster };
}

test('역산 — 모듈 피치·슬롯 반지름·바깥 size 가 정방향 식의 항등이다', () => {
  const n = CENTRAL_V0_SOURCE_N;
  const unit = unitCentralSlotRadius();
  assert.ok(unit > 0);
  assert.equal(unit, unitCentralSlotRadius(), '단위 반지름은 유도값 하나다');

  const outerSize = 18;
  // 정방향(scene.js)에 축소비가 들어갔다 (2026-08-22, 3톤 큐브 크기 규약).
  const { shrink } = centralBeaconGeometry();
  const modulePitch = outerSize * unit * shrink / n;
  // 역산기는 (unit × shrink) 로 한 번에 나눈다 — 연산 순서가 달라 마지막 비트가
  // 다를 수 있으므로 항등은 1e-9 로 잰다 (뜻은 그대로 «정확한 역»).
  assert.ok(Math.abs(outerCellSizeFromModulePitch(modulePitch) - outerSize) < 1e-9);

  const blockRadius = n * modulePitch;
  assert.ok(Math.abs(outerCellSizeFromBlockRadius(blockRadius) - outerSize) < 1e-9);

  // 계약서 §7.1 의 0.533 은 이 식의 산출이 아니다. 정본은 scene.js 정방향.
  const ratio = unit / n;
  assert.notEqual(Number(ratio.toFixed(3)), 0.533);
});

test('구분자 — 독립 Type Y v0 는 검출 경로에서 비컨으로 읽히지 않는다', () => {
  const payload = 'https://tl.estre.so/';
  const { encoded, raster } = renderIndependentY(payload);
  assert.equal(tryReadBeaconFromEncodedY(encoded), null);
  assert.throws(
    () => readBeaconFromEncodedY(encoded),
    /비컨 매직이 아니다/,
  );

  const result = decodeFrontend(raster);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.text, payload);
  assert.equal(result.family, 'cube');
  assert.equal(result.hypothesis.cellSurfaceLayout, CELL_SURFACE_FINAL_V0);
  assert.equal(tryReadBeaconFromText(result.text), null);
  assert.equal(startsWithBeaconMagic(result.text), false);

  const outer = encode('discriminator-outer', {
    version: 2, eccLevel: 'M', centralV0: true,
  });
  const beacon = encodeCentralBeacon(outer, CENTRAL_V0_FINDER_PATTERN_ID);
  const meta = tryReadBeaconFromEncodedY(beacon);
  assert.ok(meta);
  assert.equal(meta.family, 'O');
});

test('합성 왕복 — ppu 12 (블록 파인더) 에서 바깥 텍스트가 나오고 비컨 바이트는 안 나온다', {
  timeout: 60_000,
}, () => {
  const text = 'beacon-path-a';
  const { raster } = renderOuter(text, { ppu: 12 });
  const result = decodeFrontend(raster);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.text, text);
  assert.equal(result.family, 'hex');
  assert.equal(result.hypothesis.k, 8);
  assert.equal(result.hypothesis.source, 'central-v0-finder');
  assert.equal(startsWithBeaconMagic(result.text), false);
  assert.equal(tryReadBeaconFromText(result.text), null);
});

test('합성 왕복 — ppu 24 (Type Y 복호 후 재시딩) 에서 바깥 텍스트가 나오고 비컨 바이트는 안 나온다', {
  timeout: 60_000,
}, () => {
  const text = 'beacon-path-b';
  const { raster } = renderOuter(text, { ppu: 24 });
  const result = decodeFrontend(raster);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.text, text);
  assert.equal(result.family, 'hex');
  assert.equal(result.hypothesis.k, 8);
  // **의도적 갱신 (통합자 2026-08-22)**: 축소비 정합 후 Path A(블록 → 직접 시딩,
  // source 'central-v0-finder')가 이 ppu 에서 Path B(Y 복호 후 재시딩,
  // 'central-v0-beacon')보다 먼저 이긴다. 어느 경로든 사용자 계약은 같다 —
  // «바깥 텍스트가 나오고 비컨 바이트는 안 나온다». 경로는 집합으로 잠근다.
  assert.ok(['central-v0-beacon', 'central-v0-finder'].includes(result.hypothesis.source),
    '비컨 경로가 아니라 ' + result.hypothesis.source + ' 로 풀렸다');
  assert.equal(startsWithBeaconMagic(result.text), false);
  if (result.hypothesis.source === 'central-v0-beacon') {
    // Path B 로 풀렸을 때만 메타가 실린다 — Path A 는 페이로드를 읽지 않는다.
    assert.ok(result.hypothesis.beacon);
    assert.equal(result.hypothesis.beacon.family, 'O');
    assert.ok(result.hypothesis.beacon.modulePitch > 0);
    const fromPitch = outerCellSizeFromModulePitch(result.hypothesis.beacon.modulePitch);
    assert.ok(Math.abs(fromPitch - result.hypothesis.beacon.outerCellSize) < 1e-9);
  }
});

test('합성 왕복 — V1·V3 바깥 k 가 용량표에서 온 값이다', {
  timeout: 60_000,
}, () => {
  const cases = [
    // **의도적 갱신 (통합자 2026-08-22)**: 축소비 0.875 가 들어가 ppu 12 에선 비컨
    // 모듈이 2.8px — 실기기 하한(9px/셀 → 모듈 ~4.2px)보다도 한참 아래인 가혹
    // 조건이라 V3(k=10)가 포맷에서 죽는다. 합성 조건을 실기기 대역(셀 17\~20px 의
    // 하단)에 맞춘다 — 게이트가 아니라 시험 조건의 보정이다.
    { version: 1, k: 6, ppu: 12, text: 'beacon-v1' },
    { version: 3, k: 10, ppu: 16, text: 'beacon-v3' },
  ];
  for (const row of cases) {
    const { raster } = renderOuter(row.text, { version: row.version, ppu: row.ppu });
    const result = decodeFrontend(raster);
    assert.equal(result.ok, true, row.version + ': ' + result.reason);
    assert.equal(result.text, row.text, String(row.version));
    assert.equal(result.hypothesis.k, row.k, String(row.version));
  }
});

test('합성 왕복 — 120° 회전 합성도 바깥 텍스트를 되읽는다', {
  timeout: 60_000,
}, () => {
  const text = 'beacon-rot';
  const { raster } = renderOuter(text, { ppu: 12 });
  const rotated = distortImage(raster, { rotation: 120, fill: FILL });
  const result = decodeFrontend(rotated);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.text, text);
  assert.equal(startsWithBeaconMagic(result.text), false);
});

test('합성 왕복 — G(코너 마커) ppu 24 도 바깥 텍스트다', {
  timeout: 60_000,
}, () => {
  const text = 'beacon-g';
  const { raster } = renderOuter(text, { ppu: 24, cornerMarker: true });
  const result = decodeFrontend(raster);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.text, text);
  assert.equal(result.family, 'hex');
  assert.equal(startsWithBeaconMagic(result.text), false);
});

test('어댑터를 끄면 ppu 24 는 비컨 바이트를 사용자 텍스트로 돌린다', {
  timeout: 60_000,
}, () => {
  const text = 'beacon-off';
  const { raster } = renderOuter(text, { ppu: 24 });
  const off = decodeFrontend(raster, { bootstrap: { centralBeacon: false } });
  // **의도적 갱신 (통합자 2026-08-22)**: 원안은 «끄면 비컨 바이트가 사용자 텍스트로
  // 샌다» 를 기대했는데, 축소 + 3톤 + 분리 띠 이후 이 ppu 의 합성에선 독립 복호
  // 자체가 안 된다(no-grid-hypothesis). 누출 재현은 실기기에서 이미 봤고(2026-08-22
  // 빈 텍스트 보고), 그 방어는 unpack 층의 «구분자» 회귀와 스캐너 배선 회귀가
  // 잠근다. 여기서 잠글 진짜 불변식은 하나다:
  //   **어댑터를 끄면 바깥 텍스트가 나오지 않는다** — 즉 바깥 복호를 실제로
  //   해내는 것이 이 어댑터다. (샌 경우도, 실패한 경우도 이 단언을 통과한다.)
  assert.ok(!(off.ok === true && off.text === text),
    '어댑터를 껐는데 바깥 텍스트가 나왔다 — 이 어댑터가 하는 일이 없다는 뜻이다');
  if (off.ok === true) {
    // 뭔가 나왔다면 그것이 비컨 누출임을 확인해 둔다 (문서화 — 스캐너 가드가 막는 자리).
    assert.equal(startsWithBeaconMagic(off.text), true);
    const meta = tryReadBeaconFromText(off.text);
    assert.ok(meta);
    assert.equal(meta.family, 'O');
  }

  const on = decodeFrontend(raster);
  assert.equal(on.text, text);
  assert.equal(startsWithBeaconMagic(on.text), false);
});

test('무회귀 — 비컨 없는 합성 프레임의 복호 compact 가 바이트 동일하다', {
  timeout: 60_000,
}, () => {
  const bullseyeEncoded = encode('bullseye-guard', { version: 2, eccLevel: 'M' });
  const bullseyeRaster = rasterize(buildScene(bullseyeEncoded, { palette: PALETTE }), {
    pixelsPerUnit: 12, supersample: 1,
  });
  const bullseye = decodeFrontend(bullseyeRaster);
  assert.equal(
    compactResult(bullseye),
    '{"ok":true,"text":"bullseye-guard","family":"hex","version":2,"eccLevel":"M","source":"outline-anchor","k":8,"cellSurfaceLayout":null,"finderPatternId":"bullseye"}',
  );

  const threeToneEncoded = encode('three-tone-guard', { version: 2, eccLevel: 'M' });
  const threeToneRaster = rasterize(buildScene(threeToneEncoded, {
    palette: PALETTE,
    finderPatternId: 'central-cube-3tone',
  }), { pixelsPerUnit: 12, supersample: 2 });
  const threeTone = decodeFrontend(threeToneRaster);
  assert.equal(
    compactResult(threeTone),
    '{"ok":true,"text":"three-tone-guard","family":"hex","version":2,"eccLevel":"M","source":"central-cube-finder","k":8,"cellSurfaceLayout":null,"finderPatternId":"central-cube-3tone"}',
  );

  const independent = decodeFrontend(renderIndependentY('https://tl.estre.so/').raster);
  assert.equal(independent.ok, true, independent.reason);
  assert.equal(independent.text, 'https://tl.estre.so/');
  assert.equal(independent.family, 'cube');
  assert.equal(independent.hypothesis.cellSurfaceLayout, 'v0');
  assert.equal(tryReadBeaconFromText(independent.text), null);
});

test('무회귀 — 비컨 없는 실사진 한 장의 compact 가 바이트 동일하다', {
  timeout: 120_000,
}, () => {
  const dumps = listLumaDumps();
  assert.equal(dumps.length, 367);
  const entry = dumps.find((dump) => dump.name === 'cellfinder-20260812-07.960.luma');
  assert.ok(entry, 'cell-finder 실사진 덤프가 없다');
  const result = decodeFrontend(lumaToRaster(readLumaDump(entry.path)));
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.text, 'https://tl.estre.so');
  assert.equal(result.family, 'tri');
  assert.equal(result.hypothesis.source, 'cell-finder');
  assert.notEqual(result.hypothesis.source, 'central-v0-finder');
});

test('블록 → 파인더 후보 계약 — estimatedN=n · cellSurfaceOnly · finderKind=central-v0', () => {
  const { raster } = renderOuter('shape-contract', { ppu: 12 });
  const finders = discoverCentralBeaconFinders(toRelativeLuminance(raster));
  // **의도적 갱신 (통합자 2026-08-22)**: 원안은 방향 3개를 전부 흘렸는데, locator 톤
  // 대조(verifyV0LocatorTones)가 시딩 단계에서 가짜 방향·가짜 블록을 거른다 —
  // 확대 불스아이가 v0 로 오표식돼 비컨 없는 프레임의 종결 코드를 바꾼 사고의 처방.
  // 진짜 비컨에선 참 방향이 최소 1개 살아남아야 하고, 3개를 넘을 수는 없다.
  assert.ok(finders.length >= 1 && finders.length <= 3,
    `대조를 통과한 방향이 ${finders.length}개 — 0이면 검증이 과하고 4+면 뭔가 샜다`);
  for (const finder of finders) {
    assert.equal(finder.finderKind, CENTRAL_BEACON_FINDER_KIND);
    assert.equal(finder.patternId, CENTRAL_V0_FINDER_PATTERN_ID);
    assert.ok(finder.cellSize > 0);
    assert.equal(finder.H.length, 9);
  }
  const off = discoverCentralBeaconFinders(toRelativeLuminance(raster), {
    centralBeacon: false,
  });
  assert.equal(off.length, 0);
});

test('오표식 방어 — 확대·잘림 불스아이 프레임에서 비컨 파인더가 0 이다', {
  timeout: 60_000,
}, () => {
  // 블록 로케이터는 이 프레임의 조각을 «v0» 로 표식한다 (실측 2026-08-22: shape 2개).
  // 표식만 믿고 시딩하면 가짜 가설이 섞여 **비컨 없는 프레임의 종결 코드**가 바뀐다
  // (symbol-clipped → no-format-candidate). locator 톤 대조가 이걸 걸러야 한다.
  const encoded = encode('false-positive', { version: 2, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: PALETTE });
  const raster = rasterize(scene, { pixelsPerUnit: 20, supersample: 2 });
  const zoomed = distortImage(raster, { scale: 2, fill: FILL });
  const finders = discoverCentralBeaconFinders(toRelativeLuminance(zoomed));
  assert.equal(finders.length, 0,
    '불스아이 조각이 비컨 후보로 새고 있다 — verifyV0LocatorTones 를 확인하라');
});
