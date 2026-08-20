/**
 * cellSurface-block-locator-v0xq.test.js — CS 파인더 블록 로케이터 회귀 (분할).
 *
 * 원본 `cellSurface-block-locator.test.js` 를 축으로 나눈 조각.
 * 축: v0xq 패밀리 회귀 + v0XQ 드랍(차단·비삭제).
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

const V0XQ_FRAME = embed960(renderV0xq(15));
const V0X_FRAME = embed960(renderFinal('v0x', 1, 15));
const V2R2_FRAME = embed960(renderFinal('v2r2', 1, 15));
const V1R2_FRAME = embed960(renderFinal('v1r2', 1, 15));
const V0_FRAME = embed960(renderFinal('v0', 0, 17));
const V0WQ_FRAME = embed960(renderV0wq(15));

// ─────────────────────────────────────────────────────────────────────────
// v0xq 패밀리 (2026-08-17) — 3코너 동심 사각(NE 사분면) + 중앙 QR.
//
// 최종 라인업에서 **처음으로 K3 불스아이 중앙이 없다** (그 자리를 QR 슬롯이 가져갔다).
// 그래서 «K3 중앙 × K5 원거리» 앵커드 시딩이 통째로 성립하지 않고, 코너 동심 사각
// 3개의 120° 삼중점이 중앙·스케일·위상을 동시에 준다. 중앙 QR 블록 자체가 제4 앵커다.
// ─────────────────────────────────────────────────────────────────────────

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
    // **의도적 갱신 «v0TR 계열 편입» (2026-08-17)** — 소비자가 **넷**이 됐다
    // (+ v0trq 삼중점). 그래서 «안 돌는다» 를 보려면 **넷을 다** 꺼야 한다.
    const offAllFour = detectCellSurfaceBlockShapes(luma, {
      calibration: {
        ...RESTORE_DROPPED_LOCATOR.calibration,
        csBlockLocator: {
          ...RESTORE_DROPPED_LOCATOR.calibration.csBlockLocator,
          v0xqFamily: false, v0wqFamily: false, centreBullseyeConfirmedPoses: false,
          v0trqFamily: false,
        },
      },
    });
    assert.equal(offAllFour.diagnostics.centerQr.corners, 0,
      name + ' 셋 다 껐는데 코너 검증이 돌았다');
    assert.equal(offBoth.diagnostics.centerQr.corners, on.diagnostics.centerQr.corners,
      name + ' 확증 조립만 켠 쪽의 코너 수가 갈렸다 — 공유 순회가 끊겼다');
  }
});

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
