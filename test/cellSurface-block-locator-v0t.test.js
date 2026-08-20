/**
 * cellSurface-block-locator-v0t.test.js — CS 파인더 블록 로케이터 회귀 (분할).
 *
 * 원본 `cellSurface-block-locator.test.js` 를 축으로 나눈 조각.
 * 축: v0T · v0TY · v0TRY (Type Y 최종 파인더 계열).
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

// v0TRY (2026-08-18 편입) — v0TR 의 **먼 코너 QR 파생**. v0T → v0TY 와 같은 변형이다.
//
// 여기서 재는 것 셋:
//   ① 자기 복호 — 톤 커브 × 회전에서 **레이아웃 id 까지** 맞는가.
//      ⚠ 이것이 §6 판단의 실물 근거다. 이상 표본기에서는 v0try 프레임이 v0tr 로
//      뽑히지만(동률 1.0 · 부모 승), 그것은 v0ty→v0t · v0trq→v0tr 과 **같은 좌표**이고
//      실물 래스터에서는 슬롯 자리의 진짜 픽셀이 갈라 준다.
//   ② 패밀리 스위치가 실재하고 v0TR·v0TY 와 **서로 독립**인가.
//   ③ 슬롯 QR 확증 스위치가 v0WY·v0TY 와 **독립**인가 (인프라는 공유, 스위치는 별개).
// 게이트(0.78 · 0.035 · CRC · RS · 슬롯 QR 문턱 3종)는 한 값도 안 건드렸다.
// ─────────────────────────────────────────────────────────────────────────

const V0TRY_FRAME = embed960(renderV0try(15));

test('v0TRY 자기 복호 — 톤 4 × 회전 3 전부 (슬롯이 SE 를 삼켜도 A 블록이 세 방향을 준다)', {
  timeout: 900_000,
}, () => {
  for (const [label, tone] of [
    ['clean', {}], ['sCurve0.6', { sCurve: 0.6 }],
    ['gamma0.7', { gamma: 0.7 }], ['gamma0.6', { gamma: 0.6 }],
  ]) {
    for (const rotation of [0, 120, 240]) {
      const decoded = decodeLab(distortImage(V0TRY_FRAME, { ...tone, rotation, fill: FILL }));
      const where = 'v0try ' + label + ' rot' + rotation;
      assert.equal(decoded.ok, true, where + ' 복호: ' + (decoded.reason || ''));
      assert.equal(decoded.text, PAYLOAD, where + ' 페이로드');
      assert.equal(decoded.hypothesis.cellSurfaceLayout, 'v0try',
        where + ' 가 ' + decoded.hypothesis.cellSurfaceLayout + ' 로 읽혔다');
    }
  }
});

test('v0TRY 패밀리 스위치 — 기본 on · 끄면 0 · v0TR·v0TY 와 독립 (슬롯 확증 포함)', {
  timeout: 600_000,
}, () => {
  // 계측 기준은 **v0TRY 자기 프레임**이다 — 이 파일의 조건(ppu 15 · margin 4 ·
  // embed960)에서 v0try 2 · v0ty 2 · v0tr 4 · v0t 4 가 **함께** 서므로 네 스위치의
  // 독립을 한 프레임에서 잴 수 있다 (실측 `claude-v0try-poseprobe.out.txt`).
  //
  // ⚠ 조건이 바뀌면 값도 바뀐다 — 레인 하네스(`claude-v0try-detect.mjs`, embed960
  // **없음**)에서는 같은 레이아웃의 v0try 포즈가 0 이고 v0T 프레임에서만 1 이 선다.
  // v0TY 도 그 하네스에서 자기 포즈가 0 이다 (v0TR 라운드 산출에 같은 값이 찍혀
  // 있다). 즉 이것은 v0TRY 의 성질이 아니라 «먼 코너 슬롯 확증 × 프레임 조건» 의
  // 성질이다. 복호는 두 조건 모두에서 12/12 · 10/10 으로 선다.
  const luma = toRelativeLuminance(distortImage(V0TRY_FRAME, { rotation: 0, fill: FILL }));
  const base = detectCellSurfaceBlockShapes(luma);
  assert.ok(base.diagnostics.poseCount.v0try >= 1,
    'v0TRY 프레임에서 v0try 포즈가 0 이다: ' + JSON.stringify(base.diagnostics.poseCount));
  const off = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0tryFamily: false } },
  });
  assert.equal(off.diagnostics.poseCount.v0try, 0, 'v0tryFamily off 인데 v0try 포즈가 섰다');
  // 독립 — v0try 를 꺼도 v0tr·v0ty·v0t 는 한 자리도 안 움직인다.
  for (const family of ['v0t', 'v0ty', 'v0tr', 'v0trq', 'v0']) {
    assert.equal(off.diagnostics.poseCount[family], base.diagnostics.poseCount[family],
      'v0try 를 껐더니 ' + family + ' poseCount 가 움직였다 — 스위치가 묶였다');
  }
  // 반대 방향 — v0tr·v0ty 를 꺼도 v0try 는 산다.
  for (const other of ['v0trFamily', 'v0tyFamily']) {
    const otherOff = detectCellSurfaceBlockShapes(luma, {
      calibration: { csBlockLocator: { [other]: false } },
    });
    assert.ok(otherOff.diagnostics.poseCount.v0try >= 1,
      other + ' 를 껐더니 v0try 까지 죽었다 — 패밀리가 한 스위치에 묶였다');
  }
  // 슬롯 QR 확증 스위치 독립 — v0wy·v0ty 확증을 꺼도 v0try 확증은 그대로 돈다.
  for (const other of ['v0wyRequireSlotQr', 'v0tyRequireSlotQr']) {
    const otherOff = detectCellSurfaceBlockShapes(luma, {
      calibration: { csBlockLocator: { [other]: false } },
    });
    assert.equal(otherOff.diagnostics.poseCount.v0try, base.diagnostics.poseCount.v0try,
      other + ' 스위치가 v0try 확증까지 건드렸다 — 스위치 독립이 깨졌다');
  }
});
