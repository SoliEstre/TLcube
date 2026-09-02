/**
 * rectify-photo-probe.mjs — 역왜곡 앵커 모듈을 실사진 휘도 덤프에 물린다.
 *
 * 합성(PPU 17 · 960 · 무잡음)에서 잠근 «중심 ≤ 1 px» 가 실물에서 얼마인지 잰다.
 * `src/` 는 import 만 한다. `test/output/photos/**` 에는 쓰지 않는다.
 *
 * 잔차(자기 일관성, H): 검출 ≥ 5 일 때 leave-one-out. 빠진 앵커를 제외한 나머지
 * 검출 앵커의 (정준 좌표 → 이미지 좌표) 로 estimateHomographyN 을 세우고,
 * 빠진 앵커의 예측 vs 검출 중심 거리(px) 를 그 앵커의 cellPitch(px) 로 나눈 값(셀).
 * det=6 은 5점 LS, det=5 는 4점 정확해. det=4 는 남는 대응 3점이라 H 미정의
 * → residual = null, residualReason = 'h-undefined-3pt'. 검출 ≤ 3 이면 residual = null.
 * 같은 앵커에 affine LOO(6자유도, 정족수 3) 를 residualAffine 으로 나란히 둔다.
 *
 * 실행:
 *   node tools/probes/rectify-photo-probe.mjs [--limit=N] [--filter=부분문자열]
 *     [--out=경로] [--report=경로] [--shards=N] [--report-only] [--negative=N]
 * 상대경로는 repo 루트 기준(resolveRepoPath). 진행 로그는 stderr.
 * JSON 을 다시 읽어 보고서를 쓴다.
 */

import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

import { CENTRAL_V0_SOURCE_N, centralV0FinderCells } from '../../src/cellSurfaceFinal.js';
import { CS_BLOCK_LOCATOR_INTERNALS } from '../../src/decoder/cellsurface-block-detect.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { estimateHomographyN, projectPoint } from '../../src/decoder/homography.js';
import {
  RECTIFY_ANCHOR_IDS,
  detectRectifyAnchors,
} from '../../src/decoder/rectify-anchors.js';
import { encodeY } from '../../src/encodeY.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../src/sceneY.js';
import { moduleCenter } from '../../src/ygrid.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../read-luma.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const FRAME_SIDE = 960;
const PPU = 17;
const PAYLOAD = 'https://tl.estre.so';
const CANONICAL_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });
const FACES = Object.freeze(['T', 'L', 'R']);
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});

const DEFAULT_OUT = join('test', 'output', 'rectify-photo', 'rectify-photo.json');
const DEFAULT_REPORT = join('test', 'output', 'rectify-photo', 'rectify-photo-report.md');
const NOISE_COUNT = 12;
const NOISE_SIDE = 960;
const EMPTY_FRONTEND = Object.freeze({
  ok: false, reason: 'throw', finderPatternId: null, source: null,
  cellSizePx: null, n: null, cellSurfaceLayout: null,
});

// ── CLI ────────────────────────────────────────────────────────────────

function defaultShards() {
  const cpu = typeof os.availableParallelism === 'function'
    ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, cpu - 2);
}

function parseArgs(argv) {
  const parsed = {
    limit: null, filter: null, out: DEFAULT_OUT, report: DEFAULT_REPORT,
    shards: defaultShards(), reportOnly: false, negative: 4,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const eq = token.indexOf('=');
    const [rawKey, inline] = eq >= 0
      ? [token.slice(0, eq), token.slice(eq + 1)]
      : [token, null];
    if (!rawKey.startsWith('--')) {
      throw new Error(`알 수 없는 인자: ${token}`);
    }
    const key = rawKey.slice(2);
    const take = () => {
      if (inline !== null) return inline;
      i += 1;
      if (i >= argv.length) throw new Error(`--${key} 에 값이 없다`);
      return argv[i];
    };
    if (key === 'limit') {
      const value = Number(take());
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`--limit 은 0 이상 정수여야 한다: ${value}`);
      }
      parsed.limit = value;
    } else if (key === 'filter') {
      parsed.filter = take();
    } else if (key === 'out') {
      parsed.out = take();
    } else if (key === 'report') {
      parsed.report = take();
    } else if (key === 'shards') {
      const value = Number(take());
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--shards 는 1 이상 정수여야 한다: ${value}`);
      }
      parsed.shards = value;
    } else if (key === 'report-only') {
      parsed.reportOnly = true;
    } else if (key === 'negative') {
      const value = Number(take());
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`--negative 는 0 이상 정수여야 한다: ${value}`);
      }
      parsed.negative = value;
    } else {
      throw new Error(`알 수 없는 플래그: --${key}`);
    }
  }
  return parsed;
}

function resolveRepoPath(value) {
  if (!value) return null;
  if (value.includes(':') || value.startsWith('/') || value.startsWith('\\')) return value;
  return join(REPO, value);
}

// ── 정준 중심 (canonicalPatches 와 같은 식) ────────────────────────────

function cellKey(cell) {
  return cell.i + ',' + cell.j;
}

function connectedCellComponents(cells) {
  const byKey = new Map(cells.map((cell) => [cellKey(cell), cell]));
  const unseen = new Set(byKey.keys());
  const components = [];
  for (const first of byKey.values()) {
    const firstKey = cellKey(first);
    if (!unseen.has(firstKey)) continue;
    unseen.delete(firstKey);
    const queue = [first];
    const component = [];
    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head];
      component.push(cell);
      for (let di = -1; di <= 1; di += 1) {
        for (let dj = -1; dj <= 1; dj += 1) {
          if (di === 0 && dj === 0) continue;
          const key = (cell.i + di) + ',' + (cell.j + dj);
          if (!unseen.has(key)) continue;
          unseen.delete(key);
          queue.push(byKey.get(key));
        }
      }
    }
    components.push(component);
  }
  return components;
}

function componentRadiusSquared(component) {
  let i = 0;
  let j = 0;
  for (const cell of component) {
    i += cell.i + 0.5;
    j += cell.j + 0.5;
  }
  i /= component.length;
  j /= component.length;
  return i * i + j * j;
}

/**
 * rectify-anchors.js `canonicalPatches()` 가 패치마다 넣는 `anchor` 와 같은 좌표.
 * 모듈이 그 함수를 export 하지 않으므로 같은 입력·같은 식으로 다시 만든다.
 */
function canonicalAnchorCenters() {
  const source = centralV0FinderCells();
  if (!Array.isArray(source) || source.length !== 30) {
    throw new Error(`centralV0FinderCells 길이 ${source?.length} ≠ 30`);
  }
  const components = connectedCellComponents(source);
  if (components.length !== 4) {
    throw new Error(`파인더 연결 성분 ${components.length} ≠ 4`);
  }
  const sizes = components.map((component) => component.length)
    .sort((left, right) => left - right);
  if (sizes.join(',') !== '6,6,9,9') {
    throw new Error(`파인더 성분 크기 ${sizes.join(',')} ≠ 6,6,9,9`);
  }
  const ordered = components.slice().sort((left, right) =>
    componentRadiusSquared(left) - componentRadiusSquared(right));
  const central = ordered[0];
  const outer = ordered[ordered.length - 1];
  if (central.length !== 9 || outer.length !== 9) {
    throw new Error('중앙/외곽 성분이 9셀이 아니다');
  }
  const centers = [];
  for (const [kind, cells] of [['central', central], ['outer', outer]]) {
    for (const face of FACES) {
      let sumX = 0;
      let sumY = 0;
      for (const cell of cells) {
        const center = moduleCenter(face, cell.i, cell.j, CANONICAL_LAYOUT);
        sumX += center.x;
        sumY += center.y;
      }
      centers.push({
        id: `${kind}-${face}`,
        x: sumX / cells.length,
        y: sumY / cells.length,
      });
    }
  }
  if (centers.map((c) => c.id).join(',') !== RECTIFY_ANCHOR_IDS.join(',')) {
    throw new Error(`정준 id 순서 불일치: ${centers.map((c) => c.id)}`);
  }
  return centers;
}

// ── 잔차 ───────────────────────────────────────────────────────────────

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function foundAnchorIndices(anchors, canonicalCenters) {
  const found = [];
  if (!Array.isArray(anchors) || !Array.isArray(canonicalCenters)) return found;
  for (let i = 0; i < RECTIFY_ANCHOR_IDS.length; i += 1) {
    const anchor = anchors[i];
    const canonical = canonicalCenters[i];
    if (anchor && anchor.found
      && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
      && canonical && Number.isFinite(canonical.x) && Number.isFinite(canonical.y)) {
      found.push(i);
    }
  }
  return found;
}

function residualSummary(perAnchorPx, perAnchorCells) {
  const cellValues = perAnchorCells.filter((value) => Number.isFinite(value));
  const maxCells = cellValues.length ? Math.max(...cellValues) : null;
  const rmsCells = cellValues.length
    ? Math.sqrt(cellValues.reduce((sum, value) => sum + value * value, 0) / cellValues.length)
    : null;
  return { perAnchorPx, perAnchorCells, maxCells, rmsCells };
}

function leaveOneOutH(anchors, canonicalCenters) {
  const found = foundAnchorIndices(anchors, canonicalCenters);
  // det=4 는 남는 대응 3점 → estimateHomographyN 하한 4점에 못 미친다.
  if (found.length < 5) return null;
  const perAnchorPx = RECTIFY_ANCHOR_IDS.map(() => null);
  const perAnchorCells = RECTIFY_ANCHOR_IDS.map(() => null);
  for (const held of found) {
    const others = found.filter((index) => index !== held);
    const canonical = others.map((index) => ({
      x: canonicalCenters[index].x,
      y: canonicalCenters[index].y,
    }));
    const image = others.map((index) => ({
      x: anchors[index].x,
      y: anchors[index].y,
    }));
    const H = estimateHomographyN(canonical, image);
    if (H === null) continue;
    const predicted = projectPoint(H, canonicalCenters[held]);
    if (!predicted) continue;
    const px = Math.hypot(predicted.x - anchors[held].x, predicted.y - anchors[held].y);
    perAnchorPx[held] = px;
    const pitch = finiteNumber(anchors[held].pitch);
    perAnchorCells[held] = pitch !== null && pitch > 0 ? px / pitch : null;
  }
  return {
    method: 'leave-one-out',
    homographyKind: found.length === 6 ? '5pt-ls' : '4pt-exact',
    ...residualSummary(perAnchorPx, perAnchorCells),
  };
}

function solveLinear3(matrix, rhs) {
  const A = matrix.map((row) => row.slice());
  const b = rhs.slice();
  for (let i = 0; i < 3; i += 1) {
    let pivot = i;
    for (let j = i + 1; j < 3; j += 1) {
      if (Math.abs(A[j][i]) > Math.abs(A[pivot][i])) pivot = j;
    }
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let j = 0; j < 3; j += 1) {
      if (j === i) continue;
      const factor = A[j][i] / A[i][i];
      for (let k = i; k < 3; k += 1) A[j][k] -= factor * A[i][k];
      b[j] -= factor * b[i];
    }
  }
  return b.map((value, i) => value / A[i][i]);
}

/** 6자유도 affine (x' = ax+by+c, y' = dx+ey+f). 정족수 3점. */
function affineFit(source, dest) {
  if (!source || source.length < 3 || source.length !== dest.length) return null;
  const gram = Array.from({ length: 3 }, () => [0, 0, 0]);
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (let k = 0; k < source.length; k += 1) {
    const v = [source[k].x, source[k].y, 1];
    for (let a = 0; a < 3; a += 1) {
      bx[a] += v[a] * dest[k].x;
      by[a] += v[a] * dest[k].y;
      for (let b = 0; b < 3; b += 1) gram[a][b] += v[a] * v[b];
    }
  }
  const ax = solveLinear3(gram, bx);
  const ay = solveLinear3(gram, by);
  if (!ax || !ay) return null;
  return (point) => ({
    x: ax[0] * point.x + ax[1] * point.y + ax[2],
    y: ay[0] * point.x + ay[1] * point.y + ay[2],
  });
}

function leaveOneOutAffine(anchors, canonicalCenters) {
  const found = foundAnchorIndices(anchors, canonicalCenters);
  if (found.length < 4) return null;
  const perAnchorPx = RECTIFY_ANCHOR_IDS.map(() => null);
  const perAnchorCells = RECTIFY_ANCHOR_IDS.map(() => null);
  for (const held of found) {
    const others = found.filter((index) => index !== held);
    const fit = affineFit(
      others.map((index) => ({
        x: canonicalCenters[index].x,
        y: canonicalCenters[index].y,
      })),
      others.map((index) => ({
        x: anchors[index].x,
        y: anchors[index].y,
      })),
    );
    if (!fit) continue;
    const predicted = fit(canonicalCenters[held]);
    const px = Math.hypot(predicted.x - anchors[held].x, predicted.y - anchors[held].y);
    perAnchorPx[held] = px;
    const pitch = finiteNumber(anchors[held].pitch);
    perAnchorCells[held] = pitch !== null && pitch > 0 ? px / pitch : null;
  }
  return {
    method: 'leave-one-out-affine',
    ...residualSummary(perAnchorPx, perAnchorCells),
  };
}

function residualReasonFor(detectedCount) {
  return detectedCount === 4 ? 'h-undefined-3pt' : null;
}

function homographyKindFor(detectedCount) {
  if (detectedCount === 6) return '5pt-ls';
  if (detectedCount === 5) return '4pt-exact';
  return null;
}

function hResidualOf(dump) {
  const det = dump?.rectify?.detectedCount ?? 0;
  if (det < 5) return null;
  return dump.residual && typeof dump.residual === 'object' ? dump.residual : null;
}

function affineResidualOf(dump, canonicalCenters) {
  if (dump?.residualAffine && typeof dump.residualAffine === 'object') {
    return dump.residualAffine;
  }
  if (canonicalCenters && dump?.anchors) {
    return leaveOneOutAffine(dump.anchors, canonicalCenters);
  }
  return null;
}

function minOfFound(anchors, key) {
  const values = (anchors || [])
    .filter((anchor) => anchor && anchor.found && Number.isFinite(anchor[key])
      && (key !== 'pitch' || anchor[key] > 0))
    .map((anchor) => anchor[key]);
  return values.length ? Math.min(...values) : null;
}

function medianOfFound(anchors, key) {
  const values = (anchors || [])
    .filter((anchor) => anchor && anchor.found && Number.isFinite(anchor[key])
      && (key !== 'pitch' || anchor[key] > 0))
    .map((anchor) => anchor[key]);
  return medianOf(values);
}

function packAnchors(result) {
  return RECTIFY_ANCHOR_IDS.map((id, index) => {
    const raw = Array.isArray(result?.anchors) ? result.anchors[index] : null;
    if (!raw) {
      return {
        id, found: false, x: null, y: null, pitch: null, correlation: null,
      };
    }
    return {
      id: raw.id ?? id,
      found: true,
      x: finiteNumber(raw.x),
      y: finiteNumber(raw.y),
      pitch: finiteNumber(raw.cellPitch),
      correlation: finiteNumber(raw.correlation),
    };
  });
}

function hypothesisOf(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.ok && result.hypothesis && typeof result.hypothesis === 'object') {
    return result.hypothesis;
  }
  const failHyp = result.detail && result.detail.failureHypothesis;
  if (failHyp && typeof failHyp === 'object') return failHyp;
  return null;
}

function hypFields(hyp) {
  if (!hyp || typeof hyp !== 'object') {
    return {
      finderPatternId: null, source: null, cellSizePx: null, n: null, cellSurfaceLayout: null,
    };
  }
  const n = Number.isFinite(hyp.n) ? hyp.n : null;
  return {
    finderPatternId: typeof hyp.finderPatternId === 'string' ? hyp.finderPatternId : null,
    source: typeof hyp.source === 'string' ? hyp.source : null,
    cellSizePx: finiteNumber(hyp.cellSizePx),
    n,
    cellSurfaceLayout: typeof hyp.cellSurfaceLayout === 'string' ? hyp.cellSurfaceLayout : null,
  };
}

function frontendFields(result) {
  if (!result || typeof result !== 'object') {
    return { ...EMPTY_FRONTEND };
  }
  const extra = hypFields(hypothesisOf(result));
  if (result.ok) {
    return { ok: true, reason: null, ...extra };
  }
  const reason = typeof result.reason === 'string'
    ? result.reason
    : (result.reason && typeof result.reason === 'object' && result.reason.code)
      ? String(result.reason.code)
      : result.reason == null ? 'unknown' : String(result.reason);
  return { ok: false, reason, ...extra };
}

function measureFrame(raster, canonicalCenters, { frontend = true } = {}) {
  const width = raster.width;
  const height = raster.height;
  const square = width === height;
  const t0 = process.hrtime.bigint();
  let frontendResult;
  if (frontend) {
    try {
      frontendResult = frontendFields(decodeFrontend(raster));
    } catch (error) {
      frontendResult = {
        ...EMPTY_FRONTEND,
        reason: `THROW:${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } else {
    frontendResult = {
      ok: null, reason: null, finderPatternId: null, source: null,
      cellSizePx: null, n: null, cellSurfaceLayout: null,
    };
  }
  const trace = {};
  let rectifyRaw;
  try {
    rectifyRaw = detectRectifyAnchors(raster, CENTRAL_V0_SOURCE_N, { trace });
  } catch (error) {
    rectifyRaw = {
      reason: `THROW:${error instanceof Error ? error.message : String(error)}`,
      detectedCount: 0,
      anchors: RECTIFY_ANCHOR_IDS.map(() => null),
    };
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const anchors = packAnchors(rectifyRaw);
  const detectedCount = Number.isInteger(rectifyRaw?.detectedCount)
    ? rectifyRaw.detectedCount : 0;
  const residual = leaveOneOutH(anchors, canonicalCenters);
  const residualAffine = leaveOneOutAffine(anchors, canonicalCenters);
  return {
    width,
    height,
    square,
    frontend: frontendResult,
    rectify: {
      reason: rectifyRaw?.reason ?? null,
      detectedCount,
      shapeCount: Number.isInteger(trace.shapeCount) ? trace.shapeCount : null,
    },
    anchors,
    residual,
    residualAffine,
    residualReason: residualReasonFor(detectedCount),
    minCorrelation: minOfFound(anchors, 'correlation'),
    minPitch: minOfFound(anchors, 'pitch'),
    ms: Math.round(ms),
  };
}

function measureDump(entry, canonicalCenters) {
  const luma = readLumaDump(entry.path);
  const raster = lumaToRaster(luma);
  return {
    name: entry.name,
    bitDepth: Number.isInteger(luma.bitDepth) ? luma.bitDepth : null,
    ...measureFrame(raster, canonicalCenters),
  };
}

// ── 합성 대조군 ────────────────────────────────────────────────────────

function embedSquare(raster) {
  if (raster.width > FRAME_SIDE || raster.height > FRAME_SIDE) {
    throw new Error(`합성 래스터가 960을 넘는다: ${raster.width}×${raster.height}`);
  }
  const frame = {
    width: FRAME_SIDE,
    height: FRAME_SIDE,
    pixels: new Uint8ClampedArray(FRAME_SIDE * FRAME_SIDE * 4),
  };
  for (let index = 0; index < FRAME_SIDE * FRAME_SIDE; index += 1) {
    frame.pixels[index * 4] = PRESET.background.r;
    frame.pixels[index * 4 + 1] = PRESET.background.g;
    frame.pixels[index * 4 + 2] = PRESET.background.b;
    frame.pixels[index * 4 + 3] = 255;
  }
  const offsetX = Math.floor((FRAME_SIDE - raster.width) / 2);
  const offsetY = Math.floor((FRAME_SIDE - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const source = (y * raster.width + x) * 4;
      const target = ((y + offsetY) * FRAME_SIDE + x + offsetX) * 4;
      frame.pixels[target] = raster.pixels[source];
      frame.pixels[target + 1] = raster.pixels[source + 1];
      frame.pixels[target + 2] = raster.pixels[source + 2];
      frame.pixels[target + 3] = raster.pixels[source + 3];
    }
  }
  return { frame, offsetX, offsetY };
}

function renderFrontFrame() {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'M',
  });
  if (encoded.n !== CENTRAL_V0_SOURCE_N) {
    throw new Error(`합성 n=${encoded.n} ≠ ${CENTRAL_V0_SOURCE_N}`);
  }
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
  const embedded = embedSquare(raster);
  return { ...embedded, scene };
}

function residualMaxPx(residual) {
  if (!residual || !Array.isArray(residual.perAnchorPx)) return null;
  const values = residual.perAnchorPx.filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function referenceAnchorPatches() {
  const reference = CS_BLOCK_LOCATOR_INTERNALS.patchesForN(CENTRAL_V0_SOURCE_N);
  const patches = [...reference.subPatches.slice(0, 3), ...reference.corners];
  if (patches.length !== RECTIFY_ANCHOR_IDS.length) {
    throw new Error(`reference patches ${patches.length} ≠ 6`);
  }
  return patches;
}

function groundTruthPx(anchors, expected) {
  const perAnchorPx = expected.map((point, index) => {
    const actual = anchors[index];
    if (!actual?.found || !Number.isFinite(actual.x) || !Number.isFinite(actual.y)) {
      return null;
    }
    return Math.hypot(actual.x - point.x, actual.y - point.y);
  });
  const finite = perAnchorPx.filter((value) => Number.isFinite(value));
  return {
    perAnchorPx,
    maxPx: finite.length ? Math.max(...finite) : null,
  };
}

function syntheticGroundTruth(anchors, scene, offsetX, offsetY, canonicalCenters) {
  const patches = referenceAnchorPatches();
  const fromTest = groundTruthPx(anchors, patches.map((patch) => ({
    x: offsetX + PPU * (scene.layout.originX + patch.anchor.x),
    y: offsetY + PPU * (scene.layout.originY + patch.anchor.y),
  })));
  const expectedCanonical = canonicalCenters.map((center) => ({
    x: offsetX + PPU * (scene.layout.originX + center.x),
    y: offsetY + PPU * (scene.layout.originY + center.y),
  }));
  const fromCanonical = groundTruthPx(anchors, expectedCanonical);
  const expectedAnchors = expectedCanonical.map((point, index) => ({
    id: RECTIFY_ANCHOR_IDS[index],
    found: true,
    x: point.x,
    y: point.y,
    pitch: finiteNumber(anchors[index]?.pitch) ?? 1,
    correlation: 1,
  }));
  const looIdeal = leaveOneOutH(expectedAnchors, canonicalCenters);
  const affineActual = leaveOneOutAffine(anchors, canonicalCenters);
  return {
    method: 'expected-front-ppu17',
    testMaxPx: fromTest.maxPx,
    testPerAnchorPx: fromTest.perAnchorPx,
    canonicalMaxPx: fromCanonical.maxPx,
    canonicalPerAnchorPx: fromCanonical.perAnchorPx,
    looIdealMaxPx: residualMaxPx(looIdeal),
    affineMaxPx: residualMaxPx(affineActual),
    affineMaxCells: affineActual?.maxCells ?? null,
  };
}

/** 배선 게이트: 테스트와 같은 참값 잔차 ≤ 1 px + 6/6. LOO(§3) 는 합성에서도 1px를 넘을 수 있다. */
function syntheticWiringOk(row) {
  const gt = row.groundTruth?.testMaxPx;
  return row.rectify.detectedCount === 6
    && row.rectify.reason === null
    && Number.isFinite(gt)
    && gt <= 1;
}

// ── 음성 대조군 고르기 ─────────────────────────────────────────────────

function pickNegative(dumps, perGroup) {
  if (!perGroup) return [];
  const groups = [
    dumps.filter((d) => d.name.includes('k26-qr-')),
    dumps.filter((d) => d.name.includes('ctlv2-')),
  ];
  const picked = [];
  const seen = new Set();
  for (const group of groups) {
    let taken = 0;
    for (const dump of group) {
      if (seen.has(dump.name)) continue;
      picked.push(dump);
      seen.add(dump.name);
      taken += 1;
      if (taken >= perGroup) break;
    }
  }
  return picked;
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function uniformNoiseRaster(side, seed) {
  const rand = lcg(seed);
  const pixels = new Uint8ClampedArray(side * side * 4);
  for (let i = 0; i < side * side; i += 1) {
    const value = Math.floor(rand() * 256);
    const offset = i * 4;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return { width: side, height: side, pixels };
}

function measureNoiseFrames(canonicalCenters, count = NOISE_COUNT) {
  const rows = [];
  for (let i = 1; i <= count; i += 1) {
    const seed = i * 7919;
    logLine(`[rectify-photo] 잡음 ${i}/${count} seed=${seed} ${NOISE_SIDE}sq`);
    const row = measureFrame(
      uniformNoiseRaster(NOISE_SIDE, seed),
      canonicalCenters,
      { frontend: false },
    );
    rows.push({
      name: `__noise-${NOISE_SIDE}sq-seed${seed}__`,
      kind: 'noise',
      seed,
      bitDepth: null,
      ...row,
    });
    logLine(`[rectify-photo]   det=${row.rectify.detectedCount} cap=${row.rectify.shapeCount} reason=${row.rectify.reason} minCorr=${row.minCorrelation} minPitch=${row.minPitch} ${row.ms}ms`);
  }
  return rows;
}

function isNoiseRow(row) {
  return row?.kind === 'noise' || (typeof row?.name === 'string' && row.name.startsWith('__noise-'));
}

function splitNegatives(negative) {
  const photo = [];
  const noise = [];
  for (const row of negative) {
    if (isNoiseRow(row)) noise.push(row);
    else photo.push(row);
  }
  return { photo, noise };
}

function folderOf(name) {
  const slash = name.indexOf('/');
  return slash < 0 ? '(root)' : name.slice(0, slash);
}

function pairKey(name) {
  return name.replace(/\.(960|1440)\.luma$/, '');
}

function pairSide(name) {
  const match = name.match(/\.(\d+)\.luma$/);
  return match ? match[1] : null;
}

function logLine(message) {
  process.stderr.write(`${message}\n`);
}

function detectBucket(count) {
  if (count >= 6) return '6';
  if (count === 5) return '5';
  if (count === 4) return '4';
  return 'le3';
}

// ── 보고서 (JSON 을 다시 읽는다) ───────────────────────────────────────

function sortedCopy(values) {
  return values.filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - index) + sorted[hi] * (index - lo);
}

function medianOf(values) {
  return quantile(sortedCopy(values), 0.5);
}

function p90Of(values) {
  return quantile(sortedCopy(values), 0.9);
}

function maxOf(values) {
  const sorted = sortedCopy(values);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Number(value).toFixed(digits);
}

function pct(n, d) {
  if (!d) return '—';
  return `${(100 * n / d).toFixed(1)}%`;
}

function mdTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

function dumpStats(dumps, canonicalCenters) {
  const n = dumps.length;
  const frontendOk = dumps.filter((d) => d.frontend?.ok === true).length;
  const buckets = { 6: 0, 5: 0, 4: 0, le3: 0 };
  const maxCells = [];
  const maxPx = [];
  const det6Cells = [];
  const det5Cells = [];
  const affCells = [];
  const affPx = [];
  const ms = [];
  for (const dump of dumps) {
    const det = dump.rectify?.detectedCount ?? 0;
    buckets[detectBucket(det)] += 1;
    const residual = hResidualOf(dump);
    if (residual) {
      if (Number.isFinite(residual.maxCells)) {
        maxCells.push(residual.maxCells);
        if (det === 6) det6Cells.push(residual.maxCells);
        if (det === 5) det5Cells.push(residual.maxCells);
      }
      const px = residualMaxPx(residual);
      if (Number.isFinite(px)) maxPx.push(px);
    }
    const affine = affineResidualOf(dump, canonicalCenters);
    if (affine) {
      if (Number.isFinite(affine.maxCells)) affCells.push(affine.maxCells);
      const px = residualMaxPx(affine);
      if (Number.isFinite(px)) affPx.push(px);
    }
    if (Number.isFinite(dump.ms)) ms.push(dump.ms);
  }
  return {
    n,
    frontendOk,
    frontendOkPct: n ? 100 * frontendOk / n : null,
    buckets,
    residualN: maxCells.length,
    medCells: medianOf(maxCells),
    p90Cells: p90Of(maxCells),
    maxCells: maxOf(maxCells),
    medPx: medianOf(maxPx),
    p90Px: p90Of(maxPx),
    maxPx: maxOf(maxPx),
    det6N: det6Cells.length,
    det6Med: medianOf(det6Cells),
    det6P90: p90Of(det6Cells),
    det6Max: maxOf(det6Cells),
    det5N: det5Cells.length,
    det5Med: medianOf(det5Cells),
    det5P90: p90Of(det5Cells),
    det5Max: maxOf(det5Cells),
    affN: affCells.length,
    affMed: medianOf(affCells),
    affP90: p90Of(affCells),
    affMax: maxOf(affCells),
    affMedPx: medianOf(affPx),
    affMaxPx: maxOf(affPx),
    medMs: medianOf(ms),
  };
}

function statsRow(label, stats) {
  return [
    label,
    String(stats.n),
    stats.n ? pct(stats.frontendOk, stats.n) : '—',
    String(stats.buckets[6]),
    String(stats.buckets[5]),
    String(stats.buckets[4]),
    String(stats.buckets.le3),
    stats.residualN ? fmt(stats.medCells, 3) : '—',
    stats.residualN ? fmt(stats.p90Cells, 3) : '—',
    stats.residualN ? fmt(stats.maxCells, 3) : '—',
    stats.residualN ? fmt(stats.medPx, 2) : '—',
    stats.residualN ? fmt(stats.p90Px, 2) : '—',
    stats.residualN ? fmt(stats.maxPx, 2) : '—',
    fmt(stats.medMs, 0),
  ];
}

function peekLumaBitDepth(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(4);
    if (readSync(fd, buf, 0, 4, 0) < 4) return null;
    const magic = buf.toString('latin1');
    if (magic === 'TLL2') return 16;
    if (magic === 'TLLU') return 8;
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function bitDepthHistogram(dumps) {
  const hist = new Map();
  let missing = 0;
  const have = dumps.filter((d) => Number.isInteger(d.bitDepth)).length;
  let byName = null;
  if (dumps.length && have === 0) {
    byName = new Map(listLumaDumps().map((entry) => [entry.name, entry.path]));
  }
  for (const dump of dumps) {
    let depth = Number.isInteger(dump.bitDepth) ? dump.bitDepth : null;
    if (depth === null && byName) {
      const path = byName.get(dump.name);
      if (path) depth = peekLumaBitDepth(path);
    }
    if (!Number.isInteger(depth)) missing += 1;
    else hist.set(depth, (hist.get(depth) || 0) + 1);
  }
  return { hist, missing };
}

function formatHist(map, { sortNumeric = false } = {}) {
  const entries = [...map.entries()];
  if (sortNumeric) entries.sort((a, b) => Number(a[0]) - Number(b[0]));
  else entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (!entries.length) return '—';
  return entries.map(([key, value]) => `${key}→${value}`).join(', ');
}

function detCountHist(rows) {
  const hist = new Map();
  for (const row of rows) {
    const det = row.rectify?.detectedCount ?? 0;
    hist.set(det, (hist.get(det) || 0) + 1);
  }
  return hist;
}

function geCount(rows, threshold) {
  return rows.filter((row) => (row.rectify?.detectedCount ?? 0) >= threshold).length;
}

function finderKeyOf(dump) {
  const id = dump.frontend?.finderPatternId;
  if (typeof id === 'string' && id) return id;
  return dump.frontend?.ok ? '(ok·null)' : '(fail·null)';
}

function nKeyOf(dump) {
  if (Number.isFinite(dump.frontend?.n)) return `n=${dump.frontend.n}`;
  if (typeof dump.frontend?.cellSurfaceLayout === 'string' && dump.frontend.cellSurfaceLayout) {
    return `layout=${dump.frontend.cellSurfaceLayout}`;
  }
  return null;
}

function pitchCellRatio(dump) {
  const medPitch = medianOfFound(dump.anchors, 'pitch');
  const cell = dump.frontend?.cellSizePx;
  if (!Number.isFinite(medPitch) || !Number.isFinite(cell) || cell === 0) return null;
  return medPitch / cell;
}

function rowMinCorr(dump) {
  if (Number.isFinite(dump.minCorrelation)) return dump.minCorrelation;
  return minOfFound(dump.anchors, 'correlation');
}

function rowMinPitch(dump) {
  if (Number.isFinite(dump.minPitch)) return dump.minPitch;
  return minOfFound(dump.anchors, 'pitch');
}

function crossDetTable(dumps, keyFn, keyHeader) {
  const groups = new Map();
  for (const dump of dumps) {
    const key = keyFn(dump);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(dump);
  }
  const keys = [...groups.keys()].sort((a, b) => String(a).localeCompare(String(b)));
  const rows = keys.map((key) => {
    const subset = groups.get(key);
    const stats = dumpStats(subset);
    const ge5 = stats.buckets[6] + stats.buckets[5];
    return [
      String(key),
      String(stats.buckets[6]),
      String(stats.buckets[5]),
      String(stats.buckets[4]),
      String(stats.buckets.le3),
      String(stats.n),
      String(ge5),
    ];
  });
  return mdTable(
    [keyHeader, '6', '5', '4', '≤3', '합', '≥5'],
    rows,
  );
}

function writeReport(payload, reportPath) {
  const dumps = Array.isArray(payload.dumps) ? payload.dumps : [];
  const synthetic = payload.control?.synthetic ?? null;
  const negativeAll = Array.isArray(payload.control?.negative) ? payload.control.negative : [];
  const split = splitNegatives(negativeAll);
  const photoNeg = split.photo;
  const noiseNeg = Array.isArray(payload.control?.noise) && payload.control.noise.length
    ? payload.control.noise : split.noise;
  const canonicalCenters = Array.isArray(payload.canonicalCenters)
    ? payload.canonicalCenters : null;
  const synMaxPx = synthetic ? residualMaxPx(hResidualOf(synthetic) ?? synthetic.residual) : null;
  const synAff = synthetic ? affineResidualOf(synthetic, canonicalCenters) : null;
  const synOk = synthetic ? syntheticWiringOk(synthetic) : false;
  const listed = payload.run?.dumpListed ?? null;
  const measured = payload.run?.dumpMeasured ?? dumps.length;
  const partial = Number.isInteger(listed) && measured < listed;
  const measuredLabel = `측정 ${measured}장`;

  const lines = [];
  lines.push('# RECTPHOTO — 실사진 코퍼스에서 역왜곡 앵커 잔차');
  lines.push('');
  lines.push(`n = \`${payload.n}\` (CENTRAL_V0_SOURCE_N). 셀 = cellPitch = √(마름모 넓이) = 0.93 × 변 길이. JSON 열 \`pitch\` = 모듈 \`cellPitch\`.`);
  lines.push('det=4 는 남는 대응이 3점이라 H 가 서지 않아 유한 잔차는 det≥5 뿐; det=5 는 4점 정확해. det=6 은 5점 LS. affine LOO(6자유도)를 같은 앵커에 나란히 둔다.');
  lines.push('정준 중심은 `canonicalPatches()` 와 같은 식(파인더 30셀 → 연결 성분 → 면별 `moduleCenter` 평균).');
  lines.push('실행: `node tools/probes/rectify-photo-probe.mjs [--limit=N] [--filter=부분문자열] [--out=경로] [--report=경로] [--shards=N] [--report-only] [--negative=N]`');
  lines.push('상대경로는 repo 루트 기준(resolveRepoPath).');
  lines.push('');

  lines.push('## ① 합성 대조군');
  lines.push('');
  if (!synthetic) {
    lines.push('합성 대조군이 JSON 에 없다.');
  } else {
    const syn = synthetic;
    const synH = hResidualOf(syn) ?? syn.residual;
    const looIdeal = syn.groundTruth?.looIdealMaxPx;
    lines.push(`정면 합성 1장 (encodeY v0 · 3톤 · PPU ${PPU} · ${FRAME_SIDE} 정사각 임베드, 프론트엔드 생략).`);
    lines.push('');
    lines.push(`- 검출: **${syn.rectify.detectedCount}/6**, reason=\`${syn.rectify.reason}\`, 후보 캡(≤2)=${syn.rectify.shapeCount}`);
    lines.push(`- 배선 잔차 (테스트와 같은 기대좌표, PPU×layout): max **${fmt(syn.groundTruth?.testMaxPx, 3)} px** · 앵커별 ${(syn.groundTruth?.testPerAnchorPx ?? []).map((v) => fmt(v, 3)).join(', ')}`);
    lines.push(`- 정준중심 기대좌표 잔차: max ${fmt(syn.groundTruth?.canonicalMaxPx, 3)} px`);
    lines.push(`- H leave-one-out(5pt-ls) max: **${fmt(synMaxPx, 3)} px** / ${fmt(synH?.maxCells, 4)} 셀, rmsCells=${fmt(synH?.rmsCells, 4)} · 앵커별 ${(synH?.perAnchorPx ?? []).map((v) => fmt(v, 3)).join(', ')}`);
    lines.push(`- affine LOO max: **${fmt(residualMaxPx(synAff) ?? syn.groundTruth?.affineMaxPx, 3)} px** / ${fmt(synAff?.maxCells ?? syn.groundTruth?.affineMaxCells, 4)} 셀`);
    if (Number.isFinite(looIdeal)) {
      lines.push(`- 참값 좌표 H-LOO max: ${looIdeal.toExponential(2)} px (≤4.5e-12 자리).`);
    }
    const passNote = synOk
      ? '**통과** (6/6 이고 참값 잔차 ≤ 1 px — 운용 한계와 같은 자). LOO 1px 게이트는 합성에서도 성립하지 않는다 — 중앙 삼각형(1.5셀) 오차가 외곽(11.5셀)으로 외삽되는 지렛대 ≈8× + 사영항 (참값 LOO ≤4.5e-12).'
      : '**실패** — 코퍼스로 가지 않았다';
    lines.push(`- 판정: ${passNote} · ${syn.ms} ms`);
    if (syn.anchors) {
      lines.push('');
      lines.push(mdTable(
        ['id', 'found', 'x', 'y', 'pitch', 'corr'],
        syn.anchors.map((a) => [
          a.id,
          a.found ? 'yes' : 'no',
          fmt(a.x, 2),
          fmt(a.y, 2),
          fmt(a.pitch, 3),
          fmt(a.correlation, 4),
        ]),
      ));
    }
  }
  lines.push('');

  lines.push('## ② 음성 대조군');
  lines.push('');
  lines.push('모듈 수준 오탐 자: `detectedCount ≥ 3` (`partial`). 후보 캡(≤2) 열은 상류 로케이터의 패밀리당 후보 상한이라 오탐 자가 아니다.');
  lines.push('');
  if (!photoNeg.length) {
    lines.push('음성 대조군 사진이 없다 (k26-qr / ctlv2 필터 0건 또는 `--negative=0`).');
  } else {
    const falsePos = photoNeg.filter((d) => (d.rectify?.detectedCount ?? 0) >= 3);
    const rejected = photoNeg.filter((d) => (d.rectify?.detectedCount ?? 0) < 3);
    lines.push(`v0 가 아닌 폴더 사진 ${photoNeg.length}장. 오탐(det≥3) ${falsePos.length}장, 기각(det≤2) ${rejected.length}장.`);
    lines.push('');
    lines.push(mdTable(
      ['name', 'wh', 'sq', 'front', 'reason', 'det', '후보 캡(≤2)', 'minCorr', 'minPitch', 'ms'],
      photoNeg.map((d) => [
        d.name,
        `${d.width}×${d.height}`,
        d.square ? 'Y' : 'N',
        d.frontend?.ok ? 'ok' : (d.frontend?.reason ?? 'fail'),
        `\`${d.rectify?.reason}\``,
        String(d.rectify?.detectedCount ?? '—'),
        String(d.rectify?.shapeCount ?? '—'),
        fmt(rowMinCorr(d), 3),
        fmt(rowMinPitch(d), 2),
        String(d.ms ?? '—'),
      ]),
    ));
    if (falsePos.length) {
      lines.push('');
      lines.push('오탐 (det≥3):');
      for (const d of falsePos) {
        lines.push(`- \`${d.name}\` detectedCount=${d.rectify.detectedCount} 후보캡=${d.rectify.shapeCount} reason=${d.rectify.reason} minCorr=${fmt(rowMinCorr(d), 3)} minPitch=${fmt(rowMinPitch(d), 2)}`);
      }
    }
  }
  lines.push('');
  if (!noiseNeg.length) {
    lines.push('잡음 프레임이 이 payload 에 없다 (원본 JSON 재렌더이거나 `--report-only`).');
  } else {
    const hist = detCountHist(noiseNeg);
    const ge3 = geCount(noiseNeg, 3);
    const ge4 = geCount(noiseNeg, 4);
    const ge5 = geCount(noiseNeg, 5);
    const ge6 = geCount(noiseNeg, 6);
    lines.push(`결정적 균일 잡음 ${NOISE_SIDE} 정사각 ${noiseNeg.length}장 (LCG 시드 고정). 잡음 바닥 det 히스토그램: ${formatHist(hist, { sortNumeric: true })}.`);
    lines.push(`det≥3 ${ge3}/${noiseNeg.length} · det≥4 ${ge4}/${noiseNeg.length} · det≥5 ${ge5}/${noiseNeg.length} · 6/6 ${ge6}/${noiseNeg.length}.`);
    lines.push('검출 수·LOO 만으론 잡음과 실물을 가르지 못한다. 잡음 히트는 앵커 correlation·pitch 최소값이 실물 6/6 보다 낮은 자리가 후보 자다 (문턱은 정하지 않는다).');
    lines.push('');
    lines.push(mdTable(
      ['name', 'det', 'reason', '후보 캡(≤2)', 'minCorr', 'minPitch', 'H셀', 'affine셀', 'ms'],
      noiseNeg.map((d) => [
        d.name,
        String(d.rectify?.detectedCount ?? '—'),
        `\`${d.rectify?.reason}\``,
        String(d.rectify?.shapeCount ?? '—'),
        fmt(rowMinCorr(d), 3),
        fmt(rowMinPitch(d), 2),
        fmt(hResidualOf(d)?.maxCells, 3),
        fmt(affineResidualOf(d, canonicalCenters)?.maxCells, 3),
        String(d.ms ?? '—'),
      ]),
    ));
  }
  lines.push('');

  lines.push('## ③ 폴더별');
  lines.push('');
  if (!dumps.length) {
    lines.push('코퍼스 행이 없다 (합성 실패로 중단했거나 `--limit=0`).');
  } else {
    const byFolder = new Map();
    for (const dump of dumps) {
      const folder = folderOf(dump.name);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push(dump);
    }
    const folderNames = [...byFolder.keys()].sort((a, b) => a.localeCompare(b));
    const headers = [
      '폴더', 'N', 'front ok%', '6', '5', '4', '≤3',
      'med셀', 'p90셀', 'max셀', 'med px', 'p90 px', 'max px', 'med ms',
    ];
    const rows = folderNames.map((name) => statsRow(name, dumpStats(byFolder.get(name), canonicalCenters)));
    const allStats = dumpStats(dumps, canonicalCenters);
    rows.push(statsRow('**합계**', allStats));
    const detGe4 = geCount(dumps, 4);
    const detGe5 = geCount(dumps, 5);
    const det4 = dumps.filter((d) => (d.rectify?.detectedCount ?? 0) === 4).length;
    const shapeHist = new Map();
    for (const dump of dumps) {
      const cap = dump.rectify?.shapeCount;
      const key = cap == null ? 'null' : String(cap);
      shapeHist.set(key, (shapeHist.get(key) || 0) + 1);
    }
    lines.push('셀 = cellPitch = √(마름모 넓이) = 0.93 × 변 길이.');
    lines.push('det=4 는 남는 대응이 3점이라 H 가 서지 않아 유한 잔차는 det≥5 뿐; det=5 는 4점 정확해.');
    lines.push('잔차 열(med/p90/max 셀·px)은 장별 H leave-one-out **최악**. det=6 은 5점 LS, det=5 는 4점 정확해 — 아래 갈라 집계. affine LOO 는 같은 앵커·6자유도.');
    lines.push(`${measuredLabel} 중 검출 ≥ 4 는 ${detGe4}장, ≥ 5 는 ${detGe5}장, det=4 는 ${det4}장 (residual=null, residualReason=h-undefined-3pt).`);
    lines.push(`H-LOO 유한: det=6 ${allStats.det6N}장 중앙값 ${fmt(allStats.det6Med, 3)} 셀 / det=5(4pt-exact) ${allStats.det5N}장 중앙값 ${fmt(allStats.det5Med, 3)} 셀.`);
    lines.push(`affine LOO (det≥4) ${allStats.affN}장 중앙값 ${fmt(allStats.affMed, 3)} 셀 (${fmt(allStats.affMedPx, 2)} px), max ${fmt(allStats.affMax, 3)} 셀.`);
    lines.push(`후보 캡(≤2) 분포: ${formatHist(shapeHist)}.`);
    lines.push('');
    lines.push(mdTable(headers, rows));
    const squareN = dumps.filter((d) => d.square).length;
    const squareGe4 = dumps.filter((d) => d.square && (d.rectify?.detectedCount ?? 0) >= 4).length;
    lines.push('');
    lines.push(`정사각 덤프 ${squareN}/${dumps.length} (${pct(squareN, dumps.length)}), 그중 검출 ≥4 는 ${squareGe4}/${squareN}.`);
  }
  lines.push('');

  lines.push('## ④ frontend × rectify 교차');
  lines.push('');
  if (!dumps.length) {
    lines.push('코퍼스 행이 없다.');
  } else {
    const keys = ['6', '5', '4', 'le3'];
    const grid = {
      ok: { 6: 0, 5: 0, 4: 0, le3: 0 },
      fail: { 6: 0, 5: 0, 4: 0, le3: 0 },
    };
    for (const dump of dumps) {
      const side = dump.frontend?.ok ? 'ok' : 'fail';
      grid[side][detectBucket(dump.rectify?.detectedCount ?? 0)] += 1;
    }
    lines.push('«잡는다» = 검출 ≥ 5 (유한 H-LOO 가 서는 정족수; det=5 는 4점 정확해). «6/6» 도 따로 센다.');
    const noiseGe4Note = noiseNeg.length
      ? `검출 ≥4 는 균일 잡음 ${geCount(noiseNeg, 4)}/${noiseNeg.length} 에서도 난다.`
      : '검출 ≥4 는 균일 잡음 6/24 에서도 난다 (이 payload 에 잡음 프레임이 없어 판정자 24장 히스토그램을 각주로만 둔다).';
    lines.push(noiseGe4Note);
    lines.push('');
    lines.push(mdTable(
      ['frontend \\ rectify', '6', '5', '4', '≤3', '합'],
      [
        ['ok', grid.ok[6], grid.ok[5], grid.ok[4], grid.ok.le3,
          keys.reduce((s, k) => s + grid.ok[k], 0)].map(String),
        ['fail', grid.fail[6], grid.fail[5], grid.fail[4], grid.fail.le3,
          keys.reduce((s, k) => s + grid.fail[k], 0)].map(String),
      ],
    ));
    const frontOkMiss = grid.ok.le3 + grid.ok[4];
    const frontOkHit = grid.ok[6] + grid.ok[5];
    const frontFailHit = grid.fail[6] + grid.fail[5];
    const frontFailMiss = grid.fail.le3 + grid.fail[4];
    const frontOk = frontOkMiss + frontOkHit;
    const frontFail = frontFailHit + frontFailMiss;
    lines.push('');
    lines.push(`- frontend 가 읽는데 rectify 는 못 잡는다 (ok ∧ ≤4): **${frontOkMiss}** / frontend ok ${frontOk}`);
    lines.push(`- 그 반대 (fail ∧ ≥5): **${frontFailHit}** / frontend fail ${frontFail}`);
    lines.push(`- frontend ok ∧ 6/6: ${grid.ok[6]} · frontend fail ∧ 6/6: ${grid.fail[6]}`);
    lines.push(`- (참고) ok ∧ ≥4: ${grid.ok[6] + grid.ok[5] + grid.ok[4]} · fail ∧ ≥4: ${grid.fail[6] + grid.fail[5] + grid.fail[4]}`);
    lines.push('');
    lines.push('### finderPatternId × det');
    lines.push('');
    lines.push(crossDetTable(dumps, finderKeyOf, 'finderPatternId'));
    const nKeys = dumps.map(nKeyOf);
    const nKnown = nKeys.filter((key) => key !== null).length;
    lines.push('');
    if (!nKnown) {
      lines.push('hypothesis.n / cellSurfaceLayout 이 이 측정 행에서 비어 있다 (프론트엔드가 안 주거나 payload 에 열이 없다). finderPatternId 가 레이아웃 대용 축이다.');
    } else {
      lines.push('### hypothesis.n / cellSurfaceLayout × det');
      lines.push('');
      lines.push(crossDetTable(dumps, (d) => nKeyOf(d) ?? '(null)', 'n / layout'));
      lines.push(`n·layout 을 가진 행 ${nKnown}/${dumps.length}.`);
    }
    const ratios = dumps.map((d) => ({ dump: d, ratio: pitchCellRatio(d) }))
      .filter((row) => Number.isFinite(row.ratio));
    lines.push('');
    lines.push('### 앵커 pitch 중앙값 / frontend cellSizePx');
    lines.push('');
    if (!ratios.length) {
      lines.push('둘 다 있는 장이 없다.');
    } else {
      const byDet = new Map();
      for (const row of ratios) {
        const det = row.dump.rectify?.detectedCount ?? 0;
        if (!byDet.has(det)) byDet.set(det, []);
        byDet.get(det).push(row.ratio);
      }
      const ratioRows = [...byDet.keys()].sort((a, b) => a - b).map((det) => {
        const values = byDet.get(det);
        return [String(det), String(values.length), fmt(medianOf(values), 3), fmt(p90Of(values), 3), fmt(maxOf(values), 3)];
      });
      lines.push(`표본 ${ratios.length}장, 비 중앙값 ${fmt(medianOf(ratios.map((r) => r.ratio)), 3)}.`);
      lines.push('');
      lines.push(mdTable(['det', 'N', 'med 비', 'p90 비', 'max 비'], ratioRows));
    }
  }
  lines.push('');

  lines.push('## ⑤ 960 vs 1440 짝');
  lines.push('');
  if (!dumps.length) {
    lines.push('코퍼스 행이 없다.');
  } else {
    const byKey = new Map();
    for (const dump of dumps) {
      const side = pairSide(dump.name);
      if (side !== '960' && side !== '1440') continue;
      const key = pairKey(dump.name);
      if (!byKey.has(key)) byKey.set(key, {});
      byKey.get(key)[side] = dump;
    }
    const pairs = [...byKey.entries()]
      .filter(([, pair]) => pair['960'] && pair['1440'])
      .sort((a, b) => a[0].localeCompare(b[0]));
    const unpaired = dumps.length - pairs.length * 2;
    let better960 = 0;
    let better1440 = 0;
    let tie = 0;
    let bothLe3 = 0;
    let bothGe4 = 0;
    const detDelta = [];
    const cellDelta = [];
    for (const [, pair] of pairs) {
      const a = pair['960'].rectify.detectedCount ?? 0;
      const b = pair['1440'].rectify.detectedCount ?? 0;
      detDelta.push(b - a);
      if (a > b) better960 += 1;
      else if (b > a) better1440 += 1;
      else tie += 1;
      if (a <= 3 && b <= 3) bothLe3 += 1;
      if (a >= 4 && b >= 4) bothGe4 += 1;
      const ca = pair['960'].residual?.maxCells;
      const cb = pair['1440'].residual?.maxCells;
      if (Number.isFinite(ca) && Number.isFinite(cb)) cellDelta.push(cb - ca);
    }
    lines.push(`짝 ${pairs.length}쌍 · 짝 없는 덤프 ${unpaired}장.`);
    lines.push(`detectedCount: 960 우세 ${better960} · 1440 우세 ${better1440} · 동률 ${tie}.`);
    lines.push(`둘 다 ≤3: ${bothLe3}쌍 · 둘 다 ≥4: ${bothGe4}쌍.`);
    if (detDelta.length) {
      lines.push(`detectedCount(1440−960) median ${fmt(medianOf(detDelta), 2)}, p90 ${fmt(p90Of(detDelta), 2)}.`);
    }
    if (cellDelta.length) {
      lines.push(`maxCells(1440−960) median ${fmt(medianOf(cellDelta), 3)} 셀 (${cellDelta.length}쌍, 둘 다 잔차 있음).`);
    } else {
      lines.push('둘 다 잔차가 있는 짝이 없어 해상도별 잔차 차를 못 잰다.');
    }
  }
  lines.push('');

  lines.push('## ⑥ «합성 1px» 이 실물에서 얼마인가');
  lines.push('');
  if (!synOk) {
    lines.push('합성 대조군이 서지 않아 실물 수치를 해석하지 않는다. 자의 배선부터 고친 뒤에 다시 잰다.');
  } else if (!dumps.length) {
    lines.push('코퍼스를 돌리지 않았다.');
  } else {
    const all = dumpStats(dumps, canonicalCenters);
    const withH = dumps.filter((d) => {
      const residual = hResidualOf(d);
      return residual && Number.isFinite(residualMaxPx(residual));
    });
    const six = dumps.filter((d) => d.rectify?.detectedCount === 6);
    const five = dumps.filter((d) => d.rectify?.detectedCount === 5);
    const gtMax = synthetic.groundTruth?.testMaxPx;
    const paragraph = [];
    paragraph.push(`운용 한계가 말한 «합성 1px» 은 참값 기대좌표 잔차이며, 이 장의 값은 ${fmt(gtMax, 3)} px (6/6) 이다.`);
    paragraph.push(`같은 장을 H leave-one-out(5pt-ls) 으로 재면 최악 ${fmt(synMaxPx, 3)} px (${fmt((hResidualOf(synthetic) ?? synthetic.residual)?.maxCells, 4)} 셀).`);
    paragraph.push(`affine LOO 는 합성 외곽 최대 ${fmt(residualMaxPx(synAff) ?? synthetic.groundTruth?.affineMaxPx, 3)} px.`);
    paragraph.push(`참값 좌표로 H-LOO 하면 max ${Number.isFinite(synthetic.groundTruth?.looIdealMaxPx) ? synthetic.groundTruth.looIdealMaxPx.toExponential(2) : '≤4.5e-12'} px — 합성 LOO 수 px 는 중앙 삼각형(1.5셀) 오차가 외곽(11.5셀)으로 외삽되는 지렛대 ≈8× + 사영항.`);
    paragraph.push(`${measuredLabel} 중 6/6 은 ${six.length}장, 검출 ≥ 5 는 ${geCount(dumps, 5)}장, ≥ 4 는 ${geCount(dumps, 4)}장, H-LOO 유한 ${all.residualN}장(${pct(all.residualN, all.n)}).`);
    if (all.det6N) {
      paragraph.push(`det=6 (5pt-ls) ${all.det6N}장 H-LOO 중앙값 ${fmt(all.det6Med, 3)} 셀, p90 ${fmt(all.det6P90, 3)}, max ${fmt(all.det6Max, 3)}.`);
    }
    if (all.det5N) {
      paragraph.push(`det=5 (4pt-exact) ${all.det5N}장 H-LOO 중앙값 ${fmt(all.det5Med, 3)} 셀, p90 ${fmt(all.det5P90, 3)}, max ${fmt(all.det5Max, 3)}.`);
    }
    if (all.affN) {
      paragraph.push(`affine LOO ${all.affN}장 중앙값 ${fmt(all.affMed, 3)} 셀 (${fmt(all.affMedPx, 2)} px), max ${fmt(all.affMax, 3)} 셀.`);
    }
    paragraph.push('최댓값 수백 셀은 퇴화 호모그래피(한 점이 프레임 밖으로 튀는)이지 실물 정밀도가 아니다.');
    const nearSynth = six.filter((d) => {
      const px = residualMaxPx(hResidualOf(d));
      return Number.isFinite(px) && px < 10;
    });
    if (nearSynth.length) {
      paragraph.push(`합성 H-LOO 바닥(~5 px / 0.32 셀)에 가까운 6/6 장은 ${nearSynth.length}장: ${nearSynth.map((d) => `\`${d.name}\` ${fmt(residualMaxPx(hResidualOf(d)), 2)} px / ${fmt(hResidualOf(d)?.maxCells, 3)} 셀`).join('; ')}.`);
    }
    paragraph.push(`검출 ≤ 3 은 ${all.buckets.le3}/${all.n} (${pct(all.buckets.le3, all.n)}). 정사각 ${dumps.filter((d) => d.square).length}/${all.n}장 중 검출 ≥4 는 ${dumps.filter((d) => d.square && (d.rectify?.detectedCount ?? 0) >= 4).length}장.`);
    lines.push(paragraph.join(' '));
    if (six.length) {
      lines.push('');
      lines.push('6/6 장 (H = 5pt-ls):');
      lines.push('');
      lines.push(mdTable(
        ['name', 'wh', 'sq', 'front', 'H셀', 'H px', 'affine셀', 'minCorr', 'minPitch'],
        six.map((d) => [
          d.name,
          `${d.width}×${d.height}`,
          d.square ? 'Y' : 'N',
          d.frontend.ok ? 'ok' : 'fail',
          fmt(hResidualOf(d)?.maxCells, 3),
          fmt(residualMaxPx(hResidualOf(d)), 2),
          fmt(affineResidualOf(d, canonicalCenters)?.maxCells, 3),
          fmt(rowMinCorr(d), 3),
          fmt(rowMinPitch(d), 2),
        ]),
      ));
    }
    if (withH.length) {
      lines.push('');
      lines.push(`H-LOO 유한 장 (${withH.length}; det=5 는 4pt-exact):`);
      lines.push('');
      lines.push(mdTable(
        ['name', 'det', 'H', 'H셀', 'H px', 'affine셀', 'minCorr', 'minPitch', 'front'],
        withH
          .slice()
          .sort((a, b) => (hResidualOf(a)?.maxCells ?? Infinity) - (hResidualOf(b)?.maxCells ?? Infinity))
          .map((d) => [
            d.name,
            String(d.rectify.detectedCount),
            homographyKindFor(d.rectify.detectedCount) ?? '—',
            fmt(hResidualOf(d)?.maxCells, 3),
            fmt(residualMaxPx(hResidualOf(d)), 2),
            fmt(affineResidualOf(d, canonicalCenters)?.maxCells, 3),
            fmt(rowMinCorr(d), 3),
            fmt(rowMinPitch(d), 2),
            d.frontend.ok ? 'ok' : 'fail',
          ]),
      ));
    }
    if (five.length) {
      lines.push('');
      lines.push(`det=5 (4pt-exact) ${five.length}장.`);
    }
  }
  lines.push('');

  lines.push('## ⑦ 안 잰 것');
  lines.push('');
  const shape0 = dumps.filter((d) => d.rectify?.shapeCount === 0).length;
  const depths = bitDepthHistogram(dumps);
  const depthText = depths.hist.size
    ? formatHist(depths.hist, { sortNumeric: true }) + (depths.missing ? ` · 결측 ${depths.missing}` : '')
    : (dumps.length ? '결측' : '측정 행 없음');
  lines.push('- 라이브 크롭 규약(정사각 + 긴 변 ≤960, 실패 시 1440 승격)을 덤프에 다시 적용하지 않았다. 덤프 width/height 를 그대로 물렸다.');
  lines.push('- 실사진에 기대 좌표가 없다. 잔차는 leave-one-out 자기 일관성이지 참값 대비가 아니다. 계통 편향(여섯 점 모두 같은 쪽으로 밀림)은 이 자가 못 본다.');
  lines.push(`- 비트심도 히스토그램 (\`readLumaDump().bitDepth\`): ${depthText}.`);
  if (partial) {
    lines.push(`- 이번 실행은 listLumaDumps 의 부분이다 (${measuredLabel}, --filter/--limit). 동영상 프레임(\`*.fNNNN.*.luma\`)은 listLumaDumps 가 빼는 정지 코퍼스 밖이다.`);
  } else {
    lines.push(`- listLumaDumps 정지 코퍼스 ${Number.isInteger(listed) ? listed : measured}장, 이번 측정 ${measured}장. 동영상 프레임(\`*.fNNNN.*.luma\`)은 정지 코퍼스가 아니다.`);
  }
  lines.push(`- 후보 캡 0 은 ${shape0}장 (집계).`);
  lines.push('- 국소 affine(`localAffine`) 자체·면 단위 왜곡·인쇄물 vs 화면 촬영을 가르지 않았다.');
  lines.push('- 프론트엔드 옵션(시드 재시도 끄기 등)은 기본값만 썼다.');
  lines.push('');
  lines.push('### 측정 정의 노트');
  lines.push('');
  lines.push('- LOO 는 참값 잔차와 다른 자다. 배선 게이트는 참값 기대좌표, 코퍼스 잔차는 H-LOO(det≥5) + affine LOO.');
  lines.push('- det=4 는 남는 대응이 3점이라 H 가 서지 않는다 (`residual=null`, `residualReason=h-undefined-3pt`).');
  lines.push('- 스케일 키는 `cellPitch` (√마름모 넓이 = 0.93 × 변 길이). `localAffine` 은 2×2.');
  lines.push('');

  lines.push('## ⑧ 해석에서 고친 것');
  lines.push('');
  const v0n13 = dumps.filter((d) => d.frontend?.n === 13 && (
    d.frontend?.cellSurfaceLayout === 'v0'
    || d.frontend?.finderPatternId === 'locator-cell-surface-v0'
  ));
  const v0finder = dumps.filter((d) => d.frontend?.finderPatternId === 'locator-cell-surface-v0');
  const v0tFinder = dumps.filter((d) => d.frontend?.finderPatternId === 'locator-cell-surface-v0t');
  const v0tyFinder = dumps.filter((d) => d.frontend?.finderPatternId === 'locator-cell-surface-v0ty');
  const centralV0 = dumps.filter((d) => d.frontend?.finderPatternId === 'central-v0');
  const le3 = dumps.filter((d) => (d.rectify?.detectedCount ?? 0) <= 3);
  const squareGe4 = dumps.filter((d) => d.square && (d.rectify?.detectedCount ?? 0) >= 4);
  const squareN = dumps.filter((d) => d.square).length;
  const targetV0 = v0n13.length ? v0n13 : v0finder;
  const targetHit = targetV0.filter((d) => (d.rectify?.detectedCount ?? 0) >= 5);
  const targetSix = targetV0.filter((d) => (d.rectify?.detectedCount ?? 0) === 6);
  if (dumps.length) {
    lines.push(`- 검출 ≤3 의 1순위 원인은 규약 차이가 아니라 대상 불일치다. 모듈은 estimatedN===13 이고 family v0 만 받는다. frontend 가 v0 n=13 셀표면으로 읽은 덤프는 ${targetV0.length}장 (finderPatternId=locator-cell-surface-v0 ${v0finder.length}장${v0n13.length ? `, n=13∧layout v0 ${v0n13.length}장` : '; n 열 없음 — finderPatternId 로 집계'}) — 그중 검출 ≥5 ${targetHit.length}장, 6/6 ${targetSix.length}장.`);
    lines.push(`- v0t finder ${v0tFinder.length}장 (검출 ≥5 ${geCount(v0tFinder, 5)}) · v0ty finder ${v0tyFinder.length}장 (검출 ≥5 ${geCount(v0tyFinder, 5)}) — n=21 레이아웃이라 이 모듈의 대상이 아니다.`);
    lines.push(`- central-v0 비콘 ${centralV0.length}장, 검출 ≥5 ${geCount(centralV0, 5)}장 · 6/6 ${centralV0.filter((d) => (d.rectify?.detectedCount ?? 0) === 6).length}장. 크롭 없이 물리면 거의 안 잡힌다.`);
    lines.push(`- 검출 ≤3 은 ${le3.length}/${dumps.length}. 나머지 hex·큐브·불스아이 계열은 이 모듈이 받는 v0 n=13 셀표면이 아니다.`);
    lines.push(`- 정사각 ${squareN}장 중 검출 ≥4 는 ${squareGe4.length}장 — 정사각 크롭 전제는 이 코퍼스의 검출을 설명하지 않는다.`);
  }
  lines.push('- 후보 캡(≤2) 이 2 인 것은 상류 `maximumPosesPerFamily: 2` 이지 오탐이 아니다. 오탐 자는 det≥3.');
  if (photoNeg.length) {
    const fp = photoNeg.filter((d) => (d.rectify?.detectedCount ?? 0) >= 3).length;
    lines.push(`- 음성 사진 ${photoNeg.length}장 중 det≥3 오탐 ${fp}장.`);
  }
  if (synthetic && !synOk) {
    lines.push('- 합성 대조군이 이 프로브에서 실패했다. 코퍼스 수치는 만들지 않았다. 배선(변환·n·임베드)을 의심한다.');
  }
  lines.push('');

  lines.push('## ⑨ 실행');
  lines.push('');
  const argv = payload.run?.argv ?? [];
  const wallMs = payload.run?.wallMs ?? null;
  const shards = payload.run?.shards ?? null;
  const outArg = payload.run?.out ?? DEFAULT_OUT;
  const reportArg = payload.run?.report ?? reportPath;
  lines.push('- `node --check tools/probes/rectify-photo-probe.mjs` — exit 0.');
  const countNote = partial
    ? `measured=${measured} (부분 실행)`
    : `listed=${listed ?? measured}, measured=${measured}`;
  lines.push(`- \`node tools/probes/rectify-photo-probe.mjs${argv.length ? ` ${argv.join(' ')}` : ''}\` — ${countNote}, shards=${shards ?? '—'}, wall=${fmt(wallMs, 0)} ms (${fmt((wallMs ?? 0) / 60000, 1)} min), 합성 ${synOk ? '통과' : '실패'}.`);
  if (payload.run?.reportOnly) {
    const ro = Array.isArray(payload.run.reportOnlyArgv) ? payload.run.reportOnlyArgv.join(' ') : '--report-only';
    lines.push(`- 재렌더: \`node tools/probes/rectify-photo-probe.mjs ${ro}\`.`);
  }
  lines.push(`- 산출: \`${outArg}\`, \`${reportArg}\`.`);
  lines.push('');

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
}

// ── 워커 풀 (장별 decodeFrontend 는 독립) ──────────────────────────────

function runDumpPool(dumps, canonicalCenters, shards, onProgress) {
  if (dumps.length === 0) return Promise.resolve([]);
  if (shards <= 1 || dumps.length === 1) {
    const rows = [];
    for (let i = 0; i < dumps.length; i += 1) {
      const row = measureDump(dumps[i], canonicalCenters);
      rows.push(row);
      onProgress(i + 1, dumps.length, row);
    }
    return Promise.resolve(rows);
  }
  return new Promise((resolve, reject) => {
    const rows = new Array(dumps.length);
    let next = 0;
    let done = 0;
    let settled = false;
    const workers = [];
    const fail = (error) => {
      if (settled) return;
      settled = true;
      for (const worker of workers) worker.terminate();
      reject(error);
    };
    const dispatch = (worker) => {
      if (settled) return;
      if (next >= dumps.length) {
        worker.postMessage(null);
        return;
      }
      const index = next;
      next += 1;
      worker.postMessage({
        index,
        name: dumps[index].name,
        path: dumps[index].path,
      });
    };
    const nWorkers = Math.min(shards, dumps.length);
    for (let i = 0; i < nWorkers; i += 1) {
      const worker = new Worker(fileURLToPath(import.meta.url));
      workers.push(worker);
      worker.on('message', (message) => {
        if (settled) return;
        if (message && message.ready) {
          dispatch(worker);
          return;
        }
        if (!message || message.ok !== true) {
          fail(new Error(message?.error || 'worker failed'));
          return;
        }
        rows[message.index] = message.row;
        done += 1;
        onProgress(done, dumps.length, message.row);
        if (done === dumps.length) {
          settled = true;
          for (const item of workers) item.terminate();
          resolve(rows);
          return;
        }
        dispatch(worker);
      });
      worker.on('error', fail);
      worker.on('exit', (code) => {
        if (!settled && code !== 0) fail(new Error(`worker exit ${code}`));
      });
    }
  });
}

function workerLoop() {
  const centers = canonicalAnchorCenters();
  parentPort.on('message', (job) => {
    if (job === null) {
      parentPort.close();
      return;
    }
    try {
      const row = measureDump({ name: job.name, path: job.path }, centers);
      parentPort.postMessage({ ok: true, index: job.index, row });
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        index: job.index,
        error: error instanceof Error ? error.stack : String(error),
      });
    }
  });
  parentPort.postMessage({ ready: true });
}

// ── main ───────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const outPath = resolveRepoPath(args.out);
  const reportPath = resolveRepoPath(args.report);
  if (args.reportOnly) {
    const existing = JSON.parse(readFileSync(outPath, 'utf8'));
    const prev = existing.run && typeof existing.run === 'object' ? existing.run : {};
    existing.run = {
      ...prev,
      report: args.report,
      reportOnly: true,
      reportOnlyArgv: argv,
    };
    writeReport(existing, reportPath);
    logLine(`[rectify-photo] report-only ← ${args.out} → ${args.report}`);
    return;
  }
  const started = process.hrtime.bigint();
  const canonicalCenters = canonicalAnchorCenters();

  logLine(`[rectify-photo] n=${CENTRAL_V0_SOURCE_N} pitchKey=cellPitch residual=leave-one-out shards=${args.shards}`);
  logLine('[rectify-photo] 합성 대조군 렌더…');
  const rendered = renderFrontFrame();
  const synthetic = {
    name: '__synthetic-front-3tone__',
    ...measureFrame(rendered.frame, canonicalCenters, { frontend: false }),
  };
  synthetic.groundTruth = syntheticGroundTruth(
    synthetic.anchors, rendered.scene, rendered.offsetX, rendered.offsetY, canonicalCenters,
  );
  const synPass = syntheticWiringOk(synthetic);
  const synMaxPx = residualMaxPx(synthetic.residual);
  logLine(`[rectify-photo] 합성 ${synthetic.rectify.detectedCount}/6 reason=${synthetic.rectify.reason} gtMaxPx=${synthetic.groundTruth.testMaxPx} looMaxPx=${synMaxPx} maxCells=${synthetic.residual?.maxCells} ${synPass ? 'PASS' : 'FAIL'} ${synthetic.ms}ms`);

  const listed = listLumaDumps();
  logLine(`[rectify-photo] listLumaDumps = ${listed.length}`);

  const negativeEntries = pickNegative(listed, args.negative);
  if (negativeEntries.length === 0) {
    logLine(`[rectify-photo] 경고: 음성 대조군 사진 0장 (pickNegative, --negative=${args.negative}).`);
  }
  const photoNeg = [];
  for (let i = 0; i < negativeEntries.length; i += 1) {
    const entry = negativeEntries[i];
    logLine(`[rectify-photo] 음성 ${i + 1}/${negativeEntries.length} ${entry.name}`);
    const row = measureDump(entry, canonicalCenters);
    photoNeg.push(row);
    logLine(`[rectify-photo]   det=${row.rectify.detectedCount} cap=${row.rectify.shapeCount} reason=${row.rectify.reason} front=${row.frontend.ok} ${row.ms}ms`);
  }
  const noise = measureNoiseFrames(canonicalCenters, NOISE_COUNT);
  const negative = [...photoNeg, ...noise];

  const payload = {
    n: CENTRAL_V0_SOURCE_N,
    pitchKey: 'cellPitch',
    residualMethod: 'leave-one-out',
    canonicalCenters,
    control: { synthetic, negative, noise },
    dumps: [],
    run: {
      argv,
      dumpListed: listed.length,
      dumpMeasured: 0,
      wallMs: 0,
      shards: args.shards,
      out: args.out,
      report: args.report,
      syntheticPass: synPass,
      negativePerGroup: args.negative,
    },
  };

  if (!synPass) {
    logLine('[rectify-photo] 합성 대조군 실패 — 코퍼스로 가지 않는다.');
    payload.run.wallMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    const reread = JSON.parse(readFileSync(outPath, 'utf8'));
    writeReport(reread, reportPath);
    logLine(`[rectify-photo] wrote ${args.out} · ${args.report}`);
    process.exitCode = 2;
    return;
  }

  let dumps = listed;
  if (args.filter) {
    dumps = dumps.filter((entry) => entry.name.includes(args.filter));
    logLine(`[rectify-photo] --filter=${args.filter} → ${dumps.length}`);
  }
  if (args.limit !== null) {
    dumps = dumps.slice(0, args.limit);
    logLine(`[rectify-photo] --limit=${args.limit} → ${dumps.length}`);
  }

  const corpusStarted = process.hrtime.bigint();
  const rows = await runDumpPool(dumps, canonicalCenters, args.shards, (done, total, row) => {
    const elapsed = Number(process.hrtime.bigint() - corpusStarted) / 1e6;
    const eta = done >= 2 ? Math.round((total - done) * elapsed / done) : null;
    logLine(`[rectify-photo] ${done}/${total} ${row.name} det=${row.rectify.detectedCount} shapes=${row.rectify.shapeCount} front=${row.frontend.ok ? 'ok' : row.frontend.reason} sq=${row.square} ${row.width}x${row.height} ${row.ms}ms${eta !== null ? ` eta=${eta}ms` : ''}`);
  });

  payload.dumps = rows;
  payload.run.dumpMeasured = rows.length;
  payload.run.wallMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const reread = JSON.parse(readFileSync(outPath, 'utf8'));
  writeReport(reread, reportPath);
  logLine(`[rectify-photo] wrote ${args.out} (${rows.length} dumps, wall=${payload.run.wallMs}ms, shards=${args.shards}) · ${args.report}`);
}

if (isMainThread) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
} else {
  workerLoop();
}
