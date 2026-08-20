/**
 * cellSurface-block-locator-seal.test.js — CS 파인더 블록 로케이터 회귀 (분할).
 *
 * 원본 `cellSurface-block-locator.test.js` 를 축으로 나눈 조각.
 * 축: 교차 누수 봉합 + 중앙 불스아이 확증. «봉합 무회귀» 는 단일 테스트라 더 못 쪼갠다.
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

const V0WQ_FRAME = embed960(renderV0wq(15));
const V0W2_FRAME = embed960(renderFinal('v0w2', 1, 15));
const V0WY_FRAME = embed960(renderV0wy(15));
const V0X_FRAME = embed960(renderFinal('v0x', 1, 15));
const V0W_FRAME = embed960(renderFinal('v0w', 1, 15));

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
