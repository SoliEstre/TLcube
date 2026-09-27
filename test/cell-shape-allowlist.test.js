// cell-shape-allowlist.test.js — 허용표 · 잠금 분류 · 상태 정규화의 성질 (DESIGN_001 §3.4 · §7.5, 레인 D1 2026-09-26)
//
// 재는 것:
//   ① 허용표 내부 일관성 · 지문 — 행 모양(표별 키 **정확히**) · 도메인 · 중복 없음 · 구조 잠금에 걸린 «죽은 행» 없음 ·
//      영수증 sha/측정 시각/지문은 셋이 함께 있거나 함께 없다(행이 있으면 반드시 있다). 판정 함수는 심은 결함 표로
//      빨개지는지 따로 잰다.
//   ② UI 가 열거하는 선택지 전부(스키마 DECORATION_STATE_DOMAINS 에서 **유도** — 손 목록 없음)를 실제 인코딩에서 유도한
//      대표 문맥(cellShapeCtx · hCellStyleCtx · QR 호스트)마다 resolver 에 넣으면, 결과는 «허용»(spec/deco) ·
//      «기본값(사유 없는 null)» · «잠금 + 안정 사유 id» 셋 중 하나다. 빈 표(스텁 모양 STUB 을 **주입** — 기본 모듈은
//      2026-09-27 부터 L6 생성본이다)에서는 비기본 전부가 잠금 + 사유. 생성본 자체의 성질은 cell-shape-allow-generated.test.js.
//   ③ 구조 잠금 — 그 조합의 행을 **정확히** 넣은 «전부 열림» 표(심은 결함)로도 잠긴다. 판별력: 잠금 조건 하나만 뒤집은
//      문맥(같은 표)에서는 같은 선택이 열린다. 구조 잠금 사유 전부(셀 — 측정 구성 불일치 seat-config · ecc-level 포함 ·
//      QR · H)가 실제 문맥에서 한 번 이상 난다. 대표 문맥은 제품 경로(ECC H · A/K 자동 코너 마커)로 인코딩한다.
//      사유 순서: 설계 잠금(문맥 전체 · 모양별 — 영구)이 측정 구성 불일치보다 먼저다. 측정 구성 사유는 «측정 구성이면 이
//      행이 열린다» 일 때만 나온다(반사실) — 빈 표(②)에서는 행이 없으니 자리 · ECC 사유가 안 나온다(2026-09-27 검토).
//   ④ resolver 는 상태를 고치지 않는다(동결 상태 · JSON 전후 동일).
//   ⑤ 상태 정규화 — 부재 · 문자열 · 범위 밖 · 정수 아님 → 기본값, 도메인 안은 그대로. 정규화를 거친 customSat 로는
//      makeCustomPalette 가 절대 RangeError 를 내지 않는다.
//   ⑥ 생성기 상태 → QR 호스트(qrDecoHostOf): H(Y+3d) 는 'h' — isHGenerator · cellShapeTypeOf 와 같은 격자, h 행 하나로
//      실제로 열린다(y 로 보내면 구조 잠금으로 빨개진다). 런타임 대비 재단언은 열리는 호스트(oak · h)에서.
//      UI 입력(문자열 .value) → decorationValueFromInput: 스키마 선택지 전부가 문자열로 왕복한다.
// 못 재는 것: 허용표의 **측정 사실**(영수증은 private — §7.6, 승격 게이트 재측정이 덮는다).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as DEFAULT_ALLOW from '../src/cell-shape-allow.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { encodeY } from '../src/encodeY.js';
import { encodeH } from '../src/h-codec.js';
import { getPreset, PRESETS } from '../src/luminance.js';
import { makeCustomPalette } from '../src/palette-hue.js';
import {
  centralBeaconEncoderOptions, detectorEmphasisEquivalents, encodeOptionsForY, measuredStateAtTableKey, producerFaceGains,
} from '../src/generator-render-config.js';
import { faceGainsForRenderProfile } from '../src/render-profile.js';
import {
  CELL_SHAPES, CELL_SHAPE_ALLOW_KEYS, CELL_SHAPE_DEFAULT, CELL_SHAPE_LOCK_CTX_KEYS, CELL_SHAPE_LOCK_REASONS,
  CELL_SHAPE_MEASURED_CONFIG_KEYS, CELL_SHAPE_PARAMS, CELL_SHAPE_STRUCTURAL_LOCK_REASONS, cellShapeAllowCtx, cellShapeCtx, cellShapeStructuralLock,
  cellShapeTypeOf, resolveCellShapeSpec,
} from '../src/cell-shape.js';
import {
  QR_ALLOW_KEYS, QR_DECO_LOCK_REASONS, QR_DECO_STRUCTURAL_LOCK_REASONS, QR_HOSTS, QR_LOCKED_HOSTS, qrDecoHostOf,
  resolveQrDeco,
} from '../src/qr-colors.js';
import { SQUARE_CELL_STYLES } from '../src/square-cell-style.js';
import {
  H_CELL_STYLE_ALLOW_KEYS, H_CELL_STYLE_LOCK_REASONS, hCellStyleCtx, isHGenerator, resolveHCellStyleSpec,
} from '../src/generator-h.js';
import {
  DECORATION_LOCK_REASON_IDS, DECORATION_STATE_DOMAINS, DECORATION_STATE_KEYS, GENERATOR_STATE_SCHEMA,
  createGeneratorState, decorationValueFromInput, normalizeDecorationState, normalizeDecorationValue,
} from '../src/generator-state.js';
import { GENERATOR_TYPES } from '../src/generator-types.js';

const PAYLOAD = 'https://tl.estre.so';
const SLATE = getPreset('slate');
const FRESH = createGeneratorState();

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** 명시적 빈 표 — «전부 잠금» 스텁 모양(행 0 · 영수증 없음). 기본 모듈이 생성본이 된 뒤에도 빈 표 성질을 그대로 잰다. */
const STUB = deepFreeze({ ROWS: [], RECEIPT_SHA256: null, MEASURED_AT: null, FINGERPRINT: null });

// ── 선택지 — 스키마 도메인에서 유도 ─────────────────────────────────────────

const D = DECORATION_STATE_DOMAINS;
const optionsOf = (key) => (D[key].kind === 'enum' ? D[key].values : D[key].samples);

/** 셀 모양 선택지: 모양 × 그 모양의 강도 키 도메인(round-bevel 은 고정). */
function cellChoices() {
  const out = [];
  for (const kind of optionsOf('cellShape')) {
    const def = CELL_SHAPE_PARAMS[kind];
    if (!def) { out.push({ cellShape: kind }); continue; }
    for (const v of optionsOf(def.key)) out.push({ cellShape: kind, [def.key]: v });
  }
  return out;
}
/** H 선택지: 스타일 × 바탕. */
function hChoices() {
  return optionsOf('hCellStyle').flatMap((hCellStyle) => optionsOf('hCellGround').map((hCellGround) => ({ hCellStyle, hCellGround })));
}
/** QR 선택지: 스타일 × 모드(custom 은 hue × sat 표본) × 눈(custom 은 hue × sat 표본). */
function qrChoices() {
  const eyes = optionsOf('qrEye').flatMap((qrEye) => (qrEye === 'custom'
    ? optionsOf('qrEyeHue').flatMap((qrEyeHue) => optionsOf('qrEyeSat').map((qrEyeSat) => ({ qrEye, qrEyeHue, qrEyeSat })))
    : [{ qrEye }]));
  const modes = optionsOf('qrColorMode').flatMap((qrColorMode) => (qrColorMode === 'custom'
    ? optionsOf('qrHue').flatMap((qrHue) => optionsOf('qrSat').map((qrSat) => ({ qrColorMode, qrHue, qrSat })))
    : [{ qrColorMode }]));
  const out = [];
  for (const qrCellStyle of optionsOf('qrCellStyle')) for (const m of modes) for (const e of eyes) out.push({ qrCellStyle, ...m, ...e });
  return out;
}
const isCellDefault = (c) => c.cellShape === D.cellShape.defaultValue;
const isHDefault = (c) => c.hCellStyle === D.hCellStyle.defaultValue;
const isQrDefault = (c) => c.qrCellStyle === D.qrCellStyle.defaultValue && c.qrColorMode === D.qrColorMode.defaultValue
  && (c.qrEye === D.qrEye.defaultValue || c.qrEye === 'darker'); // default 의 darker 는 바꿀 것이 없어 none 으로 접힌다

// ── 대표 문맥 — 실제 인코딩 + 상태에서 제품 함수로 유도 ─────────────────────

const N7 = 'central-n7-payload';
const PINWHEEL = 'pinwheel-c2-2-1100-cw';
/**
 * 대표 문맥은 **제품 경로** 인코딩으로 만든다(2026-09-27 자리 레인): 제품 ECC 는 auto 라 짧은 페이로드에서 H 를 고르고,
 * A · K 의 제품 기본 자리는 자동 코너 마커(a-cm · k-cm)다 — 허용표 행은 그 측정 구성(CELL_SHAPE_MEASURED_CONFIG)에서 잰
 * 사실이다. 인코더 기본값(eccLevel 'M' · cornerMarker 없음)은 측정 밖 구성이라 새 구조 잠금(seat-config · ecc-level)에
 * 걸린다 — 그 구성은 아래 «측정 밖» 문맥이 음성으로 잰다.
 */
const H = Object.freeze({ eccLevel: 'H' });
const N7_OPTS = centralBeaconEncoderOptions(N7, false);
// 윈도 β(Y2 · 2톤 강제)는 H 로 인코딩되지 않는다(19 B — 제품 auto 는 M 으로 내려간다). 2톤 잠금이 먼저라 ECC 는 판정 밖이다.
const yEnc = (locatorProfileY, tone, fallback = { mode: 'corner', corner: 'TL' }, eccLevel = 'H') => encodeY(PAYLOAD, { ...encodeOptionsForY({ tone, fallback, locatorProfileY }), eccLevel });
const W = { quietColor: 'white' };
/**
 * 대표 문맥 = 제품 렌더 값까지 실은 문맥. 실효 검출 강조(측정 구성 키)는 제품 기본 그림 — O/A/K 는 생성기 상태 강조
 * (FRESH.centralN7Emphasis)를 생산자에 싣고 Y 일반 화면은 안 싣는다(renderTypeY 고급 게이트) — 에서 제품 유도 함수
 * (generator-render-config `detectorEmphasisEquivalents`)가 낸 값이다. 강조 축 자체는 이 자가 아니라
 * cell-shape-measured-config(유닛 · 실제 렌더 대조) · decoration-ui(제품 경로)가 잰다 — 여기서는 문맥을 완전하게 채운다.
 * 면 게인(Y)도 제품 유도 함수(`producerFaceGains` — 생산자 옵션의 팔레트 게인, 없으면 sceneY 기본)로 싣는다(`render.faceGains` 로 덮을 수 있다).
 * `source`({fn, opts, text?} — 인코더와 eccLevel 뺀 옵션 · 페이로드(기본 PAYLOAD))를 주면 측정 상태(보조 필드 measuredStateAtTableKey —
 * 와이어 축 사유의 실현 조건 · 측정 밴드)도 제품 유도 함수(generator-render-config `measuredStateAtTableKey`)로 싣는다 — 자리 · ECC 가
 * 측정과 다른 문맥은 그것이 참이어야 사유가 seat-config · ecc-level 이다(2026-09-28, DESIGN_002 §4.4 + 착지 검토). 없으면 unmeasured.
 */
function productCtx(type, enc, state, render, source) {
  const sceneOpts = { palette: SLATE, finderPatternId: state.finderPatternId };
  if (type !== 'Y') sceneOpts.centralN7Emphasis = state.centralN7Emphasis;
  const measured = source
    ? { measuredStateAtTableKey: measuredStateAtTableKey({ type, state, encodeFn: source.fn, text: source.text ?? PAYLOAD, encodeOpts: source.opts, encoded: enc }) }
    : {};
  return cellShapeCtx(type, enc, state, {
    detectorEmphasis: detectorEmphasisEquivalents(type, enc, sceneOpts), faceGains: producerFaceGains(type, sceneOpts), ...measured, ...render,
  });
}
/** 16 B — O 자동 H V2 밴드(15–31) 안이면서 O 사괘도 자동 V2(V2 사괘 H ≤ 18 B)에 머무는 길이(같은 표 키에서 자리만 다르다). */
const P16 = 'https://tl.estre';
const yOpts = (locatorProfileY) => encodeOptionsForY({ tone: 3, fallback: { mode: 'corner', corner: 'TL' }, locatorProfileY });
/**
 * 이름 → {ctx, expect, config?}. expect = 설계 잠금 기대(설계 §3.1 · §3.2 1차 잠금 목록 — 선택 → 사유|null),
 * config = 측정 구성 불일치 사유(모든 모양 — 단 설계 잠금이 먼저다: 영구 잠금을 «자리 · ECC 탓» 으로 안내하지 않는다).
 */
const CTXS = {
  'O n7 TL': { ctx: productCtx('O', encode(PAYLOAD, { ...N7_OPTS, ...H }), FRESH, W), expect: () => null },
  'O pinwheel(흰 평탄화)': { ctx: productCtx('O', encode(PAYLOAD, H), { ...FRESH, finderPatternId: PINWHEEL, bgMode: 'white' }, { quietColor: 'none' }), expect: () => null },
  'O 불스아이': { ctx: productCtx('O', encode(PAYLOAD, H), { ...FRESH, finderPatternId: 'bullseye' }, W), expect: (k) => (k === 'dot' ? 'bullseye-dot' : null) },
  'O cube-bullseye': { ctx: productCtx('O', encode(PAYLOAD, H), { ...FRESH, finderPatternId: 'cube-bullseye' }, W), expect: (k) => (k === 'dot' ? 'bullseye-dot' : null) },
  'C(ultra)': { ctx: productCtx('O', encode(PAYLOAD, { notchC: true, version: 0 }), { ...FRESH, versionO: 'ultra', finderPatternId: PINWHEEL }, W), expect: () => 'type-c-ultra' },
  // G · V 는 측정 구성 선언이 없다(행 0 — 표에서 unmeasured). 열림 fixture 로는 열린다(구조 잠금이 아니다).
  'G(o-cm)': { ctx: productCtx('O', encode(PAYLOAD, { cornerMarker: true, ...H }), { ...FRESH, innerSeat: 'o-cm', finderPatternId: PINWHEEL }, W), expect: () => null },
  'A n7(자동 a-cm)': { ctx: productCtx('A', encodeA(PAYLOAD, { ...N7_OPTS, cornerMarker: true, ...H }), { ...FRESH, type: 'A', outerSeat: 'a-cm' }, W), expect: () => null },
  'V(turnA)': { ctx: productCtx('A', encodeA(PAYLOAD, { turnA: true }), { ...FRESH, type: 'A', turnA: true, finderPatternId: PINWHEEL }, W), expect: () => null },
  'K pinwheel(검정 판 · 자동 k-cm)': { ctx: productCtx('K', encodeK(PAYLOAD, { cornerMarker: true, ...H }), { ...FRESH, type: 'K', outerSeat: 'k-cm', finderPatternId: PINWHEEL }, { quietColor: 'black' }), expect: () => null },
  'Y v0 3톤(투명)': { ctx: productCtx('Y', yEnc('cell-surface-v0', 3), FRESH, { quietColor: 'none' }), expect: () => null },
  'Y v0 3톤(흰 평탄화)': { ctx: productCtx('Y', yEnc('cell-surface-v0', 3), { ...FRESH, bgMode: 'white' }, { quietColor: 'none' }), expect: () => null },
  'Y v0 2톤': { ctx: productCtx('Y', yEnc('cell-surface-v0', 2), { ...FRESH, tone: 2, bgMode: 'white' }, { quietColor: 'none' }), expect: () => 'y-two-tone' },
  'Y hex-frame 3톤': { ctx: productCtx('Y', yEnc('hex-frame-v1', 3), { ...FRESH, bgMode: 'white', locatorProfileY: 'hex-frame-v1' }, { quietColor: 'none' }), expect: (k) => (k === 'gap' || k === 'dot' ? 'y-hex-frame-gap-dot' : null) },
  'Y v0ty 슬롯 3톤': { ctx: productCtx('Y', yEnc('cell-surface-v0ty', 3), { ...FRESH, bgMode: 'white' }, { quietColor: 'none' }), expect: () => 'y-qr-slot' },
  'Y v0 안쪽 QR 3톤': { ctx: productCtx('Y', yEnc('cell-surface-v0', 3), { ...FRESH, bgMode: 'white', qrPosition: 'inner' }, { quietColor: 'none' }), expect: () => 'y-inner-qr' },
  'Y 윈도 β': { ctx: productCtx('Y', yEnc('off', 3, { mode: 'window' }, 'M'), { ...FRESH, bgMode: 'white', qrPosition: 'inner' }, { quietColor: 'none' }), expect: () => 'y-two-tone' },
  // ── 측정 밖 구성(2026-09-27) — 표 키는 측정 구성과 같아 행으로 열리던 거짓 열림. 모든 모양이 잠긴다 ──
  //    (돌출 bevel · 불스아이 dot 같은 영구 설계 잠금은 그 사유가 먼저다 — 자리 · ECC 를 되돌려도 안 열린다.)
  //    자리 사유는 실현 조건(측정 자리로 같은 표 키에 측정 상태)이 참일 때만이라 측정 상태를 제품 유도 함수로 싣는다(2026-09-28).
  'A n7 바깥 없음': { ctx: productCtx('A', encodeA(PAYLOAD, { ...N7_OPTS, ...H }), { ...FRESH, type: 'A' }, W, { fn: encodeA, opts: N7_OPTS }), expect: () => null, config: 'seat-config' },
  'K pinwheel 바깥 없음': { ctx: productCtx('K', encodeK(PAYLOAD, H), { ...FRESH, type: 'K', finderPatternId: PINWHEEL }, { quietColor: 'black' }, { fn: encodeK, opts: {} }), expect: () => null, config: 'seat-config' },
  // 사괘는 16 B — 19 B 는 사괘면 V3 로 올라가 측정 자리(사괘 없음)의 자동 V2 와 표 키가 갈린다(표 키 고정 반사실 밖 → unmeasured).
  'O n7 사괘': { ctx: productCtx('O', encode(P16, { ...N7_OPTS, sagoae: true, ...H }), { ...FRESH, deepSeat: 'sagoae' }, W, { fn: encode, opts: { ...N7_OPTS, sagoae: true }, text: P16 }), expect: () => null, config: 'seat-config' },
  'O n7 사괘 19 B(측정 자리면 다른 표 키)': { ctx: productCtx('O', encode(PAYLOAD, { ...N7_OPTS, sagoae: true, ...H }), { ...FRESH, deepSeat: 'sagoae' }, W, { fn: encode, opts: { ...N7_OPTS, sagoae: true } }), expect: () => null, config: 'unmeasured' },
  // ECC M — 19 B 는 같은 버전에서 H 로도 들어간다(실현 조건 참 — 제품 유도 함수로 싣는다). 실현 불가(auto-M 길이)는
  // cell-shape-measured-config ⓗ · decoration-ui 가 잰다.
  'O n7 ECC M': { ctx: productCtx('O', encode(PAYLOAD, { ...N7_OPTS, eccLevel: 'M' }), FRESH, W, { fn: encode, opts: N7_OPTS }), expect: () => null, config: 'ecc-level' },
  'O 불스아이 ECC M': { ctx: productCtx('O', encode(PAYLOAD, { eccLevel: 'M' }), { ...FRESH, finderPatternId: 'bullseye' }, W, { fn: encode, opts: {} }), expect: (k) => (k === 'dot' ? 'bullseye-dot' : null), config: 'ecc-level' },
  'Y v0 3톤 ECC M': { ctx: productCtx('Y', yEnc('cell-surface-v0', 3, undefined, 'M'), { ...FRESH, bgMode: 'white' }, { quietColor: 'none' }, { fn: encodeY, opts: yOpts('cell-surface-v0') }), expect: () => null, config: 'ecc-level' },
  // hex-frame(시험판 로케이터)은 제품 자동 사다리가 고르지 않아 측정 상태가 그 표 키에 없다 — ECC 사유는 따를 수 없어 unmeasured,
  // 설계 잠금(gap · dot)이 먼저다.
  'Y hex-frame 3톤 ECC M': { ctx: productCtx('Y', yEnc('hex-frame-v1', 3, undefined, 'M'), { ...FRESH, bgMode: 'white', locatorProfileY: 'hex-frame-v1' }, { quietColor: 'none' }, { fn: encodeY, opts: yOpts('hex-frame-v1') }), expect: (k) => (k === 'gap' || k === 'dot' ? 'y-hex-frame-gap-dot' : null), config: 'unmeasured' },
  // 면 게인(2026-09-28) — Y 는 큐브 입체감 게인으로 그리고 행은 화면용 게인에서 잰 사실이다. 출력물용(1/1/1)이면 잠긴다.
  'Y v0 3톤 입체감 출력물용': { ctx: productCtx('Y', yEnc('cell-surface-v0', 3), { ...FRESH, bgMode: 'white' }, { quietColor: 'none', faceGains: faceGainsForRenderProfile('print') }), expect: () => null, config: 'face-gain' },
  // 실효 검출 강조(2026-09-27) — 제품 상태의 강조만 바꾼다. 중앙 TL · 코너 마커 검출 셀은 'default' 가 측정('all')과 다른 그림이라
  // 잠기고(대상 아닌 핀휠이라도 k-cm 검출 셀이 있으면 강조가 그림을 바꾼다), 대상 아닌 중앙 · 검출 셀 없음(불스아이)은 «해당 없음»
  // 이라 강조로는 안 잠긴다(설계 잠금 dot 만).
  'O n7 강조 default': { ctx: productCtx('O', encode(PAYLOAD, { ...N7_OPTS, ...H }), { ...FRESH, centralN7Emphasis: 'default' }, W), expect: () => null, config: 'detector-emphasis' },
  'K pinwheel k-cm 강조 default': { ctx: productCtx('K', encodeK(PAYLOAD, { cornerMarker: true, ...H }), { ...FRESH, type: 'K', outerSeat: 'k-cm', finderPatternId: PINWHEEL, centralN7Emphasis: 'default' }, { quietColor: 'black' }), expect: () => null, config: 'detector-emphasis' },
  'O 불스아이 강조 default(해당 없음)': { ctx: productCtx('O', encode(PAYLOAD, H), { ...FRESH, finderPatternId: 'bullseye', centralN7Emphasis: 'default' }, W), expect: (k) => (k === 'dot' ? 'bullseye-dot' : null) },
};
/**
 * 기대 사유 — 설계 잠금(문맥 기대 → 돌출 bevel 1.4) → 측정 구성 불일치 → 없음. 설계 잠금은 영구라 측정 구성보다 먼저다.
 * 측정 구성 사유는 «그 행이 표에 있을 때» 만 참이다(반사실) — ③ 의 «전부 열림» 표에는 행이 있으니 그 사유가 기대다.
 */
function expectedStructural(name, choice) {
  const kind = choice.cellShape;
  const byCtx = CTXS[name].expect(kind);
  if (byCtx) return byCtx;
  if (kind === 'bevel' && choice.cellBevel > 1) return 'bevel-raised';
  return CTXS[name].config ?? null;
}

const H_STATE = createGeneratorState({ type: 'Y', yRepresentation: '3d' });
const H_CTXS = {
  'H2 frame 3톤': { ctx: hCellStyleCtx(encodeH('TL', { version: 2, mode: 3, tones: 3, finder: 'frame', ecc: 'M' }), H_STATE), expect: null },
  'H2 frame 2톤': { ctx: hCellStyleCtx(encodeH('TL', { version: 2, mode: 3, tones: 2, finder: 'frame', ecc: 'M' }), H_STATE), expect: 'h-two-tone' },
  'H5 corners 3톤': { ctx: hCellStyleCtx(encodeH('TL', { version: 5, mode: 3, tones: 3, finder: 'corners', ecc: 'M' }), H_STATE), expect: 'h-corners-finder' },
};

/** 문맥 하나에 대해 선택지 전부를 여는 표(행 = 그 문맥의 표 키 + 모양) — 구조 잠금 «심은 결함» 표. */
function openCellFixture(ctx) {
  const base = cellShapeAllowCtx(ctx);
  return deepFreeze({
    ROWS: cellChoices().filter((c) => !isCellDefault(c)).map((c) => {
      const def = CELL_SHAPE_PARAMS[c.cellShape];
      return { ...base, cellShape: c.cellShape, param: def ? c[def.key] : null };
    }),
  });
}
function openHFixture(ctx) {
  return deepFreeze({
    ROWS: hChoices().filter((c) => !isHDefault(c)).map((c) => {
      const row = { table: 'h', hCellStyle: c.hCellStyle, ground: c.hCellGround };
      for (const k of H_CELL_STYLE_ALLOW_KEYS) if (k !== 'ground') row[k] = ctx[k];
      return row;
    }),
  });
}
const OPEN_QR = deepFreeze({
  ROWS: QR_HOSTS.flatMap((host) => optionsOf('qrCellStyle').flatMap((qrCellStyle) => optionsOf('qrColorMode')
    .flatMap((qrColorMode) => optionsOf('qrEye').map((eyeMode) => ({ table: 'qr', host, qrCellStyle, qrColorMode, eyeMode }))))),
});

// ── ① 허용표 내부 일관성 ─────────────────────────────────────────────────

const SHAPE_KEYS = Object.freeze({
  oak: ['cellShape', 'param'], y: ['cellShape', 'param'], h: ['hCellStyle'], qr: [],
});
const TABLE_KEYS = Object.freeze({
  oak: CELL_SHAPE_ALLOW_KEYS.oak, y: CELL_SHAPE_ALLOW_KEYS.y, h: H_CELL_STYLE_ALLOW_KEYS, qr: QR_ALLOW_KEYS,
});

/** 허용표 결함 목록(빈 배열 = 일관). */
function tableProblems(allow) {
  const out = [];
  if (!Array.isArray(allow.ROWS)) return ['ROWS 가 배열이 아니다'];
  const meta = [allow.RECEIPT_SHA256, allow.MEASURED_AT, allow.FINGERPRINT];
  if (!(meta.every((v) => v === null) || meta.every((v) => v !== null && v !== undefined))) out.push('영수증 sha · 측정 시각 · 지문은 셋이 함께 있거나 함께 없어야 한다');
  if (allow.RECEIPT_SHA256 !== null) {
    if (!/^[0-9a-f]{64}$/.test(String(allow.RECEIPT_SHA256))) out.push('RECEIPT_SHA256 이 sha256 hex 가 아니다');
    if (Number.isNaN(Date.parse(String(allow.MEASURED_AT)))) out.push('MEASURED_AT 이 ISO 시각이 아니다');
    if (!allow.FINGERPRINT || typeof allow.FINGERPRINT.head !== 'string') out.push('FINGERPRINT.head 가 없다');
  } else if (allow.ROWS.length > 0) out.push('행이 있는데 영수증이 없다');
  const seen = new Set();
  allow.ROWS.forEach((row, i) => {
    const where = `ROWS[${i}]`;
    const keys = TABLE_KEYS[row && row.table];
    if (!keys) { out.push(`${where}: 모르는 표 ${row && row.table}`); return; }
    const want = ['table', ...keys, ...SHAPE_KEYS[row.table]].sort();
    const got = Object.keys(row).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${where}: 키 ${got} ≠ ${want}`);
    if (Object.values(row).some((v) => v !== null && typeof v === 'object')) out.push(`${where}: 원시값이 아닌 값`);
    const sig = JSON.stringify(want.map((k) => row[k]));
    if (seen.has(sig)) out.push(`${where}: 중복 행`);
    seen.add(sig);
    if (row.table === 'oak' || row.table === 'y') {
      if (row.cellShape === CELL_SHAPE_DEFAULT || !CELL_SHAPES.includes(row.cellShape)) out.push(`${where}: cellShape ${row.cellShape}`);
      const def = CELL_SHAPE_PARAMS[row.cellShape];
      if (def ? !def.domain.includes(row.param) : row.param !== null) out.push(`${where}: param ${row.param}`);
      if (cellShapeStructuralLock(row.table, row.cellShape, row.param, row) !== null) out.push(`${where}: 구조 잠금에 걸린 죽은 행`);
    } else if (row.table === 'h') {
      if (!SQUARE_CELL_STYLES.includes(row.hCellStyle) || row.hCellStyle === D.hCellStyle.defaultValue) out.push(`${where}: hCellStyle ${row.hCellStyle}`);
      if (row.tones === 2 || row.finder === 'corners') out.push(`${where}: 구조 잠금에 걸린 죽은 행(H)`);
    } else {
      if (QR_LOCKED_HOSTS.includes(row.host)) out.push(`${where}: 구조 잠금 호스트 ${row.host} 의 죽은 행`);
      if (!QR_HOSTS.includes(row.host)) out.push(`${where}: host ${row.host}`);
    }
  });
  return out;
}

test('① 허용표 내부 일관성 · 지문 — 기본 표(생성본)와 주입 스텁 표 둘 다 결함 0', () => {
  assert.deepEqual(tableProblems(DEFAULT_ALLOW), []);
  assert.ok(Object.isFrozen(DEFAULT_ALLOW.ROWS));
  if (DEFAULT_ALLOW.ROWS.length === 0) assert.equal(DEFAULT_ALLOW.RECEIPT_SHA256, null, '빈 기본 표: 영수증 없음');
  // 스텁 모양(빈 표 · 메타 셋 다 null)도 일관이다 — 판정 함수가 «행 0 = 영수증 없음» 을 허용한다.
  assert.deepEqual(tableProblems(STUB), []);
  assert.equal(STUB.ROWS.length, 0);
});

test('① 판정 함수 판별력 — 심은 결함 표마다 해당 결함을 잡는다', () => {
  const okOak = { table: 'oak', ...cellShapeAllowCtx(CTXS['O n7 TL'].ctx), cellShape: 'round', param: 0.7 };
  const receipt = { RECEIPT_SHA256: 'a'.repeat(64), MEASURED_AT: '2026-09-26T00:00:00Z', FINGERPRINT: { head: 'x' } };
  assert.deepEqual(tableProblems({ ROWS: [okOak], ...receipt }), [], '대조군: 정상 행 + 영수증');
  const plants = [
    ['행 있는데 영수증 없음', { ROWS: [okOak], RECEIPT_SHA256: null, MEASURED_AT: null, FINGERPRINT: null }],
    ['메타 셋 불일치', { ROWS: [], RECEIPT_SHA256: 'a'.repeat(64), MEASURED_AT: null, FINGERPRINT: null }],
    ['키 빠짐', { ROWS: [(() => { const r = { ...okOak }; delete r.qrPosition; return r; })()], ...receipt }],
    ['여분 키', { ROWS: [{ ...okOak, role: 'data' }], ...receipt }],
    ['중복', { ROWS: [okOak, { ...okOak }], ...receipt }],
    ['도메인 밖 param', { ROWS: [{ ...okOak, param: 0.5 }], ...receipt }],
    ['구조 잠금 죽은 행(C)', { ROWS: [{ ...okOak, type: 'C' }], ...receipt }],
    ['구조 잠금 죽은 행(bevel 1.4)', { ROWS: [{ ...okOak, cellShape: 'bevel', param: 1.4 }], ...receipt }],
    ['구조 잠금 죽은 행(Y 호스트 QR)', { ROWS: [{ table: 'qr', host: 'y', qrCellStyle: 'dots', qrColorMode: 'custom', eyeMode: 'none' }], ...receipt }],
    ['구조 잠금 죽은 행(H 2톤)', { ROWS: [{ table: 'h', version: 2, finder: 'frame', tones: 2, ground: 'level5', paletteGrade: 'slate', hCellStyle: 'dots' }], ...receipt }],
  ];
  for (const [name, table] of plants) assert.ok(tableProblems(table).length > 0, `심은 결함을 못 잡았다: ${name}`);
});

// ── ② · ③ · ④ 선택지 분류 ─────────────────────────────────────────────────

const REASON_IDS = new Set(DECORATION_LOCK_REASON_IDS);

function assertClassified(res, isDefault, key, where) {
  const val = res[key];
  if (isDefault) {
    assert.deepEqual(res, { [key]: null }, `${where}: 기본값은 사유 없는 null`);
    return 'default';
  }
  if (val !== null) {
    assert.equal(res.lockReason, undefined, `${where}: 허용인데 사유가 붙었다`);
    return 'allowed';
  }
  assert.ok(REASON_IDS.has(res.lockReason), `${where}: 잠금 사유 ${res.lockReason} 가 안정 id 목록에 없다`);
  return 'locked';
}

test('② 빈 표(스텁 주입): 셀 모양 선택지 전부 × 대표 문맥 전부 → 기본값이거나 «잠금 + 사유» · 상태 불변', () => {
  const choices = cellChoices();
  assert.equal(choices.length, 1 + 3 + 2 + 1 + 2 + 2, '스키마 유도 선택지 수(모양 × 강도)');
  for (const [name, { ctx }] of Object.entries(CTXS)) {
    assert.ok(ctx, `${name}: 문맥 null`);
    for (const c of choices) {
      const st = deepFreeze({ ...FRESH, ...c });
      const before = JSON.stringify(st);
      const res = resolveCellShapeSpec(st, ctx, STUB);
      const kind = assertClassified(res, isCellDefault(c), 'spec', `${name} ${JSON.stringify(c)}`);
      assert.notEqual(kind, 'allowed', `${name} ${JSON.stringify(c)}: 빈 표에서 열렸다`);
      // 반사실: 빈 표에서는 측정 구성으로 바꿔도 열 행이 없다 — «자리 · ECC 탓» 은 틀린 안내다(2026-09-27 검토).
      assert.ok(![CELL_SHAPE_LOCK_REASONS.SEAT_CONFIG, CELL_SHAPE_LOCK_REASONS.ECC_LEVEL].includes(res.lockReason),
        `${name} ${JSON.stringify(c)}: 행이 없는데 측정 구성 사유 ${res.lockReason}`);
      assert.equal(JSON.stringify(st), before);
    }
  }
});

test('③ 구조 잠금: 그 행을 넣은 표로도 잠긴다 · 기대 사유와 정확히 같다 · 나머지는 열린다(판별력)', () => {
  const hit = new Set();
  for (const [name, { ctx }] of Object.entries(CTXS)) {
    const open = openCellFixture(ctx);
    for (const c of cellChoices().filter((x) => !isCellDefault(x))) {
      const st = deepFreeze({ ...FRESH, ...c });
      const res = resolveCellShapeSpec(st, ctx, open);
      const want = expectedStructural(name, c);
      const where = `${name} ${JSON.stringify(c)}`;
      if (want === null) {
        const def = CELL_SHAPE_PARAMS[c.cellShape];
        assert.deepEqual(res, { spec: { kind: c.cellShape, param: def ? c[def.key] : null } }, `${where}: 행이 있는데 안 열렸다`);
      } else {
        assert.deepEqual(res, { spec: null, lockReason: want }, `${where}: 구조 잠금이 아니다`);
        // unmeasured 는 구조 잠금 사유가 아니다(측정 상태가 반사실을 거둔 문맥) — 구조 잠금 사유 전부가 났는지만 모은다.
        if (CELL_SHAPE_STRUCTURAL_LOCK_REASONS.includes(want)) hit.add(want);
      }
    }
  }
  // 윈도 β 는 2톤이 먼저 잡는다 — qrWindow 단독 경로는 문맥 한 키만 뒤집어 잰다(실제 인코딩은 3톤 윈도가 없다).
  const v0 = CTXS['Y v0 3톤(흰 평탄화)'].ctx;
  const winOnly = { ...v0, qrWindow: true };
  assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, winOnly, openCellFixture(v0)).lockReason, CELL_SHAPE_LOCK_REASONS.Y_INNER_QR);
  assert.deepEqual(resolveCellShapeSpec({ cellShape: 'bevel' }, v0, openCellFixture(v0)), { spec: { kind: 'bevel', param: 0.6 } });
  hit.add(CELL_SHAPE_LOCK_REASONS.Y_INNER_QR);
  assert.deepEqual([...hit].sort(), [...CELL_SHAPE_STRUCTURAL_LOCK_REASONS].sort(), '모든 구조 잠금 사유가 실제 문맥에서 난다');
});

test('③ 구조 잠금 문맥 키가 빠지면 잠근다(fail-closed) — 추측으로 열지 않는다', () => {
  const v0 = CTXS['Y v0 3톤(흰 평탄화)'].ctx;
  assert.ok(['qrPosition', 'qrWindow', 'qrSlot'].every((k) => CELL_SHAPE_LOCK_CTX_KEYS.y.includes(k)));
  assert.ok(CELL_SHAPE_MEASURED_CONFIG_KEYS.y.includes('eccLevel'));
  for (const k of [...CELL_SHAPE_LOCK_CTX_KEYS.y, ...CELL_SHAPE_MEASURED_CONFIG_KEYS.y, ...CELL_SHAPE_ALLOW_KEYS.y]) {
    const ctx = { ...v0 };
    delete ctx[k];
    assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, ctx, openCellFixture(v0)).lockReason, CELL_SHAPE_LOCK_REASONS.CTX_INCOMPLETE, k);
  }
  // oak 측정 구성 키(코너 마커 · 사괘 · ECC · 실효 검출 강조)도 같다 — 값 모름은 측정 구성과 «같다» 로 읽지 않는다.
  const a = CTXS['A n7(자동 a-cm)'].ctx;
  assert.deepEqual([...CELL_SHAPE_MEASURED_CONFIG_KEYS.oak].sort(), ['cornerMarker', 'detectorEmphasis', 'eccLevel', 'sagoae']);
  // 설계 잠금 문맥 키(하네스 계약)에 측정 구성 키를 섞지 않는다 — 섞으면 L0 하네스가 «키 드리프트» 로 멈춘다(⑥).
  assert.deepEqual([...CELL_SHAPE_LOCK_CTX_KEYS.oak], []);
  // type 은 표를 고르는 키라 빠지면 type-not-rhombus 다(표 선택이 문맥 완전성보다 먼저) — 여기서는 뺀다.
  for (const k of [...CELL_SHAPE_MEASURED_CONFIG_KEYS.oak, ...CELL_SHAPE_ALLOW_KEYS.oak.filter((x) => x !== 'type')]) {
    const ctx = { ...a };
    delete ctx[k];
    assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, ctx, openCellFixture(a)).lockReason, CELL_SHAPE_LOCK_REASONS.CTX_INCOMPLETE, 'oak ' + k);
  }
  // gapGrade 는 렌더 뒤 값 — render 가 없으면 잠긴다.
  const noRender = cellShapeCtx('Y', yEnc('cell-surface-v0', 3), { ...FRESH, bgMode: 'white' });
  assert.equal(noRender.gapGrade, undefined);
  assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, noRender, openCellFixture(v0)).lockReason, CELL_SHAPE_LOCK_REASONS.CTX_INCOMPLETE);
});

test('② · ③ H: 빈 표(스텁 주입) 전부 잠금 · 열림 표에서도 2톤 · corners 는 구조 잠금 · 상태 불변', () => {
  const hit = new Set();
  for (const [name, { ctx, expect }] of Object.entries(H_CTXS)) {
    const open = openHFixture(ctx);
    for (const c of hChoices()) {
      const st = deepFreeze({ ...H_STATE, ...c });
      const before = JSON.stringify(st);
      const where = `${name} ${JSON.stringify(c)}`;
      const stub = assertClassified(resolveHCellStyleSpec(st, ctx, STUB), isHDefault(c), 'spec', where);
      assert.notEqual(stub, 'allowed', where);
      const res = resolveHCellStyleSpec(st, ctx, open);
      assertClassified(res, isHDefault(c), 'spec', where);
      if (!isHDefault(c)) {
        if (expect === null) assert.deepEqual(res.spec, { style: c.hCellStyle, ground: c.hCellGround }, where);
        else { assert.deepEqual(res, { spec: null, lockReason: expect }, where); hit.add(expect); }
      }
      assert.equal(JSON.stringify(st), before);
    }
  }
  assert.deepEqual([...hit].sort(), [H_CELL_STYLE_LOCK_REASONS.CORNERS_FINDER, H_CELL_STYLE_LOCK_REASONS.TWO_TONE].sort());
});

test('② · ③ 폴백 QR: 선택지 전부 × 호스트 3 — 빈 표(스텁 주입) 전부 잠금 · 열림 표에서 y 호스트만 구조 잠금 · 상태 불변', () => {
  const choices = qrChoices();
  assert.ok(choices.length > 100, '스키마 유도 선택지');
  let yLocked = 0;
  for (const host of QR_HOSTS) {
    for (const c of choices) {
      const st = deepFreeze({ ...FRESH, ...c });
      const before = JSON.stringify(st);
      const where = `${host} ${JSON.stringify(c)}`;
      const stub = assertClassified(resolveQrDeco(st, SLATE, host, STUB), isQrDefault(c), 'deco', where);
      assert.notEqual(stub, 'allowed', where);
      const res = resolveQrDeco(st, SLATE, host, OPEN_QR);
      const kind = assertClassified(res, isQrDefault(c), 'deco', where);
      if (!isQrDefault(c)) {
        if (QR_LOCKED_HOSTS.includes(host)) {
          assert.equal(res.lockReason, QR_DECO_LOCK_REASONS.Y_HOST, where);
          yLocked += 1;
        } else {
          assert.equal(kind, 'allowed', `${where}: 열림 표 · 대비 가드 안인데 잠겼다(${res.lockReason})`);
        }
      }
      assert.equal(JSON.stringify(st), before);
    }
  }
  assert.ok(yLocked > 0);
  assert.deepEqual([...QR_DECO_STRUCTURAL_LOCK_REASONS], [QR_DECO_LOCK_REASONS.Y_HOST]);
});

test('안정 사유 id: 모듈별 사유 전부가 합집합 목록에 있고 중복 없는 문자열이다', () => {
  const all = [
    ...Object.values(CELL_SHAPE_LOCK_REASONS), ...Object.values(H_CELL_STYLE_LOCK_REASONS), ...Object.values(QR_DECO_LOCK_REASONS),
  ];
  for (const r of all) assert.ok(REASON_IDS.has(r), r);
  assert.equal(new Set(DECORATION_LOCK_REASON_IDS).size, DECORATION_LOCK_REASON_IDS.length);
  for (const r of DECORATION_LOCK_REASON_IDS) assert.match(r, /^[a-z0-9-]+$/, r);
  for (const r of CELL_SHAPE_STRUCTURAL_LOCK_REASONS) assert.ok(Object.values(CELL_SHAPE_LOCK_REASONS).includes(r), r);
});

// ── ⑤ 정규화 ──────────────────────────────────────────────────────────────

test('⑤ 상태 정규화: 도메인 안은 그대로 · 부재/문자열/범위 밖/정수 아님 → 기본값', () => {
  for (const key of DECORATION_STATE_KEYS) {
    const d = D[key];
    assert.equal(GENERATOR_STATE_SCHEMA[key].exposure, 'both', `${key}: 노출 BOTH(§2.2)`);
    const valid = d.kind === 'enum' ? d.values : [...d.samples, d.min + 1, d.max - 1, Math.floor((d.min + d.max) / 2)];
    for (const v of valid) assert.equal(normalizeDecorationValue(key, v), v, `${key}=${v}`);
    const bad = [undefined, null, NaN, Infinity, {}, [], true, 'square', String(valid[0])];
    if (d.kind === 'int') bad.push(d.min - 1, d.max + 1, d.min + 0.5);
    else bad.push('nope', 0.5, 999);
    for (const v of bad) {
      if (d.kind === 'enum' && d.values.includes(v)) continue;
      assert.equal(normalizeDecorationValue(key, v), d.defaultValue, `${key}=${String(v)} → 기본값`);
    }
  }
  assert.throws(() => normalizeDecorationValue('bgMode', 'white'), RangeError);
  // 복원 입력 경로(createGeneratorState)도 같은 정규화를 탄다.
  const s = createGeneratorState({ customSat: '150', qrHue: 400, qrSat: -5, cellRound: 0.5, qrEye: 'glow', hCellGround: 'grey' });
  for (const k of ['customSat', 'qrHue', 'qrSat', 'cellRound', 'qrEye', 'hCellGround']) assert.equal(s[k], D[k].defaultValue, k);
  // 입력은 고치지 않는다.
  const input = deepFreeze({ customSat: 999, preset: 'slate' });
  const out = normalizeDecorationState(input);
  assert.equal(input.customSat, 999);
  assert.equal(out.customSat, D.customSat.defaultValue);
  assert.equal(out.preset, 'slate');
});

test('⑤ 정규화를 거친 채도로는 makeCustomPalette 가 RangeError 를 내지 않는다(L1 도메인 가드를 UI 가 못 만난다)', () => {
  const fuzz = [undefined, '120', -1, 0, 1, 99.5, 100, 150, 200, 201, 1e9, NaN, null, -Infinity];
  for (const raw of fuzz) {
    const sat = normalizeDecorationValue('customSat', raw);
    assert.doesNotThrow(() => makeCustomPalette(210, 'custom', sat), String(raw));
  }
  // 대조: 정규화 없이 넣으면 던진다(가드가 실제로 있다 — 공허한 초록 아님).
  assert.throws(() => makeCustomPalette(210, 'custom', 201), RangeError);
  // 팔레트 등급 키(preset)는 이 표의 소관이 아니다 — 프리셋 목록이 스키마 허용값과 같은지만 본다.
  assert.deepEqual(GENERATOR_STATE_SCHEMA.preset.options, [...Object.keys(PRESETS), 'custom']);
});

// ── ⑥ 생성기 상태 → QR 호스트 · UI 입력 경로 (검토 지적 D1-major · minor 1, 2026-09-26) ──────────────

test('⑥ 생성기 상태 → QR 호스트: H(Y+3d) 는 h — 셀 모양 · H 판정과 같은 격자 · h 행 하나로 실제로 열린다', () => {
  // 생성기 상태의 H 는 type 'Y' + yRepresentation '3d' 다(GENERATOR_TYPES 에 'H' 없음). 격자 = 타입 × 표현 선택지(스키마 유도).
  assert.ok(!GENERATOR_TYPES.includes('H'));
  const reps = GENERATOR_STATE_SCHEMA.yRepresentation.options;
  let hSeen = 0;
  for (const type of GENERATOR_TYPES) {
    for (const yRepresentation of reps) {
      const st = createGeneratorState({ type, yRepresentation });
      const host = qrDecoHostOf(st.type, st);
      const where = `${type}/${yRepresentation}`;
      assert.ok(QR_HOSTS.includes(host), where);
      // 세 판정의 일치: qrDecoHostOf 'h' ⇔ isHGenerator ⇔ (Y 이면서) cellShapeTypeOf === null.
      assert.equal(host === 'h', isHGenerator(st), where);
      assert.equal(host === 'h', type === 'Y' && cellShapeTypeOf(st.type, null, st) === null, where);
      assert.equal(host === 'y', type === 'Y' && !isHGenerator(st), where);
      if (host === 'h') hSeen += 1;
    }
  }
  assert.ok(hSeen > 0, 'H 상태가 격자에 있다');
  // 끝단: H 상태 + 비기본 QR 선택 + «h 호스트 행 하나» 만 있는 표 → 꾸밈이 실제로 나온다(qr-y-host 가 아니다).
  // 호스트를 'y' 로 보내면 구조 잠금, 'oak' 로 보내면 qr-unmeasured 로 빨개진다.
  const hState = deepFreeze(createGeneratorState({ type: 'Y', yRepresentation: '3d', qrCellStyle: 'dots' }));
  const onlyH = deepFreeze({ ROWS: [{ table: 'qr', host: 'h', qrCellStyle: 'dots', qrColorMode: 'default', eyeMode: 'none' }] });
  const r = resolveQrDeco(hState, SLATE, qrDecoHostOf(hState.type, hState), onlyH);
  assert.notEqual(r.lockReason, QR_DECO_LOCK_REASONS.Y_HOST);
  assert.equal(r.deco && r.deco.cellStyle, 'dots', JSON.stringify(r));
  // 같은 선택의 Y 2.5D 는 구조 잠금 그대로(양성 단언).
  const yState = deepFreeze(createGeneratorState({ type: 'Y', yRepresentation: '2.5d', qrCellStyle: 'dots' }));
  assert.equal(resolveQrDeco(yState, SLATE, qrDecoHostOf(yState.type, yState), OPEN_QR).lockReason, QR_DECO_LOCK_REASONS.Y_HOST);
});

test('⑥ 런타임 대비 재단언은 열리는 호스트(oak · h)에서 잰다 · y 는 그보다 먼저 구조 잠금', () => {
  // qr-colors.test 의 런타임 재단언이 y 호스트만 썼다 — 구조 잠금이 앞서 걸리면 가드 경로가 안 지나간다. 여기서 덮는다.
  const bright = deepFreeze({ name: 'slate', label: 'x', background: SLATE.background,
    levels: [{ r: 150, g: 150, b: 150 }, SLATE.levels[1], SLATE.levels[2]] });
  for (const host of QR_HOSTS) {
    const r = resolveQrDeco({ qrColorMode: 'match' }, bright, host, OPEN_QR);
    assert.equal(r.deco, null, host);
    if (QR_LOCKED_HOSTS.includes(host)) { assert.equal(r.lockReason, QR_DECO_LOCK_REASONS.Y_HOST, host); continue; }
    assert.equal(r.lockReason, QR_DECO_LOCK_REASONS.CONTRAST, host);
    assert.ok(r.failures.some((f) => f.gate === 'G4'), host);
    // 대조: 같은 호스트 · 같은 표에서 정상 기저 팔레트면 열린다(가드가 잠금의 원인이다).
    assert.ok(resolveQrDeco({ qrColorMode: 'match' }, SLATE, host, OPEN_QR).deco, host);
  }
});

test('⑥ UI 입력(문자열 .value) → 값: 스키마 선택지 전부가 문자열로 왕복한다 · 빈 값/쓰레기는 기본값', () => {
  let numericKeys = 0;
  let snappedWithoutHelper = 0;
  for (const key of DECORATION_STATE_KEYS) {
    const d = D[key];
    for (const v of optionsOf(key)) {
      assert.equal(decorationValueFromInput(key, String(v)), v, `${key}='${String(v)}'`);
      assert.equal(decorationValueFromInput(key, v), v, `${key}=${String(v)}`);
      // 판별력: 문자열을 곧장 정규화하면 숫자 키의 비기본 선택은 기본값으로 튄다(도우미가 필요한 이유).
      if (typeof v === 'number' && v !== d.defaultValue) {
        assert.equal(normalizeDecorationValue(key, String(v)), d.defaultValue, key);
        snappedWithoutHelper += 1;
      }
    }
    const numeric = optionsOf(key).every((v) => typeof v === 'number');
    if (numeric) numericKeys += 1;
    for (const junk of ['', '  ', 'abc', 'NaN', '1e999']) {
      assert.equal(decorationValueFromInput(key, junk), d.defaultValue, `${key}='${junk}'`);
    }
    if (d.kind === 'int') {
      assert.equal(decorationValueFromInput(key, String(d.max + 1)), d.defaultValue, key);
      assert.equal(decorationValueFromInput(key, String(d.min + 0.5)), d.defaultValue, key);
    }
  }
  assert.ok(numericKeys >= 8, `숫자 키 ${numericKeys}`);
  assert.ok(snappedWithoutHelper > 0);
  assert.throws(() => decorationValueFromInput('bgMode', 'white'), RangeError);
  // 도우미를 거친 채도는 L1 가드를 못 만난다.
  for (const raw of ['', '201', '-1', '150', '99.5']) {
    assert.doesNotThrow(() => makeCustomPalette(210, 'custom', decorationValueFromInput('customSat', raw)), raw);
  }
});
