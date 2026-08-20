/**
 * cellSurface-block-locator-v0w-wq.test.js — CS 파인더 블록 로케이터 회귀 (분할).
 *
 * 원본 `cellSurface-block-locator.test.js` 를 축으로 나눈 조각.
 * 축: v0W · v0WQ (옛 v0w-series 의 앞쪽). 한 파일로 두면 245s 라 봉합(227s)보다 길다.
 * 본문은 옮기기만 했다. 게이트(minCorrelation 0.56 · minContrastRatio 0.24 ·
 * minOrientationMargin 0.035 · agreement 0.78 · CRC · RS)는 한 값도 안 내렸다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, FILL, PAYLOAD, DEFAULT_FACE_GAINS, BULLSEYE_DARK, BULLSEYE_LIGHT,
  renderFinal, embed960, decodeLab, renderFinal3Tone,
  RESTORE_DROPPED_LOCATOR, RESTORE_DROPPED,
  RESTORE_V0W_SERIES_LOCATOR, PRE_V0T_LINEUP_21,
  RESTORE_V0W_SERIES, RESTORE_V0W_SERIES_ISOLATED_LOCATOR, RESTORE_V0W_SERIES_ISOLATED,
  RESTORE_V0X_LOCATOR, PRE_NORMALIZE_V0X_MID,
  renderV0xq, renderV0wq, renderV0wy, renderV0ty, renderV0try,
  V0W_TONE_PINS, V0W_TONE_PINS_BEFORE_V0W2, V0W2_TONE_PINS, SEAL_ALL_OFF,
  decodeFrontend, detectQrFinderTriples, toRelativeLuminance,
  CS_BLOCK_LOCATOR_INTERNALS, detectCellSurfaceBlockShapes,
  estimateHomography4, CORNER_UNIT_OFFSETS,
  V0WQ_BLOCKS, V0W_BLOCKS, V0W2_BLOCKS, V0XQ_BLOCKS,
  allFinalLayoutIdsForN, cellSurfaceFinal, centerQrSlotCellsFor, centerQrSlotOriginFor,
  finalLayoutIdForN, finalLayoutIdsForN,
  isDroppedFinalLayout, locatorCellsCellSurfaceFinal,
  faceBasis, encode, encodeA, buildScene, TL_READER_URL, distortImage,
  encodeY, buildSceneY, rasterize,
} from './cellSurface-block-locator.helpers.mjs';

const V0_FRAME = embed960(renderFinal('v0', 0, 17));
const V0X_FRAME = embed960(renderFinal('v0x', 1, 15));
const V0XQ_FRAME = embed960(renderV0xq(15));
const V0WQ_FRAME = embed960(renderV0wq(15));
const V2R2_FRAME = embed960(renderFinal('v2r2', 1, 15));
const V1R2_FRAME = embed960(renderFinal('v1r2', 1, 15));

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
