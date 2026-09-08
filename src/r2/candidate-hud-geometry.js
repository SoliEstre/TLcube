/** 후보 HUD의 Y 평면 · C 육각 · Y face-H 기하를 실제 producer snapshot에서 만든다. */
import { FACES, facePolygon, hexCorners, regionCells } from '../hexgrid.js';
import { notchCellsC } from '../notchC.js';
import { faceBasis } from '../ygrid.js';
import { buildRoleGrids, HUD_ROLE, HUD_TONE_NONE } from '../r2-hud-model.js';
import { faceQuadFloats, faceQuadSlot, finiteBoundsInto, projectFaceQuadsInto, projectOutlineInto, projectPointInto } from './hud-geometry.js';

const IDENTITY = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function finiteH(H) {
  return H && H.length === 9 && Array.from(H).every(Number.isFinite);
}

/** 만들지 않고 producer 모양만 거르는 저비용 판정이에요. */
export function candidateHudMode(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const mode = candidate.geometryMode ?? 'y-grid';
  if (mode === 'c-hex') {
    return candidate.type === 'C' && Number.isInteger(candidate.k ?? candidate.n)
      && Number.isInteger(candidate.cellCount) && candidate.cellCount > 0
      && candidate.cellCoord?.length === candidate.cellCount * 2 ? mode : null;
  }
  if (mode === 'y-faces') return candidate.type === 'Y' && Number.isInteger(candidate.n) && candidate.n > 0
    && Array.isArray(candidate.faceHs) && candidate.faceHs.length === FACES.length ? mode : null;
  return mode === 'y-grid' && candidate.type === 'Y' && Number.isInteger(candidate.n) && candidate.n > 0 ? mode : null;
}

function outlineHull(k) {
  const notch = new Set(notchCellsC(k).map(({ q, r }) => `${q},${r}`));
  const points = [];
  for (const { q, r } of regionCells(k)) {
    if (notch.has(`${q},${r}`)) continue;
    for (const point of hexCorners(q, r, { size: 1, originX: 0, originY: 0 })) points.push(point);
  }
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower = [];
  for (const point of points) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop(); lower.push(point); }
  const upper = [];
  for (let i = points.length - 1; i >= 0; i -= 1) { const point = points[i]; while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
  lower.pop(); upper.pop();
  const hull = lower.concat(upper), out = new Float64Array(hull.length * 2);
  for (let i = 0; i < hull.length; i += 1) { out[i * 2] = hull[i].x; out[i * 2 + 1] = hull[i].y; }
  return out;
}

function canonicalHex(candidate) {
  const k = candidate.k ?? candidate.n;
  const coords = candidate.cellCoord;
  const count = candidate.cellCount;
  if (!Number.isInteger(k) || k < 1 || !Number.isInteger(count) || count < 1
    || !coords || coords.length !== count * 2) return null;
  const quads = new Float64Array(count * FACES.length * 8);
  const roleGrid = new Uint8Array(count * FACES.length).fill(HUD_ROLE.DATA);
  const scanGrid = new Int32Array(count * FACES.length);
  const toneGrid = new Uint8Array(count * FACES.length).fill(HUD_TONE_NONE);
  for (let cell = 0; cell < count; cell += 1) {
    const q = coords[cell * 2], r = coords[cell * 2 + 1];
    if (!Number.isInteger(q) || !Number.isInteger(r)) return null;
    for (let face = 0; face < FACES.length; face += 1) {
      const slot = (cell * FACES.length + face) * 8;
      const points = facePolygon(q, r, FACES[face], { size: 1, originX: 0, originY: 0 });
      for (let point = 0; point < 4; point += 1) {
        quads[slot + point * 2] = points[point].x;
        quads[slot + point * 2 + 1] = points[point].y;
      }
      scanGrid[cell * FACES.length + face] = cell;
    }
  }
  const outline = outlineHull(k);
  return { mode: 'c-hex', count, quads, roleGrid, scanGrid, toneGrid, outline, outlineCount: outline.length / 2 };
}

function canonicalY(candidate) {
  const n = candidate.n;
  const grids = buildRoleGrids(n, candidate.layoutId, candidate.formatWire);
  if (!grids) return null;
  const quads = new Float64Array(faceQuadFloats(n));
  const outline = new Float64Array(12);
  projectFaceQuadsInto(IDENTITY, n, quads);
  projectOutlineInto(IDENTITY, n, outline);
  return { mode: 'y-grid', n, count: n * n, quads,
    roleGrid: grids.roleGrid, scanGrid: grids.scanGrid, toneGrid: grids.toneGrid,
    outline, outlineCount: 6 };
}

function canonicalYFaces(candidate) {
  const n = candidate.n;
  const grids = buildRoleGrids(n, candidate.layoutId, candidate.formatWire);
  const faceHs = candidate.faceHs;
  if (!grids || !Array.isArray(faceHs) || faceHs.length !== FACES.length || faceHs.some((H) => !finiteH(H))) return null;
  const quads = new Float64Array(faceQuadFloats(n));
  const outline = new Float64Array(FACES.length * 8);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      for (let face = 0; face < FACES.length; face += 1) {
        const H = faceHs[face];
        const slot = faceQuadSlot(n, face, i, j);
        const { ei, ej } = faceBasis(FACES[face]);
        const points = [[i / n, j / n], [(i + 1) / n, j / n], [(i + 1) / n, (j + 1) / n], [i / n, (j + 1) / n]];
        for (let point = 0; point < 4; point += 1) {
          const [a, b] = points[point];
          projectPointInto(H, a * ei.x + b * ej.x, a * ei.y + b * ej.y, quads, slot + point * 2);
        }
      }
    }
  }
  for (let face = 0; face < FACES.length; face += 1) {
    const H = faceHs[face], slot = face * 8;
    const { ei, ej } = faceBasis(FACES[face]);
    const points = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let point = 0; point < 4; point += 1) {
      const [a, b] = points[point];
      projectPointInto(H, a * ei.x + b * ej.x, a * ei.y + b * ej.y, outline, slot + point * 2);
    }
  }
  return { mode: 'y-faces', n, count: n * n, quads,
    roleGrid: grids.roleGrid, scanGrid: grids.scanGrid, toneGrid: grids.toneGrid,
    outline, outlineCount: 4, outlinePaths: FACES.length };
}

/** snapshot의 mode를 검증하고, 실제 layout/좌표에서 HUD 기하를 유도한다. */
export function candidateHudGeometry(candidate) {
  const mode = candidateHudMode(candidate);
  if (mode === null) return null;
  if (mode === 'c-hex') return candidate.type === 'C' ? canonicalHex(candidate) : null;
  if (mode === 'y-faces') return candidate.type === 'Y' ? canonicalYFaces(candidate) : null;
  return mode === 'y-grid' && candidate.type === 'Y' ? canonicalY(candidate) : null;
}

/** 실제 image-space 기하. C/Y 평면은 own H, Y faces는 이미 face-H 사영된 quads를 쓴다. */
export function candidateHudFrameGeometry(candidate, canonical) {
  if (!canonical) return null;
  if (canonical.mode === 'y-faces') return canonical;
  if (!finiteH(candidate?.H)) return null;
  const quads = new Float64Array(canonical.quads.length);
  const outline = new Float64Array(canonical.outline.length);
  for (let offset = 0; offset < canonical.quads.length; offset += 2) {
    projectPointInto(candidate.H, canonical.quads[offset], canonical.quads[offset + 1], quads, offset);
  }
  for (let offset = 0; offset < canonical.outline.length; offset += 2) {
    projectPointInto(candidate.H, canonical.outline[offset], canonical.outline[offset + 1], outline, offset);
  }
  return { ...canonical, quads, outline };
}

export function candidateHudBounds(geometry, out = new Float64Array(4)) {
  if (!geometry) return null;
  return finiteBoundsInto(geometry.outline, geometry.outline.length / 2, out) ? out : null;
}

export function candidateHudQuadSlot(geometry, cell, face) {
  if (!geometry || !Number.isInteger(cell) || cell < 0 || cell >= geometry.count || !Number.isInteger(face) || face < 0 || face >= FACES.length) return -1;
  return (cell * FACES.length + face) * 8;
}
