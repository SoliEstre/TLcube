/**
 * Type X 투영 — 사이트 격자를 rectified pinhole 카메라로 화면에 놓아요(rd-8 합성 렌더와 rd-3 oracle 단계의 공통 기하).
 *
 * 좌표 규약(계약 X.1·X.6.1):
 *   - 물체 좌표 P = pitch·((x,y,z) − (N−1)/2) — 큐브 중심이 원점, 축은 사이트 축과 같아요(오른손 좌표계).
 *   - 카메라 좌표 X_c = R·P + t, 화면 u = fx·X/Z + cx, v = fy·Y/Z + cy (Z>0 이 카메라 앞). 좌우/상하 반전 없음.
 *   - R 은 3×3 행 우선 배열(9). 오일러는 `xRotation({yaw,pitch,roll})` = Rz(roll)·Rx(pitch)·Ry(yaw), 라디안.
 *   - 카메라 보정은 계약대로 `{model:'pinhole-rectified', width, height, fx, fy, cx, cy}` (px). 렌즈 왜곡·굴절(X-P)은 이 모듈 밖.
 *
 * 이 모듈은 «알려진 pose 의 순투영» 만 해요 — 검출·PnP·bootstrap 은 x-finder(codex) 소유예요.
 */
import { xSiteCoord } from './x-layout.js';

export const X_CAMERA_MODEL = 'pinhole-rectified';

/** 오일러 → 3×3(행 우선). Rz(roll)·Rx(pitch)·Ry(yaw). */
export function xRotation({ yaw = 0, pitch = 0, roll = 0 } = {}) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  return mat3Mul(Rz, mat3Mul(Rx, Ry));
}

export function mat3Mul(a, b) {
  const out = new Array(9);
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) {
    out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return out;
}

export function mat3Apply(R, p) {
  return [
    R[0] * p[0] + R[1] * p[1] + R[2] * p[2],
    R[3] * p[0] + R[4] * p[1] + R[5] * p[2],
    R[6] * p[0] + R[7] * p[1] + R[8] * p[2],
  ];
}

export function assertXCamera(camera) {
  if (!camera || camera.model !== X_CAMERA_MODEL) throw new RangeError(`camera.model 은 '${X_CAMERA_MODEL}' 이어야 해요`);
  for (const key of ['width', 'height', 'fx', 'fy', 'cx', 'cy']) {
    if (!Number.isFinite(camera[key])) throw new RangeError(`camera.${key} 가 유한수가 아니에요`);
  }
  if (!(Number.isInteger(camera.width) && Number.isInteger(camera.height) && camera.width >= 1 && camera.height >= 1)) throw new RangeError('camera.width/height 는 1 이상 정수여야 해요');
  if (!(camera.fx > 0 && camera.fy > 0)) throw new RangeError('camera.fx/fy 는 양수여야 해요');
  return camera;
}

/**
 * 관측 조건 정규화(rd-8): «거리/폭 D/L · 방위각 · 고도 · 롤» 로 카메라 pose 를 만들어요. 카메라는 원점(큐브 중심)을 봐요.
 * 큐브 폭 L = pitch·(N−1). 카메라 중심은 방향 d(az,el) 의 거리 D 에 두고, 광축은 −d 예요.
 * @returns {{R:number[], t:number[], distance:number, direction:number[]}}
 */
export function xCameraLookAt({ N, pitch = 1, distanceOverWidth = 3, azimuth = 0, elevation = 0, roll = 0 }) {
  if (!Number.isInteger(N) || N < 2) throw new RangeError(`N 은 2 이상 정수여야 해요: ${N}`);
  if (!(Number.isFinite(pitch) && pitch > 0) || !(Number.isFinite(distanceOverWidth) && distanceOverWidth > 0)) throw new RangeError('pitch·distanceOverWidth 는 유한 양수여야 해요');
  for (const [k, v] of Object.entries({ azimuth, elevation, roll })) if (!Number.isFinite(v)) throw new RangeError(`${k} 가 유한수가 아니에요`);
  const width = pitch * (N - 1);
  const distance = distanceOverWidth * width;
  // 시선 방향 d: 구면 좌표(방위각은 y 축 둘레 — az 0 이 +z, 고도는 xz 평면 위 각)
  const d = [Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)];
  const centre = [d[0] * distance, d[1] * distance, d[2] * distance];
  // 카메라 z 축 = −d(원점을 향함). 오른쪽 축은 up 벡터 전환 없이 방위각만의 함수 xc = (cos az, 0, −sin az) 로 잡아요
  // (codex REPORT_003 P1: |d_y|>.99 에서 up 을 바꾸면 연속 고도 sweep 의 roll 이 180° 튀어요). xc ⟂ d 는 항등적으로 성립하고
  // (az=0, el=0) 에서 xc=+x, yc = zc×xc = −y — 세계 +y 가 화면 위로 보여요(roll 0 = 바로 선 큐브). 극점(el=±90°)에서는
  // 방위각 자체가 비유일하니 «입력 az 궤적에 대한 연속성» 만 주장해요.
  const zc = [-d[0], -d[1], -d[2]];
  const xc = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
  const yc = cross(zc, xc);
  // R 의 행 = 카메라 축(세계 좌표) → X_c = R·P
  let R = [xc[0], xc[1], xc[2], yc[0], yc[1], yc[2], zc[0], zc[1], zc[2]];
  // roll 은 카메라 좌표계에서 왼쪽 곱: (X',Y') = (cos r·X − sin r·Y, sin r·X + cos r·Y). 정규화 평면에서 +π/2 → (x,y) ↦ (−y, x);
  // 픽셀로는 (du,dv) ↦ (−fx/fy·dv, fy/fx·du) — fx=fy 일 때만 (−dv, du). 화면(v 아래) 기준으로 내용이 시계 방향으로 돌아요.
  if (roll) R = mat3Mul([Math.cos(roll), -Math.sin(roll), 0, Math.sin(roll), Math.cos(roll), 0, 0, 0, 1], R);
  const Rc = mat3Apply(R, centre);
  const t = [-Rc[0], -Rc[1], -Rc[2]];
  return { R, t, distance, direction: d, width };
}

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

/** pose 검사 — 길이만이 아니라 원소 유한성까지(NaN 원소는 «카메라 뒤» 와 구별이 안 되는 NaN 투영으로 숨어요) */
export function assertXPose(pose) {
  if (!pose || !Array.isArray(pose.R) || pose.R.length !== 9 || !Array.isArray(pose.t) || pose.t.length !== 3) throw new TypeError('pose 는 {R:9, t:3} 이어야 해요');
  // 인덱스 루프 — `every` 는 희소 배열(new Array(9)) 의 구멍을 건너뛰어 통과시켜요(codex REPORT_004)
  for (let i = 0; i < 9; i += 1) if (!Number.isFinite(pose.R[i])) throw new RangeError(`pose.R[${i}] 가 유한수가 아니에요`);
  for (let i = 0; i < 3; i += 1) if (!Number.isFinite(pose.t[i])) throw new RangeError(`pose.t[${i}] 가 유한수가 아니에요`);
  return pose;
}

/**
 * 전 사이트 순투영.
 * @returns {{N, pitch, points: Array<{siteId, u, v, z, inFrame, inFront}>, pitchPx: number}}
 *   pitchPx = 큐브 중심 깊이에서의 1 pitch 화면 길이(관측 조건 정규화용)
 */
export function xProjectSites({ N, pitch = 1, pose, camera }) {
  assertXCamera(camera);
  assertXPose(pose);
  if (!Number.isInteger(N) || N < 2 || !(Number.isFinite(pitch) && pitch > 0)) throw new RangeError(`N(정수 ≥2)·pitch(유한 >0) 가 아니에요: ${N}, ${pitch}`);
  const half = (N - 1) / 2;
  const points = new Array(N ** 3);
  for (let siteId = 0; siteId < N ** 3; siteId += 1) {
    const s = xSiteCoord(N, siteId);
    const P = [pitch * (s[0] - half), pitch * (s[1] - half), pitch * (s[2] - half)];
    const c = mat3Apply(pose.R, P);
    const X = c[0] + pose.t[0], Y = c[1] + pose.t[1], Z = c[2] + pose.t[2];
    const inFront = Z > 1e-9;
    const u = inFront ? camera.fx * X / Z + camera.cx : NaN;
    const v = inFront ? camera.fy * Y / Z + camera.cy : NaN;
    const inFrame = inFront && u >= 0 && u < camera.width && v >= 0 && v < camera.height;
    points[siteId] = { siteId, u, v, z: Z, inFront, inFrame };
  }
  const centreDepth = pose.t[2];
  const pitchPx = centreDepth > 0 ? camera.fx * pitch / centreDepth : NaN;
  return { N, pitch, points, pitchPx };
}

/**
 * 겹침 판정 — 화면 거리 < minSepPx 인 «점등» 사이트 쌍은 둘 다 overlap(양쪽 소거, rd-6 어휘).
 * 해시 격자(셀 = minSepPx) 로 O(n + 조사 후보쌍 수) — 점이 한 버킷에 몰리면(정면 시선의 열) 후보쌍이 제곱으로 늘어요.
 * @param {Array<{siteId,u,v,inFrame}>} points
 * @param {Uint8Array|number[]} lit 사이트별 1(점등)/0
 * @returns {Uint8Array} 사이트별 1 = overlap
 */
export function xOverlapMask(points, lit, minSepPx) {
  const overlap = new Uint8Array(points.length);
  if (!(minSepPx > 0)) return overlap;
  const cell = minSepPx;
  const grid = new Map();
  const keyOf = (u, v) => `${Math.floor(u / cell)},${Math.floor(v / cell)}`;
  for (const p of points) {
    if (!p.inFrame || !lit[p.siteId]) continue;
    const k = keyOf(p.u, p.v);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  for (const p of points) {
    if (!p.inFrame || !lit[p.siteId]) continue;
    const gu = Math.floor(p.u / cell), gv = Math.floor(p.v / cell);
    for (let du = -1; du <= 1; du += 1) for (let dv = -1; dv <= 1; dv += 1) {
      const bucket = grid.get(`${gu + du},${gv + dv}`);
      if (!bucket) continue;
      for (const q of bucket) {
        if (q.siteId === p.siteId) continue;
        if (Math.hypot(q.u - p.u, q.v - p.v) < minSepPx) { overlap[p.siteId] = 1; overlap[q.siteId] = 1; }
      }
    }
  }
  return overlap;
}
