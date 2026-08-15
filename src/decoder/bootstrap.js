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
import {
  VERSIONS_Y,
  windowedReferenceCellsY,
  windowedFormatCellsY,
  windowExcludedCellsY,
} from '../capacityY.js';
import {
  dataCellsInScanOrder as dataCellsInScanOrderY,
  formatCells as formatCellsY,
  layoutMapY,
} from '../layoutY.js';
import {
  CELL_SURFACE_FORMAT_INDEX_2T,
  CELL_SURFACE_FORMAT_INDEX_3T,
  CELL_SURFACE_N,
  CELL_SURFACE_VERSION,
  dataCellsInScanOrderCellSurface,
  formatCellsCellSurface,
  formatIndexCellSurface,
  isCellSurfaceFormatIndex,
  layoutMapCellSurface,
  nameCellSurface,
  tonesFromCellSurfaceFormatIndex,
} from '../cellSurfaceY.js';
import {
  CELL_SURFACE_LAYOUT_N,
  CELL_SURFACE_LAYOUT_VERSION,
  dataCellsInScanOrderCellSurfaceLayout,
  formatCellsCellSurfaceLayout,
  formatIndexCellSurfaceLayout,
  isCellSurfaceLayoutFormatIndex,
  layoutIdFromFormatIndex,
  layoutMapCellSurfaceLayout,
  nameCellSurfaceLayout,
  tonesFromCellSurfaceLayoutFormatIndex,
} from '../cellSurfaceLayouts.js';
import {
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdForN,
  formatCellsCellSurfaceFinal,
  formatIndexCellSurfaceFinal,
  isCellSurfaceFinalFormatIndex,
  isCellSurfaceFinalId,
  layoutMapCellSurfaceFinal,
  nameCellSurfaceFinal,
  tonesFromCellSurfaceFinalFormatIndex,
  versionForFinalN,
} from '../cellSurfaceFinal.js';
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
import { HYBRID_INNER_CUBE_BANDS } from '../bullseye.js';
import { detectBullseyes, pyramidLevelsForImage, refineBullseye } from './bullseye-detect.js';
import { detectCellFinders } from './cell-finder-detect.js';
import { FINDER_CELL_MASK_PATTERNS } from '../finder-patterns.js';
import { classifyFamily, scoreCubeTiling } from './family.js';
import {
  UNVERIFIED_CUBE_DETECTION,
  detectCentralCubeFinders,
  readCubeDigit,
  sampleCubeCell,
  sampleCubeGrid,
} from './cube-detect.js';
import { sampleHexCell, sampleHexGrid } from './grid-sample.js';
import { estimateHomography4, projectPoint } from './homography.js';
import { estimateLocalWarp, validateOReferences } from './reference-validate.js';
import { robustPercentiles } from './luma.js';
import { TONE_PATTERNS } from '../tonemap.js';

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
  // [미검증] 라이브 전처리의 960 기본 프레임과 1440 승격 프레임을 재축소하지 않는다.
  cellFinderMaxDimension: 1440,
  localWarpSearchRadiusCells: 0.10,
  localWarpSearchStepCells: 0.05,
});

const ECC_NAME = Object.freeze({ 0: 'L', 1: 'M', 2: 'H' });
const FAMILY_ORDER = Object.freeze({ hex: 0, tri: 1, cube: 2 });
const EPSILON = 1e-12;

function emitStage(options, stage, phase) {
  const fn = options && typeof options === 'object' ? options.onStage : null;
  if (typeof fn !== 'function') return;
  try { fn(stage, phase); } catch {
    // 계측 훅은 복호를 막지 않는다.
  }
}

function withStage(options, stage, fn) {
  emitStage(options, stage, 'enter');
  try {
    return fn();
  } finally {
    emitStage(options, stage, 'leave');
  }
}

/* 빈번한 기하 중앙값은 정렬·복사 대신 재사용 Float64 scratch quickselect를 쓴다. */
let medianValuesScratch = new Float64Array(0);
let medianOrderScratch = new Uint32Array(0);
let medianUseStableOrder = false;
let borderValuesScratch = new Float64Array(0);

function ensureMedianScratch(length) {
  if (medianValuesScratch.length >= length) return;
  medianValuesScratch = new Float64Array(length);
  medianOrderScratch = new Uint32Array(length);
}

function ensureBorderScratch(length) {
  if (borderValuesScratch.length >= length) return;
  borderValuesScratch = new Float64Array(length);
}

function swapMedianScratch(left, right) {
  const value = medianValuesScratch[left];
  medianValuesScratch[left] = medianValuesScratch[right];
  medianValuesScratch[right] = value;
  const order = medianOrderScratch[left];
  medianOrderScratch[left] = medianOrderScratch[right];
  medianOrderScratch[right] = order;
}

function compareMedianScratch(left, right) {
  const leftValue = medianValuesScratch[left];
  const rightValue = medianValuesScratch[right];
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return medianOrderScratch[left] - medianOrderScratch[right];
}

function swapMedianValues(left, right) {
  const value = medianValuesScratch[left];
  medianValuesScratch[left] = medianValuesScratch[right];
  medianValuesScratch[right] = value;
}

function numericMedianOfThree(left, middle, right) {
  const a = medianValuesScratch[left];
  const b = medianValuesScratch[middle];
  const c = medianValuesScratch[right];
  if (a < b) {
    if (b < c) return b;
    return a < c ? c : a;
  }
  if (a < c) return a;
  return b < c ? c : b;
}

function selectNumericMedianKth(length, rank) {
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    const pivot = numericMedianOfThree(left, middle, right);
    let less = left;
    let scan = left;
    let greater = right;
    while (scan <= greater) {
      const value = medianValuesScratch[scan];
      if (value < pivot) {
        swapMedianValues(less, scan);
        less += 1;
        scan += 1;
      } else if (value > pivot) {
        swapMedianValues(scan, greater);
        greater -= 1;
      } else {
        scan += 1;
      }
    }
    if (rank < less) right = less - 1;
    else if (rank > greater) left = greater + 1;
    else return medianValuesScratch[rank];
  }
  return medianValuesScratch[left];
}

function selectStableMedianKth(length, rank) {
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (compareMedianScratch(left, middle) > 0) swapMedianScratch(left, middle);
    if (compareMedianScratch(left, right) > 0) swapMedianScratch(left, right);
    if (compareMedianScratch(middle, right) > 0) swapMedianScratch(middle, right);

    const pivotValue = medianValuesScratch[middle];
    const pivotOrder = medianOrderScratch[middle];
    let i = left;
    let j = right;
    while (i <= j) {
      while (
        medianValuesScratch[i] < pivotValue
        || (!(medianValuesScratch[i] > pivotValue) && medianOrderScratch[i] < pivotOrder)
      ) i += 1;
      while (
        medianValuesScratch[j] > pivotValue
        || (!(medianValuesScratch[j] < pivotValue) && medianOrderScratch[j] > pivotOrder)
      ) j -= 1;
      if (i <= j) {
        swapMedianScratch(i, j);
        i += 1;
        j -= 1;
      }
    }
    if (rank <= j) right = j;
    else if (rank >= i) left = i;
    else return medianValuesScratch[rank];
  }
  return medianValuesScratch[left];
}

function selectMedianKth(length, rank) {
  return medianUseStableOrder
    ? selectStableMedianKth(length, rank)
    : selectNumericMedianKth(length, rank);
}

function prepareMedianValues(values, length = values.length) {
  ensureMedianScratch(length);
  let stableOrder = false;
  for (let i = 0; i < length; i += 1) {
    const value = values[i];
    medianValuesScratch[i] = value;
    if (Number.isNaN(value) || (value === 0 && 1 / value === -Infinity)) stableOrder = true;
  }
  medianUseStableOrder = stableOrder;
  if (stableOrder) {
    for (let i = 0; i < length; i += 1) medianOrderScratch[i] = i;
  }
}

function medianFromPreparedValues(length) {
  if (length === 0) return null;
  const middle = Math.floor(length / 2);
  const upper = selectMedianKth(length, middle);
  return length % 2 === 1
    ? upper
    : (selectMedianKth(length, middle - 1) + upper) / 2;
}

function medianFromValues(values, length) {
  if (length === 0) return null;
  prepareMedianValues(values, length);
  return medianFromPreparedValues(length);
}

function calibration(options) {
  const supplied = options && options.calibration && typeof options.calibration === 'object'
    ? options.calibration
    : {};
  return { ...UNVERIFIED_BOOTSTRAP_CALIBRATION, ...supplied };
}

function median(values) {
  if (values.length === 0) return null;
  return medianFromValues(values, values.length);
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
  if (hypothesis.cellSurface === true) {
    if (isCellSurfaceFinalId(hypothesis.cellSurfaceLayout)) {
      // 최종 라인업 — 한 쌍(2T/3T)뿐, 레이아웃 구분은 n 이 이미 했다.
      if (hypothesis.tones === 2 || hypothesis.tones === 3) {
        return [formatIndexCellSurfaceFinal(hypothesis.tones)];
      }
      return [formatIndexCellSurfaceFinal(2), formatIndexCellSurfaceFinal(3)];
    }
    if (hypothesis.cellSurfaceLayout) {
      if (hypothesis.tones === 2 || hypothesis.tones === 3) {
        return [formatIndexCellSurfaceLayout(hypothesis.cellSurfaceLayout, hypothesis.tones)];
      }
      return [
        formatIndexCellSurfaceLayout(hypothesis.cellSurfaceLayout, 2),
        formatIndexCellSurfaceLayout(hypothesis.cellSurfaceLayout, 3),
      ];
    }
    if (hypothesis.tones === 2 || hypothesis.tones === 3) {
      return [formatIndexCellSurface(hypothesis.tones)];
    }
    return [CELL_SURFACE_FORMAT_INDEX_2T, CELL_SURFACE_FORMAT_INDEX_3T];
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
  if (hypothesis && hypothesis.cellSurface === true
    && isCellSurfaceFinalFormatIndex(formatIndex)
    && finalLayoutIdForN(hypothesis.n) !== null) {
    // 최종 라인업 — formatIndex 는 한 쌍, 차원은 가설의 n 이 정한다.
    const tones = tonesFromCellSurfaceFinalFormatIndex(formatIndex);
    if (hypothesis.tones !== undefined && hypothesis.tones !== tones) return undefined;
    return {
      family: 'cube',
      dimension: hypothesis.n,
      spec: {
        name: nameCellSurfaceFinal(
          hypothesis.n,
          tones,
          // 가설이 최종 레이아웃 id 를 실었을 때만 그 이름 — 아니면 n 기본값.
          isCellSurfaceFinalId(hypothesis.cellSurfaceLayout)
            ? hypothesis.cellSurfaceLayout
            : undefined,
        ),
        version: versionForFinalN(hypothesis.n),
        n: hypothesis.n,
        tones,
        formatIndex,
      },
      formatIndices: [formatIndex],
    };
  }
  if (hypothesis && hypothesis.cellSurface === true
    && isCellSurfaceLayoutFormatIndex(formatIndex)) {
    const tones = tonesFromCellSurfaceLayoutFormatIndex(formatIndex);
    if (hypothesis.tones !== undefined && hypothesis.tones !== tones) return undefined;
    const layoutId = layoutIdFromFormatIndex(formatIndex);
    return {
      family: 'cube',
      dimension: CELL_SURFACE_LAYOUT_N,
      spec: {
        name: nameCellSurfaceLayout(layoutId, tones),
        version: CELL_SURFACE_LAYOUT_VERSION,
        n: CELL_SURFACE_LAYOUT_N,
        tones,
        formatIndex,
      },
      formatIndices: [formatIndex],
    };
  }
  if (hypothesis && hypothesis.cellSurface === true
    && isCellSurfaceFormatIndex(formatIndex)) {
    const tones = tonesFromCellSurfaceFormatIndex(formatIndex);
    if (hypothesis.tones !== undefined && hypothesis.tones !== tones) return undefined;
    return {
      family: 'cube',
      dimension: CELL_SURFACE_N,
      spec: {
        name: nameCellSurface(tones),
        version: CELL_SURFACE_VERSION,
        n: CELL_SURFACE_N,
        tones,
        formatIndex,
      },
      formatIndices: [formatIndex],
    };
  }
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
  const { width, height, data, alpha } = luma;
  const left = Math.min(Math.max(0, inset), Math.floor((width - 1) / 2));
  const top = Math.min(Math.max(0, inset), Math.floor((height - 1) / 2));
  const right = width - 1 - left;
  const bottom = height - 1 - top;
  const capacity = 2 * (right - left + 1) + 2 * Math.max(0, bottom - top - 1);
  ensureBorderScratch(capacity);
  let length = 0;

  for (let x = left; x <= right; x += 1) {
    let index = top * width + x;
    if (!alpha || alpha[index] !== 0) {
      const value = data[index];
      if (Number.isFinite(value)) {
        borderValuesScratch[length] = value;
        length += 1;
      }
    }
    index = bottom * width + x;
    if (!alpha || alpha[index] !== 0) {
      const value = data[index];
      if (Number.isFinite(value)) {
        borderValuesScratch[length] = value;
        length += 1;
      }
    }
  }
  for (let y = top + 1; y < bottom; y += 1) {
    let index = y * width + left;
    if (!alpha || alpha[index] !== 0) {
      const value = data[index];
      if (Number.isFinite(value)) {
        borderValuesScratch[length] = value;
        length += 1;
      }
    }
    index = y * width + right;
    if (!alpha || alpha[index] !== 0) {
      const value = data[index];
      if (Number.isFinite(value)) {
        borderValuesScratch[length] = value;
        length += 1;
      }
    }
  }
  return medianFromValues(borderValuesScratch, length);
}
/*
 * `outlineEvidence` 는 한 복호에서 여러 번 불린다 — 재배치 재시도와 finder 해상도
 * 재시도가 `enumerateGeometryHypotheses` 를 다시 돌리기 때문이다(실측: Type O 4회,
 * Type A 최대 11회). 함수는 (luma, cfg 두 값)의 **순수 함수**이므로 같은 luma
 * 객체에 대해 결과를 재사용한다. 반환 객체는 호출부가 읽기만 한다.
 */
const outlineEvidenceCache = new WeakMap();

function outlineEvidence(luma, cfg) {
  const cached = outlineEvidenceCache.get(luma);
  if (cached !== undefined
    && cached.thresholdFraction === cfg.outlineThresholdFraction
    && cached.minimumPixels === cfg.minimumOutlinePixels) {
    return cached.value;
  }
  const value = computeOutlineEvidence(luma, cfg);
  outlineEvidenceCache.set(luma, {
    thresholdFraction: cfg.outlineThresholdFraction,
    minimumPixels: cfg.minimumOutlinePixels,
    value,
  });
  return value;
}

function computeOutlineEvidence(luma, cfg) {
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

  /*
   * 픽셀당 비교를 줄인 판정. 값은 원본과 같다.
   *   · `Math.abs(d) <= threshold` → `d <= t && d >= -t` (NaN 거동도 동일).
   *   · minX/maxX 는 행 안에서 먼저 좁힌 뒤 행 단위로만 합친다.
   *   · touchesBorder 는 픽셀마다 네 번 비교하던 것을 **경계 상자에서 유도**한다 —
   *     테두리에 전경 픽셀이 있다는 것과 상자가 테두리에 닿는다는 것은 동치다.
   */
  const { width, height, data, alpha } = luma;
  const lastX = width - 1;
  const negativeThreshold = -threshold;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let rowFirstX = -1;
    let rowLastX = -1;
    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      if (alpha && alpha[index] === 0) continue;
      const delta = data[index] - background;
      if (delta <= threshold && delta >= negativeThreshold) continue;
      area += 1;
      if (rowFirstX < 0) rowFirstX = x;
      rowLastX = x;
    }
    if (rowFirstX < 0) continue;
    if (rowFirstX < minX) minX = rowFirstX;
    if (rowLastX > maxX) maxX = rowLastX;
    if (y < minY) minY = y;
    maxY = y;
  }
  const touchesBorder = maxX >= 0
    && (minX === 0 || minY === 0 || maxX === lastX || maxY === height - 1);

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

  // 경계·버퍼 참조는 안쪽 루프 밖으로. 값은 원본 그대로다.
  const sourceWidth = luma.width;
  const sourceHeight = luma.height;
  const sourceData = luma.data;
  const sourceAlpha = luma.alpha;

  for (let y = 0; y < height; y += 1) {
    const yStart = y * factor;
    const yEnd = Math.min(sourceHeight, yStart + factor);
    for (let x = 0; x < width; x += 1) {
      const xStart = x * factor;
      const xEnd = Math.min(sourceWidth, xStart + factor);
      let sum = 0;
      let count = 0;
      let minimumAlpha = 255;
      if (sourceAlpha) {
        for (let sourceY = yStart; sourceY < yEnd; sourceY += 1) {
          const row = sourceY * sourceWidth;
          for (let sourceX = xStart; sourceX < xEnd; sourceX += 1) {
            const sourceIndex = row + sourceX;
            const a = sourceAlpha[sourceIndex];
            if (a > 0) {
              sum += sourceData[sourceIndex];
              count += 1;
            }
            if (a < minimumAlpha) minimumAlpha = a;
          }
        }
      } else {
        for (let sourceY = yStart; sourceY < yEnd; sourceY += 1) {
          const row = sourceY * sourceWidth;
          for (let sourceX = xStart; sourceX < xEnd; sourceX += 1) {
            sum += sourceData[row + sourceX];
            count += 1;
          }
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

function discoverCellFinders(luma, fullOutline, options, cfg) {
  if (options.cellFinder === false || options._disableCellFinder === true) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'cell-finder-disabled',
      cause: 'disabled-by-caller',
    });
  }
  const overrides = options.cellFinder && typeof options.cellFinder === 'object'
    ? options.cellFinder
    : {};
  const maxDimension = Number.isFinite(options.cellFinderMaxDimension)
    ? options.cellFinderMaxDimension
    : cfg.cellFinderMaxDimension;
  const stableBounds = fullOutline && !fullOutline.touchesBorder
    && fullOutline.borderDisagreement <= fullOutline.threshold
    ? fullOutline.bounds
    : null;
  const reduced = downsampleLuma(luma, maxDimension, stableBounds);
  const reducedOutline = outlineEvidence(reduced.luma, cfg);
  const centerSeeds = [];
  if (reducedOutline && !reducedOutline.touchesBorder) {
    centerSeeds.push({
      x: (reducedOutline.bounds.minX + reducedOutline.bounds.maxX) / 2,
      y: (reducedOutline.bounds.minY + reducedOutline.bounds.maxY) / 2,
    });
  }
  const reducedOutlineCanSeed = reducedOutline
    && !reducedOutline.touchesBorder
    && reducedOutline.borderDisagreement <= reducedOutline.threshold;
  const radiusSeeds = reducedOutlineCanSeed
    ? finderRadiusSeeds(reduced.luma, reducedOutline)
    : undefined;
  const cellSizeSeeds = radiusSeeds
    ? radiusSeeds.map((radius) => radius / Math.sqrt(13))
    : undefined;
  let detected = detectCellFinders(reduced.luma, FINDER_CELL_MASK_PATTERNS, {
    centerSeeds,
    cellSizeSeeds,
    ...overrides,
  });
  const callerFixedScaleSearch = Object.prototype.hasOwnProperty.call(
    overrides,
    'cellSizeSeeds',
  );
  if (!detected.ok && cellSizeSeeds !== undefined && !callerFixedScaleSearch) {
    detected = detectCellFinders(reduced.luma, FINDER_CELL_MASK_PATTERNS, {
      centerSeeds,
      ...overrides,
    });
  }
  if (!detected.ok) return detected;
  const finders = detected.candidates
    .map((finder) => liftFinder(finder, reduced.factor))
    .filter(Boolean);
  return finders.length > 0 ? ok({
    finders,
    source: reduced.factor === 1 ? 'cell-mask-detected' : 'cell-mask-detected-downsampled',
    downsampleFactor: reduced.factor,
    cellFinderDiagnostics: detected.diagnostics,
  }) : fail(FRONTEND_FAILURE.NO_FINDER, { stage: 'cell-finder-lift' });
}

function discoverCentralCubeFinders(luma, options) {
  if (options.centralCubeFinder === false) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'central-cube-finder-disabled',
      cause: 'disabled-by-caller',
    });
  }
  const overrides = options.centralCubeFinder
    && typeof options.centralCubeFinder === 'object'
    ? options.centralCubeFinder
    : {};
  const detected = detectCentralCubeFinders(luma, overrides);
  if (!detected.ok) return detected;
  return detected.candidates.length > 0 ? ok({
    finders: detected.candidates,
    source: 'central-cube-detected',
    centralCubeFinderDiagnostics: detected.diagnostics,
  }) : fail(FRONTEND_FAILURE.NO_FINDER, {
    stage: 'central-cube-finder-empty',
  });
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

  const makeFinderOptions = (useOutlineSeeds, reducedOutline, searchLuma) => {
    /*
     * 레벨 수는 «예산» 이 아니라 «닿는 거리» 다. 레벨 하나가 한 옥타브(~24px)만 맡으므로
     * 상수로 고정하면 탐색이 24·2^(n-1) px 에서 끊기고, 그보다 큰 파인더는 **제안조차
     * 안 만들어진다**. 실측(2026-08-13): 파인더 반지름 76~136px 실사진이 1~2레벨에서
     * 전멸했다. 설정값은 하한으로 두고 이미지가 요구하는 깊이까지 올린다 —
     * 깊은 레벨은 픽셀이 1/4씩 줄어 거의 공짜다.
     */
    const configuredLevels = useOutlineSeeds
      ? cfg.finderPyramidLevels
      : cfg.finderClutterPyramidLevels;
    const configured = {
      maxPyramidLevels: searchLuma
        ? Math.max(configuredLevels, pyramidLevelsForImage(searchLuma))
        : configuredLevels,
      maxRefinedProposals: useOutlineSeeds
        ? cfg.finderMaxRefinedProposals
        : cfg.finderClutterMaxRefinedProposals,
      refineIterations: cfg.finderRefineIterations,
      projectiveSeeds: cfg.finderProjectiveSeeds,
      // 스캐너는 «이 코드가 하이브리드인가» 를 미리 모른다. 순수 링(0)과 하이브리드
      // (안쪽 2밴드가 큐브)를 **같은 제안 위에서** 둘 다 채점하고 점수로 고른다.
      // 제안 단계는 한 번만 돌므로 추가 비용은 싼 검증 쪽뿐이다.
      ringLayouts: [0, HYBRID_INNER_CUBE_BANDS],
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
  const shouldTryPatternFinder = !detected.ok;

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
  /*
   * 마지막 수단 — **탐색 커버를 이미지에서 유도해** 다시 한 번. 레벨 하나가 한
   * 옥타브(~24px)만 맡으므로 상수 깊이(1~2)는 24·48px 에서 끊긴다. 실사진 파인더가
   * 76~136px 여서 «크게 찍을수록 안 읽히는» 상태였다(2026-08-13 실측).
   *
   * ⚠ 깊이를 **항상** 올리면 안 된다. 제안이 늘어난 만큼 정제 예산(1×레이아웃)을 두고
   *   경쟁이 심해져, 통과하던 Type Y 실사진이 상위 2위 밖으로 밀려 죽었다. 그래서
   *   앞 시도가 전부 실패했을 때만 켠다 — 통과하던 경로는 한 줄도 안 바뀐다.
   */
  if (!detected.ok && !callerFixedScaleSearch) {
    const deeper = pyramidLevelsForImage(reduced.luma);
    if (deeper > (finderOptions.maxPyramidLevels ?? 1)) {
      detected = detectBullseyes(reduced.luma, {
        ...finderOptions,
        maxPyramidLevels: deeper,
      });
    }
  }
  const centralCubeDetected = shouldTryPatternFinder
    ? discoverCentralCubeFinders(luma, options)
    : null;
  const cellDetected = shouldTryPatternFinder
    ? discoverCellFinders(luma, fullOutline, options, cfg)
    : null;
  const patternFinders = [];
  if (centralCubeDetected && centralCubeDetected.ok) {
    patternFinders.push(...centralCubeDetected.finders);
  }
  if (cellDetected && cellDetected.ok) patternFinders.push(...cellDetected.finders);
  if (!detected.ok) {
    if (patternFinders.length > 0) {
      return ok({
        finders: patternFinders,
        source: centralCubeDetected && centralCubeDetected.ok
          ? 'central-cube-detected'
          : 'cell-mask-detected',
        centralCubeFinderMerged: Boolean(centralCubeDetected && centralCubeDetected.ok),
        cellFinderMerged: Boolean(cellDetected && cellDetected.ok),
      });
    }
    return detected;
  }
  const finders = detected.candidates
    .map((finder) => liftFinder(finder, reduced.factor))
    .filter(Boolean)
    .map((finder) => {
      if (usedOutlineSeeds || reduced.factor === 1) return finder;
      /*
       * ⚠ **레이아웃을 같이 넘겨야 한다.** 이 재정제는 축소본에서 찾은 후보를 원본
       *   해상도로 다시 맞추는 단계인데, `innerBandsReplaced` 를 빼먹으면 하이브리드를
       *   순수 6밴드 불스아이로 재채점한다 — 큐브가 들어앉은 안쪽 두 밴드를 «링인데
       *   교대가 깨졌다» 로 읽으니 중심·스케일이 끌려간다. 후보를 그대로 주입하면
       *   4/12 → 8/12 였다(2026-08-13 실측). 제안·검증에 이어 **세 번째로** 같은
       *   «두 단계가 같은 레이아웃을 봐야 한다» 자리다.
       */
      const fullResolution = refineBullseye(luma, finder, {
        refineIterations: 0,
        projectiveSeeds: false,
        innerBandsReplaced: finder.innerBandsReplaced ?? 0,
      });
      return fullResolution.ok
        ? { ...fullResolution.candidate, innerBandsReplaced: finder.innerBandsReplaced ?? 0 }
        : finder;
    });
  finders.push(...patternFinders);
  if (finders.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { stage: 'bootstrap-finder-lift' });
  }
  return ok({
    finders,
    source: usedOutlineSeeds
      ? reduced.factor === 1 ? 'detected' : 'detected-downsampled'
      : reduced.factor === 1 ? 'detected-multiscale' : 'detected-multiscale-downsampled',
    downsampleFactor: reduced.factor,
    cellFinderMerged: Boolean(cellDetected && cellDetected.ok),
    centralCubeFinderMerged: Boolean(centralCubeDetected && centralCubeDetected.ok),
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
  // 원본은 광선 위에서 전경을 만날 때마다 `{x,y,distance}` 객체를 새로 만들었다.
  // 결국 **마지막 하나만** 쓰이므로 거리만 들고 있다가 끝에서 한 번 만든다.
  const { width, height, data, alpha } = luma;
  const background = outline.background;
  const threshold = outline.threshold;
  const centerX = center.x;
  const centerY = center.y;
  let lastDistance = -1;

  for (let distance = 0; distance <= maximum; distance += 0.5) {
    const x = Math.round(centerX + unitX * distance);
    const y = Math.round(centerY + unitY * distance);
    if (x < 0 || y < 0 || x >= width || y >= height) break;
    const index = y * width + x;
    if (alpha && alpha[index] === 0) continue;
    const delta = data[index] - background;
    if (delta > threshold || delta < -threshold) lastDistance = distance;
  }
  if (lastDistance < 0) return null;
  return {
    x: centerX + unitX * lastDistance,
    y: centerY + unitY * lastDistance,
    distance: lastDistance,
  };
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

/*
 * 파인더 풋프린트가 hex/tri 최소 심볼조차 프레임에 안 들어가면 예전엔 바로
 * symbol-clipped 였다. 실기기 704프레임 교차표: clipped 306건 전부 bbox 없음·
 * clip_side 빈 칸이다. 전경 outline 이 경계에 안 닿으면 잘림이 아니라
 * 잘못된 스케일의 파인더다.
 */
function shouldLabelSymbolClipped(luma, finders, outline) {
  if (!finders || finders.length === 0) return false;
  if (anySupportedSymbolFits(luma, finders)) return false;
  if (!outline || outline.touchesBorder !== true) return false;
  return true;
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

/*
 * finder가 닫혔는데 촬영 UI가 외곽 앵커를 덮으면 3/3 hard-all은 증거 없음과
 * 오염을 구분하지 못한다. 이 경로는 후보를 채택하지 않고, 영상 안에서 실제로
 * 표본화 가능한 유한 3(k) × 3(방향)만 후단 CRC·reference·RS 검증에 넘긴다.
 */
function weakAnchorHypotheses(luma, finder, family, options) {
  if (family !== 'hex') return [];
  const baseH = finderGeometry(finder);
  if (!baseH) return [];
  const cfg = calibration(options);
  const sampleOptions = {
    minSampleCount: cfg.anchorSampleMinCount,
    minProjectedMinorDiameter: cfg.anchorProjectedMinorDiameter,
    ...(options.sample || {}),
  };
  const hypotheses = [];

  for (const k of uniqueDimensions(family)) {
    for (const orientation of [0, 1, 2]) {
      const rotationDegrees = orientation * 120;
      const H = multiplyHomographies(baseH, rotationHomography(rotationDegrees));
      const anchorValidation = validateAnchorPattern(luma, H, k, sampleOptions);
      const allSampled = anchorValidation.observations.length === 3
        && anchorValidation.observations.every((observation) => observation.observed !== null);
      if (!allSampled) continue;
      const canonicalAnchors = anchorCells(k).map((cell) => ({ q: cell.q, r: cell.r }));
      const anchors = canonicalAnchors.map((cell) =>
        projectPoint(H, canonicalCenter(cell.q, cell.r)));
      if (anchors.some((point) => point === null)) continue;

      hypotheses.push({
        family,
        k,
        orientation,
        rotationDegrees,
        centerQr: Boolean(finder.centerQr),
        anchors,
        canonicalAnchors,
        H,
        canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
        geometryResidual: 0,
        anchorMargin: anchorValidation.separation / 3,
        anchorValidation,
        anchorEvidence: {
          mode: 'weak-bounded-fallback',
          sampledAnchorCount: 3,
          expectedMatchCount: anchorValidation.agreement,
          totalAnchorCount: 3,
        },
        hardChecks: {
          sampleCount: true,
          rankSeparation: false,
          expectedPattern: false,
          all: false,
        },
        hypothesisId: family + '-' + k + '-' + orientation,
      });
    }
  }
  return hypotheses;
}

function cellFinderHypotheses(luma, finder, family) {
  const H = finderTransform(finder);
  const patternFinder = finder.finderKind === 'cell-mask'
    || finder.finderKind === 'three-tone-cube';
  if (!H || !patternFinder || !['hex', 'tri'].includes(family)) return [];
  return uniqueDimensions(family).map((k) => ({
    family,
    k,
    orientation: finder.orientation,
    rotationDegrees: finder.rotationDegrees,
    centerQr: false,
    H,
    canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
    geometryResidual: Number.isFinite(finder.geometryResidual) ? finder.geometryResidual : 0,
    anchorMargin: finder.orientationMargin,
    orientationEvidence: {
      source: finder.orientationSource || 'finder-pattern',
      patternId: finder.patternId,
      margin: finder.orientationMargin,
    },
    finder,
    source: finder.finderKind === 'three-tone-cube' ? 'central-cube-finder' : 'cell-finder',
    hypothesisId: family + '-' + k + '-' + finder.finderKind + '-' + finder.patternId
      + '-' + (finder.geometryMode || 'affine'),
    luma,
  }));
}

export function directAnchorHypotheses(luma, finder, family, options) {
  const dimensions = uniqueDimensions(family);
  const detector = family === 'tri' ? findAAnchorHypotheses : findOAnchorHypotheses;
  const result = detector(luma, finder, dimensions, options.anchor || {});
  if (!result.ok) {
    const fallback = options.allowWeakAnchorFallback === true
      && result.reason === FRONTEND_FAILURE.NO_ANCHORS
      ? weakAnchorHypotheses(luma, finder, family, options)
      : [];
    return {
      hypotheses: fallback.map((raw) => ({
        ...raw,
        finder,
        source: 'anchor-fallback',
        luma,
      })),
      strictCount: 0,
      fallbackCount: fallback.length,
      failure: result,
    };
  }

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
  return {
    hypotheses,
    strictCount: hypotheses.length,
    fallbackCount: 0,
    diagnostics: result.diagnostics,
  };
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

  const patternFinders = finders.filter((finder) => finder
    && (finder.finderKind === 'cell-mask' || finder.finderKind === 'three-tone-cube'));
  if (patternFinders.length > 0) {
    const hasCentralCube = !patternFinders.some((finder) => finder.finderKind === 'cell-mask')
      && patternFinders.some(
        (finder) => finder.finderKind === 'three-tone-cube',
    );
    return ok({
      families: ['hex', 'tri'],
      classification: ok({
        family: hasCentralCube ? 'three-tone-cube' : 'cell-mask',
        hypotheses: patternFinders.map((finder) => ({
          finderKind: finder.finderKind,
          patternId: finder.patternId,
          orientation: finder.orientation,
          orientationMargin: finder.orientationMargin,
        })),
        diagnostics: { orientationSource: 'finder-pattern-or-three-tone-rank' },
      }),
      fallback: hasCentralCube ? 'central-cube-body-validated' : 'cell-mask-body-validated',
    });
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

function layoutForFamily(family, dimension, hypothesis) {
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
    if (hypothesis && hypothesis.cellSurface === true) {
      if (isCellSurfaceFinalId(hypothesis.cellSurfaceLayout)) {
        return {
          map: layoutMapCellSurfaceFinal(dimension, hypothesis.cellSurfaceLayout),
          dataCells: dataCellsInScanOrderCellSurfaceFinal(dimension, hypothesis.cellSurfaceLayout),
          type: 'Y',
        };
      }
      if (hypothesis.cellSurfaceLayout) {
        return {
          map: layoutMapCellSurfaceLayout(hypothesis.cellSurfaceLayout),
          dataCells: dataCellsInScanOrderCellSurfaceLayout(hypothesis.cellSurfaceLayout),
          type: 'Y',
        };
      }
      return {
        map: layoutMapCellSurface(),
        dataCells: dataCellsInScanOrderCellSurface(),
        type: 'Y',
      };
    }
    if (hypothesis && hypothesis.window === true) {
      const dataCells = windowedDataCells(dimension, hypothesis.tones);
      const map = new Map(
        dataCells.map((cell, index) => [
          cell.i + ',' + cell.j,
          { role: 'data', index },
        ]),
      );
      return { map, dataCells, type: 'Y' };
    }
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

/*
 * scene.js가 19셀 슬롯의 최대 보호 정사각을 48회 이분탐색하고 0.995 여유를
 * 적용해 얻는 QR 모듈 피치/cellSize. 중앙 QR 세 파인더를 셀 좌표로 옮기는 와이어 값이다.
 */
const CENTER_QR_MODULE_TO_CELL = 0.2247900722;
const Y_WINDOW_N = 25;
const Y_WINDOW_TONES = 2;
const Y_WINDOW_FINDER_COORDS = Object.freeze({
  shared: Object.freeze({ i: 22.75, j: 22.75 }),
  axisA: Object.freeze({ i: 15.75, j: 22.75 }),
  axisB: Object.freeze({ i: 22.75, j: 15.75 }),
});

function affineHomographyFromThree(canonical, observed) {
  const ux = canonical[1].x - canonical[0].x;
  const uy = canonical[1].y - canonical[0].y;
  const vx = canonical[2].x - canonical[0].x;
  const vy = canonical[2].y - canonical[0].y;
  const det = ux * vy - uy * vx;
  if (Math.abs(det) <= EPSILON) return null;
  const imageU = {
    x: observed[1].x - observed[0].x,
    y: observed[1].y - observed[0].y,
  };
  const imageV = {
    x: observed[2].x - observed[0].x,
    y: observed[2].y - observed[0].y,
  };
  const a = (imageU.x * vy - imageV.x * uy) / det;
  const b = (-imageU.x * vx + imageV.x * ux) / det;
  const d = (imageU.y * vy - imageV.y * uy) / det;
  const e = (-imageU.y * vx + imageV.y * ux) / det;
  return new Float64Array([
    a, b, observed[0].x - a * canonical[0].x - b * canonical[0].y,
    d, e, observed[0].y - d * canonical[0].x - e * canonical[0].y,
    0, 0, 1,
  ]);
}

function qrCenterHomographies(candidate) {
  const offset = 7 * CENTER_QR_MODULE_TO_CELL;
  const canonical = [
    { x: -offset, y: -offset },
    { x: offset, y: -offset },
    { x: -offset, y: offset },
  ];
  return [
    [candidate.shared, candidate.axisA, candidate.axisB],
    [candidate.shared, candidate.axisB, candidate.axisA],
  ].map((observed) => affineHomographyFromThree(canonical, observed))
    .filter(Boolean);
}

function yTopPoint(cell) {
  return {
    x: (SQRT3 / 2) * (cell.i - cell.j),
    y: -0.5 * (cell.i + cell.j),
  };
}

function qrWindowHomographies(candidate) {
  const canonical = [
    yTopPoint(Y_WINDOW_FINDER_COORDS.shared),
    yTopPoint(Y_WINDOW_FINDER_COORDS.axisA),
    yTopPoint(Y_WINDOW_FINDER_COORDS.axisB),
  ];
  return [
    [candidate.shared, candidate.axisA, candidate.axisB],
    [candidate.shared, candidate.axisB, candidate.axisA],
  ].map((observed) => affineHomographyFromThree(canonical, observed))
    .filter(Boolean);
}

function medianOrNaN(values) {
  return values.length > 0 ? median(values) : NaN;
}

function calibrateWindowReferences(luma, hypothesis, options = {}) {
  const cells = windowedReferenceCellsY(Y_WINDOW_N, Y_WINDOW_TONES);
  const samples = new Map();
  for (const cell of cells) {
    const sampled = sampleCubeCell(
      luma,
      hypothesis,
      cell.i,
      cell.j,
      cubeSampleOptions(options),
    );
    if (!sampled.ok) return null;
    samples.set(cell.i + ',' + cell.j, sampled);
  }

  const thresholds = {};
  const anchors = {};
  let minimumRatio = Infinity;
  let minimumSpan = Infinity;
  for (const face of ['T', 'L', 'R']) {
    const lows = [];
    const highs = [];
    for (const cell of cells) {
      const sample = samples.get(cell.i + ',' + cell.j);
      const bright = TONE_PATTERNS[cell.digit][face === 'T' ? 0 : face === 'L' ? 1 : 2];
      (bright ? highs : lows).push(sample[face].median);
    }
    const low = medianOrNaN(lows);
    const high = medianOrNaN(highs);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
    const span = high - low;
    const ratio = high / Math.max(low, EPSILON);
    thresholds[face] = low > 0 && high > 0
      ? Math.sqrt(low * high)
      : (low + high) / 2;
    anchors[face] = { low, high, lows, highs, span, ratio };
    minimumRatio = Math.min(minimumRatio, ratio);
    minimumSpan = Math.min(minimumSpan, span);
  }

  const provisional = { tones: Y_WINDOW_TONES, thresholds, anchors };
  let agreement = 0;
  const observations = [];
  for (const cell of cells) {
    const key = cell.i + ',' + cell.j;
    const read = readCubeDigit(samples.get(key), provisional);
    const matched = read !== null && read.digit === cell.digit;
    if (matched) agreement += 1;
    observations.push({
      key,
      expected: cell.digit,
      observed: read && read.digit,
      matched,
      margin: read && read.margin,
    });
  }
  const agreementRate = agreement / cells.length;
  const hardChecks = {
    toneSeparation:
      minimumSpan >= UNVERIFIED_CUBE_DETECTION.minimumToneSpan
      && minimumRatio >= UNVERIFIED_CUBE_DETECTION.minimumTwoToneRatio,
    referenceAgreement:
      agreementRate >= UNVERIFIED_CUBE_DETECTION.minimumReferenceAgreement,
  };
  hardChecks.all = hardChecks.toneSeparation && hardChecks.referenceAgreement;
  return {
    ...provisional,
    samples,
    agreement,
    total: cells.length,
    agreementRate,
    minimumRatio,
    minimumSpan,
    medianMargin: medianOrNaN(
      observations.map((entry) => entry.margin).filter(Number.isFinite),
    ),
    observations,
    hardChecks,
  };
}

function windowedDataCells(n, tones) {
  const references = new Set(
    windowedReferenceCellsY(n, tones).map((cell) => cell.i + ',' + cell.j),
  );
  const formats = new Set(
    windowedFormatCellsY(n).map((cell) => cell.i + ',' + cell.j),
  );
  const excluded = new Set(
    windowExcludedCellsY(n).map((cell) => cell.i + ',' + cell.j),
  );
  const cells = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const key = i + ',' + j;
      if (!references.has(key) && !formats.has(key) && !excluded.has(key)) {
        cells.push({ i, j });
      }
    }
  }
  return cells;
}




function qrWindowReferenceRefinedHypotheses(luma, qrResult, options = {}) {
  if (!qrResult || !qrResult.ok) return [];
  const canonicalQr = [
    yTopPoint(Y_WINDOW_FINDER_COORDS.shared),
    yTopPoint(Y_WINDOW_FINDER_COORDS.axisA),
    yTopPoint(Y_WINDOW_FINDER_COORDS.axisB),
  ];
  const windowCandidates = qrResult.candidates
    .filter((candidate) => candidate.kind === 'window')
    .slice(0, 1);
  const offsetUnits = [
    0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75,
    -1, 1, -1.25, 1.25, -1.5, 1.5,
  ];
  const hypotheses = [];

  windowCandidates.forEach((candidate, candidateIndex) => {
    const observedOrders = [
      [candidate.shared, candidate.axisA, candidate.axisB],
      [candidate.shared, candidate.axisB, candidate.axisA],
    ];
    observedOrders.forEach((observedQr, axisIndex) => {
      const affine = affineHomographyFromThree(canonicalQr, observedQr);
      if (!affine) return;
      const baseOrigin = projectPoint(affine, { x: 0, y: 0 });
      const baseStep = projectPoint(affine, { x: 1, y: 0 });
      if (!baseOrigin || !baseStep) return;
      const pitch = Math.hypot(
        baseStep.x - baseOrigin.x,
        baseStep.y - baseOrigin.y,
      );
      const refined = [];
      for (const dyUnits of offsetUnits) {
        for (const dxUnits of offsetUnits) {
          const observedOrigin = {
            x: baseOrigin.x + dxUnits * pitch,
            y: baseOrigin.y + dyUnits * pitch,
          };
          const H = estimateHomography4(
            [...canonicalQr, { x: 0, y: 0 }],
            [...observedQr, observedOrigin],
          );
          if (!H) continue;
          const base = {
            family: 'cube',
            n: Y_WINDOW_N,
            tones: Y_WINDOW_TONES,
            window: true,
            H,
            canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
          };
          const referenceCalibration = calibrateWindowReferences(luma, base, options);
          if (!referenceCalibration) continue;
          const adjustment = Math.hypot(dxUnits, dyUnits);
          const quality =
            (referenceCalibration.hardChecks.all ? 10000 : 0)
            + 100 * referenceCalibration.agreement
            + Math.max(0, referenceCalibration.minimumSpan)
            - 0.01 * adjustment;
          refined.push({
            ...base,
            referenceCalibration,
            quality,
            adjustment,
            dxUnits,
            dyUnits,
          });
        }
      }
      refined.sort((left, right) =>
        right.quality - left.quality
        || left.adjustment - right.adjustment
        || left.dyUnits - right.dyUnits
        || left.dxUnits - right.dxUnits);
      refined.slice(0, 12).forEach((entry, rank) => {
        hypotheses.push({
          ...entry,
          referenceSamples: entry.referenceCalibration.samples,
          geometryResidual: entry.adjustment * pitch,
          referenceRefinement: {
            mode: 'qr-fixed-fourth-point-grid',
            dxCells: entry.dxUnits,
            dyCells: entry.dyUnits,
            pitch,
            rank,
          },
          source: 'center-qr-window-reference-refined',
          hypothesisId:
            'qr-window-refined-c' + candidateIndex
            + '-a' + axisIndex + '-r' + rank,
          luma,
        });
      });
    });
  });
  return hypotheses;
}

function qrGeometryHypotheses(luma, qrResult, options = {}) {
  if (!qrResult || !qrResult.ok) return [];
  const hypotheses = [];
  qrResult.candidates.forEach((candidate, candidateIndex) => {
    if (candidate.kind === 'center') {
      qrCenterHomographies(candidate).forEach((H, axisIndex) => {
        const center = projectPoint(H, { x: 0, y: 0 });
        const xStep = projectPoint(H, { x: 1, y: 0 });
        const yStep = projectPoint(H, { x: 0, y: 1 });
        if (!center || !xStep || !yStep) return;
        const cellSize = median([
          Math.hypot(xStep.x - center.x, xStep.y - center.y),
          Math.hypot(yStep.x - center.x, yStep.y - center.y),
        ]);
        const finder = {
          center,
          cellSize,
          H,
          transform: H,
          centerQr: true,
          qrCandidate: candidate,
        };
        for (const family of ['hex', 'tri']) {
          for (const dimension of uniqueDimensions(family)) {
            hypotheses.push({
              family,
              k: dimension,
              orientation: axisIndex,
              rotationDegrees: 0,
              centerQr: true,
              H,
              canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
              geometryResidual: Math.max(0, candidate.score) * cellSize,
              finder,
              source: 'center-qr-finder',
              hypothesisId:
                'qr-center-' + family + '-' + dimension
                + '-c' + candidateIndex + '-a' + axisIndex,
              luma,
            });
          }
        }
      });
      return;
    }

    qrWindowHomographies(candidate).forEach((H, axisIndex) => {
      const base = {
        family: 'cube',
        n: Y_WINDOW_N,
        tones: Y_WINDOW_TONES,
        window: true,
        H,
        canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
      };
      const referenceCalibration = calibrateWindowReferences(luma, base, options);
      if (!referenceCalibration) return;
      const origin = projectPoint(H, { x: 0, y: 0 });
      const iStep = projectPoint(H, { x: 1, y: 0 });
      const pitch = origin && iStep
        ? Math.hypot(iStep.x - origin.x, iStep.y - origin.y)
        : candidate.module * 2;
      hypotheses.push({
        ...base,
        referenceCalibration,
        referenceSamples: referenceCalibration.samples,
        geometryResidual: Math.max(0, candidate.score) * pitch,
        source: 'center-qr-window-finder',
        hypothesisId:
          'qr-window-c' + candidateIndex + '-a' + axisIndex,
        luma,
      });
    });
  });
  return hypotheses;
}

/*
 * cube 경로가 실제로 읽는 옵션은 `options.family` 하나뿐이고, 그마저 없으면 빈 객체다.
 * 매번 새 `{}` 를 만들면 `scoreCubeTiling` 의 결과 캐시(family.js)가 옵션 동일성에서
 * 어긋나 재시도마다 전 검출을 다시 돌린다 — 그래서 고정 싱글턴을 쓴다.
 */
const EMPTY_FAMILY_OPTIONS = Object.freeze({});

function exhaustiveCubeFamilyOptions(options) {
  const family = options.family && typeof options.family === 'object'
    ? options.family
    : EMPTY_FAMILY_OPTIONS;
  if (family.cube && typeof family.cube === 'object') {
    return {
      ...family,
      cube: { ...family.cube, exhaustiveBlockRecovery: true },
    };
  }
  return { ...family, exhaustiveBlockRecovery: true };
}

export function enumerateGeometryHypotheses(luma, familyEvidence, options = {}) {
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
  const familyOptions = options.family && typeof options.family === 'object'
    ? options.family
    : EMPTY_FAMILY_OPTIONS;
  const cubeResult = scoreCubeTiling(luma, yJunctionEvidence, familyOptions);
  const finderResult = cubeResult.ok && options.alwaysCompareFinders !== true
    ? fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'bootstrap-finder',
      cause: 'cube-positive-independent-path',
    })
    : discoverFinders(luma, familyEvidence, options, cfg);
  /*
   * 큐브 경로가 이미 양성인데 QR 트리플까지 열면 가설이 200개 가까이 늘어
   * 포맷 검사만 수십 ms 다(실측 Type Y). 중앙 QR 세트는 큐브 양성이 아니라
   * 파인더 실패·셀마스크 쪽에서 이 분기를 탄다.
   */
  const shouldProbeQr = options._forceQrFinder === true
    || (!cubeResult.ok && !finderResult.ok)
    || finderResult.cellFinderMerged === true
    || (typeof finderResult.source === 'string'
      && finderResult.source.includes('cell-mask'));
  const qrResult = shouldProbeQr
    ? detectQrFinderTriples(luma, options.qrFinder || {})
    : fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'qr-finder',
      cause: 'existing-path-positive',
    });

  if (!finderResult.ok && !cubeResult.ok && !qrResult.ok) {
    const finderSawCandidates = finderResult.detail
      && Number.isFinite(finderResult.detail.evaluatedRaw)
      && finderResult.detail.evaluatedRaw > 0
      && finderResult.detail.hardChecks
      && finderResult.detail.hardChecks.alternating === true
      && finderResult.detail.hardChecks.outerBandLight === true;
    const bestCandidate = finderResult.detail && finderResult.detail.bestCandidate;
    if (finderSawCandidates
      && bestCandidate
      && shouldLabelSymbolClipped(luma, [bestCandidate], outline)) {
      return fail(FRONTEND_FAILURE.SYMBOL_CLIPPED, {
        stage: 'bootstrap-finder',
        cause: 'supported-symbol-footprint-crosses-image-boundary',
        finderFailure: finderResult,
        cubeFailure: cubeResult,
        qrFailure: qrResult,
        outline: outline && {
          area: outline.area,
          bounds: outline.bounds,
          touchesBorder: outline.touchesBorder,
          fillRatio: outline.fillRatio,
        },
      });
    }
    // cube-detect 는 이미 돌았다. finder 실패만 돌려 주면 geo_stage/detect_path 가
    // 프레임까지 전달되지 않는다(실기기 66프레임이 전부 빈 문자열이었던 구멍).
    const cubeDetail = cubeResult && cubeResult.detail && typeof cubeResult.detail === 'object'
      ? cubeResult.detail
      : {};
    const cubeDiag = (cubeDetail.diagnostics && typeof cubeDetail.diagnostics === 'object')
      ? cubeDetail.diagnostics
      : ((cubeResult && cubeResult.diagnostics) || {});
    return fail(finderResult.reason || FRONTEND_FAILURE.NO_FINDER, {
      ...(finderResult.detail || {}),
      stage: (finderResult.detail && finderResult.detail.stage) || 'bootstrap-finder',
      finderFailure: finderResult,
      cubeFailure: cubeResult,
      qrFailure: qrResult,
      geometryStage: cubeDetail.geometryStage || cubeDiag.geometryStage || null,
      detectPath: cubeDetail.detectPath || cubeDiag.detectPath || null,
    });
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
  } else if (cubeResult.ok) {
    classified = ok({
      families: ['cube'],
      classification: ok({
        family: 'cube',
        hypotheses: [cubeResult],
        diagnostics: { cubeOnly: true },
      }),
      cubeOnly: true,
    });
  } else {
    classified = ok({
      families: [],
      classification: ok({
        family: 'qr',
        hypotheses: [],
        diagnostics: { qrOnly: true },
      }),
      qrOnly: true,
    });
  }
  if (!classified.ok) return classified;

  const hypotheses = [];
  const deferredWeakHypotheses = [];
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
      const allowWeakAnchorFallback = options.allowWeakAnchorFallback === true
        || (options.allowWeakAnchorFallback !== false
          && (!outline || outline.touchesBorder));
      const patternHypotheses = cellFinderHypotheses(luma, finder, family);
      const direct = patternHypotheses.length > 0 ? {
        hypotheses: patternHypotheses,
        strictCount: patternHypotheses.length,
        fallbackCount: 0,
        diagnostics: {
          mode: 'finder-pattern',
          orientationSource: 'finder-pattern',
          patternId: finder.patternId,
        },
      } : directAnchorHypotheses(luma, finder, family, {
        ...options,
        allowWeakAnchorFallback,
      });
      direct.hypotheses.forEach((hypothesis) => {
        const annotated = { ...hypothesis, finderIndex };
        if (hypothesis.source === 'anchor-fallback') deferredWeakHypotheses.push(annotated);
        else hypotheses.push(annotated);
      });
      anchorDiagnostics.push({
        family,
        finderIndex,
        directCount: direct.hypotheses.length,
        strictCount: direct.strictCount,
        fallbackCount: direct.fallbackCount,
        directFailure: direct.failure,
      });

      if (family === 'hex'
        && (direct.strictCount === 0 || options.alwaysOutlineHypotheses === true)) {
        for (const k of uniqueDimensions('hex')) {
          silhouetteHypotheses(luma, finder, k, outline, options, cfg)
            .forEach((hypothesis) => hypotheses.push({ ...hypothesis, finderIndex }));
        }
      }
    }
  }

  hypotheses.push(...qrGeometryHypotheses(luma, qrResult, options));
  hypotheses.push(...qrWindowReferenceRefinedHypotheses(luma, qrResult, options));

  let unique = deduplicateHypotheses(hypotheses);
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
    unique = deduplicateHypotheses(deferredWeakHypotheses);
  }

  if (unique.length === 0) {
    const clipped = shouldLabelSymbolClipped(luma, finders, outline);
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
      qr: {
        ok: qrResult.ok,
        reason: qrResult.reason,
        diagnostics: qrResult.ok ? qrResult.diagnostics : qrResult.detail,
        hypothesisCount: hypotheses.filter((entry) =>
          typeof entry.source === 'string' && entry.source.startsWith('center-qr')).length,
        skipped: !shouldProbeQr,
      },
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
  const cells = cube
    ? hypothesis.cellSurface === true
      ? (isCellSurfaceFinalId(hypothesis.cellSurfaceLayout)
        ? formatCellsCellSurfaceFinal(hypothesis.n, hypothesis.cellSurfaceLayout)
        : hypothesis.cellSurfaceLayout
          ? formatCellsCellSurfaceLayout(hypothesis.cellSurfaceLayout)
          : formatCellsCellSurface())
      : hypothesis.window === true
        ? windowedFormatCellsY(hypothesis.n)
        : formatCellsY(hypothesis.n)
    : formatCells(hypothesis.k);
  // 포맷 15셀은 3중 복제다. 한 셀이 프레임 밖으로 잘려도 나머지 두 복제가
  // 살아 있으면 읽을 수 있어야 한다 — 잘린 자리는 null(소거)로 표시해
  // format-proposals 의 다수결 표에서 **빼고**, 0 으로 위장시키지 않는다.
  const samples = [];
  const observedDigits = [];
  const erasedCells = [];
  for (const cell of cells) {
    const sampled = cube
      ? sampleCubeCell(luma, hypothesis, cell.i, cell.j, cubeSampleOptions(options))
      : sampleHexCell(luma, hypothesis, cell.q, cell.r, options.sample || {});
    samples.push(sampled);
    if (!sampled.ok) {
      observedDigits.push(null);
      erasedCells.push({ cell, reason: sampled.reason, cause: 'unsampled-format-cell' });
      continue;
    }
    if (cube) {
      const read = readCubeDigit(sampled, hypothesis.referenceCalibration);
      if (read === null) {
        observedDigits.push(null);
        erasedCells.push({
          cell,
          reason: FRONTEND_FAILURE.NO_FORMAT_CANDIDATE,
          cause: 'illegal-two-tone-triple-or-unreadable-three-tone-rank',
        });
        continue;
      }
      observedDigits.push(read.digit);
    } else {
      observedDigits.push(sampleToDigit(sampled));
    }
  }
  if (erasedCells.length === cells.length) {
    // 15셀 전부가 소거면 포맷을 주장할 근거가 하나도 없다 — 예전처럼 실패한다.
    return fail(erasedCells[0].reason, {
      stage: 'format-sampling',
      hypothesisId: hypothesis.hypothesisId,
      cell: erasedCells[0].cell,
      cause: 'all-format-cells-unsampled',
      erasedFormatCells: erasedCells.length,
    });
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
      erasedFormatCells: erasedCells.length,
      diagnostics: enumerated.diagnostics,
    });
  }
  return ok({
    hypothesis,
    reads,
    samples,
    erasedFormatCells: erasedCells,
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
  const cubeSolutions = new Map();
  for (const candidate of candidates) {
    if (candidate.family !== 'cube') continue;
    const orientation = candidate.hypothesis?.orientation;
    const tones = candidate.tones ?? candidate.hypothesis?.tones;
    if (!Number.isInteger(orientation) || !Number.isInteger(tones)) continue;
    const key = JSON.stringify([
      tones,
      candidate.formatIndex,
      candidate.eccLevel,
      candidate.text,
    ]);
    const existing = cubeSolutions.get(key);
    if (existing) {
      if (!existing.orientations.includes(orientation)) {
        existing.orientations.push(orientation);
        existing.orientations.sort((left, right) => left - right);
      }
    } else {
      cubeSolutions.set(key, {
        tones,
        formatIndex: candidate.formatIndex,
        eccLevel: candidate.eccLevel,
        orientations: [orientation],
      });
    }
  }
  if (cubeSolutions.size > 1) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'selection',
      pipelineCode: 'CUBE_DIRECTION_AMBIGUOUS',
      solutions: [...cubeSolutions.values()],
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
    const formatRead = withStage(options, 'format', () =>
      readFormatForHypothesis(luma, hypothesis, options));
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
    const layout = layoutForFamily(hypothesis.family, dimension, hypothesis);
    if (!layout) continue;
    // 프레임 밖으로 잘린 셀에서 가설 전체를 죽이지 않는다 — 그 셀만 RS 소거로
    // 넘긴다 (sample-starved 구제). 한 셀도 못 읽으면 여전히 실패한다.
    const grid = withStage(options, 'decode', () => (cube
      ? sampleCubeGrid(luma, hypothesis, layout.map, {
        ...cubeSampleOptions(options), collectUnsampled: true,
      })
      : sampleHexGrid(luma, hypothesis, layout.map, {
        ...(options.sample || {}), collectUnsampled: true,
      })));
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
    const unsampledCells = [];
    const erasureCells = [];
    for (const cell of layout.dataCells) {
      const key = cube ? cell.i + ',' + cell.j : cell.q + ',' + cell.r;
      const sample = grid.cells.get(key);
      const scanIndex = digits.length;
      if (sample === undefined) {
        // 프레임 밖(또는 표본 기아)이라 이 셀은 관측 자체가 없다. 결정적 0을
        // 넣되 **위치를 RS 소거로 넘겨** 패리티를 오류의 절반만 쓰게 한다.
        digits.push(0);
        unsampledCells.push({ cell, cause: 'unsampled-cell' });
        erasureCells.push(scanIndex);
        continue;
      }
      if (cube) {
        const read = readCubeDigit(sample, hypothesis.referenceCalibration);
        if (read === null) {
          // 000/111은 Type Y 2톤 알파벳 밖이다. 위치를 보존한 결정적 0으로
          // 넘기고, 그 위치는 RS 소거로 표시한다.
          digits.push(0);
          cubeUnreadableCells.push({ cell, cause: 'illegal-tone-triple' });
          erasureCells.push(scanIndex);
        } else {
          digits.push(read.digit);
        }
      } else {
        digits.push(sampleToDigit(sample));
      }
    }

    const referenceResult = withStage(options, 'verify', () =>
      referenceReportFor(hypothesis, grid, options));
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
        decodeFormat.window = hypothesis.window === true;
        if (hypothesis.cellSurface === true) {
          decodeFormat.cellSurface = true;
          decodeFormat.locatorProfile = hypothesis.locatorProfile || 'cell-surface-v1';
          if (hypothesis.cellSurfaceLayout) {
            decodeFormat.cellSurfaceLayout = hypothesis.cellSurfaceLayout;
          }
        }
      } else {
        decodeFormat.k = dimension;
      }
      const decoded = withStage(options, 'decode', () =>
        decodeCells(digits, decodeFormat, { erasureCells }));
      if (!decoded.ok) {
        diagnostics.bodyFailures.push({
          hypothesisId: hypothesis.hypothesisId,
          versionIndex: formatCandidate.versionIndex,
          eccLevel: formatCandidate.eccLevel,
          reason: decoded.reason,
          cubeUnreadableCount: cubeUnreadableCells.length,
          unsampledCount: unsampledCells.length,
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
        cubeSamplingFallback: cubeUnreadableCells.length > 0 || unsampledCells.length > 0
          ? {
            mode: 'deterministic-zero-digit-rs-erasure',
            cells: cubeUnreadableCells,
            unsampledCells,
            erasureCellCount: erasureCells.length,
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
/** 포맷 재라벨로 만들 수 있는 가설 수 상한 — QR 잡음이 후보를 부풀리지 못하게 한다. */
const FORMAT_RECAST_MAX = 12;

/**
 * **포맷 재라벨** — 이미 «좋은 H» 를 든 가설이 남의 패밀리 포맷을 CRC 까지 맞춰 읽었다면,
 * H 는 그대로 두고 **패밀리·차원 라벨만** 갈아 끼운 가설을 낸다.
 *
 * 왜 패밀리 재배치(`relocationTargets`)만으로는 부족한가 — 측정으로 확인한 것:
 *
 *   Type A(tri) 는 앵커 3셀이 중심에서 `3k` 라, 파인더 H 의 상대 오차가 `3k` 로 증폭돼
 *   `findAAnchorHypotheses` 의 3/3 하드체크가 깨진다. 그런데 **같은 H** 로 만들어진
 *   hex 가설은 앵커가 `k√3`(√3배 가깝다) 라 살아남는다. 포맷 셀은 `formatCells(k)` 의
 *   **ring 3** — 패밀리와 무관하게 같은 15칸이라, 그 hex 가설이 A 의 포맷을
 *   **3/3 합의 + CRC 통과**로 정확히 읽는다. 그러고도 `validVersionIndices` 가
 *   hex 집합 밖이라며 CRC 검사 **전에** 버린다.
 *
 *   실측 (A2 · ppu=12 · 무왜곡): `hex-10-0` 이 `[2,0,0,5,5]`×3 을 읽고 versionIndex
 *   **13 = A2** 로 CRC 통과. 참 H 대비 ring3 오차 0.24셀 · 꼭짓점 오차 0.66셀.
 *
 *   그런데 `relocationTargets` 는 `attemptedFamilies` 에 tri 가 이미 있으면 건너뛴다.
 *   쓰레기 `cell-finder` tri 가설(참 H 대비 ring3 20셀 오차)이 그 집합에 tri 를 넣어
 *   두므로, 재배치는 «tri 는 해봤다» 며 발동하지 않는다. 설령 발동해도 기하를 다시
 *   열거할 뿐이라 같은 앵커 게이트에서 또 죽는다.
 *
 * 그래서 «기하를 다시 만드는» 대신 **이미 검증된 그 H 를 재사용**한다.
 * 안전성: 재라벨 가설도 포맷 CRC → reference 검증 → 본문 RS(GF(211)) 를 전부 통과해야
 * 후보가 된다. 그리고 이 함수는 **검증이 이미 실패한 뒤에만** 불리므로 정상 경로
 * (Type O 포함) 비용은 0 이다.
 */
function recastHypothesesByFormat(hypotheses, validated) {
  const failures = (validated.detail && validated.detail.diagnostics
    && validated.detail.diagnostics.formatFailures) || [];
  if (failures.length === 0) return [];
  const byId = new Map(hypotheses.map((hypothesis) => [hypothesis.hypothesisId, hypothesis]));
  const everyIndex = allFormatIndices();
  const recast = [];
  const seen = new Set();

  for (const failure of failures) {
    if (recast.length >= FORMAT_RECAST_MAX) break;
    const reads = failure.detail && failure.detail.reads;
    const source = byId.get(failure.hypothesisId);
    // cube 는 격자 파라미터화(canonicalSpace)가 달라 라벨만 갈아 끼울 수 없다.
    if (!source || source.family === 'cube') continue;
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
        if (owner.family === 'cube') continue;
        if (owner.family === source.family && owner.dimension === source.k) continue;
        for (const centerQr of [false, true]) {
          const candidate = {
            ...source,
            family: owner.family,
            k: owner.dimension,
            centerQr,
          };
          // 라벨 조합이 실제로 이 인덱스를 소유하는지는 기존 규칙에 물어본다.
          if (!validVersionIndices(candidate).includes(proposal.versionIndex)) continue;
          const id = `${source.hypothesisId}~recast-${owner.family}-${owner.dimension}`
            + (centerQr ? '-qr' : '');
          if (seen.has(id)) continue;
          seen.add(id);
          candidate.hypothesisId = id;
          candidate.source = `${source.source}+format-recast`;
          // 크기 증거는 옛 패밀리 기준이라 그대로 쓰면 안 된다. 없으면 rK=1 로 떨어진다.
          delete candidate.sizeGeometry;
          recast.push(candidate);
        }
      }
    }
  }
  return recast;
}

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
  const geometry = withStage(options, 'proposal', () =>
    enumerateGeometryHypotheses(luma, familyEvidence, options));
  if (!geometry.ok) return geometry;
  const validated = validateGridHypotheses(luma, geometry.hypotheses, options);
  if (!validated.ok) {
    /*
     * 레퍼런스만 맞은 큐브 후보는 최종 채택이 아니다. 빠른 첫 통과에서 줄였던 블록
     * 후보와 QR 윈도 경로를 포맷·RS 실패 뒤에 한 번만 모두 복원하면, 정상 Type Y의
     * 비용은 지키면서 뒤쪽 정답 가설도 버리지 않는다.
     */
    const retryCubeAlternatives = options._cubeAlternativeRetry !== false
      && geometry.diagnostics?.cube?.ok === true
      && geometry.diagnostics?.qr?.skipped === true;
    if (retryCubeAlternatives) {
      const retried = enumerateGridHypotheses(luma, familyEvidence, {
        ...options,
        family: exhaustiveCubeFamilyOptions(options),
        _forceQrFinder: true,
        _cubeAlternativeRetry: false,
      });
      if (retried.ok) {
        retried.diagnostics.cubeAlternativeRetry = {
          exhaustiveBlockRecovery: true,
          qrFinder: true,
        };
        return retried;
      }
    }

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

    /*
     * 1차 — **포맷 재라벨**. 기하를 다시 만들지 않고, CRC 가 맞은 읽기를 낸 그 가설의
     * H 를 그대로 재사용한다. 패밀리 재배치보다 싸고 정확하다 (근거는
     * `recastHypothesesByFormat` 주석). 재배치와 같은 게이트를 쓴다 — 검증 실패 뒤에만.
     */
    if (relocationEnabled && options._formatRecast !== false) {
      const recast = recastHypothesesByFormat(geometry.hypotheses, validated);
      if (recast.length > 0) {
        const revalidated = validateGridHypotheses(luma, recast, options);
        if (revalidated.ok) {
          return ok({
            hypotheses: recast,
            candidates: revalidated.candidates,
            diagnostics: {
              geometry: geometry.diagnostics,
              validation: revalidated.diagnostics,
              formatRecast: {
                from: Array.from(attempted),
                count: recast.length,
                labels: recast.map((hypothesis) =>
                  `${hypothesis.family}-${hypothesis.k}`),
              },
            },
          });
        }
      }
    }

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

    /*
     * QR 후보만 남은 잘린 입력은 포맷 실패로 재분류하지 않는다. 프레임 경계에
     * 닿은 전경에서 QR 유사 패턴이 생겨도 기존의 symbol-clipped 계약이 우선이다.
     */
    const qrOnlyGeometry = geometry.hypotheses.length > 0
      && geometry.hypotheses.every((hypothesis) => hypothesis.source?.startsWith('center-qr'));
    const outlineTouchesFrame = geometry.diagnostics?.outline?.touchesBorder === true;
    if (qrOnlyGeometry && outlineTouchesFrame) {
      const outlineBounds = geometry.diagnostics?.outline?.bounds;
      const clippingSideCount = outlineBounds
        ? Number(outlineBounds.minX <= 0)
          + Number(outlineBounds.minY <= 0)
          + Number(outlineBounds.maxX >= luma.width - 1)
          + Number(outlineBounds.maxY >= luma.height - 1)
        : 0;
      return fail(FRONTEND_FAILURE.SYMBOL_CLIPPED, {
        stage: clippingSideCount >= 2 ? 'bootstrap-finder' : 'bootstrap-geometry',
        cause: 'qr-only-no-valid-format',
        clippingSideCount,
        geometryDiagnostics: geometry.diagnostics,
      });
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


/*
 * 중앙 QR 기하 진입점.
 *
 * QR 파인더의 가로/세로 1:1:3:1:1 run을 교차 확인하고, 같은 파인더에서
 * 나온 관측을 합친 뒤 세 파인더의 직각(center) 또는 120도(window) 삼중점을
 * 열거한다. 이 함수는 QR을 해독하지 않으며, 반환 후보는 bootstrap의
 * 포맷 CRC + 본문 RS/header 검증을 통과하기 전까지 채택되지 않는다.
 */
const QR_PATTERN_MODULES = 7;
const QR_MAX_CLUSTER_COUNT = 128;
const QR_MAX_CANDIDATES_PER_KIND = 16;

function qrOtsuThreshold(luma) {
  const histogram = new Uint32Array(256);
  const data = luma.data;
  const alpha = luma.alpha;
  const length = data.length;
  let count = 0;
  let sum = 0;
  /*
   * bin 은 `Math.max(0, Math.min(255, Math.round(v * 255)))` 와 **같은 값**이다.
   *
   * `Math.round(x)` 는 x >= 0 에서 `Math.floor(x + 0.5)` 이고, `floor(x+0.5)` 가
   * `round(x)` 와 갈리는 유일한 경우는 x 가 `n + 0.5` 바로 아래 double 일 때다.
   * 여기서 `data` 는 계약상 Float32Array(가수 24비트)이고 ×255 는 double 에서
   * 정확하므로 유효 가수가 32비트를 넘지 않는다 — 그 임계값(가수 53비트)에
   * 걸릴 수가 없다. 음수·NaN 분기도 원식 그대로다: NaN 이면 histogram 쓰기가
   * 없고 sum 이 NaN 이 된다(그러면 Otsu 가 기본 127 로 떨어지는 기존 거동).
   *
   * alpha 유무로 루프를 갈라 픽셀마다 `alpha &&` 를 다시 보지 않는다.
   * 실측(1080×1440): 원래 경로 14.7ms → 이 경로 6.9ms.
   */
  if (alpha) {
    for (let index = 0; index < length; index += 1) {
      if (alpha[index] === 0) continue;
      const scaled = data[index] * 255 + 0.5;
      if (scaled >= 0) {
        const bin = scaled >= 256 ? 255 : scaled | 0;
        histogram[bin] += 1;
        count += 1;
        sum += bin;
      } else if (scaled < 0) {
        histogram[0] += 1;
        count += 1;
      } else {
        count += 1;
        sum += NaN;
      }
    }
  } else {
    for (let index = 0; index < length; index += 1) {
      const scaled = data[index] * 255 + 0.5;
      if (scaled >= 0) {
        const bin = scaled >= 256 ? 255 : scaled | 0;
        histogram[bin] += 1;
        count += 1;
        sum += bin;
      } else if (scaled < 0) {
        histogram[0] += 1;
        count += 1;
      } else {
        count += 1;
        sum += NaN;
      }
    }
  }
  if (count === 0) return null;

  let backgroundCount = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 127;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    backgroundCount += histogram[bin];
    backgroundSum += bin * histogram[bin];
    if (backgroundCount === 0) continue;
    const foregroundCount = count - backgroundCount;
    if (foregroundCount === 0) break;
    const backgroundMean = backgroundSum / backgroundCount;
    const foregroundMean = (sum - backgroundSum) / foregroundCount;
    const delta = backgroundMean - foregroundMean;
    const variance = backgroundCount * foregroundCount * delta * delta;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = bin;
    }
  }
  return threshold / 255;
}

/**
 * 1:1:3:1:1 파인더 run 비율 판정. 배열이 아니라 다섯 스칼라를 받는다.
 *
 * 스캔 루프가 픽셀 런마다 부르는 자리라 예전의 `counts.reduce`/`pattern.map`
 * 배열 할당이 그대로 비용이었다. 합산 순서(c0..c4)는 원본과 같게 두어
 * 부동소수 결과가 달라지지 않게 한다.
 */
function qrPatternMatches5(c0, c1, c2, c3, c4, tolerance = 0.9) {
  const total = c0 + c1 + c2 + c3 + c4;
  const module = total / QR_PATTERN_MODULES;
  if (!(module >= 1)) return false;
  const wide = module * tolerance;
  return Math.abs(c0 - module) <= wide
    && Math.abs(c1 - module) <= wide
    && Math.abs(c2 - module * 3) <= module * 3 * 0.5
    && Math.abs(c3 - module) <= wide
    && Math.abs(c4 - module) <= wide;
}

/**
 * QR 파인더 탐색용 **이진 마스크**. `dark(px,py)` 를 픽셀마다 다시 계산하지 않으려고
 * 한 번만 굽는다: `(!alpha || alpha[i] !== 0) && data[i] <= threshold` 와 값이 같다.
 *
 * 왜 필요한가: 세로 스캔은 `data[y*width+x]` 를 stride 로 읽는다. Float32Array
 * (1440×1920 이면 11 MB) 대신 1바이트 마스크(2.7 MB)면 같은 순회가 캐시 라인을
 * 1/4 만 건드린다. 가로/세로 스캔과 교차 확인이 전부 이 마스크만 본다.
 */
function qrDarkMask(luma, threshold) {
  const { data, alpha } = luma;
  const length = data.length;
  const mask = new Uint8Array(length);
  if (alpha) {
    for (let index = 0; index < length; index += 1) {
      mask[index] = (alpha[index] !== 0 && data[index] <= threshold) ? 1 : 0;
    }
  } else {
    for (let index = 0; index < length; index += 1) {
      mask[index] = data[index] <= threshold ? 1 : 0;
    }
  }
  return mask;
}

function qrCrossCheck(mask, width, height, x, y, dx, dy) {
  const dark = (px, py) => (
    px >= 0 && py >= 0 && px < width && py < height && mask[py * width + px] === 1
  );
  const inside = (px, py) => px >= 0 && py >= 0 && px < width && py < height;

  x = Math.round(x);
  y = Math.round(y);
  if (!dark(x, y)) return null;

  const counts = [0, 0, 0, 0, 0];
  let px = x;
  let py = y;
  while (dark(px, py)) {
    counts[2] += 1;
    px -= dx;
    py -= dy;
  }
  while (inside(px, py) && !dark(px, py)) {
    counts[1] += 1;
    px -= dx;
    py -= dy;
  }
  while (dark(px, py)) {
    counts[0] += 1;
    px -= dx;
    py -= dy;
  }

  px = x + dx;
  py = y + dy;
  while (dark(px, py)) {
    counts[2] += 1;
    px += dx;
    py += dy;
  }
  while (inside(px, py) && !dark(px, py)) {
    counts[3] += 1;
    px += dx;
    py += dy;
  }
  while (dark(px, py)) {
    counts[4] += 1;
    px += dx;
    py += dy;
  }
  if (!qrPatternMatches5(counts[0], counts[1], counts[2], counts[3], counts[4])) return null;

  let negative = 0;
  px = x - dx;
  py = y - dy;
  while (dark(px, py)) {
    negative += 1;
    px -= dx;
    py -= dy;
  }
  let positive = 0;
  px = x + dx;
  py = y + dy;
  while (dark(px, py)) {
    positive += 1;
    px += dx;
    py += dy;
  }
  return {
    center: (dx !== 0 ? x : y) + (positive - negative) / 2,
    module: (counts[0] + counts[1] + counts[2] + counts[3] + counts[4]) / QR_PATTERN_MODULES,
  };
}

/**
 * 한 줄(행 또는 전치된 열)의 1:1:3:1:1 run 을 훑는다.
 *
 * 버퍼는 `base + position` 으로 **연속 접근**한다 — 열 스캔은 전치 마스크를 넘겨
 * 같은 함수를 쓰므로 세로 방향도 stride 없이 읽힌다. 런은 반드시 교대하므로
 * 마지막 5개만 있으면 되고(길이·시작 위치), `pattern[0].dark` 는 방금 밀어 넣은
 * 런이 dark 인지와 같다(5개는 홀수라 양 끝의 패리티가 같다). 그래서 원본의
 * `runs` 객체 배열·`slice(-5)`·`map` 할당이 전부 사라진다.
 */
function qrScanRuns(buffer, base, length, runLength, runStart, onPattern) {
  let previousDark = buffer[base] === 1;
  let start = 0;
  let runCount = 0;
  for (let position = 1; position <= length; position += 1) {
    const currentDark = position < length
      ? buffer[base + position] === 1
      : !previousDark;
    if (currentDark === previousDark) continue;

    const slot = runCount % 5;
    runLength[slot] = position - start;
    runStart[slot] = start;
    runCount += 1;
    if (runCount >= 5 && previousDark) {
      const i0 = (slot + 1) % 5;
      const i1 = (slot + 2) % 5;
      const i2 = (slot + 3) % 5;
      const i3 = (slot + 4) % 5;
      const c0 = runLength[i0];
      const c1 = runLength[i1];
      const c2 = runLength[i2];
      const c3 = runLength[i3];
      const c4 = runLength[slot];
      if (qrPatternMatches5(c0, c1, c2, c3, c4)) {
        onPattern(
          runStart[i2] + c2 / 2,
          (c0 + c1 + c2 + c3 + c4) / QR_PATTERN_MODULES,
        );
      }
    }
    previousDark = currentDark;
    start = position;
  }
}

/** 마스크를 블록 단위로 전치한다 — 열 스캔을 연속 접근으로 바꾸려고. */
function qrTransposeMask(mask, width, height) {
  const out = new Uint8Array(mask.length);
  const BLOCK = 64;
  for (let by = 0; by < height; by += BLOCK) {
    const yEnd = Math.min(by + BLOCK, height);
    for (let bx = 0; bx < width; bx += BLOCK) {
      const xEnd = Math.min(bx + BLOCK, width);
      for (let y = by; y < yEnd; y += 1) {
        const row = y * width;
        for (let x = bx; x < xEnd; x += 1) out[x * height + y] = mask[row + x];
      }
    }
  }
  return out;
}

function qrScanHits(mask, width, height) {
  const hits = [];
  const runLength = new Int32Array(5);
  const runStart = new Int32Array(5);

  for (let y = 0; y < height; y += 1) {
    qrScanRuns(mask, y * width, width, runLength, runStart, (center, lineModule) => {
      const cross = qrCrossCheck(mask, width, height, center, y, 0, 1);
      if (cross) {
        hits.push({ x: center, y: cross.center, module: (lineModule + cross.module) / 2 });
      }
    });
  }

  const transposed = qrTransposeMask(mask, width, height);
  for (let x = 0; x < width; x += 1) {
    qrScanRuns(transposed, x * height, height, runLength, runStart, (center, lineModule) => {
      const cross = qrCrossCheck(mask, width, height, x, center, 1, 0);
      if (cross) {
        hits.push({ x: cross.center, y: center, module: (lineModule + cross.module) / 2 });
      }
    });
  }
  return hits;
}

/**
 * 관측(hit)을 파인더 중심 클러스터로 합친다.
 *
 * 원본은 hit 마다 `clusters.find(...)` 로 전체를 훑었다. 실사진 1440 에서 hit
 * 3천~1만2천 · 클러스터 1천~2천이면 술어 평가가 수백만~수천만 회고, 실측상
 * Type Y 복호 시간의 **3분의 1** 이 여기였다.
 *
 * 대신 **레벨 격자 공간 색인**을 쓴다. 클러스터마다 매칭 반경
 * `max(3, module*2)` 이 다르므로 반경별 레벨(칸 크기 `8 << level` ≥ 반경)에
 * 등록하면 디스크가 칸 3×3 안에 들어간다. hit 이 어떤 클러스터의 디스크 안이면
 * 그 클러스터는 반드시 hit 이 속한 칸에 등록돼 있으므로 **누락이 없다**.
 * 중심이 움직여 등록 범위가 바뀌면 새 범위를 추가한다(옛 등록은 남지만 술어를
 * 다시 검사하므로 무해하다).
 *
 * **출력은 원본과 동일하다**: 후보 중 최소 인덱스(= 삽입 순서상 첫 매칭)를
 * 고르고, 술어는 `Math.hypot` 원식 그대로 평가하며, 결과 배열도 삽입 순서를
 * 유지해 뒤따르는 stable sort 의 타이브레이크가 보존된다.
 */
function qrClusterHits(hits) {
  const hitCount = hits.length;
  const clusterX = new Float64Array(hitCount);
  const clusterY = new Float64Array(hitCount);
  const clusterModule = new Float64Array(hitCount);
  const clusterCount = new Int32Array(hitCount);
  const regLevel = new Int32Array(hitCount);
  const regX0 = new Int32Array(hitCount);
  const regX1 = new Int32Array(hitCount);
  const regY0 = new Int32Array(hitCount);
  const regY1 = new Int32Array(hitCount);
  let total = 0;

  const buckets = new Map();
  const levels = [];
  const cellKey = (level, cx, cy) => (
    (level << 24)
    | ((cy < 0 ? 0 : cy > 4095 ? 4095 : cy) << 12)
    | (cx < 0 ? 0 : cx > 4095 ? 4095 : cx)
  );

  const register = (index) => {
    const radius = Math.max(3, clusterModule[index] * 2);
    let level = 0;
    let cell = 8;
    while (cell < radius && level < 60) {
      cell *= 2;
      level += 1;
    }
    const x0 = Math.floor((clusterX[index] - radius) / cell);
    const x1 = Math.floor((clusterX[index] + radius) / cell);
    const y0 = Math.floor((clusterY[index] - radius) / cell);
    const y1 = Math.floor((clusterY[index] + radius) / cell);
    if (clusterCount[index] > 1
      && regLevel[index] === level
      && regX0[index] === x0 && regX1[index] === x1
      && regY0[index] === y0 && regY1[index] === y1) {
      return;
    }
    regLevel[index] = level;
    regX0[index] = x0;
    regX1[index] = x1;
    regY0[index] = y0;
    regY1[index] = y1;
    if (!levels.includes(level)) levels.push(level);
    for (let cy = y0; cy <= y1; cy += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        const key = cellKey(level, cx, cy);
        const bucket = buckets.get(key);
        if (bucket === undefined) buckets.set(key, [index]);
        else if (bucket[bucket.length - 1] !== index) bucket.push(index);
      }
    }
  };

  for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
    const hit = hits[hitIndex];
    const hx = hit.x;
    const hy = hit.y;
    const hm = hit.module;
    let found = -1;
    for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
      const level = levels[levelIndex];
      const cell = 8 * (2 ** level);
      const bucket = buckets.get(
        cellKey(level, Math.floor(hx / cell), Math.floor(hy / cell)),
      );
      if (bucket === undefined) continue;
      for (let b = 0; b < bucket.length; b += 1) {
        const index = bucket[b];
        if (found >= 0 && index >= found) continue;
        const cm = clusterModule[index];
        if (Math.hypot(clusterX[index] - hx, clusterY[index] - hy)
            <= Math.max(3, cm * 2)
          && Math.abs(cm - hm) <= Math.max(cm, hm) * 0.55) {
          found = index;
        }
      }
    }
    if (found >= 0) {
      const previous = clusterCount[found];
      const count = previous + 1;
      clusterX[found] = (clusterX[found] * previous + hx) / count;
      clusterY[found] = (clusterY[found] * previous + hy) / count;
      clusterModule[found] = (clusterModule[found] * previous + hm) / count;
      clusterCount[found] = count;
      register(found);
    } else {
      const index = total;
      total += 1;
      clusterX[index] = hx;
      clusterY[index] = hy;
      clusterModule[index] = hm;
      clusterCount[index] = 1;
      register(index);
    }
  }

  const clusters = [];
  for (let index = 0; index < total; index += 1) {
    if (clusterCount[index] < 2) continue;
    clusters.push({
      x: clusterX[index],
      y: clusterY[index],
      module: clusterModule[index],
      count: clusterCount[index],
    });
  }
  return clusters
    .sort((left, right) =>
      right.count - left.count
      || left.y - right.y
      || left.x - right.x)
    .slice(0, QR_MAX_CLUSTER_COUNT);
}
function qrTripleCandidates(clusters, options = {}) {
  const candidates = [];
  const clusterCount = clusters.length;
  const pairCount = clusterCount * clusterCount;
  const pairX = new Float64Array(pairCount);
  const pairY = new Float64Array(pairCount);
  const pairLength = new Float64Array(pairCount);
  for (let sharedIndex = 0; sharedIndex < clusterCount; sharedIndex += 1) {
    const shared = clusters[sharedIndex];
    const row = sharedIndex * clusterCount;
    for (let axisIndex = 0; axisIndex < clusterCount; axisIndex += 1) {
      const axis = clusters[axisIndex];
      const index = row + axisIndex;
      const ax = axis.x - shared.x;
      const ay = axis.y - shared.y;
      pairX[index] = ax;
      pairY[index] = ay;
      pairLength[index] = Math.hypot(ax, ay);
    }
  }
  const minimumSpacing = options.minimumSpacingModules ?? 8;
  const maximumSpacing = options.maximumSpacingModules ?? 22;
  // 삼중 루프 안에서 객체 프로퍼티를 다시 읽지 않도록 module 만 따로 뽑는다.
  const clusterModule = new Float64Array(clusterCount);
  for (let i = 0; i < clusterCount; i += 1) clusterModule[i] = clusters[i].module;
  for (let sharedIndex = 0; sharedIndex < clusterCount; sharedIndex += 1) {
    const shared = clusters[sharedIndex];
    const sharedModule = clusterModule[sharedIndex];
    const row = sharedIndex * clusterCount;
    for (let firstIndex = 0; firstIndex < clusterCount; firstIndex += 1) {
      if (firstIndex === sharedIndex) continue;
      const axisA = clusters[firstIndex];
      const axisAModule = clusterModule[firstIndex];
      /*
       * 가지치기 — 세 모듈의 max/min 비가 1.8 을 넘으면 어차피 버린다. 두 개만으로
       * 이미 1.8 을 넘으면 세 번째를 무엇으로 골라도 비는 더 커지기만 하므로
       * (max3 >= max2, min3 <= min2, 나눗셈은 단조) **안쪽 루프 전체를 건너뛴다.**
       * 통과 집합은 바뀌지 않는다 — 원래 조건의 필요조건일 뿐이다.
       */
      if (Math.max(sharedModule, axisAModule) / Math.min(sharedModule, axisAModule) > 1.8) {
        continue;
      }
      const pairA = row + firstIndex;
      const ax = pairX[pairA];
      const ay = pairY[pairA];
      const legA = pairLength[pairA];
      for (let secondIndex = firstIndex + 1;
        secondIndex < clusterCount;
        secondIndex += 1) {
        if (secondIndex === sharedIndex) continue;
        const pairB = row + secondIndex;
        const legB = pairLength[pairB];
        // 세 조건은 AND 로 묶여 있어 순서를 바꿔도 통과 집합이 같다. 두 다리 길이
        // 비교가 가장 선별적이면서 module 합·나눗셈이 필요 없어 앞으로 당겼다.
        if (Math.abs(legA - legB) / Math.max(legA, legB) > 0.35) continue;
        const axisBModule = clusterModule[secondIndex];
        const module = (sharedModule + axisAModule + axisBModule) / 3;
        if (Math.min(legA, legB) / module < minimumSpacing
          || Math.max(legA, legB) / module > maximumSpacing) {
          continue;
        }

        const bx = pairX[pairB];
        const by = pairY[pairB];
        const sine = Math.abs(ax * by - ay * bx) / (legA * legB);
        const cosine = (ax * bx + ay * by) / (legA * legB);
        if (sine < 0.65 || cosine > 0.45 || cosine < -0.8) continue;
        const axisB = clusters[secondIndex];
        const moduleRatio = Math.max(sharedModule, axisAModule, axisBModule)
          / Math.min(sharedModule, axisAModule, axisBModule);
        if (moduleRatio > 1.8) continue;

        const kind = cosine < -0.25 ? 'window' : 'center';
        const targetCosine = kind === 'window' ? -0.5 : 0;
        const score =
          Math.abs(legA - legB) / Math.max(legA, legB)
          + Math.abs(cosine - targetCosine)
          + 0.05 * (moduleRatio - 1)
          - Math.min(100, shared.count + axisA.count + axisB.count) * 0.002;
        candidates.push({
          kind,
          score,
          cosine,
          module,
          legA,
          legB,
          shared,
          axisA,
          axisB,
          center: {
            x: shared.x + (ax + bx) / 2,
            y: shared.y + (ay + by) / 2,
          },
        });
      }
    }
  }

  candidates.sort((left, right) =>
    left.score - right.score
    || left.center.y - right.center.y
    || left.center.x - right.center.x);
  const limit = options.maxCandidatesPerKind ?? QR_MAX_CANDIDATES_PER_KIND;
  const countByKind = { center: 0, window: 0 };
  return candidates.filter((candidate) => {
    if (countByKind[candidate.kind] >= limit) return false;
    countByKind[candidate.kind] += 1;
    return true;
  });
}
/**
 * QR 파인더 삼중점 후보를 결정적으로 열거한다.
 *
 * center는 O/A 중앙 정사각 QR, window는 Type Y2 top-face QR의 120도 투영이다.
 * QR 후보만으로 타입을 확정하지 않으며 bootstrap 본문 검증이 최종 게이트다.
 */
export function detectQrFinderTriples(luma, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
      stage: 'qr-finder',
      message: error.message,
    });
  }
  const threshold = qrOtsuThreshold(luma);
  if (threshold === null) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'qr-finder',
      cause: 'no-opaque-samples',
    });
  }
  const hits = qrScanHits(qrDarkMask(luma, threshold), luma.width, luma.height);
  const finderCenters = qrClusterHits(hits);
  const candidates = qrTripleCandidates(finderCenters, options);
  if (candidates.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'qr-finder',
      cause: 'no-qr-triple',
      threshold,
      hitCount: hits.length,
      finderCenterCount: finderCenters.length,
    });
  }
  return ok({
    candidates,
    finderCenters,
    diagnostics: {
      threshold,
      hitCount: hits.length,
      finderCenterCount: finderCenters.length,
      candidateCount: candidates.length,
    },
  });
}
