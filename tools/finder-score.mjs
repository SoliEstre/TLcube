#!/usr/bin/env node

/**
 * finder-score.mjs — 중앙 19셀 파인더 후보의 검출기 무관 채점 하네스
 *
 * 실행: node tools/finder-score.mjs [--top N] [--output DIR] [--blur-sigma PX]
 *
 * 후보를 채점하기 전에 현행 불스아이와 중앙 QR을 같은 네 지표로 잰다.
 * 알려진 실측 방향(중앙 QR 89% > 불스아이 53%)을 재현하지 못하면 후보를
 * 생성하거나 순위를 내지 않는다. 점수는 성공률 예측값이 아니다.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  AXIAL_DIRECTIONS, CENTER_SPACING_COEFF, FACES, axialToPixel, codeBounds,
  facePolygon, faceSampleDisc, hexDistance, layoutForRegion, pixelToAxial, regionCells,
} from '../src/hexgrid.js';
import { maxSafeRadius, profileAt } from '../src/bullseye.js';
import { digitToRanks } from '../src/lehmer.js';
import { DEFAULT_PRESET, presetLuminances } from '../src/luminance.js';
import { rasterToPng } from '../src/png.js';
import { TL_READER_URL } from '../src/qr.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';

const FINDER_RADIUS = 2;
const CELLS = Object.freeze(regionCells(FINDER_RADIUS));
const FACE_COUNT = CELLS.length * FACES.length;
const UNIT_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });
const BOUNDS = Object.freeze(codeBounds(FINDER_RADIUS, UNIT_LAYOUT));

// 실측 복호 하한. 셀 폭은 인접 중심 간격 sqrt(3)*size로 정의한다.
const LOW_PIXELS_PER_CELL = 9;
const LOW_PPU = LOW_PIXELS_PER_CELL / CENTER_SPACING_COEFF;

// [미검증] 경계 면적 적분용 4x 서브샘플. 카메라 모델이 아니라 수치 적분 선택이다.
const AREA_SUPERSAMPLE = 4;
// 깨끗한 표본은 9 px/cell의 최소 정수 2배. [미검증] 완전 수렴값은 아니다.
const REFERENCE_PIXELS_PER_CELL = LOW_PIXELS_PER_CELL * 2;
const REFERENCE_PPU = REFERENCE_PIXELS_PER_CELL / CENTER_SPACING_COEFF;
// [미검증] 실제 카메라 MTF로 보정하지 않은 9 px/cell 가우시안 PSF sigma.
const DEFAULT_BLUR_SIGMA = 0.75;
// +/-3 sigma는 정규분포 질량 약 99.73%를 포함하며 뒤에서 합 1로 재정규화한다.
const GAUSSIAN_CUTOFF_SIGMAS = 3;
const DEFAULT_TOP = 12;
const MAX_TOP = 100;
const ROTATIONS = Object.freeze([1, 2, 3, 4, 5]);
const FACE_BITS = Object.freeze({ T: 1, L: 2, R: 4 });
const SINGLE_FACE_MASKS = Object.freeze([1, 2, 4]);
const NONZERO_MASKS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
const PNG_CELL_SIZE = 64;
const PNG_MARGIN = 24;
const PNG_SUPERSAMPLE = 4;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'test', 'output', 'finder-score');
const PALETTE = Object.freeze({
  background: Object.freeze({ r: 0, g: 0, b: 0 }),
  levels: Object.freeze([
    Object.freeze({ r: 0, g: 0, b: 0 }),
    Object.freeze({ r: 128, g: 128, b: 128 }),
    Object.freeze({ r: 255, g: 255, b: 255 }),
  ]),
  bullseyeDark: Object.freeze({ r: 0, g: 0, b: 0 }),
  bullseyeLight: Object.freeze({ r: 255, g: 255, b: 255 }),
});

function assert(condition, message) {
  if (!condition) throw new Error('finder-score 자기검사 실패: ' + message);
}
function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }
function cellKey(q, r) { return q + ',' + r; }

const CELL_INDEX = new Map(CELLS.map((cell, index) => [cellKey(cell.q, cell.r), index]));
const FACE_POLYGONS = CELLS.map((cell) =>
  FACES.map((face) => facePolygon(cell.q, cell.r, face, UNIT_LAYOUT)));

function pointOnSegment(x, y, a, b) {
  const cross = (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
  const scale = Math.max(1, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  const eps = Number.EPSILON * 32 * scale;
  return Math.abs(cross) <= eps && x >= Math.min(a.x, b.x) - eps
    && x <= Math.max(a.x, b.x) + eps && y >= Math.min(a.y, b.y) - eps
    && y <= Math.max(a.y, b.y) + eps;
}
function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    if (pointOnSegment(x, y, a, b)) return true;
    if ((a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// 좌표는 pixelToAxial로 셀을 찾고 facePolygon으로 면을 판정한다. 새 규약을 만들지 않는다.
function faceIndexAt(x, y) {
  const cell = pixelToAxial(x, y, UNIT_LAYOUT);
  if (hexDistance(cell.q, cell.r) > FINDER_RADIUS) return -1;
  const ci = CELL_INDEX.get(cellKey(cell.q, cell.r));
  if (ci === undefined) return -1;
  for (let fi = 0; fi < FACES.length; fi += 1) {
    if (pointInPolygon(x, y, FACE_POLYGONS[ci][fi])) return ci * FACES.length + fi;
  }
  return -1;
}
function rotatePoint(point, steps) {
  const angle = steps * Math.PI / 3;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

// 각 faceSampleDisc 안에 18 px/cell 격자점을 놓는다. 합동 원판은 표본 수도 같다.
function buildReference() {
  const points = [];
  const counts = [];
  for (let ci = 0; ci < CELLS.length; ci += 1) {
    const cell = CELLS[ci];
    for (let fi = 0; fi < FACES.length; fi += 1) {
      const disc = faceSampleDisc(cell.q, cell.r, FACES[fi], UNIT_LAYOUT);
      const extent = Math.floor(disc.radius * REFERENCE_PPU);
      let count = 0;
      for (let iy = -extent; iy <= extent; iy += 1) {
        for (let ix = -extent; ix <= extent; ix += 1) {
          const dx = ix / REFERENCE_PPU;
          const dy = iy / REFERENCE_PPU;
          if (dx * dx + dy * dy > disc.radius * disc.radius) continue;
          points.push(Object.freeze({ x: disc.x + dx, y: disc.y + dy,
            ownerFaceIndex: ci * FACES.length + fi }));
          count += 1;
        }
      }
      counts.push(count);
    }
  }
  assert(new Set(counts).size === 1, '합동 faceSampleDisc 표본 수 불일치');
  return Object.freeze({ points: Object.freeze(points), samplesPerFace: counts[0] });
}
const REFERENCE = buildReference();
const ROTATED_FACE_MAPS = Object.freeze(ROTATIONS.map((steps) => {
  const map = new Int16Array(REFERENCE.points.length);
  for (let i = 0; i < map.length; i += 1) {
    const p = rotatePoint(REFERENCE.points[i], -steps);
    map[i] = faceIndexAt(p.x, p.y);
  }
  return map;
}));

function buildGrid() {
  const width = Math.ceil(BOUNDS.width * LOW_PPU);
  const height = Math.ceil(BOUNDS.height * LOW_PPU);
  const highWidth = width * AREA_SUPERSAMPLE;
  const highHeight = height * AREA_SUPERSAMPLE;
  const highPpu = LOW_PPU * AREA_SUPERSAMPLE;
  const highFaceMap = new Int16Array(highWidth * highHeight);
  for (let y = 0; y < highHeight; y += 1) {
    const py = (y + 0.5 - highHeight / 2) / highPpu;
    for (let x = 0; x < highWidth; x += 1) {
      const px = (x + 0.5 - highWidth / 2) / highPpu;
      highFaceMap[y * highWidth + x] = faceIndexAt(px, py);
    }
  }
  const lowMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const py = (y + 0.5 - height / 2) / LOW_PPU;
    for (let x = 0; x < width; x += 1) {
      const px = (x + 0.5 - width / 2) / LOW_PPU;
      lowMask[y * width + x] = faceIndexAt(px, py) >= 0 ? 1 : 0;
    }
  }
  return Object.freeze({ width, height, highWidth, highHeight, highPpu, highFaceMap, lowMask });
}
const GRID = buildGrid();

function gaussianKernel(sigma) {
  if (!Number.isFinite(sigma) || sigma < 0) throw new RangeError('blur sigma 범위 오류: ' + sigma);
  if (sigma === 0) return Float64Array.of(1);
  const radius = Math.ceil(GAUSSIAN_CUTOFF_SIGMAS * sigma);
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    kernel[i + radius] = Math.exp(-i * i / (2 * sigma * sigma));
    sum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;
  return kernel;
}
function downsampleBox(high) {
  const low = new Float64Array(GRID.width * GRID.height);
  const area = AREA_SUPERSAMPLE * AREA_SUPERSAMPLE;
  for (let y = 0; y < GRID.height; y += 1) {
    for (let x = 0; x < GRID.width; x += 1) {
      let sum = 0;
      const x0 = x * AREA_SUPERSAMPLE;
      const y0 = y * AREA_SUPERSAMPLE;
      for (let sy = 0; sy < AREA_SUPERSAMPLE; sy += 1) {
        const row = (y0 + sy) * GRID.highWidth + x0;
        for (let sx = 0; sx < AREA_SUPERSAMPLE; sx += 1) sum += high[row + sx];
      }
      low[y * GRID.width + x] = sum / area;
    }
  }
  return low;
}
function blur(data, kernel, outside) {
  if (kernel.length === 1) return data.slice();
  const radius = (kernel.length - 1) / 2;
  const temp = new Float64Array(data.length);
  const out = new Float64Array(data.length);
  for (let y = 0; y < GRID.height; y += 1) {
    for (let x = 0; x < GRID.width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = x + k;
        sum += kernel[k + radius] * (sx < 0 || sx >= GRID.width
          ? outside : data[y * GRID.width + sx]);
      }
      temp[y * GRID.width + x] = sum;
    }
  }
  for (let y = 0; y < GRID.height; y += 1) {
    for (let x = 0; x < GRID.width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = y + k;
        sum += kernel[k + radius] * (sy < 0 || sy >= GRID.height
          ? outside : temp[sy * GRID.width + x]);
      }
      out[y * GRID.width + x] = sum;
    }
  }
  return out;
}
function renderBitsLow(bits, kernel) {
  let on = 0;
  for (const bit of bits) on += bit;
  const neutral = on / bits.length;
  const high = new Float64Array(GRID.highFaceMap.length);
  for (let i = 0; i < high.length; i += 1) {
    const fi = GRID.highFaceMap[i];
    high[i] = fi < 0 ? neutral : bits[fi];
  }
  return blur(downsampleBox(high), kernel, neutral);
}
function renderFunctionLow(evaluate, kernel) {
  const high = new Float64Array(GRID.highFaceMap.length);
  let sum = 0;
  let count = 0;
  for (let y = 0; y < GRID.highHeight; y += 1) {
    const py = (y + 0.5 - GRID.highHeight / 2) / GRID.highPpu;
    for (let x = 0; x < GRID.highWidth; x += 1) {
      const index = y * GRID.highWidth + x;
      if (GRID.highFaceMap[index] < 0) continue;
      const px = (x + 0.5 - GRID.highWidth / 2) / GRID.highPpu;
      high[index] = evaluate(px, py);
      sum += high[index];
      count += 1;
    }
  }
  const neutral = count === 0 ? 0 : sum / count;
  for (let i = 0; i < high.length; i += 1) if (GRID.highFaceMap[i] < 0) high[i] = neutral;
  return blur(downsampleBox(high), kernel, neutral);
}
function bilinear(data, x, y, outside) {
  const fx = x * LOW_PPU + GRID.width / 2 - 0.5;
  const fy = y * LOW_PPU + GRID.height / 2 - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (px, py) => px < 0 || px >= GRID.width || py < 0 || py >= GRID.height
    ? outside : data[py * GRID.width + px];
  const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return a * (1 - ty) + b * ty;
}
function lowSignature(data) {
  const out = new Float64Array(REFERENCE.points.length);
  for (let i = 0; i < out.length; i += 1) {
    const p = REFERENCE.points[i];
    out[i] = bilinear(data, p.x, p.y, 0);
  }
  return out;
}
function functionSignature(evaluate) {
  const out = new Float64Array(REFERENCE.points.length);
  for (let i = 0; i < out.length; i += 1) {
    const p = REFERENCE.points[i];
    out[i] = evaluate(p.x, p.y);
  }
  return out;
}
function bitsSignature(bits) {
  const out = new Float64Array(REFERENCE.points.length);
  for (let i = 0; i < out.length; i += 1) out[i] = bits[REFERENCE.points[i].ownerFaceIndex];
  return out;
}
function centered(values) {
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  const vector = new Float64Array(values.length);
  let energy = 0;
  for (let i = 0; i < values.length; i += 1) {
    vector[i] = values[i] - mean;
    energy += vector[i] * vector[i];
  }
  return { mean, vector, norm: Math.sqrt(energy), energy };
}
function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/**
 * 1. 회전 유일성: 60..300도 각각에서 달라진 RMS의 최솟값.
 * 이진 서명에서 RMS^2은 달라진 표본 비율이다. 한 회전이라도 같으면 0점이고,
 * 반지름만의 함수인 동심원은 구조적으로 정확히 0점이다.
 */
function rotationMetric(clean, rotated) {
  let minMse = Infinity;
  let minDifferences = Infinity;
  let worstDegrees = 0;
  for (let ri = 0; ri < rotated.length; ri += 1) {
    let squared = 0;
    let differences = 0;
    for (let i = 0; i < clean.length; i += 1) {
      const delta = clean[i] - rotated[ri][i];
      squared += delta * delta;
      if (delta !== 0) differences += 1;
    }
    const mse = squared / clean.length;
    if (mse < minMse) {
      minMse = mse;
      minDifferences = differences;
      worstDegrees = ROTATIONS[ri] * 60;
    }
  }
  return { score: 100 * Math.sqrt(clamp(minMse, 0, 1)), minDifferenceCount: minDifferences,
    sampleCount: clean.length, worstDegrees };
}

/**
 * 2. 9 px/cell 생존: 중심화한 깨끗한 서명 c와 축소+블러 서명 b에 대해
 * dot(c,b)/(norm(c)*max(norm(c),norm(b))). 상관과 대비 보존을 함께 요구한다.
 * 동일하면 1, 완전 소실이나 직교면 0이다. blur sigma는 [미검증]이다.
 */
function lowResolutionMetric(clean, blurred) {
  const c = centered(clean);
  const b = centered(blurred);
  if (c.norm === 0 || b.norm === 0) return { score: 0, response: 0 };
  const response = dot(c.vector, b.vector) / (c.norm * Math.max(c.norm, b.norm));
  return { score: 100 * clamp(response, 0, 1), response };
}
function shiftedCorrelation(data, dx, dy) {
  let sumA = 0;
  let sumB = 0;
  let count = 0;
  for (let y = 0; y < GRID.height; y += 1) {
    const by = y + dy;
    if (by < 0 || by >= GRID.height) continue;
    for (let x = 0; x < GRID.width; x += 1) {
      const bx = x + dx;
      if (bx < 0 || bx >= GRID.width) continue;
      const ai = y * GRID.width + x;
      const bi = by * GRID.width + bx;
      if (!GRID.lowMask[ai] || !GRID.lowMask[bi]) continue;
      sumA += data[ai];
      sumB += data[bi];
      count += 1;
    }
  }
  if (count === 0) return 1;
  const meanA = sumA / count;
  const meanB = sumB / count;
  let covariance = 0;
  let energyA = 0;
  let energyB = 0;
  for (let y = 0; y < GRID.height; y += 1) {
    const by = y + dy;
    if (by < 0 || by >= GRID.height) continue;
    for (let x = 0; x < GRID.width; x += 1) {
      const bx = x + dx;
      if (bx < 0 || bx >= GRID.width) continue;
      const ai = y * GRID.width + x;
      const bi = by * GRID.width + bx;
      if (!GRID.lowMask[ai] || !GRID.lowMask[bi]) continue;
      const a = data[ai] - meanA;
      const b = data[bi] - meanB;
      covariance += a * b;
      energyA += a * a;
      energyB += b * b;
    }
  }
  return energyA === 0 || energyB === 0 ? 1
    : clamp(covariance / Math.sqrt(energyA * energyB), -1, 1);
}

/**
 * 3. 국소화: 블러 영상의 중심 자기상관과 8개 1픽셀 이웃을 비교한다.
 * 단위 신호 거리 sqrt((1-corr)/2)를 가장 닮은 이웃에 적용한다. 1픽셀은
 * 9 px/cell 측정 격자의 최소 분해능이므로 별도 경험 임계가 없다.
 */
function localizationMetric(lowRaster) {
  let maxCorrelation = -1;
  let weakestShift = null;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const correlation = shiftedCorrelation(lowRaster, dx, dy);
      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
        weakestShift = { dx, dy };
      }
    }
  }
  return { score: 100 * Math.sqrt(clamp((1 - maxCorrelation) / 2, 0, 1)),
    maxOffCenterCorrelation: maxCorrelation, weakestShift };
}

function blurredFaceBases(kernel) {
  const bases = [];
  for (let faceIndex = 0; faceIndex < FACE_COUNT; faceIndex += 1) {
    const high = new Float64Array(GRID.highFaceMap.length);
    for (let i = 0; i < high.length; i += 1) high[i] = GRID.highFaceMap[i] === faceIndex ? 1 : 0;
    bases.push(lowSignature(blur(downsampleBox(high), kernel, 0)));
  }
  return Object.freeze(bases);
}
function logMeanExp(values, lambda) {
  let maximum = -Infinity;
  for (const value of values) maximum = Math.max(maximum, lambda * value);
  let sum = 0;
  let weighted = 0;
  for (const value of values) {
    const weight = Math.exp(lambda * value - maximum);
    sum += weight;
    weighted += weight * value;
  }
  return { logValue: maximum + Math.log(sum / values.length), tiltedMean: weighted / sum };
}

/**
 * 독립 셀 합 S의 Chernoff 상계 inf(lambda>=0) E[exp(lambda*S)]exp(-lambda*t).
 * 각 셀의 가능한 digit 6개를 정확히 열거한다. 볼록 목적함수의 도함수 부호를
 * IEEE-754에서 더 나눌 수 없을 때까지 이분한다. 몬테카를로 표본 수가 없다.
 */
function chernoffLogBound(cellValues, threshold) {
  let mean = 0;
  let maximum = 0;
  for (const values of cellValues) {
    mean += values.reduce((sum, value) => sum + value, 0) / values.length;
    maximum += Math.max(...values);
  }
  if (threshold <= mean) return 0;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(threshold), Math.abs(maximum)) * FACE_COUNT;
  if (threshold > maximum + tolerance) return -Infinity;
  if (Math.abs(threshold - maximum) <= tolerance) {
    let logProbability = 0;
    for (const values of cellValues) {
      const localMax = Math.max(...values);
      const count = values.filter((value) => Math.abs(value - localMax) <= tolerance).length;
      logProbability += Math.log(count / values.length);
    }
    return Math.min(0, logProbability);
  }
  const objective = (lambda) => {
    let value = -lambda * threshold;
    let derivative = -threshold;
    for (const values of cellValues) {
      const part = logMeanExp(values, lambda);
      value += part.logValue;
      derivative += part.tiltedMean;
    }
    return { value, derivative };
  };
  let lo = 0;
  let hi = 1;
  while (objective(hi).derivative < 0 && Number.isFinite(hi * 2)) hi *= 2;
  // 128은 정확도 상수가 아니라 double의 53비트 가수를 넘기고도 충분한 안전 반복 상한이다.
  for (let iteration = 0; iteration < 128; iteration += 1) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (objective(mid).derivative < 0) lo = mid;
    else hi = mid;
  }
  return Math.min(0, objective((lo + hi) / 2).value);
}

/**
 * 4. 데이터 구별도: 기본 팔레트 3톤을 [0,m,1]로 정규화하고 19개 digit이
 * 독립·균등 0..5라고 둔다. digitToRanks의 정확한 여섯 순열로 matched-filter
 * 오검출 확률 Chernoff 상계를 구한다. 점수 분모는 총 엔트로피
 * log2(6^19)=19*log2(6)이라 경험 상수가 없다.
 *
 * [미검증] 실제 digit 독립성·균등성, 선형 등방 블러, 주변 ring-3 평균 경계조건은
 * 실사진으로 확인해야 한다. 상계는 검출기 자체의 탐색 다중비교를 포함하지 않는다.
 */
function dataMetric(clean, blurred, bases) {
  const c = centered(clean);
  if (c.norm === 0) return { score: 0, probabilityUpperBound: 1, bits: 0 };
  const unit = new Float64Array(c.vector.length);
  for (let i = 0; i < unit.length; i += 1) unit[i] = c.vector[i] / c.norm;
  const threshold = dot(unit, blurred);
  const rawLevels = presetLuminances(DEFAULT_PRESET);
  const span = rawLevels[2] - rawLevels[0];
  const levels = rawLevels.map((value) => (value - rawLevels[0]) / span);
  const meanLevel = levels.reduce((sum, value) => sum + value, 0) / levels.length;
  const deviations = levels.map((value) => value - meanLevel);
  const weights = bases.map((basis) => dot(unit, basis));
  const cellValues = [];
  for (let ci = 0; ci < CELLS.length; ci += 1) {
    const values = [];
    for (let digit = 0; digit < 6; digit += 1) {
      const ranks = digitToRanks(digit);
      let contribution = 0;
      for (let fi = 0; fi < FACES.length; fi += 1) {
        contribution += deviations[ranks[FACES[fi]]] * weights[ci * FACES.length + fi];
      }
      values.push(contribution);
    }
    cellValues.push(values);
  }
  const logProbability = chernoffLogBound(cellValues, threshold);
  const totalBits = CELLS.length * Math.log2(6);
  const bits = logProbability === -Infinity ? totalBits
    : clamp(-logProbability / Math.LN2, 0, totalBits);
  return { score: 100 * bits / totalBits,
    probabilityUpperBound: logProbability === -Infinity ? 0 : Math.exp(logProbability),
    logProbabilityUpperBound: logProbability, bits, totalEntropyBits: totalBits, threshold };
}
function composite(metrics) {
  const scores = [metrics.rotation.score, metrics.lowResolution.score,
    metrics.localization.score, metrics.dataDistinction.score];
  if (scores.some((score) => score <= 0)) return 0;
  return Math.exp(scores.reduce((sum, score) => sum + Math.log(score), 0) / scores.length);
}
function rotatedBitsSignatures(bits) {
  return ROTATED_FACE_MAPS.map((map) => {
    const out = new Float64Array(map.length);
    for (let i = 0; i < out.length; i += 1) out[i] = map[i] < 0 ? 0 : bits[map[i]];
    return out;
  });
}
function rotatedFunctionSignatures(evaluate) {
  return ROTATIONS.map((steps) => {
    const out = new Float64Array(REFERENCE.points.length);
    for (let i = 0; i < out.length; i += 1) {
      const p = rotatePoint(REFERENCE.points[i], -steps);
      out[i] = evaluate(p.x, p.y);
    }
    return out;
  });
}
function scoreBits(candidate, kernel, bases) {
  const clean = bitsSignature(candidate.bits);
  const lowRaster = renderBitsLow(candidate.bits, kernel);
  const blurred = lowSignature(lowRaster);
  const metrics = {
    rotation: rotationMetric(clean, rotatedBitsSignatures(candidate.bits)),
    lowResolution: lowResolutionMetric(clean, blurred),
    localization: localizationMetric(lowRaster),
    dataDistinction: dataMetric(clean, blurred, bases),
  };
  return { ...candidate, metrics, total: composite(metrics) };
}
function scoreBaseline(name, kind, evaluate, kernel, bases) {
  const clean = functionSignature(evaluate);
  const lowRaster = renderFunctionLow(evaluate, kernel);
  const blurred = lowSignature(lowRaster);
  const metrics = {
    rotation: rotationMetric(clean, rotatedFunctionSignatures(evaluate)),
    lowResolution: lowResolutionMetric(clean, blurred),
    localization: localizationMetric(lowRaster),
    dataDistinction: dataMetric(clean, blurred, bases),
  };
  return { id: kind, name, family: 'baseline', kind, metrics, total: composite(metrics) };
}
function bullseyeEvaluator() {
  const radius = maxSafeRadius(1);
  return (x, y) => {
    const distance = Math.sqrt(x * x + y * y);
    return distance <= radius ? profileAt(distance, 1) : 0;
  };
}
function colorValue(color) { return (color.r + color.g + color.b) / (3 * 255); }
function centerQrEvaluator() {
  // scene.js의 48회 슬롯 이분탐색과 0.995 보호 여유를 그대로 재사용한다.
  const scene = buildScene(
    { k: FINDER_RADIUS, cellDigits: new Map(), centerQr: true },
    { palette: PALETTE, cellSize: 1, margin: 0, qrText: TL_READER_URL, centerQr: true },
  );
  const center = axialToPixel(0, 0, scene.layout);
  return (x, y) => {
    const sx = x + center.x;
    const sy = y + center.y;
    let value = colorValue(scene.background);
    for (const shape of scene.shapes) {
      if (shape.kind === 'polygon' && pointInPolygon(sx, sy, shape.points)) value = colorValue(shape.color);
      else if (shape.kind === 'disc') {
        const dx = sx - shape.cx;
        const dy = sy - shape.cy;
        if (dx * dx + dy * dy <= shape.r * shape.r) value = colorValue(shape.color);
      }
    }
    return value;
  };
}

function bitsFor(pattern) {
  const bits = new Uint8Array(FACE_COUNT);
  for (let ci = 0; ci < CELLS.length; ci += 1) {
    const mask = pattern(CELLS[ci], ci) & 7;
    for (let fi = 0; fi < FACES.length; fi += 1) {
      bits[ci * FACES.length + fi] = mask & FACE_BITS[FACES[fi]] ? 1 : 0;
    }
  }
  return bits;
}
function sectorIndex(cell) {
  const point = axialToPixel(cell.q, cell.r, UNIT_LAYOUT);
  let best = 0;
  let bestProjection = -Infinity;
  for (let i = 0; i < AXIAL_DIRECTIONS.length; i += 1) {
    const direction = axialToPixel(AXIAL_DIRECTIONS[i].q, AXIAL_DIRECTIONS[i].r, UNIT_LAYOUT);
    const projection = point.x * direction.x + point.y * direction.y;
    if (projection > bestProjection) {
      bestProjection = projection;
      best = i;
    }
  }
  return best;
}
function onDirectedRay(cell, direction) {
  const ring = hexDistance(cell.q, cell.r);
  return ring > 0 && cell.q === direction.q * ring && cell.r === direction.r * ring;
}

/**
 * 무작위 난사 없이 네 족을 열거한다.
 * ring: ring 0/1/2별 8개 면 마스크 전수(8^3).
 * axis: 세 무방향 축 위/밖을 나눠 3축 대칭을 탐색.
 * ray-break: AXIAL_DIRECTIONS 한 방향만 XOR해 대칭을 의도적으로 깸.
 * face-swirl: 방향 sector에 T/L/R 단일면 또는 보수를 순환해 면이 도는 족 생성.
 */
function generateCandidates() {
  const candidates = [];
  const seen = new Set();
  const add = (id, family, params, pattern) => {
    const bits = bitsFor(pattern);
    let on = 0;
    for (const bit of bits) on += bit;
    if (on === 0 || on === bits.length) return;
    const fingerprint = Array.from(bits).join('');
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    candidates.push(Object.freeze({ id, family, params: Object.freeze(params), bits }));
  };
  for (let r0 = 0; r0 < 8; r0 += 1) {
    for (let r1 = 0; r1 < 8; r1 += 1) {
      for (let r2 = 0; r2 < 8; r2 += 1) {
        const masks = [r0, r1, r2];
        add('ring-' + r0 + r1 + r2, 'ring', { ring0: r0, ring1: r1, ring2: r2 },
          (cell) => masks[hexDistance(cell.q, cell.r)]);
      }
    }
  }
  for (let axis = 0; axis < 3; axis += 1) {
    for (let onAxis = 0; onAxis < 8; onAxis += 1) {
      for (let offAxis = 0; offAxis < 8; offAxis += 1) {
        for (const invertCenter of [false, true]) {
          const center = (onAxis ^ offAxis ^ (invertCenter ? 7 : 0)) & 7;
          add('axis-' + axis + '-' + onAxis + offAxis + '-' + (invertCenter ? 1 : 0),
            'axis', { axis, onAxis, offAxis, center }, (cell) => {
              if (hexDistance(cell.q, cell.r) === 0) return center;
              const cube = [cell.q, cell.r, -cell.q - cell.r];
              return cube[axis] === 0 ? onAxis : offAxis;
            });
        }
      }
    }
  }
  for (let di = 0; di < AXIAL_DIRECTIONS.length; di += 1) {
    const direction = AXIAL_DIRECTIONS[di];
    for (let base = 0; base < 8; base += 1) {
      for (const ringToggle of SINGLE_FACE_MASKS) {
        for (const accent of NONZERO_MASKS) {
          add('ray-' + di + '-' + base + ringToggle + accent, 'ray-break',
            { directionIndex: di, base, ringToggle, accent }, (cell) => {
              const ring = hexDistance(cell.q, cell.r);
              let mask = ring === 0 ? base ^ ringToggle : base;
              if (ring === 2) mask ^= ringToggle;
              if (onDirectedRay(cell, direction)) mask ^= accent;
              return mask;
            });
        }
      }
    }
  }
  const cycles = [SINGLE_FACE_MASKS, Object.freeze([6, 5, 3])];
  for (let phase = 0; phase < 6; phase += 1) {
    for (let center = 0; center < 8; center += 1) {
      for (let cycle = 0; cycle < cycles.length; cycle += 1) {
        for (const invertOuter of [false, true]) {
          add('swirl-' + phase + '-' + center + cycle + (invertOuter ? 1 : 0),
            'face-swirl', { phase, center, cycle, invertOuter }, (cell) => {
              const ring = hexDistance(cell.q, cell.r);
              if (ring === 0) return center;
              let mask = cycles[cycle][(sectorIndex(cell) + phase) % 3];
              if (ring === 2 && invertOuter) mask ^= 7;
              return mask;
            });
        }
      }
    }
  }
  assert(candidates.length >= 500 && candidates.length <= 5000,
    '구조화 후보 수 예상 범위 이탈: ' + candidates.length);
  return candidates;
}
function scoreText(value) { return Number(value).toFixed(2); }
function resultRow(result, rank) {
  return { rank, name: result.name || result.id, family: result.family,
    rotation: scoreText(result.metrics.rotation.score),
    low9px: scoreText(result.metrics.lowResolution.score),
    localization: scoreText(result.metrics.localization.score),
    data: scoreText(result.metrics.dataDistinction.score), total: scoreText(result.total) };
}
function timestamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function parseArgs(argv) {
  const options = { top: DEFAULT_TOP, outputParent: DEFAULT_OUTPUT,
    blurSigma: DEFAULT_BLUR_SIGMA, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--help' || argv[i] === '-h') options.help = true;
    else if (argv[i] === '--top') options.top = Number(argv[++i]);
    else if (argv[i] === '--output') options.outputParent = path.resolve(argv[++i]);
    else if (argv[i] === '--blur-sigma') options.blurSigma = Number(argv[++i]);
    else throw new RangeError('알 수 없는 인자: ' + argv[i]);
  }
  if (!Number.isInteger(options.top) || options.top < 1 || options.top > MAX_TOP) {
    throw new RangeError('--top은 1..' + MAX_TOP + ' 정수여야 한다: ' + options.top);
  }
  if (!Number.isFinite(options.blurSigma) || options.blurSigma < 0) {
    throw new RangeError('--blur-sigma는 0 이상의 유한수여야 한다: ' + options.blurSigma);
  }
  return options;
}
function help() {
  console.log('사용법: node tools/finder-score.mjs [options]\n\n'
    + '  --top N           렌더할 상위 후보 수 (기본 ' + DEFAULT_TOP + ')\n'
    + '  --output DIR      실행별 출력 폴더의 상위 경로\n'
    + '  --blur-sigma PX   [미검증] 가우시안 sigma (기본 ' + DEFAULT_BLUR_SIGMA + ')\n'
    + '  --help            도움말');
}
async function runDirectory(parent) {
  const intended = path.join(parent, 'run-' + timestamp());
  try {
    await fs.mkdir(intended, { recursive: true });
    return intended;
  } catch (error) {
    if (error && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    const fallback = await fs.mkdtemp(path.join(os.tmpdir(), 'tlcube-finder-score-'));
    console.warn('출력 경로 쓰기 실패; 임시 경로 사용: ' + fallback);
    return fallback;
  }
}
function candidateScene(bits) {
  const layout = layoutForRegion(FINDER_RADIUS, { size: PNG_CELL_SIZE, margin: PNG_MARGIN });
  const shapes = [];
  for (let ci = 0; ci < CELLS.length; ci += 1) {
    for (let fi = 0; fi < FACES.length; fi += 1) {
      shapes.push({ kind: 'polygon', points: facePolygon(CELLS[ci].q, CELLS[ci].r,
        FACES[fi], layout), color: bits[ci * FACES.length + fi]
          ? PALETTE.bullseyeLight : PALETTE.bullseyeDark });
    }
  }
  return { width: layout.width, height: layout.height, background: PALETTE.background, shapes };
}
function baselineScene(kind) {
  const centerQr = kind === 'center-qr';
  return buildScene({ k: FINDER_RADIUS, cellDigits: new Map(), centerQr },
    { palette: PALETTE, cellSize: PNG_CELL_SIZE, margin: PNG_MARGIN, centerQr,
      ...(centerQr ? { qrText: TL_READER_URL } : {}) });
}
async function writePng(scene, filePath) {
  const raster = rasterize(scene, { pixelsPerUnit: 1, supersample: PNG_SUPERSAMPLE });
  await fs.writeFile(filePath, rasterToPng(raster));
}
function publicResult(result) {
  return { id: result.id, name: result.name, family: result.family, params: result.params,
    scores: { rotation: result.metrics.rotation.score,
      lowResolution: result.metrics.lowResolution.score,
      localization: result.metrics.localization.score,
      dataDistinction: result.metrics.dataDistinction.score, total: result.total },
    diagnostics: result.metrics, png: result.png };
}
function validateRuler(bullseye, centerQr) {
  // 한 우연 표본이 아니라 합동 faceSampleDisc 하나의 전체 표본 이상이 달라야 한다.
  const bullseyeZero = bullseye.metrics.rotation.minDifferenceCount === 0
    && bullseye.metrics.rotation.score === 0;
  const qrResolved = centerQr.metrics.rotation.minDifferenceCount >= REFERENCE.samplesPerFace;
  const totalOrdering = centerQr.total > bullseye.total;
  return { passed: bullseyeZero && qrResolved && totalOrdering,
    bullseyeStructurallyZero: bullseyeZero, qrHasResolvedOrientation: qrResolved,
    totalOrderingMatches: totalOrdering,
    empiricalSuccess: { bullseye: 9 / 17, centerQr: 8 / 9 },
    note: '점수는 성공률에 보정되지 않았고 53%/89%의 수치 크기가 아니라 방향만 검증한다.' };
}

export async function runHarness(options = {}) {
  const config = { top: options.top === undefined ? DEFAULT_TOP : options.top,
    outputParent: options.outputParent || DEFAULT_OUTPUT,
    blurSigma: options.blurSigma === undefined ? DEFAULT_BLUR_SIGMA : options.blurSigma };
  if (!Number.isInteger(config.top) || config.top < 1 || config.top > MAX_TOP) {
    throw new RangeError('top 범위 오류: ' + config.top);
  }
  const startedAt = new Date();
  const outputDir = await runDirectory(config.outputParent);
  const kernel = gaussianKernel(config.blurSigma);
  const bases = blurredFaceBases(kernel);
  console.log('TLcube 중앙 파인더 채점 하네스');
  console.log('19셀 x 3면=' + FACE_COUNT + ' face; faceSampleDisc 표본='
    + REFERENCE.points.length + ' (' + REFERENCE.samplesPerFace + '/face); 저해상도='
    + LOW_PIXELS_PER_CELL + ' px/cell; [미검증] blur sigma=' + config.blurSigma + ' px');
  console.log('출력: ' + outputDir + '\n');

  const bullseye = scoreBaseline('현행 불스아이', 'bullseye', bullseyeEvaluator(), kernel, bases);
  const centerQr = scoreBaseline('중앙 QR', 'center-qr', centerQrEvaluator(), kernel, bases);
  const baselines = [bullseye, centerQr];
  const validation = validateRuler(bullseye, centerQr);
  bullseye.png = path.join(outputDir, 'baseline-bullseye.png');
  centerQr.png = path.join(outputDir, 'baseline-center-qr.png');
  await writePng(baselineScene('bullseye'), bullseye.png);
  await writePng(baselineScene('center-qr'), centerQr.png);

  console.log('자가 검증 — 동일한 자로 잰 기준선');
  console.table(baselines.map((result) => resultRow(result, '기준')));
  console.log('실측 방향: 중앙 QR 8/9(89%) > 불스아이 9/17(53%)');
  console.log('회전 차이: 불스아이 ' + bullseye.metrics.rotation.minDifferenceCount + '/'
    + bullseye.metrics.rotation.sampleCount + '; 중앙 QR 최악 회전 '
    + centerQr.metrics.rotation.minDifferenceCount + '/' + centerQr.metrics.rotation.sampleCount);
  console.log('자가 검증: ' + (validation.passed ? '통과' : '실패') + '\n');

  let candidateCount = 0;
  let top = [];
  if (validation.passed) {
    const candidates = generateCandidates();
    candidateCount = candidates.length;
    console.log('구조화 후보 ' + candidateCount + '개 채점 중...');
    const ranked = candidates.map((candidate) => scoreBits(candidate, kernel, bases));
    ranked.sort((a, b) => b.total - a.total
      || b.metrics.rotation.score - a.metrics.rotation.score
      || b.metrics.dataDistinction.score - a.metrics.dataDistinction.score
      || a.id.localeCompare(b.id));
    top = ranked.slice(0, config.top);
    for (let i = 0; i < top.length; i += 1) {
      const fileName = String(i + 1).padStart(2, '0') + '-' + top[i].id + '.png';
      top[i].png = path.join(outputDir, fileName);
      await writePng(candidateScene(top[i].bits), top[i].png);
    }
    console.log('상위 후보 + 기준선');
    console.table([
      ...baselines.map((result) => resultRow(result, '기준')),
      ...top.map((result, index) => resultRow(result, index + 1)),
    ]);
    if (top.every((result) => result.metrics.dataDistinction.score === 100)) {
      console.warn('[미검증] 데이터 구별도 상계가 상위권에서 100점으로 포화됐다; 센서 허용오차 모델 전에는 이 축이 상위 후보끼리 순위를 가르지 못한다.');
    }
    console.log('상위 PNG');
    for (const result of top) console.log('- ' + result.id + ': ' + result.png);
  } else {
    console.error('자가 검증에 실패했다. 이 자로 후보를 고르지 않으며 후보 순위를 출력하지 않는다.');
  }

  const report = {
    meta: { generatedAt: startedAt.toISOString(), wallTimeMs: Date.now() - startedAt.getTime(),
      candidateCount, finderCells: CELLS.length, faces: FACE_COUNT,
      referenceSamples: REFERENCE.points.length, samplesPerFace: REFERENCE.samplesPerFace,
      lowPixelsPerCell: LOW_PIXELS_PER_CELL, areaSupersample: AREA_SUPERSAMPLE,
      blurSigmaPx: config.blurSigma, outputDir },
    rulerValidation: validation,
    baselines: baselines.map(publicResult),
    topCandidates: top.map(publicResult),
    limitations: [
      '[미검증] 가우시안 sigma와 4x 면적 서브샘플은 실기기 MTF 및 수렴 시험으로 보정되지 않았다.',
      '[미검증] 데이터 구별도는 19개 독립·균등 digit, 기본 팔레트, 선형 등방 블러를 가정한다.',
      '노이즈 없는 matched-filter 상계가 0이면 100점으로 포화되어 센서 허용오차 전에는 후보끼리 못 가른다.',
      '투시, 모아레, 색수차, 노출 클리핑, 주변 데이터 경계는 모델에 없다.',
      '검출기 무관 점수는 탐색 비용, 지역 극값 수, 실제 복호율을 직접 예측하지 않는다.',
      '실측 53%/89%는 기준선 순서 검증에만 쓰며 점수를 성공률로 보정하지 않는다.',
    ],
  };
  const reportPath = path.join(outputDir, 'scores.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log('\n점수 JSON: ' + reportPath);
  console.log('기준선 PNG: ' + bullseye.png);
  console.log('기준선 PNG: ' + centerQr.png);
  return report;
}

const isMain = Array.isArray(process.argv) && process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) help();
    else await runHarness(options);
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
