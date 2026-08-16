/**
 * generator-preview-ui.test.js — 생성기 UI 대개편 B (운영자 지시 2026-08-16) 의 계약.
 *
 * 무엇을 지키나:
 *   B-1 미리보기 fit — 표시 크기를 **인라인 px 로 다시 박지 않는가**(그게 왼쪽 쏠림의
 *       원인이었다) · 상자 폭이 `min(가용폭, 가용높이 × 종횡비)` 인가 · 무대 높이와
 *       `--fit-h` 가 **산술적으로 일치**하는가 (한쪽만 고치면 레터박스가 돌아온다)
 *   B-2 스타일 바 — 프리셋 바가 «그 프리셋 색의 진한 셰이드» 이고 셋이 실제로 구분되는가 ·
 *       커스텀 카드 안 색 바가 hue 슬라이더로 바뀌었고 움직이면 커스텀이 선택되는가 ·
 *       슬라이더를 품은 카드가 role=button 이 아닌가 (ARIA presentational children)
 *   B-3 배치 버튼 — 미리보기 위 버튼이 패널 버튼과 **같은 동작·같은 라벨**을 쓰는가
 *   B-4 조작 안내 — 세 언어가 다 있고, 조작에서 사라지며, «핀치» 를 말하는 문구가
 *       실제 두 손가락 처리와 짝이 맞는가 (문구만 있고 코드가 없으면 거짓말이 된다)
 *
 * 파생 번들(dist·sites)에도 같은 규칙이 실려 나가는지 함께 본다 — 정본만 고치고
 * 번들을 안 굽는 사고가 이 프로젝트에서 이미 있었다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PRESETS } from '../src/luminance.js';
import { buildSingleHtml } from '../tools/build-single.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

function langBlock(lang) {
  const start = INDEX.indexOf('const GENERATOR_STRINGS = {');
  assert.ok(start >= 0, 'GENERATOR_STRINGS 를 못 찾았다');
  const at = INDEX.indexOf(`  ${lang}: {`, start);
  assert.ok(at > start, `${lang} 사전을 못 찾았다`);
  const open = INDEX.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < INDEX.length; i += 1) {
    if (INDEX[i] === '{') depth += 1;
    else if (INDEX[i] === '}') {
      depth -= 1;
      if (depth === 0) return INDEX.slice(open, i + 1);
    }
  }
  throw new Error(`${lang} 사전이 닫히지 않는다`);
}

/** 사전에서 키 하나를 꺼낸다 (문자열 리터럴 그대로). */
function stringFor(lang, key) {
  const block = langBlock(lang);
  const m = block.match(new RegExp(`"${key}":\\s*("(?:[^"\\\\]|\\\\.)*")`));
  assert.ok(m, `${lang}/${key} 가 없다`);
  return JSON.parse(m[1]);
}

const LANGS = ['ko', 'en', 'ja'];

// ── B-1 미리보기 fit ──────────────────────────────────────────────────────

test('drawScene 은 표시 크기를 인라인 px 로 박지 않는다 (왼쪽 쏠림의 원인)', () => {
  const at = INDEX.indexOf('function drawScene(');
  assert.ok(at > 0, 'drawScene 을 못 찾았다');
  const body = INDEX.slice(at, INDEX.indexOf('\n}\n', at));
  assert.ok(!/canvas\.style\.width\s*=/.test(body),
    'drawScene 이 style.width 를 다시 박고 있다 — 상자가 미리보기 영역과 무관해진다');
  assert.ok(!/canvas\.style\.height\s*=/.test(body), 'drawScene 이 style.height 를 다시 박고 있다');
  // 내부 해상도는 그대로여야 한다 («내부 해상도 불변» 지시).
  assert.match(body, /canvas\.width = Math\.round\(scene\.width \* ppu \* dpr\)/);
  assert.match(body, /canvas\.height = Math\.round\(scene\.height \* ppu \* dpr\)/);
});

test('그린 픽셀의 종횡비가 --code-aspect 로 넘어가고, 렌더가 그걸 호출한다', () => {
  assert.match(INDEX, /function applyPreviewFit\(\) \{/);
  assert.match(INDEX, /setProperty\('--code-aspect', String\(aspect\)\)/);
  // scene 단위가 아니라 **반올림된 캔버스 픽셀**이어야 상자와 그림이 안 어긋난다.
  assert.match(INDEX, /c\.width > 0 && c\.height > 0 \? c\.width \/ c\.height : 1/);
  const render = INDEX.slice(INDEX.indexOf("drawScene(result.scene, els.canvas, 26);"));
  assert.ok(render.slice(0, 200).includes('applyPreviewFit();'),
    'drawScene 직후에 applyPreviewFit 이 없다 — 첫 프레임이 옛 종횡비로 뜬다');
});

test('상자 폭 = min(가용폭, 가용높이 × 종횡비) — contain 이 CSS 로 강제된다', () => {
  assert.match(INDEX, /#canvasWrap \{[^}]*aspect-ratio: var\(--code-aspect, 1\);/);
  assert.match(INDEX,
    /width: min\(100%, calc\(var\(--fit-h, 60vh\) \* var\(--code-aspect, 1\)\)\);/);
  // 옛 규칙(두 축을 따로 자르던 max-width/max-height)이 남아 있으면 레터박스가 돌아온다.
  assert.ok(!/max-height: calc\(100vh - 180px\)/.test(INDEX),
    '캔버스에 옛 max-height 클램프가 남아 있다');
});

test('무대 높이와 --fit-h 가 산술적으로 일치한다 (패딩 40 + 테두리 2)', () => {
  const stage = INDEX.match(/main > #stage \{[\s\S]*?height: max\((\d+)px, calc\(100vh - (\d+)px\)\);/);
  assert.ok(stage, '데스크톱 무대 높이 규칙을 못 찾았다');
  const fit = INDEX.match(/#canvasWrap \{ --fit-h: max\((\d+)px, calc\(100vh - (\d+)px\)\); \}/);
  assert.ok(fit, '데스크톱 --fit-h 규칙을 못 찾았다');
  const [, stageMin, stageOff] = stage.map(Number);
  const [, fitMin, fitOff] = fit.map(Number);
  const inset = 20 * 2 + 1 * 2; // #stage padding 20px + border 1px (양쪽)
  assert.equal(fitOff - stageOff, inset,
    `--fit-h 오프셋(${fitOff})이 무대 오프셋(${stageOff}) + ${inset} 가 아니다 — 레터박스가 생긴다`);
  assert.equal(stageMin - fitMin, inset,
    `--fit-h 최소값(${fitMin})이 무대 최소값(${stageMin}) − ${inset} 가 아니다`);
});

test('데스크톱 무대는 sticky 라 긴 패널을 스크롤해도 코드가 남는다', () => {
  // ⚠ `main > #stage` 는 order 규칙에도 있다 — 2열 미디어 쿼리 안쪽 것만 본다.
  const block = INDEX.match(/main > #stage \{\s*\n\s*align-self: start;[\s\S]*?\}/);
  assert.ok(block, '2열 레이아웃의 #stage 규칙을 못 찾았다');
  assert.match(block[0], /position: sticky; top: 12px;/);
  assert.match(block[0], /height: max\(420px, calc\(100vh - 80px\)\);/);
});

test('두 캔버스가 같은 상자를 정확히 덮는다 (backdrop 정합 · 포인터 좌표)', () => {
  assert.match(INDEX, /canvas \{\s*\n\s*position: absolute; inset: 0;\s*\n\s*width: 100%; height: 100%;/);
});

// ── B-2 스타일 섹션 ───────────────────────────────────────────────────────

test('프리셋 바는 그 프리셋 색의 진한 셰이드이고, 셋이 서로 구분된다', () => {
  assert.match(INDEX, /const DEEP_SHADE_K = 0\.62;/);
  assert.match(INDEX, /bgStrip\.style\.background = rgbCss\(presetDeepShade\(p\)\);/);
  // 옛 규칙(배경색)으로 돌아가면 세 바가 다시 같은 near-black 이 된다.
  assert.ok(!/bgStrip\.style\.background = rgbCss\(p\.background\)/.test(INDEX));

  const k = 0.62;
  const shade = (p) => [p.levels[1].r, p.levels[1].g, p.levels[1].b].map((v) => Math.round(v * k));
  const names = Object.keys(PRESETS);
  const shades = names.map((n) => shade(PRESETS[n]));
  // ① 셋이 서로 구분된다 (채널 합 차이 40 이상 — 눈으로 갈리는 폭)
  for (let i = 0; i < shades.length; i += 1) {
    for (let j = i + 1; j < shades.length; j += 1) {
      const d = shades[i].reduce((s, v, c) => s + Math.abs(v - shades[j][c]), 0);
      assert.ok(d >= 40, `${names[i]} 와 ${names[j]} 의 바 색이 너무 가깝다 (Σ|Δ|=${d})`);
    }
  }
  // ② 옛 색(배경)은 셋이 사실상 같았다 — 이 회귀 근거를 테스트에 남긴다
  const bgs = names.map((n) => [PRESETS[n].background.r, PRESETS[n].background.g, PRESETS[n].background.b]);
  const bgSpread = Math.max(...bgs.map((b) => b.reduce((s, v) => s + v, 0)))
    - Math.min(...bgs.map((b) => b.reduce((s, v) => s + v, 0)));
  assert.ok(bgSpread < 40, `배경색 셋의 차이가 ${bgSpread} — 이 테스트의 전제(구분 불가)가 깨졌다`);
  // ③ 진한 셰이드는 원래 레벨보다 어둡다 («진한» 의 정의)
  for (let i = 0; i < names.length; i += 1) {
    const lvl = PRESETS[names[i]].levels[1];
    assert.ok(shades[i][0] < lvl.r && shades[i][1] < lvl.g && shades[i][2] < lvl.b);
  }
});

test('커스텀 카드 안의 색 바가 hue 슬라이더로 바뀌었다', () => {
  const card = INDEX.match(/<div class="toggle-card swatch-card" id="customStyleCard"[\s\S]*?<\/div>\s*<\/div>/)[0];
  assert.match(card, /<input type="range" id="hueBar" class="hue-bar in-card"/);
  assert.ok(!/id="customBg"/.test(INDEX), '옛 고정색 바(#customBg)가 남아 있다');
  assert.match(card, /data-i18n-attr="aria-label:g960"/);
  assert.match(INDEX, /\.hue-bar\.in-card \{ height: 8px; margin: 2px 0 0; \}/);
});

test('hue 바를 움직이기만 해도 커스텀이 선택된다 (마우스·터치·방향키 공통 input)', () => {
  const handler = INDEX.match(/for \(const bar of \[els\.hueBar, els\.hueBarAdv\]\) \{[\s\S]*?\n\}/)[0];
  assert.match(handler, /generatorState\.customHue = Number\(bar\.value\);/);
  assert.match(handler, /generatorState\.preset = 'custom';/);
  // 값을 안 바꾸고 «커스텀만» 고르는 키보드 경로도 있어야 한다
  const keys = INDEX.match(/els\.hueBar\.addEventListener\('keydown'[\s\S]*?\n\}\);/)[0];
  assert.match(keys, /ev\.key !== 'Enter' && ev\.key !== ' '/);
  assert.match(keys, /generatorState\.preset = 'custom';/);
});

test('슬라이더를 품은 카드는 role=button 이 아니다 (ARIA presentational children)', () => {
  const loop = INDEX.match(/for \(const card of document\.querySelectorAll\('\.toggle-card'\)\) \{[\s\S]*?\n\}/)[0];
  assert.match(loop, /if \(card === els\.customStyleCard\) \{\s*\n\s*card\.setAttribute\('role', 'group'\);\s*\n\s*continue;/);
  assert.match(loop, /card\.setAttribute\('role', 'button'\);/); // 나머지 카드는 그대로
  assert.match(INDEX, /id="customStyleCard"[^>]*aria-labelledby="customStyleCardLabel"/);
});

// ── B-3 미리보기 위 배치 버튼 ─────────────────────────────────────────────

test('투명 배경일 때 미리보기 우상단에 배치 버튼이 뜬다 (아이콘은 인라인 SVG)', () => {
  const overlay = INDEX.match(/<div class="stage-overlay" id="stageOverlay">[\s\S]*?<\/div>\s*<\/div>/)[0];
  assert.match(overlay, /<button type="button" class="stage-overlay-btn" id="stageBackdropPick" hidden>/);
  assert.match(overlay, /<svg viewBox="0 0 24 24"[\s\S]*?<\/svg>/);
  assert.ok(!/<img /.test(overlay), '오버레이에 외부 이미지가 들어갔다 (인라인 SVG 만 허용)');
  assert.match(overlay, /id="stageBackdropPickLabel" data-i18n="g961"/);
  // 오른쪽 정렬은 spacer 로 — 버튼이 왼쪽 안내와 같은 줄에 있다
  assert.match(overlay, /<span class="spacer"><\/span>/);
  assert.match(INDEX, /\.stage-overlay \{[^}]*position: absolute; left: 14px; right: 14px; top: 14px;/);
  // 드래그를 막으면 안 된다
  assert.match(INDEX, /\.stage-overlay \{[^}]*pointer-events: none;/);
});

test('오버레이 버튼은 패널 버튼과 같은 동작·같은 라벨을 쓴다', () => {
  assert.match(INDEX, /els\.stageBackdropPick\.addEventListener\('click', \(\) => els\.backdropFile\.click\(\)\);/);
  const sync = INDEX.match(/function syncBackdropUi\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(sync, /els\.backdropPick\.textContent = has \? tf\('g437', \{ name: backdrop\.name \}\) : t\('g419'\);/);
  assert.match(sync, /els\.stageBackdropPickLabel\.textContent = has \? tf\('g437', \{ name: backdrop\.name \}\) : t\('g961'\);/);
  assert.match(sync, /els\.stageBackdropPick\.hidden = !on;/);
});

// ── B-4 조작 안내 오버레이 ────────────────────────────────────────────────

test('안내는 «보임 → 안 보임» 에지에서만 뜨고 조작에서 사라진다', () => {
  const sync = INDEX.match(/function syncBackdropUi\(\) \{[\s\S]*?\n\}/)[0];
  // syncBackdropUi 는 렌더·드래그 종료마다 돈다 — 무조건 show 면 조작할 때마다 되살아난다
  assert.match(sync, /if \(showing && !backdropWasShowing\) showGestureHint\(\);/);
  assert.match(sync, /if \(!showing\) hideGestureHint\(true\);/);
  const pointerdown = INDEX.match(/els\.canvasWrap\.addEventListener\('pointerdown'[\s\S]*?\n  \}\);/)[0];
  assert.match(pointerdown, /hideGestureHint\(false\);/);
  const wheel = INDEX.match(/els\.canvasWrap\.addEventListener\('wheel'[\s\S]*?\{ passive: false \}\);/)[0];
  assert.match(wheel, /hideGestureHint\(false\);/);
  // 아무 조작이 없어도 사진을 영구히 가리지 않는다
  assert.match(INDEX, /const GESTURE_HINT_IDLE_MS = 7000;/);
  // rAF 로 미루면 백그라운드 탭에서 IDLE 타이머와 순서가 뒤집힌다 — 리플로로 강제한다
  assert.match(INDEX, /void els\.backdropGestureHint\.offsetWidth;/);
  assert.ok(!/requestAnimationFrame\(\(\) => els\.backdropGestureHint/.test(INDEX));
});

test('페이드는 CSS 전이이고, 접근성 트리에서 빠지는 건 전이 뒤다', () => {
  assert.match(INDEX, /\.stage-hint \{[^}]*transition: opacity \.45s ease, visibility 0s linear 0s;/);
  assert.match(INDEX, /\.stage-hint\.faded \{\s*\n\s*opacity: 0; visibility: hidden;\s*\n\s*transition: opacity \.45s ease, visibility 0s linear \.45s;/);
  assert.match(INDEX, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.stage-hint \{/);
  // «어느 정도 눈에 띄는» 글자 크기 — 힌트 문단(11\~12px)보다 크고 굵다
  const hint = INDEX.match(/\.stage-hint \{[\s\S]*?\n  \}/)[0];
  assert.match(hint, /font-size: 13px; font-weight: 600;/);
});

test('«핀치» 를 말하는 문구에 대응하는 두 손가락 처리가 실제로 있다', () => {
  const block = INDEX.match(/\/\*\* 눌려 있는 포인터들[\s\S]*?\n\}/)[0];
  assert.match(block, /const points = new Map\(\);/);
  assert.match(block, /let pinch = null;/);
  assert.match(block, /if \(points\.size >= 2\) \{ beginPinch\(\); return; \}/);
  assert.match(block, /Math\.hypot\(a\.x - b\.x, a\.y - b\.y\)/);
  assert.match(block, /zoomAt\(anchor\.x, anchor\.y, backdropView\.scale \* \(dist \/ pinch\.dist\)\)/);
  // 두 손가락 중 하나만 떼면 남은 손가락으로 팬이 이어진다
  assert.match(block, /if \(points\.size === 1\) \{/);
  // 휠과 핀치가 같은 줌 함수를 쓴다 (한쪽만 고쳐지는 것을 막는다)
  assert.match(block, /const zoomAt = \(cx, cy, next\) => \{/);
  assert.match(block, /Math\.min\(20, Math\.max\(0\.05, next\)\)/);
});

test('touch-action: none 이 있어야 핀치가 브라우저 기본 제스처와 안 다툰다', () => {
  assert.match(INDEX, /#canvasWrap \{[^}]*touch-action: none;/);
});

// ── i18n (g9xx 대역 — B 는 g960\~g962) ────────────────────────────────────

test('신규 키 g960·g961·g962 가 ko/en/ja 에 다 있고 언어마다 다르다', () => {
  for (const key of ['g960', 'g961', 'g962']) {
    const seen = new Set();
    for (const lang of LANGS) {
      const s = stringFor(lang, key);
      assert.ok(s.trim().length > 0, `${lang}/${key} 가 비어 있다`);
      seen.add(s);
    }
    assert.equal(seen.size, 3, `${key} 가 세 언어에서 같은 문자열이다 (번역 누락)`);
  }
});

test('핀치를 구현했으므로 «휠만» 이라고 말하던 문구가 세 언어 모두 갱신됐다', () => {
  const pinch = { ko: '핀치', en: 'pinch', ja: 'ピンチ' };
  for (const lang of LANGS) {
    for (const key of ['g207', 'g300', 'g903', 'g962']) {
      assert.ok(stringFor(lang, key).includes(pinch[lang]),
        `${lang}/${key} 가 핀치를 말하지 않는다 — 구현과 문구가 어긋난다`);
    }
  }
  // 정적 DOM 기본 문구도 같이 (사전만 고치면 첫 페인트가 옛 문구로 뜬다)
  assert.match(INDEX, /<b data-i18n="g207">휠 또는 핀치로 확대\/축소<\/b>/);
});

// ── 파생 번들 ─────────────────────────────────────────────────────────────

test('단일 파일 번들과 사이트 파생본에도 같은 규칙이 실린다', () => {
  const targets = [
    ['dist/trilume.html', readFileSync(ROOT + 'dist/trilume.html', 'utf8')],
    ['sites/_shared/lab-gen.html', readFileSync(ROOT + 'sites/_shared/lab-gen.html', 'utf8')],
    ['sites/_shared/gen-finder.html', readFileSync(ROOT + 'sites/_shared/gen-finder.html', 'utf8')],
    ['buildSingleHtml()', buildSingleHtml()],
  ];
  for (const [name, html] of targets) {
    assert.match(html, /aspect-ratio: var\(--code-aspect, 1\);/, `${name}: fit 규칙이 없다 — 파생 산출물이 소스보다 낡았을 가능성이 크다 (빌더 재실행 필요)`);
    assert.match(html, /id="stageBackdropPick"/, `${name}: 배치 버튼 누락`);
    assert.match(html, /id="backdropGestureHint"/, `${name}: 조작 안내 누락`);
    assert.match(html, /class="hue-bar in-card"/, `${name}: 카드 안 hue 바 누락`);
    // 번들은 사전을 **이스케이프된 JSON 문자열**로 심는다 (`g962\": \"…`) — 정본의
    // `"g962":` 형태를 그대로 찾으면 항상 실패한다.
    for (const lang of ['드래그로 위치 이동', 'Drag to move', 'ドラッグで移動']) {
      assert.ok(html.includes(lang), `${name}: 신규 사전 값(${lang}) 누락`);
    }
  }
});
