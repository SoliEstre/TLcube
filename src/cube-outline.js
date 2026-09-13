/**
 * 투영된 큐브 면 외곽을 얇은 polygon으로 그리는 순수 helper예요.
 * 생성기 preview/export 전용이며 디코더 입력은 바꾸지 않아요.
 */

export const CUBE_OUTLINE_COLOR = Object.freeze({ r: 34, g: 34, b: 34 });
export const CUBE_OUTLINE_WIDTH = 0.05;
const EPS = 1e-12;
const KEY_SCALE = 1e6;

function finitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function readQuad(entry) {
  if (!entry) return null;
  const raw = Array.isArray(entry) ? entry : entry.points || entry.points2d;
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const points = [];
  for (let i = 0; i < 4; i += 1) {
    const p = raw[i];
    if (!finitePoint(p)) return null;
    points.push({ x: p.x, y: p.y });
  }
  return points;
}

function pointKey(p) {
  return `${Math.round(p.x * KEY_SCALE)},${Math.round(p.y * KEY_SCALE)}`;
}

function edgeKey(a, b) {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function edgePolygon(a, b, width, color) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || !(len > EPS) || !Number.isFinite(width) || !(width > 0)) return null;
  const hx = (-dy / len) * (width / 2);
  const hy = (dx / len) * (width / 2);
  if (![hx, hy].every(Number.isFinite)) return null;
  return {
    kind: 'polygon',
    color: { r: color.r, g: color.g, b: color.b },
    points: [
      { x: a.x + hx, y: a.y + hy },
      { x: b.x + hx, y: b.y + hy },
      { x: b.x - hx, y: b.y - hy },
      { x: a.x - hx, y: a.y - hy },
    ],
  };
}

/**
 * @param {Array<{points?:{x:number,y:number}[],points2d?:{x:number,y:number}[]}|{x:number,y:number}[]>} faceQuads
 *   보이는 면마다 투영된 외곽 네 점. 공유 변(Y 심지 포함)은 끝점 정규화로 한 번만 그려요.
 * @param {{width?:number,color?:{r:number,g:number,b:number}}} [options]
 * @returns {{kind:'polygon',color:{r:number,g:number,b:number},points:{x:number,y:number}[]}[]}
 */
export function cubeOutlineShapes(faceQuads, options = {}) {
  const width = options.width === undefined ? CUBE_OUTLINE_WIDTH : options.width;
  const color = options.color || CUBE_OUTLINE_COLOR;
  if (!Number.isFinite(width) || !(width > 0)) return [];
  if (!color || ![color.r, color.g, color.b].every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) {
    return [];
  }
  if (!Array.isArray(faceQuads)) return [];
  const seen = new Set();
  const shapes = [];
  for (const entry of faceQuads) {
    const quad = readQuad(entry);
    if (!quad) continue;
    for (let i = 0; i < 4; i += 1) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const key = edgeKey(a, b);
      if (pointKey(a) === pointKey(b) || seen.has(key)) continue;
      const shape = edgePolygon(a, b, width, color);
      if (!shape) continue;
      seen.add(key);
      shapes.push(shape);
    }
  }
  return shapes;
}
