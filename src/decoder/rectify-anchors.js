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
 * 운용 한계 (2026-09-02 AFF 확장 합성 실측 — test/rectify-anchors.test.js 의 RECTIFY_METRIC.
 *   아래 포락은 «PPU 17 · 960 정면 배치 · 무잡음 합성» 의 점 측정이지 영역이 아니다):
 *   - coarse 등방 보정 뒤 fine에서 translation + 2x2 국소 affine을 풀며, coarse 등방 보정이
 *     서지 않는 패치는 H 중심 0.45셀 원판의 correlation 초기화 뒤 같은 affine 정족수와
 *     rank 게이트를 다시 잰다. 게이트·정족수·scale 범위는 편입 시점 그대로다.
 *   - PPU 17 에서 정면 2/3톤 · 원근 t=0.1 · 자세 ±2°(t=0.1, t=0) · 원근 t=0.2 는 6/6 이며
 *     잠근 중심 상한 안이다. 같은 기하를 다른 PPU 로 그리면 점이 흔들린다: t=0.2@PPU22 5/6
 *     (중심 max 1.76 px), ±2°@PPU20 5/6(A′ 전 4/6), ±1° 5/6, ±3° 5/6, ±5° 0/6.
 *   - 전역 H LOO 잔차는 평면 인쇄물(카메라 기울기 2~30° · 거리비 4/8 · σ≤24)에서
 *     정상 6/6 max 0.66셀과 2셀 이동 대조군 ≥2.5셀을 가른다. 3D 큐브 렌더(t≥0.1 또는
 *     자세 ≥2°)에서는 정상 6/6이 6.8~25셀(in-sample 비평면성 ≤0.33셀 — LOO 외삽이
 *     35~70× 증폭)이므로 유효성 게이트가 아니고 «비평면 표적» 지표다. 검출 정확히 4개면
 *     값은 null이고, 3개 이하면 residual 자체가 null이다.
 *   - A′ 는 후보마다 최초 4~5개 검출 앵커로 전역 H를 한 번 재적합해 null 슬롯만 같은 refine 경로로
 *     재시도하고 그 결과를 후보 순위에 반영한다. 전역 H라 큐브에서는 중앙 앵커 보간만 살리며
 *     outer 외삽(pose-3/5deg 실패형)은 구조적으로 못 살린다(재예측 5.074셀 + 피치 모델
 *     1.35× 오염).
 *   - 정면 셀 크기 구멍 (AFF 후 재측정): 3톤 19.5 px(PPU 21) 는 **여전히 0/6** (boundary
 *     정족수). 2톤 11.2·12.1 px 5/6→6/6, 3톤 22.3 px 4/6→6/6(중심 max 2.09→1.46 px) 는 좋아졌고,
 *     2톤 22.3 px 중심 max 0.55→1.42 px · 24.2 px 1.26→1.54 px · 3톤 12.1 px 0.52→1.09 px 는
 *     나빠졌다(검출 수는 유지). ≥22 px 셀은 1 px 상한 밖이다.
 *   - 잡음: 가우시안 σ=4~24(8bit) 를 정면 PPU 17 에 얹으면 검출 수 6/6 은 유지되나 중심 max 가
 *     편입 시점 0.3~0.7 px 에서 0.6~1.2 px 로 커진다(6자유도가 잡음을 흡수한다, 3 seed 프로브).
 *   - 출력 `localAffine` = row-major [a11, a12, a21, a22]. H 투영 이미지 상대벡터 d(열벡터)에
 *     x' = A·d 로 **왼쪽에서** 곱한다. d·A 로 읽으면 전치가 들어간다.
 *   - t=0.3은 상류 v0/13 shape가 0이라 이 모듈에 시드가 오지 않는다. PPU 26의 t=0.5는
 *     shape가 있어도 시드가 20셀 이상 어긋나므로 국소 affine 범위 밖이다.
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
const MIN_PREALIGN_CORRELATION = 0.65;
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
// 평면 인쇄물의 정상 max 0.663셀과 2셀 이동 대조군 min 2.499셀 사이,
// 즉 사다리 간격 [0.663, 2.499] 안쪽에 둔 문턱이다.
// 추정 — PPU 17·3톤·단일축 기울기만 잰 값이다.
const REPROJECTION_RESIDUAL_THRESHOLD_CELLS = 1.0;

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
    reseeded: false,
    residual: null,
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

function transformedPoint(state, dx, dy) {
  return {
    x: state.offsetX + state.a11 * dx + state.a12 * dy,
    y: state.offsetY + state.a21 * dx + state.a22 * dy,
  };
}

function transformedNormal(state, edge) {
  const x = state.a22 * edge.normalX - state.a21 * edge.normalY;
  const y = -state.a12 * edge.normalX + state.a11 * edge.normalY;
  const length = Math.hypot(x, y);
  if (!(length > EPSILON)) return null;
  return { normalX: x / length, normalY: y / length };
}

function affineSingularValues(state) {
  const frobeniusSquared = state.a11 * state.a11 + state.a12 * state.a12
    + state.a21 * state.a21 + state.a22 * state.a22;
  const determinant = state.a11 * state.a22 - state.a12 * state.a21;
  const discriminant = Math.sqrt(Math.max(
    0, frobeniusSquared * frobeniusSquared - 4 * determinant * determinant,
  ));
  const maximum = Math.sqrt(Math.max(0, (frobeniusSquared + discriminant) / 2));
  const minimum = maximum > 0 ? Math.abs(determinant) / maximum : 0;
  return { minimum, maximum, determinant };
}

function affineWithinScaleBounds(state) {
  const singular = affineSingularValues(state);
  return Number.isFinite(singular.minimum) && Number.isFinite(singular.maximum)
    && singular.determinant > 0
    && singular.minimum > COARSE_SCALE_MIN
    && singular.maximum < COARSE_SCALE_MAX;
}

function patchScore(luma, model, state) {
  let count = 0;
  let sumValue = 0;
  let sumExpected = 0;
  let sumValueSquared = 0;
  let sumExpectedSquared = 0;
  let sumProduct = 0;
  for (const sample of model.samples) {
    const offset = transformedPoint(state, sample.dx, sample.dy);
    const x = model.center.x + offset.x;
    const y = model.center.y + offset.y;
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
    const offset = transformedPoint(state, edge.dx, edge.dy);
    const normal = transformedNormal(state, edge);
    if (normal === null) continue;
    const x = model.center.x + offset.x;
    const y = model.center.y + offset.y;
    const before = bilinear(
      luma, x - normal.normalX * edgeTap, y - normal.normalY * edgeTap,
    );
    const after = bilinear(
      luma, x + normal.normalX * edgeTap, y + normal.normalY * edgeTap,
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

function edgeCorrection(luma, model, state, range, trace) {
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
  if (trace) {
    trace.observations = observations.length;
    trace.minimumObservations = MIN_PATCH_SAMPLES;
    trace.internalEdges = model.edges.filter((edge) => !edge.boundary).length;
  }
  if (observations.length < MIN_PATCH_SAMPLES) {
    if (trace) trace.reject = 'observations';
    return null;
  }
  const determinant = normal[0][0] * normal[1][1] - normal[0][1] * normal[1][0];
  if (trace) trace.determinant = determinant;
  if (Math.abs(determinant) <= EPSILON) {
    if (trace) trace.reject = 'singular';
    return null;
  }
  const correction = [
    (values[0] * normal[1][1] - values[1] * normal[0][1]) / determinant,
    (normal[0][0] * values[1] - normal[1][0] * values[0]) / determinant,
  ];
  if (!correction.every(Number.isFinite)) {
    if (trace) trace.reject = 'non-finite';
    return null;
  }
  let squaredResidual = 0;
  for (const observation of observations) {
    const fitted = observation.row[0] * correction[0]
      + observation.row[1] * correction[1];
    squaredResidual += (observation.offset - fitted) ** 2;
  }
  const result = {
    offsetX: correction[0],
    offsetY: correction[1],
    rms: Math.sqrt(squaredResidual / observations.length),
    coverage: observations.length
      / model.edges.filter((edge) => !edge.boundary).length,
  };
  if (trace) Object.assign(trace, result, { reject: null });
  return result;
}

function boundaryScaleCorrection(luma, model, state, range, trace) {
  const candidates = [];
  const boundaryEdges = model.edges.filter((edge) => edge.boundary);
  const minimumBoundarySamples = Math.max(
    MIN_PATCH_SAMPLES,
    Math.ceil(boundaryEdges.length * MIN_BOUNDARY_COVERAGE),
  );
  if (trace) {
    Object.assign(trace, {
      boundaryEdges: boundaryEdges.length,
      minimumBoundarySamples,
      candidates: 0,
      inliers: 0,
      supportedSides: 0,
    });
  }
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
  if (trace) trace.candidates = candidates.length;
  if (candidates.length < minimumBoundarySamples) {
    if (trace) trace.reject = 'candidates';
    return null;
  }
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
  if (trace) {
    trace.median = median;
    trace.residualLimit = residualLimit;
    trace.inliers = inliers.length;
  }
  if (inliers.length < minimumBoundarySamples) {
    if (trace) trace.reject = 'inliers';
    return null;
  }
  const sideCounts = new Map();
  for (const candidate of inliers) {
    sideCounts.set(candidate.side, (sideCounts.get(candidate.side) || 0) + 1);
  }
  const supportedSides = Array.from(sideCounts.values())
    .filter((count) => count >= 2).length;
  if (trace) {
    trace.supportedSides = supportedSides;
    trace.sideCounts = Object.fromEntries(sideCounts);
  }
  if (supportedSides < 2) {
    if (trace) trace.reject = 'supported-sides';
    return null;
  }
  let numerator = 0;
  let denominator = 0;
  for (const candidate of inliers) {
    numerator += candidate.weight * candidate.radial * candidate.observed.offset;
    denominator += candidate.weight * candidate.radial * candidate.radial;
  }
  if (!(denominator > EPSILON)) {
    if (trace) trace.reject = 'singular';
    return null;
  }
  const scale = numerator / denominator;
  if (!Number.isFinite(scale)) {
    if (trace) trace.reject = 'non-finite';
    return null;
  }
  const squaredResidual = inliers.reduce((sum, candidate) => sum
    + (candidate.observed.offset - candidate.radial * scale) ** 2, 0);
  const result = {
    scale,
    rms: Math.sqrt(squaredResidual / inliers.length),
    coverage: inliers.length / boundaryEdges.length,
  };
  if (trace) Object.assign(trace, result, { reject: null });
  return result;
}

function symmetricEigenvalues(matrix) {
  const size = matrix.length;
  const work = matrix.map((row) => Float64Array.from(row));
  let converged = false;
  for (let iteration = 0; iteration < 96; iteration += 1) {
    let p = 0;
    let q = 1;
    let maximumOffDiagonal = 0;
    let maximumDiagonal = 0;
    for (let i = 0; i < size; i += 1) {
      maximumDiagonal = Math.max(maximumDiagonal, Math.abs(work[i][i]));
      for (let j = i + 1; j < size; j += 1) {
        const magnitude = Math.abs(work[i][j]);
        if (magnitude > maximumOffDiagonal) {
          maximumOffDiagonal = magnitude;
          p = i;
          q = j;
        }
      }
    }
    if (maximumOffDiagonal <= EPSILON * Math.max(1, maximumDiagonal)) {
      converged = true;
      break;
    }
    const app = work[p][p];
    const aqq = work[q][q];
    const apq = work[p][q];
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let k = 0; k < size; k += 1) {
      if (k === p || k === q) continue;
      const akp = work[k][p];
      const akq = work[k][q];
      const nextP = cosine * akp - sine * akq;
      const nextQ = sine * akp + cosine * akq;
      work[k][p] = nextP;
      work[p][k] = nextP;
      work[k][q] = nextQ;
      work[q][k] = nextQ;
    }
    work[p][p] = cosine * cosine * app - 2 * sine * cosine * apq
      + sine * sine * aqq;
    work[q][q] = sine * sine * app + 2 * sine * cosine * apq
      + cosine * cosine * aqq;
    work[p][q] = 0;
    work[q][p] = 0;
  }
  if (!converged) return null;
  return Array.from({ length: size }, (_, index) => work[index][index])
    .sort((left, right) => left - right);
}

function solveAffineSystem(observations, robustWeights) {
  const size = 6;
  const normal = Array.from({ length: size }, () => new Float64Array(size));
  const values = new Float64Array(size);
  let weightSum = 0;
  for (let index = 0; index < observations.length; index += 1) {
    weightSum += observations[index].weight * (robustWeights?.[index] ?? 1);
  }
  if (!(weightSum > EPSILON)) return { ok: false, reason: 'rank' };
  const weightMean = weightSum / observations.length;
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    const weight = observation.weight * (robustWeights?.[index] ?? 1) / weightMean;
    for (let a = 0; a < size; a += 1) {
      values[a] += weight * observation.row[a] * observation.offset;
      for (let b = 0; b < size; b += 1) {
        normal[a][b] += weight * observation.row[a] * observation.row[b];
      }
    }
  }
  const eigenvalues = symmetricEigenvalues(normal);
  if (eigenvalues === null) return { ok: false, reason: 'rank' };
  const maximumEigenvalue = eigenvalues[eigenvalues.length - 1];
  const minimumEigenvalue = eigenvalues[0];
  if (!(maximumEigenvalue > EPSILON) || !(minimumEigenvalue > maximumEigenvalue * 1e-6)) {
    return {
      ok: false,
      reason: 'rank',
      singularMin: Math.sqrt(Math.max(0, minimumEigenvalue)),
      singularMax: Math.sqrt(Math.max(0, maximumEigenvalue)),
      condition: minimumEigenvalue > 0
        ? Math.sqrt(maximumEigenvalue / minimumEigenvalue) : Infinity,
    };
  }
  const augmented = normal.map((row, index) => {
    const copy = new Float64Array(size + 1);
    copy.set(row);
    copy[size] = values[index];
    return copy;
  });
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) <= maximumEigenvalue * 1e-12) {
      return { ok: false, reason: 'rank' };
    }
    if (pivot !== column) {
      const swap = augmented[pivot];
      augmented[pivot] = augmented[column];
      augmented[column] = swap;
    }
    const divisor = augmented[column][column];
    for (let k = column; k <= size; k += 1) augmented[column][k] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let k = column; k <= size; k += 1) {
        augmented[row][k] -= factor * augmented[column][k];
      }
    }
  }
  const solution = augmented.map((row) => row[size]);
  if (!solution.every(Number.isFinite)) return { ok: false, reason: 'non-finite' };
  return {
    ok: true,
    solution,
    singularMin: Math.sqrt(minimumEigenvalue),
    singularMax: Math.sqrt(maximumEigenvalue),
    condition: Math.sqrt(maximumEigenvalue / minimumEigenvalue),
  };
}

function affineResidual(observation, solution) {
  let fitted = 0;
  for (let index = 0; index < solution.length; index += 1) {
    fitted += observation.row[index] * solution[index];
  }
  return observation.offset - fitted;
}

function boundarySupport(observations) {
  const sideCounts = new Map();
  for (const observation of observations) {
    if (!observation.boundary) continue;
    sideCounts.set(observation.side, (sideCounts.get(observation.side) || 0) + 1);
  }
  return {
    sideCounts,
    supportedSides: Array.from(sideCounts.values()).filter((count) => count >= 2).length,
  };
}

function translationPrealign(luma, model, rangeCells, trace) {
  const maximumTranslation = rangeCells * model.searchPitch;
  const coarseSteps = Math.max(2, Math.ceil(rangeCells / 0.1));
  let spacing = maximumTranslation / coarseSteps;
  let candidates = 0;
  let best = null;
  const consider = (offsetX, offsetY) => {
    if (Math.hypot(offsetX, offsetY) > maximumTranslation + EPSILON) return;
    const candidateState = {
      offsetX, offsetY, a11: 1, a12: 0, a21: 0, a22: 1,
    };
    const score = patchScore(luma, model, candidateState);
    if (score === null) return;
    candidates += 1;
    if (best === null
      || score.correlation > best.score.correlation
      || (score.correlation === best.score.correlation
        && score.edgeContrast > best.score.edgeContrast)) {
      best = { state: candidateState, score };
    }
  };
  for (let y = -coarseSteps; y <= coarseSteps; y += 1) {
    for (let x = -coarseSteps; x <= coarseSteps; x += 1) {
      consider(x * spacing, y * spacing);
    }
  }
  for (let refinement = 0; refinement < 2 && best !== null; refinement += 1) {
    spacing /= 2;
    const centerX = best.state.offsetX;
    const centerY = best.state.offsetY;
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        consider(centerX + x * spacing, centerY + y * spacing);
      }
    }
  }
  const accepted = best !== null
    && best.score.correlation >= MIN_PREALIGN_CORRELATION
    && best.score.edgeContrast >= MIN_EDGE_CONTRAST;
  if (trace) {
    Object.assign(trace, {
      candidates,
      offset: best === null ? null : [best.state.offsetX, best.state.offsetY],
      maximumTranslation,
      correlation: best?.score.correlation ?? null,
      edgeContrast: best?.score.edgeContrast ?? null,
      reject: accepted ? null : 'score-reject',
    });
  }
  if (!accepted) return { ok: false, reason: 'score-reject' };
  return { ok: true, state: best.state };
}

function affineCorrection(luma, model, state, rangeCells, trace) {
  const internalRange = rangeCells * model.searchPitch;
  const boundaryRange = rangeCells * 0.7 * model.searchPitch;
  const boundaryEdges = model.edges.filter((edge) => edge.boundary);
  const internalEdges = model.edges.filter((edge) => !edge.boundary);
  const minimumBoundarySamples = Math.max(
    MIN_PATCH_SAMPLES,
    Math.ceil(boundaryEdges.length * MIN_BOUNDARY_COVERAGE),
  );
  const observations = [];
  for (const edge of model.edges) {
    const offset = transformedPoint(state, edge.dx, edge.dy);
    const normal = transformedNormal(state, edge);
    if (normal === null) continue;
    const observed = measureEdgeOffset(
      luma,
      model.center.x + offset.x,
      model.center.y + offset.y,
      { ...edge, ...normal },
      edge.boundary ? boundaryRange : internalRange,
    );
    if (observed === null) continue;
    const qx = state.a11 * edge.dx + state.a12 * edge.dy;
    const qy = state.a21 * edge.dx + state.a22 * edge.dy;
    const ux = qx / model.searchPitch;
    const uy = qy / model.searchPitch;
    observations.push({
      boundary: edge.boundary,
      side: edge.boundarySide,
      offset: observed.offset,
      weight: Math.max(MIN_EDGE_CONTRAST, observed.contrast),
      limit: Math.max(
        0.75,
        (edge.boundary ? boundaryRange : internalRange) * 0.35,
      ),
      row: [
        normal.normalX,
        normal.normalY,
        normal.normalX * ux,
        normal.normalX * uy,
        normal.normalY * ux,
        normal.normalY * uy,
      ],
    });
  }
  const boundaryCandidates = observations.filter((entry) => entry.boundary);
  const internalCandidates = observations.filter((entry) => !entry.boundary);
  if (trace) {
    Object.assign(trace, {
      internalEdges: internalEdges.length,
      boundaryEdges: boundaryEdges.length,
      internalCandidates: internalCandidates.length,
      candidates: boundaryCandidates.length,
      minimumBoundarySamples,
      inliers: 0,
      supportedSides: 0,
      reject: null,
    });
  }
  if (boundaryCandidates.length < minimumBoundarySamples) {
    if (trace) trace.reject = 'candidates';
    return { ok: false, reason: 'boundary-candidates' };
  }
  if (internalCandidates.length < MIN_PATCH_SAMPLES) {
    if (trace) trace.reject = 'internal-candidates';
    return { ok: false, reason: 'edge-observations' };
  }
  if (observations.length < 6) {
    if (trace) trace.reject = 'rank';
    return { ok: false, reason: 'rank' };
  }

  let robustWeights = observations.map(() => 1);
  let solved = null;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    solved = solveAffineSystem(observations, robustWeights);
    if (!solved.ok) {
      if (trace) Object.assign(trace, solved, { reject: solved.reason });
      return solved;
    }
    robustWeights = observations.map((observation) => {
      const residual = Math.abs(affineResidual(observation, solved.solution));
      return residual <= observation.limit ? 1 : observation.limit / residual;
    });
  }
  let inliers = observations.filter((observation) =>
    Math.abs(affineResidual(observation, solved.solution)) <= observation.limit);
  let stableInliers = false;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const boundaryInliers = inliers.filter((entry) => entry.boundary);
    const internalInliers = inliers.filter((entry) => !entry.boundary);
    const support = boundarySupport(boundaryInliers);
    if (trace) {
      trace.inliers = boundaryInliers.length;
      trace.internalInliers = internalInliers.length;
      trace.supportedSides = support.supportedSides;
      trace.sideCounts = Object.fromEntries(support.sideCounts);
    }
    if (boundaryInliers.length < minimumBoundarySamples) {
      if (trace) trace.reject = 'inliers';
      return { ok: false, reason: 'boundary-inliers' };
    }
    if (support.supportedSides < 2) {
      if (trace) trace.reject = 'supported-sides';
      return { ok: false, reason: 'supported-sides' };
    }
    if (internalInliers.length < MIN_PATCH_SAMPLES) {
      if (trace) trace.reject = 'internal-inliers';
      return { ok: false, reason: 'edge-inliers' };
    }
    if (inliers.length < 6) {
      if (trace) trace.reject = 'rank';
      return { ok: false, reason: 'rank' };
    }
    solved = solveAffineSystem(inliers);
    if (!solved.ok) {
      if (trace) Object.assign(trace, solved, { reject: solved.reason });
      return solved;
    }
    const nextInliers = observations.filter((observation) =>
      Math.abs(affineResidual(observation, solved.solution)) <= observation.limit);
    if (nextInliers.length === inliers.length
      && nextInliers.every((observation, index) => observation === inliers[index])) {
      inliers = nextInliers;
      stableInliers = true;
      break;
    }
    inliers = nextInliers;
  }
  if (!stableInliers) {
    if (trace) trace.reject = 'inlier-unstable';
    return { ok: false, reason: 'inlier-unstable' };
  }
  const finalBoundaryInliers = inliers.filter((entry) => entry.boundary);
  const finalInternalInliers = inliers.filter((entry) => !entry.boundary);
  const finalSupport = boundarySupport(finalBoundaryInliers);
  if (trace) {
    trace.inliers = finalBoundaryInliers.length;
    trace.internalInliers = finalInternalInliers.length;
    trace.supportedSides = finalSupport.supportedSides;
    trace.sideCounts = Object.fromEntries(finalSupport.sideCounts);
  }
  if (finalBoundaryInliers.length < minimumBoundarySamples) {
    if (trace) trace.reject = 'inliers';
    return { ok: false, reason: 'boundary-inliers' };
  }
  if (finalSupport.supportedSides < 2) {
    if (trace) trace.reject = 'supported-sides';
    return { ok: false, reason: 'supported-sides' };
  }
  if (finalInternalInliers.length < MIN_PATCH_SAMPLES) {
    if (trace) trace.reject = 'internal-inliers';
    return { ok: false, reason: 'edge-inliers' };
  }

  const [tx, ty, c11, c12, c21, c22] = solved.solution;
  const b11 = c11 / model.searchPitch;
  const b12 = c12 / model.searchPitch;
  const b21 = c21 / model.searchPitch;
  const b22 = c22 / model.searchPitch;
  const next = {
    offsetX: state.offsetX + tx,
    offsetY: state.offsetY + ty,
    a11: (1 + b11) * state.a11 + b12 * state.a21,
    a12: (1 + b11) * state.a12 + b12 * state.a22,
    a21: b21 * state.a11 + (1 + b22) * state.a21,
    a22: b21 * state.a12 + (1 + b22) * state.a22,
  };
  const singular = affineSingularValues(next);
  if (!affineWithinScaleBounds(next)) {
    if (trace) Object.assign(trace, { reject: 'scale-out-of-bounds', singular });
    return { ok: false, reason: 'scale-out-of-bounds', state: next };
  }
  const internalResiduals = observations.filter((entry) => !entry.boundary)
    .map((entry) => affineResidual(entry, solved.solution));
  const boundaryResiduals = inliers.filter((entry) => entry.boundary)
    .map((entry) => affineResidual(entry, solved.solution));
  const rms = (values) => values.length === 0 ? 0
    : Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  const fit = {
    rms: Math.max(rms(internalResiduals), rms(boundaryResiduals)),
    coverage: Math.min(
      internalCandidates.length / internalEdges.length,
      boundaryResiduals.length / boundaryEdges.length,
    ),
  };
  if (trace) {
    Object.assign(trace, {
      reject: null,
      solution: solved.solution,
      singularMin: solved.singularMin,
      singularMax: solved.singularMax,
      condition: solved.condition,
      fit,
      localSingular: singular,
    });
  }
  return { ok: true, state: next, fit };
}

function runIsotropicRound(luma, model, state, rangeCells, roundTrace) {
  if (roundTrace) {
    roundTrace.model = 'isotropic';
    roundTrace.edge = {};
    roundTrace.boundary = {};
    roundTrace.exit = null;
  }
  const translation = edgeCorrection(
    luma, model, state, rangeCells * model.searchPitch,
    roundTrace?.edge,
  );
  if (translation === null) {
    if (roundTrace) roundTrace.exit = 'edgeCorrection-null';
    return { ok: false, stage: 'edgeCorrection-null' };
  }
  state.offsetX += translation.offsetX;
  state.offsetY += translation.offsetY;
  const scale = boundaryScaleCorrection(
    luma, model, state, rangeCells * 0.7 * model.searchPitch,
    roundTrace?.boundary,
  );
  if (scale === null) {
    if (roundTrace) roundTrace.exit = 'boundary-null';
    return { ok: false, stage: 'boundary-null' };
  }
  state.scale += scale.scale;
  if (roundTrace) roundTrace.scale = state.scale;
  if (state.scale <= COARSE_SCALE_MIN || state.scale >= COARSE_SCALE_MAX) {
    if (roundTrace) roundTrace.exit = 'scale-out-of-bounds';
    return { ok: false, stage: 'scale-out-of-bounds' };
  }
  const fit = {
    rms: Math.max(translation.rms, scale.rms),
    coverage: Math.min(translation.coverage, scale.coverage),
  };
  if (roundTrace) {
    roundTrace.exit = 'ok';
    roundTrace.fit = fit;
  }
  return { ok: true, fit };
}

function affineStateFromIsotropic(state) {
  return {
    offsetX: state.offsetX,
    offsetY: state.offsetY,
    a11: state.scale,
    a12: 0,
    a21: 0,
    a22: state.scale,
  };
}

function finishPatch(luma, model, patch, state, fit) {
  const scored = patchScore(luma, model, state);
  if (scored === null || scored.correlation < MIN_PATCH_CORRELATION
    || scored.edgeContrast < MIN_EDGE_CONTRAST || fit.rms > 1.5) {
    return { ok: false, reason: 'score-reject', scored };
  }
  const singular = affineSingularValues(state);
  const x = model.center.x + state.offsetX + PIXEL_CENTER_OFFSET;
  const y = model.center.y + state.offsetY + PIXEL_CENTER_OFFSET;
  const cellPitch = model.cellPitch * Math.sqrt(Math.abs(singular.determinant));
  if (![x, y, cellPitch].every(Number.isFinite) || cellPitch <= 0) {
    return { ok: false, reason: 'score-reject', scored };
  }
  return {
    ok: true,
    scored,
    anchor: {
      id: patch.id,
      kind: patch.kind,
      face: patch.face,
      x,
      y,
      cellPitch,
      correlation: scored.correlation,
      coverage: Math.min(scored.coverage, fit.coverage),
      edgeResidual: fit.rms,
      localAffine: [state.a11, state.a12, state.a21, state.a22],
    },
  };
}

function stageForAffineFailure(reason) {
  if (reason === 'boundary-candidates' || reason === 'boundary-inliers'
    || reason === 'supported-sides') return 'boundary-null';
  if (reason === 'scale-out-of-bounds') return 'scale-out-of-bounds';
  if (reason === 'score-reject') return 'score-reject';
  return 'edgeCorrection-null';
}

function refinePatch(luma, H, patch, trace) {
  const model = patchModel(H, patch);
  if (trace) {
    Object.assign(trace, {
      id: patch.id,
      rounds: [],
      exit: null,
      exitRound: null,
    });
  }
  if (model === null) {
    if (trace) trace.exit = 'model-null';
    return null;
  }
  if (model.searchPitch <= 0.5) {
    if (trace) {
      trace.exit = 'searchPitch';
      trace.searchPitch = model.searchPitch;
    }
    return null;
  }
  if (trace) {
    trace.searchPitch = model.searchPitch;
    trace.modelCellPitch = model.cellPitch;
  }

  const coarseTrace = trace ? {
    round: 'coarse', rangeCells: 0.45, model: 'isotropic',
  } : null;
  if (trace) trace.rounds.push(coarseTrace);
  const isotropicCoarseState = { offsetX: 0, offsetY: 0, scale: 1 };
  const isotropicCoarse = runIsotropicRound(
    luma, model, isotropicCoarseState, 0.45, coarseTrace,
  );
  let state;
  let isotropicFallbackBase = null;
  if (isotropicCoarse.ok) {
    state = affineStateFromIsotropic(isotropicCoarseState);
    isotropicFallbackBase = { ...isotropicCoarseState };
  } else {
    const isotropicExit = isotropicCoarse.stage;
    const rescueTrace = { attempts: [] };
    const prealignTrace = {};
    const prealigned = translationPrealign(
      luma, model, 0.45, prealignTrace,
    );
    const rescueAttemptTrace = { prealign: prealignTrace };
    let rescue = prealigned;
    if (prealigned.ok) {
      const rescueState = prealigned.state;
      const alignedAffineTrace = {};
      rescue = affineCorrection(
        luma, model, rescueState, 0.45, alignedAffineTrace,
      );
      rescueAttemptTrace.affine = alignedAffineTrace;
    }
    const rescueTranslation = rescue.ok
      ? Math.hypot(rescue.state.offsetX, rescue.state.offsetY) : null;
    const maximumRescueTranslation = 0.45 * model.searchPitch;
    if (rescue.ok && rescueTranslation > maximumRescueTranslation) {
      rescue = { ok: false, reason: 'translation-out-of-range' };
    }
    rescueAttemptTrace.translation = rescueTranslation;
    rescueAttemptTrace.maximumTranslation = maximumRescueTranslation;
    rescueTrace.attempts.push(rescueAttemptTrace);
    rescueTrace.reject = rescue.ok ? null : rescue.reason;
    if (coarseTrace) {
      coarseTrace.model = 'affine-rescue';
      coarseTrace.isotropicExit = isotropicExit;
      coarseTrace.affine = rescueTrace;
      coarseTrace.exit = rescue.ok ? 'ok' : isotropicExit;
    }
    if (!rescue.ok) {
      if (trace) {
        trace.exit = isotropicExit;
        trace.exitRound = 'coarse';
        trace.affineFailure = rescue.reason;
      }
      return null;
    }
    state = rescue.state;
  }

  const fineTrace = trace ? {
    round: 'fine', rangeCells: 0.16, model: 'affine', affine: {}, exit: null,
  } : null;
  if (trace) trace.rounds.push(fineTrace);
  const affineFine = affineCorrection(
    luma, model, state, 0.16, fineTrace?.affine,
  );
  let affineFailure = null;
  if (affineFine.ok) {
    let selectedFine = affineFine;
    const polishTrace = {};
    const polished = affineCorrection(
      luma, model, affineFine.state, 0.16, polishTrace,
    );
    if (fineTrace) fineTrace.polish = polishTrace;
    if (polished.ok) selectedFine = polished;
    let finished = finishPatch(
      luma, model, patch, selectedFine.state, selectedFine.fit,
    );
    if (!finished.ok && selectedFine !== affineFine) {
      selectedFine = affineFine;
      finished = finishPatch(luma, model, patch, affineFine.state, affineFine.fit);
    }
    if (finished.ok) {
      if (fineTrace) {
        fineTrace.exit = 'ok';
        fineTrace.fit = selectedFine.fit;
      }
      if (trace) {
        trace.exit = 'ok';
        trace.score = finished.scored;
        trace.fit = selectedFine.fit;
      }
      return finished.anchor;
    }
    affineFailure = finished.reason;
    if (fineTrace) fineTrace.affineScore = finished.scored;
    if (trace) trace.score = finished.scored;
  } else {
    affineFailure = affineFine.reason;
  }

  if (isotropicFallbackBase !== null) {
    const affineDiagnostics = fineTrace?.affine;
    const fallbackState = { ...isotropicFallbackBase };
    const fallback = runIsotropicRound(
      luma, model, fallbackState, 0.16, fineTrace,
    );
    if (fineTrace) {
      fineTrace.model = 'isotropic-fallback';
      fineTrace.affine = affineDiagnostics;
      fineTrace.affineExit = affineFailure;
    }
    if (fallback.ok) {
      const fallbackAffine = affineStateFromIsotropic(fallbackState);
      const postFallbackTrace = {};
      const postFallback = affineCorrection(
        luma, model, fallbackAffine, 0.16, postFallbackTrace,
      );
      if (fineTrace) fineTrace.postFallbackAffine = postFallbackTrace;
      let finished = postFallback.ok ? finishPatch(
        luma, model, patch, postFallback.state, postFallback.fit,
      ) : { ok: false };
      if (finished.ok) {
        if (fineTrace) {
          fineTrace.model = 'isotropic-seed-affine';
          fineTrace.exit = 'ok';
          fineTrace.fit = postFallback.fit;
        }
        if (trace) {
          trace.exit = 'ok';
          trace.affineFallback = affineFailure;
          trace.score = finished.scored;
          trace.fit = postFallback.fit;
        }
        return finished.anchor;
      }
      finished = finishPatch(
        luma, model, patch, fallbackAffine, fallback.fit,
      );
      if (finished.ok) {
        if (fineTrace) {
          fineTrace.exit = 'ok';
          fineTrace.fit = fallback.fit;
        }
        if (trace) {
          trace.exit = 'ok';
          trace.affineFallback = affineFailure;
          trace.score = finished.scored;
          trace.fit = fallback.fit;
        }
        return finished.anchor;
      }
      if (fineTrace) fineTrace.exit = 'score-reject';
      if (trace) {
        trace.exit = 'score-reject';
        trace.exitRound = 'fine';
        trace.affineFailure = affineFailure;
        trace.score = finished.scored;
        trace.fit = fallback.fit;
      }
      return null;
    }
    if (trace) {
      trace.exit = fallback.stage;
      trace.exitRound = 'fine';
      trace.affineFailure = affineFailure;
    }
    return null;
  }

  const failureStage = stageForAffineFailure(affineFailure);
  if (fineTrace) fineTrace.exit = failureStage;
  if (trace) {
    trace.exit = failureStage;
    trace.exitRound = 'fine';
    trace.affineFailure = affineFailure;
  }
  return null;
}

function homographyForShape(shape, n) {
  if (!shape || !Array.isArray(shape.vertices) || shape.vertices.length !== 6) return null;
  const canonical = CORNER_UNIT_OFFSETS.map((corner) => ({
    x: corner.x * n,
    y: corner.y * n,
  }));
  return estimateHomographyN(canonical, shape.vertices);
}

function homographyForAnchors(patches, anchors, excludedIndex = -1) {
  const canonical = [];
  const image = [];
  for (let index = 0; index < patches.length; index += 1) {
    if (index === excludedIndex || anchors[index] === null) continue;
    const anchor = anchors[index];
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) continue;
    canonical.push(patches[index].anchor);
    image.push({
      x: anchor.x - PIXEL_CENTER_OFFSET,
      y: anchor.y - PIXEL_CENTER_OFFSET,
    });
  }
  return canonical.length < 4 ? null : estimateHomographyN(canonical, image);
}

function reprojectionResidual(patches, anchors) {
  const detectedCount = anchors.filter((anchor) => anchor !== null).length;
  if (detectedCount < 4) return null;

  const perAnchorCells = RECTIFY_ANCHOR_IDS.map(() => null);
  // Projective H는 4점이 최소다. 검출 4개에서 하나를 빼면 3점뿐이므로
  // strict LOO는 식별 불가능하다. 객체는 유지하되 수치와 gate를 null로 둔다.
  if (detectedCount >= 5) {
    for (let index = 0; index < patches.length; index += 1) {
      const anchor = anchors[index];
      if (anchor === null || !(anchor.cellPitch > 0)) continue;
      const H = homographyForAnchors(patches, anchors, index);
      if (H === null) continue;
      const predicted = projectPoint(H, patches[index].anchor);
      if (predicted === null) continue;
      const residualPixels = Math.hypot(
        predicted.x + PIXEL_CENTER_OFFSET - anchor.x,
        predicted.y + PIXEL_CENTER_OFFSET - anchor.y,
      );
      const residualCells = residualPixels / anchor.cellPitch;
      if (Number.isFinite(residualCells)) perAnchorCells[index] = residualCells;
    }
  }

  const finite = perAnchorCells.filter(Number.isFinite);
  const complete = finite.length === detectedCount;
  const maxCells = !complete ? null : Math.max(...finite);
  const rmsCells = !complete ? null : Math.sqrt(
    finite.reduce((sum, value) => sum + value * value, 0) / finite.length,
  );
  const perFace = Object.fromEntries(FACES.map((face, faceIndex) => {
    const central = perAnchorCells[faceIndex];
    const outer = perAnchorCells[faceIndex + FACES.length];
    if (!Number.isFinite(central) || !Number.isFinite(outer)) return [face, null];
    const sum = central + outer;
    return [face, sum <= EPSILON ? 0 : Math.abs(central - outer) / sum];
  }));
  return {
    perAnchorCells,
    maxCells,
    rmsCells,
    perFace,
    gate: maxCells === null ? null
      : maxCells <= REPROJECTION_RESIDUAL_THRESHOLD_CELLS ? 'pass' : 'fail',
    thresholdCells: REPROJECTION_RESIDUAL_THRESHOLD_CELLS,
  };
}

function resultForShape(luma, shape, n, patches, trace) {
  const H = homographyForShape(shape, n);
  if (H === null) return null;
  if (trace) {
    trace.shapeScore = Number.isFinite(shape.score) ? shape.score : null;
    trace.seedH = Array.from(H);
    trace.patches = patches.map((patch) => ({ id: patch.id }));
  }
  const anchors = patches.map((patch, index) => refinePatch(
    luma, H, patch, trace?.patches[index],
  ));
  const initialDetectedCount = anchors.filter((anchor) => anchor !== null).length;
  let reseeded = false;
  if (trace) {
    trace.reseed = {
      attempted: false,
      sourceDetectedCount: initialDetectedCount,
      sourceIndices: anchors.flatMap((anchor, index) => anchor === null ? [] : [index]),
      missingIndices: anchors.flatMap((anchor, index) => anchor === null ? [index] : []),
      H: null,
      patches: [],
      adoptedIndices: [],
      detectedAfter: initialDetectedCount,
      reason: initialDetectedCount < 4 ? 'insufficient-anchors'
        : initialDetectedCount === patches.length ? 'not-needed' : 'not-attempted',
    };
  }
  if (initialDetectedCount >= 4 && initialDetectedCount < patches.length) {
    const reseedH = homographyForAnchors(patches, anchors);
    if (trace) {
      trace.reseed.attempted = true;
      trace.reseed.H = reseedH === null ? null : Array.from(reseedH);
      trace.reseed.reason = reseedH === null ? 'homography-null' : 'no-adoption';
    }
    if (reseedH !== null) {
      for (let index = 0; index < patches.length; index += 1) {
        if (anchors[index] !== null) continue;
        const patchTrace = trace ? { id: patches[index].id } : null;
        const predicted = projectPoint(reseedH, patches[index].anchor);
        if (patchTrace) {
          patchTrace.index = index;
          patchTrace.predicted = predicted === null ? null : {
            x: predicted.x + PIXEL_CENTER_OFFSET,
            y: predicted.y + PIXEL_CENTER_OFFSET,
          };
          trace.reseed.patches.push(patchTrace);
        }
        const anchor = refinePatch(luma, reseedH, patches[index], patchTrace);
        if (anchor === null) continue;
        anchors[index] = anchor;
        reseeded = true;
        if (trace) trace.reseed.adoptedIndices.push(index);
      }
    }
  }
  const detectedCount = anchors.filter((anchor) => anchor !== null).length;
  if (trace) {
    trace.reseed.detectedAfter = detectedCount;
    if (reseeded) trace.reseed.reason = 'adopted';
  }
  const correlationSum = anchors.reduce(
    (sum, anchor) => sum + (anchor === null ? 0 : anchor.correlation),
    0,
  );
  const result = {
    anchors,
    detectedCount,
    reseeded,
    correlationSum,
    shapeScore: Number.isFinite(shape.score) ? shape.score : -Infinity,
  };
  if (trace) {
    trace.detectedCount = detectedCount;
    trace.reseeded = reseeded;
    trace.correlationSum = correlationSum;
    result.trace = trace;
  }
  return result;
}

/**
 * @param {{width:number,height:number,pixels:Uint8ClampedArray}} frame
 * @param {number} n
 * @param {{trace?:object}} [options] trace는 반환 계약 밖의 선택 진단 sink다.
 * @description 반환 x/y는 입력 raster의 경계 좌표계다. 배열 인덱스 k의 픽셀 중심은 k+0.5다.
 * 성공 앵커의 localAffine은 H의 이미지 상대벡터에 곱하는 row-major 2x2 행렬이다.
 * residual.gate는 진단 전용이다. 3D 큐브 정상 6/6에서도 fail로 돌아오므로 유효성 판정에
 * 쓰지 말 것.
 * @returns {{n:number|null,layoutId:string,anchors:(object|null)[],detectedCount:number,
 *            reason:null|'invalid-input'|'unsupported-n'|'invalid-canonical'|'not-found'|'partial',
 *            reseeded:boolean,residual:null|{perAnchorCells:(number|null)[],maxCells:number|null,
 *            rmsCells:number|null,perFace:{T:number|null,L:number|null,R:number|null},
 *            gate:'pass'|'fail'|null,thresholdCells:number}}}
 */
export function detectRectifyAnchors(frame, n, options) {
  try {
    const trace = options?.trace && typeof options.trace === 'object'
      ? options.trace : null;
    if (trace) {
      Object.assign(trace, {
        shapeCount: 0,
        shapes: [],
        candidates: [],
        adopted: null,
        reseed: null,
        residual: null,
        resultReason: null,
      });
    }
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
    if (trace) {
      trace.shapeCount = shapes.length;
      trace.shapes = shapes.map((shape) => ({
        score: Number.isFinite(shape?.score) ? shape.score : null,
        estimatedN: shape?.estimatedN ?? null,
        family: shape?.blockLocator?.family ?? null,
      }));
    }
    let best = null;
    for (const shape of shapes) {
      const candidateTrace = trace ? {} : null;
      const candidate = resultForShape(luma, shape, n, patches, candidateTrace);
      if (trace && candidateTrace) trace.candidates.push(candidateTrace);
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
    if (trace) trace.adopted = best?.trace || null;
    if (trace) trace.reseed = best?.trace?.reseed || null;
    if (best === null || best.detectedCount < MIN_DETECTED_ANCHORS) {
      if (trace) trace.resultReason = 'not-found';
      return emptyResult(n, 'not-found');
    }
    if (trace) {
      trace.resultReason = best.detectedCount === RECTIFY_ANCHOR_IDS.length
        ? null : 'partial';
    }
    const residual = reprojectionResidual(patches, best.anchors);
    if (trace) {
      trace.residual = residual;
      if (best.trace) best.trace.residual = residual;
    }
    return {
      n,
      layoutId: CELL_SURFACE_FINAL_V0,
      anchors: best.anchors,
      detectedCount: best.detectedCount,
      reason: best.detectedCount === RECTIFY_ANCHOR_IDS.length ? null : 'partial',
      reseeded: best.reseeded,
      residual,
    };
  } catch {
    return emptyResult(n, 'invalid-input');
  }
}

// 합성 대조군이 검출기의 픽셀 탐색과 섞이지 않고 잔차 자 자체를 검증하도록
// 좁은 테스트 표면만 공개한다. 프로덕션 소비 계약은 detectRectifyAnchors다.
export const RECTIFY_ANCHOR_INTERNALS = Object.freeze({
  reprojectionResidualForAnchors(anchors) {
    const patches = canonicalPatches();
    if (patches === null || !Array.isArray(anchors)
      || anchors.length !== patches.length) return null;
    return reprojectionResidual(patches, anchors);
  },
});

export default detectRectifyAnchors;
