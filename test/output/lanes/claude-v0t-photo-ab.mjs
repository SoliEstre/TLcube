/**
 * claude-v0t-photo-ab.mjs — **실사진** 위에서 링 수리 전/후 A/B.
 *
 * 운영자가 2026-08-17 23:13 에 v0T·v0TY 실패 사진 6장을 줬다
 * (`test/output/photos/v0t-20260817/`). 오늘 v0T 에 대한 판단이 전부 합성 위에
 * 서 있었는데, 이제 **실패 데이터**가 생겼다.
 *
 * 재는 것 — 사진마다 두 세계를 나란히:
 *   수리후: 기본 cfg (bullseyeConfirmedCornerPool 8 · squareRingUsesFullCornerPool true)
 *   수리전: 그 둘을 종전 값으로 되돌린 cfg (풀 4 · 동반자 게이트는 캡된 목록만)
 * 이 둘이 정확히 이번 커밋(3c2bfa0)의 차이다 — 스위치로 되돌려지므로 같은 바이너리에서
 * 두 세계를 잰다.
 *
 * 깔때기: k3 / k5 / 느슨코너 / anchored / conf / poseCount / 최종 분류·사유.
 * ⚠ 게이트는 한 값도 안 건드린다.
 */

import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../../../tools/read-luma.mjs';

const PRE = { bullseyeConfirmedCornerPool: 4, squareRingUsesFullCornerPool: false };
const POST = {};

const labOptions = (csBlockLocator) => ({
  bootstrap: {
    family: {
      cube: {
        enableLocatorY: true,
        enableCellSurfaceY: true,
        calibration: { csBlockLocator },
      },
    },
  },
});

const dumps = listLumaDumps().filter((d) => d.name.includes('20260817_23'));
if (!dumps.length) {
  console.log('★ v0t-20260817 덤프가 없다 — photo-probe.html 로 먼저 구워라.');
  process.exit(1);
}
console.log(`덤프 ${dumps.length}개\n`);

function funnel(luma, csCfg) {
  const det = detectCellSurfaceBlockShapes(luma, {
    enableCellSurfaceY: true,
    calibration: { csBlockLocator: csCfg },
  });
  const d = det.diagnostics;
  return {
    k3: d.verified.filter((h) => h.kind === 'v0-center').length,
    k5: d.verified.filter((h) => h.kind === 'v2r2-corner').length,
    loose: d.centerQr.corners,
    anch: d.earlyBranch.anchored,
    conf: `${d.bullseyeConfirmed.centres}/${d.bullseyeConfirmed.triples}`,
    v0t: d.poseCount.v0t,
    v0ty: d.poseCount.v0ty,
    v0: d.poseCount.v0,
    shapes: d.shapeCount,
  };
}

const rows = [];
for (const dump of dumps.sort((a, b) => a.name.localeCompare(b.name))) {
  const luma = readLumaDump(dump.path);
  const raster = lumaToRaster(luma);
  for (const [world, csCfg] of [['수리전', PRE], ['수리후', POST]]) {
    let f; let verdict;
    try {
      f = funnel(luma, csCfg);
      const decoded = decodeFrontend(raster, labOptions(csCfg));
      verdict = decoded.ok
        ? `OK ${decoded.hypothesis.cellSurfaceLayout}/n${decoded.hypothesis.n}`
          + `  «${String(decoded.text).slice(0, 28)}»`
        : `실패 ${decoded.reason.replace('frontend:', '')}`;
    } catch (error) {
      f = null;
      verdict = '★ERROR ' + (error instanceof Error ? error.message : String(error)).slice(0, 60);
    }
    rows.push({ name: dump.name, world, f, verdict });
    if (f) {
      console.log(`${dump.name.padEnd(42)} ${world}`
        + `  k3=${String(f.k3).padStart(2)} k5=${String(f.k5).padStart(2)}`
        + ` loose=${String(f.loose).padStart(2)} anch=${f.anch} conf=${f.conf.padEnd(5)}`
        + ` pose v0t=${f.v0t} v0ty=${f.v0ty} v0=${f.v0} shapes=${f.shapes}`
        + `  → ${verdict}`);
    } else {
      console.log(`${dump.name.padEnd(42)} ${world}  ${verdict}`);
    }
  }
  console.log('');
}

console.log('=== 요약 ===');
const byName = new Map();
for (const r of rows) {
  if (!byName.has(r.name)) byName.set(r.name, {});
  byName.get(r.name)[r.world] = r;
}
let improved = 0; let same = 0; let worse = 0;
for (const [name, pair] of byName) {
  const a = pair['수리전']; const b = pair['수리후'];
  if (!a || !b) continue;
  const aOk = a.verdict.startsWith('OK'); const bOk = b.verdict.startsWith('OK');
  if (!aOk && bOk) { improved += 1; console.log(`  ↑ ${name}: 실패 → ${b.verdict}`); }
  else if (aOk && !bOk) { worse += 1; console.log(`  ↓ ${name}: ${a.verdict} → 실패 ★회귀`); }
  else same += 1;
}
console.log(`  개선 ${improved} · 동일 ${same} · 회귀 ${worse}`);
// v0 오분류 회계 — 운영자 신고의 핵심 축.
for (const world of ['수리전', '수리후']) {
  const mine = rows.filter((r) => r.world === world && r.f);
  const v0only = mine.filter((r) => r.f.v0 > 0 && r.f.v0t === 0 && r.f.v0ty === 0).length;
  console.log(`  ${world}: v0 포즈만 선 프레임 ${v0only}/${mine.length}`
    + ` · v0t 포즈 총합 ${mine.reduce((s, r) => s + r.f.v0t, 0)}`);
}
