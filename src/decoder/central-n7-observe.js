/**
 * central-n7-observe.js — 중앙 n7의 시드·톤·코드워드·외부 격자 관측.
 * 기존 관측 본문을 분리했다. R1과 관측 소비자가 같은 함수를 사용한다.
 */
import { moduleQuad } from '../ygrid.js';
import { centralBeaconGeometry } from '../centralBeaconWire.js';
import { CORNER_UNIT_OFFSETS, hexCorners, regionCells } from '../hexgrid.js';
import { VERSIONS_A } from '../capacityA.js';
import { VERSIONS_C } from '../capacityC.js';
import { notchCellsC } from '../notchC.js';
import { regionCellsA } from '../placementA.js';
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
import {
  ORIENTATION_DEGREES,
  BEACON_CS_BLOCK_LOCATOR,
  UNIT_CENTRAL_SLOT_RADIUS,
  UNIT_OUTER_SUPPORT,
  UNIT_STAR_OUTER_SUPPORT,
  affineCellHomography,
  sampleLuma,
} from './central-beacon-observation-shared.js';

export const CENTRAL_N7_FINDER_KIND = CENTRAL_N7_PATTERN_FAMILY_ID;

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
    // Type C — payload family 는 hex(비컨은 표면 포맷 사본)라 seed
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

/** 검출된 n7 shape를 tone/payload finder로 바꾸고 정본 순서·dedupe를 적용한다. */
export function centralN7FindersFromShapes(luma, shapes) {
  const finders = [];
  for (const shape of shapes) {
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

export function centralN7Finders(luma, verifiedCoreHits, options = {}) {
  const timing = typeof options.timing === 'function' ? options.timing : null;
  let started = timing ? performance.now() : 0;
  const seeds = centralN7CenterPriorSeeds(luma, verifiedCoreHits);
  if (timing) { timing({ stage: 'e1.seed-enumeration', ms: performance.now() - started }); started = performance.now(); }
  const detected = detectCentralN7BlockShapes(luma, seeds);
  if (timing) { timing({ stage: 'e1.n7-blocks', ms: performance.now() - started }); started = performance.now(); }
  const unique = centralN7FindersFromShapes(luma, detected.shapes);
  if (timing) timing({ stage: 'e1.tones-payload', ms: performance.now() - started });
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
  const timing = typeof options.timing === 'function' ? options.timing : null;
  const started = timing ? performance.now() : 0;
  const callerCalibration = overrides.calibration && typeof overrides.calibration === 'object'
    ? overrides.calibration : {};
  // 오버레이 정본은 BEACON_CS_BLOCK_LOCATOR (값·이유 그 주석에) — 여기 손 사본을 두지 않는다.
  const detected = detectCellSurfaceBlockShapes(luma, {
    ...overrides,
    timing: timing || overrides.timing,
    calibration: {
      ...callerCalibration,
      csBlockLocator: {
        ...BEACON_CS_BLOCK_LOCATOR,
        ...(callerCalibration.csBlockLocator || {}),
      },
    },
  });
  if (timing) timing({ stage: 'e1.cs-blocks', ms: performance.now() - started });
  return centralN7Finders(luma, detected.diagnostics?.verified || [], { timing });
}
