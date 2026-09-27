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
 *      실효 검출 강조(2026-09-27)도 같은 규칙이다 — 생산자에 넘어간 강조가 측정(O/A/K 'all' · Y 미전달)과 다른 그림이면
 *      잠기고(detector-emphasis g1211), 강조를 소비하는 표면이 없으면 무엇을 골라도 강조로는 안 잠긴다. Y 는 고급 화면에서만 넘긴다.
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
  centralBeaconEncoderOptions, encodeOptionsForY, detectorEmphasisEquivalents,
} from '../src/generator-render-config.js';
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
import { resolveAutoY } from '../src/generator-auto-y.js';
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
  const calls = { buildScene: [], buildSceneY: [], buildHScene: [], withHCornerQr: [], draws: [] };
  const pending = [];
  const c = {
    console, Math, Number, String, Object, Array, Set, Map, JSON, Error, RangeError, TypeError, structuredClone,
    generatorState, current: null, keptPayload: null, hFaceImages: Object.freeze({}), hFacePositionMode: 'off',
    hPositionProfile: null, lastEncodedYn: 0, lastEncodedKA: 0, lastEncodedKO: 0, quietColorAtRender: null,
    quietAutoRerenders: 0, QUIET_AUTO_RERENDER_LIMIT: 2,
    y3dPreview: { on: true, pad: 24 }, Y3D_PAD_BASE: 24, hAnimation: { elapsed: 0, scene: null },
    document: { createElement: (tag) => makeNode(null, tag) }, window: { devicePixelRatio: 1 },
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
    detectorEmphasisEquivalents,
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
    selfCheckMarkup: () => '', deltaMinFor: () => 0.2, profileFaceGains: () => ({ T: 1, L: 0.72, R: 0.57 }),
    currentFaceGains: () => ({ T: 1, L: 0.72, R: 0.57 }), resolvedRenderProfile: () => 'screen',
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
  for (const name of ['resolveFallback', 'resolvedQrText', 'buildConfig', 'encodeOptsFor', 'encodeWithEcc',
    'isCapacityError', 'eccTierLabel', 'paletteOf', 'sceneOptsForOA', 'renderTypeO', 'renderTypeA', 'renderTypeK',
    'renderTypeY', 'renderTypeH', 'hSceneOptions', 'maybeRerenderForQuietAuto', 'render']) {
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
  return { c, $, run, render, cards, card, click, calls, pending, state: generatorState };
}

const lastOf = (list) => list[list.length - 1];

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
  // 빈 표(스텁 주입) — 흰 틈 형제 행이 없으니 «틈 탓» 이 아니다: 미확인(g1162)이고 틈 문구는 둘 다 안 보인다.
  const stub = harness({ state, quietColor: 'none', allow: STUB });
  stub.render();
  assert.equal(stub.card('cellShape', 'round').dataset.lockReason, 'unmeasured', '형제 행 없는 표에서 «틈 탓» 사유가 나왔다');
  const plainKey = stub.run('DECORATION_EXPOSED_GAP_PLAIN_KEY');
  assert.equal(stub.card('cellShape', 'round').dataset.lockKey, 'g1162');
  for (const k of [plainKey, 'g1164']) assert.ok(!stub.$('cellShapeLockHint').textContent.includes(k), `스텁 표인데 틈 문구 ${k} 가 보인다`);
  // 흰 틈 형제 행이 **흰 바탕에만** 있는 fixture — 틈이 가르는 축이라 exposed-gap 이지만, 안전영역만 흰색으로 두면
  // (투명 바탕 그대로) 열리지 않으므로 권유 없는 문구다.
  const white = harness({ state, quietColor: 'white' });
  white.render();
  const bgWhiteRows = openAllCellRows({ ...white.c.current.deco.ctx, bgMode: 'white' });
  const plain = harness({ state, quietColor: 'none', allow: { ROWS: bgWhiteRows } });
  plain.render();
  assert.equal(plain.card('cellShape', 'round').dataset.lockReason, 'exposed-gap', '흰 틈 형제 행이 있는데 틈 사유가 아니다');
  assert.equal(plain.card('cellShape', 'round').dataset.lockKey, plainKey);
  assert.ok(plain.$('cellShapeLockHint').textContent.includes(plainKey));
  assert.ok(!plain.$('cellShapeLockHint').textContent.includes('g1164'), '안전영역 흰색으로는 안 열리는데 권유 문구가 보인다');
  // 흰 판 문맥에서 열리는 fixture — 권유가 참이 되고, 따르면(안전영역 흰색) 정말 열린다.
  const probe = harness({ state, quietColor: 'white' });
  probe.render();
  const h = harness({ state, quietColor: 'none', allow: { ROWS: openAllCellRows(probe.c.current.deco.ctx) } });
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
  // O 는 버전을 V2 로 고정한다 — 표 행이 있는 버전이고, 사괘 · ECC 를 바꿔도 같은 버전에 머물러 표 키가 같다(대조군).
  const O2 = { ...TYPE_STATES.O, versionO: 2 };
  // A v1 은 표 행이 없는 버전이다(행은 A v0 뿐) — 측정 구성이어도 잠기니 «자리 탓» 이 아니라 미확인 · 설계 잠금이어야 한다.
  const A1 = { ...TYPE_STATES.A, versionA: 1, cellBevel: 1.4 };
  // 제품 기본 O(자동 안쪽 o-cm → 실효 타입 G)도 V2 로 고정한다 — 제품 첫 화면의 표면이라 사유 문구의 참/거짓을 UI 경로로 잰다
  // (2026-09-27 검토 minor). 자동 버전에서는 사괘 · ECC 가 재인코딩으로 버전을 바꿔 표 키가 달라질 수 있다(대조군이 아니다).
  const G2 = { ...O_AUTO_STATE, versionO: 2 };
  const pairs = [
    // [이름, 측정 구성 상태, 한 축만 바꾼 상태, 그 축의 사유, 사전 키]
    ['A 바깥 없음', TYPE_STATES.A, { ...TYPE_STATES.A, outerSeat: 'none' }, 'seat-config', 'g1209'],
    ['K 바깥 없음', TYPE_STATES.K, { ...TYPE_STATES.K, outerSeat: 'none' }, 'seat-config', 'g1209'],
    ['O2 사괘(수동)', O2, { ...O2, deepSeat: 'sagoae' }, 'seat-config', 'g1209'],
    ['O2 ECC M', O2, { ...O2, eccLevel: 'M' }, 'ecc-level', 'g1210'],
    ['G2(O 자동) 사괘(수동)', G2, { ...G2, deepSeat: 'sagoae' }, 'seat-config', 'g1209'],
    ['G2(O 자동) ECC M', G2, { ...G2, eccLevel: 'M' }, 'ecc-level', 'g1210'],
    ['G2(O 자동) ECC L', G2, { ...G2, eccLevel: 'L' }, 'ecc-level', 'g1210'],
    ['A ECC L', TYPE_STATES.A, { ...TYPE_STATES.A, eccLevel: 'L' }, 'ecc-level', 'g1210'],
    ['K ECC M', TYPE_STATES.K, { ...TYPE_STATES.K, eccLevel: 'M' }, 'ecc-level', 'g1210'],
    ['A1 바깥 없음 · 돌출 bevel(행 없는 버전)', A1, { ...A1, outerSeat: 'none' }, 'seat-config', 'g1209'],
    ['K 바깥 없음 · 돌출 bevel', { ...TYPE_STATES.K, cellBevel: 1.4 }, { ...TYPE_STATES.K, cellBevel: 1.4, outerSeat: 'none' }, 'seat-config', 'g1209'],
  ];
  const seen = { axis: 0, kept: 0 };
  const axisBy = {};
  for (const [name, baseState, state, reason, key] of pairs) {
    const base = harness({ state: { ...baseState, cellShape: 'bevel' } });
    base.render();
    const h = harness({ state: { ...state, cellShape: 'bevel' } });
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
      if (baseOpen) { axis += 1; seen.axis += 1; } else seen.kept += 1;
    });
    assert.equal(h.$('cellShapeLockHint').textContent.includes(key), axis > 0, `${name}: 사유 줄의 ${key} 는 측정 구성에서 열린 카드가 있을 때만`);
    assert.equal('cellShape' in lastOf(h.calls.buildScene), false, name + ': 잠겼는데 모양이 생산자에 갔다');
    assert.equal(h.state.cellShape, 'bevel', name + ': 잠금이 상태를 고쳤다');
    axisBy[name] = axis;
  }
  // 판별력: 두 갈래가 모두 났다 — «축 사유» 카드와 «대조군 사유 유지» 카드(돌출 bevel · 행 없는 버전).
  assert.ok(seen.axis > 0 && seen.kept > 0, JSON.stringify(seen));
  // G(제품 기본 O) 쌍은 축 사유 카드가 실제로 났다 — 대조군이 전부 잠긴 쌍이면 사유 문구를 재지 못한다.
  for (const name of Object.keys(axisBy).filter((n) => n.startsWith('G2'))) {
    assert.ok(axisBy[name] > 0, `${name}: 측정 구성(G2)에서 열린 카드가 없다 — 사유 문구를 재지 못한다 ${JSON.stringify(axisBy)}`);
  }
  // 측정 구성 쪽은 열린다(위 쌍의 대조군이 비지 않았다) — A · K · O · G 기본에서 bevel 이 생산자까지 간다.
  for (const [name, state] of [['A', TYPE_STATES.A], ['K', TYPE_STATES.K], ['O2', O2], ['G2(O 자동)', G2]]) {
    const h = harness({ state: { ...state, cellShape: 'bevel' } });
    h.render();
    assert.equal(lastOf(h.calls.buildScene).cellShape && lastOf(h.calls.buildScene).cellShape.kind, 'bevel', name + ': 측정 구성인데 bevel 이 안 갔다');
  }
  // 매퍼가 사괘를 떨구는 조합은 와이어가 측정 구성과 같다 — 상태 표지(deepSeat)로 잠그면 거짓 잠금이다.
  // 두 쌍 다 표 행이 있는 버전에서 잰다(O daehan 은 V3 — daehan 행은 V3 에만 있다). 행이 없는 버전이면 두 팔이 모두
  // 미확인으로 잠겨 «열린 채» 를 못 잰다(2026-09-27 검토 — 옛 쌍은 하네스 페이로드의 자동 V2 에서 둘 다 잠겨 있었다).
  for (const [name, state] of [
    ['A 자동 a-cm + 사괘 선택', { ...TYPE_STATES.A, deepSeat: 'sagoae', cellShape: 'bevel' }],
    ['O3 daehan + 사괘 선택', { ...TYPE_STATES.O, versionO: 3, finderPatternId: 'oak-daehan-k10', deepSeat: 'sagoae', cellShape: 'bevel' }],
  ]) {
    const without = harness({ state: { ...state, deepSeat: 'none' } });
    without.render();
    const h = harness({ state });
    h.render();
    assert.equal(h.c.current.encoded.sagoae, false, name + ': 매퍼가 사괘를 떨구지 않았다 — 대조의 전제가 깨졌다');
    assert.deepEqual(reasons(h), reasons(without), name + ': 사괘 선택만 더했는데 카드 잠금이 달라졌다');
    assert.ok(!reasons(h).includes('seat-config'), name + ': 와이어가 측정 구성인데 자리 사유로 잠겼다');
    const open = nonDefault(h).filter((el) => el.getAttribute('aria-disabled') === 'false').map((el) => el.dataset.decoValue);
    assert.ok(open.length > 0, name + ': 열린 카드가 없다 — «열린 채» 를 재지 못한다(표 행이 있는 문맥이 아니다)');
    assert.equal(lastOf(h.calls.buildScene).cellShape && lastOf(h.calls.buildScene).cellShape.kind, 'bevel', name + ': 열린 bevel 이 생산자까지 안 갔다');
  }
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
  for (const [name, state] of [['O2', O2], ['G2(O 자동)', G2], ['A 자동', TYPE_STATES.A], ['K 자동', TYPE_STATES.K]]) {
    const base = harness({ state: { ...state, centralN7Emphasis: 'all', cellShape: 'bevel' } });
    base.render();
    const baseOpts = lastOf(base.calls.buildScene);
    assert.equal(baseOpts.centralN7Emphasis, 'all', name + ': 대조군 생산자 입력');
    assert.equal(base.c.current.deco.ctx.detectorEmphasis, 'all', name + ': 중앙 TL 은 세 값이 다른 그림');
    assert.equal(baseOpts.cellShape && baseOpts.cellShape.kind, 'bevel', name + ': 측정 구성(강조 all)인데 bevel 이 생산자에 안 갔다');
    for (const mode of ['locator', 'default']) {
      const h = harness({ state: { ...state, centralN7Emphasis: mode, cellShape: 'bevel' } });
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
    const ref = harness({ state: { ...O2, finderPatternId: finder, centralN7Emphasis: 'all', cellShape: 'bevel' } });
    ref.render();
    assert.equal(ref.c.current.deco.ctx.detectorEmphasis, CELL_SHAPE_DETECTOR_EMPHASIS_NOT_APPLICABLE, finder + ': 해당 없음이 아니다');
    const view = (x) => x.cards('cellShape').map((el) => `${el.dataset.decoValue}:${el.getAttribute('aria-disabled')}:${el.dataset.lockReason}`);
    opened += ref.cards('cellShape').filter((el) => el.dataset.decoValue !== CELL_SHAPE_DEFAULT && el.getAttribute('aria-disabled') === 'false').length;
    for (const mode of ['locator', 'default']) {
      const h = harness({ state: { ...O2, finderPatternId: finder, centralN7Emphasis: mode, cellShape: 'bevel' } });
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
  const probe = harness({ state: TYPE_STATES[type] });
  probe.render();
  const ctx = probe.c.current.deco.ctx;
  assert.ok(ctx, type + ': 렌더가 셀 모양 문맥을 current 에 안 남겼다');
  return harness({ state: TYPE_STATES[type], allow: { ROWS: openAllCellRows(ctx) } });
}

/** K 는 손 조립 경로다 — 카드 클릭이 buildScene 옵션까지 가는가(값 하나로 판정, 심은 결함 비교용). */
function shapeReachesProducer(type, source) {
  const probe = harness({ state: TYPE_STATES[type], source });
  probe.render();
  const h = harness({ state: TYPE_STATES[type], source, allow: { ROWS: openAllCellRows(probe.c.current.deco.ctx) } });
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
