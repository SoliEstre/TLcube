/**
 * 세 면별 unit homography에서 A3와 같은 격자잠김비 F를 계산한다.
 *
 * 이 모듈은 후보 선택, gate, format, RS, runtime을 모른다. lineup도 호출자가 준다.
 */
const SQRT3_HALF = Math.sqrt(3) / 2;
const EI_X = Object.freeze([SQRT3_HALF, -SQRT3_HALF, 0]);
const EI_Y = Object.freeze([-0.5, -0.5, 1]);
const EJ_X = Object.freeze([-SQRT3_HALF, 0, SQRT3_HALF]);
const EJ_Y = Object.freeze([-0.5, 1, -0.5]);
const TAP_FRAC = 0.18;
const F_WITHIN_FLOOR = 1e-32;
const AREA_EPS = 1;
const HOMOG_W_MIN = 1e-12;

function validateField(field) {
  if (!field || !Number.isInteger(field.width) || !Number.isInteger(field.height)
    || field.width <= 1 || field.height <= 1
    || !(field.data instanceof Float32Array
      || field.data instanceof Uint8Array
      || field.data instanceof Uint16Array)
    || field.data.length < field.width * field.height) {
    throw new TypeError('유효한 Float32/Uint8/Uint16 luma field가 필요하다');
  }
}

function validateFaceHs(unitFaceHs) {
  if (!Array.isArray(unitFaceHs) || unitFaceHs.length !== 3) {
    throw new TypeError('unit face-H 3개가 필요하다');
  }
  for (const H of unitFaceHs) {
    if (!(H instanceof Float64Array) || H.length !== 9 || !Array.from(H).every(Number.isFinite)) {
      throw new TypeError('각 unit face-H는 유한한 Float64Array(9)여야 한다');
    }
  }
}

function validateN(n) {
  if (!Number.isInteger(n) || n <= 0) throw new TypeError('n은 양의 정수여야 한다');
}

function canonicalXY(face, a, b) {
  return {
    x: a * EI_X[face] + b * EJ_X[face],
    y: a * EI_Y[face] + b * EJ_Y[face],
  };
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
  const fx = x - x0;
  const fy = y - y0;
  const row0 = y0 * width;
  const row1 = (y0 + 1) * width;
  const v00 = data[row0 + x0] * scale;
  const v10 = data[row0 + x0 + 1] * scale;
  const v01 = data[row1 + x0] * scale;
  const v11 = data[row1 + x0 + 1] * scale;
  const v0 = v00 + (v10 - v00) * fx;
  const v1 = v01 + (v11 - v01) * fx;
  return v0 + (v1 - v0) * fy;
}

function projectPoint(H, point) {
  const w = H[6] * point.x + H[7] * point.y + H[8];
  const scale = Math.max(1, Math.abs(H[8]));
  if (!Number.isFinite(w) || Math.abs(w) < HOMOG_W_MIN * scale) return null;
  const inv = 1 / w;
  const x = (H[0] * point.x + H[1] * point.y + H[2]) * inv;
  const y = (H[3] * point.x + H[4] * point.y + H[5]) * inv;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function projectedQuadArea(H, face, i, j, n) {
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const projected = [];
  for (const [di, dj] of corners) {
    const canonical = canonicalXY(face, (i + di) / n, (j + dj) / n);
    const point = projectPoint(H, canonical);
    if (!point) return null;
    projected.push(point);
  }
  let area = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = projected[index];
    const b = projected[(index + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return area;
}

/**
 * @param {{width:number,height:number,data:Float32Array|Uint8Array|Uint16Array}} field
 * @param {Float64Array[]} unitFaceHs T,L,R 순서의 unit canonical -> pixel H
 * @param {number} n 격자 변 길이
 * @returns {{F:number,groupCount:number}} 호출자가 소유하는 새 결과
 */
export function faceGridLockF(field, unitFaceHs, n) {
  validateField(field);
  validateFaceHs(unitFaceHs);
  validateN(n);

  const { data, width, height } = field;
  const scale = lumaScaleOf(data);
  let frontSign = 0;
  const firstArea = projectedQuadArea(unitFaceHs[0], 0, 0, 0, n);
  if (firstArea !== null && Math.abs(firstArea) > AREA_EPS) {
    frontSign = firstArea > 0 ? 1 : -1;
  }
  let groupCount = 0;
  let sumMean = 0;
  let sumMean2 = 0;
  let sumVar = 0;

  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      for (let face = 0; face < 3; face += 1) {
        const area = projectedQuadArea(unitFaceHs[face], face, i, j, n);
        if (area === null || Math.abs(area) <= AREA_EPS) continue;
        const sign = area > 0 ? 1 : -1;
        if (frontSign !== 0 && sign !== frontSign) continue;

        let tapN = 0;
        let tapSum = 0;
        let tapSum2 = 0;
        for (let tap = 0; tap < 4; tap += 1) {
          let a = (i + 0.5) / n;
          let b = (j + 0.5) / n;
          if (tap === 1) a += TAP_FRAC / n;
          else if (tap === 2) b += TAP_FRAC / n;
          else if (tap === 3) {
            a -= TAP_FRAC * 0.5 / n;
            b -= TAP_FRAC * 0.5 / n;
          }
          const point = projectPoint(unitFaceHs[face], canonicalXY(face, a, b));
          const sample = point
            ? sample01(data, width, height, point.x, point.y, scale)
            : NaN;
          if (!Number.isFinite(sample)) continue;
          tapN += 1;
          tapSum += sample;
          tapSum2 += sample * sample;
        }
        if (tapN < 2) continue;
        const mean = tapSum / tapN;
        const variance = tapSum2 / tapN - mean * mean;
        groupCount += 1;
        sumMean += mean;
        sumMean2 += mean * mean;
        sumVar += variance < 0 ? 0 : variance;
      }
    }
  }
  if (groupCount < 2) return { F: 0, groupCount };
  const inv = 1 / groupCount;
  const meanOfMeans = sumMean * inv;
  const between = sumMean2 * inv - meanOfMeans * meanOfMeans;
  const within = sumVar * inv;
  return {
    F: (between < 0 ? 0 : between) / Math.max(within, F_WITHIN_FLOOR),
    groupCount,
  };
}

/**
 * 호출자 lineup 순서를 동점 안정성 순서로 보존한다. 이 함수는 gate나 승자를 채택하지 않는다.
 * @returns {{measures:Array,diagnostics:{best:object|null,second:object|null,margin:number}}}
 */
export function measureFaceGridConfidence(field, unitFaceHs, lineupNs) {
  if (!Array.isArray(lineupNs) || lineupNs.length === 0) {
    throw new TypeError('비어 있지 않은 lineup n 배열이 필요하다');
  }
  const seen = new Set();
  for (const n of lineupNs) {
    validateN(n);
    if (seen.has(n)) throw new TypeError('lineup n은 중복될 수 없다');
    seen.add(n);
  }
  const measures = lineupNs.map((n) => ({ n, ...faceGridLockF(field, unitFaceHs, n) }));
  const ranked = measures.map((measure, order) => ({ measure, order }))
    .sort((left, right) => right.measure.F - left.measure.F || left.order - right.order);
  const own = (entry) => entry ? { ...entry.measure } : null;
  const best = own(ranked[0]);
  const second = own(ranked[1]);
  return {
    measures: measures.map((measure) => ({ ...measure })),
    diagnostics: {
      best,
      second,
      margin: second === null || !(second.F > 0) ? Infinity : best.F / second.F,
    },
  };
}
