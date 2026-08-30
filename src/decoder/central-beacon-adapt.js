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
import { CORNER_UNIT_OFFSETS, hexCorners, regionCells } from '../hexgrid.js';
import { VERSIONS } from '../capacity.js';
import { VERSIONS_A } from '../capacityA.js';
import { VERSIONS_C } from '../capacityC.js';
import { VERSIONS_K } from '../capacityK.js';
import { notchCellsC } from '../notchC.js';
import { regionCellsK } from '../layoutK.js';
import { regionCellsA } from '../placementA.js';
import { decodeSingle } from '../formatinfo.js';
import { K_FORMAT_INDEX } from '../formatK.js';
import {
  CENTRAL_N7_DATA_SCAN_ORDER,
  CENTRAL_N7_FINDER_PATTERN_ID,
  CENTRAL_N7_LOCATOR_CELLS,
  CENTRAL_N7_PATTERN_FAMILY_ID,
  CENTRAL_N7_SCHEMA_ID,
  CENTRAL_N7_SIZE,
} from '../centralN7Schema.js';
import { decodeCentralN7 } from '../centralN7Codec.js';
import { ranksToDigit } from '../lehmer.js';
import {
  detectCellSurfaceBlockShapes,
  detectCentralN7BlockShapes,
} from './cellsurface-block-detect.js';
import { robustPercentiles } from './luma.js';
import { projectPoint } from './homography.js';

/** 파인더 후보의 finderKind. cell-mask · three-tone-cube 와 같이 패턴 파인더로 취급한다. */
export const CENTRAL_BEACON_FINDER_KIND = 'central-v0';
export const CENTRAL_N7_FINDER_KIND = CENTRAL_N7_PATTERN_FAMILY_ID;

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

/** n=7 coded locator 전용 역변환. v0의 source size 13 경로와 분리한다. */
export function outerCellSizeFromCentralN7ModulePitch(modulePitch) {
  if (!(modulePitch > 0) || !Number.isFinite(modulePitch)) return null;
  return modulePitch * CENTRAL_N7_SIZE
    / (UNIT_CENTRAL_SLOT_RADIUS * centralBeaconGeometry().shrink);
}

/** n=7 내부 H를 바깥 셀 H로 옮긴다. 원점은 중앙 슬롯과 함께 고정된다. */
export function scaleCentralN7HomographyToOuter(innerH) {
  if (!(innerH instanceof Float64Array) || innerH.length !== 9) return null;
  const center = projectPoint(innerH, { x: 0, y: 0 });
  if (!center) return null;
  const scale = CENTRAL_N7_SIZE
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
 * 비컨 메타의 계열 글자 + 바깥 포맷 워드 → 바깥 기하 패밀리.
 * G 는 hex 위에 코너 마커가 앉은 것이라 패밀리는 hex, 포맷 워드가 G 인덱스를 말한다.
 * K 는 현재 비컨 계열 추론에서 평 K를 O, K-CM을 G로 적지만, 바깥 포맷 값 7/8은
 * star 축에서만 유효하다. 그래서 그 5digit을 직접 복호해 K 표의 값이면 star로
 * 되짚는다. 새 와이어 값은 없고, K 표가 이미 가진 7/8을 판별 신호로 재사용한다.
 * Y 는 바깥 O/G 가 아니므로 시딩하지 않는다.
 */
export function familiesForBeaconMeta(meta) {
  if (!meta || typeof meta.family !== 'string') return [];
  if (meta.family === 'K') return ['star'];
  if (meta.family === 'A') return ['tri'];
  if (meta.family === 'Y') return [];
  if (Array.isArray(meta.formatDigits) && meta.formatDigits.length === 5) {
    const format = decodeSingle(meta.formatDigits);
    if (format.ok && K_FORMAT_INDEX.some((entry) => entry.formatIndex === format.version)) {
      return ['star'];
    }
  }
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
    || kind === CENTRAL_BEACON_FINDER_KIND
    || kind === CENTRAL_N7_FINDER_KIND;
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

function medianNumbers(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function centralN7FaceSamples(luma, cells, center, modulePitch, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const layout = { size: modulePitch, originX: 0, originY: 0 };
  return cells.map((cell) => {
    const values = {};
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
      values[face] = sampleLuma(
        luma,
        center.x + fx * cosine - fy * sine,
        center.y + fx * sine + fy * cosine,
      );
    }
    return { cell, values };
  });
}

/**
 * n=7 locator 30셀 × 3면을 정본 톤과 대조한다. v0 좌표를 읽지 않는 별도 verifier다.
 * 최종 수용 문턱은 v0와 같은 5/6이며, 아래 parser와 블록 상관 점수는 이를 대체하지 않는다.
 */
export function verifyCentralN7LocatorTones(luma, center, modulePitch, degrees) {
  const samples = centralN7FaceSamples(
    luma, CENTRAL_N7_LOCATOR_CELLS, center, modulePitch, degrees,
  ).flatMap(({ cell, values }) => ['T', 'L', 'R'].map((face) => ({
    expectBright: cell[face] === 2,
    value: values[face],
  })));
  const darkValues = samples.filter((sample) => !sample.expectBright)
    .map((sample) => sample.value);
  const brightValues = samples.filter((sample) => sample.expectBright)
    .map((sample) => sample.value);
  const dark = medianNumbers(darkValues);
  const bright = medianNumbers(brightValues);
  if (dark === null || bright === null || !(bright > dark)) {
    return { pass: false, agreement: 0, dark, bright, midpoint: null };
  }
  const midpoint = (dark + bright) / 2;
  let agree = 0;
  for (const sample of samples) {
    if ((sample.value > midpoint) === sample.expectBright) agree += 1;
  }
  const agreement = agree / samples.length;
  return { pass: agreement >= 5 / 6, agreement, dark, bright, midpoint };
}

/**
 * 19 data 셀을 읽는다. locator는 dark/light만 알아 mid 기준값을 주지 않으므로,
 * 각 data 셀의 세 면 순위에서 19개씩의 low/mid/high 군을 유도해 mid를 추정한다.
 * 동률 셀과 decodeCentralN7 코드워드 실패는 후보를 거부한다.
 */
export function readCentralN7Payload(luma, center, modulePitch, degrees, locatorTone = null) {
  const sampled = centralN7FaceSamples(
    luma, CENTRAL_N7_DATA_SCAN_ORDER, center, modulePitch, degrees,
  );
  const rankGroups = [[], [], []];
  const digits = [];
  for (const { values } of sampled) {
    const ordered = ['T', 'L', 'R'].map((face) => ({ face, value: values[face] }))
      .sort((left, right) => left.value - right.value || left.face.localeCompare(right.face));
    if (!(ordered[0].value < ordered[1].value && ordered[1].value < ordered[2].value)) {
      return null;
    }
    const ranks = {};
    for (let rank = 0; rank < ordered.length; rank += 1) {
      ranks[ordered[rank].face] = rank;
      rankGroups[rank].push(ordered[rank].value);
    }
    digits.push(ranksToDigit(ranks));
  }
  const rawLevels = rankGroups.map((values) => medianNumbers(values));
  if (!(rawLevels[0] < rawLevels[1] && rawLevels[1] < rawLevels[2])) return null;
  const locatorScale = locatorTone
    && Number.isFinite(locatorTone.dark) && Number.isFinite(locatorTone.bright)
    && locatorTone.bright > locatorTone.dark
    ? { dark: locatorTone.dark, bright: locatorTone.bright, source: 'locator-dark-light' }
    : { dark: rawLevels[0], bright: rawLevels[2], source: 'payload-extrema' };
  const span = locatorScale.bright - locatorScale.dark;
  const levels = rawLevels.map((value) => (value - locatorScale.dark) / span);
  if (!levels.every(Number.isFinite)
    || !(levels[0] < levels[1] && levels[1] < levels[2])) return null;
  const decoded = decodeCentralN7(digits);
  if (decoded === null) return null;
  return {
    ...decoded,
    digits,
    levels,
    rawLevels,
    mid: levels[1],
    normalization: locatorScale,
  };
}

/**
 * k-육각 코드 영역 **전체**의 단위 지지 반지름 — 슬롯과 같은 6축 metric.
 * k 목록은 손으로 적지 않고 용량표(VERSIONS)에서 온다.
 */
const UNIT_OUTER_SUPPORT = (() => {
  const table = new Map();
  const layout = { size: 1, originX: 0, originY: 0 };
  for (const spec of VERSIONS) {
    const points = regionCells(spec.k).flatMap((cell) => hexCorners(cell.q, cell.r, layout));
    const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map(
      (point) => point.x * axis.x + point.y * axis.y)));
    table.set(spec.k, Math.min(...supports));
  }
  return table;
})();

/** Type K 별 실루엣의 단위 지지 반지름. 중앙 슬롯은 O와 같지만 바깥 경계가 3k
 * 꼭짓점까지 뻗으므로, O 표로 역산한 cellSize는 K에서 틀린다. 기존 표는 건드리지
 * 않고 별 후보를 나란히 둔 뒤 locator 톤 대조가 맞는 배율만 남긴다. */
const UNIT_STAR_OUTER_SUPPORT = (() => {
  const table = new Map();
  const layout = { size: 1, originX: 0, originY: 0 };
  for (const spec of VERSIONS_K) {
    const points = regionCellsK(spec.k).flatMap((cell) => hexCorners(cell.q, cell.r, layout));
    const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map(
      (point) => point.x * axis.x + point.y * axis.y)));
    table.set(spec.k, Math.min(...supports));
  }
  return table;
})();

/**
 * Type C 노치 실루엣의 단위 지지 반지름 — regionCells(k) − notchCellsC(k) (노치 v2).
 * k 목록은 손으로 적지 않고 VERSIONS_C 에서, 노치 좌표는 notchC 정본에서 온다 —
 * UNIT_OUTER_SUPPORT 와 같은 구축 방식이고 실루엣만 다르다. 노치가 3시 코너를
 * 파내므로 최소 지지 축이 그 코너 축이 되고, 값은 같은 k 의 평 hex 보다 약간 작다 —
 * 프레임 전경 실측(min-support)과 같은 metric 이라 배율 역산이 정합한다.
 */
const UNIT_C_OUTER_SUPPORT = (() => {
  const table = new Map();
  const layout = { size: 1, originX: 0, originY: 0 };
  for (const spec of VERSIONS_C) {
    const notch = new Set(notchCellsC(spec.k).map((cell) => `${cell.q},${cell.r}`));
    const points = regionCells(spec.k)
      .filter((cell) => !notch.has(`${cell.q},${cell.r}`))
      .flatMap((cell) => hexCorners(cell.q, cell.r, layout));
    const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map(
      (point) => point.x * axis.x + point.y * axis.y)));
    table.set(spec.k, Math.min(...supports));
  }
  return table;
})();

/** Type A/V 삼각 실루엣의 단위 지지 반지름. 180° turn은 같은 지지값을 갖는다. */
const UNIT_TRI_OUTER_SUPPORT = (() => {
  const table = new Map();
  const layout = { size: 1, originX: 0, originY: 0 };
  for (const spec of VERSIONS_A) {
    const points = regionCellsA(spec.k).flatMap((cell) => hexCorners(cell.q, cell.r, layout));
    const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map(
      (point) => point.x * axis.x + point.y * axis.y)));
    table.set(spec.k, Math.min(...supports));
  }
  return table;
})();

/** n=7 경로만 쓰는 바깥 전경 seed. v0 center-prior의 계산·순서에는 닿지 않는다. */
export function centralN7CenterPriorSeeds(luma, verifiedCoreHits = []) {
  const spread = robustPercentiles(luma, [0.05, 0.95]);
  if (!spread) return [];
  const margin = (spread[1] - spread[0]) * 0.2;
  if (!(margin > 0)) return [];
  const border = [];
  const stride = Math.max(1, Math.floor(Math.min(luma.width, luma.height) / 64));
  for (let x = 0; x < luma.width; x += stride) {
    border.push(luma.data[x], luma.data[(luma.height - 1) * luma.width + x]);
  }
  for (let y = 0; y < luma.height; y += stride) {
    border.push(luma.data[y * luma.width], luma.data[y * luma.width + luma.width - 1]);
  }
  border.sort((left, right) => left - right);
  const background = border[Math.floor(border.length / 2)];
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < luma.height; y += 2) {
    const row = y * luma.width;
    for (let x = 0; x < luma.width; x += 2) {
      if (Math.abs(luma.data[row + x] - background) <= margin) continue;
      sumX += x;
      sumY += y;
      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return [];
  const center = { x: sumX / count, y: sumY / count };
  const supports = CORNER_UNIT_OFFSETS.map(() => -Infinity);
  for (let y = 0; y < luma.height; y += 2) {
    const row = y * luma.width;
    for (let x = 0; x < luma.width; x += 2) {
      if (Math.abs(luma.data[row + x] - background) <= margin) continue;
      for (let axis = 0; axis < CORNER_UNIT_OFFSETS.length; axis += 1) {
        const unit = CORNER_UNIT_OFFSETS[axis];
        const support = (x - center.x) * unit.x + (y - center.y) * unit.y;
        if (support > supports[axis]) supports[axis] = support;
      }
    }
  }
  const outerSupport = Math.min(...supports);
  if (!(outerSupport > 0)) return [];
  const shrink = centralBeaconGeometry().shrink;
  const tables = [
    ['hex', UNIT_OUTER_SUPPORT],
    // Type C — payload family 는 hex(비컨=표면 포맷 사본, PM/027 §5.3 안 ①)라 seed
    // 도 hex 로 라벨한다. k(14/16/18/20)가 legacy hex(6..12)와 겹치지 않아 병기 안전.
    ['hex', UNIT_C_OUTER_SUPPORT],
    ['tri', UNIT_TRI_OUTER_SUPPORT],
    ['star', UNIT_STAR_OUTER_SUPPORT],
  ];
  // 비대칭 tri/star 실루엣에서는 전경 무게중심이 중앙 슬롯이 아니다. locator 패치가
  // 최종 선택하므로 무게중심·전경 bbox 중심·프레임 중심을 독립 seed로 제공한다.
  const centers = [
    center,
    { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    { x: (luma.width - 1) / 2, y: (luma.height - 1) / 2 },
  ].filter((candidate, index, all) => !all.slice(0, index).some((previous) =>
    Math.hypot(previous.x - candidate.x, previous.y - candidate.y) < 1));
  const seeds = [];
  for (const [outerFamily, table] of tables) {
    for (const [outerK, unitOuter] of table) {
      const outerCellSize = outerSupport / unitOuter;
      const modulePitch = outerCellSize * UNIT_CENTRAL_SLOT_RADIUS * shrink / CENTRAL_N7_SIZE;
      for (const seedCenter of centers) {
        for (const degrees of ORIENTATION_DEGREES) {
          seeds.push({
            center: { x: seedCenter.x, y: seedCenter.y },
            modulePitch,
            degrees,
            outerFamily,
            outerK,
            outerCellSize,
          });
        }
      }
    }
  }
  // n=7 locator 내부에도 v0 core 스캐너가 잡는 국소 동심 서명이 있다. 그 hit에서
  // **위치와 초기 unit만** 빌리고, 최종 template/refinement는 위의 독립 90면 패치다.
  // 중앙 슬롯 계약에 따라 프레임 중앙 50% 밖의 QR/UI hit는 seed로도 쓰지 않는다.
  for (const hit of verifiedCoreHits) {
    if (hit?.kind !== 'v0-center' || !(hit.u > 0)) continue;
    if (Math.abs(hit.x - luma.width / 2) > luma.width / 4
      || Math.abs(hit.y - luma.height / 2) > luma.height / 4) continue;
    for (const scale of [0.85, 1, 1.15, 1.3]) {
      for (const degrees of ORIENTATION_DEGREES) {
        seeds.push({
          center: { x: hit.x, y: hit.y },
          modulePitch: hit.u * scale,
          degrees,
          outerFamily: null,
          outerK: null,
          outerCellSize: null,
          searchRadiusCells: 1,
        });
      }
    }
  }
  return seeds;
}

function centralN7Finders(luma, verifiedCoreHits) {
  const detected = detectCentralN7BlockShapes(
    luma, centralN7CenterPriorSeeds(luma, verifiedCoreHits),
  );
  const finders = [];
  for (const shape of detected.shapes) {
    if (shape.estimatedN !== CENTRAL_N7_SIZE
      || shape.blockLocator?.family !== CENTRAL_N7_PATTERN_FAMILY_ID
      || shape.blockLocator?.schemaId !== CENTRAL_N7_SCHEMA_ID) continue;
    const modulePitch = shape.blockLocator.modulePitch;
    const degrees = shape.blockLocator.rotationDegrees;
    const tone = verifyCentralN7LocatorTones(luma, shape.center, modulePitch, degrees);
    if (!tone.pass) continue;
    const payload = readCentralN7Payload(luma, shape.center, modulePitch, degrees, tone);
    if (!payload) continue;
    const cellSize = outerCellSizeFromCentralN7ModulePitch(modulePitch);
    if (cellSize === null) continue;
    const innerH = affineCellHomography(shape.center, modulePitch, degrees);
    const H = scaleCentralN7HomographyToOuter(innerH);
    if (!H) continue;
    finders.push({
      finderKind: CENTRAL_N7_FINDER_KIND,
      kind: CENTRAL_N7_FINDER_KIND,
      patternId: CENTRAL_N7_FINDER_PATTERN_ID,
      center: { x: shape.center.x, y: shape.center.y },
      cellSize,
      score: shape.score,
      orientation: Math.round((((degrees % 360) + 360) % 360) / 120) % 3,
      orientationSource: 'central-n7-locator-tones',
      orientationMargin: tone.agreement,
      rotationDegrees: degrees,
      H,
      transform: H,
      B: H,
      geometryMode: 'affine',
      source: 'central-n7-block-locator',
      blockShapeIndex: shape.componentIndex,
      centralN7: {
        schemaId: CENTRAL_N7_SCHEMA_ID,
        family: payload.family,
        outerFormat: payload.outerFormat,
        digits: payload.digits,
        levels: payload.levels,
        rawLevels: payload.rawLevels,
        mid: payload.mid,
        normalization: payload.normalization,
        locatorDark: tone.dark,
        locatorBright: tone.bright,
        modulePitch,
        outerSeedFamily: shape.blockLocator.outerFamily,
        outerSeedK: shape.blockLocator.outerK,
      },
    });
  }
  // 같은 core hit의 scale 이 locator plateau 안에서 동일 점수를 내도 바깥 H에는 수 %
  // 차이가 난다. codeword family와 독립 실루엣 family가 합의한 후보를 먼저 두고,
  // 사실상 같은 포즈만 합쳐 하류 가설 예산을 중복이 점유하지 못하게 한다.
  finders.sort((left, right) => {
    const leftOwner = left.centralN7.outerSeedFamily === left.centralN7.family ? 1 : 0;
    const rightOwner = right.centralN7.outerSeedFamily === right.centralN7.family ? 1 : 0;
    return rightOwner - leftOwner
      || right.orientationMargin - left.orientationMargin
      || right.score - left.score
      || left.cellSize - right.cellSize;
  });
  const unique = [];
  for (const finder of finders) {
    const duplicate = unique.some((previous) =>
      previous.centralN7.family === finder.centralN7.family
      && Math.hypot(previous.center.x - finder.center.x, previous.center.y - finder.center.y)
        < finder.centralN7.modulePitch
      && Math.abs(previous.cellSize - finder.cellSize) < finder.cellSize * 0.02
      && Math.abs(previous.rotationDegrees - finder.rotationDegrees) < 2);
    if (!duplicate) unique.push(finder);
  }
  return unique;
}

/**
 * 기존 v0의 «다른 finder가 있으면 생략» 게이트와 분리된 n=7 전용 발견 입구.
 * 중앙 QR/UI가 함께 찍힌 프레임에서도 n=7 codeword가 family를 직접 증명할 수 있다.
 */
export function discoverCentralN7Finders(luma, options = {}) {
  if (options.centralBeacon === false) return [];
  const overrides = options.centralBeacon && typeof options.centralBeacon === 'object'
    ? options.centralBeacon
    : {};
  if (overrides.centralN7 === false) return [];
  const callerCalibration = overrides.calibration && typeof overrides.calibration === 'object'
    ? overrides.calibration : {};
  const detected = detectCellSurfaceBlockShapes(luma, {
    ...overrides,
    calibration: {
      ...callerCalibration,
      csBlockLocator: {
        maximumPosesPerFamily: 6,
        centreWindowFraction: 0.5,
        searchMaxSide: 1920,
        ...(callerCalibration.csBlockLocator || {}),
      },
    },
  });
  return centralN7Finders(luma, detected.diagnostics?.verified || []);
}

/**
 * 중심-사전 fallback — 전경 기하에서 비컨 후보를 직접 만든다.
 *
 * 왜 있나 (2026-08-22 실측, V3 'beacon-v3'): 블록 로케이터의 중앙 검증은 **전역
 * 정규화**에 기대는데, 바깥 페이로드가 바뀌자 같은 중앙 픽셀이 verified 에서
 * 사라졌다 (참중심 30px 내 히트 0/17 — coreCandidates 15197 · clusters 1134 인
 * 프레임에서). 중앙 블록 픽셀은 페이로드와 무관하게 동일하므로 이것은 «검출이
 * 페이로드에 좌우되는» 형태다. 검출기 내부는 Type Y 경로와 공유라 고치지 않고,
 * 이 어댑터가 스스로 후보를 만든다:
 *
 *   ① 전경(테두리 중앙값과 다른 픽셀)의 중심과 6축 지지 반지름을 잰다
 *   ② k 마다 바깥 지지 반지름 → cellSize → 비컨 모듈 피치 (정방향 식의 역)
 *   ③ 기존 locator 톤 대조로 판정 — 지역 중앙값 분할이라 전역 정규화와 무관하다
 *
 * [추정] 임의 회전 실사진은 이 fallback 이 못 잡는다 (방향은 0/120/240 만 시도) —
 * 그 축은 블록 로케이터가 담당하고, 여기는 정립 프레임의 구멍을 메운다.
 */
function centerPriorBeaconFinders(luma, emitted) {
  const spread = robustPercentiles(luma, [0.05, 0.95]);
  if (!spread) return [];
  const margin = (spread[1] - spread[0]) * 0.2;
  if (!(margin > 0)) return [];
  // 테두리 중앙값 = 배경 추정 (코드는 프레임 안쪽에 있고 콰이어트가 테두리에 닿는다).
  const border = [];
  const borderStride = Math.max(1, Math.floor(Math.min(luma.width, luma.height) / 64));
  for (let x = 0; x < luma.width; x += borderStride) {
    border.push(luma.data[x], luma.data[(luma.height - 1) * luma.width + x]);
  }
  for (let y = 0; y < luma.height; y += borderStride) {
    border.push(luma.data[y * luma.width], luma.data[y * luma.width + luma.width - 1]);
  }
  border.sort((a, b) => a - b);
  const background = border[Math.floor(border.length / 2)];
  // 전경 중심 + 6축 지지 (stride 2 표본 — 중심·반지름은 저주파 통계라 충분하다).
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < luma.height; y += 2) {
    const row = y * luma.width;
    for (let x = 0; x < luma.width; x += 2) {
      if (Math.abs(luma.data[row + x] - background) <= margin) continue;
      sumX += x;
      sumY += y;
      count += 1;
    }
  }
  if (count === 0) return [];
  const center = { x: sumX / count, y: sumY / count };
  const supports = CORNER_UNIT_OFFSETS.map(() => -Infinity);
  for (let y = 0; y < luma.height; y += 2) {
    const row = y * luma.width;
    for (let x = 0; x < luma.width; x += 2) {
      if (Math.abs(luma.data[row + x] - background) <= margin) continue;
      for (let axis = 0; axis < CORNER_UNIT_OFFSETS.length; axis += 1) {
        const unit = CORNER_UNIT_OFFSETS[axis];
        const support = (x - center.x) * unit.x + (y - center.y) * unit.y;
        if (support > supports[axis]) supports[axis] = support;
      }
    }
  }
  const outerSupport = Math.min(...supports);
  if (!(outerSupport > 0)) return [];

  const shrink = centralBeaconGeometry().shrink;
  const finders = [];
  // hex/O 후보를 먼저 두어 기존 프레임의 순서가 비트 동일하다. star 후보는 뒤에
  // 추가하며, 잘못된 실루엣 배율은 아래 locator 톤 대조에서 탈락한다.
  for (const [k, unitOuter] of [...UNIT_OUTER_SUPPORT, ...UNIT_STAR_OUTER_SUPPORT]) {
    const cellSize = outerSupport / unitOuter;
    const modulePitch = cellSize * UNIT_CENTRAL_SLOT_RADIUS * shrink / CENTRAL_V0_SOURCE_N;
    for (let index = 0; index < ORIENTATION_DEGREES.length; index += 1) {
      const degrees = ORIENTATION_DEGREES[index];
      const verdict = verifyV0LocatorTones(luma, center, modulePitch, degrees);
      if (!verdict.pass) continue;
      // 블록 경로가 이미 같은 포즈를 냈으면 중복을 만들지 않는다.
      const duplicate = emitted.some((finder) =>
        Math.hypot(finder.center.x - center.x, finder.center.y - center.y) < modulePitch
        && Math.abs(finder.cellSize - cellSize) < cellSize * 0.05
        && finder.rotationDegrees % 120 === degrees % 120);
      if (duplicate) continue;
      const H = affineCellHomography(center, cellSize, degrees);
      finders.push({
        finderKind: CENTRAL_BEACON_FINDER_KIND,
        kind: CENTRAL_BEACON_FINDER_KIND,
        patternId: CENTRAL_V0_FINDER_PATTERN_ID,
        center: { x: center.x, y: center.y },
        cellSize,
        score: verdict.agreement,
        orientation: index,
        orientationSource: 'central-v0-center-prior',
        orientationMargin: verdict.agreement,
        rotationDegrees: degrees,
        H,
        transform: H,
        B: H,
        // F-95: 어파인 사전 포즈는 재투영 잔차를 재지 않는다. 필드를 만들지 않는다.
        geometryMode: 'affine',
        source: 'central-v0-center-prior',
        blockShapeIndex: -1,
      });
    }
  }
  return finders;
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
  // **후보 풀만 넓힌다 — Type Y 경로의 기본(2)은 그대로다.** V3 실측('beacon-v3'):
  // 바깥 3톤 필드 조각이 자체 점수로 진짜 중앙 블록을 상위 컷 밖으로 밀었다.
  // 넓힌 풀의 진짜/가짜 판정은 locator 톤 대조가 진다. ⚠ 오버레이는
  // calibration.csBlockLocator 아래로 가야 먹는다 (calibration() 의 병합 규칙).
  const callerCalibration = overrides.calibration && typeof overrides.calibration === 'object'
    ? overrides.calibration : {};
  const detected = detectCellSurfaceBlockShapes(luma, {
    ...overrides,
    calibration: {
      ...callerCalibration,
      csBlockLocator: {
        maximumPosesPerFamily: 6,
        // **중앙 창 제한** (2026-08-24) — 이 어댑터가 찾는 블록은 계약상 **중앙 고정**
        // 이다 (central-v0 는 19셀 슬롯 삽입물). 그런데 상위 컷(centres slice(0,3))은
        // 점수 순이라, 코너 QR 의 파인더 3개가 v0-center 로 **1.00** 을 받아 컷을
        // 통째로 점거하고 진짜 비컨(0.81)을 밀어냈다 (A×비컨×코너QR 실측: shapes 0,
        // verified 랭크 5). 예산을 늘리는 대신 **계약을 주입**한다 — 중앙 박스 밖
        // v0-center 후보는 이 경로에서 애초에 후보가 아니다. Type Y 전면 CS 경로는
        // 이 어댑터를 안 지나므로 한 비트도 안 바뀐다.
        centreWindowFraction: 0.5,
        // **검색 해상도** (2026-08-25, 레인 TLK) — 기본 searchMaxSide=480 은
        // 1080×1440 프레임을 factor=3 으로 줄인다. 중앙 비컨은 13×13 모듈이
        // 19셀 슬롯 안에 들어가므로, 같은 화면에 별 전체를 담으면 k 가 클수록
        // 모듈 px 가 줄어 factor=3 에서 K3 코어 문턱(minimumCoreUnitPx) 아래로
        // 떨어진다. 240px 창·factor=1 에서는 K0/K1/K2 텔레 프레임이 모두
        // locator 톤 1.00 으로 섰고, 480 검색은 18프레임 전부 파인더 0 이었다.
        // 문턱은 안 내린다. 이 어댑터만 1080p 짧은 변이 네이티브가 되게 캡을
        // 올린다 (1920×1080 → factor=1). Type Y 전면 경로는 기본 480 그대로다.
        searchMaxSide: 1920,
        ...(callerCalibration.csBlockLocator || {}),
      },
    },
  });
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
        // F-95: 위와 같다 — 블록 유도 어파인 포즈, 잔차 미실측.
        geometryMode: 'affine',
        source: 'central-v0-block-locator',
        blockShapeIndex: shape.componentIndex,
      });
    }
  }
  if (overrides.centralN7 !== false) {
    finders.push(...centralN7Finders(luma, detected.diagnostics?.verified || []));
  }
  finders.push(...centerPriorBeaconFinders(luma, finders));
  // 대조 일치율 내림차순 — 하류 검증에는 예산이 있어 **순서가 곧 생사**다.
  // V3 실측: 가짜 2(0.83·0.86) + 참 1(1.00) 이면 no-format-candidate, 참만 남기면
  // 같은 프레임이 k=10 으로 풀린다. 절대 문턱을 다시 만지는 대신 ① 참이 먼저
  // 검증받게 정렬하고 ② «최선과의 격차» (5표본 = 1/18) 밖의 후보를 버린다 —
  // 상대 우세 게이트라 열화로 전체가 낮아진 프레임에서도 동작이 같다.
  finders.sort((left, right) => right.orientationMargin - left.orientationMargin);
  const best = finders.length > 0 ? finders[0].orientationMargin : 0;
  return finders.filter((finder) => finder.orientationMargin >= best - 1 / 18);
}
