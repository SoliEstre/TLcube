/**
 * 관측된 큐브 외곽 6점을 면별 사영 기하로만 해석한다.
 *
 * 이 절단면은 n/layout/format/body/RS/R2를 알지 못한다. D6 열두 방향과
 * pose-faceH/sil3-nearpoint 두 가지를 선택 없이 모두 반환한다.
 */
import { estimateCubePose } from './cube-pose.js';
import { estimateHomography4 } from './homography.js';
import { orbitPoint, projectPoint as projectCube, cubeCenter } from '../y3d-viewer.js';

const UNIT_N = 1;
const UNIT_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });
const SQRT3_HALF = Math.sqrt(3) / 2;
const AREA_EPS = 1;
const HOMOG_W_MIN = 1e-12;
const EI_X = Object.freeze([SQRT3_HALF, -SQRT3_HALF, 0]);
const EI_Y = Object.freeze([-0.5, -0.5, 1]);
const EJ_X = Object.freeze([-SQRT3_HALF, 0, SQRT3_HALF]);
const EJ_Y = Object.freeze([-0.5, 1, -0.5]);
const FACE_LABELS = Object.freeze(['T', 'L', 'R']);
const FACE_INDEX = Object.freeze({ T: 0, L: 1, R: 2 });
const CORNER_AS_FACE = Object.freeze([
  Object.freeze({ face: 'T', a: 1, b: 1 }),
  Object.freeze({ face: 'T', a: 1, b: 0 }),
  Object.freeze({ face: 'R', a: 1, b: 1 }),
  Object.freeze({ face: 'R', a: 1, b: 0 }),
  Object.freeze({ face: 'L', a: 1, b: 1 }),
  Object.freeze({ face: 'L', a: 1, b: 0 }),
]);
const FACE_QUAD = Object.freeze({
  T: Object.freeze([['near', 0, 0], [1, 1, 0], [0, 1, 1], [5, 0, 1]]),
  L: Object.freeze([['near', 0, 0], [5, 1, 0], [4, 1, 1], [3, 0, 1]]),
  R: Object.freeze([['near', 0, 0], [3, 1, 0], [2, 1, 1], [1, 0, 1]]),
});

function canonicalXY(face, a, b) {
  return {
    x: a * EI_X[face] + b * EJ_X[face],
    y: a * EI_Y[face] + b * EJ_Y[face],
  };
}

function facePoint(face, a, b) {
  return {
    T: { x: a, y: b, z: 0 },
    R: { x: b, y: 0, z: a },
    L: { x: 0, y: a, z: b },
  }[face];
}

function validVertices(vertices) {
  return Array.isArray(vertices)
    && vertices.length === 6
    && vertices.every((point) => point
      && Number.isFinite(point.x)
      && Number.isFinite(point.y));
}

function homographyDeterminant(H) {
  return H[0] * (H[4] * H[8] - H[5] * H[7])
    - H[1] * (H[3] * H[8] - H[5] * H[6])
    + H[2] * (H[3] * H[7] - H[4] * H[6]);
}

function finiteNondegenerateHomographies(faceHs) {
  if (!Array.isArray(faceHs) || faceHs.length !== 3) return false;
  for (const H of faceHs) {
    if (!H || H.length < 9) return false;
    for (let index = 0; index < 9; index += 1) {
      if (!Number.isFinite(H[index])) return false;
    }
    if (homographyDeterminant(H) === 0) return false;
  }
  return true;
}

function ownFiniteHomographies(faceHs) {
  return finiteNondegenerateHomographies(faceHs)
    ? faceHs.map((H) => Float64Array.from(H))
    : null;
}

function fitUnitPose(sil6) {
  const centerX = sil6.reduce((sum, point) => sum + point.x, 0) / 6;
  const centerY = sil6.reduce((sum, point) => sum + point.y, 0) / 6;
  const cellPitch = sil6.reduce((sum, point) =>
    sum + Math.hypot(point.x - centerX, point.y - centerY), 0) / 6;
  const observations = sil6.map((point, index) => ({
    id: index,
    ...CORNER_AS_FACE[index],
    x: point.x,
    y: point.y,
    cellPitch,
  }));
  return estimateCubePose(observations, { n: UNIT_N, layout: UNIT_LAYOUT });
}

function unitProjector(params) {
  const center = cubeCenter(UNIT_N);
  return (point) => {
    const rotated = orbitPoint(point, params.yaw, params.pitch, center, params.roll);
    const projected = projectCube(rotated, UNIT_LAYOUT, center, params.invDist);
    return {
      x: params.offX + projected.x * params.ppu,
      y: params.offY + projected.y * params.ppu,
    };
  };
}

function poseFaceHs(params) {
  const project = unitProjector(params);
  const faceHs = [null, null, null];
  for (const face of FACE_LABELS) {
    const index = FACE_INDEX[face];
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    faceHs[index] = estimateHomography4(
      corners.map(([a, b]) => canonicalXY(index, a, b)),
      corners.map(([a, b]) => project(facePoint(face, a, b))),
    );
  }
  return faceHs;
}

function silhouetteFaceHs(sil6, near) {
  const faceHs = [null, null, null];
  for (const face of FACE_LABELS) {
    const index = FACE_INDEX[face];
    faceHs[index] = estimateHomography4(
      FACE_QUAD[face].map(([, a, b]) => canonicalXY(index, a, b)),
      FACE_QUAD[face].map(([corner]) => corner === 'near' ? near : sil6[corner]),
    );
  }
  return faceHs;
}

function failure(direction, method, reason, residual) {
  return {
    ok: false,
    direction: {
      id: direction.id,
      flip: direction.flip,
      rotation: direction.rotation,
      vertices: direction.sil6.map((point) => ({ x: point.x, y: point.y })),
    },
    method,
    faceHs: null,
    unitPoseResidual: residual ? { ...residual } : null,
    reason,
  };
}

/**
 * @param {Array<{x:number,y:number}>} rawVertices 원화소 외곽점 6개
 * @returns {Generator<object>} 항상 D6×2 = 24개를 기존 순서로 낸다.
 */
export function* iterateCubeFaceGeometry(rawVertices) {
  if (!validVertices(rawVertices)) {
    throw new TypeError('유한한 외곽점 6개가 필요하다');
  }
  const input = rawVertices.map((point) => ({ x: point.x, y: point.y }));
  const directions = [];
  for (let flip = 0; flip < 2; flip += 1) {
    for (let rotation = 0; rotation < 6; rotation += 1) {
      const sil6 = [];
      for (let k = 0; k < 6; k += 1) {
        const index = flip
          ? ((rotation - k) % 6 + 6) % 6
          : (rotation + k) % 6;
        sil6.push({ ...input[index] });
      }
      directions.push({
        id: `${flip ? 'reverse' : 'forward'}-r${rotation}`,
        flip,
        rotation,
        sil6,
      });
    }
  }

  for (const direction of directions) {
    let pose;
    try {
      pose = fitUnitPose(direction.sil6);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      yield failure(direction, 'pose-faceH', reason, null);
      yield failure(direction, 'sil3-nearpoint', reason, null);
      continue;
    }
    if (!pose || !pose.params || !pose.residual) {
      const reason = pose && pose.reason ? String(pose.reason) : 'unit-pose-failed';
      yield failure(direction, 'pose-faceH', reason, pose && pose.residual);
      yield failure(direction, 'sil3-nearpoint', reason, pose && pose.residual);
      continue;
    }
    const residual = { ...pose.residual };
    const near = unitProjector(pose.params)({ x: 0, y: 0, z: 0 });
    for (const method of ['pose-faceH', 'sil3-nearpoint']) {
      // 한 next()가 한 mode만 계산한다. 기존 배열 API는 아래에서 이 generator를 끝까지 소비해요.
      const candidateHs = method === 'pose-faceH'
        ? poseFaceHs(pose.params)
        : silhouetteFaceHs(direction.sil6, near);
      const faceHs = ownFiniteHomographies(candidateHs);
      if (!faceHs) {
        yield failure(direction, method, 'degenerate-or-nonfinite-face-H', residual);
        continue;
      }
      yield {
        ok: true,
        direction: {
          id: direction.id,
          flip: direction.flip,
          rotation: direction.rotation,
          vertices: direction.sil6.map((point) => ({ x: point.x, y: point.y })),
        },
        method,
        faceHs,
        unitPoseResidual: { ...residual },
        reason: null,
      };
    }
  }
}

/** 기존 동기 소비자의 배열·순서·소유권 계약을 그대로 보존해요. */
export function enumerateCubeFaceGeometry(rawVertices) {
  return Array.from(iterateCubeFaceGeometry(rawVertices));
}

function lumaScaleOf(data) {
  if (data instanceof Uint8Array) return 1 / 255;
  if (data instanceof Uint16Array) return 1 / 65535;
  return 1;
}

function sample01(data, width, height, x, y, scale) {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return NaN;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fractionX = x - x0;
  const fractionY = y - y0;
  const row0 = y0 * width;
  const row1 = y1 * width;
  const top = data[row0 + x0] * scale
    + (data[row0 + x1] * scale - data[row0 + x0] * scale) * fractionX;
  const bottom = data[row1 + x0] * scale
    + (data[row1 + x1] * scale - data[row1 + x0] * scale) * fractionX;
  return top + (bottom - top) * fractionY;
}

function projectInto(H, x, y, output, offset) {
  const w = H[6] * x + H[7] * y + H[8];
  const scale = Math.max(1, Math.abs(H[8]));
  if (!Number.isFinite(w) || Math.abs(w) < HOMOG_W_MIN * scale) return false;
  const inverse = 1 / w;
  const imageX = (H[0] * x + H[1] * y + H[2]) * inverse;
  const imageY = (H[3] * x + H[4] * y + H[5]) * inverse;
  if (!Number.isFinite(imageX) || !Number.isFinite(imageY)) return false;
  output[offset] = imageX;
  output[offset + 1] = imageY;
  return true;
}

function projectUnitQuadInto(H, face, i, j, size, output) {
  for (let corner = 0; corner < 4; corner += 1) {
    const a = (i + (corner === 1 || corner === 2 ? 1 : 0)) / size;
    const b = (j + (corner === 2 || corner === 3 ? 1 : 0)) / size;
    const canonical = canonicalXY(face, a, b);
    if (!projectInto(H, canonical.x, canonical.y, output, corner * 2)) return false;
  }
  return true;
}

function doubleArea(quad) {
  return quad[0] * quad[3] - quad[2] * quad[1]
    + quad[2] * quad[5] - quad[4] * quad[3]
    + quad[4] * quad[7] - quad[6] * quad[5]
    + quad[6] * quad[1] - quad[0] * quad[7];
}

/**
 * unit face-H와 명시적인 scan 좌표를 휘도 버퍼로만 바꾼다.
 *
 * alpha는 읽지 않는다. 기존 Y adapter와 같이 이 함수의 입력은 이미 합성된 luma이고,
 * Float32/Uint8/Uint16 표본만 각각 1, 1/255, 1/65535 배율로 읽는다.
 * 화면 밖이거나 세 면 중 하나라도 유효하지 않은 셀은 visible=0, 세 면 휘도=0이다.
 *
 * @returns {number} 세 면이 모두 유효한 셀 수
 */
export function sampleUnitFaceHsInto(
  luma,
  faceHs,
  n,
  scan,
  faceLuma,
  visibleCells,
) {
  const size = Number(n);
  if (!luma || !Number.isInteger(luma.width) || !Number.isInteger(luma.height)
    || luma.width <= 1 || luma.height <= 1
    || !luma.data || luma.data.length < luma.width * luma.height
    || !Number.isInteger(size) || size <= 0
    || !Array.isArray(scan)
    || !faceLuma || faceLuma.length < scan.length * 3
    || !visibleCells || visibleCells.length < scan.length) {
    throw new TypeError('유효한 luma, n, scan, 출력 버퍼가 필요하다');
  }
  if (!finiteNondegenerateHomographies(faceHs)) {
    throw new TypeError('유한하고 비퇴화한 face-H 3개가 필요하다');
  }
  for (const point of scan) {
    if (!point || !Number.isInteger(point.i) || !Number.isInteger(point.j)) {
      throw new TypeError('scan 좌표는 정수 i,j여야 한다');
    }
  }

  faceLuma.fill(0, 0, scan.length * 3);
  visibleCells.fill(0, 0, scan.length);
  const scale = lumaScaleOf(luma.data);
  const quad = new Float64Array(8);
  let frontSign = 0;
  if (projectUnitQuadInto(faceHs[0], 0, 0, 0, size, quad)) {
    const area = doubleArea(quad);
    if (Math.abs(area) > AREA_EPS) frontSign = area > 0 ? 1 : -1;
  }
  let visibleCount = 0;
  for (let cell = 0; cell < scan.length; cell += 1) {
    const { i, j } = scan[cell];
    if (i < 0 || j < 0 || i >= size || j >= size) continue;
    let facesOk = 0;
    for (let face = 0; face < 3; face += 1) {
      if (!projectUnitQuadInto(faceHs[face], face, i, j, size, quad)) continue;
      const area = doubleArea(quad);
      if (Math.abs(area) <= AREA_EPS) continue;
      const sign = area > 0 ? 1 : -1;
      if (frontSign !== 0 && sign !== frontSign) continue;
      const canonical = canonicalXY(face, (i + 0.5) / size, (j + 0.5) / size);
      const projected = projectInto(faceHs[face], canonical.x, canonical.y, quad, 0);
      const value = projected
        ? sample01(luma.data, luma.width, luma.height, quad[0], quad[1], scale)
        : NaN;
      if (!Number.isFinite(value)) continue;
      const byte = value * 255;
      faceLuma[cell * 3 + face] = byte < 0 ? 0 : byte > 255 ? 255 : byte + 0.5 | 0;
      facesOk += 1;
    }
    if (facesOk === 3) {
      visibleCells[cell] = 1;
      visibleCount += 1;
    } else {
      faceLuma[cell * 3] = 0;
      faceLuma[cell * 3 + 1] = 0;
      faceLuma[cell * 3 + 2] = 0;
    }
  }
  return visibleCount;
}
