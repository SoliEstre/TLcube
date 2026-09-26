// qr-colors.test.js — 코너 폴백 QR 색 해석 + 대비 가드 G1–G4 (DESIGN_001 §2.3 · §5.2 · §7.5)
//
// 재는 성질:
//   ① 정수 전 도메인(hue 0–359 × sat 0–200, 201단)× 그레이 변환 5종에서 custom 어두운 색 ·
//      'darker' 눈 · Q3 (b) 눈이 G1–G4 를 넘는다. 프리셋 3의 match 색도 같다.
//   ② default · square · 눈 없음 → {deco:null} 이고 lockReason 도 없다(키를 만들지 않는다).
//   ③ 심은 결함마다 **따로** 거부되고, 막은 문이 설계가 말한 그 문이다:
//        Y=0.18 어두운 색 → G4(+ WCAG) · 일부 hue 에서 avg G2 도 미달(설계 «avg .378» 확인)
//        light = levels[2]@s1 → G3 + 일부 hue 에서 avg G2 미달(설계 «.354» 확인)
//        `paletteOf` 형 렌더 팔레트(background ∈ {null, #fff, #000}) → 'qr-base-palette'
//        기저 모양이지만 levels[0] 이 밝은 팔레트 → 런타임 재단언 'qr-contrast'
//   ④ match(custom 팔레트 h, customSat p) 의 색 = custom(h, p) 의 색 = makeCustomPalette 원본
//      (L1 식과 같은 식) · 'darker' 폴백 · 눈 옵션 두 해석 · 허용표 fail-closed · 순수성
//      (상태 · 팔레트 불변, makeCustomPalette 한 칸 캐시 불변).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QR_COLOR_MODES,
  QR_EYE_MODES,
  QR_HOSTS,
  QR_GRAY_TRANSFORMS,
  QR_DARK_TARGET_Y,
  QR_LOAD_ASSERT_GRID,
  qrContrastGuard,
  qrCustomDark,
  qrDarkerEye,
  qrHostOfType,
  hueOfRgb,
  basePaletteProblem,
  resolveQrDeco,
  assertQrColorDomain,
} from '../src/qr-colors.js';
import { SQUARE_CELL_STYLES } from '../src/square-cell-style.js';
import { colorAtLuminance, satAt, makeCustomPalette } from '../src/palette-hue.js';
import { getPreset, relativeLuminance, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';

const WHITE = { r: 255, g: 255, b: 255 };
const HUES = Array.from({ length: 360 }, (_, i) => i);
const SATS_ALL = Array.from({ length: 201 }, (_, i) => i);

/** 모든 조합을 여는 fixture 허용표(런타임 가드 · 색 공식 시험용). */
const OPEN_ALL = Object.freeze({
  ROWS: Object.freeze(QR_HOSTS.flatMap((host) => SQUARE_CELL_STYLES.flatMap((qrCellStyle) => QR_COLOR_MODES.flatMap(
    (qrColorMode) => QR_EYE_MODES.map((eyeMode) => Object.freeze({ table: 'qr', host, qrCellStyle, qrColorMode, eyeMode })),
  )))),
});

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

const gates = (g) => new Set(g.failures.map((f) => f.gate));

/** paletteOf 가 만드는 렌더 팔레트 모양(index.html paletteOf 와 같은 키). */
function renderPalette(background) {
  return {
    background, levels: getPreset('slate').levels,
    bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT, faceGains: { T: 1, L: 1, R: 1 },
  };
}

// ── 설계 §5.2 계약 — 테스트가 따로 적는다 ─────────────────────────────────
// 모듈의 qrContrastGuard · QR_GRAY_TRANSFORMS · QR_GUARD 를 쓰지 않는다. 모듈 자신의 설정으로
// 모듈을 재면 문턱을 낮추거나 변환을 빼도 초록이다(검토 지적, 2026-09-26 — zxing 제거 · 0.38/5 ·
// maxDarkY 0.17 변이가 전부 통과했다). 선형 Y709 만 SPEC §4.4 정본(luminance.js)을 쓴다.

const DESIGN_MIN_CONTRAST = 0.40; // G2 — 모든 그레이 변환
const DESIGN_MIN_WCAG = 7; // G2
const DESIGN_MAX_DARK_Y = 0.12; // G4
const DESIGN_GRAY = Object.freeze({
  y709: (c) => relativeLuminance(c),
  bt601: (c) => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255,
  zxing: (c) => Math.floor((c.r + 2 * c.g + c.b) / 4) / 255,
  gamma709: (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255,
  avg: (c) => (c.r + c.g + c.b) / 3 / 255,
});

function designWcag(a, b) {
  const ya = relativeLuminance(a);
  const yb = relativeLuminance(b);
  return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05);
}

/** 설계 §5.2 G1–G4 를 따로 판정 — 실패 키 집합 'G1:변환' · 'G2:변환' · 'G2:wcag' · 'G3:' · 'G4:'. */
function designFailures({ dark, light, eye }, eyeMode) {
  const out = new Set();
  for (const [name, f] of Object.entries(DESIGN_GRAY)) {
    const fl = f(light);
    const fd = f(dark);
    const fe = f(eye);
    if (!(fl > fd && fl > fe)) out.add(`G1:${name}`);
    if (eyeMode === 'darker' && !(fd >= fe)) out.add(`G1:${name}`);
    if (!(Math.min(fl - fd, fl - fe) >= DESIGN_MIN_CONTRAST)) out.add(`G2:${name}`);
  }
  if (!(Math.min(designWcag(light, dark), designWcag(light, eye)) >= DESIGN_MIN_WCAG)) out.add('G2:wcag');
  if (!(light.r === 255 && light.g === 255 && light.b === 255)) out.add('G3:');
  if (!(relativeLuminance(dark) <= DESIGN_MAX_DARK_Y && relativeLuminance(eye) <= DESIGN_MAX_DARK_Y)) out.add('G4:');
  return out;
}

const moduleFailures = (g) => new Set(g.failures.map((f) => `${f.gate}:${f.transform ?? ''}`));

/** 결정적 LCG — 무작위 표본을 실행마다 같게. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── ① 전 도메인 ───────────────────────────────────────────────────────────

test('정수 전 도메인(hue 360 × sat 201): custom 어두운 · darker 눈 · Q3(b) 눈 · 프리셋 match 가 설계 문턱(독립 판정)을 넘는다', () => {
  let minMargin = Infinity;
  let minDarkerGap = Infinity;
  let maxY = 0;
  let minWcag = Infinity;
  const measure = (dark, eye, eyeMode, where) => {
    const fails = designFailures({ dark, light: WHITE, eye }, eyeMode);
    assert.equal(fails.size, 0, `${where}: ${[...fails].join(' ')}`);
    for (const f of Object.values(DESIGN_GRAY)) {
      minMargin = Math.min(minMargin, 1 - f(dark), 1 - f(eye));
      if (eyeMode === 'darker') minDarkerGap = Math.min(minDarkerGap, f(dark) - f(eye));
    }
    maxY = Math.max(maxY, relativeLuminance(dark), relativeLuminance(eye));
    minWcag = Math.min(minWcag, designWcag(WHITE, dark), designWcag(WHITE, eye));
  };
  for (const h of HUES) {
    for (const p of SATS_ALL) {
      const dark = qrCustomDark(h, p);
      // darker 눈(Q3 a) — 순서까지. Q3 (b) 눈은 어두운 색과 같은 공식(qrCustomDark)이라 dark 가 곧 그 눈이다.
      measure(dark, qrDarkerEye(h, p), 'darker', `hue ${h} sat ${p}`);
      measure(dark, dark, 'custom', `Q3b hue ${h} sat ${p}`);
    }
  }
  for (const name of ['slate', 'ember', 'mono']) {
    const deco = resolveQrDeco({ qrColorMode: 'match', qrEyeMode: 'darker' }, getPreset(name), 'oak', OPEN_ALL).deco;
    assert.deepEqual(deco.light, WHITE);
    measure(deco.dark, deco.eye, 'darker', `match ${name}`);
  }
  assert.ok(minMargin >= 0.40 && minWcag >= 7 && maxY <= 0.12, JSON.stringify({ minMargin, minWcag, maxY }));
  // 설계 §5.2 의 «전수 최소 여유 .046» 은 정수 전 도메인에서 확인된다(반박이 아니라 확인).
  assert.ok(Math.abs(minDarkerGap - 0.046) < 0.002, `darker 여유 ${minDarkerGap}`);
  // 모듈 자신의 도메인 단언도 같은 도메인에서 던지지 않는다(로드 격자는 이 도메인의 부분집합).
  assert.equal(assertQrColorDomain({ hues: HUES, sats: SATS_ALL }).colors, 360 * 201 * 2 + 6);
});

test('모듈 그레이 변환은 설계 5종과 이름 · 값이 같다(하나라도 빠지거나 바뀌면 빨강)', () => {
  assert.deepEqual(Object.keys(QR_GRAY_TRANSFORMS).sort(), Object.keys(DESIGN_GRAY).sort());
  const rnd = lcg(0x5eed);
  for (let i = 0; i < 4000; i += 1) {
    const c = { r: Math.floor(rnd() * 256), g: Math.floor(rnd() * 256), b: Math.floor(rnd() * 256) };
    for (const [name, f] of Object.entries(DESIGN_GRAY)) {
      assert.ok(Math.abs(QR_GRAY_TRANSFORMS[name](c) - f(c)) < 1e-12, `${name} ${JSON.stringify(c)}`);
    }
  }
});

test('모듈 가드 판정 = 설계 판정(독립) — 문턱 근처를 촘촘히 덮는 무작위 표본 30000 에서 실패 키 집합까지 같다', () => {
  const rnd = lcg(0xc0ffee);
  const ch = (hi) => Math.floor(rnd() * (hi + 1));
  const modes = ['none', 'darker', 'custom'];
  let agreeOk = 0;
  for (let i = 0; i < 30000; i += 1) {
    // 어두운 쪽은 0..200 채널(Y 0.12 · WCAG 7 · 변환 0.40 문턱을 모두 가로지른다), 밝은 쪽은 대개 #fff.
    const dark = { r: ch(200), g: ch(200), b: ch(255) };
    const eye = rnd() < 0.5 ? { ...dark } : { r: ch(200), g: ch(200), b: ch(255) };
    const light = rnd() < 0.85 ? WHITE : { r: 250 + ch(5), g: 250 + ch(5), b: 250 + ch(5) };
    const eyeMode = modes[i % 3];
    const expected = designFailures({ dark, light, eye }, eyeMode);
    const got = qrContrastGuard({ dark, light, eye }, { eyeMode });
    assert.deepEqual([...moduleFailures(got)].sort(), [...expected].sort(), JSON.stringify({ dark, light, eye, eyeMode }));
    assert.equal(got.ok, expected.size === 0);
    if (got.ok) agreeOk += 1;
  }
  // 표본이 통과 · 거부 양쪽을 다 밟았는지(한쪽만이면 합의는 아무 말도 못 한다).
  assert.ok(agreeOk > 1000 && agreeOk < 29000, `통과 ${agreeOk}`);
});

test('문턱 바로 너머 심은 색 — 각 문이 설계 값에서 거부한다(문턱을 낮추면 빨강)', () => {
  const black = { r: 0, g: 0, b: 0 };
  const only = (colors, eyeMode) => [...moduleFailures(qrContrastGuard(colors, { eyeMode }))].sort();
  // G4: Y ∈ (0.12, 0.125] — 설계 0.12 바로 위(WCAG 도 미달이라 G2:wcag 동반).
  const g4 = { r: 98, g: 98, b: 98 };
  assert.ok(relativeLuminance(g4) > 0.12 && relativeLuminance(g4) < 0.125);
  assert.ok(only({ dark: g4, light: WHITE, eye: g4 }).includes('G4:'));
  assert.ok(only({ dark: black, light: WHITE, eye: g4 }).includes('G4:'), '눈 쪽 Y 도 G4');
  // WCAG 만: Y ≤ 0.12 · 변환 5종 여유 ≥ 0.40 인데 WCAG ∈ (6.8, 7).
  const w = { r: 90, g: 90, b: 90 };
  assert.ok(designWcag(WHITE, w) > 6.8 && designWcag(WHITE, w) < 7 && relativeLuminance(w) <= 0.12);
  assert.ok(Object.values(DESIGN_GRAY).every((f) => 1 - f(w) >= 0.40));
  assert.deepEqual(only({ dark: w, light: WHITE, eye: black }), ['G2:wcag']);
  // 변환마다: 그 변환 하나만 여유 ∈ [0.385, 0.398) · 나머지 ≥ 0.40 인 색(선형 Y709 는 이런 색이
  // 없다 — 1−Y < 0.40 이면 Y > 0.6 이라 감마 변환도 같이 미달. Y709 는 G4 · WCAG 가 덮는다).
  const perTransform = {
    zxing: { r: 88, g: 157, b: 214 },
    gamma709: { r: 148, g: 155, b: 155 },
    avg: { r: 150, g: 56, b: 255 },
    bt601: { r: 189, g: 140, b: 130 },
  };
  for (const [name, c] of Object.entries(perTransform)) {
    for (const [k, f] of Object.entries(DESIGN_GRAY)) {
      const m = 1 - f(c);
      if (k === name) assert.ok(m >= 0.385 && m < 0.398, `${name} 여유 ${m}`);
      else assert.ok(m >= 0.40, `${name} 색의 ${k} 여유 ${m}`);
    }
    assert.ok(only({ dark: c, light: WHITE, eye: black }).includes(`G2:${name}`), name);
    assert.ok(only({ dark: black, light: WHITE, eye: c }).includes(`G2:${name}`), `${name} 눈`);
  }
  // G3: light 가 #fff 에서 한 단계만 어긋나도 — 나머지 문은 통과.
  assert.deepEqual(only({ dark: black, light: { r: 255, g: 255, b: 254 }, eye: black }), ['G3:']);
  // G1 (darker): 한 단계 밝은 눈 — 반전은 아니고 순서만 어긋남.
  const d = { r: 20, g: 20, b: 20 };
  const e = { r: 21, g: 21, b: 21 };
  assert.deepEqual(only({ dark: d, light: WHITE, eye: e }, 'darker'),
    Object.keys(DESIGN_GRAY).map((k) => `G1:${k}`).sort());
  assert.deepEqual(only({ dark: d, light: WHITE, eye: e }, 'custom'), []);
});

test('로드 격자는 UI 도메인의 부분집합이고 양 끝(sat 0 · 200, hue 0 · 355)을 포함한다', () => {
  assert.ok(QR_LOAD_ASSERT_GRID.sats.includes(0) && QR_LOAD_ASSERT_GRID.sats.includes(200) && QR_LOAD_ASSERT_GRID.sats.includes(100));
  assert.ok(QR_LOAD_ASSERT_GRID.hues.every((h) => Number.isInteger(h) && h >= 0 && h < 360));
  assert.ok(QR_LOAD_ASSERT_GRID.sats.every((p) => Number.isInteger(p) && p >= 0 && p <= 200));
});

test('프리셋 3 match: 어두운 = levels[0], darker 눈 = background, 가드 통과', () => {
  for (const name of ['slate', 'ember', 'mono']) {
    const p = getPreset(name);
    const none = resolveQrDeco({ qrColorMode: 'match' }, p, 'oak', OPEN_ALL);
    assert.deepEqual(none.deco.dark, { ...p.levels[0] });
    assert.deepEqual(none.deco.eye, { ...p.levels[0] }, '눈 없음 = 어두운 색');
    assert.deepEqual(none.deco.light, WHITE);
    const darker = resolveQrDeco({ qrColorMode: 'match', qrEyeMode: 'darker' }, p, 'oak', OPEN_ALL);
    assert.deepEqual(darker.deco.eye, { ...p.background });
  }
});

// ── ② 기본값 ──────────────────────────────────────────────────────────────

test('default · square · 눈 없음 → {deco:null} 만(lockReason 없음) — 빈 상태 · 명시 기본 · default 의 darker 모두', () => {
  const states = [{}, { qrColorMode: 'default', qrCellStyle: 'square', qrEyeMode: 'none' },
    { qrColorMode: 'default', qrEyeMode: 'darker' }, { qrEyeDark: true }, { qrHue: 37, qrSat: 0 }];
  for (const state of states) {
    for (const host of QR_HOSTS) {
      // 기본값 경로는 팔레트를 읽지 않는다 — 렌더 팔레트가 들어와도 null(키 없음) 그대로.
      for (const pal of [getPreset('slate'), renderPalette(null)]) {
        const r = resolveQrDeco(deepFreeze({ ...state }), pal, host, OPEN_ALL);
        assert.deepEqual(Object.keys(r), ['deco']);
        assert.equal(r.deco, null);
      }
    }
  }
});

test('기본 허용표(전부 잠금 스텁)에서는 모든 비기본 선택이 사유와 함께 잠기고 상태는 그대로다', () => {
  const state = deepFreeze({ qrColorMode: 'custom', qrCellStyle: 'dots', qrHue: 120, qrSat: 150, qrEyeMode: 'darker' });
  for (const host of QR_HOSTS) {
    const r = resolveQrDeco(state, getPreset('slate'), host);
    assert.equal(r.deco, null);
    assert.equal(r.lockReason, 'qr-unmeasured');
  }
});

// ── ③ 심은 결함 ───────────────────────────────────────────────────────────

test('심은 결함 1 — 어두운 목표 Y=0.18: 전 격자에서 G4 로 거부, WCAG 도 미달, avg G2 미달 hue 존재(설계 .378 확인)', () => {
  let avgFail = 0;
  let worstAvg = Infinity;
  for (const h of HUES) {
    for (const p of [0, 50, 100, 150, 200]) {
      const dark = colorAtLuminance(h, satAt(0.42, p), 0.18);
      const g = qrContrastGuard({ dark, light: WHITE, eye: dark });
      assert.equal(g.ok, false);
      assert.ok(gates(g).has('G4'), `hue ${h} sat ${p}: G4`);
      assert.ok(g.failures.some((f) => f.gate === 'G2' && f.transform === 'wcag'));
      if (g.failures.some((f) => f.gate === 'G2' && f.transform === 'avg')) avgFail += 1;
      worstAvg = Math.min(worstAvg, 1 - QR_GRAY_TRANSFORMS.avg(dark));
    }
  }
  assert.ok(avgFail > 0, 'avg 변환 G2 미달이 적어도 한 점');
  assert.ok(Math.abs(worstAvg - 0.378) < 0.002, `avg 최악 ${worstAvg}`);
  // 대조: 같은 식의 목표 0.0612 는 같은 격자에서 통과한다(결함은 목표 Y 하나다).
  assert.ok(qrContrastGuard({ dark: qrCustomDark(268, 200), light: WHITE, eye: qrCustomDark(268, 200) }).ok);
});

test('심은 결함 2 — light = 커스텀 levels[2]@s1: 전 hue 에서 G3 거부, avg G2 미달 hue 존재(설계 .354 확인)', () => {
  const yL2 = relativeLuminance(getPreset('slate').levels[2]);
  let avgFail = 0;
  let worst = Infinity;
  for (const h of HUES) {
    const light = colorAtLuminance(h, 1, yL2);
    const dark = qrCustomDark(h, 200);
    const g = qrContrastGuard({ dark, light, eye: dark });
    assert.equal(g.ok, false);
    assert.ok(gates(g).has('G3'), `hue ${h}: G3`);
    if (g.failures.some((f) => f.gate === 'G2' && f.transform === 'avg')) avgFail += 1;
    worst = Math.min(worst, QR_GRAY_TRANSFORMS.avg(light) - QR_GRAY_TRANSFORMS.avg(dark));
  }
  assert.ok(avgFail > 0);
  assert.ok(Math.abs(worst - 0.354) < 0.002, `avg 최악 ${worst}`);
});

test('심은 결함 3 — paletteOf 형 렌더 팔레트(background null · #fff · #000)는 모든 비기본 모드에서 거부', () => {
  for (const bg of [null, { r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }]) {
    const pal = deepFreeze(renderPalette(bg));
    assert.notEqual(basePaletteProblem(pal), null);
    for (const state of [{ qrColorMode: 'match' }, { qrColorMode: 'match', qrEyeMode: 'darker' },
      { qrColorMode: 'custom' }, { qrCellStyle: 'dots' }]) {
      const r = resolveQrDeco(state, pal, 'oak', OPEN_ALL);
      assert.equal(r.deco, null, JSON.stringify({ bg, state }));
      assert.equal(r.lockReason, 'qr-base-palette');
    }
  }
  // 렌더 키를 벗겨도 name 이 없으면(= paletteOf 결과) 거부, background null 이면 거부.
  const { levels } = getPreset('slate');
  assert.notEqual(basePaletteProblem({ background: { r: 0, g: 0, b: 0 }, levels }), null);
  assert.notEqual(basePaletteProblem({ name: 'slate', background: null, levels }), null);
  // 검정 배경은 대비로는 통과한다 — 그래서 모양 가드가 따로 있어야 한다(대비 가드만으로는 못 막는다).
  assert.ok(qrContrastGuard({ dark: levels[0], light: WHITE, eye: { r: 0, g: 0, b: 0 } }, { eyeMode: 'darker' }).ok);
});

test('런타임 재단언: 기저 모양이지만 levels[0] 이 밝은 팔레트 → deco:null · qr-contrast · 막은 문 G4', () => {
  const slate = getPreset('slate');
  const bright = deepFreeze({ name: 'slate', label: 'x', background: slate.background,
    levels: [{ r: 150, g: 150, b: 150 }, slate.levels[1], slate.levels[2]] });
  const r = resolveQrDeco({ qrColorMode: 'match' }, bright, 'y', OPEN_ALL);
  assert.equal(r.deco, null);
  assert.equal(r.lockReason, 'qr-contrast');
  assert.ok(r.failures.some((f) => f.gate === 'G4'));
});

test('G1 순서: darker 는 눈이 데이터보다 밝으면 거부, Q3(b) custom 눈은 순서를 묻지 않는다', () => {
  const dark = qrDarkerEye(210, 100); // 아주 어두운 색을 데이터로
  const eye = qrCustomDark(210, 100); // 그보다 밝은 색을 눈으로
  const darker = qrContrastGuard({ dark, light: WHITE, eye }, { eyeMode: 'darker' });
  assert.ok(darker.failures.some((f) => f.gate === 'G1'));
  assert.ok(qrContrastGuard({ dark, light: WHITE, eye }, { eyeMode: 'custom' }).ok);
  // 반전(흰 눈)은 모든 모드에서 G1.
  assert.ok(gates(qrContrastGuard({ dark, light: WHITE, eye: WHITE })).has('G1'));
  assert.ok(gates(qrContrastGuard({ dark, light: WHITE, eye: null })).has('shape'));
});

// ── ④ 색 공식 · 눈 옵션 · 허용표 · 순수성 ──────────────────────────────────

test('custom(h, p) = match(makeCustomPalette(h, ·, p)) = L1 원본 levels[0] · background (같은 식)', () => {
  for (let h = 0; h < 360; h += 7) {
    for (const p of [0, 35, 100, 165, 200]) {
      const pal = makeCustomPalette(h, 'custom', p);
      assert.deepEqual(qrCustomDark(h, p), pal.levels[0], `dark h${h} p${p}`);
      assert.deepEqual(qrDarkerEye(h, p), pal.background, `eye h${h} p${p}`);
      const viaMatch = resolveQrDeco({ qrColorMode: 'match', qrEyeMode: 'darker', customSat: p }, pal, 'h', OPEN_ALL);
      const viaCustom = resolveQrDeco({ qrColorMode: 'custom', qrEyeMode: 'darker', qrHue: h, qrSat: p },
        getPreset('slate'), 'h', OPEN_ALL);
      assert.deepEqual(viaMatch.deco, viaCustom.deco, `h${h} p${p}`);
    }
  }
  assert.ok(Math.abs(QR_DARK_TARGET_Y - 0.0612) < 5e-4, '설계 표 0.0612');
});

test('match darker 폴백: 기저 background 가 눈으로 가드에 실패하면 colorAtLuminance(hue(levels[0]), satAt(0.32, p), Y_BG)', () => {
  const slate = getPreset('slate');
  const pale = deepFreeze({ name: 'slate', label: 'x', background: { r: 200, g: 200, b: 200 }, levels: slate.levels });
  const r = resolveQrDeco({ qrColorMode: 'match', qrEyeMode: 'darker' }, pale, 'oak', OPEN_ALL);
  assert.deepEqual(r.deco.eye, { ...qrDarkerEye(hueOfRgb(slate.levels[0]), 100) });
  assert.ok(qrContrastGuard(r.deco, { eyeMode: 'darker' }).ok);
  // 커스텀 기저면 폴백 채도는 customSat.
  const pc = deepFreeze({ ...makeCustomPalette(300, 'custom', 180), background: { r: 200, g: 200, b: 200 } });
  const rc = resolveQrDeco({ qrColorMode: 'match', qrEyeMode: 'darker', customSat: 180 }, pc, 'oak', OPEN_ALL);
  assert.deepEqual(rc.deco.eye, { ...qrDarkerEye(hueOfRgb(pc.levels[0]), 180) });
});

test('눈 옵션 두 해석: darker(Q3 a) 는 더 어둡게만 · custom(Q3 b) 는 별도 hue·채도 · 초안 키 qrEyeDark 는 darker', () => {
  const pal = getPreset('slate');
  for (const [h, p] of [[0, 0], [60, 200], [210, 100], [300, 150]]) {
    const a = resolveQrDeco({ qrColorMode: 'custom', qrHue: h, qrSat: p, qrEyeMode: 'darker' }, pal, 'oak', OPEN_ALL).deco;
    for (const f of Object.values(QR_GRAY_TRANSFORMS)) assert.ok(f(a.eye) <= f(a.dark), `darker h${h} p${p}`);
    const legacy = resolveQrDeco({ qrColorMode: 'custom', qrHue: h, qrSat: p, qrEyeDark: true }, pal, 'oak', OPEN_ALL).deco;
    assert.deepEqual(legacy, a);
    const b = resolveQrDeco({ qrColorMode: 'custom', qrHue: h, qrSat: p, qrEyeMode: 'custom', qrEyeHue: 330, qrEyeSat: 200 },
      pal, 'oak', OPEN_ALL).deco;
    assert.deepEqual(b.eye, { ...qrCustomDark(330, 200) });
    assert.ok(relativeLuminance(b.eye) <= DESIGN_MAX_DARK_Y);
  }
  // Q3 (b) 는 default(검정 데이터) 위에도 된다.
  const d = resolveQrDeco({ qrEyeMode: 'custom', qrEyeHue: 0, qrEyeSat: 200 }, pal, 'h', OPEN_ALL).deco;
  assert.deepEqual(d.dark, { r: 0, g: 0, b: 0 });
  assert.deepEqual(d.eye, { ...qrCustomDark(0, 200) });
});

test('허용표 fail-closed: 행 한 줄은 그 조합만 연다 · 키가 빠진 행은 아무것도 열지 않는다 · 모양 불량 표는 던진다', () => {
  const pal = getPreset('ember');
  const one = { ROWS: [{ table: 'qr', host: 'oak', qrCellStyle: 'rounded', qrColorMode: 'match', eyeMode: 'none' }] };
  const state = { qrColorMode: 'match', qrCellStyle: 'rounded' };
  assert.equal(resolveQrDeco(state, pal, 'oak', one).deco.cellStyle, 'rounded');
  assert.equal(resolveQrDeco(state, pal, 'y', one).lockReason, 'qr-unmeasured');
  assert.equal(resolveQrDeco({ ...state, qrEyeMode: 'darker' }, pal, 'oak', one).lockReason, 'qr-unmeasured');
  assert.equal(resolveQrDeco({ ...state, qrCellStyle: 'dots' }, pal, 'oak', one).lockReason, 'qr-unmeasured');
  const missing = { ROWS: [{ table: 'qr', host: 'oak', qrCellStyle: 'rounded', qrColorMode: 'match' }] };
  assert.equal(resolveQrDeco(state, pal, 'oak', missing).lockReason, 'qr-unmeasured');
  const otherTable = { ROWS: [{ table: 'oak', host: 'oak', qrCellStyle: 'rounded', qrColorMode: 'match', eyeMode: 'none' }] };
  assert.equal(resolveQrDeco(state, pal, 'oak', otherTable).lockReason, 'qr-unmeasured');
  assert.throws(() => resolveQrDeco(state, pal, 'oak', {}), TypeError);
});

test('입력 검증: 모르는 호스트는 던지고, 도메인 밖 상태는 사유와 함께 잠근다', () => {
  const pal = getPreset('slate');
  assert.throws(() => resolveQrDeco({ qrColorMode: 'match' }, pal, 'O', OPEN_ALL), RangeError);
  for (const state of [{ qrColorMode: 'neon' }, { qrCellStyle: 'star' }, { qrEyeMode: 'glow' },
    { qrColorMode: 'custom', qrSat: 201 }, { qrColorMode: 'custom', qrHue: Number.NaN },
    { qrColorMode: 'match', customSat: -1 }]) {
    assert.equal(resolveQrDeco(state, pal, 'oak', OPEN_ALL).lockReason, 'qr-invalid-state', JSON.stringify(state));
  }
  assert.equal(qrHostOfType('K'), 'oak');
  assert.equal(qrHostOfType('V'), 'oak');
  assert.equal(qrHostOfType('Y'), 'y');
  assert.equal(qrHostOfType('H'), 'h');
  assert.throws(() => qrHostOfType('Z'), RangeError);
});

test('순수성: 상태 · 팔레트를 고치지 않고, deco 는 얼어 있고, makeCustomPalette 한 칸 캐시를 흔들지 않는다', () => {
  const first = makeCustomPalette(123, 'first-label', 100);
  const state = deepFreeze({ qrColorMode: 'custom', qrHue: 45, qrSat: 170, qrEyeMode: 'darker', qrCellStyle: 'diamond' });
  const pal = deepFreeze(makeCustomPalette(123, 'first-label', 100));
  for (const host of QR_HOSTS) {
    for (const mode of QR_COLOR_MODES) {
      const r = resolveQrDeco({ ...state, qrColorMode: mode, qrHue: 45 + host.length }, pal, host, OPEN_ALL);
      assert.ok(r.deco === null || Object.isFrozen(r.deco));
    }
  }
  // 캐시가 그대로면 같은 {hue, sat} 에 다른 label 을 줘도 처음 객체가 온다.
  assert.equal(makeCustomPalette(123, 'second-label', 100), first);
  const r = resolveQrDeco(state, pal, 'oak', OPEN_ALL);
  assert.equal(r.deco.cellStyle, 'diamond');
  assert.ok(Object.isFrozen(r.deco.dark) && Object.isFrozen(r.deco.eye));
});

test('hueOfRgb: 원색 · 무채색', () => {
  assert.equal(hueOfRgb({ r: 255, g: 0, b: 0 }), 0);
  assert.equal(hueOfRgb({ r: 0, g: 255, b: 0 }), 120);
  assert.equal(hueOfRgb({ r: 0, g: 0, b: 255 }), 240);
  assert.equal(hueOfRgb({ r: 255, g: 0, b: 255 }), 300);
  assert.equal(hueOfRgb({ r: 70, g: 70, b: 70 }), 0);
});
