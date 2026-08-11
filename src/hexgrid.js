/**
 * hexgrid.js — 육각 격자 + rhombille 3면 분할 기하 (SPEC §3, §7.2)
 *
 * 좌표 규약 (여기서 한 번 못 박고 전 모듈이 따른다):
 *
 * - 정육각형 **pointy-top**. 꼭짓점 하나가 화면 위를 정확히 가리킨다.
 * - `size` = 육각형 **외접원 반지름**(중심 → 꼭짓점). 변의 길이와 같다.
 * - axial 좌표 `(q, r)`. q 는 화면 오른쪽, r 은 오른쪽-아래.
 * - 화면 좌표는 **y 아래가 양수**(canvas 관례). 따라서 "위"는 y 가 작은 쪽이다.
 * - 꼭짓점 인덱스 0..5 는 상단 꼭짓점에서 시작해 **화면상 시계방향**.
 *
 *     size=1, 중심 원점 기준 꼭짓점 (이 값이 전 파이프라인의 기준이다):
 *       0 (  0        , -1   )  상단
 *       1 (  √3/2     , -0.5 )  우상
 *       2 (  √3/2     , +0.5 )  우하
 *       3 (  0        , +1   )  하단
 *       4 ( -√3/2     , +0.5 )  좌하
 *       5 ( -√3/2     , -0.5 )  좌상
 *
 * rhombille 분할 (SPEC §3.2):
 *
 * - 중심에서 **교대(alternating) 꼭짓점 3개**(0, 2, 4)로 선을 그어 육각형을 3개의
 *   60°/120° 마름모로 나눈다. 마름모는 `[중심, V(s-1), V(s), V(s+1)]` 이고
 *   `s` 는 그 면의 "spine" 꼭짓점이다. 네 변 길이가 모두 `size` 로 같다.
 * - 면 라벨은 아이소메트릭 큐브 은유:
 *     T = 상단면  → spine 꼭짓점 0 (위)
 *     L = 좌측면  → spine 꼭짓점 4 (좌하)
 *     R = 우측면  → spine 꼭짓점 2 (우하)
 * - **코드 전역 방향 기준이며 셀별 회전은 없다.** 면 오프셋은 모든 셀에서 동일하다.
 *
 * 이 모듈은 순수 기하만 다룬다. Node 전용 API 를 쓰지 않으므로 브라우저에서
 * `<script type="module">` 로 그대로 로드된다.
 */

/** √3. 육각 격자 산술이 전부 여기 걸려 있어 한 번만 계산해 둔다. */
export const SQRT3 = Math.sqrt(3);

/** √3/2 — pointy-top 육각형의 "가로 반폭" 계수. */
const H = SQRT3 / 2;

/** 면 라벨. 순서는 SPEC §4.1 의 순위 배열 `(T, L, R)` 과 동일하게 고정한다. */
export const FACES = Object.freeze(['T', 'L', 'R']);

/**
 * 면 → spine 꼭짓점 인덱스.
 * 교대 꼭짓점 {0, 2, 4} 만 spine 이 된다 (rhombille 분할의 정의).
 */
export const FACE_SPINE_CORNER = Object.freeze({ T: 0, L: 4, R: 2 });

/** axial 이웃 방향 6개 (시계방향 아님 — 관례적 순서). */
export const AXIAL_DIRECTIONS = Object.freeze([
  Object.freeze({ q: 1, r: 0 }),
  Object.freeze({ q: 1, r: -1 }),
  Object.freeze({ q: 0, r: -1 }),
  Object.freeze({ q: -1, r: 0 }),
  Object.freeze({ q: -1, r: 1 }),
  Object.freeze({ q: 0, r: 1 }),
]);

/**
 * size=1 기준 꼭짓점 오프셋. 삼각함수로 매번 계산하면 부동소수 잡음이 끼므로
 * 닫힌 형태 상수로 박아 둔다 (0 은 정확히 0 이어야 한다).
 */
export const CORNER_UNIT_OFFSETS = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: H, y: -0.5 }),
  Object.freeze({ x: H, y: 0.5 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -H, y: 0.5 }),
  Object.freeze({ x: -H, y: -0.5 }),
]);

/** 넓이·거리 계수 (size 의 거듭제곱 계수). 렌더러/디코더가 재계산하지 않도록 노출. */
export const HEX_AREA_COEFF = (3 * SQRT3) / 2; // 육각형 넓이 = coeff · size²
export const FACE_AREA_COEFF = SQRT3 / 2; //     마름모 넓이 = coeff · size²
export const FACE_INRADIUS_COEFF = SQRT3 / 4; //  마름모 내접원 반지름 = coeff · size
export const CENTER_SPACING_COEFF = SQRT3; //     인접 셀 중심 간 거리 = coeff · size

/** 기본 레이아웃: 단위 크기, 원점 (0,0). */
export const DEFAULT_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });

// ─────────────────────────────────────────────────────────────────────────────
// 레이아웃
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 레이아웃 정규화. `{ size, originX, originY }` 만 읽고 나머지 필드는 무시하므로
 * `layoutForRegion()` 결과(width/height 포함)를 그대로 넘겨도 된다.
 * @param {{size?: number, originX?: number, originY?: number}} [layout]
 * @returns {{size: number, originX: number, originY: number}}
 */
export function normalizeLayout(layout) {
  if (layout === undefined || layout === null) return DEFAULT_LAYOUT;
  const size = layout.size === undefined ? 1 : layout.size;
  const originX = layout.originX === undefined ? 0 : layout.originX;
  const originY = layout.originY === undefined ? 0 : layout.originY;
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`size 는 유한한 양수여야 한다: ${size}`);
  }
  if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
    throw new RangeError(`origin 은 유한해야 한다: (${originX}, ${originY})`);
  }
  return { size, originX, originY };
}

function assertRadius(k) {
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError(`반경 k 는 0 이상의 정수여야 한다: ${k}`);
  }
  return k;
}

function assertFace(face) {
  if (!Object.prototype.hasOwnProperty.call(FACE_SPINE_CORNER, face)) {
    throw new RangeError(`면 라벨은 T | L | R 이어야 한다: ${face}`);
  }
  return face;
}

// ─────────────────────────────────────────────────────────────────────────────
// 육각 영역 (SPEC §3.1)
// ─────────────────────────────────────────────────────────────────────────────

/** axial 원점으로부터의 육각 거리(링 번호). */
export function hexDistance(q, r) {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

/** 반경 k 육각 영역에 속하는가. */
export function isInRegion(q, r, k) {
  assertRadius(k);
  return hexDistance(q, r) <= k;
}

/** 반경 k 육각 영역의 셀 수 = 3k² + 3k + 1 (SPEC §3.1). */
export function cellCount(k) {
  assertRadius(k);
  return 3 * k * k + 3 * k + 1;
}

/**
 * 반경 k 육각 영역의 모든 셀. 순서는 q 오름차순 → r 오름차순으로 **결정적**이다.
 * (M0 완료 기준이 "동일 입력 → 결정적 출력"이므로 순회 순서를 계약으로 고정한다.)
 * @returns {{q: number, r: number}[]}
 */
export function regionCells(k) {
  assertRadius(k);
  const cells = [];
  for (let q = -k; q <= k; q++) {
    const rMin = Math.max(-k, -q - k);
    const rMax = Math.min(k, -q + k);
    // `+ 0` 은 -0 정규화다. k=0 일 때 `-k` 가 -0 이 되어 deepStrictEqual·JSON
    // 비교에서 0 과 갈린다 (결정적 출력 계약을 조용히 깬다).
    for (let r = rMin; r <= rMax; r++) cells.push({ q: q + 0, r: r + 0 });
  }
  return cells;
}

/** 셀의 6 이웃 axial 좌표. */
export function neighbors(q, r) {
  return AXIAL_DIRECTIONS.map((d) => ({ q: q + d.q, r: r + d.r }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 좌표 변환 (axial ↔ 픽셀). y 는 아래가 양수.
// ─────────────────────────────────────────────────────────────────────────────

/** axial → 픽셀 중심 좌표. */
export function axialToPixel(q, r, layout) {
  const { size, originX, originY } = normalizeLayout(layout);
  return {
    x: originX + size * SQRT3 * (q + r / 2),
    y: originY + size * 1.5 * r,
  };
}

/** 픽셀 → 실수 axial 좌표 (반올림 전). */
export function pixelToAxialFractional(x, y, layout) {
  const { size, originX, originY } = normalizeLayout(layout);
  const px = x - originX;
  const py = y - originY;
  const r = (2 / 3) * (py / size);
  const q = px / (size * SQRT3) - r / 2;
  return { q, r };
}

/**
 * 실수 axial → 가장 가까운 정수 axial (cube 반올림).
 * 셋 중 오차가 가장 큰 성분을 나머지 둘로부터 복원해 q+r+s=0 을 유지한다.
 */
export function axialRound(qf, rf) {
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;
  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);
  const dx = Math.abs(rx - xf);
  const dy = Math.abs(ry - yf);
  const dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  // -0 정규화: deepStrictEqual 및 직렬화에서 0 과 -0 이 갈리는 것을 막는다.
  return { q: rx + 0, r: rz + 0 };
}

/** 픽셀 → 가장 가까운 셀의 axial 좌표. 디코더가 격자 스냅에 쓴다. */
export function pixelToAxial(x, y, layout) {
  const { q, r } = pixelToAxialFractional(x, y, layout);
  return axialRound(q, r);
}

// ─────────────────────────────────────────────────────────────────────────────
// 육각형
// ─────────────────────────────────────────────────────────────────────────────

/** 육각형 넓이 = (3√3/2)·size². */
export function hexArea(size) {
  return HEX_AREA_COEFF * size * size;
}

/** 꼭짓점 i 의 중심 기준 오프셋. */
export function hexCornerOffset(i, size) {
  const u = CORNER_UNIT_OFFSETS[((i % 6) + 6) % 6];
  return { x: u.x * size, y: u.y * size };
}

/**
 * 셀 (q,r) 의 육각형 꼭짓점 6개. 인덱스 0 = 상단, 이후 화면상 시계방향.
 * @returns {{x: number, y: number}[]}
 */
export function hexCorners(q, r, layout) {
  const norm = normalizeLayout(layout);
  const c = axialToPixel(q, r, norm);
  return CORNER_UNIT_OFFSETS.map((u) => ({
    x: c.x + u.x * norm.size,
    y: c.y + u.y * norm.size,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// rhombille 3면 분할 (SPEC §3.2)
// ─────────────────────────────────────────────────────────────────────────────

/** 마름모 한 면의 넓이 = (√3/2)·size². 육각형 넓이의 정확히 1/3. */
export function faceArea(size) {
  return FACE_AREA_COEFF * size * size;
}

/** 마름모 내접원 반지름 = (√3/4)·size. (= 마름모 높이의 절반) */
export function faceInradius(size) {
  return FACE_INRADIUS_COEFF * size;
}

/**
 * 면의 마름모 폴리곤 (중심 기준 오프셋). 셀별 회전이 없으므로 모든 셀에서 동일하다.
 * 정점 순서: [중심, spine 이전 꼭짓점, spine 꼭짓점, spine 다음 꼭짓점].
 * 세 면 모두 같은 감김(winding)을 가진다.
 * @returns {{x: number, y: number}[]} 길이 4
 */
export function facePolygonOffsets(face, size) {
  assertFace(face);
  const s = FACE_SPINE_CORNER[face];
  const idx = [(s + 5) % 6, s, (s + 1) % 6];
  const poly = [{ x: 0, y: 0 }];
  for (const i of idx) {
    const u = CORNER_UNIT_OFFSETS[i];
    poly.push({ x: u.x * size, y: u.y * size });
  }
  return poly;
}

/** 면의 마름모 폴리곤 (절대 픽셀 좌표). */
export function facePolygon(q, r, face, layout) {
  const norm = normalizeLayout(layout);
  const c = axialToPixel(q, r, norm);
  return facePolygonOffsets(face, norm.size).map((p) => ({
    x: c.x + p.x,
    y: c.y + p.y,
  }));
}

/**
 * 면 중심(마름모 중심 = 두 대각선의 교점) 오프셋.
 * 중심 ↔ spine 꼭짓점 대각선의 중점이므로 spine 방향으로 size/2 떨어진 점이다.
 */
export function faceCentroidOffset(face, size) {
  assertFace(face);
  const u = CORNER_UNIT_OFFSETS[FACE_SPINE_CORNER[face]];
  return { x: (u.x * size) / 2, y: (u.y * size) / 2 };
}

/** 면 중심 (절대 픽셀 좌표). */
export function faceCentroid(q, r, face, layout) {
  const norm = normalizeLayout(layout);
  const c = axialToPixel(q, r, norm);
  const o = faceCentroidOffset(face, norm.size);
  return { x: c.x + o.x, y: c.y + o.y };
}

/**
 * 면의 내접원. 마름모는 접선다각형이므로 내접원 중심 = 마름모 중심이고
 * 반지름 = 네 변까지의 거리 = (√3/4)·size 로 모두 같다.
 * @returns {{x: number, y: number, radius: number}}
 */
export function faceIncircle(q, r, face, layout) {
  const norm = normalizeLayout(layout);
  const c = faceCentroid(q, r, face, norm);
  return { x: c.x, y: c.y, radius: faceInradius(norm.size) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 샘플링 영역 (SPEC §7.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SPEC §7.2 는 "면당 내접원 50% 영역 median" 이라고만 쓰여 있다.
 * 50% 가 **반지름 비율**인지 **넓이 비율**인지 문서에서 확정되지 않았다 (open question).
 * 그래서 확정하지 않고 파라미터로 노출한다.
 *
 * 기본값 `'radius'` 를 고른 근거: SPEC §11 리스크 표가 이 규칙의 목적을
 * "마름모 예각 뭉개짐으로 인한 샘플링 오염 방지" 로 못 박고 있다. 세 해석 중
 * 반지름 50% 가 가장 보수적(= 가장 작은 영역, 예각에서 가장 멀다)이므로,
 * 실측(M1) 전까지의 기본값으로 안전한 쪽을 잡았다. 확정되면 이 줄을 갱신한다.
 */
export const SAMPLE_FRACTION_DEFAULT = 0.5;
export const SAMPLE_FRACTION_OF_DEFAULT = 'radius';

/** 지원하는 비율 해석 모드. */
export const SAMPLE_FRACTION_MODES = Object.freeze([
  'radius', //        r = fraction · 내접원 반지름
  'incircleArea', //  넓이 = fraction · 내접원 넓이   → r = √fraction · 내접원 반지름
  'faceArea', //      넓이 = fraction · 마름모 넓이   → r = √(fraction · faceArea / π)
]);

/**
 * 면의 샘플링 원판. 반지름은 항상 내접원 반지름으로 클램프된다 —
 * 샘플링 영역이 마름모 밖으로 새면 인접 면의 휘도가 섞여 순위가 오염되기 때문에,
 * 파라미터가 과하게 크더라도 조용히 마름모를 벗어나게 두지 않는다.
 *
 * @param {number} q
 * @param {number} r
 * @param {'T'|'L'|'R'} face
 * @param {object} [layout]
 * @param {{fraction?: number, fractionOf?: 'radius'|'incircleArea'|'faceArea'}} [options]
 * @returns {{x: number, y: number, radius: number, clamped: boolean}}
 */
export function faceSampleDisc(q, r, face, layout, options) {
  const norm = normalizeLayout(layout);
  const opts = options || {};
  const fraction =
    opts.fraction === undefined ? SAMPLE_FRACTION_DEFAULT : opts.fraction;
  const fractionOf =
    opts.fractionOf === undefined ? SAMPLE_FRACTION_OF_DEFAULT : opts.fractionOf;

  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new RangeError(`fraction 은 (0, 1] 범위여야 한다: ${fraction}`);
  }
  if (!SAMPLE_FRACTION_MODES.includes(fractionOf)) {
    throw new RangeError(
      `fractionOf 는 ${SAMPLE_FRACTION_MODES.join(' | ')} 중 하나여야 한다: ${fractionOf}`,
    );
  }

  const inradius = faceInradius(norm.size);
  let radius;
  if (fractionOf === 'radius') {
    radius = fraction * inradius;
  } else if (fractionOf === 'incircleArea') {
    radius = Math.sqrt(fraction) * inradius;
  } else {
    radius = Math.sqrt((fraction * faceArea(norm.size)) / Math.PI);
  }

  const clamped = radius > inradius;
  if (clamped) radius = inradius;

  const c = faceCentroid(q, r, face, norm);
  return { x: c.x, y: c.y, radius, clamped };
}

/**
 * 한 셀의 세 면 샘플링 원판을 한꺼번에. 디코더가 셀 단위로 순회하므로 편의 제공.
 * @returns {{T: object, L: object, R: object}}
 */
export function cellSampleDiscs(q, r, layout, options) {
  const norm = normalizeLayout(layout);
  const opts = options || {};
  const fraction =
    opts.fraction === undefined ? SAMPLE_FRACTION_DEFAULT : opts.fraction;
  const fractionOf =
    opts.fractionOf === undefined ? SAMPLE_FRACTION_OF_DEFAULT : opts.fractionOf;

  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new RangeError(`fraction 은 (0, 1] 범위여야 한다: ${fraction}`);
  }
  if (!SAMPLE_FRACTION_MODES.includes(fractionOf)) {
    throw new RangeError(
      `fractionOf 는 ${SAMPLE_FRACTION_MODES.join(' | ')} 중 하나여야 한다: ${fractionOf}`,
    );
  }

  const inradius = faceInradius(norm.size);
  let radius;
  if (fractionOf === 'radius') {
    radius = fraction * inradius;
  } else if (fractionOf === 'incircleArea') {
    radius = Math.sqrt(fraction) * inradius;
  } else {
    radius = Math.sqrt((fraction * faceArea(norm.size)) / Math.PI);
  }
  const clamped = radius > inradius;
  if (clamped) radius = inradius;

  // axialToPixel와 faceCentroid의 산술 순서를 그대로 펼쳐 셀 중심은 한 번만 계산한다.
  const centerX = norm.originX + norm.size * SQRT3 * (q + r / 2);
  const centerY = norm.originY + norm.size * 1.5 * r;
  const out = {};
  for (const face of FACES) {
    const offset = faceCentroidOffset(face, norm.size);
    out[face] = {
      x: centerX + offset.x,
      y: centerY + offset.y,
      radius,
      clamped,
    };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 바운딩 박스 (렌더러가 캔버스 크기 정하는 데 사용)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 반경 k 코드 영역 전체의 축정렬 바운딩 박스.
 *
 * 닫힌 형태로 계산한다:
 *   가로 반폭 = √3·size·(k + 1/2)   — 최대 (q + r/2) 는 k 이고 여기에 반폭 √3/2·size
 *   세로 반폭 = size·(1.5k + 1)     — 최대 r 은 k 이고 여기에 하단 꼭짓점 size
 * (테스트가 전 셀 꼭짓점 전수 조사와 대조해 이 식을 검증한다.)
 *
 * @returns {{minX,minY,maxX,maxY,width,height}}
 */
export function codeBounds(k, layout) {
  assertRadius(k);
  const { size, originX, originY } = normalizeLayout(layout);
  const halfW = SQRT3 * size * (k + 0.5);
  const halfH = size * (1.5 * k + 1);
  return {
    minX: originX - halfW,
    minY: originY - halfH,
    maxX: originX + halfW,
    maxY: originY + halfH,
    width: 2 * halfW,
    height: 2 * halfH,
  };
}

/**
 * 반경 k 코드를 여백 `margin` 과 함께 담는 캔버스 레이아웃.
 * 반환값을 그대로 layout 으로 넘길 수 있다 (size/originX/originY 포함).
 *
 * @param {number} k
 * @param {{size?: number, margin?: number}} [options]
 * @returns {{k, size, margin, originX, originY, width, height}}
 */
export function layoutForRegion(k, options) {
  assertRadius(k);
  const opts = options || {};
  const size = opts.size === undefined ? 1 : opts.size;
  const margin = opts.margin === undefined ? 0 : opts.margin;
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`size 는 유한한 양수여야 한다: ${size}`);
  }
  if (!Number.isFinite(margin) || margin < 0) {
    throw new RangeError(`margin 은 0 이상이어야 한다: ${margin}`);
  }
  const b = codeBounds(k, { size, originX: 0, originY: 0 });
  return {
    k,
    size,
    margin,
    originX: margin - b.minX,
    originY: margin - b.minY,
    width: b.width + 2 * margin,
    height: b.height + 2 * margin,
  };
}
