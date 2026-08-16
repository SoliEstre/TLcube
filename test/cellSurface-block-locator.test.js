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
 *      ⚠ (2026-08-16 r2 재고정) 이 축은 **무왜곡만 초록**이었다. 톤 왜곡(S-커브 0.6 ·
 *      감마 0.7/0.6)과 rot0 에서는 복호가 실패하는 것이 정본 거동이었고,
 *      아래 «알려진 약점 핀» 블록이 그 실패의 **종류와 단계까지** 고정했다.
 *      근거: 개정 전에도 이 레이아웃은 6 페이로드 중 1개만 통과했다(픽스처 운).
 *      ⚠ (2026-08-16 과업 #16) 그중 **S-커브 0.6 축이 해소됐다** — R 면 게인 0.52→0.62
 *      만으로 복호가 선다(문턱 0.57~0.60, 단조). 감마 0.7/0.6 축의 핀은 그대로 남는다.
 *   8. (2026-08-16 중앙 통일) 조기 분기 — 세 패밀리 중앙이 공유 K3 라 패밀리·n 판별은
 *      2차 앵커(K5 원거리 코어)가 맡는다. n=21 에선 v2r2·v1r2 후보 포즈가 **둘 다**
 *      서는 것이 새 기대(오수용 부재는 복호 결과로 고정), v0 프레임은 앵커드 포즈 0,
 *      구 v2r2 중앙(닫힌 링 스택)은 legacy 분류만 남고 포즈 0 (소각 차단).
 *   9. (2026-08-16) v0X 패밀리 — SE 6×6 동심 사각이 **3면 동일 톤**이라 K5 원거리
 *      코어가 120° 간격 **셋** 뜬다(v1r2·v2r2 는 면 T 하나뿐). 이 «사각 링 동반자»
 *      가 반경 18.0 을 공유하는 v1r2 와 v0X 를 가르는 시딩 게이트다.
 *  10. (2026-08-17) v0xq 패밀리 — **K3 중앙이 없다**(중앙 QR 슬롯). 3코너 삼중점이
 *      중앙·스케일·위상을 주고 중앙 QR 블록이 4번째 앵커다. 코너 검증은 별도 순회라
 *      다른 패밀리의 poseCount 가 흔들리지 않아야 한다 (§10 대조군 3종).
 *  11. (2026-08-16) v0W 패밀리 — K3 중앙은 **있고**, 동심 사각이 v0X 와 같은 블록인데
 *      **심 꼭짓점**에 앉는다(반경 16.7033 vs 18.0). 두 반경 차 1.30 은
 *      ANCHOR_SNAP_CELLS(3.2) 안이고 사각 링 동반자도 양쪽 다 참이라 **시드 단계에서
 *      안 갈라진다** — 가르는 것은 패치 Pearson 과 CS 수용 게이트다. 그래서 §11 은
 *      «포즈 0» 이 아니라 **«복호 오수용 0»** 을 재는 것이 본론이다 (양방향 전수).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectQrFinderTriples } from '../src/decoder/bootstrap.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import {
  CS_BLOCK_LOCATOR_INTERNALS, detectCellSurfaceBlockShapes,
} from '../src/decoder/cellsurface-block-detect.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { TL_READER_URL } from '../src/qr.js';
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

/** 3톤 변형 — 톤 열화 구간에서 v0xq 시딩 게이트의 실효 단계를 재는 데 쓴다. */
function renderFinal3Tone(layout, version, pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version, tones: 3, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

/**
 * **드랍 복원 스위치** (운영자 확정 2026-08-16 «v2r2 · v1r2 실험판 드랍»).
 *
 * 드랍은 «차단» 이지 «삭제» 가 아니다. 아래 v2r2 · v1r2 축의 회귀는 그대로 살려
 * 두되, 검출 라인업이 아니라 이 스위치로 켠다:
 *   · `calibration.csBlockLocator.{v2r2Family, v1r2Family}` → 블록 로케이터 패밀리
 *   · `includeDroppedCellSurfaceLayouts` → CS 평가 후보 (decodeLab 경로에서만 필요)
 * 게이트(0.78 · 0.035 · CRC · RS)는 한 값도 안 건드렸다.
 * 근거·측정: `test/output/claude-v0w-program.md`.
 */
const RESTORE_DROPPED_LOCATOR = Object.freeze({
  calibration: { csBlockLocator: { v2r2Family: true, v1r2Family: true } },
});
const RESTORE_DROPPED = Object.freeze({
  includeDroppedCellSurfaceLayouts: true,
  ...RESTORE_DROPPED_LOCATOR,
});

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

test('감마 0.7 — 종전 전멸 케이스가 v0/v2r2 모두 복호된다 (v2r2 는 드랍 복원)', {
  timeout: 300_000,
}, () => {
  for (const [frame, layout] of [[V0_FRAME, 'v0'], [V2R2_FRAME, 'v2r2']]) {
    const extra = layout === 'v2r2' ? RESTORE_DROPPED : {};
    const result = decodeLab(distortImage(frame, { gamma: 0.7, fill: FILL }), extra);
    assert.equal(result.ok, true, layout + ' 감마 0.7 복호: ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, layout);
  }
});

test('물리 회전 120° + 감마 0.7 — 회전 슬롯과 무관하게 복호된다 (v2r2 는 드랍 복원)', {
  timeout: 300_000,
}, () => {
  for (const [frame, layout] of [[V0_FRAME, 'v0'], [V2R2_FRAME, 'v2r2']]) {
    const extra = layout === 'v2r2' ? RESTORE_DROPPED : {};
    const result = decodeLab(distortImage(frame, {
      gamma: 0.7, rotation: 120, fill: FILL,
    }), extra);
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
// **그 절차가 2026-08-16 에 발동했다** (과업 #16). 로케이터가 아니라 렌더 쪽에서
// R 면 게인을 올린 것이 S-커브 축을 살렸다 — 아래 S-커브 테스트는 «복호 성공» 으로
// 되돌아갔고, 감마 축 핀만 남았다.
//
// 무왜곡 축은 여전히 초록이므로(아래 첫 테스트) 약점은 **감마 왜곡 축에 한정**된다.
// ═════════════════════════════════════════════════════════════════════════

test('v1r2 무왜곡 — 자기 레이아웃으로 복호된다 (드랍 복원 · 약점은 톤 왜곡 축에 한정)', {
  timeout: 300_000,
}, () => {
  const result = decodeLab(V1R2_FRAME, RESTORE_DROPPED);
  assert.equal(result.ok, true, 'v1r2 무왜곡 복호: ' + (result.reason || ''));
  assert.equal(result.text, PAYLOAD);
  assert.equal(result.hypothesis.cellSurfaceLayout, 'v1r2');
});

// ⚠ **의도적 갱신 (2026-08-16, 과업 #16 — R 게인 0.52 → 0.62)**
//
// 위 핀 블록이 명시한 «정상 절차» 가 실제로 발동했다. R 게인만 올렸더니 v1r2 의
// S-커브 0.6 축이 **살아났다** — 그래서 이 테스트는 위 지시대로 «복호 성공» 으로
// 되돌린다. 게이트·로케이터·마스크는 한 줄도 안 건드렸다.
//
// 실측 (다른 모든 것 고정, R 게인만 스윕 — `_probe-render-batch-cs.mjs v1r2`):
//   R 0.52 ✖ · 0.57 ✖ · **0.60 ok** · 0.62 ok · 0.66 ok · 0.72 ok
// 즉 문턱은 0.57~0.60 사이이고 단조롭다. §2.4 의 기전(«저대비 R 면이 후보 기하를
// 못 만든다»)과 방향이 일치한다 — 여기서도 실패 단계는 포맷 후보 전멸이었다.
//
// 감마 축(아래 테스트)은 **그대로 실패**다. 즉 «약점이 통째로 사라졌다» 가 아니라
// S-커브 축만 문턱을 넘었다 — 그래서 남은 핀을 지우지 않는다.
test('v1r2 S-커브 0.6 — R 게인 0.62 에서 복호된다 (2026-08-16 약점 해소, 의도적 갱신)', {
  timeout: 300_000,
}, () => {
  // 3-way 병합 봉합 (2026-08-17 retire 리허설): 두 레인의 진실을 합친다 —
  // render-batch 는 R 0.62 로 이 축을 «성공» 으로 뒤집었고 (그 레인의 실측:
  // 0.57 ✖ / 0.60 ok, 단조), v0w 다이어트는 v1r2 를 드랍해 «복원 스위치 위에서
  // 잰다» 를 얹었다. 병합 세계 = R 0.62 + 드랍 — 스위치를 켜면 복호돼야 한다.
  // 스위치 없이 실패하는 것은 «약점» 이 아니라 드랍 그 자체다.
  const result = decodeLab(
    distortImage(V1R2_FRAME, { sCurve: 0.6, fill: FILL }), RESTORE_DROPPED,
  );
  assert.equal(result.ok, true,
    'v1r2 S-커브가 다시 실패한다 — R 게인이 0.60 아래로 내려갔는지 먼저 보라: '
    + (result.reason || ''));
  assert.equal(result.text, PAYLOAD);
  assert.equal(result.hypothesis.cellSurfaceLayout, 'v1r2', 'v1r2 프레임이 남의 레이아웃으로 갔다');
});

test('⚠ 알려진 약점 — v1r2 감마 0.7/0.6 도 실패한다 (실패 단계는 커브마다 다르다)', {
  timeout: 300_000,
}, () => {
  // 감마 0.7 은 포맷 후보 전멸, 감마 0.6 은 그보다 앞 단계(앵커)에서 죽는다.
  // 실패 단계가 다르다는 사실 자체가 «한 가지 병목» 이 아니라는 진단 자료다.
  const expected = { 0.7: 'frontend:no-format-candidate', 0.6: 'frontend:no-anchors' };
  for (const gamma of [0.7, 0.6]) {
    const result = decodeLab(
      distortImage(V1R2_FRAME, { gamma, fill: FILL }), RESTORE_DROPPED,
    );
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
    }), RESTORE_DROPPED);
    assert.equal(result.ok, true, 'v1r2 rot' + rotation + ': ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v1r2');
    // 로케이터가 회전을 H 로 흡수하므로 가설 슬롯은 항상 0 이다.
    assert.equal(result.hypothesis.rotationDegrees, 0, 'v1r2 rot' + rotation + ' 슬롯');
  }
  const rot0 = decodeLab(
    distortImage(V1R2_FRAME, { gamma: 0.7, rotation: 0, fill: FILL }), RESTORE_DROPPED,
  );
  assert.equal(rot0.ok, false, 'v1r2 rot0 이 복호됐다 — 핀을 되돌려라');
  assert.equal(rot0.reason, 'frontend:no-format-candidate');
});

test('v1r2 로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출 (드랍 복원)', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V1R2_FRAME, { gamma: 0.7, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma, RESTORE_DROPPED_LOCATOR);
  const second = detectCellSurfaceBlockShapes(luma, RESTORE_DROPPED_LOCATOR);
  // 결정성은 약점과 무관하게 유지돼야 하는 계약이다 — 여기가 이 테스트의 본론.
  assert.deepEqual(
    JSON.parse(JSON.stringify(second)),
    JSON.parse(JSON.stringify(first)),
  );
  // ⚠ 알려진 약점 핀: 이 프레임·이 왜곡에서 앵커드 패밀리는 하나도 서지 않고
  // v0 스윕 폴백만 산다. 개정 전에는 v1r2 포즈가 섰다(적대 검증 F3 대조표).
  // 의도적 갱신 «v0W 파생 2종 편입» (2026-08-16): v0wq 키가 늘었고 값도 0 이다.
  // 의도적 갱신 «v0W 편입» (2026-08-16): v0w 키가 늘었고 **값은 0 이어야 한다**.
  // v0W 의 NE 동심 사각은 v1r2 의 코너와 서명 계보가 다르므로(3면 동일 K5 vs 면 T
  // 단독) 이 0 이 「v0W 편입이 v1r2 프레임에 헛 포즈를 만들지 않았다」를 지킨다.
  assert.deepEqual(first.diagnostics.poseCount, {
    v2r2: 0, v1r2: 0, v0x: 0, v0xq: 0, v0w: 0, v0wq: 0, v0: 6,
  }, '포즈 분포가 잰 값과 다르다 — 약점이 움직였으면 §6 을 재측정하고 핀을 갱신하라');
  const families = first.shapes.map((shape) => shape.blockLocator.family);
  assert.ok(!families.includes('v1r2'), 'v1r2 shape 가 살아났다 — 핀을 되돌려라');
});

test('v1r2 패밀리 격리 대조군 — 끄면 v1r2 포즈 0 (⚠ 현재는 켜도 0)', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V1R2_FRAME, { gamma: 0.7, fill: FILL }));
  // 의도적 갱신 «드랍 정본화» (2026-08-16): v1r2Family 기본이 false 가 됐으므로
  // «끄면» 은 이제 **기본 상태**다. 명시 false 로 재는 것은 그대로 둔다 —
  // 기본과 명시가 같은 값을 내는 것이 드랍이 실제로 걸렸다는 증거이기도 하다.
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v1r2Family: false } },
  });
  assert.equal(off.diagnostics.poseCount.v1r2, 0);
  assert.deepEqual(
    detectCellSurfaceBlockShapes(luma).diagnostics.poseCount, off.diagnostics.poseCount,
    '드랍 기본값과 명시 off 가 다르다 — 드랍이 안 걸린 것',
  );
  // ⚠ 알려진 약점 핀 — 이 대조군은 **잠들었다**. 스위치를 켜도 이 프레임에서
  // v1r2 포즈가 0 이므로(위 결정성 핀) «끄면 사라진다» 를 관측할 수 없다.
  // 함께 잰 것: 중앙 공유로 서던 v2r2 후보 포즈도 같이 0 이 됐다 —
  // 즉 포맷 v2 −3셀은 이 프레임에서 **앵커드 포즈 예산 전체**를 깎았다
  // (적대 검증 F3: v2r2@21 도 ppu12 6→4 · ppu15 4→2 · ppu17 6→4).
  // 의도적 갱신 «v0W 파생 2종 편입» (2026-08-16): v0wq 키가 늘었고 값도 0 이다.
  // 의도적 갱신 «v0W 편입» (2026-08-16): v0w 키가 늘었고 값은 0 이다 (위와 같은 이유).
  assert.deepEqual(off.diagnostics.poseCount, {
    v2r2: 0, v1r2: 0, v0x: 0, v0xq: 0, v0w: 0, v0wq: 0, v0: 6,
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
  // 의도적 갱신 «드랍 정본화» (2026-08-16): v1r2 패밀리가 기본 off 라 v0X 를 꺼도
  // 앵커드 포즈는 **하나도 남지 않는다**. 예전엔 여기서 v1r2 후보가 섰고, 그 후보를
  // 채점하는 비용이 드랍이 회수한 몫의 일부다.
  assert.equal(off.diagnostics.poseCount.v1r2, 0,
    'v1r2 패밀리가 기본 off 인데 포즈가 섰다: ' + JSON.stringify(off.diagnostics.poseCount));
  // 대조군은 스위치로 살아 있다 — 켜면 공유 중앙 + 반경 18 스냅으로 후보가 선다.
  const restored = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0xFamily: false, v1r2Family: true } },
  });
  assert.ok(restored.diagnostics.poseCount.v1r2 >= 1,
    'v0X 프레임의 공유 중앙에서 v1r2 후보 포즈가 서야 한다 (드랍 복원): '
    + JSON.stringify(restored.diagnostics.poseCount));
});

// 신규 (정본 정규화 2026-08-16): **구 인쇄물 호환**.
// 정규화 전에 인쇄된 v0X 는 4면이 mid(1) 로 칠해져 있고 현재 정의는 그 자리를 0/2 로
// 기대한다. 호환은 코드 분기가 아니라 **수용 게이트(agreement ≥ 0.78)에 위임**돼 있다.
// 수치 (실측, test/output/lanes/claude-v0xnorm-oldprint.mjs — 기본 프리셋 slate 로 그린
// 구 프레임을 현재 CS 채점기에 통과시킨 값):
//   · 실측 agreement **192/195 = 0.9846** — mid 레벨이 dark/bright 앵커 사이 0.257 자리라
//     classifyTone(midFraction 0.28 → 경계 0.36)이 dark 로 보낸다. 기대 0 인 (0,3).L 은
//     그래서 오히려 **맞고**, 기대 2 인 나머지 3면만 어긋난다.
//   · mid 를 mid 로 읽는 최악의 표본기를 가정해도 4/195 = 0.9795 — 여전히 게이트 위
//     여유 0.1995. 「최악에서도 통과」가 위임의 근거다.
// 이 테스트가 그 위임을 실물 프레임으로 확인한다. 위임이 깨지면(게이트 상향·채점 변경)
// 여기가 빨개진다.
//
// 구 프레임은 encoded.cellDigits 의 locator tones 를 정규화 **전** 값으로 되돌려 만든다
// (sceneY 가 entry.tones 를 우선 색인한다 — 레이아웃 정의는 건드리지 않는다).
const PRE_NORMALIZE_V0X_MID = Object.freeze([
  ['0,3', 'L'], ['14,20', 'L'], ['14,20', 'R'], ['19,19', 'R'],
]);

test('구 인쇄물 호환 — 정규화 전 v0X 프레임(mid 4면)이 현재 디코더로 복호된다', {
  timeout: 600_000,
}, () => {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0x', version: 1, tones: 2, eccLevel: 'M',
  });
  let reverted = 0;
  for (const [key, face] of PRE_NORMALIZE_V0X_MID) {
    const entry = encoded.cellDigits.get(key);
    assert.ok(entry && entry.role === 'locator', '구 프레임 대상 셀이 파인더가 아니다: ' + key);
    assert.notEqual(entry.tones[face], 1, key + '.' + face + ' 가 이미 mid 다 — 정본이 되돌아갔나?');
    entry.tones[face] = 1; // 정규화 전 값 = DEFAULT_TONE(mid)
    reverted += 1;
  }
  assert.equal(reverted, 4, '되돌린 면이 4개가 아니다');

  const legacyFrame = embed960(rasterize(
    buildSceneY(encoded, { palette: PALETTE, margin: 4 }),
    { pixelsPerUnit: 15, supersample: 2 },
  ));
  // 구 프레임과 현행 프레임은 실제로 다른 그림이어야 한다 (자 검증 — 같으면 이 테스트가
  // 아무것도 재지 않는다).
  let differing = 0;
  for (let index = 0; index < legacyFrame.pixels.length; index += 4) {
    if (legacyFrame.pixels[index] !== V0X_FRAME.pixels[index]) differing += 1;
  }
  assert.ok(differing > 0, '구/신 프레임이 픽셀 단위로 같다 — mid 되돌리기가 렌더에 안 먹었다');

  for (const [label, distortion] of [
    ['클린', {}],
    ['감마 0.7', { gamma: 0.7 }],
    ['회전 120°', { rotation: 120 }],
  ]) {
    const frame = Object.keys(distortion).length
      ? distortImage(legacyFrame, { ...distortion, fill: FILL }) : legacyFrame;
    const result = decodeLab(frame);
    assert.equal(result.ok, true, '구 인쇄물 ' + label + ': ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD, '구 인쇄물 ' + label + ' 페이로드');
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v0x',
      '구 인쇄물 ' + label + ' 이 다른 레이아웃으로 풀렸다');
  }
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
  //
  // 의도적 갱신 «드랍 정본화» (2026-08-16): 두 패밀리가 기본 off 라 이 관측은
  // **드랍 복원 스위치 위에서만** 성립한다. 기본 상태의 값(둘 다 0)도 함께 건다 —
  // 그것이 드랍이 실제로 걸렸다는 증거다.
  {
    const luma = toRelativeLuminance(distortImage(V2R2_FRAME, { gamma: 0.7, fill: FILL }));
    const dropped = detectCellSurfaceBlockShapes(luma);
    assert.equal(dropped.diagnostics.poseCount.v2r2, 0, '드랍인데 v2r2 포즈가 섰다');
    assert.equal(dropped.diagnostics.poseCount.v1r2, 0, '드랍인데 v1r2 포즈가 섰다');
    const detected = detectCellSurfaceBlockShapes(luma, RESTORE_DROPPED_LOCATOR);
    assert.ok(
      detected.diagnostics.poseCount.v1r2 >= 1,
      'v2r2 프레임의 공유 중앙에서 v1r2 후보 포즈가 서야 한다 (드랍 복원): '
      + JSON.stringify(detected.diagnostics.poseCount),
    );
    const result = decodeLab(
      distortImage(V2R2_FRAME, { gamma: 0.7, fill: FILL }), RESTORE_DROPPED,
    );
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
  // 의도적 갱신 (2026-08-17): v0xq 키가 늘었고 **값은 0 이어야 한다**. v0xq 는 코너
  // 동심 사각 삼중점으로 시드하므로 중앙 링 스택 하나로는 서지 못한다 — 이 0 이
  // 「중앙 QR 변형 편입도 소각 디자인을 되살리지 않았다」를 지킨다.
  // 의도적 갱신 «v0W 파생 2종 편입» (2026-08-16): v0wq 키가 늘었고 값도 0 이다.
  // 의도적 갱신 «v0W 편입» (2026-08-16): v0w 키가 늘었고 **값은 0 이어야 한다**.
  // v0W 는 K3 중앙 × K5 원거리 쌍이 필요한데 이 프레임에는 구 중앙 링 스택뿐이라
  // 쌍이 성립하지 않는다 — 이 0 이 「v0W 편입도 소각 디자인을 되살리지 않았다」다.
  assert.deepEqual(detected.diagnostics.poseCount, {
    v2r2: 0, v1r2: 0, v0x: 0, v0xq: 0, v0w: 0, v0wq: 0, v0: 0,
  });
  assert.equal(detected.shapes.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// v0xq 패밀리 (2026-08-17) — 3코너 동심 사각(NE 사분면) + 중앙 QR.
//
// 최종 라인업에서 **처음으로 K3 불스아이 중앙이 없다** (그 자리를 QR 슬롯이 가져갔다).
// 그래서 «K3 중앙 × K5 원거리» 앵커드 시딩이 통째로 성립하지 않고, 코너 동심 사각
// 3개의 120° 삼중점이 중앙·스케일·위상을 동시에 준다. 중앙 QR 블록 자체가 제4 앵커다.
// ─────────────────────────────────────────────────────────────────────────

function renderV0xq(pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0xq', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

const V0XQ_FRAME = embed960(renderV0xq(15));

test('v0xq — 톤 커브 4종 × 회전 3방향(0/120/240) 전부 body RS 까지 복호된다', {
  timeout: 600_000,
}, () => {
  for (const [name, tone] of [
    ['none', {}], ['sCurve0.6', { sCurve: 0.6 }],
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const result = decodeLab(distortImage(V0XQ_FRAME, { ...tone, rotation, fill: FILL }));
      const where = `v0xq ${name} rot${rotation}`;
      assert.equal(result.ok, true, `${where}: ${result.reason || ''}`);
      assert.equal(result.text, PAYLOAD, where);
      assert.equal(result.hypothesis.cellSurfaceLayout, 'v0xq', `${where} 교차 오수용`);
      // ⚠ 의도적 갱신 (2026-08-16, 과업 #16). 종전 단언은 «로케이터가 회전을 H 로
      // 흡수하므로 슬롯은 **항상** 0» 이었다. R 게인 0.62 에서 그 «항상» 이 깨진다 —
      // 12칸 중 «무왜곡 × 물리 120°» **한 칸**만 슬롯 120 으로 잡힌다
      // (`_probe-render-batch-cs.mjs slot` 실측: R 0.52/0.57/0.60/0.66/0.72 는 12칸 전부
      // 슬롯 0, R 0.62 만 이 한 칸이 120). 좁고 비단조라 문턱이 아니라 칼날이다.
      //
      // 그렇다고 단언을 느슨하게 («0 이거나 rotation») 풀지 않는다 — 그러면 어느
      // 칸이 옮겨 다녀도 초록이라 자가 무뎌진다. **잰 값을 칸별로** 고정한다.
      // 판독 계약(ok·본문·레이아웃)은 위 세 줄이 12칸 전부에서 그대로 잡고 있으므로,
      // 슬롯은 «흡수됐는가» 의 진단치일 뿐 복호 성립 조건이 아니다.
      const slotExceptions = { 'none/120': 120 };
      const expectedSlot = slotExceptions[`${name}/${rotation}`] ?? 0;
      assert.equal(result.hypothesis.rotationDegrees, expectedSlot, `${where} 슬롯`);
    }
  }
});

test('v0xq 교차 — 다른 레이아웃 프레임에서 v0xq 포즈가 서지 않는다', {
  timeout: 600_000,
}, () => {
  for (const [name, frame] of [
    ['v0x', V0X_FRAME], ['v2r2', V2R2_FRAME], ['v1r2', V1R2_FRAME], ['v0', V0_FRAME],
  ]) {
    for (const rotation of [0, 120]) {
      const luma = toRelativeLuminance(distortImage(frame, { rotation, fill: FILL }));
      const detected = detectCellSurfaceBlockShapes(luma);
      assert.equal(detected.diagnostics.poseCount.v0xq, 0,
        `${name} rot${rotation} 프레임에 v0xq 포즈가 섰다`);
      assert.ok(!detected.shapes.some((shape) => shape.blockLocator.family === 'v0xq'),
        `${name} rot${rotation} 에 v0xq shape 가 생겼다`);
    }
  }
  // 반대 방향 — v0xq 프레임에서는 실제로 선다 (대조군이 «항상 0» 인 자를 재는 게
  // 아님을 여기서 못 박는다).
  const own = detectCellSurfaceBlockShapes(
    toRelativeLuminance(distortImage(V0XQ_FRAME, { rotation: 0, fill: FILL })),
  );
  assert.ok(own.diagnostics.poseCount.v0xq > 0, 'v0xq 프레임에서도 포즈가 0 이다 — 자가 죽었다');
});

test('v0xq 시딩 게이트 — 중앙 QR 정합이 남의 프레임 삼중점을 시드 전에 자른다', {
  timeout: 600_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0X_FRAME, { rotation: 0, fill: FILL }));
  const on = detectCellSurfaceBlockShapes(luma);
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0xqRequireCenterQr: false } },
  });
  // v0X 의 SE 동심 사각도 120° 삼중점을 만든다 — 게이트가 **시드 단계에서** 자른다.
  assert.ok(on.diagnostics.centerQr.centreRejected > 0,
    'v0X 프레임에서 중앙 QR 게이트가 아무것도 자르지 않았다 — 게이트가 잠들었으면 주석을 고쳐라');
  // ⚠ 잰 값: **이 프레임(2톤·무왜곡)에서는** 게이트를 꺼도 포즈가 0 이다 — 여기서는
  // 시드가 refinePose 를 못 넘는다. 이것이 참인 구간은 여기까지이고, 3톤 + 톤 열화
  // 구간은 다르다 (아래 «시딩 게이트 ② 열화 구간» 이 그쪽을 잰다). 두 테스트를
  // 함께 읽어야 cfg 주석의 «막는 주체는 CS 수용 게이트» 가 성립한다.
  assert.equal(off.diagnostics.poseCount.v0xq, 0);
  assert.equal(on.diagnostics.poseCount.v0xq, 0);
  // 패밀리 스위치는 살아 있다 — 끄면 자기 프레임에서도 0.
  const ownOff = detectCellSurfaceBlockShapes(
    toRelativeLuminance(distortImage(V0XQ_FRAME, { rotation: 0, fill: FILL })),
    { calibration: { csBlockLocator: { v0xqFamily: false } } },
  );
  assert.equal(ownOff.diagnostics.poseCount.v0xq, 0, 'v0xqFamily:false 가 듣지 않는다');
});

test('v0xq 시딩 게이트 ② 열화 구간 — 포즈가 실제로 서고, 게이트는 그것을 한 개도 못 자른다', {
  timeout: 900_000,
}, () => {
  // 통합 리허설(2026-08-16) 재측정의 코드 고정. 위 테스트의 «꺼도 포즈 0» 은
  // 2톤·무왜곡에서만 참이다. v0X **3톤 + 톤 열화** 에서는 v0xq 포즈가 실제로 서고,
  // 그때 ON/OFF 가 한 자리도 같다 — 즉 이 게이트는 «살아남는 포즈» 를 자르지 못한다.
  // poseCount 는 refinePose 를 **통과한 뒤** 증가하므로 refinePose 도 거르지 않는다.
  // 남는 방벽은 하류 CS 수용 게이트(0.78 / 0.035)뿐이고, 마지막 단언이 그 결과
  // (교차 오수용 0)를 함께 잡는다.
  // ⚠ 의도적 갱신 (2026-08-16, 과업 #16 — R 게인 0.52 → 0.62): **회전 축을 더했다**.
  //
  // 종전에는 rot0 만 돌렸다. R 0.62 에서 rot0 의 v0xq 포즈가 전부 사라져 posesSeen 이
  // 0 이 됐고, 그러면 이 테스트는 자기 가드가 경고한 «항상 0 인 자» 가 된다.
  // 그런데 넓게 재 보니 현상이 **사라진 게 아니라 rot0 → rot120 으로 옮겨갔다**
  // (`_probe-render-batch-cs.mjs gate2wide`: R 0.62 · ppu 12/15/18 · 3톤에서 감마
  // 0.6~0.85 가 전부 rot120 에서 포즈 1). 그래서 조건을 완화하는 대신 **회전을 스윕**해
  // 같은 현상을 다시 붙잡는다 — 칸 수는 4 → 8 로 늘고, 두 게인 어느 쪽에서도
  // posesSeen > 0 이 성립한다 (실측 R 0.52 → 4 · R 0.62 → 2, cut 은 양쪽 0).
  //
  // 축을 더한 것은 게이트 완화가 아니다. ON/OFF 동수 단언은 8칸 전부에 그대로 걸리고,
  // 포즈가 0 인 칸에서도 «0 == 0» 은 참이라 약해지지 않는다. 늘어나는 쪽은 분모다.
  const v0x3 = embed960(renderFinal3Tone('v0x', 1, 15));
  let posesSeen = 0;
  let cutBySeedGate = 0;
  for (const [name, tone] of [
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
    ['sCurve0.6', { sCurve: 0.6 }], ['sCurve0.9', { sCurve: 0.9 }],
  ]) {
    for (const rotation of [0, 120]) {
      const luma = toRelativeLuminance(distortImage(v0x3, { ...tone, rotation, fill: FILL }));
      const on = detectCellSurfaceBlockShapes(luma);
      const off = detectCellSurfaceBlockShapes(luma, {
        calibration: { csBlockLocator: { v0xqRequireCenterQr: false } },
      });
      posesSeen += on.diagnostics.poseCount.v0xq;
      cutBySeedGate += off.diagnostics.poseCount.v0xq - on.diagnostics.poseCount.v0xq;
      assert.equal(on.diagnostics.poseCount.v0xq, off.diagnostics.poseCount.v0xq,
        `v0x 3톤 ${name} rot${rotation}: 시딩 게이트 ON/OFF 로 v0xq 포즈 수가 갈렸다`);
    }
  }
  assert.ok(posesSeen > 0,
    'v0X 3톤 열화에서 v0xq 포즈가 하나도 안 섰다 — 이 테스트가 «항상 0» 인 자를 재고 있다');
  assert.equal(cutBySeedGate, 0, '시딩 게이트가 살아남는 포즈를 잘랐다 — cfg 주석을 고쳐라');

  // 그런데도 복호는 v0x 로 간다 — 막는 단계가 CS 수용 게이트임을 결과로 확인한다.
  // (통합자 강화 2026-08-16, 검증 렌즈 지적 7) 조건부 가드였던 것을 강제로 바꿨다 —
  // 이 프레임이 복호에 실패하면 오수용 핀이 조용히 공허해지므로, 실패 자체를 빨갛게 한다.
  // 회전 축을 더한 김에 복호 확인도 두 회전 모두에서 한다 — 포즈가 실제로 서는 쪽이
  // rot120 이므로, 오수용 분모가 있는 칸을 반드시 포함하게 된다.
  for (const rotation of [0, 120]) {
    const decoded = decodeLab(distortImage(v0x3, { gamma: 0.7, rotation, fill: FILL }));
    assert.equal(decoded.ok, true,
      `v0X 3톤 감마 rot${rotation} 프레임이 복호에 실패했다 — 오수용 핀의 분모가 사라진다: `
      + (decoded.reason || ''));
    assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0x',
      `v0X 3톤 감마 rot${rotation} 프레임이 v0xq 로 오수용됐다 — CS 수용 게이트가 뚫렸다`);
  }
});

// ── 통합자 계약 테스트 (2026-08-16, v0xq 원 런 검증 렌즈 지적 d) ────────────────
// v0xq 로케이터는 detectQrFinderTriples(bootstrap, 이미지 탐색)를 부르지 않고 같은
// 신호를 buildCenterQrPatch(모델 공간)로 재구현한다 (import 순환 — claude-v0xq.md §4).
// 두 독립 구현을 묶는 계약이 없으면 한쪽만 바뀌어도 조용히 갈라진다. 이 테스트가 그
// 계약이다: v0xq 렌더의 중앙 QR 은 이미지 쪽 검출기에서도 window-kind 삼중점으로
// 실제로 잡혀야 하고, 코너 cosine 은 window 서명(−0.5, 60°/120° 전단)에 붙어야 한다.
test('계약 — v0xq 중앙 QR 이 이미지 공간 detectQrFinderTriples 에서도 window 삼중점으로 잡힌다', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0XQ_FRAME, { rotation: 0, fill: FILL }));
  const result = detectQrFinderTriples(luma, {});
  assert.equal(result.ok, true, 'QR 삼중점 검출 실패: ' + (result.reason || ''));
  const windows = result.candidates.filter((candidate) => candidate.kind === 'window');
  assert.ok(windows.length > 0,
    'window-kind 삼중점 0개 — 모델 공간 가정과 이미지 검출기가 갈라졌다');
  const best = windows[0];
  assert.ok(Math.abs(best.cosine - (-0.5)) < 0.06,
    `window 코너 cosine 이 서명(−0.5)에서 벗어났다: ${best.cosine}`);
});

// ── v0xq 추가 회귀 (같은 레인, 위 블록과 겹치지 않는 두 축) ────────────────
//   · 결정성 — 삼중점 순회·중앙 QR 사전 게이트에 부동 자유도가 없다.
//   · **비침습성** — 코너 검증이 별도 순회라 다른 패밀리의 관측이 안 흔들린다.

test('v0xq 로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0XQ_FRAME, { rotation: 0, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma);
  const second = detectCellSurfaceBlockShapes(luma);
  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.deepEqual(
    first.shapes.map((shape) => shape.center),
    second.shapes.map((shape) => shape.center),
  );
});

test('v0xq 편입 비침습성 — 다른 프레임의 verified·poseCount 가 on/off 로 동일하다', {
  timeout: 600_000,
}, () => {
  // 코너 검증을 **별도 순회 + 별도 occupied** 로 둔 이유가 이것이다. 기존 순회에
  // 끼워 넣었다면 검증된 자리가 늘어 다른 패밀리의 클러스터 선택이 밀렸을 것이다.
  for (const [name, frame] of [
    ['v0x', V0X_FRAME], ['v2r2', V2R2_FRAME], ['v1r2', V1R2_FRAME], ['v0', V0_FRAME],
  ]) {
    const luma = toRelativeLuminance(distortImage(frame, { rotation: 0, fill: FILL }));
    const on = detectCellSurfaceBlockShapes(luma);
    // **의도적 갱신 «v0W 파생 2종 편입» (2026-08-16)** — 코너 검증 순회는 이제
    // v0xq·v0wq 가 **공유**한다 (같은 동심 사각 블록이라 두 번 훑을 이유가 없다).
    // 그래서 «코너 검증이 안 돈다» 를 보려면 **두 패밀리를 다 꺼야** 한다.
    // v0xq 하나만 끈 쪽은 여전히 코너를 훑는다 — 그것이 침습이 아니라 공유다.
    const off = detectCellSurfaceBlockShapes(luma, {
      calibration: { csBlockLocator: { v0xqFamily: false } },
    });
    const offBoth = detectCellSurfaceBlockShapes(luma, {
      calibration: { csBlockLocator: { v0xqFamily: false, v0wqFamily: false } },
    });
    assert.deepEqual(on.diagnostics.verified, off.diagnostics.verified,
      name + ' verified 가 흔들렸다');
    assert.deepEqual(on.diagnostics.verified, offBoth.diagnostics.verified,
      name + ' verified 가 흔들렸다 (둘 다 끔)');
    for (const family of ['v2r2', 'v1r2', 'v0x', 'v0']) {
      assert.equal(on.diagnostics.poseCount[family], off.diagnostics.poseCount[family],
        name + ' ' + family + ' poseCount 변동');
      assert.equal(on.diagnostics.poseCount[family], offBoth.diagnostics.poseCount[family],
        name + ' ' + family + ' poseCount 변동 (둘 다 끔)');
    }
    assert.equal(off.diagnostics.poseCount.v0xq, 0, name + ' 끈 쪽에 v0xq 포즈가 있다');
    assert.equal(offBoth.diagnostics.centerQr.corners, 0,
      name + ' 둘 다 껐는데 코너 검증이 돌았다');
  }
});

// ─────────────────────────────────────────────────────────────────────────
// v0W 패밀리 (2026-08-16 편입) — K3 중앙 + **심 꼭짓점** 동심 사각 + v0 코너 위상 마커.
//
// v0X 와의 관계가 이 블록의 전부다. 동심 사각은 **같은 블록**(v0X SE 를 (i−15, j) 로
// 평행이동한 v0xq CORNER 와 같은 배열)인데 앉은 자리가 달라 반경만 18.0 → 16.7033 로
// 바뀐다. `ANCHOR_SNAP_CELLS` 는 3.2 이므로 **두 패밀리는 서로의 프레임에서 서로
// 시드된다** — 사각 링 동반자 게이트도 양쪽 다 참이라 안 가른다.
//
// 그래서 여기서 «포즈 0» 을 요구하면 거짓말이 된다. 요구하는 것은 **복호 오수용 0**:
// 어느 프레임도 남의 레이아웃으로 복호되면 안 된다. 그 판정을 하는 것은 CS 수용
// 게이트(agreement 0.78 · orientation margin 0.035)이고, 이 레인은 그 값을 안 건드렸다.
// ─────────────────────────────────────────────────────────────────────────

const V0W_FRAME = embed960(renderFinal('v0w', 1, 15));

/**
 * ⚠ **알려진 약점 핀** (v1r2 §7 과 같은 형식) — 잰 것을 그대로 고정한다.
 *
 * ⚠ **의도적 갱신 (2026-08-17 retire 리허설 — R 게인 0.52 → 0.62 병합)**: 약점은
 * 사라지지 않고 **톤 축을 따라 이동했다**. 레인 세계 (R 0.52) 에서는 sCurve0.6·
 * gamma0.6 × rot0 이 죽었는데, 병합 세계 (R 0.62) 실측은
 *   clean  0/120/240 ○ | sCurve0.6  전부 ○ (rot0 구제 — v1r2 S-커브와 같은 기전)
 *   gamma0.7 rot0 ✗ · 120/240 ○ | gamma0.6 rot0 ✗ · 120/240 ○
 * 즉 여전히 «회전 0° × 감마 열화 2칸» 이고, sCurve 축만 문턱을 넘었다.
 *
 * 죽는 **단계**는 그대로다: 로케이터는 산다 (v0w 포즈 ≥1). CS 수용도 난다
 * (아래 wantFail 가지가 매 실행 실증). 실제로 죽는 곳은
 * `bootstrap-validation / BODY_RS_FAILED` 다. (레인 세계 실측에서 그 자리의
 * orientationMargin 은 0.038 — 하한 0.035 를 간신히 넘는 값이었다.)
 *
 * 귀속 (구조에서 나온다, 추측 아님): v0W 의 120° 위상 판별력은 **면 비대칭 셀 10개**
 * (NW 4 + SE 6) 뿐이다 — NE 동심 사각 36셀은 3면 동일이라 판별력 0 이고, NW 는 네
 * 레이아웃이 공유한다. v0X 는 같은 판별력을 12셀(NW 4 + NE 4 + SW 4)이 나눠 갖는데
 * 파인더 총계가 65 라 비율이 18.5 % 대 14.3 % 로 더 두껍다. 위상이 얇으면 마진이
 * 얇고, 마진이 얇으면 **틀린 위상이 수용될 수 있다** — 그 뒤는 데이터 셀이 통째로
 * 어긋나므로 RS 가 못 살린다.
 *
 * **게이트는 한 값도 안 건드렸다.** 0.035 를 내리면 이 두 칸이 초록이 되겠지만
 * 그건 «틀린 위상을 더 받는» 변경이다. 이 레인의 배제 목록 1번이다.
 * 조건부 드랍(«v0W > v0X») 판단 재료는 test/output/claude-v0w-program.md §12 대조표.
 */
const V0W_TONE_PINS = Object.freeze([
  ['clean', {}, [0, 120, 240], []],
  ['sCurve0.6', { sCurve: 0.6 }, [0, 120, 240], []],
  ['gamma0.7', { gamma: 0.7 }, [120, 240], [0]],
  ['gamma0.6', { gamma: 0.6 }, [120, 240], [0]],
]);

test('v0W 자기 복호 — 톤 커브 4종 × 회전 3방향 (⚠ rot0 × 강한 톤 열화 2칸은 약점 핀)', {
  timeout: 900_000,
}, () => {
  for (const [label, distort, wantOk, wantFail] of V0W_TONE_PINS) {
    for (const rotation of wantOk) {
      const decoded = decodeLab(distortImage(V0W_FRAME, { ...distort, rotation, fill: FILL }));
      const where = `v0W ${label} rot${rotation}`;
      assert.equal(decoded.ok, true, `${where}: ${decoded.reason || ''}`);
      assert.equal(decoded.text, PAYLOAD, where);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0w',
        `${where} 이 남의 레이아웃으로 복호됐다: ` + decoded.hypothesis.cellSurfaceLayout);
    }
    for (const rotation of wantFail) {
      const frame = distortImage(V0W_FRAME, { ...distort, rotation, fill: FILL });
      const decoded = decodeLab(frame);
      const where = `v0W ${label} rot${rotation}`;
      assert.equal(decoded.ok, false,
        `${where} 이 초록이 됐다 — 약점이 사라졌으면 재측정하고 핀을 갱신하라`);
      assert.equal(decoded.reason, 'frontend:no-grid-hypothesis', where + ' 실패 이유');
      // 죽는 단계는 **로케이터가 아니다** — 포즈는 선다. 그 사실을 함께 못 박는다.
      const detected = detectCellSurfaceBlockShapes(toRelativeLuminance(frame));
      assert.ok(detected.diagnostics.poseCount.v0w >= 1,
        `${where} 에서 v0w 포즈까지 죽었다 — 약점의 귀속이 바뀌었다`);
      assert.equal(decoded.detail.pipelineCode, 'BODY_RS_FAILED',
        `${where} 이 body RS 앞에서 죽었다 — 귀속이 바뀌었다: `
        + JSON.stringify(decoded.detail && decoded.detail.pipelineCode));
    }
  }
});

test('v0W 교차 오수용 0 — 양방향 전수 (v0 · v0X · v0XQ · v0W)', {
  timeout: 900_000,
}, () => {
  // «남의 프레임이 v0W 로 복호되지 않는다» 와 «v0W 프레임이 남으로 복호되지 않는다» 를
  // 같은 표에서 잰다. 한쪽만 재면 A/B 가 다른 축을 가린다.
  for (const [name, frame, wantLayout] of [
    ['v0', V0_FRAME, 'v0'],
    ['v0x', V0X_FRAME, 'v0x'],
    ['v0xq', V0XQ_FRAME, 'v0xq'],
    ['v0w', V0W_FRAME, 'v0w'],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const decoded = decodeLab(distortImage(frame, { rotation, fill: FILL }));
      assert.equal(decoded.ok, true,
        `${name} rot${rotation} 이 복호되지 않았다: ${decoded.reason || ''}`);
      assert.equal(decoded.text, PAYLOAD, `${name} rot${rotation}`);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, wantLayout,
        `${name} rot${rotation} 이 ${decoded.hypothesis.cellSurfaceLayout} 로 오수용됐다`);
    }
  }
});

test('v0W 교차 — Type O · A 프레임에서 v0W shape 가 서지 않는다', {
  timeout: 600_000,
}, () => {
  // cube 축 밖(hex 실루엣) 프레임은 K3 중앙 자체가 없으므로 앵커드 쌍이 성립하지 않는다.
  for (const [name, frame] of [['v2r2', V2R2_FRAME], ['v1r2', V1R2_FRAME]]) {
    for (const rotation of [0, 120]) {
      const luma = toRelativeLuminance(distortImage(frame, { rotation, fill: FILL }));
      const detected = detectCellSurfaceBlockShapes(luma);
      assert.ok(!detected.shapes.some((shape) => shape.blockLocator.layoutId === 'v0w'),
        `${name} rot${rotation} 에 v0W shape 가 섰다`);
    }
  }
});

test('v0W 패밀리 격리 대조군 — 끄면 v0w 포즈 0, 켜면 자기 프레임에서 선다', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0W_FRAME, { rotation: 0, fill: FILL }));
  const on = detectCellSurfaceBlockShapes(luma);
  assert.ok(on.diagnostics.poseCount.v0w >= 1,
    'v0W 프레임에서 v0w 포즈가 0 이다: ' + JSON.stringify(on.diagnostics.poseCount));
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0wFamily: false } },
  });
  assert.equal(off.diagnostics.poseCount.v0w, 0, '패밀리를 껐는데 v0w 포즈가 섰다');
});

test('v0W 로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0W_FRAME, { gamma: 0.7, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma);
  const second = detectCellSurfaceBlockShapes(luma);
  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.deepEqual(
    first.shapes.map((shape) => shape.center),
    second.shapes.map((shape) => shape.center),
  );
});

test('v0W 편입 비침습성 — 다른 프레임의 verified 와 기존 패밀리 poseCount 가 on/off 로 동일', {
  timeout: 600_000,
}, () => {
  // v0W 는 기존 앵커드 순회 **안에** 산다 (v0xq 처럼 별도 순회가 아니다). 그래서
  // «클러스터 검증» 단계는 손대지 않았다는 것을 verified 동일성으로 못 박고,
  // 기존 패밀리 poseCount 도 흔들리지 않는지 본다. 흔들리면 편입이 침습적인 것이다.
  for (const [name, frame] of [
    ['v0x', V0X_FRAME], ['v2r2', V2R2_FRAME], ['v1r2', V1R2_FRAME],
    ['v0', V0_FRAME], ['v0xq', V0XQ_FRAME],
  ]) {
    const luma = toRelativeLuminance(distortImage(frame, { rotation: 0, fill: FILL }));
    const on = detectCellSurfaceBlockShapes(luma);
    const off = detectCellSurfaceBlockShapes(luma, {
      calibration: { csBlockLocator: { v0wFamily: false } },
    });
    assert.deepEqual(on.diagnostics.verified, off.diagnostics.verified,
      name + ' verified 가 흔들렸다');
    for (const family of ['v2r2', 'v1r2', 'v0x', 'v0xq', 'v0']) {
      assert.equal(on.diagnostics.poseCount[family], off.diagnostics.poseCount[family],
        name + ' ' + family + ' poseCount 변동');
    }
    assert.equal(off.diagnostics.poseCount.v0w, 0, name + ' 끈 쪽에서 v0w 포즈가 섰다');
  }
});

test('v0W 시드 기하 — canonical 앵커 방향이 (0,−1) 이 아니라서 일반형 시드를 쓴다', () => {
  // 이 레인이 «주장 대신 잰 것» 의 회귀. v0X 계열은 원거리 블록이 먼 꼭짓점이라
  // 면 T 에서 canonical θ = −90°(= (0,−1)) 이고, v0W 는 심 꼭짓점이라 −141.1° 다.
  // 그래서 기존 `anchoredSimilaritySeed` 를 그대로 쓰면 51.1° 틀어진 시드가 나온다.
  const v0x = CS_BLOCK_LOCATOR_INTERNALS.patchesFor(21, 'v0x').corners[0].anchor;
  const v0w = CS_BLOCK_LOCATOR_INTERNALS.patchesFor(21, 'v0w').corners[0].anchor;
  const deg = (p) => (Math.atan2(p.y, p.x) * 180) / Math.PI;
  assert.ok(Math.abs(deg(v0x) - (-90)) < 0.5, 'v0X 코너 앵커가 −90° 가 아니다: ' + deg(v0x));
  assert.ok(Math.abs(deg(v0w) - (-141.1)) < 0.5, 'v0W 코너 앵커가 −141.1° 가 아니다: ' + deg(v0w));
  assert.ok(Math.abs(Math.hypot(v0x.x, v0x.y) - 18) < 1e-9, 'v0X 코너 반경이 18.0 이 아니다');
  assert.ok(Math.abs(Math.hypot(v0w.x, v0w.y) - Math.sqrt(279)) < 1e-9,
    'v0W 코너 반경이 √279 가 아니다');

  // 일반형이 특수형을 **포함한다** — canonical 앵커가 (0,−1)·r 이면 두 시드가 같다.
  const centre = { x: 40, y: 55 };
  const corner = { x: 190, y: 20 };
  const special = CS_BLOCK_LOCATOR_INTERNALS.anchoredSimilaritySeed(centre, corner, 1, 18);
  const general = CS_BLOCK_LOCATOR_INTERNALS.anchoredSimilaritySeedTo(
    centre, corner, 1, { x: 0, y: -18 },
  );
  for (let k = 0; k < 9; k += 1) {
    assert.ok(Math.abs(special[k] - general[k]) < 1e-12,
      '일반형이 (0,−1) 특수형과 다르다: h' + k);
  }
});

// ── §12 (2026-08-16) v0W 파생 2종 ─────────────────────────────────────────
//
// **v0WQ** — v0W 의 위상 마커(SE 3×3) × v0XQ 의 중앙(QR 슬롯). 동심 사각이 v0XQ 와
// **같은 배열·같은 자리**라 코너 삼중점·코어 반경(√279)이 문자 그대로 같다. 즉
// 시드 단계에서 **안 갈라진다** — v0X ↔ v0W 와 같은 구조이고, 가르는 것은 위상 마커
// 패치와 CS 수용 게이트다. 그래서 여기서 재는 본론도 «포즈 0» 이 아니라 **«복호
// 오수용 0»** 이다 (양방향 전수).
//
// **v0WY** — 큐브 바깥 면-평면 QR. **와이어가 v0W 와 비트 동일**하다 (셀을 한 칸도
// 안 먹는다). 그래서 새 레이아웃 id 도, 새 로케이터 패밀리도 없고, 회귀가 재는 것은
// «그 동일성이 실제로 성립하는가» 다 — payload 동일 · 복호 레이아웃 v0w · 새 패밀리 0.

function renderV0wq(pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0wq', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

/** v0WY — 같은 v0W 인코딩 위에 바깥 면-평면 QR 만 얹는다. margin 은 sceneY 요구치. */
function renderV0wy(pixelsPerUnit, margin = 16) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0w', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin, qrText: TL_READER_URL, outerFaceQr: true,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

const V0WQ_FRAME = embed960(renderV0wq(15));
const V0WY_FRAME = embed960(renderV0wy(13));

test('v0WQ 자기 복호 — 톤 커브 4종 × 회전 3방향(0/120/240)', {
  timeout: 900_000,
}, () => {
  for (const [name, tone] of [
    ['none', {}], ['sCurve0.6', { sCurve: 0.6 }],
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const where = `v0wq ${name} rot${rotation}`;
      const decoded = decodeLab(distortImage(V0WQ_FRAME, { ...tone, rotation, fill: FILL }));
      assert.equal(decoded.ok, true, `${where}: ${decoded.reason || 'unknown'}`);
      assert.equal(decoded.text, PAYLOAD, where);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0wq',
        `${where} 이 남의 레이아웃으로 복호됐다: ` + decoded.hypothesis.cellSurfaceLayout);
      // 로케이터가 회전을 H 로 흡수한다 — 가설 슬롯은 항상 0.
      assert.equal(decoded.hypothesis.rotationDegrees, 0, `${where} 슬롯`);
    }
  }
});

test('v0WQ 교차 오수용 0 — 양방향 전수 (v0 · v0X · v0XQ · v0W · v0WQ)', {
  timeout: 900_000,
}, () => {
  // v0XQ ↔ v0WQ 가 이 표의 핵심 칸이다 — 코너·중앙 시드가 같으므로, 여기가 새면
  // 두 레이아웃은 서로의 프레임을 읽어 버린다.
  for (const [name, frame, wantLayout] of [
    ['v0', V0_FRAME, 'v0'],
    ['v0x', V0X_FRAME, 'v0x'],
    ['v0xq', V0XQ_FRAME, 'v0xq'],
    ['v0w', V0W_FRAME, 'v0w'],
    ['v0wq', V0WQ_FRAME, 'v0wq'],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const decoded = decodeLab(distortImage(frame, { rotation, fill: FILL }));
      assert.equal(decoded.ok, true,
        `${name} rot${rotation} 이 복호되지 않았다: ${decoded.reason || 'unknown'}`);
      assert.equal(decoded.text, PAYLOAD, `${name} rot${rotation}`);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, wantLayout,
        `${name} rot${rotation} 이 ${decoded.hypothesis.cellSurfaceLayout} 로 오수용됐다`);
    }
  }
});

test('v0WQ 교차 — Type O · A 프레임에서 v0W 계열 shape 가 서지 않는다', {
  timeout: 600_000,
}, () => {
  // cube 축 밖(hex 실루엣) 프레임 — 여기까지 재야 «전 방향 0» 이다.
  // (기존 v0W 교차 테스트는 v2r2 · v1r2 만 봤다 — 그건 같은 cube 축이다.)
  // Type O 는 version 1 에 이 페이로드가 안 들어가고(19 B > 18 B), Type A 는 삼각
  // 패치가 기본 margin 을 넘는다 — 둘 다 렌더가 던지므로 여기서 조건을 맞춘다.
  const oFrame = embed960(rasterize(
    buildScene(encode(PAYLOAD, { version: 2, eccLevel: 'M' }), { palette: PALETTE, margin: 20 }),
    { pixelsPerUnit: 12, supersample: 2 },
  ));
  const aFrame = embed960(rasterize(
    buildScene(encodeA(PAYLOAD, { version: 1, eccLevel: 'M' }), { palette: PALETTE, margin: 20 }),
    { pixelsPerUnit: 12, supersample: 2 },
  ));
  for (const [name, frame] of [['O', oFrame], ['A', aFrame]]) {
    for (const rotation of [0, 120]) {
      const luma = toRelativeLuminance(distortImage(frame, { rotation, fill: FILL }));
      const detected = detectCellSurfaceBlockShapes(luma);
      for (const layoutId of ['v0w', 'v0wq']) {
        assert.ok(!detected.shapes.some((shape) => shape.blockLocator.layoutId === layoutId),
          `Type ${name} rot${rotation} 에 ${layoutId} shape 가 섰다`);
      }
    }
  }
});

test('v0WQ 패밀리 격리 대조군 — 끄면 v0wq 포즈 0, 켜면 자기 프레임에서 선다', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0WQ_FRAME, { rotation: 0, fill: FILL }));
  const on = detectCellSurfaceBlockShapes(luma);
  assert.ok(on.diagnostics.poseCount.v0wq >= 1,
    'v0WQ 프레임에서 v0wq 포즈가 0 이다: ' + JSON.stringify(on.diagnostics.poseCount));
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0wqFamily: false } },
  });
  assert.equal(off.diagnostics.poseCount.v0wq, 0, '패밀리를 껐는데 v0wq 포즈가 섰다');
  // 그리고 v0xq 를 끄는 것과 **독립**이어야 한다 — 코너 수집을 공유하지만 스위치는 둘이다.
  const noV0xq = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0xqFamily: false } },
  });
  assert.ok(noV0xq.diagnostics.poseCount.v0wq >= 1,
    'v0xq 를 껐더니 v0wq 까지 죽었다 — 두 패밀리가 한 스위치에 묶였다');
});

test('v0WQ 편입 비침습성 — 기존 패밀리 poseCount 가 on/off 로 동일', {
  timeout: 600_000,
}, () => {
  for (const [name, frame] of [
    ['v0x', V0X_FRAME], ['v0xq', V0XQ_FRAME], ['v0w', V0W_FRAME], ['v0', V0_FRAME],
  ]) {
    const luma = toRelativeLuminance(distortImage(frame, { rotation: 0, fill: FILL }));
    const on = detectCellSurfaceBlockShapes(luma);
    const off = detectCellSurfaceBlockShapes(luma, {
      calibration: { csBlockLocator: { v0wqFamily: false } },
    });
    for (const family of ['v2r2', 'v1r2', 'v0x', 'v0xq', 'v0w', 'v0']) {
      assert.equal(on.diagnostics.poseCount[family], off.diagnostics.poseCount[family],
        `${name}: v0wq on/off 로 ${family} poseCount 가 갈렸다`);
    }
    assert.equal(off.diagnostics.poseCount.v0wq, 0, `${name}: 끈 쪽에 v0wq 포즈가 있다`);
    // 삼중점은 **공유**다 — v0xq 와 v0wq 가 같은 코너 배열을 보고 있다는 증거.
    assert.equal(on.diagnostics.centerQr.tripleCount, on.diagnostics.centerQr.v0wqTripleCount,
      `${name}: 두 패밀리의 삼중점 수가 갈렸다 — 코너 배열을 누가 건드렸다`);
  }
});

test('v0WQ 로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0WQ_FRAME, { gamma: 0.7, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma);
  const second = detectCellSurfaceBlockShapes(luma);
  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.deepEqual(
    first.shapes.map((shape) => shape.center),
    second.shapes.map((shape) => shape.center),
  );
});

test('v0WY 는 렌더 선택이다 — 와이어는 v0W 이고 데이터가 한 칸도 안 준다', {
  timeout: 600_000,
}, () => {
  // ① 인코딩이 문자 그대로 v0W 다.
  const plain = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0w', version: 1, tones: 2, eccLevel: 'M',
  });
  assert.equal(plain.cellSurfaceLayout, 'v0w');
  // ② 바깥 QR 을 얹어도 복호는 v0w 로 떨어지고 payload 가 같다.
  for (const rotation of [0, 120, 240]) {
    const decoded = decodeLab(distortImage(V0WY_FRAME, { rotation, fill: FILL }));
    const where = `v0wy rot${rotation}`;
    assert.equal(decoded.ok, true, `${where}: ${decoded.reason || 'unknown'}`);
    assert.equal(decoded.text, PAYLOAD, where);
    assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0w',
      `${where} 이 v0w 가 아닌 것으로 복호됐다: ` + decoded.hypothesis.cellSurfaceLayout);
  }
  // ③ 그리고 **새 패밀리가 생기지 않았다** — v0wy 라는 포즈 키가 존재하면 안 된다.
  const luma = toRelativeLuminance(distortImage(V0WY_FRAME, { rotation: 0, fill: FILL }));
  const detected = detectCellSurfaceBlockShapes(luma);
  assert.equal(detected.diagnostics.poseCount.v0wy, undefined,
    'v0wy 포즈 키가 생겼다 — v0WY 는 로케이터 패밀리가 아니다');
  assert.ok(detected.diagnostics.poseCount.v0w >= 1,
    'v0WY 프레임에서 v0w 포즈가 0 이다');
});
