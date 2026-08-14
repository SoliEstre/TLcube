/**
 * cellSurfaceY-detect.js — cell-surface-v1 61좌표 known-tone 점수.
 *
 * 기하 후보는 기존 Type Y 실루엣/Y-심이 만든다. 이 모듈은 그 격자 위에
 * 61좌표 dark/bright 표본을 읽어 profile·면 위상·방향을 점수로 남긴다.
 * 면 순환 3상의 agreement 차로 orientation margin 을 재고, 선언된
 * minimumOrientationMargin 을 hard gate 로 쓴다. 오방향은 이상적 일치율이
 * 78% 를 넘겨도 거부한다.
 *
 * 모든 임계값은 합성 실험용 [미검증]이며 options.calibration 으로 덮을 수 있다.
 */

import {
  CELL_SURFACE_N,
  CELL_SURFACE_PROFILE_ID,
  CELL_SURFACE_VERSION,
  formatIndexCellSurface,
  locatorCellsCellSurface,
} from '../cellSurfaceY.js';
import { YFACES } from '../ygrid.js';
import { FRONTEND_FAILURE, fail, ok } from './contracts.js';

export const UNVERIFIED_CELL_SURFACE_Y = Object.freeze({
  minimumAgreement: 0.78,
  minimumOrientationMargin: 0.035,
  minimumToneSpan: 0.012,
  minimumSamplesPerTone: 8,
  classifyMidFraction: 0.28,
});

const FACE_CYCLES = Object.freeze([
  Object.freeze(['T', 'L', 'R']),
  Object.freeze(['L', 'R', 'T']),
  Object.freeze(['R', 'T', 'L']),
]);

function cellKey(i, j) {
  return i + ',' + j;
}

function remappedLocators(cycle) {
  return locatorCellsCellSurface().map((cell) => ({
    i: cell.i,
    j: cell.j,
    T: cell[cycle[0]],
    L: cell[cycle[1]],
    R: cell[cycle[2]],
  }));
}

function calibration(options) {
  const supplied = options && options.calibration && typeof options.calibration === 'object'
    ? options.calibration
    : {};
  const overlay = supplied.cellSurfaceY && typeof supplied.cellSurfaceY === 'object'
    ? supplied.cellSurfaceY
    : {};
  return {
    ...UNVERIFIED_CELL_SURFACE_Y,
    ...overlay,
  };
}

function median(values) {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function classifyTone(value, dark, bright, midFraction) {
  if (!(bright > dark)) return -1;
  const span = bright - dark;
  const midLow = dark + span * (0.5 - midFraction / 2);
  const midHigh = dark + span * (0.5 + midFraction / 2);
  if (value <= midLow) return 0;
  if (value >= midHigh) return 2;
  return 1;
}

function scoreMappedSamples(samples, cfg, locators) {
  const darkByFace = { T: [], L: [], R: [] };
  const brightByFace = { T: [], L: [], R: [] };
  const table = locators || locatorCellsCellSurface();

  for (let index = 0; index < table.length; index += 1) {
    const expected = table[index];
    const sample = samples[index];
    if (!sample || sample.ok === false) continue;
    for (const face of YFACES) {
      const tone = expected[face];
      const value = sample[face] && sample[face].median;
      if (!Number.isFinite(value)) continue;
      if (tone === 0) darkByFace[face].push(value);
      else if (tone === 2) brightByFace[face].push(value);
    }
  }

  const anchors = {};
  let minimumSpan = Infinity;
  const sampleCounts = {};
  for (const face of YFACES) {
    const dark = median(darkByFace[face]);
    const bright = median(brightByFace[face]);
    const span = bright - dark;
    anchors[face] = { dark, bright, span };
    sampleCounts[face] = {
      dark: darkByFace[face].length,
      bright: brightByFace[face].length,
    };
    if (Number.isFinite(span)) minimumSpan = Math.min(minimumSpan, span);
  }

  let matches = 0;
  let total = 0;
  const faceMatches = { T: 0, L: 0, R: 0 };
  const faceTotal = { T: 0, L: 0, R: 0 };
  const observations = [];

  for (let index = 0; index < table.length; index += 1) {
    const expected = table[index];
    const sample = samples[index];
    if (!sample || sample.ok === false) continue;
    for (const face of YFACES) {
      const value = sample[face] && sample[face].median;
      if (!Number.isFinite(value)) continue;
      const observed = classifyTone(
        value,
        anchors[face].dark,
        anchors[face].bright,
        cfg.classifyMidFraction,
      );
      const want = expected[face];
      const matched = observed === want;
      total += 1;
      faceTotal[face] += 1;
      if (matched) {
        matches += 1;
        faceMatches[face] += 1;
      }
      observations.push({
        key: cellKey(expected.i, expected.j),
        face,
        expected: want,
        observed,
        matched,
      });
    }
  }

  const agreement = total > 0 ? matches / total : 0;
  const enoughSamples = YFACES.every((face) =>
    sampleCounts[face].dark >= cfg.minimumSamplesPerTone
    && sampleCounts[face].bright >= cfg.minimumSamplesPerTone);
  const toneSeparation = Number.isFinite(minimumSpan) && minimumSpan >= cfg.minimumToneSpan;
  const accepted = enoughSamples && toneSeparation && agreement >= cfg.minimumAgreement;

  const levelAnchors = {};
  for (const face of YFACES) {
    const dark = anchors[face].dark;
    const bright = anchors[face].bright;
    const mid = Number.isFinite(dark) && Number.isFinite(bright)
      ? (dark + bright) / 2
      : NaN;
    levelAnchors[face] = [dark, mid, bright];
  }

  return {
    agreement,
    matches,
    total,
    minimumSpan,
    enoughSamples,
    toneSeparation,
    accepted,
    sampleCounts,
    faceAgreement: Object.fromEntries(
      YFACES.map((face) => [
        face,
        faceTotal[face] > 0 ? faceMatches[face] / faceTotal[face] : 0,
      ]),
    ),
    anchors,
    levelAnchors,
    observations,
  };
}

/**
 * 이미 샘플된 61셀에 대해 3개 면 위상을 점수화한다.
 */
export function scoreCellSurfaceSamples(samples, options = {}) {
  const cfg = calibration(options);
  if (!Array.isArray(samples) || samples.length !== locatorCellsCellSurface().length) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'cell-surface',
      cause: 'sample-count',
      count: samples && samples.length,
    });
  }

  const phases = FACE_CYCLES.map((cycle, phase) => ({
    phase,
    cycle,
    ...scoreMappedSamples(samples, cfg, remappedLocators(cycle)),
  }));
  const ranked = phases.slice().sort((left, right) =>
    right.agreement - left.agreement || left.phase - right.phase);
  const claimed = phases[0];
  const rival = ranked.find((entry) => entry.phase !== 0) || ranked[1];
  const orientationMargin = claimed.agreement - (rival ? rival.agreement : 0);
  const orientationOk = ranked[0].phase === 0
    && orientationMargin >= cfg.minimumOrientationMargin;
  const accepted = claimed.accepted && orientationOk;
  let rejectReason = null;
  if (!accepted) {
    if (!claimed.enoughSamples) rejectReason = 'sample-count';
    else if (!claimed.toneSeparation) rejectReason = 'tone-separation';
    else if (claimed.agreement < cfg.minimumAgreement) rejectReason = 'below-agreement';
    else if (!orientationOk) rejectReason = 'orientation-margin';
    else rejectReason = 'rejected';
  }
  const best = { ...claimed, accepted };

  return ok({
    accepted,
    best,
    phases,
    orientationMargin,
    diagnostics: {
      profile: CELL_SURFACE_PROFILE_ID,
      accepted,
      agreement: claimed.agreement,
      orientationMargin,
      phase: 0,
      cycle: claimed.cycle,
      rivalPhase: rival ? rival.phase : null,
      rivalAgreement: rival ? rival.agreement : 0,
      rejectReason,
      sampleCounts: claimed.sampleCounts,
      faceAgreement: claimed.faceAgreement,
      minimumSpan: claimed.minimumSpan,
      enoughSamples: claimed.enoughSamples,
      toneSeparation: claimed.toneSeparation,
    },
  });
}

function calibrationForTones(best, scored, tones) {
  const shared = {
    agreement: best.matches,
    total: best.total,
    agreementRate: best.agreement,
    minimumSpan: best.minimumSpan,
    medianMargin: scored.orientationMargin,
    observations: best.observations,
    hardChecks: {
      toneSeparation: best.toneSeparation,
      referenceAgreement: best.accepted,
      all: scored.accepted,
    },
    source: CELL_SURFACE_PROFILE_ID,
  };
  if (tones === 2) {
    const thresholds = {};
    for (const face of YFACES) {
      const dark = best.anchors[face].dark;
      const bright = best.anchors[face].bright;
      thresholds[face] = dark > 0 && bright > 0
        ? Math.sqrt(dark * bright)
        : (dark + bright) / 2;
    }
    return {
      tones: 2,
      thresholds,
      anchors: best.anchors,
      ...shared,
    };
  }
  return {
    tones: 3,
    levelAnchors: best.levelAnchors,
    anchors: best.anchors,
    ...shared,
  };
}

function hypothesisPatchForTones(best, scored, samples, tones) {
  return {
    cellSurface: true,
    locatorProfile: CELL_SURFACE_PROFILE_ID,
    locatorRoute: 'cell-surface',
    source: 'locator-cell-surface-v1',
    version: CELL_SURFACE_VERSION,
    tones,
    formatIndex: formatIndexCellSurface(tones),
    n: CELL_SURFACE_N,
    k: CELL_SURFACE_N,
    facePhase: best.phase,
    faceCycle: best.cycle,
    cellSurfaceScore: best.agreement,
    orientationMargin: scored.orientationMargin,
    referenceCalibration: calibrationForTones(best, scored, tones),
    referenceSamples: new Map(samples.map((sample) => [cellKey(sample.i, sample.j), sample])),
    referenceAgreement: best.agreement,
    referenceRefinement: {
      dx: 0,
      dy: 0,
      quality: 100 * best.agreement,
    },
    cellSurfaceDiagnostics: scored.diagnostics,
  };
}

/**
 * 기하 가설 하나에 61좌표를 샘플하고 점수를 붙인다.
 * sampleCell(i,j) 는 cube-detect.sampleCubeCell 과 같은 모양을 돌려야 한다.
 * locator 는 dark/bright 만 쓰며, 2톤·3톤 데이터 가설을 둘 다 만든다.
 */
export function evaluateCellSurfaceGeometry(hypothesis, sampleCell, options = {}) {
  if (!hypothesis || hypothesis.n !== CELL_SURFACE_N) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'cell-surface',
      cause: 'unsupported-n',
      n: hypothesis && hypothesis.n,
    });
  }

  const samples = [];
  for (const cell of locatorCellsCellSurface()) {
    const sampled = sampleCell(cell.i, cell.j);
    if (!sampled || sampled.ok === false) {
      return fail(sampled && sampled.reason ? sampled.reason : FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
        stage: 'cell-surface-sampling',
        cell,
        cause: sampled && sampled.detail,
      });
    }
    samples.push(sampled);
  }

  const scored = scoreCellSurfaceSamples(samples, options);
  if (!scored.ok) return scored;

  const best = scored.best;
  const hypothesisPatches = [2, 3].map((tones) =>
    hypothesisPatchForTones(best, scored, samples, tones));

  return ok({
    accepted: scored.accepted,
    samples,
    scored,
    hypothesisPatches,
    hypothesisPatch: hypothesisPatches[1],
    diagnostics: scored.diagnostics,
  });
}

export function cellSurfaceSourceId() {
  return 'locator-cell-surface-v1';
}
