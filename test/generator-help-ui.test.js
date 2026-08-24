/**
 * generator-help-ui.test.js — 생성기 UI 대개편 (운영자 지시 2026-08-16) 의 계약.
 *
 * 무엇을 지키나:
 *   A-1 섹션 개명 — 전 언어가 같이 바뀌었는가 (한 언어만 바뀌면 «번역 누락» 으로 보인다)
 *   A-2 «?» 도움말 — 버튼이 button 요소이고 aria-expanded 를 갖고, 가리키는 사전 키가
 *       여덟 언어 모두에 있는가. 팝오버는 **문서에 하나**인가 (복제되면 열림 상태가 갈린다)
 *   A-3 부제·아이콘 — 카드 안 부제가 사전을 거치는가
 *   A-5 섹션 마진 — 래퍼 div 가 위 여백을 지우던 `:first-child` 리셋이 사라졌는가
 *   A-6 입력 지우기 — i18n aria-label 을 가진 button 인가
 *   A-7 자체검증 3태 — 라벨 3종과 판정 상수가 소스에 있고, 뱃지가 «안정성 ⇄ 용량»
 *       섹션 바로 아래(#selfCheckRow)로 갔는가
 *
 * 순수 함수 `positionHelpPopover` 는 DOM 없이 뷰포트 가장자리 보정을 고정한다 —
 * 이게 없으면 «화면 끝에서 창이 잘린다» 를 손으로만 확인하게 된다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  HELP_POPOVER_EDGE, HELP_POPOVER_GAP, positionHelpPopover,
} from '../src/help-popover.js';
import { PRESETS, getPreset, relativeLuminance } from '../src/luminance.js';
import { decideQuietColor } from '../src/quiet-auto.js';
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

// ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): ko/en/ja → 8언어.
//   이 목록을 늘리는 것만으로 아래 순회 단언 전부가 새 언어까지 잰다 — 그게 목적이다
//   (한 언어만 갱신되는 «번역 누락» 을 여기서 잡는 것이 이 파일의 계약이다).
const LANGS = ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt'];

// ── A-2 위치 보정 (순수 함수) ─────────────────────────────────────────────

const VIEWPORT = { width: 400, height: 600 };
const SIZE = { width: 200, height: 100 };

test('도움말 창은 기본으로 앵커 아래 중앙에 선다', () => {
  const at = positionHelpPopover(
    { left: 180, top: 100, width: 16, height: 16, bottom: 116 }, SIZE, VIEWPORT,
  );
  assert.equal(at.placement, 'below');
  assert.equal(at.top, 116 + HELP_POPOVER_GAP);
  assert.equal(at.left, 180 + 8 - 100);
});

test('오른쪽 끝에서는 잘리지 않게 가장자리 여백까지 밀어 넣는다', () => {
  const at = positionHelpPopover(
    { left: 390, top: 100, width: 16, height: 16, bottom: 116 }, SIZE, VIEWPORT,
  );
  assert.equal(at.left, VIEWPORT.width - SIZE.width - HELP_POPOVER_EDGE);
});

test('왼쪽 끝에서도 가장자리 여백을 지킨다', () => {
  const at = positionHelpPopover(
    { left: 0, top: 100, width: 16, height: 16, bottom: 116 }, SIZE, VIEWPORT,
  );
  assert.equal(at.left, HELP_POPOVER_EDGE);
});

test('아래가 모자라면 앵커 위로 뒤집는다', () => {
  const at = positionHelpPopover(
    { left: 180, top: 540, width: 16, height: 16, bottom: 556 }, SIZE, VIEWPORT,
  );
  assert.equal(at.placement, 'above');
  assert.equal(at.top, 540 - HELP_POPOVER_GAP - SIZE.height);
});

test('위아래 어디도 안 되면 세로도 뷰포트 안으로 가둔다', () => {
  const tall = { width: 200, height: 560 };
  const at = positionHelpPopover(
    { left: 180, top: 300, width: 16, height: 16, bottom: 316 }, tall, VIEWPORT,
  );
  assert.equal(at.placement, 'clamped');
  assert.ok(at.top >= HELP_POPOVER_EDGE);
  assert.ok(at.top + tall.height <= VIEWPORT.height);
});

// 회귀 — 실브라우저에서 잡은 결함(2026-08-16): 앵커가 뷰포트 **아래로** 벗어난 채
// 위치를 다시 잡으면 `above` 가 큰 양수라 «위로 뒤집기» 분기를 통과하고, 창이 화면
// 아래로 삐져나갔다 (top 795 · 높이 206 · 뷰포트 812). 분기 조건이 «above 가 위쪽
// 여백보다 큰가» 였고 «아래로 안 넘치는가» 를 안 봤다.
test('앵커가 뷰포트 밖(아래)이어도 창은 화면 안에 남는다', () => {
  const at = positionHelpPopover(
    { left: 134, top: 1009, width: 16, height: 16, bottom: 1025 },
    { width: 320, height: 206 },
    { width: 375, height: 812 },
  );
  assert.equal(at.placement, 'clamped');
  assert.ok(at.top >= HELP_POPOVER_EDGE, `top ${at.top} 이 위로 벗어난다`);
  assert.ok(at.top + 206 <= 812, `top ${at.top} + 206 이 아래로 벗어난다`);
});

// ── A-1 섹션 개명 ─────────────────────────────────────────────────────────

test('개명한 섹션 이름이 ko/en/ja 세 언어에 같이 반영됐다', () => {
  const expected = {
    ko: {
      g044: '해상도 (모듈 밀도 = 용량)',
      g045: '안정성 ⇄ 용량',
      g059: '배경색',
      g060: 'TL 배치 미리보기 (TL 삽입할 곳 이미지 넣어서 미리 배치해보기)',
    },
    en: { g044: 'Resolution (module density = capacity)', g045: 'Robustness ⇄ capacity' },
    ja: { g044: '解像度（モジュール密度 = 容量）', g045: '安定性 ⇄ 容量', g059: '背景色' },
  };
  for (const [lang, table] of Object.entries(expected)) {
    const block = langBlock(lang);
    for (const [key, value] of Object.entries(table)) {
      assert.ok(block.includes(`"${key}": ${JSON.stringify(value)}`),
        `${lang}/${key} 가 «${value}» 가 아니다`);
    }
  }
  // 정적 DOM 의 기본 문구도 같이 바뀌어야 한다 — 사전만 바꾸면 첫 페인트가 옛 문구다.
  assert.match(INDEX, /data-i18n="g044">해상도 \(모듈 밀도 = 용량\)</);
  assert.match(INDEX, /data-i18n="g045">안정성 ⇄ 용량</);
  assert.match(INDEX, /data-i18n="g059">배경색</);
  assert.doesNotMatch(INDEX, /data-i18n="g045">안정성 · 용량</);
});

test('검출기 섹션은 O/A·Y 양쪽이 같은 «검출기 선택» 이름을 쓴다', () => {
  // 두 섹션은 타입에 따라 배타적으로 보인다 — 이름을 맞추면 사용자 쪽에서는 한 섹션이다.
  assert.match(INDEX, /data-i18n="g459">검출기 선택</);
  assert.match(INDEX, /data-i18n="g515">검출기 선택</);
  for (const lang of LANGS) {
    const block = langBlock(lang);
    const g459 = /"g459": "([^"]*)"/.exec(block);
    const g515 = /"g515": "([^"]*)"/.exec(block);
    assert.ok(g459 && g515, `${lang}: g459/g515 를 못 찾았다`);
    assert.equal(g459[1], g515[1], `${lang}: 두 검출기 섹션 이름이 다르다`);
  }
});

test('배치 미리보기 안내는 도달 가능한 동작만 주장한다', () => {
  // ⚠ **의도적 갱신** (2026-08-16, 과업 #18). 이 문장은 두 번 좁혔다가 이번에 **다시
  //   넓혔다** — 좁힌 이유가 사라졌기 때문이다.
  //     ① 운영자 초안 «안전영역 옵션을 자동 선택해 준다» — 그런 경로가 없었다.
  //     ② 대체본 «표면 밝기가 흰/검정 판단에 반영된다» — 그것도 아니었다. 타이브레이크가
  //        |sepW − sepB| ≤ 0.02 뒤에 있었는데 어떤 팔레트도 거기 못 갔다.
  //     ③ 과업 #18 이 그 입력을 1급으로 올렸다 (src/quiet-auto.js). 문턱은 그대로 두고
  //        **순서**를 바꿨다 — 이제 사진이 실제로 흰/검을 정한다.
  //   그래서 이 테스트가 지키는 계약은 «주장하지 마라» 에서 **«주장한 대로 동작하는지»**
  //   로 옮겨간다. 아래 doesNotMatch 목록은 그대로 둔다 — 일부는 지금 규칙에서 참인
  //   문장이 됐지만, 정본 문구는 g935 한 곳이어야 한다. 같은 사실을 다른 문장으로
  //   두 번 적으면 다음 규칙 변경 때 한쪽만 고쳐진다.
  assert.match(INDEX, /id="backdropQuietNote"[^>]*data-i18n="g935"/);
  assert.doesNotMatch(INDEX, /안전영역 옵션을 삽입할 곳 여건에 맞춰 자동 선택해 줍니다/);
  assert.match(langBlock('ko'), /"g935": "\* 넣은 표면 이미지는 코드 둘레의 표면 밝기를 재서/);
  const deadClaims = [
    /밝기는[^"]*흰\/검정[^"]*판단에 반영/,          // ko
    /brightness[^"]*feeds[^"]*colour choice/i,      // en
    /明るさ[^"]*白／黒[^"]*判断に反映/,             // ja
    /배치 미리보기의 표면 밝기로 흰색\/검정을 갈라요/,
    /surface brightness from the placement preview to break the tie/i,
    /配置プレビューの面の明るさで白／黒を決めます/,
  ];
  for (const lang of LANGS) {
    const block = langBlock(lang);
    for (const claim of deadClaims) {
      assert.doesNotMatch(block, claim, `${lang}: 옛 타이브레이크 설명이 되살아났다`);
    }
  }
  // 그리고 «죽은 분기» 라고 적어 둔 주석·인라인 규칙은 **없어야** 한다 — 규칙이
  // 모듈로 옮겨갔는데 그 설명이 남아 있으면 어느 쪽이 진짜인지 화면이 대답 못 한다.
  assert.doesNotMatch(INDEX, /현재 도달 불가한 죽은 분기/);
  assert.doesNotMatch(INDEX, /function highContrastQuietColor/);
  assert.match(INDEX, /resolveQuietZoneChoice/);
});

test('안전영역 — 문턱 타이브레이크는 프리셋 전부에서 죽지만, 새 규칙(순서 교체)에선 표면 밝기가 답을 가른다 (실측)', () => {
  // ⚠ **의도적 갱신** (2026-08-16, 과업 #18): 재는 것은 그대로, **결론이 바뀌었다**.
  //   종전 결론은 «그러니 문구에서 빼라» 였다. 지금 결론은 «그러니 문턱이 아니라
  //   순서를 바꿔라» 다 — 아래 수치가 바로 그 근거다. 문턱을 0 까지 내려도 표면은
  //   결정을 못 뒤집는다(셀 분리 차가 압도적이라). 수치 핀은 유지한다.
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  const sep = (levels, color) => {
    const y = relativeLuminance(color);
    return Math.min(...levels.map((lvl) => Math.abs(relativeLuminance(lvl) - y)));
  };
  const measured = {};
  for (const name of Object.keys(PRESETS)) {
    const { levels } = getPreset(name);
    measured[name] = Math.abs(sep(levels, white) - sep(levels, black));
    assert.ok(measured[name] > 0.02,
      `${name}: |sepW−sepB| ${measured[name].toFixed(4)} 가 0.02 이하 — 분기가 살아났다`);
  }
  // 실측값 고정 (2026-08-16). 팔레트를 손대면 여기서 먼저 걸린다.
  assert.equal(measured.slate.toFixed(4), '0.1689');
  assert.equal(measured.ember.toFixed(4), '0.2507');
  assert.equal(measured.mono.toFixed(4), '0.0257');
  // 커스텀 팔레트는 slate 의 **상대휘도를 그대로 타깃**해서 만든다 — 그래서 hue 를
  // 어디로 돌려도 slate 근처(0.1629~0.1764)에 머문다. 그 구조를 소스에서 확인한다.
  assert.match(INDEX, /const base = getPreset\('slate'\);/);
  assert.match(INDEX, /colorAtLuminance\(hue, CUSTOM_SATS\.levels\[i\], relativeLuminance\(lvl\)\)/);
  // 그리고 «순서를 바꾸면 살아난다» 는 여기서 한 번 실증한다 — 같은 수치 그대로,
  // 새 규칙에서는 표면 밝기가 실제로 답을 가른다. (규칙 전수 검증은 quiet-auto.test.js.)
  const slate = getPreset('slate').levels;
  const input = { sepWhite: sep(slate, white), sepBlack: sep(slate, black), separationFloor: 0.05 };
  assert.equal(decideQuietColor({ ...input, surfaceLuminance: 0.05 }).color, 'white');
  assert.equal(decideQuietColor({ ...input, surfaceLuminance: 0.95 }).color, 'black');
});

// ── A-2 «?» 도움말 배선 ───────────────────────────────────────────────────

test('«?» 버튼은 button 요소 + aria-expanded 이고 사전 키가 여덟 언어에 있다', () => {
  const dots = [...INDEX.matchAll(/<button type="button" class="help-dot" data-help="(g\d{3})"([^>]*)>/g)];
  assert.ok(dots.length >= 7, `«?» 버튼이 너무 적다 (${dots.length}) — 섹션 이관이 덜 됐다`);
  for (const [, key, rest] of dots) {
    assert.match(rest, /aria-expanded="false"/, `${key}: aria-expanded 기본값이 없다`);
    assert.match(rest, /data-i18n-attr="aria-label:g931"/, `${key}: aria-label 이 사전을 안 거친다`);
    for (const lang of LANGS) {
      assert.match(langBlock(lang), new RegExp(`"${key}":`), `${lang} 에 ${key} 도움말이 없다`);
    }
  }
  // 키는 **전부 유일**해야 한다. 예전 주석은 «검출기 O/A·Y 는 키를 공유해도 된다» 고
  // 썼지만 그 허용은 이미 철회됐다 — 아래 «정식 화면 도움말» 테스트가 lab 키와 정식
  // 키의 공유를 실패로 잰다(g906 이 O/A 로 새던 결함). 두 주장이 남아 있으면 느슨한
  // 쪽(`size >= len - 1`)이 «한 쌍은 겹쳐도 된다» 는 구멍을 계속 열어 둔다.
  const keys = dots.map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length,
    `도움말 키가 겹친다: ${keys.filter((k, i) => keys.indexOf(k) !== i).join(', ')}`);
});

test('도움말 창은 문서에 하나뿐이고 닫기 버튼과 role 을 갖는다', () => {
  assert.equal(INDEX.match(/id="helpPopover"/g)?.length, 1);
  assert.match(INDEX, /<div id="helpPopover" class="help-popover" role="tooltip" hidden>/);
  assert.match(INDEX, /id="helpPopoverClose"[\s\S]{0,140}data-i18n-attr="aria-label:g932"/);
  assert.match(INDEX, /createHelpPopover\(\{/);
  assert.match(INDEX, /linesFor: \(button\) => t\(button\.dataset\.help\)\.split\('\\n'\)/);
  // 언어 전환 시 열려 있는 본문도 다시 그려야 한다.
  assert.match(INDEX, /syncHelpPopover/);
});

test('카드마다 있던 native title= 설명은 «?» 로 옮겨졌다', () => {
  for (const row of ['resTierCards', 'eccTierCards', 'bgModeCards', 'quietModeCards']) {
    const start = INDEX.indexOf(`id="${row}"`);
    assert.ok(start >= 0, `${row} 를 못 찾았다`);
    const block = INDEX.slice(start, INDEX.indexOf('</div>\n      <p', start) + 1);
    assert.doesNotMatch(block, /data-i18n-attr="title:/,
      `${row}: 카드 title= 설명이 남아 있다 — 모바일에서는 안 보이는 설명이다`);
  }
});

// ── A-3 부제·아이콘 ───────────────────────────────────────────────────────

test('해상도·안정성 카드는 사전을 거친 부제와 인라인 SVG 를 갖는다', () => {
  const subs = ['g920', 'g921', 'g922', 'g923', 'g924', 'g925', 'g926', 'g927'];
  for (const key of subs) {
    assert.match(INDEX, new RegExp(`class="card-sub" data-i18n="${key}"`), `부제 ${key} 누락`);
    for (const lang of LANGS) {
      assert.match(langBlock(lang), new RegExp(`"${key}":`), `${lang} 에 ${key} 없음`);
    }
  }
  // 아이콘은 인라인 SVG + currentColor (외부 자산·PNG 금지).
  const resStart = INDEX.indexOf('id="resTierCards"');
  const resBlock = INDEX.slice(resStart, INDEX.indexOf('id="resTierHint"', resStart));
  assert.equal((resBlock.match(/<svg /g) || []).length, 4, '해상도 카드 4개 모두 아이콘이어야 한다');
  assert.doesNotMatch(resBlock, /<img |\.png/);
  assert.match(resBlock, /stroke="currentColor"/);
});

// 카드 «순서» 는 y-cell-editor-refformat.test.js 의 LOCATOR_CARD_ORDER deepEqual 이
// 잰다 — 여기는 존재·아이콘·부제만 본다 (이름이 단언보다 커지지 않게, 통합 렌즈 B).
test('검출기 카드는 파인더 기하 아이콘 + 부제를 갖고 자동 항목이 존재한다', () => {
  const start = INDEX.indexOf('id="yLocatorCards"');
  const block = INDEX.slice(start, INDEX.indexOf('id="yLocatorHint"', start));
  assert.match(block, /data-locator="auto"/);
  // 카드 수와 아이콘 수를 **따로 세지 않고 서로 맞춘다** — 상수를 박아 두면 카드가
  // 늘 때 «6 을 7 로 고쳤다» 로 끝나고, 새 카드가 아이콘 없이 들어와도 초록이 된다.
  // (실제로 v0XQ 카드가 아이콘·부제 없이 들어와 있었다 — 2026-08-17 3-way 통합.)
  // 의도적 갱신 «드랍 정본화» (2026-08-16): v1r2·v2r2 카드를 내려 7 → 5 다.
  // 부제 키 g945(v1r2)·g946(v2r2)는 **사전에 그대로 남는다** — 되살릴 때
  // 재번역하지 않기 위해서고, locatorY-lab.test.js 가 그 보존을 고정한다.
  // 의도적 갱신 «v0W 편입» (2026-08-16): v0W 카드가 들어와 5 → 6 이다 (부제 g948).
  // **의도적 갱신 «v0W 파생 2종 편입» (2026-08-16)**: v0WQ 카드가 들어와 6 → 7 이다
  // (부제 g949). v0WY 는 여기서 세지 않는다 — QR 위치 카드라 이 블록 밖이다.
  // **의도적 갱신 «v0XQ 드랍» (운영자 실기기 확정 2026-08-17)**: v0XQ 카드를 내려
  // 7 → 6 이다. 부제 키 g947(v0XQ)은 **사전에 그대로 남는다** — v1r2·v2r2 와 같은
  // 규약이고, locatorY-lab.test.js 가 그 보존을 고정한다.
  // **의도적 갱신 «v0W2 편입» (운영자 신설 설계 2026-08-17)**: v0W2 카드가 들어와
  // 6 → 7 이다 (부제 g954). 아이콘은 v0W 문법 + 우하 대형 겹사각이다.
  // **의도적 갱신 «v0X 드랍» (운영자 실기기 확정 2026-08-17, 판정 3라운드)**: v0X
  // 카드를 내려 7 → 6 이다 («파인더 인식 다 해놓고도 잘 못 읽음 + v0 과 혼선 자주»).
  // 부제 키 g944(v0X)는 **사전에 그대로 남는다** — v1r2·v2r2·v0XQ 와 같은 규약이고,
  // locatorY-lab.test.js 가 그 보존을 여덟 언어로 고정한다. 남은 여섯은
  // 자동·끔 + v0 + **v0W 계열 셋**이다.
  // **의도적 갱신 «v0WY 편입» (운영자 재설계 2026-08-17)**: v0WY 카드가 들어와
  // 6 → 7 이다 (부제 g967). 바로 위 「v0WY 는 여기서 세지 않는다 — QR 위치 카드라
  // 이 블록 밖이다」 는 **허공 마름모 설계**의 서술이었고, QR 이 실루엣 안쪽 먼
  // 코너로 들어오면서 v0WY 가 진짜 레이아웃이 돼 뒤집혔다. QR 위치 카드 «면» 은
  // 그대로 있고, 이제 그 카드가 **이 검출기 카드로 전환**시킨다 (아래 §«면» 회귀).
  // **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (운영자 확정 2026-08-17)**:
  // v0W 계열 카드 넷(g948·g949·g954·g967)이 내려가고 v0T(g995) · v0TY(g998) 카드가
  // 서서 7 → 5 다. 내린 부제 키들은 사전에 그대로 남는다 (v1r2·v2r2·v0X·v0XQ 전례 —
  // locatorY-lab.test.js 가 보존을 고정한다).
  // **의도적 갱신 «v0TR 계열 편입» (2026-08-17)**: v0TR(g957) · v0TRQ(g969)
  // 카드 둘이 서서 5 → **7** 이다. 내려간 카드는 없다 — v0T·v0TY 는 그대로고
  // 드랩 판정은 실기기 재스캔 뒤 운영자 몴이다. 부제 키는 사전의 빈 슬롯을
  // 썼다 (g957·g969) — 4자리 키를 만들면 i18n-coverage 파서가 그 키를 못 본다.
  // **의도적 갱신 «v0TRY 편입» (2026-08-18)**: v0TRY(g937) 카드가 서서 7 → **8** 이다.
  // 내려간 카드는 없다 — v0TR 계열 전체가 그대로고 드랍 판정은 실기기 재스캔 뒤
  // 운영자 몫이다. 부제 키는 사전의 빈 슬롯 g937 을 썼다 (같은 3자리 규약).
  // **의도적 갱신 (W2 C3, 2026-08-24)**: v0TY(g998) · v0TRY(g937) 카드가 내려
  // 8 → **6** 이다. 드랍이 아니라 **파생값 강등**이다 — «QR 안쪽 + 코너측»
  // (#qrFacePlacementSection)이 그 값을 파생한다 (§deriveYLocatorForQrPosition).
  // 부제 키(g998·g937)는 사전에 그대로 남는다 (드랍 카드 전례 — locatorY-lab 고정).
  const cardCount = (block.match(/class="toggle-card[^"]*" data-locator=/g) || []).length;
  assert.equal(cardCount, 6,
    '검출기 카드는 자동·끔 + v0 + v0T + v0TR·v0TRQ = 6 이다 (v0TY·v0TRY 는 파생 강등)');
  assert.equal((block.match(/<svg /g) || []).length, cardCount,
    '검출기 카드 전부가 파인더 기하 아이콘을 가져야 한다');
  const subKeys = ['g941', 'g942', 'g943', 'g995', 'g957', 'g969'];
  assert.equal(subKeys.length, cardCount, '부제 키 수가 카드 수와 다르다');
  for (const key of subKeys) {
    assert.match(block, new RegExp(`class="card-sub" data-i18n="${key}"`), `검출기 부제 ${key} 누락`);
    for (const lang of LANGS) {
      assert.match(langBlock(lang), new RegExp(`"${key}":`), `${lang} 에 검출기 부제 ${key} 없음`);
    }
  }
  // 자동의 «현재 의미» 는 코드에 한 자리로 있어야 한다 — 화면 문구와 어긋나면 거짓말이 된다.
  // 승격 (2026-08-24 운영자): 자동 = 안쪽 QR → base v0TR (placement 파생이 v0TRQ) ·
  // Y0 명시 → v0 · 그 외 → v0TR. «끔 동일값» 시절 락은 이 양성 단언으로 전환.
  assert.match(INDEX,
    /function resolveAutoLocatorProfileY\(pos = generatorState\.qrPosition\)\s*\{\s*\n\s*if \(pos === 'inner'\) return LOCATOR_PROFILE_CELL_SURFACE_V0TR;\s*\n\s*if \(generatorState\.versionY === 0\) return LOCATOR_PROFILE_CELL_SURFACE_V0;\s*\n\s*return LOCATOR_PROFILE_CELL_SURFACE_V0TR;/);
  assert.match(INDEX, /let detectorAutoY = true;/,
    '자동이 기본값이 아니다 — 2026-08-24 운영자 확정의 회귀');
  for (const lang of LANGS) {
    assert.match(langBlock(lang), /"g906":/, `${lang} 에 검출기 도움말 g906 이 없다`);
  }
});

// ── 내부 명칭이 정식 화면으로 새지 않는가 ────────────────────────────────
//
// ⚠ 여기 있던 옛 테스트는 이름이 «lab 전용 섹션 안에만 있다» 였는데, 실제로는 lab
//   블록이 그 명칭을 **포함**하는지만 봤다. 부재(absence)를 한 번도 안 재서, O/A 파인더
//   섹션이 lab 전용 도움말 키(g906)를 공유하는 동안에도 초록이었다 — 테스트 이름이
//   테스트보다 큰 주장을 하고 있었다 (2026-08-16 적대 검증 ③).
//   지금은 «lab 안에 있다» 와 «lab 밖에는 없다» 를 **둘 다** 잰다.

/**
 * 정식 화면에 절대 나오면 안 되는 내부 표기 = **레이아웃 후보 id 와 정본 소스 이름**.
 * (Y0·Y1·Y2 는 제외 — 그건 공개 버전 라벨이다. 정식 해상도 목록이 «Y1 (n=21 · 98 B)»
 *  로 쓰고 g905 도 «Y2 윈도 β» 를 말한다.)
 */
const INTERNAL_TOKENS = [
  'v0X', 'v0x', 'v1r2', 'v2r2',
  'cellSurfaceFinal', 'cell-surface-', 'hex-frame', 'locatorProfileY',
];

/** lab 전용으로 게이트된 정적 컨테이너 (id → 닫는 지점을 찾을 앵커). */
const LAB_ONLY_SECTIONS = ['yLocatorSection', 'yCellEditorSection'];

/** id 로 시작하는 요소의 바깥 HTML 을 태그 깊이로 잘라 낸다. */
function outerHtmlById(html, id) {
  const at = html.indexOf(`id="${id}"`);
  assert.ok(at >= 0, `${id} 를 못 찾았다`);
  const start = html.lastIndexOf('<', at);
  let depth = 0;
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g;
  tagRe.lastIndex = start;
  let m;
  while ((m = tagRe.exec(html))) {
    const [, closing, tag, selfClose] = m;
    if (selfClose || ['br', 'img', 'input', 'hr', 'meta', 'link'].includes(tag)) continue;
    depth += closing ? -1 : 1;
    if (depth === 0) return html.slice(start, tagRe.lastIndex);
  }
  throw new Error(`${id} 가 닫히지 않는다`);
}

test('lab 전용 섹션은 isLabPath 게이트를 실제로 갖는다', () => {
  // 게이트를 **세지 않고 섹션에 묶는다**. 예전 판은 `const show = isLabPath() &&
  // generatorState.type === 'Y';` 라는 한 줄의 **개수**만 셌는데, 그 줄에는 두 가지가
  // 섞여 있다 — ⓐ lab 게이트(isLabPath)와 ⓑ 어떤 타입에서 열리는가. 셀 편집기가
  // Y/O/A 로 넓어지며 ⓑ 가 `CELL_EDITOR_TYPES.includes(...)` 로 바뀌자 개수가 2→1 이
  // 됐고, ⓐ 는 멀쩡한데 테스트가 깨졌다 (2026-08-17 3-way 통합에서 실제로 났다).
  // 지금은 «각 섹션이 자기 isLabPath 게이트로 hidden 을 정하는가» 만 잰다 — 타입 조건은
  // 각 섹션의 소관이라 여기서 안 박는다.
  for (const id of LAB_ONLY_SECTIONS) {
    const at = INDEX.indexOf(`els.${id};`);
    assert.ok(at > 0, `${id}: sync 함수에서 섹션을 집는 자리를 못 찾았다`);
    const body = INDEX.slice(at, at + 400);
    assert.match(body, /const show = isLabPath\(\) &&/,
      `${id}: 표시 조건이 isLabPath 로 시작하지 않는다`);
    assert.match(body, /section\.hidden = !show;/,
      `${id}: 그 조건으로 hidden 을 정하지 않는다`);
  }
  const block = outerHtmlById(INDEX, 'yLocatorSection');
  assert.match(block, /셀 표면 v0 \(Y0\)/, 'lab 섹션에는 내부 명칭 병기가 남아 있어야 한다');
});

test('정식 화면의 정적 DOM 에는 내부 후보명이 없다', () => {
  // lab 전용 컨테이너를 통째로 도려낸 나머지 = 정식 화면에서 볼 수 있는 마크업.
  // (사전 블록과 <script> 는 별도 테스트가 본다 — 여기서는 눈에 보이는 마크업만.)
  let markup = INDEX.slice(0, INDEX.indexOf('const GENERATOR_STRINGS = {'));
  for (const id of LAB_ONLY_SECTIONS) {
    markup = markup.split(outerHtmlById(INDEX, id)).join('');
  }
  // 주석은 개발자용이라 제외한다 (화면에 안 나간다).
  markup = markup.replace(/<!--[\s\S]*?-->/g, '');
  for (const token of INTERNAL_TOKENS) {
    assert.ok(!markup.includes(token),
      `정식 화면 마크업에 내부 명칭 «${token}» 이 있다`);
  }
});

test('정식 화면에서 열 수 있는 도움말 본문에는 내부 후보명이 없다', () => {
  // 이게 실제로 샜던 자리다 — #finderSection(O/A, isLabPath 게이트 **없음**)이
  // lab 전용 Y 로케이터 본문(g906)을 가리키고 있었다.
  const labBlock = outerHtmlById(INDEX, 'yLocatorSection');
  const labKeys = new Set([...labBlock.matchAll(/data-help="(g\d{3})"/g)].map((m) => m[1]));
  const allKeys = [...INDEX.matchAll(/data-help="(g\d{3})"/g)].map((m) => m[1]);
  const publicKeys = [...new Set(allKeys.filter((k) => !labKeys.has(k)))];
  assert.ok(publicKeys.length >= 6, `정식 도움말 키가 너무 적다 (${publicKeys.length})`);

  // 같은 키를 lab 과 정식이 **공유하면** 이 분리 자체가 무의미해진다.
  for (const key of labKeys) {
    assert.ok(!publicKeys.includes(key), `${key} 를 lab 과 정식 화면이 공유한다`);
  }
  assert.ok(labKeys.has('g906'), 'g906 은 lab 전용 Y 로케이터 본문이어야 한다');
  assert.ok(publicKeys.includes('g907'), 'g907 은 정식 O/A 파인더 본문이어야 한다');

  for (const lang of LANGS) {
    const dict = langBlock(lang);
    for (const key of publicKeys) {
      const body = new RegExp(`"${key}": "((?:[^"\\\\]|\\\\.)*)"`).exec(dict);
      assert.ok(body, `${lang}: ${key} 본문을 못 찾았다`);
      for (const token of INTERNAL_TOKENS) {
        assert.ok(!body[1].includes(token),
          `${lang}/${key}: 정식 화면 도움말에 내부 명칭 «${token}» 이 있다`);
      }
      // 정본 소스 파일명도 사용자에게 보일 이유가 없다.
      assert.ok(!/\.js\b/.test(body[1]), `${lang}/${key}: 도움말에 소스 파일명이 있다`);
    }
  }
});

test('O/A 파인더 도움말은 그 섹션에 실재하는 것만 설명한다', () => {
  // g906 을 공유하던 시절에는 O/A 섹션에 없는 «자동» 카드 설명이 정식 화면에 떴다.
  const finder = outerHtmlById(INDEX, 'finderSection');
  const finderKeys = [...finder.matchAll(/data-help="(g\d{3})"/g)].map((m) => m[1]);
  assert.deepEqual(finderKeys, ['g907'], '#finderSection 의 도움말 키가 g907 하나가 아니다');
  assert.ok(!finder.includes('data-locator="auto"'), 'O/A 섹션에는 «자동» 카드가 없다');
  for (const lang of LANGS) {
    const body = new RegExp('"g907": "((?:[^"\\\\]|\\\\.)*)"').exec(langBlock(lang));
    assert.ok(body, `${lang} 에 g907 이 없다`);
    // ⚠ 의도적 갱신 (2026-08-17, i18n 5언어 확장): 새 5언어는 «자동» 을 전부 Auto 로
    //   옮겼으므로 `Auto =` 한 패턴이 fr·it·de·es·pt 를 함께 덮는다.
    assert.ok(!/자동 =|Auto =|自動 =/.test(body[1]),
      `${lang}/g907: 없는 «자동» 카드를 설명한다`);
  }
  // 반대로 «자동» 설명은 그 카드가 실재하는 Y 쪽(g906)에 남아 있어야 한다.
  assert.match(langBlock('ko'), /"g906": "[^"]*자동 = /);
});

// ── A-5 섹션 마진 ─────────────────────────────────────────────────────────

test('섹션 마진은 단일 규칙이고 래퍼 div 가 위 여백을 지우지 않는다', () => {
  assert.match(INDEX, /\.section-heading-row \{ display: flex; align-items: center; gap: 6px; margin: 18px 0 6px; \}/);
  // 옛 규칙: 래퍼 안 첫 헤딩이면 무조건 margin-top:0 → 18px 과 0px 이 섞였다.
  assert.doesNotMatch(INDEX, /\.section-heading:first-child, \.section-title:first-child \{ margin-top: 0; \}/);
  // 예외는 패널 최상단 하나뿐.
  assert.match(INDEX, /\.panel > \*:first-child > \.section-heading:first-child,/);
  // label 리셋이 섹션 헤딩을 다시 0 으로 되돌리지 않아야 한다 (specificity 함정).
  assert.match(INDEX, /label:not\(\.section-heading\):first-child \{ margin-top: 0; \}/);
});

// ── A-6 콘텐츠 지우기 ─────────────────────────────────────────────────────

test('콘텐츠 입력 지우기 버튼은 내용이 있을 때만 보이고 aria-label 이 사전을 거친다', () => {
  for (const id of ['nUrlClear', 'nTextClear']) {
    assert.match(INDEX, new RegExp(`<button type="button" class="input-clear" id="${id}" hidden`));
    assert.match(INDEX, new RegExp(`id="${id}"[\\s\\S]{0,120}data-i18n-attr="aria-label:g930"`));
  }
  assert.match(INDEX, /function refreshInputClearButtons\(\)/);
  assert.match(INDEX, /button\.hidden = input\.value\.length === 0;/);
  for (const lang of LANGS) {
    assert.match(langBlock(lang), /"g930":/, `${lang} 에 g930 이 없다`);
  }
});

// ── A-7 자체검증 3태 ──────────────────────────────────────────────────────

test('자체검증 뱃지는 3태이고 판정이 게이트 여유에서 유도된다', () => {
  for (const key of ['g950', 'g951', 'g952', 'g953']) {
    for (const lang of LANGS) {
      assert.match(langBlock(lang), new RegExp(`"${key}":`), `${lang} 에 ${key} 가 없다`);
    }
  }
  assert.equal(langBlock('ko').includes('"g950": "사용가능"'), true);
  assert.equal(langBlock('ko').includes('"g951": "인식곤란"'), true);
  assert.equal(langBlock('ko').includes('"g952": "사용불가"'), true);
  // 임의 라벨 금지 — 판정은 순수 함수(src/render-status.js)에 있고 세 갈래가 전부
  // 기존 자체검증 신호에서 나온다. 규칙 자체의 단위 검증은 self-check-verdict.test.js.
  assert.match(INDEX, /selfCheckVerdict \} from '\.\/src\/render-status\.js'/);
  assert.match(INDEX, /deltaMinContract: DELTA_MIN_CONTRACT,/);
  assert.match(INDEX, /idealLogMargin: idealLogMarginY\(\),/);
  assert.match(INDEX, /usable: \{ key: 'g950', cls: 'ok' \}/);
  assert.match(INDEX, /marginal: \{ key: 'g951', cls: 'warn' \}/);
  assert.match(INDEX, /unusable: \{ key: 'g952', cls: 'bad' \}/);
  // 뱃지 3태 색이 CSS 에 실제로 있어야 한다 — warn 이 없으면 «인식곤란» 이 기본색으로 뜬다.
  assert.match(INDEX, /\.badge\.warn \{ color: var\(--warn\)/);
  // 뱃지 문구 자체도 {state} 를 받는 형식으로 바뀌었다 (체크 표시 우측).
  assert.match(langBlock('ko'), /"g445": "자체검증 ✓ - \{state\} ·/);
  assert.match(langBlock('ko'), /"g447": "자체검증 ✓ - \{state\} ·/);
  // 문턱 %도 사전에 박지 않고 판정에서 받아 온다 — 띠 폭을 옮기면 문구가 따라와야 한다.
  for (const lang of LANGS) {
    assert.match(langBlock(lang), /"g953": "[^"]*\{tight\}%/, `${lang}: g953 이 문턱을 박아 뒀다`);
    assert.doesNotMatch(langBlock(lang), /"g953": "[^"]*20%[^"]*20%/, `${lang}: g953 에 20 이 박혀 있다`);
  }
  assert.match(INDEX, /pct: verdict\.headroomPercent, tight: verdict\.tightPercent,/);
  assert.match(INDEX, /selfCheckTightPercent|verdict\.tightPercent/);
});

test('자체검증 뱃지는 «안정성 ⇄ 용량» 바로 아래에 있고 모드 전환 때 따라간다', () => {
  const ecc = INDEX.indexOf('id="eccTierCards"');
  const hint = INDEX.indexOf('id="eccTierHint"', ecc);
  const row = INDEX.indexOf('id="selfCheckRow"');
  assert.ok(ecc >= 0 && hint > ecc && row > hint, '뱃지가 ECC 힌트 뒤에 있어야 한다');
  // #info 에 남아 있으면 «두 곳에 표시» 가 된다.
  assert.doesNotMatch(INDEX, /`<span class="badge ok">\$\{tf\('g44[57]'/);
  assert.equal(INDEX.match(/id="selfCheckRow"/g)?.length, 1);
  assert.match(INDEX, /selfCheckHost\.appendChild\(els\.selfCheckRow\)/);
  assert.match(INDEX, /els\.selfCheckRow\.innerHTML = result\.selfCheck \|\| '';/);
});

// ── 번들 ──────────────────────────────────────────────────────────────────

test('번들에도 도움말 모듈과 3태 뱃지가 임베드된다', () => {
  const bundle = buildSingleHtml();
  assert.match(bundle, /positionHelpPopover/);
  assert.match(bundle, /id="helpPopover"/);
  assert.match(bundle, /id="selfCheckRow"/);
  assert.match(bundle, /SELFCHECK_TIGHT_RATIO/);
  assert.match(bundle, /selfCheckVerdict/);
  assert.match(bundle, /"help-popover"/);
});

// ── 검증 렌즈 봉합 (2026-08-16 render-batch retire) ───────────────────────

test('배치 사진이 빠지면 안전영역 힌트도 같은 프레임에 되돌린다 (낡은 근거 금지)', () => {
  // 검증 렌즈 실측 결함: 사진 제거·배경 전환 뒤에도 힌트가 «이미 지운 사진의 휘도»
  // 를 근거로 검정을 주장했다 — 실제 산출물은 흰색인데. 스위트는 순수 함수만 재므로
  // 이 배선은 소스 앵커로 고정한다. 가지 슬라이스를 잘라 검사한다 — 느슨한 정규식은
  // 가지 밖의 호출에 걸려 거짓 통과가 된다.
  const fn = INDEX.slice(
    INDEX.indexOf('function syncBackdropLayer()'),
    INDEX.indexOf('els.backdropPick.addEventListener'),
  );
  assert.ok(fn.length > 0, 'syncBackdropLayer 를 못 찾았다');
  const early = fn.slice(fn.indexOf("!backdrop.bitmap) {"), fn.indexOf('drawBackdrop();'));
  assert.ok(early.includes('lastBackdropLuminance = null;'), '이른 반환 가지가 휘도를 안 지운다');
  assert.ok(early.includes('syncQuietModeUi();'), '이른 반환 가지가 힌트를 재동기화하지 않는다');
  const noMeasure = fn.slice(fn.indexOf('if (!m) {'), fn.indexOf('lastBackdropLuminance = m.meanY;'));
  assert.ok(noMeasure.includes('lastBackdropLuminance = null;'), '측정 실패 가지가 휘도를 안 지운다');
  assert.ok(noMeasure.includes('syncQuietModeUi();'), '측정 실패 가지가 힌트를 재동기화하지 않는다');
});

test('사전 값에 마크다운 강조(**)가 없다 — 팝오버는 textContent 렌더다', () => {
  for (const lang of LANGS) {
    assert.ok(!langBlock(lang).includes('**'),
      `${lang}: 사전 값에 ** 가 남았다 (별표가 화면에 그대로 보인다)`);
  }
});

test('출력물용(3면 동률)에서는 면 게인 슬라이더를 잠근다 — 살아 있는 무동작 컨트롤 금지', () => {
  assert.match(INDEX, /els\.faceGain\.disabled = flat;/);
  assert.match(INDEX, /els\.faceGainRow\.classList\.toggle\('dim', flat\)/);
  assert.match(INDEX, /#faceGainRow\.dim \{ opacity: 0\.45; \}/);
});

test('#22 — v0 계열 해상도는 로케이터와 연동된다 (v0 ↔ v0T · g964)', () => {
  // 운영자 지시 (2026-08-16): v0 에서 «중» 을 고르면 계열 기본, «저» 로 복귀.
  // **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (2026-08-17)** — «중» 은 이제
  // **v0T 하나**다. 중앙 QR 파생(v0WQ)이 드랍되고 v0TQ 는 편입 불가 실측이라
  // (autoplace·슬롯 확증 게이트 거부 — `claude-v0tqty-probe.mjs`) «QR 안쪽이면»
  // 분기가 사라졌다. 스위트는 클릭을 못 누르므로 배선을 소스 앵커로 고정한다.
  assert.match(INDEX, /locator === LOCATOR_PROFILE_CELL_SURFACE_V0 && res === 'mid'/);
  assert.match(INDEX, /generatorState\.locatorProfileY = LOCATOR_PROFILE_CELL_SURFACE_V0T;/);
  assert.match(INDEX, /locator === LOCATOR_PROFILE_CELL_SURFACE_V0T && res === 'low'/);
  // 잠금이 아니라 연동이다 — v0 는 «고» 만 잠긴다 (중 열림).
  assert.match(INDEX, /cellSurfaceV0 \? res === 'high'/);
  for (const lang of LANGS) {
    assert.match(langBlock(lang), /"g964": "/, lang + ': 연동 문구 g964 누락');
  }
});

test('«QR 면 배치» 파생 — plane 카드 폐기 + 한 방향 파생 (W2 C3)', () => {
  // ⚠ **의도적 갱신 (W2 C3, 2026-08-24).** 이 회귀는 «면» 카드 ↔ v0TY/v0TRY 의
  // **양방향 전환 2쌍**을 쟀다 — 그 쌍이 곧 왕복 위험이라 개편이 통째로 걷어냈다.
  // 이제 사용자 축은 (qrPosition 안쪽 여부) × (qrFacePlacement seam/far) 이고,
  // 슬롯 레이아웃은 deriveYLocatorForQrPosition **한 방향 파생**이 만든다.
  // ① plane 카드·분기는 부재다 (구 카드 값이 살아 돌아오면 안 된다).
  assert.doesNotMatch(INDEX, /data-pos="plane"/);
  assert.doesNotMatch(INDEX, /card\.dataset\.pos === 'plane'/);
  // ①-b 역방향 강제(로케이터 → QR 위치)도 부재다 — 파생은 한 방향뿐이다.
  assert.doesNotMatch(INDEX, /generatorState\.qrPosition = 'plane'/);
  // ② 파생 함수가 있고, 서브섹션 카드·상태 축이 배선돼 있다.
  assert.match(INDEX, /function deriveYLocatorForQrPosition\(pos\)/);
  assert.match(INDEX, /id="qrFacePlacementSection"/);
  assert.match(INDEX, /data-placement="seam"/);
  assert.match(INDEX, /data-placement="far"/);
  assert.match(INDEX, /generatorState\.qrFacePlacement = card\.dataset\.placement === 'far' \? 'far' : 'seam';/);
  // ②-a 신규 i18n 키 6종은 8언어 사전 전부에 있어야 한다 (카운트 단언 —
  //     exclusion-matrix 의 split 전례. W2 키 블록 ② = g860-g869).
  for (const key of ['g860', 'g861', 'g862', 'g863', 'g864', 'g865']) {
    assert.equal(INDEX.split(`"${key}":`).length - 1, 8,
      key + ' 는 8언어 사전 전부에 있어야 한다');
  }
  // ②-b 파생 내용: 중앙측(seam) → v0TRQ 승격 · 코너측(far) → v0TY/v0TRY ·
  //      안쪽 이탈 → base 복귀 (v0TY→v0T · v0TRQ/v0TRY→v0TR).
  assert.match(INDEX, /\? \(v0tFamily \? LOCATOR_PROFILE_CELL_SURFACE_V0TY : LOCATOR_PROFILE_CELL_SURFACE_V0TRY\)\s*: LOCATOR_PROFILE_CELL_SURFACE_V0TRQ;/);
  assert.match(INDEX, /profile === LOCATOR_PROFILE_CELL_SURFACE_V0TY\) \{\s*next = LOCATOR_PROFILE_CELL_SURFACE_V0T;/);
  assert.match(INDEX, /\|\| profile === LOCATOR_PROFILE_CELL_SURFACE_V0TRY\) \{\s*next = LOCATOR_PROFILE_CELL_SURFACE_V0TR;/);
  // **의도적 갱신 «v0X 드랍» (2026-08-17, 판정 3라운드)** — 여기 있던
  // `v0xq → v0x` 분기 단언을 **부재 단언으로 뒤집는다.**
  //
  // 그 분기는 죽은 코드가 아니라 **살아 있는 결함이었다**: v0XQ 드랍(2라운드)이
  // import 목록에서 `LOCATOR_PROFILE_CELL_SURFACE_V0XQ` 를 뺐는데 비교식은 남아,
  // 상태가 v0WQ 가 **아닌** 모든 경우(off·v0·v0W·v0X…)에 둘째 비교식을 평가하며
  // `ReferenceError: … is not defined` 로 «면» 카드 클릭 전체를 죽였다.
  // 재현: `test/output/lanes/claude-v0wy-refbug.mjs` (·.out.txt).
  // 두 끝점이 모두 드랍된 지금은 분기가 무의미하므로 통째로 걷어냈다.
  //
  // 아래 단언이 지키는 것은 «index.html 의 모듈 스코프에 바인딩 없는 자유
  // 식별자를 두지 않는다» 이다 — 이 파일에서 그것을 잴 수 있는 유일한 자리다.
  // ⚠ **주석은 빼고 잰다.** 두 이름은 «왜 없앴는가» 를 적은 주석에 계속 등장하고
  //   주석은 평가되지 않는다. 주석까지 세면 이 자는 «문서를 못 쓰게 하는 자» 가 된다.
  const code = INDEX
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  assert.doesNotMatch(code, /LOCATOR_PROFILE_CELL_SURFACE_V0XQ/,
    'index.html 코드에 바인딩 없는 V0XQ 식별자가 다시 생겼다 — 클릭 시 ReferenceError 다');
  assert.doesNotMatch(code, /LOCATOR_PROFILE_CELL_SURFACE_V0X(?![A-Z0-9_])/,
    'index.html 코드에 바인딩 없는 V0X 식별자가 남았다 (드랍으로 import 에서 빠졌다)');
  // **의도적 갱신 «v0W 계열 전체 드랍» (2026-08-17)** — 넷 다 import 에서 빠졌으므로
  // 코드 어디에도 남으면 같은 ReferenceError 급 결함이다 (V0XQ 사고의 재발 방지).
  for (const name of ['V0W', 'V0WQ', 'V0W2', 'V0WY']) {
    assert.doesNotMatch(code,
      new RegExp('LOCATOR_PROFILE_CELL_SURFACE_' + name + '(?![A-Z0-9_])'),
      'index.html 코드에 바인딩 없는 ' + name + ' 식별자가 남았다 (드랍으로 import 에서 빠졌다)');
  }
  // 자 검증 — 이 자가 실제로 무언가를 볼 수 있는가. 살아 있는 형제 이름은 잡혀야 한다.
  assert.match(code, /LOCATOR_PROFILE_CELL_SURFACE_V0TY/,
    '주석 제거가 코드까지 지웠다 — 이 자는 «항상 통과» 다');

  // ② **부재 단언 — `outerFaceQr` 는 폐기됐다.** 구 v0WY(허공 마름모)의 렌더
  //    스위치였고, 지금은 sceneY 가 그 옵션을 받으면 **던진다**. index.html 코드에
  //    남아 있으면 «면» 을 고를 때마다 렌더가 죽는다.
  assert.doesNotMatch(code, /sceneOpts\.outerFaceQr/,
    'index.html 코드에 폐기된 outerFaceQr 배선이 남았다 — sceneY 가 던진다');
  // ③ 슬롯 qrText 는 **정본 질의**로 걸린다 (id 를 손으로 나열하면 새 슬롯을 빠뜨린다).
  assert.match(code, /hasCenterQrSlot\(opts\.cellSurfaceLayout\)/,
    '슬롯 qrText 가드가 hasCenterQrSlot 정본 질의를 안 쓴다');
});
