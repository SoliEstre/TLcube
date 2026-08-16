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
 *      similarity 시드 → 4앵커 직접 DLT → 12 서브앵커 최소제곱.
 *      ⚠ (2026-08-16 r2 재고정) 이 축은 **무왜곡만 초록**이다. 톤 왜곡(S-커브 0.6 ·
 *      감마 0.7/0.6)과 rot0 에서는 복호가 실패하는 것이 현재 정본 거동이고,
 *      아래 «알려진 약점 핀» 블록이 그 실패의 **종류와 단계까지** 고정한다.
 *      근거: 개정 전에도 이 레이아웃은 6 페이로드 중 1개만 통과했다(픽스처 운).
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

// ═════════════════════════════════════════════════════════════════════════
// v1r2 패밀리 (2026-08-15 밤) — 네 코너 블록 · 회전 스윕 없음.
//
// ⚠ **알려진 약점 핀 (2026-08-16 r2 픽스 라운드 · 운영자 결정 D)**
//
// 아래 테스트들은 «되기를 바라는 것» 이 아니라 **잰 것**을 고정한다. 포맷 v2
// 전환(포맷 셀 15→18)이 이 고정 프레임에서 v1r2 포즈 경로를 무너뜨렸다:
// `poseCount = {v2r2:0, v1r2:0, v0x:0, v0:6}` — 기하 가설이 n=13 으로 잡힌다.
//
// 왜 «테스트를 고쳐 통과시키지» 않았나 (근거는 `test/output/claude-mask-select.md`):
//  · §6.3 대조군 — 개정 **전** 트리에서 같은 12-페이로드 코퍼스 앞 6개를 재면
//    v2r2@21 은 6/6, **v1r2@21 은 1/6** 이었다. 이 레이아웃의 왜곡 강건성은
//    개정 전에도 6분의 1이었고, 초록이던 이 테스트는 **픽스처 페이로드 하나가
//    운 좋게 맞았던 것**이다. 포맷 v2 는 그 운을 다른 자리로 옮겼을 뿐이다.
//  · 통과하는 마스크(m2)를 픽스처에 못 박거나 페이로드를 바꾸면 «테스트를
//    통과시키는 값» 을 고르는 과적합이다 — 금지 항목(운영자 결정 D).
//  · §4.5 실측대로 현행 §5.3 페널티는 왜곡 통과의 대리가 아니라 이 축을 못 고른다
//    (오라클 4/6 vs 페널티 선택 0/6). 가중치 튜닝으로도 복구되지 않는다.
//
// 그래서 **측정된 진실을 단언**한다. 이 핀들은 «영구히 실패해도 된다» 는 면허가
// 아니다 — 누가 로케이터·레이아웃을 고쳐 v1r2 가 살아나면 여기가 빨개지고,
// 그때 이 블록을 «복호 성공» 으로 되돌리는 것이 정상 절차다.
//
// 무왜곡 축은 여전히 초록이므로(아래 첫 테스트) 약점은 **톤 왜곡 축에 한정**된다.
// ═════════════════════════════════════════════════════════════════════════

test('v1r2 무왜곡 — 자기 레이아웃으로 복호된다 (약점은 톤 왜곡 축에 한정)', {
  timeout: 300_000,
}, () => {
  const result = decodeLab(V1R2_FRAME);
  assert.equal(result.ok, true, 'v1r2 무왜곡 복호: ' + (result.reason || ''));
  assert.equal(result.text, PAYLOAD);
  assert.equal(result.hypothesis.cellSurfaceLayout, 'v1r2');
});

test('⚠ 알려진 약점 — v1r2 S-커브 0.6 은 «복호 실패» 가 현재 정본 거동이다', {
  timeout: 300_000,
}, () => {
  const result = decodeLab(distortImage(V1R2_FRAME, { sCurve: 0.6, fill: FILL }));
  // 실패의 **종류**까지 고정한다 — 오독(다른 본문을 내놓음)은 여전히 금지다.
  assert.equal(result.ok, false,
    'v1r2 S-커브가 복호됐다 — 약점이 고쳐졌다면 이 핀을 «복호 성공» 으로 되돌려라');
  assert.equal(result.reason, 'frontend:no-format-candidate');
  assert.equal(result.text, undefined, '실패 경로가 본문을 내놓았다 (오독)');
});

test('⚠ 알려진 약점 — v1r2 감마 0.7/0.6 도 실패한다 (실패 단계는 커브마다 다르다)', {
  timeout: 300_000,
}, () => {
  // 감마 0.7 은 포맷 후보 전멸, 감마 0.6 은 그보다 앞 단계(앵커)에서 죽는다.
  // 실패 단계가 다르다는 사실 자체가 «한 가지 병목» 이 아니라는 진단 자료다.
  const expected = { 0.7: 'frontend:no-format-candidate', 0.6: 'frontend:no-anchors' };
  for (const gamma of [0.7, 0.6]) {
    const result = decodeLab(distortImage(V1R2_FRAME, { gamma, fill: FILL }));
    assert.equal(result.ok, false, 'v1r2 감마 ' + gamma + ' 가 복호됐다 — 핀을 되돌려라');
    assert.equal(result.reason, expected[gamma], 'v1r2 감마 ' + gamma + ' 실패 단계');
    assert.equal(result.text, undefined, '실패 경로가 본문을 내놓았다 (오독)');
  }
});

test('v1r2 회전 슬롯 — 감마 0.7 에서 120/240 은 복호되고 ⚠ rot0 만 실패한다', {
  timeout: 600_000,
}, () => {
  // 물리 회전이 오히려 산다는 것이 핵심 관측이다: 약점은 «v1r2 패밀리 전반» 이
  // 아니라 이 프레임의 **특정 자세**에서 진짜 앵커가 예산에서 밀리는 것이다
  // (정본 §3.1 «mimic 의 실질 피해 = 진짜 앵커가 슬라이스 예산에서 밀려남»).
  for (const rotation of [120, 240]) {
    const result = decodeLab(distortImage(V1R2_FRAME, {
      gamma: 0.7, rotation, fill: FILL,
    }));
    assert.equal(result.ok, true, 'v1r2 rot' + rotation + ': ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v1r2');
    // 로케이터가 회전을 H 로 흡수하므로 가설 슬롯은 항상 0 이다.
    assert.equal(result.hypothesis.rotationDegrees, 0, 'v1r2 rot' + rotation + ' 슬롯');
  }
  const rot0 = decodeLab(distortImage(V1R2_FRAME, { gamma: 0.7, rotation: 0, fill: FILL }));
  assert.equal(rot0.ok, false, 'v1r2 rot0 이 복호됐다 — 핀을 되돌려라');
  assert.equal(rot0.reason, 'frontend:no-format-candidate');
});

test('v1r2 로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출', { timeout: 300_000 }, () => {
  const luma = toRelativeLuminance(distortImage(V1R2_FRAME, { gamma: 0.7, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma);
  const second = detectCellSurfaceBlockShapes(luma);
  // 결정성은 약점과 무관하게 유지돼야 하는 계약이다 — 여기가 이 테스트의 본론.
  assert.deepEqual(
    JSON.parse(JSON.stringify(second)),
    JSON.parse(JSON.stringify(first)),
  );
  // ⚠ 알려진 약점 핀: 이 프레임·이 왜곡에서 앵커드 패밀리는 하나도 서지 않고
  // v0 스윕 폴백만 산다. 개정 전에는 v1r2 포즈가 섰다(적대 검증 F3 대조표).
  assert.deepEqual(first.diagnostics.poseCount, {
    v2r2: 0, v1r2: 0, v0x: 0, v0: 6,
  }, '포즈 분포가 잰 값과 다르다 — 약점이 움직였으면 §6 을 재측정하고 핀을 갱신하라');
  const families = first.shapes.map((shape) => shape.blockLocator.family);
  assert.ok(!families.includes('v1r2'), 'v1r2 shape 가 살아났다 — 핀을 되돌려라');
});

test('v1r2 패밀리 격리 대조군 — 끄면 v1r2 포즈 0 (⚠ 현재는 켜도 0)', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V1R2_FRAME, { gamma: 0.7, fill: FILL }));
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v1r2Family: false } },
  });
  assert.equal(off.diagnostics.poseCount.v1r2, 0);
  // ⚠ 알려진 약점 핀 — 이 대조군은 **잠들었다**. 스위치를 켜도 이 프레임에서
  // v1r2 포즈가 0 이므로(위 결정성 핀) «끄면 사라진다» 를 관측할 수 없다.
  // 함께 잰 것: 중앙 공유로 서던 v2r2 후보 포즈도 같이 0 이 됐다 —
  // 즉 포맷 v2 −3셀은 이 프레임에서 **앵커드 포즈 예산 전체**를 깎았다
  // (적대 검증 F3: v2r2@21 도 ppu12 6→4 · ppu15 4→2 · ppu17 6→4).
  assert.deepEqual(off.diagnostics.poseCount, {
    v2r2: 0, v1r2: 0, v0x: 0, v0: 6,
  }, '격리 대조군의 전제가 움직였다 — 재측정하고 핀을 갱신하라');
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

test('⚠ 사각 링 게이트 효과 대조군 — v1r2 프레임에서는 잠들었다 (켜도 꺼도 v0x 0)', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V1R2_FRAME, { gamma: 0.7, fill: FILL }));
  const gated = detectCellSurfaceBlockShapes(luma);
  const ungated = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0xRequireSquareRing: false } },
  });
  // ⚠ 알려진 약점 핀 (2026-08-16 r2, 운영자 결정 D). 이 대조군은 «게이트를 끄면
  // v0x 헛포즈가 선다» 를 보여 게이트가 값을 한다는 증거였다. 포맷 v2 전환 뒤
  // 이 프레임에서는 **어떤 앵커드 패밀리도 시딩되지 않아**(위 v1r2 핀) 게이트를
  // 꺼도 켜도 v0x 가 0 이다 — 게이트가 약해진 것이 아니라 관측 대상이 사라졌다.
  // 게이트의 실효 증거는 v0X 프레임 쪽 테스트들(동반자 ≥2 · 자기 레이아웃 복호)이
  // 계속 들고 있다. v1r2 포즈가 살아나면 이 핀이 빨개지고 원래 대조군으로 되돌린다.
  assert.equal(gated.diagnostics.poseCount.v0x, 0);
  assert.equal(ungated.diagnostics.poseCount.v0x, 0,
    '게이트를 끄니 헛포즈가 섰다 — 대조군이 깨어났으니 원래 단언으로 되돌려라: '
    + JSON.stringify(ungated.diagnostics.poseCount));
  assert.deepEqual(ungated.diagnostics.poseCount, gated.diagnostics.poseCount,
    '게이트 on/off 로 포즈 분포가 달라졌다 — 대조군을 되살릴 수 있다');
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
