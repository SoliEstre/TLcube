// ⚠ (retire 정정 2026-08-17) 이 하네스는 현재 봉합 **on** 세계에서 돈다 —
// 보고서 §21.3/§21.4 의 수치는 봉합 **전** 세계의 실측이므로, 재생산하려면
// calibration.csBlockLocator 의 봉합 스위치 3종을 꺼야 한다 (검증 렌즈 지적).
/**
 * claude-v0w2-centre.mjs — **중앙 QR 게이트의 실제 판별력** 해부 (과업 3 ① 기전).
 *
 * 가설: `buildCenterQrPatch` 의 기대 벡터는 «T 콰이어트 프레임 = 밝음 · L/R 슬롯
 * 전체 = 어두움 · QR 파인더 암코어 3점 = 어두움» 이다. 점수 구성이 T(밝음) 대
 * L·R(어두움)에 **압도적으로 치우쳐** 있어서, 실제로 재는 것이 «QR 다움» 이 아니라
 * **면 게인 음영(T=1.0 > L > R=0.62)** 일 수 있다. 그렇다면 이 게이트는 큐브면
 * 무엇이든 통과시킨다 — 교차 누수의 원천.
 *
 * 재는 것 (같은 프레임·같은 H 에서):
 *   ① 전체 중앙 QR 패치 상관 (게이트가 보는 값)
 *   ② 면-게인 성분만 제거한 «면 내부» 상관 — 면별로 평균을 뺀 뒤의 Pearson
 *   ③ QR 파인더 3 암코어 대 콰이어트 프레임의 실측 대비 (진짜 QR 신호)
 * 를 v0w · v0x · v0w2 (불스아이 중앙) 와 v0wq (진짜 QR 중앙) 에서 나란히.
 *
 * H 는 추정하지 않는다 — 블록 로케이터가 낸 **그 프레임의 자기 패밀리 포즈**의
 * 6 정점에서 4점 DLT 로 되돌린다 (포즈와 같은 캐노니컬 공간).
 *
 * 실행: node test/output/lanes/claude-v0w2-centre.mjs
 */

import { detectCellSurfaceBlockShapes, CS_BLOCK_LOCATOR_INTERNALS as I }
  from '../../../src/decoder/cellsurface-block-detect.js';
import { estimateHomography4, projectPoint } from '../../../src/decoder/homography.js';
import { CORNER_UNIT_OFFSETS } from '../../../src/hexgrid.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import {
  render, embed960, photoLike, LADDER,
} from './claude-v0w2-leak.mjs';

const N = 21;

/** 포즈 셰이프의 6 정점 → 캐노니컬 코너와 4점 DLT 로 H 복원. */
function poseHomography(shape, n = N) {
  const canonical = CORNER_UNIT_OFFSETS.map((c) => ({ x: c.x * n, y: c.y * n }));
  return estimateHomography4(canonical.slice(0, 4), shape.vertices.slice(0, 4));
}

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

function pearson(pairs) {
  const count = pairs.length;
  if (count < 6) return null;
  let sx = 0; let sy = 0;
  for (const [x, y] of pairs) { sx += x; sy += y; }
  const mx = sx / count; const my = sy / count;
  let sxx = 0; let syy = 0; let sxy = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx; const dy = y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  if (!(sxx > 0) || !(syy > 0)) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * 중앙 QR 패치의 점을 «어느 면에서 왔는가» 로 되돌린다.
 * buildCenterQrPatch 의 생성 순서를 그대로 재구성한다 (콰이어트 프레임 T → L 전체 →
 * R 전체 → 파인더 암코어 3, T). 그 순서는 소스가 고정하고 있으므로 개수로 가른다.
 */
function labelPoints(patch, slotCells) {
  const quiet = patch.points.length - 2 * slotCells * slotCells - 3;
  const labels = [];
  for (let index = 0; index < patch.points.length; index += 1) {
    if (index < quiet) labels.push('T-quiet');
    else if (index < quiet + slotCells * slotCells) labels.push('L-slot');
    else if (index < quiet + 2 * slotCells * slotCells) labels.push('R-slot');
    else labels.push('T-finder');
  }
  return labels;
}

function measure(luma, H, patch, labels) {
  const observed = [];
  for (const point of patch.points) {
    const image = projectPoint(H, point);
    observed.push(image ? bilinear(luma, image.x, image.y) : null);
  }
  const all = [];
  const byFace = { T: [], L: [], R: [] };
  for (let index = 0; index < patch.points.length; index += 1) {
    const value = observed[index];
    if (value === null) continue;
    all.push([value, patch.points[index].expected]);
    const face = labels[index][0];
    byFace[face].push({ value, expected: patch.points[index].expected, label: labels[index] });
  }
  // ② 면 내부 상관 — 면별 평균을 뺀 뒤(=면 게인 음영 제거) Pearson.
  const centred = [];
  for (const face of ['T', 'L', 'R']) {
    const list = byFace[face];
    if (list.length === 0) continue;
    const mean = list.reduce((sum, e) => sum + e.value, 0) / list.length;
    for (const entry of list) centred.push([entry.value - mean, entry.expected]);
  }
  // ③ QR 파인더 암코어 vs T 콰이어트 프레임 실측 대비.
  const finder = byFace.T.filter((e) => e.label === 'T-finder').map((e) => e.value);
  const quiet = byFace.T.filter((e) => e.label === 'T-quiet').map((e) => e.value);
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : NaN);
  return {
    full: pearson(all),
    faceCentred: pearson(centred),
    finderMean: mean(finder),
    quietMean: mean(quiet),
    // 진짜 QR 이면 파인더 암코어가 콰이어트 프레임보다 확실히 어둡다.
    finderContrast: mean(quiet) - mean(finder),
    tMean: mean(byFace.T.map((e) => e.value)),
    lMean: mean(byFace.L.map((e) => e.value)),
    rMean: mean(byFace.R.map((e) => e.value)),
    points: all.length,
  };
}

const SLOT = { v0wq: 8, v0xq: 9 };

function run() {
  const targets = ['v0w', 'v0x', 'v0w2', 'v0wq'];
  const rows = [];
  for (const target of targets) {
    for (const tones of [2, 3]) {
      const base = embed960(render(target, 15, tones));
      for (const [ladderName, spec] of LADDER.slice(0, 6)) {
        const frame = photoLike(base, { ...spec, rotation: 0 });
        const luma = toRelativeLuminance(frame);
        const detected = detectCellSurfaceBlockShapes(luma, {});
        const own = detected.shapes.find((s) => s.blockLocator.family === target)
          || detected.shapes[0];
        if (!own) { rows.push({ target, tones, ladder: ladderName, note: 'no-shape' }); continue; }
        const H = poseHomography(own);
        if (!H) { rows.push({ target, tones, ladder: ladderName, note: 'no-H' }); continue; }
        for (const layoutId of ['v0wq']) {
          const patch = I.patchesFor(N, layoutId).centre;
          const labels = labelPoints(patch, SLOT[layoutId]);
          const stats = measure(luma, H, patch, labels);
          // 게이트가 실제로 쓰는 값 — registerPatch 최대 상관.
          const cellPx = Math.hypot(H[0], H[3]);
          const registered = I.registerPatch(
            luma, H, patch, 1.25 * cellPx, Math.max(0.5, 0.25 * cellPx),
          );
          rows.push({
            target,
            tones,
            ladder: ladderName,
            poseFamily: own.blockLocator.family,
            gateCorr: registered ? Number(registered.correlation.toFixed(4)) : null,
            full: stats.full === null ? null : Number(stats.full.toFixed(4)),
            faceCentred: stats.faceCentred === null ? null : Number(stats.faceCentred.toFixed(4)),
            finderContrast: Number(stats.finderContrast.toFixed(4)),
            tMean: Number(stats.tMean.toFixed(4)),
            lMean: Number(stats.lMean.toFixed(4)),
            rMean: Number(stats.rMean.toFixed(4)),
          });
        }
      }
    }
  }
  console.log('target tones ladder                    poseFam gateCorr   full  faceCentred finderΔ   T/L/R 평균');
  for (const row of rows) {
    if (row.note) { console.log(row.target, row.tones, row.ladder, row.note); continue; }
    console.log([
      row.target.padEnd(5), String(row.tones).padEnd(3), row.ladder.padEnd(26),
      String(row.poseFamily).padEnd(6),
      String(row.gateCorr).padStart(8), String(row.full).padStart(8),
      String(row.faceCentred).padStart(9), String(row.finderContrast).padStart(9),
      `${row.tMean}/${row.lMean}/${row.rMean}`,
    ].join(' '));
  }
  console.log('\n게이트 문턱 v0xqCentreMinCorrelation = 0.25');
  const passed = rows.filter((r) => !r.note && r.gateCorr !== null && r.gateCorr >= 0.25);
  const leak = passed.filter((r) => r.target !== 'v0wq');
  console.log('게이트 통과', passed.length, '/', rows.filter((r) => !r.note).length,
    '· 그중 비-v0wq 프레임(=가짜)', leak.length);
}

run();
