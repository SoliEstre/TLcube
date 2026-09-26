/**
 * square-cell-style.js — 사각 셀 스타일 세트 (DESIGN_001 §3.3 · §4.1)
 *
 * H 데이터 셀(`hCellStyle`)과 코너 폴백 QR 데이터 모듈(`qrCellStyle`)이 **같은 어휘**를
 * 쓴다 — 운영자 결정 ③(2026-09-26 «H 는 QR 과 같은 사각 셀, 바리에이션 공유»). 이 모듈은
 * 기하만 소유한다. 무엇을 여는지는 허용표(`cell-shape-allow.js`)가, 색은 호출자가 정한다.
 *
 * ── 좌표 ──────────────────────────────────────────────────────────────────
 * 셀 하나는 로컬 [0,1]² 이다. x 는 오른쪽(열 방향), y 는 **아래**(행 방향 — 화면 좌표).
 * 그래서 N 은 y=0 변, S 는 y=1 변이다. 윤곽은 `{x, y}` 꼭짓점 배열(닫힌 다각형)이고,
 * 격자에 펼 때는 호출자의 `map(col + x, row + y)` 가 scene 좌표로 옮긴다. H 의 2.5D 는
 * 원근(β) 투영이라(`h-render.js:58-72`) 꼭짓점마다 투영해야 하므로 **disc 를 쓰지 않는다** —
 * 원도 다각형으로 편다.
 *
 * ── 이웃 비트 ─────────────────────────────────────────────────────────────
 * N1 E2 S4 W8 (직교) + NE16 SE32 SW64 NW128 (대각 — liquid 오목 필렛 전용).
 * «이웃» 의 뜻은 호출자가 정한다: QR 은 «어두운 데이터 모듈», H 는 «같은 레벨의 데이터
 * 셀»(§3.3 반박 ①). `styledGridShapes` 의 기본 이웃 규칙은 «둘 다 data 이고 색이 같다».
 *
 * ── 스타일 (§3.3 표) ──────────────────────────────────────────────────────
 *   square          단위 정사각.
 *   rounded         이웃 0: 원(r=½). 이웃 1: 이웃 쪽 반은 사각, 반대쪽은 반원. 직각 2 이웃:
 *                   이웃 없는 코너 1개를 r=½. 마주보는 2 · 3 이상: 사각.
 *   dots            원 r=½ (이웃 무관).
 *   classy          좌·상 이웃이 없으면 좌상, 우·하 이웃이 없으면 우하 코너를 r=½ 로 깎는다.
 *   liquid          두 직교 이웃이 모두 없는 볼록 코너만 r=½ — 자기 도형은 rounded 와 같다.
 *                   차이는 **오목 필렛**: 직교 두 이웃과 그 사이 대각이 모두 한 덩어리면,
 *                   그 코너의 빈 자리(= 다른 셀의 둥근 코너가 남긴 틈)를 덩어리 색으로 채운다
 *                   (`liquidConcaveContours`). 기본 켬, `params.concave === false` 로 끈다.
 *   extra-rounded   rounded 에서 직각 2 이웃 코너만 r=1(원 중심 = 두 이웃이 만나는 코너).
 *   diamond         |x−½| + |y−½| ≤ ½.
 *   classy-rounded  classy 에서 r=1.
 *   inset           배율 0.8 정사각(= 줄눈 s 0.2).
 * 기하 정의는 qr-code-styling 의 dot 타입과 같은 규칙이다(원문 `QRDot.ts` 와의 대조는 미확인 —
 * DESIGN_001 §9.2). 코너 필렛은 «코너마다 반지름 ρ ∈ {0, ½, 1}» 하나의 모형으로 만든다:
 * ρ 의 호 중심은 코너에서 안쪽으로 (ρ, ρ) 이고, 접점은 두 변 위 코너에서 ρ 떨어진 점이다.
 *
 * ── 중심 여유 c (§3.3) ────────────────────────────────────────────────────
 * H 표본기는 셀 중심 한 점 bilinear 표본이고(`h-detect.js:61-64`), QR 디코더도 모듈 중심을
 * 본다. 모든 스타일이 중심을 칠하므로 «중심에서 윤곽까지 최소 거리» c 가 사전 확률 지표다.
 * c 는 **개방 규칙이 아니다** — 호스트별 개방은 측정 영수증(허용표)이 정한다(safety M4).
 * 이 모듈은 로드 시 ① 표의 c 가 C_MIN 이상인지, ② 표의 c 가 실제 윤곽(전 mask)에서 잰
 * 최소 거리와 호 근사 오차 안에서 같은지를 자기검증한다(`verifyStyleSafety`).
 *
 * 결정성 계약(`raster.js:9` · `sceneY.js:10-11` · `cell-shape.js` 와 같다): 삼각함수 ·
 * Math.hypot · Math.random · Date 를 쓰지 않는다. 호의 점은 15° 간격 닫힌 형태 표
 * (cos15 = (√6+√2)/4 …)와 sqrt 만으로 만든다.
 *
 * 의존 없음(잎 모듈).
 */

// ── 상수 ───────────────────────────────────────────────────────────────────

/** 사각 셀 스타일 9종 — UI 카드 순서이자 허용표 `hCellStyle` · `qrCellStyle` 도메인의 정본. */
export const SQUARE_CELL_STYLES = Object.freeze([
  'square', 'rounded', 'dots', 'classy', 'liquid',
  'extra-rounded', 'diamond', 'classy-rounded', 'inset',
]);

/** 이웃 비트. 직교 4 + 대각 4(liquid 오목 필렛 전용). */
export const NEIGHBOR_BITS = Object.freeze({
  N: 1, E: 2, S: 4, W: 8, NE: 16, SE: 32, SW: 64, NW: 128,
});

/** 이웃 비트 → (행 오프셋, 열 오프셋). 행은 아래로 증가한다. */
export const NEIGHBOR_OFFSETS = Object.freeze([
  Object.freeze({ bit: 1, dr: -1, dc: 0 }),
  Object.freeze({ bit: 2, dr: 0, dc: 1 }),
  Object.freeze({ bit: 4, dr: 1, dc: 0 }),
  Object.freeze({ bit: 8, dr: 0, dc: -1 }),
  Object.freeze({ bit: 16, dr: -1, dc: 1 }),
  Object.freeze({ bit: 32, dr: 1, dc: 1 }),
  Object.freeze({ bit: 64, dr: 1, dc: -1 }),
  Object.freeze({ bit: 128, dr: -1, dc: -1 }),
]);

/** inset 의 배율 — 줄눈 s = 0.2 (r-tlc H2 frame 줄눈 s ≤ 0.3 통과 범위 안). */
export const INSET_SCALE = 0.8;

/**
 * 중심 여유 하한. 모든 스타일의 c 는 이 값 이상이어야 한다(로드 시 자기검증).
 * 근거: 셀 중심 ±¼셀 원판이 빠짐없이 칠해져 있으면 표본점의 정합 오차 ¼셀까지 색이
 * 바뀌지 않는다 — H 표본기(중심 한 점)와 QR 디코더(모듈 중심) 공통의 바닥이다.
 * 표의 최소값(extra-rounded · classy-rounded 1−√½ ≈ 0.293)이 이 바닥 위에 있다.
 * 이 값은 «열어도 된다» 가 아니라 «이보다 좁은 스타일은 후보로도 올리지 않는다» 이다.
 */
export const C_MIN = 0.25;

const SQRT2 = Math.sqrt(2);
const SQRT3 = Math.sqrt(3);
const SQRT6 = Math.sqrt(6);

/**
 * 스타일별 중심 여유 c (§3.3 표) — 닫힌 형태 값.
 * extra-rounded · classy-rounded: 반지름 1 호의 중심이 셀 코너라 c = 1 − √½.
 * diamond: 중심에서 변 |x−½|+|y−½|=½ 까지 거리 = ½/√2 = √2/4.
 */
export const STYLE_CENTER_CLEARANCE = Object.freeze({
  square: 0.5,
  rounded: 0.5,
  dots: 0.5,
  classy: 0.5,
  liquid: 0.5,
  'extra-rounded': 1 - SQRT2 / 2,
  diamond: SQRT2 / 4,
  'classy-rounded': 1 - SQRT2 / 2,
  inset: INSET_SCALE / 2,
});

/** 호 한 칸(90°) 당 기본 분할 수 — 15° 간격. */
export const DEFAULT_ARC_SEGMENTS = 6;

/**
 * 허용되는 분할 수: 15° 표의 약수(2·3·6) + 중점 이등분(12·24).
 * 1 은 받지 않는다 — r=1 호(extra-rounded · classy-rounded)가 모서리→모서리 현 하나가 되어
 * 윤곽이 셀 중심을 잃는다(mask 9 등에서 중심 여유 −1, 2026-09-26 실측). 로드 시 자기검증이
 * 이 목록의 **모든** 값을 재므로, 여기 값을 더하면 그 값의 중심 여유가 C_MIN 을 넘는지도 함께 잰다.
 */
export const ARC_SEGMENT_CHOICES = Object.freeze([2, 3, 6, 12, 24]);

// ── 호 표 (삼각함수 없음) ─────────────────────────────────────────────────

/** k·15° (k = 0…6) 의 cos. sin(k·15°) = cos((6−k)·15°). */
const COS15 = Object.freeze([
  1,
  (SQRT6 + SQRT2) / 4,
  SQRT3 / 2,
  SQRT2 / 2,
  0.5,
  (SQRT6 - SQRT2) / 4,
  0,
]);

/** 두 단위벡터의 정규화 중점 — 각을 정확히 이등분한다(sqrt 만). */
function bisect(u, v) {
  const x = u.c + v.c;
  const y = u.s + v.s;
  const len = Math.sqrt(x * x + y * y);
  return { c: x / len, s: y / len };
}

const ARC_TABLE_CACHE = new Map();

/** 0°…90° 를 segments 칸으로 나눈 (cos, sin) 표. 끝점은 정확히 (1,0) · (0,1). */
function arcTable(segments) {
  const cached = ARC_TABLE_CACHE.get(segments);
  if (cached) return cached;
  if (!ARC_SEGMENT_CHOICES.includes(segments)) {
    throw new RangeError(`square-cell-style: segments 는 ${ARC_SEGMENT_CHOICES.join('·')} 중 하나여야 한다: ${segments}`);
  }
  let table;
  if (segments <= 6) {
    const step = 6 / segments;
    table = [];
    for (let i = 0; i <= segments; i += 1) {
      const k = i * step;
      table.push({ c: COS15[k], s: COS15[6 - k] });
    }
  } else {
    table = arcTable(segments / 2).slice();
    const out = [table[0]];
    for (let i = 1; i < table.length; i += 1) {
      out.push(bisect(table[i - 1], table[i]), table[i]);
    }
    table = out;
  }
  const frozen = Object.freeze(table.map((e) => Object.freeze(e)));
  ARC_TABLE_CACHE.set(segments, frozen);
  return frozen;
}

// ── 코너 모형 ───────────────────────────────────────────────────────────────

/**
 * 코너 4개(시계방향: TL · TR · BR · BL)의 기하. 각 코너의 필렛 호는 중심
 * C = corner + ρ·inward 에서 시작 벡터 a(들어오는 변의 접점 방향)부터 끝 벡터 b 까지
 * 90° 를 돈다. 순회는 화면 기준 시계방향(y 아래)이다.
 */
const CORNERS = Object.freeze([
  Object.freeze({ name: 'TL', px: 0, py: 0, ix: 1, iy: 1, a: [-1, 0], b: [0, -1], orth: [1, 8], diag: 128 }),
  Object.freeze({ name: 'TR', px: 1, py: 0, ix: -1, iy: 1, a: [0, -1], b: [1, 0], orth: [1, 2], diag: 16 }),
  Object.freeze({ name: 'BR', px: 1, py: 1, ix: -1, iy: -1, a: [1, 0], b: [0, 1], orth: [4, 2], diag: 32 }),
  Object.freeze({ name: 'BL', px: 0, py: 1, ix: 1, iy: -1, a: [0, 1], b: [-1, 0], orth: [4, 8], diag: 64 }),
]);

/** 코너 호 위의 점들(시작 접점 → 끝 접점). ρ = 0 이면 코너 점 하나. */
function cornerArcPoints(corner, rho, segments) {
  if (rho === 0) return [{ x: corner.px, y: corner.py }];
  const cx = corner.px + rho * corner.ix;
  const cy = corner.py + rho * corner.iy;
  const [ax, ay] = corner.a;
  const [bx, by] = corner.b;
  return arcTable(segments).map(({ c, s }) => ({
    x: cx + rho * (ax * c + bx * s),
    y: cy + rho * (ay * c + by * s),
  }));
}

/** 코너 호의 두 접점만(시작 · 끝) — SVG `A` 명령용. 표(분할 수)를 거치지 않는다. */
function cornerArcEndpoints(corner, rho) {
  const cx = corner.px + rho * corner.ix;
  const cy = corner.py + rho * corner.iy;
  const [ax, ay] = corner.a;
  const [bx, by] = corner.b;
  return [{ x: cx + rho * ax, y: cy + rho * ay }, { x: cx + rho * bx, y: cy + rho * by }];
}

function hasBit(mask, bit) {
  return (mask & bit) !== 0;
}

function validateMask(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 255) {
    throw new RangeError(`square-cell-style: mask 는 0..255 정수여야 한다: ${mask}`);
  }
}

function validateStyle(style) {
  if (!SQUARE_CELL_STYLES.includes(style)) {
    throw new RangeError(`square-cell-style: 모르는 스타일: ${style} (허용: ${SQUARE_CELL_STYLES.join(', ')})`);
  }
}

/** «두 직교 이웃이 모두 없는» 코너만 ρ 로 — rounded · liquid · extra-rounded 공통 뼈대. */
function exposedCornerRadii(mask, rho) {
  return CORNERS.map((corner) => (
    !hasBit(mask, corner.orth[0]) && !hasBit(mask, corner.orth[1]) ? rho : 0
  ));
}

function orthCount(mask) {
  return (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0) + (mask & 4 ? 1 : 0) + (mask & 8 ? 1 : 0);
}

/**
 * 코너 반지름 [TL, TR, BR, BL]. 코너 모형으로 표현되는 스타일만(diamond · inset 은 null).
 * rounded 규칙(이웃 0 → 원, 1 → 반원, 직각 2 → 코너 하나, 마주보는 2·3+ → 사각)은
 * «직교 이웃 둘 다 없는 코너만 ρ=½» 과 정확히 같은 결과다 — 한 규칙으로 쓴다.
 */
function cornerRadii(style, mask) {
  switch (style) {
    case 'square':
      return [0, 0, 0, 0];
    case 'dots':
      return [0.5, 0.5, 0.5, 0.5];
    case 'rounded':
    case 'liquid':
      return exposedCornerRadii(mask, 0.5);
    case 'extra-rounded': {
      // 직각 2 이웃일 때만 그 반대 코너가 r=1. 이웃 0(원) · 1(반원)은 rounded 와 같다.
      const radii = exposedCornerRadii(mask, 0.5);
      if (orthCount(mask) === 2 && radii.filter((r) => r > 0).length === 1) {
        return radii.map((r) => (r > 0 ? 1 : 0));
      }
      return radii;
    }
    case 'classy':
    case 'classy-rounded': {
      const rho = style === 'classy' ? 0.5 : 1;
      const tl = !hasBit(mask, NEIGHBOR_BITS.W) && !hasBit(mask, NEIGHBOR_BITS.N) ? rho : 0;
      const br = !hasBit(mask, NEIGHBOR_BITS.E) && !hasBit(mask, NEIGHBOR_BITS.S) ? rho : 0;
      return [tl, 0, br, 0];
    }
    default:
      return null;
  }
}

const EPS = 1e-12;

function samePoint(p, q) {
  return Math.abs(p.x - q.x) <= EPS && Math.abs(p.y - q.y) <= EPS;
}

/** 연속 중복 꼭짓점(닫힘 포함)을 지운다 — ρ=1 호의 끝점이 이웃 코너 점과 겹친다. */
function dedupe(points) {
  const out = [];
  for (const p of points) {
    if (out.length === 0 || !samePoint(out[out.length - 1], p)) out.push(p);
  }
  while (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
  return out;
}

function resolveSegments(opts) {
  const segments = opts && opts.segments !== undefined ? opts.segments : DEFAULT_ARC_SEGMENTS;
  arcTable(segments); // 검증
  return segments;
}

// ── 공개 기하 ───────────────────────────────────────────────────────────────

/**
 * 스타일 · 이웃 mask → 로컬 [0,1]² 윤곽 목록. 지금은 모든 스타일이 윤곽 1개다
 * (liquid 의 오목 필렛은 **다른 셀의 코너**를 채우므로 `liquidConcaveContours` 가 따로 낸다).
 *
 * @param {string} style SQUARE_CELL_STYLES 중 하나
 * @param {number} mask 이웃 비트(0..255). 대각 비트는 자기 도형에 영향이 없다.
 * @param {{segments?: number, params?: object}} [opts] segments = 90° 호 분할 수(기본 6 = 15°)
 * @returns {{x:number, y:number}[][]}
 */
export function cellContours(style, mask, opts = {}) {
  validateStyle(style);
  validateMask(mask);
  const segments = resolveSegments(opts);
  if (style === 'diamond') {
    return [[{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }]];
  }
  if (style === 'inset') {
    const lo = (1 - INSET_SCALE) / 2;
    const hi = 1 - lo;
    return [[{ x: lo, y: lo }, { x: hi, y: lo }, { x: hi, y: hi }, { x: lo, y: hi }]];
  }
  const radii = cornerRadii(style, mask);
  const points = [];
  CORNERS.forEach((corner, i) => {
    for (const p of cornerArcPoints(corner, radii[i], segments)) points.push(p);
  });
  return [dedupe(points)];
}

/**
 * liquid 오목 필렛 — 셀 X 의 코너에서 직교 두 이웃과 그 사이 대각이 **모두** 덩어리에
 * 속하면, 그 코너의 «½ 정사각 − 반지름 ½ 사분원» 조각을 덩어리 색으로 채운다.
 * 조각은 X 의 둥근 코너가 남긴 틈과 정확히 같은 영역이라 X 의 도형과 겹치지 않고,
 * 셀 중심(½,½)을 건드리지 않는다(사분원 중심이 셀 중심이라 조각은 그 원 밖).
 *
 * @param {number} mask 셀 X 기준, **덩어리** 셀의 이웃 비트(대각 포함)
 * @param {{segments?: number}} [opts]
 * @returns {{contour: {x:number,y:number}[], corner: string}[]}
 */
export function liquidConcaveContours(mask, opts = {}) {
  validateMask(mask);
  const segments = resolveSegments(opts);
  const out = [];
  for (const corner of CORNERS) {
    if (!hasBit(mask, corner.orth[0]) || !hasBit(mask, corner.orth[1]) || !hasBit(mask, corner.diag)) continue;
    const arc = cornerArcPoints(corner, 0.5, segments).reverse();
    out.push({ corner: corner.name, contour: dedupe([{ x: corner.px, y: corner.py }, ...arc]) });
  }
  return out;
}

/** 격자 (row, col) 의 이웃 mask. `isNeighbor(nr, nc)` 가 true 인 방향의 비트를 모은다. */
export function neighborMask(row, col, isNeighbor) {
  let mask = 0;
  for (const { bit, dr, dc } of NEIGHBOR_OFFSETS) {
    if (isNeighbor(row + dr, col + dc)) mask |= bit;
  }
  return mask;
}

function fmt(v) {
  const s = (Math.round(v * 1e6) / 1e6).toString();
  return s === '-0' ? '0' : s;
}

/**
 * 평면(축정렬) SVG path — UI 카드 · 평면 미리보기용. 필렛은 정확한 호(`A`)로 쓴다.
 * 원근 투영 경로에는 쓰지 않는다(그쪽은 `cellContours` 꼭짓점을 투영한다).
 *
 * @param {string} style
 * @param {number} mask
 * @param {{x?: number, y?: number, size?: number}} [opts] 셀 좌상단 · 한 변
 * @returns {string} `M … Z`
 */
export function cellSvgPath(style, mask, opts = {}) {
  validateStyle(style);
  validateMask(mask);
  const ox = opts.x ?? 0;
  const oy = opts.y ?? 0;
  const size = opts.size ?? 1;
  const P = (p) => `${fmt(ox + p.x * size)} ${fmt(oy + p.y * size)}`;
  const radii = cornerRadii(style, mask);
  if (radii === null) {
    const pts = cellContours(style, mask)[0];
    return `M ${pts.map(P).join(' L ')} Z`;
  }
  const cmds = [];
  let last = null;
  const moveOrLine = (p) => {
    if (last !== null && samePoint(last, p)) return;
    cmds.push(`${cmds.length === 0 ? 'M' : 'L'} ${P(p)}`);
    last = p;
  };
  CORNERS.forEach((corner, i) => {
    const rho = radii[i];
    if (rho === 0) {
      moveOrLine({ x: corner.px, y: corner.py });
      return;
    }
    const [start, end] = cornerArcEndpoints(corner, rho);
    moveOrLine(start);
    // 시계방향 순회의 볼록 호 = sweep 1, 90° 라 large-arc 0.
    cmds.push(`A ${fmt(rho * size)} ${fmt(rho * size)} 0 0 1 ${P(end)}`);
    last = end;
  });
  return `${cmds.join(' ')} Z`;
}

// ── CPU 커버리지 (GPU 텍스처용) ─────────────────────────────────────────────

/** 짝홀 교차 판정 — 점이 닫힌 다각형 안인가. */
function insidePolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > py) !== (b.y > py)) {
      const xCross = a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (px < xCross) inside = !inside;
    }
  }
  return inside;
}

/**
 * 로컬 [0,1]² 윤곽들의 합집합을 size×size 픽셀로 칠한 커버리지(0..1, 행 우선, y 아래).
 * 픽셀마다 samples×samples 균일 부표본으로 센다 — 결정적, 캔버스 불필요.
 *
 * @param {{x:number,y:number}[][]} contours
 * @param {number} size 한 변 픽셀 수(정수 ≥ 1)
 * @param {{samples?: number}} [opts] 기본 4 (= 16 부표본)
 * @returns {Float32Array}
 */
export function rasterContoursCoverage(contours, size, opts = {}) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`square-cell-style: size 는 1 이상 정수: ${size}`);
  const samples = opts.samples ?? 4;
  if (!Number.isInteger(samples) || samples < 1) throw new RangeError(`square-cell-style: samples 는 1 이상 정수: ${samples}`);
  const out = new Float32Array(size * size);
  const total = samples * samples;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let hit = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        const y = (py + (sy + 0.5) / samples) / size;
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size;
          for (const pts of contours) {
            if (insidePolygon(x, y, pts)) { hit += 1; break; }
          }
        }
      }
      out[py * size + px] = hit / total;
    }
  }
  return out;
}

/**
 * 스타일 셀 하나의 CPU 픽셀 커버리지 — H GPU 면 텍스처·코너 QR 텍스처가 원시 RGBA 로
 * 칠할 때 쓴다(Canvas Path2D 금지 — premultiply 로 alpha=0 데이터 RGB 가 사라진다,
 * `h-preview-renderer.js:121-122`). 윤곽은 `cellContours` 와 **같은 다각형**이다.
 */
export function rasterCellCoverage(style, mask, size, opts = {}) {
  return rasterContoursCoverage(cellContours(style, mask, opts), size, opts);
}

// ── 중심 여유 자기검증 ─────────────────────────────────────────────────────

/** 점–선분 최소 거리(sqrt 만). */
function pointSegmentDistance(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ex = a.x + t * dx - px;
  const ey = a.y + t * dy - py;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * 윤곽들에서 잰 중심 여유 — 셀 중심(½,½)이 어느 윤곽 안에 있으면 그 윤곽 경계까지의 최소
 * 거리, 어디에도 없으면 −1.
 */
export function measureCenterClearance(contours) {
  let best = -1;
  for (const pts of contours) {
    if (!insidePolygon(0.5, 0.5, pts)) continue;
    let d = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      d = Math.min(d, pointSegmentDistance(0.5, 0.5, pts[j], pts[i]));
    }
    best = Math.max(best, d);
  }
  return best;
}

/**
 * 호를 현(弦)으로 근사해서 생기는 중심 여유 오차의 상한: 반지름 1 호의 새지타
 * 1 − cos(45°/segments). cos 는 반각 공식(sqrt)으로 — 삼각함수 없음.
 */
export function arcChordTolerance(segments = DEFAULT_ARC_SEGMENTS) {
  const table = arcTable(segments);
  const c = table[1].c; // cos(90°/segments)
  return 1 - Math.sqrt((1 + c) / 2);
}

/**
 * 스타일 표 자기검증. 스타일마다 직교 이웃 16 mask 전부의 윤곽에서 중심 여유를 재고,
 *   ① 모든 mask 에서 셀 중심이 윤곽 안이다,
 *   ② 잰 최소값이 표의 c 와 호 근사 오차 안에서 같다(표가 낙관적이지도, 비관적이지도 않다),
 *   ③ 표의 c ≥ cMin,
 *   ④ 잰 최소값 자체도 ≥ cMin(호를 현으로 깎은 만큼 표보다 작다 — 분할 수가 적을수록 크게).
 * 하나라도 어기면 던진다. 심은 결함 시험을 위해 표 · 윤곽 함수 · 하한을 주입받는다.
 *
 * @param {{table?: Object<string, number>, contours?: Function, cMin?: number, segments?: number}} [opts]
 * @returns {Object<string, {c:number, measured:number}>}
 */
export function verifyStyleSafety(opts = {}) {
  const table = opts.table ?? STYLE_CENTER_CLEARANCE;
  const contoursOf = opts.contours ?? cellContours;
  const cMin = opts.cMin ?? C_MIN;
  const segments = opts.segments ?? DEFAULT_ARC_SEGMENTS;
  const tol = arcChordTolerance(segments) + 1e-9;
  const out = {};
  for (const style of Object.keys(table)) {
    const c = table[style];
    if (!(Number.isFinite(c) && c >= cMin)) {
      throw new RangeError(`square-cell-style: ${style} 의 중심 여유 c=${c} 가 하한 C_MIN=${cMin} 미만이다`);
    }
    let measured = Infinity;
    for (let mask = 0; mask < 16; mask += 1) {
      const d = measureCenterClearance(contoursOf(style, mask, { segments }));
      if (d < 0) throw new RangeError(`square-cell-style: ${style} mask ${mask} 윤곽이 셀 중심을 포함하지 않는다`);
      measured = Math.min(measured, d);
    }
    if (measured > c + 1e-9 || measured < c - tol) {
      throw new RangeError(`square-cell-style: ${style} 표의 c=${c} 가 윤곽에서 잰 ${measured} 와 다르다(허용 ${tol})`);
    }
    if (!(measured >= cMin)) {
      throw new RangeError(`square-cell-style: ${style} segments ${segments} 의 잰 중심 여유 ${measured} 가 하한 C_MIN=${cMin} 미만이다`);
    }
    out[style] = Object.freeze({ c, measured });
  }
  return out;
}

/**
 * 스타일 하나의 안전 지표. 모르는 스타일 · c < cMin 은 던진다(심은 결함 시험용 표 주입 가능).
 * @returns {{style: string, c: number, cMin: number}}
 */
export function styleSafety(style, opts = {}) {
  const table = opts.table ?? STYLE_CENTER_CLEARANCE;
  const cMin = opts.cMin ?? C_MIN;
  if (!Object.prototype.hasOwnProperty.call(table, style)) {
    throw new RangeError(`square-cell-style: 모르는 스타일: ${style}`);
  }
  const c = table[style];
  if (!(Number.isFinite(c) && c >= cMin)) {
    throw new RangeError(`square-cell-style: ${style} 의 중심 여유 c=${c} 가 하한 C_MIN=${cMin} 미만이다`);
  }
  return Object.freeze({ style, c, cMin });
}

// 로드 시 자기검증 — 표와 기하가 어긋나면 모듈 평가가 실패한다(capacity*.js 선례).
// 표의 키 집합이 SQUARE_CELL_STYLES 와 같은지도 함께 본다(손 목록 두 개의 어긋남 방지).
// API 가 받는 분할 수 **전부**를 잰다 — 기본값만 재면 호출자가 투영 비용 때문에 분할을 낮출 때
// 불변식(중심 포함 · c ≥ C_MIN)이 보증 밖으로 나간다(검토 지적, 2026-09-26; 5값 합 약 6 ms).
{
  const keys = Object.keys(STYLE_CENTER_CLEARANCE);
  if (keys.length !== SQUARE_CELL_STYLES.length || !SQUARE_CELL_STYLES.every((s) => keys.includes(s))) {
    throw new Error('square-cell-style: STYLE_CENTER_CLEARANCE 키가 SQUARE_CELL_STYLES 와 다르다');
  }
  for (const segments of ARC_SEGMENT_CHOICES) verifyStyleSafety({ segments });
}

// ── 격자 → scene 도형 ───────────────────────────────────────────────────────

/** styledGridShapes 가 아는 셀 역할. 그 밖의 문자열은 던진다(fail-closed). */
export const STYLED_GRID_ROLES = Object.freeze(['data', 'fixed']);

/** 호스트별 필수 태그. 빠지면 던진다(safety M3 · wiring M12). */
export const STYLED_GRID_REQUIRED_TAGS = Object.freeze({
  // QR: 안전영역 제외는 ① selfQuiet 태그 ② «전 도형이 BULLSEYE 색» 클러스터 두 갈래로
  // 판정한다(quietzone.js:371-378,455-462). 색을 바꾸면 ②가 무너지므로 ①이 필수다 —
  // 없으면 A 하단 BL·BR 코너의 «213/213 삼킴» 사고가 재발한다. noSeam 은 스타일 조각의
  // 틈을 seam stroke 가 메우지 않게(svg.js `s.qr || s.noSeam`).
  qr: Object.freeze(['selfQuiet', 'noSeam']),
  // H: 스타일 조각 · 바탕 모두 noSeam(바탕 seam 이 인접 면 r=0 흰 경계를 넘지 않게, safety m4).
  h: Object.freeze(['noSeam']),
});

function sameRgb(a, b) {
  return !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
}

/**
 * rows×cols 정수 격자를 스타일 도형으로 편다(QR 모듈 · H 면 셀 공용).
 *
 * @param {{
 *   rows: number, cols: number,
 *   style: string,                                   // SQUARE_CELL_STYLES
 *   host: 'qr'|'h',                                  // 필수 태그 판정용
 *   role: (row:number, col:number) => 'data'|'fixed'|null|undefined,
 *                                                     // data = 스타일 적용, fixed = 사각 고정
 *                                                     // (검출 요소), null = 그리지 않음
 *   neighbor?: (row, col, nRow, nCol) => boolean,    // 기본: 둘 다 data 이고 색이 같다
 *   color: (row:number, col:number) => {r,g,b},
 *   ground?: {r,g,b}|null,                           // 있으면 격자 전체 바탕 1장을 먼저 깐다
 *   map: (x:number, y:number) => {x:number, y:number}, // 격자 좌표(col+x, row+y) → scene
 *   tags: object,                                    // 모든 조각에 복사. 호스트 필수 태그 누락 시 throw
 *   segments?: number, params?: {concave?: boolean},
 * }} args
 * @returns {Array<{kind:'polygon', points:{x,y}[], color:{r,g,b}}>}
 */
export function styledGridShapes(args) {
  const {
    rows, cols, style, host, role, color, map, tags,
    ground = null, segments = DEFAULT_ARC_SEGMENTS, params = {},
  } = args || {};
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(cols) || cols < 1) {
    throw new RangeError(`styledGridShapes: rows·cols 는 1 이상 정수: ${rows}×${cols}`);
  }
  validateStyle(style);
  if (!Object.prototype.hasOwnProperty.call(STYLED_GRID_REQUIRED_TAGS, host)) {
    throw new RangeError(`styledGridShapes: host 는 ${Object.keys(STYLED_GRID_REQUIRED_TAGS).join('|')} 중 하나: ${host}`);
  }
  if (tags === null || typeof tags !== 'object') {
    throw new TypeError('styledGridShapes: tags 는 필수 객체다');
  }
  for (const key of STYLED_GRID_REQUIRED_TAGS[host]) {
    if (tags[key] !== true) {
      throw new TypeError(`styledGridShapes: host '${host}' 는 tags.${key} === true 가 필수다`);
    }
  }
  // host 는 호출자 선언이라 QR 호출자가 host:'h' 로 selfQuiet 없이 지나갈 수 있다. 기존 QR 조각
  // 표지(`qr: true` — svg.js seam · generator-h-qr.js)를 단 채 host 가 'qr' 이 아니면 그 우회로
  // 보고 막는다(검토 지적, 2026-09-26). 표지 없는 QR 호출자는 여기서도 못 잡는다 — 소비자 테스트 몫.
  if (tags.qr === true && host !== 'qr') {
    throw new TypeError(`styledGridShapes: tags.qr 가 있으면 host 는 'qr' 이어야 한다(받은 host '${host}')`);
  }
  for (const key of ['kind', 'points', 'color']) {
    if (Object.prototype.hasOwnProperty.call(tags, key)) {
      throw new TypeError(`styledGridShapes: tags 에 도형 필드 '${key}' 를 둘 수 없다`);
    }
  }
  if (typeof role !== 'function' || typeof color !== 'function' || typeof map !== 'function') {
    throw new TypeError('styledGridShapes: role · color · map 은 함수여야 한다');
  }

  const inGrid = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
  const roleAt = (r, c) => {
    if (!inGrid(r, c)) return null;
    const v = role(r, c);
    if (v === null || v === undefined) return null;
    if (!STYLED_GRID_ROLES.includes(v)) {
      throw new RangeError(`styledGridShapes: 모르는 셀 역할 '${v}' (${r},${c})`);
    }
    return v;
  };
  const isNeighbor = args.neighbor ?? ((r, c, nr, nc) => (
    roleAt(r, c) === 'data' && roleAt(nr, nc) === 'data' && sameRgb(color(r, c), color(nr, nc))
  ));

  const shapes = [];
  const push = (localPts, row, col, fill) => {
    shapes.push({
      kind: 'polygon',
      points: localPts.map((p) => map(col + p.x, row + p.y)),
      color: fill,
      ...tags,
    });
  };

  if (ground !== null) {
    shapes.push({
      kind: 'polygon',
      points: [map(0, 0), map(cols, 0), map(cols, rows), map(0, rows)],
      color: ground,
      ...tags,
    });
  }

  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const kind = roleAt(r, c);
      if (kind === null) continue;
      if (kind === 'fixed') {
        push(square, r, c, color(r, c));
        continue;
      }
      const mask = neighborMask(r, c, (nr, nc) => inGrid(nr, nc) && isNeighbor(r, c, nr, nc));
      for (const pts of cellContours(style, mask, { segments })) push(pts, r, c, color(r, c));
    }
  }

  // liquid 오목 필렛: 셀 X(빈 칸 또는 다른 덩어리의 data)의 코너에서 직교 두 셀 A · B 와
  // 대각 D 가 모두 한 덩어리(서로 이웃)이고 X 는 그 덩어리가 아니면, 그 코너 틈을 A 색으로.
  if (style === 'liquid' && params.concave !== false) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const self = roleAt(r, c);
        if (self === 'fixed') continue;
        for (const corner of CORNERS) {
          const [o1, o2] = corner.orth.map((bit) => NEIGHBOR_OFFSETS.find((o) => o.bit === bit));
          const d = NEIGHBOR_OFFSETS.find((o) => o.bit === corner.diag);
          const a = [r + o1.dr, c + o1.dc];
          const b = [r + o2.dr, c + o2.dc];
          const dd = [r + d.dr, c + d.dc];
          if (roleAt(...a) !== 'data' || roleAt(...b) !== 'data' || roleAt(...dd) !== 'data') continue;
          if (!isNeighbor(...a, ...dd) || !isNeighbor(...b, ...dd)) continue;
          if (self === 'data' && (isNeighbor(r, c, ...a) || isNeighbor(r, c, ...b))) continue;
          const mask = corner.orth[0] | corner.orth[1] | corner.diag;
          for (const piece of liquidConcaveContours(mask, { segments })) push(piece.contour, r, c, color(...a));
        }
      }
    }
  }
  return shapes;
}
