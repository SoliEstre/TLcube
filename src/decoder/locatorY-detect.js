/**
 * locatorY-detect.js — Type Y hex-frame-v1 로케이터 제안.
 *
 * 페이로드를 읽지 않는다. 외곽 이중 육각 + 중앙 C형 3팔 허브에서 실루엣 꼭짓점을
 * 추려 기존 cube-detect 의 포맷·레퍼런스·RS 경로에 넘긴다.
 *
 * C형 고리의 열린 변은 60° 회전 위상을 제안한다. 갭 신뢰도가 낮으면 후보의
 * seamParity 와 orientation 3개를 기존과 같이 검증한다.
 *
 * 모든 임계값은 합성 실험용 [미검증]이며 options.calibration 으로 덮을 수 있다.
 */

import { CORNER_UNIT_OFFSETS } from '../hexgrid.js';
import {
  HEX_FRAME_V1,
  LOCATOR_PROFILE_HEX_FRAME_V1,
  LOCATOR_PROFILE_OFF,
  cubeRadiusFromInnerDarkInner,
  cubeRadiusFromOuterDarkOuter,
  locatorInnerDarkInnerCells,
  locatorOuterDarkOuterCells,
} from '../locatorY.js';
import {
  FRONTEND_FAILURE,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';

export const UNVERIFIED_LOCATOR_Y = Object.freeze({
  maxDimension: 1024,
  darkAbsolute: 0.34,
  darkSpanFraction: 0.10,
  minimumComponentPixels: 36,
  maximumComponentAreaFraction: 0.55,
  minimumComponentAreaFraction: 0.0008,
  maximumComponents: 20,
  minimumRingFill: 0.018,
  maximumRingFill: 0.42,
  maximumRadiusCv: 0.11,
  minimumDoubleLineRays: 4,
  minimumHubRays: 2,
  minimumHubContrast: 0.012,
  minimumLineContrast: 0.018,
  maximumQrFinderHits: 8,
  maximumShapeCandidates: 4,
});

const EPSILON = 1e-9;
const SUPPORTED_N = Object.freeze([13, 21, 25]);

function calibration(options) {
  const supplied = options && options.calibration && typeof options.calibration === 'object'
    ? options.calibration
    : {};
  const locator = supplied.locatorY && typeof supplied.locatorY === 'object'
    ? supplied.locatorY
    : {};
  return { ...UNVERIFIED_LOCATOR_Y, ...locator };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function bilinear(luma, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || y < 0 || x > luma.width - 1 || y > luma.height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(luma.width - 1, x0 + 1);
  const y1 = Math.min(luma.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = luma.data[y0 * luma.width + x0];
  const b = luma.data[y0 * luma.width + x1];
  const c = luma.data[y1 * luma.width + x0];
  const d = luma.data[y1 * luma.width + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty)
    + (c * (1 - tx) + d * tx) * ty;
}

function lumaSpan(luma) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < luma.data.length; i += 1) {
    const v = luma.data[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
}

function lumaMedian(luma) {
  const copy = Array.from(luma.data).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (copy.length === 0) return 0.5;
  return copy[copy.length >> 1];
}

function downsampleLuma(luma, maxDimension) {
  const factor = Math.max(1, Math.ceil(Math.max(luma.width, luma.height) / maxDimension));
  if (factor === 1) return { luma, factor };
  const width = Math.ceil(luma.width / factor);
  const height = Math.ceil(luma.height / factor);
  const data = new Float32Array(width * height);
  const alpha = luma.alpha ? new Uint8Array(width * height) : null;
  for (let y = 0; y < height; y += 1) {
    const y0 = y * factor;
    const y1 = Math.min(luma.height, y0 + factor);
    for (let x = 0; x < width; x += 1) {
      const x0 = x * factor;
      const x1 = Math.min(luma.width, x0 + factor);
      let sum = 0;
      let count = 0;
      let aSum = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const idx = yy * luma.width + xx;
          if (luma.alpha && luma.alpha[idx] === 0) continue;
          sum += luma.data[idx];
          count += 1;
          if (alpha) aSum += luma.alpha[idx];
        }
      }
      const o = y * width + x;
      data[o] = count ? sum / count : 1;
      if (alpha) alpha[o] = count ? Math.round(aSum / count) : 0;
    }
  }
  return { luma: { width, height, data, alpha }, factor };
}

function darkMask(luma, cfg) {
  const span = Math.max(lumaSpan(luma), EPSILON);
  const med = lumaMedian(luma);
  const cut = Math.min(cfg.darkAbsolute, med - cfg.darkSpanFraction * span);
  const mask = new Uint8Array(luma.data.length);
  for (let i = 0; i < luma.data.length; i += 1) {
    if (luma.alpha && luma.alpha[i] === 0) continue;
    mask[i] = luma.data[i] <= cut ? 1 : 0;
  }
  return mask;
}

function closeMask(mask, width, height) {
  const dilated = new Uint8Array(mask.length);
  const closed = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let on = 0;
      for (let oy = -1; oy <= 1 && !on; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (mask[(y + oy) * width + x + ox]) { on = 1; break; }
        }
      }
      dilated[y * width + x] = on;
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let on = 1;
      for (let oy = -1; oy <= 1 && on; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (!dilated[(y + oy) * width + x + ox]) { on = 0; break; }
        }
      }
      closed[y * width + x] = on;
    }
  }
  return closed;
}

function connectedComponents(mask, width, height, cfg) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  const minimum = Math.max(
    cfg.minimumComponentPixels,
    Math.floor(mask.length * cfg.minimumComponentAreaFraction),
  );
  const maximum = Math.floor(mask.length * cfg.maximumComponentAreaFraction);
  const queue = new Int32Array(mask.length);

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const boundary = [];
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      let edge = false;
      const tryN = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) { edge = true; return; }
        const ni = ny * width + nx;
        if (!mask[ni]) { edge = true; return; }
        if (!visited[ni]) { visited[ni] = 1; queue[tail++] = ni; }
      };
      tryN(x + 1, y);
      tryN(x - 1, y);
      tryN(x, y + 1);
      tryN(x, y - 1);
      if (edge) boundary.push({ x, y });
    }
    if (area < minimum || area > maximum) continue;
    components.push({
      area,
      boundary,
      bounds: { minX, minY, maxX, maxY },
    });
    if (components.length >= cfg.maximumComponents) break;
  }
  return components;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(points) {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const n = points[(i + 1) % points.length];
    twice += points[i].x * n.y - n.x * points[i].y;
  }
  return twice / 2;
}

function simplifyHullToHex(hull) {
  const points = hull.slice();
  while (points.length > 6) {
    let remove = 0;
    let cost = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[(i + points.length - 1) % points.length];
      const cur = points[i];
      const next = points[(i + 1) % points.length];
      const triangle = Math.abs(cross(prev, cur, next));
      const span = Math.hypot(next.x - prev.x, next.y - prev.y);
      const normalized = triangle / Math.max(span, EPSILON);
      if (normalized < cost) {
        cost = normalized;
        remove = i;
      }
    }
    points.splice(remove, 1);
  }
  if (points.length !== 6) return null;
  if (polygonArea(points) < 0) points.reverse();
  return points;
}

function hexStats(vertices) {
  const cx = vertices.reduce((s, p) => s + p.x, 0) / 6;
  const cy = vertices.reduce((s, p) => s + p.y, 0) / 6;
  const radii = vertices.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const mean = radii.reduce((s, r) => s + r, 0) / 6;
  let varSum = 0;
  for (const r of radii) varSum += (r - mean) * (r - mean);
  const cv = Math.sqrt(varSum / 6) / Math.max(mean, EPSILON);
  return { center: { x: cx, y: cy }, radius: mean, radiusCv: cv };
}

function sampleRay(luma, center, ux, uy, r0, r1, steps) {
  const samples = [];
  for (let i = 0; i < steps; i += 1) {
    const t = r0 + ((r1 - r0) * i) / (steps - 1);
    const v = bilinear(luma, center.x + ux * t, center.y + uy * t);
    if (v !== null) samples.push({ t, v });
  }
  return samples;
}

function findDoubleLine(samples, span) {
  if (samples.length < 8) return null;
  const peaks = [];
  for (let i = 2; i < samples.length - 2; i += 1) {
    const v = samples[i].v;
    if (v <= samples[i - 1].v && v <= samples[i + 1].v
      && v + 0.004 * span < (samples[i - 2].v + samples[i + 2].v) / 2) {
      peaks.push(samples[i]);
    }
  }
  if (peaks.length < 2) return null;
  let best = null;
  for (let i = 0; i < peaks.length - 1; i += 1) {
    for (let j = i + 1; j < peaks.length; j += 1) {
      const a = peaks[i];
      const b = peaks[j];
      const midT = (a.t + b.t) / 2;
      let midV = null;
      let nearest = Infinity;
      for (const s of samples) {
        const d = Math.abs(s.t - midT);
        if (d < nearest) { nearest = d; midV = s.v; }
      }
      if (midV === null) continue;
      const contrast = midV - (a.v + b.v) / 2;
      if (contrast < 0.01 * span) continue;
      const gap = Math.abs(b.t - a.t);
      if (!(gap > 0)) continue;
      const score = contrast / span - Math.abs(gap / Math.max(a.t, EPSILON) - 0.06);
      if (!best || score > best.score) {
        best = {
          innerT: Math.min(a.t, b.t),
          outerT: Math.max(a.t, b.t),
          contrast: contrast / span,
          gap,
          score,
        };
      }
    }
  }
  return best;
}

function doubleLineReport(luma, center, vertices, span) {
  const stats = hexStats(vertices);
  const rays = [];
  for (let i = 0; i < 6; i += 1) {
    const vx = vertices[i].x - center.x;
    const vy = vertices[i].y - center.y;
    const len = Math.hypot(vx, vy);
    if (!(len > 2)) continue;
    const ux = vx / len;
    const uy = vy / len;
    const samples = sampleRay(luma, center, ux, uy, len * 0.55, len * 1.12, 36);
    const hit = findDoubleLine(samples, span);
    if (hit) rays.push({ ...hit, ux, uy });
  }
  return {
    count: rays.length,
    rays,
    meanInner: rays.length
      ? rays.reduce((s, r) => s + r.innerT, 0) / rays.length
      : 0,
    meanOuter: rays.length
      ? rays.reduce((s, r) => s + r.outerT, 0) / rays.length
      : 0,
    radius: stats.radius,
  };
}

function hubReport(luma, center, vertices, span) {
  const stats = hexStats(vertices);
  const reports = [];
  for (let parity = 0; parity < 2; parity += 1) {
    let contrastSum = 0;
    let support = 0;
    let rays = 0;
    for (let k = 0; k < 3; k += 1) {
      const endpoint = vertices[(parity + 2 * k) % 6];
      const dx = endpoint.x - center.x;
      const dy = endpoint.y - center.y;
      const len = Math.hypot(dx, dy);
      if (!(len > 4)) continue;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;
      const offset = Math.max(1.1, stats.radius * 0.012);
      const contrasts = [];
      for (let step = 0; step < 10; step += 1) {
        const t = 0.04 + (0.12 * step) / 9;
        const x = center.x + ux * stats.radius * t;
        const y = center.y + uy * stats.radius * t;
        const mid = bilinear(luma, x, y);
        const left = bilinear(luma, x + px * offset, y + py * offset);
        const right = bilinear(luma, x - px * offset, y - py * offset);
        if (mid === null || left === null || right === null) continue;
        contrasts.push(((left + right) / 2) - mid);
      }
      if (contrasts.length === 0) continue;
      const med = contrasts.slice().sort((a, b) => a - b)[contrasts.length >> 1];
      const c = med / span;
      contrastSum += c;
      if (c >= UNVERIFIED_LOCATOR_Y.minimumHubContrast) support += 1;
      rays += 1;
    }
    reports.push({
      parity,
      contrast: rays ? contrastSum / rays : 0,
      support,
      rays,
    });
  }
  reports.sort((a, b) => b.contrast - a.contrast || b.support - a.support);
  return reports[0];
}

function hubGapReport(luma, center, ringVertices, span, n) {
  if (!SUPPORTED_N.includes(n) || !Array.isArray(ringVertices) || ringVertices.length !== 6) {
    return null;
  }
  const outerExtent = locatorOuterDarkOuterCells(n);
  const hubRadius = (HEX_FRAME_V1.hubRingInner + HEX_FRAME_V1.hubRingOuter) / 2;
  const scale = hubRadius / Math.max(outerExtent, EPSILON);
  const samples = [];
  for (let edge = 0; edge < 6; edge += 1) {
    const a = ringVertices[edge];
    const b = ringVertices[(edge + 1) % 6];
    const pa = {
      x: center.x + (a.x - center.x) * scale,
      y: center.y + (a.y - center.y) * scale,
    };
    const pb = {
      x: center.x + (b.x - center.x) * scale,
      y: center.y + (b.y - center.y) * scale,
    };
    const values = [0.35, 0.5, 0.65].map((t) => bilinear(
      luma,
      pa.x + (pb.x - pa.x) * t,
      pa.y + (pb.y - pa.y) * t,
    )).filter((value) => value !== null);
    samples.push(values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : -Infinity);
  }
  const ranked = samples.map((value, edge) => ({ edge, value }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((left, right) => right.value - left.value);
  if (ranked.length < 6) return null;
  const gap = ranked[0];
  const contrast = (gap.value - ranked[1].value) / Math.max(span, EPSILON);
  const reliable = contrast >= 0.025;
  return {
    gapEdge: gap.edge,
    canonicalGapEdge: HEX_FRAME_V1.hubGapSide,
    phaseShift: ((gap.edge - HEX_FRAME_V1.hubGapSide) % 6 + 6) % 6,
    confidence: clamp01(contrast / 0.12),
    contrast,
    reliable,
  };
}

function countQrLikeFinders(luma, span) {
  // 1:1:3:1:1 가로 스캔. QR/바코드가 로케이터로 승격되지 않게 한다.
  const { width, height, data } = luma;
  const cut = 0.45;
  let hits = 0;
  const stepY = Math.max(2, Math.floor(height / 48));
  for (let y = stepY; y < height - stepY; y += stepY) {
    const runs = [];
    let x = 0;
    while (x < width) {
      const dark = data[y * width + x] < cut;
      let x1 = x + 1;
      while (x1 < width && (data[y * width + x1] < cut) === dark) x1 += 1;
      runs.push({ dark, len: x1 - x });
      x = x1;
    }
    for (let i = 0; i + 4 < runs.length; i += 1) {
      const w = runs.slice(i, i + 5);
      if (!(w[0].dark && !w[1].dark && w[2].dark && !w[3].dark && w[4].dark)) continue;
      const u = (w[0].len + w[1].len + w[3].len + w[4].len) / 4;
      if (!(u >= 2)) continue;
      const r0 = w[0].len / u;
      const r1 = w[1].len / u;
      const r2 = w[2].len / u;
      const r3 = w[3].len / u;
      const r4 = w[4].len / u;
      if (Math.abs(r0 - 1) < 0.55 && Math.abs(r1 - 1) < 0.55
        && Math.abs(r2 - 3) < 1.1 && Math.abs(r3 - 1) < 0.55
        && Math.abs(r4 - 1) < 0.55) {
        hits += 1;
      }
    }
  }
  return hits;
}

function cubeVerticesFromRing(center, ringVertices, innerRadius, n) {
  const cubeR = innerRadius > 0
    ? cubeRadiusFromInnerDarkInner(innerRadius, n)
    : cubeRadiusFromOuterDarkOuter(hexStats(ringVertices).radius, n);
  if (!(cubeR > 0)) return null;
  return CORNER_UNIT_OFFSETS.map((u, i) => {
    const ring = ringVertices[i];
    const dx = ring.x - center.x;
    const dy = ring.y - center.y;
    const len = Math.hypot(dx, dy);
    if (!(len > EPSILON)) {
      return { x: center.x + u.x * cubeR, y: center.y + u.y * cubeR };
    }
    const scale = cubeR / len;
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  });
}

/**
 * ring vertices 를 canonical CORNER_UNIT_OFFSETS 순서에 맞춰 재정렬한다.
 * 회전된 이미지에서도 올바른 인덱스 매핑을 보장한다.
 * 반환: { aligned: 재정렬된 6개 꼭짓점, offset: 원본→정렬 시작 인덱스 }.
 */
function alignVerticesToCanonical(vertices, center) {
  if (vertices.length !== 6) return { aligned: vertices, offset: 0 };
  // 각 꼭짓점의 중심 기준 각도.
  const angles = vertices.map((v) => Math.atan2(v.y - center.y, v.x - center.x));
  // C0 = (0, -1) 의 각도 = -π/2.
  const c0Angle = -Math.PI / 2;
  // C0 에 가장 가까운 각도의 꼭짓점을 찾는다.
  let bestStart = 0;
  let bestDist = Infinity;
  for (let i = 0; i < 6; i += 1) {
    let diff = angles[i] - c0Angle;
    if (diff > Math.PI) diff -= 2 * Math.PI;
    if (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) < bestDist) {
      bestDist = Math.abs(diff);
      bestStart = i;
    }
  }
  // bestStart 부터 시작하는 순환. 양 winding 을 시도해 canonical 각도 합산 오차가 작은 쪽을 취한다.
  const ccw = [];
  const cw = [];
  for (let k = 0; k < 6; k += 1) {
    ccw.push(vertices[(bestStart + k) % 6]);
    cw.push(vertices[(bestStart - k + 6) % 6]);
  }
  const canonAngles = CORNER_UNIT_OFFSETS.map((u) => Math.atan2(u.y, u.x));
  const angleDist = (arr) => {
    let sum = 0;
    for (let i = 0; i < 6; i += 1) {
      let diff = Math.atan2(arr[i].y - center.y, arr[i].x - center.x) - canonAngles[i];
      if (diff > Math.PI) diff -= 2 * Math.PI;
      if (diff < -Math.PI) diff += 2 * Math.PI;
      sum += diff * diff;
    }
    return sum;
  };
  const useCcw = angleDist(ccw) <= angleDist(cw);
  const aligned = useCcw ? ccw : cw;
  // offset: aligned[0] 이 원본 vertices 의 몇 번째인지.
  const offset = vertices.indexOf(aligned[0]);
  return { aligned, offset: offset >= 0 ? offset : 0 };
}

function emitCandidate(source, componentIndex, center, ringVertices, doubleLine, hub, span) {
  const { aligned, offset } = alignVerticesToCanonical(ringVertices, center);
  // hub.parity 는 원본 ringVertices 순서 기준. aligned 는 offset 만큼 회전된 순서이므로 보정한다.
  const adjustedParity = ((hub.parity - offset) % 6 + 6) % 6;
  const innerR = doubleLine.meanInner > 0 ? doubleLine.meanInner : hexStats(aligned).radius;
  const nGuess = SUPPORTED_N.reduce((best, n) => {
    const expected = locatorInnerDarkInnerCells(n);
    const ratio = innerR / Math.max(expected, EPSILON);
    // n 자체는 픽셀이 아니라 셀. 비율의 절대값은 셀 크기. 여기서는 n 후보 간
    // 기하 정합만 나중에 hypothesesFromShapes 가 본다. 추정 n 은 진단용.
    const err = Math.abs((locatorOuterDarkOuterCells(n) / expected)
      - (doubleLine.meanOuter || innerR) / Math.max(innerR, EPSILON));
    if (!best || err < best.err) return { n, err };
    return best;
  }, null);
  const cubeVerts = cubeVerticesFromRing(center, aligned, innerR, nGuess ? nGuess.n : 13);
  if (!cubeVerts) return null;
  const stats = hexStats(cubeVerts);
  const score = clamp01(
    0.34 * (doubleLine.count / 6)
    + 0.28 * clamp01(hub.contrast / 0.04)
    + 0.20 * (hub.support / 3)
    + 0.18 * (1 - Math.min(1, hexStats(aligned).radiusCv / 0.12)),
  );
  const hubConfirmed = hub.support >= UNVERIFIED_LOCATOR_Y.minimumHubRays
    || (hub.support >= 1
      && hub.contrast >= UNVERIFIED_LOCATOR_Y.minimumHubContrast * 1.5);
  const lineConfirmed = doubleLine.count >= UNVERIFIED_LOCATOR_Y.minimumDoubleLineRays;
  return {
    componentIndex,
    componentSource: source,
    center: stats.center,
    vertices: cubeVerts,
    ringVertices: aligned,
    seamParity: adjustedParity,
    seamParityAlternative: false,
    junctionEvidenceParity: adjustedParity,
    seamVertices: [0, 1, 2].map((index) => cubeVerts[(adjustedParity + 2 * index) % 6]),
    radius: stats.radius,
    maskFill: 0.2,
    concurrencyResidual: hexStats(aligned).radiusCv,
    seam: { contrast: hub.contrast, support: hub.support / 3, positiveRayCount: hub.support },
    otherParitySeam: { contrast: 0, support: 0, positiveRayCount: 0 },
    parityMargin: Math.max(0.001, hub.contrast),
    hardChecks: {
      hexSilhouette: true,
      diagonalConcurrency: hexStats(aligned).radiusCv <= 0.12,
      yJunction: hubConfirmed,
      locatorDoubleLine: lineConfirmed,
      all: hubConfirmed && lineConfirmed,
    },
    score,
    locatorProfile: LOCATOR_PROFILE_HEX_FRAME_V1,
    locatorRoute: 'hex-frame',
    estimatedN: nGuess && nGuess.n,
  };
}

/**
 * 실루엣 육각이 바깥 테두리일 때, 알려진 셀 비율로 큐브 꼭짓점으로 줄인다.
 * 이중 획+허브가 확인되지 않으면 null.
 */
export function shrinkSilhouetteToCubeCandidates(luma, shape, options = {}) {
  const trace = Array.isArray(options.locatorYDiagnostics) ? options.locatorYDiagnostics : null;
  const reject = (stage, detail = undefined) => {
    if (trace) trace.push({
      stage,
      componentSource: shape && shape.componentSource,
      componentIndex: shape && shape.componentIndex,
      ...(detail || {}),
    });
    return [];
  };
  if (!shape || !shape.vertices || shape.vertices.length !== 6) return reject('invalid-shape');
  const cfg = calibration(options);
  const span = Math.max(lumaSpan(luma), EPSILON);
  const center = shape.center;
  const vertices = shape.vertices;
  const doubleLine = doubleLineReport(luma, center, vertices, span);
  if (doubleLine.count < cfg.minimumDoubleLineRays) {
    return reject('double-line', { count: doubleLine.count, required: cfg.minimumDoubleLineRays });
  }
  const hub = hubReport(luma, center, vertices, span);
  const hubSupportPass = hub && (
    hub.support >= cfg.minimumHubRays
    || (hub.support >= 1 && hub.contrast >= cfg.minimumHubContrast * 1.5)
  );
  if (!hub || !hubSupportPass || hub.contrast < cfg.minimumHubContrast) {
    return reject('hub', {
      support: hub && hub.support,
      contrast: hub && hub.contrast,
      requiredSupport: cfg.minimumHubRays,
      requiredContrast: cfg.minimumHubContrast,
    });
  }
  const innerR = doubleLine.meanInner > 0 ? doubleLine.meanInner : hexStats(vertices).radius;
  const outerR = doubleLine.meanOuter > 0 ? doubleLine.meanOuter : hexStats(vertices).radius;
  const ringRatio = outerR / Math.max(innerR, EPSILON);
  const ratioMatch = SUPPORTED_N.some((n) => {
    const want = locatorOuterDarkOuterCells(n) / locatorInnerDarkInnerCells(n);
    return Math.abs(ringRatio - want) <= 0.045;
  });
  if (!ratioMatch) return reject('ring-ratio', { ringRatio });
  const hullR = hexStats(vertices).radius;
  const previewCubeR = cubeRadiusFromInnerDarkInner(innerR, 13);
  if (previewCubeR) {
    const shrink = previewCubeR / Math.max(hullR, EPSILON);
    if (shrink > 0.96 || shrink < 0.80) return reject('shrink-range', { shrink });
  }
  const emitted = emitCandidate(
    'locator-shrink',
    shape.componentIndex === undefined ? -1 : shape.componentIndex,
    center,
    vertices,
    doubleLine,
    hub,
    span,
  );
  if (!emitted) return reject('candidate-map');

  // 실루엣 후보의 꼭짓점은 외곽 dark ring의 바깥 경계다. 회전 30°/90°처럼
  // 광선이 변 중앙을 비스듬히 지날 때 doubleLine.meanInner는 5~8% 흔들려
  // 레퍼런스 셀을 벗어났다. 반면 외곽 hull 반지름과 profile의 셀 비율은 회전에
  // 불변이므로, shrink 경로의 최종 cube 반지름은 그 비율에서 구한다.
  const candidates = SUPPORTED_N.flatMap((n) => {
    const outerScaled = cubeVerticesFromRing(center, emitted.ringVertices, 0, n);
    if (!outerScaled) return [];
    const scaledStats = hexStats(outerScaled);
    const locatorPhase = hubGapReport(luma, center, emitted.ringVertices, span, n);
    return [{
      ...emitted,
      vertices: outerScaled,
      center: scaledStats.center,
      radius: scaledStats.radius,
      seamVertices: [0, 1, 2].map(
        (index) => outerScaled[(emitted.seamParity + 2 * index) % 6],
      ),
      estimatedN: n,
      locatorScaleSource: 'outer-hull-profile-ratio',
      locatorPhase,
    }];
  });
  if (trace) trace.push({
    stage: 'accepted',
    componentSource: shape.componentSource,
    componentIndex: shape.componentIndex,
    candidateCount: candidates.length,
  });
  return candidates;
}

/**
 * 단일 후보 호환 API. 새 검출 경로는 포맷 판독 전 n을 단정하지 않기 위해
 * shrinkSilhouetteToCubeCandidates 를 사용한다.
 */
export function shrinkSilhouetteToCube(luma, shape, options = {}) {
  return shrinkSilhouetteToCubeCandidates(luma, shape, options)[0] || null;
}

/**
 * 로케이터 표시에서 큐브 실루엣 후보를 만든다.
 * 반환 후보는 cube-detect.hypothesesFromShapes 가 소비하는 모양이다.
 */
export function detectLocatorY(luma, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
      stage: 'locator-y',
      message: error.message,
    });
  }
  const cfg = calibration(options);
  const reduced = downsampleLuma(luma, cfg.maxDimension);
  const span = Math.max(lumaSpan(reduced.luma), EPSILON);
  const qrHits = countQrLikeFinders(reduced.luma, span);
  if (qrHits >= cfg.maximumQrFinderHits) {
    return ok({
      candidates: [],
      diagnostics: {
        source: 'locator-hex-frame-v1',
        profile: LOCATOR_PROFILE_OFF,
        rejected: 'qr-like',
        qrFinderHits: qrHits,
        downsampleFactor: reduced.factor,
      },
    });
  }

  const mask = closeMask(darkMask(reduced.luma, cfg), reduced.luma.width, reduced.luma.height);
  const components = connectedComponents(mask, reduced.luma.width, reduced.luma.height, cfg);
  const candidates = [];
  const rejections = [];

  components.forEach((component, componentIndex) => {
    const hull = convexHull(component.boundary);
    const vertices = simplifyHullToHex(hull);
    if (!vertices) {
      rejections.push({ componentIndex, stage: 'hull-not-hexagon' });
      return;
    }
    const stats = hexStats(vertices);
    if (stats.radiusCv > cfg.maximumRadiusCv || !(stats.radius > 8)) {
      rejections.push({ componentIndex, stage: 'hex-irregular', radiusCv: stats.radiusCv });
      return;
    }
    const area = Math.abs(polygonArea(vertices));
    const fill = component.area / Math.max(area, EPSILON);
    const ringLike = fill >= cfg.minimumRingFill && fill <= cfg.maximumRingFill;
    const filledHex = fill > cfg.maximumRingFill && fill < 0.92;
    if (!ringLike && !filledHex) {
      rejections.push({ componentIndex, stage: 'fill', fill });
      return;
    }
    const doubleLine = doubleLineReport(reduced.luma, stats.center, vertices, span);
    if (doubleLine.count < cfg.minimumDoubleLineRays) {
      rejections.push({
        componentIndex, stage: 'double-line', count: doubleLine.count,
      });
      return;
    }
    const hub = hubReport(reduced.luma, stats.center, vertices, span);
    if (!hub || hub.support < cfg.minimumHubRays
      || hub.contrast < cfg.minimumHubContrast) {
      rejections.push({
        componentIndex, stage: 'hub', hub,
      });
      return;
    }
    const emitted = emitCandidate(
      ringLike ? 'locator-ring' : 'locator-filled-hex',
      componentIndex,
      stats.center,
      vertices,
      doubleLine,
      hub,
      span,
    );
    if (!emitted) {
      rejections.push({ componentIndex, stage: 'cube-map' });
      return;
    }
    emitted.hardChecks.all = emitted.hardChecks.hexSilhouette
      && emitted.hardChecks.diagonalConcurrency
      && emitted.hardChecks.yJunction
      && emitted.hardChecks.locatorDoubleLine;
    if (!emitted.hardChecks.all) {
      rejections.push({ componentIndex, stage: 'hard-checks', checks: emitted.hardChecks });
      return;
    }
    candidates.push(emitted);
  });

  candidates.sort((a, b) => b.score - a.score || b.radius - a.radius);
  return ok({
    candidates: candidates.slice(0, cfg.maximumShapeCandidates),
    diagnostics: {
      source: 'locator-hex-frame-v1',
      profile: candidates.length ? LOCATOR_PROFILE_HEX_FRAME_V1 : LOCATOR_PROFILE_OFF,
      downsampleFactor: reduced.factor,
      componentCount: components.length,
      accepted: candidates.length,
      qrFinderHits: qrHits,
      rejections,
    },
  });
}

export function locatorSourceId(profile) {
  if (profile === LOCATOR_PROFILE_HEX_FRAME_V1) return 'locator-hex-frame-v1';
  if (profile === 'cell-surface-v1') return 'locator-cell-surface-v1';
  return 'cube-silhouette-y-junction';
}
