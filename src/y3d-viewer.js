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

import { CORNER_UNIT_OFFSETS, SQRT3 } from './hexgrid.js';
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

/**
 * 한 셀 한 면의 색.
 *
 * ⭐ **digit 만으로는 부족하다** (2026-08-26 운영자 신고 「파인더 영역에 구멍이 뚫린다」).
 * 셀 표면 로케이터(`cellSurface`)를 켜면 파인더 칸은 `digit: null` 이고 대신
 * **`tones: {T,L,R}`** (면별 절대 레벨 인덱스)를 든다. 실측: Y0 v0 에서 169칸 중
 * **30칸**이 그 모양이다 (`role:'locator'`).
 *
 * 종전 뷰어는 `digitAt` 이 null 이면 그 칸을 **통째로 건너뛰어** 구멍이 됐다.
 * 2.5D(`sceneY.js` §locator)는 같은 자리에서 tones 를 읽어 칠하므로 꽉 찬다 —
 * 두 렌더가 갈렸던 것이고, 여기서 **같은 화법**으로 맞춘다.
 *
 * `levelAt(i, j, face)` 는 호출자가 주는 «절대 레벨 인덱스 또는 null» 이다.
 * null 이면 digit 경로로 떨어진다 — 로케이터가 없는 구성에서는 종전과 완전히 같다.
 */
function colorOfCell(digit, face, tones, levels, levelAt, i, j) {
  if (typeof levelAt === 'function') {
    const lv = levelAt(i, j, face);
    if (Number.isInteger(lv) && lv >= 0 && lv < levels.length) return levels[lv];
  }
  return colorOfDigit(digit, face, tones, levels);
}

function quadDepth(corners) {
  let s = 0;
  for (const p of corners) s += p.x + p.y + p.z;
  return s / corners.length;
}

/**
 * 이 quad 가 카메라를 **등지고 있나**. 부호만 쓴다 — `>0` 이면 뒤를 본다.
 *
 * 시선은 depth 와 같은 축이다: `quadDepth` 가 (x+y+z)/4 이고 «값이 클수록 멀다» 이므로
 * «멀어지는 방향» = (1,1,1). 바깥쪽 법선이 그쪽을 향하면 그 면은 뒤를 보는 것이다.
 *
 * ⚠ **감기(winding) 순서를 믿지 않는다.** `cubePoint` 는 T·L·R 를 각자 편한 파라메트릭
 *    순서로 내므로 세 면의 감기가 같지 않다. 대신 «큐브 중심 → quad 중심» 벡터로
 *    바깥쪽을 정한다 — 모델이 볼록 상자라 이 판정은 회전과 무관하게 옳다.
 */
function outwardFacing(corners, center) {
  const [p0, p1, , p3] = corners;
  const ux = p1.x - p0.x; const uy = p1.y - p0.y; const uz = p1.z - p0.z;
  const vx = p3.x - p0.x; const vy = p3.y - p0.y; const vz = p3.z - p0.z;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  let cx = 0; let cy = 0; let cz = 0;
  for (const p of corners) { cx += p.x; cy += p.y; cz += p.z; }
  cx = cx / corners.length - center.x;
  cy = cy / corners.length - center.y;
  cz = cz / corners.length - center.z;
  if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; }
  return nx + ny + nz;
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
  /** (i,j,face) → 절대 레벨 인덱스 | null. 로케이터 칸용. 없으면 digit 경로만 쓴다. */
  const levelAt = options.levelAt;
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
      // ⚠ digit 이 없어도 **levelAt 이 색을 낼 수 있으면 그린다** — 로케이터 칸이 그렇다.
      //    종전엔 무조건 건너뛰어 파인더가 구멍이 됐다 (운영자 신고 2026-08-26).
      const hasDigit = digit !== null && digit !== undefined;
      const hasLevel = typeof levelAt === 'function'
        && YFACES.some((f) => Number.isInteger(levelAt(i, j, f)));
      if (!hasDigit && !hasLevel) continue;
      for (const face of YFACES) {
        const raw = moduleCorners3d(face, i, j);
        const corners = raw.map((p) => orbitPoint(p, yaw, pitch, center));
        quads.push({
          kind: 'module',
          face,
          i,
          j,
          digit,
          color: colorOfCell(digit, face, tones, levels, levelAt, i, j),
          corners3d: corners,
          points2d: corners.map((p) => isoProject(p.x, p.y, p.z, layout)),
          depth: quadDepth(corners),
          facing: outwardFacing(corners, center),
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
        facing: outwardFacing(corners, center),
      });
    }
  }

  // ── 칠하는 순서: ①등진 면 먼저 ②그 안에서 먼 것부터 ────────────────────────
  //
  // ⚠ **depth 만으로는 못 가른다** (2026-08-26 운영자 신고 「특정 각도 넘어가면 셀이
  //    투명해진다」). 뒷면은 n×n 을 통째로 덮는 **큰 사각 한 장**이라 depth 가 «중심
  //    한 점» 이고, 앞면 셀은 작아서 제 자리의 depth 를 갖는다. n=13 에서 뒷면 중심
  //    depth 26 vs 앞면 먼 구석 셀 25 — **여유가 1** 이다. 조금만 돌리면 구석 셀이
  //    26 을 넘어 «더 멀다» 로 정렬되고, 뒤이어 칠해진 뒷면이 그 위를 덮는다.
  //    실측(n=13, yaw 0~90° × pitch ±30° 격자 133점): **118점에서 최대 143칸**이
  //    그렇게 묻혔다. pitch ±10° 만으로 이미 6~10칸이다 — 「특정 각도」가 아니라
  //    **정위치(0,0)만 우연히 0** 이었다.
  //
  // 고친 방법: **면이 어느 쪽을 보는가**를 먼저 본다. 모델은 볼록 상자 [0,n]³ 라
  //    ①등진 면끼리는 서로 안 겹치고 ②마주 보는 면끼리도 서로 안 겹치며 ③겹침은
  //    «등진 면 ↔ 마주 보는 면» 사이에서만 난다. 그래서 등진 것을 **전부 먼저** 칠하면
  //    depth 의 대표점 오차와 무관하게 항상 옳다. 뒷면을 지우지 않고 남겨 둔 이유는
  //    데이터 없는 칸의 구멍으로 «속» 이 비쳐 보이면 안 되기 때문이다.
  //
  // depth 정렬은 그대로 둔다 — 같은 무리 안에서는 여전히 먼 것부터가 맞고,
  // 나중에 볼록하지 않은 요소가 붙어도 한 겹의 방어가 남는다.
  quads.sort((a, b) => {
    const af = a.facing < 0 ? 1 : 0; // 1 = 카메라를 마주 본다
    const bf = b.facing < 0 ? 1 : 0;
    if (af !== bf) return af - bf; // 등진 면(0) 을 먼저 칠한다
    return b.depth - a.depth;
  });

  // 회전 불변 반지름 — `fitViewStable` 이 이 값으로 스케일을 고정한다.
  //
  // ⚠ **회전된 코너를 훑지 마라.** 처음엔 그렇게 짰는데, 회전이 부동소수 잡음을 넣어
  //    같은 모델인데도 각도마다 반지름이 **1 ulp** 씩 달라졌다 (27.268938433450444 vs
  //    …45045). 스케일이 사실상 같아도 «불변» 이라는 성질 자체가 깨진다.
  //
  // 모델은 항상 축정렬 상자 [0,n]³ 이고 중심이 (n/2,n/2,n/2) 이므로 최원점은 꼭짓점,
  // 거리는 **닫힌 형태** (n/2)·√3 이다. 회전과 무관하고 잡음도 없다.
  // (실측 대조: n=13 → 11.258, 코너 스캔 결과와 같다.)
  const radius3d = (n / 2) * SQRT3;
  return { n, yaw, pitch, quads, center, radius3d };
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

/**
 * **회전 불변** 캔버스 맞춤 변환 (2026-08-26 운영자 신고).
 *
 * 종전 `fitView` 는 **투영점의 2D bbox** 로 스케일을 잡았다. bbox 는 회전하면 변하므로
 * 「돌릴 때마다 «출력 가능한 최대 크기» 로 다시 맞춰져 크기가 계속 바뀌는」 상태가 됐다.
 *
 * 처방: 스케일을 **회전에 안 변하는 양**에서 뽑는다.
 *   · `radius3d` — 중심에서 가장 먼 코너까지의 3D 거리. 회전은 거리를 보존하니 불변이다.
 *   · `projMax`  — `isoProject` 가 단위 벡터를 얼마나 늘릴 수 있나의 상한.
 *     투영이 **선형**이라 이 값은 layout 만의 함수고 회전과 무관하다.
 * ⇒ 화면 반지름 = `radius3d × projMax` 로 고정하고, 중심은 캔버스 중앙에 못 박는다.
 *
 * 대가: 어떤 각도에서는 여백이 조금 남는다 (최악 각도 기준으로 잡으므로). 그 대신
 * **어느 각도에서도 안 잘리고 크기가 안 흔들린다** — 회전 UI 에서는 그쪽이 맞다.
 */
export function fitViewStable(mesh, width, height, pad, layout) {
  const margin = pad === undefined ? 24 : pad;
  // isoProject 의 최대 확대율. 선형이라 단위 구면을 훑으면 상한이 정확히 나온다.
  // 기저 세 벡터의 상만으로는 부족하다 (대각 방향이 더 길 수 있다) — 그래서 샘플링한다.
  const zero = { size: layout.size, originX: 0, originY: 0 };
  let projMax = 0;
  const STEPS = 64;
  for (let a = 0; a < STEPS; a += 1) {
    const th = (a / STEPS) * Math.PI * 2;
    for (let b = 0; b <= STEPS / 2; b += 1) {
      const ph = (b / (STEPS / 2)) * Math.PI;
      const ux = Math.sin(ph) * Math.cos(th);
      const uy = Math.sin(ph) * Math.sin(th);
      const uz = Math.cos(ph);
      const p = isoProject(ux, uy, uz, zero);
      const r = Math.hypot(p.x, p.y);
      if (r > projMax) projMax = r;
    }
  }
  const screenR = Math.max(mesh.radius3d * projMax, 1e-9);
  const avail = Math.min(width, height) / 2 - margin;
  const scale = Math.max(avail, 1) / screenR;
  const c = isoProject(mesh.center.x, mesh.center.y, mesh.center.z, layout);
  const ox = width / 2 - c.x * scale;
  const oy = height / 2 - c.y * scale;
  return {
    scale,
    map(p) { return { x: p.x * scale + ox, y: p.y * scale + oy }; },
  };
}

/** 투영점의 축정렬 bbox → 캔버스 맞춤 변환. ⚠ 회전하면 스케일이 변한다 —
 *  회전 UI 에는 `fitViewStable` 을 쓴다. 정지 렌더(내보내기 등)용으로만 남긴다. */
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
  // 회전 UI 는 **안정 맞춤**을 쓴다 (크기가 안 흔들린다). layout 이 없으면 종전 경로.
  const view = (opts.layout && mesh.radius3d && mesh.center)
    ? fitViewStable(mesh, width, height, opts.pad, opts.layout)
    : fitView(mesh.quads, width, height, opts.pad);
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
