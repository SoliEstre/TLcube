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

import { generateFinderCandidates } from './finder-score.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'src', 'finder-patterns.js');

const TARGETS = Object.freeze([
  Object.freeze({
    id: 'swirl-2-200',
    name: 'Face swirl',
    run: 2,
    gatePassed: true,
    rotation: 79.47194142390262,
    structuralSimplicity: 55.579256952027684,
  }),
  Object.freeze({
    id: 'gap-ring-01-2-1-solid',
    name: 'Solid gap ring',
    run: 2,
    gatePassed: true,
    rotation: 52.98129428260175,
    structuralSimplicity: 86.6828394595597,
  }),
  Object.freeze({
    id: 'pinwheel-3-0101-cw-missing-solid',
    name: 'Three-blade pinwheel',
    run: 2,
    gatePassed: false,
    rotation: 41.88539082916955,
    structuralSimplicity: 90.91372900969897,
  }),
  Object.freeze({
    id: 'flower-7-0020-coprime-offset',
    name: 'Seven-petal flower (compact)',
    run: 2,
    gatePassed: false,
    rotation: 45.883146774112355,
    structuralSimplicity: 91.18880899993957,
  }),
  Object.freeze({
    id: 'pinwheel-c2-2-1100-cw',
    name: 'C2 twin pinwheel',
    run: 3,
    gatePassed: true,
    rotation: 79.47194142390262,
    structuralSimplicity: 92.28092947267801,
  }),
  Object.freeze({
    id: 'gap-ring-01-2-1-open',
    name: 'Open gap ring',
    run: 3,
    gatePassed: true,
    rotation: 52.98129428260175,
    structuralSimplicity: 84.51542547285166,
  }),
  Object.freeze({
    id: 'flower-7-1020-coprime-offset',
    name: 'Seven-petal flower (wide)',
    run: 3,
    gatePassed: true,
    rotation: 59.23488777590924,
    structuralSimplicity: 82.53857253110874,
  }),
  Object.freeze({
    id: 'swirl-c2-5-5-11-both',
    name: 'C2 face swirl',
    run: 3,
    gatePassed: true,
    rotation: 79.47194142390262,
    structuralSimplicity: 56.325320629094655,
  }),
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

function patternSource(target, candidate) {
  const gate = target.gatePassed ? '통과' : '탈락';
  const params = indentJson(candidate.params, 4);
  const masks = bitsToCellMasks(candidate.bits).join(', ');
  return `  // ${target.run}차 실행 · ${candidate.family} ${JSON.stringify(candidate.params)}
  // 중심 균형 게이트 ${gate} · [미검증] 회전 ${target.rotation.toFixed(2)} / 단순성 ${target.structuralSimplicity.toFixed(2)}
  definePattern({
    id: ${JSON.stringify(target.id)},
    name: ${JSON.stringify(target.name)},
    family: ${JSON.stringify(candidate.family)},
    sourceRun: ${target.run},
    params:
${params},
    centerBalanceGatePassed: ${target.gatePassed},
    scores: { rotation: ${target.rotation}, structuralSimplicity: ${target.structuralSimplicity} },
    cellMasks: [${masks}],
  })`;
}

export function renderFinderPatternsModule(candidates = generateFinderCandidates()) {
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

  return `// finder-patterns.js — 실물 비교용 중앙 19셀 파인더 후보 8개
//
// ⚠ tools/extract-finder-patterns.mjs 생성물. 직접 마스크를 고치지 말고 생성기를 갱신한 뒤
// 이 도구를 다시 실행한다. 좌표 순서는 hexgrid.regionCells(2), 면 비트는 T=1/L=2/R=4다.
// 이 후보들은 렌더 실험용이며 현행 동심원 디코더로 스캔되지 않는다.

import { FACES, regionCells } from './hexgrid.js';

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
