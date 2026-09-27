/**
 * decoration-ui.test.js — 셀 꾸미기 · 채도 · 폴백 QR 꾸미기의 **화면 배선** 계약 (DESIGN_001 §4.2 ⓐ–ⓗ · §6 · §7.5).
 *
 * 무엇을 재나 (성질 — 철자가 아니라 실제 index.html 함수를 vm 에서 돌려 잰다):
 *   ① 선택지는 상태 스키마에서 유도된다 — 카드 줄의 값 = DECORATION_STATE_DOMAINS 의 열거, 슬라이더 폭 = 정수 도메인.
 *      화면 자리(#${key}Cards · #${key}Bar)나 라벨이 빠지면 로드 시점에 던진다(심은 결함으로 확인).
 *   ② 빈 허용표(스텁 모양을 **주입** — 제품 기본표는 2026-09-27 부터 L6 생성본)에서는 보이는 **모든** 꾸미기 카드가
 *      잠금 + aria-disabled + 인라인 사유 한 줄(툴팁 title 아님)이다. «끔» 카드는 언제나 눌린다.
 *      제품 기본표(생성본)에서는 셀 모양 카드 열림 ⇔ «렌더 문맥에 맞는 표 행이 있다» 이고(행은 표에서 유도 — 박제 없음),
 *      제품 기본 Y(투명 배경 · 판 없음)에서 하나 이상 열려 그 카드는 사유 없이 생산자까지 간다.
 *      자리 · ECC 가 측정 구성(cell-shape CELL_SHAPE_MEASURED_CONFIG — A · K · G 자동 코너 마커 · 사괘 없음 · ECC H)과 다르면
 *      표 키가 같아도 전부 잠기고, 매퍼가 사괘를 떨군 조합은 열린 채다(2026-09-27). 사유는 반사실이다 — 측정 구성에서
 *      열리던 카드만 «자리 · ECC 탓»(seat-config g1209 · ecc-level g1210), 측정 구성에서도 잠기던 카드는 그 사유 그대로.
 *      ECC 탓은 실현 조건까지 참일 때만이다(2026-09-28) — auto 가 M 으로 내려간 길이(같은 표 키에 H 가 안 들어감)는 g1162.
 *      자리 탓도 같다(2026-09-28 착지 검토) — A 바깥 «없음» 79–80 B 는 코너 마커면 v2 H 에 안 들어가 g1162. 표 키의 측정 밴드 밖
 *      (버전 고정 · Y 로케이터 직접 선택의 짧은 페이로드)은 구성이 측정과 같아도 잠긴다(g1162). Y 면 게인(큐브 입체감)이 측정(화면용)과
 *      다르면 face-gain(g1212)으로 잠긴다 — 게인은 index.html 실물 함수(currentFaceGains)로 만든다(옛 하네스의 박제 게인 .57 은 걷었다).
 *      실효 검출 강조(2026-09-27)도 같은 규칙이다 — 생산자에 넘어간 강조가 측정(O/A/K 'all' · Y 미전달)과 다른 그림이면
 *      잠기고(detector-emphasis g1211), 강조를 소비하는 표면이 없으면 무엇을 골라도 강조로는 안 잠긴다. Y 는 고급 화면에서만 넘긴다.
 *      내보내기 축(2026-09-28 외부 검토 major 셋): 지금 내보내기 계획이 디더(양자화)거나 고정 · 커스텀 크기의 ppu 가 그 표 키의 잰
 *      하한(MEASURED_FLOORS) 아래면 열리던 카드가 export-dither(g1213) · export-size(g1214)로 잠기고 미리보기도 사각이다(자동 크기는
 *      안 잠근다 · 24비트는 항등). 사유 축이 둘 이상 다르면 미확인(g1162 — 어느 한 축만 되돌려서는 안 열린다), 하나면 그 축. Y 디더가
 *      바꾼 면 게인은 디더 한 축이다. 내보내기 장면 = 미리보기 장면(잠긴 렌더 = 꾸미기 끈 렌더 · 셀 모양은 장면 치수를 안 바꾼다) ·
 *      잰 하한 키 = index.html 내보내기 계획이 minRoundtripPpu 에 넘긴 호출 모양의 키.
 *      하네스 상태는 제품 기본을 따른다 — ECC auto · A/K 자동 자리(productAutoSeats) · 강조 'all'. O 는 안쪽 «없음»(실효 타입 O 의
 *      측정 구성). 제품 자동 O(안쪽 o-cm → 실효 타입 G · G 측정 구성)는 ② 제품 기본표 자가 제품 기본 URL 로도 잰다.
 *      G(버전 V2 고정)도 자리 · ECC · 강조 쌍 자에 든다(사유 문구의 참/거짓 — 제품이 가장 먼저 보이는 표면).
 *      타입 키는 카드를 가른다 — 같은 비-type 문맥의 형제 타입 행만 주입한 표는 빈 표와 같게 보이고, 같은 행을 자기 타입으로
 *      적으면 열린다(O 자동 = G ↔ O · A ↔ K). ② 제품 기본표 자의 «열림 ⇔ 표 행» 은 type 키로 거른 뒤라 이것을 못 잰다.
 *   ③ 기본 상태에서는 어떤 타입(O · A · K · Y · H)도 생산자에 꾸미기 키를 넘기지 않는다 — sceneOpts.cellShape ·
 *      palette.qrDeco · hQr.deco · hCellStyle 부재(D1 이 넘긴 «이름 붙인 미측정 축»). 켬 → 끔 클릭 경로 뒤에도.
 *   ④ fixture 허용표를 주입하면(테스트 전용 경로 — decorationAllow 만 바꾼다) 카드가 열리고, 카드를 누르면
 *      실제 렌더 함수가 spec · deco 를 생산자까지 나르고 미리보기 scene 이 바뀐다 — **K 수동 조립 · Y · H** 포함.
 *      K 수동 경로에서 spec 대입 줄을 지우면 이 자가 빨개지는지 같은 파일에서 확인한다(심은 결함).
 *      파생값 트리거 — 내보내기 크기 · 커스텀 폭 · 여백 없음 · 디더가 바뀌면 문서 이벤트 한 곳(index.html)이 렌더를 예약하고 카드 · 미리보기가
 *      다시 판정된다(안 바뀌면 예약 없음). 트리거 배선 · 두 번째 렌더를 지운 심은 결함이 각각 잡힌다.
 *   ⑤ 잠금 사유 id(세 resolver 합집합)가 전부 사전 키로 매핑되고, 쓰는 키가 8언어에 모두 있다.
 *   ⑥ data-state-keys 배치 — 꾸미기 14키는 #sharedControls, customSat 은 customHue 와 같은 두 패널(D1 이양 자).
 *   ⑦ Canvas drawScene 이 noSeam 도형에 seam stroke 를 긋지 않는다(svg.js 와 같은 조건).
 *   ⑧ 파일명 꼬리표 — 기본이면 빈 문자열, 켜면 렌더된 것에서 읽는다.
 *
 * ⚠ 이 자가 못 재는 축: 실제 브라우저의 CSS(흐림 · pointer-events) · 모바일 표시, 그리고 허용표의 측정 사실(영수증은
 *   private — DESIGN_001 §7.6). fixture 는 «배선이 닿는가» 만 증명하고 «안전하다» 는 증명하지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

import {
  DECORATION_LOCK_REASON_IDS, DECORATION_STATE_DOMAINS, DECORATION_STATE_KEYS, createGeneratorState,
  decorationValueFromInput, exposedGeneratorStateKeys, versionStateKey,
} from '../src/generator-state.js';
import {
  CELL_SHAPE_DEFAULT, CELL_SHAPE_DETECTOR_EMPHASIS_NOT_APPLICABLE, CELL_SHAPE_PARAMS, cellShapeAllowCtx, cellShapeCtx,
  cellShapeStructuralLock, resolveCellShapeSpec,
} from '../src/cell-shape.js';
import * as DEFAULT_ALLOW from '../src/cell-shape-allow.js';
import { qrDecoHostOf, resolveQrDeco } from '../src/qr-colors.js';
import {
  H_CELL_GROUND_DEFAULT, H_CELL_STYLE_DEFAULT, hCellStyleCtx, hMaskLuminance, hPreviewOptions, hUiLabel,
  isHGenerator, resolveHCellStyleSpec,
} from '../src/generator-h.js';
import { makeCustomPalette } from '../src/palette-hue.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, getPreset } from '../src/luminance.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { encodeY } from '../src/encodeY.js';
import { encodeH, decodeH } from '../src/h-codec.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY } from '../src/sceneY.js';
import { buildHScene } from '../src/h-render.js';
import {
  withHCornerQr, hFaceQrSummary, hEffectiveQrPosition, hCornerTooCorner,
} from '../src/generator-h-qr.js';
import {
  sceneOptionsForOA, centralN7FamilyForType, centralN7EmphasisAppliesTo, detectorEmphasisRequiresAdvanced,
  centralBeaconEncoderOptions, encodeOptionsForY, detectorEmphasisEquivalents, measuredStateAtTableKey, producerFaceGains,
  cellShapeExportPlan,
} from '../src/generator-render-config.js';
import { faceGainsForRenderProfile } from '../src/render-profile.js';
import {
  EXPORT_DITHER_AUTO, EXPORT_FIXED_SIZES, EXPORT_MARGIN_TRIM, EXPORT_PPI_PRINT, minRoundtripPpu, minRoundtripPpuKey, resolveExportPpi,
  resolveExportSize, resolveRenderProfile, trimExportMargin,
} from '../src/export-options.js';
import { buildTrimmedScene } from '../src/export-render.js';
import { DITHER_BIT_DEPTHS } from '../src/dither.js';
import { daehanPatternId, isDaehanFinderPatternId } from '../src/finder-daehan.js';
import { CENTER_QR_FINDER_PATTERN_ID, isCentralV0FinderPatternId } from '../src/finder-selection.js';
import { isCentralMarkerN7FinderPatternId, centralMarkerN7FamilyForType } from '../src/centralMarkerN7.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';
import {
  LOCATOR_PROFILE_HEX_FRAME_V1, LOCATOR_PROFILE_CELL_SURFACE_V0, isCellSurfaceLocatorProfileY,
} from '../src/locatorY.js';
import { hasCenterQrSlot } from '../src/cellSurfaceFinal.js';
import { detectorEmphasisDetectorId } from '../src/detector-emphasis-ui-model.js';
import { renderWithErrorDisplay } from '../src/render-status.js';
import { hPlanarPreviewOptions, reconcileHPositionMode } from '../src/h-preview-decor.js';
import { TL_READER_URL, tlReaderUrlWithHint } from '../src/qr.js';
import { payloadByteLength } from '../src/header.js';
import { cornerMarkerSeatActive } from '../src/finder-zone-ui.js';
import { autoSeatsFor } from '../src/generator-seat-auto.js';
import { resolveAutoY, resolveVersionForLayout } from '../src/generator-auto-y.js';
import { LOCATOR_PROFILE_CELL_SURFACE_V0TR } from '../src/locatorY.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const LANGS = ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt'];
const ENUM_KEYS = DECORATION_STATE_KEYS.filter((k) => DECORATION_STATE_DOMAINS[k].kind === 'enum');
const INT_KEYS = DECORATION_STATE_KEYS.filter((k) => DECORATION_STATE_DOMAINS[k].kind === 'int');
/** 명시적 빈 표 — «전부 잠금» 스텁 모양(행 0 · 영수증 없음). 하네스 allow 로 주입한다(제품 기본표는 생성본). */
const STUB = Object.freeze({ ROWS: Object.freeze([]), RECEIPT_SHA256: null, MEASURED_AT: null, FINGERPRINT: null });

/** 최상위 함수 하나(열 0 의 `}` 로 닫힌다). */
function fnSource(text, name) {
  const start = text.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, 'index.html 에 function ' + name + ' 이 없다');
  const end = text.indexOf('\n}\n', start);
  return text.slice(start + 1, end + 2);
}

/** 꾸미기 블록 전체(상수 · 함수 · 로드 시점 buildDecorationCards 호출). */
function decorationBlock(text) {
  const start = text.indexOf('// ── 셀 꾸미기 · 채도 · 폴백 QR 꾸미기');
  const call = '\nbuildDecorationCards();\n';
  const end = text.indexOf(call, start);
  assert.ok(start >= 0 && end > start, '꾸미기 블록을 못 찾았다');
  return text.slice(start, end + call.length);
}

function langBlock(lang) {
  const start = INDEX.indexOf('const GENERATOR_STRINGS = {');
  const at = INDEX.indexOf(`\n  ${lang}: {`, start);
  assert.ok(at > start, lang + ' 사전을 못 찾았다');
  const open = INDEX.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < INDEX.length; i += 1) {
    if (INDEX[i] === '{') depth += 1;
    else if (INDEX[i] === '}') { depth -= 1; if (depth === 0) return INDEX.slice(open, i + 1); }
  }
  throw new Error(lang + ' 사전이 닫히지 않는다');
}

// ── 가짜 DOM ─────────────────────────────────────────────────────────────
const HTML_IDS = new Set([...INDEX.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

function makeNode(id = null, tag = 'div') {
  const classes = new Set();
  const attrs = new Map();
  const handlers = new Map();
  const styleProps = new Map();
  return {
    id, tagName: tag.toUpperCase(), hidden: false, children: [], dataset: {}, textContent: '', value: '',
    tabIndex: 0, type: '', className: '', min: '', max: '',
    style: { setProperty(k, v) { styleProps.set(k, v); }, getPropertyValue: (k) => styleProps.get(k) ?? '' },
    classList: {
      toggle(k, on) { if (on === undefined ? !classes.has(k) : on) classes.add(k); else classes.delete(k); },
      contains: (k) => classes.has(k), add: (k) => classes.add(k), remove: (k) => classes.delete(k),
    },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    removeAttribute(k) { attrs.delete(k); },
    hasAttribute: (k) => attrs.has(k),
    addEventListener(kind, cb) { if (!handlers.has(kind)) handlers.set(kind, []); handlers.get(kind).push(cb); },
    dispatch(kind) { for (const cb of handlers.get(kind) ?? []) cb({ preventDefault() {} }); },
    append(...items) { this.children.push(...items); },
  };
}

/**
 * vm 하네스 — 실제 index.html 의 꾸미기 블록 · paletteOf · buildConfig · 렌더 함수 · render · 재렌더 훅을 꽂는다.
 * 생산자(buildScene · buildSceneY · buildHScene · withHCornerQr)는 실제 함수를 감싸 받은 옵션을 기록한다.
 * autoLocatorY: 제품의 Y 로케이터 자동 정책(index.html `resolveAutoLocatorProfileY` · `resolveAutoYSafe` — 실물 함수)을
 *   이 하네스 상태에 적용한다. 제품은 detectorAutoY = true 가 기본이라 Y 상태의 locatorProfileY 는 스키마 기본('off')이 아니라
 *   이 정책의 값이다. (QR 위치 파생 `deriveYLocatorForQrPosition` 은 inner · v0T/v0TR 계열에만 손대므로 싣지 않는다 —
 *   그 계열이 나오면 아래에서 던진다.)
 * payload: 일반 모드 페이로드(index.html `normalPayloadText` 스텁의 반환). 기본은 짧은 자 전용 문자열이고, 제품 기본 URL
 *   (`PRODUCT_DEFAULT_PAYLOAD`)로 제품 화면의 버전 · 셀 역할을 재현할 때만 준다.
 * @param {{state?: object, allow?: object, source?: string, missingIds?: string[], quietColor?: string, autoLocatorY?: boolean, payload?: string}} opts
 */
function harness({ state = {}, allow, source = INDEX, missingIds = [], quietColor = 'white', autoLocatorY = false, payload = 'decoration-ui' } = {}) {
  const nodes = new Map();
  const $ = (id) => {
    if (missingIds.includes(id) || !HTML_IDS.has(id)) return null;
    if (!nodes.has(id)) nodes.set(id, makeNode(id));
    return nodes.get(id);
  };
  // ECC 는 제품 기본(스키마 기본 'auto' — H → M → L 로 처음 들어가는 레벨)을 쓴다. 옛 하네스는 'M' 을 박아 두었는데,
  // 허용표 행은 ECC H 에서 잰 사실이라(측정 구성 — cell-shape CELL_SHAPE_MEASURED_CONFIG) M 은 측정 밖 구성이다.
  const generatorState = createGeneratorState({ qrPosition: 'TL', ...state });
  const calls = { buildScene: [], buildSceneY: [], buildHScene: [], withHCornerQr: [], draws: [], minRoundtripPpu: [] };
  const pending = [];
  // 문서 수준 이벤트 청취자(index.html 셀 꾸미기 내보내기 축의 파생값 트리거) — 테스트가 이벤트를 흘려 본다(dispatchDocument).
  const docListeners = new Map();
  const c = {
    console, Math, Number, String, Object, Array, Set, Map, JSON, Error, RangeError, TypeError, structuredClone,
    generatorState, current: null, keptPayload: null, hFaceImages: Object.freeze({}), hFacePositionMode: 'off',
    hPositionProfile: null, lastEncodedYn: 0, lastEncodedKA: 0, lastEncodedKO: 0, quietColorAtRender: null,
    quietAutoRerenders: 0, QUIET_AUTO_RERENDER_LIMIT: 2,
    y3dPreview: { on: true, pad: 24 }, Y3D_PAD_BASE: 24, hAnimation: { elapsed: 0, scene: null },
    document: {
      createElement: (tag) => makeNode(null, tag),
      addEventListener(kind, cb) { if (!docListeners.has(kind)) docListeners.set(kind, []); docListeners.get(kind).push(cb); },
    },
    window: { devicePixelRatio: 1 },
    $, els: new Proxy({}, { get: (o, k) => $(String(k)) ?? makeNode(String(k)) }),
    t: (key) => key, tf: (key, vars) => key + JSON.stringify(vars),
    hText: (key) => hUiLabel(key, 'ko'),
    // 모듈 (실물)
    DECORATION_STATE_DOMAINS, decorationValueFromInput, CELL_SHAPE_DEFAULT, CELL_SHAPE_PARAMS, cellShapeCtx,
    resolveCellShapeSpec, qrDecoHostOf, resolveQrDeco, hCellStyleCtx, resolveHCellStyleSpec, H_CELL_STYLE_DEFAULT,
    H_CELL_GROUND_DEFAULT, makeCustomPalette, getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT,
    // H 경로(renderTypeH · hSceneOptions · 영상)는 decorationAllow 를 부르지 않고 hPreviewOptions 의 기본 허용표를 쓴다 —
    // 그 셋은 다른 자(generator-h-qr-state 등)의 vm 하네스가 그대로 꺼내 돌리므로 새 이름을 들일 수 없다. 제품에서는
    // decorationAllow() 가 undefined(= 같은 기본표)라 둘이 같다. 그래서 이 하네스는 같은 fixture 를 hPreviewOptions 이음매에도
    // 넣는다(주입 지점 두 곳 = 제품이 표를 읽는 곳 두 곳).
    hPreviewOptions: (state, options = {}) => hPreviewOptions(state, { allow: c.decorationAllow(), ...options }),
    hMaskLuminance, encode, encodeA, encodeK, encodeY, encodeH, decodeH, sceneOptionsForOA, centralN7FamilyForType,
    centralN7EmphasisAppliesTo, detectorEmphasisRequiresAdvanced, centralBeaconEncoderOptions, encodeOptionsForY,
    detectorEmphasisEquivalents, measuredStateAtTableKey, producerFaceGains, cellShapeExportPlan,
    // 면 게인 — index.html 의 실물 함수(exportDitherBits · resolvedRenderProfile · profileFaceGains · currentFaceGains)를 아래에서 꽂는다.
    resolveRenderProfile, faceGainsForRenderProfile, EXPORT_PPI_PRINT, EXPORT_DITHER_AUTO,
    // 내보내기 계획 — index.html 의 실물 exportPlanFor 를 아래에서 꽂는다(셀 꾸미기 내보내기 축이 그 계획을 읽는다). minRoundtripPpu 는
    // 실물을 감싸 index.html 호출 모양(문맥)을 기록한다 — 잰 하한 키가 그 호출 모양과 같은 키인지 재는 자가 쓴다.
    trimExportMargin, buildTrimmedScene, resolveExportSize, resolveExportPpi, EXPORT_MARGIN_TRIM,
    minRoundtripPpu: (ctx) => { calls.minRoundtripPpu.push({ ...ctx }); return minRoundtripPpu(ctx); },
    // 렌더 예약 타이머(index.html `timer`) — 하네스의 schedule 은 pending 에 쌓기만 하므로 0(예약 없음)으로 둔다.
    timer: 0,
    daehanPatternId, isDaehanFinderPatternId, CENTER_QR_FINDER_PATTERN_ID, isCentralV0FinderPatternId,
    isCentralMarkerN7FinderPatternId, centralMarkerN7FamilyForType, CENTRAL_N7_FINDER_PATTERN_ID,
    LOCATOR_PROFILE_HEX_FRAME_V1, LOCATOR_PROFILE_CELL_SURFACE_V0, isCellSurfaceLocatorProfileY, hasCenterQrSlot,
    detectorEmphasisDetectorId, renderWithErrorDisplay, hPlanarPreviewOptions, reconcileHPositionMode,
    TL_READER_URL, tlReaderUrlWithHint, payloadByteLength, cornerMarkerSeatActive, versionStateKey,
    hFaceQrSummary, hEffectiveQrPosition, hCornerTooCorner,
    // 생산자 — 실물을 감싸 옵션을 기록한다
    buildScene: (encoded, opts) => { calls.buildScene.push(opts); return buildScene(encoded, opts); },
    buildSceneY: (encoded, opts) => { calls.buildSceneY.push(opts); return buildSceneY(encoded, opts); },
    buildHScene: (encoded, opts) => { calls.buildHScene.push(opts); return buildHScene(encoded, opts); },
    withHCornerQr: (scene, qr) => { calls.withHCornerQr.push(qr); return withHCornerQr(scene, qr); },
    // 렌더 주변(이 자의 대상 밖) — 스텁
    hGeneratorActive: () => isHGenerator(generatorState),
    quietChoice: () => ({ color: c.quietColor }), quietColor,
    quietColorOf: (choice) => (choice.color === 'white' ? { r: 255, g: 255, b: 255 }
      : choice.color === 'black' ? { r: 0, g: 0, b: 0 } : null),
    withQuietZone: (scene) => { c.quietColorAtRender = c.quietColor; return scene; },
    withShading: (scene) => scene, outlinedYScene: (scene) => scene,
    rasterize: () => ({}), verifyRaster: () => ({ total: 0, minDelta: 0, mismatches: [] }),
    verifyRasterY: () => ({ total: 0, minDeltaY: 0, logMargin: 0, mismatches: [], erasures: [] }),
    selfCheckMarkup: () => '', deltaMinFor: () => 0.2,
    BG_MODE_COLORS: { transparent: null, white: { r: 255, g: 255, b: 255 }, black: { r: 0, g: 0, b: 0 } },
    typeCGeneratorActive: (s = generatorState) => s.type === 'O' && s.versionO === 'ultra',
    normalPayloadText: () => payload, effectiveVersionYForEncode: () => undefined,
    ySlotLocatorActive: () => false, isLabPath: () => false, advancedOnlyCardsVisible: () => false,
    hImageEditor: { syncQrText: () => c.hFaceImages }, syncHFaceImagesUi() {}, syncStyleUi() {},
    decorActive: () => false, schedule: () => pending.push(1), drawScene: (scene) => calls.draws.push(scene),
    syncBackdropLayer: () => vm.runInContext('maybeRerenderForQuietAuto()', c),
  };
  for (const name of ['syncShotPresetUi', 'syncFaceGainLabel', 'syncHUi', 'syncExportPpiHint', 'syncQuietGaugeReadout',
    'syncTypeYCellEditorUi', 'emitProductGenerate', 'emitGeneratorFail', 'emitLabGen', 'applyPreviewFit',
    'paintY3dPreview', 'updateGauge', 'updateOverflowHighlight', 'syncCubeMakeUi']) c[name] = () => {};
  vm.createContext(c);
  // 면 게인은 제품 함수 그대로(옛 하네스는 {1, .72, .57} 을 박아 두었다 — 제품 기본(화면용 .62)과 달라 Y 셀 꾸미기가 측정 게인 밖이었다).
  for (const name of ['exportDitherBits', 'resolvedRenderProfile', 'profileFaceGains', 'currentFaceGains',
    'resolveFallback', 'resolvedQrText', 'buildConfig', 'encodeOptsFor', 'encodeWithEcc',
    'isCapacityError', 'eccTierLabel', 'paletteOf', 'sceneOptsForOA', 'renderTypeO', 'renderTypeA', 'renderTypeK',
    'renderTypeY', 'renderTypeH', 'hSceneOptions', 'maybeRerenderForQuietAuto', 'render', 'exportPlanFor']) {
    vm.runInContext(fnSource(source, name), c);
  }
  vm.runInContext(decorationBlock(source), c);
  if (allow !== undefined) c.decorationAllow = () => allow;
  if (autoLocatorY) {
    Object.assign(c, { resolveAutoY, LOCATOR_PROFILE_CELL_SURFACE_V0TR });
    for (const name of ['resolveAutoYSafe', 'resolveAutoLocatorProfileY']) vm.runInContext(fnSource(source, name), c);
    const profile = vm.runInContext('resolveAutoLocatorProfileY()', c);
    if (generatorState.qrPosition === 'inner' || /^cell-surface-v0t/.test(profile)) {
      throw new Error('autoLocatorY: QR 위치 파생이 손대는 조합(' + generatorState.qrPosition + ' · ' + profile + ') — 하네스에 파생을 실어라');
    }
    generatorState.locatorProfileY = profile;
  }
  const run = (code) => vm.runInContext(code, c, { timeout: 60000 });
  const render = () => {
    run('render()');
    assert.equal($('error') ? $('error').textContent : c.els.error.textContent, '', '렌더 오류: ' + c.els.error.textContent);
  };
  const cards = (key) => $(key + 'Cards').children;
  const card = (key, value) => cards(key).find((el) => el.dataset.decoValue === String(value));
  const click = (key, value) => { card(key, value).dispatch('click'); pending.length = 0; render(); };
  /** 문서까지 버블된 이벤트 하나(컨트롤의 핸들러가 상태를 바꾼 뒤 — 이 하네스는 상태를 직접 바꾼 뒤 부른다). */
  const dispatchDocument = (kind) => { for (const cb of docListeners.get(kind) ?? []) cb({ type: kind }); };
  return { c, $, run, render, cards, card, click, calls, pending, state: generatorState, dispatchDocument, docListeners };
}

const lastOf = (list) => list[list.length - 1];
/** O V2 자동 H 밴드(15–31 B) 안의 16 B — 버전 V2 고정 대조군이 측정 밴드 안이게(하네스 기본 13 B 는 O 자동 V1). */
const O2_PAYLOAD = 'decoration-ui-o2';

/** 렌더된 문맥에서 **모든** 모양 · 강도를 여는 fixture 행(제품이 유도한 문맥으로 키를 만든다 — 배선 증명용). */
function openAllCellRows(ctx) {
  const base = cellShapeAllowCtx(ctx);
  const rows = [{ ...base, cellShape: 'round-bevel', param: null }];
  for (const [kind, def] of Object.entries(CELL_SHAPE_PARAMS)) for (const param of def.domain) rows.push({ ...base, cellShape: kind, param });
  return rows;
}

/** 기본 상태에서 생산자 입력에 꾸미기 키가 없는가 — 타입별. */
function assertNoDecorationKeys(h, type, where) {
  if (type === 'H') {
    const opts = lastOf(h.calls.buildHScene);
    assert.equal('hCellStyle' in opts, false, where + ': H buildHScene 옵션에 hCellStyle 이 있다');
    assert.equal('hCellGround' in opts, false, where + ': H hCellGround');
    assert.equal('qrDeco' in opts.palette, false, where + ': H palette.qrDeco');
    assert.equal('deco' in h.c.current.hQr, false, where + ': hQr.deco 가 있다');
    assert.equal('hCellStyle' in h.run('hSceneOptions()'), false, where + ': hSceneOptions');
    return;
  }
  const opts = lastOf(type === 'Y' ? h.calls.buildSceneY : h.calls.buildScene);
  assert.equal('cellShape' in opts, false, where + ': ' + type + ' sceneOpts.cellShape 가 있다');
  assert.equal('qrDeco' in opts.palette, false, where + ': ' + type + ' palette.qrDeco 가 있다');
  assert.equal('qrDeco' in h.run('paletteOf(generatorState.preset)'), false, where + ': paletteOf 출력에 qrDeco');
}

/**
 * 제품 기본 자리 — 자동 자리표(generator-seat-auto `autoSeatsFor`, 정식 · 비-taegeuk — index.html syncSeatUi 의 자동 경로와
 * 같은 호출)에서 유도한다. createGeneratorState 의 자리 기본은 «없음» 이라 그대로 두면 A · K 는 제품 화면이 아니다
 * (제품은 로드 때 자동 결과로 덮는다). 허용표 행은 이 자동 자리(A a-cm · K k-cm)에서 잰 사실이다.
 */
function productAutoSeats(type) {
  const s = autoSeatsFor({ type, centralFinderIsTaegeuk: false, allowBlocked: false });
  return { innerSeat: s.inner, deepSeat: s.deep, outerSeat: s.outer };
}

/**
 * 타입별 상태. A · K 는 제품 기본 자리(자동 코너 마커)다. O 는 안쪽 «없음» — 실효 타입 O 의 측정 구성이다(제품 자동은 안쪽
 * o-cm → 실효 타입 G 이고, G 는 G 측정 구성(L6g)의 행으로 연다: 아래 ② 제품 기본표 자가 «O 자동» 으로 따로 잰다).
 */
const TYPE_STATES = Object.freeze({
  O: { type: 'O' }, A: { type: 'A', ...productAutoSeats('A') }, K: { type: 'K', ...productAutoSeats('K') },
  Y: { type: 'Y', yRepresentation: '2.5d' },
  H: { type: 'Y', yRepresentation: '3d', hFaces: 3, versionH: 'auto' },
});
/**
 * 제품 기본 O — 자동 자리 그대로(안쪽 o-cm → 실효 타입 G). TYPE_STATES 밖에 둔다(TYPE_STATES 를 도는 자는 생성기 타입마다
 * 한 번 — G 는 생성기 타입이 아니라 O 의 실효 타입이다).
 */
const O_AUTO_STATE = Object.freeze({ type: 'O', ...productAutoSeats('O') });

/**
 * 제품 기본 페이로드 — 상태 기본 콘텐츠 탭(url)의 index.html 입력 기본값을 제품 `normalizeUrl` 로 정규화한다(손으로 옮겨
 * 적지 않는다). 제품 화면의 버전 · 셀 역할을 재현하는 자만 쓴다.
 */
const PRODUCT_DEFAULT_PAYLOAD = (() => {
  assert.equal(createGeneratorState().contentTab, 'url', '제품 기본 콘텐츠 탭이 url 이 아니다 — 기본 페이로드 유도를 다시 볼 것');
  const m = /id="nUrlPayload" value="([^"]*)"/.exec(INDEX);
  assert.ok(m, 'index.html 에 URL 탭 입력(nUrlPayload) 기본값이 없다');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fnSource(INDEX, 'normalizeUrl'), ctx);
  const payload = vm.runInContext(`normalizeUrl(${JSON.stringify(m[1])})`, ctx);
  assert.ok(typeof payload === 'string' && payload.length > 0, '제품 기본 페이로드가 비었다');
  return payload;
})();

// ── ① 스키마 유도 ─────────────────────────────────────────────────────────

test('① 카드 · 슬라이더는 상태 스키마에서 유도된다(값 목록 · 순서 · 정수 폭)', () => {
  const h = harness({ state: TYPE_STATES.O });
  for (const key of ENUM_KEYS) {
    assert.deepEqual(h.cards(key).map((el) => el.dataset.decoValue), DECORATION_STATE_DOMAINS[key].values.map(String), key);
    for (const el of h.cards(key)) assert.equal(el.tagName, 'BUTTON', key + ': 카드는 button(키보드 기본 동작)');
  }
  for (const key of INT_KEYS) {
    const bar = h.$(key + 'Bar');
    assert.ok(bar, key + 'Bar 가 없다');
    assert.equal(Number(bar.min), DECORATION_STATE_DOMAINS[key].min, key);
    assert.equal(Number(bar.max), DECORATION_STATE_DOMAINS[key].max, key);
  }
  // 카드 묶음의 키 합집합 = 스키마의 열거 키 전부(묶음 밖이면 resolver 에 안 묻힌다).
  const grouped = h.run('Object.values(DECORATION_CARD_GROUPS).flatMap((g) => [...g.keys])');
  assert.deepEqual([...grouped].sort(), [...ENUM_KEYS].sort());
});

test('① 심은 결함 — 화면 자리 · 라벨이 빠지면 로드 시점에 던진다(조용히 빈 줄을 세우지 않는다)', () => {
  assert.throws(() => harness({ missingIds: ['cellDotCards'] }), /cellDotCards/);
  assert.throws(() => harness({ missingIds: ['qrEyeSatBar'] }), /qrEyeSatBar/);
  const noLabel = INDEX.replace("inset: 'g1174',", '');
  assert.notEqual(noLabel, INDEX, '결함 심기 실패 — 라벨 표 철자가 바뀌었다');
  assert.throws(() => harness({ source: noLabel }), /no label key for (hCellStyle|qrCellStyle)=inset/);
});

// ── ② 빈 허용표(스텁 주입) = 전부 잠금 + 인라인 사유 ─────────────────────────

test('② 빈 허용표(스텁 주입)에서 보이는 모든 꾸미기 카드는 잠금 + aria-disabled + 인라인 사유 한 줄이다(끔 카드는 열림)', () => {
  const OFF = { cellShape: CELL_SHAPE_DEFAULT, hCellStyle: H_CELL_STYLE_DEFAULT, qrColorMode: 'default', qrEye: 'none', qrCellStyle: 'square' };
  for (const [type, state] of Object.entries(TYPE_STATES)) {
    // 강도 줄 · H 바탕 줄도 보이게 모양을 하나 골라 둔다(잠겨도 상태는 그대로 — 설계 M10).
    const h = harness({ state: { ...state, cellShape: 'round', hCellStyle: 'dots' }, allow: STUB });
    h.render();
    const visibleKeys = ENUM_KEYS.filter((key) => !h.$(key + 'Cards').hidden
      && !(['cellShape', ...Object.values(CELL_SHAPE_PARAMS).map((d) => d.key)].includes(key) && h.$('cellShapeRhombusGroup').hidden)
      && !(['hCellStyle', 'hCellGround'].includes(key) && h.$('hCellStyleGroup').hidden)
      && !(key === 'hCellGround' && h.$('hCellGroundGroup').hidden)
      && !(key.startsWith('qr') && h.$('qrDecoSection').hidden));
    assert.ok(visibleKeys.length >= 4, type + ': 보이는 카드 줄이 너무 적다 — ' + visibleKeys.join(','));
    for (const key of visibleKeys) {
      for (const el of h.cards(key)) {
        const value = decorationValueFromInput(key, el.dataset.decoValue);
        const off = OFF[key] === value;
        assert.equal(el.getAttribute('aria-disabled'), String(!off), `${type} ${key}=${value}: aria-disabled`);
        assert.equal(el.classList.contains('disabled'), !off, `${type} ${key}=${value}: .disabled`);
        assert.equal(el.getAttribute('title'), null, `${type} ${key}=${value}: 사유를 title 툴팁으로 두지 않는다`);
        if (off) continue;
        const hintId = el.getAttribute('aria-describedby');
        assert.ok(hintId, `${type} ${key}=${value}: 사유 줄을 가리키지 않는다`);
        const hint = h.$(hintId);
        const reasonKey = h.run(`decorationLockKey(${JSON.stringify(el.dataset.lockReason)})`);
        const lockKey = el.dataset.lockKey;
        // 보이는 키 = 사유의 사전 키. 단 exposed-gap 은 권유가 거짓이면 권유 없는 변형을 쓴다.
        assert.ok(lockKey === reasonKey
          || (el.dataset.lockReason === 'exposed-gap' && lockKey === h.run('DECORATION_EXPOSED_GAP_PLAIN_KEY')),
        `${type} ${key}=${value}: 보이는 사유 키(${lockKey})가 사유(${el.dataset.lockReason})와 어긋난다`);
        // 스텁 표에서는 흰색으로 바꿔도 아무것도 안 열린다 — «흰색으로 두면 열릴 수 있어요» 권유(g1164)는 거짓 안내다.
        assert.notEqual(lockKey, 'g1164', `${type} ${key}=${value}: 스텁 표인데 «흰색이면 열린다» 고 권유한다`);
        assert.equal(hint.hidden, false, `${type} ${key}: 사유 줄이 숨어 있다`);
        assert.ok(hint.textContent.includes(lockKey), `${type} ${key}=${value}: 사유(${lockKey})가 인라인 줄에 없다 — ${hint.textContent}`);
      }
    }
    // 상태는 잠금으로 고쳐지지 않는다.
    assert.equal(h.state.cellShape, 'round');
    assert.equal(h.state.hCellStyle, 'dots');
    // 잠긴 카드를 눌러도(키보드 Enter/Space 는 pointer-events 를 지나 click 으로 온다) 상태 · 눌림 카드 · 렌더 예약이 그대로다.
    const lockedCards = visibleKeys.flatMap((key) => h.cards(key).filter((el) => el.getAttribute('aria-disabled') === 'true'));
    assert.ok(lockedCards.length > 0, type + ': 잠긴 카드가 없다 — 자가 비었다');
    const stateBefore = JSON.stringify(h.state);
    const activeBefore = visibleKeys.map((key) => h.cards(key).map((el) => el.classList.contains('active')).join()).join('|');
    h.pending.length = 0;
    for (const el of lockedCards) el.dispatch('click');
    assert.equal(JSON.stringify(h.state), stateBefore, type + ': 잠긴 카드 click 이 상태를 바꿨다');
    assert.equal(visibleKeys.map((key) => h.cards(key).map((el) => el.classList.contains('active')).join()).join('|'), activeBefore,
      type + ': 잠긴 카드 click 이 눌림 카드를 바꿨다');
    assert.equal(h.pending.length, 0, type + ': 잠긴 카드 click 이 렌더를 예약했다');
  }
});

test('② «흰색으로 두면 열릴 수 있어요» 권유(g1164)는 따르면 실제로 열리는 카드에만 붙는다', () => {
  const state = { ...TYPE_STATES.Y, bgMode: 'transparent', cellShape: 'round' };
  // Y 는 제품 기본 «자동» 로케이터로 그린다(autoLocatorY) — 스키마 기본 'off' 는 제품 화면이 아니고, 측정 상태(제품 자동 사다리가 고르는
  // 표 키)도 아니라 fixture 행이 있어도 잠긴다(2026-09-28 측정 밴드).
  const Y_AUTO = { autoLocatorY: true };
  // 빈 표(스텁 주입) — 흰 틈 형제 행이 없으니 «틈 탓» 이 아니다: 미확인(g1162)이고 틈 문구는 둘 다 안 보인다.
  const stub = harness({ state, quietColor: 'none', allow: STUB, ...Y_AUTO });
  stub.render();
  assert.equal(stub.card('cellShape', 'round').dataset.lockReason, 'unmeasured', '형제 행 없는 표에서 «틈 탓» 사유가 나왔다');
  const plainKey = stub.run('DECORATION_EXPOSED_GAP_PLAIN_KEY');
  assert.equal(stub.card('cellShape', 'round').dataset.lockKey, 'g1162');
  for (const k of [plainKey, 'g1164']) assert.ok(!stub.$('cellShapeLockHint').textContent.includes(k), `스텁 표인데 틈 문구 ${k} 가 보인다`);
  // 흰 틈 형제 행이 **흰 바탕에만** 있는 fixture — 틈이 가르는 축이라 exposed-gap 이지만, 안전영역만 흰색으로 두면
  // (투명 바탕 그대로) 열리지 않으므로 권유 없는 문구다.
  const white = harness({ state, quietColor: 'white', ...Y_AUTO });
  white.render();
  const bgWhiteRows = openAllCellRows({ ...white.c.current.deco.ctx, bgMode: 'white' });
  const plain = harness({ state, quietColor: 'none', allow: { ROWS: bgWhiteRows }, ...Y_AUTO });
  plain.render();
  assert.equal(plain.card('cellShape', 'round').dataset.lockReason, 'exposed-gap', '흰 틈 형제 행이 있는데 틈 사유가 아니다');
  assert.equal(plain.card('cellShape', 'round').dataset.lockKey, plainKey);
  assert.ok(plain.$('cellShapeLockHint').textContent.includes(plainKey));
  assert.ok(!plain.$('cellShapeLockHint').textContent.includes('g1164'), '안전영역 흰색으로는 안 열리는데 권유 문구가 보인다');
  // 흰 판 문맥에서 열리는 fixture — 권유가 참이 되고, 따르면(안전영역 흰색) 정말 열린다.
  const probe = harness({ state, quietColor: 'white', ...Y_AUTO });
  probe.render();
  const h = harness({ state, quietColor: 'none', allow: { ROWS: openAllCellRows(probe.c.current.deco.ctx) }, ...Y_AUTO });
  h.render();
  const advised = h.cards('cellShape').filter((el) => el.dataset.lockKey === 'g1164');
  assert.ok(advised.some((el) => el.dataset.decoValue === 'round'), 'fixture 가 흰 판에서 round 를 여는데 권유가 없다');
  assert.ok(h.$('cellShapeLockHint').textContent.includes('g1164'));
  h.c.quietColor = 'white';
  h.run('maybeRerenderForQuietAuto()');
  h.render();
  for (const el of advised) {
    assert.equal(el.getAttribute('aria-disabled'), 'false', `권유를 따랐는데 ${el.dataset.decoValue} 가 안 열렸다(${el.dataset.lockReason})`);
  }
});

/**
 * 렌더된 셀 모양 문맥에서 제품 기본표(생성본)가 여는 행 — 표에서 유도한다(특정 행을 박제하지 않는다).
 * 행의 표 키가 문맥과 전부 같고 구조 잠금(제품 함수)이 안 걸리는 행.
 */
function tableRowsFor(ctx) {
  const base = cellShapeAllowCtx(ctx);
  if (!base) return [];
  return DEFAULT_ALLOW.ROWS.filter((row) => Object.keys(base).every((k) => row[k] === base[k])
    && cellShapeStructuralLock(ctx.table, row.cellShape, row.param, ctx) === null);
}

test('② 제품 기본표(생성본): 셀 모양 카드 열림 ⇔ 렌더 문맥에 맞는 표 행 · 제품 기본 Y(투명)에서 하나 이상 열리고 사유 없이 생산자까지 간다', (t) => {
  assert.notEqual(DEFAULT_ALLOW.RECEIPT_SHA256, null, '제품 기본표가 스텁이다 — 이 자는 생성본을 잰다');
  // 제품 기본 상태(타입만 고른다) — Y 는 기본 투명 배경 + 판 없음(quiet auto 가 Y 에 판을 안 깐다 → 틈 등급 unknown) +
  // 제품 기본 «자동» 로케이터(autoLocatorY — 실물 정책 함수). 스키마 기본 'off' 그대로는 제품 화면이 아니다.
  // A · K 는 제품 자동 자리(TYPE_STATES) · O 는 안쪽 «없음»(실효 타입 O 의 측정 구성) · «O 자동» 은 제품 자동 안쪽 o-cm(→ 실효
  // 타입 G — G 측정 구성, L6g 행). «O 자동(기본 URL)» 은 같은 상태를 제품 기본 페이로드로 그린다(제품 첫 화면의 버전 · 셀 역할).
  const O_AUTO = O_AUTO_STATE;
  const CASES = [['O', TYPE_STATES.O, 'white', false], ['O(기본 URL)', TYPE_STATES.O, 'white', false, PRODUCT_DEFAULT_PAYLOAD],
    ['O 자동', O_AUTO, 'white', false], ['O 자동(기본 URL)', O_AUTO, 'white', false, PRODUCT_DEFAULT_PAYLOAD],
    ['A', TYPE_STATES.A, 'white', false], ['K', TYPE_STATES.K, 'white', false],
    ['Y', TYPE_STATES.Y, 'none', true]];
  const openedByType = {};
  for (const [label, state, quietColor, autoLocatorY, payload] of CASES) {
    const type = state.type;
    const probe = harness({ state, quietColor, autoLocatorY, payload });
    probe.render();
    const ctx = probe.c.current.deco.ctx;
    assert.ok(ctx, label + ': 렌더가 셀 모양 문맥을 안 남겼다');
    const rows = tableRowsFor(ctx);
    openedByType[label] = {
      ctx: cellShapeAllowCtx(ctx), rows: rows.length,
      config: Object.fromEntries(['cornerMarker', 'sagoae', 'eccLevel', 'detectorEmphasis'].filter((k) => k in ctx).map((k) => [k, ctx[k]])),
      open: probe.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT && el.getAttribute('aria-disabled') === 'false')
        .map((el) => el.dataset.decoValue),
    };
    // 동치: 카드(지금 상태의 강도로 묻는다)가 열림 ⇔ 그 (모양, 강도) 행이 표에 있다. 끔 카드는 늘 열림.
    for (const el of probe.cards('cellShape')) {
      const kind = el.dataset.decoValue;
      const def = CELL_SHAPE_PARAMS[kind];
      const param = def ? probe.state[def.key] : null;
      const want = kind === CELL_SHAPE_DEFAULT || rows.some((r) => r.cellShape === kind && r.param === param);
      assert.equal(el.getAttribute('aria-disabled'), String(!want),
        `${label} ${kind}(${param}): 카드 ${want ? '열림' : '잠금'} 기대 — 표 행 ${want ? '있음' : '없음'}, 사유 ${el.dataset.lockReason || '없음'}`);
      if (!want) assert.ok(el.dataset.lockReason, `${label} ${kind}: 잠겼는데 사유가 없다`);
    }
    if (label.startsWith('O 자동')) {
      // 제품 기본 O = 자동 안쪽 o-cm → 실효 타입 G. G 행은 G 측정 구성(자동 안쪽 코너 마커 · 사괘 없음 · ECC H · 강조 'all')에서
      // 잰 사실이고 제품 기본이 그 구성이라, 위 동치(카드 열림 ⇔ 표 행)가 G 행으로 선다 — 행 수는 박제하지 않는다(아래 «행 > 0»).
      assert.equal(ctx.type, 'G', label + ': O 자동 자리가 타입 G 로 안 갈렸다');
      // 타입 판별(O 행이 G 카드를 여는가)은 이 동치로 못 잰다 — tableRowsFor 가 type 키로 이미 거른다(옛 «rows 가 전부 G»
      // 단언은 구성상 참이라 공허했다, 2026-09-27 검토 major). 아래 «② 타입 키는 카드를 가른다» 자가 행을 주입해 잰다.
    }
    // 연 행마다: 그 상태로 UI 를 세우면 카드 · 강도 카드가 열리고, 인라인 사유가 없고, spec 이 생산자까지 간다.
    for (const row of rows) {
      const def = CELL_SHAPE_PARAMS[row.cellShape];
      const chosen = { ...state, cellShape: row.cellShape, ...(def ? { [def.key]: row.param } : {}) };
      const h = harness({ state: chosen, quietColor, autoLocatorY, payload });
      h.render();
      const where = `${label} ${row.cellShape}(${row.param})`;
      const card = h.card('cellShape', row.cellShape);
      assert.equal(card.getAttribute('aria-disabled'), 'false', where + ': 카드가 잠겼다 ' + card.dataset.lockReason);
      assert.equal(card.dataset.lockReason, '', where);
      assert.equal(card.getAttribute('aria-describedby'), null, where + ': 열린 카드가 사유 줄을 가리킨다');
      if (def) assert.equal(h.card(def.key, row.param).getAttribute('aria-disabled'), 'false', where + ': 강도 카드가 잠겼다');
      assert.ok(!h.$('cellShapeLockHint').textContent.includes('g1205'), where + ': «고른 모양이 잠겼다» 문구가 보인다');
      const opts = lastOf(type === 'Y' ? h.calls.buildSceneY : h.calls.buildScene);
      assert.ok(opts.cellShape, where + ': spec 이 생산자에 안 갔다');
      assert.equal(opts.cellShape.kind, row.cellShape, where);
      assert.equal(opts.cellShape.param, row.param, where);
    }
  }
  for (const [label, v] of Object.entries(openedByType)) t.diagnostic(`${label}: ${JSON.stringify(v)}`);
  // 표가 UI 경로에서 비지 않았다 — 제품 기본 Y(투명)에서 셀 모양 하나 이상(수치는 박제하지 않는다).
  assert.ok(openedByType.Y.rows > 0, '제품 기본 Y(투명 배경)에서 여는 행이 생성 표에 없다 — ' + JSON.stringify(openedByType));
  // 제품 기본 A · K(자동 코너 마커) · O(자동 안쪽 o-cm → G)는 측정 구성이다 — 생성 표 행으로 열린다(측정한 기본을 잠그지 않는다).
  // O 안쪽 «없음»(실효 타입 O)도 제품 기본 URL 에서는 열린다. (짧은 하네스 페이로드에서는 O 안쪽 없음의 자동 버전이 달라 행이
  // 없을 수 있다 — 그 경우도 위 동치가 잠금으로 선다. 버전을 고정한 O 는 아래 자가 잰다.)
  for (const label of ['A', 'K', 'O 자동', 'O 자동(기본 URL)', 'O(기본 URL)']) {
    assert.ok(openedByType[label].rows > 0, `${label}(제품 자동 자리 · 측정 구성)에서 여는 행이 없다 — 제품 자동 자리가 바뀌어 `
      + '측정 구성(CELL_SHAPE_MEASURED_CONFIG)에서 벗어났다면 재측정하거나 제품 기본을 재검토할 것(선언은 영수증에서만 바꾼다 — '
      + '제품 기본에 맞추면 거짓 열림이 돌아온다) ' + JSON.stringify(openedByType));
  }
});

test('② 타입 키는 카드를 가른다(UI 경로 · 표 주입) — 같은 비-type 문맥의 형제 타입 행만 있는 표는 빈 표와 같게 보이고, 같은 행을 자기 타입으로 적으면 열린다(O 자동 = G ↔ O · A ↔ K)', () => {
  // 왜(2026-09-27 검토 major): 위 ② 제품 기본표 자의 «카드 열림 ⇔ 표 행» 은 행을 type 키로 거른 뒤라 행 매칭이 type 을 빼먹어도
  // 초록이다. 생성 표에서 A ↔ K 는 같은 문맥의 행이 똑같아(O ↔ G 도 제품 기본 문맥에선 같다) 표로는 판별력이 없다 — 행을
  // 주입해 표 내용과 무관하게 잰다. resolver 수준(생성 표의 실제 비대칭 포함)은 cell-shape-measured-config ⓒ 타입 자.
  const view = (h) => h.cards('cellShape').map((el) => `${el.dataset.decoValue}:${el.getAttribute('aria-disabled')}:${el.dataset.lockReason}`);
  const openOf = (h) => h.cards('cellShape')
    .filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT && el.getAttribute('aria-disabled') === 'false').map((el) => el.dataset.decoValue);
  // [이름, 상태, 실효 타입, 형제 타입]
  const cases = [
    ['O 자동(G) ← O 행', O_AUTO_STATE, 'G', 'O'],
    ['O 안쪽 없음 ← G 행', TYPE_STATES.O, 'O', 'G'],
    ['A ← K 행', TYPE_STATES.A, 'A', 'K'],
    ['K ← A 행', TYPE_STATES.K, 'K', 'A'],
  ];
  for (const [name, baseState, effType, siblingType] of cases) {
    const state = { ...baseState, cellShape: 'round' };
    const probe = harness({ state, allow: STUB });
    probe.render();
    const ctx = probe.c.current.deco.ctx;
    assert.equal(ctx.type, effType, name + ': 실효 타입');
    const sib = harness({ state, allow: { ROWS: openAllCellRows({ ...ctx, type: siblingType }) } });
    sib.render();
    assert.deepEqual(view(sib), view(probe), `${name}: 형제 타입(${siblingType}) 행만 있는 표가 빈 표와 다르게 보인다`);
    assert.deepEqual(openOf(sib), [], `${name}: 형제 타입(${siblingType}) 행이 ${effType} 카드를 열었다`);
    assert.equal('cellShape' in lastOf(sib.calls.buildScene), false, `${name}: 형제 타입 행으로 모양이 생산자에 갔다`);
    // 대조군 — 같은 행을 자기 타입으로 적으면 열리고 고른 모양이 생산자까지 간다(위 잠금이 다른 이유로 난 것이 아니다).
    const own = harness({ state, allow: { ROWS: openAllCellRows(ctx) } });
    own.render();
    assert.ok(openOf(own).length > 0, `${name}: 자기 타입 행인데 열린 카드가 없다 — 대조군이 비었다`);
    const opts = lastOf(own.calls.buildScene);
    assert.equal(opts.cellShape && opts.cellShape.kind, 'round', `${name}: 자기 타입 행인데 round 가 생산자에 안 갔다`);
  }
});

test('② 자리 · ECC 가 측정 구성과 다르면 셀 모양 카드가 전부 잠기고, 측정 구성에서 열리던 카드만 새 사유다 — 매퍼가 떨군 사괘는 자리 사유가 아니다', () => {
  // 대조군 쌍: 같은 타입 · 같은 표 키(allowCtx)에서 자리 · ECC 한 축만 바꾼다. 표 키가 같으니 옛 resolver 는 둘 다 열었다.
  // 사유는 반사실이다(2026-09-27 검토): 대조군(측정 구성)에서 열린 카드 → 그 축의 사유(«측정 구성이면 열린다» 가 참),
  // 대조군에서도 잠긴 카드 → 대조군과 같은 사유(돌출 bevel · 행 없음은 자리 · ECC 를 되돌려도 안 열린다 — «자리 탓» 은 틀린 안내).
  const nonDefault = (h) => h.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT);
  const reasons = (h) => nonDefault(h).map((el) => el.dataset.lockReason);
  // O 는 버전을 V2 로 고정한다 — 표 행이 있는 버전이고, 사괘 · ECC 를 바꿔도 같은 버전에 머물러 표 키가 같다(대조군). 페이로드는
  // O V2 자동 H 밴드 안(O2_PAYLOAD 16 B) — 하네스 기본 13 B 는 O 자동이 V1 이라 V2 고정이 측정 밴드 밖(잰 적 없는 영 패딩)이다.
  const O2 = { ...TYPE_STATES.O, versionO: 2 };
  // 표 행이 없는 버전 — 측정 구성이어도 잠기니 «자리 탓» 이 아니라 미확인 · 설계 잠금이어야 한다. 2026-09-28 길이 축 표부터 A v1 ·
  // v2 에 행이 생겨(옛 «A v1 은 행 없음» 은 틀려졌다) K v1 로 옮겼다 — 그 전제는 아래에서 표로 확인한다(행이 생기면 다른 버전으로).
  const K1 = { ...TYPE_STATES.K, versionK: 1, cellBevel: 1.4 };
  assert.equal(DEFAULT_ALLOW.ROWS.filter((r) => r.table === 'oak' && r.type === 'K' && r.version === 1).length, 0,
    'K v1 에 행이 생겼다 — «행 없는 버전» 대조군을 행이 없는 다른 버전으로 옮길 것');
  // 제품 기본 O(자동 안쪽 o-cm → 실효 타입 G)도 V2 로 고정한다 — 제품 첫 화면의 표면이라 사유 문구의 참/거짓을 UI 경로로 잰다
  // (2026-09-27 검토 minor). 자동 버전에서는 사괘 · ECC 가 재인코딩으로 버전을 바꿔 표 키가 달라질 수 있다(대조군이 아니다).
  const G2 = { ...O_AUTO_STATE, versionO: 2 };
  const pairs = [
    // [이름, 측정 구성 상태, 한 축만 바꾼 상태, 그 축의 사유, 사전 키]
    ['A 바깥 없음', TYPE_STATES.A, { ...TYPE_STATES.A, outerSeat: 'none' }, 'seat-config', 'g1209'],
    ['K 바깥 없음', TYPE_STATES.K, { ...TYPE_STATES.K, outerSeat: 'none' }, 'seat-config', 'g1209'],
    ['O2 사괘(수동)', O2, { ...O2, deepSeat: 'sagoae' }, 'seat-config', 'g1209', O2_PAYLOAD],
    ['O2 ECC M', O2, { ...O2, eccLevel: 'M' }, 'ecc-level', 'g1210', O2_PAYLOAD],
    ['G2(O 자동) 사괘(수동)', G2, { ...G2, deepSeat: 'sagoae' }, 'seat-config', 'g1209'],
    ['G2(O 자동) ECC M', G2, { ...G2, eccLevel: 'M' }, 'ecc-level', 'g1210'],
    ['G2(O 자동) ECC L', G2, { ...G2, eccLevel: 'L' }, 'ecc-level', 'g1210'],
    ['A ECC L', TYPE_STATES.A, { ...TYPE_STATES.A, eccLevel: 'L' }, 'ecc-level', 'g1210'],
    ['K ECC M', TYPE_STATES.K, { ...TYPE_STATES.K, eccLevel: 'M' }, 'ecc-level', 'g1210'],
    ['K1 바깥 없음 · 돌출 bevel(행 없는 버전)', K1, { ...K1, outerSeat: 'none' }, 'seat-config', 'g1209'],
    ['K 바깥 없음 · 돌출 bevel', { ...TYPE_STATES.K, cellBevel: 1.4 }, { ...TYPE_STATES.K, cellBevel: 1.4, outerSeat: 'none' }, 'seat-config', 'g1209'],
  ];
  const seen = { axis: 0, kept: 0, keptUnmeasured: 0 };
  const axisBy = {};
  for (const [name, baseState, state, reason, key, payload] of pairs) {
    const base = harness({ state: { ...baseState, cellShape: 'bevel' }, payload });
    base.render();
    const h = harness({ state: { ...state, cellShape: 'bevel' }, payload });
    h.render();
    // 같은 표 키 — 측정 구성 문맥의 행이 그대로 이 문맥을 «허가» 하던 자리다(거짓 열림의 전제).
    assert.deepEqual(cellShapeAllowCtx(h.c.current.deco.ctx), cellShapeAllowCtx(base.c.current.deco.ctx), name + ': 표 키가 달라졌다 — 대조군이 아니다');
    const baseCards = nonDefault(base);
    const cards = nonDefault(h);
    let axis = 0;
    cards.forEach((el, i) => {
      const b = baseCards[i];
      assert.equal(el.dataset.decoValue, b.dataset.decoValue, name + ': 카드 순서');
      assert.equal(el.getAttribute('aria-disabled'), 'true', `${name} ${el.dataset.decoValue}: 측정 밖 구성인데 열렸다`);
      const baseOpen = b.getAttribute('aria-disabled') === 'false';
      // 흰 판(하네스 기본)이라 대조군의 exposed-gap 은 없다 — 있으면 측정 구성까지 달라진 쪽은 미확인이어야 한다.
      const want = baseOpen ? reason : (b.dataset.lockReason === 'exposed-gap' ? 'unmeasured' : b.dataset.lockReason);
      assert.equal(el.dataset.lockReason, want, `${name} ${el.dataset.decoValue}: 대조군 ${baseOpen ? '열림' : b.dataset.lockReason}`);
      if (baseOpen) { axis += 1; seen.axis += 1; } else { seen.kept += 1; if (el.dataset.lockReason === 'unmeasured') seen.keptUnmeasured += 1; }
    });
    assert.equal(h.$('cellShapeLockHint').textContent.includes(key), axis > 0, `${name}: 사유 줄의 ${key} 는 측정 구성에서 열린 카드가 있을 때만`);
    assert.equal('cellShape' in lastOf(h.calls.buildScene), false, name + ': 잠겼는데 모양이 생산자에 갔다');
    assert.equal(h.state.cellShape, 'bevel', name + ': 잠금이 상태를 고쳤다');
    axisBy[name] = axis;
  }
  // 판별력: 두 갈래가 모두 났다 — «축 사유» 카드와 «대조군 사유 유지» 카드(돌출 bevel · 행 없는 버전).
  // «대조군 사유 유지» 에 행 없는 버전의 미확인이 실제로 있다(돌출 bevel 설계 잠금만으로 초록이 되지 않게).
  assert.ok(seen.axis > 0 && seen.kept > 0 && seen.keptUnmeasured > 0, JSON.stringify(seen));
  // G(제품 기본 O) 쌍은 축 사유 카드가 실제로 났다 — 대조군이 전부 잠긴 쌍이면 사유 문구를 재지 못한다.
  for (const name of Object.keys(axisBy).filter((n) => n.startsWith('G2'))) {
    assert.ok(axisBy[name] > 0, `${name}: 측정 구성(G2)에서 열린 카드가 없다 — 사유 문구를 재지 못한다 ${JSON.stringify(axisBy)}`);
  }
  // 측정 구성 쪽은 열린다(위 쌍의 대조군이 비지 않았다) — A · K · O · G 기본에서 bevel 이 생산자까지 간다.
  for (const [name, state, payload] of [['A', TYPE_STATES.A], ['K', TYPE_STATES.K], ['O2', O2, O2_PAYLOAD], ['G2(O 자동)', G2]]) {
    const h = harness({ state: { ...state, cellShape: 'bevel' }, payload });
    h.render();
    assert.equal(lastOf(h.calls.buildScene).cellShape && lastOf(h.calls.buildScene).cellShape.kind, 'bevel', name + ': 측정 구성인데 bevel 이 안 갔다');
  }
  // 매퍼가 사괘를 떨구는 조합은 와이어가 측정 구성과 같다 — 상태 표지(deepSeat)로 잠그면 거짓 잠금이다.
  // 두 쌍 다 표 행이 있는 버전에서 잰다(O daehan 은 V3 — daehan 행은 V3 에만 있다). 행이 없는 버전이면 두 팔이 모두
  // 미확인으로 잠겨 «열린 채» 를 못 잰다(2026-09-27 검토 — 옛 쌍은 하네스 페이로드의 자동 V2 에서 둘 다 잠겨 있었다).
  for (const [name, state, payload] of [
    ['A 자동 a-cm + 사괘 선택', { ...TYPE_STATES.A, deepSeat: 'sagoae', cellShape: 'bevel' }],
    // O daehan 은 제품 기본 URL(19 B — daehan V3 자동 H 밴드 19–32 B 안). 하네스 기본 13 B 는 daehan 자동 V2 라 V3 고정은 측정 밴드 밖이다.
    ['O3 daehan + 사괘 선택', { ...TYPE_STATES.O, versionO: 3, finderPatternId: 'oak-daehan-k10', deepSeat: 'sagoae', cellShape: 'bevel' }, PRODUCT_DEFAULT_PAYLOAD],
  ]) {
    const without = harness({ state: { ...state, deepSeat: 'none' }, payload });
    without.render();
    const h = harness({ state, payload });
    h.render();
    assert.equal(h.c.current.encoded.sagoae, false, name + ': 매퍼가 사괘를 떨구지 않았다 — 대조의 전제가 깨졌다');
    assert.deepEqual(reasons(h), reasons(without), name + ': 사괘 선택만 더했는데 카드 잠금이 달라졌다');
    assert.ok(!reasons(h).includes('seat-config'), name + ': 와이어가 측정 구성인데 자리 사유로 잠겼다');
    const open = nonDefault(h).filter((el) => el.getAttribute('aria-disabled') === 'false').map((el) => el.dataset.decoValue);
    assert.ok(open.length > 0, name + ': 열린 카드가 없다 — «열린 채» 를 재지 못한다(표 행이 있는 문맥이 아니다)');
    assert.equal(lastOf(h.calls.buildScene).cellShape && lastOf(h.calls.buildScene).cellShape.kind, 'bevel', name + ': 열린 bevel 이 생산자까지 안 갔다');
  }
});

test('② ECC 사유의 실현 조건(제품 경로 · auto 사다리): auto 가 M 으로 내려간 길이(G 80 · A 85 · K 120 · Y 114 B)는 «ECC 탓»(g1210)이 아니라 미확인(g1162) · 같은 버전에서 H 로도 들어가는 길이의 수동 M 은 g1210', (t) => {
  // 왜(DESIGN_002 §4.4): auto-M 길이는 그 버전의 표 키가 H 행과 같아 hit 가 나지만 그 버전에 H 로는 안 들어간다 — «ECC 를 H 로» 는
  // 따를 수 없는 안내다. 사유는 index.html 렌더(cellShapeDecoFor)가 렌더에 쓴 인코더 · 페이로드 · 옵션으로 유도한 측정 상태
  // (generator-render-config measuredStateAtTableKey)에서 나온다. ECC 는 제품 auto 사다리(encodeWithEcc 실물)가 고른다.
  const nonDefault = (h) => h.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT);
  const lenText = (L) => 'https://tl.estre.so/' + 'x'.repeat(L - 20);
  // Y 는 제품 auto 가 로케이터 · 버전을 사다리(generator-auto-y resolveAutoY — 제품 함수)로 고른다. 하네스는 버전 유도를 스텁하므로
  // 그 사다리 값을 넣는다(바깥 QR 에서는 index.html effectiveVersionYForEncode 의 두 갈래가 같은 답이다 — 그 주석).
  const yAuto = (L) => resolveAutoY({ payloadBytes: L, tones: 3, eccLevel: 'auto' });
  const yState = (L) => ({ ...TYPE_STATES.Y, locatorProfileY: yAuto(L).locatorProfileY });
  // Y 는 제품 기본(투명 · 판 없음 — 실효 틈 unknown)으로 그린다: 그 문맥에 n25 행이 있다(흰 틈 행은 흰 평탄화에서 잰 문맥이다).
  const make = (state, L, isY) => {
    const h = harness({ state: { ...state, cellShape: 'bevel' }, payload: lenText(L), quietColor: isY ? 'none' : 'white' });
    if (isY) h.c.effectiveVersionYForEncode = () => yAuto(L).version;
    h.render();
    return h;
  };
  /** 카드가 «측정 구성(H · 같은 표 키)이면 열리는가» — 반사실 문맥(렌더 문맥의 ECC 만 H · 그 표 키의 측정 상태 — 표 키 hit 인가만 본다). */
  const opensAtH = (h, value) => resolveCellShapeSpec({ ...h.state, cellShape: value },
    { ...h.c.current.deco.ctx, eccLevel: 'H', measuredStateAtTableKey: true }).spec !== null;
  let hitAutoM = 0;
  for (const [name, state, L, isY] of [
    ['G 80 B(O 자동 = G)', O_AUTO_STATE, 80, false], ['A 85 B', TYPE_STATES.A, 85, false], ['K 120 B', TYPE_STATES.K, 120, false],
    ['Y 114 B', yState(114), 114, true],
  ]) {
    const h = make(state, L, isY);
    const { encoded, deco } = h.c.current;
    assert.equal(encoded.eccLevel, 'M', `${name}: 제품 auto 가 M 을 고르지 않았다 — auto-M 길이가 아니다`);
    assert.equal(deco.ctx.measuredStateAtTableKey, false, `${name}: 같은 표 키에 측정 상태(H)가 있다고 한다`);
    let hits = 0;
    for (const el of nonDefault(h)) {
      assert.notEqual(el.dataset.lockReason, 'ecc-level', `${name} ${el.dataset.decoValue}: 따를 수 없는 «ECC 탓» 안내`);
      if (opensAtH(h, el.dataset.decoValue)) {
        hits += 1;
        assert.equal(el.dataset.lockReason, 'unmeasured', `${name} ${el.dataset.decoValue}: 표 키 hit 인데 미확인이 아니다`);
        assert.equal(el.dataset.lockKey, 'g1162');
      }
    }
    assert.equal(h.$('cellShapeLockHint').textContent.includes('g1210'), false, `${name}: 사유 줄에 g1210`);
    t.diagnostic(`${name}: v${encoded.version}${isY ? ' n' + encoded.n : ''} M · 표 키 hit 카드 ${hits}${hits ? '' : '(행 없음 — 이 길이는 판별력 없음)'}`);
    hitAutoM += hits;
  }
  // 판별력 — auto-M 길이 중 표 키 hit(측정 구성이면 열리는 카드)가 실제로 있다(A v2 · Y n25 — 조건 줄을 지우면 여기가 g1210 으로 빨개진다).
  assert.ok(hitAutoM > 0, 'auto-M 길이에서 표 키 hit 카드가 없다 — 실현 조건을 재지 못한다');

  // 대조 — 같은 버전에서 H 로도 들어가는 길이(밴드 최대)의 수동 M: 측정 구성(auto = H)에서 열린 카드는 g1210 이 참이다.
  let axis = 0;
  for (const [name, baseState, L, isY] of [
    ['A 78 B(A v2)', { ...TYPE_STATES.A, versionA: 2 }, 78, false], ['Y 93 B(n25 v0tr)', yState(93), 93, true],
  ]) {
    const base = make(baseState, L, isY);
    const h = make({ ...baseState, eccLevel: 'M' }, L, isY);
    assert.equal(base.c.current.encoded.eccLevel, 'H', `${name}: 대조군이 H 가 아니다`);
    assert.equal(h.c.current.encoded.eccLevel, 'M');
    assert.deepEqual(cellShapeAllowCtx(h.c.current.deco.ctx), cellShapeAllowCtx(base.c.current.deco.ctx), `${name}: 표 키가 달라졌다 — 대조군이 아니다`);
    assert.equal(h.c.current.deco.ctx.measuredStateAtTableKey, true, `${name}: 같은 표 키에 측정 상태(H)가 없다고 한다`);
    const baseCards = nonDefault(base);
    let caseAxis = 0;
    nonDefault(h).forEach((el, i) => {
      const b = baseCards[i];
      if (b.getAttribute('aria-disabled') !== 'false') return;
      assert.equal(el.dataset.lockReason, 'ecc-level', `${name} ${el.dataset.decoValue}: 측정 구성에서 열리는데 «ECC 탓» 이 아니다`);
      caseAxis += 1;
    });
    assert.ok(caseAxis > 0, `${name}: 측정 구성(auto = H)에서 열린 카드가 없다 — 대조군이 비었다`);
    axis += caseAxis;
    assert.ok(h.$('cellShapeLockHint').textContent.includes('g1210'), `${name}: 사유 줄에 g1210 이 없다`);
  }
  assert.ok(axis > 0, '수동 M 대조에서 «ECC 탓» 카드가 없다 — 대조군이 비었다');
});

test('② 자리 사유의 실현 조건(제품 경로): A 바깥 «없음» 79 · 80 B(v2 H — 코너 마커를 켜면 v2 H 에 안 들어감)는 «자리 탓»(g1209)이 아니라 미확인(g1162) · 따르면(a-cm) 정말 안 열린다', (t) => {
  // 왜(2026-09-28 착지 검토 major): 새 A v2 행으로 A 바깥 없음 79–80 B 가 표 키 hit 인데, 코너 마커(측정 자리)를 켜면 auto 가 v2 M 으로
  // 내려가 «자리 탓» 을 따라도 열리지 않았다. 사유는 index.html 렌더가 유도한 측정 상태(measuredStateAtTableKey)에서 나온다.
  const nonDefault = (h) => h.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT);
  const lenText = (L) => 'https://tl.estre.so/' + 'x'.repeat(L - 20);
  let hits = 0;
  for (const L of [79, 80]) {
    const none = harness({ state: { ...TYPE_STATES.A, outerSeat: 'none', cellShape: 'bevel' }, payload: lenText(L) });
    none.render();
    const { encoded, deco } = none.c.current;
    assert.deepEqual([encoded.version, encoded.eccLevel, encoded.cornerMarker], [2, 'H', false], `A 바깥 없음 ${L} B: v2 H 가 아니다 — 전제를 다시 볼 것`);
    assert.equal(deco.ctx.measuredStateAtTableKey, false, `A 바깥 없음 ${L} B: 측정 자리로 같은 표 키에 측정 상태가 있다고 한다`);
    for (const el of nonDefault(none)) {
      assert.notEqual(el.dataset.lockReason, 'seat-config', `${L} B ${el.dataset.decoValue}: 따를 수 없는 «자리 탓» 안내`);
      // 표 키 hit(같은 표 키에서 측정 자리 · 측정 상태면 열린다)인 카드는 미확인 문구다.
      const atMeasured = resolveCellShapeSpec({ ...none.state, cellShape: el.dataset.decoValue },
        { ...deco.ctx, cornerMarker: true, measuredStateAtTableKey: true }).spec !== null;
      if (atMeasured) {
        hits += 1;
        assert.equal(el.dataset.lockReason, 'unmeasured', `${L} B ${el.dataset.decoValue}`);
        assert.equal(el.dataset.lockKey, 'g1162');
      }
    }
    assert.equal(none.$('cellShapeLockHint').textContent.includes('g1209'), false, `${L} B: 사유 줄에 g1209`);
    // 따르면(바깥 a-cm) — 제품 auto 가 v2 M 으로 내려가 여전히 잠긴다(안내가 거짓이 아니었음을 확인하는 대조가 아니라, 옛 안내가 거짓이었다는 확인).
    const follow = harness({ state: { ...TYPE_STATES.A, cellShape: 'bevel' }, payload: lenText(L) });
    follow.render();
    assert.equal(follow.c.current.encoded.eccLevel, 'M', `${L} B a-cm: auto 가 M 이 아니다`);
    assert.ok(nonDefault(follow).every((el) => el.getAttribute('aria-disabled') === 'true'), `${L} B a-cm: 따랐더니 열렸다 — 이 자의 전제가 틀렸다`);
  }
  t.diagnostic(`A 바깥 없음 79–80 B 표 키 hit 카드 ${hits}`);
  assert.ok(hits > 0, '표 키 hit 카드가 없다 — 판별력 없음(A v2 행이 없어졌다면 다른 길이를 볼 것)');
});

test('② 측정 밴드(제품 경로): 버전 고정 · Y 로케이터 직접 선택의 짧은 페이로드는 표 키가 같아도 전부 잠기고(g1162), 같은 표 키의 밴드 안 페이로드는 열린다', (t) => {
  // 왜(2026-09-28 착지 검토 major): 표 키에는 길이가 없다 — 행은 그 표 키의 자동 H 밴드(제품 auto 가 그 키를 고르는 길이)에서 잰 사실이라,
  // 고급 화면 버전 고정(versionO/A · versionY)이나 Y 로케이터 직접 선택으로 더 짧은 페이로드가 그 키에 닿으면 잰 적 없는 영 패딩이다.
  const open = (h) => h.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT && el.getAttribute('aria-disabled') === 'false');
  const lenText = (L) => (L >= 20 ? 'https://tl.estre.so/' + 'x'.repeat(L - 20) : 'x'.repeat(L));
  // [이름, 상태, 밴드 안 길이, 밴드 밖 길이, Y?]
  const cases = [
    ['O2 고정', { ...TYPE_STATES.O, versionO: 2 }, 16, 13, false],
    ['G3 고정(O 자동 = G)', { ...O_AUTO_STATE, versionO: 3 }, 40, 13, false],
    ['A2 고정', { ...TYPE_STATES.A, versionA: 2 }, 60, 13, false],
    ['A1 고정', { ...TYPE_STATES.A, versionA: 1 }, 30, 13, false],
    ['Y v0tr 직접 선택', { ...TYPE_STATES.Y, locatorProfileY: 'cell-surface-v0tr' }, 30, 13, true],
  ];
  const tally = {};
  for (const [name, state, inL, outL, isY] of cases) {
    const make = (L) => {
      const h = harness({ state: { ...state, cellShape: 'bevel' }, payload: lenText(L), quietColor: isY ? 'none' : 'white' });
      // Y 로케이터 직접 선택 — 제품은 그 레이아웃 안에서 최소 해상도를 고른다(index.html effectiveVersionYForEncode →
      // resolveVersionForLayoutSafe — 실물 함수를 꽂는다. 하네스 기본 스텁은 버전 유도를 undefined 로 둔다).
      if (isY) {
        h.c.resolveVersionForLayout = resolveVersionForLayout;
        vm.runInContext(fnSource(INDEX, 'resolveVersionForLayoutSafe'), h.c);
        h.c.effectiveVersionYForEncode = () => h.run('resolveVersionForLayoutSafe()');
      }
      h.render();
      return h;
    };
    const inside = make(inL);
    const outside = make(outL);
    const ctxIn = inside.c.current.deco.ctx;
    const ctxOut = outside.c.current.deco.ctx;
    assert.deepEqual(cellShapeAllowCtx(ctxOut), cellShapeAllowCtx(ctxIn), `${name}: 표 키가 달라졌다 — 대조군이 아니다`);
    assert.equal(ctxIn.measuredStateAtTableKey, true, `${name} ${inL} B: 밴드 안인데 측정 상태가 아니다`);
    assert.equal(ctxOut.measuredStateAtTableKey, false, `${name} ${outL} B: 밴드 밖인데 측정 상태라 한다`);
    const opened = open(inside);
    assert.ok(opened.length > 0, `${name} ${inL} B: 밴드 안에서 열린 카드가 없다 — 대조군이 비었다`);
    assert.equal(open(outside).length, 0, `${name} ${outL} B: 밴드 밖인데 열린 카드가 있다`);
    for (const el of opened) {
      const out = outside.card('cellShape', el.dataset.decoValue);
      assert.equal(out.dataset.lockReason, 'unmeasured', `${name} ${outL} B ${el.dataset.decoValue}`);
      assert.equal(out.dataset.lockKey, 'g1162');
    }
    assert.equal('cellShape' in lastOf(isY ? outside.calls.buildSceneY : outside.calls.buildScene), false, `${name}: 밴드 밖인데 모양이 생산자에 갔다`);
    tally[name] = { version: outside.c.current.encoded.version, opened: opened.length };
  }
  t.diagnostic(`측정 밴드 대조 ${JSON.stringify(tally)}`);
});

test('② 면 게인(Y 제품 경로): 큐브 입체감이 측정(화면용)과 다른 게인이면 열리던 카드가 face-gain(g1212)으로 잠기고, 화면용으로 되돌리면 열린다 · O/A/K 는 게인으로 안 잠긴다', (t) => {
  // 왜(2026-09-28 착지 검토 major): Y 생산자는 면 게인으로 그리는데 셀 꾸미기 문맥에 게인이 없어, 잰 적 없는 «약» · «출력물용» 게인
  // (입체감 카드 · 일반 화면 인쇄용 갈래 · 디더 2 · 고급 슬라이더)에서도 y 행이 열렸다. 게인은 index.html 실물 함수(currentFaceGains)가
  // 만들고 렌더(cellShapeDecoFor)가 넘길 옵션에서 읽는다(producerFaceGains).
  const nonDefault = (h) => h.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT);
  const view = (h) => nonDefault(h).map((el) => `${el.dataset.decoValue}:${el.getAttribute('aria-disabled')}:${el.dataset.lockReason}`);
  const Y = { ...TYPE_STATES.Y, cellShape: 'bevel' };
  const make = (extra) => {
    const h = harness({ state: { ...Y, ...extra }, quietColor: 'none', autoLocatorY: true });
    h.render();
    return h;
  };
  const base = make({});
  const gains = base.c.current.deco.ctx.faceGains;
  assert.ok(gains, '제품 Y 문맥에 면 게인이 없다 — 렌더가 게인을 안 실었다(판정 안 함 = 거짓 열림)');
  assert.deepEqual({ ...gains }, { ...lastOf(base.calls.buildSceneY).palette.faceGains }, '문맥의 게인 ≠ 생산자에 넘긴 게인');
  const baseOpen = nonDefault(base).filter((el) => el.getAttribute('aria-disabled') === 'false');
  assert.ok(baseOpen.length > 0, 'Y 제품 기본에서 열린 카드가 없다 — 대조군이 비었다');
  assert.equal(lastOf(base.calls.buildSceneY).cellShape && lastOf(base.calls.buildSceneY).cellShape.kind, 'bevel');
  // 측정 밖 게인 — 입체감 카드(약 · 출력물용) · 인쇄용 갈래(자동 → 약) · 디더 2(자동 → 출력물용) · 고급 슬라이더(보간 41).
  // **의도적 갱신(2026-09-28 외부 검토 — 디더 축)**: 디더 2 의 게인 차이는 디더의 파생이다(디더를 끄면 자동이 화면용으로 돌아온다) — 한 축
  // (디더)이라 사유는 export-dither(g1213)다. 디더 2 + 인쇄용 갈래는 디더를 꺼도 «약» 이라 두 축 — 미확인(g1162, cell-shape
  // CELL_SHAPE_LOCK_AXES 의 디더 ↔ 면 게인 규칙).
  const variants = [
    ['입체감 약', { renderProfile: 'soft' }, 'face-gain', 'g1212'], ['입체감 출력물용', { renderProfile: 'print' }, 'face-gain', 'g1212'],
    ['인쇄용 갈래(자동)', { exportPpi: EXPORT_PPI_PRINT }, 'face-gain', 'g1212'],
    ['디더 2(자동)', { exportDither: 2 }, 'export-dither', 'g1213'],
    ['디더 2 + 인쇄용 갈래', { exportDither: 2, exportPpi: EXPORT_PPI_PRINT }, 'unmeasured', 'g1162'],
    ['슬라이더 41', { faceGain: 41 }, 'face-gain', 'g1212'],
  ];
  let locked = 0;
  for (const [name, extra, reason, key] of variants) {
    const h = make(extra);
    assert.deepEqual(cellShapeAllowCtx(h.c.current.deco.ctx), cellShapeAllowCtx(base.c.current.deco.ctx), `${name}: 표 키가 달라졌다`);
    const g = h.c.current.deco.ctx.faceGains;
    assert.notDeepEqual({ ...g }, { ...gains }, `${name}: 게인이 안 바뀌었다 — 이 변형의 전제를 다시 볼 것`);
    nonDefault(h).forEach((el, i) => {
      const b = nonDefault(base)[i];
      assert.equal(el.getAttribute('aria-disabled'), 'true', `${name} ${el.dataset.decoValue}: 측정 밖 게인인데 열렸다`);
      if (b.getAttribute('aria-disabled') === 'false') {
        assert.equal(el.dataset.lockReason, reason, `${name} ${el.dataset.decoValue}`);
        assert.equal(el.dataset.lockKey, key);
        if (reason === 'face-gain') locked += 1;
      } else {
        assert.equal(el.dataset.lockReason, b.dataset.lockReason === 'exposed-gap' ? 'unmeasured' : b.dataset.lockReason, `${name} ${el.dataset.decoValue}: 대조군 사유`);
      }
    });
    assert.ok(h.$('cellShapeLockHint').textContent.includes(key), `${name}: 사유 줄에 ${key} 가 없다`);
    if (reason !== 'face-gain') assert.equal(h.$('cellShapeLockHint').textContent.includes('g1212'), false, `${name}: 게인은 디더의 파생이거나 두 축인데 g1212`);
    assert.equal('cellShape' in lastOf(h.calls.buildSceneY), false, `${name}: 잠겼는데 모양이 생산자에 갔다`);
    assert.equal(h.state.cellShape, 'bevel', `${name}: 잠금이 상태를 고쳤다`);
  }
  // 화면용을 명시로 고르면(인쇄용 갈래라도 입체감 카드가 이긴다) 측정 게인이라 다시 열린다.
  const back = make({ exportPpi: EXPORT_PPI_PRINT, renderProfile: 'screen' });
  assert.deepEqual(view(back), view(base), '입체감 화면용으로 되돌렸는데 카드가 안 돌아왔다');
  // O/A/K 는 생산자가 게인을 안 읽는다 — 입체감이 무엇이든 카드가 같다(게인으로 잠그지 않는다).
  for (const [name, state] of [['A', TYPE_STATES.A], ['K', TYPE_STATES.K], ['O 자동', O_AUTO_STATE]]) {
    const ref = harness({ state: { ...state, cellShape: 'bevel' } });
    ref.render();
    const print = harness({ state: { ...state, cellShape: 'bevel', renderProfile: 'print' } });
    print.render();
    assert.equal('faceGains' in print.c.current.deco.ctx, false, `${name}: O/A/K 문맥에 게인이 실렸다`);
    assert.deepEqual(view(print), view(ref), `${name}: 입체감 출력물용에서 카드가 달라졌다`);
  }
  t.diagnostic(`면 게인 잠금 카드 ${locked}`);
  assert.ok(locked > 0);
});

/**
 * 강조 한 축만 바꾼 쌍(base = 측정 구성 강조) — 표 키가 같고, base 에서 열린 카드는 detector-emphasis 로, base 에서도 잠긴 카드는
 * base 와 같은 사유로 잠긴다(반사실 — 강조를 되돌려도 안 열리는 카드에 «강조 탓» 은 틀린 안내). 반환: 강조 사유 카드 수.
 */
function assertEmphasisAxisLocks(name, base, h) {
  assert.deepEqual(cellShapeAllowCtx(h.c.current.deco.ctx), cellShapeAllowCtx(base.c.current.deco.ctx), name + ': 표 키가 달라졌다 — 대조군이 아니다');
  const nonDefault = (x) => x.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT);
  const baseCards = nonDefault(base);
  let axis = 0;
  nonDefault(h).forEach((el, i) => {
    const b = baseCards[i];
    assert.equal(el.dataset.decoValue, b.dataset.decoValue, name + ': 카드 순서');
    assert.equal(el.getAttribute('aria-disabled'), 'true', `${name} ${el.dataset.decoValue}: 측정 밖 강조인데 열렸다`);
    const baseOpen = b.getAttribute('aria-disabled') === 'false';
    const want = baseOpen ? 'detector-emphasis' : (b.dataset.lockReason === 'exposed-gap' ? 'unmeasured' : b.dataset.lockReason);
    assert.equal(el.dataset.lockReason, want, `${name} ${el.dataset.decoValue}: 대조군 ${baseOpen ? '열림' : b.dataset.lockReason}`);
    if (baseOpen) axis += 1;
  });
  assert.equal(h.$('cellShapeLockHint').textContent.includes('g1211'), axis > 0, `${name}: 사유 줄의 g1211 은 측정 구성에서 열린 카드가 있을 때만`);
  return axis;
}

test('② 실효 검출 강조(O · G · A · K 제품 경로): 측정(\'all\')과 다른 그림이면 카드가 잠기고(g1211 — 측정 구성에서 열리던 카드만), 소비 표면이 없으면 무엇을 골라도 강조로는 안 잠긴다', () => {
  const O2 = { ...TYPE_STATES.O, versionO: 2 };
  // 제품 기본 O(자동 안쪽 o-cm → 실효 타입 G) — 중앙 n7 두 팔이라 세 값이 다른 그림. V2 고정(표 키 대조군).
  const G2 = { ...O_AUTO_STATE, versionO: 2 };
  let axis = 0;
  let gAxis = 0;
  // (a) 중앙 TL(강조 대상) + A · K 는 코너 마커 검출 셀 — 'locator' · 'default' 는 측정 구성('all')과 다른 그림이다.
  for (const [name, state, payload] of [['O2', O2, O2_PAYLOAD], ['G2(O 자동)', G2], ['A 자동', TYPE_STATES.A], ['K 자동', TYPE_STATES.K]]) {
    const base = harness({ state: { ...state, centralN7Emphasis: 'all', cellShape: 'bevel' }, payload });
    base.render();
    const baseOpts = lastOf(base.calls.buildScene);
    assert.equal(baseOpts.centralN7Emphasis, 'all', name + ': 대조군 생산자 입력');
    assert.equal(base.c.current.deco.ctx.detectorEmphasis, 'all', name + ': 중앙 TL 은 세 값이 다른 그림');
    assert.equal(baseOpts.cellShape && baseOpts.cellShape.kind, 'bevel', name + ': 측정 구성(강조 all)인데 bevel 이 생산자에 안 갔다');
    for (const mode of ['locator', 'default']) {
      const h = harness({ state: { ...state, centralN7Emphasis: mode, cellShape: 'bevel' }, payload });
      h.render();
      const opts = lastOf(h.calls.buildScene);
      assert.equal(opts.centralN7Emphasis, mode, `${name} ${mode}: 생산자에 넘어간 강조`);
      assert.equal(h.c.current.deco.ctx.detectorEmphasis, mode, `${name} ${mode}: 문맥의 실효 강조`);
      const a = assertEmphasisAxisLocks(`${name} 강조 ${mode}`, base, h);
      axis += a;
      if (state === G2) {
        assert.equal(h.c.current.deco.ctx.type, 'G', `${name} ${mode}: 실효 타입`);
        gAxis += a;
      }
      assert.equal('cellShape' in opts, false, `${name} ${mode}: 잠겼는데 모양이 생산자에 갔다`);
      assert.equal(h.state.cellShape, 'bevel', `${name} ${mode}: 잠금이 상태를 고쳤다`);
      assert.equal(h.state.centralN7Emphasis, mode, `${name} ${mode}: 잠금이 강조 상태를 고쳤다`);
    }
  }
  assert.ok(axis > 0, '강조 사유 카드가 하나도 안 났다 — 자가 비었다');
  assert.ok(gAxis > 0, 'G2(제품 기본 O)에서 강조 사유 카드가 안 났다 — G 의 g1211 문구를 재지 못한다');
  // (b) 소비 표면 없음(O v2 핀휠 · 불스아이 — 대상 아닌 중앙 · 코너 마커 없음): 강조를 무엇으로 골라도 생산자는 그 값을 받지만 그림이
  //     같아 «해당 없음» 이고, 카드 잠금 · 사유 · 생산자에 간 모양이 'all' 과 같다(거짓 잠금 없음).
  let opened = 0;
  for (const finder of ['pinwheel-c2-2-1100-cw', 'bullseye']) {
    const ref = harness({ state: { ...O2, finderPatternId: finder, centralN7Emphasis: 'all', cellShape: 'bevel' }, payload: O2_PAYLOAD });
    ref.render();
    assert.equal(ref.c.current.deco.ctx.detectorEmphasis, CELL_SHAPE_DETECTOR_EMPHASIS_NOT_APPLICABLE, finder + ': 해당 없음이 아니다');
    const view = (x) => x.cards('cellShape').map((el) => `${el.dataset.decoValue}:${el.getAttribute('aria-disabled')}:${el.dataset.lockReason}`);
    opened += ref.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT && el.getAttribute('aria-disabled') === 'false').length;
    for (const mode of ['locator', 'default']) {
      const h = harness({ state: { ...O2, finderPatternId: finder, centralN7Emphasis: mode, cellShape: 'bevel' }, payload: O2_PAYLOAD });
      h.render();
      assert.equal(lastOf(h.calls.buildScene).centralN7Emphasis, mode, `${finder} ${mode}: 생산자 입력`);
      assert.deepEqual(view(h), view(ref), `${finder} ${mode}: 소비 표면이 없는데 카드가 강조에 따라 달라졌다`);
      assert.ok(!view(h).some((v) => v.endsWith(':detector-emphasis')), `${finder} ${mode}: 거짓 강조 잠금`);
      // 두 하네스는 vm 문맥이 달라 객체 원형이 다르다 — 값은 JSON 으로 비교한다.
      assert.equal(JSON.stringify(lastOf(h.calls.buildScene).cellShape), JSON.stringify(lastOf(ref.calls.buildScene).cellShape),
        `${finder} ${mode}: 생산자에 간 모양이 달라졌다`);
    }
  }
  assert.ok(opened > 0, '해당 없음 문맥에서 열린 카드가 없다 — «거짓 잠금 없음» 을 재지 못한다');
});

test('② 실효 검출 강조(Y 제품 경로): 일반 화면은 강조를 안 넘겨 무엇을 골라도 측정 구성이다 · 고급 화면은 넘긴 값이 측정(미전달)과 다른 그림이면 잠긴다', () => {
  const Y = { ...TYPE_STATES.Y, cellShape: 'bevel' };
  const make = (mode, advanced) => {
    const h = harness({ state: { ...Y, centralN7Emphasis: mode }, quietColor: 'none', autoLocatorY: true });
    h.c.advancedOnlyCardsVisible = () => advanced;
    h.render();
    return h;
  };
  const base = make('all', false);
  const baseOpts = lastOf(base.calls.buildSceneY);
  assert.equal('centralN7Emphasis' in baseOpts, false, 'Y 일반 화면이 강조를 넘겼다(renderTypeY 고급 게이트)');
  assert.equal(base.c.current.deco.ctx.detectorEmphasis, 'default', 'Y 셀 표면 로케이터 — 미전달 = 라이브러리 기본 그림');
  const openBase = base.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT && el.getAttribute('aria-disabled') === 'false');
  assert.ok(openBase.length > 0, 'Y 일반 화면에서 열린 카드가 없다 — 자가 비었다');
  assert.equal(baseOpts.cellShape && baseOpts.cellShape.kind, 'bevel', 'Y 일반 화면(측정 구성)의 bevel 이 생산자에 안 갔다');
  const view = (x) => x.cards('cellShape').map((el) => `${el.dataset.decoValue}:${el.getAttribute('aria-disabled')}:${el.dataset.lockReason}`);
  // 일반 화면 — 상태 강조가 무엇이든 생산자 입력 · 카드가 같다.
  for (const mode of ['locator', 'default']) {
    const h = make(mode, false);
    assert.equal('centralN7Emphasis' in lastOf(h.calls.buildSceneY), false, `일반 ${mode}: 강조를 넘겼다`);
    assert.deepEqual(view(h), view(base), `일반 ${mode}: 넘기지 않은 강조로 카드가 달라졌다`);
  }
  // 고급 화면 — 상태 강조를 넘긴다. 'all' · 'locator' 는 검출 셀 팔 하나라 같은 그림(측정과 다름), 'default' 는 측정과 같은 그림.
  let axis = 0;
  for (const mode of ['all', 'locator']) {
    const h = make(mode, true);
    const opts = lastOf(h.calls.buildSceneY);
    assert.equal(opts.centralN7Emphasis, mode, `고급 ${mode}: 생산자 입력`);
    assert.equal(h.c.current.deco.ctx.detectorEmphasis, 'locator+all', `고급 ${mode}: 문맥의 실효 강조`);
    axis += assertEmphasisAxisLocks(`Y 고급 ${mode}`, base, h);
    assert.equal('cellShape' in opts, false, `고급 ${mode}: 잠겼는데 모양이 생산자에 갔다`);
  }
  assert.ok(axis > 0);
  const back = make('default', true);
  assert.equal(lastOf(back.calls.buildSceneY).centralN7Emphasis, 'default', '고급 default: 생산자 입력');
  assert.deepEqual(view(back), view(base), '고급 화면에서 강조를 측정 구성(기본)으로 되돌렸는데 카드가 안 돌아왔다');
  assert.equal(lastOf(back.calls.buildSceneY).cellShape && lastOf(back.calls.buildSceneY).cellShape.kind, 'bevel');
});

// ── 내보내기 축(디더 · 고정/커스텀 크기)과 사유 축 개수 — 2026-09-28 외부 검토 major 셋 ─────────────────────────────
//
// 왜: 허용표 행은 비디더 · 잰 하한(MEASURED_FLOORS) 이상 ppu 에서만 잰 사실인데, (1) 디더 내보내기(O/A/K 는 면 게인도 안 바뀌어 아무것도
// 안 잠갔다)와 (2) 고정(192 · 512 px) · 커스텀 크기(minPpu 를 안 쓴다 — 잰 하한 아래 ppu)가 꾸민 심볼을 그대로 내보냈고, (3) 두 축이 함께
// 다르면 앞 축 사유를 냈다(그 축만 따라서는 안 열리는 틀린 안내). 셋 다 제품 경로(index.html 실물 render · exportPlanFor)로 잰다.

/** 길이 L 바이트 본문(20 B 이상은 제품 기본 URL 접두어) — ECC 실현 조건 자와 같은 규칙. */
const exportLenText = (L) => (L >= 20 ? 'https://tl.estre.so/' + 'x'.repeat(L - 20) : 'x'.repeat(L));
/** Y 제품 자동 사다리(generator-auto-y resolveAutoY — 제품 함수)의 답 — 하네스는 버전 유도를 스텁하므로 이 값을 넣는다. */
const yAutoOf = (L) => resolveAutoY({ payloadBytes: L, tones: 3, eccLevel: 'auto' });
/**
 * 내보내기 축 자의 문맥 격자 — 표에 행이 있는 (타입 · 버전/n) 여럿의 제품 경로 상태 · 본문 길이. 수치(행 · 하한 · ppu)는 박제하지 않는다 —
 * 열린 카드가 있는지 · 잰 하한 키가 표에 있는지 · 계획 ppu 가 하한 아래인지는 자가 유도한다. Y 는 제품 기본(투명 · 판 없음)으로 그린다.
 */
const EXPORT_GRID = Object.freeze([
  { name: 'O v2(안쪽 없음)', state: TYPE_STATES.O, L: 16 },
  { name: 'G v2(O 자동)', state: O_AUTO_STATE, L: 19 },
  { name: 'G v3(O 자동)', state: O_AUTO_STATE, L: 35 },
  { name: 'A v0', state: TYPE_STATES.A, L: 19 },
  { name: 'A v1', state: TYPE_STATES.A, L: 30 },
  { name: 'A v2', state: TYPE_STATES.A, L: 60 },
  { name: 'K v0', state: TYPE_STATES.K, L: 19 },
  { name: 'Y n13', state: TYPE_STATES.Y, L: 19, y: true },
  { name: 'Y n21', state: TYPE_STATES.Y, L: 25, y: true },
  { name: 'Y n25', state: TYPE_STATES.Y, L: 60, y: true },
]);

/** 격자 한 칸을 그린다 — `extra` 는 상태 덮어쓰기, `patch` 는 하네스 이음매(고급 화면 등). */
function exportHarness(entry, extra = {}, patch = null, source = INDEX) {
  const state = { ...entry.state, ...(entry.y ? { locatorProfileY: yAutoOf(entry.L).locatorProfileY } : {}), ...extra };
  const h = harness({ state, payload: exportLenText(entry.L), quietColor: entry.y ? 'none' : 'white', source });
  if (entry.y) h.c.effectiveVersionYForEncode = () => yAutoOf(entry.L).version;
  if (patch) patch(h);
  h.render();
  return h;
}
const nonDefaultCards = (h) => h.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT);
const cardView = (h) => nonDefaultCards(h).map((el) => `${el.dataset.decoValue}:${el.getAttribute('aria-disabled')}:${el.dataset.lockReason}:${el.dataset.lockKey}`);
const producerOpts = (h) => lastOf(h.c.current.type === 'Y' ? h.calls.buildSceneY : h.calls.buildScene);
/** 격자 한 칸의 대조군(내보내기 기본 — 자동 맞춤 · 디더 자동)과 거기서 열린 셀 모양 하나(그 모양을 골라 둔다 — 미리보기 · 생산자 대조용). */
function exportBase(entry) {
  const probe = exportHarness(entry);
  const open = nonDefaultCards(probe).filter((el) => el.getAttribute('aria-disabled') === 'false').map((el) => el.dataset.decoValue);
  assert.ok(open.length > 0, `${entry.name}: 대조군에서 열린 카드가 없다 — 격자 칸이 표 행이 있는 문맥이 아니다`);
  const shape = open.includes('bevel') ? 'bevel' : open[0];
  const base = exportHarness(entry, { cellShape: shape });
  assert.equal(producerOpts(base).cellShape && producerOpts(base).cellShape.kind, shape, `${entry.name}: 대조군의 열린 ${shape} 가 생산자에 안 갔다`);
  return { base, shape };
}
/**
 * 한 축만(또는 여러 축을) 바꾼 렌더 h 의 카드가 대조군 base 에 비해 `reason` 으로 잠겼는가 — base 에서 열린 카드는 `reason`(사전 키 `key`),
 * base 에서도 잠긴 카드는 base 사유(흰 틈 탓 exposed-gap 은 다른 축도 다르니 unmeasured). 반환: `reason` 카드 수.
 */
function assertLockedAs(name, base, h, reason, key) {
  assert.deepEqual(cellShapeAllowCtx(h.c.current.deco.ctx), cellShapeAllowCtx(base.c.current.deco.ctx), `${name}: 표 키가 달라졌다 — 대조군이 아니다`);
  const baseCards = nonDefaultCards(base);
  let n = 0;
  nonDefaultCards(h).forEach((el, i) => {
    const b = baseCards[i];
    assert.equal(el.dataset.decoValue, b.dataset.decoValue, name + ': 카드 순서');
    assert.equal(el.getAttribute('aria-disabled'), 'true', `${name} ${el.dataset.decoValue}: 잠겨야 하는데 열렸다`);
    if (b.getAttribute('aria-disabled') === 'false') {
      assert.equal(el.dataset.lockReason, reason, `${name} ${el.dataset.decoValue}: 대조군에서 열린 카드`);
      assert.equal(el.dataset.lockKey, key, `${name} ${el.dataset.decoValue}: 사전 키`);
      n += 1;
    } else {
      assert.equal(el.dataset.lockReason, b.dataset.lockReason === 'exposed-gap' ? 'unmeasured' : b.dataset.lockReason,
        `${name} ${el.dataset.decoValue}: 대조군 사유(${b.dataset.lockReason})`);
    }
  });
  assert.ok(n > 0, `${name}: ${reason} 카드가 없다 — 대조군에서 열린 카드가 있었는데`);
  assert.ok(h.$('cellShapeLockHint').textContent.includes(key), `${name}: 사유 줄에 ${key} 가 없다`);
  // 잠겼으니 미리보기(생산자 입력)에 모양이 없다 — 상태는 그대로(되돌리면 다시 켜진다).
  assert.equal('cellShape' in producerOpts(h), false, `${name}: 잠겼는데 모양이 생산자에 갔다`);
  assert.equal(h.state.cellShape, base.state.cellShape, `${name}: 잠금이 상태를 고쳤다`);
  return n;
}
/** 내보내기 크기 선택지 — 고정 프리셋 전부(export-options EXPORT_FIXED_SIZES) · 커스텀 둘 · 자동 셋. */
const EXPORT_SIZE_CASES = Object.freeze([
  ...EXPORT_FIXED_SIZES.map((size) => [`${size} px`, { exportSize: size }]),
  ['커스텀 300×300', { exportSize: 'custom', exportWidth: 300, exportHeight: 300 }],
  ['커스텀 4000×220', { exportSize: 'custom', exportWidth: 4000, exportHeight: 220 }],
  ['커스텀 8000×8000', { exportSize: 'custom', exportWidth: 8000, exportHeight: 8000 }],
  ...['auto-min', 'auto-fit', 'auto-high'].map((mode) => [`자동 ${mode}`, { exportSize: mode }]),
]);

test('② 내보내기 크기(제품 경로): 고정 · 커스텀 크기의 계획 ppu 가 그 표 키의 잰 하한보다 낮으면 열리던 카드가 export-size(g1214)로 잠기고 미리보기도 사각이다 · 자동 크기 셋은 하한을 지켜 안 잠근다(타입 × 버전)', (t) => {
  const floors = DEFAULT_ALLOW.MEASURED_FLOORS;
  const tally = {};
  for (const entry of EXPORT_GRID) {
    const { base } = exportBase(entry);
    const plan0 = base.c.current.deco.ctx.exportPlan;
    assert.ok(plan0 && typeof plan0.floorKey === 'string', `${entry.name}: 렌더 문맥에 내보내기 계획(잰 하한 키)이 없다`);
    assert.ok(Object.prototype.hasOwnProperty.call(floors, plan0.floorKey), `${entry.name}: 잰 하한 키 ${plan0.floorKey} 가 표에 없다`);
    const floor = floors[plan0.floorKey];
    const row = { locked: [], open: [] };
    for (const [label, extra] of EXPORT_SIZE_CASES) {
      const h = exportHarness(entry, { cellShape: base.state.cellShape, ...extra });
      const { plan } = h.run("exportPlanFor('png')");
      assert.equal(h.c.current.deco.ctx.exportPlan.ppu, plan.ppu, `${entry.name} ${label}: 문맥의 ppu ≠ 내보내기 계획의 ppu`);
      const below = plan.ppu < floor;
      if (String(extra.exportSize).startsWith('auto')) assert.equal(below, false, `${entry.name} ${label}: 자동 크기가 잰 하한(${floor}) 아래 ppu ${plan.ppu}`);
      if (below) {
        assertLockedAs(`${entry.name} ${label}(ppu ${plan.ppu.toFixed(2)} < ${floor})`, base, h, 'export-size', 'g1214');
        row.locked.push(label);
      } else {
        assert.deepEqual(cardView(h), cardView(base), `${entry.name} ${label}: 잰 하한 이상(ppu ${plan.ppu.toFixed(2)} ≥ ${floor})인데 카드가 달라졌다`);
        assert.equal(producerOpts(h).cellShape && producerOpts(h).cellShape.kind, base.state.cellShape, `${entry.name} ${label}: 열린 모양이 생산자에 안 갔다`);
        row.open.push(label);
      }
    }
    // 판별력 — 격자 칸마다 잠긴 크기와 열린 크기가 둘 다 있다(192 px 는 모든 잰 하한 아래 · 자동은 위).
    assert.ok(row.locked.includes('192 px'), `${entry.name}: 192 px 가 잠기지 않았다 — ${JSON.stringify(row)}`);
    assert.ok(row.open.length > 0, `${entry.name}: 열린 크기가 없다`);
    tally[entry.name] = `잠김 ${row.locked.join('·')} | 열림 ${row.open.join('·')}`;
  }
  t.diagnostic(JSON.stringify(tally));
});

test('② 내보내기 디더(제품 경로): 양자화하는 비트깊이면 열리던 카드가 export-dither(g1213)로 잠기고 미리보기도 사각이다 · 24비트(항등)는 안 잠근다 · Y 는 디더가 바꾼 면 게인을 디더 한 축으로 센다', (t) => {
  const bitsAll = DITHER_BIT_DEPTHS;
  assert.ok(bitsAll.includes(24) && bitsAll.some((b) => b !== 24), '비트깊이 도메인 전제');
  let locked = 0;
  let yGainShift = 0;
  for (const entry of EXPORT_GRID) {
    const { base } = exportBase(entry);
    for (const bits of bitsAll) {
      const h = exportHarness(entry, { cellShape: base.state.cellShape, exportDither: bits });
      const name = `${entry.name} 디더 ${bits}`;
      if (bits === 24) {
        // 24 = 항등(dither.js — 픽셀 그대로): 측정과 같은 그림이라 잠그지 않는다.
        assert.equal(h.c.current.deco.ctx.exportPlan.dithered, false, name + ': 항등을 디더로 셌다');
        assert.deepEqual(cardView(h), cardView(base), name + ': 항등 비트깊이에서 카드가 달라졌다');
        continue;
      }
      assert.equal(h.c.current.deco.ctx.exportPlan.dithered, true, name);
      locked += assertLockedAs(name, base, h, 'export-dither', 'g1213');
      if (entry.y) {
        // 디더 2 · 4 는 자동 입체감을 바꿔(출력물용 · 약) 면 게인이 측정 밖이다 — 그래도 사유는 디더다(디더를 끄면 화면용으로 돌아온다).
        const shifted = JSON.stringify({ ...h.c.current.deco.ctx.faceGains }) !== JSON.stringify({ ...base.c.current.deco.ctx.faceGains });
        if (shifted) {
          yGainShift += 1;
          assert.equal(h.$('cellShapeLockHint').textContent.includes('g1212'), false, name + ': 게인 차이는 디더의 파생인데 g1212');
        }
      }
    }
    if (entry.y) {
      // 입체감을 화면용으로 명시하면 디더 2 에서도 게인이 측정 값이다 — 디더 한 축(같은 사유).
      const h = exportHarness(entry, { cellShape: base.state.cellShape, exportDither: 2, renderProfile: 'screen' });
      assert.deepEqual({ ...h.c.current.deco.ctx.faceGains }, { ...base.c.current.deco.ctx.faceGains }, entry.name + ': 화면용 명시 게인');
      assertLockedAs(`${entry.name} 디더 2 + 화면용 명시`, base, h, 'export-dither', 'g1213');
      // 디더를 꺼도 게인이 측정 밖(약 명시)이면 두 축 — 미확인.
      const two = exportHarness(entry, { cellShape: base.state.cellShape, exportDither: 2, renderProfile: 'soft' });
      assertLockedAs(`${entry.name} 디더 2 + 약 명시`, base, two, 'unmeasured', 'g1162');
    }
  }
  t.diagnostic(`디더 잠금 카드 ${locked} · Y 게인이 바뀐 디더 렌더 ${yGainShift}`);
  assert.ok(yGainShift > 0, 'Y 에서 디더가 면 게인을 바꾼 렌더가 없다 — 디더 ↔ 면 게인 규칙을 재지 못했다');
});

/**
 * 사유 축 개수 자의 격자 — 표 키가 바뀌지 않게 버전을 고정하거나(O · G V2) 자동 버전이 그대로인 짧은 본문(A · K · Y 13 B)이다. 축마다
 * 그 축만 측정 밖으로 바꾸는 상태(덮어쓰기)와 하네스 이음매(Y 강조는 고급 화면에서만 넘어간다).
 */
const AXIS_GRID = Object.freeze([
  { name: 'O2(안쪽 없음)', entry: { name: 'O2', state: { ...TYPE_STATES.O, versionO: 2 }, L: 16 },
    axes: { 'seat-config': { deepSeat: 'sagoae' }, 'ecc-level': { eccLevel: 'M' }, 'detector-emphasis': { centralN7Emphasis: 'default' } } },
  { name: 'G2(O 자동)', entry: { name: 'G2', state: { ...O_AUTO_STATE, versionO: 2 }, L: 13 },
    axes: { 'seat-config': { deepSeat: 'sagoae' }, 'ecc-level': { eccLevel: 'M' }, 'detector-emphasis': { centralN7Emphasis: 'default' } } },
  { name: 'A', entry: { name: 'A', state: TYPE_STATES.A, L: 13 },
    axes: { 'seat-config': { outerSeat: 'none' }, 'ecc-level': { eccLevel: 'M' }, 'detector-emphasis': { centralN7Emphasis: 'default' } } },
  { name: 'K', entry: { name: 'K', state: TYPE_STATES.K, L: 13 },
    axes: { 'seat-config': { outerSeat: 'none' }, 'ecc-level': { eccLevel: 'M' }, 'detector-emphasis': { centralN7Emphasis: 'locator' } } },
  { name: 'Y n13', entry: { name: 'Y', state: TYPE_STATES.Y, L: 13, y: true },
    axes: { 'ecc-level': { eccLevel: 'M' }, 'detector-emphasis': { centralN7Emphasis: 'all', '@advanced': true }, 'face-gain': { renderProfile: 'soft' } } },
]);
/** 모든 칸에 공통인 내보내기 축(한 축씩) — 디더 16 · 고정 192 px. */
const EXPORT_AXES = Object.freeze({ 'export-dither': { exportDither: 16 }, 'export-size': { exportSize: 192 } });
const AXIS_KEYS = Object.freeze({
  'seat-config': 'g1209', 'ecc-level': 'g1210', 'detector-emphasis': 'g1211', 'face-gain': 'g1212', 'export-dither': 'g1213', 'export-size': 'g1214',
});

test('② 사유 축 개수(제품 경로): 한 축만 다르면 그 축 사유이고 그 축만 되돌리면 열린다 · 두 축이 다르면 미확인(g1162)이고 어느 한 축만 되돌려서는 안 열린다(잠금 여부는 같다)', (t) => {
  const counts = { single: 0, pair: 0 };
  for (const { name, entry, axes: own } of AXIS_GRID) {
    const axes = { ...own, ...EXPORT_AXES };
    const probe = exportBase(entry);
    const shape = probe.shape;
    const render = (reasons) => {
      const extra = { cellShape: shape };
      let advanced = false;
      for (const r of reasons) {
        const { '@advanced': adv, ...rest } = axes[r];
        Object.assign(extra, rest);
        if (adv) advanced = true;
      }
      return exportHarness(entry, extra, advanced ? (h) => { h.c.advancedOnlyCardsVisible = () => true; } : null);
    };
    const base = render([]);
    const singles = new Map();
    for (const r of Object.keys(axes)) {
      const h = render([r]);
      assertLockedAs(`${name} ${r}`, base, h, r, AXIS_KEYS[r]);
      singles.set(r, h);
      counts.single += 1;
    }
    const names = Object.keys(axes);
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const [a, b] = [names[i], names[j]];
        const h = render([a, b]);
        assertLockedAs(`${name} ${a} + ${b}`, base, h, 'unmeasured', 'g1162');
        // 틀린 안내가 없다 — 두 축 중 어느 쪽 사유도 사유 줄에 없다.
        for (const r of [a, b]) {
          assert.equal(h.$('cellShapeLockHint').textContent.includes(AXIS_KEYS[r]), false, `${name} ${a} + ${b}: 사유 줄에 ${r}(${AXIS_KEYS[r]})`);
        }
        // «그 축만 따르면» — 한 축만 되돌린 렌더(= 다른 한 축만 다른 렌더)에서 대조군이 연 카드는 여전히 잠긴다(그 남은 축 사유로).
        for (const [kept, other] of [[a, b], [b, a]]) {
          const followed = singles.get(kept);
          nonDefaultCards(base).forEach((bc, k) => {
            if (bc.getAttribute('aria-disabled') !== 'false') return;
            const el = nonDefaultCards(followed)[k];
            assert.equal(el.getAttribute('aria-disabled'), 'true', `${name} ${a} + ${b}: ${other} 만 되돌렸는데 ${el.dataset.decoValue} 가 열렸다`);
          });
        }
        counts.pair += 1;
      }
    }
  }
  t.diagnostic(JSON.stringify(counts));
  assert.ok(counts.pair >= AXIS_GRID.length * 3, JSON.stringify(counts));
});

/**
 * 축 사유를 «따르는» 상태 덮어쓰기 — 사유 문구가 가리키는 설정을 측정 값으로 돌린다(그 축만). 자리는 그 칸의 제품 기본 자리(측정 자리),
 * ECC 는 측정 H, 강조는 측정 값(O/A/K 'all' · Y 는 고급 화면에서도 'default' = 미전달과 같은 그림), 입체감은 화면용 · 슬라이더 100,
 * 디더는 자동(양자화 없음), 크기는 자동 맞춤(제품 기본).
 */
function followAxis(reason, entry) {
  const s = createGeneratorState({ qrPosition: 'TL', ...entry.state });
  return {
    'seat-config': { innerSeat: s.innerSeat, deepSeat: s.deepSeat, outerSeat: s.outerSeat },
    'ecc-level': { eccLevel: 'H' },
    'detector-emphasis': { centralN7Emphasis: entry.y ? 'default' : 'all' },
    'face-gain': { renderProfile: 'screen', faceGain: 100 },
    'export-dither': { exportDither: EXPORT_DITHER_AUTO },
    'export-size': { exportSize: 'auto-fit' },
  }[reason];
}

test('② 사유는 참이다(제품 경로 — 따르면 열린다): 축 사유 카드는 그 축만 따르면 열리고, 측정 구성에서 열리는 카드가 미확인이면 어느 한 축만 따라서는 안 열린다 · 파인더 · 강조 값을 넓힌 격자', (t) => {
  const grid = [
    ...AXIS_GRID,
    // 중앙 검출기가 강조 대상이 아닌 파인더 — 강조가 코너 마커 검출 셀에서만 갈린다(자리를 바꾸면 강조 축이 드러나거나 숨는 문맥).
    { name: 'A 불스아이', entry: { name: 'A 불스아이', state: { ...TYPE_STATES.A, finderPatternId: 'bullseye' }, L: 13 },
      axes: { 'seat-config': { outerSeat: 'none' }, 'ecc-level': { eccLevel: 'M' }, 'detector-emphasis': { centralN7Emphasis: 'default' } } },
    { name: 'K 불스아이', entry: { name: 'K 불스아이', state: { ...TYPE_STATES.K, finderPatternId: 'bullseye' }, L: 13 },
      axes: { 'seat-config': { outerSeat: 'none' }, 'detector-emphasis': { centralN7Emphasis: 'locator' } } },
    { name: 'O2 핀휠', entry: { name: 'O2 핀휠', state: { ...TYPE_STATES.O, versionO: 2, finderPatternId: 'pinwheel-c2-2-1100-cw' }, L: 16 },
      axes: { 'seat-config': { deepSeat: 'sagoae' }, 'detector-emphasis': { centralN7Emphasis: 'default' } } },
  ];
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  for (const { name, entry, axes: own } of grid) {
    const axes = { ...own, ...EXPORT_AXES };
    const draw = (extra, advanced) => {
      try {
        return exportHarness(entry, extra, advanced ? (h) => { h.c.advancedOnlyCardsVisible = () => true; } : null);
      } catch (err) {
        return null; // 렌더 오류(인코더 배타 등) — 이 조합은 화면에 못 온다
      }
    };
    const perturb = (reasons) => {
      const extra = {};
      let advanced = false;
      for (const r of reasons) {
        const { '@advanced': adv, ...rest } = axes[r];
        Object.assign(extra, rest);
        if (adv) advanced = true;
      }
      return { extra, advanced };
    };
    const keys = Object.keys(axes);
    const sets = [...keys.map((k) => [k]), ...keys.flatMap((a, i) => keys.slice(i + 1).map((b) => [a, b]))];
    for (const shape of ['bevel', 'round']) {
      const base = draw({ cellShape: shape }, false);
      if (!base) continue;
      for (const set of sets) {
        const { extra, advanced } = perturb(set);
        const h = draw({ cellShape: shape, ...extra }, advanced);
        if (!h) { bump('render-error'); continue; }
        const followed = new Map();
        const follow = (r) => {
          if (!followed.has(r)) {
            // 그 축만 따른다 — 나머지 흔든 축(과 고급 화면)은 그대로. Y 강조는 고급 화면에서 측정 값을 넘겨 따른다.
            followed.set(r, draw({ cellShape: shape, ...extra, ...followAxis(r, entry) }, advanced));
          }
          return followed.get(r);
        };
        nonDefaultCards(h).forEach((el, i) => {
          const reason = el.dataset.lockReason;
          const where = `${name} [${set.join(' + ')}] ${shape} 카드 ${el.dataset.decoValue} → ${reason || '열림'}`;
          if (AXIS_KEYS[reason]) {
            const f = follow(reason);
            assert.ok(f, where + ': 따른 상태를 못 그린다');
            assert.equal(nonDefaultCards(f)[i].getAttribute('aria-disabled'), 'false',
              `${where}: 그 축(${reason})만 따랐는데 안 열린다 — 틀린 안내(${nonDefaultCards(f)[i].dataset.lockReason})`);
            bump(`axis:${reason}`);
          } else if (reason === 'unmeasured' && nonDefaultCards(base)[i].getAttribute('aria-disabled') === 'false') {
            // 측정 구성(흔들기 전)에서는 열리는 카드 — 어느 한 축만 따라서는 안 열려야 «판독이 확인되지 않은 조합» 이 맞는 안내다.
            for (const r of set) {
              const f = follow(r);
              if (!f) continue;
              assert.equal(nonDefaultCards(f)[i].getAttribute('aria-disabled'), 'true', `${where}: ${r} 만 따랐는데 열린다 — «${r} 탓» 이어야`);
            }
            bump(set.length > 1 ? 'unmeasured:multi' : 'unmeasured:single');
          }
        });
      }
    }
  }
  t.diagnostic(JSON.stringify(counts));
  for (const k of ['axis:seat-config', 'axis:ecc-level', 'axis:detector-emphasis', 'axis:face-gain', 'axis:export-dither', 'axis:export-size',
    'unmeasured:multi']) {
    assert.ok(counts[k] > 0, `갈래 ${k} 가 격자에서 안 났다 — ${JSON.stringify(counts)}`);
  }
});

test('② 미리보기 ↔ 내보내기(제품 경로): 내보내기 축으로 잠기면 미리보기도 꾸미기 끈 렌더와 같고(장면 JSON), 내보내기 장면 = 미리보기 장면(여백 포함은 같은 객체 · 여백 없음은 같은 옵션으로 재생성) · 셀 모양은 장면 치수를 안 바꾼다', () => {
  const decorated = (scene) => scene.shapes.some((s) => s.basePoints);
  let checked = 0;
  for (const entry of EXPORT_GRID) {
    const { base, shape } = exportBase(entry);
    for (const [label, extra] of [['자동 맞춤', {}], ['192 px', { exportSize: 192 }], ['디더 16', { exportDither: 16 }],
      ['여백 없음 · 자동 맞춤', { exportMargin: 'trim' }], ['여백 없음 · 512 px', { exportMargin: 'trim', exportSize: 512 }],
      ['여백 없음 · 커스텀 300×300', { exportMargin: 'trim', exportSize: 'custom', exportWidth: 300, exportHeight: 300 }]]) {
      const name = `${entry.name} ${label}`;
      const h = exportHarness(entry, { cellShape: shape, ...extra });
      const square = exportHarness(entry, { cellShape: CELL_SHAPE_DEFAULT, ...extra });
      const open = h.card('cellShape', shape).getAttribute('aria-disabled') === 'false';
      assert.equal(Boolean(h.c.current.sceneOpts.cellShape), open, `${name}: 카드 판정과 렌더 옵션이 어긋난다`);
      assert.equal(decorated(h.c.current.scene), open, `${name}: 미리보기 장면의 꾸밈이 카드 판정과 어긋난다`);
      // 셀 모양은 장면 치수를 안 바꾼다 — 내보내기 계획(고정 · 커스텀 ppu)이 모양과 무관하다(두 번째 렌더의 계획 = 첫 렌더의 계획).
      assert.deepEqual([h.c.current.scene.width, h.c.current.scene.height], [square.c.current.scene.width, square.c.current.scene.height],
        `${name}: 셀 모양이 장면 치수를 바꿨다`);
      if (!open) {
        assert.equal(JSON.stringify(h.c.current.scene), JSON.stringify(square.c.current.scene), `${name}: 잠긴 렌더 ≠ 꾸미기 끈 렌더`);
        assert.equal(JSON.stringify(h.c.current.encoded.cellDigits ? [...h.c.current.encoded.cellDigits.entries()] : null),
          JSON.stringify(square.c.current.encoded.cellDigits ? [...square.c.current.encoded.cellDigits.entries()] : null), `${name}: 인코딩이 다르다`);
      }
      const exported = h.run("exportPlanFor('png')").scene;
      if (extra.exportMargin === 'trim') {
        assert.equal(decorated(exported), open, `${name}: 내보내기(여백 없음 재생성) 장면의 꾸밈이 미리보기와 어긋난다`);
      } else {
        assert.equal(exported, h.c.current.scene, `${name}: 내보내기 장면이 미리보기 장면이 아니다`);
      }
      checked += 1;
    }
    assert.ok(base.c.current.sceneOpts.cellShape, `${entry.name}: 대조군이 열려 있지 않다`);
  }
  assert.ok(checked > 0);
});

test('② 잰 하한 키 = index.html 내보내기 호출 모양의 하한 키(제품 경로 — 실효 타입 → 생성기 타입 · Y n ↔ 버전) · 표에 행이 있는 표 키에서', (t) => {
  let n = 0;
  const byType = new Set();
  for (const entry of EXPORT_GRID) {
    for (const extra of [{}, { exportSize: 512 }, { exportMargin: 'trim' }]) {
      const h = exportHarness(entry, extra);
      const ctx = h.c.current.deco.ctx;
      const called = h.calls.minRoundtripPpu;
      assert.ok(called.length > 0, `${entry.name}: 내보내기 계획이 minRoundtripPpu 를 안 불렀다`);
      // index.html exportPlanFor 가 실제로 넘긴 문맥(호출 모양) — 셀 꾸미기 판정이 쓴 잰 하한 키와 같은 키여야 한다.
      const product = minRoundtripPpuKey(lastOf(called));
      assert.equal(ctx.exportPlan.floorKey, product, `${entry.name} ${JSON.stringify(extra)}: 잰 하한 키 ${ctx.exportPlan.floorKey} ≠ 호출 모양 ${product} (${JSON.stringify(lastOf(called))})`);
      assert.ok(Object.prototype.hasOwnProperty.call(DEFAULT_ALLOW.MEASURED_FLOORS, product), `${entry.name}: 호출 모양의 키 ${product} 가 표에 없다`);
      byType.add(ctx.type);
      n += 1;
    }
  }
  t.diagnostic(`대조 ${n} · 실효 타입 ${[...byType].join(',')}`);
  for (const ty of ['O', 'G', 'A', 'K', 'Y']) assert.ok(byType.has(ty), `실효 타입 ${ty} 를 재지 않았다`);
});

/** 내보내기 설정을 바꾸고 문서 이벤트를 흘렸을 때 렌더가 예약되는가(트리거) — 상태는 그 컨트롤의 핸들러가 바꾼 것처럼 직접 바꾼다. */
function exportTriggerSchedules(h, patch, kind) {
  Object.assign(h.state, patch);
  h.pending.length = 0;
  h.dispatchDocument(kind);
  return h.pending.length > 0;
}

test('④ 내보내기 축의 파생값 트리거 — 크기 · 커스텀 폭 · 여백 없음 · 디더가 바뀌면(어느 컨트롤이든 문서 이벤트 한 곳) 렌더가 예약되고 카드 · 미리보기가 다시 판정된다 · 안 바뀌면 예약하지 않는다', () => {
  const entry = EXPORT_GRID.find((e) => e.name === 'A v0');
  const { base, shape } = exportBase(entry);
  const h = exportHarness(entry, { cellShape: shape });
  assert.deepEqual(cardView(h), cardView(base));
  // 바뀐 것이 없으면 예약하지 않는다(모든 클릭마다 렌더하지 않는다).
  assert.equal(exportTriggerSchedules(h, {}, 'click'), false, '계획이 그대로인데 렌더를 예약했다');
  // 크기 select(change) → 잠금.
  assert.equal(exportTriggerSchedules(h, { exportSize: 192 }, 'change'), true, '크기를 192 로 바꿨는데 렌더가 예약되지 않았다');
  h.render();
  assertLockedAs('트리거 192 px', base, h, 'export-size', 'g1214');
  // 자동으로 되돌리면 다시 열린다.
  assert.equal(exportTriggerSchedules(h, { exportSize: 'auto-fit' }, 'change'), true);
  h.render();
  assert.deepEqual(cardView(h), cardView(base), '자동 맞춤으로 되돌렸는데 카드가 안 돌아왔다');
  assert.equal(producerOpts(h).cellShape.kind, shape);
  // 커스텀 폭 · 높이(input) — 작은 크기는 잠그고 큰 크기는 연다.
  assert.equal(exportTriggerSchedules(h, { exportSize: 'custom', exportWidth: 300, exportHeight: 300 }, 'input'), true);
  h.render();
  assertLockedAs('트리거 커스텀 300', base, h, 'export-size', 'g1214');
  assert.equal(exportTriggerSchedules(h, { exportWidth: 8000, exportHeight: 8000 }, 'input'), true);
  h.render();
  assert.deepEqual(cardView(h), cardView(base), '커스텀을 크게 바꿨는데 카드가 안 돌아왔다');
  // 디더(change).
  assert.equal(exportTriggerSchedules(h, { exportDither: 16 }, 'change'), true);
  h.render();
  assertLockedAs('트리거 디더 16', base, h, 'export-dither', 'g1213');
  // 여백 없음(change) — 고정 크기에서 여백 없음이 장면 치수(→ 계획 ppu)를 바꾸는 격자 칸에서 잰다(칸은 계획으로 고른다 — O 는 기본 여백이
  // 이미 최소고, 코너 QR 이 있으면 여백 없음도 코너 QR 하한(20)이라 무동작이다: 그래서 QR 없음으로 그린다 — 카드 열림은 이 단언과 무관하다).
  let trimmed = 0;
  for (const e of EXPORT_GRID) {
    const x = exportHarness(e, { cellShape: 'bevel', exportSize: 512, qrPosition: 'none' });
    const ppu = x.run("exportPlanFor('png')").plan.ppu;
    x.state.exportMargin = 'trim';
    const ppuTrim = x.run("exportPlanFor('png')").plan.ppu;
    x.state.exportMargin = 'margin';
    if (ppu === ppuTrim) {
      assert.equal(exportTriggerSchedules(x, { exportMargin: 'trim' }, 'change'), false, `${e.name}: 계획이 그대로인데 예약했다`);
      continue;
    }
    assert.equal(exportTriggerSchedules(x, { exportMargin: 'trim' }, 'change'), true, `${e.name}: 여백 없음이 고정 크기 ppu 를 바꿨는데(${ppu} → ${ppuTrim}) 렌더가 예약되지 않았다`);
    x.render();
    assert.equal(x.c.current.deco.ctx.exportPlan.ppu, ppuTrim, `${e.name}: 다시 그린 문맥의 ppu 가 여백 없음 계획이 아니다`);
    trimmed += 1;
  }
  assert.ok(trimmed > 0, '여백 없음이 고정 크기 ppu 를 바꾸는 격자 칸이 없다 — 여백 없음 트리거를 재지 못했다');
});

test('④ 심은 결함 — 문서 이벤트 트리거 · 두 번째 렌더를 지우면 위 자들이 빨개진다(자의 판별력)', () => {
  const entry = EXPORT_GRID.find((e) => e.name === 'A v0');
  const { shape } = exportBase(entry);
  // (a) 트리거 배선 삭제 — 크기를 바꿔도 렌더가 예약되지 않는다.
  const listener = "for (const kind of ['change', 'input', 'click']) {\n  document.addEventListener(kind, () => {";
  assert.ok(INDEX.includes(listener), '트리거 배선 철자가 바뀌었다 — 결함 심기를 갱신할 것');
  const noTrigger = INDEX.replace(listener, "for (const kind of []) {\n  document.addEventListener(kind, () => {");
  const real = exportHarness(entry, { cellShape: shape });
  assert.equal(exportTriggerSchedules(real, { exportSize: 192 }, 'change'), true, '대조군: 실제 index.html 은 예약해야 한다');
  const planted = exportHarness(entry, { cellShape: shape }, null, noTrigger);
  assert.equal(exportTriggerSchedules(planted, { exportSize: 192 }, 'change'), false, '심은 결함(트리거 삭제)을 자가 못 가른다');
  // (b) 두 번째 렌더 삭제(판정만 갈아 끼움) — 카드는 잠기는데 미리보기 · 내보내기에 모양이 남는다(미리보기 ↔ 내보내기 자가 잡는 형태).
  const second = '        cfg.exportPlan = exportPlan;\n        result = renderCurrent();\n'
    + '        current = { ...current, scene: result.scene, sceneOpts: result.sceneOpts, deco: result.deco };\n';
  assert.ok(INDEX.includes(second), '두 번째 렌더 철자가 바뀌었다 — 결함 심기를 갱신할 것');
  const noSecond = INDEX.replace(second, '        current.deco = deco;\n');
  const broken = exportHarness(entry, { cellShape: shape, exportSize: 192 }, null, noSecond);
  assert.equal(broken.card('cellShape', shape).getAttribute('aria-disabled'), 'true', '심은 결함에서도 카드 판정은 잠금이다');
  assert.equal(Boolean(broken.c.current.sceneOpts.cellShape), true, '심은 결함(두 번째 렌더 삭제)인데 미리보기가 사각이다 — 자가 결함을 못 본다');
  const fixed = exportHarness(entry, { cellShape: shape, exportSize: 192 });
  assert.equal(Boolean(fixed.c.current.sceneOpts.cellShape), false, '대조군: 실제 index.html 은 잠기면 미리보기가 사각이다');
});

test('② C(ultra)는 모든 모양이 «C 는 사각만» 사유로 잠긴다(구조 잠금 — fixture 로도 안 열린다)', () => {
  const probe = harness({ state: { type: 'O', versionO: 'ultra' } });
  probe.render();
  const ctx = probe.c.current.deco.ctx;
  assert.equal(ctx.type, 'C');
  const h = harness({ state: { type: 'O', versionO: 'ultra' }, allow: { ROWS: openAllCellRows(ctx) } });
  h.render();
  for (const el of h.cards('cellShape')) {
    if (el.dataset.decoValue === CELL_SHAPE_DEFAULT) continue;
    assert.equal(el.dataset.lockReason, 'type-c-ultra', el.dataset.decoValue);
  }
  assert.ok(h.$('cellShapeLockHint').textContent.includes('g1166'));
});

// ── ③ 기본값 = 키 부재 ───────────────────────────────────────────────────

test('③ 기본 상태에서는 어떤 타입도 생산자에 꾸미기 키를 넘기지 않는다 — 빈 표 · 제품 기본표(생성본) · 전부 연 fixture 셋 다', () => {
  for (const [type, state] of Object.entries(TYPE_STATES)) {
    const stub = harness({ state, allow: STUB });
    stub.render();
    assertNoDecorationKeys(stub, type, '빈 표');
    const h = harness({ state });
    h.render();
    assertNoDecorationKeys(h, type, '제품 기본표');
    // 다 열어 둔 표에서도 기본(끔)이면 키가 없다 — «끔 = 현재 출력» 은 표가 아니라 기본값이 보장한다.
    const ctx = h.c.current.deco ? h.c.current.deco.ctx : null;
    const rows = ctx ? openAllCellRows(ctx) : [];
    const g = harness({ state, allow: { ROWS: rows } });
    g.render();
    assertNoDecorationKeys(g, type, '열린 표');
  }
});

// ── ④ fixture → 카드 열림 → 생산자 도달 → 끔 복귀 ─────────────────────────────

function openShapeHarness(type) {
  // Y 는 제품 기본 «자동» 로케이터 — 스키마 기본 'off' 는 제품 화면이 아니고 측정 상태도 아니라 fixture 행으로도 안 열린다.
  const autoLocatorY = type === 'Y';
  const probe = harness({ state: TYPE_STATES[type], autoLocatorY });
  probe.render();
  const ctx = probe.c.current.deco.ctx;
  assert.ok(ctx, type + ': 렌더가 셀 모양 문맥을 current 에 안 남겼다');
  return harness({ state: TYPE_STATES[type], allow: { ROWS: openAllCellRows(ctx) }, autoLocatorY });
}

/** K 는 손 조립 경로다 — 카드 클릭이 buildScene 옵션까지 가는가(값 하나로 판정, 심은 결함 비교용). */
function shapeReachesProducer(type, source) {
  const autoLocatorY = type === 'Y';
  const probe = harness({ state: TYPE_STATES[type], source, autoLocatorY });
  probe.render();
  const h = harness({ state: TYPE_STATES[type], source, allow: { ROWS: openAllCellRows(probe.c.current.deco.ctx) }, autoLocatorY });
  h.render();
  h.click('cellShape', 'round');
  const opts = lastOf(type === 'Y' ? h.calls.buildSceneY : h.calls.buildScene);
  return Boolean(opts.cellShape && opts.cellShape.kind === 'round');
}

test('④ fixture 허용표 → 마름모 카드가 열리고, 클릭이 O · A · K(손 조립) · Y 생산자까지 가며 미리보기가 바뀐다', () => {
  for (const type of ['O', 'A', 'K', 'Y']) {
    const h = openShapeHarness(type);
    h.render();
    const before = JSON.stringify(lastOf(h.calls.draws).shapes.map((s) => s.points ?? [s.cx, s.cy, s.r]));
    for (const el of h.cards('cellShape')) {
      if (el.dataset.decoValue === 'dot' && type === 'O') continue; // 기본 파인더 문맥에서 dot 은 T3 한정 — 열림 여부는 표가 정한다
      assert.equal(el.getAttribute('aria-disabled'), 'false', `${type}: ${el.dataset.decoValue} 카드가 fixture 에서도 잠겨 있다(${el.dataset.lockReason})`);
    }
    h.click('cellShape', 'round');
    assert.equal(h.state.cellShape, 'round');
    const opts = lastOf(type === 'Y' ? h.calls.buildSceneY : h.calls.buildScene);
    assert.equal(opts.cellShape.kind, 'round', type + ': spec 이 생산자에 안 갔다');
    assert.equal(opts.cellShape.param, CELL_SHAPE_PARAMS.round.default);
    assert.equal(JSON.stringify(opts.cellShape.avoid), JSON.stringify([{ r: 255, g: 255, b: 255 }]), type + ': 안전영역 판 색이 avoid 로 안 갔다');
    const scene = lastOf(h.calls.draws);
    assert.ok(scene.shapes.some((s) => s.basePoints), type + ': 미리보기 scene 에 꾸민 도형이 없다');
    assert.notEqual(JSON.stringify(scene.shapes.map((s) => s.points ?? [s.cx, s.cy, s.r])), before, type + ': 미리보기가 안 바뀌었다');
    // 강도 카드 → 같은 경로
    h.click('cellRound', 1);
    assert.equal(lastOf(type === 'Y' ? h.calls.buildSceneY : h.calls.buildScene).cellShape.param, 1);
    // 켬 → 끔: 키가 다시 사라진다(D1 이 넘긴 «클릭 경로 뒤 부재» 축)
    h.click('cellShape', CELL_SHAPE_DEFAULT);
    assertNoDecorationKeys(h, type, '켬→끔');
  }
});

test('④ 파생값 트리거 — 렌더 뒤 안전영역 실효 색이 바뀌면 재렌더가 예약되고 resolver 가 새 틈 등급으로 다시 판정한다', () => {
  const h = openShapeHarness('O');
  h.render();
  h.click('cellShape', 'round');
  assert.equal(lastOf(h.calls.buildScene).cellShape.kind, 'round');
  assert.equal(h.c.current.deco.ctx.gapGrade, 'white');
  // 배치 사진 측정 등으로 quiet-auto 가 «판 없음» 으로 바뀐 상황 — 투명 배경이라 틈은 미지 표면이다.
  h.c.quietColor = 'none';
  h.pending.length = 0;
  h.run('maybeRerenderForQuietAuto()');
  assert.equal(h.pending.length, 1, '실효 색이 바뀌었는데 재렌더가 예약되지 않았다');
  h.render();
  assert.equal(h.c.current.deco.ctx.gapGrade, 'unknown');
  assert.equal('cellShape' in lastOf(h.calls.buildScene), false, '미지 표면인데 노출형 모양이 그대로 나갔다');
  assert.equal(h.card('cellShape', 'round').dataset.lockReason, 'exposed-gap');
  assert.equal(h.state.cellShape, 'round', '잠겨도 상태는 그대로(되돌아오면 다시 켜진다)');
  h.c.quietColor = 'white';
  h.run('maybeRerenderForQuietAuto()');
  h.render();
  assert.equal(lastOf(h.calls.buildScene).cellShape.kind, 'round', '판이 돌아왔는데 모양이 안 돌아왔다');
});

test('④ 심은 결함 — K 손 조립에서 spec 대입 줄을 지우면 위 자가 빨개진다(자의 판별력)', () => {
  assert.equal(shapeReachesProducer('K', INDEX), true, '대조군: 실제 index.html 에서는 K 가 spec 을 받아야 한다');
  const kStart = INDEX.indexOf('\nfunction renderTypeK(');
  const kBody = INDEX.slice(kStart, INDEX.indexOf('\n}\n', kStart));
  const line = '  if (deco.spec) sceneOpts.cellShape = deco.spec;\n';
  assert.ok(kBody.includes(line), 'K 대입 줄 철자가 바뀌었다 — 결함 심기를 갱신할 것');
  const broken = INDEX.slice(0, kStart) + kBody.replace(line, '') + INDEX.slice(kStart + kBody.length);
  assert.equal(shapeReachesProducer('K', broken), false, 'spec 대입을 지웠는데도 K 가 spec 을 받는다 — 자가 경로를 안 잰다');
});

test('④ fixture 허용표 → H 스타일 카드 · 코너 QR 꾸미기가 renderTypeH · hSceneOptions · hQr.deco 까지 간다', () => {
  const probe = harness({ state: TYPE_STATES.H });
  probe.render();
  const hctx = hCellStyleCtx(probe.c.current.encoded, probe.state);
  const rows = [
    { table: 'h', ...hctx, ground: H_CELL_GROUND_DEFAULT, hCellStyle: 'dots' },
    { table: 'qr', host: 'h', qrCellStyle: 'dots', qrColorMode: 'default', eyeMode: 'none' },
  ];
  const h = harness({ state: TYPE_STATES.H, allow: { ROWS: rows } });
  h.render();
  assert.equal(h.card('hCellStyle', 'dots').getAttribute('aria-disabled'), 'false');
  assert.equal(h.card('hCellStyle', 'rounded').getAttribute('aria-disabled'), 'true');
  h.click('hCellStyle', 'dots');
  assert.equal(lastOf(h.calls.buildHScene).hCellStyle, 'dots', 'renderTypeH 가 H 셀 스타일을 안 받았다');
  assert.equal(h.run('hSceneOptions()').hCellStyle, 'dots', 'hSceneOptions(회전 · 3D-on · 스냅샷)가 안 받았다');
  assert.ok(lastOf(h.calls.draws).shapes.some((s) => s.hCellGround), 'H 미리보기에 바탕 도형이 없다');
  assert.equal(h.card('qrCellStyle', 'dots').getAttribute('aria-disabled'), 'false');
  h.click('qrCellStyle', 'dots');
  assert.equal(h.c.current.hQr.deco.cellStyle, 'dots', 'hQr.deco 가 안 실렸다');
  assert.equal(lastOf(h.calls.withHCornerQr).deco.cellStyle, 'dots');
  h.click('qrCellStyle', 'square');
  h.click('hCellStyle', H_CELL_STYLE_DEFAULT);
  assertNoDecorationKeys(h, 'H', '켬→끔');
});

test('④ fixture 허용표 → O 코너 QR 꾸미기가 paletteOf(palette.qrDeco)로 생산자까지 가고, Y 호스트는 구조 잠금이다', () => {
  const rows = [
    { table: 'qr', host: 'oak', qrCellStyle: 'dots', qrColorMode: 'default', eyeMode: 'none' },
    { table: 'qr', host: 'oak', qrCellStyle: 'square', qrColorMode: 'match', eyeMode: 'none' },
    { table: 'qr', host: 'y', qrCellStyle: 'dots', qrColorMode: 'default', eyeMode: 'none' },
  ];
  const h = harness({ state: TYPE_STATES.O, allow: { ROWS: rows } });
  h.render();
  assert.equal(h.$('qrDecoSection').hidden, false, '코너 QR 이 있는데 꾸미기 섹션이 숨었다');
  assert.equal(h.card('qrCellStyle', 'dots').getAttribute('aria-disabled'), 'false');
  assert.equal(h.card('qrColorMode', 'match').getAttribute('aria-disabled'), 'false');
  // 흑백 + «더 어둡게» 눈은 기본 출력과 같다 → 조용한 무동작 대신 잠금 + 사유.
  assert.equal(h.card('qrEye', 'darker').dataset.lockReason, 'noop');
  h.click('qrCellStyle', 'dots');
  assert.equal(lastOf(h.calls.buildScene).palette.qrDeco.cellStyle, 'dots', 'palette.qrDeco 가 생산자에 안 갔다');
  assert.ok(lastOf(h.calls.draws).shapes.some((s) => s.selfQuiet && s.noSeam), '꾸민 QR 조각(selfQuiet · noSeam)이 미리보기에 없다');
  // 조합(dots + match)은 표에 없다 → 그 카드는 잠기고, 고른 조합만 막힌다.
  assert.equal(h.card('qrColorMode', 'match').dataset.lockReason, 'qr-unmeasured');
  // Y 호스트: 표에 행이 있어도 구조 잠금(통합자 결정 3).
  const y = harness({ state: TYPE_STATES.Y, allow: { ROWS: rows } });
  y.render();
  assert.equal(y.card('qrCellStyle', 'dots').dataset.lockReason, 'qr-y-host');
  y.click('qrCellStyle', 'square');
  assertNoDecorationKeys(y, 'Y', 'Y 구조 잠금');
});

test('④ 폴백 QR 섹션 노출은 buildConfig().fallback 에서 유도된다(코너 · 중앙+병행 · 없음)', () => {
  const corner = harness({ state: { type: 'O', qrPosition: 'TL' } });
  corner.render();
  assert.equal(corner.$('qrDecoSection').hidden, false);
  assert.equal(corner.$('qrFixedBwHint').hidden, true);
  const none = harness({ state: { type: 'O', qrPosition: 'none' } });
  none.render();
  assert.equal(none.$('qrDecoSection').hidden, true);
  const center = harness({ state: { type: 'O', qrPosition: 'inner', finderPatternId: CENTER_QR_FINDER_PATTERN_ID } });
  center.render();
  assert.equal(center.$('qrDecoSection').hidden, true, '중앙 QR 단독인데 섹션이 열렸다');
  assert.equal(center.$('qrFixedBwHint').hidden, false, '중앙 QR 흑백 고정 힌트가 없다');
  center.state.qrCornerToo = true;
  center.run('syncDecorationUi()');
  assert.equal(center.$('qrDecoSection').hidden, false, '중앙 QR + 코너 병행인데 섹션이 숨었다');
});

// ── ⑤ 사유 · 라벨 사전 ─────────────────────────────────────────────────────

test('⑤ 잠금 사유 id 전부가 사전 키로 매핑되고, 꾸미기 문구 키가 8언어에 모두 있다', () => {
  const h = harness();
  const map = h.run('DECORATION_LOCK_REASON_KEYS');
  const unmapped = DECORATION_LOCK_REASON_IDS.filter((id) => !Object.prototype.hasOwnProperty.call(map, id));
  assert.deepEqual(unmapped, [], '사전 키가 없는 잠금 사유 — 일반 문구로 조용히 떨어진다');
  const keys = new Set([
    ...Object.values(map),
    ...Object.values(h.run('DECORATION_VALUE_LABEL_KEYS')).flatMap((m) => Object.values(m)),
    ...Object.values(h.run('CELL_SHAPE_PARAM_LABEL_KEYS')),
    ...[...INDEX.matchAll(/data-i18n(?:-attr="aria-label:|=")(g1[12]\d\d)"/g)].map((m) => m[1]).filter((k) => Number(k.slice(1)) >= 1151),
    h.run('DECORATION_EXPOSED_GAP_PLAIN_KEY'),
    'g1180', 'g1204', 'g1205',
  ]);
  assert.ok(keys.size >= 40, '꾸미기 키가 너무 적다 — 파서가 깨졌나: ' + keys.size);
  // 마름모 셀 라벨은 사각 셀 어휘(H · QR 스타일 9종)와 키를 나누지 않는다 — 공유하면 en «Square» · de «Quadrat» 처럼
  // 60°/120° 마름모를 정사각형이라 부른다(i18n-coverage 는 이 뜻 충돌을 못 잡는다).
  const squareKeys = new Set(Object.values(h.run('SQUARE_STYLE_LABEL_KEYS')));
  const rhombusShared = Object.entries(h.run('DECORATION_VALUE_LABEL_KEYS').cellShape).filter(([, k]) => squareKeys.has(k));
  assert.deepEqual(rhombusShared, [], '마름모 셀 카드가 사각 셀 라벨 키를 쓴다');
  for (const lang of LANGS) {
    const block = langBlock(lang);
    for (const key of keys) assert.match(block, new RegExp(`"${key}":`), `${lang} 에 ${key} 가 없다`);
  }
});

// ── ⑥ data-state-keys 배치 (D1 이양 자) ─────────────────────────────────────

test('⑥ 꾸미기 14키는 #sharedControls 에만, customSat 은 customHue 와 같은 패널들에 있다', () => {
  const keysOf = (id) => {
    const m = new RegExp('<div id="' + id + '"[^>]*data-state-keys="([^"]+)"').exec(INDEX);
    assert.ok(m, id);
    return m[1].trim().split(/\s+/);
  };
  const containers = ['sharedContent', 'sharedControls', 'panelNormal', 'panelAdvanced'];
  const where = (key) => containers.filter((id) => keysOf(id).includes(key));
  assert.deepEqual(where('customSat'), where('customHue'));
  for (const key of DECORATION_STATE_KEYS.filter((k) => k !== 'customSat')) assert.deepEqual(where(key), ['sharedControls'], key);
  for (const key of DECORATION_STATE_KEYS) assert.ok(exposedGeneratorStateKeys('normal').includes(key), key);
});

// ── ⑦ Canvas seam ─────────────────────────────────────────────────────────

test('⑦ 실제 Canvas drawScene 은 noSeam 도형에 seam stroke 를 긋지 않는다(qr 도 마찬가지, 보통 도형은 긋는다)', () => {
  const draw = new Function('window', 'rgbCss', 'backdropShowing', 'paintShading', 'drawSceneImage',
    'return (' + fnSource(INDEX, 'drawScene') + ');')({ devicePixelRatio: 1 }, (c) => `rgb(${c.r},${c.g},${c.b})`, () => false, () => {}, () => {});
  const sq = (x, extra = {}) => ({ kind: 'polygon', color: { r: 10, g: 20, b: 30 }, points: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 1 }, { x, y: 1 }], ...extra });
  const scene = { width: 10, height: 2, background: null, shapes: [sq(0), sq(2, { noSeam: true }), sq(4, { qr: true }), sq(6, { noSeam: true, qr: true })] };
  const strokes = [];
  let index = -1;
  const ctx = { setTransform() {}, clearRect() {}, fillRect() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {}, fill() {}, beginPath() { index += 1; }, stroke() { strokes.push(index); } };
  draw(scene, { getContext: () => ctx, classList: { toggle() {} } }, 10);
  assert.deepEqual(strokes, [0]);
});

// ── ⑧ 파일명 꼬리표 ────────────────────────────────────────────────────────

test('⑧ 파일명 꼬리표 — 기본이면 빈 문자열, 켜면 렌더된 spec · deco · 채도에서 읽는다', () => {
  const plain = harness({ state: TYPE_STATES.O });
  plain.render();
  assert.equal(plain.run('exportDecorationTag()'), '');
  const h = openShapeHarness('O');
  h.render();
  h.click('cellShape', 'round');
  assert.equal(h.run('exportDecorationTag()'), '-round70');
  // 3D · 전개도 · 인쇄 파일은 모양이 안 실린다(§4.4) — 거기엔 모양 꼬리표가 붙지 않는다.
  assert.equal(h.run("exportDecorationTag('3d')"), '');
  h.click('cellShape', 'bevel');
  assert.equal(h.run('exportDecorationTag()'), '-bevel06');
  // 커스텀으로 바꾸면 팔레트 등급이 slate → custom 이라 fixture(slate 문맥) 행이 안 맞아 bevel 이 잠긴다 —
  // 꼬리표는 상태가 아니라 **렌더된 것**을 말하므로 -bevel06 이 빠지고 -sat150 만 남는다.
  h.state.preset = 'custom';
  h.state.customSat = 150;
  h.render();
  assert.equal(h.run('exportDecorationTag()'), '-sat150');
  assert.equal(h.run("exportDecorationTag('3d')"), '-sat150', '채도는 3D 팔레트에도 닿으므로 3D 파일명에도 붙는다');
  assert.equal(h.state.cellShape, 'bevel', '잠겨도 상태는 그대로다');
  // 잠긴 선택(빈 표 주입)은 렌더되지 않았으므로 꼬리표도 없다.
  const locked = harness({ state: { ...TYPE_STATES.O, cellShape: 'round', qrCellStyle: 'dots' }, allow: STUB });
  locked.render();
  assert.equal(locked.run('exportDecorationTag()'), '');
});

test('⑧ QR 꼬리표 ⇔ 코너 QR 꾸미기가 렌더된 장면을 실제로 바꾼다(폴백 격자 — QR 없음 · 중앙 단독에서는 없다)', () => {
  // 대조 기준은 index 의 술어가 아니라 **생산자 자신**이다: palette.qrDeco 를 뺀 옵션으로 같은 인코딩을 다시 만들어
  // 장면이 달라지면 코너 QR 꾸미기가 그려진 것이다. paletteOf 는 폴백 모드를 모른 채 qrDeco 를 붙이므로(QR 없음 ·
  // 중앙 단독에서도 키가 있다), palette.qrDeco 만 보는 꼬리표는 이 격자에서 빨갛다.
  const rows = [{ table: 'qr', host: 'oak', qrCellStyle: 'dots', qrColorMode: 'default', eyeMode: 'none' }];
  const center = { qrPosition: 'inner', finderPatternId: CENTER_QR_FINDER_PATTERN_ID };
  const grid = [
    ['O 코너', { type: 'O', qrPosition: 'TL' }],
    ['O 없음', { type: 'O', qrPosition: 'none' }],
    ['O 중앙 단독', { type: 'O', ...center }],
    ['O 중앙+병행', { type: 'O', ...center, qrCornerToo: true }],
    ['A 코너', { type: 'A', qrPosition: 'BR' }],
    ['A 없음', { type: 'A', qrPosition: 'none' }],
    ['K 코너', { type: 'K', qrPosition: 'TL' }],
    ['K 없음', { type: 'K', qrPosition: 'none' }],
  ];
  const seen = { drawn: 0, keyButNotDrawn: 0 };
  for (const [name, state] of grid) {
    const h = harness({ state: { ...state, qrCellStyle: 'dots' }, allow: { ROWS: rows } });
    h.render();
    const opts = lastOf(h.calls.buildScene);
    const enc = h.c.current.encoded;
    const { qrDeco, ...plainPalette } = opts.palette;
    const drawn = qrDeco !== undefined
      && JSON.stringify(buildScene(enc, opts)) !== JSON.stringify(buildScene(enc, { ...opts, palette: plainPalette }));
    if (drawn) seen.drawn += 1;
    if (qrDeco !== undefined && !drawn) seen.keyButNotDrawn += 1;
    const tag = h.run('exportDecorationTag()');
    assert.equal(tag.includes('-qr'), drawn, `${name}: 꼬리표(${tag || '없음'})가 렌더와 어긋난다 — 코너 QR 꾸미기 ${drawn ? '있음' : '없음'}`);
  }
  // 자가 비지 않았는가 — 양쪽 진리값과 «키는 있는데 안 그려진» 함정 칸이 모두 격자에 있어야 한다.
  assert.ok(seen.drawn >= 3, '코너 QR 꾸미기가 그려진 칸이 너무 적다: ' + seen.drawn);
  assert.ok(seen.keyButNotDrawn >= 3, 'palette.qrDeco 는 있는데 안 그려진 칸이 너무 적다(함정 칸 부재): ' + seen.keyButNotDrawn);
});

test('채도 바는 커스텀을 고르고 decorationValueFromInput 로 정규화한다(문자열이 기본값으로 튀지 않는다)', () => {
  const h = harness({ state: { type: 'O', preset: 'slate' } });
  const bar = h.$('customSatBar');
  bar.value = '155';
  bar.dispatch('input');
  assert.equal(h.state.customSat, 155);
  assert.equal(h.state.preset, 'custom');
  assert.equal(h.pending.length > 0, true, '채도 이동이 렌더를 예약하지 않았다');
  // paletteOf 가 같은 채도로 기저 팔레트를 만든다(커스텀 채도가 렌더 팔레트에 닿는다).
  h.render();
  const expected = makeCustomPalette(h.state.customHue, 'x', 155).levels;
  assert.deepEqual(lastOf(h.calls.buildScene).palette.levels, expected);
});
