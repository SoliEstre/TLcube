/**
 * R2 glyph-first central detector.
 *
 * The canonical glyph geometry is reduced to compact, axis-aligned correlation
 * features once in createGlyphDetector(). detectInto() then uses summed-area
 * tables and caller-owned candidate objects without allocating per frame.
 */

import {
  CENTER_SPACING_COEFF,
  CORNER_UNIT_OFFSETS,
  FACES,
  hexCorners,
  hexDistance,
  regionCells,
  facePolygon,
} from '../hexgrid.js';
import {
  maxSafeRadius,
  profileAt,
} from '../bullseye.js';
import {
  FINDER_CELL_ORDER,
} from '../finder-patterns.js';
import {
  getOakFinderPattern,
  OAK_LEVEL_FACE_INDEX,
} from '../finder-oak-patterns.js';
import {
  CENTRAL_N7_LOCATOR_CELLS,
  CENTRAL_N7_SIZE,
} from '../centralN7Schema.js';
import { centralBeaconGeometry } from '../centralBeaconWire.js';
import { moduleQuad } from '../ygrid.js';
import {
  QR_ALNUM_CHARSET,
  TL_READER_URL,
  qrMatrix,
} from '../qr.js';
import {
  Q8_ONE,
  Q15_ONE,
  Q16_ONE,
  createR2Params,
} from './params.js';

export const GLYPH_STATUS = Object.freeze({
  OK: 0,
  INVALID_ARGUMENT: 1,
  FRAME_TOO_LARGE: 2,
});

export const GLYPH_KIND = Object.freeze({
  BULLSEYE: 'bullseye',
  MINI_TL: 'mini-tl',
  QR: 'qr',
  DAEHAN: 'daehan',
});

const ROTATION_COUNT_120 = 3;
// QR v1's canonical orientation is fixed by the generator. Arbitrary image
// rotation belongs to the following pose layer; duplicating four kernels here
// would spend the glyph-first budget before that layer can vote.
const ROTATION_COUNT_QR = 1;
const KERNEL_PHASES = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 0.5, y: 0 }),
]);

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, previous = points.length - 1; i < points.length; previous = i, i += 1) {
    const a = points[i];
    const b = points[previous];
    if (
      (a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function orientation120(phase) {
  if (phase === 0) return { cos: 1, sin: 0 };
  const sin120 = CORNER_UNIT_OFFSETS[2].x;
  return phase === 1
    ? { cos: -0.5, sin: sin120 }
    : { cos: -0.5, sin: -sin120 };
}

function rotatePoint(point, orientation) {
  return {
    x: point.x * orientation.cos - point.y * orientation.sin,
    y: point.x * orientation.sin + point.y * orientation.cos,
  };
}

function packFeatureGrid(kind, minX, maxX, minY, maxY, columns, rows, active, tone) {
  const x0 = [];
  const y0 = [];
  const x1 = [];
  const y1 = [];
  const expected = [];
  const stepX = (maxX - minX) / columns;
  const stepY = (maxY - minY) / rows;

  for (let row = 0; row < rows; row += 1) {
    let column = 0;
    while (column < columns) {
      const index = row * columns + column;
      if (active[index] === 0) {
        column += 1;
        continue;
      }
      const runTone = tone[index];
      const start = column;
      column += 1;
      while (
        column < columns
        && active[row * columns + column] !== 0
        && tone[row * columns + column] === runTone
      ) {
        column += 1;
      }
      x0.push(Math.round((minX + start * stepX) * Q16_ONE));
      x1.push(Math.round((minX + column * stepX) * Q16_ONE));
      y0.push(Math.round((minY + row * stepY) * Q16_ONE));
      y1.push(Math.round((minY + (row + 1) * stepY) * Q16_ONE));
      expected.push(runTone);
    }
  }

  if (expected.length === 0) {
    throw new Error(`glyph ${kind}: 정본에서 상관 feature를 유도하지 못했다`);
  }

  return Object.freeze({
    kind,
    featureCount: expected.length,
    x0Q16: Int32Array.from(x0),
    y0Q16: Int32Array.from(y0),
    x1Q16: Int32Array.from(x1),
    y1Q16: Int32Array.from(y1),
    expected: Float64Array.from(expected),
    minXQ16: Math.min(...x0),
    minYQ16: Math.min(...y0),
    maxXQ16: Math.max(...x1),
    maxYQ16: Math.max(...y1),
  });
}

function sampledTemplate(kind, minX, maxX, minY, maxY, samplesPerPitch, sample) {
  const columns = Math.max(7, Math.ceil((maxX - minX) * samplesPerPitch));
  const rows = Math.max(7, Math.ceil((maxY - minY) * samplesPerPitch));
  const active = new Uint8Array(columns * rows);
  const tone = new Float64Array(columns * rows);
  const stepX = (maxX - minX) / columns;
  const stepY = (maxY - minY) / rows;

  for (let row = 0; row < rows; row += 1) {
    const y = minY + (row + 0.5) * stepY;
    for (let column = 0; column < columns; column += 1) {
      const x = minX + (column + 0.5) * stepX;
      const value = sample(x, y);
      if (value < 0) continue;
      const index = row * columns + column;
      active[index] = 1;
      tone[index] = value >= 0.5 ? 1 : 0;
    }
  }
  return packFeatureGrid(kind, minX, maxX, minY, maxY, columns, rows, active, tone);
}

function polygonTemplate(kind, polygons, phase, samplesPerPitch) {
  const orientation = orientation120(phase);
  const rotated = [];
  let halfWidth = 0;
  let halfHeight = 0;
  for (let i = 0; i < polygons.length; i += 1) {
    const source = polygons[i];
    const points = [];
    for (let p = 0; p < source.points.length; p += 1) {
      const point = rotatePoint(source.points[p], orientation);
      const normalized = {
        x: point.x / CENTER_SPACING_COEFF,
        y: point.y / CENTER_SPACING_COEFF,
      };
      points.push(normalized);
      halfWidth = Math.max(halfWidth, Math.abs(normalized.x));
      halfHeight = Math.max(halfHeight, Math.abs(normalized.y));
    }
    rotated.push({ points, tone: source.tone });
  }

  return sampledTemplate(
    kind,
    -halfWidth,
    halfWidth,
    -halfHeight,
    halfHeight,
    samplesPerPitch,
    (x, y) => {
      for (let i = 0; i < rotated.length; i += 1) {
        if (pointInPolygon(x, y, rotated[i].points)) return rotated[i].tone;
      }
      return -1;
    },
  );
}

function buildBullseyeTemplate(samplesPerPitch) {
  const radiusCells = maxSafeRadius(1);
  const radiusPitches = radiusCells / CENTER_SPACING_COEFF;
  return sampledTemplate(
    GLYPH_KIND.BULLSEYE,
    -radiusPitches,
    radiusPitches,
    -radiusPitches,
    radiusPitches,
    samplesPerPitch,
    (x, y) => {
      const distanceCells = Math.sqrt(x * x + y * y) * CENTER_SPACING_COEFF;
      if (distanceCells > radiusCells) return -1;
      return profileAt(distanceCells, 1);
    },
  );
}

function centralSlotRadiusForUnitCell() {
  let minimumSupport = Infinity;
  for (let axisIndex = 0; axisIndex < CORNER_UNIT_OFFSETS.length; axisIndex += 1) {
    const axis = CORNER_UNIT_OFFSETS[axisIndex];
    let support = -Infinity;
    for (let cellIndex = 0; cellIndex < FINDER_CELL_ORDER.length; cellIndex += 1) {
      const cell = FINDER_CELL_ORDER[cellIndex];
      const corners = hexCorners(cell.q, cell.r, { size: 1, originX: 0, originY: 0 });
      for (let corner = 0; corner < corners.length; corner += 1) {
        const projection = corners[corner].x * axis.x + corners[corner].y * axis.y;
        if (projection > support) support = projection;
      }
    }
    if (support < minimumSupport) minimumSupport = support;
  }
  return minimumSupport;
}

function buildMiniTlPolygons() {
  const geometry = centralBeaconGeometry();
  const markerSize = (
    centralSlotRadiusForUnitCell() * geometry.shrink
  ) / CENTRAL_N7_SIZE;
  const layout = { size: markerSize, originX: 0, originY: 0 };
  const polygons = [];
  for (let cellIndex = 0; cellIndex < CENTRAL_N7_LOCATOR_CELLS.length; cellIndex += 1) {
    const cell = CENTRAL_N7_LOCATOR_CELLS[cellIndex];
    for (let faceIndex = 0; faceIndex < FACES.length; faceIndex += 1) {
      const face = FACES[faceIndex];
      polygons.push({
        points: moduleQuad(face, cell.i, cell.j, layout),
        tone: cell[face] >= 2 ? 1 : 0,
      });
    }
  }
  return polygons;
}

function buildDaehanPolygons() {
  const pattern = getOakFinderPattern('oak-taegeuk-solo');
  if (
    pattern === undefined
    || pattern === null
    || pattern.cellLevels.length !== FINDER_CELL_ORDER.length
  ) {
    throw new Error('glyph daehan: oak-taegeuk-solo 정본을 찾지 못했다');
  }
  const layout = { size: 1, originX: 0, originY: 0 };
  const polygons = [];
  for (let cellIndex = 0; cellIndex < FINDER_CELL_ORDER.length; cellIndex += 1) {
    const cell = FINDER_CELL_ORDER[cellIndex];
    const levels = pattern.cellLevels[cellIndex];
    for (let faceIndex = 0; faceIndex < FACES.length; faceIndex += 1) {
      const face = FACES[faceIndex];
      polygons.push({
        points: facePolygon(cell.q, cell.r, face, layout),
        tone: levels[OAK_LEVEL_FACE_INDEX[face]] >= 2 ? 1 : 0,
      });
    }
  }
  return polygons;
}

function orientationValue(ax, ay, bx, by, cx, cy) {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientationValue(a.x, a.y, b.x, b.y, c.x, c.y);
  const o2 = orientationValue(a.x, a.y, b.x, b.y, d.x, d.y);
  const o3 = orientationValue(c.x, c.y, d.x, d.y, a.x, a.y);
  const o4 = orientationValue(c.x, c.y, d.x, d.y, b.x, b.y);
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function rectanglePolygonOverlap(halfSide, polygon) {
  for (let i = 0; i < polygon.length; i += 1) {
    const point = polygon[i];
    if (
      point.x > -halfSide && point.x < halfSide
      && point.y > -halfSide && point.y < halfSide
    ) {
      return true;
    }
  }

  const corners = [
    { x: -halfSide, y: -halfSide },
    { x: halfSide, y: -halfSide },
    { x: halfSide, y: halfSide },
    { x: -halfSide, y: halfSide },
  ];
  for (let i = 0; i < corners.length; i += 1) {
    if (pointInPolygon(corners[i].x, corners[i].y, polygon)) return true;
  }
  for (let edge = 0, previous = polygon.length - 1; edge < polygon.length; previous = edge, edge += 1) {
    for (let side = 0; side < corners.length; side += 1) {
      if (
        segmentsIntersect(
          polygon[previous],
          polygon[edge],
          corners[side],
          corners[(side + 1) % corners.length],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function deriveQrModulePitchCells(qrSize, safetyQ15) {
  const layout = { size: 1, originX: 0, originY: 0 };
  const ring = regionCells(3);
  const ringPolygons = [];
  for (let i = 0; i < ring.length; i += 1) {
    if (hexDistance(ring[i].q, ring[i].r) !== 3) continue;
    ringPolygons.push(hexCorners(ring[i].q, ring[i].r, layout));
  }

  function overlaps(side) {
    const half = side / 2;
    for (let i = 0; i < ringPolygons.length; i += 1) {
      if (rectanglePolygonOverlap(half, ringPolygons[i])) return true;
    }
    return false;
  }

  let lower = 0;
  let upper = CENTER_SPACING_COEFF;
  while (!overlaps(upper) && upper < 64) upper *= 2;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (overlaps(middle)) upper = middle;
    else lower = middle;
  }
  const protectedSide = lower * (safetyQ15 / Q15_ONE);
  // qrMatrix is the canonical v1 generator. Its symbol plus one protected quiet
  // module on each side is the same central-slot contract consumed by scene.js.
  return protectedSide / (qrSize + 2);
}

function deriveQrInvariantStructure() {
  const matrices = [];
  for (let trial = 0; trial < 128; trial += 1) {
    const length = 1 + (trial % 25);
    let message = '';
    for (let index = 0; index < length; index += 1) {
      const character = (trial * 17 + index * 29 + index * index * 7) % QR_ALNUM_CHARSET.length;
      message += QR_ALNUM_CHARSET[character];
    }
    matrices.push(qrMatrix(message));
  }
  matrices.push(qrMatrix(TL_READER_URL));

  const size = matrices[0].size;
  const first = matrices[0].modules;
  const stable = new Uint8Array(first.length);
  stable.fill(1);
  for (let matrixIndex = 1; matrixIndex < matrices.length; matrixIndex += 1) {
    const matrix = matrices[matrixIndex];
    if (matrix.size !== size || matrix.modules.length !== first.length) {
      throw new Error('glyph qr: qrMatrix 정본의 v1 크기가 입력에 따라 달라졌다');
    }
    for (let moduleIndex = 0; moduleIndex < first.length; moduleIndex += 1) {
      if (matrix.modules[moduleIndex] !== first[moduleIndex]) stable[moduleIndex] = 0;
    }
  }
  return { size, modules: first, stable };
}

function qrFinderCellIsDark(x, y, side) {
  return x === 0 || y === 0 || x === side - 1 || y === side - 1
    || (x >= 2 && y >= 2 && x < side - 2 && y < side - 2);
}

function deriveQrFinderGeometry(structure) {
  const { size, modules } = structure;
  for (let side = 5; side <= Math.min(11, size); side += 2) {
    const origins = [];
    for (let originY = 0; originY <= size - side; originY += 1) {
      for (let originX = 0; originX <= size - side; originX += 1) {
        let matches = true;
        for (let y = 0; y < side && matches; y += 1) {
          for (let x = 0; x < side; x += 1) {
            const expectedDark = qrFinderCellIsDark(x, y, side) ? 1 : 0;
            if (modules[(originY + y) * size + originX + x] !== expectedDark) {
              matches = false;
              break;
            }
          }
        }
        if (matches) origins.push({ x: originX, y: originY });
      }
    }
    if (origins.length === 3) return { side, origins };
  }
  throw new Error('glyph qr: qrMatrix 정본에서 세 finder를 유도하지 못했다');
}

function packQrModuleTemplate(structure, geometry, modulePitch, mode) {
  const { size, modules, stable } = structure;
  const { side, origins } = geometry;
  // Finder의 한 칸 separator는 정본 행렬의 invariant 여부로 다시 검증한다.
  const separator = 1;
  const quiet = (side + 1) / 2;
  const blockModules = mode === 0 ? size + quiet * 2 : size;
  const blockOffset = mode === 0 ? quiet : 0;
  const active = new Uint8Array(blockModules * blockModules);
  const tone = new Float64Array(blockModules * blockModules);

  if (mode === 0) {
    // Sub-pixel QR: payload는 쓰지 않고, 29-module block 안의 세 finder
    // footprint만 dark로 둔 payload-independent Haar vocabulary다.
    active.fill(1);
    tone.fill(1);
    for (let finder = 0; finder < origins.length; finder += 1) {
      const origin = origins[finder];
      for (let y = 0; y < side; y += 1) {
        for (let x = 0; x < side; x += 1) {
          tone[(blockOffset + origin.y + y) * blockModules
            + blockOffset + origin.x + x] = 0;
        }
      }
    }
  } else {
    // Resolved QR: only invariant finder + separator modules participate.
    for (let finder = 0; finder < origins.length; finder += 1) {
      const origin = origins[finder];
      const minX = Math.max(0, origin.x - separator);
      const minY = Math.max(0, origin.y - separator);
      const maxX = Math.min(size, origin.x + side + separator);
      const maxY = Math.min(size, origin.y + side + separator);
      for (let y = minY; y < maxY; y += 1) {
        for (let x = minX; x < maxX; x += 1) {
          const index = y * size + x;
          if (stable[index] === 0) continue;
          active[index] = 1;
          // qrMatrix uses 1=dark; generic NCC uses 1=light.
          tone[index] = modules[index] === 0 ? 1 : 0;
        }
      }
    }
  }

  const half = (blockModules * modulePitch) / 2;
  const packed = packFeatureGrid(
    GLYPH_KIND.QR,
    -half,
    half,
    -half,
    half,
    blockModules,
    blockModules,
    active,
    tone,
  );
  return Object.freeze({ ...packed, qrMode: mode });
}

function buildTemplates(samplesPerPitch, qrSafetyQ15) {
  const templates = [buildBullseyeTemplate(samplesPerPitch)];
  const miniTl = buildMiniTlPolygons();
  const daehan = buildDaehanPolygons();
  for (let phase = 0; phase < ROTATION_COUNT_120; phase += 1) {
    templates.push(polygonTemplate(GLYPH_KIND.MINI_TL, miniTl, phase, samplesPerPitch));
  }
  const qr = deriveQrInvariantStructure();
  const qrGeometry = deriveQrFinderGeometry(qr);
  const protectedModules = qr.size + 2;
  const modulePitch = deriveQrModulePitchCells(qr.size, qrSafetyQ15)
    / CENTER_SPACING_COEFF;
  if (!(modulePitch > 0) || protectedModules !== qr.size + 2) {
    throw new Error('glyph qr: 중앙 보호 사각 module pitch 유도 실패');
  }
  for (let turn = 0; turn < ROTATION_COUNT_QR; turn += 1) {
    // QR orientation is canonical, so turn is deliberately not applied here.
    templates.push(packQrModuleTemplate(qr, qrGeometry, modulePitch, 0));
    templates.push(packQrModuleTemplate(qr, qrGeometry, modulePitch, 1));
  }
  for (let phase = 0; phase < ROTATION_COUNT_120; phase += 1) {
    templates.push(polygonTemplate(GLYPH_KIND.DAEHAN, daehan, phase, samplesPerPitch));
  }
  return Object.freeze(templates);
}

function kindCode(kind) {
  if (kind === GLYPH_KIND.BULLSEYE) return 0;
  if (kind === GLYPH_KIND.MINI_TL) return 1;
  if (kind === GLYPH_KIND.QR) return 2;
  return 3;
}

function kindForCode(code) {
  if (code === 0) return GLYPH_KIND.BULLSEYE;
  if (code === 1) return GLYPH_KIND.MINI_TL;
  if (code === 2) return GLYPH_KIND.QR;
  return GLYPH_KIND.DAEHAN;
}

function hardScaledKernel(template, pitch, phaseX, phaseY) {
  const x0 = [];
  const y0 = [];
  const x1 = [];
  const y1 = [];
  const expected = [];
  const weight = [];
  for (let feature = 0; feature < template.featureCount; feature += 1) {
    const left = Math.floor(phaseX + (template.x0Q16[feature] * pitch) / Q16_ONE);
    const top = Math.floor(phaseY + (template.y0Q16[feature] * pitch) / Q16_ONE);
    const right = Math.floor(phaseX + (template.x1Q16[feature] * pitch) / Q16_ONE);
    const bottom = Math.floor(phaseY + (template.y1Q16[feature] * pitch) / Q16_ONE);
    if (right <= left || bottom <= top) continue;
    x0.push(left);
    y0.push(top);
    x1.push(right);
    y1.push(bottom);
    expected.push(template.expected[feature]);
    weight.push(1);
  }
  return finalizeScaledKernel(
    template, pitch, phaseX, phaseY, x0, y0, x1, y1, expected, weight,
  );
}

function denseScaledKernel(template, pitch, phaseX, phaseY, minCoverage) {
  const rasterMinX = Math.floor(phaseX + (template.minXQ16 * pitch) / Q16_ONE);
  const rasterMinY = Math.floor(phaseY + (template.minYQ16 * pitch) / Q16_ONE);
  const rasterMaxX = Math.ceil(phaseX + (template.maxXQ16 * pitch) / Q16_ONE);
  const rasterMaxY = Math.ceil(phaseY + (template.maxYQ16 * pitch) / Q16_ONE);
  const width = rasterMaxX - rasterMinX;
  const height = rasterMaxY - rasterMinY;
  const coverage = new Float64Array(width * height);
  const toneArea = new Float64Array(width * height);

  // Integrate the canonical rectangles into unique destination pixels once.
  // This constructor-only work removes sub-pixel feature collisions from the
  // per-frame path while retaining antialiased boundary coverage.
  for (let feature = 0; feature < template.featureCount; feature += 1) {
    const featureX0 = phaseX + (template.x0Q16[feature] * pitch) / Q16_ONE;
    const featureY0 = phaseY + (template.y0Q16[feature] * pitch) / Q16_ONE;
    const featureX1 = phaseX + (template.x1Q16[feature] * pitch) / Q16_ONE;
    const featureY1 = phaseY + (template.y1Q16[feature] * pitch) / Q16_ONE;
    const firstX = Math.floor(featureX0);
    const firstY = Math.floor(featureY0);
    const lastX = Math.ceil(featureX1);
    const lastY = Math.ceil(featureY1);
    for (let pixelY = firstY; pixelY < lastY; pixelY += 1) {
      const overlapY = Math.max(0, Math.min(pixelY + 1, featureY1)
        - Math.max(pixelY, featureY0));
      if (!(overlapY > 0)) continue;
      const row = (pixelY - rasterMinY) * width;
      for (let pixelX = firstX; pixelX < lastX; pixelX += 1) {
        const overlapX = Math.max(0, Math.min(pixelX + 1, featureX1)
          - Math.max(pixelX, featureX0));
        const area = overlapX * overlapY;
        if (!(area > 0)) continue;
        const index = row + pixelX - rasterMinX;
        coverage[index] += area;
        toneArea[index] += area * template.expected[feature];
      }
    }
  }

  const x0 = [];
  const y0 = [];
  const x1 = [];
  const y1 = [];
  const expected = [];
  const weight = [];
  for (let row = 0; row < height; row += 1) {
    let column = 0;
    while (column < width) {
      const index = row * width + column;
      const support = Math.min(1, coverage[index]);
      if (support < minCoverage) {
        column += 1;
        continue;
      }
      const value = toneArea[index] / coverage[index];
      const start = column;
      column += 1;
      while (column < width) {
        const next = row * width + column;
        const nextSupport = Math.min(1, coverage[next]);
        if (
          nextSupport < minCoverage
          || Math.abs(nextSupport - support) > 1e-12
          || Math.abs(toneArea[next] / coverage[next] - value) > 1e-12
        ) {
          break;
        }
        column += 1;
      }
      x0.push(rasterMinX + start);
      y0.push(rasterMinY + row);
      x1.push(rasterMinX + column);
      y1.push(rasterMinY + row + 1);
      expected.push(value);
      weight.push(support);
    }
  }
  return finalizeScaledKernel(
    template, pitch, phaseX, phaseY, x0, y0, x1, y1, expected, weight,
  );
}

function finalizeScaledKernel(
  template, pitch, phaseX, phaseY, x0, y0, x1, y1, expected, weight,
) {
  if (expected.length <= 1) return null;
  let minX = x0[0];
  let minY = y0[0];
  let maxX = x1[0];
  let maxY = y1[0];
  for (let index = 1; index < expected.length; index += 1) {
    if (x0[index] < minX) minX = x0[index];
    if (y0[index] < minY) minY = y0[index];
    if (x1[index] > maxX) maxX = x1[index];
    if (y1[index] > maxY) maxY = y1[index];
  }
  return Object.freeze({
    kind: template.kind,
    qrMode: template.qrMode === undefined ? -1 : template.qrMode,
    pitch,
    phaseX,
    phaseY,
    featureCount: expected.length,
    x0: Int32Array.from(x0),
    y0: Int32Array.from(y0),
    x1: Int32Array.from(x1),
    y1: Int32Array.from(y1),
    expected: Float64Array.from(expected),
    weight: Float64Array.from(weight),
    minX,
    minY,
    maxX,
    maxY,
  });
}

/**
 * Build a four-vocabulary central glyph detector.
 *
 * Output contract: out is either `{count,truncated,candidates}` or a plain,
 * pre-populated candidate array. In both forms every candidate object is owned
 * by the caller and is updated in place; `[0,count)` is the valid prefix.
 * Candidate fields are `{kind,cx,cy,scale,score}` where cx/cy are pixels,
 * scale is the outer code's adjacent-cell centre pitch in pixels, and score is
 * normalized cross-correlation in [-1, 1].
 */
export function createGlyphDetector(options = undefined) {
  const config = options ?? {};
  const params = createR2Params(config.params);
  const maxWidth = boundedInteger(params.glyphMaxFrameWidth, 1280, 1, 4096);
  const maxHeight = boundedInteger(params.glyphMaxFrameHeight, 720, 1, 4096);
  const maxCandidates = boundedInteger(params.glyphMaxCandidates, 64, 1, 1024);
  const maxKernelProposals = boundedInteger(params.glyphMaxKernelProposals, 16, 1, 64);
  const samplesPerPitch = boundedInteger(params.glyphKernelSamplesPerPitch, 3, 2, 16);
  const coarseFeatureStep = boundedInteger(params.glyphCoarseFeatureStep, 1, 1, 8);
  const minPitch = boundedNumber(
    Number(params.glyphMinCellPitchQ16) / Q16_ONE,
    3,
    1,
    4096,
  );
  const maxPitch = Math.max(minPitch, boundedNumber(
    Number(params.glyphMaxCellPitchQ16) / Q16_ONE,
    128,
    1,
    4096,
  ));
  const scaleStep = boundedNumber(
    Number(params.glyphScaleStepQ15) / Q15_ONE,
    1.04,
    1.005,
    2,
  );
  const scanStrideFactor = boundedNumber(
    Number(params.glyphScanStrideQ15) / Q15_ONE,
    0.50,
    0.05,
    1,
  );
  const qrScanStrideFactor = boundedNumber(
    Number(params.glyphQrScanStrideQ15) / Q15_ONE,
    0.15,
    0.05,
    1,
  );
  const threshold = boundedNumber(
    Number(params.glyphScoreThresholdQ15) / Q15_ONE,
    0.52,
    -1,
    1,
  );
  const coarseThreshold = boundedNumber(
    Number(params.glyphCoarseScoreThresholdQ15) / Q15_ONE,
    0.28,
    -1,
    1,
  );
  const bullseyeCoarseThreshold = boundedNumber(
    Number(params.glyphBullseyeCoarseScoreThresholdQ15) / Q15_ONE,
    0.12,
    -1,
    1,
  );
  const qrCoarseThreshold = boundedNumber(
    Number(params.glyphQrCoarseScoreThresholdQ15) / Q15_ONE,
    0.42,
    -1,
    1,
  );
  const qrFineThreshold = boundedNumber(
    Number(params.glyphQrFineScoreThresholdQ15) / Q15_ONE,
    0.60,
    -1,
    1,
  );
  const qrFinePitch = boundedNumber(
    Number(params.glyphQrFineCellPitchQ16) / Q16_ONE,
    5,
    minPitch,
    maxPitch,
  );
  const denseKernelMaxPitch = boundedNumber(
    Number(params.glyphDenseKernelMaxCellPitchQ16) / Q16_ONE,
    16,
    minPitch,
    maxPitch,
  );
  const kernelMinCoverage = boundedNumber(
    Number(params.glyphKernelMinCoverageQ15) / Q15_ONE,
    0.15,
    0.01,
    1,
  );
  const minStddev = boundedNumber(
    Number(params.glyphMinStddevLumaQ8) / Q8_ONE,
    5,
    0,
    255,
  );
  const minVariance = minStddev * minStddev;
  const nmsRadiusFactor = boundedNumber(
    Number(params.glyphNmsRadiusQ15) / Q15_ONE,
    0.12,
    0,
    8,
  );
  const nmsScaleRatio = boundedNumber(
    Number(params.glyphNmsScaleRatioQ15) / Q15_ONE,
    1.015,
    1,
    8,
  );
  const qrSafetyQ15 = boundedInteger(
    params.glyphQrSlotSafetyQ15,
    Math.round(0.995 * Q15_ONE),
    Math.round(0.8 * Q15_ONE),
    Q15_ONE,
  );

  const templates = buildTemplates(samplesPerPitch, qrSafetyQ15);
  const scaledKernelList = [];
  let kernelPitch = minPitch;
  while (kernelPitch <= maxPitch) {
    for (let templateIndex = 0; templateIndex < templates.length; templateIndex += 1) {
      const template = templates[templateIndex];
      if (template.qrMode === 0 && kernelPitch >= qrFinePitch) continue;
      if (template.qrMode === 1 && kernelPitch < qrFinePitch) continue;
      const approximateWidth = Math.ceil(
        ((template.maxXQ16 - template.minXQ16) * kernelPitch) / Q16_ONE,
      ) + 2;
      const approximateHeight = Math.ceil(
        ((template.maxYQ16 - template.minYQ16) * kernelPitch) / Q16_ONE,
      ) + 2;
      if (approximateWidth > maxWidth || approximateHeight > maxHeight) continue;
      for (let phaseIndex = 0; phaseIndex < KERNEL_PHASES.length; phaseIndex += 1) {
        const phase = KERNEL_PHASES[phaseIndex];
        const kernel = kernelPitch <= denseKernelMaxPitch
          ? denseScaledKernel(
            template, kernelPitch, phase.x, phase.y, kernelMinCoverage,
          )
          : hardScaledKernel(template, kernelPitch, phase.x, phase.y);
        if (
          kernel !== null
          && kernel.maxX - kernel.minX <= maxWidth
          && kernel.maxY - kernel.minY <= maxHeight
        ) {
          scaledKernelList.push(kernel);
        }
      }
    }
    const nextPitch = kernelPitch * scaleStep;
    if (!(nextPitch > kernelPitch)) break;
    kernelPitch = nextPitch;
  }
  const kernels = Object.freeze(scaledKernelList);
  const integralStride = maxWidth + 1;
  const integralLength = integralStride * (maxHeight + 1);
  // Float64 keeps luma and squared-luma summed areas exact for every supported
  // capacity while mapping directly to double/uint64 accumulators in C++.
  const integral = new Float64Array(integralLength);
  const squareIntegral = new Float64Array(integralLength);

  const candidateKind = new Uint8Array(maxCandidates);
  const candidateX = new Float64Array(maxCandidates);
  const candidateY = new Float64Array(maxCandidates);
  const candidateScale = new Float64Array(maxCandidates);
  const candidateScore = new Float64Array(maxCandidates);
  const candidateKindCount = new Uint16Array(4);
  const proposalX = new Int32Array(maxKernelProposals);
  const proposalY = new Int32Array(maxKernelProposals);
  const proposalScore = new Float64Array(maxKernelProposals);
  let candidateCount = 0;
  let candidateTruncated = 0;
  let proposalCount = 0;

  function rectangleSum(table, x0, y0, x1, y1) {
    const top = y0 * integralStride;
    const bottom = y1 * integralStride;
    return table[bottom + x1] - table[top + x1]
      - table[bottom + x0] + table[top + x0];
  }

  function buildIntegral(luma, width, height) {
    integral.fill(0, 0, width + 1);
    squareIntegral.fill(0, 0, width + 1);
    for (let y = 1; y <= height; y += 1) {
      const sourceRow = (y - 1) * width;
      const row = y * integralStride;
      const previous = (y - 1) * integralStride;
      let sum = 0;
      let squareSum = 0;
      integral[row] = 0;
      squareIntegral[row] = 0;
      for (let x = 1; x <= width; x += 1) {
        const value = Number(luma[sourceRow + x - 1]);
        sum += value;
        squareSum += value * value;
        integral[row + x] = integral[previous + x] + sum;
        squareIntegral[row + x] = squareIntegral[previous + x] + squareSum;
      }
    }
  }

  function scoreKernel(kernel, anchorX, anchorY, width, height, featureStep) {
    const minX = anchorX + kernel.minX;
    const minY = anchorY + kernel.minY;
    const maxX = anchorX + kernel.maxX;
    const maxY = anchorY + kernel.maxY;
    if (minX < 0 || minY < 0 || maxX > width || maxY > height || maxX <= minX || maxY <= minY) {
      return -1;
    }

    const boxPixels = (maxX - minX) * (maxY - minY);
    const boxSum = rectangleSum(integral, minX, minY, maxX, maxY);
    const boxSquareSum = rectangleSum(squareIntegral, minX, minY, maxX, maxY);
    const boxVariance = boxSquareSum - (boxSum * boxSum) / boxPixels;
    if (!(boxVariance > boxPixels * minVariance)) return -1;

    let samples = 0;
    let imageSum = 0;
    let imageSquareSum = 0;
    let templateSum = 0;
    let templateSquareSum = 0;
    let dot = 0;
    for (let feature = 0; feature < kernel.featureCount; feature += featureStep) {
      const x0 = anchorX + kernel.x0[feature];
      const y0 = anchorY + kernel.y0[feature];
      const x1 = anchorX + kernel.x1[feature];
      const y1 = anchorY + kernel.y1[feature];
      const area = (x1 - x0) * (y1 - y0);
      const sum = rectangleSum(integral, x0, y0, x1, y1);
      const squareSum = rectangleSum(squareIntegral, x0, y0, x1, y1);
      const expected = kernel.expected[feature];
      const weightedArea = area * kernel.weight[feature];
      samples += weightedArea;
      imageSum += sum * kernel.weight[feature];
      imageSquareSum += squareSum * kernel.weight[feature];
      templateSum += expected * weightedArea;
      templateSquareSum += expected * expected * weightedArea;
      dot += expected * sum * kernel.weight[feature];
    }
    if (samples <= 1) return -1;
    const imageVariance = imageSquareSum - (imageSum * imageSum) / samples;
    const templateVariance = templateSquareSum - (templateSum * templateSum) / samples;
    if (!(imageVariance > samples * minVariance) || !(templateVariance > 0)) return -1;
    const numerator = dot - (imageSum * templateSum) / samples;
    const denominator = Math.sqrt(imageVariance * templateVariance);
    if (!(denominator > 0)) return -1;
    return Math.max(-1, Math.min(1, numerator / denominator));
  }

  function candidateIsBetter(score, code, x, y, scale, index) {
    if (score !== candidateScore[index]) return score > candidateScore[index];
    if (code !== candidateKind[index]) return code < candidateKind[index];
    if (scale !== candidateScale[index]) return scale < candidateScale[index];
    if (y !== candidateY[index]) return y < candidateY[index];
    return x < candidateX[index];
  }

  function writeCandidate(index, code, x, y, scale, score) {
    candidateKind[index] = code;
    candidateX[index] = x;
    candidateY[index] = y;
    candidateScale[index] = scale;
    candidateScore[index] = score;
  }

  function recordCandidate(code, x, y, scale, score) {
    for (let index = 0; index < candidateCount; index += 1) {
      if (candidateKind[index] !== code) continue;
      const smallerScale = Math.min(scale, candidateScale[index]);
      const scaleRatio = Math.max(scale, candidateScale[index]) / smallerScale;
      if (scaleRatio > nmsScaleRatio) continue;
      const dx = x - candidateX[index];
      const dy = y - candidateY[index];
      const radius = nmsRadiusFactor * Math.max(scale, candidateScale[index]);
      if (dx * dx + dy * dy > radius * radius) continue;
      if (candidateIsBetter(score, code, x, y, scale, index)) {
        writeCandidate(index, code, x, y, scale, score);
      }
      return;
    }

    // Reserve an equal share for each vocabulary so one highly repetitive
    // kernel cannot evict every other kind. NMS remains strictly same-kind.
    const kindCapacity = Math.floor(maxCandidates / 4)
      + (code < (maxCandidates % 4) ? 1 : 0);
    if (candidateKindCount[code] < kindCapacity && candidateCount < maxCandidates) {
      writeCandidate(candidateCount, code, x, y, scale, score);
      candidateCount += 1;
      candidateKindCount[code] += 1;
      return;
    }

    candidateTruncated = 1;
    let worst = -1;
    for (let index = 0; index < candidateCount; index += 1) {
      if (candidateKind[index] !== code) continue;
      if (
        worst < 0
        || candidateIsBetter(
          candidateScore[worst],
          candidateKind[worst],
          candidateX[worst],
          candidateY[worst],
          candidateScale[worst],
          index,
        )
      ) {
        worst = index;
      }
    }
    if (worst >= 0 && candidateIsBetter(score, code, x, y, scale, worst)) {
      writeCandidate(worst, code, x, y, scale, score);
    }
  }

  function swapCandidates(left, right) {
    let saved = candidateKind[left];
    candidateKind[left] = candidateKind[right];
    candidateKind[right] = saved;
    saved = candidateX[left];
    candidateX[left] = candidateX[right];
    candidateX[right] = saved;
    saved = candidateY[left];
    candidateY[left] = candidateY[right];
    candidateY[right] = saved;
    saved = candidateScale[left];
    candidateScale[left] = candidateScale[right];
    candidateScale[right] = saved;
    saved = candidateScore[left];
    candidateScore[left] = candidateScore[right];
    candidateScore[right] = saved;
  }

  function sortCandidates() {
    for (let left = 0; left < candidateCount; left += 1) {
      let best = left;
      for (let right = left + 1; right < candidateCount; right += 1) {
        if (
          candidateIsBetter(
            candidateScore[right],
            candidateKind[right],
            candidateX[right],
            candidateY[right],
            candidateScale[right],
            best,
          )
        ) {
          best = right;
        }
      }
      if (best !== left) swapCandidates(left, best);
    }
  }

  function recordProposal(x, y, score, radius) {
    const radiusSquared = radius * radius;
    for (let index = 0; index < proposalCount; index += 1) {
      const dx = x - proposalX[index];
      const dy = y - proposalY[index];
      if (dx * dx + dy * dy > radiusSquared) continue;
      if (
        score > proposalScore[index]
        || (score === proposalScore[index]
          && (y < proposalY[index] || (y === proposalY[index] && x < proposalX[index])))
      ) {
        proposalX[index] = x;
        proposalY[index] = y;
        proposalScore[index] = score;
      }
      return;
    }
    if (proposalCount < maxKernelProposals) {
      proposalX[proposalCount] = x;
      proposalY[proposalCount] = y;
      proposalScore[proposalCount] = score;
      proposalCount += 1;
      return;
    }
    let worst = 0;
    for (let index = 1; index < proposalCount; index += 1) {
      if (
        proposalScore[index] < proposalScore[worst]
        || (proposalScore[index] === proposalScore[worst]
          && (proposalY[index] > proposalY[worst]
            || (proposalY[index] === proposalY[worst] && proposalX[index] > proposalX[worst])))
      ) {
        worst = index;
      }
    }
    if (
      score > proposalScore[worst]
      || (score === proposalScore[worst]
        && (y < proposalY[worst] || (y === proposalY[worst] && x < proposalX[worst])))
    ) {
      proposalX[worst] = x;
      proposalY[worst] = y;
      proposalScore[worst] = score;
    }
  }

  function scanKernel(kernel, width, height) {
    const minAnchorX = -kernel.minX;
    const minAnchorY = -kernel.minY;
    const maxAnchorX = width - kernel.maxX;
    const maxAnchorY = height - kernel.maxY;
    if (maxAnchorX < minAnchorX || maxAnchorY < minAnchorY) return;
    const strideFactor = kernel.kind === GLYPH_KIND.QR
      ? qrScanStrideFactor : scanStrideFactor;
    const stride = Math.max(1, Math.floor(kernel.pitch * strideFactor));
    const code = kindCode(kernel.kind);
    const acceptThreshold = kernel.qrMode === 0
      ? qrCoarseThreshold
      : kernel.qrMode === 1 ? qrFineThreshold : threshold;
    const kernelCoarseThreshold = kernel.kind === GLYPH_KIND.BULLSEYE
      ? bullseyeCoarseThreshold
      : coarseThreshold;
    proposalCount = 0;

    for (let y = minAnchorY; y <= maxAnchorY; y += stride) {
      for (let x = minAnchorX; x <= maxAnchorX; x += stride) {
        const coarseScore = scoreKernel(
          kernel, x, y, width, height, coarseFeatureStep,
        );
        if (coarseScore < kernelCoarseThreshold) continue;
        recordProposal(x, y, coarseScore, Math.max(1, stride * 1.5));
      }
    }

    // Refine only the bounded coarse proposal pool. A half-stride step reaches
    // the nearest coarse-cell interior; a final 1 px step resolves the centre.
    for (let proposal = 0; proposal < proposalCount; proposal += 1) {
      let bestScore = proposalScore[proposal];
      let bestX = proposalX[proposal];
      let bestY = proposalY[proposal];
      const coarseOriginX = bestX;
      const coarseOriginY = bestY;
      const delta = Math.max(1, Math.ceil(stride / 2));
      for (let offsetY = -delta; offsetY <= delta; offsetY += delta) {
        const refineY = coarseOriginY + offsetY;
        if (refineY < minAnchorY || refineY > maxAnchorY) continue;
        for (let offsetX = -delta; offsetX <= delta; offsetX += delta) {
          const refineX = coarseOriginX + offsetX;
          if (
            refineX < minAnchorX || refineX > maxAnchorX
            || (offsetX === 0 && offsetY === 0)
          ) continue;
          const score = scoreKernel(kernel, refineX, refineY, width, height, 1);
          if (
            score > bestScore
            || (score === bestScore
              && (refineY < bestY || (refineY === bestY && refineX < bestX)))
          ) {
            bestScore = score;
            bestX = refineX;
            bestY = refineY;
          }
        }
      }
      const fineOriginX = bestX;
      const fineOriginY = bestY;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const refineY = fineOriginY + offsetY;
        if (refineY < minAnchorY || refineY > maxAnchorY) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const refineX = fineOriginX + offsetX;
          if (
            refineX < minAnchorX || refineX > maxAnchorX
            || (offsetX === 0 && offsetY === 0)
          ) continue;
          const score = scoreKernel(kernel, refineX, refineY, width, height, 1);
          if (
            score > bestScore
            || (score === bestScore
              && (refineY < bestY || (refineY === bestY && refineX < bestX)))
          ) {
            bestScore = score;
            bestX = refineX;
            bestY = refineY;
          }
        }
      }
      if (bestScore < acceptThreshold) continue;
      recordCandidate(
        code,
        bestX + kernel.phaseX - 0.5,
        bestY + kernel.phaseY - 0.5,
        kernel.pitch,
        bestScore,
      );
    }
  }

  function detectInto(luma, width, height, out) {
    if (
      luma === null
      || luma === undefined
      || out === null
      || out === undefined
      || !Number.isInteger(width)
      || !Number.isInteger(height)
      || width <= 0
      || height <= 0
      || !Number.isInteger(luma.length)
      || luma.length < width * height
    ) {
      return GLYPH_STATUS.INVALID_ARGUMENT;
    }
    if (width > maxWidth || height > maxHeight) return GLYPH_STATUS.FRAME_TOO_LARGE;

    const outputCandidates = Array.isArray(out) ? out : out.candidates;
    if (
      !Array.isArray(outputCandidates)
      || outputCandidates.length <= 0
      || Object.isFrozen(out)
    ) {
      return GLYPH_STATUS.INVALID_ARGUMENT;
    }
    const outputCapacity = Math.min(outputCandidates.length, maxCandidates);
    for (let index = 0; index < outputCapacity; index += 1) {
      const candidate = outputCandidates[index];
      if (candidate === null || typeof candidate !== 'object' || Object.isFrozen(candidate)) {
        return GLYPH_STATUS.INVALID_ARGUMENT;
      }
    }

    out.count = 0;
    out.truncated = 0;
    candidateCount = 0;
    candidateTruncated = 0;
    candidateKindCount.fill(0);
    buildIntegral(luma, width, height);

    for (let kernelIndex = 0; kernelIndex < kernels.length; kernelIndex += 1) {
      scanKernel(kernels[kernelIndex], width, height);
    }

    sortCandidates();
    const outputCount = Math.min(candidateCount, outputCapacity);
    for (let index = 0; index < outputCount; index += 1) {
      const candidate = outputCandidates[index];
      candidate.kind = kindForCode(candidateKind[index]);
      candidate.cx = candidateX[index];
      candidate.cy = candidateY[index];
      candidate.scale = candidateScale[index];
      candidate.score = candidateScore[index];
    }
    out.count = outputCount;
    out.truncated = candidateTruncated || candidateCount > outputCapacity ? 1 : 0;
    return GLYPH_STATUS.OK;
  }

  return Object.freeze({
    detectInto,
    params,
    maxWidth,
    maxHeight,
    maxCandidates,
  });
}
