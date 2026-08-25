/**
 * type-y-cell-editor-lab.test.js — /lab/ 셀 편집기 노출·i18n·접근성·번들.
 *
 * 의도적 갱신 (2026-08-16, 운영자 지시): 섹션이 «Y타입 셀 편집기» → «셀 편집기» 로
 * 개명되고 타입 O·A 를 함께 연다. 그래서 옛 게이트 단언
 * (`isLabPath() && generatorState.type === 'Y'`) 은 **주어가 바뀌었다**.
 *
 * ⚠ 그 단언을 그냥 두면 통과는 하는데 아무것도 안 지킨다 — 같은 문자열이
 * `syncYLocatorUi()`(Y 로케이터 옵션, 진짜 Y 전용)에도 있어서 그쪽을 물기 때문이다.
 * 그래서 «편집기 게이트» 와 «로케이터 게이트» 를 각각 함수 이름에 앵커해 둘로 나눴다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CELL_TYPES } from '../src/cell-editor-core.js';
import { buildGeneratorLabHtml } from '../tools/build-gen-variants.mjs';
import { buildSingleHtml, OFFICIAL_GENERATOR_EDITION } from '../tools/build-single.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

const I18N_KEYS = [
  'g521', 'g522', 'g523', 'g524', 'g525', 'g526', 'g527', 'g528', 'g529',
  'g530', 'g531', 'g532', 'g533', 'g534', 'g535', 'g536', 'g537', 'g538',
  'g539', 'g540',
  // 다중 타입 · undo/redo · 단축키 확장 대역 (2026-08-16). 한 대역으로 몰아 잡는다 —
  // 다른 레인이 같은 사전에 키를 붙이고 있어서 번호가 흩어지면 병합 때 엉킨다.
  'g550', 'g551', 'g552', 'g553', 'g554', 'g555', 'g556', 'g557', 'g558',
  'g559', 'g560', 'g561', 'g562',
];

function langBlock(lang) {
  const start = INDEX.indexOf('const GENERATOR_STRINGS = {');
  const at = INDEX.search(new RegExp(`["']?${lang}["']?\\s*:\\s*\\{`, 'm'));
  assert.ok(start >= 0 && at > start, `${lang} 사전을 못 찾았다`);
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

test('/lab/ 에서 섹션을 열고 정식판에서는 숨긴다 · 게이트 목록은 코어에서 유도한다', () => {
  assert.match(INDEX, /id="yCellEditorSection"/);
  assert.match(INDEX, /data-i18n="g521"/);
  assert.match(INDEX, /function syncTypeYCellEditorUi\(\)/);
  // **의도적 갱신 (2026-08-25)** — 구 락은 `Object.freeze(['Y','O','A'])` 라는 손
  // 사본을 못 박고 있었다. 그런데 같은 파일의 «타입 여섯 + 사본 금지» 테스트와
  // 정면으로 모순이었고, 그 모순이 실제 사고를 냈다: G·V·K 버튼을 DOM 에 붙였는데
  // 이 목록을 못 늘려 클릭이 통째로 삼켜졌고(«버튼만 있고 안 먹음»), 그동안 스위트는
  // 초록이었다 — 잡을 테스트가 있었는데 **엉뚱한 것을 쟀다.**
  // 이제 사본을 금지하고 유도를 못 박는다.
  assert.match(INDEX, /const CELL_EDITOR_TYPES = CORE_CELL_TYPES;/);
  assert.doesNotMatch(INDEX, /const CELL_EDITOR_TYPES = Object\.freeze\(/,
    '게이트 목록이 다시 손 사본이 됐다 — 코어에서 유도해야 한다');
  // 게이트 주어는 «타입» 이 아니라 «조합» 이다: 턴A 를 켜면 type 은 여전히 'A' 라
  // 타입만 보면 편집기가 생성기와 다른 격자를 연다.
  assert.match(
    INDEX,
    /function syncTypeYCellEditorUi\(\)[\s\S]{0,400}const show = isLabPath\(\) && CELL_EDITOR_TYPES\.includes\(followed\);/,
  );
  assert.match(INDEX, /function effectiveEditorTypeFromGenerator\(\)/);
  // 로케이터 게이트 — 이쪽은 여전히 Y 전용이다 (편집기 게이트와 주어가 다르다).
  assert.match(
    INDEX,
    /function syncYLocatorUi\(\)[\s\S]{0,200}isLabPath\(\) && generatorState\.type === 'Y'/,
  );
  assert.match(INDEX, /if \(isLabPath\(\)\) wireTypeYCellEditor\(\)/);
  assert.match(INDEX, /section\.hidden = !show/);
  assert.doesNotMatch(INDEX, /applyToneEdit\([^)]*current/);
  assert.doesNotMatch(INDEX, /stringifyCellEditor\([^)]*encodeY/);
});

// **의도적 갱신 (2026-08-24)** — 구 락은 «Y/O/A 셋뿐 + K 제외» 였다. 그 제외의
// 근거(«렌더러 계약 확장 대기»)는 Wave 3 ② Type K 로 해소됐고, 운영자 지시로
// G(O-CM 자리)·V(턴A)도 함께 열렸다. 락은 삭제가 아니라 **새 집합의 양성 단언**으로.
test('타입 선택은 Y/O/A/G/V/K 여섯이고 기하는 공용 코어·hexgrid 를 재사용한다', () => {
  for (const type of ['Y', 'O', 'A', 'G', 'V', 'K']) {
    assert.match(INDEX, new RegExp(`data-ycell-type="${type}"`), `${type} 카드가 없다`);
  }
  // 코어의 타입 목록과 화면 카드가 **같은 집합**이어야 한다 (사본 금지).
  for (const type of CELL_TYPES) {
    assert.match(INDEX, new RegExp(`data-ycell-type="${type}"`),
      type + ' 가 코어에는 있는데 편집기 카드에 없다 — 목록이 갈렸다');
  }
  assert.match(INDEX, /data-i18n="g554"/);
  // 편집기 전용 기하·역할표 복제 금지 — 코어(placement/placementA)와 hexgrid 를 쓴다.
  assert.match(INDEX, /from '\.\/src\/cell-editor-core\.js'/);
  assert.match(INDEX, /facePolygon\(c\.q, c\.r, face, view\.layout\)/);
  assert.match(INDEX, /roleOfCoord\(type, k, c, \{ finderMode \}\)/);
  assert.match(INDEX, /enumerateCoreCells\(ctx\.type, k\)/);
  // O/A export 는 컴팩트 튜플 팩 (k=10 에서 indent 2 객체 나열이면 수천 줄이 된다).
  assert.match(INDEX, /stringifyUniversalEditorCompact\(state\)/);
});

test('undo/redo 는 순수 모듈 위임 + 스트로크 코얼레싱 + 섹션 스코프 단축키다', () => {
  assert.match(INDEX, /from '\.\/src\/cell-editor-history\.js'/);
  assert.match(INDEX, /id="yCellEditorUndo"/);
  assert.match(INDEX, /id="yCellEditorRedo"/);
  // 상한은 모듈 상수를 그대로 쓴다 (편집기에서 숫자를 다시 적지 않는다).
  assert.match(INDEX, /createHistoryStore\(\{ limit: CELL_EDITOR_HISTORY_LIMIT \}\)/);
  assert.doesNotMatch(INDEX, /createHistoryStore\(\{ limit: \d+ \}\)/);
  // 드래그 = 한 스텝: pointerdown 에서 열고 pointerup/cancel 에서 닫는다.
  assert.match(INDEX, /cellEditorBeginStroke\(ctx, cellEditorStateFor\(ctx\)\)/);
  assert.match(INDEX, /window\.addEventListener\('pointerup', cellEditorEndStroke\)/);
  assert.match(INDEX, /window\.addEventListener\('pointercancel', cellEditorEndStroke\)/);
  // 단축키는 **섹션 안에 포커스가 있을 때만** — window 전역 청취 금지.
  // (서식에 결합하지 않는다: 이 파일 전체에서 window keydown 리스너 자체를 금지한다.
  //  옛 단언은 화살표 함수 한 가지 표기만 막아 재서식이면 그냥 통과했다.)
  assert.match(INDEX, /els\.yCellEditorSection\.addEventListener\('keydown'/);
  assert.match(INDEX, /const shortcut = classifyHistoryShortcut\(ev\);/);
  assert.doesNotMatch(INDEX, /window\.addEventListener\(\s*['"]keydown['"]/);
  // 안내 노출 + 불가 시 비활성.
  // **의도적 갱신 (2026-08-26)**: 단축키 안내(g557)는 3줄이라 «?»(help-dot)로 갔다
  // (운영자 «두 줄 넘어가는 설명은 ?버튼으로»). 안내가 **있는가** 는 그대로 잰다.
  assert.match(INDEX, /class="help-dot" data-help="g557"/);
  assert.match(INDEX, /els\.yCellEditorUndo\.disabled = !canUndoHistory\(/);
  assert.match(INDEX, /els\.yCellEditorRedo\.disabled = !canRedoHistory\(/);
});

test('스텝은 «실제로 바뀐 뒤» 에만 쌓인다 — 편집 경로가 전부 commitEdit 를 지난다', () => {
  // 회귀 (2026-08-16): editYCell 이 ctx.error 만 보고 무조건 기록해서, 마스크 모드의
  // 잠긴 셀(reference/format·파인더 점유) 클릭이 빈 undo 스텝을 쌓았다 — 반복 클릭이
  // 상한 50 스택을 밀어내 진짜 편집을 잃었다. 규칙은 히스토리 모듈이 소유한다.
  assert.match(INDEX, /commitEdit as commitHistoryEdit/);
  assert.match(INDEX, /function cellEditorCommit\(key, state, apply\)/);
  assert.match(INDEX, /commitHistoryEdit\(cellEditorHistory, key, \{/);
  // 예약 → 첫 실제 편집에서 확정 (누른 순간에는 스텝을 만들지 않는다).
  assert.match(INDEX, /armHistoryStroke\(cellEditorHistory, cellEditorStrokeKey,/);
  assert.doesNotMatch(INDEX, /beginHistoryStroke\(/);
  // Y 도 O/A 와 **같은 함수**를 지난다 — 한쪽만 고치는 사고가 이 결함의 원인이었다.
  assert.match(
    INDEX,
    /function editYCell\([\s\S]{0,600}cellEditorCommit\(\s*historyKey\('Y', ctx\.n\), state,/,
  );
  assert.match(
    INDEX,
    /function editHexCell\([\s\S]{0,900}cellEditorCommit\(key, state, \(\) => coreMaskToggle\(state, c\)\)/,
  );
  // «기록 → 편집» 순서(무조건 기록)로 되돌아가지 못하게 옛 헬퍼 이름을 금지한다.
  assert.doesNotMatch(INDEX, /cellEditorNoteEdit\(/);
  assert.doesNotMatch(INDEX, /cellEditorRecord\(/);
});

test('드래그 중복 방지 키는 **편집 단위**를 쓴다 (마스크는 좌표, 톤은 면)', () => {
  // 회귀 (2026-08-16): 키가 face:coord 고정이라 마스크 모드에서 한 셀의 두 면을 스치면
  // 좌표 토글이 두 번 일어나 드래그가 «아무 일도 안 한» 결과가 됐다.
  assert.match(INDEX, /editUnitKey,/);
  assert.match(INDEX, /const mark = editUnitKey\(cell, cellEditorStrokeMode\);/);
  assert.match(INDEX, /cellEditorStrokeMode = state\.mode;/);
  assert.doesNotMatch(INDEX, /const mark = cell\.i === undefined/);
});

test('되돌리기는 진행 중인 붓질을 끝낸다 (열린 스트로크가 남으면 편집이 삼켜진다)', () => {
  assert.match(
    INDEX,
    /function cellEditorStepHistory\(direction\) \{[\s\S]{0,400}cellEditorEndStroke\(\);/,
  );
  assert.match(INDEX, /if \(ev\.buttons === 0\) \{\s*\n\s*cellEditorEndStroke\(\);/);
});

test('셀 편집기 문구는 8언어 키가 같고 우클릭·키보드·접근성 마크업이 있다', () => {
  // ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): ko/en/ja → 8언어.
  for (const key of I18N_KEYS) {
    for (const lang of ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt']) {
      assert.match(langBlock(lang), new RegExp('"' + key + '"\\s*:'), `${lang} 에 ${key} 가 없다`);
    }
  }
  // 개명(g521)은 **값까지** 못 박는다. 키 존재만 보면 «Y타입 셀 편집기» 로 조용히
  // 되돌아가도 초록이라 개명을 아무도 안 지킨다.
  // ⚠ 의도적 갱신 (2026-08-17): 새 5언어도 «셀 편집기» 역어를 값으로 박는다 —
  //   «Y 타입» 이 다시 붙는 퇴행은 언어를 가리지 않는다.
  const RENAMED = {
    ko: '셀 편집기', en: 'Cell editor', ja: 'セル編集',
    fr: 'Éditeur de cellules', it: 'Editor delle celle', de: 'Zelleneditor',
    es: 'Editor de celdas', pt: 'Editor de células',
  };
  for (const [lang, label] of Object.entries(RENAMED)) {
    assert.match(langBlock(lang), new RegExp(`"g521"\\s*:\\s*"${label}"`), `${lang} g521 개명`);
  }
  assert.match(INDEX, /data-i18n="g521">셀 편집기</, '정적 폴백 텍스트도 개명본이다');
  // 두 카드 묶음이 같은 접근성 표기를 쓴다 (타입만 aria-pressed 이던 것 정정).
  assert.match(INDEX, /card\.setAttribute\('aria-pressed', on \? 'true' : 'false'\)/);
  assert.match(INDEX, /contextmenu/);
  assert.match(INDEX, /preventDefault\(\)/);
  assert.match(INDEX, /closest\('\.y-cell-editor-cell'\)/);
  assert.match(INDEX, /ev\.key === 'Enter' \|\| ev\.key === ' '/);
  assert.match(INDEX, /ev\.shiftKey \? TONE_BRIGHTEN : TONE_DARKEN/);
  assert.match(INDEX, /editYCell\(cell\.face, cell\.i, cell\.j, direction, true\)/);
  assert.match(INDEX, /next\.focus\(\{ preventScroll: true \}\)/);
  assert.match(INDEX, /setAttribute\('role', 'button'\)/);
  assert.match(INDEX, /tf\('g533'/);
  assert.match(INDEX, /aria-live="polite"/);
  assert.match(INDEX, /id="yCellEditorJson"/);
  assert.match(INDEX, /id="yCellEditorStatus"/);
  assert.match(INDEX, /y-cell-editor-viewport/);
  assert.match(INDEX, /overflow:\s*auto/);
});

test('시험판 번들에도 섹션이 있고 안정판은 런타임에 숨기며 모듈이 임베드된다', () => {
  const lab = buildGeneratorLabHtml();
  const official = buildSingleHtml({ generatorEdition: OFFICIAL_GENERATOR_EDITION });
  assert.match(lab, /id="yCellEditorSection"/);
  assert.match(lab, /data-i18n="g521"/);
  assert.match(official, /id="yCellEditorSection"/);
  assert.match(official, /if \(isLabPath\(\)\) wireTypeYCellEditor\(\)/);
  // 정정 (2026-08-16): 여기 있던 `isLabPath() && generatorState.type === 'Y'` 단언은
  // **편집기 게이트를 안 물었다** — 같은 문자열이 syncYLocatorUi() 에도 있어서 그쪽으로
  // 통과했고, 편집기 게이트를 통째로 지워도 초록이었다. 첫 테스트에서 갈라낸 오진을
  // 번들 테스트가 그대로 하고 있었다. 이제 게이트마다 함수 이름에 앵커한다.
  // 갱신 (2026-08-25): 게이트 주어가 «타입» → «조합» 이 됐다 (턴A·O-CM 은 type 만
  // 봐서는 안 갈린다). 번들에도 그 형태로 실렸는지 같은 앵커로 확인한다.
  assert.match(
    official,
    /function syncTypeYCellEditorUi\(\)[\s\S]{0,400}const show = isLabPath\(\) && CELL_EDITOR_TYPES\.includes\(followed\);/,
  );
  assert.match(official, /function effectiveEditorTypeFromGenerator\(\)/);
  assert.match(
    official,
    /function syncYLocatorUi\(\)[\s\S]{0,200}isLabPath\(\) && generatorState\.type === 'Y'/,
  );
  assert.match(lab, /\["type-y-cell-editor"/);
  assert.match(official, /\["type-y-cell-editor"/);
  // 다중 타입 코어와 히스토리 모듈도 함께 임베드돼야 한다 — 빠지면 /lab/ 에서
  // 섹션이 통째로 죽는다(모듈 해석 실패). 순서는 빌더의 위상 정렬이 강제한다.
  for (const html of [lab, official]) {
    assert.match(html, /\["cell-editor-history"/);
    assert.match(html, /\["cell-editor-core"/);
    assert.match(html, /\["finder-editor-pattern"/);
  }
});
