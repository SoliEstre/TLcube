/**
 * corner-qr-assist.js — 코너 QR 삼중점에서 스캔 안내용 코드 위치를 보수적으로 찾는다.
 *
 * 이 모듈의 결과는 복호 가설이 아니다. 4코너 × 3실루엣 중 영상의 실제 셀 표면이
 * 한 위치를 충분히 강하게 지지할 때만 안내 좌표를 내고, 그렇지 않으면 `ok:false`로
 * 남는다. 틀린 위치를 가리키는 것보다 침묵하는 쪽이 계약이다.
 */

import { cellSampleDiscs, regionCells } from '../hexgrid.js';
import { regionCellsA } from '../placementA.js';
import { regionCellsK } from '../placementK.js';
import {
  enumerateCornerQrSeeds,
  qrRightAngleAxes,
} from './corner-qr-seed.js';

const SQRT3 = Math.sqrt(3);

export const CORNER_QR_ASSIST_THRESHOLDS = Object.freeze({
  // 성공 포즈 정답지에서 0.065까지 중심 오차 <= 4셀·cell 오차 <= 20%였다.
  // 0.070에서는 중심 오차가 6.65셀로 뛰므로 그 전에서 닫는다.
  geometryResidualMax: 0.065,
  supportScoreMin: 0.7,
  supportRatioMin: 1.3,
  visibleCellFractionMin: 0.9,
  distinctLocationCells: 3,
  maximumFinderCandidates: 4,
});

export const CORNER_QR_ASSIST_PROFILES = Object.freeze([
  Object.freeze({
    id: 'hex',
    cells: Object.freeze(regionCells(8)),
    centerOffsetModules: Object.freeze({ x: 17 + 2 * SQRT3 * 8.5, y: 19 + 3 * 8 }),
    cellSizePerQrModule: 2,
  }),
  Object.freeze({
    id: 'tri',
    cells: Object.freeze(regionCellsA(6)),
    centerOffsetModules: Object.freeze({ x: 17 + 2 * SQRT3 * 6.5, y: 19 + 3 * 6 }),
    cellSizePerQrModule: 2,
  }),
  Object.freeze({
    id: 'star',
    cells: Object.freeze(regionCellsK(6)),
    centerOffsetModules: Object.freeze({ x: 17 + 2 * SQRT3 * 6.5, y: 19 + 3 * 6 }),
    cellSizePerQrModule: 2,
  }),
]);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function quantile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))];
}

function sample(luma, x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= luma.width || iy >= luma.height) return null;
  const value = luma.data[iy * luma.width + ix];
  return Number.isFinite(value) ? value : null;
}

/** QR v1 파인더 간격·직각·모듈 일치의 무차원 잔차. 0이 이상적이다. */
export function cornerQrGeometryResidual(candidate) {
  if (!candidate || !(candidate.module > 0)
    || !candidate.shared || !candidate.axisA || !candidate.axisB) return Infinity;
  const legA = Math.hypot(
    candidate.axisA.x - candidate.shared.x,
    candidate.axisA.y - candidate.shared.y,
  );
  const legB = Math.hypot(
    candidate.axisB.x - candidate.shared.x,
    candidate.axisB.y - candidate.shared.y,
  );
  const modules = [candidate.shared.module, candidate.axisA.module, candidate.axisB.module];
  if (!modules.every((value) => value > 0 && Number.isFinite(value))) return Infinity;
  const spacing = Math.max(
    Math.abs(legA / candidate.module - 14),
    Math.abs(legB / candidate.module - 14),
  ) / 14;
  const balance = Math.abs(legA - legB) / Math.max(legA, legB);
  const moduleRatio = Math.max(...modules) / Math.min(...modules);
  const cosine = Number.isFinite(candidate.cosine)
    ? Math.abs(candidate.cosine)
    : Math.abs(((candidate.axisA.x - candidate.shared.x)
      * (candidate.axisB.x - candidate.shared.x)
      + (candidate.axisA.y - candidate.shared.y)
      * (candidate.axisB.y - candidate.shared.y)) / (legA * legB));
  return spacing + balance + cosine + 0.25 * (moduleRatio - 1);
}

function silhouetteSupport(luma, candidate, seed, profile, swapAxes, threshold) {
  const axes = qrRightAngleAxes(candidate);
  if (!axes) return null;
  const horizontal = swapAxes ? axes.v : axes.u;
  const vertical = swapAxes ? axes.u : axes.v;
  // 렌더 계약: QR 1 module = 바깥 코드 0.5 cell.
  const ux = 2 * horizontal.x;
  const uy = 2 * horizontal.y;
  const vx = 2 * vertical.x;
  const vy = 2 * vertical.y;
  const ranges = [];
  const gradients = [];
  let visibleCells = 0;

  for (const cell of profile.cells) {
    const discs = cellSampleDiscs(
      cell.q,
      cell.r,
      { size: 1, originX: 0, originY: 0 },
    );
    const values = ['T', 'L', 'R'].map((face) => sample(
      luma,
      seed.center.x + discs[face].x * ux + discs[face].y * vx,
      seed.center.y + discs[face].x * uy + discs[face].y * vy,
    ));
    if (!values.every(Number.isFinite)) continue;
    visibleCells += 1;
    ranges.push(Math.max(...values) - Math.min(...values));
    gradients.push(
      Math.abs(values[0] - values[1]),
      Math.abs(values[0] - values[2]),
      Math.abs(values[1] - values[2]),
    );
  }

  const visibleFraction = visibleCells / profile.cells.length;
  if (visibleFraction < threshold.visibleCellFractionMin) return null;
  const rangeP25 = quantile(ranges, 0.25);
  const rangeP50 = quantile(ranges, 0.5);
  const gradientP50 = quantile(gradients, 0.5);
  return {
    score: rangeP25 + rangeP50 + gradientP50,
    rangeP25,
    rangeP50,
    gradientP50,
    visibleFraction,
    swapAxes,
  };
}

function unknown(reason, detail = {}) {
  return {
    ok: false,
    source: 'corner-qr-scan-assist',
    reason,
    confidence: { level: 'none', score: 0 },
    ambiguity: {
      location: reason === 'ambiguous-location',
      ...detail,
    },
  };
}

function guideFor(luma, center, cellPx) {
  return {
    normalizedCenter: { x: center.x / luma.width, y: center.y / luma.height },
    radiusPx: Math.max(16, cellPx * 3),
  };
}

/**
 * QR 삼중점 후보와 LumaField에서 스캔 안내용 위치를 추정한다.
 *
 * `ok:true`만 화면 안내에 써도 된다. `ok:false`는 후보가 없다는 뜻뿐 아니라 12가설을
 * 안전하게 하나의 위치로 좁히지 못했다는 뜻도 포함한다.
 */
export function localizeCornerQrAssist(luma, finderCandidates, options = {}) {
  if (!luma || !Number.isInteger(luma.width) || !Number.isInteger(luma.height)
    || !luma.data || luma.data.length !== luma.width * luma.height) {
    return unknown('invalid-luma');
  }
  if (!Array.isArray(finderCandidates) || finderCandidates.length === 0) {
    return unknown('no-finder');
  }
  const threshold = { ...CORNER_QR_ASSIST_THRESHOLDS, ...(options.thresholds || {}) };
  const ranked = finderCandidates.map((candidate, candidateIndex) => ({
    candidate,
    candidateIndex,
    residual: cornerQrGeometryResidual(candidate),
  })).filter((entry) => entry.candidate && entry.candidate.kind === 'center'
    && entry.candidate.kindAmbiguous !== true
    && Number.isFinite(entry.residual))
    .sort((left, right) => left.residual - right.residual
      || left.candidateIndex - right.candidateIndex);
  const eligible = ranked.filter((entry) => entry.residual <= threshold.geometryResidualMax)
    .slice(0, threshold.maximumFinderCandidates);

  const evidence = [];
  for (const entry of eligible) {
    const seeds = enumerateCornerQrSeeds([entry.candidate], CORNER_QR_ASSIST_PROFILES);
    for (const seed of seeds) {
      const profile = CORNER_QR_ASSIST_PROFILES.find((item) => item.id === seed.silhouette);
      for (const swapAxes of [false, true]) {
        const support = silhouetteSupport(
          luma, entry.candidate, seed, profile, swapAxes, threshold,
        );
        if (support) evidence.push({ ...entry, seed, support });
      }
    }
  }
  evidence.sort((left, right) => right.support.score - left.support.score
    || left.residual - right.residual
    || left.candidateIndex - right.candidateIndex);
  const best = evidence[0];
  if (best) {
    const runner = evidence.find((entry) => Math.hypot(
      entry.seed.center.x - best.seed.center.x,
      entry.seed.center.y - best.seed.center.y,
    ) > best.seed.cellSize * threshold.distinctLocationCells);
    // 차점 위치가 없으면 비율은 수학적으로 무한대지만 JSON에 안전한 null로 싣는다.
    const supportRatio = runner && runner.support.score > 0
      ? best.support.score / runner.support.score
      : null;
    if (best.support.score >= threshold.supportScoreMin
      && (supportRatio === null || supportRatio >= threshold.supportRatioMin)) {
      const colocated = evidence.filter((entry) => Math.hypot(
        entry.seed.center.x - best.seed.center.x,
        entry.seed.center.y - best.seed.center.y,
      ) <= best.seed.cellSize * 0.5
        && Math.abs(entry.seed.cellSize - best.seed.cellSize) <= best.seed.cellSize * 0.05);
      const silhouettes = [...new Set(colocated.map((entry) => entry.seed.silhouette))].sort();
      const corners = [...new Set(colocated.map((entry) => entry.seed.placement))].sort();
      const geometryConfidence = 1 - best.residual / threshold.geometryResidualMax;
      const supportConfidence = (supportRatio === null)
        ? 1 : (supportRatio - threshold.supportRatioMin) / threshold.supportRatioMin;
      const confidenceScore = clamp01(
        0.6 * geometryConfidence + 0.4 * clamp01(supportConfidence),
      );
      return {
        ok: true,
        source: 'corner-qr-scan-assist',
        evidenceMode: 'silhouette-support',
        center: { x: best.seed.center.x, y: best.seed.center.y },
        cellPx: best.seed.cellSize,
        silhouette: silhouettes.length === 1 ? silhouettes[0] : null,
        corner: corners.length === 1 ? corners[0] : null,
        assumptions: {
          silhouettes,
          corners,
          finderCandidateIndexes: [...new Set(colocated.map((entry) => entry.candidateIndex))],
        },
        confidence: {
          level: confidenceScore >= 0.65 ? 'high' : 'conservative',
          score: confidenceScore,
          geometryResidual: best.residual,
          supportScore: best.support.score,
          supportRatio,
        },
        ambiguity: {
          location: false,
          silhouette: silhouettes.length !== 1,
          corner: corners.length !== 1,
          colocatedHypothesisCount: colocated.length,
        },
        guide: guideFor(luma, best.seed.center, best.seed.cellSize),
      };
    }
  }

  if (eligible.length === 0) {
    return unknown('no-geometric-candidate', { candidateCount: finderCandidates.length });
  }
  if (evidence.length === 0) {
    return unknown('no-visible-hypothesis', { eligibleCandidateCount: eligible.length });
  }
  const runner = best && evidence.find((entry) => Math.hypot(
    entry.seed.center.x - best.seed.center.x,
    entry.seed.center.y - best.seed.center.y,
  ) > best.seed.cellSize * threshold.distinctLocationCells);
  const supportRatio = best && runner && runner.support.score > 0
    ? best.support.score / runner.support.score : null;
  return unknown('ambiguous-location', {
    candidateCount: finderCandidates.length,
    eligibleCandidateCount: eligible.length,
    supportScore: best ? best.support.score : null,
    supportRatio,
    runnerUpScore: runner ? runner.support.score : null,
  });
}
