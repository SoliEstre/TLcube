#!/usr/bin/env node

// finder-score 후보 생성기에서 선택된 8개를 게이트 적용 전에 찾아
// src/finder-patterns.js 로 고정한다.
//
// 실행:
//   node tools/extract-finder-patterns.mjs          # 생성될 소스를 stdout 으로 출력
//   node tools/extract-finder-patterns.mjs --write  # src/finder-patterns.js 갱신
//   node tools/extract-finder-patterns.mjs --check  # 현재 파일이 생성 결과와 같은지 검사

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generateFinderCandidates, measureFinderPatternScores } from './finder-score.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'src', 'finder-patterns.js');

const SCORE_AXES = Object.freeze([
  'rotation', 'lowResolution', 'localization', 'dataDistinction',
  'structuralSimplicity', 'defectConcentration',
]);

const TARGETS = Object.freeze([
  Object.freeze({
    id: "pinwheel-3-0101-cw-missing-solid",
    name: "Three-blade pinwheel",
    run: 2,
    gatePassed: false,
    centerOffsetCells: 0.4003203845127178,
    scores: Object.freeze({"rotation":41.88539082916955,"lowResolution":96.76318469627645,"localization":13.956257981685615,"dataDistinction":100,"structuralSimplicity":90.91372900969897,"defectConcentration":42.51092259923948}),
  }),
  Object.freeze({
    id: "gap-ring-01-2-1-solid",
    name: "Solid gap ring",
    run: 2,
    gatePassed: true,
    centerOffsetCells: 0.26268091278848715,
    scores: Object.freeze({"rotation":52.98129428260175,"lowResolution":95.31975482327525,"localization":13.693929273351637,"dataDistinction":100,"structuralSimplicity":86.6828394595597,"defectConcentration":30.22998940390363}),
  }),
  Object.freeze({
    id: "flower-7-0020-coprime-offset",
    name: "Seven-petal flower (compact)",
    run: 2,
    gatePassed: false,
    centerOffsetCells: 0.5265081997022854,
    scores: Object.freeze({"rotation":45.883146774112355,"lowResolution":95.24771635431023,"localization":16.094778612701756,"dataDistinction":100,"structuralSimplicity":91.18880899993957,"defectConcentration":51.01310711908737}),
  }),
  Object.freeze({
    id: "swirl-2-200",
    name: "Face swirl",
    run: 2,
    gatePassed: true,
    centerOffsetCells: 0.015193428136569088,
    scores: Object.freeze({"rotation":79.47194142390262,"lowResolution":91.34433401090291,"localization":22.81112784741712,"dataDistinction":100,"structuralSimplicity":55.579256952027684,"defectConcentration":11.624045166840785}),
  }),
  Object.freeze({
    id: "pinwheel-c2-2-1100-cw",
    name: "C2 twin pinwheel",
    run: 3,
    gatePassed: true,
    centerOffsetCells: 5.0923777502508197e-17,
    scores: Object.freeze({"rotation":79.47194142390262,"lowResolution":97.07728924112143,"localization":11.17193090966036,"dataDistinction":100,"structuralSimplicity":92.28092947267801,"defectConcentration":30.229989403903623}),
  }),
  Object.freeze({
    id: "gap-ring-01-2-1-open",
    name: "Open gap ring",
    run: 3,
    gatePassed: true,
    centerOffsetCells: 0.28238198124762376,
    scores: Object.freeze({"rotation":52.98129428260175,"lowResolution":95.43798666192357,"localization":13.80747895581605,"dataDistinction":100,"structuralSimplicity":84.51542547285166,"defectConcentration":30.22998940390363}),
  }),
  Object.freeze({
    id: "flower-7-1020-coprime-offset",
    name: "Seven-petal flower (wide)",
    run: 3,
    gatePassed: true,
    centerOffsetCells: 0.06943296507508846,
    scores: Object.freeze({"rotation":59.23488777590924,"lowResolution":94.16580922822094,"localization":17.492914686282145,"dataDistinction":100,"structuralSimplicity":82.53857253110874,"defectConcentration":31.478487966284845}),
  }),
  Object.freeze({
    id: "swirl-c2-5-5-11-both",
    name: "C2 face swirl",
    run: 3,
    gatePassed: true,
    centerOffsetCells: 5.611412357367492e-17,
    scores: Object.freeze({"rotation":79.47194142390262,"lowResolution":91.17102980798893,"localization":23.55161544174186,"dataDistinction":100,"structuralSimplicity":56.325320629094655,"defectConcentration":12.065908777314663}),
  })
]);

const BASELINES = Object.freeze([
  Object.freeze({
    id: "bullseye",
    centerOffsetCells: 0.049771574930140124,
    centerBalanceGatePassed: true,
    scores: Object.freeze({"rotation":0,"lowResolution":55.504960185798204,"localization":32.22404593197675,"dataDistinction":100,"structuralSimplicity":59.79246730623948,"defectConcentration":0}),
  }),
  Object.freeze({
    id: "center-qr",
    centerOffsetCells: 0.1022033350678163,
    centerBalanceGatePassed: true,
    scores: Object.freeze({"rotation":64.88856845230502,"lowResolution":44.354818376683234,"localization":23.89512046344338,"dataDistinction":100,"structuralSimplicity":65.77636818983622,"defectConcentration":42.7374753470321}),
  })
]);

export const SELECTED_FINDER_IDS = Object.freeze(TARGETS.map((target) => target.id));

export function bitsToCellMasks(bits) {
  if (!(bits instanceof Uint8Array) || bits.length !== 19 * 3) {
    throw new RangeError(`finder bits 는 Uint8Array(57) 이어야 한다: ${bits && bits.length}`);
  }
  return Object.freeze(Array.from({ length: 19 }, (_, cellIndex) => (
    bits[cellIndex * 3]
    | (bits[cellIndex * 3 + 1] << 1)
    | (bits[cellIndex * 3 + 2] << 2)
  )));
}

function similarIds(missingId, candidates) {
  const familyPrefix = missingId.split('-')[0];
  const sameFamily = candidates
    .map((candidate) => candidate.id)
    .filter((id) => id.startsWith(familyPrefix + '-'));
  return sameFamily.slice(0, 12);
}

function indentJson(value, spaces) {
  const padding = ' '.repeat(spaces);
  return JSON.stringify(value, null, 2).replace(/^/gm, padding);
}

function scoreSource(scores) {
  return '{ ' + SCORE_AXES.map((axis) => axis + ': ' + scores[axis]).join(', ') + ' }';
}

function patternSource(target, candidate) {
  const gate = target.gatePassed ? '통과' : '탈락';
  const params = indentJson(candidate.params, 4);
  const masks = bitsToCellMasks(candidate.bits).join(', ');
  return `  // ${target.run}차 실행 · ${candidate.family} ${JSON.stringify(candidate.params)}
  // 중심 균형 게이트 ${gate} · 중심 오프셋 ${target.centerOffsetCells.toFixed(2)}c · 축별 모형 점수
  definePattern({
    id: ${JSON.stringify(target.id)},
    name: ${JSON.stringify(target.name)},
    family: ${JSON.stringify(candidate.family)},
    sourceRun: ${target.run},
    params:
${params},
    centerBalanceGatePassed: ${target.gatePassed},
    centerOffsetCells: ${target.centerOffsetCells},
    scores: ${scoreSource(target.scores)},
    cellMasks: [${masks}],
  })`;
}

function baselineSource(baseline) {
  return `  ${JSON.stringify(baseline.id)}: defineScoreRecord({
    id: ${JSON.stringify(baseline.id)},
    centerBalanceGatePassed: ${baseline.centerBalanceGatePassed},
    centerOffsetCells: ${baseline.centerOffsetCells},
    scores: ${scoreSource(baseline.scores)},
  })`;
}

function assertFixtureMatches(fixture, measured) {
  if (!measured) throw new Error('파인더 점수 하네스에서 사라짐: ' + fixture.id);
  if (fixture.centerOffsetCells !== measured.centerOffsetCells) {
    throw new Error(fixture.id + ': 중심 오프셋 고정값과 하네스가 다르다');
  }
  for (const axis of SCORE_AXES) {
    if (fixture.scores[axis] !== measured.scores[axis]) {
      throw new Error(fixture.id + ': ' + axis + ' 고정값과 하네스가 다르다');
    }
  }
}
export function renderFinderPatternsModule(candidates = generateFinderCandidates()) {
  const measured = measureFinderPatternScores(candidates);
  const measuredCandidates = new Map(measured.candidates.map((entry) => [entry.id, entry]));
  const measuredBaselines = new Map(measured.baselines.map((entry) => [entry.id, entry]));
  for (const target of TARGETS) assertFixtureMatches(target, measuredCandidates.get(target.id));
  for (const baseline of BASELINES) assertFixtureMatches(baseline, measuredBaselines.get(baseline.id));

  const selected = TARGETS.map((target) => {
    const candidate = candidates.find((entry) => entry.id === target.id);
    if (candidate) return { target, candidate };
    const similar = similarIds(target.id, candidates);
    throw new Error(
      `파인더 후보 ID를 찾지 못함: ${target.id}\n`
      + `유사 ID(${similar.length}): ${similar.join(', ') || '(없음)'}\n`
      + '임의의 유사 후보로 대체하지 않았다.',
    );
  });

  const entries = selected
    .map(({ target, candidate }) => patternSource(target, candidate))
    .join(',\n\n');
  const baselineEntries = BASELINES.map(baselineSource).join(',\n');

  return `// finder-patterns.js — 실물 비교용 중앙 19셀 파인더 후보 8개
//
// ⚠ tools/extract-finder-patterns.mjs 생성물. 직접 마스크를 고치지 말고 생성기를 갱신한 뒤
// 이 도구를 다시 실행한다. 좌표 순서는 hexgrid.regionCells(2), 면 비트는 T=1/L=2/R=4다.
// 이 후보들은 렌더 실험용이며 현행 동심원 디코더로 스캔되지 않는다.

import { FACES, regionCells } from './hexgrid.js';

export const LEGACY_FINDER_PATTERN_ID = 'bullseye';
export const DEFAULT_FINDER_PATTERN_ID = 'bullseye';
export const FINDER_FACE_BITS = Object.freeze({ T: 1, L: 2, R: 4 });
export const FINDER_CELL_ORDER = Object.freeze(
  regionCells(2).map(({ q, r }) => Object.freeze({ q, r })),
);

if (FINDER_CELL_ORDER.length !== 19) {
  throw new Error(\`파인더 셀 수 불일치: \${FINDER_CELL_ORDER.length} !== 19\`);
}
if (FACES.join(',') !== 'T,L,R') {
  throw new Error(\`파인더 면 순서 불일치: \${FACES.join(',')} !== T,L,R\`);
}

function defineScoreRecord(record) {
  return Object.freeze({
    ...record,
    scores: Object.freeze({ ...record.scores }),
  });
}

export const FINDER_BASELINE_SCORES = Object.freeze({
${baselineEntries}
});
function definePattern(pattern) {
  if (!Array.isArray(pattern.cellMasks) || pattern.cellMasks.length !== FINDER_CELL_ORDER.length) {
    throw new RangeError(\`\${pattern.id}: cellMasks 는 19개여야 한다\`);
  }
  for (const mask of pattern.cellMasks) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
      throw new RangeError(\`\${pattern.id}: 면 마스크 범위 오류 \${mask}\`);
    }
  }
  return Object.freeze({
    ...pattern,
    params: Object.freeze({ ...pattern.params }),
    scores: Object.freeze({ ...pattern.scores }),
    cellMasks: Object.freeze([...pattern.cellMasks]),
  });
}

export const FINDER_PATTERNS = Object.freeze([
  // 순서는 생성기 UI 배치와 묶여 있다: 2차 후보 4개(첫 행), 같은 계열의 3차 후보 4개(둘째 행).
${entries}
]);

export const FINDER_PATTERN_IDS = Object.freeze(FINDER_PATTERNS.map((pattern) => pattern.id));
const PATTERN_BY_ID = new Map(FINDER_PATTERNS.map((pattern) => [pattern.id, pattern]));

export function getFinderPattern(id) {
  if (typeof id !== 'string') {
    throw new TypeError(\`finderPatternId 는 문자열이어야 한다: \${typeof id}\`);
  }
  const pattern = PATTERN_BY_ID.get(id);
  if (!pattern) throw new RangeError(\`알 수 없는 finderPatternId: \${id}\`);
  return pattern;
}

export function isExperimentalFinderPattern(id) {
  return PATTERN_BY_ID.has(id);
}
`;
}

async function main(args) {
  const source = renderFinderPatternsModule();
  if (args.includes('--write')) {
    await fs.writeFile(OUTPUT_PATH, source, 'utf8');
    process.stdout.write(`finder-patterns.js 생성됨: ${OUTPUT_PATH}\n`);
    return;
  }
  if (args.includes('--check')) {
    const current = await fs.readFile(OUTPUT_PATH, 'utf8');
    if (current !== source) {
      throw new Error('src/finder-patterns.js 가 현재 후보 생성기와 다르다 — --write 로 재생성해야 한다');
    }
    process.stdout.write('finder-patterns.js 일치\n');
    return;
  }
  process.stdout.write(source);
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
