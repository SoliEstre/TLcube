/**
 * cellSurface-block-locator-v0wy-w2.test.js — CS 파인더 블록 로케이터 회귀 (분할).
 *
 * 원본 `cellSurface-block-locator.test.js` 를 축으로 나눈 조각.
 * 축: v0WY · v0W2 (옛 v0w-series 의 뒤쪽 · 슬롯 QR · 약점 핀).
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

const V0W_FRAME = embed960(renderFinal('v0w', 1, 15));
const V0WQ_FRAME = embed960(renderV0wq(15));
const V0WY_FRAME = embed960(renderV0wy(15));
const V0_FRAME = embed960(renderFinal('v0', 0, 17));
const V0X_FRAME = embed960(renderFinal('v0x', 1, 15));
const V0XQ_FRAME = embed960(renderV0xq(15));
const V2R2_FRAME = embed960(renderFinal('v2r2', 1, 15));
const V1R2_FRAME = embed960(renderFinal('v1r2', 1, 15));

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
