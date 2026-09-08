/**
 * guarded-shape의 n=25 ranking 직전 절단면.
 * 원본 private probe의 baseline + hist-bipolar-cc 후보 정책을 그대로 보존하되
 * 둘 중 하나를 고르지 않고, 만들어진 모든 6점을 원화소 좌표로 반환한다.
 */

import { selectThreeQuantilesInPlace } from './quantile-select.js';

const DEG = Math.PI / 180;
const THRESH = (p50, p99) => p99 + Math.max(0.01, (p99 - p50) * 2);
const THRESH_LO = (p50, p1) => p1 - Math.max(0.01, (p50 - p1) * 2);
const MIN_BLOB_FRAC = 0.002;

function hullOf(points) {
  const pointsSorted = points.slice().sort((left, right) =>
    left.x - right.x || left.y - right.y);
  const cross = (origin, left, right) =>
    (left.x - origin.x) * (right.y - origin.y)
    - (left.y - origin.y) * (right.x - origin.x);
  const lower = [];
  const upper = [];
  for (const point of pointsSorted) {
    while (lower.length >= 2
      && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  for (let index = pointsSorted.length - 1; index >= 0; index -= 1) {
    const point = pointsSorted[index];
    while (upper.length >= 2
      && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
function hexFromHull(hull) {
  const segments = [];
  for (let index = 0; index < hull.length; index += 1) {
    const left = hull[index];
    const right = hull[(index + 1) % hull.length];
    const length = Math.hypot(right.x - left.x, right.y - left.y);
    if (length < 1e-9) continue;
    segments.push({ left, right, length,
      angle: Math.atan2(right.y - left.y, right.x - left.x) });
  }
  if (segments.length < 6) return null;
  const angleDifference = (left, right) => {
    let delta = left - right;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    return Math.abs(delta);
  };
  const seeds = [];
  for (const segment of segments.slice().sort((left, right) =>
    right.length - left.length)) {
    if (seeds.length === 6) break;
    if (seeds.every((seed) => angleDifference(segment.angle, seed) > 25 * DEG)) {
      seeds.push(segment.angle);
    }
  }
  if (seeds.length < 6) return null;
  let centers = seeds.slice();
  let groups = null;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    groups = centers.map(() => []);
    for (const segment of segments) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < 6; index += 1) {
        const distance = angleDifference(segment.angle, centers[index]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      groups[bestIndex].push(segment);
    }
    centers = groups.map((group, index) => {
      if (group.length === 0) return centers[index];
      let x = 0;
      let y = 0;
      for (const segment of group) {
        x += Math.cos(segment.angle) * segment.length;
        y += Math.sin(segment.angle) * segment.length;
      }
      return Math.atan2(y, x);
    });
  }
  const lines = [];
  for (let index = 0; index < 6; index += 1) {
    const group = groups[index];
    if (group.length === 0) return null;
    const sorted = group.slice().sort((left, right) => right.length - left.length);
    const used = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.6)));
    const weightedPoints = [];
    for (const segment of used) {
      weightedPoints.push([segment.left, segment.length / 2],
        [segment.right, segment.length / 2]);
    }
    let weightSum = 0;
    let meanX = 0;
    let meanY = 0;
    for (const [point, weight] of weightedPoints) {
      weightSum += weight;
      meanX += point.x * weight;
      meanY += point.y * weight;
    }
    meanX /= weightSum;
    meanY /= weightSum;
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (const [point, weight] of weightedPoints) {
      const dx = point.x - meanX;
      const dy = point.y - meanY;
      xx += weight * dx * dx;
      xy += weight * dx * dy;
      yy += weight * dy * dy;
    }
    const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
    lines.push({ x: meanX, y: meanY, dx: Math.cos(theta), dy: Math.sin(theta),
      angle: centers[index], span: sorted.reduce((sum, segment) => sum + segment.length, 0) });
  }
  lines.sort((left, right) => left.angle - right.angle);
  const vertices = [];
  for (let index = 0; index < 6; index += 1) {
    const left = lines[index];
    const right = lines[(index + 1) % 6];
    const denominator = left.dx * right.dy - left.dy * right.dx;
    if (Math.abs(denominator) < 1e-12) return null;
    const t = ((right.x - left.x) * right.dy - (right.y - left.y) * right.dx)
      / denominator;
    vertices.push({ x: left.x + left.dx * t, y: left.y + left.dy * t });
  }
  return { vertices, lineSpans: lines.map((line) => line.span) };
}

function quantiles(sorted) {
  const at = (fraction) => sorted[Math.floor(fraction * (sorted.length - 1))];
  return { p1: at(0.01), p50: at(0.5), p99: at(0.99), count: sorted.length };
}

function frameStats(luma, bins = 1024) {
  const histogram = new Int32Array(bins);
  for (let index = 0; index < luma.data.length; index += 1) {
    let bin = Math.floor(luma.data[index] * bins);
    if (bin < 0) bin = 0;
    if (bin >= bins) bin = bins - 1;
    histogram[bin] += 1;
  }
  return { histogram, bins, total: luma.data.length };
}

function modeBasin(stats, floorFraction = 0.10) {
  const smoothed = new Float64Array(stats.bins);
  for (let index = 0; index < stats.bins; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const nearby = index + offset;
      if (nearby < 0 || nearby >= stats.bins) continue;
      sum += stats.histogram[nearby];
      count += 1;
    }
    smoothed[index] = sum / count;
  }
  let mode = 0;
  for (let index = 1; index < stats.bins; index += 1) {
    if (smoothed[index] > smoothed[mode]) mode = index;
  }
  const floor = floorFraction * smoothed[mode];
  let left = mode;
  let right = mode;
  while (left > 0 && smoothed[left - 1] >= floor) left -= 1;
  while (right < stats.bins - 1 && smoothed[right + 1] >= floor) right += 1;
  let count = 0;
  for (let index = left; index <= right; index += 1) count += stats.histogram[index];
  return { mode, left, right, low: left / stats.bins,
    high: (right + 1) / stats.bins, count };
}

function histogramBackground(luma) {
  const basin = modeBasin(frameStats(luma));
  const pool = new Float64Array(basin.count);
  let used = 0;
  for (let index = 0; index < luma.data.length; index += 1) {
    const value = luma.data[index];
    if (value >= basin.low && value < basin.high && used < pool.length) {
      pool[used] = value;
      used += 1;
    }
  }
  const values = used === pool.length ? pool : pool.slice(0, used);
  return { basin, quantiles: selectThreeQuantilesInPlace(values) };
}

function backgroundThreshold(luma, band = 12) {
  const ring = [];
  for (let y = 0; y < luma.height; y += 1) {
    for (let x = 0; x < luma.width; x += 1) {
      if (x < band || y < band || x >= luma.width - band || y >= luma.height - band) {
        ring.push(luma.data[y * luma.width + x]);
      }
    }
  }
  const q = selectThreeQuantilesInPlace(ring);
  return { p50: q.p50, p99: q.p99, threshold: THRESH(q.p50, q.p99) };
}

function blobScore(luma, threshold, polarity) {
  const columnCounts = new Int32Array(luma.width);
  const rowCounts = new Int32Array(luma.height);
  let count = 0;
  for (let y = 0; y < luma.height; y += 1) {
    for (let x = 0; x < luma.width; x += 1) {
      const value = luma.data[y * luma.width + x];
      if (polarity > 0 ? !(value > threshold) : !(value < threshold)) continue;
      count += 1;
      columnCounts[x] += 1;
      rowCounts[y] += 1;
    }
  }
  if (count === 0) return { fraction: 0, boxFraction: 0, fill: 0 };
  const percentileIndex = (counts, fraction) => {
    const wanted = fraction * count;
    let accumulated = 0;
    for (let index = 0; index < counts.length; index += 1) {
      accumulated += counts[index];
      if (accumulated >= wanted) return index;
    }
    return counts.length - 1;
  };
  const x0 = percentileIndex(columnCounts, 0.05);
  const x1 = percentileIndex(columnCounts, 0.95);
  const y0 = percentileIndex(rowCounts, 0.05);
  const y1 = percentileIndex(rowCounts, 0.95);
  const boxFraction = ((x1 - x0 + 1) * (y1 - y0 + 1))
    / (luma.width * luma.height);
  const fraction = count / (luma.width * luma.height);
  return { fraction, boxFraction, fill: boxFraction > 0 ? fraction / boxFraction : 0 };
}

function histogramBipolarEstimator(luma) {
  const background = histogramBackground(luma);
  const highThreshold = THRESH(background.quantiles.p50, background.quantiles.p99);
  const lowThreshold = THRESH_LO(background.quantiles.p50, background.quantiles.p1);
  const high = blobScore(luma, highThreshold, 1);
  const low = blobScore(luma, lowThreshold, -1);
  const highOk = high.fraction >= MIN_BLOB_FRAC;
  const lowOk = low.fraction >= MIN_BLOB_FRAC;
  let polarity = 1;
  let chosenBy = 'neither-qualifies-to-bright';
  if (highOk && lowOk) {
    polarity = low.fill > high.fill ? -1 : 1;
    chosenBy = 'fill';
  } else if (lowOk) {
    polarity = -1;
    chosenBy = 'only-dark';
  } else if (highOk) {
    polarity = 1;
    chosenBy = 'only-bright';
  }
  return { threshold: polarity > 0 ? highThreshold : lowThreshold,
    polarity, chosenBy, high, low,
    basin: { low: background.basin.low, high: background.basin.high } };
}

function silhouetteHex(luma, threshold, polarity, largestComponentOnly) {
  const foreground = (value) => (polarity > 0 ? value > threshold : value < threshold);
  let kept = null;
  if (largestComponentOnly) {
    const labels = new Int32Array(luma.width * luma.height);
    const parents = [0];
    const find = (label) => {
      let root = label;
      while (parents[root] !== root) root = parents[root];
      let cursor = label;
      while (parents[cursor] !== cursor) {
        const next = parents[cursor];
        parents[cursor] = root;
        cursor = next;
      }
      return root;
    };
    const union = (left, right) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parents[Math.max(leftRoot, rightRoot)]
        = Math.min(leftRoot, rightRoot);
    };
    let nextLabel = 1;
    for (let y = 0; y < luma.height; y += 1) {
      for (let x = 0; x < luma.width; x += 1) {
        const index = y * luma.width + x;
        if (!foreground(luma.data[index])) continue;
        const up = y > 0 && foreground(luma.data[index - luma.width])
          ? labels[index - luma.width] : 0;
        const left = x > 0 && foreground(luma.data[index - 1]) ? labels[index - 1] : 0;
        if (up && left) {
          labels[index] = Math.min(up, left);
          union(up, left);
        } else if (up) labels[index] = up;
        else if (left) labels[index] = left;
        else {
          parents[nextLabel] = nextLabel;
          labels[index] = nextLabel;
          nextLabel += 1;
        }
      }
    }
    const sizes = new Int32Array(nextLabel);
    for (let index = 0; index < labels.length; index += 1) {
      if (!labels[index]) continue;
      const root = find(labels[index]);
      labels[index] = root;
      sizes[root] += 1;
    }
    let best = 0;
    for (let root = 1; root < nextLabel; root += 1) {
      if (sizes[root] > sizes[best]) best = root;
    }
    if (!best) return { stage: 'too-few-edge-points', hex: null,
      foregroundPixels: 0, edgePoints: 0, hullLength: null,
      componentSize: 0, componentCount: 0 };
    let componentCount = 0;
    for (let root = 1; root < nextLabel; root += 1) {
      if (sizes[root] > 0) componentCount += 1;
    }
    kept = { labels, best, size: sizes[best], count: componentCount };
  }
  const edgePoints = [];
  let foregroundPixels = 0;
  for (let y = 0; y < luma.height; y += 1) {
    let lowX = -1;
    let highX = -1;
    for (let x = 0; x < luma.width; x += 1) {
      const index = y * luma.width + x;
      if (!foreground(luma.data[index])) continue;
      if (kept && kept.labels[index] !== kept.best) continue;
      foregroundPixels += 1;
      if (lowX < 0) lowX = x;
      highX = x;
    }
    if (lowX >= 0) {
      edgePoints.push({ x: lowX, y });
      if (highX !== lowX) edgePoints.push({ x: highX, y });
    }
  }
  const common = { foregroundPixels, edgePoints: edgePoints.length,
    componentSize: kept ? kept.size : null, componentCount: kept ? kept.count : null };
  if (edgePoints.length < 12) return { ...common, stage: 'too-few-edge-points',
    hex: null, hullLength: null };
  const hull = hullOf(edgePoints);
  if (hull.length < 6) return { ...common, stage: 'hull<6', hex: null,
    hullLength: hull.length };
  const hex = hexFromHull(hull);
  return { ...common, stage: hex ? 'hex-built' : 'hex-from-hull-null',
    hex, hullLength: hull.length };
}

function rawCandidate(preRankingIndex, policyArm, extraction, estimator) {
  if (!extraction.hex) return null;
  const vertices = extraction.hex.vertices.map((point) => ({ x: point.x, y: point.y }));
  const center = {
    x: vertices.reduce((sum, point) => sum + point.x, 0) / 6,
    y: vertices.reduce((sum, point) => sum + point.y, 0) / 6,
  };
  const radius = vertices.reduce((sum, point) =>
    sum + Math.hypot(point.x - center.x, point.y - center.y), 0) / 6;
  return {
    preRankingIndex,
    policyArm,
    vertices,
    center,
    radius,
    provenance: {
      pixelOrigin: 'original full-resolution luma samples',
      foregroundRule: estimator.polarity > 0 ? 'luma > threshold' : 'luma < threshold',
      threshold: estimator.threshold,
      polarity: estimator.polarity,
      componentPolicy: policyArm === 'hist-bipolar-cc' ? 'largest 4-connected component' : 'all foreground',
      edgeSamples: 'leftmost and rightmost kept foreground pixel per image row',
      cornerConstruction: 'weighted total-least-squares line fit per hull-direction cluster, then adjacent line intersections',
      homographyRegeneration: false,
    },
    diagnostics: {
      stage: extraction.stage,
      foregroundPixels: extraction.foregroundPixels,
      pixelExtrema: {
        construction: 'leftmost and rightmost kept foreground pixel per image row',
        count: extraction.edgePoints,
      },
      edgePoints: extraction.edgePoints,
      hullLength: extraction.hullLength,
      componentSize: extraction.componentSize,
      componentCount: extraction.componentCount,
      tlsIntersections: {
        construction: 'weighted total-least-squares hull lines, adjacent intersections',
        count: extraction.hex.vertices.length,
      },
      lineSpans: extraction.hex.lineSpans,
    },
  };
}

export function detectSeedlessBgLinefitCandidates(luma) {
  if (!luma || !Number.isInteger(luma.width) || !Number.isInteger(luma.height)
    || luma.width <= 0 || luma.height <= 0
    || !luma.data || luma.data.length !== luma.width * luma.height) {
    throw new TypeError('유효한 LumaField가 필요하다');
  }
  const started = performance.now();
  const baselineEstimate = { ...backgroundThreshold(luma), polarity: 1 };
  const baselineStarted = performance.now();
  const baseline = silhouetteHex(luma, baselineEstimate.threshold, 1, false);
  const baselineMs = performance.now() - baselineStarted;
  const histogramStarted = performance.now();
  const bipolarEstimate = histogramBipolarEstimator(luma);
  const bipolar = silhouetteHex(luma, bipolarEstimate.threshold,
    bipolarEstimate.polarity, true);
  const bipolarMs = performance.now() - histogramStarted;
  const candidates = [
    rawCandidate(0, 'baseline', baseline, baselineEstimate),
    rawCandidate(1, 'hist-bipolar-cc', bipolar, bipolarEstimate),
  ].filter(Boolean);
  return {
    ok: true,
    source: {
      kind: 'seedless-bg-linefit-pre-ranking',
      candidatePolicy: ['baseline', 'hist-bipolar-cc'],
      ranking: 'none; every constructed pre-ranking candidate is emitted',
      nLayoutFormatBodyInputs: false,
    },
    candidates,
    diagnostics: {
      measuredArms: 2,
      emittedCandidates: candidates.length,
      arms: [
        { policyArm: 'baseline', stage: baseline.stage, emitted: Boolean(baseline.hex),
          ms: baselineMs },
        { policyArm: 'hist-bipolar-cc', stage: bipolar.stage, emitted: Boolean(bipolar.hex),
          polarity: bipolarEstimate.polarity, chosenBy: bipolarEstimate.chosenBy,
          ms: bipolarMs },
      ],
      elapsedMs: performance.now() - started,
    },
  };
}
