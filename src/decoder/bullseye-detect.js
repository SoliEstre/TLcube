/**
 * bullseye-detect.js — Type O 6밴드 불스아이의 결정적 검출·점수화·정제.
 *
 * 입력은 contracts.js의 LumaField이며 모든 기하는 canonical → image 방향이다.
 * canonical 좌표의 단위는 셀 크기 하나이고 원점은 불스아이 중심이다. 반환하는
 * transform/B는 반지름 √13인 정규 불스아이 평면을 영상으로 보낸다.
 *
 * 탐색은 고정 2×2 피라미드와 Sobel 방사 대칭 투표로 중심·스케일 proposal을 모두
 * 모은 뒤, SPD 국소 affine 3자유도와 projective tilt 2자유도를 고정 횟수
 * coordinate descent로 정제한다. 첫 성공을 채택하지 않는다.
 */

import { maxSafeRadius, profileAt } from '../bullseye.js';
import { readCubeOrientation } from './cube-bullseye.js';
import {
  FRONTEND_FAILURE,
  assertHomography,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';

const BAND_COUNT = 6;
const CANONICAL_OUTER_RADIUS = maxSafeRadius(1);
const CANONICAL_BAND_WIDTH = CANONICAL_OUTER_RADIUS / BAND_COUNT;

/** radialSignature()의 규범 기본값과 같다. */
const DEFAULT_RADIAL_SAMPLES = 64;

// [미검증] M1 calibration 에서 확정 — 설계 §6.4/§15의 초기 angular sample 수.
const DEFAULT_ANGULAR_SAMPLES = 48;
// [미검증] M1 calibration 에서 확정 — 투영된 밴드가 이보다 얇으면 조기 거부한다.
const MIN_PROJECTED_BAND_WIDTH_PX = 1.5;
// [미검증] M1 calibration 에서 확정 — 영상 robust span 대비 최소 불스아이 대비.
const MIN_CONTRAST_SPAN_RATIO = 0.45;
// [미검증] M1 calibration 에서 확정 — 같은 반지름의 angular MAD/contrast 상한.
const MAX_ANGULAR_MAD_CONTRAST = 0.25;
// [미검증] M1 calibration 에서 확정 — 경계 정렬은 해상도와 함께 넓어지지 않는 픽셀 간격으로 잰다.
const BOUNDARY_ALIGNMENT_INSET_PX = 1.5;
// [미검증] M1 calibration 에서 확정 — 0에 붙은 보간 오차는 반전 경계로 판정하지 않는다.
const BOUNDARY_SIGN_TOLERANCE_RATIO = 1e-7;
// [미검증] M1 calibration 에서 확정 — 0 경계를 허용하되 전체 경계 정렬 증거를 요구한다.
const MIN_BOUNDARY_ALIGNMENT_SCORE = 0.20;
// [미검증] M1 calibration 에서 확정 — octave당 고정 스케일 seed 수.
const SCALE_SEEDS_PER_OCTAVE = 8;
// [미검증] M1 calibration 에서 확정 — 5–95% span이 0일 때만 제외할 양끝 표본 수.
const ROBUST_TAIL_TRIM_SAMPLES = 32;

// 아래 탐색 예산·proposal 문턱도 M1에서 recall/비용 곡선으로 보정해야 한다.
// [미검증] M1 calibration 에서 확정.
const SOBEL_GRADIENT_SPAN_RATIO = 0.06;
// 프레임 잡동사니가 gradient 목록을 독점하지 않도록 공간별 강한 edge만 보존한다.
const SOBEL_TILE_SIZE = 32;
const MAX_SOBEL_POINTS_PER_TILE = 64;
// 일반 다중스케일 탐색은 레벨별 한 octave 안쪽만 맡아 물리 스케일 중복을 피한다.
const PYRAMID_SEARCH_MIN_OUTER_RADIUS = 12;
const PYRAMID_SEARCH_MAX_OUTER_RADIUS = 24;
// [미검증] M1 calibration 에서 확정.
const MAX_PYRAMID_LEVELS = 4;
// [미검증] M1 calibration 에서 확정.
const PROPOSALS_PER_SCALE = 4;
// [미검증] M1 calibration 에서 확정.
const MAX_RAW_PROPOSALS = 72;
// [미검증] M1 calibration 에서 확정.
const MAX_REFINED_PROPOSALS = 4;
// [미검증] M1 calibration 에서 확정.
const DEFAULT_REFINE_ITERATIONS = 6;
// [미검증] M1 calibration 에서 확정 — proposal 정제용 저비용 표본 수. 최종 후보는 64×48로 재평가한다.
const REFINEMENT_RADIAL_SAMPLES = 24;
// [미검증] M1 calibration 에서 확정.
const REFINEMENT_ANGULAR_SAMPLES = 24;
// [미검증] M1 calibration 에서 확정 — 중심 x·y와 등방 스케일을 함께 옮기는 다단 격자.
const ISOTROPIC_GRID_STEPS = Object.freeze([
  Object.freeze({
    center: 0.14, centerSubdivisions: 2, logScale: 0.055, scaleRadius: 2,
  }),
  Object.freeze({
    center: 0.05, centerSubdivisions: 1, logScale: 0.020, scaleRadius: 1,
  }),
  Object.freeze({
    center: 0.018, centerSubdivisions: 1, logScale: 0.007, scaleRadius: 1,
  }),
]);
// [미검증] M1 calibration 에서 확정.
const MAX_OUTER_RADIUS_FRACTION = 0.42;
// [미검증] M1 calibration 에서 확정.
const RAW_SCALE_NMS_LOG_DISTANCE = Math.log(1.22);
// [미검증] M1 calibration 에서 확정.
const FINAL_CENTER_NMS_RADIUS_FACTOR = 0.45;

// denominator=1+p·u+q·v. ±30° 하네스를 0 seed 하나에 맡기지 않는 고정 순서.
// [미검증] M1 calibration 에서 확정.
const PROJECTIVE_TILT_SEEDS = Object.freeze([
  Object.freeze([0, 0]),
  Object.freeze([0.024, 0]),
  Object.freeze([-0.024, 0]),
  Object.freeze([0, 0.024]),
  Object.freeze([0, -0.024]),
  Object.freeze([0.017, 0.017]),
  Object.freeze([-0.017, -0.017]),
]);

const SCORE_EPSILON = 1e-12;

function clamp01(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function squaredDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/*
 * 모든 score 경로가 이 통계를 아주 자주 부른다. 각 호출의 배열을 새로 정렬하지
 * 않고 모듈 범위의 숫자/순번 버퍼에서 k번째 원소만 선택한다. 순번은 숫자가 같은
 * 값(-0/+0 포함)을 원래 Array#sort((a, b) => a - b)의 stable 순서와 같게 만든다.
 */
let statsValuesScratch = new Float64Array(0);
let statsOrderScratch = new Uint32Array(0);
let statsUseStableOrder = false;
const statsRankScratch = new Int32Array(4);
const statsRankValues = new Float64Array(4);
const statsSelectLeft = new Int32Array(4);
const statsSelectRight = new Int32Array(4);
const statsSelectMasks = new Int32Array(4);

function ensureStatsScratch(length) {
  if (statsValuesScratch.length >= length) return;
  statsValuesScratch = new Float64Array(length);
  statsOrderScratch = new Uint32Array(length);
}

function swapStatsScratch(left, right) {
  const value = statsValuesScratch[left];
  statsValuesScratch[left] = statsValuesScratch[right];
  statsValuesScratch[right] = value;
  const order = statsOrderScratch[left];
  statsOrderScratch[left] = statsOrderScratch[right];
  statsOrderScratch[right] = order;
}

function compareStatsScratch(left, right) {
  const leftValue = statsValuesScratch[left];
  const rightValue = statsValuesScratch[right];
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return statsOrderScratch[left] - statsOrderScratch[right];
}

/**
 * stable numeric-order k번째 선택. median-of-three pivot으로 편향된 입력도 피하고,
 * 비교자 호출/전체 정렬/추가 배열을 만들지 않는다.
 */
function swapStatsValues(left, right) {
  const value = statsValuesScratch[left];
  statsValuesScratch[left] = statsValuesScratch[right];
  statsValuesScratch[right] = value;
}

function numericStatsMedianOfThree(left, middle, right) {
  const a = statsValuesScratch[left];
  const b = statsValuesScratch[middle];
  const c = statsValuesScratch[right];
  if (a < b) {
    if (b < c) return b;
    return a < c ? c : a;
  }
  if (a < c) return a;
  return b < c ? c : b;
}

function selectNumericStatsKth(length, rank) {
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    const pivot = numericStatsMedianOfThree(left, middle, right);
    let less = left;
    let scan = left;
    let greater = right;
    while (scan <= greater) {
      const value = statsValuesScratch[scan];
      if (value < pivot) {
        swapStatsValues(less, scan);
        less += 1;
        scan += 1;
      } else if (value > pivot) {
        swapStatsValues(scan, greater);
        greater -= 1;
      } else {
        scan += 1;
      }
    }
    if (rank < less) right = less - 1;
    else if (rank > greater) left = greater + 1;
    else return statsValuesScratch[rank];
  }
  return statsValuesScratch[left];
}

function selectNumericStatsRanks(length, rankCount) {
  let stackLength = 1;
  statsSelectLeft[0] = 0;
  statsSelectRight[0] = length - 1;
  statsSelectMasks[0] = (1 << rankCount) - 1;

  while (stackLength > 0) {
    stackLength -= 1;
    const left = statsSelectLeft[stackLength];
    const right = statsSelectRight[stackLength];
    const mask = statsSelectMasks[stackLength];
    if (left === right) {
      for (let rankIndex = 0; rankIndex < rankCount; rankIndex += 1) {
        if (mask & (1 << rankIndex)) statsRankValues[rankIndex] = statsValuesScratch[left];
      }
      continue;
    }

    const middle = left + Math.floor((right - left) / 2);
    const pivot = numericStatsMedianOfThree(left, middle, right);
    let less = left;
    let scan = left;
    let greater = right;
    while (scan <= greater) {
      const value = statsValuesScratch[scan];
      if (value < pivot) {
        swapStatsValues(less, scan);
        less += 1;
        scan += 1;
      } else if (value > pivot) {
        swapStatsValues(scan, greater);
        greater -= 1;
      } else {
        scan += 1;
      }
    }

    let lowerMask = 0;
    let equalMask = 0;
    let upperMask = 0;
    for (let rankIndex = 0; rankIndex < rankCount; rankIndex += 1) {
      const bit = 1 << rankIndex;
      if (!(mask & bit)) continue;
      const rank = statsRankScratch[rankIndex];
      if (rank < less) lowerMask |= bit;
      else if (rank > greater) upperMask |= bit;
      else equalMask |= bit;
    }
    for (let rankIndex = 0; rankIndex < rankCount; rankIndex += 1) {
      if (equalMask & (1 << rankIndex)) statsRankValues[rankIndex] = statsValuesScratch[less];
    }
    if (lowerMask !== 0) {
      statsSelectLeft[stackLength] = left;
      statsSelectRight[stackLength] = less - 1;
      statsSelectMasks[stackLength] = lowerMask;
      stackLength += 1;
    }
    if (upperMask !== 0) {
      statsSelectLeft[stackLength] = greater + 1;
      statsSelectRight[stackLength] = right;
      statsSelectMasks[stackLength] = upperMask;
      stackLength += 1;
    }
  }
}
function selectStableStatsKth(length, rank) {
  let left = 0;
  let right = length - 1;

  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (compareStatsScratch(left, middle) > 0) swapStatsScratch(left, middle);
    if (compareStatsScratch(left, right) > 0) swapStatsScratch(left, right);
    if (compareStatsScratch(middle, right) > 0) swapStatsScratch(middle, right);

    const pivotValue = statsValuesScratch[middle];
    const pivotOrder = statsOrderScratch[middle];
    let i = left;
    let j = right;
    while (i <= j) {
      while (
        statsValuesScratch[i] < pivotValue
        || (!(statsValuesScratch[i] > pivotValue) && statsOrderScratch[i] < pivotOrder)
      ) i += 1;
      while (
        statsValuesScratch[j] > pivotValue
        || (!(statsValuesScratch[j] < pivotValue) && statsOrderScratch[j] > pivotOrder)
      ) j -= 1;
      if (i <= j) {
        swapStatsScratch(i, j);
        i += 1;
        j -= 1;
      }
    }

    if (rank <= j) right = j;
    else if (rank >= i) left = i;
    else return statsValuesScratch[rank];
  }
  return statsValuesScratch[left];
}

function selectStatsKth(length, rank) {
  return statsUseStableOrder
    ? selectStableStatsKth(length, rank)
    : selectNumericStatsKth(length, rank);
}

function prepareStatsValues(values, length = values.length) {
  ensureStatsScratch(length);
  let stableOrder = false;
  for (let i = 0; i < length; i += 1) {
    const value = values[i];
    statsValuesScratch[i] = value;
    if (Number.isNaN(value) || (value === 0 && 1 / value === -Infinity)) stableOrder = true;
  }
  statsUseStableOrder = stableOrder;
  if (stableOrder) {
    for (let i = 0; i < length; i += 1) statsOrderScratch[i] = i;
  }
}

function medianFromPreparedStats(length) {
  if (length === 0) return Number.NaN;
  const middle = Math.floor(length / 2);
  const upper = selectStatsKth(length, middle);
  return length % 2 === 1
    ? upper
    : (selectStatsKth(length, middle - 1) + upper) / 2;
}

/** verify.js와 같은 숫자 오름차순/짝수 중앙 두 값 평균 규약. */
function median(values) {
  if (values.length === 0) return Number.NaN;
  prepareStatsValues(values);
  return medianFromPreparedStats(values.length);
}

function mad(values, center = median(values)) {
  if (!Number.isFinite(center)) return Number.NaN;
  ensureStatsScratch(values.length);
  statsUseStableOrder = false;
  for (let i = 0; i < values.length; i += 1) {
    statsValuesScratch[i] = Math.abs(values[i] - center);
  }
  return medianFromPreparedStats(values.length);
}

function percentileFromPreparedStats(length, quantile) {
  if (length === 0) return Number.NaN;
  const index = quantile * (length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return selectStatsKth(length, lower);
  const fraction = index - lower;
  const lowerValue = selectStatsKth(length, lower);
  const upperValue = selectStatsKth(length, upper);
  return lowerValue * (1 - fraction) + upperValue * fraction;
}

function robustStatsFromPreparedFinite(finiteCount) {
  if (finiteCount === 0) {
    return { low: Number.NaN, high: Number.NaN, span: Number.NaN, finiteCount: 0 };
  }

  let coreLow;
  let coreHigh;
  if (statsUseStableOrder) {
    coreLow = percentileFromPreparedStats(finiteCount, 0.05);
    coreHigh = percentileFromPreparedStats(finiteCount, 0.95);
  } else {
    const lowIndex = 0.05 * (finiteCount - 1);
    const highIndex = 0.95 * (finiteCount - 1);
    const lowLower = Math.floor(lowIndex);
    const lowUpper = Math.ceil(lowIndex);
    const highLower = Math.floor(highIndex);
    const highUpper = Math.ceil(highIndex);
    statsRankScratch[0] = lowLower;
    statsRankScratch[1] = lowUpper;
    statsRankScratch[2] = highLower;
    statsRankScratch[3] = highUpper;
    selectNumericStatsRanks(finiteCount, 4);
    const lowFraction = lowIndex - lowLower;
    const highFraction = highIndex - highLower;
    coreLow = lowLower === lowUpper
      ? statsRankValues[0]
      : statsRankValues[0] * (1 - lowFraction) + statsRankValues[1] * lowFraction;
    coreHigh = highLower === highUpper
      ? statsRankValues[2]
      : statsRankValues[2] * (1 - highFraction) + statsRankValues[3] * highFraction;
  }
  const coreSpan = coreHigh - coreLow;
  if (coreSpan > 1e-6 || finiteCount <= ROBUST_TAIL_TRIM_SAMPLES * 2) {
    return {
      low: coreLow,
      high: coreHigh,
      span: coreSpan,
      finiteCount,
      spanSource: 'p05-p95',
    };
  }

  const tail = Math.min(
    ROBUST_TAIL_TRIM_SAMPLES,
    Math.floor((finiteCount - 1) / 2),
  );
  const low = selectStatsKth(finiteCount, tail);
  const high = selectStatsKth(finiteCount, finiteCount - 1 - tail);
  return {
    low,
    high,
    span: high - low,
    finiteCount,
    spanSource: 'fixed-tail-fallback',
  };
}
function robustStatsFromValues(values) {
  ensureStatsScratch(values.length);
  let finiteCount = 0;
  let stableOrder = false;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    statsValuesScratch[finiteCount] = value;
    if (value === 0 && 1 / value === -Infinity) stableOrder = true;
    finiteCount += 1;
  }
  statsUseStableOrder = stableOrder;
  if (stableOrder) {
    for (let i = 0; i < finiteCount; i += 1) statsOrderScratch[i] = i;
  }
  return robustStatsFromPreparedFinite(finiteCount);
}

/** 배열 그룹을 바로 채워 candidate-local 통계의 flat() 할당을 없앤다. */
function robustStatsFromGroups(groups) {
  let capacity = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    capacity += groups[groupIndex].length;
  }
  ensureStatsScratch(capacity);
  let finiteCount = 0;
  let stableOrder = false;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const values = groups[groupIndex];
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (!Number.isFinite(value)) continue;
      statsValuesScratch[finiteCount] = value;
      if (value === 0 && 1 / value === -Infinity) stableOrder = true;
      finiteCount += 1;
    }
  }
  statsUseStableOrder = stableOrder;
  if (stableOrder) {
    for (let i = 0; i < finiteCount; i += 1) statsOrderScratch[i] = i;
  }
  return robustStatsFromPreparedFinite(finiteCount);
}

function robustStats(luma) {
  return robustStatsFromValues(luma.data);
}

function checkedLuma(luma) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { message: error.message });
  }
  if (luma.alpha !== null && luma.alpha !== undefined) {
    if (!(luma.alpha instanceof Uint8Array) || luma.alpha.length !== luma.width * luma.height) {
      return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
        message: 'alpha 는 null 또는 width*height 길이의 Uint8Array 여야 한다',
      });
    }
  }
  return ok({ luma });
}

/**
 * 2×2 box average 피라미드. level 픽셀 중심을 원본으로 옮길 때
 * original=factor*level+offset, offset=(factor-1)/2다.
 */
function makePyramid(luma, maxLevels) {
  const levels = [{ ...luma, factor: 1, offset: 0, level: 0 }];
  let current = levels[0];
  for (let level = 1; level < maxLevels; level += 1) {
    if (Math.min(current.width, current.height) < 48) break;
    const width = Math.ceil(current.width / 2);
    const height = Math.ceil(current.height / 2);
    const data = new Float32Array(width * height);
    const alpha = current.alpha === null || current.alpha === undefined
      ? null
      : new Uint8Array(width * height);

    if (alpha === null && current.width % 2 === 0 && current.height % 2 === 0) {
      const sourceWidth = current.width;
      const sourceData = current.data;
      for (let y = 0; y < height; y += 1) {
        const sourceRow = y * 2 * sourceWidth;
        const targetRow = y * width;
        for (let x = 0; x < width; x += 1) {
          const sourceIndex = sourceRow + x * 2;
          // 기존 dy→dx 순회의 a+b+c+d 합산 순서를 그대로 유지한다.
          const sum = sourceData[sourceIndex]
            + sourceData[sourceIndex + 1]
            + sourceData[sourceIndex + sourceWidth]
            + sourceData[sourceIndex + sourceWidth + 1];
          data[targetRow + x] = sum / 4;
        }
      }
    } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        let alphaSum = 0;
        for (let dy = 0; dy < 2; dy += 1) {
          const sourceY = y * 2 + dy;
          if (sourceY >= current.height) continue;
          for (let dx = 0; dx < 2; dx += 1) {
            const sourceX = x * 2 + dx;
            if (sourceX >= current.width) continue;
            const sourceIndex = sourceY * current.width + sourceX;
            sum += current.data[sourceIndex];
            if (alpha !== null) alphaSum += current.alpha[sourceIndex];
            count += 1;
          }
        }
        const targetIndex = y * width + x;
        data[targetIndex] = sum / count;
        if (alpha !== null) alpha[targetIndex] = Math.round(alphaSum / count);
      }
    }
    }
    current = {
      width,
      height,
      data,
      alpha,
      factor: current.factor * 2,
      offset: (current.factor * 2 - 1) / 2,
      level,
    };
    levels.push(current);
  }
  return levels;
}

function sobelPoints(luma, span) {
  const points = [];
  const threshold = span * SOBEL_GRADIENT_SPAN_RATIO;
  const { width, height, data } = luma;

  /*
   * 전역 top-K는 화면 UI 한 곳의 선명한 글자/테두리가 표를 독점한다. 32px 타일마다
   * 강한 edge를 같은 수만 남기면 위치 편향 없이 상한이 생기고, 약한 질감은 국소
   * 순위에서 밀린다. tie는 y/x로 고정해 RNG 없이 동일 입력의 누적 순서도 고정한다.
   */
  for (let tileY = 0; tileY < height; tileY += SOBEL_TILE_SIZE) {
    const yEnd = Math.min(height - 1, tileY + SOBEL_TILE_SIZE);
    for (let tileX = 0; tileX < width; tileX += SOBEL_TILE_SIZE) {
      const xEnd = Math.min(width - 1, tileX + SOBEL_TILE_SIZE);
      const tile = [];
      for (let y = Math.max(1, tileY); y < yEnd; y += 1) {
        for (let x = Math.max(1, tileX); x < xEnd; x += 1) {
          const top = (y - 1) * width;
          const middle = y * width;
          const bottom = (y + 1) * width;
          const gx = (
            data[top + x + 1] + 2 * data[middle + x + 1] + data[bottom + x + 1]
          ) - (
            data[top + x - 1] + 2 * data[middle + x - 1] + data[bottom + x - 1]
          );
          const gy = (
            data[bottom + x - 1] + 2 * data[bottom + x] + data[bottom + x + 1]
          ) - (
            data[top + x - 1] + 2 * data[top + x] + data[top + x + 1]
          );
          const magnitude = Math.sqrt(gx * gx + gy * gy);
          if (magnitude >= threshold && Number.isFinite(magnitude)) {
            tile.push({ x, y, gx, gy, magnitude });
          }
        }
      }
      tile.sort((a, b) => b.magnitude - a.magnitude || a.y - b.y || a.x - b.x);
      points.push(...tile.slice(0, MAX_SOBEL_POINTS_PER_TILE));
    }
  }
  return points;
}

function radiusSeedsForLevel(level, options) {
  if (Array.isArray(options.outerRadiusSeeds)) {
    return options.outerRadiusSeeds
      .filter((radius) => Number.isFinite(radius) && radius > 0)
      .map((radius) => radius / level.factor)
      .filter((radius) => radius >= MIN_PROJECTED_BAND_WIDTH_PX * BAND_COUNT
        && radius <= Math.min(level.width, level.height) * MAX_OUTER_RADIUS_FRACTION)
      .sort((a, b) => a - b);
  }

  const minimumResolvable = MIN_PROJECTED_BAND_WIDTH_PX * BAND_COUNT;
  const minOuter = level.level === 0
    ? minimumResolvable
    : Math.max(minimumResolvable, PYRAMID_SEARCH_MIN_OUTER_RADIUS);
  const maxOuter = Math.min(
    Math.min(level.width, level.height) * MAX_OUTER_RADIUS_FRACTION,
    PYRAMID_SEARCH_MAX_OUTER_RADIUS,
  );
  if (maxOuter < minOuter) return [];
  const ratio = Math.pow(2, 1 / SCALE_SEEDS_PER_OCTAVE);
  const radii = [];
  for (let radius = minOuter; radius <= maxOuter * (1 + 1e-12); radius *= ratio) {
    radii.push(radius);
  }
  if (radii.length === 0 || radii[radii.length - 1] < maxOuter / Math.sqrt(ratio)) {
    radii.push(maxOuter);
  }
  return radii;
}

/**
 * 제안 단계가 투표에 쓰는 경계 번호(1..BAND_COUNT-1).
 *
 * ⚠ **여기가 «결정하는 단계» 다.** 안쪽 밴드를 다른 무늬로 갈아 끼우는 하이브리드에서
 * 검증 단계만 관대하게 만들면 소용이 없다 — 제안 단계가 지워진 경계에도 투표를 걸어
 * 엉뚱한 중심을 만들고, 진짜 중심은 표를 못 받아 애초에 후보로 올라오지 않는다.
 * 2026-08-12 에 검증 쪽만 고쳐 0/6 을 받고 «길이 닫혔다» 고 잘못 결론냈던 자리다.
 */
const DEFAULT_PROPOSAL_BOUNDARIES = Object.freeze([1, 2, 3, 4, 5]);

/*
 * 하이브리드 후보가 통과해야 하는 «큐브를 봤다» 증거 문턱 두 개. 실측 분포(2026-08-12):
 *
 *                          순위 여유          면 평탄도
 *   진짜 하이브리드(합성)   0.376 \~ 0.381     0.989 \~ 1.000
 *   순수 불스아이 오독(합성) 0.000 \~ 0.284     0.000 \~ 0.703
 *   순수 불스아이 오독(실사진) 0.001 \~ 0.248   0.006 \~ 0.525
 *
 * 순위 여유 하나로는 0.284 vs 0.376 이라 여유가 얇다. **면 평탄도**가 결정적이다 —
 * 오독의 원인이 «후보 중심이 어긋나 표본 고리가 밴드 경계를 스치는 것» 이라 조각 안이
 * 기울어 있고, 진짜 면은 평평하기 때문이다. 둘의 AND 를 요구한다.
 *
 * ⚠ 진짜 하이브리드 쪽 분포는 **아직 합성뿐**이다. 실사진이 생기면 이 두 값을 다시 잰다.
 */
const MIN_CUBE_TONE_RANK_MARGIN = 0.30;
const MIN_CUBE_FACE_FLATNESS = 0.80;

/**
 * 안쪽 몇 밴드가 **링이 아닌 다른 무늬로 대체됐는가** (하이브리드 = 3톤 큐브 2밴드).
 * 0 이면 순수 불스아이. 이 값 하나가 제안·검증 두 단계의 밴드/경계 범위를 함께 정한다 —
 * 한쪽만 알면 정확히 2026-08-12 의 실패가 재현된다.
 */
function ringFirstBand(options) {
  const replaced = options.innerBandsReplaced;
  if (replaced === undefined) return 0;
  // 최소한 바깥 2밴드(경계 1개)는 남아야 «교대 링» 이라는 증거가 성립한다.
  if (!Number.isInteger(replaced) || replaced < 0 || replaced > BAND_COUNT - 2) return null;
  return replaced;
}

/**
 * 한 번의 호출에서 검사할 링 레이아웃 목록.
 *
 * 스캐너는 «이 코드가 하이브리드인지» 를 미리 모른다. 그래서 제안은 한 번만 돌리고
 * **검증만 레이아웃마다** 반복한다 — 제안(피라미드+Sobel+투표)이 비싸고 검증은 싸다.
 */
function ringLayouts(options) {
  const requested = options.ringLayouts;
  if (requested === undefined) {
    const firstBand = ringFirstBand(options);
    return firstBand === null ? null : [firstBand];
  }
  if (!Array.isArray(requested) || requested.length === 0) return null;
  const seen = new Set();
  for (const firstBand of requested) {
    if (!Number.isInteger(firstBand) || firstBand < 0 || firstBand > BAND_COUNT - 2) return null;
    seen.add(firstBand);
  }
  return [...seen].sort((a, b) => a - b);
}

function proposalBoundaries(options) {
  const requested = options.proposalBoundaries;
  if (requested === undefined) {
    const layouts = ringLayouts(options);
    if (layouts === null) return null;
    // 여러 레이아웃을 함께 볼 땐 **가장 안쪽까지 링인 것** 을 기준으로 잡는다.
    // 그래야 순수 불스아이의 투표가 지금과 한 표도 다르지 않다(회귀 0).
    const firstBand = layouts[0];
    if (firstBand === 0) return DEFAULT_PROPOSAL_BOUNDARIES;
    // 경계 firstBand 는 «대체 무늬 ↔ 첫 링» 접면이다. 극성이 방향마다 섞이지만
    // (하이브리드에선 큐브의 밝은 면만 부호가 맞는다) 투표는 가산이라 맞는 방향의
    // 표만 쌓인다 — 실사진 대리 실험에서 이 경계를 넣은 쪽이 약한 후보 1건을 더 건졌다.
    const list = [];
    for (let boundary = firstBand; boundary < BAND_COUNT; boundary += 1) list.push(boundary);
    return Object.freeze(list);
  }
  if (!Array.isArray(requested)) return null;
  const seen = new Set();
  for (const boundary of requested) {
    if (!Number.isInteger(boundary) || boundary < 1 || boundary >= BAND_COUNT) return null;
    seen.add(boundary);
  }
  if (seen.size === 0) return null;
  return Object.freeze([...seen].sort((a, b) => a - b));
}

/** 내부 경계의 기대 gradient 부호를 이용한 radial-symmetry 중심 투표. */
function voteScale(level, gradients, outerRadius, boundaries) {
  const votes = new Float32Array(level.width * level.height);
  const contributionScale = 1 / outerRadius;
  for (const point of gradients) {
    const inverseMagnitude = 1 / point.magnitude;
    for (const boundary of boundaries) {
      const expectedSign = boundary % 2 === 1 ? 1 : -1;
      const radialX = expectedSign * point.gx * inverseMagnitude;
      const radialY = expectedSign * point.gy * inverseMagnitude;
      const boundaryRadius = (outerRadius * boundary) / BAND_COUNT;
      const centerX = Math.round(point.x - radialX * boundaryRadius);
      const centerY = Math.round(point.y - radialY * boundaryRadius);
      if (centerX < 1 || centerX >= level.width - 1
        || centerY < 1 || centerY >= level.height - 1) continue;
      votes[centerY * level.width + centerX] += point.magnitude * contributionScale;
    }
  }
  return votes;
}

function localVoteMaxima(level, votes, outerRadius) {
  const maxima = [];
  const width = level.width;
  for (let y = 2; y < level.height - 2; y += 1) {
    const rowStart = y * width;
    for (let x = 2; x < width - 2; x += 1) {
      const value = votes[rowStart + x];
      if (!(value > 0)) continue;
      let isMaximum = true;
      let neighborIndex = (y - 2) * width + x;
      for (let dy = -2; dy <= 2 && isMaximum; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const other = votes[neighborIndex + dx];
          if (other > value || (other === value && (dy < 0 || (dy === 0 && dx < 0)))) {
            isMaximum = false;
            break;
          }
        }
        neighborIndex += width;
      }
      if (isMaximum) maxima.push({ x, y, outerRadius, vote: value });
    }
  }
  maxima.sort((a, b) => b.vote - a.vote || a.y - b.y || a.x - b.x);
  return maxima.slice(0, PROPOSALS_PER_SCALE);
}
function collectRawProposals(luma, options) {
  const maxLevels = options.maxPyramidLevels === undefined
    ? MAX_PYRAMID_LEVELS
    : options.maxPyramidLevels;
  if (!Number.isInteger(maxLevels) || maxLevels < 1 || maxLevels > 8) return [];
  const boundaries = proposalBoundaries(options);
  if (boundaries === null) return [];
  const pyramid = makePyramid(luma, maxLevels);
  const raw = [];

  for (const level of pyramid) {
    const stats = robustStats(level);
    if (!(stats.span > 1e-6)) continue;
    const gradients = sobelPoints(level, stats.span);
    if (gradients.length === 0) continue;
    for (const radius of radiusSeedsForLevel(level, options)) {
      const votes = voteScale(level, gradients, radius, boundaries);
      for (const maximum of localVoteMaxima(level, votes, radius)) {
        raw.push({
          center: {
            x: maximum.x * level.factor + level.offset,
            y: maximum.y * level.factor + level.offset,
          },
          outerRadius: maximum.outerRadius * level.factor,
          vote: maximum.vote,
          pyramidLevel: level.level,
        });
      }
    }
  }

  raw.sort((a, b) => b.vote - a.vote
    || a.pyramidLevel - b.pyramidLevel
    || a.outerRadius - b.outerRadius
    || a.center.y - b.center.y
    || a.center.x - b.center.x);

  const kept = [];
  for (const proposal of raw) {
    const duplicate = kept.some((other) => {
      const centerLimit = 0.22 * Math.min(proposal.outerRadius, other.outerRadius);
      const scaleDistance = Math.abs(Math.log(proposal.outerRadius / other.outerRadius));
      return squaredDistance(proposal.center, other.center) <= centerLimit * centerLimit
        && scaleDistance <= RAW_SCALE_NMS_LOG_DISTANCE;
    });
    if (!duplicate) kept.push(proposal);
    if (kept.length >= MAX_RAW_PROPOSALS) break;
  }
  return kept;
}

/** params=[cx,cy,log(a),log(c),b,p,q], SPD S=[[a,b],[b,c]]. */
function homographyFromParams(params) {
  const [centerX, centerY, logA, logC, cross, tiltX, tiltY] = params;
  const a = Math.exp(logA);
  const c = Math.exp(logC);
  if (!(a * c - cross * cross > 1e-9)) return null;
  const tiltNorm = Math.sqrt(tiltX * tiltX + tiltY * tiltY);
  if (!(1 - CANONICAL_OUTER_RADIUS * tiltNorm > 0.15)) return null;
  return new Float64Array([
    a + centerX * tiltX,
    cross + centerX * tiltY,
    centerX,
    cross + centerY * tiltX,
    c + centerY * tiltY,
    centerY,
    tiltX,
    tiltY,
    1,
  ]);
}

function isotropicParams(center, cellSize) {
  return [center.x, center.y, Math.log(cellSize), Math.log(cellSize), 0, 0, 0];
}

function paramsFromHomography(H) {
  assertHomography(H);
  if (H[8] === 0) throw new RangeError('H[8]가 0이라 원점 중심 gauge로 정규화할 수 없다');
  const scale = 1 / H[8];
  const h = Array.from(H, (value) => value * scale);
  const centerX = h[2];
  const centerY = h[5];
  const tiltX = h[6];
  const tiltY = h[7];
  const j00 = h[0] - centerX * tiltX;
  const j01 = h[1] - centerX * tiltY;
  const j10 = h[3] - centerY * tiltX;
  const j11 = h[4] - centerY * tiltY;

  // 방사 패턴이 식별하지 못하는 회전 gauge를 제거한다. J=SPD·R인 left polar의
  // SPD=sqrt(JJᵀ)를 2×2 폐형식으로 계산한다.
  const c00 = j00 * j00 + j01 * j01;
  const c01 = j00 * j10 + j01 * j11;
  const c11 = j10 * j10 + j11 * j11;
  const determinant = c00 * c11 - c01 * c01;
  if (!(determinant > 0)) throw new RangeError('호모그래피의 국소 affine이 퇴화했다');
  const rootDet = Math.sqrt(determinant);
  const denominator = Math.sqrt(c00 + c11 + 2 * rootDet);
  const a = (c00 + rootDet) / denominator;
  const cross = c01 / denominator;
  const c = (c11 + rootDet) / denominator;
  if (!(a > 0 && c > 0 && a * c - cross * cross > 0)) {
    throw new RangeError('호모그래피의 SPD gauge를 만들 수 없다');
  }
  return [centerX, centerY, Math.log(a), Math.log(c), cross, tiltX, tiltY];
}

function homographyFromInitial(initial) {
  if (initial instanceof Float64Array) return initial;
  if (!initial || typeof initial !== 'object') {
    throw new TypeError('initial/transform은 Homography 또는 중심·cellSize 객체여야 한다');
  }
  const H = initial.transform ?? initial.B ?? initial.H;
  if (H !== undefined) {
    if (H instanceof Float64Array) return H;
    if (Array.isArray(H) && H.length === 9) return new Float64Array(H);
    throw new TypeError('transform/B/H는 길이 9 Homography여야 한다');
  }
  const center = initial.center;
  const cellSize = initial.cellSize ?? initial.cellSizePxAtCenter;
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)
    || !Number.isFinite(cellSize) || cellSize <= 0) {
    throw new TypeError('중심·cellSize가 유한한 초기 가설이어야 한다');
  }
  const params = isotropicParams(center, cellSize);
  if (initial.tilt && Number.isFinite(initial.tilt.x) && Number.isFinite(initial.tilt.y)) {
    params[5] = initial.tilt.x;
    params[6] = initial.tilt.y;
  }
  return homographyFromParams(params);
}

function project(H, x, y) {
  const denominator = H[6] * x + H[7] * y + H[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return null;
  return {
    x: (H[0] * x + H[1] * y + H[2]) / denominator,
    y: (H[3] * x + H[4] * y + H[5]) / denominator,
  };
}

function sampleBilinear(luma, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || y < 0 || x > luma.width - 1 || y > luma.height - 1) {
    return { inside: false, value: Number.NaN };
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, luma.width - 1);
  const y1 = Math.min(y0 + 1, luma.height - 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = luma.data[y0 * luma.width + x0] * (1 - tx)
    + luma.data[y0 * luma.width + x1] * tx;
  const bottom = luma.data[y1 * luma.width + x0] * (1 - tx)
    + luma.data[y1 * luma.width + x1] * tx;
  const value = top * (1 - ty) + bottom * ty;
  return { inside: Number.isFinite(value), value };
}

/** 반개구간 [하한,상한), 마지막만 상한 포함인 band index. */
function bandIndexAt(radius) {
  for (let band = 0; band < BAND_COUNT - 1; band += 1) {
    if (radius < CANONICAL_BAND_WIDTH * (band + 1)) return band;
  }
  return BAND_COUNT - 1;
}

function compareScored(a, b) {
  // 정제 중 hard check를 먼저 세우면 경계 중앙값이 잠시 0이 되는 한 step을 건너지
  // 못하고 약한 양수 plateau에 갇힌다. 연속 점수를 먼저 최적화하고 hard check는 동점만 푼다.
  if (Math.abs(a.score - b.score) > SCORE_EPSILON) return b.score - a.score;
  if (a.hardChecksPassed !== b.hardChecksPassed) return a.hardChecksPassed ? -1 : 1;
  if (Math.abs(a.radialError - b.radialError) > SCORE_EPSILON) {
    return a.radialError - b.radialError;
  }
  const ac = a.center;
  const bc = b.center;
  return ac.y - bc.y || ac.x - bc.x || a.cellSize - b.cellSize;
}

function scoreBullseyeCore(luma, H, options, stats) {
  const radialSamples = options.radialSamples === undefined
    ? DEFAULT_RADIAL_SAMPLES
    : options.radialSamples;
  const angularSamples = options.angularSamples === undefined
    ? DEFAULT_ANGULAR_SAMPLES
    : options.angularSamples;
  if (!Number.isInteger(radialSamples) || radialSamples < 12) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { message: 'radialSamples는 12 이상의 정수여야 한다' });
  }
  if (!Number.isInteger(angularSamples) || angularSamples < 12) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { message: 'angularSamples는 12 이상의 정수여야 한다' });
  }
  const firstBand = ringFirstBand(options);
  if (firstBand === null) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      message: `innerBandsReplaced 는 0..${BAND_COUNT - 2} 정수여야 한다`,
    });
  }
  // 살아 있는 밴드 firstBand..BAND_COUNT-1 사이의 «안쪽» 경계 수. 대체 무늬와 맞닿는
  // 경계(firstBand)는 세지 않는다 — 그 부호는 대체 무늬가 정하지 링이 정하지 않는다.
  const ringBoundaryCount = BAND_COUNT - 1 - firstBand;

  const bandSamples = Array.from({ length: BAND_COUNT }, () => []);
  const radiusSummaries = [];
  const lightSamples = [];
  const darkSamples = [];
  let projectedClosed = true;

  for (let radialIndex = 0; radialIndex < radialSamples; radialIndex += 1) {
    const radius = radialIndex === radialSamples - 1
      ? CANONICAL_OUTER_RADIUS
      : (CANONICAL_OUTER_RADIUS * radialIndex) / (radialSamples - 1);
    const expected = profileAt(radius, 1);
    const bandIndex = bandIndexAt(radius);
    // 대체된 안쪽 밴드는 링의 기대 프로파일을 따르지 않는다 — 표본·요약 어디에도
    // 넣지 않는다. 넣으면 contrast·template·MAD 가 전부 큐브 톤에 오염된다.
    if (bandIndex < firstBand) continue;
    const angularValues = [];
    for (let angularIndex = 0; angularIndex < angularSamples; angularIndex += 1) {
      const angle = (2 * Math.PI * angularIndex) / angularSamples;
      const point = project(H, radius * Math.cos(angle), radius * Math.sin(angle));
      if (point === null) {
        projectedClosed = false;
        continue;
      }
      const sampled = sampleBilinear(luma, point.x, point.y);
      if (!sampled.inside) {
        projectedClosed = false;
        continue;
      }
      angularValues.push(sampled.value);
      bandSamples[bandIndex].push(sampled.value);
      if (expected === 1) lightSamples.push(sampled.value);
      else darkSamples.push(sampled.value);
    }
    const radialMedian = median(angularValues);
    radiusSummaries.push({
      radius,
      expected,
      median: radialMedian,
      mad: mad(angularValues, radialMedian),
      count: angularValues.length,
    });
  }

  const bandMedians = bandSamples.map((samples) => median(samples));
  const bandMads = bandSamples.map((samples, index) => mad(samples, bandMedians[index]));
  const lightMedian = median(lightSamples);
  const darkMedian = median(darkSamples);
  const contrast = lightMedian - darkMedian;

  let alternating = bandMedians.slice(firstBand).every(Number.isFinite);
  const alternationMargins = [];
  for (let band = firstBand + 1; band < BAND_COUNT; band += 1) {
    const signed = band % 2 === 1
      ? bandMedians[band] - bandMedians[band - 1]
      : bandMedians[band - 1] - bandMedians[band];
    alternationMargins.push(signed);
    if (!(signed > 0)) alternating = false;
  }

  const projectedBandWidths = [];
  for (let angularIndex = 0; angularIndex < angularSamples; angularIndex += 1) {
    const angle = (2 * Math.PI * angularIndex) / angularSamples;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let previous = project(H, 0, 0);
    for (let boundary = 1; boundary <= BAND_COUNT; boundary += 1) {
      const radius = boundary === BAND_COUNT
        ? CANONICAL_OUTER_RADIUS
        : CANONICAL_BAND_WIDTH * boundary;
      const current = project(H, radius * cos, radius * sin);
      if (previous === null || current === null) {
        projectedClosed = false;
      } else {
        const dx = current.x - previous.x;
        const dy = current.y - previous.y;
        projectedBandWidths.push(Math.sqrt(dx * dx + dy * dy));
      }
      previous = current;
    }
  }
  const minProjectedBandWidth = projectedBandWidths.length === 0
    ? 0
    : Math.min(...projectedBandWidths);
  const medianProjectedBandWidth = median(projectedBandWidths);
  const cellSize = (medianProjectedBandWidth * BAND_COUNT) / CANONICAL_OUTER_RADIUS;

  const boundaryGradients = [];
  // canonical 비율을 고정하면 ppu가 커질수록 양쪽 표본이 경계에서 멀어져 점수 1의
  // 평탄부가 해상도에 비례해 넓어진다. 영상 픽셀 간격을 고정해 정제 분해능을 보존한다.
  const boundaryInset = Math.min(
    CANONICAL_BAND_WIDTH * 0.22,
    BOUNDARY_ALIGNMENT_INSET_PX / Math.max(cellSize, Number.EPSILON),
  );
  for (let boundary = firstBand + 1; boundary < BAND_COUNT; boundary += 1) {
    const radius = CANONICAL_BAND_WIDTH * boundary;
    const signedSamples = [];
    const expectedSign = boundary % 2 === 1 ? 1 : -1;
    for (let angularIndex = 0; angularIndex < angularSamples; angularIndex += 1) {
      const angle = (2 * Math.PI * angularIndex) / angularSamples;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const inner = project(H, (radius - boundaryInset) * cos, (radius - boundaryInset) * sin);
      const outer = project(H, (radius + boundaryInset) * cos, (radius + boundaryInset) * sin);
      if (inner === null || outer === null) {
        projectedClosed = false;
        continue;
      }
      const insideValue = sampleBilinear(luma, inner.x, inner.y);
      const outsideValue = sampleBilinear(luma, outer.x, outer.y);
      if (!insideValue.inside || !outsideValue.inside) {
        projectedClosed = false;
        continue;
      }
      signedSamples.push(expectedSign * (outsideValue.value - insideValue.value));
    }
    boundaryGradients.push({
      boundary,
      expectedSign,
      signedMedian: median(signedSamples),
      mad: mad(signedSamples),
      count: signedSamples.length,
    });
  }

  const usableRadialMads = radiusSummaries
    .filter((summary) => summary.radius > 0 && Number.isFinite(summary.mad))
    .map((summary) => summary.mad);
  const radialAngularMad = median(usableRadialMads);
  // 밴드 내부의 넓은 평탄부만 보면 중심이 몇 픽셀 틀려도 MAD 중앙값이 0이 된다.
  // 내부 다섯 경계에서 같은 반지름의 signed-gradient MAD를 함께 보아 그 plateau를 깬다.
  const boundaryAngularMad = median(boundaryGradients.map((entry) => entry.mad));
  const angularMad = Math.max(radialAngularMad, boundaryAngularMad);
  const angularMadContrast = contrast > 0 ? angularMad / contrast : Number.POSITIVE_INFINITY;

  const templateErrors = radiusSummaries
    .filter((summary) => Number.isFinite(summary.median))
    .map((summary) => Math.abs(
      summary.median - (summary.expected === 1 ? lightMedian : darkMedian),
    ));
  const radialError = contrast > 0
    ? median(templateErrors) / contrast
    : Number.POSITIVE_INFINITY;

  /*
   * 프레임 전역 span은 UI/테두리/질감의 범위이지 finder의 노출 범위가 아니다.
   * 후보 원판 안의 실제 표본만으로 정규화해야 주변 구조가 임계를 움직이지 않는다.
   * stats.span은 Sobel의 절대 하한과 진단에만 남긴다.
   */
  const localStats = robustStatsFromGroups(bandSamples.slice(firstBand));
  const robustSpan = localStats.span;
  const contrastPass = Number.isFinite(contrast)
    && Number.isFinite(robustSpan)
    && robustSpan > 1e-6
    && contrast >= robustSpan * MIN_CONTRAST_SPAN_RATIO;
  const boundaryAlignmentScores = boundaryGradients.map((entry) => (
    contrast > 0 ? clamp01(entry.signedMedian / contrast) : 0
  ));
  const gradientScore = boundaryAlignmentScores.length === ringBoundaryCount
    ? boundaryAlignmentScores.reduce((sum, value) => sum + value, 0)
      / boundaryAlignmentScores.length
    : 0;
  const boundarySignTolerance = Number.isFinite(contrast)
    ? Math.max(SCORE_EPSILON, Math.abs(contrast) * BOUNDARY_SIGN_TOLERANCE_RATIO)
    : SCORE_EPSILON;
  const boundariesNotReversed = boundaryGradients.length === ringBoundaryCount
    && boundaryGradients.every((entry) => entry.count === angularSamples
      && entry.signedMedian >= -boundarySignTolerance);
  const boundarySignsPass = boundariesNotReversed
    && gradientScore >= MIN_BOUNDARY_ALIGNMENT_SCORE;
  const outerBandLight = profileAt(CANONICAL_OUTER_RADIUS, 1) === 1
    && Number.isFinite(bandMedians[BAND_COUNT - 1])
    && bandMedians[BAND_COUNT - 1] > darkMedian;
  const angularSymmetryPass = Number.isFinite(angularMadContrast)
    && angularMadContrast <= MAX_ANGULAR_MAD_CONTRAST;
  const bandWidthPass = minProjectedBandWidth >= MIN_PROJECTED_BAND_WIDTH_PX;
  const sampleCoveragePass = bandSamples.slice(firstBand).every((samples) => samples.length > 0)
    && radiusSummaries.every((summary) => summary.count === angularSamples);

  const hardCheckDetails = {
    alternating,
    boundarySignsPass,
    contrastPass,
    angularSymmetryPass,
    outerBandLight,
    projectedClosed,
    bandWidthPass,
    sampleCoveragePass,
  };
  const hardChecksPassed = Object.values(hardCheckDetails).every(Boolean);

  const contrastScore = robustSpan > 0
    ? clamp01(contrast / (robustSpan * MIN_CONTRAST_SPAN_RATIO))
    : 0;
  const minAlternationMargin = alternationMargins.length === ringBoundaryCount
    ? Math.min(...alternationMargins)
    : 0;
  const alternationScore = contrast > 0
    ? clamp01((minAlternationMargin * 2) / contrast)
    : 0;
  // 중앙값 하나를 2×로 포화시키지 않고 모든 경계 정렬도를 목적함수에 반영한다.
  const symmetryScore = Number.isFinite(angularMadContrast)
    ? clamp01(1 - angularMadContrast / MAX_ANGULAR_MAD_CONTRAST)
    : 0;
  const templateScore = Number.isFinite(radialError) ? clamp01(1 - radialError) : 0;
  let score = 0.28 * contrastScore
    + 0.22 * alternationScore
    + 0.22 * gradientScore
    + 0.18 * symmetryScore
    + 0.10 * templateScore;
  if (!projectedClosed || !bandWidthPass || !sampleCoveragePass) score *= 0.5;
  score = clamp01(score);

  const center = project(H, 0, 0) ?? { x: Number.NaN, y: Number.NaN };
  const bands = {
    firstBand,
    values: bandMedians.map((value, index) => ({
      index,
      expected: index % 2 === 0 ? 0 : 1,
      replaced: index < firstBand,
      median: value,
      mad: bandMads[index],
      count: bandSamples[index].length,
    })),
    contrast,
    darkMedian,
    lightMedian,
    angularMad,
    radialAngularMad,
    boundaryAngularMad,
    angularMadContrast,
    boundaryGradients,
    boundaryAlignmentScore: gradientScore,
    boundaryAlignmentInsetPx: boundaryInset * cellSize,
    normalizationSpan: robustSpan,
    normalizationSpanSource: 'candidate-local-p05-p95',
    globalSpan: stats.span,
    minProjectedBandWidth,
    medianProjectedBandWidth,
    hardChecks: hardCheckDetails,
  };

  return ok({
    transform: H,
    B: H,
    center,
    cellSize,
    score,
    bands,
    contrast,
    radialError,
    hardChecksPassed,
  });
}

/**
 * 주어진 canonical→image 변환의 6밴드 적합 점수를 계산한다.
 * hard check 실패도 수렴 진단에 필요하므로 ok:true, hardChecksPassed:false로 낸다.
 */
export function scoreBullseye(luma, transform, options = {}) {
  const checked = checkedLuma(luma);
  if (!checked.ok) return checked;
  let H;
  try {
    H = homographyFromInitial(transform);
    assertHomography(H);
  } catch (error) {
    return fail(FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE, { message: error.message });
  }
  const stats = robustStats(luma);
  if (!(stats.span > 1e-6)) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { message: '휘도 span이 없어 불스아이 점수를 만들 수 없다' });
  }
  return scoreBullseyeCore(luma, H, options, stats);
}

function candidateFromScore(scored) {
  return {
    center: scored.center,
    cellSize: scored.cellSize,
    score: scored.score,
    bands: scored.bands,
    hardChecksPassed: scored.hardChecksPassed,
    // BullseyeCandidate의 필수 shape는 바꾸지 않고 후단 재사용용 진단만 확장한다.
    transform: scored.transform,
    B: scored.B,
    contrast: scored.contrast,
    radialError: scored.radialError,
  };
}

function lowCostScoreOptions(options) {
  return {
    ...options,
    radialSamples: options.refineRadialSamples === undefined
      ? REFINEMENT_RADIAL_SAMPLES
      : options.refineRadialSamples,
    angularSamples: options.refineAngularSamples === undefined
      ? REFINEMENT_ANGULAR_SAMPLES
      : options.refineAngularSamples,
  };
}

function scoreParams(luma, params, options, stats) {
  const H = homographyFromParams(params);
  if (H === null) return null;
  const scored = scoreBullseyeCore(luma, H, options, stats);
  return scored.ok ? candidateFromScore(scored) : null;
}

function isotropicGridRefine(luma, initialParams, options, stats) {
  let params = initialParams.slice();
  let current = scoreParams(luma, params, options, stats);
  if (current === null) return fail(FRONTEND_FAILURE.NO_FINDER, {
    message: '등방 격자 정제의 초기 변환이 퇴화했다',
  });

  for (const step of ISOTROPIC_GRID_STEPS) {
    const a = Math.exp(params[2]);
    const c = Math.exp(params[3]);
    const localCellSize = Math.sqrt(Math.max(1e-9, a * c - params[4] * params[4]));
    let bestParams = params;
    let best = current;
    for (let dyIndex = -step.centerSubdivisions;
      dyIndex <= step.centerSubdivisions; dyIndex += 1) {
      const dy = dyIndex / step.centerSubdivisions;
      for (let dxIndex = -step.centerSubdivisions;
        dxIndex <= step.centerSubdivisions; dxIndex += 1) {
        const dx = dxIndex / step.centerSubdivisions;
        for (let scaleDirection = -step.scaleRadius;
          scaleDirection <= step.scaleRadius; scaleDirection += 1) {
          if (dx === 0 && dy === 0 && scaleDirection === 0) continue;
          const trialParams = params.slice();
          trialParams[0] += dx * localCellSize * step.center;
          trialParams[1] += dy * localCellSize * step.center;
          trialParams[2] += scaleDirection * step.logScale;
          trialParams[3] += scaleDirection * step.logScale;
          const trial = scoreParams(luma, trialParams, options, stats);
          if (trial !== null && compareScored(trial, best) < 0) {
            best = trial;
            bestParams = trialParams;
          }
        }
      }
    }
    params = bestParams;
    current = best;
  }
  return ok({ candidate: current, params });
}

function coordinateRefine(luma, initialParams, options, stats) {
  const iterations = options.refineIterations === undefined
    ? DEFAULT_REFINE_ITERATIONS
    : options.refineIterations;
  if (!Number.isInteger(iterations) || iterations < 0 || iterations > 20) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { message: 'refineIterations는 0..20 정수여야 한다' });
  }
  let params = initialParams.slice();
  let current = scoreParams(luma, params, options, stats);
  if (current === null) return fail(FRONTEND_FAILURE.NO_FINDER, { message: '초기 변환이 퇴화했다' });

  const a = Math.exp(params[2]);
  const c = Math.exp(params[3]);
  const localCellSize = Math.sqrt(Math.max(1e-9, a * c - params[4] * params[4]));
  const localBandWidth = (localCellSize * CANONICAL_OUTER_RADIUS) / BAND_COUNT;
  const steps = [
    Math.max(0.25, localBandWidth * 0.45),
    Math.max(0.25, localBandWidth * 0.45),
    0.06,
    0.06,
    localCellSize * 0.055,
    0.008,
    0.008,
  ];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let dimension = 0; dimension < params.length; dimension += 1) {
      let bestParams = params;
      let best = current;
      for (const direction of [-1, 1]) {
        const trialParams = params.slice();
        trialParams[dimension] += direction * steps[dimension];
        const trial = scoreParams(luma, trialParams, options, stats);
        if (trial !== null && compareScored(trial, best) < 0) {
          best = trial;
          bestParams = trialParams;
        }
      }
      params = bestParams;
      current = best;
    }
    for (let dimension = 0; dimension < steps.length; dimension += 1) {
      steps[dimension] *= 0.5;
    }
  }
  return ok({ candidate: current });
}

function refineBullseyeCore(luma, initial, options, stats) {
  let baseParams;
  try {
    baseParams = paramsFromHomography(homographyFromInitial(initial));
  } catch (error) {
    return fail(FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE, { message: error.message });
  }

  const fastOptions = lowCostScoreOptions(options);
  const gridded = isotropicGridRefine(luma, baseParams, fastOptions, stats);
  if (!gridded.ok) return gridded;
  baseParams = gridded.params;

  const seeds = options.projectiveSeeds === false
    ? [[baseParams[5], baseParams[6]]]
    : PROJECTIVE_TILT_SEEDS.map(([x, y]) => [baseParams[5] + x, baseParams[6] + y]);
  const seededCandidates = [];
  // 모든 tilt seed를 저비용 표본으로 먼저 평가하고, 최고 seed 하나만 고정 횟수 정제한다.
  // 첫 hard-pass seed에서 멈추지 않으므로 seed 순서가 결과를 바꾸지 않는다.
  for (const [tiltX, tiltY] of seeds) {
    const seeded = baseParams.slice();
    seeded[5] = tiltX;
    seeded[6] = tiltY;
    const candidate = scoreParams(luma, seeded, fastOptions, stats);
    if (candidate !== null) seededCandidates.push({ params: seeded, candidate });
  }
  if (seededCandidates.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { message: '모든 projective seed의 초기 평가가 실패했다' });
  }
  seededCandidates.sort((a, b) => compareScored(a.candidate, b.candidate));
  const refined = coordinateRefine(luma, seededCandidates[0].params, fastOptions, stats);
  if (!refined.ok) return refined;

  // 저비용 표본은 탐색에만 쓴다. 공개 점수와 hard check는 규범 기본 64×48로 다시 계산한다.
  // 격자 결과도 함께 보존해 projective coordinate descent의 저비용 표본 과적합을 막는다.
  const finalScores = [
    scoreBullseyeCore(luma, gridded.candidate.transform, options, stats),
    scoreBullseyeCore(luma, refined.candidate.transform, options, stats),
  ].filter((entry) => entry.ok).map(candidateFromScore);
  if (finalScores.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { message: '정제 후보의 최종 점수를 만들 수 없다' });
  }
  finalScores.sort(compareScored);
  return ok({
    candidate: finalScores[0],
    evaluatedSeeds: seededCandidates.length,
  });
}

/** 고정 seed와 고정 횟수 coordinate descent로 한 초기 가설을 정제한다. */
export function refineBullseye(luma, initial, options = {}) {
  const checked = checkedLuma(luma);
  if (!checked.ok) return checked;
  const stats = robustStats(luma);
  if (!(stats.span > 1e-6)) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { message: '휘도 span이 없어 정제할 수 없다' });
  }
  return refineBullseyeCore(luma, initial, options, stats);
}

function selectRefinementEntries(coarse, limit) {
  const byScore = coarse.slice();
  const byVote = coarse.slice().sort((a, b) => b.proposal.vote - a.proposal.vote
    || a.proposal.pyramidLevel - b.proposal.pyramidLevel
    || compareScored(a.candidate, b.candidate));
  const selected = [];
  const seen = new Set();
  for (let index = 0; selected.length < limit
    && (index < byScore.length || index < byVote.length); index += 1) {
    for (const entry of [byScore[index], byVote[index]]) {
      if (entry !== undefined && !seen.has(entry)) {
        seen.add(entry);
        selected.push(entry);
        if (selected.length >= limit) break;
      }
    }
  }
  return selected;
}

function finalCandidateNms(candidates) {
  const kept = [];
  for (const candidate of candidates) {
    const duplicate = kept.some((other) => {
      const outerA = candidate.cellSize * CANONICAL_OUTER_RADIUS;
      const outerB = other.cellSize * CANONICAL_OUTER_RADIUS;
      const limit = FINAL_CENTER_NMS_RADIUS_FACTOR * Math.min(outerA, outerB);
      return squaredDistance(candidate.center, other.center) <= limit * limit;
    });
    if (!duplicate) kept.push(candidate);
  }
  return kept;
}

/**
 * Type O 불스아이 후보를 전부 평가해 점수순으로 반환한다.
 * @returns {{ok:true,candidates:object[]}|{ok:false,reason:string,detail?:object}}
 */
export function detectBullseyes(luma, options = {}) {
  const checked = checkedLuma(luma);
  if (!checked.ok) return checked;
  const stats = robustStats(luma);
  if (!(stats.span > 1e-6)) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { message: '유효 휘도 대비가 없다' });
  }

  const raw = collectRawProposals(luma, options);
  if (raw.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { message: '방사 대칭 중심 proposal이 없다' });
  }

  const layouts = ringLayouts(options);
  if (layouts === null) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      message: `ringLayouts 는 0..${BAND_COUNT - 2} 정수 배열이어야 한다`,
    });
  }

  const coarse = [];
  const fastOptions = lowCostScoreOptions(options);
  for (const proposal of raw) {
    const cellSize = proposal.outerRadius / CANONICAL_OUTER_RADIUS;
    const H = homographyFromParams(isotropicParams(proposal.center, cellSize));
    if (H === null) continue;
    for (const firstBand of layouts) {
      const layoutOptions = { ...fastOptions, innerBandsReplaced: firstBand };
      const scored = scoreBullseyeCore(luma, H, layoutOptions, stats);
      if (scored.ok) {
        coarse.push({
          proposal,
          firstBand,
          candidate: candidateFromScore(scored),
        });
      }
    }
  }
  coarse.sort((a, b) => compareScored(a.candidate, b.candidate)
    || b.proposal.vote - a.proposal.vote
    || a.proposal.pyramidLevel - b.proposal.pyramidLevel);

  const refineLimit = options.maxRefinedProposals === undefined
    ? MAX_REFINED_PROPOSALS
    : options.maxRefinedProposals;
  if (!Number.isInteger(refineLimit) || refineLimit < 1 || refineLimit > MAX_RAW_PROPOSALS) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      message: 'maxRefinedProposals는 1..' + MAX_RAW_PROPOSALS + ' 정수여야 한다',
    });
  }

  // 예산은 «몇 개의 제안을 정제하나» 로 읽는다. 레이아웃이 둘이면 같은 제안이 두 항목이
  // 되므로 그만큼 늘려야 순수 불스아이 때와 같은 수의 **서로 다른 중심**을 정제한다.
  const refinementEntries = selectRefinementEntries(
    coarse,
    Math.min(refineLimit * layouts.length, MAX_RAW_PROPOSALS),
  );
  const refined = [];
  // 첫 통과에서 반환하지 않는다. 점수·방사 투표 순위를 섞은 고정 예산을 모두 정제한다.
  for (const entry of refinementEntries) {
    // 정제도 그 후보를 만든 레이아웃으로 해야 한다 — 섞이면 큐브 자리를 링으로 재고
    // 중심이 그리로 끌려간다.
    const layoutOptions = { ...options, innerBandsReplaced: entry.firstBand };
    const result = refineBullseyeCore(luma, entry.candidate, layoutOptions, stats);
    if (!result.ok) continue;
    if (entry.firstBand === 0) {
      refined.push({ ...result.candidate, innerBandsReplaced: 0 });
      continue;
    }
    /*
     * 하이브리드라는 «주장» 에는 큐브를 실제로 봤다는 증거를 요구한다.
     *
     * 없으면 이런 일이 난다(실측, 2026-08-12): 뭉개진 **순수** 불스아이가 하이브리드로
     * 채점될 때 더 높은 점수를 받는다 — 블러로 뭉개진 안쪽 두 밴드를 «어차피 링이 아닌
     * 자리» 라며 빼고 재기 때문이다. 그 후보로 정제가 진행되면 안쪽 정보를 버린 채
     * 중심을 맞추게 되고, ring-3 포맷 표본이 어긋나 복호가 죽는다.
     * (jpeg q60 + blur 3점 스윕이 이걸 잡아냈다.)
     */
    const cube = readCubeOrientation(luma, {
      transform: result.candidate.transform,
      innerBandsReplaced: entry.firstBand,
    });
    if (cube === null
      || !(cube.orientationMargin >= MIN_CUBE_TONE_RANK_MARGIN)
      || !(cube.faceFlatness >= MIN_CUBE_FACE_FLATNESS)) continue;
    refined.push({
      ...result.candidate,
      innerBandsReplaced: entry.firstBand,
      rotationDegrees: cube.rotationDegrees,
      orientation: cube.orientation,
      orientationSource: 'hybrid-cube-face-rank',
      orientationMargin: cube.orientationMargin,
      cubeFaceMedians: cube.faceMedians,
    });
  }
  refined.sort(compareScored);

  const valid = finalCandidateNms(refined.filter((candidate) => candidate.hardChecksPassed));
  valid.sort(compareScored);
  if (valid.length === 0) {
    const best = refined[0] ?? coarse[0]?.candidate;
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      evaluatedRaw: raw.length,
      evaluatedRefined: refinementEntries.length,
      bestScore: best?.score,
      bestCandidate: best && {
        center: { x: best.center.x, y: best.center.y },
        cellSize: best.cellSize,
      },
      hardChecks: best?.bands?.hardChecks,
    });
  }
  return ok({ candidates: valid });
}
