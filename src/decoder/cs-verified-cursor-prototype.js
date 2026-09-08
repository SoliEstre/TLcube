/** 격리 실험 전용: verified 앞단만 재개한다. 제품 로케이터·라우터에는 연결하지 않는다. */
import { CS_BLOCK_LOCATOR_INTERNALS as I } from './cellsurface-block-detect.js';
import { downsampleLumaForSeed, otsuThreshold } from './finder-seed.js';

// 군집화 정본을 동일 문장·동일 순서로 재개하는 실험 사본. 기본 동기 경로에는 연결하지 않는다.
const { clusterSearchRadius, clusterAccepts, CLUSTER_BUCKET_PX, compareClusters } = I;
function* clusterSteps(candidates, cfg) {
  const byKind = new Map();
  for (const candidate of candidates) {
    if (!byKind.has(candidate.kind)) byKind.set(candidate.kind, []);
    byKind.get(candidate.kind).push(candidate);
    yield 'cluster-partition';
  }
  const clusters = [];
  for (const kind of ['k5', 'k3']) {
    const list = byKind.get(kind) || [];
    list.sort((left, right) => left.y - right.y || left.x - right.x || left.u - right.u);
    yield 'cluster-sort-kind';
    const kindClusters = [];
    // 버킷키 → 그 버킷에 mean 이 든 클러스터의 삽입 인덱스 배열.
    const buckets = new Map();
    const bucketOf = (x, y) => (Math.floor(x / CLUSTER_BUCKET_PX) * 100003)
      + Math.floor(y / CLUSTER_BUCKET_PX);
    const place = (index, x, y) => {
      const key = bucketOf(x, y);
      const slot = buckets.get(key);
      if (slot) slot.push(index); else buckets.set(key, [index]);
      return key;
    };
    for (const candidate of list) {
      const radius = clusterSearchRadius(candidate);
      // +1 은 부동소수·버킷 경계 여유다. 등가가 정확성의 전부라 인색하게 굴지 않는다.
      const span = Math.ceil(radius / CLUSTER_BUCKET_PX) + 1;
      const bx = Math.floor(candidate.x / CLUSTER_BUCKET_PX);
      const by = Math.floor(candidate.y / CLUSTER_BUCKET_PX);
      // 삽입 순서상 **처음** 매치를 고른다 — 선형판의 break 와 같은 선택.
      let bestIndex = -1;
      for (let gx = bx - span; gx <= bx + span; gx += 1) {
        for (let gy = by - span; gy <= by + span; gy += 1) {
          const slot = buckets.get((gx * 100003) + gy);
          if (!slot) continue;
          for (const index of slot) {
            if (bestIndex >= 0 && index > bestIndex) continue;
            if (clusterAccepts(kindClusters[index], candidate)) bestIndex = index;
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
        const afterKey = bucketOf(home.sumX / home.count, home.sumY / home.count);
        if (afterKey !== beforeKey) {
          const old = buckets.get(beforeKey);
          if (old) {
            const at = old.indexOf(bestIndex);
            if (at >= 0) old.splice(at, 1);
          }
          home.bucketKey = place(bestIndex, home.sumX / home.count, home.sumY / home.count);
        }
        yield 'cluster-candidate';
        continue;
      }
      home = { kind, count: 0, sumX: 0, sumY: 0, sumU: 0, bucketKey: 0 };
      kindClusters.push(home);
      home.bucketKey = place(kindClusters.length - 1, candidate.x, candidate.y);
      home.count += 1;
      home.sumX += candidate.x;
      home.sumY += candidate.y;
      home.sumU += candidate.u;
      yield 'cluster-candidate';
    }
    for (const cluster of kindClusters) {
      yield 'cluster-output';
      if (cluster.count < cfg.minimumClusterSupport) continue;
      clusters.push({
        kind,
        count: cluster.count,
        x: cluster.sumX / cluster.count,
        y: cluster.sumY / cluster.count,
        u: cluster.sumU / cluster.count,
      });
    }
  }
  clusters.sort(compareClusters(cfg));
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

export function createVerifiedCursorPrototype(luma, origin, options = {}) {
  if (!origin || origin.frameId == null || !Number.isFinite(origin.timestamp) || origin.generation == null
    || origin.width !== luma.width || origin.height !== luma.height
    || !Number.isInteger(luma.width) || !Number.isInteger(luma.height) || luma.width <= 0 || luma.height <= 0
    || luma.data.length !== luma.width * luma.height || (luma.alpha && luma.alpha.length !== luma.data.length)) {
    throw new TypeError('완전한 원본 프레임 identity와 픽셀이 필요해요');
  }
  const identity = Object.freeze({ frameId: origin.frameId, timestamp: origin.timestamp,
    width: origin.width, height: origin.height, generation: origin.generation });
  const timing = typeof options.timing === 'function' ? options.timing : null;
  const copyAt = performance.now();
  let snapshot = { width: luma.width, height: luma.height, data: luma.data.slice(), alpha: luma.alpha?.slice() || null };
  const copyMs = performance.now() - copyAt;
  const snapshotBytes = snapshot.data.byteLength + (snapshot.alpha?.byteLength || 0);
  if (timing) timing({ stage: 'cursor.snapshot-copy', ms: copyMs });
  const cfg = structuredClone(I.calibration(options));
  let phase = 'downsample', reduced = null, cut = null, scan = null, scratch = null, clustering = null;
  let cores = [], clusters = [], verified = [], occupied = [], index = 0, k5 = 0, k3 = 0, result = null;
  let disposalReason = null, steps = 0, maxUnitMs = copyMs;
  function discard(reason = 'invalidateLock') {
    phase = 'discarded'; disposalReason = reason;
    snapshot = reduced = cut = scratch = scan = clustering = result = null;
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
      if (next.done) { phase = 'cluster'; scan = scratch = null; clustering = clusterSteps(cores, cfg); }
      else I.scanLineForCores(reduced.luma, ...next.value, cut, scratch, cfg, cores);
    } else if (phase === 'cluster') {
      const step = clustering.next();
      if (step.done) { clusters = step.value; clustering = null; phase = 'verify-cluster'; }
      else stage = step.value;
    } else if (phase === 'verify-cluster') {
      if (index === clusters.length) phase = 'finish';
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
      phase = 'done'; snapshot = reduced = cut = scan = scratch = null; cores = clusters = verified = occupied = null;
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
    get status() { return { phase, origin: identity, snapshotBytes, copyMs, steps, maxUnitMs, disposalReason }; },
  });
}
