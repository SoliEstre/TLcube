/**
 * finder-seed.js — 실루엣·전경 마스크 없이 파인더 런렝스로 중심·배율 후보를 얻는다.
 *
 * 검출 시작점이 `foregroundMask()` 이면 테두리 배경 극성에 걸린다. 이 모듈은
 * Otsu 이진 마스크에서 런을 훑고, 그 위에서만 시드를 고른다.
 *
 * 시드 두 종류:
 *   · `y-spoke` — v1 중앙(도트 r=0.18셀 + 120° 심선 3개). 중심을 지나는 직선은
 *     심선과 도트가 한 어두운 런으로 합쳐지므로 1:1:3:1:1 이 아니라
 *     「각도별 어두운 런 길이」가 서명이다. 측정은 test/finder-seed.test.js.
 *   · `qr-11311` — bootstrap.js 와 같은 1:1:3:1:1 (ISO QR 파인더).
 *     v2 우하단 모티프는 코어가 2×2 라 이 비율에 안 걸린다.
 *
 * bullseye-detect.js 는 Sobel 방사 투표이지 런렝스가 아니다. QR 런렝스 정본은
 * bootstrap.js 의 qrScanRuns / qrPatternMatches5 이고, 여기 사본은 그 비율 판정을
 * 시드 탐색에만 쓴다. bootstrap 의 QR 기하 진입점은 건드리지 않는다.
 *
 * @module decoder/finder-seed
 */

import { FRONTEND_FAILURE, assertLumaField, fail, ok } from './contracts.js';

/** 축소본에서 시드를 찾을 때 긴 변 상한. 원본 크롭은 이 값이 아니다. */
export const FINDER_SEED_SEARCH_MAX_SIDE = 320;

/** Type Y Y1 의 n. 시드에서 cellSize 를 역산할 때 쓴다. */
export const FINDER_SEED_DEFAULT_N = 21;

/** v1 중심 도트 반지름 / cellSize. sceneY.js 와 같아야 한다. */
export const V1_DOT_RADIUS_CELLS = 0.18;

/** v1 심선 반폭 / cellSize. sceneY.js 와 같아야 한다. */
export const V1_SEAM_HALF_WIDTH_CELLS = 0.075;

export const FINDER_SEED_KIND = Object.freeze({
  Y_SPOKE: 'y-spoke',
  QR_11311: 'qr-11311',
});

const QR_PATTERN_MODULES = 7;
const EPSILON = 1e-9;

export function downsampleLumaForSeed(luma, maxSide = FINDER_SEED_SEARCH_MAX_SIDE) {
  const cap = Number(maxSide) > 0 ? Number(maxSide) : FINDER_SEED_SEARCH_MAX_SIDE;
  const factor = Math.max(1, Math.ceil(Math.max(luma.width, luma.height) / cap));
  if (factor === 1) return { luma, factor };
  const width = Math.ceil(luma.width / factor);
  const height = Math.ceil(luma.height / factor);
  const data = new Float32Array(width * height);
  const alpha = luma.alpha ? new Uint8Array(width * height) : null;
  const sourceWidth = luma.width;
  const sourceHeight = luma.height;
  const sourceData = luma.data;
  const sourceAlpha = luma.alpha;
  for (let y = 0; y < height; y += 1) {
    const yStart = y * factor;
    const yEnd = Math.min(sourceHeight, yStart + factor);
    for (let x = 0; x < width; x += 1) {
      const xStart = x * factor;
      const xEnd = Math.min(sourceWidth, xStart + factor);
      let sum = 0;
      let count = 0;
      let maximumAlpha = 0;
      if (sourceAlpha) {
        for (let sourceY = yStart; sourceY < yEnd; sourceY += 1) {
          const row = sourceY * sourceWidth;
          for (let sourceX = xStart; sourceX < xEnd; sourceX += 1) {
            const a = sourceAlpha[row + sourceX];
            if (a > maximumAlpha) maximumAlpha = a;
            if (a === 0) continue;
            sum += sourceData[row + sourceX];
            count += 1;
          }
        }
      } else {
        for (let sourceY = yStart; sourceY < yEnd; sourceY += 1) {
          const row = sourceY * sourceWidth;
          for (let sourceX = xStart; sourceX < xEnd; sourceX += 1) {
            sum += sourceData[row + sourceX];
            count += 1;
          }
        }
      }
      const index = y * width + x;
      data[index] = count > 0 ? sum / count : 0;
      if (alpha) alpha[index] = maximumAlpha;
    }
  }
  return { luma: { width, height, data, alpha }, factor };
}

/**
 * 256-bin Otsu. 테두리 배경 모델을 쓰지 않는다 — 그게 전경 극성 결함의 원인이다.
 */
export function otsuThreshold(luma) {
  const histogram = new Uint32Array(256);
  const data = luma.data;
  const alpha = luma.alpha;
  const length = data.length;
  let count = 0;
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    if (alpha && alpha[index] === 0) continue;
    const scaled = data[index] * 255 + 0.5;
    let bin = 0;
    if (scaled >= 256) bin = 255;
    else if (scaled > 0) bin = scaled | 0;
    histogram[bin] += 1;
    count += 1;
    sum += bin;
  }
  if (count === 0) return null;
  let backgroundCount = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 127;
  for (let bin = 0; bin < 256; bin += 1) {
    backgroundCount += histogram[bin];
    backgroundSum += bin * histogram[bin];
    if (backgroundCount === 0) continue;
    const foregroundCount = count - backgroundCount;
    if (foregroundCount === 0) break;
    const backgroundMean = backgroundSum / backgroundCount;
    const foregroundMean = (sum - backgroundSum) / foregroundCount;
    const delta = backgroundMean - foregroundMean;
    const variance = backgroundCount * foregroundCount * delta * delta;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = bin;
    }
  }
  return threshold / 255;
}

export function darkMask(luma, threshold) {
  const { data, alpha } = luma;
  const mask = new Uint8Array(data.length);
  const cut = Number.isFinite(threshold) ? threshold : 0.5;
  if (alpha) {
    for (let i = 0; i < data.length; i += 1) {
      mask[i] = (alpha[i] !== 0 && data[i] <= cut) ? 1 : 0;
    }
  } else {
    for (let i = 0; i < data.length; i += 1) {
      mask[i] = data[i] <= cut ? 1 : 0;
    }
  }
  return mask;
}

/**
 * bootstrap.js `qrPatternMatches5` 와 같은 판정. 배열 할당 없이 다섯 스칼라.
 */
export function qrPatternMatches5(c0, c1, c2, c3, c4, tolerance = 0.9) {
  const total = c0 + c1 + c2 + c3 + c4;
  const module = total / QR_PATTERN_MODULES;
  if (!(module >= 1)) return false;
  const wide = module * tolerance;
  return Math.abs(c0 - module) <= wide
    && Math.abs(c1 - module) <= wide
    && Math.abs(c2 - module * 3) <= module * 3 * 0.5
    && Math.abs(c3 - module) <= wide
    && Math.abs(c4 - module) <= wide;
}

function qrScanRuns(buffer, base, length, runLength, runStart, onPattern) {
  let previousDark = buffer[base] === 1;
  let start = 0;
  let runCount = 0;
  for (let position = 1; position <= length; position += 1) {
    const currentDark = position < length
      ? buffer[base + position] === 1
      : !previousDark;
    if (currentDark === previousDark) continue;
    const slot = runCount % 5;
    runLength[slot] = position - start;
    runStart[slot] = start;
    runCount += 1;
    if (runCount >= 5 && previousDark) {
      const i0 = (slot + 1) % 5;
      const i1 = (slot + 2) % 5;
      const i2 = (slot + 3) % 5;
      const i3 = (slot + 4) % 5;
      const c0 = runLength[i0];
      const c1 = runLength[i1];
      const c2 = runLength[i2];
      const c3 = runLength[i3];
      const c4 = runLength[slot];
      if (qrPatternMatches5(c0, c1, c2, c3, c4)) {
        onPattern(
          runStart[i2] + c2 / 2,
          (c0 + c1 + c2 + c3 + c4) / QR_PATTERN_MODULES,
        );
      }
    }
    previousDark = currentDark;
    start = position;
  }
}

function qrTransposeMask(mask, width, height) {
  const out = new Uint8Array(mask.length);
  const BLOCK = 64;
  for (let by = 0; by < height; by += BLOCK) {
    const yEnd = Math.min(by + BLOCK, height);
    for (let bx = 0; bx < width; bx += BLOCK) {
      const xEnd = Math.min(bx + BLOCK, width);
      for (let y = by; y < yEnd; y += 1) {
        const row = y * width;
        for (let x = bx; x < xEnd; x += 1) out[x * height + y] = mask[row + x];
      }
    }
  }
  return out;
}

export function scanQr11311Hits(mask, width, height) {
  const hits = [];
  const runLength = new Int32Array(5);
  const runStart = new Int32Array(5);
  for (let y = 0; y < height; y += 1) {
    qrScanRuns(mask, y * width, width, runLength, runStart, (center, module) => {
      hits.push({ x: center, y, module, axis: 'h' });
    });
  }
  const transposed = qrTransposeMask(mask, width, height);
  for (let x = 0; x < width; x += 1) {
    qrScanRuns(transposed, x * height, height, runLength, runStart, (center, module) => {
      hits.push({ x, y: center, module, axis: 'v' });
    });
  }
  return hits;
}

/**
 * 중심을 지나는 한 스캔라인의 어두운 런. 합성 측정용.
 * 반환: 런 배열 [{start, length, dark}] 과 중심을 덮는 런.
 */
export function scanlineRunsThrough(mask, width, height, cx, cy, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const maxR = Math.hypot(width, height);
  const samples = [];
  for (let r = -maxR; r <= maxR; r += 1) {
    const x = Math.round(cx + dx * r);
    const y = Math.round(cy + dy * r);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    samples.push({ r, dark: mask[y * width + x] === 1 });
  }
  const runs = [];
  if (samples.length === 0) return { runs, centerRun: null, darkRunCount: 0 };
  let start = 0;
  for (let i = 1; i <= samples.length; i += 1) {
    const same = i < samples.length && samples[i].dark === samples[start].dark;
    if (same) continue;
    runs.push({
      start: samples[start].r,
      length: i - start,
      dark: samples[start].dark,
    });
    start = i;
  }
  const centerRun = runs.find((run) => run.start <= 0 && run.start + run.length > 0) || null;
  const darkRunCount = runs.filter((run) => run.dark).length;
  return { runs, centerRun, darkRunCount };
}

export function spokeLengths(mask, width, height, cx, cy, maxR, stepDeg = 15) {
  const rays = [];
  for (let deg = 0; deg < 360; deg += stepDeg) {
    const rad = deg * Math.PI / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    let length = 0;
    for (let r = 1; r <= maxR; r += 1) {
      const x = Math.round(cx + dx * r);
      const y = Math.round(cy + dy * r);
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      if (mask[y * width + x] !== 1) break;
      length = r;
    }
    rays.push({ deg, length });
  }
  return rays;
}

/**
 * 120° 간격 세 장축이 나머지보다 긴지. v1 중앙의 실제 서명.
 * 심선+도트는 한 런으로 합쳐지므로 장축/단축 길이비만 본다.
 */
export function scoreYSpoke(rays) {
  if (!Array.isArray(rays) || rays.length < 12) {
    return { score: 0, peaks: [], median: 0, peakMean: 0 };
  }
  const step = rays[1].deg - rays[0].deg;
  const bins120 = Math.round(120 / step);
  if (!(bins120 > 0)) return { score: 0, peaks: [], median: 0, peakMean: 0 };
  const sorted = rays.map((ray) => ray.length).slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let best = { score: 0, peaks: [], peakMean: 0 };
  const n = rays.length;
  for (let i = 0; i < bins120; i += 1) {
    const peaks = [i, (i + bins120) % n, (i + 2 * bins120) % n].map((index) => rays[index]);
    const peakMean = (peaks[0].length + peaks[1].length + peaks[2].length) / 3;
    const minPeak = Math.min(peaks[0].length, peaks[1].length, peaks[2].length);
    const ratio = peakMean / Math.max(median, 1);
    const even = 1 - (Math.max(...peaks.map((p) => p.length)) - minPeak)
      / Math.max(peakMean, 1);
    const score = (minPeak >= 3 && ratio >= 1.6 ? ratio : 0) * Math.max(0.25, even);
    if (score > best.score) best = { score, peaks, peakMean, median, ratio };
  }
  best.median = median;
  return best;
}

function collectDarkRunCenters(mask, width, height, minLen, maxLen, stride) {
  const points = [];
  const push = (x, y, length, axis) => {
    if (length < minLen || length > maxLen) return;
    points.push({ x, y, length, axis });
  };
  for (let y = 0; y < height; y += stride) {
    const row = y * width;
    let x = 0;
    while (x < width) {
      if (mask[row + x] !== 1) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < width && mask[row + x] === 1) x += 1;
      push((start + x - 1) / 2, y, x - start, 'h');
    }
  }
  for (let x = 0; x < width; x += stride) {
    let y = 0;
    while (y < height) {
      if (mask[y * width + x] !== 1) {
        y += 1;
        continue;
      }
      const start = y;
      while (y < height && mask[y * width + x] === 1) y += 1;
      push(x, (start + y - 1) / 2, y - start, 'v');
    }
  }
  return points;
}

function clusterHits(hits, radius, limit) {
  const sorted = hits.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const kept = [];
  const r2 = radius * radius;
  for (const hit of sorted) {
    if (kept.some((other) => {
      const dx = hit.center.x - other.center.x;
      const dy = hit.center.y - other.center.y;
      return dx * dx + dy * dy < r2;
    })) continue;
    kept.push(hit);
    if (kept.length >= limit) break;
  }
  return kept;
}

function ySpokeSeedsFromMask(mask, width, height, factor) {
  const minLen = 3;
  const maxLen = Math.max(12, Math.floor(Math.min(width, height) * 0.55));
  const stride = Math.max(2, Math.round(Math.min(width, height) / 80));
  const centers = collectDarkRunCenters(mask, width, height, minLen, maxLen, stride);
  const maxR = Math.floor(Math.min(width, height) * 0.45);
  const raw = [];
  const budget = 80;
  for (let i = 0; i < centers.length && raw.length < budget * 2; i += 1) {
    const pt = centers[i];
    const rays = spokeLengths(mask, width, height, pt.x, pt.y, maxR, 15);
    const scored = scoreYSpoke(rays);
    if (!(scored.score >= 1.7) || !(scored.peakMean >= 6)) continue;
    const short = Math.max(scored.median, 1);
    const cellFromDot = short / V1_DOT_RADIUS_CELLS;
    const cellFromSeam = scored.peakMean / FINDER_SEED_DEFAULT_N;
    const cellSize = (Number.isFinite(cellFromSeam) && cellFromSeam > 1.5
      ? 0.65 * cellFromSeam + 0.35 * cellFromDot
      : cellFromDot) * factor;
    if (!(cellSize > 1)) continue;
    raw.push({
      kind: FINDER_SEED_KIND.Y_SPOKE,
      center: { x: pt.x * factor + (factor - 1) / 2, y: pt.y * factor + (factor - 1) / 2 },
      cellSize,
      n: FINDER_SEED_DEFAULT_N,
      rotationDeg: scored.peaks[0] ? scored.peaks[0].deg : 0,
      score: scored.score,
      spoke: {
        median: scored.median,
        peakMean: scored.peakMean,
        ratio: scored.ratio,
      },
    });
    if (raw.length >= budget) break;
  }
  return clusterHits(raw, 8 * factor, 4);
}

function qrSeedsFromMask(mask, width, height, factor) {
  const hits = scanQr11311Hits(mask, width, height);
  if (hits.length === 0) return [];
  const clustered = [];
  for (const hit of hits) {
    const module = hit.module * factor;
    if (!(module >= 1)) continue;
    clustered.push({
      kind: FINDER_SEED_KIND.QR_11311,
      center: { x: hit.x * factor + (factor - 1) / 2, y: hit.y * factor + (factor - 1) / 2 },
      cellSize: module,
      module,
      n: FINDER_SEED_DEFAULT_N,
      rotationDeg: 0,
      score: 1,
      axis: hit.axis,
    });
  }
  return clusterHits(clustered, 6 * factor, 6);
}

/**
 * 축소본에서 시드를 찾고, 좌표는 원본 루마 픽셀로 되돌린다.
 */
export function detectFinderSeeds(luma, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'finder-seed',
      message: error.message,
    });
  }
  const searchMax = Number.isFinite(options.searchMaxSide)
    ? options.searchMaxSide
    : FINDER_SEED_SEARCH_MAX_SIDE;
  const reduced = downsampleLumaForSeed(luma, searchMax);
  const threshold = otsuThreshold(reduced.luma);
  if (threshold == null) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'finder-seed',
      cause: 'otsu-empty',
      diagnostics: { detectPath: null, geometryStage: null },
    });
  }
  const mask = darkMask(reduced.luma, threshold);
  const wantSpoke = options.ySpoke !== false;
  const wantQr = options.qr11311 !== false;
  const ySeeds = wantSpoke
    ? ySpokeSeedsFromMask(mask, reduced.luma.width, reduced.luma.height, reduced.factor)
    : [];
  const qrSeeds = wantQr
    ? qrSeedsFromMask(mask, reduced.luma.width, reduced.luma.height, reduced.factor)
    : [];
  const seeds = [...ySeeds, ...qrSeeds].sort((a, b) => b.score - a.score);
  return ok({
    seeds,
    diagnostics: {
      detectPath: seeds.length ? (seeds[0].kind === FINDER_SEED_KIND.Y_SPOKE
        ? FINDER_SEED_KIND.Y_SPOKE
        : FINDER_SEED_KIND.QR_11311) : null,
      geometryStage: seeds.length ? 'finder' : null,
      threshold,
      downsampleFactor: reduced.factor,
      ySpokeCount: ySeeds.length,
      qrCount: qrSeeds.length,
      searchSize: { width: reduced.luma.width, height: reduced.luma.height },
    },
  });
}

/**
 * 원본 루마에서 시드 주변을 잘라 낸다. 없는 픽셀을 만들어 올리지 않는다.
 * origin 은 크롭 → 원본 픽셀 평행이동.
 */
export function cropLumaAround(luma, seed, options = {}) {
  if (!luma || !seed || !seed.center) return null;
  const n = Number.isFinite(seed.n) && seed.n > 0 ? seed.n : FINDER_SEED_DEFAULT_N;
  const cell = Number.isFinite(seed.cellSize) && seed.cellSize > 0 ? seed.cellSize : 0;
  const pad = Number.isFinite(options.paddingFactor) ? options.paddingFactor : 1.45;
  const radius = cell > 0
    ? cell * n * pad
    : Math.min(luma.width, luma.height) * 0.35;
  if (!(radius >= 8)) return null;
  let x0 = Math.floor(seed.center.x - radius);
  let y0 = Math.floor(seed.center.y - radius);
  let x1 = Math.ceil(seed.center.x + radius);
  let y1 = Math.ceil(seed.center.y + radius);
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(luma.width, x1);
  y1 = Math.min(luma.height, y1);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < 16 || height < 16) return null;
  const data = new Float32Array(width * height);
  const alpha = luma.alpha ? new Uint8Array(width * height) : null;
  for (let y = 0; y < height; y += 1) {
    const srcRow = (y0 + y) * luma.width + x0;
    const dstRow = y * width;
    data.set(luma.data.subarray(srcRow, srcRow + width), dstRow);
    if (alpha) alpha.set(luma.alpha.subarray(srcRow, srcRow + width), dstRow);
  }
  return {
    luma: { width, height, data, alpha },
    origin: { x: x0, y: y0 },
    width,
    height,
    radius,
  };
}

export function liftPointByOrigin(point, origin) {
  if (!point || !origin) return point;
  return { x: point.x + origin.x, y: point.y + origin.y };
}

export function translateHomography(H, origin) {
  if (!(H instanceof Float64Array) || H.length < 9 || !origin) return H;
  const ox = origin.x;
  const oy = origin.y;
  const out = new Float64Array(9);
  out[0] = H[0] + ox * H[6];
  out[1] = H[1] + ox * H[7];
  out[2] = H[2] + ox * H[8];
  out[3] = H[3] + oy * H[6];
  out[4] = H[4] + oy * H[7];
  out[5] = H[5] + oy * H[8];
  out[6] = H[6];
  out[7] = H[7];
  out[8] = H[8];
  return out;
}

void EPSILON;
