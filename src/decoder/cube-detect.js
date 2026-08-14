/**
 * cube-detect.js — Type Y 영상 기하 검출과 세 면 모듈 샘플링.
 *
 * 검출 계약은 외곽 단독이 아니다. 정육각형 실루엣, 중앙 Y 심의 세 어두운 seam,
 * 세 면 공변 n x n 기저, referenceAnchors(n)의 네 분산 조를 모두 양성 증거로
 * 요구한다. 불스아이 검출 실패는 이 경로의 입력이 아니다.
 *
 * 모든 임계값은 M1 실측 전 [미검증]이며 options.calibration으로 교체할 수 있다.
 * Homography 방향은 canonical Euclidean -> image pixel로 고정한다.
 */

import {
  CORNER_UNIT_OFFSETS,
} from '../hexgrid.js';
import {
  FINDER_CUBE_FACE_RANKS,
  FINDER_CUBE_RADIUS_CELLS,
  THREE_TONE_CUBE_FINDER_PATTERN_ID,
} from '../finder-patterns.js';
import {
  digitToRanks,
  ranksToDigit,
} from '../lehmer.js';
import {
  referenceAnchors,
  referenceGroups,
} from '../placementY.js';
import {
  patternToDigit,
  TONE_PATTERNS,
} from '../tonemap.js';
import {
  moduleSampleDisc,
  YFACES,
} from '../ygrid.js';
import {
  FRONTEND_FAILURE,
  HOMOGRAPHY_CANONICAL_SPACE,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import {
  sampleProjectedDisc,
} from './grid-sample.js';
import {
  estimateHomography4,
  PROJECTIVE_DENOMINATOR_MIN_RATIO,
  projectPoint,
} from './homography.js';
import {
  locatorSourceId, shrinkSilhouetteToCubeCandidates,
} from './locatorY-detect.js';
import {
  LOCATOR_PROFILE_HEX_FRAME_V1,
  LOCATOR_PROFILE_OFF,
} from '../locatorY.js';
import { CELL_SURFACE_PROFILE_ID } from '../cellSurfaceY.js';
import { evaluateCellSurfaceGeometry } from './cellSurfaceY-detect.js';

function locatorShapesFromSilhouette(luma, shapes, options) {
  const extra = [];
  const diagnostics = [];
  for (const shape of shapes.candidates) {
    if (!shape.vertices || shape.vertices.length !== 6) continue;
    extra.push(...shrinkSilhouetteToCubeCandidates(luma, shape, {
      ...options,
      locatorYDiagnostics: diagnostics,
    }));
  }
  return { candidates: extra, diagnostics };
}

export const UNVERIFIED_CUBE_DETECTION = Object.freeze({
  maxDimension: 1024,
  backgroundClusters: 4,
  backgroundToleranceFloor: 0.018,
  backgroundSpreadMultiplier: 2.5,
  foregroundDensityRadius: 4,
  minimumForegroundDensity: 0.25,
  minimumComponentAreaFraction: 0.0025,
  maximumComponentAreaFraction: 0.82,
  minimumComponentPixels: 48,
  maximumComponents: 16,
  minimumMaskFill: 0.12,
  maximumConcurrencyResidual: 0.14,
  minimumSeamContrast: 0.010,
  minimumSeamSupport: 0.34,
  minimumSeamParityMargin: 0.0005,
  maximumVertexResidual: 0.105,
  minimumReferenceAgreement: 10 / 12,
  minimumToneSpan: 0.012,
  minimumTwoToneRatio: 1.35,
  minimumProjectedMinorDiameter: 0.8,
  minimumSampleCount: 3,
  sampleDiscFraction: 0.35,
  referenceRefineRadiusModules: 0.45,
  referenceRefineStepModules: 0.125,
  referenceRefineScaleRadius: 0.035,
  referenceRefineScaleStep: 0.0175,
  maximumShapeCandidates: 4,
  minimumFinderToneSpanRatio: 0.05,
  minimumFinderOrientationMargin: 0.04,
});

const EPSILON = 1e-9;
const SUPPORTED_N = Object.freeze([13, 21, 25]);
const SUPPORTED_TONES = Object.freeze([2, 3]);
const CANONICAL_SEAM_CORNERS = Object.freeze([1, 3, 5]);
const TONE_FACE_INDEX = Object.freeze({ T: 0, L: 1, R: 2 });

/*
 * 레퍼런스 보정과 심 점수는 짧은 배열의 중앙값을 매우 자주 구한다. 매 호출마다
 * Array#sort와 복사 배열을 만들지 않고, 숫자/순번 scratch에서 필요한 순위만
 * quickselect 한다. NaN과 -0은 stable Array#sort((a, b) => a - b)의 순서를
 * 그대로 따르기 위해 별도 안정 경로를 둔다.
 */
let statsValuesScratch = new Float64Array(0);
let statsOrderScratch = new Uint32Array(0);
let statsUseStableOrder = false;

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

function medianFromArrayLike(values, length) {
  if (length === 0) return Number.NaN;
  prepareStatsValues(values, length);
  return medianFromPreparedStats(length);
}


/* shape 후보는 한 프레임 안에서 순차적으로만 소비된다. 큰 mask/queue를 재사용해
 * 반복적인 zero-fill 할당과 GC를 없애되, 호출마다 visit stamp와 경계 초기화로 새
 * Uint8Array와 동일한 관측값을 만든다. */
let closeMaskDilatedScratch = new Uint8Array(0);
let closeMaskClosedScratch = new Uint8Array(0);
let componentVisitedScratch = new Uint32Array(0);
let componentQueueScratch = new Int32Array(0);
let componentVisitStamp = 0;

function ensureShapeScratch(length) {
  if (closeMaskDilatedScratch.length < length) {
    closeMaskDilatedScratch = new Uint8Array(length);
    closeMaskClosedScratch = new Uint8Array(length);
  }
  if (componentVisitedScratch.length < length) {
    componentVisitedScratch = new Uint32Array(length);
    componentQueueScratch = new Int32Array(length);
    componentVisitStamp = 0;
  }
}

function calibration(options) {
  const supplied = options && options.calibration && typeof options.calibration === 'object'
    ? options.calibration
    : {};
  return { ...UNVERIFIED_CUBE_DETECTION, ...supplied };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return NaN;
  return medianFromArrayLike(values, values.length);
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
  return (a * (1 - tx) + b * tx) * (1 - ty)
    + (c * (1 - tx) + d * tx) * ty;
}

function downsampleLuma(luma, maxDimension) {
  const factor = Math.max(1, Math.ceil(Math.max(luma.width, luma.height) / maxDimension));
  if (factor === 1) return { luma, factor };
  const width = Math.ceil(luma.width / factor);
  const height = Math.ceil(luma.height / factor);
  const data = new Float32Array(width * height);
  const alpha = luma.alpha ? new Uint8Array(width * height) : null;
  // 원본은 안쪽 두 루프의 **종료 조건에서** Math.min 과 luma.width/height 프로퍼티를
  // 매 픽셀 다시 읽었다. 값은 그대로 두고 경계만 밖으로 끌어낸다.
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
      let maximumAlpha = 0;
      if (sourceAlpha) {
        for (let sourceY = yStart; sourceY < yEnd; sourceY += 1) {
          const row = sourceY * sourceWidth;
          for (let sourceX = xStart; sourceX < xEnd; sourceX += 1) {
            const index = row + sourceX;
            const a = sourceAlpha[index];
            if (a > maximumAlpha) maximumAlpha = a;
            if (a === 0) continue;
            sum += sourceData[index];
            count += 1;
          }
        }
      } else {
        maximumAlpha = 255;
        for (let sourceY = yStart; sourceY < yEnd; sourceY += 1) {
          const row = sourceY * sourceWidth;
          for (let sourceX = xStart; sourceX < xEnd; sourceX += 1) {
            sum += sourceData[row + sourceX];
            count += 1;
          }
        }
      }
      const target = y * width + x;
      data[target] = count > 0 ? sum / count : 0;
      if (alpha) alpha[target] = maximumAlpha;
    }
  }
  return { luma: { width, height, data, alpha }, factor };
}

function borderValues(luma) {
  const values = [];
  const band = Math.max(1, Math.min(6, Math.floor(Math.min(luma.width, luma.height) * 0.015)));
  for (let y = 0; y < luma.height; y += 1) {
    for (let x = 0; x < luma.width; x += 1) {
      if (x >= band && x < luma.width - band && y >= band && y < luma.height - band) continue;
      const index = y * luma.width + x;
      if (luma.alpha && luma.alpha[index] === 0) continue;
      const value = luma.data[index];
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

function backgroundModels(values, cfg) {
  if (values.length === 0) return [];
  const ordered = values.slice().sort((a, b) => a - b);
  const k = Math.max(1, Math.min(cfg.backgroundClusters, ordered.length));
  let means = Array.from({ length: k }, (_, index) => {
    const q = (index + 0.5) / k;
    return ordered[Math.min(ordered.length - 1, Math.floor(q * ordered.length))];
  });

  let assignments = new Int16Array(values.length);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sums = new Float64Array(k);
    const counts = new Uint32Array(k);
    for (let index = 0; index < values.length; index += 1) {
      let best = 0;
      let bestDistance = Math.abs(values[index] - means[0]);
      for (let cluster = 1; cluster < k; cluster += 1) {
        const distance = Math.abs(values[index] - means[cluster]);
        if (distance < bestDistance) {
          best = cluster;
          bestDistance = distance;
        }
      }
      assignments[index] = best;
      sums[best] += values[index];
      counts[best] += 1;
    }
    means = means.map((mean, index) => counts[index] > 0 ? sums[index] / counts[index] : mean);
  }

  const models = [];
  for (let cluster = 0; cluster < k; cluster += 1) {
    const members = [];
    for (let index = 0; index < values.length; index += 1) {
      if (assignments[index] === cluster) members.push(values[index]);
    }
    if (members.length < Math.max(3, Math.floor(values.length * 0.015))) continue;
    const mean = members.reduce((sum, value) => sum + value, 0) / members.length;
    const spread = median(members.map((value) => Math.abs(value - mean)));
    models.push({
      mean,
      tolerance: Math.max(
        cfg.backgroundToleranceFloor,
        Number.isFinite(spread) ? spread * cfg.backgroundSpreadMultiplier : 0,
      ),
      count: members.length,
    });
  }
  models.sort((left, right) => left.mean - right.mean);

  const merged = [];
  for (const model of models) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.mean - model.mean)
      <= Math.max(previous.tolerance, model.tolerance) * 0.35) {
      const count = previous.count + model.count;
      previous.mean = (previous.mean * previous.count + model.mean * model.count) / count;
      previous.tolerance = Math.max(previous.tolerance, model.tolerance);
      previous.count = count;
    } else {
      merged.push({ ...model });
    }
  }
  return merged;
}


// 휘도 모드에서 벗어난 원시 마스크를 저주파 점유율로 한 번 더 본다. 모아레의
// 산발적 잔차는 창 안에서 희석되지만, 코드 면의 비배경 픽셀은 조밀하게 남는다.
// 원시 마스크 자체는 폐기하지 않고 별도 shape 후보원으로 유지한다.
function recoverStructuredForeground(rawMask, width, height, cfg) {
  const radius = Math.max(0, Math.floor(cfg.foregroundDensityRadius));
  if (radius === 0) return { mask: rawMask, recoveredPixels: 0 };

  const stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += rawMask[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }

  const mask = rawMask.slice();
  let recoveredPixels = 0;
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (rawMask[index]) continue;
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const foreground = integral[bottom * stride + right]
        - integral[top * stride + right]
        - integral[bottom * stride + left]
        + integral[top * stride + left];
      const density = foreground / ((right - left) * (bottom - top));
      if (density >= cfg.minimumForegroundDensity) {
        mask[index] = 1;
        recoveredPixels += 1;
      }
    }
  }
  return { mask, recoveredPixels };
}

function foregroundMask(luma, cfg) {
  const length = luma.width * luma.height;
  const mask = new Uint8Array(length);
  let transparent = 0;
  if (luma.alpha) {
    for (let index = 0; index < length; index += 1) {
      if (luma.alpha[index] < 32) transparent += 1;
    }
  }

  if (luma.alpha && transparent >= length * 0.02) {
    for (let index = 0; index < length; index += 1) {
      mask[index] = luma.alpha[index] >= 128 ? 1 : 0;
    }
    return { mask, models: [], source: 'alpha' };
  }

  const models = backgroundModels(borderValues(luma), cfg);
  if (models.length === 0) return { mask, models, source: 'none' };
  for (let index = 0; index < length; index += 1) {
    if (luma.alpha && luma.alpha[index] === 0) continue;
    const value = luma.data[index];
    let background = false;
    for (const model of models) {
      if (Math.abs(value - model.mean) <= model.tolerance) {
        background = true;
        break;
      }
    }
    mask[index] = background ? 0 : 1;
  }
  const structured = recoverStructuredForeground(
    mask,
    luma.width,
    luma.height,
    cfg,
  );
  return {
    mask,
    structuredMask: structured.mask,
    models,
    source: 'border-clusters',
    rawForegroundPixels: mask.reduce((sum, value) => sum + value, 0),
    recoveredForegroundPixels: structured.recoveredPixels,
  };
}

function closeMask(mask, width, height) {
  const length = mask.length;
  ensureShapeScratch(length);
  const dilated = closeMaskDilatedScratch.length === length
    ? closeMaskDilatedScratch
    : closeMaskDilatedScratch.subarray(0, length);
  const closed = closeMaskClosedScratch.length === length
    ? closeMaskClosedScratch
    : closeMaskClosedScratch.subarray(0, length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 0;
      for (let oy = -1; oy <= 1 && on === 0; oy += 1) {
        const yy = y + oy;
        if (yy < 0 || yy >= height) continue;
        for (let ox = -1; ox <= 1; ox += 1) {
          const xx = x + ox;
          if (xx >= 0 && xx < width && mask[yy * width + xx]) {
            on = 1;
            break;
          }
        }
      }
      dilated[y * width + x] = on;
    }
  }

  if (height > 0) {
    for (let x = 0; x < width; x += 1) {
      closed[x] = 0;
      closed[(height - 1) * width + x] = 0;
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    closed[row] = 0;
    if (width > 1) closed[row + width - 1] = 0;
    for (let x = 1; x < width - 1; x += 1) {
      let on = 1;
      for (let oy = -1; oy <= 1 && on === 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (!dilated[(y + oy) * width + x + ox]) {
            on = 0;
            break;
          }
        }
      }
      closed[row + x] = on;
    }
  }
  return closed;
}
function connectedComponents(mask, width, height, cfg) {
  ensureShapeScratch(mask.length);
  componentVisitStamp += 1;
  if (componentVisitStamp > 0xffffffff) {
    componentVisitedScratch.fill(0);
    componentVisitStamp = 1;
  }
  const stamp = componentVisitStamp;
  const visited = componentVisitedScratch;
  const queue = componentQueueScratch;
  const components = [];
  const minimum = Math.max(
    cfg.minimumComponentPixels,
    Math.floor(mask.length * cfg.minimumComponentAreaFraction),
  );
  const maximum = Math.floor(mask.length * cfg.maximumComponentAreaFraction);

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start] === stamp) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = stamp;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const boundary = [];

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      let edge = false;
      let next;

      if (x + 1 >= width) {
        edge = true;
      } else {
        next = index + 1;
        if (!mask[next]) edge = true;
        else if (visited[next] !== stamp) {
          visited[next] = stamp;
          queue[tail++] = next;
        }
      }
      if (x - 1 < 0) {
        edge = true;
      } else {
        next = index - 1;
        if (!mask[next]) edge = true;
        else if (visited[next] !== stamp) {
          visited[next] = stamp;
          queue[tail++] = next;
        }
      }
      if (y + 1 >= height) {
        edge = true;
      } else {
        next = index + width;
        if (!mask[next]) edge = true;
        else if (visited[next] !== stamp) {
          visited[next] = stamp;
          queue[tail++] = next;
        }
      }
      if (y - 1 < 0) {
        edge = true;
      } else {
        next = index - width;
        if (!mask[next]) edge = true;
        else if (visited[next] !== stamp) {
          visited[next] = stamp;
          queue[tail++] = next;
        }
      }

      if (edge) boundary.push({ x: x + 0.5, y: y + 0.5 });
    }

    if (area >= minimum && area <= maximum && boundary.length >= 6) {
      components.push({ area, minX, minY, maxX, maxY, boundary });
    }
  }


  return components.sort((left, right) =>
    right.area - left.area
    || left.minY - right.minY
    || left.minX - right.minX)
    .slice(0, cfg.maximumComponents);
}
function cross(origin, left, right) {
  return (left.x - origin.x) * (right.y - origin.y)
    - (left.y - origin.y) * (right.x - origin.x);
}

function convexHull(points) {
  const ordered = points.slice().sort((left, right) =>
    left.x - right.x || left.y - right.y);
  if (ordered.length <= 1) return ordered;
  const lower = [];
  for (const point of ordered) {
    while (lower.length >= 2
      && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper = [];
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const point = ordered[index];
    while (upper.length >= 2
      && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(points) {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    twice += points[index].x * next.y - next.x * points[index].y;
  }
  return twice / 2;
}

function simplifyHullToHex(hull) {
  const points = hull.slice();
  while (points.length > 6) {
    let remove = 0;
    let cost = Infinity;
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index + points.length - 1) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const triangle = Math.abs(cross(previous, current, next));
      const span = Math.hypot(next.x - previous.x, next.y - previous.y);
      const normalized = triangle / Math.max(span, EPSILON);
      if (normalized < cost) {
        cost = normalized;
        remove = index;
      }
    }
    points.splice(remove, 1);
  }
  if (points.length !== 6) return null;
  if (polygonArea(points) < 0) points.reverse();
  return points;
}

function lineIntersection(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= EPSILON) return null;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / denominator;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

function diagonalCenter(vertices) {
  const intersections = [
    lineIntersection(vertices[0], vertices[3], vertices[1], vertices[4]),
    lineIntersection(vertices[1], vertices[4], vertices[2], vertices[5]),
    lineIntersection(vertices[2], vertices[5], vertices[0], vertices[3]),
  ].filter(Boolean);
  if (intersections.length !== 3) return null;
  const center = {
    x: intersections.reduce((sum, point) => sum + point.x, 0) / 3,
    y: intersections.reduce((sum, point) => sum + point.y, 0) / 3,
  };
  const radius = vertices.reduce(
    (sum, point) => sum + Math.hypot(point.x - center.x, point.y - center.y),
    0,
  ) / vertices.length;
  const residual = Math.max(
    ...intersections.map((point) => Math.hypot(point.x - center.x, point.y - center.y)),
  ) / Math.max(radius, EPSILON);
  return { center, radius, residual, intersections };
}

function lumaSpan(luma) {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < luma.data.length; index += 1) {
    const value = luma.data[index];
    if (!Number.isFinite(value)) continue;
    if (value < min || (value === 0 && min === 0 && 1 / value === -Infinity)) min = value;
    if (value > max || (value === 0 && max === 0 && 1 / value === Infinity)) max = value;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
}

function seamEvidence(luma, center, vertices, parity, cachedSpan) {
  const rayReports = [];
  const span = Math.max(cachedSpan === undefined ? lumaSpan(luma) : cachedSpan, EPSILON);
  for (let ray = 0; ray < 3; ray += 1) {
    const endpoint = vertices[(parity + 2 * ray) % 6];
    const dx = endpoint.x - center.x;
    const dy = endpoint.y - center.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 4)) return { contrast: 0, support: 0, rays: [] };
    const px = -dy / length;
    const py = dx / length;
    const offset = Math.max(1.25, length * 0.014);
    const contrasts = [];
    let supported = 0;

    for (let step = 0; step < 28; step += 1) {
      const t = 0.08 + (0.84 * step) / 27;
      const x = center.x + dx * t;
      const y = center.y + dy * t;
      const middle = bilinear(luma, x, y);
      const left = bilinear(luma, x + px * offset, y + py * offset);
      const right = bilinear(luma, x - px * offset, y - py * offset);
      if (middle === null || left === null || right === null) continue;
      const contrast = ((left + right) / 2) - middle;
      contrasts.push(contrast);
      if (contrast >= span * 0.006) supported += 1;
    }
    rayReports.push({
      contrast: median(contrasts) / span,
      support: contrasts.length === 0 ? 0 : supported / contrasts.length,
      samples: contrasts.length,
    });
  }

  const ordered = rayReports.slice().sort((left, right) =>
    right.contrast - left.contrast || right.support - left.support);
  return {
    // 셀 내용이 심과 같은 암부일 수 있으므로 3개 ray의 중앙값은 내용 의존적이다.
    // 패리티 판정에는 가장 또렷한 한 ray를 쓰고, 4조 레퍼런스가 거짓 양성을 닫는다.
    contrast: ordered[0] ? ordered[0].contrast : 0,
    support: ordered[0] ? ordered[0].support : 0,
    positiveRayCount: rayReports.filter(
      (report) => report.contrast >= UNVERIFIED_CUBE_DETECTION.minimumSeamContrast,
    ).length,
    rays: rayReports,
  };
}

function shapeCandidates(luma, cfg) {
  const foreground = foregroundMask(luma, cfg);
  const variants = [{ source: 'raw', mask: foreground.mask }];
  if (foreground.structuredMask && foreground.recoveredForegroundPixels > 0) {
    variants.push({ source: 'structured-density', mask: foreground.structuredMask });
  }
  /*
   * 반전 마스크 — 배경 모델이 «어느 쪽» 을 배경으로 잡았는지에 검출이 걸리지 않게 한다.
   *
   * 배경 모델은 **이미지 테두리** 픽셀로 만든다. 코드만 찍힌 사진이면 테두리가 코드의 밝은
   * 배경이라 어두운 셀·큐브가 전경이 된다. 그런데 화면을 찍으면 테두리가 **베젤(어두움)**
   * 이라 판정이 뒤집혀 «밝은 화면 전체» 가 전경이 되고, 어두운 큐브는 전경 덩어리 속
   * **구멍**이 되어 연결요소가 아예 안 생긴다 — 실촬영 6장 전부 그랬다. 후보를 전부 그려
   * 보니 베젤·화면 반사에만 얹혀 있었고 큐브 위엔 하나도 없었다(2026-08-12).
   *
   * 큐브는 «밝은 띠로 둘러싸인 어두운 육각» 이라, 어느 극성에서 보든 한쪽에서는 반드시
   * 독립 연결요소가 된다. 그래서 반대 극성도 본다. 거짓 후보가 늘지만 하류의 12셀 레퍼런스
   * 일치(minimumReferenceAgreement)가 닫는다 — 그게 그 단계의 존재 이유다.
   *
   * ⚠ **폴백이다.** 앞 변형이 후보를 하나라도 찾으면 돌지 않는다. 연결요소 계산이
   *   프레임 크기에 비례해 비싸서(실측 +\~50%), 정상 경로까지 느려지면 손해다.
   *   실측상 이득도 검출 단계에 그치고(0/6 → 1\~2/6) 복호까지는 아직 안 간다.
   */
  if (foreground.source === 'border-clusters') {
    variants.push({ source: 'inverted', fallbackOnly: true, buildMask: () => {
      const inverted = new Uint8Array(foreground.mask.length);
      for (let index = 0; index < inverted.length; index += 1) {
        if (luma.alpha && luma.alpha[index] === 0) continue;
        inverted[index] = foreground.mask[index] ? 0 : 1;
      }
      return inverted;
    } });
  }

  const candidatesBySource = new Map();
  const componentCounts = {};
  let componentOffset = 0;
  let seamSpan;

  /*
   * 왜 떨어졌는지를 남긴다.
   *
   * 아래 네 관문은 전부 조용히 `return` 했다. 그래서 실사진에서 후보가 0개로 나와도
   * 「육각이 아니었나 · 대각이 안 모였나 · 심이 약했나」를 **가릴 수가 없었다** —
   * 실촬영 6장을 놓고 원인을 세 번 잘못 짚었다(2026-08-12). 임계값을 손대기 전에
   * 무엇이 걸리는지부터 보이게 한다. 컴포넌트 수는 한 자리라 비용은 무시할 만하다.
   */
  const rejections = [];
  const reject = (componentIndex, source, stage, measured, threshold) => {
    rejections.push({ componentIndex, source, stage, measured, threshold });
  };
  for (const variant of variants) {
    // 폴백 변형은 앞선 변형이 전부 빈손일 때만 돈다 — 정상 경로의 비용을 0 으로 둔다.
    if (variant.fallbackOnly) {
      const found = [...candidatesBySource.values()].some((list) => list.length > 0);
      if (found) break;
      variant.mask = variant.buildMask();
    }
    const mask = closeMask(variant.mask, luma.width, luma.height);
    const components = connectedComponents(mask, luma.width, luma.height, cfg);
    componentCounts[variant.source] = components.length;
    const sourceCandidates = [];

    components.forEach((component, localComponentIndex) => {
      const componentIndex = componentOffset + localComponentIndex;
      const hull = convexHull(component.boundary);
      const vertices = simplifyHullToHex(hull);
      if (!vertices) {
        reject(componentIndex, variant.source, 'hull-not-hexagon', hull.length, 6);
        return;
      }
      const diagonal = diagonalCenter(vertices);
      if (!diagonal || diagonal.residual > cfg.maximumConcurrencyResidual) {
        // 반지름·면적을 같이 남긴다 — 떨어진 게 «중앙 큐브» 인지 «코드 전체 실루엣» 인지
        //   숫자 하나로 갈린다. 잔차만 보면 그걸 알 수 없다.
        reject(componentIndex, variant.source, 'diagonal-concurrency', {
          residual: diagonal ? diagonal.residual : null,
          radius: diagonal ? diagonal.radius : null,
          center: diagonal ? diagonal.center : null,
          vertices,
          componentArea: component.area,
        }, cfg.maximumConcurrencyResidual);
        return;
      }
      const area = Math.abs(polygonArea(vertices));
      const maskFill = component.area / Math.max(area, EPSILON);
      if (maskFill < cfg.minimumMaskFill) {
        reject(componentIndex, variant.source, 'mask-fill', maskFill, cfg.minimumMaskFill);
        return;
      }

      if (seamSpan === undefined) seamSpan = lumaSpan(luma);
      const even = seamEvidence(luma, diagonal.center, vertices, 0, seamSpan);
      const odd = seamEvidence(luma, diagonal.center, vertices, 1, seamSpan);
      const seamScore = (report) => report.contrast
        + cfg.minimumSeamContrast * report.positiveRayCount;
      const evenScore = seamScore(even);
      const oddScore = seamScore(odd);
      const parity = oddScore > evenScore ? 1 : 0;
      const seam = parity === 1 ? odd : even;
      const other = parity === 1 ? even : odd;
      const parityMargin = Math.abs(evenScore - oddScore);
      const hardChecks = {
        hexSilhouette: true,
        diagonalConcurrency: diagonal.residual <= cfg.maximumConcurrencyResidual,
        yJunction: seam.contrast >= cfg.minimumSeamContrast
          && seam.support >= cfg.minimumSeamSupport
          && parityMargin >= cfg.minimumSeamParityMargin,
      };
      hardChecks.all = hardChecks.hexSilhouette
        && hardChecks.diagonalConcurrency
        && hardChecks.yJunction;
      if (!hardChecks.all) {
        // Y 심은 세 조건의 AND 라, 어느 하나가 걸렸는지까지 남겨야 쓸모가 있다.
        reject(componentIndex, variant.source, 'y-junction', {
          // 기하도 같이 남긴다 — 대비가 낮을 때 «심이 흐린 것» 과 «엉뚱한 데를 잰 것» 을
          //   숫자만으로는 못 가른다. 중심·꼭짓점이 있으면 사진 위에 그려서 확인된다.
          center: diagonal.center,
          radius: diagonal.radius,
          vertices,
          seamVertices: [0, 1, 2].map((index) => vertices[(parity + 2 * index) % 6]),
          seamContrast: seam.contrast,
          seamSupport: seam.support,
          parityMargin,
          failed: [
            seam.contrast < cfg.minimumSeamContrast ? 'contrast' : null,
            seam.support < cfg.minimumSeamSupport ? 'support' : null,
            parityMargin < cfg.minimumSeamParityMargin ? 'parityMargin' : null,
            !hardChecks.diagonalConcurrency ? 'concurrency' : null,
          ].filter(Boolean),
        }, {
          seamContrast: cfg.minimumSeamContrast,
          seamSupport: cfg.minimumSeamSupport,
          parityMargin: cfg.minimumSeamParityMargin,
        });
        return;
      }

      const emitParityCandidate = (
        candidateParity,
        candidateSeam,
        candidateOther,
        alternateParity,
      ) => {
        sourceCandidates.push({
          componentIndex,
          componentSource: variant.source,
          center: diagonal.center,
          vertices,
          seamParity: candidateParity,
          seamParityAlternative: alternateParity,
          junctionEvidenceParity: parity,
          seamVertices: [0, 1, 2].map(
            (index) => vertices[(candidateParity + 2 * index) % 6],
          ),
          radius: diagonal.radius,
          maskFill,
          concurrencyResidual: diagonal.residual,
          seam: candidateSeam,
          otherParitySeam: candidateOther,
          parityMargin,
          hardChecks,
          score: clamp01(
            0.32 * (1 - diagonal.residual / cfg.maximumConcurrencyResidual)
            + 0.38 * clamp01(
              candidateSeam.contrast / Math.max(cfg.minimumSeamContrast * 4, EPSILON),
            )
            + 0.20 * candidateSeam.support
            + 0.10 * clamp01(maskFill),
          ),
        });
      };
      emitParityCandidate(parity, seam, other, false);
      // Y 존재 증거와 세 꼭짓점 패리티 확정을 분리한다. 양쪽 ray가 모두
      // 양성이면 12셀 비대칭 레퍼런스가 잘못된 패리티를 제거하게 한다.
      if (other.contrast >= cfg.minimumSeamContrast
        && other.support >= cfg.minimumSeamSupport) {
        emitParityCandidate(1 - parity, other, seam, true);
      }
    });
    sourceCandidates.sort((left, right) =>
      right.score - left.score
      || right.radius - left.radius
      || left.componentIndex - right.componentIndex);
    candidatesBySource.set(variant.source, sourceCandidates);
    componentOffset += components.length;
  }

  const candidates = [];
  for (const variant of variants) {
    candidates.push(...(candidatesBySource.get(variant.source) || [])
      .slice(0, cfg.maximumShapeCandidates));
  }
  return {
    candidates,
    diagnostics: {
      foregroundSource: foreground.source,
      backgroundModels: foreground.models,
      rawForegroundPixels: foreground.rawForegroundPixels,
      recoveredForegroundPixels: foreground.recoveredForegroundPixels,
      componentCount: componentCounts.raw || 0,
      rejections,
      rejectionCounts: rejections.reduce((counts, entry) => {
        counts[entry.stage] = (counts[entry.stage] || 0) + 1;
        return counts;
      }, {}),
      acceptedShapeCount: candidates.length,
      rawAcceptedShapeCount: (candidatesBySource.get('raw') || []).length,
      structuredComponentCount: componentCounts['structured-density'] || 0,
      structuredAcceptedShapeCount:
        (candidatesBySource.get('structured-density') || []).length,
    },
  };
}

function liftPoint(point, factor) {
  return {
    x: point.x * factor + (factor - 1) / 2,
    y: point.y * factor + (factor - 1) / 2,
  };
}

function vertexSetResidual(H, n, observedVertices) {
  const predicted = CORNER_UNIT_OFFSETS.map((corner) =>
    projectPoint(H, { x: corner.x * n, y: corner.y * n }));
  if (predicted.some((point) => point === null)) return Infinity;
  let sumSquares = 0;
  for (const point of predicted) {
    let nearest = Infinity;
    for (const observed of observedVertices) {
      nearest = Math.min(nearest, Math.hypot(point.x - observed.x, point.y - observed.y));
    }
    sumSquares += nearest * nearest;
  }
  return Math.sqrt(sumSquares / predicted.length);
}

function cubeGeometrySeeds(
  n,
  center,
  vertices,
  seamVertices,
  seamParity,
  orientation,
  adjacentPhase = false,
  locatorPhase = null,
) {
  const seeds = [];
  const observedSeams = [0, 1, 2].map(
    (index) => seamVertices[(index + orientation) % 3],
  );
  const seamCanonical = [
    { x: 0, y: 0 },
    ...CANONICAL_SEAM_CORNERS.map((index) => ({
      x: CORNER_UNIT_OFFSETS[index].x * n,
      y: CORNER_UNIT_OFFSETS[index].y * n,
    })),
  ];
  const centerSeams = estimateHomography4(seamCanonical, [center, ...observedSeams]);
  if (centerSeams) {
    seeds.push({
      id: 'center-seams',
      H: centerSeams,
      observedSeams,
      locatorPhaseUsed: false,
      locatorPhaseFallback: adjacentPhase,
    });
  }

  const shift = ((seamParity - 1 + 2 * orientation) % 6 + 6) % 6;
  // 외곽 locator는 회전 각도에 따라 convex-hull의 시작 꼭짓점이 한 칸
  // 달라질 수 있다. orientation 3개가 짝수 shift(0/2/4)를 담당하므로,
  // locator 후보에만 인접 phase(+1)를 더하면 여섯 cyclic mapping을 모두
  // 검증할 수 있다. 레퍼런스 12셀이 거짓 mapping을 제거한다.
  const phaseIsReliable = locatorPhase && locatorPhase.reliable === true
    && Number.isInteger(locatorPhase.phaseShift);
  const shifts = phaseIsReliable
    ? [((locatorPhase.phaseShift % 6) + 6) % 6]
    : adjacentPhase ? [shift, (shift + 1) % 6] : [shift];
  const subsets = [
    { id: 'outer-a', indices: [0, 1, 3, 4] },
    { id: 'outer-b', indices: [1, 2, 4, 5] },
    { id: 'outer-c', indices: [0, 2, 3, 5] },
  ];
  for (const phaseShift of shifts) {
    for (const subset of subsets) {
      const canonical = subset.indices.map((index) => ({
        x: CORNER_UNIT_OFFSETS[index].x * n,
        y: CORNER_UNIT_OFFSETS[index].y * n,
      }));
      const observed = subset.indices.map(
        (index) => vertices[(index + phaseShift) % 6],
      );
      const H = estimateHomography4(canonical, observed);
      if (H) {
        const phaseSuffix = phaseIsReliable
          ? '-c-phase'
          : phaseShift === shift ? '' : '-adjacent-phase';
        seeds.push({
          id: subset.id + phaseSuffix,
          H,
          observedSeams,
          locatorPhaseUsed: phaseIsReliable,
          locatorPhaseFallback: adjacentPhase && !phaseIsReliable,
        });
      }
    }
  }
  return seeds;
}

function sampleOptions(options, cfg) {
  const supplied = options && options.sample && typeof options.sample === 'object'
    ? options.sample
    : {};
  return {
    minSampleCount: cfg.minimumSampleCount,
    minProjectedMinorDiameter: cfg.minimumProjectedMinorDiameter,
    disc: {
      fraction: cfg.sampleDiscFraction,
      ...(supplied.disc || {}),
    },
    ...supplied,
  };
}

export function sampleCubeCell(luma, geometry, i, j, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
      stage: 'cube-cell-sampling',
      message: error.message,
    });
  }
  if (!geometry || !(geometry.H instanceof Float64Array)) {
    return fail(FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE, {
      stage: 'cube-cell-sampling',
      cause: 'missing-homography',
    });
  }

  const faces = {};
  for (const face of YFACES) {
    const disc = moduleSampleDisc(
      face,
      i,
      j,
      { size: 1, originX: 0, originY: 0 },
      options.disc || {},
    );
    const sampled = sampleProjectedDisc(luma, geometry.H, disc, options);
    if (!sampled.ok) {
      return fail(sampled.reason, {
        stage: 'cube-cell-sampling',
        face,
        i,
        j,
        cause: sampled.detail,
      });
    }
    faces[face] = {
      median: sampled.median,
      mad: sampled.mad,
      count: sampled.count,
      projectedMinorDiameter: sampled.projectedMinorDiameter,
    };
  }
  return ok({ ...faces, i, j });
}

function referenceSampleMap(luma, hypothesis, n, options, cfg) {
  const coordinates = [];
  for (const group of referenceGroups(n, 2)) {
    for (const cell of group.cells) coordinates.push(cell);
  }
  const map = new Map();
  for (const cell of coordinates) {
    const key = cell.i + ',' + cell.j;
    if (map.has(key)) continue;
    const sample = sampleCubeCell(luma, hypothesis, cell.i, cell.j, sampleOptions(options, cfg));
    if (!sample.ok) return sample;
    map.set(key, sample);
  }
  return ok({ samples: map });
}

function knownReferenceDigits(n, tones) {
  const map = new Map();
  for (const group of referenceGroups(n, tones)) {
    group.cells.forEach((cell, index) => {
      map.set(cell.i + ',' + cell.j, group.digits[index]);
    });
  }
  return map;
}

function normalizeThreeTone(value, anchors) {
  const a0 = anchors[0];
  const a1 = anchors[1];
  const a2 = anchors[2];
  if (value <= a1) return (value - a0) / Math.max(a1 - a0, EPSILON);
  return 1 + (value - a1) / Math.max(a2 - a1, EPSILON);
}

export function readCubeDigit(sample, calibrationResult) {
  if (!sample || sample.ok === false || !calibrationResult) return null;
  if (calibrationResult.tones === 2) {
    const bits = {};
    let minimumMargin = Infinity;
    for (const face of YFACES) {
      const value = sample[face].median;
      const threshold = calibrationResult.thresholds[face];
      bits[face] = value > threshold ? 1 : 0;
      minimumMargin = Math.min(
        minimumMargin,
        Math.abs(Math.log(Math.max(value, EPSILON)) - Math.log(Math.max(threshold, EPSILON))),
      );
    }
    try {
      const digit = patternToDigit(bits.T, bits.L, bits.R);
      if (digit === null) return null;
      return {
        digit,
        bits,
        margin: minimumMargin,
      };
    } catch {
      return null;
    }
  }

  const normalized = {};
  for (const face of YFACES) {
    normalized[face] = normalizeThreeTone(
      sample[face].median,
      calibrationResult.levelAnchors[face],
    );
  }
  const rows = YFACES.map((face, order) => ({ face, order, value: normalized[face] }))
    .sort((left, right) => left.value - right.value || left.order - right.order);
  const ranks = {};
  rows.forEach((row, rank) => {
    ranks[row.face] = rank;
  });
  const gaps = [
    rows[1].value - rows[0].value,
    rows[2].value - rows[1].value,
  ];
  return {
    digit: ranksToDigit(ranks),
    normalized,
    margin: Math.min(...gaps),
  };
}

function buildToneCalibration(samples, n, tones, cfg) {
  const expected = knownReferenceDigits(n, tones);
  if (tones === 2) {
    const thresholds = {};
    const anchors = {};
    let minimumRatio = Infinity;
    let minimumSpan = Infinity;
    for (const face of YFACES) {
      const lows = [];
      const highs = [];
      for (const [key, digit] of expected) {
        const sample = samples.get(key);
        const bright = TONE_PATTERNS[digit][TONE_FACE_INDEX[face]];
        (bright ? highs : lows).push(sample[face].median);
      }
      const low = median(lows);
      const high = median(highs);
      const span = high - low;
      const ratio = high / Math.max(low, EPSILON);
      const threshold = low > 0 && high > 0 ? Math.sqrt(low * high) : (low + high) / 2;
      thresholds[face] = threshold;
      anchors[face] = { low, high, lows, highs, span, ratio };
      minimumRatio = Math.min(minimumRatio, ratio);
      minimumSpan = Math.min(minimumSpan, span);
    }

    const provisional = { tones, thresholds, anchors };
    let agreement = 0;
    const observations = [];
    for (const [key, digit] of expected) {
      const read = readCubeDigit(samples.get(key), provisional);
      const matched = read !== null && read.digit === digit;
      if (matched) agreement += 1;
      observations.push({
        key,
        expected: digit,
        observed: read && read.digit,
        matched,
        margin: read && read.margin,
      });
    }
    const agreementRate = agreement / expected.size;
    const margins = observations
      .map((entry) => entry.margin)
      .filter(Number.isFinite);
    const medianMargin = margins.length > 0 ? median(margins) : 0;
    const hardChecks = {
      toneSeparation: minimumSpan >= cfg.minimumToneSpan
        && minimumRatio >= cfg.minimumTwoToneRatio,
      referenceAgreement: agreementRate >= cfg.minimumReferenceAgreement,
    };
    hardChecks.all = hardChecks.toneSeparation && hardChecks.referenceAgreement;
    return {
      ...provisional,
      agreement,
      total: expected.size,
      agreementRate,
      minimumRatio,
      minimumSpan,
      medianMargin,
      observations,
      hardChecks,
    };
  }

  const levelAnchors = {};
  let minimumSpan = Infinity;
  for (const face of YFACES) {
    const byRank = [[], [], []];
    for (const [key, digit] of expected) {
      const rank = digitToRanks(digit)[face];
      byRank[rank].push(samples.get(key)[face].median);
    }
    const anchors = byRank.map((values) => median(values));
    levelAnchors[face] = anchors;
    minimumSpan = Math.min(
      minimumSpan,
      anchors[1] - anchors[0],
      anchors[2] - anchors[1],
    );
  }

  const provisional = { tones, levelAnchors };
  let agreement = 0;
  const observations = [];
  for (const [key, digit] of expected) {
    const read = readCubeDigit(samples.get(key), provisional);
    const matched = read !== null && read.digit === digit;
    if (matched) agreement += 1;
    observations.push({
      key,
      expected: digit,
      observed: read && read.digit,
      matched,
      margin: read && read.margin,
    });
  }
  const agreementRate = agreement / expected.size;
  const margins = observations
    .map((entry) => entry.margin)
    .filter(Number.isFinite);
  const medianMargin = margins.length > 0 ? median(margins) : 0;
  const hardChecks = {
    toneSeparation: minimumSpan >= cfg.minimumToneSpan,
    referenceAgreement: agreementRate >= cfg.minimumReferenceAgreement,
  };
  hardChecks.all = hardChecks.toneSeparation && hardChecks.referenceAgreement;
  return {
    ...provisional,
    agreement,
    total: expected.size,
    agreementRate,
    minimumSpan,
    medianMargin,
    observations,
    hardChecks,
  };
}

export function calibrateCubeReferences(luma, hypothesis, options = {}) {
  const cfg = calibration(options);
  const n = hypothesis && hypothesis.n;
  if (!SUPPORTED_N.includes(n)) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'cube-reference',
      cause: 'unsupported-n',
      n,
    });
  }
  const sampled = referenceSampleMap(luma, hypothesis, n, options, cfg);
  if (!sampled.ok) return sampled;
  const requested = options.tones === 2 || options.tones === 3
    ? [options.tones]
    : SUPPORTED_TONES;
  const calibrations = requested.map((tones) =>
    buildToneCalibration(sampled.samples, n, tones, cfg));
  return ok({
    samples: sampled.samples,
    calibrations,
    accepted: calibrations.filter((entry) => entry.hardChecks.all),
    anchors: referenceAnchors(n),
  });
}

function explicitCubeHypotheses(yJunction) {
  if (!yJunction || typeof yJunction !== 'object') return null;
  const raw = yJunction.geometryHypotheses
    || yJunction.cubeHypotheses
    || yJunction.hypotheses;
  if (!Array.isArray(raw)) return null;
  return raw.filter((entry) => entry
    && entry.family === 'cube'
    && entry.H instanceof Float64Array
    && SUPPORTED_N.includes(entry.n));
}

function translateHomography(H, dx, dy) {
  return new Float64Array([
    H[0] + dx * H[6], H[1] + dx * H[7], H[2] + dx * H[8],
    H[3] + dy * H[6], H[4] + dy * H[7], H[5] + dy * H[8],
    H[6], H[7], H[8],
  ]);
}

function scaleHomographyAroundOrigin(H, scale) {
  const center = projectPoint(H, { x: 0, y: 0 });
  if (!center) return null;
  const offsetX = (1 - scale) * center.x;
  const offsetY = (1 - scale) * center.y;
  return new Float64Array([
    scale * H[0] + offsetX * H[6],
    scale * H[1] + offsetX * H[7],
    scale * H[2] + offsetX * H[8],
    scale * H[3] + offsetY * H[6],
    scale * H[4] + offsetY * H[7],
    scale * H[5] + offsetY * H[8],
    H[6],
    H[7],
    H[8],
  ]);
}

function projectedModulePitch(H) {
  const center = projectPoint(H, { x: 0, y: 0 });
  const iStep = projectPoint(H, { x: 1, y: 0 });
  const jStep = projectPoint(H, { x: 0, y: 1 });
  if (!center || !iStep || !jStep) return NaN;
  return median([
    Math.hypot(iStep.x - center.x, iStep.y - center.y),
    Math.hypot(jStep.x - center.x, jStep.y - center.y),
  ]);
}

function calibrationQuality(entry) {
  const margin = Number.isFinite(entry.medianMargin) ? entry.medianMargin : 0;
  const span = Number.isFinite(entry.minimumSpan) ? entry.minimumSpan : 0;
  return 100 * entry.agreementRate
    + 2 * clamp01(span / 0.08)
    + clamp01(margin);
}

function refineHomographyWithReferences(
  luma,
  base,
  tones,
  options,
  cfg,
  translationOnly = false,
) {
  const pitch = projectedModulePitch(base.H);
  if (!(pitch > 0)) return null;
  const radius = cfg.referenceRefineRadiusModules * pitch;
  const step = Math.max(0.25, cfg.referenceRefineStepModules * pitch);
  const offsets = [];
  for (let dy = -radius; dy <= radius + EPSILON; dy += step) {
    for (let dx = -radius; dx <= radius + EPSILON; dx += step) {
      offsets.push({ dx, dy });
    }
  }
  offsets.push({ dx: 0, dy: 0 });
  offsets.sort((left, right) =>
    Math.hypot(left.dx, left.dy) - Math.hypot(right.dx, right.dy)
    || left.dy - right.dy
    || left.dx - right.dx);

  const scales = [];
  if (!translationOnly) {
    for (let delta = -cfg.referenceRefineScaleRadius;
      delta <= cfg.referenceRefineScaleRadius + EPSILON;
      delta += cfg.referenceRefineScaleStep) {
      scales.push(1 + delta);
    }
  }
  scales.push(1);
  scales.sort((left, right) => Math.abs(left - 1) - Math.abs(right - 1) || left - right);

  let best = null;
  for (const scale of scales) {
    const scaled = scaleHomographyAroundOrigin(base.H, scale);
    if (!scaled) continue;
    for (const offset of offsets) {
      const H = translateHomography(scaled, offset.dx, offset.dy);
      const hypothesis = { ...base, H };
      const sampled = referenceSampleMap(luma, hypothesis, base.n, options, cfg);
      if (!sampled.ok) continue;
      const entry = buildToneCalibration(sampled.samples, base.n, tones, cfg);
      if (!entry.hardChecks.all) continue;
      const quality = calibrationQuality(entry);
      const adjustment = Math.abs(scale - 1)
        + Math.hypot(offset.dx, offset.dy) / Math.max(pitch, EPSILON);
      const candidate = {
        H,
        referenceCalibration: entry,
        referenceSamples: sampled.samples,
        dx: offset.dx,
        dy: offset.dy,
        scale,
        adjustment,
        quality,
      };
      if (!best
        || candidate.quality > best.quality + EPSILON
        || (Math.abs(candidate.quality - best.quality) <= EPSILON
          && (candidate.adjustment < best.adjustment - EPSILON
            || (Math.abs(candidate.adjustment - best.adjustment) <= EPSILON
              && (candidate.scale < best.scale
                || (candidate.scale === best.scale
                  && (candidate.dy < best.dy
                    || (candidate.dy === best.dy && candidate.dx < best.dx)))))))) {
        best = candidate;
      }
    }
  }
  return best && {
    ...best,
    pitch,
    radius,
    step,
  };
}


function flatBlockCandidates(luma, cfg) {
  const { width, height } = luma;
  const edges = new Uint8Array(width * height);
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const index = y * width + x;
      const value = luma.data[index];
      edges[index] = Math.abs(value - luma.data[index - 1])
          > cfg.backgroundToleranceFloor
        || Math.abs(value - luma.data[index - width])
          > cfg.backgroundToleranceFloor
        ? 1
        : 0;
    }
  }

  const stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += edges[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }

  const flat = new Uint8Array(width * height);
  const radius = cfg.foregroundDensityRadius;
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const edgeCount = integral[bottom * stride + right]
        - integral[top * stride + right]
        - integral[bottom * stride + left]
        + integral[top * stride + left];
      const sampleCount = (right - left) * (bottom - top);
      if (edgeCount / sampleCount <= cfg.minimumForegroundDensity) {
        flat[y * width + x] = 1;
      }
    }
  }

  const blockSize = 2 * radius + 1;
  const blockWidth = Math.ceil(width / blockSize);
  const blockHeight = Math.ceil(height / blockSize);
  const occupied = new Uint8Array(blockWidth * blockHeight);
  for (let blockY = 0; blockY < blockHeight; blockY += 1) {
    for (let blockX = 0; blockX < blockWidth; blockX += 1) {
      let flatCount = 0;
      let sampleCount = 0;
      for (let y = blockY * blockSize;
        y < Math.min(height, (blockY + 1) * blockSize);
        y += 1) {
        for (let x = blockX * blockSize;
          x < Math.min(width, (blockX + 1) * blockSize);
          x += 1) {
          flatCount += flat[y * width + x];
          sampleCount += 1;
        }
      }
      if (flatCount / sampleCount >= cfg.minimumMaskFill) {
        occupied[blockY * blockWidth + blockX] = 1;
      }
    }
  }

  // 한 블록의 위상적 닫힘만 수행한다. 수용 임계값은 위 cfg 값을 그대로 쓴다.
  const closed = new Uint8Array(occupied.length);
  for (let blockY = 0; blockY < blockHeight; blockY += 1) {
    for (let blockX = 0; blockX < blockWidth; blockX += 1) {
      for (let dy = -1; dy <= 1 && !closed[blockY * blockWidth + blockX]; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = blockX + dx;
          const y = blockY + dy;
          if (x >= 0 && x < blockWidth && y >= 0 && y < blockHeight
            && occupied[y * blockWidth + x]) {
            closed[blockY * blockWidth + blockX] = 1;
            break;
          }
        }
      }
    }
  }

  const seen = new Uint8Array(closed.length);
  const candidates = [];
  let componentCount = 0;
  let frameComponentCount = 0;
  for (let start = 0; start < closed.length; start += 1) {
    if (!closed[start] || seen[start]) continue;
    componentCount += 1;
    const queue = [start];
    const cells = [];
    let touchesFrame = false;
    seen[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      const x = index % blockWidth;
      const y = Math.floor(index / blockWidth);
      cells.push({ x, y });
      if (x === 0 || y === 0 || x === blockWidth - 1 || y === blockHeight - 1) {
        touchesFrame = true;
      }
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= blockWidth
            || nextY < 0 || nextY >= blockHeight) continue;
          const next = nextY * blockWidth + nextX;
          if (closed[next] && !seen[next]) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    if (touchesFrame) {
      frameComponentCount += 1;
      continue;
    }

    const estimatedPixels = cells.length * blockSize * blockSize;
    const areaFraction = estimatedPixels / (width * height);
    if (estimatedPixels < cfg.minimumComponentPixels
      || areaFraction < cfg.minimumComponentAreaFraction
      || areaFraction > cfg.maximumComponentAreaFraction) continue;
    const minBlockX = Math.min(...cells.map((cell) => cell.x));
    const minBlockY = Math.min(...cells.map((cell) => cell.y));
    const maxBlockX = Math.max(...cells.map((cell) => cell.x));
    const maxBlockY = Math.max(...cells.map((cell) => cell.y));
    const bounds = {
      minX: minBlockX * blockSize,
      minY: minBlockY * blockSize,
      maxX: Math.min(width, (maxBlockX + 1) * blockSize),
      maxY: Math.min(height, (maxBlockY + 1) * blockSize),
    };
    const boundingBlocks = (maxBlockX - minBlockX + 1) * (maxBlockY - minBlockY + 1);
    candidates.push({
      blocks: cells.length,
      blockFill: cells.length / boundingBlocks,
      areaFraction,
      bounds,
    });
  }

  candidates.sort((left, right) =>
    right.blocks - left.blocks
    || right.blockFill - left.blockFill
    || left.bounds.minY - right.bounds.minY
    || left.bounds.minX - right.bounds.minX);
  return {
    candidates: candidates.slice(0, cfg.maximumShapeCandidates),
    diagnostics: {
      blockSize,
      componentCount,
      frameComponentCount,
      acceptedCandidateCount: candidates.length,
    },
  };
}

function blockCandidateHomography(candidate, n, factor, orientation = 0) {
  const bounds = candidate.bounds;
  const center = {
    x: ((bounds.minX + bounds.maxX) / 2) * factor,
    y: ((bounds.minY + bounds.maxY) / 2) * factor,
  };
  const width = (bounds.maxX - bounds.minX) * factor;
  const height = (bounds.maxY - bounds.minY) * factor;
  const canonical = [
    { x: 0, y: 0 },
    ...CANONICAL_SEAM_CORNERS.map((index) => ({
      x: CORNER_UNIT_OFFSETS[index].x * n,
      y: CORNER_UNIT_OFFSETS[index].y * n,
    })),
  ];
  const observedSeams = [
    { x: bounds.maxX * factor, y: center.y - height / 4 },
    { x: center.x, y: bounds.maxY * factor },
    { x: bounds.minX * factor, y: center.y - height / 4 },
  ];
  const observed = [
    center,
    ...CANONICAL_SEAM_CORNERS.map((_, index) =>
      observedSeams[(index + orientation) % CANONICAL_SEAM_CORNERS.length]),
  ];
  return estimateHomography4(canonical, observed);
}

function scaleHomographyAxesAroundOrigin(H, scaleX, scaleY) {
  const center = projectPoint(H, { x: 0, y: 0 });
  if (!center) return null;
  const offsetX = (1 - scaleX) * center.x;
  const offsetY = (1 - scaleY) * center.y;
  return new Float64Array([
    scaleX * H[0] + offsetX * H[6],
    scaleX * H[1] + offsetX * H[7],
    scaleX * H[2] + offsetX * H[8],
    scaleY * H[3] + offsetY * H[6],
    scaleY * H[4] + offsetY * H[7],
    scaleY * H[5] + offsetY * H[8],
    H[6],
    H[7],
    H[8],
  ]);
}

const QUICK_REFERENCE_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });
const QUICK_REFERENCE_DISC_OPTIONS = Object.freeze({});
const QUICK_PATTERN_TO_DIGIT = new Int8Array([-1, 2, 1, 3, 0, 4, 5, -1]);
const quickReferenceTemplates = new Map();
let quickReferenceSamplesScratch = new Float64Array(0);
let quickReferenceLowsScratch = new Float64Array(0);
let quickReferenceMidsScratch = new Float64Array(0);
let quickReferenceHighsScratch = new Float64Array(0);
let quickReferenceThresholdsScratch = new Float64Array(3);
let quickReferenceLevelAnchorsScratch = new Float64Array(YFACES.length * 3);
const QUICK_RANK_DIGITS = Object.freeze({
  TLR: ranksToDigit({ T: 0, L: 1, R: 2 }),
  TRL: ranksToDigit({ T: 0, L: 2, R: 1 }),
  LTR: ranksToDigit({ T: 1, L: 0, R: 2 }),
  LRT: ranksToDigit({ T: 2, L: 0, R: 1 }),
  RTL: ranksToDigit({ T: 1, L: 2, R: 0 }),
  RLT: ranksToDigit({ T: 2, L: 1, R: 0 }),
});
const quickTranslatedHomographyScratch = new Float64Array(9);
const quickScaledHomographyScratch = new Float64Array(9);
const quickReferenceScoreScratch = {
  agreement: -1,
  minimumSpan: -Infinity,
  minimumRatio: -Infinity,
};
const quickReferenceCandidateScratch = {
  scaleX: 0,
  scaleY: 0,
  dx: 0,
  dy: 0,
  quick: quickReferenceScoreScratch,
};

function ensureQuickReferenceScratch(length) {
  if (quickReferenceSamplesScratch.length < length) {
    quickReferenceSamplesScratch = new Float64Array(length);
  }
  if (quickReferenceLowsScratch.length < length) {
    quickReferenceLowsScratch = new Float64Array(length);
    quickReferenceMidsScratch = new Float64Array(length);
    quickReferenceHighsScratch = new Float64Array(length);
  }
}

/*
 * block recovery의 기준 12셀은 (n, tones)마다 불변이다. 후보마다 referenceGroups,
 * moduleSampleDisc, digit 의미론을 다시 만들지 않고 canonical 좌표와 기대 레벨을
 * 한 번만 준비한다. 공개 ygrid/tonemap/lehmer API의 반환물은 그대로 쓴다.
 */
function quickReferenceTemplate(n, tones) {
  const cacheKey = n + ':' + tones;
  const cached = quickReferenceTemplates.get(cacheKey);
  if (cached) return cached;

  const points = new Float64Array(12 * YFACES.length * 2);
  const digits = new Uint8Array(12);
  const expectedLevels = new Uint8Array(12 * YFACES.length);
  let entryIndex = 0;
  for (const group of referenceGroups(n, tones)) {
    for (let groupIndex = 0; groupIndex < group.cells.length; groupIndex += 1) {
      const cell = group.cells[groupIndex];
      const digit = group.digits[groupIndex];
      const levels = tones === 2 ? TONE_PATTERNS[digit] : digitToRanks(digit);
      digits[entryIndex] = digit;
      for (let faceIndex = 0; faceIndex < YFACES.length; faceIndex += 1) {
        const disc = moduleSampleDisc(
          YFACES[faceIndex],
          cell.i,
          cell.j,
          QUICK_REFERENCE_LAYOUT,
          QUICK_REFERENCE_DISC_OPTIONS,
        );
        const sampleIndex = entryIndex * YFACES.length + faceIndex;
        points[2 * sampleIndex] = disc.x;
        points[2 * sampleIndex + 1] = disc.y;
        expectedLevels[sampleIndex] = tones === 2
          ? levels[faceIndex]
          : levels[YFACES[faceIndex]];
      }
      entryIndex += 1;
    }
  }
  const template = { count: entryIndex, points, digits, expectedLevels };
  quickReferenceTemplates.set(cacheKey, template);
  return template;
}

function quickThreeToneDigit(t, l, r) {
  if (t <= l) {
    if (l <= r) return QUICK_RANK_DIGITS.TLR;
    if (t <= r) return QUICK_RANK_DIGITS.TRL;
    return QUICK_RANK_DIGITS.RTL;
  }
  if (t <= r) return QUICK_RANK_DIGITS.LTR;
  if (l <= r) return QUICK_RANK_DIGITS.LRT;
  return QUICK_RANK_DIGITS.RLT;
}

function quickNormalizeThreeTone(value, a0, a1, a2) {
  if (value <= a1) return (value - a0) / Math.max(a1 - a0, EPSILON);
  return 1 + (value - a1) / Math.max(a2 - a1, EPSILON);
}

function quickReferenceScore(luma, H, n, tones, output = quickReferenceScoreScratch) {
  const template = quickReferenceTemplate(n, tones);
  const faceCount = YFACES.length;
  const sampleCount = template.count * faceCount;
  ensureQuickReferenceScratch(sampleCount);

  const h0 = H[0];
  const h1 = H[1];
  const h2 = H[2];
  const h3 = H[3];
  const h4 = H[4];
  const h5 = H[5];
  const h6 = H[6];
  const h7 = H[7];
  const h8 = H[8];
  const width = luma.width;
  const height = luma.height;
  const data = luma.data;
  const maximumX = width - 1;
  const maximumY = height - 1;
  const points = template.points;
  const samples = quickReferenceSamplesScratch;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const x = points[2 * sampleIndex];
    const y = points[2 * sampleIndex + 1];
    const h6x = h6 * x;
    const h7y = h7 * y;
    const denominator = h6x + h7y + h8;
    const denominatorScale = Math.abs(h6x) + Math.abs(h7y) + Math.abs(h8);
    if (
      !Number.isFinite(denominator)
      || Math.abs(denominator) <= PROJECTIVE_DENOMINATOR_MIN_RATIO * denominatorScale
    ) {
      output.agreement = -1;
      output.minimumSpan = -Infinity;
      output.minimumRatio = -Infinity;
      return output;
    }

    const imageX = (h0 * x + h1 * y + h2) / denominator;
    const imageY = (h3 * x + h4 * y + h5) / denominator;
    if (!Number.isFinite(imageX) || !Number.isFinite(imageY)
      || imageX < 0 || imageY < 0 || imageX > maximumX || imageY > maximumY) {
      output.agreement = -1;
      output.minimumSpan = -Infinity;
      output.minimumRatio = -Infinity;
      return output;
    }

    const x0 = Math.floor(imageX);
    const y0 = Math.floor(imageY);
    const x1 = x0 + 1 > maximumX ? maximumX : x0 + 1;
    const y1 = y0 + 1 > maximumY ? maximumY : y0 + 1;
    const tx = imageX - x0;
    const ty = imageY - y0;
    const row0 = y0 * width;
    const row1 = y1 * width;
    const a = data[row0 + x0];
    const b = data[row0 + x1];
    const c = data[row1 + x0];
    const d = data[row1 + x1];
    samples[sampleIndex] = (a * (1 - tx) + b * tx) * (1 - ty)
      + (c * (1 - tx) + d * tx) * ty;
    if (!Number.isFinite(samples[sampleIndex])) {
      output.agreement = -1;
      output.minimumSpan = -Infinity;
      output.minimumRatio = -Infinity;
      return output;
    }
  }

  let minimumSpan = Infinity;
  let minimumRatio = Infinity;
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    let lowCount = 0;
    let midCount = 0;
    let highCount = 0;
    for (let entryIndex = 0; entryIndex < template.count; entryIndex += 1) {
      const sampleIndex = entryIndex * faceCount + faceIndex;
      const expected = template.expectedLevels[sampleIndex];
      if (expected === 0) {
        quickReferenceLowsScratch[lowCount] = samples[sampleIndex];
        lowCount += 1;
      } else if (tones === 3 && expected === 1) {
        quickReferenceMidsScratch[midCount] = samples[sampleIndex];
        midCount += 1;
      } else {
        quickReferenceHighsScratch[highCount] = samples[sampleIndex];
        highCount += 1;
      }
    }
    const low = medianFromArrayLike(quickReferenceLowsScratch, lowCount);
    const high = medianFromArrayLike(quickReferenceHighsScratch, highCount);
    if (tones === 2) {
      quickReferenceThresholdsScratch[faceIndex] = low > 0 && high > 0
        ? Math.sqrt(low * high)
        : (low + high) / 2;
      minimumSpan = Math.min(minimumSpan, high - low);
      minimumRatio = Math.min(minimumRatio, high / Math.max(low, EPSILON));
    } else {
      const mid = medianFromArrayLike(quickReferenceMidsScratch, midCount);
      const anchorIndex = faceIndex * 3;
      quickReferenceLevelAnchorsScratch[anchorIndex] = low;
      quickReferenceLevelAnchorsScratch[anchorIndex + 1] = mid;
      quickReferenceLevelAnchorsScratch[anchorIndex + 2] = high;
      minimumSpan = Math.min(minimumSpan, mid - low, high - mid);
      minimumRatio = Math.min(
        minimumRatio,
        mid / Math.max(low, EPSILON),
        high / Math.max(mid, EPSILON),
      );
    }
  }

  let agreement = 0;
  for (let entryIndex = 0; entryIndex < template.count; entryIndex += 1) {
    const sampleIndex = entryIndex * faceCount;
    let observed;
    if (tones === 2) {
      const bitsT = samples[sampleIndex] > quickReferenceThresholdsScratch[0] ? 1 : 0;
      const bitsL = samples[sampleIndex + 1] > quickReferenceThresholdsScratch[1] ? 1 : 0;
      const bitsR = samples[sampleIndex + 2] > quickReferenceThresholdsScratch[2] ? 1 : 0;
      observed = QUICK_PATTERN_TO_DIGIT[(bitsT << 2) | (bitsL << 1) | bitsR];
    } else {
      const t = quickNormalizeThreeTone(
        samples[sampleIndex],
        quickReferenceLevelAnchorsScratch[0],
        quickReferenceLevelAnchorsScratch[1],
        quickReferenceLevelAnchorsScratch[2],
      );
      const l = quickNormalizeThreeTone(
        samples[sampleIndex + 1],
        quickReferenceLevelAnchorsScratch[3],
        quickReferenceLevelAnchorsScratch[4],
        quickReferenceLevelAnchorsScratch[5],
      );
      const r = quickNormalizeThreeTone(
        samples[sampleIndex + 2],
        quickReferenceLevelAnchorsScratch[6],
        quickReferenceLevelAnchorsScratch[7],
        quickReferenceLevelAnchorsScratch[8],
      );
      observed = quickThreeToneDigit(t, l, r);
    }
    if (observed === template.digits[entryIndex]) agreement += 1;
  }
  output.agreement = agreement;
  output.minimumSpan = minimumSpan;
  output.minimumRatio = minimumRatio;
  return output;
}

function quickTranslatedReferenceScore(luma, scaled, dx, dy, n, tones) {
  quickTranslatedHomographyScratch[0] = scaled[0] + dx * scaled[6];
  quickTranslatedHomographyScratch[1] = scaled[1] + dx * scaled[7];
  quickTranslatedHomographyScratch[2] = scaled[2] + dx * scaled[8];
  quickTranslatedHomographyScratch[3] = scaled[3] + dy * scaled[6];
  quickTranslatedHomographyScratch[4] = scaled[4] + dy * scaled[7];
  quickTranslatedHomographyScratch[5] = scaled[5] + dy * scaled[8];
  quickTranslatedHomographyScratch[6] = scaled[6];
  quickTranslatedHomographyScratch[7] = scaled[7];
  quickTranslatedHomographyScratch[8] = scaled[8];
  return quickReferenceScore(luma, quickTranslatedHomographyScratch, n, tones);
}

function materializeQuickReferenceCandidate(initialH, candidate) {
  const scaled = scaleHomographyAxesAroundOrigin(initialH, candidate.scaleX, candidate.scaleY);
  if (!scaled) return null;
  return {
    H: translateHomography(scaled, candidate.dx, candidate.dy),
    scaleX: candidate.scaleX,
    scaleY: candidate.scaleY,
    dx: candidate.dx,
    dy: candidate.dy,
    quick: candidate.quick,
  };
}

function rankQuickReference(left, right) {
  return right.quick.agreement - left.quick.agreement
    || right.quick.minimumSpan - left.quick.minimumSpan
    || right.quick.minimumRatio - left.quick.minimumRatio
    || left.scaleX - right.scaleX
    || left.scaleY - right.scaleY
    || left.dy - right.dy
    || left.dx - right.dx;
}

/*
 * Only the leading coarse/fine candidates can reach calibration. Keep that exact
 * stable prefix while scoring instead of retaining and sorting every candidate.
 */
function retainQuickReferenceCandidate(top, candidate, limit) {
  const currentLength = top.length;
  if (currentLength === limit
    && rankQuickReference(candidate, top[currentLength - 1]) >= 0) return;

  let insertAt = currentLength;
  for (let index = 0; index < currentLength; index += 1) {
    if (rankQuickReference(candidate, top[index]) < 0) {
      insertAt = index;
      break;
    }
  }
  top.splice(insertAt, 0, {
    scaleX: candidate.scaleX,
    scaleY: candidate.scaleY,
    dx: candidate.dx,
    dy: candidate.dy,
    quick: {
      agreement: candidate.quick.agreement,
      minimumSpan: candidate.quick.minimumSpan,
      minimumRatio: candidate.quick.minimumRatio,
    },
  });
  if (top.length > limit) top.pop();
}

/*
 * scaleHomographyAxesAroundOrigin() projects the same origin for every search
 * position. Reuse that exact origin and a typed-array scratch during quick-only
 * scoring; materialization below continues through the canonical helper.
 */
function fillQuickScaledHomography(H, center, scaleX, scaleY, output) {
  const offsetX = (1 - scaleX) * center.x;
  const offsetY = (1 - scaleY) * center.y;
  output[0] = scaleX * H[0] + offsetX * H[6];
  output[1] = scaleX * H[1] + offsetX * H[7];
  output[2] = scaleX * H[2] + offsetX * H[8];
  output[3] = scaleY * H[3] + offsetY * H[6];
  output[4] = scaleY * H[4] + offsetY * H[7];
  output[5] = scaleY * H[5] + offsetY * H[8];
  output[6] = H[6];
  output[7] = H[7];
  output[8] = H[8];
  return output;
}

function blockReferenceSearch(luma, initialH, n, tones, options, cfg) {
  const pitch = projectedModulePitch(initialH);
  if (!(pitch > 0)) return { accepted: null, report: { cause: 'invalid-pitch' } };
  const scaleCenter = projectPoint(initialH, { x: 0, y: 0 });
  if (!scaleCenter) return { accepted: null, report: { cause: 'invalid-pitch' } };

  const scales = [1.05, 1, 0.95, 0.9, 0.85, 0.8, 0.75];
  const coarse = [];
  const quickCandidate = quickReferenceCandidateScratch;
  for (const scaleX of scales) {
    for (const scaleY of scales) {
      const scaled = fillQuickScaledHomography(
        initialH,
        scaleCenter,
        scaleX,
        scaleY,
        quickScaledHomographyScratch,
      );
      for (let dyIndex = -3; dyIndex <= 3; dyIndex += 1) {
        for (let dxIndex = -3; dxIndex <= 3; dxIndex += 1) {
          const dx = dxIndex * pitch / 2;
          const dy = dyIndex * pitch / 2;
          quickCandidate.scaleX = scaleX;
          quickCandidate.scaleY = scaleY;
          quickCandidate.dx = dx;
          quickCandidate.dy = dy;
          quickCandidate.quick = quickTranslatedReferenceScore(luma, scaled, dx, dy, n, tones);
          retainQuickReferenceCandidate(coarse, quickCandidate, 20);
        }
      }
    }
  }

  const fine = [];
  const coarseLimit = Math.min(8, coarse.length);
  for (let baseIndex = 0; baseIndex < coarseLimit; baseIndex += 1) {
    const base = coarse[baseIndex];
    for (const deltaX of [-0.025, 0, 0.025]) {
      for (const deltaY of [-0.025, 0, 0.025]) {
        const scaleX = base.scaleX + deltaX;
        const scaleY = base.scaleY + deltaY;
        const scaled = fillQuickScaledHomography(
          initialH,
          scaleCenter,
          scaleX,
          scaleY,
          quickScaledHomographyScratch,
        );
        for (const shiftX of [-0.25, 0, 0.25]) {
          for (const shiftY of [-0.25, 0, 0.25]) {
            const dx = base.dx + shiftX * pitch;
            const dy = base.dy + shiftY * pitch;
            quickCandidate.scaleX = scaleX;
            quickCandidate.scaleY = scaleY;
            quickCandidate.dx = dx;
            quickCandidate.dy = dy;
            quickCandidate.quick = quickTranslatedReferenceScore(luma, scaled, dx, dy, n, tones);
            retainQuickReferenceCandidate(fine, quickCandidate, 40);
          }
        }
      }
    }
  }

  const unique = [];
  const seen = new Set();
  const appendUnique = (candidate) => {
    const materialized = materializeQuickReferenceCandidate(initialH, candidate);
    if (!materialized) return;
    const key = Array.from(materialized.H, (value) => value.toFixed(8)).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(materialized);
  };
  for (let index = 0; index < Math.min(40, fine.length); index += 1) appendUnique(fine[index]);
  for (let index = 0; index < Math.min(20, coarse.length); index += 1) appendUnique(coarse[index]);

  const fullySampled = [];
  let seamSpan;
  for (const candidate of unique) {
    const references = calibrateCubeReferences(
      luma,
      { n, H: candidate.H },
      { ...options, tones },
    );
    if (!references.ok) continue;
    const referenceCalibration = references.accepted.find((entry) => entry.tones === tones);
    if (!referenceCalibration) continue;

    const center = projectPoint(candidate.H, { x: 0, y: 0 });
    const vertices = CORNER_UNIT_OFFSETS.map((corner) =>
      projectPoint(candidate.H, { x: corner.x * n, y: corner.y * n }));
    if (!center || vertices.some((point) => point === null)) continue;
    if (seamSpan === undefined) seamSpan = lumaSpan(luma);
    const even = seamEvidence(luma, center, vertices, 0, seamSpan);
    const odd = seamEvidence(luma, center, vertices, 1, seamSpan);
    const seamScore = (report) => report.contrast
      + cfg.minimumSeamContrast * report.positiveRayCount;
    const parityMargin = Math.abs(seamScore(odd) - seamScore(even));
    const yJunction = seamScore(odd) > seamScore(even)
      && odd.contrast >= cfg.minimumSeamContrast
      && odd.support >= cfg.minimumSeamSupport
      && parityMargin >= cfg.minimumSeamParityMargin;
    if (!yJunction) continue;
    fullySampled.push({
      ...candidate,
      references,
      referenceCalibration,
      center,
      vertices,
      seam: odd,
      otherParitySeam: even,
      parityMargin,
    });
  }

  fullySampled.sort((left, right) =>
    right.referenceCalibration.agreement - left.referenceCalibration.agreement
    || right.referenceCalibration.minimumSpan - left.referenceCalibration.minimumSpan
    || right.referenceCalibration.minimumRatio - left.referenceCalibration.minimumRatio
    || right.parityMargin - left.parityMargin
    || rankQuickReference(left, right));
  const accepted = fullySampled[0] || null;
  return {
    accepted,
    report: {
      pitch,
      coarseBest: coarse[0] && {
        scaleX: coarse[0].scaleX,
        scaleY: coarse[0].scaleY,
        dxModules: coarse[0].dx / pitch,
        dyModules: coarse[0].dy / pitch,
        ...coarse[0].quick,
      },
      fineBest: fine[0] && {
        scaleX: fine[0].scaleX,
        scaleY: fine[0].scaleY,
        dxModules: fine[0].dx / pitch,
        dyModules: fine[0].dy / pitch,
        ...fine[0].quick,
      },
      fullyAcceptedCount: fullySampled.length,
      accepted: accepted && {
        agreement: accepted.referenceCalibration.agreement,
        total: accepted.referenceCalibration.total,
        minimumSpan: accepted.referenceCalibration.minimumSpan,
        minimumRatio: accepted.referenceCalibration.minimumRatio,
        scaleX: accepted.scaleX,
        scaleY: accepted.scaleY,
        dxModules: accepted.dx / pitch,
        dyModules: accepted.dy / pitch,
        seamContrast: accepted.seam.contrast,
        seamSupport: accepted.seam.support,
        parityMargin: accepted.parityMargin,
        observations: accepted.referenceCalibration.observations,
      },
    },
  };
}
function cellSurfaceSeedReport(n, orientation, seedId, cellSurface) {
  if (!cellSurface.ok) {
    return {
      n,
      orientation,
      geometrySeed: seedId,
      attempted: true,
      accepted: false,
      score: null,
      reason: cellSurface.reason || 'score-failed',
      profile: CELL_SURFACE_PROFILE_ID,
    };
  }
  const diag = cellSurface.diagnostics
    || (cellSurface.scored && cellSurface.scored.diagnostics)
    || {};
  const score = Number.isFinite(diag.agreement)
    ? diag.agreement
    : (cellSurface.scored && cellSurface.scored.best
      ? cellSurface.scored.best.agreement
      : null);
  return {
    n,
    orientation,
    geometrySeed: seedId,
    attempted: true,
    accepted: cellSurface.accepted === true,
    score: Number.isFinite(score) ? score : null,
    reason: cellSurface.accepted ? null : (diag.rejectReason || cellSurface.reason || 'rejected'),
    profile: diag.profile || CELL_SURFACE_PROFILE_ID,
    orientationMargin: Number.isFinite(diag.orientationMargin) ? diag.orientationMargin : null,
  };
}

function summarizeCellSurfaceProbe(options, geometryReports) {
  if (options.enableCellSurfaceY !== true) {
    return {
      attempted: false,
      accepted: false,
      score: null,
      reason: null,
      profile: null,
    };
  }
  const reports = geometryReports.filter((entry) => entry.attempted === true);
  if (reports.length === 0) {
    return {
      attempted: true,
      accepted: false,
      score: null,
      reason: 'no-geometry',
      profile: CELL_SURFACE_PROFILE_ID,
    };
  }
  let best = reports[0];
  for (const entry of reports) {
    if (entry.accepted === true && best.accepted !== true) {
      best = entry;
      continue;
    }
    if (entry.accepted === best.accepted
      && Number.isFinite(entry.score)
      && (!Number.isFinite(best.score) || entry.score > best.score)) {
      best = entry;
    }
  }
  return {
    attempted: true,
    accepted: best.accepted === true,
    score: Number.isFinite(best.score) ? best.score : null,
    reason: best.accepted ? null : (best.reason || 'rejected'),
    profile: best.profile || CELL_SURFACE_PROFILE_ID,
  };
}

function hypothesesFromShapes(luma, reduced, shapes, options, cfg, hypotheses, geometryReports) {
  for (const shape of shapes.candidates) {
    const center = liftPoint(shape.center, reduced.factor);
    const vertices = shape.vertices.map((point) => liftPoint(point, reduced.factor));
    const seamVertices = shape.seamVertices.map((point) => liftPoint(point, reduced.factor));
    const radius = shape.radius * reduced.factor;

    const candidateNs = shape.locatorProfile && SUPPORTED_N.includes(shape.estimatedN)
      ? [shape.estimatedN]
      : SUPPORTED_N;
    for (const n of candidateNs) {
      for (let orientation = 0; orientation < 3; orientation += 1) {
        const seeds = cubeGeometrySeeds(
          n,
          center,
          vertices,
          seamVertices,
          shape.seamParity,
          orientation,
          Boolean(shape.locatorProfile),
          shape.locatorPhase,
        );
        for (const seed of seeds) {
          const vertexResidual = vertexSetResidual(seed.H, n, vertices);
          const relativeVertexResidual = vertexResidual / Math.max(radius, EPSILON);
          if (relativeVertexResidual > cfg.maximumVertexResidual) continue;

          const base = {
            family: 'cube',
            finderKind: 'y-junction',
            gridKind: 'three-face-nxn',
            n,
            k: n,
            orientation,
            rotationDegrees: orientation * 120,
            centerQr: false,
            center,
            vertices,
            seamVertices: seed.observedSeams,
            H: seed.H,
            canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
            geometryResidual: vertexResidual,
            sizeGeometry: {
              rK: relativeVertexResidual,
              vertexResidual,
              relativeVertexResidual,
            },
            source: shape.locatorProfile
              ? locatorSourceId(shape.locatorProfile)
              : 'cube-silhouette-y-junction',
            locatorProfile: shape.locatorProfile || LOCATOR_PROFILE_OFF,
            locatorRoute: shape.locatorRoute || 'silhouette',
            cellSurface: false,
            locatorPhase: shape.locatorPhase ? {
              ...shape.locatorPhase,
              used: seed.locatorPhaseUsed === true,
              fallback: seed.locatorPhaseFallback === true,
            } : null,
            geometrySeed: seed.id,
            shapeScore: shape.score,
            seamScore: shape.seam.contrast,
            seamSupport: shape.seam.support,
            shapeDiagnostics: shape,
          };
          if (options.enableCellSurfaceY === true && n === 21) {
            const cellSurface = evaluateCellSurfaceGeometry(
              base,
              (i, j) => sampleCubeCell(luma, base, i, j, sampleOptions(options, cfg)),
              options,
            );
            geometryReports.push(cellSurfaceSeedReport(
              n,
              orientation,
              seed.id,
              cellSurface,
            ));
            if (cellSurface.ok && cellSurface.accepted) {
              const patches = cellSurface.hypothesisPatches
                || (cellSurface.hypothesisPatch ? [cellSurface.hypothesisPatch] : []);
              for (const patch of patches) {
                hypotheses.push({
                  ...base,
                  ...patch,
                  logicalHypothesisId: 'cube-n' + n
                    + '-c' + shape.componentIndex
                    + '-p' + shape.seamParity
                    + '-o' + orientation
                    + '-t' + patch.tones
                    + '-cs',
                  hypothesisId: 'cube-n' + n
                    + '-c' + shape.componentIndex
                    + '-p' + shape.seamParity
                    + '-o' + orientation
                    + '-t' + patch.tones
                    + '-cs-g' + seed.id,
                });
              }
            }
          }
          const references = calibrateCubeReferences(luma, base, options);
          geometryReports.push({
            n,
            orientation,
            geometrySeed: seed.id,
            vertexResidual,
            relativeVertexResidual,
            referenceResult: references.ok
              ? references.calibrations.map((entry) => ({
                tones: entry.tones,
                agreementRate: entry.agreementRate,
                minimumSpan: entry.minimumSpan,
                hardChecks: entry.hardChecks,
              }))
              : { reason: references.reason, detail: references.detail },
          });
          if (!references.ok) continue;

          const refinable = references.calibrations.filter(
            (entry) => entry.hardChecks.all || entry.minimumSpan > 0,
          );
          for (const initialCalibration of refinable) {
            const refined = refineHomographyWithReferences(
              luma,
              base,
              initialCalibration.tones,
              options,
              cfg,
              initialCalibration.hardChecks.all,
            );
            if (!refined) continue;
            const refinedVertexResidual = vertexSetResidual(refined.H, n, vertices);
            const refinedRelativeVertexResidual =
              refinedVertexResidual / Math.max(radius, EPSILON);
            if (refinedRelativeVertexResidual > cfg.maximumVertexResidual) continue;
            const refinedCenter = projectPoint(refined.H, { x: 0, y: 0 });
            hypotheses.push({
              ...base,
              center: refinedCenter || center,
              H: refined.H,
              geometryResidual: refinedVertexResidual,
              sizeGeometry: {
                rK: refinedRelativeVertexResidual,
                vertexResidual: refinedVertexResidual,
                relativeVertexResidual: refinedRelativeVertexResidual,
                initialVertexResidual: vertexResidual,
                initialRelativeVertexResidual: relativeVertexResidual,
              },
              tones: refined.referenceCalibration.tones,
              referenceCalibration: refined.referenceCalibration,
              referenceSamples: refined.referenceSamples,
              referenceAnchors: references.anchors,
              referenceAgreement: refined.referenceCalibration.agreementRate,
              referenceRefinement: {
                dx: refined.dx,
                dy: refined.dy,
                pitch: refined.pitch,
                radius: refined.radius,
                step: refined.step,
                scale: refined.scale,
                quality: refined.quality,
              },
              logicalHypothesisId: 'cube-n' + n
                + '-c' + shape.componentIndex
                + '-p' + shape.seamParity
                + '-o' + orientation
                + '-t' + refined.referenceCalibration.tones,
              hypothesisId: 'cube-n' + n
                + '-c' + shape.componentIndex
                + '-p' + shape.seamParity
                + '-o' + orientation
                + '-t' + refined.referenceCalibration.tones
                + '-g' + seed.id,
            });
          }
        }
      }
    }
  }
}

function recoverFlatBlockHypotheses(luma, reduced, options, cfg) {
  const proposals = flatBlockCandidates(reduced.luma, cfg);
  const hypotheses = [];
  const reports = [];
  const requestedTones = options.tones === 2 || options.tones === 3
    ? [options.tones]
    : SUPPORTED_TONES;

  for (let componentIndex = 0;
    componentIndex < proposals.candidates.length;
    componentIndex += 1) {
    const proposal = proposals.candidates[componentIndex];
    for (const n of SUPPORTED_N) {
      for (let orientation = 0;
        orientation < CANONICAL_SEAM_CORNERS.length;
        orientation += 1) {
        const initialH = blockCandidateHomography(proposal, n, reduced.factor, orientation);
        if (!initialH) continue;
        for (const tones of requestedTones) {
          const searched = blockReferenceSearch(luma, initialH, n, tones, options, cfg);
          reports.push({
            componentIndex,
            n,
            orientation,
            tones,
            proposal,
            ...searched.report,
          });
          if (!searched.accepted) continue;

          const accepted = searched.accepted;
          const radius = median(accepted.vertices.map((point) =>
            Math.hypot(point.x - accepted.center.x, point.y - accepted.center.y)));
          const shapeScore = clamp01(
            0.38 * clamp01(
              accepted.seam.contrast / Math.max(cfg.minimumSeamContrast * 4, EPSILON),
            )
            + 0.20 * accepted.seam.support
            + 0.22 * accepted.referenceCalibration.agreementRate
            + 0.20 * clamp01(proposal.blockFill),
          );
          const geometryResidual = 0;
          const logicalHypothesisId = 'cube-n' + n
            + '-flat-block-c' + componentIndex + '-o' + orientation + '-t' + tones;
          const hardChecks = {
            flatModuleRegion: true,
            yJunction: true,
            referenceAgreement: accepted.referenceCalibration.hardChecks.referenceAgreement,
            toneSeparation: accepted.referenceCalibration.hardChecks.toneSeparation,
            all: true,
          };
          hypotheses.push({
            family: 'cube',
            finderKind: 'y-junction',
            gridKind: 'three-face-nxn',
            n,
            k: n,
            orientation,
            rotationDegrees: orientation * 120,
            centerQr: false,
            center: accepted.center,
            vertices: accepted.vertices,
            seamVertices: CANONICAL_SEAM_CORNERS.map((index) => accepted.vertices[index]),
            H: accepted.H,
            canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
            geometryResidual,
            sizeGeometry: {
              rK: 0,
              vertexResidual: geometryResidual,
              relativeVertexResidual: 0,
              proposalScaleX: accepted.scaleX,
              proposalScaleY: accepted.scaleY,
            },
            source: 'cube-flat-block-reference',
            geometrySeed: 'flat-block-affine',
            shapeScore,
            seamScore: accepted.seam.contrast,
            seamSupport: accepted.seam.support,
            shapeDiagnostics: {
              componentIndex,
              componentSource: 'flat-block-density',
              center: accepted.center,
              vertices: accepted.vertices,
              seamParity: 1,
              seamVertices: CANONICAL_SEAM_CORNERS.map(
                (index) => accepted.vertices[index],
              ),
              radius,
              maskFill: proposal.blockFill,
              concurrencyResidual: 0,
              seam: accepted.seam,
              otherParitySeam: accepted.otherParitySeam,
              parityMargin: accepted.parityMargin,
              hardChecks,
              score: shapeScore,
              proposal,
            },
            tones,
            referenceCalibration: accepted.referenceCalibration,
            referenceSamples: accepted.references.samples,
            referenceAnchors: accepted.references.anchors,
            referenceAgreement: accepted.referenceCalibration.agreementRate,
            referenceRefinement: {
              dx: accepted.dx,
              dy: accepted.dy,
              pitch: searched.report.pitch,
              radius: 1.75 * searched.report.pitch,
              step: 0.25 * searched.report.pitch,
              scale: median([accepted.scaleX, accepted.scaleY]),
              scaleX: accepted.scaleX,
              scaleY: accepted.scaleY,
              quality: calibrationQuality(accepted.referenceCalibration),
            },
            logicalHypothesisId,
            hypothesisId: logicalHypothesisId + '-gflat-block-affine',
          });
          /*
           * 레퍼런스 일치는 본문 격자의 충분조건이 아니므로 실패를 확정하는 경로에서는
           * 끝까지 보존한다. 정상 입력의 첫 통과만 여기서 줄이고, 포맷·RS가 모두 막히면
           * 상위 검증기가 exhaustiveBlockRecovery로 다시 열거한다.
           */
          if (accepted.referenceCalibration.hardChecks.all
            && options.exhaustiveBlockRecovery !== true) {
            return { hypotheses, reports, diagnostics: proposals.diagnostics };
          }
        }
      }
    }
  }
  return { hypotheses, reports, diagnostics: proposals.diagnostics };
}

export function detectCubeHypotheses(luma, yJunction, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
      stage: 'cube-detect',
      message: error.message,
    });
  }
  const explicit = explicitCubeHypotheses(yJunction);
  if (explicit && explicit.length > 0) {
    return ok({
      hypotheses: explicit,
      diagnostics: { source: 'supplied', hypothesisCount: explicit.length },
    });
  }

  const cfg = calibration(options);
  const reduced = downsampleLuma(luma, cfg.maxDimension);
  const shapes = shapeCandidates(reduced.luma, cfg);
  // 새 Type Y 로케이터는 시험판에서 명시적으로 켠 경우에만 후보를 만든다.
  // 라이브러리/정식 스캐너의 기본 검출 계약과 프레임 비용은 그대로 유지한다.
  const locatorEnabled = options.enableLocatorY === true;
  const locatorShapes = locatorEnabled
    ? locatorShapesFromSilhouette(reduced.luma, shapes, options)
    : { candidates: [], diagnostics: [] };
  const fromSilhouette = locatorShapes.candidates;
  const locator = {
    ok: true,
    diagnostics: {
      source: locatorEnabled ? 'locator-hex-frame-v1' : 'disabled',
      enabled: locatorEnabled,
      profile: fromSilhouette.length ? LOCATOR_PROFILE_HEX_FRAME_V1 : LOCATOR_PROFILE_OFF,
      accepted: fromSilhouette.length,
      via: 'silhouette-shrink',
      proposalChain: locatorShapes.diagnostics,
    },
  };
  for (const candidate of fromSilhouette) shapes.candidates.unshift(candidate);
  const hypotheses = [];
  const geometryReports = [];
  let blockRecovery = null;

  hypothesesFromShapes(luma, reduced, shapes, options, cfg, hypotheses, geometryReports);

  const hasConfirmedGrid = hypotheses.some((entry) =>
    entry.referenceCalibration
    && entry.referenceCalibration.hardChecks
    && entry.referenceCalibration.hardChecks.all);
  if (!hasConfirmedGrid) {
    blockRecovery = recoverFlatBlockHypotheses(luma, reduced, options, cfg);
    hypotheses.push(...blockRecovery.hypotheses);
    geometryReports.push(...blockRecovery.reports.map((report) => ({
      geometrySeed: 'flat-block-affine',
      ...report,
    })));
  }

  // 같은 n/방향/톤에서 레퍼런스 상위 2개를 본문 RS까지 보낸다. 외곽의 한
  // 꼭짓점이 blur로 치우치면 레퍼런스 최상위 seed가 가장자리 본문에는 열등할 수 있다.
  const groups = new Map();
  for (const hypothesis of hypotheses) {
    const key = hypothesis.logicalHypothesisId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(hypothesis);
  }
  hypotheses.length = 0;
  for (const group of groups.values()) {
    group.sort((left, right) =>
      right.referenceAgreement - left.referenceAgreement
      || right.referenceRefinement.quality - left.referenceRefinement.quality
      || left.geometryResidual - right.geometryResidual
      || left.geometrySeed.localeCompare(right.geometrySeed));
    hypotheses.push(...group.slice(0, 2));
  }

  hypotheses.sort((left, right) =>
    right.referenceAgreement - left.referenceAgreement
    || right.shapeScore - left.shapeScore
    || left.sizeGeometry.relativeVertexResidual - right.sizeGeometry.relativeVertexResidual
    || left.n - right.n
    || left.orientation - right.orientation
    || left.tones - right.tones
    || left.hypothesisId.localeCompare(right.hypothesisId));

  const cellSurfaceProbe = summarizeCellSurfaceProbe(options, geometryReports);

  if (hypotheses.length === 0) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'cube-detect',
      cause: shapes.candidates.length === 0
        ? 'no-positive-hex-y-junction'
        : 'no-reference-supported-grid',
      diagnostics: {
        downsampleFactor: reduced.factor,
        shapes: shapes.diagnostics,
        shapeCandidates: shapes.candidates,
        geometryReports,
        cellSurfaceProbe,
        blockReferenceRecovery: blockRecovery && blockRecovery.diagnostics,
        locator: locator.ok ? locator.diagnostics : { ok: false, reason: locator.reason },
      },
    });
  }

  return ok({
    hypotheses,
    diagnostics: {
      source: reduced.factor === 1 ? 'detected' : 'detected-downsampled',
      downsampleFactor: reduced.factor,
      shapes: shapes.diagnostics,
      shapeCandidates: shapes.candidates,
      geometryReports,
      cellSurfaceProbe,
      blockReferenceRecovery: blockRecovery && blockRecovery.diagnostics,
      hypothesisCount: hypotheses.length,
      locator: locator.ok ? locator.diagnostics : { ok: false, reason: locator.reason },
    },
  });
}

const CENTRAL_CUBE_SAMPLE_COORDINATES = Object.freeze([
  Object.freeze({ i: 0, j: 0 }),
  Object.freeze({ i: 0, j: 2 }),
  Object.freeze({ i: 1, j: 1 }),
  Object.freeze({ i: 2, j: 0 }),
  Object.freeze({ i: 2, j: 2 }),
  Object.freeze({ i: 3, j: 3 }),
]);

function centralCubeRankReport(luma, H, options, cfg, span) {
  const values = Object.fromEntries(YFACES.map((face) => [face, []]));
  const sampleConfig = sampleOptions(options, cfg);
  for (const coordinate of CENTRAL_CUBE_SAMPLE_COORDINATES) {
    const sample = sampleCubeCell(
      luma,
      { H },
      coordinate.i,
      coordinate.j,
      sampleConfig,
    );
    if (!sample.ok) return null;
    for (const face of YFACES) values[face].push(sample[face].median);
  }
  const faceMedians = Object.fromEntries(
    YFACES.map((face) => [face, median(values[face])]),
  );
  const orderMargins = [];
  for (let leftIndex = 0; leftIndex < YFACES.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < YFACES.length; rightIndex += 1) {
      const left = YFACES[leftIndex];
      const right = YFACES[rightIndex];
      const sign = Math.sign(FINDER_CUBE_FACE_RANKS[left] - FINDER_CUBE_FACE_RANKS[right]);
      orderMargins.push(sign * (faceMedians[left] - faceMedians[right]) / span);
    }
  }
  const sortedMedians = Object.values(faceMedians).slice().sort((left, right) => left - right);
  return {
    score: Math.min(...orderMargins),
    toneSpanRatio: (sortedMedians[2] - sortedMedians[0]) / span,
    faceMedians,
    orderMargins,
    samples: values,
  };
}

/**
 * 중앙 3톤 큐브 파인더. Type Y의 실루엣→Y 심→투영기하 단계를 그대로 쓰고,
 * 전용 12셀 레퍼런스 대신 고정 면 순위 T/L/R=밝음/중간/어두움으로 120°를 고른다.
 */
export function detectCentralCubeFinders(luma, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
      stage: 'central-cube-finder',
      message: error.message,
    });
  }
  const cfg = calibration(options);
  const reduced = downsampleLuma(luma, cfg.maxDimension);
  const shapes = shapeCandidates(reduced.luma, cfg);
  const span = Math.max(lumaSpan(luma), EPSILON);
  const candidates = [];
  const geometryReports = [];

  for (const shape of shapes.candidates) {
    const center = liftPoint(shape.center, reduced.factor);
    const vertices = shape.vertices.map((point) => liftPoint(point, reduced.factor));
    const bounds = {
      minX: Math.min(...vertices.map((point) => point.x)),
      minY: Math.min(...vertices.map((point) => point.y)),
      maxX: Math.max(...vertices.map((point) => point.x)),
      maxY: Math.max(...vertices.map((point) => point.y)),
    };
    const radius = shape.radius * reduced.factor;
    const byOrientation = [];

    for (let orientation = 0; orientation < 3; orientation += 1) {
      let best = null;
      const seeds = [];
      const affineH = blockCandidateHomography(
        { bounds }, FINDER_CUBE_RADIUS_CELLS, 1, orientation,
      );
      if (affineH) seeds.push({ id: 'flat-block-affine', H: affineH });
      for (const seed of seeds) {
        const vertexResidual = vertexSetResidual(
          seed.H,
          FINDER_CUBE_RADIUS_CELLS,
          vertices,
        );
        const relativeVertexResidual = vertexResidual / Math.max(radius, EPSILON);
        if (relativeVertexResidual > cfg.maximumVertexResidual) continue;
        const rank = centralCubeRankReport(luma, seed.H, options, cfg, span);
        if (!rank) continue;
        const report = {
          orientation,
          seed,
          rank,
          vertexResidual,
          relativeVertexResidual,
        };
        if (!best
          || report.rank.score > best.rank.score
          || (report.rank.score === best.rank.score
            && report.relativeVertexResidual < best.relativeVertexResidual)) {
          best = report;
        }
      }
      if (best) byOrientation.push(best);
    }

    byOrientation.sort((left, right) =>
      right.rank.score - left.rank.score
      || left.relativeVertexResidual - right.relativeVertexResidual
      || left.orientation - right.orientation);
    const best = byOrientation[0];
    const runnerUp = byOrientation[1];
    const orientationMargin = best
      ? best.rank.score - (runnerUp ? runnerUp.rank.score : -1)
      : -Infinity;
    geometryReports.push({
      componentIndex: shape.componentIndex,
      orientations: byOrientation.map((entry) => ({
        orientation: entry.orientation,
        geometrySeed: entry.seed.id,
        rankScore: entry.rank.score,
        toneSpanRatio: entry.rank.toneSpanRatio,
        faceMedians: entry.rank.faceMedians,
        relativeVertexResidual: entry.relativeVertexResidual,
      })),
      orientationMargin,
    });
    if (!best
      || best.rank.score < cfg.minimumFinderToneSpanRatio
      || orientationMargin < cfg.minimumFinderOrientationMargin) continue;

    const hardChecks = {
      ...shape.hardChecks,
      toneOrder: best.rank.score >= cfg.minimumFinderToneSpanRatio,
      orientation: orientationMargin >= cfg.minimumFinderOrientationMargin,
    };
    hardChecks.all = hardChecks.hexSilhouette && hardChecks.diagonalConcurrency
      && hardChecks.yJunction && hardChecks.toneOrder && hardChecks.orientation;
    const score = clamp01(
      0.55 * shape.score
      + 0.30 * clamp01(best.rank.toneSpanRatio)
      + 0.15 * clamp01(orientationMargin),
    );
    // seed 배열 인덱스는 hull 시작 꼭짓점에 따라 순환할 수 있다. 실제 canonical→image
    // 행렬의 원점 국소 x축 각도를 120°로 양자화해 외부 방향 번호를 안정화한다.
    const localDxX = best.seed.H[0] - best.seed.H[6] * best.seed.H[2];
    const localDxY = best.seed.H[3] - best.seed.H[6] * best.seed.H[5];
    const localDegrees = ((Math.atan2(localDxY, localDxX) * 180 / Math.PI) % 360 + 360) % 360;
    const normalizedOrientation = Math.round(localDegrees / 120) % 3;
    candidates.push({
      finderKind: 'three-tone-cube',
      kind: 'three-tone-cube',
      patternId: THREE_TONE_CUBE_FINDER_PATTERN_ID,
      toneRanks: FINDER_CUBE_FACE_RANKS,
      center,
      cellSize: radius / FINDER_CUBE_RADIUS_CELLS,
      score,
      orientation: normalizedOrientation,
      orientationSource: 'three-tone-face-rank',
      orientationMargin,
      rotationDegrees: normalizedOrientation * 120,
      H: best.seed.H,
      transform: best.seed.H,
      B: best.seed.H,
      geometryResidual: best.vertexResidual,
      geometryMode: best.seed.id,
      hardChecks,
      hardChecksPassed: hardChecks.all,
      source: 'cube-silhouette-y-junction-three-tone-rank',
      bands: { matcher: 'three-tone-face-rank', faceMedians: best.rank.faceMedians },
    });
  }

  candidates.sort((left, right) =>
    right.score - left.score
    || right.orientationMargin - left.orientationMargin
    || left.geometryResidual - right.geometryResidual);
  if (candidates.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'central-cube-finder',
      cause: shapes.candidates.length === 0
        ? 'no-positive-hex-y-junction'
        : 'no-unique-three-tone-rank',
      diagnostics: { shapes: shapes.diagnostics, geometryReports },
    });
  }
  return ok({
    candidates: candidates.slice(0, cfg.maximumShapeCandidates),
    diagnostics: {
      source: reduced.factor === 1 ? 'detected' : 'detected-downsampled',
      downsampleFactor: reduced.factor,
      shapes: shapes.diagnostics,
      geometryReports,
    },
  });
}

export function sampleCubeGrid(luma, geometry, layoutMap, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
      stage: 'cube-grid-sampling',
      message: error.message,
    });
  }
  if (!(layoutMap instanceof Map)) {
    throw new TypeError('layoutMapY는 Map이어야 한다');
  }
  const cells = new Map();
  for (const key of layoutMap.keys()) {
    const parts = key.split(',');
    const i = Number(parts[0]);
    const j = Number(parts[1]);
    const sampled = sampleCubeCell(luma, geometry, i, j, options);
    if (!sampled.ok) {
      return fail(sampled.reason, {
        stage: 'cube-grid-sampling',
        cell: { i, j },
        cause: sampled.detail,
      });
    }
    cells.set(key, sampled);
  }
  return ok({ cells, sampledCellCount: cells.size });
}
