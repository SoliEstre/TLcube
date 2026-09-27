// cell-shape-measured-config.test.js — 셀 꾸미기 «측정 구성» 잠금 (2026-09-27 자리 레인 · 강조 레인)
//
// 허용표 행은 표 키(타입 · 버전 · 파인더 · 톤 · 틈 · 바탕 · 팔레트 · QR 위치)만 갖지만, 그 행이 참인 것은 **측정 구성**
// (L6 · L6g 측정 하네스 규약 — 자동 자리 · O · C 는 안쪽 없음 · G 는 자동 안쪽 o-cm · 사괘 없음 · ECC H · 검출 강조 O/G/A/K 'all' ·
// Y 미전달)에서다.
// 표 키 밖의 축이 다르면 같은 표 키에서도 셀 역할 · 정정 여유 · 채움색이 달라진다(A · K 바깥 «없음» 이 a-cm/k-cm 에서 잰 행으로
// 열리던 거짓 열림 · 강조 'locator' · 'default' 가 'all' 에서 잰 행으로 열리던 거짓 열림). 그래서 resolver 는 렌더 구성이 그
// 타입의 측정 구성(cell-shape `CELL_SHAPE_MEASURED_CONFIG`)과 다르면 모든 모양을 잠근다.
// 사유는 참이어야 한다(2026-09-27 검토) — «자리 · ECC · 강조 탓» 은 측정 구성으로 바꾸면 그 행이 열릴 때만, 행이 없거나 영구
// 설계 잠금이면 그 사유(unmeasured · bevel-raised · bullseye-dot …)다. 측정 구성 키는 설계 잠금 문맥 키(하네스 계약)와 따로 둔다.
// 검출 강조는 «넘긴 값» 이 아니라 «그 렌더에서 같은 그림을 내는 값의 집합»(generator-render-config `detectorEmphasisEquivalents`)
// 이고, 측정 구성과의 비교는 «측정 값이 그 집합에 드는가» 다 — 소비 표면이 없으면 세 값 전부(«해당 없음», 늘 일치).
//
// 재는 것(실제 인코더 · 생성 허용표 · 제품 자동 자리표 · 실제 렌더):
//   ⓐ 유닛 — 측정 구성 문맥은 생성 표 행으로 열리고, 표 키가 같은 «한 축만 다른» 문맥은 새 사유로 잠긴다:
//      A · K 바깥 없음(seat-config) · O 사괘(seat-config) · 같은 버전 ECC M · L(ecc-level, G · Y 포함) · O 안쪽 o-cm = G(G 자기
//      행 — 표 행 ⇔ 열림) ·
//      강조(detector-emphasis): 중앙 TL 의 O · G · A · K 에서 'locator' · 'default', Y 고급 화면이 실은 'all' · 'locator'.
//      강조를 소비하는 표면이 없는 렌더(대상 아닌 중앙 · 검출 셀 없음 · Y hex-frame)는 무엇을 넘겨도 «해당 없음» 이라 안 잠긴다.
//      K · Y 기본 인코딩이 ctx-incomplete 로 잠기지 않는다(K 사괘 «개념 없음» = false).
//   ⓑ 유도 규칙의 반례 — K 는 사괘를 던지고 결과에 키가 없다(«개념 없음» 의 근거) · 인코더가 boolean 을 주면 늘 그 값 ·
//      O/A 에서 키가 빠지면 값 모름(ctx-incomplete) · ECC 이름 밖 값은 값 모름 · 렌더 강조가 없거나 폐쇄집합 '+' 목록이
//      아니면 값 모름 · 유도 함수는 입력을 모르면 undefined.
//   ⓒ 생성 표 성질 — 행이 있는 타입마다 선언이 있고, 모든 셀 행은 그 타입 측정 구성 문맥에서 열리며, 측정 구성 키를 하나
//      바꾸면 그 축의 사유로 잠긴다(ECC 는 다른 레벨 전부 · 강조는 측정 값을 안 담은 집합 전부). 측정 값을 담은 집합은 열린다.
//      타입 키는 행을 가른다 — 한 타입에만 있는 (비-type 문맥 · 모양 · 강도)는 다른 선언 타입의 측정 구성 문맥에서 잠기고(생성 표 —
//      O 행 ↔ G 문맥이 실제 거짓 열림 축), 행 하나 표에서도 다른 타입 문맥은 안 열린다(모든 순서쌍 — 표가 같은 A ↔ K 포함).
//   ⓓ 선언 ↔ 제품 기본(성질) — 제품 자동 자리 · 제품 기본 강조로 그린 와이어/그림이 선언과 같으면 그 문맥의 표 행이 열리고,
//      다르면 잠긴다(A · K · 제품 기본 O = 자동 안쪽 o-cm 이라 실효 타입 G). 값의 같음은 강제하지 않는다(제품 기본이 바뀌면 그
//      기본이 잠기는 것이 맞다 — 선언은 영수증에서만 바꾼다).
//   ⓔ 선언이 묶인 영수증 = 허용표 RECEIPT_SHA256 — 표를 다시 생성하면 빨개진다(선언을 재유도하고 sha 를 갱신할 것).
//   ⓕ 사유는 참이다(반사실 불변식) — 생성 표의 문맥 격자(측정 구성 · 자리/ECC/강조 뒤집기 · 두 축 동시 · 같은 그림 집합 · 틈 ·
//      행 없는 버전 × 모든 선택지)에서 seat-config · ecc-level · detector-emphasis ⇒ 측정 구성으로 바꾸면 열린다 · 사유는 첫 번째로
//      다른 축(자리 → ECC → 강조) · exposed-gap ⇒ 틈만 흰색으로 바꾸면 열린다 · unmeasured ⇒ 그 어느 한 축만 바꿔서는 안 열린다 ·
//      설계 잠금 ⇒ 측정 구성으로 바꿔도 같은 사유다. 측정 구성과 다르면 열림은 없다.
//      반사실은 **표 키 고정**(같은 버전)이다 — 제품 자동 버전은 구성을 바꾸면 재인코딩으로 버전이 바뀔 수 있어(짧은 페이로드의
//      G + 사괘 · G ECC M 실측) «되돌리면 열린다» 까지는 이 자가 말하지 않는다(사유 문구 «이 구성으로는 확인 안 됨» 은 그때도 참).
//   ⓗ ECC 반사실의 실현 조건(2026-09-28, DESIGN_002 §4.4) — ecc-level 은 같은 표 키에서 측정 ECC(H)로 그 페이로드가 들어갈 때만.
//      제품 인코더로 길이를 훑어(G · A · K · Y v0tr n25) M 인코딩의 표 키에 행이 있으면 «H 가 그 버전에 들어가는가»(그 버전 H 용량 —
//      유도 함수와 다른 길)에 따라 ecc-level ↔ unmeasured 인지 잰다. 설계가 이름 붙인 auto-M 길이(G 80 · A 85 · K 120 · Y 114 B)는
//      unmeasured. ⓒ · ⓕ 는 합성 문맥에서 실현 조건(보조 필드 eccLevelsAtTableKey)의 거짓 · 모름을 같이 뒤집는다.
//   ⓖ 실효 검출 강조 ≡ 실제 렌더 — 제품 조립 격자(O · A · K 파인더 × 코너 마커 × 중앙 QR × 팔레트, Y 스키마 레이아웃 전부)에서
//      «q 가 넘긴 p 의 집합에 든다 ⟺ p 와 q 가 같은 장면(도형 JSON 전부 — 채움색만이 아니라 좌표 · 획 · 순서까지)» 을
//      buildScene · buildSceneY 로 잰다 — 유도 함수의 렌더 구조(중앙 검출기 두 팔 · 검출 셀 한 팔 · Y 셀 표면 로케이터)를 믿지 않는다.
//      장면 전체를 비교하므로 강조가 앞으로 색 밖의 속성을 바꿔도(유도는 팔레트만 본다) 거짓 열림으로 빨개진다.
// 못 재는 것: 측정 구성 자체가 참인가(private 측정 하네스 · 영수증의 몫 — 지금 하네스 조립이 선언과 같은지는
//   test/cell-shape-ctx-locks.test.js ⑦ 이 TL_L0_DIR 에서 잰다). ECC 는 기하가 아니라 판독 여유 축이다 — 같은
//   버전의 M · L 이 실제로 안 읽힌다는 증거가 아니라 «측정 밖» 이라서 잠근다(강조도 같다 — 다른 그림이 안 읽힌다는 증거가 아니다).
//   중앙 M7(central-marker-n7)은 제품 파인더 선택지에 없어 ⓖ 격자 밖이다(유도 함수는 그 화법에서 'locator' · 'all' 을 보수로 가른다).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as ALLOW from '../src/cell-shape-allow.js';
import {
  CELL_SHAPE_ALLOW_KEYS, CELL_SHAPE_DEFAULT, CELL_SHAPE_DETECTOR_EMPHASIS_MODES, CELL_SHAPE_DETECTOR_EMPHASIS_NOT_APPLICABLE,
  CELL_SHAPE_LOCK_CTX_KEYS, CELL_SHAPE_LOCK_REASONS, CELL_SHAPE_MEASURED_CONFIG, CELL_SHAPE_MEASURED_CONFIG_AXES,
  CELL_SHAPE_MEASURED_CONFIG_KEYS, CELL_SHAPE_MEASURED_CONFIG_RECEIPT_SHA256, CELL_SHAPE_PARAMS, CELL_SHAPE_REQUIRED_CTX_KEYS,
  CELL_SHAPE_SEAT_CONFIG_KEYS, CELL_SHAPE_STRUCTURAL_LOCK_REASONS, EXPOSED_CELL_SHAPES, cellShapeAllowCtx, cellShapeCtx,
  cellShapeTypeOf, resolveCellShapeSpec,
} from '../src/cell-shape.js';
import { ECC_NAME_BY_VALUE } from '../src/formatinfo.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { encodeY } from '../src/encodeY.js';
import {
  centralBeaconEncoderOptions, centralN7FamilyForType, detectorEmphasisEquivalents, eccLevelsAtTableKey, encodeOptionsForY,
  sceneOptionsForOA,
} from '../src/generator-render-config.js';
import {
  CENTRAL_N7_EMPHASIS_MODES, DEFAULT_CENTRAL_N7_EMPHASIS, GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS,
} from '../src/centralN7Emphasis.js';
import { AUTO_SEAT_TYPES, SEAT_NONE, SEAT_SAGOAE, autoSeatsFor } from '../src/generator-seat-auto.js';
import { resolveAutoY } from '../src/generator-auto-y.js';
import { cornerMarkerSeatActive } from '../src/finder-zone-ui.js';
import { DECORATION_STATE_DOMAINS, GENERATOR_STATE_SCHEMA, createGeneratorState } from '../src/generator-state.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, getPreset } from '../src/luminance.js';
import { makeCustomPalette } from '../src/palette-hue.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY } from '../src/sceneY.js';
import { TL_READER_URL } from '../src/qr.js';
import { daehanPatternId } from '../src/finder-daehan.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';

const R = CELL_SHAPE_LOCK_REASONS;
const PAYLOAD = 'https://tl.estre.so'; // 19 B — 제품 기본 URL
const P12 = 'https://tl.e'; // 12 B — O 사괘가 측정 버전(V2)에 머무는 길이
const N7 = centralBeaconEncoderOptions('central-n7-payload', false);
const FRESH = createGeneratorState({ qrPosition: 'TL' });
const ECC_NAMES = Object.freeze(Object.values(ECC_NAME_BY_VALUE));
const Y_TL = { mode: 'corner', corner: 'TL' };
const yEnc = (eccLevel, locatorProfileY = 'cell-surface-v0') => encodeY(PAYLOAD, { ...encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY }), eccLevel });
const NA = CELL_SHAPE_DETECTOR_EMPHASIS_NOT_APPLICABLE;

/** 생산자 팔레트 모양(index.html paletteOf — 배경 · 레벨 · 파인더 축 · 면 게인). */
const paletteOf = (levels) => ({
  background: { r: 255, g: 255, b: 255 }, levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
  faceGains: { T: 1, L: 0.72, R: 0.57 },
});
const SLATE = paletteOf(getPreset('slate').levels);

/** 생산자 옵션에 강조를 **안 싣는다**(라이브러리 기본으로 그린다 — Y 일반 화면 · Y 측정 조립). */
const NOT_PASSED = Symbol('강조 안 넘김');
/** 그 생성기 타입의 측정 구성 강조(선언이 없으면 안 넘김). */
const measuredEmphasis = (type) => (CELL_SHAPE_MEASURED_CONFIG[type] ? CELL_SHAPE_MEASURED_CONFIG[type].detectorEmphasis : NOT_PASSED);
/**
 * 제품 렌더 값 — 안전영역 판 색 + 실효 검출 강조(+ ECC 사유의 실현 조건). 강조는 **제품 유도 함수**(detectorEmphasisEquivalents)로
 * 만든다 — 생산자 옵션은 팔레트 · 그린 파인더(상태 선택 — 이 자의 문맥은 중앙 QR · daehan 이 아니다) · 넘긴 강조(기본 = 그 타입의
 * 측정 구성 값). `source`({fn, text, opts} — 그 인코딩을 만든 인코더 · 페이로드 · eccLevel 뺀 옵션)를 주면 실현 조건
 * (render.eccLevelsAtTableKey)도 **제품 유도 함수**(generator-render-config `eccLevelsAtTableKey`)로 싣는다(2026-09-28 —
 * DESIGN_002 §4.4). 안 주면 싣지 않는다 — 그 문맥은 ECC 가 측정과 달라도 ecc-level 사유를 안 받는다(unmeasured).
 */
function renderOf(type, enc, state, quietColor = 'white', emphasis = measuredEmphasis(type), source = null) {
  const sceneOpts = { palette: SLATE, finderPatternId: state.finderPatternId };
  if (emphasis !== NOT_PASSED) sceneOpts.centralN7Emphasis = emphasis;
  const render = { quietColor, detectorEmphasis: detectorEmphasisEquivalents(type, enc, sceneOpts) };
  if (source) {
    render.eccLevelsAtTableKey = eccLevelsAtTableKey({
      type, state, encodeFn: source.fn, text: source.text, encodeOpts: source.opts, encoded: enc,
    });
  }
  return render;
}
function ctxOf(type, enc, state, quietColor = 'white', emphasis = measuredEmphasis(type), source = null) {
  return cellShapeCtx(type, enc, state, renderOf(type, enc, state, quietColor, emphasis, source));
}
/** 인코더 · 페이로드 · 옵션(eccLevel 제외)으로 인코딩과 그 출처를 함께 만든다 — 실현 조건을 제품 유도 함수로 싣는 문맥용. */
function encodeWith(fn, text, opts, eccLevel) {
  return { enc: fn(text, { ...opts, eccLevel }), source: { fn, text, opts } };
}

/** 강조 값 집합 전부(빈 집합 제외, 폐쇄집합 순서 '+') — 문맥 값 도메인. 제품 폐쇄집합(centralN7Emphasis)에서 만든다. */
function emphasisSets() {
  const out = [];
  for (let mask = 1; mask < (1 << CENTRAL_N7_EMPHASIS_MODES.length); mask += 1) {
    out.push(CENTRAL_N7_EMPHASIS_MODES.filter((_, i) => mask & (1 << i)).join('+'));
  }
  return out;
}
/** 이 자의 비교(유도 코드와 독립): 강조는 «측정 값이 집합에 드는가», 나머지는 같은 값인가. */
const sameAsMeasured = (k, v, measured) => (k === 'detectorEmphasis' ? v.split('+').includes(measured) : v === measured);
/** 측정 구성 키의 «다른 값» 전부 — boolean 은 반대, ECC 는 다른 레벨, 강조는 측정 값을 안 담은 집합. */
function otherValues(key, measured) {
  if (key === 'eccLevel') return ECC_NAMES.filter((e) => e !== measured);
  if (key === 'detectorEmphasis') return emphasisSets().filter((s) => !sameAsMeasured(key, s, measured));
  return [!measured];
}
/** 사유 순서(설계 결정 — 자리 → ECC → 강조). 이 자가 따로 적고, 선언 자가 제품 표와 같은지 본다. */
const AXIS_ORDER = Object.freeze([
  [R.SEAT_CONFIG, ['cornerMarker', 'sagoae']], [R.ECC_LEVEL, ['eccLevel']], [R.DETECTOR_EMPHASIS, ['detectorEmphasis']],
]);
const reasonOfKey = (key) => AXIS_ORDER.find(([, keys]) => keys.includes(key))[0];

/** 문맥의 표 키와 같은 생성 표 행(셀 표) — 행은 박제하지 않고 표에서 고른다. */
function rowsFor(ctx) {
  const base = cellShapeAllowCtx(ctx);
  return ALLOW.ROWS.filter((row) => Object.keys(base).every((k) => row[k] === base[k]));
}
function stateOf(row) {
  const def = CELL_SHAPE_PARAMS[row.cellShape];
  return def ? { cellShape: row.cellShape, [def.key]: row.param } : { cellShape: row.cellShape };
}
const resolveRow = (row, ctx) => resolveCellShapeSpec(Object.freeze(stateOf(row)), Object.freeze(ctx));

/**
 * 측정 구성 문맥(measured)은 생성 표 행으로 열리고, 한 축만 바꾼 문맥(other)은 표 키가 같은데 모든 행이 `reason` 으로 잠긴다.
 * 반환: 잰 행 수(자가 비지 않았는지 호출자가 본다).
 */
function assertMeasuredOpensOtherLocks(name, measured, other, reason) {
  assert.deepEqual(cellShapeAllowCtx(other), cellShapeAllowCtx(measured), `${name}: 표 키가 다르다 — 대조군이 아니다`);
  const rows = rowsFor(measured);
  assert.ok(rows.length > 0, `${name}: 측정 구성 문맥에 표 행이 없다 — 자가 비었다 ${JSON.stringify(cellShapeAllowCtx(measured))}`);
  for (const row of rows) {
    const open = resolveRow(row, measured);
    assert.deepEqual(open, { spec: { kind: row.cellShape, param: row.param } }, `${name}: 측정 구성인데 안 열렸다 ${row.cellShape}(${row.param}) ${open.lockReason}`);
    assert.deepEqual(resolveRow(row, other), { spec: null, lockReason: reason }, `${name}: ${row.cellShape}(${row.param})`);
  }
  return rows.length;
}

// ── 선언의 모양 ─────────────────────────────────────────────────────────────

test('선언: 측정 구성 키는 설계 잠금 문맥 키(하네스 계약)와 겹치지 않고 resolver 요구 키에 든다 · 새 사유 셋은 구조 잠금 사유다', () => {
  // 설계 잠금 문맥 키는 L0 하네스가 케이스마다 유도하는 계약이다(tl-decode LOCK_DERIVE — 모르는 키면 «키 드리프트» 로 멈춘다).
  // 측정 구성 키를 거기 섞으면 표준 원격 전수(TL_L0_DIR)의 cell-shape-ctx-locks ⑥ 이 빨개진다(2026-09-27 검토 blocking).
  for (const t of ['oak', 'y']) {
    for (const k of CELL_SHAPE_MEASURED_CONFIG_KEYS[t]) {
      assert.ok(!CELL_SHAPE_LOCK_CTX_KEYS[t].includes(k), `${t}.${k} 가 설계 잠금 문맥 키(하네스 계약)에 섞였다`);
      assert.ok(CELL_SHAPE_REQUIRED_CTX_KEYS[t].includes(k), `${t}.${k} 를 resolver 가 요구하지 않는다`);
    }
    assert.ok(CELL_SHAPE_MEASURED_CONFIG_KEYS[t].includes('detectorEmphasis'), `${t}: 실효 검출 강조가 측정 구성 키가 아니다`);
  }
  assert.ok(CELL_SHAPE_SEAT_CONFIG_KEYS.every((k) => CELL_SHAPE_MEASURED_CONFIG_KEYS.oak.includes(k)));
  for (const [type, config] of Object.entries(CELL_SHAPE_MEASURED_CONFIG)) {
    const want = CELL_SHAPE_MEASURED_CONFIG_KEYS[type === 'Y' ? 'y' : 'oak'];
    assert.deepEqual(Object.keys(config).sort(), [...want].sort(), type);
    assert.ok(Object.isFrozen(config), type);
    assert.ok(ECC_NAMES.includes(config.eccLevel), `${type}: eccLevel ${config.eccLevel}`);
    assert.ok(CENTRAL_N7_EMPHASIS_MODES.includes(config.detectorEmphasis), `${type}: 측정 구성 강조는 넘긴 값 하나 — ${config.detectorEmphasis}`);
  }
  for (const reason of [R.SEAT_CONFIG, R.ECC_LEVEL, R.DETECTOR_EMPHASIS]) assert.ok(CELL_SHAPE_STRUCTURAL_LOCK_REASONS.includes(reason), reason);
  // 강조 값 도메인은 제품 폐쇄집합의 검증되는 사본이다(cell-shape 는 build-single 순서상 centralN7Emphasis 를 import 못 한다).
  assert.deepEqual([...CELL_SHAPE_DETECTOR_EMPHASIS_MODES], [...CENTRAL_N7_EMPHASIS_MODES]);
  assert.equal(NA, CENTRAL_N7_EMPHASIS_MODES.join('+'), '«해당 없음» = 세 값 전부');
  // 사유 순서 표 — 이 자가 적은 순서(자리 → ECC → 강조)와 같고 측정 구성 키를 정확히 한 번씩 덮는다.
  assert.deepEqual(CELL_SHAPE_MEASURED_CONFIG_AXES.map((a) => [a.reason, [...a.keys]]), AXIS_ORDER.map(([r, k]) => [r, [...k]]));
});

// ── ⓐ 유닛 (실제 인코더) ────────────────────────────────────────────────────

test('ⓐ A · K: 자동 바깥 자리(코너 마커)는 생성 표 행으로 열리고, 바깥 «없음» 은 표 키가 같아도 seat-config 로 잠긴다', () => {
  const A = { ...FRESH, type: 'A' };
  const aMeasured = ctxOf('A', encodeA(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' }), { ...A, outerSeat: 'a-cm' });
  const aNone = ctxOf('A', encodeA(PAYLOAD, { ...N7, eccLevel: 'H' }), A);
  assert.equal(aMeasured.cornerMarker, true);
  assert.equal(aNone.cornerMarker, false);
  assertMeasuredOpensOtherLocks('A 바깥 없음', aMeasured, aNone, R.SEAT_CONFIG);

  const K = { ...FRESH, type: 'K' };
  const kMeasured = ctxOf('K', encodeK(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' }), { ...K, outerSeat: 'k-cm' });
  const kNone = ctxOf('K', encodeK(PAYLOAD, { ...N7, eccLevel: 'H' }), K);
  assertMeasuredOpensOtherLocks('K 바깥 없음', kMeasured, kNone, R.SEAT_CONFIG);
});

test('ⓐ O: 안쪽 없음(O)은 열리고, 안쪽 o-cm(G — 자동 코너 마커)은 G 자기 행으로 열리며(표 행 ⇔ 열림), 사괘는 같은 버전에서 seat-config 로 잠긴다', () => {
  const O = { ...FRESH, type: 'O' };
  const oMeasured = ctxOf('O', encode(P12, { ...N7, eccLevel: 'H', version: 2 }), O);
  const oSagoae = ctxOf('O', encode(P12, { ...N7, sagoae: true, eccLevel: 'H', version: 2 }), { ...O, deepSeat: 'sagoae' });
  assert.equal(oSagoae.sagoae, true);
  assertMeasuredOpensOtherLocks('O 사괘', oMeasured, oSagoae, R.SEAT_CONFIG);
  // 안쪽 o-cm(제품 자동) — 실효 타입 G(표 키 type 이 O 와 갈린다). G 행은 G 측정 구성(안쪽 코너 마커 · 마커 톤)에서 잰 사실이라
  // 제품 인코더가 그 구성으로 만든 문맥은 G 자기 행으로 열린다. 수치(행 수 · 특정 행)는 박제하지 않는다 — 성질:
  // «행 > 0» 과 «셀 모양 선택지 전부에서 열림 ⇔ 그 (모양, 강도) 의 G 행이 있다».
  const g = ctxOf('O', encode(PAYLOAD, { ...N7, cornerMarker: true, markerTones: true, eccLevel: 'H' }), { ...O, innerSeat: 'o-cm' });
  assert.equal(g.type, 'G');
  assert.equal(g.cornerMarker, true, 'G 문맥의 코너 마커 — 인코딩에서 읽는다');
  assert.ok(Object.prototype.hasOwnProperty.call(CELL_SHAPE_MEASURED_CONFIG, 'G'), 'G 행이 있는데 G 측정 구성 선언이 없다(ⓒ)');
  const gRows = rowsFor(g);
  assert.ok(gRows.length > 0, `G(제품 자동 안쪽 o-cm) 문맥에 표 행이 없다 — 자가 비었다 ${JSON.stringify(cellShapeAllowCtx(g))}`);
  // 타입 판별(O 행이 G 문맥을 여는가)은 여기서 재지 못한다 — rowsFor 가 type 키로 이미 거르고, 이 문맥(중앙 n7 · 흰 틈)에서는
  // O · G 행이 같다. 옛 «gRows 가 전부 G» 단언은 구성상 참이라 공허했다(2026-09-27 검토 major) — ⓒ 타입 자가 생성 표 · 행 하나
  // 표로 잰다.
  let opened = 0;
  for (const c of cellChoices()) {
    const def = CELL_SHAPE_PARAMS[c.cellShape];
    const param = def ? c[def.key] : null;
    const hasRow = gRows.some((row) => row.cellShape === c.cellShape && row.param === param);
    const res = resolveCellShapeSpec(Object.freeze(c), Object.freeze(g));
    assert.equal(res.spec !== null, hasRow, `G ${JSON.stringify(c)}: 표 행 ${hasRow ? '있음' : '없음'} · ${res.lockReason ?? 'open'}`);
    if (hasRow) opened += 1;
  }
  assert.ok(opened > 0, 'G 선택지 중 열린 것이 없다 — 자가 비었다');
});

test('ⓐ ECC: 같은 버전에서 측정(H)이 아닌 레벨은 ecc-level 로 잠긴다 — O · G · A · K · Y (H 로도 들어가는 12 · 19 B — 실현 조건 참)', () => {
  const O = { ...FRESH, type: 'O' };
  // 제품 기본 O(자동 안쪽 o-cm → 실효 타입 G) — 인코딩은 제품 매퍼 모양(코너 마커 + 마커 톤). 강조는 G 측정 구성 값.
  const G = { ...FRESH, type: 'O', innerSeat: 'o-cm' };
  const A = { ...FRESH, type: 'A', outerSeat: 'a-cm' };
  const K = { ...FRESH, type: 'K', outerSeat: 'k-cm' };
  const Y = { ...FRESH, type: 'Y', bgMode: 'white' };
  // [이름, 생성기 타입, 인코더, 옵션(eccLevel 제외 — 렌더와 같은 모양), 상태, 페이로드]. 실현 조건은 이 인코더로 제품 유도 함수가 싣는다.
  const cases = [
    ['O v2', 'O', encode, { ...N7, version: 2 }, O, P12],
    ['G v2 o-cm', 'O', encode, { ...N7, cornerMarker: true, markerTones: true, version: 2 }, G, P12],
    ['A v0', 'A', encodeA, { ...N7, cornerMarker: true, version: 0 }, A, P12],
    ['K v0', 'K', encodeK, { ...N7, cornerMarker: true, version: 0 }, K, P12],
    ['Y v0', 'Y', encodeY, encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY: 'cell-surface-v0' }), Y, PAYLOAD],
  ];
  let measured = 0;
  for (const ecc of ECC_NAMES.filter((e) => e !== 'H')) {
    for (const [name, type, fn, opts, state, text] of cases) {
      const quiet = type === 'Y' ? 'none' : 'white';
      const h = encodeWith(fn, text, opts, 'H');
      const o = encodeWith(fn, text, opts, ecc);
      const hCtx = ctxOf(type, h.enc, state, quiet, measuredEmphasis(type === 'O' && state.innerSeat === 'o-cm' ? 'G' : type), h.source);
      const oCtx = ctxOf(type, o.enc, state, quiet, measuredEmphasis(type === 'O' && state.innerSeat === 'o-cm' ? 'G' : type), o.source);
      if (name.startsWith('G')) assert.equal(hCtx.type, 'G', 'O 안쪽 o-cm 은 실효 타입 G');
      // 실현 조건의 전제 — 이 길이는 같은 표 키에서 측정 ECC(H)로 들어간다(제품 인코더로 유도한 값).
      assert.ok(oCtx.eccLevelsAtTableKey.includes('H'), `${name} ECC ${ecc}: 같은 표 키에서 H 가 안 들어간다 ${JSON.stringify(oCtx.eccLevelsAtTableKey)}`);
      if (JSON.stringify(cellShapeAllowCtx(oCtx)) === JSON.stringify(cellShapeAllowCtx(hCtx))) {
        measured += assertMeasuredOpensOtherLocks(`${name} ECC ${ecc}`, hCtx, oCtx, R.ECC_LEVEL);
      } else {
        // 다른 n 으로 갔다면 표 키부터 다르다 — 측정 문맥의 표 키에 ECC 만 바꾼 문맥으로 잰다(그 표 키의 행이 있으니 반사실이 참).
        assert.equal(type, 'Y', `${name}: 버전을 고정했는데 표 키가 달라졌다`);
        for (const row of rowsFor(hCtx)) assert.equal(resolveRow(row, { ...hCtx, eccLevel: ecc }).lockReason, R.ECC_LEVEL);
      }
    }
  }
  assert.ok(measured > 0);
});

test('ⓐ 강조: 중앙 TL(강조 대상)의 O · G · A · K 는 측정 구성 \'all\' 에서 열리고, \'locator\' · \'default\' 는 표 키가 같아도 detector-emphasis 로 잠긴다', () => {
  // [이름, 생성기 타입, 인코딩, 상태, 실효 타입(선언을 찾는 키)]
  const cases = [
    ['O v2', 'O', encode(P12, { ...N7, eccLevel: 'H', version: 2 }), { ...FRESH, type: 'O' }, 'O'],
    // 제품 기본 O = 자동 안쪽 o-cm → 실효 타입 G(중앙 n7 두 팔 + 코너 마커 셀).
    ['G v2 o-cm', 'O', encode(P12, { ...N7, cornerMarker: true, markerTones: true, eccLevel: 'H', version: 2 }),
      { ...FRESH, type: 'O', innerSeat: 'o-cm' }, 'G'],
    ['A v0 a-cm', 'A', encodeA(P12, { ...N7, cornerMarker: true, eccLevel: 'H', version: 0 }), { ...FRESH, type: 'A', outerSeat: 'a-cm' }, 'A'],
    ['K v0 k-cm', 'K', encodeK(P12, { ...N7, cornerMarker: true, eccLevel: 'H', version: 0 }), { ...FRESH, type: 'K', outerSeat: 'k-cm' }, 'K'],
  ];
  let n = 0;
  for (const [name, type, enc, state, effType] of cases) {
    assert.equal(CELL_SHAPE_MEASURED_CONFIG[effType].detectorEmphasis, 'all', name + ': 선언 전제');
    const measured = ctxOf(type, enc, state, 'white', 'all');
    assert.equal(measured.type, effType, name + ': 실효 타입');
    // 중앙 TL 은 로케이터 · 데이터 두 팔을 가져 세 값이 서로 다른 그림이다(ⓖ 가 렌더로 잰다).
    assert.equal(measured.detectorEmphasis, 'all', name);
    for (const other of ['locator', 'default']) {
      const ctx = ctxOf(type, enc, state, 'white', other);
      assert.equal(ctx.detectorEmphasis, other, `${name} ${other}`);
      n += assertMeasuredOpensOtherLocks(`${name} 강조 ${other}`, measured, ctx, R.DETECTOR_EMPHASIS);
    }
  }
  assert.ok(n > 0);
});

test('ⓐ 강조: 소비 표면이 없는 렌더(대상 아닌 중앙 · 검출 셀 없음)는 «해당 없음» — 무엇을 넘겨도 같은 문맥이고 강조로 안 잠긴다', () => {
  let opened = 0;
  for (const finder of ['bullseye', 'pinwheel-c2-2-1100-cw', 'cube-bullseye', 'central-cube-3tone', 'gap-ring-01-2-1-solid']) {
    const state = { ...FRESH, type: 'O', finderPatternId: finder };
    const enc = encode(P12, { ...centralBeaconEncoderOptions(finder, false), eccLevel: 'H', version: 2 });
    const ctxs = CENTRAL_N7_EMPHASIS_MODES.map((m) => ctxOf('O', enc, state, 'white', m));
    for (const ctx of ctxs) {
      assert.equal(ctx.detectorEmphasis, NA, `${finder}: 해당 없음이 아니다`);
      assert.deepEqual(ctx, ctxs[0], `${finder}: 넘긴 강조에 따라 문맥이 달라졌다`);
    }
    // 표 행이 있으면 세 값 모두에서 열리고, 모든 선택지에서 사유가 강조가 아니다(거짓 잠금 없음).
    for (const ctx of ctxs) {
      for (const row of rowsFor(ctx)) {
        assert.deepEqual(resolveRow(row, ctx), { spec: { kind: row.cellShape, param: row.param } }, `${finder} ${row.cellShape}`);
        opened += 1;
      }
      for (const c of cellChoices()) assert.notEqual(resolveCellShapeSpec(c, ctx).lockReason, R.DETECTOR_EMPHASIS, `${finder} ${JSON.stringify(c)}`);
    }
  }
  assert.ok(opened > 0, '해당 없음 문맥에서 연 행이 없다 — 자가 비었다');
  // 대상 아닌 중앙이라도 코너 마커 검출 셀이 있으면 강조가 그림을 바꾼다 — 'locator' ≡ 'all'(검출 셀 한 팔), 'default' 는 다르다.
  // (A · K 의 불스아이 · 핀휠은 표 행이 없어 잠금 사유는 미확인이다 — 강조를 되돌려도 안 열리니 «강조 탓» 이 아니다.)
  for (const [type, fn, seat] of [['A', encodeA, { outerSeat: 'a-cm' }], ['K', encodeK, { outerSeat: 'k-cm' }]]) {
    for (const finder of ['bullseye', 'pinwheel-c2-2-1100-cw']) {
      const state = { ...FRESH, type, finderPatternId: finder, ...seat };
      const enc = fn(PAYLOAD, { cornerMarker: true, eccLevel: 'H' });
      const on = ctxOf(type, enc, state, 'white', 'all');
      assert.equal(on.detectorEmphasis, 'locator+all', `${type} ${finder}`);
      assert.deepEqual(ctxOf(type, enc, state, 'white', 'locator'), on, `${type} ${finder}: locator 와 all 은 같은 그림`);
      const off = ctxOf(type, enc, state, 'white', 'default');
      assert.equal(off.detectorEmphasis, 'default');
      assert.equal(rowsFor(off).length, 0, `${type} ${finder}: 표 행이 생겼다 — 이 단언을 «강조 탓» 반사실로 바꿀 것`);
      assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, off).lockReason, R.UNMEASURED);
    }
  }
});

test('ⓐ 강조 Y: 일반 화면(강조 미전달)은 측정 구성이라 열리고, 고급 화면이 실은 \'all\' · \'locator\' 는 detector-emphasis 로 잠긴다 · hex-frame 은 해당 없음', () => {
  assert.equal(CELL_SHAPE_MEASURED_CONFIG.Y.detectorEmphasis, DEFAULT_CENTRAL_N7_EMPHASIS, '선언 전제 — Y 측정은 강조 미전달');
  const Y = { ...FRESH, type: 'Y', bgMode: 'white' };
  const enc = yEnc('H');
  const notPassed = cellShapeCtx('Y', enc, Y, renderOf('Y', enc, Y, 'none', NOT_PASSED));
  assert.equal(notPassed.detectorEmphasis, 'default', 'Y 셀 표면 로케이터 — 미전달 = 라이브러리 기본 그림');
  // 'default' 를 명시로 넘겨도 같은 그림이다.
  assert.deepEqual(cellShapeCtx('Y', enc, Y, renderOf('Y', enc, Y, 'none', 'default')), notPassed);
  let n = 0;
  for (const m of ['all', 'locator']) {
    const ctx = cellShapeCtx('Y', enc, Y, renderOf('Y', enc, Y, 'none', m));
    assert.equal(ctx.detectorEmphasis, 'locator+all', `Y ${m}: 셀 표면 로케이터는 검출 셀 팔 하나 — locator ≡ all`);
    n += assertMeasuredOpensOtherLocks(`Y 강조 ${m}`, notPassed, ctx, R.DETECTOR_EMPHASIS);
  }
  assert.ok(n > 0);
  // hex-frame · 로케이터 없음 — 셀 표면 로케이터가 없어 강조가 그림을 안 바꾼다.
  for (const profile of ['hex-frame-v1', 'off']) {
    const e = yEnc('H', profile);
    for (const m of CENTRAL_N7_EMPHASIS_MODES) {
      assert.equal(cellShapeCtx('Y', e, { ...Y, locatorProfileY: profile }, renderOf('Y', e, Y, 'none', m)).detectorEmphasis, NA, `${profile} ${m}`);
    }
  }
});

test('ⓐ K · Y 기본 인코딩은 ctx-incomplete 로 잠기지 않는다 — K 사괘는 «개념 없음» 이라 false, Y 는 ECC 가 정의된다', () => {
  const kEnc = encodeK(PAYLOAD);
  const k = ctxOf('K', kEnc, { ...FRESH, type: 'K' });
  assert.equal(k.sagoae, false);
  for (const key of CELL_SHAPE_REQUIRED_CTX_KEYS.oak) assert.notEqual(k[key], undefined, 'K ' + key);
  assert.notEqual(resolveCellShapeSpec({ cellShape: 'bevel' }, k).lockReason, R.CTX_INCOMPLETE);
  const yE = encodeY(PAYLOAD, encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY: 'cell-surface-v0' }));
  const y = ctxOf('Y', yE, FRESH, 'none');
  assert.ok(ECC_NAMES.includes(y.eccLevel), `Y eccLevel ${y.eccLevel}`);
  for (const key of CELL_SHAPE_REQUIRED_CTX_KEYS.y) assert.notEqual(y[key], undefined, 'Y ' + key);
  assert.notEqual(resolveCellShapeSpec({ cellShape: 'bevel' }, y).lockReason, R.CTX_INCOMPLETE);
});

// ── ⓑ 유도 규칙의 반례 ──────────────────────────────────────────────────────

test('ⓑ K 사괘 «개념 없음» 의 근거: encodeK 는 sagoae:true 를 던지고, 결과에 sagoae 키가 없다', () => {
  assert.throws(() => encodeK(PAYLOAD, { sagoae: true }), RangeError);
  const k = encodeK(PAYLOAD, { cornerMarker: true, eccLevel: 'H' });
  assert.equal(Object.prototype.hasOwnProperty.call(k, 'sagoae'), false, 'K 결과에 sagoae 키가 생겼다 — «개념 없음» 유도를 다시 볼 것');
  // 인코더가 boolean 을 주면 그 값이 늘 우선이다(K 가 사괘를 지원하게 되면 자동으로 읽힌다).
  const kWith = ctxOf('K', { ...k, sagoae: true }, { ...FRESH, type: 'K' });
  assert.equal(kWith.sagoae, true);
  assert.ok(rowsFor(kWith).some((row) => row.cellShape === 'bevel'), 'K 측정 문맥의 bevel 행 — 반사실(측정 구성이면 열린다)의 전제');
  assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, kWith).lockReason, R.SEAT_CONFIG);
});

test('ⓑ O · A 에서 표지 키가 빠지면 값 모름(ctx-incomplete) — 개념 없음으로 채우지 않는다 · ECC 이름 밖 값도 값 모름', () => {
  const cases = [
    ['O', encode(PAYLOAD, { ...N7, eccLevel: 'H' }), { ...FRESH, type: 'O' }],
    ['A', encodeA(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' }), { ...FRESH, type: 'A', outerSeat: 'a-cm' }],
    ['K', encodeK(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' }), { ...FRESH, type: 'K', outerSeat: 'k-cm' }],
  ];
  for (const [type, enc, state] of cases) {
    const full = ctxOf(type, enc, state);
    assert.notEqual(resolveCellShapeSpec({ cellShape: 'bevel' }, full).lockReason, R.CTX_INCOMPLETE, type + ' 대조군');
    for (const key of ['cornerMarker', 'sagoae', 'eccLevel']) {
      if (!Object.prototype.hasOwnProperty.call(enc, key)) continue; // K 의 sagoae — 개념 없음(위 ⓑ)
      const { [key]: _drop, ...partial } = enc;
      const ctx = ctxOf(type, partial, state);
      assert.equal(ctx[key], undefined, `${type} ${key}`);
      assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, ctx).lockReason, R.CTX_INCOMPLETE, `${type} ${key} 빠짐`);
    }
    for (const bad of ['RESERVED', 'Q', 2, null]) {
      const ctx = ctxOf(type, { ...enc, eccLevel: bad }, state);
      assert.equal(ctx.eccLevel, undefined, `${type} eccLevel ${bad}`);
      assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, ctx).lockReason, R.CTX_INCOMPLETE);
    }
    // boolean 이 아닌 코너 마커도 값 모름이다.
    assert.equal(ctxOf(type, { ...enc, cornerMarker: 'yes' }, state).cornerMarker, undefined);
  }
});

test('ⓑ 실효 검출 강조 값 모름: render 에 없거나 폐쇄집합 \'+\' 목록이 아니면 undefined(ctx-incomplete) · 유도 함수는 입력을 모르면 undefined', () => {
  const enc = encode(P12, { ...N7, eccLevel: 'H', version: 2 });
  const state = { ...FRESH, type: 'O' };
  const full = ctxOf('O', enc, state);
  assert.equal(full.detectorEmphasis, 'all');
  assert.ok(rowsFor(full).some((row) => row.cellShape === 'bevel' && row.param === CELL_SHAPE_PARAMS.bevel.default), '대조군 전제 — bevel 행');
  assert.deepEqual(resolveCellShapeSpec({ cellShape: 'bevel' }, full).spec, { kind: 'bevel', param: CELL_SHAPE_PARAMS.bevel.default });
  // render 에 강조가 없다(옛 호출 모양 · 측정 하네스의 quietColor 만) — 값 모름이라 잠근다(측정 구성과 «같다» 로 읽지 않는다).
  for (const render of [{ quietColor: 'white' }, { quietColor: 'white', detectorEmphasis: undefined }]) {
    const ctx = cellShapeCtx('O', enc, state, render);
    assert.equal(ctx.detectorEmphasis, undefined);
    assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, ctx).lockReason, R.CTX_INCOMPLETE);
  }
  for (const bad of ['', 'x', 'ALL', 'all+default', 'all+all', 'default+', '+all', null, 3, ['all'], { all: true }]) {
    const ctx = cellShapeCtx('O', enc, state, { quietColor: 'white', detectorEmphasis: bad });
    assert.equal(ctx.detectorEmphasis, undefined, `강조 ${JSON.stringify(bad)}`);
    assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, ctx).lockReason, R.CTX_INCOMPLETE, `강조 ${JSON.stringify(bad)}`);
  }
  // 폐쇄집합 순서의 집합은 그대로 받는다.
  for (const s of emphasisSets()) assert.equal(cellShapeCtx('O', enc, state, { quietColor: 'white', detectorEmphasis: s }).detectorEmphasis, s);
  // 유도 함수 — 팔레트 · 인코딩을 모르거나 강조 값이 폐쇄집합 밖이면 undefined(추측하지 않는다).
  assert.equal(detectorEmphasisEquivalents('O', enc, { finderPatternId: 'central-n7-payload' }), undefined, '팔레트 없음');
  assert.equal(detectorEmphasisEquivalents('O', null, { palette: SLATE }), undefined, '인코딩 없음');
  assert.equal(detectorEmphasisEquivalents('O', enc, undefined), undefined, '옵션 없음');
  assert.equal(detectorEmphasisEquivalents('O', enc, { palette: SLATE, finderPatternId: 'central-n7-payload', centralN7Emphasis: 'max' }), undefined);
  // 안 넘김 = 라이브러리 기본과 같은 그림.
  assert.equal(detectorEmphasisEquivalents('O', enc, { palette: SLATE, finderPatternId: 'central-n7-payload' }),
    detectorEmphasisEquivalents('O', enc, { palette: SLATE, finderPatternId: 'central-n7-payload', centralN7Emphasis: DEFAULT_CENTRAL_N7_EMPHASIS }));
});

// ── ⓒ 생성 표 성질 ──────────────────────────────────────────────────────────

test('ⓒ 생성 표: 행이 있는 타입마다 측정 구성 선언이 있고, 모든 셀 행은 그 구성에서 열리며 구성 키 하나만 바꾸면 그 축 사유로 잠긴다', () => {
  const cellRows = ALLOW.ROWS.filter((r) => r.table === 'oak' || r.table === 'y');
  assert.ok(cellRows.length > 0);
  const typesWithRows = new Set(cellRows.map((r) => (r.table === 'y' ? 'Y' : r.type)));
  for (const t of typesWithRows) {
    assert.ok(Object.prototype.hasOwnProperty.call(CELL_SHAPE_MEASURED_CONFIG, t),
      `타입 ${t} 의 행이 생겼는데 측정 구성 선언이 없다 — cell-shape CELL_SHAPE_MEASURED_CONFIG 에 그 측정 구성을 적어라`);
  }
  // y 행의 표 밖 구조 잠금 키(QR 배치)는 «제품 기본 Y» 값 — cell-shape-allow-generated 와 같다.
  const yLock = { qrPosition: FRESH.qrPosition, qrWindow: false, qrSlot: false };
  let flips = 0;
  let same = 0;
  let unrealizable = 0;
  for (const row of cellRows) {
    const t = row.table === 'y' ? 'Y' : row.type;
    const config = CELL_SHAPE_MEASURED_CONFIG[t];
    // ECC 사유의 실현 조건(보조 필드) — 기본은 «모든 레벨이 같은 표 키에서 들어간다»(이 합성 문맥이 ECC 만 뒤집는 반사실).
    const ctx = { table: row.table, type: t, eccLevelsAtTableKey: ECC_NAMES };
    for (const k of CELL_SHAPE_ALLOW_KEYS[row.table]) ctx[k] = row[k];
    if (row.table === 'y') Object.assign(ctx, yLock);
    Object.assign(ctx, config);
    const at = JSON.stringify(row);
    const open = { spec: { kind: row.cellShape, param: row.param } };
    assert.deepEqual(resolveRow(row, ctx), open, `측정 구성에서 안 열린다: ${at}`);
    for (const key of Object.keys(config)) {
      const want = reasonOfKey(key);
      for (const v of otherValues(key, config[key])) {
        assert.deepEqual(resolveRow(row, { ...ctx, [key]: v }), { spec: null, lockReason: want }, `${key}=${v}: ${at}`);
        flips += 1;
        if (key !== 'eccLevel') continue;
        // 실현 조건 거짓(측정 ECC 가 같은 표 키에서 안 들어간다) · 모름(필드 없음) → «ECC 탓» 이 아니라 unmeasured(잠금은 그대로).
        const { eccLevelsAtTableKey: _all, ...unknown } = ctx;
        for (const bad of [{ ...ctx, [key]: v, eccLevelsAtTableKey: ECC_NAMES.filter((x) => x !== config.eccLevel) }, { ...unknown, [key]: v }]) {
          assert.deepEqual(resolveRow(row, bad), { spec: null, lockReason: R.UNMEASURED }, `${key}=${v} 실현 불가: ${at}`);
          unrealizable += 1;
        }
      }
    }
    // 측정 강조를 담은 집합(해당 없음 포함)은 측정 구성과 같은 그림이다 — 열린다.
    for (const s of emphasisSets().filter((x) => sameAsMeasured('detectorEmphasis', x, config.detectorEmphasis))) {
      assert.deepEqual(resolveRow(row, { ...ctx, detectorEmphasis: s }), open, `강조 ${s}(측정 ${config.detectorEmphasis} 포함): ${at}`);
      same += 1;
    }
  }
  assert.ok(flips >= cellRows.length * 2, `뒤집기 ${flips}`);
  assert.ok(same >= cellRows.length * 2, `같은 그림 집합 ${same}`);
  assert.ok(unrealizable >= cellRows.length * 2, `ECC 실현 불가 ${unrealizable}`);
});

test('ⓒ 타입 키는 행을 가른다 — 한 타입에만 있는 (비-type 문맥 · 모양 · 강도)는 다른 선언 타입의 측정 구성 문맥에서 잠기고, 행 하나 표에서도 다른 타입 문맥은 안 열린다(모든 순서쌍)', (t) => {
  // 왜 따로 재나(2026-09-27 검토 major): 행 매칭에서 type 키를 빼먹는 결함을 위 자들은 못 본다 — rowsFor · 문맥 격자가 모두
  // 행 자기 타입 문맥에서 출발해 «다른 타입 행이 이 문맥을 여는가» 를 묻지 않는다(옛 «G 문맥 행이 전부 G» 단언은 구성상 참).
  // 생성 표에서 O · G 는 비-type 문맥을 공유하고 한쪽에만 있는 (모양, 강도)가 있어 그것이 실제 거짓 열림 축이다(O 측정으로 G 가
  // 열린다). A ↔ K 는 같은 문맥의 행이 똑같아 생성 표로는 판별력이 없다 — (a) 행 하나 표가 표 내용과 무관하게 잰다.
  // 수치(행 · 쌍 · 개수)는 박제하지 않는다 — 표에서 유도하고 «비지 않았다» 만 단언한다.
  const oakTypes = Object.keys(CELL_SHAPE_MEASURED_CONFIG).filter((ty) => ty !== 'Y');
  const oakRows = ALLOW.ROWS.filter((r) => r.table === 'oak');
  assert.ok(oakRows.length > 0 && oakTypes.length >= 2, '타입 자의 전제(선언 타입 둘 이상 · oak 행)');
  const nonTypeKeys = CELL_SHAPE_ALLOW_KEYS.oak.filter((k) => k !== 'type');
  const sig = (r) => JSON.stringify([...nonTypeKeys.map((k) => r[k]), r.cellShape, r.param]);
  const has = new Set(oakRows.map((r) => `${r.type}#${sig(r)}`));
  /** 행의 표 키 문맥을 `type` 으로 옮기고 그 타입의 측정 구성을 싣는다(측정 구성 축으로는 안 잠기는 문맥). */
  const ctxFor = (row, type) => {
    const ctx = { table: 'oak' };
    for (const k of CELL_SHAPE_ALLOW_KEYS.oak) ctx[k] = row[k];
    return Object.freeze({ ...ctx, type, ...CELL_SHAPE_MEASURED_CONFIG[type] });
  };
  const AXIS_REASONS = AXIS_ORDER.map(([r]) => r);
  const counts = { single: 0 };
  for (const row of oakRows) {
    const st = Object.freeze(stateOf(row));
    const at = JSON.stringify(row);
    const open = { spec: { kind: row.cellShape, param: row.param } };
    // 대조군 — 자기 타입 문맥에서는 생성 표로도 행 하나 표로도 열린다(아래 잠금이 다른 이유로 난 것이 아니다).
    assert.deepEqual(resolveRow(row, ctxFor(row, row.type)), open, `자기 타입 문맥에서 안 열린다: ${at}`);
    assert.deepEqual(resolveCellShapeSpec(st, ctxFor(row, row.type), { ROWS: [row] }), open, `행 하나 표 · 자기 타입: ${at}`);
    for (const type of oakTypes) {
      if (type === row.type) continue;
      const ctx = ctxFor(row, type);
      // (a) 행 하나 표 — 다른 타입 문맥은 이 행으로 안 열리고, 사유는 빈 표와 같다(측정 구성 · 틈 탓이 아니다).
      const one = resolveCellShapeSpec(st, ctx, { ROWS: [row] });
      assert.deepEqual(one, resolveCellShapeSpec(st, ctx, { ROWS: [] }), `${row.type} 행 하나가 ${type} 문맥에서 빈 표와 다르게 판정됐다: ${at}`);
      assert.equal(one.spec, null, `${row.type} 행 하나가 ${type} 문맥을 열었다: ${at}`);
      counts.single += 1;
      // (b) 생성 표 — 그 타입 행이 같은 (비-type 문맥 · 모양 · 강도)에 없으면 잠긴다. 측정 구성 문맥이라 사유는 측정 구성 축이 아니다.
      if (has.has(`${type}#${sig(row)}`)) continue;
      const res = resolveRow(row, ctx);
      assert.equal(res.spec, null, `${row.type} 에만 있는 행이 ${type} 문맥에서 열렸다(다른 타입 측정으로 연다): ${at}`);
      assert.ok(!AXIS_REASONS.includes(res.lockReason), `${type} 측정 구성 문맥인데 측정 구성 사유 ${res.lockReason}: ${at}`);
      const pair = `${row.type}->${type}`;
      counts[pair] = (counts[pair] || 0) + 1;
    }
  }
  t.diagnostic(`타입 판별 대조 ${JSON.stringify(counts)}`);
  assert.ok(counts.single > 0, '행 하나 표 대조가 비었다');
  // 판별력 — 제품 기본 짝(O 안쪽 없음 = O ↔ O 자동 = G)은 생성 표에서 반드시 잰다(한쪽에만 있는 조합이 없어지면 표가 두 타입을
  // 가르지 않는다는 뜻이다 — 그러면 이 단언과 함께 ⓐ O 의 제품 문맥 판별 공백을 다시 볼 것).
  assert.ok((counts['O->G'] || 0) + (counts['G->O'] || 0) > 0, `O ↔ G 에서 한 타입에만 있는 행이 없다 — ${JSON.stringify(counts)}`);
});

// ── ⓓ 선언 ↔ 제품 기본 ──────────────────────────────────────────────────────

test('ⓓ 선언 ↔ 제품 기본(성질): 제품 자동 자리 · 제품 기본 강조의 와이어/그림이 선언과 같으면 열리고, 다르면 잠긴다 · O 는 하네스 규약(안쪽 없음) · 제품 기본 O 는 G', (t) => {
  // 값의 같음을 단언하지 않는다 — 선언은 측정 사실(영수증 — ⓔ 가 묶는다)이고 제품 기본은 바뀔 수 있다. 제품 기본이 선언과
  // 달라지면 그 기본이 잠기는 것이 맞다(재측정하거나 제품 기본을 재검토할 일 — 선언을 제품 기본에 맞추면 거짓 열림이 돌아온다).
  const auto = (type) => autoSeatsFor({ type, centralFinderIsTaegeuk: false, allowBlocked: false });
  // 제품 기본 강조 = 생성기 상태 기본(GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS). O/A/K 는 늘 넘기고(sceneOptionsForOA · K 손 조립),
  // Y 일반 화면은 안 넘긴다(renderTypeY 의 고급 게이트 — decoration-ui 자가 제품 경로로 잰다).
  assert.equal(FRESH.centralN7Emphasis, GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS);
  // 생성기 타입 O 의 제품 기본은 자동 안쪽 자리다 — 안쪽이 o-cm 이면 실효 타입 G(선언은 **실효 타입**으로 찾는다).
  for (const type of ['A', 'K', 'O']) {
    const a = auto(type);
    // 자리 id → 와이어: 코너 마커는 제품 술어(finder-zone-ui — buildConfig 의 cornerMarker 와 같은 함수). A 매퍼는 코너 마커가
    // 켜지면 사괘를 떨군다(daehan > 코너 마커 > 사괘) · K 는 사괘 개념이 없다(인코더가 던진다) · O 는 안쪽 코너 마커에 마커 톤을
    // 싣고(O 안쪽 o-cm), 사괘는 심부 자리 그대로다(중앙 n7 — daehan 아님).
    const cm = cornerMarkerSeatActive({ type, innerSeat: a.inner, outerSeat: a.outer, turnA: false });
    const sagoae = (type === 'A' && !cm && a.deep === SEAT_SAGOAE) || (type === 'O' && a.deep === SEAT_SAGOAE);
    const fn = { O: encode, A: encodeA, K: encodeK }[type];
    const enc = fn(PAYLOAD, {
      ...N7, ...(cm ? { cornerMarker: true } : {}), ...(cm && type === 'O' ? { markerTones: true } : {}),
      ...(sagoae ? { sagoae: true } : {}), eccLevel: 'H',
    });
    const state = { ...FRESH, type, innerSeat: a.inner, outerSeat: a.outer, deepSeat: a.deep };
    const ctx = ctxOf(type, enc, state, 'white', FRESH.centralN7Emphasis);
    const label = `${type}(실효 ${ctx.type})`;
    const config = CELL_SHAPE_MEASURED_CONFIG[ctx.type];
    const rows = rowsFor(ctx);
    if (!config) {
      // 선언 없는 실효 타입은 행이 0 이어야 한다(ⓒ) — 제품 기본이 그 타입이면 미확인으로 잠긴다.
      assert.equal(rows.length, 0, `${label}: 선언 없는 실효 타입의 행`);
      t.diagnostic(`${label}: 제품 기본의 실효 타입에 측정 구성 선언이 없다 — 제품 기본이 잠긴다`);
      continue;
    }
    const same = Object.keys(config).filter((k) => k !== 'eccLevel').every((k) => sameAsMeasured(k, ctx[k], config[k]));
    if (same) {
      assert.ok(rows.length > 0, `${label}: 제품 자동 자리 · 기본 강조 = 측정 구성인데 그 문맥의 표 행이 없다 — 자가 비었다`);
    } else {
      t.diagnostic(`${label}: 제품 자동 자리(안쪽 ${a.inner} · 바깥 ${a.outer} · 심부 ${a.deep}) · 기본 강조(${FRESH.centralN7Emphasis})가 `
        + '측정 구성과 다르다 — 제품 기본이 잠긴다. 재측정하거나 제품 기본을 재검토할 것(선언은 영수증에서만 바꾼다)');
    }
    for (const row of rows) {
      const res = resolveRow(row, ctx);
      if (same) assert.deepEqual(res, { spec: { kind: row.cellShape, param: row.param } }, `${label} 자동 ${row.cellShape}(${row.param})`);
      else assert.equal(res.spec, null, `${label} 자동(측정 밖) ${row.cellShape}(${row.param}) 이 열렸다`);
    }
  }
  // O — 측정 하네스는 안쪽을 «없음» 으로 내렸다(안쪽 o-cm 은 타입 G 로 따로 갈린다). 사괘는 자동 심부와 같다.
  const o = auto('O');
  assert.equal(CELL_SHAPE_MEASURED_CONFIG.O.cornerMarker, false);
  assert.equal(CELL_SHAPE_MEASURED_CONFIG.O.sagoae, o.deep === SEAT_SAGOAE);
  assert.equal(cellShapeTypeOf('O', encode(PAYLOAD), { innerSeat: o.inner }), o.inner === SEAT_NONE ? 'O' : 'G',
    '제품 자동 O 의 안쪽 자리가 타입을 가르는 방식이 바뀌었다');
  // 자동 자리표에 있는데 선언이 없는 타입(V)은 표에 행이 0 이어야 한다(행이 생기면 선언 — ⓒ).
  for (const type of AUTO_SEAT_TYPES) {
    if (Object.prototype.hasOwnProperty.call(CELL_SHAPE_MEASURED_CONFIG, type)) continue;
    assert.equal(ALLOW.ROWS.filter((r) => r.table === 'oak' && r.type === type).length, 0, `${type}: 선언 없는 타입의 행`);
  }
});

// ── ⓔ 영수증 결속 ────────────────────────────────────────────────────────────

test('ⓔ 측정 구성 선언이 묶인 영수증 = 허용표 RECEIPT_SHA256 (표를 다시 생성하면 선언을 재유도할 것)', () => {
  assert.match(CELL_SHAPE_MEASURED_CONFIG_RECEIPT_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(ALLOW.RECEIPT_SHA256, CELL_SHAPE_MEASURED_CONFIG_RECEIPT_SHA256,
    '허용표가 다시 생성됐다 — 새 영수증의 측정 구성(자리 · 사괘 · ECC · 검출 강조)을 확인해 CELL_SHAPE_MEASURED_CONFIG 를 재유도하고 '
    + 'CELL_SHAPE_MEASURED_CONFIG_RECEIPT_SHA256 을 갱신하라');
});

// ── ⓕ 사유는 참이다(반사실 불변식) ──────────────────────────────────────────

/** 셀 모양 선택지 전부(끔 제외) — 스키마 도메인에서 유도. */
function cellChoices() {
  const D = DECORATION_STATE_DOMAINS;
  const optionsOf = (key) => (D[key].kind === 'enum' ? D[key].values : D[key].samples);
  const out = [];
  for (const kind of optionsOf('cellShape')) {
    if (kind === CELL_SHAPE_DEFAULT) continue;
    const def = CELL_SHAPE_PARAMS[kind];
    if (!def) { out.push({ cellShape: kind }); continue; }
    for (const v of optionsOf(def.key)) out.push({ cellShape: kind, [def.key]: v });
  }
  assert.ok(out.some((c) => c.cellShape === 'bevel' && c.cellBevel > 1), '선택지에 돌출 bevel 이 없다 — 설계 잠금 갈래가 빈다');
  return out;
}

test('ⓕ 사유는 참이다(표 키 고정 반사실) — 자리 · ECC · 강조 탓은 같은 표 키에서 측정 구성이면 열릴 때만(첫 번째로 다른 축), 틈 탓은 틈만 바꾸면 열릴 때만, 설계 잠금이 먼저다', () => {
  // 반사실은 표 키(버전 포함)를 고정한다 — 제품 자동 버전의 재인코딩(구성을 바꾸면 버전이 바뀐다)은 이 격자 밖이다(머리말 ⓕ).
  const cellRows = ALLOW.ROWS.filter((r) => r.table === 'oak' || r.table === 'y');
  const yLock = { qrPosition: FRESH.qrPosition, qrWindow: false, qrSlot: false };
  const absent = {
    oak: { version: Math.max(...cellRows.filter((r) => r.table === 'oak').map((r) => r.version)) + 1 },
    y: { nBand: String(Math.max(...cellRows.filter((r) => r.table === 'y').map((r) => Number(r.nBand))) + 8) },
  };
  // 표 키 문맥(중복 제거) — 행의 모양 · 강도는 떼고 문맥만. ECC 사유의 실현 조건(보조 필드)은 기본 «모든 레벨이 들어간다»,
  // ECC 가 다른 변형에서만 «측정 ECC 안 들어감» · «모름(필드 없음)» 을 더 잰다(2026-09-28 — DESIGN_002 §4.4).
  const bases = new Map();
  for (const row of cellRows) {
    const t = row.table === 'y' ? 'Y' : row.type;
    const ctx = { table: row.table, type: t, eccLevelsAtTableKey: ECC_NAMES };
    for (const k of CELL_SHAPE_ALLOW_KEYS[row.table]) ctx[k] = row[k];
    if (row.table === 'y') Object.assign(ctx, yLock);
    bases.set(JSON.stringify(ctx), ctx);
  }
  const choices = cellChoices();
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const opens = (st, ctx) => resolveCellShapeSpec(st, ctx).spec !== null;
  for (const base of bases.values()) {
    const config = CELL_SHAPE_MEASURED_CONFIG[base.type];
    // 측정 구성 변형: 그대로 · 키 하나씩 다른 값 전부 · 같은 그림 집합(측정 강조 포함 — 측정 구성과 «같다») · 두 축 동시.
    const variants = [{}];
    for (const k of Object.keys(config)) for (const v of otherValues(k, config[k])) variants.push({ [k]: v });
    for (const s of emphasisSets().filter((x) => x !== config.detectorEmphasis && sameAsMeasured('detectorEmphasis', x, config.detectorEmphasis))) {
      variants.push({ detectorEmphasis: s });
    }
    const seatKey = CELL_SHAPE_SEAT_CONFIG_KEYS.find((k) => k in config);
    const eccOther = ECC_NAMES.find((x) => x !== config.eccLevel);
    const emphOther = otherValues('detectorEmphasis', config.detectorEmphasis)[0];
    if (seatKey) variants.push({ [seatKey]: !config[seatKey], eccLevel: eccOther }, { [seatKey]: !config[seatKey], detectorEmphasis: emphOther });
    variants.push({ eccLevel: eccOther, detectorEmphasis: emphOther });
    // 실현 조건 변형 — ECC 가 측정과 다른 변형에서만: 그대로(전부 들어감) · 측정 ECC 안 들어감 · 모름(보조 필드 없음).
    const realizations = (v) => ('eccLevel' in v && v.eccLevel !== config.eccLevel
      ? [null, { eccLevelsAtTableKey: ECC_NAMES.filter((x) => x !== config.eccLevel) }, 'unknown'] : [null]);
    for (const v of variants) for (const real of realizations(v)) for (const gap of [null, { gapGrade: 'unknown', bgMode: 'transparent' }]) for (const move of [null, absent[base.table]]) {
      const draft = { ...base, ...config, ...v, ...(gap || {}), ...(move || {}), ...(real && real !== 'unknown' ? real : {}) };
      if (real === 'unknown') delete draft.eccLevelsAtTableKey;
      const ctx = Object.freeze(draft);
      const measured = Object.freeze({ ...ctx, ...config });
      const mismatch = Object.entries(v).some(([k, val]) => !sameAsMeasured(k, val, config[k]));
      // ECC 반사실이 실현 가능한가 — 이 자의 판정(측정 ECC 가 보조 필드 목록에 든다). ECC 가 같으면 해당 없음(참).
      const eccRealizable = ctx.eccLevel === config.eccLevel
        || (Array.isArray(ctx.eccLevelsAtTableKey) && ctx.eccLevelsAtTableKey.includes(config.eccLevel));
      // 첫 번째로 다른 축(자리 → ECC → 강조) — 이 자의 비교로 판정한다.
      const firstAxis = AXIS_ORDER.find(([, keys]) => keys.some((k) => k in config && !sameAsMeasured(k, ctx[k], config[k])));
      for (const c of choices) {
        const st = Object.freeze(c);
        const res = resolveCellShapeSpec(st, ctx);
        const where = `${JSON.stringify(ctx)} ${JSON.stringify(c)} → ${res.lockReason ?? 'open'}`;
        if (res.spec) {
          assert.equal(mismatch, false, '측정 구성과 다른데 열렸다: ' + where);
          bump(Object.keys(v).length > 0 ? 'open:equivalent' : 'open');
          continue;
        }
        const reason = res.lockReason;
        bump((mismatch ? 'mismatch:' : 'measured:') + reason);
        if (reason === R.SEAT_CONFIG || reason === R.ECC_LEVEL || reason === R.DETECTOR_EMPHASIS) {
          assert.ok(opens(st, measured), '자리 · ECC · 강조 탓인데 측정 구성으로 바꿔도 안 열린다: ' + where);
          assert.ok(firstAxis, '측정 구성과 같은데 측정 구성 사유: ' + where);
          assert.equal(reason, firstAxis[0], '사유가 가리키는 축이 첫 번째로 다른 축이 아니다: ' + where);
          if (reason === R.ECC_LEVEL) assert.ok(eccRealizable, 'ECC 탓인데 같은 표 키에서 측정 ECC 로 안 들어간다(실현 불가 안내): ' + where);
        } else if (reason === R.EXPOSED_GAP) {
          assert.equal(mismatch, false, '측정 구성까지 다른데 틈 탓: ' + where);
          assert.ok(EXPOSED_CELL_SHAPES.includes(c.cellShape));
          const whiteOpens = ['white', 'transparent', 'black'].some((bg) => opens(st, { ...ctx, gapGrade: 'white', bgMode: bg }));
          assert.ok(whiteOpens, '틈 탓인데 틈만 흰색으로 바꿔도 안 열린다: ' + where);
        } else if (reason === R.UNMEASURED) {
          // 측정 구성으로 바꾸면 열리는데 미확인인 것은 **ECC 가 첫 축이고 그 반사실이 실현 불가**일 때뿐이다(DESIGN_002 §4.4).
          if (opens(st, measured)) {
            assert.ok(firstAxis && firstAxis[0] === R.ECC_LEVEL && !eccRealizable,
              '측정 구성으로 바꾸면 열리는데 미확인이라 한다(자리 · ECC · 강조 탓이어야): ' + where);
            bump('ecc-unrealizable:unmeasured');
          }
          // 틈 탓(exposed-gap)은 노출형(gap · dot)만의 말이다 — 비노출형은 틈이 «드러나지» 않으니 틈 등급 행 차이도 미확인이다(1300dc8 규칙).
          if (EXPOSED_CELL_SHAPES.includes(c.cellShape)) {
            const whiteOpens = ['white', 'transparent', 'black'].some((bg) => opens(st, { ...ctx, gapGrade: 'white', bgMode: bg }));
            assert.ok(!whiteOpens, '틈만 바꾸면 열리는데 미확인이라 한다(틈 탓이어야): ' + where);
          }
        } else {
          // 설계 잠금(영구) — 측정 구성으로 바꿔도 같은 사유로 잠긴다.
          assert.ok(CELL_SHAPE_STRUCTURAL_LOCK_REASONS.includes(reason), '모르는 사유: ' + where);
          assert.deepEqual(resolveCellShapeSpec(st, measured), { spec: null, lockReason: reason }, '설계 잠금이 측정 구성에서 풀린다: ' + where);
        }
      }
    }
  }
  // 판별력 — 각 갈래가 격자에서 실제로 난다(측정 밖 문맥에서 unmeasured · 설계 잠금이 자리 · ECC · 강조 사유에 가려지지 않았다 ·
  // 같은 그림 집합이 실제로 열었다).
  for (const k of ['open', 'open:equivalent', 'mismatch:seat-config', 'mismatch:ecc-level', 'mismatch:detector-emphasis',
    'mismatch:unmeasured', 'mismatch:bevel-raised', 'mismatch:bullseye-dot', 'measured:exposed-gap', 'measured:unmeasured',
    'ecc-unrealizable:unmeasured']) {
    assert.ok(counts[k] > 0, `갈래 ${k} 가 격자에서 안 났다 — ${JSON.stringify(counts)}`);
  }
});

// ── ⓗ ECC 반사실의 실현 조건(제품 인코더) ────────────────────────────────────

test('ⓗ ECC 실현 조건 — 같은 표 키(버전 · n · 레이아웃)에서 측정 ECC(H)로 그 페이로드가 안 들어가면 unmeasured, 들어가면 ecc-level (제품 인코더 · 길이 훑기 · auto-M 길이 G 80 · A 85 · K 120 · Y 114 B)', (t) => {
  // 왜(DESIGN_002 §4.4): 제품 auto 는 H 가 안 들어가는 길이에서 M 을 고르고, 그 버전의 표 키가 H 행과 같으면 hit 가 난다. 그 버전에
  // H 로는 안 들어가므로 «ECC 를 H 로» 는 따를 수 없는 안내다 — 사유는 unmeasured(g1162)여야 한다. 반대로 같은 버전에서 H 로도
  // 들어가는 길이의 수동 M 은 «ECC 탓»(g1210)이 참이다. 제품 경로(index.html auto 사다리 · 카드 사유 문구)는 decoration-ui 가 잰다.
  // 판정 자는 유도 함수(재인코딩 try/catch)와 **다른 길**로 잰다: 그 버전 H 인코딩의 용량(capacity.maxPayloadBytes)과 길이 비교.
  const lenText = (L) => (L >= 20 ? 'https://tl.estre.so/' + 'x'.repeat(L - 20) : 'x'.repeat(L));
  const Y = { ...FRESH, type: 'Y', bgMode: 'white', locatorProfileY: 'cell-surface-v0tr' };
  // [이름, 생성기 타입, 인코더, eccLevel 뺀 옵션(제품 매퍼 모양), 상태, 실효 타입, 설계가 이름 붙인 auto-M 길이, 훑을 최대 길이]
  const TYPES = [
    ['G(O 자동 o-cm)', 'O', encode, { ...N7, cornerMarker: true, markerTones: true }, { ...FRESH, type: 'O', innerSeat: 'o-cm' }, 'G', 80, 100],
    ['A(a-cm)', 'A', encodeA, { ...N7, cornerMarker: true }, { ...FRESH, type: 'A', outerSeat: 'a-cm' }, 'A', 85, 100],
    ['K(k-cm)', 'K', encodeK, { ...N7, cornerMarker: true }, { ...FRESH, type: 'K', outerSeat: 'k-cm' }, 'K', 120, 135],
    ['Y(v0tr n25)', 'Y', encodeY, encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY: 'cell-surface-v0tr', versionY: 2 }), Y, 'Y', 114, 120],
  ];
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  for (const [name, type, fn, opts, state, eff, namedLen, maxLen] of TYPES) {
    const quiet = type === 'Y' ? 'none' : 'white';
    const hMax = new Map(); // 버전 → 그 버전 H 용량(유도 함수와 다른 길)
    const hMaxAt = (version) => {
      if (!hMax.has(version)) {
        let cap = -1;
        try { cap = fn('x', { ...opts, version, eccLevel: 'H' }).capacity.maxPayloadBytes; } catch { cap = -1; }
        hMax.set(version, cap);
      }
      return hMax.get(version);
    };
    const judge = (L, label) => {
      const text = lenText(L);
      let mEnc;
      try { mEnc = fn(text, { ...opts, eccLevel: 'M' }); } catch { return null; }
      const ctx = ctxOf(type, mEnc, state, quiet, measuredEmphasis(eff), { fn, text, opts });
      assert.equal(ctx.type, eff, `${name} ${L} B: 실효 타입`);
      const hFits = L <= hMaxAt(mEnc.version);
      assert.equal(ctx.eccLevelsAtTableKey.includes('H'), hFits,
        `${name} ${L} B(${label}): 유도 함수의 H 실현(${JSON.stringify(ctx.eccLevelsAtTableKey)}) ≠ 그 버전 H 용량 ${hMaxAt(mEnc.version)} B`);
      const rows = rowsFor(ctx);
      for (const row of rows) {
        const res = resolveRow(row, ctx);
        assert.deepEqual(res, { spec: null, lockReason: hFits ? R.ECC_LEVEL : R.UNMEASURED },
          `${name} ${L} B(${label}) M v${mEnc.version}${type === 'Y' ? ' n' + mEnc.n : ''} ${row.cellShape}(${row.param}) — H ${hFits ? '들어감' : '안 들어감'}`);
        // 측정 구성(H · 같은 표 키)이면 이 행이 열린다 — 실현 가능할 때만 «ECC 탓» 이 참이라는 대조군.
        if (hFits) assert.deepEqual(resolveRow(row, { ...ctx, eccLevel: 'H' }), { spec: { kind: row.cellShape, param: row.param } });
      }
      if (rows.length > 0) bump(`${name}:${hFits ? 'ecc-level' : 'unmeasured'}`);
      return { mEnc, ctx, rows, hFits };
    };
    for (let L = 1; L <= maxLen; L += 1) judge(L, '훑기');
    // 설계가 이름 붙인 auto-M 길이: H 는 어느 버전에도 안 들어가(제품 auto 사다리가 M 으로 내려간다) 사유는 unmeasured 다.
    const named = lenText(namedLen);
    if (type === 'Y') {
      const auto = resolveAutoY({ payloadBytes: namedLen, tones: 3, eccLevel: 'auto' });
      assert.deepEqual([auto.ecc, auto.version, auto.locatorProfileY], ['M', 2, 'cell-surface-v0tr'],
        `${name} ${namedLen} B: 제품 auto 가 n25 v0tr ECC M 을 고르지 않는다(A1e 전제 — 이 자의 옵션을 다시 볼 것)`);
    } else {
      assert.throws(() => fn(named, { ...opts, eccLevel: 'H' }), RangeError, `${name} ${namedLen} B: H 가 들어간다 — auto-M 길이가 아니다`);
    }
    const at = judge(namedLen, 'auto-M');
    assert.ok(at && !at.hFits, `${name} ${namedLen} B: 같은 표 키에서 H 가 들어간다 — auto-M 길이가 아니다`);
    t.diagnostic(`${name} ${namedLen} B auto-M: v${at.mEnc.version}${type === 'Y' ? ' n' + at.mEnc.n : ''} · 표 행 ${at.rows.length}(${at.rows.length ? '사유 판별 — unmeasured' : '행 없음 — 판별력 없음'})`);
  }
  t.diagnostic(`실현 조건 대조 ${JSON.stringify(counts)}`);
  // 판별력: 표 행이 있는 키에서 두 갈래(실현 가능 → ecc-level · 실현 불가 → unmeasured)가 실제로 났다 — A 와 Y 는 둘 다(설계 §4.4 의
  // auto-M 버전 A v2 · Y n25 에 행이 있다). G v4 · K v1 · v2 는 지금 표에 행이 없어 unmeasured 가 행 없음에서 온다(판별력 없음).
  for (const k of ['A(a-cm):ecc-level', 'A(a-cm):unmeasured', 'Y(v0tr n25):ecc-level', 'Y(v0tr n25):unmeasured']) {
    assert.ok(counts[k] > 0, `갈래 ${k} 가 안 났다 — ${JSON.stringify(counts)}`);
  }
});

// ── ⓖ 실효 검출 강조 ≡ 실제 렌더 ────────────────────────────────────────────

/**
 * 제품 조립(index.html encodeOptsFor · renderTypeO/A/K/Y)과 같은 모양으로 인코딩 + 생산자 옵션을 만든다. 넘길 강조만 바꿔 가며
 * 옵션을 돌려주는 `opts(emphasis)` 와 그 옵션으로 장면을 짓는 `build` 를 낸다.
 */
function oakCase(name, type, { finder, marker = false, centerQr = false, levels = SLATE.levels, version }) {
  const palette = paletteOf(levels);
  const beacon = centralBeaconEncoderOptions(finder, centerQr);
  let enc;
  if (type === 'O') {
    const daehan = finder === 'oak-daehan-k10' && !centerQr;
    enc = encode(PAYLOAD, {
      centerQr, ...beacon, ...(version === undefined ? {} : { version }), ...(daehan ? { daehanFinder: true } : {}),
      ...(marker ? { cornerMarker: true, markerTones: true } : {}), eccLevel: 'H',
    });
  } else if (type === 'A') {
    enc = encodeA(PAYLOAD, { centerQr, ...beacon, ...(marker ? { cornerMarker: true } : {}), eccLevel: 'H' });
  } else {
    enc = encodeK(PAYLOAD, { ...beacon, ...(marker ? { cornerMarker: true } : {}), eccLevel: 'H' });
  }
  const atomicDaehan = enc.daehanFinder && enc.sagoae !== true;
  const rendered = atomicDaehan ? daehanPatternId(enc.k) : finder;
  const fallback = centerQr ? { mode: 'center', cornerToo: false } : { mode: 'off' };
  const opts = (emphasis) => {
    if (type !== 'K') {
      return sceneOptionsForOA({ centralN7Emphasis: emphasis, fallback, finderPatternId: rendered, palette, qrText: TL_READER_URL, type });
    }
    const o = { palette, margin: 20, finderPatternId: rendered, centralN7Emphasis: emphasis };
    if (finder === CENTRAL_N7_FINDER_PATTERN_ID) o.centralN7Family = centralN7FamilyForType('K');
    return o;
  };
  return { name, type, enc, opts, build: (o) => buildScene(enc, o) };
}

test('ⓖ 실효 검출 강조 ≡ 실제 렌더 — «q 가 넘긴 p 의 집합에 든다 ⟺ p · q 가 같은 장면» (제품 조립 격자 × 강조 3택, buildScene · buildSceneY 로 잰다)', () => {
  const custom0 = makeCustomPalette(0, 'custom', 0).levels;
  const mono = getPreset('mono').levels;
  const cases = [];
  for (const finder of ['central-n7-payload', 'central-v0', 'pinwheel-c2-2-1100-cw', 'bullseye', 'cube-bullseye', 'central-cube-3tone']) {
    for (const marker of [false, true]) cases.push(oakCase(`O v2 ${finder}${marker ? ' o-cm' : ''}`, 'O', { finder, marker, version: 2 }));
    for (const type of ['A', 'K']) {
      if (finder === 'cube-bullseye' || finder === 'central-cube-3tone') continue;
      for (const marker of [false, true]) cases.push(oakCase(`${type} ${finder}${marker ? ' cm' : ''}`, type, { finder, marker }));
    }
  }
  cases.push(oakCase('O v3 daehan', 'O', { finder: 'oak-daehan-k10', version: 3 }));
  cases.push(oakCase('O 중앙 QR', 'O', { finder: 'central-n7-payload', centerQr: true, version: 2 }));
  cases.push(oakCase('O 중앙 QR o-cm', 'O', { finder: 'central-n7-payload', centerQr: true, marker: true, version: 2 }));
  cases.push(oakCase('A 중앙 QR a-cm', 'A', { finder: 'central-n7-payload', centerQr: true, marker: true }));
  cases.push(oakCase('O v2 n7 mono', 'O', { finder: 'central-n7-payload', version: 2, levels: mono }));
  cases.push(oakCase('K 핀휠 k-cm mono', 'K', { finder: 'pinwheel-c2-2-1100-cw', marker: true, levels: mono }));
  cases.push(oakCase('K 핀휠 k-cm custom0/sat0', 'K', { finder: 'pinwheel-c2-2-1100-cw', marker: true, levels: custom0 }));
  for (const profile of GENERATOR_STATE_SCHEMA.locatorProfileY.options) {
    const enc = encodeY(PAYLOAD, encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY: profile }));
    const palette = SLATE;
    cases.push({
      name: `Y ${profile}`, type: 'Y', enc,
      opts: (emphasis) => ({ palette, qrText: TL_READER_URL, qrCorner: 'TL', centralN7Emphasis: emphasis }),
      build: (o) => buildSceneY(enc, o),
    });
  }
  // 장면 도형 전부(색만이 아니다) — 강조가 색 밖의 속성을 바꾸면 «다른 장면» 이 돼 유도(팔레트만 본다)와 어긋나 빨개진다.
  const sceneJson = (scene) => JSON.stringify(scene.shapes);
  const kinds = { na: 0, detectorOnly: 0, all3: 0 };
  for (const c of cases) {
    const sets = {};
    const scenes = {};
    for (const m of CENTRAL_N7_EMPHASIS_MODES) {
      const o = c.opts(m);
      sets[m] = detectorEmphasisEquivalents(c.type, c.enc, o);
      assert.equal(typeof sets[m], 'string', `${c.name} ${m}: 유도 값이 없다`);
      scenes[m] = sceneJson(c.build(o));
    }
    for (const p of CENTRAL_N7_EMPHASIS_MODES) {
      assert.ok(sets[p].split('+').includes(p), `${c.name}: 넘긴 ${p} 가 자기 집합(${sets[p]})에 없다`);
      for (const q of CENTRAL_N7_EMPHASIS_MODES) {
        const sameScene = scenes[p] === scenes[q];
        assert.equal(sets[p].split('+').includes(q), sameScene,
          `${c.name}: 넘긴 ${p} 의 집합 ${sets[p]} — ${q} 는 ${sameScene ? '같은 장면인데 빠졌다(거짓 잠금)' : '다른 장면인데 들었다(거짓 열림)'}`);
      }
    }
    if (sets.default === NA) kinds.na += 1;
    else if (sets.all === 'locator+all') kinds.detectorOnly += 1;
    else if (sets.all === 'all' && sets.locator === 'locator' && sets.default === 'default') kinds.all3 += 1;
  }
  // 판별력 — 세 구조(해당 없음 · 검출 셀 한 팔 · 중앙 두 팔)가 격자에 다 있다.
  assert.ok(kinds.na > 0 && kinds.detectorOnly > 0 && kinds.all3 > 0, JSON.stringify(kinds));
});
