/**
 * hud-geometry.js — HUD 사영 기하 (순수 · 할당 0).
 *
 * 무엇인가: canonical 면 격자(Type Y 세 마름모 면)를 락 호모그래피 H 로 **분석 프레임 px**
 * 에 사영하는 계산만 담는다. 그리기·DOM·좌표 변환(프레임→스테이지 CSS px)은 호출자 몫이다.
 *
 * 왜 여기 따로 있나: HUD 는 「가이드가 있어야 할 자리」가 아니라 **정합이 실제로 본 자리**
 * 를 그린다(운영자 결정 ⑨). 그러려면 어댑터가 표본에 쓰는 것과 **같은 canonical 기저·같은
 * 사영식**을 써야 한다. 그런데 어댑터(`adapter-locator.js`)는 클린룸의 다리라 여기서
 * import 할 수 없다 — 그래서 기저는 어댑터가 쓰는 것과 같은 원본
 * (`../ygrid.js` faceBasis · `../hexgrid.js` CORNER_UNIT_OFFSETS)에서 **유도**한다.
 * 사본 상수를 적지 않는다는 뜻이다. 두 경로가 어긋나면 `test/r2-hud-geometry.test.js` 의
 * 「어댑터 일치」 자가 빨개진다.
 *
 * 계약:
 * - 순수 함수. 핫 경로(매 프레임) 할당 0 — 결과 버퍼는 호출자가 준다(`out`).
 * - 반환값은 항상 **수**(쓴 원소 수) 또는 boolean. 새 배열을 만들어 돌려주지 않는다.
 * - 사영 불가능한 점(|w| ≈ 0, 비유한)은 좌표 두 칸이 NaN 이다 — 「없음」을 값으로 표현해
 *   호출자가 건너뛸 수 있게 한다. `finiteBoundsInto` 가 그 규약을 소비한다.
 *
 * 좌표 규약(전 모듈 공통, ygrid.js 머리 참조):
 *   canonical 점 = (a·e_i + b·e_j), a,b ∈ [0,n], 원점 = Y-심.
 *   사영 px = (H0x + H1y + H2)/w, py = (H3x + H4y + H5)/w, w = H6x + H7y + H8.
 */

import { CORNER_UNIT_OFFSETS } from '../hexgrid.js';
import { YFACES, faceBasis } from '../ygrid.js';

/**
 * HUD 가 쓰는 면 라벨 순서. **어댑터 면 인덱스와 같은 배열**이어야 한다
 * (0/1/2 = T/L/R). 재선언하지 않고 ygrid 의 것을 그대로 재export 한다.
 */
export const HUD_FACES = YFACES;

/** |w| 하한. 이보다 작으면 사영이 무한대로 튀므로 NaN 으로 표시한다. */
const W_MIN = 1e-12;

/**
 * 면 기저를 평평한 Float64Array 로 펴 둔다 — 핫 루프에서 객체 프로퍼티를 타지 않기 위해.
 * ⚠ 값은 `faceBasis()` 에서 **유도**한다. 손으로 적은 √3/2 사본이 아니다.
 */
const EI_X = new Float64Array(HUD_FACES.length);
const EI_Y = new Float64Array(HUD_FACES.length);
const EJ_X = new Float64Array(HUD_FACES.length);
const EJ_Y = new Float64Array(HUD_FACES.length);
for (let f = 0; f < HUD_FACES.length; f += 1) {
  const { ei, ej } = faceBasis(HUD_FACES[f]);
  EI_X[f] = ei.x;
  EI_Y[f] = ei.y;
  EJ_X[f] = ej.x;
  EJ_Y[f] = ej.y;
}

function assertN(n) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`n 은 1 이상의 정수여야 한다: ${n}`);
  }
  return n;
}

function assertCapacity(out, need, label) {
  if (!out || typeof out.length !== 'number' || out.length < need) {
    const got = out && typeof out.length === 'number' ? out.length : 'none';
    throw new RangeError(`${label}: out 길이가 ${need} 이상이어야 한다 (지금 ${got})`);
  }
  return out;
}

/**
 * canonical (x, y) → 이미지(분석 프레임) px. `out[o]`, `out[o+1]` 에 쓴다.
 * @param {ArrayLike<number>} H row-major 9
 * @param {number} x canonical x
 * @param {number} y canonical y
 * @param {{[k:number]: number}} out
 * @param {number} o 쓰기 오프셋
 * @returns {number} 1 = 유한한 점을 썼다, 0 = NaN 두 칸을 썼다
 */
export function projectPointInto(H, x, y, out, o) {
  const w = H[6] * x + H[7] * y + H[8];
  if (!Number.isFinite(w) || Math.abs(w) < W_MIN) {
    out[o] = NaN;
    out[o + 1] = NaN;
    return 0;
  }
  const inv = 1 / w;
  const px = (H[0] * x + H[1] * y + H[2]) * inv;
  const py = (H[3] * x + H[4] * y + H[5]) * inv;
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    out[o] = NaN;
    out[o + 1] = NaN;
    return 0;
  }
  out[o] = px;
  out[o + 1] = py;
  return 1;
}

/** 면 격자 전체의 마름모 수 = 세 면 × n×n. */
export function faceQuadCount(n) {
  assertN(n);
  return n * n * 3;
}

/** `projectFaceQuadsInto` 가 요구하는 out 최소 길이 (마름모당 4점 × 2). */
export function faceQuadFloats(n) {
  return faceQuadCount(n) * 8;
}

/**
 * 마름모 (face, i, j) 의 첫 float 오프셋.
 * 배치는 j-major → i → face 순 — 그 순서로 순차 기록해야 캐시가 산다.
 */
export function faceQuadSlot(n, face, i, j) {
  assertN(n);
  return ((j * n + i) * 3 + face) * 8;
}

/**
 * 세 면 × n×n 마름모의 꼭짓점 4개를 전부 사영한다.
 * 꼭짓점 순서는 ygrid.moduleQuad 와 같다: [(i,j), (i+1,j), (i+1,j+1), (i,j+1)].
 * @returns {number} 쓴 마름모 수 (= faceQuadCount(n))
 */
export function projectFaceQuadsInto(H, n, out) {
  assertN(n);
  assertCapacity(out, faceQuadFloats(n), 'projectFaceQuadsInto');
  const faces = HUD_FACES.length;
  let slot = 0;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      for (let f = 0; f < faces; f += 1) {
        const eix = EI_X[f];
        const eiy = EI_Y[f];
        const ejx = EJ_X[f];
        const ejy = EJ_Y[f];
        // c = 0..3 → (a,b) = (i,j), (i+1,j), (i+1,j+1), (i,j+1)
        for (let c = 0; c < 4; c += 1) {
          const a = i + (c === 1 || c === 2 ? 1 : 0);
          const b = j + (c === 2 || c === 3 ? 1 : 0);
          projectPointInto(H, a * eix + b * ejx, a * eiy + b * ejy, out, slot + c * 2);
        }
        slot += 8;
      }
    }
  }
  return n * n * faces;
}

/** 격자선 수 = 면 3개 × 두 방향 × (n+1) 개. */
export function gridLineCount(n) {
  assertN(n);
  return 3 * 2 * (n + 1);
}

/** `projectGridLinesInto` 가 요구하는 out 최소 길이 (선분당 끝점 2개 × 2). */
export function gridLineFloats(n) {
  return gridLineCount(n) * 4;
}

/**
 * 면 격자선의 **양 끝점만** 사영한다 — 호모그래피는 직선을 직선으로 보내므로
 * 중간점을 찍을 이유가 없다(핫 경로에서 n 배 절약).
 *
 * 배치는 face-major → k=0..n → [a=k 선, b=k 선] 순:
 *   a=k 선: (k,0) → (k,n)
 *   b=k 선: (0,k) → (n,k)
 * @returns {number} 쓴 선분 수 (= gridLineCount(n))
 */
export function projectGridLinesInto(H, n, out) {
  assertN(n);
  assertCapacity(out, gridLineFloats(n), 'projectGridLinesInto');
  const faces = HUD_FACES.length;
  let slot = 0;
  for (let f = 0; f < faces; f += 1) {
    const eix = EI_X[f];
    const eiy = EI_Y[f];
    const ejx = EJ_X[f];
    const ejy = EJ_Y[f];
    for (let k = 0; k <= n; k += 1) {
      // a = k: (k,0) → (k,n)
      projectPointInto(H, k * eix, k * eiy, out, slot);
      projectPointInto(H, k * eix + n * ejx, k * eiy + n * ejy, out, slot + 2);
      slot += 4;
      // b = k: (0,k) → (n,k)
      projectPointInto(H, k * ejx, k * ejy, out, slot);
      projectPointInto(H, n * eix + k * ejx, n * eiy + k * ejy, out, slot + 2);
      slot += 4;
    }
  }
  return 3 * 2 * (n + 1);
}

/**
 * 육각 실루엣 6점 = CORNER_UNIT_OFFSETS[c] × n 을 사영한다 (12 floats).
 * @returns {number} 6
 */
export function projectOutlineInto(H, n, out) {
  assertN(n);
  assertCapacity(out, CORNER_UNIT_OFFSETS.length * 2, 'projectOutlineInto');
  for (let c = 0; c < CORNER_UNIT_OFFSETS.length; c += 1) {
    const corner = CORNER_UNIT_OFFSETS[c];
    projectPointInto(H, corner.x * n, corner.y * n, out, c * 2);
  }
  return CORNER_UNIT_OFFSETS.length;
}

/**
 * 유한한 (x, y) 쌍만으로 경계상자를 낸다.
 * NaN 은 「사영 불가」의 표현이라 **건너뛴다** — 한 점이 튀어도 상자가 죽지 않는다.
 * @param {ArrayLike<number>} points 평평한 [x0,y0,x1,y1,…]
 * @param {number} count 점 개수
 * @param {{[k:number]: number}} out4 [minX, minY, maxX, maxY]
 * @returns {boolean} 유한한 점이 하나라도 있었나
 */
export function finiteBoundsInto(points, count, out4) {
  assertCapacity(out4, 4, 'finiteBoundsInto');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = 0;
  const limit = Math.min(count, (points.length / 2) | 0);
  for (let k = 0; k < limit; k += 1) {
    const x = points[k * 2];
    const y = points[k * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    seen += 1;
  }
  if (seen === 0) return false;
  out4[0] = minX;
  out4[1] = minY;
  out4[2] = maxX;
  out4[3] = maxY;
  return true;
}
