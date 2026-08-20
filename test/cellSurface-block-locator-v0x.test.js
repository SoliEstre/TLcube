/**
 * cellSurface-block-locator-v0x.test.js — CS 파인더 블록 로케이터 회귀 (분할).
 *
 * 원본 `cellSurface-block-locator.test.js` 를 축으로 나눈 조각.
 * 축: v0X 패밀리 회귀 + v0X 드랍(차단·비삭제).
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

const V0X_FRAME = embed960(renderFinal('v0x', 1, 15));
const V1R2_FRAME = embed960(renderFinal('v1r2', 1, 15));
const V0W_FRAME = embed960(renderFinal('v0w', 1, 15));
const V0W2_FRAME = embed960(renderFinal('v0w2', 1, 15));

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
  // 의도적 갱신 (2026-08-18 운영자 실기기 판정) — 기본이 v0tr 로 바뀌었다.
  assert.equal(finalLayoutIdForN(21), 'v0t', 'n=21 기본이 v0t 이 아니다');
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
