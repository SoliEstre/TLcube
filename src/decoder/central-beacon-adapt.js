/**
 * central-beacon-adapt.js — Type Y v0 블록 포즈를 O/G 바깥 격자 포즈로 옮기는 어댑터.
 *
 * 중앙 비컨은 문법적으로 완전한 Type Y v0 코드라, 블록 검출기
 * (`detectCellSurfaceBlockShapes`) 가 이미 찾는다. 그 shape 는
 * `cellSurfaceOnly` · `estimatedN = n` — **블록이 곧 코드 전체** 라는 Type Y
 * 가정이다. O/G 에서는 같은 블록이 중앙 19셀 슬롯의 **삽입물** 이라 스케일이
 * 다르다. 이 모듈은 그 스케일만 뒤집는다. 새 검출기·새 복호기가 아니다.
 *
 * 정방향 (scene.js `renderKind === 'central-v0'`):
 *   모듈 피치 = centralSlotRadius(layout, center) / CENTRAL_V0_SOURCE_N
 * 역방향은 그 식의 항등 — 픽셀 값이나 새 비율 상수를 손으로 적지 않는다.
 *
 * ⚠ `src/beacon.js`(사용 이벤트 전송) 와 다른 축이다. 이름을 합치지 않는다.
 */

import {
  readBeaconFromEncodedY,
  unpackBeaconText,
} from '../centralBeacon.js';
import {
  CELL_SURFACE_FINAL_V0,
  CENTRAL_V0_SOURCE_N,
  centralV0FinderCells,
} from '../cellSurfaceFinal.js';
import { moduleQuad } from '../ygrid.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from '../finder-selection.js';
import { centralBeaconGeometry } from '../centralBeaconWire.js';
import { FINDER_CELL_ORDER } from '../finder-patterns.js';
import { CORNER_UNIT_OFFSETS, hexCorners } from '../hexgrid.js';
import { detectCellSurfaceBlockShapes } from './cellsurface-block-detect.js';
import { projectPoint } from './homography.js';

/** 파인더 후보의 finderKind. cell-mask · three-tone-cube 와 같이 패턴 파인더로 취급한다. */
export const CENTRAL_BEACON_FINDER_KIND = 'central-v0';

const ORIENTATION_DEGREES = Object.freeze([0, 120, 240]);

/**
 * scene.js 의 지역 함수 `centralSlotRadius` 와 **같은 식**.
 * 그 함수는 export 되지 않고, 이 레인은 scene.js 를 고치지 않는다.
 * 정본이 둘이 되지 않게 좌표 표(FINDER_CELL_ORDER · CORNER_UNIT_OFFSETS)만 공유한다.
 */
function centralSlotSupportRadius(layout, center) {
  const points = FINDER_CELL_ORDER.flatMap((cell) => hexCorners(cell.q, cell.r, layout));
  const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map((point) =>
    (point.x - center.x) * axis.x + (point.y - center.y) * axis.y)));
  return Math.min(...supports);
}

const UNIT_CENTRAL_SLOT_RADIUS = centralSlotSupportRadius(
  { size: 1, originX: 0, originY: 0 },
  { x: 0, y: 0 },
);

if (!(UNIT_CENTRAL_SLOT_RADIUS > 0) || !Number.isFinite(UNIT_CENTRAL_SLOT_RADIUS)) {
  throw new Error('중앙 슬롯 단위 반지름을 유도하지 못했다');
}

/** size=1 레이아웃에서 중앙 19셀 슬롯의 지지 반지름. 정방향 식의 계수. */
export function unitCentralSlotRadius() {
  return UNIT_CENTRAL_SLOT_RADIUS;
}

/**
 * 모듈 피치 → 바깥 layout.size.
 * 정방향(scene.js)은 `모듈 피치 = 슬롯반지름(s) × shrink / n` 이고 슬롯반지름은
 * s 에 선형이므로 `s = 모듈 피치 · n / (unitCentralSlotRadius() · shrink)`.
 * shrink 의 정본은 centralBeaconWire — 렌더와 같은 값이 아니면 포즈가 그 비율만큼
 * 어긋난다 (2026-08-22 병행 작업에서 실제로 났던 어긋남).
 */
export function outerCellSizeFromModulePitch(modulePitch) {
  if (!(modulePitch > 0) || !Number.isFinite(modulePitch)) return null;
  return modulePitch * CENTRAL_V0_SOURCE_N
    / (UNIT_CENTRAL_SLOT_RADIUS * centralBeaconGeometry().shrink);
}

/**
 * 블록 shape.radius 는 정육각 외접 반지름 ≈ n · 모듈 피치 = 슬롯반지름 × shrink.
 * 그러므로 radius / (unitRadius · shrink) = 바깥 size.
 */
export function outerCellSizeFromBlockRadius(radius) {
  if (!(radius > 0) || !Number.isFinite(radius)) return null;
  return radius / (UNIT_CENTRAL_SLOT_RADIUS * centralBeaconGeometry().shrink);
}

export function modulePitchFromH(H) {
  if (!(H instanceof Float64Array) || H.length !== 9) return null;
  const origin = projectPoint(H, { x: 0, y: 0 });
  const east = projectPoint(H, { x: 1, y: 0 });
  const south = projectPoint(H, { x: 0, y: 1 });
  if (!origin || !east || !south) return null;
  const pitch = (
    Math.hypot(east.x - origin.x, east.y - origin.y)
    + Math.hypot(south.x - origin.x, south.y - origin.y)
  ) / 2;
  return pitch > 0 && Number.isFinite(pitch) ? pitch : null;
}

/**
 * 안쪽(모듈) H 의 선형 부분을 n/unitRadius 배로 키워 바깥(셀) H 를 만든다.
 * 원점(코드 중심)은 유지한다 — 비컨과 바깥 코드는 같은 중심을 쓴다.
 */
export function scaleHomographyToOuter(innerH) {
  if (!(innerH instanceof Float64Array) || innerH.length !== 9) return null;
  const center = projectPoint(innerH, { x: 0, y: 0 });
  if (!center) return null;
  const scale = CENTRAL_V0_SOURCE_N
    / (UNIT_CENTRAL_SLOT_RADIUS * centralBeaconGeometry().shrink);
  const offsetX = (1 - scale) * center.x;
  const offsetY = (1 - scale) * center.y;
  return new Float64Array([
    scale * innerH[0] + offsetX * innerH[6],
    scale * innerH[1] + offsetX * innerH[7],
    scale * innerH[2] + offsetX * innerH[8],
    scale * innerH[3] + offsetY * innerH[6],
    scale * innerH[4] + offsetY * innerH[7],
    scale * innerH[5] + offsetY * innerH[8],
    innerH[6],
    innerH[7],
    innerH[8],
  ]);
}

export function outerPoseFromInnerH(innerH) {
  const modulePitch = modulePitchFromH(innerH);
  if (modulePitch === null) return null;
  const cellSize = outerCellSizeFromModulePitch(modulePitch);
  const H = scaleHomographyToOuter(innerH);
  const center = projectPoint(innerH, { x: 0, y: 0 });
  if (cellSize === null || !H || !center) return null;
  return { H, cellSize, modulePitch, center };
}

function affineCellHomography(center, cellSize, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return new Float64Array([
    cellSize * cosine, -cellSize * sine, center.x,
    cellSize * sine, cellSize * cosine, center.y,
    0, 0, 1,
  ]);
}

function blockBaseRotationDegrees(shape) {
  const center = shape.center;
  const vertex = Array.isArray(shape.vertices) ? shape.vertices[0] : null;
  if (!center || !vertex) return 0;
  // 캐노니컬 꼭짓점 0 은 (0, −1) — 각도 −90°. 관측 각과의 차가 H 회전이다.
  const observed = Math.atan2(vertex.y - center.y, vertex.x - center.x) * 180 / Math.PI;
  return ((observed - (-90)) % 360 + 360) % 360;
}

export function isV0BeaconBlockShape(shape) {
  return Boolean(
    shape
    && shape.cellSurfaceOnly === true
    && shape.estimatedN === CENTRAL_V0_SOURCE_N
    && shape.blockLocator
    && shape.blockLocator.family === 'v0',
  );
}

export function isCentralV0CubeHypothesis(hypothesis) {
  return Boolean(
    hypothesis
    && hypothesis.family === 'cube'
    && hypothesis.cellSurface === true
    && hypothesis.cellSurfaceLayout === CELL_SURFACE_FINAL_V0
    && hypothesis.n === CENTRAL_V0_SOURCE_N,
  );
}

/**
 * 비컨 메타의 계열 글자 → 바깥 기하 패밀리.
 * G 는 hex 위에 코너 마커가 앉은 것이라 패밀리는 hex, 포맷 워드가 G 인덱스를 말한다.
 * Y 는 바깥 O/G 가 아니므로 시딩하지 않는다.
 */
export function familiesForBeaconMeta(meta) {
  if (!meta || typeof meta.family !== 'string') return [];
  if (meta.family === 'A') return ['tri'];
  if (meta.family === 'Y') return [];
  return ['hex'];
}

export function tryReadBeaconFromText(text) {
  if (typeof text !== 'string') return null;
  try {
    return unpackBeaconText(text);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function tryReadBeaconFromEncodedY(encodedY) {
  try {
    return readBeaconFromEncodedY(encodedY);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) return null;
    throw error;
  }
}

export function isPatternFinderKind(kind) {
  return kind === 'cell-mask'
    || kind === 'three-tone-cube'
    || kind === CENTRAL_BEACON_FINDER_KIND;
}

/** locator 면 중심의 luma 를 최근접 픽셀로 읽는다. */
function sampleLuma(luma, x, y) {
  const ix = Math.max(0, Math.min(luma.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(luma.height - 1, Math.round(y)));
  return luma.data[iy * luma.width + ix];
}

/**
 * 블록이 정말 v0 비컨인가 — locator 30셀 × 3면의 정본 톤(0=어두움 · 2=밝음)을
 * 관측 luma 와 대조한다.
 *
 * 왜 있나 (2026-08-22 실측): 블록 로케이터의 `blockLocator.family === 'v0'` 는
 * **주장이지 증거가 아니다.** 확대·잘림 불스아이 프레임에서도 v0 로 표식된 shape 가
 * 나왔고, 그 가짜 후보가 가설에 섞여 **비컨 없는 프레임의 종결 코드를 바꿨다**
 * (symbol-clipped → no-format-candidate, decoder-frontend 회귀가 잡았다).
 * Type Y 경로에서는 뒤의 CS 게이트가 거르므로 그 헐거움이 무해하지만, 이 어댑터는
 * 표식만 믿고 바깥 가설을 시딩하므로 **여기서 직접 확인해야** 한다.
 *
 * 판정은 상대적이다 — 절대 문턱이 아니라, 정본이 «밝다» 는 면과 «어둡다» 는 면을
 * 관측 중앙값의 중점으로 갈랐을 때 **일치율 5/6 이상**을 요구한다. 정본 배치는
 * centralV0FinderCells() 하나에서 온다 (손 좌표 없음). 진짜 비컨은 합성 ppu 12 에서
 * 90/90 이 나오고, 불스아이 오표식은 절반 근처에서 떨어진다.
 */
export function verifyV0LocatorTones(luma, center, modulePitch, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const layout = { size: modulePitch, originX: 0, originY: 0 };
  const samples = [];
  for (const cell of centralV0FinderCells()) {
    for (const face of ['T', 'L', 'R']) {
      const quad = moduleQuad(face, cell.i, cell.j, layout);
      let fx = 0;
      let fy = 0;
      for (const point of quad) {
        fx += point.x;
        fy += point.y;
      }
      fx /= quad.length;
      fy /= quad.length;
      const x = center.x + fx * cosine - fy * sine;
      const y = center.y + fx * sine + fy * cosine;
      samples.push({ expectBright: cell[face] === 2, value: sampleLuma(luma, x, y) });
    }
  }
  const dark = samples.filter((sample) => !sample.expectBright);
  const bright = samples.filter((sample) => sample.expectBright);
  if (dark.length === 0 || bright.length === 0) return { pass: false, agreement: 0 };
  const median = (list) => {
    const sorted = list.map((sample) => sample.value).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const midpoint = (median(dark) + median(bright)) / 2;
  let agree = 0;
  for (const sample of samples) {
    if ((sample.value > midpoint) === sample.expectBright) agree += 1;
  }
  const agreement = agree / samples.length;
  return { pass: agreement >= 5 / 6, agreement };
}

/**
 * 블록 로케이터가 낸 v0 n=13 shape 를 O/G 중앙 파인더 후보로 바꾼다.
 *
 * 기존 `detectCentralCubeFinders` 가 실패한 뒤에만 붙인다 — 3톤 큐브·셀마스크가
 * 이미 있는 프레임에 섞으면 통과하던 source 가 바뀐다.
 */
export function discoverCentralBeaconFinders(luma, options = {}) {
  if (options.centralBeacon === false) return [];
  const overrides = options.centralBeacon && typeof options.centralBeacon === 'object'
    ? options.centralBeacon
    : {};
  const detected = detectCellSurfaceBlockShapes(luma, overrides);
  const finders = [];
  for (const shape of detected.shapes) {
    if (!isV0BeaconBlockShape(shape)) continue;
    const cellSize = outerCellSizeFromBlockRadius(shape.radius);
    if (cellSize === null) continue;
    const center = { x: shape.center.x, y: shape.center.y };
    const baseDegrees = blockBaseRotationDegrees(shape);
    const modulePitch = shape.radius / CENTRAL_V0_SOURCE_N;
    for (let index = 0; index < ORIENTATION_DEGREES.length; index += 1) {
      const degrees = (baseDegrees + ORIENTATION_DEGREES[index]) % 360;
      // 표식만 믿고 시딩하지 않는다 — locator 톤 대조를 통과한 방향만 후보가 된다
      // (verifyV0LocatorTones 헤더의 오표식 사고 참조). 방향 판별도 겸한다.
      const verdict = verifyV0LocatorTones(luma, center, modulePitch, degrees);
      if (!verdict.pass) continue;
      const H = affineCellHomography(center, cellSize, degrees);
      finders.push({
        finderKind: CENTRAL_BEACON_FINDER_KIND,
        kind: CENTRAL_BEACON_FINDER_KIND,
        patternId: CENTRAL_V0_FINDER_PATTERN_ID,
        center,
        cellSize,
        score: shape.score,
        orientation: Math.round((((degrees % 360) + 360) % 360) / 120) % 3,
        orientationSource: 'central-v0-locator-tones',
        orientationMargin: verdict.agreement,
        rotationDegrees: degrees,
        H,
        transform: H,
        B: H,
        geometryResidual: 0,
        geometryMode: 'affine',
        source: 'central-v0-block-locator',
        blockShapeIndex: shape.componentIndex,
      });
    }
  }
  return finders;
}
