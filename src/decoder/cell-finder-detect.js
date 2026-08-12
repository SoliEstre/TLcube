/**
 * cell-finder-detect.js — 중앙 19셀 파인더의 공용 격자 정합 검출기.
 *
 * 후보마다 검출 코드를 만들지 않는다. 입력은 finder-patterns.js의 cellMasks이고,
 * 모든 후보를 같은 기하 가설에서 한 번 표본화한 뒤 정규화 상관으로 함께 비교한다.
 * 반환 H와 120/240도 방향 여유는 파인더 자체에서 나오며 앵커를 쓰지 않는다.
 */
import {
  FINDER_CELL_ORDER, FINDER_FACE_BITS, FINDER_CELL_MASK_PATTERNS,
} from '../finder-patterns.js';
import { FACES, faceCentroid, facePolygon } from '../hexgrid.js';
import { robustPercentiles } from './luma.js';
import { FRONTEND_FAILURE, assertLumaField, fail, ok } from './contracts.js';

export const UNVERIFIED_CELL_FINDER_CALIBRATION = Object.freeze({
  minCellSize: 2.25,
  maxCellSizeFraction: 1 / 9,
  scaleRatio: 1.28,
  coarseAngleStepDegrees: 15,
  varianceWindowRadiusCells: 4.1,
  varianceStepCells: 0.65,
  varianceCentersPerScale: 0,
  maxCoarseCandidates: 8,
  maxRefinedCandidates: 1,
  maxOutputCandidates: 2,
  minCorrelation: 0.56,
  minContrastRatio: 0.24,
  minOrientationMargin: 0.035,
});

const REFINED_FACE_FRACTIONS = Object.freeze([0.10, 0.90]);
const TURN_RADIANS = 2 * Math.PI / 3;
const EPSILON = 1e-12;
const FACE_SAMPLES = Object.freeze(FINDER_CELL_ORDER.flatMap((cell, cellIndex) =>
  FACES.map((face) => {
    const layout = { size: 1, originX: 0, originY: 0 };
    const point = faceCentroid(cell.q, cell.r, face, layout);
    const polygon = facePolygon(cell.q, cell.r, face, layout);
    const origin = polygon[0];
    const uVector = { x: polygon[1].x - origin.x, y: polygon[1].y - origin.y };
    const vVector = { x: polygon[3].x - origin.x, y: polygon[3].y - origin.y };
    const detailPoints = REFINED_FACE_FRACTIONS.flatMap((u) =>
      REFINED_FACE_FRACTIONS.map((v) => Object.freeze({
        x: origin.x + u * uVector.x + v * vVector.x,
        y: origin.y + u * uVector.y + v * vVector.y,
      })));
    return Object.freeze({
      cellIndex, face, bit: FINDER_FACE_BITS[face], x: point.x, y: point.y,
      detailPoints: Object.freeze(detailPoints),
    });
  })));

function clamp01(value) { return value <= 0 ? 0 : value >= 1 ? 1 : value; }
function cfgFor(options) {
  return {
    ...UNVERIFIED_CELL_FINDER_CALIBRATION,
    ...(options && typeof options.calibration === 'object' ? options.calibration : {}),
  };
}
function assertMasks(cellMasks, label = 'cellMasks') {
  if (!Array.isArray(cellMasks) || cellMasks.length !== FINDER_CELL_ORDER.length) {
    throw new RangeError(label + '는 19개 마스크 배열이어야 한다');
  }
  for (const mask of cellMasks) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
      throw new RangeError(label + ' 면 마스크 범위 오류: ' + mask);
    }
  }
  return cellMasks;
}
function normalizePatterns(input, options) {
  const source = input === undefined ? FINDER_CELL_MASK_PATTERNS : input;
  if (Array.isArray(source) && source.length === 19 && source.every(Number.isInteger)) {
    return [{ id: options.patternId || 'cell-mask', cellMasks: assertMasks(source) }];
  }
  if (!Array.isArray(source) || source.length === 0) {
    throw new TypeError('patterns는 cellMasks 또는 패턴 객체 배열이어야 한다');
  }
  const cellPatterns = source.filter((pattern) => pattern && Array.isArray(pattern.cellMasks));
  if (cellPatterns.length === 0) {
    throw new TypeError('patterns에 이진 cellMasks 후보가 없다');
  }
  return cellPatterns.map((pattern, index) => ({
    ...pattern,
    id: typeof pattern.id === 'string' ? pattern.id : 'cell-mask-' + index,
    cellMasks: assertMasks(pattern.cellMasks, 'patterns[' + index + '].cellMasks'),
  }));
}
function centeredExpected(values) {
  const expected = Float64Array.from(values);
  let mean = 0;
  let lightCount = 0;
  for (const value of expected) {
    mean += value;
    lightCount += value;
  }
  mean /= expected.length;
  let norm2 = 0;
  for (let i = 0; i < expected.length; i += 1) {
    expected[i] -= mean;
    norm2 += expected[i] * expected[i];
  }
  if (!(norm2 > 0) || lightCount === 0 || lightCount === expected.length) return null;
  return {
    expected, expectedNorm: Math.sqrt(norm2),
    lightCount, darkCount: expected.length - lightCount,
  };
}
function templateOf(pattern) {
  const coarseValues = [];
  const detailedValues = [];
  for (const sample of FACE_SAMPLES) {
    const value = pattern.cellMasks[sample.cellIndex] & sample.bit ? 1 : 0;
    coarseValues.push(value);
    for (let i = 0; i < sample.detailPoints.length; i += 1) detailedValues.push(value);
  }
  const coarse = centeredExpected(coarseValues);
  const detailed = centeredExpected(detailedValues);
  if (!coarse || !detailed) {
    throw new RangeError(pattern.id + ': 밝음/어두움 양쪽 면이 필요하다');
  }
  return {
    id: pattern.id, pattern,
    ...coarse,
    detailedExpected: detailed.expected,
    detailedExpectedNorm: detailed.expectedNorm,
    detailedLightCount: detailed.lightCount,
    detailedDarkCount: detailed.darkCount,
  };
}
function bilinear(luma, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || y < 0 || x > luma.width - 1 || y > luma.height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(luma.width - 1, x0 + 1);
  const y1 = Math.min(luma.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = luma.data[y0 * luma.width + x0];
  const b = luma.data[y0 * luma.width + x1];
  const c = luma.data[y1 * luma.width + x0];
  const d = luma.data[y1 * luma.width + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
function project(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  if (!Number.isFinite(w) || Math.abs(w) <= EPSILON) return null;
  const px = (H[0] * x + H[1] * y + H[2]) / w;
  const py = (H[3] * x + H[4] * y + H[5]) / w;
  return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
}
function observationsAt(luma, H, detailed) {
  const sampleCount = detailed
    ? FACE_SAMPLES.reduce((sum, sample) => sum + sample.detailPoints.length, 0)
    : FACE_SAMPLES.length;
  const values = new Float64Array(sampleCount);
  let mean = 0;
  let index = 0;
  for (const canonical of FACE_SAMPLES) {
    const samplePoints = detailed ? canonical.detailPoints : [canonical];
    for (const samplePoint of samplePoints) {
      const point = project(H, samplePoint.x, samplePoint.y);
      if (!point) return null;
      const value = bilinear(luma, point.x, point.y);
      if (value === null) return null;
      values[index++] = value;
      mean += value;
    }
  }
  mean /= values.length;
  let norm2 = 0;
  for (const value of values) norm2 += (value - mean) ** 2;
  return norm2 > EPSILON ? { values, mean, norm: Math.sqrt(norm2), detailed } : null;
}
function scoreTemplate(sampled, template, span) {
  const expected = sampled.detailed ? template.detailedExpected : template.expected;
  const expectedNorm = sampled.detailed ? template.detailedExpectedNorm : template.expectedNorm;
  const lightCount = sampled.detailed ? template.detailedLightCount : template.lightCount;
  const darkCount = sampled.detailed ? template.detailedDarkCount : template.darkCount;
  let dot = 0;
  let lightSum = 0;
  let darkSum = 0;
  for (let i = 0; i < sampled.values.length; i += 1) {
    const observed = sampled.values[i];
    dot += (observed - sampled.mean) * expected[i];
    if (expected[i] > 0) lightSum += observed;
    else darkSum += observed;
  }
  const correlation = dot / (sampled.norm * expectedNorm);
  const lightMean = lightSum / lightCount;
  const darkMean = darkSum / darkCount;
  const contrast = lightMean - darkMean;
  const contrastRatio = contrast / Math.max(span, EPSILON);
  const fit = Math.max(0, correlation) * clamp01(contrastRatio / 0.45);
  return { correlation, contrast, contrastRatio, lightMean, darkMean, fit };
}
function scoreAll(luma, H, templates, span, detailed) {
  const sampled = observationsAt(luma, H, detailed);
  if (!sampled) return [];
  return templates.map((template) => ({ template, ...scoreTemplate(sampled, template, span) }))
    .sort((a, b) => b.fit - a.fit || b.correlation - a.correlation
      || a.template.id.localeCompare(b.template.id));
}
function scoreBest(luma, H, templates, span, detailed) {
  const sampled = observationsAt(luma, H, detailed);
  if (!sampled) return null;
  let best = null;
  for (const template of templates) {
    const scored = { template, ...scoreTemplate(sampled, template, span) };
    if (!best || scored.fit > best.fit
      || (scored.fit === best.fit && (scored.correlation > best.correlation
        || (scored.correlation === best.correlation
          && scored.template.id.localeCompare(best.template.id) < 0)))) best = scored;
  }
  return best;
}
function HFrom(params) {
  const scale = Math.exp(params.logScale);
  const c = Math.cos(params.rotation);
  const s = Math.sin(params.rotation);
  const sx = Math.exp(params.anisotropy);
  const sy = Math.exp(-params.anisotropy);
  const a00 = scale * (c * sx - s * params.shear);
  const a01 = scale * (c * params.shear - s * sy);
  const a10 = scale * (s * sx + c * params.shear);
  const a11 = scale * (s * params.shear + c * sy);
  const p = params.projectiveX;
  const q = params.projectiveY;
  return new Float64Array([
    a00 + params.centerX * p, a01 + params.centerX * q, params.centerX,
    a10 + params.centerY * p, a11 + params.centerY * q, params.centerY,
    p, q, 1,
  ]);
}
function multiply3(left, right) {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      for (let k = 0; k < 3; k += 1) out[row * 3 + col] += left[row * 3 + k] * right[k * 3 + col];
    }
  }
  return out;
}
function rotationH(radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return new Float64Array([c, -s, 0, s, c, 0, 0, 0, 1]);
}
function integralsOf(luma) {
  const stride = luma.width + 1;
  const sum = new Float64Array(stride * (luma.height + 1));
  const square = new Float64Array(sum.length);
  for (let y = 0; y < luma.height; y += 1) {
    let rs = 0;
    let rq = 0;
    for (let x = 0; x < luma.width; x += 1) {
      const value = luma.data[y * luma.width + x];
      rs += value;
      rq += value * value;
      const target = (y + 1) * stride + x + 1;
      sum[target] = sum[y * stride + x + 1] + rs;
      square[target] = square[y * stride + x + 1] + rq;
    }
  }
  return { stride, sum, square };
}
function rect(integral, stride, left, top, right, bottom) {
  return integral[bottom * stride + right] - integral[top * stride + right]
    - integral[bottom * stride + left] + integral[top * stride + left];
}
function varianceCenters(luma, integrals, cellSize, cfg) {
  const radius = Math.max(3, Math.round(cfg.varianceWindowRadiusCells * cellSize));
  if (radius * 2 + 1 > luma.width || radius * 2 + 1 > luma.height) return [];
  const step = Math.max(2, Math.round(cfg.varianceStepCells * cellSize));
  const raw = [];
  const rawLimit = cfg.varianceCentersPerScale * 10;
  for (let y = radius; y < luma.height - radius; y += step) {
    for (let x = radius; x < luma.width - radius; x += step) {
      const left = x - radius;
      const top = y - radius;
      const right = x + radius + 1;
      const bottom = y + radius + 1;
      const count = (right - left) * (bottom - top);
      const sum = rect(integrals.sum, integrals.stride, left, top, right, bottom);
      const square = rect(integrals.square, integrals.stride, left, top, right, bottom);
      const variance = Math.max(0, square / count - (sum / count) ** 2);
      let index = raw.length;
      while (index > 0 && raw[index - 1].variance < variance) index -= 1;
      raw.splice(index, 0, { x, y, variance });
      if (raw.length > rawLimit) raw.pop();
    }
  }
  const kept = [];
  const nms2 = (cellSize * 1.6) ** 2;
  for (const entry of raw) {
    if (kept.some((other) => (other.x - entry.x) ** 2 + (other.y - entry.y) ** 2 < nms2)) continue;
    kept.push(entry);
    if (kept.length >= cfg.varianceCentersPerScale) break;
  }
  return kept;
}
function centerSeeds(luma, variance, supplied) {
  const out = [];
  const add = (point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.y < 0 || point.x >= luma.width || point.y >= luma.height) return;
    if (!out.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < 1)) out.push(point);
  };
  // 라이브 입력은 중앙 정사각 크롭이다. outline 중심은 회전된 육각 외곽의
  // 이산화로 1px가량 치우칠 수 있으므로 영상 중심을 동점 우선으로 둔다.
  add({ x: (luma.width - 1) / 2, y: (luma.height - 1) / 2 });
  if (Array.isArray(supplied)) supplied.forEach(add); else add(supplied);
  variance.forEach(add);
  return out;
}
function scaleSeeds(luma, options, cfg) {
  const min = Number.isFinite(options.minCellSize) ? options.minCellSize : cfg.minCellSize;
  const max = Number.isFinite(options.maxCellSize)
    ? options.maxCellSize : Math.min(luma.width, luma.height) * cfg.maxCellSizeFraction;
  const out = [];
  const add = (value) => {
    if (!Number.isFinite(value) || value < min || value > max
      || out.some((other) => Math.abs(Math.log(other / value)) < 0.025)) return;
    out.push(value);
  };
  const supplied = Array.isArray(options.cellSizeSeeds) ? options.cellSizeSeeds
    : options.cellSizeSeeds === undefined ? [] : [options.cellSizeSeeds];
  for (const seed of supplied) { add(seed * 0.82); add(seed); add(seed * 1.22); }
  if (out.length === 0) {
    for (let value = min; value <= max * 1.001; value *= cfg.scaleRatio) add(value);
  }
  return out.sort((a, b) => a - b);
}
function insertTop(list, entry, limit) {
  let index = list.length;
  while (index > 0 && (entry.fit > list[index - 1].fit
    || (entry.fit === list[index - 1].fit && entry.correlation > list[index - 1].correlation))) index -= 1;
  list.splice(index, 0, entry);
  if (list.length > limit) list.pop();
}
function geometryModelPenalty(params) {
  // The 19-cell slot is only a few lattice units wide. A tiny raw-NCC gain can
  // otherwise invent terms that explode when extrapolated to the outer data
  // cells. Keep perspective/affine deformation when pixels justify it, but
  // prefer the simpler model.
  return (params.projectivePenalty ?? 2.0)
    * (Math.abs(params.projectiveX) + Math.abs(params.projectiveY))
    + 0.20 * (Math.abs(params.anisotropy) + Math.abs(params.shear));
}
function scoreParams(luma, params, template, span) {
  const H = HFrom(params);
  const sampled = observationsAt(luma, H, true);
  if (!sampled) return null;
  const scored = scoreTemplate(sampled, template, span);
  return { H, ...scored, objective: scored.fit - geometryModelPenalty(params) };
}
function refine(luma, coarse, span, geometryMode = 'affine') {
  let params = {
    ...coarse.params,
    projectivePenalty: geometryMode === 'projective' ? 1.5 : 2.0,
  };
  let best = scoreParams(luma, params, coarse.template, span);
  if (!best) return null;
  const scale = Math.exp(params.logScale);
  const rounds = [
    [0.34 * scale, 0.11, 4, 0.07, 0.014],
    [0.12 * scale, 0.04, 1.4, 0.025, 0.005],
    [0.04 * scale, 0.014, 0.45, 0.009, 0.0017],
    [0.012 * scale, 0.004, 0.14, 0.003, 0.0005],
  ];
  for (const [centerStep, scaleStep, angleStep, affineStep, projectiveStep] of rounds) {
    const steps = {
      centerX: centerStep, centerY: centerStep, logScale: scaleStep,
      rotation: angleStep * Math.PI / 180,
      anisotropy: affineStep, shear: affineStep,
      projectiveX: geometryMode === 'projective' ? projectiveStep : 0,
      projectiveY: geometryMode === 'projective' ? projectiveStep : 0,
    };
    for (const name of Object.keys(steps)) {
      if (!(steps[name] > 0)) continue;
      let chosenParams = params;
      let chosen = best;
      for (const direction of [-1, 1]) {
        const trial = { ...params, [name]: params[name] + direction * steps[name] };
        if (Math.abs(trial.anisotropy) > 0.32 || Math.abs(trial.shear) > 0.32
          || Math.abs(trial.projectiveX) > 0.08 || Math.abs(trial.projectiveY) > 0.08) continue;
        const scored = scoreParams(luma, trial, coarse.template, span);
        if (scored && (scored.objective > chosen.objective + EPSILON
          || (Math.abs(scored.objective - chosen.objective) <= EPSILON
            && scored.correlation > chosen.correlation))) {
          chosenParams = trial;
          chosen = scored;
        }
      }
      params = chosenParams;
      best = chosen;
    }
  }
  return { ...best, params, template: coarse.template, geometryMode };
}
function degrees(radians) { return ((radians * 180 / Math.PI) % 360 + 360) % 360; }
function turnOf(radians) { return Math.floor((degrees(radians) + 60) / 120) % 3; }
function finishCandidate(luma, refined, templates, span, cfg) {
  let best = scoreBest(luma, refined.H, templates, span, true);
  let final = refined;
  if (!best) return null;
  if (best.template.id !== refined.template.id) {
    const rerun = refine(
      luma, { ...refined, template: best.template }, span, refined.geometryMode,
    );
    if (rerun) {
      final = rerun;
      best = scoreBest(luma, final.H, templates, span, true);
    }
  }
  const wrong = [1, 2].map((turn) => scoreAll(
    luma, multiply3(final.H, rotationH(turn * TURN_RADIANS)), [best.template], span, true,
  )[0]?.correlation ?? -1);
  const orientationMargin = best.correlation - Math.max(...wrong);
  const hardChecks = {
    correlation: best.correlation >= cfg.minCorrelation,
    contrast: best.contrastRatio >= cfg.minContrastRatio,
    orientation: orientationMargin >= cfg.minOrientationMargin,
  };
  hardChecks.all = hardChecks.correlation && hardChecks.contrast && hardChecks.orientation;
  const cellSize = Math.exp(final.params.logScale);
  const score = clamp01(0.72 * clamp01(best.correlation)
    + 0.18 * clamp01(best.contrastRatio) + 0.10 * clamp01(orientationMargin / 0.25)
    - geometryModelPenalty(final.params));
  return {
    finderKind: 'cell-mask', kind: 'cell-mask', patternId: best.template.id,
    cellMasks: best.template.pattern.cellMasks,
    center: { x: final.params.centerX, y: final.params.centerY },
    cellSize, score, correlation: best.correlation, contrast: best.contrast,
    contrastRatio: best.contrastRatio,
    orientation: turnOf(final.params.rotation), orientationSource: 'finder-pattern',
    orientationMargin, rotationDegrees: degrees(final.params.rotation),
    hardChecks, hardChecksPassed: hardChecks.all,
    H: final.H, transform: final.H, B: final.H,
    geometryResidual: (1 - score) * cellSize,
    geometryMode: final.geometryMode,
    bands: { matcher: 'cell-mask-ncc', hardChecks, turnCorrelations: wrong },
  };
}
function nms(candidates, limit) {
  const sorted = candidates.slice().sort((a, b) => b.score - a.score
    || b.orientationMargin - a.orientationMargin || a.patternId.localeCompare(b.patternId));
  const kept = [];
  for (const candidate of sorted) {
    if (kept.some((other) => {
      const sameCenter = Math.hypot(candidate.center.x - other.center.x,
        candidate.center.y - other.center.y) < 1.2 * Math.min(candidate.cellSize, other.cellSize);
      const sameProjective = Math.hypot(
        candidate.H[6] - other.H[6], candidate.H[7] - other.H[7],
      ) < 0.0008;
      return sameCenter && sameProjective;
    })) continue;
    kept.push(candidate);
    if (kept.length >= limit) break;
  }
  return kept;
}

export function scoreCellMaskAtHomography(luma, cellMasks, H, options = {}) {
  assertLumaField(luma);
  const template = templateOf(normalizePatterns(cellMasks, options)[0]);
  const percentiles = robustPercentiles(luma, [0.01, 0.99]);
  const span = percentiles ? percentiles[1] - percentiles[0] : 0;
  if (!(span > EPSILON)) return fail(FRONTEND_FAILURE.NO_FINDER, { cause: 'luma-span-degenerate' });
  const scored = scoreBest(luma, H, [template], span, options.detailed !== false);
  return scored ? ok({ patternId: template.id, ...scored })
    : fail(FRONTEND_FAILURE.NO_FINDER, { cause: 'pattern-outside-image' });
}

export function detectCellFinders(luma, patternInput = FINDER_CELL_MASK_PATTERNS, options = {}) {
  try { assertLumaField(luma); } catch (error) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { stage: 'cell-finder-input', message: error.message });
  }
  const templates = normalizePatterns(patternInput, options).map(templateOf);
  const cfg = cfgFor(options);
  const percentiles = robustPercentiles(luma, [0.01, 0.99]);
  const span = percentiles ? percentiles[1] - percentiles[0] : 0;
  if (!(span > EPSILON)) return fail(FRONTEND_FAILURE.NO_FINDER, { stage: 'cell-finder-search', cause: 'luma-span-degenerate' });
  const integrals = cfg.varianceCentersPerScale > 0 ? integralsOf(luma) : null;
  const scales = scaleSeeds(luma, options, cfg);
  const coarse = [];
  let evaluatedGeometry = 0;
  for (const cellSize of scales) {
    const variance = integrals ? varianceCenters(luma, integrals, cellSize, cfg) : [];
    const centers = centerSeeds(luma, variance, options.centerSeeds);
    for (const center of centers) {
      for (let angle = 0; angle < 360; angle += cfg.coarseAngleStepDegrees) {
        const params = {
          centerX: center.x, centerY: center.y, logScale: Math.log(cellSize),
          rotation: angle * Math.PI / 180, anisotropy: 0, shear: 0,
          projectiveX: 0, projectiveY: 0,
        };
        const H = HFrom(params);
        const scored = scoreBest(luma, H, templates, span, false);
        evaluatedGeometry += 1;
        if (scored && scored.fit > 0) insertTop(coarse, { ...scored, params, H }, cfg.maxCoarseCandidates);
      }
    }
  }
  const refined = coarse.slice(0, cfg.maxRefinedCandidates)
    .flatMap((candidate) => [
      refine(luma, candidate, span, 'affine'),
      refine(luma, candidate, span, 'projective'),
    ]).filter(Boolean);
  const candidates = nms(refined.map((entry) => finishCandidate(luma, entry, templates, span, cfg))
    .filter((entry) => entry && entry.hardChecksPassed), cfg.maxOutputCandidates);
  if (candidates.length === 0) {
    const best = refined[0];
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'cell-finder-search', evaluatedGeometry, evaluatedCoarse: coarse.length,
      evaluatedRefined: refined.length, bestScore: best?.fit,
      bestPatternId: best?.template?.id, bestCorrelation: best?.correlation,
      bestContrastRatio: best?.contrastRatio,
    });
  }
  return ok({ candidates, diagnostics: {
    matcher: 'cell-mask-ncc', patternCount: templates.length, scaleCount: scales.length,
    evaluatedGeometry, evaluatedCoarse: coarse.length, evaluatedRefined: refined.length,
  } });
}
