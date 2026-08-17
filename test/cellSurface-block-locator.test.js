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
// §14 봉합 회귀 — 셰이프 정점에서 그 포즈의 H 를 되돌려 판별기를 직접 잰다.
import { estimateHomography4 } from '../src/decoder/homography.js';
import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
// §13 v0XQ 드랍 회귀가 쓰는 정본 질의 — 라인업(드랍 반영) vs 와이어(드랍 무관).
import {
  V0WQ_BLOCKS, V0W_BLOCKS, V0W2_BLOCKS, V0XQ_BLOCKS,
  allFinalLayoutIdsForN, cellSurfaceFinal, centerQrSlotCellsFor, centerQrSlotOriginFor,
  finalLayoutIdForN, finalLayoutIdsForN,
  isDroppedFinalLayout, locatorCellsCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
// 슬롯 QR 확증 회귀(2026-08-17)가 빈 슬롯 팔을 만들 때 면 기저가 필요하다.
import { faceBasis } from '../src/ygrid.js';
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
 * **드랍 복원 스위치** (운영자 확정 2026-08-16 «v2r2 · v1r2 실험판 드랍»
 * · 2026-08-17 «v0XQ 실기기 드랍»(2라운드) · 2026-08-17 «v0X 실기기 드랍»(3라운드)).
 *
 * 드랍은 «차단» 이지 «삭제» 가 아니다. 아래 v2r2 · v1r2 · v0xq · **v0x** 축의
 * 회귀는 그대로 살려 두되, 검출 라인업이 아니라 이 스위치로 켠다:
 *   · `calibration.csBlockLocator.{v2r2Family, v1r2Family, v0xqFamily, v0xFamily}`
 *     → 블록 로케이터 패밀리
 *   · `includeDroppedCellSurfaceLayouts` → CS 평가 후보 (decodeLab 경로에서만 필요)
 * 게이트(0.78 · 0.035 · CRC · RS)는 한 값도 안 건드렸다.
 * 근거·측정: `test/output/claude-v0w-program.md` · `claude-v0w2-program.md` ·
 * `claude-v0wy-program.md`.
 *
 * ⚠ **v0xqFamily 를 여기 넣는 것은 «v0wq 를 켜는 것» 이 아니다.** 코너 수집만
 * 공유한다. 그 독립성 자체를 아래 §«v0XQ 드랍» 회귀가 매 실행 증명한다.
 * ⚠ 같은 이유로 **v0xFamily 를 켜는 것은 v0w·v0w2 를 켜는 것이 아니다** — 셋은
 * 앵커드 순회의 서로 독립한 `if` 다. 아래 §«v0X 드랍» 회귀가 그것을 증명한다.
 *
 * **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (운영자 확정 2026-08-17)** —
 * v0w · v0wq · v0w2 · v0wy 네 스위치가 여기 합류했다 (같은 차단·비삭제 규약).
 * v0W 계열 축 전용으로는 아래 `RESTORE_V0W_SERIES*` 를 쓴다 — «무엇이 켜졌나» 를
 * 좁게 적기 위해서다.
 */
const RESTORE_DROPPED_LOCATOR = Object.freeze({
  calibration: {
    csBlockLocator: {
      v2r2Family: true, v1r2Family: true, v0xqFamily: true, v0xFamily: true,
      v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true,
    },
  },
});
const RESTORE_DROPPED = Object.freeze({
  includeDroppedCellSurfaceLayouts: true,
  ...RESTORE_DROPPED_LOCATOR,
});

/**
 * v0W 계열 넷만 되돌리는 스위치 (2026-08-17 v0T 편입 라운드 드랍) — v0W 축 회귀
 * 전용. 넷을 함께 켜는 이유: 계열 안 상호 의존이 실재한다 — v0W 의 rot0 감마 2칸
 * 해소가 v0W2 포즈 다양성에서 왔고(§v0W 약점 2칸의 귀속), v0WY 복호가 형제 포즈
 * 위에서 이뤄지는 프레임이 있다 (`claude-v0t-wy-restore-debug.out.txt`).
 * 개별 격리 대조군은 각 테스트가 스위치를 하나만 뒤집어 잰다.
 */
const RESTORE_V0W_SERIES_LOCATOR = Object.freeze({
  calibration: {
    csBlockLocator: {
      v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true,
    },
  },
});
/**
 * ⚠ **복원의 CS 후보는 «드랍 전 라인업» 으로 좁힌다** — `includeDropped…` (전체
 * 와이어 10후보) 가 아니다. 실측 (재실행 2026-08-17): 전체 와이어로 열면 문서에
 * 예고돼 있던 잠재 별칭 **v0wy → v0xq** 가 실물 래스터에서 활성화된다 — v0xq 의
 * 42셀은 v0wy 파인더의 톤까지 같은 부분집합이고 v0xq 후보의 슬롯 배제가 v0wy 의
 * K3 중앙을 채점 밖으로 치워 agreement 1.0 동률이 되며, 동률 타이브레이크(후보
 * 순서)가 v0xq 를 골라 포맷 판독이 죽는다 (`frontend:no-format-candidate`).
 * 드랍 전 세계에는 v0xq 후보가 없었으므로, 원형 재현 = 후보도 그때 그대로다.
 */
const PRE_V0T_LINEUP_21 = Object.freeze(['v0w', 'v0wq', 'v0w2', 'v0wy']);
// 복호까지 가는 복원은 **드랍 전 세계의 비트 재현**이다 — 후보(위)와 패밀리 구성
// (신설 v0t·v0ty 격리) 둘 다 그때 그대로여야 핀 값이 선다. 실측: v0t 를 켠 채면
// v0t 포즈 다양성이 v0W2 의 rot0 감마 약점 핀을 구제해 뒤집는다 (v0W2 가 v0W 을
// 구제했던 것과 같은 기전 — 그 자체는 개선이지만, 이 회귀들이 재는 것은 «드랍 전
// 동작이 그대로 돌아오는가» 다).
const RESTORE_V0W_SERIES = Object.freeze({
  cellSurfaceLayouts: [...PRE_V0T_LINEUP_21],
  calibration: {
    csBlockLocator: {
      v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true,
      v0tFamily: false, v0tyFamily: false,
    },
  },
});

/**
 * v0W 계열 복원 + **신설 v0t·v0ty 격리** — 슬롯 QR 확증 계수기처럼 v0wy 축의
 * 수치를 «그 패밀리 몫만» 재야 하는 회귀 전용. v0ty 는 같은 far 슬롯·같은 확증
 * 경로를 쓰므로 켠 채 재면 `slotQr.rejected` 에 v0ty 몫이 섞이고, v0t 포즈는
 * `anchoredCentres` 를 채워 불스아이 구제 경로의 분모를 바꾼다 (격리해서 재려면
 * 스위치도 각각 — v0xq ↔ v0wq 코너 수집 격리와 같은 규약).
 */
const RESTORE_V0W_SERIES_ISOLATED_LOCATOR = Object.freeze({
  calibration: {
    csBlockLocator: {
      v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true,
      v0tFamily: false, v0tyFamily: false,
    },
  },
});
/**
 * 복호까지 가는 격리 복원 — **드랍 전 세계의 비트 재현**이 필요한 회귀 전용.
 * 실측 (재실행 2026-08-17): v0t 를 켠 채 복원하면 v0W 계열 세계가 **좋아지는
 * 쪽으로도** 변한다 — v0t 포즈 다양성이 v0W2 의 rot0 감마 약점 핀을 구제해
 * 뒤집고 (v0W2 가 v0W 을 구제했던 것과 같은 기전), v0wy rot0 의 운반 포즈 구성을
 * 바꿔 복호를 떨어뜨린다. «복원 = 드랍 전 동작 그대로» 를 재려면 신설 패밀리도
 * 함께 꺼야 한다.
 */
const RESTORE_V0W_SERIES_ISOLATED = Object.freeze({
  cellSurfaceLayouts: [...PRE_V0T_LINEUP_21],
  ...RESTORE_V0W_SERIES_ISOLATED_LOCATOR,
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
  // 의도적 갱신 «v0W2 편입» (2026-08-17): v0w2 키가 늘었고 값도 0 이다 — v0W 와
  // 같은 앵커드 쌍을 쓰므로 v0W 가 0 인 프레임에서는 구조적으로 0 이다 (실측 확인).
  assert.deepEqual(first.diagnostics.poseCount, {
    // 의도적 갱신 «v0WY 편입» (2026-08-17) — 키가 하나 늘었다. **값은 0** 이므로
    // 이 프레임에서 새 패밀리가 아무것도 세우지 않는다는 사실까지 함께 고정된다.
    // 의도적 갱신 «v0T 편입» (2026-08-17) — v0t·v0ty 키가 늘었고 **값은 0** 이다
    // (같은 앵커드 쌍 요구 — 이 프레임에서 앵커드 포즈가 하나도 안 서므로 구조적 0).
    v2r2: 0, v1r2: 0, v0x: 0, v0xq: 0, v0w: 0, v0wq: 0, v0w2: 0, v0wy: 0,
    v0t: 0, v0ty: 0, v0: 6,
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
  // 의도적 갱신 «v0W2 편입» (2026-08-17): v0w2 키가 늘었고 값도 0 이다.
  assert.deepEqual(off.diagnostics.poseCount, {
    // 의도적 갱신 «v0WY 편입» (2026-08-17) — 키가 하나 늘었다. **값은 0** 이므로
    // 이 프레임에서 새 패밀리가 아무것도 세우지 않는다는 사실까지 함께 고정된다.
    // 의도적 갱신 «v0T 편입» (2026-08-17) — v0t·v0ty 키가 늘었고 **값은 0** 이다
    // (같은 앵커드 쌍 요구 — 이 프레임에서 앵커드 포즈가 하나도 안 서므로 구조적 0).
    v2r2: 0, v1r2: 0, v0x: 0, v0xq: 0, v0w: 0, v0wq: 0, v0w2: 0, v0wy: 0,
    v0t: 0, v0ty: 0, v0: 6,
  }, '격리 대조군의 전제가 움직였다 — 재측정하고 핀을 갱신하라');
});

// ─────────────────────────────────────────────────────────────────────────
// v0X 패밀리 (2026-08-16) — QR 동심 사각 SE 블록 · 사각 링 동반자 게이트.
//
// **의도적 갱신 «v0X 드랍» (운영자 실기기 확정 2026-08-17, 판정 3라운드)** —
// 아래 회귀는 **한 줄도 안 지운다**. 드랍은 차단이지 삭제가 아니고, 이 축의 값은
// 발행분 법의학·교차 오수용 대조군이 계속 쓴다. 대신 라인업이 아니라 복원
// 스위치로 켠다 (v2r2·v1r2·v0xq 와 **같은 규약**):
//   · 복호 경로 → `RESTORE_DROPPED` (패밀리 + CS 후보를 함께 되돌린다)
//   · 검출 전용 → `RESTORE_V0X_LOCATOR` (패밀리만)
// 게이트(0.78 · 0.035 · CRC · RS)는 한 값도 안 건드렸다.
// ─────────────────────────────────────────────────────────────────────────

/** v0X 만 되돌리는 최소 스위치 — 검출 전용 경로에서 «무엇이 켜졌나» 를 좁게 적는다. */
const RESTORE_V0X_LOCATOR = Object.freeze({
  calibration: { csBlockLocator: { v0xFamily: true } },
});

test('v0X S-커브 — CS 수용을 넘어 body RS 복호까지 간다 (드랍 복원)', { timeout: 300_000 }, () => {
  const result = decodeLab(distortImage(V0X_FRAME, { sCurve: 0.6, fill: FILL }), RESTORE_DROPPED);
  assert.equal(result.ok, true, 'v0X S-커브 복호: ' + (result.reason || ''));
  assert.equal(result.text, PAYLOAD);
  assert.equal(result.hypothesis.cellSurfaceLayout, 'v0x');
});

test('v0X 감마 0.7/0.6 — 두 커브 모두 복호된다 (드랍 복원)', { timeout: 300_000 }, () => {
  for (const gamma of [0.7, 0.6]) {
    const result = decodeLab(distortImage(V0X_FRAME, { gamma, fill: FILL }), RESTORE_DROPPED);
    assert.equal(result.ok, true, 'v0X 감마 ' + gamma + ': ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v0x');
  }
});

test('v0X 회전 슬롯 0/120/240 전수 — 자기 레이아웃으로 복호된다 (드랍 복원)', { timeout: 600_000 }, () => {
  for (const rotation of [0, 120, 240]) {
    const result = decodeLab(
      distortImage(V0X_FRAME, { gamma: 0.7, rotation, fill: FILL }), RESTORE_DROPPED,
    );
    assert.equal(result.ok, true, 'v0X rot' + rotation + ': ' + (result.reason || ''));
    assert.equal(result.text, PAYLOAD);
    assert.equal(result.hypothesis.cellSurfaceLayout, 'v0x');
  }
});

test('v0X 로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출 (드랍 복원)', { timeout: 300_000 }, () => {
  const luma = toRelativeLuminance(distortImage(V0X_FRAME, { gamma: 0.7, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma, RESTORE_V0X_LOCATOR);
  const second = detectCellSurfaceBlockShapes(luma, RESTORE_V0X_LOCATOR);
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
  // 의도적 갱신 «v0X 드랍» (2026-08-17): 패밀리가 기본 off 라 포즈 단언 쪽만
  // 복원 스위치로 켠다. **동반자 쌍은 스위치와 무관하다** — 사각 링 동반자는
  // 코너 클러스터 기하이지 패밀리 시딩의 산물이 아니기 때문이고, 아래에서
  // 그 독립성 자체도 함께 잰다 (켠 값과 끈 값이 같아야 한다).
  for (const tone of [{ gamma: 0.7 }, { sCurve: 0.6 }, {}]) {
    const luma = toRelativeLuminance(distortImage(V0X_FRAME, { ...tone, fill: FILL }));
    const v0x = detectCellSurfaceBlockShapes(luma, RESTORE_V0X_LOCATOR);
    assert.ok(
      v0x.diagnostics.squareRing.companionPairs >= 2,
      'v0X 프레임 동반자 쌍이 2 미만: ' + JSON.stringify(v0x.diagnostics.squareRing),
    );
    assert.ok(v0x.diagnostics.poseCount.v0x >= 1, 'v0X 포즈가 없다');
  }
  // v1r2 프레임 — 동반자 0 이므로 게이트가 v0x 시딩을 막는다.
  const v1r2 = detectCellSurfaceBlockShapes(
    toRelativeLuminance(distortImage(V1R2_FRAME, { gamma: 0.7, fill: FILL })),
    RESTORE_V0X_LOCATOR,
  );
  assert.equal(v1r2.diagnostics.squareRing.companionPairs, 0,
    'v1r2 프레임에 사각 링 동반자가 생겼다');
  assert.equal(v1r2.diagnostics.poseCount.v0x, 0,
    'v1r2 프레임에서 v0x 포즈가 섰다: ' + JSON.stringify(v1r2.diagnostics.poseCount));
});

test('v0X 패밀리를 끄면 v0x 포즈가 사라진다 (패밀리 격리 대조군 — 이제 «끔» 이 기본)', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0X_FRAME, { gamma: 0.7, fill: FILL }));
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0xFamily: false } },
  });
  assert.equal(off.diagnostics.poseCount.v0x, 0);
  // 의도적 갱신 «v0X 드랍» (2026-08-17): 이제 **명시하지 않아도** 같은 결과다 —
  // 기본이 off 이기 때문이다. 드랍이 실제로 걸렸다는 증거를 여기서 함께 잰다.
  assert.equal(
    detectCellSurfaceBlockShapes(luma).diagnostics.poseCount.v0x, 0,
    '기본 캘리브레이션에서 v0x 포즈가 섰다 — 드랍이 안 걸렸다',
  );
  assert.ok(
    detectCellSurfaceBlockShapes(luma, RESTORE_V0X_LOCATOR).diagnostics.poseCount.v0x >= 1,
    '복원 스위치를 켰는데 v0x 포즈가 없다 — 차단이 아니라 삭제가 됐다',
  );
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
    // 의도적 갱신 «v0X 드랍» (2026-08-17): 구 인쇄물 판독은 정확히 **드랍 복원
    // 경로가 존재하는 이유**다 — 라인업에서 내려도 발행된 종이는 계속 읽혀야 한다.
    const result = decodeLab(frame, RESTORE_DROPPED);
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
  // 의도적 갱신 «v0W2 편입» (2026-08-17): v0w2 키가 늘었고 값도 0 이다 (같은 이유 —
  // v0W2 도 K3 중앙 × K5 원거리 쌍을 요구한다).
  assert.deepEqual(detected.diagnostics.poseCount, {
    // 의도적 갱신 «v0WY 편입» (2026-08-17) — 키 하나 추가, 값 0.
    // 의도적 갱신 «v0T 편입» (2026-08-17) — v0t·v0ty 키 추가, 값 0 (같은 이유 —
    // 소각 디자인 프레임에는 K3 중앙 × K5 원거리 쌍이 성립하지 않는다).
    v2r2: 0, v1r2: 0, v0x: 0, v0xq: 0, v0w: 0, v0wq: 0, v0w2: 0, v0wy: 0,
    v0t: 0, v0ty: 0, v0: 0,
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

test('v0xq — 톤 커브 4종 × 회전 3방향(0/120/240) 전부 body RS 까지 복호된다 (드랍 복원)', {
  timeout: 600_000,
}, () => {
  // **의도적 갱신 «v0XQ 드랍» (운영자 실기기 확정 2026-08-17)** — 이 12칸은 한 값도
  // 안 바뀐다. 바뀐 것은 «기본 라인업에서 도는가» 뿐이라, v2r2·v1r2 축과 **같은
  // 방식으로** 복원 스위치를 통해 계속 잰다 (RESTORE_DROPPED). 판정 게이트는 무접촉 —
  // 스위치를 켠 세계의 결과가 드랍 전과 바이트 동일하다는 것이 이 테스트의 내용이다.
  for (const [name, tone] of [
    ['none', {}], ['sCurve0.6', { sCurve: 0.6 }],
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const result = decodeLab(
        distortImage(V0XQ_FRAME, { ...tone, rotation, fill: FILL }), RESTORE_DROPPED,
      );
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

test('v0xq 교차 — 다른 레이아웃 프레임에서 v0xq 포즈가 서지 않는다 (드랍 복원)', {
  timeout: 600_000,
}, () => {
  // **의도적 갱신 «v0XQ 드랍» (2026-08-17)** — 대조군을 폐기하지 않는다.
  // 기본 cfg 에서는 v0xq 포즈가 «어디서도 0» 이라 이 표가 통째로 공허해진다
  // (자기 프레임 포함 — 아래 반대 방향 단언이 그 사실을 스스로 잡는다).
  // 그래서 **복원 스위치를 켠 세계에서** 종전과 같은 값을 계속 잰다.
  const restore = RESTORE_DROPPED_LOCATOR;
  for (const [name, frame] of [
    ['v0x', V0X_FRAME], ['v2r2', V2R2_FRAME], ['v1r2', V1R2_FRAME], ['v0', V0_FRAME],
  ]) {
    for (const rotation of [0, 120]) {
      const luma = toRelativeLuminance(distortImage(frame, { rotation, fill: FILL }));
      const detected = detectCellSurfaceBlockShapes(luma, restore);
      assert.equal(detected.diagnostics.poseCount.v0xq, 0,
        `${name} rot${rotation} 프레임에 v0xq 포즈가 섰다`);
      assert.ok(!detected.shapes.some((shape) => shape.blockLocator.family === 'v0xq'),
        `${name} rot${rotation} 에 v0xq shape 가 생겼다`);
    }
  }
  // 반대 방향 — v0xq 프레임에서는 실제로 선다 (대조군이 «항상 0» 인 자를 재는 게
  // 아님을 여기서 못 박는다).
  const own = detectCellSurfaceBlockShapes(
    toRelativeLuminance(distortImage(V0XQ_FRAME, { rotation: 0, fill: FILL })), restore,
  );
  assert.ok(own.diagnostics.poseCount.v0xq > 0, 'v0xq 프레임에서도 포즈가 0 이다 — 자가 죽었다');
});

test('v0xq 시딩 게이트 — 중앙 QR 정합이 남의 프레임 삼중점을 시드 전에 자른다', {
  timeout: 600_000,
}, () => {
  // **의도적 갱신 «v0XQ 드랍» (2026-08-17)** — 두 팔 모두 `v0xqFamily: true` 를 깐다.
  // 게이트 값(0.25 상관 하한)은 안 건드렸고, 재는 대상이 «기본 라인업» 에서
  // «복원 스위치를 켠 세계» 로 옮겼을 뿐이다. 안 옮기면 centreRejected 가 구조적으로
  // 0 이 되어 이 자가 «항상 0» 을 재게 된다.
  // **의도적 갱신 «교차 누수 봉합» (2026-08-17)** — 상관 게이트가 «무엇을 자르나» 를
  // 재려면 그 **앞에 선 두 조건**(불스아이 거부권 · QR 다움)을 두 팔 모두에서 꺼야
  // 한다. 안 그러면 거부권이 삼중점을 먼저 걷어가 centreRejected 가 0 이 되고,
  // 이 자는 자기가 겨냥한 것을 못 잰다. 게이트 값(0.25)은 여전히 무접촉이다.
  const SEAL_OFF = { centreQrBullseyeVeto: false, centreQrRequireFinderContrast: false };
  const luma = toRelativeLuminance(distortImage(V0X_FRAME, { rotation: 0, fill: FILL }));
  const on = detectCellSurfaceBlockShapes(luma, {
    calibration: {
      ...RESTORE_DROPPED_LOCATOR.calibration,
      csBlockLocator: { ...RESTORE_DROPPED_LOCATOR.calibration.csBlockLocator, ...SEAL_OFF },
    },
  });
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: {
      csBlockLocator: { v0xqFamily: true, v0xqRequireCenterQr: false, ...SEAL_OFF },
    },
  });
  // v0X 의 SE 동심 사각도 120° 삼중점을 만든다 — 게이트가 **시드 단계에서** 자른다.
  assert.ok(on.diagnostics.centerQr.centreRejected > 0,
    'v0X 프레임에서 중앙 QR 게이트가 아무것도 자르지 않았다 — 게이트가 잠들었으면 주석을 고쳐라');
  // ★ 신설 (같은 프레임, 봉합 **켠** 팔) — 거부권이 그 삼중점을 상관 게이트보다
  // 먼저 걷어간다. 이것이 «가짜를 더 잘 거른다» 의 코드 고정이다.
  const sealed = detectCellSurfaceBlockShapes(luma, RESTORE_DROPPED_LOCATOR);
  assert.ok(sealed.diagnostics.centerQr.bullseyeVetoed > 0,
    'v0X 프레임에서 중앙 불스아이 거부권이 삼중점을 하나도 안 걷었다');
  assert.equal(sealed.diagnostics.poseCount.v0xq, 0);
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
  // ⚠ **의도적 갱신 «교차 누수 봉합» (2026-08-17)** — 이 자가 재는 명제
  // («상관 게이트는 살아남는 포즈를 한 개도 못 자른다»)는 **여전히 참이고 그대로
  // 잰다**. 다만 두 팔 모두에서 봉합 두 조건을 꺼야 그 명제를 잴 수 있다 —
  // 봉합이 켜지면 삼중점 자체가 걷혀 양쪽 다 0 이 되고, 자가 무뎌지기 때문이다.
  // 그리고 **세 번째 팔**을 새로 더한다: 봉합을 켠 팔에서 같은 포즈가 실제로
  // 사라지는가. 그것이 이 레인이 고친 것의 코드 고정이다.
  const SEAL_OFF2 = { centreQrBullseyeVeto: false, centreQrRequireFinderContrast: false };
  const v0x3 = embed960(renderFinal3Tone('v0x', 1, 15));
  let posesSeen = 0;
  let cutBySeedGate = 0;
  let posesAfterSeal = 0;
  for (const [name, tone] of [
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
    ['sCurve0.6', { sCurve: 0.6 }], ['sCurve0.9', { sCurve: 0.9 }],
  ]) {
    for (const rotation of [0, 120]) {
      // 의도적 갱신 «v0XQ 드랍» (2026-08-17) — 위 테스트와 같은 이유로 두 팔에
      // `v0xqFamily: true` 를 깐다 (게이트 값 무접촉).
      const luma = toRelativeLuminance(distortImage(v0x3, { ...tone, rotation, fill: FILL }));
      const on = detectCellSurfaceBlockShapes(luma, {
        calibration: {
          ...RESTORE_DROPPED_LOCATOR.calibration,
          csBlockLocator: {
            ...RESTORE_DROPPED_LOCATOR.calibration.csBlockLocator, ...SEAL_OFF2,
          },
        },
      });
      const off = detectCellSurfaceBlockShapes(luma, {
        calibration: {
          csBlockLocator: { v0xqFamily: true, v0xqRequireCenterQr: false, ...SEAL_OFF2 },
        },
      });
      const sealed = detectCellSurfaceBlockShapes(luma, RESTORE_DROPPED_LOCATOR);
      posesSeen += on.diagnostics.poseCount.v0xq;
      posesAfterSeal += sealed.diagnostics.poseCount.v0xq;
      cutBySeedGate += off.diagnostics.poseCount.v0xq - on.diagnostics.poseCount.v0xq;
      assert.equal(on.diagnostics.poseCount.v0xq, off.diagnostics.poseCount.v0xq,
        `v0x 3톤 ${name} rot${rotation}: 시딩 게이트 ON/OFF 로 v0xq 포즈 수가 갈렸다`);
    }
  }
  assert.ok(posesSeen > 0,
    'v0X 3톤 열화에서 v0xq 포즈가 하나도 안 섰다 — 이 테스트가 «항상 0» 인 자를 재고 있다');
  assert.equal(cutBySeedGate, 0, '시딩 게이트가 살아남는 포즈를 잘랐다 — cfg 주석을 고쳐라');
  // ★ 신설 — 상관 게이트가 못 자르던 그 포즈들을 봉합이 **전부** 자른다.
  assert.equal(posesAfterSeal, 0,
    `봉합(불스아이 거부권 + QR 다움)이 v0X 프레임의 가짜 v0xq 포즈를 남겼다: ${posesAfterSeal}`
    + ` (봉합 전 ${posesSeen})`);

  // 그런데도 복호는 v0x 로 간다 — 막는 단계가 CS 수용 게이트임을 결과로 확인한다.
  // (통합자 강화 2026-08-16, 검증 렌즈 지적 7) 조건부 가드였던 것을 강제로 바꿨다 —
  // 이 프레임이 복호에 실패하면 오수용 핀이 조용히 공허해지므로, 실패 자체를 빨갛게 한다.
  // 회전 축을 더한 김에 복호 확인도 두 회전 모두에서 한다 — 포즈가 실제로 서는 쪽이
  // rot120 이므로, 오수용 분모가 있는 칸을 반드시 포함하게 된다.
  // 의도적 갱신 «v0X 드랍» (2026-08-17): 이 복호도 드랍 복원 위에서 잰다 —
  // 재는 명제(«CS 수용 게이트가 v0xq 오수용을 막는다»)는 v0x 가 후보로 살아 있어야
  // 성립하고, 그 조건이 정확히 복원 스위치다. 게이트 값은 무접촉.
  for (const rotation of [0, 120]) {
    const decoded = decodeLab(
      distortImage(v0x3, { gamma: 0.7, rotation, fill: FILL }), RESTORE_DROPPED,
    );
    assert.equal(decoded.ok, true,
      `v0X 3톤 감마 rot${rotation} 프레임이 복호에 실패했다 — 오수용 핀의 분모가 사라진다: `
      + (decoded.reason || ''));
    assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0x',
      `v0X 3톤 감마 rot${rotation} 프레임이 v0xq 로 오수용됐다 — CS 수용 게이트가 뚫혔다`);
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
  // 의도적 갱신 «v0XQ 드랍» (2026-08-17) — 복원 스위치를 켠 세계에서 잰다.
  // (기본 cfg 에서도 결정적이지만, 그때는 v0xq 경로가 아예 안 돌아 자가 무뎌진다.)
  const luma = toRelativeLuminance(distortImage(V0XQ_FRAME, { rotation: 0, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma, RESTORE_DROPPED_LOCATOR);
  const second = detectCellSurfaceBlockShapes(luma, RESTORE_DROPPED_LOCATOR);
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
  //
  // **의도적 갱신 «v0XQ 드랍» (2026-08-17)** — on/off 의 «on» 이 기본값이 아니라
  // **복원 스위치를 켠 쪽**이 됐다 (기본이 off 로 뒤집혔으므로). 재는 명제는 그대로다:
  // «v0xq 패밀리를 켜고 끄는 것이 다른 패밀리의 관측을 한 자리도 안 흔든다».
  for (const [name, frame] of [
    ['v0x', V0X_FRAME], ['v2r2', V2R2_FRAME], ['v1r2', V1R2_FRAME], ['v0', V0_FRAME],
  ]) {
    const luma = toRelativeLuminance(distortImage(frame, { rotation: 0, fill: FILL }));
    const on = detectCellSurfaceBlockShapes(luma, RESTORE_DROPPED_LOCATOR);
    // **의도적 갱신 «v0W 파생 2종 편입» (2026-08-16)** — 코너 검증 순회는 이제
    // v0xq·v0wq 가 **공유**한다 (같은 동심 사각 블록이라 두 번 훑을 이유가 없다).
    // 그래서 «코너 검증이 안 돈다» 를 보려면 **두 패밀리를 다 꺼야** 한다.
    // v0xq 하나만 끈 쪽은 여전히 코너를 훑는다 — 그것이 침습이 아니라 공유다.
    const off = detectCellSurfaceBlockShapes(luma, {
      calibration: {
        ...RESTORE_DROPPED_LOCATOR.calibration,
        csBlockLocator: {
          ...RESTORE_DROPPED_LOCATOR.calibration.csBlockLocator, v0xqFamily: false,
        },
      },
    });
    const offBoth = detectCellSurfaceBlockShapes(luma, {
      calibration: {
        ...RESTORE_DROPPED_LOCATOR.calibration,
        csBlockLocator: {
          ...RESTORE_DROPPED_LOCATOR.calibration.csBlockLocator,
          v0xqFamily: false, v0wqFamily: false,
        },
      },
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
    // **의도적 갱신 «중앙 불스아이 확증 조립» (2026-08-17)** — 느슨한 코너 순회의
    // 소비자가 셋이 됐다 (v0xq 삼중점 · v0wq 삼중점 · **불스아이 확증 조립**).
    // 그래서 «코너 검증이 안 돈다» 를 보려면 **셋을 다 꺼야** 한다.
    // 근거 실측: 셋 중 하나만 켜도 corners > 0 (이 프레임 5개) — 공유이지 침습이 아니다.
    // 비침습성 명제 자체는 위 verified·poseCount 단언이 그대로 지키고 있다.
    const offAllThree = detectCellSurfaceBlockShapes(luma, {
      calibration: {
        ...RESTORE_DROPPED_LOCATOR.calibration,
        csBlockLocator: {
          ...RESTORE_DROPPED_LOCATOR.calibration.csBlockLocator,
          v0xqFamily: false, v0wqFamily: false, centreBullseyeConfirmedPoses: false,
        },
      },
    });
    assert.equal(offAllThree.diagnostics.centerQr.corners, 0,
      name + ' 셋 다 껐는데 코너 검증이 돌았다');
    assert.equal(offBoth.diagnostics.centerQr.corners, on.diagnostics.centerQr.corners,
      name + ' 확증 조립만 켠 쪽의 코너 수가 갈렸다 — 공유 순회가 끊겼다');
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
/**
 * **의도적 갱신 «v0W2 편입» (2026-08-17) — 약점 2칸이 사라졌다.**
 *
 * 위 주석이 «약점이 사라졌으면 재측정하고 핀을 갱신하라» 고 적어 둔 그 일이 일어났다.
 * 실측: 기본 cfg 에서 v0W 는 이제 **12/12** 다 (gamma0.7·gamma0.6 × rot0 포함).
 *
 * 원인은 게이트가 아니다 — 이 레인은 0.78·0.035·CRC·RS 를 한 값도 안 건드렸다.
 * 원인은 **포즈 다양성**이다: v0W2 패밀리가 같은 (중앙, 코너) 쌍에서 자기 패치로
 * 한 번 더 refinePose 를 돌리고, 그 포즈가 셰이프 목록에 들어가면서 v0W **레이아웃**
 * 채점이 더 나은 기하 위에서 이뤄진다. 아래 두 번째 팔이 그 귀속을 증명한다 —
 * `v0w2Family: false` 로 되돌리면 **옛 실패가 좌표까지 그대로 재현된다**
 * (frontend:no-grid-hypothesis / BODY_RS_FAILED / v0w 포즈는 살아 있음).
 *
 * 그래서 옛 핀을 **폐기하지 않고 대조군으로 옮겼다**. 폐기하면 «v0W2 를 내렸을 때
 * v0W 가 어디로 돌아가는가» 를 다시는 못 재게 된다.
 */
const V0W_TONE_PINS = Object.freeze([
  ['clean', {}, [0, 120, 240], []],
  ['sCurve0.6', { sCurve: 0.6 }, [0, 120, 240], []],
  ['gamma0.7', { gamma: 0.7 }, [0, 120, 240], []],
  ['gamma0.6', { gamma: 0.6 }, [0, 120, 240], []],
]);

/** v0W2 편입 **전**의 v0W 핀 — 아래 대조군 팔이 이 좌표를 그대로 재현해야 한다. */
const V0W_TONE_PINS_BEFORE_V0W2 = Object.freeze([
  ['gamma0.7', { gamma: 0.7 }, [0]],
  ['gamma0.6', { gamma: 0.6 }, [0]],
]);

// **의도적 갱신 «v0W 계열 전체 드랍» (2026-08-17 v0T 편입 라운드)** — 아래 v0W 축
// 회귀 전부가 복원 스위치(RESTORE_V0W_SERIES*) 위에서 돈다 (v2r2·v1r2·v0xq·v0x
// 전례와 같은 규약 — 값은 드랍 전 그대로여야 «차단·비삭제» 가 증명된다).
test('v0W 자기 복호 (드랍 복원) — 톤 커브 4종 × 회전 3방향 (v0W2 편입으로 rot0 약점 2칸 해소)', {
  timeout: 900_000,
}, () => {
  for (const [label, distort, wantOk, wantFail] of V0W_TONE_PINS) {
    for (const rotation of wantOk) {
      const decoded = decodeLab(
        distortImage(V0W_FRAME, { ...distort, rotation, fill: FILL }), RESTORE_V0W_SERIES,
      );
      const where = `v0W ${label} rot${rotation}`;
      assert.equal(decoded.ok, true, `${where}: ${decoded.reason || ''}`);
      assert.equal(decoded.text, PAYLOAD, where);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0w',
        `${where} 이 남의 레이아웃으로 복호됐다: ` + decoded.hypothesis.cellSurfaceLayout);
    }
    for (const rotation of wantFail) {
      const frame = distortImage(V0W_FRAME, { ...distort, rotation, fill: FILL });
      const decoded = decodeLab(frame, RESTORE_V0W_SERIES);
      const where = `v0W ${label} rot${rotation}`;
      assert.equal(decoded.ok, false,
        `${where} 이 초록이 됐다 — 약점이 사라졌으면 재측정하고 핀을 갱신하라`);
      assert.equal(decoded.reason, 'frontend:no-grid-hypothesis', where + ' 실패 이유');
      const detected = detectCellSurfaceBlockShapes(
        toRelativeLuminance(frame), RESTORE_V0W_SERIES_LOCATOR,
      );
      assert.ok(detected.diagnostics.poseCount.v0w >= 1,
        `${where} 에서 v0w 포즈까지 죽었다 — 약점의 귀속이 바뀌었다`);
      assert.equal(decoded.detail.pipelineCode, 'BODY_RS_FAILED',
        `${where} 이 body RS 앞에서 죽었다 — 귀속이 바뀌었다: `
        + JSON.stringify(decoded.detail && decoded.detail.pipelineCode));
    }
  }
});

test('v0W 약점 2칸의 귀속 — v0W2 패밀리를 끄면 옛 실패가 그대로 재현된다 (대조군 보존)', {
  timeout: 900_000,
}, () => {
  // 이 테스트가 없으면 위 «12/12» 는 «게이트가 느슨해졌나?» 와 구별되지 않는다.
  // 끄는 것은 **패밀리 하나**이고 게이트는 어느 값도 안 만진다.
  // (드랍 후에는 복원 스위치 위에서 잰다 — «계열 복원 − v0w2» 대 «계열 복원 전체».)
  const NO_V0W2 = {
    includeDroppedCellSurfaceLayouts: true,
    calibration: {
      csBlockLocator: {
        v0wFamily: true, v0wqFamily: true, v0wyFamily: true, v0w2Family: false,
      },
    },
  };
  for (const [label, distort, rotations] of V0W_TONE_PINS_BEFORE_V0W2) {
    for (const rotation of rotations) {
      const frame = distortImage(V0W_FRAME, { ...distort, rotation, fill: FILL });
      const where = `v0W ${label} rot${rotation} (v0w2 off)`;
      const decoded = decodeLab(frame, NO_V0W2);
      assert.equal(decoded.ok, false,
        `${where} 이 초록이다 — 약점 해소의 귀속이 v0W2 가 아니다`);
      assert.equal(decoded.reason, 'frontend:no-grid-hypothesis', where + ' 실패 이유');
      assert.equal(decoded.detail.pipelineCode, 'BODY_RS_FAILED', where + ' 실패 단계');
      // 죽는 단계는 **로케이터가 아니다** — v0w 포즈는 그대로 선다 (옛 핀과 같은 귀속).
      const detected = detectCellSurfaceBlockShapes(
        toRelativeLuminance(frame), { calibration: NO_V0W2.calibration },
      );
      assert.ok(detected.diagnostics.poseCount.v0w >= 1, where + ' 에서 v0w 포즈까지 죽었다');
      assert.equal(detected.diagnostics.poseCount.v0w2, 0, where + ' 에서 v0w2 포즈가 섰다');
      // 그리고 같은 칸이 계열 복원 전체에서는 초록이다 — 두 팔의 차이가 곧 귀속이다.
      const on = decodeLab(frame, RESTORE_V0W_SERIES);
      assert.equal(on.ok, true, `${where} 의 복원 팔이 실패했다: ${on.reason || ''}`);
      assert.equal(on.hypothesis.cellSurfaceLayout, 'v0w');
    }
  }
});

test('v0W 교차 오수용 0 — 양방향 전수 (v0 · v0X · v0XQ · v0W)', {
  timeout: 900_000,
}, () => {
  // «남의 프레임이 v0W 로 복호되지 않는다» 와 «v0W 프레임이 남으로 복호되지 않는다» 를
  // 같은 표에서 잰다. 한쪽만 재면 A/B 가 다른 축을 가린다.
  //
  // **의도적 갱신 «v0XQ 드랍» (2026-08-17)** — v0XQ 행만 복원 스위치를 깐다.
  // 대조군을 폐기하지 않는 것이 요점이다: 드랍된 레이아웃을 표에서 빼면
  // «v0XQ ↔ v0W 가 서로 새는가» 를 다시는 못 재게 된다.
  // **의도적 갱신 «v0X 드랍» (2026-08-17, 3라운드)** — 같은 규약으로 v0X 행에도
  // 복원 스위치를 깐다. 행은 **그대로 남는다** — 운영자 관측 「v0 과 혼선 자주」 가
  // 가리키는 축이 바로 이 표의 v0 ↔ v0x 칸이라, 드랍했다고 표에서 빼면 그 관측을
  // 다시는 재현할 수 없게 된다.
  // **의도적 갱신 «v0W 계열 드랍» (2026-08-17)** — v0w 행도 복원 스위치를 깐다
  // (같은 규약 — 행을 빼면 이 축의 교차 관측을 다시는 못 잰다).
  for (const [name, frame, wantLayout, extra] of [
    ['v0', V0_FRAME, 'v0', {}],
    ['v0x', V0X_FRAME, 'v0x', RESTORE_DROPPED],
    ['v0xq', V0XQ_FRAME, 'v0xq', RESTORE_DROPPED],
    ['v0w', V0W_FRAME, 'v0w', RESTORE_V0W_SERIES],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const decoded = decodeLab(distortImage(frame, { rotation, fill: FILL }), extra);
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
  // (드랍 후에는 계열 복원 위에서 재야 «켜져 있어도 안 선다» 를 잰다 — 꺼진 채면 자명하다.)
  for (const [name, frame] of [['v2r2', V2R2_FRAME], ['v1r2', V1R2_FRAME]]) {
    for (const rotation of [0, 120]) {
      const luma = toRelativeLuminance(distortImage(frame, { rotation, fill: FILL }));
      const detected = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_LOCATOR);
      assert.ok(!detected.shapes.some((shape) => shape.blockLocator.layoutId === 'v0w'),
        `${name} rot${rotation} 에 v0W shape 가 섰다`);
    }
  }
});

test('v0W 패밀리 격리 대조군 — 기본(드랍) = 명시 off = 0, 복원하면 자기 프레임에서 선다', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0W_FRAME, { rotation: 0, fill: FILL }));
  // 드랍 후 «켬» 은 복원 스위치다.
  const on = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_LOCATOR);
  assert.ok(on.diagnostics.poseCount.v0w >= 1,
    'v0W 프레임에서 복원해도 v0w 포즈가 0 이다: ' + JSON.stringify(on.diagnostics.poseCount));
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0wFamily: false } },
  });
  assert.equal(off.diagnostics.poseCount.v0w, 0, '패밀리를 껐는데 v0w 포즈가 섰다');
  // 드랍 기본값과 명시 off 가 같은 값을 내는 것이 드랍이 실제로 걸렸다는 증거다.
  assert.equal(detectCellSurfaceBlockShapes(luma).diagnostics.poseCount.v0w, 0,
    '기본 cfg 에 v0w 포즈가 섰다 — 드랍이 안 걸렸다');
});

test('v0W 로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출 (드랍 복원)', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0W_FRAME, { gamma: 0.7, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_LOCATOR);
  const second = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_LOCATOR);
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
  // (드랍 후 «on» 은 명시 복원이다 — 기본이 off 로 바뀌었으므로.)
  for (const [name, frame] of [
    ['v0x', V0X_FRAME], ['v2r2', V2R2_FRAME], ['v1r2', V1R2_FRAME],
    ['v0', V0_FRAME], ['v0xq', V0XQ_FRAME],
  ]) {
    const luma = toRelativeLuminance(distortImage(frame, { rotation: 0, fill: FILL }));
    const on = detectCellSurfaceBlockShapes(luma, {
      calibration: { csBlockLocator: { v0wFamily: true } },
    });
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
// **v0WY** — ⚠ **2026-08-17 운영자 재설계로 물건이 바뀌었다.** 구 v0WY 는 큐브 바깥
// 허공의 면-평면 QR 이라 와이어가 v0W 와 비트 동일했고, 그래서 새 id 도 새 패밀리도
// 없었다. 지금의 v0WY 는 QR 이 실루엣 **안쪽 먼 코너** [13,20]² 에 8×8 슬롯으로
// 묻히고 위상 마커가 SE → SW 로 옮겨 간 **진짜 레이아웃**이다 (파인더 67 · 데이터 280).
//
// 그래서 이 파일에서 재는 것도 «동일성» 에서 **«구별»** 로 뒤집힌다. 그리고 v0WY 는
// 중앙 K3 도 NE 동심 사각도 v0W 와 **같은 배열·같은 자리**라 시드 기하가 문자 그대로
// 같다 — v0X ↔ v0W 보다 한 단계 더 붙어 있다. 가르는 것은 셋이다:
//   ⓐ 위상 마커 자리 (SE 9 ↔ SW 6) — refinePose 의 Pearson 서브앵커
//   ⓑ 먼 코너 슬롯의 **QR 다움** (`v0wyRequireSlotQr` — 봉합 ② 인프라 재사용)
//   ⓒ 하류 CS 수용 게이트 (0.78 · 0.035, **무접촉**)

function renderV0wq(pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0wq', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

/**
 * v0WY — **자기 레이아웃으로** 인코드한다 (구 판본은 v0W 인코딩 위에 허공 QR 만
 * 얹었다 — 그때는 그것이 v0WY 의 전부였기 때문이다). 슬롯이 레이아웃 정의라
 * qrText 가 필수다.
 */
function renderV0wy(pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0wy', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

const V0WQ_FRAME = embed960(renderV0wq(15));
const V0WY_FRAME = embed960(renderV0wy(15));

test('v0WQ 자기 복호 (드랍 복원) — 톤 커브 4종 × 회전 3방향(0/120/240)', {
  timeout: 900_000,
}, () => {
  for (const [name, tone] of [
    ['none', {}], ['sCurve0.6', { sCurve: 0.6 }],
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const where = `v0wq ${name} rot${rotation}`;
      const decoded = decodeLab(
        distortImage(V0WQ_FRAME, { ...tone, rotation, fill: FILL }), RESTORE_V0W_SERIES,
      );
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
  //
  // **의도적 갱신 «v0XQ 드랍» (2026-08-17)** — v0XQ 행에만 복원 스위치를 깐다.
  // 이 행이 표에서 빠지면 «드랍 뒤에도 v0WQ 가 v0XQ 프레임을 안 먹는가» 를 못 재게
  // 되고, 그것이야말로 드랍이 만들 수 있는 새 결함이다. 나머지 네 행은 무접촉이므로
  // «남의 프레임이 v0XQ 로 오수용되는가» 는 **기본 라인업에서** 계속 잰다
  // (드랍 뒤엔 v0xq 후보 자체가 없어 오수용이 구조적으로 불가능해진다 — 그것도 결과다).
  // **의도적 갱신 «v0X 드랍» (2026-08-17, 3라운드)** — v0X 행에도 같은 스위치.
  // **의도적 갱신 «v0W 계열 드랍» (2026-08-17)** — v0w·v0wq 행도 복원 스위치를 깐다.
  for (const [name, frame, wantLayout, extra] of [
    ['v0', V0_FRAME, 'v0', {}],
    ['v0x', V0X_FRAME, 'v0x', RESTORE_DROPPED],
    ['v0xq', V0XQ_FRAME, 'v0xq', RESTORE_DROPPED],
    ['v0w', V0W_FRAME, 'v0w', RESTORE_V0W_SERIES],
    ['v0wq', V0WQ_FRAME, 'v0wq', RESTORE_V0W_SERIES],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const decoded = decodeLab(distortImage(frame, { rotation, fill: FILL }), extra);
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
      // 계열 복원 위에서 잰다 — 꺼진 채면 «안 선다» 가 자명해서 아무것도 못 잰다.
      const detected = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_LOCATOR);
      // 의도적 갱신 «v0WY 편입» (2026-08-17) — 새 패밀리도 cube 축 밖에서 0 이어야 한다.
      // 의도적 갱신 «v0T 편입» (2026-08-17) — v0t·v0ty 도 같은 명제다.
      for (const layoutId of ['v0w', 'v0wq', 'v0wy', 'v0t', 'v0ty']) {
        assert.ok(!detected.shapes.some((shape) => shape.blockLocator.layoutId === layoutId),
          `Type ${name} rot${rotation} 에 ${layoutId} shape 가 섰다`);
      }
    }
  }
});

test('v0WQ 패밀리 격리 대조군 — 기본(드랍) = 명시 off = 0, 복원하면 자기 프레임에서 선다', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0WQ_FRAME, { rotation: 0, fill: FILL }));
  // 드랍 후 «켬» 은 복원 스위치다.
  const on = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_LOCATOR);
  assert.ok(on.diagnostics.poseCount.v0wq >= 1,
    'v0WQ 프레임에서 복원해도 v0wq 포즈가 0 이다: ' + JSON.stringify(on.diagnostics.poseCount));
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0wqFamily: false } },
  });
  assert.equal(off.diagnostics.poseCount.v0wq, 0, '패밀리를 껐는데 v0wq 포즈가 섰다');
  assert.equal(detectCellSurfaceBlockShapes(luma).diagnostics.poseCount.v0wq, 0,
    '기본 cfg 에 v0wq 포즈가 섰다 — 드랍이 안 걸렸다');
  // 그리고 v0xq 를 끄는 것과 **독립**이어야 한다 — 코너 수집을 공유하지만 스위치는 둘이다.
  const noV0xq = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0wqFamily: true, v0xqFamily: false } },
  });
  assert.ok(noV0xq.diagnostics.poseCount.v0wq >= 1,
    'v0xq 를 껐더니 v0wq 까지 죽었다 — 두 패밀리가 한 스위치에 묶였다');
});

test('v0WQ 편입 비침습성 — 기존 패밀리 poseCount 가 on/off 로 동일', {
  timeout: 600_000,
}, () => {
  // **의도적 갱신 «v0XQ 드랍» (2026-08-17)** — 마지막 «삼중점 공유» 단언은 두
  // 패밀리가 **둘 다 도는 세계**에서만 의미가 있다 (드랍된 쪽은 조립을 아예 안 하므로
  // tripleCount 가 구조적으로 0 이 된다). 그래서 이 테스트의 기준 팔을 복원 스위치
  // 위로 올린다 — 재는 명제(«v0wq 를 켜고 꺼도 남이 안 흔들린다»)는 그대로다.
  for (const [name, frame] of [
    ['v0x', V0X_FRAME], ['v0xq', V0XQ_FRAME], ['v0w', V0W_FRAME], ['v0', V0_FRAME],
  ]) {
    const luma = toRelativeLuminance(distortImage(frame, { rotation: 0, fill: FILL }));
    const on = detectCellSurfaceBlockShapes(luma, RESTORE_DROPPED_LOCATOR);
    const off = detectCellSurfaceBlockShapes(luma, {
      calibration: {
        ...RESTORE_DROPPED_LOCATOR.calibration,
        csBlockLocator: {
          ...RESTORE_DROPPED_LOCATOR.calibration.csBlockLocator, v0wqFamily: false,
        },
      },
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

test('v0WY 자기 복호 + 슬롯 QR 확증 — 톤 4 × 회전 3, 그리고 v0W 프레임의 가짜 차단', {
  timeout: 900_000,
}, () => {
  // ⚠ **의도적 갱신 (2026-08-17 운영자 재설계).** 이 회귀는 「v0WY 는 렌더 선택이다 —
  // 와이어는 v0W 이고 데이터가 한 칸도 안 준다」 였고, 세 가지를 재고 있었다:
  // ① 인코딩이 v0W ② 복호가 v0w ③ `poseCount.v0wy` 가 **없다**.
  // 셋 다 **허공 마름모 설계**에 대해 참이었고 지금은 전부 거짓이다 — QR 이 실루엣
  // 안쪽으로 들어와 64셀을 먹으면서 별도 레이아웃·별도 패밀리가 됐다.
  // 지금 재는 것은 «구별이 실제로 서는가» 다.

  // ① 인코딩이 v0wy 이고 회계가 v0W 와 다르다.
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0wy', version: 1, tones: 2, eccLevel: 'M',
  });
  assert.equal(encoded.cellSurfaceLayout, 'v0wy');
  assert.equal(encoded.capacity.dataCells, 280);

  // ② 자기 복호 — 톤 4 × 회전 3 (격리 복원 위 — 드랍 전 세계의 비트 재현.
  //    v0t 를 켠 채면 rot0 클린 칸의 운반 포즈 구성이 바뀌어 복호가 떨어진다 — 실측).
  for (const [name, tone] of [
    ['none', {}], ['sCurve0.6', { sCurve: 0.6 }],
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const where = `v0wy ${name} rot${rotation}`;
      const decoded = decodeLab(
        distortImage(V0WY_FRAME, { ...tone, rotation, fill: FILL }),
        RESTORE_V0W_SERIES_ISOLATED,
      );
      assert.equal(decoded.ok, true, `${where}: ${decoded.reason || 'unknown'}`);
      assert.equal(decoded.text, PAYLOAD, where);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0wy',
        `${where} 이 남의 레이아웃으로 복호됐다: ` + decoded.hypothesis.cellSurfaceLayout);
    }
  }

  // ③ **새 패밀리가 실재한다** — 그리고 v0W 프레임에서는 슬롯 확증이 그것을 자른다.
  //    이 대조가 이 편입의 핵심이다: 시드 기하가 v0W 와 같으므로, 확증을 끄면
  //    v0W 프레임에도 v0wy 포즈가 선다. 켜면 0 이다.
  //    (계수 비교라 v0t·v0ty 를 격리한다 — §RESTORE_V0W_SERIES_ISOLATED_LOCATOR.)
  const wyLuma = toRelativeLuminance(distortImage(V0WY_FRAME, { rotation: 0, fill: FILL }));
  const wyDetected = detectCellSurfaceBlockShapes(wyLuma, RESTORE_V0W_SERIES_ISOLATED_LOCATOR);
  assert.ok(wyDetected.diagnostics.poseCount.v0wy >= 1,
    'v0WY 프레임에서 v0wy 포즈가 0 이다 — 패밀리가 안 돈다');

  const wLuma = toRelativeLuminance(distortImage(V0W_FRAME, { rotation: 0, fill: FILL }));
  const wOn = detectCellSurfaceBlockShapes(wLuma, RESTORE_V0W_SERIES_ISOLATED_LOCATOR);
  const wOff = detectCellSurfaceBlockShapes(wLuma, {
    calibration: {
      csBlockLocator: {
        ...RESTORE_V0W_SERIES_ISOLATED_LOCATOR.calibration.csBlockLocator,
        v0wyRequireSlotQr: false,
      },
    },
  });
  // ★ 대조군 동반 — «항상 0 인 자» 를 막는다. 확증을 끄면 실제로 서야 한다.
  assert.ok(wOff.diagnostics.poseCount.v0wy > 0,
    '슬롯 확증을 꺼도 v0W 프레임에 v0wy 포즈가 안 선다 — 이 게이트가 겨냥한 것이 없다');
  assert.equal(wOn.diagnostics.poseCount.v0wy, 0,
    'v0W 프레임에 가짜 v0wy 포즈가 남았다 — 슬롯 QR 확증이 안 듣는다');
  assert.equal(wOn.diagnostics.slotQr.rejected, wOff.diagnostics.poseCount.v0wy,
    '거절 수가 «확증 없이 섰을 포즈 수» 와 다르다 — 두 값이 같은 것을 세지 않는다');
  // 그리고 확증은 **다른 패밀리를 한 자리도 안 건드린다** (비침습성).
  for (const family of ['v0w', 'v0w2', 'v0', 'v0wq']) {
    assert.equal(wOn.diagnostics.poseCount[family], wOff.diagnostics.poseCount[family],
      `슬롯 확증이 ${family} 포즈 수를 바꿨다`);
  }
});

test('슬롯 QR 거절 계수기 — 두 확증 경로가 각각 계수되고 총수 = 경로별 합', {
  timeout: 900_000,
}, () => {
  // **결함 A 수리 회귀 (2026-08-17).** 확증(§slotQrConfirmsPose)의 호출부는 **둘**이다
  // — 앵커드 조립과 중앙 불스아이 구제 조립. 수리 전에는 구제 경로가 조용히
  // `continue` 해서, «회귀 대조군» 으로 못박힌 `slotQr.rejected` 가 거절의 절반을
  // 못 셌다 (v0WY 프레임 실측: 확증 off 3 → on 1 인데 rejected 0). 못박는 것 셋:
  //   ① rejected === rejectedAnchored + rejectedBullseye  (총수 = 경로별 합)
  //   ② 각 경로가 실제로 한 번은 올라간다 — 앵커드는 v0W 프레임(실측 8)이,
  //      구제는 v0WY 프레임(실측 2)이 각각의 실증 프레임이다. 한쪽이 0 이 되면
  //      그 경로의 자가 죽은 것이다 (합계만 맞추면 어느 쪽이 샜는지 다시 못 본다).
  //   ③ rejected === «확증 없이 섰을 포즈 수 − 선 포즈 수»  (전수 계수)
  // (계수 회귀라 v0t·v0ty 를 격리한다 — v0ty 가 같은 확증 경로·같은 계수기를 쓰므로
  //  켠 채 재면 rejected 에 v0ty 몫이 섞인다. §RESTORE_V0W_SERIES_ISOLATED_LOCATOR.)
  for (const [name, frame, wantPath] of [
    ['v0w', V0W_FRAME, 'rejectedAnchored'],
    ['v0wy', V0WY_FRAME, 'rejectedBullseye'],
  ]) {
    const luma = toRelativeLuminance(distortImage(frame, { rotation: 0, fill: FILL }));
    const on = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_ISOLATED_LOCATOR);
    const off = detectCellSurfaceBlockShapes(luma, {
      calibration: {
        csBlockLocator: {
          ...RESTORE_V0W_SERIES_ISOLATED_LOCATOR.calibration.csBlockLocator,
          v0wyRequireSlotQr: false,
        },
      },
    });
    const sq = on.diagnostics.slotQr;
    assert.equal(sq.rejected, sq.rejectedAnchored + sq.rejectedBullseye,
      `${name}: 거절 총수가 경로별 합과 다르다 — ` + JSON.stringify(sq));
    assert.ok(sq[wantPath] >= 1,
      `${name}: ${wantPath} 가 0 이다 — 그 경로의 계수기가 죽었다: ` + JSON.stringify(sq));
    assert.equal(sq.rejected,
      off.diagnostics.poseCount.v0wy - on.diagnostics.poseCount.v0wy,
      `${name}: rejected 가 확증이 실제로 자른 수와 다르다`);
  }
});

test('슬롯 QR 확증 — 슬롯에 QR 이 없으면 v0wy 포즈가 0 이다 (구멍·단색 어두움)', {
  timeout: 900_000,
}, () => {
  // **결함 B 수리 회귀 (2026-08-17).** 수리 전 실측: 빈 슬롯 팔에서 v0wy 포즈 **2** 가
  // 통과했다 — 정답 H 위 contrast 는 0.0000 인데, 게이트가 실제로 본 H (프로브 offset
  // 보행 · 120° 회전 위상)에서는 눈금 없는 두 자(Pearson·contrast)가 면 게인 음영
  // 잔재에 속았다: span(p95−p5)이 0.04\~0.06 으로 무너지며 contrast 가 1.67\~2.58 로
  // 폭발했다 (`test/output/lanes/claude-slotqr-phase.out.txt`). 수리는 **추가 조건 둘**
  // — 프로브 상관 하한(§v0wySlotQrMinCorrelation — 봉합 ② 호출부 패턴 완성)과
  // span 상응성(§v0wySlotQrMinSpanRatio — 같은 포즈의 중앙 불스아이가 눈금).
  // 기존 문턱(0.6)·확증 구조는 무접촉이다.
  const scene = buildSceneY(encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0wy', version: 1, tones: 2, eccLevel: 'M',
  }), { palette: PALETTE, margin: 4, qrText: TL_READER_URL });
  const m = centerQrSlotCellsFor('v0wy');
  const og = centerQrSlotOriginFor('v0wy', 21);
  const { ei, ej } = faceBasis('T');
  const fp = (a, b) => ({
    x: scene.layout.originX + (a * ei.x + b * ej.x) * scene.layout.size,
    y: scene.layout.originY + (a * ei.y + b * ej.y) * scene.layout.size,
  });
  const quad = [fp(og.i, og.j), fp(og.i + m, og.j), fp(og.i + m, og.j + m), fp(og.i, og.j + m)];
  const inQuad = (pt) => {
    let sign = 0;
    for (let k = 0; k < 4; k += 1) {
      const p = quad[k]; const q = quad[(k + 1) % 4];
      const cross = (q.x - p.x) * (pt.y - p.y) - (q.y - p.y) * (pt.x - p.x);
      if (Math.abs(cross) < 1e-9) continue;
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s; else if (sign !== s) return false;
    }
    return true;
  };
  let first = -1; let last = -1; let count = 0;
  for (let k = 0; k < scene.shapes.length; k += 1) {
    const s = scene.shapes[k];
    if (s.kind !== 'polygon' || s.points.length !== 4) continue;
    let sx = 0; let sy = 0;
    for (const p of s.points) { sx += p.x; sy += p.y; }
    if (!inQuad({ x: sx / s.points.length, y: sy / s.points.length })) continue;
    if (first < 0) first = k;
    last = k; count += 1;
  }
  assert.ok(first >= 0 && count === last - first + 1, '슬롯 구간을 못 찾았다 — 팔 구성 무효');
  const gain = DEFAULT_FACE_GAINS.T;
  const dark = {
    r: BULLSEYE_DARK.r * gain, g: BULLSEYE_DARK.g * gain, b: BULLSEYE_DARK.b * gain,
  };
  const holeShapes = [...scene.shapes.slice(0, first), ...scene.shapes.slice(last + 1)];
  const darkShapes = [...scene.shapes.slice(0, first), {
    kind: 'polygon',
    points: [fp(og.i, og.j), fp(og.i + m, og.j), fp(og.i + m, og.j + m), fp(og.i, og.j + m)],
    color: dark,
  }, ...scene.shapes.slice(last + 1)];
  for (const [name, shapes] of [['구멍', holeShapes], ['단색 어두움', darkShapes]]) {
    const frame = embed960(rasterize({ ...scene, shapes }, { pixelsPerUnit: 15, supersample: 2 }));
    const luma = toRelativeLuminance(frame);
    // (계수 회귀 — v0t·v0ty 격리. §RESTORE_V0W_SERIES_ISOLATED_LOCATOR.)
    const on = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_ISOLATED_LOCATOR);
    const off = detectCellSurfaceBlockShapes(luma, {
      calibration: {
        csBlockLocator: {
          ...RESTORE_V0W_SERIES_ISOLATED_LOCATOR.calibration.csBlockLocator,
          v0wyRequireSlotQr: false,
        },
      },
    });
    // ★ 대조군 동반 — «항상 0 인 자» 를 막는다. 확증을 끄면 후보가 실제로 서야 한다.
    assert.ok(off.diagnostics.poseCount.v0wy >= 1,
      `${name}: 확증 없이도 v0wy 후보가 없다 — 이 게이트가 겨냥한 것이 없다`);
    assert.equal(on.diagnostics.poseCount.v0wy, 0,
      `${name}: 슬롯에 QR 이 없는데 v0wy 포즈가 섰다 — 확증이 열리는 쪽으로 실패한다`);
    assert.equal(on.diagnostics.slotQr.rejected, off.diagnostics.poseCount.v0wy,
      `${name}: 잘린 후보가 전부 계수되지 않았다`);
    // 확증은 다른 패밀리를 한 자리도 안 건드린다 (비침습성).
    for (const family of ['v0w', 'v0w2', 'v0', 'v0wq']) {
      assert.equal(on.diagnostics.poseCount[family], off.diagnostics.poseCount[family],
        `${name}: 슬롯 확증이 ${family} 포즈 수를 바꿨다`);
    }
  }
  // 그리고 진짜 QR 프레임은 여전히 선다 («전부 자르는 자» 방지) — 수리 전후 회계 동일.
  const realLuma = toRelativeLuminance(distortImage(V0WY_FRAME, { rotation: 0, fill: FILL }));
  const real = detectCellSurfaceBlockShapes(realLuma, RESTORE_V0W_SERIES_ISOLATED_LOCATOR);
  assert.ok(real.diagnostics.poseCount.v0wy >= 1,
    '수리가 진짜 v0WY 포즈까지 잘랐다: ' + JSON.stringify(real.diagnostics.poseCount));
});

test('구 v0WY(허공 면-평면 QR)는 폐기됐다 — outerFaceQr 는 조용히 무시되지 않고 던진다', () => {
  // «렌더러를 지웠다» 를 소스 부재로만 재면, 남아 있는 호출자가 QR 없는 코드를
  // 성공적으로 뽑아 낸다 (사용자는 폴백 QR 이 사라진 줄 모른다). 그래서 sceneY 는
  // 그 옵션을 받으면 **던진다** — 이 회귀가 그 계약이다.
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0w', version: 1, tones: 2, eccLevel: 'M',
  });
  assert.throws(
    () => buildSceneY(encoded, {
      palette: PALETTE, margin: 16, qrText: TL_READER_URL, outerFaceQr: true,
    }),
    TypeError,
  );
  // false 도 «구 배선이 살아 있다» 는 신호이므로 같이 던진다 (조용한 통과 금지).
  assert.throws(
    () => buildSceneY(encoded, { palette: PALETTE, margin: 16, outerFaceQr: false }),
    TypeError,
  );
});

test('v0WY 교차 오수용 0 — 양방향 전수 (v0 · v0W · v0WQ · v0W2 · v0WY + 드랍 v0X·v0XQ)', {
  timeout: 900_000,
}, () => {
  // v0W ↔ v0WY 가 이 표의 핵심 칸이다 — 중앙·코너 시드가 **문자 그대로 같으므로**,
  // 여기가 새면 두 레이아웃은 서로의 프레임을 읽어 버린다.
  // **의도적 갱신 «v0W 계열 드랍» (2026-08-17)** — 계열 네 행에 **격리** 복원
  // 스위치 (드랍 전 교차 세계의 비트 재현 — v0t 를 켠 채면 v0wy rot0 이 떨어진다).
  for (const [name, frame, wantLayout, extra] of [
    ['v0', V0_FRAME, 'v0', {}],
    ['v0x', V0X_FRAME, 'v0x', RESTORE_DROPPED],
    ['v0xq', V0XQ_FRAME, 'v0xq', RESTORE_DROPPED],
    ['v0w', V0W_FRAME, 'v0w', RESTORE_V0W_SERIES_ISOLATED],
    ['v0wq', V0WQ_FRAME, 'v0wq', RESTORE_V0W_SERIES_ISOLATED],
    ['v0w2', V0W2_FRAME, 'v0w2', RESTORE_V0W_SERIES_ISOLATED],
    ['v0wy', V0WY_FRAME, 'v0wy', RESTORE_V0W_SERIES_ISOLATED],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const decoded = decodeLab(distortImage(frame, { rotation, fill: FILL }), extra);
      assert.equal(decoded.ok, true,
        `${name} rot${rotation} 이 복호되지 않았다: ${decoded.reason || 'unknown'}`);
      assert.equal(decoded.text, PAYLOAD, `${name} rot${rotation}`);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, wantLayout,
        `${name} rot${rotation} 이 ${decoded.hypothesis.cellSurfaceLayout} 로 오수용됐다`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// §13 (2026-08-17) **v0XQ 드랍** — 운영자 실기기 확정.
//
// 조건부 드랍 규칙 «v0WQ > v0XQ» 가 성립했다 (실기기 인식 순위
// v0WQ ≫ v0XQ > v0X ≈ v0W). v1r2·v2r2 와 **같은 규약**으로 내린다 — 차단이지
// 삭제가 아니다. 이 블록이 그 규약 세 가지를 매 실행 증명한다:
//   ① 드랍이 실제로 듣는다 (기본 cfg 에서 v0xq 포즈·후보·복호가 전부 사라진다)
//   ② ⚠ **함정 1** — v0wq 는 v0xq 의 코너 삼중점 경로를 **공유**하는데도 온전하다
//      (코너 수집 게이트가 `(v0xqFamily !== false || v0wqFamily !== false)` 라서)
//   ③ 복원 스위치를 켜면 드랍 전 동작이 그대로 돌아온다 (와이어·정본 무손실)
// ─────────────────────────────────────────────────────────────────────────

test('v0XQ 드랍 ① — 기본 라인업에서 v0xq 포즈·CS 후보·복호가 전부 사라진다', {
  timeout: 600_000,
}, () => {
  // 포즈 — 자기 프레임에서조차 0 이다 (v1r2 드랍과 같은 모양의 증명).
  const luma = toRelativeLuminance(distortImage(V0XQ_FRAME, { rotation: 0, fill: FILL }));
  const dropped = detectCellSurfaceBlockShapes(luma);
  assert.equal(dropped.diagnostics.poseCount.v0xq, 0,
    '드랍했는데 자기 프레임에서 v0xq 포즈가 섰다');
  assert.ok(!dropped.shapes.some((shape) => shape.blockLocator.layoutId === 'v0xq'),
    '드랍했는데 v0xq shape 가 생겼다');
  // CS 평가 후보 — 라인업에서 빠졌다.
  assert.ok(!finalLayoutIdsForN(21).includes('v0xq'),
    'finalLayoutIdsForN(21) 에 v0xq 가 남아 있다');
  // 복호 — 기본 경로로는 v0XQ 프레임을 못 읽는다. **읽히면 안 되는 것이 아니라
  // «라인업에 없으니 후보가 없다»** 이고, 그 사실을 실패 사유로 못 박는다.
  const decoded = decodeLab(distortImage(V0XQ_FRAME, { rotation: 0, fill: FILL }));
  assert.equal(decoded.ok, false, '드랍했는데 기본 경로가 v0XQ 를 읽었다');
  // 남의 레이아웃으로 새어 읽히면 그것은 오수용이다 — 그쪽이 더 나쁘다.
  if (decoded.ok) {
    assert.notEqual(decoded.hypothesis.cellSurfaceLayout, 'v0xq');
  }
});

test('v0XQ 드랍 ② ⚠ 함정 1 — 코너 경로를 공유하는 v0WQ 검출은 온전하다', {
  timeout: 900_000,
}, () => {
  // v0wq 는 v0xq 와 **같은 코너 히트·같은 삼중점**에서 출발한다. 코너 수집이
  // `(cfg.v0xqFamily !== false || cfg.v0wqFamily !== false)` 게이트 뒤에 있으므로
  // v0xq 만 내려도 순회는 그대로 돈다. 그 성질이 깨지면 v0WQ 가 통째로 죽는다.
  // **의도적 갱신 «v0W 계열 드랍» (2026-08-17)** — v0wq 자신도 드랍됐으므로,
  // 이 명제(«v0xq off 가 v0wq 경로를 안 자른다»)는 v0wq 를 복원한 팔에서 잰다.
  const RESTORE_V0WQ_ONLY = {
    calibration: { csBlockLocator: { v0wqFamily: true } },
  };
  const luma = toRelativeLuminance(distortImage(V0WQ_FRAME, { rotation: 0, fill: FILL }));
  const dropped = detectCellSurfaceBlockShapes(luma, RESTORE_V0WQ_ONLY);
  // (a) 코너 수집이 돌았다 — v0xq 를 껐는데도 코너가 잡힌다.
  assert.ok(dropped.diagnostics.centerQr.corners > 0,
    'v0xq 를 내렸더니 코너 수집 자체가 멈췄다 — 게이트가 AND 로 바뀌었다');
  // (b) 삼중점도 v0wq 쪽에서 그대로 센다 (v0xq 쪽은 조립을 안 하므로 0 이 정상).
  assert.ok(dropped.diagnostics.centerQr.v0wqTripleCount > 0,
    'v0wq 삼중점이 0 이다 — 공유 경로가 끊겼다');
  assert.equal(dropped.diagnostics.centerQr.tripleCount, 0,
    'v0xq 를 내렸는데 v0xq 삼중점 조립이 돌았다');
  // (c) 포즈·shape 가 선다.
  assert.ok(dropped.diagnostics.poseCount.v0wq >= 1,
    'v0xq 드랍이 v0wq 포즈까지 죽였다: ' + JSON.stringify(dropped.diagnostics.poseCount));
  assert.ok(dropped.shapes.some((shape) => shape.blockLocator.layoutId === 'v0wq'),
    'v0wq shape 가 사라졌다');
  // (d) 그리고 실제로 복호된다 — 톤 커브 4종 × 회전 3방향 전수 (v0wq 복원 · v0xq 는
  //     드랍 기본 그대로 off — 이 조합이 곧 «함정 1» 의 실측 조건이다).
  const RESTORE_V0WQ_DECODE = {
    includeDroppedCellSurfaceLayouts: true,
    calibration: { csBlockLocator: { v0wqFamily: true } },
  };
  for (const [name, tone] of [
    ['none', {}], ['sCurve0.6', { sCurve: 0.6 }],
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const where = `v0wq ${name} rot${rotation} (v0xq 드랍 후)`;
      const decoded = decodeLab(
        distortImage(V0WQ_FRAME, { ...tone, rotation, fill: FILL }), RESTORE_V0WQ_DECODE,
      );
      assert.equal(decoded.ok, true, `${where}: ${decoded.reason || 'unknown'}`);
      assert.equal(decoded.text, PAYLOAD, where);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0wq', where);
    }
  }
});

test('v0XQ 드랍 ③ — 복원 스위치를 켜면 드랍 전 동작이 그대로 돌아온다 (차단·비삭제)', {
  timeout: 900_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0XQ_FRAME, { rotation: 0, fill: FILL }));
  const restored = detectCellSurfaceBlockShapes(luma, RESTORE_DROPPED_LOCATOR);
  assert.ok(restored.diagnostics.poseCount.v0xq >= 1,
    '복원 스위치를 켰는데 v0xq 포즈가 0 이다 — 드랍이 «삭제» 가 됐다');
  assert.ok(restored.shapes.some((shape) => shape.blockLocator.layoutId === 'v0xq'),
    '복원 스위치를 켰는데 v0xq shape 가 없다');
  // 그리고 복호까지 — 와이어·정본·회계가 한 비트도 안 사라졌다는 증명.
  const decoded = decodeLab(
    distortImage(V0XQ_FRAME, { rotation: 0, fill: FILL }), RESTORE_DROPPED,
  );
  assert.equal(decoded.ok, true, '복원 복호 실패: ' + (decoded.reason || 'unknown'));
  assert.equal(decoded.text, PAYLOAD);
  assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0xq');
  // 복원은 **v0wq 를 흔들지 않는다** — 두 스위치가 독립이라는 반대 방향 증명.
  // (v0wq 도 드랍됐으므로 두 팔 모두 v0wq 를 켜고, v0xq 만 갈라 잰다.)
  const wqLuma = toRelativeLuminance(distortImage(V0WQ_FRAME, { rotation: 0, fill: FILL }));
  const wqNoV0xq = detectCellSurfaceBlockShapes(wqLuma, {
    calibration: { csBlockLocator: { v0wqFamily: true } },
  });
  const wqRestored = detectCellSurfaceBlockShapes(wqLuma, RESTORE_DROPPED_LOCATOR);
  assert.equal(wqNoV0xq.diagnostics.poseCount.v0wq, wqRestored.diagnostics.poseCount.v0wq,
    'v0xq 복원이 v0wq 포즈 수를 바꿨다 — 두 패밀리가 서로를 흔든다');
});

test('v0XQ 드랍 ④ — 정본 배열은 한 줄도 안 지웠다 (v0W·v0WQ 가 그 배열에서 유도된다)', () => {
  // ⚠ **함정 2** — `V0XQ_CORNER_CELLS` 는 v0W(NE 36셀) · v0WQ(CORNER 36셀) 의
  // **원천 배열**이다. 드랍을 «정본 삭제» 로 오해하면 두 레이아웃이 같이 죽는다.
  // 참조 동일성까지 요구하는 자기검증은 cellSurfaceFinal.test.js §①-d/①-e 가 잡고,
  // 여기서는 «드랍 뒤에도 세 레이아웃의 그 블록이 셀 단위로 같다» 를 잡는다.
  const cornerOf = (id, blocks) => locatorCellsCellSurfaceFinal(21, id)
    .filter((cell) => cell.i <= blocks.iMax && cell.j >= blocks.jMin)
    .map((cell) => [cell.i, cell.j, cell.T, cell.L, cell.R]);
  const fromV0xq = cornerOf('v0xq', V0XQ_BLOCKS.CORNER);
  assert.equal(fromV0xq.length, 36, 'v0xq 동심 사각이 36셀이 아니다');
  assert.deepEqual(cornerOf('v0w', V0W_BLOCKS.NE), fromV0xq,
    'v0W NE 가 v0xq 동심 사각과 갈라졌다');
  assert.deepEqual(cornerOf('v0wq', V0WQ_BLOCKS.CORNER), fromV0xq,
    'v0WQ CORNER 가 v0xq 동심 사각과 갈라졌다');
  // 와이어 질의도 살아 있다 — 드랍은 라인업만 건드린다.
  assert.equal(cellSurfaceFinal(21, 'v0xq').id, 'v0xq');
  assert.ok(allFinalLayoutIdsForN(21).includes('v0xq'));
});

// ─────────────────────────────────────────────────────────────────────────
// §14 (2026-08-17) **v0W2 편입** — v0W 파생 ②, 운영자 신설 설계.
//
// 실기기 판정에서 v0W 가 진 두 자리를 고친 물건이다:
//   ① SE 부 파인더 3×3 이 실기기에서 **미검출** → 6×6 (면당 9점 → 36점)
//   ② 주 파인더가 다 잡힌 프레임에서도 인식이 샜다 → NW·NE 를 3면 대칭으로 눕혀
//      **검출 전용**으로 돌리고 120° 위상은 SE 하나가 전담
//
// 로케이터 관점의 요점은 **v0W 와 시드가 같다**는 것이다 — NE 동심 사각이 같은
// 배열·같은 자리라 코어 반경이 √279 로 같고, 사각 링 동반자도 양쪽 다 참이다.
// 그래서 세 패밀리(v0X · v0W · v0W2)는 서로의 프레임에서 서로 시드되고, 여기서
// 재는 본론도 «포즈 0» 이 아니라 **«복호 오수용 0»** 이다.
//
// 추가로 §26 F6 지표(rot0 슬롯 위반)를 v0W 와 나란히 잰다 — 그것이 실기기 실패의
// 정량 대리 지표였기 때문이다.
// ─────────────────────────────────────────────────────────────────────────

const V0W2_FRAME = embed960(renderFinal('v0w2', 1, 15));

/**
 * ⚠ **알려진 약점 핀** — v0W2 도 «rot0 × 강한 감마» 2칸에서 죽는다 (10/12).
 *
 * 이 핀이 중요한 이유는 **귀속을 뒤집기 때문**이다. v0W 의 같은 2칸은
 * «위상 margin 이 얇아서» 로 귀속돼 있었는데(v0W 프로그램 §26 F9 · F5),
 * v0W2 는 margin 이 0.0952 → **0.1512 (+58.8 %)** 로 두꺼워졌는데도 **같은 2칸**이
 * 같은 단계(BODY_RS_FAILED)에서 죽는다. 즉 그 2칸의 원인은 위상 margin 이 아니다.
 *
 * 이 레인이 한 가장 싼 반증 실험 (`test/output/lanes/claude-v0w2-probe.mjs` 경로):
 *   · v0w 패밀리 off · v0x 패밀리 off · 둘 다 off · maximumPosesPerFamily 4
 *     → **네 팔 모두 같은 자리에서 같은 코드로 실패**. 즉 «경쟁 포즈가 훔쳐 간다» 도,
 *       «포즈 예산이 모자라다» 도 아니다.
 * 남는 후보는 rot0 프레임의 본문 샘플링(실루엣 전처리 · sampleProjectedDisc) 쪽이고,
 * 그것은 이 레인의 과업 밖이라 **핀으로만 남긴다**.
 *
 * 게이트는 한 값도 안 건드렸다 — 0.035 를 내리면 이 2칸이 초록이 되겠지만
 * 그건 «틀린 위상을 더 받는» 변경이고 이 레인의 배제 목록 1번이다.
 */
const V0W2_TONE_PINS = Object.freeze([
  ['clean', {}, [0, 120, 240], []],
  ['sCurve0.6', { sCurve: 0.6 }, [0, 120, 240], []],
  ['gamma0.7', { gamma: 0.7 }, [120, 240], [0]],
  ['gamma0.6', { gamma: 0.6 }, [120, 240], [0]],
]);

test('v0W2 자기 복호 (드랍 복원) — 톤 커브 4종 × 회전 3방향 (⚠ rot0 × 강한 감마 2칸은 약점 핀)', {
  timeout: 900_000,
}, () => {
  for (const [label, distort, wantOk, wantFail] of V0W2_TONE_PINS) {
    for (const rotation of wantOk) {
      const decoded = decodeLab(
        distortImage(V0W2_FRAME, { ...distort, rotation, fill: FILL }), RESTORE_V0W_SERIES,
      );
      const where = `v0W2 ${label} rot${rotation}`;
      assert.equal(decoded.ok, true, `${where}: ${decoded.reason || ''}`);
      assert.equal(decoded.text, PAYLOAD, where);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0w2',
        `${where} 이 남의 레이아웃으로 복호됐다: ` + decoded.hypothesis.cellSurfaceLayout);
    }
    for (const rotation of wantFail) {
      const frame = distortImage(V0W2_FRAME, { ...distort, rotation, fill: FILL });
      const decoded = decodeLab(frame, RESTORE_V0W_SERIES);
      const where = `v0W2 ${label} rot${rotation}`;
      assert.equal(decoded.ok, false,
        `${where} 이 초록이 됐다 — 약점이 사라졌으면 재측정하고 핀을 갱신하라`);
      assert.equal(decoded.reason, 'frontend:no-grid-hypothesis', where + ' 실패 이유');
      // 죽는 단계는 **로케이터가 아니다** — 포즈는 선다. 귀속을 함께 못 박는다.
      const detected = detectCellSurfaceBlockShapes(
        toRelativeLuminance(frame), RESTORE_V0W_SERIES_LOCATOR,
      );
      assert.ok(detected.diagnostics.poseCount.v0w2 >= 1,
        `${where} 에서 v0w2 포즈까지 죽었다 — 약점의 귀속이 바뀌었다`);
      assert.equal(decoded.detail.pipelineCode, 'BODY_RS_FAILED', where + ' 실패 단계');
    }
  }
});

test('v0W2 교차 오수용 0 — 양방향 전수 (v0 · v0X · v0XQ · v0W · v0WQ · v0W2)', {
  timeout: 900_000,
}, () => {
  // v0W ↔ v0W2 가 이 표의 핵심 칸이다 — 코어 반경·NE 블록·시드가 문자 그대로 같고,
  // v0W2 의 SE 는 T·L 두 면에서 **v0X SE 와 같은 동심 사각**이라 v0X 축도 위험하다.
  // 여기가 새면 세 레이아웃이 서로의 프레임을 읽어 버린다.
  // v0XQ·**v0X** 행에 복원 스위치를 깐다 (드랍 대조군 폐기 금지 — §13 과 같은 규약).
  //
  // ⚠ **이 표가 «v0 과 혼선» 관측의 유일한 실물 계측기다** (운영자 2026-08-17
  // 3라운드). v0 행(n=13)과 v0x 행(n=21)이 같은 표에 있고 각각 자기 레이아웃으로
  // 복호돼야 하므로, 두 레이아웃이 서로로 잡히면 여기가 빨개진다. 드랍 뒤에도
  // 그 계측 능력을 잃지 않으려고 v0x 행을 남긴 것이다.
  // **의도적 갱신 «v0W 계열 드랍» (2026-08-17)** — 계열 세 행에 복원 스위치.
  for (const [name, frame, wantLayout, extra] of [
    ['v0', V0_FRAME, 'v0', {}],
    ['v0x', V0X_FRAME, 'v0x', RESTORE_DROPPED],
    ['v0xq', V0XQ_FRAME, 'v0xq', RESTORE_DROPPED],
    ['v0w', V0W_FRAME, 'v0w', RESTORE_V0W_SERIES],
    ['v0wq', V0WQ_FRAME, 'v0wq', RESTORE_V0W_SERIES],
    ['v0w2', V0W2_FRAME, 'v0w2', RESTORE_V0W_SERIES],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const decoded = decodeLab(distortImage(frame, { rotation, fill: FILL }), extra);
      assert.equal(decoded.ok, true,
        `${name} rot${rotation} 이 복호되지 않았다: ${decoded.reason || 'unknown'}`);
      assert.equal(decoded.text, PAYLOAD, `${name} rot${rotation}`);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, wantLayout,
        `${name} rot${rotation} 이 ${decoded.hypothesis.cellSurfaceLayout} 로 오수용됐다`);
    }
  }
});

test('v0W2 교차 — Type O · A 프레임에서 v0W2 shape 가 서지 않는다', {
  timeout: 600_000,
}, () => {
  // cube 축 밖(hex 실루엣) — K3 중앙 자체가 없으므로 앵커드 쌍이 성립하지 않는다.
  // (계열 복원 위에서 잰다 — 꺼진 채면 자명하다.)
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
      const detected = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_LOCATOR);
      assert.ok(!detected.shapes.some((shape) => shape.blockLocator.layoutId === 'v0w2'),
        `Type ${name} rot${rotation} 에 v0w2 shape 가 섰다`);
      assert.equal(detected.diagnostics.poseCount.v0w2, 0,
        `Type ${name} rot${rotation} 에 v0w2 포즈가 섰다`);
    }
  }
});

test('v0W2 패밀리 격리 대조군 — 기본(드랍) = 명시 off = 0, 복원하면 자기 프레임에서 선다', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0W2_FRAME, { rotation: 0, fill: FILL }));
  // 드랍 후 «켬» 은 복원 스위치다.
  const on = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_LOCATOR);
  assert.ok(on.diagnostics.poseCount.v0w2 >= 1,
    'v0W2 프레임에서 복원해도 v0w2 포즈가 0 이다: ' + JSON.stringify(on.diagnostics.poseCount));
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0w2Family: false } },
  });
  assert.equal(off.diagnostics.poseCount.v0w2, 0, '패밀리를 껐는데 v0w2 포즈가 섰다');
  assert.equal(detectCellSurfaceBlockShapes(luma).diagnostics.poseCount.v0w2, 0,
    '기본 cfg 에 v0w2 포즈가 섰다 — 드랍이 안 걸렸다');
  // 그리고 v0w 를 끄는 것과 **독립**이어야 한다 — 같은 (중앙, 코너) 쌍을 쓰지만
  // 시딩 게이트 실패가 서로를 자르면 안 된다 (v0X ↔ v0W 에서 고친 결합).
  // (드랍 후에는 v0w2 를 켠 채 v0w 만 꺼서 잰다.)
  const noV0w = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0w2Family: true, v0wFamily: false } },
  });
  assert.ok(noV0w.diagnostics.poseCount.v0w2 >= 1,
    'v0w 를 껐더니 v0w2 까지 죽었다 — 두 패밀리가 한 게이트에 묶였다');
  assert.equal(noV0w.diagnostics.poseCount.v0w, 0);
});

test('v0W2 편입 비침습성 — 기존 패밀리 poseCount 와 verified 가 on/off 로 동일', {
  timeout: 900_000,
}, () => {
  // v0W2 는 기존 앵커드 순회 **안에** 산다 (v0xq 처럼 별도 순회가 아니다). 그래서
  // 클러스터 검증 단계는 손대지 않았음을 verified 동일성으로 못 박고, 기존 패밀리
  // poseCount 도 흔들리지 않는지 본다.
  //
  // ⚠ 이것은 «복호 결과가 안 바뀐다» 는 뜻이 **아니다** — v0W2 포즈가 셰이프 목록에
  // 들어가면 하류가 더 나은 기하를 얻어 v0W 의 약점 2칸이 구제된다 (위 §11
  // «v0W 약점 2칸의 귀속» 대조군이 그 사실을 따로 잰다). 여기서 재는 것은
  // **로케이터 단계의 비침습성**이다.
  // (드랍 후 «on» 은 명시 복원이다 — 기본이 off 로 바뀌었으므로.)
  for (const [name, frame] of [
    ['v0x', V0X_FRAME], ['v0xq', V0XQ_FRAME], ['v0w', V0W_FRAME],
    ['v0wq', V0WQ_FRAME], ['v0', V0_FRAME], ['v2r2', V2R2_FRAME], ['v1r2', V1R2_FRAME],
  ]) {
    const luma = toRelativeLuminance(distortImage(frame, { rotation: 0, fill: FILL }));
    const on = detectCellSurfaceBlockShapes(luma, {
      calibration: { csBlockLocator: { v0w2Family: true } },
    });
    const off = detectCellSurfaceBlockShapes(luma, {
      calibration: { csBlockLocator: { v0w2Family: false } },
    });
    assert.deepEqual(on.diagnostics.verified, off.diagnostics.verified,
      name + ' verified 가 흔들렸다');
    for (const family of ['v2r2', 'v1r2', 'v0x', 'v0xq', 'v0w', 'v0wq', 'v0']) {
      assert.equal(on.diagnostics.poseCount[family], off.diagnostics.poseCount[family],
        `${name}: v0w2 on/off 로 ${family} poseCount 가 갈렸다`);
    }
    assert.equal(off.diagnostics.poseCount.v0w2, 0, `${name}: 끈 쪽에 v0w2 포즈가 있다`);
  }
});

test('v0W2 로케이터는 결정적이다 — 같은 프레임 두 번 → 동일 산출', {
  timeout: 300_000,
}, () => {
  const luma = toRelativeLuminance(distortImage(V0W2_FRAME, { gamma: 0.7, fill: FILL }));
  const first = detectCellSurfaceBlockShapes(luma);
  const second = detectCellSurfaceBlockShapes(luma);
  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.deepEqual(
    first.shapes.map((shape) => shape.center),
    second.shapes.map((shape) => shape.center),
  );
});

test('v0W2 시드 기하 — v0W 과 같은 코너 앵커(√279 · −141.1°)를 공유한다', () => {
  // 이 값이 갈리면 «두 패밀리가 같은 쌍에서 시드된다» 는 §14 서두의 전제가 깨진다.
  const v0w = CS_BLOCK_LOCATOR_INTERNALS.patchesFor(21, 'v0w').corners[0].anchor;
  const v0w2 = CS_BLOCK_LOCATOR_INTERNALS.patchesFor(21, 'v0w2').corners[0].anchor;
  assert.ok(Math.abs(v0w.x - v0w2.x) < 1e-9 && Math.abs(v0w.y - v0w2.y) < 1e-9,
    'v0W2 코너 앵커가 v0W 와 다르다');
  assert.ok(Math.abs(Math.hypot(v0w2.x, v0w2.y) - Math.sqrt(279)) < 1e-9,
    'v0W2 코너 반경이 √279 가 아니다');
  // 중앙 패치는 **다르다** — 3면 대칭화로 네 셀이 눕었기 때문이다. 그 차이가
  // 두 패밀리를 refinePose 단계에서 가르는 축의 하나다.
  const centreV0w = CS_BLOCK_LOCATOR_INTERNALS.patchesFor(21, 'v0w').centre;
  const centreV0w2 = CS_BLOCK_LOCATOR_INTERNALS.patchesFor(21, 'v0w2').centre;
  assert.equal(centreV0w.points.length, centreV0w2.points.length, '중앙 패치 점 수가 다르다');
  assert.notDeepEqual(centreV0w2.points.map((p) => p.expected), centreV0w.points.map((p) => p.expected),
    'v0W2 중앙 패치가 v0W 과 같다 — 3면 대칭화가 패치에 안 반영됐다');
  // 그리고 서브앵커는 **더 두껍다** — SE 가 9점에서 36점이 됐다 (실기기 미검출 대책).
  const subV0w = CS_BLOCK_LOCATOR_INTERNALS.patchesFor(21, 'v0w').subPatches;
  const subV0w2 = CS_BLOCK_LOCATOR_INTERNALS.patchesFor(21, 'v0w2').subPatches;
  const points = (list) => list.reduce((sum, patch) => sum + patch.points.length, 0);
  assert.equal(points(subV0w2) - points(subV0w), 81,
    'v0W2 서브앵커 점 수가 v0W 보다 81(=27셀×3면) 많지 않다');
});

test('v0W2 rot0 슬롯 위반 — §26 F6 지표를 v0W 과 나란히 잰다', {
  timeout: 900_000,
}, () => {
  // **무엇을 재나**: 물리 회전 0° 프레임인데 가설이 120/240 슬롯을 주장하는 건수.
  // v0W 프로그램 §26 F6 이 «실기기 실패의 정량 대리 지표» 로 지목한 값이다.
  // 실측 (톤 4종 × rot0): v0W **3/4 위반** · v0W2 **1/4 위반**
  // (v0W2 는 gamma 두 칸이 복호 자체를 못 해 분모가 2 다 — 그 2칸은 위 약점 핀 몫).
  //
  // ⚠ 이 테스트는 **개선을 주장하지 않는다** — 두 수를 나란히 고정할 뿐이다.
  // 어느 쪽이 움직이면 실기기 판정의 대리 지표가 움직인 것이므로 재측정 신호다.
  const TONE_ARMS = [
    ['clean', {}], ['sCurve0.6', { sCurve: 0.6 }],
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
  ];
  // (드랍 후에는 **격리** 복원 위에서 잰다 — F6 은 드랍 전 세계의 대리 지표라
  //  후보·패밀리 구성이 그때와 비트 동일해야 핀 값이 선다.)
  const count = (frame) => {
    let violations = 0;
    let decoded = 0;
    for (const [, tone] of TONE_ARMS) {
      const out = decodeLab(
        distortImage(frame, { ...tone, rotation: 0, fill: FILL }),
        RESTORE_V0W_SERIES_ISOLATED,
      );
      if (!out.ok) continue;
      decoded += 1;
      if (out.hypothesis.rotationDegrees !== 0) violations += 1;
    }
    return { violations, decoded };
  };
  assert.deepEqual(count(V0W_FRAME), { violations: 3, decoded: 4 },
    'v0W 의 rot0 슬롯 위반 수가 잰 값과 다르다 — F6 지표를 재측정하라');
  assert.deepEqual(count(V0W2_FRAME), { violations: 1, decoded: 2 },
    'v0W2 의 rot0 슬롯 위반 수가 잰 값과 다르다 — F6 지표를 재측정하라');
});

test('v0W2 정본 블록은 로케이터 패치와 같은 정의를 쓴다 (블록 범위 공유)', () => {
  // 정본(cellSurfaceFinal)과 검출기(cellsurface-block-detect)가 **다른 상수**로
  // 같은 블록을 말하기 시작하면 조용히 어긋난다. 여기서 한 번 묶어 둔다.
  const cells = locatorCellsCellSurfaceFinal(21, 'v0w2');
  const nw = cells.filter((c) => c.i <= V0W2_BLOCKS.NW.iMax && c.j <= V0W2_BLOCKS.NW.jMax);
  const ne = cells.filter((c) => c.i <= V0W2_BLOCKS.NE.iMax && c.j >= V0W2_BLOCKS.NE.jMin);
  const se = cells.filter((c) => c.i >= V0W2_BLOCKS.SE.iMin && c.j >= V0W2_BLOCKS.SE.jMin);
  assert.deepEqual([nw.length, ne.length, se.length], [25, 36, 36]);
  assert.equal(nw.length + ne.length + se.length, cells.length, '분류 밖 셀이 있다');
  // NE 블록은 v0W·v0WQ 와 **같은 범위**여야 한다 (같은 배열에서 유도되므로).
  assert.deepEqual(V0W2_BLOCKS.NE, V0W_BLOCKS.NE);
  assert.deepEqual(V0W2_BLOCKS.NE, V0WQ_BLOCKS.CORNER);
  // 로케이터 패치도 같은 셀을 본다 (중앙3 + 코너3 + 마커3 = 서브앵커 9장).
  const patches = CS_BLOCK_LOCATOR_INTERNALS.patchesFor(21, 'v0w2');
  assert.equal(patches.subPatches.length, 9, 'v0W2 서브앵커가 9장이 아니다 (중앙3+코너3+마커3)');
  assert.equal(patches.corners.length, 3);
  assert.equal(patches.centre.points.length, 75, 'v0W2 중앙 패치가 25셀×3면이 아니다');
});

// ─────────────────────────────────────────────────────────────────────────
// §14. 교차 누수 봉합 + 중앙 불스아이 확증 (2026-08-17, 과업 3)
//
// 실기기 관찰: v0X·v0W 프레임에서 주 파인더 전부 검출 → **v0WQ 류 후보로 인식이
// 새서 실패**. 합성 재현으로 확정한 기전 (`test/output/claude-v0w2-program.md` §21):
//   ① 코너 동심 사각은 다섯 레이아웃이 **문자 그대로 같은 셀**을 쓴다 → 불스아이
//      중앙 프레임에서도 120° 삼중점이 그대로 선다.
//   ② 유일한 방벽이던 중앙 QR 상관 게이트(0.25)는 사실상 **면 게인 음영**만 재고
//      있었다 — 진짜 0.9998 / 가짜 0.28\~0.42 로 문턱을 넘는다.
//   ③ 같은 칸에서 엄격 코너 검증기는 1\~2개만 내고 느슨한 쪽은 3\~4개를 낸다.
//      그래서 사각 링 게이트가 구조적으로 0 이 되어 **자기 패밀리 포즈가 아예 안 선다**.
// 봉합은 문턱을 내리지 않는다 — 가짜만 떨어뜨리는 조건 둘 + 이미 있는 신호(중앙
// 불스아이)를 인가에 쓰는 조립 하나다. 아래가 그 셋의 회귀다.
// ─────────────────────────────────────────────────────────────────────────

const SEAL_ALL_OFF = Object.freeze({
  centreQrBullseyeVeto: false,
  centreQrRequireFinderContrast: false,
  centreBullseyeConfirmedPoses: false,
});

test('봉합 ① 중앙 불스아이 거부권 — 불스아이 중앙 프레임에서 v0wq 포즈가 사라진다', {
  timeout: 900_000,
}, () => {
  // 대조군을 함께 잰다: 봉합 전에는 실제로 **섰다**. 안 그러면 이 자는 «항상 0» 을
  // 재는 자가 된다 (직전 레인 §26 이 붙잡힌 함정).
  let before = 0;
  let after = 0;
  let vetoed = 0;
  // (드랍 후에는 v0wq 를 복원한 채 봉합만 갈라 잰다 — 꺼진 채면 «항상 0» 이 된다.)
  for (const [name, frame] of [['v0x', V0X_FRAME], ['v0w', V0W_FRAME], ['v0w2', V0W2_FRAME]]) {
    for (const tone of [{}, { gamma: 0.7 }, { sCurve: 0.6 }]) {
      for (const rotation of [0, 120]) {
        const luma = toRelativeLuminance(distortImage(frame, { ...tone, rotation, fill: FILL }));
        const pre = detectCellSurfaceBlockShapes(luma, {
          calibration: { csBlockLocator: { ...SEAL_ALL_OFF, v0wqFamily: true } },
        });
        const post = detectCellSurfaceBlockShapes(luma, {
          calibration: { csBlockLocator: { v0wqFamily: true } },
        });
        before += pre.diagnostics.poseCount.v0wq;
        after += post.diagnostics.poseCount.v0wq;
        vetoed += post.diagnostics.centerQr.v0wqBullseyeVetoed;
        assert.equal(post.diagnostics.poseCount.v0wq, 0,
          `${name} ${JSON.stringify(tone)} rot${rotation}: 봉합 후에도 v0wq 포즈가 남았다`);
      }
    }
  }
  assert.ok(before > 0,
    '봉합 전에도 v0wq 포즈가 0 이었다 — 이 테스트가 «항상 0» 인 자를 재고 있다');
  assert.equal(after, 0);
  assert.ok(vetoed > 0, '거부권이 한 개도 안 걷었는데 포즈가 0 이다 — 자른 주체가 다르다');
});

test('봉합 ② QR 다움 판별 — 진짜 중앙 QR 과 불스아이 중앙을 정규화 대비가 가른다', {
  timeout: 600_000,
}, () => {
  // 판별기 자체를 직접 잰다 (조립을 거치지 않는다 — 문턱의 근거가 이 수치다).
  const patch = CS_BLOCK_LOCATOR_INTERNALS.patchesFor(21, 'v0wq').centre;
  const scores = {};
  // 의도적 갱신 «v0X 드랍» (2026-08-17): v0x 행은 복원 스위치 위에서 잰다 —
  // 자기 패밀리 셰이프가 없으면 아래 `|| detected.shapes[0]` 폴백이 **남의 포즈의
  // H** 로 QR 다움을 재게 되고, 그러면 이 자가 무엇을 쟀는지 알 수 없어진다.
  // 의도적 갱신 «v0W 계열 드랍» (2026-08-17): 계열 세 행도 같은 이유로 복원한다.
  for (const [name, frame, restore] of [
    ['v0wq', V0WQ_FRAME, RESTORE_V0W_SERIES_LOCATOR],
    ['v0w', V0W_FRAME, RESTORE_V0W_SERIES_LOCATOR],
    ['v0x', V0X_FRAME, RESTORE_V0X_LOCATOR],
    ['v0w2', V0W2_FRAME, RESTORE_V0W_SERIES_LOCATOR],
  ]) {
    const luma = toRelativeLuminance(distortImage(frame, { rotation: 0, fill: FILL }));
    const detected = detectCellSurfaceBlockShapes(luma, restore);
    const shape = detected.shapes.find((entry) => entry.blockLocator.family === name)
      || detected.shapes[0];
    assert.ok(shape, name + ' 프레임에 셰이프가 하나도 없다');
    assert.equal(shape.blockLocator.family, name,
      name + ' 프레임에서 자기 패밀리 셰이프를 못 찾아 남의 포즈로 쟀다');
    // 셰이프 정점 → 4점 DLT 로 그 포즈의 H 를 되돌린다 (조립과 같은 캐노니컬 공간).
    const canonical = CORNER_UNIT_OFFSETS.slice(0, 4).map((corner) => ({
      x: corner.x * 21, y: corner.y * 21,
    }));
    const H = estimateHomography4(canonical, shape.vertices.slice(0, 4));
    assert.ok(H, name + ' H 복원 실패');
    scores[name] = CS_BLOCK_LOCATOR_INTERNALS.centreQrFinderContrast(luma, H, patch, 0, 0);
  }
  assert.ok(scores.v0wq > 0.9,
    `진짜 v0WQ 의 QR 다움이 낮다: ${scores.v0wq} — 문턱 0.6 의 여유가 사라졌다`);
  for (const name of ['v0w', 'v0x', 'v0w2']) {
    assert.ok(scores[name] < 0.5,
      `${name}(불스아이 중앙)의 QR 다움이 높다: ${scores[name]} — 판별기가 무뎌졌다`);
  }
});

test('봉합 ③ 중앙 불스아이 확증 — 사각 링 게이트가 구조적으로 0 이 되는 칸을 구제한다', {
  timeout: 900_000,
}, () => {
  // 잰 자리: v0W **3톤 + 감마 0.7 + JPEG 45 + 노이즈 σ8** (실사진 근사 — 이 조합이
  // 공유 하네스만으로 그 조건을 재현한다). 엄격 코너가 1\~2개라 사각 링 동반자가 0 이
  // 되고 v0w 포즈가 아예 안 섰다 (`claude-v0w2-anchored.mjs`: 죽은 13칸 중 12칸이
  // 이 단계에서 죽는다 — 거리·반경 스냅·패치 정합은 한 칸도 안 죽였다).
  // 감마만으로는 재현되지 않는다 (그 팔은 6/4/6 포즈로 멀쩡하다) — 노이즈·압축이
  // 엄격 검증기의 open/closed 분류를 무너뜨리는 것이 조건이다.
  const v0w3 = embed960(renderFinal3Tone('v0w', 1, 15));
  let rescuedCells = 0;
  let deadBefore = 0;
  for (const rotation of [0, 120, 240]) {
    const distort = {
      gamma: 0.7, jpegQuality: 45, noise: { sigma: 8, seed: 7 }, rotation, fill: FILL,
    };
    const luma = toRelativeLuminance(distortImage(v0w3, distort));
    // (드랍 후에는 계열 복원 위에서 봉합만 갈라 잰다.)
    const pre = detectCellSurfaceBlockShapes(luma, {
      calibration: {
        csBlockLocator: {
          ...RESTORE_V0W_SERIES_LOCATOR.calibration.csBlockLocator,
          centreBullseyeConfirmedPoses: false,
        },
      },
    });
    const post = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_LOCATOR);
    if (pre.diagnostics.poseCount.v0w === 0) {
      deadBefore += 1;
      if (post.diagnostics.poseCount.v0w > 0) rescuedCells += 1;
    }
    // 확증 경로가 선 칸은 진단에 근거를 남긴다.
    if (post.diagnostics.bullseyeConfirmed.poses > 0) {
      assert.ok(post.diagnostics.bullseyeConfirmed.triples > 0,
        `rot${rotation}: 확증 포즈가 있는데 확증 삼중점이 0 이다`);
    }
    // 그리고 복호가 실제로 v0w 로 간다 (포즈가 서는 것과 읽히는 것은 다른 문제다).
    const decoded = decodeLab(distortImage(v0w3, distort), RESTORE_V0W_SERIES);
    assert.equal(decoded.ok, true,
      `v0W 3톤 감마 rot${rotation} 복호 실패: ${decoded.reason || ''}`);
    assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0w',
      `v0W 3톤 감마 rot${rotation} 이 ${decoded.hypothesis.cellSurfaceLayout} 로 갔다`);
  }
  assert.ok(deadBefore > 0,
    '확증 전에도 v0w 포즈가 살아 있었다 — 이 테스트가 구제 대상이 없는 자를 재고 있다');
  assert.equal(rescuedCells, deadBefore,
    `확증 조립이 구제하지 못한 칸이 있다: ${deadBefore - rescuedCells}/${deadBefore}`);
});

test('봉합 무회귀 — v0WQ·v0W2·v0WY·v0X 프레임의 복호가 봉합 on/off 로 안 바뀐다', {
  timeout: 900_000,
}, () => {
  // 봉합은 «가짜를 더 잘 거른다» 이지 «진짜를 덜 받는다» 가 아니다. 진짜 중앙 QR
  // 프레임에서 결과가 한 칸이라도 움직이면 그것은 봉합이 아니라 손실이다.
  //
  // **의도적 갱신 «v0X 드랍» (2026-08-17)** — v0x 행은 **두 팔 모두** 복원 스위치
  // 위에서 잰다. 안 그러면 드랍 뒤 pre 가 통째로 실패해 `if (pre.ok)` 가 조용히
  // 건너뛰고, 이 행이 «아무것도 안 재는 행» 으로 바뀐다 (초록인 채로).
  //
  // **의도적 갱신 «v0WY 편입» (2026-08-17)** — v0wy 행을 더한다. v0WY 는 슬롯 QR
  // 확증이라는 **네 번째** 조건을 갖는데, 그것이 봉합 3처방과 서로를 방해하지
  // 않는지가 여기서 처음 잰다 (v0WY 는 불스아이 중앙이 있어 거부권·확증 조립의
  // 대상이기도 하기 때문이다).
  // **의도적 갱신 «v0W 계열 드랍» (2026-08-17)** — 계열 세 행도 두 팔 모두 복원
  // 위에서 잰다 (v0x 행과 같은 이유 — 안 그러면 «아무것도 안 재는 행» 이 된다).
  for (const [name, frame, restore] of [
    ['v0wq', V0WQ_FRAME, RESTORE_V0W_SERIES],
    ['v0w2', V0W2_FRAME, RESTORE_V0W_SERIES],
    ['v0wy', V0WY_FRAME, RESTORE_V0W_SERIES],
    ['v0x', V0X_FRAME, RESTORE_DROPPED],
  ]) {
    for (const tone of [{}, { gamma: 0.7 }, { gamma: 1.4 }, { sCurve: 0.6 }]) {
      for (const rotation of [0, 120, 240]) {
        const distort = { ...tone, rotation, fill: FILL };
        const pre = decodeLab(distortImage(frame, distort), {
          ...restore,
          calibration: {
            ...(restore.calibration || {}),
            csBlockLocator: {
              ...((restore.calibration || {}).csBlockLocator || {}), ...SEAL_ALL_OFF,
            },
          },
        });
        const post = decodeLab(distortImage(frame, distort), restore);
        const label = `${name} ${JSON.stringify(tone)} rot${rotation}`;
        if (pre.ok) {
          assert.equal(post.ok, true, `${label}: 봉합이 복호를 죽였다 (${post.reason || ''})`);
          assert.equal(post.text, pre.text, `${label}: 봉합이 payload 를 바꿨다`);
          assert.equal(post.hypothesis.cellSurfaceLayout, pre.hypothesis.cellSurfaceLayout,
            `${label}: 봉합이 수용 레이아웃을 바꿨다`);
        }
        // pre 가 실패한 칸은 «봉합이 고쳤을» 수 있다 — 그쪽은 손실이 아니므로 열어 둔다.
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// §v0X 드랍 (운영자 실기기 확정 2026-08-17, 판정 3라운드) — 차단·비삭제 회귀.
//
// 관측 두 줄: 「파인더 인식 다 해놓고도 잘 못 읽음」 · 「v0 과 혼선 자주」.
// 앞 줄은 «포즈는 서는데 하류가 못 넘긴다» 는 뜻이라 절감분이 «재탐색» 이 아니라
// «쌍마다 붙던 refinePose + 그 포즈가 끄는 CS 평가» 임을 예고한다 (v0XQ 와 같은 회계).
//
// 여기서 잠그는 것은 넷이다:
//   ① 드랍이 실제로 걸렸다 — 기본 cfg 에서 v0x 포즈 0 · CS 후보에 v0x 없음.
//   ② 삭제가 아니다 — 복원 스위치를 켜면 포즈도 복호도 그대로 돌아온다.
//   ③ **v0X 를 끄는 것이 v0W·v0W2 를 끄는 것이 아니다** (세 브랜치의 독립성).
//   ④ **정본은 한 줄도 안 내려갔다** — v0W2 SE(T/L)·v0W NE 가 v0X 정본에서
//      유도되므로, 드랍이 정본을 건드렸으면 여기서 즉시 빨개진다.
// 게이트(0.78 · 0.035 · CRC · RS)는 한 값도 안 건드렸다.
// ─────────────────────────────────────────────────────────────────────────

test('v0X 드랍 ① — 기본 cfg 에서 v0x 포즈 0 이고 CS 라인업에도 없다', {
  timeout: 600_000,
}, () => {
  // 자기 프레임에서조차 서지 않아야 한다 (그것이 «차단» 의 정의다).
  for (const tone of [{}, { gamma: 0.7 }, { sCurve: 0.6 }]) {
    for (const rotation of [0, 120]) {
      const luma = toRelativeLuminance(distortImage(V0X_FRAME, { ...tone, rotation, fill: FILL }));
      const detected = detectCellSurfaceBlockShapes(luma);
      const where = `v0X ${JSON.stringify(tone)} rot${rotation}`;
      assert.equal(detected.diagnostics.poseCount.v0x, 0, `${where}: 기본 cfg 에 v0x 포즈가 섰다`);
      assert.ok(!detected.shapes.some((shape) => shape.blockLocator.layoutId === 'v0x'),
        `${where}: 기본 cfg 에 v0x shape 가 섰다`);
    }
  }
  // 라인업 질의도 함께 — 로케이터만 내리고 CS 후보를 안 내리면 반쪽 드랍이 된다.
  // (n=21 기본은 v0X 드랍으로 v0w 가 됐다가, 2026-08-17 v0T 편입 라운드의 v0W 계열
  //  드랍으로 **v0t** 가 됐다 — 두 번의 «기본 승계» 가 겹친 값이다.)
  assert.equal(finalLayoutIdsForN(21).includes('v0x'), false, 'CS 라인업에 v0x 가 남았다');
  assert.equal(finalLayoutIdForN(21), 'v0t', 'n=21 기본이 v0t 로 승계되지 않았다');
  assert.equal(allFinalLayoutIdsForN(21).includes('v0x'), true,
    '와이어 질의에서까지 v0x 가 사라졌다 — 삭제가 됐다');
});

test('v0X 드랍 ② — 복원 스위치를 켜면 포즈도 복호도 그대로 돌아온다', {
  timeout: 900_000,
}, () => {
  for (const tone of [{}, { gamma: 0.7 }, { sCurve: 0.6 }]) {
    for (const rotation of [0, 120, 240]) {
      const distort = { ...tone, rotation, fill: FILL };
      const where = `v0X ${JSON.stringify(tone)} rot${rotation}`;
      const detected = detectCellSurfaceBlockShapes(
        toRelativeLuminance(distortImage(V0X_FRAME, distort)), RESTORE_V0X_LOCATOR,
      );
      assert.ok(detected.diagnostics.poseCount.v0x >= 1, `${where}: 복원해도 포즈가 0 이다`);
      const decoded = decodeLab(distortImage(V0X_FRAME, distort), RESTORE_DROPPED);
      assert.equal(decoded.ok, true, `${where}: 복원 복호 실패 — ${decoded.reason || ''}`);
      assert.equal(decoded.text, PAYLOAD, where);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0x', where + ' 복원 레이아웃');
    }
  }
});

test('v0X 드랍 ③ — v0X 를 끄는 것이 v0W·v0W2 를 끄는 것이 아니다 (브랜치 독립)', {
  timeout: 900_000,
}, () => {
  // v0X·v0W·v0W2 는 **같은 (중앙, 코너) 쌍**을 보고 서로 독립한 `if` 로 시드된다.
  // 2026-08-16 에 v0X 게이트 실패가 뒤 브랜치를 자르던 `continue` 를 걷어낸 자리이고,
  // 드랍이 그 결합을 되살리지 않았음을 여기서 증명한다.
  // (v0W 계열도 드랍된 지금은 두 팔 모두 계열을 복원하고 v0x 만 갈라 잰다 —
  //  명제(«v0x off 가 형제를 안 자른다»)는 그대로다.)
  for (const [name, frame] of [['v0w', V0W_FRAME], ['v0w2', V0W2_FRAME]]) {
    for (const tone of [{}, { gamma: 0.7 }]) {
      const luma = toRelativeLuminance(distortImage(frame, { ...tone, fill: FILL }));
      const dropped = detectCellSurfaceBlockShapes(luma, RESTORE_V0W_SERIES_LOCATOR);
      const restored = detectCellSurfaceBlockShapes(luma, {
        calibration: {
          csBlockLocator: {
            ...RESTORE_V0W_SERIES_LOCATOR.calibration.csBlockLocator,
            ...RESTORE_V0X_LOCATOR.calibration.csBlockLocator,
          },
        },
      });
      const where = `${name} ${JSON.stringify(tone)}`;
      assert.ok(dropped.diagnostics.poseCount[name] >= 1,
        `${where}: v0X 드랍이 ${name} 포즈까지 죽였다`);
      // 그리고 v0X 를 도로 켜도 **자기 포즈 수가 안 흔들린다** (역방향 비침습성).
      assert.equal(restored.diagnostics.poseCount[name], dropped.diagnostics.poseCount[name],
        `${where}: v0X 복원이 ${name} poseCount 를 흔들었다`);
      assert.deepEqual(restored.diagnostics.verified, dropped.diagnostics.verified,
        `${where}: v0X on/off 로 verified 가 흔들렸다`);
    }
  }
  // 복호까지 — v0X 는 내린 채(계열만 복원) v0W·v0W2 는 자기 레이아웃으로 그대로 읽힌다.
  for (const [name, frame] of [['v0w', V0W_FRAME], ['v0w2', V0W2_FRAME]]) {
    for (const rotation of [0, 120, 240]) {
      const decoded = decodeLab(distortImage(frame, { rotation, fill: FILL }), RESTORE_V0W_SERIES);
      assert.equal(decoded.ok, true, `${name} rot${rotation}: ${decoded.reason || ''}`);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, name,
        `${name} rot${rotation} 이 ${decoded.hypothesis.cellSurfaceLayout} 로 갔다`);
    }
  }
});

test('v0X 드랍 ④ — 정본 배열은 한 줄도 안 내려갔다 (v0W2·v0W 유도의 원천)', () => {
  // ⚠ 이 드랍의 함정. `V0X_CELLS`(SE 톤)는 **활성 레이아웃 v0W2 의 SE(T/L)**,
  // `V0XQ_CORNER_CELLS`(= v0X SE 평행이동)는 **v0W·v0WQ·v0W2 의 NE 그 자체**다.
  // 정본을 지우면 라인업에 남은 셋이 무너진다 — 그래서 «차단이지 삭제가 아니다» 는
  // 여기서 표어가 아니라 **의존성**이다.
  const key = (c) => c.i + ',' + c.j;
  const toneKey = (c) => key(c) + ':' + c.T + c.L + c.R;
  // (a) v0x 정본이 여전히 만들어진다 — 65셀 · 3면 톤 전부 0/2.
  const v0x = locatorCellsCellSurfaceFinal(21, 'v0x');
  assert.equal(v0x.length, 65, 'v0X 파인더 셀 수가 65 가 아니다');
  for (const cell of v0x) {
    for (const face of ['T', 'L', 'R']) {
      assert.ok(cell[face] === 0 || cell[face] === 2,
        'v0X 정본에 mid 면이 생겼다: ' + key(cell) + '.' + face);
    }
  }
  // (b) 세 활성 레이아웃의 NE 동심 사각 36셀은 **v0X SE 를 (i−15, j) 평행이동**한
  //     값과 좌표·톤이 같다 (모듈 안에서는 `V0XQ_CORNER_CELLS` 참조 동일성으로
  //     고정돼 있고, 밖에서는 값으로 확인한다 — 그 배열은 export 되지 않는다).
  const v0xSeShifted = new Map(v0x
    .filter((c) => c.i >= 15 && c.j >= 15)
    .map((c) => [(c.i - 15) + ',' + c.j, toneKey({ i: c.i - 15, j: c.j, T: c.T, L: c.L, R: c.R })]));
  assert.equal(v0xSeShifted.size, 36, 'v0X SE 가 36셀이 아니다');
  for (const [id, block] of [
    ['v0w', V0W_BLOCKS.NE], ['v0wq', V0WQ_BLOCKS.CORNER],
    ['v0w2', V0W2_BLOCKS.NE], ['v0xq', V0XQ_BLOCKS.CORNER],
  ]) {
    const ne = locatorCellsCellSurfaceFinal(21, id)
      .filter((c) => c.i <= block.iMax && c.j >= block.jMin);
    assert.equal(ne.length, 36, id + ' NE 가 36셀이 아니다');
    for (const cell of ne) {
      assert.equal(toneKey(cell), v0xSeShifted.get(key(cell)),
        id + ' NE ' + key(cell) + ' 이 v0X SE 유도값과 다르다 — 원천이 끊겼다');
    }
  }
  // (c) v0W2 의 SE 대형 마커는 T·L 두 면에서 v0X SE 와 **같은 좌표·같은 값**이다
  //     (R 면만 v0W2 독자 표 — `cellSurfaceFinal.js` §V0W2_MARKER_R).
  const v0xByKey = new Map(v0x.map((c) => [key(c), c]));
  const v0w2Se = locatorCellsCellSurfaceFinal(21, 'v0w2')
    .filter((c) => c.i >= V0W2_BLOCKS.SE.iMin && c.j >= V0W2_BLOCKS.SE.jMin);
  assert.equal(v0w2Se.length, 36, 'v0W2 SE 가 36셀이 아니다');
  for (const cell of v0w2Se) {
    const twin = v0xByKey.get(key(cell));
    assert.ok(twin, 'v0W2 SE ' + key(cell) + ' 에 대응하는 v0X 셀이 없다');
    assert.equal(twin.T, cell.T, 'v0W2 SE ' + key(cell) + '.T 가 v0X 와 다르다');
    assert.equal(twin.L, cell.L, 'v0W2 SE ' + key(cell) + '.L 가 v0X 와 다르다');
  }
  // (d) 위 (b)(c) 가 성립하는데 v0x 가 라인업에 없다 — 그것이 «차단·비삭제» 다.
  assert.equal(isDroppedFinalLayout('v0x'), true, 'v0x 가 드랍 목록에 없다');
});

// ─────────────────────────────────────────────────────────────────────────
// §v0T 편입 (운영자 확정 2026-08-17) — Type Y 최종 파인더 + v0W 계열 전체 드랍.
//
// 정본·회계·라인업 회귀는 `cellSurfaceFinal.test.js` 가, 왕복은
// `cellSurfaceFinal-decode.test.js` 가 잰다. 여기서 잠그는 것은 **블록 로케이터
// 층의 사실 네 가지**다 (측정: `test/output/lanes/claude-v0t-{toneladder,
// detect-debug,family-interplay}.out.txt`):
//   ① v0T·v0TY 자기 복호가 톤 사다리에서 **12/12** 선다.
//
//      ⚠ **정정 (2026-08-17 링 수리)** — 여기에는 «v0T 의 rot0 × 강한 감마 2칸은
//      약점 핀» 이 있었고, 기전을 «W 블록의 중앙 유사 서명이 `centres` 상위 3
//      슬라이스에서 진짜 중앙을 밀어낸다» 로 귀속했다. **그 귀속은 틀렸다** —
//      실측하니 진짜 중앙의 점수 순위는 전 칸 1\~2위로 상위 3 에 늘 든다
//      (`test/output/lanes/claude-v0t-centre-rank.out.txt`). 중앙은 무죄였다.
//
//      진짜 기전은 **코너 쪽**이었다: v0T 프레임에는 120° 링이 둘 있고
//      (진짜 NE r≈17.8셀 · W 블록 r≈13.4셀), 코너 후보가 «점수순 상위 4» 로
//      **기하 게이트보다 먼저** 잘려 진짜 링의 세 번째 멤버가 5위로 밀려났다.
//      자르기를 싼 필터 **뒤로** 옮기니(§bullseyeConfirmedCornerPool ·
//      §squareRingUsesFullCornerPool) 두 칸이 살아 12/12 가 됐다 —
//      근거: `test/output/claude-v0t-misclassify.md` · `.agent/_lessons/008`.
//      게이트는 한 값도 안 내렸다.
//   ② v0TY 는 12/12 다 — 남은 비대칭 A 블록 하나로 세 방향이 전부 선다
//      (**의도된 비대칭 이중화**의 블록 로케이터 층 실증).
//   ③ 패밀리 스위치가 실재하고 서로 독립이다 (v0tFamily · v0tyFamily).
//   ④ v0TY 슬롯 QR 확증이 v0wy 확증 인프라를 재사용하고도 **스위치는 독립**이다.
// 게이트(0.78 · 0.035 · CRC · RS · 슬롯 QR 문턱 3종)는 한 값도 안 건드렸다.
// ─────────────────────────────────────────────────────────────────────────

/** v0TY — 슬롯이 레이아웃 정의라 qrText 가 필수다 (renderV0wy 와 같은 이유). */
function renderV0ty(pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0ty', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

const V0T_FRAME = embed960(renderFinal('v0t', 1, 15));
const V0TY_FRAME = embed960(renderV0ty(15));

test('v0T 자기 복호 — 톤 4 × 회전 3 전부 (링 수리로 rot0 × 강한 감마 2칸 회수)', {
  timeout: 900_000,
}, () => {
  // 실측 (`claude-v0t-pin-remeasure.out.txt`, 2026-08-17 링 수리 후): **12/12**.
  // 종전 10/12 였고 죽던 두 칸이 gamma0.7·gamma0.6 × rot0 다 — 지금은 셋 다 산다.
  // 회수의 기전은 **불스아이 확증 구제 경로**다: 그 칸들의 진단이 전부
  // `conf = 1/2` 이고 `poseCount.v0t = 3` 이다 (수리 전에는 conf 0/0 · 포즈 0).
  // 그래서 아래는 «복호된다» 뿐 아니라 **무엇이 나르는지**까지 잠근다 — 이 값이
  // 0 으로 돌아가면 캡이 다시 게이트 앞으로 간 것이다 (`.agent/_lessons/008`).
  const PINS = [
    ['clean', {}],
    ['sCurve0.6', { sCurve: 0.6 }],
    ['gamma0.7', { gamma: 0.7 }],
    ['gamma0.6', { gamma: 0.6 }],
  ];
  // 종전 약점 좌표 — 여기서는 «구제 경로가 실제로 날랐다» 를 추가로 단언한다.
  const RESCUED = new Set(['gamma0.7 rot0', 'gamma0.6 rot0']);
  for (const [label, tone] of PINS) {
    for (const rotation of [0, 120, 240]) {
      const frame = distortImage(V0T_FRAME, { ...tone, rotation, fill: FILL });
      const decoded = decodeLab(frame);
      const where = `v0T ${label} rot${rotation}`;
      assert.equal(decoded.ok, true, `${where}: ${decoded.reason || ''}`);
      assert.equal(decoded.text, PAYLOAD, where);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0t',
        `${where} 이 남의 레이아웃으로 복호됐다: ` + decoded.hypothesis.cellSurfaceLayout);
      if (!RESCUED.has(`${label} rot${rotation}`)) continue;
      const detected = detectCellSurfaceBlockShapes(toRelativeLuminance(frame));
      assert.ok(detected.diagnostics.poseCount.v0t > 0,
        `${where}: v0t 포즈가 0 이다 — 링 수리가 되돌아갔나 (lessons/008)`);
      assert.ok(detected.diagnostics.bullseyeConfirmed.centres > 0,
        `${where}: 구제 경로가 안 돌았다 — 이 칸을 나르던 것이 사라졌다`);
    }
  }
});

test('v0TY 자기 복호 — 톤 4 × 회전 3 전부 (남은 A 블록 하나가 세 방향을 가른다)', {
  timeout: 900_000,
}, () => {
  // 실측 12/12 (claude-v0t-toneladder.out.txt). 슬롯이 SE 비대칭을 삼켰는데도
  // 안쪽 A 블록(L 반전 9셀) 하나로 회전 3방향이 전부 선다 — **의도된 비대칭
  // 이중화**(운영자 확정 2026-08-17)의 끝-대-끝 실증. 보충 블록 0 · 마커 이전 0.
  for (const [label, tone] of [
    ['clean', {}], ['sCurve0.6', { sCurve: 0.6 }],
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const where = `v0TY ${label} rot${rotation}`;
      const decoded = decodeLab(distortImage(V0TY_FRAME, { ...tone, rotation, fill: FILL }));
      assert.equal(decoded.ok, true, `${where}: ${decoded.reason || ''}`);
      assert.equal(decoded.text, PAYLOAD, where);
      assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0ty',
        `${where} 이 남의 레이아웃으로 복호됐다: ` + decoded.hypothesis.cellSurfaceLayout);
    }
  }
});

test('v0T 계열 패밀리 스위치 — 기본 on · 끄면 0 · 서로 독립 (v0ty 슬롯 확증 포함)', {
  timeout: 600_000,
}, () => {
  // v0TY 프레임이 계측 기준이다 — v0t·v0ty 포즈가 **함께** 서는 프레임이라
  // (claude-v0t-family-interplay.out.txt: v0t 4 · v0ty 2) 두 스위치의 독립을
  // 한 프레임에서 잴 수 있다. (v0T 프레임 rot0 은 위 약점 핀의 기전 때문에
  // 앵커드 포즈가 0 이라 계측 기준으로 못 쓴다.)
  const luma = toRelativeLuminance(distortImage(V0TY_FRAME, { rotation: 0, fill: FILL }));
  const base = detectCellSurfaceBlockShapes(luma);
  assert.ok(base.diagnostics.poseCount.v0ty >= 1,
    'v0TY 프레임에서 v0ty 포즈가 0 이다: ' + JSON.stringify(base.diagnostics.poseCount));
  assert.ok(base.diagnostics.poseCount.v0t >= 1,
    'v0TY 프레임에서 v0t 포즈가 0 이다 (시드 공유 기대): '
    + JSON.stringify(base.diagnostics.poseCount));
  // 끄면 0 — 각각.
  const noV0t = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0tFamily: false } },
  });
  assert.equal(noV0t.diagnostics.poseCount.v0t, 0, 'v0tFamily off 인데 v0t 포즈가 섰다');
  assert.ok(noV0t.diagnostics.poseCount.v0ty >= 1,
    'v0t 를 껐더니 v0ty 까지 죽었다 — 두 패밀리가 한 스위치에 묶였다');
  const noV0ty = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0tyFamily: false } },
  });
  assert.equal(noV0ty.diagnostics.poseCount.v0ty, 0, 'v0tyFamily off 인데 v0ty 포즈가 섰다');
  assert.ok(noV0ty.diagnostics.poseCount.v0t >= 1,
    'v0ty 를 껐더니 v0t 까지 죽었다 — 두 패밀리가 한 스위치에 묶였다');
  // 슬롯 QR 확증 스위치 — v0wy 확증 인프라를 재사용하되 **스위치는 독립**이다:
  // v0wyRequireSlotQr 를 꺼도 v0ty 확증은 그대로 돈다 (poseCount 불변).
  const wyOff = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0wyRequireSlotQr: false } },
  });
  assert.equal(wyOff.diagnostics.poseCount.v0ty, base.diagnostics.poseCount.v0ty,
    'v0wyRequireSlotQr 스위치가 v0ty 확증까지 껐다 — 스위치 독립이 깨졌다');
});
