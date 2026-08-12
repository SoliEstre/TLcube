#!/usr/bin/env node

/**
 * finder-score.mjs — 중앙 19셀 파인더 후보의 검출기 무관 채점 하네스
 *
 * 실행: node tools/finder-score.mjs [--top N] [--per-family N] [--output DIR] [--blur-sigma PX]
 *        node tools/finder-score.mjs --masks-file candidates.json [--output DIR]
 *
 * 후보를 채점하기 전에 현행 불스아이와 중앙 QR을 같은 여섯 지표로 잰다.
 * 알려진 실측 방향(중앙 QR 89% > 불스아이 53%)을 재현하지 못하면 후보를
 * 생성하거나 순위를 내지 않는다. 점수는 성공률 예측값이 아니다.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  AXIAL_DIRECTIONS, CENTER_SPACING_COEFF, FACE_AREA_COEFF, FACES, axialToPixel, codeBounds,
  facePolygon, faceSampleDisc, hexDistance, layoutForRegion, pixelToAxial, regionCells,
} from '../src/hexgrid.js';
import { maxSafeRadius, profileAt } from '../src/bullseye.js';
import { encode } from '../src/encode.js';
import { FINDER_PATTERNS } from '../src/finder-patterns.js';
import { digitToRanks } from '../src/lehmer.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset, presetLuminances,
} from '../src/luminance.js';
import { rasterToPng } from '../src/png.js';
import { TL_READER_URL } from '../src/qr.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { verifyRaster } from '../src/verify.js';

const FINDER_RADIUS = 2;
const CELLS = Object.freeze(regionCells(FINDER_RADIUS));
const FACE_COUNT = CELLS.length * FACES.length;
const UNIT_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });
const BOUNDS = Object.freeze(codeBounds(FINDER_RADIUS, UNIT_LAYOUT));

// 실측 복호 하한. 셀 폭은 인접 중심 간격 sqrt(3)*size로 정의한다.
const LOW_PIXELS_PER_CELL = 9;
const LOW_PPU = LOW_PIXELS_PER_CELL / CENTER_SPACING_COEFF;
const CELL_WIDTH = CENTER_SPACING_COEFF;
// 파인더가 코드 중심을 정의한다면 켜진 면의 시각 질량중심도 중앙 셀의 Voronoi 경계 안에
// 있어야 한다. 인접 셀 중심까지가 1 cell width이므로 그 경계는 절반인 0.5c다. 이를
// 넘으면 가장 가까운 셀 중심이 진짜 중앙이 아닌 쪽으로 넘어가므로 후보 자격과 모순된다.
// 이 값은 점수 가중치가 아니라 통과/탈락의 기하학적 게이트다.
const CENTER_BALANCE_LIMIT_CELLS = 1 / 2;

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
const DEFAULT_PER_FAMILY = 1;
const MAX_PER_FAMILY = 20;
const PRIORITY_FAMILIES = Object.freeze(['face-swirl', 'gap-ring', 'pinwheel', 'flower']);
// rhombille 이 갖는 유일한 비자명 회전 대칭은 120도/240도 뿐이다 (src/placement.js §회전,
// 디코더 orientation 가설도 {0|1|2} 셋뿐). 60/180/300도는 T/L/R 분할을 다른 대각 분할로
// 보내므로 «코드를 그렇게 다시 읽는» 해석 자체가 존재하지 않는다 — 실재하지 않는 모호성이다.
// 여기에 그 셋을 넣으면 최솟값이 가짜 각도에 걸려 멀쩡한 후보를 떨어뜨린다.
const ROTATIONS = Object.freeze([2, 4]);
const FACE_BITS = Object.freeze({ T: 1, L: 2, R: 4 });
const SINGLE_FACE_MASKS = Object.freeze([1, 2, 4]);
const NONZERO_MASKS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
const FACE_CYCLES = Object.freeze([
  SINGLE_FACE_MASKS,
  Object.freeze([6, 5, 3]),
]);
const PNG_CELL_SIZE = 64;
const PNG_MARGIN = 24;
const PNG_SUPERSAMPLE = 4;
const TYPE_O_PAYLOAD = 'https://tl.estre.so/finder-lab';
const TYPE_O_VERSION = 3;
const TYPE_O_ECC_LEVEL = 'M';
const TYPE_O_PIXELS_PER_UNIT = 18;
const TYPE_O_SUPERSAMPLE = 2;
const FACE_EDGE_COUNT = 4;
// test/ygrid.test.js의 「면 경계 인접성」이 공유 꼭짓점을 비교할 때 쓰는 EPS를 재사용한다.
const SHARED_EDGE_EPS = 1e-9;
const COMPOSITE_AXES = Object.freeze([
  'rotation', 'lowResolution', 'localization', 'dataDistinction',
  'structuralSimplicity', 'defectConcentration',
]);
const LEGACY_AXES = Object.freeze([
  'rotation', 'lowResolution', 'localization', 'dataDistinction',
]);

// [미검증] 19셀에서 미감 후보 공간을 훑기 위한 규칙 파라미터 표본이다.
// 검출 실측으로 보정한 값이 아니며, 결과 JSON에 그대로 남긴다.
const RULE_SWEEP = Object.freeze({
  radialLengths: Object.freeze([2.8, 3.7]),
  widthFractions: Object.freeze([0.42, 0.64]),
  twistFractions: Object.freeze([0.35, 0.7]),
  phases: Object.freeze([0, 0.5]),
});

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
const TYPE_O_PRESET = getPreset(DEFAULT_PRESET);
const TYPE_O_PALETTE = Object.freeze({
  background: TYPE_O_PRESET.background,
  levels: TYPE_O_PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function assert(condition, message) {
  if (!condition) throw new Error('finder-score 자기검사 실패: ' + message);
}
function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }
function cellKey(q, r) { return q + ',' + r; }

const CELL_INDEX = new Map(CELLS.map((cell, index) => [cellKey(cell.q, cell.r), index]));

function cellMasksToBits(cellMasks, label) {
  if (!Array.isArray(cellMasks) || cellMasks.length !== CELLS.length) {
    throw new RangeError(label + ': cellMasks 는 ' + CELLS.length + '개여야 한다');
  }
  const bits = new Uint8Array(FACE_COUNT);
  for (let ci = 0; ci < cellMasks.length; ci += 1) {
    const mask = cellMasks[ci];
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
      throw new RangeError(label + ': cellMasks[' + ci + ']는 0..7 정수여야 한다: ' + mask);
    }
    for (let fi = 0; fi < FACES.length; fi += 1) {
      bits[ci * FACES.length + fi] = (mask >> fi) & 1;
    }
  }
  if (!cellMasks.some((mask) => mask !== 0)) {
    throw new RangeError(label + ': 켜진 면이 하나 이상이어야 한다');
  }
  return bits;
}

function maskInputEntries(value) {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value !== 'object') {
    throw new TypeError('마스크 JSON은 이름→배열 객체, 후보 객체 배열, 또는 {candidates:[...]}여야 한다');
  }
  if (Object.hasOwn(value, 'candidates')) {
    if (!Array.isArray(value.candidates)) {
      throw new TypeError('masks.candidates 는 배열이어야 한다');
    }
    return value.candidates;
  }
  if (Object.hasOwn(value, 'cellMasks') || Object.hasOwn(value, 'masks')) return [value];
  return Object.entries(value).map(([label, entry]) => (
    Array.isArray(entry)
      ? { id: label, name: label, cellMasks: entry }
      : { ...entry, id: entry && entry.id === undefined ? label : entry.id,
        name: entry && entry.name === undefined ? label : entry.name }
  ));
}

/**
 * 파인더 에디터 출력용 상시 입력 경로.
 *
 * 지원 JSON:
 *   { "bird": [0, ... 19개] }
 *   [{ "name": "bird", "cellMasks": [0, ... 19개] }]
 *   { "candidates": [{ "id": "bird", "name": "Bird", "masks": [...] }] }
 */
export function parseFinderMaskCandidates(input) {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (error) {
      throw new SyntaxError('마스크 JSON 파싱 실패: ' + error.message);
    }
  }
  const entries = maskInputEntries(value);
  if (entries.length === 0) throw new RangeError('마스크 후보가 하나 이상 필요하다');
  const reserved = new Set(['bullseye', 'center-qr', ...FINDER_PATTERNS.map((entry) => entry.id)]);
  const seen = new Set();
  return Object.freeze(entries.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('마스크 후보 #' + (index + 1) + '는 객체여야 한다');
    }
    const rawId = entry.id === undefined ? entry.name : entry.id;
    const rawName = entry.name === undefined ? rawId : entry.name;
    if (typeof rawId !== 'string' || rawId.trim() === '') {
      throw new TypeError('마스크 후보 #' + (index + 1) + '의 id 또는 name이 필요하다');
    }
    if (typeof rawName !== 'string' || rawName.trim() === '') {
      throw new TypeError(rawId + ': name은 비어 있지 않은 문자열이어야 한다');
    }
    const id = rawId.trim();
    const name = rawName.trim();
    if (reserved.has(id)) throw new RangeError(id + ': 기존 이름과 충돌한다');
    if (seen.has(id)) throw new RangeError(id + ': 마스크 후보 id가 중복됐다');
    seen.add(id);
    const cellMasks = entry.cellMasks === undefined ? entry.masks : entry.cellMasks;
    const bits = cellMasksToBits(cellMasks, id);
    return Object.freeze({
      id,
      name,
      family: 'manual',
      params: Object.freeze({ ...(entry.params || {}), source: 'mask-input' }),
      cellMasks: Object.freeze([...cellMasks]),
      bits,
    });
  }));
}

export async function loadFinderMaskCandidates(options = {}) {
  const inline = options.masks;
  const filePath = options.masksFile;
  if (inline !== undefined && filePath !== undefined) {
    throw new RangeError('--masks와 --masks-file은 함께 쓸 수 없다');
  }
  if (inline === undefined && filePath === undefined) return Object.freeze([]);
  if (filePath !== undefined) {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new TypeError('--masks-file 뒤에 경로가 필요하다');
    }
    return parseFinderMaskCandidates(await fs.readFile(filePath, 'utf8'));
  }
  return parseFinderMaskCandidates(inline);
}

function balancedMaskSequences(repeats) {
  const sequences = [];
  const targetLength = repeats * 3;
  const counts = [repeats, repeats, repeats];
  const build = (prefix) => {
    if (prefix.length === targetLength) {
      sequences.push(Object.freeze(prefix));
      return;
    }
    for (let maskIndex = 0; maskIndex < counts.length; maskIndex += 1) {
      if (counts[maskIndex] === 0) continue;
      counts[maskIndex] -= 1;
      build([...prefix, maskIndex]);
      counts[maskIndex] += 1;
    }
  };
  build([]);
  return Object.freeze(sequences);
}
const C2_INNER_SEQUENCES = balancedMaskSequences(1);
const C2_OUTER_SEQUENCES = balancedMaskSequences(2);
const C2_PAIR_INDEX = new Map();
for (const ring of [1, 2]) {
  const representatives = CELLS.filter((cell) =>
    hexDistance(cell.q, cell.r) === ring
      && (cell.q > 0 || (cell.q === 0 && cell.r > 0)))
    .sort((a, b) => {
      const pa = axialToPixel(a.q, a.r, UNIT_LAYOUT);
      const pb = axialToPixel(b.q, b.r, UNIT_LAYOUT);
      return Math.atan2(pa.y, pa.x) - Math.atan2(pb.y, pb.x);
    });
  for (let pairIndex = 0; pairIndex < representatives.length; pairIndex += 1) {
    const cell = representatives[pairIndex];
    const descriptor = Object.freeze({ ring, pairIndex });
    C2_PAIR_INDEX.set(cellKey(cell.q, cell.r), descriptor);
    C2_PAIR_INDEX.set(cellKey(-cell.q, -cell.r), descriptor);
  }
}
assert(C2_INNER_SEQUENCES.length === 6, 'C2 ring-1 균형 순열 수 불일치');
assert(C2_OUTER_SEQUENCES.length === 90, 'C2 ring-2 균형 순열 수 불일치');
assert(C2_PAIR_INDEX.size === CELLS.length - 1, 'C2 반대 셀 짝 인덱스 누락');
const FACE_POLYGONS = CELLS.map((cell) =>
  FACES.map((face) => facePolygon(cell.q, cell.r, face, UNIT_LAYOUT)));

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < SHARED_EDGE_EPS && Math.abs(a.y - b.y) < SHARED_EDGE_EPS;
}
function sharedVertexCount(a, b) {
  let shared = 0;
  for (const pa of a) for (const pb of b) if (samePoint(pa, pb)) shared += 1;
  return shared;
}
function buildFaceTopology() {
  const polygons = FACE_POLYGONS.flat();
  const neighbors = Array.from({ length: polygons.length }, () => []);
  for (let a = 0; a < polygons.length; a += 1) {
    for (let b = a + 1; b < polygons.length; b += 1) {
      // 기존 면 경계 테스트와 같은 규약: 꼭짓점 2개를 공유할 때만 변 인접이다.
      if (sharedVertexCount(polygons[a], polygons[b]) !== 2) continue;
      neighbors[a].push(b);
      neighbors[b].push(a);
    }
  }
  const internalEdges = neighbors.reduce((sum, list) => sum + list.length, 0) / 2;
  const outerEdges = FACE_EDGE_COUNT * FACE_COUNT - 2 * internalEdges;
  return Object.freeze({
    neighbors: Object.freeze(neighbors.map((list) => Object.freeze(list))),
    internalEdges,
    outerEdges,
  });
}
const FACE_TOPOLOGY = buildFaceTopology();

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
const FACE_GEOMETRY = Object.freeze(FACE_POLYGONS.flatMap((polygons, ci) =>
  polygons.map((polygon, fi) => {
    const x = polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length;
    const y = polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length;
    return Object.freeze({ index: ci * FACES.length + fi, ci, fi, face: FACES[fi],
      cell: CELLS[ci], x, y, radius: Math.hypot(x, y), angle: Math.atan2(y, x) });
  })));
const MAX_FACE_RADIUS = Math.max(...FACE_GEOMETRY.map((face) => face.radius));

function centerBalanceMetric(bits) {
  let weightedX = 0;
  let weightedY = 0;
  let totalArea = 0;
  let onFaces = 0;
  for (const face of FACE_GEOMETRY) {
    if (!bits[face.index]) continue;
    // 모든 rhombille 면은 합동이지만, 정의를 흐리지 않도록 실제 면적 가중치로 적분한다.
    weightedX += face.x * FACE_AREA_COEFF;
    weightedY += face.y * FACE_AREA_COEFF;
    totalArea += FACE_AREA_COEFF;
    onFaces += 1;
  }
  assert(totalArea > 0, '중심 균형: 켜진 면이 없음');
  const centroidX = weightedX / totalArea;
  const centroidY = weightedY / totalArea;
  const offset = Math.hypot(centroidX, centroidY);
  const offsetCells = offset / CELL_WIDTH;
  return { passed: offsetCells <= CENTER_BALANCE_LIMIT_CELLS,
    offsetCells, offset, centroidX, centroidY, onFaces, totalArea,
    limitCells: CENTER_BALANCE_LIMIT_CELLS };
}
// rhombille T/L/R 분할은 120도 회전에서만 면→면 순열이다. 60/180/300도는
// 다른 대각 분할로 넘어가므로 억지 면 순열을 만들지 않고 기존 표본 사상을 쓴다.
const ROTATED_FACE_INDEX_MAPS = new Map([2, 4].map((steps) => {
  const map = new Int16Array(FACE_COUNT);
  for (const face of FACE_GEOMETRY) {
    const point = rotatePoint(face, -steps);
    map[face.index] = faceIndexAt(point.x, point.y);
  }
  assert([...map].every((index) => index >= 0), steps * 60 + '도 면 회전 사상 누락');
  assert(new Set(map).size === FACE_COUNT, steps * 60 + '도 면 회전 사상이 순열이 아님');
  return [steps, map];
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
 * 1. 회전 유일성: 실재하는 모호성(120도/240도)에서 달라진 RMS의 최솟값.
 * 이진 서명에서 RMS^2은 달라진 표본 비율이다. 한 회전이라도 같으면 0점이고,
 * 반지름만의 함수인 동심원은 구조적으로 정확히 0점이다.
 * 180도 대칭은 여기서 감점되지 않는다 — rhombille 의 대칭이 아니라서 그 해석이 없다.
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
function componentSizes(active) {
  const seen = new Uint8Array(FACE_COUNT);
  const sizes = [];
  for (let start = 0; start < FACE_COUNT; start += 1) {
    if (!active[start] || seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const current = stack.pop();
      size += 1;
      for (const next of FACE_TOPOLOGY.neighbors[current]) {
        if (active[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);
  return sizes;
}
function stateTopology(bits, value) {
  const active = Uint8Array.from(bits, (bit) => bit === value ? 1 : 0);
  const count = active.reduce((sum, bit) => sum + bit, 0);
  const components = componentSizes(active);
  let perimeterEdges = 0;
  for (let index = 0; index < FACE_COUNT; index += 1) {
    if (!active[index]) continue;
    let sameNeighbors = 0;
    for (const neighbor of FACE_TOPOLOGY.neighbors[index]) {
      if (active[neighbor]) sameNeighbors += 1;
    }
    perimeterEdges += FACE_EDGE_COUNT - sameNeighbors;
  }
  return {
    faceCount: count,
    componentCount: components.length,
    componentSizes: components,
    perimeterEdges,
    perimeterAreaRatio: count === 0 ? Infinity : perimeterEdges / (count * FACE_AREA_COEFF),
  };
}

/**
 * 5. 구조 단순성: 켜진/꺼진 면을 같은 공유-변 그래프에서 각각 성분 분해한다.
 * 성분 점수는 가능한 총 성분 수 2..FACE_COUNT, 둘레 점수는 고정 외곽 +
 * 최소 한 절단변 .. 모든 내부변 절단이라는 기하학적 범위로 정규화한다.
 * 두 하위 점수의 동일 가중 기하평균은 [미검증]이다.
 */
function structuralSimplicityMetric(bits) {
  const on = stateTopology(bits, 1);
  const off = stateTopology(bits, 0);
  if (on.faceCount === 0 || off.faceCount === 0) {
    return { score: 0, componentScore: 0, perimeterScore: 0, on, off };
  }
  const totalComponents = on.componentCount + off.componentCount;
  const componentScore = 100 * clamp(
    (FACE_COUNT - totalComponents) / (FACE_COUNT - 2), 0, 1,
  );
  const totalPerimeterEdges = on.perimeterEdges + off.perimeterEdges;
  const minimumPerimeter = FACE_TOPOLOGY.outerEdges + 2;
  const maximumPerimeter = FACE_EDGE_COUNT * FACE_COUNT;
  const perimeterScore = 100 * clamp(
    (maximumPerimeter - totalPerimeterEdges) / (maximumPerimeter - minimumPerimeter), 0, 1,
  );
  return {
    score: Math.sqrt(componentScore * perimeterScore),
    componentScore,
    perimeterScore,
    totalComponents,
    totalPerimeterEdges,
    totalPerimeterAreaRatio: totalPerimeterEdges / (FACE_COUNT * FACE_AREA_COEFF),
    on,
    off,
  };
}
function weightedComponents(weights) {
  const active = Uint8Array.from(weights, (weight) => weight > 0 ? 1 : 0);
  const seen = new Uint8Array(FACE_COUNT);
  const components = [];
  for (let start = 0; start < FACE_COUNT; start += 1) {
    if (!active[start] || seen[start]) continue;
    let weight = 0;
    const faceIndices = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const current = stack.pop();
      weight += weights[current];
      faceIndices.push(current);
      for (const next of FACE_TOPOLOGY.neighbors[current]) {
        if (active[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    let perimeterEdges = 0;
    for (const index of faceIndices) {
      let activeNeighbors = 0;
      for (const neighbor of FACE_TOPOLOGY.neighbors[index]) {
        if (active[neighbor]) activeNeighbors += 1;
      }
      perimeterEdges += FACE_EDGE_COUNT - activeNeighbors;
    }
    const area = faceIndices.length * FACE_AREA_COEFF;
    const compactness = clamp(4 * Math.PI * area / (perimeterEdges ** 2), 0, 1);
    components.push({ weight, faces: faceIndices.length, perimeterEdges, compactness });
  }
  components.sort((a, b) => b.weight - a.weight || b.faces - a.faces);
  return components;
}

/**
 * 6. 결손 집중도: 회전 축이 고른 최선(가장 덜 다른) 회전의 표본 차이를
 * 소유 면에 누적하고 공유-변 그래프에서 가중 성분을 구한다.
 * sum((componentWeight / differenceSamples)^2)는 임의의 두 결손 표본이 같은
 * 연결 영역에 속할 확률(HHI)이다. 각 영역의 4*pi*A/P^2 등주 compactness를
 * 표본 비중으로 평균해 가느다란 다리로 이어진 잡음을 막는다. 등주비는 유사 도형의
 * 크기 배율에 불변이며, 결손 총량은 HHI에서 상쇄된다. 0표본이면 0점이다.
 */
function defectConcentrationMetric(clean, rotated, worstDegrees) {
  const chosen = rotated[ROTATIONS.indexOf(worstDegrees / 60)];
  assert(chosen !== undefined, '결손 집중도: 회전 축이 고른 각도가 ROTATIONS 밖 — ' + worstDegrees);
  const faceWeights = new Uint16Array(FACE_COUNT);
  let differenceSamples = 0;
  for (let i = 0; i < clean.length; i += 1) {
    if (clean[i] === chosen[i]) continue;
    faceWeights[REFERENCE.points[i].ownerFaceIndex] += 1;
    differenceSamples += 1;
  }
  if (differenceSamples === 0) {
    return { score: 0, hhi: 0, differenceSamples: 0, differenceFaces: 0,
      componentCount: 0, componentWeights: [], componentFaceSizes: [],
      largestComponentShare: 0, worstDegrees };
  }
  const components = weightedComponents(faceWeights);
  const hhi = components.reduce((sum, component) =>
    sum + (component.weight / differenceSamples) ** 2, 0);
  const isoperimetricCompactness = components.reduce((sum, component) =>
    sum + (component.weight / differenceSamples) * component.compactness, 0);
  const differenceFaces = faceWeights.reduce((sum, weight) => sum + (weight > 0 ? 1 : 0), 0);
  return { score: 100 * hhi * isoperimetricCompactness, hhi,
    isoperimetricCompactness, differenceSamples, differenceFaces,
    componentCount: components.length,
    componentWeights: components.map((component) => component.weight),
    componentFaceSizes: components.map((component) => component.faces),
    componentPerimeterEdges: components.map((component) => component.perimeterEdges),
    componentCompactness: components.map((component) => component.compactness),
    largestComponentShare: components[0].weight / differenceSamples, worstDegrees };
}
function faceProjection(signature) {
  const sums = new Float64Array(FACE_COUNT);
  const counts = new Uint16Array(FACE_COUNT);
  for (let i = 0; i < signature.length; i += 1) {
    const owner = REFERENCE.points[i].ownerFaceIndex;
    sums[owner] += signature[i];
    counts[owner] += 1;
  }
  const means = Float64Array.from(sums, (sum, index) => sum / counts[index]);
  const minimum = Math.min(...means);
  const maximum = Math.max(...means);
  const threshold = (minimum + maximum) / 2;
  const bits = Uint8Array.from(means, (mean) => maximum === minimum ? 0 : mean >= threshold ? 1 : 0);
  return { bits, minimum, maximum, threshold };
}

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
function composite(metrics, axes = COMPOSITE_AXES) {
  // [미검증] 축별 실측 보정 전이므로 가중치는 모두 1이다.
  const scores = axes.map((axis) => metrics[axis].score);
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
  const rotated = rotatedBitsSignatures(candidate.bits);
  const rotation = rotationMetric(clean, rotated);
  const metrics = {
    rotation,
    lowResolution: lowResolutionMetric(clean, blurred),
    localization: localizationMetric(lowRaster),
    dataDistinction: dataMetric(clean, blurred, bases),
    structuralSimplicity: structuralSimplicityMetric(candidate.bits),
    defectConcentration: defectConcentrationMetric(clean, rotated, rotation.worstDegrees),
  };
  return { ...candidate, metrics, legacyTotal: composite(metrics, LEGACY_AXES),
    total: composite(metrics) };
}
function scoreBaseline(name, kind, evaluate, kernel, bases, includeCenterBalance = false) {
  const clean = functionSignature(evaluate);
  const lowRaster = renderFunctionLow(evaluate, kernel);
  const blurred = lowSignature(lowRaster);
  const rotated = rotatedFunctionSignatures(evaluate);
  const rotation = rotationMetric(clean, rotated);
  const projection = faceProjection(clean);
  const structure = structuralSimplicityMetric(projection.bits);
  structure.faceProjection = {
    minimum: projection.minimum,
    maximum: projection.maximum,
    threshold: projection.threshold,
    note: '[미검증] 연속 기준선을 면 평균의 min/max 중점에서 이진화했다.',
  };
  const metrics = {
    rotation,
    lowResolution: lowResolutionMetric(clean, blurred),
    localization: localizationMetric(lowRaster),
    dataDistinction: dataMetric(clean, blurred, bases),
    structuralSimplicity: structure,
    defectConcentration: defectConcentrationMetric(clean, rotated, rotation.worstDegrees),
  };
  return { id: kind, name, family: 'baseline', kind, metrics,
    ...(includeCenterBalance ? { centerBalance: centerBalanceMetric(projection.bits) } : {}),
    legacyTotal: composite(metrics, LEGACY_AXES), total: composite(metrics) };
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
function bitsForFaces(pattern) {
  return Uint8Array.from(FACE_GEOMETRY, (face) => pattern(face) ? 1 : 0);
}
function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}
function polarArm(face, count, phase, twistFraction = 0, winding = 1) {
  const pitch = 2 * Math.PI / count;
  const adjusted = face.angle - phase * pitch
    - winding * twistFraction * pitch * (face.radius / MAX_FACE_RADIUS);
  const coordinate = positiveModulo(adjusted / pitch, 1);
  const distance = Math.min(coordinate, 1 - coordinate);
  const index = Math.floor(positiveModulo(adjusted / pitch + 0.5, count));
  return { distance, index };
}
function symmetricUnion(bits, rotationSteps) {
  const out = bits.slice();
  for (let index = 0; index < FACE_COUNT; index += 1) {
    for (const steps of rotationSteps) {
      if (bits[ROTATED_FACE_INDEX_MAPS.get(steps)[index]]) {
        out[index] = 1;
        break;
      }
    }
  }
  return out;
}
function applyCenterTreatment(bits, treatment) {
  const out = bits.slice();
  for (const face of FACE_GEOMETRY) {
    if (face.cell.q !== 0 || face.cell.r !== 0) continue;
    if (treatment === 'solid') out[face.index] = 1;
    else if (treatment === 'open') out[face.index] = 0;
    else if (treatment === 'offset') out[face.index] = face.face === 'R' ? 1 : 0;
    else throw new RangeError('중심 처리 오류: ' + treatment);
  }
  return out;
}
function pinwheelBits(params) {
  let bits = bitsForFaces((face) => {
    const arm = polarArm(face, params.blades, params.phase,
      params.twistFraction, params.winding);
    return face.radius <= params.length && arm.distance <= params.widthFraction / 2;
  });
  // C3 대칭 바탕은 표본 경계의 부동소수 우연과 무관하게 정확한 120도 대칭으로 만든다.
  if (params.blades === 3) bits = symmetricUnion(bits, [2, 4]);
  bits = applyCenterTreatment(bits, params.centerTreatment === 'offset' ? 'solid'
    : params.centerTreatment);
  if (params.breakMode === 'missing' || params.breakMode === 'short') {
    for (const face of FACE_GEOMETRY) {
      if (face.cell.q === 0 && face.cell.r === 0) continue;
      const arm = polarArm(face, params.blades, params.phase,
        params.twistFraction, params.winding);
      if (arm.index !== 0) continue;
      if (params.breakMode === 'missing'
        || face.radius > params.length * (1 / 2)) bits[face.index] = 0;
    }
  } else if (params.breakMode !== 'coprime' && params.breakMode !== 'symmetric') {
    throw new RangeError('바람개비 대칭 깨기 오류: ' + params.breakMode);
  }
  if (params.centerTreatment === 'offset') bits = applyCenterTreatment(bits, 'offset');
  return bits;
}
function flowerPetal(face, params, layer) {
  const layerPhase = params.phase + (layer === 0 ? 0 : 0.5);
  const arm = polarArm(face, params.petals, layerPhase);
  // [미검증] 두 번째 겹의 폭/길이 2/3와 중심 반경 0.75는 미감 표본값이다.
  const width = params.widthFraction * (layer === 0 ? 1 : 2 / 3);
  if (arm.distance > width / 2) return false;
  const coreRadius = 0.75;
  const extent = layer === 0 ? params.length : coreRadius + (params.length - coreRadius) * 2 / 3;
  const normalized = arm.distance / (width / 2);
  const radialLimit = coreRadius + (extent - coreRadius)
    * Math.cos(normalized * Math.PI / 2) ** 2;
  return face.radius <= radialLimit;
}
function flowerBits(params) {
  if (params.petals === 6) {
    // 모든 면을 켠 중심+ring-1 심과 여섯 axial ring-2 셀을 꽃잎으로 삼는다.
    // 셀 단위 C6라 60도에서 정확히 자기 자신이며, 육망성 외곽선은 만들지 않는다.
    let bits = bitsFor((cell) => {
      const ring = hexDistance(cell.q, cell.r);
      if (ring <= 1) return 7;
      if (ring === 2 && AXIAL_DIRECTIONS.some((direction) =>
        onDirectedRay(cell, direction))) return 7;
      return 0;
    });
    if (params.breakMode === 'missing' || params.breakMode === 'short') {
      for (const face of FACE_GEOMETRY) {
        if (!onDirectedRay(face.cell, AXIAL_DIRECTIONS[0])) continue;
        const ring = hexDistance(face.cell.q, face.cell.r);
        if (params.breakMode === 'missing' || ring === 2) bits[face.index] = 0;
      }
    } else if (params.breakMode !== 'symmetric') {
      throw new RangeError('C6 꽃 대칭 깨기 오류: ' + params.breakMode);
    }
    return applyCenterTreatment(bits, params.centerTreatment);
  }

  let bits = bitsForFaces((face) => {
    for (let layer = 0; layer < params.layers; layer += 1) {
      if (flowerPetal(face, params, layer)) return true;
    }
    return false;
  });
  bits = applyCenterTreatment(bits, params.centerTreatment);
  if (params.breakMode !== 'coprime') {
    throw new RangeError('C5/C7 꽃 대칭 깨기 오류: ' + params.breakMode);
  }
  return bits;
}
function gapRingBits(params) {
  return bitsForFaces((face) => {
    if (face.cell.q === 0 && face.cell.r === 0 && params.centerTreatment === 'solid') return true;
    if (face.radius < params.innerRadius || face.radius > params.outerRadius) return false;
    const gapAngle = params.gapDirection * Math.PI / 3;
    const delta = Math.abs(Math.atan2(Math.sin(face.angle - gapAngle),
      Math.cos(face.angle - gapAngle)));
    return delta > params.gapWidthFraction * Math.PI / 6;
  });
}

function cellPolarArm(cell, count, phase, twistFraction, winding) {
  const point = axialToPixel(cell.q, cell.r, UNIT_LAYOUT);
  return polarArm({ angle: Math.atan2(point.y, point.x), radius: Math.hypot(point.x, point.y) },
    count, phase, twistFraction, winding);
}

// 2/4개의 날개를 셀 단위로 켜면 반대편 셀이 언제나 함께 켜진다. rhombille 면 분할 자체는
// 180도 대칭이 아니므로 면을 억지로 회전시키지 않고, C2 대칭인 전체 육각 셀을 원자로 쓴다.
function pinwheelC2Bits(params) {
  return bitsFor((cell) => {
    if (cell.q === 0 && cell.r === 0) return 7;
    const point = axialToPixel(cell.q, cell.r, UNIT_LAYOUT);
    if (Math.hypot(point.x, point.y) > params.length) return 0;
    const arm = cellPolarArm(cell, params.blades, params.phase,
      params.twistFraction, params.winding);
    return arm.distance <= params.widthFraction / 2 ? 7 : 0;
  });
}

function flowerC2Bits(params) {
  const secondAxis = (params.axis + 1) % 3;
  const directions = params.petals === 2
    ? [params.axis, params.axis + 3]
    : [params.axis, secondAxis, params.axis + 3, secondAxis + 3];
  return bitsFor((cell) => {
    const ring = hexDistance(cell.q, cell.r);
    if (ring === 0 || (params.coreRing && ring === 1)) return 7;
    if (ring > params.petalLength) return 0;
    return directions.some((index) => onDirectedRay(cell, AXIAL_DIRECTIONS[index])) ? 7 : 0;
  });
}

function gapRingC2Bits(params) {
  const gapDirections = [
    AXIAL_DIRECTIONS[params.gapAxis],
    AXIAL_DIRECTIONS[params.gapAxis + 3],
  ];
  return bitsFor((cell) => {
    const ring = hexDistance(cell.q, cell.r);
    if (ring === 0) return params.centerTreatment === 'solid' ? 7 : 0;
    if (ring < params.innerRing || ring > params.outerRing) return 0;
    const inGap = gapDirections.some((direction) => onDirectedRay(cell, direction));
    if (inGap && (params.gapDepth === 'all' || ring === params.outerRing)) return 0;
    return 7;
  });
}

// 반대 셀은 같은 axis(0..2)와 같은 mask를 받아 외곽 면이 명시적인 180도 짝을 이룬다.
// 개별 마름모는 C2 격자 사상이 아니지만, 각 ring에서 T/L/R mask가 같은 횟수로 나타나
// 면 중심 오프셋의 합도 0이 된다. 따라서 전체 면적 가중 질량중심은 정확히 중앙이다.
function faceSwirlC2Bits(params) {
  return bitsFor((cell) => {
    const ring = hexDistance(cell.q, cell.r);
    if (ring === 0) return 7;
    if (params.ringMode === 'outer' && ring === 1) return 0;
    const descriptor = C2_PAIR_INDEX.get(cellKey(cell.q, cell.r));
    assert(descriptor !== undefined, 'C2 face-swirl 반대 셀 짝 누락: ' + cellKey(cell.q, cell.r));
    const inner = descriptor.ring === 1;
    const sequence = inner
      ? C2_INNER_SEQUENCES[params.innerSequence]
      : C2_OUTER_SEQUENCES[params.outerSequence];
    const cycle = FACE_CYCLES[inner ? params.innerCycle : params.outerCycle];
    return cycle[sequence[descriptor.pairIndex]];
  });
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
 * 비트마스크 무작위 난사 없이 짧은 규칙의 파라미터 공간을 열거한다.
 * 바람개비·꽃을 우선하고, 틈 링과 기존 ring/axis/ray-break/face-swirl을 비교군으로 둔다.
 */
function generateCandidates() {
  const candidates = [];
  const seenByFamily = new Map();
  const addBits = (id, family, params, bits) => {
    let on = 0;
    for (const bit of bits) on += bit;
    if (on === 0 || on === bits.length) return;
    const fingerprint = Array.from(bits).join('');
    if (!seenByFamily.has(family)) seenByFamily.set(family, new Set());
    if (seenByFamily.get(family).has(fingerprint)) return;
    seenByFamily.get(family).add(fingerprint);
    candidates.push(Object.freeze({ id, family, params: Object.freeze(params), bits }));
  };
  const add = (id, family, params, pattern) =>
    addBits(id, family, params, bitsFor(pattern));

  // 대칭 실패 증거판. 규칙 생성에서 먼저 넣어 같은 족의 중복 제거가 이름을 보존하게 한다.
  addBits('pinwheel-symmetric-c3', 'pinwheel', {
    blades: 3, length: 3.7, widthFraction: 0.64, twistFraction: 0.7,
    phase: 0, winding: 1, centerTreatment: 'solid',
    breakMode: 'symmetric', symmetryWitness: true, symmetryClass: 'C3',
  }, pinwheelBits({
    blades: 3, length: 3.7, widthFraction: 0.64, twistFraction: 0.7,
    phase: 0, winding: 1, centerTreatment: 'solid', breakMode: 'symmetric',
  }));
  addBits('flower-symmetric-c6', 'flower', {
    petals: 6, length: 3.7, widthFraction: 0.64, layers: 1,
    phase: 0, centerTreatment: 'solid',
    breakMode: 'symmetric', symmetryWitness: true, symmetryClass: 'C6',
  }, flowerBits({
    petals: 6, length: 3.7, widthFraction: 0.64, layers: 1,
    phase: 0, centerTreatment: 'solid', breakMode: 'symmetric',
  }));

  // C2 적극 대조군. 180도는 채점할 격자 orientation이 아니어서 감점되지 않지만,
  // 아래 네 판본은 켜진 질량을 반대편에 짝지어 중심 게이트를 정확히 통과한다.
  const pinwheelC2Witness = {
    blades: 2, length: 3.7, widthFraction: 0.64, twistFraction: 0.7,
    phase: 0, winding: 1, centerTreatment: 'solid', symmetryClass: 'C2',
    symmetryWitness: true,
  };
  addBits('pinwheel-symmetric-c2', 'pinwheel', pinwheelC2Witness,
    pinwheelC2Bits(pinwheelC2Witness));
  const flowerC2Witness = {
    petals: 2, axis: 0, petalLength: 2, coreRing: false,
    centerTreatment: 'solid', symmetryClass: 'C2', symmetryWitness: true,
  };
  addBits('flower-symmetric-c2', 'flower', flowerC2Witness,
    flowerC2Bits(flowerC2Witness));
  const gapRingC2Witness = {
    innerRing: 1, outerRing: 2, gapAxis: 0, gapDepth: 'all',
    centerTreatment: 'solid', symmetryClass: 'C2', symmetryWitness: true,
  };
  addBits('gap-ring-symmetric-c2', 'gap-ring', gapRingC2Witness,
    gapRingC2Bits(gapRingC2Witness));
  const faceSwirlC2Witness = {
    innerSequence: 0, outerSequence: 1, innerCycle: 0, outerCycle: 1,
    ringMode: 'both',
    centerTreatment: 'solid', symmetryClass: 'C2', symmetryWitness: true,
  };
  addBits('face-swirl-symmetric-c2', 'face-swirl', faceSwirlC2Witness,
    faceSwirlC2Bits(faceSwirlC2Witness));

  // C2 바람개비: 2/4장 날개를 전체 셀로 만들어 편심 없이 감김·폭을 훑는다.
  for (const blades of [2, 4]) {
    for (let li = 0; li < RULE_SWEEP.radialLengths.length; li += 1) {
      for (let wi = 0; wi < RULE_SWEEP.widthFractions.length; wi += 1) {
        for (let ti = 0; ti < RULE_SWEEP.twistFractions.length; ti += 1) {
          for (let pi = 0; pi < RULE_SWEEP.phases.length; pi += 1) {
            for (const winding of [-1, 1]) {
              const params = {
                blades,
                length: RULE_SWEEP.radialLengths[li],
                widthFraction: RULE_SWEEP.widthFractions[wi],
                twistFraction: RULE_SWEEP.twistFractions[ti],
                phase: RULE_SWEEP.phases[pi],
                winding,
                centerTreatment: 'solid',
                symmetryClass: 'C2',
              };
              addBits('pinwheel-c2-' + blades + '-' + li + wi + ti + pi + '-'
                + (winding > 0 ? 'cw' : 'ccw'), 'pinwheel', params, pinwheelC2Bits(params));
            }
          }
        }
      }
    }
  }

  // 최우선 1: 바람개비. C3은 날개 하나 전체/바깥 절반을 결손시키고,
  // C5는 6회 격자 회전과 서로소인 날개 수 자체로 대칭을 깬다.
  for (const blades of [3, 5]) {
    const breakModes = blades === 3 ? ['missing', 'short'] : ['coprime'];
    for (let li = 0; li < RULE_SWEEP.radialLengths.length; li += 1) {
      for (let wi = 0; wi < RULE_SWEEP.widthFractions.length; wi += 1) {
        for (let ti = 0; ti < RULE_SWEEP.twistFractions.length; ti += 1) {
          for (let pi = 0; pi < RULE_SWEEP.phases.length; pi += 1) {
            for (const winding of [-1, 1]) {
              for (const centerTreatment of ['solid', 'open', 'offset']) {
                for (const breakMode of breakModes) {
                  const params = {
                    blades,
                    length: RULE_SWEEP.radialLengths[li],
                    widthFraction: RULE_SWEEP.widthFractions[wi],
                    twistFraction: RULE_SWEEP.twistFractions[ti],
                    phase: RULE_SWEEP.phases[pi],
                    winding,
                    centerTreatment,
                    breakMode,
                  };
                  addBits('pinwheel-' + blades + '-' + li + wi + ti + pi + '-'
                    + (winding > 0 ? 'cw' : 'ccw') + '-' + breakMode + '-'
                    + centerTreatment, 'pinwheel', params, pinwheelBits(params));
                }
              }
            }
          }
        }
      }
    }
  }

  // 최우선 2: 꽃/꽃잎. C6은 꽃잎 한 장을 통째/바깥 절반 결손시키고,
  // C5/C7은 격자 회전수 6과 서로소인 꽃잎 수로 대칭을 깬다.
  for (const petals of [5, 6, 7]) {
    const breakModes = petals === 6 ? ['missing', 'short'] : ['coprime'];
    for (let li = 0; li < RULE_SWEEP.radialLengths.length; li += 1) {
      for (let wi = 0; wi < RULE_SWEEP.widthFractions.length; wi += 1) {
        for (const layers of [1, 2]) {
          for (let pi = 0; pi < RULE_SWEEP.phases.length; pi += 1) {
            for (const centerTreatment of ['solid', 'open', 'offset']) {
              for (const breakMode of breakModes) {
                const params = {
                  petals,
                  length: RULE_SWEEP.radialLengths[li],
                  widthFraction: RULE_SWEEP.widthFractions[wi],
                  layers,
                  phase: RULE_SWEEP.phases[pi],
                  centerTreatment,
                  breakMode,
                };
                addBits('flower-' + petals + '-' + li + wi + layers + pi + '-'
                  + breakMode + '-' + centerTreatment, 'flower', params, flowerBits(params));
              }
            }
          }
        }
      }
    }
  }

  // C2 꽃: 2/4장 꽃잎을 반대 axial ray 쌍으로 놓는다.
  for (const petals of [2, 4]) {
    for (let axis = 0; axis < 3; axis += 1) {
      for (const petalLength of [1, 2]) {
        for (const coreRing of [false, true]) {
          const params = {
            petals, axis, petalLength, coreRing,
            centerTreatment: 'solid', symmetryClass: 'C2',
          };
          addBits('flower-c2-' + petals + '-' + axis + '-' + petalLength + '-'
            + (coreRing ? 'core' : 'open'), 'flower', params, flowerC2Bits(params));
        }
      }
    }
  }

  // 부차 족: 틈 하나를 뭉쳐 뺀 링. 육망성 실루엣 규칙은 만들지 않는다.
  // [미검증] 틈 링 안쪽 반경 표본. 실기기/미감 보정 전이다.
  const gapInnerRadii = [1.0, 1.5];
  for (let ii = 0; ii < gapInnerRadii.length; ii += 1) {
    for (let oi = 0; oi < RULE_SWEEP.radialLengths.length; oi += 1) {
      for (let gapDirection = 0; gapDirection < 6; gapDirection += 1) {
        for (const gapWidthFraction of [0.5, 1]) {
          for (const centerTreatment of ['open', 'solid']) {
            const params = {
              innerRadius: gapInnerRadii[ii],
              outerRadius: RULE_SWEEP.radialLengths[oi],
              gapDirection,
              gapWidthFraction,
              centerTreatment,
            };
            addBits('gap-ring-' + ii + oi + '-' + gapDirection + '-'
              + String(gapWidthFraction).replace('.', '') + '-' + centerTreatment,
            'gap-ring', params, gapRingBits(params));
          }
        }
      }
    }
  }

  // C2 틈 링: 전체 셀 링에서 정확히 마주보는 두 ray를 함께 비운다.
  for (const innerRing of [1, 2]) {
    for (let gapAxis = 0; gapAxis < 3; gapAxis += 1) {
      for (const gapDepth of ['all', 'outer']) {
        for (const centerTreatment of ['open', 'solid']) {
          const params = {
            innerRing, outerRing: 2, gapAxis, gapDepth, centerTreatment,
            symmetryClass: 'C2',
          };
          addBits('gap-ring-c2-' + innerRing + '-' + gapAxis + '-' + gapDepth + '-'
            + centerTreatment, 'gap-ring', params, gapRingC2Bits(params));
        }
      }
    }
  }

  // 기존 비교 족은 삭제하지 않는다.
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
  for (let phase = 0; phase < 6; phase += 1) {
    for (let center = 0; center < 8; center += 1) {
      for (let cycle = 0; cycle < FACE_CYCLES.length; cycle += 1) {
        for (const invertOuter of [false, true]) {
          add('swirl-' + phase + '-' + center + cycle + (invertOuter ? 1 : 0),
            'face-swirl', { phase, center, cycle, invertOuter }, (cell) => {
              const ring = hexDistance(cell.q, cell.r);
              if (ring === 0) return center;
              let mask = FACE_CYCLES[cycle][(sectorIndex(cell) + phase) % 3];
              if (ring === 2 && invertOuter) mask ^= 7;
              return mask;
            });
        }
      }
    }
  }

  // C2 face-swirl은 중앙 육각을 채우고 ring-1/ring-2의 반대 셀에 같은 face mask를
  // 배정한다. 두 ring의 균형 순열과 face cycle을 독립적으로 훑어 이 족을 가장 넓게 본다.
  for (let innerSequence = 0; innerSequence < C2_INNER_SEQUENCES.length; innerSequence += 1) {
    for (let outerSequence = 0; outerSequence < C2_OUTER_SEQUENCES.length; outerSequence += 1) {
      for (let innerCycle = 0; innerCycle < FACE_CYCLES.length; innerCycle += 1) {
        for (let outerCycle = 0; outerCycle < FACE_CYCLES.length; outerCycle += 1) {
          for (const ringMode of ['both', 'outer']) {
            const params = {
              innerSequence, outerSequence, innerCycle, outerCycle, ringMode,
              centerTreatment: 'solid', symmetryClass: 'C2',
            };
            addBits('swirl-c2-' + innerSequence + '-' + outerSequence + '-'
              + innerCycle + outerCycle + '-' + ringMode,
            'face-swirl', params, faceSwirlC2Bits(params));
          }
        }
      }
      }
    }
  const familyCounts = Object.fromEntries([...seenByFamily]
    .map(([family, fingerprints]) => [family, fingerprints.size]));
  assert(familyCounts.pinwheel > 1, '바람개비 후보가 생성되지 않음');
  assert(familyCounts.flower > 1, '꽃 후보가 생성되지 않음');
  assert(candidates.length >= 500 && candidates.length <= 10000,
    '구조화 후보 수 예상 범위 이탈: ' + candidates.length);
  return candidates;
}

/**
 * 고정 파인더 패턴 재생성·회귀 테스트용 공개 진입점.
 *
 * 중심 균형 게이트를 적용하기 **전** 후보를 반환한다. 후보 채택은 사람의 실물 판단이
 * 상위 심급이므로, 게이트에서 탈락한 ID도 이 목록에서 정확히 다시 꺼낼 수 있어야 한다.
 */
export function generateFinderCandidates() {
  return generateCandidates();
}

/**
 * 고정 파인더 데이터와 UI가 하네스의 같은 자를 쓰는지 확인하는 순수 측정 진입점.
 *
 * 후보 자격 게이트를 적용하기 전의 전 후보를 채점하며, 검증되지 않은 종합점수는 일부러
 * 반환하지 않는다. 기준선의 중심 오프셋은 연속 도형을 구조 축과 같은 면 투영으로 이진화해
 * 잰 값이다.
 */
export function measureFinderPatternScores(candidates = generateCandidates(), options = {}) {
  if (!Array.isArray(candidates)) {
    throw new TypeError('파인더 후보 목록은 배열이어야 한다');
  }
  const blurSigma = options.blurSigma === undefined ? DEFAULT_BLUR_SIGMA : options.blurSigma;
  if (!Number.isFinite(blurSigma) || blurSigma <= 0) {
    throw new RangeError('blurSigma 는 0보다 큰 유한수여야 한다: ' + blurSigma);
  }
  const kernel = gaussianKernel(blurSigma);
  const bases = blurredFaceBases(kernel);
  const record = (result) => Object.freeze({
    id: result.id,
    centerOffsetCells: result.centerBalance.offsetCells,
    centerBalanceGatePassed: result.centerBalance.passed,
    scores: Object.freeze(Object.fromEntries(COMPOSITE_AXES.map(
      (axis) => [axis, result.metrics[axis].score],
    ))),
  });
  const baselines = [
    scoreBaseline('현행 불스아이', 'bullseye', bullseyeEvaluator(), kernel, bases, true),
    scoreBaseline('중앙 QR', 'center-qr', centerQrEvaluator(), kernel, bases, true),
  ];
  const measuredCandidates = candidates.map((candidate) => scoreBits({
    ...candidate,
    centerBalance: centerBalanceMetric(candidate.bits),
  }, kernel, bases));
  return Object.freeze({
    baselines: Object.freeze(baselines.map(record)),
    candidates: Object.freeze(measuredCandidates.map(record)),
  });
}
function scoreText(value) { return Number(value).toFixed(2); }
function resultRow(result, rank) {
  const structure = result.metrics.structuralSimplicity;
  const defect = result.metrics.defectConcentration;
  return { rank, name: result.name || result.id, family: result.family,
    offset: result.centerBalance ? scoreText(result.centerBalance.offsetCells) + 'c' : '—',
    rotation: scoreText(result.metrics.rotation.score),
    low9px: scoreText(result.metrics.lowResolution.score),
    localization: scoreText(result.metrics.localization.score),
    data: scoreText(result.metrics.dataDistinction.score),
    simplicity: scoreText(structure.score),
    defect: scoreText(defect.score),
    structureRaw: structure.totalComponents + 'c/' + scoreText(structure.totalPerimeterAreaRatio) + 'P/A',
    defectRaw: defect.componentCount + 'c/' + defect.differenceFaces + 'f',
    total: scoreText(result.total) };
}
function axisOnlyRow(result, group) {
  return {
    group,
    name: result.name || result.id,
    family: result.family,
    offset: result.centerBalance ? scoreText(result.centerBalance.offsetCells) + 'c' : '—',
    centerGate: result.centerBalance
      ? (result.centerBalance.passed ? '통과' : '탈락') : '—',
    rotation: scoreText(result.metrics.rotation.score),
    low9px: scoreText(result.metrics.lowResolution.score),
    localization: scoreText(result.metrics.localization.score),
    data: scoreText(result.metrics.dataDistinction.score),
    simplicity: scoreText(result.metrics.structuralSimplicity.score),
    defect: scoreText(result.metrics.defectConcentration.score),
  };
}
function rankResults(a, b) {
  return b.total - a.total
    || b.metrics.structuralSimplicity.score - a.metrics.structuralSimplicity.score
    || b.metrics.defectConcentration.score - a.metrics.defectConcentration.score
    || b.metrics.rotation.score - a.metrics.rotation.score
    || b.metrics.dataDistinction.score - a.metrics.dataDistinction.score
    || a.id.localeCompare(b.id);
}
function rankLegacy(a, b) {
  return b.legacyTotal - a.legacyTotal
    || b.metrics.rotation.score - a.metrics.rotation.score
    || b.metrics.dataDistinction.score - a.metrics.dataDistinction.score
    || a.id.localeCompare(b.id);
}
function axisSummary(results, axis) {
  const values = results.map((result) => result.metrics[axis].score);
  if (values.length === 0) return { count: 0, minimum: null, maximum: null,
    mean: null, standardDeviation: null, uniqueScoreCount: 0, saturated: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const uniqueScoreCount = new Set(values.map((value) => value.toPrecision(12))).size;
  return { count: values.length, minimum: Math.min(...values), maximum: Math.max(...values),
    mean, standardDeviation: Math.sqrt(variance), uniqueScoreCount,
    saturated: uniqueScoreCount === 1 };
}
function pearsonCorrelation(results, axisA, axisB) {
  if (results.length < 2) return null;
  const a = results.map((result) => result.metrics[axisA].score);
  const b = results.map((result) => result.metrics[axisB].score);
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let covariance = 0;
  let energyA = 0;
  let energyB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covariance += da * db;
    energyA += da * da;
    energyB += db * db;
  }
  return energyA === 0 || energyB === 0 ? null : covariance / Math.sqrt(energyA * energyB);
}
function separationAnalysis(results) {
  return {
    count: results.length,
    structuralSimplicity: axisSummary(results, 'structuralSimplicity'),
    defectConcentration: axisSummary(results, 'defectConcentration'),
    rotationDefectPearson: pearsonCorrelation(results, 'rotation', 'defectConcentration'),
  };
}
function timestamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function parseArgs(argv) {
  const options = { top: DEFAULT_TOP, perFamily: DEFAULT_PER_FAMILY,
    outputParent: DEFAULT_OUTPUT, blurSigma: DEFAULT_BLUR_SIGMA, help: false,
    masks: undefined, masksFile: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--help' || argv[i] === '-h') options.help = true;
    else if (argv[i] === '--top') options.top = Number(argv[++i]);
    else if (argv[i] === '--per-family') options.perFamily = Number(argv[++i]);
    else if (argv[i] === '--output') options.outputParent = path.resolve(argv[++i]);
    else if (argv[i] === '--blur-sigma') options.blurSigma = Number(argv[++i]);
    else if (argv[i] === '--masks') {
      if (argv[i + 1] === undefined) throw new RangeError('--masks 뒤에 JSON이 필요하다');
      options.masks = argv[++i];
    } else if (argv[i] === '--masks-file') {
      if (argv[i + 1] === undefined) throw new RangeError('--masks-file 뒤에 경로가 필요하다');
      options.masksFile = path.resolve(argv[++i]);
    }
    else throw new RangeError('알 수 없는 인자: ' + argv[i]);
  }
  if (options.masks !== undefined && options.masksFile !== undefined) {
    throw new RangeError('--masks와 --masks-file은 함께 쓸 수 없다');
  }
  if (!Number.isInteger(options.top) || options.top < 1 || options.top > MAX_TOP) {
    throw new RangeError('--top은 1..' + MAX_TOP + ' 정수여야 한다: ' + options.top);
  }
  if (!Number.isInteger(options.perFamily) || options.perFamily < 1
    || options.perFamily > MAX_PER_FAMILY) {
    throw new RangeError('--per-family는 1..' + MAX_PER_FAMILY + ' 정수여야 한다: '
      + options.perFamily);
  }
  if (!Number.isFinite(options.blurSigma) || options.blurSigma < 0) {
    throw new RangeError('--blur-sigma는 0 이상의 유한수여야 한다: ' + options.blurSigma);
  }
  return options;
}
function help() {
  console.log('사용법: node tools/finder-score.mjs [options]\n\n'
    + '  --top N           전체 상위 후보 수 (기본 ' + DEFAULT_TOP + ')\n'
    + '  --per-family N    네 우선 족별 PNG 수; 비교 족은 1개 (기본 '
      + DEFAULT_PER_FAMILY + ')\n'
    + '  --output DIR      실행별 출력 폴더의 상위 경로\n'
    + '  --blur-sigma PX   [미검증] 가우시안 sigma (기본 ' + DEFAULT_BLUR_SIGMA + ')\n'
    + '  --masks JSON      이름표 있는 임의 19셀 마스크 JSON\n'
    + '  --masks-file FILE 같은 JSON을 읽을 파일; --masks와 상호 배타\n'
    + '                    예: {\"bird\":[0, ..., 0]}\n'
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
function customTypeOScene(bits, encoded) {
  const scene = buildScene(encoded, {
    palette: TYPE_O_PALETTE,
    cellSize: 1,
    margin: 2,
  });
  const discCount = scene.shapes.filter((shape) => shape.kind === 'disc').length;
  assert(discCount === 6, 'Type O 기본 장면의 불스아이 disc 수가 6이 아님');
  const shapes = scene.shapes.filter((shape) => shape.kind !== 'disc');
  for (let ci = 0; ci < CELLS.length; ci += 1) {
    for (let fi = 0; fi < FACES.length; fi += 1) {
      shapes.push({
        kind: 'polygon',
        points: facePolygon(CELLS[ci].q, CELLS[ci].r, FACES[fi], scene.layout),
        color: bits[ci * FACES.length + fi]
          ? TYPE_O_PALETTE.bullseyeLight : TYPE_O_PALETTE.bullseyeDark,
      });
    }
  }
  return { ...scene, finderPatternId: 'manual', shapes };
}

function baselineScene(kind) {
  const centerQr = kind === 'center-qr';
  return buildScene({ k: FINDER_RADIUS, cellDigits: new Map(), centerQr },
    { palette: PALETTE, cellSize: PNG_CELL_SIZE, margin: PNG_MARGIN, centerQr,
      ...(centerQr ? { qrText: TL_READER_URL } : {}) });
}
async function writePng(scene, filePath, options = {}) {
  const raster = rasterize(scene, {
    pixelsPerUnit: options.pixelsPerUnit === undefined ? 1 : options.pixelsPerUnit,
    supersample: options.supersample === undefined ? PNG_SUPERSAMPLE : options.supersample,
  });
  let selfCheck = null;
  if (options.encoded !== undefined) {
    const check = verifyRaster(raster, scene, options.encoded);
    if (!check.ok) {
      throw new Error(options.id + ': Type O 전체 코드 자체검증 실패 '
        + JSON.stringify(check.mismatches));
    }
    selfCheck = { total: check.total, minDelta: check.minDelta };
  }
  const png = rasterToPng(raster);
  await fs.writeFile(filePath, png);
  return {
    width: raster.width,
    height: raster.height,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
    ...(selfCheck === null ? {} : { selfCheck }),
  };
}

function safeFileStem(id, index) {
  const safe = id.normalize('NFKD').replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'candidate-' + String(index + 1);
}


function shiftedShape(shape, dx, dy) {
  if (shape.kind === 'polygon') {
    return { ...shape, points: shape.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
  }
  if (shape.kind === 'disc') return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
  throw new RangeError('비교 장면의 알 수 없는 shape.kind: ' + shape.kind);
}
function horizontalScene(scenes, gap) {
  assert(scenes.length >= 2, '비교 장면은 2개 이상이어야 함');
  const height = Math.max(...scenes.map((scene) => scene.height));
  let width = gap * (scenes.length - 1);
  for (const scene of scenes) width += scene.width;
  const shapes = [];
  let offsetX = 0;
  for (const scene of scenes) {
    const offsetY = (height - scene.height) / 2;
    for (const shape of scene.shapes) shapes.push(shiftedShape(shape, offsetX, offsetY));
    offsetX += scene.width + gap;
  }
  return { width, height, background: scenes[0].background, shapes };
}
async function renderManualComparisons(results, outputDir, encoded) {
  const groups = new Map();
  for (const result of results) {
    const group = result.params && result.params.comparisonGroup;
    if (typeof group !== 'string' || group === '') continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(result);
  }
  const comparisonDir = path.join(outputDir, 'manual-comparisons');
  const files = [];
  for (const [group, unsorted] of groups) {
    if (unsorted.length < 2) continue;
    const ordered = [...unsorted].sort((a, b) =>
      (a.params.comparisonOrder || 0) - (b.params.comparisonOrder || 0)
      || a.id.localeCompare(b.id));
    await fs.mkdir(comparisonDir, { recursive: true });
    const stem = safeFileStem(group, files.length);
    const finderName = stem + '-finder-seed-h1-h2-h3.png';
    const typeOName = stem + '-type-o-seed-h1-h2-h3.png';
    const finder = await writePng(
      horizontalScene(ordered.map((result) => candidateScene(result.bits)), 0.5),
      path.join(comparisonDir, finderName),
    );
    const typeO = await writePng(
      horizontalScene(ordered.map((result) => customTypeOScene(result.bits, encoded)), 1),
      path.join(comparisonDir, typeOName),
      { pixelsPerUnit: TYPE_O_PIXELS_PER_UNIT, supersample: TYPE_O_SUPERSAMPLE },
    );
    files.push({
      group,
      columns: ordered.map((result) => ({
        id: result.id,
        label: result.params.comparisonLabel || result.id,
        order: result.params.comparisonOrder || 0,
      })),
      finder: { file: path.join('manual-comparisons', finderName), ...finder },
      typeO: { file: path.join('manual-comparisons', typeOName), ...typeO },
    });
  }
  return {
    purpose: 'seed | hamming-1 | hamming-2 | hamming-3 side-by-side comparisons',
    files,
  };
}

async function renderManualCandidates(results, outputDir) {
  const finderDir = path.join(outputDir, 'manual-finders');
  const typeODir = path.join(outputDir, 'manual-type-o');
  await fs.mkdir(finderDir, { recursive: true });
  await fs.mkdir(typeODir, { recursive: true });
  const encoded = encode(TYPE_O_PAYLOAD, {
    version: TYPE_O_VERSION,
    eccLevel: TYPE_O_ECC_LEVEL,
  });
  const files = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const prefix = String(index + 1).padStart(2, '0') + '-' + safeFileStem(result.id, index);
    const finderName = prefix + '-finder.png';
    const typeOName = prefix + '-type-o.png';
    const finderPath = path.join(finderDir, finderName);
    const typeOPath = path.join(typeODir, typeOName);
    const finder = await writePng(candidateScene(result.bits), finderPath);
    const typeO = await writePng(customTypeOScene(result.bits, encoded), typeOPath, {
      pixelsPerUnit: TYPE_O_PIXELS_PER_UNIT,
      supersample: TYPE_O_SUPERSAMPLE,
      encoded,
      id: result.id,
    });
    result.renders = {
      finder: { file: path.join('manual-finders', finderName), ...finder },
      typeO: { file: path.join('manual-type-o', typeOName), ...typeO },
    };
    files.push({
      id: result.id,
      name: result.name,
      cellMasks: result.cellMasks,
      centerOffsetCells: result.centerBalance.offsetCells,
      centerBalanceGatePassed: result.centerBalance.passed,
      ...result.renders,
    });
  }
  const comparisons = await renderManualComparisons(results, outputDir, encoded);
  const manifest = {
    purpose: 'manual finder candidates: isolated finder and full Type O code',
    payload: TYPE_O_PAYLOAD,
    version: TYPE_O_VERSION,
    eccLevel: TYPE_O_ECC_LEVEL,
    preset: DEFAULT_PRESET,
    pixelsPerUnit: TYPE_O_PIXELS_PER_UNIT,
    supersample: TYPE_O_SUPERSAMPLE,
    files,
    comparisons,
  };
  const manifestPath = path.join(outputDir, 'manual-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { ...manifest, file: manifestPath };
}
function publicResult(result) {
  return { id: result.id, name: result.name, family: result.family, params: result.params,
    centerOffsetCells: result.centerBalance ? result.centerBalance.offsetCells : null,
    centerBalance: result.centerBalance || null,
    scores: { rotation: result.metrics.rotation.score,
      lowResolution: result.metrics.lowResolution.score,
      localization: result.metrics.localization.score,
      dataDistinction: result.metrics.dataDistinction.score,
      structuralSimplicity: result.metrics.structuralSimplicity.score,
      defectConcentration: result.metrics.defectConcentration.score,
      legacyTotal: result.legacyTotal,
      total: result.total },
    diagnostics: result.metrics,
    png: result.png,
    familyPng: result.familyPng,
    witnessPng: result.witnessPng };
}
function publicAxisResult(result) {
  return {
    id: result.id,
    name: result.name,
    family: result.family,
    params: result.params,
    ...(result.cellMasks === undefined ? {} : { cellMasks: result.cellMasks }),
    centerOffsetCells: result.centerBalance ? result.centerBalance.offsetCells : null,
    centerBalanceGatePassed: result.centerBalance ? result.centerBalance.passed : null,
    scores: Object.fromEntries(COMPOSITE_AXES.map(
      (axis) => [axis, result.metrics[axis].score],
    )),
    diagnostics: result.metrics,
    ...(result.renders === undefined ? {} : { renders: result.renders }),
  };
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
  const config = {
    top: options.top === undefined ? DEFAULT_TOP : options.top,
    perFamily: options.perFamily === undefined ? DEFAULT_PER_FAMILY : options.perFamily,
    outputParent: options.outputParent || DEFAULT_OUTPUT,
    blurSigma: options.blurSigma === undefined ? DEFAULT_BLUR_SIGMA : options.blurSigma,
    maskCandidates: options.maskCandidates === undefined ? [] : options.maskCandidates,
  };
  if (!Number.isInteger(config.top) || config.top < 1 || config.top > MAX_TOP) {
    throw new RangeError('top 범위 오류: ' + config.top);
  }
  if (!Number.isInteger(config.perFamily) || config.perFamily < 1
    || config.perFamily > MAX_PER_FAMILY) {
    throw new RangeError('perFamily 범위 오류: ' + config.perFamily);
  }
  if (!Array.isArray(config.maskCandidates)
    || config.maskCandidates.some((candidate) =>
      !(candidate.bits instanceof Uint8Array) || candidate.bits.length !== FACE_COUNT)) {
    throw new TypeError('maskCandidates 는 parseFinderMaskCandidates()의 반환 배열이어야 한다');
  }
  const customMode = config.maskCandidates.length > 0;
  const startedAt = new Date();
  const outputDir = await runDirectory(config.outputParent);
  const kernel = gaussianKernel(config.blurSigma);
  const bases = blurredFaceBases(kernel);
  console.log('TLcube 중앙 파인더 채점 하네스');
  console.log('19셀 x 3면=' + FACE_COUNT + ' face; 공유-변 그래프='
    + FACE_TOPOLOGY.internalEdges + ' internal/' + FACE_TOPOLOGY.outerEdges + ' outer edge');
  console.log('faceSampleDisc 표본=' + REFERENCE.points.length + ' ('
    + REFERENCE.samplesPerFace + '/face); 저해상도=' + LOW_PIXELS_PER_CELL
    + ' px/cell; [미검증] blur sigma=' + config.blurSigma + ' px');
  console.log(customMode
    ? '[미검증] 임의 마스크 모드는 종합점수를 표시하지 않고 6축 원점수만 비교한다.'
    : '[미검증] 6축 종합은 동일 가중 기하평균이며 축별 원점수를 함께 읽어야 한다.');
  console.log('출력: ' + outputDir);
  console.log('');

  const bullseye = scoreBaseline('현행 불스아이', 'bullseye', bullseyeEvaluator(), kernel, bases);
  const centerQr = scoreBaseline('중앙 QR', 'center-qr', centerQrEvaluator(), kernel, bases);
  const baselines = [bullseye, centerQr];
  const validation = validateRuler(bullseye, centerQr);
  bullseye.png = path.join(outputDir, 'baseline-bullseye.png');
  centerQr.png = path.join(outputDir, 'baseline-center-qr.png');
  await writePng(baselineScene('bullseye'), bullseye.png);
  await writePng(baselineScene('center-qr'), centerQr.png);

  console.log('자가 검증 — 동일한 자로 잰 기준선');
  console.table(baselines.map((result) => customMode
    ? axisOnlyRow(result, '기준선') : resultRow(result, '기준')));
  console.log('실측 방향: 중앙 QR 8/9(89%) > 불스아이 9/17(53%)');
  console.log('회전 차이: 불스아이 ' + bullseye.metrics.rotation.minDifferenceCount + '/'
    + bullseye.metrics.rotation.sampleCount + '; 중앙 QR 최악 회전 '
    + centerQr.metrics.rotation.minDifferenceCount + '/' + centerQr.metrics.rotation.sampleCount);
  console.log('자가 검증: ' + (validation.passed ? '통과' : '실패'));
  console.log('');

  let candidateCount = 0;
  let generatedCandidateCount = 0;
  let familyCounts = {};
  let familyGeneratedCounts = {};
  let centerGateRejectedByFamily = {};
  let top = [];
  let topByFamily = {};
  let symmetryWitnesses = [];
  let centerGatePassedCount = 0;
  let baselineComparison = [];
  let customComparison = null;
  let analysis = {
    selectedTop: separationAnalysis([]),
    legacyFourAxisTop: separationAnalysis([]),
    note: 'rotationDefectPearson은 회전 원점수와 결손 집중도 원점수의 Pearson r이다.',
  };
  if (validation.passed && customMode) {
    baselineComparison = [
      scoreBaseline('현행 불스아이', 'bullseye', bullseyeEvaluator(), kernel, bases, true),
      scoreBaseline('중앙 QR', 'center-qr', centerQrEvaluator(), kernel, bases, true),
    ];
    const fixedComparison = FINDER_PATTERNS.map((pattern) => {
      const bits = cellMasksToBits(pattern.cellMasks, pattern.id);
      return scoreBits({
        id: pattern.id,
        name: pattern.name,
        family: pattern.family,
        params: pattern.params,
        cellMasks: pattern.cellMasks,
        bits,
        centerBalance: centerBalanceMetric(bits),
      }, kernel, bases);
    });
    const manualResults = config.maskCandidates.map((candidate) => scoreBits({
      ...candidate,
      centerBalance: centerBalanceMetric(candidate.bits),
    }, kernel, bases));
    generatedCandidateCount = manualResults.length;
    candidateCount = manualResults.length;
    centerGatePassedCount = manualResults.filter((result) => result.centerBalance.passed).length;
    familyGeneratedCounts = { manual: manualResults.length };
    familyCounts = { manual: manualResults.length };
    centerGateRejectedByFamily = {
      manual: manualResults.length - centerGatePassedCount,
    };
    const renderManifest = await renderManualCandidates(manualResults, outputDir);
    const comparisonResults = [
      ...baselineComparison,
      ...fixedComparison,
      ...manualResults,
    ];
    console.log('기준선 2종 + 고정 11종 + 임의 마스크 — 6축 원점수');
    console.log('중심 균형 <= ' + CENTER_BALANCE_LIMIT_CELLS.toFixed(2)
      + 'c는 표시 전용이며 임의 마스크를 탈락시키지 않는다.');
    console.table([
      ...baselineComparison.map((result) => axisOnlyRow(result, '기준선')),
      ...fixedComparison.map((result) => axisOnlyRow(result, '고정 11종')),
      ...manualResults.map((result) => axisOnlyRow(result, '직접 그림')),
    ]);
    customComparison = {
      centerBalancePolicy: '0.5c 값과 통과 여부만 표시; 임의 마스크를 필터링하지 않음',
      table: comparisonResults.map(publicAxisResult),
      candidates: manualResults.map(publicAxisResult),
      renderManifest,
    };
    console.log('임의 파인더 PNG');
    for (const result of manualResults) {
      console.log('- ' + result.id + ' 단독: ' + path.join(outputDir, result.renders.finder.file));
      console.log('- ' + result.id + ' Type O: ' + path.join(outputDir, result.renders.typeO.file));
    }
  } else if (validation.passed) {
    const generatedCandidates = generateCandidates();
    generatedCandidateCount = generatedCandidates.length;
    const familyOrder = [...new Set(generatedCandidates.map((candidate) => candidate.family))];
    familyGeneratedCounts = Object.fromEntries(familyOrder.map((family) => [
      family, generatedCandidates.filter((candidate) => candidate.family === family).length,
    ]));
    const measuredCandidates = generatedCandidates.map((candidate) => ({
      ...candidate,
      centerBalance: centerBalanceMetric(candidate.bits),
    }));
    centerGateRejectedByFamily = Object.fromEntries(familyOrder.map((family) => [
      family,
      measuredCandidates.filter((candidate) =>
        candidate.family === family && !candidate.centerBalance.passed).length,
    ]));
    const candidates = measuredCandidates.filter((candidate) => candidate.centerBalance.passed);
    candidateCount = candidates.length;
    centerGatePassedCount = candidateCount;
    familyCounts = Object.fromEntries(familyOrder.map((family) => [
      family, candidates.filter((candidate) => candidate.family === family).length,
    ]));
    console.log('중심 균형 게이트 <= ' + CENTER_BALANCE_LIMIT_CELLS.toFixed(2) + 'c');
    for (const family of familyOrder) {
      console.log('- [' + family + '] 생성 ' + familyGeneratedCounts[family]
        + '개 / 탈락 ' + centerGateRejectedByFamily[family]
        + '개 / 채점 ' + familyCounts[family] + '개');
    }
    console.log('구조화 후보 ' + generatedCandidateCount + '개 중 게이트 통과 '
      + candidateCount + '개 채점 중...');
    const ranked = candidates.map((candidate) => scoreBits(candidate, kernel, bases));
    ranked.sort(rankResults);
    top = ranked.slice(0, config.top);
    const legacyTop = [...ranked].sort(rankLegacy).slice(0, config.top);
    analysis = {
      selectedTop: separationAnalysis(top),
      legacyFourAxisTop: separationAnalysis(legacyTop),
      note: 'rotationDefectPearson은 회전 원점수와 결손 집중도 원점수의 Pearson r이다.',
    };

    for (let i = 0; i < top.length; i += 1) {
      const fileName = String(i + 1).padStart(2, '0') + '-' + top[i].id + '.png';
      top[i].png = path.join(outputDir, fileName);
      await writePng(candidateScene(top[i].bits), top[i].png);
    }

    const familyRoot = path.join(outputDir, 'by-family');
    await fs.mkdir(familyRoot, { recursive: true });
    for (const family of familyOrder) {
      const familyLimit = PRIORITY_FAMILIES.includes(family) ? config.perFamily : 1;
      const selected = ranked.filter((result) => result.family === family)
        .slice(0, familyLimit);
      assert(selected.length > 0, family + ' 족별 후보가 비어 있음');
      const familyDir = path.join(familyRoot, family.replace(/[^a-z0-9-]/gi, '_'));
      await fs.mkdir(familyDir, { recursive: true });
      for (let i = 0; i < selected.length; i += 1) {
        selected[i].familyPng = path.join(familyDir,
          String(i + 1).padStart(2, '0') + '-' + selected[i].id + '.png');
        await writePng(candidateScene(selected[i].bits), selected[i].familyPng);
      }
      topByFamily[family] = selected;
    }

    symmetryWitnesses = ranked.filter((result) => result.params && result.params.symmetryWitness);
    const harmfulWitnesses = symmetryWitnesses.filter((result) =>
      result.params.symmetryClass === 'C3' || result.params.symmetryClass === 'C6');
    const c2Witnesses = symmetryWitnesses.filter((result) => result.params.symmetryClass === 'C2');
    assert(harmfulWitnesses.length === 2, 'C3/C6 대칭 증거판 수가 2가 아님');
    assert(c2Witnesses.length === PRIORITY_FAMILIES.length,
      'C2 대칭 증거판 수가 우선 족 수와 다름');
    for (const witness of harmfulWitnesses) {
      assert(witness.metrics.rotation.score === 0,
        witness.id + ' 대칭 증거판 회전 점수가 0이 아님');
      assert(witness.metrics.rotation.minDifferenceCount === 0,
        witness.id + ' 대칭 증거판 차이 표본 수가 0이 아님');
    }
    for (const witness of c2Witnesses) {
      assert(witness.centerBalance.passed, witness.id + ' C2 판본이 중심 게이트를 통과하지 못함');
      assert(witness.metrics.rotation.score > 0,
        witness.id + ' C2 판본 회전 점수가 0임');
      assert(witness.total > 0, witness.id + ' C2 판본 종합 점수가 0임');
    }
    const witnessDir = path.join(outputDir, 'symmetry-witnesses');
    await fs.mkdir(witnessDir, { recursive: true });
    for (const witness of symmetryWitnesses) {
      witness.witnessPng = path.join(witnessDir, witness.id + '.png');
      await writePng(candidateScene(witness.bits), witness.witnessPng);
    }

    console.log('전체 상위 후보 + 기준선 — 축별 원점수');
    console.table([
      ...baselines.map((result) => resultRow(result, '기준')),
      ...top.map((result, index) => resultRow(result, index + 1)),
    ]);
    console.log('족별 상위 후보');
    for (const family of familyOrder) {
      console.log('[' + family + '] ' + familyCounts[family] + '개 중 '
        + topByFamily[family].length + '개');
      console.table(topByFamily[family].map((result, index) => resultRow(result, index + 1)));
    }
    console.log('대칭 증거 — C3/C6은 회전 0점, C2는 0점이 아님');
    console.table(symmetryWitnesses.map((result) => resultRow(result, '증거')));

    const oldStructure = analysis.legacyFourAxisTop.structuralSimplicity;
    const oldDefect = analysis.legacyFourAxisTop.defectConcentration;
    console.log('기존 4축 상위 ' + legacyTop.length + '개에서 새 축 분별: 구조 단순성 '
      + scoreText(oldStructure.minimum) + '..' + scoreText(oldStructure.maximum)
      + ' (' + oldStructure.uniqueScoreCount + '값), 결손 집중도 '
      + scoreText(oldDefect.minimum) + '..' + scoreText(oldDefect.maximum)
      + ' (' + oldDefect.uniqueScoreCount + '값)');
    const selectedR = analysis.selectedTop.rotationDefectPearson;
    const legacyR = analysis.legacyFourAxisTop.rotationDefectPearson;
    console.log('회전-결손 집중도 Pearson r: 새 상위='
      + (selectedR === null ? '계산 불가' : selectedR.toFixed(4))
      + '; 기존 4축 상위=' + (legacyR === null ? '계산 불가' : legacyR.toFixed(4)));

    if (top.every((result) => result.metrics.dataDistinction.score === 100)) {
      console.warn('[미검증] 데이터 구별도 상계가 상위권에서 100점으로 포화됐다; 센서 허용오차 모델 전에는 이 축이 상위 후보끼리 순위를 가르지 못한다.');
    }
    console.log('전체 상위 PNG');
    for (const result of top) console.log('- ' + result.id + ': ' + result.png);
    console.log('족별 PNG');
    for (const family of familyOrder) {
      for (const result of topByFamily[family]) console.log('- [' + family + '] '
        + result.id + ': ' + result.familyPng);
    }
    console.log('대칭 증거 PNG');
    for (const result of symmetryWitnesses) console.log('- ' + result.id + ': ' + result.witnessPng);
  } else {
    console.error('자가 검증에 실패했다. 이 자로 후보를 고르지 않으며 후보 순위를 출력하지 않는다.');
  }

  const report = {
    meta: {
      generatedAt: startedAt.toISOString(),
      wallTimeMs: Date.now() - startedAt.getTime(),
      mode: customMode ? 'manual-masks' : 'family-sweep',
      candidateCount,
      generatedCandidateCount,
      familyCounts,
      familyGeneratedCounts,
      finderCells: CELLS.length,
      faces: FACE_COUNT,
      faceTopology: {
        convention: 'facePolygon 꼭짓점 2개 공유',
        epsilon: SHARED_EDGE_EPS,
        internalEdges: FACE_TOPOLOGY.internalEdges,
        outerEdges: FACE_TOPOLOGY.outerEdges,
      },
      referenceSamples: REFERENCE.points.length,
      samplesPerFace: REFERENCE.samplesPerFace,
      lowPixelsPerCell: LOW_PIXELS_PER_CELL,
      areaSupersample: AREA_SUPERSAMPLE,
      blurSigmaPx: config.blurSigma,
      top: config.top,
      perFamily: config.perFamily,
      priorityFamilies: PRIORITY_FAMILIES,
      comparisonPerFamily: 1,
      compositeAxes: COMPOSITE_AXES,
      compositePolicy: '[미검증] 동일 가중 기하평균',
      ruleSweep: RULE_SWEEP,
      centerBalanceGate: {
        policy: customMode
          ? '임의 마스크는 표시 전용; 탈락시키지 않음'
          : 'score-axis가 아닌 후보 자격 게이트',
        limitCells: CENTER_BALANCE_LIMIT_CELLS,
        cellWidth: CELL_WIDTH,
        generatedCount: generatedCandidateCount,
        scoredCount: candidateCount,
        passedCount: centerGatePassedCount,
        rejectedCount: generatedCandidateCount - centerGatePassedCount,
        rejectedByFamily: centerGateRejectedByFamily,
      },
      outputDir,
    },
    rulerValidation: validation,
    baselines: customMode
      ? baselineComparison.map(publicAxisResult) : baselines.map(publicResult),
    topCandidates: top.map(publicResult),
    topByFamily: Object.fromEntries(Object.entries(topByFamily)
      .map(([family, results]) => [family, results.map(publicResult)])),
    symmetryWitnesses: symmetryWitnesses.map(publicResult),
    customMasks: customComparison,
    analysis,
    limitations: [
      '[미검증] 6축 종합점수는 실측 보정 없이 동일 가중 기하평균을 쓴다. 축별 원점수가 우선이다.',
      '[미검증] 바람개비·꽃·틈 링의 길이·폭·감김·중심 처리 파라미터 표본은 실기기와 미감으로 보정되지 않았다.',
      '[미검증] 결손 집중도의 HHI x 등주 compactness 결합은 실기기 복호율로 보정되지 않았다.',
      '[미검증] 연속 기준선의 구조 축은 면 평균의 min/max 중점에서 이진화한 투영이다.',
      '[미검증] 가우시안 sigma와 4x 면적 서브샘플은 실기기 MTF 및 수렴 시험으로 보정되지 않았다.',
      '[미검증] 데이터 구별도는 19개 독립·균등 digit, 기본 팔레트, 선형 등방 블러를 가정한다.',
      '노이즈 없는 matched-filter 상계가 0이면 100점으로 포화되어 센서 허용오차 전에는 후보끼리 못 가른다.',
      '투시, 모아레, 색수차, 노출 클리핑, 주변 데이터 경계는 모델에 없다.',
      '검출기 무관 점수는 탐색 비용, 지역 극값 수, 실제 복호율을 직접 예측하지 않는다.',
      '실측 53%/89%는 기준선 순서 검증에만 쓰며 점수를 성공률로 보정하지 않는다.',
    ],
  };
  const reportPath = path.join(outputDir, 'scores.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + String.fromCharCode(10), 'utf8');
  console.log('');
  console.log('점수 JSON: ' + reportPath);
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
    else {
      const maskCandidates = await loadFinderMaskCandidates(options);
      await runHarness({ ...options, maskCandidates });
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
