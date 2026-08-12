#!/usr/bin/env node

// finder-local-search.mjs — 사용자 손그림 파인더의 정확한 1..3면 국소 탐색
//
// 가중 종합점수는 쓰지 않는다. 회전이 씨앗보다 높고 나머지 5축이 모두 씨앗
// 이상이며 중심 게이트를 통과한 후보만 «비열화 개선»으로 분류한다. 그런 후보가
// 없으면 회전 상승안 중 타 축의 최악 하락폭이 가장 작은 절충안을 따로 표시한다.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  measureFinderPatternScores, parseFinderMaskCandidates, runHarness,
} from './finder-score.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'test', 'output', 'finder-local-search');
const FACE_COUNT = 19 * 3;
const EPSILON = 1e-10;

export const FINDER_SCORE_AXES = Object.freeze([
  'rotation', 'lowResolution', 'localization', 'dataDistinction',
  'structuralSimplicity', 'defectConcentration',
]);
const OTHER_AXES = Object.freeze(FINDER_SCORE_AXES.slice(1));

export const FINDER_LOCAL_SEARCH_SEEDS = Object.freeze({
  tristar: Object.freeze([0, 0, 1, 5, 2, 5, 0, 6, 3, 6, 3, 2, 0, 4, 0, 1, 2, 1, 4]),
  tree: Object.freeze([6, 7, 0, 3, 7, 4, 0, 5, 1, 0, 4, 1, 5, 2, 4, 7, 4, 6, 4]),
  cats: Object.freeze([5, 5, 7, 7, 2, 0, 5, 7, 5, 1, 7, 7, 1, 0, 6, 1, 7, 5, 6]),
  dandelion: Object.freeze([1, 0, 1, 0, 0, 4, 0, 2, 4, 2, 1, 2, 1, 1, 4, 0, 0, 2, 4]),
  northstar: Object.freeze([1, 4, 0, 0, 5, 0, 2, 2, 6, 3, 2, 0, 4, 0, 1, 1, 4, 0, 0]),
});

function bitsFromMasks(cellMasks) {
  const bits = new Uint8Array(FACE_COUNT);
  for (let cellIndex = 0; cellIndex < cellMasks.length; cellIndex += 1) {
    for (let faceIndex = 0; faceIndex < 3; faceIndex += 1) {
      bits[cellIndex * 3 + faceIndex] = (cellMasks[cellIndex] >> faceIndex) & 1;
    }
  }
  return bits;
}

function flipFaces(seed, faces) {
  const cellMasks = [...seed];
  for (const faceIndex of faces) {
    cellMasks[Math.floor(faceIndex / 3)] ^= 1 << (faceIndex % 3);
  }
  return cellMasks;
}

function* combinations(distance) {
  if (distance === 1) {
    for (let a = 0; a < FACE_COUNT; a += 1) yield [a];
    return;
  }
  if (distance === 2) {
    for (let a = 0; a < FACE_COUNT - 1; a += 1) {
      for (let b = a + 1; b < FACE_COUNT; b += 1) yield [a, b];
    }
    return;
  }
  if (distance === 3) {
    for (let a = 0; a < FACE_COUNT - 2; a += 1) {
      for (let b = a + 1; b < FACE_COUNT - 1; b += 1) {
        for (let c = b + 1; c < FACE_COUNT; c += 1) yield [a, b, c];
      }
    }
    return;
  }
  throw new RangeError('해밍 거리는 1..3이어야 한다: ' + distance);
}

function scoreDeltas(scores, baseline) {
  return Object.fromEntries(FINDER_SCORE_AXES.map((axis) => [axis, scores[axis] - baseline[axis]]));
}

function strictBetter(candidate, incumbent) {
  if (!incumbent) return true;
  for (const axis of [
    'rotation', 'localization', 'structuralSimplicity',
    'lowResolution', 'defectConcentration',
  ]) {
    const difference = candidate.scores[axis] - incumbent.scores[axis];
    if (Math.abs(difference) > EPSILON) return difference > 0;
  }
  if (Math.abs(candidate.centerOffsetCells - incumbent.centerOffsetCells) > EPSILON) {
    return candidate.centerOffsetCells < incumbent.centerOffsetCells;
  }
  return candidate.cellMasks.join(',') < incumbent.cellMasks.join(',');
}

function tradeoffBetter(candidate, incumbent) {
  if (!incumbent) return true;
  if (Math.abs(candidate.worstOtherDelta - incumbent.worstOtherDelta) > EPSILON) {
    return candidate.worstOtherDelta > incumbent.worstOtherDelta;
  }
  if (candidate.degradedAxes.length !== incumbent.degradedAxes.length) {
    return candidate.degradedAxes.length < incumbent.degradedAxes.length;
  }
  if (Math.abs(candidate.deltas.rotation - incumbent.deltas.rotation) > EPSILON) {
    return candidate.deltas.rotation > incumbent.deltas.rotation;
  }
  for (const axis of [
    'localization', 'structuralSimplicity', 'lowResolution', 'defectConcentration',
  ]) {
    const difference = candidate.deltas[axis] - incumbent.deltas[axis];
    if (Math.abs(difference) > EPSILON) return difference > 0;
  }
  return candidate.cellMasks.join(',') < incumbent.cellMasks.join(',');
}

function candidateRecord(measured, meta, baseline) {
  const deltas = scoreDeltas(measured.scores, baseline.scores);
  return {
    id: measured.id,
    distance: meta.distance,
    flippedFaces: meta.flippedFaces,
    cellMasks: meta.cellMasks,
    centerOffsetCells: measured.centerOffsetCells,
    centerBalanceGatePassed: measured.centerBalanceGatePassed,
    scores: measured.scores,
    deltas,
    worstOtherDelta: Math.min(...OTHER_AXES.map((axis) => deltas[axis])),
    degradedAxes: OTHER_AXES.filter((axis) => deltas[axis] < -EPSILON),
  };
}

async function searchDistance(seedId, seed, baseline, distance, batchSize) {
  const counts = {
    total: 0,
    zeroRotation: 0,
    centerGatePassed: 0,
    rotationImproved: 0,
    nonDegradingOtherAxes: 0,
    strictQualified: 0,
  };
  let strictBest = null;
  let tradeoffBest = null;
  let batch = [];
  let metadata = [];

  const flush = () => {
    if (batch.length === 0) return;
    const measured = measureFinderPatternScores(batch).candidates;
    for (let index = 0; index < measured.length; index += 1) {
      const result = measured[index];
      const meta = metadata[index];
      counts.total += 1;
      if (result.scores.rotation === 0) {
        counts.zeroRotation += 1;
        continue;
      }
      if (result.centerBalanceGatePassed) counts.centerGatePassed += 1;
      const rotationImproved = result.scores.rotation > baseline.scores.rotation + EPSILON;
      if (rotationImproved) counts.rotationImproved += 1;
      const otherAxesDidNotDrop = OTHER_AXES.every(
        (axis) => result.scores[axis] + EPSILON >= baseline.scores[axis],
      );
      if (otherAxesDidNotDrop) counts.nonDegradingOtherAxes += 1;
      if (!result.centerBalanceGatePassed || !rotationImproved) continue;

      const candidate = candidateRecord(result, meta, baseline);
      if (otherAxesDidNotDrop) {
        counts.strictQualified += 1;
        if (strictBetter(candidate, strictBest)) strictBest = candidate;
      }
      if (tradeoffBetter(candidate, tradeoffBest)) tradeoffBest = candidate;
    }
    batch = [];
    metadata = [];
  };

  for (const flippedFaces of combinations(distance)) {
    const cellMasks = flipFaces(seed, flippedFaces);
    const id = seedId + '-h' + distance + '-' + flippedFaces.join('_');
    batch.push({
      id,
      name: id,
      family: 'local-search',
      params: { seedId, distance, flippedFaces },
      bits: bitsFromMasks(cellMasks),
    });
    metadata.push({ distance, flippedFaces, cellMasks });
    if (batch.length >= batchSize) flush();
  }
  flush();

  return {
    ...counts,
    selection: strictBest ? 'strict-nondegrading' : 'tradeoff',
    best: strictBest || tradeoffBest,
    strictBest,
    tradeoffBest,
  };
}

export async function searchLocalFinderSeeds(options = {}) {
  const seeds = options.seeds || FINDER_LOCAL_SEARCH_SEEDS;
  const batchSize = options.batchSize === undefined ? 1000 : options.batchSize;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize는 양의 정수여야 한다: ' + batchSize);
  }
  const parsedSeeds = parseFinderMaskCandidates(seeds);
  const measuredSeeds = measureFinderPatternScores([...parsedSeeds]).candidates;
  const baselineById = new Map(measuredSeeds.map((entry) => [entry.id, entry]));
  const report = {
    meta: {
      axes: FINDER_SCORE_AXES,
      maximumHammingDistance: 3,
      totalCandidates: 0,
      selectionPolicy: 'gate pass; rotation above seed; other five axes at least seed',
      fallbackPolicy: 'maximize worst other-axis delta; then fewer degraded axes; then rotation',
      weightedCompositeUsed: false,
    },
    seeds: {},
  };

  for (const [seedId, frozenSeed] of Object.entries(seeds)) {
    const seed = [...frozenSeed];
    const baseline = baselineById.get(seedId);
    const distances = {};
    for (const distance of [1, 2, 3]) {
      distances[distance] = await searchDistance(seedId, seed, baseline, distance, batchSize);
      report.meta.totalCandidates += distances[distance].total;
      if (typeof options.onProgress === 'function') {
        options.onProgress({ seedId, distance, ...distances[distance] });
      }
    }
    report.seeds[seedId] = {
      seed: { cellMasks: seed, ...baseline },
      distances,
    };
  }
  return report;
}

function comparisonCandidates(report) {
  const candidates = [];
  for (const [seedId, result] of Object.entries(report.seeds)) {
    candidates.push({
      id: seedId + '-seed',
      name: seedId + ' seed',
      cellMasks: result.seed.cellMasks,
      params: { comparisonGroup: seedId, comparisonOrder: 0, comparisonLabel: 'seed' },
    });
    for (const distance of [1, 2, 3]) {
      const selected = result.distances[distance].best;
      candidates.push({
        id: seedId + '-h' + distance,
        name: seedId + ' h' + distance,
        cellMasks: selected.cellMasks,
        params: {
          comparisonGroup: seedId,
          comparisonOrder: distance,
          comparisonLabel: 'h' + distance,
        },
      });
    }
  }
  return parseFinderMaskCandidates(candidates);
}

export async function runLocalFinderSearch(options = {}) {
  const outputParent = options.outputParent || DEFAULT_OUTPUT;
  const report = await searchLocalFinderSeeds(options);
  const harness = await runHarness({
    outputParent,
    maskCandidates: comparisonCandidates(report),
  });
  const reportPath = path.join(harness.meta.outputDir, 'local-search.json');
  await fs.writeFile(reportPath, JSON.stringify({ ...report, harness: harness.meta }, null, 2) + '\n', 'utf8');
  return { report, harness, reportPath };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') {
      if (argv[index + 1] === undefined) throw new RangeError('--output 뒤에 경로가 필요하다');
      options.outputParent = path.resolve(argv[++index]);
    } else if (argv[index] === '--help' || argv[index] === '-h') {
      options.help = true;
    } else {
      throw new RangeError('알 수 없는 인자: ' + argv[index]);
    }
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log('사용법: node tools/finder-local-search.mjs [--output DIR]');
    } else {
      const result = await runLocalFinderSearch({
        ...options,
        onProgress(progress) {
          console.error(
            progress.seedId + ' h' + progress.distance
            + ': ' + progress.total + '개, 회전 0=' + progress.zeroRotation
            + ', 비열화=' + progress.strictQualified,
          );
        },
      });
      console.log(JSON.stringify({
        outputDir: result.harness.meta.outputDir,
        report: result.reportPath,
        candidates: result.report.meta.totalCandidates,
      }, null, 2));
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
