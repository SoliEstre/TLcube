/** 프레임 소유 스냅샷에서 verified 앞단의 작업을 나누는 공유 획득 커서예요. */
import { CS_BLOCK_LOCATOR_INTERNALS as I } from './cellsurface-block-detect.js';
import { downsampleLumaForSeed, otsuThreshold } from './finder-seed.js';


// 한 merge의 이동을 작은 수로 잘라 재개한다. 128은 실험 기본값이며 프레임 예산이 아니다.
function* stableSortSteps(list, compare, moveChunk, finiteKeys = null) {
  if (list.length < 2) return;
  // 전체 native sort는 한 원자 작업이 커져요. 유한 키의 전순서가 확인된
  // 경우에만 최대128개 run을 안정 정렬하고, 나머지는 같은 재개 병합을 써요.
  // NaN/무한대의 비추이 비교는 기존 merge 선택을 그대로 보존해요.
  let runWidth = 1;
  if (finiteKeys && moveChunk > 1) {
    let eligible = true, checked = 0;
    for (const value of list) {
      if (!finiteKeys(value)) { eligible = false; break; }
      if (++checked === moveChunk) { checked = 0; yield 'sort-key-check'; }
    }
    if (eligible) {
      while (runWidth * 2 <= Math.min(128, moveChunk)) runWidth *= 2;
      for (let left = 0; left < list.length; left += runWidth) {
        const run = list.slice(left, left + runWidth).sort(compare);
        for (let i = 0; i < run.length; i++) list[left + i] = run[i];
        yield 'sort-native-run';
      }
    }
  }
  let source = list, target = new Array(list.length), moves = 0;
  for (let width = runWidth; width < list.length; width *= 2) {
    for (let left = 0; left < list.length; left += 2 * width) {
      const mid = Math.min(left + width, list.length), end = Math.min(left + 2 * width, list.length);
      let a = left, b = mid;
      for (let out = left; out < end; out++) {
        // 같은 키(또는 JS sort의 NaN 비교)는 왼쪽을 먼저 유지한다.
        const order = a < mid && b < end ? compare(source[a], source[b]) : 0;
        target[out] = a < mid && (b >= end || !(order > 0)) ? source[a++] : source[b++];
        if (++moves === moveChunk) { moves = 0; yield 'sort-merge-moves'; }
      }
    }
    const previous = source; source = target; target = previous;
    yield 'sort-pass';
  }
  if (source !== list) for (let i = 0; i < list.length; i++) {
    list[i] = source[i];
    if (++moves === moveChunk) { moves = 0; yield 'sort-copy-moves'; }
  }
}

const compareCores = (left, right) => left.y - right.y || left.x - right.x || left.u - right.u;
const finiteCoreKeys = value => Number.isFinite(value.y) && Number.isFinite(value.x) && Number.isFinite(value.u);
function* coreSortSteps(list, chunk) {
  if (list.length < 2) return;
  // 스캔선의 y = 정수 + 정수 × (runStart + runLength/2)예요. 실제 값이
  // 그 격자인지 먼저 확인하고 y 행으로 나누면 전역 비교 병합을 피할 수 있어요.
  // 후보는 하나도 버리지 않고 같은 y의 원래 삽입 순서도 보존해요.
  let minimum = Infinity, maximum = -Infinity, eligible = true, work = 0;
  for (const value of list) {
    const row = value.y * 2;
    if (!finiteCoreKeys(value) || !Number.isSafeInteger(row)) { eligible = false; break; }
    minimum = Math.min(minimum, row); maximum = Math.max(maximum, row);
    if (++work === chunk) { work = 0; yield 'sort-core-row-check'; }
  }
  const count = maximum - minimum + 1;
  if (!eligible || count > 65536 || count > Math.max(64, list.length * 4)) {
    yield* stableSortSteps(list, compareCores, chunk);
    return;
  }
  const rows = new Array(count);
  work = 0;
  for (const value of list) {
    const row = value.y * 2 - minimum;
    if (rows[row]) rows[row].push(value); else rows[row] = [value];
    if (++work === chunk) { work = 0; yield 'sort-core-row-partition'; }
  }
  let output = 0;
  work = 0;
  for (const row of rows) {
    if (row) {
      yield* stableSortSteps(row, (left, right) => left.x - right.x || left.u - right.u, chunk, finiteCoreKeys);
      for (const value of row) {
        list[output++] = value;
        if (++work === chunk) { work = 0; yield 'sort-core-row-copy'; }
      }
    }
    if (++work === chunk) { work = 0; yield 'sort-core-row-next'; }
  }
}
// 원본 해상도의 공유 획득은 동기 축소 로케이터와 다른 검색 버킷을 써요.
// 수용 술어·반경·최초 삽입 매치와 출력 순서는 같아요.
const CLUSTER_BUCKET_PX = 32;
export const SORT_CURSOR_PROTOTYPE_INTERNALS = Object.freeze({ stableSortSteps, coreSortSteps, clusterSteps, clusterBucketBounds, CLUSTER_BUCKET_PX });

// v3 실험: v2와 같은 군집 문장 중 안정 정렬만 재개 가능한 병합 정렬로 대체한다.
const { clusterSearchRadius, clusterAcceptsMeans, compareClusters } = I;
function clusterBucketBounds(candidate, radius, bounds) {
  if (Number.isFinite(candidate.x) && Math.abs(candidate.x) <= 1e6
    && Number.isFinite(candidate.y) && Math.abs(candidate.y) <= 1e6
    && Number.isFinite(candidate.u) && candidate.u >= 1 && candidate.u <= 1e5
    && Number.isFinite(radius) && radius <= 1e6) {
    // 이 유한 범위에서 수용된 dx/dy와 제곱·차의 반올림 여유는1e-8px 미만이에요.
    // 전체 버킷 하나 대신 산술오차보다 보수적인 여유만 더해요. 술어는 그대로예요.
    const padding = 1e-8;
    bounds.fromX = Math.floor((candidate.x - radius - padding) / CLUSTER_BUCKET_PX);
    bounds.toX = Math.floor((candidate.x + radius + padding) / CLUSTER_BUCKET_PX);
    bounds.fromY = Math.floor((candidate.y - radius - padding) / CLUSTER_BUCKET_PX);
    bounds.toY = Math.floor((candidate.y + radius + padding) / CLUSTER_BUCKET_PX);
  } else {
    // 유한 범위를 벗어난 내부 호출은 기존 넓은 버킷 선택을 보존해요.
    bounds.fromX = Math.floor((candidate.x - radius) / CLUSTER_BUCKET_PX) - 1;
    bounds.toX = Math.floor((candidate.x + radius) / CLUSTER_BUCKET_PX) + 1;
    bounds.fromY = Math.floor((candidate.y - radius) / CLUSTER_BUCKET_PX) - 1;
    bounds.toY = Math.floor((candidate.y + radius) / CLUSTER_BUCKET_PX) + 1;
  }
}
function* clusterSteps(candidates, cfg, sortMoveChunk, workChunk) {
  const byKind = new Map();
  let work = 0;
  for (const candidate of candidates) {
    if (!byKind.has(candidate.kind)) byKind.set(candidate.kind, []);
    byKind.get(candidate.kind).push(candidate);
    if (++work === workChunk) { work = 0; yield 'cluster-partition-batch'; }
  }
  if (work) { work = 0; yield 'cluster-partition-batch'; }
  const clusters = [];
  for (const kind of ['k5', 'k3']) {
    const list = byKind.get(kind) || [];
    yield* coreSortSteps(list, sortMoveChunk);
    yield 'cluster-sort-kind';
    const kindClusters = [];
    const bounds = {};
    // 버킷키 → 그 버킷에 mean 이 든 클러스터의 삽입 인덱스 배열.
    const buckets = new Map();
    const bucketOf = (x, y) => (Math.floor(x / CLUSTER_BUCKET_PX) * 100003)
      + Math.floor(y / CLUSTER_BUCKET_PX);
    const place = (index, x, y) => {
      const key = bucketOf(x, y);
      const slot = buckets.get(key);
      if (!slot) buckets.set(key, [index]);
      else if (slot.length === 0 || slot[slot.length - 1] < index) slot.push(index);
      else {
        // 평균 이동으로 과거 cluster가 들어와도 원래 삽입 index 순서를 유지해요.
        // 그러면 한 버킷의 첫 매치 뒤에는 더 작은 index가 없음을 증명할 수 있어요.
        let low = 0, high = slot.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (slot[middle] < index) low = middle + 1; else high = middle;
        }
        slot.splice(low, 0, index);
      }
      return key;
    };
    for (const candidate of list) {
      const radius = clusterSearchRadius(candidate);
      clusterBucketBounds(candidate, radius, bounds);
      const { fromX, toX, fromY, toY } = bounds;
      // 삽입 순서상 **처음** 매치를 고른다 — 선형판의 break 와 같은 선택.
      let bestIndex = -1;
      for (let gx = fromX; gx <= toX; gx += 1) {
        for (let gy = fromY; gy <= toY; gy += 1) {
          const slot = buckets.get((gx * 100003) + gy);
          if (!slot) continue;
          for (const index of slot) {
            if (bestIndex >= 0 && index >= bestIndex) break;
            const cluster = kindClusters[index];
            if (clusterAcceptsMeans(cluster.meanX, cluster.meanY, cluster.meanU, candidate)) { bestIndex = index; break; }
          }
        }
      }
      let home;
      if (bestIndex >= 0) {
        home = kindClusters[bestIndex];
        // 평균이 움직이면 버킷도 옮긴다 (드물다 — reach 안에서만 흡수하므로).
        const beforeKey = home.bucketKey;
        home.count += 1;
        home.sumX += candidate.x;
        home.sumY += candidate.y;
        home.sumU += candidate.u;
        // 점진 평균으로 바꾸지 않아요. 같은 누적 순서 뒤 같은 나눗셈의 결과만
        // 캐시하므로 경계 술어/버킷/최초 매치 선택은 그대로예요.
        home.meanX = home.sumX / home.count;
        home.meanY = home.sumY / home.count;
        home.meanU = home.sumU / home.count;
        const afterKey = bucketOf(home.meanX, home.meanY);
        if (afterKey !== beforeKey) {
          const old = buckets.get(beforeKey);
          if (old) {
            const at = old.indexOf(bestIndex);
            if (at >= 0) old.splice(at, 1);
          }
          home.bucketKey = place(bestIndex, home.meanX, home.meanY);
        }
        if (++work === workChunk) { work = 0; yield 'cluster-candidate-batch'; }
        continue;
      }
      home = { kind, count: 0, sumX: 0, sumY: 0, sumU: 0, bucketKey: 0, meanX: 0, meanY: 0, meanU: 0 };
      kindClusters.push(home);
      home.bucketKey = place(kindClusters.length - 1, candidate.x, candidate.y);
      home.count += 1;
      home.sumX += candidate.x;
      home.sumY += candidate.y;
      home.sumU += candidate.u;
      home.meanX = home.sumX / home.count;
      home.meanY = home.sumY / home.count;
      home.meanU = home.sumU / home.count;
      if (++work === workChunk) { work = 0; yield 'cluster-candidate-batch'; }
    }
    if (work) { work = 0; yield 'cluster-candidate-batch'; }
    for (const cluster of kindClusters) {
      if (cluster.count >= cfg.minimumClusterSupport) {
        clusters.push({
          kind,
          count: cluster.count,
          x: cluster.sumX / cluster.count,
          y: cluster.sumY / cluster.count,
          u: cluster.sumU / cluster.count,
        });
      }
      if (++work === workChunk) { work = 0; yield 'cluster-output-batch'; }
    }
    if (work) { work = 0; yield 'cluster-output-batch'; }
  }
  yield* stableSortSteps(clusters, compareClusters(cfg), sortMoveChunk);
  yield 'cluster-sort-result';
  return clusters;
}

function* lines(width, height) {
  for (let y = 0; y < height; y++) yield [0, y, 1, 0, width, 1];
  for (let x = 0; x < width; x++) yield [x, 0, 0, 1, height, 1];
  for (let y = 0; y < height; y++) yield [0, y, 1, 1, Math.min(width, height - y), Math.SQRT2];
  for (let x = 1; x < width; x++) yield [x, 0, 1, 1, Math.min(width - x, height), Math.SQRT2];
  for (let y = 0; y < height; y++) yield [0, y, 1, -1, Math.min(width, y + 1), Math.SQRT2];
  for (let x = 1; x < width; x++) yield [x, height - 1, 1, -1, Math.min(width - x, height), Math.SQRT2];
}
const sameEpoch = (a, b) => !!b && a.width === b.width && a.height === b.height && a.generation === b.generation;
const sameFrame = (a, b) => sameEpoch(a, b) && a.frameId === b.frameId && a.timestamp === b.timestamp;

export function createVerifiedCursorPrototypeV3(luma, origin, options = {}) {
  if (!origin || origin.frameId == null || !Number.isFinite(origin.timestamp) || origin.generation == null
    || origin.width !== luma.width || origin.height !== luma.height
    || !Number.isInteger(luma.width) || !Number.isInteger(luma.height) || luma.width <= 0 || luma.height <= 0
    || luma.data.length !== luma.width * luma.height || (luma.alpha && luma.alpha.length !== luma.data.length)) {
    throw new TypeError('완전한 원본 프레임 identity와 픽셀이 필요해요');
  }
  const identity = Object.freeze({ frameId: origin.frameId, timestamp: origin.timestamp,
    width: origin.width, height: origin.height, generation: origin.generation });
  const timing = typeof options.timing === 'function' ? options.timing : null;
  const sortMoveChunk = options.sortMoveChunk ?? 128;
  if (!Number.isSafeInteger(sortMoveChunk) || sortMoveChunk < 1) throw new TypeError('sortMoveChunk는 양의 정수여야 해요');
  // raw core 하나마다 yield하면 실물 f0에서 같은 군집 문장을 40만 회 넘게 잘게 쪼갠다.
  // 의미·순서는 그대로 두고 고정 개수만 한 원자 작업으로 묶는다. 시간 예산은 호출자가 계속 쥔다.
  const clusterWorkChunk = options.clusterWorkChunk ?? 128;
  if (!Number.isSafeInteger(clusterWorkChunk) || clusterWorkChunk < 1) {
    throw new TypeError('clusterWorkChunk는 양의 정수여야 해요');
  }
  const retainPrepared = options.retainPrepared === true;
  const copyAt = performance.now();
  let snapshot = { width: luma.width, height: luma.height, data: luma.data.slice(), alpha: luma.alpha?.slice() || null };
  const copyMs = performance.now() - copyAt;
  const snapshotBytes = snapshot.data.byteLength + (snapshot.alpha?.byteLength || 0);
  if (timing) timing({ stage: 'cursor.snapshot-copy', ms: copyMs });
  const cfg = structuredClone(I.calibration(options));
  let phase = 'downsample', reduced = null, cut = null, scan = null, scratch = null, clustering = null;
  let cores = [], clusters = [], verified = [], occupied = [], index = 0, k5 = 0, k3 = 0, result = null, prepared = null;
  let disposalReason = null, steps = 0, maxUnitMs = copyMs;
  function discard(reason = 'invalidateLock') {
    phase = 'discarded'; disposalReason = reason;
    snapshot = reduced = cut = scratch = scan = clustering = result = prepared = null;
    cores = clusters = verified = occupied = null;
  }
  function resume(current = identity) {
    if (phase === 'discarded') return { state: phase, reason: disposalReason };
    if (!sameEpoch(identity, current)) { discard('resize-or-generation'); return { state: phase, reason: disposalReason }; }
    if (!Number.isFinite(current.timestamp) || current.timestamp < identity.timestamp) {
      discard('invalid-time'); return { state: phase, reason: disposalReason };
    }
    if (phase === 'done') return { state: phase, originFrameId: identity.frameId, ageMs: current.timestamp - identity.timestamp };
    let stage = phase;
    const start = performance.now();
    if (phase === 'downsample') {
      reduced = downsampleLumaForSeed(snapshot, cfg.searchMaxSide); phase = 'otsu';
    } else if (phase === 'otsu') {
      cut = otsuThreshold(reduced.luma);
      scan = lines(reduced.luma.width, reduced.luma.height);
      scratch = I.makeSeriesScratch(Math.max(reduced.luma.width, reduced.luma.height)); phase = 'scan-line';
    } else if (phase === 'scan-line') {
      const next = scan.next();
      if (next.done) {
        phase = 'cluster'; scan = scratch = null;
        clustering = clusterSteps(cores, cfg, sortMoveChunk, clusterWorkChunk);
      }
      else I.scanLineForCores(reduced.luma, ...next.value, cut, scratch, cfg, cores, I.binarizeSeriesFused);
    } else if (phase === 'cluster') {
      const step = clustering.next();
      if (step.done) { clusters = step.value; clustering = null; phase = 'verify-cluster'; }
      else stage = step.value;
    } else if (phase === 'verify-cluster') {
      // 정렬상 한 kind가 길게 이어지면 그 종류의 cap 이후 빈 작업이 수천 건
      // 생겨요. 다른 kind의 다음 실제 평가까지 고정 개수씩만 건너뛰어요.
      let skipped = 0;
      while (index < clusters.length && skipped < clusterWorkChunk
        && (clusters[index].kind === 'k5' ? !(k5 < cfg.maximumVerifiedPerKind) : !(k3 < cfg.maximumVerifiedPerKind))) {
        index++; skipped++;
      }
      // 두 종류 모두 기존 검증 상한을 썼다면 뒤 군집은 원래도 평가하지 않아요.
      // 전체 군집/진단은 보존하되 결과를 낼 수 없는 resume만 생략해요.
      if (index === clusters.length
        || k5 >= cfg.maximumVerifiedPerKind && k3 >= cfg.maximumVerifiedPerKind) phase = 'finish';
      else if (skipped === clusterWorkChunk) stage = 'verify-cluster-skip';
      else {
        const cluster = clusters[index++];
        const allowed = cluster.kind === 'k5' ? k5 < cfg.maximumVerifiedPerKind : k3 < cfg.maximumVerifiedPerKind;
        if (allowed) {
          if (cluster.kind === 'k5') k5++; else k3++;
          if (!occupied.some(hit => hit.coreKind === cluster.kind
            && Math.hypot(hit.x - cluster.x, hit.y - cluster.y) <= 2.2 * Math.max(hit.u, cluster.u))) {
            const native = cluster.kind === 'k5'
              ? I.verifyV2r2Cluster(reduced.luma, cut, cluster, cfg) : I.verifyV0Cluster(reduced.luma, cut, cluster, cfg);
            const hit = native || (cluster.kind === 'k5'
              ? I.verifyV0Cluster(reduced.luma, cut, cluster, cfg) : I.verifyV2r2Cluster(reduced.luma, cut, cluster, cfg));
            if (hit) { verified.push(hit); occupied.push({ ...hit, coreKind: cluster.kind }); }
          }
        }
      }
    } else if (phase === 'finish') {
      verified.sort((a, b) => b.score - a.score || b.count - a.count || a.y - b.y || a.x - b.x);
      result = Object.freeze({ origin: identity, currentFrameUsable: false,
        downsampleFactor: reduced.factor, coreCandidates: cores.length, clusterCount: clusters.length,
        verified: Object.freeze(verified.map(hit => Object.freeze({ kind: hit.kind,
          x: hit.x * reduced.factor, y: hit.y * reduced.factor, u: hit.u * reduced.factor,
          score: hit.score, count: hit.count }))) });
      // 후반 shape 조립도 scan/verify와 같은 owned 원본을 써야 해요. 호출자 luma를
      // pause 뒤 바꾸면 reduced/verified와 full-resolution 표본이 서로 다른 frame이 된다.
      if (retainPrepared) prepared = { field: snapshot, reduced, globalCut: cut, cores, clusters, verified, cfg };
      phase = 'done'; snapshot = cut = scan = scratch = null;
      if (!retainPrepared) cores = clusters = verified = occupied = reduced = null;
      else occupied = null;
    }
    const ms = performance.now() - start; steps++; maxUnitMs = Math.max(maxUnitMs, ms);
    if (timing) timing({ stage: `cursor.${stage}`, ms });
    return { state: phase, unit: stage, ms, originFrameId: identity.frameId, ageMs: current.timestamp - identity.timestamp };
  }
  return Object.freeze({ resume, discard, reset: () => discard('reset'),
    // 재관측 구현 없는 프로토타입: 다른 프레임으로 낡은 verified/H 전달을 무조건 보류한다.
    takeForFrame(current) {
      if (!sameEpoch(identity, current)) { discard('resize-or-generation'); return null; }
      return phase === 'done' && sameFrame(identity, current) ? result : null;
    },
    // opt-in work product는 같은 프레임에서 한 번만 이전한다. 기본 경로는 보관하지 않는다.
    takePreparedForFrame(current) {
      if (!sameEpoch(identity, current)) { discard('resize-or-generation'); return null; }
      if (phase !== 'done' || !sameFrame(identity, current) || prepared === null) return null;
      const owned = prepared; prepared = null; reduced = cores = clusters = verified = null;
      return owned;
    },
    get status() {
      return { phase, origin: identity, snapshotBytes, copyMs, steps, maxUnitMs,
        sortMoveChunk, clusterWorkChunk, disposalReason };
    },
  });
}
