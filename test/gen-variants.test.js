import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEGACY_FINDER_PATTERN_ID } from '../src/finder-patterns.js';
import {
  buildSingleHtml, FINDER_EXPERIMENT_EDITION, OFFICIAL_GENERATOR_EDITION,
} from '../tools/build-single.mjs';
import {
  buildGeneratorVariants, FINDER_EXPERIMENT_DEFAULT_ID,
} from '../tools/build-gen-variants.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OFFICIAL_PATH = path.join(ROOT, 'dist', 'trilume.html');
const EXPERIMENT_PATH = path.join(ROOT, 'sites', '_shared', 'gen-finder.html');
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

test('두 빌드에 시험판/정식 상호 링크와 상시 시험 배너가 함께 들어간다', () => {
  const built = buildGeneratorVariants();
  for (const html of [built.official, built.experiment]) {
    assert.match(html, /href="https:\/\/tlcube\.estre\.so\/_shared\/gen-finder\.html"/);
    assert.match(html, /href="https:\/\/tlcube\.estre\.so\/"/);
    assert.match(html, /id="finderExperimentBanner"/);
  }
});

test('select 대신 4계열 카드 격자이고 실험 썸네일은 19셀 마스크에서 만든다', () => {
  const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(source, /<select id="finderPattern"/);
  assert.match(source, /class="finder-family-grid card-row"/);
  assert.match(source, /finder-family-grid\.card-row \{\s*display: grid; grid-template-columns: repeat\(4,/);
  assert.match(source, /@media \(max-width: 420px\)[\s\S]*finder-family-grid\.card-row \{ grid-template-columns: repeat\(2,/);
  assert.match(source, /const bottom = FINDER_PATTERNS\[column \+ 4\]/);
  assert.match(source, /top\.family !== bottom\.family/);
  assert.match(source, /className = 'toggle-card finder-card'/);
  assert.match(source, /pattern\.cellMasks\[cellIndex\]/);
  assert.match(source, /facePolygon\(cell\.q, cell\.r, face, layout\)/);
  assert.match(source, /'data-mask-cells': FINDER_CELL_ORDER\.length/);
  assert.match(source, /id="finderScorePanel"/);
  assert.match(source, /const centerQrScores = FINDER_BASELINE_SCORES\['center-qr'\]\.scores/);
  assert.match(source, /classList\.toggle\('gate-rejected'/);
  assert.match(source, /evidenceKey: 'g489'.*evidenceClass: 'measured'/);
  assert.match(source, /evidenceKey: 'g490'.*evidenceClass: 'counterexample'/);
  assert.match(source, /data-i18n="g492"/);
  const built = buildGeneratorVariants();
  for (const html of [built.official, built.experiment]) {
    assert.match(html, /2026-08-12\.02/);
    const finderSource = embeddedFinderSource(html);
    assert.match(finderSource, /export const FINDER_BASELINE_SCORES/);
    assert.doesNotMatch(finderSource, /\btotal\b/);
  }
});

test('robots는 임시 생성기 엔드포인트를 색인에서 제외한다', () => {
  assert.match(readFileSync(ROBOTS_PATH, 'utf8'), /^Disallow: \/_shared\/gen-$/m);
});
