// cell-shape-off-identity.test.js — «꾸미기 끔 = 현재 출력» 의 성질 (DESIGN_001 §7.1 (a)–(d) · §7.5, 레인 D1 2026-09-26)
//
// «HEAD 와 바이트 동일» 을 박제하지 않는다(그건 L0 byte-ab 하네스가 두 트리로 잰다). 여기서는 **성질**을 잰다:
//   (a) 키 없는 상태 ≡ 명시 기본값 — 상태 생성 · 정규화 · 세 resolver · hPreviewOptions 가 같은 답을 낸다.
//   (b) 기본값에서 `sceneOpts.cellShape` · `palette.qrDeco` · `hQr.deco` 가 **생기지 않는다** — resolver 가
//       `{spec|deco: null}` 을 사유 없이 내고, 소비 경계(sceneOptionsForOA · hPreviewOptions)가 키를 안 만든다.
//   (c) 기본값에서 새 도형 함수가 **한 번도 불리지 않는다** — 실제 호출 카운터(아래 «계수기»). 판별력: 켠 조립에서는
//       카운터가 0 이 아니어야 한다(공허한 초록 금지).
//   (d) 켬 → 끔 이력 뒤에도 (a)–(c) 가 성립한다 — 켠 조립(셀 모양 · 코너 QR deco · H 스타일 · 채도 팔레트)을 돌린 뒤
//       기본 조립을 다시 하면 카운터 0 이고 장면 JSON 이 처음 기본 조립과 같다.
//
// 계수기: `node:module` registerHooks 로 `?deco-count` 쿼리가 붙은 src 모듈 그래프를 **따로** 싣고, 그 사본의
//   `cell-shape.js` · `square-cell-style.js` 가 내보내는 도형 함수를 호출 계수 래퍼로 바꾼다(원본 모듈 인스턴스는
//   건드리지 않는다). 래퍼 삽입은 `export function <이름>(` 한 번 일치를 요구한다 — 철자가 바뀌면 조용히 0 을 세지
//   않고 **던진다**(자가 계수를 못 하면 빨갛다).
// 못 재는 것(이름 붙인 축): index.html 인라인 조립(paletteOf · buildConfig · renderTypeK/Y · qrCacheKey · H nextKey)과
//   H GPU 면 텍스처 — 앞은 L0 byte-ab(notCovers)·L5 클릭 경로, 뒤는 test/h-cell-style.test.js ⑧(캐시 키)가 맡는다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { encodeY } from '../src/encodeY.js';
import { encodeH } from '../src/h-codec.js';
import { getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { makeCustomPalette } from '../src/palette-hue.js';
import { TL_READER_URL } from '../src/qr.js';
import {
  centralBeaconEncoderOptions, encodeOptionsForY, sceneOptionsForOA,
} from '../src/generator-render-config.js';
import {
  CELL_SHAPE_DEFAULT, CELL_SHAPE_PARAMS, cellShapeCtx, resolveCellShapeSpec,
} from '../src/cell-shape.js';
import { QR_HOSTS, resolveQrDeco, QR_ALLOW_KEYS } from '../src/qr-colors.js';
import { SQUARE_CELL_STYLES } from '../src/square-cell-style.js';
import {
  hCellStyleCtx, hPreviewOptions, resolveHCellStyleSpec,
} from '../src/generator-h.js';
import {
  DECORATION_STATE_DOMAINS, DECORATION_STATE_KEYS, GENERATOR_STATE_SCHEMA, SHOT_PRESET_DECORATION_PINNED_KEYS,
  assertShotPresetDecorationOff, createGeneratorState, normalizeDecorationState,
} from '../src/generator-state.js';
import { SHOT_PRESETS, applyShotPresetToState } from '../src/generator-shot-presets.js';

// ── 계수기 ─────────────────────────────────────────────────────────────────

const SRC = new URL('../src/', import.meta.url).href;
const Q = '?deco-count';
/** 새 도형 함수 — 꾸미기가 켜질 때만 불려야 하는 것(모듈 → 내보낸 이름). */
const COUNTED = Object.freeze({
  'cell-shape.js': ['shapeCellFace', 'promoteNearT0', 'roundedRhombusPoints'],
  'square-cell-style.js': [
    'styledGridShapes', 'cellContours', 'liquidConcaveContours', 'cellSvgPath',
    'rasterCellCoverage', 'rasterContoursCoverage',
  ],
});
globalThis.__DECO_CALLS = {};
const instrumented = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    const r = nextResolve(specifier, context);
    if (context.parentURL && context.parentURL.endsWith(Q) && r.url.startsWith(SRC) && !r.url.includes('?')) {
      return { ...r, url: r.url + Q, shortCircuit: true };
    }
    return r;
  },
  load(url, context, nextLoad) {
    const r = nextLoad(url, context);
    if (!url.startsWith(SRC) || !url.endsWith(Q)) return r;
    const names = COUNTED[url.slice(SRC.length, -Q.length)];
    if (!names) return r;
    let src = typeof r.source === 'string' ? r.source : Buffer.from(r.source).toString('utf8');
    for (const n of names) {
      const needle = `export function ${n}(`;
      const at = src.indexOf(needle);
      if (at < 0 || src.indexOf(needle, at + 1) >= 0) {
        throw new Error(`계수기: ${url} 에서 «${needle}» 가 정확히 한 번이 아니다 — 계수 래퍼를 못 끼운다`);
      }
      src = src.slice(0, at) + `function __decoOrig_${n}(` + src.slice(at + needle.length);
      src += `\nexport function ${n}(...a) { const c = globalThis.__DECO_CALLS; c[${JSON.stringify(n)}] = (c[${JSON.stringify(n)}] ?? 0) + 1; return __decoOrig_${n}(...a); }\n`;
      instrumented.add(n);
    }
    return { ...r, source: src, shortCircuit: true };
  },
});
const { buildScene } = await import('../src/scene.js' + Q);
const { buildSceneY } = await import('../src/sceneY.js' + Q);
const { buildHScene } = await import('../src/h-render.js' + Q);
const { withHCornerQr } = await import('../src/generator-h-qr.js' + Q);

function resetCalls() { globalThis.__DECO_CALLS = {}; }
function totalCalls() { return Object.values(globalThis.__DECO_CALLS).reduce((a, b) => a + b, 0); }

// ── 조립 ───────────────────────────────────────────────────────────────────

const PAYLOAD = 'https://tl.estre.so';
const SLATE = getPreset('slate');
const PALETTE = Object.freeze({
  background: SLATE.background, levels: SLATE.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
});
const FRESH = createGeneratorState();
const N7 = 'central-n7-payload';
const PINWHEEL = 'pinwheel-c2-2-1100-cw';

/** 전부 열림 QR fixture — 계수기 판별력용(코너 QR deco 를 실제로 켜 본다). 키는 QR_ALLOW_KEYS 에서. */
const OPEN_QR = Object.freeze({
  ROWS: Object.freeze(QR_HOSTS.flatMap((host) => SQUARE_CELL_STYLES.map((qrCellStyle) => {
    const row = { table: 'qr', host, qrCellStyle, qrColorMode: 'custom', eyeMode: 'none' };
    for (const k of QR_ALLOW_KEYS) assert.ok(k in row, k);
    return Object.freeze(row);
  }))),
});

const ENC = {
  O: encode(PAYLOAD, centralBeaconEncoderOptions(N7, false)),
  A: encodeA(PAYLOAD, centralBeaconEncoderOptions(N7, false)),
  K: encodeK(PAYLOAD),
  Y: encodeY(PAYLOAD, encodeOptionsForY({
    tone: 3, fallback: { mode: 'corner', corner: 'TL' }, locatorProfileY: 'cell-surface-v0',
  })),
  H: encodeH('TL', { version: 2, mode: 3, tones: 3, finder: 'frame', ecc: 'M' }),
};

function oaOpts(type, { cellShape, palette = PALETTE } = {}) {
  return sceneOptionsForOA({
    cellShape, centralN7Emphasis: FRESH.centralN7Emphasis, fallback: { mode: 'corner', corner: 'TL' },
    finderPatternId: N7, palette, qrText: TL_READER_URL, type,
  });
}
function kOpts(extra = {}) {
  return { palette: PALETTE, margin: 20, finderPatternId: PINWHEEL, qrText: TL_READER_URL, qrCorner: 'TL', ...extra };
}
function yOpts(extra = {}) {
  return { palette: PALETTE, locatorProfile: 'cell-surface-v0', qrText: TL_READER_URL, qrCorner: 'TL', ...extra };
}
const H_STATE = createGeneratorState({ type: 'Y', yRepresentation: '3d', hAutoRotate: false, hAutoRotateIntent: 'off' });
function hScene(state, hqrExtra = {}) {
  const o = { ...hPreviewOptions(state, { palette: PALETTE, encoded: ENC.H }), outline: true, faceImages: {} };
  return withHCornerQr(buildHScene(ENC.H, o), { text: TL_READER_URL, corner: 'TL', ...hqrExtra });
}

/** 기본 조립 전부 — 장면 JSON 을 돌려준다(카운터는 부른 쪽이 본다). */
function defaultBuilds() {
  return {
    O: JSON.stringify(buildScene(ENC.O, oaOpts('O'))),
    A: JSON.stringify(buildScene(ENC.A, oaOpts('A'))),
    K: JSON.stringify(buildScene(ENC.K, kOpts())),
    Y: JSON.stringify(buildSceneY(ENC.Y, yOpts())),
    H: JSON.stringify(hScene(H_STATE)),
  };
}

// ── (a) 키 없음 ≡ 명시 기본값 ─────────────────────────────────────────────

const EXPLICIT_DEFAULTS = Object.freeze(Object.fromEntries(
  DECORATION_STATE_KEYS.map((k) => [k, DECORATION_STATE_DOMAINS[k].defaultValue]),
));

test('(a) 상태: 꾸미기 키 없음 ≡ 명시 기본값 — 생성 · 정규화 · 스키마 기본값이 한 벌', () => {
  assert.equal(DECORATION_STATE_KEYS.length, 15, '§2.2 + §9.3 Q3 — 15키');
  for (const k of DECORATION_STATE_KEYS) {
    assert.equal(GENERATOR_STATE_SCHEMA[k].defaultValue, EXPLICIT_DEFAULTS[k], k);
    assert.equal(FRESH[k], EXPLICIT_DEFAULTS[k], k);
  }
  assert.deepEqual(createGeneratorState(EXPLICIT_DEFAULTS), FRESH);
  assert.deepEqual(normalizeDecorationState({}), EXPLICIT_DEFAULTS);
  // 기본값 = 꾸미기 끔: 셀 모양 square · H/QR 스타일 square · QR 모드 default · 눈 none.
  assert.equal(EXPLICIT_DEFAULTS.cellShape, CELL_SHAPE_DEFAULT);
});

test('(a) resolver 셋 + hPreviewOptions: 키 없는 상태와 명시 기본값 상태가 같은 답(사유 없음)', () => {
  const ctxs = [
    cellShapeCtx('O', ENC.O, FRESH, { quietColor: 'white' }),
    cellShapeCtx('A', ENC.A, { ...FRESH, type: 'A' }, { quietColor: 'none' }),
    cellShapeCtx('K', ENC.K, { ...FRESH, type: 'K' }, { quietColor: 'black' }),
    cellShapeCtx('Y', ENC.Y, FRESH, { quietColor: 'none' }),
  ];
  for (const ctx of ctxs) {
    assert.ok(ctx, '문맥');
    for (const st of [{}, EXPLICIT_DEFAULTS, FRESH, undefined]) {
      assert.deepEqual(resolveCellShapeSpec(st, ctx), { spec: null });
    }
  }
  for (const host of QR_HOSTS) {
    for (const st of [{}, EXPLICIT_DEFAULTS, FRESH]) {
      // 전부 열림 표를 줘도 기본 조합은 deco 를 만들지 않는다(표와 무관 — 기본값은 잠금도 아니다).
      assert.deepEqual(resolveQrDeco(st, SLATE, host), { deco: null });
      assert.deepEqual(resolveQrDeco(st, SLATE, host, OPEN_QR), { deco: null });
    }
  }
  const hctx = hCellStyleCtx(ENC.H, H_STATE);
  for (const st of [{}, EXPLICIT_DEFAULTS, H_STATE]) assert.deepEqual(resolveHCellStyleSpec(st, hctx), { spec: null });
  const withoutKeys = { ...H_STATE };
  for (const k of DECORATION_STATE_KEYS) delete withoutKeys[k];
  assert.deepEqual(
    hPreviewOptions(withoutKeys, { palette: PALETTE, encoded: ENC.H }),
    hPreviewOptions(H_STATE, { palette: PALETTE, encoded: ENC.H }),
  );
});

test('(a) 촬영 프리셋은 꾸미기를 «끔» 으로 못 박는다 — 켠 상태에서 골라도 끔 · 심은 결함 프리셋은 로드 단언이 던진다', () => {
  assert.ok(SHOT_PRESETS.length > 0);
  assert.equal(assertShotPresetDecorationOff(), true);
  const on = createGeneratorState({ cellShape: 'round', hCellStyle: 'dots', hCellGround: 'white' });
  for (const preset of SHOT_PRESETS) {
    const applied = applyShotPresetToState(preset.id, on);
    for (const k of SHOT_PRESET_DECORATION_PINNED_KEYS) assert.equal(applied[k], DECORATION_STATE_DOMAINS[k].defaultValue, `${preset.id} ${k}`);
  }
  const [first] = SHOT_PRESETS;
  const unpinned = { ...first, fields: { ...first.fields } };
  delete unpinned.fields.cellShape;
  assert.throws(() => assertShotPresetDecorationOff([unpinned]), /못 박지 않았다/);
  assert.throws(() => assertShotPresetDecorationOff([{ ...first, fields: { ...first.fields, hCellGround: 'white' } }]), /끔/);
  assert.throws(() => assertShotPresetDecorationOff([{ ...first, fields: { ...first.fields, qrColorMode: 'custom' } }]), /끔/);
});

// ── (b) 기본값에서 키가 생기지 않는다 ─────────────────────────────────────

test('(b) 기본값: sceneOpts.cellShape · hPreviewOptions.hCellStyle/hCellGround 키 없음 · QR resolver 는 {deco:null} 만', () => {
  const ctx = cellShapeCtx('O', ENC.O, FRESH, { quietColor: 'white' });
  const { spec } = resolveCellShapeSpec(FRESH, ctx);
  for (const type of ['O', 'A']) {
    const opts = oaOpts(type, { cellShape: spec });
    assert.equal(Object.prototype.hasOwnProperty.call(opts, 'cellShape'), false, type);
    assert.deepEqual(opts, oaOpts(type), `${type}: cellShape null ≡ 인자 없음`);
  }
  // 판별력: spec 이 있으면 키가 실린다(경계가 값을 버리지 않는다).
  assert.deepEqual(oaOpts('O', { cellShape: { kind: 'round', param: 0.7 } }).cellShape, { kind: 'round', param: 0.7 });
  const pv = hPreviewOptions(H_STATE, { palette: PALETTE, encoded: ENC.H });
  for (const k of ['hCellStyle', 'hCellGround']) assert.equal(Object.prototype.hasOwnProperty.call(pv, k), false, k);
  for (const host of QR_HOSTS) {
    const r = resolveQrDeco(FRESH, SLATE, host);
    assert.deepEqual(Object.keys(r), ['deco'], `${host}: 사유 없는 null — 소비자는 qrDeco/hQr.deco 키를 만들 근거가 없다`);
    assert.equal(r.deco, null);
  }
});

// ── (c) · (d) 새 도형 함수 호출 0 + 켬→끔 이력 ─────────────────────────────

test('(c) 기본 조립 O · A · K · Y · H(+코너 QR)에서 새 도형 함수 호출 0 — 계수기 판별력은 켠 조립으로 확인', () => {
  assert.deepEqual([...instrumented].sort(), Object.values(COUNTED).flat().sort(), '계수 래퍼가 전부 끼워졌다');
  resetCalls();
  const first = defaultBuilds();
  assert.equal(totalCalls(), 0, `기본 조립에서 불린 도형 함수: ${JSON.stringify(globalThis.__DECO_CALLS)}`);

  // 판별력 — 켠 조립은 카운터를 움직여야 한다(각 축마다 따로).
  resetCalls();
  buildScene(ENC.O, oaOpts('O', { cellShape: { kind: 'round', param: 0.7 } }));
  assert.ok((globalThis.__DECO_CALLS.shapeCellFace ?? 0) > 0, 'O 셀 모양 켬 → shapeCellFace');
  resetCalls();
  const deco = resolveQrDeco({ qrColorMode: 'custom', qrCellStyle: 'dots' }, SLATE, 'oak', OPEN_QR).deco;
  assert.ok(deco, '전제: fixture 표로 oak deco 가 열린다');
  buildScene(ENC.O, oaOpts('O', { palette: { ...PALETTE, qrDeco: deco } }));
  assert.ok((globalThis.__DECO_CALLS.styledGridShapes ?? 0) > 0, 'O 코너 QR deco → styledGridShapes');
  resetCalls();
  buildSceneY(ENC.Y, yOpts({ cellShape: { kind: 'bevel', param: 0.6, seamAdjacent: 'keep' } }));
  assert.ok((globalThis.__DECO_CALLS.shapeCellFace ?? 0) > 0, 'Y 셀 모양 켬 → shapeCellFace');
  resetCalls();
  const o = { ...hPreviewOptions(H_STATE, { palette: PALETTE, encoded: ENC.H }), hCellStyle: 'dots', hCellGround: 'level5', outline: true, faceImages: {} };
  withHCornerQr(buildHScene(ENC.H, o), { text: TL_READER_URL, corner: 'TL', deco: resolveQrDeco({ qrColorMode: 'custom', qrCellStyle: 'rounded' }, SLATE, 'h', OPEN_QR).deco });
  assert.ok((globalThis.__DECO_CALLS.styledGridShapes ?? 0) > 0, 'H 스타일 · 코너 QR deco → styledGridShapes');

  // (d) 켬 → 끔 이력 — 채도 팔레트 캐시까지 흔든 뒤 기본 조립을 다시.
  makeCustomPalette(210, 'custom', 170);
  makeCustomPalette(37, 'custom', 0);
  resetCalls();
  const again = defaultBuilds();
  assert.equal(totalCalls(), 0, `이력 뒤 기본 조립에서 불린 도형 함수: ${JSON.stringify(globalThis.__DECO_CALLS)}`);
  for (const k of Object.keys(first)) assert.equal(again[k], first[k], `${k}: 켬→끔 이력 뒤 장면 JSON 이 처음 기본 조립과 다르다`);
});

test('(d) 상태 이력: 꾸미기 키를 전부 켰다가 기본값으로 되돌리면 resolver · 옵션 경계 · 정규화가 새 상태와 같다', () => {
  const s = createGeneratorState();
  const on = {};
  for (const k of DECORATION_STATE_KEYS) {
    const alt = GENERATOR_STATE_SCHEMA[k].options.find((v) => !Object.is(v, s[k]));
    assert.notEqual(alt, undefined, k);
    on[k] = alt;
  }
  Object.assign(s, on);
  const ctx = cellShapeCtx('O', ENC.O, s, { quietColor: 'white' });
  // 켠 상태에서 resolver 를 한 바퀴 — 스텁이라 전부 잠금이어야 하고 상태는 그대로.
  const before = JSON.stringify(s);
  assert.equal(resolveCellShapeSpec(s, ctx).spec, null);
  for (const host of QR_HOSTS) assert.equal(resolveQrDeco(s, SLATE, host).deco, null);
  hPreviewOptions({ ...H_STATE, ...on }, { palette: PALETTE, encoded: ENC.H });
  assert.equal(JSON.stringify(s), before, 'resolver 가 상태를 바꿨다');
  // 강도 키만 남기고 모양을 끄면(모양 전환 이력) 여전히 끔이다 — 강도 키는 모양이 square 면 무시된다.
  for (const def of Object.values(CELL_SHAPE_PARAMS)) assert.ok(def.key in on);
  Object.assign(s, { cellShape: CELL_SHAPE_DEFAULT });
  assert.deepEqual(resolveCellShapeSpec(s, cellShapeCtx('O', ENC.O, s, { quietColor: 'white' })), { spec: null });
  // 전부 되돌린다.
  Object.assign(s, EXPLICIT_DEFAULTS);
  assert.deepEqual(s, FRESH);
  assert.deepEqual(normalizeDecorationState(s), FRESH);
  assert.deepEqual(
    hPreviewOptions({ ...H_STATE, ...EXPLICIT_DEFAULTS }, { palette: PALETTE, encoded: ENC.H }),
    hPreviewOptions(H_STATE, { palette: PALETTE, encoded: ENC.H }),
  );
  assert.deepEqual(oaOpts('O', { cellShape: resolveCellShapeSpec(s, ctx).spec }), oaOpts('O'));
});
