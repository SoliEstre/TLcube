#!/usr/bin/env node

// 생성 후보 8개와 손그림 국소 개선안 3개를 게이트 적용 전에 찾아
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

import {
  generateFinderCandidates,
  measureCubeBullseyePatternScore,
  measureFinderPatternScores,
  measureThreeToneCubePatternScore,
} from './finder-score.mjs';
import { HYBRID_INNER_CUBE_BANDS } from '../src/bullseye.js';

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
  }),
  Object.freeze({
    id: "tristar-refined-h3",
    name: "Refined tristar",
    run: 4,
    sourceLabel: "국소 탐색 · tristar h3",
    gatePassed: true,
    centerOffsetCells: 0.2508488988774462,
    scores: Object.freeze({"rotation":77.2328445721233,"lowResolution":92.71851740803673,"localization":20.86677705125009,"dataDistinction":100,"structuralSimplicity":61.05139414683933,"defectConcentration":12.74765297802717}),
    cellMasks: Object.freeze([0, 0, 1, 5, 2, 5, 0, 6, 1, 6, 3, 2, 0, 4, 0, 1, 3, 3, 4]),
    params: Object.freeze({ sourceSeed: "tristar", hammingDistance: 3, flippedFaces: Object.freeze([25, 48, 52]) }),
  }),
  Object.freeze({
    id: "tree-refined-h3",
    name: "Refined tree",
    run: 4,
    sourceLabel: "국소 탐색 · tree h3",
    gatePassed: true,
    centerOffsetCells: 0.19736928613257246,
    scores: Object.freeze({"rotation":77.2328445721233,"lowResolution":93.1591076237279,"localization":20.200631706634137,"dataDistinction":100,"structuralSimplicity":62.28488025177328,"defectConcentration":12.600900066186604}),
    cellMasks: Object.freeze([6, 5, 0, 3, 7, 4, 0, 5, 5, 0, 4, 1, 1, 2, 4, 7, 4, 6, 4]),
    params: Object.freeze({ sourceSeed: "tree", hammingDistance: 3, flippedFaces: Object.freeze([4, 26, 38]) }),
  }),
  Object.freeze({
    id: "cats-refined-h3",
    name: "Refined cats",
    run: 4,
    sourceLabel: "국소 탐색 · cats h3",
    gatePassed: true,
    centerOffsetCells: 0.14309504001254023,
    scores: Object.freeze({"rotation":74.92686492653552,"lowResolution":93.81394930841353,"localization":18.614131155703078,"dataDistinction":100,"structuralSimplicity":70.9594987568394,"defectConcentration":14.144181028565711}),
    cellMasks: Object.freeze([5, 5, 7, 7, 2, 0, 1, 7, 7, 1, 7, 5, 1, 0, 6, 1, 7, 5, 6]),
    params: Object.freeze({ sourceSeed: "cats", hammingDistance: 3, flippedFaces: Object.freeze([20, 25, 34]) }),

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

const THREE_TONE_CUBE = Object.freeze({
  id: 'central-cube-3tone',
  name: 'Maximum three-tone cube',
  family: 'three-tone-cube',
  sourceRun: 5,
  renderKind: 'three-tone-cube',
  radiusCells: 3.5,
  slotRadiusCells: 4,
  palette: 'data-levels',
  toneRanks: Object.freeze({ T: 2, L: 1, R: 0 }),
});

/*
 * 하이브리드 — 바깥 불스아이 링(위치·스케일) + 안쪽 3톤 큐브(방향).
 *
 * 기하는 전부 `bullseye.js` 의 HYBRID_INNER_CUBE_BANDS 에서 유도되므로 여기엔 반지름
 * 상수를 두지 않는다. toneRanks 는 순수 큐브와 같은 값을 쓴다 — 두 파인더가 같은 방향
 * 규약(T=밝음/L=중간/R=어두움)을 공유해야 디코더의 방향 읽기를 한 벌만 유지한다.
 */
const CUBE_BULLSEYE = Object.freeze({
  id: 'cube-bullseye',
  name: 'Cube in bullseye',
  family: 'cube-bullseye',
  sourceRun: 6,
  renderKind: 'cube-bullseye',
  toneRanks: THREE_TONE_CUBE.toneRanks,
});

export const SELECTED_FINDER_IDS = Object.freeze([
  ...TARGETS.map((target) => target.id),
  THREE_TONE_CUBE.id,
  CUBE_BULLSEYE.id,
]);


function cellMasksToBits(cellMasks) {
  const bits = new Uint8Array(19 * 3);
  for (let cellIndex = 0; cellIndex < cellMasks.length; cellIndex += 1) {
    for (let faceIndex = 0; faceIndex < 3; faceIndex += 1) {
      bits[cellIndex * 3 + faceIndex] = (cellMasks[cellIndex] >> faceIndex) & 1;
    }
  }
  return bits;
}
function localSearchCandidates() {
  return TARGETS.filter((target) => target.cellMasks).map((target) => Object.freeze({
    id: target.id,
    name: target.name,
    family: 'user-refined',
    params: target.params,
    bits: cellMasksToBits(target.cellMasks),
  }));
}
export function generateSelectedFinderCandidates() {
  return Object.freeze([...generateFinderCandidates(), ...localSearchCandidates()]);
}

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
  return `  // ${target.sourceLabel || target.run + '차 실행'} · ${candidate.family} ${JSON.stringify(candidate.params)}
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

function threeTonePatternSource(pattern, measured) {
  return `  // Type Y 실루엣/Y 심/투영기하 재사용 · T/L/R = 밝음/중간/어두움
  // 회전 점수 ${measured.scores.rotation.toFixed(4)} · 19셀 슬롯 안 최대 반지름 ${pattern.radiusCells}c
  definePattern({
    id: ${JSON.stringify(pattern.id)},
    name: ${JSON.stringify(pattern.name)},
    family: ${JSON.stringify(pattern.family)},
    sourceRun: ${pattern.sourceRun},
    renderKind: ${JSON.stringify(pattern.renderKind)},
    params: {
      detector: 'cube-silhouette-y-junction',
      palette: ${JSON.stringify(pattern.palette)},
      faceOrder: 'T-bright-L-mid-R-dark',
    },
    centerBalanceGatePassed: ${measured.centerBalance.passed},
    centerOffsetCells: ${measured.centerBalance.offsetCells},
    scores: ${scoreSource(measured.scores)},
    radiusCells: ${pattern.radiusCells},
    slotRadiusCells: ${pattern.slotRadiusCells},
    toneRanks: ${JSON.stringify(pattern.toneRanks)},
  })`;
}

function cubeBullseyePatternSource(pattern, measured) {
  return `  // 하이브리드 · 링에서 위치·스케일, 큐브에서 방향 · 기하는 bullseye.js 에서 유도
  // 회전 점수 ${measured.scores.rotation.toFixed(4)} · 큐브 반지름 = 안쪽 ${HYBRID_INNER_CUBE_BANDS}밴드 폭
  definePattern({
    id: ${JSON.stringify(pattern.id)},
    name: ${JSON.stringify(pattern.name)},
    family: ${JSON.stringify(pattern.family)},
    sourceRun: ${pattern.sourceRun},
    renderKind: ${JSON.stringify(pattern.renderKind)},
    params: {
      detector: 'bullseye-ring-plus-three-tone-rank',
      palette: 'finder-cube-tones',
      faceOrder: 'T-bright-L-mid-R-dark',
      innerCubeBands: ${HYBRID_INNER_CUBE_BANDS},
    },
    centerBalanceGatePassed: ${measured.centerBalance.passed},
    centerOffsetCells: ${measured.centerBalance.offsetCells},
    scores: ${scoreSource(measured.scores)},
    toneRanks: ${JSON.stringify(pattern.toneRanks)},
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
export function renderFinderPatternsModule(candidates = generateSelectedFinderCandidates()) {
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
  const threeToneMeasured = measureThreeToneCubePatternScore(THREE_TONE_CUBE.toneRanks, {
    radiusCells: THREE_TONE_CUBE.radiusCells,
  });
  const threeToneEntry = threeTonePatternSource(THREE_TONE_CUBE, threeToneMeasured);
  const cubeBullseyeMeasured = measureCubeBullseyePatternScore(CUBE_BULLSEYE.toneRanks, {
    id: CUBE_BULLSEYE.id,
    name: CUBE_BULLSEYE.name,
  });
  const cubeBullseyeEntry = cubeBullseyePatternSource(CUBE_BULLSEYE, cubeBullseyeMeasured);
  const baselineEntries = BASELINES.map(baselineSource).join(',\n');

  return `// finder-patterns.js — 중앙 19셀 슬롯 파인더 후보 12개
//
// ⚠ tools/extract-finder-patterns.mjs 생성물. 직접 마스크를 고치지 말고 생성기를 갱신한 뒤
// 이 도구를 다시 실행한다. 좌표 순서는 hexgrid.regionCells(2), 면 비트는 T=1/L=2/R=4다.
// 이진 11개는 마스크 공용 디코더가, 3톤 중앙 큐브 1개는 Type Y 검출 경로가 읽는다.

import { FACES, regionCells } from './hexgrid.js';

export const LEGACY_FINDER_PATTERN_ID = 'bullseye';
// ⚠ 여기는 **라이브러리 기본값** 이다 — finderPatternId 를 안 준 buildScene 이 받는 값이고
// 임베더가 그대로 받는다. «생성기 화면의 초기 선택» 은 별개이며 generator-state.js 가
// 정한다(2026-08-13 하이브리드로 바꾼 것은 그쪽이다). 둘을 섞으면 불스아이 렌더 계약을
// 고정한 테스트 30건이 한꺼번에 깨진다.
export const DEFAULT_FINDER_PATTERN_ID = 'bullseye';
export const FINDER_FACE_BITS = Object.freeze({ T: 1, L: 2, R: 4 });
export const THREE_TONE_CUBE_FINDER_PATTERN_ID = ${JSON.stringify(THREE_TONE_CUBE.id)};
export const CUBE_BULLSEYE_FINDER_PATTERN_ID = ${JSON.stringify(CUBE_BULLSEYE.id)};
export const FINDER_CUBE_RADIUS_CELLS = ${THREE_TONE_CUBE.radiusCells};
export const FINDER_CUBE_SLOT_RADIUS_CELLS = ${THREE_TONE_CUBE.slotRadiusCells};
export const FINDER_CUBE_FACE_RANKS = Object.freeze(
  ${JSON.stringify(THREE_TONE_CUBE.toneRanks)},
);
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
  const renderKind = pattern.renderKind || 'cell-mask';
  const common = {
    ...pattern,
    renderKind,
    params: Object.freeze({ ...pattern.params }),
    scores: Object.freeze({ ...pattern.scores }),
  };
  if (renderKind === 'cell-mask') {
    if (!Array.isArray(pattern.cellMasks) || pattern.cellMasks.length !== FINDER_CELL_ORDER.length) {
      throw new RangeError(pattern.id + ': cellMasks 는 19개여야 한다');
    }
    for (const mask of pattern.cellMasks) {
      if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
        throw new RangeError(pattern.id + ': 면 마스크 범위 오류 ' + mask);
      }
    }
    return Object.freeze({
      ...common,
      cellMasks: Object.freeze([...pattern.cellMasks]),
    });
  }
  if (renderKind !== 'three-tone-cube' && renderKind !== 'cube-bullseye') {
    throw new RangeError(pattern.id + ': 알 수 없는 renderKind ' + renderKind);
  }
  const ranks = FACES.map((face) => pattern.toneRanks && pattern.toneRanks[face]);
  if (ranks.slice().sort().join(',') !== '0,1,2') {
    throw new RangeError(pattern.id + ': toneRanks 는 0/1/2 순열이어야 한다');
  }
  // 하이브리드의 반지름은 bullseye.js 의 밴드 격자에서 유도된다 — 여기 상수를 두면
  // 두 곳이 갈라질 수 있으므로 radiusCells 를 요구하지 않는다.
  if (renderKind === 'three-tone-cube'
    && (!Number.isFinite(pattern.radiusCells) || pattern.radiusCells <= 0)) {
    throw new RangeError(pattern.id + ': radiusCells 는 양수여야 한다');
  }
  return Object.freeze({
    ...common,
    toneRanks: Object.freeze({ ...pattern.toneRanks }),
  });
}

export const FINDER_PATTERNS = Object.freeze([
  // 첫 8개는 기존 4계열×2행, 다음 3개는 사용자 손그림 개선안,
  // 그 다음이 3톤 큐브, 마지막이 하이브리드(링+큐브)다.
${entries},

${threeToneEntry},

${cubeBullseyeEntry}
]);

export const FINDER_CELL_MASK_PATTERNS = Object.freeze(
  FINDER_PATTERNS.filter((pattern) => pattern.renderKind === 'cell-mask'),
);
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
