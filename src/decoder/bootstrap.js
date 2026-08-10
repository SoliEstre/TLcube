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
import {
  dataCellsInScanOrder as dataCellsInScanOrderY,
  formatCells as formatCellsY,
  layoutMapY,
} from '../layoutY.js';
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
  HOMOGRAPHY_CANONICAL_SPACE,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import {
  findAAnchorHypotheses,
  findOAnchorHypotheses,
} from './anchor-detect.js';
import { detectBullseyes, refineBullseye } from './bullseye-detect.js';
import { classifyFamily, scoreCubeTiling } from './family.js';
import {
  UNVERIFIED_CUBE_DETECTION,
  readCubeDigit,
  sampleCubeCell,
  sampleCubeGrid,
} from './cube-detect.js';
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
  finderClutterMaxDimension: 240,
  finderClutterRetryMaxDimension: 768,
  finderClutterPyramidLevels: 2,
  finderRefineIterations: 1,
  maxGeometryCandidatesPerSize: 4,
  anchorSampleMinCount: 3,
  anchorProjectedMinorDiameter: 1,
  minimumOutlinePixels: 16,
  finderPyramidLevels: 1,
  finderMaxRefinedProposals: 1,
  finderClutterMaxRefinedProposals: 1,
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
    .filter((entry) => entry.dimension === hypothesis.n
      && (hypothesis.tones === undefined || entry.spec.tones === hypothesis.tones))
    .map((entry) => entry.spec.formatIndex);
}

/** 모든 패밀리를 통틀어 존재하는 포맷 인덱스 전체. 재배치 탐색의 열거 범위다. */
function allFormatIndices() {
  const out = new Set();
  for (const family of ['hex', 'tri', 'cube']) {
    for (const entry of familyProfiles(family)) {
      for (const index of entry.formatIndices) out.add(index);
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * 포맷 인덱스의 **소유자** (패밀리, 차원) 목록. `validVersionIndices` 의 역방향이다.
 *
 * 왜 필요한가: 포맷 정보는 CRC 로 보호된다. CRC 가 맞는데 인덱스가 가정한 패밀리 밖이면
 * 그건 "포맷이 틀렸다" 가 아니라 **"패밀리 가정이 틀렸다"** 는 뜻이다. 실제로 실기기
 * Type A 사진에서 복제 3/3 합의 + CRC 통과로 읽힌 인덱스 1 이 hex 폴백 때문에
 * `versionOutsideFamily` 로 폐기됐다 (`.agent/decoder/004`). 그 인덱스의 주인을
 * 되짚어 기하를 다시 세우려고 만든다.
 */
function formatIndexOwners(formatIndex) {
  const owners = [];
  for (const family of ['hex', 'tri', 'cube']) {
    for (const entry of familyProfiles(family)) {
      if (entry.formatIndices.includes(formatIndex)) {
        owners.push({ family, dimension: entry.dimension });
      }
    }
  }
  return owners;
}

function profileForFormatCandidate(hypothesis, formatIndex) {
  const dimension = hypothesis.family === 'cube' ? hypothesis.n : hypothesis.k;
  return familyProfiles(hypothesis.family).find((entry) =>
    entry.dimension === dimension && entry.formatIndices.includes(formatIndex));
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

function borderBackground(luma, inset = 0) {
  const values = [];
  const { width, height, data, alpha } = luma;
  const left = Math.min(Math.max(0, inset), Math.floor((width - 1) / 2));
  const top = Math.min(Math.max(0, inset), Math.floor((height - 1) / 2));
  const right = width - 1 - left;
  const bottom = height - 1 - top;
  const append = (index) => {
    if (alpha && alpha[index] === 0) return;
    const value = data[index];
    if (Number.isFinite(value)) values.push(value);
  };
  for (let x = left; x <= right; x += 1) {
    append(top * width + x);
    append(bottom * width + x);
  }
  for (let y = top + 1; y < bottom; y += 1) {
    append(y * width + left);
    append(y * width + right);
  }
  return median(values);
}

function outlineEvidence(luma, cfg) {
  const percentiles = robustPercentiles(luma, [0.01, 0.99]);
  const background = borderBackground(luma);
  const inset = Math.max(2, Math.min(24, Math.floor(Math.min(luma.width, luma.height) * 0.02)));
  const innerBackground = borderBackground(luma, inset);
  if (!percentiles || background === null || innerBackground === null) return null;

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
  const bounds = { minX, minY, maxX, maxY };
  const boundsArea = (maxX - minX + 1) * (maxY - minY + 1);
  return {
    background,
    innerBackground,
    borderDisagreement: Math.abs(background - innerBackground),
    threshold,
    area,
    bounds,
    fillRatio: area / boundsArea,
    touchesBorder,
  };
}

function downsampleLuma(luma, maxDimension, contentBounds) {
  const contentWidth = contentBounds
    ? contentBounds.maxX - contentBounds.minX + 1
    : luma.width;
  const contentHeight = contentBounds
    ? contentBounds.maxY - contentBounds.minY + 1
    : luma.height;
  // [미검증] M1 calibration에서 확정: finder 해상도는 빈 margin이 아니라 실제
  // foreground span으로 제한한다. margin이 커졌다는 이유로 셀 표본을 더 줄이지 않는다.
  const factor = Math.max(1, Math.ceil(Math.max(contentWidth, contentHeight) / maxDimension));
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

  // 경계가 안정된 입력은 기존 outline 면적 seed가 가장 싸고 정확하다.
  // 이 fast path가 실패하면 outline aggregate가 UI/복수 코드에 오염된 것으로 보고
  // 같은 프레임을 일반 다중스케일로 한 번 더 탐색한다.
  const fullOutline = outlineEvidence(luma, cfg);
  const outlineCanSeed = fullOutline
    && !fullOutline.touchesBorder
    && fullOutline.borderDisagreement <= fullOutline.threshold;
  const finderOverrides = options.finder && typeof options.finder === 'object'
    ? options.finder
    : {};
  const requestedMaxDimension = Number.isFinite(options.finderMaxDimension)
    ? options.finderMaxDimension
    : null;

  const makeFinderOptions = (useOutlineSeeds, reducedOutline) => {
    const configured = {
      maxPyramidLevels: useOutlineSeeds
        ? cfg.finderPyramidLevels
        : cfg.finderClutterPyramidLevels,
      maxRefinedProposals: useOutlineSeeds
        ? cfg.finderMaxRefinedProposals
        : cfg.finderClutterMaxRefinedProposals,
      refineIterations: cfg.finderRefineIterations,
      projectiveSeeds: cfg.finderProjectiveSeeds,
      outerRadiusSeeds: useOutlineSeeds
        ? finderRadiusSeeds(reducedOutline && reducedOutline.luma, reducedOutline && reducedOutline.outline)
        : undefined,
      ...finderOverrides,
    };
    if (configured.outerRadiusSeeds === undefined) delete configured.outerRadiusSeeds;
    return configured;
  };

  let usedOutlineSeeds = Boolean(outlineCanSeed);
  let reduced = downsampleLuma(
    luma,
    requestedMaxDimension ?? (
      usedOutlineSeeds ? cfg.finderMaxDimension : cfg.finderClutterMaxDimension
    ),
    usedOutlineSeeds ? fullOutline.bounds : null,
  );
  let reducedOutline = outlineEvidence(reduced.luma, cfg);
  let finderOptions = makeFinderOptions(
    usedOutlineSeeds,
    { luma: reduced.luma, outline: reducedOutline },
  );
  let detected = detectBullseyes(reduced.luma, finderOptions);

  const callerFixedScaleSearch = Object.prototype.hasOwnProperty.call(
    finderOverrides,
    'outerRadiusSeeds',
  );
  if (!detected.ok && usedOutlineSeeds && !callerFixedScaleSearch) {
    usedOutlineSeeds = false;
    reduced = downsampleLuma(
      luma,
      requestedMaxDimension ?? cfg.finderClutterMaxDimension,
      null,
    );
    reducedOutline = outlineEvidence(reduced.luma, cfg);
    finderOptions = makeFinderOptions(false, null);
    detected = detectBullseyes(reduced.luma, finderOptions);
  }
  if (!detected.ok
    && !callerFixedScaleSearch
    && requestedMaxDimension === null
    && cfg.finderClutterRetryMaxDimension > cfg.finderClutterMaxDimension
    && Math.max(luma.width, luma.height) > cfg.finderClutterMaxDimension) {
    usedOutlineSeeds = false;
    reduced = downsampleLuma(luma, cfg.finderClutterRetryMaxDimension, null);
    reducedOutline = outlineEvidence(reduced.luma, cfg);
    finderOptions = makeFinderOptions(false, null);
    detected = detectBullseyes(reduced.luma, finderOptions);
  }
  if (!detected.ok) return detected;
  const finders = detected.candidates
    .map((finder) => liftFinder(finder, reduced.factor))
    .filter(Boolean)
    .map((finder) => {
      if (usedOutlineSeeds || reduced.factor === 1) return finder;
      const fullResolution = refineBullseye(luma, finder, {
        refineIterations: 0,
        projectiveSeeds: false,
      });
      return fullResolution.ok ? fullResolution.candidate : finder;
    });
  if (finders.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { stage: 'bootstrap-finder-lift' });
  }
  return ok({
    finders,
    source: usedOutlineSeeds
      ? reduced.factor === 1 ? 'detected' : 'detected-downsampled'
      : reduced.factor === 1 ? 'detected-multiscale' : 'detected-multiscale-downsampled',
    downsampleFactor: reduced.factor,
  });
}

function canonicalCenter(q, r) {
  return axialToPixel(q, r, { size: 1, originX: 0, originY: 0 });
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

function symbolBoundaryPoints(k) {
  const half = outerCanonicalPoints(k);
  return half.concat(half.map((point) => ({ x: -point.x, y: -point.y })));
}

function finderGeometry(finder) {
  const H = finderTransform(finder);
  if (H) return H;
  const center = finder && finder.center;
  const cellSize = finder && finder.cellSize;
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)
    || !Number.isFinite(cellSize) || !(cellSize > 0)) return null;
  return new Float64Array([
    cellSize, 0, center.x,
    0, cellSize, center.y,
    0, 0, 1,
  ]);
}

/*
 * 배경/outline이 영상 경계에 닿는지는 심볼 crop의 증거가 아니다. finder 기하로
 * 지원하는 가장 작은 심볼조차 프레임 안에 닫히지 않을 때만 clipped로 승격한다.
 */
function supportedDimensions() {
  return Array.from(new Set([
    ...uniqueDimensions('hex'),
    ...uniqueDimensions('tri'),
  ])).sort((a, b) => a - b);
}

function clippingSides(luma, finder, k) {
  const H = finderGeometry(finder);
  if (!H) return new Set(['unknown']);
  const sides = new Set();
  for (const canonical of symbolBoundaryPoints(k)) {
    const point = projectPoint(H, canonical);
    if (!point) {
      sides.add('horizon');
      continue;
    }
    if (point.x < 0) sides.add('left');
    if (point.x > luma.width - 1) sides.add('right');
    if (point.y < 0) sides.add('top');
    if (point.y > luma.height - 1) sides.add('bottom');
  }
  return sides;
}

function anySupportedSymbolFits(luma, finders) {
  const dimensions = supportedDimensions();
  return finders.some((finder) => dimensions.some(
    (k) => clippingSides(luma, finder, k).size === 0,
  ));
}

function minimumClippingSideCount(luma, finders) {
  const dimensions = supportedDimensions();
  let minimum = Number.POSITIVE_INFINITY;
  for (const finder of finders) {
    for (const k of dimensions) {
      minimum = Math.min(minimum, clippingSides(luma, finder, k).size);
    }
  }
  return minimum;
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

    // provisional 자체가 unit-cell canonical Euclidean -> image pixel이다.
    // 같은 대응점을 다시 추정하는 axial->Euclidean 어댑터를 두지 않는다.
    const H = provisional;
    const canonicalAnchors = anchorCells(k).map((cell) => canonicalCenter(cell.q, cell.r));
    const imageAnchors = canonicalAnchors.map((point) => projectPoint(H, point));
    if (imageAnchors.some((point) => point === null)) continue;

    candidates.push({
      family: 'hex',
      k,
      orientation: 0,
      rotationDegrees: degrees,
      centerQr: Boolean(finder.centerQr),
      anchors: imageAnchors,
      canonicalAnchors: anchorCells(k).map((cell) => ({ q: cell.q, r: cell.r })),
      H,
      canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
      geometryResidual: 0,
      anchorMargin: anchorValidation.separation / 3,
      anchorValidation,
      finder,
      source: 'outline-anchor',
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
    // anchor-detect가 이미 계약 좌표의 H를 반환한다. 재해석·재추정하지 않는다.
    hypotheses.push({
      ...raw,
      finder,
      source: 'anchor-detector',
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
    {
      finder: finders,
      yJunction: familyEvidence && familyEvidence.yJunction,
    },
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
  if (family === 'cube') {
    return {
      map: layoutMapY(dimension),
      dataCells: dataCellsInScanOrderY(dimension),
      type: 'Y',
    };
  }
  return null;
}

function referenceReportFor(hypothesis, grid, options) {
  if (hypothesis.family === 'cube') {
    const reference = hypothesis.referenceCalibration;
    return {
      ok: Boolean(reference && reference.hardChecks && reference.hardChecks.all),
      total: reference ? reference.total : 0,
      confident: reference ? reference.agreement : 0,
      orderFraction: reference ? reference.agreementRate : 0,
      tones: hypothesis.tones,
      observations: reference ? reference.observations : [],
    };
  }
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
  if (hypothesis.family === 'cube') {
    const center = projectPoint(hypothesis.H, { x: 0, y: 0 });
    const iStep = projectPoint(hypothesis.H, { x: 1, y: 0 });
    const jStep = projectPoint(hypothesis.H, { x: 0, y: 1 });
    if (!center || !iStep || !jStep || !Number.isFinite(hypothesis.geometryResidual)) return 1;
    const pitch = median([
      Math.hypot(iStep.x - center.x, iStep.y - center.y),
      Math.hypot(jStep.x - center.x, jStep.y - center.y),
    ]);
    return Number.isFinite(pitch) && pitch > EPSILON
      ? hypothesis.geometryResidual / pitch
      : 1;
  }
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
  const outline = outlineEvidence(luma, cfg);

  /*
   * Type Y는 불스아이 실패 뒤에 실행되는 폴백이 아니다. 전용 기하 검출을 독립 평가하고,
   * Type O/A finder 경로도 가능한 경우 classifyFamily가 두 양성 경로를 함께 보고
   * FAMILY_AMBIGUOUS로 닫게 한다.
   */
  const yJunctionEvidence = familyEvidence && typeof familyEvidence === 'object'
    ? familyEvidence.yJunction
    : undefined;
  const cubeResult = scoreCubeTiling(
    luma,
    yJunctionEvidence,
    options.family && typeof options.family === 'object' ? options.family : {},
  );
  const finderResult = cubeResult.ok && options.alwaysCompareFinders !== true
    ? fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'bootstrap-finder',
      cause: 'cube-positive-independent-path',
    })
    : discoverFinders(luma, familyEvidence, options, cfg);

  if (!finderResult.ok && !cubeResult.ok) {
    const finderSawCandidates = finderResult.detail
      && Number.isFinite(finderResult.detail.evaluatedRaw)
      && finderResult.detail.evaluatedRaw > 0
      && finderResult.detail.hardChecks
      && finderResult.detail.hardChecks.alternating === true
      && finderResult.detail.hardChecks.outerBandLight === true;
    const bestCandidate = finderResult.detail && finderResult.detail.bestCandidate;
    if (finderSawCandidates
      && bestCandidate
      && !anySupportedSymbolFits(luma, [bestCandidate])) {
      return fail(FRONTEND_FAILURE.SYMBOL_CLIPPED, {
        stage: 'bootstrap-finder',
        cause: 'supported-symbol-footprint-crosses-image-boundary',
        finderFailure: finderResult,
        cubeFailure: cubeResult,
        outline: outline && {
          area: outline.area,
          bounds: outline.bounds,
          touchesBorder: outline.touchesBorder,
          fillRatio: outline.fillRatio,
        },
      });
    }
    return finderResult;
  }

  const finders = finderResult.ok ? finderResult.finders : [];
  let classified;
  if (finderResult.ok) {
    const evidence = familyEvidence && typeof familyEvidence === 'object'
      ? { ...familyEvidence }
      : {};
    if (cubeResult.ok) {
      evidence.yJunction = { geometryHypotheses: cubeResult.geometryHypotheses };
    }
    classified = classifyFamilies(
      luma,
      finders,
      evidence,
      options,
      outline,
    );
  } else {
    classified = ok({
      families: ['cube'],
      classification: ok({
        family: 'cube',
        hypotheses: [cubeResult],
        diagnostics: { cubeOnly: true },
      }),
      cubeOnly: true,
    });
  }
  if (!classified.ok) return classified;

  const hypotheses = [];
  const anchorDiagnostics = [];
  for (const family of classified.families) {
    if (family === 'cube') {
      const cubeHypotheses = cubeResult.ok ? cubeResult.geometryHypotheses : [];
      for (const raw of cubeHypotheses) {
        hypotheses.push({
          ...raw,
          source: raw.source || 'cube-detector',
          luma,
        });
      }
      anchorDiagnostics.push({
        family,
        cubeHypothesisCount: cubeHypotheses.length,
        cubeDiagnostics: cubeResult.diagnostics,
      });
      continue;
    }

    for (let finderIndex = 0; finderIndex < finders.length; finderIndex += 1) {
      const finder = finders[finderIndex];
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
    const shouldRetryFinderResolution = options._finderResolutionRetry !== false
      && options.finderMaxDimension === undefined
      && typeof finderResult.source === 'string'
      && finderResult.source.includes('multiscale')
      && cfg.finderClutterRetryMaxDimension > cfg.finderClutterMaxDimension;
    if (shouldRetryFinderResolution) {
      const retried = enumerateGeometryHypotheses(luma, familyEvidence, {
        ...options,
        finderMaxDimension: cfg.finderClutterRetryMaxDimension,
        _finderResolutionRetry: false,
      });
      if (retried.ok) return retried;
    }

    const clipped = finders.length > 0 && !anySupportedSymbolFits(luma, finders);
    const reason = clipped ? FRONTEND_FAILURE.SYMBOL_CLIPPED : FRONTEND_FAILURE.NO_ANCHORS;
    const clippingSideCount = clipped
      ? minimumClippingSideCount(luma, finders)
      : 0;
    return fail(reason, {
      stage: clippingSideCount >= 2 ? 'bootstrap-finder' : 'bootstrap-geometry',
      clippingSideCount,
      anchorDiagnostics,
      cubeFailure: cubeResult.ok ? undefined : cubeResult,
      outline: outline && {
        area: outline.area,
        bounds: outline.bounds,
        touchesBorder: outline.touchesBorder,
      },
    });
  }

  for (const hypothesis of unique) {
    if (hypothesis.family !== 'cube') {
      hypothesis.sizeGeometry = sizeGeometryEvidence(hypothesis, outline);
    }
    delete hypothesis.luma;
  }
  return ok({
    hypotheses: unique,
    diagnostics: {
      finderSource: finderResult.ok ? finderResult.source : 'none-cube-positive',
      finderCount: finders.length,
      finderFailure: finderResult.ok ? undefined : finderResult,
      cube: {
        ok: cubeResult.ok,
        reason: cubeResult.reason,
        hypothesisCount: cubeResult.ok ? cubeResult.geometryHypotheses.length : 0,
        diagnostics: cubeResult.ok ? cubeResult.diagnostics : cubeResult.detail,
      },
      downsampleFactor: finderResult.ok ? finderResult.downsampleFactor || 1 : 1,
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
        fillRatio: outline.fillRatio,
        threshold: outline.threshold,
      },
    },
  });
}

/**
 * 한 기하 가설의 ring 3 세 복제를 읽고 enumerateFormatProposals의 전 후보를
 * 반환한다. validVersionIndices는 family+size+finderKind에서 유도한 필수 집합이다.
 */
export function cubeSampleOptions(options) {
  return {
    minSampleCount: UNVERIFIED_CUBE_DETECTION.minimumSampleCount,
    minProjectedMinorDiameter:
      UNVERIFIED_CUBE_DETECTION.minimumProjectedMinorDiameter,
    disc: {
      fraction: UNVERIFIED_CUBE_DETECTION.sampleDiscFraction,
      ...((options.sample && options.sample.disc) || {}),
    },
    ...(options.sample || {}),
  };
}

function readFormatForHypothesis(luma, hypothesis, options = {}) {
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

  const cube = hypothesis.family === 'cube';
  const cells = cube ? formatCellsY(hypothesis.n) : formatCells(hypothesis.k);
  const samples = [];
  const observedDigits = [];
  for (const cell of cells) {
    const sampled = cube
      ? sampleCubeCell(luma, hypothesis, cell.i, cell.j, cubeSampleOptions(options))
      : sampleHexCell(luma, hypothesis, cell.q, cell.r, options.sample || {});
    samples.push(sampled);
    if (!sampled.ok) {
      return fail(sampled.reason, {
        stage: 'format-sampling',
        hypothesisId: hypothesis.hypothesisId,
        cell,
        cause: sampled.detail,
      });
    }
    if (cube) {
      const read = readCubeDigit(sampled, hypothesis.referenceCalibration);
      if (read === null) {
        return fail(FRONTEND_FAILURE.NO_FORMAT_CANDIDATE, {
          stage: 'format-sampling',
          cause: 'illegal-two-tone-triple-or-unreadable-three-tone-rank',
          hypothesisId: hypothesis.hypothesisId,
          cell,
          tones: hypothesis.tones,
        });
      }
      observedDigits.push(read.digit);
    } else {
      observedDigits.push(sampleToDigit(sampled));
    }
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
      tones: hypothesis.tones,
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

    const cube = hypothesis.family === 'cube';
    const dimension = cube ? hypothesis.n : hypothesis.k;
    const layout = layoutForFamily(hypothesis.family, dimension);
    if (!layout) continue;
    const grid = cube
      ? sampleCubeGrid(luma, hypothesis, layout.map, cubeSampleOptions(options))
      : sampleHexGrid(luma, hypothesis, layout.map, options.sample || {});
    if (!grid.ok) {
      diagnostics.bodyFailures.push({
        hypothesisId: hypothesis.hypothesisId,
        reason: grid.reason,
        stage: 'grid-sampling',
      });
      continue;
    }

    const digits = [];
    const cubeUnreadableCells = [];
    for (const cell of layout.dataCells) {
      const key = cube ? cell.i + ',' + cell.j : cell.q + ',' + cell.r;
      const sample = grid.cells.get(key);
      if (cube) {
        const read = readCubeDigit(sample, hypothesis.referenceCalibration);
        if (read === null) {
          // 000/111은 Type Y 2톤 알파벳 밖이다. 위치를 보존한 결정적 0으로
          // 넘기고 RS/header 검증이 이 기하 가설을 살릴지 최종 판정한다.
          digits.push(0);
          cubeUnreadableCells.push({ cell, cause: 'illegal-tone-triple' });
        } else {
          digits.push(read.digit);
        }
      } else {
        digits.push(sampleToDigit(sample));
      }
    }

    const referenceResult = referenceReportFor(hypothesis, grid, options);
    const acceptedForHypothesis = [];

    for (const formatCandidate of formatRead.formatCandidates) {
      const decodeFormat = {
        type: layout.type,
        formatIndex: formatCandidate.versionIndex,
        eccLevel: formatCandidate.eccLevel,
      };
      if (cube) {
        decodeFormat.n = dimension;
        decodeFormat.tones = hypothesis.tones;
      } else {
        decodeFormat.k = dimension;
      }
      const decoded = decodeCells(digits, decodeFormat);
      if (!decoded.ok) {
        diagnostics.bodyFailures.push({
          hypothesisId: hypothesis.hypothesisId,
          versionIndex: formatCandidate.versionIndex,
          eccLevel: formatCandidate.eccLevel,
          reason: decoded.reason,
          cubeUnreadableCount: cubeUnreadableCells.length,
        });
        continue;
      }

      let matchingFormatDigits = 0;
      for (let index = 0; index < formatRead.samples.length; index += 1) {
        const observed = formatRead.reads[Math.floor(index / 5)][index % 5];
        const confident = cube || !formatRead.samples[index].tie;
        if (confident && observed === formatCandidate.maskedDigits[index % 5]) {
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

    for (const accepted of acceptedForHypothesis) {
      const profile = profileForFormatCandidate(
        hypothesis,
        accepted.formatCandidate.versionIndex,
      );
      if (!profile) continue;
      const candidate = {
        hypothesisId: hypothesis.hypothesisId + '-' + accepted.formatCandidate.source,
        geometryHypothesisId: hypothesis.hypothesisId,
        hypothesis,
        family: hypothesis.family,
        version: profile.spec.version,
        versionName: profile.spec.name,
        tones: profile.spec.tones,
        formatIndex: accepted.formatCandidate.versionIndex,
        eccLevel: ECC_NAME[accepted.formatCandidate.eccLevel],
        text: accepted.decoded.text,
        corrected: accepted.decoded.corrected,
        crsDistance: accepted.decoded.crsDistance,
        erasureFallback: accepted.decoded.erasureFallback,
        cubeSamplingFallback: cubeUnreadableCells.length > 0
          ? {
            mode: 'deterministic-zero-digit-rs-validation',
            cells: cubeUnreadableCells,
          }
          : undefined,
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
/**
 * 실패한 검증에서 **CRC 가 유효한 out-of-family 포맷**을 찾아 재배치 대상 패밀리를 낸다.
 *
 * 폐기된 포맷 읽기(`formatFailures[].detail.reads`)를 **전 인덱스 허용**으로 다시 열거해
 * CRC 통과 후보만 남기고, 그 인덱스의 소유자 패밀리 중 **아직 시도하지 않은 것**을 고른다.
 * CRC 가 틀린 읽기는 여기서 그냥 사라진다 — 잡음으로 재배치가 발동하지 않게 하는 게 핵심이다.
 */
function relocationTargets(validated, attemptedFamilies) {
  const failures = (validated.detail && validated.detail.diagnostics
    && validated.detail.diagnostics.formatFailures) || [];
  const everyIndex = allFormatIndices();
  const targets = new Set();
  const evidence = [];

  for (const failure of failures) {
    const reads = failure.detail && failure.detail.reads;
    if (!Array.isArray(reads) || reads.length !== 3) continue;
    let enumerated;
    try {
      enumerated = enumerateFormatProposals(reads, { validVersionIndices: everyIndex });
    } catch {
      continue;
    }
    for (const proposal of enumerated.proposals) {
      if (!proposal.crcOk) continue;
      for (const owner of formatIndexOwners(proposal.versionIndex)) {
        if (attemptedFamilies.has(owner.family)) continue;
        targets.add(owner.family);
        evidence.push({
          fromHypothesis: failure.hypothesisId,
          formatIndex: proposal.versionIndex,
          eccLevel: proposal.eccLevel,
          owner,
        });
      }
    }
  }
  return { families: Array.from(targets), evidence };
}

export function enumerateGridHypotheses(luma, familyEvidence, options = {}) {
  const geometry = enumerateGeometryHypotheses(luma, familyEvidence, options);
  if (!geometry.ok) return geometry;
  const validated = validateGridHypotheses(luma, geometry.hypotheses, options);
  if (!validated.ok) {
    /*
     * 패밀리 재배치 — 분류기가 틀려도 복구되는 안전망이다.
     *
     * 분류가 실패해 hex 로 폴백하면 tri 코드의 포맷을 **정확히 읽고도**
     * `versionOutsideFamily` 로 버린다(포맷 셀이 불스아이 근방이라 패밀리와 거의
     * 무관하게 잡히기 때문). 실기기 Type A 사진이 정확히 그 경로로 죽었다.
     *
     * 재배치는 **CRC 가 맞은 경우에만** 발동하므로 정상 경로 비용은 0 이고,
     * **한 번만** 돈다(`_familyRelocation:false`). 재배치로 생긴 후보도 001c 가
     * 필수로 올린 본문 RS 를 통과해야 하므로 후보를 넓혀도 오인식은 늘지 않는다.
     */
    const relocationEnabled = options._familyRelocation !== false;
    const attempted = new Set(geometry.hypotheses.map((hypothesis) => hypothesis.family));
    const relocation = relocationEnabled
      ? relocationTargets(validated, attempted)
      : { families: [], evidence: [] };

    for (const family of relocation.families) {
      const retried = enumerateGridHypotheses(luma, { family }, {
        ...options,
        _familyRelocation: false,
      });
      if (retried.ok) {
        retried.diagnostics.relocation = {
          from: Array.from(attempted),
          to: family,
          evidence: relocation.evidence.filter((item) => item.owner.family === family),
        };
        return retried;
      }
    }

    return fail(validated.reason, {
      ...(validated.detail || {}),
      geometryDiagnostics: geometry.diagnostics,
      relocation: {
        attemptedFamilies: Array.from(attempted),
        targets: relocation.families,
        evidence: relocation.evidence,
        enabled: relocationEnabled,
      },
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
