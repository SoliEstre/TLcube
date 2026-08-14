/**
 * locatorY.js — Type Y 실험용 로케이터 오버레이 (페이로드·와이어와 분리)
 *
 * 이 모듈은 광학 표시만 만든다. encodeY / capacityY / placementY / 레퍼런스 계약을
 * 바꾸지 않는다. 좌표는 전부 모듈(셀) 상대이며 기기 픽셀을 쓰지 않는다.
 *
 * 프로파일
 *   off            표시 없음. 안정판·기본값. 기존 Type Y 와 동일.
 *   hex-frame-v1     육각 실루엣 밖 가드된 이중 테두리 + 꼭짓점 L + 중앙 C형 3팔 허브.
 *   cell-surface-v1  셀 표면 코너 패턴(Y1/Y1T 공용 locator). 이 모듈은 외곽 도형을 그리지 않는다.
 *
 * 회전 위상
 *   중앙 육각 고리의 오른쪽 변 하나를 열어 C형으로 만든다. 검출기는 이 갭을 60°
 *   회전 위상 신호로 사용하되, 인쇄 번짐 등으로 갭 신뢰도가 낮으면 기존 세 방향
 *   가설과 인접 위상 탐색으로 폴백한다.
 *
 * 샘플 원판
 *   (0,0) 모듈 중심은 원점에서 0.5·cellSize, 기본 원판 반지름 ≈ 0.2165·cellSize.
 *   허브는 r ≤ 0.26·cellSize 안에 둔다. 외곽 테두리는 실루엣(n·cellSize) 밖에만 둔다.
 */

import { CORNER_UNIT_OFFSETS } from './hexgrid.js';

export const LOCATOR_PROFILE_OFF = 'off';
export const LOCATOR_PROFILE_HEX_FRAME_V1 = 'hex-frame-v1';
export const LOCATOR_PROFILE_CELL_SURFACE_V1 = 'cell-surface-v1';
export const LOCATOR_PROFILES_Y = Object.freeze([
  LOCATOR_PROFILE_OFF,
  LOCATOR_PROFILE_HEX_FRAME_V1,
  LOCATOR_PROFILE_CELL_SURFACE_V1,
]);
export const DEFAULT_LOCATOR_PROFILE_Y = LOCATOR_PROFILE_OFF;

/**
 * hex-frame-v1 치수. 단위는 셀(모듈). Y0 최소 렌더(ppu≈8)에서 획 ≈ 2.9px.
 * 값은 닫힌 형태 상수 — 삼각함수로 다시 만들지 않는다.
 */
export const HEX_FRAME_V1 = Object.freeze({
  guardIn: 0.50,
  stroke: 0.36,
  gap: 0.40,
  guardOut: 0.50,
  lArm: 1.60,
  hubRingInner: 0.12,
  hubRingOuter: 0.20,
  hubGuard: 0.26,
  hubArmHalf: 0.08,
  hubArmEnd: 0.55,
  hubSeamCorners: Object.freeze([1, 3, 5]),
  hubGapSide: 1,
});

const HUB_SAMPLE_CLEARANCE = 0.28;

export function isLocatorProfileY(value) {
  return LOCATOR_PROFILES_Y.includes(value);
}

export function assertLocatorProfileY(value) {
  if (!isLocatorProfileY(value)) {
    throw new RangeError(
      `locatorProfile 는 ${LOCATOR_PROFILES_Y.join(' | ')} 중 하나여야 한다: ${value}`,
    );
  }
  return value;
}

/** 실루엣 꼭짓점 밖으로 나가는 테두리+가드 두께(셀). */
export function locatorOuterPaddingCells(profile) {
  const id = profile === undefined ? DEFAULT_LOCATOR_PROFILE_Y : assertLocatorProfileY(profile);
  if (id === LOCATOR_PROFILE_OFF || id === LOCATOR_PROFILE_CELL_SURFACE_V1) return 0;
  const g = HEX_FRAME_V1;
  return g.guardIn + g.stroke + g.gap + g.stroke + g.guardOut;
}

export function locatorInnerDarkInnerCells(n) {
  return n + HEX_FRAME_V1.guardIn;
}

export function locatorInnerDarkOuterCells(n) {
  return n + HEX_FRAME_V1.guardIn + HEX_FRAME_V1.stroke;
}

export function locatorOuterDarkInnerCells(n) {
  return n + HEX_FRAME_V1.guardIn + HEX_FRAME_V1.stroke + HEX_FRAME_V1.gap;
}

export function locatorOuterDarkOuterCells(n) {
  return n + HEX_FRAME_V1.guardIn + HEX_FRAME_V1.stroke + HEX_FRAME_V1.gap + HEX_FRAME_V1.stroke;
}

export function locatorOuterExtentCells(n) {
  return n + locatorOuterPaddingCells(LOCATOR_PROFILE_HEX_FRAME_V1);
}

/**
 * 허브가 (0,0) 샘플 원판과 겹치지 않는지. 원판 최근접은 ≈ 0.2835·cellSize.
 */
export function locatorHubClearsSampleDiscs(profile) {
  const id = profile === undefined ? DEFAULT_LOCATOR_PROFILE_Y : assertLocatorProfileY(profile);
  if (id === LOCATOR_PROFILE_OFF || id === LOCATOR_PROFILE_CELL_SURFACE_V1) return true;
  return HEX_FRAME_V1.hubGuard <= HUB_SAMPLE_CLEARANCE
    && HEX_FRAME_V1.hubRingOuter <= HUB_SAMPLE_CLEARANCE;
}

function hexPoints(center, radius) {
  return CORNER_UNIT_OFFSETS.map((u) => ({
    x: center.x + u.x * radius,
    y: center.y + u.y * radius,
  }));
}

function pushQuad(shapes, a, b, c, d, color, metadata = undefined) {
  shapes.push({
    kind: 'polygon',
    points: [a, b, c, d],
    color,
    ...(metadata || {}),
  });
}

/** 두 동심 육각 사이의 고리(6 사각). */
function pushHexRing(shapes, center, rInner, rOuter, color, options = undefined) {
  const inner = hexPoints(center, rInner);
  const outer = hexPoints(center, rOuter);
  const omitted = new Set(options && options.omitEdges ? options.omitEdges : []);
  for (let i = 0; i < 6; i += 1) {
    if (omitted.has(i)) continue;
    const j = (i + 1) % 6;
    pushQuad(shapes, outer[i], outer[j], inner[j], inner[i], color, options && {
      locatorPart: options.part,
      locatorEdge: i,
    });
  }
}

function edgeUnit(i) {
  const a = CORNER_UNIT_OFFSETS[i];
  const b = CORNER_UNIT_OFFSETS[(i + 1) % 6];
  // 인접 단위 꼭짓점은 60° — |b-a| = 1.
  return { x: b.x - a.x, y: b.y - a.y };
}

function outwardNormal(i) {
  const e = edgeUnit(i);
  let nx = -e.y;
  let ny = e.x;
  const mid = CORNER_UNIT_OFFSETS[i];
  if (nx * mid.x + ny * mid.y < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/** `along` 은 단위 벡터. 수직도 단위라 제곱근이 필요 없다. */
function strokeAlongUnit(shapes, p0, p1, along, half, color) {
  const nx = -along.y * half;
  const ny = along.x * half;
  pushQuad(
    shapes,
    { x: p0.x + nx, y: p0.y + ny },
    { x: p1.x + nx, y: p1.y + ny },
    { x: p1.x - nx, y: p1.y - ny },
    { x: p0.x - nx, y: p0.y - ny },
    color,
  );
}

/**
 * hex-frame-v1 도형. 호출자가 palette.bullseyeDark / bullseyeLight 를 준다.
 * 흰 가드를 먼저 깔아 배경이 어둡거나 투명이어도 획이 분리된다.
 */
export function locatorShapesY(n, layout, palette, profile) {
  const id = profile === undefined ? DEFAULT_LOCATOR_PROFILE_Y : assertLocatorProfileY(profile);
  if (id === LOCATOR_PROFILE_OFF || id === LOCATOR_PROFILE_CELL_SURFACE_V1) return [];
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`n 은 1 이상의 정수여야 한다: ${n}`);
  }
  if (!layout || !Number.isFinite(layout.size) || layout.size <= 0) {
    throw new RangeError('layout.size 는 유한한 양수여야 한다');
  }
  if (!palette || !palette.bullseyeDark || !palette.bullseyeLight) {
    throw new TypeError('palette.bullseyeDark / bullseyeLight 가 필요하다');
  }

  const size = layout.size;
  const center = { x: layout.originX, y: layout.originY };
  const dark = palette.bullseyeDark;
  const light = palette.bullseyeLight;
  const g = HEX_FRAME_V1;
  const shapes = [];

  const inner0 = locatorInnerDarkInnerCells(n) * size;
  const inner1 = locatorInnerDarkOuterCells(n) * size;
  const outer0 = locatorOuterDarkInnerCells(n) * size;
  const outer1 = locatorOuterDarkOuterCells(n) * size;
  const halo = 0.18 * size;

  // ① 흰 가드 — 실루엣·기존 Y-심을 덮지 않는다. 새 획 둘레에만 후광.
  pushHexRing(shapes, center, inner0 - halo, inner1 + halo, light);
  pushHexRing(shapes, center, outer0 - halo, outer1 + halo, light);
  pushHexRing(
    shapes,
    center,
    g.hubRingInner * size - halo * 0.4,
    g.hubRingOuter * size + halo * 0.4,
    light,
  );

  // ② 이중 육각 테두리.
  pushHexRing(shapes, center, inner0, inner1, dark);
  pushHexRing(shapes, center, outer0, outer1, dark);

  // ③ 꼭짓점 L — 이중 획을 두 인접 변을 따라 짧게 덧칠.
  const arm = g.lArm * size;
  const halfInner = (g.stroke * size) / 2;
  const halfOuter = (g.stroke * size) / 2;
  const innerMid = (inner0 + inner1) / 2;
  const outerMid = (outer0 + outer1) / 2;
  for (let i = 0; i < 6; i += 1) {
    const prev = (i + 5) % 6;
    const u = CORNER_UNIT_OFFSETS[i];
    const ePrev = edgeUnit(prev);
    const eNext = edgeUnit(i);
    const tipInner = { x: center.x + u.x * innerMid, y: center.y + u.y * innerMid };
    const tipOuter = { x: center.x + u.x * outerMid, y: center.y + u.y * outerMid };
    strokeAlongUnit(
      shapes,
      tipInner,
      { x: tipInner.x + eNext.x * arm, y: tipInner.y + eNext.y * arm },
      eNext,
      halfInner,
      dark,
    );
    strokeAlongUnit(
      shapes,
      tipInner,
      { x: tipInner.x - ePrev.x * arm, y: tipInner.y - ePrev.y * arm },
      ePrev,
      halfInner,
      dark,
    );
    strokeAlongUnit(
      shapes,
      tipOuter,
      { x: tipOuter.x + eNext.x * arm, y: tipOuter.y + eNext.y * arm },
      eNext,
      halfOuter,
      dark,
    );
    strokeAlongUnit(
      shapes,
      tipOuter,
      { x: tipOuter.x - ePrev.x * arm, y: tipOuter.y - ePrev.y * arm },
      ePrev,
      halfOuter,
      dark,
    );
  }

  // ④ 중앙 허브 — 오른쪽 변을 연 C형 육각 고리 + C1/C3/C5 짧은 3팔.
  // 흰 가드는 닫힌 고리로 남겨 열린 변이 주변 데이터에 묻히지 않게 한다.
  pushHexRing(
    shapes,
    center,
    g.hubRingInner * size,
    g.hubRingOuter * size,
    dark,
    { omitEdges: [g.hubGapSide], part: 'hub-c-ring' },
  );
  const armHalf = g.hubArmHalf * size;
  const armEnd = g.hubArmEnd * size;
  const armStart = g.hubRingInner * size;
  for (const corner of g.hubSeamCorners) {
    const u = CORNER_UNIT_OFFSETS[corner];
    const p0 = { x: center.x + u.x * armStart, y: center.y + u.y * armStart };
    const p1 = { x: center.x + u.x * armEnd, y: center.y + u.y * armEnd };
    strokeAlongUnit(shapes, p0, p1, u, armHalf + halo * 0.5, light);
    strokeAlongUnit(shapes, p0, p1, u, armHalf, dark);
  }

  return shapes;
}

export function locatorMarginCells(profile) {
  return locatorOuterPaddingCells(profile);
}

/** 테스트·검출기가 같은 축소 비율을 쓰도록 공개. 외곽 획 중선 → 큐브 꼭짓점. */
export function cubeRadiusFromOuterDarkOuter(rOuter, n) {
  const extent = locatorOuterDarkOuterCells(n);
  if (!(extent > 0) || !(rOuter > 0)) return null;
  return rOuter * (n / extent);
}

export function cubeRadiusFromInnerDarkInner(rInner, n) {
  const extent = locatorInnerDarkInnerCells(n);
  if (!(extent > 0) || !(rInner > 0)) return null;
  return rInner * (n / extent);
}

// 미사용 경고를 피하면서 검출기·테스트가 법선을 재사용할 수 있게 둔다.
export const _locatorGeom = Object.freeze({ hexPoints, edgeUnit, outwardNormal });
