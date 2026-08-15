/**
 * cellSurface-block-locator.test.js — CS 파인더 블록 로케이터 회귀.
 *
 * 강한 톤 시프트(감마·S-커브)에서 실루엣 hull 이 0.5셀+ 어긋나면 CS agreement 에
 * gradient 가 없어 소프트 탐침으로도 «수용»까지 못 가거나(감마 계열 전멸),
 * 수용돼도 body RS 가 실패했다(v0 S-커브, 2026-08-15 claude-acceptance.md).
 * 블록 로케이터는 마스크·실루엣 없이 파인더 블록(동심 링 서명)을 직접 찾아
 * 기하를 재정렬한다 — 이 테스트가 고정하는 것:
 *
 *   1. v0 S-커브 — CS 수용을 넘어 **body RS 복호까지** 간다 (직전 병목의 승격 기준).
 *   2. 감마 0.7 — 종전 전멸 케이스가 v0/v2r2 모두 복호된다.
 *   3. 물리 회전 120° + 감마 — 회전 슬롯과 무관하게 복호된다 (로케이터는 면 T 앵커를
 *      직접 식별해 회전을 H 에 흡수한다 — hull 꼭짓점 인덱싱 병리에 면역).
 *   4. 결정성 — 같은 프레임 두 번 → 동일 shape/진단.
 *   5. 게이트 완화 없음 — 로케이터를 끄면(csBlockLocator:false) 감마 0.7 은 종전대로
 *      실패한다 (개선이 게이트가 아니라 기하 재정렬에서 왔다는 대조군).
 *   6. 정식 경로 불변 — enableCellSurfaceY 미설정이면 로케이터는 돌지 않는다.
 *   7. (2026-08-15 밤) v1r2 패밀리 — 네 코너 블록. 회전 스윕 없이 중앙+면T 먼코너
 *      similarity 시드 → 4앵커 직접 DLT → 12 서브앵커 최소제곱. S-커브에서
 *      **body RS 복호까지** 가고 회전 슬롯 0/120/240 전수를 통과한다.
 *   8. (2026-08-16 중앙 통일) 조기 분기 — 세 패밀리 중앙이 공유 K3 라 패밀리·n 판별은
 *      2차 앵커(K5 원거리 코어)가 맡는다. n=21 에선 v2r2·v1r2 후보 포즈가 **둘 다**
 *      서는 것이 새 기대(오수용 부재는 복호 결과로 고정), v0 프레임은 앵커드 포즈 0,
 *      구 v2r2 중앙(닫힌 링 스택)은 legacy 분류만 남고 포즈 0 (소각 차단).
 *   9. (2026-08-16) v0X 패밀리 — SE 6×6 동심 사각이 **3면 동일 톤**이라 K5 원거리
 *      코어가 120° 간격 **셋** 뜬다(v1r2·v2r2 는 면 T 하나뿐). 이 «사각 링 동반자»
 *      가 반경 18.0 을 공유하는 v1r2 와 v0X 를 가르는 시딩 게이트다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { detectCellSurfaceBlockShapes } from '../src/decoder/cellsurface-block-detect.js';
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

function renderFinal(layout, version, pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

function embed960(raster) {
  const W = 960;
  const H = 960;
  const out = { width: W, height: H, pixels: new Uint8ClampedArray(W * H * 4) };
  for (let index = 0; index < W * H; index += 1) {
    out.pixels[index * 4] = FILL.r;
    out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b;
    out.pixels[index * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((H - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

function decodeLab(frame, cube = {}) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: {
      family: {
        cube: { enableLocatorY: true, enableCellSurfaceY: true, ...cube },
      },
    },
  });
}

const V0_FRAME = embed960(renderFinal('v0', 0, 17));
const V2R2_FRAME = embed960(renderFinal('v2r2', 1, 15));
const V1R2_FRAME = embed960(renderFinal('v1r2', 1, 15));
const V0X_FRAME = embed960(renderFinal('v0x', 1, 15));

test('v0 S-커브 — CS 수용을 넘어 body RS 복호까지 간다', { timeout: 300_000 }, () => {
  const frame = distortImage(V0_FRAME, { sCurve: 0.6, fill: FILL });
  const result = decodeLab(frame);
  assert.equal(result.ok, true, 'v0 S-커브 복호: ' + (result.reason || ''));
  assert.equal(result.text, PAYLOAD);
  assert.equal(result.hypothesis.cellSurfaceLayout, 'v0');
});

test('감마 0.7 — 종전 전멸 케이스가 v0/v2r2 모두 복호된다', { timeout: 300_000 }, () => {
  for (const [frame, layout] of [[V0_FRAME, 'v0'], [V2R2_FRAME, 'v2r2']]) {
    const result = decodeLab(distortImage(frame, { gamma: 0.7, fill: FILL }));
    assert.equal(result.ok, true, layout + ' 감마 0.7 복호: ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, layout);
  }
});

test('물리 회전 120° + 감마 0.7 — 회전 슬롯과 무관하게 복호된다', { timeout: 300_000 }, () => {
  for (const [frame, layout] of [[V0_FRAME, 'v0'], [V2R2_FRAME, 'v2r2']]) {
    const result = decodeLab(distortImage(frame, {
      gamma: 0.7, rotation: 120, fill: FILL,
    }));
    assert.equal(result.ok, true, layout + ' 감마+120°: ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
  }
});

test('로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출', { timeout: 300_000 }, () => {
  const frame = distortImage(V2R2_FRAME, { gamma: 0.7, fill: FILL });
  const luma = toRelativeLuminance(frame);
  const first = detectCellSurfaceBlockShapes(luma);
  const second = detectCellSurfaceBlockShapes(luma);
  assert.deepEqual(
    JSON.parse(JSON.stringify(second)),
    JSON.parse(JSON.stringify(first)),
  );
  assert.ok(first.shapes.length >= 1, '감마 0.7 v2r2 에서 shape 최소 1개');
});

test('대조군 — 로케이터를 끄면 감마 0.7 은 종전대로 실패한다 (게이트 무완화 증거)', {
  timeout: 300_000,
}, () => {
  const result = decodeLab(
    distortImage(V0_FRAME, { gamma: 0.7, fill: FILL }),
    { csBlockLocator: false },
  );
  assert.equal(result.ok, false, '로케이터 없이 감마 0.7 이 복호되면 이 테스트의 전제가 바뀐 것');
});

test('정식 경로 불변 — enableCellSurfaceY 미설정이면 로케이터가 돌지 않는다', {
  timeout: 300_000,
}, () => {
  const frame = distortImage(V0_FRAME, { sCurve: 0.6, fill: FILL });
  const result = decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {});
  // 정식 경로는 CS 를 켜지 않는다 — CS 계열로 복호되면 안 된다.
  if (result.ok) {
    assert.notEqual(result.hypothesis.cellSurface, true, '정식 경로가 CS 를 수용했다');
  }
  const diagnostics = result.ok
    ? result.diagnostics
    : (result.detail && result.detail.diagnostics);
  const text = JSON.stringify(diagnostics || {});
  assert.ok(!text.includes('cell-surface-block-locator'),
    '정식 경로 진단에 블록 로케이터 흔적이 있다');
});

// ─────────────────────────────────────────────────────────────────────────
// v1r2 패밀리 (2026-08-15 밤) — 네 코너 블록 · 회전 스윕 없음.
// ─────────────────────────────────────────────────────────────────────────

test('v1r2 S-커브 — CS 수용을 넘어 body RS 복호까지 간다', { timeout: 300_000 }, () => {
  const result = decodeLab(distortImage(V1R2_FRAME, { sCurve: 0.6, fill: FILL }));
  assert.equal(result.ok, true, 'v1r2 S-커브 복호: ' + (result.reason || ''));
  assert.equal(result.text, PAYLOAD);
  assert.equal(result.hypothesis.cellSurfaceLayout, 'v1r2');
});

test('v1r2 감마 0.7/0.6 — 두 커브 모두 복호된다', { timeout: 300_000 }, () => {
  for (const gamma of [0.7, 0.6]) {
    const result = decodeLab(distortImage(V1R2_FRAME, { gamma, fill: FILL }));
    assert.equal(result.ok, true, 'v1r2 감마 ' + gamma + ': ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v1r2');
  }
});

test('v1r2 회전 슬롯 0/120/240 전수 — 물리 회전은 H 가 흡수한다', { timeout: 600_000 }, () => {
  for (const rotation of [0, 120, 240]) {
    const result = decodeLab(distortImage(V1R2_FRAME, {
      gamma: 0.7, rotation, fill: FILL,
    }));
    assert.equal(result.ok, true, 'v1r2 rot' + rotation + ': ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v1r2');
    // 로케이터가 회전을 H 로 흡수하므로 가설 슬롯은 항상 0 이다.
    assert.equal(result.hypothesis.rotationDegrees, 0, 'v1r2 rot' + rotation + ' 슬롯');
  }
});

test('v1r2 로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출', { timeout: 300_000 }, () => {
  const luma = toRelativeLuminance(distortImage(V1R2_FRAME, { gamma: 0.7, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma);
  const second = detectCellSurfaceBlockShapes(luma);
  assert.deepEqual(
    JSON.parse(JSON.stringify(second)),
    JSON.parse(JSON.stringify(first)),
  );
  assert.ok(first.diagnostics.poseCount.v1r2 >= 1, 'v1r2 포즈 최소 1개');
  const families = first.shapes.map((shape) => shape.blockLocator.family);
  assert.ok(families.includes('v1r2'), 'v1r2 shape 가 없다: ' + families.join(','));
});

test('v1r2 패밀리를 끄면 v1r2 포즈가 사라진다 (패밀리 격리 대조군)', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V1R2_FRAME, { gamma: 0.7, fill: FILL }));
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v1r2Family: false } },
  });
  assert.equal(off.diagnostics.poseCount.v1r2, 0);
  // 의도적 갱신 (2026-08-16, 중앙 통일): v1r2 프레임의 K3 중앙 + 면T SE 코어(18셀)는
  // v2r2@21 스냅(17.5셀, ±3.2)에도 걸리므로 v2r2 **후보 포즈**가 서는 것이 정상이다.
  // 레이아웃 확정은 CS 평가 게이트가 한다 — 아래 회귀 테스트가 오수용 부재를 고정한다.
  assert.ok(off.diagnostics.poseCount.v2r2 >= 1,
    'v1r2 프레임의 공유 중앙에서 v2r2 후보 포즈가 서야 한다: '
    + JSON.stringify(off.diagnostics.poseCount));
});

// ─────────────────────────────────────────────────────────────────────────
// v0X 패밀리 (2026-08-16) — QR 동심 사각 SE 블록 · 사각 링 동반자 게이트.
// ─────────────────────────────────────────────────────────────────────────

test('v0X S-커브 — CS 수용을 넘어 body RS 복호까지 간다', { timeout: 300_000 }, () => {
  const result = decodeLab(distortImage(V0X_FRAME, { sCurve: 0.6, fill: FILL }));
  assert.equal(result.ok, true, 'v0X S-커브 복호: ' + (result.reason || ''));
  assert.equal(result.text, PAYLOAD);
  assert.equal(result.hypothesis.cellSurfaceLayout, 'v0x');
});

test('v0X 감마 0.7/0.6 — 두 커브 모두 복호된다', { timeout: 300_000 }, () => {
  for (const gamma of [0.7, 0.6]) {
    const result = decodeLab(distortImage(V0X_FRAME, { gamma, fill: FILL }));
    assert.equal(result.ok, true, 'v0X 감마 ' + gamma + ': ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v0x');
  }
});

test('v0X 회전 슬롯 0/120/240 전수 — 자기 레이아웃으로 복호된다', { timeout: 600_000 }, () => {
  for (const rotation of [0, 120, 240]) {
    const result = decodeLab(distortImage(V0X_FRAME, { gamma: 0.7, rotation, fill: FILL }));
    assert.equal(result.ok, true, 'v0X rot' + rotation + ': ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v0x');
  }
});

test('v0X 로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출', { timeout: 300_000 }, () => {
  const luma = toRelativeLuminance(distortImage(V0X_FRAME, { gamma: 0.7, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma);
  const second = detectCellSurfaceBlockShapes(luma);
  assert.deepEqual(
    JSON.parse(JSON.stringify(second)),
    JSON.parse(JSON.stringify(first)),
  );
  assert.ok(first.diagnostics.poseCount.v0x >= 1, 'v0X 포즈 최소 1개');
  const families = first.shapes.map((shape) => shape.blockLocator.family);
  assert.ok(families.includes('v0x'), 'v0x shape 가 없다: ' + families.join(','));
});

test('사각 링 서명 — v0X 는 120° 동반자를 항상 갖고, v1r2 와는 이것으로 갈린다', {
  timeout: 600_000,
}, () => {
  // SE 6×6 이 3면 동일이라 v0X 는 K5 원거리 코어가 셋(120° 간격) 뜬다.
  // v1r2 는 면 T 하나뿐이라 동반자 0 — 반경(18.0 vs 17.5)으로 갈리지 않으므로
  // v1r2 축에서는 이 서명이 유일한 값싼 판별자다.
  // ⚠ 정직한 사거리 (의도적 갱신 2026-08-16, 적대 검증 실측): v2r2@21 은 **자기 K5
  // 원거리 블록** 탓에 동반자가 뜨는 프레임이 있다 (49-매트릭스에서 7프레임, v0x
  // 헛포즈 발생) — 그 축은 이 게이트가 아니라 CS 층이 가른다 (cellSurfaceFinal.test.js
  // 의 n21 3-way 교차 오수용 테스트가 방벽). 이 테스트가 v2r2 축까지 막는다고 읽지 말 것.
  for (const tone of [{ gamma: 0.7 }, { sCurve: 0.6 }, {}]) {
    const v0x = detectCellSurfaceBlockShapes(
      toRelativeLuminance(distortImage(V0X_FRAME, { ...tone, fill: FILL })),
    );
    assert.ok(
      v0x.diagnostics.squareRing.companionPairs >= 2,
      'v0X 프레임 동반자 쌍이 2 미만: ' + JSON.stringify(v0x.diagnostics.squareRing),
    );
    assert.ok(v0x.diagnostics.poseCount.v0x >= 1, 'v0X 포즈가 없다');
  }
  // v1r2 프레임 — 동반자 0 이므로 게이트가 v0x 시딩을 막는다.
  const v1r2 = detectCellSurfaceBlockShapes(
    toRelativeLuminance(distortImage(V1R2_FRAME, { gamma: 0.7, fill: FILL })),
  );
  assert.equal(v1r2.diagnostics.squareRing.companionPairs, 0,
    'v1r2 프레임에 사각 링 동반자가 생겼다');
  assert.equal(v1r2.diagnostics.poseCount.v0x, 0,
    'v1r2 프레임에서 v0x 포즈가 섰다: ' + JSON.stringify(v1r2.diagnostics.poseCount));
});

test('v0X 패밀리를 끄면 v0x 포즈가 사라진다 (패밀리 격리 대조군)', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0X_FRAME, { gamma: 0.7, fill: FILL }));
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0xFamily: false } },
  });
  assert.equal(off.diagnostics.poseCount.v0x, 0);
  // v0X 프레임의 K3 중앙 + 반경 18 코어는 v1r2·v2r2@21 스냅에도 걸리므로 후보 포즈가
  // 서는 것이 정상이다 — 확정은 CS 평가 게이트가 한다(위 복호 테스트가 고정).
  assert.ok(off.diagnostics.poseCount.v1r2 >= 1,
    'v0X 프레임의 공유 중앙에서 v1r2 후보 포즈가 서야 한다: '
    + JSON.stringify(off.diagnostics.poseCount));
});

test('사각 링 게이트를 끄면 v1r2 프레임에도 v0x 헛포즈가 선다 (게이트 효과 대조군)', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V1R2_FRAME, { gamma: 0.7, fill: FILL }));
  const ungated = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0xRequireSquareRing: false } },
  });
  assert.ok(ungated.diagnostics.poseCount.v0x >= 1,
    '게이트를 꺼도 헛포즈가 없다면 이 대조군의 전제가 바뀐 것: '
    + JSON.stringify(ungated.diagnostics.poseCount));
});

test('회귀 — v0 프레임은 앵커드 패밀리 포즈 0, v2r2 프레임은 v1r2 후보가 서도 오수용 없음', {
  timeout: 300_000,
}, () => {
  // v0 프레임: K5 원거리 코어가 없어(우연 코어는 정합에서 탈락) 앵커드 패밀리는 서지
  // 않아야 하고, 조기 분기의 폴백(v0 스윕)만 산다.
  {
    const luma = toRelativeLuminance(distortImage(V0_FRAME, { gamma: 0.7, fill: FILL }));
    const detected = detectCellSurfaceBlockShapes(luma);
    assert.equal(
      detected.diagnostics.poseCount.v1r2, 0,
      'v0 프레임에서 v1r2 포즈가 생겼다: ' + JSON.stringify(detected.diagnostics.poseCount),
    );
    assert.equal(
      detected.diagnostics.poseCount.v2r2, 0,
      'v0 프레임에서 v2r2 포즈가 생겼다: ' + JSON.stringify(detected.diagnostics.poseCount),
    );
    assert.ok(detected.diagnostics.poseCount.v0 >= 1, 'v0 포즈가 없다');
  }
  // 의도적 갱신 (2026-08-16, 중앙 통일): 개정 v2r2@21 프레임에서는 v1r2 후보 포즈가
  // **서는 것이 새 기대**다 (중앙 공유 + 거리 17.5 vs 18 겹침). 진짜 불변식은
  // 복호 결과의 교차 오수용 부재 — 프레임은 반드시 자기 레이아웃(v2r2)으로 풀린다.
  {
    const luma = toRelativeLuminance(distortImage(V2R2_FRAME, { gamma: 0.7, fill: FILL }));
    const detected = detectCellSurfaceBlockShapes(luma);
    assert.ok(
      detected.diagnostics.poseCount.v1r2 >= 1,
      'v2r2 프레임의 공유 중앙에서 v1r2 후보 포즈가 서야 한다: '
      + JSON.stringify(detected.diagnostics.poseCount),
    );
    const result = decodeLab(distortImage(V2R2_FRAME, { gamma: 0.7, fill: FILL }));
    assert.equal(result.ok, true, 'v2r2 프레임 복호: ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v2r2', '교차 오수용 — v2r2 프레임이 다른 레이아웃으로 풀렸다');
  }
});

test('구 v2r2 중앙(닫힌 링 스택)은 legacy 분류만 남고 포즈를 만들지 않는다 (소각 차단)', {
  timeout: 300_000,
}, () => {
  // 소각된 구 디자인의 중앙 서명(동심 닮은꼴 링 스택, 교차거리 비 1:2:3:4)을 합성한다.
  // 동심 닮은꼴 다각형은 중심 통과 교차거리 비가 방향 무관이므로 정사각 링으로 충분하다.
  const W = 480;
  const H = 480;
  const u = 14; // 링 단위(px)
  const cx = W / 2;
  const cy = H / 2;
  const pixels = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const r = Math.max(Math.abs(x - cx), Math.abs(y - cy)) / u;
      // 닫힌 링 스택: 어두운 코어 r<1 · 밝음 1..2 · 어두움 2..3 · 밝음 3..4 · 어두움 4..5.
      const dark = r < 1 || (r >= 2 && r < 3) || (r >= 4 && r < 5);
      const value = dark ? 18 : 225;
      const index = (y * W + x) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  const luma = toRelativeLuminance({ width: W, height: H, pixels });
  const detected = detectCellSurfaceBlockShapes(luma);
  const kinds = detected.diagnostics.verified.map((hit) => hit.kind);
  assert.ok(kinds.includes('legacy-v2r2-center'),
    '구 중앙 서명이 legacy 로 분류되지 않았다: ' + kinds.join(','));
  // 어떤 조립도 legacy 중앙을 소비하지 않는다 — 구 디자인 인쇄물은 포즈 0 으로 차단.
  // 의도적 갱신 (2026-08-16): v0x 키가 늘었고 **값은 0 이어야 한다**. v0X 의 SE 동심
  // 사각은 구 중앙과 서명이 닮았으므로(둘 다 닫힌 동심 링) 이 단언이 「v0X 편입이 소각
  // 디자인을 되살리지 않았다」를 지키는 자리다.
  assert.deepEqual(detected.diagnostics.poseCount, { v2r2: 0, v1r2: 0, v0x: 0, v0: 0 });
  assert.equal(detected.shapes.length, 0);
});
