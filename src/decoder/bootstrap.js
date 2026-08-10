/**
 * bootstrap.js — 디코더 앞단의 유한 기하 가설, 포맷 전 후보, 본문 검증 조립.
 *
 * 개정 설계의 핵심 불변식:
 *   - 버전/크기 후보는 인코더 capacity 표에서만 유도한다.
 *   - 포맷 proposal 전체를 평가하며 첫 CRC 성공에서 멈추지 않는다.
 *   - decodeCells 본문 검증 성공은 최종 후보의 필수 조건이다.
 *   - 복수 후보는 실패시키지 않고 무차원 점수와 고정 총순서로 하나를 고른다.
 */

import { VERSIONS } from '../capacity.js';
import { VERSIONS_A } from '../capacityA.js';
import { VERSIONS_Y } from '../capacityY.js';
import { decodeCells } from '../decode.js';
import { enumerateFormatProposals } from '../format-proposals.js';
import { axialToPixel, cellCount, HEX_AREA_COEFF, SQRT3 } from '../hexgrid.js';
import { ranksToDigit } from '../lehmer.js';
import {
  dataCellsInScanOrder,
  formatCells,
  layoutMap,
  anchorCells,
} from '../layout.js';
import {
  dataCellsInScanOrderA,
  layoutMapA,
} from '../layoutA.js';
import {
  FRONTEND_FAILURE,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import {
  findAAnchorHypotheses,
  findOAnchorHypotheses,
} from './anchor-detect.js';
import { detectBullseyes } from './bullseye-detect.js';
import { classifyFamily } from './family.js';
import { sampleHexCell, sampleHexGrid } from './grid-sample.js';
import { estimateHomography4, projectPoint } from './homography.js';
import { estimateLocalWarp, validateOReferences } from './reference-validate.js';
import { robustPercentiles } from './luma.js';

/*
 * 아래 값은 전부 [미검증] M1 calibration 에서 확정한다. 공개 와이어 규범이
 * 아니며 options.calibration으로 덮어쓸 수 있다.
 */
export const UNVERIFIED_BOOTSTRAP_CALIBRATION = Object.freeze({
  tauH: 0.25,
  tauK: 0.20,
  weightH: 0.30,
  weightK: 0.20,
  weightFormat: 0.30,
  weightReference: 0.20,
  rsPenalty: 2,
  nearTieMargin: 0.05,
  outlineThresholdFraction: 0.02,
  rotationStepDegrees: 2,
  finderMaxDimension: 240,
  finderRefineIterations: 1,
  maxGeometryCandidatesPerSize: 4,
  anchorSampleMinCount: 3,
  anchorProjectedMinorDiameter: 1,
  minimumOutlinePixels: 16,
  finderPyramidLevels: 1,
  finderMaxRefinedProposals: 1,
  finderProjectiveSeeds: false,
  localWarpSearchRadiusCells: 0.10,
  localWarpSearchStepCells: 0.05,
});

const ECC_NAME = Object.freeze({ 0: 'L', 1: 'M', 2: 'H' });
const FAMILY_ORDER = Object.freeze({ hex: 0, tri: 1, cube: 2 });
const EPSILON = 1e-12;

function calibration(options) {
  const supplied = options && options.calibration && typeof options.calibration === 'object'
    ? options.calibration
    : {};
  return { ...UNVERIFIED_BOOTSTRAP_CALIBRATION, ...supplied };
}

function median(values) {
  if (values.length === 0) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function multiplyHomographies(left, right) {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        out[row * 3 + column] += left[row * 3 + inner] * right[inner * 3 + column];
      }
    }
  }
  return out;
}

function rotationHomography(degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return new Float64Array([
    cosine, -sine, 0,
    sine, cosine, 0,
    0, 0, 1,
  ]);
}

function finderTransform(finder) {
  const H = finder && (finder.H || finder.transform || finder.B);
  return H instanceof Float64Array && H.length === 9 ? H : null;
}

function familyProfiles(family) {
  if (family === 'hex') {
    return VERSIONS.map((spec) => ({
      family,
      dimension: spec.k,
      spec,
      formatIndices: [spec.version - 1, spec.version + 3],
    }));
  }
  if (family === 'tri') {
    return VERSIONS_A.map((spec) => ({
      family,
      dimension: spec.k,
      spec,
      formatIndices: [spec.formatIndex, spec.formatIndex + 2],
    }));
  }
  if (family === 'cube') {
    return VERSIONS_Y.map((spec) => ({
      family,
      dimension: spec.n,
      spec,
      formatIndices: [spec.formatIndex],
    }));
  }
  return [];
}

function uniqueDimensions(family) {
  return Array.from(new Set(familyProfiles(family).map((entry) => entry.dimension)))
    .sort((a, b) => a - b);
}

function profileForHypothesis(hypothesis) {
  const dimension = hypothesis.family === 'cube' ? hypothesis.n : hypothesis.k;
  return familyProfiles(hypothesis.family).find((entry) => entry.dimension === dimension);
}

function validVersionIndices(hypothesis) {
  const profile = profileForHypothesis(hypothesis);
  if (!profile) return [];
  if (hypothesis.family === 'hex') {
    return [profile.spec.version - 1 + (hypothesis.centerQr ? 4 : 0)];
  }
  if (hypothesis.family === 'tri') {
    return [profile.spec.formatIndex + (hypothesis.centerQr ? 2 : 0)];
  }
  return familyProfiles('cube')
    .filter((entry) => entry.dimension === hypothesis.n)
    .map((entry) => entry.spec.formatIndex);
}

function sampleToDigit(sample) {
  const rows = [
    { face: 'T', value: sample.T.median, order: 0 },
    { face: 'L', value: sample.L.median, order: 1 },
    { face: 'R', value: sample.R.median, order: 2 },
  ].sort((left, right) => left.value - right.value || left.order - right.order);
  const ranks = {};
  rows.forEach((row, rank) => {
    ranks[row.face] = rank;
  });
  return ranksToDigit(ranks);
}

function borderBackground(luma) {
  const values = [];
  const { width, height, data, alpha } = luma;
  const append = (index) => {
    if (alpha && alpha[index] === 0) return;
    const value = data[index];
    if (Number.isFinite(value)) values.push(value);
  };
  for (let x = 0; x < width; x += 1) {
    append(x);
    append((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    append(y * width);
    append(y * width + width - 1);
  }
  return median(values);
}

function outlineEvidence(luma, cfg) {
  const percentiles = robustPercentiles(luma, [0.01, 0.99]);
  const background = borderBackground(luma);
  if (!percentiles || background === null) return null;

  // [미검증] M1 calibration 에서 확정: 배경 대비 foreground 분할 비율.
  const threshold = Math.max(
    1 / 4095,
    (percentiles[1] - percentiles[0]) * cfg.outlineThresholdFraction,
  );
  let area = 0;
  let minX = luma.width;
  let minY = luma.height;
  let maxX = -1;
  let maxY = -1;
  let touchesBorder = false;

  for (let y = 0; y < luma.height; y += 1) {
    for (let x = 0; x < luma.width; x += 1) {
      const index = y * luma.width + x;
      if (luma.alpha && luma.alpha[index] === 0) continue;
      if (Math.abs(luma.data[index] - background) <= threshold) continue;
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === luma.width - 1 || y === luma.height - 1) {
        touchesBorder = true;
      }
    }
  }

  if (area < cfg.minimumOutlinePixels || maxX < minX || maxY < minY) return null;
  return {
    background,
    threshold,
    area,
    bounds: { minX, minY, maxX, maxY },
    touchesBorder,
  };
}

function downsampleLuma(luma, maxDimension) {
  const factor = Math.max(1, Math.ceil(Math.max(luma.width, luma.height) / maxDimension));
  if (factor === 1) return { luma, factor };

  const width = Math.ceil(luma.width / factor);
  const height = Math.ceil(luma.height / factor);
  const data = new Float32Array(width * height);
  const alpha = luma.alpha ? new Uint8Array(width * height) : null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      let minimumAlpha = 255;
      for (let sourceY = y * factor;
        sourceY < Math.min(luma.height, (y + 1) * factor);
        sourceY += 1) {
        for (let sourceX = x * factor;
          sourceX < Math.min(luma.width, (x + 1) * factor);
          sourceX += 1) {
          const sourceIndex = sourceY * luma.width + sourceX;
          if (!luma.alpha || luma.alpha[sourceIndex] > 0) {
            sum += luma.data[sourceIndex];
            count += 1;
          }
          if (luma.alpha) minimumAlpha = Math.min(minimumAlpha, luma.alpha[sourceIndex]);
        }
      }
      const targetIndex = y * width + x;
      data[targetIndex] = count > 0 ? sum / count : 0;
      if (alpha) alpha[targetIndex] = minimumAlpha;
    }
  }
  return { luma: { width, height, data, alpha }, factor };
}

function liftFinder(finder, factor) {
  if (factor === 1) return finder;
  const sourceH = finderTransform(finder);
  if (!sourceH) return null;
  const scale = new Float64Array([
    factor, 0, (factor - 1) / 2,
    0, factor, (factor - 1) / 2,
    0, 0, 1,
  ]);
  const H = multiplyHomographies(scale, sourceH);
  return {
    ...finder,
    center: projectPoint(H, { x: 0, y: 0 }),
    cellSize: finder.cellSize * factor,
    H,
    transform: H,
    B: H,
  };
}

function finderRadiusSeeds(luma, outline) {
  if (!outline) return undefined;
  const dimensions = Array.from(new Set([
    ...uniqueDimensions('hex'),
    ...uniqueDimensions('tri'),
  ]));
  const seeds = dimensions.map((k) => {
    const size = Math.sqrt(outline.area / (cellCount(k) * HEX_AREA_COEFF));
    return Math.sqrt(13) * size;
  }).filter((value) => Number.isFinite(value) && value > 0);
  return seeds.length > 0 ? seeds : undefined;
}

function findersFromEvidence(familyEvidence) {
  if (!familyEvidence || typeof familyEvidence !== 'object') return [];
  const raw = familyEvidence.finders
    || familyEvidence.finder
    || familyEvidence.bullseyes
    || familyEvidence.bullseye
    || familyEvidence.candidates;
  if (Array.isArray(raw)) return raw.filter((entry) => finderTransform(entry));
  if (raw && finderTransform(raw)) return [raw];
  return [];
}

function discoverFinders(luma, familyEvidence, options, cfg) {
  const supplied = findersFromEvidence(familyEvidence);
  if (supplied.length > 0) return ok({ finders: supplied, source: 'supplied' });

  // [미검증] M1 calibration 에서 확정: finder 탐색만 축소하는 작업량 상한.
  const reduced = downsampleLuma(
    luma,
    Number.isFinite(options.finderMaxDimension)
      ? options.finderMaxDimension
      : cfg.finderMaxDimension,
  );
  const reducedOutline = outlineEvidence(reduced.luma, cfg);
  const finderOptions = {
    maxPyramidLevels: cfg.finderPyramidLevels,
    maxRefinedProposals: cfg.finderMaxRefinedProposals,
    refineIterations: cfg.finderRefineIterations,
    projectiveSeeds: cfg.finderProjectiveSeeds,
    outerRadiusSeeds: finderRadiusSeeds(reduced.luma, reducedOutline),
    ...(options.finder || {}),
  };
  if (finderOptions.outerRadiusSeeds === undefined) delete finderOptions.outerRadiusSeeds;

  const detected = detectBullseyes(reduced.luma, finderOptions);
  if (!detected.ok) return detected;
  const finders = detected.candidates
    .map((finder) => liftFinder(finder, reduced.factor))
    .filter(Boolean);
  if (finders.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { stage: 'bootstrap-finder-lift' });
  }
  return ok({
    finders,
    source: reduced.factor === 1 ? 'detected' : 'detected-downsampled',
    downsampleFactor: reduced.factor,
  });
}

function canonicalCenter(q, r) {
  return axialToPixel(q, r, { size: 1, originX: 0, originY: 0 });
}

function reconstructDirectHomography(finder, anchorHypothesis) {
  const canonical = [
    { x: 0, y: 0 },
    ...anchorHypothesis.canonicalAnchors.map((cell) => canonicalCenter(cell.q, cell.r)),
  ];
  const image = [
    finder.center,
    ...anchorHypothesis.anchors,
  ];
  return estimateHomography4(canonical, image);
}

function boundaryAlongRay(luma, center, direction, outline) {
  const norm = Math.hypot(direction.x, direction.y);
  if (!(norm > 0)) return null;
  const unitX = direction.x / norm;
  const unitY = direction.y / norm;
  const maximum = Math.hypot(luma.width, luma.height);
  let last = null;

  for (let distance = 0; distance <= maximum; distance += 0.5) {
    const x = Math.round(center.x + unitX * distance);
    const y = Math.round(center.y + unitY * distance);
    if (x < 0 || y < 0 || x >= luma.width || y >= luma.height) break;
    const index = y * luma.width + x;
    if (luma.alpha && luma.alpha[index] === 0) continue;
    if (Math.abs(luma.data[index] - outline.background) > outline.threshold) {
      last = {
        x: center.x + unitX * distance,
        y: center.y + unitY * distance,
        distance,
      };
    }
  }
  return last;
}

function outerCanonicalPoints(k) {
  const radius = k + 0.5;
  return [
    { x: SQRT3 * radius, y: 0 },
    { x: -SQRT3 * radius / 2, y: 1.5 * radius },
    { x: -SQRT3 * radius / 2, y: -1.5 * radius },
  ];
}

function validateAnchorPattern(luma, H, k, sampleOptions) {
  const expected = anchorCells(k);
  const observations = [];
  let agreement = 0;
  let separation = 0;

  for (const anchor of expected) {
    const sample = sampleHexCell(luma, { H }, anchor.q, anchor.r, sampleOptions);
    if (!sample.ok) {
      observations.push({ expected: anchor.digit, observed: null, reason: sample.reason });
      continue;
    }
    const observed = sampleToDigit(sample);
    const matched = !sample.tie && observed === anchor.digit;
    if (matched) agreement += 1;
    if (Number.isFinite(sample.separation)) separation += sample.separation;
    observations.push({
      expected: anchor.digit,
      observed,
      separation: sample.separation,
      tie: sample.tie,
      matched,
    });
  }
  return { agreement, separation, observations };
}

function sizeGeometryEvidence(hypothesis, outline) {
  const H = hypothesis.H;
  const k = hypothesis.k;
  const center = projectPoint(H, { x: 0, y: 0 });
  if (!center) return { rK: 1, anchorRelativeError: 1, boundaryRelativeError: 1 };

  const canonicalAnchors = anchorCells(k);
  const anchorEstimates = [];
  for (const anchor of canonicalAnchors) {
    const outer = projectPoint(H, canonicalCenter(anchor.q, anchor.r));
    const inwardScale = (k - 1) / k;
    const inward = projectPoint(H, canonicalCenter(
      anchor.q * inwardScale,
      anchor.r * inwardScale,
    ));
    if (!outer || !inward) continue;
    const fullDistance = Math.hypot(outer.x - center.x, outer.y - center.y);
    const localPitch = Math.hypot(outer.x - inward.x, outer.y - inward.y);
    if (localPitch > EPSILON) anchorEstimates.push(fullDistance / localPitch);
  }
  const kAnchor = median(anchorEstimates);
  const anchorRelativeError = kAnchor === null ? 1 : Math.abs(kAnchor - k) / k;

  let boundaryRelativeError = 1;
  if (outline) {
    const canonicalOuter = outerCanonicalPoints(k);
    const residuals = [];
    for (const point of canonicalOuter) {
      const predicted = projectPoint(H, point);
      if (!predicted) continue;
      const observed = boundaryAlongRay(
        hypothesis.luma,
        center,
        { x: predicted.x - center.x, y: predicted.y - center.y },
        outline,
      );
      if (!observed) continue;
      const scale = Math.max(
        Math.hypot(predicted.x - center.x, predicted.y - center.y),
        EPSILON,
      );
      residuals.push(Math.hypot(predicted.x - observed.x, predicted.y - observed.y) / scale);
    }
    if (residuals.length > 0) boundaryRelativeError = Math.max(...residuals);
  }

  return {
    kAnchor,
    anchorRelativeError,
    boundaryRelativeError,
    rK: Math.max(anchorRelativeError, boundaryRelativeError),
  };
}

function silhouetteHypotheses(luma, finder, k, outline, options, cfg) {
  if (!outline || outline.touchesBorder) return [];
  const baseH = finderTransform(finder);
  if (!baseH) return [];
  const center = finder.center || projectPoint(baseH, { x: 0, y: 0 });
  if (!center) return [];

  const sampleOptions = {
    minSampleCount: cfg.anchorSampleMinCount,
    minProjectedMinorDiameter: cfg.anchorProjectedMinorDiameter,
    ...(options.sample || {}),
  };
  const candidates = [];
  const canonicalOuter = outerCanonicalPoints(k);

  // [미검증] M1 calibration 에서 확정: 임의 영상 회전의 coarse 간격.
  for (let degrees = 0; degrees < 360; degrees += cfg.rotationStepDegrees) {
    const guessed = multiplyHomographies(baseH, rotationHomography(degrees));
    const observedOuter = [];
    let complete = true;
    for (const point of canonicalOuter) {
      const projected = projectPoint(guessed, point);
      if (!projected) {
        complete = false;
        break;
      }
      const observed = boundaryAlongRay(
        luma,
        center,
        { x: projected.x - center.x, y: projected.y - center.y },
        outline,
      );
      if (!observed) {
        complete = false;
        break;
      }
      observedOuter.push(observed);
    }
    if (!complete) continue;

    const provisional = estimateHomography4(
      [{ x: 0, y: 0 }, ...canonicalOuter],
      [center, ...observedOuter],
    );
    if (!provisional) continue;
    const anchorValidation = validateAnchorPattern(luma, provisional, k, sampleOptions);
    if (anchorValidation.agreement !== 3) continue;

    /*
     * estimateHomography4를 앵커 대응에도 명시적으로 통과시킨다. 외곽 H가 예측한
     * 앵커 중심을 correspondence로 삼고, 실제 면 순위 검증은 위 기존 sampler가
     * 담당한다. 이 어댑터는 anchor-detect.js의 axial H를 grid-sample 계약에
     * 직접 넘기지 않기 위한 조립 경계다.
     */
    const canonicalAnchors = anchorCells(k).map((cell) => canonicalCenter(cell.q, cell.r));
    const imageAnchors = canonicalAnchors.map((point) => projectPoint(provisional, point));
    if (imageAnchors.some((point) => point === null)) continue;
    const H = estimateHomography4(
      [{ x: 0, y: 0 }, ...canonicalAnchors],
      [center, ...imageAnchors],
    );
    if (!H) continue;

    candidates.push({
      family: 'hex',
      k,
      orientation: 0,
      rotationDegrees: degrees,
      centerQr: Boolean(finder.centerQr),
      anchors: imageAnchors,
      canonicalAnchors: anchorCells(k).map((cell) => ({ q: cell.q, r: cell.r })),
      H,
      geometryResidual: 0,
      anchorMargin: anchorValidation.separation / 3,
      anchorValidation,
      finder,
      source: 'outline-anchor-adapter',
      hypothesisId: 'hex-' + k + '-r' + String(degrees).padStart(3, '0'),
      luma,
    });
  }

  candidates.sort((left, right) =>
    right.anchorMargin - left.anchorMargin
    || left.rotationDegrees - right.rotationDegrees);
  return candidates.slice(0, cfg.maxGeometryCandidatesPerSize);
}

function directAnchorHypotheses(luma, finder, family, options) {
  const dimensions = uniqueDimensions(family);
  const detector = family === 'tri' ? findAAnchorHypotheses : findOAnchorHypotheses;
  const result = detector(luma, finder, dimensions, options.anchor || {});
  if (!result.ok) return { hypotheses: [], failure: result };

  const hypotheses = [];
  for (const raw of result.hypotheses) {
    const H = reconstructDirectHomography(finder, raw);
    if (!H) continue;
    hypotheses.push({
      ...raw,
      H,
      finder,
      source: 'anchor-detector',
      hypothesisId: raw.hypothesisId + '-direct',
      luma,
    });
  }
  return { hypotheses, diagnostics: result.diagnostics };
}

function deduplicateHypotheses(hypotheses) {
  const byId = new Map();
  for (const hypothesis of hypotheses) {
    const key = hypothesis.hypothesisId;
    if (!byId.has(key)) byId.set(key, hypothesis);
  }
  return Array.from(byId.values()).sort((left, right) =>
    (FAMILY_ORDER[left.family] ?? 99) - (FAMILY_ORDER[right.family] ?? 99)
    || (left.k ?? left.n) - (right.k ?? right.n)
    || (left.rotationDegrees ?? left.orientation ?? 0)
      - (right.rotationDegrees ?? right.orientation ?? 0)
    || left.hypothesisId.localeCompare(right.hypothesisId));
}

function classificationDimensions(finders, outline) {
  if (!outline || finders.length === 0) return uniqueDimensions('hex');
  const cellSizes = finders.map((finder) => finder.cellSize)
    .filter((value) => Number.isFinite(value) && value > 0);
  const cellSize = median(cellSizes);
  if (cellSize === null) return uniqueDimensions('hex');
  return uniqueDimensions('hex').map((k) => ({
    k,
    relativeAreaError: Math.abs(
      cellCount(k) * HEX_AREA_COEFF * cellSize * cellSize - outline.area
    ) / outline.area,
  })).sort((left, right) => left.relativeAreaError - right.relativeAreaError || left.k - right.k)
    .slice(0, 1)
    .map((entry) => entry.k);
}

function classifyFamilies(luma, finders, familyEvidence, options, outline) {
  if (familyEvidence && familyEvidence.ok === true && familyEvidence.family) {
    return ok({ families: [familyEvidence.family], classification: familyEvidence });
  }
  if (familyEvidence && typeof familyEvidence.family === 'string') {
    return ok({ families: [familyEvidence.family], classification: familyEvidence });
  }

  const classified = classifyFamily(
    luma,
    { finder: finders },
    {
      ks: classificationDimensions(finders, outline),
      ...(options.family || {}),
    },
  );
  if (classified.ok) {
    return ok({ families: [classified.family], classification: classified });
  }
  if (classified.reason === FRONTEND_FAILURE.FAMILY_AMBIGUOUS) return classified;

  /*
   * 현재 family/anchor 모듈은 임의 영상 회전에서 화면 고정 face offset을 쓴다.
   * Type O의 경우 불스아이 + 외곽 + 앵커 0/0/5 + 포맷 의미론 + 본문 RS가 모두
   * 뒤에서 필수이므로, 분류기가 좌표계 사유로 무후보일 때만 hex를 계속 평가한다.
   * accept는 이 fallback 자체로 일어나지 않는다.
   */
  return ok({
    families: ['hex'],
    classification: classified,
    fallback: 'body-validated-hex',
  });
}

function layoutForFamily(family, dimension) {
  if (family === 'hex') {
    return {
      map: layoutMap(dimension),
      dataCells: dataCellsInScanOrder(dimension),
      type: 'O',
    };
  }
  if (family === 'tri') {
    return {
      map: layoutMapA(dimension),
      dataCells: dataCellsInScanOrderA(dimension),
      type: 'A',
    };
  }
  return null;
}

function referenceReportFor(hypothesis, grid, options) {
  if (hypothesis.family !== 'hex') {
    return { ok: true, total: 0, confident: 0, orderFraction: 0, unsupported: true };
  }
  return validateOReferences(grid, hypothesis.k, options.reference || {});
}

function referenceAgreement(referenceResult) {
  const report = referenceResult.ok
    ? referenceResult
    : referenceResult.detail && referenceResult.detail.report;
  if (!report || !Number.isFinite(report.total) || report.total <= 0) return 0;
  return clamp01(report.confident / report.total);
}

function reprojectionResidual(luma, hypothesis, referenceResult, options, cfg) {
  if (!referenceResult.ok || hypothesis.family !== 'hex') {
    const cellSize = hypothesis.finder && hypothesis.finder.cellSize;
    return Number.isFinite(hypothesis.geometryResidual) && Number.isFinite(cellSize) && cellSize > 0
      ? hypothesis.geometryResidual / cellSize
      : 1;
  }
  try {
    const warp = estimateLocalWarp(
      luma,
      hypothesis,
      referenceResult,
      {
        searchRadiusCells: cfg.localWarpSearchRadiusCells,
        searchStepCells: cfg.localWarpSearchStepCells,
        ...(options.localWarp || {}),
      },
    );
    if (warp.ok && Array.isArray(warp.offsets) && warp.offsets.length > 0) {
      const meanSquare = warp.offsets.reduce(
        (sum, offset) => sum + offset.dx * offset.dx + offset.dy * offset.dy,
        0,
      ) / warp.offsets.length;
      return Math.sqrt(meanSquare);
    }
  } catch {
    // 진단 항 계산 실패는 본문-valid 후보 자체를 폐기하지 않는다.
  }
  return 1;
}

function scoreTerms(candidate, cfg) {
  const rsCost = candidate.crsDistance;
  const reprojection = 1 - clamp01(candidate.rH / Math.max(cfg.tauH, EPSILON));
  const sizeGeometry = 1 - clamp01(candidate.rK / Math.max(cfg.tauK, EPSILON));
  const formatAgreement = candidate.formatAgreement;
  const referenceAgreementValue = candidate.referenceAgreement;
  const score = -cfg.rsPenalty * rsCost
    + cfg.weightH * reprojection
    + cfg.weightK * sizeGeometry
    + cfg.weightFormat * formatAgreement
    + cfg.weightReference * referenceAgreementValue;
  return {
    score,
    terms: {
      rsCost,
      reprojection,
      sizeGeometry,
      formatAgreement,
      referenceAgreement: referenceAgreementValue,
      rH: candidate.rH,
      rK: candidate.rK,
    },
  };
}

function compareCandidates(left, right) {
  return right.score - left.score
    || left.crsDistance - right.crsDistance
    || right.formatAgreement - left.formatAgreement
    || left.rH - right.rH
    || left.rK - right.rK
    || right.referenceAgreement - left.referenceAgreement
    || left.hypothesisId.localeCompare(right.hypothesisId);
}

/**
 * capacity 표에서 크기 후보를 얻고 finder → anchor → Euclidean homography를
 * 전수 평가한다. 성공 결과의 candidates는 아직 포맷/본문을 통과하지 않은 기하
 * 가설이다.
 */
function enumerateGeometryHypotheses(luma, familyEvidence, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { stage: 'bootstrap', message: error.message });
  }
  const cfg = calibration(options);
  const finderResult = discoverFinders(luma, familyEvidence, options, cfg);
  if (!finderResult.ok) return finderResult;

  const outline = outlineEvidence(luma, cfg);
  const classified = classifyFamilies(
    luma,
    finderResult.finders,
    familyEvidence,
    options,
    outline,
  );
  if (!classified.ok) return classified;
  const hypotheses = [];
  const anchorDiagnostics = [];
  for (const family of classified.families) {
    if (family === 'cube') {
      anchorDiagnostics.push({
        family,
        unsupported: true,
        message: 'Type Y 영상용 Y-junction 검출 계약이 없다',
      });
      continue;
    }
    for (let finderIndex = 0; finderIndex < finderResult.finders.length; finderIndex += 1) {
      const finder = finderResult.finders[finderIndex];
      const direct = directAnchorHypotheses(luma, finder, family, options);
      direct.hypotheses.forEach((hypothesis) => {
        hypotheses.push({ ...hypothesis, finderIndex });
      });
      anchorDiagnostics.push({
        family,
        finderIndex,
        directCount: direct.hypotheses.length,
        directFailure: direct.failure,
      });

      if (family === 'hex'
        && (direct.hypotheses.length === 0 || options.alwaysOutlineHypotheses === true)) {
        for (const k of uniqueDimensions('hex')) {
          silhouetteHypotheses(luma, finder, k, outline, options, cfg)
            .forEach((hypothesis) => hypotheses.push({ ...hypothesis, finderIndex }));
        }
      }
    }
  }

  const unique = deduplicateHypotheses(hypotheses);
  if (unique.length === 0) {
    const reason = outline && outline.touchesBorder
      ? FRONTEND_FAILURE.SAMPLE_STARVED
      : FRONTEND_FAILURE.NO_ANCHORS;
    return fail(reason, {
      stage: 'bootstrap-geometry',
      anchorDiagnostics,
      outline: outline && {
        area: outline.area,
        bounds: outline.bounds,
        touchesBorder: outline.touchesBorder,
      },
    });
  }

  for (const hypothesis of unique) {
    hypothesis.sizeGeometry = sizeGeometryEvidence(hypothesis, outline);
    delete hypothesis.luma;
  }
  return ok({
    hypotheses: unique,
    diagnostics: {
      finderSource: finderResult.source,
      finderCount: finderResult.finders.length,
      downsampleFactor: finderResult.downsampleFactor || 1,
      classification: {
        ok: classified.classification && classified.classification.ok,
        reason: classified.classification && classified.classification.reason,
        family: classified.classification && classified.classification.family,
        fallback: classified.fallback,
      },
      capacityDimensions: {
        hex: uniqueDimensions('hex'),
        tri: uniqueDimensions('tri'),
        cube: uniqueDimensions('cube'),
      },
      geometryHypothesisCount: unique.length,
      anchorDiagnostics,
      outline: outline && {
        area: outline.area,
        bounds: outline.bounds,
        touchesBorder: outline.touchesBorder,
        threshold: outline.threshold,
      },
    },
  });
}

/**
 * 한 기하 가설의 ring 3 세 복제를 읽고 enumerateFormatProposals의 전 후보를
 * 반환한다. validVersionIndices는 family+size+finderKind에서 유도한 필수 집합이다.
 */
export function readFormatForHypothesis(luma, hypothesis, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { stage: 'format', message: error.message });
  }
  const valid = validVersionIndices(hypothesis);
  if (valid.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FORMAT_CANDIDATE, {
      stage: 'format',
      cause: 'no-version-indices-for-geometry',
      hypothesisId: hypothesis && hypothesis.hypothesisId,
    });
  }

  const cells = formatCells(hypothesis.k);
  const samples = [];
  const observedDigits = [];
  for (const cell of cells) {
    const sampled = sampleHexCell(luma, hypothesis, cell.q, cell.r, options.sample || {});
    samples.push(sampled);
    if (!sampled.ok) {
      return fail(sampled.reason, {
        stage: 'format-sampling',
        hypothesisId: hypothesis.hypothesisId,
        cell,
        cause: sampled.detail,
      });
    }
    observedDigits.push(sampleToDigit(sampled));
  }
  const reads = [0, 1, 2].map((replica) =>
    observedDigits.slice(replica * 5, replica * 5 + 5));
  const enumerated = enumerateFormatProposals(reads, {
    validVersionIndices: valid,
  });
  const formatCandidates = enumerated.proposals.filter((proposal) => proposal.crcOk);
  if (formatCandidates.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FORMAT_CANDIDATE, {
      stage: 'format',
      hypothesisId: hypothesis.hypothesisId,
      validVersionIndices: valid,
      reads,
      diagnostics: enumerated.diagnostics,
    });
  }
  return ok({
    hypothesis,
    reads,
    samples,
    proposals: enumerated.proposals,
    formatCandidates,
    diagnostics: enumerated.diagnostics,
    validVersionIndices: valid,
  });
}

/**
 * body-valid 후보 중 개정 §6 점수 최고 하나를 고른다. 후보 수가 둘 이상인
 * 사실은 실패 조건이 아니며 selectionMargin/nearTie 진단으로만 남는다.
 */
export function selectGridHypothesis(candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'selection',
      pipelineCode: 'NO_VALID_HYPOTHESIS',
    });
  }
  const cfg = calibration(options);
  const scored = candidates.map((candidate) => {
    if (Number.isFinite(candidate.score)) return candidate;
    return { ...candidate, ...scoreTerms(candidate, cfg) };
  }).sort(compareCandidates);

  const winner = scored[0];
  const runnerUp = scored[1];
  const selectionMargin = runnerUp ? winner.score - runnerUp.score : null;
  return ok({
    candidate: winner,
    candidates: scored,
    diagnostics: {
      hypothesisCount: new Set(scored.map((entry) => entry.hypothesisId)).size,
      formatProposalCount: options.formatProposalCount ?? null,
      formatCandidateCount: options.formatCandidateCount ?? scored.length,
      bodyValidCount: scored.length,
      winnerScore: winner.score,
      runnerUpScore: runnerUp ? runnerUp.score : null,
      selectionMargin,
      winnerTerms: winner.terms,
      nearTie: selectionMargin !== null && selectionMargin <= cfg.nearTieMargin,
    },
  });
}

/**
 * 기하 가설마다 포맷 전 후보와 본문 RS를 모두 평가한 뒤 body-valid 후보만 반환한다.
 * readFormatForHypothesis를 공개 경계로 유지하면서 전체 bootstrap 루프도 이 함수가
 * 소유한다.
 */
function validateGridHypotheses(luma, hypotheses, options = {}) {
  const cfg = calibration(options);
  const bodyValid = [];
  const diagnostics = {
    hypothesisCount: hypotheses.length,
    formatProposalCount: 0,
    formatCandidateCount: 0,
    bodyValidCount: 0,
    formatFailures: [],
    bodyFailures: [],
  };

  for (const hypothesis of hypotheses) {
    const formatRead = readFormatForHypothesis(luma, hypothesis, options);
    if (!formatRead.ok) {
      diagnostics.formatFailures.push({
        hypothesisId: hypothesis.hypothesisId,
        reason: formatRead.reason,
        detail: formatRead.detail,
      });
      continue;
    }
    diagnostics.formatProposalCount += formatRead.proposals.length;
    diagnostics.formatCandidateCount += formatRead.formatCandidates.length;

    const dimension = hypothesis.k;
    const layout = layoutForFamily(hypothesis.family, dimension);
    if (!layout) continue;
    const grid = sampleHexGrid(luma, hypothesis, layout.map, options.sample || {});
    if (!grid.ok) {
      diagnostics.bodyFailures.push({
        hypothesisId: hypothesis.hypothesisId,
        reason: grid.reason,
        stage: 'grid-sampling',
      });
      continue;
    }

    const digits = layout.dataCells.map((cell) => {
      const sample = grid.cells.get(cell.q + ',' + cell.r);
      return sampleToDigit(sample);
    });
    const referenceResult = referenceReportFor(hypothesis, grid, options);
    const acceptedForHypothesis = [];

    for (const formatCandidate of formatRead.formatCandidates) {
      const decoded = decodeCells(digits, {
        type: layout.type,
        formatIndex: formatCandidate.versionIndex,
        eccLevel: formatCandidate.eccLevel,
        k: dimension,
      });
      if (!decoded.ok) {
        diagnostics.bodyFailures.push({
          hypothesisId: hypothesis.hypothesisId,
          versionIndex: formatCandidate.versionIndex,
          eccLevel: formatCandidate.eccLevel,
          reason: decoded.reason,
        });
        continue;
      }

      let matchingFormatDigits = 0;
      for (let index = 0; index < formatRead.samples.length; index += 1) {
        const observed = formatRead.reads[Math.floor(index / 5)][index % 5];
        if (!formatRead.samples[index].tie
          && observed === formatCandidate.maskedDigits[index % 5]) {
          matchingFormatDigits += 1;
        }
      }
      acceptedForHypothesis.push({
        decoded,
        formatCandidate,
        formatAgreement: matchingFormatDigits / 15,
      });
    }
    if (acceptedForHypothesis.length === 0) continue;

    const rH = reprojectionResidual(luma, hypothesis, referenceResult, options, cfg);
    const rK = hypothesis.sizeGeometry ? hypothesis.sizeGeometry.rK : 1;
    const refAgreement = referenceAgreement(referenceResult);
    const profile = profileForHypothesis(hypothesis);

    for (const accepted of acceptedForHypothesis) {
      const candidate = {
        hypothesisId: hypothesis.hypothesisId + '-' + accepted.formatCandidate.source,
        geometryHypothesisId: hypothesis.hypothesisId,
        hypothesis,
        family: hypothesis.family,
        version: profile.spec.version,
        formatIndex: accepted.formatCandidate.versionIndex,
        eccLevel: ECC_NAME[accepted.formatCandidate.eccLevel],
        text: accepted.decoded.text,
        corrected: accepted.decoded.corrected,
        crsDistance: accepted.decoded.crsDistance,
        erasureFallback: accepted.decoded.erasureFallback,
        formatCandidate: accepted.formatCandidate,
        formatAgreement: accepted.formatAgreement,
        referenceAgreement: refAgreement,
        referenceResult,
        rH,
        rK,
      };
      Object.assign(candidate, scoreTerms(candidate, cfg));
      bodyValid.push(candidate);
    }
  }

  diagnostics.bodyValidCount = bodyValid.length;
  if (bodyValid.length === 0) {
    const hadFormat = diagnostics.formatCandidateCount > 0;
    const payloadFailure = diagnostics.bodyFailures.some((entry) =>
      typeof entry.reason === 'string'
      && /^(base211|header|utf8):/.test(entry.reason));
    return fail(
      hadFormat ? FRONTEND_FAILURE.NO_GRID_HYPOTHESIS : FRONTEND_FAILURE.NO_FORMAT_CANDIDATE,
      {
        stage: 'bootstrap-validation',
        pipelineCode: !hadFormat
          ? 'NO_FORMAT_CANDIDATE'
          : payloadFailure
            ? 'PAYLOAD_VALIDATION_FAILED'
            : 'BODY_RS_FAILED',
        diagnostics,
      },
    );
  }
  return ok({ candidates: bodyValid, diagnostics });
}


/**
 * finder/anchor/H 열거부터 포맷 전 후보와 본문 RS 검증까지 한 번에 수행한다.
 * 반환 candidates는 전부 decodeCells 성공 후보이며, 첫 성공 순서에 의존하지 않는다.
 */
export function enumerateGridHypotheses(luma, familyEvidence, options = {}) {
  const geometry = enumerateGeometryHypotheses(luma, familyEvidence, options);
  if (!geometry.ok) return geometry;
  const validated = validateGridHypotheses(luma, geometry.hypotheses, options);
  if (!validated.ok) {
    return fail(validated.reason, {
      ...(validated.detail || {}),
      geometryDiagnostics: geometry.diagnostics,
    });
  }
  return ok({
    hypotheses: geometry.hypotheses,
    candidates: validated.candidates,
    diagnostics: {
      geometry: geometry.diagnostics,
      validation: validated.diagnostics,
    },
  });
}
