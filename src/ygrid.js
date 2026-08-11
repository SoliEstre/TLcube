/**
 * ygrid.js — Type Y (단일 큐브) 면 격자 기하 (SPEC §14, docs/adr/0003_typeY_layout.md)
 *
 * 좌표 규약 (와이어 계약 — 여기서 못 박고 전 모듈이 따른다):
 *
 * - 큐브 실루엣 = pointy-top 정육각형. hexgrid.js 의 `CORNER_UNIT_OFFSETS` 를 그대로
 *   재사용한다(삼각함수 재계산 금지 — 닫힌 형태 상수라야 결정적이다).
 * - **Y-심**(세 면이 만나는 중심 꼭짓점) = 육각형 중심 = 이 모듈의 원점(layout 의
 *   `(originX, originY)`).
 * - 세 면은 hexgrid 코너 인덱스로 정의한다:
 *     T = [Y심, C5, C0, C1]   L = [Y심, C3, C4, C5]   R = [Y심, C1, C2, C3]
 * - 면 로컬 좌표 `(i, j)` 는 0-based, `n × n`. `(0,0)` 모듈이 Y-심 코너다.
 * - 축 규약: **i 축 = 시계방향(다음 라벨) 이웃 면과 공유하는 변 방향**,
 *   **j 축 = 반시계방향(이전 라벨) 이웃 면과 공유하는 변 방향**. 화면 기준:
 *     T: i → C1(우상)  j → C5(좌상)
 *     R: i → C3(하)    j → C1(우상)
 *     L: i → C5(좌상)  j → C3(하)
 *   즉 T→R→L→T 순서로 코너 인덱스가 +2(=120°) 씩 밀린다 — 이것이 아래 회전
 *   공변성 테스트의 근거다.
 * - 모듈 `(f, i, j)` = 변 길이 `m`(=`layout.size`) 의 60/120 마름모. 네 꼭짓점은
 *   `Y심 + (a·e_i + b·e_j)·m`, `(a,b) ∈ {(i,j), (i+1,j), (i+1,j+1), (i,j+1)}`.
 *   모듈 내접원 반지름은 Type O 면과 같은 형상이므로 `hexgrid.FACE_INRADIUS_COEFF`
 *   를 그대로 재사용한다: `(√3/4)·m`.
 * - 샘플 원판: §7.2 기본 규약 승계. 중심 = 마름모 중심(대각선 교점), 반지름 =
 *   `fraction · 내접원반지름`(기본 0.5, hexgrid 의 `SAMPLE_FRACTION_DEFAULT` 재사용).
 *
 * 이 모듈도 순수 기하만 다룬다 — node 전용 API 없음, 브라우저 ESM 로드 가능.
 */

import {
  CORNER_UNIT_OFFSETS,
  FACE_AREA_COEFF,
  FACE_INRADIUS_COEFF,
  HEX_AREA_COEFF,
  SAMPLE_FRACTION_DEFAULT,
  SAMPLE_FRACTION_OF_DEFAULT,
  SAMPLE_FRACTION_MODES,
  normalizeLayout,
} from './hexgrid.js';

/** Type Y 면 라벨. SPEC §14 순서(T, L, R)와 동일하게 고정한다. */
export const YFACES = Object.freeze(['T', 'L', 'R']);

/**
 * 면 → (e_i, e_j) 단위 벡터. hexgrid 의 `CORNER_UNIT_OFFSETS` 원소를 그대로 참조한다
 * (그 배열의 각 원소는 이미 freeze 된 `{x, y}` 라 재사용해도 안전하다).
 *
 * 코너 인덱스 매핑 (SPEC §14 규범):
 *   T: e_i = C1(우상), e_j = C5(좌상)
 *   R: e_i = C3(하),   e_j = C1(우상)
 *   L: e_i = C5(좌상), e_j = C3(하)
 */
const FACE_BASIS = Object.freeze({
  T: Object.freeze({ ei: CORNER_UNIT_OFFSETS[1], ej: CORNER_UNIT_OFFSETS[5] }),
  R: Object.freeze({ ei: CORNER_UNIT_OFFSETS[3], ej: CORNER_UNIT_OFFSETS[1] }),
  L: Object.freeze({ ei: CORNER_UNIT_OFFSETS[5], ej: CORNER_UNIT_OFFSETS[3] }),
});

function assertFace(face) {
  if (!Object.prototype.hasOwnProperty.call(FACE_BASIS, face)) {
    throw new RangeError(`면 라벨은 T | L | R 이어야 한다: ${face}`);
  }
  return face;
}

function assertModuleIndex(v, label) {
  if (!Number.isInteger(v) || v < 0) {
    throw new RangeError(`${label} 는 0 이상의 정수여야 한다: ${v}`);
  }
  return v;
}

function assertSide(n) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`n 은 1 이상의 정수여야 한다: ${n}`);
  }
  return n;
}

/**
 * 면의 (e_i, e_j) 단위 벡터.
 * @param {'T'|'L'|'R'} face
 * @returns {{ei: {x:number,y:number}, ej: {x:number,y:number}}}
 */
export function faceBasis(face) {
  assertFace(face);
  return FACE_BASIS[face];
}

/**
 * Y-심(layout 원점) 기준 (a·e_i + b·e_j)·size 절대 픽셀 좌표.
 * `a`, `b` 는 정수뿐 아니라 반정수(중심 계산용)도 받는다.
 */
function facePoint(face, a, b, norm) {
  const { ei, ej } = faceBasis(face);
  return {
    // `+ 0` 은 -0 정규화 — a 또는 b 가 0 이고 벡터 성분이 음수면 0 * (음수) = -0 이 된다.
    x: norm.originX + (a * ei.x + b * ej.x) * norm.size + 0,
    y: norm.originY + (a * ei.y + b * ej.y) * norm.size + 0,
  };
}

/**
 * 모듈 (face, i, j) 의 마름모 꼭짓점 4개.
 * 정점 순서: [Y심측, +e_i, +e_i+e_j, +e_j] (세 면 모두 같은 감김).
 * @param {'T'|'L'|'R'} face
 * @param {number} i
 * @param {number} j
 * @param {object} [layout]
 * @returns {{x:number,y:number}[]} 길이 4
 */
export function moduleQuad(face, i, j, layout) {
  assertFace(face);
  assertModuleIndex(i, 'i');
  assertModuleIndex(j, 'j');
  const norm = normalizeLayout(layout);
  return [
    facePoint(face, i, j, norm),
    facePoint(face, i + 1, j, norm),
    facePoint(face, i + 1, j + 1, norm),
    facePoint(face, i, j + 1, norm),
  ];
}

/** 모듈 (face, i, j) 의 중심(두 대각선의 교점) 절대 픽셀 좌표. */
export function moduleCenter(face, i, j, layout) {
  assertFace(face);
  assertModuleIndex(i, 'i');
  assertModuleIndex(j, 'j');
  const norm = normalizeLayout(layout);
  return facePoint(face, i + 0.5, j + 0.5, norm);
}

/** 모듈 내접원 반지름 = (√3/4)·size. Type O 면과 동일 형상(hexgrid 재사용). */
function moduleInradius(size) {
  return FACE_INRADIUS_COEFF * size;
}

/** 모듈 넓이 = (√3/2)·size². Type O 면과 동일 형상(hexgrid 재사용). */
function moduleArea(size) {
  return FACE_AREA_COEFF * size * size;
}

/**
 * 모듈의 샘플링 원판. hexgrid.faceSampleDisc 와 동일한 규약(§7.2)을 승계한다 —
 * 반지름은 항상 모듈 내접원 반지름으로 클램프된다.
 *
 * @param {'T'|'L'|'R'} face
 * @param {number} i
 * @param {number} j
 * @param {object} [layout]
 * @param {{fraction?: number, fractionOf?: 'radius'|'incircleArea'|'faceArea'}} [options]
 * @returns {{x:number,y:number,radius:number,clamped:boolean}}
 */
export function moduleSampleDisc(face, i, j, layout, options) {
  assertFace(face);
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

  const inradius = moduleInradius(norm.size);
  let radius;
  if (fractionOf === 'radius') {
    radius = fraction * inradius;
  } else if (fractionOf === 'incircleArea') {
    radius = Math.sqrt(fraction) * inradius;
  } else {
    radius = Math.sqrt((fraction * moduleArea(norm.size)) / Math.PI);
  }

  const clamped = radius > inradius;
  if (clamped) radius = inradius;

  assertModuleIndex(i, 'i');
  assertModuleIndex(j, 'j');
  const { ei, ej } = FACE_BASIS[face];
  // moduleCenter → facePoint의 산술 순서를 그대로 펼쳐 재정규화·중복 검증을 없앤다.
  const a = i + 0.5;
  const b = j + 0.5;
  const x = norm.originX + (a * ei.x + b * ej.x) * norm.size + 0;
  const y = norm.originY + (a * ei.y + b * ej.y) * norm.size + 0;
  return { x, y, radius, clamped };
}

/**
 * 변당 n 모듈인 Type Y 큐브 실루엣(정육각형)의 축정렬 바운딩 박스.
 * 닫힌 형태: 반폭 = √3/2·n·size, 반높이 = n·size (Y-심 = 육각형 중심 = layout 원점).
 * @param {number} n
 * @param {object} [layout]
 * @returns {{minX,minY,maxX,maxY,width,height}}
 */
export function cubeBounds(n, layout) {
  assertSide(n);
  const { size, originX, originY } = normalizeLayout(layout);
  const halfW = (Math.sqrt(3) / 2) * n * size;
  const halfH = n * size;
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
 * 변당 n 모듈인 Type Y 큐브를 여백 `margin` 과 함께 담는 캔버스 레이아웃.
 * 반환값을 그대로 layout 으로 넘길 수 있다 (size/originX/originY 포함).
 *
 * @param {number} n
 * @param {{size?: number, margin?: number}} [options]
 * @returns {{size, originX, originY, width, height, n}}
 */
export function layoutForCube(n, options) {
  assertSide(n);
  const opts = options || {};
  const size = opts.size === undefined ? 1 : opts.size;
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`size 는 유한한 양수여야 한다: ${size}`);
  }
  const margin = opts.margin === undefined ? 2 * size : opts.margin;
  if (!Number.isFinite(margin) || margin < 0) {
    throw new RangeError(`margin 은 0 이상이어야 한다: ${margin}`);
  }
  const b = cubeBounds(n, { size, originX: 0, originY: 0 });
  return {
    size,
    originX: margin - b.minX,
    originY: margin - b.minY,
    width: b.width + 2 * margin,
    height: b.height + 2 * margin,
    n,
  };
}
