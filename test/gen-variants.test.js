import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEGACY_FINDER_PATTERN_ID } from '../src/finder-patterns.js';
import { FINDER_CARD_GROUPS } from '../src/finder-card-ui.js';
import {
  buildSingleHtml, FINDER_EXPERIMENT_EDITION, OFFICIAL_GENERATOR_EDITION,
} from '../tools/build-single.mjs';
import {
  buildGeneratorVariants, FINDER_EXPERIMENT_DEFAULT_ID,
} from '../tools/build-gen-variants.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OFFICIAL_PATH = path.join(ROOT, 'dist', 'trilume.html');
const EXPERIMENT_PATH = path.join(ROOT, 'sites', '_shared', 'gen-finder.html');
const EDITOR_PATH = path.join(ROOT, 'sites', '_shared', 'gen-finder-editor.html');
const ROBOTS_PATH = path.join(ROOT, 'sites', '_shared', 'robots-tlcube.txt');

function embeddedFinderSource(html) {
  const match = /\["finder-patterns",\s*("(?:\\.|[^"\\])*")\]/.exec(html);
  assert.ok(match, 'finder-patterns 임베드 모듈을 못 찾았다');
  return JSON.parse(match[1]);
}

test('정식/시험판 산출물이 같은 소스 빌더의 현재 결과와 바이트 동일하다', () => {
  const built = buildGeneratorVariants();
  assert.equal(readFileSync(OFFICIAL_PATH, 'utf8'), built.official);
  assert.equal(readFileSync(EXPERIMENT_PATH, 'utf8'), built.experiment);
  assert.equal(readFileSync(EDITOR_PATH, 'utf8'), built.editor);
});

test('정식은 bullseye, 시험판은 C2 쌍날만 빌드 인자로 초기값을 덮는다', () => {
  const official = buildSingleHtml();
  const experiment = buildSingleHtml({
    generatorEdition: FINDER_EXPERIMENT_EDITION,
    defaultFinderPatternId: FINDER_EXPERIMENT_DEFAULT_ID,
  });
  assert.match(official, new RegExp('<body data-generator-edition="' + OFFICIAL_GENERATOR_EDITION + '">'));
  assert.match(experiment, new RegExp('<body data-generator-edition="' + FINDER_EXPERIMENT_EDITION + '">'));
  assert.match(embeddedFinderSource(official),
    new RegExp("DEFAULT_FINDER_PATTERN_ID = '" + LEGACY_FINDER_PATTERN_ID + "'"));
  assert.match(embeddedFinderSource(experiment),
    new RegExp("DEFAULT_FINDER_PATTERN_ID = '" + FINDER_EXPERIMENT_DEFAULT_ID + "'"));
  assert.match(embeddedFinderSource(experiment),
    new RegExp("LEGACY_FINDER_PATTERN_ID = '" + LEGACY_FINDER_PATTERN_ID + "'"));
});

test('정식 edition에 실험 기본값을 결합하면 빌드가 실패한다', () => {
  assert.throws(() => buildSingleHtml({
    generatorEdition: OFFICIAL_GENERATOR_EDITION,
    defaultFinderPatternId: FINDER_EXPERIMENT_DEFAULT_ID,
  }), /정식 생성기의 기본 파인더/);
});

test('두 빌드에 시험판/정식 상호 링크와 통합 시험 배너가 함께 들어간다', () => {
  const built = buildGeneratorVariants();
  for (const html of [built.official, built.experiment]) {
    assert.match(html, /href="https:\/\/tlcube\.estre\.so\/_shared\/gen-finder\.html"/);
    assert.match(html, /href="https:\/\/tlcube\.estre\.so\/"/);
    assert.match(html, /id="finderExperimentBanner"/);
    assert.match(html, /id="labTelemetryDisclosure" hidden/);
    assert.equal(html.match(/<aside class="experiment-banner/g)?.length, 1);
  }
});

test('select 대신 계열 카드 격자이고 이진 마스크·3톤 큐브 썸네일을 소스에서 만든다', () => {
  const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cardUiSource = readFileSync(path.join(ROOT, 'src', 'finder-card-ui.js'), 'utf8');
  assert.doesNotMatch(source, /<select id="finderPattern"/);
  assert.match(source, /class="finder-family-grid card-row"/);
  // **의도적 갱신 (2026-08-21, 중앙 v0 편입)**: 「4칸」을 값으로 적던 자리를 «카드 수가
  // 정한다» 로 옮겼다. 중앙 v0 카드가 formal 그룹 **밖에서** 중앙 QR 앞에 끼면서 정식
  // 행이 5개가 됐는데, 칸 수 4 를 그대로 두면 5번째가 조용히 다음 줄로 흘러 4+1 이
  // 된다 — 깨지지도 죽지도 않아 눈으로만 잡히는 결함이다. 그래서 값이 아니라
  // 「행의 카드 수 = 격자 칸 수」라는 **관계**를 잠근다.
  const formalCardCount = FINDER_CARD_GROUPS.formal.length + 1; // +1 = 중앙 v0 카드
  // 정규식이 아니라 부분 문자열로 본다 — 이 명제엔 메타문자가 필요 없고,
  // 이스케이프가 하나 어긋나면 검사가 조용히 헐거워진다.
  assert.ok(
    source.includes(
      `finder-legacy-row { display: grid; grid-template-columns: repeat(${formalCardCount},`),
    `정식 행 카드 ${formalCardCount}개인데 .finder-legacy-row 격자 칸 수가 그 값이 아니다`);
  assert.doesNotMatch(source, /finder-legacy-row \.finder-card \{ flex-direction: row/);
  // 정식 행은 여전히 formal 그룹에서 나오고(손 나열 금지), v0 는 규칙으로 끼워진다.
  assert.match(source, /FINDER_CARD_GROUPS\.formal\.flatMap/);
  assert.match(source, /\[CENTRAL_V0_FINDER_CARD, entry\]/);
  assert.match(source, /function centerQrThumbnail\(\)/);
  assert.match(source, /finder-family-grid\.card-row \{\s*display: grid; grid-template-columns: repeat\(4,/);
  assert.match(source, /@media \(max-width: 420px\)[\s\S]*finder-family-grid\.card-row \{ grid-template-columns: repeat\(2,/);
  assert.match(source, /const generatedFamilies = FINDER_CARD_GROUPS\.generated/);
  assert.match(source, /const bottom = generatedFamilies\[column \+ 4\]/);
  assert.match(source, /const refinedPatterns = FINDER_CARD_GROUPS\.refined/);
  assert.match(source, /className = 'finder-user-patterns'/);
  assert.match(source, /'user-refined': 'g504'/);
  assert.match(source, /top\.pattern\.family !== bottom\.pattern\.family/);
  assert.match(source, /className = 'toggle-card finder-card'/);
  assert.match(source, /pattern\.cellMasks\[cellIndex\]/);
  assert.match(source, /facePolygon\(cell\.q, cell\.r, face, layout\)/);
  // **의도적 갱신 (2026-08-19, daehan UI 편입)**: 발자국을 19셀로 못 박던 자리를
  // «패턴이 정한다» 로 옮겼다. daehan 은 finderCells 39/59/79 셀이라 19를 가정하면
  // 정본 앞 19톤이 엉뚱한 불스아이 좌표에 찍히고 **길이가 남아서 죽지도 않는다**
  // (조용히 틀린 그림). 그래서 잠그는 명제를 «19다» 에서 «패턴 발자국을 쓴다» 로 바꾼다.
  assert.match(source, /Array\.isArray\(pattern\.finderCells\) \? pattern\.finderCells : FINDER_CELL_ORDER/);
  assert.match(source, /'data-mask-cells': footprint\.length/);
  assert.match(source, /function finderCubeThumbnail\(pattern\)/);
  assert.match(source, /pattern\.renderKind === 'three-tone-cube'/);
  assert.match(cardUiSource, /threeTonePatterns\[0\]\.renderKind !== 'three-tone-cube'/);
  assert.match(
    cardUiSource,
    /formal:\s*Object\.freeze\(\[\s*descriptor\(LEGACY_FINDER_PATTERN_ID[\s\S]*descriptor\(THREE_TONE_CUBE_FINDER_PATTERN_ID[\s\S]*descriptor\(CENTER_QR_FINDER_PATTERN_ID/,
  );
  assert.match(source, /'central-cube-3tone': 'g505'/);
  assert.match(source, /'three-tone-cube': 'g506'/);
  assert.match(source, /id="finderScorePanel"/);
  assert.match(source, /const centerQrScores = FINDER_BASELINE_SCORES\[CENTER_QR_FINDER_PATTERN_ID\]\.scores/);
  assert.match(source, /const scoreText = score\.toFixed\(2\)/);
  assert.match(source, /bullseye: 53/);
  assert.match(source, /\[CENTER_QR_FINDER_PATTERN_ID\]: 89/);
  assert.match(source, /centerQrSelected[\s\S]*t\('g497'\)/);
  assert.doesNotMatch(source, /finderOverrideHint/);
  assert.match(source, /classList\.toggle\('gate-rejected'/);
  assert.match(source, /evidenceKey: 'g489'.*evidenceClass: 'measured'/);
  assert.match(source, /evidenceKey: 'g490'.*evidenceClass: 'counterexample'/);
  assert.match(source, /data-i18n="g492"/);
  const built = buildGeneratorVariants();
  // ⚠ 태그 리터럴을 여기 박지 않는다. 박아 두면 릴리스마다 손으로 올려야 하고, 잊으면
  //   «커밋 제목은 .10 인데 소스는 .09» 같은 어긋남을 테스트가 되레 잠가 버린다
  //   (d91a34d 에서 실제로 났다). 실제 불변식은 «두 변형이 index.html 의 태그를
  //   그대로 나른다» 이므로 소스에서 읽어서 잰다.
  const tagMatch = /const GENERATOR_BUILD = '([^']+)'/.exec(source);
  assert.ok(tagMatch, 'index.html 에서 GENERATOR_BUILD 를 못 찾았다');
  for (const html of [built.official, built.experiment]) {
    assert.ok(html.includes(tagMatch[1]), '빌드 태그 ' + tagMatch[1] + ' 가 변형에 없다');
    const finderSource = embeddedFinderSource(html);
    assert.match(finderSource, /export const FINDER_BASELINE_SCORES/);
    assert.match(html, /\["finder-selection",/);
    assert.match(html, /\["finder-card-ui",/);
    assert.match(html, /\["generator-render-config",/);
    assert.doesNotMatch(finderSource, /\btotal\b/);
  }
});

test('파인더/QR 결합은 정규화 뒤 한 번씩만 그리는 비재귀 경로다', () => {
  const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(source, /function syncFinderUi\(/);
  assert.doesNotMatch(source, /function syncQrPositionUi\(/);

  const combinedStart = source.indexOf('function syncFinderQrUi()');
  const combinedEnd = source.indexOf('for (const card of els.typeCards.children)', combinedStart);
  assert.ok(combinedStart >= 0 && combinedEnd > combinedStart, '통합 sync 함수를 못 찾았다');
  const combined = source.slice(combinedStart, combinedEnd);
  assert.doesNotMatch(combined, /normalizeFinderQrState\(/);
  assert.match(combined, /상태를 정규화하지 않는다/);
  assert.equal((combined.match(/renderQrPositionUi\(\)/g) || []).length, 1);
  assert.equal((combined.match(/renderFinderUi\(\)/g) || []).length, 1);

  const finderRender = source.slice(
    source.indexOf('function renderFinderUi()'),
    source.indexOf('function renderQrPositionUi()'),
  );
  const qrRender = source.slice(
    source.indexOf('function renderQrPositionUi()'),
    combinedStart,
  );
  assert.doesNotMatch(finderRender, /syncFinderQrUi\(/);
  assert.doesNotMatch(qrRender, /syncFinderQrUi\(/);

  assert.match(source, /commitFinderQrTransition\(/);
  assert.match(source, /cancelPendingRender:\s*cancelScheduledRender/);
  assert.match(source, /render:\s*\(\)\s*=>\s*\{[\s\S]*?render\(\);[\s\S]*?\}/);

  const renderStart = source.indexOf('function render()');
  const renderEnd = source.indexOf('for (const el of [', renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, '주 렌더 함수를 못 찾았다');
  const renderSource = source.slice(renderStart, renderEnd);
  assert.match(renderSource, /renderWithErrorDisplay\(els\.error,/);
  assert.doesNotMatch(renderSource, /els\.error\.textContent\s*=/);
});

test('회전 한계 안내는 스캐너가 아니라 생성기 QR·파인더 선택 옆의 3언어 문구다', () => {
  const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scanner = readFileSync(path.join(ROOT, 'sites', 'tlscan', 'index.html'), 'utf8');
  assert.match(source,
    /id="qrLinkSection"[\s\S]*id="finderSection"[\s\S]*id="rotationGuidance"[^>]*data-i18n="g514"/,
    'QR 링크 선택은 파인더보다 앞이고 회전 안내는 같은 생성기 설정 흐름에 있어야 한다');
  assert.doesNotMatch(scanner, /rotationGuidance|scan-rotation-hint|guide\.rotation/,
    '회전 안내를 스캐너 UI에 두지 않는다');
  for (const marker of ['회전', 'rotated', '回転']) {
    assert.ok(source.includes(marker), marker + ': 생성기 번역 누락');
  }
});

test('실험 경고는 12종 후보 선택에만 연결되고 두 기준선에는 연결되지 않는다', () => {
  const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(source, /const selectedPattern = FINDER_PATTERNS\.find\(/);
  assert.match(source, /const experimental = Boolean\(selectedPattern\)/);
  assert.match(source, /FINDER_BASELINE_SCORES\[generatorState\.finderPatternId\]/);
});

test('robots는 임시 생성기 엔드포인트를 색인에서 제외한다', () => {
  assert.match(readFileSync(ROBOTS_PATH, 'utf8'), /^Disallow: \/_shared\/gen-$/m);
});
