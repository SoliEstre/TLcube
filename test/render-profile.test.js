/**
 * render-profile.test.js — 렌더 프로파일 (과업 #16) 계약.
 *
 * 이 테스트가 지키는 것은 네 가지다.
 *   1. 표 자체 — 세 프로파일의 게인 값과 SPEC §14 의 γ ≤ 2 의무.
 *   2. **단일 진실** — sceneY 의 DEFAULT_FACE_GAINS 와 «화면용» 프로파일이 같은 것.
 *      (여기가 갈리면 «화면에서 고른 값» 과 «렌더가 쓴 값» 이 조용히 달라진다.)
 *   3. **게인 비의존 복호** — 출력물용(3면 동률)에서도 왕복이 성립한다. 디코더가 면별
 *      앵커를 다시 잡는다는 주장의 실증이고, 이게 거짓이면 «출력물용» 카드는 사용자를
 *      못 읽는 코드로 안내하는 함정이 된다.
 *   4. UI 노출 — 정식 화면은 2종, lab 은 «오리지널» 을 맨 앞에 더한 3종.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_RENDER_PROFILE,
  LAB_RENDER_PROFILES,
  OFFICIAL_RENDER_PROFILES,
  RENDER_PROFILE_FACE_GAINS,
  RENDER_PROFILE_IDS,
  RENDER_PROFILE_ORIGINAL,
  RENDER_PROFILE_PRINT,
  RENDER_PROFILE_SCREEN,
  assertRenderProfile,
  faceGainsForRenderProfile,
  isLabOnlyRenderProfile,
  renderProfileGainRatio,
  renderProfilesForSurface,
} from '../src/render-profile.js';
import { DEFAULT_FACE_GAINS, buildSceneY } from '../src/sceneY.js';
import { GENERATOR_STATE_SCHEMA, createGeneratorState } from '../src/generator-state.js';
import { encodeY } from '../src/encodeY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX_SOURCE = readFileSync(ROOT + 'index.html', 'utf8');
const PRESET = getPreset(DEFAULT_PRESET);

function paletteFor(profile) {
  return {
    background: PRESET.background,
    levels: PRESET.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
    faceGains: faceGainsForRenderProfile(profile),
  };
}

test('세 프로파일의 게인 값이 정본과 일치한다', () => {
  assert.deepEqual(RENDER_PROFILE_FACE_GAINS[RENDER_PROFILE_ORIGINAL], { T: 1, L: 0.72, R: 0.52 });
  assert.deepEqual(RENDER_PROFILE_FACE_GAINS[RENDER_PROFILE_SCREEN], { T: 1, L: 0.72, R: 0.62 });
  assert.deepEqual(RENDER_PROFILE_FACE_GAINS[RENDER_PROFILE_PRINT], { T: 1, L: 1, R: 1 });
  // T 는 기준면이라 언제나 1 이다 — 아니면 같은 그림을 두 가지 수로 쓰게 된다.
  for (const profile of RENDER_PROFILE_IDS) {
    assert.equal(faceGainsForRenderProfile(profile).T, 1, profile + ' 의 T 가 1 이 아니다');
  }
});

test('전 프로파일이 SPEC §14 렌더러 의무 γ ≤ 2 를 지킨다', () => {
  for (const profile of RENDER_PROFILE_IDS) {
    const ratio = renderProfileGainRatio(profile);
    assert.ok(ratio <= 2, profile + ' γ=' + ratio);
  }
  // 잰 값 고정 — 화면용은 1/0.62, 출력물용은 동률이라 정확히 1.
  assert.ok(Math.abs(renderProfileGainRatio(RENDER_PROFILE_SCREEN) - 1 / 0.62) < 1e-12);
  assert.equal(renderProfileGainRatio(RENDER_PROFILE_PRINT), 1);
  assert.ok(Math.abs(renderProfileGainRatio(RENDER_PROFILE_ORIGINAL) - 1 / 0.52) < 1e-12);
});

test('DEFAULT_FACE_GAINS 는 «화면용» 프로파일과 같은 객체다 (단일 진실)', () => {
  assert.equal(DEFAULT_RENDER_PROFILE, RENDER_PROFILE_SCREEN);
  // 값 비교가 아니라 **동일성**까지 본다 — 값만 맞춰 둔 복제본은 한쪽만 바뀔 수 있다.
  assert.equal(DEFAULT_FACE_GAINS, RENDER_PROFILE_FACE_GAINS[RENDER_PROFILE_SCREEN]);
  assert.ok(Object.isFrozen(DEFAULT_FACE_GAINS));
});

test('알 수 없는 프로파일은 조용히 기본값으로 떨어지지 않고 던진다', () => {
  assert.throws(() => assertRenderProfile('poster'), RangeError);
  assert.throws(() => faceGainsForRenderProfile(undefined), RangeError);
});

test('정식 화면은 2종, lab 은 «오리지널» 을 맨 앞에 더한 3종', () => {
  assert.deepEqual(OFFICIAL_RENDER_PROFILES, [RENDER_PROFILE_SCREEN, RENDER_PROFILE_PRINT]);
  assert.deepEqual(LAB_RENDER_PROFILES,
    [RENDER_PROFILE_ORIGINAL, RENDER_PROFILE_SCREEN, RENDER_PROFILE_PRINT]);
  assert.deepEqual(renderProfilesForSurface(false), OFFICIAL_RENDER_PROFILES);
  assert.deepEqual(renderProfilesForSurface(true), LAB_RENDER_PROFILES);
  assert.equal(isLabOnlyRenderProfile(RENDER_PROFILE_ORIGINAL), true);
  assert.equal(isLabOnlyRenderProfile(RENDER_PROFILE_SCREEN), false);
  assert.equal(isLabOnlyRenderProfile(RENDER_PROFILE_PRINT), false);
});

test('생성기 상태에 프로파일 필드가 있고 기본값은 화면용이다', () => {
  const state = createGeneratorState();
  assert.equal(state.renderProfile, RENDER_PROFILE_SCREEN);
  const descriptor = GENERATOR_STATE_SCHEMA.renderProfile;
  assert.ok(descriptor, 'generator-state 에 renderProfile 이 없다');
  // 허용값에는 lab 전용까지 들어간다 — lab 에서 고른 값이 정식 화면에서 «알 수 없는
  // 값» 으로 죽으면 안 된다 (locatorProfileY 와 같은 규약).
  assert.deepEqual([...descriptor.options], [...RENDER_PROFILE_IDS]);
  assert.equal(descriptor.exposure, 'both', '일반 모드에도 카드가 떠야 한다');
});

test('출력물용(3면 동률)도 왕복 복호된다 — 디코더는 면별 앵커 재고정이라 게인 비의존', {
  timeout: 300_000,
}, () => {
  const text = 'render-profile-roundtrip';
  for (const profile of RENDER_PROFILE_IDS) {
    for (const tones of [2, 3]) {
      const encoded = encodeY(text, { version: 1, tones, eccLevel: 'M' });
      const scene = buildSceneY(encoded, { palette: paletteFor(profile), margin: 12 });
      const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
      const result = decodeFrontend(raster);
      const where = profile + ' ' + tones + '톤';
      assert.equal(result.ok, true, where + ': ' + (result.reason || ''));
      assert.equal(result.text, text, where);
      assert.equal(result.family, 'cube', where);
      assert.equal(result.tones, tones, where);
    }
  }
});

test('프로파일이 실제로 렌더 픽셀을 가른다 — 출력물용은 세 면 색이 같다', () => {
  // 카드가 «있기만 하고 아무것도 안 하는» 상태를 막는다. 2톤 · 같은 encoded 로 세
  // 프로파일을 그려 첫 셀의 T/L/R 색을 비교한다.
  const encoded = encodeY('profile-pixels', { version: 1, tones: 2, eccLevel: 'M' });
  const colorsOf = (profile) => {
    const scene = buildSceneY(encoded, { palette: paletteFor(profile) });
    return [scene.shapes[0].color, scene.shapes[1].color, scene.shapes[2].color];
  };
  const print = colorsOf(RENDER_PROFILE_PRINT);
  const screen = colorsOf(RENDER_PROFILE_SCREEN);
  const original = colorsOf(RENDER_PROFILE_ORIGINAL);

  // 출력물용은 게인이 전부 1 이라 같은 레벨이면 같은 색이 나온다. 2톤 첫 셀의 세 면은
  // 레벨이 서로 다를 수 있으므로 «게인 때문에 달라지지는 않는다» 를 직접 잰다.
  for (const face of [0, 1, 2]) {
    const gained = print[face];
    const flat = buildSceneY(encoded, {
      palette: { ...paletteFor(RENDER_PROFILE_PRINT), faceGains: { T: 1, L: 1, R: 1 } },
    }).shapes[face].color;
    assert.deepEqual(gained, flat, '출력물용이 게인 1 과 다른 색을 냈다');
  }
  // 화면용 · 오리지널은 R 면이 서로 달라야 한다 (0.62 vs 0.52).
  assert.notDeepEqual(screen[2], original[2], '화면용과 오리지널의 R 면 색이 같다 — 표가 안 먹었다');
  // 그리고 둘 다 출력물용보다 어둡다.
  for (const [name, colors] of [['screen', screen], ['original', original]]) {
    for (const ch of ['r', 'g', 'b']) {
      assert.ok(colors[2][ch] <= print[2][ch], name + ' 의 R 면이 출력물용보다 밝다: ' + ch);
    }
  }
});

test('index.html — 프로파일 카드 3종이 lab 순서대로 있고 아이콘은 인라인 SVG 다', () => {
  const start = INDEX_SOURCE.indexOf('<div class="card-row" id="renderProfileCards">');
  assert.ok(start >= 0, 'renderProfileCards 카드 행을 못 찾았다');
  const end = INDEX_SOURCE.indexOf('</div>\n        <p class="hint" id="renderProfileHint">', start);
  assert.ok(end > start, '카드 행의 끝을 못 찾았다');
  const row = INDEX_SOURCE.slice(start, end);

  const order = [...row.matchAll(/data-profile="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, [...LAB_RENDER_PROFILES],
    'DOM 카드 순서가 lab 라인업과 다르다 — 오리지널이 맨 앞이어야 한다');

  // 아이콘은 전부 인라인 SVG + currentColor (외부 자산·이모지 금지 — 테마를 따라야 한다).
  const icons = [...row.matchAll(/<svg[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  assert.equal(icons.length, 3, '카드마다 아이콘 하나여야 한다');
  for (const icon of icons) {
    assert.match(icon, /stroke="currentColor"/, '아이콘이 currentColor 를 안 쓴다');
    assert.doesNotMatch(icon, /<image|xlink:href|url\(/, '아이콘에 외부 자산이 섞였다');
  }

  // 카드 부제(card-sub)와 ? 도움말이 gen-ui 관용구대로 붙어 있다.
  assert.equal((row.match(/class="card-sub"/g) || []).length, 3);
  assert.match(INDEX_SOURCE, /id="renderProfileSection"[\s\S]{0,600}data-help="g971"/);
  assert.match(INDEX_SOURCE,
    /<div id="sharedControls" data-state-keys="[^"]*\brenderProfile\b/);
});

test('index.html — 카드가 실제로 배선돼 있다 (있기만 한 카드 금지)', () => {
  // 「초록 테스트는 동작하는 UI 가 아니다」 — DOM 만 검사하면 «카드는 있는데 아무것도
  // 안 일어나는» 상태가 통과한다. 클릭 핸들러 → 상태 기록 → 재렌더 사슬을 여기서 건다.
  const start = INDEX_SOURCE.indexOf('for (const card of els.renderProfileCards.children) {\n  card.addEventListener');
  assert.ok(start >= 0, '프로파일 카드 클릭 핸들러가 없다');
  const handler = INDEX_SOURCE.slice(start, start + 900);
  assert.match(handler, /generatorState\.renderProfile = id;/, '클릭이 상태를 안 쓴다');
  assert.match(handler, /syncRenderProfileUi\(\);/, '클릭이 카드 활성 표시를 갱신하지 않는다');
  assert.match(handler, /schedule\(\);/, '클릭이 재렌더를 예약하지 않는다');
  assert.match(handler, /isLabOnlyRenderProfile\(id\)/, '정식 화면에서 lab 전용 카드 차단이 없다');

  // 렌더 경로가 프로파일을 실제로 소비한다 — 상수 폴백으로 돌아가면 안 된다.
  assert.match(INDEX_SOURCE,
    /function profileFaceGains\(\)\s*\{\s*return faceGainsForRenderProfile\(generatorState\.renderProfile\);/);
  assert.match(INDEX_SOURCE, /faceGains: faceGains === undefined \? profileFaceGains\(\) : faceGains,/);
  assert.match(INDEX_SOURCE, /const base = profileFaceGains\(\);/,
    '면 게인 슬라이더가 프로파일까지의 보간이 아니다');
  // 상수 게인을 **코드로** 쓰면 안 된다 (설명 주석에 이름이 나오는 것은 무방하다).
  assert.doesNotMatch(INDEX_SOURCE, /import \{[^}]*DEFAULT_FACE_GAINS/,
    'index.html 이 아직 DEFAULT_FACE_GAINS 를 import 한다');
  assert.doesNotMatch(INDEX_SOURCE, /DEFAULT_FACE_GAINS\s*[.[]/,
    'index.html 이 아직 상수 게인을 직접 읽는다 — 프로파일을 바꿔도 그 경로는 안 바뀐다');

  // 언어 전환 때 다시 그려지는 목록에 등록돼 있다 (안 하면 힌트가 이전 언어로 굳는다).
  assert.match(INDEX_SOURCE, /const TEXT_SYNCERS = \[[\s\S]*?syncRenderProfileUi[\s\S]*?\];/);

  // 내보내기가 프로파일을 반영한다 — 픽셀은 scene 이 물고 나가고, 파일명 꼬리표로
  // A/B 두 벌을 구분한다.
  assert.match(INDEX_SOURCE, /function exportProfileTag\(\)/);
  // ⚠ **의도적 갱신** (2026-08-16, 과업 #17): 파일명 꼬리표가 프로파일 하나에서
  //   «프로파일 + 음영» 둘로 늘었다. 종전 `+ exportProfileTag();` 는 «프로파일 뒤에
  //   아무것도 안 온다» 까지 고정하고 있었는데, 그건 이 테스트가 지키려던 계약이
  //   아니다 — 지키려던 것은 «프로파일이 파일명에 반영된다» 이다. 그래서 뒤따르는
  //   꼬리표를 허용하는 형태로 다시 적는다 (음영 쪽 계약은 shading.test.js 가 본다).
  assert.match(INDEX_SOURCE, /\+ exportProfileTag\(\)/);
});

test('index.html — .toggle-card[hidden] 이 CSS 로 실제로 감춰진다', () => {
  // 실제로 밟은 함정이다. `[hidden] { display: none }` 은 **UA 스타일시트**에 있고
  // `.toggle-card { display: flex }` 는 저작자 규칙이라 언제나 이긴다. 즉 이 규칙이
  // 없으면 `card.hidden = true` 가 조용히 안 듣고, lab 전용 «오리지널» 카드가 정식
  // 화면에 그대로 보인다 — DOM 만 검사하는 테스트로는 절대 안 잡힌다.
  assert.match(INDEX_SOURCE, /\.toggle-card\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  // 그리고 lab 전용 카드를 감추는 장치가 실제로 hidden 이어야 한다(클래스만 흐리면
  // 키보드 순회로 여전히 닿는다).
  assert.match(INDEX_SOURCE, /card\.hidden = !visible\.includes\(id\);/);
});

test('index.html — 내부 게인 수치는 lab 에서만 붙는다', () => {
  // 정식 화면 DOM 에는 게인 숫자가 없어야 한다. 값은 JS 가 isLabPath() 일 때만 채운다.
  const start = INDEX_SOURCE.indexOf('<div class="card-row" id="renderProfileCards">');
  const end = INDEX_SOURCE.indexOf('<p class="hint" id="renderProfileHint">', start);
  const row = INDEX_SOURCE.slice(start, end);
  assert.doesNotMatch(row, /0\.62|0\.52|0\.72/, '카드 마크업에 게인 수치가 박혀 있다');
  assert.match(INDEX_SOURCE, /function syncRenderProfileUi\(\)[\s\S]*?const lab = isLabPath\(\);/);
  assert.match(INDEX_SOURCE, /card-sub card-gains/);
});
