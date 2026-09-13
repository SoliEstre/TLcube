/** 생성기 미리보기 열 폭은 넓은 화면에서 stage·시험판 배너가 같은 기준을 써야 해요. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function cssRule(selector, from = INDEX) {
  const match = new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(from);
  assert.ok(match, `CSS rule을 찾지 못했어요: ${selector}`);
  return match[1];
}

test('넓은 생성기 열의 공통 폭·좌우 여백 토큰을 main과 시험판 배너가 함께 사용해요', () => {
  // 둘 중 하나만 넓히면 stage와 시험판 배너의 오른쪽 끝이 다시 갈라진다.
  assert.match(INDEX, /--generator-max-width\s*:\s*1900px\s*;/,
    '생성기 공통 최대폭 토큰이 없다');
  assert.match(INDEX, /--generator-gutter\s*:\s*24px\s*;/,
    '생성기 공통 좌우 여백 토큰이 없다');

  const main = cssRule('main');
  assert.match(main, /width\s*:\s*100%\s*;/);
  assert.match(main, /max-width\s*:\s*var\(--generator-max-width\)\s*;/);
  assert.match(main, /padding\s*:[^;]*var\(--generator-gutter\)[^;]*;/,
    'main이 공통 좌우 여백 토큰을 소비하지 않는다');

  const banner = cssRule('.experiment-banner');
  assert.match(banner, /max-width\s*:\s*calc\(var\(--generator-max-width\)\s*-\s*2\s*\*\s*var\(--generator-gutter\)\)\s*;/,
    '시험판 배너 최대폭이 main 콘텐츠 열의 양쪽 gutter를 빼지 않는다');
  assert.match(banner, /width\s*:[^;]*var\(--generator-gutter\)[^;]*;/,
    '시험판 배너 폭이 공통 좌우 여백을 반영하지 않는다');
  assert.match(banner, /margin\s*:[^;]*var\(--generator-gutter\)[^;]*;/,
    '시험판 배너 margin이 공통 좌우 여백을 소비하지 않는다');
});

test('데스크톱 previewColumn의 stage는 shrink-to-fit이 아니라 열 전체 폭을 차지해요', () => {
  const stage = cssRule('main > #stage, #previewColumn > #stage');
  assert.match(stage, /align-self\s*:\s*start\s*;/,
    '기존 grid 정렬 호환용 align-self:start가 사라졌다');
  assert.match(cssRule('#stage'), /width\s*:\s*100%\s*;/,
    'flex 자식 stage가 열 전체 폭을 명시하지 않아 shrink-to-fit으로 돌아간다');
});

test('빈 면 이미지 패널은 미리보기 카드 안에서 도구 모음 다음에 배치돼요', () => {
  const markup=INDEX.slice(INDEX.indexOf('<div id="previewColumn">'),INDEX.indexOf('</main>'));
  assert.equal((markup.match(/id="hFaceImagesPanel"/g)||[]).length,1);
  assert.ok(markup.indexOf('id="y3dSnapRow"')<markup.indexOf('id="hFaceImagesPanel"'));
  assert.match(markup, /<section id="hFaceImagesPanel"[\s\S]*?<\/section>\s*<\/div>\s*<\/div>\s*$/);
  assert.doesNotMatch(INDEX,/\$\('previewColumn'\)\.append\(\$\('hFaceImagesPanel'\)\)/);
  assert.match(cssRule('#hFaceImagesPanel'),/flex\s*:\s*none\s*;/);
  assert.match(cssRule('#hFaceImagesPanel'),/margin-top\s*:\s*12px\s*;/);
  assert.match(cssRule('.h-image-cards'),/minmax\(min\(280px,100%\),1fr\)/);
  assert.match(cssRule('.h-image-card'),/min-width\s*:\s*min\(280px,100%\)/);
});

test('이미지 패널은 외곽 카드 높이만 늘리고 큐브 크기와 순환하지 않아요', () => {
  const stage=cssRule('#previewColumn > #stage:has(> #hFaceImagesPanel:not([hidden]))');
  assert.match(stage,/height\s*:\s*auto\s*;/);
  assert.match(stage,/min-height\s*:\s*max\(420px,\s*calc\(100vh - 80px\)\)\s*;/);
  assert.match(INDEX,/const previewHeight=\$\('hFaceImagesPanel'\)\.hidden\?stage\.clientHeight:Math\.max\(420,innerHeight-80\)-2;/);
  assert.match(INDEX,/hPreviewSquareSide\(\{width:stage\.clientWidth,height:previewHeight,/);
});
