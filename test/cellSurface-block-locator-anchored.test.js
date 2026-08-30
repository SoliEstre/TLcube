/**
 * cellSurface-block-locator-anchored.test.js — CS 파인더 블록 로케이터 회귀 (분할).
 *
 * 원본 `cellSurface-block-locator.test.js` 를 축으로 나눈 조각.
 * 축: v0 / v2r2 / v1r2 앵커드 시딩 · 정식 경로 핀 · 구 v2r2 소각.
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
const V2R2_FRAME = embed960(renderFinal('v2r2', 1, 15));
const V1R2_FRAME = embed960(renderFinal('v1r2', 1, 15));

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

/*
 * ⚠ **핀 뒤집기 (2026-08-19 · 운영자 결정)** — 이 자리에 있던 테스트는
 * 「정식 경로 불변 — enableCellSurfaceY 미설정이면 로케이터가 돌지 않는다」였다.
 * 그 명제는 **셀 표면이 시험판 전용이라는 전제** 위에 서 있었고, 그 전제가 뒤집혔다:
 * 인쇄 포스터의 TL 이 v0 셀 표면이 되면서 «레퍼런스 기본값이 우리 대표 인쇄물을
 * 못 읽는» 상태를 없애야 했고, `enableCellSurfaceY` 의 **기본값이 켜짐**으로 올라갔다.
 *
 * **지우지 않고 뒤집는다.** 지우면 「정식 경로가 무엇을 수용하는가」를 아무도 안 재게
 * 되고, 그건 원래 이 핀이 막던 사고(계열이 조용히 정식으로 새는 것)를 **반대 방향으로**
 * 다시 여는 것이다. 오늘은 «샌» 게 아니라 «의도적으로 옮긴» 것이므로, 핀도 그 새 경계를
 * 재게 고쳐 적는다.
 *
 * 실측으로 갈린 것 (`test/output/claude-cs-blocklocator-split.mjs`, 실사진 195장):
 * 이 플래그 하나가 **가격표가 정반대인 두 기능**을 켠다 —
 *   · 셀 표면 **라인업**: 비용 +39% · 실사진 회복 **+1** (그러나 **포스터가 이걸 요구**한다)
 *   · **블록 로케이터**: 비용 +4% 추가 · 실사진 회복 **+16**
 * 그래서 둘 다 켠 채로 둔다. 근거가 서로 다를 뿐이다.
 */
test('정식 경로가 이제 **블록 로케이터를 돌린다** (기본값 전환 후)', {
  timeout: 300_000,
}, () => {
  const frame = distortImage(V0_FRAME, { sCurve: 0.6, fill: FILL });
  const result = decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {});
  assert.equal(result.ok, true,
    '정식 경로가 S커브 0.6 v0 를 못 읽는다: ' + JSON.stringify(result.reason));
  assert.equal(result.text, PAYLOAD);
  assert.equal(result.hypothesis.cellSurface, true, '정식 경로가 CS 로 안 읽었다');
});

test('그래도 `csBlockLocator: false` 는 **여전히 끈다** (스위치가 살아 있다)', {
  timeout: 300_000,
}, () => {
  // 기본값이 켜졌다고 해서 스위치가 사라지면 안 된다 — 비용을 못 물리게 되고,
  // 위 테스트가 「무엇 덕에 읽히는지」를 구분하지 못하게 된다.
  const frame = distortImage(V0_FRAME, { sCurve: 0.6, fill: FILL });
  const result = decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, { bootstrap: { family: { cube: { csBlockLocator: false } } } });
  const diagnostics = result.ok
    ? result.diagnostics
    : (result.detail && result.detail.diagnostics);
  assert.ok(!JSON.stringify(diagnostics || {}).includes('cell-surface-block-locator'),
    'csBlockLocator: false 인데 진단에 블록 로케이터 흔적이 있다');
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
  // 감마 0.7 은 포맷 후보 전멸, 감마 0.6 도 이제 같은 단계다.
  // **단계 이동 (2026-08-30)**: 0.6 은 종전 앵커(no-anchors)에서 죽었는데, 무시드
  // 재시도(frontend §무시드 재시도 — 시드 정권의 기하 전멸 프레임을 사다리 finder
  // 로 한 번 더 돈다)가 기하 단계를 넘겨줘 이제 포맷에서 죽는다. 약점 자체(복호
  // 실패)는 그대로다 — 핀은 «죽는다» 가 본체고 단계는 진단 기록이다.
  const expected = {
    0.7: 'frontend:no-format-candidate',
    0.6: 'frontend:no-format-candidate',
  };
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
    v0t: 0, v0ty: 0, v0tr: 0, v0trq: 0, v0try: 0, v0: 6,
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
    v0t: 0, v0ty: 0, v0tr: 0, v0trq: 0, v0try: 0, v0: 6,
  }, '격리 대조군의 전제가 움직였다 — 재측정하고 핀을 갱신하라');
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
    v0t: 0, v0ty: 0, v0tr: 0, v0trq: 0, v0try: 0, v0: 0,
  });
  assert.equal(detected.shapes.length, 0);
});
