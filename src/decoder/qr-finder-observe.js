import {
  FRONTEND_FAILURE,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';

const QR_PATTERN_MODULES = 7;
const QR_MAX_CLUSTER_COUNT = 128;
const QR_MAX_CANDIDATES_PER_KIND = 16;

/**
 * 1:1:3:1:1 파인더 run 비율 판정. 배열이 아니라 다섯 스칼라를 받는다.
 *
 * 스캔 루프가 픽셀 런마다 부르는 자리라 예전의 `counts.reduce`/`pattern.map`
 * 배열 할당이 그대로 비용이었다. 합산 순서(c0..c4)는 원본과 같게 두어
 * 부동소수 결과가 달라지지 않게 한다.
 */
function qrPatternMatches5(c0, c1, c2, c3, c4, tolerance = 0.9) {
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

/**
 * QR 파인더 탐색용 **이진 마스크**. `dark(px,py)` 를 픽셀마다 다시 계산하지 않으려고
 * 한 번만 굽는다: `(!alpha || alpha[i] !== 0) && data[i] <= threshold` 와 값이 같다.
 *
 * 왜 필요한가: 세로 스캔은 `data[y*width+x]` 를 stride 로 읽는다. Float32Array
 * (1440×1920 이면 11 MB) 대신 1바이트 마스크(2.7 MB)면 같은 순회가 캐시 라인을
 * 1/4 만 건드린다. 가로/세로 스캔과 교차 확인이 전부 이 마스크만 본다.
 */
function qrCrossCheck(mask, width, height, x, y, dx, dy) {
  const dark = (px, py) => (
    px >= 0 && py >= 0 && px < width && py < height && mask[py * width + px] === 1
  );
  const inside = (px, py) => px >= 0 && py >= 0 && px < width && py < height;

  x = Math.round(x);
  y = Math.round(y);
  if (!dark(x, y)) return null;

  const counts = [0, 0, 0, 0, 0];
  let px = x;
  let py = y;
  while (dark(px, py)) {
    counts[2] += 1;
    px -= dx;
    py -= dy;
  }
  while (inside(px, py) && !dark(px, py)) {
    counts[1] += 1;
    px -= dx;
    py -= dy;
  }
  while (dark(px, py)) {
    counts[0] += 1;
    px -= dx;
    py -= dy;
  }

  px = x + dx;
  py = y + dy;
  while (dark(px, py)) {
    counts[2] += 1;
    px += dx;
    py += dy;
  }
  while (inside(px, py) && !dark(px, py)) {
    counts[3] += 1;
    px += dx;
    py += dy;
  }
  while (dark(px, py)) {
    counts[4] += 1;
    px += dx;
    py += dy;
  }
  if (!qrPatternMatches5(counts[0], counts[1], counts[2], counts[3], counts[4])) return null;

  let negative = 0;
  px = x - dx;
  py = y - dy;
  while (dark(px, py)) {
    negative += 1;
    px -= dx;
    py -= dy;
  }
  let positive = 0;
  px = x + dx;
  py = y + dy;
  while (dark(px, py)) {
    positive += 1;
    px += dx;
    py += dy;
  }
  return {
    center: (dx !== 0 ? x : y) + (positive - negative) / 2,
    module: (counts[0] + counts[1] + counts[2] + counts[3] + counts[4]) / QR_PATTERN_MODULES,
  };
}

/**
 * 한 줄(행 또는 전치된 열)의 1:1:3:1:1 run 을 훑는다.
 *
 * 버퍼는 `base + position` 으로 **연속 접근**한다 — 열 스캔은 전치 마스크를 넘겨
 * 같은 함수를 쓰므로 세로 방향도 stride 없이 읽힌다. 런은 반드시 교대하므로
 * 마지막 5개만 있으면 되고(길이·시작 위치), `pattern[0].dark` 는 방금 밀어 넣은
 * 런이 dark 인지와 같다(5개는 홀수라 양 끝의 패리티가 같다). 그래서 원본의
 * `runs` 객체 배열·`slice(-5)`·`map` 할당이 전부 사라진다.
 */
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

/** 픽셀 순서와 alpha별 빠른 루프를 보존하면서 투명 구간도 일정 간격으로 양보해요. */
const QR_CURSOR_PIXEL_CHUNK = 4096;

function drainSteps(iterator) {
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

function* qrOtsuThresholdSteps(luma) {
  const histogram = new Uint32Array(256);
  const { data, alpha } = luma;
  let count = 0;
  let sum = 0;
  for (let start = 0; start < data.length; start += QR_CURSOR_PIXEL_CHUNK) {
    const end = Math.min(data.length, start + QR_CURSOR_PIXEL_CHUNK);
    if (alpha) {
      for (let index = start; index < end; index += 1) {
        if (alpha[index] === 0) continue;
        const scaled = data[index] * 255 + 0.5;
        if (scaled >= 0) {
          const bin = scaled >= 256 ? 255 : scaled | 0;
          histogram[bin] += 1; count += 1; sum += bin;
        } else if (scaled < 0) {
          histogram[0] += 1; count += 1;
        } else { count += 1; sum += NaN; }
      }
    } else {
      for (let index = start; index < end; index += 1) {
        const scaled = data[index] * 255 + 0.5;
        if (scaled >= 0) {
          const bin = scaled >= 256 ? 255 : scaled | 0;
          histogram[bin] += 1; count += 1; sum += bin;
        } else if (scaled < 0) {
          histogram[0] += 1; count += 1;
        } else { count += 1; sum += NaN; }
      }
    }
    yield null;
  }
  if (count === 0) return null;
  let backgroundCount = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 127;
  for (let bin = 0; bin < histogram.length; bin += 1) {
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

function* qrDarkMaskSteps(luma, threshold) {
  const { data, alpha } = luma;
  const mask = new Uint8Array(data.length);
  for (let start = 0; start < data.length; start += QR_CURSOR_PIXEL_CHUNK) {
    const end = Math.min(data.length, start + QR_CURSOR_PIXEL_CHUNK);
    if (alpha) {
      for (let index = start; index < end; index += 1) {
        mask[index] = alpha[index] !== 0 && data[index] <= threshold ? 1 : 0;
      }
    } else {
      for (let index = start; index < end; index += 1) mask[index] = data[index] <= threshold ? 1 : 0;
    }
    yield null;
  }
  return mask;
}

function* qrTransposeMaskSteps(mask, width, height) {
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
      yield null;
    }
  }
  return out;
}

function* qrScanHitsSteps(mask, width, height) {
  const hits = [];
  const runLength = new Int32Array(5);
  const runStart = new Int32Array(5);
  for (let y = 0; y < height; y += 1) {
    qrScanRuns(mask, y * width, width, runLength, runStart, (center, lineModule) => {
      const cross = qrCrossCheck(mask, width, height, center, y, 0, 1);
      if (cross) hits.push({ x: center, y: cross.center, module: (lineModule + cross.module) / 2 });
    });
    yield null;
  }
  const transposed = yield* qrTransposeMaskSteps(mask, width, height);
  for (let x = 0; x < width; x += 1) {
    qrScanRuns(transposed, x * height, height, runLength, runStart, (center, lineModule) => {
      const cross = qrCrossCheck(mask, width, height, x, center, 1, 0);
      if (cross) hits.push({ x: cross.center, y: center, module: (lineModule + cross.module) / 2 });
    });
    yield null;
  }
  return hits;
}

function* qrClusterHitsSteps(hits) {
  const hitCount = hits.length;
  const clusterX = new Float64Array(hitCount), clusterY = new Float64Array(hitCount);
  const clusterModule = new Float64Array(hitCount), clusterCount = new Int32Array(hitCount);
  const regLevel = new Int32Array(hitCount), regX0 = new Int32Array(hitCount), regX1 = new Int32Array(hitCount);
  const regY0 = new Int32Array(hitCount), regY1 = new Int32Array(hitCount);
  let total = 0;
  const buckets = new Map(), levels = [];
  const cellKey = (level, cx, cy) => (level << 24) | ((cy < 0 ? 0 : cy > 4095 ? 4095 : cy) << 12) | (cx < 0 ? 0 : cx > 4095 ? 4095 : cx);
  const register = (index) => {
    const radius = Math.max(3, clusterModule[index] * 2);
    let level = 0, cell = 8;
    while (cell < radius && level < 60) { cell *= 2; level += 1; }
    const x0 = Math.floor((clusterX[index] - radius) / cell), x1 = Math.floor((clusterX[index] + radius) / cell);
    const y0 = Math.floor((clusterY[index] - radius) / cell), y1 = Math.floor((clusterY[index] + radius) / cell);
    if (clusterCount[index] > 1 && regLevel[index] === level && regX0[index] === x0 && regX1[index] === x1 && regY0[index] === y0 && regY1[index] === y1) return;
    regLevel[index] = level; regX0[index] = x0; regX1[index] = x1; regY0[index] = y0; regY1[index] = y1;
    if (!levels.includes(level)) levels.push(level);
    for (let cy = y0; cy <= y1; cy += 1) for (let cx = x0; cx <= x1; cx += 1) {
      const key = cellKey(level, cx, cy), bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [index]); else if (bucket[bucket.length - 1] !== index) bucket.push(index);
    }
  };
  for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
    const hit = hits[hitIndex];
    let found = -1;
    for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
      const level = levels[levelIndex], cell = 8 * (2 ** level);
      const bucket = buckets.get(cellKey(level, Math.floor(hit.x / cell), Math.floor(hit.y / cell)));
      if (bucket === undefined) continue;
      for (let b = 0; b < bucket.length; b += 1) {
        const index = bucket[b];
        if (found >= 0 && index >= found) continue;
        const cm = clusterModule[index];
        if (Math.hypot(clusterX[index] - hit.x, clusterY[index] - hit.y) <= Math.max(3, cm * 2)
          && Math.abs(cm - hit.module) <= Math.max(cm, hit.module) * 0.55) found = index;
      }
    }
    if (found >= 0) {
      const previous = clusterCount[found], count = previous + 1;
      clusterX[found] = (clusterX[found] * previous + hit.x) / count;
      clusterY[found] = (clusterY[found] * previous + hit.y) / count;
      clusterModule[found] = (clusterModule[found] * previous + hit.module) / count;
      clusterCount[found] = count; register(found);
    } else {
      const index = total++;
      clusterX[index] = hit.x; clusterY[index] = hit.y; clusterModule[index] = hit.module; clusterCount[index] = 1; register(index);
    }
    yield null;
  }
  const clusters = [];
  for (let index = 0; index < total; index += 1) {
    if (clusterCount[index] >= 2) clusters.push({ x: clusterX[index], y: clusterY[index], module: clusterModule[index], count: clusterCount[index] });
  }
  return clusters.sort((left, right) => right.count - left.count || left.y - right.y || left.x - right.x).slice(0, QR_MAX_CLUSTER_COUNT);
}

function* qrTripleCandidatesSteps(clusters, options = {}) {
  const candidates = [], clusterCount = clusters.length, pairCount = clusterCount * clusterCount;
  const pairX = new Float64Array(pairCount), pairY = new Float64Array(pairCount), pairLength = new Float64Array(pairCount);
  for (let sharedIndex = 0; sharedIndex < clusterCount; sharedIndex += 1) {
    const shared = clusters[sharedIndex], row = sharedIndex * clusterCount;
    for (let axisIndex = 0; axisIndex < clusterCount; axisIndex += 1) {
      const axis = clusters[axisIndex], index = row + axisIndex, ax = axis.x - shared.x, ay = axis.y - shared.y;
      pairX[index] = ax; pairY[index] = ay; pairLength[index] = Math.hypot(ax, ay);
    }
    yield null;
  }
  const minimumSpacing = options.minimumSpacingModules ?? 8, maximumSpacing = options.maximumSpacingModules ?? 22;
  const clusterModule = new Float64Array(clusterCount);
  for (let i = 0; i < clusterCount; i += 1) clusterModule[i] = clusters[i].module;
  for (let sharedIndex = 0; sharedIndex < clusterCount; sharedIndex += 1) {
    const shared = clusters[sharedIndex], sharedModule = clusterModule[sharedIndex], row = sharedIndex * clusterCount;
    for (let firstIndex = 0; firstIndex < clusterCount; firstIndex += 1) {
      if (firstIndex !== sharedIndex) {
        const axisA = clusters[firstIndex], axisAModule = clusterModule[firstIndex];
        if (Math.max(sharedModule, axisAModule) / Math.min(sharedModule, axisAModule) <= 1.8) {
          const pairA = row + firstIndex, ax = pairX[pairA], ay = pairY[pairA], legA = pairLength[pairA];
          for (let secondIndex = firstIndex + 1; secondIndex < clusterCount; secondIndex += 1) {
            if (secondIndex === sharedIndex) continue;
            const pairB = row + secondIndex, legB = pairLength[pairB];
            if (Math.abs(legA - legB) / Math.max(legA, legB) > 0.35) continue;
            const axisBModule = clusterModule[secondIndex], module = (sharedModule + axisAModule + axisBModule) / 3;
            if (Math.min(legA, legB) / module < minimumSpacing || Math.max(legA, legB) / module > maximumSpacing) continue;
            const bx = pairX[pairB], by = pairY[pairB], sine = Math.abs(ax * by - ay * bx) / (legA * legB), cosine = (ax * bx + ay * by) / (legA * legB);
            if (sine < 0.65 || cosine > 0.45 || cosine < -0.8) continue;
            const axisB = clusters[secondIndex], moduleRatio = Math.max(sharedModule, axisAModule, axisBModule) / Math.min(sharedModule, axisAModule, axisBModule);
            if (moduleRatio > 1.8) continue;
            const kind = cosine < -0.25 ? 'window' : 'center', targetCosine = kind === 'window' ? -0.5 : 0;
            const kindMargin = Math.abs(Math.abs(cosine + 0.5) - Math.abs(cosine));
            candidates.push({ kind, kindMargin, kindAmbiguous: kindMargin < 0.1,
              score: Math.abs(legA - legB) / Math.max(legA, legB) + Math.abs(cosine - targetCosine) + 0.05 * (moduleRatio - 1) - Math.min(100, shared.count + axisA.count + axisB.count) * 0.002,
              cosine, module, legA, legB, shared, axisA, axisB, center: { x: shared.x + (ax + bx) / 2, y: shared.y + (ay + by) / 2 } });
          }
        }
      }
      yield null;
    }
  }
  candidates.sort((left, right) => left.score - right.score || left.center.y - right.center.y || left.center.x - right.center.x);
  const limit = options.maxCandidatesPerKind ?? QR_MAX_CANDIDATES_PER_KIND, countByKind = { center: 0, window: 0 };
  return candidates.filter((candidate) => {
    if (countByKind[candidate.kind] >= limit) return false;
    countByKind[candidate.kind] += 1;
    return true;
  });
}

/** QR finder 관측을 호출자 예산 단위로 양보한다. 완료 값은 동기 API와 동일하다. */
export function* detectQrFinderTriplesSteps(luma, options = {}) {
  try { assertLumaField(luma); } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { stage: 'qr-finder', message: error.message });
  }
  const threshold = yield* qrOtsuThresholdSteps(luma);
  if (threshold === null) return fail(FRONTEND_FAILURE.NO_FINDER, { stage: 'qr-finder', cause: 'no-opaque-samples' });
  const mask = yield* qrDarkMaskSteps(luma, threshold);
  const hits = yield* qrScanHitsSteps(mask, luma.width, luma.height);
  const finderCenters = yield* qrClusterHitsSteps(hits);
  const candidates = yield* qrTripleCandidatesSteps(finderCenters, options);
  if (candidates.length === 0) return fail(FRONTEND_FAILURE.NO_FINDER, {
    stage: 'qr-finder', cause: 'no-qr-triple', threshold, hitCount: hits.length, finderCenterCount: finderCenters.length,
  });
  return ok({ candidates, finderCenters, diagnostics: { threshold, hitCount: hits.length, finderCenterCount: finderCenters.length, candidateCount: candidates.length } });
}
/**
 * QR 파인더 삼중점 후보를 결정적으로 열거한다.
 *
 * center는 O/A 중앙 정사각 QR, window는 Type Y2 top-face QR의 120도 투영이다.
 * QR 후보만으로 타입을 확정하지 않으며 bootstrap 본문 검증이 최종 게이트다.
 */
export function detectQrFinderTriples(luma, options = {}) {
  return drainSteps(detectQrFinderTriplesSteps(luma, options));
}
