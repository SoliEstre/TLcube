/**
 * generator-shot-presets.test.js — 시험판 «촬영 프리셋» 의 자.
 *
 * 운영자 답 카드 `d-3d-observation-layer`(2026-09-07 17:32 KST)의 직접 후속:
 * 「항목 선택하면 해당 프리셋으로 선택되게」. 이 파일이 재는 것은 **«선택됐다» 가
 * 자기 상태가 아니라 렌더 설정·렌더 산출물에 도달했는가** 다.
 *
 * ⚠ **왜 상태 대조만으로는 부족한가.** 이 프로젝트에서 반복된 실패 형태가
 *   「카드는 켜지고 상태에도 들어가는데 소비자가 그 축을 안 읽는다」다
 *   (k-cm · sagoae — index.html §buildConfig 주석의 두 사고). 그래서 자 ① 은
 *   상태를 지나 **인코더 옵션 → 인코딩 결과 → 래스터 픽셀**까지 내려가 잰다.
 *
 * ⚠ **이 자가 못 재는 것**은 §7(보고서)에 이름을 붙여 두었다 — 브라우저 DOM 은
 *   여기서 안 뜬다(「초록 테스트는 동작하는 UI 가 아니다」). DOM 쪽은 «목록이
 *   선언에서 유도된다» 는 구조 사실(자 ②)로만 덮는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  SHOT_PRESETS, SHOT_PRESET_IDS, SHOT_PRESET_NONE, SHOT_PRESET_STATE_VALUES,
  applyShotPresetToState, assertNoEmphasisFields, assertShotPresetFields,
  shotPresetById, shotPresetFieldKeys, shotPresetIdForState, shotPresetMatches,
  shotPresetPinsLocator, shotPresetUiModel,
} from '../src/generator-shot-presets.js';
import {
  GENERATOR_STATE_SCHEMA, createGeneratorState, exposedGeneratorStateKeys,
} from '../src/generator-state.js';
import { encodeOptionsForY } from '../src/generator-render-config.js';
import { encodeY } from '../src/encodeY.js';
import { buildSceneY } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, getPreset } from '../src/luminance.js';
import { RENDER_PROFILE_FACE_GAINS } from '../src/render-profile.js';
import { QUIET_COLOR_NONE, resolveQuietZoneChoice } from '../src/quiet-auto.js';
import { SHADING_OFF } from '../src/shading.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

/** index.html §BG_MODE_COLORS 와 같은 표 — 배경 모드 → 실제 칠해지는 색. */
const BG_MODE_COLORS = { transparent: null, white: { r: 255, g: 255, b: 255 }, black: { r: 0, g: 0, b: 0 } };

/**
 * index.html 의 렌더 경로를 **DOM 없이** 다시 세운다 (§renderTypeY 와 같은 순서).
 *
 * `fallback` 은 `resolveFallback(type, qrPosition)` 의 값이다 — qrPosition 'none' 은
 * `{ mode: 'off' }` 다(index.html:12673). 그 사상 자체는 이 레인의 계약이 아니라서
 * 여기서 다시 재지 않는다; 프리셋이 'none' 을 세우는지는 자 ① 이 따로 본다.
 */
function renderFromState(state, text = 'https://tl.estre.so') {
  const fallback = state.qrPosition === 'none' ? { mode: 'off' } : { mode: 'corner', corner: state.qrPosition };
  const opts = encodeOptionsForY({
    tone: state.tone,
    versionY: state.versionY,
    fallback,
    locatorProfileY: state.locatorProfileY,
  });
  const encoded = encodeY(text, { ...opts, eccLevel: state.eccLevel });
  // 촬영 프리셋은 구체 스타일만 세운다 — 'custom'(hue 슬라이더) 경로는 여기 안 온다.
  assert.notEqual(state.preset, 'custom', '촬영 프리셋이 custom 스타일을 세운다 — 재현이 안 된다');
  const base = getPreset(state.preset);
  const palette = {
    background: BG_MODE_COLORS[state.bgMode],
    levels: base.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
    // «자동» 이 아닌 구체 프로파일이라 내보내기 문맥과 무관하게 이 게인이다.
    faceGains: RENDER_PROFILE_FACE_GAINS[state.renderProfile],
  };
  const sceneOpts = { palette };
  if (typeof state.locatorProfileY === 'string' && state.locatorProfileY.startsWith('cell-surface-')) {
    sceneOpts.locatorProfile = state.locatorProfileY;
  }
  const scene = buildSceneY(encoded, sceneOpts);
  const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
  return { opts, encoded, scene, raster };
}

/**
 * 래스터의 (x,y) 픽셀 — 코너를 읽어 «실제로 칠해진 배경» 을 잰다.
 *
 * ⚠ 버퍼는 **RGBA**(stride 4)다(`raster.js` §100). 처음 3 으로 읽었더니 좌상단은
 *   맞고 우하단만 파랗게 나왔다 — 「재는 대상이 그것인가」의 교과서적 형태다.
 *   길이 자를 함께 둬서 stride 가 바뀌면 그 자리에서 빨개지게 한다.
 */
function pixelAt(raster, x, y) {
  assert.equal(raster.pixels.length, raster.width * raster.height * 4,
    '래스터 버퍼가 RGBA 가 아니다 — 이 자의 stride 가 틀렸다');
  const o = (y * raster.width + x) * 4;
  return {
    r: raster.pixels[o], g: raster.pixels[o + 1], b: raster.pixels[o + 2], a: raster.pixels[o + 3],
  };
}

/** 불투명 배경 기대값 — RGBA 비교용(불투명이므로 a=255). */
function opaque(color) {
  return { r: color.r, g: color.g, b: color.b, a: 255 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 자 ① — 선언 전수 × «고르면 그 필드가 실제 렌더 설정·산출물에 도달한다»
// ─────────────────────────────────────────────────────────────────────────────

test('자① 선언 전수 — 프리셋을 고르면 그 필드가 렌더 산출물까지 도달한다', () => {
  assert.ok(SHOT_PRESETS.length >= 2, '선언이 둘보다 적다 — 배경 2종을 못 덮는다');
  for (const preset of SHOT_PRESETS) {
    const state = applyShotPresetToState(preset.id, createGeneratorState());
    const { opts, encoded, scene, raster } = renderFromState(state);

    // (a) 인코더 옵션 — 「옵션은 중첩까지가 계약」. 상태값이 그대로 옵션에 도달했나.
    assert.equal(opts.cellSurface, true, preset.id + ': 셀 표면 로케이터가 옵션에 안 실렸다');
    assert.equal(opts.cellSurfaceLayout, preset.fields.locatorProfileY.slice('cell-surface-'.length),
      preset.id + ': locatorProfileY 가 인코더 레이아웃에 도달 안 했다');
    assert.equal(opts.tones, preset.fields.tone, preset.id + ': tone 이 옵션에 도달 안 했다');
    assert.equal(opts.version, preset.fields.versionY, preset.id + ': versionY 가 옵션에 도달 안 했다');

    // (b) 인코딩 결과 — 와이어에 실린 값. y2 실측 조건(n25 · ecc H · tones 3)과 같아야 한다.
    assert.equal(encoded.n, 25, preset.id + ': n 이 25 가 아니다 (y2 실물 조건)');
    assert.equal(encoded.eccLevel, preset.fields.eccLevel, preset.id + ': eccLevel 이 와이어에 안 실렸다');
    assert.equal(encoded.tones, 3, preset.id + ': 3톤이 아니다');
    assert.equal(encoded.cellSurface, true, preset.id + ': 셀 표면이 아니다');

    // (c) **렌더 산출물** — scene.background 와 실제 래스터 코너 픽셀.
    //     상태도 옵션도 아닌, 사람이 사진으로 찍게 될 바로 그 화소다.
    const want = BG_MODE_COLORS[preset.fields.bgMode];
    assert.deepEqual(scene.background, want, preset.id + ': scene 배경이 bgMode 와 다르다');
    assert.deepEqual(pixelAt(raster, 0, 0), opaque(want),
      preset.id + ': 래스터 좌상단 화소가 bgMode 와 다르다 — 배경이 렌더까지 안 갔다');
    assert.deepEqual(pixelAt(raster, raster.width - 1, raster.height - 1), opaque(want),
      preset.id + ': 래스터 우하단 화소가 bgMode 와 다르다');
    assert.deepEqual(pixelAt(raster, raster.width - 1, 0), opaque(want),
      preset.id + ': 래스터 우상단 화소가 bgMode 와 다르다');

    // (d) 안전영역 — Type Y 는 «없음» 이 실측 최선이고, 흑·백 판은 실루엣을 깬다.
    const quiet = resolveQuietZoneChoice({
      quietMode: state.quietMode,
      bgMode: state.bgMode,
      type: state.type,
      sepWhite: 1,
      sepBlack: 1,
      surfaceLuminance: null,
      surfaceSeparation: null,
      separationFloor: 0.05,
    });
    assert.equal(quiet.color, QUIET_COLOR_NONE,
      preset.id + ': 안전영역 판이 그려진다 — 판 색이 촬영 프레임 테두리 띠에 없으면'
      + ' 배경이 아니라 경쟁 전경 덩어리가 되어 큐브 실루엣 검출이 깨진다');
    assert.equal(state.quietMode, QUIET_COLOR_NONE, preset.id + ': quietMode 가 «없음» 이 아니다');
    assert.equal(state.quietMarginAuto, false,
      preset.id + ': 두께 자동이 켜져 있다 — 렌더 뒤 quietMargin 을 되써서 기하가 흔들린다');

    // (e) 음영 — 켜면 배경·안전영역을 채워 Y 전경 실루엣 검출이 죽는다.
    assert.equal(state.shading, SHADING_OFF, preset.id + ': 음영이 꺼져 있지 않다');
    assert.equal(state.shadingRim, false, preset.id + ': T면 아웃라인이 켜져 있다');
    assert.equal(scene.shading === undefined || scene.shading === null
      || (Array.isArray(scene.shading) && scene.shading.length === 0), true,
    preset.id + ': scene 에 음영 레이어가 실렸다');
  }
});

test('자① 두 프리셋은 bgMode 한 축만 다르고 렌더 산출물도 그 축에서만 갈린다', () => {
  // 「대조군은 한 축만 바꿔서」 — 배경 비교가 다른 축까지 함께 흔들리면 아무 말도 못 한다.
  const [dark, light] = SHOT_PRESETS;
  const diff = Object.keys(dark.fields).filter((k) => dark.fields[k] !== light.fields[k]);
  assert.deepEqual(diff, ['bgMode'], '두 프리셋이 bgMode 말고도 다르다: ' + diff.join(', '));

  const a = renderFromState(applyShotPresetToState(dark.id, createGeneratorState()));
  const b = renderFromState(applyShotPresetToState(light.id, createGeneratorState()));
  assert.equal(a.encoded.n, b.encoded.n, '같은 코드여야 하는데 n 이 다르다');
  assert.deepEqual(a.encoded.cellDigits, b.encoded.cellDigits, '같은 코드여야 하는데 셀 값이 다르다');
  assert.notDeepEqual(pixelAt(a.raster, 0, 0), pixelAt(b.raster, 0, 0),
    '배경 축이 산출물에서 안 갈린다 — 두 프리셋이 같은 그림을 낸다');
});

// ─────────────────────────────────────────────────────────────────────────────
// 자 ② — 선언 ↔ UI 항목 수·순서 유도 일치 (손 목록이면 빨강)
// ─────────────────────────────────────────────────────────────────────────────

test('자② UI 목록·상태 허용값이 선언에서 **유도**된다 (손 목록 0)', () => {
  const model = shotPresetUiModel(createGeneratorState());
  assert.equal(model.cards.length, SHOT_PRESETS.length, 'UI 모형의 항목 수가 선언과 다르다');
  assert.deepEqual(model.cards.map((c) => c.id), SHOT_PRESET_IDS, 'UI 모형의 순서가 선언과 다르다');
  assert.deepEqual(SHOT_PRESET_STATE_VALUES, [SHOT_PRESET_NONE, ...SHOT_PRESET_IDS],
    '상태 허용값이 선언 유도가 아니다');
  assert.deepEqual(GENERATOR_STATE_SCHEMA.shotPreset.options, SHOT_PRESET_STATE_VALUES,
    '스키마 허용값이 선언 유도가 아니다');

  // **손 목록이면 여기서 빨개진다**: 프리셋 id 는 선언 모듈에만 있어야 한다.
  // index.html 이 id 를 하나라도 문자열로 들면 그 순간 사본이 생긴 것이다.
  for (const id of SHOT_PRESET_IDS) {
    assert.equal(INDEX.includes(id), false,
      'index.html 이 프리셋 id "' + id + '" 를 직접 들고 있다 — 목록 사본이 생겼다');
  }
  // 카드 자리는 비어 있어야 한다 (JS 가 선언에서 채운다).
  assert.match(INDEX, /<div class="card-row" id="shotPresetCards"><\/div>/,
    '#shotPresetCards 가 비어 있지 않다 — 마크업에 카드를 적으면 손 목록이다');
});

test('자② 카드 사전 키가 섹션 자신의 키와 안 겹치고 8언어에 다 있다', () => {
  /*
   * 🔴 실제로 났던 결함이다. 처음 판은 카드 라벨 키로 g1031/g1032 를 썼는데 그 둘은
   * **섹션 제목·힌트**의 키였다 — 카드에 「촬영 프리셋 (시험판)」이 라벨로 찍힌다.
   * 사전 커버리지 자는 「키가 8언어에 다 있나」만 보므로 **전부 초록이었다**.
   * 「게이트가 엉뚱한 축에서 초록일 수 있다」 — 그래서 겹침 자체를 여기서 잰다.
   */
  const sectionAt = INDEX.indexOf('<div id="shotPresetSection"');
  assert.notEqual(sectionAt, -1, '#shotPresetSection 이 사라졌다');
  const section = INDEX.slice(sectionAt, INDEX.indexOf('\n    </div>', sectionAt));
  const markupKeys = new Set([...section.matchAll(/data-i18n="(g\d+)"/g)].map((m) => m[1]));
  assert.ok(markupKeys.size >= 3, '섹션 마크업의 사전 키를 못 읽었다: ' + [...markupKeys].join(','));

  const cardKeys = [];
  for (const preset of SHOT_PRESETS) cardKeys.push(preset.labelKey, preset.subKey);
  assert.equal(new Set(cardKeys).size, cardKeys.length,
    '카드끼리 사전 키를 나눠 쓴다 — 두 카드가 같은 라벨로 보인다: ' + cardKeys.join(','));
  for (const key of cardKeys) {
    assert.equal(markupKeys.has(key), false,
      '카드 사전 키 ' + key + ' 가 섹션 자신의 키(제목·힌트·이탈)와 겹친다 — 카드에 엉뚱한 문구가 찍힌다');
    // 여덟 사전 전부에 있어야 한다 (없으면 조용히 한국어로 폴백한다).
    assert.equal(INDEX.split('"' + key + '":').length - 1, 8,
      '카드 사전 키 ' + key + ' 가 여덟 사전에 다 있지 않다');
  }
});

test('자② 선언 ↔ 상태 스키마 자기검증이 실재하고 실제로 던진다', () => {
  assert.equal(assertShotPresetFields(GENERATOR_STATE_SCHEMA), true);
  // 없는 키
  assert.throws(() => assertShotPresetFields({}), /없는 상태 키/);
  // 허용값 밖
  const narrowed = { ...GENERATOR_STATE_SCHEMA, tone: { ...GENERATOR_STATE_SCHEMA.tone, options: [2] } };
  assert.throws(() => assertShotPresetFields(narrowed), /허용값 밖/);
});

test('자② 강조 축(centralN7Emphasis)은 프리셋 필드에 없다 — emph-c 레인 경계', () => {
  assert.equal(assertNoEmphasisFields(), true);
  assert.equal(shotPresetFieldKeys().includes('centralN7Emphasis'), false,
    '강조 축이 프리셋 필드로 새어 들어왔다 — 다른 레인이 그 축의 뜻을 고치는 중이다');
});

// ─────────────────────────────────────────────────────────────────────────────
// 자 ③ — 정식(isLabPath()=false)에서 섹션·상태 키 노출 0
// ─────────────────────────────────────────────────────────────────────────────

test('자③ 정식 화면 노출 0 — 상태 키는 INTERNAL, 섹션은 isLabPath() 게이트', () => {
  assert.equal(GENERATOR_STATE_SCHEMA.shotPreset.exposure, 'internal',
    'shotPreset 이 INTERNAL 이 아니다 — 정식 노출 대조에 새어 들어간다');
  for (const mode of ['normal', 'advanced']) {
    assert.equal(exposedGeneratorStateKeys(mode).includes('shotPreset'), false,
      mode + ' 모드에 shotPreset 이 노출된다');
  }
  // 섹션은 네 `data-state-keys` 컨테이너 **밖**이어야 한다 (그 넷은 엄격 동치로 대조된다).
  for (const id of ['panelNormal', 'panelAdvanced', 'sharedControls', 'sharedContent']) {
    const re = new RegExp('<div id="' + id + '"[^>]*data-state-keys="([^"]+)"');
    const m = re.exec(INDEX);
    assert.ok(m, id + ' 의 data-state-keys 를 못 찾았다');
    assert.equal(m[1].split(/\s+/).includes('shotPreset'), false,
      id + ' 의 data-state-keys 에 shotPreset 이 들어갔다');
  }
  // 표시 술어가 lab 게이트를 **소비**해야 한다. 「숨김-active」가 아니라 표시 자체가 lab 이다.
  const at = INDEX.indexOf('function syncShotPresetUi()');
  assert.notEqual(at, -1, 'syncShotPresetUi 가 사라졌다');
  const body = INDEX.slice(at, INDEX.indexOf('\n}', at));
  assert.match(body, /const lab = isLabPath\(\);/, '촬영 프리셋 섹션이 lab 게이트를 안 쓴다');
  assert.match(body, /section\.hidden = !lab;/, 'lab 게이트가 표시에 소비되지 않는다');
});

// ─────────────────────────────────────────────────────────────────────────────
// 자 ④ — 프리셋 미선택 기본 동작은 오늘과 바이트 동일 (무회귀)
// ─────────────────────────────────────────────────────────────────────────────

test('자④ 무회귀 — 프리셋을 안 고른 기본 상태는 shotPreset 말고 한 필드도 안 바뀐다', () => {
  const state = createGeneratorState();
  assert.equal(state.shotPreset, SHOT_PRESET_NONE, '기본값이 «미선택» 이 아니다');
  // 프리셋이 세우는 축의 기본값이 프리셋 값 때문에 움직이지 않았나 — 스키마 기본값 대조.
  // (프리셋 도입 전 기본값. 하나라도 프리셋 값으로 «몰래 승격» 되면 여기서 빨개진다.)
  const untouched = {
    type: 'Y', versionY: 'auto', tone: 3, eccLevel: 'auto',
    qrPosition: 'TL', preset: 'slate', renderProfile: 'auto',
    quietMode: 'auto', quietMarginAuto: true, shading: 'off', shadingRim: false,
    bgMode: 'transparent', locatorProfileY: 'off',
  };
  for (const [key, value] of Object.entries(untouched)) {
    assert.equal(state[key], value, key + ' 기본값이 바뀌었다 — 프리셋 도입이 기본 동작을 건드렸다');
  }
  // 미선택 적용은 아무 필드도 안 되돌린다 (되돌리기는 이 레인의 계약이 아니다).
  const applied = applyShotPresetToState(SHOT_PRESET_NONE, { ...state, tone: 2 });
  assert.equal(applied.tone, 2, '«미선택» 이 다른 필드를 되돌렸다');
  assert.equal(applied.shotPreset, SHOT_PRESET_NONE);
});

test('자④ 무회귀 — 기본 상태의 렌더 산출물이 프리셋 코드와 다르다 (자가 살아 있다)', () => {
  // 「대조군이 진단을 가른다」 — 기본 상태가 이미 프리셋과 같은 그림이면 자① 은
  // 아무것도 증명하지 않는다. 기본은 투명 배경 · auto ecc · 로케이터 off 다.
  const base = createGeneratorState();
  assert.equal(BG_MODE_COLORS[base.bgMode], null, '기본 배경이 투명이 아니다');
  assert.equal(base.locatorProfileY.startsWith('cell-surface-'), false,
    '기본 로케이터가 이미 셀 표면이다 — 자① 의 로케이터 축이 대조를 잃는다');
});

// ─────────────────────────────────────────────────────────────────────────────
// 자 ⑤ — 이탈 표시가 실제 이탈에서만 뜬다
// ─────────────────────────────────────────────────────────────────────────────

test('자⑤ 이탈 표시 — 고른 직후 0 · 선언 축을 건드리면 1 · 되돌리면 다시 0', () => {
  for (const preset of SHOT_PRESETS) {
    const applied = applyShotPresetToState(preset.id, createGeneratorState());
    assert.equal(shotPresetUiModel(applied).drifted, false, preset.id + ': 고른 직후에 이탈로 뜬다');
    assert.equal(shotPresetMatches(preset, applied), true);

    for (const key of Object.keys(preset.fields)) {
      const other = GENERATOR_STATE_SCHEMA[key].options.find((v) => v !== preset.fields[key]);
      assert.notEqual(other, undefined, key + ' 에 다른 허용값이 없어 이탈을 못 만든다');
      const drifted = { ...applied, [key]: other };
      assert.equal(shotPresetUiModel(drifted).drifted, true,
        preset.id + ': ' + key + ' 를 바꿨는데 이탈로 안 뜬다');
      assert.equal(shotPresetIdForState(drifted), SHOT_PRESET_NONE);
      // 되돌리면 다시 붙는다 — 「고른 값을 기억」이 아니라 「지금 상태가 무엇인가」다.
      assert.equal(shotPresetUiModel({ ...drifted, [key]: preset.fields[key] }).drifted, false,
        preset.id + ': ' + key + ' 를 되돌렸는데 이탈이 안 풀린다');
    }
  }
});

test('자⑤ 선언 **밖** 축을 바꾸는 것은 이탈이 아니다', () => {
  const applied = applyShotPresetToState(SHOT_PRESET_IDS[0], createGeneratorState());
  const keys = shotPresetFieldKeys();
  const outside = ['contentTab', 'qrText', 'exportSize', 'quietMargin'];
  for (const key of outside) {
    assert.equal(keys.includes(key), false, key + ' 가 선언 안에 있다 — 이 자의 전제가 틀렸다');
    const options = GENERATOR_STATE_SCHEMA[key].options;
    const other = options.find((v) => v !== applied[key]);
    assert.notEqual(other, undefined, key + ' 에 다른 허용값이 없다');
    assert.equal(shotPresetUiModel({ ...applied, [key]: other }).drifted, false,
      key + ' (선언 밖)를 바꿨는데 이탈로 뜬다 — 화면이 거짓말한다');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 자 ⓕ — 상태 밖 소비자(detectorAutoY) 를 함께 쓸었나
// ─────────────────────────────────────────────────────────────────────────────

test('자ⓕ 로케이터를 지정한 프리셋은 «자동» UI 정책도 함께 내린다', () => {
  // 왜: applyAutoLocatorProfileY() 는 자동이 켜져 있으면 QR 위치·버전·타입이 바뀔
  // 때마다 locatorProfileY 를 덮어쓴다. 상태 계층만 훑는 자로는 안 보이는 소비자다.
  for (const id of SHOT_PRESET_IDS) {
    assert.equal(shotPresetPinsLocator(id), true, id + ': 로케이터를 안 세운다');
  }
  assert.equal(shotPresetPinsLocator(SHOT_PRESET_NONE), false);
  const at = INDEX.indexOf('function applyShotPreset(');
  assert.notEqual(at, -1, 'applyShotPreset 이 사라졌다');
  const body = INDEX.slice(at, INDEX.indexOf('\n}', at));
  assert.match(body, /shotPresetPinsLocator\(id\)/,
    '적용 경로가 로케이터 고정 여부를 안 묻는다 — 자동이 프리셋을 덮어쓴다');
  assert.match(body, /detectorAutoY = false/, '자동 플래그를 안 내린다');
  // 소비자 쓸기는 손 목록이 아니라 TEXT_SYNCERS 전수여야 한다.
  assert.match(body, /for \(const sync of TEXT_SYNCERS\) sync\(\);/,
    '적용 뒤 UI 되그리기가 손 목록이다 — 새 필드를 더하면 하나가 빠진다');
});

test('자ⓕ 이탈 판정이 render() 마다 다시 재진다 — 어느 축을 건드렸는지 목록으로 안 든다', () => {
  const at = INDEX.indexOf('function render() {');
  assert.notEqual(at, -1, 'render() 가 사라졌다');
  assert.match(INDEX.slice(at, at + 600), /syncShotPresetUi\(\);/,
    'render() 진입에서 촬영 프리셋 상태를 다시 안 잰다');
});

test('자ⓕ 모르는 프리셋 id 는 조용히 무시하지 않고 던진다', () => {
  assert.throws(() => applyShotPresetToState('shot-does-not-exist', createGeneratorState()),
    /알 수 없는 촬영 프리셋/);
  assert.equal(shotPresetById('shot-does-not-exist'), null);
});

test('자ⓕ 이탈 «표시» 경로는 상태를 한 글자도 안 쓴다', () => {
  /*
   * 왜 이 성질인가: 표시 함수가 «고른 프리셋» 주장을 스스로 내리면, 다음 렌더에서
   * 이탈 판정이 false 로 뒤집혀 **경고가 한 번 깜빡이고 사라진다** — 사용자가 옵션을
   * 되돌리지도 않았는데 화면이 「정상」이라고 말한다. 실제로 그렇게 짰다가 잡았다.
   */
  const at = INDEX.indexOf('function syncShotPresetUi()');
  assert.notEqual(at, -1, 'syncShotPresetUi 가 사라졌다');
  const body = INDEX.slice(at, INDEX.indexOf('\n}', at));
  const writes = body.replace(/\/\*[\s\S]*?\*\//g, '').match(/generatorState\.\w+\s*=[^=]/g);
  assert.equal(writes, null,
    '표시 함수가 상태를 쓴다: ' + (writes || []).join(', ') + ' — 이탈 경고가 깜빡이고 사라진다');

  // 모형 함수 자체도 순수여야 한다 (같은 결함의 모듈 쪽 절반).
  const before = applyShotPresetToState(SHOT_PRESET_IDS[0], createGeneratorState());
  const snapshot = JSON.stringify(before);
  const drifted = { ...before, tone: 2 };
  const driftedSnapshot = JSON.stringify(drifted);
  assert.equal(shotPresetUiModel(drifted).drifted, true);
  assert.equal(shotPresetUiModel(drifted).drifted, true, '두 번째 호출에서 판정이 뒤집힌다');
  assert.equal(JSON.stringify(drifted), driftedSnapshot, 'shotPresetUiModel 이 상태를 바꿨다');
  assert.equal(JSON.stringify(before), snapshot, '적용 결과가 나중에 바뀌었다');
});
