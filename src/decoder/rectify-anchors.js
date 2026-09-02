/**
 * rectify-anchors.js — 크롭된 v0 프레임에서 역왜곡용 6개 국소 앵커를 잰다.
 *
 * 입력은 스캐너가 정사각 크롭·축소를 끝낸 RGBA 래스터다. 이 모듈은 기존
 * 디코더에 배선되지 않은 독립 진입점이며, 입력 오류와 검출 실패를 예외 대신
 * null 앵커와 reason으로 돌려준다.
 *
 * 앵커 셀 집합은 좌표표를 갖지 않는다. `centralV0FinderCells()`가 돌려주는
 * 정본 30셀의 연결 성분에서 Y-심 쪽 성분과 가장 먼 성분을 골라, 각 T/L/R
 * 면의 중앙 3서브패치와 외곽 3코너를 만든다.
 *
 * 운용 한계 (2026-09-02 편입 시점, 합성 실측 — test/rectify-anchors.test.js 의 RECTIFY_METRIC):
 *   - **정면 전용.** 원근 t=0.1 까지 6/6(중심 ≤1 px). t≥0.3 또는 yaw/pitch ±2° 부터 0/6.
 *     셀 크기 탓이 아니다 — PPU 26(t=0.5 에서 15.0 px/cell, 정면 기준선 15.8 px 과 같은 크기)
 *     에서도 0/6. 패치별 보정이 translation + 등방 scale 하나만 풀기 때문(국소 shear·
 *     이방 scale 없음). 역왜곡(자세 복원) 요소 ① 로는 그대로 못 쓴다.
 *   - 정면도 셀 크기에 구멍이 있다: 2톤 11.2·12.1 px → 5/6, 3톤 19.5 px → 0/6,
 *     22.3 px → 4/6·중심 max 2.09 px. 구멍은 전부 boundaryScaleCorrection 정족수 게이트에서
 *     난다(상류 v0 shape 는 있음). 기준선 PPU 17(15.8 px) 은 그 사이의 한 점이다.
 *   - 입력 규약: 라이브 경로는 정사각 크롭 + 긴 변 ≤960(실패 재시도 1440 승격). 사진 경로
 *     (imageDataWhole) 는 크롭 없이 짧은 변 1440 상한 — «정사각 크롭 뒤» 전제가 없다.
 *   - 스캐너·생성기 어디에도 배선되지 않았다(소비자 0, 번들 바이트 무변화). 바깥 try/catch 가
 *     내부 예외를 'invalid-input' 으로 접는다 — 배선 레인에서 'internal-error' 로 가를 것.
 */

import {
  CELL_SURFACE_FINAL_V0,
  CENTRAL_V0_SOURCE_N,
  centralV0FinderCells,
} from '../cellSurfaceFinal.js';
import { CORNER_UNIT_OFFSETS } from '../hexgrid.js';
import { faceBasis, moduleCenter, moduleQuad } from '../ygrid.js';
import { detectCellSurfaceBlockShapes } from './cellsurface-block-detect.js';
import { estimateHomographyN, projectPoint } from './homography.js';
import { toRelativeLuminance } from './luma.js';

const FACES = Object.freeze(['T', 'L', 'R']);
const CANONICAL_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });
const MIN_PATCH_CORRELATION = 0.35;
const MIN_EDGE_CONTRAST = 0.01;
const MIN_PATCH_COVERAGE = 0.8;
const MIN_BOUNDARY_COVERAGE = 0.25;
const MIN_PATCH_SAMPLES = 6;
const MIN_DETECTED_ANCHORS = 3;
const COARSE_SCALE_MIN = 0.7;
const COARSE_SCALE_MAX = 1.3;
const PATCH_SAMPLE_FRACTIONS = Object.freeze(
  Array.from({ length: 16 }, (_, index) => (index + 0.5) / 16),
);
const PATCH_EDGE_FRACTIONS = Object.freeze([0.2, 0.4, 0.6, 0.8]);
const PIXEL_CENTER_OFFSET = 0.5;
const EPSILON = 1e-12;

export const RECTIFY_ANCHOR_IDS = Object.freeze([
  'central-T', 'central-L', 'central-R',
  'outer-T', 'outer-L', 'outer-R',
]);

function emptyResult(n, reason) {
  return {
    n: Number.isInteger(n) ? n : null,
    layoutId: CELL_SURFACE_FINAL_V0,
    anchors: RECTIFY_ANCHOR_IDS.map(() => null),
    detectedCount: 0,
    reason,
  };
}

function cellKey(cell) {
  return cell.i + ',' + cell.j;
}

/** 정본 셀의 8-neighbour 연결 성분. 블록 경계 좌표는 여기서 만들지 않는다. */
function connectedCellComponents(cells) {
  const byKey = new Map(cells.map((cell) => [cellKey(cell), cell]));
  const unseen = new Set(byKey.keys());
  const components = [];
  for (const first of byKey.values()) {
    const firstKey = cellKey(first);
    if (!unseen.has(firstKey)) continue;
    unseen.delete(firstKey);
    const queue = [first];
    const component = [];
    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head];
      component.push(cell);
      for (let di = -1; di <= 1; di += 1) {
        for (let dj = -1; dj <= 1; dj += 1) {
          if (di === 0 && dj === 0) continue;
          const key = (cell.i + di) + ',' + (cell.j + dj);
          if (!unseen.has(key)) continue;
          unseen.delete(key);
          queue.push(byKey.get(key));
        }
      }
    }
    components.push(component);
  }
  return components;
}

function componentRadiusSquared(component) {
  let i = 0;
  let j = 0;
  for (const cell of component) {
    i += cell.i + 0.5;
    j += cell.j + 0.5;
  }
  i /= component.length;
  j /= component.length;
  return i * i + j * j;
}

function canonicalFacePoint(face, a, b) {
  const basis = faceBasis(face);
  return {
    x: a * basis.ei.x + b * basis.ej.x,
    y: a * basis.ei.y + b * basis.ej.y,
  };
}

function buildPatch(cells, face, kind) {
  const points = [];
  const edges = [];
  const cellMap = new Map(cells.map((cell) => [cellKey(cell), cell]));
  const basis = faceBasis(face);
  let sumX = 0;
  let sumY = 0;
  for (const cell of cells) {
    if (cell[face] !== 0 && cell[face] !== 2) return null;
    const center = moduleCenter(face, cell.i, cell.j, CANONICAL_LAYOUT);
    const quad = moduleQuad(face, cell.i, cell.j, CANONICAL_LAYOUT);
    const expected = cell[face] === 2 ? 1 : 0;
    for (const v of PATCH_SAMPLE_FRACTIONS) {
      for (const u of PATCH_SAMPLE_FRACTIONS) {
        points.push({
          x: quad[0].x * (1 - u) * (1 - v)
            + quad[1].x * u * (1 - v)
            + quad[2].x * u * v
            + quad[3].x * (1 - u) * v,
          y: quad[0].y * (1 - u) * (1 - v)
            + quad[1].y * u * (1 - v)
            + quad[2].y * u * v
            + quad[3].y * (1 - u) * v,
          expected,
        });
      }
    }
    sumX += center.x;
    sumY += center.y;
  }
  for (const cell of cells) {
    const expected = cell[face] === 2 ? 1 : 0;
    for (const direction of ['i', 'j']) {
      const neighbour = direction === 'i'
        ? cellMap.get(`${cell.i + 1},${cell.j}`)
        : cellMap.get(`${cell.i},${cell.j + 1}`);
      if (!neighbour) continue;
      const neighbourExpected = neighbour[face] === 2 ? 1 : 0;
      if (expected === neighbourExpected) continue;
      for (const fraction of PATCH_EDGE_FRACTIONS) {
        const a = direction === 'i' ? cell.i + 1 : cell.i + fraction;
        const b = direction === 'i' ? cell.j + fraction : cell.j + 1;
        const point = canonicalFacePoint(face, a, b);
        const tangent = direction === 'i' ? basis.ej : basis.ei;
        const across = direction === 'i' ? basis.ei : basis.ej;
        edges.push({
          point,
          tangent,
          across,
          sign: neighbourExpected - expected,
          boundary: false,
          boundarySide: null,
        });
      }
    }
  }

  // 한쪽 L 경계만으로는 translation과 scale이 같은 방향으로 움직여 피치를
  // 식별할 수 없다. 패치의 유한한 네 둘레도 후보 경계로 재서 반대편 지지점을
  // 만든다. 둘레 밖 셀의 톤은 payload라 알 수 없으므로 부호는 가정하지 않고
  // 절대 contrast가 실제로 관측되는 표본만 쓴다.
  const boundaryDirections = [
    { side: 'i-', di: -1, dj: 0, tangent: basis.ej,
      across: { x: -basis.ei.x, y: -basis.ei.y } },
    { side: 'i+', di: 1, dj: 0, tangent: basis.ej, across: basis.ei },
    { side: 'j-', di: 0, dj: -1, tangent: basis.ei,
      across: { x: -basis.ej.x, y: -basis.ej.y } },
    { side: 'j+', di: 0, dj: 1, tangent: basis.ei, across: basis.ej },
  ];
  for (const cell of cells) {
    for (const direction of boundaryDirections) {
      if (cellMap.has(`${cell.i + direction.di},${cell.j + direction.dj}`)) continue;
      for (const fraction of PATCH_EDGE_FRACTIONS) {
        const a = direction.di < 0 ? cell.i
          : direction.di > 0 ? cell.i + 1 : cell.i + fraction;
        const b = direction.dj < 0 ? cell.j
          : direction.dj > 0 ? cell.j + 1 : cell.j + fraction;
        edges.push({
          point: canonicalFacePoint(face, a, b),
          tangent: direction.tangent,
          across: direction.across,
          sign: null,
          boundary: true,
          boundarySide: direction.side,
        });
      }
    }
  }
  if (points.length < MIN_PATCH_SAMPLES) return null;
  if (edges.length < MIN_PATCH_SAMPLES) return null;
  return {
    id: kind + '-' + face,
    kind,
    face,
    anchor: { x: sumX / cells.length, y: sumY / cells.length },
    points,
    edges,
  };
}

function canonicalPatches() {
  const source = centralV0FinderCells();
  if (!Array.isArray(source) || source.length !== 30) return null;
  const components = connectedCellComponents(source);
  // v0 정본은 중앙·두 엣지·먼 코너 네 블록이다. 다른 토폴로지로 바뀌면
  // 임의의 두 성분을 파인더라고 주장하지 않고 fail-closed 한다.
  if (components.length !== 4) return null;
  const componentSizes = components.map((component) => component.length)
    .sort((left, right) => left - right);
  if (componentSizes.join(',') !== '6,6,9,9') return null;
  const ordered = components.slice().sort((left, right) =>
    componentRadiusSquared(left) - componentRadiusSquared(right));
  const central = ordered[0];
  const outer = ordered[ordered.length - 1];
  if (central.length !== 9 || outer.length !== 9) return null;
  const patches = [];
  for (const [kind, cells] of [['central', central], ['outer', outer]]) {
    for (const face of FACES) {
      const patch = buildPatch(cells, face, kind);
      if (patch === null) return null;
      patches.push(patch);
    }
  }
  return patches;
}

function bilinear(luma, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= luma.width || y0 + 1 >= luma.height) return null;
  const fx = x - x0;
  const fy = y - y0;
  const base = y0 * luma.width + x0;
  const top = luma.data[base] * (1 - fx) + luma.data[base + 1] * fx;
  const bottom = luma.data[base + luma.width] * (1 - fx)
    + luma.data[base + luma.width + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function localCellGeometry(H, anchor, face) {
  const origin = projectPoint(H, anchor);
  const basis = faceBasis(face);
  const alongI = projectPoint(H, {
    x: anchor.x + basis.ei.x,
    y: anchor.y + basis.ei.y,
  });
  const alongJ = projectPoint(H, {
    x: anchor.x + basis.ej.x,
    y: anchor.y + basis.ej.y,
  });
  const corners = [
    [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5],
  ].map(([i, j]) => projectPoint(H, {
    x: anchor.x + basis.ei.x * i + basis.ej.x * j,
    y: anchor.y + basis.ei.y * i + basis.ej.y * j,
  }));
  if (!origin || !alongI || !alongJ || corners.some((point) => point === null)) {
    return null;
  }
  const searchPitch = (
    Math.hypot(alongI.x - origin.x, alongI.y - origin.y)
    + Math.hypot(alongJ.x - origin.x, alongJ.y - origin.y)
  ) / 2;
  const twiceArea = Math.abs(
    corners[0].x * corners[1].y - corners[0].y * corners[1].x
    + corners[1].x * corners[2].y - corners[1].y * corners[2].x
    + corners[2].x * corners[3].y - corners[2].y * corners[3].x
    + corners[3].x * corners[0].y - corners[3].y * corners[0].x
  );
  const cellPitch = Math.sqrt(twiceArea / 2);
  if (![searchPitch, cellPitch].every(Number.isFinite)
    || searchPitch <= 0 || cellPitch <= 0) return null;
  return { searchPitch, cellPitch };
}

function patchModel(H, patch) {
  const center = projectPoint(H, patch.anchor);
  const geometry = localCellGeometry(H, patch.anchor, patch.face);
  if (!center || geometry === null) return null;
  const samples = [];
  for (const point of patch.points) {
    const projected = projectPoint(H, point);
    if (!projected) return null;
    samples.push({
      dx: projected.x - center.x,
      dy: projected.y - center.y,
      expected: point.expected,
    });
  }
  const edges = [];
  for (const edge of patch.edges) {
    const point = projectPoint(H, edge.point);
    const tangentPoint = projectPoint(H, {
      x: edge.point.x + edge.tangent.x * 0.1,
      y: edge.point.y + edge.tangent.y * 0.1,
    });
    const acrossPoint = projectPoint(H, {
      x: edge.point.x + edge.across.x * 0.1,
      y: edge.point.y + edge.across.y * 0.1,
    });
    if (!point || !tangentPoint || !acrossPoint) return null;
    const tangentX = tangentPoint.x - point.x;
    const tangentY = tangentPoint.y - point.y;
    const tangentLength = Math.hypot(tangentX, tangentY);
    if (!(tangentLength > EPSILON)) return null;
    let normalX = -tangentY / tangentLength;
    let normalY = tangentX / tangentLength;
    const acrossX = acrossPoint.x - point.x;
    const acrossY = acrossPoint.y - point.y;
    if (normalX * acrossX + normalY * acrossY < 0) {
      normalX *= -1;
      normalY *= -1;
    }
    edges.push({
      dx: point.x - center.x,
      dy: point.y - center.y,
      normalX,
      normalY,
      sign: edge.sign,
      boundary: edge.boundary,
      boundarySide: edge.boundarySide,
    });
  }
  return { center, ...geometry, samples, edges };
}

function patchScore(luma, model, scale, offsetX, offsetY) {
  let count = 0;
  let sumValue = 0;
  let sumExpected = 0;
  let sumValueSquared = 0;
  let sumExpectedSquared = 0;
  let sumProduct = 0;
  for (const sample of model.samples) {
    const x = model.center.x + offsetX + sample.dx * scale;
    const y = model.center.y + offsetY + sample.dy * scale;
    const value = bilinear(luma, x, y);
    if (value === null) continue;
    count += 1;
    sumValue += value;
    sumExpected += sample.expected;
    sumValueSquared += value * value;
    sumExpectedSquared += sample.expected * sample.expected;
    sumProduct += value * sample.expected;
  }
  const minimum = Math.max(
    MIN_PATCH_SAMPLES,
    Math.ceil(model.samples.length * MIN_PATCH_COVERAGE),
  );
  if (count < minimum) return null;
  const numerator = count * sumProduct - sumValue * sumExpected;
  const valueEnergy = count * sumValueSquared - sumValue * sumValue;
  const expectedEnergy = count * sumExpectedSquared - sumExpected * sumExpected;
  const denominator = Math.sqrt(valueEnergy * expectedEnergy);
  if (!(denominator > EPSILON)) return null;
  const correlation = numerator / denominator;
  let edgeCount = 0;
  let edgeContrastSum = 0;
  const edgeTap = 0.75;
  const internalEdges = model.edges.filter((edge) => !edge.boundary);
  for (const edge of internalEdges) {
    const x = model.center.x + offsetX + edge.dx * scale;
    const y = model.center.y + offsetY + edge.dy * scale;
    const before = bilinear(
      luma, x - edge.normalX * edgeTap, y - edge.normalY * edgeTap,
    );
    const after = bilinear(
      luma, x + edge.normalX * edgeTap, y + edge.normalY * edgeTap,
    );
    if (before === null || after === null) continue;
    edgeContrastSum += edge.sign === null
      ? Math.abs(after - before) : edge.sign * (after - before);
    edgeCount += 1;
  }
  if (edgeCount < Math.max(MIN_PATCH_SAMPLES,
    Math.ceil(internalEdges.length * MIN_PATCH_COVERAGE))) return null;
  const edgeContrast = edgeContrastSum / edgeCount;
  return {
    correlation,
    coverage: count / model.samples.length,
    edgeContrast,
  };
}

function parabolicAdjustment(left, center, right, step) {
  if (left === null || center === null || right === null) return 0;
  const denominator = left - 2 * center + right;
  if (!(denominator < -EPSILON)) return 0;
  const adjustment = 0.5 * (left - right) / denominator * step;
  return Math.max(-step, Math.min(step, adjustment));
}

function measureEdgeOffset(luma, x, y, edge, range) {
  const step = 0.25;
  const tap = 0.75;
  const steps = Math.max(2, Math.floor(range / step));
  const scores = new Float64Array(steps * 2 + 1);
  let bestIndex = -1;
  let bestScore = -Infinity;
  for (let index = -steps; index <= steps; index += 1) {
    const offset = index * step;
    const px = x + edge.normalX * offset;
    const py = y + edge.normalY * offset;
    const before = bilinear(
      luma, px - edge.normalX * tap, py - edge.normalY * tap,
    );
    const after = bilinear(
      luma, px + edge.normalX * tap, py + edge.normalY * tap,
    );
    const contrast = before === null || after === null ? null : after - before;
    const score = contrast === null ? -Infinity
      : edge.sign === null ? Math.abs(contrast) : edge.sign * contrast;
    scores[index + steps] = score;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index + steps;
    }
  }
  if (bestIndex <= 0 || bestIndex >= scores.length - 1
    || bestScore < MIN_EDGE_CONTRAST) return null;
  const adjustment = parabolicAdjustment(
    scores[bestIndex - 1], scores[bestIndex], scores[bestIndex + 1], step,
  );
  return {
    offset: (bestIndex - steps) * step + adjustment,
    contrast: bestScore,
  };
}

function edgeCorrection(luma, model, state, range) {
  const normal = Array.from({ length: 2 }, () => new Float64Array(2));
  const values = new Float64Array(2);
  const observations = [];
  for (const edge of model.edges) {
    if (edge.boundary) continue;
    const x = model.center.x + state.offsetX + edge.dx * state.scale;
    const y = model.center.y + state.offsetY + edge.dy * state.scale;
    const observed = measureEdgeOffset(luma, x, y, edge, range);
    if (observed === null) continue;
    const row = [edge.normalX, edge.normalY];
    const weight = Math.max(MIN_EDGE_CONTRAST, observed.contrast);
    for (let a = 0; a < 2; a += 1) {
      values[a] += weight * row[a] * observed.offset;
      for (let b = 0; b < 2; b += 1) {
        normal[a][b] += weight * row[a] * row[b];
      }
    }
    observations.push({ row, ...observed });
  }
  if (observations.length < MIN_PATCH_SAMPLES) return null;
  const determinant = normal[0][0] * normal[1][1] - normal[0][1] * normal[1][0];
  if (Math.abs(determinant) <= EPSILON) return null;
  const correction = [
    (values[0] * normal[1][1] - values[1] * normal[0][1]) / determinant,
    (normal[0][0] * values[1] - normal[1][0] * values[0]) / determinant,
  ];
  if (!correction.every(Number.isFinite)) return null;
  let squaredResidual = 0;
  for (const observation of observations) {
    const fitted = observation.row[0] * correction[0]
      + observation.row[1] * correction[1];
    squaredResidual += (observation.offset - fitted) ** 2;
  }
  return {
    offsetX: correction[0],
    offsetY: correction[1],
    rms: Math.sqrt(squaredResidual / observations.length),
    coverage: observations.length
      / model.edges.filter((edge) => !edge.boundary).length,
  };
}

function boundaryScaleCorrection(luma, model, state, range) {
  const candidates = [];
  const boundaryEdges = model.edges.filter((edge) => edge.boundary);
  const minimumBoundarySamples = Math.max(
    MIN_PATCH_SAMPLES,
    Math.ceil(boundaryEdges.length * MIN_BOUNDARY_COVERAGE),
  );
  for (const edge of boundaryEdges) {
    const x = model.center.x + state.offsetX + edge.dx * state.scale;
    const y = model.center.y + state.offsetY + edge.dy * state.scale;
    const observed = measureEdgeOffset(luma, x, y, edge, range);
    if (observed === null) continue;
    const radial = edge.normalX * edge.dx + edge.normalY * edge.dy;
    if (Math.abs(radial) < model.searchPitch * 0.5) continue;
    candidates.push({
      correction: observed.offset / radial,
      observed,
      radial,
      side: edge.boundarySide,
      weight: observed.contrast * Math.abs(radial),
    });
  }
  if (candidates.length < minimumBoundarySamples) return null;
  candidates.sort((left, right) => left.correction - right.correction);
  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  let accumulated = 0;
  let median = candidates[Math.floor(candidates.length / 2)].correction;
  for (const candidate of candidates) {
    accumulated += candidate.weight;
    if (accumulated >= totalWeight / 2) {
      median = candidate.correction;
      break;
    }
  }
  const residualLimit = Math.max(0.75, range * 0.35);
  const inliers = candidates.filter((candidate) =>
    Math.abs(candidate.observed.offset - candidate.radial * median) <= residualLimit);
  if (inliers.length < minimumBoundarySamples) return null;
  const sideCounts = new Map();
  for (const candidate of inliers) {
    sideCounts.set(candidate.side, (sideCounts.get(candidate.side) || 0) + 1);
  }
  const supportedSides = Array.from(sideCounts.values())
    .filter((count) => count >= 2).length;
  if (supportedSides < 2) return null;
  let numerator = 0;
  let denominator = 0;
  for (const candidate of inliers) {
    numerator += candidate.weight * candidate.radial * candidate.observed.offset;
    denominator += candidate.weight * candidate.radial * candidate.radial;
  }
  if (!(denominator > EPSILON)) return null;
  const scale = numerator / denominator;
  if (!Number.isFinite(scale)) return null;
  const squaredResidual = inliers.reduce((sum, candidate) => sum
    + (candidate.observed.offset - candidate.radial * scale) ** 2, 0);
  return {
    scale,
    rms: Math.sqrt(squaredResidual / inliers.length),
    coverage: inliers.length / boundaryEdges.length,
  };
}

function refinePatch(luma, H, patch) {
  const model = patchModel(H, patch);
  if (model === null || model.searchPitch <= 0.5) return null;
  const state = { offsetX: 0, offsetY: 0, scale: 1 };
  let fit = null;
  for (const rangeCells of [0.45, 0.16]) {
    const translation = edgeCorrection(
      luma, model, state, rangeCells * model.searchPitch,
    );
    if (translation === null) return null;
    state.offsetX += translation.offsetX;
    state.offsetY += translation.offsetY;
    const scale = boundaryScaleCorrection(
      luma, model, state, rangeCells * 0.7 * model.searchPitch,
    );
    if (scale === null) return null;
    state.scale += scale.scale;
    if (state.scale <= COARSE_SCALE_MIN || state.scale >= COARSE_SCALE_MAX) return null;
    fit = {
      rms: Math.max(translation.rms, scale.rms),
      coverage: Math.min(translation.coverage, scale.coverage),
    };
  }
  const scored = patchScore(
    luma, model, state.scale, state.offsetX, state.offsetY,
  );
  if (scored === null || scored.correlation < MIN_PATCH_CORRELATION
    || scored.edgeContrast < MIN_EDGE_CONTRAST || fit.rms > 1.5) return null;
  const offsetX = state.offsetX;
  const offsetY = state.offsetY;
  const scale = state.scale;
  // LumaField의 정수 인덱스는 픽셀 중심이고 scene/raster 좌표는 픽셀 경계다.
  // 외부 계약은 후자이므로 검출 좌표를 반 픽셀 옮겨 같은 좌표계로 돌려준다.
  const x = model.center.x + offsetX + PIXEL_CENTER_OFFSET;
  const y = model.center.y + offsetY + PIXEL_CENTER_OFFSET;
  const cellPitch = model.cellPitch * scale;
  if (![x, y, cellPitch].every(Number.isFinite) || cellPitch <= 0) return null;
  return {
    id: patch.id,
    kind: patch.kind,
    face: patch.face,
    x,
    y,
    cellPitch,
    correlation: scored.correlation,
    coverage: Math.min(scored.coverage, fit.coverage),
    edgeResidual: fit.rms,
  };
}

function homographyForShape(shape, n) {
  if (!shape || !Array.isArray(shape.vertices) || shape.vertices.length !== 6) return null;
  const canonical = CORNER_UNIT_OFFSETS.map((corner) => ({
    x: corner.x * n,
    y: corner.y * n,
  }));
  return estimateHomographyN(canonical, shape.vertices);
}

function resultForShape(luma, shape, n, patches) {
  const H = homographyForShape(shape, n);
  if (H === null) return null;
  const anchors = patches.map((patch) => refinePatch(luma, H, patch));
  const detectedCount = anchors.filter((anchor) => anchor !== null).length;
  const correlationSum = anchors.reduce(
    (sum, anchor) => sum + (anchor === null ? 0 : anchor.correlation),
    0,
  );
  return {
    anchors,
    detectedCount,
    correlationSum,
    shapeScore: Number.isFinite(shape.score) ? shape.score : -Infinity,
  };
}

/**
 * @param {{width:number,height:number,pixels:Uint8ClampedArray}} frame
 * @param {number} n
 * @description 반환 x/y는 입력 raster의 경계 좌표계다. 배열 인덱스 k의 픽셀 중심은 k+0.5다.
 * @returns {{n:number|null,layoutId:string,anchors:(object|null)[],detectedCount:number,
 *            reason:null|'invalid-input'|'unsupported-n'|'invalid-canonical'|'not-found'|'partial'}}
 */
export function detectRectifyAnchors(frame, n) {
  try {
    if (n !== CENTRAL_V0_SOURCE_N) return emptyResult(n, 'unsupported-n');
    const luma = toRelativeLuminance(frame);
    if (!luma || luma.ok === false || !(luma.data instanceof Float32Array)) {
      return emptyResult(n, 'invalid-input');
    }
    const patches = canonicalPatches();
    if (patches === null || patches.length !== RECTIFY_ANCHOR_IDS.length) {
      return emptyResult(n, 'invalid-canonical');
    }

    const detected = detectCellSurfaceBlockShapes(luma);
    const shapes = Array.isArray(detected?.shapes)
      ? detected.shapes.filter((shape) =>
        shape?.estimatedN === n && shape?.blockLocator?.family === 'v0')
      : [];
    let best = null;
    for (const shape of shapes) {
      const candidate = resultForShape(luma, shape, n, patches);
      if (candidate === null) continue;
      if (best === null
        || candidate.detectedCount > best.detectedCount
        || (candidate.detectedCount === best.detectedCount
          && candidate.shapeScore > best.shapeScore)
        || (candidate.detectedCount === best.detectedCount
          && candidate.shapeScore === best.shapeScore
          && candidate.correlationSum > best.correlationSum)) {
        best = candidate;
      }
    }
    if (best === null || best.detectedCount < MIN_DETECTED_ANCHORS) {
      return emptyResult(n, 'not-found');
    }
    return {
      n,
      layoutId: CELL_SURFACE_FINAL_V0,
      anchors: best.anchors,
      detectedCount: best.detectedCount,
      reason: best.detectedCount === RECTIFY_ANCHOR_IDS.length ? null : 'partial',
    };
  } catch {
    return emptyResult(n, 'invalid-input');
  }
}

export default detectRectifyAnchors;
