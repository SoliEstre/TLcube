/**
 * claude-v0w2-anchored.mjs — **왜 v0W 자기 포즈가 0 이 되나** (과업 3 ③ 진단).
 *
 * 누수 하네스가 찾은 자리: v0W 80칸 중 20칸에서 v0w 포즈가 0 이고, 그중 19칸은
 * **v0wq 포즈만** 선다. 그 20칸이 v0W 실패의 전부다. 그런데 중앙 불스아이도
 * 코너도 검증돼 있다 — 그러면 앵커드 조립이 **어느 조건에서** 죽는가?
 *
 * 조립 조건을 순서대로 세어 본다 (`assembleAnchoredPoses` 와 같은 순서):
 *   c1 distance > 6·centre.u    c2 반경 스냅 |r − √279| ≤ 3.2
 *   c3 사각 링 동반자 > 0        c4 refinePose 성공
 *
 * 실행: node test/output/lanes/claude-v0w2-anchored.mjs
 */

import { CS_BLOCK_LOCATOR_INTERNALS as I, detectCellSurfaceBlockShapes }
  from '../../../src/decoder/cellsurface-block-detect.js';
import { downsampleLumaForSeed, otsuThreshold } from '../../../src/decoder/finder-seed.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { render, embed960, photoLike } from './claude-v0w2-leak.mjs';

const V0W_RADIUS = Math.sqrt(279);
const SNAP = 3.2;
const CFG = {
  searchMaxSide: 480,
  minimumCoreUnitPx: 1.2,
  minimumClusterSupport: 2,
  maximumVerifiedPerKind: 80,
  minimumRayPass: 6,
  minimumPatchCorrelation: 0.25,
  registrationRangeCells: 1.25,
  registrationStepCells: 0.25,
  registrationRange2Cells: 0.5,
  registrationStep2Cells: 0.125,
  squareRingRadiusTolerance: 0.18,
  squareRingAngleToleranceDeg: 18,
  v0xqMinimumRing2: 5,
  v0xqMaxInspectedClusters: 24,
  partialAnchorPose: true,
  partialMinimumCoverage: 0.3,
  partialMinimumAnchors: 2,
  partialMinimumSubAnchors: 4,
  partialHomographySubAnchors: 8,
  partialResidualRatio: 1.5,
};

function seedStage(luma) {
  const reduced = downsampleLumaForSeed(luma, CFG.searchMaxSide);
  const cut = otsuThreshold(reduced.luma);
  const clusters = I.clusterCores(I.scanConcentricCores(reduced.luma, cut, CFG), CFG);
  const verified = [];
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
    if (hit) { verified.push(hit); occupied.push({ ...hit, coreKind: cluster.kind }); }
  }
  verified.sort((l, r) => r.score - l.score || r.count - l.count || l.y - r.y || l.x - r.x);
  return {
    reduced,
    centres: verified.filter((h) => h.kind === 'v0-center').slice(0, 3),
    corners: verified.filter((h) => h.kind === 'v2r2-corner').slice(0, 4),
  };
}

const LADDER = Object.freeze([
  ['L0 clean', {}],
  ['L2 blur1.6', { blur: 1.6 }],
  ['L4 photo', { blur: 1.6, noise: 6, jpeg: 55 }],
  ['L5 photo+tilt18', { blur: 1.6, noise: 6, jpeg: 55, tilt: 18 }],
  ['L7 photo+g0.7', { blur: 1.6, noise: 6, jpeg: 55, gamma: 0.7 }],
  ['L8 photo+g0.7+t18', { blur: 1.6, noise: 6, jpeg: 55, gamma: 0.7, tilt: 18 }],
]);
const ROTS = [0, 17, 120, 240];

const rows = [];
for (const tones of [2, 3]) {
  const base = embed960(render('v0w', 15, tones));
  for (const [name, spec] of LADDER) {
    for (const rotation of ROTS) {
      const frame = photoLike(base, { ...spec, rotation });
      const luma = toRelativeLuminance(frame);
      const { reduced, centres, corners } = seedStage(luma);
      const patches = I.patchesFor(21, 'v0w');
      let pairs = 0; let c1 = 0; let c2 = 0; let c3 = 0; let c4 = 0;
      const radii = [];
      for (const centre of centres) {
        for (const corner of corners) {
          pairs += 1;
          const distance = Math.hypot(corner.x - centre.x, corner.y - centre.y);
          if (!(distance > 6 * centre.u)) continue;
          c1 += 1;
          const estimatedRadius = distance / Math.max(centre.u, 1e-9);
          radii.push(Number(estimatedRadius.toFixed(2)));
          if (Math.abs(estimatedRadius - V0W_RADIUS) > SNAP) continue;
          c2 += 1;
          const companions = I.squareRingCompanions(centre, corner, corners, CFG);
          if (companions === 0) continue;
          c3 += 1;
          const H0 = I.anchoredSimilaritySeedTo(
            centre, corner, reduced.factor, patches.corners[0].anchor,
          );
          const refined = H0 === null ? null : I.refineHomographyWithPatches(
            luma, H0, patches, CFG.registrationRangeCells, CFG.registrationStepCells,
          );
          if (refined && refined.worstCorrelation >= CFG.minimumPatchCorrelation) c4 += 1;
        }
      }
      const detected = detectCellSurfaceBlockShapes(luma, {});
      rows.push({
        tones, ladder: name, rotation,
        centres: centres.length, corners: corners.length,
        pairs, c1, c2, c3, c4,
        posesV0w: detected.diagnostics.poseCount.v0w,
        posesV0wq: detected.diagnostics.poseCount.v0wq,
        radii: radii.slice(0, 6).join(','),
      });
    }
  }
}

console.log('tones ladder            rot  cen cor pair  c1(거리) c2(반경) c3(링) c4(정합)  v0w/v0wq  추정반경');
for (const row of rows) {
  console.log([
    String(row.tones).padEnd(5), row.ladder.padEnd(18), String(row.rotation).padStart(3),
    String(row.centres).padStart(4), String(row.corners).padStart(3), String(row.pairs).padStart(4),
    String(row.c1).padStart(8), String(row.c2).padStart(8), String(row.c3).padStart(6),
    String(row.c4).padStart(9),
    `${row.posesV0w}/${row.posesV0wq}`.padStart(9),
    row.radii,
  ].join(' '));
}
const dead = rows.filter((row) => row.posesV0w === 0);
console.log('\nv0w 포즈 0 인 칸', dead.length, '/', rows.length);
const stage = { noPair: 0, distance: 0, radius: 0, ring: 0, register: 0, other: 0 };
for (const row of dead) {
  if (row.pairs === 0) stage.noPair += 1;
  else if (row.c1 === 0) stage.distance += 1;
  else if (row.c2 === 0) stage.radius += 1;
  else if (row.c3 === 0) stage.ring += 1;
  else if (row.c4 === 0) stage.register += 1;
  else stage.other += 1;
}
console.log('죽은 단계:', JSON.stringify(stage));
console.log('(«other» = 4앵커 정합까지 통과했는데 최종 포즈가 0 — refinePose 하류 라운드나 dedupe)');
