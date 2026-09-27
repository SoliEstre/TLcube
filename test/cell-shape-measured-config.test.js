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
//      행 없는 버전 × 모든 선택지)에서 seat-config · ecc-level · detector-emphasis · face-gain ⇒ 다른 축이 정확히 하나이고 그 축만
//      측정 값으로 돌리면 열린다(2026-09-28 외부 검토 major — 옛 «첫 번째로 다른 축» 은 두 축 문맥에서 틀린 안내였다) · 두 축 이상 ⇒
//      unmeasured 이고 어느 한 축만 돌려서는 안 열린다 · exposed-gap ⇒ 틈만 흰색으로 바꾸면 열린다 · unmeasured ⇒ 그 어느 한 축만
//      바꿔서는 안 열린다 · 설계 잠금 ⇒ 측정 구성으로 바꿔도 같은 사유다. 측정 구성과 다르면 열림은 없다.
//      (내보내기 축 — 디더 · 크기 — 은 이 합성 격자 밖이다: 렌더 값 exportPlan 이 있을 때만 판정하고, ⓚ 와 decoration-ui 가 잰다.)
//      반사실은 **표 키 고정**(같은 버전)이다 — 제품 자동 버전은 구성을 바꾸면 재인코딩으로 버전이 바뀔 수 있어(짧은 페이로드의
//      G + 사괘 · G ECC M 실측) «되돌리면 열린다» 까지는 이 자가 말하지 않는다(사유 문구 «이 구성으로는 확인 안 됨» 은 그때도 참).
//   ⓗ ECC 반사실의 실현 조건(2026-09-28, DESIGN_002 §4.4) — ecc-level 은 제품 자동 경로가 측정 ECC(H)로 그 페이로드를 **같은 표 키**에
//      인코딩할 때만(보조 필드 measuredStateAtTableKey). 제품 인코더로 길이를 훑어(G · A · K · Y v0tr n25) M 인코딩의 표 키에 행이 있으면
//      «H 가 그 버전에 들어가고 그 길이가 그 버전의 자동 H 밴드 안인가»(그 버전 · 한 단계 아래 버전의 H 용량 — 유도 함수와 다른 길)에
//      따라 ecc-level ↔ unmeasured 인지 잰다. 설계가 이름 붙인 auto-M 길이(G 80 · A 85 · K 120 · Y 114 B)는 unmeasured.
//      ⓒ · ⓕ 는 합성 문맥에서 측정 상태(보조 필드)의 거짓 · 모름을 같이 뒤집는다.
//   ⓘ 측정 상태 — 착지 검토 major 두 건(2026-09-28): (1) 자리 사유의 실현 조건 — A 바깥 «없음» 79–80 B(v2 H)는 코너 마커를 켜면
//      v2 H 에 안 들어가 «자리 탓» 을 따를 수 없다 → unmeasured. 독립 판정(측정 자리로 제품 ECC 사다리 · 자동 버전을 다시 인코딩해
//      연다)으로 «seat-config ⇒ 따르면 같은 표 키에서 열린다» 를 길이 전부에서 잰다. (2) 측정 밴드 — 버전 고정 · Y 로케이터 직접 선택의
//      짧은 페이로드(그 표 키의 자동 H 밴드 밖 — 잰 적 없는 영 패딩)는 구성이 측정과 같아도 잠긴다. 판정은 한 단계 아래 버전의 H 용량.
//   ⓙ 면 게인 — 착지 검토 major(2026-09-28): Y 생산자는 면 게인(큐브 입체감)으로 그리고 하네스는 화면용 게인 하나로 쟀다. 측정 게인
//      선언 = 하네스 규약(자동 · 인쇄용 아님 · 디더 없음)의 게인 · Y 장면은 게인에 따라 달라지고 O/A/K 장면은 안 달라진다(판정 범위의
//      근거) · 다른 게인이면 표 키가 같아도 face-gain 으로 잠긴다.
//   ⓚ 내보내기 축 — 외부 검토 major 셋(2026-09-28): 렌더 값 exportPlan(지금 내보내기 계획)이 디더거나 ppu 가 그 표 키의 잰 하한
//      (MEASURED_FLOORS) 아래면 행이 있어도 잠근다 · 그 축 하나뿐이면 그 사유(export-dither · export-size) · 다른 축과 함께면 unmeasured ·
//      잰 하한 모름은 unmeasured · 표가 하한을 안 실으면 크기는 판정 안 함 · Y 디더 ↔ 면 게인(디더를 끄면 측정 게인이면 한 축) ·
//      보조 필드 모양 검증 · 계획 유도(디더 = 양자화기가 픽셀을 바꾼다 · 잰 하한 키 = 내보내기 호출 모양의 키). 제품 경로(실물 index.html
//      render · exportPlanFor · 트리거 · 미리보기 ↔ 내보내기)는 test/decoration-ui.test.js 가 잰다.
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
  CELL_SHAPE_MEASURED_FACE_GAINS, CELL_SHAPE_SEAT_CONFIG_KEYS, CELL_SHAPE_STRUCTURAL_LOCK_REASONS, CELL_SHAPE_WIRE_CONFIG_KEYS,
  CELL_SHAPE_LOCK_AXES, EXPOSED_CELL_SHAPES, allowRowFloorCtx, cellShapeAllowCtx, cellShapeCtx, cellShapeStructuralLock, cellShapeTypeOf,
  resolveCellShapeSpec,
} from '../src/cell-shape.js';
import { ECC_NAME_BY_VALUE } from '../src/formatinfo.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { encodeY } from '../src/encodeY.js';
import {
  centralBeaconEncoderOptions, centralN7FamilyForType, cellShapeExportPlan, detectorEmphasisEquivalents, encodeOptionsForY,
  measuredStateAtTableKey, producerFaceGains, sceneOptionsForOA,
} from '../src/generator-render-config.js';
import { DEFAULT_RENDER_PROFILE, RENDER_PROFILE_IDS, faceGainsForRenderProfile } from '../src/render-profile.js';
import { minRoundtripPpuKey, resolveRenderProfile } from '../src/export-options.js';
import { DITHER_BIT_DEPTHS, quantizeDitherRaster } from '../src/dither.js';
import { DEFAULT_FACE_GAINS } from '../src/sceneY.js';
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
// 12 B — 버전을 V2 로 **고정**한 문맥에만 쓴다(O 자동 H 는 12 B 에서 V1 — 측정 밴드 밖). 렌더 값에 출처(source)를 안 줘 측정 상태
// (measuredStateAtTableKey)를 판정하지 않는 자(강조 · 값 모름)만 쓴다 — 측정 상태를 싣는 자는 P16.
const P12 = 'https://tl.e';
// 16 B — O · G V2 · A · K V0 의 자동 H 밴드 안(O V2 15–31 · G V2 13–29 · A 코너 마커 V0 ≤ 21 · K 코너 마커 V0 ≤ 29 B)이고 O 사괘도
// 자동 V2 에 머문다(O 사괘 V2 H ≤ 18 B). 측정 상태를 싣는 ⓐ 자리 · ECC 자의 길이다(2026-09-28 — 12 B 고정 V2 는 측정 밴드 밖).
const P16 = 'https://tl.estre';
const N7 = centralBeaconEncoderOptions('central-n7-payload', false);
const FRESH = createGeneratorState({ qrPosition: 'TL' });
const ECC_NAMES = Object.freeze(Object.values(ECC_NAME_BY_VALUE));
const Y_TL = { mode: 'corner', corner: 'TL' };
const yEnc = (eccLevel, locatorProfileY = 'cell-surface-v0') => encodeY(PAYLOAD, { ...encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY }), eccLevel });
const NA = CELL_SHAPE_DETECTOR_EMPHASIS_NOT_APPLICABLE;

/** 제품 기본 면 게인 — 입체감 자동 · 화면용 갈래 · 디더 자동(index.html resolvedRenderProfile 과 같은 호출) · 슬라이더 100. */
const PRODUCT_DEFAULT_FACE_GAINS = faceGainsForRenderProfile(resolveRenderProfile(FRESH.renderProfile, { printPurpose: false, ditherBits: null }));
/** 생산자 팔레트 모양(index.html paletteOf — 배경 · 레벨 · 파인더 축 · 면 게인 = 제품 기본). */
const paletteOf = (levels, faceGains = PRODUCT_DEFAULT_FACE_GAINS) => ({
  background: { r: 255, g: 255, b: 255 }, levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT, faceGains,
});
const SLATE = paletteOf(getPreset('slate').levels);

/** 생산자 옵션에 강조를 **안 싣는다**(라이브러리 기본으로 그린다 — Y 일반 화면 · Y 측정 조립). */
const NOT_PASSED = Symbol('강조 안 넘김');
/** 그 생성기 타입의 측정 구성 강조(선언이 없으면 안 넘김). */
const measuredEmphasis = (type) => (CELL_SHAPE_MEASURED_CONFIG[type] ? CELL_SHAPE_MEASURED_CONFIG[type].detectorEmphasis : NOT_PASSED);
/**
 * 제품 렌더 값 — 안전영역 판 색 + 실효 검출 강조 + 면 게인(+ 측정 상태). 강조 · 면 게인은 **제품 유도 함수**(detectorEmphasisEquivalents ·
 * producerFaceGains)로 만든다 — 생산자 옵션은 팔레트(제품 기본 게인) · 그린 파인더(상태 선택 — 이 자의 문맥은 중앙 QR · daehan 이
 * 아니다) · 넘긴 강조(기본 = 그 타입의 측정 구성 값). `source`({fn, text, opts} — 그 인코딩을 만든 인코더 · 페이로드 · eccLevel 뺀
 * 옵션)를 주면 측정 상태(render.measuredStateAtTableKey — 와이어 축 사유의 실현 조건 · 측정 밴드)도 **제품 유도 함수**
 * (generator-render-config `measuredStateAtTableKey`)로 싣는다(2026-09-28 — DESIGN_002 §4.4 + 착지 검토). 안 주면 싣지 않는다 —
 * 그 문맥은 자리 · ECC 가 측정과 달라도 그 축 사유를 안 받고(unmeasured) 측정 밴드를 판정하지 않는다.
 */
function renderOf(type, enc, state, quietColor = 'white', emphasis = measuredEmphasis(type), source = null) {
  const sceneOpts = { palette: SLATE, finderPatternId: state.finderPatternId };
  if (emphasis !== NOT_PASSED) sceneOpts.centralN7Emphasis = emphasis;
  const render = {
    quietColor, detectorEmphasis: detectorEmphasisEquivalents(type, enc, sceneOpts), faceGains: producerFaceGains(type, sceneOpts),
  };
  if (source) {
    render.measuredStateAtTableKey = measuredStateAtTableKey({
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

/** 인코더 · 페이로드 · eccLevel 뺀 옵션으로 인코딩하고 측정 상태까지 실은 문맥(제품 렌더와 같은 입력). */
function sourcedCtx(type, fn, text, opts, eccLevel, state, quietColor = 'white', emphasis = measuredEmphasis(type)) {
  const { enc, source } = encodeWith(fn, text, opts, eccLevel);
  return ctxOf(type, enc, state, quietColor, emphasis, source);
}

test('ⓐ A · K: 자동 바깥 자리(코너 마커)는 생성 표 행으로 열리고, 바깥 «없음» 은 표 키가 같아도 seat-config 로 잠긴다', () => {
  const A = { ...FRESH, type: 'A' };
  const aMeasured = sourcedCtx('A', encodeA, PAYLOAD, { ...N7, cornerMarker: true }, 'H', { ...A, outerSeat: 'a-cm' });
  const aNone = sourcedCtx('A', encodeA, PAYLOAD, { ...N7 }, 'H', A);
  assert.equal(aMeasured.cornerMarker, true);
  assert.equal(aNone.cornerMarker, false);
  // 자리 사유의 실현 조건 — 19 B 는 코너 마커를 켜도 자동 H 가 같은 버전(v0)이다(측정 상태가 이 표 키에 있다).
  assert.equal(aNone.measuredStateAtTableKey, true, 'A 바깥 없음 19 B: 측정 자리로도 같은 표 키 — 실현 조건 전제');
  assertMeasuredOpensOtherLocks('A 바깥 없음', aMeasured, aNone, R.SEAT_CONFIG);

  const K = { ...FRESH, type: 'K' };
  const kMeasured = sourcedCtx('K', encodeK, PAYLOAD, { ...N7, cornerMarker: true }, 'H', { ...K, outerSeat: 'k-cm' });
  const kNone = sourcedCtx('K', encodeK, PAYLOAD, { ...N7 }, 'H', K);
  assert.equal(kNone.measuredStateAtTableKey, true);
  assertMeasuredOpensOtherLocks('K 바깥 없음', kMeasured, kNone, R.SEAT_CONFIG);
});

test('ⓐ O: 안쪽 없음(O)은 열리고, 안쪽 o-cm(G — 자동 코너 마커)은 G 자기 행으로 열리며(표 행 ⇔ 열림), 사괘는 같은 버전에서 seat-config 로 잠긴다', () => {
  const O = { ...FRESH, type: 'O' };
  // 16 B — O 자동 H 는 V2(밴드 15–31)이고 사괘도 자동 V2(V2 사괘 H ≤ 18 B)라 버전을 고정하지 않아도 같은 표 키다.
  const oMeasured = sourcedCtx('O', encode, P16, { ...N7 }, 'H', O);
  const oSagoae = sourcedCtx('O', encode, P16, { ...N7, sagoae: true }, 'H', { ...O, deepSeat: 'sagoae' });
  assert.equal(oSagoae.sagoae, true);
  assert.equal(oSagoae.version, 2, 'O 사괘 16 B 가 자동 V2 가 아니다 — 길이를 다시 볼 것');
  assert.equal(oSagoae.measuredStateAtTableKey, true);
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

test('ⓐ ECC: 같은 버전에서 측정(H)이 아닌 레벨은 ecc-level 로 잠긴다 — O · G · A · K · Y (자동 H 밴드 안의 16 · 19 B — 실현 조건 참)', () => {
  const O = { ...FRESH, type: 'O' };
  // 제품 기본 O(자동 안쪽 o-cm → 실효 타입 G) — 인코딩은 제품 매퍼 모양(코너 마커 + 마커 톤). 강조는 G 측정 구성 값.
  const G = { ...FRESH, type: 'O', innerSeat: 'o-cm' };
  const A = { ...FRESH, type: 'A', outerSeat: 'a-cm' };
  const K = { ...FRESH, type: 'K', outerSeat: 'k-cm' };
  const Y = { ...FRESH, type: 'Y', bgMode: 'white' };
  // [이름, 생성기 타입, 인코더, 옵션(eccLevel 제외 — 렌더와 같은 모양), 상태, 페이로드]. 실현 조건은 이 인코더로 제품 유도 함수가 싣는다.
  // 버전 고정은 M · L 이 더 작은 버전으로 내려가지 않게(같은 표 키) — 16 B 는 그 버전의 자동 H 밴드 안이라 측정 상태가 이 키에 있다.
  const cases = [
    ['O v2', 'O', encode, { ...N7, version: 2 }, O, P16],
    ['G v2 o-cm', 'O', encode, { ...N7, cornerMarker: true, markerTones: true, version: 2 }, G, P16],
    ['A v0', 'A', encodeA, { ...N7, cornerMarker: true, version: 0 }, A, P16],
    ['K v0', 'K', encodeK, { ...N7, cornerMarker: true, version: 0 }, K, P16],
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
      // 실현 조건의 전제 — 제품 자동 경로가 측정 ECC(H)로 같은 표 키에 닿는다(제품 인코더로 유도한 값). 측정 문맥도 측정 상태다.
      assert.equal(oCtx.measuredStateAtTableKey, true, `${name} ECC ${ecc}: 같은 표 키에 측정 상태가 없다`);
      assert.equal(hCtx.measuredStateAtTableKey, true, `${name} H: 측정 밴드 밖이다 — 길이를 다시 볼 것`);
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
  // 측정 상태는 제품 유도(측정 자리 — K 는 사괘 개념 없음 — 로 다시 인코딩)로 싣는다: 자리 사유의 실현 조건.
  const kWith = ctxOf('K', { ...k, sagoae: true }, { ...FRESH, type: 'K' }, 'white', measuredEmphasis('K'),
    { fn: encodeK, text: PAYLOAD, opts: { cornerMarker: true } });
  assert.equal(kWith.sagoae, true);
  assert.equal(kWith.measuredStateAtTableKey, true, 'K 측정 자리 재인코딩이 같은 표 키 — 실현 조건 전제');
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
  let gainFlips = 0;
  for (const row of cellRows) {
    const t = row.table === 'y' ? 'Y' : row.type;
    const config = CELL_SHAPE_MEASURED_CONFIG[t];
    // 측정 상태(보조 필드) — 기본은 «이 표 키에 측정 상태가 있다»(이 합성 문맥이 구성 키 하나만 뒤집는 반사실).
    const ctx = { table: row.table, type: t, measuredStateAtTableKey: true };
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
        // 측정 상태 거짓(측정 밴드 밖 · 실현 불가)은 어느 축이든 unmeasured. 모름(필드 없음)은 와이어 축(자리 · ECC)만 unmeasured —
        // 렌더 축(강조)은 인코딩이 안 바뀌어 모름이면 그 축 사유 그대로다(측정 하네스 경로).
        const { measuredStateAtTableKey: _s, ...unknown } = ctx;
        assert.deepEqual(resolveRow(row, { ...ctx, [key]: v, measuredStateAtTableKey: false }), { spec: null, lockReason: R.UNMEASURED },
          `${key}=${v} 측정 상태 거짓: ${at}`);
        const wire = CELL_SHAPE_WIRE_CONFIG_KEYS.includes(key);
        assert.deepEqual(resolveRow(row, { ...unknown, [key]: v }), { spec: null, lockReason: wire ? R.UNMEASURED : want },
          `${key}=${v} 측정 상태 모름: ${at}`);
        unrealizable += 1;
      }
    }
    // 구성이 측정과 같아도 측정 상태가 거짓(측정 밴드 밖 — 버전 고정 · Y 로케이터 직접 선택의 짧은 페이로드)이면 잠근다 · 모름은 연다.
    assert.deepEqual(resolveRow(row, { ...ctx, measuredStateAtTableKey: false }), { spec: null, lockReason: R.UNMEASURED }, `밴드 밖: ${at}`);
    const { measuredStateAtTableKey: _m, ...stateUnknown } = ctx;
    assert.deepEqual(resolveRow(row, stateUnknown), open, `측정 상태 모름(하네스 경로)인데 안 열린다: ${at}`);
    // 면 게인(Y) — 측정 게인이면 열리고, 다른 프로파일 게인은 face-gain · 측정 상태 거짓이면 unmeasured.
    const measuredGains = CELL_SHAPE_MEASURED_FACE_GAINS[t];
    if (measuredGains) {
      assert.deepEqual(resolveRow(row, { ...ctx, faceGains: { ...measuredGains } }), open, `측정 게인: ${at}`);
      for (const p of RENDER_PROFILE_IDS) {
        const g = faceGainsForRenderProfile(p);
        if (['T', 'L', 'R'].every((k) => g[k] === measuredGains[k])) continue;
        assert.deepEqual(resolveRow(row, { ...ctx, faceGains: g }), { spec: null, lockReason: R.FACE_GAIN }, `게인 ${p}: ${at}`);
        assert.deepEqual(resolveRow(row, { ...ctx, faceGains: g, measuredStateAtTableKey: false }), { spec: null, lockReason: R.UNMEASURED });
        gainFlips += 1;
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
  assert.ok(unrealizable >= cellRows.length * 2, `측정 상태 거짓 · 모름 ${unrealizable}`);
  assert.ok(gainFlips >= cellRows.filter((r) => r.table === 'y').length, `면 게인 뒤집기 ${gainFlips}`);
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

test('ⓕ 사유는 참이다(표 키 고정 반사실) — 자리 · ECC · 강조 · 면 게인 탓은 다른 축이 정확히 하나이고 그 축만 돌리면 열릴 때만(와이어 축은 측정 상태 참 · 둘 이상이면 unmeasured), 틈 탓은 틈만 바꾸면 열릴 때만, 설계 잠금이 먼저다', () => {
  // 반사실은 표 키(버전 포함)를 고정한다 — 제품 자동 버전의 재인코딩(구성을 바꾸면 버전이 바뀐다)은 이 격자 밖이다(머리말 ⓕ).
  const cellRows = ALLOW.ROWS.filter((r) => r.table === 'oak' || r.table === 'y');
  const yLock = { qrPosition: FRESH.qrPosition, qrWindow: false, qrSlot: false };
  const absent = {
    oak: { version: Math.max(...cellRows.filter((r) => r.table === 'oak').map((r) => r.version)) + 1 },
    y: { nBand: String(Math.max(...cellRows.filter((r) => r.table === 'y').map((r) => Number(r.nBand))) + 8) },
  };
  // 표 키 문맥(중복 제거) — 행의 모양 · 강도는 떼고 문맥만. 측정 상태(보조 필드)는 기본 «이 표 키에 있다»(참). 모든 변형에서
  // 측정 상태 참 · 거짓 · 모름(필드 없음)을 더 잰다(2026-09-28 — DESIGN_002 §4.4 + 착지 검토).
  const bases = new Map();
  for (const row of cellRows) {
    const t = row.table === 'y' ? 'Y' : row.type;
    const ctx = { table: row.table, type: t };
    for (const k of CELL_SHAPE_ALLOW_KEYS[row.table]) ctx[k] = row[k];
    if (row.table === 'y') Object.assign(ctx, yLock);
    bases.set(JSON.stringify(ctx), ctx);
  }
  const choices = cellChoices();
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const opens = (st, ctx) => resolveCellShapeSpec(st, ctx).spec !== null;
  const GAIN_KEYS = ['T', 'L', 'R'];
  for (const base of bases.values()) {
    const config = CELL_SHAPE_MEASURED_CONFIG[base.type];
    const measuredGains = CELL_SHAPE_MEASURED_FACE_GAINS[base.type];
    // 이 자의 축 순서(자리 → ECC → 강조 → 면 게인). 면 게인은 측정 게인 선언이 있는 타입(Y)에만.
    const axes = [...AXIS_ORDER, ...(measuredGains ? [[R.FACE_GAIN, ['faceGains']]] : [])];
    const same = (k, v) => (k === 'faceGains'
      ? v === undefined || GAIN_KEYS.every((g) => v[g] === measuredGains[g])
      : sameAsMeasured(k, v, config[k]));
    // 측정 구성 변형: 그대로 · 키 하나씩 다른 값 전부 · 같은 그림 집합(측정 강조 포함 — 측정 구성과 «같다») · 두 축 동시 · 면 게인.
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
    if (measuredGains) {
      const soft = faceGainsForRenderProfile('soft');
      variants.push({ faceGains: { ...measuredGains } }, { faceGains: soft }, { faceGains: soft, eccLevel: eccOther }, { faceGains: soft, detectorEmphasis: emphOther });
    }
    for (const v of variants) for (const state of [true, false, 'unknown']) for (const gap of [null, { gapGrade: 'unknown', bgMode: 'transparent' }]) for (const move of [null, absent[base.table]]) {
      const draft = { ...base, ...config, ...v, ...(gap || {}), ...(move || {}) };
      if (state !== 'unknown') draft.measuredStateAtTableKey = state;
      const ctx = Object.freeze(draft);
      // 측정 구성으로 바꾼 반사실 — 같은 표 키 · 측정 상태는 그대로(측정 상태 거짓이면 반사실도 측정 밖이다).
      const measured = Object.freeze({ ...ctx, ...config, ...(measuredGains ? { faceGains: { ...measuredGains } } : {}) });
      const mismatch = Object.entries(v).some(([k, val]) => !same(k, val));
      // 다른 축 전부 — 이 자의 비교로 판정한다(2026-09-28 외부 검토 major: 사유는 «정확히 하나» 일 때만 그 축, 둘 이상이면 unmeasured).
      const diffAxes = axes.filter(([, keys]) => keys.some((k) => (k === 'faceGains' ? !same(k, ctx[k]) : k in config && !same(k, ctx[k]))));
      const onlyAxis = diffAxes.length === 1 ? diffAxes[0] : null;
      const wireOnly = onlyAxis && (onlyAxis[0] === R.SEAT_CONFIG || onlyAxis[0] === R.ECC_LEVEL);
      /** 그 축 하나만 측정 값으로 돌린 반사실(나머지 축 · 측정 상태는 그대로). */
      const restoreOne = ([, keys]) => Object.freeze({
        ...ctx, ...Object.fromEntries(keys.map((k) => [k, k === 'faceGains' ? { ...measuredGains } : config[k]])),
      });
      for (const c of choices) {
        const st = Object.freeze(c);
        const res = resolveCellShapeSpec(st, ctx);
        const where = `${JSON.stringify(ctx)} ${JSON.stringify(c)} → ${res.lockReason ?? 'open'}`;
        if (res.spec) {
          assert.equal(mismatch, false, '측정 구성과 다른데 열렸다: ' + where);
          assert.notEqual(state, false, '측정 상태 거짓(측정 밴드 밖)인데 열렸다: ' + where);
          bump(Object.keys(v).length > 0 ? 'open:equivalent' : 'open');
          continue;
        }
        const reason = res.lockReason;
        bump((mismatch ? 'mismatch:' : 'measured:') + reason);
        if ([R.SEAT_CONFIG, R.ECC_LEVEL, R.DETECTOR_EMPHASIS, R.FACE_GAIN].includes(reason)) {
          assert.ok(opens(st, measured), '축 탓인데 측정 구성으로 바꿔도 안 열린다: ' + where);
          assert.ok(onlyAxis, `축 탓인데 다른 축이 정확히 하나가 아니다(${diffAxes.map(([r]) => r).join(',') || '없음'}): ` + where);
          assert.equal(reason, onlyAxis[0], '사유가 가리키는 축이 다른 그 축이 아니다: ' + where);
          // 따르면 열린다 — 그 축 하나만 돌린 반사실이 연다(나머지 문맥 그대로).
          assert.ok(opens(st, restoreOne(onlyAxis)), '축 탓인데 그 축만 돌려서는 안 열린다(틀린 안내): ' + where);
          assert.notEqual(state, false, '측정 상태 거짓인데 축 탓(따를 수 없는 안내): ' + where);
          if (wireOnly) assert.equal(state, true, '와이어 축 탓인데 측정 상태가 참이 아니다(실현 불가 · 모름): ' + where);
        } else if (reason === R.EXPOSED_GAP) {
          assert.equal(mismatch, false, '측정 구성까지 다른데 틈 탓: ' + where);
          assert.notEqual(state, false, '측정 밴드 밖인데 틈 탓: ' + where);
          assert.ok(EXPOSED_CELL_SHAPES.includes(c.cellShape));
          const whiteOpens = ['white', 'transparent', 'black'].some((bg) => opens(st, { ...ctx, gapGrade: 'white', bgMode: bg }));
          assert.ok(whiteOpens, '틈 탓인데 틈만 흰색으로 바꿔도 안 열린다: ' + where);
        } else if (reason === R.UNMEASURED) {
          // 측정 구성으로 바꾸면 열리는데 미확인인 것은 **다른 축이 둘 이상**(어느 한 축만 따라서는 안 열린다)이거나 **와이어 축 하나이고
          // 측정 상태가 참이 아닐 때**뿐이다(따를 수 없는 안내).
          if (opens(st, measured)) {
            if (diffAxes.length >= 2) {
              for (const axis of diffAxes) {
                assert.equal(opens(st, restoreOne(axis)), false, `다른 축이 둘 이상인데 ${axis[0]} 만 돌려도 열린다: ` + where);
              }
              bump('multi-axis:unmeasured');
            } else {
              assert.ok(wireOnly && state !== true, '측정 구성으로 바꾸면 열리는데 미확인이라 한다(축 탓이어야): ' + where);
              bump('wire-state-unknown:unmeasured');
            }
          }
          if (state === false) {
            // 측정 상태 거짓이 축 사유를 거뒀다(같은 문맥 · 측정 상태 참이면 축 사유) — 판별력 갈래.
            const withState = resolveCellShapeSpec(st, { ...ctx, measuredStateAtTableKey: true });
            if (mismatch && [R.SEAT_CONFIG, R.ECC_LEVEL, R.DETECTOR_EMPHASIS, R.FACE_GAIN].includes(withState.lockReason)) bump('state-false:axis-withdrawn');
            if (!mismatch && withState.spec) bump('out-of-band:unmeasured');
          }
          // 틈 탓(exposed-gap)은 노출형(gap · dot)만의 말이다 — 비노출형은 틈이 «드러나지» 않으니 틈 등급 행 차이도 미확인이다(1300dc8 규칙).
          if (EXPOSED_CELL_SHAPES.includes(c.cellShape) && state !== false) {
            const whiteOpens = ['white', 'transparent', 'black'].some((bg) => opens(st, { ...ctx, gapGrade: 'white', bgMode: bg }));
            assert.ok(!whiteOpens, '틈만 바꾸면 열리는데 미확인이라 한다(틈 탓이어야): ' + where);
          }
        } else {
          // 설계 잠금(영구) — 측정 구성으로 바꿔도 · 측정 상태와 무관하게 같은 사유로 잠긴다.
          assert.ok(CELL_SHAPE_STRUCTURAL_LOCK_REASONS.includes(reason), '모르는 사유: ' + where);
          assert.deepEqual(resolveCellShapeSpec(st, measured), { spec: null, lockReason: reason }, '설계 잠금이 측정 구성에서 풀린다: ' + where);
        }
      }
    }
  }
  // 판별력 — 각 갈래가 격자에서 실제로 난다(측정 밖 문맥에서 unmeasured · 설계 잠금이 축 사유에 가려지지 않았다 ·
  // 같은 그림 집합이 실제로 열었다 · 측정 상태 거짓 · 모름이 와이어 축 사유를 실제로 거뒀다 · 밴드 밖이 실제로 잠갔다).
  for (const k of ['open', 'open:equivalent', 'mismatch:seat-config', 'mismatch:ecc-level', 'mismatch:detector-emphasis',
    'mismatch:face-gain', 'mismatch:unmeasured', 'mismatch:bevel-raised', 'mismatch:bullseye-dot', 'measured:exposed-gap',
    'measured:unmeasured', 'state-false:axis-withdrawn', 'wire-state-unknown:unmeasured', 'out-of-band:unmeasured',
    'multi-axis:unmeasured']) {
    assert.ok(counts[k] > 0, `갈래 ${k} 가 격자에서 안 났다 — ${JSON.stringify(counts)}`);
  }
});

// ── ⓗ ECC 반사실의 실현 조건(제품 인코더) ────────────────────────────────────

/** 길이 L 바이트 본문(20 B 이상은 제품 기본 URL 접두어). */
const lenText = (L) => (L >= 20 ? 'https://tl.estre.so/' + 'x'.repeat(L - 20) : 'x'.repeat(L));
/** 그 인코더 · 옵션의 버전별 H 용량(유도 함수와 다른 길 — 인코딩 결과의 capacity). 버전이 없으면 -1. */
function hCapacityOf(fn, opts) {
  const memo = new Map();
  return (version) => {
    if (!memo.has(version)) {
      let cap = -1;
      try { cap = fn('x', { ...opts, version, eccLevel: 'H' }).capacity.maxPayloadBytes; } catch { cap = -1; }
      memo.set(version, cap);
    }
    return memo.get(version);
  };
}

test('ⓗ ECC 실현 조건 — 같은 표 키(버전 · n · 레이아웃)에서 측정 ECC(H)로 그 페이로드가 안 들어가거나 그 버전의 자동 H 밴드 밖이면 unmeasured, 아니면 ecc-level (제품 인코더 · 길이 훑기 · auto-M 길이 G 80 · A 85 · K 120 · Y 114 B)', (t) => {
  // 왜(DESIGN_002 §4.4): 제품 auto 는 H 가 안 들어가는 길이에서 M 을 고르고, 그 버전의 표 키가 H 행과 같으면 hit 가 난다. 그 버전에
  // H 로는 안 들어가므로 «ECC 를 H 로» 는 따를 수 없는 안내다 — 사유는 unmeasured(g1162)여야 한다. 반대로 같은 버전에서 H 로도
  // 들어가고 그 길이가 그 버전의 자동 H 밴드(한 단계 아래 버전 H 용량 초과)인 수동 M 은 «ECC 탓»(g1210)이 참이다. 제품 경로
  // (index.html auto 사다리 · 카드 사유 문구)는 decoration-ui 가 잰다.
  // 판정 자는 유도 함수(재인코딩 · 자동 경로)와 **다른 길**로 잰다: 그 버전 · 한 단계 아래 버전 H 인코딩의 용량과 길이 비교.
  const Y = { ...FRESH, type: 'Y', bgMode: 'white', locatorProfileY: 'cell-surface-v0tr' };
  // [이름, 생성기 타입, 인코더, eccLevel 뺀 옵션(제품 매퍼 모양), 상태, 실효 타입, 설계가 이름 붙인 auto-M 길이, 훑을 최대 길이]
  const TYPES = [
    ['G(O 자동 o-cm)', 'O', encode, { ...N7, cornerMarker: true, markerTones: true }, { ...FRESH, type: 'O', innerSeat: 'o-cm' }, 'G', 80, 100],
    ['A(a-cm)', 'A', encodeA, { ...N7, cornerMarker: true }, { ...FRESH, type: 'A', outerSeat: 'a-cm' }, 'A', 85, 100],
    ['K(k-cm)', 'K', encodeK, { ...N7, cornerMarker: true }, { ...FRESH, type: 'K', outerSeat: 'k-cm' }, 'K', 120, 135],
    // Y 는 n25 v0tr 고정(버전 2) — 58 B 이하는 그 표 키의 자동 H 밴드 밖이라(자동이면 n13 · n21) H 가 들어가도 unmeasured 다.
    ['Y(v0tr n25)', 'Y', encodeY, encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY: 'cell-surface-v0tr', versionY: 2 }), Y, 'Y', 114, 120],
  ];
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  for (const [name, type, fn, opts, state, eff, namedLen, maxLen] of TYPES) {
    const quiet = type === 'Y' ? 'none' : 'white';
    const hMaxAt = hCapacityOf(fn, opts);
    const judge = (L, label) => {
      const text = lenText(L);
      let mEnc;
      try { mEnc = fn(text, { ...opts, eccLevel: 'M' }); } catch { return null; }
      const ctx = ctxOf(type, mEnc, state, quiet, measuredEmphasis(eff), { fn, text, opts });
      assert.equal(ctx.type, eff, `${name} ${L} B: 실효 타입`);
      const hFits = L <= hMaxAt(mEnc.version);
      const inBand = L > hMaxAt(mEnc.version - 1);
      const expect = hFits && inBand;
      assert.equal(ctx.measuredStateAtTableKey, expect,
        `${name} ${L} B(${label}): 유도 함수의 측정 상태(${ctx.measuredStateAtTableKey}) ≠ H 용량 판정(그 버전 ${hMaxAt(mEnc.version)} · 아래 ${hMaxAt(mEnc.version - 1)} B)`);
      const rows = rowsFor(ctx);
      for (const row of rows) {
        const res = resolveRow(row, ctx);
        assert.deepEqual(res, { spec: null, lockReason: expect ? R.ECC_LEVEL : R.UNMEASURED },
          `${name} ${L} B(${label}) M v${mEnc.version}${type === 'Y' ? ' n' + mEnc.n : ''} ${row.cellShape}(${row.param}) — H ${hFits ? '들어감' : '안 들어감'} · 밴드 ${inBand ? '안' : '밖'}`);
        // 측정 구성(H · 같은 표 키 · 측정 상태)이면 이 행이 열린다 — 실현 가능할 때만 «ECC 탓» 이 참이라는 대조군.
        if (expect) assert.deepEqual(resolveRow(row, { ...ctx, eccLevel: 'H' }), { spec: { kind: row.cellShape, param: row.param } });
      }
      if (rows.length > 0) bump(`${name}:${expect ? 'ecc-level' : hFits ? 'unmeasured:band' : 'unmeasured:capacity'}`);
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
  // 판별력: 표 행이 있는 키에서 갈래(실현 가능 → ecc-level · 용량 불가 → unmeasured · 밴드 밖 → unmeasured)가 실제로 났다 — A 와 Y 는
  // 앞 둘(설계 §4.4 의 auto-M 버전 A v2 · Y n25 에 행이 있다), Y 는 밴드 밖도(n25 고정의 짧은 길이). G v4 · K v1 · v2 는 지금 표에 행이
  // 없어 unmeasured 가 행 없음에서 온다(판별력 없음).
  for (const k of ['A(a-cm):ecc-level', 'A(a-cm):unmeasured:capacity', 'Y(v0tr n25):ecc-level', 'Y(v0tr n25):unmeasured:capacity',
    'Y(v0tr n25):unmeasured:band']) {
    assert.ok(counts[k] > 0, `갈래 ${k} 가 안 났다 — ${JSON.stringify(counts)}`);
  }
});

// ── ⓘ 측정 상태 — 자리 사유의 실현 조건 · 측정 밴드(착지 검토 major 두 건) ───────────────

/** 제품 auto ECC 사다리(index.html encodeWithEcc 'auto' 와 같은 순서 — generator-auto-y AUTO_ECC_LADDER). */
function autoLadder(fn, text, opts) {
  let last;
  for (const ecc of ['H', 'M', 'L']) {
    try { return fn(text, { ...opts, eccLevel: ecc }); } catch (err) { last = err; }
  }
  throw last;
}

test('ⓘ 자리 사유의 실현 조건 — seat-config 는 «측정 자리로 제품 auto 를 다시 돌리면 같은 표 키에서 열린다» 일 때만(독립 판정 · 길이 훑기) · A 바깥 없음 79–80 B 는 unmeasured', (t) => {
  // 독립 판정: 측정 자리 옵션으로 제품 auto ECC 사다리 · 자동 버전을 **다시 인코딩**하고, 그 문맥(같은 제품 유도)으로 resolver 가 여는지 본다
  // (유도 함수는 측정 ECC 고정 한 번 — 다른 길). P1: seat-config ⇒ 따르면 같은 표 키에서 열린다. P2: 따르면 같은 표 키에서 열리는데
  // unmeasured(과보수)는 없다. 따르면 **다른 표 키**에서 열리는 경우는 표 키 고정 반사실(머리말 ④)이라 unmeasured 다 — 세기만 한다.
  const KINDS = cellChoices().filter((c) => c.cellShape !== 'bevel' || c.cellBevel <= 1);
  // [이름, 생성기 타입, 인코더, 자리 옵션(현재), 측정 자리 옵션, 현재 상태, 측정 자리 상태, 최대 길이]
  const CASES = [
    ['A 바깥 없음', 'A', encodeA, { ...N7 }, { ...N7, cornerMarker: true }, { ...FRESH, type: 'A', outerSeat: 'none' }, { ...FRESH, type: 'A', outerSeat: 'a-cm' }, 120],
    ['K 바깥 없음', 'K', encodeK, { ...N7 }, { ...N7, cornerMarker: true }, { ...FRESH, type: 'K', outerSeat: 'none' }, { ...FRESH, type: 'K', outerSeat: 'k-cm' }, 160],
    ['O 사괘', 'O', encode, { ...N7, sagoae: true }, { ...N7 }, { ...FRESH, type: 'O', deepSeat: 'sagoae' }, { ...FRESH, type: 'O' }, 60],
    ['G 사괘', 'O', encode, { ...N7, cornerMarker: true, markerTones: true, sagoae: true }, { ...N7, cornerMarker: true, markerTones: true },
      { ...FRESH, type: 'O', innerSeat: 'o-cm', deepSeat: 'sagoae' }, { ...FRESH, type: 'O', innerSeat: 'o-cm' }, 60],
  ];
  const tally = {};
  for (const [name, type, fn, opts, mOpts, state, mState, maxL] of CASES) {
    const s = { seat: 0, otherKeyOpens: 0 };
    for (let L = 1; L <= maxL; L += 1) {
      const text = lenText(L);
      let enc;
      try { enc = autoLadder(fn, text, opts); } catch { continue; }
      const ctx = ctxOf(type, enc, state, 'white', measuredEmphasis(cellShapeTypeOf(type, enc, state)), { fn, text, opts });
      let fCtx = null;
      try {
        const fEnc = autoLadder(fn, text, mOpts);
        fCtx = ctxOf(type, fEnc, mState, 'white', measuredEmphasis(cellShapeTypeOf(type, fEnc, mState)), { fn, text, opts: mOpts });
      } catch { fCtx = null; }
      const sameKey = fCtx !== null && JSON.stringify(cellShapeAllowCtx(fCtx)) === JSON.stringify(cellShapeAllowCtx(ctx));
      for (const c of KINDS) {
        const r = resolveCellShapeSpec(c, ctx);
        const f = fCtx ? resolveCellShapeSpec(c, fCtx) : { spec: null };
        const at = `${name} ${L} B v${enc.version}${enc.eccLevel} ${JSON.stringify(c)} → ${r.lockReason ?? 'open'} · 따르면 ${f.spec ? '열림' : f.lockReason}${sameKey ? '' : '(다른 표 키)'}`;
        if (r.lockReason === R.SEAT_CONFIG) {
          s.seat += 1;
          assert.ok(sameKey && f.spec, `P1 — 자리 탓인데 따라도 같은 표 키에서 안 열린다: ${at}`);
        } else if (r.lockReason === R.UNMEASURED && f.spec) {
          assert.ok(!sameKey, `P2 — 따르면 같은 표 키에서 열리는데 미확인이라 한다(자리 탓이어야): ${at}`);
          s.otherKeyOpens += 1;
        }
      }
    }
    tally[name] = s;
  }
  t.diagnostic(`자리 사유 대조 ${JSON.stringify(tally)}`);
  // 판별력 — 자리 사유가 실제로 났다(A · K · O · G), 그리고 착지 검토가 짚은 A 바깥 없음 79–80 B(v2 H — 코너 마커면 v2 H 에 안 들어감)는
  // 표 행이 있는 키인데 unmeasured 다.
  for (const name of ['A 바깥 없음', 'K 바깥 없음', 'O 사괘', 'G 사괘']) assert.ok(tally[name].seat > 0, `${name}: 자리 사유가 안 났다`);
  for (const L of [79, 80]) {
    const text = lenText(L);
    const opts = { ...N7 };
    const enc = autoLadder(encodeA, text, opts);
    assert.deepEqual([enc.version, enc.eccLevel], [2, 'H'], `A 바깥 없음 ${L} B: v2 H 가 아니다 — 전제를 다시 볼 것`);
    assert.throws(() => encodeA(text, { ...N7, cornerMarker: true, version: 2, eccLevel: 'H' }), RangeError, `${L} B: 코너 마커 v2 H 에 들어간다`);
    const ctx = ctxOf('A', enc, { ...FRESH, type: 'A', outerSeat: 'none' }, 'white', 'all', { fn: encodeA, text, opts });
    assert.equal(ctx.measuredStateAtTableKey, false);
    const rows = rowsFor(ctx);
    assert.ok(rows.length > 0, `A 바깥 없음 ${L} B: 표 행이 없다 — 판별력 없음`);
    for (const row of rows) assert.deepEqual(resolveRow(row, ctx), { spec: null, lockReason: R.UNMEASURED }, `A 바깥 없음 ${L} B ${row.cellShape}`);
  }
});

test('ⓘ 측정 밴드 — 버전 고정(G · A · K · O)과 Y 로케이터 직접 선택: 그 표 키의 자동 H 밴드(한 단계 아래 버전 H 용량 초과) 안이면 열리고, 더 짧은 페이로드(잰 적 없는 영 패딩)는 구성이 측정과 같아도 unmeasured', (t) => {
  // 판정 자(유도 함수와 다른 길): 밴드 안 ⟺ L > 한 단계 아래 버전의 H 용량(같은 인코더 · 옵션). 유도 함수는 버전 고정을 빼고 자동으로
  // 다시 인코딩한다. 표 행이 있는 표 키만 잰다(행이 없으면 밴드와 무관하게 잠긴다).
  const cases = [
    ['G', 'O', encode, { ...N7, cornerMarker: true, markerTones: true }, { ...FRESH, type: 'O', innerSeat: 'o-cm' }, [2, 3]],
    ['O', 'O', encode, { ...N7 }, { ...FRESH, type: 'O' }, [2]],
    ['A', 'A', encodeA, { ...N7, cornerMarker: true }, { ...FRESH, type: 'A', outerSeat: 'a-cm' }, [0, 1, 2]],
    ['K', 'K', encodeK, { ...N7, cornerMarker: true }, { ...FRESH, type: 'K', outerSeat: 'k-cm' }, [0]],
  ];
  const tally = {};
  for (const [name, type, fn, opts, state, versions] of cases) {
    const hMaxAt = hCapacityOf(fn, opts);
    for (const version of versions) {
      const pinned = { ...opts, version };
      let inN = 0;
      let outN = 0;
      for (let L = 1; L <= hMaxAt(version); L += 1) {
        const text = lenText(L);
        const enc = fn(text, { ...pinned, eccLevel: 'H' });
        const ctx = ctxOf(type, enc, state, 'white', measuredEmphasis(cellShapeTypeOf(type, enc, state)), { fn, text, opts: pinned });
        const inBand = L > hMaxAt(version - 1);
        assert.equal(ctx.measuredStateAtTableKey, inBand, `${name} v${version} 고정 ${L} B: 측정 상태 ≠ 밴드 판정(아래 버전 H ${hMaxAt(version - 1)} B)`);
        const rows = rowsFor(ctx);
        assert.ok(rows.length > 0, `${name} v${version}: 표 행이 없다 — 이 자의 버전 목록을 다시 볼 것`);
        for (const row of rows) {
          assert.deepEqual(resolveRow(row, ctx), inBand ? { spec: { kind: row.cellShape, param: row.param } } : { spec: null, lockReason: R.UNMEASURED },
            `${name} v${version} 고정 ${L} B ${row.cellShape}(${row.param}) — 밴드 ${inBand ? '안' : '밖'}`);
        }
        if (inBand) inN += 1; else outN += 1;
      }
      tally[`${name} v${version}`] = { inBand: inN, outOfBand: outN };
      assert.ok(inN > 0, `${name} v${version}: 밴드 안 길이가 없다`);
      if (version > Math.min(...versions) || hMaxAt(version - 1) > 0) assert.ok(outN > 0, `${name} v${version}: 밴드 밖 길이가 없다 — 판별력 없음`);
    }
  }
  // Y — 로케이터 v0tr 직접 선택(제품: 해상도는 그 레이아웃 안에서 resolveVersionForLayout 가 고른다 · 버전 고정도 같은 레이아웃).
  // n21 v0tr 의 자동 밴드는 n13 v0 H 용량 초과부터(제품 사다리 — 20 B 이하는 v0), n25 v0tr 은 n21 v0tr H 용량 초과부터.
  const Y = { ...FRESH, type: 'Y', bgMode: 'white', locatorProfileY: 'cell-surface-v0tr' };
  const v0Cap = encodeY('x', { ...encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY: 'cell-surface-v0' }), eccLevel: 'H' }).capacity.maxPayloadBytes;
  for (const versionY of [1, 2]) {
    const opts = encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY: 'cell-surface-v0tr', versionY });
    const hMaxAt = hCapacityOf(encodeY, opts);
    const below = versionY === 1 ? v0Cap : hMaxAt(1);
    let inN = 0;
    let outN = 0;
    for (let L = 1; L <= hMaxAt(versionY); L += 1) {
      const text = lenText(L);
      const enc = encodeY(text, { ...opts, eccLevel: 'H' });
      const ctx = ctxOf('Y', enc, Y, 'none', NOT_PASSED, { fn: encodeY, text, opts });
      const inBand = L > below;
      assert.equal(ctx.measuredStateAtTableKey, inBand, `Y v0tr n${enc.n} ${L} B: 측정 상태 ≠ 밴드 판정(아래 ${below} B)`);
      const rows = rowsFor(ctx);
      assert.ok(rows.length > 0, `Y v0tr n${enc.n}: 표 행이 없다`);
      for (const row of rows) {
        assert.deepEqual(resolveRow(row, ctx), inBand ? { spec: { kind: row.cellShape, param: row.param } } : { spec: null, lockReason: R.UNMEASURED },
          `Y v0tr n${enc.n} ${L} B ${row.cellShape}(${row.param}) — 밴드 ${inBand ? '안' : '밖'}`);
      }
      if (inBand) inN += 1; else outN += 1;
    }
    tally[`Y v0tr v${versionY}`] = { inBand: inN, outOfBand: outN };
    assert.ok(inN > 0 && outN > 0, `Y v0tr v${versionY}: 밴드 안 · 밖이 둘 다 나야 한다 ${JSON.stringify(tally)}`);
  }
  t.diagnostic(`측정 밴드 대조 ${JSON.stringify(tally)}`);
});

test('ⓘ 측정 상태 유도 — 입력을 모르면 undefined(판정 안 함) · 버전 고정을 빼고 다시 인코딩한다 · 표 키가 달라지면 거짓(스텁 인코더로 각각)', () => {
  const state = { ...FRESH, type: 'A', outerSeat: 'a-cm' };
  const opts = { ...N7, cornerMarker: true };
  const enc = encodeA(PAYLOAD, { ...opts, eccLevel: 'H' });
  const base = { type: 'A', state, encodeFn: encodeA, text: PAYLOAD, encodeOpts: opts, encoded: enc };
  assert.equal(measuredStateAtTableKey(base), true);
  for (const [k, bad] of [['encodeFn', null], ['text', 3], ['encodeOpts', undefined], ['encoded', null], ['state', null]]) {
    assert.equal(measuredStateAtTableKey({ ...base, [k]: bad }), undefined, `${k} 모름`);
  }
  // 선언 없는 실효 타입(V = A + turnA)은 판정 안 함.
  assert.equal(measuredStateAtTableKey({ ...base, state: { ...state, turnA: true } }), undefined, 'V');
  // 버전 고정을 뺀다 — 스텁이 받은 옵션에 version 이 없고, 자리 키는 측정 값(A 코너 마커 켬 · 사괘 끔)이며 ECC 는 측정 ECC 다.
  const seen = [];
  const recorder = (text, o) => { seen.push(o); return encodeA(text, o); };
  assert.equal(measuredStateAtTableKey({ ...base, encodeFn: recorder, encodeOpts: { ...N7, version: 0, sagoae: true } }), true);
  assert.equal(seen.length, 1);
  assert.equal('version' in seen[0], false, '버전 고정이 반사실 인코딩에 남았다');
  assert.deepEqual([seen[0].cornerMarker, 'sagoae' in seen[0], seen[0].eccLevel], [true, false, CELL_SHAPE_MEASURED_CONFIG.A.eccLevel]);
  // 표 키 대조 — 스텁이 버전 고정을 무시하고 다른 버전을 내면(같은 레이아웃이 아닌 경로 흉내) 거짓이다.
  const otherVersion = (text, o) => encodeA(text, { ...o, version: 1 });
  assert.equal(measuredStateAtTableKey({ ...base, encodeFn: otherVersion }), false, '다른 표 키로 간 반사실을 참으로 셌다');
  // 와이어 구성 대조 — 스텁이 측정 자리를 실현하지 못하면(코너 마커를 떨군다) 표 키가 같아도 거짓이다.
  const dropsMarker = (text, o) => { const { cornerMarker: _c, ...rest } = o; return encodeA(text, rest); };
  assert.equal(measuredStateAtTableKey({ ...base, encodeFn: dropsMarker }), false, '측정 자리를 실현 못 한 반사실을 참으로 셌다');
  // 인코더가 던지면(예 daehan × 코너 마커 배타 · 용량 초과) 거짓이다.
  assert.equal(measuredStateAtTableKey({ ...base, encodeFn: () => { throw new RangeError('x'); } }), false);
});

// ── ⓙ 면 게인(Y 큐브 입체감) ─────────────────────────────────────────────────

test('ⓙ 면 게인 — 측정 게인 선언 = 하네스 규약(자동 · 인쇄용 아님 · 디더 없음)의 게인 · Y 장면만 게인을 읽는다 · 다른 게인이면 face-gain · 모름은 판정 안 함', (t) => {
  // 선언 ↔ 측정 하네스 규약(동결 하네스 lib-assemble defaultFaceGains 와 같은 호출) — 값의 출처가 바뀌면 빨개진다(재측정할 것).
  const harnessGains = faceGainsForRenderProfile(resolveRenderProfile('auto', { printPurpose: false, ditherBits: null }));
  assert.deepEqual({ ...CELL_SHAPE_MEASURED_FACE_GAINS.Y }, { ...harnessGains }, '측정 게인 선언 ≠ 하네스 규약의 게인');
  assert.deepEqual(Object.keys(CELL_SHAPE_MEASURED_FACE_GAINS), ['Y'], '면 게인 판정은 Y 만(아래 장면 대조가 근거)');
  // 제품 기본(생성기 상태 기본의 입체감 · 갈래 · 디더)은 측정 게인이다 — 다르면 제품 기본 Y 가 잠긴다(재측정하거나 기본을 재검토할 일).
  assert.deepEqual({ ...PRODUCT_DEFAULT_FACE_GAINS }, { ...harnessGains }, '제품 기본 면 게인 ≠ 측정 게인');
  assert.equal(FRESH.faceGain, 100, '고급 슬라이더 기본이 100 이 아니다 — 제품 기본 게인이 프로파일 게인과 달라진다');
  // 유도 함수 — Y 는 넘길 옵션의 팔레트 게인(없으면 sceneY 기본), O/A/K 는 undefined.
  assert.deepEqual(producerFaceGains('Y', { palette: { faceGains: { T: 1, L: 1, R: 1 } } }), { T: 1, L: 1, R: 1 });
  assert.deepEqual({ ...producerFaceGains('Y', { palette: {} }) }, { ...DEFAULT_FACE_GAINS }, 'sceneY 기본 게인과 다르다');
  for (const type of ['O', 'A', 'K']) assert.equal(producerFaceGains(type, { palette: SLATE }), undefined, type);
  // 장면 — Y 는 게인에 따라 달라지고(축이 실재한다), O/A/K 생산자는 게인을 안 읽는다(판정 범위의 근거).
  const yE = yEnc('H');
  const ySceneAt = (g) => JSON.stringify(buildSceneY(yE, { palette: paletteOf(SLATE.levels, g) }).shapes);
  const oakScene = (type, g) => {
    const enc = type === 'A' ? encodeA(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' })
      : type === 'K' ? encodeK(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' }) : encode(PAYLOAD, { ...N7, eccLevel: 'H' });
    const o = type === 'K'
      ? { palette: paletteOf(SLATE.levels, g), margin: 20, finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID, centralN7Family: centralN7FamilyForType('K') }
      : sceneOptionsForOA({ fallback: { mode: 'off' }, finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID, palette: paletteOf(SLATE.levels, g), qrText: TL_READER_URL, type });
    return JSON.stringify(buildScene(enc, o).shapes);
  };
  for (const p of RENDER_PROFILE_IDS) {
    const g = faceGainsForRenderProfile(p);
    const measured = ['T', 'L', 'R'].every((k) => g[k] === CELL_SHAPE_MEASURED_FACE_GAINS.Y[k]);
    assert.equal(ySceneAt(g) === ySceneAt(CELL_SHAPE_MEASURED_FACE_GAINS.Y), measured, `Y 장면 — 게인 ${p}`);
    for (const type of ['O', 'A', 'K']) assert.equal(oakScene(type, g), oakScene(type, CELL_SHAPE_MEASURED_FACE_GAINS.Y), `${type} 장면이 게인 ${p} 에 따라 달라졌다`);
  }
  // 문맥 · 판정 — Y 표 행 문맥(제품 유도)에서 측정 게인은 열리고 다른 프로파일 게인은 face-gain, 게인 모름(렌더 값에 없음)은 판정 안 함.
  const Y = { ...FRESH, type: 'Y', bgMode: 'white' };
  const source = { fn: encodeY, text: PAYLOAD, opts: encodeOptionsForY({ tone: 3, fallback: Y_TL, locatorProfileY: 'cell-surface-v0' }) };
  const ctxWith = (g) => cellShapeCtx('Y', yE, Y, { ...renderOf('Y', yE, Y, 'none', NOT_PASSED, source), faceGains: g });
  const measuredCtx = ctxWith(CELL_SHAPE_MEASURED_FACE_GAINS.Y);
  const rows = rowsFor(measuredCtx);
  assert.ok(rows.length > 0, 'Y 측정 문맥에 표 행이 없다 — 자가 비었다');
  let locked = 0;
  for (const p of RENDER_PROFILE_IDS) {
    const g = faceGainsForRenderProfile(p);
    const ctx = ctxWith(g);
    assert.deepEqual(cellShapeAllowCtx(ctx), cellShapeAllowCtx(measuredCtx), '게인은 표 키가 아니다');
    const same = ['T', 'L', 'R'].every((k) => g[k] === CELL_SHAPE_MEASURED_FACE_GAINS.Y[k]);
    for (const row of rows) {
      assert.deepEqual(resolveRow(row, ctx), same ? { spec: { kind: row.cellShape, param: row.param } } : { spec: null, lockReason: R.FACE_GAIN }, `게인 ${p} ${row.cellShape}`);
      if (!same) locked += 1;
    }
  }
  assert.ok(locked > 0, '다른 게인으로 잠긴 행이 없다 — 판별력 없음');
  // 모양이 틀린 게인은 싣지 않는다(판정 안 함) · O/A/K 문맥에는 게인이 없다.
  for (const bad of [null, {}, { T: 1, L: 0.72 }, { T: 1, L: 0.72, R: -1 }, { T: 1, L: 0.72, R: Number.NaN }, 'screen']) {
    assert.equal('faceGains' in ctxWith(bad), false, `게인 ${JSON.stringify(bad)}`);
  }
  const aCtx = cellShapeCtx('A', encodeA(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' }), { ...FRESH, type: 'A', outerSeat: 'a-cm' },
    { quietColor: 'white', detectorEmphasis: 'all', faceGains: { T: 1, L: 1, R: 1 } });
  assert.equal('faceGains' in aCtx, false, 'O/A/K 문맥에 게인이 실렸다');
  t.diagnostic(`면 게인 잠금 행 ${locked}`);
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

// ── ⓚ 내보내기 축(디더 · 크기)과 사유 축 개수 — 합성 문맥(렌더 값 exportPlan) ────────────────────────────────

/** 행의 표 키 문맥 + 그 타입의 측정 구성 + 측정 상태 참(측정 구성 문맥 — 내보내기 축만 흔든다). */
function measuredCtxOfRow(row) {
  const t = row.table === 'y' ? 'Y' : row.type;
  const ctx = { table: row.table, type: t, measuredStateAtTableKey: true };
  for (const k of CELL_SHAPE_ALLOW_KEYS[row.table]) ctx[k] = row[k];
  if (row.table === 'y') Object.assign(ctx, { qrPosition: FRESH.qrPosition, qrWindow: false, qrSlot: false });
  return Object.assign(ctx, CELL_SHAPE_MEASURED_CONFIG[t]);
}

test('ⓚ 내보내기 축 — 디더 · 잰 하한 아래 ppu 는 행이 있어도 잠그고, 그 축 하나뿐이면 그 사유(따르면 열림) · 다른 축과 함께면 unmeasured · 하한 모름은 unmeasured · 표가 하한을 안 실으면 크기는 판정 안 함 · 구조 잠금(하네스 계약)은 내보내기 축을 안 본다', () => {
  const cellRows = ALLOW.ROWS.filter((r) => r.table === 'oak' || r.table === 'y');
  const floors = ALLOW.MEASURED_FLOORS;
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  for (const row of cellRows) {
    const base = measuredCtxOfRow(row);
    const config = CELL_SHAPE_MEASURED_CONFIG[base.type];
    const floorKey = minRoundtripPpuKey(allowRowFloorCtx(row));
    assert.ok(Object.prototype.hasOwnProperty.call(floors, floorKey), `행의 잰 하한 키 ${floorKey} 가 표에 없다`);
    const floor = floors[floorKey];
    const withPlan = (p, extra = {}) => Object.freeze({
      ...base, ...extra, exportPlan: Object.freeze({ dithered: false, ppu: floor, floorKey, ...p }),
    });
    const st = Object.freeze(stateOf(row));
    const res = (ctx, allow = ALLOW) => resolveCellShapeSpec(st, ctx, allow);
    const open = { spec: { kind: row.cellShape, param: row.param } };
    const at = JSON.stringify(row);
    // 잰 하한과 같은 ppu 는 잰 점이다 — 연다. 위도 연다.
    assert.deepEqual(res(withPlan({})), open, `하한 ppu: ${at}`);
    assert.deepEqual(res(withPlan({ ppu: floor * 4 })), open, `하한 위: ${at}`);
    // 한 축 — 그 사유. 따르면(그 축만 측정 값으로 — 하한 ppu · 디더 끔) 위 두 줄처럼 열린다.
    const below = withPlan({ ppu: floor - 0.25 });
    assert.deepEqual(res(below), { spec: null, lockReason: R.EXPORT_SIZE }, `하한 아래: ${at}`);
    const dither = withPlan({ dithered: true });
    assert.deepEqual(res(dither), { spec: null, lockReason: R.EXPORT_DITHER }, `디더: ${at}`);
    bump('single');
    // 두 축 — unmeasured(어느 한 축만 따라서는 안 열린다: 한 축을 돌린 반사실은 남은 축 사유로 잠긴다).
    const both = withPlan({ dithered: true, ppu: floor - 0.25 });
    assert.deepEqual(res(both), { spec: null, lockReason: R.UNMEASURED }, `디더 + 하한 아래: ${at}`);
    const eccOther = ECC_NAMES.find((e) => e !== config.eccLevel);
    for (const [name, ctx] of [
      ['ECC + 디더', withPlan({ dithered: true }, { eccLevel: eccOther })],
      ['ECC + 하한 아래', withPlan({ ppu: floor - 0.25 }, { eccLevel: eccOther })],
    ]) {
      assert.deepEqual(res(ctx), { spec: null, lockReason: R.UNMEASURED }, `${name}: ${at}`);
      bump('pair');
    }
    // 내보내기 축만 따르면 ECC 사유로 남는다(잠금 그대로) — 위 두 축이 참으로 둘이다.
    assert.deepEqual(res(withPlan({}, { eccLevel: eccOther })), { spec: null, lockReason: R.ECC_LEVEL }, `ECC 한 축: ${at}`);
    // 측정 상태 거짓(측정 밴드 밖)이면 내보내기 한 축이어도 따를 수 없다 — unmeasured.
    assert.deepEqual(res(withPlan({ dithered: true }, { measuredStateAtTableKey: false })), { spec: null, lockReason: R.UNMEASURED });
    // 잰 하한 모름(표가 하한을 싣는데 이 키가 없다) — 잴 수 없으면 잠근다(사유 unmeasured — 어느 축을 따라도 열린다고 말 못 한다).
    assert.deepEqual(res(withPlan({ floorKey: 'Z:9' })), { spec: null, lockReason: R.UNMEASURED }, `하한 모름: ${at}`);
    // 표가 MEASURED_FLOORS 를 안 실으면(행만 주입한 표) 크기는 판정하지 않는다 — 디더는 여전히 잠근다.
    assert.deepEqual(res(below, { ROWS: [row] }), open, `하한 없는 표에서 크기를 판정했다: ${at}`);
    assert.deepEqual(res(dither, { ROWS: [row] }), { spec: null, lockReason: R.EXPORT_DITHER });
    // ppu 모름(계획이 던졌다 — 내보낼 그림이 없다)이면 크기는 판정하지 않는다.
    assert.deepEqual(res(Object.freeze({ ...base, exportPlan: Object.freeze({ dithered: false }) })), open);
    // 구조 잠금(측정 하네스 계약 — 첫 번째로 다른 측정 구성 축)은 내보내기 축을 안 본다.
    assert.equal(cellShapeStructuralLock(row.table, row.cellShape, row.param, both), null, `구조 잠금이 내보내기 축을 봤다: ${at}`);
  }
  // exposed-gap — 틈만 흰색으로 바꾸면 열리는 문맥도 내보내기 축이 다르면 틈 탓이 아니다(두 축).
  let gap = 0;
  for (const row of cellRows.filter((r) => r.gapGrade === 'white' && EXPOSED_CELL_SHAPES.includes(r.cellShape))) {
    const ctx = { ...measuredCtxOfRow(row), gapGrade: 'unknown', bgMode: 'transparent' };
    const st = Object.freeze(stateOf(row));
    if (resolveCellShapeSpec(st, Object.freeze(ctx)).lockReason !== R.EXPOSED_GAP) continue;
    const floorKey = minRoundtripPpuKey(allowRowFloorCtx(row));
    for (const p of [{ dithered: true }, { dithered: false, ppu: ALLOW.MEASURED_FLOORS[floorKey] - 0.25, floorKey }]) {
      assert.deepEqual(resolveCellShapeSpec(st, Object.freeze({ ...ctx, exportPlan: Object.freeze(p) })), { spec: null, lockReason: R.UNMEASURED },
        `틈 + 내보내기 축인데 틈 탓: ${JSON.stringify(row)} ${JSON.stringify(p)}`);
    }
    gap += 1;
  }
  assert.ok(counts.single > 0 && counts.pair > 0 && gap > 0, JSON.stringify({ ...counts, gap }));
  // 축 목록 — 측정 구성 축(구조 잠금 순서) · 면 게인 · 내보내기 둘. 내보내기 사유는 구조 잠금 사유가 아니다(하네스 계약 밖).
  assert.deepEqual([...CELL_SHAPE_LOCK_AXES], [...CELL_SHAPE_MEASURED_CONFIG_AXES.map((a) => a.reason), R.FACE_GAIN, R.EXPORT_DITHER, R.EXPORT_SIZE]);
  for (const r of [R.EXPORT_DITHER, R.EXPORT_SIZE]) assert.ok(!CELL_SHAPE_STRUCTURAL_LOCK_REASONS.includes(r), `${r} 는 구조 잠금 사유가 아니다`);
});

test('ⓚ 디더 ↔ 면 게인(Y) — 디더를 끄면 측정 게인으로 돌아오면 게인 차이는 디더의 파생(한 축 export-dither) · 디더를 꺼도 게인이 측정 밖이면 두 축 · 디더를 끈 게인을 모르면 지금 게인으로 센다', () => {
  const yRows = ALLOW.ROWS.filter((r) => r.table === 'y');
  assert.ok(yRows.length > 0);
  const measured = CELL_SHAPE_MEASURED_FACE_GAINS.Y;
  const soft = faceGainsForRenderProfile('soft');
  const print = faceGainsForRenderProfile('print');
  assert.notDeepEqual({ ...soft }, { ...measured });
  assert.notDeepEqual({ ...print }, { ...measured });
  let n = 0;
  for (const row of yRows) {
    const base = measuredCtxOfRow(row);
    const st = Object.freeze(stateOf(row));
    const open = { spec: { kind: row.cellShape, param: row.param } };
    const res = (faceGains, plan) => resolveCellShapeSpec(st, Object.freeze({
      ...base, faceGains, ...(plan ? { exportPlan: Object.freeze(plan) } : {}),
    }));
    const at = JSON.stringify(row);
    assert.deepEqual(res({ ...measured }, null), open, at);
    // 디더 2(자동 → 출력물용) · 디더를 끄면 화면용(측정) — 한 축(디더). 면 게인 사유는 나오지 않는다.
    assert.deepEqual(res(print, { dithered: true, faceGainsDitherOff: { ...measured } }), { spec: null, lockReason: R.EXPORT_DITHER }, at);
    // 디더를 꺼도 약(인쇄용 갈래 · 약 명시) — 두 축.
    assert.deepEqual(res(print, { dithered: true, faceGainsDitherOff: soft }), { spec: null, lockReason: R.UNMEASURED }, at);
    // 지금 게인은 측정인데 디더를 끄면 측정 밖이 된다 — 디더만 따르면 게인으로 잠긴다: 두 축.
    assert.deepEqual(res({ ...measured }, { dithered: true, faceGainsDitherOff: soft }), { spec: null, lockReason: R.UNMEASURED }, at);
    // 디더를 끈 게인 모름 — 지금 게인으로 센다(지금 게인이 다르면 두 축 · 같으면 디더 한 축).
    assert.deepEqual(res(print, { dithered: true }), { spec: null, lockReason: R.UNMEASURED }, at);
    assert.deepEqual(res({ ...measured }, { dithered: true }), { spec: null, lockReason: R.EXPORT_DITHER }, at);
    // 디더가 아니면 디더를 끈 게인은 판정에 안 쓴다 — 면 게인 한 축 그대로.
    assert.deepEqual(res(soft, { dithered: false, faceGainsDitherOff: { ...measured } }), { spec: null, lockReason: R.FACE_GAIN }, at);
    n += 1;
  }
  assert.ok(n > 0);
});

test('ⓚ 문맥 보조 필드 exportPlan — 모양이 맞을 때만 싣는다(dithered boolean · ppu 는 floorKey 와 함께 · 디더를 끈 게인은 Y 만) · 동결 사본', () => {
  const enc = encodeA(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' });
  const A = { ...FRESH, type: 'A', outerSeat: 'a-cm' };
  const ctx = (exportPlan, type = 'A', e = enc, s = A) => cellShapeCtx(type, e, s, { ...renderOf(type, e, s), exportPlan });
  assert.equal('exportPlan' in ctx(undefined), false);
  assert.equal('exportPlan' in ctx({ dithered: 'yes' }), false, 'dithered 가 boolean 이 아니면 싣지 않는다');
  assert.deepEqual({ ...ctx({ dithered: false, ppu: 5 }).exportPlan }, { dithered: false }, 'floorKey 없는 ppu');
  assert.deepEqual({ ...ctx({ dithered: false, ppu: -1, floorKey: 'A:0' }).exportPlan }, { dithered: false }, '양수 아닌 ppu');
  assert.deepEqual({ ...ctx({ dithered: false, ppu: Number.NaN, floorKey: 'A:0' }).exportPlan }, { dithered: false });
  const good = ctx({ dithered: true, ppu: 9.5, floorKey: 'A:0', faceGainsDitherOff: { T: 1, L: 0.72, R: 0.62 } }).exportPlan;
  assert.deepEqual({ ...good }, { dithered: true, ppu: 9.5, floorKey: 'A:0' }, 'O/A/K 에 디더를 끈 게인이 실렸다');
  assert.ok(Object.isFrozen(good));
  const Y = { ...FRESH, type: 'Y', locatorProfileY: 'cell-surface-v0' };
  const yEncoded = yEnc('H');
  const yPlan = (g) => ctx({ dithered: true, faceGainsDitherOff: g }, 'Y', yEncoded, Y).exportPlan;
  assert.deepEqual({ ...yPlan({ T: 1, L: 0.72, R: 0.62 }).faceGainsDitherOff }, { T: 1, L: 0.72, R: 0.62 });
  assert.equal('faceGainsDitherOff' in yPlan({ T: 1, L: 0 }), false, '게인 모양이 아니면 싣지 않는다');
  assert.ok(Object.isFrozen(yPlan({ T: 1, L: 0.72, R: 0.62 }).faceGainsDitherOff));
});

test('ⓚ 내보내기 계획 유도(cellShapeExportPlan) — 디더는 양자화기가 픽셀을 바꾸는 비트깊이만 · 잰 하한 키 = 내보내기 호출 모양(생성기 타입 · 버전 · 레이아웃)의 하한 키 · ppu 는 유한한 양수만', () => {
  // 디더 — 양자화기(dither quantizeDitherRaster)가 픽셀을 바꾸는가와 같다(이 자는 유도 함수와 다른 표본으로 잰다).
  const sample = new Uint8ClampedArray([10, 200, 77, 255, 3, 250, 128, 255]);
  const enc = encodeA(PAYLOAD, { ...N7, cornerMarker: true, eccLevel: 'H' });
  const A = { ...FRESH, type: 'A', outerSeat: 'a-cm' };
  const planOf = (ditherBits, ppu = 9) => cellShapeExportPlan({ type: 'A', state: A, encoded: enc, ppu, ditherBits });
  assert.equal(planOf(null).dithered, false);
  for (const bits of DITHER_BIT_DEPTHS) {
    const changes = quantizeDitherRaster({ width: 2, height: 1, pixels: sample }, bits).pixels.some((v, i) => v !== sample[i]);
    assert.equal(planOf(bits).dithered, changes, `비트깊이 ${bits}`);
  }
  assert.ok(DITHER_BIT_DEPTHS.some((b) => planOf(b).dithered) && DITHER_BIT_DEPTHS.some((b) => !planOf(b).dithered), '디더 판정의 두 갈래');
  assert.equal(planOf(7), undefined, '도메인 밖 비트깊이');
  for (const bad of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    const p = cellShapeExportPlan({ type: 'A', state: A, encoded: enc, ppu: bad, ditherBits: null });
    assert.equal('ppu' in p || 'floorKey' in p, false, `ppu ${bad}`);
  }
  // 잰 하한 키 — 내보내기 경로(index.html 내보내기 계획)가 minRoundtripPpu 에 넘기는 모양({생성기 타입, 버전, 셀 표면 레이아웃})의 키와 같다.
  const cases = [
    ['A', encodeA, { ...N7, cornerMarker: true }, A],
    ['K', encodeK, { ...N7, cornerMarker: true }, { ...FRESH, type: 'K', outerSeat: 'k-cm' }],
    ['O', encode, { ...N7 }, { ...FRESH, type: 'O', innerSeat: 'none' }],
    ['O', encode, { ...N7, cornerMarker: true, markerTones: true }, { ...FRESH, type: 'O', innerSeat: 'o-cm' }],
  ];
  let n = 0;
  for (const [type, fn, opts, state] of cases) {
    for (const text of [PAYLOAD, lenText(35), lenText(60)]) {
      let e;
      try { e = fn(text, { ...opts, eccLevel: 'H' }); } catch { continue; }
      const p = cellShapeExportPlan({ type, state, encoded: e, ppu: 9, ditherBits: null });
      assert.equal(p.floorKey, minRoundtripPpuKey({ type, version: e.version, cellSurfaceLayout: e.cellSurfaceLayout || null }), `${type} ${text.length} B`);
      n += 1;
    }
  }
  for (const L of [13, 25, 60]) {
    const auto = resolveAutoY({ payloadBytes: L, tones: 3, eccLevel: 'H' });
    const opts = encodeOptionsForY({ tone: 3, versionY: auto.version, fallback: Y_TL, locatorProfileY: auto.locatorProfileY });
    const e = encodeY(lenText(L), { ...opts, eccLevel: 'H' });
    const p = cellShapeExportPlan({ type: 'Y', state: { ...FRESH, type: 'Y' }, encoded: e, ppu: 9, ditherBits: null });
    assert.equal(p.floorKey, minRoundtripPpuKey({ type: 'Y', version: e.version, cellSurfaceLayout: e.cellSurfaceLayout || null }), `Y ${L} B`);
    n += 1;
  }
  assert.ok(n >= 6, `대조 ${n}`);
});
