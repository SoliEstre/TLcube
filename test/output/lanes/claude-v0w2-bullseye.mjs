/**
 * claude-v0w2-bullseye.mjs — **중앙 불스아이가 이미 검출돼 있는가** 실측 (과업 3 ③).
 *
 * 두 가지를 같은 프레임에서 나란히 잰다:
 *   ① **불스아이 스타터**: `verifyV0Cluster` 가 낸 `v0-center` 히트가 코너 삼중점
 *      무게중심 근처에 실제로 있는가 (있으면 «중앙은 불스아이다» 가 이미 공짜로
 *      알려져 있다는 뜻 — 중앙 QR 포즈를 거기 세우면 안 된다).
 *   ② **QR 다움 정규화 대비**: 중앙 QR 패치의 3 파인더 암코어가 T 콰이어트
 *      프레임보다 얼마나 어두운가를 **패치 자체의 동적 범위로 정규화**해서.
 *      절대 휘도로 재면 톤 커브·노출에 흔들린다.
 *
 * 실행: node test/output/lanes/claude-v0w2-bullseye.mjs
 */

import { detectCellSurfaceBlockShapes, CS_BLOCK_LOCATOR_INTERNALS as I }
  from '../../../src/decoder/cellsurface-block-detect.js';
import { downsampleLumaForSeed, otsuThreshold } from '../../../src/decoder/finder-seed.js';
import { estimateHomography4, projectPoint } from '../../../src/decoder/homography.js';
import { CORNER_UNIT_OFFSETS } from '../../../src/hexgrid.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { render, embed960, photoLike } from './claude-v0w2-leak.mjs';

const N = 21;
const CFG = {
  searchMaxSide: 480,
  minimumCoreUnitPx: 1.2,
  minimumClusterSupport: 2,
  maximumVerifiedPerKind: 80,
  minimumRayPass: 6,
  v0xqMinimumRing2: 5,
  v0xqMaxInspectedClusters: 24,
  v0xqTripleRadiusTolerance: 0.18,
  v0xqTripleAngleToleranceDeg: 18,
};

function bilinear(luma, x, y) {
  const { width, height, data } = luma;
  if (!(x >= 0 && y >= 0 && x <= width - 1 && y <= height - 1)) return null;
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1); const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0; const fy = y - y0;
  const top = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx;
  const bottom = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** 좌표계: reduced (downsample) 공간. detect 진입점과 같은 계산. */
function seedStage(luma) {
  const reduced = downsampleLumaForSeed(luma, CFG.searchMaxSide);
  const cut = otsuThreshold(reduced.luma);
  const cores = I.scanConcentricCores(reduced.luma, cut, CFG);
  const clusters = I.clusterCores(cores, CFG);
  const centres = [];
  const corners = [];
  const occupied = [];
  let k5 = 0; let k3 = 0;
  for (const cluster of clusters) {
    if (cluster.kind === 'k5') { if (k5 >= CFG.maximumVerifiedPerKind) continue; k5 += 1; }
    else { if (k3 >= CFG.maximumVerifiedPerKind) continue; k3 += 1; }
    if (occupied.some((hit) => hit.coreKind === cluster.kind
      && Math.hypot(hit.x - cluster.x, hit.y - cluster.y)
        <= 2.2 * Math.max(hit.u, cluster.u))) continue;
    const native = cluster.kind === 'k5'
      ? I.verifyV2r2Cluster(reduced.luma, cut, cluster, CFG)
      : I.verifyV0Cluster(reduced.luma, cut, cluster, CFG);
    const hit = native || (cluster.kind === 'k5'
      ? I.verifyV0Cluster(reduced.luma, cut, cluster, CFG)
      : I.verifyV2r2Cluster(reduced.luma, cut, cluster, CFG));
    if (hit) { occupied.push({ ...hit, coreKind: cluster.kind }); }
  }
  for (const hit of occupied) {
    if (hit.kind === 'v0-center') centres.push(hit);
  }
  centres.sort((a, b) => b.score - a.score || b.count - a.count);
  // v0xq/v0wq 코너 — 별도 순회 (진입점과 같은 규칙).
  const cornerOccupied = [];
  let inspected = 0;
  for (const cluster of clusters) {
    if (cluster.kind !== 'k5') continue;
    if (inspected >= CFG.v0xqMaxInspectedClusters) break;
    inspected += 1;
    if (cornerOccupied.some((hit) => Math.hypot(hit.x - cluster.x, hit.y - cluster.y)
      <= 2.2 * Math.max(hit.u, cluster.u))) continue;
    const hit = I.verifyV0xqCornerCluster(reduced.luma, cut, cluster, CFG);
    if (!hit) continue;
    cornerOccupied.push(hit);
  }
  cornerOccupied.sort((a, b) => b.score - a.score || b.count - a.count);
  corners.push(...cornerOccupied.slice(0, 4));
  return { reduced, centres: centres.slice(0, 3), corners };
}

/** 120° · 같은 반경 삼중점의 무게중심들 (reduced 공간). */
function triples(corners) {
  const out = [];
  const tol = (CFG.v0xqTripleAngleToleranceDeg * Math.PI) / 180;
  for (let a = 0; a < corners.length; a += 1) {
    for (let b = a + 1; b < corners.length; b += 1) {
      for (let c = b + 1; c < corners.length; c += 1) {
        const t = [corners[a], corners[b], corners[c]];
        const centre = {
          x: (t[0].x + t[1].x + t[2].x) / 3,
          y: (t[0].y + t[1].y + t[2].y) / 3,
        };
        const radii = t.map((h) => Math.hypot(h.x - centre.x, h.y - centre.y));
        const rMin = Math.min(...radii); const rMax = Math.max(...radii);
        if (!(rMin > 1e-9)) continue;
        if (rMax - rMin > CFG.v0xqTripleRadiusTolerance * rMax) continue;
        const angles = t.map((h) => Math.atan2(h.y - centre.y, h.x - centre.x))
          .sort((l, r) => l - r);
        let spaced = true;
        for (let k = 0; k < 3; k += 1) {
          let d = angles[(k + 1) % 3] - angles[k];
          if (d < 0) d += 2 * Math.PI;
          if (Math.abs(d - (2 * Math.PI) / 3) > tol) spaced = false;
        }
        if (!spaced) continue;
        out.push({ centre, radius: (rMin + rMax) / 2, u: t[0].u });
      }
    }
  }
  return out;
}

function poseHomography(shape, n = N) {
  const canonical = CORNER_UNIT_OFFSETS.map((c) => ({ x: c.x * n, y: c.y * n }));
  return estimateHomography4(canonical.slice(0, 4), shape.vertices.slice(0, 4));
}

/** 정규화 QR 다움 — (콰이어트 평균 − 파인더코어 평균) / (패치 p95 − p5). */
function qrness(luma, H, patch, slotCells) {
  const quietCount = patch.points.length - 2 * slotCells * slotCells - 3;
  const values = [];
  const quiet = [];
  const finder = [];
  for (let index = 0; index < patch.points.length; index += 1) {
    const image = projectPoint(H, patch.points[index]);
    if (!image) continue;
    const value = bilinear(luma, image.x, image.y);
    if (value === null) continue;
    values.push(value);
    if (index < quietCount) quiet.push(value);
    else if (index >= patch.points.length - 3) finder.push(value);
  }
  if (values.length < 20 || quiet.length < 6 || finder.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const span = pick(0.95) - pick(0.05);
  if (!(span > 1e-6)) return null;
  const mean = (l) => l.reduce((a, b) => a + b, 0) / l.length;
  return (mean(quiet) - mean(finder)) / span;
}

const LADDER2 = Object.freeze([
  ['L0 clean', {}],
  ['L2 blur1.6', { blur: 1.6 }],
  ['L4 photo', { blur: 1.6, noise: 6, jpeg: 55 }],
  ['L5 photo+tilt18', { blur: 1.6, noise: 6, jpeg: 55, tilt: 18 }],
  ['L7 photo+g0.7', { blur: 1.6, noise: 6, jpeg: 55, gamma: 0.7 }],
  ['LA photo+g1.4', { blur: 1.6, noise: 6, jpeg: 55, gamma: 1.4 }],
  ['LB photo+sC0.6', { blur: 1.6, noise: 6, jpeg: 55, sCurve: 0.6 }],
  ['L9 hard', { blur: 2.4, noise: 9, jpeg: 45 }],
]);
const ROTS = [0, 17, 120, 240];

const rows = [];
for (const target of ['v0w', 'v0x', 'v0w2', 'v0wq']) {
  for (const tones of [2, 3]) {
    const base = embed960(render(target, 15, tones));
    for (const [name, spec] of LADDER2) {
      for (const rotation of ROTS) {
        const frame = photoLike(base, { ...spec, rotation });
        const luma = toRelativeLuminance(frame);
        const { reduced, centres, corners } = seedStage(luma);
        const tri = triples(corners);
        // 삼중점마다 «가장 가까운 불스아이 중앙» 거리 (코너 u 단위, reduced 공간).
        const nearest = tri.map((t) => {
          let best = Infinity;
          for (const centre of centres) {
            best = Math.min(best, Math.hypot(centre.x - t.centre.x, centre.y - t.centre.y));
          }
          return {
            d: best,
            u: t.u,
            ratio: best / Math.max(t.u, 1e-9),
            ratioR: best / Math.max(t.radius, 1e-9),
          };
        });
        // QR 다움 — 자기 패밀리 포즈 H 에서 (없으면 첫 셰이프).
        const detected = detectCellSurfaceBlockShapes(luma, {});
        const shape = detected.shapes.find((s) => s.blockLocator.family === target)
          || detected.shapes[0];
        const H = shape ? poseHomography(shape) : null;
        const score = H ? qrness(luma, H, I.patchesFor(N, 'v0wq').centre, 8) : null;
        rows.push({
          target, tones, ladder: name, rotation,
          centres: centres.length,
          corners: corners.length,
          triples: tri.length,
          minRatio: nearest.length
            ? Number(Math.min(...nearest.map((e) => e.ratio)).toFixed(2)) : null,
          minRatioR: nearest.length
            ? Number(Math.min(...nearest.map((e) => e.ratioR)).toFixed(4)) : null,
          poseFamily: shape ? shape.blockLocator.family : null,
          qrness: score === null ? null : Number(score.toFixed(3)),
          factor: reduced.factor,
        });
      }
    }
  }
}

console.log('target tones ladder            rot  centres corners triples  min(d/u)  poseFam  qrness');
for (const row of rows) {
  console.log([
    row.target.padEnd(5), String(row.tones).padEnd(3), row.ladder.padEnd(17),
    String(row.rotation).padStart(3),
    String(row.centres).padStart(6), String(row.corners).padStart(7),
    String(row.triples).padStart(7), String(row.minRatio).padStart(9),
    String(row.poseFamily).padEnd(6), String(row.qrness).padStart(7),
  ].join(' '));
}

const real = rows.filter((r) => r.target === 'v0wq' && r.qrness !== null);
const fake = rows.filter((r) => r.target !== 'v0wq' && r.qrness !== null);
const num = (list) => list.map((r) => r.qrness);
const stat = (list) => (list.length
  ? `min ${Math.min(...list).toFixed(3)} · 중앙 ${[...list].sort((a, b) => a - b)[list.length >> 1].toFixed(3)} · max ${Math.max(...list).toFixed(3)}`
  : '없음');
console.log('\n--- QR 다움 정규화 대비 ---');
console.log('진짜 v0wq  n=' + real.length, stat(num(real)));
console.log('가짜(비 v0wq) n=' + fake.length, stat(num(fake)));

const triReal = rows.filter((r) => r.target === 'v0wq' && r.minRatio !== null).map((r) => r.minRatio);
const triFake = rows.filter((r) => r.target !== 'v0wq' && r.minRatio !== null).map((r) => r.minRatio);
console.log('\n--- 삼중점 무게중심 ↔ 가장 가까운 불스아이 중앙 (코어 u 배수) ---');
console.log('진짜 v0wq  n=' + triReal.length, stat(triReal));
console.log('가짜(비 v0wq) n=' + triFake.length, stat(triFake));
const rReal = rows.filter((r) => r.target === 'v0wq' && r.minRatioR !== null).map((r) => r.minRatioR);
const rFake = rows.filter((r) => r.target !== 'v0wq' && r.minRatioR !== null).map((r) => r.minRatioR);
console.log('\n--- 같은 거리를 삼중점 반경 R 로 정규화 ---');
console.log('진짜 v0wq  n=' + rReal.length, stat(rReal));
console.log('가짜(비 v0wq) n=' + rFake.length, stat(rFake));
console.log('가짜 중 삼중점이 아예 없던 프레임',
  rows.filter((r) => r.target !== 'v0wq' && r.triples === 0).length,
  '/', rows.filter((r) => r.target !== 'v0wq').length);
