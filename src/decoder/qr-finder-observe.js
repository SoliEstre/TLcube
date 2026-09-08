import {
  FRONTEND_FAILURE,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';

const QR_PATTERN_MODULES = 7;
const QR_MAX_CLUSTER_COUNT = 128;
const QR_MAX_CANDIDATES_PER_KIND = 16;

function qrOtsuThreshold(luma) {
  const histogram = new Uint32Array(256);
  const data = luma.data;
  const alpha = luma.alpha;
  const length = data.length;
  let count = 0;
  let sum = 0;
  /*
   * bin 은 `Math.max(0, Math.min(255, Math.round(v * 255)))` 와 **같은 값**이다.
   *
   * `Math.round(x)` 는 x >= 0 에서 `Math.floor(x + 0.5)` 이고, `floor(x+0.5)` 가
   * `round(x)` 와 갈리는 유일한 경우는 x 가 `n + 0.5` 바로 아래 double 일 때다.
   * 여기서 `data` 는 계약상 Float32Array(가수 24비트)이고 ×255 는 double 에서
   * 정확하므로 유효 가수가 32비트를 넘지 않는다 — 그 임계값(가수 53비트)에
   * 걸릴 수가 없다. 음수·NaN 분기도 원식 그대로다: NaN 이면 histogram 쓰기가
   * 없고 sum 이 NaN 이 된다(그러면 Otsu 가 기본 127 로 떨어지는 기존 거동).
   *
   * alpha 유무로 루프를 갈라 픽셀마다 `alpha &&` 를 다시 보지 않는다.
   * 실측(1080×1440): 원래 경로 14.7ms → 이 경로 6.9ms.
   */
  if (alpha) {
    for (let index = 0; index < length; index += 1) {
      if (alpha[index] === 0) continue;
      const scaled = data[index] * 255 + 0.5;
      if (scaled >= 0) {
        const bin = scaled >= 256 ? 255 : scaled | 0;
        histogram[bin] += 1;
        count += 1;
        sum += bin;
      } else if (scaled < 0) {
        histogram[0] += 1;
        count += 1;
      } else {
        count += 1;
        sum += NaN;
      }
    }
  } else {
    for (let index = 0; index < length; index += 1) {
      const scaled = data[index] * 255 + 0.5;
      if (scaled >= 0) {
        const bin = scaled >= 256 ? 255 : scaled | 0;
        histogram[bin] += 1;
        count += 1;
        sum += bin;
      } else if (scaled < 0) {
        histogram[0] += 1;
        count += 1;
      } else {
        count += 1;
        sum += NaN;
      }
    }
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
function qrDarkMask(luma, threshold) {
  const { data, alpha } = luma;
  const length = data.length;
  const mask = new Uint8Array(length);
  if (alpha) {
    for (let index = 0; index < length; index += 1) {
      mask[index] = (alpha[index] !== 0 && data[index] <= threshold) ? 1 : 0;
    }
  } else {
    for (let index = 0; index < length; index += 1) {
      mask[index] = data[index] <= threshold ? 1 : 0;
    }
  }
  return mask;
}

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

/** 마스크를 블록 단위로 전치한다 — 열 스캔을 연속 접근으로 바꾸려고. */
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

function qrScanHits(mask, width, height) {
  const hits = [];
  const runLength = new Int32Array(5);
  const runStart = new Int32Array(5);

  for (let y = 0; y < height; y += 1) {
    qrScanRuns(mask, y * width, width, runLength, runStart, (center, lineModule) => {
      const cross = qrCrossCheck(mask, width, height, center, y, 0, 1);
      if (cross) {
        hits.push({ x: center, y: cross.center, module: (lineModule + cross.module) / 2 });
      }
    });
  }

  const transposed = qrTransposeMask(mask, width, height);
  for (let x = 0; x < width; x += 1) {
    qrScanRuns(transposed, x * height, height, runLength, runStart, (center, lineModule) => {
      const cross = qrCrossCheck(mask, width, height, x, center, 1, 0);
      if (cross) {
        hits.push({ x: cross.center, y: center, module: (lineModule + cross.module) / 2 });
      }
    });
  }
  return hits;
}

/**
 * 관측(hit)을 파인더 중심 클러스터로 합친다.
 *
 * 원본은 hit 마다 `clusters.find(...)` 로 전체를 훑었다. 실사진 1440 에서 hit
 * 3천~1만2천 · 클러스터 1천~2천이면 술어 평가가 수백만~수천만 회고, 실측상
 * Type Y 복호 시간의 **3분의 1** 이 여기였다.
 *
 * 대신 **레벨 격자 공간 색인**을 쓴다. 클러스터마다 매칭 반경
 * `max(3, module*2)` 이 다르므로 반경별 레벨(칸 크기 `8 << level` ≥ 반경)에
 * 등록하면 디스크가 칸 3×3 안에 들어간다. hit 이 어떤 클러스터의 디스크 안이면
 * 그 클러스터는 반드시 hit 이 속한 칸에 등록돼 있으므로 **누락이 없다**.
 * 중심이 움직여 등록 범위가 바뀌면 새 범위를 추가한다(옛 등록은 남지만 술어를
 * 다시 검사하므로 무해하다).
 *
 * **출력은 원본과 동일하다**: 후보 중 최소 인덱스(= 삽입 순서상 첫 매칭)를
 * 고르고, 술어는 `Math.hypot` 원식 그대로 평가하며, 결과 배열도 삽입 순서를
 * 유지해 뒤따르는 stable sort 의 타이브레이크가 보존된다.
 */
function qrClusterHits(hits) {
  const hitCount = hits.length;
  const clusterX = new Float64Array(hitCount);
  const clusterY = new Float64Array(hitCount);
  const clusterModule = new Float64Array(hitCount);
  const clusterCount = new Int32Array(hitCount);
  const regLevel = new Int32Array(hitCount);
  const regX0 = new Int32Array(hitCount);
  const regX1 = new Int32Array(hitCount);
  const regY0 = new Int32Array(hitCount);
  const regY1 = new Int32Array(hitCount);
  let total = 0;

  const buckets = new Map();
  const levels = [];
  const cellKey = (level, cx, cy) => (
    (level << 24)
    | ((cy < 0 ? 0 : cy > 4095 ? 4095 : cy) << 12)
    | (cx < 0 ? 0 : cx > 4095 ? 4095 : cx)
  );

  const register = (index) => {
    const radius = Math.max(3, clusterModule[index] * 2);
    let level = 0;
    let cell = 8;
    while (cell < radius && level < 60) {
      cell *= 2;
      level += 1;
    }
    const x0 = Math.floor((clusterX[index] - radius) / cell);
    const x1 = Math.floor((clusterX[index] + radius) / cell);
    const y0 = Math.floor((clusterY[index] - radius) / cell);
    const y1 = Math.floor((clusterY[index] + radius) / cell);
    if (clusterCount[index] > 1
      && regLevel[index] === level
      && regX0[index] === x0 && regX1[index] === x1
      && regY0[index] === y0 && regY1[index] === y1) {
      return;
    }
    regLevel[index] = level;
    regX0[index] = x0;
    regX1[index] = x1;
    regY0[index] = y0;
    regY1[index] = y1;
    if (!levels.includes(level)) levels.push(level);
    for (let cy = y0; cy <= y1; cy += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        const key = cellKey(level, cx, cy);
        const bucket = buckets.get(key);
        if (bucket === undefined) buckets.set(key, [index]);
        else if (bucket[bucket.length - 1] !== index) bucket.push(index);
      }
    }
  };

  for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
    const hit = hits[hitIndex];
    const hx = hit.x;
    const hy = hit.y;
    const hm = hit.module;
    let found = -1;
    for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
      const level = levels[levelIndex];
      const cell = 8 * (2 ** level);
      const bucket = buckets.get(
        cellKey(level, Math.floor(hx / cell), Math.floor(hy / cell)),
      );
      if (bucket === undefined) continue;
      for (let b = 0; b < bucket.length; b += 1) {
        const index = bucket[b];
        if (found >= 0 && index >= found) continue;
        const cm = clusterModule[index];
        if (Math.hypot(clusterX[index] - hx, clusterY[index] - hy)
            <= Math.max(3, cm * 2)
          && Math.abs(cm - hm) <= Math.max(cm, hm) * 0.55) {
          found = index;
        }
      }
    }
    if (found >= 0) {
      const previous = clusterCount[found];
      const count = previous + 1;
      clusterX[found] = (clusterX[found] * previous + hx) / count;
      clusterY[found] = (clusterY[found] * previous + hy) / count;
      clusterModule[found] = (clusterModule[found] * previous + hm) / count;
      clusterCount[found] = count;
      register(found);
    } else {
      const index = total;
      total += 1;
      clusterX[index] = hx;
      clusterY[index] = hy;
      clusterModule[index] = hm;
      clusterCount[index] = 1;
      register(index);
    }
  }

  const clusters = [];
  for (let index = 0; index < total; index += 1) {
    if (clusterCount[index] < 2) continue;
    clusters.push({
      x: clusterX[index],
      y: clusterY[index],
      module: clusterModule[index],
      count: clusterCount[index],
    });
  }
  return clusters
    .sort((left, right) =>
      right.count - left.count
      || left.y - right.y
      || left.x - right.x)
    .slice(0, QR_MAX_CLUSTER_COUNT);
}
function qrTripleCandidates(clusters, options = {}) {
  const candidates = [];
  const clusterCount = clusters.length;
  const pairCount = clusterCount * clusterCount;
  const pairX = new Float64Array(pairCount);
  const pairY = new Float64Array(pairCount);
  const pairLength = new Float64Array(pairCount);
  for (let sharedIndex = 0; sharedIndex < clusterCount; sharedIndex += 1) {
    const shared = clusters[sharedIndex];
    const row = sharedIndex * clusterCount;
    for (let axisIndex = 0; axisIndex < clusterCount; axisIndex += 1) {
      const axis = clusters[axisIndex];
      const index = row + axisIndex;
      const ax = axis.x - shared.x;
      const ay = axis.y - shared.y;
      pairX[index] = ax;
      pairY[index] = ay;
      pairLength[index] = Math.hypot(ax, ay);
    }
  }
  const minimumSpacing = options.minimumSpacingModules ?? 8;
  const maximumSpacing = options.maximumSpacingModules ?? 22;
  // 삼중 루프 안에서 객체 프로퍼티를 다시 읽지 않도록 module 만 따로 뽑는다.
  const clusterModule = new Float64Array(clusterCount);
  for (let i = 0; i < clusterCount; i += 1) clusterModule[i] = clusters[i].module;
  for (let sharedIndex = 0; sharedIndex < clusterCount; sharedIndex += 1) {
    const shared = clusters[sharedIndex];
    const sharedModule = clusterModule[sharedIndex];
    const row = sharedIndex * clusterCount;
    for (let firstIndex = 0; firstIndex < clusterCount; firstIndex += 1) {
      if (firstIndex === sharedIndex) continue;
      const axisA = clusters[firstIndex];
      const axisAModule = clusterModule[firstIndex];
      /*
       * 가지치기 — 세 모듈의 max/min 비가 1.8 을 넘으면 어차피 버린다. 두 개만으로
       * 이미 1.8 을 넘으면 세 번째를 무엇으로 골라도 비는 더 커지기만 하므로
       * (max3 >= max2, min3 <= min2, 나눗셈은 단조) **안쪽 루프 전체를 건너뛴다.**
       * 통과 집합은 바뀌지 않는다 — 원래 조건의 필요조건일 뿐이다.
       */
      if (Math.max(sharedModule, axisAModule) / Math.min(sharedModule, axisAModule) > 1.8) {
        continue;
      }
      const pairA = row + firstIndex;
      const ax = pairX[pairA];
      const ay = pairY[pairA];
      const legA = pairLength[pairA];
      for (let secondIndex = firstIndex + 1;
        secondIndex < clusterCount;
        secondIndex += 1) {
        if (secondIndex === sharedIndex) continue;
        const pairB = row + secondIndex;
        const legB = pairLength[pairB];
        // 세 조건은 AND 로 묶여 있어 순서를 바꿔도 통과 집합이 같다. 두 다리 길이
        // 비교가 가장 선별적이면서 module 합·나눗셈이 필요 없어 앞으로 당겼다.
        if (Math.abs(legA - legB) / Math.max(legA, legB) > 0.35) continue;
        const axisBModule = clusterModule[secondIndex];
        const module = (sharedModule + axisAModule + axisBModule) / 3;
        if (Math.min(legA, legB) / module < minimumSpacing
          || Math.max(legA, legB) / module > maximumSpacing) {
          continue;
        }

        const bx = pairX[pairB];
        const by = pairY[pairB];
        const sine = Math.abs(ax * by - ay * bx) / (legA * legB);
        const cosine = (ax * bx + ay * by) / (legA * legB);
        if (sine < 0.65 || cosine > 0.45 || cosine < -0.8) continue;
        const axisB = clusters[secondIndex];
        const moduleRatio = Math.max(sharedModule, axisAModule, axisBModule)
          / Math.min(sharedModule, axisAModule, axisBModule);
        if (moduleRatio > 1.8) continue;

        const kind = cosine < -0.25 ? 'window' : 'center';
        const targetCosine = kind === 'window' ? -0.5 : 0;
        // F-21: kind 는 cosine 하나로 붙인 표식이다 — 두 목표각(-0.5 vs 0)과의
        // 거리 차가 작으면(경계 ±0.05 = cosine ∈ (-0.3, -0.2)) 표식이 증거가 못 된다.
        // 소비자는 ambiguous 후보를 양쪽 해석으로 평가하고 레퍼런스 게이트가 판정한다
        // (표식 강등 + 진단 필드 — 조용히 접지 않는다).
        const kindMargin = Math.abs(Math.abs(cosine + 0.5) - Math.abs(cosine));
        const kindAmbiguous = kindMargin < 0.1;
        const score =
          Math.abs(legA - legB) / Math.max(legA, legB)
          + Math.abs(cosine - targetCosine)
          + 0.05 * (moduleRatio - 1)
          - Math.min(100, shared.count + axisA.count + axisB.count) * 0.002;
        candidates.push({
          kind,
          kindMargin,
          kindAmbiguous,
          score,
          cosine,
          module,
          legA,
          legB,
          shared,
          axisA,
          axisB,
          center: {
            x: shared.x + (ax + bx) / 2,
            y: shared.y + (ay + by) / 2,
          },
        });
      }
    }
  }

  candidates.sort((left, right) =>
    left.score - right.score
    || left.center.y - right.center.y
    || left.center.x - right.center.x);
  const limit = options.maxCandidatesPerKind ?? QR_MAX_CANDIDATES_PER_KIND;
  const countByKind = { center: 0, window: 0 };
  return candidates.filter((candidate) => {
    if (countByKind[candidate.kind] >= limit) return false;
    countByKind[candidate.kind] += 1;
    return true;
  });
}
/**
 * QR 파인더 삼중점 후보를 결정적으로 열거한다.
 *
 * center는 O/A 중앙 정사각 QR, window는 Type Y2 top-face QR의 120도 투영이다.
 * QR 후보만으로 타입을 확정하지 않으며 bootstrap 본문 검증이 최종 게이트다.
 */
export function detectQrFinderTriples(luma, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
      stage: 'qr-finder',
      message: error.message,
    });
  }
  const threshold = qrOtsuThreshold(luma);
  if (threshold === null) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'qr-finder',
      cause: 'no-opaque-samples',
    });
  }
  const hits = qrScanHits(qrDarkMask(luma, threshold), luma.width, luma.height);
  const finderCenters = qrClusterHits(hits);
  const candidates = qrTripleCandidates(finderCenters, options);
  if (candidates.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'qr-finder',
      cause: 'no-qr-triple',
      threshold,
      hitCount: hits.length,
      finderCenterCount: finderCenters.length,
    });
  }
  return ok({
    candidates,
    finderCenters,
    diagnostics: {
      threshold,
      hitCount: hits.length,
      finderCenterCount: finderCenters.length,
      candidateCount: candidates.length,
    },
  });
}
