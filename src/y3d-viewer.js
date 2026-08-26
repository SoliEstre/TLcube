/**
 * y3d-viewer.js — Type Y 3D 뷰어 레이어
 *
 * scene.js / sceneY.js 를 수정하지 않는다. 큐브 좌표를 frozen isometric 으로
 * 투영하면 `ygrid.moduleQuad` 와 점 단위로 같다. yaw/pitch 는 그 위에 얹는
 * 궤도 회전일 뿐이고, PNG·SVG 파이프라인은 이 모듈을 import 하지 않는다.
 *
 * 생성기에서는 **opt-in** 이다. 기본 미리보기는 2.5D 그대로다.
 *
 * 런타임 의존성 0. 브라우저 ESM · node --test 둘 다 로드 가능.
 */

import { CORNER_UNIT_OFFSETS } from './hexgrid.js';
import { YFACES } from './ygrid.js';
import { digitToRanks } from './lehmer.js';
import { digitToPattern } from './tonemap.js';

/** 아이소메트릭 세 축 = ygrid FACE_BASIS 가 쓰는 꼭짓점 그대로. */
const C1 = CORNER_UNIT_OFFSETS[1];
const C3 = CORNER_UNIT_OFFSETS[3];
const C5 = CORNER_UNIT_OFFSETS[5];

/**
 * 화면-오른쪽 · 화면-위 3D 축 (cube-space).
 * 카메라가 (1,1,1) 쪽에서 원점을 볼 때, frozen isometric 의 가로·세로와 같다.
 * 정규화는 호출 측에서 한 번만 한다.
 */
const SCREEN_RIGHT = Object.freeze({ x: 1, y: -1, z: 0 });
const SCREEN_UP = Object.freeze({ x: 1, y: 1, z: -2 });

const RIGHT_LEN = Math.sqrt(2);
const UP_LEN = Math.sqrt(6);

/** 면 (a,b) 파라메트릭 → 큐브 좌표. T:z=0 · R:y=0 · L:x=0. */
export function cubePoint(face, a, b) {
  if (face === 'T') return { x: a, y: b, z: 0 };
  if (face === 'R') return { x: b, y: 0, z: a };
  if (face === 'L') return { x: 0, y: a, z: b };
  throw new RangeError(`면 라벨은 T | L | R 이어야 한다: ${face}`);
}

/**
 * Frozen isometric. layout 원점·크기 규약은 ygrid.facePoint 와 동일.
 * yaw=pitch=0 에서 moduleCorners3d 투영 = ygrid.moduleQuad.
 */
export function isoProject(x, y, z, layout) {
  const size = layout.size;
  return {
    x: layout.originX + (x * C1.x + y * C5.x + z * C3.x) * size + 0,
    y: layout.originY + (x * C1.y + y * C5.y + z * C3.y) * size + 0,
  };
}

export function moduleCorners3d(face, i, j) {
  return [
    cubePoint(face, i, j),
    cubePoint(face, i + 1, j),
    cubePoint(face, i + 1, j + 1),
    cubePoint(face, i, j + 1),
  ];
}

function rotateAround(p, axis, axisLen, angle) {
  if (angle === 0) return p;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ax = axis.x / axisLen;
  const ay = axis.y / axisLen;
  const az = axis.z / axisLen;
  const dot = p.x * ax + p.y * ay + p.z * az;
  const t = 1 - c;
  return {
    x: p.x * c + (ay * p.z - az * p.y) * s + ax * dot * t,
    y: p.y * c + (az * p.x - ax * p.z) * s + ay * dot * t,
    z: p.z * c + (ax * p.y - ay * p.x) * s + az * dot * t,
  };
}

/**
 * 큐브 중심 기준 궤도. pitch = 화면-오른쪽 축, yaw = 화면-위 축.
 * (0,0) 은 frozen isometric 과 같다.
 */
export function orbitPoint(p, yaw, pitch, center) {
  const q = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
  const r = rotateAround(q, SCREEN_RIGHT, RIGHT_LEN, pitch);
  const s = rotateAround(r, SCREEN_UP, UP_LEN, yaw);
  return { x: s.x + center.x, y: s.y + center.y, z: s.z + center.z };
}

export function cubeCenter(n) {
  const h = n / 2;
  return { x: h, y: h, z: h };
}

function colorOfDigit(digit, face, tones, levels) {
  if (tones === 2) {
    const bit = digitToPattern(digit)[face];
    return levels[bit ? 2 : 0];
  }
  return levels[digitToRanks(digit)[face]];
}

function quadDepth(corners) {
  let s = 0;
  for (const p of corners) s += p.x + p.y + p.z;
  return s / corners.length;
}

const BACK_COLOR = Object.freeze({ r: 36, g: 40, b: 48 });

/**
 * 보이는 세 면의 n×n 모듈 + (옵션) 데이터 없는 뒷면 3장.
 * `digitAt(i,j)` 가 null/undefined 인 칸은 건너뛴다.
 *
 * @returns {{n:number, yaw:number, pitch:number, quads:object[]}}
 */
export function buildOrbitMesh(options) {
  const n = options.n;
  const tones = options.tones === undefined ? 3 : options.tones;
  const levels = options.levels;
  const layout = options.layout;
  const yaw = options.yaw === 0 ? 0 : (options.yaw || 0);
  const pitch = options.pitch === 0 ? 0 : (options.pitch || 0);
  const digitAt = options.digitAt;
  const includeBack = options.includeBack !== false;
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`n 은 1 이상의 정수여야 한다: ${n}`);
  }
  if (tones !== 2 && tones !== 3) {
    throw new RangeError(`tones 는 2 | 3 이어야 한다: ${tones}`);
  }
  const center = cubeCenter(n);
  const quads = [];

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const digit = digitAt(i, j);
      if (digit === null || digit === undefined) continue;
      for (const face of YFACES) {
        const raw = moduleCorners3d(face, i, j);
        const corners = raw.map((p) => orbitPoint(p, yaw, pitch, center));
        quads.push({
          kind: 'module',
          face,
          i,
          j,
          digit,
          color: colorOfDigit(digit, face, tones, levels),
          corners3d: corners,
          points2d: corners.map((p) => isoProject(p.x, p.y, p.z, layout)),
          depth: quadDepth(corners),
        });
      }
    }
  }

  if (includeBack) {
    const backs = [
      { face: 'T-', corners: [{ x: 0, y: 0, z: n }, { x: n, y: 0, z: n }, { x: n, y: n, z: n }, { x: 0, y: n, z: n }] },
      { face: 'R-', corners: [{ x: 0, y: n, z: 0 }, { x: n, y: n, z: 0 }, { x: n, y: n, z: n }, { x: 0, y: n, z: n }] },
      { face: 'L-', corners: [{ x: n, y: 0, z: 0 }, { x: n, y: n, z: 0 }, { x: n, y: n, z: n }, { x: n, y: 0, z: n }] },
    ];
    for (const back of backs) {
      const corners = back.corners.map((p) => orbitPoint(p, yaw, pitch, center));
      quads.push({
        kind: 'back',
        face: back.face,
        i: -1,
        j: -1,
        digit: null,
        color: BACK_COLOR,
        corners3d: corners,
        points2d: corners.map((p) => isoProject(p.x, p.y, p.z, layout)),
        depth: quadDepth(corners),
      });
    }
  }

  quads.sort((a, b) => a.depth - b.depth);
  return { n, yaw, pitch, quads };
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), o);
    o += p.byteLength;
  }
  return out;
}

function bytesToB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * 보이는 세 면만 glTF 2.0 JSON 으로. three.js / GLTFExporter 없음.
 * 뒷면은 포맷 밖이라 넣지 않는다.
 *
 * 생성기 UI 에는 이 경로를 **배선하지 않는다** (지금은 값이 없다 — 필요하면
 * 이 함수로 손짠 JSON 이면 된다). lab 페이지(`tools/y3d-viewer.html`)만 쓴다.
 */
export function meshToGltf(mesh) {
  const modules = mesh.quads.filter((q) => q.kind === 'module');
  const pos = new Float32Array(modules.length * 4 * 3);
  const col = new Float32Array(modules.length * 4 * 3);
  const idx = new Uint16Array(modules.length * 6);
  let v = 0;
  let t = 0;
  for (const q of modules) {
    const base = v;
    for (const p of q.corners3d) {
      pos[v * 3] = p.x;
      pos[v * 3 + 1] = p.y;
      pos[v * 3 + 2] = p.z;
      col[v * 3] = q.color.r / 255;
      col[v * 3 + 1] = q.color.g / 255;
      col[v * 3 + 2] = q.color.b / 255;
      v += 1;
    }
    idx[t] = base;
    idx[t + 1] = base + 1;
    idx[t + 2] = base + 2;
    idx[t + 3] = base;
    idx[t + 4] = base + 2;
    idx[t + 5] = base + 3;
    t += 6;
  }
  const posBytes = new Uint8Array(pos.buffer);
  const colBytes = new Uint8Array(col.buffer);
  const idxBytes = new Uint8Array(idx.buffer);
  const bin = concatBytes([posBytes, colBytes, idxBytes]);
  const colOff = posBytes.byteLength;
  const idxOff = colOff + colBytes.byteLength;
  return {
    asset: { version: '2.0', generator: 'tlcube-y3d-viewer' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, COLOR_0: 1 },
        indices: 2,
        mode: 4,
        material: 0,
      }],
    }],
    materials: [{
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    }],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: v, type: 'VEC3',
        min: min3(pos, v), max: max3(pos, v),
      },
      { bufferView: 1, componentType: 5126, count: v, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: t, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: colOff, byteLength: colBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBytes.byteLength, target: 34963 },
    ],
    buffers: [{
      byteLength: bin.byteLength,
      uri: 'data:application/octet-stream;base64,' + bytesToB64(bin),
    }],
  };
}

function min3(pos, count) {
  const m = [pos[0], pos[1], pos[2]];
  for (let i = 1; i < count; i += 1) {
    if (pos[i * 3] < m[0]) m[0] = pos[i * 3];
    if (pos[i * 3 + 1] < m[1]) m[1] = pos[i * 3 + 1];
    if (pos[i * 3 + 2] < m[2]) m[2] = pos[i * 3 + 2];
  }
  return m;
}

function max3(pos, count) {
  const m = [pos[0], pos[1], pos[2]];
  for (let i = 1; i < count; i += 1) {
    if (pos[i * 3] > m[0]) m[0] = pos[i * 3];
    if (pos[i * 3 + 1] > m[1]) m[1] = pos[i * 3 + 1];
    if (pos[i * 3 + 2] > m[2]) m[2] = pos[i * 3 + 2];
  }
  return m;
}

export function hexOf(c) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** 투영점의 축정렬 bbox → 캔버스 맞춤 변환. */
export function fitView(quads, width, height, pad) {
  const margin = pad === undefined ? 24 : pad;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of quads) {
    for (const p of q.points2d) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const bw = Math.max(maxX - minX, 1e-9);
  const bh = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((width - 2 * margin) / bw, (height - 2 * margin) / bh);
  const ox = (width - bw * scale) / 2 - minX * scale;
  const oy = (height - bh * scale) / 2 - minY * scale;
  return {
    map(p) {
      return { x: p.x * scale + ox, y: p.y * scale + oy };
    },
  };
}

export function paintQuads(ctx, mesh, options) {
  const opts = options || {};
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const bg = opts.background || { r: 14, g: 16, b: 24 };
  ctx.fillStyle = hexOf(bg);
  ctx.fillRect(0, 0, width, height);
  const view = fitView(mesh.quads, width, height, opts.pad);
  const selected = opts.selected;
  for (const q of mesh.quads) {
    const pts = q.points2d.map(view.map);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length; k += 1) ctx.lineTo(pts[k].x, pts[k].y);
    ctx.closePath();
    ctx.fillStyle = hexOf(q.color);
    ctx.fill();
    const hit = selected
      && q.kind === 'module'
      && q.face === selected.face
      && q.i === selected.i
      && q.j === selected.j;
    ctx.strokeStyle = hit ? '#ffe08a' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = hit ? 2.5 : 0.6;
    ctx.stroke();
  }
  if (opts.labels && mesh.n === 1) {
    const faces = mesh.quads.filter((q) => q.kind === 'module');
    ctx.font = '600 18px ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const q of faces) {
      const pts = q.points2d.map(view.map);
      const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
      const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
      ctx.fillStyle = q.color.r + q.color.g + q.color.b > 360 ? '#1a1d24' : '#f4f6fb';
      ctx.fillText(q.face, cx, cy);
    }
  }
  return view;
}

/** 뒤쪽 쿼드부터 히트 테스트 (화면에 보이는 것 우선). */
export function hitTest(mesh, view, x, y) {
  for (let i = mesh.quads.length - 1; i >= 0; i -= 1) {
    const q = mesh.quads[i];
    if (q.kind !== 'module') continue;
    const pts = q.points2d.map(view.map);
    if (pointInQuad(pts, x, y)) return { face: q.face, i: q.i, j: q.j, digit: q.digit };
  }
  return null;
}

function pointInQuad(pts, x, y) {
  return pointInTri(pts[0], pts[1], pts[2], x, y) || pointInTri(pts[0], pts[2], pts[3], x, y);
}

function pointInTri(a, b, c, x, y) {
  const s = (a.x - c.x) * (y - c.y) - (a.y - c.y) * (x - c.x);
  const t = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
  if ((s < 0) !== (t < 0) && s !== 0 && t !== 0) return false;
  const d = (c.x - b.x) * (y - b.y) - (c.y - b.y) * (x - b.x);
  return d === 0 || (d < 0) === (s + t <= 0);
}

export const Y3D_FACES = YFACES;
export const ISO_AXES = Object.freeze({ C1, C3, C5, SCREEN_RIGHT, SCREEN_UP });
