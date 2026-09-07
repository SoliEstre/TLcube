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
  SHOT_3D_BACKDROPS, SHOT_3D_POSES,
  SHOT_PRESETS, SHOT_PRESET_IDS, SHOT_PRESET_NONE, SHOT_PRESET_STATE_VALUES,
  applyShotPresetToState, assertNoEmphasisFields, assertShotPresetFields,
  shotPresetById, shotPresetFieldKeys, shotPresetIdForState, shotPresetMatches,
  shotPresetPinsLocator, shotPresetUiModel,
} from '../src/generator-shot-presets.js';
import {
  ORBIT_VIEWER_PROPS, ORBIT_VIEW_25D, ORBIT_VIEW_3D,
  assertOrbitPresetFields, assertOrbitStateFields, defineOrbitViewAccessors,
  orbitPerspToDeg, orbitStateToViewerInput,
} from '../src/generator-orbit-view.js';
import { buildOrbitMesh } from '../src/y3d-viewer.js';
import { layoutForCube } from '../src/ygrid.js';
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

/**
 * **3D 궤도 렌더를 상태에서 다시 세운다** (index.html §paintY3dPreview 와 같은 순서).
 *
 * ⚠ 여기서 **자세 값을 손으로 넘기지 않는다** — `orbitStateToViewerInput(state)` 를
 *   지난다. 그 함수가 화면이 쓰는 바로 그 이음매라, 이 자는 «렌더 경로의 모형» 이
 *   아니라 **렌더 경로 자체**를 잰다. 라디안 변환을 여기서 따로 하면 그 순간 사본이
 *   되고, 화면이 도(°)를 안 풀어도 자는 초록이 된다 (「재는 대상이 그것인가」).
 *
 * 슬롯 QR 면(faceQuads)은 안 넘긴다 — 이 가족은 `qrPosition: 'none'` 이라 슬롯이
 * 아예 없다. 넘겨도 빈 배열이고, 안 넘기는 편이 재는 축이 궤도 하나로 좁혀진다.
 */
function meshFromState(state) {
  const { encoded } = renderFromState(state);
  const view = orbitStateToViewerInput(state);
  const layout = layoutForCube(encoded.n, { size: 1, margin: 0.25 });
  const digitAt = (i, j) => {
    const entry = encoded.cellDigits.get(`${i},${j}`);
    return entry ? entry.digit : null;
  };
  const levelAt = (i, j, face) => {
    const entry = encoded.cellDigits.get(`${i},${j}`);
    if (!entry || !entry.tones) return null;
    const lv = entry.tones[face];
    return Number.isInteger(lv) ? lv : null;
  };
  const mesh = buildOrbitMesh({
    n: encoded.n,
    tones: encoded.tones === 2 ? 2 : 3,
    levels: getPreset(state.preset).levels,
    layout,
    yaw: view.yaw,
    pitch: view.pitch,
    roll: view.roll,
    perspective: view.perspective,
    faces: 3,
    digitAt,
    levelAt,
    includeBack: true,
  });
  return { mesh, view, encoded };
}

/**
 * 메시의 «그림» 을 수 하나로 요약한다 — 정점 좌표 전수의 반올림 지문.
 *
 * 왜 정점인가: 「고르면 3D 로 그려진다」는 상태로도 옵션으로도 증명되지 않는다.
 * 실제로 **다른 자세면 다른 꼭짓점**이 나와야 한다 (「합격 축은 제품의 목적에서
 * 나온다」 — 촬영자가 얻는 것은 그림이다).
 */
function meshFingerprint(mesh) {
  const parts = [];
  for (const quad of mesh.quads) {
    for (const p of quad.points2d) parts.push(p.x.toFixed(6), p.y.toFixed(6));
  }
  return parts.join(',');
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

test('자① 같은 자세의 dark/light 는 **지면만** 다르다 (배경 축 대조군)', () => {
  // 「대조군은 한 축만 바꿔서」 — 배경 비교가 다른 축까지 함께 흔들리면 아무 말도 못 한다.
  // 브리프 §4-① 의 「같은 pose 의 dark/light 는 지면만 달라야 한다」를 **전수**로 잰다.
  for (const p of SHOT_3D_POSES) {
    const dark = SHOT_PRESETS.find((x) => x.pose === p.pose && x.group === 'dark');
    const light = SHOT_PRESETS.find((x) => x.pose === p.pose && x.group === 'light');
    assert.ok(dark && light, p.pose + ': 배경 두 장이 다 있지 않다');
    const diff = Object.keys(dark.fields).filter((k) => dark.fields[k] !== light.fields[k]);
    assert.deepEqual(diff, ['bgMode'], p.pose + ': bgMode 말고도 다르다: ' + diff.join(', '));

    const a = renderFromState(applyShotPresetToState(dark.id, createGeneratorState()));
    const b = renderFromState(applyShotPresetToState(light.id, createGeneratorState()));
    assert.deepEqual(a.encoded.cellDigits, b.encoded.cellDigits, p.pose + ': 셀 값이 다르다');
    assert.notDeepEqual(pixelAt(a.raster, 0, 0), pixelAt(b.raster, 0, 0),
      p.pose + ': 배경 축이 산출물에서 안 갈린다 — 두 프리셋이 같은 그림을 낸다');
    // 그리고 **3D 쪽은 같은 자세**여야 한다 — 배경이 궤도를 흔들면 대조가 깨진다.
    assert.equal(meshFingerprint(meshFromState(applyShotPresetToState(dark.id, createGeneratorState())).mesh),
      meshFingerprint(meshFromState(applyShotPresetToState(light.id, createGeneratorState())).mesh),
      p.pose + ': 배경만 다른데 3D 자세까지 달라졌다');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 자 ① (3D) — «고르면 3D 렌더가 그 궤도로 **실제로 그려진다**»
//   상태도 옵션도 아닌 **메시 꼭짓점**으로 잰다 (브리프 §4-①).
// ─────────────────────────────────────────────────────────────────────────────

test('자①-3D 선언 16장 전수 — 고른 자세가 메시 꼭짓점까지 도달한다', () => {
  assert.equal(SHOT_PRESETS.length, 16, '선언이 16장이 아니다 — 운영자 지시는 장수다');
  const seen = new Map();
  for (const preset of SHOT_PRESETS) {
    const state = applyShotPresetToState(preset.id, createGeneratorState());

    // (a) 상태 → 뷰어 입력의 이음매. **도(°)가 라디안으로 풀려야** 한다.
    const { mesh, view } = meshFromState(state);
    assert.equal(view.on, true, preset.id + ': 3D 가 안 켜진다 — 2.5D 로 남으면 면별 H 가 없다');
    assert.equal(state.orbitView, ORBIT_VIEW_3D, preset.id + ': orbitView 가 3D 가 아니다');
    assert.ok(Math.abs(view.yaw - preset.fields.orbitYaw * Math.PI / 180) < 1e-12,
      preset.id + ': yaw 가 라디안으로 안 풀렸다');
    assert.ok(Math.abs(view.pitch - preset.fields.orbitPitch * Math.PI / 180) < 1e-12,
      preset.id + ': pitch 가 라디안으로 안 풀렸다');
    assert.equal(view.roll, 0, preset.id + ': roll 이 0 이 아니다 — 이번 코퍼스 밖 축이다');

    // (b) **메시가 그 값을 실제로 들었나.** buildOrbitMesh 는 받은 각을 되돌려 준다.
    assert.equal(mesh.yaw, view.yaw, preset.id + ': 메시가 yaw 를 안 받았다');
    assert.equal(mesh.pitch, view.pitch, preset.id + ': 메시가 pitch 를 안 받았다');
    // 원근은 **α 9°** 로 고정 — y2-p9rot 과 한 축만 다르게 두기 위한 조건이다.
    assert.equal(orbitPerspToDeg(state.orbitPersp), 9, preset.id + ': 원근이 9° 가 아니다');
    assert.ok(mesh.invDist > 0, preset.id + ': 원근이 0 이다 — 평행투영이면 p9 가 아니다');

    // (c) 꼭짓점 지문 — 자세마다 **다른 그림**이어야 한다.
    const print = meshFingerprint(mesh);
    assert.ok(print.length > 1000, preset.id + ': 메시가 비었다 — 잴 그림이 없다');
    const key = preset.pose;
    if (seen.has(key)) {
      assert.equal(seen.get(key), print, preset.id + ': 같은 자세인데 그림이 다르다');
    } else {
      seen.set(key, print);
    }
  }
  // 자세 8은 서로 **전부 다른 그림**이어야 한다. 하나라도 겹치면 그 자세는 못 실린 것이다.
  assert.equal(new Set(seen.values()).size, SHOT_3D_POSES.length,
    '자세 여덟이 서로 다른 그림을 안 낸다 — 궤도가 렌더에 도달 안 했다');
});

test('자①-3D front 와 hard 는 서로 다른 그림이다 (브리프 §4-① 의 명시 표적)', () => {
  const front = meshFromState(applyShotPresetToState('shot-3d-front-dark', createGeneratorState()));
  const hard = meshFromState(applyShotPresetToState('shot-3d-hard-dark', createGeneratorState()));
  assert.notEqual(meshFingerprint(front.mesh), meshFingerprint(hard.mesh),
    'front 와 hard 가 같은 그림이다 — 궤도가 렌더에 안 실렸다');
  // 「대조군이 진단을 가른다」: 같은 코드·같은 배경인데 **자세 축만** 갈렸음을 못 박는다.
  assert.deepEqual(front.encoded.cellDigits, hard.encoded.cellDigits, '코드 자체가 달라졌다');
});

test('자①-3D **대조군** — 궤도가 0 이면 2.5D 와 같은 그림이다 (자가 자세를 재는지 확인)', () => {
  /*
   * 「사다리 범위가 결론을 정한다」 — 「아무것도 안 함」쪽 끝을 먼저 찍는다.
   * front(yaw 0 · pitch 0)와 «원근까지 0» 을 비교하면 원근 축이 살아 있는지 갈린다.
   * 이게 없으면 위 지문 자는 «무엇이 그림을 바꿨는지» 를 못 말한다.
   */
  const front = applyShotPresetToState('shot-3d-front-dark', createGeneratorState());
  const flat = { ...front, orbitPersp: 0 };
  assert.notEqual(meshFingerprint(meshFromState(front).mesh), meshFingerprint(meshFromState(flat).mesh),
    '원근 9° 와 평행투영이 같은 그림이다 — 원근 축이 렌더에 안 실렸다');
  assert.equal(meshFromState(flat).mesh.invDist, 0, '노브 0 이 정확히 평행투영이 아니다');
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
  // 그룹·카드 자리는 비어 있어야 한다 (JS 가 선언에서 채운다).
  assert.match(INDEX, /<div id="shotPresetGroups"><\/div>/,
    '#shotPresetGroups 가 비어 있지 않다 — 마크업에 카드를 적으면 손 목록이다');
  // 자세 토큰도 마크업에 있으면 안 된다 — 파일명 토큰이라 어긋나면 촬영이 통째로 샌다.
  for (const p of SHOT_3D_POSES) {
    assert.equal(new RegExp('"' + p.pose + '"').test(INDEX), false,
      'index.html 이 자세 토큰 "' + p.pose + '" 를 직접 들고 있다');
  }
});

test('자② 그룹이 배경 2 × 자세 8 = 16 으로 **유도**된다 (운영자 지시는 장수다)', () => {
  const model = shotPresetUiModel(createGeneratorState());
  assert.equal(model.cards.length, 16, '카드가 16장이 아니다');
  assert.equal(model.groups.length, SHOT_3D_BACKDROPS.length, '그룹 수가 배경 수와 다르다');
  assert.deepEqual(model.groups.map((g) => g.group), SHOT_3D_BACKDROPS.map((b) => b.backdrop),
    '그룹 순서가 선언과 다르다');
  for (const group of model.groups) {
    assert.equal(group.cards.length, SHOT_3D_POSES.length,
      group.group + ' 그룹의 카드가 자세 수와 다르다 — 장수가 조용히 줄었다');
    assert.deepEqual(group.cards.map((c) => c.pose), SHOT_3D_POSES.map((p) => p.pose),
      group.group + ' 그룹의 자세 순서가 선언과 다르다');
  }
  // 평평한 목록과 그룹의 합집합이 같아야 한다 — 한쪽이 상대의 사본이면 여기서 갈린다.
  assert.deepEqual(model.groups.flatMap((g) => g.cards.map((c) => c.id)),
    model.cards.map((c) => c.id), 'groups 와 cards 가 어긋난다');
  // id 규칙 — 촬영 파일명 토큰과 같은 낱말이어야 한다(GUIDE §4-5).
  for (const preset of SHOT_PRESETS) {
    assert.equal(preset.id, 'shot-3d-' + preset.pose + '-' + preset.group,
      preset.id + ': id 규칙(shot-3d-<pose>-<dark|light>)에서 벗어났다');
  }
});

test('자② 자세 표가 GUIDE_3d-shoot-32.md §2 의 값과 같다 (N-way sync)', () => {
  // 값이 어긋나면 **촬영 32장이 통째로 다른 축**이 된다. 가이드는 이 repo 밖(private)
  // 이라 파일로 대조할 수 없으므로, 그 표를 여기 옮겨 적고 «옮겨 적었다» 를 잰다.
  // ⚠ 이건 정본 사본이 아니라 **계약 고정**이다 — 값을 바꾸려면 가이드와 함께 바꾼다.
  assert.deepEqual(SHOT_3D_POSES.map((p) => [p.pose, p.yaw, p.pitch]), [
    ['front', 0, 0],
    ['yawp15', 15, 0],
    ['yawm15', -15, 0],
    ['yawp30', 30, 0],
    ['pitchm20', 0, -20],
    ['pitchp20', 0, 20],
    ['known', -5, -20],
    ['hard', 30, -30],
  ], '자세 표가 GUIDE_3d-shoot-32.md §2 와 다르다');
  // `known` 은 y2-p9rot 재현이다 (rot-analysis §0: yaw −4.9 · pitch −19.7 반올림).
  const known = SHOT_3D_POSES.find((p) => p.pose === 'known');
  assert.ok(Math.abs(known.yaw - (-4.9)) <= 0.5 && Math.abs(known.pitch - (-19.7)) <= 0.5,
    'known 자세가 y2-p9rot 실측(−4.9 / −19.7)에서 반올림 오차 이상 벗어났다');
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

  /*
   * ⚠ **카드는 이제 사전 키를 안 쓴다** (16장 확장, 2026-09-07). 카드에 적히는 것은
   *   자세 토큰(= 촬영 파일명 토큰)과 각도 수치라 번역 대상이 아니다. 겹침 사고를
   *   막던 이 자의 표적은 **그룹 제목·부제 키**로 옮겼다 — 사람 말이 들어가는 자리는
   *   그쪽뿐이다.
   */
  const groupKeys = [];
  for (const bg of SHOT_3D_BACKDROPS) groupKeys.push(bg.headingKey, bg.headingSubKey);
  assert.equal(new Set(groupKeys).size, groupKeys.length,
    '그룹끼리 사전 키를 나눠 쓴다 — 두 그룹이 같은 제목으로 보인다: ' + groupKeys.join(','));
  for (const key of groupKeys) {
    assert.equal(markupKeys.has(key), false,
      '그룹 사전 키 ' + key + ' 가 섹션 자신의 키(제목·힌트·이탈)와 겹친다');
    // 여덟 사전 전부에 있어야 한다 (없으면 조용히 한국어로 폴백한다).
    assert.equal(INDEX.split('"' + key + '":').length - 1, 8,
      '그룹 사전 키 ' + key + ' 가 여덟 사전에 다 있지 않다');
  }
});

test('자② 카드 라벨은 자세 토큰 그대로이고 사전을 타지 않는다 (파일명 옮겨 적기)', () => {
  /*
   * 왜 번역하지 않는가: 카드 이름이 그대로 촬영 파일명에 들어간다
   * (`sil3d-<dark|light>-<pose>-<near|far>.jpg`, GUIDE §4-5). 번역된 라벨을 보여 주면
   * 촬영자가 옮겨 적을 낱말이 화면에 **없다** — 「A/B 는 다른 축을 가린다」의 UI 판:
   * 「많이 열렸다」가 아니라 「맞게 열렸다」가 이 축의 합격 조건이다.
   */
  const model = shotPresetUiModel(createGeneratorState());
  for (const card of model.cards) {
    assert.equal(card.label, card.pose, card.id + ': 카드 라벨이 자세 토큰이 아니다');
    assert.equal(/^[a-z0-9]+$/.test(card.label), true,
      card.id + ': 자세 토큰에 파일명에 못 쓸 글자가 있다: ' + card.label);
    // 부제에 yaw/pitch 값이 **보여야** 촬영자가 화면에서 검증한다 (브리프 §4-3).
    const preset = shotPresetById(card.id);
    assert.equal(card.sub.includes(String(preset.fields.orbitYaw)), true,
      card.id + ': 부제에 yaw 값이 없다: ' + card.sub);
    assert.equal(card.sub.includes(String(preset.fields.orbitPitch)), true,
      card.id + ': 부제에 pitch 값이 없다: ' + card.sub);
  }
  // 그룹 안에서 라벨이 겹치면 두 카드가 같아 보인다.
  for (const group of model.groups) {
    const labels = group.cards.map((c) => c.label);
    assert.equal(new Set(labels).size, labels.length,
      group.group + ' 그룹에 같은 라벨이 둘 있다: ' + labels.join(','));
  }
  // 그리고 **카드 만드는 자리에 data-i18n 이 없어야** 한다 — 있으면 사전에 없는 키로
  // applyTranslations 가 라벨을 빈 문자열로 덮어 카드가 이름을 잃는다.
  const at = INDEX.indexOf('function createShotPresetCard(');
  assert.notEqual(at, -1, 'createShotPresetCard 가 사라졌다');
  const body = INDEX.slice(at, INDEX.indexOf('\n}', at));
  assert.equal(/label\.dataset\.i18n|sub\.dataset\.i18n/.test(body), false,
    '카드가 사전 키를 단다 — 없는 키면 라벨이 빈칸이 된다');
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
  // 촬영 프리셋 + **궤도 다섯**. H2: 궤도 축도 시험판 전용이다 (정식 화면엔 그 축을
  // 쓸 UI 자체가 없다 — #y3dBar 는 상태 컨테이너 밖의 별개 표면이다).
  const internalKeys = ['shotPreset',
    'orbitView', 'orbitYaw', 'orbitPitch', 'orbitRoll', 'orbitPersp'];
  for (const key of internalKeys) {
    assert.equal(GENERATOR_STATE_SCHEMA[key].exposure, 'internal',
      key + ' 가 INTERNAL 이 아니다 — 정식 노출 대조에 새어 들어간다');
    for (const mode of ['normal', 'advanced']) {
      assert.equal(exposedGeneratorStateKeys(mode).includes(key), false,
        mode + ' 모드에 ' + key + ' 가 노출된다');
    }
  }
  // 섹션은 네 `data-state-keys` 컨테이너 **밖**이어야 한다 (그 넷은 엄격 동치로 대조된다).
  for (const id of ['panelNormal', 'panelAdvanced', 'sharedControls', 'sharedContent']) {
    const re = new RegExp('<div id="' + id + '"[^>]*data-state-keys="([^"]+)"');
    const m = re.exec(INDEX);
    assert.ok(m, id + ' 의 data-state-keys 를 못 찾았다');
    const listed = m[1].split(/\s+/);
    for (const key of internalKeys) {
      assert.equal(listed.includes(key), false,
        id + ' 의 data-state-keys 에 ' + key + ' 가 들어갔다');
    }
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
    // 궤도 축의 기본값은 전부 «아무것도 안 함» 이다 — 2.5D · 회전 0 · 원근 0.
    // 하나라도 프리셋 값으로 «몰래 승격» 되면 기본 미리보기가 돌아간 채로 뜬다.
    orbitView: ORBIT_VIEW_25D, orbitYaw: 0, orbitPitch: 0, orbitRoll: 0, orbitPersp: 0,
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
      /*
       * ⚠ **궤도 각도 축에는 `options` 가 없다** (연속값). 종전 자는 `options.find` 를
       *   그냥 불렀는데, 그러면 새 축에서 `undefined.find` 로 터진다 — 「시스템 자신의
       *   «없음» 출력이 곧 입력이다」. 열거형이면 다른 허용값, 아니면 값을 흔들어
       *   이탈을 만든다. **어느 쪽이든 축은 전수로 돈다.**
       */
      const options = GENERATOR_STATE_SCHEMA[key].options;
      const current = preset.fields[key];
      const other = options === undefined
        ? (typeof current === 'number' ? current + 1 : !current)
        : options.find((v) => v !== current);
      assert.notEqual(other, undefined, key + ' 에 다른 허용값이 없어 이탈을 못 만든다');
      assert.notEqual(other, current, key + ' 의 이탈 값이 원래 값과 같다');
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

// ─────────────────────────────────────────────────────────────────────────────
// 자 ⑤-3D · 자 ⓖ — 궤도 배선 (H1 의 «집이 하나인가»)
//   브리프 §4-⑤ 의 「3D 바를 손으로 만졌을 때 포함」이 여기서 잰다.
// ─────────────────────────────────────────────────────────────────────────────

test('자⑤-3D 3D 바를 **손으로** 만지면 이탈로 뜬다 (접근자가 상태에 쓴다)', () => {
  /*
   * 이 자가 이 레인의 심장이다. H1 의 원문(「뷰어가 상태를 **읽도록**」)대로만 하면
   * 드래그·리셋·슬라이더는 여전히 뷰어 자기 값에 쓰고, 그러면 «손으로 벗어남» 을
   * 이탈 판정이 **구조적으로 못 본다** — 화면은 계속 「이 프리셋이에요」라고 말한다.
   */
  const state = applyShotPresetToState('shot-3d-known-dark', createGeneratorState());
  const viewer = { mode: 'field', digit: 3, faces: 3, pad: 48 };
  defineOrbitViewAccessors(viewer, state);

  // (a) 프리셋이 세운 값이 **뷰어 단위(라디안·노브)로** 보인다.
  assert.equal(viewer.on, true, '프리셋을 골랐는데 뷰어가 2.5D 다');
  assert.ok(Math.abs(viewer.yaw - (-5 * Math.PI / 180)) < 1e-12, 'yaw 가 라디안으로 안 보인다');
  assert.ok(Math.abs(viewer.pitch - (-20 * Math.PI / 180)) < 1e-12, 'pitch 가 라디안으로 안 보인다');
  assert.equal(viewer.persp, 15, '원근 노브가 15 가 아니다');
  assert.equal(shotPresetUiModel(state).drifted, false, '고른 직후에 이탈로 뜬다');

  // (b) 드래그가 하는 일 그대로 — 뷰어 쪽에 라디안을 쓴다.
  viewer.yaw -= 0.2;
  assert.notEqual(state.orbitYaw, -5, '드래그가 상태에 안 남았다 — 집이 둘이다');
  assert.equal(shotPresetUiModel(state).drifted, true,
    '3D 바를 손으로 만졌는데 이탈로 안 뜬다 — 화면이 거짓말한다');

  // (c) 2.5D 버튼이 하는 일 그대로.
  const back = applyShotPresetToState('shot-3d-known-dark', createGeneratorState());
  const viewer2 = { mode: 'field' };
  defineOrbitViewAccessors(viewer2, back);
  viewer2.on = false;
  assert.equal(back.orbitView, ORBIT_VIEW_25D, '2.5D 토글이 상태에 안 남았다');
  assert.equal(shotPresetUiModel(back).drifted, true, '2.5D 로 껐는데 이탈로 안 뜬다');

  // (d) 리셋 버튼이 하는 일 그대로 — 되돌리면 이탈이 **풀려야** 한다면 안 된다.
  //     리셋은 자세를 0 으로 만드니 `front` 프리셋과 같은 자세가 된다.
  const front = applyShotPresetToState('shot-3d-front-dark', createGeneratorState());
  const viewer3 = { mode: 'field' };
  defineOrbitViewAccessors(viewer3, front);
  viewer3.yaw = 0; viewer3.pitch = 0; viewer3.roll = 0;
  assert.equal(shotPresetUiModel(front).drifted, false,
    'front 프리셋에서 정위치로 돌렸는데 이탈로 뜬다 — 「지금 상태가 무엇인가」가 아니다');
  viewer3.persp = 0;
  assert.equal(shotPresetUiModel(front).drifted, true, '원근을 0 으로 내렸는데 이탈로 안 뜬다');
});

test('자ⓖ 궤도 값의 집이 하나다 — 뷰어가 자기 값을 들면 로드 시점에 던진다', () => {
  // 「사본 목록은 썩는다」의 값 판본. 두 집이면 둘이 어긋나고, 이탈 판정은 죽은 집을 본다.
  const state = createGeneratorState();
  for (const prop of ORBIT_VIEWER_PROPS) {
    assert.throws(() => defineOrbitViewAccessors({ [prop]: 0 }, state),
      /집이 둘이 되면/, prop + ' 를 자기 값으로 들고 있는데 안 던진다');
  }
  // index.html 의 `y3dPreview` 리터럴에도 그 다섯이 없어야 한다.
  const at = INDEX.indexOf('const y3dPreview = {');
  assert.notEqual(at, -1, 'y3dPreview 리터럴이 사라졌다');
  const literal = INDEX.slice(at, INDEX.indexOf('\n};', at));
  const stripped = literal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const prop of ORBIT_VIEWER_PROPS) {
    /*
     * 🔴 **이 줄이 처음엔 아무것도 안 잡았다.** 종전 판은 `new RegExp('^\s*' + prop …)`
     *   이었는데, JS 문자열에서 `\s` 는 인식되는 이스케이프가 아니라 그냥 `s` 로
     *   접힌다 — 정규식이 `^s*yaws*:` 가 되어 **영원히 false** 였다. 변이 M11
     *   (`y3dPreview` 에 `yaw: 0` 되살리기)이 초록으로 통과해서 잡혔다.
     *   「레인은 자기 게이트를 스스로 내린다」·「쉘이 백슬래시를 접는다」의 합작.
     *   ⇒ 문자열로 정규식을 짓지 않는다. `String.raw` 로 원문을 지킨다.
     */
    const own = new RegExp(String.raw`^\s*` + prop + String.raw`\s*:`, 'm');
    assert.equal(own.test(stripped), false,
      'y3dPreview 리터럴이 "' + prop + '" 를 자기 값으로 든다 — 접근자가 던진다');
  }
  // 그리고 접근자를 실제로 **거는** 줄이 있어야 한다.
  assert.match(INDEX, /defineOrbitViewAccessors\(y3dPreview, generatorState\);/,
    '궤도 접근자를 안 건다 — 프리셋이 3D 에 닿지 않는다');
});

test('자ⓖ 노브→각 변환이 한 곳에만 산다 (index.html 에 사본 0)', () => {
  /*
   * 「사본 목록은 썩는다」 — 상한이 바뀌는 날 한쪽만 늙는다. 유도를 **부르는지**로 잰다.
   *
   * 🔴 처음 판은 `INDEX.includes('Y3D_PERSP_MAX_DEG = 60')` 이었는데, 그 상수를
   *   없앴다고 적어 둔 **내 주석**에 걸려 빨개졌다 — 「철자를 재는 자는 썩는다」의
   *   즉석 실물이다. 지금은 «선언이 실재하는가» 만 본다(주석의 언급은 선언이 아니다).
   */
  assert.equal(/const\s+Y3D_PERSP_MAX_DEG/.test(INDEX), false,
    'index.html 이 반각 상한을 자기 상수로 다시 선언한다');
  assert.match(INDEX, /perspective: orbitPerspToT\(y3dPreview\.persp\)/,
    '3D 렌더가 노브→t 유도를 안 쓴다 — /100 사본이 남았다');
  assert.match(INDEX, /orbitPerspToDeg\(y3dPreview\.persp\)/,
    '원근 표시가 노브→각 유도를 안 쓴다');
});

test('자ⓖ 선언된 궤도 값 검사가 실재하고 실제로 던진다', () => {
  assert.equal(assertOrbitStateFields(GENERATOR_STATE_SCHEMA), true);
  assert.throws(() => assertOrbitStateFields({}), /궤도 축이 없다/);
  assert.equal(assertOrbitPresetFields({ orbitYaw: 30, orbitPitch: -30, orbitPersp: 15 }), true);
  assert.throws(() => assertOrbitPresetFields({ orbitYaw: 400 }), /범위 밖/);
  assert.throws(() => assertOrbitPresetFields({ orbitPitch: -120 }), /범위 밖/);
  assert.throws(() => assertOrbitPresetFields({ orbitYaw: Number.NaN }), /유한 수가 아니다/);
  // 슬라이더가 step=1 이라 정수가 아니면 화면 값과 상태 값이 갈린다.
  assert.throws(() => assertOrbitPresetFields({ orbitPersp: 15.5 }), /정수가 아니다/);
  assert.throws(() => assertOrbitPresetFields({ orbitPersp: 101 }), /정수가 아니다/);
  assert.throws(() => assertOrbitPresetFields({ orbitView: '4d' }), /허용값 밖/);
  // 그리고 이 검사가 프리셋 경로에 **실제로 걸려 있어야** 한다.
  assert.equal(assertShotPresetFields(GENERATOR_STATE_SCHEMA), true);
});

test('자ⓖ 3D 바 조작이 촬영 프리셋 표시를 **다시 재게** 한다 (깔때기)', () => {
  /*
   * 🔴 **브라우저 실검으로 잡은 실제 결함이다** (2026-09-07). 큐브를 끌어 자세를
   *   바꿔도 카드가 계속 활성이고 이탈 문구가 안 떴다 — 화면이 「이 프리셋이에요」
   *   라고 거짓말했다. 원인: 3D 바는 `schedule()` 을 **일부러 안 부르고**(뷰 축이라
   *   재인코딩이 필요 없다), `syncShotPresetUi()` 는 `render()` 진입과 TEXT_SYNCERS
   *   에서만 돌았다.
   *
   * ⚠ **이 파일의 자 25개가 전부 초록이었다.** 모형(`shotPresetUiModel`)은 정확히
   *   «이탈» 이라고 답하고 있었고 못 물어본 쪽은 화면이라, 모형을 재는 자로는
   *   원리적으로 안 보인다 (「초록 테스트는 동작하는 UI 가 아니다」).
   *   ⇒ 여기서 재는 것은 값이 아니라 **배선의 성질**: 깔때기가 이어져 있는가.
   */
  const bodyOf = (name) => {
    const at = INDEX.indexOf('function ' + name + '(');
    assert.notEqual(at, -1, name + ' 가 사라졌다');
    return INDEX.slice(at, INDEX.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  };
  // ① 깔때기 바닥 — 궤도 UI 동기화가 촬영 프리셋 표시를 다시 잰다.
  assert.match(bodyOf('syncOrbitPreviewUi'), /\n\s*syncShotPresetUi\(\);/,
    '3D 바를 만져도 촬영 프리셋 표시가 안 다시 재진다 — 이탈이 화면에 안 뜬다');
  // ② 그림 경로도 그 바닥으로 모인다 (슬라이더·드래그·리셋·휠이 여기로 온다).
  assert.match(bodyOf('paintY3dPreview'), /syncOrbitPreviewUi\(\);/,
    '3D 그림 경로가 궤도 UI 동기화를 안 지난다 — 깔때기가 끊겼다');
  // ③ 그리고 3D 바의 **모든** 리스너가 둘 중 하나로 끝나야 한다 — 손 목록이 아니라
  //    소스에서 훑는다. 하나라도 빠지면 그 버튼만 조용히 거짓말한다.
  const listeners = [...INDEX.matchAll(/els\.(y3d[A-Za-z0-9]*)\.addEventListener\('(\w+)', \(\w*\) => \{([\s\S]*?)\n\}\);/g)];
  assert.ok(listeners.length >= 6, '3D 바 리스너를 너무 적게 찾았다(' + listeners.length + ') — 파서가 깨졌다');
  for (const [, el, type, body] of listeners) {
    if (type !== 'click' && type !== 'input') continue;
    assert.equal(/syncOrbitPreviewUi\(\)|paintY3dPreview\(\)/.test(body), true,
      'els.' + el + ' 의 ' + type + ' 리스너가 깔때기를 안 지난다 — 그 버튼만 이탈을 안 알린다');
  }
});
